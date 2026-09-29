#!/usr/bin/env node
/**
 * Formulář nové/upravované směny.
 *
 *   1. lib/smeny-formular.ts — kdy se nabízí výběr zařazení a které
 *      zařazení se se směnou uloží.
 *   2. lib/vyber-dnu.ts — výběr VÍC DNŮ najednou u nové směny (okno
 *      týdnů, přepínání výběru, souhrn založení).
 *   3. formular-smeny.tsx — přepínač „Víc dní“ se kreslí jen u nové
 *      směny a „Uložit a přidat další den“ zůstává, jak bylo.
 *   4. app/[rozsah]/smeny/smena.ts (`ulozitSmenu`) — s výběrem víc dnů
 *      zavolá RPC `ulozit_smenu` jednou za den, částečný neúspěch se
 *      nespolkne, jednodenní cesta (vč. „Uložit a přidat další den“)
 *      se nezmění.
 *
 * Zadání Šéfíka 29. 9. 2026: „při zadávání směn umožni označit více dní
 * na přidání směny.“
 *
 * Pusť `node scripts/smeny-formular.test.mjs`.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ukazatZarazeni, zarazeniProUlozeni } from '../lib/smeny-formular.ts'
import { barvaSouhrnu, prepnoutDen, souhrnZalozeni, tydnyOkna, TYDNU_MAX, zapnoutVicDni } from '../lib/vyber-dnu.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/* =====================================================================
   1. Kdy se nabízí výběr zařazení / které se uloží (lib/smeny-formular.ts)
   ================================================================== */

console.log('\n== Kdy se nabízí výběr zařazení ==')
je('zapnuto v nastavení: nabízí se, ať je člověk vybraný, nebo ne', [ukazatZarazeni(true, true), ukazatZarazeni(true, false)], [true, true])
je('vypnuto v nastavení a člověk vybraný: schované (zbytečné klikání)', ukazatZarazeni(false, true), false)
je('vypnuto v nastavení, ale neobsazená směna (nikdo vybraný): nabízí se — pozice říká, koho je třeba', ukazatZarazeni(false, false), true)

console.log('\n== Které zařazení se uloží ==')
const u = (prepis) => zarazeniProUlozeni({ ukazano: false, vybrana: 'p-vybrana', poziceZamestnance: 'p-zam', poziceSmeny: '', ...prepis })
je('pole je vidět: uloží se, co je vybráno', zarazeniProUlozeni({ ukazano: true, vybrana: 'p-vybrana', poziceZamestnance: 'p-zam', poziceSmeny: 'p-smena' }), 'p-vybrana')
je('pole je vidět a vybráno „bez zařazení“: uloží se prázdné, ne zařazení zaměstnance', zarazeniProUlozeni({ ukazano: true, vybrana: '', poziceZamestnance: 'p-zam', poziceSmeny: '' }), '')
je('pole je schované, nová směna: zařazení zaměstnance („zařazeni od začátku“)', u({}), 'p-zam')
je('pole je schované, upravovaná směna se stejným člověkem: zařazení směny se nepřepíše', u({ poziceSmeny: 'p-smena' }), 'p-smena')
je('pole je schované, člověk se vyměnil (poziceSmeny prázdné): zařazení nového člověka', u({ poziceSmeny: '' }), 'p-zam')
je('pole je schované a zaměstnanec žádné zařazení nemá: prázdné, ne vybrané z dřívějška', u({ poziceZamestnance: null }), '')
je('pole je schované, zaměstnanec bez zařazení, ale směna ho měla: zůstane', u({ poziceZamestnance: '', poziceSmeny: 'p-smena' }), 'p-smena')
je('schované pole nikdy nevezme staré „vybrana“ (to je viditelné jen když je vidět)', u({ vybrana: 'p-stara', poziceZamestnance: 'p-zam' }), 'p-zam')

/* =====================================================================
   2. Výběr víc dnů — čistá logika (lib/vyber-dnu.ts)
   ================================================================== */

console.log('\n== Výběr víc dnů: okno týdnů (tydnyOkna) ==')
je(
  'týdny od PONDĚLÍ toho týdne, kam patří zacatek (2026-10-07 je středa)',
  tydnyOkna('2026-10-07', 2),
  [
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'],
  ],
)
je('okno se neroztáhne přes strop TYDNU_MAX', tydnyOkna('2026-10-07', 999).length, TYDNU_MAX)
je('aspoň jeden týden vždycky (0 nebo záporné se zvedne na 1)', tydnyOkna('2026-10-07', 0).length, 1)

console.log('\n== Výběr víc dnů: přepínání (prepnoutDen) ==')
je('přidá nevybraný den', prepnoutDen(['2026-10-05'], '2026-10-07'), ['2026-10-05', '2026-10-07'])
je('odebere už vybraný den', prepnoutDen(['2026-10-05', '2026-10-07'], '2026-10-05'), ['2026-10-07'])
je('výsledek je seřazený, ne v pořadí kliků', prepnoutDen(['2026-10-09'], '2026-10-05'), ['2026-10-05', '2026-10-09'])

console.log('\n== Výběr víc dnů: souhrn založení (souhrnZalozeni) ==')
const vysledky = (chyby) => chyby.map((chyba, i) => ({ den: `2026-10-0${i + 1}`, chyba, varovani: [] }))
je('všechny dny se založily', souhrnZalozeni(vysledky([null, null, null])), 'Založeno 3 z 3 směn')
je('částečný úspěch', souhrnZalozeni(vysledky([null, 'Chyba', null])), 'Založeno 2 z 3 směn')
je('jediný den, genitiv jednotného čísla („z 1 směny“, ne „z 1 směn“)', souhrnZalozeni(vysledky([null])), 'Založeno 1 z 1 směny')
je('žádný den se nezaložil', souhrnZalozeni(vysledky(['Chyba1', 'Chyba2'])), 'Založeno 0 z 2 směn')

console.log('\n== Výběr víc dnů: barva souhrnu podle výsledku (ne natvrdo zelená) ==')
je('všechny vyšly: zelená', barvaSouhrnu(vysledky([null, null, null])), 'var(--dobre)')
je('částečný úspěch: barva varování, ne zelená', barvaSouhrnu(vysledky([null, 'Chyba', null])), 'var(--pozor)')
je('ani jeden nevyšel: červená, ne zelená', barvaSouhrnu(vysledky(['Chyba1', 'Chyba2'])), 'var(--bad)')

console.log('\n== Výběr víc dnů: zapnutí přepínače nesmí zahodit dosavadní výběr ==')
je('první zapnutí (prázdný výběr): předvyplní se den z pole „den“', zapnoutVicDni([], '2026-10-07'), ['2026-10-07'])
je('první zapnutí bez vyplněného dne: prázdný výběr zůstává prázdný', zapnoutVicDni([], ''), [])
je(
  'opětovné zapnutí (výběr už něco má): výběr ZŮSTÁVÁ, nepřepíše se jedním dnem z pole „den“',
  zapnoutVicDni(['2026-10-05', '2026-10-06', '2026-10-09'], '2026-10-07'),
  ['2026-10-05', '2026-10-06', '2026-10-09'],
)

/* =====================================================================
   3. Formulář — přepínač „Víc dní“ a co zůstává beze změny
   ================================================================== */

console.log('\n== Formulář nové směny: přepínač „Víc dní“ ==')

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

const NAVIGACE = js(
  'export function useRouter() { return { push() {}, replace() {}, refresh() {} } }\n' +
    'export function useSearchParams() { return new URLSearchParams() }\n',
)
const AKCE = js(
  'export async function ulozitSmenu() { return { stav: "nic" } }\n' +
    'export async function smazatSmenu() { return { stav: "nic" } }\n',
)
const SABLONY_AKCE = js('export async function nabidnoutSablony() { return [] }')
/*
  Drawer (počítač) a ListMobil (telefon) jedou přes `createPortal` do
  `document.body` a mimo prohlížeč se schválně vykreslí jako nic
  (`typeof document === "undefined"`, viz jejich vlastní zdroj) — přesně
  proto je `rozpis.test.mjs`, který je nepodstrkuje, ve VYNECHANE seznamu
  workflow (.github/workflows/aplikace.yml). Tenhle test je v běžícím
  seznamu, takže obal se podstrčí jako průhledný — ať se vykreslí SKUTEČNÝ
  obsah formuláře (pole, přepínač, tlačítka), ne prázdno.
*/
const DRAWER = js('export default function Drawer({ otevreno, children }) { return otevreno ? children : null }\n')
const SHEET = js(
  'export function ListMobil({ children }) { return children }\n' +
    'export function SpodniList({ children }) { return children }\n',
)

const FormularSmeny = await nactiKomponentu('app/[rozsah]/smeny/formular-smeny.tsx', [
  ['next/navigation', NAVIGACE],
  ['./smena', AKCE],
  ['./sablony', SABLONY_AKCE],
  ['@/components/ui/Drawer', DRAWER],
  ['./mobil/sheet', SHEET],
])

const ZAKLAD_PROPS = {
  rozsah: 'cerna-perla',
  den: '2026-10-07',
  pobocky: [{ id: 'b1', nazev: 'Restaurace Černá Perla' }],
  vychoziPobocka: 'b1',
  lide: [{ id: 'e1', jmeno: 'Láďa' }],
  pozice: [{ id: 'p1', label: 'Kuchař' }],
  sablony: [],
  onZavrit: () => {},
}

function formular(props) {
  return renderToStaticMarkup(createElement(FormularSmeny, { ...ZAKLAD_PROPS, smena: null, ...props }))
}

const novy = formular({ onDalsiDen: () => {} })
ma('přepínač „Víc dní“ je u nové směny vidět', novy.includes('Víc dní'), true)
ma('napoprvé vypnutý: pole „den“ je pořád obyčejné datum', /name="den"/.test(novy), true)
ma('mřížka pro výběr dnů se bez zapnutí nekreslí', novy.includes('ds-sm-vd'), false)
ma('„Uložit a přidat další den“ je pořád vidět — beze změny (bod 3 zadání)', novy.includes('Uložit a přidat další den'), true)

const uprava = formular({
  smena: {
    id: 's1',
    branch_id: 'b1',
    employee_id: 'e1',
    position_id: null,
    shift_date: '2026-10-05',
    starts_at: '08:00:00',
    ends_at: '16:00:00',
    note: '',
    pauza_od: null,
    pauza_do: null,
  },
})
ma('u ÚPRAVY se přepínač „Víc dní“ vůbec nenabízí (jen nová směna)', uprava.includes('Víc dní'), false)
ma('a mřížka výběru dnů taky ne', uprava.includes('ds-sm-vd'), false)

// Mobil nemá dosud ŽÁDNÝ mechanismus na víc dnů (na rozdíl od počítače,
// kde aspoň bylo „Uložit a přidat další den“) — tělo formuláře je ale
// sdílené (viz hlavičku formular-smeny.tsx), takže totéž musí být vidět
// i ve variantě `list`.
const novyMobil = formular({ varianta: 'list' })
ma('na telefonu je přepínač „Víc dní“ vidět taky', novyMobil.includes('Víc dní'), true)
ma('a je to klikací (dotykové), ne jen text', novyMobil.includes('type="checkbox"'), true)

// Zapojení do zdrojáku — co se v běžícím prohlížeči po kliku spustí, static
// markup ukázat neumí (žádná hydratace), takže se ověří přímo ve zdroji,
// stejně jako `key={otevrene.smena?.id ||` v rozpis.test.mjs.
const zdrojFormulare = fs.readFileSync(
  new URL('../app/[rozsah]/smeny/formular-smeny.tsx', import.meta.url),
  'utf8',
)
ma('vybrané dny se posílají jako opakované pole „dny“', zdrojFormulare.includes('name="dny"'), true)
ma('tlačítko hlásí, na kolik dnů se ukládá (bod D zadání)', zdrojFormulare.includes("`Uložit na ${pocet(vybraneDny.length, 'den', 'dny', 'dní')}`"), true)
ma('výsledek víc dnů se čte ze stav.dny (souhrn + rozpad po dnech)', zdrojFormulare.includes('souhrnZalozeni(stav.dny)'), true)
ma('barva souhrnu se odvozuje z výsledku, není natvrdo zelená', zdrojFormulare.includes("color: barvaSouhrnu(stav.dny)"), true)
ma('přepínač „Víc dní“ má dotykovou výšku 44 px jako ostatní zaškrtávátka ve Směnách', /vicDniPrepinac = \{[^}]*minHeight: '44px'/s.test(zdrojFormulare), true)

const zdrojCss = fs.readFileSync(new URL('../app/_komponenty.css', import.meta.url), 'utf8')
ma('mřížka výběru dnů má na telefonu 52 px, jako ostatní klikací pole (ne 40 px zdědené z panelu)', /\.ds-sm-vd-den \{[^}]*min-height: 52px/s.test(zdrojCss), true)
ma('40 px platí jen na počítači (scoped na .ds-smd-form)', zdrojCss.includes('.ds-smd-form .ds-sm-vd-den { min-height: 40px; }'), true)

console.log('\n== Mřížka výběru dnů (vyber-dnu.tsx): popis dne v aria-label, ne syrové ISO ==')
const VyberDnu = await nactiKomponentu('app/[rozsah]/smeny/vyber-dnu.tsx')
const mrizka = renderToStaticMarkup(
  createElement(VyberDnu, {
    zacatek: '2026-10-07',
    vybrane: [],
    pocetTydnu: 1,
    onPrepnout: () => {},
  }),
)
ma('aria-label NENÍ syrové ISO datum', mrizka.includes('aria-label="2026-10-07"'), false)
ma('aria-label je čitelný popis dne (popisDne) — den v týdnu i datum', mrizka.includes('aria-label="Středa 7. října"'), true)

/* =====================================================================
   4. Server akce ulozitSmenu (app/[rozsah]/smeny/smena.ts)
   ================================================================== */

globalThis.__a = null
const CACHE = js('export function revalidatePath(c) { globalThis.__a.volani.push(["revalidate", c]) }\n')
const FIRMA_AKCE = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export async function zkusPristup(t, pravo, rozsah) {\n' +
    '  globalThis.__a.volani.push(["zkusPristup", pravo, rozsah]);\n' +
    '  return globalThis.__a.pristup(pravo);\n' +
    '}\n',
)
const SERVER_AKCE = js(
  'export async function getServerSupabase() {\n' +
    '  return { rpc: async (jmeno, args) => {\n' +
    '    globalThis.__a.volani.push(["rpc", jmeno, args]);\n' +
    '    return globalThis.__a.odpoved(args);\n' +
    '  } };\n' +
    '}\n',
)

const akce = await nactiModul('app/[rozsah]/smeny/smena.ts', [
  ['next/cache', CACHE],
  ['@/lib/firma', FIRMA_AKCE],
  ['@/lib/supabase/server', SERVER_AKCE],
])

const ZAKLAD_POLE = {
  rozsah: 'cerna-perla',
  pobocka: 'b1',
  zamestnanec: 'e1',
  pozice: '',
  od: '08:00',
  do: '16:00',
  poznamka: '',
  sablona: '',
  pauza_od: '',
  pauza_do: '',
}

async function odeslat(pole, { pristup = () => ({ stav: 'ok' }), odpoved = () => ({ data: [{ smena: 'nova', varovani: [] }], error: null }) } = {}) {
  globalThis.__a = { pristup, odpoved, volani: [] }
  const fd = new FormData()
  for (const [k, v] of Object.entries(pole)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) fd.append(k, x)
    else fd.append(k, v)
  }
  const vysledek = await akce.ulozitSmenu({ stav: 'nic' }, fd)
  const volani = globalThis.__a.volani
  return { vysledek, rpc: volani.filter((x) => x[0] === 'rpc'), volani }
}

console.log('\n== Server akce: víc dnů zavolá RPC jednou za den ==')
const vice = await odeslat(
  { ...ZAKLAD_POLE, dny: ['2026-10-05', '2026-10-06', '2026-10-07'] },
  {
    odpoved: (args) => ({
      data: [{ smena: `s-${args.p_den}`, varovani: args.p_den === '2026-10-06' ? ['Přesahuje půlnoc.'] : [] }],
      error: null,
    }),
  },
)
ma('zavolá RPC třikrát, jednou pro každý vybraný den', vice.rpc.length, 3)
ma('pokaždé jako NOVOU směnu (p_smena null), i když je to opakované volání', vice.rpc.every((r) => r[2].p_smena === null), true)
je('dny se pošlou v pořadí, v jakém přišly', vice.rpc.map((r) => r[2].p_den), ['2026-10-05', '2026-10-06', '2026-10-07'])
ma('kontrakt: parametry stejné jako u jednoho dne (žádné navíc)', JSON.stringify(Object.keys(vice.rpc[0][2]).sort()), JSON.stringify(['p_branch', 'p_den', 'p_do', 'p_employee', 'p_od', 'p_pauza_do', 'p_pauza_od', 'p_poznamka', 'p_position', 'p_sablona_key', 'p_smena', 'p_tenant'].sort()))
ma('vrátí hotovo s výsledkem po dnech', vice.vysledek.stav, 'hotovo')
je('všechny tři se založily, prostřední má varování', vice.vysledek.dny.map((d) => [d.den, d.chyba, d.varovani]), [
  ['2026-10-05', null, []],
  ['2026-10-06', null, ['Přesahuje půlnoc.']],
  ['2026-10-07', null, []],
])
ma('souhrn odpovídá souhrnZalozeni', souhrnZalozeni(vice.vysledek.dny), 'Založeno 3 z 3 směn')
ma('rozpis se obnoví JEDNOU, ne třikrát', vice.volani.filter((v) => v[0] === 'revalidate').length, 1)

console.log('\n== Server akce: duplicitní den v poli „dny“ se založí jen JEDNOU ==')
// `prepnoutDen` na straně formuláře duplicitu nikdy nepustí, ale server
// dostává syrová data z prohlížeče — musí se ubránit sám (viz hlavičku
// ulozitSmenu). Stejný den dvakrát v poli by jinak založil téhož člověka
// na týž den a čas dvakrát; RPC bere překryv jen jako varování, ne zamítnutí.
const duplicitni = await odeslat(
  { ...ZAKLAD_POLE, dny: ['2026-10-05', '2026-10-05', '2026-10-06'] },
  {
    odpoved: (args) => ({ data: [{ smena: `s-${args.p_den}`, varovani: [] }], error: null }),
  },
)
ma('RPC se zavolá jen dvakrát (deduplikováno), ne třikrát', duplicitni.rpc.length, 2)
je('dny se pošlou bez duplicity', duplicitni.rpc.map((r) => r[2].p_den), ['2026-10-05', '2026-10-06'])
je('výsledek má taky jen dva dny, ne tři', duplicitni.vysledek.dny.map((d) => d.den), ['2026-10-05', '2026-10-06'])

console.log('\n== Server akce: jeden den selže tvrdou chybou, ostatní se přesto založí ==')
const castecny = await odeslat(
  { ...ZAKLAD_POLE, dny: ['2026-10-05', '2026-10-06', '2026-10-07'] },
  {
    odpoved: (args) =>
      args.p_den === '2026-10-06'
        ? { data: null, error: { message: 'Tenhle zaměstnanec už na téhle pobočce nepracuje.' } }
        : { data: [{ smena: `s-${args.p_den}`, varovani: [] }], error: null },
  },
)
ma('všechny tři dny se pořád ZKUSÍ — chyba jednoho dne nezastaví další', castecny.rpc.length, 3)
je('výsledek: dva založené, jeden s chybou a přesně s tou hláškou z databáze', castecny.vysledek.dny.map((d) => [d.den, d.chyba]), [
  ['2026-10-05', null],
  ['2026-10-06', 'Tenhle zaměstnanec už na téhle pobočce nepracuje.'],
  ['2026-10-07', null],
])
ma('přesto „hotovo“ — částečný úspěch je lepší než nic (bod B zadání)', castecny.vysledek.stav, 'hotovo')
ma('a je to VIDĚT v souhrnu, ne tiše spolknuté', souhrnZalozeni(castecny.vysledek.dny), 'Založeno 2 z 3 směn')
ma('rozpis se obnoví — aspoň jedna směna vznikla', castecny.volani.some((v) => v[0] === 'revalidate'), true)

console.log('\n== Server akce: víc dnů, ani jeden nevyjde ==')
const zadny = await odeslat(
  { ...ZAKLAD_POLE, dny: ['2026-10-05', '2026-10-06'] },
  { odpoved: () => ({ data: null, error: { message: 'Chybí zařazení.' } }) },
)
je('oba dny mají chybu, oba jsou vidět', zadny.vysledek.dny.map((d) => d.chyba), ['Chybí zařazení.', 'Chybí zařazení.'])
ma('rozpis se NEOBNOVUJE — nic nevzniklo', zadny.volani.some((v) => v[0] === 'revalidate'), false)

console.log('\n== Server akce: jeden den (i „Uložit a přidat další den“) je BEZE ZMĚNY ==')
const jeden = await odeslat(
  { ...ZAKLAD_POLE, den: '2026-10-07' },
  { odpoved: () => ({ data: [{ smena: 'nova', varovani: ['Mimo provozní dobu pobočky.'] }], error: null }) },
)
ma('jedno volání RPC', jeden.rpc.length, 1)
ma('žádné pole „dny“ v požadavku → klasický jednodenní tvar odpovědi (žádné .dny)', jeden.vysledek.dny, undefined)
je('varování se propíšou jako dřív', jeden.vysledek.varovani, ['Mimo provozní dobu pobočky.'])
je('p_smena je null (nová směna) a p_den je zadaný den', [jeden.rpc[0][2].p_smena, jeden.rpc[0][2].p_den], [null, '2026-10-07'])

console.log('\n== Server akce: úprava existující směny ignoruje „dny“, i kdyby tam omylem bylo ==')
const uprSmeny = await odeslat(
  { ...ZAKLAD_POLE, smena: 's1', den: '2026-10-07', dny: ['2026-10-08', '2026-10-09'] },
  { odpoved: (args) => ({ data: [{ smena: args.p_smena, varovani: [] }], error: null }) },
)
ma('jedno volání, na PŮVODNÍ den z pole „den“, ne na „dny“', uprSmeny.rpc.length, 1)
je('p_smena a p_den odpovídají úpravě, ne založení nové směny', [uprSmeny.rpc[0][2].p_smena, uprSmeny.rpc[0][2].p_den], ['s1', '2026-10-07'])
ma('výsledek je klasický jednodenní tvar (žádné .dny)', uprSmeny.vysledek.dny, undefined)

console.log('\n== Server akce: bez oprávnění se nezkusí ani jeden den z výběru ==')
const bezOpravneni = await odeslat({ ...ZAKLAD_POLE, dny: ['2026-10-05', '2026-10-06'] }, { pristup: () => ({ stav: 'odepren' }) })
ma('žádné RPC', bezOpravneni.rpc.length, 0)
ma('vrátí se chyba, ne hotovo', bezOpravneni.vysledek.stav, 'chyba')

console.log('\n== Server akce: víc dnů bez vyplněného času se taky zamítne ==')
const bezCasu = await odeslat({ ...ZAKLAD_POLE, dny: ['2026-10-05'], od: '', do: '' })
ma('chyba dřív, než se cokoli zkusí uložit', bezCasu.vysledek.stav, 'chyba')
ma('a nesahá se na databázi', bezCasu.rpc.length, 0)

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
