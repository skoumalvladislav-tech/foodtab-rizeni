import { STAV_ODMITNUTO } from './faktury-types.ts'

/**
 * Sdílené filtry nad tabulkou `invoices` — vytaženo ze Seznamu (Krok 1
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
  dotaz = dotaz.eq('is_archived', f.archiv)

  if (!f.archiv && f.stav !== STAV_ODMITNUTO) {
    dotaz = dotaz.neq('status', STAV_ODMITNUTO)
  }
  if (f.kontrola) {
    dotaz = dotaz.eq('needs_review', true)
  } else if (f.stav) {
    dotaz = dotaz.eq('status', f.stav)
  }
  if (f.mesic) {
    const [r, m] = f.mesic.split('-').map(Number)
    const od = `${f.mesic}-01`
    const do_ = m === 12 ? `${r + 1}-01-01` : `${r}-${String(m + 1).padStart(2, '0')}-01`
    dotaz = dotaz.gte('duzp', od).lt('duzp', do_)
  }
  if (f.dodavatel) dotaz = dotaz.eq('supplier', f.dodavatel)
  if (f.hledat) {
    const vzor = `%${escapovatHledani(f.hledat)}%`
    dotaz = dotaz.or(`supplier.ilike."${vzor}",invoice_number.ilike."${vzor}",variable_symbol.ilike."${vzor}",email_subject.ilike."${vzor}"`)
  }
  if (f.duplicity) dotaz = dotaz.eq('is_duplicate', true)

  return dotaz
}
