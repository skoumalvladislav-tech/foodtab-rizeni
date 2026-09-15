/**
 * Řádky tabulky menu (`marketing/menu`, krok 2 zadání).
 *
 * Čisté funkce, žádné IO — obrazovka i test sahají na totéž. Počet
 * položek a počet „ke kontrole" se počítá tady, ne v dotazu: dvě různé
 * tabulky (`marketing_menu`, `marketing_menu_polozky`) se spojují na
 * straně aplikace, protože Supabase klient neumí agregovat přes cizí
 * tabulku v jednom selectu bez RPC.
 */

export const DRUHY_MENU: readonly { klic: string; nazev: string }[] = [
  { klic: 'denni', nazev: 'Denní' },
  { klic: 'tydenni', nazev: 'Týdenní' },
  { klic: 'vikendove', nazev: 'Víkendové' },
  { klic: 'poledni', nazev: 'Polední' },
  { klic: 'sezonni', nazev: 'Sezonní' },
  { klic: 'napoje', nazev: 'Nápoje' },
  { klic: 'dezerty', nazev: 'Dezerty' },
  { klic: 'special', nazev: 'Speciál' },
]

export const ZDROJE_MENU: Record<string, string> = {
  rucne: 'Ručně',
  text: 'Text',
  fotka: 'Fotka',
  pdf: 'PDF',
  foodtab: 'Foodtab',
}

export function popisDruhu(druh: string): string {
  return DRUHY_MENU.find((d) => d.klic === druh)?.nazev ?? druh
}

export function popisZdroje(zdroj: string): string {
  return ZDROJE_MENU[zdroj] ?? zdroj
}

export function popisStavuMenu(stav: string): string {
  if (stav === 'potvrzeno') return 'Potvrzeno'
  if (stav === 'archivovano') return 'Archiv'
  return 'Koncept'
}

/** `2026-09-14` → `14. 9. 2026`. Datum bez času, bez pásma — nemá se co převádět. */
export function popisDatumu(iso: string): string {
  const [rok, mesic, den] = iso.split('-')
  return `${Number(den)}. ${Number(mesic)}. ${rok}`
}

export function popisPlatnosti(platiOd: string | null, platiDo: string | null): string {
  if (!platiOd) return '—'
  if (!platiDo || platiDo === platiOd) return popisDatumu(platiOd)
  return `${popisDatumu(platiOd)} – ${popisDatumu(platiDo)}`
}

export type MenuRadek = {
  id: string
  druh: string
  nazev: string
  platiOd: string | null
  platiDo: string | null
  stav: string
  zdroj: string
  vytvorenoKdy: string
}

export type PolozkaPocet = {
  menuId: string
  vyzadujeKontrolu: boolean
}

export type RadekTabulky = {
  id: string
  druh: string
  nazev: string
  platnost: string
  pocetPolozek: number
  keKontrole: number
  stav: string
  zdroj: string
}

/**
 * Spojí menu s počty jejich položek. Menu bez jediné položky dostane
 * nulu, ne chybu — prázdný koncept je platný stav, ne omyl.
 */
export function sestavRadky(menu: readonly MenuRadek[], polozky: readonly PolozkaPocet[]): RadekTabulky[] {
  const pocty = new Map<string, { celkem: number; keKontrole: number }>()
  for (const p of polozky) {
    const c = pocty.get(p.menuId) ?? { celkem: 0, keKontrole: 0 }
    c.celkem += 1
    if (p.vyzadujeKontrolu) c.keKontrole += 1
    pocty.set(p.menuId, c)
  }

  return menu.map((m) => {
    const c = pocty.get(m.id) ?? { celkem: 0, keKontrole: 0 }
    return {
      id: m.id,
      druh: popisDruhu(m.druh),
      nazev: m.nazev || 'Menu bez názvu',
      platnost: popisPlatnosti(m.platiOd, m.platiDo),
      pocetPolozek: c.celkem,
      keKontrole: c.keKontrole,
      stav: popisStavuMenu(m.stav),
      zdroj: popisZdroje(m.zdroj),
    }
  })
}
