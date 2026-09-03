#!/usr/bin/env node
/**
 * Šablony směn — obrazovka v nastavení a nabídka ve formuláři směny.
 *
 * Pusť `node --experimental-strip-types scripts/sablony.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE, A NE JEN ČTE ZDROJÁK
 *
 * Zadání má jednu větu, na které stojí celý návrh: „změna se projeví
 * jen na nově zadaných směnách“. Uživatel ji musí VIDĚT. Kontrola,
 * která by ověřila jen to, že ten řetězec je někde ve zdrojáku, projde
 * i tehdy, když bude v komentáři, ve větvi, která se nekreslí, nebo
 * pod `display: none`.
 *
 * Proto se tu vykreslí skutečné komponenty a hledá se v HOTOVÉM HTML.
 *
 * Dvakrát mě to letos chytilo na opaku: QR na kiosku nesl osm znaků
 * a kontrola to nepoznala, protože tu funkci vůbec nezavolala.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { VETA_JEN_NOVE } from '../lib/sablony-text.ts'
import { delkaSmenyMinut } from '../lib/cas.ts'
import { zkratkaDoSmeny } from '../lib/sablony.ts'
import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/* --- podstrčené serverové akce -------------------------------------- */

const STUB_NASTAVENI =
  'data:text/javascript,' +
  encodeURIComponent(
    'export async function ulozitSablonu() {}\nexport async function prepnoutSablonu() {}\n',
  )

const STUB_SMENA =
  'data:text/javascript,' +
  encodeURIComponent('export async function ulozitSmenu() { return { stav: "nic" } }\n')

const STUB_SABLONY =
  'data:text/javascript,' +
  encodeURIComponent('export async function nabidnoutSablony() { return [] }\n')

const NAVIGACE =
  'data:text/javascript,' +
  encodeURIComponent('export function useRouter() { return { refresh() {}, push() {} } }\n')

const Obrazovka = await nactiKomponentu(
  'app/[rozsah]/nastaveni/sablony/obrazovka.tsx',
  [['./akce', STUB_NASTAVENI]],
)

const FormularSmeny = await nactiKomponentu('app/[rozsah]/smeny/formular-smeny.tsx', [
  ['next/navigation', NAVIGACE],
  ['./smena', STUB_SMENA],
  ['./sablony', STUB_SABLONY],
])

/* --- data ------------------------------------------------------------ */

const POBOCKY = [
  { id: 'b1', nazev: 'Restaurace Černá Perla' },
  { id: 'b2', nazev: 'Bar Kotva' },
]
const POZICE = [
  { id: 'p1', label: 'Kuchař' },
  { id: 'p2', label: 'Číšník' },
]

const SABLONY = [
  {
    id: 's1',
    key: 'D',
    label: 'Denní',
    starts_at: '08:00:00',
    ends_at: '16:00:00',
    poradi: 10,
    active: true,
    branch_id: null,
    position_id: null,
  },
  {
    id: 's2',
    key: 'N',
    label: 'Noční',
    starts_at: '22:00:00',
    ends_at: '06:00:00',
    poradi: 20,
    active: true,
    branch_id: 'b2',
    position_id: 'p1',
  },
  {
    id: 's3',
    key: 'R',
    label: 'Ranní',
    starts_at: '06:00:00',
    ends_at: '14:00:00',
    poradi: 30,
    active: false,
    branch_id: null,
    position_id: null,
  },
]

const obrazovka = (volby = {}) =>
  renderToStaticMarkup(
    createElement(Obrazovka, {
      rozsah: 'cerna-perla',
      sablony: SABLONY,
      pobocky: POBOCKY,
      pozice: POZICE,
      ...volby,
    }),
  )

/** HTML bez značek — co člověk na obrazovce doopravdy přečte. */
function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* --- 1. délka směny sedí s databází ---------------------------------- */

console.log('\n== 1. Délka směny =========================================')

// Tytéž případy má krok20_scenar.sql nad app.delka_smeny_minut. Když se
// jedna strana změní, druhá to musí ohlásit.
ma('08:00–16:00 je 480 minut', delkaSmenyMinut('08:00', '16:00'), 480)
ma('22:00–06:00 je taky 480, ne mínus 960', delkaSmenyMinut('22:00', '06:00'), 480)
ma('00:30–01:00 je 30 minut', delkaSmenyMinut('00:30', '01:00'), 30)
ma('23:45–00:15 je 30 minut přes půlnoc', delkaSmenyMinut('23:45', '00:15'), 30)

/* --- 2. věta o nově zadaných směnách --------------------------------- */

console.log('\n== 2. Věta, na které stojí celý návrh =====================')

const t = text(obrazovka())
ma('věta stojí na obrazovce šablon', t.includes(VETA_JEN_NOVE), true)
ma(
  'a je nad formulářem, ne až v patičce pod seznamem',
  t.indexOf(VETA_JEN_NOVE) < t.indexOf('Nová šablona'),
  true,
)

/* --- 3. „všechny", ne prázdno ---------------------------------------- */

console.log('\n== 3. Prázdná pobočka a pozice se píšou slovem ============')

ma('firemní šablona hlásí všechny pobočky', t.includes('všechny pobočky'), true)
ma('a všechny pozice', t.includes('všechny pozice'), true)
ma('pobočková šablona ukáže název pobočky', t.includes('Bar Kotva'), true)
ma('a název pozice', t.includes('Kuchař'), true)

/* --- 4. délka na obrazovce ------------------------------------------- */

console.log('\n== 4. Noční směna se nepočítá záporně =====================')

ma('u noční stojí 22:00–06:00', t.includes('22:00–06:00'), true)
ma('a délka 8 h, ne mínus', t.includes('22:00–06:00 · 8 h'), true)

/* --- 5. vyřazená se vrací -------------------------------------------- */

console.log('\n== 5. Vyřazení je přepínač, ne jednosměrka ================')

ma('u zapnuté stojí Vyřadit z nabídky', t.includes('Vyřadit z nabídky'), true)
ma('u vyřazené stojí Vrátit do nabídky', t.includes('Vrátit do nabídky'), true)
ma('a je u ní vidět, že je vyřazená', t.includes('vyřazená z nabídky'), true)

/* --- 6. hláška po uložení ------------------------------------------- */

console.log('\n== 6. Po uložení se ta věta zopakuje ======================')

const poUlozeni = text(obrazovka({ stav: 'upravena' }))
ma(
  'po úpravě se připomene, že už zadané směny zůstávají',
  poUlozeni.includes(VETA_JEN_NOVE),
  true,
)

const sChybou = text(obrazovka({ chyba: 'Šablona s touhle zkratkou už existuje.' }))
ma(
  'hláška z databáze se ukáže tak, jak přišla',
  sChybou.includes('Šablona s touhle zkratkou už existuje.'),
  true,
)

/* --- 7. nabídka ve formuláři směny ----------------------------------- */

console.log('\n== 7. Nabídka ve formuláři směny ==========================')

const NABIDKA = [
  { klic: 'D', label: 'Denní', od: '08:00', do: '16:00', minut: 480 },
  { klic: 'N', label: 'Noční', od: '22:00', do: '06:00', minut: 480 },
]

const formular = (volby = {}) =>
  renderToStaticMarkup(
    createElement(FormularSmeny, {
      rozsah: 'cerna-perla',
      den: '2026-10-05',
      smena: null,
      pobocky: POBOCKY,
      vychoziPobocka: 'b1',
      lide: [{ id: 'e1', jmeno: 'Láďa' }],
      pozice: POZICE,
      sablony: NABIDKA,
      onZavrit: () => {},
      ...volby,
    }),
  )

const hSablonami = formular()
const tSablonami = text(hSablonami)

ma('nabídka nese zkratku, název i časy', tSablonami.includes('D · Denní · 08:00–16:00'), true)
ma('i noční', tSablonami.includes('N · Noční · 22:00–06:00'), true)
ma('a volbu vlastních časů', tSablonami.includes('— vlastní časy —'), true)
ma('věta o nově zadaných směnách stojí i tady', tSablonami.includes(VETA_JEN_NOVE), true)

/*
  Šablona jen předvyplní. Kdyby se pole po výběru zamkla, byla by z ní
  vazba — a přesně to zadání zakazuje.
*/
/*
  Značka se hledá celá a teprve v ní se koukne na `readonly`.

  První podoba téhle kontroly zněla `/name="od"[^>]*readonly/` a byla
  falešně zelená: React řadí atributy po svém a `name` vyjde až za
  `style`, takže `readonly` je před ním. Kontrola tedy neprošla proto,
  že je pole v pořádku, ale proto, že se nemohla trefit nikdy —
  ověřeno tím, že jsem `readOnly` schválně doplnil a nic to nepoznalo.
*/
function znacka(html, jmeno) {
  const m = html.match(new RegExp(`<input[^>]*name="${jmeno}"[^>]*>`))
  return m ? m[0] : ''
}

const poleOd = znacka(hSablonami, 'od')
const poleDo = znacka(hSablonami, 'do')

ma('políčko Od se vůbec vykreslilo', poleOd !== '', true)
ma('a políčko Do taky', poleDo !== '', true)
ma('Od zůstává obyčejné, ne jen ke čtení', /readonly/i.test(poleOd), false)
ma('Do taky', /readonly/i.test(poleDo), false)
ma('a ani zakázané', /disabled/i.test(poleOd), false)
ma('a nese čas, ne prázdno', /value="\d\d:\d\d"/.test(poleOd), true)

/*
  Bez vybrané šablony jde do směny prázdná zkratka. Kdyby tam něco
  bylo, směna by v rozpisu nesla „D“, aniž by ji kdo vybral.
*/
const poleZkratka = znacka(hSablonami, 'sablona')
ma('skryté pole na zkratku ve formuláři je', poleZkratka !== '', true)
ma('a bez výběru je prázdné', poleZkratka.includes('value=""'), true)

const bezSablon = text(formular({ sablony: [] }))
ma('bez šablon se nabídka vůbec nekreslí', bezSablon.includes('— vlastní časy —'), false)
ma('a formulář pořád nabídne časy ručně', bezSablon.includes('Konec dřív než začátek'), true)

/* --- 8. přepsané časy zkratku zahodí --------------------------------- */

console.log('\n== 8. Přepsané časy zkratku zahodí ========================')

/*
  Tohle vykreslením ověřit nejde — je to větev, která nastane až tím,
  že člověk do políčka napíše jinou hodinu. Proto je to funkce a proto
  se volá tady. Formulář nedělá nic jiného: `klicDoSmeny` je právě
  tenhle výsledek.
*/
ma('vybraná šablona se sedícími časy projde', zkratkaDoSmeny(NABIDKA, 'D', '08:00', '16:00'), 'D')
ma('posunutý začátek zkratku zahodí', zkratkaDoSmeny(NABIDKA, 'D', '09:00', '16:00'), '')
ma('posunutý konec taky', zkratkaDoSmeny(NABIDKA, 'D', '08:00', '17:00'), '')
ma('nevybraná šablona nedá nic', zkratkaDoSmeny(NABIDKA, '', '08:00', '16:00'), '')
ma(
  'šablona, která zmizela z nabídky, taky ne',
  zkratkaDoSmeny(NABIDKA, 'R', '06:00', '14:00'),
  '',
)
ma(
  'noční přes půlnoc projde jako každá jiná',
  zkratkaDoSmeny(NABIDKA, 'N', '22:00', '06:00'),
  'N',
)

const formularSoubor = fs.readFileSync(
  new URL('../app/[rozsah]/smeny/formular-smeny.tsx', import.meta.url),
  'utf8',
)
ma(
  'formulář to pravidlo nepočítá podruhé po svém',
  formularSoubor.includes('zkratkaDoSmeny(sablony, klic, od, doKdy)'),
  true,
)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
