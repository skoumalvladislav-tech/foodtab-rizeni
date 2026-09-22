import { NextResponse } from 'next/server'

import { slozitPush, type RadekDoruceni } from '@/lib/komunikace/push-zprava'
import { nactiKliceVapid, odeslatWebPush, type OdberPush } from '@/lib/komunikace/web-push'
import { funkceNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: externí oznámení (push).
 *
 * ---------------------------------------------------------------------
 * CO TADY BĚŽÍ A CO NE
 *
 * 1. `uvolnit_cekajici_notifikace` — kdo mezitím přišel do práce, tomu se
 *    čekající oznámení uvolní (jedno samo, víc jako souhrn „Čekají na vás
 *    N zpráv“). Docházka se kvůli tomu NEZPOMALUJE: nic se neděje při
 *    píchnutí, jen tady po čase. Cena: mezi příchodem a pípnutím uplyne
 *    nejvýš interval plánovače. V aplikaci se čekající zprávy ukazují hned.
 * 2. Odeslání toho, co je ve frontě `k_odeslani` — MIMO transakci zdroje,
 *    aby výpadek push služby nikdy neshodil `ulozit_smenu` ani `poslat_zpravu`.
 *
 * ---------------------------------------------------------------------
 * BEZ KLÍČŮ VAPID SE NIC NEPŘEDSTÍRÁ
 *
 * Bez klíčů (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) se nic
 * neodešle a fronta zůstane čekat — odpověď to říká slovem „nakonfigurovano:
 * false“. Řádky starší než 48 hodin se označí `nedostupny` (novinkou už
 * nejsou). Klíč a zařízení vydává Šéfík; do té doby je push PŘIPRAVENÝ, ne
 * zapnutý.
 *
 * ---------------------------------------------------------------------
 * ZABEZPEČENÍ
 *
 * Stejně jako ostatní úlohy: tajemství `CRON_SECRET` v konstantním čase,
 * klíč `service_role` jen na serveru (`klientUlohy`), bez tajemství 401
 * a nic dalšího. Do odpovědi se nedostává nic z obsahu upozornění.
 *
 * Kód se nasazuje dřív než migrace: bez tabulek/funkcí odpoví 200 se stavem
 * `ceka_na_migraci`, aby plánovač nehlásil chybu za to, že se čeká na `db push`.
 */

export const dynamic = 'force-dynamic'

const DAVKA = 100
const NEJVIC_POKUSU = 3

/**
 * Kolik ms smí dávka odesílat. Zařízení jednoho člověka se posílají
 * souběžně (každé má vlastní timeout 8 s), ale pomalá push služba by dávku
 * jinak natáhla přes limit funkce — nedokončená dávka by pak řádky neoznačila
 * a při dalším běhu by šla znovu. Co se nestihne, zůstane `k_odeslani`.
 */
const ROZPOCET_MS = 45_000

type Doruceni = {
  id: string
  user_id: string
  notification_id: string | null
  typ: 'jedna' | 'souhrn'
  pocet: number
  pokusu: number
  notifications: { druh: string; telo: Record<string, unknown>; priorita: string } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const supabase = klientUlohy()
  if (!supabase) {
    return NextResponse.json({ chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })
  }

  // JEN podle kódu chyby (chybí funkce / tabulka). Volný text („does not exist“)
  // by za čekání na migraci vydal i skutečnou chybu uvnitř funkce po nasazení:
  // plánovač by odpověděl 200, workflow zůstal zelený a push by se tiše
  // nikdy neodeslal.
  const chybiMigrace = (e: Parameters<typeof funkceNeexistuje>[0]) =>
    e !== null && (funkceNeexistuje(e) || tabulkaNeexistuje(e))

  // 1. Uvolnění čekajících
  const { data: uvolneno, error: chybaUvolneni } = await supabase.rpc('uvolnit_cekajici_notifikace')
  if (chybaUvolneni) {
    if (chybiMigrace(chybaUvolneni)) return NextResponse.json({ stav: 'ceka_na_migraci' })
    return NextResponse.json({ chyba: chybaUvolneni.message }, { status: 500 })
  }

  // 2. Co je k odeslání
  const { data: fronta, error: chybaFronty } = await supabase
    .from('notifikace_doruceni')
    .select('id, user_id, notification_id, typ, pocet, pokusu, notifications(druh, telo, priorita)')
    .eq('stav', 'k_odeslani')
    .order('created_at', { ascending: true })
    .limit(DAVKA)
  if (chybaFronty) {
    if (chybiMigrace(chybaFronty)) return NextResponse.json({ stav: 'ceka_na_migraci' })
    return NextResponse.json({ chyba: chybaFronty.message }, { status: 500 })
  }
  const radky = (fronta ?? []) as unknown as Doruceni[]

  const klice = nactiKliceVapid(process.env)
  const zacatek = Date.now()
  const vysledek = { uvolneno: uvolneno ?? 0, ve_fronte: radky.length, odeslano: 0, selhalo: 0, bez_zarizeni: 0, nakonfigurovano: klice !== null, propadlo: 0, odlozeno: 0 }

  if (!klice) {
    // Nic se neposílá. Zastaralé řádky se označí, ať fronta neroste donekonečna.
    const hranice = new Date(Date.now() - 48 * 3600_000).toISOString()
    const { data: propadle } = await supabase
      .from('notifikace_doruceni')
      .update({ stav: 'nedostupny', chyba: 'Push není nakonfigurovaný (chybí klíče VAPID).' })
      .eq('stav', 'k_odeslani')
      .lt('created_at', hranice)
      .select('id')
    vysledek.propadlo = propadle?.length ?? 0
    return NextResponse.json(vysledek)
  }

  // Zařízení všech dotčených lidí jedním dotazem.
  const lide = [...new Set(radky.map((r) => r.user_id))]
  const zarizeni = new Map<string, (OdberPush & { id: string })[]>()
  if (lide.length > 0) {
    const { data: odbery } = await supabase
      .from('push_odbery')
      .select('id, user_id, endpoint, p256dh, auth_secret')
      .in('user_id', lide)
      .is('vypnuto_kdy', null)
    for (const o of (odbery ?? []) as (OdberPush & { id: string; user_id: string })[]) {
      zarizeni.set(o.user_id, [...(zarizeni.get(o.user_id) ?? []), o])
    }
  }

  for (const r of radky) {
    if (Date.now() - zacatek > ROZPOCET_MS) {
      vysledek.odlozeno++
      continue
    }
    const moje = zarizeni.get(r.user_id) ?? []
    if (moje.length === 0) {
      await supabase.from('notifikace_doruceni').update({ stav: 'zruseno', chyba: 'Člověk už nemá žádné zařízení.' }).eq('id', r.id)
      vysledek.bez_zarizeni++
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
        v: await odeslatWebPush(z, zprava, klice, { urgency: zprava.urgent ? 'high' : 'normal' }),
      })),
    )
    for (const { z, v } of odpovedi) {
      if (v.stav === 'odeslano') {
        odeslano = true
        await supabase.from('push_odbery').update({ posledni_uspech_kdy: new Date().toISOString() }).eq('id', z.id)
      } else if (v.stav === 'vyprselo' || v.stav === 'neplatny') {
        // Zařízení odběr zrušilo (nebo má adresu, na kterou se neposílá): nezkouší se dál.
        await supabase.from('push_odbery').update({ vypnuto_kdy: new Date().toISOString() }).eq('id', z.id)
      } else {
        posledniChyba = v.chyba
      }
    }

    if (odeslano) {
      await supabase
        .from('notifikace_doruceni')
        .update({ stav: 'odeslano', odeslano_kdy: new Date().toISOString(), pokusu: r.pokusu + 1, chyba: null })
        .eq('id', r.id)
      vysledek.odeslano++
    } else {
      const pokusu = r.pokusu + 1
      await supabase
        .from('notifikace_doruceni')
        .update({
          pokusu,
          chyba: (posledniChyba || 'Zařízení odběr zrušila.').slice(0, 500),
          stav: pokusu >= NEJVIC_POKUSU || posledniChyba === '' ? 'selhalo' : 'k_odeslani',
        })
        .eq('id', r.id)
      vysledek.selhalo++
    }
  }

  return NextResponse.json(vysledek)
}
