/**
 * Automatická kontrola vytěženého dokladu a rozhodnutí, co s ním —
 * čistá logika bez IO a bez `server-only` (testuje se v CI).
 *
 * Šéfík 8.10.2026: „potřebuji automatickou kontrolu a práci" — appka
 * kontroluje sama, člověku posílá jen skutečné výjimky.
 *
 * KONTRAKT — implementace musí dodržet podpisy níže beze změny.
 */

import { NEJSTARSI_DUZP } from './faktury-prijem-typy.ts'
import type { RadekFaktury, Rozhodnuti, TypDokladu, VytezenyDoklad } from './faktury-prijem-typy.ts'
import { PREDPONA_RUCNI_KONTROLY, STAV_KE_KONTROLE, STAV_KE_SCHVALENI } from './faktury-types.ts'

const STAV_UPOMINKA = 'Upomínka - zkontrolovat'
const STAV_NECITELNE = `${PREDPONA_RUCNI_KONTROLY} (nepodařilo se přečíst údaje – vyplňte je ručně)`

const MAX_CASTKA = 50_000_000
const DUVOD_CHYBI_CASTKA = 'Chybí částka k úhradě — doplňte ji ručně'
const DUVOD_CHYBI_DODAVATEL = 'Nepoznal jsem dodavatele'

const ZNAME_TYPY = new Set<string>([
  'faktura', 'zalohova_faktura', 'dobropis', 'dodaci_list', 'upominka', 'jiny_doklad', 'neni_doklad',
])
const POPIS_NEDOKLADU = new Map<string, string>([
  ['dodaci_list', 'dodací list'], ['jiny_doklad', 'jiný doklad'], ['neni_doklad', 'nejde o doklad'],
])

function jeRidici(kod: number): boolean {
  return kod < 0x20 || (kod >= 0x7f && kod <= 0x9f) ||
    kod === 0x200e || kod === 0x200f || (kod >= 0x202a && kod <= 0x202e) ||
    (kod >= 0x2066 && kod <= 0x2069) || kod === 0xfeff
}

function zkratit(s: string, max: number): string
function zkratit(s: string | null, max: number): string | null
function zkratit(s: string | null, max: number): string | null {
  if (s === null) return null
  const znaky = Array.from(s)
  return znaky.length <= max ? s : znaky.slice(0, max - 1).join('') + '…'
}

/** IČO: 8 číslic (doplní úvodní nuly u kratších), kontrolní součet mod 11. */
export function platneIco(ico: string | null | undefined): boolean {
  if (typeof ico !== 'string') return false
  const s = ico.trim()
  if (!/^\d{1,8}$/.test(s)) return false
  const c = s.padStart(8, '0')
  let soucet = 0
  for (let i = 0; i < 7; i++) soucet += Number(c[i]) * (8 - i)
  return (11 - (soucet % 11)) % 10 === Number(c[7])
}

/** Odstraní NUL a další řídicí znaky kromě \n a \t (n8n padal na 22P05), ořízne. */
export function bezRidicichZnaku(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let vysledek = ''
  for (const znak of text.replace(/\r\n?/g, '\n')) {
    const kod = znak.codePointAt(0) ?? 0
    // Osamocená polovina páru by v JSON pro Postgres neprošla stejně jako NUL.
    if (znak.length === 1 && kod >= 0xd800 && kod <= 0xdfff) continue
    if (kod === 0x09 || kod === 0x0a || !jeRidici(kod)) vysledek += znak
  }
  const oriznuty = vysledek.trim()
  return oriznuty === '' ? null : oriznuty
}

function txt(v: unknown): string | null {
  return typeof v === 'string' ? bezRidicichZnaku(v) : null
}

function jednoradkove(v: unknown, max: number): string | null {
  const t = txt(v)
  return t === null ? null : zkratit(t.replace(/\s+/g, ' '), max)
}

function normalizovatIco(v: unknown): string | null {
  const t = txt(v)
  if (t === null) return null
  const s = t.replace(/\s+/g, '').replace(/^CZ/i, '')
  return /^\d{1,8}$/.test(s) ? s.padStart(8, '0') : s
}

function platneDatum(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [r, mes, den] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (r < 2000 || r > 2100) return false
  const d = new Date(Date.UTC(r, mes - 1, den))
  return d.getUTCFullYear() === r && d.getUTCMonth() === mes - 1 && d.getUTCDate() === den
}

function dnyOd(od: string, do_: string): number {
  return (Date.parse(`${do_}T00:00:00Z`) - Date.parse(`${od}T00:00:00Z`)) / 86_400_000
}

function zaokrouhlit(x: number): number {
  // toPrecision srovná binární šum (1.005 * 100 = 100.49999…), jinak by se haléř ztratil.
  const kladne = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100
  return x < 0 ? -kladne : kladne
}

function platnyCeskyUcet(predcisli: string, cislo: string): boolean {
  const soucet = (cislice: string, vahy: number[]) =>
    cislice.padStart(vahy.length, '0').split('').reduce((s, c, i) => s + Number(c) * vahy[i], 0)
  if (/^0+$/.test(cislo)) return false
  return soucet(predcisli, [10, 5, 8, 4, 2, 1]) % 11 === 0 &&
    soucet(cislo, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]) % 11 === 0
}

function platnyIban(iban: string): boolean {
  const prestaveny = iban.slice(4) + iban.slice(0, 4)
  let zbytek = 0
  for (const z of prestaveny) {
    const hodnota = /[A-Z]/.test(z) ? String(z.charCodeAt(0) - 55) : z
    for (const c of hodnota) zbytek = (zbytek * 10 + Number(c)) % 97
  }
  return zbytek === 1
}

/**
 * Porovnatelný tvar účtu: tentýž český účet zapsaný jako IBAN, s nulami na
 * začátku nebo s mezerami dá stejný klíč (`[předčíslí-]číslo/banka` bez
 * úvodních nul). Cizí IBAN zůstane IBANem. Nesmysl → null.
 */
export function klicUctu(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, '').toUpperCase()
  const bezNul = (x: string) => x.replace(/^0+(?=\d)/, '')
  const sestavit = (predcisli: string, cislo: string, banka: string) => {
    const p = bezNul(predcisli)
    return `${p && p !== '0' ? `${p}-` : ''}${bezNul(cislo)}/${banka}`
  }
  const iban = /^CZ\d{2}(\d{4})(\d{6})(\d{10})$/.exec(s)
  if (iban) return sestavit(iban[2], iban[3], iban[1])
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s)) return s
  const domaci = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s)
  return domaci ? sestavit(domaci[1] ?? '', domaci[2], domaci[3]) : null
}

/** Účet s kontrolním součtem: přehozená číslice by poslala peníze jinam. */
function normalizovatUcet(v: string): string | null {
  const s = v.replace(/\s+/g, '').toUpperCase()
  if (/^CZ\d{22}$/.test(s)) return platnyIban(s) ? s : null
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s)
  if (!m) return null
  return platnyCeskyUcet(m[1] ?? '', m[2]) ? s : null
}

/**
 * Druhá linie po ISDOC/AI (vzor `opravitPodezrele` v marketing-menu-ai):
 * nevěří ničemu, co nesedí, a radši hodnotu vymaže + přidá důvod, než aby
 * pustila hádanou. Vrací NOVÝ objekt.
 *   - IČO dodavatele/odběratele: normalizace (bez mezer, CZ předpony),
 *     neplatný součet → null + důvod
 *   - odběratel: je-li jeho IČO známé a ≠ `icoFirmy` → důvod „Faktura je
 *     vystavená na jinou firmu (IČO …)"; chybí-li → důvod „Nepoznal jsem
 *     odběratele"
 *   - částka: konečné číslo, |x| ≤ 50 000 000, zaokrouhlit na 2 desetinná
 *     místa; 0 nebo nesmysl → null + důvod; záporná jen u dobropisu
 *   - měna: 3 velká písmena (ISO 4217), jinak null + důvod; chybí-li úplně a
 *     doklad je jinak český (IČO dodavatele platné) → 'CZK' bez důvodu
 *   - data YYYY-MM-DD, skutečný kalendářní den, roky 2000–2100, jinak null
 *     + důvod; splatnost před vystavením → důvod; vystavení víc než 2 dny
 *     po `dnes` → důvod
 *   - VS: jen číslice, nejvýš 10, jinak null + důvod
 *   - účet: tvar [předčíslí-]číslo/kód banky (4 číslice) nebo IBAN (CZ… 24
 *     znaků), jinak null + důvod
 *   - číslo dokladu: ořez, nejvýš 64 znaků
 *   - vyzadujeKontrolu = true, pokud přibyl jakýkoli důvod nebo jistotaTypu ≠ 'vysoka'
 *
 * Navíc: účet i IBAN musí mít platný kontrolní součet; „Kč" se čte jako CZK;
 * delší číslo dokladu → null + důvod (zkrácené by se párovalo s cizím).
 */
export function zkontrolovatVytezeni(doklad: VytezenyDoklad, kontext: { icoFirmy: string | null; dnes: string }): VytezenyDoklad {
  const duvody: string[] = []
  const pridat = (d: string) => { if (!duvody.includes(d)) duvody.push(d) }
  for (const d of Array.isArray(doklad.duvodyKontroly) ? doklad.duvodyKontroly : []) {
    const cisty = jednoradkove(d, 300)
    if (cisty) pridat(cisty)
  }

  const znamyTyp = ZNAME_TYPY.has(doklad.typ)
  const typ: TypDokladu = znamyTyp ? doklad.typ : 'faktura'
  let jistotaTypu: VytezenyDoklad['jistotaTypu'] =
    doklad.jistotaTypu === 'vysoka' || doklad.jistotaTypu === 'stredni' ? doklad.jistotaTypu : 'nizka'
  if (!znamyTyp) {
    jistotaTypu = 'nizka'
    pridat('Neznámý typ dokladu — zkontrolujte, o jaký doklad jde')
  }

  const ico = (v: unknown, koho: string): string | null => {
    const surove = txt(v)
    if (surove === null) return null
    const n = normalizovatIco(surove)
    if (n !== null && platneIco(n)) return n
    pridat(`IČO ${koho} „${zkratit(surove, 20)}" není platné`)
    return null
  }
  const dodavatelIco = ico(doklad.dodavatelIco, 'dodavatele')
  const odberatelIco = ico(doklad.odberatelIco, 'odběratele')
  const icoFirmyN = normalizovatIco(kontext.icoFirmy)
  const icoFirmy = icoFirmyN !== null && platneIco(icoFirmyN) ? icoFirmyN : null
  if (odberatelIco !== null) {
    if (icoFirmy !== null && odberatelIco !== icoFirmy) pridat(`Faktura je vystavená na jinou firmu (IČO ${odberatelIco})`)
  } else if (txt(doklad.odberatelIco) === null) {
    pridat('Nepoznal jsem odběratele')
  }

  let castkaCelkem: number | null = null
  const surovaCastka: unknown = doklad.castkaCelkem
  if (surovaCastka === null || surovaCastka === undefined) {
    pridat(DUVOD_CHYBI_CASTKA)
  } else if (typeof surovaCastka !== 'number' || !Number.isFinite(surovaCastka) || Math.abs(surovaCastka) > MAX_CASTKA) {
    pridat('Částka k úhradě není věrohodná — zkontrolujte ji')
  } else {
    const z = zaokrouhlit(surovaCastka)
    if (z === 0) pridat('Částka k úhradě vyšla nulová — zkontrolujte ji')
    else if (z < 0 && typ !== 'dobropis') pridat('Záporná částka u dokladu, který není dobropis')
    else castkaCelkem = z
  }

  let mena: string | null = null
  const surovaMena = txt(doklad.mena)
  if (surovaMena !== null) {
    const m = surovaMena.replace(/\s+/g, '').toUpperCase()
    if (m === 'KČ' || m === 'KC') mena = 'CZK'
    else if (/^[A-Z]{3}$/.test(m)) mena = m
    else pridat(`Měna „${zkratit(surovaMena, 10)}" není platný kód (např. CZK, EUR)`)
  } else if (dodavatelIco !== null) {
    mena = 'CZK'
  } else {
    pridat('Neznámá měna — zkontrolujte, jestli jde o koruny')
  }

  const datum = (v: unknown, popis: string): string | null => {
    const s = txt(v)
    if (s === null) return null
    if (platneDatum(s)) return s
    pridat(`${popis} „${zkratit(s, 20)}" není platné datum`)
    return null
  }
  const datumVystaveni = datum(doklad.datumVystaveni, 'Datum vystavení')
  const duzp = datum(doklad.duzp, 'DUZP')
  const datumSplatnosti = datum(doklad.datumSplatnosti, 'Datum splatnosti')
  if (datumVystaveni && datumSplatnosti && datumSplatnosti < datumVystaveni) pridat('Splatnost je dřív než datum vystavení')
  const dnes = typeof kontext.dnes === 'string' ? kontext.dnes.slice(0, 10) : ''
  if (datumVystaveni && platneDatum(dnes) && dnyOd(dnes, datumVystaveni) > 2) pridat('Datum vystavení je v budoucnosti')

  let variabilniSymbol: string | null = null
  const surovyVs = txt(doklad.variabilniSymbol)
  if (surovyVs !== null) {
    const vs = surovyVs.replace(/\s+/g, '')
    if (/^\d{1,10}$/.test(vs)) variabilniSymbol = vs
    else pridat(`Variabilní symbol „${zkratit(surovyVs, 20)}" není platný (jen číslice, nejvýš 10)`)
  }

  let ucetDodavatele: string | null = null
  const surovyUcet = txt(doklad.ucetDodavatele)
  if (surovyUcet !== null) {
    ucetDodavatele = normalizovatUcet(surovyUcet)
    if (ucetDodavatele === null) pridat(`Číslo účtu „${zkratit(surovyUcet, 40)}" není platné — ověřte ho, než zaplatíte`)
  }

  let cisloDokladu = jednoradkove(doklad.cisloDokladu, Number.MAX_SAFE_INTEGER)
  if (cisloDokladu !== null && Array.from(cisloDokladu).length > 64) {
    pridat('Číslo dokladu je delší než 64 znaků — zkontrolujte ho')
    cisloDokladu = null
  }

  return {
    typ,
    jistotaTypu,
    dodavatelNazev: jednoradkove(doklad.dodavatelNazev, 255),
    dodavatelIco,
    odberatelNazev: jednoradkove(doklad.odberatelNazev, 255),
    odberatelIco,
    cisloDokladu,
    variabilniSymbol,
    castkaCelkem,
    mena,
    datumVystaveni,
    duzp,
    datumSplatnosti,
    ucetDodavatele,
    vyzadujeKontrolu: doklad.vyzadujeKontrolu === true || duvody.length > 0 || jistotaTypu !== 'vysoka',
    duvodyKontroly: duvody,
    ukazkaTextu: txt(doklad.ukazkaTextu),
  }
}

/**
 * Co s dokladem — slovník stavů jako n8n (lib/faktury-types.ts):
 *   - typ 'neni_doklad' | 'dodaci_list' | 'jiny_doklad' → nezapisovat, stav 'neni_doklad'
 *   - typ 'upominka' → zapsat se stavem 'Upomínka - zkontrolovat'
 *   - faktura / zálohová / dobropis:
 *       chybí dodavatel I částka → 'Nutná ruční kontrola (nepodařilo se přečíst údaje – vyplňte je ručně)'
 *       jinak, pokud vyzadujeKontrolu, typ ≠ 'faktura', jistota ≠ 'vysoka'
 *         nebo DUZP < NEJSTARSI_DUZP → 'Ke schválení'
 *       jinak 'Ke kontrole úhrady'
 *   - review_note: důvody kontroly spojené „; " (+ „Zálohová faktura —
 *     není daňový doklad" / „Dobropis — zkontrolujte znaménko a párování"),
 *     null když žádné; nejvýš 1000 znaků
 *   - supplier '' když neznámý (pravidlo n8n), amount 0 když neznámá
 *     (sloupec je NOT NULL — stav pak MUSÍ být Ke schválení nebo Nutná…)
 *   - currency 'CZK' když neznámá; needs_review = stav začíná „Nutná ruční kontrola"
 *   - všechny texty přes bezRidicichZnaku; document_text_excerpt nejvýš 2000 znaků
 *   - received_at = prijatoKdy; email_sender/email_subject z kontextu; is_archived false
 *
 * Upřesnění: „chybí dodavatel I částka" platí i pro upomínku; upomínka bez
 * částky jde Ke schválení (tam ji člověk přeřadí); chybí-li DUZP, rozhoduje
 * datum vystavení; chybí-li jen dodavatel nebo jen částka → Ke schválení.
 */
export function rozhodnout(
  doklad: VytezenyDoklad,
  kontext: { prijatoKdy: string; odesilatel: string | null; predmet: string | null; pdfUrl: string | null },
): Rozhodnuti {
  const popisNedokladu = POPIS_NEDOKLADU.get(doklad.typ)
  if (popisNedokladu) {
    return { akce: 'nezapisovat', stav: 'neni_doklad', duvod: `Podle obsahu nejde o fakturu ani upomínku (${popisNedokladu}).` }
  }

  const poznamky: string[] = []
  const pridat = (d: string) => { if (!poznamky.includes(d)) poznamky.push(d) }
  for (const d of Array.isArray(doklad.duvodyKontroly) ? doklad.duvodyKontroly : []) {
    const cisty = jednoradkove(d, 300)
    if (cisty) pridat(cisty)
  }
  const maDuvody = poznamky.length > 0

  const dodavatel = jednoradkove(doklad.dodavatelNazev, 255)
  const castka = typeof doklad.castkaCelkem === 'number' && Number.isFinite(doklad.castkaCelkem) && doklad.castkaCelkem !== 0
    ? doklad.castkaCelkem
    : null
  const chybiDodavatel = dodavatel === null && txt(doklad.dodavatelIco) === null
  const chybiCastka = castka === null
  const rozhodneDatum = txt(doklad.duzp) ?? txt(doklad.datumVystaveni)
  const stary = rozhodneDatum !== null && rozhodneDatum < NEJSTARSI_DUZP

  if (doklad.typ === 'zalohova_faktura') pridat('Zálohová faktura — není daňový doklad')
  if (doklad.typ === 'dobropis') pridat('Dobropis — zkontrolujte znaménko a párování')
  if (stary) pridat(`Doklad s DUZP ${zkratit(rozhodneDatum, 20)} je před 1. 1. 2026 — starší doklady jdou ke schválení`)
  if (chybiCastka) pridat(DUVOD_CHYBI_CASTKA)
  if (chybiDodavatel) pridat(DUVOD_CHYBI_DODAVATEL)

  let stav: string
  if (chybiDodavatel && chybiCastka) {
    stav = STAV_NECITELNE
  } else if (doklad.typ === 'upominka') {
    stav = chybiCastka ? STAV_KE_SCHVALENI : STAV_UPOMINKA
  } else if (
    doklad.vyzadujeKontrolu !== false || maDuvody || doklad.typ !== 'faktura' || doklad.jistotaTypu !== 'vysoka' ||
    stary || chybiCastka || chybiDodavatel
  ) {
    stav = STAV_KE_SCHVALENI
  } else {
    stav = STAV_KE_KONTROLE
  }

  const radek: RadekFaktury = {
    received_at: kontext.prijatoKdy,
    email_sender: zkratit(txt(kontext.odesilatel), 320),
    email_subject: zkratit(txt(kontext.predmet), 1000),
    supplier: dodavatel ?? '',
    supplier_ico: txt(doklad.dodavatelIco),
    invoice_number: txt(doklad.cisloDokladu),
    variable_symbol: txt(doklad.variabilniSymbol),
    amount: castka ?? 0,
    currency: txt(doklad.mena) ?? 'CZK',
    issue_date: txt(doklad.datumVystaveni),
    duzp: txt(doklad.duzp),
    due_date: txt(doklad.datumSplatnosti),
    supplier_account: txt(doklad.ucetDodavatele),
    status: stav,
    needs_review: stav.startsWith(PREDPONA_RUCNI_KONTROLY),
    pdf_url: txt(kontext.pdfUrl),
    review_note: poznamky.length > 0 ? zkratit(poznamky.join('; '), 1000) : null,
    document_text_excerpt: zkratit(txt(doklad.ukazkaTextu), 2000),
    is_archived: false,
  }
  return { akce: 'zapsat', radek }
}

function holaAdresa(v: unknown): string | null {
  const t = txt(v)
  if (t === null) return null
  const vZavorkach = t.match(/<([^<>]*)>/g)
  const adresa = (vZavorkach ? vZavorkach[vZavorkach.length - 1].slice(1, -1) : t)
    .trim().replace(/^mailto:/i, '').toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(adresa) ? adresa : null
}

function casMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  let t = v.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2')
  if (/T.*[+-]\d{2}$/.test(t)) t += ':00'
  // Čas bez pásma bereme jako UTC, ne jako místní čas stroje — výsledek
  // nesmí záviset na tom, kde úloha běží.
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t += 'Z'
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

function normalizovatPredmet(v: unknown): string | null {
  const t = txt(v)
  return t === null ? null : t.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Zapsal tenhle e-mail už n8n? Shoda odesílatele (adresa bez ohledu na
 * velikost písmen; `email_sender` může být „Jméno <adresa>" i holá adresa),
 * času přijetí v okně ±10 minut a — když ho mají obě strany — i předmětu.
 * Bez předmětu by jiný e-mail od téhož dodavatele ve stejných deseti
 * minutách „schoval" fakturu, kterou n8n nikdy nezapsal (padal).
 */
export function emailUzZapsany(
  zprava: { odesilatel: string | null; prijatoKdy: string | null; predmet?: string | null },
  radek: { email_sender: string | null; received_at: string; email_subject?: string | null },
): boolean {
  const a = holaAdresa(zprava.odesilatel)
  const b = holaAdresa(radek.email_sender)
  if (a === null || a !== b) return false
  const pa = normalizovatPredmet(zprava.predmet)
  const pb = normalizovatPredmet(radek.email_subject)
  if (pa !== null && pb !== null && pa !== pb) return false
  const ta = casMs(zprava.prijatoKdy)
  const tb = casMs(radek.received_at)
  return ta !== null && tb !== null && Math.abs(ta - tb) <= 10 * 60 * 1000
}

function normalizovatCislo(v: unknown): string {
  return (txt(v) ?? '').replace(/\s+/g, '').toLowerCase()
}

function normalizovatNazev(v: unknown): string {
  return (txt(v) ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Je vytěžený doklad týž jako řádek ve Fakturách? Porovnává číslo dokladu
 * (bez mezer, malými) a dodavatele (IČO, jinak normalizovaný název jako
 * předpona). 'stejny' = i částka sedí (±0,01); 'opraveny' = číslo a
 * dodavatel sedí, částka ne (opravný doklad — NENÍ duplicita, jde ke
 * kontrole); 'jiny' jinak. Bez čísla dokladu vždy 'jiny'.
 *
 * Neznámá částka na kterékoli straně = 'opraveny' (shodu nejde potvrdit).
 */
export function porovnatSFakturou(
  doklad: Pick<VytezenyDoklad, 'cisloDokladu' | 'dodavatelIco' | 'dodavatelNazev' | 'castkaCelkem'>,
  radek: { invoice_number: string | null; supplier_ico: string | null; supplier: string | null; amount: number | null },
): 'stejny' | 'opraveny' | 'jiny' {
  const cislo = normalizovatCislo(doklad.cisloDokladu)
  if (cislo === '' || cislo !== normalizovatCislo(radek.invoice_number)) return 'jiny'

  const icoA = normalizovatIco(doklad.dodavatelIco)
  const icoB = normalizovatIco(radek.supplier_ico)
  let stejnyDodavatel: boolean
  if (icoA !== null && icoB !== null) {
    stejnyDodavatel = icoA === icoB
  } else {
    const a = normalizovatNazev(doklad.dodavatelNazev)
    const b = normalizovatNazev(radek.supplier)
    // Krátký název (nebo prázdný) je předponou skoro čehokoli.
    stejnyDodavatel = a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))
  }
  if (!stejnyDodavatel) return 'jiny'

  const ca = doklad.castkaCelkem
  const cb = radek.amount
  return typeof ca === 'number' && typeof cb === 'number' && Math.abs(ca - cb) <= 0.01 + 1e-9 ? 'stejny' : 'opraveny'
}

export type { RadekFaktury }
