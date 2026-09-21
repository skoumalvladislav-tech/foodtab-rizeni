'use client'

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import Ikona from '@/app/[rozsah]/ikona'
import type { IkonaKlic } from '@/app/[rozsah]/nabidka'
import Drawer from '@/components/ui/Drawer'
import { VETA_JEN_NOVE } from '@/lib/sablony-text'
import { zkratkaDoSmeny } from '@/lib/sablony'
import { ukazatZarazeni, zarazeniProUlozeni } from '@/lib/smeny-formular'
import { denVTydnu, hodinyKratce, minutSmeny, ZKRATKY_DNU } from '@/lib/rozpis-mobil'
import HlavickaSmeny, { type KontextSmeny } from './desktop/hlavicka-smeny'
import { ListMobil } from './mobil/sheet'
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
  /*
    Trhaná směna (Šéfík 16.9.2026, migrace 20260916200000) — pauza
    uvnitř směny, ne druhá oddělená směna. NULL/NULL = směna trhaná
    není. Jen plán, do mzdy nezasahuje (tu řeší paušální odpočet).
  */
  pauza_od: string | null
  pauza_do: string | null
}

/**
 * Co se předvyplní do NOVÉ směny — při duplikaci směny nebo při zadání
 * směny ze seznamu konkrétnímu člověku. Není to úprava: nemá `id`, takže
 * se pořád zakládá nový řádek.
 */
export type PredvyplneniSmeny = {
  employee_id?: string | null
  position_id?: string | null
  branch_id?: string
  starts_at?: string
  ends_at?: string
  note?: string
  pauza_od?: string | null
  pauza_do?: string | null
}

/**
 * Co formulář předá, když se má hned po směně zakládat další: datum právě
 * uložené směny, předvyplnění (člověk, pobočka, časy, pauza) a věta o tom,
 * co se uložilo — ukáže se nad novým formulářem, ať člověk ví, že to prošlo.
 */
export type DalsiSmena = {
  datum: string
  predvyplneni: PredvyplneniSmeny
  ulozeno: string
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
 * žádná. Na počítači proto formulář jede ve sdíleném `Drawer`
 * (components/ui/Drawer) jako boční panel.
 *
 * Na telefonu (`varianta="list"`, rozhoduje rozpis podle šířky) je to
 * celoobrazovková stránka se šipkou zpět, poli s ikonami a pevným
 * tlačítkem „Uložit směnu“ dole — podle mockupu Směn z 19.9.2026. LOGIKA
 * JE TATÁŽ (šablony, pauza, varování, akce `ulozitSmenu`); mění se jen
 * obal, pořadí a vzhled polí. Nikdy se tu nemá objevit druhá kopie
 * ukládání.
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
  zarazeniVeFormulari = true,
  sablony: sablonyVychozi,
  onZavrit,
  varianta = 'drawer',
  predvyplneni,
  zamerit,
  kontext,
  onDuplikovat,
  dole,
  souctyTydne,
  onDalsiDen,
  potvrzeni,
}: {
  rozsah: string
  /** Předvyplněné datum u nové směny. */
  den: string
  /** Když se upravuje. */
  smena?: SmenaKUprave | null
  pobocky: { id: string; nazev: string }[]
  vychoziPobocka: string | null
  /** `poziceId` = zařazení člověka; bere se, když je výběr zařazení schovaný (Nastavení → Směny). */
  lide: { id: string; jmeno: string; poziceId?: string | null }[]
  pozice: { id: string; label: string }[]
  /**
   * Nabízet výběr zařazení (pozice)? Nastavení firmy. Vypnuté ho schová a směna si vezme
   * zařazení zaměstnance; u neobsazené směny se nabízí vždy (`lib/smeny-formular.ts`).
   */
  zarazeniVeFormulari?: boolean
  /** Šablony pro výchozí pobočku, aby nabídka stála hned. */
  sablony: NabidnutaSablona[]
  onZavrit: () => void
  /** `list` = celoobrazovková stránka na telefonu, jinak boční panel. */
  varianta?: 'drawer' | 'list'
  /** Předvyplnění nové směny (duplikace, zadání konkrétnímu člověku). */
  predvyplneni?: PredvyplneniSmeny | null
  /** Kam po otevření přesunout kurzor. Na telefonu se jinak nezaměřuje nic. */
  zamerit?: 'poznamka'
  /** Panel na počítači: kdo a v jakém stavu (hlavička nad formulářem). */
  kontext?: KontextSmeny
  /** Panel na počítači: „Duplikovat směnu“. Bez něj se tlačítko nekreslí. */
  onDuplikovat?: () => void
  /** Panel na počítači: co se kreslí pod formulářem (docházka k téhle směně). */
  dole?: ReactNode
  /**
   * Kolik minut má člověk v zobrazeném týdnu naplánováno, bez směny
   * `ignorovat` (ta se právě upravuje). `null` = datum je mimo načtené dny,
   * součet se nezná — a proto se neukazuje.
   */
  souctyTydne?: (zamestnanec: string, den: string, ignorovat: string | null) => number | null
  /**
   * Panel na počítači u NOVÉ směny: „Uložit a přidat další den“. Po uložení
   * (bez varování) se místo výsledku otevře nový formulář; s varováním se
   * výsledek ukáže a další den nabídne tlačítkem. Bez toho se nic nekreslí.
   */
  onDalsiDen?: (dalsi: DalsiSmena) => void
  /** Věta nad formulářem: co se právě uložilo, když sem člověk přišel z „přidat další den“. */
  potvrzeni?: string
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
  const poznamkaRef = useRef<HTMLInputElement>(null)
  /*
    `mobil` je jen to, co je opravdu telefon: celoobrazovkový obal,
    pevné tlačítko dole, mazání v detailu. Pole (s ikonou), popisky a
    pořadí jsou pro telefon i panel na počítači totéž — podle mockupu
    Směn. Dvě podoby téhož formuláře se vždycky rozejdou.
  */
  const mobil = varianta === 'list'
  const S = STYL_POLE
  const poradi = (n: number) => ({ order: n })

  /*
    Zdroj výchozích hodnot: upravovaná směna, jinak předvyplnění (kopie
    směny, zadání ze seznamu), jinak prázdno. Na `smena` (ne na zdroj) se
    dál váže všechno, co znamená ÚPRAVU: skryté `id`, slovo na tlačítku,
    smazání.
  */
  const zdroj = smena ?? predvyplneni ?? null

  /*
    Pobočka a pozice řídí, které šablony platí, a časy se ze šablony
    přepisují — proto jsou tahle čtyři pole řízená. Zbytek formuláře
    zůstal neřízený; řídit se má jen to, co se má měnit samo.
  */
  const [pobocka, setPobocka] = useState(zdroj?.branch_id ?? vychoziPobocka ?? '')
  /*
    Zaměstnanec a datum se řídí kvůli průběžnému součtu hodin pod časy —
    vedoucí při zadávání hned vidí, kolik má člověk v týdnu naplánováno
    a kolik bude mít s touhle směnou.
  */
  const [zamestnanec, setZamestnanec] = useState(zdroj?.employee_id ?? '')
  const [datum, setDatum] = useState(smena?.shift_date ?? den)
  const [vybranaPozice, setVybranaPozice] = useState(zdroj?.position_id ?? '')
  /*
    Zařazení se nemusí vybírat: zaměstnanci jsou zařazeni od začátku a změna
    se dá napsat do poznámky (Šéfík 20. 9. 2026). Kdo pole nepotřebuje, vypne ho
    v Nastavení → Směny; `pouzitaPozice` je pak zařazení zaměstnance. Šablony
    i uložení jedou podle ní, ne podle skrytého pole.
  */
  const ukazano = ukazatZarazeni(zarazeniVeFormulari, Boolean(zamestnanec))
  const pouzitaPozice = zarazeniProUlozeni({
    ukazano,
    vybrana: vybranaPozice,
    poziceZamestnance: lide.find((c) => c.id === zamestnanec)?.poziceId,
    poziceSmeny: zdroj?.employee_id === zamestnanec ? zdroj?.position_id : '',
  })
  const [od, setOd] = useState((zdroj?.starts_at ?? '08:00').slice(0, 5))
  const [doKdy, setDoKdy] = useState((zdroj?.ends_at ?? '16:00').slice(0, 5))
  const [sablony, setSablony] = useState<NabidnutaSablona[]>(sablonyVychozi)
  const [klic, setKlic] = useState('')

  /*
    Trhaná směna — pauza uvnitř, ne druhá oddělená směna (Šéfík
    16.9.2026). Zaškrtávátko řídí, jestli se pole vůbec posílají:
    odškrtnuté pošle prázdno a `ulozitSmenu` z toho udělá NULL/NULL,
    stejně jako u nové směny bez pauzy.
  */
  const [trhana, setTrhana] = useState(Boolean(zdroj?.pauza_od && zdroj?.pauza_do))
  const [pauzaOd, setPauzaOd] = useState((zdroj?.pauza_od ?? '').slice(0, 5))
  const [pauzaDo, setPauzaDo] = useState((zdroj?.pauza_do ?? '').slice(0, 5))

  /*
    „Uložit a přidat další den“. Druhé odesílací tlačítko jen poznamená, že
    po uložení se má otevřít další směna; hlavní tlačítko to zase zruší
    (včetně odeslání Enterem, které klikne na první odesílací tlačítko).
    Co se uložilo, se bere z polí v okamžiku kliknutí — to je totéž, co
    odešlo na server.
  */
  const dalsiRef = useRef<DalsiSmena | null>(null)
  const dalsiPodklady = (): DalsiSmena => ({
    datum,
    predvyplneni: {
      employee_id: zamestnanec || null,
      position_id: pouzitaPozice || null,
      branch_id: pobocka || undefined,
      starts_at: od,
      ends_at: doKdy,
      pauza_od: trhana && pauzaOd ? pauzaOd : null,
      pauza_do: trhana && pauzaDo ? pauzaDo : null,
    },
    ulozeno: `${ZKRATKY_DNU[denVTydnu(datum)][0]}${ZKRATKY_DNU[denVTydnu(datum)][1].toLowerCase()} ${Number(datum.slice(8, 10))}. ${Number(datum.slice(5, 7))}., ${od}–${doKdy}`,
  })

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
      ? nabidnoutSablony(rozsah, pobocka, pouzitaPozice || null)
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
  }, [rozsah, pobocka, pouzitaPozice])

  // Odvozené, ne uložené — proč, viz hlavičku lib/sablony.
  const klicDoSmeny = zkratkaDoSmeny(sablony, klic, od, doKdy)
  const casySedi = klicDoSmeny !== ''

  /*
    Průběžný součet: co má člověk v týdnu bez téhle směny → s ní. Nová
    délka se počítá týmž výpočtem jako všude jinde (`minutSmeny`: směna
    přes půlnoc je kladná, pauza uvnitř se odečte).
  */
  const predSmenou =
    souctyTydne && zamestnanec && datum ? souctyTydne(zamestnanec, datum, smena?.id || null) : null
  const novychMinut =
    od && doKdy
      ? minutSmeny({
          starts_at: od,
          ends_at: doKdy,
          pauza_od: trhana && pauzaOd ? pauzaOd : null,
          pauza_do: trhana && pauzaDo ? pauzaDo : null,
        })
      : 0

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

  // Uložení přes „a přidat další den“ bez varování rovnou otevře další směnu.
  // S varováním se zůstane u výsledku — nikdo by ho nestihl přečíst.
  useEffect(() => {
    if (stav.stav !== 'hotovo' || stav.varovani.length > 0) return
    const dalsi = dalsiRef.current
    if (!dalsi || !onDalsiDen) return
    dalsiRef.current = null
    onDalsiDen(dalsi)
  }, [stav, onDalsiDen])

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

  // Na telefonu se nezaměřuje nic samo — výběr by hned otevřel nabídku
  // nebo klávesnici a zakryl polovinu formuláře.
  useEffect(() => {
    if (zamerit === 'poznamka') poznamkaRef.current?.focus()
    else if (!mobil) prvni.current?.focus()
  }, [zamerit, mobil])

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

  const telo = (
    <>
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
            {!smena?.id && onDalsiDen ? (
              <button type="button" onClick={() => onDalsiDen(dalsiPodklady())} className="ft-tl ft-tl-vedlejsi">
                Přidat další den
              </button>
            ) : null}
            <button type="button" onClick={zavrit} className="ft-tl ft-tl-hlavni">
              Hotovo
            </button>
          </div>
        </>
      ) : (
        <form
          id={ID_FORMULARE}
          action={akce}
          style={{ display: 'grid', gap: '16px' }}
        >
          {potvrzeni ? (
            <p role="status" className="ds-smd-form-potvrzeni">
              <Ikona klic="fajfka" velikost={14} />
              Uloženo: {potvrzeni}
            </p>
          ) : null}
          <input type="hidden" name="rozsah" value={rozsah} />
          {smena ? <input type="hidden" name="smena" value={smena.id} /> : null}

          <label style={{ ...S.label, ...poradi(1) }}>
            <span>Zaměstnanec</span>
            <Pole ikona="clovek" sipka>
              <select
                ref={prvni}
                name="zamestnanec"
                value={zamestnanec}
                onChange={(e) => setZamestnanec(e.target.value)}
                style={S.pole}
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
            </Pole>
          </label>

          {ukazano ? (
          <label style={{ ...S.label, ...poradi(8) }}>
            <span>Úsek / pozice</span>
            <Pole ikona="vidlicka" sipka>
              <select
                name="pozice"
                value={vybranaPozice}
                onChange={(e) => setVybranaPozice(e.target.value)}
                style={S.pole}
              >
                <option value="">— bez zařazení —</option>
                {pozice.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Pole>
            {pozice.length === 0 ? (
              <span style={vysvetlivka}>
                Firma zatím žádnou pozici nemá. Založí se v Nastavení →
                Pozice; směna jde uložit i bez ní.
              </span>
            ) : null}
          </label>
          ) : (
            // Schované pole: zařazení zaměstnance jde dál stejným jménem, ať ho `ulozitSmenu` čte jako dřív.
            <input type="hidden" name="pozice" value={pouzitaPozice} />
          )}

          <label style={{ ...S.label, ...poradi(9) }}>
            <span>Pobočka</span>
            <Pole ikona="pobocka" sipka>
              <select
                name="pobocka"
                required
                value={pobocka}
                onChange={(e) => setPobocka(e.target.value)}
                style={S.pole}
              >
                {pobocky.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nazev}
                  </option>
                ))}
              </select>
            </Pole>
          </label>

          <label style={{ ...S.label, ...poradi(2) }}>
            <span>Datum</span>
            <Pole ikona="kalendar">
              <input
                name="den"
                type="date"
                required
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
                style={S.pole}
              />
            </Pole>
          </label>

          {/*
            Šablona stojí těsně nad časy, které vyplňuje. Kdyby byla
            nahoře u jména, nebylo by vidět, co vlastně udělala.
          */}
          {sablony.length > 0 ? (
            <label style={{ ...S.label, ...poradi(3) }}>
              <span>Šablona</span>
              <Pole ikona="seznam" sipka>
                <select
                  value={klic}
                  onChange={(e) => vybratSablonu(e.target.value)}
                  style={S.pole}
                >
                  <option value="">— vlastní časy —</option>
                  {sablony.map((s) => (
                    <option key={s.klic} value={s.klic}>
                      {s.klic} · {s.label} · {s.od}–{s.do}
                    </option>
                  ))}
                </select>
              </Pole>
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

          {/*
            Jedno pole „Čas od – do“ s hodinami vlevo, jako v mockupu —
            telefon i panel na počítači. Pole se jmenují stejně (`od`,
            `do`), takže akce nic nepozná. Krátké: dva časy nepotřebují
            šířku celého panelu.
          */}
          <div className="ds-sm-cas" style={{ ...S.label, ...poradi(4) }} role="group" aria-labelledby={ID_CAS}>
            <span id={ID_CAS}>Čas od – do</span>
            <Pole ikona="hodiny">
              <input
                name="od"
                type="time"
                required
                aria-label="Od"
                value={od}
                onChange={(e) => setOd(e.target.value)}
                style={S.pole}
              />
              <span aria-hidden="true">–</span>
              <input
                name="do"
                type="time"
                required
                aria-label="Do"
                value={doKdy}
                onChange={(e) => setDoKdy(e.target.value)}
                style={S.pole}
              />
            </Pole>
          </div>

          {predSmenou !== null && novychMinut > 0 ? (
            <p className="ds-smd-souhrn-hodin" style={poradi(4)} aria-live="polite">
              Tento týden má naplánováno <strong>{hodinyKratce(predSmenou)}</strong>, s touhle směnou{' '}
              <strong>{hodinyKratce(predSmenou + novychMinut)}</strong>.
            </p>
          ) : null}

          {klic !== '' && !casySedi ? (
            <p style={{ ...vysvetlivka, ...poradi(5) }}>
              Časy jste přepsali, takže se směna uloží bez zkratky{' '}
              {klic}. Zkratka u směny s jinými časy by v rozpisu lhala.
            </p>
          ) : null}

          <p style={{ ...vysvetlivka, ...poradi(5) }}>
            Konec dřív než začátek znamená, že směna končí druhý den —
            22:00–06:00 je osm hodin, ne mínus šestnáct.
          </p>

          {/*
            Trhaná směna — pauza uvnitř, jako součást TÉTO směny, ne
            druhá oddělená. Zaškrtnutí jen odkrývá dvě pole; kdo ho
            odškrtne, pošle prázdno a uloží se bez pauzy, i kdyby předtím
            nějakou měla.
          */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              color: 'var(--ink)',
              minHeight: '44px',
              ...poradi(6),
            }}
          >
            <input
              type="checkbox"
              checked={trhana}
              onChange={(e) => setTrhana(e.target.checked)}
            />
            Trhaná směna (pauza uprostřed)
          </label>

          {trhana ? (
            <>
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', ...poradi(7) }}
              >
                <label style={S.label}>
                  <span>Pauza od</span>
                  <Pole ikona="hodiny">
                    <input
                      name="pauza_od"
                      type="time"
                      required
                      value={pauzaOd}
                      onChange={(e) => setPauzaOd(e.target.value)}
                      style={S.pole}
                    />
                  </Pole>
                </label>
                <label style={S.label}>
                  <span>Pauza do</span>
                  <Pole ikona="hodiny">
                    <input
                      name="pauza_do"
                      type="time"
                      required
                      value={pauzaDo}
                      onChange={(e) => setPauzaDo(e.target.value)}
                      style={S.pole}
                    />
                  </Pole>
                </label>
              </div>
              <p style={{ ...vysvetlivka, ...poradi(7) }}>
                Pauza je jen v rozpisu — do mzdy se nepočítá zvlášť, tu
                řeší paušální odpočet v Nastavení.
              </p>
            </>
          ) : null}

          <label style={{ ...S.label, ...poradi(10) }}>
            <span>Poznámka (nepovinné)</span>
            <Pole ikona="tuzka">
              <input
                ref={poznamkaRef}
                name="poznamka"
                maxLength={200}
                defaultValue={zdroj?.note ?? ''}
                placeholder="Zadejte poznámku…"
                style={S.pole}
              />
            </Pole>
          </label>

          {stav.stav === 'chyba' ? (
            <p className="hlaska-chyba" style={poradi(11)}>{stav.text}</p>
          ) : null}

          {/* Na telefonu je tlačítko pevně dole (viz `pata` níž). */}
          {mobil ? null : (
            <div className="ds-smd-form-pata" style={poradi(12)}>
              <button
                type="submit"
                className="ft-tl ft-tl-hlavni"
                disabled={ceka}
                onClick={() => {
                  dalsiRef.current = null
                }}
              >
                {ceka ? 'Ukládám…' : smena?.id ? 'Uložit změny' : 'Přidat směnu'}
              </button>
              {!smena?.id && onDalsiDen ? (
                <button
                  type="submit"
                  className="ft-tl ft-tl-vedlejsi ds-smd-form-dalsi"
                  disabled={ceka}
                  title="Uloží směnu a otevře novou pro další den, který člověk nemá obsazený — se stejnými časy"
                  onClick={() => {
                    dalsiRef.current = dalsiPodklady()
                  }}
                >
                  Uložit a přidat další den
                </button>
              ) : null}
              <button type="button" onClick={zavrit} className="ft-tl ft-tl-vedlejsi ds-smd-form-zrusit">
                Zrušit
              </button>
            </div>
          )}
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
      {!hotovo && smena?.id && !mobil ? (
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
            <div className="ds-smd-form-druhotne">
              {onDuplikovat ? (
                <button type="button" onClick={onDuplikovat} className="ft-tl ft-tl-male ft-tl-vedlejsi">
                  <Ikona klic="kopie" velikost={15} />
                  Duplikovat směnu
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPtaSeNaSmazani(true)}
                className="ft-tl ft-tl-male ft-tl-vedlejsi ds-smd-smazat"
              >
                <Ikona klic="kos" velikost={15} />
                {jeVydana ? 'Zrušit směnu' : 'Smazat směnu'}
              </button>
            </div>
          )}

          {stavSmazani.stav === 'chyba' ? (
            <p className="hlaska-chyba" style={{ marginTop: '8px' }}>
              {stavSmazani.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )

  if (!mobil) {
    return (
      <Drawer otevreno onZavrit={zavrit} nadpis={smena?.id ? 'Upravit směnu' : 'Nová směna'} nemodalni>
        <div className="ds-sm-form ds-smd-form">
          {kontext && smena?.id ? <HlavickaSmeny kontext={kontext} /> : null}
          {telo}
          {dole}
        </div>
      </Drawer>
    )
  }

  /*
    Telefon. Mazání tu záměrně není: patří do Detailu směny, odkud se
    úprava otevírá. Hlavní tlačítko je v patičce mimo `<form>`, proto
    atribut `form`.
  */
  return (
    <ListMobil
      nadpis={smena ? 'Upravit směnu' : 'Přidat směnu'}
      onZavrit={zavrit}
      pata={
        hotovo ? (
          <button type="button" className="ds-sm-pridat ds-sm-pridat-v-listu" onClick={zavrit}>
            Hotovo
          </button>
        ) : (
          <button
            type="submit"
            form={ID_FORMULARE}
            className="ds-sm-pridat ds-sm-pridat-v-listu"
            disabled={ceka}
          >
            {ceka ? 'Ukládám…' : smena ? 'Uložit změnu' : 'Uložit směnu'}
          </button>
        )
      }
    >
      <div className="ds-sm-form">{telo}</div>
    </ListMobil>
  )
}

/* --- pole s ikonou na telefonu --------------------------------------- */

const ID_FORMULARE = 'ds-sm-formular-smeny'
const ID_CAS = 'ds-sm-cas-popisek'

/**
 * Obal pole v mobilní variantě: rámeček s ikonou vlevo a šipkou vpravo.
 * V desktopové variantě nedělá nic — pole zůstává, jak bylo. Je to
 * funkce MIMO komponentu formuláře schválně: definovaná uvnitř by se při
 * každém vykreslení stala „novou“ komponentou a pole by ztrácela fokus.
 */
function Pole({
  ikona,
  sipka = false,
  children,
}: {
  ikona: IkonaKlic
  sipka?: boolean
  children: ReactNode
}) {
  return (
    <span className="ds-sm-pole-obal">
      <span className="ds-sm-pole-ikona" aria-hidden="true">
        <Ikona klic={ikona} velikost={20} />
      </span>
      {children}
      {sipka ? (
        <span className="ds-sm-pole-sipka" aria-hidden="true">
          <Ikona klic="sipkaVpravo" velikost={16} />
        </span>
      ) : null}
    </span>
  )
}

/* --- styly ---------------------------------------------------------- */

/*
  Pole formuláře (telefon i panel na počítači): popisek malým písmem bez
  verzálek nad rámečkem,
  samotné pole bez vlastního rámu (rám dělá `.ds-sm-pole-obal`).
  16 px na polích je záměr — menší písmo by iOS při zaměření přiblížil.
*/
const labelMobil = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
} as const

const poleMobil = {
  flex: 1,
  minWidth: 0,
  width: '100%',
  padding: 0,
  fontSize: '16px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink)',
  minHeight: '48px',
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  outline: 'none',
} as const

const STYL_POLE = { label: labelMobil, pole: poleMobil } as const

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
