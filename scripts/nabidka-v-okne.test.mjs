#!/usr/bin/env node
/**
 * Rozbalovací nabídka v okně (lib/nabidka-v-okne.ts) — panel Filtry
 * a „Zobrazit“ v Rozpisu směn na počítači.
 *
 * Pusť `node --experimental-strip-types scripts/nabidka-v-okne.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ
 *
 * Šéfík 9. 11. 2026: notebook 1920 px se zvětšením 125 % (okno 1536 CSS
 * px), Celá firma. Tlačítko Filtry stálo na 1181 px, panel široký 440 px
 * končil na 1621 px — o 100 px za pravým krajem okna (1521 px bez
 * posuvníku). Stránka dostala vodorovný posuvník a klik na něj panel
 * zavřel, protože Chrome hlásí klik na posuvník stránky jako `mousedown`
 * na `<html>`, tedy „mimo panel“.
 *
 * Čísla v prvním bloku jsou ta naměřená (headless Chrome nad náhledem se
 * smyšlenými daty), ne vymyšlená.
 *
 * ---------------------------------------------------------------------
 * CO TO NEOVĚŘÍ
 *
 * Že komponenta funkce opravdu volá a že Chrome klik na posuvník hlásí
 * tak, jak tu předpokládáme. To ověřil průchod v prohlížeči (skutečné
 * vstupy přes DevTools Protocol, před opravou i po ní) — popsaný v PR.
 */

import {
  MIN_VYSKA_NABIDKY,
  OKRAJ_NABIDKY,
  naPosuvniku,
  umisteniNabidky,
} from '../lib/nabidka-v-okne.ts'

let chyb = 0
let kontrol = 0
const ma = (popis, sk, ce) => {
  kontrol++
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}
/** Pravý a dolní okraj nabídky v okně po umístění. */
const kraje = (v, u) => ({ vpravo: v.kotva + u.vlevo + v.sirka, dole: v.nahore + u.maxVyska, vlevo: v.kotva + u.vlevo })

console.log('umisteniNabidky — vodorovně')
{
  // Šéfíkův případ: okno 1521 px (bez posuvníku), tlačítko na 1181 px.
  const v = { kotva: 1181, sirka: 440, nahore: 170, oknoSirka: 1521, oknoVyska: 713 }
  const u = umisteniNabidky(v)
  ma('notebook 125 %: pravý kraj nabídky je v okně s okrajem', kraje(v, u).vpravo, 1521 - OKRAJ_NABIDKY)
  ma('notebook 125 %: nabídka se posunula doleva o přesah', u.vlevo, -(1181 + 440 - (1521 - OKRAJ_NABIDKY)))
}
{
  // Velký monitor 1920 px: místa je dost, nabídka zůstane pod tlačítkem.
  const v = { kotva: 1181, sirka: 440, nahore: 170, oknoSirka: 1920, oknoVyska: 960 }
  ma('monitor 1920: nabídka zůstane zarovnaná s tlačítkem', umisteniNabidky(v).vlevo, 0)
}
{
  // Tlačítko přesně tak, že nabídka končí na hraně okraje — ještě se neposouvá.
  const v = { kotva: 1000 - OKRAJ_NABIDKY - 440, sirka: 440, nahore: 100, oknoSirka: 1000, oknoVyska: 800 }
  ma('nabídka končí přesně na okraji: bez posunu', umisteniNabidky(v).vlevo, 0)
  ma('o pixel dál: posun o pixel', umisteniNabidky({ ...v, kotva: v.kotva + 1 }).vlevo, -1)
}
{
  // Nabídka širší, než kolik je v okně místa: drží se levého kraje, nikdy za něj.
  const v = { kotva: 300, sirka: 700, nahore: 100, oknoSirka: 690, oknoVyska: 800 }
  ma('široká nabídka v úzkém okně: levý kraj na okraji okna', kraje(v, umisteniNabidky(v)).vlevo, OKRAJ_NABIDKY)
}
{
  // Tlačítko kousek za levým krajem (stránka posunutá doprava): nabídka se vrátí do okna.
  const v = { kotva: -40, sirka: 360, nahore: 100, oknoSirka: 800, oknoVyska: 800 }
  ma('tlačítko za levým krajem: nabídka začne na okraji okna', kraje(v, umisteniNabidky(v)).vlevo, OKRAJ_NABIDKY)
}

console.log('umisteniNabidky — svisle')
{
  // Okno 1100 × 760, řádek nástrojů na dva řádky: nabídka začíná na 306 px.
  // Dřív `100dvh − 200 px` = 560 px a konec na 866 px, pod spodním krajem.
  const v = { kotva: 528, sirka: 440, nahore: 306, oknoSirka: 1085, oknoVyska: 760 }
  const u = umisteniNabidky(v)
  ma('okno 1100: nabídka končí nad spodním krajem s okrajem', kraje(v, u).dole, 760 - OKRAJ_NABIDKY)
}
{
  // Pod tlačítkem málo místa (telefon na šířku, 390 px): nejmenší výška, stránka se posune.
  const v = { kotva: 354, sirka: 440, nahore: 306, oknoSirka: 844, oknoVyska: 390 }
  ma('málo místa dole: nabídka má aspoň nejmenší výšku', umisteniNabidky(v).maxVyska, MIN_VYSKA_NABIDKY)
}
{
  // Okno nižší než nejmenší výška: ani tak nesmí být nabídka vyšší než okno.
  const v = { kotva: 10, sirka: 300, nahore: 150, oknoSirka: 600, oknoVyska: 180 }
  ma('okno nižší než nejmenší výška: nabídka se vejde do okna', umisteniNabidky(v).maxVyska, 180 - 2 * OKRAJ_NABIDKY)
}

console.log('naPosuvniku — posuvník stránky')
{
  const okno = { sirka: 1521, vyska: 713 } // okno 1536 × 728, posuvníky 15 px
  ma('klik na vodorovný posuvník stránky (dole)', naPosuvniku({ x: 760, y: 720 }, okno, null), true)
  ma('klik na svislý posuvník stránky (vpravo)', naPosuvniku({ x: 1528, y: 300 }, okno, null), true)
  ma('klik do stránky těsně nad posuvníkem není posuvník', naPosuvniku({ x: 760, y: 712.5 }, okno, null), false)
  ma('klik na <html> uprostřed okna není posuvník', naPosuvniku({ x: 760, y: 300 }, okno, null), false)
}

console.log('naPosuvniku — posuvník prvku (mřížka, boční menu)')
{
  // Prvek na 100,100; rámeček 1 px; vnitřek 400 × 300; svislý posuvník 15 px, vodorovný 15 px.
  const okno = { sirka: 1500, vyska: 900 }
  const prvek = { vlevo: 100, nahore: 100, ramLevy: 1, ramHorni: 1, sirkaVnitrku: 400, vyskaVnitrku: 300, posuvnikSvisly: 15, posuvnikVodorovny: 15 }
  ma('klik na svislý posuvník prvku', naPosuvniku({ x: 100 + 1 + 400 + 7, y: 200 }, okno, prvek), true)
  ma('klik na vodorovný posuvník prvku', naPosuvniku({ x: 300, y: 100 + 1 + 300 + 7 }, okno, prvek), true)
  ma('klik do vnitřku prvku těsně vedle posuvníku', naPosuvniku({ x: 100 + 1 + 399, y: 200 }, okno, prvek), false)
  ma('klik na pravý rámeček za posuvníkem', naPosuvniku({ x: 100 + 1 + 400 + 15, y: 200 }, okno, prvek), false)
  const bez = { ...prvek, posuvnikSvisly: 0, posuvnikVodorovny: 0 }
  ma('prvek bez posuvníku: klik na pravý rámeček není posuvník', naPosuvniku({ x: 100 + 1 + 400, y: 200 }, okno, bez), false)
  ma('prvek bez posuvníku: klik doprostřed', naPosuvniku({ x: 300, y: 200 }, okno, bez), false)
}

console.log('')
console.log(chyb === 0 ? `Vše v pořádku (${kontrol} kontrol).` : `CHYB: ${chyb} z ${kontrol} kontrol.`)
process.exit(chyb === 0 ? 0 : 1)
