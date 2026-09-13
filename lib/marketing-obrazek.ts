import { createHash } from 'node:crypto'

/**
 * Čtení nahraného obrázku: co to doopravdy je, jak je to velké
 * a otisk obsahu.
 *
 * ---------------------------------------------------------------------
 * TYP SE POZNÁVÁ Z OBSAHU, NE Z TOHO, CO KDO TVRDÍ
 *
 * Přípona souboru i hlavička `Content-Type` jsou údaje od toho, kdo
 * soubor posílá. Přejmenovat cokoli na `.jpg` umí každý; poslat
 * `image/jpeg` u čehokoli umí i obyčejný skript.
 *
 * Kbelík má sice bílou listinu typů, ale ta věří TÉŽE hlavičce. Kdyby
 * se typ nekontroloval tady, uložilo by se do knihovny fotek cokoli —
 * a Instagram by to pak odmítl až po schválení a naplánování, kdy už
 * se s tím nedá nic dělat.
 *
 * ---------------------------------------------------------------------
 * PROČ ROZMĚRY BEZ KNIHOVNY
 *
 * Šířka a výška se čtou z hlavičky souboru, tedy z prvních desítek
 * bajtů. Kvůli tomu se nevyplatí přidávat závislost, která umí
 * překódovat cokoli na cokoli — čím míň cizího kódu sahá na soubory
 * od návštěvníků, tím líp.
 *
 * Rozměry potřebujeme proto, že Instagram má na poměr stran svoje
 * meze. Když je fotka nesplňuje, má se to říct při nahrání, ne až
 * když se příspěvek nezveřejní.
 */

/** Co modul umí přečíst. Musí se krýt s bílou listinou kbelíku. */
export const POVOLENE_TYPY = ['image/jpeg', 'image/png', 'image/webp'] as const

export type TypObrazku = (typeof POVOLENE_TYPY)[number]

/**
 * Strop na velikost. Táž hodnota je v migraci u kbelíku
 * (20260913120000_marketing_ulozne.sql) — Storage ji vynutí i tehdy,
 * když se soubor pošle mimo naši obrazovku.
 */
export const STROP_BAJTU = 26214400

export type Obrazek = {
  typ: TypObrazku
  pripona: string
  sirka: number
  vyska: number
  bajtu: number
  otisk: string
}

export type Vysledek =
  | { stav: 'ok'; obrazek: Obrazek }
  | { stav: 'chyba'; duvod: string }

/**
 * Přečte obrázek z bajtů, které přišly z formuláře.
 *
 * Vrací důvod v češtině, ne kód chyby — jde rovnou na obrazovku
 * člověku, který zrovna vybral fotku.
 */
export function precistObrazek(data: Uint8Array): Vysledek {
  if (data.length === 0) {
    return { stav: 'chyba', duvod: 'Soubor je prázdný.' }
  }

  if (data.length > STROP_BAJTU) {
    return {
      stav: 'chyba',
      duvod: `Fotka je větší než ${Math.round(STROP_BAJTU / 1024 / 1024)} MB. Zmenšete ji a zkuste to znovu.`,
    }
  }

  const typ = poznatTyp(data)
  if (!typ) {
    return {
      stav: 'chyba',
      duvod: 'Tohle není fotka ve formátu JPEG, PNG ani WebP. Přípona souboru na tom nic nemění — rozhoduje obsah.',
    }
  }

  const rozmery = precistRozmery(data, typ)
  if (!rozmery) {
    return {
      stav: 'chyba',
      duvod: 'Soubor se tváří jako fotka, ale nejde z něj přečíst velikost. Nejspíš je poškozený.',
    }
  }

  return {
    stav: 'ok',
    obrazek: {
      typ,
      pripona: PRIPONY[typ],
      sirka: rozmery.sirka,
      vyska: rozmery.vyska,
      bajtu: data.length,
      otisk: otiskObsahu(data),
    },
  }
}

const PRIPONY: Record<TypObrazku, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Typ podle úvodních bajtů („magic number").
 *
 * Tyhle značky jsou součástí formátu, ne domluvy — soubor bez nich by
 * neotevřel ani prohlížeč.
 */
export function poznatTyp(d: Uint8Array): TypObrazku | null {
  // JPEG: FF D8 FF
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return 'image/jpeg'

  // PNG: 89 P N G \r \n 1A \n
  if (
    d.length > 8 &&
    d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47 &&
    d[4] === 0x0d && d[5] === 0x0a && d[6] === 0x1a && d[7] === 0x0a
  ) {
    return 'image/png'
  }

  // WebP: 'RIFF' …4 bajty délky… 'WEBP'
  if (
    d.length > 12 &&
    d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 &&
    d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

function precistRozmery(d: Uint8Array, typ: TypObrazku): { sirka: number; vyska: number } | null {
  if (typ === 'image/png') return rozmeryPng(d)
  if (typ === 'image/jpeg') return rozmeryJpeg(d)
  return rozmeryWebp(d)
}

/** PNG: hlavička IHDR je vždycky hned za značkou, šířka a výška po 4 bajtech. */
function rozmeryPng(d: Uint8Array): { sirka: number; vyska: number } | null {
  if (d.length < 24) return null
  const p = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const sirka = p.getUint32(16, false)
  const vyska = p.getUint32(20, false)
  return sirka > 0 && vyska > 0 ? { sirka, vyska } : null
}

/**
 * JPEG: rozměry jsou až v úseku SOF, ke kterému se musí prokousat
 * přes úseky s náhledem, barevným profilem a metadaty. Fotka z telefonu
 * jich má klidně deset.
 */
function rozmeryJpeg(d: Uint8Array): { sirka: number; vyska: number } | null {
  const p = new DataView(d.buffer, d.byteOffset, d.byteLength)
  let i = 2

  while (i + 9 < d.length) {
    if (d[i] !== 0xff) {
      i++
      continue
    }

    const znacka = d[i + 1]

    // Výplňové bajty a úseky bez těla se přeskakují jednotlivě.
    if (znacka === 0xff || znacka === 0x01 || (znacka >= 0xd0 && znacka <= 0xd9)) {
      i += 2
      continue
    }

    const delka = p.getUint16(i + 2, false)
    if (delka < 2) return null

    /*
      SOF0…SOF15 nesou rozměry. Vynechané jsou DHT (C4), JPG (C8)
      a DAC (CC) — ty do té řady spadají číslem, ale rozměry v nich
      nejsou a čtení by z nich vytáhlo nesmysl.
    */
    const jeSof =
      znacka >= 0xc0 && znacka <= 0xcf &&
      znacka !== 0xc4 && znacka !== 0xc8 && znacka !== 0xcc

    if (jeSof) {
      const vyska = p.getUint16(i + 5, false)
      const sirka = p.getUint16(i + 7, false)
      return sirka > 0 && vyska > 0 ? { sirka, vyska } : null
    }

    i += 2 + delka
  }

  return null
}

/**
 * WebP má tři podoby a každá ukládá rozměry jinam. Prostý (VP8),
 * bezeztrátový (VP8L) a rozšířený (VP8X, ten s průhledností nebo
 * animací).
 */
function rozmeryWebp(d: Uint8Array): { sirka: number; vyska: number } | null {
  if (d.length < 16) return null
  const p = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const druh = String.fromCharCode(d[12], d[13], d[14], d[15])

  /*
    Délka se hlídá u KAŽDÉ PODOBY ZVLÁŠŤ, ne jedním číslem na začátku.
    Měl jsem tu paušální „aspoň 30 bajtů" a odmítalo to malé
    bezeztrátové WebP, kterému stačí 25 — chytl to až test, který ten
    soubor doopravdy poskládal.
  */
  if (druh === 'VP8X') {
    if (d.length < 30) return null
    // Tři bajty na rozměr, od nuly — proto +1.
    const sirka = 1 + (d[24] | (d[25] << 8) | (d[26] << 16))
    const vyska = 1 + (d[27] | (d[28] << 8) | (d[29] << 16))
    return { sirka, vyska }
  }

  if (druh === 'VP8L') {
    if (d.length < 25) return null
    const b = p.getUint32(21, true)
    return { sirka: 1 + (b & 0x3fff), vyska: 1 + ((b >> 14) & 0x3fff) }
  }

  if (druh === 'VP8 ') {
    if (d.length < 30) return null
    // Dva bajty na rozměr, horní dva bity jsou měřítko a nepatří tam.
    return {
      sirka: p.getUint16(26, true) & 0x3fff,
      vyska: p.getUint16(28, true) & 0x3fff,
    }
  }

  return null
}

/**
 * Otisk obsahu.
 *
 * Podle něj se pozná, že se táž fotka nahrává podruhé — jinak
 * knihovna během měsíce zaroste kopiemi. Počítá se z BAJTŮ, ne
 * z názvu: `IMG_2831.jpg` a `svickova.jpg` můžou být totéž.
 */
export function otiskObsahu(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
