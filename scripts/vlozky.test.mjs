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
function pravidlo(css, selektor) {
  const kusy = []
  let i = css.indexOf(selektor + ' {')
  while (i >= 0) {
    kusy.push(css.slice(i, css.indexOf('}', i)))
    i = css.indexOf(selektor + ' {', i + 1)
  }
  return kusy.join('\n')
}

/* --- 1. proč to vůbec musíme řešit ------------------------------------ */

console.log('\n== 1. Kreslí se do krajů ==================================')

ma('layout má viewportFit: cover', /viewportFit:\s*["']cover["']/.test(layout), true)

/* --- 2. vložky jdou přes proměnné ------------------------------------- */

console.log('\n== 2. Vložky jsou na jednom místě =========================')

for (const v of ['nahore', 'vpravo', 'dole', 'vlevo']) {
  ma(`--vlozka-${v} je v tokenech`, tokeny.includes(`--vlozka-${v}:`), true)
}

ma(
  'horní vložka má minimum, ať lišta nesedí na kraji',
  /--vlozka-nahore:\s*max\(env\(safe-area-inset-top[^)]*\),\s*\d+px\)/.test(tokeny),
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

ma(
  '--vysoka-lista je výška lišty i s vložkou',
  /--vysoka-lista:\s*calc\(56px \+ var\(--vlozka-nahore\)\)/.test(globalni),
  true,
)
ma(
  'a na telefonu se přepočítá na nižší lištu',
  /--vysoka-lista:\s*calc\(52px \+ var\(--vlozka-nahore\)\)/.test(globalni),
  true,
)

const lista = pravidlo(globalni, '.ft-topbar')
ma('lišta má výšku z proměnné', lista.includes('height: var(--vysoka-lista)'), true)
ma('a vložku i jako odsazení shora', lista.includes('padding: var(--vlozka-nahore)'), true)

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
