'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { VETA_JEN_NOVE } from '@/lib/sablony-text'
import { zkratkaDoSmeny } from '@/lib/sablony'
import { nabidnoutSablony, type NabidnutaSablona } from './sablony'
import { smazatSmenu, ulozitSmenu, type StavSmeny } from './smena'

export type SmenaKUprave = {
  id: string
  branch_id: string
  employee_id: string | null
  position_id: string | null
  shift_date: string
  starts_at: string
  ends_at: string
  note: string
  /*
    Vydaná směna se neMAŽE, ale RUŠÍ: řádek zůstane stát jako zrušený
    a lidem zmizí až vydáním rozpisu, kde se jim to ohlásí. Rozhoduje
    o tom databáze; tady se podle toho jen vybírá slovo na tlačítku.
  */
  published_at?: string | null
}

/**
 * Formulář na směnu — zakládání i úprava.
 *
 * Zadání docs/nocni-prace-2026-09-03.md, bod 2.
 *
 * ---------------------------------------------------------------------
 * NA TELEFONU CELÁ OBRAZOVKA
 *
 * Kalendář je hustý a bublina, do které se nedá trefit, je horší než
 * žádná. Pod 640 px se okno roztáhne přes celou plochu; nad ní je to
 * karta uprostřed.
 *
 * ---------------------------------------------------------------------
 * VAROVÁNÍ SE UKÁŽÍ PO ULOŽENÍ, NE MÍSTO NĚJ
 *
 * Překryv a začátek před provozním dnem směnu nezakazují. Okno proto
 * po uložení nezmizí hned — nejdřív řekne, co se stalo, a zavře se až
 * kliknutím. Kdyby zmizelo, varování by nikdo nepřečetl.
 *
 * ---------------------------------------------------------------------
 * ŠABLONA JEN PŘEDVYPLNÍ
 *
 * Výběr šablony nastaví časy a tím jeho práce končí. Pole zůstávají
 * obyčejná — přepsat je jde hned, bez odklikávání a bez odemykání.
 *
 * Zkratka se do směny opíše jen tehdy, když časy pořád odpovídají té
 * šabloně. Kdo je přepsal, uloží směnu bez zkratky: „D“ u směny od
 * devíti do pěti by v rozpisu lhalo. Je to na obrazovce vidět, ne jen
 * tady v komentáři.
 */
export default function FormularSmeny({
  rozsah,
  den,
  smena,
  pobocky,
  vychoziPobocka,
  lide,
  pozice,
  sablony: sablonyVychozi,
  onZavrit,
}: {
  rozsah: string
  /** Předvyplněné datum u nové směny. */
  den: string
  /** Když se upravuje. */
  smena?: SmenaKUprave | null
  pobocky: { id: string; nazev: string }[]
  vychoziPobocka: string | null
  lide: { id: string; jmeno: string }[]
  pozice: { id: string; label: string }[]
  /** Šablony pro výchozí pobočku, aby nabídka stála hned. */
  sablony: NabidnutaSablona[]
  onZavrit: () => void
}) {
  const router = useRouter()
  const [stav, akce, ceka] = useActionState<StavSmeny, FormData>(ulozitSmenu, {
    stav: 'nic',
  })
  /*
    MAZÁNÍ MÁ VLASTNÍ FORMULÁŘ, ne jen druhé tlačítko v tom prvním.

    Formuláře se nesmějí vnořovat, takže stojí až za tím hlavním —
    a je to i správně věcně: uložení a smazání jsou dvě různé věci
    a nemají sdílet stav ani hlášku.
  */
  const [stavSmazani, akceSmazat, cekaSmazani] = useActionState<
    StavSmeny,
    FormData
  >(smazatSmenu, { stav: 'nic' })
  // Ptá se to, než smaže. Rozpis se staví večer a jedno ťuknutí vedle
  // by sebralo směnu, kterou už někdo naplánoval.
  const [ptaSeNaSmazani, setPtaSeNaSmazani] = useState(false)
  const [zavreno, setZavreno] = useState(false)
  const prvni = useRef<HTMLSelectElement>(null)

  /*
    Pobočka a pozice řídí, které šablony platí, a časy se ze šablony
    přepisují — proto jsou tahle čtyři pole řízená. Zbytek formuláře
    zůstal neřízený; řídit se má jen to, co se má měnit samo.
  */
  const [pobocka, setPobocka] = useState(smena?.branch_id ?? vychoziPobocka ?? '')
  const [vybranaPozice, setVybranaPozice] = useState(smena?.position_id ?? '')
  const [od, setOd] = useState((smena?.starts_at ?? '08:00').slice(0, 5))
  const [doKdy, setDoKdy] = useState((smena?.ends_at ?? '16:00').slice(0, 5))
  const [sablony, setSablony] = useState<NabidnutaSablona[]>(sablonyVychozi)
  const [klic, setKlic] = useState('')

  /*
    Nabídku dodává databáze, ne prohlížeč — které pravidlo vyhraje, ví
    `app.sablona_poradi` a druhá kopie té úvahy v JavaScriptu by se
    rozešla. Viz hlavičku ./sablony.

    `zruseno` je proti přehození pořadí odpovědí: kdo přepne pobočku
    dvakrát rychle po sobě, nesmí dostat nabídku k té první.
  */
  useEffect(() => {
    let zruseno = false
    /*
      I „bez pobočky" jde přes Promise, ne přes rovnou `setSablony([])`.
      Nastavit stav uprostřed efektu spustí další vykreslení hned —
      a firma bez pobočky je stejně případ, který se sem nedostane
      (rozpis ji dřív odmítne).
    */
    const nacti = pobocka
      ? nabidnoutSablony(rozsah, pobocka, vybranaPozice || null)
      : Promise.resolve([])

    nacti
      .then((s) => {
        if (!zruseno) setSablony(s)
      })
      .catch(() => {
        // Šablona je pohodlí, ne podmínka. Když se nabídka nenačte,
        // časy se napíšou ručně a formulář funguje dál.
        if (!zruseno) setSablony([])
      })
    return () => {
      zruseno = true
    }
  }, [rozsah, pobocka, vybranaPozice])

  // Odvozené, ne uložené — proč, viz hlavičku lib/sablony.
  const klicDoSmeny = zkratkaDoSmeny(sablony, klic, od, doKdy)
  const casySedi = klicDoSmeny !== ''

  function vybratSablonu(k: string) {
    setKlic(k)
    const s = sablony.find((x) => x.klic === k)
    if (s) {
      setOd(s.od)
      setDoKdy(s.do)
    }
  }

  // Po uložení se rozpis překreslí hned; okno zůstane kvůli varováním.
  useEffect(() => {
    if (stav.stav === 'hotovo') router.refresh()
  }, [stav, router])

  /*
    Po smazání se okno ZAVŘE, na rozdíl od uložení. U uložení zůstává
    kvůli varováním — u smazání žádná nejsou a nechat otevřený formulář
    směny, která už neexistuje, by mátlo.
  */
  useEffect(() => {
    if (stavSmazani.stav === 'hotovo') {
      router.refresh()
      onZavrit()
    }
  }, [stavSmazani, router, onZavrit])

  useEffect(() => {
    prvni.current?.focus()
  }, [])

  function zavrit() {
    setZavreno(true)
    onZavrit()
  }

  // Po smazání se okno zavře odvozeně, ne nastavením stavu v efektu —
  // setState uvnitř efektu spouští kaskádu překreslení (eslint na to má
  // pravidlo) a je to i zbytečné: výsledek akce tu informaci nese sám.
  if (zavreno || stavSmazani.stav === 'hotovo') return null

  const hotovo = stav.stav === 'hotovo'

  /*
    Vydaná směna se neMAŽE, ale RUŠÍ — řádek zůstane stát jako zrušený
    a lidem zmizí až vydáním rozpisu. Rozhoduje o tom databáze
    (`public.smazat_smenu`); tohle je jen o tom, jaké slovo se ukáže,
    ať člověk ví, co se stane.
  */
  const jeVydana = Boolean(smena?.published_at)

  return (
    <div style={zaclona} role="dialog" aria-modal="true" aria-labelledby="smena-nadpis">
      <div style={okno}>
        <h2 id="smena-nadpis" style={nadpis}>
          {smena ? 'Upravit směnu' : 'Nová směna'}
        </h2>

        {hotovo ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--dobre)' }}>
              {smena ? 'Změna uložena.' : 'Směna přidána do rozpisu.'}
            </p>

            {/*
              Varování až tady, u výsledku. Kdyby se ukazovala předem,
              člověk by je odklikl dřív, než by měl co odklikávat.
            */}
            {stav.varovani.length > 0 ? (
              <ul style={varovaniSeznam}>
                {stav.varovani.map((v, i) => (
                  <li key={i} style={varovaniRadek}>
                    {v}
                  </li>
                ))}
              </ul>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={zavrit} className="ft-tl ft-tl-hlavni">
                Hotovo
              </button>
            </div>
          </>
        ) : (
          <form action={akce} style={{ display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            {smena ? <input type="hidden" name="smena" value={smena.id} /> : null}

            <label style={poleLabel}>
              <span>Kdo</span>
              <select
                ref={prvni}
                name="zamestnanec"
                defaultValue={smena?.employee_id ?? ''}
                style={pole}
              >
                {/*
                  Prázdné je platná volba, ne chybějící údaj: neobsazená
                  směna znamená „sem někoho potřebujeme“.
                */}
                <option value="">— zatím nikdo (volná směna) —</option>
                {lide.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.jmeno}
                  </option>
                ))}
              </select>
            </label>

            <label style={poleLabel}>
              <span>Zařazení</span>
              <select
                name="pozice"
                value={vybranaPozice}
                onChange={(e) => setVybranaPozice(e.target.value)}
                style={pole}
              >
                <option value="">— bez zařazení —</option>
                {pozice.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {pozice.length === 0 ? (
                <span style={vysvetlivka}>
                  Firma zatím žádnou pozici nemá. Založí se v Nastavení →
                  Pozice; směna jde uložit i bez ní.
                </span>
              ) : null}
            </label>

            <label style={poleLabel}>
              <span>Kde</span>
              <select
                name="pobocka"
                required
                value={pobocka}
                onChange={(e) => setPobocka(e.target.value)}
                style={pole}
              >
                {pobocky.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nazev}
                  </option>
                ))}
              </select>
            </label>

            <label style={poleLabel}>
              <span>Datum</span>
              <input
                name="den"
                type="date"
                required
                defaultValue={smena?.shift_date ?? den}
                style={pole}
              />
            </label>

            {/*
              Šablona stojí těsně nad časy, které vyplňuje. Kdyby byla
              nahoře u jména, nebylo by vidět, co vlastně udělala.
            */}
            {sablony.length > 0 ? (
              <label style={poleLabel}>
                <span>Šablona</span>
                <select
                  value={klic}
                  onChange={(e) => vybratSablonu(e.target.value)}
                  style={pole}
                >
                  <option value="">— vlastní časy —</option>
                  {sablony.map((s) => (
                    <option key={s.klic} value={s.klic}>
                      {s.klic} · {s.label} · {s.od}–{s.do}
                    </option>
                  ))}
                </select>
                <span style={vysvetlivka}>
                  Šablona jen vyplní časy. Přepsat je jde hned pod tím
                  a směna si je pak drží vlastní — {VETA_JEN_NOVE}
                </span>
              </label>
            ) : null}

            {/*
              Zkratka jde do směny jen tehdy, když časy pořád sedí.
              Odvozené z časů, ne z toho, na co se klikalo.
            */}
            <input type="hidden" name="sablona" value={klicDoSmeny} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={poleLabel}>
                <span>Od</span>
                <input
                  name="od"
                  type="time"
                  required
                  value={od}
                  onChange={(e) => setOd(e.target.value)}
                  style={pole}
                />
              </label>
              <label style={poleLabel}>
                <span>Do</span>
                <input
                  name="do"
                  type="time"
                  required
                  value={doKdy}
                  onChange={(e) => setDoKdy(e.target.value)}
                  style={pole}
                />
              </label>
            </div>

            {klic !== '' && !casySedi ? (
              <p style={vysvetlivka}>
                Časy jste přepsali, takže se směna uloží bez zkratky{' '}
                {klic}. Zkratka u směny s jinými časy by v rozpisu lhala.
              </p>
            ) : null}

            <p style={vysvetlivka}>
              Konec dřív než začátek znamená, že směna končí druhý den —
              22:00–06:00 je osm hodin, ne mínus šestnáct.
            </p>

            <label style={poleLabel}>
              <span>Poznámka</span>
              <input
                name="poznamka"
                maxLength={200}
                defaultValue={smena?.note ?? ''}
                placeholder="nepovinná"
                style={pole}
              />
            </label>

            {stav.stav === 'chyba' ? (
              <p className="hlaska-chyba">{stav.text}</p>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={zavrit} className="ft-tl ft-tl-vedlejsi">
                Zpět
              </button>
              <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
                {ceka ? 'Ukládám…' : smena ? 'Uložit změnu' : 'Přidat směnu'}
              </button>
            </div>
          </form>
        )}

        {/*
          SMAZAT / ZRUŠIT SMĚNU.

          Vlastní formulář za tím hlavním — vnořovat se nesmějí.
          Nabízí se u SKUTEČNĚ ULOŽENÉ směny (`smena.id` není prázdné;
          u nové se předává prázdný řetězec).

          NEVYDANÁ se smaže: nikdo ji neviděl, není co ohlašovat.
          VYDANÁ se označí jako zrušená a zůstane stát — lidem se pořád
          ukazuje vydaná podoba, takže jim zmizí až vydáním rozpisu,
          kde se to ohlásí.

          Do 9. 9. tu u vydané směny stálo, že smazat nejde. Byla to
          správná úvaha se špatným závěrem: rozpis se VYDÁ a teprve pak
          se v něm škrtá, takže odmítnutí u vydané znamenalo, že nešlo
          smazat prakticky nic.
        */}
        {!hotovo && smena?.id ? (
          <div style={mazaniPruh}>
            {ptaSeNaSmazani ? (
              <form action={akceSmazat} style={{ display: 'grid', gap: '8px' }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="smena" value={smena.id} />
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--ink)' }}>
                  <strong>
                    {jeVydana ? 'Zrušit tuhle směnu?' : 'Smazat tuhle směnu?'}
                  </strong>
                </p>
                {/*
                  U vydané se říká, KDY to lidi uvidí. Bez toho by to
                  vypadalo, že se nic nestalo — v jejich rozpisu směna
                  do vydání zůstane.
                */}
                {jeVydana ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                    Zůstane vidět jako zrušená a lidem zmizí, až rozpis
                    vydáte.
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="ft-tl" disabled={cekaSmazani}>
                    {cekaSmazani
                      ? jeVydana
                        ? 'Ruším…'
                        : 'Mažu…'
                      : jeVydana
                        ? 'Zrušit'
                        : 'Smazat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPtaSeNaSmazani(false)}
                    className="ft-tl ft-tl-vedlejsi"
                  >
                    Zpět
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setPtaSeNaSmazani(true)}
                className="ft-tl ft-tl-vedlejsi"
              >
                {jeVydana ? 'Zrušit směnu' : 'Smazat směnu'}
              </button>
            )}

            {stavSmazani.stav === 'chyba' ? (
              <p className="hlaska-chyba" style={{ marginTop: '8px' }}>
                {stavSmazani.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* --- styly ---------------------------------------------------------- */

const zaclona = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 70,
  background: 'rgba(0,0,0,.45)',
  display: 'grid',
  placeItems: 'center',
  padding: '0',
}

/*
  Na telefonu celá obrazovka, na širším okně karta uprostřed. Řeší se
  to jednotkami, ne dotazem na šířku: `min(560px, 100vw)` a
  `min(100dvh, …)` udělají totéž bez druhé sady stylů.
*/
const okno = {
  width: 'min(560px, 100vw)',
  maxHeight: '100dvh',
  overflowY: 'auto' as const,
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'clamp(0px, calc((100vw - 560px) * 100), 16px)',
  boxShadow: 'var(--shadow)',
  padding: '20px',
}

const nadpis = { margin: '0 0 14px', fontSize: '18px', color: 'var(--ink)' } as const

const poleLabel = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const vysvetlivka = {
  margin: 0,
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
  textTransform: 'none' as const,
  letterSpacing: 'normal',
} as const

const varovaniSeznam = {
  listStyle: 'none',
  margin: '0 0 14px',
  padding: 0,
  display: 'grid',
  gap: '8px',
} as const

const varovaniRadek = {
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const

/*
  Mazání je oddělené čarou a stojí až pod hlavními tlačítky — je to
  jiná třída akce než Uložit a nemá s nimi soutěžit o pozornost.
*/
const mazaniPruh = {
  marginTop: '16px',
  paddingTop: '12px',
  borderTop: '1px solid var(--line)',
}
