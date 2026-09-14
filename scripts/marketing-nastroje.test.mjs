#!/usr/bin/env node
/**
 * Katalog nástrojů a zkouška spojení — lib/marketing-katalog.ts
 * a lib/marketing-spojeni.ts.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-nastroje.test.mjs
 *
 * `--conditions=react-server` je kvůli `import 'server-only'`
 * v marketing-spojeni.ts — stejný důvod jako u marketing-klice.test.mjs.
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ A PROČ ZROVNA TOHLE
 *
 * Zadání (oddíl 3.1) říká: „pouhá položka v katalogu nesmí předstírat
 * funkční integraci." To je věta, kterou nejde ověřit pohledem na
 * obrazovku — nepodporovaný nástroj tam vypadá úplně stejně jako
 * podporovaný, dokud na něj někdo neklikne a nečeká pět marných
 * pokusů o odeslání.
 *
 * Proto kontroly míří na tři věci, které se u tohohle kazí:
 *
 *   1. NEPODPOROVANÝ SE NESMÍ DÁT PŘIPOJIT v žádném ze čtyř režimů.
 *   2. KATALOG SE NESMÍ ROZEJÍT S DATABÁZÍ — kategorie a režimy se
 *      čtou z migrace, ne z druhého opisu v hlavě.
 *   3. RUČNÍ CESTA MUSÍ ZŮSTAT. Bez ní by „bez n8n to nejde" bylo
 *      pravda, a to zadání zakazuje výslovně.
 *
 * ---------------------------------------------------------------------
 * ZKOUŠKA SE NEVOLÁ PŘES SÍŤ
 *
 * Testuje se jen to, co se rozhodne bez poskytovatele: nepodporovaný
 * nástroj, ruční a demo režim a chybějící klíč. Kontrola, která by
 * volala Anthropic, by padala podle toho, jestli je zrovna dostupný —
 * a test, který spadne na cizí službě, se přestane číst.
 */

const { POSKYTOVATELE, PORADI_KATEGORII, NAZVY_KATEGORII, BEZ_PRIPOJENI, NAZVY_REZIMU,
        lzePripojit, potrebnaPole, zkontrolujUdaje, znackaPoskytovatele,
        poskytovateleKategorie, hlavniKategorie } =
  await import('../lib/marketing-katalog.ts')

const { otestovatSpojeni } = await import('../lib/marketing-spojeni.ts')

const fs = await import('node:fs')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const REZIMY = ['zakaznicky', 'foodtab', 'rucni', 'demo']

console.log('\n== Každá položka je celá ==')

for (const p of POSKYTOVATELE) {
  const vyplneno = [p.nazev, p.kCemu, p.prinos, p.omezeni, p.uctovani].every((t) => t.trim().length > 0)
  ok(`${p.klic}: název, k čemu, přínos, omezení a účtování`, vyplneno)
  ok(`${p.klic}: má aspoň jednu kategorii`, p.kategorie.length > 0)
}

console.log('\n== Nepodporovaný se nedá připojit ==')

/*
  Tohle je ta kontrola kvůli které soubor vznikl. Kdyby někdo doplnil
  režimy nebo pole k nástroji bez adaptéru (a je to lákavé — „ať už to
  tam je"), obrazovka by na něj dala tlačítko.
*/
for (const p of POSKYTOVATELE.filter((x) => !x.podporovany)) {
  ok(`${p.klic}: ani jeden ze čtyř režimů`, REZIMY.every((r) => !lzePripojit(p.klic, r)))
  ok(`${p.klic}: nemá vyjmenované režimy`, p.rezimy.length === 0)
  ok(`${p.klic}: nemá pole na klíč`, p.pole.length === 0)
  ok(`${p.klic}: štítek je „Připravujeme"`, znackaPoskytovatele(p) === 'pripravujeme')
}

console.log('\n== Doporučení nejde dát něčemu, co nefunguje ==')

for (const p of POSKYTOVATELE) {
  if (znackaPoskytovatele(p) === 'doporuceno') ok(`${p.klic}: doporučený je podporovaný`, p.podporovany)
}

for (const k of PORADI_KATEGORII) {
  const kolik = poskytovateleKategorie(k).filter((p) => znackaPoskytovatele(p) === 'doporuceno').length
  ok(`${k}: nejvýš jeden doporučený (je ${kolik})`, kolik <= 1)
}

console.log('\n== Neznámý nástroj se nepřipojí vůbec ==')

ok('vymyšlený klíč neprojde', !lzePripojit('nejaky_vymysleny', 'zakaznicky'))
ok('a zkontrolujUdaje ho odmítne', zkontrolujUdaje('nejaky_vymysleny', 'zakaznicky', {}).ok === false)

console.log('\n== Bez připojení modul funguje dál ==')

const rucni = POSKYTOVATELE.find((p) => p.klic === 'rucni_export')
ok('ruční zveřejnění je v katalogu', Boolean(rucni))
ok('je podporované', rucni.podporovany === true)
ok('a jde připojit v ručním režimu', lzePripojit('rucni_export', 'rucni'))
ok('u každé kategorie je napsané, co se děje bez připojení',
  PORADI_KATEGORII.every((k) => (BEZ_PRIPOJENI[k] ?? '').trim().length > 0))
ok('a každá má český název', PORADI_KATEGORII.every((k) => (NAZVY_KATEGORII[k] ?? '').trim().length > 0))
ok('všechny čtyři režimy mají název', REZIMY.every((r) => (NAZVY_REZIMU[r] ?? '').trim().length > 0))

console.log('\n== Klíč se zadává jen tam, kde se použije ==')

ok('u zákaznického režimu se Anthropic ptá na klíč', potrebnaPole('anthropic', 'zakaznicky').length === 1)
ok('u účtu Foodtabu na nic', potrebnaPole('anthropic', 'foodtab').length === 0)
ok('prázdný klíč neprojde', zkontrolujUdaje('anthropic', 'zakaznicky', { klic: '  ' }).ok === false)
ok('vyplněný projde', zkontrolujUdaje('anthropic', 'zakaznicky', { klic: 'sk-ant-abc' }).ok === true)

console.log('\n== Katalog se nesmí rozejít s databází ==')

/*
  Kategorie a režimy jsou v migraci jako `check`. Kdyby se katalog
  rozešel, insert by spadl na 23514 až v provozu — a hláška z `check`
  neřekne, který nástroj to způsobil.
*/
const migrace = fs.readFileSync(
  new URL('../supabase/migrations/20260909220000_marketing_integrace.sql', import.meta.url), 'utf8')

const vytahni = (sloupec) => {
  const m = migrace.match(new RegExp(`${sloupec}\\s+text not null[\\s\\S]*?check \\(${sloupec} in([\\s\\S]*?)\\)\\,`))
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : []
}

const kategorieVDb = vytahni('kategorie')
const rezimyVDb = vytahni('rezim')

ok(`migrace vyjmenovává kategorie (${kategorieVDb.length})`, kategorieVDb.length >= 6)
ok(`migrace vyjmenovává režimy (${rezimyVDb.length})`, rezimyVDb.length === 4)
ok('všechny režimy z katalogu databáze zná',
  POSKYTOVATELE.every((p) => p.rezimy.every((r) => rezimyVDb.includes(r))))

/*
  Kategorie z katalogu, do kterých JDE něco připojit, musí databáze
  znát. Kategorie bez adaptéru (hlas, upozorneni, uloziste) se do
  databáze nikdy nedostanou — karta na obrazovce je, řádek ne.
*/
for (const p of POSKYTOVATELE.filter((x) => x.podporovany)) {
  ok(`${p.klic}: hlavní kategorie ${hlavniKategorie(p.klic)} je v databázi povolená`,
    kategorieVDb.includes(hlavniKategorie(p.klic)))
}

console.log('\n== n8n: co je napsané, to platí ==')

/*
  Dokud `lib/marketing-n8n.ts` bere adresu z prostředí serveru, vlastní
  n8n zákazníka připojit nejde. Kdyby se `zakaznicky` do režimů doplnil
  dřív než adaptér, uložil by se klíč, který nikdo nepřečte.
*/
const n8n = POSKYTOVATELE.find((p) => p.klic === 'n8n')
const n8nZdroj = fs.readFileSync(new URL('../lib/marketing-n8n.ts', import.meta.url), 'utf8')
const bereZProstredi = n8nZdroj.includes("process.env[PROMENNA_URL]")
ok('adaptér pořád bere adresu z prostředí', bereZProstredi)
ok('a proto n8n nenabízí zákaznický režim', !bereZProstredi || !n8n.rezimy.includes('zakaznicky'))

console.log('\n== Zkouška spojení ==')

const nepodporovany = await otestovatSpojeni('shotstack', 'zakaznicky', {})
ok('nepodporovaný nástroj zkouškou neprojde', nepodporovany.ok === false)

ok('ruční režim projde bez volání', (await otestovatSpojeni('rucni_export', 'rucni', {})).ok === true)
ok('demo projde a řekne, že se nic neposílá',
  (await otestovatSpojeni('n8n', 'demo', {})).zprava.toLowerCase().includes('nepošle'))

const bezKlice = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: '' })
ok('zákaznický režim bez klíče neprojde', bezKlice.ok === false)
ok('a neprozradí nic o klíči', !bezKlice.zprava.includes('sk-ant'))

const puvodniUrl = process.env.N8N_MARKETING_URL
const puvodniTaj = process.env.N8N_MARKETING_TAJEMSTVI

delete process.env.N8N_MARKETING_URL
delete process.env.N8N_MARKETING_TAJEMSTVI
const n8nBez = await otestovatSpojeni('n8n', 'foodtab', {})
ok('n8n bez nastavení na serveru neprojde', n8nBez.ok === false)
ok('a hláška pojmenuje, co chybí', n8nBez.zprava.includes('N8N_MARKETING_URL'))

process.env.N8N_MARKETING_URL = 'https://example.invalid/webhook'
process.env.N8N_MARKETING_TAJEMSTVI = 'tajne'
const n8nS = await otestovatSpojeni('n8n', 'foodtab', {})
ok('s nastavením projde', n8nS.ok === true)
/*
  A hlavně: netvrdí, že se ověřilo odeslání. Na publikační webhook se
  naslepo nic neposílá — zelená hláška, která slibuje víc, než změřila,
  je horší než žádná.
*/
ok('ale neslibuje, že se ověřilo odesílání', n8nS.zprava.includes('nanečisto'))

if (puvodniUrl === undefined) delete process.env.N8N_MARKETING_URL
else process.env.N8N_MARKETING_URL = puvodniUrl
if (puvodniTaj === undefined) delete process.env.N8N_MARKETING_TAJEMSTVI
else process.env.N8N_MARKETING_TAJEMSTVI = puvodniTaj

console.log('\n== Každé volané rpc musí být ve schématu public ==')

/*
  TAHLE KONTROLA JE TU KVŮLI CHYBĚ, KTEROU NIKDO NEVIDĚL PŮL TÝDNE.

  `supabase.rpc('marketing_precti_tajemstvi')` volalo funkci, která leží
  ve schématu `app`. PostgREST vystavuje jen `public`
  (supabase/config.toml), takže to volání nemohlo projít nikdy — a
  obrazovka chybu brala jako „zákazník nemá připojenou vlastní AI".
  Vlastní klíč zákazníka tedy tiše nedělal nic.

  Pozná se to jedině porovnáním kódu s migracemi: v běhu to vypadá jako
  prázdná odpověď, ne jako chyba. Prohledává se jen marketing — do
  cizího modulu se nesahá (CLAUDE.md).
*/
const path = await import('node:path')

function souboryModulu(dir, nalezene = []) {
  for (const polozka of fs.readdirSync(dir, { withFileTypes: true })) {
    const cela = path.join(dir, polozka.name)
    if (polozka.isDirectory()) souboryModulu(cela, nalezene)
    else if (/\.tsx?$/.test(polozka.name)) nalezene.push(cela)
  }
  return nalezene
}

/*
  `fileURLToPath`, ne `.pathname` — na Windows `file:///C:/...`.pathname
  vrátí `/C:/...` s lomítkem před písmenem disku, a `path.join` s tím
  pak sestaví neplatnou cestu se zdvojeným `C:` (ENOENT, scandir
  `C:\C:\Users\...`). `fileURLToPath` disk sám rozpozná správně.
*/
const { fileURLToPath } = await import('node:url')
const korenModulu = fileURLToPath(new URL('../', import.meta.url))
const zdroje = [
  ...souboryModulu(path.join(korenModulu, 'app/[rozsah]/marketing')),
  ...souboryModulu(path.join(korenModulu, 'app/api/uloha/marketing-fronta')),
]

const migraceVse = fs.readdirSync(path.join(korenModulu, 'supabase/migrations'))
  .map((f) => fs.readFileSync(path.join(korenModulu, 'supabase/migrations', f), 'utf8'))
  .join('\n')

const volana = new Set()
for (const soubor of zdroje) {
  for (const m of fs.readFileSync(soubor, 'utf8').matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) {
    volana.add(m[1])
  }
}

ok(`marketing volá nějaká rpc (${volana.size})`, volana.size > 0)

for (const jmeno of [...volana].sort()) {
  const vPublic = new RegExp(`create (or replace )?function public\\.${jmeno}\\s*\\(`).test(migraceVse)
  ok(`rpc ${jmeno} má funkci ve schématu public`, vPublic)
}

console.log('\n== Co je označené jako podporované, musí mít zkoušku napsanou ==')

/*
  Tohle je druhá půlka pravidla „položka nesmí předstírat funkční
  integraci". První půlka hlídá, že se nepodporovaný nedá připojit;
  tahle hlídá opak — že `podporovany: true` někdo nedopsal k nástroji,
  ke kterému žádný kód nevede. Poznalo by se to jinak až tím, že
  zkouška vrátí „pro X není zkouška spojení napsaná" uživateli.

  Klíč Foodtabu se na dobu kontroly odklízí, aby se nevolal Anthropic:
  test, který závisí na cizí službě, se přestane číst.
*/
const puvodniAi = process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_API_KEY

for (const p of POSKYTOVATELE.filter((x) => x.podporovany)) {
  for (const r of p.rezimy) {
    const v = await otestovatSpojeni(p.klic, r, {})
    ok(`${p.klic}/${r}: zkouška je napsaná`, !v.zprava.includes('není zkouška spojení napsaná'))
  }
}

if (puvodniAi === undefined) delete process.env.ANTHROPIC_API_KEY
else process.env.ANTHROPIC_API_KEY = puvodniAi

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
