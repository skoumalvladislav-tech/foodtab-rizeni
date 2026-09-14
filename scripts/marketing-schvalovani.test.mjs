#!/usr/bin/env node
/**
 * Fronta ke schválení — co jde ověřit bez databáze.
 *
 * Pusť `node scripts/marketing-schvalovani.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE ČTE ZDROJ, A NE VOLÁ FUNKCE
 *
 * Obrazovka je serverová komponenta a akce je `'use server'` — mimo
 * běžící aplikaci se ani jedno nedá zavolat. Čte se proto text souboru,
 * stejně jako v `scripts/marketing.test.mjs` a `scripts/nabidka.test.mjs`.
 *
 * Je to slabší kontrola než zavolat kód. Míří proto jen na věci, které
 * se v tomhle souboru UŽ JEDNOU POKAZILY nebo jsou pravidlem z CLAUDE.md
 * — ne na chování obrazovky obecně. To hlídají scénáře v databázi.
 */

import { readFileSync } from 'node:fs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const STRANKA = readFileSync('app/[rozsah]/marketing/schvalovani/page.tsx', 'utf8')
const AKCE = readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')

/*
  KOMENTÁŘE SE VYŠKRTÁVAJÍ, JINAK SE KONTROLA TREFÍ DO VLASTNÍHO
  VYSVĚTLENÍ.

  Kontroly „tohle se nepoužívá" hledají v textu souboru. Jenže přímo nad
  tím místem stojí komentář, který to zakázané slovo pojmenovává — a to
  je správně, tam patří. Při prvním běhu na to spadla kontrola na
  `getHours()`: v kódu nebylo, v komentáři ano.

  Hledá se proto v kódu BEZ komentářů. Zákazy se ptají `bezKomentaru`,
  kontroly „tohle tam být má" klidně celého souboru.
*/
const bezKomentaru = (zdroj) => zdroj
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

const STRANKA_KOD = bezKomentaru(STRANKA)

console.log('\n== Soubory se vůbec přečetly ==')

/*
  Kdyby se obrazovka přejmenovala, čtení výš spadne na výjimku — ale
  kdyby zůstal prázdný soubor, všechny kontroly níž by byly zelené nad
  ničím. Proto se nejdřív ověří, že v tom něco je.
*/
ok('obrazovka má tělo', STRANKA.length > 2000)
ok('akce mají tělo', AKCE.length > 2000)

console.log('\n== Vlastní žádost se pozná podle PŘIHLÁŠENÉHO, ne podle prvního v seznamu ==')

/*
  TOHLE JE TA CHYBA, KVŮLI KTERÉ TENHLE SOUBOR VZNIKL.

  `employees_select` pouští ke všem zaměstnancům každého, kdo má
  `shifts.read` nebo `people.manage`. Dotaz „vem zaměstnance téhle
  firmy" tedy nevrací mě, ale prvního, kterého smím vidět. Obrazovka
  by podle něj schovávala zaškrtávátko u cizích žádostí a žádost by se
  podepsala cizím jménem.

  Kontrola je schválně na OBOU místech — v akci i na obrazovce —,
  protože chyba byla v obou a opravit jedno je snadné.
*/
const ptaSeNaUcet = (zdroj) => /\.eq\('user_id', user\.id\)/.test(zdroj)

ok('obrazovka hledá můj záznam podle user_id', ptaSeNaUcet(STRANKA))
ok('a akce taky', ptaSeNaUcet(AKCE))

ok('obrazovka si vůbec zjistí, kdo je přihlášený', /getUser\(\)/.test(STRANKA))

/*
  A ŽE SE TO NEDÁ OBEJÍT JINÝM DOTAZEM.

  Kontrola výš se ptá, jestli se `user_id` v souboru vyskytuje. To by
  splnil i dotaz, který si `user_id` jen vybere do sloupců. Tahle se
  proto ptá jinak: KAŽDÝ dotaz do `employees` v obou souborech musí mít
  `.eq('user_id'` do dvou set znaků od sebe. Původní podoba —
  `.eq('tenant_id', …).limit(1)` — takhle neprojde.
*/
const dotazyNaZamestnance = (zdroj) =>
  [...bezKomentaru(zdroj).matchAll(/from\('employees'\)[\s\S]{0,250}/g)].map((m) => m[0])

for (const [kde, zdroj] of [['obrazovce', STRANKA], ['akcích', AKCE]]) {
  const dotazy = dotazyNaZamestnance(zdroj)
  ok(`v ${kde} se na zaměstnance vůbec někdo ptá`, dotazy.length > 0)
  ok(`a každý takový dotaz v ${kde} se ptá na můj účet`,
    dotazy.every((d) => /\.eq\('user_id'/.test(d)))
}

console.log('\n== Čas se formátuje přes pásmo (pravidlo 11) ==')

/*
  Server běží v UTC. `getHours()` by u žádosti podané ve 21:30 napsalo
  19:30 — a v zimě jinak než v létě. Pravidlo 11 z CLAUDE.md.
*/
ok('nepoužívá se getHours()', !/getHours\(\)/.test(STRANKA_KOD))
ok('ani toLocaleTimeString bez pásma', !/toLocaleTimeString\(\)/.test(STRANKA_KOD))
ok('formátuje se přes lib/cas.ts', /datumACasVPasmu/.test(STRANKA))
ok('a pásmo se bere z pobočky, ne z konstanty',
  /branches'\)[\s\S]{0,120}timezone/.test(STRANKA))
ok('s pojistkou přes firmu', /tenants'\)[\s\S]{0,80}timezone/.test(STRANKA))

console.log('\n== Schvaluje se znění, ne název ==')

/*
  Zadání, oddíl 14: schválení se váže na otisk konkrétní verze. Kdyby
  obrazovka ukazovala jen jméno příspěvku, schvalovalo by se klikání.
*/
ok('v seznamu je vidět text, který půjde ven', /textProKanal\(/.test(STRANKA))
ok('a kolik má fotek', /media_ids/.test(STRANKA))
ok('a která verze to je', /cislo/.test(STRANKA))

console.log('\n== Rozhoduje jen ten, kdo smí publikovat ==')

ok('obrazovka se ptá na marketing.publish', /'marketing\.publish'/.test(STRANKA))
ok('a vidět ji smí marketing.read', /'marketing\.read'/.test(STRANKA))

/*
  Zaškrtávátko se kreslí jen tomu, kdo smí rozhodovat. Není to zámek
  — ten je v databázi —, ale tlačítko, které skončí hláškou „nesmíte",
  je horší než tlačítko, které tam není.
*/
ok('bez práva publikovat se nekreslí zaškrtávátko',
  /smiRozhodovat \?[\s\S]{0,200}type="checkbox"/.test(STRANKA))

console.log('\n== Hromadné schválení jde po jedné ==')

/*
  JEDEN UPDATE NA ŽÁDOST, NE JEDEN NA VŠECHNY.

  Spoušť `app.marketing_strez_rozhodnuti` odmítá vlastní žádost
  výjimkou. Kdyby se poslal jeden `update … in (…)`, shodila by celá
  dávka kvůli jedné žádosti a neschválilo by se nic — ani to, co
  schválit šlo.
*/
const telo = AKCE.slice(AKCE.indexOf('export async function schvalitVice'))
ok('schvalitVice v akcích je', telo.length > 0)
ok('a prochází žádosti cyklem', /for \(const id of zadosti\)/.test(telo))
ok('a počítá, co prošlo', /hotovo\+\+/.test(telo))
ok('a řekne, co neprošlo a proč', /neproslo/.test(telo) && /duvod=/.test(telo))

/*
  Rozhodnutí se NEPODEPISUJE z aplikace. `rozhodl` a `rozhodnuto_kdy`
  nastavuje spoušť v databázi — kdyby je posílala akce, dalo by se
  schválení podepsat kýmkoli.
*/
ok('akce nenastavuje, kdo rozhodl', !/rozhodl:/.test(telo))
ok('ani kdy rozhodl', !/rozhodnuto_kdy:/.test(telo))

console.log('\n== Právo se ověřuje před zápisem, rozsah se nebere z formuláře ==')

ok('schvalitVice žádá marketing.publish',
  /pripravit\(rozsah, 'marketing\.publish'\)/.test(telo))
ok('a nebere branch_id ze skrytého pole',
  !/branch_id:\s*String\(formData/.test(telo))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
