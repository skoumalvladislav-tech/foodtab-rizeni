#!/usr/bin/env node
/**
 * Auditní přehled marketingu — lib/marketing-audit.ts.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-audit.test.mjs
 *
 * ---------------------------------------------------------------------
 * NEJDŮLEŽITĚJŠÍ KONTROLA JE TA OBOUSMĚRNÁ
 *
 * Mapa `ENTITY` překládá databázový název na český. Když v ní překlad
 * CHYBÍ, ukáže se na obrazovce syrové `marketing_publikace_uloha` —
 * pravda, ale nikdo z provozu z toho nic nevyčte. Když v ní PŘEBÝVÁ,
 * znamená to, že se entita někde přejmenovala a nedotáhlo se to.
 *
 * Ani jedno se nepozná pohledem do kódu — pozná se to porovnáním
 * s tím, co do auditu opravdu zapisují spouště v migracích.
 *
 * ---------------------------------------------------------------------
 * A PROTO SE ČTOU MIGRACE V POŘADÍ, NE GREPEM
 *
 * Grep by na tomhle selhal a bylo by to vidět až u zákazníka:
 * v migracích jsou i STARÉ názvy z prvních verzí modulu
 * (`marketing_post`, `marketing_photo`, `marketing_template`,
 * `marketing_settings`, `marketing_integration`). Ty spouště už
 * neexistují — pozdější migrace je nahradila přes
 * `drop trigger if exists` + `create trigger`.
 *
 * Čte se to proto jako databáze: soubory v pořadí razítek, každá
 * spoušť si pamatuje poslední definici. Vyjde z toho přesně ten
 * seznam, který je v ostré databázi — ověřeno 14. 9. 2026 dotazem na
 * `pg_trigger` ve `foodtab-test`: obojí dalo tytéž dvacet entit.
 */

import fs from 'node:fs'
import path from 'node:path'

const KOREN = path.join(import.meta.dirname, '..')
const MIGRACE = path.join(KOREN, 'supabase', 'migrations')

const {
  ENTITY,
  popisEntity,
  popisUkonu,
  popisSloupce,
  popisZmen,
  popisKonatele,
  vOkne,
  OKNA,
  okno,
} = await import('../lib/marketing-audit.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/* ------------------------------------------------------------------ *
 * Co do auditu zapisují spouště, které dnes OPRAVDU existují.
 * ------------------------------------------------------------------ */

function bezKomentaru(text) {
  return text
    .split('\n')
    .map((r) => {
      const i = r.indexOf('--')
      return i === -1 ? r : r.slice(0, i)
    })
    .join('\n')
    .split(/\/\*[\s\S]*?\*\//)
    .join(' ')
}

/** Spoušť → entita, jak by to dopadlo po projetí všech migrací. */
function entityZMigraci() {
  const spouste = new Map()
  const soubory = fs.readdirSync(MIGRACE).filter((s) => s.endsWith('.sql')).sort()

  for (const soubor of soubory) {
    const kod = bezKomentaru(fs.readFileSync(path.join(MIGRACE, soubor), 'utf8'))

    for (const m of kod.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?(\w+)\s+on\s+public\.(\w+)/gi)) {
      spouste.delete(`${m[2]}.${m[1]}`)
    }

    /*
      ZAHOZENÁ TABULKA BERE SPOUŠTĚ S SEBOU, a bez tohohle to nevyjde.
      Právě na tom se tahle kontrola při psaní poprvé chytila: dala
      25 entit, zatímco v ostré databázi jich je 20. Těch pět navíc
      byly spouště starého marketingu (`marketing_post`,
      `marketing_photo`, `marketing_template`, `marketing_settings`,
      `marketing_integration`) — jejich tabulky zahodila migrace
      20260908... a spouště zanikly s nimi, aniž je kdo dropoval
      jménem.
    */
    for (const m of kod.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/gi)) {
      for (const klic of [...spouste.keys()]) {
        if (klic.startsWith(`${m[1]}.`)) spouste.delete(klic)
      }
    }

    const re = /create\s+trigger\s+(\w+)[\s\S]{0,400}?\son\s+public\.(\w+)[\s\S]{0,400}?audit_zmenu\('(\w+)'\)/gi
    for (const m of kod.matchAll(re)) {
      spouste.set(`${m[2]}.${m[1]}`, m[3])
    }
  }

  return [...spouste.values()].filter((e) => e.startsWith('marketing')).sort()
}

const zMigraci = entityZMigraci()

console.log(`\n== Entity, které do auditu zapisují spouště (${zMigraci.length}) ==\n`)
console.log(`  ${zMigraci.join(', ')}\n`)

/*
  Dvacet je počet z ostré databáze ke 14. 9. 2026. Když se to číslo
  rozejde, chce to znovu ověřit obojí — ne spravit tenhle řádek.
*/
ok('spouští se našlo aspoň dvacet', zMigraci.length >= 20)
ok('a nejsou mezi nimi staré anglické názvy',
  !zMigraci.includes('marketing_post') && !zMigraci.includes('marketing_photo') &&
  !zMigraci.includes('marketing_template') && !zMigraci.includes('marketing_settings') &&
  !zMigraci.includes('marketing_integration'))

console.log('\n== Každá entita má český překlad ==\n')

for (const e of zMigraci) {
  ok(`${e} je v mapě`, Object.prototype.hasOwnProperty.call(ENTITY, e))
}

console.log('\n== A v mapě nic nepřebývá ==\n')

for (const e of Object.keys(ENTITY)) {
  ok(`${e} opravdu existuje`, zMigraci.includes(e))
}

console.log('\n== Překlady ==\n')

ok('neznámá entita se ukáže tak, jak je', popisEntity('marketing_neco') === 'marketing_neco')
ok('známá se přeloží', popisEntity('marketing_prispevek') === 'Příspěvek')
ok('fotka je pod anglickým klíčem', popisEntity('marketing_medium') === 'Fotka')

ok('insert je „založeno"', popisUkonu('marketing_prispevek.insert') === 'založeno')
ok('update je „změněno"', popisUkonu('marketing_prispevek.update') === 'změněno')
ok('delete je „smazáno"', popisUkonu('marketing_prispevek.delete') === 'smazáno')
ok('neznámý úkon se ukáže tak, jak je', popisUkonu('marketing_prispevek.neco') === 'neco')
ok('akce bez tečky se nerozbije', popisUkonu('insert') === 'založeno')

ok('známý sloupec se přeloží', popisSloupce('pripominka') === 'připomínka')
ok('neznámý zůstane', popisSloupce('nejaky_novy_sloupec') === 'nejaky_novy_sloupec')

console.log('\n== Výpis změn ==\n')

ok('prázdno nedá nic', popisZmen([]) === '')
ok('null nedá nic', popisZmen(null) === '')
ok('jeden sloupec', popisZmen(['stav']) === 'stav')
ok('tři se vypíšou celé', popisZmen(['stav', 'nazev', 'pripominka']) === 'stav, název, připomínka')
ok('čtyři se useknou', popisZmen(['stav', 'nazev', 'pripominka', 'rozhodl']) ===
  'stav, název, připomínka a další 1')
ok('a u deseti sedí i to číslo',
  popisZmen(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']).endsWith('a další 7'))

console.log('\n== Kdo to udělal ==\n')

/*
  Tohle je proti pokušení vyplnit prázdné jméno dohadem. „Někdo"
  je pravda; vymyšlené jméno by nebylo — a u auditu je nepravda
  horší než mezera.
*/
ok('jméno se ukáže', popisKonatele('Jana Nováková', 'user') === 'Jana Nováková')
ok('prázdné jméno u člověka je „někdo"', popisKonatele('', 'user') === 'někdo')
ok('null u člověka taky', popisKonatele(null, 'user') === 'někdo')
ok('mezery se neberou jako jméno', popisKonatele('   ', 'user') === 'někdo')
ok('systém je „automat"', popisKonatele(null, 'system') === 'automat')
ok('agent je „agent"', popisKonatele(null, 'agent') === 'agent')
ok('ale pojmenovaný automat si jméno nechá', popisKonatele('Noční úloha', 'system') === 'Noční úloha')

console.log('\n== Okno ==\n')

ok('výchozí je sedm dní', okno(undefined).dnu === 7)
ok('neznámý klíč spadne na výchozí', okno('nesmysl').klic === '7')
ok('„vse" znamená bez omezení', okno('vse').dnu === 0)
ok('okna mají jedinečné klíče', new Set(OKNA.map((o) => o.klic)).size === OKNA.length)

ok('záznam v okně projde', vOkne('2026-09-14T10:00:00Z', '2026-09-07T00:00:00Z'))
ok('starší neprojde', !vOkne('2026-09-01T10:00:00Z', '2026-09-07T00:00:00Z'))
ok('přesně na hranici projde', vOkne('2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
