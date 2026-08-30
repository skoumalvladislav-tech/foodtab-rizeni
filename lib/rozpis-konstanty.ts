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
