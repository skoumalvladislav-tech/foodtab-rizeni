import 'server-only'

import { after } from 'next/server'

import { klientUlohy } from '@/lib/supabase/uloha'

import { odeslatFrontu } from './fronta-push.ts'
import { nactiKliceVapid } from './web-push.ts'

/**
 * Push k upozorněním jedné zprávy HNED po jejím odeslání.
 *
 * Pošle jen řádky fronty, které zpráva právě založila a které smí odejít
 * hned (`k_odeslani`: příjemce je v práci, zpráva je naléhavá, nebo je
 * příjemce majitel). Co čeká na směnu (`ceka_na_smenu`), nechá plánovači
 * — o tom rozhoduje databáze (app.zaradit_doruceni), ne tenhle kód.
 *
 * Servisní klíč: fronta a zařízení nemají politiky pro přihlášené (klíče
 * zařízení se do prohlížeče nesmí dostat). Klíč zůstává na serveru
 * (pravidlo 6) a sahá se jen na upozornění zprávy, kterou databáze právě
 * přijala pod účtem odesílatele — id vrací `poslat_zpravu`.
 *
 * NIKDY NEVYHODÍ: zpráva je uložená, výpadek push služby ji nesmí shodit
 * ani odesílateli ukázat chybu. Neodeslané zůstane ve frontě pro plánovač.
 * Do logu jde jen důvod, nikdy obsah zprávy.
 */
export async function odeslatPushKeZprave(zpravaId: string, firmaId: string): Promise<void> {
  try {
    if (!zpravaId || !firmaId) return
    const klice = nactiKliceVapid(process.env)
    if (!klice) {
      console.warn('Push hned: chybí klíče VAPID — push se neposílá.')
      return
    }
    const supabase = klientUlohy()
    if (!supabase) {
      console.warn('Push hned: chybí SUPABASE_SERVICE_ROLE_KEY — zůstává pro plánovač.')
      return
    }
    // Kratší rozpočet než plánovač: běží po odpovědi v téže funkci.
    await odeslatFrontu(supabase, klice, { zprava: zpravaId, firma: firmaId, rozpocetMs: 15_000 })
  } catch (e) {
    const kod = (e as { code?: string } | null)?.code
    console.error('Push hned se nepovedl (zůstává pro plánovač):', kod ?? (e instanceof Error ? e.message : 'neznámá chyba'))
  }
}

/**
 * Naplánovat push ke zprávě až po odpovědi uživateli (`after`). Volat až
 * PO úspěšném `poslat_zpravu`. Samotná registrace je taky v try —
 * prostředí bez `waitUntil` by jinak shodilo akci, která zprávu už uložila.
 */
export function naplanovatPushKeZprave(zpravaId: string, firmaId: string): void {
  try {
    after(() => odeslatPushKeZprave(zpravaId, firmaId))
  } catch (e) {
    console.error('Push hned se nepodařilo naplánovat:', e instanceof Error ? e.message : 'neznámá chyba')
  }
}
