#!/usr/bin/env node
/**
 * Fronta publikací — rozhodování o odeslání a napojení na databázi.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-fronta.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO TU JDE OVĚŘIT A CO NE
 *
 * Chování fronty samotné (co se smí poslat) hlídá `marketing7_scenar`
 * v databázi — tam patří, protože tam se to rozhoduje. Tenhle test
 * kryje dvě mezery, na které scénář nedosáhne:
 *
 *   1. ROZHODNUTÍ V APLIKACI. Který režim se pošle ven, který se
 *      odloží člověku a který se přizná, že neumí.
 *   2. JMÉNA, KTERÁ MUSÍ SEDĚT NA OBOU STRANÁCH. Adresa volá funkce
 *      databáze jménem, jako řetězec. Přejmenování v migraci se
 *      překladem NEPOZNÁ — projde build, projdou testy a fronta pak
 *      v ostrém provozu mlčky nic neodešle. Přesně tahle třída chyby
 *      je jinde v projektu ošetřená stejně (scripts/marketing.test.mjs,
 *      „obrazovka to opravdu volá").
 */

import { readFileSync } from 'node:fs'

import { odeslat } from '../lib/marketing-odeslani.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const ZAKLAD = {
  id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 't',
  branch_id: 'b',
  prispevek_id: 'p',
  verze_id: 'v',
  kanal: 'instagram',
  format: 'prispevek',
  poskytovatel: 'mock',
  rezim: 'demo',
  pripojeni_id: null,
  ucet_id: null,
  idempotencni_klic: 'klic-1',
  pokusy: 1,
  max_pokusu: 5,
  texty: { instagram: { popisek: 'Dnes vaříme svíčkovou.' } },
  media_ids: [],
}

const uloha = (zmeny) => ({ ...ZAKLAD, ...zmeny })

console.log('\n== Demo nikam nic neposílá ==')

const demo = await odeslat(uloha({ rezim: 'demo' }))

ok('demo skončí jako hotové', demo.stav === 'hotovo')
ok('a je označené jako nanečisto', demo.stav === 'hotovo' && demo.nanecisto === true)

/*
  Demo se nesmí dát splést se skutečností ani podle vnějšího id.
  Kdyby vypadalo jako id od Mety, hledalo by se pak na Instagramu
  něco, co tam nikdy nebylo.
*/
ok('a vnější id je na první pohled nanečisto',
  demo.stav === 'hotovo' && String(demo.externiId).startsWith('nanecisto-'))

console.log('\n== Ruční režim je vlastní stav, ne chyba ==')

const rucni = await odeslat(uloha({ rezim: 'rucni' }))

ok('ruční režim není chyba', rucni.stav === 'rucne')
ok('a řekne proč', rucni.stav === 'rucne' && rucni.duvod.length > 0)

console.log('\n== Bez připojeného účtu se to přizná ==')

/*
  Nejhorší možná odpověď je „hotovo" u něčeho, co nikam neodešlo.
  Druhá nejhorší je hláška, ze které se nepozná, co má člověk udělat.
*/
const bezUctu = await odeslat(uloha({ rezim: 'zakaznicky', pripojeni_id: null, ucet_id: null }))

ok('bez připojení to selže', bezUctu.stav === 'chyba')
ok('hláška jmenuje kanál', bezUctu.stav === 'chyba' && bezUctu.duvod.includes('Instagram'))
ok('a řekne, kam se má člověk podívat',
  bezUctu.stav === 'chyba' && /nastaven/i.test(bezUctu.duvod))

const facebook = await odeslat(uloha({ rezim: 'zakaznicky', kanal: 'facebook' }))
ok('u Facebooku jmenuje Facebook',
  facebook.stav === 'chyba' && facebook.duvod.includes('Facebook'))

console.log('\n== Nehotové zveřejňování se netváří jako hotové ==')

/*
  Zveřejňování k Metě čeká na nahrávání fotek. Dokud to neexistuje,
  musí úloha SELHAT se srozumitelnou hláškou — nesmí se zapsat jako
  zveřejněná a nesmí se tvářit jako demo.
*/
const meta = await odeslat(uloha({
  rezim: 'zakaznicky',
  pripojeni_id: 'c1',
  ucet_id: 'u1',
}))

ok('s připojením, ale bez hotového odesílání, to selže', meta.stav === 'chyba')
ok('a hláška navrhne, co dělat mezitím',
  meta.stav === 'chyba' && /ruční režim/i.test(meta.duvod))

console.log('\n== Jména funkcí sedí s migrací ==')

const migrace = readFileSync('supabase/migrations/20260910040000_marketing_fronta.sql', 'utf8')
const trasa = readFileSync('app/api/uloha/marketing-fronta/route.ts', 'utf8')

for (const jmeno of [
  'marketing_vyzvednout_publikace',
  'marketing_publikace_hotova',
  'marketing_publikace_k_rukam',
  'marketing_publikace_selhala',
]) {
  ok(`${jmeno} je v migraci`, migrace.includes(`create or replace function public.${jmeno}`))
  ok(`${jmeno} volá adresa`, trasa.includes(`'${jmeno}'`))
}

/*
  Funkce musí být v `public`. PostgREST jiné schéma nevidí a volání
  by skončilo na 404 — tedy hlášce, která vypadá jako překlep
  v názvu, ne jako chybějící oprávnění.
*/
ok('žádná funkce fronty nezůstala ve schématu app',
  !/create or replace function app\.marketing_(vyzvednout|publikace)/.test(migrace))

/*
  A nesmí být k dispozici přihlášenému uživateli. Kdyby byla, obešel
  by kdokoli s přihlášením celé schvalování: vyzvednout a zapsat
  „hotovo" stačí.
*/
ok('žádná z nich není povolená roli authenticated',
  !/grant execute on function public\.marketing_(vyzvednout_publikace|publikace_[a-z_]+)\([^)]*\)\s*\n?\s*to [^;]*authenticated/.test(migrace))

console.log('\n== Parametry sedí s migrací ==')

/*
  Volají se jménem i parametry. Přejmenovaný parametr projde
  překladem stejně tiše jako přejmenovaná funkce — PostgREST pak
  vrátí „function not found", protože hledá podle jmen argumentů.
*/
for (const par of ['p_kolik', 'p_uloha', 'p_externi_id', 'p_odkaz', 'p_odpoved', 'p_nanecisto', 'p_chyba', 'p_duvod']) {
  ok(`parametr ${par} je v migraci`, migrace.includes(par))
  ok(`a adresa ho posílá`, trasa.includes(`${par}:`))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
