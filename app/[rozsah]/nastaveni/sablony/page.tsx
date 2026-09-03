import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import ObrazovkaSablon, { type SablonaRadek } from './obrazovka'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Šablony směn.
 *
 * Zadání docs/sablony-smen-zadani.md.
 *
 * Tahle stránka jen načítá a ověřuje přístup; kreslí `obrazovka.tsx`.
 * Rozdělené je to proto, aby šlo vykreslení ověřit kontrolou nad
 * hotovým HTML — server component s `await` se v kontrole vykreslit
 * nedá.
 *
 * Načítají se i vyřazené šablony. Nabídka ve směně je nedostane
 * (`sablony_pro_smenu` bere jen `active`), ale správa musí umět vrátit
 * do nabídky to, co se vyřadilo omylem.
 */
export default async function NastaveniSablony({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; stav?: string }>
}) {
  const { rozsah } = await params
  const { chyba, stav } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Šablony směn spravuje jen oprávnění s právem <code>settings.manage</code>.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const { data, error: chybaData } = await supabase
    .from('sablony_smen')
    .select('id, key, label, starts_at, ends_at, poradi, active, branch_id, position_id')
    .eq('tenant_id', tenantId)
    // Stejné pořadí jako v nabídce u směny: `poradi`, pak zkratka.
    // Kdyby se řadilo jinak, správa by ukazovala jiný sled než to,
    // co pak člověk uvidí ve formuláři.
    .order('poradi')
    .order('key')
  if (chybaData) throw new DotazSelhal('šablony směn', chybaData)

  const { data: pobocky, error: chybaPobocek } = await supabase
    .from('branches')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name')
  if (chybaPobocek) throw new DotazSelhal('pobočky', chybaPobocek)

  const { data: pozice, error: chybaPozic } = await supabase
    .from('positions')
    .select('id, label')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label')
  if (chybaPozic) throw new DotazSelhal('pozice', chybaPozic)

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Pojmenované směny s časy. Ve formuláři směny se pak vyberou jedním kliknutím."
      >
        Šablony směn
      </Nadpis>

      <ObrazovkaSablon
        rozsah={rozsah}
        sablony={(data ?? []) as SablonaRadek[]}
        pobocky={(pobocky ?? []).map((b) => ({ id: b.id as string, nazev: b.name as string }))}
        pozice={(pozice ?? []).map((p) => ({ id: p.id as string, label: p.label as string }))}
        chyba={chyba}
        stav={stav}
      />
    </>
  )
}
