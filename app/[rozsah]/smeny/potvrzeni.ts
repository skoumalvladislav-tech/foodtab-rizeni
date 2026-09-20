'use server'

import { revalidatePath } from 'next/cache'

import { getUser, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { platnePotvrzeni, stavSmeny, type PotvrzeniSmeny, type SmenaD } from '@/lib/rozpis-desktop'
import { funkceNeexistuje, sloupecNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { vyzadujePotvrzeni, zmenaSmeny, type TeloUpozorneni } from '@/lib/upozorneni-text'

/**
 * Upozornění a potvrzení u konkrétní směny — pro Detail směny.
 *
 * ---------------------------------------------------------------------
 * DVĚ STRANY TÉŽE VĚCI
 *
 *   `moje`      upozornění, které dostal PŘIHLÁŠENÝ — může ho potvrdit.
 *               Čte se z `notifications` (RLS: každý jen svoje) a navíc
 *               filtrem `user_id`, ať se nespoléhá na jedinou linii.
 *   `vedouci`   kdy dotčený člověk upozornění dostal, přečetl a
 *               potvrdil. Jde přes `stav_potvrzeni_smeny`: vrací jen
 *               časy a jméno a ověřuje `shifts.manage` na pobočce TÉ
 *               SMĚNY. Obsah cizího upozornění se sem nikdy nedostane.
 *
 * Obojí je NEPOVINNÉ. Migrace 20260919120000 se nasazuje ručně a kód
 * sám; dokud neproběhne, sloupec `shift_id` a průzor neexistují — detail
 * se pak jen ukáže bez potvrzení, nespadne.
 *
 * OTEVŘENÍ DETAILU JE PŘEČTENÍ. Kdo si směnu rozklikne, upozornění na ni
 * si přečetl; bez toho by vedoucí u člověka, který změnu viděl, vždycky
 * četl „nepřečteno“. Čas přečtení se přitom nepřepisuje.
 */

export type MojeUpozorneni = {
  id: string
  druh: string
  puvodne: string | null
  nove: string | null
  potvrzeno_at: string | null
  /** Vyžaduje tenhle druh výslovné potvrzení (tlačítko)? */
  vyzaduje: boolean
}

export type UpozorneniVedouciho = {
  jmeno: string
  druh: string
  prijato_at: string
  precteno_at: string | null
  potvrzeno_at: string | null
}

/**
 * Potvrzení SMĚNY zaměstnancem (`smeny_potvrzeni`), ne upozornění na ni.
 * Platí, jen dokud se směna shoduje s tím, co člověk potvrdil.
 */
export type StavPotvrzeniSmeny = {
  /** Směna, kterou má přihlášený — jen ta jde potvrdit. */
  jeMoje: boolean
  stav: 'nevydano' | 'nepotvrzeno' | 'potvrzeno' | 'bez-uctu'
  potvrzeno_at: string | null
  /** Moje, vydaná, ve vydaném znění a zatím nepotvrzená — nabídne se tlačítko. */
  mozePotvrdit: boolean
}

export type StavUpozorneniSmeny = {
  moje: MojeUpozorneni | null
  vedouci: UpozorneniVedouciho | null
  /** `null` = neví se (tabulka ještě není v databázi, směna nemá člověka, chyba). */
  potvrzeniSmeny: StavPotvrzeniSmeny | null
}

const PRAZDNO: StavUpozorneniSmeny = { moje: null, vedouci: null, potvrzeniSmeny: null }

export async function nactiStavSmeny(smenaId: string): Promise<StavUpozorneniSmeny> {
  if (!smenaId) return PRAZDNO

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return PRAZDNO
  const user = await getUser()
  if (!user) return PRAZDNO

  const supabase = await getServerSupabase()
  const stav: StavUpozorneniSmeny = { moje: null, vedouci: null, potvrzeniSmeny: null }

  /* --- moje upozornění --------------------------------------------- */

  const { data: radky, error: chybaMoje } = await supabase
    .from('notifications')
    .select('id, druh, telo, read_at, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('shift_id', smenaId)
    .in('druh', ['smena.nova', 'smena.zmenena'])
    .order('created_at', { ascending: false })
    .limit(1)

  // Chyba (typicky chybějící sloupec před nasazením migrace) = žádné
  // upozornění. Detail se ukáže, jen bez potvrzení.
  const radek = chybaMoje ? null : (radky?.[0] as
    | { id: string; druh: string; telo: TeloUpozorneni; read_at: string | null; acknowledged_at: string | null }
    | undefined)

  if (radek) {
    if (!radek.read_at) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', radek.id)
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .is('read_at', null)
    }

    const zmena = zmenaSmeny(radek.telo ?? {})
    stav.moje = {
      id: radek.id,
      druh: radek.druh,
      puvodne: zmena?.puvodne ?? null,
      nove: zmena?.nove ?? null,
      potvrzeno_at: radek.acknowledged_at ?? null,
      vyzaduje: vyzadujePotvrzeni(radek.druh),
    }
  }

  /* --- pro vedoucího ----------------------------------------------- */

  const { data: vedouci, error: chybaVedouci } = await supabase.rpc('stav_potvrzeni_smeny', {
    p_tenant: tenantId,
    p_smena: smenaId,
  })
  // Bez práva, nebo před nasazením migrace, je to chyba — a pro obrazovku
  // to znamená jen „tenhle pohled není“.
  if (!chybaVedouci && Array.isArray(vedouci) && vedouci[0]) {
    const v = vedouci[0] as UpozorneniVedouciho
    stav.vedouci = {
      jmeno: v.jmeno,
      druh: v.druh,
      prijato_at: v.prijato_at,
      precteno_at: v.precteno_at ?? null,
      potvrzeno_at: v.potvrzeno_at ?? null,
    }
  }

  stav.potvrzeniSmeny = await nactiPotvrzeniSmeny(supabase, tenantId, user.id, smenaId).catch(() => null)

  return stav
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

const SLOUPCE_POTVRZENI = 'shift_id, employee_id, branch_id, shift_date, starts_at, ends_at, pauza_od, pauza_do, confirmed_at'

/**
 * Kde je tahle směna s potvrzením: moje a k potvrzení, potvrzená, nepotvrzená,
 * zaměstnanec bez účtu, nevydaná. Čte přímo tabulku (RLS: člověk své, vedoucí
 * pobočky, kde plánuje) a porovnává s TÍMTO směnou — tatáž pravidla jako
 * puntík v mřížce (`lib/rozpis-desktop.ts`).
 */
async function nactiPotvrzeniSmeny(
  supabase: Supabase,
  tenantId: string,
  userId: string,
  smenaId: string,
): Promise<StavPotvrzeniSmeny | null> {
  const zaklad =
    'id, branch_id, employee_id, shift_date, starts_at, ends_at, status, published_at, published_employee_id, published_starts_at, published_ends_at, published_status'
  let maPauzy = true
  let { data: smena, error } = await supabase
    .from('shifts')
    .select(`${zaklad}, pauza_od, pauza_do`)
    .eq('id', smenaId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error && sloupecNeexistuje(error)) {
    maPauzy = false
    ;({ data: smena, error } = await supabase.from('shifts').select(zaklad).eq('id', smenaId).eq('tenant_id', tenantId).maybeSingle())
  }
  if (error || !smena) return null

  const radek = smena as unknown as Record<string, unknown>
  const s = {
    ...radek,
    pauza_od: maPauzy ? ((radek.pauza_od as string | null) ?? null) : null,
    pauza_do: maPauzy ? ((radek.pauza_do as string | null) ?? null) : null,
  } as unknown as SmenaD
  if (!s.employee_id) return null

  const [ja, clovek, potvrzeni] = await Promise.all([
    supabase.from('employees').select('id').eq('tenant_id', tenantId).eq('user_id', userId).is('deleted_at', null).limit(1),
    supabase.from('employees').select('user_id').eq('id', s.employee_id).maybeSingle(),
    supabase.from('smeny_potvrzeni').select(SLOUPCE_POTVRZENI).eq('shift_id', smenaId),
  ])
  if (potvrzeni.error) {
    if (!tabulkaNeexistuje(potvrzeni.error)) console.error('smeny_potvrzeni selhalo', potvrzeni.error)
    return null
  }

  const jeMoje = ((ja.data ?? [])[0] as { id: string } | undefined)?.id === s.employee_id
  // Cizí směna na pobočce, kde člověk neplánuje: RLS mu potvrzení neukáže, a prázdný výsledek
  // by se četl jako „nepotvrzeno“. Neví se — stejné pravidlo jako v mřížce.
  if (!jeMoje && !(await hasAccess(tenantId, 'shifts.manage', s.branch_id))) return null

  const bezUctu = !clovek.error && clovek.data !== null && (clovek.data as { user_id: string | null }).user_id === null
  const platne = platnePotvrzeni(s, (potvrzeni.data ?? []) as PotvrzeniSmeny[])

  if (stavSmeny(s) !== 'vydana') return { jeMoje, stav: 'nevydano', potvrzeno_at: null, mozePotvrdit: false }
  if (platne) return { jeMoje, stav: 'potvrzeno', potvrzeno_at: platne.confirmed_at, mozePotvrdit: false }
  if (bezUctu) return { jeMoje, stav: 'bez-uctu', potvrzeno_at: null, mozePotvrdit: false }
  return { jeMoje, stav: 'nepotvrzeno', potvrzeno_at: null, mozePotvrdit: jeMoje }
}

/**
 * Zaměstnanec potvrdí SVOU vydanou směnu (tlačítko „Potvrdit směnu“).
 *
 * Všechno podstatné hlídá databáze (`potvrdit_smenu`): že je to jeho směna,
 * že je vydaná a od vydání beze změny. Odsud se nepředává, kdo potvrzuje —
 * bere se z přihlášení, takže cizí potvrzení poslat nejde.
 */
/** Znění směny, které člověk vidí na obrazovce — potvrzuje se právě to, a nesedí-li s databází, potvrzení se odmítne. */
export type ZneniSmeny = {
  id: string
  shift_date: string
  starts_at: string
  ends_at: string
  pauza_od: string | null
  pauza_do: string | null
}

export async function potvrditSmenu(
  zneni: ZneniSmeny,
  rozsah: string,
): Promise<{ stav: 'ok' } | { stav: 'chyba'; text: string }> {
  if (!zneni?.id) return { stav: 'chyba', text: 'Nevím, co potvrdit.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }
  const user = await getUser()
  if (!user) return { stav: 'chyba', text: 'Nejste přihlášeni.' }

  const supabase = await getServerSupabase()
  const r = await potvrditVDatabazi(supabase, tenantId, zneni)
  if (r.stav === 'ok') revalidatePath(`/${rozsah}`, 'layout')
  return r
}

/** Volání funkce v databázi a překlad chyby na větu pro člověka. */
async function potvrditVDatabazi(
  supabase: Supabase,
  tenantId: string,
  zneni: ZneniSmeny,
): Promise<{ stav: 'ok' } | { stav: 'chyba'; text: string }> {
  const { error } = await supabase.rpc('potvrdit_smenu', {
    p_tenant: tenantId,
    p_smena: zneni.id,
    p_den: zneni.shift_date,
    p_od: zneni.starts_at,
    p_do: zneni.ends_at,
    p_pauza_od: zneni.pauza_od,
    p_pauza_do: zneni.pauza_do,
  })
  if (!error) return { stav: 'ok' }
  if (funkceNeexistuje(error)) {
    return { stav: 'chyba', text: 'Potvrzování směn ještě není zapnuté — čeká na nasazení databáze.' }
  }
  // Věty z funkce jsou psané pro člověka (cizí směna, nevydaná, změněná od vydání). Poznají se
  // podle vlastních kódů PT403 / PT409; cizí chyba databáze (třeba chybějící grant, 42501) by
  // člověku ukázala anglickou hlášku o interních objektech, tak se tam nepředává.
  if (error.code === 'PT403' || error.code === 'PT409') return { stav: 'chyba', text: error.message }
  return { stav: 'chyba', text: 'Potvrzení se nepodařilo uložit.' }
}

/**
 * Potvrzení změny z detailu směny.
 *
 * Stejná úvaha jako `potvrditZmenu` u upozornění: politika pustí úpravu
 * jen u vlastních řádků, id se ověřuje proti přihlášenému, a potvrdit jde
 * jen druh, který to vyžaduje (`vyzadujePotvrzeni`, jediné místo s tímhle
 * pravidlem). Čas přečtení se nepřepisuje — potvrzení a přečtení jsou dva
 * okamžiky a vedoucí je vidí zvlášť.
 */
export async function potvrditZmenuSmeny(
  notifikaceId: string,
  rozsah: string,
): Promise<{ stav: 'ok' } | { stav: 'chyba'; text: string }> {
  if (!notifikaceId) return { stav: 'chyba', text: 'Nevím, co potvrdit.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }
  const user = await getUser()
  if (!user) return { stav: 'chyba', text: 'Nejste přihlášeni.' }

  const supabase = await getServerSupabase()
  const ted = new Date().toISOString()

  const { data, error } = await supabase
    .from('notifications')
    .update({ acknowledged_at: ted })
    .eq('id', notifikaceId)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('druh', DRUHY_S_POTVRZENIM)
    .is('acknowledged_at', null)
    .select('id')

  if (error) return { stav: 'chyba', text: 'Potvrzení se nepodařilo uložit.' }
  if (!data || data.length === 0) {
    // Buď už je potvrzeno, nebo to není upozornění, které jde potvrdit.
    // Pro člověka je výsledek stejný: nic dalšího dělat nemusí.
    return { stav: 'ok' }
  }

  // Potvrzení znamená i přečtení — ale jen když ještě přečtené nebylo.
  await supabase
    .from('notifications')
    .update({ read_at: ted })
    .eq('id', notifikaceId)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('read_at', null)


  revalidatePath(`/${rozsah}`, 'layout')
  return { stav: 'ok' }
}

/** `.in()` chce pole, ne funkci — a musí sedět s vyzadujePotvrzeni(). */
const DRUHY_S_POTVRZENIM = ['smena.zmenena', 'smena.zrusena'].filter(vyzadujePotvrzeni)
