'use server'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Šablony, které se mají nabídnout ve formuláři směny.
 *
 * ---------------------------------------------------------------------
 * PROČ SE PTÁ DATABÁZE, A NE PROHLÍŽEČ
 *
 * Která šablona pro danou pobočku a pozici vyhraje, rozhoduje
 * `app.sablona_poradi` — čtyři pravidla od nejužšího k nejširšímu.
 * Napsat totéž ještě jednou v JavaScriptu, aby se dalo vybírat bez
 * dotazu, by znamenalo dvě pravdy o téže věci. Rozešly by se při
 * první změně a rozešly by se tiše: nabídka by ukazovala jednu
 * šablonu a rozpis by se choval podle jiné.
 *
 * Proto se při každé změně pobočky nebo pozice zeptáme databáze.
 * Je to obyčejný select nad hrstkou řádků.
 *
 * Když se dotaz nepovede, vrátí se prázdno a formulář se chová jako
 * dřív — časy se napíšou ručně. Šablona je pohodlí, ne podmínka.
 */

export type NabidnutaSablona = {
  klic: string
  label: string
  od: string
  do: string
  minut: number
}

export async function nabidnoutSablony(
  rozsah: string,
  pobocka: string,
  pozice: string | null,
): Promise<NabidnutaSablona[]> {
  if (!pobocka) return []

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return []

  /*
    Nabídka se týká plánování, proto `shifts.manage` — kdo směny
    nezadává, nabídku k zadávání nepotřebuje. Pobočka z prohlížeče je
    návrh (pravidlo 4); druhou obrannou linii má `sablony_pro_smenu`,
    která si čtení na té pobočce ověří sama.
  */
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') return []

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('sablony_pro_smenu', {
    p_tenant: tenantId,
    p_branch: pobocka,
    p_position: pozice,
  })
  if (error) return []

  return (
    (data as
      | { klic: string; label: string; starts_at: string; ends_at: string; minut: number }[]
      | null) ?? []
  ).map((s) => ({
    klic: s.klic,
    label: s.label,
    // „HH:MM“ do políčka `type="time"`. Databáze vrací „HH:MM:SS“.
    od: String(s.starts_at).slice(0, 5),
    do: String(s.ends_at).slice(0, 5),
    minut: s.minut,
  }))
}
