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
 * Statické kontroly čtou zdroj BEZ komentářů a míří na konkrétní tvar
 * (regex), ne na volné „obsahuje“. Každá byla schválně rozbitá a spadla
 * (počty a co přesně spadlo: závěrečná zpráva implementace, 16. 10. 2026).
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
const AKCE_SOUBORY = ['akce.ts', 'akce-pos.ts', 'akce-ai.ts'].map((f) => `${KOREN}/${f}`)
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
  jine_platby_faktura: ['jine_platby.faktura'],
  jine_platby_evidovat_uhradu: ['jine_platby.faktura'],
  jine_platby_opravit_trzbu: ['jine_platby.oprava'],
  jine_platby_korekce_vydeje: ['jine_platby.oprava'],
  jine_platby_zrusit: ['jine_platby.oprava'],
  jine_platby_ulozit_mapovani: ['jine_platby.upravit'],
  jine_platby_zahajit_rozpoznani: ['jine_platby.upravit'],
  jine_platby_dokoncit_rozpoznani: ['jine_platby.upravit'],
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
    const m = f.telo.match(/^export async function \w+\(_predchozi: StavAkce, formData: FormData\): Promise<StavAkce> \{\n\s*const p = await pripravit\(formData, ('jine_platby\.[a-z_]+'|\[[^\]]+\])(?:, \{ neboAutor: 'jine_platby\.[a-z_]+' \})?\)\n\s*if \(!p\.ok\) return p\.stav\n/)
    const prava = m ? [...m[1].matchAll(/'(jine_platby\.[a-z_]+)'/g)].map((x) => x[1]) : []
    exportovane[f.jmeno] = { soubor: kratce, prava }
    ok(`${kratce} › ${f.jmeno}: začíná pripravit(formData, ${m ? m[1] : '?'}) a vrací se při odmítnutí`, Boolean(m) && prava.length > 0)
    ok(`${kratce} › ${f.jmeno}: právo je přesně ${(OCEKAVANA_PRAVA[f.jmeno] ?? ['?']).join(' + ')}`, JSON.stringify(prava) === JSON.stringify(OCEKAVANA_PRAVA[f.jmeno] ?? null))
    const iPrip = f.telo.indexOf('await pripravit(')
    const poradi = ['.rpc(', 'klientUlohy(', 'otevritRelaciPokladny(', 'rozpoznatDoklad(', '.download(']
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
  ok(`akcí se našlo dost (${Object.keys(exportovane).length})`, Object.keys(exportovane).length >= 22)
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
  ok('posProOperaci zápis jen předá (odeslat: …), nevolá ho', /odeslat: typeof zapis === 'function' \? \(op\) => zapis\.call\(relace, op\) : undefined/.test(pos) && !/await zapis/.test(pos))
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
  ['ulozitNavrh', 'oznacitZkontrolovano', 'prohlasitTrzbu', 'prohlasitSklad', 'potvrditTrzbu', 'opravitTrzbu', 'odeslatSklad', 'propojitVydej', 'rucneDolozit', 'korekceVydeje', 'faktura', 'evidovatUhradu', 'ulozitMapovani', 'zrusit']
    .map((n) => `export async function ${n}() { return { stav: 'nic', text: '' } }`)
    .join('\n'),
)
const STUB_AKCE_POS = js(
  ['zkontrolovatTrzbu', 'zkontrolovatSklad', 'rozhodnoutVydej', 'provestVydej', 'vydejZnovu', 'obnovitVydej', 'nacistKatalog']
    .map((n) => `export async function ${n}() { return { stav: 'nic', text: '' } }`)
    .join('\n'),
)
const KRESLENI = [
  ['next/link', STUB_LINK],
  ['../akce', STUB_AKCE],
  ['../akce-pos', STUB_AKCE_POS],
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
          return s.soubory[cesta] ? { data: new Blob([s.soubory[cesta]]), error: null } : { data: null, error: { message: 'nenalezeno' } }
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
        ucty: async () => ({ stav: 'ok', ucty: [], uplne: true }),
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
  rucneDolozit: [akce, { doklad: 'V-12', duvod: 'Výdejka v pokladně' }],
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

const vsechnyAkce = [...Object.entries(akce), ...Object.entries(akcePos), ...Object.entries(akceAi)].filter(([, f]) => typeof f === 'function')
ok(`každá exportovaná akce má případ k vyzkoušení (${vsechnyAkce.length} akcí)`, vsechnyAkce.length >= 22 && vsechnyAkce.every(([n]) => PRIPADY[n]))

for (const [jmeno, [modul, pole]] of Object.entries(PRIPADY)) {
  const prava = OCEKAVANA_PRAVA[jmeno] ?? []
  const zavolat = async () => spustit(modul[jmeno], KLID, formular(pole))
  const vedlejsi = (s) => s.log.filter((x) => ['rpc', 'klientUlohy', 'relace', 'ai', 'download'].includes(x[0]))

  // a) s VŠEMI právy kromě toho, které akce chce → nic se nezavolá.
  for (const chybi of prava) {
    const s = svet({ prava: new Set(VSECHNA_PRAVA.filter((p) => p !== chybi)), operace: { stav: STAV_OPERACE[jmeno] ?? 'pripraveno' } })
    const v = await zavolat(s)
    ok(`${jmeno}: bez ${chybi} (ostatní práva má) nezavolá RPC, službu, pokladnu ani AI a vrátí chybu`, vedlejsi(s).length === 0 && v.stav === 'chyba')
  }

  // b) s právem → právo na pobočce záznamu ověřené PŘED prvním RPC / službou / pokladnou.
  const s = svet({ operace: { stav: STAV_OPERACE[jmeno] ?? 'pripraveno' } })
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
  const s = svet({ ai: { zapnuto: false, vyhodit: false, vysledek: null } })
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
  const ok2 = svet({ ai: { zapnuto: true, vyhodit: false, vysledek: { stav: 'ok', doklad, model: 'claude-opus-5-5', verze: 'jine-platby-v1' } } })
  const v2 = await spustit(akceAi.rozpoznat, KLID, formular({}))
  const rpc = zaznamy(ok2, 'rpc')
  const iZah = rpc.findIndex((x) => x[2] === 'jine_platby_zahajit_rozpoznani')
  const iDok = rpc.findIndex((x) => x[2] === 'jine_platby_dokoncit_rozpoznani')
  const iUloz = rpc.findIndex((x) => x[2] === 'jine_platby_ulozit_navrh')
  ok('zahájení (strop) → AI → dokončení → uložení návrhu, v tomhle pořadí', iZah >= 0 && iDok > iZah && iUloz > iDok && v2.stav === 'ok')
  ok('zahájení a dokončení přes službu (service_role), uložení návrhu přes UŽIVATELSKÝ klient', rpc[iZah]?.[1] === 'sluzba' && rpc[iDok]?.[1] === 'sluzba' && rpc[iUloz]?.[1] === 'uzivatel')
  ok('AI dostala jen soubory dokladu a časový limit 100 s', zaznamy(ok2, 'ai')[0]?.[1] === 1 && zaznamy(ok2, 'ai')[0]?.[2]?.casovyLimitMs === 100_000)
  ok('uložený návrh: položka z dokladu, částka z dokladu (doklad), CZK, kontrola verze 3',
    rpc[iUloz]?.[3]?.p_verze === 3 && rpc[iUloz][3].p_polozky.length === 1 && rpc[iUloz][3].p_hlavicka.castka_haleru === 9000 && rpc[iUloz][3].p_hlavicka.castka_puvod === 'doklad' && rpc[iUloz][3].p_hlavicka.mena === 'CZK')
  ok('dokončení nese stav ok, model a výsledek AI (původ zůstane)', rpc[iDok]?.[3]?.p_stav === 'ok' && rpc[iDok][3].p_model === 'claude-opus-5-5' && rpc[iDok][3].p_vysledek === doklad)

  const pad = svet({ ai: { zapnuto: true, vyhodit: true, vysledek: null } })
  const puvodni = console.error
  console.error = () => {}
  await spustit(akceAi.rozpoznat, KLID, formular({}))
  console.error = puvodni
  const rp = zaznamy(pad, 'rpc')
  ok('když AI spadne: dokončení se zapíše se stavem chyba a návrh se neuloží', rp.some((x) => x[2] === 'jine_platby_dokoncit_rozpoznani' && x[3].p_stav === 'chyba') && !rp.some((x) => x[2] === 'jine_platby_ulozit_navrh'))

  const klic = svet({ ai: { zapnuto: true, vyhodit: false, vysledek: { stav: 'bez_klice' } } })
  const v4 = await spustit(akceAi.rozpoznat, KLID, formular({}))
  ok('model hlásí bez_klice: zapíše se bez_klice a člověk dostane srozumitelnou chybu, nic se neuloží',
    v4.text === L.HLASKA_BEZ_AI && zaznamy(klic, 'rpc').some((x) => x[2] === 'jine_platby_dokoncit_rozpoznani' && x[3].p_stav === 'bez_klice') && !zaznamy(klic, 'rpc').some((x) => x[2] === 'jine_platby_ulozit_navrh'))

  const pdf = svet()
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

  const api = svet()
  api.relace.schopnosti.skladovyVydej = 'api'
  api.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: ucet({ externiId: 'POS-77', externiKlic: klic, odpis: true }) })
  // Před zabráním čerstvá kontrola: pokladna podle klíče zatím nic nemá (první dotaz), po odeslání ano.
  let poOdeslani = false
  api.relace.relace.skladovyVydej = async () => {
    api.log.push(['ZAPIS_DO_POKLADNY'])
    poOdeslani = true
    return { stav: 'odeslano' }
  }
  api.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: poOdeslani ? ucet({ externiId: 'POS-77', externiKlic: klic, odpis: true }) : null })
  api.tabulky.pos_operace = (filtry) => (filtry.some(([, k]) => k === 'druh') ? [radekOperace()] : [])
  await spustit(akcePos.provestVydej, KLID, formular({}))
  const r2 = zaznamy(api, 'rpc')
  const iKontrola = r2.findIndex((x) => x[2] === 'jine_platby_zapsat_kontrolu')
  const iZah = r2.findIndex((x) => x[2] === 'pos_operace_zahajit')
  const iDok = r2.findIndex((x) => x[2] === 'pos_operace_dokoncit')
  ok("pokladna 'api': těsně před výdejem kontrola (neodečteno) → zabrání → JEDEN zápis → ověřený úspěch",
    iKontrola >= 0 && r2[iKontrola][3].p_vysledek === 'neodecteno' && iZah > iKontrola && iDok > iZah && zaznamy(api, 'ZAPIS_DO_POKLADNY').length === 1 && r2[iDok][3].p_stav === 'uspech' && r2[iDok][3].p_externi_id === 'POS-77')

  const obn = svet({ operace: { stav: 'nejasny_vysledek', platnost_do: '2026-10-16T10:05:00Z' } })
  obn.relace.schopnosti.skladovyVydej = 'api'
  obn.relace.relace.ucetPodleKlice = async (klic) => ({ stav: 'ok', ucet: ucet({ externiId: 'POS-88', externiKlic: klic }) })
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

  const verze = svet()
  const v6 = await spustit(akcePos.zkontrolovatTrzbu, KLID, formular({ verze: '2' }))
  ok('kontrola nad starou verzí formuláře se nespustí (HLASKA_VERZE)', v6.text === L.HLASKA_VERZE && zaznamy(verze, 'relace').length === 0)
}

/* =====================================================================
 * 8. LOGIKA (spouští se)
 * ===================================================================== */

console.log('\n== 8. Logika: vyhodnocení kontroly v pokladně ==')
{
  const z = { externiUcet: '1234', castkaHaleru: 45000, mena: 'CZK' }
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

  const s = (ucty, odpisy = [], uplne = true) => L.vyhodnotitKontroluSkladu(z, d(ucty, uplne), odpisy, okno)
  ok('sklad: výdej s klíčem naší operace v pokladně → jiz_odecteno', s([], [{ klic: 'K1', odpoved: { stav: 'ok', ucet: ucet({ externiId: 'POS-1' }) } }]).vysledek === 'jiz_odecteno')
  ok('sklad: zrušený výdej s klíčem není odečtení', s([], [{ klic: 'K1', odpoved: { stav: 'ok', ucet: ucet({ stav: 'zruseny' }) } }]).vysledek === 'neodecteno')
  ok('sklad: prodej z dokladu uzavřený v pokladně → jiz_odecteno', s([ucet()]).vysledek === 'jiz_odecteno')
  ok('sklad: účet otevřený → nelze_zjistit', s([ucet({ stav: 'otevreny' })]).vysledek === 'nelze_zjistit')
  ok('sklad: jen stejná částka → nelze_zjistit (žádné „pravděpodobně“ u skladu)', s([ucet({ cisloDokladu: '9', externiId: 'U-9' })]).vysledek === 'nelze_zjistit')
  ok('sklad: dohledání klíče selhalo → nelze_zjistit', s([], [{ klic: 'K1', odpoved: { stav: 'chyba', duvod: 'x' } }]).vysledek === 'nelze_zjistit')
  ok('sklad: nic a úplný seznam → neodecteno', s([]).vysledek === 'neodecteno')
  ok('sklad: nic a NEúplný seznam → nelze_zjistit', s([], [], false).vysledek === 'nelze_zjistit')

  ok('dohledání: nalezený účet → nalezeno s externím id', L.dohledaniZUctu({ stav: 'ok', ucet: ucet({ externiId: 'Q' }) }).stav === 'nalezeno')
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
    ['@/lib/authz', js(`export const TENANT_SCOPE_SEGMENT = 'firma'\nexport async function hasAccess(t, p, b) { return ${DATA}.prava.has(p) }\nexport async function getUser() { return { id: 'U1' } }`)],
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
    jine_platby: [radekZaznamu({ stav_skladu: 'ceka_na_schvaleni', vytvoril: 'U1', kontrola_trzby: { vysledek: 'pravdepodobne', zdroj: 'pos_api', verze: 3, kdy: ted, kdo: 'U1', detail: { popis: 'V pokladně je uzavřený účet se stejnou částkou 450,00 Kč.' } }, kontrola_skladu: { vysledek: 'neodecteno', zdroj: 'rucni_prohlaseni', verze: 3, kdy: ted, kdo: 'U1', detail: { duvod: 'Ověřeno v pokladně, výdej tam není' } }, zruseni_duvod: null })],
    jine_platby_soubory: [
      { id: 'S1', poradi: 1, mime: 'image/jpeg', velikost: 812345, otisk: 'a'.repeat(64) },
      { id: 'S2', poradi: 2, mime: 'application/pdf', velikost: 45000, otisk: 'b'.repeat(64) },
    ],
    jine_platby_polozky: [
      polozka(1, { nazev_puvodni: 'PIVO 0,5', nazev: 'Pivo 0,5 l', mnozstvi: 2, cena_jednotkova_haleru: 4500, cena_celkem_haleru: 9000, druh: 'rozlevany_napoj', pos_produkt_id: 'X1', pos_produkt_nazev: 'Pivo 0,5', pos_mnozstvi: 2, mapovani: 'overeno' }),
      polozka(2, { nazev_puvodni: 'SVICKOVA S KNEDLIKEM A BRUSINKAMI VELKA PORCE', nazev: 'Svíčková na smetaně s knedlíkem a brusinkami, velká porce', mnozstvi: 2, cena_jednotkova_haleru: 18000, cena_celkem_haleru: 36000, druh: 'pokrm', jistota: 0.55, vyzaduje_kontrolu: true, duvod_kontroly: 'Řádek přečtený nejistě (jistota 55 %); Druh položky není určený' }),
      polozka(3, { nazev: 'Spropitné', mnozstvi: null, jednotka: null, cena_celkem_haleru: 5000, druh: 'spropitne', mapovani: 'neskladova', sazba_dph: null }),
    ],
    jine_platby_rozpoznani: [{ id: 'R1', stav: 'ok', vysledek: doklad, duvod: null, vytvoreno: ted }],
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
    const q = {
      select: () => q, eq: () => q, neq: () => q, is: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: Array.isArray(tabulky[tabulka]) ? (tabulky[tabulka][0] ?? null) : (tabulky[tabulka] ?? null), error: null }),
      then: (a, b) => Promise.resolve({ data: Array.isArray(tabulky[tabulka]) ? tabulky[tabulka] : [], error: null }).then(a, b),
    }
    return q
  }
  globalThis.__jpStranka = {
    prava: new Set(VSECHNA_PRAVA),
    pristup: { stav: 'ok', ctx: { branches: [{ id: 'B1', name: 'Bernard Bar', slug: 'bernard-bar' }], tenant: { timezone: 'Europe/Prague' } }, scope: { level: 'branch', branchId: 'B1', branchSlug: 'bernard-bar' } },
    pokladna: { nazev: 'Dotykačka Bernard', nazevPoskytovatele: 'Dotykačka', odpojena: false, katalog: true, dohledaniUctu: true, skladovyVydej: 'rucne', provozovny: [{ id: 'PROV1', nazev: 'Bernard Bar — výčep', branchId: 'B1' }] },
    klient: {
      from: dotaz,
      rpc: async (nazev) =>
        nazev === 'jine_platby_sestavit_vydej'
          ? { data: { obsah: { polozky: [{ poradi: 1, pos_produkt_id: 'X1', nazev: 'Pivo 0,5', mnozstvi: 2 }] }, otisk: 'c'.repeat(64), polozek: 1, blokace: [{ poradi: 2, nazev: 'Svíčková', duvod: 'Položka čeká na kontrolu.' }] }, error: null }
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
  if (process.env.NAHLED) {
    const { writeFileSync } = await import('node:fs')
    const css = new URL('../app/globals.css', import.meta.url).href
    writeFileSync(process.env.NAHLED, `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"><style>.jp-original img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:var(--sunken);min-height:120px}</style></head><body style="background:var(--paper);color:var(--ink);margin:0"><main class="ft-main">${html}</main></body></html>`)
    console.log(`    náhled zapsán: ${process.env.NAHLED}`)
  }
}

console.log(chyb ? `\n${chyb} z ${kontrol} kontrol SELHALO` : `\nVšech ${kontrol} kontrol prošlo`)
process.exit(chyb ? 1 : 0)
