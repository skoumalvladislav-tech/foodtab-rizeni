import 'server-only'

import { podepsatText, podpisSedi } from './integrace-klice.ts'

/**
 * `state` pro návraty z Komerční banky (registrace aplikace a souhlas).
 * Nese id rozjetého připojení, rozsah stránky a fázi, podepsané klíčem
 * appky — návratová adresa podle podpisu pozná, že pokus vydala appka,
 * a nepustí ho po vypršení. Stejný tvar jako u Dotykačky
 * (`…/pokladna/dotykacka/page.tsx`).
 */

export type FazeKb = 'registrace' | 'souhlas'
/** `k` = pokus o připojení (`externi_ucet.pokus`): návrat ze staršího pokusu se pozná a nic nerozbije. */
export type StavKb = { p: string; r: string; f: FazeKb; e: number; k?: string }

/** Přihlášení KB Klíčem a výběr účtů zabere pár minut; 30 minut stačí s rezervou. */
const PLATNOST_S = 30 * 60

export function vytvoritStavKb(pripojeniId: string, rozsah: string, faze: FazeKb, pokus?: string): string {
  const obsah = Buffer.from(JSON.stringify({ p: pripojeniId, r: rozsah, f: faze, e: Math.floor(Date.now() / 1000) + PLATNOST_S, k: pokus } satisfies StavKb)).toString('base64url')
  return `${obsah}.${podepsatText(obsah)}`
}

export function precistStavKb(state: string | null): StavKb | null {
  if (!state) return null
  const [obsah, podpis] = state.split('.')
  if (!obsah || !podpis) return null
  try {
    if (!podpisSedi(obsah, podpis)) return null
    const s = JSON.parse(Buffer.from(obsah, 'base64url').toString('utf8')) as StavKb
    if (typeof s.p !== 'string' || typeof s.r !== 'string' || (s.f !== 'registrace' && s.f !== 'souhlas') || typeof s.e !== 'number' || (s.k !== undefined && typeof s.k !== 'string')) return null
    if (s.e < Math.floor(Date.now() / 1000)) return null
    return s
  } catch {
    return null
  }
}
