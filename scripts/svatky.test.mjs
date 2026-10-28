#!/usr/bin/env node
/**
 * Svátky v kalendářích — Rozpis směn i Rezervace a akce (Šéfík 28. 10. 2026:
 * „v kalendářích směn i akcí potřebuju mít nějak znázorněné svátky“).
 *
 * Pusť `node scripts/svatky.test.mjs`.
 *
 *   1. výpočet (lib/svatky.ts) proti tabulce opsané ze zákonů — všechny
 *      svátky 2025–2030 s názvem, druhem a zavřenými obchody; Velikonoce
 *      zvlášť i proti známým datům mimo ten rozsah;
 *   2. hranice: od kdy platí Velký pátek, nový název 17. 11., zákon
 *      o prodejní době; neznámá země nedostane nic, prázdná dostane CZ;
 *   3. KALENDÁŘNÍ den, ne hodiny serveru: týž výsledek v pásmu UTC+14
 *      i UTC−11 (spouští se znovu ve vedlejším procesu);
 *   4. země firmy (lib/svatky-firmy.ts, SPUŠTĚNÝ s podstrčenou databází):
 *      CZ, prázdná, cizí, chyba dotazu;
 *   5. barvy ZMĚŘENÉ z app/_tokeny.css: šrafa se nepoplete s barvami
 *      poboček ani stavů, písmo drží kontrast 4,5 : 1 ve světlém i tmavém;
 *   6. CSS: stylopis je načtený, šrafa má pod sebou „positioned“ buňku
 *      a záhlaví mřížky zůstává `sticky`;
 *   7. VYKRESLENÉ kalendáře (scripts/vykreslit.mjs, skutečné komponenty):
 *      Rezervace měsíc / týden / den, Rozpis mřížka / celý měsíc lidí /
 *      telefon (den, týden, moje), celý RozpisView v pohledu Měsíc a Den.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MEZ_DE, ctiToken, de, pomer, samokontrola, vyrez } from './barvy.js'
import { vzhledPobocek } from '../lib/rezervace-pobocky.ts'
import { FILTR_DESKTOP_PRAZDNY, sestavitMrizku } from '../lib/rozpis-desktop.ts'
import { FILTR_PRAZDNY, mesicniMrizka } from '../lib/rozpis-mobil.ts'
import {
  ZEME_VYCHOZI,
  obchodyText,
  popisSvatku,
  svatekDne,
  svatkyObdobi,
  svatkyRoku,
  velikonocniNedele,
  zemeSvatku,
} from '../lib/svatky.ts'
import { nactiModul } from './vykreslit.mjs'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8').replace(/\r\n/g, '\n')
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/* ---------------------------------------------------------------------
 * Tabulka ze zákonů. Opsaná ručně, NE vypočtená tímtéž kódem:
 *   - zákon č. 245/2000 Sb., § 1 (státní svátky) a § 2 (ostatní svátky);
 *   - zákon č. 223/2016 Sb. o prodejní době, § 1 (obchody zavřené);
 *   - Velikonoční neděle 2025–2030 z církevního kalendáře.
 * ------------------------------------------------------------------- */

const PEVNE = [
  ['01-01', 'Den obnovy samostatného českého státu, Nový rok', 'statni', 'cely-den'],
  ['05-01', 'Svátek práce', 'ostatni', null],
  ['05-08', 'Den vítězství', 'statni', 'cely-den'],
  ['07-05', 'Den slovanských věrozvěstů Cyrila a Metoděje', 'statni', null],
  ['07-06', 'Den upálení mistra Jana Husa', 'statni', null],
  ['09-28', 'Den české státnosti', 'statni', 'cely-den'],
  ['10-28', 'Den vzniku samostatného československého státu', 'statni', 'cely-den'],
  ['11-17', 'Den boje za svobodu a demokracii a Mezinárodní den studentstva', 'statni', null],
  ['12-24', 'Štědrý den', 'ostatni', 'od-poledne'],
  ['12-25', '1. svátek vánoční', 'ostatni', 'cely-den'],
  ['12-26', '2. svátek vánoční', 'ostatni', 'cely-den'],
]
const VELIKONOCE = {
  2025: { nedele: '2025-04-20', patek: '2025-04-18', pondeli: '2025-04-21' },
  2026: { nedele: '2026-04-05', patek: '2026-04-03', pondeli: '2026-04-06' },
  2027: { nedele: '2027-03-28', patek: '2027-03-26', pondeli: '2027-03-29' },
  2028: { nedele: '2028-04-16', patek: '2028-04-14', pondeli: '2028-04-17' },
  2029: { nedele: '2029-04-01', patek: '2029-03-30', pondeli: '2029-04-02' },
  2030: { nedele: '2030-04-21', patek: '2030-04-19', pondeli: '2030-04-22' },
}

console.log('\n== 1. Svátky 2025–2030 podle zákona ==\n')
{
  for (const [rok, v] of Object.entries(VELIKONOCE)) {
    const cekam = [
      ...PEVNE.map(([md, nazev, druh, obchody]) => ({ den: `${rok}-${md}`, nazev, druh, obchody })),
      { den: v.patek, nazev: 'Velký pátek', druh: 'ostatni', obchody: null },
      { den: v.pondeli, nazev: 'Velikonoční pondělí', druh: 'ostatni', obchody: 'cely-den' },
    ].sort((a, b) => (a.den < b.den ? -1 : 1))
    const ma = svatkyRoku(Number(rok), 'CZ').map(({ den, nazev, druh, obchody }) => ({ den, nazev, druh, obchody }))
    const rozdil = cekam.filter((c, i) => JSON.stringify(c) !== JSON.stringify(ma[i]))
    ok(
      `${rok}: 13 dnů (Velikonoce ${v.nedele.slice(5)} → pátek ${v.patek.slice(5)}, pondělí ${v.pondeli.slice(5)}), názvy, druh i obchody`,
      ma.length === 13 && rozdil.length === 0,
    )
    for (const r of rozdil) console.log('        čekal jsem', JSON.stringify(r), '\n        je         ', JSON.stringify(ma.find((m) => m.den === r.den) ?? null))
    ok(`${rok}: Velikonoční neděle ${v.nedele}`, velikonocniNedele(Number(rok)) === v.nedele)

    const zavreno = ma.filter((s) => s.obchody).map((s) => `${s.den.slice(5)}${s.obchody === 'od-poledne' ? ' od 12' : ''}`)
    ok(`${rok}: obchody zavřené přesně 1. 1., Vel. pondělí, 8. 5., 28. 9., 28. 10., 25. a 26. 12., 24. 12. od 12 (${zavreno.join(', ')})`, zavreno.length === 8)
  }

  ok('svátek dne: 28. 10. 2026', svatekDne('2026-10-28', 'CZ')?.nazev === 'Den vzniku samostatného československého státu')
  ok('obyčejný den: nic', svatekDne('2026-10-27', 'CZ') === null && svatekDne('2026-04-05', 'CZ') === null)
  ok('Velikonoční neděle sama svátek není (zákon ji nemá)', svatekDne(VELIKONOCE[2027].nedele, 'CZ') === null)
  ok('nesmysl v datu: nic, nespadne', svatekDne('28. 10. 2026', 'CZ') === null && svatekDne('', 'CZ') === null && svatekDne('2026-13-45', 'CZ') === null)
  ok(
    'období přes Nový rok: 24.–26. 12. 2026 a 1. 1. 2027 v pořadí',
    svatkyObdobi('2026-12-20', '2027-01-03', 'CZ').map((s) => s.den).join() === '2026-12-24,2026-12-25,2026-12-26,2027-01-01',
  )
  ok('období obráceně nebo s nesmyslem: prázdno', svatkyObdobi('2026-12-31', '2026-01-01', 'CZ').length === 0 && svatkyObdobi('x', '2026-01-01', 'CZ').length === 0)
  ok(
    'texty: popis pro odečítač i značka obchodů',
    popisSvatku(svatekDne('2026-10-28', 'CZ')) === 'Státní svátek Den vzniku samostatného československého státu, obchody zavřené' &&
      popisSvatku(svatekDne('2026-12-24', 'CZ')) === 'Svátek Štědrý den, obchody od 12:00 zavřené' &&
      popisSvatku(svatekDne('2026-05-01', 'CZ')) === 'Svátek Svátek práce' &&
      obchodyText(svatekDne('2026-07-05', 'CZ')) === '',
  )
  const kratke = svatkyRoku(2026, 'CZ').filter((s) => !s.kratce || s.kratce.length > 20)
  ok('každý svátek má krátký název do buňky (nejvýš 20 znaků)', kratke.length === 0)
}

console.log('\n== 2. Velikonoce mimo tabulku, hranice zákonů, země ==\n')
{
  // Známá data včetně krajních (nejdřív 22. 3., nejpozději 25. 4.).
  const ZNAMA = { 2008: '2008-03-23', 2011: '2011-04-24', 2019: '2019-04-21', 2024: '2024-03-31', 2038: '2038-04-25', 2285: '2285-03-22', 2100: '2100-03-28' }
  const spatne = Object.entries(ZNAMA).filter(([r, d]) => velikonocniNedele(Number(r)) !== d)
  ok(`Velikonoce i mimo 2025–2030: ${Object.keys(ZNAMA).join(', ')}`, spatne.length === 0)
  for (const [r, d] of spatne) console.log(`        ${r}: čekal jsem ${d}, je ${velikonocniNedele(Number(r))}`)
  // Každá Velikonoční neděle 1900–2200 je neděle mezi 22. 3. a 25. 4.
  const mimo = []
  for (let r = 1900; r <= 2200; r++) {
    const d = velikonocniNedele(r)
    const [y, m, dd] = d.split('-').map(Number)
    const nedele = new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === 0
    if (!nedele || d.slice(5) < '03-22' || d.slice(5) > '04-25') mimo.push(d)
  }
  ok('Velikonoční neděle 1900–2200: vždycky neděle mezi 22. 3. a 25. 4.', mimo.length === 0)

  ok('Velký pátek: v roce 2015 ještě ne, od 2016 ano', !svatkyRoku(2015, 'CZ').some((s) => s.nazev === 'Velký pátek') && svatekDne('2016-03-25', 'CZ')?.nazev === 'Velký pátek')
  ok(
    '17. 11.: do 2018 kratší název, od 2019 i „Mezinárodní den studentstva“',
    svatekDne('2018-11-17', 'CZ')?.nazev === 'Den boje za svobodu a demokracii' && svatekDne('2019-11-17', 'CZ')?.nazev.endsWith('Mezinárodní den studentstva'),
  )
  ok(
    'zákon o prodejní době platí od 1. 10. 2016: 8. 5. 2016 obchody otevřeno, 28. 10. 2016 zavřeno',
    svatekDne('2016-05-08', 'CZ')?.obchody === null && svatekDne('2016-10-28', 'CZ')?.obchody === 'cely-den',
  )
  ok('před zákonem 245/2000 Sb. (rok 2000 a dřív) nic, ne něco jiného', svatkyRoku(2000, 'CZ').length === 0 && svatkyRoku(2001, 'CZ').length === 12)

  ok(`země: prázdná, null i mezery → ${ZEME_VYCHOZI}`, zemeSvatku(null) === 'CZ' && zemeSvatku('') === 'CZ' && zemeSvatku('  ') === 'CZ' && zemeSvatku(undefined) === 'CZ')
  ok('země: „cz“ i „CZ “ → CZ', zemeSvatku('cz') === 'CZ' && zemeSvatku('CZ ') === 'CZ')
  ok('země, kterou neznáme (SK, DE): žádné svátky — radši nic než cizí', zemeSvatku('SK') === null && zemeSvatku('DE') === null && svatkyRoku(2026, zemeSvatku('SK')).length === 0)
  ok('země mimo typy (undefined, cizí řetězec, „__proto__“) nespadne a nedá nic', svatkyRoku(2026, undefined).length === 0 && svatkyRoku(2026, 'XX').length === 0 && svatkyRoku(2026, '__proto__').length === 0)

  const lib = cti('lib/svatky.ts')
  const zdrojBezKomentaru = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  ok(
    'lib/svatky.ts nečte hodiny ani místní čas (žádné Date.now, getDate, getHours, new Date(text))',
    !/Date\.now|\.get(Date|Day|Month|FullYear|Hours)\(|new Date\(\s*['"`a-z]/.test(zdrojBezKomentaru),
  )
}

console.log('\n== 3. Kalendářní den, ne pásmo serveru ==\n')
{
  const skript =
    `import(${JSON.stringify(new URL('../lib/svatky.ts', import.meta.url).href)}).then((m) => {` +
    `  const r = [2025, 2026, 2027].flatMap((y) => m.svatkyRoku(y, 'CZ').map((s) => s.den));` +
    `  const d = ['2026-10-28', '2026-10-27', '2026-12-24', '2027-03-29'].map((x) => m.svatekDne(x, 'CZ')?.den ?? null);` +
    `  console.log(JSON.stringify({ r, d }));` +
    `})`
  const tady = JSON.stringify({
    r: [2025, 2026, 2027].flatMap((y) => svatkyRoku(y, 'CZ').map((s) => s.den)),
    d: ['2026-10-28', '2026-10-27', '2026-12-24', '2027-03-29'].map((x) => svatekDne(x, 'CZ')?.den ?? null),
  })
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC', 'Europe/Prague']) {
    let tam = ''
    try {
      tam = execFileSync(process.execPath, ['--input-type=module', '-e', skript], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim()
    } catch (e) {
      tam = `spadlo: ${e.message}`
    }
    ok(`pásmo serveru ${tz}: tytéž svátky a tytéž dny`, tam === tady)
  }
}

console.log('\n== 4. Země firmy (lib/svatky-firmy.ts) ==\n')
{
  globalThis.__sOdpoved = null
  globalThis.__sDotaz = null
  const SUPABASE = js(
    'export async function getServerSupabase() {\n' +
      '  const q = { select(s) { globalThis.__sDotaz.sloupce = s; return q }, eq(k, v) { globalThis.__sDotaz.eq = [k, v]; return q },\n' +
      '    maybeSingle() { return Promise.resolve(globalThis.__sOdpoved) } }\n' +
      '  return { from(t) { globalThis.__sDotaz = { tabulka: t }; return q } }\n' +
      '}\n',
  )
  const { zemeSvatkuFirmy } = await nactiModul('lib/svatky-firmy.ts', [
    ['server-only', js('')],
    ['@/lib/supabase/server', SUPABASE],
    ['@/lib/svatky', new URL('../lib/svatky.ts', import.meta.url).href],
  ])
  const zeme = async (odpoved) => {
    globalThis.__sOdpoved = odpoved
    return zemeSvatkuFirmy('t1')
  }
  ok('firma CZ → CZ, čte se tenants.country té firmy', (await zeme({ data: { country: 'CZ' }, error: null })) === 'CZ' &&
    globalThis.__sDotaz.tabulka === 'tenants' && globalThis.__sDotaz.sloupce === 'country' && globalThis.__sDotaz.eq?.join() === 'id,t1')
  ok('firma bez země → CZ', (await zeme({ data: { country: null }, error: null })) === 'CZ')
  ok('firma SK (svátky neznáme) → nic', (await zeme({ data: { country: 'SK' }, error: null })) === null)
  ok('chyba dotazu nebo žádný řádek → CZ (kalendář kvůli značce nespadne)', (await zeme({ data: null, error: { code: '42501' } })) === 'CZ' && (await zeme({ data: null, error: null })) === 'CZ')
  ok('obě obrazovky berou zemi odsud (Rozpis i Rezervace kalendář i den)', ['app/[rozsah]/smeny/page.tsx', 'app/[rozsah]/rezervace/page.tsx', 'app/[rozsah]/rezervace/den/[datum]/page.tsx'].every((f) => /zemeSvatkuFirmy\(tenantId\)/.test(cti(f))))
}

console.log('\n== 5. Barvy změřené z app/_tokeny.css ==\n')
{
  samokontrola()
  const tokeny = cti('app/_tokeny.css')
  const svatkyCss = cti('app/_svatky.css')
  const sila = Number(svatkyCss.match(/--svatek-srafa-sila:\s*(\d+)%/)?.[1])
  ok(`síla šrafy načtená z app/_svatky.css (${sila} %)`, sila > 0 && sila < 100)
  ok('šrafa je v barvě --mosaz-sv (rodina víkendu a dneška), ne v barvě pobočky ani stavu', /--svatek-srafa-barva:\s*var\(--mosaz-sv\)/.test(svatkyCss))
  const bloky = {
    svetlo: vyrez(tokeny, ':root {', '@media (prefers-color-scheme: dark)'),
    tma: vyrez(tokeny, ':root[data-theme="dark"] {', '/* ---'),
    'tma (systémový)': vyrez(tokeny, '@media (prefers-color-scheme: dark)', ':root[data-theme="dark"] {'),
  }
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  /** color-mix(in srgb, a p%, b) */
  const mix = (a, p, b) => '#' + hex(a).map((x, i) => Math.round(x * p + hex(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')
  // Barvy kalendáře Rezervací (lib/rezervace-pobocky.ts) a stavy: Potvrzená, Předběžná, Zrušená, Akce, Probíhá.
  const SOUPERI = ['b-sky', 'b-violet', 'b-indigo', 'dobre', 'pozor', 'bad', 'vino', 'info']
  for (const [rezim, blok] of Object.entries(bloky)) {
    const t = (n) => ctiToken(blok, n)
    const mez = rezim === 'svetlo' ? MEZ_DE.svetlo : MEZ_DE.tma
    const srafa = t('mosaz-sv')
    const blizko = SOUPERI.map((k) => [k, de(srafa, t(k))]).filter(([, d]) => !(d >= mez))
    ok(`${rezim}: šrafa (--mosaz-sv) je od barev poboček i stavů aspoň ΔE ${mez}`, !!srafa && blizko.length === 0)
    for (const [k, d] of blizko) console.log(`        --${k}: ΔE ${d.toFixed(1)}`)

    const proužek = mix(srafa, sila / 100, t('card'))
    const kontrast = [
      ['název svátku (písmo na podkladu karty)', t('ink'), t('card')],
      ['značka obchodů (šedé písmo na kartě)', t('muted'), t('card')],
      ['pruh svátku nad dnem (písmo přímo na proužku)', t('ink'), proužek],
    ].filter(([, a, b]) => !(pomer(a, b) >= 4.5))
    ok(`${rezim}: písmo svátku i vozíku drží 4,5 : 1`, kontrast.length === 0)
    for (const [co, a, b] of kontrast) console.log(`        ${co}: ${pomer(a, b).toFixed(2)}`)
  }
  ok(
    'název svátku v buňce má vlastní podklad karty (na proužcích u dneška by v tmavém vyšlo pod 4,5 : 1)',
    /\.ds-svatek-nazev\s*\{[^}]*background:\s*var\(--card\)/.test(svatkyCss),
  )
}

console.log('\n== 6. CSS: načtení, pozice pod šrafou, sticky záhlaví ==\n')
{
  ok('app/_svatky.css je v globals.css za _rezervace.css', /@import "\.\/_rezervace\.css";\s*\n@import "\.\/_svatky\.css";/.test(cti('app/globals.css')))
  const css = cti('app/_svatky.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const tridy = (sel) => [...sel.matchAll(/\.(ds-[a-z0-9-]+)/g)].map((m) => m[1])
  const pravidla = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), telo: m[2] }))
  const sSrafou = new Set(pravidla.filter((p) => /::before/.test(p.sel) && /background-image/.test(p.telo)).flatMap((p) => tridy(p.sel)))
  const relativni = new Set(pravidla.filter((p) => /position:\s*relative/.test(p.telo)).flatMap((p) => tridy(p.sel)))
  const komponenty = cti('app/_komponenty.css').replace(/\/\*[\s\S]*?\*\//g, '')
  /** Třída má v _komponenty.css vlastní pravidlo s pozicí jinou než static. */
  const umiPozici = (t) => new RegExp(`(^|[\\s,}])\\.${t}\\s*\\{[^}]*position:\\s*(relative|sticky|absolute)`, 'm').test(komponenty)
  const bezPozice = [...sSrafou].filter((t) => !relativni.has(t) && !umiPozici(t))
  ok(`každá buňka se šrafou je „positioned“ (${sSrafou.size} tříd), jinak by proužky přetekly přes celou stránku`, sSrafou.size >= 10 && bezPozice.length === 0)
  if (bezPozice.length) console.log('        bez pozice:', bezPozice.join(', '))
  const prepsane = [...relativni].filter((t) => new RegExp(`\\.${t}\\s*\\{[^}]*position:\\s*sticky`).test(komponenty))
  ok('záhlaví mřížky (sticky) svátek nepřepne na relative — přestalo by se lepit', prepsane.length === 0 && sSrafou.has('ds-smd-den'))
  if (prepsane.length) console.log('        přepsané sticky:', prepsane.join(', '))
}

console.log('\n== 7. Vykreslené kalendáře ==\n')

const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
const NIC = js('export default function Nic() { return null }\n')
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VETVE = [
  { id: B, name: 'Bernard Bar Tábor', color: 'rose' },
  { id: P, name: 'Restaurace Černá Perla', color: 'rose' },
]
const NAZEV_28 = 'Den vzniku samostatného československého státu'
const POPIS_28 = `Státní svátek ${NAZEV_28}, obchody zavřené`
/** Otevírací značka prvku, který nese `data-svatek`, i s jeho atributy. */
const sSvatkem = (html) => [...html.matchAll(/<[a-z]+ [^>]*data-svatek=""[^>]*>/g)].map((m) => m[0])

// --- Rezervace ---------------------------------------------------------
{
  const obsah = await nactiModul('app/[rozsah]/rezervace/obsah.tsx', [
    ['next/link', ODKAZ],
    ['./akce', js('const a = async () => {}\nexport const zmenitStav = a, odebratPrilohu = a, pridatPoznamku = a, smazatPoznamku = a, upravitPoznamku = a, ulozitRezervaci = a\n')],
    ['./formular', NIC],
    ['./prilohy-nahrat', NIC],
  ])
  const vz = vzhledPobocek(VETVE)
  const POBOCKY = VETVE.map((v) => ({ id: v.id, nazev: v.name, slug: v.id === B ? 'bernard-bar' : 'cerna-perla', zona: 'Europe/Prague', zapis: true, ...vz.get(v.id) }))
  const kalendar = (pohled, datum, zeme = 'CZ') =>
    renderToStaticMarkup(
      createElement(obsah.KalendarObsah, { rozsah: 'firma', pohled, datum, dnes: '2026-10-27', pobocky: POBOCKY, rezervace: [], znacky: new Map(), zemeSvatku: zeme }),
    )

  const mesic = kalendar('mesic', '2026-10-15')
  const bunka = (den) => mesic.match(new RegExp(`<a href="/firma/rezervace/den/${den}" class="ds-rez-bunka"[^>]*>([\\s\\S]*?)</a>`))
  const b28 = bunka('2026-10-28')
  ok('Rezervace měsíc: 28. 10. má šrafu (data-svatek) a není „prázdný“ — na telefonu se ze seznamu dnů neschová',
    !!b28 && /data-svatek=""/.test(b28[0]) && !/data-prazdny/.test(b28[0]))
  ok('Rezervace měsíc: v buňce krátký název a vozík „zavřeno“, odečítač čte celý název', !!b28 && b28[1].includes('Vznik Československa') && b28[1].includes(`Státní svátek ${NAZEV_28}`) && text(b28[1]).includes('zavřeno'))
  ok('Rezervace měsíc: popisek buňky (přebíjí obsah) nese svátek i obchody', !!b28 && b28[0].includes(`aria-label="st 28. 10., ${POPIS_28}: nic zapsaného"`))
  ok('Rezervace měsíc: obyčejný den (27. 10.) šrafu nemá a prázdný zůstává prázdný', !!bunka('2026-10-27') && !/data-svatek/.test(bunka('2026-10-27')[0]) && /data-prazdny/.test(bunka('2026-10-27')[0]))
  ok('Rezervace měsíc: 28. 9. ze září v mřížce října šrafu nemá (patří jinému měsíci)', !!bunka('2026-09-28') && !/data-svatek/.test(bunka('2026-09-28')[0]))
  ok(`Rezervace měsíc: šrafa jen u svátků měsíce (${sSvatkem(mesic).filter((z) => z.includes('ds-rez-bunka')).length}× = 28. 10.)`, sSvatkem(mesic).filter((z) => z.includes('ds-rez-bunka')).length === 1)
  const seznam = mesic.match(/<section class="ds-svatky-obdobi"[^>]*>([\s\S]*?)<\/section>/)
  ok('Rezervace měsíc: pod kalendářem „28. 10. Den vzniku … obchody zavřené“ (a ne 28. 9.)', !!seznam && text(seznam[1]) === `28. 10. ${NAZEV_28} obchody zavřené`)

  const tyden = kalendar('tyden', '2026-10-28')
  const karta = tyden.match(/<section class="ds-plocha ds-rez-den"[^>]*data-svatek=""[^>]*>([\s\S]*?)<\/section>/)
  ok('Rezervace týden: karta 28. 10. se šrafou a celým názvem i „obchody zavřené“', !!karta && karta[0].includes(`aria-label="st 28. 10., ${POPIS_28}"`) && text(karta[1]).includes(`${NAZEV_28} obchody zavřené`))
  ok('Rezervace týden: šrafu má jen ta jedna karta ze sedmi', sSvatkem(tyden).filter((z) => z.includes('ds-rez-den')).length === 1)
  const prelom = kalendar('tyden', '2026-12-30')
  ok('Rezervace týden přes Nový rok: 1. 1. 2027 i Vánoce v seznamu', text(prelom.match(/<section class="ds-svatky-obdobi"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '').startsWith('1. 1. Den obnovy'))

  const bezZeme = kalendar('mesic', '2026-10-15', null) + kalendar('tyden', '2026-10-28', null)
  ok('Rezervace: země bez svátků (null) → žádná šrafa ani seznam', !bezZeme.includes('data-svatek') && !bezZeme.includes('ds-svatky-obdobi'))

  const den = (svatek) =>
    renderToStaticMarkup(createElement(obsah.DenObsah, { rozsah: 'firma', datum: '2026-12-24', dnes: '2026-10-27', tenantId: 't1', kDnu: [], svatek }))
  const pruh = den(svatekDne('2026-12-24', 'CZ')).match(/<p class="ds-svatek-pruh"[^>]*>([\s\S]*?)<\/p>/)
  ok('Rezervace den: pruh „Svátek · Štědrý den · obchody od 12:00 zavřené“', !!pruh && text(pruh[1]) === 'Svátek Štědrý den obchody od 12:00 zavřené')
  ok('Rezervace den bez svátku: žádný pruh', !den(null).includes('ds-svatek-pruh'))
}

// --- Rozpis směn ------------------------------------------------------
const DNY = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const OSOBA = { id: 'e1', jmeno: 'Jana Nováková', usekId: null, poziceId: null, barva: null }
{
  const MrizkaTydne = (await nactiModul('app/[rozsah]/smeny/desktop/mrizka.tsx', [['next/link', ODKAZ]])).default
  const mrizka = sestavitMrizku({ smeny: [], dny: DNY, osoby: new Map(), useky: new Map(), pobocky: new Map(), lideBezSmeny: [OSOBA], filtr: FILTR_DESKTOP_PRAZDNY })
  const vykreslit = (zeme) =>
    renderToStaticMarkup(
      createElement(MrizkaTydne, {
        mrizka, dny: DNY, dnesni: '2026-10-27', planovani: null, potvrzeni: null, poziceOsob: () => null, barvy: new Map(), jmena: new Map(),
        nazvyPobocek: new Map(), zkratkyPobocek: new Map(), pobockaProNovou: null, vybranaId: null, sbalene: new Set(), onPrepnout() {}, onOtevrit() {},
        filtrAktivni: false, onZrusitFiltry() {}, maSmeny: false, hoste: null, rozsahAdresa: 'firma', zemeSvatku: zeme,
      }),
    )
  const s = vykreslit('CZ')
  const zahlavi = s.match(/<div role="columnheader" class="ds-smd-den"[^>]*data-svatek=""[^>]*>([\s\S]*?)<\/div>/)
  ok('Rozpis týden: záhlaví 28. 10. se šrafou, popisek „ST 28. 10., Státní svátek …“ (zkratka dne jako dosud)', !!zahlavi && zahlavi[0].includes(`aria-label="ST 28. 10., ${POPIS_28}"`))
  ok('Rozpis týden: v záhlaví krátký název a vozík', !!zahlavi && zahlavi[1].includes('Vznik Československa') && zahlavi[1].includes('ds-svatek-obchody'))
  const bunky = sSvatkem(s).filter((z) => z.includes('ds-smd-bunka'))
  ok(`Rozpis týden: šrafu má celý sloupec svátku — buňka řádku člověka pod 28. 10. (${bunky.length}×)`, bunky.length === 1)
  const legenda = s.match(/<ul class="ds-smd-legenda"[^>]*>([\s\S]*?)<\/ul>/)
  ok('Rozpis týden: vysvětlivka pod mřížkou „28. 10. Den vzniku … obchody zavřené“', !!legenda && text(legenda[1]).includes(`28. 10. ${NAZEV_28} obchody zavřené`))
  ok('Rozpis týden bez svátků (země null): nic', !vykreslit(null).includes('data-svatek') && !vykreslit(null).includes('ds-svatek'))

  const MesicLidi = (await nactiModul('app/[rozsah]/smeny/desktop/mesic-lidi.tsx', [['next/link', ODKAZ]])).default
  const ml = renderToStaticMarkup(
    createElement(MesicLidi, {
      lide: [{ id: 'e1', jmeno: OSOBA.jmeno }], mesic: '2026-10', tydny: mesicniMrizka('2026-10-15'), smeny: [], dnesni: '2026-10-27', planovani: null, potvrzeni: null,
      jmena: new Map(), poziceOsob: () => null, barvy: new Map(), nazvyPobocek: new Map(), zkratkyPobocek: new Map(), pobockaProNovou: null, vybranaId: null, onOtevrit() {},
      zemeSvatku: 'CZ',
    }),
  )
  const mlBunky = sSvatkem(ml).filter((z) => z.includes('ds-smd-ml-bunka'))
  ok(`Rozpis celý měsíc lidí: šrafa jen u 28. 10. (ne u 28. 9. z vedlejšího měsíce) — ${mlBunky.length}×`, mlBunky.length === 1 && ml.includes('Vznik Československa'))

  const pohledy = await nactiModul('app/[rozsah]/smeny/mobil/pohledy.tsx', [['next/link', ODKAZ]])
  const nic = () => {}
  const ctx = { dnesni: '2026-10-27', osoby: new Map([['e1', { id: 'e1', jmeno: OSOBA.jmeno, usekId: null, barva: null }]]), useky: new Map(), pobocky: new Map(), pozice: new Map(), tvurci: new Map(), vicePobocek: false, zemeSvatku: 'CZ' }
  const denM = (den) =>
    renderToStaticMarkup(
      createElement(pohledy.DenPrehled, {
        den, dnes: '2026-10-27', smeny: [], filtr: FILTR_PRAZDNY, jeVedouci: true, hoste: null, rozsah: 'firma', ctx,
        onVybratDen: nic, onTyden: nic, onOtevritSmenu: nic, onPridat: nic, onFiltry: nic, onZrusitFiltr: nic, onZobrazitNeobsazene: nic,
      }),
    )
  const d28 = denM('2026-10-28')
  const pruh = d28.match(/<p class="ds-svatek-pruh"[^>]*>([\s\S]*?)<\/p>/)
  ok('telefon, den 28. 10.: pruh „Státní svátek · Den vzniku … · obchody zavřené“ pod hlavičkou dne', !!pruh && text(pruh[1]) === `Státní svátek ${NAZEV_28} obchody zavřené` && d28.indexOf('ds-sm-hlava') < d28.indexOf('ds-svatek-pruh'))
  const cip = denM('2026-10-27').match(/<button type="button" class="ds-sm-den"[^>]*data-svatek=""[^>]*>/)
  ok('telefon, jiný den: pruh není, ale 28. 10. v pruhu dnů má šrafu a svátek v popisku', !denM('2026-10-27').includes('ds-svatek-pruh') && !!cip && cip[0].includes(`aria-label="Středa 28. října, ${POPIS_28}"`))

  const SMENA = { id: 's1', branch_id: B, employee_id: 'e1', position_id: null, shift_date: '2026-10-28', starts_at: '10:00', ends_at: '18:00', status: 'scheduled', note: '', published_at: '2026-10-20T10:00:00Z', pauza_od: null, pauza_do: null, created_by: null, created_at: null }
  const tydenM = renderToStaticMarkup(
    createElement(pohledy.TydenPrehled, { den: '2026-10-27', dnes: '2026-10-27', smeny: [SMENA], filtr: FILTR_PRAZDNY, jeVedouci: true, ctx, onTyden: nic, onDnes: nic, onOtevritSmenu: nic, onPridat: nic, onFiltry: nic, onZrusitFiltr: nic }),
  )
  const dl = sSvatkem(tydenM).filter((z) => z.includes('ds-sm-dl'))
  ok('telefon, týden: dlaždice 28. 10. se šrafou a svátkem v popisku, jen jedna', dl.length === 1 && dl[0].includes(POPIS_28))
  ok('telefon, týden: svátky týdne celým názvem nad lidmi', text(tydenM.match(/<section class="ds-svatky-obdobi"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '') === `28. 10. ${NAZEV_28} obchody zavřené`)

  const moje = renderToStaticMarkup(
    createElement(pohledy.MojeSmeny, {
      dnes: '2026-10-27', moje: [SMENA], ctx, rozsah: 'firma', zalozka: 'kalendar', den: '2026-10-15', vybranyDen: '2026-10-28', smiVidetTym: false,
      onOtevritSmenu: nic, onTym: nic, onKalendar: nic, onVybratDen: nic, onMesic: nic,
    }),
  )
  const mojeBunky = sSvatkem(moje).filter((z) => z.includes('ds-sm-mesic-den'))
  ok('telefon, moje směny: v kalendáři šrafa jen u 28. 10. (28. 9. z vedlejšího měsíce ne)', mojeBunky.length === 1 && mojeBunky[0].includes(POPIS_28))
  ok('telefon, moje směny: karta vybraného dne nese krátký název', moje.includes('ds-sm-karta-den') && /class="ds-sm-karta-den"[\s\S]*Vznik Československa/.test(moje))
}

// --- celý RozpisView: prochází země až do pohledů Měsíc a Den? ----------
{
  globalThis.__rHledani = ''
  const NAVIGACE = js(
    'export function useRouter() { return { push() {}, refresh() {}, replace() {} } }\n' +
      'export function useSearchParams() { return new URLSearchParams(globalThis.__rHledani) }\n' +
      'export function usePathname() { return "/firma/smeny" }\n',
  )
  const pojmenovane = (...jmena) => js(jmena.map((j) => `export function ${j}() { return null }\n`).join('') + 'export default function Nic() { return null }\n')
  const rozpis = await nactiModul('app/[rozsah]/smeny/rozpis.tsx', [
    ['next/link', ODKAZ],
    ['next/navigation', NAVIGACE],
    ['./formular-smeny', NIC],
    ['../nastaveni/nahrani/rozpis/pruvodce', NIC],
    ['@/components/ui/Drawer', NIC],
    ['@/components/ui/DropdownMenu', NIC],
    // Telefon se kreslí skutečný; jen detail a filtry (otevírají se až klepnutím) jsou nic.
    ['./detail', NIC],
    ['./filtry', NIC],
    ['./desktop/vydani', pojmenovane('KontrolaVydani', 'PruhVydani')],
    ['./desktop/panel-ke-smene', NIC],
    ['./zprava-vydani', NIC],
  ])
  const vykreslit = (hledani, zeme = 'CZ') => {
    globalThis.__rHledani = hledani
    return renderToStaticMarkup(
      createElement(rozpis.default, {
        smeny: [], dnesni: '2026-10-27', dayStartsAt: '05:00', jmena: new Map(), barvy: new Map(), pozice: new Map(), domovskeUseky: new Map(),
        nazvyUseku: new Map(), nazvyPobocek: new Map([[B, VETVE[0].name]]), rozsah: { level: 'branch', branchId: B, branchName: VETVE[0].name },
        planovani: null, mobil: { mojeSmeny: [], okno: { od: '2026-09-28', do: '2026-11-08' }, maSve: false, tvurci: new Map(), rozsah: 'bernard-bar' },
        poziceLidi: new Map(), zrusene: [], potvrzeni: null, vydani: null, hoste: null, zemeSvatku: zeme,
      }),
    )
  }
  /** RozpisView kreslí telefon i počítač; kontroly počítače se dívají jen na počítač. */
  const pocitac = (html) => html.slice(html.indexOf('class="ds-sm-jen-desktop'))
  const telefon = (html) => html.slice(0, html.indexOf('class="ds-sm-jen-desktop'))
  const mesic = pocitac(vykreslit('pohled=mesic&den=2026-10-15'))
  const mesicBunky = sSvatkem(mesic).filter((z) => z.includes('ds-smd-mesic-den'))
  ok('Rozpis měsíc (celý RozpisView): šrafa u jednoho dne, krátký název a seznam svátků měsíce', mesicBunky.length === 1 && mesic.includes('Vznik Československa') &&
    text(mesic.match(/<section class="ds-svatky-obdobi"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '') === `28. 10. ${NAZEV_28} obchody zavřené`)
  ok('Rozpis týden (celý RozpisView): země dojde až do mřížky', sSvatkem(pocitac(vykreslit('pohled=tyden&den=2026-10-27'))).some((z) => z.includes('ds-smd-den')))
  const den = pocitac(vykreslit('pohled=den&den=2026-10-28'))
  ok('Rozpis den (celý RozpisView): pruh svátku nad časovou osou', text(den.match(/<p class="ds-svatek-pruh"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '') === `Státní svátek ${NAZEV_28} obchody zavřené`)
  ok('Rozpis den 27. 10.: pruh není', !pocitac(vykreslit('pohled=den&den=2026-10-27')).includes('ds-svatek-pruh'))
  // Bez práva plánovat je telefon v „Moje směny → Nadcházející“: sedm dní od dneška, 28. 10. mezi nimi.
  const mobil = telefon(vykreslit('pohled=den&den=2026-10-27'))
  ok('telefon (celý RozpisView): země dojde do mobilních pohledů — 28. 10. v Nadcházejících nese svátek',
    mobil.includes('ds-sm-karty') && /<span class="ds-sm-karta-den"><b>Zítra<\/b><span>St 28\. října<\/span><span class="ds-svatek"[^>]*><span class="ds-svatek-nazev"><span aria-hidden="true">Vznik Československa</.test(mobil))
  ok('Rozpis (celý RozpisView) se zemí null: žádný svátek v žádném pohledu',
    ['pohled=mesic&den=2026-10-15', 'pohled=tyden&den=2026-10-27', 'pohled=den&den=2026-10-28'].every((h) => !vykreslit(h, null).includes('ds-svatek')))
}

console.log(chyb ? `\n${chyb} kontrol NEPROŠLO\n` : '\nVšechny kontroly prošly.\n')
process.exit(chyb ? 1 : 0)
