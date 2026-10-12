/**
 * Příjmové API Foodtabu pro pokladny — tvar klíče a kontrola dávky.
 *
 * Pro pokladnu, kterou appka neumí napojit sama (`lib/pokladna-poskytovatele.ts`,
 * způsob `prijem`): appka vydá klíč a pokladna nebo prostředník (n8n,
 * Make) posílá `POST /api/pokladna/prodeje` s `Authorization: Bearer <klíč>`.
 * Popis pro integrátora: `docs/pokladna-api.md`.
 *
 * KLÍČ nese id připojení (`ftpos_<uuid>_<43 znaků náhody>`) — adresa
 * podle něj najde připojení a zašifrovaný klíč, rozšifruje ho
 * a porovná v konstantním čase. Žádné hledání podle otisku, žádný
 * klíč v databázi čitelně.
 *
 * DÁVKA = celé dny. Každý den, který v dávce je, appka u téhle
 * pobočky PŘEPÍŠE (`public.pokladna_nahradit_prodeje`) — opakované
 * poslání téhož dne nezdvojí nic a produkt, který z pokladny zmizel
 * (storno), zmizí i tady. Den, který v dávce není, zůstane beze změny;
 * den, ve kterém už nic nezbylo, se pošle v poli `dny` bez položek.
 *
 * Čistý modul (žádné IO) — `scripts/pokladna-napojeni.test.mjs`.
 */

import type { RadekProdeje } from './pos-provider-contract.ts'

export const PREDPONA_KLICE = 'ftpos'
export const MAX_RADKU = 5000
export const MAX_DNU = 62
const MAX_DELKA_PRODUKTU = 200
const MAX_MNOZSTVI = 10_000_000
/**
 * 20 milionů Kč za jeden produkt a den — víc je překlep (haléře místo
 * korun), ne prodej. A hlavně: sloupec `trzba_haleru` je integer (nejvýš
 * 21 474 836,47 Kč); co se do něj nevejde, shodilo by zápis celé dávky.
 */
const MAX_TRZBA_KC = 20_000_000
const MAX_HALERU = 2_147_483_647

/** Řídicí znaky (i \u0000, který databáze v JSONu odmítne celou dávkou) pryč — z názvu produktu. */
export function bezRidicichZnaku(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

const RE_KLIC = /^ftpos_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/

/** `nahodne` = 32 náhodných bajtů v base64url (43 znaků) — vyrábí volající přes `crypto.randomBytes`. */
export function slozitKlicPrijmu(pripojeniId: string, nahodne: string): string {
  return `${PREDPONA_KLICE}_${pripojeniId}_${nahodne}`
}

export function rozebratKlicPrijmu(klic: string): { pripojeniId: string } | null {
  const m = RE_KLIC.exec(klic.trim())
  return m ? { pripojeniId: m[1] } : null
}

export type RadekDavky = RadekProdeje & { datum: string }
export type VysledekDavky = { stav: 'ok'; dny: string[]; radky: RadekDavky[] } | { stav: 'chyba'; duvod: string }

function platneDatum(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

/** Číslo z JSONu; text jen v jednoduchém tvaru (`"12.5"`, `"12,5"`) — pokladny tak čísla často posílají. */
function cislo(hodnota: unknown): number | null {
  if (typeof hodnota === 'number') return Number.isFinite(hodnota) ? hodnota : null
  if (typeof hodnota === 'string' && /^-?\d+([.,]\d+)?$/.test(hodnota.trim())) return Number(hodnota.trim().replace(',', '.'))
  return null
}

/**
 * Zkontroluje dávku `{ prodeje: [{ datum, produkt, mnozstvi, trzba }] }`.
 * `trzba` v korunách s DPH (jak ji ukazuje pokladna), appka ji převede
 * na haléře. Jedna vadná položka vrátí chybu celé dávky s číslem
 * položky — polovičně zapsaný den by byl horší než žádný.
 */
export function overitDavku(telo: unknown, dnes: string): VysledekDavky {
  const prodeje = (telo as { prodeje?: unknown } | null)?.prodeje
  if (!Array.isArray(prodeje)) return { stav: 'chyba', duvod: 'Tělo musí být JSON s polem „prodeje".' }
  if (prodeje.length > MAX_RADKU) return { stav: 'chyba', duvod: `Nejvýš ${MAX_RADKU} položek v jedné dávce — pošlete ji po částech (po dnech).` }

  const zitra = new Date(Date.parse(`${dnes}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const radky: RadekDavky[] = []
  const dny = new Set<string>()

  // Volitelné `dny`: dny, které se mají přepsat, i když v nich už nic
  // není (celý den stornovaný) — jinak by se prázdný den nedal poslat.
  const vyslovneDny = (telo as { dny?: unknown }).dny
  if (vyslovneDny !== undefined) {
    if (!Array.isArray(vyslovneDny)) return { stav: 'chyba', duvod: '„dny" musí být pole dat RRRR-MM-DD.' }
    for (const den of vyslovneDny) {
      if (!platneDatum(den) || den < '2000-01-01' || den > zitra) return { stav: 'chyba', duvod: `„dny": neplatné datum ${JSON.stringify(den)}.` }
      dny.add(den)
    }
  }

  for (let i = 0; i < prodeje.length; i++) {
    const p = prodeje[i] as Record<string, unknown> | null
    const kde = `Položka ${i + 1}`
    if (!p || typeof p !== 'object') return { stav: 'chyba', duvod: `${kde}: není objekt.` }

    if (!platneDatum(p.datum)) return { stav: 'chyba', duvod: `${kde}: „datum" musí být RRRR-MM-DD.` }
    if (p.datum < '2000-01-01' || p.datum > zitra) return { stav: 'chyba', duvod: `${kde}: datum ${p.datum} je mimo rozumný rozsah.` }

    const produkt = typeof p.produkt === 'string' ? bezRidicichZnaku(p.produkt) : ''
    if (!produkt) return { stav: 'chyba', duvod: `${kde}: chybí „produkt".` }
    if (produkt.length > MAX_DELKA_PRODUKTU) return { stav: 'chyba', duvod: `${kde}: název produktu je delší než ${MAX_DELKA_PRODUKTU} znaků.` }

    const mnozstvi = cislo(p.mnozstvi)
    if (mnozstvi === null || mnozstvi < 0 || mnozstvi > MAX_MNOZSTVI) return { stav: 'chyba', duvod: `${kde}: „mnozstvi" musí být nezáporné číslo.` }

    const trzba = cislo(p.trzba)
    if (trzba === null || trzba < 0 || trzba > MAX_TRZBA_KC) return { stav: 'chyba', duvod: `${kde}: „trzba" musí být nezáporné číslo v korunách.` }

    dny.add(p.datum)
    radky.push({ datum: p.datum, produktNazev: produkt, mnozstvi, trzbaHaleru: Math.round(trzba * 100) })
  }

  // Stejný produkt v jednom dni se v databázi sečte — i součet se musí vejít.
  const soucty = new Map<string, number>()
  for (const r of radky) {
    const klic = `${r.datum}|${r.produktNazev}`
    const soucet = (soucty.get(klic) ?? 0) + r.trzbaHaleru
    if (soucet > MAX_HALERU) return { stav: 'chyba', duvod: `Produkt „${r.produktNazev}" má ${r.datum} tržbu přes 21 474 836 Kč — nejspíš haléře místo korun.` }
    soucty.set(klic, soucet)
  }

  if (dny.size > MAX_DNU) return { stav: 'chyba', duvod: `Nejvýš ${MAX_DNU} různých dní v jedné dávce.` }
  if (dny.size === 0) return { stav: 'chyba', duvod: 'Dávka je prázdná — pošlete aspoň jednu položku, nebo den v „dny".' }

  return { stav: 'ok', dny: [...dny].sort(), radky }
}
