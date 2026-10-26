import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { canSee, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { zakladniAdresaAplikace } from '@/lib/integrace-adresa'
import { sifrovaniJeNastavene } from '@/lib/integrace-klice'
import { nastaveniChoice } from '@/lib/rezervace-choice'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import { zkusPristupRezervacim } from '../pristup'
import { NapojeniObsah, type Napojeni } from './obsah'

export const dynamic = 'force-dynamic'
// „Načíst teď“ a „Ověřit znovu“ u Choice čekají ve frontě dotazů (Choice: 1 dotaz za 5 s).
export const maxDuration = 60

/**
 * Rezervace → Napojení a import.
 *
 * Tři věci na jednom místě:
 *   1. stav napojení na rezervační systém u každé pobočky — vidí ho
 *      každý, kdo vidí rezervace (přes `rezervace_napojeni`, registr sám
 *      čte jen `finance.read`);
 *   2. příprava a odpojení napojení — jen `integrace.manage`, stejné
 *      právo jako u pokladny a banky;
 *   3. načtení rezervací ze souboru — `rezervace.manage` na pobočce;
 *   4. Choice (choice-karta.tsx): připojení podniku a „Ověřit znovu“ jen
 *      `integrace.manage` NA TÉ POBOČCE, „Načíst teď“ i `rezervace.manage`.
 *      Bez CHOICE_CLIENT_ID/SECRET karta ukáže „čeká na nastavení“.
 *
 * Napojení vzniká jako „čeká na připojení“. Adaptér má zatím jen Choice
 * (u ostatních se bez dokumentace a přístupu nic nevymýšlí) a „připojeno“
 * databáze dovolí jen po ověřeném přístupu. Kreslí obsah.tsx.
 */
export default async function RezervaceNapojeni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ stav?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { stav, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const { pobocky, ctx } = pristup
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('rezervace_napojeni', { p_tenant: tenantId })
  if (error) throw new DotazSelhal('napojení rezervací', error)
  const vRozsahu = new Set(pobocky.map((p) => p.id))
  const napojeni = ((data ?? []) as Napojeni[]).filter((n) => vRozsahu.has(n.branch_id))

  // Správa napojení po pobočkách — databáze ji ověří znovu (RLS, funkce).
  const spravaPobocek = canSee(ctx, 'integrace.manage')
    ? (await Promise.all(pobocky.map(async (p) => ((await hasAccess(tenantId, 'integrace.manage', p.id)) ? p.id : null)))).filter(
        (id): id is string => id !== null,
      )
    : []

  return (
    <NapojeniObsah
      rozsah={rozsah}
      pobocky={pobocky}
      napojeni={napojeni}
      smiSpravovat={canSee(ctx, 'integrace.manage')}
      spravaPobocek={spravaPobocek}
      choiceNastaveno={nastaveniChoice(process.env) !== null && sifrovaniJeNastavene()}
      adresaPrijmu={`${await zakladniAdresaAplikace()}/api/rezervace/prijem`}
      stav={stav}
      chyba={chyba}
    />
  )
}
