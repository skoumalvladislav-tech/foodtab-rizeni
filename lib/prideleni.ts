import type { Context } from './authz'

/**
 * Smím tuhle sadu oprávnění někomu přidělit?
 *
 * Zadání: docs/pravidlo-neprideluj-vic.md. Kdo přiděluje roli, musí sám
 * mít všechno, co ta role obsahuje.
 *
 * TOHLE JE JEN POHODLÍ, NE OCHRANA (pravidlo 3). Rozhodnutí padá
 * v databázi — v politice na `memberships`, v `membership_branches`
 * a uvnitř `app.create_invitation`. Kdyby se tahle funkce ztratila
 * nebo někdo obešel obrazovku, nic se nestane.
 *
 * Proto se tu taky nedělá nic s rozsahem. `ctx.permissions` říká, co má
 * člověk NĚKDE ve firmě; jestli to má i na té pobočce, kam roli
 * přiděluje, dopočítá databáze. Obrazovka by jinak musela mít vlastní
 * kopii pravidel o rozsahu — a dvě kopie pravidla se vždycky rozejdou.
 */
export function smimPridelit(
  ctx: Context,
  sada: { isOwner: boolean; prava: string[] },
): boolean {
  // Majitel obchází katalog oprávnění (dostává všechno z aktivních
  // modulů), takže se nedá porovnávat po položkách. Přidělí ho jen
  // vlastník.
  if (sada.isOwner) return ctx.role.isOwner

  const moje = new Set<string>(ctx.permissions)
  return sada.prava.every((p) => moje.has(p))
}
