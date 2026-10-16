/**
 * Jiné platby — možné duplicity mezi záznamy.
 *
 * Proč: tutéž sjetinu vyfotí číšník i provozní, nebo se fotka nahraje
 * dvakrát. Tržba by se pak zapsala dvakrát. Databáze drží dvě tvrdé
 * pojistky (stejný soubor nejde připojit ke dvěma záznamům, jeden prodej
 * v pokladně patří nejvýš jednomu záznamu); tohle je upozornění pro
 * člověka DŘÍV, než na pojistku narazí, a k tomu měkké shody, které
 * databáze odmítnout nesmí (dva různé obědy za stejnou cenu se stanou).
 *
 *   jistá   — stejný otisk souboru (tatáž fotka), stejný prodej v téže pokladně
 *   možná   — stejné číslo účtu v téže pokladně; stejná pobočka + den + částka + měna
 *
 * Samotná částka nestačí — bez dne a pobočky by „duplicitou" bylo každé
 * druhé pivo. Zrušené záznamy se nepočítají.
 *
 * Čistá funkce — testuje scripts/jine-platby.test.mjs přímo Nodem.
 */

import type { StavKontroly } from './jine-platby-typy.ts'

export type IdentitaZaznamu = {
  id: string
  branchId: string
  pripojeniId: string | null
  datumProdeje: string | null
  castkaHaleru: number | null
  mena: string | null
  externiUcet: string | null
  posProdejId: string | null
  stavKontroly: StavKontroly
  otisky: readonly string[]
}

export type MoznaDuplicita = { zaznamId: string; duvod: string; jista: boolean }

/** Číslo účtu pro porovnání: bez mezer, malými písmeny. Prázdné → null. */
export function normalizovatUcet(u: string | null): string | null {
  if (u === null) return null
  const t = u.replace(/\s+/g, '').toLowerCase()
  return t === '' ? null : t
}

/** Otisk pro porovnání (sha256 hex — velikost písmen nerozhoduje). */
const otisk = (o: string) => o.trim().toLowerCase()

export function mozneDuplicity(z: IdentitaZaznamu, ostatni: readonly IdentitaZaznamu[]): MoznaDuplicita[] {
  const mojeOtisky = new Set(z.otisky.map(otisk).filter((o) => o !== ''))
  const mujUcet = normalizovatUcet(z.externiUcet)
  const vysledek: MoznaDuplicita[] = []

  for (const o of ostatni) {
    if (o.id === z.id || o.stavKontroly === 'zruseno') continue
    const jiste: string[] = []
    const mozne: string[] = []

    if (o.otisky.some((x) => mojeOtisky.has(otisk(x)))) jiste.push('Stejný soubor (tatáž fotka dokladu) je už u jiného záznamu')
    if (z.posProdejId !== null && z.pripojeniId !== null && o.posProdejId === z.posProdejId && o.pripojeniId === z.pripojeniId) {
      jiste.push('Stejný prodej v pokladně je už propojený s jiným záznamem')
    }

    // Stejné pravidlo jako `jine_platby_potvrdit_trzbu` v databázi
    // (`pripojeni_id is not distinct from`): dva záznamy BEZ pokladny se
    // stejným číslem účtu jsou taky možná duplicita — ruční sjetina vyfocená
    // dvakrát nemá pokladnu, která by je rozlišila.
    if (o.pripojeniId === z.pripojeniId && mujUcet !== null && normalizovatUcet(o.externiUcet) === mujUcet) {
      mozne.push(`Stejné číslo účtu (${z.externiUcet?.trim()}) ${z.pripojeniId === null ? 'u záznamu bez pokladny' : 'u stejné pokladny'}`)
    }
    if (
      o.branchId === z.branchId &&
      z.datumProdeje !== null &&
      o.datumProdeje === z.datumProdeje &&
      z.castkaHaleru !== null &&
      o.castkaHaleru === z.castkaHaleru &&
      z.mena !== null &&
      o.mena === z.mena
    ) {
      mozne.push('Stejná provozovna, den, částka a měna')
    }

    if (jiste.length + mozne.length > 0) {
      vysledek.push({ zaznamId: o.id, duvod: [...jiste, ...mozne].join('; '), jista: jiste.length > 0 })
    }
  }

  // Jisté první — ty se musí vyřešit, ne jen přečíst.
  return vysledek.sort((a, b) => Number(b.jista) - Number(a.jista))
}
