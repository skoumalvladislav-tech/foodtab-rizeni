import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { textProKanal } from '@/lib/marketing'
import { popisStavu } from '@/lib/marketing-text'
import { jeden, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { naplanovat, pozadatOSchvaleni, rozhodnoutOSchvaleni, ulozitVerzi } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Detail příspěvku — psaní textu, schvalování, plán.
 *
 * Celá obrazovka stojí na jedné větě: schvaluje se PŘESNÁ VERZE.
 * Proto se text neukládá přepisem, ale novou verzí, a proto je pod
 * formulářem vidět historie — schvalovatel musí poznat, co se od
 * jeho rozhodnutí změnilo.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
  fontFamily: 'inherit',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type Prispevek = {
  id: string
  nazev: string
  stav: string
  kanaly: string[]
  planovano_na: string | null
  schvalena_verze_id: string | null
  aktualni_verze_id: string | null
}

type Verze = {
  id: string
  cislo: number
  zadani: string
  texty: Record<string, unknown>
  otisk: string
  poznamka: string
  vytvoreno_kdy: string
}

type Zadost = {
  id: string
  stav: string
  shrnuti: string
  pripominka: string
  zadano_kdy: string
  rozhodnuto_kdy: string | null
  verze_id: string
}

type Uloha = {
  id: string
  kanal: string
  stav: string
  planovano_na: string
  rezim: string
}

const STAVY_ULOH: Record<string, string> = {
  naplanovano: 'naplánováno',
  ve_fronte: 've frontě',
  odesila_se: 'odesílá se',
  zverejneno: 'zveřejněno',
  zverejneno_nanecisto: 'zveřejněno nanečisto (demo)',
  k_rucnimu_zverejneni: 'k ručnímu zveřejnění',
  selhalo: 'selhalo',
  vzdano: 'vzdáno po opakování',
  zruseno: 'zrušeno',
}

export default async function DetailPrispevku({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; prispevek: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string }>
}) {
  const { rozsah, prispevek: prispevekId } = await params
  const { ulozeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const p = await jeden<Prispevek>(
    'příspěvek',
    supabase.from('marketing_prispevky')
      .select('id, nazev, stav, kanaly, planovano_na, schvalena_verze_id, aktualni_verze_id')
      .eq('id', prispevekId).maybeSingle(),
  )
  // Cizí příspěvek schová RLS a vyjde prázdno — pro uživatele je to
  // totéž jako neexistující, a víc se mu říkat nemá.
  if (!p) notFound()

  const verze = await seznam<Verze>(
    'verze příspěvku',
    supabase.from('marketing_verze')
      .select('id, cislo, zadani, texty, otisk, poznamka, vytvoreno_kdy')
      .eq('prispevek_id', prispevekId).order('cislo', { ascending: false }),
  )
  const aktualni = verze[0] ?? null

  const zadosti = await seznam<Zadost>(
    'žádosti o schválení',
    supabase.from('marketing_schvaleni')
      .select('id, stav, shrnuti, pripominka, zadano_kdy, rozhodnuto_kdy, verze_id')
      .eq('prispevek_id', prispevekId).order('zadano_kdy', { ascending: false }),
  )
  const ceka = zadosti.find((z) => z.stav === 'ceka') ?? null

  const ulohy = await seznam<Uloha>(
    'publikační úlohy',
    supabase.from('marketing_publikace_ulohy')
      .select('id, kanal, stav, planovano_na, rezim')
      .eq('prispevek_id', prispevekId).order('planovano_na', { ascending: false }),
  )

  const smiPsat = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const smiPublikovat = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'
  const jeSchvalena = p.schvalena_verze_id !== null && p.schvalena_verze_id === p.aktualni_verze_id

  return (
    <>
      <Nadpis oci="Marketing" popis={`Stav: ${popisStavu(p.stav)}`}>{p.nazev}</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '820px', display: 'grid', gap: '16px' }}>
        {ulozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p> : null}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        {/* --- TEXT ------------------------------------------------ */}
        <form action={ulozitVerzi} style={{ ...karta, display: 'grid', gap: '14px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="prispevek" value={p.id} />

          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Text příspěvku</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Uložení vytvoří novou verzi. Pokud byl příspěvek schválený,
              schválení tím zaniká — schvaluje se přesné znění, ne název.
            </p>
          </div>

          {p.kanaly.map((kanal) => (
            <label key={kanal}>
              <span style={popisek}>{kanal === 'instagram' ? 'Instagram' : 'Facebook'}</span>
              <textarea
                name={`text_${kanal}`}
                rows={5}
                defaultValue={textProKanal(aktualni?.texty ?? {}, kanal)}
                style={pole}
                disabled={!smiPsat}
                placeholder="Co dnes vaříme a proč se na to těšíme…"
              />
            </label>
          ))}

          <label>
            <span style={popisek}>Poznámka k této verzi (uvidí ji schvalovatel)</span>
            <input name="poznamka" placeholder="Úprava textu" style={pole} disabled={!smiPsat} />
          </label>

          {smiPsat ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit jako novou verzi</button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Text mění ten, kdo smí připravovat příspěvky.
            </p>
          )}
        </form>

        {/* --- SCHVÁLENÍ -------------------------------------------- */}
        <div style={{ ...karta, display: 'grid', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Schválení</h2>

          {ceka ? (
            <>
              <p style={{ margin: 0, fontSize: '14px' }}>
                Čeká na rozhodnutí{ceka.shrnuti ? ` — „${ceka.shrnuti}“` : ''}.
              </p>
              {smiPublikovat ? (
                <form action={rozhodnoutOSchvaleni} style={{ display: 'grid', gap: '10px' }}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="prispevek" value={p.id} />
                  <input type="hidden" name="zadost" value={ceka.id} />
                  <label>
                    <span style={popisek}>Připomínka (u zamítnutí povinná)</span>
                    <input name="pripominka" style={pole} placeholder="Chci jinou fotku, tahle je tmavá." />
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button type="submit" name="rozhodnuti" value="schvalit" className="ft-tl ft-tl-hlavni">
                      Schválit
                    </button>
                    <button type="submit" name="rozhodnuti" value="zamitnout" className="ft-tl ft-tl-vedlejsi">
                      Vrátit s připomínkou
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
                    O vlastní žádost nerozhodujete — pokud ve firmě je někdo
                    další, kdo smí schvalovat, databáze to odmítne.
                  </p>
                </form>
              ) : (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Rozhoduje ten, kdo smí publikovat.
                </p>
              )}
            </>
          ) : jeSchvalena ? (
            <p style={{ margin: 0, fontSize: '14px' }}>Aktuální verze je schválená.</p>
          ) : smiPsat ? (
            <form action={pozadatOSchvaleni} style={{ display: 'grid', gap: '10px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="prispevek" value={p.id} />
              <label>
                <span style={popisek}>Co má schvalovatel vědět</span>
                <input name="shrnuti" style={pole} placeholder="Menu na čtvrtek, ceny podle jídelníčku." />
              </label>
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Poslat ke schválení</button>
              </div>
            </form>
          ) : (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím nikdo nepožádal o schválení.
            </p>
          )}
        </div>

        {/* --- PLÁN -------------------------------------------------- */}
        {jeSchvalena && smiPublikovat ? (
          <form action={naplanovat} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="prispevek" value={p.id} />
            <h2 style={{ margin: 0, fontSize: '16px' }}>Naplánovat</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Čas je místní čas provozovny. Převod dělá databáze — server
              běží v UTC a sám by to spletl.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <label>
                <span style={popisek}>Datum</span>
                <input name="datum" type="date" required style={pole} />
              </label>
              <label>
                <span style={popisek}>Čas</span>
                <input name="cas" type="time" required style={pole} />
              </label>
            </div>
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Naplánovat</button>
            </div>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              Dokud není připojený účet sítě, skončí to jako „k ručnímu
              zveřejnění“ — nic se nikam neodešle.
            </p>
          </form>
        ) : null}

        {ulohy.length > 0 ? (
          <div style={karta}>
            <h2 style={{ margin: '0 0 10px', fontSize: '16px' }}>Publikace</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
              {ulohy.map((u) => (
                <li key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', fontSize: '14px' }}>
                  <span>{u.kanal === 'instagram' ? 'Instagram' : 'Facebook'}</span>
                  <span style={{ color: 'var(--muted)' }}>{STAVY_ULOH[u.stav] ?? u.stav}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* --- HISTORIE ---------------------------------------------- */}
        <div style={karta}>
          <h2 style={{ margin: '0 0 10px', fontSize: '16px' }}>Verze</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
            {verze.map((v) => (
              <li key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', fontSize: '14px' }}>
                <span>
                  {v.cislo}. {v.poznamka}
                  {v.id === p.schvalena_verze_id ? ' — schválená' : ''}
                </span>
                <span className="mono" style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {v.otisk.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
            Osm znaků otisku stačí, aby šlo poznat, že se obsah změnil.
            Verze se nikdy nepřepisují — kdyby šly, schválení by přestalo
            cokoli znamenat.
          </p>
        </div>

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}
