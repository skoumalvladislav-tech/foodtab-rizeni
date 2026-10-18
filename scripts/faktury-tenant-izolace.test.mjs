#!/usr/bin/env node
/**
 * Izolace firem u Faktur — od sloučení do hlavní databáze (18. 10. 2026).
 *
 * Dřív (do 18. 10.) žily faktury v samostatné databázi bez `tenant_id`
 * a izolace stála na jediné bráně podle FAKTURY_DB_TENANT_ID. Teď jsou
 * `public.faktury` v hlavní databázi (RLS za celou firmu, spoušť podle
 * stavu převodu) a tenhle test hlídá APLIKAČNÍ stranu:
 *
 *   1. ke STARÉ databázi Faktur (FAKTURY_SUPABASE_*) se připojuje jen
 *      lib/supabase/faktury.ts a ten smí použít JEN úloha převodu
 *      (lib/faktury-prevod-sync.ts) — druhé spojení je pro appku vypnuté,
 *   2. na `invoices` / `rejection_examples` nesahá nikdo jiný než převod,
 *   3. každé čtení `public.faktury` jde přes fakturyFirmy() (filtr firmy;
 *      kdo je ve dvou firmách, viděl by bez něj faktury obou), každý
 *      zápis nese tenant_id,
 *   4. brána: Faktury otevřené jen ve stavu převodu „dokonceno"; vlastník
 *      staré databáze jen podle FAKTURY_DB_TENANT_ID, nikdy podle IČO,
 *   5. „ke kontrole" počítá oba příznaky (česká jména sloupců).
 *
 * Pusť:
 *   node scripts/faktury-tenant-izolace.test.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { jeVlastnikFakturyDb } from '../lib/faktury-vlastnik.ts'
import { FILTR_KE_KONTROLE, potrebujeKontrolu } from '../lib/faktury-types.ts'
import { hlaskaBrany, rozhodnoutBranu } from '../lib/faktury-brana.ts'

const KOREN = fileURLToPath(new URL('..', import.meta.url))

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function zdrojoveSoubory(adresar) {
  const vysledek = []
  for (const jmeno of readdirSync(adresar)) {
    const cesta = join(adresar, jmeno)
    if (statSync(cesta).isDirectory()) {
      if (jmeno === 'node_modules' || jmeno.startsWith('.')) continue
      vysledek.push(...zdrojoveSoubory(cesta))
    } else if (/\.(ts|tsx)$/.test(jmeno)) {
      vysledek.push(cesta)
    }
  }
  return vysledek
}

const soubory = [...zdrojoveSoubory(join(KOREN, 'app')), ...zdrojoveSoubory(join(KOREN, 'lib'))]
  .map((cesta) => ({ cesta: relative(KOREN, cesta).split(sep).join('/'), zdroj: readFileSync(cesta, 'utf8') }))
const bezKomentaru = (z) => z.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const STARA = 'lib/supabase/faktury.ts'
const PREVOD = 'lib/faktury-prevod-sync.ts'
const BRANA = 'lib/faktury-pristup.ts'

console.log('\n1. Stará databáze Faktur: připojení jen v ' + STARA + ', použití jen v ' + PREVOD)
{
  const mimo = soubory.filter((s) => s.cesta !== STARA && /process\.env\.FAKTURY_SUPABASE_(URL|ANON_KEY)|process\.env\[['"]FAKTURY_SUPABASE_/.test(s.zdroj))
  ok(`nikdo jiný nečte FAKTURY_SUPABASE_* (${mimo.map((s) => s.cesta).join(', ') || 'nikdo'})`, mimo.length === 0)
  const importuji = soubory.filter((s) => /from\s+['"](@\/lib\/supabase\/faktury|\.\/supabase\/faktury(\.ts)?|\.\.\/supabase\/faktury)['"]/.test(s.zdroj))
  ok(`starou databázi importuje jen převod (${importuji.map((s) => s.cesta).join(', ') || 'nikdo'})`,
    importuji.length === 1 && importuji[0].cesta === PREVOD)
  const stara = soubory.find((s) => s.cesta === STARA)?.zdroj ?? ''
  ok('vytvoritKlienta() není exportovaná', /\nfunction vytvoritKlienta\(/.test(stara) && !/export\s+function\s+vytvoritKlienta/.test(stara))
  ok('stará brána se ptá na vlastníka přes jeVlastnikFakturyDb', /jeVlastnikFakturyDb\(/.test(stara))
}

console.log('\n2. Na invoices / rejection_examples sahá jen převod')
{
  const stare = soubory.filter((s) => /\.from\(\s*['"](invoices|rejection_examples)['"]\s*\)/.test(bezKomentaru(s.zdroj)))
  ok(`jen ${PREVOD} (${stare.map((s) => s.cesta).join(', ') || 'nikdo'})`, stare.length === 1 && stare[0].cesta === PREVOD)
}

console.log('\n3. public.faktury: čtení přes fakturyFirmy(), zápis s tenant_id')
{
  const naFaktury = soubory.filter((s) => s.cesta !== BRANA && /\.from\(\s*['"]faktury['"]\s*\)/.test(bezKomentaru(s.zdroj)))
  const cteni = soubory.filter((s) => /fakturyFirmy\(/.test(s.zdroj))
  ok(`fakturyFirmy() používá aspoň 12 souborů (našel jsem ${cteni.length})`, cteni.length >= 12)
  for (const s of naFaktury) {
    const z = bezKomentaru(s.zdroj)
    // Každý přímý .from('faktury') nese firmu: insert tenant_id v řádku
    // (nebo naRadekFaktur), jinak filtr .eq/.neq('tenant_id', …) v řetězu.
    // V app/ jde čtení jen přes fakturyFirmy() — přímý .select tam nesmí být.
    const vyskyty = [...z.matchAll(/\.from\(\s*['"]faktury['"]\s*\)/g)].map((m) => z.slice(m.index, m.index + 500))
    const spatne = vyskyty.filter((v) => {
      const operace = /^\.from\(\s*['"]faktury['"]\s*\)\s*\.(\w+)/.exec(v)?.[1]
      if (operace === 'select' && s.cesta.startsWith('app/')) return true
      if (operace === 'insert') return !/tenant_id|naRadekFaktur\(/.test(v)
      return !/\.(eq|neq)\(\s*['"]tenant_id['"]/.test(v)
    })
    ok(`${s.cesta}: ${vyskyty.length}× přímo na faktury, vždy s firmou${s.cesta.startsWith('app/') ? ' (čtení jen přes fakturyFirmy)' : ''}`, spatne.length === 0)
  }
  const brana = soubory.find((s) => s.cesta === BRANA)?.zdroj ?? ''
  ok('fakturyFirmy() filtruje tenant_id firmy z brány', /\.from\('faktury'\)\.select\(sloupce, moznosti\)\.eq\('tenant_id', p\.tenantId\)/.test(brana))
}

console.log('\n4. Brána: otevřeno jen po dokončení převodu')
{
  const t = '11111111-1111-1111-1111-111111111111'
  const jina = '22222222-2222-2222-2222-222222222222'
  const r = (data, error = null, vlastnik = t, tenant = t) => rozhodnoutBranu({ data, error }, tenant, vlastnik)
  ok('dokonceno → ok', r({ stav: 'dokonceno' }).stav === 'ok')
  ok('probiha → zavřeno (stěhují se)', r({ stav: 'probiha' }).stav === 'zavreno' && r({ stav: 'probiha' }).duvod === 'probiha')
  ok('vraceno → zavřeno', r({ stav: 'vraceno' }).duvod === 'vraceno')
  ok('bez řádku, vlastník staré databáze → čeká na převod', r(null).duvod === 'ceka_na_prevod')
  ok('bez řádku, jiná firma → nezapnuto (ne prázdné Faktury)', r(null, null, t, jina).duvod === 'nezapnuto')
  ok('bez řádku a bez nastavení vlastníka → nezapnuto, ne ok', r(null, null, undefined).stav === 'zavreno')
  ok('tabulka chybí (kód je venku dřív než db push) → připravuje se', r(null, { code: 'PGRST205' }).stav === 'nepripraveno' && r(null, { code: '42P01' }).stav === 'nepripraveno')
  ok('jiná chyba → zavřeno (při nejistotě se odmítá)', r(null, { code: '57014' }).stav === 'chyba')
  ok('neznámý stav → zavřeno', r({ stav: 'ceka' }).stav === 'chyba')
  ok('každé zavření má větu pro člověka', ['nepripraveno', 'chyba'].every((s) => hlaskaBrany({ stav: s }).nadpis.length > 0)
    && ['ceka_na_prevod', 'nezapnuto', 'probiha', 'vraceno'].every((d) => hlaskaBrany({ stav: 'zavreno', duvod: d }).text.length > 20))

  ok('vlastník: firma z nastavení', jeVlastnikFakturyDb(t, t))
  ok('vlastník: jiná firma ne', !jeVlastnikFakturyDb(jina, t))
  ok('vlastník: bez nastavení nikdo', !jeVlastnikFakturyDb(t, undefined) && !jeVlastnikFakturyDb(t, '  '))
  const rozhodnuti = ['lib/faktury-vlastnik.ts', 'lib/faktury-brana.ts', BRANA]
    .map((c) => bezKomentaru(soubory.find((s) => s.cesta === c)?.zdroj ?? ''))
    .join('\n')
  ok('o přístupu se nerozhoduje podle IČO ani tabulky tenants', !/\bico\b/i.test(rozhodnuti) && !/from\(\s*['"]tenants['"]\s*\)/.test(rozhodnuti))

  // Každá stránka a adresa, která čte faktury, se ptá brány (layout
  // stránku nechrání — memory „Layout nezastaví stránku").
  const ctou = soubory.filter((s) => s.cesta.startsWith('app/') && /fakturyFirmy\(/.test(s.zdroj))
  for (const s of ctou) ok(`${s.cesta} se ptá brány`, /pristupKFakturam\(/.test(s.zdroj))
}

console.log('\n5. Co potřebuje ruční kontrolu')
{
  ok('stav „Nutná ruční kontrola (…)" se počítá', potrebujeKontrolu({ needs_review: false, status: 'Nutná ruční kontrola (faktura jako obrázek – vyplňte údaje ručně)' }))
  ok('needs_review = true se počítá', potrebujeKontrolu({ needs_review: true, status: 'Ke kontrole úhrady' }))
  ok('běžná faktura se nepočítá', !potrebujeKontrolu({ needs_review: false, status: 'Ke kontrole úhrady' }))
  ok('filtr do databáze hlídá oba příznaky (česká jména sloupců)', /ke_kontrole\.is\.true/.test(FILTR_KE_KONTROLE) && /stav\.like\."Nutná ruční kontrola%"/.test(FILTR_KE_KONTROLE))
}

console.log('\n6. Granty nových tabulek — z TEXTU migrace')
{
  // Čistá databáze z supabase/tests/run.sh nemá výchozí práva Supabase
  // (`grant all` každé nové tabulce pro anon, authenticated i service_role),
  // takže kontroly „X nemá" v krok99 projdou i bez řádku `revoke`. Tady
  // se proto hlídá text: každá nová tabulka nejdřív všechno odebere všem
  // třem rolím a teprve potom jmenovitě přidá.
  const MIGRACE = 'supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql'
  const sql = readFileSync(join(KOREN, MIGRACE), 'utf8')
  ok('migrace se přečetla (zakládá public.faktury)', /create table public\.faktury \(/.test(sql))
  for (const t of ['faktury', 'faktury_prevod', 'faktury_prevod_zdroj', 'faktury_vzory_odmitnuti']) {
    const odebrat = sql.search(new RegExp(`revoke all on public\\.${t} from anon, authenticated;`))
    const odebratUloze = sql.search(new RegExp(`revoke all on public\\.${t} from service_role;`))
    const grantPrihlasenym = sql.search(new RegExp(`\\ngrant [^;]* on public\\.${t} to authenticated`))
    const grantUloze = sql.search(new RegExp(`\\ngrant [^;]* on public\\.${t} to service_role`))
    ok(`${t}: revoke all od anon a authenticated`, odebrat >= 0)
    ok(`${t}: revoke all od service_role`, odebratUloze >= 0)
    ok(`${t}: granty až po revoke (každé roli zvlášť)`,
      (grantPrihlasenym < 0 || grantPrihlasenym > odebrat) && (grantUloze < 0 || grantUloze > odebratUloze))
    ok(`${t}: anon nedostane nic`, !new RegExp(`\\ngrant [^;]* on public\\.${t} to [^;]*\\banon\\b`).test(sql))
    ok(`${t}: nikdo nedostane TRUNCATE`, !new RegExp(`\\ngrant [^;]*truncate[^;]* on public\\.${t} `, 'i').test(sql))
  }
  ok('faktury_prevod: úloha mění jen seznam příloh (sloupcový grant), stav ne',
    /grant update \(prilohy\) on public\.faktury_prevod to service_role;/.test(sql)
    && !/grant [^;]*update(?! \()[^;]* on public\.faktury_prevod to service_role/.test(sql))
  ok('platby_faktury: úloze odebrané mazání i TRUNCATE',
    /revoke delete, truncate on public\.platby_faktury from service_role;/.test(sql))
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
