'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { odeslatEmail } from '@/lib/email'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { najdiNeboZaloz } from '../pozice/akce'
import { NOVA_POZICE } from './pozice-volba'

/**
 * Přidání nebo úprava zaměstnance.
 *
 * Zaměstnanec může být:
 * - s účtem (user_id vyplněné) — přihlášeného člena firmy
 * - bez účtu — brigádník nebo občasná výpomoc
 *
 * Mazání je soft — deleted_at se nastaví, řádek zůstane v DB kvůli
 * návaznosti na docházku.
 */
export async function upravitZamestnance(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = formData.get('id') ? String(formData.get('id')) : null
  const jmeno = String(formData.get('jmeno') ?? '').trim()
  const pozice = formData.get('pozice') ? String(formData.get('pozice')) : null
  const pobocka = formData.get('pobocka') ? String(formData.get('pobocka')) : null
  const typ = String(formData.get('typ') ?? 'hpp')
  // Prázdné pole s datem posílá prázdný řetězec. Do sloupce typu date
  // patří null, ne '' — na tom by zápis spadl.
  const nastup = String(formData.get('nastup') ?? '').trim() || null

  if (!jmeno) {
    redirect(`/${rozsah}/nastaveni/lide?chyba=jmeno`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  /*
    „+ Nová pozice…“ z rozbalovátka. Zakládá se tady, spolu s uložením
    zaměstnance — bez odchodu z formuláře a bez druhého kliknutí.

    najdiNeboZaloz respektuje rozpoznávací klíč: kdo napíše „číšník“
    a v databázi je „Číšník“, dostane tu stávající a dozví se to. Druhá
    pozice se nezaloží a nic nespadne na porušení jedinečnosti.
  */
  let poziceId = pozice
  let vzkaz = ''

  if (pozice === NOVA_POZICE) {
    const nova = String(formData.get('novaPozice') ?? '')
    const v = await najdiNeboZaloz(tenantId, nova)
    if (v.stav === 'chyba') {
      redirect(`/${rozsah}/nastaveni/lide?chyba=pozice-${v.duvod}`)
    }
    poziceId = v.id
    if (v.stav === 'uz_existuje') {
      vzkaz = `&pozice=existujici&nazev=${encodeURIComponent(v.nazev)}`
    }
  }

  const supabase = await getServerSupabase()

  if (id) {
    // Úprava
    const { error } = await supabase
      .from('employees')
      .update({
        full_name: jmeno,
        position_id: poziceId,
        branch_id: pobocka,
        employment_type: typ,
        started_on: nastup,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  } else {
    // Přidání
    const { error } = await supabase
      .from('employees')
      .insert({
        tenant_id: tenantId,
        full_name: jmeno,
        position_id: poziceId,
        branch_id: pobocka,
        employment_type: typ,
        started_on: nastup,
      })

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  }

  revalidatePath(`/${rozsah}/nastaveni/lide`)
  redirect(`/${rozsah}/nastaveni/lide?ulozeno=1${vzkaz}`)
}

/**
 * Soft-delete zaměstnance.
 *
 * Bere FormData jako ostatní akce v tomhle souboru, aby šla pověsit
 * rovnou na <form action={…}>. Volat ji z onClick nešlo: stránka je
 * serverová a obsluha události se do prohlížeče nemá jak dostat.
 */
export async function smazatZamestnance(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const rozsah = String(formData.get('rozsah') ?? '')
  if (!id) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') return

  const supabase = await getServerSupabase()
  await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/nastaveni/lide`)
}

/**
 * Zadání hodinové sazby.
 *
 * Zakládá NOVÝ řádek historie, nikdy nepřepisuje starý — sazba je
 * historie, ne údaj u zaměstnance. Zvýšení od 1. října tak nesmí sáhnout
 * na září a oprava překlepu se dělá dalším řádkem se stejným valid_from.
 *
 * O právu rozhoduje public.set_rate: bez payroll.manage vyhodí chybu
 * a zapíše se nic. Kontrola tady je druhá linie, ne jediná.
 *
 * Částka přichází z formuláře v korunách, v databázi jsou haléře.
 */
export async function nastavitSazbu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const korunyRaw = String(formData.get('koruny') ?? '').trim()
  const odKdy = String(formData.get('od') ?? '').trim()
  const poznamka = String(formData.get('poznamka') ?? '').trim()

  if (!zamestnanec || korunyRaw === '' || odKdy === '') {
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=sazba-neuplna`)
  }

  // Čárka i tečka: kdo píše sazbu, píše ji tak, jak je zvyklý.
  const korun = Number(korunyRaw.replace(',', '.'))
  if (!Number.isFinite(korun) || korun < 0) {
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=sazba-cislo`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('set_rate', {
    p_tenant: tenantId,
    p_employee: zamestnanec,
    p_haleru: Math.round(korun * 100),
    p_valid_from: odKdy,
    p_note: poznamka,
  })

  if (error) {
    // 42501 = insufficient_privilege. Funkce ho vyhazuje schválně, když
    // volajícímu chybí payroll.manage.
    const duvod = error.code === '42501' ? 'sazba-pravo' : 'sazba-nepovedlo'
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=${duvod}`)
  }

  revalidatePath(`/${rozsah}/nastaveni/lide`)
  redirect(`/${rozsah}/nastaveni/lide?ulozeno=1`)
}

/**
 * Vystavení pozvánky.
 *
 * Volá public.create_invitation, která je průzor do app schématu.
 *
 * Vrací ODKAZ, ne token. Do e-mailu i na obrazovku patří adresa, kterou
 * stačí kliknout — nikdo nemá nic přepisovat ručně
 * (docs/pozvanky-zadani.md, oddíl 4). Token je v ní obsažený a v databázi
 * po něm zůstane jen otisk, takže se čitelně objeví právě jednou.
 */
export type VysledekPozvanky = {
  odkaz?: string
  /** Kam e-mail odešel. Prázdné = neodešel. */
  poslanoNa?: string
  /** Proč neodešel. Musí to být vidět, jinak se pozvánka tváří jako doručená. */
  chybaMailu?: string
  chyba?: string
}

export async function vystavitPozvankuAction(
  formData: FormData,
): Promise<VysledekPozvanky> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanecId = formData.get('zamestnanec')
    ? String(formData.get('zamestnanec'))
    : null
  const email = String(formData.get('email') ?? '').trim()
  const kanal = String(formData.get('kanal') ?? 'email')

  /*
    Prázdné = „přidělím později“, ne chyba. Do databáze musí jít null,
    ne prázdný řetězec — ten by se pokusil přetypovat na uuid a spadl
    by na 22P02 s hláškou, ze které nikdo nic nepozná.
  */
  const opravneni = String(formData.get('opravneni') ?? '').trim() || null

  if (!zamestnanecId) {
    return { chyba: 'Vyberte zaměstnance' }
  }

  if (kanal === 'email' && !email) {
    return { chyba: 'Zadejte e-mailovou adresu' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { chyba: 'Chyba při načítání firmy' }

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') return { chyba: 'Nemáte oprávnění' }

  const supabase = await getServerSupabase()

  const { data: zaměstnanec, error: chybaZamestnanec } = await supabase
    .from('employees')
    .select('id, branch_id')
    .eq('id', zamestnanecId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (chybaZamestnanec) {
    throw new DotazSelhal('zaměstnanec k pozvánce', chybaZamestnanec)
  }

  if (!zaměstnanec) {
    return { chyba: 'Zaměstnanec nenalezen' }
  }

  /*
    Rozsah se NEBERE z formuláře, ale z toho, co je u zaměstnance
    v Lidech (docs/odpovedi-pozvanky-2026-09-01.md, oddíl 1):

      pobočka  → scope 'branch' a ta jedna pobočka
      Firemní  → scope 'tenant'

    Pobočka u zaměstnance je jednou zadaná. Ptát se na ni podruhé
    v pozvánce znamená rozhodovat dvakrát o téže věci a druhé rozhodnutí
    se dřív nebo později rozejde s prvním.

    Samotný rozsah nic neotevírá — bez role nemá člověk jediné právo,
    ať je rozsah jakýkoli (ověřeno v krok7_scenar.sql). Proto je
    bezpečné nastavit ho dopředu.
  */
  const naPobocku = zaměstnanec.branch_id != null

  // Procházíme přes RPC — public.create_invitation
  const { data, error } = await supabase.rpc('create_invitation', {
    p_tenant: tenantId,
    p_role: opravneni,
    p_channel: kanal,
    p_contact: email,
    p_scope: naPobocku ? 'branch' : 'tenant',
    p_branches: naPobocku ? [zaměstnanec.branch_id] : [],
    p_employee: zamestnanecId,
    p_valid_days: 7,
  })

  if (error) {
    console.error('create_invitation error:', error)

    /*
      Hlášky psala databáze a jsou pro člověka („Tuhle roli nemůžete
      přidělit — obsahuje oprávnění, která sami nemáte.“). Projdou se
      proto dál, ať se nevymýšlí druhá sada.

      Dřív tu stálo „Oprávnění zamítnuté (42501)“ a podobně. Vedoucí se
      z toho nedozvěděl nic — a právě takhle vypadala chyba, kvůli které
      se zjistilo až po týdnu, že nejde pozvat vůbec nikdo.
    */
    return { chyba: error.message || 'Pozvánku se nepodařilo vystavit.' }
  }

  if (!data || data.length === 0) {
    return { chyba: 'Pozvánka nebyla vystavena' }
  }

  // RPC vrací pole řádků [{ invitation_id, token }]
  const { token } = data[0]
  const odkaz = `${await zakladniAdresa()}/pozvanka/${token}`

  revalidatePath(`/${rozsah}/nastaveni/lide`)

  /*
    SMS zatím nemáme čím poslat (CLAUDE.md: brána žádná). Pozvánka je
    vystavená a platí — odkaz se ukáže na obrazovce a vedoucí ho pošle
    sám. Neříká se přitom, že něco odešlo.
  */
  if (kanal !== 'email') {
    return { odkaz, chybaMailu: 'SMS bránu Foodtab zatím nemá — odkaz pošlete sami.' }
  }

  const poslano = await odeslatEmail({
    komu: email,
    predmet: 'Pozvánka do Foodtabu',
    text: textPozvanky(odkaz),
    html: htmlPozvanky(odkaz),
  })

  if (poslano.stav === 'odeslano') return { odkaz, poslanoNa: email }

  /*
    Pozvánka je vystavená a platná — jen se nepodařilo ji poslat. Nemaže
    se: kdyby se rušila, přišel by vedoucí i o odkaz, který má rovnou
    před sebou a může ho poslat jinudy.
  */
  return {
    odkaz,
    chybaMailu:
      poslano.stav === 'nenastaveno'
        ? 'E-mail se neodeslal — na serveru chybí klíč k Resendu (RESEND_API_KEY).'
        : `E-mail se neodeslal: ${poslano.text}`,
  }
}

/**
 * Adresa, na které aplikace běží.
 *
 * Bere se z hlaviček požadavku, ne z nastavení — na jednom serveru je
 * to `localhost:3000`, na druhém ostrá doména, a třetí místo, kde by se
 * to muselo držet synchronně, by se dřív nebo později rozešlo.
 * `NEXT_PUBLIC_APP_URL` má přednost pro případ, že aplikace běží za
 * proxy, která hlavičky přepisuje.
 */
async function zakladniAdresa(): Promise<string> {
  const nastavena = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (nastavena) return nastavena.replace(/\/+$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protokol = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protokol}://${host}`
}

function textPozvanky(odkaz: string): string {
  return [
    'Dobrý den,',
    '',
    'někdo z vaší restaurace vás pozval do Foodtabu — aplikace na rozpisy',
    'směn, docházku a úkoly.',
    '',
    'Pozvánku přijmete tady:',
    odkaz,
    '',
    'Odkaz platí sedm dní a jde použít jednou. Pokud čekáte, že vám',
    'někdo přidělí oprávnění, může se stát, že po přihlášení zatím nic',
    'neuvidíte — to je v pořádku, ozvěte se vedoucímu.',
    '',
    'Jestli o pozvánku nestojíte, nemusíte dělat nic. Sama vyprší.',
  ].join('\n')
}

function htmlPozvanky(odkaz: string): string {
  // Bez obrázků a bez stylopisu ze sítě: půlka poštovních programů je
  // stejně nenačte a pozvánka musí být čitelná i tak.
  return `<!doctype html>
<html lang="cs"><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1c1917">
<p>Dobrý den,</p>
<p>někdo z vaší restaurace vás pozval do <strong>Foodtabu</strong> — aplikace
na rozpisy směn, docházku a úkoly.</p>
<p><a href="${odkaz}" style="display:inline-block;padding:12px 20px;background:#8a6a3b;color:#fff;border-radius:10px;text-decoration:none">Přijmout pozvánku</a></p>
<p style="font-size:13px;color:#57534e">Kdyby tlačítko nefungovalo, otevřete tuhle adresu:<br>
<a href="${odkaz}">${odkaz}</a></p>
<p style="font-size:13px;color:#57534e">Odkaz platí sedm dní a jde použít jednou.
Pokud po přihlášení zatím nic neuvidíte, čeká se na to, až vám vedoucí přidělí
oprávnění. Jestli o pozvánku nestojíte, nemusíte dělat nic — sama vyprší.</p>
</body></html>`
}

/**
 * Přidělení oprávnění a rozsahu.
 *
 * Obojí najednou, ne zvlášť: role sama neotevře nic, dokud k ní není
 * rozsah, a rozsah sám neotevře nic bez role. Kdyby se nastavovaly
 * odděleně, končilo by to půlkou lidí, kteří „oprávnění mají“ a přesto
 * nic nevidí — přesně to, na co jsme narazili u pozvánek.
 * Viz docs/odpovedi-pozvanky-2026-09-01.md, oddíl 1.
 *
 * ROZHODNUTÍ PADÁ V DATABÁZI. Politiky `memberships_update`
 * a `membership_branches_write` se ptají `app.smi_pridelit`, takže
 * nikdo nepřidělí víc, než má sám, ani obejitím téhle akce. Kontroly
 * tady jsou proto, aby se člověk dozvěděl důvod dřív než chybu.
 */
export async function prideleniOpravneni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const role = String(formData.get('opravneni') ?? '').trim() || null
  const uroven = String(formData.get('uroven') ?? 'branch') === 'tenant' ? 'tenant' : 'branch'
  const pobocky = formData.getAll('pobocka').map(String).filter(Boolean)

  const zpet = `/${rozsah}/nastaveni/lide`
  if (!zamestnanec) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  const { data: clovek, error: chybaClovek } = await supabase
    .from('employees')
    .select('id, user_id, full_name')
    .eq('id', zamestnanec)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (chybaClovek) throw new DotazSelhal('zaměstnanec k přidělení oprávnění', chybaClovek)

  if (!clovek?.user_id) {
    redirect(`${zpet}?chyba=opravneni-bez-uctu`)
  }

  const { data: clenstvi, error: chybaClenstvi } = await supabase
    .from('memberships')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', clovek.user_id)
    .maybeSingle()
  if (chybaClenstvi) throw new DotazSelhal('členství k přidělení oprávnění', chybaClenstvi)

  if (!clenstvi) {
    redirect(`${zpet}?chyba=opravneni-bez-clenstvi`)
  }

  /*
    Zápis rozsahu. Pořadí je schválně tohle: napřed členství, pak
    pobočky. Politika na `membership_branches` se totiž ptá na roli
    ULOŽENOU v členství — kdyby se pobočky psaly první, ptala by se
    ještě na tu starou.
  */
  const { error: chybaUpdate } = await supabase
    .from('memberships')
    .update({ role_id: role, scope: uroven })
    .eq('id', clenstvi.id)

  if (chybaUpdate) {
    redirect(`${zpet}?chyba=opravneni&text=${encodeURIComponent(chybaUpdate.message)}`)
  }

  /*
    Update, který politika nepustí, NENÍ chyba — je to nula změněných
    řádků a Supabase o něm mlčí. Ověřuje se proto čtením: co je
    v databázi po zápisu, ne co jsme poslali.

    Tichého neprovedení se u RLS bát MUSÍME (docs/pravidlo-neprideluj-vic.md).
    Tady navíc politika zakazuje měnit vlastní členství, takže to není
    teorie: kdo si to zkusí na sobě, projde bez chyby a nic se nestane.
  */
  const { data: po } = await supabase
    .from('memberships')
    .select('role_id, scope')
    .eq('id', clenstvi.id)
    .maybeSingle()

  if (po?.role_id !== role || po?.scope !== uroven) {
    redirect(`${zpet}?chyba=opravneni-neprovedeno`)
  }

  // Pobočky se přepisují na to, co přišlo. Mazání i vkládání se počítá,
  // ať se pozná, když politika některý řádek nepustí.
  const { data: predtim } = await supabase
    .from('membership_branches')
    .select('branch_id')
    .eq('membership_id', clenstvi.id)

  const stare = new Set((predtim ?? []).map((r) => String(r.branch_id)))
  const nove = new Set(uroven === 'tenant' ? [] : pobocky)

  const kSmazani = [...stare].filter((b) => !nove.has(b))
  const kPridani = [...nove].filter((b) => !stare.has(b))

  if (kSmazani.length > 0) {
    await supabase
      .from('membership_branches')
      .delete()
      .eq('membership_id', clenstvi.id)
      .in('branch_id', kSmazani)
  }

  if (kPridani.length > 0) {
    await supabase.from('membership_branches').insert(
      kPridani.map((b) => ({ membership_id: clenstvi.id, branch_id: b })),
    )
  }

  const { data: potom } = await supabase
    .from('membership_branches')
    .select('branch_id')
    .eq('membership_id', clenstvi.id)

  const vysledek = new Set((potom ?? []).map((r) => String(r.branch_id)))
  const sedi =
    vysledek.size === nove.size && [...nove].every((b) => vysledek.has(b))

  revalidatePath(zpet)
  revalidatePath('/', 'layout')

  if (!sedi) {
    redirect(`${zpet}?chyba=opravneni-pobocky`)
  }

  redirect(`${zpet}?ulozeno=opravneni&kdo=${encodeURIComponent(clovek.full_name)}`)
}
