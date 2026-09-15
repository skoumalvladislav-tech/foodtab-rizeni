'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  hlavniKategorie,
  najdiPoskytovatele,
  potrebnaPole,
  zkontrolujUdaje,
} from '@/lib/marketing-katalog'
import { rozsifrovat, zasifrovat, sifrovaniJeNastavene } from '@/lib/marketing-klice'
import { otestovatSpojeni } from '@/lib/marketing-spojeni'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Integrace a nástroje — připojení, zkouška, odpojení.
 *
 * Zadání: master prompt v2.2, oddíl 3.1 („Zásadní obchodní požadavek:
 * individuální volba nástrojů zákazníkem") a oddíl 6.
 *
 * ---------------------------------------------------------------------
 * CO Z PROHLÍŽEČE PŘIJDE, JE NÁVRH
 *
 * Pravidlo 4: rozsah se bere z adresy a ověřuje proti členství, ne ze
 * skrytého pole. A stejně tak volba nástroje — `lzePripojit` se ptá
 * znovu tady, i když obrazovka na nepodporovaný nástroj tlačítko
 * nedala. Kdo si formulář přepíše, nesmí si připojit „integraci",
 * která nemá adaptér: spadlo by to až při odesílání, tedy po schválení
 * a naplánování.
 *
 * ---------------------------------------------------------------------
 * ZKOUŠKA JE PŘED PŘIPOJENÍM, NE PO NĚM
 *
 * Zadání, oddíl 3.1: „otestovat spojení před aktivací". Pořadí je tedy
 * zkouška → teprve pak řádek v databázi. Kdyby se zakládalo napřed,
 * zůstalo by po nepovedeném pokusu připojení ve stavu `chyba` i s
 * uloženým klíčem, který nikdy nefungoval.
 *
 * ---------------------------------------------------------------------
 * KLÍČ SE UKLÁDÁ ZVLÁŠŤ A ZAŠIFROVANÝ
 *
 * Do `marketing_pripojeni` nepatří (čte ji každý s `marketing.read`).
 * Jde do `marketing_tajemstvi` přes `marketing_uloz_tajemstvi`, která
 * se sama ptá na `marketing.publish` — CLAUDE.md, pravidlo 7.
 */

/** Společný začátek: firma, právo, rozsah. Právo je `marketing.publish`. */
async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'marketing.publish', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing/nastroje`)

  return {
    tenantId,
    branchId: pristup.scope.branchId,
    supabase: await getServerSupabase(),
  }
}

function zpet(rozsah: string, chyba: string): never {
  redirect(`/${rozsah}/marketing/nastroje?chyba=${encodeURIComponent(chyba)}`)
}

/** Kdo jsem v téhle firmě. Připojení se podepisuje zaměstnancem, ne účtem. */
async function mujZamestnanec(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
): Promise<string | null> {
  const user = await getUser()
  if (!user) return null

  const r = await jeden<{ id: string }>(
    'můj záznam zaměstnance',
    supabase.from('employees').select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle(),
  )
  return r?.id ?? null
}

/**
 * Živá připojení v rozsahu, ve kterém se právě stojí.
 *
 * Firemní rozsah (`branch_id is null`) a pobočkový jsou dva různé
 * výběry — `eq('branch_id', null)` by v PostgREST znamenalo rovnost
 * s NULL, která nikdy neplatí.
 */
function zivaPripojeni(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  branchId: string | null,
) {
  const z = supabase.from('marketing_pripojeni')
    .select('id, poskytovatel, kategorie, rezim, stav')
    .eq('tenant_id', tenantId)
    .is('odpojeno_kdy', null)

  return branchId === null ? z.is('branch_id', null) : z.eq('branch_id', branchId)
}

export async function pripojitNastroj(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, branchId, supabase } = await pripravit(rozsah)

  const klic = String(formData.get('poskytovatel') ?? '')
  const rezim = String(formData.get('rezim') ?? '')
  const poskytovatel = najdiPoskytovatele(klic)
  const kategorie = hlavniKategorie(klic)

  if (!poskytovatel || !kategorie) zpet(rozsah, 'Takový nástroj v katalogu není.')

  const udaje: Record<string, string> = {}
  for (const pole of potrebnaPole(klic, rezim)) {
    udaje[pole.klic] = String(formData.get(`udaj_${pole.klic}`) ?? '').trim()
  }

  const kontrola = zkontrolujUdaje(klic, rezim, udaje)
  if (!kontrola.ok) zpet(rozsah, kontrola.chyba)

  /*
    Bez šifrovacího klíče se zákaznický klíč NEUKLÁDÁ. Žádný náhradní
    režim: uložit ho nezašifrovaně by bylo horší než neuložit vůbec,
    protože by to vypadalo, že připojení funguje.
  */
  if (Object.keys(udaje).length > 0 && !sifrovaniJeNastavene()) {
    zpet(rozsah, 'Na serveru chybí MARKETING_KLIC_SIFRY — zákaznický klíč se bez něj neuloží.')
  }

  const test = await otestovatSpojeni(klic, rezim, udaje)
  if (!test.ok) zpet(rozsah, `Zkouška spojení neprošla: ${test.zprava}`)

  const ja = await mujZamestnanec(supabase, tenantId)
  const ted = new Date().toISOString()

  /*
    JEDEN AKTIVNÍ NÁSTROJ NA KATEGORII.

    Zadání, oddíl 3.1: „vybrat aktivního poskytovatele pro každou
    schopnost" a „poskytovatele později bezpečně změnit bez ztráty
    menu, médií, návrhů a historie". Mění se tedy jen připojení —
    příspěvky a fotky se nedotýkáme.
  */
  const stavajici = await seznam<{ id: string; poskytovatel: string; kategorie: string }>(
    'živá připojení',
    zivaPripojeni(supabase, tenantId, branchId),
  )

  const stejny = stavajici.find((p) => p.poskytovatel === klic)

  for (const jiny of stavajici.filter((p) => p.kategorie === kategorie && p.poskytovatel !== klic)) {
    await odpojit(supabase, jiny.id, ted)
  }

  const radek = {
    tenant_id: tenantId,
    branch_id: branchId,
    poskytovatel: klic,
    kategorie,
    rezim,
    stav: 'pripojeno',
    nazev: poskytovatel.nazev,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    posledni_chyba: null,
    pripojil: ja,
    zmeneno_kdy: ted,
  }

  const ulozeno = stejny
    ? await supabase.from('marketing_pripojeni').update(radek).eq('id', stejny.id).select('id').maybeSingle()
    : await supabase.from('marketing_pripojeni').insert(radek).select('id').maybeSingle()

  if (ulozeno.error || !ulozeno.data) {
    zpet(rozsah, ulozeno.error?.message ?? 'Připojení se nepodařilo uložit.')
  }

  if (Object.keys(udaje).length > 0) {
    const { sifra, otisk } = zasifrovat(udaje)
    const { error } = await supabase.rpc('marketing_uloz_tajemstvi', {
      p_pripojeni: ulozeno.data.id,
      p_sifra: sifra,
      p_otisk: otisk,
    })

    /*
      Klíč se neuložil, ale připojení už stojí. Nesmí zůstat jako
      `pripojeno` — vypadalo by to, že se má z čeho brát.
    */
    if (error) {
      await supabase.from('marketing_pripojeni')
        .update({ stav: 'vyzaduje_pozornost', posledni_test_ok: false, posledni_chyba: error.message })
        .eq('id', ulozeno.data.id)
      zpet(rozsah, `Připojení vzniklo, ale klíč se neuložil: ${error.message}`)
    }
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/nastroje?ulozeno=${encodeURIComponent(poskytovatel.nazev)}`)
}

export async function otestovatPripojeni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, branchId, supabase } = await pripravit(rozsah)
  const id = String(formData.get('pripojeni') ?? '')

  /*
    Připojení se dohledává přes firmu a rozsah, ne jen podle id
    z formuláře. Jinak by stačilo přepsat jedno číslo a zkoušel by se
    účet cizí pobočky.
  */
  const pripojeni = await jeden<{ id: string; poskytovatel: string; rezim: string }>(
    'připojení ke zkoušce',
    zivaPripojeni(supabase, tenantId, branchId).eq('id', id).maybeSingle(),
  )

  if (!pripojeni) zpet(rozsah, 'Takové připojení tu není.')

  let udaje: Record<string, string> = {}

  if (pripojeni.rezim === 'zakaznicky') {
    const { data, error } = await supabase.rpc('marketing_precti_tajemstvi', { p_pripojeni: pripojeni.id })

    if (error || typeof data !== 'string' || !data) {
      await zapsatVysledek(supabase, pripojeni.id, false, 'Uložený klíč se nepodařilo přečíst.')
      zpet(rozsah, 'Uložený klíč se nepodařilo přečíst. Zadejte ho znovu.')
    }

    try {
      udaje = rozsifrovat(data as string)
    } catch {
      await zapsatVysledek(supabase, pripojeni.id, false, 'Uložený klíč se nepodařilo rozšifrovat.')
      zpet(rozsah, 'Uložený klíč se nepodařilo rozšifrovat. Zadejte ho znovu.')
    }
  }

  const test = await otestovatSpojeni(pripojeni.poskytovatel, pripojeni.rezim, udaje)
  await zapsatVysledek(supabase, pripojeni.id, test.ok, test.zprava)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(
    test.ok
      ? `/${rozsah}/marketing/nastroje?zkouska=${encodeURIComponent(test.zprava)}`
      : `/${rozsah}/marketing/nastroje?chyba=${encodeURIComponent(test.zprava)}`,
  )
}

export async function odpojitNastroj(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, branchId, supabase } = await pripravit(rozsah)
  const id = String(formData.get('pripojeni') ?? '')

  const pripojeni = await jeden<{ id: string }>(
    'připojení k odpojení',
    zivaPripojeni(supabase, tenantId, branchId).eq('id', id).maybeSingle(),
  )

  if (!pripojeni) zpet(rozsah, 'Takové připojení tu není.')

  const chyba = await odpojit(supabase, pripojeni.id, new Date().toISOString())
  if (chyba) zpet(rozsah, chyba)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/nastroje?odpojeno=1`)
}

/**
 * Odpojení: řádek zůstává, klíč mizí.
 *
 * Připojení se neruší, jen se označí — je z něj vidět, že tam kdysi
 * něco bylo a kdy to skončilo. Klíč se naopak maže doopravdy: co už
 * nemá platit, nemá co ležet v databázi. Co po něm zůstane, je otisk
 * v auditu.
 */
async function odpojit(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  id: string,
  kdy: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('marketing_smaz_tajemstvi', { p_pripojeni: id })
  if (error) return `Klíč se nepodařilo smazat: ${error.message}`

  const odpoved = await supabase.from('marketing_pripojeni')
    .update({ stav: 'odpojeno', odpojeno_kdy: kdy, zmeneno_kdy: kdy })
    .eq('id', id)

  return odpoved.error ? odpoved.error.message : null
}

/** Výsledek zkoušky patří do připojení, ať je vidět i bez opakování. */
async function zapsatVysledek(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  id: string,
  ok: boolean,
  zprava: string,
): Promise<void> {
  await supabase.from('marketing_pripojeni').update({
    stav: ok ? 'pripojeno' : 'vyzaduje_pozornost',
    posledni_test_kdy: new Date().toISOString(),
    posledni_test_ok: ok,
    posledni_chyba: ok ? null : zprava,
    zmeneno_kdy: new Date().toISOString(),
  }).eq('id', id)
}
