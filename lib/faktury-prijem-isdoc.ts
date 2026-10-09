/**
 * ISDOC (česká strukturovaná e-faktura) → VytezenyDoklad, bez AI.
 * Čistá logika bez IO a bez `server-only` (testuje se v CI).
 *
 * KONTRAKT — implementace musí dodržet podpis níže beze změny.
 */

import type { TypDokladu, VytezenyDoklad } from './faktury-prijem-typy.ts'

const MAX_DELKA = 5 * 1024 * 1024
const MAX_HLOUBKA = 64
const NAMESPACE_ISDOC = 'http://isdoc.cz/namespace/'

class ChybaIsdoc extends Error {}

type Prvek = {
  jmeno: string
  predpona: string
  kvalifikovane: string
  atributy: Map<string, string>
  deti: Prvek[]
  text: string[]
}

const ZAKLADNI_ENTITY = new Map([['lt', '<'], ['gt', '>'], ['amp', '&'], ['quot', '"'], ['apos', "'"]])

function povolenyZnak(kod: number): boolean {
  return kod === 0x9 || kod === 0xa || kod === 0xd ||
    (kod >= 0x20 && kod <= 0xd7ff) || (kod >= 0xe000 && kod <= 0xfffd) || (kod >= 0x10000 && kod <= 0x10ffff)
}

/** Jen pět základních entit a číselné odkazy — nic, co by šlo rozvinout. */
function dekodovat(s: string): string {
  if (!s.includes('&')) return s
  let vysledek = ''
  let i = 0
  for (;;) {
    const amp = s.indexOf('&', i)
    if (amp < 0) return vysledek + s.slice(i)
    vysledek += s.slice(i, amp)
    const strednik = s.indexOf(';', amp + 1)
    if (strednik < 0 || strednik - amp > 12) throw new ChybaIsdoc('znak „&" bez platné entity')
    const nazev = s.slice(amp + 1, strednik)
    if (nazev.startsWith('#')) {
      const kod = /^#x[0-9a-fA-F]{1,6}$/.test(nazev)
        ? parseInt(nazev.slice(2), 16)
        : /^#[0-9]{1,7}$/.test(nazev) ? parseInt(nazev.slice(1), 10) : NaN
      if (!povolenyZnak(kod)) throw new ChybaIsdoc(`neplatný číselný znak &${nazev};`)
      vysledek += String.fromCodePoint(kod)
    } else {
      const znak = ZAKLADNI_ENTITY.get(nazev)
      if (znak === undefined) throw new ChybaIsdoc(`neznámá entita &${nazev};`)
      vysledek += znak
    }
    i = strednik + 1
  }
}

function jeMezera(z: string | undefined): boolean {
  return z === ' ' || z === '\t' || z === '\n' || z === '\r'
}

function rozebrat(xml: string): Prvek {
  const n = xml.length
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  const zasobnik: Prvek[] = []
  let koren: Prvek | null = null
  const reJmeno = /[^\s/>=<"'&]+/y
  const reAtribut = /([^\s/>=<"'&]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y

  while (i < n) {
    const lt = xml.indexOf('<', i)
    const konecTextu = lt < 0 ? n : lt
    if (konecTextu > i) {
      const text = xml.slice(i, konecTextu)
      if (zasobnik.length > 0) zasobnik[zasobnik.length - 1].text.push(dekodovat(text))
      else if (text.trim() !== '') throw new ChybaIsdoc('text mimo kořenový prvek')
      i = konecTextu
      if (lt < 0) break
    }

    if (xml.startsWith('<!--', i)) {
      const konec = xml.indexOf('-->', i + 4)
      if (konec < 0) throw new ChybaIsdoc('neukončený komentář')
      i = konec + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', i)) {
      if (zasobnik.length === 0) throw new ChybaIsdoc('CDATA mimo kořenový prvek')
      const konec = xml.indexOf(']]>', i + 9)
      if (konec < 0) throw new ChybaIsdoc('neukončená sekce CDATA')
      zasobnik[zasobnik.length - 1].text.push(xml.slice(i + 9, konec))
      i = konec + 3
      continue
    }
    if (xml.startsWith('<!', i)) throw new ChybaIsdoc('deklarace „<!…" nejsou povolené')
    if (xml.startsWith('<?', i)) {
      const konec = xml.indexOf('?>', i + 2)
      if (konec < 0) throw new ChybaIsdoc('neukončená instrukce <?…?>')
      i = konec + 2
      continue
    }

    if (xml.startsWith('</', i)) {
      reJmeno.lastIndex = i + 2
      const m = reJmeno.exec(xml)
      if (!m) throw new ChybaIsdoc('poškozená koncová značka')
      let j = reJmeno.lastIndex
      while (jeMezera(xml[j])) j++
      if (xml[j] !== '>') throw new ChybaIsdoc(`poškozená koncová značka </${m[0]}`)
      const otevreny = zasobnik.pop()
      if (!otevreny || otevreny.kvalifikovane !== m[0]) throw new ChybaIsdoc(`nečekaná koncová značka </${m[0]}>`)
      i = j + 1
      continue
    }

    reJmeno.lastIndex = i + 1
    const m = reJmeno.exec(xml)
    if (!m) throw new ChybaIsdoc('poškozená značka')
    let j = reJmeno.lastIndex
    const atributy = new Map<string, string>()
    let prazdny = false
    for (;;) {
      const predMezerou = j
      while (jeMezera(xml[j])) j++
      if (xml[j] === '>') { j++; break }
      if (xml.startsWith('/>', j)) { j += 2; prazdny = true; break }
      if (j === predMezerou || j >= n) throw new ChybaIsdoc(`poškozená značka <${m[0]}>`)
      reAtribut.lastIndex = j
      const a = reAtribut.exec(xml)
      if (!a) throw new ChybaIsdoc(`poškozený atribut ve značce <${m[0]}>`)
      atributy.set(a[1], dekodovat(a[2] ?? a[3] ?? ''))
      j = reAtribut.lastIndex
    }

    if (koren && zasobnik.length === 0) throw new ChybaIsdoc('víc než jeden kořenový prvek')
    if (zasobnik.length + 1 > MAX_HLOUBKA) throw new ChybaIsdoc(`vnoření hlubší než ${MAX_HLOUBKA} úrovní`)
    const dvojtecka = m[0].indexOf(':')
    const prvek: Prvek = {
      jmeno: dvojtecka >= 0 ? m[0].slice(dvojtecka + 1) : m[0],
      predpona: dvojtecka >= 0 ? m[0].slice(0, dvojtecka) : '',
      kvalifikovane: m[0],
      atributy,
      deti: [],
      text: [],
    }
    if (zasobnik.length > 0) zasobnik[zasobnik.length - 1].deti.push(prvek)
    else koren = prvek
    if (!prazdny) zasobnik.push(prvek)
    i = j
  }

  if (zasobnik.length > 0) throw new ChybaIsdoc(`neuzavřený prvek <${zasobnik[zasobnik.length - 1].kvalifikovane}>`)
  if (!koren) throw new ChybaIsdoc('soubor neobsahuje žádný prvek')
  return koren
}

function najit(prvek: Prvek | null, ...cesta: string[]): Prvek | null {
  let p = prvek
  for (const krok of cesta) {
    if (!p) return null
    p = p.deti.find((d) => d.jmeno === krok) ?? null
  }
  return p
}

function text(prvek: Prvek | null): string | null {
  if (!prvek) return null
  const t = prvek.text.join('').replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

const TYPY_DOKLADU = new Map<string, TypDokladu>([
  ['1', 'faktura'], ['2', 'dobropis'], ['3', 'faktura'], ['4', 'zalohova_faktura'],
  ['5', 'faktura'], ['6', 'faktura'], ['7', 'faktura'],
])

function zkratit(s: string, max: number): string {
  const znaky = Array.from(s)
  return znaky.length <= max ? s : znaky.slice(0, max - 1).join('') + '…'
}

/**
 * Bezpečně přečte ISDOC XML (verze 5.x/6.x, namespace http://isdoc.cz/namespace/2013).
 *
 * Bezpečnost: vlastní malý parser — ŽÁDNÉ DTD, žádné entity kromě pěti
 * základních (&lt; &gt; &amp; &quot; &apos;) a číselných (&#…;); dokument
 * s <!DOCTYPE nebo <!ENTITY se odmítne (XXE / „billion laughs"). Strop
 * vstupu 5 MB a hloubky vnoření 64.
 *
 * Mapování (cesty pod kořenem Invoice):
 *   DocumentType: 1 faktura, 2 dobropis, 3 vrubopis→faktura, 4 zálohová faktura,
 *     5 a 6 daňový doklad k záloze→faktura (s důvodem ke kontrole), 7 zjednodušený→faktura
 *   ID → cisloDokladu; IssueDate → datumVystaveni; TaxPointDate → duzp
 *   AccountingSupplierParty/Party/PartyIdentification/ID → dodavatelIco;
 *     …/Party/PartyName/Name → dodavatelNazev
 *   AccountingCustomerParty/Party/PartyIdentification/ID → odberatelIco; …/PartyName/Name → odberatelNazev
 *   LegalMonetaryTotal/PayableAmount (jinak TaxInclusiveAmount) → castkaCelkem
 *   LocalCurrencyCode → mena; je-li ForeignCurrencyCode, částky v cizí měně
 *     (…Curr) nebrat a doklad označit vyzadujeKontrolu s důvodem
 *   PaymentMeans/Payment/Details: PaymentDueDate → datumSplatnosti,
 *     VariableSymbol → variabilniSymbol, ID + BankCode → ucetDodavatele
 *     ve tvaru „cislo/kod" (IBAN, je-li jen ten)
 * Chybějící hodnota = null, nikdy 0 ani ''. jistotaTypu 'vysoka'.
 * ukazkaTextu: krátké shrnutí (dodavatel, číslo, částka) do 300 znaků.
 */
export function precistIsdoc(xml: string): { stav: 'ok'; doklad: VytezenyDoklad } | { stav: 'chyba'; duvod: string } {
  if (typeof xml !== 'string' || xml.trim() === '') return { stav: 'chyba', duvod: 'Soubor ISDOC je prázdný.' }
  if (xml.length > MAX_DELKA) return { stav: 'chyba', duvod: 'Soubor ISDOC je větší než 5 MB — appka ho nečte.' }
  // Odmítnout dřív, než parser cokoli rozvine; DTD v e-faktuře nemá co dělat.
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return { stav: 'chyba', duvod: 'Soubor ISDOC obsahuje DOCTYPE/ENTITY — z bezpečnostních důvodů se nečte.' }
  }

  let koren: Prvek
  try {
    koren = rozebrat(xml)
  } catch (e) {
    const proc = e instanceof ChybaIsdoc ? e.message : 'neočekávaná chyba při čtení'
    return { stav: 'chyba', duvod: `Soubor ISDOC se nepodařilo přečíst: ${proc}.` }
  }

  const namespace = koren.atributy.get(koren.predpona ? `xmlns:${koren.predpona}` : 'xmlns') ?? ''
  if (koren.jmeno !== 'Invoice' || !namespace.trim().startsWith(NAMESPACE_ISDOC)) {
    return { stav: 'chyba', duvod: 'Soubor XML není faktura ve formátu ISDOC.' }
  }

  const duvody: string[] = []

  const kodTypu = text(najit(koren, 'DocumentType'))
  let typ = kodTypu ? TYPY_DOKLADU.get(kodTypu) : undefined
  if (!typ) {
    typ = 'faktura'
    duvody.push(`Neznámý typ dokladu ISDOC (${kodTypu ? zkratit(kodTypu, 20) : 'chybí'}) — zkontrolujte, o jaký doklad jde`)
  } else if (kodTypu === '5' || kodTypu === '6') {
    duvody.push('Daňový doklad k přijaté záloze — zkontrolujte odečet zálohy')
  }

  const dodavatel = najit(koren, 'AccountingSupplierParty', 'Party')
  const odberatel = najit(koren, 'AccountingCustomerParty', 'Party')

  const soucty = najit(koren, 'LegalMonetaryTotal')
  const surovaCastka = text(najit(soucty, 'PayableAmount')) ?? text(najit(soucty, 'TaxInclusiveAmount'))
  let castkaCelkem: number | null = null
  if (surovaCastka !== null) {
    if (/^[+-]?\d+(\.\d+)?$/.test(surovaCastka)) castkaCelkem = Number(surovaCastka)
    else duvody.push(`Částku „${zkratit(surovaCastka, 30)}" se nepodařilo přečíst`)
  }

  const mena = text(najit(koren, 'LocalCurrencyCode'))?.toUpperCase() ?? null
  const ciziMena = text(najit(koren, 'ForeignCurrencyCode'))
  if (ciziMena) {
    duvody.push(`Faktura je i v cizí měně (${zkratit(ciziMena, 10)}) — částky v cizí měně appka nepřebírá, zkontrolujte je`)
  }

  const platby = najit(koren, 'PaymentMeans')?.deti.filter((d) => d.jmeno === 'Payment') ?? []
  const detaily = platby.map((p) => najit(p, 'Details')).find((d) => d !== null) ?? null
  const cisloUctu = text(najit(detaily, 'ID'))
  const kodBanky = text(najit(detaily, 'BankCode'))
  const iban = text(najit(detaily, 'IBAN'))?.replace(/\s+/g, '') ?? null
  const ucetDodavatele = cisloUctu && kodBanky ? `${cisloUctu}/${kodBanky}` : iban ?? cisloUctu

  const dodavatelNazev = text(najit(dodavatel, 'PartyName', 'Name'))
  const cisloDokladu = text(najit(koren, 'ID'))
  const ukazka = `ISDOC: ${dodavatelNazev ?? 'neznámý dodavatel'}, doklad ${cisloDokladu ?? '?'}, ` +
    `k úhradě ${castkaCelkem ?? '?'}${mena ? ` ${mena}` : ''}`

  return {
    stav: 'ok',
    doklad: {
      typ,
      jistotaTypu: 'vysoka',
      dodavatelNazev,
      dodavatelIco: text(najit(dodavatel, 'PartyIdentification', 'ID')),
      odberatelNazev: text(najit(odberatel, 'PartyName', 'Name')),
      odberatelIco: text(najit(odberatel, 'PartyIdentification', 'ID')),
      cisloDokladu,
      variabilniSymbol: text(najit(detaily, 'VariableSymbol')),
      castkaCelkem,
      mena,
      datumVystaveni: text(najit(koren, 'IssueDate')),
      duzp: text(najit(koren, 'TaxPointDate')),
      datumSplatnosti: text(najit(detaily, 'PaymentDueDate')),
      ucetDodavatele,
      vyzadujeKontrolu: duvody.length > 0,
      duvodyKontroly: duvody,
      ukazkaTextu: zkratit(ukazka, 300),
    },
  }
}
