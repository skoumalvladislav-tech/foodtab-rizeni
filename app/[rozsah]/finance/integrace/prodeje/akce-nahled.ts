'use server'

import { createHash } from 'node:crypto'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naparsovatCsvPokladny, type RadekPokladny, type ChybaImportu } from '@/lib/pokladna-csv-import'

/**
 * Krok 1 ze dvou: nahrání a NÁHLED — stejný dvoukrokový vzor jako
 * app/[rozsah]/finance/platby/import/ (akce-nahled.ts + akce.ts).
 */

const LIMIT_BAJTU = 2_000_000
const LIMIT_RADKU = 5000

export type StavNahleduProdeje =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | {
      stav: 'nahled'
      branchId: string
      soubor: { hash: string; nazev: string }
      radky: RadekPokladny[]
      chyby: ChybaImportu[]
    }

export async function naparsovatSouborProdeje(_predchozi: StavNahleduProdeje, formData: FormData): Promise<StavNahleduProdeje> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav !== 'ok') return { stav: 'chyba', text: 'Na import prodejů nemáte oprávnění.' }

  const branchId = String(formData.get('branch_id') ?? '')
  if (!branchId) return { stav: 'chyba', text: 'Vyberte pobočku.' }

  const soubor = formData.get('soubor')
  if (!(soubor instanceof File) || soubor.size === 0) return { stav: 'chyba', text: 'Vyberte soubor.' }
  if (soubor.size > LIMIT_BAJTU) return { stav: 'chyba', text: `Soubor je příliš velký (limit ${LIMIT_BAJTU / 1_000_000} MB).` }

  const obsah = await soubor.text()
  const hash = createHash('sha256').update(obsah, 'utf8').digest('hex')

  const supabase = await getServerSupabase()
  const { data: existujici } = await supabase
    .from('import_davky')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('soubor_hash', hash)
    .maybeSingle()

  if (existujici) return { stav: 'chyba', text: 'Tenhle soubor už byl jednou importován (stejný obsah).' }

  const { radky, chyby } = naparsovatCsvPokladny(obsah)

  if (radky.length === 0) {
    return { stav: 'chyba', text: chyby[0]?.zprava ?? 'Soubor neobsahuje žádné platné řádky.' }
  }
  if (radky.length > LIMIT_RADKU) {
    return { stav: 'chyba', text: `Soubor má příliš mnoho řádků (limit ${LIMIT_RADKU}) — rozdělte ho na menší části.` }
  }

  return { stav: 'nahled', branchId, soubor: { hash, nazev: soubor.name }, radky, chyby }
}
