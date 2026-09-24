import { NextResponse } from 'next/server'

import { odeslatFrontu, PRAZDNY_VYSLEDEK } from '@/lib/komunikace/fronta-push'
import { nactiKliceVapid } from '@/lib/komunikace/web-push'
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
 *    Logika je v `lib/komunikace/fronta-push.ts`, sdílená s odesláním hned
 *    po zprávě (`lib/komunikace/push-hned.ts`). Tady je to ZÁLOHA pro to, co
 *    hned neodešlo, a hlavní cesta pro vše ostatní (úkoly, směny, checklisty).
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

type ChybaDotazu = Parameters<typeof funkceNeexistuje>[0]

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
  const chybiMigrace = (e: ChybaDotazu) => e !== null && (funkceNeexistuje(e) || tabulkaNeexistuje(e))

  // 1. Uvolnění čekajících
  const { data: uvolneno, error: chybaUvolneni } = await supabase.rpc('uvolnit_cekajici_notifikace')
  if (chybaUvolneni) {
    if (chybiMigrace(chybaUvolneni)) return NextResponse.json({ stav: 'ceka_na_migraci' })
    return NextResponse.json({ chyba: chybaUvolneni.message }, { status: 500 })
  }

  const klice = nactiKliceVapid(process.env)

  if (!klice) {
    // Nic se neposílá. Zastaralé řádky se označí, ať fronta neroste donekonečna.
    const hranice = new Date(Date.now() - 48 * 3600_000).toISOString()
    const { data: propadle } = await supabase
      .from('notifikace_doruceni')
      .update({ stav: 'nedostupny', chyba: 'Push není nakonfigurovaný (chybí klíče VAPID).' })
      .eq('stav', 'k_odeslani')
      .lt('created_at', hranice)
      .select('id')
    return NextResponse.json({ uvolneno: uvolneno ?? 0, nakonfigurovano: false, propadlo: propadle?.length ?? 0, ...PRAZDNY_VYSLEDEK })
  }

  // 2. Odeslání fronty (chyba dotazu z odeslatFrontu přijde jako výjimka).
  try {
    const vysledek = await odeslatFrontu(supabase, klice)
    return NextResponse.json({ uvolneno: uvolneno ?? 0, nakonfigurovano: true, propadlo: 0, ...vysledek })
  } catch (e) {
    const chyba = e as ChybaDotazu
    if (chybiMigrace(chyba)) return NextResponse.json({ stav: 'ceka_na_migraci' })
    const zprava = e instanceof Error ? e.message : ((e as { message?: string } | null)?.message ?? 'Neznámá chyba.')
    return NextResponse.json({ chyba: zprava }, { status: 500 })
  }
}
