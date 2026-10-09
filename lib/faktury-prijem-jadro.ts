/**
 * Jádro příjmu faktur z e-mailu — rozhodovací logika jednoho běhu.
 *
 * Bez `server-only` a bez aliasu `@/`: veškerá práce s databází,
 * schránkou, úložištěm a AI jde přes `Repozitar` a `Sluzby`, takže se
 * celý běh dá ověřit testem s falešnou implementací v paměti
 * (scripts/faktury-prijem-jadro.test.mjs). Skutečné napojení je v
 * lib/faktury-prijem-sync.ts.
 *
 * Pořadí, na kterém stojí bezpečnost dat:
 *   1. soubory do úložiště → 2. řádky evidence → 3. teprve pak kurzor.
 *   Když běh spadne kdekoli mezi tím, příští běh zprávu načte znovu a
 *   klíč evidence (schránka, složka, UIDVALIDITY, UID, část) nic nezdvojí.
 *   Faktura se do Faktur zapíše nejvýš jednou: řádek evidence přejde na
 *   'zapsano' hned po vložení, a před vložením se hledá stejný doklad.
 */

import { createHash } from 'node:crypto'

import {
  AI_LIMIT_ZA_DEN,
  MAX_POKUSU,
  nacistNastaveni,
  type DruhPrilohy,
  type KandidatPrilohy,
  type NastaveniPrijmu,
  type RadekFaktury,
  type StavPrijmu,
  type TypDokladu,
  type VytezenyDoklad,
} from './faktury-prijem-typy.ts'
import { cestaSouboru, jeIsdocXml, mimeProUlozeni, priponaProUlozeni, zakladNazvu } from './faktury-prijem-prilohy.ts'
import { precistIsdoc } from './faktury-prijem-isdoc.ts'
import { bezRidicichZnaku, emailUzZapsany, klicUctu, porovnatSFakturou, rozhodnout, zkontrolovatVytezeni } from './faktury-prijem-kontrola.ts'
import type { PrihlaseniImap } from './integrace-mail-imap-moznosti.ts'
import type { DavkaZprav, ZpravaSPrilohami } from './faktury-prijem-imap.ts'
import type { PodkladAI, VysledekAI } from './faktury-prijem-ai.ts'
import type { VysledekPrijmu } from './faktury-prijem-sync.ts'

/** Zpráv na jednu dávku čtení schránky — struktura je levná, stahují se jen nové přílohy. */
export const LIMIT_ZPRAV = 100

/** Kolik času nechat fázi 2 (vytěžení): fáze 1 končí, když zbývá méně. */
const REZERVA_PRO_VYTEZENI_MS = 20_000

/** AI čtení trvá desítky sekund — nezačínat ho, když už tolik nezbývá. */
const MIN_CAS_NA_AI_MS = 25_000

/** Okno pro „tenhle e-mail už zapsal n8n" — musí sedět s emailUzZapsany. */
const OKNO_N8N_MS = 10 * 60_000

export type PripojeniPrijmu = {
  id: string
  tenantId: string
  odpojeno: boolean
  externiUcet: Record<string, unknown>
}

export type NovyZaznam = {
  tenant_id: string
  pripojeni_id: string
  slozka: string
  uidvalidity: string
  uid: number
  message_id: string | null
  prijato_kdy: string | null
  odesilatel: string | null
  predmet: string | null
  priloha_cast: string
  priloha_nazev: string
  priloha_typ: string
  priloha_velikost: number
  priloha_hash: string | null
  druh: DruhPrilohy
  soubor_cesta: string | null
  stav: StavPrijmu
  faktura_id: string | null
  duvod: string | null
  vysledek: Record<string, unknown> | null
}

export type Zaznam = NovyZaznam & {
  id: string
  pokusu: number
}

export type ZmenaZaznamu = {
  stav: StavPrijmu
  typ_dokladu?: TypDokladu | null
  vysledek?: Record<string, unknown> | null
  zdroj_vytezeni?: 'isdoc' | 'ai' | null
  model?: string | null
  faktura_id?: string | null
  duvod?: string | null
  pokusu?: number
  zpracovano_kdy?: string | null
}

export type RadekFakturyVOkne = { id: string; email_sender: string | null; received_at: string; email_subject: string | null }
export type RadekFakturyPodleCisla = { id: string; invoice_number: string | null; supplier_ico: string | null; supplier: string | null; amount: number | null }

export type FakturyDb = {
  vOkne(odIso: string, doIso: string): Promise<RadekFakturyVOkne[]>
  /** Kandidáti na stejné číslo dokladu — NADMNOŽINA (bez ohledu na mezery a velikost písmen); porovná porovnatSFakturou. */
  podleCisla(cislo: string): Promise<RadekFakturyPodleCisla[]>
  /** Účty dodavatele (IČO) z faktur, které prošly kontrolou (Ke kontrole úhrady, uhrazené) — nový účet je podezřelý. */
  uctyDodavatele(ico: string): Promise<string[]>
  /** Faktura, kterou už zapsal tenhle příjem (pdf_url končí id řádku evidence) — pojistka proti dvojímu zápisu. */
  podleOdkazu(zaznamId: string): Promise<string | null>
  vlozit(radek: RadekFaktury): Promise<string>
}

/** Dřívější řádek evidence se stejným otiskem přílohy (jiná zpráva, jiná schránka). */
export type DrivejsiPriloha = { id: string; fakturaId: string | null; stav: StavPrijmu; pripojeniZive: boolean }

export type Repozitar = {
  nactiPripojeni(id: string): Promise<PripojeniPrijmu | null>
  /** Rozšifrované heslo, nebo null (chybí / nejde rozšifrovat). */
  nactiHeslo(id: string): Promise<string | null>
  /** Jen pro kontrolu odběratele na faktuře — NIKDY pro rozhodnutí o přístupu (IČO si firma může přepsat). */
  icoFirmy(tenantId: string): Promise<string | null>
  /** Databáze Faktur pro tuhle firmu — null, když jí nepatří (brána pristupKFakturamUlohy, jen podle FAKTURY_DB_TENANT_ID). */
  fakturyProFirmu(tenantId: string): FakturyDb | null
  oznacitPripojeni(id: string, zmena: { stav?: string; posledni_chyba?: string | null; posledni_sync_kdy?: string; posledni_sync_pocet_radku?: number }): Promise<void>
  zamknout(tenantId: string, pripojeniId: string): Promise<{ ok: true; behId: string } | { ok: false; duvod: string }>
  odemknout(behId: string, vysledek: { ok: boolean; pocet: number; chyba: string | null }): Promise<void>
  nactiKurzor(pripojeniId: string, slozka: string): Promise<{ uidvalidity: string; posledniUid: number; od: string } | null>
  ulozitKurzor(k: { tenantId: string; pripojeniId: string; slozka: string; uidvalidity: string; posledniUid: number; od: string }): Promise<void>
  smazatKurzor(pripojeniId: string, slozka: string): Promise<void>
  /** Vloží řádky; konflikt na klíči evidence se tiše přeskočí (opakované načtení). */
  vlozitZaznamy(radky: NovyZaznam[]): Promise<void>
  /** Řádky se stejným obsahem přílohy ve firmě (jiná zpráva, jiná schránka), nejstarší první. */
  najitPodleHashe(tenantId: string, hash: string): Promise<DrivejsiPriloha[]>
  /** Řádky 'ceka' a 'chyba' (pokusu < MAX_POKUSU), nejstarší první; `jenIsdoc` = bez PDF/fotek. */
  nactiKeZpracovani(pripojeniId: string, limit: number, jenIsdoc: boolean): Promise<Zaznam[]>
  nactiNavrhy(pripojeniId: string, limit: number): Promise<Zaznam[]>
  /** PDF spárované s ISDOC v téže zprávě (řádek 'duplicita' s vysledek.k_isdoc_casti). */
  najitParovePdf(z: Pick<Zaznam, 'pripojeni_id' | 'slozka' | 'uidvalidity' | 'uid' | 'priloha_cast'>): Promise<{ id: string } | null>
  aktualizovatZaznam(id: string, zmena: ZmenaZaznamu): Promise<void>
  /** Doplní fakturu ke spárovanému PDF (ať je z evidence vidět, kam patří). */
  doplnitFakturu(id: string, fakturaId: string): Promise<void>
  pocetCekajicich(pripojeniId: string): Promise<number>
  pocetAiDnes(tenantId: string, dnes: string): Promise<number>
  nahratSoubor(cesta: string, data: Uint8Array, mime: string): Promise<void>
  stahnoutSoubor(cesta: string): Promise<Uint8Array | null>
}

export type Sluzby = {
  nactiDavku(
    prihlaseni: PrihlaseniImap,
    slozka: string,
    kurzor: { uidvalidity: string | null; posledniUid: number },
    od: string,
    limitZprav: number,
    stahnout: (zprava: ZpravaSPrilohami, kandidat: KandidatPrilohy) => Promise<boolean>,
    /** Po tomhle čase dávka skončí na hranici celé zprávy (aspoň jedna zpráva projde). */
    konecCteniMs: number,
  ): Promise<DavkaZprav>
  vytezitAI(podklad: PodkladAI, moznosti: { casovyLimitMs: number }): Promise<VysledekAI>
  aiNastaveno(): boolean
  ted(): number
  /** Adresa appky (https://…) pro odkaz na přílohu ve Fakturách; null = relativní odkaz. */
  zakladOdkazu?: string | null
}

const MIME_PRO_AI: Record<string, PodkladAI['mime']> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export function otisk(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Odkaz na přílohu pro `invoices.pdf_url`. Absolutní, když je známá adresa
 * appky — relativní odkaz by v CSV exportu pro účetní nikam nevedl.
 */
export function odkazNaPrilohu(zaznamId: string, zaklad: string | null = null): string {
  return `${zaklad ?? ''}/api/faktury/priloha/${zaznamId}`
}

/**
 * Text z e-mailu do evidence: bez NUL a řídicích znaků, oříznutý na limit
 * sloupce (počítáno po znacích jako `char_length`). Jedna zpráva s dlouhým
 * předmětem nebo NUL by jinak shodila zápis celé dávky — a protože se
 * kurzor posouvá až po zápisu, zasekla by schránku navždy.
 */
export function textDoEvidence(text: string | null | undefined, max: number): string | null {
  const cisty = bezRidicichZnaku(text)
  if (cisty === null) return null
  const znaky = Array.from(cisty)
  return znaky.length > max ? znaky.slice(0, max).join('') : cisty
}

/** Řetězce v JSON pro `jsonb`: bez NUL a osamocených polovin páru (Postgres je odmítne). */
function cistyJson(hodnota: unknown): unknown {
  if (typeof hodnota === 'string') return hodnota.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
  if (Array.isArray(hodnota)) return hodnota.map(cistyJson)
  if (hodnota && typeof hodnota === 'object') return Object.fromEntries(Object.entries(hodnota).map(([k, v]) => [k, cistyJson(v)]))
  return hodnota
}

/** Stavy, ve kterých je o příloze rozhodnuto — nezáleží, jestli její schránka ještě žije. */
const ROZHODNUTE: readonly StavPrijmu[] = ['zapsano', 'existuje', 'neni_doklad']

/**
 * Je stejný soubor už „v péči" jinde? Ano, když dřívější řádek je rozhodnutý
 * (zapsáno, existuje, není doklad), nebo když ho ještě zpracovává ŽIVÁ
 * schránka. Nedokončený řádek ODPOJENÉ schránky se nepočítá: po odpojení
 * a novém připojení (třeba kvůli změně hesla) by se jinak čekající faktury
 * tiše ztratily — stará schránka už neběží a nová by je měla za kopie.
 */
export function vybratDrivejsi(drivejsi: DrivejsiPriloha[]): DrivejsiPriloha | null {
  return drivejsi.find((d) => ROZHODNUTE.includes(d.stav))
    ?? drivejsi.find((d) => d.pripojeniZive)
    ?? null
}

function ulozitZmenu(repo: Repozitar, id: string, zmena: ZmenaZaznamu): Promise<void> {
  return repo.aktualizovatZaznam(id, bezpecnaZmena(zmena))
}

function bezpecnaZmena(zmena: ZmenaZaznamu): ZmenaZaznamu {
  return {
    ...zmena,
    ...(zmena.duvod !== undefined ? { duvod: textDoEvidence(zmena.duvod, 2000) } : {}),
    ...(zmena.vysledek ? { vysledek: cistyJson(zmena.vysledek) as Record<string, unknown> } : {}),
    ...(zmena.faktura_id ? { faktura_id: zmena.faktura_id.slice(0, 64) } : {}),
  }
}

function prihlaseniZUctu(ucet: Record<string, unknown>, heslo: string): PrihlaseniImap | null {
  const host = typeof ucet.host === 'string' ? ucet.host.trim() : ''
  const port = typeof ucet.port === 'number' ? ucet.port : Number(ucet.port)
  const uzivatel = typeof ucet.uzivatel === 'string' ? ucet.uzivatel.trim() : ''
  const zabezpeceni = ucet.zabezpeceni === 'starttls' ? 'starttls' : ucet.zabezpeceni === 'tls' ? 'tls' : null
  if (!host || !uzivatel || !zabezpeceni || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port, zabezpeceni, uzivatel, heslo }
}

function prazdnyVysledek(stav: VysledekPrijmu['stav'], duvod: string | null): VysledekPrijmu {
  return { stav, duvod, nalezeno: 0, zapsano: 0, existuje: 0, kontrola: 0, zbyva: 0, schrankaDoctena: false }
}

function dnesniDatum(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Jeden běh příjmu pro jednu schránku. Nikdy nevyhodí výjimku ven —
 * úloha nad víc schránkami nesmí kvůli jedné spadnout celá.
 */
export async function zpracovatPrijemJadro(
  repo: Repozitar,
  sluzby: Sluzby,
  pripojeniId: string,
  moznosti: { konecMs: number },
): Promise<VysledekPrijmu> {
  const pripojeni = await repo.nactiPripojeni(pripojeniId)
  if (!pripojeni || pripojeni.odpojeno) return prazdnyVysledek('chyba', 'Schránka neexistuje nebo je odpojená.')

  const nastaveni = nacistNastaveni(pripojeni.externiUcet.prijem_dokladu)
  if (!nastaveni.zapnuto) return prazdnyVysledek('preskoceno', 'Příjem faktur je u schránky vypnutý.')

  const ico = await repo.icoFirmy(pripojeni.tenantId)
  const faktury = repo.fakturyProFirmu(pripojeni.tenantId)
  if (!faktury) {
    const duvod = 'Databáze faktur patří jiné firmě, nebo není nastavená — příjem nemá kam zapisovat.'
    await repo.oznacitPripojeni(pripojeniId, { posledni_chyba: duvod })
    return prazdnyVysledek('chyba', duvod)
  }

  const zamek = await repo.zamknout(pripojeni.tenantId, pripojeniId)
  if (!zamek.ok) return prazdnyVysledek('preskoceno', zamek.duvod)

  const vysledek = prazdnyVysledek('ok', null)
  try {
    // Hned na začátku: úloha bere schránky od nejdéle nezpracované — kdyby se
    // čas zapsal až na konci, schránka, jejíž běh platforma zabije, by byla
    // první navždy a ostatní by se nedostaly na řadu.
    await repo.oznacitPripojeni(pripojeniId, { posledni_sync_kdy: new Date(sluzby.ted()).toISOString() })
    const heslo = await repo.nactiHeslo(pripojeniId)
    const prihlaseni = heslo ? prihlaseniZUctu(pripojeni.externiUcet, heslo) : null
    if (!prihlaseni) {
      const duvod = heslo ? 'Nastavení schránky je neúplné (server, port, jméno).' : 'Chybí uložené heslo ke schránce, nebo ho nejde rozšifrovat.'
      await repo.oznacitPripojeni(pripojeniId, { stav: 'chyba', posledni_chyba: duvod })
      vysledek.stav = 'chyba'
      vysledek.duvod = duvod
      return vysledek
    }

    try {
      await fazeCteniSchranky(repo, sluzby, pripojeni, nastaveni, prihlaseni, faktury, moznosti, vysledek)
    } catch (e) {
      // Schránka nedostupná / odmítnuté heslo: evidence a kurzor zůstaly, jak byly.
      // Fáze 2 i tak běží — dříve stažené přílohy se dají zpracovat bez schránky.
      const duvod = `Schránku se nepodařilo přečíst: ${e instanceof Error ? e.message : String(e)}`
      await repo.oznacitPripojeni(pripojeniId, { stav: 'vyzaduje_pozornost', posledni_chyba: duvod.slice(0, 500) })
      vysledek.duvod = duvod.slice(0, 500)
    }

    await fazeVytezeni(repo, sluzby, pripojeni, nastaveni, ico, faktury, moznosti, vysledek)

    vysledek.zbyva = await repo.pocetCekajicich(pripojeniId)
    await repo.oznacitPripojeni(pripojeniId, {
      posledni_sync_kdy: new Date(sluzby.ted()).toISOString(),
      posledni_sync_pocet_radku: vysledek.zapsano,
      ...(vysledek.duvod ? { posledni_chyba: vysledek.duvod } : { stav: 'pripojeno', posledni_chyba: null }),
    })
    return vysledek
  } catch (e) {
    vysledek.stav = 'chyba'
    vysledek.duvod = `Příjem faktur selhal: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500)
    return vysledek
  } finally {
    await repo.odemknout(zamek.behId, { ok: vysledek.stav === 'ok', pocet: vysledek.zapsano, chyba: vysledek.duvod })
  }
}

async function fazeCteniSchranky(
  repo: Repozitar,
  sluzby: Sluzby,
  pripojeni: PripojeniPrijmu,
  nastaveni: NastaveniPrijmu,
  prihlaseni: PrihlaseniImap,
  faktury: FakturyDb,
  moznosti: { konecMs: number },
  vysledek: VysledekPrijmu,
): Promise<void> {
  let vsechnySlozkyDoctene = true

  for (const slozka of nastaveni.slozky) {
    let kurzor = await repo.nactiKurzor(pripojeni.id, slozka)
    // „Číst od" posunuté DŘÍV, než kurzor začal: schránka se projde znovu
    // (klíč evidence a kontrola n8n zabrání zdvojení).
    if (kurzor && nastaveni.od < kurzor.od) {
      await repo.smazatKurzor(pripojeni.id, slozka)
      kurzor = null
    }

    let doctena = false
    while (sluzby.ted() < moznosti.konecMs - REZERVA_PRO_VYTEZENI_MS) {
      const davka = await nactiAUlozitDavku(repo, sluzby, pripojeni, nastaveni, prihlaseni, faktury, slozka, kurzor, vysledek, moznosti.konecMs - REZERVA_PRO_VYTEZENI_MS)
      kurzor = { uidvalidity: davka.uidvalidity, posledniUid: davka.posledniUid, od: kurzor && !davka.resetKurzoru ? kurzor.od : nastaveni.od }
      if (davka.hotovo) {
        doctena = true
        break
      }
    }
    if (!doctena) vsechnySlozkyDoctene = false
    if (sluzby.ted() >= moznosti.konecMs - REZERVA_PRO_VYTEZENI_MS) {
      vsechnySlozkyDoctene = false
      break
    }
  }

  vysledek.schrankaDoctena = vsechnySlozkyDoctene
}

async function nactiAUlozitDavku(
  repo: Repozitar,
  sluzby: Sluzby,
  pripojeni: PripojeniPrijmu,
  nastaveni: NastaveniPrijmu,
  prihlaseni: PrihlaseniImap,
  faktury: FakturyDb,
  slozka: string,
  kurzor: { uidvalidity: string; posledniUid: number; od: string } | null,
  vysledek: VysledekPrijmu,
  konecCteniMs: number,
): Promise<DavkaZprav> {
  /** Zprávy, které už zapsal n8n: uid → id faktury. */
  const zapsaneN8n = new Map<number, string | null>()

  const stahnout = async (zprava: Pick<ZpravaSPrilohami, 'uid' | 'prijatoKdy' | 'odesilatel' | 'predmet'>): Promise<boolean> => {
    if (!zapsaneN8n.has(zprava.uid)) {
      let nalezeno: string | null = null
      if (zprava.prijatoKdy && zprava.odesilatel) {
        const cas = new Date(zprava.prijatoKdy).getTime()
        if (Number.isFinite(cas)) {
          const okno = await faktury.vOkne(new Date(cas - OKNO_N8N_MS).toISOString(), new Date(cas + OKNO_N8N_MS).toISOString())
          nalezeno = okno.find((r) => emailUzZapsany(zprava, r))?.id ?? null
        }
      }
      zapsaneN8n.set(zprava.uid, nalezeno)
    }
    return zapsaneN8n.get(zprava.uid) === null
  }

  const davka = await sluzby.nactiDavku(
    prihlaseni,
    slozka,
    { uidvalidity: kurzor?.uidvalidity ?? null, posledniUid: kurzor?.posledniUid ?? 0 },
    nastaveni.od,
    LIMIT_ZPRAV,
    stahnout,
    konecCteniMs,
  )

  const radky: NovyZaznam[] = []
  const soubory: { cesta: string; data: Uint8Array; mime: string }[] = []
  const otiskyVDavce = new Set<string>()

  for (const zprava of davka.zpravy) {
    const zakladni = {
      tenant_id: pripojeni.tenantId,
      pripojeni_id: pripojeni.id,
      slozka,
      uidvalidity: davka.uidvalidity,
      uid: zprava.uid,
      message_id: textDoEvidence(zprava.messageId, 998),
      prijato_kdy: zprava.prijatoKdy,
      odesilatel: textDoEvidence(zprava.odesilatel, 320),
      predmet: textDoEvidence(zprava.predmet, 1000),
    }
    // Zpráva, kde se nestahovalo nic (všechny přílohy moc velké / nepodporované),
    // se na n8n neptala — zeptat se teď, ať zapsanou fakturu nevrátí ke kontrole.
    if (!zapsaneN8n.has(zprava.uid) && zprava.kandidati.length > 0) await stahnout(zprava)
    const fakturaN8n = zapsaneN8n.get(zprava.uid) ?? null

    // ISDOC a PDF se stejným základem názvu v téže zprávě = tatáž faktura:
    // čte se ISDOC (bez AI), PDF slouží jako čitelný odkaz. Jen OPRAVDOVÝ ISDOC
    // podle obsahu — `faktura.xml` v jiném formátu by jinak PDF „schoval" a
    // fakturu by nepřečetl nikdo.
    const isdocPodleZakladu = new Map<string, string>()
    for (const k of zprava.kandidati) {
      if (k.druh !== 'isdoc' || k.duvodBezStazeni) continue
      const obsah = zprava.stazene.get(k.cast)
      if (obsah && jeIsdocXml(new TextDecoder('utf-8').decode(obsah))) isdocPodleZakladu.set(zakladNazvu(k.nazev), k.cast)
    }

    for (const k of zprava.kandidati) {
      const radek: NovyZaznam = {
        ...zakladni,
        priloha_cast: k.cast,
        priloha_nazev: textDoEvidence(k.nazev, 255) ?? 'priloha',
        priloha_typ: textDoEvidence(k.mime, 127) ?? 'application/octet-stream',
        priloha_velikost: k.velikost,
        priloha_hash: null,
        druh: k.druh,
        soubor_cesta: null,
        stav: 'ceka',
        faktura_id: null,
        duvod: null,
        vysledek: null,
      }

      if (fakturaN8n !== null) {
        radky.push({ ...radek, stav: 'existuje', faktura_id: fakturaN8n, duvod: 'Tenhle e-mail už do Faktur zapsal n8n.' })
        continue
      }
      if (k.duvodBezStazeni) {
        radky.push({ ...radek, stav: 'vyzaduje_kontrolu', duvod: k.duvodBezStazeni })
        continue
      }

      const data = zprava.stazene.get(k.cast)
      if (!data) {
        radky.push({ ...radek, stav: 'vyzaduje_kontrolu', duvod: 'Přílohu se nepodařilo ze schránky stáhnout.' })
        continue
      }

      const hash = otisk(data)
      radek.priloha_hash = hash
      radek.priloha_velikost = data.byteLength

      if (k.druh === 'isdoc' && !jeIsdocXml(new TextDecoder('utf-8').decode(data))) {
        radky.push({ ...radek, stav: 'neni_doklad', duvod: 'XML příloha není faktura ve formátu ISDOC.' })
        continue
      }

      if (otiskyVDavce.has(hash)) {
        radky.push({ ...radek, stav: 'duplicita', duvod: 'Stejný soubor je ve schránce víckrát — zpracuje se jednou.' })
        continue
      }
      const drivejsi = vybratDrivejsi(await repo.najitPodleHashe(pripojeni.tenantId, hash))
      if (drivejsi) {
        radky.push({
          ...radek,
          stav: 'duplicita',
          faktura_id: drivejsi.fakturaId,
          duvod: 'Stejný soubor už appka přijala dřív (jiná zpráva nebo schránka).',
        })
        continue
      }
      otiskyVDavce.add(hash)

      const pripona = priponaProUlozeni(k)
      const cesta = cestaSouboru(pripojeni.tenantId, hash, pripona)
      soubory.push({ cesta, data, mime: mimeProUlozeni(pripona) })
      radek.soubor_cesta = cesta

      const parovyIsdoc = k.druh === 'pdf' ? isdocPodleZakladu.get(zakladNazvu(k.nazev)) : undefined
      if (parovyIsdoc) {
        radky.push({ ...radek, stav: 'duplicita', duvod: 'PDF k faktuře ISDOC ze stejného e-mailu — čte se ISDOC.', vysledek: { k_isdoc_casti: parovyIsdoc } })
        continue
      }

      if ((k.druh === 'pdf' || k.druh === 'obrazek') && !nastaveni.ai.povoleno) {
        radky.push({ ...radek, duvod: 'Čeká na zapnutí čtení přes AI (PDF a fotky appka bez AI nepřečte).' })
        continue
      }

      radky.push(radek)
    }
  }

  // 1. soubory, 2. evidence, 3. kurzor — v tomhle pořadí, nikdy jinak.
  for (const s of soubory) await repo.nahratSoubor(s.cesta, s.data, s.mime)
  if (radky.length > 0) await repo.vlozitZaznamy(radky)
  await repo.ulozitKurzor({
    tenantId: pripojeni.tenantId,
    pripojeniId: pripojeni.id,
    slozka,
    uidvalidity: davka.uidvalidity,
    posledniUid: davka.posledniUid,
    od: kurzor && !davka.resetKurzoru ? kurzor.od : nastaveni.od,
  })

  vysledek.nalezeno += radky.length
  vysledek.existuje += radky.filter((r) => r.stav === 'existuje').length
  vysledek.kontrola += radky.filter((r) => r.stav === 'vyzaduje_kontrolu').length
  return davka
}

async function fazeVytezeni(
  repo: Repozitar,
  sluzby: Sluzby,
  pripojeni: PripojeniPrijmu,
  nastaveni: NastaveniPrijmu,
  ico: string | null,
  faktury: FakturyDb,
  moznosti: { konecMs: number },
  vysledek: VysledekPrijmu,
): Promise<void> {
  let aiDostupne = nastaveni.ai.povoleno && sluzby.aiNastaveno()
  if (nastaveni.ai.povoleno && !sluzby.aiNastaveno()) {
    vysledek.duvod ??= 'Čtení přes AI je zapnuté, ale chybí klíč (ANTHROPIC_API_KEY) — PDF a fotky čekají.'
  }
  const dnes = dnesniDatum(sluzby.ted())
  if (aiDostupne && (await repo.pocetAiDnes(pripojeni.tenantId, dnes)) >= AI_LIMIT_ZA_DEN) {
    aiDostupne = false
    vysledek.duvod ??= `Dnešní strop čtení přes AI (${AI_LIMIT_ZA_DEN} dokladů) je vyčerpaný — pokračuje se zítra.`
  }

  const hotove = new Set<string>()
  while (sluzby.ted() < moznosti.konecMs) {
    const fronta = (await repo.nactiKeZpracovani(pripojeni.id, 20, !aiDostupne)).filter((z) => !hotove.has(z.id))
    if (fronta.length === 0) break

    for (const zaznam of fronta) {
      if (sluzby.ted() >= moznosti.konecMs) return
      const potrebujeAi = zaznam.druh === 'pdf' || zaznam.druh === 'obrazek'
      if (potrebujeAi && (!aiDostupne || sluzby.ted() > moznosti.konecMs - MIN_CAS_NA_AI_MS)) {
        // Na AI už není čas (nebo není k dispozici): v tomhle běhu dál jen
        // ISDOC — další dotaz do fronty PDF vynechá, počkají na příští běh.
        aiDostupne = false
        continue
      }
      hotove.add(zaznam.id)
      const pokracovat = await zpracovatZaznam(repo, sluzby, zaznam, nastaveni, ico, faktury, vysledek, moznosti.konecMs)
      if (pokracovat === 'zastavit_ai') aiDostupne = false
    }
  }
}

async function zpracovatZaznam(
  repo: Repozitar,
  sluzby: Sluzby,
  zaznam: Zaznam,
  nastaveni: NastaveniPrijmu,
  ico: string | null,
  faktury: FakturyDb,
  vysledek: VysledekPrijmu,
  konecMs: number,
): Promise<'dal' | 'zastavit_ai'> {
  const ted = () => new Date(sluzby.ted()).toISOString()
  const ukoncit = async (zmena: ZmenaZaznamu) => {
    await ulozitZmenu(repo, zaznam.id, { zpracovano_kdy: ted(), ...zmena })
    if (zmena.stav === 'vyzaduje_kontrolu') vysledek.kontrola++
    if (zmena.stav === 'existuje') vysledek.existuje++
    if (zmena.stav === 'zapsano') vysledek.zapsano++
  }

  // Pokusy se počítají PŘED voláním AI — běh, který platforma zabije uprostřed,
  // se tak taky započítá a jeden dlouhý doklad nezablokuje frontu navždy.
  if (zaznam.pokusu >= MAX_POKUSU) {
    await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: 'Zpracování se opakovaně nedokončilo (vypršel čas nebo výpadek) — zkontrolujte přílohu ručně.' })
    return 'dal'
  }

  // Faktura už zapsaná tímhle příjmem (zápis prošel, ale evidence se pak
  // nezměnila — výpadek, zabitý běh)? Pak jen doplnit evidenci, nezapsat znovu.
  const uzZapsana = await faktury.podleOdkazu(zaznam.id)
  if (uzZapsana) {
    await ukoncit({ stav: 'zapsano', faktura_id: uzZapsana, duvod: 'Faktura už byla zapsaná dřív (doplněno po výpadku).' })
    return 'dal'
  }

  if (!zaznam.soubor_cesta) {
    await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: 'K řádku chybí uložený soubor.' })
    return 'dal'
  }
  const data = await repo.stahnoutSoubor(zaznam.soubor_cesta)
  if (!data) {
    await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: 'Soubor chybí v úložišti.' })
    return 'dal'
  }

  let doklad: VytezenyDoklad
  let zdroj: 'isdoc' | 'ai'
  let model: string | null = null
  let pdfUrl = odkazNaPrilohu(zaznam.id, sluzby.zakladOdkazu ?? null)
  let parovePdfId: string | null = null

  if (zaznam.druh === 'isdoc') {
    const precteno = precistIsdoc(new TextDecoder('utf-8').decode(data))
    if (precteno.stav === 'chyba') {
      // Je u něj PDF ze stejného e-mailu? Pak se faktura přečte z PDF (AI) a
      // člověk nedostane zbytečnou položku ke kontrole.
      const pdf = await repo.najitParovePdf(zaznam)
      if (pdf) {
        await ulozitZmenu(repo, pdf.id, { stav: 'ceka', duvod: 'ISDOC ze stejného e-mailu nejde přečíst — čte se PDF.' })
        await ukoncit({ stav: 'duplicita', duvod: `ISDOC se nepodařilo přečíst (${precteno.duvod}) — faktura se čte z PDF.` })
        return 'dal'
      }
      await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: `ISDOC se nepodařilo přečíst: ${precteno.duvod}` })
      return 'dal'
    }
    doklad = precteno.doklad
    zdroj = 'isdoc'
    const pdf = await repo.najitParovePdf(zaznam)
    if (pdf) {
      parovePdfId = pdf.id
      pdfUrl = odkazNaPrilohu(pdf.id, sluzby.zakladOdkazu ?? null)
    }
  } else if (zaznam.druh === 'pdf' || zaznam.druh === 'obrazek') {
    const mime = MIME_PRO_AI[priponaProUlozeni({ druh: zaznam.druh, mime: zaznam.priloha_typ, nazev: zaznam.priloha_nazev })]
    if (!mime) {
      await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: 'Tenhle typ souboru AI nepřečte.' })
      return 'dal'
    }
    // Pokus (a útrata do denního stropu) se zapíše PŘED voláním: kdyby běh
    // platforma zabila uprostřed, pokus se i tak počítá a strop o něm ví.
    const pokusu = zaznam.pokusu + 1
    await ulozitZmenu(repo, zaznam.id, { stav: zaznam.stav, pokusu, zdroj_vytezeni: 'ai', zpracovano_kdy: ted() })
    const ai = await sluzby.vytezitAI(
      { data, mime, predmet: zaznam.predmet, odesilatel: zaznam.odesilatel },
      // Volání musí doběhnout v čase běhu — jinak ho platforma zabije uprostřed a útrata je zbytečná.
      { casovyLimitMs: Math.max(5_000, konecMs - sluzby.ted() - 3_000) },
    )
    if (ai.stav === 'bez_klice') {
      // K volání nedošlo — pokus se nepočítá.
      await ulozitZmenu(repo, zaznam.id, { stav: zaznam.stav, pokusu: zaznam.pokusu, zdroj_vytezeni: null, zpracovano_kdy: null })
      return 'zastavit_ai'
    }
    if (ai.stav === 'chyba') {
      if (ai.docasna && pokusu < MAX_POKUSU) {
        await ulozitZmenu(repo, zaznam.id, { stav: 'chyba', pokusu, duvod: ai.duvod, zdroj_vytezeni: 'ai' })
        return 'zastavit_ai'
      }
      await ukoncit({ stav: 'vyzaduje_kontrolu', pokusu, duvod: ai.duvod, zdroj_vytezeni: 'ai' })
      return 'dal'
    }
    doklad = ai.doklad
    zdroj = 'ai'
    model = ai.model
  } else {
    await ukoncit({ stav: 'vyzaduje_kontrolu', duvod: 'Nepodporovaný typ přílohy.' })
    return 'dal'
  }

  doklad = zkontrolovatVytezeni(doklad, { icoFirmy: ico, dnes: dnesniDatum(sluzby.ted()) })

  if (doklad.cisloDokladu && doklad.typ !== 'neni_doklad') {
    for (const radek of await faktury.podleCisla(doklad.cisloDokladu)) {
      const shoda = porovnatSFakturou(doklad, radek)
      if (shoda === 'stejny') {
        await ukoncit({ stav: 'existuje', faktura_id: radek.id, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad }, duvod: 'Stejná faktura už ve Fakturách je.' })
        if (parovePdfId) await repo.doplnitFakturu(parovePdfId, radek.id)
        return 'dal'
      }
      if (shoda === 'opraveny') {
        doklad = {
          ...doklad,
          vyzadujeKontrolu: true,
          duvodyKontroly: [...doklad.duvodyKontroly, 'Ve Fakturách už je doklad se stejným číslem a jinou částkou — možná opravný doklad.'],
        }
      }
    }
  }

  doklad = await overitUcetDodavatele(doklad, faktury)

  const rozhodnuti = rozhodnout(doklad, { prijatoKdy: zaznam.prijato_kdy ?? ted(), odesilatel: zaznam.odesilatel, predmet: zaznam.predmet, pdfUrl })
  if (rozhodnuti.akce === 'nezapisovat') {
    await ukoncit({ stav: rozhodnuti.stav, duvod: rozhodnuti.duvod, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad } })
    return 'dal'
  }

  if (nastaveni.rezim === 'nahled') {
    await ukoncit({ stav: 'navrh', typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad, radek: rozhodnuti.radek, parove_pdf: parovePdfId }, duvod: null })
    return 'dal'
  }

  if (parovePdfId) {
    const uzSPdf = await faktury.podleOdkazu(parovePdfId)
    if (uzSPdf) {
      await ukoncit({ stav: 'zapsano', faktura_id: uzSPdf, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad }, duvod: 'Faktura už byla zapsaná dřív (doplněno po výpadku).' })
      return 'dal'
    }
  }

  try {
    const fakturaId = await faktury.vlozit(rozhodnuti.radek)
    await ukoncit({ stav: 'zapsano', faktura_id: fakturaId, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad }, duvod: rozhodnuti.radek.review_note })
    if (parovePdfId) await repo.doplnitFakturu(parovePdfId, fakturaId)
  } catch (e) {
    // U AI je tenhle pokus už započítaný (zapsal se před voláním) — stejné číslo, ne +2.
    const pokusu = zaznam.pokusu + 1
    const duvod = `Zápis do Faktur se nepodařil: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500)
    await ulozitZmenu(repo, zaznam.id, pokusu < MAX_POKUSU
      ? { stav: 'chyba', pokusu, duvod, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad } }
      : { stav: 'vyzaduje_kontrolu', pokusu, duvod, typ_dokladu: doklad.typ, zdroj_vytezeni: zdroj, model, vysledek: { doklad }, zpracovano_kdy: ted() })
  }
  return 'dal'
}

/**
 * Nový účet dodavatele = nejčastější podvod s fakturami (podvržený e-mail
 * „změnili jsme banku"). Účet se porovná s účty z faktur téhož IČO, které
 * prošly kontrolou („Ke kontrole úhrady" nebo uhrazené — stav „Uhrazeno" se
 * ve Fakturách k 8. 10. 2026 nepoužívá vůbec). Upomínky ani návrhy ke
 * schválení se nepočítají: jinak by stačilo poslat podvrženou „upomínku".
 * Když účet žádná taková faktura nemá, jde faktura ke schválení s důvodem —
 * nikdy rovnou do fronty k úhradě. Nespoléhá na AI ani na odesílatele
 * e-mailu (dá se podvrhnout).
 */
export async function overitUcetDodavatele(doklad: VytezenyDoklad, faktury: Pick<FakturyDb, 'uctyDodavatele'>): Promise<VytezenyDoklad> {
  if (doklad.typ === 'neni_doklad' || !doklad.ucetDodavatele) return doklad
  const klic = klicUctu(doklad.ucetDodavatele)
  if (!klic) return doklad
  const zname = doklad.dodavatelIco
    ? (await faktury.uctyDodavatele(doklad.dodavatelIco)).map(klicUctu).filter((u): u is string => u !== null)
    : []
  if (zname.includes(klic)) return doklad
  const duvod = zname.length === 0
    ? 'Účet dodavatele zatím není ověřený žádnou schválenou fakturou — ověřte číslo účtu, než zaplatíte.'
    : 'Číslo účtu se liší od dřívějších schválených faktur tohoto dodavatele — ověřte ho přímo u dodavatele, než zaplatíte (častý podvod).'
  return { ...doklad, vyzadujeKontrolu: true, duvodyKontroly: [...doklad.duvodyKontroly, duvod] }
}

/**
 * Režim náhled: člověk potvrdil, zapiš čekající návrhy (s novou kontrolou
 * duplicity). Pod stejným zámkem jako úloha (dvě okna ani souběh s úlohou
 * nezapíšou totéž dvakrát) a jen do `konecMs` — zbytek dalším kliknutím.
 */
export async function zapsatNavrhyJadro(
  repo: Repozitar,
  pripojeniId: string,
  tenantId: string,
  ted: () => number,
  konecMs: number,
): Promise<{ zapsano: number; chyby: number; zbyva: number; duvod: string | null }> {
  const pripojeni = await repo.nactiPripojeni(pripojeniId)
  if (!pripojeni || pripojeni.tenantId !== tenantId) return { zapsano: 0, chyby: 0, zbyva: 0, duvod: 'Schránka neexistuje.' }
  const faktury = repo.fakturyProFirmu(tenantId)
  if (!faktury) return { zapsano: 0, chyby: 0, zbyva: 0, duvod: 'Databáze faktur pro tuhle firmu není napojená.' }
  const zamek = await repo.zamknout(tenantId, pripojeniId)
  if (!zamek.ok) return { zapsano: 0, chyby: 0, zbyva: 0, duvod: zamek.duvod }

  let zapsano = 0
  let chyby = 0
  let zbyva = 0
  try {
    const navrhy = await repo.nactiNavrhy(pripojeniId, 200)
    for (const [i, zaznam] of navrhy.entries()) {
      if (ted() >= konecMs) {
        zbyva = navrhy.length - i
        break
      }
      const radek = (zaznam.vysledek as { radek?: RadekFaktury } | null)?.radek
      const doklad = (zaznam.vysledek as { doklad?: VytezenyDoklad } | null)?.doklad
      const parove = (zaznam.vysledek as { parove_pdf?: string | null } | null)?.parove_pdf ?? null
      if (!radek) {
        chyby++
        continue
      }
      const kdy = new Date(ted()).toISOString()
      const uzZapsana = await faktury.podleOdkazu(parove ?? zaznam.id)
      if (uzZapsana) {
        await ulozitZmenu(repo, zaznam.id, { stav: 'zapsano', faktura_id: uzZapsana, zpracovano_kdy: kdy })
        continue
      }
      if (doklad?.cisloDokladu) {
        const stejna = (await faktury.podleCisla(doklad.cisloDokladu)).find((r) => porovnatSFakturou(doklad, r) === 'stejny')
        if (stejna) {
          await ulozitZmenu(repo, zaznam.id, { stav: 'existuje', faktura_id: stejna.id, duvod: 'Stejná faktura už ve Fakturách je.', zpracovano_kdy: kdy })
          continue
        }
      }
      try {
        const fakturaId = await faktury.vlozit(radek)
        await ulozitZmenu(repo, zaznam.id, { stav: 'zapsano', faktura_id: fakturaId, zpracovano_kdy: kdy })
        if (parove) await repo.doplnitFakturu(parove, fakturaId)
        zapsano++
      } catch {
        chyby++
      }
    }
  } finally {
    await repo.odemknout(zamek.behId, { ok: chyby === 0, pocet: zapsano, chyba: chyby > 0 ? `Návrhy: ${chyby} se nepodařilo zapsat.` : null })
  }
  return { zapsano, chyby, zbyva, duvod: null }
}
