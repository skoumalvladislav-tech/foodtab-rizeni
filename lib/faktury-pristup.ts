import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getServerSupabase } from './supabase/server.ts'
import { klientUlohy } from './supabase/uloha.ts'
import { rozhodnoutBranu, type RozhodnutiBrany } from './faktury-brana.ts'

/**
 * Jediná cesta k fakturám (public.faktury) — pro obrazovky i úlohy.
 *
 * Do 18. 10. 2026 vedla do samostatné databáze Faktur přes veřejný klíč
 * (lib/supabase/faktury.ts). Od sloučení jsou faktury v hlavní databázi
 * a tahle brána jen rozhoduje, jestli je má firma OTEVŘENÉ (stav převodu
 * `dokonceno`, lib/faktury-brana.ts). Tytéž dotazy pak jdou obyčejným
 * klientem — přihlášeného (RLS: faktury.read/manage za celou firmu), nebo
 * úlohy (service_role, firma VŽDY z řádku připojení nebo ze serveru,
 * nikdy z požadavku).
 *
 * Databáze to hlídá znovu sama (spoušť app.faktury_brana) — tady je to
 * proto, aby obrazovka řekla proč a úloha nic nezačínala.
 *
 * Oprávnění na obrazovku (`faktury.read`/`faktury.manage` za celou firmu)
 * si dál ověřuje každá stránka a akce sama, prvním řádkem.
 */

export type PristupKFakturam =
  | { stav: 'ok'; supabase: SupabaseClient; tenantId: string }
  | Exclude<RozhodnutiBrany, { stav: 'ok' }>

async function rozhodnout(supabase: SupabaseClient, tenantId: string): Promise<RozhodnutiBrany> {
  try {
    const dotaz = await supabase.from('faktury_prevod').select('stav').eq('tenant_id', tenantId).maybeSingle()
    return rozhodnoutBranu(dotaz, tenantId, process.env.FAKTURY_DB_TENANT_ID)
  } catch {
    return { stav: 'chyba' }
  }
}

/**
 * Pro přihlášeného. `tenantId` musí pocházet ze serveru
 * (`getCurrentTenantId()`), nikdy z formuláře.
 */
export async function pristupKFakturam(tenantId: string): Promise<PristupKFakturam> {
  const supabase = await getServerSupabase()
  const r = await rozhodnout(supabase, tenantId)
  return r.stav === 'ok' ? { stav: 'ok', supabase, tenantId } : r
}

/** Pro naplánovanou úlohu (service_role) — `tenantId` z řádku připojení, nikdy z požadavku. */
export async function pristupKFakturamUlohy(tenantId: string): Promise<PristupKFakturam> {
  const supabase = klientUlohy()
  if (!supabase) return { stav: 'chyba' }
  const r = await rozhodnout(supabase, tenantId)
  return r.stav === 'ok' ? { stav: 'ok', supabase, tenantId } : r
}

/**
 * Čtení faktur JEDNÉ firmy. RLS pustí přihlášeného ke všem firmám, kde
 * má faktury.read — kdo je ve dvou, viděl by bez filtru faktury obou
 * v jednom seznamu. Úloha (service_role) RLS obchází úplně. Proto každé
 * čtení faktur jde tudy (hlídá scripts/faktury-tenant-izolace.test.mjs).
 */
export function fakturyFirmy(
  p: Extract<PristupKFakturam, { stav: 'ok' }>,
  sloupce: string,
  moznosti?: { count?: 'exact'; head?: boolean },
) {
  return p.supabase.from('faktury').select(sloupce, moznosti).eq('tenant_id', p.tenantId)
}

/**
 * Firmy s otevřenými Fakturami — pro úlohy, které páruje platby
 * (banka, příjem z e-mailu). Dřív to byla jediná firma z nastavení
 * prostředí FAKTURY_DB_TENANT_ID; teď rozhoduje databáze.
 */
export async function firmySOtevrenymiFakturami(): Promise<string[] | null> {
  const supabase = klientUlohy()
  if (!supabase) return null
  const { data, error } = await supabase.from('faktury_prevod').select('tenant_id').eq('stav', 'dokonceno')
  // `null` = nevím (chyba, chybí klíč úlohy) — volající to musí odlišit
  // od „žádná firma Faktury otevřené nemá".
  if (error) return null
  return ((data ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id)
}
