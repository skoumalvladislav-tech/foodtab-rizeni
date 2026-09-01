import qrcode from 'qrcode-generator'

/**
 * QR kód jako SVG.
 *
 * Používá se na dvou místech a pokaždé z jiného důvodu:
 *
 *  * KIOSEK ukazuje QR s adresou, ve které je měnící se kód pobočky.
 *    Zaměstnanec ho načte telefonem a rovnou píchne
 *    (docs/kiosek-pin-zalohy-zadani.md, uspořádání A). QR se překresluje
 *    s každým novým oknem, stejně jako kód.
 *
 *  * REGISTRACE TABLETU ukazuje QR jen s adresou `/kiosek`. Registrační
 *    kód do něj NEPATŘÍ (docs/ukoly-codea-drobnosti-2026-09-01.md,
 *    bod 3): je to jednorázový klíč k tomu, aby se ze zařízení stal
 *    důvěryhodný tablet pobočky, a QR se dá vyfotit přes rameno
 *    i z dálky. Osm znaků se jednou za život tabletu opíše.
 *
 * Vrací SVG jako řetězec, ne datovou adresu obrázku: SVG se v prohlížeči
 * škáluje bez rozmazání a nepotřebuje kreslit na plátno, takže funguje
 * i na serveru.
 */

/** Úroveň opravy chyb. `M` snese asi 15 % poškození a je běžná volba. */
type Oprava = 'L' | 'M' | 'Q' | 'H'

export function qrSvg(
  text: string,
  {
    velikost = 220,
    oprava = 'M',
    popis = 'QR kód',
  }: { velikost?: number; oprava?: Oprava; popis?: string } = {},
): string {
  // Typ 0 = ať si knihovna vybere nejmenší, do kterého se text vejde.
  const qr = qrcode(0, oprava)
  qr.addData(naUtf8(text), 'Byte')
  qr.make()

  const bunek = qr.getModuleCount()

  /*
    Tichá zóna. Norma žádá čtyři moduly kolem kódu — bez ní čtečka
    nepozná, kde kód začíná, a na tmavém pozadí ho nenajde vůbec.
  */
  const okraj = 4
  const celkem = bunek + okraj * 2

  const cesty: string[] = []
  for (let r = 0; r < bunek; r++) {
    for (let s = 0; s < bunek; s++) {
      if (qr.isDark(r, s)) {
        cesty.push(`M${s + okraj} ${r + okraj}h1v1h-1z`)
      }
    }
  }

  /*
    Barvy jsou napevno černá na bílé, ne z proměnných motivu. QR čtečka
    potřebuje kontrast a v tmavém režimu by z tokenů vyšel tmavý kód na
    tmavém pozadí — nečitelný. Bílý podklad je proto součástí obrázku.
  */
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${velikost}" height="${velikost}"`,
    ` viewBox="0 0 ${celkem} ${celkem}" role="img" aria-label="${escapovat(popis)}"`,
    ' shape-rendering="crispEdges">',
    `<rect width="${celkem}" height="${celkem}" fill="#ffffff"/>`,
    `<path d="${cesty.join('')}" fill="#000000"/>`,
    '</svg>',
  ].join('')
}

/**
 * Text na UTF-8, znak po znaku.
 *
 * Knihovna bere v režimu `Byte` z každého znaku spodních osm bitů —
 * tedy Latin-1. Diakritika z toho vyjde rozsypaná a načtený kód vede na
 * adresu, která neexistuje. Našlo se to hned první zkouškou:
 * „černá-perla“ se přečetlo jako prázdno.
 *
 * Řeší se to tím, že se text převede na UTF-8 bajty ještě tady a předá
 * se jako řetězec, kde každý znak JE jeden bajt. Knihovna pak nemá co
 * pokazit.
 *
 * Nastavovat `stringToBytesFuncs` nejde: přes ESM se ta vlastnost
 * z balíčku nedostane ven, jen `stringToBytes`. Tohle je na jejích
 * vnitřnostech nezávislé.
 *
 * Dnes jsou v adresách jen ASCII slugy, takže by si toho nikdo nevšiml
 * — a právě proto se to řeší teď, ne až se objeví první pobočka
 * s háčkem.
 */
function naUtf8(t: string): string {
  return Array.from(new TextEncoder().encode(t), (b) =>
    String.fromCharCode(b),
  ).join('')
}

function escapovat(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
