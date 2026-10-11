import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { sifrovaniJeNastavene } from '@/lib/integrace-klice'
import { vychoziHistorieOd } from '@/lib/pokladna-cas'
import Sdeleni from '@/app/sdeleni'
import Navigace from '../../navigace'
import ObsahPokladen, { type Pripojeni } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Integrace → Pokladní systémy.
 *
 * Šéfík 11. 10. 2026: „univerzální forma připojení — je spoustu POS…
 * okénko, kam se vloží API token a POS se připojí… a provozovna šla
 * přiřadit ke konkrétnímu profilu zde v appce."
 *
 *   * Formuláře se kreslí ze seznamu `lib/pokladna-poskytovatele.ts`:
 *     u každé pokladny její políčka, návod a jedno tlačítko.
 *   * Připojení s tokenem patří firmě; jeho provozovny se přiřazují
 *     k pobočkám v tabulce u připojení (nebo se nestahují).
 *   * Pokladna, kterou appka nezná, jde přes příjmové API (klíč = jedna
 *     pobočka) nebo CSV.
 *
 * Vidí každý s `finance.read`, připojovat/přiřazovat/odpojovat smí jen
 * `integrace.manage` (stejně jako banka a e-mail).
 */

export default async function PokladniSystemy({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; ok?: string }>
}) {
  const { rozsah } = await params
  const { chyba, ok } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Pokladní systémy vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'integrace.manage')
  const sifrovani = sifrovaniJeNastavene()
  const prihlaseniDotykacka = Boolean(process.env.DOTYKACKA_CLIENT_ID && process.env.DOTYKACKA_CLIENT_SECRET)

  const supabase = await getServerSupabase()
  const [pobockyRes, pripojeniRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null).order('name'),
    supabase
      .from('integrace_pripojeni')
      .select('id, branch_id, poskytovatel, stav, nazev, externi_ucet, posledni_sync_kdy, posledni_sync_pocet_radku, posledni_chyba')
      .eq('tenant_id', tenantId)
      .eq('oblast', 'pokladna')
      .is('odpojeno_kdy', null)
      .order('vytvoreno_kdy'),
  ])


  const pobocky = (pobockyRes.data ?? []) as { id: string; name: string }[]
  const pripojeni = (pripojeniRes.data ?? []) as Pripojeni[]
  const historieVychozi = vychoziHistorieOd(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date()))

  return (
    <Navigace rozsah={rozsah}>
      <ObsahPokladen
        rozsah={rozsah}
        chyba={chyba}
        ok={ok}
        smiPsat={smiPsat}
        sifrovani={sifrovani}
        prihlaseniDotykacka={prihlaseniDotykacka}
        pobocky={pobocky}
        pripojeni={pripojeni}
        historieVychozi={historieVychozi}
      />
    </Navigace>
  )
}
