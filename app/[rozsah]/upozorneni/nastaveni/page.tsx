import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import ObsahNastaveniUpozorneni, { type Kategorie } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Nastavení upozornění.
 *
 * Od 27. 9. je k nalezení i v Nastavení (položka „Upozornění“ vedle
 * Mých údajů) a z panelu u zvonečku — Šéfík 22. 9.: „v nastavení není
 * okénko upozornění“. Do té doby se sem šlo jen ze stránky Upozornění.
 *
 * Tady se jen načte stav; vykreslení je v `obsah.tsx` (dá se tak
 * vykreslit i v dočasném náhledu). Co jde vypnout a proč jen to, je
 * popsané tam.
 */
export default async function NastaveniUpozorneni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { ulozeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const ctx = await getContext(tenantId)

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('kategorie, povoleno')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
  // Rámeček „čeká na nasazení databáze“ tu byl do 27. 9. (tabulka je
  // nasazená od 17. 9.). Chyba je chyba.
  if (error) throw new DotazSelhal('nastavení upozornění', error)

  // Chybějící řádek = zapnuto (stejná výchozí hodnota jako v databázi,
  // app.upozorneni_povoleno) — obrazovka nesmí ukázat jiný stav, než
  // jaký doopravdy platí.
  const povoleno: Record<Kategorie, boolean> = { vzkazy: true, nastenka: true }
  for (const radek of (data ?? []) as { kategorie: string; povoleno: boolean }[]) {
    if (radek.kategorie === 'vzkazy' || radek.kategorie === 'nastenka') {
      povoleno[radek.kategorie] = radek.povoleno
    }
  }

  return (
    <ObsahNastaveniUpozorneni
      rozsah={rozsah}
      povoleno={povoleno}
      chyba={chyba ?? null}
      ulozeno={Boolean(ulozeno)}
      jeMajitel={ctx?.jeMajitel ?? false}
      verejnyKlic={process.env.VAPID_PUBLIC_KEY?.trim() || null}
    />
  )
}
