#!/usr/bin/env node
/**
 * Příjem faktur z e-mailu — čistá logika (žádné IO):
 *   lib/faktury-prijem-prilohy.ts   hledání příloh ve struktuře e-mailu
 *   lib/faktury-prijem-isdoc.ts     ISDOC bez AI (bezpečný parser)
 *   lib/faktury-prijem-kontrola.ts  automatická kontrola a rozhodnutí
 *
 * Pusť: node scripts/faktury-prijem.test.mjs   (Node 24, běží i v CI)
 */

import { najitPrilohy, priponaProUlozeni, mimeProUlozeni, cestaSouboru, jeIsdocXml, zakladNazvu } from '../lib/faktury-prijem-prilohy.ts'
import { precistIsdoc } from '../lib/faktury-prijem-isdoc.ts'
import { platneIco, bezRidicichZnaku, zkontrolovatVytezeni, rozhodnout, emailUzZapsany, porovnatSFakturou, klicUctu } from '../lib/faktury-prijem-kontrola.ts'
import { MAX_VELIKOST_PRILOHY, nacistNastaveni, upravitNastaveni, platneOd } from '../lib/faktury-prijem-typy.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const FIRMA = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
const OTISK = 'a'.repeat(64)

// ---------------------------------------------------------------------------
console.log('\n== Přílohy ve struktuře e-mailu ==')
{
  const zprava = {
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/html', size: 4000 },
      { part: '2', type: 'image/png', disposition: 'inline', size: 8000, parameters: { name: 'logo.png' } },
      { part: '3', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'FV2026-001.pdf' }, size: 80000 },
      { part: '4', type: 'application/octet-stream', dispositionParameters: { filename: 'faktura.PDF' }, size: 50000 },
      { part: '5', type: 'application/octet-stream', dispositionParameters: { filename: 'faktura.isdocx' }, size: 9000 },
      { part: '6', type: 'image/heic', dispositionParameters: { filename: 'uctenka.heic' }, size: 900000 },
      { part: '7', type: 'application/pdf', dispositionParameters: { filename: 'velka.pdf' }, size: MAX_VELIKOST_PRILOHY + 1 },
      { part: '8', type: 'application/zip', dispositionParameters: { filename: 'archiv.zip' }, size: 20000 },
      { part: '9', type: 'text/xml', dispositionParameters: { filename: 'FV2026-001.isdoc' }, size: 6000 },
      { part: '10', type: 'image/jpeg', disposition: 'attachment', dispositionParameters: { filename: 'faktura-foto.jpg' }, size: 400000 },
      {
        part: '11', type: 'message/rfc822', childNodes: [
          { part: '11.1', type: 'application/pdf', dispositionParameters: { filename: 'preposlana.pdf' }, size: 70000 },
        ],
      },
      { part: '12', type: 'application/pdf', dispositionParameters: { filename: 'zlá‮fdp.exe' }, size: 30000 },
    ],
  }
  const p = najitPrilohy(zprava)
  const podle = (cast) => p.find((k) => k.cast === cast)
  ok('HTML tělo, zip a malé vložené logo se nevrací', !podle('1') && !podle('8') && !podle('2'))
  ok('PDF přílohy → pdf', podle('3')?.druh === 'pdf' && !podle('3')?.duvodBezStazeni)
  ok('octet-stream s .PDF → pdf', podle('4')?.druh === 'pdf')
  ok('.isdocx → nepodporovano s důvodem', podle('5')?.druh === 'nepodporovano' && /ISDOCX/.test(podle('5')?.duvodBezStazeni ?? ''))
  ok('HEIC → nepodporovano s důvodem', podle('6')?.druh === 'nepodporovano' && Boolean(podle('6')?.duvodBezStazeni))
  ok('příliš velké PDF → vrátí se, ale nestahuje', podle('7')?.druh === 'pdf' && /MB/.test(podle('7')?.duvodBezStazeni ?? ''))
  ok('.isdoc → isdoc', podle('9')?.druh === 'isdoc')
  ok('fotka faktury jako příloha → obrazek', podle('10')?.druh === 'obrazek')
  ok('PDF v přeposlaném e-mailu (message/rfc822) se najde', podle('11.1')?.druh === 'pdf')
  ok('znak U+202E (otočení textu) z názvu zmizí', p.find((k) => k.cast === '12')?.nazev.includes('‮') === false)
  ok('prázdná / chybějící struktura → žádné přílohy, žádná výjimka', najitPrilohy(undefined).length === 0 && najitPrilohy(null).length === 0)
}

console.log('\n== Uložení přílohy ==')
{
  ok('přípona pdf/xml/obrázek', priponaProUlozeni({ druh: 'pdf', mime: 'application/pdf', nazev: 'a.pdf' }) === 'pdf'
    && priponaProUlozeni({ druh: 'isdoc', mime: 'text/xml', nazev: 'a.isdoc' }) === 'xml'
    && priponaProUlozeni({ druh: 'obrazek', mime: 'image/png', nazev: 'a.png' }) === 'png')
  let vyhodilo = false
  try { priponaProUlozeni({ druh: 'nepodporovano', mime: 'image/heic', nazev: 'a.heic' }) } catch { vyhodilo = true }
  ok('nepodporovaný druh se do úložiště nedostane', vyhodilo)
  ok('MIME sedí s povolenými typy kbelíku', mimeProUlozeni('pdf') === 'application/pdf' && mimeProUlozeni('xml') === 'application/xml' && mimeProUlozeni('jpg') === 'image/jpeg')
  const cesta = cestaSouboru(FIRMA, OTISK, 'pdf')
  ok('cesta = firma/otisk.přípona a projde vzorem z migrace', cesta === `${FIRMA}/${OTISK}.pdf`
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(pdf|jpg|png|webp|xml)$/.test(cesta))
  let spatna = false
  try { cestaSouboru('../jina-firma', OTISK, 'pdf') } catch { spatna = true }
  ok('nesmyslná firma v cestě → výjimka, ne soubor bez majitele', spatna)
  ok('základ názvu pro spárování ISDOC↔PDF', zakladNazvu('FV 2026-001.isdoc') === zakladNazvu('fv2026-001.PDF'))
}

// ---------------------------------------------------------------------------
const ISDOC = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>FV2026-0815</ID>
  <IssueDate>2026-09-20</IssueDate>
  <TaxPointDate>2026-09-19</TaxPointDate>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <AccountingSupplierParty><Party>
    <PartyIdentification><ID>27082440</ID></PartyIdentification>
    <PartyName><Name>Velkoobchod &amp; spol. s.r.o.</Name></PartyName>
  </Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party>
    <PartyIdentification><ID>21249946</ID></PartyIdentification>
    <PartyName><Name>Foodtab s.r.o.</Name></PartyName>
  </Party></AccountingCustomerParty>
  <LegalMonetaryTotal>
    <TaxInclusiveAmount>12100.00</TaxInclusiveAmount>
    <PayableAmount>12100.50</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans><Payment><Details>
    <PaymentDueDate>2026-10-04</PaymentDueDate>
    <ID>19-2000145399</ID>
    <BankCode>0800</BankCode>
    <VariableSymbol>20260815</VariableSymbol>
  </Details></Payment></PaymentMeans>
</Invoice>`

console.log('\n== ISDOC bez AI ==')
{
  ok('jeIsdocXml pozná ISDOC podle kořene a namespace', jeIsdocXml(ISDOC))
  ok('jiné XML není ISDOC', !jeIsdocXml('<?xml version="1.0"?><objednavka xmlns="urn:x"><id>1</id></objednavka>'))
  const r = precistIsdoc(ISDOC)
  ok('faktura se přečte', r.stav === 'ok')
  if (r.stav === 'ok') {
    const d = r.doklad
    ok('typ faktura, jistota vysoká', d.typ === 'faktura' && d.jistotaTypu === 'vysoka')
    ok('číslo, data, splatnost', d.cisloDokladu === 'FV2026-0815' && d.datumVystaveni === '2026-09-20' && d.duzp === '2026-09-19' && d.datumSplatnosti === '2026-10-04')
    ok('dodavatel (entita &amp; dekódovaná) a IČO', d.dodavatelNazev === 'Velkoobchod & spol. s.r.o.' && d.dodavatelIco === '27082440')
    ok('odběratel IČO', d.odberatelIco === '21249946')
    ok('částka k úhradě = PayableAmount, ne TaxInclusiveAmount', d.castkaCelkem === 12100.5)
    ok('měna, VS, účet číslo/kód banky', d.mena === 'CZK' && d.variabilniSymbol === '20260815' && d.ucetDodavatele === '19-2000145399/0800')
  }
  const dobropis = precistIsdoc(ISDOC.replace('<DocumentType>1</DocumentType>', '<DocumentType>2</DocumentType>'))
  ok('DocumentType 2 → dobropis', dobropis.stav === 'ok' && dobropis.doklad.typ === 'dobropis')
  const cizi = precistIsdoc(ISDOC.replace('<LocalCurrencyCode>CZK</LocalCurrencyCode>', '<LocalCurrencyCode>CZK</LocalCurrencyCode><ForeignCurrencyCode>EUR</ForeignCurrencyCode>'))
  ok('cizí měna → ke kontrole s důvodem', cizi.stav === 'ok' && cizi.doklad.vyzadujeKontrolu && cizi.doklad.duvodyKontroly.some((x) => /EUR/.test(x)))

  const bomba = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>&b;</ID></Invoice>`
  const b = precistIsdoc(bomba)
  ok('DOCTYPE/ENTITY („billion laughs", XXE) se odmítne bez rozvinutí', b.stav === 'chyba' && /DOCTYPE|ENTITY/.test(b.duvod))
  const xxe = precistIsdoc('<Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>&xxe;</ID></Invoice>')
  ok('neznámá entita se nerozvine', xxe.stav === 'chyba')
  ok('ne-ISDOC XML → chyba „není ISDOC"', precistIsdoc('<faktura><id>1</id></faktura>').stav === 'chyba')
  ok('poškozené XML → chyba, ne výjimka', precistIsdoc('<Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>1</Invoice>').stav === 'chyba')
}

// ---------------------------------------------------------------------------
console.log('\n== IČO a texty ==')
{
  ok('platná IČO (Foodtab a další)', platneIco('21249946') && platneIco('27082440') && platneIco('45274649'))
  ok('změněná poslední číslice neprojde', !platneIco('21249947') && !platneIco('27082441'))
  ok('nečíselné / prázdné neprojde', !platneIco('2124994X') && !platneIco('') && !platneIco(null))
  ok('NUL a řídicí znaky pryč (n8n padal na 22P05)', bezRidicichZnaku('Fa\u0000ktura\u0007 č. 1') === 'Faktura č. 1')
  ok('prázdný text → null', bezRidicichZnaku('   ') === null)
}

const dokladZaklad = {
  typ: 'faktura', jistotaTypu: 'vysoka',
  dodavatelNazev: 'Velkoobchod s.r.o.', dodavatelIco: '27082440',
  odberatelNazev: 'Foodtab s.r.o.', odberatelIco: '21249946',
  cisloDokladu: 'FV2026-0815', variabilniSymbol: '20260815',
  castkaCelkem: 12100.5, mena: 'CZK',
  datumVystaveni: '2026-09-20', duzp: '2026-09-19', datumSplatnosti: '2026-10-04',
  ucetDodavatele: '19-2000145399/0800',
  vyzadujeKontrolu: false, duvodyKontroly: [], ukazkaTextu: 'Faktura FV2026-0815',
}
const KONTEXT = { icoFirmy: '21249946', dnes: '2026-10-08' }

console.log('\n== Automatická kontrola ==')
{
  const cista = zkontrolovatVytezeni(dokladZaklad, KONTEXT)
  ok('správná faktura projde bez důvodů', !cista.vyzadujeKontrolu && cista.duvodyKontroly.length === 0)
  const jinaFirma = zkontrolovatVytezeni({ ...dokladZaklad, odberatelIco: '45274649' }, KONTEXT)
  ok('faktura na jinou firmu → ke kontrole', jinaFirma.vyzadujeKontrolu && jinaFirma.duvodyKontroly.some((d) => /jinou firmu/.test(d)))
  const spatneIco = zkontrolovatVytezeni({ ...dokladZaklad, dodavatelIco: '27082441' }, KONTEXT)
  ok('neplatné IČO dodavatele → vymazané + důvod', spatneIco.dodavatelIco === null && spatneIco.vyzadujeKontrolu)
  const nula = zkontrolovatVytezeni({ ...dokladZaklad, castkaCelkem: 0 }, KONTEXT)
  ok('nulová částka → null + důvod (nikdy 0)', nula.castkaCelkem === null && nula.vyzadujeKontrolu)
  const zaporna = zkontrolovatVytezeni({ ...dokladZaklad, castkaCelkem: -500 }, KONTEXT)
  ok('záporná částka mimo dobropis → ke kontrole', zaporna.castkaCelkem === null && zaporna.vyzadujeKontrolu)
  ok('záporná částka u dobropisu projde', zkontrolovatVytezeni({ ...dokladZaklad, typ: 'dobropis', castkaCelkem: -500 }, KONTEXT).castkaCelkem === -500)
  const datum = zkontrolovatVytezeni({ ...dokladZaklad, datumSplatnosti: '2026-02-30' }, KONTEXT)
  ok('neexistující den → null + důvod', datum.datumSplatnosti === null && datum.vyzadujeKontrolu)
  const splatnost = zkontrolovatVytezeni({ ...dokladZaklad, datumSplatnosti: '2026-09-01' }, KONTEXT)
  ok('splatnost před vystavením → důvod', splatnost.duvodyKontroly.some((d) => /Splatnost/.test(d)))
  const ucet = zkontrolovatVytezeni({ ...dokladZaklad, ucetDodavatele: '19-2000145398/0800' }, KONTEXT)
  ok('účet se špatným kontrolním součtem → vymazaný + důvod (peníze by šly jinam)', ucet.ucetDodavatele === null && ucet.vyzadujeKontrolu)
  const vs = zkontrolovatVytezeni({ ...dokladZaklad, variabilniSymbol: 'ABC-1' }, KONTEXT)
  ok('VS s písmeny → null + důvod', vs.variabilniSymbol === null && vs.vyzadujeKontrolu)
  ok('„Kč" → CZK', zkontrolovatVytezeni({ ...dokladZaklad, mena: 'Kč' }, KONTEXT).mena === 'CZK')
  const bezIcoFirmy = zkontrolovatVytezeni(dokladZaklad, { icoFirmy: null, dnes: '2026-10-08' })
  ok('bez IČO firmy se neodběratel nehlásí jako „jiná firma"', !bezIcoFirmy.duvodyKontroly.some((d) => /jinou firmu/.test(d)))
  ok('nižší jistota typu → ke kontrole', zkontrolovatVytezeni({ ...dokladZaklad, jistotaTypu: 'stredni' }, KONTEXT).vyzadujeKontrolu)
}

console.log('\n== Rozhodnutí (slovník stavů jako n8n) ==')
{
  const kontext = { prijatoKdy: '2026-09-21T08:00:00Z', odesilatel: 'faktury@velkoobchod.cz', predmet: 'Faktura FV2026-0815', pdfUrl: '/api/faktury/priloha/x' }
  const r = rozhodnout(zkontrolovatVytezeni(dokladZaklad, KONTEXT), kontext)
  ok('čistá faktura → zapsat „Ke kontrole úhrady"', r.akce === 'zapsat' && r.radek.status === 'Ke kontrole úhrady' && r.radek.review_note === null)
  ok('řádek nese e-mail, PDF a částku; bez tenant_id', r.akce === 'zapsat' && r.radek.email_sender === 'faktury@velkoobchod.cz' && r.radek.pdf_url === '/api/faktury/priloha/x' && r.radek.amount === 12100.5 && !('tenant_id' in r.radek))
  const nejista = rozhodnout(zkontrolovatVytezeni({ ...dokladZaklad, odberatelIco: '45274649' }, KONTEXT), kontext)
  ok('nejistá → „Ke schválení" s důvodem v review_note', nejista.akce === 'zapsat' && nejista.radek.status === 'Ke schválení' && /jinou firmu/.test(nejista.radek.review_note ?? ''))
  const stara = rozhodnout({ ...dokladZaklad, duzp: '2025-12-20', datumVystaveni: '2025-12-20' }, kontext)
  ok('DUZP před 1. 1. 2026 → „Ke schválení"', stara.akce === 'zapsat' && stara.radek.status === 'Ke schválení')
  const necitelna = rozhodnout({ ...dokladZaklad, dodavatelNazev: null, dodavatelIco: null, castkaCelkem: null }, kontext)
  ok('chybí dodavatel i částka → „Nutná ruční kontrola", amount 0, needs_review', necitelna.akce === 'zapsat' && necitelna.radek.status.startsWith('Nutná ruční kontrola') && necitelna.radek.amount === 0 && necitelna.radek.needs_review === true && necitelna.radek.supplier === '')
  const upominka = rozhodnout({ ...dokladZaklad, typ: 'upominka' }, kontext)
  ok('upomínka → „Upomínka - zkontrolovat"', upominka.akce === 'zapsat' && upominka.radek.status === 'Upomínka - zkontrolovat')
  const zaloha = rozhodnout({ ...dokladZaklad, typ: 'zalohova_faktura' }, kontext)
  ok('zálohová faktura → ke schválení s poznámkou', zaloha.akce === 'zapsat' && zaloha.radek.status === 'Ke schválení' && /Zálohová/.test(zaloha.radek.review_note ?? ''))
  const dodaci = rozhodnout({ ...dokladZaklad, typ: 'dodaci_list' }, kontext)
  ok('dodací list → nezapisovat (neni_doklad)', dodaci.akce === 'nezapisovat' && dodaci.stav === 'neni_doklad')
  const nul = rozhodnout({ ...dokladZaklad, cisloDokladu: 'FV\u00002026', ukazkaTextu: 'a\u0000b' }, { ...kontext, predmet: 'Pred\u0000met' })
  ok('NUL bajty pryč ze všech textů', nul.akce === 'zapsat' && !JSON.stringify(nul.radek).includes('\\u0000'))
  const dlouha = rozhodnout({ ...dokladZaklad, duvodyKontroly: Array.from({ length: 40 }, (_, i) => `důvod ${i} ${'x'.repeat(40)}`) }, kontext)
  ok('review_note nejvýš 1000 znaků', dlouha.akce === 'zapsat' && Array.from(dlouha.radek.review_note ?? '').length <= 1000)
}

console.log('\n== Duplicity ==')
{
  const zprava = { odesilatel: 'Faktury@Velkoobchod.cz', prijatoKdy: '2026-09-21T08:00:00Z' }
  ok('n8n: „Jméno <adresa>" a čas do 10 minut → už zapsáno', emailUzZapsany(zprava, { email_sender: 'Velkoobchod <faktury@velkoobchod.cz>', received_at: '2026-09-21T08:09:00+00:00' }))
  ok('n8n: holá adresa a stejný čas → už zapsáno', emailUzZapsany(zprava, { email_sender: 'faktury@velkoobchod.cz', received_at: '2026-09-21T08:00:00Z' }))
  ok('n8n: 11 minut → jiný e-mail', !emailUzZapsany(zprava, { email_sender: 'faktury@velkoobchod.cz', received_at: '2026-09-21T08:11:00Z' }))
  ok('n8n: jiný odesílatel → jiný e-mail', !emailUzZapsany(zprava, { email_sender: 'jiny@velkoobchod.cz', received_at: '2026-09-21T08:00:00Z' }))
  const sPredmetem = { ...zprava, predmet: 'Faktura  FV2026-0815' }
  ok('n8n: jiný předmět ve stejných 10 minutách → jiný e-mail', !emailUzZapsany(sPredmetem, { email_sender: 'faktury@velkoobchod.cz', received_at: '2026-09-21T08:02:00Z', email_subject: 'Upomínka' }))
  ok('n8n: stejný předmět (jiné mezery, velikost písmen) → už zapsáno', emailUzZapsany(sPredmetem, { email_sender: 'faktury@velkoobchod.cz', received_at: '2026-09-21T08:02:00Z', email_subject: 'faktura fv2026-0815 ' }))
  ok('n8n: předmět chybí na jedné straně → rozhoduje odesílatel a čas', emailUzZapsany(sPredmetem, { email_sender: 'faktury@velkoobchod.cz', received_at: '2026-09-21T08:02:00Z', email_subject: null }))

  ok('účet: IBAN a domácí tvar téhož účtu → stejný klíč', klicUctu('CZ65 0800 0000 1920 0014 5399') === klicUctu('19-2000145399/0800') && klicUctu('19-2000145399/0800') === '19-2000145399/0800')
  ok('účet: nuly na začátku a mezery nevadí', klicUctu('000019 - 2000145399 / 0800') === '19-2000145399/0800' && klicUctu('19-0002000145/0800') === '19-2000145/0800' && klicUctu('0-2000145399/0800') === '2000145399/0800')
  ok('účet: bez předčíslí je JINÝ účet', klicUctu('2000145399/0800') !== klicUctu('19-2000145399/0800'))
  ok('účet: cizí IBAN zůstane IBANem, nesmysl → null', klicUctu('DE89 3704 0044 0532 0130 00') === 'DE89370400440532013000' && klicUctu('nevím') === null && klicUctu(null) === null)
  const radek = { invoice_number: 'fv 2026-0815', supplier_ico: '27082440', supplier: 'Velkoobchod s.r.o.', amount: 12100.5 }
  ok('stejné číslo, dodavatel i částka → stejný', porovnatSFakturou(dokladZaklad, radek) === 'stejny')
  ok('jiná částka → opravný doklad (ne duplicita)', porovnatSFakturou(dokladZaklad, { ...radek, amount: 11000 }) === 'opraveny')
  ok('jiný dodavatel → jiný', porovnatSFakturou(dokladZaklad, { ...radek, supplier_ico: '45274649' }) === 'jiny')
  ok('bez čísla dokladu → vždy jiný', porovnatSFakturou({ ...dokladZaklad, cisloDokladu: null }, radek) === 'jiny')
}

console.log('\n== Nastavení příjmu ==')
{
  const n = nacistNastaveni(undefined)
  ok('výchozí: vypnuto, od 1. 1. 2026, INBOX, automaticky, AI vypnutá', !n.zapnuto && n.od === '2026-01-01' && n.slozky[0] === 'INBOX' && n.rezim === 'automaticky' && !n.ai.povoleno)
  const s = nacistNastaveni({ zapnuto: true, od: 'nesmysl', rezim: 'cokoli', ai: { povoleno: 'ano' } })
  ok('nesmysly → bezpečné výchozí (AI zapne jen true)', s.zapnuto && s.od === '2026-01-01' && s.rezim === 'automaticky' && !s.ai.povoleno)

  const k = { kdo: 'uzivatel-1', kdy: '2026-10-08T21:00:00Z', dnes: '2026-10-08' }
  const zap = upravitNastaveni(undefined, { akce: 'zapnout', ai: true, od: '2026-01-01' }, k)
  ok('zapnout s AI: zapnuto, automaticky, souhlas s tím, kdo a kdy', zap?.zapnuto && zap.rezim === 'automaticky' && zap.ai.povoleno && zap.ai.kdo === 'uzivatel-1' && zap.ai.kdy === k.kdy)
  const bezAi = upravitNastaveni(undefined, { akce: 'zapnout', ai: false, od: '2026-03-01' }, k)
  ok('zapnout bez AI: žádný souhlas, „od" z formuláře', bezAi?.zapnuto && !bezAi.ai.povoleno && bezAi.ai.kdo === null && bezAi.od === '2026-03-01')
  const vypAi = upravitNastaveni(zap, { akce: 'ai', povoleno: false }, k)
  ok('vypnout AI maže souhlas, příjem běží dál', vypAi?.zapnuto && !vypAi.ai.povoleno && vypAi.ai.kdo === null)
  const vyp = upravitNastaveni(zap, { akce: 'vypnout' }, k)
  ok('vypnout příjem nechá ostatní nastavení (po zapnutí se nepřečte znovu od začátku)', vyp && !vyp.zapnuto && vyp.od === '2026-01-01' && vyp.ai.povoleno)
  ok('režim náhled a zpět', upravitNastaveni(zap, { akce: 'rezim', rezim: 'nahled' }, k)?.rezim === 'nahled' && upravitNastaveni({ ...zap, rezim: 'nahled' }, { akce: 'rezim', rezim: 'automaticky' }, k)?.rezim === 'automaticky')
  ok('neznámý režim → null', upravitNastaveni(zap, { akce: 'rezim', rezim: 'vse' }, k) === null)
  ok('„od" v budoucnu / nesmyslné datum / před 2000 → null', upravitNastaveni(zap, { akce: 'od', od: '2026-10-09' }, k) === null &&
    upravitNastaveni(zap, { akce: 'od', od: '2026-02-30' }, k) === null && upravitNastaveni(zap, { akce: 'zapnout', ai: true, od: '1999-12-31' }, k) === null)
  ok('platné „od" dnes i 1. 1. 2026', platneOd('2026-10-08', k.dnes) && platneOd('2026-01-01', k.dnes) && !platneOd(20260101, k.dnes))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
