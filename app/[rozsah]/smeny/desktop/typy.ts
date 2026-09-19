/**
 * Co pro počítač přidává serverová stránka k obyčejnému rozpisu.
 *
 * Všechno je odvozené z dat, která `page.tsx` stejně čte — žádný druhý
 * zdroj pravdy. Vydání rozpisu počítá databáze; tady se jen přenáší.
 */
export type VydaniProp = {
  /** Pobočka, za kterou se dá vydávat. `null` = firemní úroveň, nebo člověk na téhle pobočce neplánuje. */
  pobockaId: string | null
  /** Období, které vydání pokryje — týž rozsah dnů jako mřížka. */
  od: string
  doKdy: string
  /** Funkce vydání v databázi odpověděla. Bez ní se tlačítko Vydat nekreslí. */
  mozeVydat: boolean
  /** Kdy byla některá směna období naposled vydaná. `null` = nikdy. */
  vydanoKdy: string | null
  /** Kolik lidí při vydání dostane zprávu (`rozpis_nahled`, bez toho, kdo vydává). */
  zprav: number
  /** Kdo z lidí ve výřezu (zaměstnanec, ne účet) tu zprávu dostane. */
  upozornit: string[]
}
