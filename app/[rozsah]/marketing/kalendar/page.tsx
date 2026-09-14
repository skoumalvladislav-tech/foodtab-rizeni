import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { denVPasmu, hodinaVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { KANALY } from '@/lib/marketing'
import {
  DNY_ZKRATKY,
  MEZERA_DNU,
  MOC_ZA_DEN,
  PILIRE,
  barvaPilire,
  dnyTydne,
  mezeObdobi,
  mrizkaMesice,
  nazevMesice,
  nazevTydne,
  popisPilire,
  posunDen,
  posunMesic,
  varovani,
  zaradDoDnu,
  type PrispevekVKalendari,
} from '@/lib/marketing-kalendar'
import { STAVY_PRISPEVKU, popisStavu } from '@/lib/marketing-text'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { presunoutTermin } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Kalendář obsahu.
 *
 * Zadání: master prompt, oddíl 15 a obrazovka 9 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NESTAČILO ŘEŠIT SEZNAMEM PŘÍSPĚVKŮ
 *
 * Termín se dosud nastavoval u jednoho příspěvku a nikde nebylo vidět,
 * co kdy půjde ven. Restaurace ale plánuje po týdnech: „ve čtvrtek
 * pozvánka na víkend, v neděli fotka z akce". V seznamu seřazeném
 * podle data se to přečíst nedá — chybí v něm prázdná místa, a právě
 * ta jsou na plánování nejdůležitější.
 *
 * ---------------------------------------------------------------------
 * VŠECHNO POČÍTÁNÍ JE V `lib/marketing-kalendar.ts`
 *
 * Tahle obrazovka jen kreslí. Mřížka měsíce, posun o měsíc a varování
 * jsou v knihovně, protože serverovou komponentu nejde ověřit Nodem —
 * a počítání s daty se dá zkazit tak, že to skoro vždycky vyjde.
 * Kontroly jsou v `scripts/marketing-kalendar.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PŘESUN TERMÍNU SE TU NEDĚLÁ, A NENÍ TO OPOMENUTÍ
 *
 * Zadání chce přetahování myší. Tady se termín mění proklikem do
 * příspěvku a je to schválně: naplánovat se smí jen SCHVÁLENÁ verze,
 * ke které existuje platné schválení, a musí být vybraný způsob
 * odeslání. To všechno ověřuje `naplanovat` v `../akce.ts`.
 *
 * Přetažení myší by muselo tytéž kontroly udělat znovu — a druhá kopie
 * pravidla o tom, co se smí zveřejnit, se dřív nebo později rozejde
 * s první. Až přetahování bude, musí volat `naplanovat`, ne psát do
 * tabulky samo.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const poleMale = {
  width: '100%',
  padding: '2px 4px',
  border: '1px solid var(--line)',
  borderRadius: '4px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '11px',
} as const

/** Stavy, které v kalendáři nemají co dělat. */
const SCHOVANE = ['archivovano', 'zamitnuto']

type Pohled = 'mesic' | 'tyden'

type Filtr = {
  pohled: Pohled
  den: string
  kanal: string
  stav: string
  pilir: string
}

/** Adresa kalendáře s upravenými filtry. Ostatní se nesou dál. */
function odkaz(rozsah: string, f: Filtr, zmena: Partial<Filtr>): string {
  const v = { ...f, ...zmena }
  const q = new URLSearchParams()
  if (v.pohled !== 'mesic') q.set('pohled', v.pohled)
  q.set('den', v.den)
  if (v.kanal) q.set('kanal', v.kanal)
  if (v.stav) q.set('stav', v.stav)
  if (v.pilir) q.set('pilir', v.pilir)
  return `/${rozsah}/marketing/kalendar?${q.toString()}`
}

export default async function Kalendar({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{
    pohled?: string; den?: string; kanal?: string; stav?: string; pilir?: string
    chyba?: string; presunuto?: string
  }>
}) {
  const { rozsah } = await params
  const q = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Kalendář obsahu vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  /*
    Přesouvat smí jen `marketing.publish` — totéž právo, kterým se
    plánuje. Kdo má jen `manage`, kalendář vidí a formulář ne.
  */
  const smiPresouvat = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  /*
    DNEŠEK SE BERE Z PÁSMA FIRMY, NE ZE SERVERU.

    `new Date().toISOString().slice(0,10)` by po 22:00 (v létě) ukázalo
    zítřek, protože server běží v UTC. Na kalendáři by to znamenalo, že
    se večer sám přepne na další den (pravidlo 11).
  */
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )
  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const dnes = denVPasmu(new Date(), zonaFirmy)

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (branchId: string) => zonaPobocky.get(branchId) ?? zonaFirmy

  const f: Filtr = {
    pohled: q.pohled === 'tyden' ? 'tyden' : 'mesic',
    // Neplatné datum z adresy nesmí položit obrazovku. Když nesedí
    // tvar, bere se dnešek — ne výjimka a prázdná stránka.
    den: /^\d{4}-\d{2}-\d{2}$/.test(q.den ?? '') ? q.den! : dnes,
    kanal: KANALY.some((k) => k.klic === q.kanal) ? q.kanal! : '',
    stav: q.stav && q.stav in STAVY_PRISPEVKU ? q.stav : '',
    pilir: PILIRE.some((p) => p.klic === q.pilir) ? q.pilir! : '',
  }

  const dny = f.pohled === 'tyden'
    ? dnyTydne(f.den)
    : mrizkaMesice(f.den).flat().map((d) => d.datum)

  const meze = mezeObdobi(dny[0], dny[dny.length - 1])

  let dotaz = supabase.from('marketing_prispevky')
    .select('id, nazev, stav, pilir, kanaly, planovano_na, branch_id')
    .eq('tenant_id', tenantId)
    .not('planovano_na', 'is', null)
    .gte('planovano_na', meze.od)
    .lte('planovano_na', meze.do)
    .not('stav', 'in', `(${SCHOVANE.join(',')})`)
    .order('planovano_na')

  if (f.stav) dotaz = dotaz.eq('stav', f.stav)
  if (f.pilir) dotaz = dotaz.eq('pilir', f.pilir)
  // Kanál je pole, takže `contains` — `eq` by hledalo příspěvek,
  // který má PRÁVĚ TENHLE jediný kanál.
  if (f.kanal) dotaz = dotaz.contains('kanaly', [f.kanal])

  const naplanovane = await seznam<PrispevekVKalendari>('naplánované příspěvky', dotaz)

  const podleDne = zaradDoDnu(naplanovane, (okamzik, branchId) =>
    denVPasmu(okamzik, zona(branchId)))

  /*
    KONCEPTY BEZ DATA.

    Zadání, oddíl 15: „koncept bez data". Kdyby se nezobrazily, byly by
    neviditelné — v kalendáři nejsou a v seznamu příspěvků se ztratí
    mezi hotovými. Přitom je to zásoba práce, kterou stačí naplánovat.
  */
  const bezData = await seznam<PrispevekVKalendari>(
    'koncepty bez termínu',
    supabase.from('marketing_prispevky')
      .select('id, nazev, stav, pilir, kanaly, planovano_na, branch_id')
      .eq('tenant_id', tenantId)
      .is('planovano_na', null)
      .not('stav', 'in', `(${SCHOVANE.join(',')})`)
      .order('zmeneno_kdy', { ascending: false })
      .limit(12),
  )

  const nalezy = varovani(dny, podleDne)
  const vObdobi = dny.reduce((n, d) => n + (podleDne.get(d)?.length ?? 0), 0)

  const dnesniOdkaz = odkaz(rozsah, f, { den: dnes })
  const zpet = f.pohled === 'mesic' ? posunMesic(f.den, -1) : posunDen(f.den, -7)
  const vpred = f.pohled === 'mesic' ? posunMesic(f.den, 1) : posunDen(f.den, 7)

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={f.pohled === 'mesic' ? nazevMesice(f.den) : nazevTydne(f.den)}
        vpravo={
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link href={odkaz(rozsah, f, { den: zpet })} className="ft-tl ft-tl-male" aria-label="Předchozí období">←</Link>
            <Link href={dnesniOdkaz} className="ft-tl ft-tl-male">Dnes</Link>
            <Link href={odkaz(rozsah, f, { den: vpred })} className="ft-tl ft-tl-male" aria-label="Další období">→</Link>
            <Link
              href={odkaz(rozsah, f, { pohled: 'mesic' })}
              className={`ft-tl ft-tl-male${f.pohled === 'mesic' ? ' ft-tl-hlavni' : ''}`}
            >Měsíc</Link>
            <Link
              href={odkaz(rozsah, f, { pohled: 'tyden' })}
              className={`ft-tl ft-tl-male${f.pohled === 'tyden' ? ' ft-tl-hlavni' : ''}`}
            >Týden</Link>
          </div>
        }
      >
        Kalendář obsahu
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>

        {q.chyba ? <p className="hlaska-chyba">{q.chyba}</p> : null}
        {q.presunuto ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Termín přesunut — i u čekající publikace, ne jen v kalendáři.
          </p>
        ) : null}

        {/* --- FILTRY ------------------------------------------------ */}

        <div style={{ ...karta, display: 'grid', gap: '10px' }}>
          <Radek
            nazev="Kanál"
            polozky={KANALY.map((k) => ({ klic: k.klic, nazev: k.nazev }))}
            vybrane={f.kanal}
            odkazNa={(klic) => odkaz(rozsah, f, { kanal: klic })}
          />
          <Radek
            nazev="Pilíř"
            polozky={PILIRE.map((p) => ({ klic: p.klic, nazev: p.nazev, barva: p.barva }))}
            vybrane={f.pilir}
            odkazNa={(klic) => odkaz(rozsah, f, { pilir: klic })}
          />
          <Radek
            nazev="Stav"
            polozky={Object.entries(STAVY_PRISPEVKU)
              .filter(([k]) => !SCHOVANE.includes(k))
              .map(([klic, nazev]) => ({ klic, nazev }))}
            vybrane={f.stav}
            odkazNa={(klic) => odkaz(rozsah, f, { stav: klic })}
          />
        </div>

        {/* --- VAROVÁNÍ ---------------------------------------------- */}

        {nalezy.length > 0 ? (
          <div style={{ ...karta, display: 'grid', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Co stojí za pozornost</h2>
            {nalezy.map((v, i) => (
              <p key={i} style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {v.druh === 'mezera'
                  ? `Mezi ${denACas(v.od)} a ${denACas(v.do)} nejde ven nic — ${v.dnu} dnů ticha.`
                  : `${denACas(v.od)}: ${v.kolik} příspěvků v jeden den.`}
              </p>
            ))}
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              {/*
                VÝCHOZÍ PRAVIDLA SE PŘIZNÁVAJÍ. Zadání (oddíl 15) chce
                doporučený čas až podle vlastních dat a do té doby
                „transparentní výchozí pravidla". Tohle je to přiznání:
                čísla nejsou změřená, jsou zvolená.
              */}
              Měří se jen podle výchozích pravidel — ticho delší než {MEZERA_DNU} dnů
              a víc než {MOC_ZA_DEN} příspěvky za den. Až bude dost vlastních čísel,
              nahradí je změřená.
            </p>
          </div>
        ) : null}

        {/* --- MŘÍŽKA ------------------------------------------------ */}

        <div style={{ ...karta, overflowX: 'auto' }}>
          <div style={{ minWidth: f.pohled === 'mesic' ? '640px' : '520px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px' }}>
              {DNY_ZKRATKY.map((d) => (
                <div key={d} style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {d}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
              {(f.pohled === 'mesic'
                ? mrizkaMesice(f.den).flat()
                : dnyTydne(f.den).map((d) => ({ datum: d, vMesici: true }))
              ).map((bunka) => {
                const vDen = podleDne.get(bunka.datum) ?? []
                const jeDnes = bunka.datum === dnes

                return (
                  <div
                    key={bunka.datum}
                    style={{
                      minHeight: f.pohled === 'mesic' ? '92px' : '200px',
                      padding: '6px',
                      borderRadius: '8px',
                      border: jeDnes ? '1px solid var(--mosaz)' : '1px solid var(--line)',
                      // Dny cizího měsíce se kreslí, ale zeslabeně —
                      // prázdná buňka vypadá jako díra a člověk neví,
                      // jestli tam nic není, nebo se tam nedá kliknout.
                      opacity: bunka.vMesici ? 1 : 0.45,
                      display: 'grid',
                      gap: '4px',
                      alignContent: 'start',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: jeDnes ? 'var(--mosaz)' : 'var(--muted)' }}>
                      {Number(bunka.datum.slice(-2))}
                    </div>

                    {vDen.map((p) => (
                      <Link
                        key={p.id}
                        href={`/${rozsah}/marketing/${p.id}`}
                        style={{
                          display: 'block',
                          fontSize: '12px',
                          lineHeight: 1.25,
                          padding: '3px 5px',
                          borderRadius: '5px',
                          background: 'var(--bg)',
                          // Pilíř je proužek vlevo, ne výplň. Výplní by
                          // se šest barev na jedné obrazovce praly
                          // a text na nich by nebyl čitelný na všech.
                          borderLeft: `3px solid ${barvaPilire(p.pilir)}`,
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                        title={`${p.nazev} — ${popisStavu(p.stav)}, ${popisPilire(p.pilir)}`}
                      >
                        <span style={{ display: 'block', color: 'var(--muted)', fontSize: '11px' }}>
                          {p.planovano_na ? hodinaVPasmu(p.planovano_na, zona(p.branch_id)) : ''}
                          {pobocky.length > 1 ? ` · ${nazevPobocky.get(p.branch_id) ?? ''}` : ''}
                        </span>
                        <span style={{ display: 'block' }}>{p.nazev}</span>
                        {f.pohled === 'tyden' ? (
                          <span style={{ display: 'block', color: 'var(--muted)', fontSize: '11px' }}>
                            {popisStavu(p.stav)}
                          </span>
                        ) : null}
                      </Link>
                    ))}

                    {/*
                      PŘESUN JE JEN V TÝDENNÍM POHLEDU.

                      V měsíčním má buňka devadesát bodů na výšku a
                      formulář s datem, časem a tlačítkem by z ní udělal
                      nečitelnou tlačenici. Kdo přesouvá, dívá se na
                      týden — tam se plánuje.

                      Není to přetahování myší, jak chce zadání. Důvod
                      je v hlavičce souboru: přetažení musí volat tutéž
                      akci, ne psát do tabulky samo.
                    */}
                    {f.pohled === 'tyden' && smiPresouvat && vDen.length > 0 ? (
                      <details style={{ fontSize: '11px', marginTop: '2px' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Přesunout</summary>
                        {vDen.map((p) => (
                          <form key={p.id} action={presunoutTermin} style={{ display: 'grid', gap: '3px', marginTop: '4px' }}>
                            <input type="hidden" name="rozsah" value={rozsah} />
                            <input type="hidden" name="prispevek" value={p.id} />
                            <input type="hidden" name="zpet" value={odkaz(rozsah, f, {})} />
                            <span style={{ color: 'var(--muted)' }}>{p.nazev}</span>
                            <input type="date" name="datum" defaultValue={bunka.datum} style={poleMale} required />
                            <input
                              type="time"
                              name="cas"
                              defaultValue={p.planovano_na ? hodinaVPasmu(p.planovano_na, zona(p.branch_id)) : '12:00'}
                              style={poleMale}
                              required
                            />
                            <button type="submit" className="ft-tl ft-tl-male">Přesunout</button>
                          </form>
                        ))}
                      </details>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* --- LEGENDA A SOUHRN -------------------------------------- */}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: 'var(--muted)' }}>
          <span>{vObdobi === 0 ? 'V tomhle období nic naplánovaného není.' : `${vObdobi} naplánováno`}</span>
          {PILIRE.map((p) => (
            <span key={p.klic} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: p.barva }} />
              {p.nazev}
            </span>
          ))}
        </div>

        {/* --- BEZ TERMÍNU ------------------------------------------- */}

        {bezData.length > 0 ? (
          <section style={{ ...karta, display: 'grid', gap: '8px' }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Bez termínu</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Rozpracované, které zatím nemají den. Termín se nastavuje
                v příspěvku — schválené verzi, ne konceptu.
              </p>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {bezData.map((p) => (
                <li key={p.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '6px', fontSize: '14px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                    background: barvaPilire(p.pilir), marginRight: '6px',
                  }} />
                  <Link href={`/${rozsah}/marketing/${p.id}`}>{p.nazev}</Link>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {' · '}{popisStavu(p.stav)}
                    {pobocky.length > 1 ? ` · ${nazevPobocky.get(p.branch_id) ?? ''}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}

/** „14. 9." — jen den do věty o varování. */
function denACas(datum: string): string {
  const [, m, d] = datum.split('-')
  return `${Number(d)}. ${Number(m)}.`
}

/** Řádek filtru: „vše" a k tomu volby. */
function Radek({
  nazev,
  polozky,
  vybrane,
  odkazNa,
}: {
  nazev: string
  polozky: { klic: string; nazev: string; barva?: string }[]
  vybrane: string
  odkazNa: (klic: string) => string
}) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '12px', color: 'var(--muted)', minWidth: '46px' }}>{nazev}</span>
      <Link
        href={odkazNa('')}
        className={`ft-tl ft-tl-male${vybrane === '' ? ' ft-tl-hlavni' : ''}`}
      >Vše</Link>
      {polozky.map((p) => (
        <Link
          key={p.klic}
          href={odkazNa(p.klic)}
          className={`ft-tl ft-tl-male${vybrane === p.klic ? ' ft-tl-hlavni' : ''}`}
        >
          {p.barva ? (
            <span style={{
              display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
              background: p.barva, marginRight: '5px',
            }} />
          ) : null}
          {p.nazev}
        </Link>
      ))}
    </div>
  )
}
