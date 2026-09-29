'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import type { VysledekDne } from '@/lib/vyber-dnu'

/**
 * Založení a úprava směny z kalendáře.
 *
 * Zadání docs/nocni-prace-2026-09-03.md, bod 2.
 *
 * ---------------------------------------------------------------------
 * ČASY SE TU NEPŘEVÁDÍ
 *
 * Z políčka `type="time"` chodí „HH:MM“ a do sloupce `time` se ukládá
 * beze změny. Rozpis je plán: „ve dvě odpoledne“ znamená ve dvě
 * odpoledne na té pobočce, ať je zrovna letní čas nebo zimní.
 *
 * Žádné `new Date()` — ranní chyba (viz docs/odpoved-na-nalez-casu-
 * 2026-09-02.md) vznikla přesně tím, že se hodina na zdi převedla
 * v pásmu serveru.
 *
 * ---------------------------------------------------------------------
 * VAROVÁNÍ NEJSOU CHYBY
 *
 * Překryv a začátek před provozním dnem se vracejí jako varování
 * a směna se uloží. Dělené směny a záskoky existují a aplikace o nich
 * neví dost na to, aby je zakázala — stejná úvaha jako u horní meze
 * u záloh.
 *
 * ---------------------------------------------------------------------
 * VÍC DNŮ NAJEDNOU (Šéfík 29. 9. 2026)
 *
 * Formulář nové směny umí místo jednoho pole „den“ poslat víc hodnot
 * `dny` (výběr víc dnů, viz vyber-dnu.tsx). `ulozit_smenu` je čisté,
 * bezstavové RPC — bezpečně volatelné vícekrát v cyklu — takže se prostě
 * zavolá JEDNOU PRO KAŽDÝ den, vždy jako nová směna (`p_smena: null`),
 * se stejnými ostatními parametry. Volá se PO SOBĚ, ne najednou
 * (`Promise.all`): RPC si uvnitř kontroluje překryv u téhož člověka a
 * souběžná volání by nad stejnou pobočkou a časem závodila.
 *
 * Selže-li jeden den tvrdou chybou, ostatní dny se přesto založí —
 * částečný úspěch je lepší než nic, ale musí být VIDĚT: vrací se výčet
 * `dny` s výsledkem každého dne zvlášť, formulář z něj složí srozumitelnou
 * hlášku (souhrnZalozeni, lib/vyber-dnu.ts) a vypíše, který den a proč
 * neprošel. U jednoho dne (běžná cesta beze změny) se `dny` nevrací vůbec.
 */

export type StavSmeny =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | {
      stav: 'hotovo'
      varovani: string[]
      /**
       * Jen u výběru VÍC dnů: výsledek každého dne zvlášť (založeno,
       * chyba, varování). U jednoho dne `undefined` — nic se pro něj
       * nemění, čte se `varovani` jako dřív.
       */
      dny?: VysledekDne[]
    }

export async function ulozitSmenu(
  _predchozi: StavSmeny,
  formData: FormData,
): Promise<StavSmeny> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const smena = String(formData.get('smena') ?? '').trim() || null
  const pobocka = String(formData.get('pobocka') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '').trim() || null
  const pozice = String(formData.get('pozice') ?? '').trim() || null
  const den = String(formData.get('den') ?? '')
  const od = String(formData.get('od') ?? '')
  const doKdy = String(formData.get('do') ?? '')
  const poznamka = String(formData.get('poznamka') ?? '')
  /*
    Zkratka šablony se jen OPÍŠE — je to popiska, ne odkaz. Formulář ji
    posílá jen tehdy, když časy pořád odpovídají té šabloně; kdo je
    přepsal, poslal prázdno a v řádku pak žádná zkratka nestojí. „D“
    u směny od devíti do pěti by lhalo.
  */
  const sablona = String(formData.get('sablona') ?? '').trim() || null
  /*
    Trhaná směna — pauza uvnitř. Nezaškrtnuté zaškrtávátko pole vůbec
    nevykreslí (viz formular-smeny.tsx), takže tu chybí docela; prázdný
    řetězec se posílá dál jako "bez pauzy" stejně jako chybějící pole.
  */
  const pauzaOd = String(formData.get('pauza_od') ?? '').trim() || null
  const pauzaDo = String(formData.get('pauza_do') ?? '').trim() || null

  /*
    Víc dnů najednou — jen u NOVÉ směny (formulář pole „dny“ u úpravy
    vůbec nekreslí; brání se to tu i tak, kdyby se pole omylem poslalo
    s `smena`, ať úprava nikdy nezaloží druhou směnu navíc).

    Deduplikace (`Set`): `prepnoutDen` na straně formuláře duplicitu do
    výběru nikdy nepustí, ale formulář odesílá syrová data z prohlížeče —
    kdo by pole `dny` poslal ručně s opakovaným dnem (devtools, budoucí
    regrese), nesmí tím založit tomu člověku dvě identické směny na týž
    den. `ulozit_smenu` bere překryv jen jako varování, ne jako zamítnutí.
  */
  const dny = [
    ...new Set(
      formData
        .getAll('dny')
        .map((d) => String(d).trim())
        .filter(Boolean),
    ),
  ]
  const viceDni = !smena && dny.length > 0

  if (!pobocka) return { stav: 'chyba', text: 'Vyberte pobočku.' }
  if (viceDni) {
    if (!od || !doKdy) return { stav: 'chyba', text: 'Vyplňte čas od–do.' }
  } else if (!den || !od || !doKdy) {
    return { stav: 'chyba', text: 'Vyplňte datum a čas od–do.' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  /*
    První obranná linie. Druhá je uvnitř `ulozit_smenu`, která si
    `shifts.manage` ověří na TÉ POBOČCE, která přišla — a při úpravě
    i na té původní. Pobočka z prohlížeče je návrh (pravidlo 4).
  */
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Plánovat směny nemáte oprávnění.' }
  }

  const supabase = await getServerSupabase()

  /**
   * Jedno volání RPC pro jeden den — sdílí ho úprava, jednodenní i
   * vícedenní založení. `pSmena` je `null` u založení (nová směna toho
   * dne) a id u úpravy jediné existující směny.
   */
  async function ulozitJedenDen(pSmena: string | null, jedenDen: string): Promise<VysledekDne> {
    const { data, error } = await supabase.rpc('ulozit_smenu', {
      p_tenant: tenantId,
      p_smena: pSmena,
      p_branch: pobocka,
      p_employee: zamestnanec,
      p_position: pozice,
      p_den: jedenDen,
      // „HH:MM“ jde do `time` tak, jak přišlo. Viz hlavička.
      p_od: od,
      p_do: doKdy,
      p_poznamka: poznamka,
      p_sablona_key: sablona,
      p_pauza_od: pauzaOd,
      p_pauza_do: pauzaDo,
    })

    // Hlášku píše databáze a je pro člověka — projde se dál, ať se
    // nevymýšlí druhá.
    if (error) return { den: jedenDen, chyba: error.message, varovani: [] }

    const r = (data as { smena: string; varovani: string[] }[])?.[0]
    if (!r?.smena) return { den: jedenDen, chyba: 'Směna se nezapsala.', varovani: [] }

    return { den: jedenDen, chyba: null, varovani: r.varovani ?? [] }
  }

  if (viceDni) {
    const vysledky: VysledekDne[] = []
    // Postupně, ne Promise.all — viz hlavičku (souběh by závodil o stejnou
    // pobočku a stejného člověka nad kontrolou překryvu).
    for (const jedenDen of dny) {
      vysledky.push(await ulozitJedenDen(null, jedenDen))
    }

    // Obnovit rozpis, jen když se aspoň jedna směna opravdu založila.
    if (vysledky.some((v) => v.chyba === null)) revalidatePath(`/${rozsah}/smeny`)

    return { stav: 'hotovo', varovani: [], dny: vysledky }
  }

  const vysledek = await ulozitJedenDen(smena, den)
  if (vysledek.chyba) return { stav: 'chyba', text: vysledek.chyba }

  revalidatePath(`/${rozsah}/smeny`)
  return { stav: 'hotovo', varovani: vysledek.varovani }
}

/**
 * Smazání směny z kalendáře.
 *
 * Hlásil Šéfík z provozu 9. 9. 2026: mazat směny nešlo, jen přidávat.
 * Nebylo to rozbité — nikdy to nevzniklo.
 *
 * ---------------------------------------------------------------------
 * VYDANOU SMĚNU TO NESMAŽE, A JE TO ZÁMĚR
 *
 * Rozhoduje o tom databáze (`public.smazat_smenu`), ne tenhle soubor:
 * lidem se ukazuje VYDANÁ podoba rozpisu, takže smazání vydané směny
 * by ji z jejich rozpisu odstranilo okamžitě — bez vydání a bez
 * upozornění. Zrušení vydané směny je vlastní věc a udělá se zvlášť
 * (otázka 7 v docs/hlaseni/otazky.md).
 *
 * Hlášku o tom píše databáze a propouští se beze změny, ať se
 * nevymýšlí druhá.
 */
export async function smazatSmenu(
  _predchozi: StavSmeny,
  formData: FormData,
): Promise<StavSmeny> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const smena = String(formData.get('smena') ?? '').trim()
  if (!smena) return { stav: 'chyba', text: 'Nevím, kterou směnu mám smazat.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  /*
    První obranná linie. Druhá je uvnitř `smazat_smenu`, která si
    `shifts.manage` ověří na pobočce TÉ SMĚNY — ne na té z adresy.
    Pobočka z prohlížeče je návrh (pravidlo 4).
  */
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Mazat směny nemáte oprávnění.' }
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('smazat_smenu', {
    p_tenant: tenantId,
    p_smena: smena,
  })

  if (error) return { stav: 'chyba', text: error.message }

  revalidatePath(`/${rozsah}/smeny`)

  return { stav: 'hotovo', varovani: [] }
}
