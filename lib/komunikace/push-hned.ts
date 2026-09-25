import 'server-only'

import { after } from 'next/server'

import { klientUlohy } from '@/lib/supabase/uloha'

import { odeslatFrontu, type ZdrojUpozorneni } from './fronta-push.ts'
import { nactiKliceVapid } from './web-push.ts'

/**
 * Push k upozorněním JEDNOHO ZDROJE HNED po tom, co vznikla — zpráva
 * (`poslat_zpravu`), výplata nebo potvrzení zálohy (od 25. 9. 2026).
 *
 * Pošle jen řádky fronty, které ten zdroj právě založil a které smí odejít
 * hned (`k_odeslani`: příjemce je v práci, upozornění je naléhavé, nebo je
 * příjemce majitel). Co čeká na směnu (`ceka_na_smenu`), nechá plánovači
 * — o tom rozhoduje databáze (app.zaradit_doruceni), ne tenhle kód.
 *
 * Servisní klíč: fronta a zařízení nemají politiky pro přihlášené (klíče
 * zařízení se do prohlížeče nesmí dostat). Klíč zůstává na serveru
 * (pravidlo 6) a sahá se jen na upozornění zdroje, který databáze právě
 * přijala pod účtem přihlášeného — id vrací RPC (`poslat_zpravu`,
 * `vyplatit_zalohu`, `potvrdit_moji_zalohu`…), ne formulář.
 *
 * NIKDY NEVYHODÍ: zápis je hotový, výpadek push služby ho nesmí shodit
 * ani uživateli ukázat chybu. Neodeslané zůstane ve frontě pro plánovač.
 * Do logu jde jen důvod, nikdy obsah.
 */
export async function odeslatPushKeZdroji(zdroj: ZdrojUpozorneni, firmaId: string): Promise<void> {
  try {
    if (!zdroj.typ || !zdroj.id || !firmaId) return
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
    await odeslatFrontu(supabase, klice, { zdroj, firma: firmaId, rozpocetMs: 15_000 })
  } catch (e) {
    const kod = (e as { code?: string } | null)?.code
    console.error('Push hned se nepovedl (zůstává pro plánovač):', kod ?? (e instanceof Error ? e.message : 'neznámá chyba'))
  }
}

/**
 * Naplánovat push ke zdroji až po odpovědi uživateli (`after`). Volat až
 * PO úspěšném RPC, které zdroj založilo. Samotná registrace je taky
 * v try — prostředí bez `waitUntil` by jinak shodilo akci, která už
 * zapsala.
 */
export function naplanovatPushKeZdroji(zdroj: ZdrojUpozorneni, firmaId: string): void {
  try {
    after(() => odeslatPushKeZdroji(zdroj, firmaId))
  } catch (e) {
    console.error('Push hned se nepodařilo naplánovat:', e instanceof Error ? e.message : 'neznámá chyba')
  }
}

/** Push k upozorněním zprávy — zkratka pro `naplanovatPushKeZdroji` se zdrojem `zprava`. */
export function naplanovatPushKeZprave(zpravaId: string, firmaId: string): void {
  naplanovatPushKeZdroji({ typ: 'zprava', id: zpravaId }, firmaId)
}
