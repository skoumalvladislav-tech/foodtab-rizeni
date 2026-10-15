#!/usr/bin/env node
/**
 * Srovnatelná období pro trendy na Finance → Přehled (lib/finance-obdobi.ts).
 *
 * Do 14. 10. 2026 se rozběhnutý měsíc srovnával s celým minulým a tržby
 * v polovině měsíce vždycky „padaly" (produkce: −47 % Bernard Bar,
 * −56,5 % firma). Tady se hlídá, že se srovnávají stejné dny — a že
 * stránka to opravdu používá.
 *
 * Pusť `node scripts/finance-obdobi.test.mjs`.
 */

import { readFileSync } from 'node:fs'

const { hraniceMesice, popisCastecnehoObdobi, predchoziMesic, srovnatelnaObdobi } = await import('../lib/finance-obdobi.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const hodi = (fn) => { try { fn(); return false } catch { return true } }
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n== Měsíce ==')
ok('hranice říjnu', stejne(hraniceMesice('2026-10'), { od: '2026-10-01', doData: '2026-10-31' }))
ok('hranice února 2028 (přestupný)', stejne(hraniceMesice('2028-02'), { od: '2028-02-01', doData: '2028-02-29' }))
ok('před lednem je prosinec předchozího roku', predchoziMesic('2027-01') === '2026-12')
ok('nesmyslný měsíc → chyba', hodi(() => hraniceMesice('2026-13')) && hodi(() => predchoziMesic('2026-1')))

console.log('\n== Rozběhnutý měsíc: stejné dny ==')
{
  const s = srovnatelnaObdobi('2026-10', '2026-10-14')
  ok('1.–14. 10. proti 1.–14. 9. (produkční případ ze 14. 10.)',
    stejne(s.obdobi, { od: '2026-10-01', doData: '2026-10-14' }) && stejne(s.predchozi, { od: '2026-09-01', doData: '2026-09-14' }) && s.castecne)
  ok('popisek „1.–14. 9."', popisCastecnehoObdobi(s.predchozi) === '1.–14. 9.')
}
{
  const s = srovnatelnaObdobi('2026-03', '2026-03-30')
  ok('30. 3. proti únoru oříznutému na jeho konec (1.–28. 2.)', stejne(s.predchozi, { od: '2026-02-01', doData: '2026-02-28' }) && s.castecne)
}
{
  const s = srovnatelnaObdobi('2027-01', '2027-01-05')
  ok('leden proti prosinci předchozího roku', stejne(s.predchozi, { od: '2026-12-01', doData: '2026-12-05' }))
}
ok('první den měsíce proti prvnímu dni minulého', stejne(srovnatelnaObdobi('2026-10', '2026-10-01').predchozi, { od: '2026-09-01', doData: '2026-09-01' }))

console.log('\n== Uzavřený a poslední den ==')
{
  const s = srovnatelnaObdobi('2026-09', '2026-10-14')
  ok('uzavřený měsíc: celé měsíce, ne částečné', stejne(s.obdobi, { od: '2026-09-01', doData: '2026-09-30' }) &&
    stejne(s.predchozi, { od: '2026-08-01', doData: '2026-08-31' }) && !s.castecne)
}
{
  const s = srovnatelnaObdobi('2026-10', '2026-10-31')
  ok('poslední den měsíce = celý měsíc proti celému minulému (mzdy se srovnají)', stejne(s.predchozi, { od: '2026-09-01', doData: '2026-09-30' }) && !s.castecne)
}
ok('budoucí měsíc: celé měsíce', !srovnatelnaObdobi('2026-11', '2026-10-14').castecne)
ok('nesmyslné datum → chyba', hodi(() => srovnatelnaObdobi('2026-10', '2026-10-32')))

console.log('\n== Stránka a výpočet to opravdu používají ==')
{
  const stranka = readFileSync(new URL('../app/[rozsah]/finance/page.tsx', import.meta.url), 'utf8')
  ok('Přehled bere období ze srovnatelnaObdobi(mesic, dnes)', /const srovnani = srovnatelnaObdobi\(mesic, dnes\)/.test(stranka))
  ok('… a předává castecne do nactiFinanceKpi', /pobocka, srovnani\.castecne\)\.catch\(/.test(stranka))
  ok('všech pět karet má popisek srovnání ze srovnaniS', (stranka.match(/srovnaniS=\{srovnaniS\}/g) ?? []).length === 5)
  ok('mřížka grafů se na telefonu nevynucuje 360 px', /minmax\(min\(360px, 100%\), 1fr\)/.test(stranka) && !/minmax\(360px, 1fr\)/.test(stranka))
  const kpi = readFileSync(new URL('../lib/finance-kpi.ts', import.meta.url), 'utf8')
  ok('tržby předchozího období vlastním dotazem (ne od začátku minulého měsíce do dneška)',
    /nactiPrehledTrzeb\(tenantId, predchoziObdobi\.od, predchoziObdobi\.doData, 'mesic'\)/.test(kpi) &&
    !/nactiPrehledTrzeb\(tenantId, predchoziObdobi\.od, obdobi\.doData/.test(kpi))
  ok('mzdy předchozího období se u částečného srovnání nenačítají (jen celé měsíce)',
    /smiVidetMzdy && !srovnaniCastecne \? nactiSoucetMzdyHaleru\(tenantId, pobocka, predchoziObdobi\.od\)/.test(kpi))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
