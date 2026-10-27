#!/usr/bin/env node
/**
 * Jiné platby — detail záznamu: stránka, serverové akce a logika.
 *
 * Pusť `node scripts/jine-platby-detail.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE HLÍDÁ A PROČ
 *
 * Detail záznamu je místo, kde se z fotky sjetiny stává tržba a výdej ze
 * skladu. Chyba tady znamená tržbu dvakrát, sklad odečtený dvakrát, nebo
 * ruční prohlášení, které se tváří jako ověření pokladnou. Proto:
 *
 *   1. STRÁNKA kontroluje přístup prvními řádky (zkusPristupJinymPlatbam
 *      + pobockaFinanci), záznam čte s tenantem a na pobočce jen záznam
 *      té pobočky; service_role (metadata pokladny) až potom.
 *   2. VZHLED: žádné vlastní svg, emoji ani `const karta` (docs/vzhled-zadani.md, oddíl 11).
 *   3. AKCE: každá exportovaná akce začíná `pripravit(formData, '<právo>')`
 *      a teprve potom volá RPC, service_role nebo pokladnu. Firma nikdy
 *      z formuláře. RPC se volá jen s právem, které chce (tabulka z
 *      docs/jine-platby-navrh.md oddíl 5) — tržní akce nikdy skladovou
 *      funkci a naopak.
 *   4. POKLADNA: zápis do pokladny jen přes orchestrátor (provestOperaci).
 *   5. AI: bez klíče srozumitelná chyba, nikdy ukázka.
 *   6. OBRAZOVKA: věty „Fotografie sjetiny nedokazuje přijetí peněz“
 *      a „Ručně doloženo“ se opravdu vykreslí; ruční prohlášení se
 *      vykreslí jako ruční, ne jako ověření pokladnou.
 *   7. CHOVÁNÍ AKCÍ (spouští se s podvrženou databází, právy a pokladnou):
 *      bez práva se nezavolá nic; s právem se právo ověří PŘED RPC;
 *      chyby databáze → české hlášky; AI zapíše pokus i výsledek;
 *      pokladna bez zápisu přes API dostane „nepodporováno“ a zápisová
 *      metoda relace se nezavolá.
 *   8. LOGIKA (spouští se): vyhodnocení kontroly v pokladně (otevřený účet
 *      není „nenalezeno“, samotná částka není „nalezeno“) a převod
 *      formuláře návrhu (nejasná hodnota = chyba u pole).
 *
 * Opravy po nezávislé kontrole (18. 10. 2026) — každá má vlastní kontrolu:
 *   * nové podpisy RPC: rucne_dolozit (p_otisk), opravit_trzbu (p_verze),
 *     oznacit_zkontrolovano (p_duvod_rozdilu), ulozit_mapovani (p_zaznam);
 *   * nová akce zrusitSchvaleni (vydej_pos, tržní akce ji nesmí volat);
 *   * „Proč to není duplicita“ u tržby i u schválení výdeje (dvě pole
 *     u výdeje: důvod zamítnutí ≠ důvod „není duplicita“);
 *   * platby a kontakty jen s finance.read ZA FIRMU (hasAccess(…, null));
 *   * AI: výběr souborů po pořadí do stropu součtu, kontrola podkladu před
 *     započítáním do stropu, nečitelný název, nejvýš 200 položek;
 *   * pokladna: uzavřené účty oknem podle UZAVŘENÍ, otevřené zvlášť,
 *     fotka otevřeného účtu nikdy „nenalezeno“, nepodporované hledání
 *     podle uzavření → „nelze ověřit“;
 *   * katalog a aliasy po stránkách (bez smazaných, strop = chyba);
 *   * jednotka produktu z katalogu (Piece → ks).
 *
 * Opravy po druhé nezávislé kontrole (19. 10. 2026, čísla N z kontroly) —
 * sekce 10 a konec sekce 9; každá kontrola byla schválně rozbitá (závěrečná
 * zpráva implementace 19. 10.):
 *   * N1 připojení souboru jen klientem služby s p_nahral; N4 úhrada ne
 *     u zrušeného záznamu; N3 ruční prohlášení proti výsledku pokladny;
 *   * N9 otevřený účet u sjetiny / neurčeného dokladu, N10 tolerance
 *     zaokrouhlení, N16 odpis není prodej, N17 dohledání jen odpisu;
 *   * N11 „Jen propojit“ s důvodem, N22 přeřazená provozovna;
 *   * N14/N15/N21 schválený výdej (zámek položek, blokace, varování);
 *   * N26 typ souboru v Blobu; N27–N31 rozpoznání (upozornění k dokladu,
 *     částky z čtení návrhu, verze před zahájením, provozní den, čas).
 *
 * Opravy po ověření oprav (20. 10. 2026, čísla C a R z ověření) — sekce 11;
 * každá kontrola byla schválně rozbitá (závěrečná zpráva implementace 20. 10.):
 *   * C4 „nenalezeno“ / „neodečteno“ jen u uzavřeného prodeje a ručního
 *     seznamu spotřeby (whitelist), N9 obrácený;
 *   * C1/R2 ruční prohlášení proti výsledku pokladny bez ohledu na verzi,
 *     s povinným zaškrtnutím prepsat_pokladnu (u „nalezeno“ jen s opravou);
 *   * R1 varování „možná nezapočítáno“ bez rady „zapište jako novou“;
 *   * C6 schválení výdeje s pokrmem i kusovým zbožím chce bez_surovin;
 *   * C5 nejasná operace po platnosti (ruční doložení, zrušení schválení),
 *     R4 doložení blokuje jen nevyřešená položka, ne katalog;
 *   * C7/R5 panel „Částky na dokladu“ podle vazby rozpoznani_id;
 *   * C9/R3 rozpoznání: schválený výdej ne, zapsaná tržba ano (uložené
 *     částka, měna a datum zůstanou, rozdíl jde do upozornění);
 *   * C8 maxDuration stránky = délka akce rozpoznání (rezerva).
 *
 * Statické kontroly čtou zdroj BEZ komentářů a míří na konkrétní tvar
 * (regex), ne na volné „obsahuje“. Každá byla schválně rozbitá a spadla
 * (počty a co přesně spadlo: závěrečné zprávy implementace, 16. a 18. 10. 2026).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { adresaModulu, nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
let kontrol = 0
const ok = (popis, podminka) => {
  kontrol++
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const KOREN = 'app/[rozsah]/finance/trzby/jine-platby'
const ZAZNAM = `${KOREN}/[zaznam]`
const AKCE_SOUBORY = ['akce.ts', 'akce-pos.ts', 'akce-ai.ts', 'akce-parovani.ts'].map((f) => `${KOREN}/${f}`)
const MOJE = [...AKCE_SOUBORY, ...readdirSync(ZAZNAM).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => `${ZAZNAM}/${f}`)]

/** Zdroj bez komentářů (JSX, blokových i řádkových) a s LF konci řádků. */
const bezKomentaru = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([;,{}()\]])\s*\/\/[^\n'"`]*$/gm, '$1')
const zdroj = (soubor) => bezKomentaru(readFileSync(soubor, 'utf8'))

/** Funkce nejvyšší úrovně: jméno, export, parametry, tělo (do další deklarace na začátku řádku). */
function funkce(s) {
  const starty = [...s.matchAll(/^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm)]
  const hranice = [...s.matchAll(/^(?:export |async |function |const |type |import |let )/gm)].map((m) => m.index)
  return starty.map((m) => {
    const konec = hranice.find((i) => i > m.index) ?? s.length
    return { jmeno: m[3], export: Boolean(m[1]), parametry: m[4], telo: s.slice(m.index, konec) }
  })
}

const rpcV = (telo) => [...telo.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])

/* =====================================================================
 * 1. STRÁNKA: přístup prvními řádky
 * ===================================================================== */

console.log('\n== 1. Stránka detailu: přístup prvními řádky ==')
{
  const s = zdroj(`${ZAZNAM}/page.tsx`)
  ok("export const dynamic = 'force-dynamic'", /^export const dynamic = 'force-dynamic'$/m.test(s))
  ok('export const maxDuration = 120 (rozpoznání AI)', /^export const maxDuration = 120$/m.test(s))

  const zacatek = s.match(
    /export default async function \w+\([^)]*\)[^{]*\{\n\s*const \{ rozsah, zaznam: zaznamId \} = await params\n\s*const tenantId = await getCurrentTenantId\(\)\n\s*if \(!tenantId\) return [^\n]+\n\s*const pristup = await zkusPristupJinymPlatbam\(tenantId, rozsah\)\n\s*if \(pristup\.stav === 'neprihlasen'\) redirect\(await odkazNaPrihlaseni\(\)\)\n\s*if \(pristup\.stav === 'odepren'\) \{[^}]*\}\n\s*const pobocka = pobockaFinanci\(pristup\.scope\)\n\s*if \(!jeUuid\(zaznamId\)\) notFound\(\)\n/,
  )
  ok('po params hned getCurrentTenantId → zkusPristupJinymPlatbam → pobockaFinanci → uuid, nic mezi tím', Boolean(zacatek))

  const iZaznam = s.indexOf(".from('jine_platby')")
  const nacteni = s.slice(iZaznam, s.indexOf('.maybeSingle()', iZaznam))
  ok('záznam: uživatelský klient, .eq(id) a .eq(tenant_id, tenantId)', iZaznam > 0 && /\.eq\('id', zaznamId\)/.test(nacteni) && /\.eq\('tenant_id', tenantId\)/.test(nacteni))
  const iPatri = s.indexOf('if (!r || !zaznamPatriRozsahu(pobocka, ')
  const iDalsi = s.indexOf('await Promise.all(')
  ok('na pobočce jen záznam té pobočky (zaznamPatriRozsahu → notFound) dřív, než se načte cokoli dalšího', iPatri > iZaznam && iDalsi > iPatri && /notFound\(\)/.test(s.slice(iPatri, iPatri + 120)))
  const iMeta = s.indexOf('metadataPokladny(')
  ok('údaje o pokladně (metadataPokladny) až po ověření záznamu, uživatelským klientem a s pobočkou záznamu',
    iMeta > iPatri && /metadataPokladny\(supabase, z\.pripojeniId, tenantId, z\.branchId\)/.test(s))
  ok('práva pro tlačítka na pobočce ZÁZNAMU: hasAccess(tenantId, p, z.branchId)', /hasAccess\(tenantId, p, z\.branchId\)/.test(s))
  ok('stránka sama klientUlohy nevolá', !/klientUlohy\(/.test(s))
  const volaniAkci = s.slice(s.indexOf('dostupneAkce(z, prava, {'), s.indexOf('const kroky'))
  ok('dodatečná kontrola tržby po zápisu: dostupneAkce dostane dohledaniUctu z pokladny',
    /dohledaniUctu: pokladna\?\.dohledaniUctu === true/.test(volaniAkci))
  const n = zdroj(`${ZAZNAM}/nacteni.ts`)
  // Od integrace (16. 10.): pokladnu čte databázová funkce jine_platby_pokladny
  // (právo agendy na pobočce, netajné sloupce), žádný service_role ani přímý dotaz.
  ok("nacteni.ts: 'server-only', jen rpc jine_platby_pokladny s tenantem a pobočkou, žádný service_role ani přímé čtení tabulek",
    /^import 'server-only'$/m.test(n) && /supabase\.rpc\('jine_platby_pokladny', \{ p_tenant: tenantId, p_branch: branchId \}\)/.test(n) &&
      !/klientUlohy|from\('integrace_pripojeni'\)|integrace_tajemstvi/.test(n.replace(/\/\*[\s\S]*?\*\//g, '')))
}

/* =====================================================================
 * 2. VZHLED: žádné svg, emoji, const karta
 * ===================================================================== */

console.log('\n== 2. Vzhled: ikony jen ze sdílené sady ==')
for (const soubor of MOJE) {
  const s = readFileSync(soubor, 'utf8')
  const kratce = soubor.slice(KOREN.length + 1)
  ok(`${kratce}: žádné <svg, emoji ani const karta`, !/<svg/i.test(s) && !/\p{Extended_Pictographic}/u.test(s) && !/const karta\b/.test(s))
}

/* =====================================================================
 * 3. AKCE: pripravit s konkrétním právem PŘED RPC, firma nikdy z formuláře
 * ===================================================================== */

console.log('\n== 3. Akce: právo před RPC, firma z členství ==')

/** Která RPC chce které právo (docs/jine-platby-navrh.md, oddíl 5). */
const PRAVO_RPC = {
  jine_platby_ulozit_navrh: ['jine_platby.upravit'],
  jine_platby_oznacit_zkontrolovano: ['jine_platby.upravit'],
  jine_platby_prohlasit: ['jine_platby.trzba', 'jine_platby.vydej_pos'],
  jine_platby_potvrdit_trzbu: ['jine_platby.trzba'],
  jine_platby_odeslat_sklad: ['jine_platby.sklad_odeslat'],
  jine_platby_rozhodnout_vydej: ['jine_platby.vydej_pos'],
  jine_platby_vydej_znovu: ['jine_platby.vydej_pos'],
  jine_platby_propojit_vydej: ['jine_platby.vydej_pos'],
  jine_platby_rucne_dolozit_vydej: ['jine_platby.vydej_pos'],
  jine_platby_zrusit_schvaleni: ['jine_platby.vydej_pos'],
  jine_platby_faktura: ['jine_platby.faktura'],
  jine_platby_evidovat_uhradu: ['jine_platby.faktura'],
  jine_platby_opravit_trzbu: ['jine_platby.oprava'],
  jine_platby_korekce_vydeje: ['jine_platby.oprava'],
  jine_platby_zrusit: ['jine_platby.oprava'],
  jine_platby_ulozit_mapovani: ['jine_platby.upravit'],
  jine_platby_zahajit_rozpoznani: ['jine_platby.upravit'],
  jine_platby_dokoncit_rozpoznani: ['jine_platby.upravit'],
  jine_platby_zahajit_parovani: ['jine_platby.upravit'],
  jine_platby_dokoncit_parovani: ['jine_platby.upravit'],
  // Čtení náhledu výdeje (vidí ho každý, kdo vidí záznam); schválení ho čte kvůli varování (C6).
  jine_platby_sestavit_vydej: ['jine_platby.vydej_pos', 'jine_platby.sklad_odeslat'],
  jine_platby_zapsat_kontrolu: ['jine_platby.trzba', 'jine_platby.vydej_pos'],
  pos_operace_zahajit: ['jine_platby.vydej_pos'],
  pos_operace_dokoncit: ['jine_platby.vydej_pos'],
  pos_katalog_nahradit: ['jine_platby.upravit'],
}
const TRZNI_RPC = ['jine_platby_potvrdit_trzbu', 'jine_platby_opravit_trzbu']
const SKLADOVE_RPC = [
  'jine_platby_odeslat_sklad',
  'jine_platby_rozhodnout_vydej',
  'jine_platby_vydej_znovu',
  'jine_platby_propojit_vydej',
  'jine_platby_rucne_dolozit_vydej',
  'jine_platby_zrusit_schvaleni',
  'jine_platby_korekce_vydeje',
  'pos_operace_zahajit',
  'pos_operace_dokoncit',
]

/**
 * Které právo chce která akce — NEZÁVISLE na zdroji akcí (zdroj se s tím
 * porovná níž a chování akcí se zkouší právě s tímhle seznamem). Kdo
 * akci přepíše na jiné právo, shodí obě kontroly.
 */
const OCEKAVANA_PRAVA = {
  ulozitNavrh: ['jine_platby.upravit'],
  oznacitZkontrolovano: ['jine_platby.upravit'],
  prohlasitTrzbu: ['jine_platby.trzba'],
  prohlasitSklad: ['jine_platby.vydej_pos'],
  potvrditTrzbu: ['jine_platby.trzba'],
  opravitTrzbu: ['jine_platby.oprava'],
  odeslatSklad: ['jine_platby.sklad_odeslat'],
  propojitVydej: ['jine_platby.vydej_pos'],
  rucneDolozit: ['jine_platby.vydej_pos'],
  zrusitSchvaleni: ['jine_platby.vydej_pos'],
  korekceVydeje: ['jine_platby.oprava', 'jine_platby.vydej_pos'],
  faktura: ['jine_platby.faktura'],
  evidovatUhradu: ['jine_platby.faktura'],
  ulozitMapovani: ['jine_platby.upravit'],
  zrusit: ['jine_platby.oprava'],
  zkontrolovatTrzbu: ['jine_platby.trzba'],
  zkontrolovatSklad: ['jine_platby.vydej_pos'],
  rozhodnoutVydej: ['jine_platby.vydej_pos'],
  provestVydej: ['jine_platby.vydej_pos'],
  vydejZnovu: ['jine_platby.vydej_pos'],
  obnovitVydej: ['jine_platby.vydej_pos'],
  nacistKatalog: ['jine_platby.upravit'],
  rozpoznat: ['jine_platby.upravit'],
  najitVPokladne: ['jine_platby.upravit'],
}

const exportovane = {}
for (const soubor of AKCE_SOUBORY) {
  const s = zdroj(soubor)
  const kratce = soubor.slice(KOREN.length + 1)
  ok(`${kratce}: 'use server' na prvním řádku`, s.trimStart().startsWith("'use server'"))
  const jine = [...s.matchAll(/^export (?!async function)(\S+ \w+)/gm)].map((m) => m[1])
  ok(`${kratce}: exportuje jen async funkce (jinak by byly veřejnou akcí)${jine.length ? ` — navíc: ${jine.join(', ')}` : ''}`, jine.length === 0)
  ok(`${kratce}: firma nikdy z formuláře (žádné tenant v poli formuláře)`, !/(pole\([^)]*'tenant|formData\.get\('tenant|f\.get\('tenant)/.test(s))
  ok(`${kratce}: každé tenant_id ve filtru je p.tenantId z členství`, [...s.matchAll(/'tenant_id', ([\w.]+)\)/g)].every((m) => m[1] === 'p.tenantId'))

  const fce = funkce(s)
  const podleJmena = new Map(fce.map((f) => [f.jmeno, f]))
  const rpcPrechodne = (f, videno = new Set()) => {
    if (videno.has(f.jmeno)) return []
    videno.add(f.jmeno)
    const vlastni = rpcV(f.telo)
    const volane = [...f.telo.matchAll(/\b(\w+)\(/g)].map((m) => m[1]).filter((j) => j !== f.jmeno && podleJmena.has(j))
    return [...vlastni, ...volane.flatMap((j) => rpcPrechodne(podleJmena.get(j), videno))]
  }

  for (const f of fce) {
    if (!f.export) {
      // Interní funkce se službou nebo pokladnou: dostanou se k ní jen přes prošlé pripravit (p: Pripraveno).
      const sluzba = /klientUlohy\(|otevritRelaciPokladny\(/.test(f.telo)
      const rpc = /\.rpc\(/.test(f.telo)
      if (sluzba) ok(`${kratce} › ${f.jmeno}: klientUlohy/relace jen s p: Pripraveno`, /\bp: Pripraveno\b/.test(f.parametry))
      else if (rpc) ok(`${kratce} › ${f.jmeno}: RPC jen s p: Pripraveno nebo s klientem služby z ní`, /\bp: Pripraveno\b|\buloha: Uloha\b/.test(f.parametry))
      continue
    }
    const m = f.telo.match(/^export async function \w+\(_predchozi: StavAkce, formData: FormData\): Promise<StavAkce> \{\n(?:\s*const zacatek = Date\.now\(\)\n)?\s*const p = await pripravit\(formData, ('jine_platby\.[a-z_]+'|\[[^\]]+\])(?:, \{ neboAutor: 'jine_platby\.[a-z_]+' \})?\)\n\s*if \(!p\.ok\) return p\.stav\n/)
    const prava = m ? [...m[1].matchAll(/'(jine_platby\.[a-z_]+)'/g)].map((x) => x[1]) : []
    exportovane[f.jmeno] = { soubor: kratce, prava }
    ok(`${kratce} › ${f.jmeno}: začíná pripravit(formData, ${m ? m[1] : '?'}) a vrací se při odmítnutí`, Boolean(m) && prava.length > 0)
    ok(`${kratce} › ${f.jmeno}: právo je přesně ${(OCEKAVANA_PRAVA[f.jmeno] ?? ['?']).join(' + ')}`, JSON.stringify(prava) === JSON.stringify(OCEKAVANA_PRAVA[f.jmeno] ?? null))
    const iPrip = f.telo.indexOf('await pripravit(')
    const poradi = ['.rpc(', 'klientUlohy(', 'otevritRelaciPokladny(', 'rozpoznatDoklad(', 'naparovatPolozky(', '.download(']
      .map((x) => f.telo.indexOf(x))
      .filter((i) => i >= 0)
    ok(`${kratce} › ${f.jmeno}: RPC, služba, pokladna i AI až po pripravit`, iPrip > 0 && poradi.every((i) => i > iPrip))

    // RPC jen s právem, které chce.
    const volane = [...new Set(rpcPrechodne(f))]
    const spatne = volane.filter((r) => !PRAVO_RPC[r] || !PRAVO_RPC[r].some((x) => prava.includes(x)))
    ok(`${kratce} › ${f.jmeno}: volá jen RPC, které jeho právo (${prava.join(' + ') || '?'}) pouští${spatne.length ? ` — navíc: ${spatne.join(', ')}` : ''}`, volane.length > 0 && spatne.length === 0)
    if (prava.includes('jine_platby.trzba') && !prava.includes('jine_platby.vydej_pos')) {
      ok(`${kratce} › ${f.jmeno}: tržní akce nevolá skladovou funkci`, !volane.some((r) => SKLADOVE_RPC.includes(r)))
    }
    if ((prava.includes('jine_platby.vydej_pos') || prava.includes('jine_platby.sklad_odeslat')) && !prava.includes('jine_platby.trzba')) {
      ok(`${kratce} › ${f.jmeno}: skladová akce nevolá tržní funkci`, !volane.some((r) => TRZNI_RPC.includes(r)))
    }
  }
}
{
  const s = zdroj(`${KOREN}/akce.ts`)
  const f = new Map(funkce(s).map((x) => [x.jmeno, x.telo]))
  ok("prohlasitTrzbu posílá p_druh: 'trzba' (s právem trzba)", /p_druh: 'trzba'/.test(f.get('prohlasitTrzbu') ?? '') && !/p_druh: 'sklad'/.test(f.get('prohlasitTrzbu') ?? ''))
  ok("prohlasitSklad posílá p_druh: 'sklad' (s právem vydej_pos)", /p_druh: 'sklad'/.test(f.get('prohlasitSklad') ?? '') && !/p_druh: 'trzba'/.test(f.get('prohlasitSklad') ?? ''))
  const pos = new Map(funkce(zdroj(`${KOREN}/akce-pos.ts`)).map((x) => [x.jmeno, x.telo]))
  ok("zkontrolovatTrzbu → kontrolaVPokladne(p, 'trzba'), zkontrolovatSklad → (p, 'sklad')",
    /kontrolaVPokladne\(p, 'trzba'\)/.test(pos.get('zkontrolovatTrzbu') ?? '') && /kontrolaVPokladne\(p, 'sklad'\)/.test(pos.get('zkontrolovatSklad') ?? ''))
  ok(`akcí se našlo dost (${Object.keys(exportovane).length})`, Object.keys(exportovane).length >= 23)
  // Že ji žádná tržní akce nevolá, hlídá smyčka výš („tržní akce nevolá skladovou funkci“ — je v SKLADOVE_RPC).
  ok('zrusitSchvaleni je exportovaná akce v akce.ts s právem vydej_pos a volá jine_platby_zrusit_schvaleni',
    exportovane.zrusitSchvaleni?.soubor === 'akce.ts' && JSON.stringify(exportovane.zrusitSchvaleni.prava) === '["jine_platby.vydej_pos"]' &&
      rpcV(funkce(zdroj(`${KOREN}/akce.ts`)).find((x) => x.jmeno === 'zrusitSchvaleni')?.telo ?? '').includes('jine_platby_zrusit_schvaleni'))
}

console.log('\n== 3b. pripravit: firma → vstup → záznam s tenantem → právo na pobočce záznamu ==')
{
  const s = zdroj(`${ZAZNAM}/akce-zaklad.ts`)
  ok("akce-zaklad.ts je 'server-only' a NENÍ 'use server' (jeho exporty nejsou akce)", /^import 'server-only'$/m.test(s) && !/'use server'/.test(s))
  const p = funkce(s).find((x) => x.jmeno === 'pripravit')?.telo ?? ''
  const prvniAwait = p.match(/await (\w+)\(/)
  ok('první await v pripravit je getCurrentTenantId()', prvniAwait?.[1] === 'getCurrentTenantId')
  const iPristup = p.indexOf('zkusPristupJinymPlatbam(tenantId, ')
  const iZaznam = p.indexOf(".from('jine_platby')")
  const iTenant = p.indexOf(".eq('tenant_id', tenantId)")
  const iRozsah = p.indexOf('zaznamPatriRozsahu(')
  const iPravo = p.indexOf('hasAccess(tenantId, pravo, z.branchId)')
  const iOk = p.indexOf('ok: true')
  ok('pořadí: vstup → záznam (.eq tenant_id) → patří rozsahu → hasAccess na pobočce záznamu → ok',
    iPristup > 0 && iZaznam > iPristup && iTenant > iZaznam && iRozsah > iTenant && iPravo > iRozsah && iOk > iPravo)
  ok('bez práva vrací odmítnutí (ne pokračování)', /if \(!smi\) return ne\(HLASKA_PRAVO\)/.test(p) && p.indexOf('if (!smi) return ne(HLASKA_PRAVO)') < iOk)
}

/* =====================================================================
 * 4. POKLADNA: zápis jen přes orchestrátor
 * ===================================================================== */

console.log('\n== 4. Pokladna: zápis jen přes provestOperaci ==')
{
  const s = zdroj(`${KOREN}/akce-pos.ts`)
  const fce = funkce(s)
  const pos = fce.find((f) => f.jmeno === 'posProOperaci')?.telo ?? ''
  const zapisy = [...s.matchAll(/(?<!schopnosti)\.skladovyVydej\b/g)].map((m) => m.index)
  const iPos = s.indexOf(pos)
  ok(`metoda zápisu relace (.skladovyVydej) jen uvnitř posProOperaci (${zapisy.length}×)`, zapisy.length > 0 && zapisy.every((i) => i > iPos && i < iPos + pos.length))
  ok('posProOperaci zápis jen předá (odeslat: …) a jen se schopností api (povolená provozovna), nevolá ho',
    /odeslat: schopnost === 'api' && zapis \? \(op: OperacePos\) => zapis\(op\) : undefined/.test(pos) && !/await zapis/.test(pos))
  ok('nikde přímé .odeslat( ani skladovyVydej(', !/\.odeslat\(/.test(s) && !/skladovyVydej\(/.test(s))
  const volani = [...s.matchAll(/posProOperaci\(rel\.relace/g)].length
  const vOrchestratoru = [...s.matchAll(/(?:provestOperaci|obnovitOperaci)\(op, repoOperaci\(uloha\), posProOperaci\(rel\.relace/g)].length
  ok(`každé posProOperaci(…) jde rovnou do provestOperaci/obnovitOperaci (${vOrchestratoru} z ${volani})`, volani > 0 && volani === vOrchestratoru)
  const repo = fce.find((f) => f.jmeno === 'repoOperaci')?.telo ?? ''
  const mimoRepo = fce.filter((f) => f.jmeno !== 'repoOperaci').some((f) => /pos_operace_(zahajit|dokoncit)/.test(f.telo))
  ok('pos_operace_zahajit/_dokoncit jen v repoOperaci', /pos_operace_zahajit/.test(repo) && /pos_operace_dokoncit/.test(repo) && !mimoRepo)
}

/* =====================================================================
 * 5. AI: nikdy ukázka
 * ===================================================================== */

console.log('\n== 5. Rozpoznání: bez klíče chyba, nikdy ukázka ==')
{
  const s = zdroj(`${KOREN}/akce-ai.ts`)
  ok('akce-ai.ts nemá ukázkový/vzorový doklad', !/ukazk|ukázk|demo|mock|priklad|příklad|vzorov|fake|sample/i.test(s))
  const r = funkce(s).find((f) => f.jmeno === 'rozpoznat')?.telo ?? ''
  ok('bez klíče: return chyba(HLASKA_BEZ_AI) dřív, než se cokoli stáhne nebo započítá',
    r.indexOf('if (!rozpoznavaniJeNastavene()) return chyba(HLASKA_BEZ_AI)') > 0 &&
      r.indexOf('if (!rozpoznavaniJeNastavene()) return chyba(HLASKA_BEZ_AI)') < r.indexOf('.download(') &&
      r.indexOf('if (!rozpoznavaniJeNastavene()) return chyba(HLASKA_BEZ_AI)') < r.indexOf('klientUlohy('))
  ok("stav 'bez_klice' z modelu → HLASKA_BEZ_AI", /if \(vysledek\.stav === 'bez_klice'\) \{[^}]*return chyba\(HLASKA_BEZ_AI\)/.test(r))
}

/* =====================================================================
 * 6. OBRAZOVKA: věty se opravdu vykreslí
 * ===================================================================== */

console.log('\n== 6. Obrazovka: co se opravdu vykreslí ==')

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')
const REACT = import.meta.resolve('react')
const PRAZDNY = js('')
const STUB_LINK = js(
  `import { createElement } from ${JSON.stringify(REACT)}\n` +
    'export default function Link({ href, children, prefetch, scroll, ...r }) { return createElement("a", { href, ...r }, children) }',
)
const STUB_AKCE = js(
  ['ulozitNavrh', 'oznacitZkontrolovano', 'prohlasitTrzbu', 'prohlasitSklad', 'potvrditTrzbu', 'opravitTrzbu', 'odeslatSklad', 'propojitVydej', 'rucneDolozit', 'zrusitSchvaleni', 'korekceVydeje', 'faktura', 'evidovatUhradu', 'ulozitMapovani', 'zrusit']
    .map((n) => `export async function ${n}() { return { stav: 'nic', text: '' } }`)
    .join('\n'),
)
const STUB_AKCE_POS = js(
  ['zkontrolovatTrzbu', 'zkontrolovatSklad', 'rozhodnoutVydej', 'provestVydej', 'vydejZnovu', 'obnovitVydej', 'nacistKatalog']
    .map((n) => `export async function ${n}() { return { stav: 'nic', text: '' } }`)
    .join('\n'),
)
const STUB_AKCE_PAROVANI = js(`export async function najitVPokladne() { return { stav: 'nic', text: '' } }`)
const KRESLENI = [
  ['next/link', STUB_LINK],
  ['../akce', STUB_AKCE],
  ['../akce-pos', STUB_AKCE_POS],
  ['../akce-parovani', STUB_AKCE_PAROVANI],
]

const textHtml = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
/** Jednotlivé formuláře v kusu HTML (bez vnoření — formuláře se nevnořují). */
const formulare = (html) => [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0])
const tlacitka = (html) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textHtml(m[1]).trim())

const ZAZNAM_ID = '11111111-2222-4333-8444-555555555555'
const zaznam = (prepis = {}) => ({
  id: ZAZNAM_ID,
  tenantId: 'T1',
  branchId: 'B1',
  pripojeniId: 'P1',
  posProvozovna: 'PROV1',
  datumProdeje: '2026-10-15',
  oznaceni: 'Stůl 4',
  kontaktId: null,
  mena: 'CZK',
  castkaHaleru: 45000,
  castkaPuvod: 'doklad',
  typDokladu: 'uzavreny_prodej',
  externiUcet: '1234',
  posProdejId: null,
  stavKontroly: 'zkontrolovano',
  stavTrzby: 'nezapsano',
  stavSkladu: 'bez_navrhu',
  stavFaktury: 'bez_faktury',
  fakturaCislo: null,
  fakturaZdroj: null,
  fakturaCastkaHaleru: null,
  stavUhrady: 'neovereno',
  uhradaTransakceId: null,
  uhradaCastkaHaleru: null,
  kontrolaTrzby: null,
  kontrolaSkladu: null,
  pokladnaTrzby: null,
  pokladnaSkladu: null,
  nedohledanaOperace: null,
  upozorneniDokladu: [],
  rozpoznaniId: null,
  verze: 3,
  vytvoril: 'U1',
  vytvoreno: '2026-10-15T10:00:00Z',
  zmeneno: '2026-10-15T10:00:00Z',
  ...prepis,
})
const TED = Date.parse('2026-10-16T12:00:00Z')
const zakl = { zaznam: ZAZNAM_ID, verze: 3, rozsah: 'bernard-bar' }

const SekceTrzba = await nactiKomponentu(`${ZAZNAM}/sekce-trzba.tsx`, KRESLENI)
const SekceSklad = await nactiKomponentu(`${ZAZNAM}/sekce-sklad.tsx`, KRESLENI)
{
  const props = (z, akce = []) => ({ zakl, z, akce: new Set(akce), maPokladnu: true, umiDohledani: true, duplicity: [], trzby: [], tedMs: TED, jmena: { U1: 'Kateřina' }, zona: 'Europe/Prague' })
  const html = textHtml(renderToStaticMarkup(createElement(SekceTrzba, props(zaznam()))))
  ok('Tržba: věta „Fotografie sjetiny nedokazuje přijetí peněz.“ je na obrazovce', html.includes('Fotografie sjetiny nedokazuje přijetí peněz.'))

  const kdy = new Date(TED - 5 * 60_000).toISOString()
  const rucni = textHtml(renderToStaticMarkup(createElement(SekceTrzba, props(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'rucni_prohlaseni', verze: 3, kdy, kdo: 'U1', detail: { duvod: 'Akce mimo provozovnu' } } })))))
  ok('Tržba: ruční prohlášení se vykreslí jako ruční (s důvodem), ne jako ověření pokladnou',
    rucni.includes('ruční prohlášení člověka — pokladnou neověřeno') && rucni.includes('Akce mimo provozovnu') && !rucni.includes('ověřeno v pokladně (dotaz appky)'))
  const auto = textHtml(renderToStaticMarkup(createElement(SekceTrzba, props(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 3, kdy, kdo: 'U1', detail: {} } })))))
  ok('Tržba: dotaz do pokladny se vykreslí jako ověření pokladnou, ne jako ruční', auto.includes('ověřeno v pokladně (dotaz appky)') && !auto.includes('pokladnou neověřeno'))
  const stara = textHtml(renderToStaticMarkup(createElement(SekceTrzba, props(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 2, kdy, kdo: null, detail: {} } })))))
  ok('Tržba: kontrola ke starší verzi záznamu se hlásí jako neplatná', stara.includes('patří ke starší verzi záznamu'))

  const zapis = renderToStaticMarkup(createElement(SekceTrzba, props(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 3, kdy, kdo: null, detail: {} } }), ['potvrdit_trzbu'])))
  ok('Tržba: po „nenalezeno“ tlačítko „Zapsat do Ostatních tržeb“ s rezim=nova', tlacitka(zapis).includes('Zapsat do Ostatních tržeb') && /name="rezim" value="nova"/.test(zapis))
  const propojit = renderToStaticMarkup(createElement(SekceTrzba, props(zaznam({ kontrolaTrzby: { vysledek: 'pravdepodobne', zdroj: 'pos_api', verze: 3, kdy, kdo: null, detail: {} } }), ['potvrdit_trzbu'])))
  ok('Tržba: po „pravděpodobně“ jen „propojit“ (rezim=propojit), nikdy nová tržba', /name="rezim" value="propojit"/.test(propojit) && !/value="nova"/.test(propojit))

  const skladProps = (z, akce, prepis = {}) => ({
    zakl,
    z,
    akce: new Set(akce),
    maPokladnu: true,
    pokladna: { nazev: 'Dotykačka Bernard', nazevPoskytovatele: 'Dotykačka', dohledaniUctu: true, skladovyVydej: 'rucne' },
    provozovna: 'Bernard Bar',
    nahled: null,
    navrh: null,
    operace: null,
    prevody: [],
    originaly: [],
    duplicity: [],
    jednotkyProduktu: {},
    muzeSchvalit: false,
    vydej: { externiId: null, doklad: null },
    tedMs: TED,
    jmena: {},
    zona: 'Europe/Prague',
    ...prepis,
  })
  const navrh = { id: '99999999-2222-4333-8444-555555555555', stav: 'schvaleno', otisk: 'a'.repeat(64), polozky: [{ poradi: 1, posProduktId: 'X1', nazev: 'Pivo 0,5 l', mnozstvi: '2' }], odeslal: null, odeslano: '2026-10-16T10:00:00Z', schvalil: null, schvaleno: null, zamitl: null, zamitnuto: null, duvodZamitnuti: null }
  const operace = { stav: 'nepodporovano', pokusu: 0, platnostDo: null, externiId: null, externiDoklad: null, chyba: 'Pokladna výdej přes API neumí', duvod: null, zahajeno: '2026-10-16T10:01:00Z', dokonceno: '2026-10-16T10:01:00Z' }
  const sklad = renderToStaticMarkup(createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'nepodporovano' }), ['rucne_dolozit'], { navrh, operace })))
  ok('Sklad: tlačítko „Ručně doloženo“ je na obrazovce, když ho akce dovolí', tlacitka(sklad).includes('Ručně doloženo'))
  ok('Sklad: u pokladny bez zápisu přes API je vidět ruční postup', textHtml(sklad).includes('Ruční zpracování — appka zápis do skladu pokladny Dotykačka zatím neprovádí'))
  const bez = renderToStaticMarkup(createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'nepodporovano' }), [], { navrh, operace })))
  ok('Sklad: bez akce „rucne_dolozit“ se tlačítko nekreslí (kontrola rozezná oba stavy)', !tlacitka(bez).includes('Ručně doloženo'))
  ok('Sklad: věta „Odeslání ke schválení ani nahrání fotky sklad nemění.“ je na obrazovce', textHtml(sklad).includes('Odeslání ke schválení ani nahrání fotky sklad nemění.'))

  const schvaleni = renderToStaticMarkup(
    createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], { navrh: { ...navrh, stav: 'ceka_na_schvaleni' }, muzeSchvalit: true })),
  )
  const formSchvaleni = formulare(schvaleni).find((x) => tlacitka(x).includes('Potvrdit výdej do POS')) ?? ''
  ok('Sklad: formulář „Potvrdit výdej do POS“ nese otisk návrhu a rozhodnuti=schvalit ve skrytých polích',
    formSchvaleni.includes(`name="otisk" value="${'a'.repeat(64)}"`) && formSchvaleni.includes('name="rozhodnuti" value="schvalit"') && formSchvaleni.includes(`name="navrh" value="${navrh.id}"`))
  const bezKontroly = renderToStaticMarkup(
    createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], { navrh: { ...navrh, stav: 'ceka_na_schvaleni' }, muzeSchvalit: false })),
  )
  ok('Sklad: bez čerstvé kontroly „neodečteno“ se „Potvrdit výdej do POS“ nenabídne (zamítnout ano)', !tlacitka(bezKontroly).includes('Potvrdit výdej do POS') && tlacitka(bezKontroly).includes('Zamítnout'))
  // Ověření 21. 10. (cesta B, sklad): pokladna už odečetla — obrazovka řekne proč schválit nejde.
  const odectenoZ = zaznam({ stavSkladu: 'ceka_na_schvaleni', pokladnaSkladu: { vysledek: 'jiz_odecteno', zdroj: 'pos_api', verze: 3, kdy: '2026-10-16T10:00:00Z', kdo: null, detail: { zdroj_shody: 'prodej', externi_id: 'POS-S8' } } })
  const odectenoS = renderToStaticMarkup(createElement(SekceSklad, skladProps(odectenoZ, ['rozhodnout_vydej'], { navrh: { ...navrh, stav: 'ceka_na_schvaleni' }, muzeSchvalit: false })))
  ok('Ověření 21. 10.: sklad — pokladna už odečetla (POS-S8) → „Potvrdit výdej“ ne a obrazovka řekne proč (s účtem)',
    !tlacitka(odectenoS).includes('Potvrdit výdej do POS') && textHtml(odectenoS).includes('spotřebu už odečetla (účet POS-S8)'))
  ok('Ověření 21. 10. (protipříklad): bez nálezu stará věta o čerstvé kontrole', textHtml(bezKontroly).includes('Potvrdit výdej jde jen s čerstvou kontrolou') && !textHtml(bezKontroly).includes('spotřebu už odečetla'))
  const trzbaProps = (z, akce) => ({ zakl, z, akce: new Set(akce), maPokladnu: true, umiDohledani: true, smiOpravit: false, duplicity: [], trzby: [], tedMs: TED, jmena: {}, zona: 'Europe/Prague' })
  const cestaBZ = zaznam({
    kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 3, kdy: '2026-10-16T10:00:00Z', kdo: null, detail: {} },
    pokladnaTrzby: { vysledek: 'nalezeno', zdroj: 'pos_api', verze: 2, kdy: '2026-10-16T09:00:00Z', kdo: null, detail: { pos_prodej_id: 'POS-B7' } },
  })
  const cestaBT = renderToStaticMarkup(createElement(SekceTrzba, trzbaProps(cestaBZ, ['prohlasit_trzbu'])))
  ok('Ověření 21. 10.: tržba — „nenalezeno“ proti dřívějšímu nálezu pokladny (POS-B7) → obrazovka řekne, proč novou tržbu zapsat nejde',
    textHtml(cestaBT).includes('Pokladna při dřívější kontrole našla konkrétní prodej (účet POS-B7)') && !tlacitka(cestaBT).includes('Zapsat do Ostatních tržeb'))
  ok('Ověření 22. 10.: věta pamatuje i na špatně přečtené číslo (výsledek přepíše člověk s právem na opravy), ne jen „vraťte číslo“',
    textHtml(cestaBT).includes('Když bylo číslo přečtené špatně a pokladna našla cizí účet, ať výsledek přepíše člověk s právem na opravy'))
  const bezNalezu = renderToStaticMarkup(createElement(SekceTrzba, trzbaProps({ ...cestaBZ, pokladnaTrzby: null }, ['prohlasit_trzbu', 'potvrdit_trzbu'])))
  ok('Ověření 21. 10. (protipříklad): bez nálezu se zápis nabízí a věta o dřívější kontrole chybí',
    tlacitka(bezNalezu).includes('Zapsat do Ostatních tržeb') && !textHtml(bezNalezu).includes('dřívější kontrole'))
  // Databáze schválení s nevyřešenou položkou nebo nad nezkontrolovaným záznamem odmítne — obrazovka řekne proč.
  const sBlokaci = renderToStaticMarkup(
    createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], {
      navrh: { ...navrh, stav: 'ceka_na_schvaleni' },
      muzeSchvalit: true,
      nahled: { polozky: [], polozek: 1, blokace: [{ poradi: 2, nazev: 'Svíčková', duvod: 'Položka čeká na kontrolu.' }], varovani: [] },
    })),
  )
  ok('Sklad: nevyřešená položka → „Potvrdit výdej do POS“ se nenabídne a je vidět proč (zamítnout ano)',
    !tlacitka(sBlokaci).includes('Potvrdit výdej do POS') && textHtml(sBlokaci).includes('Návrh má nevyřešené položky') &&
      textHtml(sBlokaci).includes('Položka 2 (Svíčková): Položka čeká na kontrolu.') && tlacitka(sBlokaci).includes('Zamítnout'))
  const nezkontrolovany = renderToStaticMarkup(
    createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'ceka_na_schvaleni', stavKontroly: 'rozpracovano' }), ['rozhodnout_vydej'], { navrh: { ...navrh, stav: 'ceka_na_schvaleni' }, muzeSchvalit: false })),
  )
  ok('Sklad: záznam po úpravě nezkontrolovaný → vysvětlení „není označený jako zkontrolovaný“, ne „chybí kontrola v pokladně“',
    textHtml(nezkontrolovany).includes('není označený jako zkontrolovaný') && !textHtml(nezkontrolovany).includes('jen s čerstvou kontrolou'))

  console.log('\n-- opravy 18. 10.: sklad --')
  // Schválení: „Proč to není duplicita“ je ve formuláři schválení VŽDY (i bez duplicit na obrazovce), nepovinné;
  // zamítnutí má svoje povinné pole `duvod` a pole duplicity nemá (dvě pole, ať se nepletou).
  const textarea = (form, nazev) => form.match(new RegExp(`<textarea\\b[^>]*name="${nazev}"[^>]*>`))?.[0] ?? null
  const formZamitnuti = formulare(schvaleni).find((x) => tlacitka(x).includes('Zamítnout')) ?? ''
  const poleDupl = textarea(formSchvaleni, 'duplicita_duvod')
  ok('Sklad: formulář schválení má nepovinné pole duplicita_duvod (i bez duplicit) a nemá pole duvod',
    poleDupl !== null && !/\srequired=""/.test(poleDupl) && textarea(formSchvaleni, 'duvod') === null && textHtml(formSchvaleni).includes('Proč to není duplicita'))
  ok('Sklad: formulář zamítnutí má povinné pole duvod a NEMÁ duplicita_duvod',
    /\srequired=""/.test(textarea(formZamitnuti, 'duvod') ?? '') && textarea(formZamitnuti, 'duplicita_duvod') === null && /name="rozhodnuti" value="zamitnout"/.test(formZamitnuti))
  const sDupl = renderToStaticMarkup(
    createElement(
      SekceSklad,
      skladProps(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], {
        navrh: { ...navrh, stav: 'ceka_na_schvaleni' },
        muzeSchvalit: true,
        duplicity: [{ zaznamId: 'Z2', duvod: 'Stejná provozovna, den, částka a měna', jista: false, odkaz: '/bernard-bar/finance/trzby/jine-platby/Z2' }],
      }),
    ),
  )
  ok('Sklad: možné duplicity se u schválení ukážou s odkazem na druhý záznam',
    textHtml(sDupl).includes('Možné duplicity výdeje') && textHtml(sDupl).includes('Stejná provozovna, den, částka a měna') && sDupl.includes('href="/bernard-bar/finance/trzby/jine-platby/Z2"'))
  ok('Sklad: bez duplicit se seznam duplicit nekreslí (kontrola rozezná oba stavy)', !textHtml(schvaleni).includes('Možné duplicity výdeje'))

  // Ručně doloženo: skrytý otisk ŽIVÉHO schváleného návrhu; bez schváleného návrhu (záznam bez pokladny) žádný otisk.
  const formRucne = formulare(sklad).find((x) => tlacitka(x).includes('Ručně doloženo')) ?? ''
  ok('Sklad: formulář „Ručně doloženo“ nese otisk schváleného návrhu ve skrytém poli', formRucne.includes(`type="hidden" name="otisk" value="${'a'.repeat(64)}"`))
  const bezPokladny = renderToStaticMarkup(createElement(SekceSklad, skladProps(zaznam({ pripojeniId: null, stavSkladu: 'bez_navrhu' }), ['rucne_dolozit'], { maPokladnu: false, pokladna: null })))
  const formBez = formulare(bezPokladny).find((x) => tlacitka(x).includes('Ručně doloženo')) ?? ''
  ok('Sklad: bez pokladny (bez návrhu) formulář „Ručně doloženo“ otisk nenese', formBez !== '' && !/name="otisk"/.test(formBez))

  // Zrušit schválení: jen s akcí, dvoukrokové, povinný důvod a vysvětlení „když už odepsáno → Ručně doloženo“.
  const zrus = renderToStaticMarkup(createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'nepodporovano' }), ['zrusit_schvaleni'], { navrh, operace })))
  const formZrus = formulare(zrus).find((x) => tlacitka(x).includes('Zrušit schválení (v pokladně nic neodepsáno)')) ?? ''
  ok('Sklad: s akcí zrusit_schvaleni je tlačítko „Zrušit schválení (v pokladně nic neodepsáno)“ s povinným důvodem',
    formZrus !== '' && /\srequired=""/.test(textarea(formZrus, 'duvod') ?? ''))
  ok('Sklad: u zrušení schválení je vysvětlení, že při odepsaném použijte „Ručně doloženo“', /Když už v pokladně odepsáno je[^.]*Ručně doloženo/.test(textHtml(formZrus)))
  ok('Sklad: bez akce zrusit_schvaleni se tlačítko nekreslí', !tlacitka(sklad).includes('Zrušit schválení (v pokladně nic neodepsáno)'))

  // Jednotka produktu z katalogu (česky), ne natvrdo „ks“.
  const sJednotkou = textHtml(renderToStaticMarkup(createElement(SekceSklad, skladProps(zaznam({ stavSkladu: 'nepodporovano' }), [], { navrh, operace, jednotkyProduktu: { X1: 'l' } }))))
  ok('Sklad: množství v panelu nese jednotku produktu z katalogu („2 l“)', sJednotkou.includes('Pivo 0,5 l — 2 l (jednotka prodeje pokladny)'))
  ok('Sklad: bez jednotky v katalogu „(v jednotkách prodeje pokladny)“, žádné vymyšlené „ks“',
    textHtml(sklad).includes('Pivo 0,5 l — 2 (v jednotkách prodeje pokladny)') && !/Pivo 0,5 l — 2 ks/.test(textHtml(sklad)))

  console.log('\n-- opravy 18. 10.: tržba --')
  // „Proč to není duplicita“ u zápisu i propojení VŽDY, nepovinné — i bez duplicit na obrazovce.
  const formZapis = formulare(zapis).find((x) => tlacitka(x).includes('Zapsat do Ostatních tržeb')) ?? ''
  const formPropojit = formulare(propojit).find((x) => /value="propojit"/.test(x)) ?? ''
  ok('Tržba: pole duplicita_duvod je u zápisu i propojení vždy (bez duplicit na obrazovce) a je nepovinné',
    [formZapis, formPropojit].every((x) => {
      const t = textarea(x, 'duplicita_duvod')
      return t !== null && !/\srequired=""/.test(t)
    }))

  // Dodatečná kontrola: po zápisu pokladna prodej našla → výrazné varování s odkazem na opravu.
  const zapsana = (vysledek) => zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: { vysledek, zdroj: 'pos_api', verze: 3, kdy, kdo: null, detail: {} } })
  const dvakrat = renderToStaticMarkup(createElement(SekceTrzba, props(zapsana('nalezeno'), ['opravit_trzbu', 'kontrola_trzby'])))
  const VAROVANI_DVAKRAT = 'Pokladna tento prodej má — tržba je možná zapsaná dvakrát. Ověřte a případně stornujte Ostatní tržbu.'
  ok('Tržba: zapsaná tržba + pokladna prodej našla → varování „možná zapsaná dvakrát“ (role=alert) s ikonou a odkazem na opravu',
    textHtml(dvakrat).includes(VAROVANI_DVAKRAT) && /role="alert"/.test(dvakrat) && dvakrat.includes('href="#oprava-trzby"') && /<details[^>]*id="oprava-trzby"[^>]*open=""/.test(dvakrat))
  ok('Tržba: po zápisu je „Zkontrolovat v pokladně“ (dodatečná kontrola), když ji akce dovolí', tlacitka(dvakrat).includes('Zkontrolovat v pokladně') && textHtml(dvakrat).includes('Dodatečná kontrola'))
  const neniDvakrat = textHtml(renderToStaticMarkup(createElement(SekceTrzba, props(zapsana('nenalezeno'), ['opravit_trzbu']))))
  ok('Tržba: zapsaná tržba a kontrola „nenalezeno“ → žádné varování (kontrola rozezná oba stavy)', !neniDvakrat.includes(VAROVANI_DVAKRAT))
}

console.log('\n-- opravy 18. 10.: kontrola dokladu („Co zkontrolovat“, důvod rozdílu) --')
{
  const STUB_AKCE_AI = js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")
  const SekceKontrola = await nactiKomponentu(`${ZAZNAM}/sekce-kontrola.tsx`, [...KRESLENI, ['../akce-ai', STUB_AKCE_AI]])
  const L0 = await import(`../${ZAZNAM}/logika.ts`)
  const kprops = (body, nesoulad) => ({
    zakl,
    z: zaznam({ stavKontroly: 'ke_kontrole' }),
    akce: new Set(['oznacit_zkontrolovano']),
    smiUpravit: false,
    editor: { hlavicka: {}, polozky: [], katalog: [], kontakty: null },
    polozky: [],
    rozpoznani: null,
    kontrolaRozpoznani: null,
    coZkontrolovat: body,
    nesoulad,
    ai: { zapnuto: false, pocetSouboru: 0 },
    katalog: null,
    zona: 'Europe/Prague',
  })
  const body = [
    { text: 'Položka 2 „Svíčková“: Řádek přečtený nejistě', blokuje: 'ano' },
    { text: 'Celkem na dokladu nesedí se součtem položek', blokuje: 'bez_duvodu' },
    { text: 'Záznam nemá žádné položky', blokuje: 'ne' },
  ]
  const s = renderToStaticMarkup(createElement(SekceKontrola, kprops(body, 'Celkem na dokladu (450,00 Kč) nesedí se součtem položek (90,00 Kč) — rozdíl 360,00 Kč')))
  const t = textHtml(s)
  ok('Kontrola: nadpis „Co zkontrolovat“ (ne „Co ještě brání“)', t.includes('Co zkontrolovat') && !t.includes('Co ještě brání'))
  ok('Kontrola: u každého bodu je vidět, jestli označení blokuje, nebo je to jen upozornění',
    t.includes('Blokuje označení: Položka 2') && t.includes('Blokuje bez důvodu: Celkem na dokladu') && t.includes('Jen upozornění: Záznam nemá žádné položky'))
  const formOzn = formulare(s).find((x) => tlacitka(x).includes('Označit jako zkontrolované')) ?? ''
  ok('Kontrola: při nesouladu má formulář povinné pole „Proč rozdíl nevadí“ (duvod_rozdilu)',
    /<textarea\b[^>]*name="duvod_rozdilu"[^>]*required=""/.test(formOzn) && textHtml(formOzn).includes('Proč rozdíl nevadí'))
  const bez = renderToStaticMarkup(createElement(SekceKontrola, kprops([], null)))
  ok('Kontrola: bez nesouladu pole duvod_rozdilu není', !/name="duvod_rozdilu"/.test(bez))

  // coZkontrolovat (spouští se): co blokuje a co je jen upozornění.
  const pol = (prepis) => ({ nazevPuvodni: '', nazev: 'Pivo', mnozstvi: '2', jednotka: 'ks', cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 9000, sazbaDph: null, jistota: 0.9, zdroj: 'ai', druh: 'rozlevany_napoj', posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', vyzadujeKontrolu: false, duvodKontroly: '', ...prepis })
  const hl = (prepis) => ({ datumProdeje: '2026-10-15', oznaceni: '', mena: 'CZK', castkaHaleru: 9000, castkaPuvod: 'doklad', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null, ...prepis })
  const sedi = L0.coZkontrolovat([pol()], hl())
  ok('coZkontrolovat: vše sedí → nic k zkontrolování, žádný nesoulad', sedi.body.length === 0 && sedi.nesoulad === null)
  const priznak = L0.coZkontrolovat([pol({ vyzadujeKontrolu: true, duvodKontroly: 'Řádek přečtený nejistě (jistota 50 %)' })], hl())
  ok('coZkontrolovat: řádek s příznakem → blokuje, s číslem a důvodem', priznak.body.length === 1 && priznak.body[0].blokuje === 'ano' && priznak.body[0].text.startsWith('Položka 1 „Pivo“: Řádek přečtený nejistě'))
  const rozdil = L0.coZkontrolovat([pol()], hl({ castkaHaleru: 9100 }))
  ok('coZkontrolovat: rozdíl 1 Kč v CZK → „blokuje bez důvodu“ + nesoulad', rozdil.nesoulad !== null && rozdil.body.some((b) => b.blokuje === 'bez_duvodu') && !rozdil.body.some((b) => b.blokuje === 'ano'))
  const zaokr = L0.coZkontrolovat([pol()], hl({ castkaHaleru: 9050 }))
  ok('coZkontrolovat: rozdíl do 50 haléřů v CZK je zaokrouhlení (žádný nesoulad)', zaokr.nesoulad === null)
  const eur = L0.coZkontrolovat([pol()], hl({ mena: 'EUR', castkaHaleru: 9001 }))
  ok('coZkontrolovat: v EUR nesoulad i o haléř', eur.nesoulad !== null)
  const chybi = L0.coZkontrolovat([pol()], hl({ datumProdeje: null, mena: null, castkaHaleru: null }))
  ok('coZkontrolovat: chybí datum, měna a částka → tři blokující body, každý jednou',
    chybi.body.filter((b) => b.blokuje === 'ano').map((b) => b.text).join('|') === 'Chybí datum prodeje (provozní den)|Chybí měna|Chybí celková cena prodeje' &&
      chybi.body.filter((b) => /Chybí (měna|datum|celková)/.test(b.text)).length === 3)
  const prazdny = L0.coZkontrolovat([], hl())
  ok('coZkontrolovat: bez položek → jen upozornění (databáze označení nebrání)', prazdny.body.length === 1 && prazdny.body[0].blokuje === 'ne')
}

/* =====================================================================
 * 7. CHOVÁNÍ AKCÍ s podvrženou databází, právy a pokladnou
 * ===================================================================== */

console.log('\n== 7. Akce naostro (podvržená databáze): právo před RPC, chyby, AI, pokladna ==')

const SVET = 'globalThis.__jp'
const SPOLECNE = [
  ['server-only', PRAZDNY],
  ['next/cache', js(`export function revalidatePath(p) { ${SVET}.log.push(['revalidate', p]) }`)],
  [
    '@/lib/authz',
    js(
      "export const TENANT_SCOPE_SEGMENT = 'firma'\n" +
        `export async function hasAccess(t, p, b) { ${SVET}.log.push(['hasAccess', p, b, t]); return ${SVET}.prava.has(p) }\n` +
        `export async function getUser() { return ${SVET}.uzivatel }`,
    ),
  ],
  ['@/lib/firma', js(`export async function getCurrentTenantId() { ${SVET}.log.push(['tenant']); return ${SVET}.tenant }`)],
  ['@/lib/jine-platby-pristup', js(`export async function zkusPristupJinymPlatbam(t, r) { ${SVET}.log.push(['pristup', t, r]); return ${SVET}.pristup }`)],
  ['@/lib/supabase/server', js(`export async function getServerSupabase() { return ${SVET}.klient('uzivatel') }`)],
  ['@/lib/supabase/uloha', js(`export function klientUlohy() { ${SVET}.log.push(['klientUlohy']); return ${SVET}.klient('sluzba') }`)],
  ['@/lib/supabase/dotaz', js("export function funkceNeexistuje(e) { return e?.code === 'PGRST202' || e?.code === '42883' }")],
  ['@/lib/pokladna-relace', js(`export async function otevritRelaciPokladny(p, t) { ${SVET}.log.push(['relace', p, t]); return ${SVET}.relace }`)],
  [
    '@/lib/jine-platby-ai',
    js(
      `export function rozpoznavaniJeNastavene() { return ${SVET}.ai.zapnuto }\n` +
        `export async function rozpoznatDoklad(p, m) { ${SVET}.log.push(['ai', p.soubory.length, m]); if (${SVET}.ai.vyhodit) throw new Error('bum'); return ${SVET}.ai.vysledek }`,
    ),
  ],
]
const ZAKLAD = adresaModulu(`${ZAZNAM}/akce-zaklad.ts`, SPOLECNE)
const NAHRADY = [...SPOLECNE, ['./[zaznam]/akce-zaklad', ZAKLAD]]
const akce = await import(adresaModulu(`${KOREN}/akce.ts`, NAHRADY))
const akcePos = await import(adresaModulu(`${KOREN}/akce-pos.ts`, NAHRADY))
const akceAi = await import(adresaModulu(`${KOREN}/akce-ai.ts`, NAHRADY))
const L = await import(`../${ZAZNAM}/logika.ts`)

const VSECHNA_PRAVA = ['jine_platby.zadat', 'jine_platby.upravit', 'jine_platby.sklad_odeslat', 'jine_platby.trzba', 'jine_platby.vydej_pos', 'jine_platby.faktura', 'jine_platby.oprava', 'finance.read']
const NAVRH_ID = '99999999-2222-4333-8444-555555555555'
const OP_ID = '77777777-2222-4333-8444-555555555555'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

const radekZaznamu = (prepis = {}) => ({
  id: ZAZNAM_ID,
  tenant_id: 'T1',
  branch_id: 'B1',
  pripojeni_id: 'P1',
  pos_provozovna: 'PROV1',
  datum_prodeje: '2026-10-15',
  oznaceni: 'Stůl 4',
  kontakt_id: null,
  mena: 'CZK',
  castka_haleru: 45000,
  castka_puvod: 'doklad',
  typ_dokladu: 'uzavreny_prodej',
  externi_ucet: '1234',
  pos_prodej_id: null,
  stav_kontroly: 'zkontrolovano',
  stav_trzby: 'nezapsano',
  stav_skladu: 'schvaleno',
  stav_faktury: 'bez_faktury',
  faktura_cislo: null,
  faktura_zdroj: null,
  faktura_castka_haleru: null,
  stav_uhrady: 'neovereno',
  uhrada_transakce_id: null,
  uhrada_castka_haleru: null,
  kontrola_trzby: null,
  kontrola_skladu: null,
  pokladna_trzby: null,
  pokladna_skladu: null,
  nedohledana_operace: null,
  upozorneni_dokladu: [],
  rozpoznani_id: null,
  verze: 3,
  vytvoril: 'U9',
  vytvoreno: '2026-10-15T10:00:00Z',
  zmeneno: '2026-10-15T10:00:00Z',
  ...prepis,
})
const radekOperace = (prepis = {}) => ({
  id: OP_ID,
  idempotencni_klic: 'ftjp99999999222243338444555555555555',
  stav: 'pripraveno',
  pokusu: 0,
  platnost_do: null,
  externi_provozovna: 'PROV1',
  polozky: [{ produktId: 'X1', mnozstvi: '2' }],
  poznamka: 'Foodtab Jiné platby',
  zahajeno: '2026-10-16T10:00:00Z',
  ...prepis,
})

function klient(druh) {
  const s = globalThis.__jp
  return {
    from(tabulka) {
      const filtry = []
      const q = {
        select: () => q,
        eq: (k, v) => (filtry.push(['eq', k, v]), q),
        neq: () => q,
        is: () => q,
        in: () => q,
        gte: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        range: (od, do_) => (filtry.push(['range', od, do_]), q),
        maybeSingle: () => Promise.resolve(vysledek(true)),
        then: (a, b) => Promise.resolve(vysledek(false)).then(a, b),
      }
      function vysledek(jeden) {
        s.log.push(['from', druh, tabulka, filtry.slice()])
        const v = typeof s.tabulky[tabulka] === 'function' ? s.tabulky[tabulka](filtry) : s.tabulky[tabulka]
        if (jeden) return { data: Array.isArray(v) ? (v[0] ?? null) : (v ?? null), error: null }
        return { data: Array.isArray(v) ? v : v ? [v] : [], error: null }
      }
      return q
    },
    rpc(nazev, parametry) {
      s.log.push(['rpc', druh, nazev, parametry])
      const o = s.rpc[nazev]
      return Promise.resolve(typeof o === 'function' ? o(parametry) : (o ?? { data: null, error: null }))
    },
    storage: {
      from: () => ({
        download: async (cesta) => {
          s.log.push(['download', cesta])
          if (typeof s.priStazeni === 'function') s.priStazeni(cesta)
          return s.soubory[cesta] ? { data: new Blob([s.soubory[cesta]]), error: null } : { data: null, error: { message: 'nenalezeno' } }
        },
        remove: async (cesty) => {
          s.log.push(['remove', cesty])
          return { data: null, error: null }
        },
      }),
    },
  }
}

const ucet = (prepis = {}) => ({
  externiId: 'U-100',
  cisloDokladu: '1234',
  stav: 'uzavreny',
  zaplaceno: true,
  celkemHaleru: 45000,
  mena: 'CZK',
  vytvorenoMs: TED,
  uzavrenoMs: TED,
  typDokladu: null,
  externiKlic: null,
  odpis: null,
  polozky: [],
  ...prepis,
})

function svet(prepis = {}) {
  const s = {
    log: [],
    tenant: 'T1',
    prava: new Set(VSECHNA_PRAVA),
    uzivatel: { id: 'U1' },
    pristup: { stav: 'ok', scope: { level: 'tenant', branchId: null, branchSlug: null } },
    tabulky: {
      // Záznam vrátí jen dotaz filtrovaný na firmu Z ČLENSTVÍ (T1) — cizí tenant nic nenajde.
      jine_platby: (filtry) => (filtry.some(([, k, v]) => k === 'tenant_id' && v === 'T1') ? [radekZaznamu(s.zaznam)] : []),
      jine_platby_polozky: [],
      jine_platby_soubory: [{ id: 'S1', poradi: 1, cesta: 'T1/B1/z/s1.jpg', mime: 'image/jpeg', velikost: JPEG.length }],
      jine_platby_skladove_navrhy: [{ id: NAVRH_ID }],
      pos_operace: () => [radekOperace(s.operace)],
      pos_katalog: [],
      pos_mapovani: [],
      kontakty: [],
      branches: { timezone: 'Europe/Prague', day_starts_at: '05:00' },
      tenants: { timezone: 'Europe/Prague' },
    },
    rpc: {
      jine_platby_ulozit_navrh: { data: 4, error: null },
      jine_platby_zahajit_rozpoznani: { data: 'R1', error: null },
      jine_platby_rozhodnout_vydej: { data: OP_ID, error: null },
      jine_platby_vydej_znovu: { data: OP_ID, error: null },
      pos_katalog_nahradit: { data: 1, error: null },
      pos_operace_zahajit: (p) => ({
        data: { stav: 'ok', operace: { id: p.p_operace, klic: 'ftjp99999999222243338444555555555555', stav: 'odesila_se', pokusu: 1, platnostDo: p.p_platnost_do, externiProvozovna: 'PROV1', polozky: [{ produktId: 'X1', mnozstvi: '2' }], poznamka: '' } },
        error: null,
      }),
    },
    relace: {
      stav: 'ok',
      schopnosti: { dohledaniUctu: true, katalog: true, skladovyVydej: 'rucne' },
      provozovny: [{ id: 'PROV1', branch_id: 'B1' }],
      relace: {
        ucty: async (provozovna, odMs, doMs, moznosti) => {
          s.log.push(['ucty', provozovna, odMs, doMs, moznosti ?? null])
          return { stav: 'ok', ucty: [], uplne: true }
        },
        ucetPodleKlice: async () => ({ stav: 'ok', ucet: null }),
        katalog: async () => ({ stav: 'ok', produkty: [{ externiId: 'X1', nazev: 'Pivo', jednotka: 'Piece', mira: null, odecitaSklad: true, maRecepturu: false, plu: [], ean: [], smazano: false }] }),
        skladovyVydej: async () => {
          s.log.push(['ZAPIS_DO_POKLADNY'])
          return { stav: 'odeslano' }
        },
      },
    },
    ai: { zapnuto: true, vyhodit: false, vysledek: { stav: 'chyba', duvod: 'Doklad nejde přečíst.', docasna: false } },
    soubory: { 'T1/B1/z/s1.jpg': JPEG },
    zaznam: {},
    operace: {},
    ...prepis,
  }
  s.klient = klient
  globalThis.__jp = s
  return s
}
/**
 * Svět pro rozpoznání: výdej bez návrhu (výchozí záznam má sklad „schváleno“ —
 * u schváleného výdeje se rozpoznání nezahajuje, C9).
 */
const svetAi = (prepis = {}) => svet({ ...prepis, zaznam: { stav_skladu: 'bez_navrhu', ...(prepis.zaznam ?? {}) } })

const formular = (pole) => {
  const f = new FormData()
  const vse = { zaznam: ZAZNAM_ID, verze: '3', rozsah: 'firma', tenant_id: 'CIZI', tenant: 'CIZI', ...pole }
  for (const [k, v] of Object.entries(vse)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x)
  return f
}
const KLID = { stav: 'nic', text: '' }
/**
 * Akce se spouští tak, aby výjimka v testovaném kódu shodila jen svou
 * kontrolu, ne celý běh (zbylé kontroly musí doběhnout a být vidět).
 */
async function spustit(fn, ...argumenty) {
  if (typeof fn !== 'function') return { stav: 'chybi', text: 'Akce neexistuje.' }
  try {
    return await fn(...argumenty)
  } catch (e) {
    return { stav: 'vyjimka', text: e instanceof Error ? e.message : String(e) }
  }
}
const zaznamy = (s, typ) => s.log.filter((x) => x[0] === typ)

/** Pro každou akci: formulář, se kterým dojde až k RPC / pokladně, a čím se to pozná. */
const PRIPADY = {
  ulozitNavrh: [akce, { datum: '2026-10-15', mena: 'CZK', castka: '450', typ: 'uzavreny_prodej', radek: ['a'], p_a_nazev: 'Pivo', p_a_mnozstvi: '2', p_a_cena_c: '450', p_a_druh: 'rozlevany_napoj' }],
  oznacitZkontrolovano: [akce, {}],
  prohlasitTrzbu: [akce, { vysledek: 'neni', duvod: 'Akce mimo provozovnu' }],
  prohlasitSklad: [akce, { vysledek: 'neni', duvod: 'Ověřeno v pokladně' }],
  potvrditTrzbu: [akce, { rezim: 'nova' }],
  opravitTrzbu: [akce, { castka: '400', duvod: 'Sleva dodatečně' }],
  odeslatSklad: [akce, {}],
  propojitVydej: [akce, { duvod: 'Pokladna už odečetla', externi_id: 'U-1' }],
  rucneDolozit: [akce, { doklad: 'V-12', duvod: 'Výdejka v pokladně', otisk: 'a'.repeat(64) }],
  zrusitSchvaleni: [akce, { duvod: 'V pokladně nic neodepsáno, opravím množství' }],
  korekceVydeje: [akce, { doklad: 'O-1', duvod: 'Vráceno na sklad' }],
  faktura: [akce, { akce: 'propojit', cislo: 'FV-1', zdroj: 'externi' }],
  evidovatUhradu: [akce, { transakce: '' }],
  ulozitMapovani: [akce, { alias: 'pivo', produkt: 'X1' }],
  zrusit: [akce, { duvod: 'Omylem založeno' }],
  zkontrolovatTrzbu: [akcePos, {}],
  zkontrolovatSklad: [akcePos, {}],
  rozhodnoutVydej: [akcePos, { navrh: NAVRH_ID, otisk: 'a'.repeat(64), rozhodnuti: 'zamitnout', duvod: 'Nesedí množství' }],
  provestVydej: [akcePos, {}],
  vydejZnovu: [akcePos, {}],
  obnovitVydej: [akcePos, {}],
  nacistKatalog: [akcePos, {}],
  rozpoznat: [akceAi, {}],
}
const STAV_OPERACE = { obnovitVydej: 'nejasny_vysledek' }
/** Záznam, se kterým akce dojde až k RPC (rozpoznání ne u schváleného výdeje — C9). */
const ZAZNAM_AKCE = { rozpoznat: { stav_skladu: 'bez_navrhu' } }

const vsechnyAkce = [...Object.entries(akce), ...Object.entries(akcePos), ...Object.entries(akceAi)].filter(([, f]) => typeof f === 'function')
ok(`každá exportovaná akce má případ k vyzkoušení (${vsechnyAkce.length} akcí)`, vsechnyAkce.length >= 22 && vsechnyAkce.every(([n]) => PRIPADY[n]))

for (const [jmeno, [modul, pole]] of Object.entries(PRIPADY)) {
  const prava = OCEKAVANA_PRAVA[jmeno] ?? []
  const zavolat = async () => spustit(modul[jmeno], KLID, formular(pole))
  const vedlejsi = (s) => s.log.filter((x) => ['rpc', 'klientUlohy', 'relace', 'ai', 'download'].includes(x[0]))

  // a) s VŠEMI právy kromě toho, které akce chce → nic se nezavolá.
  for (const chybi of prava) {
    const s = svet({ prava: new Set(VSECHNA_PRAVA.filter((p) => p !== chybi)), operace: { stav: STAV_OPERACE[jmeno] ?? 'pripraveno' }, zaznam: ZAZNAM_AKCE[jmeno] ?? {} })
    const v = await zavolat(s)
    ok(`${jmeno}: bez ${chybi} (ostatní práva má) nezavolá RPC, službu, pokladnu ani AI a vrátí chybu`, vedlejsi(s).length === 0 && v.stav === 'chyba')
  }

  // b) s právem → právo na pobočce záznamu ověřené PŘED prvním RPC / službou / pokladnou.
  const s = svet({ operace: { stav: STAV_OPERACE[jmeno] ?? 'pripraveno' }, zaznam: ZAZNAM_AKCE[jmeno] ?? {} })
  await zavolat(s)
  const iPrava = prava.map((p) => s.log.findIndex((x) => x[0] === 'hasAccess' && x[1] === p && x[2] === 'B1' && x[3] === 'T1'))
  const iVedlejsi = s.log.findIndex((x) => ['rpc', 'klientUlohy', 'relace', 'ai', 'download'].includes(x[0]))
  ok(`${jmeno}: hasAccess(${prava.join(', ')}) na pobočce záznamu PŘED prvním RPC/službou/pokladnou`, iVedlejsi > 0 && iPrava.every((i) => i >= 0 && i < iVedlejsi))
  const nacteni = s.log.find((x) => x[0] === 'from' && x[2] === 'jine_platby')
  ok(`${jmeno}: záznam čte uživatelský klient s tenant_id z členství (T1), ne z formuláře (CIZI)`,
    nacteni?.[1] === 'uzivatel' && nacteni[3].some(([, k, v]) => k === 'tenant_id' && v === 'T1') && !s.log.some((x) => JSON.stringify(x).includes('CIZI')))
}

console.log('\n-- zrušení: autor bez práva na opravy --')
{
  const s = svet({ prava: new Set(['jine_platby.zadat']), zaznam: { vytvoril: 'U1' } })
  await spustit(akce.zrusit, KLID, formular({ duvod: 'Omylem založeno' }))
  ok('autor se zadat smí zrušit svůj záznam (jine_platby_zrusit se zavolá)', zaznamy(s, 'rpc').some((x) => x[2] === 'jine_platby_zrusit'))
  const cizi = svet({ prava: new Set(['jine_platby.zadat']), zaznam: { vytvoril: 'U9' } })
  await spustit(akce.zrusit, KLID, formular({ duvod: 'Omylem založeno' }))
  ok('cizí záznam se zadat (bez opravy) zrušit nejde', zaznamy(cizi, 'rpc').length === 0)
}

console.log('\n-- chyby databáze → české hlášky --')
for (const [kod, zprava, cekam, popis] of [
  ['40001', 'serialization', L.HLASKA_VERZE, '40001 → „mezitím upravil někdo jiný“'],
  ['23514', 'Doplňte datum prodeje, měnu a celkovou částku.', 'Doplňte datum prodeje, měnu a celkovou částku.', '23514 → česká hláška z databáze'],
  ['42501', 'permission denied for table x', L.HLASKA_PRAVO, '42501 → „Na tohle nemáte oprávnění.“'],
  ['XX000', 'relation "public.tajne" does not exist', L.HLASKA_OBECNA, 'jiná chyba → obecná hláška bez detailu'],
]) {
  const s = svet()
  s.rpc.jine_platby_oznacit_zkontrolovano = { data: null, error: { code: kod, message: zprava } }
  const puvodni = console.error
  console.error = () => {}
  const v = await spustit(akce.oznacitZkontrolovano, KLID, formular({}))
  console.error = puvodni
  ok(popis, v.stav === 'chyba' && v.text === cekam && (kod !== 'XX000' || !v.text.includes('tajne')))
}
{
  const s = svet()
  const v = await spustit(akce.prohlasitTrzbu, KLID, formular({ vysledek: 'nevim', duvod: 'Nevím jistě' }))
  ok('prohlášení „nevím“ nic nezapíše (žádné RPC) a vysvětlí proč', zaznamy(s, 'rpc').length === 0 && v.stav === 'chyba' && v.text.includes('nic se nezapíše'))
  const s2 = svet()
  const v2 = await spustit(akce.prohlasitTrzbu, KLID, formular({ vysledek: 'neni', duvod: 'ok' }))
  ok('prohlášení bez důvodu (méně než 5 znaků) → chyba u pole duvod, žádné RPC', zaznamy(s2, 'rpc').length === 0 && v2.chyby?.duvod)
  const s3 = svet()
  const v3 = await spustit(akce.ulozitNavrh, KLID, formular({ castka: '12,345', radek: ['a'], p_a_nazev: 'Pivo', p_a_druh: 'rozlevany_napoj' }))
  ok('návrh s nejasnou částkou → chyba u pole castka a nic se neuloží', zaznamy(s3, 'rpc').length === 0 && Boolean(v3.chyby?.castka))
}

console.log('\n-- rozpoznání přes AI --')
{
  const s = svetAi({ ai: { zapnuto: false, vyhodit: false, vysledek: null } })
  const v = await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('bez klíče: přesně „Rozpoznání přes AI není zapnuté — zadejte položky ručně.“ a nic se nestáhne ani nezapočítá',
    v.text === 'Rozpoznání přes AI není zapnuté — zadejte položky ručně.' && zaznamy(s, 'rpc').length === 0 && zaznamy(s, 'download').length === 0)

  const doklad = {
    polozky: [{ nazev: 'Pivo 0,5 l', mnozstvi: '2', jednotka: 'ks', cenaJednotkova: '45', cenaCelkem: '90', sazbaDph: '21', druhNavrh: 'rozlevany_napoj', jistota: 0.95, poznamka: null }],
    celkem: '90',
    kUhrade: '90',
    zaplaceno: null,
    prijatoHotove: null,
    vraceno: null,
    zbyva: null,
    sleva: null,
    spropitne: null,
    mena: 'Kč',
    datum: '2026-10-15',
    externiId: '1234',
    typDokladu: 'uzavreny_prodej',
    textDokladu: 'Pivo 2x 90',
    jistota: 0.95,
    upozorneni: [],
  }
  const ok2 = svetAi({ ai: { zapnuto: true, vyhodit: false, vysledek: { stav: 'ok', doklad, model: 'claude-opus-5-5', verze: 'jine-platby-v1' } } })
  const predAkci = Date.now()
  const v2 = await spustit(akceAi.rozpoznat, KLID, formular({}))
  const poAkci = Date.now()
  const rpc = zaznamy(ok2, 'rpc')
  const iZah = rpc.findIndex((x) => x[2] === 'jine_platby_zahajit_rozpoznani')
  const iDok = rpc.findIndex((x) => x[2] === 'jine_platby_dokoncit_rozpoznani')
  const iUloz = rpc.findIndex((x) => x[2] === 'jine_platby_ulozit_navrh')
  ok('zahájení (strop) → AI → dokončení → uložení návrhu, v tomhle pořadí', iZah >= 0 && iDok > iZah && iUloz > iDok && v2.stav === 'ok')
  ok('zahájení a dokončení přes službu (service_role), uložení návrhu přes UŽIVATELSKÝ klient', rpc[iZah]?.[1] === 'sluzba' && rpc[iDok]?.[1] === 'sluzba' && rpc[iUloz]?.[1] === 'uzivatel')
  // Termín = začátek akce + maxDuration 120 s − 20 s rezerva (N29): mezi „před akcí + 100 s“ a „po akci + 100 s“.
  const konecAi = zaznamy(ok2, 'ai')[0]?.[2]?.konec
  ok(`AI dostala jen soubory dokladu a termín konec = začátek akce + 100 s (${typeof konecAi === 'number' ? konecAi - predAkci : konecAi} ms od začátku testu)`,
    zaznamy(ok2, 'ai')[0]?.[1] === 1 && typeof konecAi === 'number' && konecAi >= predAkci + 100_000 && konecAi <= poAkci + 100_000)
  const zacatekAi = zaznamy(ok2, 'ai')[0]?.[2]?.zacatek
  ok('AI dostala i začátek akce (konec − začátek = 100 s) — podle něj pozná zkrácený čas na čtení (ověření 21. 10.)',
    typeof zacatekAi === 'number' && typeof konecAi === 'number' && konecAi - zacatekAi === 100_000)
  ok('uložený návrh: položka z dokladu, částka z dokladu (doklad), CZK, kontrola verze 3',
    rpc[iUloz]?.[3]?.p_verze === 3 && rpc[iUloz][3].p_polozky.length === 1 && rpc[iUloz][3].p_hlavicka.castka_haleru === 9000 && rpc[iUloz][3].p_hlavicka.castka_puvod === 'doklad' && rpc[iUloz][3].p_hlavicka.mena === 'CZK')
  ok('dokončení nese stav ok, model a výsledek AI (původ zůstane)', rpc[iDok]?.[3]?.p_stav === 'ok' && rpc[iDok][3].p_model === 'claude-opus-5-5' && rpc[iDok][3].p_vysledek === doklad)

  const pad = svetAi({ ai: { zapnuto: true, vyhodit: true, vysledek: null } })
  const puvodni = console.error
  console.error = () => {}
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  console.error = puvodni
  const rp = zaznamy(pad, 'rpc')
  ok('když AI spadne: dokončení se zapíše se stavem chyba a návrh se neuloží', rp.some((x) => x[2] === 'jine_platby_dokoncit_rozpoznani' && x[3].p_stav === 'chyba') && !rp.some((x) => x[2] === 'jine_platby_ulozit_navrh'))

  const klic = svetAi({ ai: { zapnuto: true, vyhodit: false, vysledek: { stav: 'bez_klice' } } })
  const v4 = await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('model hlásí bez_klice: zapíše se bez_klice a člověk dostane srozumitelnou chybu, nic se neuloží',
    v4.text === L.HLASKA_BEZ_AI && zaznamy(klic, 'rpc').some((x) => x[2] === 'jine_platby_dokoncit_rozpoznani' && x[3].p_stav === 'bez_klice') && !zaznamy(klic, 'rpc').some((x) => x[2] === 'jine_platby_ulozit_navrh'))

  const pdf = svetAi()
  pdf.soubory['T1/B1/z/s1.jpg'] = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2])
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('soubor, který podle obsahu není fotka ani PDF: nic se neodešle ani nezapočítá', zaznamy(pdf, 'rpc').length === 0 && zaznamy(pdf, 'ai').length === 0)
}

console.log('\n-- výdej do pokladny přes orchestrátor --')
{
  const s = svet()
  await spustit(akcePos.provestVydej, KLID, formular({}))
  const rpc = zaznamy(s, 'rpc')
  ok("pokladna 'rucne': zápisová metoda relace se NEZAVOLÁ a operace se uzavře jako nepodporováno",
    zaznamy(s, 'ZAPIS_DO_POKLADNY').length === 0 && rpc.some((x) => x[2] === 'pos_operace_dokoncit' && x[3].p_stav === 'nepodporovano') && !rpc.some((x) => x[2] === 'pos_operace_zahajit'))

  // Účet v pokladně s položkami výdeje (radekOperace: 2× X1) — úspěch je jen se shodou položek (25. 10.).
  const polozkyVydeje = [{ produktId: 'X1', nazev: 'Pivo', mnozstvi: '2', odecitaSklad: true, zrusena: false }]
  const api = svet()
  api.relace.schopnosti.skladovyVydej = 'api'
  api.relace.relace.zapisVydejePovolen = (provozovna) => provozovna === 'PROV1'
  // Před zabráním čerstvá kontrola: pokladna podle klíče zatím nic nemá (první dotaz), po odeslání ano.
  let poOdeslani = false
  api.relace.relace.skladovyVydej = async () => {
    api.log.push(['ZAPIS_DO_POKLADNY'])
    poOdeslani = true
    return { stav: 'odeslano' }
  }
  api.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: poOdeslani ? ucet({ externiId: 'POS-77', externiKlic: klic, odpis: true, polozky: polozkyVydeje }) : null })
  api.tabulky.pos_operace = (filtry) => (filtry.some(([, k]) => k === 'druh') ? [radekOperace()] : [])
  await spustit(akcePos.provestVydej, KLID, formular({}))
  const r2 = zaznamy(api, 'rpc')
  const iKontrola = r2.findIndex((x) => x[2] === 'jine_platby_zapsat_kontrolu')
  const iZah = r2.findIndex((x) => x[2] === 'pos_operace_zahajit')
  const iDok = r2.findIndex((x) => x[2] === 'pos_operace_dokoncit')
  ok("pokladna 'api': těsně před výdejem kontrola (neodečteno) → zabrání → JEDEN zápis → ověřený úspěch",
    iKontrola >= 0 && r2[iKontrola][3].p_vysledek === 'neodecteno' && iZah > iKontrola && iDok > iZah && zaznamy(api, 'ZAPIS_DO_POKLADNY').length === 1 && r2[iDok][3].p_stav === 'uspech' && r2[iDok][3].p_externi_id === 'POS-77')

  // Adaptér hlásí 'api', ale TAHLE provozovna zápis povolený nemá (ZAPIS_VYDEJE_DOTYKACKA jen pro jinou):
  // metoda zápisu se nezavolá a výdej jde ručně (25. 10.).
  const jina = svet()
  jina.relace.schopnosti.skladovyVydej = 'api'
  jina.relace.relace.zapisVydejePovolen = (provozovna) => provozovna === 'PROV9'
  jina.relace.relace.skladovyVydej = async () => {
    jina.log.push(['ZAPIS_DO_POKLADNY'])
    return { stav: 'odeslano' }
  }
  jina.tabulky.pos_operace = (filtry) => (filtry.some(([, k]) => k === 'druh') ? [radekOperace()] : [])
  await spustit(akcePos.provestVydej, KLID, formular({}))
  const rj = zaznamy(jina, 'rpc')
  ok("pokladna 'api', ale provozovna záznamu zápis povolený nemá: zápis se NEZAVOLÁ, nic se nezabere, výdej nepodporovaný (ručně)",
    zaznamy(jina, 'ZAPIS_DO_POKLADNY').length === 0 && !rj.some((x) => x[2] === 'pos_operace_zahajit') && rj.some((x) => x[2] === 'pos_operace_dokoncit' && x[3].p_stav === 'nepodporovano'))

  const obn = svet({ operace: { stav: 'nejasny_vysledek', platnost_do: '2026-10-16T10:05:00Z' } })
  obn.relace.schopnosti.skladovyVydej = 'api'
  obn.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: ucet({ externiId: 'POS-88', externiKlic: klic, odpis: true, polozky: polozkyVydeje }) })
  await spustit(akcePos.obnovitVydej, KLID, formular({}))
  ok('obnova nejasného výdeje: nic se neodešle znovu, jen se dohledá a uloží úspěch',
    zaznamy(obn, 'ZAPIS_DO_POKLADNY').length === 0 && zaznamy(obn, 'rpc').some((x) => x[2] === 'pos_operace_dokoncit' && x[3].p_stav === 'uspech'))

  const bez = svet()
  bez.relace.relace = { katalog: bez.relace.relace.katalog }
  const v = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('pokladna bez dohledání účtů: nic se nezapíše a hláška „…použijte ruční prohlášení s důvodem.“', v.text === L.HLASKA_BEZ_DOHLEDANI && zaznamy(bez, 'rpc').length === 0)

  const otevreny = svet()
  otevreny.relace.relace.ucty = async () => ({ stav: 'ok', ucty: [ucet({ stav: 'otevreny', zaplaceno: false })], uplne: true })
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  const k = zaznamy(otevreny, 'rpc').find((x) => x[2] === 'jine_platby_zapsat_kontrolu')
  ok('otevřený účet v pokladně se zapíše jako nelze_overit (ne nenalezeno → nová tržba by se započítala dvakrát)', k?.[3]?.p_vysledek === 'nelze_overit' && k[1] === 'sluzba' && k[3].p_kdo === 'U1')

  const chybaPos = svet()
  chybaPos.relace.relace.ucty = async () => ({ stav: 'chyba', druh: 'docasna', duvod: 'Dotykačka neodpověděla' })
  const v5 = await spustit(akcePos.zkontrolovatSklad, KLID, formular({}))
  ok('pokladna neodpověděla: kontrola se NEZAPÍŠE (stará zůstane) a člověk dostane důvod', zaznamy(chybaPos, 'rpc').length === 0 && v5.stav === 'chyba' && v5.text.includes('Dotykačka neodpověděla'))

  // Katalog načtený jen zčásti (bez receptur, s vynechanými položkami) nesmí vypadat jako celý (PR #164).
  const produktKat = { externiId: 'X1', nazev: 'Pivo', jednotka: 'Piece', mira: null, odecitaSklad: true, maRecepturu: null, suroviny: null, plu: [], ean: [], smazano: false }
  const katTvar = svet()
  katTvar.relace.relace.katalog = async () => ({
    stav: 'ok', produkty: [produktKat], bezReceptur: true, bezRecepturProc: 'tvar', bezRecepturPopis: 'stránka 1 s recepturami: odpověď nemá seznam „data“ (klíče: vysledek)',
    vynechanoBezId: 2, vynechanoPopis: 'id: null; klíče položky: name, id',
  })
  const vk1 = await spustit(akcePos.nacistKatalog, KLID, formular({}))
  ok('načtení katalogu bez receptur („tvar"): hláška řekne, čemu appka nerozuměla, a že suroviny pokrmu budou jen obecné',
    vk1.stav === 'ok' && vk1.text.includes('Odpovědi s recepturami pokrmů appka nerozuměla (stránka 1 s recepturami: odpověď nemá seznam „data“ (klíče: vysledek))') && vk1.text.includes('jen obecná'))
  ok('… a kolik položek přišlo bez čitelného id i s popisem první („Bez čitelného id pokladna poslala 2 položky (první: id: null; …) — appka je vynechala")',
    vk1.text.includes('Bez čitelného id pokladna poslala 2 položky (první: id: null; klíče položky: name, id) — appka je vynechala'))
  const katPravo = svet()
  katPravo.relace.relace.katalog = async () => ({ stav: 'ok', produkty: [produktKat], bezReceptur: true, bezRecepturProc: 'pravo' })
  const vk2 = await spustit(akcePos.nacistKatalog, KLID, formular({}))
  ok('načtení katalogu bez receptur (403): „pokladna appce nevydala (chybí právo…)", nic o vynechaných',
    vk2.stav === 'ok' && vk2.text.includes('Receptury pokrmů pokladna appce nevydala (chybí právo na jejich čtení)') && !vk2.text.includes('nerozuměla') && !vk2.text.includes('Bez čitelného id'))
  const katCely = svet()
  const vk3 = await spustit(akcePos.nacistKatalog, KLID, formular({}))
  ok('celý katalog: žádná věta o recepturách ani vynechaných', vk3.stav === 'ok' && !vk3.text.includes('Receptury') && !vk3.text.includes('nerozuměla') && !vk3.text.includes('Bez čitelného id') && zaznamy(katCely, 'rpc').some((x) => x[2] === 'pos_katalog_nahradit'))

  const verze = svet()
  const v6 = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({ verze: '2' }))
  ok('kontrola nad starou verzí formuláře se nespustí (HLASKA_VERZE)', v6.text === L.HLASKA_VERZE && zaznamy(verze, 'relace').length === 0)
}

const MiB = 1024 * 1024
const rpcVolani = (s, nazev) => zaznamy(s, 'rpc').filter((x) => x[2] === nazev)
const zapsanaKontrola = (s) => rpcVolani(s, 'jine_platby_zapsat_kontrolu')[0]?.[3]
const radekPolozky = (poradi, prepis = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${String(poradi).padStart(2, '0')}`,
  poradi,
  nazev_puvodni: '',
  nazev: 'Pivo',
  mnozstvi: 2,
  jednotka: 'ks',
  cena_jednotkova_haleru: 4500,
  cena_celkem_haleru: 9000,
  sazba_dph: null,
  jistota: 0.9,
  zdroj: 'ai',
  druh: 'rozlevany_napoj',
  pos_produkt_id: null,
  pos_produkt_nazev: null,
  pos_mnozstvi: null,
  mapovani: 'nenamapovano',
  vyzaduje_kontrolu: false,
  duvod_kontroly: '',
  ...prepis,
})

console.log('\n-- opravy 18. 10.: nové parametry RPC --')
{
  // rucneDolozit: p_otisk živého schváleného návrhu; bez pokladny null.
  const r1 = svet()
  await spustit(akce.rucneDolozit, KLID, formular({ doklad: 'V-12', duvod: 'Výdejka v pokladně', otisk: 'b'.repeat(64) }))
  const v1 = rpcVolani(r1, 'jine_platby_rucne_dolozit_vydej')[0]?.[3]
  ok('rucneDolozit: s pokladnou posílá p_otisk ze skrytého pole', v1?.p_otisk === 'b'.repeat(64) && v1.p_doklad === 'V-12' && v1.p_zaznam === ZAZNAM_ID)
  const r2 = svet()
  const v2 = await spustit(akce.rucneDolozit, KLID, formular({ doklad: 'V-12', duvod: 'Výdejka v pokladně' }))
  ok('rucneDolozit: s pokladnou bez otisku → „Formulář je zastaralý…“ a nic se nezavolá', zaznamy(r2, 'rpc').length === 0 && v2.stav === 'chyba' && v2.text.startsWith('Formulář je zastaralý'))
  const r3 = svet({ zaznam: { pripojeni_id: null, pos_provozovna: null, stav_skladu: 'bez_navrhu' } })
  await spustit(akce.rucneDolozit, KLID, formular({ doklad: 'V-12', duvod: 'Papírová výdejka', otisk: 'c'.repeat(64) }))
  const v3 = rpcVolani(r3, 'jine_platby_rucne_dolozit_vydej')[0]?.[3]
  ok('rucneDolozit: bez pokladny p_otisk: null (i když formulář nějaký pošle)', v3 !== undefined && 'p_otisk' in v3 && v3.p_otisk === null)

  // zrusitSchvaleni: jen p_zaznam + p_duvod, uživatelským klientem; povinný důvod.
  const z1 = svet()
  const vz = await spustit(akce.zrusitSchvaleni, KLID, formular({ duvod: 'V pokladně nic neodepsáno' }))
  const pz = rpcVolani(z1, 'jine_platby_zrusit_schvaleni')[0]
  ok('zrusitSchvaleni: rpc jine_platby_zrusit_schvaleni(p_zaznam, p_duvod) uživatelským klientem',
    pz?.[1] === 'uzivatel' && pz[3].p_zaznam === ZAZNAM_ID && pz[3].p_duvod === 'V pokladně nic neodepsáno' && Object.keys(pz[3]).length === 2 && vz.stav === 'ok')
  const z2 = svet()
  const vz2 = await spustit(akce.zrusitSchvaleni, KLID, formular({ duvod: 'ne' }))
  ok('zrusitSchvaleni: bez důvodu (pod 5 znaků) → chyba u pole duvod, nic se nezavolá', zaznamy(z2, 'rpc').length === 0 && Boolean(vz2.chyby?.duvod))

  // opravitTrzbu: p_verze.
  const o1 = svet()
  await spustit(akce.opravitTrzbu, KLID, formular({ castka: '400', duvod: 'Sleva dodatečně' }))
  const po = rpcVolani(o1, 'jine_platby_opravit_trzbu')[0]?.[3]
  ok('opravitTrzbu: posílá p_verze z formuláře (3)', po?.p_verze === 3 && po.p_nova_castka_haleru === 40000)
  const o2 = svet()
  const vo2 = await spustit(akce.opravitTrzbu, KLID, formular({ verze: '', castka: '400', duvod: 'Sleva dodatečně' }))
  ok('opravitTrzbu: bez verze → „Formulář je zastaralý…“ a nic se nezavolá', zaznamy(o2, 'rpc').length === 0 && vo2.text.startsWith('Formulář je zastaralý'))

  // ulozit_mapovani: p_zaznam místo p_pripojeni (ulozitMapovani i „zapamatovat“ v ulozitNavrh).
  const m1 = svet()
  await spustit(akce.ulozitMapovani, KLID, formular({ alias: 'PIVO 0,5', produkt: 'X1' }))
  const pm = rpcVolani(m1, 'jine_platby_ulozit_mapovani')[0]?.[3]
  ok('ulozitMapovani: rpc (p_zaznam, p_alias, p_pos_produkt_id), žádné p_pripojeni', pm?.p_zaznam === ZAZNAM_ID && pm.p_alias === 'PIVO 0,5' && pm.p_pos_produkt_id === 'X1' && !('p_pripojeni' in pm))
  const m2 = svet()
  m2.tabulky.pos_katalog = [{ externi_id: 'X1', nazev: 'Pivo 0,5', jednotka: 'Piece', mira: null, odecita_sklad: true, ma_recepturu: false, plu: [], ean: [], smazano: false }]
  await spustit(akce.ulozitNavrh, KLID, formular({ ...PRIPADY.ulozitNavrh[1], p_a_produkt: 'X1', p_a_zapamatovat: 'ano' }))
  const pm2 = rpcVolani(m2, 'jine_platby_ulozit_mapovani')[0]?.[3]
  ok('ulozitNavrh se „zapamatovat“: alias přes p_zaznam (pokladna ze záznamu), žádné p_pripojeni', pm2?.p_zaznam === ZAZNAM_ID && pm2.p_alias === 'Pivo' && !('p_pripojeni' in pm2))

  // oznacitZkontrolovano: p_duvod_rozdilu jen při nesouladu součtu (nad ULOŽENÝMI položkami).
  const nesed = svet()
  nesed.tabulky.jine_platby_polozky = [radekPolozky(1)] // 90 Kč proti 450 Kč na záznamu
  const vn = await spustit(akce.oznacitZkontrolovano, KLID, formular({}))
  ok('oznacitZkontrolovano: součet nesedí a důvod chybí → chyba u pole duvod_rozdilu, nic se nezavolá', zaznamy(nesed, 'rpc').length === 0 && Boolean(vn.chyby?.duvod_rozdilu))
  const sDuv = svet()
  sDuv.tabulky.jine_platby_polozky = [radekPolozky(1)]
  await spustit(akce.oznacitZkontrolovano, KLID, formular({ duvod_rozdilu: 'Sleva 360 Kč mimo položky' }))
  ok('oznacitZkontrolovano: součet nesedí + důvod → p_duvod_rozdilu s důvodem', rpcVolani(sDuv, 'jine_platby_oznacit_zkontrolovano')[0]?.[3]?.p_duvod_rozdilu === 'Sleva 360 Kč mimo položky')
  const sedi = svet()
  sedi.tabulky.jine_platby_polozky = [radekPolozky(1, { cena_jednotkova_haleru: 22500, cena_celkem_haleru: 45000 })]
  await spustit(akce.oznacitZkontrolovano, KLID, formular({ duvod_rozdilu: 'Nic, jen zkouším' }))
  const ps = rpcVolani(sedi, 'jine_platby_oznacit_zkontrolovano')[0]?.[3]
  ok('oznacitZkontrolovano: součet sedí → p_duvod_rozdilu: null (i když formulář pole pošle)', ps !== undefined && 'p_duvod_rozdilu' in ps && ps.p_duvod_rozdilu === null)
  const dbRozdil = svet()
  const hlaskaRozdilu = 'Součet položek (90,00 Kč) nesedí s celkovou částkou (450,00 Kč) — napište, proč rozdíl nevadí.'
  dbRozdil.rpc.jine_platby_oznacit_zkontrolovano = { data: null, error: { code: '23514', message: hlaskaRozdilu } }
  const vdb = await spustit(akce.oznacitZkontrolovano, KLID, formular({}))
  ok('oznacitZkontrolovano: hláška databáze „Součet položek… nesedí“ → u pole duvod_rozdilu', vdb.chyby?.duvod_rozdilu === hlaskaRozdilu)
}

console.log('\n-- opravy 18. 10.: „Proč to není duplicita“ (tržba a schválení výdeje) --')
{
  const dup = svet()
  dup.rpc.jine_platby_potvrdit_trzbu = { data: null, error: { code: '23514', message: 'Možná duplicita: podobný prodej je už zapsaný u záznamu X. Když to duplicita není, napište důvod.' } }
  const vd = await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'nova' }))
  ok('potvrditTrzbu: „Možná duplicita…“ z databáze → chyba u pole duplicita_duvod (formulář ho zaměří)', vd.stav === 'chyba' && vd.chyby?.duplicita_duvod?.startsWith('Možná duplicita'))
  const jina = svet()
  jina.rpc.jine_platby_potvrdit_trzbu = { data: null, error: { code: '23514', message: 'Tržba je už zapsaná nebo propojená.' } }
  const vj = await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'nova' }))
  ok('potvrditTrzbu: jiná hláška 23514 se k poli duplicity nepřiřadí', vj.stav === 'chyba' && vj.chyby === undefined)

  const NAVRH = { navrh: NAVRH_ID, otisk: 'a'.repeat(64) }
  const sch = svet({ zaznam: { stav_skladu: 'ceka_na_schvaleni' } })
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'schvalit', duplicita_duvod: 'Jiný stůl, jiný host', duvod: 'TOHLE NE' }))
  const ps = rpcVolani(sch, 'jine_platby_rozhodnout_vydej')[0]?.[3]
  ok('rozhodnoutVydej schválit: p_duvod = „Proč to není duplicita“, ne pole duvod', ps?.p_schvalit === true && ps.p_duvod === 'Jiný stůl, jiný host')
  const schBez = svet()
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'schvalit' }))
  ok('rozhodnoutVydej schválit bez důvodu duplicity: p_duvod null', rpcVolani(schBez, 'jine_platby_rozhodnout_vydej')[0]?.[3]?.p_duvod === null)
  const zam = svet()
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'zamitnout', duvod: 'Nesedí množství', duplicita_duvod: 'TOHLE NE' }))
  const pzam = rpcVolani(zam, 'jine_platby_rozhodnout_vydej')[0]?.[3]
  ok('rozhodnoutVydej zamítnout: p_duvod = důvod zamítnutí, ne „není duplicita“', pzam?.p_schvalit === false && pzam.p_duvod === 'Nesedí množství')
  const kratky = svet()
  const vk = await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'schvalit', duplicita_duvod: 'ne' }))
  ok('rozhodnoutVydej schválit s příliš krátkým důvodem duplicity → chyba u pole, nic se nezavolá', zaznamy(kratky, 'rpc').length === 0 && Boolean(vk.chyby?.duplicita_duvod))
  const dupV = svet()
  dupV.rpc.jine_platby_rozhodnout_vydej = { data: null, error: { code: '23514', message: 'Možná duplicita výdeje: podobný výdej téže provozovny je u záznamu X.' } }
  const vdv = await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'schvalit' }))
  ok('rozhodnoutVydej: „Možná duplicita výdeje…“ → chyba u pole duplicita_duvod', vdv.chyby?.duplicita_duvod?.startsWith('Možná duplicita výdeje') === true)
}

console.log('\n-- opravy 18. 10.: rozpoznání přes AI (výběr souborů, podklad před stropem, názvy, 200 položek) --')
{
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])
  const polozkaAi = (nazev) => ({ nazev, mnozstvi: '1', jednotka: 'ks', cenaJednotkova: '10', cenaCelkem: '10', sazbaDph: null, druhNavrh: 'kusove_zbozi', jistota: 0.95, poznamka: null })
  const dokladAi = (polozky, celkem) => ({
    polozky, celkem, kUhrade: celkem, zaplaceno: null, prijatoHotove: null, vraceno: null, zbyva: null, sleva: null, spropitne: null,
    mena: 'CZK', datum: '2026-10-15', externiId: '1234', typDokladu: 'uzavreny_prodej', textDokladu: '', jistota: 0.95, upozorneni: [],
  })
  const aiOk = (doklad) => ({ zapnuto: true, vyhodit: false, vysledek: { stav: 'ok', doklad, model: 'claude-opus-5-5', verze: 'jine-platby-v1' } })

  // Po pořadí: fotka nad 5 MB přeskočena, PDF do 8 MB ano, výběr skončí, než by součet překročil 20 MB.
  const vyber = svetAi({ ai: aiOk(dokladAi([polozkaAi('Pivo')], '10')) })
  vyber.tabulky.jine_platby_soubory = [
    { id: 'S1', poradi: 1, cesta: 'c1', mime: 'image/jpeg', velikost: 6 * MiB },
    { id: 'S2', poradi: 2, cesta: 'c2', mime: 'application/pdf', velikost: 7 * MiB },
    { id: 'S3', poradi: 3, cesta: 'c3', mime: 'image/jpeg', velikost: 4 * MiB },
    { id: 'S4', poradi: 4, cesta: 'c4', mime: 'image/jpeg', velikost: 4.5 * MiB },
    { id: 'S5', poradi: 5, cesta: 'c5', mime: 'application/pdf', velikost: 6 * MiB },
    { id: 'S6', poradi: 6, cesta: 'c6', mime: 'image/jpeg', velikost: 1000 },
  ]
  vyber.soubory = { c1: JPEG, c2: PDF, c3: JPEG, c4: JPEG, c5: PDF, c6: JPEG }
  const vv = await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('AI: stáhnou se a pošlou jen soubory 2, 3, 4 (fotka nad 5 MB pryč, konec před překročením 20 MB)',
    JSON.stringify(zaznamy(vyber, 'download').map((x) => x[1])) === '["c2","c3","c4"]' && zaznamy(vyber, 'ai')[0]?.[1] === 3 && vv.stav === 'ok')
  ok('AI: výsledek řekne, které soubory nešly a proč', /č\. 1 \(fotka nad 5 MB\)/.test(vv.text) && /č\. 5 \(dohromady/.test(vv.text) && /č\. 6 \(dohromady/.test(vv.text))

  // Skutečné bajty dohromady nad 20 MB (uložené velikosti malé): zkontrolovatPodklad PŘED zahájením — nic se nezapočítá.
  const fotka = (n) => {
    const b = new Uint8Array(n)
    b.set([0xff, 0xd8, 0xff, 0xe0])
    return b
  }
  const velke = svetAi()
  velke.tabulky.jine_platby_soubory = [1, 2, 3, 4, 5].map((i) => ({ id: `S${i}`, poradi: i, cesta: `v${i}`, mime: 'image/jpeg', velikost: 1000 }))
  velke.soubory = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`v${i}`, fotka(4.5 * MiB)]))
  const vvel = await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('AI: podklad, který neprojde zkontrolovatPodklad (dohromady nad 20 MB), se nezapočítá do stropu ani nepošle',
    zaznamy(velke, 'rpc').length === 0 && zaznamy(velke, 'ai').length === 0 && vvel.stav === 'chyba' && vvel.text.includes('dohromady moc velké') && vvel.text.includes('nezapočítalo'))

  // Položka bez názvu → náhradní název, ke kontrole.
  const necit = svetAi({ ai: aiOk(dokladAi([polozkaAi('Pivo'), polozkaAi('')], '20')) })
  const vnec = await spustit(akceAi.rozpoznat, KLID, formular({}))
  const ulozeno = rpcVolani(necit, 'jine_platby_ulozit_navrh')[0]?.[3]?.p_polozky ?? []
  ok('AI: položka bez názvu → „Položka č. 2 (název nečitelný)“, název z dokladu prázdný, ke kontrole s důvodem',
    ulozeno[0]?.nazev === 'Pivo' && ulozeno[1]?.nazev === 'Položka č. 2 (název nečitelný)' && ulozeno[1].nazev_puvodni === '' && ulozeno[1].vyzaduje_kontrolu === true &&
      ulozeno[1].duvod_kontroly.includes(L.DUVOD_NECITELNY_NAZEV) && !ulozeno[1].duvod_kontroly.includes('Chybí název položky') && vnec.text.includes('název nečitelný'))

  // Víc než 200 položek → prvních 200 a varování.
  const moc = svetAi({ ai: aiOk(dokladAi(Array.from({ length: 205 }, (_, i) => polozkaAi(`Zboží ${i + 1}`)), '2050')) })
  const vmoc = await spustit(akceAi.rozpoznat, KLID, formular({}))
  const ulozenoMoc = rpcVolani(moc, 'jine_platby_ulozit_navrh')[0]?.[3]?.p_polozky ?? []
  ok('AI: 205 položek → uloží se prvních 200 a výsledek varuje', ulozenoMoc.length === 200 && ulozenoMoc[199].nazev === 'Zboží 200' && vmoc.text.includes('uloženo je jen prvních 200'))
}

console.log('\n-- opravy 18. 10.: kontrola v pokladně (okna, sloučení, otevřený účet, nepodporované hledání) --')
{
  const iso = (ms) => new Date(ms).toISOString()
  const okn = svet()
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  const dotazyUcty = zaznamy(okn, 'ucty')
  const uzav = dotazyUcty.find((x) => x[4]?.podle === 'uzavreni')
  const otev = dotazyUcty.find((x) => x[4]?.jenOtevrene === true)
  // Provozní den 15. 10. 2026, den začíná 05:00 v Praze (letní čas, UTC+2) → 05:00 = 03:00Z.
  ok('kontrola: uzavřené účty podle UZAVŘENÍ, provozní den −1 až +2 (14. 10. 05:00 – 18. 10. 05:00 Praha)',
    uzav?.[1] === 'PROV1' && iso(uzav[2]) === '2026-10-14T03:00:00.000Z' && iso(uzav[3]) === '2026-10-18T03:00:00.000Z' && uzav[4].jenOtevrene !== true)
  ok('kontrola: otevřené účty zvlášť (jenOtevrene, podle vytvoření) od dne −60 (16. 8.) do +2',
    otev?.[1] === 'PROV1' && iso(otev[2]) === '2026-08-16T03:00:00.000Z' && iso(otev[3]) === '2026-10-18T03:00:00.000Z' && otev[4].podle !== 'uzavreni')
  ok('kontrola: na provozovnu právě dva dotazy (uzavřené + otevřené)', dotazyUcty.length === 2)
  ok('(protipříklad) uzavřený prodej nad úplným prázdným seznamem → nenalezeno', zapsanaKontrola(okn)?.p_vysledek === 'nenalezeno')

  const slouc = svet()
  slouc.relace.relace.ucty = async (prov, od, do_, m) =>
    m?.podle === 'uzavreni'
      ? { stav: 'ok', ucty: [ucet({ externiId: 'U-100', stav: 'uzavreny' })], uplne: true }
      : { stav: 'ok', ucty: [ucet({ externiId: 'U-100', stav: 'otevreny' }), ucet({ externiId: 'U-200', cisloDokladu: '9', celkemHaleru: 1, stav: 'otevreny' })], uplne: false }
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  const ks = zapsanaKontrola(slouc)
  ok('kontrola: výsledky obou dotazů sloučené bez opakování (U-100 jednou, jako uzavřený), úplnost = oba úplné',
    ks?.p_vysledek === 'nalezeno' && ks.p_detail.pos_prodej_id === 'U-100' && ks.p_detail.pocet_uctu === 2 && ks.p_detail.uplne === false)

  const otvDoklad = svet({ zaznam: { typ_dokladu: 'otevreny_ucet' } })
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('fotka otevřeného účtu, v pokladně stejné číslo není (úplný seznam) → nelze_overit, ne nenalezeno', zapsanaKontrola(otvDoklad)?.p_vysledek === 'nelze_overit')
  const otvSklad = svet({ zaznam: { typ_dokladu: 'otevreny_ucet' } })
  await spustit(akcePos.zkontrolovatSklad, KLID, formular({}))
  ok('fotka otevřeného účtu u skladu → nelze_zjistit, ne neodecteno', zapsanaKontrola(otvSklad)?.p_vysledek === 'nelze_zjistit')

  const nepodp = svet()
  nepodp.relace.relace.ucty = async (prov, od, do_, m) =>
    m?.podle === 'uzavreni' ? { stav: 'chyba', druh: 'jina', duvod: 'Pokladna neumí hledat podle uzavření.' } : { stav: 'ok', ucty: [], uplne: true }
  const vnp = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  const knp = zapsanaKontrola(nepodp)
  ok('pokladna neumí hledat podle uzavření (trvalá chyba) → zapíše se nelze_overit s vysvětlením, žádný odhad',
    knp?.p_vysledek === 'nelze_overit' && String(knp.p_detail.popis).includes('podle data uzavření') && knp.p_detail.uplne === false && vnp.stav === 'ok')
  const nepodpSklad = svet()
  nepodpSklad.relace.relace.ucty = nepodp.relace.relace.ucty
  await spustit(akcePos.zkontrolovatSklad, KLID, formular({}))
  ok('totéž u skladu → nelze_zjistit', zapsanaKontrola(nepodpSklad)?.p_vysledek === 'nelze_zjistit')
  const docas = svet()
  docas.relace.relace.ucty = async (prov, od, do_, m) => (m?.podle === 'uzavreni' ? { stav: 'chyba', druh: 'docasna', duvod: 'Dotykačka neodpověděla' } : { stav: 'ok', ucty: [], uplne: true })
  const vdo = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('dočasná chyba dotazu podle uzavření NENÍ výsledek: nic se nezapíše', zaznamy(docas, 'rpc').length === 0 && vdo.stav === 'chyba')
}

console.log('\n-- opravy 18. 10.: katalog a aliasy po stránkách --')
{
  const Z = await import(ZAKLAD)
  const produkt = (i) => ({ externi_id: `P${i}`, nazev: `Produkt ${i}`, jednotka: 'Piece', mira: null, odecita_sklad: true, ma_recepturu: false, plu: [], ean: [], smazano: false })
  // PostgREST bez .range vrátí nejvýš 1000 řádků — stejně jako Supabase.
  const strankovany = (celkem, radek) => (filtry) => {
    const r = filtry.find((f) => f[0] === 'range')
    const [od, do_] = r ? [r[1], r[2]] : [0, 999]
    return Array.from({ length: Math.max(0, Math.min(celkem, do_ + 1, od + 1000) - od) }, (_, i) => radek(od + i))
  }
  const k1 = svet()
  k1.tabulky.pos_katalog = strankovany(2500, produkt)
  const kat = await Z.katalogPripojeni(klient('uzivatel'), 'T1', 'P1')
  const dotazyKat = zaznamy(k1, 'from').filter((x) => x[2] === 'pos_katalog')
  ok('katalog: načte se celý po stránkách (2500 produktů ve 3 dotazech .range po 1000)', kat.length === 2500 && dotazyKat.length === 3 && new Set(kat.map((p) => p.externiId)).size === 2500)
  ok('katalog: každý dotaz jen nesmazané produkty (.eq smazano false) té firmy a pokladny',
    dotazyKat.every((x) => x[3].some(([t, k, v]) => t === 'eq' && k === 'smazano' && v === false) && x[3].some(([, k, v]) => k === 'tenant_id' && v === 'T1') && x[3].some(([, k, v]) => k === 'pripojeni_id' && v === 'P1')))
  const k2 = svet()
  k2.tabulky.pos_katalog = strankovany(1e9, produkt)
  let vyjimka = null
  try {
    await Z.katalogPripojeni(klient('uzivatel'), 'T1', 'P1')
  } catch (e) {
    vyjimka = e
  }
  ok('katalog: víc než 20 plných stránek → chyba, ne tichý ořez', vyjimka instanceof Error && zaznamy(k2, 'from').filter((x) => x[2] === 'pos_katalog').length === 20)
  const k3 = svet()
  k3.tabulky.pos_mapovani = strankovany(1500, (i) => ({ alias: `a${i}`, pos_produkt_id: 'X1' }))
  const al = await Z.aliasyPripojeni(klient('uzivatel'), 'T1', 'P1')
  ok('aliasy: taky celé po stránkách (1500 ve 2 dotazech)', al.length === 1500 && zaznamy(k3, 'from').filter((x) => x[2] === 'pos_mapovani').length === 2)
  const k4 = svet()
  k4.tabulky.pos_katalog = strankovany(2500, produkt)
  const vk4 = await spustit(akce.ulozitNavrh, KLID, formular({ ...PRIPADY.ulozitNavrh[1], p_a_produkt: 'P2400' }))
  ok('návrh: produkt z třetí stránky katalogu (P2400) jde přiřadit', vk4.stav === 'ok' && rpcVolani(k4, 'jine_platby_ulozit_navrh')[0]?.[3]?.p_polozky[0]?.pos_produkt_id === 'P2400')
}

/* =====================================================================
 * 8. LOGIKA (spouští se)
 * ===================================================================== */

console.log('\n== 8. Logika: vyhodnocení kontroly v pokladně ==')
{
  // Uzavřený prodej: jen u něj (a u ručního seznamu spotřeby) může vyjít „nenalezeno“ / „neodečteno“ (C4, sekce 11).
  const z = { externiUcet: '1234', castkaHaleru: 45000, mena: 'CZK', typDokladu: 'uzavreny_prodej' }
  const okno = { odMs: TED - 86_400_000, doMs: TED + 86_400_000 }
  const d = (ucty, uplne = true) => [{ provozovna: 'PROV1', ucty, uplne }]
  const t = (ucty, uplne, zz = z) => L.vyhodnotitKontroluTrzby(zz, d(ucty, uplne), okno)

  const nal = t([ucet()], true)
  ok('tržba: uzavřený účet se stejným číslem → nalezeno + pos_prodej_id', nal.vysledek === 'nalezeno' && nal.detail.pos_prodej_id === 'U-100')
  const cislo = t([ucet({ cisloDokladu: '1 234' })], true)
  ok('tržba: číslo se porovná bez mezer („1 234“ = „1234“)', cislo.vysledek === 'nalezeno')
  const castka = t([ucet({ cisloDokladu: '9999', externiId: 'U-9' })], true)
  ok('tržba: jen stejná částka (jiné číslo) → pravdepodobne a BEZ pos_prodej_id', castka.vysledek === 'pravdepodobne' && !('pos_prodej_id' in castka.detail))
  const bezCisla = t([ucet({ cisloDokladu: null, externiId: 'U-5' })], true, { ...z, externiUcet: null })
  ok('tržba: doklad bez čísla, uzavřený účet se stejnou částkou → pravdepodobne (nikdy nalezeno)', bezCisla.vysledek === 'pravdepodobne')
  const otev = t([ucet({ stav: 'otevreny' })], true)
  ok('tržba: otevřený účet se stejným číslem → nelze_overit, ne nenalezeno', otev.vysledek === 'nelze_overit')
  const otevCastka = t([ucet({ stav: 'otevreny', cisloDokladu: '777', externiId: 'U-7' })], true)
  ok('tržba: otevřený účet se stejnou částkou → nelze_overit', otevCastka.vysledek === 'nelze_overit')
  ok('tržba: nic a úplný seznam → nenalezeno', t([ucet({ cisloDokladu: '5', externiId: 'U-5', celkemHaleru: 100 })], true).vysledek === 'nenalezeno')
  ok('tržba: nic a NEúplný seznam → nelze_overit', t([], false).vysledek === 'nelze_overit')
  ok('tržba: jiná měna se stejným číslem částky není shoda', t([ucet({ cisloDokladu: '5', externiId: 'U-5', mena: 'EUR' })], true).vysledek === 'nenalezeno')
  ok('tržba: zrušený účet se stejným číslem není „v pokladně“', t([ucet({ stav: 'zruseny', celkemHaleru: 1 })], true).vysledek === 'nenalezeno')
  ok('tržba: bez přiřazené provozovny → nelze_overit', L.vyhodnotitKontroluTrzby(z, [], okno).vysledek === 'nelze_overit')
  // Ověření 21. 10.: propojená tržba se hledá nejdřív podle uloženého účtu (posProdejId), ne podle čísla z návrhu.
  const propojena = { ...z, externiUcet: '9999', posProdejId: 'U-100' }
  const pr = t([ucet({ cisloDokladu: '1234' })], true, propojena)
  ok('tržba: propojená tržba najde uložený účet (U-100), i když číslo v návrhu je jiné → nalezeno, shoda propojeny_prodej',
    pr.vysledek === 'nalezeno' && pr.detail.shoda === 'propojeny_prodej' && pr.detail.pos_prodej_id === 'U-100')
  ok('tržba: bez uloženého účtu stejné vstupy hledají podle čísla (9999) → nenalezeno (kontrola rozezná oba stavy)',
    t([ucet({ cisloDokladu: '1234', celkemHaleru: 100 })], true, { ...propojena, posProdejId: null }).vysledek === 'nenalezeno')
  ok('tržba: uložený účet je v pokladně ZRUŠENÝ → hledá se dál podle čísla, ne „nalezeno“',
    t([ucet({ stav: 'zruseny', celkemHaleru: 100 })], true, propojena).vysledek === 'nenalezeno')

  // Fotka OTEVŘENÉHO účtu: bez shody čísla v pokladně nikdy „nenalezeno“ / „neodečteno“.
  const zo = { ...z, typDokladu: 'otevreny_ucet' }
  ok('tržba: fotka otevřeného účtu a nic v pokladně (úplný seznam) → nelze_overit', L.vyhodnotitKontroluTrzby(zo, d([], true), okno).vysledek === 'nelze_overit')
  ok('tržba: fotka otevřeného účtu, v pokladně jen ZRUŠENÝ účet se stejným číslem → nelze_overit',
    L.vyhodnotitKontroluTrzby(zo, d([ucet({ stav: 'zruseny', celkemHaleru: 1 })], true), okno).vysledek === 'nelze_overit')
  ok('tržba: fotka otevřeného účtu a UZAVŘENÝ účet se stejným číslem → nalezeno (shoda čísla platí)', L.vyhodnotitKontroluTrzby(zo, d([ucet()], true), okno).vysledek === 'nalezeno')
  ok('sklad: fotka otevřeného účtu a nic v pokladně → nelze_zjistit', L.vyhodnotitKontroluSkladu(zo, d([]), [], okno).vysledek === 'nelze_zjistit')

  // Sloučení dotazů (uzavřené podle uzavření + otevřené).
  const sl = L.sloucitUcty('PROV1', { ucty: [ucet({ externiId: 'A', stav: 'otevreny' })], uplne: true }, { ucty: [ucet({ externiId: 'A', stav: 'uzavreny' }), ucet({ externiId: 'B' })], uplne: true })
  ok('sloučení: bez opakování podle externiId, uzavřený stav vyhraje', sl.ucty.length === 2 && sl.ucty.find((u) => u.externiId === 'A')?.stav === 'uzavreny' && sl.uplne === true)
  ok('sloučení: úplné jen když jsou úplné oba dotazy',
    L.sloucitUcty('P', { ucty: [], uplne: true }, { ucty: [], uplne: false }).uplne === false && L.sloucitUcty('P', { ucty: [], uplne: false }, { ucty: [], uplne: true }).uplne === false)
  const okna = L.oknaKontroly('2026-10-25', '05:00', 'Europe/Prague')
  ok('okna: přes přechod na zimní čas (25. 10.) — uzavřené od 24. 10. 05:00 letního do 28. 10. 05:00 zimního času',
    new Date(okna.uzavrene.odMs).toISOString() === '2026-10-24T03:00:00.000Z' && new Date(okna.uzavrene.doMs).toISOString() === '2026-10-28T04:00:00.000Z' && okna.otevrene.doMs === okna.uzavrene.doMs)

  const s = (ucty, odpisy = [], uplne = true) => L.vyhodnotitKontroluSkladu(z, d(ucty, uplne), odpisy, okno)
  ok('sklad: výdej s klíčem naší operace v pokladně → jiz_odecteno', s([], [{ klic: 'K1', odpoved: { stav: 'ok', ucet: ucet({ externiId: 'POS-1' }) } }]).vysledek === 'jiz_odecteno')
  ok('sklad: zrušený výdej s klíčem není odečtení', s([], [{ klic: 'K1', odpoved: { stav: 'ok', ucet: ucet({ stav: 'zruseny' }) } }]).vysledek === 'neodecteno')
  ok('sklad: prodej z dokladu uzavřený v pokladně → jiz_odecteno', s([ucet()]).vysledek === 'jiz_odecteno')
  ok('sklad: účet otevřený → nelze_zjistit', s([ucet({ stav: 'otevreny' })]).vysledek === 'nelze_zjistit')
  ok('sklad: jen stejná částka → nelze_zjistit (žádné „pravděpodobně“ u skladu)', s([ucet({ cisloDokladu: '9', externiId: 'U-9' })]).vysledek === 'nelze_zjistit')
  ok('sklad: dohledání klíče selhalo → nelze_zjistit', s([], [{ klic: 'K1', odpoved: { stav: 'chyba', duvod: 'x' } }]).vysledek === 'nelze_zjistit')
  ok('sklad: nic a úplný seznam → neodecteno', s([]).vysledek === 'neodecteno')
  ok('sklad: nic a NEúplný seznam → nelze_zjistit', s([], [], false).vysledek === 'nelze_zjistit')

  ok('dohledání: uzavřený, zaplacený odpisový účet → nalezeno s externím id', L.dohledaniZUctu({ stav: 'ok', ucet: ucet({ externiId: 'Q', odpis: true }) }).stav === 'nalezeno')
  ok('dohledání: zrušený účet → chyba (orchestrátor nic nezopakuje)', L.dohledaniZUctu({ stav: 'ok', ucet: ucet({ stav: 'zruseny' }) }).stav === 'chyba')
  ok('operace z databáze: neznámý stav nebo vadné položky → null (nic se neodešle)',
    L.operaceZDb(radekOperace({ stav: 'hotovo' })) === null && L.operaceZDb(radekOperace({ polozky: [{ produktId: 'X', mnozstvi: '1,5' }] })) === null && L.operaceZDb(radekOperace())?.klic.startsWith('ftjp'))
}

console.log('\n== 8b. Logika: formulář návrhu ==')
{
  const v = (pole) => {
    const f = new FormData()
    for (const [k, x] of Object.entries(pole)) for (const y of Array.isArray(x) ? x : [x]) f.append(k, y)
    return L.zFormData(f)
  }
  const PUV = '33333333-2222-4333-8444-555555555555'
  const puvodni = [
    { id: PUV, nazevPuvodni: 'PIVO 0,5', nazev: 'Pivo', mnozstvi: '2', jednotka: 'ks', cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 9000, sazbaDph: null, jistota: 0.5, zdroj: 'ai', druh: 'rozlevany_napoj', posProduktId: 'X1', posProduktNazev: 'Pivo 0,5', posMnozstvi: '2', mapovani: 'navrh', vyzadujeKontrolu: true, duvodKontroly: 'Řádek přečtený nejistě (jistota 50 %)' },
  ]
  const katalog = [
    { externiId: 'X1', nazev: 'Pivo 0,5', jednotka: 'Piece', mira: null, odecitaSklad: true, maRecepturu: false, plu: [], ean: [], smazano: false },
    { externiId: 'X2', nazev: 'Pivo 0,3', jednotka: 'Piece', mira: null, odecitaSklad: true, maRecepturu: false, plu: [], ean: [], smazano: false },
  ]
  const kontext = { zaznam: { castkaHaleru: 9000, castkaPuvod: 'doklad', kontaktId: null }, puvodni, katalog }
  const zaklad = { datum: '2026-10-15', mena: 'CZK', castka: '90', typ: 'uzavreny_prodej', radek: ['a'], p_a_id: PUV, p_a_nazev: 'Pivo', p_a_mnozstvi: '2', p_a_jednotka: 'ks', p_a_cena_j: '45', p_a_cena_c: '90', p_a_druh: 'rozlevany_napoj', p_a_produkt: 'X1' }

  const nejasne = L.nacistNavrh(v({ ...zaklad, p_a_mnozstvi: '½' }), kontext)
  ok('nejasné množství → chyba u pole p_a_mnozstvi, nic se nedomýšlí', nejasne.stav === 'chyba' && Boolean(nejasne.chyby.p_a_mnozstvi))
  const cena = L.nacistNavrh(v({ ...zaklad, castka: '90,555' }), kontext)
  ok('nejasná celková cena → chyba u pole castka', cena.stav === 'chyba' && Boolean(cena.chyby.castka))

  const beze = L.nacistNavrh(v(zaklad), kontext)
  ok('beze změny produktu zůstane přiřazení návrhem (ne ověřené)', beze.stav === 'ok' && beze.polozky[0].mapovani === 'navrh')
  ok('název z dokladu, zdroj a jistota se berou z DATABÁZE, ne z formuláře', beze.stav === 'ok' && beze.polozky[0].nazevPuvodni === 'PIVO 0,5' && beze.polozky[0].zdroj === 'ai' && beze.polozky[0].jistota === 0.5)
  ok('nepotvrzený řádek si důvod ze čtení dokladu nechá', beze.stav === 'ok' && beze.polozky[0].vyzadujeKontrolu === true)
  const potvrzeno = L.nacistNavrh(v({ ...zaklad, p_a_potvrdit: 'ano' }), kontext)
  ok('potvrzený řádek („ověřil jsem proti dokladu“) přijde o důvod ze čtení', potvrzeno.stav === 'ok' && potvrzeno.polozky[0].vyzadujeKontrolu === false)
  const zmena = L.nacistNavrh(v({ ...zaklad, p_a_produkt: 'X2', p_a_zapamatovat: 'ano' }), kontext)
  ok('člověk vybral jiný produkt → přiřazení ověřené, množství pro pokladnu dopočtené', zmena.stav === 'ok' && zmena.polozky[0].mapovani === 'overeno' && zmena.polozky[0].posProduktId === 'X2' && zmena.polozky[0].posMnozstvi === '2')
  ok('„zapamatovat“ → alias je název Z DOKLADU', zmena.stav === 'ok' && zmena.zapamatovat[0]?.alias === 'PIVO 0,5' && zmena.zapamatovat[0]?.posProduktId === 'X2')
  const overit = L.nacistNavrh(v({ ...zaklad, p_a_overit: 'ano' }), kontext)
  ok('zaškrtnuté „přiřazení je správné“ → ověřené', overit.stav === 'ok' && overit.polozky[0].mapovani === 'overeno')
  const cizi = L.nacistNavrh(v({ ...zaklad, p_a_produkt: 'NEEXISTUJE' }), kontext)
  ok('produkt mimo katalog pokladny → chyba u pole', cizi.stav === 'chyba' && Boolean(cizi.chyby.p_a_produkt))
  const sluzba = L.nacistNavrh(v({ ...zaklad, p_a_druh: 'sluzba' }), kontext)
  ok('služba se skladu netýká → neskladova bez produktu', sluzba.stav === 'ok' && sluzba.polozky[0].mapovani === 'neskladova' && sluzba.polozky[0].posProduktId === null)

  ok('celková cena beze změny → původ zůstane „z dokladu“', beze.stav === 'ok' && beze.hlavicka.castkaPuvod === 'doklad')
  const rucne = L.nacistNavrh(v({ ...zaklad, castka: '95' }), kontext)
  ok('změněná celková cena → původ „ručně“', rucne.stav === 'ok' && rucne.hlavicka.castkaPuvod === 'rucne' && rucne.hlavicka.castkaHaleru === 9500)
  const vypocet = L.nacistNavrh(v({ ...zaklad, castka: '90', castka_puvod: 'vypocet' }), { ...kontext, zaznam: { castkaHaleru: null, castkaPuvod: null, kontaktId: null } })
  ok('„vypočtený součet“ jen když částka opravdu sedí se součtem položek', vypocet.stav === 'ok' && vypocet.hlavicka.castkaPuvod === 'vypocet')
  const lzivy = L.nacistNavrh(v({ ...zaklad, castka: '80', castka_puvod: 'vypocet' }), { ...kontext, zaznam: { castkaHaleru: null, castkaPuvod: null, kontaktId: null } })
  ok('„vypočtený součet“, který se součtem nesedí → „ručně“', lzivy.stav === 'ok' && lzivy.hlavicka.castkaPuvod === 'rucne')
  const novy = L.nacistNavrh(v({ ...zaklad, radek: ['a', 'n1'], p_n1_id: 'neplatne', p_n1_nazev: 'Káva', p_n1_mnozstvi: '1', p_n1_cena_c: '0', p_n1_druh: 'nezarazeno' }), kontext)
  ok('nový řádek (neznámé id) je ruční, bez názvu z dokladu', novy.stav === 'ok' && novy.polozky[1].zdroj === 'rucne' && novy.polozky[1].nazevPuvodni === '')

  ok('textChybyDb: 23505 z unikátního indexu neukáže jména tabulek', !L.textChybyDb({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }).includes('constraint'))

  // Náhradní název nečitelného řádku se jako alias nepamatuje (u běžného řádku ano).
  const NEC = '44444444-2222-4333-8444-555555555555'
  const sNec = L.nacistNavrh(
    v({ ...zaklad, radek: ['a', 'b'], p_a_zapamatovat: 'ano', p_b_id: NEC, p_b_nazev: 'Položka č. 2 (název nečitelný)', p_b_mnozstvi: '1', p_b_cena_c: '10', p_b_druh: 'rozlevany_napoj', p_b_produkt: 'X2', p_b_zapamatovat: 'ano' }),
    { ...kontext, puvodni: [...puvodni, { ...puvodni[0], id: NEC, nazevPuvodni: '', nazev: 'Položka č. 2 (název nečitelný)' }] },
  )
  ok('„zapamatovat“ u řádku s náhradním názvem alias neuloží; u běžného ano', sNec.stav === 'ok' && sNec.zapamatovat.length === 1 && sNec.zapamatovat[0].alias === 'PIVO 0,5')
}

console.log('\n== 8c. Logika: výběr souborů pro AI, nečitelné názvy, jednotky ==')
{
  const T = await import('../lib/jine-platby-typy.ts')
  ok('stropy pro AI, se kterými testy počítají: fotka 5 MB, PDF 8 MB, dohromady 20 MB, 6 souborů',
    T.MAX_BAJTU_OBRAZKU_PRO_AI === 5 * MiB && T.MAX_BAJTU_PRO_AI === 8 * MiB && T.MAX_BAJTU_CELKEM_PRO_AI === 20 * MiB && T.MAX_SOUBORU_PRO_AI === 6)
  const lim = { maxSouboru: 3, maxObrazek: 5, maxPdf: 8, maxCelkem: 12 }
  const sb = (poradi, mime, velikost) => ({ poradi, mime, velikost })
  const v1 = L.vybratSouboryProAi([sb(1, 'image/jpeg', 6), sb(2, 'application/pdf', 7), sb(3, 'image/png', 4), sb(4, 'image/webp', 2), sb(5, 'image/jpeg', 1)], lim)
  ok('výběr pro AI: fotka nad strop pryč, PDF podle stropu PDF, konec před překročením součtu — i menší soubory za ním už ne',
    JSON.stringify(v1.vybrane.map((x) => x.poradi)) === '[2,3]' && JSON.stringify(v1.preskocene.map((x) => x.poradi)) === '[1,4,5]')
  // `?.` — rozbitý výběr má přeskočených méně; kontrola má spadnout, ne shodit celý běh.
  ok('výběr pro AI: důvod u každého přeskočeného (fotka nad strop / součet)',
    v1.preskocene.length === 3 && v1.preskocene[0]?.duvod.startsWith('fotka nad') && /dohromady/.test(v1.preskocene[1]?.duvod ?? '') && /dohromady/.test(v1.preskocene[2]?.duvod ?? ''))
  const v2 = L.vybratSouboryProAi([1, 2, 3, 4].map((i) => sb(i, 'image/jpeg', 1)), lim)
  ok('výběr pro AI: nejvýš maxSouboru souborů', v2.vybrane.length === 3 && v2.preskocene.length === 1 && /nejvýš 3/.test(v2.preskocene[0]?.duvod ?? ''))
  ok('výběr pro AI: PDF nad strop PDF se přeskočí, další soubor se vezme', L.vybratSouboryProAi([sb(1, 'application/pdf', 9), sb(2, 'image/jpeg', 1)], lim).vybrane.map((x) => x.poradi).join() === '2')

  ok('jednotka z katalogu česky: Piece → ks, Liter → l, Milliliter → ml, Kilogram → kg, Gram → g, jinak beze změny',
    ['Piece', 'Liter', 'Milliliter', 'Kilogram', 'Gram', 'Bottle', null].map(L.jednotkaCesky).join('|') === 'ks|l|ml|kg|g|Bottle|')

  const pp = (nazev, duvod = '') => ({
    nazevPuvodni: nazev, nazev, mnozstvi: '1', jednotka: null, cenaJednotkovaHaleru: null, cenaCelkemHaleru: 100, sazbaDph: null, jistota: 0.9, zdroj: 'ai',
    druh: 'kusove_zbozi', posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', vyzadujeKontrolu: duvod !== '', duvodKontroly: duvod,
  })
  const dop = L.doplnitNecitelneNazvy([pp('Pivo'), pp('  ', 'Chybí název položky')])
  ok('nečitelný název: „Položka č. 2 (název nečitelný)“, věcné „Chybí název“ nahrazené důvodem, řádek ke kontrole',
    dop[0].nazev === 'Pivo' && dop[1].nazev === 'Položka č. 2 (název nečitelný)' && dop[1].nazevPuvodni === '' && dop[1].vyzadujeKontrolu === true && dop[1].duvodKontroly === L.DUVOD_NECITELNY_NAZEV)
  // Uložení návrhu příznaky přepočítá — důvod nečitelného názvu musí zůstat, jinak by vymyšlený název prošel kontrolou.
  const K = await import('../lib/jine-platby-kontrola.ts')
  const poUlozeni = K.zkontrolovatNavrh(dop, { datumProdeje: '2026-10-15', oznaceni: '', mena: 'CZK', castkaHaleru: 200, castkaPuvod: 'doklad', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null }).polozky[1]
  ok('nečitelný název: po přepočtu příznaků (uložení návrhu) řádek zůstane ke kontrole', poUlozeni.vyzadujeKontrolu === true && poUlozeni.duvodKontroly.includes(L.DUVOD_NECITELNY_NAZEV))
}

/* =====================================================================
 * 10. OPRAVY PO DRUHÉ NEZÁVISLÉ KONTROLE (19. 10. 2026) — čísla N z kontroly
 * ===================================================================== */

console.log('\n== 10. Opravy po druhé kontrole (19. 10.) ==')
const KDY10 = new Date(TED - 5 * 60_000).toISOString()
const kontrolaPos = (vysledek, zdroj = 'pos_api', detail = {}, verze = 3) => ({ vysledek, zdroj, verze, kdy: KDY10, kdo: null, detail })
const cerstva = (vysledek, zdroj = 'pos_api', detail = {}) => ({ vysledek, zdroj, verze: 3, kdy: new Date().toISOString(), kdo: null, detail })
const tprops = (z, akce = [], prepis = {}) => ({ zakl, z, akce: new Set(akce), maPokladnu: true, umiDohledani: true, smiOpravit: false, duplicity: [], trzby: [], tedMs: TED, jmena: {}, zona: 'Europe/Prague', ...prepis })
const NAVRH10 = { id: NAVRH_ID, stav: 'schvaleno', otisk: 'a'.repeat(64), polozky: [{ poradi: 1, posProduktId: 'X1', nazev: 'Pivo 0,5 l', mnozstvi: '2' }], odeslal: null, odeslano: '2026-10-16T10:00:00Z', schvalil: null, schvaleno: null, zamitl: null, zamitnuto: null, duvodZamitnuti: null }
const OPERACE10 = (stav) => ({ stav, pokusu: 0, platnostDo: null, externiId: null, externiDoklad: null, chyba: null, duvod: null, zahajeno: '2026-10-16T10:01:00Z', dokonceno: null })
const sprops = (z, akce, prepis = {}) => ({
  zakl, z, akce: new Set(akce), smiOpravit: false, maPokladnu: true,
  pokladna: { nazev: 'Dotykačka Bernard', nazevPoskytovatele: 'Dotykačka', dohledaniUctu: true, skladovyVydej: 'rucne' },
  provozovna: 'Bernard Bar', nahled: null, navrh: null, operace: null, prevody: [], originaly: [], duplicity: [], jednotkyProduktu: {},
  muzeSchvalit: false, vydej: { externiId: null, doklad: null }, tedMs: TED, jmena: {}, zona: 'Europe/Prague', ...prepis,
})
const formularS = (html, tlacitko) => formulare(html).find((x) => tlacitka(x).includes(tlacitko)) ?? ''
const radio = (form, hodnota) => new RegExp('<input[^>]*type="radio"[^>]*value="' + hodnota + '"').test(form)

console.log('\n-- N1: připojení souboru jen klientem služby, s p_nahral a naším otiskem --')
{
  const { createHash } = await import('node:crypto')
  const TU = '0a0a0a0a-1111-4111-8111-111111111111'
  const BU = '0b0b0b0b-2222-4222-8222-222222222222'
  const SID = 'c0c0c0c0-3333-4333-8333-333333333333'
  const JINY = '99999999-2222-4333-8444-555555555555'
  const cesta = TU + '/' + BU + '/' + ZAZNAM_ID + '/' + SID + '.jpg'
  const akceSoubory = await import(adresaModulu(KOREN + '/akce-soubory.ts', SPOLECNE))
  const svetSouboru = (prepis = {}) => {
    const w = svet({ tenant: TU, soubory: { [cesta]: JPEG }, ...prepis })
    w.tabulky.jine_platby = (filtry) => (filtry.some(([, k, v]) => k === 'tenant_id' && v === TU) ? [{ id: ZAZNAM_ID, tenant_id: TU, branch_id: BU, stav_kontroly: 'rozpracovano' }] : [])
    return w
  }
  const pripojit = () => spustit(akceSoubory.pripojitSoubor, 'firma', ZAZNAM_ID, cesta)
  const otisk = createHash('sha256').update(JPEG).digest('hex')

  const w1 = svetSouboru()
  const v1 = await pripojit()
  const r1 = rpcVolani(w1, 'jine_platby_pripojit_soubor')
  ok('N1: jine_platby_pripojit_soubor volá KLIENT SLUŽBY (jednou) s p_nahral = přihlášený, otiskem ze stažených bajtů a přeskládanou cestou',
    v1.ok === true && r1.length === 1 && r1[0][1] === 'sluzba' && r1[0][3].p_nahral === 'U1' && r1[0][3].p_otisk === otisk && r1[0][3].p_cesta === cesta && r1[0][3].p_zaznam === ZAZNAM_ID)
  ok('N1: uživatelský klient RPC nevolá vůbec', zaznamy(w1, 'rpc').every((x) => x[1] !== 'uzivatel'))
  const iPravo = w1.log.findIndex((x) => x[0] === 'hasAccess' && x[1] === 'jine_platby.zadat' && x[2] === BU)
  const iStazeni = w1.log.findIndex((x) => x[0] === 'download')
  const iSluzba = w1.log.findIndex((x) => x[0] === 'klientUlohy')
  ok('N1: pořadí — právo na pobočce záznamu → stažení (obsah, otisk) → teprve pak klient služby', iPravo >= 0 && iStazeni > iPravo && iSluzba > iStazeni)

  const w2 = svetSouboru({ prava: new Set(['finance.read']) })
  const v2 = await pripojit()
  ok('N1: bez práva zadat/upravit se nic nestáhne, služba se nevezme a nic se nezavolá', v2.ok === false && zaznamy(w2, 'download').length === 0 && zaznamy(w2, 'klientUlohy').length === 0 && zaznamy(w2, 'rpc').length === 0)

  const w3 = svetSouboru()
  w3.klient = (druh) => (druh === 'sluzba' ? null : klient(druh))
  const v3 = await pripojit()
  ok('N1: bez klíče služby srozumitelná chyba (SUPABASE_SERVICE_ROLE_KEY), soubor se uklidí a nic se nezavolá',
    v3.ok === false && v3.chyba.includes('SUPABASE_SERVICE_ROLE_KEY') && JSON.stringify(zaznamy(w3, 'remove')) === JSON.stringify([['remove', [cesta]]]) && zaznamy(w3, 'rpc').length === 0)

  const w4 = svetSouboru({ soubory: { [cesta]: new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2]) } })
  const v4 = await pripojit()
  ok('N1: obsah, který podle bajtů není fotka ani PDF → úklid a klient služby se ani nevezme', v4.ok === false && zaznamy(w4, 'remove').length === 1 && zaznamy(w4, 'klientUlohy').length === 0)

  const w5 = svetSouboru()
  w5.rpc.jine_platby_pripojit_soubor = { data: null, error: { code: '23505', message: 'Tento soubor už je připojený k záznamu ' + JINY.toUpperCase() + '.' } }
  const v5 = await pripojit()
  ok('N1: duplicita na téže pobočce → odkaz na druhý záznam, soubor uklizený', v5.ok === false && v5.jinyZaznam === JINY && zaznamy(w5, 'remove').length === 1)
  const w6 = svetSouboru()
  w6.rpc.jine_platby_pripojit_soubor = { data: null, error: { code: '23505', message: 'Tento soubor už je připojený k jinému záznamu (na provozovně, kterou nevidíte).' } }
  const v6 = await pripojit()
  ok('N1: duplicita na jiné provozovně → věta bez odkazu', v6.ok === false && v6.jinyZaznam === null && v6.chyba.includes('na jiné provozovně'))

  const w7 = svetSouboru({ uzivatel: null })
  const v7 = await pripojit()
  ok('N1: bez přihlášeného (není koho dát do p_nahral) se nic nestáhne ani nezavolá', v7.ok === false && zaznamy(w7, 'download').length === 0 && zaznamy(w7, 'rpc').length === 0)
}

console.log('\n-- N9: otevřený účet u sjetiny / neurčeného dokladu --')
{
  const okno = { odMs: TED - 86_400_000, doMs: TED + 86_400_000 }
  const stul = ucet({ externiId: '5803211947', cisloDokladu: null, stav: 'otevreny', zaplaceno: false, celkemHaleru: 131000 })
  const jiny = ucet({ externiId: 'U-7', cisloDokladu: '777', celkemHaleru: 23900 })
  const dd = [{ provozovna: 'PROV1', ucty: [stul, jiny], uplne: true }]
  const zt = (typDokladu) => ({ externiUcet: '5', castkaHaleru: 112000, mena: 'CZK', typDokladu })
  for (const typ of ['informativni_sjetina', 'nezjisteno', undefined, null]) {
    const t = L.vyhodnotitKontroluTrzby(zt(typ), dd, okno)
    const k = L.vyhodnotitKontroluSkladu(zt(typ), dd, [], okno)
    ok('N9: ' + String(typ) + ' + otevřený účet bez shody čísla (úplný seznam) → tržba nelze_overit, sklad nelze_zjistit (' + t.vysledek + ', ' + k.vysledek + ')',
      t.vysledek === 'nelze_overit' && t.detail.otevrenych === 1 && k.vysledek === 'nelze_zjistit')
  }
  for (const typ of ['uzavreny_prodej', 'rucni_spotreba']) {
    const t = L.vyhodnotitKontroluTrzby(zt(typ), dd, okno)
    const k = L.vyhodnotitKontroluSkladu(zt(typ), dd, [], okno)
    ok('N9 (protipříklad): ' + typ + ' beze změny → nenalezeno / neodecteno', t.vysledek === 'nenalezeno' && k.vysledek === 'neodecteno')
  }
  // C4 (20. 10.): pravidlo nejde po otevřeném účtu, ale po typu dokladu — účet se mezitím mohl uzavřít.
  const jenJiny = [{ provozovna: 'PROV1', ucty: [jiny], uplne: true }]
  const uzavrenyJinak = [{ provozovna: 'PROV1', ucty: [ucet({ externiId: '5803211947', cisloDokladu: '2026/0418', celkemHaleru: 131000 })], uplne: true }]
  for (const typ of ['informativni_sjetina', 'nezjisteno', undefined, null]) {
    const t = L.vyhodnotitKontroluTrzby(zt(typ), jenJiny, okno)
    const k = L.vyhodnotitKontroluSkladu(zt(typ), jenJiny, [], okno)
    ok('C4/N9: ' + String(typ) + ' bez otevřeného účtu v pokladně → nelze_overit / nelze_zjistit s vysvětlením (' + t.vysledek + ', ' + k.vysledek + ')',
      t.vysledek === 'nelze_overit' && t.detail.shoda === 'typ_neprokaze' && t.popis.includes('nepřítomnost prodeje neprokáže') && t.popis.includes('ručním prohlášením s důvodem') &&
        k.vysledek === 'nelze_zjistit' && k.detail.zdroj_shody === 'typ_neprokaze')
    const tu = L.vyhodnotitKontroluTrzby(zt(typ), uzavrenyJinak, okno)
    const ku = L.vyhodnotitKontroluSkladu(zt(typ), uzavrenyJinak, [], okno)
    ok('C4: ' + String(typ) + ' + uzavřený účet jiné částky i čísla (stůl 5 se uzavřel jako 2026/0418 za 1 310 Kč) → nelze_overit / nelze_zjistit (' + tu.vysledek + ', ' + ku.vysledek + ')',
      tu.vysledek === 'nelze_overit' && ku.vysledek === 'nelze_zjistit')
  }
  ok('C4 (protipříklad): uzavřený prodej + uzavřený účet jiné částky i čísla → nenalezeno', L.vyhodnotitKontroluTrzby(zt('uzavreny_prodej'), uzavrenyJinak, okno).vysledek === 'nenalezeno')
  ok('C4: fotka otevřeného účtu dál s vlastním vysvětlením (otevreny_doklad)', L.vyhodnotitKontroluTrzby(zt('otevreny_ucet'), jenJiny, okno).detail.otevreny_doklad === true)
  const akc = svet({ zaznam: { typ_dokladu: 'informativni_sjetina', externi_ucet: '5', castka_haleru: 112000 } })
  akc.relace.relace.ucty = async (prov, od, do_, m) => ({ stav: 'ok', ucty: m?.jenOtevrene ? [stul] : [jiny], uplne: true })
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('N9: akce zapíše u sjetiny s otevřeným stolem nelze_overit (ne nenalezeno → druhá tržba)', zapsanaKontrola(akc)?.p_vysledek === 'nelze_overit')
  // C4: databáze „nenalezeno“ / „neodečteno“ u jiného typu než uzavřený prodej / ruční spotřeba odmítne (P4) — akce ho nesmí poslat.
  for (const [typ, akceKontroly, cekam] of [
    ['informativni_sjetina', akcePos.zkontrolovatTrzbu, 'nelze_overit'],
    ['nezjisteno', akcePos.zkontrolovatTrzbu, 'nelze_overit'],
    ['informativni_sjetina', akcePos.zkontrolovatSklad, 'nelze_zjistit'],
    ['nezjisteno', akcePos.zkontrolovatSklad, 'nelze_zjistit'],
  ]) {
    const w = svet({ zaznam: { typ_dokladu: typ, externi_ucet: '5', castka_haleru: 112000 } })
    await spustit(akceKontroly, KLID, formular({}))
    ok(`C4: akce ${akceKontroly === akcePos.zkontrolovatTrzbu ? 'tržby' : 'skladu'} u typu ${typ}, v pokladně nic (úplný seznam) → zapíše ${cekam}, ne nenalezeno / neodecteno`,
      zapsanaKontrola(w)?.p_vysledek === cekam)
  }
}

console.log('\n-- N10: shoda částky s tolerancí zaokrouhlení (jen CZK, nikdy „nalezeno“) --')
{
  const okno = { odMs: TED - 86_400_000, doMs: TED + 86_400_000 }
  const d1 = (ucty) => [{ provozovna: 'PROV1', ucty, uplne: true }]
  const z10 = { externiUcet: null, castkaHaleru: 123460, mena: 'CZK', typDokladu: 'rucni_spotreba' }
  const u10 = ucet({ externiId: 'U-555', cisloDokladu: '2026000555', celkemHaleru: 123500 })
  const t = L.vyhodnotitKontroluTrzby(z10, d1([u10]), okno)
  ok('N10: 1 234,60 Kč proti 1 235,00 Kč z pokladny → pravdepodobne (castka_presne false), ne nenalezeno', t.vysledek === 'pravdepodobne' && t.detail.castka_presne === false && !('pos_prodej_id' in t.detail))
  ok('N10: totéž u skladu → nelze_zjistit', L.vyhodnotitKontroluSkladu(z10, d1([u10]), [], okno).vysledek === 'nelze_zjistit')
  ok('N10: číslo přečtené jinak („555/2026“) + částka po zaokrouhlení → pravdepodobne, nikdy nalezeno',
    L.vyhodnotitKontroluTrzby({ ...z10, externiUcet: '555/2026' }, d1([u10]), okno).vysledek === 'pravdepodobne')
  ok('N10: rozdíl 51 hal. už není zaokrouhlení → nenalezeno', L.vyhodnotitKontroluTrzby(z10, d1([ucet({ ...u10, celkemHaleru: 123511 })]), okno).vysledek === 'nenalezeno')
  ok('N10: jiná měna (EUR) přesně — rozdíl 1 cent → nenalezeno',
    L.vyhodnotitKontroluTrzby({ ...z10, mena: 'EUR', castkaHaleru: 10000 }, d1([ucet({ ...u10, mena: 'EUR', celkemHaleru: 10001 })]), okno).vysledek === 'nenalezeno')
  ok('N10: přesná shoda dál jen pravdepodobne (castka_presne true)', L.vyhodnotitKontroluTrzby({ ...z10, castkaHaleru: 123500 }, d1([u10]), okno).detail.castka_presne === true)
}

console.log('\n-- N16: odpisový účet není prodej (tržba), u skladu dál možný výdej --')
{
  const okno = { odMs: TED - 86_400_000, doMs: TED + 86_400_000 }
  const d1 = (ucty) => [{ provozovna: 'PROV1', ucty, uplne: true }]
  const z16 = { externiUcet: null, castkaHaleru: 125000, mena: 'CZK', typDokladu: 'rucni_spotreba' }
  const odpis = ucet({ externiId: 'O-1', cisloDokladu: '2026-000777', celkemHaleru: 125000, odpis: true })
  const t = L.vyhodnotitKontroluTrzby(z16, d1([odpis]), okno)
  ok('N16: tržba — odpis se stejnou částkou se za prodej nebere → nenalezeno, v detailu vynechano_odpisu 1', t.vysledek === 'nenalezeno' && t.detail.vynechano_odpisu === 1)
  ok('N16: tržba — odpis i se stejným číslem → nenalezeno (ani dodatečná kontrola ho nevezme)', L.vyhodnotitKontroluTrzby({ ...z16, externiUcet: '2026-000777' }, d1([odpis]), okno).vysledek === 'nenalezeno')
  ok('N16 (protipříklad): stejný účet bez příznaku odpisu → pravdepodobne', L.vyhodnotitKontroluTrzby(z16, d1([{ ...odpis, odpis: null }]), okno).vysledek === 'pravdepodobne')
  ok('N16: sklad — odpis se stejnou částkou dál nelze_zjistit (může to být už provedený odpis)', L.vyhodnotitKontroluSkladu(z16, d1([odpis]), [], okno).vysledek === 'nelze_zjistit')
}

console.log('\n-- N17: dohledání podle klíče — úspěch jen u uzavřeného, zaplaceného odpisu --')
{
  const d = L.dohledaniZUctu({ stav: 'ok', ucet: ucet({ externiId: 'Q', stav: 'uzavreny', zaplaceno: true, odpis: true }) })
  ok('N17: uzavřený + zaplacený + odpis → nalezeno a detail nese stav, zaplaceno, odpis (orchestrátor je ověří)',
    d.stav === 'nalezeno' && d.detail.stav === 'uzavreny' && d.detail.zaplaceno === true && d.detail.odpis === true)
  for (const [popis, prepis] of [
    ['otevřený (status new)', { stav: 'otevreny', zaplaceno: false, odpis: false }],
    ['uzavřený, nezaplacený', { stav: 'uzavreny', zaplaceno: false, odpis: true }],
    ['uzavřený, zaplacený, bez příznaku odpisu', { stav: 'uzavreny', zaplaceno: true, odpis: null }],
    ['neznámý stav', { stav: 'neznamy', zaplaceno: true, odpis: true }],
  ]) {
    ok('N17: ' + popis + ' → chyba dohledání (nejasné, nic se neopakuje ani nepotvrdí)', L.dohledaniZUctu({ stav: 'ok', ucet: ucet({ externiId: 'Q', ...prepis }) }).stav === 'chyba')
  }
  const obn = svet({ operace: { stav: 'nejasny_vysledek', platnost_do: '2026-10-16T10:05:00Z' } })
  obn.relace.schopnosti.skladovyVydej = 'api'
  obn.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: ucet({ externiId: 'POS-99', externiKlic: klic, stav: 'otevreny', zaplaceno: false, odpis: false }) })
  const v = await spustit(akcePos.obnovitVydej, KLID, formular({}))
  ok('N17: obnova nejasného výdeje s OTEVŘENÝM účtem podle klíče → žádné „Odečteno v POS“, nic se neuloží', !zaznamy(obn, 'rpc').some((x) => x[2] === 'pos_operace_dokoncit') && v.text.startsWith('Zatím beze změny'))
}

console.log('\n-- N22: uložená provozovna, kterou přeřadili jiné pobočce --')
{
  const prer = svet()
  prer.relace.provozovny = [{ id: 'PROV1', branch_id: 'B2' }, { id: 'PROV2', branch_id: 'B1' }]
  const v = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('N22: kontrola tržby — provozovna záznamu patří jiné pobočce → chyba „…už tuhle pobočku neobsluhuje — záznam opravte“, nic se nehledá ani nezapíše',
    v.stav === 'chyba' && v.text === L.HLASKA_PROVOZOVNA_JINDE && zaznamy(prer, 'ucty').length === 0 && zaznamy(prer, 'rpc').length === 0)
  const prerS = svet()
  prerS.relace.provozovny = [{ id: 'PROV1', branch_id: 'B2' }]
  const vs = await spustit(akcePos.zkontrolovatSklad, KLID, formular({}))
  ok('N22: kontrola skladu totéž', vs.text === L.HLASKA_PROVOZOVNA_JINDE && zaznamy(prerS, 'rpc').length === 0)
  const pob = svet({ zaznam: { pos_provozovna: null } })
  pob.relace.provozovny = [{ id: 'PROV1', branch_id: 'B2' }, { id: 'PROV2', branch_id: 'B1' }]
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('N22 (beze změny): záznam bez uložené provozovny hledá v provozovně přiřazené jeho pobočce (PROV2)',
    zaznamy(pob, 'ucty').length === 2 && zaznamy(pob, 'ucty').every((x) => x[1] === 'PROV2') && zapsanaKontrola(pob) !== undefined)
  const sedi = svet()
  await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({}))
  ok('N22 (protipříklad): provozovna pořád patří pobočce → hledá se v ní a výsledek se zapíše', zaznamy(sedi, 'ucty').every((x) => x[1] === 'PROV1') && zapsanaKontrola(sedi) !== undefined)
}

console.log('\n-- N11: „Jen propojit“ bez konkrétního prodeje chce důvod; propojená tržba a dodatečná kontrola --')
{
  const html = (z, akce, prepis) => renderToStaticMarkup(createElement(SekceTrzba, tprops(z, akce, prepis)))
  const pole = (form) => form.match(/<textarea\b[^>]*name="duvod_propojeni"[^>]*>/)?.[0] ?? null
  const prav = formularS(html(zaznam({ kontrolaTrzby: kontrolaPos('pravdepodobne') }), ['potvrdit_trzbu']), 'Jen propojit (do součtu se nepřičte)')
  ok('N11: „pravděpodobně“ bez pos_prodej_id → povinné pole „Proč je prodej v pokladně“ (duvod_propojeni)',
    / required=""/.test(pole(prav) ?? '') && textHtml(prav).includes('Proč je prodej v pokladně (povinné)'))
  const nelze = formularS(html(zaznam({ kontrolaTrzby: kontrolaPos('nelze_overit') }), ['potvrdit_trzbu']), 'Jen propojit (do součtu se nepřičte)')
  ok('N11: „nelze ověřit“ → pole taky', pole(nelze) !== null)
  const nal = formularS(html(zaznam({ kontrolaTrzby: kontrolaPos('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }) }), ['potvrdit_trzbu']), 'Jen propojit (do součtu se nepřičte)')
  ok('N11 (protipříklad): nalezený konkrétní prodej (pos_prodej_id) → pole není', nal !== '' && pole(nal) === null)
  const ruc = formularS(html(zaznam({ kontrolaTrzby: kontrolaPos('nalezeno', 'rucni_prohlaseni', { duvod: 'Účet 1234 uzavřený' }) }), ['potvrdit_trzbu']), 'Jen propojit (do součtu se nepřičte)')
  ok('N11: ruční prohlášení „je“ → pole není (důvod nese prohlášení)', ruc !== '' && pole(ruc) === null)

  const p1 = svet({ zaznam: { kontrola_trzby: cerstva('pravdepodobne') } })
  const v1 = await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'propojit' }))
  ok('N11: akce — propojit bez důvodu → chyba u pole duvod_propojeni, nic se nezavolá', zaznamy(p1, 'rpc').length === 0 && Boolean(v1.chyby?.duvod_propojeni))
  const p2 = svet({ zaznam: { kontrola_trzby: cerstva('pravdepodobne') } })
  await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'propojit', duvod_propojeni: 'Účet 1234 je v pokladně, dohledáno ručně' }))
  ok('N11: akce — s důvodem → p_duvod_propojeni s důvodem', rpcVolani(p2, 'jine_platby_potvrdit_trzbu')[0]?.[3]?.p_duvod_propojeni === 'Účet 1234 je v pokladně, dohledáno ručně')
  const p3 = svet({ zaznam: { kontrola_trzby: cerstva('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }) } })
  await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'propojit', duvod_propojeni: 'Tohle se nemá poslat' }))
  const pp3 = rpcVolani(p3, 'jine_platby_potvrdit_trzbu')[0]?.[3]
  ok('N11: akce — konkrétní prodej → p_duvod_propojeni null (i když formulář pole pošle)', pp3 !== undefined && 'p_duvod_propojeni' in pp3 && pp3.p_duvod_propojeni === null)
  const p4 = svet({ zaznam: { kontrola_trzby: cerstva('nenalezeno') } })
  await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'nova' }))
  ok('N11: akce — nová tržba → p_duvod_propojeni null', rpcVolani(p4, 'jine_platby_potvrdit_trzbu')[0]?.[3]?.p_duvod_propojeni === null)
  const p5 = svet({ zaznam: { kontrola_trzby: cerstva('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }) } })
  const HLASKA_B = 'Kontrola nenašla konkrétní prodej v pokladně (výsledek: pravdepodobne). Propojit jde jen s důvodem, proč je prodej v pokladně — jinak se tržba nezapočítá nikde.'
  p5.rpc.jine_platby_potvrdit_trzbu = { data: null, error: { code: '23514', message: HLASKA_B } }
  const v5 = await spustit(akce.potvrditTrzbu, KLID, formular({ rezim: 'propojit' }))
  ok('N11: hláška databáze (B) → u pole duvod_propojeni', v5.chyby?.duvod_propojeni === HLASKA_B)

  // Propojení S konkrétním prodejem (posProdejId) — jen u něj se dodatečná kontrola nabízí a varuje (R1).
  const prop = (vysledek, verze = 3) => zaznam({ stavTrzby: 'propojeno', posProdejId: 'U-100', kontrolaTrzby: kontrolaPos(vysledek, 'pos_api', {}, verze) })
  const nikde = html(prop('nenalezeno'), ['opravit_trzbu', 'kontrola_trzby'])
  const VAROVANI_NIKDE = 'Pozdější kontrola propojený prodej v pokladně nenašla — ověřte ho v pokladně (účet mohl být zrušený nebo přečíslovaný).'
  const alert = [...nikde.matchAll(/<div role="alert"[\s\S]*?<\/div>/g)].map((m) => m[0]).find((x) => textHtml(x).includes(VAROVANI_NIKDE)) ?? ''
  ok('N11/R1: propojená tržba + pozdější kontrola „nenalezeno“ → výrazné varování (role=alert, s ikonou) s odkazem na opravu',
    alert !== '' && alert.includes('class="ft-i"') && alert.includes('href="#oprava-trzby"') && /<details[^>]*id="oprava-trzby"[^>]*open=""/.test(nikde))
  ok('R1: varování radí nejdřív ověřit v pokladně („Teprve když tam opravdu není, opravte tržbu.“), ne „zapište tržbu jako novou“',
    textHtml(alert).includes('Teprve když tam opravdu není, opravte tržbu.') && !/jako nov/.test(textHtml(nikde)))
  ok('N11: u propojené tržby s konkrétním prodejem je dodatečná kontrola (když ji akce dovolí) s vysvětlením a číslem účtu',
    tlacitka(nikde).includes('Zkontrolovat v pokladně') && textHtml(nikde).includes('Dodatečná kontrola: prodej je propojený s účtem U-100'))
  ok('N11 (protipříklad): propojená tržba a kontrola „nalezeno“ → žádné varování', !textHtml(html(prop('nalezeno'), ['opravit_trzbu'])).includes(VAROVANI_NIKDE))
  const bezProdeje = html(zaznam({ stavTrzby: 'propojeno', posProdejId: null, kontrolaTrzby: kontrolaPos('pravdepodobne') }), ['opravit_trzbu'])
  ok('R1: propojení bez konkrétního účtu → dodatečná kontrola se nenabízí a obrazovka řekne proč',
    !tlacitka(bezProdeje).includes('Zkontrolovat v pokladně') && textHtml(bezProdeje).includes('propojená bez konkrétního účtu v pokladně (s důvodem) — dodatečná kontrola by ho nenašla'))
}

console.log('\n-- N3 + C1/R2: ruční prohlášení proti výsledku pokladny (bez ohledu na verzi, s potvrzením) --')
{
  const checkbox = (form, nazev) => [...form.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((x) => x.includes('name="' + nazev + '"') && x.includes('type="checkbox"')) ?? null
  const fT = (z, prepis) => formularS(renderToStaticMarkup(createElement(SekceTrzba, tprops(z, ['prohlasit_trzbu'], prepis))), 'Zapsat ruční prohlášení')
  const nalPos = zaznam({ kontrolaTrzby: kontrolaPos('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }), pokladnaTrzby: kontrolaPos('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }) })
  const bez = fT(nalPos, {})
  ok('N3: tržba — pokladna konkrétní prodej našla, bez práva na opravy → „není“ ani zaškrtnutí se nenabízí a je řečeno proč',
    !radio(bez, 'neni') && radio(bez, 'je') && radio(bez, 'nevim') && checkbox(bez, 'prepsat_pokladnu') === null && textHtml(bez).includes('přepsat smí jen člověk s právem na opravy'))
  const sOpr = fT(nalPos, { smiOpravit: true })
  ok('C1: tržba — „nalezeno“ s právem na opravy → „není“ je, se zaškrtnutím „Prodej v pokladně je jiný, ověřil(a) jsem to“ (prepsat_pokladnu)',
    radio(sOpr, 'neni') && checkbox(sOpr, 'prepsat_pokladnu')?.includes('value="ano"') === true && textHtml(sOpr).includes('Prodej v pokladně je jiný, ověřil(a) jsem to'))
  const prav = fT(zaznam({ pokladnaTrzby: kontrolaPos('pravdepodobne', 'pos_api', { shoda: 'castka' }) }), {})
  ok('R2: tržba — „pravděpodobně“ (shoda jen částky) i BEZ práva na opravy → „není“ je, se zaškrtnutím prepsat_pokladnu',
    radio(prav, 'neni') && checkbox(prav, 'prepsat_pokladnu') !== null && textHtml(prav).includes('přepíše jen se zaškrtnutím'))
  const stara = fT(zaznam({ pokladnaTrzby: kontrolaPos('nalezeno', 'pos_api', {}, 2) }), {})
  ok('C1: výsledek pokladny ke STARŠÍ verzi záznamu (uložení návrhu verzi zvedne) chrání dál — „není“ bez práva na opravy se nenabízí',
    !radio(stara, 'neni') && textHtml(stara).includes('přepsat smí jen člověk s právem na opravy'))
  const ruc = fT(zaznam({ kontrolaTrzby: kontrolaPos('nalezeno', 'rucni_prohlaseni') }), {})
  ok('N3 (protipříklad): po ručním prohlášení (pokladna se neptala) se „není“ nabízí normálně, bez zaškrtnutí', radio(ruc, 'neni') && !textHtml(ruc).includes('Pokladna při kontrole') && checkbox(ruc, 'prepsat_pokladnu') === null)
  const vyprane = fT(zaznam({ kontrolaTrzby: kontrolaPos('nalezeno', 'rucni_prohlaseni'), pokladnaTrzby: kontrolaPos('nalezeno', 'pos_api', { pos_prodej_id: 'ORDER-777' }) }), {})
  ok('Ověření 20. 10.: pokladna našla, pak ruční „je“ → „není“ bez práva na opravy se pořád nenabízí (výsledek pokladny se nevypere)',
    !radio(vyprane, 'neni') && textHtml(vyprane).includes('přepsat smí jen člověk s právem na opravy'))
  const cisloVice = fT(zaznam({ pokladnaTrzby: kontrolaPos('pravdepodobne', 'pos_api', { shoda: 'cislo_vice' }) }), {})
  ok('Ověření 20. 10.: „pravděpodobně“ ze shody čísla účtu bez práva na opravy → „není“ se nenabízí',
    !radio(cisloVice, 'neni') && checkbox(cisloVice, 'prepsat_pokladnu') === null && textHtml(cisloVice).includes('přepsat smí jen člověk s právem na opravy'))
  const fS = (z, prepis) => formularS(renderToStaticMarkup(createElement(SekceSklad, sprops(z, ['kontrola_skladu', 'prohlasit_sklad'], prepis))), 'Zapsat ruční prohlášení')
  const odect = zaznam({ kontrolaSkladu: kontrolaPos('jiz_odecteno'), pokladnaSkladu: kontrolaPos('jiz_odecteno') })
  const bezS = fS(odect, {})
  ok('N3: sklad — pokladna už odečetla, bez práva na opravy → „neodečetla“ se nenabízí a je řečeno proč', bezS !== '' && !radio(bezS, 'neni') && checkbox(bezS, 'prepsat_pokladnu') === null && textHtml(bezS).includes('přepsat smí jen člověk s právem na opravy'))
  const sOprS = fS(odect, { smiOpravit: true })
  ok('C1: sklad — s právem na opravy „neodečetla“ je, se zaškrtnutím prepsat_pokladnu', radio(sOprS, 'neni') && checkbox(sOprS, 'prepsat_pokladnu') !== null)
  ok('C1: sklad — výsledek pokladny ke starší verzi chrání dál', !radio(fS(zaznam({ pokladnaSkladu: kontrolaPos('jiz_odecteno', 'pos_api', {}, 2) }), {}), 'neni'))
  // Ověření 21. 10.: značka přepisu, nedohledaný zrušený požadavek.
  const PREPSANO = { kdo: 'U9', kdy: KDY10, vysledek: 'nenalezeno', duvod: 'Jiný host' }
  const prepsany = fT(zaznam({ pokladnaTrzby: { ...kontrolaPos('nalezeno', 'pos_api', { pos_prodej_id: 'U-100' }), prepsano: PREPSANO } }), {})
  ok('Ověření 21. 10.: výsledek pokladny už přepsaný člověkem s právem na opravy → „není“ se nabízí bez práva na opravy i bez zaškrtnutí',
    radio(prepsany, 'neni') && checkbox(prepsany, 'prepsat_pokladnu') === null && !textHtml(prepsany).includes('Pokladna při kontrole'))
  const NEDOHLEDANA = { operace: 'OP1', klic: 'ftjp-op1', stav: 'nejasny_vysledek', kdy: KDY10 }
  const nedoh = fS(zaznam({ nedohledanaOperace: NEDOHLEDANA }), {})
  ok('Ověření 21. 10.: zrušený nedohledaný požadavek, bez práva na opravy → „neodečetla“ se nenabízí a obrazovka řekne proč (s klíčem)',
    nedoh !== '' && !radio(nedoh, 'neni') && radio(nedoh, 'je') && textHtml(nedoh).includes('nikdo ho nedohledal') && textHtml(nedoh).includes('ftjp-op1'))
  const nedohOpr = fS(zaznam({ nedohledanaOperace: NEDOHLEDANA }), { smiOpravit: true })
  ok('Ověření 21. 10.: … s právem na opravy „neodečetla“ je a obrazovka řekne, co tím potvrzuje',
    radio(nedohOpr, 'neni') && textHtml(nedohOpr).includes('potvrzujete, že v pokladně neproběhl'))
  ok('Ověření 21. 10. (protipříklad): bez nedohledaného požadavku „neodečetla“ je i bez práva na opravy', radio(fS(zaznam({}), {}), 'neni'))
  ok('Ověření 20. 10.: sklad — pokladna už odečetla, pak ruční „už odečetla“ → „neodečetla“ bez práva na opravy se pořád nenabízí',
    !radio(fS(zaznam({ kontrolaSkladu: kontrolaPos('jiz_odecteno', 'rucni_prohlaseni'), pokladnaSkladu: kontrolaPos('jiz_odecteno') }), {}), 'neni'))

  const bezOpravy = new Set(VSECHNA_PRAVA.filter((p) => p !== 'jine_platby.oprava'))
  const NENI = { vysledek: 'neni', duvod: 'Není tam, ověřeno' }
  const prohl = (w) => rpcVolani(w, 'jine_platby_prohlasit')[0]?.[3]
  const a1 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: cerstva('nalezeno') } })
  const v1 = await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('N3: akce — „není“ proti nálezu pokladny bez práva na opravy (i se zaškrtnutím) → nic se nezavolá, hláška u volby', zaznamy(a1, 'rpc').length === 0 && v1.chyby?.vysledek?.includes('s právem na opravy') === true)
  const a2 = svet({ zaznam: { pokladna_trzby: cerstva('nalezeno') } })
  const v2 = await spustit(akce.prohlasitTrzbu, KLID, formular(NENI))
  ok('C1: akce — s právem na opravy, ale BEZ zaškrtnutí → nic se nezavolá, hláška u pole prepsat_pokladnu', zaznamy(a2, 'rpc').length === 0 && Boolean(v2.chyby?.prepsat_pokladnu))
  const a3 = svet({ zaznam: { pokladna_trzby: cerstva('nalezeno') } })
  await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('C1: akce — s právem na opravy a se zaškrtnutím → p_vysledek nenalezeno a p_prepsat_pokladnu true', prohl(a3)?.p_vysledek === 'nenalezeno' && prohl(a3).p_prepsat_pokladnu === true)
  const a4 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: cerstva('pravdepodobne', 'pos_api', { shoda: 'castka' }) } })
  const v4 = await spustit(akce.prohlasitTrzbu, KLID, formular(NENI))
  ok('R2: akce — „pravděpodobně“ bez zaškrtnutí → nic se nezavolá, hláška u prepsat_pokladnu', zaznamy(a4, 'rpc').length === 0 && Boolean(v4.chyby?.prepsat_pokladnu))
  const a5 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: cerstva('pravdepodobne', 'pos_api', { shoda: 'castka' }) } })
  await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('R2: akce — „pravděpodobně“ se zaškrtnutím i BEZ práva na opravy → p_prepsat_pokladnu true', prohl(a5)?.p_prepsat_pokladnu === true)
  const a6 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: { ...cerstva('pravdepodobne', 'pos_api', { shoda: 'castka' }), verze: 2 } } })
  const v6 = await spustit(akce.prohlasitTrzbu, KLID, formular(NENI))
  ok('C1: akce — výsledek pokladny ke starší verzi (návrh se mezitím uložil) → pořád chce zaškrtnutí, nic se nezavolá', zaznamy(a6, 'rpc').length === 0 && Boolean(v6.chyby?.prepsat_pokladnu))
  const a7 = svet({ prava: bezOpravy })
  await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('C1 (protipříklad): bez výsledku pokladny → p_prepsat_pokladnu false (i když formulář zaškrtnutí pošle)', prohl(a7) !== undefined && prohl(a7).p_prepsat_pokladnu === false)
  const a9 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: cerstva('pravdepodobne', 'pos_api', { shoda: 'cislo_vice' }) } })
  const v9 = await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('Ověření 20. 10.: akce — „pravděpodobně“ ze shody čísla účtu bez práva na opravy (i se zaškrtnutím) → nic se nezavolá, hláška u volby', zaznamy(a9, 'rpc').length === 0 && v9.chyby?.vysledek?.includes('s právem na opravy') === true)
  const a10 = svet({ prava: bezOpravy, zaznam: { kontrola_trzby: cerstva('nalezeno', 'rucni_prohlaseni'), pokladna_trzby: cerstva('nalezeno') } })
  const v10 = await spustit(akce.prohlasitTrzbu, KLID, formular({ ...NENI, prepsat_pokladnu: 'ano' }))
  ok('Ověření 20. 10.: akce — pokladna našla, poslední je ruční „je“ → „není“ bez práva na opravy pořád neprojde (čte se sloupec pokladny)', zaznamy(a10, 'rpc').length === 0 && v10.chyby?.vysledek?.includes('s právem na opravy') === true)
  const a8 = svet({ prava: bezOpravy, zaznam: { pokladna_trzby: cerstva('nalezeno') } })
  await spustit(akce.prohlasitTrzbu, KLID, formular({ vysledek: 'je', duvod: 'Účet 1234', pos_prodej_id: '1234', prepsat_pokladnu: 'ano' }))
  ok('N3 (protipříklad): prohlášení stejného znění („je“) projde i bez práva na opravy, p_prepsat_pokladnu false', prohl(a8)?.p_prepsat_pokladnu === false)
  const s1 = svet({ prava: bezOpravy, zaznam: { pokladna_skladu: cerstva('jiz_odecteno') } })
  const vs1 = await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně', prepsat_pokladnu: 'ano' }))
  ok('N3: akce sklad — „neodečetla“ proti „už odečteno“ bez práva na opravy → nic se nezavolá, hláška u volby', zaznamy(s1, 'rpc').length === 0 && Boolean(vs1.chyby?.vysledek))
  const s2 = svet({ zaznam: { pokladna_skladu: cerstva('jiz_odecteno') } })
  const vs2 = await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně' }))
  ok('C1: akce sklad — s právem na opravy bez zaškrtnutí → nic se nezavolá, hláška u prepsat_pokladnu', zaznamy(s2, 'rpc').length === 0 && Boolean(vs2.chyby?.prepsat_pokladnu))
  const s3 = svet({ zaznam: { pokladna_skladu: cerstva('jiz_odecteno') } })
  await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně', prepsat_pokladnu: 'ano' }))
  ok('C1: akce sklad — s právem na opravy a zaškrtnutím → p_vysledek neodecteno, p_prepsat_pokladnu true', prohl(s3)?.p_vysledek === 'neodecteno' && prohl(s3).p_prepsat_pokladnu === true)
  const NEDOH = { operace: 'OP1', klic: 'ftjp-op1', stav: 'nejasny_vysledek', kdy: '2026-10-16T10:00:00Z' }
  const s4 = svet({ prava: bezOpravy, zaznam: { nedohledana_operace: NEDOH } })
  const vs4 = await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně' }))
  ok('Ověření 21. 10.: akce sklad — po zrušení nedohledaného požadavku „neodečetla“ bez práva na opravy → nic se nezavolá, hláška u volby',
    zaznamy(s4, 'rpc').length === 0 && vs4.chyby?.vysledek?.includes('nikdo ho nedohledal') === true)
  const s5 = svet({ zaznam: { nedohledana_operace: NEDOH } })
  await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně osobně' }))
  ok('Ověření 21. 10.: … s právem na opravy se prohlášení „neodečteno“ zavolá', prohl(s5)?.p_vysledek === 'neodecteno')
  const s6 = svet({ prava: bezOpravy, zaznam: { nedohledana_operace: NEDOH } })
  await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'je', duvod: 'V pokladně proběhl' }))
  ok('Ověření 21. 10. (protipříklad): „už odečetla“ jde i bez práva na opravy', prohl(s6)?.p_vysledek === 'jiz_odecteno')

  // Hlášky databáze (P1) u pole, kterého se týkají.
  const HLASKA_P1A = 'Pokladna při kontrole tohle našla (výsledek: pravdepodobne). Ruční prohlášení opačného znění to bez výslovného potvrzení nepřepíše — zopakujte kontrolu v pokladně, nebo potvrďte, že prodej v pokladně je jiný.'
  const HLASKA_P1B = 'Pokladna při kontrole tohle našla (výsledek: nalezeno) — konkrétní prodej nebo odpis přepsat smí jen člověk s právem na opravy.'
  const d1 = svet()
  d1.rpc.jine_platby_prohlasit = { data: null, error: { code: '23514', message: HLASKA_P1A } }
  const vd1 = await spustit(akce.prohlasitTrzbu, KLID, formular(NENI))
  ok('C1: hláška databáze „bez výslovného potvrzení“ se ukáže celá a u pole prepsat_pokladnu', vd1.text === HLASKA_P1A && vd1.chyby?.prepsat_pokladnu === HLASKA_P1A)
  const d2 = svet()
  d2.rpc.jine_platby_prohlasit = { data: null, error: { code: '23514', message: HLASKA_P1B } }
  const vd2 = await spustit(akce.prohlasitSklad, KLID, formular({ vysledek: 'neni', duvod: 'Ověřeno v pokladně' }))
  ok('C1: hláška databáze „jen člověk s právem na opravy“ → u pole vysledek', vd2.text === HLASKA_P1B && vd2.chyby?.vysledek === HLASKA_P1B)
  const d3 = svet()
  d3.rpc.jine_platby_prohlasit = { data: null, error: { code: '23514', message: 'Ruční doložení tržby: prodej v pokladně je, nebo není.' } }
  const vd3 = await spustit(akce.prohlasitTrzbu, KLID, formular(NENI))
  ok('C1 (protipříklad): jiná hláška 23514 se k žádnému poli nepřiřadí', vd3.stav === 'chyba' && vd3.chyby === undefined)
}

console.log('\n-- N14 + N15 + N21: schválený výdej (zámek položek, nevyřešené položky, varování) --')
{
  const STUB_AKCE_AI = js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")
  const SekceKontrola10 = await nactiKomponentu(ZAZNAM + '/sekce-kontrola.tsx', [...KRESLENI, ['../akce-ai', STUB_AKCE_AI]])
  const editor = { hlavicka: { datum: '2026-10-15', oznaceni: '', mena: 'CZK', castka: '450', castkaPuvod: 'doklad', typ: 'uzavreny_prodej', externi: '', kontaktId: '' }, polozky: [], katalog: [], kontakty: null }
  const kontrola = (stavSkladu) =>
    textHtml(renderToStaticMarkup(createElement(SekceKontrola10, {
      zakl, z: zaznam({ stavSkladu }), akce: new Set(['upravit']), smiUpravit: true, editor, polozky: [], rozpoznani: null, kontrolaRozpoznani: null,
      coZkontrolovat: [], nesoulad: null, ai: { zapnuto: false, pocetSouboru: 0 }, katalog: null, zona: 'Europe/Prague',
    })))
  ok('N14: schválený výdej → editor návrhu nahoře řekne, že položky pro sklad teď nejde měnit', kontrola('schvaleno').includes('Výdej je schválený — položky, které se týkají skladu'))
  ok('N14: předaný k ručnímu odpisu → totéž', kontrola('nepodporovano').includes('Výdej je předaný k ručnímu provedení v pokladně — položky, které se týkají skladu'))
  ok('N14 (protipříklad): bez schváleného výdeje věta není', !kontrola('bez_navrhu').includes('položky, které se týkají skladu'))

  const blokace = [{ poradi: 3, nazev: 'Pivo 0,3', duvod: 'Produkt v katalogu pokladny není (katalog není načtený, nebo produkt v pokladně zrušili) — přiřazení nejde ověřit.' }]
  const VAROVANI = 'Výdej obsahuje pokrm i další zboží. Zkontrolujte, že zboží není surovina toho pokrmu — suroviny pokrmu odečte pokladna podle receptury sama.'
  const nahled = (bl = [], varovani = []) => ({ polozky: [], polozek: 1, blokace: bl, varovani })
  const NEVYRESENA = [{ poradi: 2, nazev: 'Svíčková', duvod: 'Položka čeká na kontrolu.' }]
  for (const stav of ['schvaleno', 'nepodporovano']) {
    const h = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: stav }), ['rucne_dolozit'], { navrh: NAVRH10, operace: OPERACE10(stav === 'schvaleno' ? 'pripraveno' : 'nepodporovano'), nevyresenePolozky: NEVYRESENA, nahled: nahled([{ ...NEVYRESENA[0] }]) })))
    ok('N15: ' + stav + ' + nevyřešená položka → „Ručně doloženo“ se nenabízí a položka je vidět s důvodem (jednou)',
      !tlacitka(h).includes('Ručně doloženo') && textHtml(h).includes('Návrh výdeje má nevyřešené položky — ručně doložit ho teď nejde') &&
        textHtml(h).split('Položka 2 (Svíčková): Položka čeká na kontrolu.').length === 2 && !textHtml(h).includes('Pozor u výdeje'))
    const k = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: stav }), ['rucne_dolozit'], { navrh: NAVRH10, operace: OPERACE10(stav === 'schvaleno' ? 'pripraveno' : 'nepodporovano'), nahled: nahled(blokace) })))
    ok('R4: ' + stav + ' + produkt zrušený v katalogu po schválení → „Ručně doloženo“ JE (databáze doložení pustí), položka jen jako upozornění s vysvětlením',
      tlacitka(k).includes('Ručně doloženo') && textHtml(k).includes('Pozor u výdeje: Položka 3 (Pivo 0,3): Produkt v katalogu pokladny není') &&
        textHtml(k).includes('Katalog pokladny se od schválení změnil') && !textHtml(k).includes('ručně doložit ho teď nejde'))
  }
  ok('R4: zrcadlo databáze — nevyřešená položka pro doložení: ke kontrole, nezařazená, skladová bez ověřeného přiřazení nebo bez množství; služba ani ověřený nápoj ne',
    (() => {
      const pp = (prepis) => ({ nazev: 'X', druh: 'rozlevany_napoj', mapovani: 'overeno', posMnozstvi: '1', vyzadujeKontrolu: false, ...prepis })
      const v = L.nevyresenePolozkyDolozeni([
        pp({ vyzadujeKontrolu: true }),
        pp({ druh: 'nezarazeno', mapovani: 'nenamapovano', posMnozstvi: null }),
        pp({ druh: 'pokrm', mapovani: 'navrh' }),
        pp({ druh: 'kusove_zbozi', posMnozstvi: null }),
        pp({}),
        pp({ druh: 'sluzba', mapovani: 'neskladova', posMnozstvi: null }),
        pp({ druh: 'spropitne', mapovani: 'neskladova', posMnozstvi: null }),
      ])
      return JSON.stringify(v.map((x) => x.poradi)) === '[1,2,3,4]' && v[2].duvod.includes('ověřené přiřazení') && v[3].duvod.includes('množství')
    })())
  const bezBl = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'nepodporovano' }), ['rucne_dolozit'], { navrh: NAVRH10, operace: OPERACE10('nepodporovano'), nahled: nahled() })))
  ok('N15 (protipříklad): bez nevyřešené položky „Ručně doloženo“ je', tlacitka(bezBl).includes('Ručně doloženo'))
  const celek = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'schvaleno' }), ['rucne_dolozit'], {
    navrh: NAVRH10, operace: OPERACE10('pripraveno'), nahled: nahled([{ poradi: null, nazev: null, duvod: 'Pokladna nebo její provozovna už tuhle pobočku neobsluhuje (změna v Integracích) — výdej přes ni nejde připravit.' }]),
  })))
  ok('N15/N22: blokace celého výdeje (pokladna neobsluhuje pobočku) se ukáže, doložení neblokuje',
    textHtml(celek).includes('už tuhle pobočku neobsluhuje') && tlacitka(celek).includes('Ručně doloženo'))

  const schv = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], { navrh: { ...NAVRH10, stav: 'ceka_na_schvaleni' }, muzeSchvalit: true, nahled: nahled([], [VAROVANI]) })))
  ok('N21: panel schválení ukáže varování náhledu (pokrm i další zboží) a schválit pořád jde',
    textHtml(schv).includes('Upozornění: ' + VAROVANI) && tlacitka(schv).includes('Potvrdit výdej do POS'))
  const rucne = renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'nepodporovano' }), ['rucne_dolozit'], { navrh: NAVRH10, operace: OPERACE10('nepodporovano'), nahled: nahled([], [VAROVANI]) })))
  const iPostup = textHtml(rucne).indexOf('Ruční zpracování — appka zápis do skladu')
  const iVar = textHtml(rucne).indexOf('Upozornění: ' + VAROVANI)
  ok('N21: panel ručního odpisu ukáže varování u postupu a doložit pořád jde', iPostup >= 0 && iVar > iPostup && tlacitka(rucne).includes('Ručně doloženo'))
  ok('N21 (protipříklad): bez varování se nic nekreslí', !textHtml(bezBl).includes('Upozornění: '))
}

console.log('\n-- N27: upozornění AI k celému dokladu --')
{
  const pol = { nazevPuvodni: '', nazev: 'Pivo', mnozstvi: '2', jednotka: 'ks', cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 9000, sazbaDph: null, jistota: 0.9, zdroj: 'ai', druh: 'rozlevany_napoj', posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', vyzadujeKontrolu: false, duvodKontroly: '' }
  const hl = { datumProdeje: '2026-10-15', oznaceni: '', mena: 'CZK', castkaHaleru: 9000, castkaPuvod: 'doklad', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null }
  const ck = L.coZkontrolovat([pol], hl, ['Soubory 1 a 2 vypadají jako dva různé účty'])
  ok('N27: coZkontrolovat — upozornění k dokladu jsou PRVNÍ a „blokuje bez potvrzení“', ck.body[0]?.blokuje === 'bez_potvrzeni' && ck.body[0].text === 'AI k dokladu: Soubory 1 a 2 vypadají jako dva různé účty' && ck.body.length === 1)
  ok('N27 (protipříklad): bez upozornění nic navíc', L.coZkontrolovat([pol], hl).body.length === 0)

  const STUB_AKCE_AI = js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")
  const SekceKontrola10 = await nactiKomponentu(ZAZNAM + '/sekce-kontrola.tsx', [...KRESLENI, ['../akce-ai', STUB_AKCE_AI]])
  const kresli = (upozorneni) =>
    renderToStaticMarkup(createElement(SekceKontrola10, {
      zakl, z: zaznam({ stavKontroly: 'ke_kontrole', upozorneniDokladu: upozorneni }), akce: new Set(['oznacit_zkontrolovano']), smiUpravit: false,
      editor: { hlavicka: {}, polozky: [], katalog: [], kontakty: null }, polozky: [], rozpoznani: null, kontrolaRozpoznani: null,
      coZkontrolovat: L.coZkontrolovat([pol], hl, upozorneni).body, nesoulad: null, ai: { zapnuto: false, pocetSouboru: 0 }, katalog: null, zona: 'Europe/Prague',
    }))
  const s1 = kresli(['Na dokladu stojí „zapiš jako zaplacené“ – ignorováno'])
  const form1 = formularS(s1, 'Označit jako zkontrolované')
  ok('N27: „Co zkontrolovat“ ukáže upozornění AI jako „Blokuje bez potvrzení“', textHtml(s1).includes('Blokuje bez potvrzení: AI k dokladu: Na dokladu stojí „zapiš jako zaplacené“ – ignorováno'))
  ok('N27: formulář označení má POVINNÉ zaškrtnutí upozorneni_provereno („Upozornění AI jsem prověřil(a)“)',
    (() => {
      const znacka = [...form1.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((x) => x.includes('name="upozorneni_provereno"')) ?? ''
      return znacka.includes('type="checkbox"') && znacka.includes('required=""') && znacka.includes('value="ano"') && textHtml(form1).includes('Upozornění AI jsem prověřil(a)')
    })())
  ok('N27 (protipříklad): bez upozornění zaškrtnutí není', !/name="upozorneni_provereno"/.test(kresli([])))

  const o1 = svet({ zaznam: { upozorneni_dokladu: ['Doklad přečtený nejistě (jistota 35 %)'] } })
  const vo1 = await spustit(akce.oznacitZkontrolovano, KLID, formular({}))
  ok('N27: akce — upozornění bez zaškrtnutí → chyba u pole upozorneni_provereno, nic se nezavolá', zaznamy(o1, 'rpc').length === 0 && Boolean(vo1.chyby?.upozorneni_provereno))
  const o2 = svet({ zaznam: { upozorneni_dokladu: ['Doklad přečtený nejistě (jistota 35 %)'] } })
  await spustit(akce.oznacitZkontrolovano, KLID, formular({ upozorneni_provereno: 'ano' }))
  ok('N27: akce — se zaškrtnutím → p_upozorneni_provereno true', rpcVolani(o2, 'jine_platby_oznacit_zkontrolovano')[0]?.[3]?.p_upozorneni_provereno === true)
  const o3 = svet()
  await spustit(akce.oznacitZkontrolovano, KLID, formular({ upozorneni_provereno: 'ano' }))
  ok('N27: akce — bez upozornění → p_upozorneni_provereno false (i když formulář pole pošle)', rpcVolani(o3, 'jine_platby_oznacit_zkontrolovano')[0]?.[3]?.p_upozorneni_provereno === false)
  const o4 = svet({ zaznam: { upozorneni_dokladu: ['X'] } })
  const HLASKA_C = 'AI k dokladu napsala upozornění (X). Prověřte je a potvrďte, že jste je prověřili.'
  o4.rpc.jine_platby_oznacit_zkontrolovano = { data: null, error: { code: '23514', message: HLASKA_C } }
  const vo4 = await spustit(akce.oznacitZkontrolovano, KLID, formular({ upozorneni_provereno: 'ano' }))
  ok('N27: hláška databáze (C) → u pole upozorneni_provereno', vo4.chyby?.upozorneni_provereno === HLASKA_C)
}

console.log('\n-- N27 + N29 + N30 + N31: rozpoznání (upozornění, čas, verze, provozní den) --')
{
  const dokl = (prepis = {}) => ({
    polozky: [{ nazev: 'Pivo 0,5 l', mnozstvi: '2', jednotka: 'ks', cenaJednotkova: '45', cenaCelkem: '90', sazbaDph: '21', druhNavrh: 'rozlevany_napoj', jistota: 0.95, poznamka: null }],
    celkem: '90', kUhrade: '90', zaplaceno: null, prijatoHotove: null, vraceno: null, zbyva: null, sleva: null, spropitne: null,
    mena: 'Kč', datum: '2026-10-15', cas: null, externiId: '1234', typDokladu: 'uzavreny_prodej', textDokladu: 'Pivo 2x 90', jistota: 0.95, upozorneni: [], ...prepis,
  })
  const aiOk = (d) => ({ zapnuto: true, vyhodit: false, vysledek: { stav: 'ok', doklad: d, model: 'claude-opus-5-5', verze: 'jine-platby-v2' } })
  const hlavickaUlozeni = (w) => rpcVolani(w, 'jine_platby_ulozit_navrh')[0]?.[3]?.p_hlavicka

  const u1 = svetAi({ ai: aiOk(dokl({ jistota: 0.35, upozorneni: ['Soubory 1 a 2 vypadají jako dva různé účty'] })) })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const h1 = hlavickaUlozeni(u1)
  ok('N27: rozpoznání uloží upozornění k dokladu (upozornění AI i nízkou jistotu) do p_hlavicka.upozorneni_dokladu',
    Array.isArray(h1?.upozorneni_dokladu) && h1.upozorneni_dokladu.some((t) => t.includes('Soubory 1 a 2 vypadají jako dva různé účty')) && h1.upozorneni_dokladu.some((t) => t.includes('jistota 35 %')))
  // Čas na dokladu (12:00): bez něj kontrola připíše upozornění „Datum z dokladu je kalendářní den tisku…“ (C10, lib).
  const u2 = svetAi({ ai: aiOk(dokl({ cas: '12:00' })) })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const h2 = hlavickaUlozeni(u2)
  ok('N27: bez upozornění se pošle PRÁZDNÉ pole (nové čtení stará upozornění nahradí, ne ponechá)', h2 !== undefined && 'upozorneni_dokladu' in h2 && Array.isArray(h2.upozorneni_dokladu) && h2.upozorneni_dokladu.length === 0)
  ok('N30: zahájení dostane p_verze z formuláře (3)', rpcVolani(u2, 'jine_platby_zahajit_rozpoznani')[0]?.[3]?.p_verze === 3)

  const ver = svetAi({ ai: aiOk(dokl()) })
  const vv = await spustit(akceAi.rozpoznat, KLID, formular({ verze: '2' }))
  ok('N30: formulář se starší verzí → „Formulář je zastaralý…“ PŘED zahájením: nic se nestáhne, nezapočítá ani nepošle AI',
    vv.stav === 'chyba' && vv.text.startsWith('Formulář je zastaralý') && zaznamy(ver, 'rpc').length === 0 && zaznamy(ver, 'download').length === 0 && zaznamy(ver, 'ai').length === 0)
  // C9/R3 (20. 10.): schválený nebo provedený výdej čtení nezahájí (uložení položek skladu by spadlo po zaplaceném čtení) …
  const P5 = ['schvaleno', 'nepodporovano', 'zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno']
  const odmitnute = []
  for (const stav of P5) {
    const w = svet({ ai: aiOk(dokl()), zaznam: { stav_skladu: stav } })
    const v = await spustit(akceAi.rozpoznat, KLID, formular({}))
    if (!(v.stav === 'chyba' && v.text === L.HLASKA_ROZPOZNANI_SKLAD && zaznamy(w, 'rpc').length === 0 && zaznamy(w, 'download').length === 0 && zaznamy(w, 'ai').length === 0)) odmitnute.push(stav)
  }
  ok(`C9: výdej ve stavu ${P5.join(', ')} → „Výdej je schválený nebo provedený…“ PŘED stažením, zahájením i AI${odmitnute.length ? ` — prošlo: ${odmitnute.join(', ')}` : ''}`, odmitnute.length === 0)
  ok('C9: hláška je stejná jako v databázi (P5)', L.HLASKA_ROZPOZNANI_SKLAD.startsWith('Výdej je schválený nebo provedený — nové rozpoznání by měnilo položky skladu'))
  for (const stav of ['bez_navrhu', 'zamitnuto', 'nevyzaduje', 'ceka_na_schvaleni', 'chyba']) {
    const w = svet({ ai: aiOk(dokl()), zaznam: { stav_skladu: stav } })
    await spustit(akceAi.rozpoznat, KLID, formular({}))
    ok('C9 (protipříklad): sklad „' + stav + '“ → čtení se zahájí', rpcVolani(w, 'jine_platby_zahajit_rozpoznani').length === 1)
  }
  // … zapsaná tržba čtení NEBRÁNÍ, ale uložená částka, měna a datum zůstanou a rozdíl jde do upozornění (R3).
  const zap = svetAi({ ai: aiOk(dokl({ celkem: '1480', mena: 'EUR', datum: '2026-10-14' })), zaznam: { stav_trzby: 'zapsano', castka_puvod: 'rucne' } })
  const vz = await spustit(akceAi.rozpoznat, KLID, formular({}))
  const hz = hlavickaUlozeni(zap)
  ok('R3: zapsaná tržba → rozpoznání proběhne a návrh se uloží', vz.stav === 'ok' && rpcVolani(zap, 'jine_platby_zahajit_rozpoznani').length === 1 && hz !== undefined)
  ok('C9: zapsaná tržba → do návrhu jde ULOŽENÁ částka (450 Kč), její původ (ručně), měna (CZK) i datum (15. 10.), ne přečtené',
    hz?.castka_haleru === 45000 && hz.mena === 'CZK' && hz.datum_prodeje === '2026-10-15' && hz.castka_puvod === 'rucne')
  ok('C9: rozdíl přečtené částky, měny a data je v upozornění k dokladu (první, s „tržba je už zapsaná“)',
    Array.isArray(hz?.upozorneni_dokladu) &&
      String(hz.upozorneni_dokladu[0]).replace(/ /g, ' ').startsWith('AI na dokladu přečetla celkovou cenu 1 480,00 EUR, uložená je 450,00 Kč — ponechána uložená (tržba je už zapsaná') &&
      hz.upozorneni_dokladu.some((t) => t.startsWith('AI na dokladu přečetla měnu EUR, uložená je CZK — ponechána uložená')) &&
      hz.upozorneni_dokladu.some((t) => t.startsWith('AI na dokladu přečetla datum 14. 10. 2026') && t.includes('(tržba je už zapsaná')))
  const zapU = svetAi({ ai: aiOk(dokl({ celkem: '450', kUhrade: '450', cas: '12:00', externiId: '9876', typDokladu: 'otevreny_ucet' })), zaznam: { stav_trzby: 'zapsano' } })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const hU = hlavickaUlozeni(zapU)
  ok('Ověření 20. 10.: zapsaná tržba → číslo účtu (1234) a typ dokladu (uzavřený prodej) zůstanou uložené, ne přečtené (9876, otevřený účet)',
    hU?.externi_ucet === '1234' && hU.typ_dokladu === 'uzavreny_prodej')
  ok('Ověření 20. 10.: rozdíl čísla účtu a typu dokladu je v upozornění k dokladu',
    Array.isArray(hU?.upozorneni_dokladu) &&
      hU.upozorneni_dokladu.some((t) => t.startsWith('AI na dokladu přečetla číslo účtu 9876, uložené je 1234 — ponecháno uložené (tržba je už zapsaná')) &&
      hU.upozorneni_dokladu.some((t) => t.startsWith('AI doklad přečetla jako „') && t.includes('ponechán uložený (tržba je už zapsaná')))
  const volU = svetAi({ ai: aiOk(dokl({ externiId: '9876', typDokladu: 'otevreny_ucet' })) })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('Ověření 20. 10. (protipříklad): nezapsaná tržba → číslo účtu a typ dokladu z dokladu', hlavickaUlozeni(volU)?.externi_ucet === '9876' && hlavickaUlozeni(volU)?.typ_dokladu === 'otevreny_ucet')
  const zap2 = svetAi({ ai: aiOk(dokl({ celkem: '450', kUhrade: '450', cas: '12:00' })), zaznam: { stav_trzby: 'propojeno' } })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const hz2 = hlavickaUlozeni(zap2)
  ok('C9 (protipříklad): propojená tržba a doklad se stejnou částkou, měnou i datem → žádné upozornění navíc', hz2?.castka_haleru === 45000 && Array.isArray(hz2.upozorneni_dokladu) && hz2.upozorneni_dokladu.length === 0)
  const fak = svetAi({ ai: aiOk(dokl({ celkem: '1480', mena: 'EUR' })), zaznam: { stav_faktury: 'propojena' } })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const hf = hlavickaUlozeni(fak)
  ok('C9: propojená faktura (tržba nezapsaná) → částka zůstane uložená s upozorněním, měna z dokladu',
    hf?.castka_haleru === 45000 && hf.mena === 'EUR' && hf.upozorneni_dokladu?.[0]?.includes('(k záznamu je propojená faktura)'))
  const vol = svetAi({ ai: aiOk(dokl({ celkem: '1480' })) })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('C9 (protipříklad): nezapsaná tržba bez faktury → částka z dokladu (1 480 Kč)', hlavickaUlozeni(vol)?.castka_haleru === 148000)
  // C7: s návrhem se uloží vazba na tohle rozpoznání (id ze zahájení).
  ok('C7: návrh z rozpoznání nese p_hlavicka.rozpoznani_id = id ze zahájení (R1)', hlavickaUlozeni(vol)?.rozpoznani_id === 'R1')

  // N31: účet vytištěný 16. 10. v 1:30, pobočka začíná den v 5:00 → provozní den 15. 10. (stejný jako uložený).
  const d31 = svetAi({ ai: aiOk(dokl({ datum: '2026-10-16', cas: '01:30' })) })
  d31.tabulky.branches = { timezone: 'Europe/Prague', day_starts_at: '05:00:00' }
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const h31 = hlavickaUlozeni(d31)
  ok('N31: začátek provozního dne pobočky se předá kontrole — účet z 1:30 patří do 15. 10., upozornění na posun, uložené datum sedí',
    h31?.datum_prodeje === '2026-10-15' && Array.isArray(h31.upozorneni_dokladu) && h31.upozorneni_dokladu.some((t) => t.includes('Účet vytištěný v 01:30')) && !h31.upozorneni_dokladu.some((t) => t.includes('ponechán uložený')))
  const bezPob = svetAi({ ai: aiOk(dokl({ datum: '2026-10-16', cas: '01:30' })) })
  bezPob.tabulky.branches = null
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  const hbp = hlavickaUlozeni(bezPob)
  ok('N31: začátek dne pobočky nejde přečíst → nic se neposouvá; AI přečetla jiné datum než uložené → uložené zůstane a rozdíl jde do upozornění',
    hbp?.datum_prodeje === '2026-10-15' && Array.isArray(hbp.upozorneni_dokladu) && hbp.upozorneni_dokladu[0]?.startsWith('AI na dokladu přečetla datum 16. 10. 2026, uložený provozní den je 15. 10. 2026 — ponechán uložený') && !hbp.upozorneni_dokladu.some((t) => t.includes('Účet vytištěný')))
  const novy = svetAi({ ai: aiOk(dokl({ datum: '2026-10-16' })), zaznam: { datum_prodeje: null } })
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('N31 (protipříklad): bez uloženého data se vezme datum z dokladu', hlavickaUlozeni(novy)?.datum_prodeje === '2026-10-16')

  // N29: stažení souborů snědlo čas — s méně než 30 s do termínu se nic nezahajuje.
  const skutecne = Date.now
  let posun = 0
  Date.now = () => skutecne() + posun
  try {
    const pomaly = svetAi({ ai: aiOk(dokl()) })
    pomaly.priStazeni = () => {
      posun += 75_000
    }
    const vp = await spustit(akceAi.rozpoznat, KLID, formular({}))
    ok('N29: po stažení zbývá do termínu 25 s → nic se nezahájí, nezapočítá ani nepošle AI', vp.stav === 'chyba' && vp.text.includes('nezbývá dost času') && zaznamy(pomaly, 'rpc').length === 0 && zaznamy(pomaly, 'ai').length === 0)
    // C8: soubor od záznamu odpojit nejde (akce-soubory umí jen připojit) — rada „s menším počtem souborů“ by nešla poslechnout.
    ok('C8: hláška o času neradí „méně souborů“ (soubor nejde odpojit)', vp.text.includes('Zkuste to znovu.') && !/menším počtem|méně souborů/.test(vp.text))
    posun = 0
    const stihne = svetAi({ ai: aiOk(dokl()) })
    stihne.priStazeni = () => {
      posun += 60_000
    }
    await spustit(akceAi.rozpoznat, KLID, formular({}))
    ok('N29 (protipříklad): zbývá 40 s → čtení se zahájí', rpcVolani(stihne, 'jine_platby_zahajit_rozpoznani').length === 1 && zaznamy(stihne, 'ai').length === 1)
  } finally {
    Date.now = skutecne
  }
}

console.log('\n-- N28 + C7/R5: ze kterého rozpoznání je návrh (vazba rozpoznani_id, ne verze) --')
{
  const ok_ = (id, verzeZaznamu, vytvoreno) => ({ id, stav: 'ok', vysledek: {}, duvod: null, vytvoreno, verzeZaznamu })
  const A = ok_('A', 1, '2026-10-16T10:00:00Z')
  const B = ok_('B', 3, '2026-10-16T10:05:00Z')
  const r0 = L.rozpoznaniNavrhu(A, [B, A], 4)
  ok('C7/R5: [ok neuložené vz=3, ok uložené vz=1] při verzi 4 → zdroj je ULOŽENÉ (podle vazby), neuložené je mezi novějšími, návrh se od čtení upravil',
    r0.zdroj?.id === 'A' && r0.novejsi.length === 1 && r0.novejsi[0].id === 'B' && r0.upravenoPotom === true)
  const CH = { id: 'C', stav: 'chyba', vysledek: null, duvod: 'timeout', vytvoreno: '2026-10-16T10:05:00Z', verzeZaznamu: 2 }
  const r1 = L.rozpoznaniNavrhu(A, [CH, A], 2)
  ok('N28: novější pokus skončil chybou → zdroj je uložené čtení, novější pokus je v „novejsi“, bez úpravy (verze = čtení + 1)',
    r1.zdroj?.id === 'A' && r1.novejsi.length === 1 && r1.novejsi[0].stav === 'chyba' && r1.upravenoPotom === false)
  ok('N28: bez vazby (žádný návrh z rozpoznání) → žádný zdroj, i když úspěšné čtení existuje', L.rozpoznaniNavrhu(null, [B, A], 4).zdroj === null)
  ok('N28: vazba na čtení, které není „ok“ s výsledkem → žádný zdroj', L.rozpoznaniNavrhu({ ...A, stav: 'chyba', vysledek: null }, [A], 2).zdroj === null)
  const stare = ok_('S', 1, '2026-10-01T10:00:00Z')
  const r2 = L.rozpoznaniNavrhu(stare, [CH, B], 2)
  ok('C7: uložené čtení starší než všechny načtené pokusy → zdroj zůstane (žádné „po 10 pokusech panel zmizí“), novější jsou všechny po něm',
    r2.zdroj?.id === 'S' && r2.novejsi.length === 2)
}

console.log('\n-- N4: úhrada se k zrušenému záznamu nepáruje --')
{
  const UH = '55555555-2222-4333-8444-555555555555'
  const zr = svet({ zaznam: { stav_kontroly: 'zruseno' } })
  const v = await spustit(akce.evidovatUhradu, KLID, formular({ transakce: UH, castka: '450' }))
  ok('N4: akce — napárovat platbu k zrušenému záznamu → chyba, nic se nezavolá', v.stav === 'chyba' && v.text.includes('zrušený') && zaznamy(zr, 'rpc').length === 0)
  const odp = svet({ zaznam: { stav_kontroly: 'zruseno' } })
  await spustit(akce.evidovatUhradu, KLID, formular({ transakce: '' }))
  ok('N4: odpojit úhradu jde vždy (p_transakce null)', rpcVolani(odp, 'jine_platby_evidovat_uhradu')[0]?.[3]?.p_transakce === null)
  const faktura = await import(adresaModulu(ZAZNAM + '/sekce-faktura.tsx', KRESLENI))
  const platby = [{ id: UH, datum: '2026-10-15', castkaHaleru: 45000, mena: 'CZK', protistrana: 'Firma', vs: '1' }]
  const uh = (z) => renderToStaticMarkup(createElement(faktura.SekceUhrada, { zakl, z, akce: new Set(['uhrada']), platby, naparovana: null }))
  const zrus = uh(zaznam({ stavKontroly: 'zruseno' }))
  ok('N4: obrazovka — u zrušeného záznamu se napárování nenabízí a je řečeno proč', !tlacitka(zrus).includes('Napárovat platbu') && textHtml(zrus).includes('Záznam je zrušený — úhradu k němu napárovat nejde.'))
  ok('N4 (protipříklad): živý záznam napárování nabídne', tlacitka(uh(zaznam())).includes('Napárovat platbu'))
}

console.log('\n-- N26: do úložiště jde Blob s odvozeným typem --')
{
  const n = zdroj(KOREN + '/nahrat-doklad.tsx')
  const iKontrola = n.indexOf('if (problem || !jeTypSouboru(mime))')
  const iBlob = n.indexOf('blob = new Blob([blob], { type: mime })')
  const iUpload = n.indexOf('.upload(cesta, blob,')
  ok('N26: po kontrole typu (a zmenšení) se soubor obalí do Blobu s odvozeným typem, teprve pak upload — i nezmenšený',
    iKontrola > 0 && iBlob > iKontrola && iUpload > iBlob && n.split('new Blob([blob], { type: mime })').length === 2 && !/\bblob = /.test(n.slice(iBlob + 10, iUpload)))
}

/* =====================================================================
 * 11. OPRAVY PO OVĚŘENÍ OPRAV (20. 10. 2026) — čísla C a R z ověření
 *     (C1/R2, C4, C7, C9/R3 a R1 jsou u svých N v sekci 10)
 * ===================================================================== */

console.log('\n== 11. Opravy po ověření oprav (20. 10.) ==')

console.log('\n-- C6: výdej s pokrmem i kusovým zbožím chce „Zboží není surovina toho pokrmu“ --')
{
  const VAR = 'Výdej obsahuje pokrm i kusové zboží. Zkontrolujte, že zboží není surovina toho pokrmu — suroviny pokrmu odečte pokladna podle receptury sama.'
  const schv = (varovani) =>
    formularS(renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), ['rozhodnout_vydej'], {
      navrh: { ...NAVRH10, stav: 'ceka_na_schvaleni' }, muzeSchvalit: true, nahled: { polozky: [], polozek: 1, blokace: [], varovani },
    }))), 'Potvrdit výdej do POS')
  const s1 = schv([VAR])
  const znacka = [...s1.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((x) => x.includes('name="bez_surovin"')) ?? ''
  ok('C6: s varováním má formulář „Potvrdit výdej do POS“ POVINNÉ zaškrtnutí bez_surovin („Zboží není surovina toho pokrmu“)',
    znacka.includes('type="checkbox"') && znacka.includes('required=""') && znacka.includes('value="ano"') && textHtml(s1).includes('Zboží není surovina toho pokrmu'))
  ok('C6 (protipříklad): bez varování zaškrtnutí není', schv([]) !== '' && !/name="bez_surovin"/.test(schv([])))

  const NAVRH = { navrh: NAVRH_ID, otisk: 'a'.repeat(64), rozhodnuti: 'schvalit' }
  const sVar = (varovani) => {
    const w = svet({ zaznam: { stav_skladu: 'ceka_na_schvaleni' } })
    w.rpc.jine_platby_sestavit_vydej = { data: { varovani, blokace: [], polozek: 1 }, error: null }
    return w
  }
  const bez = (w) => rpcVolani(w, 'jine_platby_rozhodnout_vydej')[0]?.[3]
  const w1 = sVar([VAR])
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, bez_surovin: 'ano' }))
  ok('C6: zaškrtnuto a náhled z databáze varuje → p_bez_surovin true (náhled čte uživatelský klient)',
    bez(w1)?.p_bez_surovin === true && rpcVolani(w1, 'jine_platby_sestavit_vydej')[0]?.[1] === 'uzivatel' && rpcVolani(w1, 'jine_platby_sestavit_vydej')[0]?.[3]?.p_zaznam === ZAZNAM_ID)
  const w2 = sVar([])
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, bez_surovin: 'ano' }))
  ok('C6: zaškrtnuto, ale aktuální náhled nevaruje → p_bez_surovin false', bez(w2) !== undefined && bez(w2).p_bez_surovin === false)
  const w3 = sVar([VAR])
  await spustit(akcePos.rozhodnoutVydej, KLID, formular(NAVRH))
  ok('C6: nezaškrtnuto (náhled varuje) → p_bez_surovin false (rozhodne databáze)', bez(w3) !== undefined && bez(w3).p_bez_surovin === false)
  const w4 = sVar([VAR])
  await spustit(akcePos.rozhodnoutVydej, KLID, formular({ ...NAVRH, rozhodnuti: 'zamitnout', duvod: 'Nesedí množství', bez_surovin: 'ano' }))
  ok('C6: zamítnutí náhled nečte a p_bez_surovin je false', rpcVolani(w4, 'jine_platby_sestavit_vydej').length === 0 && bez(w4)?.p_bez_surovin === false)
  const w5 = svet({ zaznam: { stav_skladu: 'ceka_na_schvaleni' } })
  const HLASKA_P2 = 'Výdej obsahuje pokrm i kusové zboží — potvrďte, že zboží není surovina toho pokrmu (suroviny pokrmu odečte pokladna podle receptury sama).'
  w5.rpc.jine_platby_rozhodnout_vydej = { data: null, error: { code: '23514', message: HLASKA_P2 } }
  const v5 = await spustit(akcePos.rozhodnoutVydej, KLID, formular(NAVRH))
  ok('C6: hláška databáze (P2) se ukáže celá a u pole bez_surovin', v5.text === HLASKA_P2 && v5.chyby?.bez_surovin === HLASKA_P2)
}

console.log('\n-- C5: nejasná operace po vypršení platnosti --')
{
  const PROSLA = new Date(TED - 10 * 60_000).toISOString()
  const BUDOUCI = new Date(TED + 5 * 60_000).toISOString()
  const nejasna = (akceSet, platnostDo) =>
    renderToStaticMarkup(createElement(SekceSklad, sprops(zaznam({ stavSkladu: 'nejasny_vysledek' }), akceSet, {
      navrh: NAVRH10, operace: { ...OPERACE10('nejasny_vysledek'), platnostDo }, nahled: { polozky: [], polozek: 1, blokace: [], varovani: [] },
    })))
  const po = nejasna(['obnovit_vydej', 'rucne_dolozit', 'zrusit_schvaleni'], PROSLA)
  ok('C5: po platnosti (akce je nabídnou) → „Ručně doloženo“ i „Zrušit schválení“ jsou a panel řekne, že se to musí nejdřív ověřit v pokladně',
    tlacitka(po).includes('Ručně doloženo') && tlacitka(po).includes('Zrušit schválení (v pokladně nic neodepsáno)') &&
      textHtml(po).includes('Požadavek do pokladny má nejasný výsledek a jeho platnost vypršela') && textHtml(po).includes('ověřte v pokladně, jestli výdej s klíčem této operace proběhl'))
  const formRucne = formulare(po).find((x) => tlacitka(x).includes('Ručně doloženo')) ?? ''
  ok('C5: „Ručně doloženo“ u nejasné operace nese otisk schváleného návrhu a vysvětlení „jen když jste v pokladně ověřili“',
    formRucne.includes(`name="otisk" value="${'a'.repeat(64)}"`) && textHtml(formRucne).includes('Jen když jste v pokladně ověřili'))
  const pred = nejasna(['obnovit_vydej'], BUDOUCI)
  ok('C5 (protipříklad): před vypršením platnosti jen „Dohledat v pokladně“ a věta, do kdy se jen dohledává',
    tlacitka(pred).includes('Dohledat v pokladně') && !tlacitka(pred).includes('Ručně doloženo') && !tlacitka(pred).includes('Zrušit schválení (v pokladně nic neodepsáno)') &&
      textHtml(pred).includes('se výdej jen dohledává') && !textHtml(pred).includes('platnost vypršela'))
  const s = zdroj(`${ZAZNAM}/page.tsx`)
  const volani = s.slice(s.indexOf('dostupneAkce(z, prava, {'), s.indexOf('const kroky'))
  ok('C5: stránka předá dostupneAkce platnostOperace = platnost_do poslední operace výdeje',
    /platnostOperace: typeof operaceRaw\?\.platnost_do === 'string' \? operaceRaw\.platnost_do : null/.test(volani))
  ok('R4: stránka předá panelu skladu nevyřešené položky pro doložení (nevyresenePolozkyDolozeni nad uloženými položkami)', /nevyresenePolozky=\{nevyresenePolozkyDolozeni\(polozky\)\}/.test(s))
}

console.log('\n-- C9: rozpoznání na obrazovce (schválený výdej ne, zapsaná tržba ano) --')
{
  const STUB_AKCE_AI = js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")
  const SekceKontrola11 = await nactiKomponentu(ZAZNAM + '/sekce-kontrola.tsx', [...KRESLENI, ['../akce-ai', STUB_AKCE_AI]])
  const kresli = (z, akceSet) =>
    renderToStaticMarkup(createElement(SekceKontrola11, {
      zakl, z, akce: new Set(akceSet), smiUpravit: true, editor: { hlavicka: {}, polozky: [], katalog: [], kontakty: null }, polozky: [], rozpoznani: null,
      kontrolaRozpoznani: null, coZkontrolovat: [], nesoulad: null, ai: { zapnuto: true, pocetSouboru: 1 }, katalog: null, zona: 'Europe/Prague',
    }))
  const schv = textHtml(kresli(zaznam({ stavSkladu: 'schvaleno' }), []))
  ok('C9: schválený výdej, rozpoznání se nenabízí → věta „Výdej je schválený nebo provedený…“', schv.includes(L.HLASKA_ROZPOZNANI_SKLAD) && !schv.includes('Tržba je už zapsaná nebo propojená — nové rozpoznání'))
  const zap = kresli(zaznam({ stavTrzby: 'zapsano', stavSkladu: 'bez_navrhu' }), ['rozpoznat'])
  ok('R3: zapsaná tržba, rozpoznání se nabízí → tlačítko a vysvětlení, že zapsanou částku, měnu ani datum nezmění',
    tlacitka(zap).includes('Rozpoznat z dokladu') && textHtml(zap).includes('zapsanou částku, měnu ani datum nezmění'))
  ok('C9 (protipříklad): nezapsaná tržba bez výdeje → ani jedna z vět', !textHtml(kresli(zaznam({ stavSkladu: 'bez_navrhu' }), ['rozpoznat'])).includes('nezmění') && !textHtml(kresli(zaznam({ stavSkladu: 'bez_navrhu' }), ['rozpoznat'])).includes('Výdej je schválený'))
}

console.log('\n-- C1/C6: historie nese přepsaný výsledek pokladny a potvrzení bez surovin --')
{
  const t = L.shrnutiUdalosti({ vysledek: 'nenalezeno', duvod: 'Prodej v pokladně je jiný', prepsano_pokladny: 'nalezeno', prepsany_vysledek: { vysledek: 'nalezeno', zdroj: 'pos_api', detail: { pos_prodej_id: 'U-100' } } }, 'CZK')
  ok('C1: historie ruční prohlášení řekne, co přepsalo — výsledek pokladny i účet, který pokladna našla', t.includes('přepsalo výsledek pokladny (Prodej v pokladně je, účet U-100)'))
  const s = L.shrnutiUdalosti({ vysledek: 'neodecteno', prepsano_pokladny: 'jiz_odecteno', prepsany_vysledek: { detail: { externi_id: 'POS-7' } } }, 'CZK')
  ok('C1: u skladu účet z pokladny (externi_id)', s.includes('přepsalo výsledek pokladny (Pokladna už spotřebu odečetla, účet POS-7)'))
  ok('C6: schválení s potvrzením bez surovin to v historii řekne', L.shrnutiUdalosti({ kontrola: 'neodecteno', bez_surovin_potvrzeno: true }, 'CZK').includes('potvrzeno: zboží není surovina pokrmu'))
  ok('C1/C6 (protipříklad): bez přepisu a bez potvrzení nic navíc', !/přepsalo|surovina/.test(L.shrnutiUdalosti({ vysledek: 'nenalezeno', duvod: 'Akce mimo provozovnu' }, 'CZK')))
}

console.log('\n-- C8: maxDuration stránky a délka akce rozpoznání --')
{
  const stranka = zdroj(`${ZAZNAM}/page.tsx`)
  const ai = zdroj(`${KOREN}/akce-ai.ts`)
  const maxDuration = Number(stranka.match(/^export const maxDuration = (\d+)$/m)?.[1])
  const konstanta = (jmeno) => Number((ai.match(new RegExp('^const ' + jmeno + ' = ([\\d_]+)$', 'm'))?.[1] ?? 'x').replace(/_/g, ''))
  const delka = konstanta('MAX_DELKA_AKCE_MS')
  const rezerva = konstanta('REZERVA_NA_ULOZENI_MS')
  const minimum = konstanta('MIN_CAS_NA_AI_MS')
  ok(`C8: MAX_DELKA_AKCE_MS v akce-ai (${delka} ms) = maxDuration stránky detailu (${maxDuration} s)`, Number.isFinite(maxDuration) && maxDuration > 0 && delka === maxDuration * 1000)
  ok(`C8: rezerva na uložení (${rezerva} ms) a nejmenší čas na čtení (${minimum} ms) se do délky akce vejdou`, rezerva >= 10_000 && minimum > 0 && delka - rezerva - minimum > 0)
  ok('C8: termín pro model počítá akce z těch konstant (konec = začátek + MAX_DELKA_AKCE_MS − REZERVA_NA_ULOZENI_MS)', /const konec = zacatek \+ MAX_DELKA_AKCE_MS - REZERVA_NA_ULOZENI_MS/.test(ai))
}

/* =====================================================================
 * 9. CELÁ STRÁNKA s podvrženými daty: vykreslí se a má všechny části
 *    (NAHLED=soubor.html zapíše výsledné HTML pro snímek obrazovky)
 * ===================================================================== */

console.log('\n== 9. Celá stránka detailu (podvržená data) ==')
{
  const DATA = 'globalThis.__jpStranka'
  const STUB_NAV = js('export function redirect(u) { throw new Error("NEXT_REDIRECT " + u) }\nexport function notFound() { throw new Error("NOT_FOUND") }\nexport function useRouter() { return { push() {}, refresh() {} } }')
  const STRANKA = [
    ['server-only', PRAZDNY],
    ['next/link', STUB_LINK],
    ['next/navigation', STUB_NAV],
    ['next/cache', js('export function revalidatePath() {}')],
    // Práva za FIRMU (pobočka null) a na pobočce zvlášť — platby a kontakty chtějí finance.read za firmu.
    [
      '@/lib/authz',
      js(
        "export const TENANT_SCOPE_SEGMENT = 'firma'\n" +
          `export async function hasAccess(t, p, b) { return b === null ? ${DATA}.pravaFirmy.has(p) : ${DATA}.prava.has(p) }\n` +
          "export async function getUser() { return { id: 'U1' } }",
      ),
    ],
    ['@/lib/firma', js("export async function getCurrentTenantId() { return 'T1' }")],
    ['@/lib/jine-platby-pristup', js(`export async function zkusPristupJinymPlatbam() { return ${DATA}.pristup }`)],
    ['@/lib/prihlaseni-adresa', js("export async function odkazNaPrihlaseni() { return '/prihlaseni' }")],
    ['@/lib/supabase/dotaz', js("export class DotazSelhal extends Error {}\nexport function funkceNeexistuje() { return false }")],
    ['@/lib/supabase/server', js(`export async function getServerSupabase() { return ${DATA}.klient }`)],
    ['@/lib/supabase/client', js('export function getBrowserSupabase() { return null }')],
    ['@/lib/jine-platby-ai', js('export function rozpoznavaniJeNastavene() { return true }')],
    ['./nacteni', js(`export async function metadataPokladny() { return ${DATA}.pokladna }`)],
    ['./akce-soubory', js('export async function pripojitSoubor() { return { ok: true, id: "x" } }')],
    ['./detail.module.css', js('export default { original: "jp-original" }')],
    ['../akce', STUB_AKCE],
    ['../akce-pos', STUB_AKCE_POS],
    ['../akce-ai', js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")],
    ['../akce-parovani', STUB_AKCE_PAROVANI],
  ]
  const ZAKLAD_STRANKY = adresaModulu(`${ZAZNAM}/akce-zaklad.ts`, STRANKA)
  const Stranka = await nactiKomponentu(`${ZAZNAM}/page.tsx`, [...STRANKA, ['./akce-zaklad', ZAKLAD_STRANKY]])

  const ted = new Date().toISOString()
  const doklad = {
    polozky: [], celkem: '450', kUhrade: '500', zaplaceno: null, prijatoHotove: '1000', vraceno: '500', zbyva: null, sleva: null, spropitne: '50',
    mena: 'Kč', datum: '2026-10-15', externiId: '1234', typDokladu: 'uzavreny_prodej', textDokladu: '', jistota: 0.9, upozorneni: ['Číslo stolu je nečitelné'],
  }
  const polozka = (poradi, prepis) => ({
    id: `00000000-0000-4000-8000-00000000000${poradi}`, poradi, nazev_puvodni: '', nazev: '', mnozstvi: 1, jednotka: 'ks', cena_jednotkova_haleru: null, cena_celkem_haleru: null,
    sazba_dph: 21, jistota: 0.9, zdroj: 'ai', druh: 'nezarazeno', pos_produkt_id: null, pos_produkt_nazev: null, pos_mnozstvi: null, mapovani: 'nenamapovano', vyzaduje_kontrolu: false, duvod_kontroly: '', ...prepis,
  })
  const tabulky = {
    jine_platby: [radekZaznamu({ stav_skladu: 'ceka_na_schvaleni', vytvoril: 'U1', kontrola_trzby: { vysledek: 'pravdepodobne', zdroj: 'pos_api', verze: 3, kdy: ted, kdo: 'U1', detail: { popis: 'V pokladně je uzavřený účet se stejnou částkou 450,00 Kč.' } }, kontrola_skladu: { vysledek: 'neodecteno', zdroj: 'rucni_prohlaseni', verze: 3, kdy: ted, kdo: 'U1', detail: { duvod: 'Ověřeno v pokladně, výdej tam není' } }, rozpoznani_id: 'R1', zruseni_duvod: null })],
    jine_platby_soubory: [
      { id: 'S1', poradi: 1, mime: 'image/jpeg', velikost: 812345, otisk: 'a'.repeat(64) },
      { id: 'S2', poradi: 2, mime: 'application/pdf', velikost: 45000, otisk: 'b'.repeat(64) },
    ],
    jine_platby_polozky: [
      polozka(1, { nazev_puvodni: 'PIVO 0,5', nazev: 'Pivo 0,5 l', mnozstvi: 2, cena_jednotkova_haleru: 4500, cena_celkem_haleru: 9000, druh: 'rozlevany_napoj', pos_produkt_id: 'X1', pos_produkt_nazev: 'Pivo 0,5', pos_mnozstvi: 2, mapovani: 'overeno' }),
      polozka(2, { nazev_puvodni: 'SVICKOVA S KNEDLIKEM A BRUSINKAMI VELKA PORCE', nazev: 'Svíčková na smetaně s knedlíkem a brusinkami, velká porce', mnozstvi: 2, cena_jednotkova_haleru: 18000, cena_celkem_haleru: 36000, druh: 'pokrm', jistota: 0.55, vyzaduje_kontrolu: true, duvod_kontroly: 'Řádek přečtený nejistě (jistota 55 %); Druh položky není určený' }),
      polozka(3, { nazev: 'Spropitné', mnozstvi: null, jednotka: null, cena_celkem_haleru: 5000, druh: 'spropitne', mapovani: 'neskladova', sazba_dph: null }),
    ],
    jine_platby_rozpoznani: [{ id: 'R1', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted, verze_zaznamu: 2 }],
    jine_platby_skladove_navrhy: [{ id: NAVRH_ID, stav: 'ceka_na_schvaleni', otisk: 'c'.repeat(64), obsah: { polozky: [{ poradi: 1, pos_produkt_id: 'X1', nazev: 'Pivo 0,5', mnozstvi: 2 }] }, odeslal: 'U1', odeslano: ted, schvalil: null, schvaleno: null, zamitl: null, zamitnuto: null, duvod_zamitnuti: null }],
    pos_operace: [],
    jine_platby_historie: [
      { id: 'H2', kdy: ted, kdo: 'U1', udalost: 'sklad_odeslan', detail: { polozek: 1 } },
      { id: 'H1', kdy: ted, kdo: 'U1', udalost: 'rucne_dolozeno_sklad', detail: { vysledek: 'neodecteno', duvod: 'Ověřeno v pokladně, výdej tam není' } },
    ],
    ostatni_trzby: [],
    pos_katalog: [
      { externi_id: 'X1', nazev: 'Pivo 0,5', jednotka: 'Piece', mira: null, odecita_sklad: true, ma_recepturu: false, plu: [], ean: [], smazano: false, aktualizovano: ted },
      { externi_id: 'X2', nazev: 'Svíčková na smetaně', jednotka: 'Piece', mira: null, odecita_sklad: true, ma_recepturu: true, plu: [], ean: [], smazano: false, aktualizovano: ted },
    ],
    pos_mapovani: [],
    kontakty: [{ id: '44444444-2222-4333-8444-555555555555', nazev: 'Firma s.r.o.', ico: '12345678', dic: null }],
    transakce: [{ id: '55555555-2222-4333-8444-555555555555', datum: '2026-10-15', castka_haleru: 45000, mena: 'CZK', protistrana: 'Firma s.r.o.', vs: '1234' }],
    profiles: [{ user_id: 'U1', full_name: 'Kateřina Nováková' }],
    branches: { timezone: 'Europe/Prague', day_starts_at: '05:00' },
    tenants: { timezone: 'Europe/Prague' },
  }
  const dotaz = (tabulka) => {
    globalThis.__jpStranka.dotazy.push(tabulka)
    // Rozpoznání se čte i po jednom podle id (vazba rozpoznani_id, C7) — tam filtr .eq('id') platí; jinak se filtry nevyhodnocují.
    const podleId = []
    const radky = () => {
      const v = tabulky[tabulka]
      const pole = Array.isArray(v) ? v : v ? [v] : []
      return tabulka === 'jine_platby_rozpoznani' ? pole.filter((r) => podleId.every((id) => r.id === id)) : pole
    }
    const q = {
      select: () => q, eq: (k, v) => (k === 'id' && podleId.push(v), q), neq: () => q, is: () => q, in: (k, v) => (globalThis.__jpStranka.filtry.push([tabulka, k, v]), q), gte: () => q, lte: () => q, order: () => q, limit: () => q, range: () => q,
      maybeSingle: () => Promise.resolve({ data: Array.isArray(tabulky[tabulka]) ? (radky()[0] ?? null) : (tabulky[tabulka] ?? null), error: null }),
      then: (a, b) =>
        Promise.resolve(
          globalThis.__jpStranka.chybaTabulky === tabulka
            ? { data: null, error: { code: 'XX000', message: 'podvržená chyba' } }
            : { data: Array.isArray(tabulky[tabulka]) ? tabulky[tabulka] : [], error: null },
        ).then(a, b),
    }
    return q
  }
  globalThis.__jpStranka = {
    dotazy: [],
    filtry: [],
    prava: new Set(VSECHNA_PRAVA),
    pravaFirmy: new Set(VSECHNA_PRAVA),
    pristup: { stav: 'ok', ctx: { branches: [{ id: 'B1', name: 'Bernard Bar', slug: 'bernard-bar' }], tenant: { timezone: 'Europe/Prague' } }, scope: { level: 'branch', branchId: 'B1', branchSlug: 'bernard-bar' } },
    pokladna: { nazev: 'Dotykačka Bernard', nazevPoskytovatele: 'Dotykačka', odpojena: false, katalog: true, dohledaniUctu: true, skladovyVydej: 'rucne', provozovny: [{ id: 'PROV1', nazev: 'Bernard Bar — výčep', branchId: 'B1' }] },
    klient: {
      from: dotaz,
      rpc: async (nazev) =>
        nazev === 'jine_platby_sestavit_vydej'
          ? { data: { obsah: { polozky: [{ poradi: 1, pos_produkt_id: 'X1', nazev: 'Pivo 0,5', mnozstvi: 2 }] }, otisk: 'c'.repeat(64), polozek: 1, blokace: [{ poradi: 2, nazev: 'Svíčková', duvod: 'Položka čeká na kontrolu.' }], varovani: ['Výdej obsahuje pokrm i další zboží.'] }, error: null }
          : { data: null, error: null },
    },
  }

  let html = ''
  try {
    html = renderToStaticMarkup(await Stranka({ params: Promise.resolve({ rozsah: 'bernard-bar', zaznam: ZAZNAM_ID }) }))
  } catch (e) {
    console.log(`    stránka spadla: ${e instanceof Error ? e.stack : e}`)
  }
  const text = textHtml(html)
  ok('stránka se s podvrženými daty vykreslí', html.length > 1000)
  const zdrojePlateb = globalThis.__jpStranka.filtry.filter(([t, k]) => t === 'transakce' && k === 'zdroj').map(([, , v]) => JSON.stringify(v))
  ok('platby k napárování úhrady jen z banky: dotaz filtruje zdroj na fio_api, bankovni_agregator, csv_banka (ověření 21. 10.)',
    zdrojePlateb.length === 1 && zdrojePlateb[0] === JSON.stringify(['fio_api', 'bankovni_agregator', 'csv_banka']))
  ok('nadpis s očima „Finance · Tržby · Jiné platby“ a názvem záznamu', text.includes('Finance · Tržby · Jiné platby') && /<h1[^>]*>Stůl 4<\/h1>/.test(html))
  const kroky = [...html.matchAll(/<li\b[^>]*>/g)].filter((m) => html.slice(m.index - 400, m.index).includes('Průvodce záznamem'))
  ok('ukazatel kroků: 9 kroků v <ol> a právě jeden aria-current="step"', /aria-label="Průvodce záznamem"/.test(html) && (html.match(/aria-current="step"/g) ?? []).length === 1 && (html.match(/<nav aria-label="Průvodce záznamem"[\s\S]*?<\/nav>/)?.[0].match(/<li\b/g) ?? []).length === 9 && kroky !== null)
  for (const nadpis of ['Originály dokladu', 'Kontrola dokladu', 'Tržba (Ostatní tržby)', 'Sklad (výdej v pokladně)', 'Faktura', 'Úhrada', 'Historie']) {
    ok(`sekce „${nadpis}“ je na stránce (h2 v .ds-plocha)`, new RegExp(`<h2>${nadpis.replace(/[()]/g, '\\$&')}</h2>`).test(html))
  }
  ok('originál: obrázek přes /api/jine-platby/soubor/<id>, PDF jako řádek s odkazem', html.includes('src="/api/jine-platby/soubor/S1"') && text.includes('PDF, stránka 2') && html.includes('href="/api/jine-platby/soubor/S2"'))
  ok('rozpoznání: věta o AI službě Anthropic a „nic jiného“', text.includes('schválené AI službě Anthropic — nic jiného'))
  ok('částky: přijatá hotovost i K úhradě výslovně „není tržba“', text.includes('Přijato hotově (není tržba)') && text.includes('K úhradě (není tržba)'))
  ok('řádek ke kontrole má důvod a zaškrtnutí ověření', text.includes('Řádek přečtený nejistě (jistota 55 %)') && html.includes('name="p_r1_potvrdit"'))
  ok('každé viditelné textové pole a výběr má label (skrytý výběr souboru z nahrat-doklad ovládají tlačítka)', (() => {
    const pole = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter((m) => !/type="(hidden|radio|checkbox)"/.test(m[2]) && !/\shidden=""/.test(m[2]))
    return pole.length > 10 && pole.every((m) => html.lastIndexOf('<label', m.index) > html.lastIndexOf('</label>', m.index))
  })())
  ok('ruční prohlášení u skladu se ukazuje jako ruční', text.includes('ruční prohlášení člověka — pokladnou neověřeno'))
  ok('panel skladu: jednotka produktu z katalogu česky (Piece → „2 ks“), ne natvrdo', text.includes('Pivo 0,5 — 2 ks (jednotka prodeje pokladny)'))
  ok('s finance.read ZA FIRMU: bankovní platby a kontakty se načtou a platba jde vybrat',
    globalThis.__jpStranka.dotazy.includes('transakce') && globalThis.__jpStranka.dotazy.includes('kontakty') && /<select[^>]*name="transakce"/.test(html))

  // finance.read jen NA POBOČCE (ne za firmu): RLS transakcí a kontaktů je za celou firmu → nečíst, jen věta.
  globalThis.__jpStranka.pravaFirmy = new Set(VSECHNA_PRAVA.filter((p) => p !== 'finance.read'))
  globalThis.__jpStranka.dotazy = []
  let html2 = ''
  try {
    html2 = renderToStaticMarkup(await Stranka({ params: Promise.resolve({ rozsah: 'bernard-bar', zaznam: ZAZNAM_ID }) }))
  } catch (e) {
    console.log(`    stránka spadla: ${e instanceof Error ? e.stack : e}`)
  }
  ok('bez finance.read za firmu (jen na pobočce): transakce ani kontakty se vůbec nečtou',
    html2.length > 1000 && !globalThis.__jpStranka.dotazy.includes('transakce') && !globalThis.__jpStranka.dotazy.includes('kontakty'))
  ok('… místo výběru platby věta „Bankovní platby a Kontakty vidí jen finanční přehled celé firmy — zadejte číslo faktury ručně.“',
    textHtml(html2).includes('Bankovní platby a Kontakty vidí jen finanční přehled celé firmy — zadejte číslo faktury ručně.') && !/name="transakce"/.test(html2))
  globalThis.__jpStranka.pravaFirmy = new Set(VSECHNA_PRAVA)

  // Katalog nejde načíst (chyba dotazu nebo strop stránek): stránka nespadne, chyba je vidět u katalogu.
  globalThis.__jpStranka.chybaTabulky = 'pos_katalog'
  let html3 = ''
  try {
    html3 = renderToStaticMarkup(await Stranka({ params: Promise.resolve({ rozsah: 'bernard-bar', zaznam: ZAZNAM_ID }) }))
  } catch (e) {
    console.log(`    stránka spadla: ${e instanceof Error ? e.message : e}`)
  }
  globalThis.__jpStranka.chybaTabulky = null
  ok('katalog nejde načíst → stránka se vykreslí a u katalogu je chyba (žádný tichý ořez ani pád stránky)',
    html3.length > 1000 && textHtml(html3).includes('Katalog pokladny se nepodařilo načíst (XX000).') && /role="alert"[^>]*class="hlaska-chyba"/.test(html3))

  console.log('\n-- stránka: opravy 19. 10. (N21, N28) --')
  ok('N21: stránka předá varování z jine_platby_sestavit_vydej do panelu schválení', text.includes('Upozornění: Výdej obsahuje pokrm i další zboží.'))
  const vykreslit = async () => {
    try {
      return renderToStaticMarkup(await Stranka({ params: Promise.resolve({ rozsah: 'bernard-bar', zaznam: ZAZNAM_ID }) }))
    } catch (e) {
      console.log('    stránka spadla: ' + (e instanceof Error ? e.message : e))
      return ''
    }
  }
  const puvodniRozpoznani = tabulky.jine_platby_rozpoznani
  const radekStranky = tabulky.jine_platby[0]
  const sVazbou = (rozpoznani_id, verze = 3) => {
    tabulky.jine_platby = [{ ...radekStranky, rozpoznani_id, verze }]
  }
  sVazbou('R1')
  tabulky.jine_platby_rozpoznani = [
    { id: 'R2', stav: 'chyba', vysledek: null, duvod: 'AI se neozvala včas. Zkuste to znovu.', vytvoreno: ted, verze_zaznamu: 3 },
    { id: 'R1', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted, verze_zaznamu: 2 },
  ]
  const s28 = textHtml(await vykreslit())
  ok('N28: novější pokus skončil chybou → panel „Částky na dokladu“ zůstane (z čtení, ze kterého je návrh) a věta to řekne i s důvodem',
    s28.includes('Přijato hotově (není tržba)') && s28.includes('Novější pokus o rozpoznání') && s28.includes('skončil chybou (AI se neozvala včas.'))
  sVazbou(null)
  tabulky.jine_platby_rozpoznani = [{ id: 'R3', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted, verze_zaznamu: 2 }]
  const neulozeno = textHtml(await vykreslit())
  ok('C7: úspěšné čtení bez vazby u záznamu (návrh se z něj neuložil) → částky z něj se neukážou, i když verze „sedí“', neulozeno.length > 1000 && !neulozeno.includes('Přijato hotově (není tržba)'))
  sVazbou('R4')
  tabulky.jine_platby_rozpoznani = [{ id: 'R4', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted, verze_zaznamu: 1 }]
  const upraveno = textHtml(await vykreslit())
  ok('N28: návrh se od čtení ručně upravil (verze 3 proti uložení na 2) → věta o úpravě', upraveno.includes('Přijato hotově (není tržba)') && upraveno.includes('Návrh se od toho čtení ručně upravil'))
  // C7/R5: kolega uložil úpravu během čtení B (3 → 4), uložení B databáze odmítla — panel musí ukázat uložené čtení A, ne B.
  sVazbou('RA', 4)
  tabulky.jine_platby_rozpoznani = [
    { id: 'RB', stav: 'ok', vysledek: { ...doklad, celkem: '1480', kUhrade: '1480', prijatoHotove: '2000', vraceno: '520' }, duvod: null, vytvoreno: ted, verze_zaznamu: 3 },
    { id: 'RA', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted, verze_zaznamu: 1 },
  ]
  const r5 = (await vykreslit()).replace(/ /g, ' ')
  const t5 = textHtml(r5)
  ok('C7/R5: [ok neuložené vz=3, ok uložené vz=1] při verzi 4 → panel ukáže ULOŽENÉ čtení (450 Kč, ne 1 480 Kč), neuložené řekne větou, úpravu taky',
    t5.includes('Celkem — cena prodeje (jde do tržby) 450,00 Kč') && !t5.includes('1 480,00') && t5.includes('doklad přečetl, ale návrh se z něj neuložil') && t5.includes('Návrh se od toho čtení ručně upravil'))
  tabulky.jine_platby = [radekStranky]
  tabulky.jine_platby_rozpoznani = puvodniRozpoznani
  const sp = zdroj(`${ZAZNAM}/page.tsx`)
  ok("C7: stránka čte rozpoznání návrhu uživatelským klientem podle vazby: .eq('id', z.rozpoznaniId).eq('tenant_id', tenantId)",
    /supabase\.from\('jine_platby_rozpoznani'\)\.select\('[^']*vysledek[^']*'\)\.eq\('id', z\.rozpoznaniId\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/.test(sp))
  ok('C7: posledních pár pokusů jen pro větu (bez výsledku) a rozpoznaniNavrhu dostane uložené čtení',
    /\.from\('jine_platby_rozpoznani'\)\.select\('id, stav, duvod, vytvoreno, verze_zaznamu'\)/.test(sp) && /rozpoznaniNavrhu\(ulozeneRaw \? naPokus\(ulozeneRaw\) : null, pokusy, z\.verze\)/.test(sp))

  // Ověření 22. 10. (cesta C): autor bez práva na opravy u záznamu s nálezem pokladny — místo „Zrušit záznam“ vysvětlení.
  const puvodniZaznamy = tabulky.jine_platby
  globalThis.__jpStranka.prava = new Set(VSECHNA_PRAVA.filter((p) => p !== 'jine_platby.oprava'))
  tabulky.jine_platby = [radekZaznamu({ stav_skladu: 'bez_navrhu', vytvoril: 'U1', zruseni_duvod: null,
    pokladna_trzby: { vysledek: 'nalezeno', zdroj: 'pos_api', verze: 3, kdy: ted, kdo: null, detail: { pos_prodej_id: 'POS-1' } } })]
  const sNalezem = await vykreslit()
  ok('Ověření 22. 10.: autor bez práva na opravy, pokladna našla prodej → „Zrušit záznam“ ne, stránka řekne proč',
    sNalezem.length > 1000 && !tlacitka(sNalezem).includes('Zrušit záznam') && textHtml(sNalezem).includes('Zrušit ho smí jen člověk s právem na opravy'))
  tabulky.jine_platby = [radekZaznamu({ stav_skladu: 'bez_navrhu', vytvoril: 'U1', zruseni_duvod: null })]
  const bezNalezuStr = await vykreslit()
  ok('Ověření 22. 10. (protipříklad): bez nálezu má autor „Zrušit záznam“ a vysvětlení chybí',
    tlacitka(bezNalezuStr).includes('Zrušit záznam') && !textHtml(bezNalezuStr).includes('Zrušit ho smí jen člověk s právem na opravy'))
  tabulky.jine_platby = puvodniZaznamy
  globalThis.__jpStranka.prava = new Set(VSECHNA_PRAVA)

  // 25. 10.: stáří katalogu počítá stránka (katalogJeStary nad časem aktualizace) — starý editor nabídne obnovit, čerstvý ne.
  const puvodniKatalog = tabulky.pos_katalog
  tabulky.pos_katalog = puvodniKatalog.map((k) => ({ ...k, aktualizovano: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }))
  const sKatStarym = textHtml((await vykreslit()).replace(/<!-- -->/g, ''))
  tabulky.pos_katalog = puvodniKatalog
  const sKatCerstvym = textHtml((await vykreslit()).replace(/<!-- -->/g, ''))
  ok('25. 10.: stránka s katalogem načteným před 10 dny → editor řekne „obnovte ho“; s dnešním ne',
    sKatStarym.includes('Co v pokladně přibylo potom, v něm chybí — obnovte ho.') &&
      sKatCerstvym.includes('Katalog pokladny: 2 položky (produkty i suroviny), načteno') && !sKatCerstvym.includes('obnovte ho'))

  if (process.env.NAHLED) {
    const { writeFileSync } = await import('node:fs')
    const css = new URL('../app/globals.css', import.meta.url).href
    writeFileSync(process.env.NAHLED, `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"><style>.jp-original img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:var(--sunken);min-height:120px}</style></head><body style="background:var(--paper);color:var(--ink);margin:0"><main class="ft-main">${html}</main></body></html>`)
    console.log(`    náhled zapsán: ${process.env.NAHLED}`)
  }
}

/* =====================================================================
 * 12. KATALOG POKLADNY V EDITORU (25. 10. 2026)
 *
 * Majitel na záznamu bez načteného katalogu nenašel, jak položku
 * přiřadit: tlačítko „Načíst katalog z pokladny“ stálo až pod celým
 * editorem. Teď je načtení nahoře v editoru i u každé položky, prázdný
 * katalog se načte sám (nejvýš jednou za hodinu z prohlížeče), starý se
 * nabídne obnovit a text říká „produkty a suroviny z pokladny“.
 * ===================================================================== */

console.log('\n== 12. Katalog pokladny v editoru návrhu ==')
{
  const L = await import(`../${ZAZNAM}/logika.ts`)
  const DEN = 24 * 60 * 60 * 1000
  const ted = Date.parse('2026-10-25T12:00:00Z')

  // Stáří katalogu.
  ok('katalogJeStary: bez času aktualizace (nikdy nenačtený) → ne', L.katalogJeStary(null, ted) === false)
  ok('katalogJeStary: nečitelný čas → ne (nic se nedomýšlí)', L.katalogJeStary('včera', ted) === false)
  ok(`katalogJeStary: načtený před 6 dny → ne, před 8 dny → ano (hranice ${L.KATALOG_STARY_PO_DNECH} dní)`,
    L.KATALOG_STARY_PO_DNECH === 7 && L.katalogJeStary(new Date(ted - 6 * DEN).toISOString(), ted) === false && L.katalogJeStary(new Date(ted - 8 * DEN).toISOString(), ted) === true)

  // Samočinné načtení prázdného katalogu: jen když dává smysl a ne při každém zobrazení.
  const sam = (prepis = {}) => L.nacistKatalogSam({ umi: true, chybaCteni: false, pocet: 0, polozekProSklad: 1, posledniPokusMs: null, tedMs: ted, ...prepis })
  ok('nacistKatalogSam: prázdný katalog, pokladna ho umí, položka pro sklad, ještě nezkoušeno → ano', sam() === true)
  ok('nacistKatalogSam: katalog už něco má → ne (starý se jen nabídne)', sam({ pocet: 1 }) === false)
  ok('nacistKatalogSam: pokladna katalog neposílá → ne', sam({ umi: false }) === false)
  ok('nacistKatalogSam: katalog nejde přečíst z databáze → ne (načtení z pokladny by to nespravilo)', sam({ chybaCteni: true }) === false)
  ok('nacistKatalogSam: žádná položka se skladu netýká → ne (pokladna se zbytečně neptá)', sam({ polozekProSklad: 0 }) === false)
  ok('nacistKatalogSam: pokus si nejde zapamatovat (úložiště prohlížeče vypnuté) → ne', sam({ posledniPokusMs: 'nelze' }) === false)
  ok('nacistKatalogSam: zkoušeno před 10 min → ne; před 61 min → ano (odstup 1 h)',
    L.KATALOG_SAM_NEJDRIV_ZA_MS === 60 * 60 * 1000 && sam({ posledniPokusMs: ted - 10 * 60 * 1000 }) === false && sam({ posledniPokusMs: ted - 61 * 60 * 1000 }) === true)
  ok('nacistKatalogSam: nečitelný zapamatovaný čas → ano (přepíše se platným)', sam({ posledniPokusMs: Number('x') }) === true)

  // Suroviny: Dotykačka posílá prodávané produkty i suroviny v jednom /products — nic se cestou nevyřadí.
  const { naparsovatProdukty } = await import('../lib/pokladna-dotykacka-sklad.ts')
  const zDotykacky = naparsovatProdukty({
    data: [
      { id: '101', name: 'Pivo Bernard 0,5', unit: 'Piece', stockDeduct: true, deleted: false },
      { id: '202', name: 'Mouka hladká', unit: 'Kilogram', stockDeduct: true, deleted: false },
      { id: '303', name: 'Svíčková na smetaně', unit: 'Piece', stockDeduct: false, deleted: false },
    ],
  })
  ok('suroviny: stránka katalogu Dotykačky → produkty i surovina (Mouka hladká, stockDeduct) bez vyřazení',
    Array.isArray(zDotykacky.produkty) && zDotykacky.produkty.map((p) => p.externiId).join(',') === '101,202,303' && zDotykacky.bezId === 0)
  const katalog = (zDotykacky.produkty ?? []).map((p) => ({ externiId: p.externiId, nazev: p.nazev, jednotka: L.jednotkaCesky(p.jednotka) || null, mira: p.mira }))
  ok('hledání: „mouka“ najde surovinu', L.hledatVKatalogu(katalog, 'mouka').map((k) => k.externiId).join() === '202')
  ok('hledání: bez diakritiky a velkými („HLADKA“, „SVICKOVA“) najde „Mouka hladká“ i „Svíčková na smetaně“',
    L.hledatVKatalogu(katalog, '  HLADKA ').map((k) => k.externiId).join() === '202' && L.hledatVKatalogu(katalog, 'SVICKOVA').map((k) => k.externiId).join() === '303')
  ok('hledání: „svíčk“ najde prodávaný pokrm, „piv“ pivo; prázdné hledání = celý katalog (produkty i suroviny)',
    L.hledatVKatalogu(katalog, 'svíčk').map((k) => k.externiId).join() === '303' && L.hledatVKatalogu(katalog, 'piv').map((k) => k.externiId).join() === '101' && L.hledatVKatalogu(katalog, '').length === 3)

  // Vykreslení editoru.
  const Editor = await nactiKomponentu(`${ZAZNAM}/editor-navrhu.tsx`, KRESLENI)
  const pol = (prepis = {}) => ({
    id: 'PL1', nazevPuvodni: 'Pivo 0,5', nazev: 'Pivo 0,5', mnozstvi: '2', jednotka: 'ks', cenaJ: '45', cenaC: '90', dph: '21', druh: 'rozlevany_napoj',
    produkt: '', posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', zdroj: 'ai', jistota: 0.9, vyzadujeKontrolu: false, duvodKontroly: '', kandidati: [], ...prepis,
  })
  const hl = { datum: '2026-10-25', oznaceni: '', mena: 'CZK', castka: '90', castkaPuvod: 'doklad', typ: 'uzavreny_prodej', externi: '', kontaktId: '' }
  const nacist = async () => ({ stav: 'nic', text: '' })
  const kp = (prepis = {}) => ({ pripojeni: 'P1', umi: true, aktualizovano: null, stary: false, chyba: null, nacist, ...prepis })
  // Bez značek <!-- --> mezi sousedními texty JSX — věty se pak dají hledat celé.
  const bezZnacek = (h) => h.replace(/<!-- -->/g, '')
  const editor = (props) =>
    bezZnacek(renderToStaticMarkup(createElement(Editor, { akce: nacist, ...zakl, hlavicka: hl, polozky: [pol()], katalog: [], kontakty: null, mena: 'CZK', ...props })))
  const NACIST = 'Načíst produkty a suroviny z pokladny'
  const tlacitkoHtml = (html, text) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].filter((m) => textHtml(m[1]).trim() === text).map((m) => m[0])

  const prazdny = editor({ polozky: [pol(), pol({ id: 'PL2', nazev: 'Obsluha', druh: 'sluzba' }), pol({ id: 'PL3', nazev: 'Rum', produkt: 'X9' })], katalogPokladny: kp() })
  const tp = textHtml(prazdny)
  ok('bez katalogu: nahoře v editoru věta „Produkty a suroviny z pokladny ještě nejsou načtené“ a tlačítko — PŘED údaji dokladu',
    tp.includes('Produkty a suroviny z pokladny ještě nejsou načtené') && tp.indexOf(NACIST) > -1 && tp.indexOf(NACIST) < tp.indexOf('Údaje dokladu'))
  ok('bez katalogu: tlačítko je nahoře + u každé položky pro sklad (2), u služby ne → 3', tlacitkoHtml(prazdny, NACIST).length === 3)
  ok('bez katalogu: všechna tlačítka načtení jsou type="button" — nikdy neodešlou formulář návrhu (rozepsané položky zůstanou)',
    tlacitkoHtml(prazdny, NACIST).every((b) => /\btype="button"/.test(b) && !/type="submit"/.test(b)))
  ok('bez katalogu: u položky věta „přiřazení zatím nejde“ s tlačítkem, stará věta „Katalog pokladny není načtený“ zmizela',
    tp.includes('Produkty a suroviny z pokladny ještě nejsou načtené — přiřazení zatím nejde, a proto ani skladový výdej.') && !tp.includes('Katalog pokladny není načtený'))
  ok('bez katalogu: už přiřazený produkt položky se při uložení neztratí (skryté pole)', /<input type="hidden" name="p_r2_produkt" value="X9"\/>/.test(prazdny))

  const sKatalogem = editor({ katalog, katalogPokladny: kp({ aktualizovano: { iso: '2026-10-25T10:00:00Z', text: '25. 10. 2026 12:00' } }) })
  const tk = textHtml(sKatalogem)
  ok('s katalogem: popisky „Hledat v produktech a surovinách pokladny“ a „Produkt nebo surovina v pokladně“',
    tk.includes('Hledat v produktech a surovinách pokladny') && tk.includes('Produkt nebo surovina v pokladně'))
  ok('s katalogem: v nabídce je i surovina (Mouka hladká) vedle produktů', /<option value="202">Mouka hladká \(kg\)<\/option>/.test(sKatalogem) && /<option value="101">/.test(sKatalogem))
  ok('s katalogem: nahoře „Katalog pokladny: 3 položky (produkty i suroviny), načteno …“ a „Obnovit katalog z pokladny“, žádné „Načíst“',
    tk.includes('Katalog pokladny: 3 položky (produkty i suroviny), načteno 25. 10. 2026 12:00.') && tlacitkoHtml(sKatalogem, 'Obnovit katalog z pokladny').length === 1 && !tk.includes(NACIST))
  ok('s katalogem (čerstvým): bez výzvy k obnovení', !tk.includes('obnovte ho'))
  ok('s katalogem: hledání má id pro fokus po načtení u položky', new RegExp(`id="${ZAZNAM_ID}-r0-hledat"`).test(sKatalogem))

  const stary = textHtml(editor({ katalog, katalogPokladny: kp({ stary: true, aktualizovano: { iso: '2026-10-01T10:00:00Z', text: '1. 10. 2026 12:00' } }) }))
  ok('starý katalog: výzva „Co v pokladně přibylo potom, v něm chybí — obnovte ho.“ s tlačítkem obnovení',
    stary.includes('načteno 1. 10. 2026 12:00. Co v pokladně přibylo potom, v něm chybí — obnovte ho.') && stary.includes('Obnovit katalog z pokladny'))

  const chybaCteni = editor({ katalogPokladny: kp({ chyba: 'Katalog pokladny má víc než 20 stránek.' }) })
  ok('katalog nejde přečíst: hláška role=alert nahoře v editoru, žádné tlačítko načtení (nespravilo by to)',
    /role="alert"[^>]*>Katalog pokladny má víc než 20 stránek\. Přiřazení k produktům a surovinám pokladny teď nejde/.test(chybaCteni) &&
      tlacitkoHtml(chybaCteni, NACIST).length === 0 && textHtml(chybaCteni).includes('Katalog pokladny se teď nepodařilo přečíst (viz nahoře)'))

  const neumi = textHtml(editor({ katalogPokladny: kp({ umi: false }) }))
  ok('pokladna katalog neposílá: vysvětlení nahoře i u položky, žádné tlačítko',
    neumi.includes('Tahle pokladna katalog neposílá — položky přiřazujte') && neumi.includes('Tahle pokladna katalog neposílá — k produktu ani surovině') && !neumi.includes(NACIST) && !neumi.includes('Obnovit katalog'))

  const bezPokladny = textHtml(editor({ katalogPokladny: null }))
  ok('záznam bez pokladny: u položky „Záznam nemá pokladnu“, žádný blok katalogu ani tlačítko',
    bezPokladny.includes('Záznam nemá pokladnu — k produktu ani surovině pokladny se položka nepřiřazuje.') && !bezPokladny.includes(NACIST) && !bezPokladny.includes('Katalog pokladny:'))

  // Stav editoru při načtení katalogu: verze záznamu se nemění, z nové stránky se převezmou jen kandidáti.
  const se = zdroj(`${ZAZNAM}/editor-navrhu.tsx`)
  ok('editor: nový katalog při stejné verzi převezme u uložených položek JEN kandidáty (rozepsané hodnoty zůstanou)',
    /\} else if \(katalogKlic !== katalogDat\) \{\n\s*setKatalogDat\(katalogKlic\)\n\s*setRadky\(\(rs\) =>\n\s*rs\.map\(\(r\) => \{\n\s*const p = r\.id \? polozky\.find\(\(x\) => x\.id === r\.id\) : undefined\n\s*return p \? \{ \.\.\.r, kandidati: p\.kandidati \} : r\n/.test(se))
  ok('editor: celé položky se ze stránky načtou znovu jen při nové verzi záznamu', (se.match(/setRadky\(polozky\.map\(doRadku\)\)/g) ?? []).length === 1 && /if \(verze !== verzeDat\) \{[^}]*setRadky\(polozky\.map\(doRadku\)\)/.test(se))
  ok('editor: samočinné načtení si pokus zapíše DŘÍV, než se do pokladny zeptá, a bez zápisu nenačítá',
    /window\.localStorage\.setItem\(klic, String\(tedMs\)\)\n\s*\} catch \{\n\s*return\n\s*\}\n\s*autoKatalog\.current = true\n\s*startTransition\(\(\) => nacistKatalogAkce\(dataKatalogu\(zaznam, verze, rozsah, 'sam'\)\)\)/.test(se))
  const pos = funkce(zdroj(`${KOREN}/akce-pos.ts`)).find((f) => f.jmeno === 'nacistKatalog')
  const mig = readFileSync('supabase/migrations/20261016100000_jine_platby.sql', 'utf8')
  const nahradit = mig.slice(mig.indexOf('create function public.pos_katalog_nahradit'), mig.indexOf('end $$;', mig.indexOf('create function public.pos_katalog_nahradit')))
  ok('načtení katalogu verzi záznamu nemění: akce volá jen pos_katalog_nahradit a ta na jine_platby nesahá (editor se proto nevyresetuje)',
    pos !== undefined && rpcV(pos.telo).join() === 'pos_katalog_nahradit' && nahradit.length > 500 && !/jine_platby/.test(nahradit))

  // Sekce Kontrola: s editorem je katalog jen nahoře v editoru (žádné druhé tlačítko pod ním).
  const STUB_AKCE_AI = js("export async function rozpoznat() { return { stav: 'nic', text: '' } }")
  const SekceKontrola12 = await nactiKomponentu(`${ZAZNAM}/sekce-kontrola.tsx`, [...KRESLENI, ['../akce-ai', STUB_AKCE_AI]])
  const sekce = (akce, katalogSekce) =>
    bezZnacek(renderToStaticMarkup(createElement(SekceKontrola12, {
      zakl, z: zaznam({ stavKontroly: 'ke_kontrole' }), akce: new Set(akce), smiUpravit: true, editor: { hlavicka: hl, polozky: [pol()], katalog: [], kontakty: null },
      polozky: [], rozpoznani: null, kontrolaRozpoznani: null, coZkontrolovat: [], nesoulad: null, ai: { zapnuto: false, pocetSouboru: 0 }, katalog: katalogSekce, zona: 'Europe/Prague',
    })))
  const sEd = sekce(['upravit'], { umi: true, pocet: 0, aktualizovano: null, stary: false, chyba: null })
  ok('Kontrola s editorem: načtení katalogu nahoře + u položky (2×), staré „Načíst katalog z pokladny“ pod editorem není',
    tlacitkoHtml(sEd, NACIST).length === 2 && !tlacitka(sEd).includes('Načíst katalog z pokladny') && !textHtml(sEd).includes('zatím nenačtený'))
  const bezEd = textHtml(sekce([], { umi: true, pocet: 1234, aktualizovano: '2026-10-25T10:00:00Z', stary: false, chyba: null }))
  ok('Kontrola bez editoru: jen přehled „Katalog pokladny (produkty a suroviny): 1234 položek“, bez tlačítka',
    bezEd.includes('Katalog pokladny (produkty a suroviny): 1234 položek, aktualizováno') && !bezEd.includes(NACIST))
}

console.log(chyb ? `\n${chyb} z ${kontrol} kontrol SELHALO` : `\nVšech ${kontrol} kontrol prošlo`)
process.exit(chyb ? 1 : 0)
