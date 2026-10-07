#!/usr/bin/env node
/**
 * `jeNaCaseSynchronizovat` — čistá logika z lib/integrace-fio-sync.ts,
 * žádné IO. Testuje, jestli appka respektuje vlastní odstup per
 * připojení (zadání §2: "interval synchronizace"), bez databáze.
 *
 * Pusť `node --experimental-strip-types --conditions=react-server
 * scripts/integrace-fio-sync.test.mjs` — `--conditions=react-server`
 * je potřeba, protože `lib/integrace-fio-sync.ts` má `import
 * 'server-only'` (stejný důvod jako u integrace-fio.test.mjs).
 */

const { jeNaCaseSynchronizovat } = await import('../lib/integrace-fio-sync.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Nikdy nesynchronizováno — appka vždy zkusí, bez ohledu na interval ==')
ok('posledni_sync_kdy null → true i s intervalem 1000 minut', jeNaCaseSynchronizovat(null, 1000, new Date('2026-10-07T12:00:00Z')))

console.log('\n== Bez vlastního intervalu appka nevynucuje nic navíc ==')
ok('interval null → true i hned po minutě', jeNaCaseSynchronizovat('2026-10-07T11:59:00Z', null, new Date('2026-10-07T12:00:00Z')))

console.log('\n== Vlastní interval appka respektuje ==')
ok(
  'interval 240 min, uplynulo jen 60 → NEsynchronizovat (false)',
  jeNaCaseSynchronizovat('2026-10-07T11:00:00Z', 240, new Date('2026-10-07T12:00:00Z')) === false,
)
ok(
  'interval 240 min, uplynulo přesně 240 → synchronizovat (true, hranice patří dovnitř)',
  jeNaCaseSynchronizovat('2026-10-07T08:00:00Z', 240, new Date('2026-10-07T12:00:00Z')) === true,
)
ok(
  'interval 240 min, uplynulo 241 → synchronizovat (true)',
  jeNaCaseSynchronizovat('2026-10-07T07:59:00Z', 240, new Date('2026-10-07T12:00:00Z')) === true,
)
ok(
  'kratší vlastní interval (15 min) appka respektuje — 20 uplynulých minut už stačí',
  jeNaCaseSynchronizovat('2026-10-07T11:40:00Z', 15, new Date('2026-10-07T12:00:00Z')) === true,
)
ok(
  'a 10 uplynulých minut na 15minutový interval ještě nestačí',
  jeNaCaseSynchronizovat('2026-10-07T11:50:00Z', 15, new Date('2026-10-07T12:00:00Z')) === false,
)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
