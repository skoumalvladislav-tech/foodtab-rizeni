/**
 * Účetní export — zobecnění app/api/faktury/export/route.ts na
 * neutrální tvar (zadání, oddíl 7): doklad/datum/středisko/kategorie/
 * částka, žádný konkrétní účetní systém (Pohoda/Money S3/...) bez
 * ověřené dokumentace jejich formátu — jen CSV, stejná konvence jako
 * export faktur (středník, BOM, CRLF).
 *
 * Zdroj: `transakce` (ledger, jeden řádek = jeden peněžní pohyb) +
 * `platby_faktury` (jen `stav='potvrzeno'` — navržené/zamítnuté párování
 * není účetní fakt). JEDEN řádek exportu na JEDNU transakci — i když ji
 * sytí víc faktur (split platba), čísla se nezdvojí, jen se spojí
 * seznam faktur do jedné buňky.
 *
 * Čistá logika, žádné IO — testovatelná přímo Nodem
 * (scripts/ucetni-export.test.mjs). Řádky i CSV sestavuje appka
 * (app/api/ucetni/export/route.ts), která si data načte ze Supabase.
 */

export type SmerTransakce = 'prijem' | 'vydaj' | 'prevod_dovnitr' | 'prevod_ven'

export type ZdrojovaTransakce = {
  id: string
  datum: string
  smer: SmerTransakce
  castkaHaleru: number
  protistrana: string
  vs: string
  kategorie: string | null
  zdroj: string
  branchId: string | null
}

export type ZdrojovaPlatba = {
  transakceId: string
  fakturaId: string
  stav: 'navrzeno' | 'potvrzeno' | 'zamitnuto'
}

export type RadekExportu = {
  doklad: string
  datum: string
  stredisko: string
  kategorie: string
  smer: SmerTransakce
  castkaHaleru: number
  protistrana: string
  vs: string
  faktury: string
  zdroj: string
}

const NAZVY_SMERU: Record<SmerTransakce, string> = {
  prijem: 'Příjem',
  vydaj: 'Výdaj',
  prevod_dovnitr: 'Převod (dovnitř)',
  prevod_ven: 'Převod (ven)',
}

/**
 * Jeden řádek na jednu transakci. `platby` se seskupí podle
 * `transakceId` a jen POTVRZENÉ párování se promítne do sloupce
 * Faktury — návrh bez lidského potvrzení není účetní fakt.
 */
export function sestavitRadkyExportu(
  transakce: readonly ZdrojovaTransakce[],
  platby: readonly ZdrojovaPlatba[],
  nazvyPobocek: Readonly<Record<string, string>>,
): RadekExportu[] {
  const fakturyPodleTransakce = new Map<string, string[]>()
  for (const p of platby) {
    if (p.stav !== 'potvrzeno') continue
    const seznam = fakturyPodleTransakce.get(p.transakceId) ?? []
    if (!seznam.includes(p.fakturaId)) seznam.push(p.fakturaId)
    fakturyPodleTransakce.set(p.transakceId, seznam)
  }

  const radky = transakce.map((t): RadekExportu => ({
    doklad: t.vs || `TRX-${t.id.slice(0, 8).toUpperCase()}`,
    datum: t.datum,
    stredisko: t.branchId ? (nazvyPobocek[t.branchId] ?? t.branchId) : 'Firma',
    kategorie: t.kategorie ?? '',
    smer: t.smer,
    castkaHaleru: t.castkaHaleru,
    protistrana: t.protistrana,
    vs: t.vs,
    faktury: (fakturyPodleTransakce.get(t.id) ?? []).join(', '),
    zdroj: t.zdroj,
  }))

  return radky.sort((a, b) => (a.datum === b.datum ? a.doklad.localeCompare(b.doklad) : a.datum < b.datum ? -1 : 1))
}

function csvBunka(hodnota: string | number | null | undefined): string {
  const s = hodnota === null || hodnota === undefined ? '' : String(hodnota)
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const SLOUPCE: { hlavicka: string; z: (r: RadekExportu) => string | number }[] = [
  { hlavicka: 'Doklad', z: (r) => r.doklad },
  { hlavicka: 'Datum', z: (r) => r.datum },
  { hlavicka: 'Středisko', z: (r) => r.stredisko },
  { hlavicka: 'Kategorie', z: (r) => r.kategorie },
  { hlavicka: 'Směr', z: (r) => NAZVY_SMERU[r.smer] },
  { hlavicka: 'Částka (Kč)', z: (r) => (r.castkaHaleru / 100).toFixed(2) },
  { hlavicka: 'Protistrana', z: (r) => r.protistrana },
  { hlavicka: 'VS', z: (r) => r.vs },
  { hlavicka: 'Faktura(y)', z: (r) => r.faktury },
  { hlavicka: 'Zdroj', z: (r) => r.zdroj },
]

/** BOM na začátku (Excel + UTF-8/diakritika), `;` a CRLF — stejná konvence jako export faktur. */
export function vygenerovatCsvExportu(radky: readonly RadekExportu[]): string {
  const vsechny = [
    SLOUPCE.map((s) => csvBunka(s.hlavicka)).join(';'),
    ...radky.map((r) => SLOUPCE.map((s) => csvBunka(s.z(r))).join(';')),
  ]
  return '﻿' + vsechny.join('\r\n') + '\r\n'
}
