import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { canSee } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import { zkusPristupRezervacim } from '../pristup'
import { NapojeniObsah, type Napojeni } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Rezervace → Napojení a import.
 *
 * Tři věci na jednom místě:
 *   1. stav napojení na rezervační systém u každé pobočky — vidí ho
 *      každý, kdo vidí rezervace (přes `rezervace_napojeni`, registr sám
 *      čte jen `finance.read`);
 *   2. příprava a odpojení napojení — jen `integrace.manage`, stejné
 *      právo jako u pokladny a banky;
 *   3. načtení rezervací ze souboru — `rezervace.manage` na pobočce.
 *
 * Napojení vzniká jako „čeká na připojení“. Adaptér žádného systému
 * zatím není (bez dokumentace a přístupu se nevymýšlí) a „připojeno“
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

  return (
    <NapojeniObsah
      rozsah={rozsah}
      pobocky={pobocky}
      napojeni={napojeni}
      smiSpravovat={canSee(ctx, 'integrace.manage')}
      stav={stav}
      chyba={chyba}
    />
  )
}
