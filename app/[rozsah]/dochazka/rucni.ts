'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Ruční zápis docházky.
 *
 * Zadání docs/dochazka-qr-zadani.md, oddíl 4. Musí existovat — někdo
 * zapomene telefon a odpracovaná směna se nesmí ztratit — ale nesmí
 * vypadat stejně jako píchnutí.
 *
 * Proto se vždycky zapisuje `source = 'manual'`. Nikdy se nebere
 * z formuláře: kdyby šlo poslat 'app', ruční zápis by se schoval mezi
 * píchnutí a celý oddíl 4 by byl k ničemu.
 *
 * Kdo ho zadal, doplňuje spoušť v databázi z přihlášeného účtu. Odsud
 * se to neposílá vůbec.
 */
export async function zapsatRucne(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  const druh = String(formData.get('druh') ?? '')
  const kdy = String(formData.get('kdy') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()

  if (!zamestnanec || !pobocka || !druh || !kdy) {
    redirect(`/${rozsah}/dochazka?chyba=neuplne`)
  }
  if (duvod.length < 3) {
    redirect(`/${rozsah}/dochazka?chyba=duvod`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  // První obranná linie. Druhá je politika attendance_insert, která
  // ruční zápis pustí jedině s attendance.manage na té pobočce.
  const pristup = await zkusPristup(tenantId, 'attendance.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.from('attendance_events').insert({
    tenant_id: tenantId,
    branch_id: pobocka,
    employee_id: zamestnanec,
    kind: druh,
    occurred_at: new Date(kdy).toISOString(),
    source: 'manual',
    note: duvod,
  })

  if (error) {
    redirect(
      `/${rozsah}/dochazka?chyba=zapis&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/dochazka`)
  redirect(`/${rozsah}/dochazka?zapsano=1`)
}
