/**
 * Zkrácení e-mailové adresy pro obrazovku.
 *
 * `ladislav@seznam.cz` → `l…v@seznam.cz`
 *
 * Zadání docs/ukoly-codea-drobnosti-2026-09-01.md, bod 6: adresa se má
 * zkrátit, ať se z cizí obrazovky nedá přečíst celá. Kdo pozvánku
 * otevřel, ji stejně zná z e-mailu — tohle je jen připomenutí, které
 * z jeho adres to je.
 *
 * Doména zůstává celá schválně: právě podle ní člověk pozná, který
 * ze svých účtů to je („aha, ten seznamový“). Skrývá se jméno, ne
 * poskytovatel.
 */
export function zkratitAdresu(adresa: string | null | undefined): string | null {
  const a = (adresa ?? '').trim()
  if (!a) return null

  const zavinac = a.lastIndexOf('@')
  if (zavinac < 1) return null

  const jmeno = a.slice(0, zavinac)
  const domena = a.slice(zavinac)

  // Krátké jméno nemá co zkracovat — „a…b@…“ z „ab@…“ je delší než
  // originál a nic neskryje.
  if (jmeno.length <= 3) return `${jmeno[0]}…${domena}`

  return `${jmeno[0]}…${jmeno[jmeno.length - 1]}${domena}`
}
