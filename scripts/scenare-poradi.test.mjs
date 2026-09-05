#!/usr/bin/env node
/**
 * Scénáře: nejdřív zjisti, kdo jsi, teprve pak se jím staň.
 *
 * Pusť `node scripts/scenare-poradi.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE 5. 9. STALO
 *
 * `krok23_scenar.sql` měl:
 *
 *     set role authenticated;
 *     select set_config('test.user_id',
 *       (select user_id::text from public.profiles where email = '…'), false);
 *
 * Role se nastavila DŘÍV, než se zjistilo, kdo to je. V tu chvíli už
 * `public.profiles` čte `authenticated` bez `auth.uid()`, politika mu
 * ten řádek nedá, `set_config` dostane NULL — a scénář pak tiše zkouší
 * NEPŘIHLÁŠENÉHO člověka. Kontrola spadne na něčem úplně jiném, než co
 * měří, a hledá se to půl hodiny.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NECHYTÍ PGLITE
 *
 * V PGlite se běží jako superuživatel: `set role authenticated` tam RLS
 * nezapne, takže se profil přečte a scénář projde — i když proti
 * opravdovému PostgreSQL, kde na tom stojí celá druhá obranná linie,
 * neprojde. Čísla z PGlite se proto nedají hlásit jako výsledek.
 *
 * Tahle kontrola tu mezeru zalepuje z druhé strany: nespouští SQL,
 * ale hlídá ten VZOREC. Je to chyba, která se opisuje — proto se hlídá
 * tvar, ne jeden konkrétní soubor.
 */

import fs from 'node:fs'
import path from 'node:path'

const TESTY = new URL('../supabase/tests/', import.meta.url)

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/**
 * Najde místa, kde se pod rolí `authenticated` čte účet poddotazem.
 *
 * Sleduje se stav role: `set role authenticated` ji zapne, `reset role`
 * vypne. Uvnitř zapnuté role se hledá `set_config('test.user_id', …)`,
 * jehož ARGUMENT obsahuje `select` — tedy čtení z tabulky, na kterou
 * v tu chvíli platí RLS.
 *
 * Psql proměnná (`:'majitel'`) ani zapsané UUID nevadí: ty jsou známé
 * dřív, než se příkaz odešle.
 */
export function podezrela(text) {
  const r = text.split('\n')
  const nalezy = []
  let vRoli = false

  for (let i = 0; i < r.length; i++) {
    const radek = r[i].trim()
    if (/^reset role\s*;/.test(radek)) vRoli = false
    if (/^(set|set local)\s+role\s+authenticated\s*;/.test(radek)) vRoli = true
    if (!vRoli) continue
    if (!/set_config\(\s*['"]test\.user_id/.test(radek)) continue

    // Slepit celý příkaz až po středník — bývá na dvou řádcích.
    let prikaz = radek
    let k = i
    while (!prikaz.includes(';') && k + 1 < r.length) {
      k += 1
      prikaz += ' ' + r[k].trim()
    }
    const argument = prikaz.slice(prikaz.indexOf('set_config('))
    if (/\bselect\b/i.test(argument)) nalezy.push({ radek: i + 1, prikaz: argument.trim() })
  }
  return nalezy
}

console.log('\n== Kdo jsem se zjišťuje před set role =====================')

const soubory = fs
  .readdirSync(TESTY)
  .filter((f) => f.endsWith('.sql'))
  .sort()

ma('scénáře se vůbec našly', soubory.length > 0, true)

let celkem = 0
for (const f of soubory) {
  const nalezy = podezrela(fs.readFileSync(new URL(f, TESTY), 'utf8'))
  celkem += nalezy.length
  if (nalezy.length > 0) {
    for (const n of nalezy) {
      console.log(`  CHYBA ${f}:${n.radek} — účet se čte až pod rolí`)
      console.log(`        ${n.prikaz.slice(0, 100)}`)
    }
    chyb += nalezy.length
  }
}
ma(`v ${soubory.length} scénářích se účet nikde nečte pod rolí`, celkem, 0)

/* --- a kontrola sama musí umět spadnout -------------------------------- */

console.log('\n== Kontrola umí spadnout ==================================')

const ZLE = [
  'set role authenticated;',
  "select set_config('test.user_id',",
  "  (select user_id::text from public.profiles where email = 'x@y.cz'), false);",
].join('\n')

const DOBRE = [
  "select set_config('test.user_id',",
  "  (select user_id::text from public.profiles where email = 'x@y.cz'), false);",
  'set role authenticated;',
].join('\n')

const PSQL_PROMENNA = ["set role authenticated;", "select set_config('test.user_id', :'sef', false);"].join('\n')

ma('špatné pořadí pozná', podezrela(ZLE).length, 1)
ma('správné pořadí propustí', podezrela(DOBRE).length, 0)
ma('psql proměnnou po set role propustí', podezrela(PSQL_PROMENNA).length, 0)
ma(
  'a po reset role už nehlídá',
  podezrela('set role authenticated;\nreset role;\n' + ZLE.split('\n').slice(1).join('\n')).length,
  0,
)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
