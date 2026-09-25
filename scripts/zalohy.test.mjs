#!/usr/bin/env node
/**
 * Zálohy — nabídka „Komu“ při pozastavení.
 *
 * Pusť `node scripts/zalohy.test.mjs` (starší Node: s `--experimental-strip-types`).
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE FORMULÁŘ
 *
 * Zadání říká, že pozastavený člověk ZMIZÍ Z NABÍDKY. To se dá ověřit
 * dvěma způsoby: přečíst si funkci, která filtruje, nebo se podívat, co
 * je opravdu v rozbalovátku. To první ověřuje záměr — a přesně tak se
 * u QR na kiosku stalo, že kontrola prošla nad kódem, který nefungoval.
 *
 * Proto se tady VYKRESLÍ SKUTEČNÝ FORMULÁŘ (`app/[rozsah]/dochazka/
 * zalohy/formular.tsx`) a přečtou se z hotového HTML všechny `<option>`.
 *
 * Od 24. 9. 2026 jsou Zálohy záložkou Docházky (/dochazka/zalohy).
 * Cesty v tomhle souboru jsou proto ty nové — a na konci se ověří, že
 * stará složka opravdu zmizela. Jinak by kontrola mohla tiše číst
 * soubor, který obrazovka už nepoužívá.
 *
 * Serverová akce se při vykreslení nahrazuje prázdnou funkcí: modul
 * `./akce` má `'use server'` a tahá `@/lib/supabase/server`, což mimo
 * Next spadne. Nevykresluje se z ní nic — do HTML jde jen `<form>`.
 *
 * ---------------------------------------------------------------------
 * ČEHO SE TÍM NEDOSÁHNE
 *
 * Že odmítnutí drží, tohle neověří. To hlídá databáze
 * (`vyplatit_zalohu` → `app.zalohy_pozastavene`) a scénář
 * `supabase/tests/krok10_scenar.sql`. Tady jde jen o to, že obrazovka
 * nenabízí, co stejně neprojde.
 *
 * ---------------------------------------------------------------------
 * POTVRZENÍ ZÁLOHY (25. 9. 2026) — od oddílu „Karta na Docházce" níž
 *
 * Zadání majitele: příjemce potvrdí zálohu ve svém telefonu, majitel ji
 * umí potvrdit za kohokoli, vydávající dostane zprávu. Ověřuje se tu, co
 * je vidět a co se volá:
 *   * karta „Máte nepotvrzenou zálohu" se VYKRESLÍ a nese formulář
 *     s id zálohy a tlačítkem; Docházka ji opravdu kreslí a data bere
 *     z `moje_nepotvrzene_zalohy`;
 *   * STRÁNKA Zálohy se vykreslí s podstrčenou databází: tlačítko
 *     „Potvrdit za zaměstnance" jen majiteli, jen u nepotvrzené a jen
 *     když databáze novou funkci zná;
 *   * serverové akce volají správná RPC se správnými parametry, push
 *     hned plánují až PO úspěchu a s id z DATABÁZE; ne-majiteli akce
 *     za zaměstnance databázi vůbec nezavolá;
 *   * věty upozornění: nadpis (a tedy push přes cizí službu) nenese
 *     částku ani jméno;
 *   * jména funkcí, parametrů a sloupců sedí s migrací.
 * Že databáze cizí zálohu odmítne, hlídá scénář krok60, ne tohle.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { slozitPush } from '../lib/komunikace/push-zprava.ts'
import { nabidkaKVyplaceni } from '../lib/zalohy-nabidka.ts'
import { veta } from '../lib/sklonovani.ts'
import {
  nadpisUpozorneni,
  obdobiRozpisu,
  odkazNaZalohu,
  popisZalohy,
} from '../lib/upozorneni-text.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)

/** Prázdná serverová akce — do vykresleného HTML z ní nejde nic. */
const STUB_AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function vyplatitZaloh' + 'u() { return { stav: "nic" } }')

const FormularZalohy = await nactiKomponentu('app/[rozsah]/dochazka/zalohy/formular.tsx', [
  ['./akce', STUB_AKCE],
])

/** Vykreslí formulář a vrátí jména v rozbalovátku „Komu“. */
function nabidkaNaObrazovce(lide) {
  const html = renderToStaticMarkup(
    createElement(FormularZalohy, { rozsah: 'cerna-perla', lide }),
  )
  return [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .filter((m) => m[1] !== '')
    .map((m) => m[2])
}

/* --- data ----------------------------------------------------------- */

const LIDE = [
  { id: 'e1', jmeno: 'Marek Dvořák' },
  { id: 'e2', jmeno: 'Jana Nováková' },
  { id: 'e3', jmeno: 'Petr Sedlák' },
]

const POZASTAVENI = [
  { employee_id: 'e1', pozastaveno: false },
  { employee_id: 'e2', pozastaveno: true },
  { employee_id: 'e3', pozastaveno: false },
]

console.log('\n== Pozastavený z nabídky zmizí ==')

const bezni = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: POZASTAVENI,
  firmaPozastavena: false,
})

const naObrazovce = nabidkaNaObrazovce(bezni.nabidka)

ma('v rozbalovátku jsou dva lidé', naObrazovce.length, 2)
ma('pozastavená v něm NENÍ', naObrazovce.includes('Jana Nováková'), false)
ma('ostatní ano', naObrazovce.join(' · '), 'Marek Dvořák · Petr Sedlák')
ma('a je vidět, že někdo chybí', bezni.skrytych, 1)

console.log('\n== A že to umí spadnout ==')
// Kdyby filtr nedělal nic, tenhle řádek by prošel taky — proto se
// vykreslí i nefiltrovaný seznam a ověří se, že v něm ta osoba JE.
ma('nefiltrovaný seznam ji obsahuje', nabidkaNaObrazovce(LIDE).includes('Jana Nováková'), true)

console.log('\n== Vypnuto za firmu: neprojde nikomu ==')

const zaFirmu = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: POZASTAVENI,
  firmaPozastavena: true,
})
ma('nabídka je prázdná, i když dva pozastavené nemají', zaFirmu.nabidka.length, 0)
ma('a schovaní jsou všichni', zaFirmu.skrytych, 3)
ma('v rozbalovátku nezůstal nikdo', nabidkaNaObrazovce(zaFirmu.nabidka).length, 0)

console.log('\n== Nikdo pozastavený: nabídka se nezmenší ==')

const nikdo = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: LIDE.map((l) => ({ employee_id: l.id, pozastaveno: false })),
  firmaPozastavena: false,
})
ma('všichni tři', nikdo.nabidka.length, 3)
ma('nikdo neschovaný', nikdo.skrytych, 0)

// Člověk, o kterém průzor mlčí (jiná pobočka, chybějící řádek), se
// nemá tiše ztratit — pozastavený je jen ten, o kom to víme.
const chybejici = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: [{ employee_id: 'e1', pozastaveno: true }],
  firmaPozastavena: false,
})
ma('o kom průzor mlčí, ten v nabídce zůstane', chybejici.nabidka.length, 2)

console.log('\n== Věta pod formulářem se ohýbá ==')

/*
  Tři tvary, ne dva. U pěti a víc se čeština vrací k jednotnému číslu
  přísudku — „5 zaměstnanců NENÍ v nabídce“.
*/
const vetaProPocet = (n) =>
  veta(
    n,
    'zaměstnanec není v nabídce, protože má pozastavené zálohy.',
    'zaměstnanci nejsou v nabídce, protože mají pozastavené zálohy.',
    'zaměstnanců není v nabídce, protože mají pozastavené zálohy.',
  )

ma('jeden', vetaProPocet(1), '1 zaměstnanec není v nabídce, protože má pozastavené zálohy.')
ma('tři', vetaProPocet(3), '3 zaměstnanci nejsou v nabídce, protože mají pozastavené zálohy.')
ma('pět', vetaProPocet(5), '5 zaměstnanců není v nabídce, protože mají pozastavené zálohy.')

console.log('\n== Stránka tu funkci opravdu volá ==')

/*
  Bez tohohle řádku by kontrola ověřovala funkci, kterou obrazovka
  nepoužívá — a to je přesně ta chyba, kvůli které se QR na kiosku
  vydalo rozbité.
*/
const stranka = fs.readFileSync(
  new URL('app/[rozsah]/dochazka/zalohy/page.tsx', KOREN),
  'utf8',
)
ma('page.tsx volá nabidkaKVyplaceni', stranka.includes('nabidkaKVyplaceni({'), true)
ma('a formuláři předává filtrovaný seznam',
  stranka.includes('lide={lideKVyplaceni.map('), true)
ma('nefiltrovaný seznam už formuláři nedává',
  stranka.includes('lide={lide.map('), false)

/*
  24. 9. 2026: „u zaměstnanců, kteří na to mají práva, mi nejdou
  vyplácet zálohy". Nabídka se brala z průzoru pro RUČNÍ ZÁPIS DOCHÁZKY
  (brána attendance.manage) — kdo měl jen advances.manage, viděl prázdno.
  A výplata se účtovala na domovskou pobočku, takže člověk bez ní
  (a zaskakující) zálohu nedostal.
*/
console.log('\n== Kdo má právo na zálohy, může vyplácet ==')
ma('nabídka „Komu" je z průzoru pro zálohy, ne pro ruční docházku',
  /await lideProZalohy\(tenantId, pobockaVydeje, denVydeje\)/.test(stranka) && !/lideProPobocku\(/.test(stranka), true)
const lide = fs.readFileSync(new URL('lib/lide-pobocky.ts', KOREN), 'utf8')
ma('… a ten průzor je lide_pro_zalohy', /rpc\('lide_pro_zalohy'/.test(lide), true)
ma('… lidé bez pobočky mají v nabídce své označení', /bez pobočky/.test(lide), true)
const akceZaloh = fs.readFileSync(new URL('app/[rozsah]/dochazka/zalohy/akce.ts', KOREN), 'utf8')
ma('výplata posílá pobočku VÝDEJE z ověřeného rozsahu (ne z formuláře)',
  /const pobocka = pristup\.scope\.branchId/.test(akceZaloh) && /p_branch: pobocka/.test(akceZaloh) &&
    !/formData\.get\('pobocka'\)|formData\.get\('branch/.test(akceZaloh), true)
/*
  Nabídka a výplata musí brát STEJNÉ okno směn — jinak nabídka ukáže
  člověka, kterému výplata odmítne („nepracuje"), a to je přesně ten
  rozchod, kvůli kterému hlášení vzniklo.
*/
const migraceZaloh = fs.readFileSync(
  new URL('supabase/migrations/20260924120000_zalohy_vyplaceni_na_pobocce.sql', KOREN), 'utf8')
const oknoVyplaty = migraceZaloh.match(/patri_k_zaloze\(p_tenant, v_branch, v_den - (\d+), v_den \+ (\d+)\)/)
const oknoNabidky = lide.slice(lide.indexOf('export async function lideProZalohy')).match(/okno = (\d+)/)
ma('okno směn: výplata (±N v migraci) = nabídka (okno v lideProZalohy)',
  Boolean(oknoVyplaty && oknoNabidky) && oknoVyplaty[1] === oknoVyplaty[2] && oknoVyplaty[1] === oknoNabidky[1], true)
ma('do nasazení migrace se volá postaru (bez p_branch)',
  /funkceNeexistuje\(error\)\) \{\s*;\(\{ data, error \} = await supabase\.rpc\('vyplatit_zalohu', \{\s*p_tenant: tenantId,\s*p_employee: zamestnanec,\s*p_castka: halere,\s*p_poznamka: poznamka,\s*\}\)\)/.test(akceZaloh), true)

console.log('\n== Kontroluje se živý soubor, ne mrtvý ==')

/*
  Obrazovka se 24. 9. přestěhovala pod Docházku. Kdyby stará složka
  zůstala ležet, obě kontroly výš by mohly procházet nad souborem, který
  nikdo nevykresluje — a přestěhovaná stránka by byla bez dozoru.
*/
ma('stará app/[rozsah]/zalohy/ už neexistuje',
  fs.existsSync(new URL('app/[rozsah]/zalohy', KOREN)), false)
ma('formulář je vedle přestěhované stránky',
  fs.existsSync(new URL('app/[rozsah]/dochazka/zalohy/formular.tsx', KOREN)), true)
ma('a stránka ho opravdu vykresluje',
  stranka.includes("import FormularZalohy from './formular'") && stranka.includes('<FormularZalohy'), true)

/* ======================================================================
   POTVRZENÍ ZÁLOHY (25. 9. 2026)
   ====================================================================== */

const REACT = JSON.stringify(import.meta.resolve('react'))
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

/** Odkaz mimo Next: obyčejné <a>. */
const ODKAZ = js(
  `import { createElement } from ${REACT}\n` +
    'export default function Link({ href, children, ...z }) {\n' +
    '  return createElement("a", { href, ...z }, children)\n' +
    '}\n',
)
const NAVIGACE = js(
  'export function redirect(adresa) { throw Object.assign(new Error("NEXT_REDIRECT"), { adresa }) }\n' +
    'export function notFound() { throw new Error("NEXT_NOT_FOUND") }\n',
)

/** Text z HTML: bez značek, pevné mezery na obyčejné. */
const text = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim()

const migrace60 = fs.readFileSync(
  new URL('supabase/migrations/20260925100000_zalohy_potvrzeni.sql', KOREN), 'utf8')

console.log('\n== Karta na Docházce: „Máte nepotvrzenou zálohu" ==')

const ZalohyKPotvrzeni = await nactiKomponentu('app/[rozsah]/dochazka/zalohy-k-potvrzeni.tsx', [
  ['next/link', ODKAZ],
])

/*
  Řádky mají PŘESNĚ sloupce funkce z migrace (kontrola níž) — kdyby se
  sloupec v databázi jmenoval jinak, karta by tiše ukázala prázdno.
*/
const MOJE = [
  { id: 'z-a', castka_haleru: 150000, business_date: '2026-09-25', vyplaceno_kdy: '2026-09-25T10:00:00Z', vydal: 'Petra Šedesát', pobocka: 'Černá Perla' },
  { id: 'z-b', castka_haleru: 20000, business_date: '2026-09-24', vyplaceno_kdy: '2026-09-24T10:00:00Z', vydal: null, pobocka: 'Bar' },
]
const karta = renderToStaticMarkup(
  createElement(ZalohyKPotvrzeni, { zalohy: MOJE, rozsah: 'cerna-perla', akce: async () => {} }),
)
const formulare = [...karta.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0])
ma('dvě nepotvrzené = dvě karty, každá s vlastním formulářem', formulare.length, 2)
ma('formulář nese id SVÉ zálohy', /name="zaloha" value="z-a"/.test(formulare[0] ?? '') && /name="zaloha" value="z-b"/.test(formulare[1] ?? ''), true)
ma('… a rozsah, kam se vrátit', formulare.every((f) => /name="rozsah" value="cerna-perla"/.test(f)), true)
ma('tlačítko „Potvrdit, že jsem ji dostal/a"', formulare.every((f) => text(f).includes('Potvrdit, že jsem ji dostal/a')), true)
ma('částka je vidět (patkové číslo karty)', /ds-kpi-hodnota[^>]*>1 500 Kč</.test(karta.replace(/[\u00a0\u202f]/g, ' ')), true)
ma('i kdo ji vydal a kde', text(karta).includes('Vydal(a) Petra Šedesát') && text(karta).includes('Černá Perla'), true)
ma('bez jména vydávajícího se nic nevymýšlí', !/Vydal\(a\)\s*·/.test(text(karta)) && (text(karta).match(/Vydal\(a\)/g) ?? []).length, 1)
ma('ikona ze sdílené sady, žádné vlastní SVG navíc', (karta.match(/<svg/g) ?? []).length, 2)
ma('bez nepotvrzených se nekreslí nic',
  renderToStaticMarkup(createElement(ZalohyKPotvrzeni, { zalohy: [], rozsah: 'cerna-perla', akce: async () => {} })), '')

const dochazka = fs.readFileSync(new URL('app/[rozsah]/dochazka/page.tsx', KOREN), 'utf8')
ma('Docházka se ptá databáze na MOJE nepotvrzené',
  /rpc\(\s*"moje_nepotvrzene_zalohy",\s*\{ p_tenant: tenantId \}/.test(dochazka), true)
ma('… a kartu opravdu kreslí s akcí potvrzení v telefonu',
  /<ZalohyKPotvrzeni\s+zalohy=\{zalohyKPotvrzeni\}\s+rozsah=\{rozsah\}\s+akce=\{potvrditMojiZalohu\}/.test(dochazka), true)
ma('… a potvrzovací akci bere ze záloh (ne vlastní kopii)',
  dochazka.includes('import { potvrditMojiZalohu } from "./zalohy/akce";'), true)
ma('nenasazená funkce kartu jen schová, jiná chyba stránku shodí',
  /if \(chybaZaloh && !funkceNeexistuje\(chybaZaloh\)\) \{\s*throw new DotazSelhal/.test(dochazka), true)

console.log('\n== Stránka Zálohy: „Potvrdit za zaměstnance" jen majiteli ==')

globalThis.__zalohy = null
const AUTHZ = js(
  'export async function getContext() { return globalThis.__zalohy.ctx }\n' +
    'export async function hasAccess(t, pravo, pobocka) {\n' +
    '  return globalThis.__zalohy.prava.includes(pravo)\n' +
    '}\n',
)
const FIRMA = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export function bezpecnyRozsah() { return { level: "branch", branchId: "b1", branchName: "Černá Perla", branchSlug: "cerna-perla" } }\n' +
    'export async function zkusPristup(t, pravo) {\n' +
    '  return globalThis.__zalohy.prava.includes(pravo)\n' +
    '    ? { stav: "ok", ctx: globalThis.__zalohy.ctx, scope: { level: "branch", branchId: "b1" } }\n' +
    '    : { stav: "odepren" }\n' +
    '}\n',
)
const LIDE_STUB = js(
  'export async function lideProZalohy() { return [] }\n' +
    'export function jmenoDoNabidky(c) { return c.jmeno }\n',
)
const PROVOZNI_DEN = js('export async function provozniDen() { return "2026-09-25" }\n')
const DOTAZ = js(
  'export function funkceNeexistuje(c) { return c?.code === "PGRST202" }\n' +
    'export function sloupecNeexistuje() { return false }\n' +
    'export function tabulkaNeexistuje() { return false }\n',
)
const SERVER = js(
  'export async function getServerSupabase() {\n' +
    '  return {\n' +
    '    rpc: async (jmeno) => {\n' +
    '      if (jmeno === "zalohy_pobocky") return { data: globalThis.__zalohy.radky, error: null }\n' +
    '      return { data: [], error: null }\n' +
    '    },\n' +
    '    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),\n' +
    '  }\n' +
    '}\n',
)
const ZALOZKY_PRAVA = js('export default async function zalozkyDochazky() { return ["dochazka", "zalohy"] }\n')
const AKCE_ZALOH = js(
  'export async function vyplatitZalohu() { return { stav: "nic" } }\n' +
    'export async function stornovatZalohu() {}\n' +
    'export async function potvrditZaZamestnance() {}\n' +
    'export async function prepnoutPozastaveni() {}\n' +
    'export async function ulozitNastaveniZaloh() {}\n',
)

const StrankaZaloh = await nactiKomponentu('app/[rozsah]/dochazka/zalohy/page.tsx', [
  ['next/navigation', NAVIGACE],
  ['next/link', ODKAZ],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/lide-pobocky', LIDE_STUB],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SERVER],
  ['../zalozky-prava', ZALOZKY_PRAVA],
  ['./akce', AKCE_ZALOH],
])

const radekZalohy = (id, stav, jak) => ({
  id, employee_id: 'e-' + id, jmeno: 'Radek ' + id, branch_id: 'b1', castka_haleru: 60000,
  business_date: '2026-09-25', stav, poznamka: '', storno_duvod: stav === 'stornovana' ? 'překlep' : null,
  vyplaceno_kdy: '2026-09-25T10:00:00Z', potvrzeno_kdy: stav === 'potvrzena' ? '2026-09-25T11:00:00Z' : null,
  ...(jak === undefined ? {} : { potvrzeno_jak: jak }),
})
const RADKY = [
  radekZalohy('n1', 'nepotvrzena', null),
  radekZalohy('p1', 'potvrzena', 'majitel'),
  radekZalohy('p2', 'potvrzena', 'telefon'),
  radekZalohy('s1', 'stornovana', null),
]

async function strankaZaloh({ jeMajitel, prava, radky = RADKY, ulozeno }) {
  globalThis.__zalohy = { ctx: { jeMajitel, branches: [] }, prava, radky }
  const prvek = await StrankaZaloh({
    params: Promise.resolve({ rozsah: 'cerna-perla' }),
    searchParams: Promise.resolve(ulozeno ? { ulozeno } : {}),
  })
  return renderToStaticMarkup(prvek)
}
const pocetTlacitek = (html, napis) => (text(html).match(new RegExp(napis, 'g')) ?? []).length

const majitel = await strankaZaloh({ jeMajitel: true, prava: ['advances.manage', 'payroll.read', 'settings.manage', 'payroll.manage'] })
ma('majitel: „Potvrdit za zaměstnance" u JEDINÉ nepotvrzené', pocetTlacitek(majitel, 'Potvrdit za zaměstnance'), 1)
ma('… v řádku té nepotvrzené (Radek n1)',
  /Radek n1[\s\S]*?Potvrdit za zaměstnance[\s\S]*?Radek p1/.test(text(majitel)), true)
ma('majitel: storno zůstává u nestornovaných (3)', pocetTlacitek(majitel, 'Stornovat'), 3)
ma('potvrzená majitelem je tak i popsaná', /potvrzená potvrdil majitel/.test(text(majitel)), true)
ma('potvrzená v telefonu taky', /potvrzená v telefonu/.test(text(majitel)), true)
ma('nepotvrzená „čeká na potvrzení" (ne „čeká na PIN")',
  text(majitel).includes('čeká na potvrzení') && !text(majitel).includes('čeká na PIN'), true)

const vydavajici = await strankaZaloh({ jeMajitel: false, prava: ['advances.manage'] })
ma('vydávající s advances.manage (ne majitel): tlačítko NENÍ', pocetTlacitek(vydavajici, 'Potvrdit za zaměstnance'), 0)
ma('… ale storno ano (důkaz, že se sloupec akcí kreslí)', pocetTlacitek(vydavajici, 'Stornovat'), 3)

const mzdar = await strankaZaloh({ jeMajitel: false, prava: ['payroll.read'] })
ma('jen payroll.read: žádné tlačítko ani sloupec Akce',
  pocetTlacitek(mzdar, 'Potvrdit za zaměstnance') === 0 && !text(mzdar).includes('Akce') && text(mzdar).includes('Radek n1'), true)

const majitelMzdy = await strankaZaloh({ jeMajitel: true, prava: ['payroll.read'] })
ma('majitel i bez advances.manage v rozsahu tlačítko má (sloupec Akce se kreslí)',
  pocetTlacitek(majitelMzdy, 'Potvrdit za zaměstnance'), 1)
ma('… ale storno ne (to je advances.manage)', pocetTlacitek(majitelMzdy, 'Stornovat'), 0)

const nenasazeno = await strankaZaloh({
  jeMajitel: true, prava: ['advances.manage'],
  radky: RADKY.map((r) => {
    const bez = { ...r }
    delete bez.potvrzeno_jak
    return bez
  }),
})
ma('nenasazená migrace (řádek bez potvrzeno_jak): tlačítko se nekreslí',
  pocetTlacitek(nenasazeno, 'Potvrdit za zaměstnance'), 0)
ma('… a stránka se vykreslí dál', text(nenasazeno).includes('Radek n1'), true)

ma('po potvrzení majitelem hláška',
  text(await strankaZaloh({ jeMajitel: true, prava: ['advances.manage'], ulozeno: 'potvrzeno' }))
    .includes('Záloha potvrzená za zaměstnance'), true)

console.log('\n== Serverové akce: správné RPC, push hned až po úspěchu ==')

globalThis.__akce = null
const CACHE_A = js('export function revalidatePath(c) { globalThis.__akce.cesty.push(c) }')
const AUTHZ_A = js('export async function getContext() { return globalThis.__akce.ctx }\n')
const FIRMA_A = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export async function zkusPristup() { return { stav: "ok", ctx: {}, scope: { branchId: "b1" } } }\n',
)
const PUSH_A = js('export function naplanovatPushKeZdroji(zdroj, firma) { globalThis.__akce.push.push([zdroj, firma]) }\n')
const DOTAZ_A = js('export function funkceNeexistuje(e) { return e?.code === "PGRST202" }\n')
const SERVER_A = js(
  'export async function getServerSupabase() {\n' +
    '  return {\n' +
    '    rpc: async (jmeno, args) => { globalThis.__akce.rpc.push([jmeno, args]); return globalThis.__akce.odpoved(jmeno) },\n' +
    '    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Radek" } }) }) }) }),\n' +
    '  }\n' +
    '}\n',
)
const akce = await nactiModul('app/[rozsah]/dochazka/zalohy/akce.ts', [
  ['next/cache', CACHE_A],
  ['next/navigation', NAVIGACE],
  ['@/lib/authz', AUTHZ_A],
  ['@/lib/firma', FIRMA_A],
  ['@/lib/komunikace/push-hned', PUSH_A],
  ['@/lib/mzdy', new URL('lib/mzdy.ts', KOREN).href],
  ['@/lib/supabase/dotaz', DOTAZ_A],
  ['@/lib/supabase/server', SERVER_A],
])

/** Spustí akci; vrátí, kam přesměrovala, co volala a co naplánovala. */
async function spustit(fn, pole, { ctx = null, odpoved = () => ({ data: 'z-z-databaze', error: null }) } = {}) {
  globalThis.__akce = { ctx, odpoved, rpc: [], push: [], cesty: [] }
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', ...pole })) fd.set(k, v)
  let adresa = null
  try {
    await fn(fd)
  } catch (e) {
    adresa = e.adresa ?? String(e)
  }
  return { adresa, ...globalThis.__akce }
}
const CHYBA_DB = () => ({ data: null, error: { code: 'P0002', message: 'Takovou zálohu tu nemáte.' } })

const telefon = await spustit(akce.potvrditMojiZalohu, { zaloha: 'z-z-formulare' })
ma('telefon: volá potvrdit_moji_zalohu s firmou a zálohou z formuláře',
  JSON.stringify(telefon.rpc), JSON.stringify([['potvrdit_moji_zalohu', { p_tenant: 't1', p_zaloha: 'z-z-formulare' }]]))
ma('… push hned se zdrojem ZÁLOHA a s id z DATABÁZE, ne z formuláře',
  JSON.stringify(telefon.push), JSON.stringify([[{ typ: 'zaloha', id: 'z-z-databaze' }, 't1']]))
ma('… zpět na Docházku s hláškou', telefon.adresa, '/cerna-perla/dochazka?zaloha=potvrzena')
ma('… a Docházku obnoví', telefon.cesty.includes('/cerna-perla/dochazka'), true)

const telefonChyba = await spustit(akce.potvrditMojiZalohu, { zaloha: 'z1' }, { odpoved: CHYBA_DB })
ma('telefon, databáze odmítla: ŽÁDNÝ push', telefonChyba.push.length, 0)
ma('… a hláška databáze do adresy (vlastní klíč, ne chyba=)',
  telefonChyba.adresa, '/cerna-perla/dochazka?zaloha=chyba&duvod=' + encodeURIComponent('Takovou zálohu tu nemáte.'))

const nemajitel = await spustit(akce.potvrditZaZamestnance, { zaloha: 'z1' }, { ctx: { jeMajitel: false } })
ma('za zaměstnance, NE-majitel: databáze se vůbec nezeptá', nemajitel.rpc.length, 0)
ma('… žádný push', nemajitel.push.length, 0)
ma('… zpět se „smí jen majitel"', /\?chyba=.*majitel/.test(decodeURIComponent(nemajitel.adresa ?? '')), true)

const bezKontextu = await spustit(akce.potvrditZaZamestnance, { zaloha: 'z1' }, { ctx: null })
ma('za zaměstnance bez kontextu (spadlé spojení): taky ne', bezKontextu.rpc.length, 0)

const zaMajitele = await spustit(akce.potvrditZaZamestnance, { zaloha: 'z-z-formulare' }, { ctx: { jeMajitel: true } })
ma('majitel: volá potvrdit_zalohu_za_zamestnance',
  JSON.stringify(zaMajitele.rpc), JSON.stringify([['potvrdit_zalohu_za_zamestnance', { p_tenant: 't1', p_zaloha: 'z-z-formulare' }]]))
ma('… push hned s id z databáze', JSON.stringify(zaMajitele.push), JSON.stringify([[{ typ: 'zaloha', id: 'z-z-databaze' }, 't1']]))
ma('… zpět na Zálohy s hláškou', zaMajitele.adresa, '/cerna-perla/dochazka/zalohy?ulozeno=potvrzeno')

const zaMajiteleChyba = await spustit(akce.potvrditZaZamestnance, { zaloha: 'z1' }, { ctx: { jeMajitel: true }, odpoved: CHYBA_DB })
ma('majitel, databáze odmítla: žádný push', zaMajiteleChyba.push.length, 0)

async function vyplatit(odpoved) {
  globalThis.__akce = { ctx: null, odpoved, rpc: [], push: [], cesty: [] }
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', zamestnanec: 'e1', castka: '500' })) fd.set(k, v)
  const vysledek = await akce.vyplatitZalohu({ stav: 'nic' }, fd)
  return { vysledek, ...globalThis.__akce }
}
const vyplata = await vyplatit(() => ({ data: [{ zaloha: 'z-vyplacena', varovani: null }], error: null }))
ma('výplata: push hned příjemci se zdrojem záloha/id z databáze',
  JSON.stringify(vyplata.push), JSON.stringify([[{ typ: 'zaloha', id: 'z-vyplacena' }, 't1']]))
ma('… a výplata projde jako dřív', vyplata.vysledek.stav, 'hotovo')
const vyplataChyba = await vyplatit(() => ({ data: null, error: { code: '42501', message: 'Vyplácet zálohy smí jen…' } }))
ma('výplata odmítnutá: žádný push', vyplataChyba.push.length === 0 && vyplataChyba.vysledek.stav === 'chyba', true)

console.log('\n== Upozornění: nadpis (a push) bez částky a jména ==')

const TELO = { castka_haleru: 150000, zaloha: 'z1', den: '2026-09-25', jmeno: 'Radek Šedesát', jak: 'pin' }
for (const druh of ['zaloha.vyplacena', 'zaloha.potvrzena', 'zaloha.potvrzena_za_vas']) {
  const nadpis = nadpisUpozorneni(druh, TELO, obdobiRozpisu)
  const push = slozitPush({ typ: 'jedna', pocet: 1, druh, telo: TELO, priorita: 'normal' })
  ma(`${druh}: má vlastní nadpis (ne obecné „Upozornění")`, nadpis !== 'Upozornění' && nadpis.length > 0, true)
  ma(`${druh}: push nenese částku ani jméno`, /\d|Radek/.test(push.body + push.title), false)
}
ma('výzva vede do Docházky (tam je karta s tlačítkem)', odkazNaZalohu('cerna-perla', 'zaloha.vyplacena')?.href, '/cerna-perla/dochazka')
ma('potvrzení vydávajícímu vede do Záloh', odkazNaZalohu('cerna-perla', 'zaloha.potvrzena')?.href, '/cerna-perla/dochazka/zalohy')
ma('„za vás" nikam nevede (není co udělat)', odkazNaZalohu('cerna-perla', 'zaloha.potvrzena_za_vas'), null)
ma('věta vydávajícímu: kdo, kolik a jak',
  popisZalohy('zaloha.potvrzena', TELO).replace(/[\u00a0\u202f]/g, ' '), 'Radek Šedesát: 1 500 Kč (pátek 25. 9.), potvrzeno PINem na tabletu.')
ma('věta příjemci: kolik a kde potvrdit',
  popisZalohy('zaloha.vyplacena', TELO).replace(/[\u00a0\u202f]/g, ' ').startsWith('1 500 Kč (pátek 25. 9.). Potvrďte v Docházce'), true)
/*
  Obrazovka upozornění se VYKRESLÍ s podstrčenými upozorněními — hledat
  v jejím zdrojáku jméno funkce nestačí: odkaz se dá vyndat a jméno
  funkce v souboru zůstane (zkoušeno schválným rozbitím).
*/
globalThis.__upozorneni = null
const AUTHZ_U = js('export async function getUser() { return { id: "u1", email: null, phone: null } }\n')
const FIRMA_U = js('export async function getCurrentTenantId() { return "t1" }\n')
const DOTAZ_U = js(
  'export function sloupecNeexistuje() { return false }\n' +
    'export function tabulkaNeexistuje() { return false }\n',
)
const SERVER_U = js(
  'export async function getServerSupabase() {\n' +
    '  const dotaz = { select: () => dotaz, eq: () => dotaz, order: () => dotaz,\n' +
    '    limit: async () => ({ data: globalThis.__upozorneni, error: null }) }\n' +
    '  return { from: () => dotaz }\n' +
    '}\n',
)
const AKCE_U = js('export async function oznacitPrectene() {}\nexport async function potvrditZmenu() {}\n')
const StrankaUpozorneni = await nactiKomponentu('app/[rozsah]/upozorneni/page.tsx', [
  ['next/link', ODKAZ],
  ['next/navigation', NAVIGACE],
  ['@/lib/authz', AUTHZ_U],
  ['@/lib/firma', FIRMA_U],
  ['@/lib/supabase/dotaz', DOTAZ_U],
  ['@/lib/supabase/server', SERVER_U],
  ['./akce', AKCE_U],
])
const upozorneni = (druh) => ({
  id: 'n-' + druh, druh, telo: TELO, created_at: '2026-09-25T10:00:00Z', read_at: null,
  acknowledged_at: null, shift_id: null, priorita: 'normal',
})
globalThis.__upozorneni = ['zaloha.vyplacena', 'zaloha.potvrzena', 'zaloha.potvrzena_za_vas'].map(upozorneni)
const htmlUpozorneni = renderToStaticMarkup(
  await StrankaUpozorneni({ params: Promise.resolve({ rozsah: 'cerna-perla' }) }),
)
const polozka = (druh) => {
  const i = htmlUpozorneni.indexOf(nadpisUpozorneni(druh, TELO, obdobiRozpisu))
  return i < 0 ? '' : htmlUpozorneni.slice(i, htmlUpozorneni.indexOf('</li>', i))
}
ma('upozornění „k potvrzení": věta s částkou a tlačítko do Docházky',
  text(polozka('zaloha.vyplacena')).includes('1 500 Kč') &&
    /href="\/cerna-perla\/dochazka"[^>]*>Potvrdit převzetí</.test(polozka('zaloha.vyplacena')), true)
ma('upozornění „potvrzeno": kdo a jak, odkaz do Záloh',
  text(polozka('zaloha.potvrzena')).includes('Radek Šedesát: 1 500 Kč') &&
    /href="\/cerna-perla\/dochazka\/zalohy"/.test(polozka('zaloha.potvrzena')), true)
ma('upozornění „za vás": věta ano, odkaz ne',
  text(polozka('zaloha.potvrzena_za_vas')).includes('ozvěte se vedení') && !/href=/.test(polozka('zaloha.potvrzena_za_vas')), true)

console.log('\n== Kontrakt s migrací 20260925100000 ==')

/*
  Aplikace a databáze se domlouvají jen jmény. Přejmenovaný parametr by
  skončil na PGRST202 — a ten Docházka schválně promíjí jako „nenasazeno",
  takže by karta tiše zmizela. Proto se jména čtou přímo z migrace.
*/
const jmena = (seznam) => seznam.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
const hlavicka = (fn) => migrace60.match(new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`))
ma('potvrdit_moji_zalohu(p_tenant, p_zaloha)', JSON.stringify(jmena(hlavicka('potvrdit_moji_zalohu')?.[1] ?? '')),
  JSON.stringify(Object.keys(telefon.rpc[0]?.[1] ?? {})))
ma('potvrdit_zalohu_za_zamestnance(p_tenant, p_zaloha)', JSON.stringify(jmena(hlavicka('potvrdit_zalohu_za_zamestnance')?.[1] ?? '')),
  JSON.stringify(Object.keys(zaMajitele.rpc[0]?.[1] ?? {})))
const vystup = migrace60.match(/create function public\.moje_nepotvrzene_zalohy\(p_tenant uuid\)\s*returns table \(([^)]*)\)/)
ma('moje_nepotvrzene_zalohy vrací právě sloupce, které karta čte',
  jmena(vystup?.[1] ?? '').sort().join(','), Object.keys(MOJE[0]).sort().join(','))
ma('zalohy_pobocky vrací potvrzeno_jak (podle něj se kreslí tlačítko)',
  /create function public\.zalohy_pobocky[\s\S]*?returns table \([\s\S]*?potvrzeno_jak text\s*\)/.test(migrace60), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
