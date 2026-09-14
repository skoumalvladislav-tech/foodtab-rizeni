import { FORMATY, formatSpec, type FormatSpec } from './marketing-formaty.ts'

/**
 * Co která síť snese — a co na ni nemá cenu posílat.
 *
 * Zadání: master prompt, oddíl 16.
 *
 * ---------------------------------------------------------------------
 * PROČ TO VZNIKLO
 *
 * Do 14. 9. 2026 se Instagram a Facebook chovaly stejně, protože se
 * o rozdílech nikde nerozhodovalo. Mělo to jeden konkrétní následek:
 * `lib/marketing-odeslani.ts` odmítal KAŽDÝ příspěvek bez fotky větou
 * „Instagram příspěvek bez fotky nepřijme". U Instagramu to platí,
 * u Facebooku ne — stránka text bez obrázku přijme normálně. Facebook
 * tedy nešel zveřejnit textem, ačkoli síť to umí.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLA JSOU DATA, NE `if` V ODESÍLÁNÍ
 *
 * Rozdíly mezi sítěmi se mění častěji než náš kód. Když stojí jako
 * tabulka, je vidět, co se o které síti tvrdí, a dá se to opravit na
 * jednom místě. Roztroušené `if (kanal === 'instagram')` se opraví na
 * čtyřech místech z pěti.
 *
 * ---------------------------------------------------------------------
 * ROZMĚRY A LIMITY SE NEOPISUJÍ
 *
 * Šířka, výška, strop popisku a počet hashtagů už jsou v
 * `lib/marketing-formaty.ts`. Tenhle soubor je NEKOPÍRUJE — vytahuje
 * si je odtamtud. Dvě tabulky s limity by se rozešly a nikdo by
 * nevěděl, která platí.
 */

/**
 * Jak se jmenuje formát v publikační úloze.
 *
 * `marketing_publikace_ulohy.format` drží dnes u všeho `'prispevek'`;
 * `lib/marketing-formaty.ts` zná podrobnější klíče (`feed`,
 * `page_post`, `story`, `reel`). Tohle je most mezi tím.
 *
 * PŘEJMENOVAT ULOŽENÝ FORMÁT BY BYLO DRAŽŠÍ, NEŽ TO VYPADÁ. Stojí
 * v idempotenčním klíči (`publikace:verze:kanal:format`), který drží
 * jedinečnost. Změnit ho znamená, že dosud odeslaná úloha se přestane
 * poznávat — a při opakování by odešla podruhé. Most je levnější než
 * převod, dokud není důvod.
 */
const VYCHOZI_FORMAT: Record<string, string> = {
  instagram: 'instagram_feed',
  facebook: 'facebook_post',
}

/** Kde v `FORMATY` leží ten, kterým se úloha odešle. */
export function specProUlohu(kanal: string, format: string): FormatSpec | undefined {
  // Nejdřív přesný klíč (`instagram_story`), pak formát uvnitř sítě
  // (`story`), a teprve nakonec výchozí příspěvek té sítě.
  return (
    formatSpec(format)
    ?? Object.values(FORMATY).find((f) => f.channel === kanal && f.format === format)
    ?? formatSpec(VYCHOZI_FORMAT[kanal] ?? '')
  )
}

export type PravidlaKanalu = {
  klic: string
  nazev: string
  /**
   * Přijme síť příspěvek BEZ obrázku?
   *
   * Instagram ne — je to obrázková síť a příspěvek bez média odmítne.
   * Facebook ano — stránka běžně publikuje samotný text.
   */
  potrebujeFotku: boolean
  /** Kolik znaků popisku síť unese. Z `marketing-formaty.ts`. */
  stropZnaku: number
  /** Kolik hashtagů má smysl. Víc není chyba, jen to nikomu nepomůže. */
  stropHashtagu: number
  /** Věta pro člověka, ne pro vývojáře. */
  poznamka: string
}

export function pravidlaKanalu(kanal: string): PravidlaKanalu | undefined {
  const spec = specProUlohu(kanal, VYCHOZI_FORMAT[kanal] ?? '')
  if (!spec) return undefined

  if (kanal === 'instagram') {
    return {
      klic: 'instagram',
      nazev: 'Instagram',
      potrebujeFotku: true,
      stropZnaku: spec.captionMaxChars,
      stropHashtagu: spec.hashtagsMax,
      poznamka: 'Bez fotky to Instagram nepřijme. Hashtagy tady fungují — vejde se jich '
        + `${spec.hashtagsMax}.`,
    }
  }

  if (kanal === 'facebook') {
    return {
      klic: 'facebook',
      nazev: 'Facebook',
      potrebujeFotku: false,
      stropZnaku: spec.captionMaxChars,
      stropHashtagu: spec.hashtagsMax,
      poznamka: 'Facebook přijme i samotný text bez fotky. Hashtagů tu netřeba tolik jako '
        + 'na Instagramu — dosah zvyšují míň.',
    }
  }

  return undefined
}

export type Nalez = {
  /**
   * `nelze` = síť to odmítne, nemá cenu to posílat.
   * `varovani` = projde to, ale nejspíš to nedopadne, jak si člověk myslí.
   */
  druh: 'nelze' | 'varovani'
  text: string
}

/**
 * Projde příspěvek dřív, než se pošle ven.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TO KONTROLUJE PŘEDEM A NE PODLE ODPOVĚDI
 *
 * Odeslat příspěvek, o kterém dopředu víme, že ho síť odmítne, stojí
 * pokus. Fronta pak počká pět minut, zkusí to znovu, a po pěti kolech
 * to vzdá s hláškou od Mety, ze které nikdo nepozná, že prostě chybí
 * fotka. Člověk mezitím čeká na příspěvek, který nikdy neodejde.
 *
 * ---------------------------------------------------------------------
 * `schopnosti` JSOU TO, CO POSKYTOVATEL POVOLIL PRO TENHLE ÚČET
 *
 * Ne co síť umí obecně. Story přes API jde jen u profesionálního účtu
 * a je to v `marketing_ucty.schopnosti`. Prázdný seznam znamená
 * „nevíme" — tehdy se NEODMÍTÁ. Tvrdit „tohle váš účet neumí" na
 * základě toho, že jsme se nezeptali, je horší než to zkusit.
 */
export function zkontrolovat(vstup: {
  kanal: string
  format: string
  text: string
  pocetFotek: number
  schopnostiUctu?: string[]
}): Nalez[] {
  const nalezy: Nalez[] = []
  const pravidla = pravidlaKanalu(vstup.kanal)
  const spec = specProUlohu(vstup.kanal, vstup.format)

  if (!pravidla || !spec) {
    nalezy.push({
      druh: 'nelze',
      text: `Síť „${vstup.kanal}" modul neumí zveřejnit. Zveřejněte to ručně.`,
    })
    return nalezy
  }

  const text = vstup.text.trim()

  if (text === '') {
    nalezy.push({
      druh: 'nelze',
      text: `Pro ${pravidla.nazev} chybí text. Doplňte ho v příspěvku.`,
    })
  }

  if (pravidla.potrebujeFotku && vstup.pocetFotek === 0) {
    nalezy.push({
      druh: 'nelze',
      text: `${pravidla.nazev} příspěvek bez fotky nepřijme. Vyberte fotku a naplánujte znovu.`,
    })
  }

  if (pravidla.stropZnaku > 0 && text.length > pravidla.stropZnaku) {
    nalezy.push({
      druh: 'nelze',
      text: `Text pro ${pravidla.nazev} má ${text.length} znaků, vejde se ${pravidla.stropZnaku}. `
        + 'Zkraťte ho — síť ho jinak odmítne.',
    })
  }

  /*
    Hashtagů navíc je VAROVÁNÍ, ne překážka. Síť příspěvek vezme;
    jen ty přes limit ignoruje. Odmítnout to by bylo přísnější než
    sama síť — a to je horší než mlčet.
  */
  const hashtagu = spocitatHashtagy(text)
  if (pravidla.stropHashtagu > 0 && hashtagu > pravidla.stropHashtagu) {
    nalezy.push({
      druh: 'varovani',
      text: `Hashtagů je ${hashtagu}, ${pravidla.nazev} jich bere ${pravidla.stropHashtagu}. `
        + 'Zbytek se zahodí.',
    })
  }

  /*
    A když účet tenhle formát nemá povolený, řekne se to rovnou —
    i s tím, že jde stáhnout hotový soubor a zveřejnit ručně. Zadání,
    oddíl 16: „nabídni stažení hotového souboru a jasně označený ruční
    postup, nikoliv falešnou automatizaci".
  */
  const schopnosti = vstup.schopnostiUctu ?? []
  if (schopnosti.length > 0 && spec.publishCapability
      && !schopnosti.includes(spec.publishCapability)) {
    nalezy.push({
      druh: 'nelze',
      text: `Připojený účet nemá povolené „${spec.label}". Připravené to je — `
        + 'stáhněte si to a zveřejněte ručně, nebo rozšiřte oprávnění v Marketing → Nástroje.',
    })
  }

  return nalezy
}

/**
 * Kolik je v textu hashtagů.
 *
 * POČÍTÁ SE `#` NA ZAČÁTKU SLOVA, ne každý výskyt. V „menu #1" není
 * hashtag a v e-mailové adrese nebo v kotvě odkazu taky ne. Kdyby se
 * počítal každý křížek, varovalo by to u textů, kde žádný hashtag
 * není — a varování, které se plete, si člověk odvykne číst.
 *
 * Diakritika se bere: `#dobrejídlo` je jeden hashtag, ne dva.
 */
export function spocitatHashtagy(text: string): number {
  return (text.match(/(^|[\s(])#[\p{L}\p{N}_]+/gu) ?? []).length
}

/** Blokující nálezy — to, co se opravdu nedá poslat. */
export function coNejde(nalezy: Nalez[]): Nalez[] {
  return nalezy.filter((n) => n.druh === 'nelze')
}
