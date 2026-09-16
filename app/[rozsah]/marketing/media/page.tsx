import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { KBELIK, PLATNOST_ODKAZU_S, SBIRKY } from '@/lib/marketing-media'
import { sestavPouziti, type PouzitiFotky } from '@/lib/marketing-media-pouziti'
import { popisStavu } from '@/lib/marketing-text'
import { nahratFotku, smazatFotku, ulozitPrava } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Knihovna fotek.
 *
 * Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4.
 *
 * ---------------------------------------------------------------------
 * NÁHLEDY JDOU PŘES PODEPSANÝ ODKAZ
 *
 * Kbelík je soukromý (20260913120000_marketing_ulozne.sql), takže
 * přímá adresa souboru nefunguje a nemá. Odkaz na náhled se vydává
 * na hodinu a až poté, co databáze potvrdila, že na tu fotku vidíme.
 *
 * ---------------------------------------------------------------------
 * PRÁVA K POUŽITÍ JSOU TU VIDĚT, NE SCHOVANÁ
 *
 * `pouzitelne_do` rozhoduje, jestli fotka smí ven. Fotka po datu se
 * proto neschovává — ukáže se a je u ní napsané, že prošla. Kdyby
 * zmizela, člověk by ji hledal a nevěděl proč, a hlavně by nevěděl,
 * že příspěvek s ní se nezveřejní.
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
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '14px',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type Fotka = {
  id: string
  nazev_souboru: string
  cesta: string
  mime: string
  velikost_bajtu: number
  sirka: number | null
  vyska: number | null
  sbirka: string
  popis: string
  alt_text: string
  puvod: string
  souhlas_poznamka: string
  pouzitelne_do: string | null
  vytvoreno_kdy: string
}

export default async function Media({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; upravit?: string }>
}) {
  const { rozsah } = await params
  const { chyba, upravit } = await searchParams

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
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Knihovnu fotek vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  // Nahrávat a mazat smí jen `marketing.manage`. Kdo má jen čtení,
  // uvidí knihovnu bez ovládání — a databáze mu to nedovolí ani tak.
  const smiUpravovat = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'

  const supabase = await getServerSupabase()

  const dotaz = await supabase
    .from('marketing_media')
    .select('id, nazev_souboru, cesta, mime, velikost_bajtu, sirka, vyska, sbirka, popis, alt_text, puvod, souhlas_poznamka, pouzitelne_do, vytvoreno_kdy')
    .eq('tenant_id', tenantId)
    .is('archivovano_kdy', null)
    .order('vytvoreno_kdy', { ascending: false })
    .limit(200)

  if (tabulkaNeexistuje(dotaz.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Fotky</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Knihovna zatím není v databázi">
            Migrace marketingu ještě neproběhla. Nasazuje je Šéfík
            z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const fotky = await seznam<Fotka>('fotky knihovny', Promise.resolve(dotaz))

  /*
    Podepsané odkazy se berou na jeden zátah, ne fotku po fotce.
    Dvě stě samostatných volání by obrazovku natahovalo vteřiny.
  */
  const odkazy = new Map<string, string>()
  if (fotky.length > 0) {
    const podepsane = await supabase.storage
      .from(KBELIK)
      .createSignedUrls(fotky.map((f) => f.cesta), PLATNOST_ODKAZU_S)

    for (const p of podepsane.data ?? []) {
      if (p.signedUrl && p.path) odkazy.set(p.path, p.signedUrl)
    }
  }

  /*
    KDE SE FOTKA POUŽÍVÁ.
    `smazatFotku` maže doopravdy a nic nekontroluje (viz komentář tam) —
    tahle viditelnost je jediné, co varuje dřív, než rozpracovaný
    koncept zůstane s nefunkčním odkazem na fotku.
  */
  const pouziti = await seznam<{
    id: string; nazev: string; stav: string; aktualni_verze_id: string | null
  }>(
    'příspěvky',
    supabase.from('marketing_prispevky')
      .select('id, nazev, stav, aktualni_verze_id')
      .eq('tenant_id', tenantId)
      .not('aktualni_verze_id', 'is', null),
  ).catch(() => [])

  const verzeIds = pouziti.map((p) => p.aktualni_verze_id).filter((id): id is string => id !== null)
  const verze = verzeIds.length === 0
    ? []
    : await seznam<{ id: string; media_ids: string[] }>(
        'aktuální verze',
        supabase.from('marketing_verze').select('id, media_ids').in('id', verzeIds),
      ).catch(() => [])

  const pouzitiPodleFotky = sestavPouziti(
    pouziti.map((p) => ({ id: p.id, nazev: p.nazev, stav: p.stav, aktualniVerzeId: p.aktualni_verze_id })),
    verze.map((v) => ({ id: v.id, mediaIds: v.media_ids ?? [] })),
  )

  const kdePracuji = pristup.scope.branchId
    ? `Fotky se ukládají k provozovně ${pristup.scope.branchName ?? ''}.`
    : 'Fotky se ukládají celé firmě — hodí se na logo a ikony.'

  return (
    <>
      <Nadpis oci="Marketing" popis={kdePracuji}>Fotky</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        {smiUpravovat ? (
          <form action={nahratFotku} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nahrát fotku</h2>

            <label>
              <span style={popisek}>Soubor — JPEG, PNG nebo WebP</span>
              <input type="file" name="soubor" accept="image/jpeg,image/png,image/webp" required style={pole} />
            </label>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 160px' }}>
                <span style={popisek}>Sbírka</span>
                <select name="sbirka" defaultValue="jidla" style={pole}>
                  {SBIRKY.map((s) => (
                    <option key={s.klic} value={s.klic}>{s.nazev}</option>
                  ))}
                </select>
              </label>

              <label style={{ flex: '1 1 160px' }}>
                <span style={popisek}>Použitelné do — nechte prázdné, když to neomezuje nic</span>
                <input type="date" name="pouzitelne_do" style={pole} />
              </label>
            </div>

            <label>
              <span style={popisek}>Popis pro vás</span>
              <input name="popis" placeholder="Svíčková, čtvrteční menu" style={pole} />
            </label>

            <label>
              <span style={popisek}>
                Popis pro nevidomé — přečte ho odečítač obrazovky na Instagramu
              </span>
              <input name="alt_text" placeholder="Talíř svíčkové s knedlíkem a brusinkou" style={pole} />
            </label>

            <label>
              <span style={popisek}>Odkud fotka je — fotograf, host, vlastní telefon</span>
              <input name="puvod" style={pole} />
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Nahrát</button>
            </div>
          </form>
        ) : null}

        <section style={karta}>
          <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>
            V knihovně {fotky.length === 0 ? 'zatím nic není' : `je ${fotky.length} fotek`}
          </h2>

          {fotky.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Nahrajte první fotku. Bez ní se příspěvek na Instagram
              zveřejnit nedá — sítě text bez obrázku nepřijmou.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {fotky.map((f) => (
                <Radek
                  key={f.id}
                  fotka={f}
                  odkaz={odkazy.get(f.cesta)}
                  rozsah={rozsah}
                  smiUpravovat={smiUpravovat}
                  otevreno={upravit === f.id}
                  pouzitoV={pouzitiPodleFotky.get(f.id) ?? []}
                />
              ))}
            </div>
          )}
        </section>

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}

function Radek({
  fotka,
  odkaz,
  rozsah,
  smiUpravovat,
  otevreno,
  pouzitoV,
}: {
  fotka: Fotka
  odkaz: string | undefined
  rozsah: string
  smiUpravovat: boolean
  otevreno: boolean
  pouzitoV: PouzitiFotky[]
}) {
  const proslo = jeProsla(fotka.pouzitelne_do)

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px',
        display: 'grid',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {odkaz ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={odkaz}
            alt={fotka.alt_text || fotka.nazev_souboru}
            width={96}
            height={96}
            style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: 'var(--bg)' }}
          />
        ) : (
          <div
            style={{
              width: '96px', height: '96px', borderRadius: 'var(--radius-sm)', background: 'var(--bg)',
              display: 'grid', placeItems: 'center', fontSize: '12px', color: 'var(--muted)',
            }}
          >
            bez náhledu
          </div>
        )}

        <div style={{ flex: '1 1 240px', display: 'grid', gap: '4px' }}>
          <strong style={{ fontSize: '14.5px' }}>{fotka.nazev_souboru}</strong>
          <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
            {fotka.sirka && fotka.vyska ? `${fotka.sirka} × ${fotka.vyska} • ` : ''}
            {megabajty(fotka.velikost_bajtu)}
          </span>
          {fotka.popis ? <span style={{ fontSize: '13px' }}>{fotka.popis}</span> : null}

          {!fotka.alt_text ? (
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Chybí popis pro nevidomé.
            </span>
          ) : null}

          {fotka.pouzitelne_do ? (
            <span style={{ fontSize: '13px', color: proslo ? 'var(--chyba, crimson)' : 'inherit' }}>
              {proslo
                ? `Práva vypršela ${fotka.pouzitelne_do} — příspěvek s touhle fotkou se nezveřejní.`
                : `Použitelné do ${fotka.pouzitelne_do}.`}
            </span>
          ) : null}

          {/*
            Smazání je NEVRATNÉ a nic ho nehlídá (viz smazatFotku) — kdo
            se chystá smazat fotku, kterou drží rozpracovaný koncept,
            to má vidět TADY, ne až se příspěvek zlomí.
          */}
          {pouzitoV.length > 0 ? (
            <span style={{ fontSize: '13px', color: 'var(--mosaz)' }}>
              Použito v {pouzitoV.length === 1 ? '1 příspěvku' : `${pouzitoV.length} příspěvcích`}:{' '}
              {pouzitoV.map((p, i) => (
                <span key={p.prispevekId}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/${rozsah}/marketing/${p.prispevekId}`}>{p.nazev || 'bez názvu'}</Link>
                  {' '}({popisStavu(p.stav)})
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {smiUpravovat ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Link
              href={otevreno
                ? `/${rozsah}/marketing/media`
                : `/${rozsah}/marketing/media?upravit=${fotka.id}`}
              className="ft-tl ft-tl-male"
            >
              {otevreno ? 'Zavřít' : 'Práva'}
            </Link>
            <form action={smazatFotku}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="id" value={fotka.id} />
              <button
                type="submit"
                className="ft-tl ft-tl-male"
                title={pouzitoV.length > 0 ? 'Fotku drží rozpracovaný příspěvek — smazání ho nechá bez ní.' : undefined}
              >
                Smazat
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {otevreno && smiUpravovat ? (
        <form action={ulozitPrava} style={{ display: 'grid', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="id" value={fotka.id} />

          <label>
            <span style={popisek}>Odkud fotka je</span>
            <input name="puvod" defaultValue={fotka.puvod} style={pole} />
          </label>

          <label>
            <span style={popisek}>Poznámka ke svolení — kdo a kdy ho dal</span>
            <input name="souhlas_poznamka" defaultValue={fotka.souhlas_poznamka} style={pole} />
          </label>

          <label>
            <span style={popisek}>
              Použitelné do — po tomhle datu ji fronta ven nepustí
            </span>
            <input type="date" name="pouzitelne_do" defaultValue={fotka.pouzitelne_do ?? ''} style={pole} />
          </label>

          <div>
            <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">Uložit</button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

/**
 * Prošlá práva.
 *
 * Porovnává se s dneškem podle kalendáře, ne podle provozního dne.
 * Je to jen barva na obrazovce; o tom, jestli fotka smí ven, rozhoduje
 * fronta v databázi podle provozního dne pobočky. Kdyby se to počítalo
 * na dvou místech dvakrát, rozešlo by se to.
 */
function jeProsla(pouzitelneDo: string | null): boolean {
  if (!pouzitelneDo) return false
  return pouzitelneDo < new Date().toISOString().slice(0, 10)
}

function megabajty(bajtu: number): string {
  if (bajtu < 1024 * 1024) return `${Math.round(bajtu / 1024)} kB`
  return `${(bajtu / 1024 / 1024).toFixed(1)} MB`
}
