import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { rozsifrovat, type Udaje } from '../integrace-klice.ts'
import { klientUlohy } from '../supabase/uloha.ts'
import { precistSifruPoOvereni, type KlientPrihlaseneho, type KlientSluzby } from './tajemstvi-cteni.ts'

/**
 * Přístupové údaje k bance — jen na serveru, jen po ověření práva
 * v databázi (postup a důvod: lib/banka/tajemstvi-cteni.ts).
 *
 * Volá se z míst, která připojení banky už dohledala uživatelským
 * klientem (RLS, `oblast = 'banka'`): akce Integrace → Banka a návraty
 * z banky (app/api/integrace/…). Výsledek je jen pro server — nikdy
 * ho nevracej klientovi, nepiš do logu ani do chybové hlášky.
 *
 * Null = nejde přečíst (bez práva, bez šifry, šifra nejde rozšifrovat,
 * na serveru chybí klíč služby). Volající to hlásí jako chybějící
 * registraci, ne obsahem chyby.
 */
export async function precistTajemstviBanky<T extends object = Udaje>(
  prihlaseny: Pick<SupabaseClient, 'rpc'>,
  pripojeniId: string,
): Promise<T | null> {
  const sifra = await precistSifruPoOvereni(
    prihlaseny as unknown as KlientPrihlaseneho,
    klientUlohy() as unknown as KlientSluzby | null,
    pripojeniId,
  )
  if (!sifra) return null
  try {
    return rozsifrovat(sifra) as unknown as T
  } catch {
    return null
  }
}
