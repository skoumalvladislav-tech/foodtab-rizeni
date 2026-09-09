'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Uložení oprávnění jednoho ZAŘAZENÍ.
 *
 * Od 9. 9. 2026 (migrace 20260909100000) nesou oprávnění zařazení, ne
 * role. Zapisuje se proto do `position_permissions` — role v databázi
 * zůstávají, ale o přístupu už nerozhodují.
 *
 * Zapisuje se ROZDÍL, ne „smaž všechno a vlož znovu“. Dva důvody:
 * audit by jinak u každého uložení hlásil odebrání a přidání všech práv
 * a v zápisu by se ztratilo, co se doopravdy změnilo; a nikdo by na
 * chvíli neměl žádné právo, i kdyby se nakonec nic nezměnilo.
 *
 * ŽIVÉ PRAVIDLO: co se tu uloží, platí okamžitě všem, kdo to zařazení
 * mají. Nic se nikam nekopíruje — proto je na obrazovce vidět, kolika
 * lidí se změna týká.
 *
 * Majitel se sem nedostane: majitelství je vlastnost ČLOVĚKA
 * (`employees.je_majitel`), ne zařazení. Dostává všechno z aktivních
 * modulů přes `app.has_access` a odebrat se mu to tudy nedá.
 */
export async function ulozitOpravneni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zarazeniId = String(formData.get('zarazeni') ?? '')
  const zvolena = new Set(formData.getAll('pravo').map(String))
  // Co obrazovka vůbec nabízela. Bez toho by se odebrala i práva
  // z vypnutých modulů, která se nekreslila a nikdo je neodškrtl.
  const nabizena = new Set(formData.getAll('nabizeno').map(String))

  if (!zarazeniId) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  const { data: zarazeni, error: chybaZarazeni } = await supabase
    .from('positions')
    .select('id, label')
    .eq('id', zarazeniId)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (chybaZarazeni) throw new DotazSelhal('zařazení', chybaZarazeni)

  const toto = zarazeni?.[0] as { id: string; label: string } | undefined
  if (!toto) redirect(`/${rozsah}/nastaveni/role?chyba=neznama`)

  const { data: soucasna, error: chybaSoucasna } = await supabase
    .from('position_permissions')
    .select('permission_key')
    .eq('position_id', zarazeniId)
  // Prázdný seznam znamená zařazení bez práv. Kdyby se sem propadla
  // chyba dotazu, spočítal by se rozdíl proti prázdnu a uložení by
  // zařazení přidalo všechno zaškrtnuté jako nové — a nic by na tom
  // nevypadalo divně.
  if (chybaSoucasna) throw new DotazSelhal('oprávnění zařazení', chybaSoucasna)

  const ma = new Set((soucasna ?? []).map((r) => String(r.permission_key)))

  const pridat = [...zvolena].filter((k) => nabizena.has(k) && !ma.has(k))
  const odebrat = [...ma].filter((k) => nabizena.has(k) && !zvolena.has(k))

  if (odebrat.length > 0) {
    const { error } = await supabase
      .from('position_permissions')
      .delete()
      .eq('position_id', zarazeniId)
      .in('permission_key', odebrat)
    if (error) redirect(`/${rozsah}/nastaveni/role?chyba=${kod(error.code)}`)
  }

  if (pridat.length > 0) {
    /*
      `tenant_id` se posílá výslovně. Tabulka ho má kvůli AUDITU —
      bez něj vyjde v `app.audit_zmenu` firma NULL a funkce se vrátí
      bez zápisu, TIŠE. Zásah do oprávnění by se neuložil nikam.
    */
    const { error } = await supabase
      .from('position_permissions')
      .insert(
        pridat.map((k) => ({
          tenant_id: tenantId,
          position_id: zarazeniId,
          permission_key: k,
        })),
      )
    if (error) redirect(`/${rozsah}/nastaveni/role?chyba=${kod(error.code)}`)
  }

  revalidatePath(`/${rozsah}/nastaveni/role`)
  redirect(
    `/${rozsah}/nastaveni/role?ulozeno=${encodeURIComponent(toto.label)}` +
      `&pridano=${pridat.length}&odebrano=${odebrat.length}`,
  )
}

/** 42501 = nedostatečné oprávnění. Ostatní se nerozlišují. */
function kod(c: string | undefined): string {
  return c === '42501' ? 'pravo' : 'nepovedlo'
}
