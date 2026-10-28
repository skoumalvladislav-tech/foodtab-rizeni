#!/usr/bin/env node
/**
 * Přepínání podle šířky okna: co se má na telefonu schovat, se schová.
 *
 * Pusť `node scripts/css-prepinani.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 * Od 19. 9. do 27. 10. 2026 se v Rozpisu směn na telefonu pod mobilním
 * rozpisem kreslila i celá týdenní mřížka z počítače. Obal mřížky nese
 * `ds-sm-jen-desktop` (do 640 px schovat) i `ds-smd` (rozvržení plochy)
 * a `.ds-smd { display: flex }` stálo v app/_komponenty.css o 600 řádků
 * níž než schování, se stejnou specifičností — pozdější pravidlo vyhrálo.
 *
 *   1. Rozpis směn: každý prvek, který v .tsx nese `ds-sm-jen-desktop`
 *      nebo `ds-sm-jen-mobil` (i se všemi svými dalšími třídami), je na
 *      telefonu (do 640 px) schovaný / vidět a na počítači naopak. Bez
 *      mezery na zlomu (640,5 px při zvětšení stránky).
 *   2. Celá aplikace: žádné pravidlo pro určitou šířku okna nepřebije
 *      u prvku, na který sedí, pravidlo bez podmínky šířky.
 *
 * Kontrola nečte pravidlo pro schování, ale počítá, co z CELÉ kaskády
 * skutečného CSS vyhraje (scripts/css-kaskada.mjs). Pravidlo, o kterém
 * nejde rozhodnout, jestli na prvek sedí (záleží na předcích nebo stavu),
 * se počítá jako možný vítěz: prvek je „schovaný“, jen když je `none`
 * každý možný vítěz, a „vidět“, jen když `none` není žádný.
 */

import { nactiCss, popisKandidata, prebitaPodleSirky, prvkySTridou, prvkyVKodu, vitez } from './css-kaskada.mjs'

let chyb = 0
const ok = (popis, podminka, detail = '') => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || !detail ? '' : `\n${detail}`}`)
}

const css = nactiCss()
const kod = prvkyVKodu()

const TELEFON = [320, 390, 640]
const POCITAC = [640.5, 641, 768, 1024, 1280, 1536]

/** Možné výsledné `display` prvku při šířce (vítěz + nerozhodnutelní soupeři). */
function moznosti(prvek, sirka) {
  const v = vitez(css, prvek, 'display', { sirka })
  return {
    hodnoty: [v.hodnota ?? 'výchozí', ...v.nejiste.map((k) => k.hodnota)],
    popis: [
      `         ${sirka} px: vyhrává ${v.vyherce ? popisKandidata(v.vyherce) : 'nic (výchozí hodnota prohlížeče)'}`,
      ...v.nejiste.map((k) => `                 možná i ${popisKandidata(k)}`),
    ].join('\n'),
  }
}

const jmeno = (p) => `${p.soubor}:${p.radek} <${p.znacka ?? '?'} class="${[...p.tridy].join(' ')}">`

function zkontroluj(prvek, sirky, schovat, kde) {
  const vysledky = sirky.map((w) => moznosti(prvek, w))
  const spatne = vysledky.filter((v) => (schovat ? v.hodnoty.some((h) => h !== 'none') : v.hodnoty.includes('none')))
  ok(
    `${jmeno(prvek)} — ${kde} (${sirky.join(', ')} px): ${schovat ? 'schovaný' : 'vidět'}`,
    spatne.length === 0,
    spatne.map((v) => v.popis).join('\n'),
  )
}

console.log('\n== 1. Rozpis směn: na telefonu jen mobilní rozpis, na počítači jen mřížka ==')
for (const [trida, naTelefonu] of [['ds-sm-jen-desktop', false], ['ds-sm-jen-mobil', true]]) {
  const { prvky, vyskytu } = prvkySTridou(trida, kod)
  ok(
    `${trida}: všech ${vyskytu} výskytů v kódu je v className, které umím přečíst (${prvky.length})`,
    prvky.length === vyskytu && vyskytu > 0,
  )
  ok(
    `${trida}: obal v app/[rozsah]/smeny/rozpis.tsx je mezi nimi`,
    prvky.some((p) => p.soubor === 'app/[rozsah]/smeny/rozpis.tsx'),
  )
  for (const prvek of prvky) {
    ok(`${jmeno(prvek)}: třídy jsou pevné (žádná nepřibude za běhu)`, !prvek.sablona)
    zkontroluj(prvek, TELEFON, !naTelefonu, 'telefon')
    zkontroluj(prvek, POCITAC, naTelefonu, 'počítač')
  }
}
// Přesně ten prvek, na kterém se to stalo: bez `ds-smd` by kontrola
// nahoře prošla i nad starým CSS.
ok(
  'obal mřížky v rozpis.tsx nese i ds-smd (případ z 27. 10.)',
  prvkySTridou('ds-sm-jen-desktop', kod).prvky.some((p) => p.soubor === 'app/[rozsah]/smeny/rozpis.tsx' && p.tridy.has('ds-smd')),
)

console.log('\n== 2. Celá aplikace: pravidlo pro šířku okna nepřebije pozdější bez podmínky ==')
{
  const { prvky } = kod
  const sDvema = prvky.filter((p) => p.tridy.size >= 2)
  ok(`prošlo ${prvky.length} prvků s className, z toho ${sDvema.length} s víc třídami`, sDvema.length > 100)
  const nalezy = prebitaPodleSirky(css, sDvema, 'display')
  ok(
    'žádné přebité `display`',
    nalezy.length === 0,
    nalezy
      .map((n) =>
        [
          `         ${jmeno(n.prvek)} při ${Math.min(...n.sirky)}–${Math.max(...n.sirky)} px`,
          `           prohrává ${popisKandidata(n.prohrava)}`,
          `           vyhrává  ${popisKandidata(n.vyhrava)}`,
        ].join('\n'),
      )
      .join('\n'),
  )
}

console.log(chyb ? `\n${chyb} CHYB\n` : '\nVše v pořádku.\n')
process.exit(chyb ? 1 : 0)
