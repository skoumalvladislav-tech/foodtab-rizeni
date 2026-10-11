import type { SupabaseClient } from '@supabase/supabase-js'

import type { ExterniUcetKb } from './kb-adaa.ts'

const bezMezer = (iban: string | undefined) => (iban ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Jeden účet v Komerční bance smí plnit jen jeden platební účet. Dva by
 * dostávaly tytéž pohyby (dedup je jen v rámci platebního účtu) a
 * automatické párování by vidělo každou platbu dvakrát. Porovnává se
 * `account_id`, a IBAN s měnou — `account_id` od KB nemusí být stejné
 * napříč různými registracemi aplikace a vícoměnový účet má jeden IBAN,
 * ale pro každou měnu vlastní účet s vlastními pohyby (dokumentace KB,
 * Accounts), takže jen IBAN by zablokoval připojení druhé měny.
 *
 * Vrací hlášku pro uživatele, nebo `null`, když je účet volný.
 */
export async function ucetKbJinde(
  supabase: SupabaseClient,
  tenantId: string,
  pripojeniId: string,
  ucet: { account_id: string; iban: string; mena: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .is('odpojeno_kdy', null)
    .neq('id', pripojeniId)
  if (error) return 'Nepodařilo se ověřit, jestli účet z Komerční banky není připojený jinde — zkuste to znovu.'
  const iban = bezMezer(ucet.iban)
  const jinde = (data ?? []).some((p) => {
    const e = (p.externi_ucet ?? {}) as ExterniUcetKb
    return e.account_id === ucet.account_id || (iban !== '' && bezMezer(e.iban) === iban && (e.mena ?? 'CZK').toUpperCase() === (ucet.mena || 'CZK').toUpperCase())
  })
  return jinde ? `Účet ${ucet.iban || ucet.account_id} (${ucet.mena}) z Komerční banky už plní jiný platební účet.` : null
}
