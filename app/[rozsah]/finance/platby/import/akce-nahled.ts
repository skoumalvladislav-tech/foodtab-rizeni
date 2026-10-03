'use server'

import { createHash } from 'node:crypto'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naparsovatCsv, type ChybaImportu, type RadekImportu } from '@/lib/finance-csv-import'

/**
 * Krok 1 ze dvou: nahrání a NÁHLED — ještě se nic nezapisuje.
 *
 * Klientská komponenta (formular.tsx) tohle volá přes `useActionState`
 * a z vráceného stavu vykreslí náhled s tlačítkem „Potvrdit import",
 * které teprve volá `./akce.ts` (potvrditImport). Soubor s hashem, který
 * firma už jednou nahrála, se odmítne TADY — dřív, než by se parsoval
 * náhled, který by stejně skončil na stejné kontrole při potvrzení.
 */

const LIMIT_BAJTU = 2_000_000 // 2 MB — výpis z banky/pokladny na pár tisíc řádků se do toho vejde pohodlně.
const LIMIT_RADKU = 2000

export type StavNahledu =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | {
      stav: 'nahled'
      ucetId: string
      zdroj: 'csv_banka' | 'csv_pokladna'
      soubor: { hash: string; nazev: string }
      radky: RadekImportu[]
      chyby: ChybaImportu[]
    }

export async function naparsovatSoubor(_predchozi: StavNahledu, formData: FormData): Promise<StavNahledu> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav !== 'ok') return { stav: 'chyba', text: 'Na import plateb nemáte oprávnění.' }

  const ucetId = String(formData.get('ucet_id') ?? '')
  if (!ucetId) return { stav: 'chyba', text: 'Vyberte platební účet.' }

  const zdrojRaw = String(formData.get('zdroj') ?? '')
  if (zdrojRaw !== 'csv_banka' && zdrojRaw !== 'csv_pokladna') return { stav: 'chyba', text: 'Vyberte typ výpisu.' }

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

  const { radky, chyby } = naparsovatCsv(obsah)

  if (radky.length === 0) {
    return { stav: 'chyba', text: chyby[0]?.zprava ?? 'Soubor neobsahuje žádné platné řádky.' }
  }
  if (radky.length > LIMIT_RADKU) {
    return { stav: 'chyba', text: `Soubor má příliš mnoho řádků (limit ${LIMIT_RADKU}) — rozdělte ho na menší části.` }
  }

  return { stav: 'nahled', ucetId, zdroj: zdrojRaw, soubor: { hash, nazev: soubor.name }, radky, chyby }
}
