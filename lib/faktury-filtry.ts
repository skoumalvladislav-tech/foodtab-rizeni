import { FILTR_KE_KONTROLE, STAV_ODMITNUTO } from './faktury-types.ts'

/**
 * Sdílené filtry nad tabulkou `public.faktury` (česká jména sloupců; do
 * 18. 10. 2026 `invoices` v samostatné databázi) — vytaženo ze Seznamu (Krok 1
 * sloučení faktur), aby je mohl použít i CSV export (`/api/faktury/export`)
 * beze změny chování: stejný filtr musí vracet stejné řádky na obrazovce
 * i v exportu.
 */
export type FakturyFiltry = {
  archiv: boolean
  stav?: string
  kontrola: boolean
  mesic?: string
  dodavatel?: string
  hledat: string
  duplicity: boolean
}

/** Escapuje % a _ (speciální znaky v Postgres ILIKE) i uvozovky, ať jde uživatelský
 * dotaz bezpečně použít jako vzor uvnitř PostgREST `.or()` filtru. */
export function escapovatHledani(hodnota: string): string {
  return hodnota.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/"/g, '\\"')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pouzitFiltry(dotaz: any, f: FakturyFiltry): any {
  dotaz = dotaz.eq('archivovano', f.archiv)

  if (!f.archiv && f.stav !== STAV_ODMITNUTO) {
    dotaz = dotaz.neq('stav', STAV_ODMITNUTO)
  }
  if (f.kontrola) {
    dotaz = dotaz.or(FILTR_KE_KONTROLE)
  } else if (f.stav) {
    dotaz = dotaz.eq('stav', f.stav)
  }
  if (f.mesic) {
    const [r, m] = f.mesic.split('-').map(Number)
    const od = `${f.mesic}-01`
    const do_ = m === 12 ? `${r + 1}-01-01` : `${r}-${String(m + 1).padStart(2, '0')}-01`
    dotaz = dotaz.gte('duzp', od).lt('duzp', do_)
  }
  if (f.dodavatel) dotaz = dotaz.eq('dodavatel', f.dodavatel)
  if (f.hledat) {
    const vzor = `%${escapovatHledani(f.hledat)}%`
    dotaz = dotaz.or(`dodavatel.ilike."${vzor}",cislo_faktury.ilike."${vzor}",variabilni_symbol.ilike."${vzor}",email_predmet.ilike."${vzor}"`)
  }
  if (f.duplicity) dotaz = dotaz.eq('duplicita', true)

  return dotaz
}
