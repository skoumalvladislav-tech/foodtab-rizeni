'use server'

import { revalidatePath } from 'next/cache'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  akceRuseni,
  dnySeSmenouKRuseni,
  MAX_SMEN_RUSENI,
  nahledPoDnech,
  oknoRuseni,
  otiskRadku,
  overitDnyRuseni,
  stejneSmeny,
  TEXT_MOC_SMEN,
  vybratKeZruseni,
  vysledekZRpc,
  type PolozkaNahledu,
  type SmenaKRuseni,
  type StavDnuSeSmenou,
  type StavNahledu,
  type StavRuseni,
  type VysledekRuseni,
} from '@/lib/ruseni-smen'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zrušení / smazání směny i v JINÉ DNY (Šéfík 14. 10. 2026: „potřebuji
 * u rušení směn označit více dní“).
 *
 * Tři akce nad společným načtením výchozí směny (`nacistZaklad`) a dotazem
 * na kandidáty (`dotazKandidatu`); náhled a zrušení navíc sdílí výpočet
 * `najitKeZruseni`:
 *
 *   nahledRuseni   jen ČTE — co by se ve vybraných dnech zrušilo/smazalo.
 *   zrusitViceDni  totéž spočítá ZNOVU a teprve pak ruší.
 *   dnySeSmenou    jen ČTE — ve kterých dnech mřížky taková směna je
 *                  (značky v mřížce; Šéfík 15. 10. 2026: „teď hádám“).
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
 * (u `dnySeSmenou` celé okno mřížky), nezrušené směny a téhož člověka —
 * u neobsazené výchozí směny o neobsazené
 * se stejnou pozicí, začátkem i koncem. Není to druhá kopie pravidla „pro
 * jistotu“, ale strop velikosti odpovědi: bez zúžení by pobočka za dvanáct
 * týdnů přerostla limit řádků PostgRESTu (max_rows 1000, supabase/
 * config.toml) a chybějící řádky by se tvářily jako „nic ke zrušení“. Kdo
 * pravidlo změní (třeba na „jen stejný čas“), mění `odpovidaPravidlu`;
 * dotaz smí vrátit víc, nikdy míň. Zúžení hlídá scripts/smeny-ruseni.test.mjs.
 *
 * Pojistka za zúžením: dotaz si řekne i o počet (`count: 'exact'`) a je
 * seřazený. Když PostgREST vrátí méně řádků, než kolik jich odpovídá
 * (useknutí limitem), náhled, potvrzení i značky v mřížce (`dnySeSmenou`)
 * se ODMÍTNOU — nikdy se nevydává neúplný výsledek za „nic ke zrušení“
 * a náhled s potvrzením nemůžou
 * dostat dvě různé podmnožiny. Totéž pro strop `MAX_SMEN_RUSENI` (ten jen
 * u náhledu a potvrzení).
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

type Zaklad =
  | { stav: 'ok'; supabase: Supabase; tenantId: string; zaklad: SmenaKRuseni }
  | { stav: 'chyba'; text: string }

/**
 * Výchozí směna i s oběma kontrolami práv — společné pro všechny tři akce.
 * Argumenty serverové akce jsou vstup z prohlížeče — typ se srovná tady,
 * pro všechny akce stejně (i pro tu, která na to zapomene).
 */
async function nacistZaklad(rozsahVstup: string, smenaVstup: string): Promise<Zaklad> {
  const rozsah = String(rozsahVstup ?? '')
  const smenaId = String(smenaVstup ?? '').trim()
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

  /*
    Už zrušená výchozí směna by se v náhledu ukázala jako „zruší se“,
    započítala by se do tlačítka i souhrnu a výsledek by pak hlásil „už
    dřív zrušeno“ — v jiných dnech se přitom zrušené vynechávají. Stane
    se to, když ji mezitím zrušil někdo jiný (nebo se otevřela odkazem
    ve chvíli zrušení). Potvrzení výchozí směnu načítá znovu, takže tohle
    chytí i souběh mezi náhledem a potvrzením.
  */
  if (zaklad.status === 'cancelled') {
    return { stav: 'chyba', text: 'Tahle směna už je zrušená — obnovte rozpis.' }
  }

  return { stav: 'ok', supabase, tenantId, zaklad }
}

/**
 * Dotaz na kandidáty: pobočka výchozí směny, nezrušené, týž člověk (nebo
 * u neobsazené tatáž pozice a čas), seřazené a s přesným počtem. Dny
 * doplní volající (`in` vybrané dny, nebo celé okno mřížky). Zúžení,
 * ne pravidlo — viz hlavičku („Dotaz zužuje, pravidlo rozhoduje“).
 */
function dotazKandidatu(supabase: Supabase, tenantId: string, zaklad: SmenaKRuseni) {
  let dotaz = supabase
    .from('shifts')
    .select(SLOUPCE, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('branch_id', zaklad.branch_id)
    .neq('status', 'cancelled')
  if (zaklad.employee_id !== null) {
    dotaz = dotaz.eq('employee_id', zaklad.employee_id)
  } else {
    dotaz = dotaz.is('employee_id', null)
    dotaz = zaklad.position_id !== null ? dotaz.eq('position_id', zaklad.position_id) : dotaz.is('position_id', null)
    // `time` z databáze („HH:MM:SS“) — stejný tvar, jaký porovnává `stejnyCas`.
    dotaz = dotaz.eq('starts_at', zaklad.starts_at).eq('ends_at', zaklad.ends_at)
  }
  return dotaz
}

async function najitKeZruseni(rozsah: string, smenaId: string, surove: string[]): Promise<Nalez> {
  const nacteni = await nacistZaklad(rozsah, smenaId)
  if (nacteni.stav !== 'ok') return nacteni
  const { supabase, tenantId, zaklad } = nacteni

  const overene = overitDnyRuseni(surove, zaklad.shift_date)
  if (!overene.ok) return { stav: 'chyba', text: overene.text }

  const dalsiDny = overene.dny.filter((d) => d !== zaklad.shift_date)
  let kandidati: SmenaKRuseni[] = []
  if (dalsiDny.length > 0) {
    const { data, error, count } = await dotazKandidatu(supabase, tenantId, zaklad)
      .in('shift_date', dalsiDny)
      .order('shift_date')
      .order('starts_at')
      .order('id')
    if (error) return { stav: 'chyba', text: 'Směny ve vybraných dnech se nepodařilo načíst.' }
    kandidati = (data ?? []) as unknown as SmenaKRuseni[]
    // Useknutá odpověď (limit řádků) nebo neznámý počet: odmítnout, ne tvářit se jako „nic“.
    if (count === null || count > kandidati.length) {
      return { stav: 'chyba', text: 'Ve vybraných dnech je příliš mnoho směn — vyberte méně dní.' }
    }
  }

  const smeny = vybratKeZruseni(zaklad, kandidati, overene.dny)
  // Stejné odmítnutí v náhledu i v potvrzení — viz `MAX_SMEN_RUSENI`.
  if (smeny.length > MAX_SMEN_RUSENI) return { stav: 'chyba', text: TEXT_MOC_SMEN }

  return {
    stav: 'ok',
    supabase,
    tenantId,
    zaklad,
    dny: overene.dny,
    smeny,
  }
}

/**
 * Dny se směnou pro mřížku (Šéfík 15. 10. 2026: „při rušení směn potřebuji
 * mít označené dny, kdy je směna v kalendáři, teď hádám“). Jen ČTE: celé
 * okno mřížky (`oknoRuseni`) jedním dotazem, stejné zúžení i pravidlo
 * jako náhled — značka v mřížce tedy říká přesně „tady by rušení něco
 * vzalo“. Useknutá odpověď se odmítne, ne tváří jako „tady nic není“.
 */
export async function dnySeSmenou(rozsah: string, smena: string): Promise<StavDnuSeSmenou> {
  const nacteni = await nacistZaklad(rozsah, smena)
  if (nacteni.stav !== 'ok') return nacteni
  const { supabase, tenantId, zaklad } = nacteni

  const { od, doDne } = oknoRuseni(zaklad.shift_date)
  const { data, error, count } = await dotazKandidatu(supabase, tenantId, zaklad)
    .gte('shift_date', od)
    .lte('shift_date', doDne)
    .order('shift_date')
    .order('starts_at')
    .order('id')
  if (error) return { stav: 'chyba', text: 'Dny se směnou se nepodařilo načíst.' }
  const kandidati = (data ?? []) as unknown as SmenaKRuseni[]
  if (count === null || count > kandidati.length) {
    return { stav: 'chyba', text: 'Směn je v nabízených týdnech příliš mnoho — dny se směnou se neoznačí.' }
  }
  return { stav: 'ok', dny: dnySeSmenouKRuseni(zaklad, kandidati), obsazena: zaklad.employee_id !== null }
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

  const dnyRusenychSmen = new Set(nalez.smeny.map((s) => s.shift_date))
  return { stav: 'hotovo', smeny: vysledky, dnyBezSmen: nalez.dny.filter((d) => !dnyRusenychSmen.has(d)) }
}
