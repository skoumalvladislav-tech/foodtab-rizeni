'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react'

import { zameritKdyzSeZtratil } from '@/components/ui/fokus-okna'
import { formatHaleru, haleruNaText, prevestCastku, prevestMnozstvi, vynasobit } from '@/lib/jine-platby-castky'
import { popisDruhu, popisTypuDokladu } from '@/lib/jine-platby-stav'
import { DRUHY_BEZ_SKLADU, DRUHY_POLOZEK, TYPY_DOKLADU, type DruhPolozky, type PuvodCastky, type StavMapovani, type TypDokladu } from '@/lib/jine-platby-typy'

import Ikona from '../../../../ikona'
import type { AkceZaznamu } from './formular-akce'
import { KLID, popisPuvoduCastky, type StavAkce } from './logika'

/**
 * Formulář návrhu: hlavička dokladu a položky s úpravou (přidat, odebrat,
 * přiřadit k produktu pokladny). Vzor kontroly výsledku AI:
 * app/[rozsah]/marketing/menu/[menu]/page.tsx — řádek ke kontrole je
 * zvýrazněný a nese důvod.
 *
 * Stav drží komponenta (řízená pole), odesílá `onSubmit` +
 * `startTransition` — React by `<form action>` po akci vyprázdnil
 * i při chybě a člověk by přišel o rozepsané položky. Když se změní
 * verze záznamu (uloženo, rozpoznáno, upravil někdo jiný), načte se
 * znovu ze stránky.
 *
 * Nic se tu nepočítá „naostro“: součet položek je jen nápověda, převod
 * a kontrolu dělá server (`nacistNavrh`, `zkontrolovatNavrh`) a databáze.
 */

export type KandidatEditoru = { externiId: string; nazev: string; skore: number; proc: string }
export type ProduktEditoru = { externiId: string; nazev: string; jednotka: string | null; mira: number | null }

export type PolozkaEditoru = {
  id: string
  nazevPuvodni: string
  nazev: string
  mnozstvi: string
  jednotka: string
  cenaJ: string
  cenaC: string
  dph: string
  druh: DruhPolozky
  produkt: string
  posProduktNazev: string | null
  posMnozstvi: string | null
  mapovani: StavMapovani
  zdroj: 'ai' | 'rucne'
  jistota: number | null
  vyzadujeKontrolu: boolean
  duvodKontroly: string
  kandidati: KandidatEditoru[]
}

export type HlavickaEditoru = {
  datum: string
  oznaceni: string
  mena: string
  castka: string
  castkaPuvod: PuvodCastky | null
  typ: TypDokladu
  externi: string
  kontaktId: string
}

type Radek = PolozkaEditoru & {
  klic: string
  puvodniProdukt: string
  overit: boolean
  potvrdit: boolean
  zapamatovat: boolean
  hledat: string
}

const MAX_V_NABIDCE = 60
const MAX_POLOZEK = 200

const doRadku = (p: PolozkaEditoru, i: number): Radek => ({
  ...p,
  klic: `r${i}`,
  puvodniProdukt: p.produkt,
  overit: false,
  potvrdit: false,
  zapamatovat: false,
  hledat: '',
})

const bezDiakritiky = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Součet položek jako nápověda (bez spropitného, sleva záporně). `null` = některá cena chybí nebo nejde přečíst. */
function soucetRadku(radky: readonly Radek[]): number | null {
  let soucet = 0
  let nejaky = false
  for (const r of radky) {
    if (r.druh === 'spropitne') continue
    nejaky = true
    let cena: number | null = null
    const c = prevestCastku(r.cenaC)
    if (c.stav === 'ok') cena = c.haleru
    else if (c.stav === 'nejasne') return null
    else {
      const m = prevestMnozstvi(r.mnozstvi)
      const j = prevestCastku(r.cenaJ)
      if (m.stav !== 'ok' || j.stav !== 'ok') return null
      try {
        cena = vynasobit(m.mnozstvi, j.haleru)
      } catch {
        return null
      }
    }
    soucet += r.druh === 'sleva' && cena > 0 ? -cena : cena
  }
  return nejaky ? soucet : null
}

const VSTUP = { minHeight: '44px' } as const
const MRIZKA_POLI = { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))' } as const

export default function EditorNavrhu({
  akce,
  zaznam,
  verze,
  rozsah,
  hlavicka,
  polozky,
  katalog,
  kontakty,
  mena,
}: {
  akce: AkceZaznamu
  zaznam: string
  verze: number
  rozsah: string
  hlavicka: HlavickaEditoru
  polozky: PolozkaEditoru[]
  /** Katalog pokladny (bez smazaných). Prázdný = pokladna katalog nedodala nebo záznam pokladnu nemá. */
  katalog: ProduktEditoru[]
  /** Odběratelé, když je člověk smí vidět (finance.read); `null` = pole se nekreslí, odběratel se nemění. */
  kontakty: { id: string; nazev: string; ico: string | null }[] | null
  mena: string | null
}) {
  const [stav, odeslat, ceka] = useActionState<StavAkce, FormData>(akce, KLID)
  const [verzeDat, setVerzeDat] = useState(verze)
  const [h, setH] = useState(hlavicka)
  const [puvodCastky, setPuvodCastky] = useState<'' | 'vypocet'>('')
  const [radky, setRadky] = useState<Radek[]>(() => polozky.map(doRadku))
  const [dalsi, setDalsi] = useState(polozky.length)
  const souhrn = useRef<HTMLDivElement>(null)

  // Nová verze ze stránky (uloženo, rozpoznáno, změnil někdo jiný) → načíst znovu.
  if (verze !== verzeDat) {
    setVerzeDat(verze)
    setH(hlavicka)
    setPuvodCastky('')
    setRadky(polozky.map(doRadku))
    setDalsi(polozky.length)
  }

  useEffect(() => {
    if (stav.stav !== 'nic') zameritKdyzSeZtratil(souhrn.current)
  }, [stav])

  const chyba = (nazev: string) => (stav.stav === 'chyba' ? stav.chyby?.[nazev] : undefined)
  const zmenit = (klic: string, zmena: Partial<Radek>) => setRadky((rs) => rs.map((r) => (r.klic === klic ? { ...r, ...zmena } : r)))
  const soucet = soucetRadku(radky)

  function pridat() {
    if (radky.length >= MAX_POLOZEK) return
    setRadky((rs) => [
      ...rs,
      {
        id: '',
        nazevPuvodni: '',
        nazev: '',
        mnozstvi: '',
        jednotka: '',
        cenaJ: '',
        cenaC: '',
        dph: '',
        druh: 'nezarazeno',
        produkt: '',
        posProduktNazev: null,
        posMnozstvi: null,
        mapovani: 'nenamapovano',
        zdroj: 'rucne',
        jistota: null,
        vyzadujeKontrolu: false,
        duvodKontroly: '',
        kandidati: [],
        klic: `n${dalsi}`,
        puvodniProdukt: '',
        overit: false,
        potvrdit: false,
        zapamatovat: false,
        hledat: '',
      },
    ])
    setDalsi((d) => d + 1)
  }

  function poOdeslani(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (ceka) return
    const data = new FormData(e.currentTarget)
    startTransition(() => odeslat(data))
  }

  const popisChyby = (nazev: string) => {
    const t = chyba(nazev)
    return t ? (
      <span id={`${zaznam}-${nazev}-chyba`} style={{ fontSize: '12.5px', color: 'var(--bad)' }}>
        {t}
      </span>
    ) : null
  }
  const aria = (nazev: string) =>
    chyba(nazev) ? { 'aria-invalid': true as const, 'aria-describedby': `${zaznam}-${nazev}-chyba` } : {}

  return (
    <form onSubmit={poOdeslani} aria-label="Návrh dokladu" style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
      <input type="hidden" name="zaznam" value={zaznam} />
      <input type="hidden" name="verze" value={String(verze)} />
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="castka_puvod" value={puvodCastky} />

      {/* ---------- Hlavička ---------- */}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '10px', minWidth: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>Údaje dokladu</legend>
        <div style={MRIZKA_POLI}>
          <label className="ds-field">
            <span className="ds-field-label">Datum prodeje (provozní den)</span>
            <input
              className="ds-input"
              style={VSTUP}
              type="date"
              name="datum"
              value={h.datum}
              onChange={(e) => setH({ ...h, datum: e.target.value })}
              {...aria('datum')}
            />
            {popisChyby('datum')}
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Označení (zákazník, účet)</span>
            <input className="ds-input" style={VSTUP} name="oznaceni" maxLength={200} value={h.oznaceni} onChange={(e) => setH({ ...h, oznaceni: e.target.value })} {...aria('oznaceni')} />
            {popisChyby('oznaceni')}
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Měna (CZK, EUR…)</span>
            <input
              className="ds-input"
              style={VSTUP}
              name="mena"
              maxLength={3}
              autoCapitalize="characters"
              value={h.mena}
              onChange={(e) => setH({ ...h, mena: e.target.value.toUpperCase() })}
              {...aria('mena')}
            />
            {popisChyby('mena')}
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Celková cena prodeje</span>
            <input
              className="ds-input"
              style={VSTUP}
              name="castka"
              inputMode="decimal"
              value={h.castka}
              onChange={(e) => {
                setH({ ...h, castka: e.target.value })
                setPuvodCastky('')
              }}
              {...aria('castka')}
            />
            <span className="ds-field-hint">
              Původ: {puvodCastky === 'vypocet' ? popisPuvoduCastky('vypocet') : h.castka === hlavicka.castka ? popisPuvoduCastky(hlavicka.castkaPuvod) : popisPuvoduCastky('rucne')}
            </span>
            {popisChyby('castka')}
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Typ dokladu</span>
            <select className="ds-input" style={VSTUP} name="typ" value={h.typ} onChange={(e) => setH({ ...h, typ: e.target.value as TypDokladu })} {...aria('typ')}>
              {TYPY_DOKLADU.map((t) => (
                <option key={t} value={t}>
                  {popisTypuDokladu(t)}
                </option>
              ))}
            </select>
            {popisChyby('typ')}
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Číslo účtu / dokladu z fotky</span>
            <input className="ds-input" style={VSTUP} name="externi" maxLength={100} value={h.externi} onChange={(e) => setH({ ...h, externi: e.target.value })} {...aria('externi')} />
            {popisChyby('externi')}
          </label>
          {kontakty !== null ? (
            <label className="ds-field">
              <span className="ds-field-label">Odběratel (pro fakturu)</span>
              <select className="ds-input" style={VSTUP} name="kontakt" value={h.kontaktId} onChange={(e) => setH({ ...h, kontaktId: e.target.value })} {...aria('kontakt')}>
                <option value="">— bez odběratele —</option>
                {kontakty.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nazev}
                    {k.ico ? ` (IČO ${k.ico})` : ''}
                  </option>
                ))}
              </select>
              {popisChyby('kontakt')}
            </label>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '14px' }}>
          <span>
            Součet položek (bez spropitného): <strong className="ds-cislo">{soucet === null ? 'nejde spočítat — některé ceně chybí údaj' : formatHaleru(soucet, h.mena.trim() || mena)}</strong>
          </span>
          {soucet !== null && soucet >= 0 && haleruNaText(soucet) !== h.castka ? (
            <button
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => {
                setH({ ...h, castka: haleruNaText(soucet) })
                setPuvodCastky('vypocet')
              }}
            >
              Použít součet jako návrh celkové ceny
            </button>
          ) : null}
        </div>
      </fieldset>

      {/* ---------- Položky ---------- */}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '12px', minWidth: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>Položky ({radky.length})</legend>
        {popisChyby('radky')}
        {radky.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné položky. Rozpoznejte je z dokladu, nebo je přidejte ručně.</p>
        ) : null}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
          {radky.map((r, i) => {
            const n = (pole: string) => `p_${r.klic}_${pole}`
            const bezSkladu = DRUHY_BEZ_SKLADU.includes(r.druh)
            const hledano = bezDiakritiky(r.hledat.trim())
            const vyber = katalog.filter((k) => hledano === '' || bezDiakritiky(k.nazev).includes(hledano))
            const nabidka = vyber.slice(0, MAX_V_NABIDCE)
            const vybrany = katalog.find((k) => k.externiId === r.produkt)
            if (vybrany && !nabidka.includes(vybrany)) nabidka.unshift(vybrany)
            const zmenenProdukt = r.produkt !== r.puvodniProdukt
            const duvody = r.duvodKontroly
              .split('; ')
              .map((d) => d.trim())
              .filter(Boolean)
            return (
              <li
                key={r.klic}
                style={{
                  border: '1px solid var(--line)',
                  borderLeft: r.vyzadujeKontrolu ? '4px solid var(--pozor)' : '1px solid var(--line)',
                  borderRadius: '12px',
                  padding: '12px',
                  display: 'grid',
                  gap: '10px',
                  minWidth: 0,
                  background: r.vyzadujeKontrolu ? 'color-mix(in srgb, var(--pozor) 7%, var(--card))' : 'var(--card)',
                }}
              >
                <input type="hidden" name="radek" value={r.klic} />
                <input type="hidden" name={n('id')} value={r.id} />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '14px' }}>
                    {i + 1}. {r.zdroj === 'ai' ? 'z rozpoznání' : 'ruční'}
                    {r.nazevPuvodni && r.nazevPuvodni !== r.nazev ? (
                      <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · na dokladu „{r.nazevPuvodni}“</span>
                    ) : null}
                    {r.jistota !== null ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · jistota čtení {Math.round(r.jistota * 100)} %</span> : null}
                  </strong>
                  <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setRadky((rs) => rs.filter((x) => x.klic !== r.klic))}>
                    <Ikona klic="kos" />
                    Odebrat
                  </button>
                </div>

                {r.vyzadujeKontrolu ? (
                  <div style={{ display: 'grid', gap: '6px', fontSize: '13.5px' }}>
                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600 }}>
                      <Ikona klic="varovani" velikost={16} />
                      Ke kontrole
                    </span>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      {(duvody.length > 0 ? duvody : ['Označeno ke kontrole']).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                    <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px' }}>
                      <input type="checkbox" name={n('potvrdit')} value="ano" checked={r.potvrdit} onChange={(e) => zmenit(r.klic, { potvrdit: e.target.checked })} />
                      <span>Řádek jsem ověřil(a) proti dokladu (věcné chyby — chybějící cena, nesedící součin — tím nezmizí)</span>
                    </label>
                  </div>
                ) : null}

                <div style={MRIZKA_POLI}>
                  <label className="ds-field" style={{ gridColumn: '1 / -1' }}>
                    <span className="ds-field-label">Název</span>
                    <input className="ds-input" style={VSTUP} name={n('nazev')} maxLength={300} value={r.nazev} onChange={(e) => zmenit(r.klic, { nazev: e.target.value })} {...aria(n('nazev'))} />
                    {popisChyby(n('nazev'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Množství</span>
                    <input className="ds-input" style={VSTUP} name={n('mnozstvi')} inputMode="decimal" value={r.mnozstvi} onChange={(e) => zmenit(r.klic, { mnozstvi: e.target.value })} {...aria(n('mnozstvi'))} />
                    {popisChyby(n('mnozstvi'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Jednotka</span>
                    <input className="ds-input" style={VSTUP} name={n('jednotka')} maxLength={20} value={r.jednotka} onChange={(e) => zmenit(r.klic, { jednotka: e.target.value })} {...aria(n('jednotka'))} />
                    {popisChyby(n('jednotka'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Jednotková cena</span>
                    <input className="ds-input" style={VSTUP} name={n('cena_j')} inputMode="decimal" value={r.cenaJ} onChange={(e) => zmenit(r.klic, { cenaJ: e.target.value })} {...aria(n('cena_j'))} />
                    {popisChyby(n('cena_j'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Cena celkem</span>
                    <input className="ds-input" style={VSTUP} name={n('cena_c')} inputMode="decimal" value={r.cenaC} onChange={(e) => zmenit(r.klic, { cenaC: e.target.value })} {...aria(n('cena_c'))} />
                    {popisChyby(n('cena_c'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">DPH %</span>
                    <input className="ds-input" style={VSTUP} name={n('dph')} inputMode="decimal" value={r.dph} onChange={(e) => zmenit(r.klic, { dph: e.target.value })} {...aria(n('dph'))} />
                    {popisChyby(n('dph'))}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Druh</span>
                    <select className="ds-input" style={VSTUP} name={n('druh')} value={r.druh} onChange={(e) => zmenit(r.klic, { druh: e.target.value as DruhPolozky })} {...aria(n('druh'))}>
                      {DRUHY_POLOZEK.map((d) => (
                        <option key={d} value={d}>
                          {popisDruhu(d)}
                        </option>
                      ))}
                    </select>
                    {popisChyby(n('druh'))}
                  </label>
                </div>

                {/* ---------- Přiřazení k produktu pokladny ---------- */}
                {bezSkladu ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{popisDruhu(r.druh)} se skladu netýká — k produktu pokladny se nepřiřazuje.</p>
                ) : katalog.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                    Katalog pokladny není načtený — přiřazení k produktu zatím nejde, a proto ani skladový výdej.
                    {r.produkt ? <input type="hidden" name={n('produkt')} value={r.produkt} /> : null}
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                    <div style={MRIZKA_POLI}>
                      <label className="ds-field">
                        <span className="ds-field-label">Hledat v katalogu pokladny</span>
                        <input className="ds-input" style={VSTUP} type="search" value={r.hledat} onChange={(e) => zmenit(r.klic, { hledat: e.target.value })} />
                      </label>
                      <label className="ds-field">
                        <span className="ds-field-label">Produkt v pokladně</span>
                        <select
                          className="ds-input"
                          style={VSTUP}
                          name={n('produkt')}
                          value={r.produkt}
                          onChange={(e) => zmenit(r.klic, { produkt: e.target.value, overit: false })}
                          {...aria(n('produkt'))}
                        >
                          <option value="">— nepřiřazeno —</option>
                          {nabidka.map((k) => (
                            <option key={k.externiId} value={k.externiId}>
                              {k.nazev}
                              {k.jednotka ? ` (${k.mira ? `${String(k.mira).replace('.', ',')} ` : ''}${k.jednotka})` : ''}
                            </option>
                          ))}
                        </select>
                        <span className="ds-field-hint">
                          {vyber.length > MAX_V_NABIDCE ? `Zobrazeno ${MAX_V_NABIDCE} z ${vyber.length} — zpřesněte hledání.` : `Nalezeno: ${vyber.length}.`}
                        </span>
                        {popisChyby(n('produkt'))}
                      </label>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px' }}>
                      Přiřazení:{' '}
                      <strong>
                        {r.produkt === ''
                          ? 'nepřiřazeno'
                          : zmenenProdukt || r.overit || r.mapovani === 'overeno'
                            ? 'ověřené člověkem'
                            : 'návrh podle podobnosti názvu — potvrďte ho'}
                      </strong>
                      {r.produkt !== '' && !zmenenProdukt && r.posMnozstvi ? ` · v pokladně ${r.posMnozstvi.replace('.', ',')} ks` : ''}
                    </p>
                    {r.produkt !== '' && !zmenenProdukt && r.mapovani !== 'overeno' ? (
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px' }}>
                        <input type="checkbox" name={n('overit')} value="ano" checked={r.overit} onChange={(e) => zmenit(r.klic, { overit: e.target.checked })} />
                        <span>Přiřazení je správné (ověřeno)</span>
                      </label>
                    ) : null}
                    {r.produkt !== '' ? (
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', minHeight: '44px', fontSize: '14px' }}>
                        <input type="checkbox" name={n('zapamatovat')} value="ano" checked={r.zapamatovat} onChange={(e) => zmenit(r.klic, { zapamatovat: e.target.checked })} />
                        <span>Zapamatovat pro příště (název z dokladu → tento produkt)</span>
                      </label>
                    ) : null}
                    {r.kandidati.length > 0 ? (
                      <div style={{ display: 'grid', gap: '6px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Kandidáti z katalogu (podle názvu):</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {r.kandidati.map((k) => (
                            <button
                              key={k.externiId}
                              type="button"
                              className="ft-tl ft-tl-vedlejsi"
                              aria-pressed={r.produkt === k.externiId}
                              style={{ whiteSpace: 'normal', textAlign: 'left', maxWidth: '100%' }}
                              onClick={() => zmenit(r.klic, { produkt: k.externiId, overit: false })}
                            >
                              {k.nazev} · {Math.round(k.skore * 100)} % · {k.proc}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <div>
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={pridat} disabled={radky.length >= MAX_POLOZEK}>
            <Ikona klic="plus" />
            Přidat položku
          </button>
        </div>
      </fieldset>

      <div ref={souhrn} tabIndex={-1} style={{ display: 'grid', gap: '8px' }}>
        <div>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
            {ceka ? 'Ukládám…' : 'Uložit návrh'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Uložení nic nezapisuje do tržeb ani do skladu — je to návrh, který potvrdíte v dalších krocích.</p>
        {stav.stav === 'chyba' ? (
          <p role="alert" className="hlaska-chyba" style={{ margin: 0 }}>
            {stav.text}
          </p>
        ) : stav.stav === 'ok' ? (
          <p role="status" style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
            {stav.text}
          </p>
        ) : null}
      </div>
    </form>
  )
}
