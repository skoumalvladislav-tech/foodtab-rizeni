#!/usr/bin/env node
/**
 * Ruční „Synchronizovat teď" u banky — lib/banka-synchronizace.ts.
 *
 * Nález 11. 10. 2026: tlačítko volalo u každého připojení synchronizaci
 * Fio a připojení přes agregátor tím rozbilo (stav „chyba", úloha ho
 * pak už nevzala). Test hlídá, že se volá synchronizace podle
 * poskytovatele a že neznámý poskytovatel nespustí nic.
 *
 * Pusť `node scripts/banka-synchronizace.test.mjs`.
 */

const { synchronizovatPodlePoskytovatele } = await import('../lib/banka-synchronizace.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function synchronizatory() {
  const volani = []
  const fn = (klic) => async (id) => { volani.push(`${klic}:${id}`); return { stav: 'ok', pocetNovychRadku: klic === 'fio' ? 3 : 7 } }
  return { volani, mapa: { fio: fn('fio'), saltedge: fn('saltedge') } }
}

console.log('\n== Synchronizace podle poskytovatele ==')
{
  const s = synchronizatory()
  const v = await synchronizovatPodlePoskytovatele({ id: 'p-fio', poskytovatel: 'fio' }, s.mapa)
  ok('Fio připojení spustí synchronizaci Fio (a nic jiného)', s.volani.join() === 'fio:p-fio' && v.stav === 'ok' && v.pocetNovychRadku === 3)
}
{
  const s = synchronizatory()
  const v = await synchronizovatPodlePoskytovatele({ id: 'p-se', poskytovatel: 'saltedge' }, s.mapa)
  ok('připojení přes agregátor NESPUSTÍ synchronizaci Fio', !s.volani.some((x) => x.startsWith('fio')))
  ok('… spustí svou vlastní', s.volani.join() === 'saltedge:p-se' && v.stav === 'ok' && v.pocetNovychRadku === 7)
}
{
  const s = synchronizatory()
  const v = await synchronizovatPodlePoskytovatele({ id: 'p-x', poskytovatel: 'enablebanking' }, s.mapa)
  ok('poskytovatel bez synchronizace → chyba s vysvětlením, nic se nespustí', v.stav === 'chyba' && v.duvod.length > 0 && s.volani.length === 0)
}
{
  const s = synchronizatory()
  const v = await synchronizovatPodlePoskytovatele({ id: 'p-y', poskytovatel: 'toString' }, s.mapa)
  ok('název poskytovatele shodný s vlastností objektu (toString) nic nespustí', v.stav === 'chyba' && s.volani.length === 0)
}
{
  const chybova = { fio: async () => ({ stav: 'chyba', duvod: 'Fio API: token neexistuje.' }) }
  const v = await synchronizovatPodlePoskytovatele({ id: 'p-f', poskytovatel: 'fio' }, chybova)
  ok('chyba synchronizace se předá beze změny', v.stav === 'chyba' && v.duvod === 'Fio API: token neexistuje.')
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
