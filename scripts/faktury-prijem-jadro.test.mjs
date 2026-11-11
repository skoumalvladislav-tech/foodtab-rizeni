#!/usr/bin/env node
/**
 * Jádro příjmu faktur (lib/faktury-prijem-jadro.ts) nad FALEŠNÝM světem
 * v paměti: evidence, kurzory, úložiště, databáze Faktur, schránka a AI.
 * Žádná síť, žádná databáze — ověřuje rozhodování celého běhu.
 *
 * Pusť: node scripts/faktury-prijem-jadro.test.mjs   (Node 24, běží i v CI)
 */

import { zpracovatPrijemJadro, zapsatNavrhyJadro, vratitDoFrontyJadro, DUVOD_VRACENI, DUVOD_KONTROLY_VRACENI, LIMIT_ZPRAV } from '../lib/faktury-prijem-jadro.ts'
import { AI_LIMIT_ZA_DEN, MAX_POKUSU, lzeZkusitZnovu } from '../lib/faktury-prijem-typy.ts'
import { STAV_KE_KONTROLE, STAV_KE_SCHVALENI } from '../lib/faktury-types.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const FIRMA = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
const CIZI_FIRMA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const ICO_FIRMY = '21249946'
const ICO_DODAVATELE = '27082440'
const ZACATEK = Date.parse('2026-10-08T10:00:00Z')
const bajty = (text) => new TextEncoder().encode(text)

function isdocXml({ cislo = 'FV2026-0815', castka = '12100.50', typ = '1' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${typ}</DocumentType>
  <ID>${cislo}</ID>
  <IssueDate>2026-09-20</IssueDate>
  <TaxPointDate>2026-09-19</TaxPointDate>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <AccountingSupplierParty><Party>
    <PartyIdentification><ID>${ICO_DODAVATELE}</ID></PartyIdentification>
    <PartyName><Name>Velkoobchod s.r.o.</Name></PartyName>
  </Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party>
    <PartyIdentification><ID>${ICO_FIRMY}</ID></PartyIdentification>
    <PartyName><Name>Foodtab s.r.o.</Name></PartyName>
  </Party></AccountingCustomerParty>
  <LegalMonetaryTotal><PayableAmount>${castka}</PayableAmount></LegalMonetaryTotal>
  <PaymentMeans><Payment><Details>
    <PaymentDueDate>2026-10-20</PaymentDueDate>
    <ID>19-2000145399</ID><BankCode>0800</BankCode>
    <VariableSymbol>20260815</VariableSymbol>
  </Details></Payment></PaymentMeans>
</Invoice>`
}

function dokladAI(cislo, castka = 1000, zmeny = {}) {
  return {
    typ: 'faktura', jistotaTypu: 'vysoka',
    dodavatelNazev: 'Pekárna Novák s.r.o.', dodavatelIco: ICO_DODAVATELE,
    odberatelNazev: 'Foodtab s.r.o.', odberatelIco: ICO_FIRMY,
    cisloDokladu: cislo, variabilniSymbol: '2026001', castkaCelkem: castka, mena: 'CZK',
    datumVystaveni: '2026-09-20', duzp: '2026-09-20', datumSplatnosti: '2026-10-20',
    ucetDodavatele: '19-2000145399/0800', vyzadujeKontrolu: false, duvodyKontroly: [], ukazkaTextu: 'Faktura',
    ...zmeny,
  }
}

/** Zpráva ve falešné schránce. `prilohy`: [{ nazev, mime, druh, obsah (text) | duvodBezStazeni }]. */
function zprava(uid, prilohy, { od = 'dodavatel@example.cz', cas = `2026-09-${String(10 + (uid % 15)).padStart(2, '0')}T08:00:00.000Z` } = {}) {
  const obsah = {}
  const kandidati = prilohy.map((p, i) => {
    const cast = String(2 + i)
    if (p.obsah !== undefined) obsah[cast] = bajty(p.obsah)
    return { cast, nazev: p.nazev, mime: p.mime, velikost: p.obsah?.length ?? 99_999_999, druh: p.druh, duvodBezStazeni: p.duvodBezStazeni ?? null }
  })
  return { uid, messageId: `<m${uid}@example.cz>`, prijatoKdy: cas, odesilatel: od, predmet: `Faktura ${uid}`, kandidati, obsah }
}
const pdf = (nazev, obsah) => ({ nazev, mime: 'application/pdf', druh: 'pdf', obsah })
const isdoc = (nazev, obsah) => ({ nazev, mime: 'application/xml', druh: 'isdoc', obsah })

/**
 * Celý falešný svět. `zpravy` = obsah schránky (INBOX). Vrací repo, služby
 * a stav k prohlížení (evidence, faktury, kurzory, soubory, záznam operací).
 */
function svet({
  prijem = { zapnuto: true, ai: { povoleno: true } },
  zpravy = [],
  faktury = [],
  heslo = 'tajne',
  vlastni = true,
  zamekObsazen = false,
  aiKlic = true,
  ai = (podklad, n) => ({ stav: 'ok', doklad: dokladAI(`AI-${n}`, 1000 + n), model: 'claude-opus-5-5', verze: 'faktura-v1' }),
  aiTrvani = 5_000,
  uidvalidity = '100',
} = {}) {
  const hodiny = { ms: ZACATEK }
  const s = {
    hodiny,
    pripojeni: {
      id: 'p1', tenantId: FIRMA, odpojeno: false,
      externiUcet: { host: 'imap.example.cz', port: 993, zabezpeceni: 'tls', uzivatel: 'faktury@example.cz', prijem_dokladu: prijem },
    },
    pripojeniZmeny: [],
    zaznamy: [],
    kurzory: new Map(),
    soubory: new Map(),
    faktury: faktury.map((f, i) => ({ id: `inv-puvodni-${i}`, ...f })),
    operace: [],
    poradi: [],
    zamky: [],
    odemceno: [],
    schranka: { zpravy, uidvalidity, volani: [], stazeno: [], chyba: null },
    ai: { volani: [], fn: ai, trvani: aiTrvani, klic: aiKlic, dnesNavic: 0 },
    selhat: { vlozitZaznamy: false, fakturaVlozit: 0, nactiKeZpracovani: false, zmenaPoZapisu: 0 },
    heslo, vlastni, zamekObsazen,
    // Účty dodavatele ze schválených faktur (navíc k těm v s.faktury).
    overeneUcty: { [ICO_DODAVATELE]: ['CZ65 0800 0000 1920 0014 5399'] },
    mrtveSchranky: new Set(),
    vraceni: [],
  }
  let idZaznamu = 0
  let idFaktury = 0

  const fakturyDb = {
    async vOkne(odIso, doIso) {
      return s.faktury.filter((f) => f.received_at >= odIso && f.received_at <= doIso)
        .map((f) => ({ id: f.id, email_sender: f.email_sender ?? null, received_at: f.received_at, email_subject: f.email_subject ?? null }))
    },
    // Jako skutečný dotaz (imatch): bez ohledu na mezery a velikost písmen.
    async podleCisla(cislo) {
      const n = (x) => String(x ?? '').replace(/\s+/g, '').toLowerCase()
      return s.faktury.filter((f) => n(f.invoice_number) === n(cislo))
        .map((f) => ({ id: f.id, invoice_number: f.invoice_number, supplier_ico: f.supplier_ico ?? null, supplier: f.supplier ?? null, amount: f.amount ?? null }))
    },
    async uctyDodavatele(ico) {
      const zaplacene = s.faktury.filter((f) => f.supplier_ico === ico && ['Ke kontrole úhrady', 'Uhrazeno', 'Částečně uhrazeno', 'Neuhrazeno'].includes(f.status) && !f.is_duplicate && f.supplier_account)
      return [...(s.overeneUcty[ico] ?? []), ...zaplacene.map((f) => f.supplier_account)]
    },
    async podleOdkazu(zaznamId) {
      return s.faktury.find((f) => typeof f.pdf_url === 'string' && f.pdf_url.endsWith(`/api/faktury/priloha/${zaznamId}`))?.id ?? null
    },
    async vlozit(radek) {
      if (s.selhat.fakturaVlozit > 0) {
        s.selhat.fakturaVlozit--
        throw new Error('Faktury nedostupné')
      }
      const id = `inv-${++idFaktury}`
      s.faktury.push({ id, ...radek })
      s.operace.push(`faktura:${id}`)
      return id
    },
  }

  const klicZaznamu = (r) => [r.pripojeni_id, r.slozka, r.uidvalidity, r.uid, r.priloha_cast].join('|')
  // Jako FRONTA v sync.ts: čekající a VŠECHNY s chybou (i s vyčerpanými pokusy — ty jádro pošle do ruční kontroly).
  const vFronte = (z) => z.stav === 'ceka' || z.stav === 'chyba'

  const repo = {
    async nactiPripojeni(id) { return id === s.pripojeni.id ? { ...s.pripojeni, externiUcet: { ...s.pripojeni.externiUcet } } : null },
    async nactiHeslo() { return s.heslo },
    async icoFirmy() { return ICO_FIRMY },
    // vlastni === 'kazdy': brána pustí každou firmu — ať se dá ověřit kontrola vlastníka schránky samostatně.
    fakturyProFirmu(tenantId) { return s.vlastni === 'kazdy' || (s.vlastni && tenantId === FIRMA) ? fakturyDb : null },
    async oznacitPripojeni(id, zmena) {
      s.pripojeniZmeny.push(zmena)
      if (zmena.posledni_sync_kdy) s.poradi.push('cas-behu')
    },
    async zamknout(tenantId, pripojeniId) {
      if (s.zamekObsazen) return { ok: false, duvod: 'Příjem faktur z téhle schránky už běží.' }
      const behId = `beh-${s.zamky.length + 1}`
      s.zamky.push({ tenantId, pripojeniId, behId })
      return { ok: true, behId }
    },
    async odemknout(behId, vysledek) { s.odemceno.push({ behId, ...vysledek }) },
    async nactiKurzor(pripojeniId, slozka) { return s.kurzory.get(`${pripojeniId}|${slozka}`) ?? null },
    async ulozitKurzor(k) {
      s.operace.push('kurzor')
      s.kurzory.set(`${k.pripojeniId}|${k.slozka}`, { uidvalidity: k.uidvalidity, posledniUid: k.posledniUid, od: k.od })
    },
    async smazatKurzor(pripojeniId, slozka) { s.kurzory.delete(`${pripojeniId}|${slozka}`) },
    async vlozitZaznamy(radky) {
      if (s.selhat.vlozitZaznamy) throw new Error('Evidence příjmu: výpadek databáze')
      // CHECKy z migrace — jeden porušený řádek shodí celý zápis (jako v Postgresu).
      for (const r of radky) {
        const delka = (x) => (x == null ? 0 : Array.from(x).length)
        if (delka(r.predmet) > 1000 || delka(r.odesilatel) > 320 || delka(r.message_id) > 998 || delka(r.duvod) > 2000 ||
          delka(r.priloha_nazev) < 1 || delka(r.priloha_nazev) > 255 || delka(r.priloha_typ) < 1 || delka(r.priloha_typ) > 127) {
          throw new Error('new row violates check constraint')
        }
        if (JSON.stringify(r).includes('\\u0000')) throw new Error('unsupported Unicode escape sequence (22P05)')
      }
      const nove = radky.filter((r) => !s.zaznamy.some((z) => klicZaznamu(z) === klicZaznamu(r)))
      for (const r of nove) {
        s.zaznamy.push({ ...r, id: `z${++idZaznamu}`, pokusu: 0, typ_dokladu: null, zdroj_vytezeni: null, model: null, zpracovano_kdy: null })
      }
      s.operace.push(`zaznamy:${nove.length}`)
    },
    async najitPodleHashe(tenantId, hash) {
      return s.zaznamy.filter((r) => r.tenant_id === tenantId && r.priloha_hash === hash)
        .map((z) => ({ id: z.id, fakturaId: z.faktura_id, stav: z.stav, pripojeniZive: !s.mrtveSchranky.has(z.pripojeni_id) }))
    },
    async nactiKeZpracovani(pripojeniId, limit, jenIsdoc) {
      if (s.selhat.nactiKeZpracovani) throw new Error('Fronta příjmu: výpadek')
      return s.zaznamy.filter((z) => z.pripojeni_id === pripojeniId && vFronte(z) && (!jenIsdoc || z.druh === 'isdoc'))
        .slice(0, limit).map((z) => ({ ...z }))
    },
    async nactiNavrhy(pripojeniId, limit) {
      return s.zaznamy.filter((z) => z.pripojeni_id === pripojeniId && z.stav === 'navrh').slice(0, limit).map((z) => ({ ...z }))
    },
    async najitParovePdf(z) {
      const p = s.zaznamy.find((r) => r.pripojeni_id === z.pripojeni_id && r.slozka === z.slozka && r.uidvalidity === z.uidvalidity &&
        r.uid === z.uid && r.stav === 'duplicita' && r.vysledek?.k_isdoc_casti === z.priloha_cast)
      return p ? { id: p.id } : null
    },
    async aktualizovatZaznam(id, zmena) {
      if (zmena.stav === 'zapsano' && s.selhat.zmenaPoZapisu > 0) {
        s.selhat.zmenaPoZapisu--
        throw new Error('Evidence příjmu: výpadek po zápisu faktury')
      }
      if (JSON.stringify(zmena).includes('\\u0000')) throw new Error('unsupported Unicode escape sequence (22P05)')
      if (zmena.duvod != null && Array.from(zmena.duvod).length > 2000) throw new Error('new row violates check constraint')
      Object.assign(s.zaznamy.find((z) => z.id === id), zmena)
    },
    async doplnitFakturu(id, fakturaId) { s.zaznamy.find((z) => z.id === id).faktura_id = fakturaId },
    async pocetCekajicich(pripojeniId) { return s.zaznamy.filter((z) => z.pripojeni_id === pripojeniId && vFronte(z)).length },
    async pocetAiDnes(tenantId, dnes) {
      return s.ai.dnesNavic + s.zaznamy.filter((z) => z.tenant_id === tenantId && z.zdroj_vytezeni === 'ai' && (z.zpracovano_kdy ?? '') >= `${dnes}T00:00:00Z`).length
    },
    async nahratSoubor(cesta, data) {
      s.operace.push(`soubor:${cesta.slice(-12)}`)
      s.soubory.set(cesta, data) // stejná cesta = stejný obsah (otisk) — přepsání nevadí
    },
    async stahnoutSoubor(cesta) { return s.soubory.get(cesta) ?? null },
    async nactiKeKontrole(pripojeniId) {
      return s.zaznamy.filter((z) => z.pripojeni_id === pripojeniId && z.stav === 'vyzaduje_kontrolu')
        .map((z) => ({ id: z.id, duvod: z.duvod ?? null, soubor_cesta: z.soubor_cesta ?? null }))
    },
    // Jako skutečný update: jen řádky TÉHLE schránky, které jsou pořád v ruční kontrole.
    async vratitDoFronty(pripojeniId, ids, duvod) {
      s.vraceni.push({ pripojeniId, ids: [...ids], duvod })
      let n = 0
      for (const z of s.zaznamy) {
        if (z.pripojeni_id !== pripojeniId || z.stav !== 'vyzaduje_kontrolu' || !ids.includes(z.id)) continue
        // Jako skutečný update (scripts/faktury-prijem-fronta.test.mjs hlídá, že nic jiného nemění).
        Object.assign(z, { stav: 'ceka', pokusu: 0, duvod })
        n++
      }
      return n
    },
  }

  const sluzby = {
    async nactiDavku(prihlaseni, slozka, kurzor, od, limit, stahnout, konecCteniMs) {
      hodiny.ms += 1_000
      s.poradi.push('cteni')
      s.schranka.volani.push({ slozka, kurzor: { ...kurzor }, od, heslo: prihlaseni.heslo, konecCteniMs })
      if (s.schranka.chyba) throw new Error(s.schranka.chyba)
      const uidvalidity = s.schranka.uidvalidity
      const reset = kurzor.uidvalidity !== null && kurzor.uidvalidity !== uidvalidity
      const posledni = reset ? 0 : kurzor.posledniUid
      const nove = s.schranka.zpravy
        .filter((z) => z.uid > posledni && (posledni > 0 || z.prijatoKdy >= `${od}T00:00:00.000Z`))
        .sort((a, b) => a.uid - b.uid)
      const vybrane = nove.slice(0, limit)
      const vystup = []
      for (const z of vybrane) {
        const stazene = new Map()
        for (const k of z.kandidati) {
          if (k.duvodBezStazeni) continue
          if (!(await stahnout(z, k))) continue
          s.schranka.stazeno.push(`${z.uid}:${k.cast}`)
          if (z.obsah[k.cast]) stazene.set(k.cast, z.obsah[k.cast])
        }
        const bez = { ...z }
        delete bez.obsah
        vystup.push({ ...bez, stazene })
      }
      return { uidvalidity, zpravy: vystup, posledniUid: vybrane.length ? vybrane[vybrane.length - 1].uid : posledni, hotovo: nove.length <= limit, resetKurzoru: reset }
    },
    async vytezitAI(podklad, moznosti) {
      s.ai.volani.push({ podklad, moznosti, ted: hodiny.ms })
      hodiny.ms += s.ai.trvani
      return await s.ai.fn(podklad, s.ai.volani.length)
    },
    aiNastaveno() { return s.ai.klic },
    ted() { return hodiny.ms },
  }

  return { s, repo, sluzby }
}

const beh = (w, rozpocet = 50_000) => zpracovatPrijemJadro(w.repo, w.sluzby, 'p1', { konecMs: w.s.hodiny.ms + rozpocet })
const stavy = (s) => s.zaznamy.map((z) => z.stav).join(',')
const odemknutoVzdy = (s) => s.zamky.length === s.odemceno.length

// ---------------------------------------------------------------------------
console.log('\n== Brány před během: vypnuto, cizí databáze, zámek, heslo ==')
{
  const w = svet({ prijem: { zapnuto: false }, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v = await beh(w)
  ok('vypnutý příjem → přeskočeno, schránka se nečte, zámek se nebere', v.stav === 'preskoceno' && w.s.schranka.volani.length === 0 && w.s.zamky.length === 0)

  const w2 = svet({ vlastni: false, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v2 = await beh(w2)
  ok('Faktury firmy zavřené (stěhují se / nezapnuté) → chyba, schránka se nečte, zámek se nebere', v2.stav === 'chyba' && w2.s.schranka.volani.length === 0 && w2.s.zamky.length === 0)
  ok('…a schránka dostane srozumitelnou chybu (e-maily počkají)', w2.s.pripojeniZmeny.some((z) => /zavřené/.test(z.posledni_chyba ?? '') && /počká/.test(z.posledni_chyba ?? '')))

  const w3 = svet({ zamekObsazen: true, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v3 = await beh(w3)
  ok('běh už probíhá → přeskočeno, schránka se nečte', v3.stav === 'preskoceno' && w3.s.schranka.volani.length === 0)

  const w4 = svet({ heslo: null, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v4 = await beh(w4)
  ok('chybí heslo → chyba, schránka označená, nic se nečte', v4.stav === 'chyba' && w4.s.schranka.volani.length === 0 && w4.s.pripojeniZmeny.some((z) => z.stav === 'chyba'))
  ok('…a zámek se uvolní', odemknutoVzdy(w4.s) && w4.s.odemceno[0].ok === false)
}

console.log('\n== n8n už e-mail zapsal → existuje, nic se nestahuje ==')
{
  const w = svet({
    zpravy: [
      zprava(1, [pdf('FV1.pdf', 'PDF-1')], { od: 'dodavatel@example.cz', cas: '2026-09-11T08:00:00.000Z' }),
      zprava(2, [pdf('FV2.pdf', 'PDF-2')], { od: 'dodavatel@example.cz', cas: '2026-09-12T08:00:00.000Z' }),
      zprava(3, [{ nazev: 'obri.pdf', mime: 'application/pdf', druh: 'pdf', duvodBezStazeni: 'Příloha je větší než 10 MB.' }], { od: 'jiny@example.cz', cas: '2026-09-13T08:00:00.000Z' }),
    ],
    faktury: [
      { email_sender: 'Dodavatel@Example.CZ', received_at: '2026-09-11T08:04:00.000Z', invoice_number: 'N8N-1' },
      { email_sender: 'dodavatel@example.cz', received_at: '2026-09-12T08:15:00.000Z', invoice_number: 'N8N-2' },
      { email_sender: 'jiny@example.cz', received_at: '2026-09-13T08:01:00.000Z', invoice_number: 'N8N-3' },
    ],
  })
  const v = await beh(w)
  const z1 = w.s.zaznamy.find((z) => z.uid === 1)
  const z2 = w.s.zaznamy.find((z) => z.uid === 2)
  const z3 = w.s.zaznamy.find((z) => z.uid === 3)
  ok('zpráva v okně ±10 min od stejného odesílatele → existuje s id faktury', z1?.stav === 'existuje' && z1.faktura_id === 'inv-puvodni-0')
  ok('…její příloha se nestáhla ani neuložila', !w.s.schranka.stazeno.includes('1:2') && z1.soubor_cesta === null)
  ok('zpráva 15 min mimo okno se zpracuje normálně (AI)', z2?.stav === 'zapsano' && w.s.schranka.stazeno.includes('2:2'))
  ok('příliš velká příloha, kterou n8n zapsal → existuje, ne ke kontrole', z3?.stav === 'existuje' && z3.faktura_id === 'inv-puvodni-2')
  ok('počty: 2× existuje, 1× zapsáno', v.existuje === 2 && v.zapsano === 1)
}

console.log('\n== AI vypnutá: ISDOC se zapíše, PDF čeká na souhlas ==')
{
  const w = svet({
    prijem: { zapnuto: true, ai: { povoleno: false } },
    zpravy: [zprava(1, [pdf('sken.pdf', 'PDF-1')]), zprava(2, [isdoc('FV2026-0815.isdoc', isdocXml())])],
  })
  const v = await beh(w)
  const z1 = w.s.zaznamy.find((z) => z.uid === 1)
  const z2 = w.s.zaznamy.find((z) => z.uid === 2)
  ok('PDF: řádek čeká, s důvodem o AI', z1?.stav === 'ceka' && /AI/.test(z1.duvod ?? ''))
  ok('PDF je uložené v úložišti (po zapnutí AI se nebude stahovat znovu)', z1.soubor_cesta && w.s.soubory.has(z1.soubor_cesta))
  ok('AI se nevolala', w.s.ai.volani.length === 0)
  ok('ISDOC zapsaný do Faktur bez AI', z2?.stav === 'zapsano' && z2.zdroj_vytezeni === 'isdoc' && w.s.faktury.length === 1)
  const f = w.s.faktury[0]
  ok('řádek faktury: číslo, IČO, částka k úhradě, odkaz na přílohu v appce', f.invoice_number === 'FV2026-0815' && f.supplier_ico === ICO_DODAVATELE && f.amount === 12100.5 && f.pdf_url === `/api/faktury/priloha/${z2.id}`)
  ok('čistý ISDOC jde do „Ke kontrole úhrady"', f.status === 'Ke kontrole úhrady' && f.needs_review === false)

  const wa = svet({ prijem: { zapnuto: true, ai: { povoleno: false } }, zpravy: [zprava(2, [isdoc('FV.isdoc', isdocXml())])] })
  wa.sluzby.zakladOdkazu = 'https://app.foodtab.cz'
  await beh(wa)
  ok('se známou adresou appky je odkaz absolutní (CSV pro účetní)', wa.s.faktury[0]?.pdf_url === `https://app.foodtab.cz/api/faktury/priloha/${wa.s.zaznamy[0].id}`)
  ok('zbývá 1 (PDF čeká), výsledek ok', v.stav === 'ok' && v.zbyva === 1 && v.zapsano === 1)

  // Souhlas s AI → další běh PDF přečte, nic nového ze schránky.
  w.s.pripojeni.externiUcet.prijem_dokladu = { zapnuto: true, ai: { povoleno: true } }
  const v2 = await beh(w)
  ok('po zapnutí AI: PDF přečtené a zapsané, AI volaná jednou', z1.stav === 'zapsano' && w.s.ai.volani.length === 1 && w.s.faktury.length === 2 && v2.zapsano === 1)
  ok('AI dostala PDF s typem a předmětem e-mailu', w.s.ai.volani[0].podklad.mime === 'application/pdf' && w.s.ai.volani[0].podklad.predmet === 'Faktura 1')
}

console.log('\n== Pořadí soubory → evidence → kurzor; idempotence ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'PDF-A')]), zprava(2, [pdf('b.pdf', 'PDF-B')])] })
  await beh(w)
  const o = w.s.operace
  const iZaznamy = o.findIndex((x) => x.startsWith('zaznamy:'))
  const iKurzor = o.indexOf('kurzor')
  ok('všechny soubory před evidencí, evidence před kurzorem', iZaznamy > 0 && o.slice(0, iZaznamy).every((x) => x.startsWith('soubor:')) && iKurzor > iZaznamy)
  ok('kurzor na poslední zprávě', w.s.kurzory.get('p1|INBOX')?.posledniUid === 2 && w.s.kurzory.get('p1|INBOX')?.uidvalidity === '100')
  const pocetFaktur = w.s.faktury.length
  await beh(w)
  ok('druhý běh: schránka čtená od kurzoru, nic se nezdvojilo', w.s.schranka.volani[w.s.schranka.volani.length - 1].kurzor.posledniUid === 2 && w.s.faktury.length === pocetFaktur && w.s.zaznamy.length === 2)

  // Výpadek evidence: kurzor se NESMÍ posunout, příště se načte znovu.
  const w2 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'PDF-A')])] })
  w2.s.selhat.vlozitZaznamy = true
  const v = await beh(w2)
  ok('výpadek evidence → kurzor neuložený', !w2.s.kurzory.has('p1|INBOX') && !w2.s.operace.includes('kurzor'))
  ok('…schránka „vyžaduje pozornost" a výsledek nese důvod', w2.s.pripojeniZmeny.some((z) => z.stav === 'vyzaduje_pozornost') && /přečíst/.test(v.duvod ?? ''))
  ok('…zámek uvolněn', odemknutoVzdy(w2.s))
  w2.s.selhat.vlozitZaznamy = false
  await beh(w2)
  ok('opravený běh načte zprávu znovu a zapíše ji jednou (soubor přepsaný stejným obsahem)', w2.s.zaznamy.length === 1 && w2.s.zaznamy[0].stav === 'zapsano' && w2.s.faktury.length === 1)
}

console.log('\n== Duplicity: stejný soubor v dávce i později ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'STEJNE')]), zprava(2, [pdf('a-kopie.pdf', 'STEJNE')])] })
  await beh(w)
  ok('stejný obsah ve dvou zprávách jedné dávky → druhá duplicita, AI jednou', stavy(w.s) === 'zapsano,duplicita' && w.s.ai.volani.length === 1 && w.s.faktury.length === 1)
  ok('duplicita nemá vlastní soubor', w.s.zaznamy[1].soubor_cesta === null)
  w.s.schranka.zpravy.push(zprava(3, [pdf('preposlano.pdf', 'STEJNE')], { od: 'kolega@example.cz' }))
  await beh(w)
  const z3 = w.s.zaznamy.find((z) => z.uid === 3)
  ok('přeposlaná kopie v dalším běhu → duplicita s odkazem na fakturu', z3?.stav === 'duplicita' && z3.faktura_id === w.s.faktury[0].id && w.s.faktury.length === 1)
}

console.log('\n== ISDOC + PDF v jednom e-mailu ==')
{
  const w = svet({ zpravy: [zprava(1, [isdoc('FV2026-0815.isdoc', isdocXml()), pdf('FV2026-0815.pdf', 'PDF-K-ISDOC')])] })
  await beh(w)
  const zi = w.s.zaznamy.find((z) => z.druh === 'isdoc')
  const zp = w.s.zaznamy.find((z) => z.druh === 'pdf')
  ok('čte se ISDOC, AI se nevolá', zi?.stav === 'zapsano' && w.s.ai.volani.length === 0)
  ok('PDF je spárované (duplicita s k_isdoc_casti) a uložené', zp?.stav === 'duplicita' && zp.vysledek?.k_isdoc_casti === zi.priloha_cast && w.s.soubory.has(zp.soubor_cesta))
  ok('faktura odkazuje na čitelné PDF, PDF zná svou fakturu', w.s.faktury[0].pdf_url === `/api/faktury/priloha/${zp.id}` && zp.faktura_id === zi.faktura_id)

  // faktura.xml v JINÉM formátu + faktura.pdf: PDF se nesmí „schovat".
  const w2 = svet({ zpravy: [zprava(1, [isdoc('faktura.xml', '<?xml version="1.0"?><dataPack xmlns="http://www.stormware.cz/schema/version_2/data.xsd"/>'), pdf('faktura.pdf', 'PDF-POHODA')])] })
  await beh(w2)
  ok('XML, které není ISDOC → není doklad; PDF se přečte přes AI a zapíše', stavy(w2.s) === 'neni_doklad,zapsano' && w2.s.ai.volani.length === 1 && w2.s.faktury.length === 1)

  // ISDOC podle obsahu, ale nečitelný → přečte se PDF, člověk nic nedostane.
  const rozbity = isdocXml().replace('<ID>FV2026-0815</ID>', '<ID>FV2026-0815')
  const w3 = svet({ zpravy: [zprava(1, [isdoc('FV.isdoc', rozbity), pdf('FV.pdf', 'PDF-ZALOHA')])] })
  await beh(w3)
  const ri = w3.s.zaznamy.find((z) => z.druh === 'isdoc')
  const rp = w3.s.zaznamy.find((z) => z.druh === 'pdf')
  ok('nečitelný ISDOC se spárovaným PDF → PDF přečtené AI a zapsané, ISDOC jen poznámka', rp?.stav === 'zapsano' && ri?.stav === 'duplicita' && w3.s.faktury.length === 1)
}

console.log('\n== Stejný doklad ve Fakturách / opravný doklad ==')
{
  const w = svet({
    zpravy: [zprava(1, [isdoc('FV2026-0815.isdoc', isdocXml())]), zprava(2, [isdoc('FV2026-0900.isdoc', isdocXml({ cislo: 'FV2026-0900', castka: '500.00' }))])],
    faktury: [
      { invoice_number: 'FV2026-0815', supplier_ico: ICO_DODAVATELE, supplier: 'Velkoobchod s.r.o.', amount: 12100.5, received_at: '2026-08-01T00:00:00.000Z' },
      { invoice_number: 'FV2026-0900', supplier_ico: ICO_DODAVATELE, supplier: 'Velkoobchod s.r.o.', amount: 400, received_at: '2026-08-01T00:00:00.000Z' },
    ],
  })
  await beh(w)
  const z1 = w.s.zaznamy.find((z) => z.uid === 1)
  const z2 = w.s.zaznamy.find((z) => z.uid === 2)
  ok('stejné číslo, dodavatel a částka → existuje, nic se nezapíše', z1?.stav === 'existuje' && z1.faktura_id === 'inv-puvodni-0')
  const nova = w.s.faktury.find((f) => f.invoice_number === 'FV2026-0900' && f.amount === 500)
  ok('stejné číslo, jiná částka → zapíše se, ale ke schválení s poznámkou', z2?.stav === 'zapsano' && nova?.status === 'Ke schválení' && /opravný/.test(nova.review_note ?? ''))
}

console.log('\n== Režim náhled: návrh, pak zápis člověkem ==')
{
  const w = svet({ prijem: { zapnuto: true, rezim: 'nahled', ai: { povoleno: true } }, zpravy: [zprava(1, [isdoc('FV.isdoc', isdocXml())])] })
  await beh(w)
  ok('náhled → návrh, do Faktur nic', w.s.zaznamy[0].stav === 'navrh' && w.s.faktury.length === 0)
  w.s.vlastni = 'kazdy'
  const cizi = await zapsatNavrhyJadro(w.repo, 'p1', CIZI_FIRMA, () => w.s.hodiny.ms, Infinity)
  w.s.vlastni = true
  ok('cizí firma návrhy cizí schránky nezapíše (i kdyby jí brána Faktur pustila)', cizi.zapsano === 0 && w.s.faktury.length === 0)
  const r = await zapsatNavrhyJadro(w.repo, 'p1', FIRMA, () => w.s.hodiny.ms, Infinity)
  ok('člověk potvrdí → zapsáno jednou', r.zapsano === 1 && w.s.zaznamy[0].stav === 'zapsano' && w.s.faktury.length === 1)
  const r2 = await zapsatNavrhyJadro(w.repo, 'p1', FIRMA, () => w.s.hodiny.ms, Infinity)
  ok('druhé potvrzení nic nezdvojí', r2.zapsano === 0 && w.s.faktury.length === 1)
}

console.log('\n== Chyby AI: přechodná, trvalá, bez klíče, strop, čas ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')]), zprava(2, [pdf('b.pdf', 'B')])], ai: () => ({ stav: 'chyba', duvod: 'AI je přetížená.', docasna: true }) })
  await beh(w)
  const z1 = w.s.zaznamy[0]
  ok('přechodná chyba → řádek „chyba", pokus 1, AI se v běhu dál nevolá', z1.stav === 'chyba' && z1.pokusu === 1 && w.s.ai.volani.length === 1)
  for (let i = 0; i < MAX_POKUSU + 2; i++) await beh(w)
  ok(`po ${MAX_POKUSU} pokusech → ruční kontrola, žádný další pokus`, w.s.zaznamy.every((z) => z.stav === 'vyzaduje_kontrolu' && z.pokusu === MAX_POKUSU) && w.s.ai.volani.length === 2 * MAX_POKUSU)

  const w2 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'chyba', duvod: 'Soubor je poškozený.', docasna: false }) })
  await beh(w2)
  ok('trvalá chyba → rovnou ruční kontrola', w2.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w2.s.zaznamy[0].pokusu === 1)

  const w3 = svet({ aiKlic: false, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v3 = await beh(w3)
  ok('souhlas s AI, ale chybí klíč → AI se nevolá, PDF čeká, důvod zmiňuje klíč', w3.s.ai.volani.length === 0 && w3.s.zaznamy[0].stav === 'ceka' && /ANTHROPIC_API_KEY/.test(v3.duvod ?? ''))

  const w4 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'bez_klice' }) })
  await beh(w4)
  ok('AI vrátí „bez klíče" → řádek dál čeká (žádná ukázka místo faktury)', w4.s.zaznamy[0].stav === 'ceka' && w4.s.faktury.length === 0)

  const w5 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')]), zprava(2, [isdoc('FV.isdoc', isdocXml())])] })
  w5.s.ai.dnesNavic = AI_LIMIT_ZA_DEN
  const v5 = await beh(w5)
  ok(`denní strop ${AI_LIMIT_ZA_DEN} → AI se nevolá, ISDOC se zapíše dál`, w5.s.ai.volani.length === 0 && w5.s.zaznamy.find((z) => z.uid === 2)?.stav === 'zapsano' && /strop/.test(v5.duvod ?? ''))

  const w6 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  await beh(w6, 24_000)
  ok('zbývá míň než 25 s → AI se nezačne, řádek čeká na další běh', w6.s.ai.volani.length === 0 && w6.s.zaznamy[0].stav === 'ceka')

  const w7 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const konec = w7.s.hodiny.ms + 50_000
  await zpracovatPrijemJadro(w7.repo, w7.sluzby, 'p1', { konecMs: konec })
  const volani = w7.s.ai.volani[0]
  ok('časový limit AI nepřesáhne zbytek běhu', volani && volani.ted + volani.moznosti.casovyLimitMs <= konec)

  const w8 = svet({ zpravy: [zprava(1, [pdf('newsletter.pdf', 'A')])], ai: () => ({ stav: 'ok', doklad: dokladAI(null, null, { typ: 'neni_doklad' }), model: 'm', verze: 'v' }) })
  await beh(w8)
  ok('AI pozná, že to není doklad → není doklad, do Faktur nic', w8.s.zaznamy[0].stav === 'neni_doklad' && w8.s.faktury.length === 0)
}

console.log('\n== Chyba ÚČTU AI (kredit, klíč) není vada dokladu ==')
{
  // 9.–25. 10. 2026: AI vracela „credit balance is too low" a „Klíč k AI neplatí"
  // a kód každou přílohu poslal do ruční kontroly — 1 011 příloh, které nikdo neviděl.
  const KREDIT = 'AI teď nejde použít: na účtu u Anthropicu došel kredit (Plans & Billing). Doklady počkají a přečtou se samy, až se kredit doplní.'
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')]), zprava(2, [pdf('b.pdf', 'B')])], ai: () => ({ stav: 'ucet', duvod: KREDIT }) })
  const v = await beh(w)
  ok('chyba účtu → AI se v běhu zavolá jen jednou', w.s.ai.volani.length === 1)
  ok('…obě přílohy dál čekají ve frontě, pokus se nepočítá', w.s.zaznamy.length === 2 && w.s.zaznamy.every((z) => z.stav === 'ceka' && z.pokusu === 0))
  ok('…běh hlásí aiNedostupne a důvod o kreditu', v.aiNedostupne === true && /kredit/.test(v.duvod ?? ''))
  ok('…důvod je u schránky (Integrace → E-mail)', w.s.pripojeniZmeny.some((z) => /kredit/.test(z.posledni_chyba ?? '')))
  ok('…nezapočítá se do denního stropu AI', (await w.repo.pocetAiDnes(FIRMA, '2026-10-08')) === 0)
  for (let i = 0; i < 2 * MAX_POKUSU + 4; i++) await beh(w)
  ok(`ani po ${2 * MAX_POKUSU + 5} bězích nic nespadne do ruční kontroly`, w.s.zaznamy.every((z) => z.stav === 'ceka' && z.pokusu === 0) && w.s.faktury.length === 0)
  ok('…a každý běh zkusí AI jen jednou (nevolá ji pro každou přílohu)', w.s.ai.volani.length === 2 * MAX_POKUSU + 5)
  w.s.ai.fn = (podklad, n) => ({ stav: 'ok', doklad: dokladAI(`AI-${n}`, 1000 + n), model: 'claude-opus-5-5', verze: 'faktura-v1' })
  const v2 = await beh(w)
  ok('kredit se doplní → další běh obě přílohy přečte a zapíše', w.s.zaznamy.every((z) => z.stav === 'zapsano') && w.s.faktury.length === 2)
  ok('…a už nehlásí aiNedostupne', v2.aiNedostupne !== true)

  // Řádek s dřívějším přechodným pokusem (dnes, už zaplacený): chyba účtu mu ho nesmaže.
  let n = 0
  const w2 = svet({
    zpravy: [zprava(1, [pdf('a.pdf', 'A')])],
    ai: () => (++n === 1 ? { stav: 'chyba', duvod: 'AI je přetížená.', docasna: true } : { stav: 'ucet', duvod: KREDIT }),
  })
  await beh(w2)
  ok('přechodná chyba → pokus 1, počítá se do stropu', w2.s.zaznamy[0].pokusu === 1 && (await w2.repo.pocetAiDnes(FIRMA, '2026-10-08')) === 1)
  await beh(w2)
  ok('pak chyba účtu → pořád pokus 1, stav chyba (ve frontě)', w2.s.zaznamy[0].stav === 'chyba' && w2.s.zaznamy[0].pokusu === 1)
  ok('…a dřívější útrata zůstane v denním stropu', (await w2.repo.pocetAiDnes(FIRMA, '2026-10-08')) === 1)

  const w3 = svet({ aiKlic: false, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v3 = await beh(w3)
  ok('AI povolená, ale bez klíče → aiNedostupne', v3.aiNedostupne === true)

  const w4 = svet({ prijem: { zapnuto: true, ai: { povoleno: false } }, aiKlic: false, zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v4 = await beh(w4)
  ok('AI u schránky vypnutá (jen ISDOC) → žádný poplach', v4.aiNedostupne !== true)

  const w5 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  const v5 = await beh(w5)
  ok('všechno v pořádku → žádný poplach', v5.aiNedostupne !== true && w5.s.zaznamy[0].stav === 'zapsano')

  const w6 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'chyba', duvod: 'Soubor je poškozený.', docasna: false }) })
  const v6 = await beh(w6)
  ok('vadný doklad (trvalá chyba) → ruční kontrola, ale ne poplach o AI', w6.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && v6.aiNedostupne !== true)
}

console.log('\n== Přečíst znovu: jen přílohy, které nepřečetla chyba účtu nebo zápisu ==')
{
  // Přesně texty z produkce (10. 11. 2026), ne přepsané.
  const HIST = {
    kredit: 'AI soubor nepřijala (chyba 400): Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    klic: 'Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.',
    zapis: 'Zápis do Faktur se nepodařil: Faktury (zápis): cannot insert a non-DEFAULT value into column "needs_review"',
    heslo: 'AI soubor nepřijala (chyba 400): messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected.',
  }
  const zpravy = [1, 2, 3, 4, 5, 6].map((uid) => zprava(uid, [pdf(`f${uid}.pdf`, `obsah-${uid}`)]))
  const w = svet({ zpravy, aiTrvani: 100, ai: () => ({ stav: 'chyba', duvod: 'docasne', docasna: false }) })
  await beh(w)
  ok('příprava: šest příloh v ruční kontrole, všechny se souborem', w.s.zaznamy.length === 6 && w.s.zaznamy.every((z) => z.stav === 'vyzaduje_kontrolu' && z.soubor_cesta))
  const [zKredit, zKlic, zZapis, zHeslo, zBezSouboru, zCizi] = w.s.zaznamy
  zKredit.duvod = HIST.kredit
  zKlic.duvod = HIST.klic
  zZapis.duvod = HIST.zapis
  zHeslo.duvod = HIST.heslo
  zBezSouboru.duvod = HIST.kredit
  zBezSouboru.soubor_cesta = null
  zCizi.duvod = HIST.kredit
  zCizi.pripojeni_id = 'p2'

  // Brána Faktur pustí každou firmu — jinak by cizí firmu odchytila ona
  // a kontrola vlastníka schránky by se neověřila (rozbití to ukázalo).
  w.s.vlastni = 'kazdy'
  const cizi = await vratitDoFrontyJadro(w.repo, 'p1', CIZI_FIRMA)
  w.s.vlastni = true
  ok('cizí firma nic nevrátí a dostane důvod (i když jí brána Faktur pustí)', cizi.vraceno === 0 && /neexistuje|odpojená/.test(cizi.duvod ?? '') && w.s.vraceni.length === 0)
  w.s.pripojeni.odpojeno = true
  const odpojena = await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  w.s.pripojeni.odpojeno = false
  ok('odpojená schránka nic nevrátí', odpojena.vraceno === 0 && w.s.vraceni.length === 0)
  w.s.vlastni = false
  const zavrene = await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  w.s.vlastni = true
  ok('Faktury firmy zavřené → nic nevrátí', zavrene.vraceno === 0 && /zavřené/.test(zavrene.duvod ?? '') && w.s.vraceni.length === 0)

  const r = await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  ok('vrátí přesně 3 (kredit, klíč, zápis)', r.vraceno === 3 && r.duvod === null)
  ok('…do úložiště jdou jen jejich id', JSON.stringify(w.s.vraceni.at(-1)?.ids) === JSON.stringify([zKredit.id, zKlic.id, zZapis.id]))
  ok('…jsou zpátky ve frontě s nulou pokusů a novým důvodem', [zKredit, zKlic, zZapis].every((z) => z.stav === 'ceka' && z.pokusu === 0 && z.duvod === DUVOD_VRACENI))
  const strop = await w.repo.pocetAiDnes(FIRMA, '2026-10-08')
  ok(`…a dnešní útrata ve stropu AI zůstane (${strop} = 6 přečtení dnes), kliknutí ji nevynuluje`, strop === 6)
  ok('PDF s heslem zůstane v ruční kontrole s původním důvodem', zHeslo.stav === 'vyzaduje_kontrolu' && zHeslo.duvod === HIST.heslo)
  ok('příloha bez uloženého souboru zůstane (nebylo by co číst)', zBezSouboru.stav === 'vyzaduje_kontrolu')
  ok('příloha jiné schránky zůstane', zCizi.stav === 'vyzaduje_kontrolu')

  const znovu = await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  ok('druhé kliknutí nic dalšího nevrátí', znovu.vraceno === 0 && znovu.duvod === null)

  w.s.ai.fn = (podklad, n) => ({ stav: 'ok', doklad: dokladAI(`ZNOVU-${n}`, 2000 + n), model: 'claude-opus-5-5', verze: 'faktura-v1' })
  // Kontrolní vzorek: nový e-mail se stejně dobrým dokladem — ten jde rovnou ke kontrole úhrady.
  w.s.schranka.zpravy.push(zprava(7, [pdf('f7.pdf', 'obsah-7')]))
  const pred = w.s.ai.volani.length
  await beh(w)
  ok('další běh vrácené přečte a zapíše do Faktur', [zKredit, zKlic, zZapis].every((z) => z.stav === 'zapsano') && w.s.faktury.length === 4)
  ok('…a ostatní nečte (AI jen pro 3 vrácené a 1 nový)', w.s.ai.volani.length - pred === 4 && zHeslo.stav === 'vyzaduje_kontrolu')
  // Vrácené ležely v ruční kontrole týdny — mezitím je mohl někdo zadat ručně.
  const fakturaZ = (z) => w.s.faktury.find((f) => f.id === z.faktura_id)
  ok('vrácené jdou do Faktur KE SCHVÁLENÍ s důvodem (možná už zadané ručně), ne rovnou k úhradě',
    [zKredit, zKlic, zZapis].every((z) => fakturaZ(z)?.status === STAV_KE_SCHVALENI && (fakturaZ(z)?.review_note ?? '').includes(DUVOD_KONTROLY_VRACENI)))
  const nova = w.s.zaznamy.find((z) => z.uid === 7)
  ok('…kdežto nový e-mail se stejně dobrým dokladem jde ke kontrole úhrady bez té poznámky',
    nova?.stav === 'zapsano' && fakturaZ(nova)?.status === STAV_KE_KONTROLE && !(fakturaZ(nova)?.review_note ?? '').includes(DUVOD_KONTROLY_VRACENI))
}

console.log('\n== Vrácená příloha: značka přežije přechodnou chybu ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], aiTrvani: 100, ai: () => ({ stav: 'ucet', duvod: 'AI teď nejde použít: test.' }) })
  await beh(w)
  const z = w.s.zaznamy[0]
  Object.assign(z, { stav: 'vyzaduje_kontrolu', duvod: 'Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.' })
  await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  w.s.ai.fn = () => ({ stav: 'chyba', duvod: 'AI je přetížená.', docasna: true })
  await beh(w)
  ok('příprava: vrácená, pak přechodná chyba přepsala důvod', z.stav === 'chyba' && z.duvod === 'AI je přetížená.')
  w.s.ai.fn = (p, n) => ({ stav: 'ok', doklad: dokladAI(`PRETIZENA-${n}`, 4000 + n), model: 'm', verze: 'v' })
  await beh(w)
  ok('…a stejně jde ke schválení (značka ve výsledku, ne jen v důvodu)', z.stav === 'zapsano' && w.s.faktury.find((f) => f.id === z.faktura_id)?.status === STAV_KE_SCHVALENI)
}

console.log('\n== Nepovedený zápis: přečtený doklad se zapíše znovu, AI se neplatí podruhé ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], aiTrvani: 100 })
  w.s.selhat.fakturaVlozit = 1
  await beh(w)
  const z = w.s.zaznamy[0]
  ok('příprava: AI přečetla (1×), zápis selhal → chyba s uloženým dokladem', w.s.ai.volani.length === 1 && z.stav === 'chyba' && z.vysledek?.doklad?.cisloDokladu === 'AI-1')
  await beh(w)
  ok('další běh zapíše uložený doklad bez nového čtení', z.stav === 'zapsano' && w.s.faktury.length === 1 && w.s.ai.volani.length === 1)

  // Trvale nefunkční zápis → ruční kontrola → Přečíst znovu: pořád žádné nové čtení.
  w.s.schranka.zpravy.push(zprava(2, [pdf('b.pdf', 'B')]))
  w.s.selhat.fakturaVlozit = 99
  for (let i = 0; i < MAX_POKUSU + 1; i++) await beh(w)
  const z2 = w.s.zaznamy[1]
  ok(`po ${MAX_POKUSU} nepovedených zápisech ruční kontrola, AI čtená jednou`, z2.stav === 'vyzaduje_kontrolu' && /^Zápis do Faktur se nepodařil/.test(z2.duvod ?? '') && w.s.ai.volani.length === 2)
  const vraceno = await vratitDoFrontyJadro(w.repo, 'p1', FIRMA)
  w.s.selhat.fakturaVlozit = 0
  await beh(w)
  ok('Přečíst znovu → zapíše se uložený doklad, AI pořád jen 2× celkem, ke schválení',
    vraceno.vraceno === 1 && z2.stav === 'zapsano' && w.s.ai.volani.length === 2 && w.s.faktury.find((f) => f.id === z2.faktura_id)?.status === STAV_KE_SCHVALENI)
}

console.log('\n== Neznámé odmítnutí souboru: když AI odmítá každý soubor stejně, je to poplach ==')
{
  // Nezávislá kontrola 10. 11. 2026: vyřazený model nebo nový tvar dotazu by
  // (bez téhle pojistky) poslal do ruční kontroly celou frontu, s workflow
  // zeleným — tedy 9.–25. 10. 2026 znovu.
  const ODM = { stav: 'chyba', duvod: 'AI soubor nepřijala (chyba 400): output_config.effort: Extra inputs are not permitted', docasna: false, odmitnuti: '400: output_config.effort: Extra inputs are not permitted' }
  const ODM2 = { stav: 'chyba', duvod: 'AI soubor nepřijala (chyba 400): The PDF specified was not valid.', docasna: false, odmitnuti: '400: The PDF specified was not valid.' }
  const ctyri = () => [1, 2, 3, 4].map((uid) => zprava(uid, [pdf(`f${uid}.pdf`, `obsah-${uid}`)]))
  const ctiOk = (p, n) => ({ stav: 'ok', doklad: dokladAI(`OK-${n}`, 5000 + n), model: 'm', verze: 'v' })

  const w = svet({ zpravy: ctyri(), aiTrvani: 100, ai: () => ({ ...ODM }) })
  const v = await beh(w)
  const [a, b, c, d] = w.s.zaznamy
  ok('dvě přílohy za sebou odmítnuté stejně → AI se zastaví (2 volání ze 4)', w.s.ai.volani.length === 2)
  ok('…nic v ruční kontrole', w.s.zaznamy.every((z) => z.stav !== 'vyzaduje_kontrolu') && v.kontrola === 0)
  ok('…poplach aiNedostupne, důvod u schránky', v.aiNedostupne === true && w.s.pripojeniZmeny.some((z) => /odmítá každý soubor/.test(z.posledni_chyba ?? '')))
  ok('…první si pokus nechá (chyba, 1), druhá ho vrátí (čeká, 0), zbylé nedotčené',
    a.stav === 'chyba' && a.pokusu === 1 && b.stav === 'ceka' && b.pokusu === 0 && c.pokusu === 0 && d.pokusu === 0)
  for (let i = 0; i < MAX_POKUSU; i++) await beh(w)
  ok(`za ${MAX_POKUSU + 1} běhů v ruční kontrole jen jedna (fronta se nezasekne, ale ani nevysype)`, w.s.zaznamy.filter((z) => z.stav === 'vyzaduje_kontrolu').length === 1)
  w.s.ai.fn = ctiOk
  const v2 = await beh(w)
  ok('po opravě se zbylé tři přečtou a zapíšou, bez poplachu', w.s.zaznamy.filter((z) => z.stav === 'zapsano').length === 3 && v2.aiNedostupne !== true)

  const w2 = svet({ zpravy: ctyri().slice(0, 2), aiTrvani: 100, ai: (p, n) => (n === 1 ? { ...ODM } : ctiOk(p, n)) })
  const v3 = await beh(w2)
  ok('odmítnutá, pak přečtená → první byla vadná sama: ruční kontrola s důvodem od AI, bez poplachu',
    w2.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w2.s.zaznamy[0].duvod === ODM.duvod && w2.s.zaznamy[1].stav === 'zapsano' && v3.kontrola === 1 && v3.aiNedostupne !== true)

  const w3 = svet({ zpravy: ctyri().slice(0, 2), aiTrvani: 100, ai: (p, n) => (n === 1 ? { ...ODM } : { ...ODM2 }) })
  const v4 = await beh(w3)
  ok('dvě odmítnutí s RŮZNÝM důvodem → první do ruční kontroly, druhá čeká na srovnání, bez poplachu',
    w3.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w3.s.zaznamy[1].stav === 'chyba' && v4.aiNedostupne !== true)

  const w4 = svet({ zpravy: ctyri().slice(0, 1), aiTrvani: 100, ai: () => ({ ...ODM }) })
  await beh(w4)
  ok('jediná odmítnutá příloha (není s čím srovnat) → příště znovu, ne hned ruční kontrola', w4.s.zaznamy[0].stav === 'chyba' && w4.s.zaznamy[0].pokusu === 1)
  for (let i = 0; i < MAX_POKUSU; i++) await beh(w4)
  ok(`…po ${MAX_POKUSU} pokusech ruční kontrola s důvodem od AI, AI volaná ${MAX_POKUSU}×`,
    w4.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w4.s.zaznamy[0].duvod === ODM.duvod && w4.s.ai.volani.length === MAX_POKUSU)

  const w5 = svet({ zpravy: ctyri().slice(0, 2), aiTrvani: 100, ai: () => ({ stav: 'chyba', duvod: 'Soubor je poškozený.', docasna: false }) })
  await beh(w5)
  ok('trvalá chyba BEZ podpisu odmítnutí (nečitelná odpověď) → rovnou ruční kontrola jako dřív', w5.s.zaznamy.every((z) => z.stav === 'vyzaduje_kontrolu'))
}

console.log('\n== Důvod u schránky: nefunkční AI má přednost, schránka nezmizí ==')
{
  const KREDIT = 'AI teď nejde použít: na účtu u Anthropicu došel kredit (Plans & Billing). Doklady počkají a přečtou se samy, až se kredit doplní.'
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], aiTrvani: 100, ai: () => ({ stav: 'ucet', duvod: KREDIT }) })
  await beh(w)
  w.s.schranka.chyba = 'connect ETIMEDOUT'
  const v = await beh(w)
  ok('schránka nedostupná a AI bez kreditu → důvod začíná AI a obsahuje i schránku',
    (v.duvod ?? '').startsWith(KREDIT) && /Schránku se nepodařilo přečíst: connect ETIMEDOUT/.test(v.duvod ?? '') && w.s.pripojeniZmeny.at(-1)?.posledni_chyba === v.duvod)
}

console.log('\n== lzeZkusitZnovu: produkční texty ==')
{
  for (const [popis, duvod] of [
    ['kredit (400, 9.–13. 10.)', 'AI soubor nepřijala (chyba 400): Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'],
    ['neplatný klíč (14.–25. 10.)', 'Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru.'],
    ['nový text: klíč', 'Klíč k AI neplatí — zkontrolujte ANTHROPIC_API_KEY na serveru. Doklady počkají a přečtou se samy, až bude klíč v pořádku.'],
    ['nový text: oprávnění', 'Klíč k AI nemá oprávnění (chyba 403) — zkontrolujte účet u Anthropicu. Doklady počkají a přečtou se samy.'],
    ['nový text: kredit', 'AI teď nejde použít: na účtu u Anthropicu došel kredit (Plans & Billing). Doklady počkají a přečtou se samy, až se kredit doplní.'],
    ['starý 403', 'AI soubor nepřijala (chyba 403): forbidden'],
    ['limit útraty (400)', 'AI soubor nepřijala (chyba 400): You have reached your specified API usage limits.'],
    ['zápis do Faktur (9. 10.)', 'Zápis do Faktur se nepodařil: Faktury (zápis): cannot insert a non-DEFAULT value into column "needs_review"'],
  ]) ok(`ano — ${popis}`, lzeZkusitZnovu(duvod) === true)

  for (const [popis, duvod] of [
    ['PDF s heslem', 'AI soubor nepřijala (chyba 400): messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected.'],
    ['vadné PDF', 'AI soubor nepřijala (chyba 400): The PDF specified was not valid.'],
    ['„billing" v textu chyby o souboru', 'AI soubor nepřijala (chyba 400): The image mentions a billing address and was rejected.'],
    ['ISDOCX', 'Formát ISDOCX (zabalené ISDOC) appka zatím neumí přečíst — zkontrolujte přílohu ručně.'],
    ['moc velká příloha', 'Příloha má 17,1 MB, appka stahuje nejvýš 10,0 MB — zkontrolujte ji ručně.'],
    ['opakovaně nedoběhlo', 'Zpracování se opakovaně nedokončilo (vypršel čas nebo výpadek) — zkontrolujte přílohu ručně.'],
    ['přetížení po 3 pokusech', 'AI je přetížená.'],
    ['text uprostřed (ne na začátku)', 'Poznámka: Klíč k AI neplatí'],
    ['prázdný text', ''],
    ['null', null],
    ['undefined', undefined],
  ]) ok(`ne — ${popis}`, lzeZkusitZnovu(duvod) === false)
}

console.log('\n== Výpadek databáze Faktur při zápisu ==')
{
  const w = svet({ zpravy: [zprava(1, [isdoc('FV.isdoc', isdocXml())])] })
  w.s.selhat.fakturaVlozit = 1
  await beh(w)
  ok('nepovedený zápis → „chyba", pokus 1, nic zapsané', w.s.zaznamy[0].stav === 'chyba' && w.s.zaznamy[0].pokusu === 1 && w.s.faktury.length === 0)
  await beh(w)
  ok('další běh to zkusí znovu a zapíše jednou', w.s.zaznamy[0].stav === 'zapsano' && w.s.faktury.length === 1)
  w.s.selhat.fakturaVlozit = 99
  w.s.schranka.zpravy.push(zprava(2, [isdoc('FV2.isdoc', isdocXml({ cislo: 'FV-2' }))]))
  for (let i = 0; i < MAX_POKUSU + 1; i++) await beh(w)
  ok(`trvalý výpadek → po ${MAX_POKUSU} pokusech ruční kontrola`, w.s.zaznamy[1].stav === 'vyzaduje_kontrolu' && w.s.zaznamy[1].pokusu === MAX_POKUSU)
}

console.log('\n== Kurzor: změna UIDVALIDITY, posunuté „Číst od", velká schránka ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')]), zprava(2, [pdf('b.pdf', 'B')])] })
  await beh(w)
  // Server přečísloval schránku: stejné zprávy, nová UID.
  w.s.schranka.uidvalidity = '200'
  w.s.schranka.zpravy = [zprava(7, [pdf('a.pdf', 'A')]), zprava(8, [pdf('b.pdf', 'B')])]
  await beh(w)
  const posledni = w.s.schranka.volani[w.s.schranka.volani.length - 1]
  ok('nové UIDVALIDITY → čte se znovu od „od", kurzor s novou platností', posledni.kurzor.uidvalidity === '100' && w.s.kurzory.get('p1|INBOX')?.uidvalidity === '200' && w.s.kurzory.get('p1|INBOX')?.posledniUid === 8)
  ok('…a přečtené soubory skončí jako duplicita, Faktury se nezdvojí', w.s.faktury.length === 2 && w.s.zaznamy.filter((z) => z.uidvalidity === '200').every((z) => z.stav === 'duplicita'))

  const w2 = svet({ prijem: { zapnuto: true, od: '2026-09-15', ai: { povoleno: true } }, zpravy: [zprava(1, [pdf('a.pdf', 'A')], { cas: '2026-09-01T08:00:00.000Z' }), zprava(2, [pdf('b.pdf', 'B')], { cas: '2026-09-20T08:00:00.000Z' })] })
  await beh(w2)
  ok('„Číst od 15. 9." → starší zpráva se nečte', w2.s.zaznamy.length === 1 && w2.s.zaznamy[0].uid === 2)
  w2.s.pripojeni.externiUcet.prijem_dokladu = { zapnuto: true, od: '2026-01-01', ai: { povoleno: true } }
  await beh(w2)
  ok('posunuté „Číst od" dřív → kurzor zahozen, starší zpráva dočtena, nic dvakrát', w2.s.zaznamy.length === 2 && w2.s.faktury.length === 2 && w2.s.kurzory.get('p1|INBOX')?.od === '2026-01-01')

  const mnoho = Array.from({ length: LIMIT_ZPRAV * 2 + 5 }, (_, i) => zprava(i + 1, [isdoc(`FV${i}.isdoc`, isdocXml({ cislo: `FV-${i}` }))]))
  const w3 = svet({ zpravy: mnoho })
  const v3 = await beh(w3)
  ok(`${mnoho.length} zpráv → víc dávek v jednom běhu, schránka dočtená`, w3.s.schranka.volani.length === 3 && v3.schrankaDoctena && w3.s.zaznamy.length === mnoho.length)
}

console.log('\n== Výjimka uvnitř běhu nevyletí ven ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  w.s.selhat.nactiKeZpracovani = true
  let vyhodilo = false
  let v
  try { v = await beh(w) } catch { vyhodilo = true }
  ok('chyba fronty → výsledek „chyba", ne výjimka; zámek uvolněn', !vyhodilo && v.stav === 'chyba' && odemknutoVzdy(w.s) && w.s.odemceno[0].ok === false)

  const w2 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])] })
  w2.s.schranka.chyba = 'Přihlášení odmítnuto'
  w2.s.zaznamy.push({ id: 'zstary', tenant_id: FIRMA, pripojeni_id: 'p1', slozka: 'INBOX', uidvalidity: '100', uid: 99, priloha_cast: '2', priloha_nazev: 'x.isdoc', priloha_typ: 'application/xml', priloha_velikost: 1, priloha_hash: 'f'.repeat(64), druh: 'isdoc', soubor_cesta: `${FIRMA}/${'f'.repeat(64)}.xml`, stav: 'ceka', faktura_id: null, duvod: null, vysledek: null, pokusu: 0, message_id: null, prijato_kdy: '2026-09-01T08:00:00.000Z', odesilatel: 'a@b.cz', predmet: 'x' })
  w2.s.soubory.set(`${FIRMA}/${'f'.repeat(64)}.xml`, bajty(isdocXml({ cislo: 'FV-STARY' })))
  const v2 = await beh(w2)
  ok('nedostupná schránka: dřív stažené přílohy se i tak zpracují', w2.s.zaznamy[0].stav === 'zapsano' && v2.zapsano === 1 && /Přihlášení odmítnuto/.test(v2.duvod ?? ''))
}

console.log('\n== Účet dodavatele: nový nebo jiný účet nikdy rovnou k úhradě ==')
{
  const jiny = isdocXml({ cislo: 'FV-JINY' }).replace('<ID>19-2000145399</ID>', '<ID>2000145399</ID>').replace('<BankCode>0800</BankCode>', '<BankCode>2010</BankCode>')
  const w = svet({ prijem: { zapnuto: true, ai: { povoleno: false } }, zpravy: [zprava(1, [isdoc('A.isdoc', isdocXml({ cislo: 'FV-ZNAMY' }))]), zprava(2, [isdoc('B.isdoc', jiny)])] })
  await beh(w)
  const znamy = w.s.faktury.find((f) => f.invoice_number === 'FV-ZNAMY')
  const podvrh = w.s.faktury.find((f) => f.invoice_number === 'FV-JINY')
  ok('známý účet (schválený dřív jako IBAN, teď domácí tvar) → rovnou „Ke kontrole úhrady"', znamy?.status === 'Ke kontrole úhrady')
  ok('jiný účet téhož dodavatele → „Ke schválení" s varováním', podvrh?.status === 'Ke schválení' && /liší/.test(podvrh.review_note ?? ''))
  const w2 = svet({ prijem: { zapnuto: true, ai: { povoleno: false } }, zpravy: [zprava(1, [isdoc('A.isdoc', isdocXml())])] })
  w2.s.overeneUcty = {}
  await beh(w2)
  ok('dodavatel bez jediné schválené faktury → „Ke schválení" (ověřit účet)', w2.s.faktury[0]?.status === 'Ke schválení' && /ověřený/.test(w2.s.faktury[0].review_note ?? ''))
  w2.s.faktury.push({ id: 'inv-zaplacena', invoice_number: 'STARA', supplier_ico: ICO_DODAVATELE, supplier_account: '19-2000145399/0800', status: 'Ke kontrole úhrady', amount: 1, received_at: '2026-01-05T00:00:00.000Z' })
  w2.s.schranka.zpravy.push(zprava(2, [isdoc('B.isdoc', isdocXml({ cislo: 'FV-DALSI' }))]))
  await beh(w2)
  ok('… po první schválené faktuře (člověk ji přesunul do „Ke kontrole úhrady") se účet bere jako ověřený', w2.s.faktury.find((f) => f.invoice_number === 'FV-DALSI')?.status === 'Ke kontrole úhrady')
}

console.log('\n== Hlavičky e-mailu: dlouhý předmět ani NUL nezaseknou schránku ==')
{
  const z = zprava(1, [pdf('a\u0000.pdf', 'A')], { od: `${'x'.repeat(400)}@example.cz` })
  z.predmet = `Faktura \u0000${'š'.repeat(1500)}`
  z.messageId = `<${'m'.repeat(1200)}@example.cz>`
  const w = svet({ zpravy: [z, zprava(2, [pdf('b.pdf', 'B')])] })
  const v = await beh(w)
  const r = w.s.zaznamy[0]
  ok('dávka se zapsala a kurzor se posunul', w.s.zaznamy.length === 2 && w.s.kurzory.get('p1|INBOX')?.posledniUid === 2 && !/přečíst/.test(v.duvod ?? ''))
  ok('předmět oříznutý na 1000 znaků bez NUL, odesílatel ≤ 320, Message-ID ≤ 998', Array.from(r.predmet).length === 1000 && !r.predmet.includes('\u0000') && Array.from(r.odesilatel).length <= 320 && Array.from(r.message_id).length <= 998)
  ok('název přílohy bez NUL', !r.priloha_nazev.includes('\u0000'))
  const w2 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'chyba', duvod: `Rozbité \u0000${'x'.repeat(5000)}`, docasna: false }) })
  await beh(w2)
  ok('dlouhý důvod s NUL z AI se uloží oříznutý (řádek nezůstane viset)', w2.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && Array.from(w2.s.zaznamy[0].duvod).length <= 2000)
}

console.log('\n== Odpojení a nové připojení schránky: čekající faktury se neztratí ==')
{
  const w = svet({ prijem: { zapnuto: true, ai: { povoleno: false } }, zpravy: [zprava(1, [pdf('a.pdf', 'STEJNY-OBSAH')]), zprava(2, [isdoc('Z.isdoc', isdocXml({ cislo: 'FV-HOTOVA' }))])] })
  await beh(w)
  // Stará schránka p1 skončila (odpojeno); její řádky převezme nová p2 (stejný svět, nové id).
  for (const r of w.s.zaznamy) r.pripojeni_id = 'p0'
  w.s.mrtveSchranky.add('p0')
  w.s.kurzory.clear()
  w.s.pripojeni.externiUcet.prijem_dokladu = { zapnuto: true, ai: { povoleno: true } }
  await beh(w)
  const novy = w.s.zaznamy.filter((r) => r.pripojeni_id === 'p1')
  ok('PDF, které stará schránka nestihla, nová přečte a zapíše', novy.find((r) => r.uid === 1)?.stav === 'zapsano')
  const isdocZnovu = novy.find((r) => r.uid === 2)
  ok('ISDOC, který stará schránka už zapsala, se pozná (odkaz na fakturu) — Faktury se nezdvojí',
    ['duplicita', 'existuje'].includes(isdocZnovu?.stav) && isdocZnovu.faktura_id !== null && w.s.faktury.filter((f) => f.invoice_number === 'FV-HOTOVA').length === 1)
}

console.log('\n== AI zabitá platformou: pokus se počítá předem, fronta se nezasekne ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('dlouhe.pdf', 'A')])], ai: () => { throw new Error('platforma běh zabila') } })
  for (let i = 0; i < MAX_POKUSU + 1; i++) await beh(w)
  ok(`po ${MAX_POKUSU} zabitých bězích → ruční kontrola, AI volaná ${MAX_POKUSU}×`, w.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w.s.ai.volani.length === MAX_POKUSU)
  const w2 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => { throw new Error('zabito') } })
  await beh(w2)
  ok('zabité volání se počítá do denního stropu', (await w2.repo.pocetAiDnes(FIRMA, '2026-10-08')) === 1)
  // Zabité při POSLEDNÍM pokusu z „chyba": řádek zůstal chyba s pokusu = MAX. Dřív ho fronta nebrala — visel navždy.
  const w3 = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'chyba', duvod: 'AI je přetížená.', docasna: true }) })
  await beh(w3)
  Object.assign(w3.s.zaznamy[0], { stav: 'chyba', pokusu: MAX_POKUSU })
  await beh(w3)
  ok('„chyba" s vyčerpanými pokusy → příští běh ji pošle do ruční kontroly (nevisí), AI už nevolá',
    w3.s.zaznamy[0].stav === 'vyzaduje_kontrolu' && w3.s.ai.volani.length === 1)
}

console.log('\n== Zápis prošel, evidence ne → příště se faktura NEZAPÍŠE podruhé ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')])], ai: () => ({ stav: 'ok', doklad: dokladAI(null, 999), model: 'm', verze: 'v' }) })
  w.s.selhat.zmenaPoZapisu = 1
  await beh(w)
  ok('výpadek po zápisu: faktura ve Fakturách jednou, řádek nedokončený', w.s.faktury.length === 1 && w.s.zaznamy[0].stav !== 'zapsano')
  await beh(w)
  ok('další běh pozná svou fakturu podle odkazu a jen doplní evidenci (bez čísla dokladu!)', w.s.faktury.length === 1 && w.s.zaznamy[0].stav === 'zapsano' && w.s.zaznamy[0].faktura_id === w.s.faktury[0].id && w.s.ai.volani.length === 1)
}

console.log('\n== n8n: stejný odesílatel ve stejných 10 minutách, ale jiný e-mail ==')
{
  const w = svet({
    zpravy: [zprava(1, [pdf('FV.pdf', 'PDF')], { od: 'dodavatel@example.cz', cas: '2026-09-11T08:00:00.000Z' })],
    faktury: [{ email_sender: 'dodavatel@example.cz', received_at: '2026-09-11T08:03:00.000Z', email_subject: 'Upomínka 77', invoice_number: 'N8N-1' }],
  })
  await beh(w)
  ok('jiný předmět → n8n tenhle e-mail nezapsal, zpracuje se', w.s.zaznamy[0].stav === 'zapsano' && w.s.ai.volani.length === 1)
}

console.log('\n== Stejné číslo dokladu jinak napsané ==')
{
  const w = svet({ zpravy: [zprava(1, [isdoc('FV.isdoc', isdocXml())])], faktury: [{ invoice_number: 'fv 2026-0815', supplier_ico: ICO_DODAVATELE, supplier: 'Velkoobchod s.r.o.', amount: 12100.5, received_at: '2026-08-01T00:00:00.000Z' }] })
  await beh(w)
  ok('„fv 2026-0815" ve Fakturách = „FV2026-0815" z e-mailu → existuje', w.s.zaznamy[0].stav === 'existuje' && w.s.faktury.length === 1)
}

console.log('\n== Málo času na AI: ISDOC za ním se i tak zapíše ==')
{
  const w = svet({ zpravy: [zprava(1, [pdf('a.pdf', 'A')]), zprava(2, [isdoc('FV.isdoc', isdocXml())])] })
  await beh(w, 24_000)
  ok('PDF čeká na další běh, ISDOC za ním zapsaný', w.s.zaznamy.find((r) => r.uid === 1)?.stav === 'ceka' && w.s.zaznamy.find((r) => r.uid === 2)?.stav === 'zapsano' && w.s.ai.volani.length === 0)
  ok('čas posledního běhu se zapíše PŘED čtením schránky (rotace schránek i při zabitém běhu)', w.s.poradi[0] === 'cas-behu' && w.s.poradi.indexOf('cteni') > 0)
  ok('čtení schránky dostane vlastní časový limit', Number.isFinite(w.s.schranka.volani[0].konecCteniMs))
}

console.log('\n== Návrhy: zámek a čas ==')
{
  const w = svet({ prijem: { zapnuto: true, rezim: 'nahled', ai: { povoleno: false } }, zpravy: [zprava(1, [isdoc('A.isdoc', isdocXml({ cislo: 'N-1' }))]), zprava(2, [isdoc('B.isdoc', isdocXml({ cislo: 'N-2' }))])] })
  await beh(w)
  const bezCasu = await zapsatNavrhyJadro(w.repo, 'p1', FIRMA, () => w.s.hodiny.ms, 0)
  ok('bez času nic nezapíše a řekne, kolik zbývá', bezCasu.zapsano === 0 && bezCasu.zbyva === 2 && w.s.faktury.length === 0)
  w.s.zamekObsazen = true
  const obsazeno = await zapsatNavrhyJadro(w.repo, 'p1', FIRMA, () => w.s.hodiny.ms, Infinity)
  ok('když zrovna běží úloha, návrhy počkají (žádný souběh)', obsazeno.zapsano === 0 && /běží/.test(obsazeno.duvod ?? ''))
  w.s.zamekObsazen = false
  const r = await zapsatNavrhyJadro(w.repo, 'p1', FIRMA, () => w.s.hodiny.ms, Infinity)
  ok('pak zapíše obě a zámek pustí', r.zapsano === 2 && odemknutoVzdy(w.s))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
