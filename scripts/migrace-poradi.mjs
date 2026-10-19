#!/usr/bin/env node
/**
 * Migrace jen přibývají — a nová má razítko NOVĚJŠÍ než všechny v základu.
 *
 * Pusť: node scripts/migrace-poradi.mjs <základ> [--pracovni]
 *   <základ>    origin/main (u PR) nebo commit před pushem do main
 *   --pracovni  počítá i nezapsané změny v pracovní kopii (schválné
 *               rozbití na stroji bez commitu)
 *
 * Proč (kontrola PR #147, 19. 10. 2026):
 *   1. `supabase db push` odmítne migraci starší než poslední nasazenou
 *      („Found local migration files to be inserted before the last
 *      migration") — stalo se u #86/#88 (hlášení 29. 9.). PR, který se
 *      slučuje později, musí mít novější razítko, jinak se nedá nasadit
 *      bez --include-all (a v produkci by pak migrace běžely jinak, než
 *      je testuje CI).
 *   2. Smazaná nebo přejmenovaná migrace (třeba obyčejným revertem PR po
 *      db push) rozbije historii: další db push spadne na „Remote
 *      migration versions not found in local migrations directory".
 *      Upravená už sloučená migrace se nikdy znovu nespustí.
 *
 * Když se základ nenačte (mělký checkout), skončí CHYBOU — prázdný seznam
 * migrací základu by jinak pustil cokoli.
 */

import { execFileSync } from 'node:child_process'

const ADRESAR = 'supabase/migrations/'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const zakladRef = process.argv[2]
const pracovni = process.argv.includes('--pracovni')

const konec = (zprava) => {
  console.error(`::error::${zprava}`)
  process.exit(1)
}

if (!zakladRef) konec('Chybí základ (origin/main nebo commit před pushem).')
let zaklad
try {
  zaklad = git('merge-base', 'HEAD', zakladRef)
} catch {
  konec(`Základ „${zakladRef}" nenalezen — checkout potřebuje celou historii (fetch-depth: 0).`)
}

const vZakladu = git('ls-tree', '--name-only', zaklad, ADRESAR).split('\n').filter((f) => f.endsWith('.sql'))
if (vZakladu.length < 50) konec(`Základ má jen ${vZakladu.length} migrací — nenačetl se celý (čekám desítky).`)
const razitko = (cesta) => /\/(\d{14})_/.exec(cesta)?.[1] ?? null
const nejnovejsi = vZakladu.map(razitko).filter(Boolean).sort().at(-1)

// A přidaná, D smazaná, M upravená, R přejmenovaná (git diff --name-status).
const zmeny = git('diff', '--name-status', '-M', zaklad, ...(pracovni ? [] : ['HEAD']), '--', ADRESAR)
  .split('\n').filter(Boolean).map((r) => r.split('\t'))
if (pracovni) {
  for (const f of git('ls-files', '--others', '--exclude-standard', '--', ADRESAR).split('\n').filter(Boolean)) zmeny.push(['A', f])
}

const chyby = []
for (const [druh, a, b] of zmeny) {
  if (!a.endsWith('.sql') && !(b ?? '').endsWith('.sql')) continue
  if (druh === 'D') chyby.push(`smazaná migrace ${a} — po db push se soubor mazat nesmí (návrat zpět: vrátit kód BEZ souboru migrace)`)
  else if (druh.startsWith('R')) chyby.push(`přejmenovaná migrace ${a} → ${b} — sloučená migrace se nepřejmenovává`)
  else if (druh === 'M') chyby.push(`upravená migrace ${a} — sloučená migrace se neupravuje, přidej novou`)
  else if (druh === 'A') {
    const r = razitko(a)
    if (!r) chyby.push(`${a}: jméno bez razítka RRRRMMDDHHMMSS_`)
    else if (r <= nejnovejsi) chyby.push(`${a}: razítko ${r} není novější než poslední v main (${nejnovejsi}) — db push by ji odmítl, přerazítkuj ji`)
  }
}

console.log(`Základ ${zaklad.slice(0, 7)}: ${vZakladu.length} migrací, nejnovější ${nejnovejsi}. Změn v ${ADRESAR}: ${zmeny.length}.`)
if (chyby.length > 0) {
  for (const c of chyby) console.error(`::error::${c}`)
  process.exit(1)
}
console.log('Migrace jen přibývají a nové jsou novější než main.')
