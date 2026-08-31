'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Uložení jedné sady oprávnění.
 *
 * Zapisuje se ROZDÍL, ne „smaž všechno a vlož znovu“. Dva důvody:
 * audit by jinak u každého uložení hlásil odebrání a přidání všech práv
 * a v zápisu by se ztratilo, co se doopravdy změnilo; a nikdo by na
 * chvíli neměl žádné právo, i kdyby se nakonec nic nezměnilo.
 *
 * Majitel se sem nedostane: jeho sada se needituje, dostává všechno
 * z aktivních modulů přes app.has_access. Kdyby se sem přece jen
 * dostal požadavek na majitelskou roli, odmítne se.
 */
export async function ulozitOpravneni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const roleId = String(formData.get('role') ?? '')
  const zvolena = new Set(formData.getAll('pravo').map(String))
  // Co obrazovka vůbec nabízela. Bez toho by se odebrala i práva
  // z vypnutých modulů, která se nekreslila a nikdo je neodškrtl.
  const nabizena = new Set(formData.getAll('nabizeno').map(String))

  if (!roleId) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  const { data: role } = await supabase
    .from('roles')
    .select('id, is_owner, label')
    .eq('id', roleId)
    .eq('tenant_id', tenantId)
    .limit(1)

  const tato = role?.[0] as { id: string; is_owner: boolean; label: string } | undefined
  if (!tato) redirect(`/${rozsah}/nastaveni/role?chyba=neznama`)
  if (tato.is_owner) redirect(`/${rozsah}/nastaveni/role?chyba=majitel`)

  const { data: soucasna } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', roleId)

  const ma = new Set((soucasna ?? []).map((r) => String(r.permission_key)))

  const pridat = [...zvolena].filter((k) => nabizena.has(k) && !ma.has(k))
  const odebrat = [...ma].filter((k) => nabizena.has(k) && !zvolena.has(k))

  if (odebrat.length > 0) {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .in('permission_key', odebrat)
    if (error) redirect(`/${rozsah}/nastaveni/role?chyba=${kod(error.code)}`)
  }

  if (pridat.length > 0) {
    const { error } = await supabase
      .from('role_permissions')
      .insert(pridat.map((k) => ({ role_id: roleId, permission_key: k })))
    if (error) redirect(`/${rozsah}/nastaveni/role?chyba=${kod(error.code)}`)
  }

  revalidatePath(`/${rozsah}/nastaveni/role`)
  redirect(
    `/${rozsah}/nastaveni/role?ulozeno=${encodeURIComponent(tato.label)}` +
      `&pridano=${pridat.length}&odebrano=${odebrat.length}`,
  )
}

/** 42501 = nedostatečné oprávnění. Ostatní se nerozlišují. */
function kod(c: string | undefined): string {
  return c === '42501' ? 'pravo' : 'nepovedlo'
}
