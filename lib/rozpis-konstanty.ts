/**
 * Konstanty rozpisu směn.
 *
 * ŽÁDNÉ IMPORTY. Čte to serverová page.tsx i klientská rozpis.tsx, takže
 * cokoli, co sem přibude, skončí i v prohlížeči. Když tahle konstanta
 * bydlela v lib/provozni-den.ts, zatáhl si klient přes ni celý serverový
 * modul — ten má na prvním řádku `import 'server-only'` a build spadl.
 *
 * Sem patří jen holé hodnoty. Nic, co sahá na databázi nebo na tajemství.
 */

/**
 * Kolik dní rozpis ukazuje.
 *
 * Čte to dotaz na směny i popisek období nad mřížkou. Když to bylo
 * zapsané na dvou místech, rozešlo se: hlavička hlásila kalendářní týden
 * (24.–30. srpen), zatímco sloupce byly od dneška (30. 8. – 5. 9.).
 */
export const DNU_V_ROZPISU = 7


/**
 * Pohledy rozpisu na počítači (hodnota `?pohled=`).
 *
 *   sedm   — sedm dní od zvoleného dne (výchozí; dnes = následujících 7 dní)
 *   tyden  — kalendářní týden od pondělí do neděle
 *   den    — jeden den po hodinách
 *   mesic  — kalendář měsíce s počty směn
 *   osoby  — celý měsíc vybraných lidí (1–2), směny se v něm zadávají po dnech
 *
 * Čte to serverová page.tsx (co načíst) i klientská rozpis.tsx (co
 * ukázat) — proto jsou pravidla jen tady, ať se okno nemůže rozejít.
 */
export const POHLEDY_ROZPISU = ['den', 'sedm', 'tyden', 'mesic', 'osoby'] as const
export type PohledRozpisu = (typeof POHLEDY_ROZPISU)[number]
export const VYCHOZI_POHLED: PohledRozpisu = 'sedm'

export function jePohled(s: string | null | undefined): s is PohledRozpisu {
  return !!s && (POHLEDY_ROZPISU as readonly string[]).includes(s)
}

/** Nejvíc lidí, kterým jde ukázat celý měsíc najednou. Víc se do šířky obrazovky nevejde čitelně. */
export const MAX_LIDI_V_MESICI = 2

/** Načítá se a kreslí celý měsíc (týdny od pondělí, i s dny sousedních měsíců)? */
export const jeMesicniPohled = (p: string | null | undefined): boolean => p === 'mesic' || p === 'osoby'

/** Pondělí týdne, do kterého patří `den` (`RRRR-MM-DD`). */
function pondeliTydneKonst(den: string): string {
  const [r, m, d] = den.split('-').map(Number)
  const posun = (new Date(Date.UTC(r, m - 1, d)).getUTCDay() + 6) % 7
  return new Date(Date.UTC(r, m - 1, d - posun)).toISOString().slice(0, 10)
}

/**
 * První den, který pohled ukazuje. Kalendářní týden začíná pondělím;
 * ostatní pohledy běží od zvoleného dne (u „sedm“ to je dnes, dokud
 * si nikdo nic jiného nezvolí).
 */
export function zacatekOkna(pohled: string | null | undefined, den: string): string {
  return pohled === 'tyden' ? pondeliTydneKonst(den) : den
}
