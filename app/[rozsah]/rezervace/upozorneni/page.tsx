import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import { zkusPristupRezervacim } from '../pristup'
import { UpozorneniObsah, type ClovekUpozorneni } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Rezervace → Upozornění: komu u které pobočky chodí upozornění
 * k akcím, k rezervacím a ranní souhrn (zadání Šéfíka 2. 11. 2026).
 *
 * Jen pro toho, kdo rezervace zapisuje (`rezervace.manage`), a jen
 * u poboček, kde zapisuje. Seznam lidí i uložení jdou přes funkce
 * `rezervace_upozorneni_*`, které se na právo ptají znovu a nabídnou
 * jen lidi, kteří rezervace té pobočky vidí. Kreslí obsah.tsx.
 */
export default async function RezervaceUpozorneni({
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

  const spravovane = pristup.pobocky.filter((p) => p.zapis)
  if (spravovane.length === 0) {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Komu chodí upozornění k rezervacím a akcím, nastavuje ten, kdo má právo „Zapisovat rezervace a akce, poznámky a přílohy“.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()
  const nactene = await Promise.all(
    spravovane.map(async (pobocka) => {
      const { data, error } = await supabase.rpc('rezervace_upozorneni_lide', { p_tenant: tenantId, p_branch: pobocka.id })
      // Migrace 20261106100000 ještě není v databázi — obrazovka to řekne, nespadne.
      if (funkceNeexistuje(error)) return { pobocka, lide: [] as ClovekUpozorneni[], nenasazeno: true }
      if (error) throw new DotazSelhal('upozornění k rezervacím', error)
      return { pobocka, lide: (data ?? []) as ClovekUpozorneni[], nenasazeno: false }
    }),
  )

  return (
    <UpozorneniObsah
      rozsah={rozsah}
      pobocky={nactene.map(({ pobocka, lide }) => ({ pobocka, lide }))}
      nenasazeno={nactene.some((n) => n.nenasazeno)}
      stav={stav}
      chyba={chyba}
    />
  )
}
