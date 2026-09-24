import type { SupabaseClient } from '@supabase/supabase-js'

import { slozitPush, type RadekDoruceni } from './push-zprava.ts'
import { odeslatWebPush, type KliceVapid, type OdberPush, type VolbyOdeslani, type VysledekOdeslani } from './web-push.ts'

/**
 * Odeslání fronty push upozornění (`notifikace_doruceni`, stav `k_odeslani`).
 *
 * Volají ji dvě místa:
 *   * plánovaná úloha /api/uloha/notifikace-push — celá fronta, záloha
 *     a uvolnění čekajících na směnu,
 *   * odeslání zprávy — jen řádky upozornění té jedné zprávy, HNED po
 *     odpovědi uživateli (`after`). Bez toho push čekal na plánovač, a ten
 *     na GitHubu běží zhruba jednou za 3–6 hodin (měřeno 23. 9.).
 *
 * ---------------------------------------------------------------------
 * DVA ODESÍLATELÉ NARÁZ — ZABRÁNÍ ŘÁDKU
 *
 * Plánovač a odeslání po zprávě můžou sáhnout na tentýž řádek. Než se
 * cokoli pošle, řádek se ZABERE: podmíněný zápis (jen dokud je
 * `k_odeslani` se stejným `pokusu`) ho zároveň VYŘADÍ Z FRONTY — dostane
 * stav `selhalo` s poznámkou „Odesílání se nedokončilo.". Kdo ho přečte
 * potom, už ho nevidí; kdo ho přečetl dřív, zabrání nevyhraje. Push tak
 * nepřijde dvakrát.
 *
 * Po odeslání se zapíše skutečný výsledek (`odeslano`, zpátky
 * `k_odeslani` na další pokus, nebo `selhalo`) — ZASE podmíněně, jen
 * dokud je řádek pořád náš. Kdyby mezitím řádek změnil někdo jiný,
 * zápis nic nepřepíše.
 *
 * Spadne-li proces po zabrání, řádek zůstane `selhalo` („nedokončilo
 * se") — push se neopakuje donekonečna, radši jeden nepřijde, než by
 * chodil dvakrát.
 *
 * Bez importu `server-only`: modul sám žádný klíč nečte (klienta i klíče
 * dostává), takže jde otestovat mimo Next (`scripts/fronta-push.test.mjs`).
 */

export const DAVKA = 100
export const NEJVIC_POKUSU = 3
export const NEDOKONCENO = 'Odesílání se nedokončilo.'

/**
 * Kolik ms smí dávka odesílat. Zařízení jednoho člověka se posílají
 * souběžně (každé má vlastní timeout 8 s), ale pomalá push služba by dávku
 * jinak natáhla přes limit funkce. Co se nestihne, zůstane `k_odeslani`.
 */
export const ROZPOCET_MS = 45_000

type Doruceni = {
  id: string
  user_id: string
  notification_id: string | null
  typ: 'jedna' | 'souhrn'
  pocet: number
  pokusu: number
  notifications: { druh: string; telo: Record<string, unknown>; priorita: string } | null
}

export type VysledekFronty = {
  ve_fronte: number
  odeslano: number
  selhalo: number
  bez_zarizeni: number
  odlozeno: number
  /** Řádek mezitím zabral jiný odesílatel (plánovač vs. odeslání po zprávě). */
  nezabrano: number
}

export const PRAZDNY_VYSLEDEK: VysledekFronty = {
  ve_fronte: 0, odeslano: 0, selhalo: 0, bez_zarizeni: 0, odlozeno: 0, nezabrano: 0,
}

export type VolbyFronty = {
  /** Jen řádky upozornění k téhle zprávě (odeslání hned). Bez = celá fronta. */
  zprava?: string
  /** S `zprava`: jen řádky téhle firmy (obrana do hloubky, id zprávy je z RPC). */
  firma?: string
  rozpocetMs?: number
  /** Pro testy: náhrada skutečného odeslání. */
  odeslat?: (odber: OdberPush, zprava: object, klice: KliceVapid, volby?: VolbyOdeslani) => Promise<VysledekOdeslani>
  /** Pro testy: hodiny. */
  ted?: () => number
}

export async function odeslatFrontu(
  supabase: SupabaseClient,
  klice: KliceVapid,
  volby: VolbyFronty = {},
): Promise<VysledekFronty> {
  const vysledek: VysledekFronty = { ...PRAZDNY_VYSLEDEK }
  const odeslat = volby.odeslat ?? odeslatWebPush
  const ted = volby.ted ?? Date.now
  const rozpocet = volby.rozpocetMs ?? ROZPOCET_MS

  // Upozornění zprávy se hledají PŘES FRONTU (málo řádků, částečný index
  // na stav) a spojem na upozornění — ne průchodem celé tabulky upozornění.
  const { data: fronta, error } = volby.zprava
    ? await supabase
        .from('notifikace_doruceni')
        .select('id, user_id, notification_id, typ, pocet, pokusu, notifications!inner(druh, telo, priorita, zdroj_typ, zdroj_id)')
        .eq('stav', 'k_odeslani')
        .eq('notifications.zdroj_typ', 'zprava')
        .eq('notifications.zdroj_id', volby.zprava)
        .eq('tenant_id', volby.firma ?? '')
        .order('created_at', { ascending: true })
        .limit(DAVKA)
    : await supabase
        .from('notifikace_doruceni')
        .select('id, user_id, notification_id, typ, pocet, pokusu, notifications(druh, telo, priorita)')
        .eq('stav', 'k_odeslani')
        .order('created_at', { ascending: true })
        .limit(DAVKA)
  if (error) throw error

  const radky = (fronta ?? []) as unknown as Doruceni[]
  vysledek.ve_fronte = radky.length
  if (radky.length === 0) return vysledek

  // Zařízení všech dotčených lidí jedním dotazem. Chyba = výjimka: prázdná
  // mapa by jinak každý řádek natrvalo zrušila jako „bez zařízení".
  const lide = [...new Set(radky.map((r) => r.user_id))]
  const zarizeni = new Map<string, (OdberPush & { id: string })[]>()
  const { data: odbery, error: chybaOdberu } = await supabase
    .from('push_odbery')
    .select('id, user_id, endpoint, p256dh, auth_secret')
    .in('user_id', lide)
    .is('vypnuto_kdy', null)
  if (chybaOdberu) throw chybaOdberu
  for (const o of (odbery ?? []) as (OdberPush & { id: string; user_id: string })[]) {
    zarizeni.set(o.user_id, [...(zarizeni.get(o.user_id) ?? []), o])
  }

  const zacatek = ted()
  for (const r of radky) {
    if (ted() - zacatek > rozpocet) {
      vysledek.odlozeno++
      continue
    }

    const moje = zarizeni.get(r.user_id) ?? []
    if (moje.length === 0) {
      await supabase
        .from('notifikace_doruceni')
        .update({ stav: 'zruseno', chyba: 'Člověk už nemá žádné zařízení.' })
        .eq('id', r.id)
        .eq('stav', 'k_odeslani')
      vysledek.bez_zarizeni++
      continue
    }

    // Zabrat a vyřadit z fronty — viz hlavička.
    const pokusu = r.pokusu + 1
    const { data: zabrano, error: chybaZabrani } = await supabase
      .from('notifikace_doruceni')
      .update({ stav: 'selhalo', pokusu, chyba: NEDOKONCENO })
      .eq('id', r.id)
      .eq('stav', 'k_odeslani')
      .eq('pokusu', r.pokusu)
      .select('id')
    if (chybaZabrani) throw chybaZabrani
    if (!zabrano || zabrano.length === 0) {
      vysledek.nezabrano++
      continue
    }

    const zprava = slozitPush({
      typ: r.typ,
      pocet: r.pocet,
      druh: r.notifications?.druh ?? null,
      telo: (r.notifications?.telo as RadekDoruceni['telo']) ?? null,
      priorita: r.notifications?.priorita ?? null,
    })

    let odeslano = false
    let posledniChyba = ''
    const odpovedi = await Promise.all(
      moje.map(async (z) => ({
        z,
        v: await odeslat(z, zprava, klice, { urgency: zprava.urgent ? 'high' : 'normal' }),
      })),
    )
    for (const { z, v } of odpovedi) {
      if (v.stav === 'odeslano') {
        odeslano = true
        await supabase.from('push_odbery').update({ posledni_uspech_kdy: new Date(ted()).toISOString() }).eq('id', z.id)
      } else if (v.stav === 'vyprselo' || v.stav === 'neplatny') {
        // Zařízení odběr zrušilo (nebo má adresu, na kterou se neposílá): nezkouší se dál.
        await supabase.from('push_odbery').update({ vypnuto_kdy: new Date(ted()).toISOString() }).eq('id', z.id)
      } else {
        posledniChyba = v.chyba
      }
    }

    // Konečný zápis jen do řádku, který je pořád náš (zabraný, stejný pokus).
    if (odeslano) {
      await supabase
        .from('notifikace_doruceni')
        .update({ stav: 'odeslano', odeslano_kdy: new Date(ted()).toISOString(), chyba: null })
        .eq('id', r.id)
        .eq('stav', 'selhalo')
        .eq('pokusu', pokusu)
      vysledek.odeslano++
    } else {
      const chyba = (posledniChyba || 'Zařízení odběr zrušila.').slice(0, 500)
      const znovu = pokusu < NEJVIC_POKUSU && posledniChyba !== ''
      await supabase
        .from('notifikace_doruceni')
        .update(znovu ? { stav: 'k_odeslani', chyba } : { chyba })
        .eq('id', r.id)
        .eq('stav', 'selhalo')
        .eq('pokusu', pokusu)
      vysledek.selhalo++
    }
  }

  return vysledek
}
