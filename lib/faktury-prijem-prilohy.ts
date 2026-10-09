/**
 * Hledání příloh ve struktuře e-mailu (imapflow `bodyStructure`) —
 * čistá logika bez IO a bez `server-only` (testuje se v CI).
 *
 * KONTRAKT — implementace musí dodržet podpisy níže beze změny.
 */

import { MAX_VELIKOST_PRILOHY } from './faktury-prijem-typy.ts'
import type { DruhPrilohy, KandidatPrilohy, UzelStruktury } from './faktury-prijem-typy.ts'

type Pripona = 'pdf' | 'jpg' | 'png' | 'webp' | 'xml'

const MIN_OBRAZEK = 15 * 1024
const MIN_VLOZENY_OBRAZEK = 60 * 1024
// Ochrana zásobníku před uměle zanořenou zprávou; skutečné přeposílání jde
// nanejvýš o pár úrovní.
const MAX_HLOUBKA = 32
const MAX_DELKA_NAZVU = 255

const MIME_PDF = new Set(['application/pdf', 'application/x-pdf'])
const MIME_XML = new Set(['application/xml', 'text/xml'])
const MIME_OBRAZEK = new Map<string, Pripona>([
  ['image/jpeg', 'jpg'], ['image/jpg', 'jpg'], ['image/pjpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
])
const PRIPONA_OBRAZKU = new Map<string, Pripona>([['jpg', 'jpg'], ['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp']])
const MIME_NEPODPOROVANE = new Set(['image/heic', 'image/heif', 'image/tiff'])
const PRIPONY_NEPODPOROVANE = new Set(['heic', 'heif', 'tif', 'tiff'])

const OBECNY_MIME = 'application/octet-stream'

function jeRidiciNeboSmerovy(kod: number): boolean {
  return kod < 0x20 || (kod >= 0x7f && kod <= 0x9f) ||
    kod === 0x200e || kod === 0x200f || (kod >= 0x202a && kod <= 0x202e) ||
    (kod >= 0x2066 && kod <= 0x2069) || kod === 0xfeff
}

/** Bez řídicích a směrových znaků (U+202E by v seznamu otočil příponu), bez cesty, nejvýš 255 znaků. */
function vycistitNazev(surovy: string): string {
  let cisty = ''
  for (const znak of surovy) {
    const kod = znak.codePointAt(0) ?? 0
    if (znak.length === 1 && kod >= 0xd800 && kod <= 0xdfff) continue
    if (!jeRidiciNeboSmerovy(kod)) cisty += znak
  }
  cisty = cisty.slice(Math.max(cisty.lastIndexOf('/'), cisty.lastIndexOf('\\')) + 1).trim()
  if (cisty === '.' || cisty === '..') return ''

  const znaky = Array.from(cisty)
  if (znaky.length <= MAX_DELKA_NAZVU) return cisty
  // Přípona musí přežít zkrácení — podle ní se pozná PDF poslané jako octet-stream.
  const tecka = cisty.lastIndexOf('.')
  const pripona = tecka > 0 ? Array.from(cisty.slice(tecka)) : []
  if (pripona.length > 0 && pripona.length <= 10) {
    return znaky.slice(0, MAX_DELKA_NAZVU - pripona.length).join('') + pripona.join('')
  }
  return znaky.slice(0, MAX_DELKA_NAZVU).join('')
}

function priponaNazvu(nazev: string): string {
  const tecka = nazev.lastIndexOf('.')
  return tecka > 0 ? nazev.slice(tecka + 1).toLowerCase() : ''
}

function parametr(mapa: Record<string, string> | undefined, klic: string): string | null {
  const hodnota = mapa && typeof mapa === 'object' && Object.prototype.hasOwnProperty.call(mapa, klic) ? mapa[klic] : undefined
  return typeof hodnota === 'string' && hodnota.trim() !== '' ? hodnota : null
}

function platnaCast(part: unknown): string | null {
  return typeof part === 'string' && part.length <= 64 && /^[1-9][0-9]*(\.[1-9][0-9]*)*$/.test(part) ? part : null
}

function velikostSouboru(uzel: UzelStruktury): number {
  const hruba = typeof uzel.size === 'number' && Number.isFinite(uzel.size) && uzel.size > 0 ? Math.floor(uzel.size) : 0
  // imapflow hlásí velikost ZAKÓDOVANÉ části; base64 je o třetinu větší než
  // soubor. 3/4 je horní mez skutečné velikosti, takže limit nikdy nepodstřelí.
  const kodovani = (uzel as UzelStruktury & { encoding?: unknown }).encoding
  return typeof kodovani === 'string' && kodovani.toLowerCase() === 'base64' ? Math.floor((hruba * 3) / 4) : hruba
}

function megabajty(bajty: number): string {
  return (bajty / (1024 * 1024)).toFixed(1).replace('.', ',')
}

function rozpoznatDruh(mime: string, pripona: string): DruhPrilohy | null {
  if (pripona === 'isdocx') return 'nepodporovano'
  if (MIME_NEPODPOROVANE.has(mime) || (mime === OBECNY_MIME && PRIPONY_NEPODPOROVANE.has(pripona))) return 'nepodporovano'
  if (MIME_PDF.has(mime) || (mime === OBECNY_MIME && pripona === 'pdf')) return 'pdf'
  if (pripona === 'isdoc') return 'isdoc'
  if ((MIME_XML.has(mime) || mime === OBECNY_MIME) && pripona === 'xml') return 'isdoc'
  if (MIME_OBRAZEK.has(mime) || (mime === OBECNY_MIME && PRIPONA_OBRAZKU.has(pripona))) return 'obrazek'
  return null
}

/**
 * Projde strukturu zprávy rekurzivně (multipart/* i vložené
 * message/rfc822 — přeposlané e-maily) a vrátí kandidátní přílohy.
 *
 * - PDF (application/pdf, nebo octet-stream s příponou .pdf) → 'pdf'
 * - .isdoc, nebo XML (application/xml, text/xml, octet-stream) s příponou
 *   .isdoc/.xml → 'isdoc' (zda je to opravdu ISDOC, se pozná až z obsahu)
 * - image/jpeg, image/png, image/webp → 'obrazek'; vynechá loga a podpisy:
 *   cokoli menšího než 15 kB, a vložené (disposition inline / bez názvu)
 *   menší než 60 kB
 * - .isdocx, image/heic, image/heif, image/tiff → 'nepodporovano' s
 *   důvodem v `duvodBezStazeni`
 * - vše ostatní (text/html tělo, zip, office…) se nevrací vůbec
 * - větší než MAX_VELIKOST_PRILOHY → vrátí se, ale s `duvodBezStazeni`
 * Název: dispositionParameters.filename || parameters.name || `priloha-<part>`;
 * odstraní řídicí znaky a cesty, zkrátí na 255 znaků.
 *
 * `velikost` je velikost souboru po dekódování (u base64 odhad shora).
 */
export function najitPrilohy(struktura: UzelStruktury | undefined | null): KandidatPrilohy[] {
  const nalezene: KandidatPrilohy[] = []
  if (!struktura || typeof struktura !== 'object') return nalezene

  const projit = (uzel: UzelStruktury, nahradniCast: string, hloubka: number) => {
    if (!uzel || typeof uzel !== 'object' || hloubka > MAX_HLOUBKA) return
    const cast = platnaCast(uzel.part) ?? nahradniCast
    if (Array.isArray(uzel.childNodes) && uzel.childNodes.length > 0) {
      const predpona = platnaCast(uzel.part) ?? (hloubka === 0 ? '' : nahradniCast)
      uzel.childNodes.forEach((dite, i) => projit(dite, predpona ? `${predpona}.${i + 1}` : String(i + 1), hloubka + 1))
      return
    }

    const mime = (typeof uzel.type === 'string' ? uzel.type : '').trim().toLowerCase().slice(0, 127)
    const puvodniNazev = parametr(uzel.dispositionParameters, 'filename') ?? parametr(uzel.parameters, 'name')
    const nazev = (puvodniNazev && vycistitNazev(puvodniNazev)) || `priloha-${cast}`
    const druh = rozpoznatDruh(mime, priponaNazvu(nazev))
    if (!druh) return

    const velikost = velikostSouboru(uzel)
    if (druh === 'obrazek') {
      const vlozeny = String(uzel.disposition ?? '').toLowerCase() === 'inline' || !puvodniNazev
      if (velikost < MIN_OBRAZEK || (vlozeny && velikost < MIN_VLOZENY_OBRAZEK)) return
    }

    let duvodBezStazeni: string | null = null
    if (druh === 'nepodporovano') {
      duvodBezStazeni = priponaNazvu(nazev) === 'isdocx'
        ? 'Formát ISDOCX (zabalené ISDOC) appka zatím neumí přečíst — zkontrolujte přílohu ručně.'
        : `Formát přílohy (${mime || 'neznámý'}) appka neumí přečíst — zkontrolujte přílohu ručně.`
    } else if (velikost > MAX_VELIKOST_PRILOHY) {
      duvodBezStazeni = `Příloha má ${megabajty(velikost)} MB, appka stahuje nejvýš ${megabajty(MAX_VELIKOST_PRILOHY)} MB — zkontrolujte ji ručně.`
    }

    nalezene.push({ cast, nazev, mime: mime || OBECNY_MIME, velikost, druh, duvodBezStazeni })
  }

  projit(struktura, '1', 0)
  return nalezene
}

/** Přípona pro uložení v kbelíku faktury-prilohy: 'pdf' | 'jpg' | 'png' | 'webp' | 'xml'. */
export function priponaProUlozeni(k: Pick<KandidatPrilohy, 'druh' | 'mime' | 'nazev'>): 'pdf' | 'jpg' | 'png' | 'webp' | 'xml' {
  switch (k.druh) {
    case 'pdf':
      return 'pdf'
    case 'isdoc':
      return 'xml'
    case 'obrazek':
      return MIME_OBRAZEK.get((k.mime ?? '').toLowerCase()) ?? PRIPONA_OBRAZKU.get(priponaNazvu(k.nazev ?? '')) ?? 'jpg'
    default:
      // Nepodporovaný formát se nestahuje; uložit ho pod cizí příponou by
      // obešlo allowed_mime_types kbelíku.
      throw new Error(`Příloha druhu „${String(k.druh)}" se do úložiště neukládá.`)
  }
}

/** MIME pro nahrání do kbelíku podle přípony (musí sedět s allowed_mime_types kbelíku). */
export function mimeProUlozeni(pripona: 'pdf' | 'jpg' | 'png' | 'webp' | 'xml'): string {
  switch (pripona) {
    case 'pdf': return 'application/pdf'
    case 'jpg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'xml': return 'application/xml'
    default: throw new Error(`Neznámá přípona „${String(pripona)}".`)
  }
}

const VZOR_CESTY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(pdf|jpg|png|webp|xml)$/

/** `<tenantId>/<sha256>.<pripona>` — musí projít regexem v app.faktury_priloha_firma. */
export function cestaSouboru(tenantId: string, hash: string, pripona: 'pdf' | 'jpg' | 'png' | 'webp' | 'xml'): string {
  const cesta = `${String(tenantId).trim().toLowerCase()}/${String(hash).trim().toLowerCase()}.${pripona}`
  // Cesta, kterou databáze nerozpozná, by soubor nechala bez firmy (nikdo ho
  // nepřečte) — a z cizího vstupu by mohla mířit jinam.
  if (!VZOR_CESTY.test(cesta)) throw new Error('Neplatná cesta přílohy (firma, otisk nebo přípona).')
  return cesta
}

/** Rozpozná ISDOC podle obsahu (kořen `Invoice` v namespace http://isdoc.cz/namespace/…). */
export function jeIsdocXml(text: string): boolean {
  if (typeof text !== 'string') return false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = text.length

  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++
    if (i >= n || text[i] !== '<') return false

    if (text.startsWith('<?', i)) {
      const konec = text.indexOf('?>', i + 2)
      if (konec < 0) return false
      i = konec + 2
    } else if (text.startsWith('<!--', i)) {
      const konec = text.indexOf('-->', i + 4)
      if (konec < 0) return false
      i = konec + 3
    } else if (text.startsWith('<!', i)) {
      // DOCTYPE jen přeskočí (vč. vnitřní podmnožiny) — odmítne ho až
      // precistIsdoc, ať soubor skončí s viditelným důvodem, ne jako „není doklad".
      let hloubka = 0
      let uvozovka = ''
      i += 2
      for (; i < n; i++) {
        const z = text[i]
        if (uvozovka) { if (z === uvozovka) uvozovka = ''; continue }
        if (z === '"' || z === "'") uvozovka = z
        else if (z === '[') hloubka++
        else if (z === ']') hloubka--
        else if (z === '>' && hloubka <= 0) break
      }
      if (i >= n) return false
      i++
    } else {
      return korenJeIsdoc(text, i)
    }
  }
  return false
}

function korenJeIsdoc(text: string, zacatek: number): boolean {
  const jmeno = /<([^\s/>=<"']+)/y
  jmeno.lastIndex = zacatek
  const m = jmeno.exec(text)
  if (!m) return false
  const [predpona, mistni] = m[1].includes(':') ? m[1].split(':', 2) : ['', m[1]]
  if (mistni !== 'Invoice') return false

  const atribut = /\s+([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y
  atribut.lastIndex = jmeno.lastIndex
  const hledany = predpona ? `xmlns:${predpona}` : 'xmlns'
  let a: RegExpExecArray | null
  while ((a = atribut.exec(text))) {
    if (a[1] === hledany) return (a[3] ?? a[4] ?? '').trim().startsWith('http://isdoc.cz/namespace/')
  }
  return false
}

/** Základ názvu pro spárování ISDOC ↔ PDF v jedné zprávě: bez přípony, malými písmeny, bez mezer. */
export function zakladNazvu(nazev: string): string {
  const s = String(nazev ?? '').normalize('NFC')
  const bezCesty = s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1).trim()
  const tecka = bezCesty.lastIndexOf('.')
  return (tecka > 0 ? bezCesty.slice(0, tecka) : bezCesty).toLowerCase().replace(/\s+/g, '')
}

export type { DruhPrilohy }
