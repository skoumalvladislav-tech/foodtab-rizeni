'use server'

import { revalidatePath } from 'next/cache'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  akceRuseni,
  nahledPoDnech,
  otiskRadku,
  overitDnyRuseni,
  stejneSmeny,
  vybratKeZruseni,
  vysledekZRpc,
  type PolozkaNahledu,
  type SmenaKRuseni,
  type StavNahledu,
  type StavRuseni,
  type VysledekRuseni,
} from '@/lib/ruseni-smen'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zrušení / smazání směny i v JINÉ DNY (Šéfík 14. 10. 2026: „potřebuji
 * u rušení směn označit více dní“).
 *
 * Dvě akce nad jedním výpočtem (`najitKeZruseni`):
 *
 *   nahledRuseni   jen ČTE — co by se ve vybraných dnech zrušilo/smazalo.
 *   zrusitViceDni  totéž spočítá ZNOVU a teprve pak ruší.
 *
 * Které směny se v jiných dnech ruší, rozhoduje SERVER pravidlem
 * `odpovidaPravidlu` (lib/ruseni-smen.ts) nad řádky z databáze. Prohlížeč
 * pošle jen výchozí směnu, vybrané dny a otisky z náhledu; otisky slouží
 * jako pojistka — když se rozpis od náhledu změnil, nezruší se NIC
 * a člověk dostane hlášku, ať se podívá znovu. Co neviděl, se nestane.
 *
 * ---------------------------------------------------------------------
 * RUŠÍ SE STEJNOU CESTOU JAKO JEDNA SMĚNA
 *
 * Každá směna jde přes `public.smazat_smenu` — tutéž funkci, kterou volá
 * `smazatSmenu` u jedné směny. Ta si sama ověří `shifts.manage` na pobočce
 * té směny a rozhodne: nevydanou smaže, vydanou označí jako zrušenou
 * (lidem zmizí až vydáním rozpisu) a dotčenému člověku založí upozornění.
 * Žádný druhý zápis do `shifts` tady není.
 *
 * Volá se PO SOBĚ, ne najednou (`Promise.all`) — stejně jako zakládání víc
 * dnů v `ulozitSmenu`: funkce zakládá upozornění a souběh nad týmž
 * člověkem nemá co přinést. Selže-li jedna směna, ostatní se přesto
 * zpracují, ale neúspěch je VIDĚT: vrací se výsledek každé směny zvlášť
 * a obrazovka z něj složí souhrn (`souhrnRuseni`) a vypíše, co neprošlo.
 *
 * ---------------------------------------------------------------------
 * DOTAZ ZUŽUJE, PRAVIDLO ROZHODUJE
 *
 * Dotaz na kandidáty si řekne jen o pobočku výchozí směny, vybrané dny
 * a téhož člověka (u neobsazené směny o neobsazené). Není to druhá kopie
 * pravidla „pro jistotu“, ale strop velikosti odpovědi: bez zúžení podle
 * člověka by pobočka za dvanáct týdnů přerostla limit řádků PostgRESTu
 * a chybějící řádky by se tvářily jako „nic k zrušení“. Kdo pravidlo
 * změní (třeba na „jen stejný čas“), mění `odpovidaPravidlu`; dotaz smí
 * vrátit víc, nikdy míň. Zúžení hlídá scripts/smeny-ruseni.test.mjs.
 */

const SLOUPCE = 'id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at, status, published_at'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

type Nalez =
  | {
      stav: 'ok'
      supabase: Supabase
      tenantId: string
      zaklad: SmenaKRuseni
      /** Ověřené dny včetně dne výchozí směny, seřazené. */
      dny: string[]
      /** Co se zruší: výchozí směna + co odpovídá pravidlu, v pořadí kalendáře. */
      smeny: SmenaKRuseni[]
    }
  | { stav: 'chyba'; text: string }

async function najitKeZruseni(rozsah: string, smenaId: string, surove: string[]): Promise<Nalez> {
  if (!smenaId) return { stav: 'chyba', text: 'Nevím, kterou směnu mám zrušit.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  /*
    První obranná linie, stejně jako u `smazatSmenu`. Druhá je uvnitř
    `smazat_smenu` (pobočka TÉ SMĚNY) a RLS nad čtením `shifts`.
  */
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') return { stav: 'chyba', text: 'Mazat směny nemáte oprávnění.' }

  const supabase = await getServerSupabase()
  const { data: radek, error: chybaZakladu } = await supabase
    .from('shifts')
    .select(SLOUPCE)
    .eq('tenant_id', tenantId)
    .eq('id', smenaId)
    .maybeSingle()
  if (chybaZakladu) return { stav: 'chyba', text: 'Směnu se nepodařilo načíst.' }
  if (!radek) return { stav: 'chyba', text: 'Takovou směnu neznám.' }
  const zaklad = radek as unknown as SmenaKRuseni

  /*
    Právo na pobočce TÉ SMĚNY, ne na té z adresy (pravidlo 4). Rozsah
    firmy by jinak pustil náhled cizí pobočky; zrušit by ji stejně
    nedovolila `smazat_smenu`, ale nemá se o ní ani číst.
  */
  if (!(await hasAccess(tenantId, 'shifts.manage', zaklad.branch_id))) {
    return { stav: 'chyba', text: 'Tahle směna patří pobočce, kterou nespravujete.' }
  }

  const overene = overitDnyRuseni(surove, zaklad.shift_date)
  if (!overene.ok) return { stav: 'chyba', text: overene.text }

  const dalsiDny = overene.dny.filter((d) => d !== zaklad.shift_date)
  let kandidati: SmenaKRuseni[] = []
  if (dalsiDny.length > 0) {
    // Zúžení, ne pravidlo — viz hlavičku („Dotaz zužuje, pravidlo rozhoduje“).
    let dotaz = supabase
      .from('shifts')
      .select(SLOUPCE)
      .eq('tenant_id', tenantId)
      .eq('branch_id', zaklad.branch_id)
      .in('shift_date', dalsiDny)
    dotaz =
      zaklad.employee_id !== null
        ? dotaz.eq('employee_id', zaklad.employee_id)
        : dotaz.is('employee_id', null)
    const { data, error } = await dotaz
    if (error) return { stav: 'chyba', text: 'Směny ve vybraných dnech se nepodařilo načíst.' }
    kandidati = (data ?? []) as unknown as SmenaKRuseni[]
  }

  return {
    stav: 'ok',
    supabase,
    tenantId,
    zaklad,
    dny: overene.dny,
    smeny: vybratKeZruseni(zaklad, kandidati, overene.dny),
  }
}

/**
 * Náhled: co by se ve vybraných dnech zrušilo a co smazalo — den po dni,
 * včetně dnů, kde není co rušit. Nic nezapisuje.
 */
export async function nahledRuseni(rozsah: string, smena: string, dny: string[]): Promise<StavNahledu> {
  // Argumenty serverové akce jsou vstup z prohlížeče — typ se ověří tady.
  const nalez = await najitKeZruseni(
    String(rozsah ?? ''),
    String(smena ?? '').trim(),
    Array.isArray(dny) ? dny.map((d) => String(d)) : [],
  )
  if (nalez.stav !== 'ok') return nalez
  const { supabase, zaklad, smeny } = nalez

  /*
    Jméno a pozice jsou pro čtení náhledu, ne pro rozhodnutí. Když se
    nenačtou, náhled se ukáže bez nich — co se zruší, se tím nemění.
  */
  let jmeno: string | null = null
  if (zaklad.employee_id) {
    const { data } = await supabase.from('employees').select('full_name').eq('id', zaklad.employee_id).maybeSingle()
    jmeno = ((data as { full_name?: string } | null)?.full_name ?? null) || null
  }
  const pozice = new Map<string, string>()
  const idPozic = [...new Set(smeny.map((s) => s.position_id).filter((p): p is string => !!p))]
  if (idPozic.length > 0) {
    const { data } = await supabase.from('positions').select('id, label').in('id', idPozic)
    for (const p of (data ?? []) as { id: string; label: string }[]) pozice.set(p.id, p.label)
  }

  const polozky: PolozkaNahledu[] = smeny.map((s) => ({
    id: s.id,
    den: s.shift_date,
    od: s.starts_at.slice(0, 5),
    do: s.ends_at.slice(0, 5),
    kdo: zaklad.employee_id ? (jmeno ?? 'Zaměstnanec') : 'Neobsazená směna',
    pozice: s.position_id ? (pozice.get(s.position_id) ?? null) : null,
    akce: akceRuseni(s),
    vychozi: s.id === zaklad.id,
  }))

  return { stav: 'ok', dny: nahledPoDnech(nalez.dny, polozky) }
}

/**
 * Zrušení ve víc dnech. Přijímá výchozí směnu (`smena`), vybrané dny
 * (`dny`, opakované pole) a otisky směn z náhledu (`smeny`). Spočítá
 * všechno znovu; nesedí-li to s náhledem, nezruší nic.
 */
export async function zrusitViceDni(_predchozi: StavRuseni, formData: FormData): Promise<StavRuseni> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const smena = String(formData.get('smena') ?? '').trim()
  const dny = formData.getAll('dny').map((d) => String(d))
  const zNahledu = formData
    .getAll('smeny')
    .map((s) => String(s).trim())
    .filter(Boolean)

  const nalez = await najitKeZruseni(rozsah, smena, dny)
  if (nalez.stav !== 'ok') return nalez

  /*
    Co člověk viděl, to se stane — nic víc, nic míň. Otisk z prohlížeče,
    který pravidlu neodpovídá (cizí směna, jiný den, podvržené id), stejně
    jako směna, která mezitím přibyla, změnila čas nebo se vydala, celé
    zrušení zastaví dřív, než se čehokoli dotkne.
  */
  if (!stejneSmeny(zNahledu, nalez.smeny.map(otiskRadku))) {
    return {
      stav: 'chyba',
      text: 'Rozpis se od náhledu změnil, nebo náhled neodpovídá výběru. Nic se nezrušilo — načtěte náhled znovu.',
    }
  }

  const { supabase, tenantId } = nalez
  const vysledky: VysledekRuseni[] = []
  // Postupně, ne Promise.all — viz hlavičku.
  for (const s of nalez.smeny) {
    let vysledek: Pick<VysledekRuseni, 'vysledek' | 'chyba'>
    try {
      const { data, error } = await supabase.rpc('smazat_smenu', { p_tenant: tenantId, p_smena: s.id })
      vysledek = vysledekZRpc(data, error)
    } catch {
      // Jedna směna, která spadne spojením, nesmí zastavit ostatní.
      vysledek = { vysledek: null, chyba: 'Spojení s databází selhalo.' }
    }
    vysledky.push({ id: s.id, den: s.shift_date, od: s.starts_at.slice(0, 5), do: s.ends_at.slice(0, 5), ...vysledek })
  }

  // Obnovit rozpis, jen když se aspoň jedna směna opravdu změnila.
  if (vysledky.some((v) => v.chyba === null)) revalidatePath(`/${rozsah}/smeny`)

  const dnySeSmenou = new Set(nalez.smeny.map((s) => s.shift_date))
  return { stav: 'hotovo', smeny: vysledky, dnyBezSmen: nalez.dny.filter((d) => !dnySeSmenou.has(d)) }
}
