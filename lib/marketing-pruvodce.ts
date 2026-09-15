import {
  PORADI_KATEGORII,
  POSKYTOVATELE,
  type Kategorie,
  type Poskytovatel,
  type Rezim,
} from './marketing-katalog.ts'

/**
 * Průvodce prvním spuštěním — doporučená sestava podle odpovědí.
 *
 * Zadání: master prompt, oddíl 6 a obrazovka 2 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ JEN „TADY MÁTE KATALOG"
 *
 * Obrazovka Nástroje ukazuje devět kategorií a v každé pár možností.
 * Kdo marketing zapíná poprvé, na ni kouká a neví, čím začít — a
 * výsledek je, že nezačne ničím.
 *
 * Průvodce se zeptá na čtyři věci a z odpovědí složí sestavu. NENÍ to
 * zámek: každou kategorii jde pak na Nástrojích vyměnit.
 *
 * ---------------------------------------------------------------------
 * DOPORUČENÍ MUSÍ BÝT PRŮHLEDNÉ — A U KAŽDÉHO KUSU JE NAPSANÉ PROČ
 *
 * Zadání to říká výslovně: „Doporučení musí být transparentní a nesmí
 * tvrdit, že jedna placená služba je povinná."
 *
 * Proto `duvod` u každé položky a proto se u sestavy vrací i to, co
 * se NEDOPORUČUJE a proč. Doporučení bez důvodu je reklama.
 *
 * ---------------------------------------------------------------------
 * NIC SE TU NEPŘIPOJUJE
 *
 * Průvodce jen SPOČÍTÁ, co doporučit. Připojení — s klíči, šifrováním
 * a zkouškou spojení — dělá obrazovka Nástroje. Kdyby to uměl i on,
 * byly by to dvě cesty k témuž a jedna z nich by se rozešla.
 */

/** Na co se ptáme. Čtyři otázky, ne deset — kdo zapíná poprvé, nechce dotazník. */
export type Odpovedi = {
  /** Co chce hlavně dělat. */
  cil: 'texty' | 'texty_a_grafika' | 'vse_vcetne_videa'
  /** Co je přednější. */
  priorita: 'jednoduchost' | 'cena' | 'kvalita'
  /** Má se zveřejňovat samo, nebo si to zveřejní sám? */
  zverejnovani: 'automaticky' | 'rucne'
  /** Čí účty se použijí. */
  ucty: 'vlastni' | 'foodtab'
}

export const OTAZKY = [
  {
    klic: 'cil',
    otazka: 'Co chcete hlavně vytvářet?',
    moznosti: [
      { klic: 'texty', nazev: 'Hlavně texty', popis: 'Popisky k fotkám, které už máte.' },
      { klic: 'texty_a_grafika', nazev: 'Texty a obrázky', popis: 'K tomu grafika z menu a fotek.' },
      { klic: 'vse_vcetne_videa', nazev: 'I videa a Reels', popis: 'Nejvíc práce, nejvíc dosahu.' },
    ],
  },
  {
    klic: 'priorita',
    otazka: 'Co je pro vás přednější?',
    moznosti: [
      { klic: 'jednoduchost', nazev: 'Ať je to jednoduché', popis: 'Co nejmíň nastavování.' },
      { klic: 'cena', nazev: 'Ať to stojí co nejmíň', popis: 'Radši víc práce než víc účtů.' },
      { klic: 'kvalita', nazev: 'Ať je to co nejlepší', popis: 'Kvalita před jednoduchostí.' },
    ],
  },
  {
    klic: 'zverejnovani',
    otazka: 'Má se to zveřejňovat samo?',
    moznosti: [
      { klic: 'automaticky', nazev: 'Ano, po schválení samo', popis: 'Odklepnete a odejde to v naplánovaný čas.' },
      { klic: 'rucne', nazev: 'Ne, zveřejním si to sám', popis: 'Foodtab připraví, vy vložíte na síť.' },
    ],
  },
  {
    klic: 'ucty',
    otazka: 'Čí účty se použijí?',
    moznosti: [
      { klic: 'vlastni', nazev: 'Vlastní', popis: 'Platíte přímo poskytovateli, Foodtab do toho nevstupuje.' },
      { klic: 'foodtab', nazev: 'Přes Foodtab', popis: 'Balíček od Foodtabu. Zatím jen u některých nástrojů.' },
    ],
  },
] as const

export type Polozka = {
  kategorie: Kategorie
  poskytovatel: Poskytovatel | null
  rezim: Rezim
  duvod: string
}

/**
 * Doporučená sestava.
 *
 * ---------------------------------------------------------------------
 * CO SE NEDOPORUČUJE, SE ŘEKNE TAKY
 *
 * Kategorie, kterou podle odpovědí nepotřebujete, se vrátí
 * s `poskytovatel: null` a s důvodem. Vynechat ji úplně by vypadalo
 * jako nedodělek — a člověk by nevěděl, jestli se na ni zapomnělo,
 * nebo ji nepotřebuje.
 */
export function doporucenaSestava(o: Odpovedi): Polozka[] {
  const sestava: Polozka[] = []

  const vezmi = (kategorie: Kategorie, filtr?: (p: Poskytovatel) => boolean): Poskytovatel | null => {
    const vhodni = POSKYTOVATELE.filter(
      (p) => p.kategorie.includes(kategorie) && p.podporovany && (!filtr || filtr(p)),
    )
    // Doporučený má přednost; když žádný není, bere se první podporovaný.
    return vhodni.find((p) => p.doporuceny) ?? vhodni[0] ?? null
  }

  /*
    REŽIM SE ODVOZUJE Z ODPOVĚDI, ALE JEN KDYŽ HO POSKYTOVATEL UMÍ.

    Kdo si zvolil „přes Foodtab", ale poskytovatel takový režim nemá,
    dostane `zakaznicky` — a v důvodu se to řekne. Slíbit balíček,
    který u toho nástroje není, by se poznalo až při připojování.
  */
  const rezimPro = (p: Poskytovatel | null): Rezim => {
    if (!p) return 'rucni'
    const chce: Rezim = o.ucty === 'foodtab' ? 'foodtab' : 'zakaznicky'
    return p.rezimy.includes(chce) ? chce : (p.rezimy[0] ?? 'zakaznicky')
  }

  /* --- TEXT: vždycky ------------------------------------------------ */

  const text = vezmi('ai_text')
  sestava.push({
    kategorie: 'ai_text',
    poskytovatel: text,
    rezim: rezimPro(text),
    duvod: o.priorita === 'cena'
      ? 'Text je to nejlevnější, co AI umí — pár haléřů za příspěvek. Bez něj se píše všechno ručně.'
      : 'Píše česky a drží tón hlasu ze Značky. Je to základ, na kterém stojí zbytek.',
  })

  /* --- OBRÁZKY ------------------------------------------------------ */

  const chceGrafiku = o.cil !== 'texty'
  const obrazek = chceGrafiku ? vezmi('render_obrazek') : null
  sestava.push({
    kategorie: 'render_obrazek',
    poskytovatel: obrazek,
    rezim: rezimPro(obrazek),
    duvod: !chceGrafiku
      ? 'Nepotřebujete — řekli jste, že budete používat vlastní fotky.'
      : obrazek
        ? 'Vyrobí obrázek z menu a fotek podle Značky, aby se nemuselo kreslit ručně.'
        : 'Zatím k tomu nemáme odzkoušený nástroj. Do té doby se používají vlastní fotky.',
  })

  /* --- VIDEO -------------------------------------------------------- */

  const chceVideo = o.cil === 'vse_vcetne_videa'
  const video = chceVideo ? vezmi('render_video') : null
  sestava.push({
    kategorie: 'render_video',
    poskytovatel: video,
    rezim: rezimPro(video),
    duvod: !chceVideo
      ? 'Nepotřebujete — videa jste nechtěli. Dá se přidat kdykoli později.'
      : video
        ? 'Složí Reel z fotek a titulků. Je to z celé sestavy nejdražší položka.'
        : 'Zatím k tomu nemáme odzkoušený nástroj. Video se dá nahrát hotové.',
  })

  /* --- ZVEŘEJŇOVÁNÍ -------------------------------------------------- */

  /*
    RUČNÍ REŽIM JE PLNOHODNOTNÁ VOLBA, NE NOUZOVKA.

    Zadání: „nesmí tvrdit, že jedna placená služba je povinná".
    Kdo si vybral ruční zveřejňování, nedostane doporučení připojit
    publikování — dostane vysvětlení, že modul funguje i tak.
  */
  const publikovani = o.zverejnovani === 'automaticky' ? vezmi('publikovani') : null
  sestava.push({
    kategorie: 'publikovani',
    poskytovatel: publikovani,
    rezim: o.zverejnovani === 'automaticky' ? rezimPro(publikovani) : 'rucni',
    duvod: o.zverejnovani === 'rucne'
      ? 'Nepotřebujete. Foodtab příspěvek připraví a vy ho vložíte na síť sami — '
        + 'schvalování, kalendář i měření fungují stejně.'
      : publikovani
        ? 'Odešle schválený příspěvek v naplánovaný čas. Bez něj se plánovat dá, '
          + 'ale ven to musíte poslat sami.'
        : 'Zatím k tomu nemáme odzkoušený nástroj — zveřejňovat se bude ručně.',
  })

  /* --- AUTOMATIZACE -------------------------------------------------- */

  const automatizace = o.zverejnovani === 'automaticky' ? vezmi('automatizace') : null
  sestava.push({
    kategorie: 'automatizace',
    poskytovatel: automatizace,
    rezim: rezimPro(automatizace),
    duvod: o.zverejnovani === 'rucne'
      ? 'Nepotřebujete — bez automatického zveřejňování nemá co spouštět.'
      : o.priorita === 'jednoduchost'
        ? 'Jednu věc navíc na nastavení. Kdo chce co nejmíň nastavování, může ji zatím vynechat — '
          + 'zveřejňování bez ní funguje.'
        : 'Propojí Foodtab se sítěmi a dá se v ní doladit, co se kam posílá.',
  })

  /* --- ZBYTEK: zatím ne --------------------------------------------- */

  for (const k of PORADI_KATEGORII) {
    if (sestava.some((s) => s.kategorie === k)) continue
    sestava.push({
      kategorie: k,
      poskytovatel: null,
      rezim: 'rucni',
      duvod: 'Pro začátek to potřeba není. Dá se přidat kdykoli později v Nástrojích.',
    })
  }

  // Pořadí podle katalogu, ne podle toho, v jakém se to skládalo.
  return PORADI_KATEGORII
    .map((k) => sestava.find((s) => s.kategorie === k))
    .filter((s): s is Polozka => Boolean(s))
}

/**
 * Kolik kroků sestavy je k dispozici hned.
 *
 * Ukazuje se na konci průvodce: „ze sedmi věcí jsou tři připravené
 * k připojení". Číslo bez jmen by nepomohlo, ale s ním je vidět, že
 * to není deset úkolů.
 */
export function kolikKPripojeni(sestava: Polozka[]): number {
  return sestava.filter((s) => s.poskytovatel !== null).length
}

/**
 * Výchozí odpovědi.
 *
 * Vybrané jsou ty nejméně zavazující: texty, jednoduchost, ruční
 * zveřejňování, vlastní účty. Kdo průvodce proklikne bez čtení,
 * neskončí s doporučením zapnout automatické zveřejňování na účtu
 * Foodtabu.
 */
export const VYCHOZI: Odpovedi = {
  cil: 'texty',
  priorita: 'jednoduchost',
  zverejnovani: 'rucne',
  ucty: 'vlastni',
}

/** Odpověď z formuláře, ověřená proti seznamu. Neznámá se nahradí výchozí. */
export function precistOdpovedi(ziskej: (klic: string) => string | null): Odpovedi {
  const vyber = <K extends keyof Odpovedi>(klic: K): Odpovedi[K] => {
    const otazka = OTAZKY.find((o) => o.klic === klic)
    const prislo = ziskej(klic)
    const sedi = otazka?.moznosti.some((m) => m.klic === prislo)
    return (sedi ? prislo : VYCHOZI[klic]) as Odpovedi[K]
  }

  return {
    cil: vyber('cil'),
    priorita: vyber('priorita'),
    zverejnovani: vyber('zverejnovani'),
    ucty: vyber('ucty'),
  }
}
