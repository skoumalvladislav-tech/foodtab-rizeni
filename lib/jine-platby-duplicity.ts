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
 *   možná   — stejné číslo účtu do ±7 dní (v téže pokladně, bez pokladny
 *             v téže pobočce); stejná pobočka + den + částka + měna
 *
 * Samotná částka nestačí — bez dne a pobočky by „duplicitou" bylo každé
 * druhé pivo. Číslo účtu taky ne: pokladna čísluje účty dokola (účet 12
 * je každý den jiný), ruční „Stůl 7" je v každé pobočce. Proto jen do
 * ±7 dní od data prodeje a bez pokladny jen v téže pobočce — stejné
 * pravidlo jako `jine_platby_potvrdit_trzbu` v databázi. Zrušené
 * záznamy se nepočítají.
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

/** Okno shody čísla účtu kolem data prodeje (včetně, ve dnech). Musí sedět s databází. */
export const OKNO_UCTU_DNI = 7

/** RRRR-MM-DD → číslo dne (UTC, bez pásma — datum prodeje pásmo nemá). `null` = neplatné. */
function cisloDne(datum: string | null): number | null {
  if (datum === null) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum.trim())
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/** Oba dny vyplněné a nejvýš `OKNO_UCTU_DNI` od sebe. */
function blizkoSebe(a: string | null, b: string | null): boolean {
  const x = cisloDne(a)
  const y = cisloDne(b)
  return x !== null && y !== null && Math.abs(x - y) <= OKNO_UCTU_DNI
}

/** Číslo účtu pro porovnání: bez všech bílých znaků (i nezlomitelných mezer), malými písmeny. Prázdné → null. */
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

    // Stejné pravidlo jako `jine_platby_potvrdit_trzbu` v databázi:
    // stejná pokladna (`pripojeni_id is not distinct from`) — jedna pokladna
    // může obsluhovat víc poboček, proto s pokladnou i napříč pobočkami;
    // dva záznamy BEZ pokladny jen v téže pobočce (ruční sjetina vyfocená
    // dvakrát nemá pokladnu, která by je rozlišila, ale „Stůl 7" jiné
    // pobočky je jiný stůl). A jen do ±7 dní od data prodeje.
    const stejnaPokladna = o.pripojeniId === z.pripojeniId && (z.pripojeniId !== null || o.branchId === z.branchId)
    if (stejnaPokladna && mujUcet !== null && normalizovatUcet(o.externiUcet) === mujUcet && blizkoSebe(z.datumProdeje, o.datumProdeje)) {
      mozne.push(`Stejné číslo účtu (${z.externiUcet?.trim()}) do ${OKNO_UCTU_DNI} dní ${z.pripojeniId === null ? 'u záznamu bez pokladny v téže provozovně' : 'u stejné pokladny'}`)
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
