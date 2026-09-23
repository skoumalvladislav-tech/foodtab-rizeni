/**
 * Fotky k položkám checklistu — čistá logika (bez prohlížeče, bez databáze).
 *
 * Vlastní soubor ze stejného důvodu jako lib/komunikace/prilohy.ts: modul
 * `'use server'` smí vyvážet jen funkce, a klientská komponenta i server
 * akce potřebují tytéž konstanty. Čísla musí sedět s
 * 20260923110000_checklisty_mockup.sql (kbelík `checklist-fotky`) a
 * 20260923160000_checklisty_rpc.sql (pripojit_checklist_fotku) — ty je
 * vynucují, tohle je jen UX, ať se nesmysl odmítne dřív, než se nahrává.
 *
 * Názvy a velikost se čistí/formátují stejnými funkcemi jako přílohy
 * zpráv — druhá kopie „jak se čistí název souboru" by se časem rozešla.
 */
import { jeObrazek, ocistitNazev, typSouboru, velikostText } from '@/lib/komunikace/prilohy'

export { jeObrazek, ocistitNazev, typSouboru, velikostText }

/** Jméno kbelíku. Musí sedět s 20260923110000_checklisty_mockup.sql. */
export const KBELIK_FOTEK = 'checklist-fotky'

/** Nejvíc fotek u jedné položky v jednom běhu (drží pripojit_checklist_fotku). */
export const MAX_FOTEK = 6

/** Největší soubor (drží kbelík: file_size_limit). */
export const MAX_BAJTU_FOTKY = 10 * 1024 * 1024

/** Podepsaný odkaz platí hodinu — stejně jako u příloh. */
export const PLATNOST_ODKAZU_FOTEK_S = 3600

/** Povolené typy a přípona v cestě — jen fotky, žádné PDF. */
export const TYPY_FOTEK = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type TypFotky = keyof typeof TYPY_FOTEK

export function jeTypFotky(mime: string): mime is TypFotky {
  return Object.prototype.hasOwnProperty.call(TYPY_FOTEK, mime)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Cesta v úložišti: firma / běh / položka / soubor.přípona — tvar, který
 * čte app.checklist_fotka_cesta_rozsah. Klientská cesta je jen NÁVRH:
 * server akce i databáze ji ověří znovu.
 */
export function cestaFotky(tenantId: string, behId: string, polozkaId: string, id: string, mime: TypFotky): string {
  return `${tenantId}/${behId}/${polozkaId}/${id}.${TYPY_FOTEK[mime]}`
}

/** Sedí cesta s firmou, během a položkou? (Serverová kontrola před RPC.) */
export function cestaSedi(cesta: string, tenantId: string, behId: string, polozkaId: string): boolean {
  const casti = cesta.split('/')
  if (casti.length !== 4) return false
  const [t, b, p, soubor] = casti
  if (t !== tenantId || b !== behId || p !== polozkaId) return false
  const [id, pripona] = soubor.split('.')
  return UUID.test(id ?? '') && Object.values(TYPY_FOTEK).includes(pripona as never)
}

export type VyberFotek = { platne: number[]; chyby: string[] }

/**
 * Které z vybraných souborů se vezmou. `uzMa` = kolik fotek už položka
 * v běhu má. Neznámý obrázkový typ (HEIC…) projde — komponenta ho zkusí
 * převést na JPEG; když to nejde, odmítne ho po převodu.
 */
export function zkontrolujFotky(
  soubory: { name: string; type: string; size: number }[],
  uzMa: number,
): VyberFotek {
  const platne: number[] = []
  const chyby: string[] = []
  let volno = Math.max(0, MAX_FOTEK - uzMa)

  soubory.forEach((s, i) => {
    const nazev = ocistitNazev(s.name)
    const typ = typSouboru(s)
    if (!jeObrazek(typ)) {
      chyby.push(`„${nazev}“: k položce jde přidat jen fotka.`)
      return
    }
    if (s.size <= 0) {
      chyby.push(`„${nazev}“: soubor je prázdný.`)
      return
    }
    if (volno <= 0) {
      chyby.push(`„${nazev}“: u položky může být nejvýš ${MAX_FOTEK} fotek.`)
      return
    }
    volno -= 1
    platne.push(i)
  })

  return { platne, chyby }
}

/** Po zmenšení: prošla, nebo je pořád špatná? */
export function zkontrolujFotkuPoZmenseni(nazev: string, mime: string, velikost: number): string | null {
  if (!jeTypFotky(mime)) return `„${ocistitNazev(nazev)}“: tenhle typ fotky se nepodařilo převést.`
  if (velikost <= 0) return `„${ocistitNazev(nazev)}“: soubor je prázdný.`
  if (velikost > MAX_BAJTU_FOTKY) return `„${ocistitNazev(nazev)}“: je větší než ${velikostText(MAX_BAJTU_FOTKY)}.`
  return null
}
