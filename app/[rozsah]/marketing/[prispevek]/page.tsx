import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KANALY, textProKanal } from '@/lib/marketing'
import { pravidlaKanalu, zkontrolovat } from '@/lib/marketing-kanaly'
import { popisStavu, popisStavuUlohy } from '@/lib/marketing-text'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden, seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { KBELIK, PLATNOST_ODKAZU_S } from '@/lib/marketing-media'
import { n8nJeNastaveny } from '@/lib/marketing-n8n'
import { aiJeNastavena } from '@/lib/marketing-ai'
import { naplanovat, navrhnoutText, pozadatOSchvaleni, rozhodnoutOSchvaleni, ulozitVerzi } from '../akce'

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
  borderRadius: 'var(--radius-lg)',
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
  branch_id: string
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
  media_ids: string[]
}

type Fotka = {
  id: string
  nazev_souboru: string
  cesta: string
  alt_text: string
  pouzitelne_do: string | null
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


export default async function DetailPrispevku({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; prispevek: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string; navrh?: string }>
}) {
  const { rozsah, prispevek: prispevekId } = await params
  const { ulozeno, chyba, navrh } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
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
      .select('id, branch_id, nazev, stav, kanaly, planovano_na, schvalena_verze_id, aktualni_verze_id')
      .eq('id', prispevekId).maybeSingle(),
  )
  // Cizí příspěvek schová RLS a vyjde prázdno — pro uživatele je to
  // totéž jako neexistující, a víc se mu říkat nemá.
  if (!p) notFound()

  const verze = await seznam<Verze>(
    'verze příspěvku',
    supabase.from('marketing_verze')
      .select('id, cislo, zadani, texty, otisk, poznamka, vytvoreno_kdy, media_ids')
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

  /*
    Knihovna fotek pobočky. Bez obrázku Instagram příspěvek nepřijme,
    takže výběr patří sem, ne na zvláštní obrazovku — kdo píše text,
    ten vybírá i fotku.

    Prošlé fotky se nabízejí taky, jen jsou označené. Kdyby zmizely,
    člověk by nevěděl, že fotka existuje a proč ji nemůže použít.
  */
  const knihovnaDotaz = await supabase
    .from('marketing_media')
    .select('id, nazev_souboru, cesta, alt_text, pouzitelne_do')
    .eq('tenant_id', tenantId)
    .is('archivovano_kdy', null)
    .order('vytvoreno_kdy', { ascending: false })
    .limit(60)

  const knihovna: Fotka[] = tabulkaNeexistuje(knihovnaDotaz.error)
    ? []
    : await seznam<Fotka>('knihovna fotek', Promise.resolve(knihovnaDotaz))

  const nahledy = new Map<string, string>()
  if (knihovna.length > 0) {
    const podepsane = await supabase.storage
      .from(KBELIK)
      .createSignedUrls(knihovna.map((f) => f.cesta), PLATNOST_ODKAZU_S)
    for (const s of podepsane.data ?? []) {
      if (s.signedUrl && s.path) nahledy.set(s.path, s.signedUrl)
    }
  }

  const vybrane = new Set(aktualni?.media_ids ?? [])

  const smiPsat = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const smiPublikovat = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'

  /*
    Nabízet „Zveřejnit" tam, kde zveřejnit nejde, znamená slíbit něco,
    co skončí pěti marnými pokusy a chybou. Obrazovka se proto zeptá
    dřív, než to nabídne.

    Ptá se na DVĚ věci a obě musí platit: že si firma nějaký nástroj
    na zveřejňování vybrala (obrazovka Nástroje, oddíl 3.1 zadání)
    a že je ten nástroj na serveru dotažený. Samotné nastavení n8n
    v prostředí nestačí — volba je zákazníkova, ne naše.
  */
  const pripojeniVen = await jeden<{ poskytovatel: string; rezim: string }>(
    'připojený nástroj na zveřejňování',
    supabase.from('marketing_pripojeni')
      .select('poskytovatel, rezim')
      .eq('tenant_id', tenantId)
      .eq('kategorie', 'publikovani')
      .is('odpojeno_kdy', null)
      .or(`branch_id.eq.${p.branch_id},branch_id.is.null`)
      .order('branch_id', { nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ).catch(() => null)

  const n8nHotovo =
    pripojeniVen !== null &&
    pripojeniVen.rezim !== 'rucni' &&
    (pripojeniVen.poskytovatel !== 'n8n' || n8nJeNastaveny())
  const aiHotova = aiJeNastavena()
  const jeSchvalena = p.schvalena_verze_id !== null && p.schvalena_verze_id === p.aktualni_verze_id

  return (
    <>
      <Nadpis oci="Marketing" popis={`Stav: ${popisStavu(p.stav)}`}>{p.nazev}</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '820px', display: 'grid', gap: '16px' }}>
        {ulozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p> : null}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {navrh ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Návrh je hotový — je níž jako nová verze. Přečtěte si ho a upravte, co nesedí.
          </p>
        ) : null}

        {/* --- AI NÁVRH --------------------------------------------- */}
        {/*
          Napsat zadání běžnou češtinou a nechat model připravit varianty.
          Zadání, oddíl 11.

          Bez připojené AI to nezmizí a nezešedne — vrátí se UKÁZKA
          viditelně označená jako ukázka. Skryté tlačítko by znamenalo,
          že se člověk nedozví, že ta možnost existuje.
        */}
        <form action={navrhnoutText} style={{ ...karta, display: 'grid', gap: '10px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="prispevek" value={p.id} />
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Nechat navrhnout</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              {aiHotova
                ? 'Napište běžnou češtinou, co má příspěvek říct. Vrátí se dvě až tři varianty jako nová verze.'
                : 'AI zatím není připojená — vrátí se ukázka označená jako ukázka, ne návrh od modelu.'}
            </p>
          </div>
          <label>
            <span style={popisek}>Co má příspěvek říct</span>
            <textarea
              name="pokyn"
              rows={3}
              style={{ ...pole, resize: 'vertical' }}
              placeholder="Například: pozvánka na svíčkovou v pátek, vaříme ji podle babiččiny receptury"
            />
          </label>
          <div>
            <button type="submit" className="tlacitko">Navrhnout</button>
          </div>
        </form>

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

          {/*
            KAŽDÁ SÍŤ MÁ SVŮJ TEXT A SVÁ PRAVIDLA.

            Do 14. 9. 2026 tu stálo `kanal === 'instagram' ? 'Instagram'
            : 'Facebook'` — cokoli jiného než Instagram se popsalo jako
            Facebook. A hlavně: u obou políček stálo totéž, ačkoli
            Instagram bez fotky příspěvek nepřijme a Facebook ano
            a strop popisku mají jiný (2 200 proti 5 000).

            Pravidla jsou v `lib/marketing-kanaly.ts` a nálezy se
            ukazujou TADY, ne až když se to nepovede odeslat. Dozvědět
            se o překročeném stropu z fronty po pěti neúspěšných
            pokusech je pozdě.
          */}
          {p.kanaly.map((kanal) => {
            const text = textProKanal(aktualni?.texty ?? {}, kanal)
            const pravidla = pravidlaKanalu(kanal)
            const nalezy = zkontrolovat({
              kanal,
              format: 'prispevek',
              text,
              // Fotky jsou na verzi, ne na kanálu — pro obě sítě tytéž.
              pocetFotek: aktualni?.media_ids?.length ?? 0,
            })

            return (
              <label key={kanal}>
                <span style={popisek}>
                  {pravidla?.nazev ?? kanal}
                  {pravidla ? (
                    <span style={{ color: 'var(--muted)' }}>
                      {' — '}{text.trim().length} z {pravidla.stropZnaku} znaků
                    </span>
                  ) : null}
                </span>
                <textarea
                  name={`text_${kanal}`}
                  rows={5}
                  defaultValue={text}
                  style={pole}
                  disabled={!smiPsat}
                  placeholder="Co dnes vaříme a proč se na to těšíme…"
                />
                {pravidla ? (
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
                    {pravidla.poznamka}
                  </span>
                ) : null}
                {/*
                  Prázdný text se tu ZÁMĚRNĚ nehlásí jako překážka —
                  u rozepsaného příspěvku je prázdno normální stav
                  a červená hláška u každého nového příspěvku by
                  zevšedněla. Odeslat se to bez textu stejně nedá,
                  hlídá to `lib/marketing-odeslani.ts`.
                */}
                {nalezy.filter((n) => text.trim() !== '' || !/chybí text/i.test(n.text)).map((n, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'block', fontSize: '12px', marginTop: '3px',
                      color: n.druh === 'nelze' ? 'var(--mosaz)' : 'var(--muted)',
                    }}
                  >
                    {n.druh === 'nelze' ? '⚠ ' : ''}{n.text}
                  </span>
                ))}
              </label>
            )
          })}

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={popisek}>
              Fotky — bez obrázku Instagram příspěvek nepřijme. První vybraná je titulní.
            </legend>

            {knihovna.length === 0 ? (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                V knihovně zatím nic není.{' '}
                <Link href={`/${rozsah}/marketing/media`}>Nahrát fotku</Link>
              </p>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                {knihovna.map((f) => (
                  <label
                    key={f.id}
                    style={{ display: 'grid', gap: '4px', width: '104px', fontSize: '12px', cursor: 'pointer' }}
                  >
                    {nahledy.get(f.cesta) ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={nahledy.get(f.cesta)}
                        alt={f.alt_text || f.nazev_souboru}
                        width={104}
                        height={104}
                        style={{ objectFit: 'cover', borderRadius: '8px', background: 'var(--bg)' }}
                      />
                    ) : (
                      <div style={{ width: '104px', height: '104px', borderRadius: '8px', background: 'var(--bg)' }} />
                    )}
                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        name="media"
                        value={f.id}
                        defaultChecked={vybrane.has(f.id)}
                        disabled={!smiPsat}
                      />
                      {jeProsla(f.pouzitelne_do) ? 'práva vypršela' : f.nazev_souboru.slice(0, 14)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

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
            <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
              <legend style={popisek}>Jak to má odejít</legend>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px' }}>
                <input type="radio" name="zpusob" value="zverejnit" defaultChecked={n8nHotovo} disabled={!n8nHotovo} />
                <span>
                  Zveřejnit
                  <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)' }}>
                    {n8nHotovo
                      ? 'Odejde v naplánovaný čas na síť.'
                      : pripojeniVen === null
                        ? 'Zatím nejde — v Marketing → Nástroje není vybraný nástroj na zveřejňování.'
                        : 'Zatím nejde — vybraný nástroj není na serveru dotažený. Podrobnosti jsou v Nástrojích.'}
                  </span>
                </span>
              </label>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px' }}>
                <input type="radio" name="zpusob" value="nanecisto" />
                <span>
                  Jen nanečisto
                  <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)' }}>
                    Projde celá cesta a nikam se nic neodešle. Na vyzkoušení.
                  </span>
                </span>
              </label>

              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px' }}>
                <input type="radio" name="zpusob" value="rucne" defaultChecked={!n8nHotovo} />
                <span>
                  Zveřejním ručně
                  <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)' }}>
                    Příspěvek se připraví a počká na člověka.
                  </span>
                </span>
              </label>
            </fieldset>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Naplánovat</button>
            </div>
          </form>
        ) : null}

        {ulohy.length > 0 ? (
          <div style={karta}>
            <h2 style={{ margin: '0 0 10px', fontSize: '16px' }}>Publikace</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
              {ulohy.map((u) => (
                <li key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', fontSize: '14px' }}>
                  <span>{KANALY.find((k) => k.klic === u.kanal)?.nazev ?? u.kanal}</span>
                  <span style={{ color: 'var(--muted)' }}>{popisStavuUlohy(u.stav)}</span>
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

/**
 * Prošlá práva k fotce.
 *
 * Jen popisek u zaškrtávátka. O tom, jestli fotka smí ven, rozhoduje
 * fronta v databázi podle provozního dne pobočky — počítat to na dvou
 * místech znamená, že se to jednou rozejde.
 */
function jeProsla(pouzitelneDo: string | null): boolean {
  if (!pouzitelneDo) return false
  return pouzitelneDo < new Date().toISOString().slice(0, 10)
}
