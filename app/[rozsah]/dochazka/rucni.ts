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

  /*
    Čas jde do databáze TAK, JAK HO ČLOVĚK NAPSAL — jako hodina na zdi,
    bez pásma. Pásmo k ní dodá pobočka uvnitř `zapsat_rucni_dochazku`.

    Dřív tu bylo `new Date(kdy).toISOString()`. Ten řetězec pásmo nemá,
    takže ho JavaScript přečetl v pásmu SERVERU — a ten je na Vercelu
    v UTC. Z „22:00 pražského času“ se uložila půlnoc pražského času
    a směna vyšla o dvě hodiny delší. Viz
    docs/odpoved-na-nalez-casu-2026-09-02.md.
  */
  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('zapsat_rucni_dochazku', {
    p_tenant: tenantId,
    p_branch: pobocka,
    p_employee: zamestnanec,
    p_druh: druh,
    // Například „2026-08-31T22:00“. Žádný převod tady, viz výš.
    p_kdy: kdy,
    p_duvod: duvod,
  })

  if (error) {
    redirect(
      `/${rozsah}/dochazka?chyba=zapis&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/dochazka`)
  redirect(`/${rozsah}/dochazka?zapsano=1`)
}
