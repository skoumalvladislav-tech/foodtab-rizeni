/**
 * Věty k upozorněním.
 *
 * V databázi leží HOLÉ ÚDAJE (`notifications.telo`), věta se skládá až
 * tady — kdyby se ukládala hotová, nešla by později opravit u starých
 * zpráv.
 *
 * ---------------------------------------------------------------------
 * PROČ TO STOJÍ ZVLÁŠŤ
 *
 * Aby na to šlo sáhnout kontrolou. Obrazovka upozornění je serverová
 * komponenta s dotazy do databáze; ověřit její text jinak než
 * přihlášením do ostré aplikace nejde. Tyhle funkce se ověřit dají —
 * a `scripts/upozorneni.test.mjs` navíc hlídá, že je obrazovka opravdu
 * volá.
 *
 * ---------------------------------------------------------------------
 * DVĚ SITUACE, DVA TEXTY
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 2:
 *
 *   „Přijal a čeká na oprávnění“  → ÚKOL
 *   „Přijal a oprávnění už má“    → INFORMACE
 *
 * „První je úkol, druhé je informace. Nesmí vypadat stejně.“ Proto se
 * liší už nadpisem, ne jen odstavcem pod ním.
 */

export type TeloUpozorneni = {
  od?: string
  do?: string
  firma?: string
  role?: string | null
  rozsah?: string
  jmeno?: string
  kdo?: string
  ceka?: boolean
  pobocky?: string[]
}

/** Nadpis podle druhu. Neznámý druh se nezamlčí — ať je vidět, že přišel. */
export function nadpisUpozorneni(
  druh: string,
  telo: TeloUpozorneni,
  obdobi: (od?: string, doKdy?: string) => string,
): string {
  switch (druh) {
    case 'rozpis.vydan':
      return `Rozpis ${obdobi(telo.od, telo.do)}`
    case 'opravneni.prideleno':
      return 'Máte přidělené oprávnění'
    case 'pozvanka.prijata':
      return telo.ceka
        ? `${telo.jmeno ?? 'Někdo'} přijal pozvánku a čeká na oprávnění`
        : `${telo.jmeno ?? 'Někdo'} přijal pozvánku`
    default:
      return 'Upozornění'
  }
}

/** „Má oprávnění Servis, Restaurace Černá Perla.“ */
export function popisOpravneni(telo: TeloUpozorneni): string {
  const kusy = [telo.role, ...(telo.pobocky ?? [])].filter(Boolean)
  if (kusy.length === 0) return 'Oprávnění už má.'
  return `Má oprávnění ${kusy.join(', ')}.`
}
