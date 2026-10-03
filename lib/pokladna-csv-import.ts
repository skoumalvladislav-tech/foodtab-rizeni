/**
 * CSV import denních pokladních prodejů (Dotykačka adaptér, P1) —
 * provider-neutrální tvar: datum/produkt/množství/tržba, ne nativní
 * export konkrétní pokladny (appka žádnou nemá živě připojenou, zadání
 * oddíl 2: „čeká na připojení", nikdy „připojeno" natvrdo).
 *
 * Sdílí parsovací primitiva s lib/finance-csv-import.ts (oddělovač,
 * BOM, uvozovky, české datum) — jen sloupce a cílový tvar řádku jsou
 * jiné (produkt/množství místo účetního pohybu se směrem).
 */

import { normalizovatNazev, rozdelitRadek, odhadnoutOddelovac, naDatum } from './finance-csv-import.ts'

export type RadekPokladny = {
  datum: string
  produktNazev: string
  mnozstvi: number
  trzbaHaleru: number
}

export type ChybaImportu = { radek: number; zprava: string }
export type VysledekImportuPokladny = { radky: RadekPokladny[]; chyby: ChybaImportu[] }

const ALIASY: Record<string, string[]> = {
  datum: ['datum', 'date'],
  produkt: ['produkt', 'polozka', 'nazev', 'product', 'item'],
  mnozstvi: ['mnozstvi', 'pocet', 'quantity', 'qty', 'ks'],
  trzba: ['trzba', 'castka', 'suma', 'revenue', 'amount'],
}

/** `'1 234,5'`, `'12.5'`, `'3'` → kladné desetinné číslo. Null, když to není číslo nebo je záporné. */
function naKladneCislo(text: string): number | null {
  const t = text.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Kladná částka v haléřích (tržba nikdy není záporná — to by byl vratka, ne prodej). */
function naHalereKladne(text: string): number | null {
  const t = text.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [cela, des = ''] = t.split('.')
  return Number(cela) * 100 + Number(des.padEnd(2, '0'))
}

export function naparsovatCsvPokladny(obsah: string): VysledekImportuPokladny {
  const bezBom = obsah.charCodeAt(0) === 0xfeff ? obsah.slice(1) : obsah
  const radkySouboru = bezBom.split(/\r\n|\n|\r/).filter((r) => r.length > 0)

  if (radkySouboru.length === 0) return { radky: [], chyby: [{ radek: 0, zprava: 'Soubor je prázdný.' }] }

  const oddelovac = odhadnoutOddelovac(radkySouboru[0])
  const hlavicka = rozdelitRadek(radkySouboru[0], oddelovac).map(normalizovatNazev)

  const indexSloupce = (klic: string): number => {
    const aliasy = ALIASY[klic]
    for (let i = 0; i < hlavicka.length; i++) {
      if (aliasy.includes(hlavicka[i])) return i
    }
    return -1
  }

  const idx = {
    datum: indexSloupce('datum'),
    produkt: indexSloupce('produkt'),
    mnozstvi: indexSloupce('mnozstvi'),
    trzba: indexSloupce('trzba'),
  }

  const chyby: ChybaImportu[] = []
  if (idx.datum === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Datum".' })
  if (idx.produkt === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Produkt".' })
  if (idx.mnozstvi === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Množství".' })
  if (idx.trzba === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Tržba".' })
  if (chyby.length > 0) return { radky: [], chyby }

  const radky: RadekPokladny[] = []

  for (let i = 1; i < radkySouboru.length; i++) {
    const cislo = i + 1
    const bunky = rozdelitRadek(radkySouboru[i], oddelovac)
    if (bunky.every((b) => b === '')) continue

    const datumText = bunky[idx.datum] ?? ''
    const produktNazev = (bunky[idx.produkt] ?? '').trim()
    const mnozstviText = bunky[idx.mnozstvi] ?? ''
    const trzbaText = bunky[idx.trzba] ?? ''

    const datum = naDatum(datumText)
    if (!datum) { chyby.push({ radek: cislo, zprava: `Nerozpoznané datum „${datumText}".` }); continue }
    if (!produktNazev) { chyby.push({ radek: cislo, zprava: 'Chybí název produktu.' }); continue }

    const mnozstvi = naKladneCislo(mnozstviText)
    if (mnozstvi === null) { chyby.push({ radek: cislo, zprava: `Nerozpoznané množství „${mnozstviText}".` }); continue }

    const trzbaHaleru = naHalereKladne(trzbaText)
    if (trzbaHaleru === null) { chyby.push({ radek: cislo, zprava: `Nerozpoznaná tržba „${trzbaText}".` }); continue }

    radky.push({ datum, produktNazev, mnozstvi, trzbaHaleru })
  }

  return { radky, chyby }
}
