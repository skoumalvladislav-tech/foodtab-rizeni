#!/usr/bin/env node
/**
 * Bezpečné vložky — že se odsazuje ze všech čtyř stran, ne jen zdola.
 *
 * Pusť `node scripts/vlozky.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE 3. 9. STALO
 *
 * `app/layout.tsx` má `viewportFit: "cover"`, takže se kreslí až do
 * krajů obrazovky. V CSS se ale odsazovalo jen zdola — `safe-area-
 * inset-bottom` šestkrát, `-top` ani jednou. Na iPhonu 14 Plus proto
 * lezl nápis „Foodtab“ pod hodiny a řádka modulů pod Dynamic Island,
 * kde na ni nešlo kliknout.
 *
 * ---------------------------------------------------------------------
 * CO TAHLE KONTROLA UMÍ A CO NE
 *
 * NEUMÍ říct, jak to vypadá na telefonu. `env()` vyplňuje prohlížeč
 * podle zařízení a v nástrojích pro vývojáře vyjde nula — kdo si to
 * ověřuje tam, ověřuje si vlastní záměr.
 *
 * UMÍ ale uhlídat zapojení, na kterém to spadlo: že se všechno počítá
 * z jedné proměnné a že žádná lišta přes celou šířku na vložky
 * nezapomene. Změřeno bylo v prohlížeči nad SESTAVENÝM CSS
 * s podstrčenými hodnotami proměnných: lišta 52 + 59, řádka modulů
 * se přilepila na 111, spodní lišta 62 + 34, obsah 47 zleva.
 *
 * Poslední slovo má telefon.
 */

import fs from 'node:fs'

const KOREN = new URL('..', import.meta.url)
const tokeny = fs.readFileSync(new URL('app/_tokeny.css', KOREN), 'utf8')
const globalni = fs.readFileSync(new URL('app/globals.css', KOREN), 'utf8')
const layout = fs.readFileSync(new URL('app/layout.tsx', KOREN), 'utf8')
const kiosek = fs.readFileSync(new URL('app/kiosek/kiosek.tsx', KOREN), 'utf8')

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/**
 * Těla VŠECH pravidel pro daný selektor, slepená za sebe.
 *
 * Ne jen prvního: `.ft-mob-mods` má jedno pravidlo v základu
 * (`display: none`) a druhé uvnitř mediálního dotazu, kde je všechno
 * podstatné. První podoba téhle kontroly brala jen to první a hlásila
 * chybu nad kódem, který byl v pořádku.
 *
 * `selektor + ' {'` schválně, ať `.ft-mob-bottom` nechytne
 * `.ft-mob-bottom a`.
 */
function pravidla(css, selektor) {
  const kusy = []
  let i = css.indexOf(selektor + ' {')
  while (i >= 0) {
    kusy.push(css.slice(i, css.indexOf('}', i)))
    i = css.indexOf(selektor + ' {', i + 1)
  }
  return kusy
}

function pravidlo(css, selektor) {
  return pravidla(css, selektor).join('\n')
}

/* --- výpočet hodnot ---------------------------------------------------
   Hledání vzorců v textu neřekne, KOLIK z toho vyjde. Dnešní odchylku
   — lišta o osm bodů vyšší tam, kde vložka je nula — by žádná shoda
   řetězců nechytila; vzorec byl přesně takový, jaký jsem ho napsal.
   Proto se to spočítá.
   -------------------------------------------------------------------- */

/** Vlastní proměnné (`--x: hodnota;`) z kusu CSS, v pořadí zápisu. */
function promenne(css) {
  const m = new Map()
  for (const [, jmeno, hodnota] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    m.set(jmeno, hodnota.trim())
  }
  return m
}

/**
 * Spočítá hodnotu v pixelech.
 *
 * `env()` se nahradí svou záložní hodnotou — tedy tím, co prohlížeč
 * použije, když vložka není. Přesně ten případ se ověřuje: počítač
 * a Android. Nenulové vložky se podstrčí přes `rozsah`.
 */
function vPixelech(vyraz, rozsah) {
  let v = vyraz
  for (let i = 0; i < 20 && v.includes('var('); i++) {
    v = v.replace(/var\((--[a-z0-9-]+)(?:,\s*([^()]*))?\)/g, (cele, jmeno, zaloha) => {
      if (rozsah.has(jmeno)) return `(${rozsah.get(jmeno)})`
      if (zaloha !== undefined) return `(${zaloha})`
      throw new Error(`neznámá proměnná ${jmeno} v ${vyraz}`)
    })
  }
  // env(cokoli, záloha) → záloha; bez zálohy nula.
  v = v.replace(/env\([^,()]+(?:,\s*([^()]*))?\)/g, (cele, zaloha) => zaloha ?? '0px')

  const js = v
    .replace(/\bcalc\(/g, '(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/(\d+(?:\.\d+)?)px\b/g, '$1')

  if (/[a-z]/i.test(js.replace(/Math\.(max|min)/g, ''))) {
    throw new Error(`ve výrazu zbyly jednotky nebo funkce: ${js}`)
  }
  return Function(`"use strict"; return (${js});`)()
}

/*
  Dva rozsahy: počítač a telefon. Na telefonu přepíše `.ft-shell`
  uvnitř mediálního dotazu vnitřek lišty, takže pozdější zápis vyhraje
  — stejně jako v prohlížeči.
*/
const shellBloky = []
{
  let i = globalni.indexOf('.ft-shell {')
  while (i >= 0) {
    shellBloky.push(globalni.slice(i, globalni.indexOf('}', i)))
    i = globalni.indexOf('.ft-shell {', i + 1)
  }
}

const zaklad = new Map([...promenne(tokeny), ...promenne(shellBloky[0] ?? '')])
const telefon = new Map(zaklad)
for (const blok of shellBloky.slice(1)) {
  for (const [k, v] of promenne(blok)) telefon.set(k, v)
}

/** Rozsah s podstrčenými vložkami — na simulaci iPhonu. */
function sVlozkami(zdroj, vlozky) {
  const m = new Map(zdroj)
  for (const [k, v] of Object.entries(vlozky)) m.set(k, v)
  return m
}

/* --- 1. proč to vůbec musíme řešit ------------------------------------ */

console.log('\n== 1. Kreslí se do krajů ==================================')

ma('layout má viewportFit: cover', /viewportFit:\s*["']cover["']/.test(layout), true)

/* --- 2. vložky jdou přes proměnné ------------------------------------- */

console.log('\n== 2. Vložky jsou na jednom místě =========================')

for (const v of ['nahore', 'vpravo', 'dole', 'vlevo']) {
  ma(`--vlozka-${v} je v tokenech`, tokeny.includes(`--vlozka-${v}:`), true)
}

/*
  Vložka je HOLÁ, bez minima. Minimum v ní znamenalo, že se přičetlo
  i tam, kde vložka je nula, a lišta všude vyrostla. Sedí až u toho,
  kdo odsazuje — viz `--lista-shora` níž.
*/
ma(
  'vložka nemá vlastní minimum',
  /--vlozka-nahore:\s*env\(safe-area-inset-top,\s*0px\)\s*;/.test(tokeny),
  true,
)

/*
  `env()` se smí psát JEN v tokenech. Jinde se sahá na proměnnou —
  kdyby si každá lišta psala vlastní `env()`, přesně tak by na jednu
  z nich zapomněl další, kdo sem přijde. Přesně tak to dopadlo:
  šestkrát zdola, ani jednou shora.
*/
const envJinde = [...globalni.matchAll(/env\(safe-area-inset-[a-z]+/g)].map((m) => m[0])
ma('mimo tokeny se env() nepíše', envJinde.join(', '), '')

/* --- 3. co se odvíjí od výšky lišty ----------------------------------- */

console.log('\n== 3. Všechno se počítá z jedné výšky =====================')

/*
  Vlastní odsazení a vložka soupeří uvnitř TÉHOŽ `max()`. Kdyby se
  sčítaly, lišta by vyrostla i tam, kde není co odtlačovat.
*/
ma(
  'odsazení shora je souboj vlastní hodnoty a vložky',
  /--lista-shora:\s*max\(var\(--lista-okraj\),\s*var\(--vlozka-nahore\)\)/.test(globalni),
  true,
)
ma(
  '--vysoka-lista se skládá z vnitřku a obou okrajů',
  /--vysoka-lista:\s*calc\(var\(--lista-vnitrek\) \+ var\(--lista-okraj\) \+ var\(--lista-shora\)\)/.test(
    globalni,
  ),
  true,
)
ma(
  'a na telefonu se mění jen vnitřek',
  /--lista-vnitrek:\s*36px/.test(globalni),
  true,
)

const lista = pravidlo(globalni, '.ft-topbar')
ma('lišta má výšku z proměnné', lista.includes('height: var(--vysoka-lista)'), true)
ma('a odsazení shora z té sdílené', lista.includes('padding: var(--lista-shora)'), true)
/*
  Dole vlastní okraj, ne nula — a v KAŽDÉM pravidle zvlášť.

  Slepená pravidla to neuhlídají: `.ft-topbar` má dvě, jedno pro
  počítač a jedno pro telefon, a stačilo by, aby okraj mělo jen to
  druhé. Zkusil jsem to — nastavil jsem dole nulu na počítači
  a kontrola nad slepenými pravidly prošla. Nesymetrické odsazení
  přitom obsah posune o čtyři body dolů, i když výška sedí.
*/
const listaJednotlive = pravidla(globalni, '.ft-topbar').filter((p) => p.includes('padding:'))
ma('lišta má odsazení ve dvou pravidlech', listaJednotlive.length, 2)
ma(
  'a obě mají dole vlastní okraj',
  listaJednotlive.every((p) => p.includes('var(--lista-okraj) max(')),
  true,
)

/*
  A ŽÁDNÉ pravidlo jí nesmí dát pevnou výšku.

  Kladná kontrola výš na tohle nestačí: pravidla pro `.ft-topbar` jsou
  dvě (základ a telefon) a slepují se dohromady, takže by stačilo, aby
  proměnnou mělo jedno z nich. Zkusil jsem to — vrátil jsem počítači
  pevných 56 px a kontrola prošla. Odsazení bez zvětšené výšky obsah
  jen stlačí dovnitř a nápis pod hodinami zůstane.
*/
ma(
  'a nikde si nebere pevnou výšku',
  /\.ft-topbar\s*\{[^}]*height:\s*\d+px/s.test(globalni),
  false,
)

/*
  Tohle je ta chyba, kvůli které se na řádku modulů nedalo kliknout.
  Kdyby zůstalo pevných 56 px, přilepí se přesně pod ostrůvek.
*/
ma(
  'řádka modulů se lepí pod lištu i s vložkou',
  /\.ft-mob-mods\b[^}]*top:\s*var\(--vysoka-lista\)/s.test(globalni),
  true,
)
ma(
  'a nikde se nelepí na pevné pixely',
  /\.ft-mob-mods\s*\{[^}]*top:\s*\d+px/s.test(globalni),
  false,
)

const sloupec = pravidlo(globalni, '.ft-side')
ma('levý sloupec začíná pod lištou i s vložkou', sloupec.includes('top: var(--vysoka-lista)'), true)
ma(
  'a jeho výška se o ni zmenší',
  sloupec.includes('calc(100dvh - var(--vysoka-lista))'),
  true,
)

/* --- 3b. kolik z toho vyjde ------------------------------------------- */

console.log('\n== 3b. Bez vložek zůstává lišta stejná jako dřív ==========')

/*
  TOHLE JE TA KONTROLA, KTERÁ CHYBĚLA.

  Napoprvé jsem dal minimum do samotné vložky — `max(env(…), 8px)` —
  a přičetl ji k hotové výšce. Vzorec vypadal správně a všechny kontroly
  na vzorce prošly; jenže na počítači tím lišta vyrostla z 56 na 64 px
  a na telefonu z 52 na 60. Minimum má odtlačit lištu tam, kde ji nemá
  co odtlačit, ne ji všude natáhnout.

  Podmínka je jednoduchá a spočítatelná: PŘI NULOVÝCH VLOŽKÁCH MUSÍ
  VYJÍT PŮVODNÍ VÝŠKA.
*/
ma('na počítači je lišta zase 56 px', vPixelech('var(--vysoka-lista)', zaklad), 56)
ma('na telefonu zase 52 px', vPixelech('var(--vysoka-lista)', telefon), 52)
ma('a odsazení shora je vlastní osmička', vPixelech('var(--lista-shora)', zaklad), 8)

/*
  A s vložkou naopak vyrůst MUSÍ — jinak by se opravila jedna chyba
  tím, že se vrátí ta původní. Roste o to, oč je vložka větší než
  vlastní odsazení: 59 − 8 = 51.
*/
const iPhone = { '--vlozka-nahore': '59px' }
ma(
  'se vložkou 59 px lišta na počítači vyroste na 107',
  vPixelech('var(--vysoka-lista)', sVlozkami(zaklad, iPhone)),
  107,
)
ma(
  'a na telefonu na 103',
  vPixelech('var(--vysoka-lista)', sVlozkami(telefon, iPhone)),
  103,
)
ma(
  'odsazení shora je pak celá vložka',
  vPixelech('var(--lista-shora)', sVlozkami(zaklad, iPhone)),
  59,
)

/*
  Malá vložka lištu nezvětší — osmička ji pokryje. Kdyby se přičítala,
  vyšlo by 60.
*/
ma(
  'vložka menší než osmička výškou nehne',
  vPixelech('var(--vysoka-lista)', sVlozkami(zaklad, { '--vlozka-nahore': '4px' })),
  56,
)

/* --- 4. boční vložky -------------------------------------------------- */

console.log('\n== 4. Boční vložky — iPhone na šířku ======================')

/*
  Na šířku jsou -left a -right kolem 47 px a lišta přes celou šířku
  se dostane pod zaoblený roh. Kiosek běží na tabletu na šířku, takže
  na to narazíme jistě.

  `max(vlastní odsazení, vložka)`, ne součet: sečtené by to na iPhonu
  udělalo přes šedesát bodů okraje a obsah by se scvrkl.
*/
for (const [popis, selektor] of [
  ['horní lišta', '.ft-topbar'],
  ['řádka modulů', '.ft-mob-mods'],
  ['spodní lišta', '.ft-mob-bottom'],
  ['obsah', '.ft-main'],
]) {
  const telo = pravidlo(globalni, selektor)
  ma(`${popis} počítá s levou vložkou`, telo.includes('var(--vlozka-vlevo)'), true)
  ma(`${popis} počítá s pravou vložkou`, telo.includes('var(--vlozka-vpravo)'), true)
}

ma(
  'levý sloupec má vlastní levou vložku',
  pravidlo(globalni, '.ft-side').includes('padding-left: var(--vlozka-vlevo)'),
  true,
)

ma(
  'spodní lišta má pořád i tu spodní',
  pravidlo(globalni, '.ft-mob-bottom').includes('var(--vlozka-dole)'),
  true,
)

/* --- 5. kiosek -------------------------------------------------------- */

console.log('\n== 5. Kiosek na tabletu na šířku ==========================')

for (const v of ['nahore', 'vpravo', 'dole', 'vlevo']) {
  ma(`kiosek počítá s vložkou ${v}`, kiosek.includes(`var(--vlozka-${v})`), true)
}
ma(
  'a bere z každé strany větší z dvojice, ne součet',
  /max\(24px, var\(--vlozka-nahore\)\)/.test(kiosek),
  true,
)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
