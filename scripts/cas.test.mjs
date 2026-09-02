#!/usr/bin/env node
/**
 * Časy na obrazovce — pásmo pobočky.
 *
 * Pusť `node --experimental-strip-types scripts/cas.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TAHLE KONTROLA EXISTUJE
 *
 * Chyba, kterou má hlídat, se na obrazovce NEPROJEVILA. Ruční zápis
 * ukládal o dvě hodiny napřed a zobrazení bylo o dvě hodiny pozadu,
 * takže se to vyrušilo: co se zadalo jako 22:00, se jako 22:00 i
 * ukázalo. Sedělo to a bylo to špatně.
 *
 * Proto se tu ověřuje OBOJÍ ZVLÁŠŤ:
 *
 *   * že uložený okamžik je ten správný  → supabase/tests/krok14_scenar.sql
 *   * že se z něj vykreslí správná hodina → tenhle soubor
 *
 * Kdyby se ověřovalo jen „zadal jsem 22:00 a vidím 22:00“, prošla by
 * i ta chyba.
 *
 * ---------------------------------------------------------------------
 * A PROČ SE TO PUSTÍ V CIZÍM PÁSMU
 *
 * Původní kód volal `new Date(iso).getHours()`, tedy hodinu v pásmu
 * PROCESU. Na vývojářském stroji v Praze vypadal správně a na Vercelu
 * v UTC byl o dvě hodiny vedle — proto si toho nikdo nevšiml.
 *
 * Kontrola se tedy pouští znovu pod `TZ=UTC` a `TZ=America/New_York`
 * a výsledek musí být pokaždé stejný. Kdyby se `getHours()` vrátilo,
 * tohle spadne.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { datumACasVPasmu, denVPasmu, hodinaVPasmu, ZONA_VYCHOZI } from '../lib/cas.ts'
import { nactiKomponentu } from './vykreslit.mjs'

/** Kód bez komentářů. Vysvětlení chyby není totéž co chyba. */
function bezKomentaru(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((r) => !r.trimStart().startsWith('//'))
    .join('\n')
}

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/* =====================================================================
   1. Převod okamžiku na hodinu
   ================================================================== */

console.log('\n== Uložený okamžik se vykreslí v pásmu pobočky ==')

// Přesně ten záznam z nálezu: „22:00 pražského času“ leží na 20:00 UTC.
const LETO = '2026-08-31T20:00:00Z'
ma('letní 20:00 UTC je v Praze 22:00', hodinaVPasmu(LETO, 'Europe/Prague'), '22:00')

/*
  A tohle je ta chyba: `getHours()` v UTC serveru by dalo „20:00“.
  Kdyby se vrátila, tenhle řádek spadne.
*/
ma('a rozhodně ne 20:00, jak to ukazovalo dřív',
  hodinaVPasmu(LETO, 'Europe/Prague') === '20:00', false)

// V zimě je posun jiný. Paušální „plus dvě hodiny“ by tady selhalo.
const ZIMA = '2026-01-15T21:00:00Z'
ma('zimní 21:00 UTC je v Praze taky 22:00', hodinaVPasmu(ZIMA, 'Europe/Prague'), '22:00')
ma('a v UTC je to 21:00, ne 22:00', hodinaVPasmu(ZIMA, 'UTC'), '21:00')

// Pásmo se bere z pobočky, ne odjinud.
ma('na Islandu je z téhož okamžiku 20:00',
  hodinaVPasmu(LETO, 'Atlantic/Reykjavik'), '20:00')

console.log('\n== Půlnoc a hranice dne ==')

// 00:30 pražského času, ne „24:30“ a ne „12:30 AM“.
ma('půlnoc se píše jako 00:30', hodinaVPasmu('2026-08-31T22:30:00Z', 'Europe/Prague'), '00:30')

/*
  Datum se musí lámat taky v pásmu pobočky. Okamžik 2026-08-31 22:30 UTC
  je v Praze už 1. září — kdyby se den bral z UTC, spadl by záznam do
  špatného provozního dne.
*/
ma('a datum se láme taky v Praze',
  denVPasmu('2026-08-31T22:30:00Z', 'Europe/Prague'), '2026-09-01')
ma('kdežto v UTC je to pořád 31. srpna',
  denVPasmu('2026-08-31T22:30:00Z', 'UTC'), '2026-08-31')

console.log('\n== Když pásmo neznáme ==')

// Nenasazená migrace znamená `undefined`. Sáhne se po výchozím pásmu,
// NIKDY po pásmu serveru — to je právě ta chyba.
ma('bez pásma platí Europe/Prague', hodinaVPasmu(LETO), '22:00')
ma('výchozí pásmo je Praha, ne UTC', ZONA_VYCHOZI, 'Europe/Prague')
ma('nesmyslné pásmo obrazovku neshodí', hodinaVPasmu(LETO, 'Nesmysl/Nikde'), '22:00')
ma('nesmyslné datum vrátí prázdno, ne „Invalid Date“', hodinaVPasmu('nesmysl'), '')

ma('datum a čas dohromady', datumACasVPasmu(LETO, 'Europe/Prague'), '31. 8. 22:00')

/* =====================================================================
   2. Panel nedokončených — hotové HTML

   Tady se dívá na to, co uvidí člověk, který se podle toho rozhoduje,
   jaký odchod dopsat. Právě tenhle údaj byl v nálezu nepravdivý.
   ================================================================== */

console.log('\n== Panel nedokončených ukazuje čas v pásmu pobočky ==')

const ODKAZ_STUB =
  'data:text/javascript,' +
  encodeURIComponent(
    `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
      'export default function Link({ href, children, ...zbytek }) {\n' +
      '  return createElement("a", { href, ...zbytek }, children)\n' +
      '}\n',
  )

const PanelNedokoncene = await nactiKomponentu(
  'app/[rozsah]/dochazka/panel-nedokoncene.tsx',
  [['next/link', ODKAZ_STUB]],
)

function panel(zona) {
  return renderToStaticMarkup(
    createElement(PanelNedokoncene, {
      zaznamy: [
        {
          employee_id: 'e1',
          jmeno: 'Láďa',
          branch_id: 'b1',
          business_date: '2026-08-31',
          // 13:27 pražského času
          zacatek: '2026-08-31T11:27:00Z',
          moje: false,
          pobockaSlug: 'cerna-perla',
          pobockaNazev: 'Restaurace Černá Perla',
          zona,
        },
      ],
      smiOpravit: true,
      naPobocce: true,
    }),
  )
}

const html = panel('Europe/Prague')
ma('v panelu je 13:27', html.includes('13:27'), true)

/*
  A tohle je ten nepravdivý údaj z nálezu: obrazovka ukazovala 11:27,
  protože brala hodinu v pásmu serveru. Podle něj se pak dopisoval
  odchod.
*/
ma('a NENÍ tam 11:27, jak to ukazovalo dřív', html.includes('11:27'), false)

ma('bez pásma se spadne na Prahu, ne na server',
  panel(null).includes('13:27'), true)

/* =====================================================================
   3. A že na pásmu procesu nezáleží
   ================================================================== */

console.log('\n== Výsledek nezávisí na pásmu procesu ==')

const OVER = `
import { hodinaVPasmu } from ${JSON.stringify(new URL('../lib/cas.ts', import.meta.url).href)}
process.stdout.write(hodinaVPasmu('2026-08-31T20:00:00Z', 'Europe/Prague'))
`
const soubor = new URL('../lib/.cas-zkouska.mjs', import.meta.url)
fs.writeFileSync(soubor, OVER)

try {
  for (const tz of ['UTC', 'America/New_York', 'Europe/Prague']) {
    const ven = execFileSync(
      process.execPath,
      ['--experimental-strip-types', soubor.pathname.replace(/^\//, '')],
      { encoding: 'utf8', env: { ...process.env, TZ: tz } },
    )
    ma(`pod TZ=${tz} pořád 22:00`, ven.trim(), '22:00')
  }
} finally {
  fs.rmSync(soubor, { force: true })
}

/* =====================================================================
   4. Ruční zápis nesmí čas převádět sám
   ================================================================== */

console.log('\n== Převod dělá databáze, ne prohlížeč ==')

const rucni = fs.readFileSync(new URL('../app/[rozsah]/dochazka/rucni.ts', import.meta.url), 'utf8')

/*
  `new Date(kdy).toISOString()` byl původ celé chyby: řetězec z políčka
  nemá pásmo, takže ho JavaScript přečte v pásmu serveru.

  Kouká se jen na KÓD, ne na komentáře — v souboru je ta chyba popsaná
  slovy a kontrola se na vlastní vysvětlení napoprvé chytla.
*/
const rucniKod = bezKomentaru(rucni)
ma('žádné new Date() na čase z formuláře', rucniKod.includes('new Date(kdy)'), false)
ma('zapisuje se průzorem, ne přímo do tabulky',
  rucni.includes("rpc('zapsat_rucni_dochazku'"), true)
ma('a čas jde dál tak, jak ho člověk napsal', rucni.includes('p_kdy: kdy'), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
