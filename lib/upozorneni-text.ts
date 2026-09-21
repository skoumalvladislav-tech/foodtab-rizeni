/**
 * Věty k upozorněním.
 *
 * V databázi leží HOLÉ ÚDAJE (`notifications.telo`), věta se skládá až
 * tady — kdyby se ukládala hotová, nešla by později opravit u starých
 * zpráv.
 *
 * ---------------------------------------------------------------------
 * PROČ TO STOJÍ ZVLÁŠŤ
 *
 * Aby na to šlo sáhnout kontrolou. Obrazovka upozornění je serverová
 * komponenta s dotazy do databáze; ověřit její text jinak než
 * přihlášením do ostré aplikace nejde. Tyhle funkce se ověřit dají —
 * a `scripts/upozorneni.test.mjs` navíc hlídá, že je obrazovka opravdu
 * volá.
 *
 * ---------------------------------------------------------------------
 * DVĚ SITUACE, DVA TEXTY
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 2:
 *
 *   „Přijal a čeká na oprávnění“  → ÚKOL
 *   „Přijal a oprávnění už má“    → INFORMACE
 *
 * „První je úkol, druhé je informace. Nesmí vypadat stejně.“ Proto se
 * liší už nadpisem, ne jen odstavcem pod ním.
 */

export type TeloUpozorneni = {
  od?: string
  do?: string
  firma?: string
  role?: string | null
  rozsah?: string
  jmeno?: string
  kdo?: string
  ceka?: boolean
  pobocky?: string[]
  // pin.prenastaven
  mel_drive?: boolean
  // dochazka.zapomenuty_odchod
  moje?: boolean
  zamestnanec?: string
  den?: string
  prichod?: string
  pobocka?: string
  pobocka_slug?: string
  // Kolik zpráv/oznámení za upozorněním stojí (slučování, app.notifikovat).
  // U starších upozornění chybí — bere se jako 1.
  pocet?: number
  // Kdo změnu směny provedl (jméno). Chybí u systémových změn a starších upozornění.
  zmenil?: string
  // ukol.pridelen — id úkolu a jeho termín (YYYY-MM-DDTHH:MM v pásmu pobočky).
  ukol?: string
  termin?: string
  // smena.zmenena — stav PŘED změnou (migrace 20260919120000). U starších
  // upozornění chybí; věta se pak řekne bez „původně“.
  puvodni_den?: string
  puvodni_od?: string
  puvodni_do?: string
  puvodni_pobocka?: string
  // marketing.*
  prispevek?: string
  nazev?: string
  schvaleno?: boolean
  pripominka?: string
  kanal?: string
  pokusy?: number
  duvod?: string
}

/**
 * Vyžaduje tenhle druh výslovné potvrzení (ne jen otevření stránky)?
 *
 * Jediné místo, kde je tohle rozhodnuté — stejný důvod jako
 * u app.doruci_se v databázi: pravidlo opsané na dvou místech se
 * jednou rozejde. Jen zmenena/zrusena, ne nova/odebrana — zadání mluví
 * o změně toho, co si člověk už naplánoval, ne o nové/odebrané směně.
 * Viz supabase/migrations/20260917010000_potvrzeni_zmeny_smeny.sql.
 */
export function vyzadujePotvrzeni(druh: string): boolean {
  return druh === 'smena.zmenena' || druh === 'smena.zrusena'
}

/**
 * „Původně → nově“ u změněné směny.
 *
 * Vrací `null`, když upozornění nenese původní stav (starší, z doby před
 * migrací 20260919120000) — obrazovka pak ukáže jen nový čas a nic
 * nevymýšlí. Den se do věty píše jen tehdy, když se změnil; jinak by
 * „út 22. 9. 08:00–16:00 → út 22. 9. 10:00–18:00“ jen zdržovalo.
 */
export function zmenaSmeny(telo: TeloUpozorneni): { puvodne: string; nove: string } | null {
  if (!telo.puvodni_od || !telo.puvodni_do || !telo.od || !telo.do) return null
  const jinyDen = Boolean(telo.puvodni_den && telo.den && telo.puvodni_den !== telo.den)
  const predDnem = (iso?: string) => (jinyDen && iso ? `${denZkraceny(iso)} ` : '')
  return {
    puvodne: `${predDnem(telo.puvodni_den)}${telo.puvodni_od}–${telo.puvodni_do}`,
    nove: `${predDnem(telo.den)}${telo.od}–${telo.do}`,
  }
}

/**
 * Kam vede „Zobrazit“ u upozornění na směnu: do rozpisu, rovnou na
 * detail té směny. Bez `shift_id` (starší upozornění, odebraná směna)
 * vede jen na správný den.
 *
 * `moje` je pohled zaměstnance — příjemce upozornění je vždy někdo, kdo
 * má záznam zaměstnance, takže ho má.
 */
export function odkazNaSmenu(rozsah: string, telo: TeloUpozorneni, shiftId?: string | null): string {
  const q = new URLSearchParams({ pohled: 'moje' })
  if (telo.den) q.set('den', telo.den)
  if (shiftId) q.set('smena', shiftId)
  return `/${rozsah}/smeny?${q.toString()}`
}

/** Nadpis podle druhu. Neznámý druh se nezamlčí — ať je vidět, že přišel. */
export function nadpisUpozorneni(
  druh: string,
  telo: TeloUpozorneni,
  obdobi: (od?: string, doKdy?: string) => string,
): string {
  switch (druh) {
    case 'rozpis.vydan':
      return `Rozpis ${obdobi(telo.od, telo.do)}`
    case 'opravneni.prideleno':
      return 'Máte přidělené oprávnění'
    case 'pozvanka.prijata':
      return telo.ceka
        ? `${telo.jmeno ?? 'Někdo'} přijal pozvánku a čeká na oprávnění`
        : `${telo.jmeno ?? 'Někdo'} přijal pozvánku`
    /*
      Zapomenutý odchod. Svému a cizímu se říká jinak: „chybí VÁM“ je
      výzva, „Láďa NEMÁ“ je hlášení. Kdyby se to řeklo stejně, vedoucí
      by hledal svůj chybějící odchod.
    */
    case 'dochazka.zapomenuty_odchod':
      return telo.moje
        ? `Chybí vám odchod z ${denCesky(telo.den)}`
        : `${telo.jmeno ?? 'Někdo'} nemá odchod z ${denCesky(telo.den)}`
    /*
      PIN. Zpráva je krátká schválně a PIN v ní NENÍ — v databázi je
      jen otisk a upozornění by z něj udělalo čitelné uložení.

      Chodí jen tehdy, když PIN přenastavil někdo jiný. Bez téhle
      zprávy by šlo cizí PIN přenastavit a tiše používat, a přesně
      tomu se celé řešení vyhýbá.
    */
    case 'pin.prenastaven':
      return telo.mel_drive ? 'Váš PIN byl přenastaven' : 'Máte nový PIN ke kiosku'
    case 'smena.nova':
      return `Máte novou směnu ${denCesky(telo.den)}`
    case 'smena.zmenena':
      return `Změnila se vám směna ${denCesky(telo.den)}`
    case 'smena.odebrana':
      return `Odebrali vám směnu ${denCesky(telo.den)}`
    case 'smena.zrusena':
      return `Zrušili vám směnu ${denCesky(telo.den)}`
    case 'ukol.pridelen':
      return telo.nazev ? `Nový úkol: ${telo.nazev}` : 'Máte nový úkol'
    case 'oznameni.nova':
      return pocetUpozorneni(telo) > 1
        ? `${pocetUpozorneni(telo)} ${slovoPodleCisla(pocetUpozorneni(telo), 'nové oznámení', 'nová oznámení', 'nových oznámení')} na nástěnce`
        : 'Nové oznámení na nástěnce'
    case 'vzkaz.novy':
      return pocetUpozorneni(telo) > 1
        ? `${pocetUpozorneni(telo)} ${slovoPodleCisla(pocetUpozorneni(telo), 'nová zpráva', 'nové zprávy', 'nových zpráv')} v rozhovorech`
        : 'Nová zpráva v rozhovoru'
    /*
      MARKETING. Zadání, oddíl 14: notifikace při žádosti o schválení,
      vrácení, schválení a selhání publikace.

      Nadpis říká, CO SE STALO, ne co je to za druh zprávy. „Čeká na
      vaše odklepnutí" je výzva; „Marketing — žádost" by byl štítek,
      ze kterého člověk nepozná, jestli má něco udělat.
    */
    case 'marketing.zadost':
      return `${telo.nazev || 'Příspěvek'} čeká na vaše odklepnutí`
    case 'marketing.rozhodnuto':
      return telo.schvaleno
        ? `${telo.nazev || 'Příspěvek'} je schválený`
        : `${telo.nazev || 'Příspěvek'} vám vrátili`
    /*
      Selhání se říká nahlas a bez obalu. „Nevyšlo" by znělo jako
      drobnost — přitom to znamená, že příspěvek na síti NENÍ a bez
      člověka tam nebude.
    */
    case 'marketing.publikace_selhala':
      return `${telo.nazev || 'Příspěvek'} se nepodařilo zveřejnit`
    default:
      return 'Upozornění'
  }
}

/** Kolik zpráv za upozorněním stojí; bez údaje 1. */
export function pocetUpozorneni(telo: TeloUpozorneni): number {
  const n = Number(telo.pocet)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/**
 * České skloňování podle počtu: 1 zpráva, 2–4 zprávy, 5 a víc zpráv (a 0).
 * Jedno místo, ať se „3 zpráv“ neobjeví v jedné obrazovce a „3 zprávy“
 * v jiné.
 */
export function slovoPodleCisla(n: number, jedno: string, dve: string, pet: string): string {
  const cele = Math.abs(Math.trunc(n))
  if (cele === 1) return jedno
  if (cele >= 2 && cele <= 4) return dve
  return pet
}

/**
 * Souhrn, který se pošle místo dávky pípnutí po příchodu do práce:
 * „Čekají na vás 3 zprávy“. Bez obsahu — text zprávy se nikdy nenosí
 * do notifikace (ani na zamčenou obrazovku).
 */
export function souhrnCekajicich(pocet: number): string {
  const n = Math.max(1, Math.floor(pocet))
  if (n === 1) return 'Čeká na vás 1 zpráva'
  return `Čekají na vás ${n} ${slovoPodleCisla(n, 'zpráva', 'zprávy', 'zpráv')}`
}

/**
 * Karta změny směny (zadání Provozního centra):
 *
 *   ZMĚNA SMĚNY
 *   Úterý 22. 9.
 *   Původně  18:00–22:00
 *   Nově     16:00–22:00
 *   Změnil: vedoucí provozu
 *
 * Skládá se výhradně z holých údajů v `telo`. Notifikaci NEVYTVÁŘÍ UI Směn
 * — ta vzniká z události v databázi (app.upozornit_smenu → app.notifikovat).
 * Vrací `null`, když upozornění nenese původní stav (starší z doby před
 * migrací 20260919120000): karta se pak nezobrazí a nic se nevymýšlí.
 */
export type KartaZmenySmeny = {
  nadpis: 'ZMĚNA SMĚNY'
  den: string
  puvodne: string
  nove: string
  zmenil: string | null
}

export function kartaZmenySmeny(telo: TeloUpozorneni): KartaZmenySmeny | null {
  const z = zmenaSmeny(telo)
  if (!z || !telo.den) return null
  const den = denCesky(telo.den)
  return {
    nadpis: 'ZMĚNA SMĚNY',
    den: den.charAt(0).toUpperCase() + den.slice(1),
    puvodne: z.puvodne,
    nove: z.nove,
    zmenil: telo.zmenil?.trim() ? telo.zmenil.trim() : null,
  }
}

/** Priorita upozornění. `low` = tichý záznam bez odznaku a bez push. */
export type PrioritaUpozorneni = 'low' | 'normal' | 'important' | 'urgent'

export const POPIS_PRIORITY: Record<PrioritaUpozorneni, string> = {
  low: 'Nízká',
  normal: 'Běžná',
  important: 'Důležitá',
  urgent: 'Naléhavá',
}

/** Neznámá hodnota z databáze se bere jako běžná — upozornění nezmizí kvůli překlepu. */
export function prioritaUpozorneni(hodnota: unknown): PrioritaUpozorneni {
  return hodnota === 'low' || hodnota === 'important' || hodnota === 'urgent' ? hodnota : 'normal'
}

/** Počítá se upozornění do odznaku u zvonečku? Tichá (low) ne. */
export function pocitaSeDoOdznaku(priorita: unknown): boolean {
  return prioritaUpozorneni(priorita) !== 'low'
}

/**
 * Věta pod nadpisem u zapomenutého odchodu.
 *
 * ŽÁDNÁ MZDA, SAZBA ANI ČÁSTKA. Chybějící odchod je provozní věc, ne
 * mzdová — a ta věta o nezapočítaných hodinách mluví o hodinách,
 * ne o penězích.
 */
export function popisZapomenuteho(telo: TeloUpozorneni): string {
  const prichod = telo.prichod ? `Příchod v ${telo.prichod}.` : ''
  const pobocka = telo.pobocka ? ` ${telo.pobocka}.` : ''

  if (telo.moje) {
    return `${prichod}${pobocka} Dokud odchod nedoplníte, směna se nezapočítá do odpracovaných hodin.`.trim()
  }
  return `${prichod}${pobocka}`.trim()
}

/** Věta pod nadpisem u přenastaveného PINu. */
export function popisPinu(telo: TeloUpozorneni): string {
  return telo.mel_drive
    ? 'Starý přestal platit. Nový vám předá vedoucí — do zprávy se nepíše.'
    : 'Nový PIN vám předá vedoucí. Do zprávy se nepíše, přečíst se nedá ani z databáze.'
}

/** „pondělí 31. 8.“ — den v týdnu pomáhá víc než samotné datum. */
export function denCesky(iso?: string): string {
  if (!iso) return 'neznámého dne'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const dny = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`
}

/**
 * „st 10. 9.“ — zkrácený tvar pro seznamy, kde je den vedle sebe víc
 * (rozpis, výpis upozornění). Není totéž co denCesky() — ten píše celé
 * jméno dne do věty ("Máte novou směnu pondělí…"), tohle je pro sloupec.
 */
export function denZkraceny(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const dny = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`
}

/** „st 10. 9. – pá 12. 9.“ — rozsah vydaného rozpisu v hlavičce upozornění. */
export function obdobiRozpisu(od?: string, doKdy?: string): string {
  if (!od || !doKdy) return ''
  return `${denZkraceny(od)} – ${denZkraceny(doKdy)}`
}

/** „Má oprávnění Servis, Restaurace Černá Perla.“ */
export function popisOpravneni(telo: TeloUpozorneni): string {
  const kusy = [telo.role, ...(telo.pobocky ?? [])].filter(Boolean)
  if (kusy.length === 0) return 'Oprávnění už má.'
  return `Má oprávnění ${kusy.join(', ')}.`
}


/**
 * Věta pod nadpisem u marketingových upozornění.
 *
 * ---------------------------------------------------------------------
 * CO SE V NÍ ŘÍKÁ A CO NE
 *
 * U žádosti KDO o ni požádal a na které provozovně — podle toho se
 * pozná, jestli to je na mně. U vrácení PŘIPOMÍNKA, protože bez ní je
 * zpráva k ničemu: člověk ví, že to neprošlo, a netuší proč.
 *
 * U selhání PŮVODNÍ HLÁŠKA od poskytovatele, i když je anglicky.
 * Radu česky má obrazovka Publikované; tady jde o to, aby šlo
 * dohledat, co se doopravdy stalo.
 */
export function popisMarketingu(druh: string, telo: TeloUpozorneni): string {
  if (druh === 'marketing.zadost') {
    const kdo = telo.kdo ? `${telo.kdo} žádá o schválení.` : 'Někdo žádá o schválení.'
    return telo.pobocka ? `${kdo} ${telo.pobocka}.` : kdo
  }

  if (druh === 'marketing.rozhodnuto') {
    const kdo = telo.kdo ?? 'Někdo'
    if (telo.schvaleno) {
      return `${kdo} ho schválil. Teď se dá naplánovat ke zveřejnění.`
    }
    /*
      PŘIPOMÍNKA JE TU POVINNÁ ČÁST VĚTY, ne doplněk. Zamítnutí bez
      důvodu databáze ani nedovolí (`marketing_schvaleni_zamitnuti_ma_duvod`),
      takže prázdná být nemá — a když přece je, řekne se to nahlas
      místo mlčení.
    */
    return telo.pripominka
      ? `${kdo} ho vrátil: ${telo.pripominka}`
      : `${kdo} ho vrátil, ale nenapsal proč.`
  }

  if (druh === 'marketing.publikace_selhala') {
    const kam = telo.kanal === 'instagram' ? 'Instagram'
      : telo.kanal === 'facebook' ? 'Facebook'
        : telo.kanal ?? 'sítě'
    const pokusy = telo.pokusy && telo.pokusy > 1 ? ` po ${telo.pokusy} pokusech` : ''
    const duvod = telo.duvod ? ` Hlášení: ${telo.duvod}` : ''
    return `Na ${kam} to neodešlo${pokusy}. Na síti to není a samo se to už nezkusí.${duvod}`
  }

  return ''
}
