/**
 * Platby bez faktury (Finance Fáze 0, krok 2: „dvě fronty v UI: Návrhy
 * párování a Platby bez faktury — to hledá účetní").
 *
 * Odchozí platba, ke které appka fakturu nemá: zůstal z ní nespárovaný
 * zbytek, není stornovaná, nepokrývá ji Jiná platba ani ruční úhrada
 * a nečeká na ni návrh (ten je ve frontě Návrhy párování). Účetní pak
 * dohledá doklad u dodavatele.
 *
 * Čistá logika, žádné IO — testovatelná Nodem
 * (scripts/finance-bez-faktury.test.mjs). Data načítá stránka
 * app/[rozsah]/finance/platby/bez-faktury a export pro účetní.
 */

import { csvBunka } from './csv-bunka.ts'

export type PohybKPosouzeni = {
  id: string
  datum: string
  smer: string
  castkaHaleru: number
  mena: string | null
  protistrana: string
  protiucet: string
  vs: string
  ucet: string
  stornovano: boolean
}

export type PlatbaBezFaktury = PohybKPosouzeni & {
  /** Nespárovaný zbytek (částka − párování − Jiné platby). */
  zbyvaHaleru: number
}

export function platbyBezFaktury(
  pohyby: readonly PohybKPosouzeni[],
  souvislosti: {
    /** Součet POTVRZENÝCH párování na pohyb. */
    sparovanoNaPohyb: ReadonlyMap<string, number>
    /** Součet úhrad Jiných plateb na pohyb. */
    jinePlatbyNaPohyb: ReadonlyMap<string, number>
    /** Pohyby s nezrušenou ruční úhradou (platba v jiné měně). */
    rucneUhrazene: ReadonlySet<string>
    /**
     * Pohyby s otevřeným návrhem párování k faktuře, kterou jde pořád
     * zaplatit (počítá databáze: platby_bez_faktury_vyrizeni). Návrh
     * k faktuře zaplacené jinak, odmítnuté nebo archivované pohyb
     * z fronty neschová.
     */
    sNavrhem: ReadonlySet<string>
  },
): PlatbaBezFaktury[] {
  const vysledek: PlatbaBezFaktury[] = []
  for (const p of pohyby) {
    if (p.smer !== 'vydaj' || p.stornovano) continue
    if (souvislosti.rucneUhrazene.has(p.id) || souvislosti.sNavrhem.has(p.id)) continue
    const zbyva = p.castkaHaleru - (souvislosti.sparovanoNaPohyb.get(p.id) ?? 0) - (souvislosti.jinePlatbyNaPohyb.get(p.id) ?? 0)
    if (zbyva <= 0) continue
    vysledek.push({ ...p, zbyvaHaleru: zbyva })
  }
  return vysledek.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : a.id.localeCompare(b.id)))
}

export type UcetFronty = { id: string; nazev: string; branchId: string | null }

/**
 * Které účty fronta ukáže (Finance po pobočkách, zadání kroku 2 bod 8).
 *   * Celá firma: všechny účty, které přihlášený vidí (`filtr` null =
 *     bez omezení), nebo jeden vybraný.
 *   * Pobočka: jen účty TÉ pobočky (firemní účty bez pobočky ne — stejně
 *     jako Platby na pobočce), vybraný jen z nich; pobočka bez účtu =
 *     prázdný filtr (nic se nenačte).
 * Účet z adresy, který do nabídky nepatří (cizí, jiné pobočky, překlep),
 * se nevybere — ukáže se všechno dovolené, nikdy víc.
 */
export function filtrUctuFronty(
  ucty: readonly UcetFronty[],
  pobocka: string | null,
  vybrany: string | null | undefined,
): { nabidka: UcetFronty[]; vybrany: string | null; filtr: string[] | null } {
  const nabidka = pobocka ? ucty.filter((u) => u.branchId === pobocka) : [...ucty]
  const v = vybrany && nabidka.some((u) => u.id === vybrany) ? vybrany : null
  return { nabidka, vybrany: v, filtr: v ? [v] : pobocka ? nabidka.map((u) => u.id) : null }
}

/** Částka v nejmenší jednotce → „1234,50" (bez měny, ta je ve vlastním sloupci). */
function castka(haleru: number): string {
  const znamenko = haleru < 0 ? '-' : ''
  const abs = Math.abs(haleru)
  return `${znamenko}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

const SLOUPCE: readonly { hlavicka: string; z: (p: PlatbaBezFaktury) => string }[] = [
  { hlavicka: 'Datum', z: (p) => p.datum },
  { hlavicka: 'Částka', z: (p) => castka(p.castkaHaleru) },
  { hlavicka: 'Bez faktury', z: (p) => castka(p.zbyvaHaleru) },
  { hlavicka: 'Měna', z: (p) => (p.mena ?? '').trim().toUpperCase() || 'CZK' },
  { hlavicka: 'Protistrana', z: (p) => p.protistrana },
  { hlavicka: 'Účet protistrany', z: (p) => p.protiucet },
  { hlavicka: 'VS', z: (p) => p.vs },
  { hlavicka: 'Platební účet', z: (p) => p.ucet },
]

/** BOM, `;` a CRLF — stejná konvence jako export pro účetního (lib/ucetni-export.ts). */
export function csvPlatebBezFaktury(radky: readonly PlatbaBezFaktury[]): string {
  const vsechny = [
    SLOUPCE.map((s) => csvBunka(s.hlavicka)).join(';'),
    ...radky.map((r) => SLOUPCE.map((s) => csvBunka(s.z(r))).join(';')),
  ]
  return '﻿' + vsechny.join('\r\n') + '\r\n'
}
