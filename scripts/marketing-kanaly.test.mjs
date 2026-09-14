#!/usr/bin/env node
/**
 * Pravidla sítí — co Instagram a Facebook snesou.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-kanaly.test.mjs
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE VZNIKLO
 *
 * Do 14. 9. 2026 se obě sítě chovaly stejně, protože se o rozdílech
 * nikde nerozhodovalo. Mělo to jeden konkrétní následek: odesílání
 * odmítalo KAŽDÝ příspěvek bez fotky větou „Instagram příspěvek bez
 * fotky nepřijme". U Instagramu to platí, u Facebooku ne — stránka
 * text bez obrázku přijme normálně.
 *
 * Facebook tedy nešel zveřejnit textem, ačkoli to síť umí. Nic
 * nespadlo, nic to nehlásilo; jen to nešlo.
 */

import { readFileSync } from 'node:fs'

import { FORMATY } from '../lib/marketing-formaty.ts'
import {
  coNejde,
  pravidlaKanalu,
  specProUlohu,
  spocitatHashtagy,
  zkontrolovat,
} from '../lib/marketing-kanaly.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, skutecnost === cekano, `${skutecnost} ≠ ${cekano}`)

const pujde = (vstup) => coNejde(zkontrolovat(vstup)).length === 0
const duvody = (vstup) => coNejde(zkontrolovat(vstup)).map((n) => n.text).join(' ')

const ZAKLAD = { format: 'prispevek', text: 'Dnes vaříme svíčkovou.', pocetFotek: 1 }

console.log('\n== Sítě se liší, a liší se v tom, na čem záleží ==')

const ig = pravidlaKanalu('instagram')
const fb = pravidlaKanalu('facebook')

ok('Instagram má pravidla', Boolean(ig))
ok('Facebook taky', Boolean(fb))
ma('Instagram fotku POTŘEBUJE', ig.potrebujeFotku, true)
ma('Facebook fotku nepotřebuje', fb.potrebujeFotku, false)
ok('a stropy popisku se liší', ig.stropZnaku !== fb.stropZnaku)

/*
  Limity se NEOPISUJÍ — tahají se z `lib/marketing-formaty.ts`. Dvě
  tabulky s čísly by se rozešly a nikdo by nevěděl, která platí.
*/
ma('strop Instagramu sedí s formáty', ig.stropZnaku, FORMATY.instagram_feed.captionMaxChars)
ma('strop Facebooku taky', fb.stropZnaku, FORMATY.facebook_post.captionMaxChars)
ma('a hashtagy Instagramu', ig.stropHashtagu, FORMATY.instagram_feed.hashtagsMax)
ma('a hashtagy Facebooku', fb.stropHashtagu, FORMATY.facebook_post.hashtagsMax)

ok('neznámá síť pravidla nemá', pravidlaKanalu('tiktok') === undefined)

console.log('\n== TA CHYBA: Facebook bez fotky ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  Přesně tohle do 14. 9. nešlo. Kdyby se pravidlo „bez fotky ne"
  vrátilo zpátky pro obě sítě, spadne to tady.
*/
ok('Facebook se samotným textem PROJDE',
  pujde({ ...ZAKLAD, kanal: 'facebook', pocetFotek: 0 }),
  duvody({ ...ZAKLAD, kanal: 'facebook', pocetFotek: 0 }))

ok('Instagram bez fotky neprojde',
  !pujde({ ...ZAKLAD, kanal: 'instagram', pocetFotek: 0 }))

ok('a řekne se proč a co s tím',
  /fotky nepřijme/.test(duvody({ ...ZAKLAD, kanal: 'instagram', pocetFotek: 0 })))

ok('v hlášce stojí Instagram, ne obecně „síť"',
  /Instagram/.test(duvody({ ...ZAKLAD, kanal: 'instagram', pocetFotek: 0 })))

ok('s fotkou projdou obě',
  pujde({ ...ZAKLAD, kanal: 'instagram' }) && pujde({ ...ZAKLAD, kanal: 'facebook' }))

console.log('\n== Co se ven poslat nedá ==')

ok('prázdný text neprojde', !pujde({ ...ZAKLAD, kanal: 'facebook', text: '   ' }))
ok('a řekne se, které síti chybí',
  /Facebook/.test(duvody({ ...ZAKLAD, kanal: 'facebook', text: '  ' })))

/*
  Strop znaků se liší podle sítě. Text, který Instagram odmítne,
  na Facebooku v pohodě projde — a kdyby se měřilo jedním číslem pro
  obojí, byla by jedna z těch dvou sítí buď zbytečně osekaná, nebo by
  se do ní posílalo, co odmítne.
*/
const dlouhy = 'a'.repeat(3000)
ok('3 000 znaků Instagram odmítne', !pujde({ ...ZAKLAD, kanal: 'instagram', text: dlouhy }))
ok('ale Facebook je vezme', pujde({ ...ZAKLAD, kanal: 'facebook', text: dlouhy }))
ok('a v hlášce je vidět kolik se vejde',
  /2200|2 200/.test(duvody({ ...ZAKLAD, kanal: 'instagram', text: dlouhy })))

ok('neznámá síť se odmítne', !pujde({ ...ZAKLAD, kanal: 'tiktok' }))
ok('a poradí se ruční cesta', /ručně/.test(duvody({ ...ZAKLAD, kanal: 'tiktok' })))

console.log('\n== Hashtagy navíc jsou varování, ne překážka ==')

/*
  Síť příspěvek vezme a hashtagy přes limit ignoruje. Odmítnout to by
  bylo přísnější než sama síť — a to je horší než mlčet.
*/
const hodne = `Svíčková ${Array.from({ length: 40 }, (_, i) => `#tag${i}`).join(' ')}`
const nalezyHodne = zkontrolovat({ ...ZAKLAD, kanal: 'instagram', text: hodne })

ok('příspěvek s přemírou hashtagů projde', pujde({ ...ZAKLAD, kanal: 'instagram', text: hodne }))
ok('ale ozve se varování', nalezyHodne.some((n) => n.druh === 'varovani'))
ok('a řekne, že se zbytek zahodí',
  nalezyHodne.some((n) => /zahodí/.test(n.text)))

console.log('\n== Počítání hashtagů se neplete ==')

/*
  Počítá se `#` na začátku slova. Kdyby se počítal každý křížek,
  varovalo by to u textů, kde žádný hashtag není — a varování, které
  se plete, si člověk odvykne číst.
*/
ma('dva hashtagy', spocitatHashtagy('Dnes #svickova a #knedlik'), 2)
ma('křížek uprostřed slova se nepočítá', spocitatHashtagy('menu c#1 a b#2'), 0)
ma('ani v adrese', spocitatHashtagy('napiš na info@foodtab.cz#kontakt'), 0)
ma('na začátku řádku se počítá', spocitatHashtagy('#svickova'), 1)
ma('v závorce taky', spocitatHashtagy('svíčková (#nedele)'), 1)
ma('diakritika je součást hashtagu', spocitatHashtagy('#dobréjídlo'), 1)
ma('samotný křížek není hashtag', spocitatHashtagy('cena # 120'), 0)
ma('prázdný text nemá hashtagy', spocitatHashtagy(''), 0)

console.log('\n== Co účet nemá povolené, se nepředstírá ==')

/*
  Zadání, oddíl 16: „Pokud API určitý typ obsahu nepodporuje, nabídni
  stažení hotového souboru a jasně označený ruční postup, nikoliv
  falešnou automatizaci."
*/
const bezOpravneni = {
  ...ZAKLAD, kanal: 'instagram',
  schopnostiUctu: ['publish.facebook.post'],
}
ok('účet bez oprávnění na ten formát neprojde', !pujde(bezOpravneni))
ok('a nabídne se ruční cesta', /ručně/.test(duvody(bezOpravneni)))
ok('a odkáže se na Nástroje', /Nástroje/.test(duvody(bezOpravneni)))

const sOpravnenim = {
  ...ZAKLAD, kanal: 'instagram',
  schopnostiUctu: ['publish.instagram.feed'],
}
ok('se správným oprávněním projde', pujde(sOpravnenim))

/*
  PRÁZDNÝ SEZNAM SCHOPNOSTÍ NEZNAMENÁ „NIC NESMÍ".

  Znamená „nezeptali jsme se". Účty se dnes z Mety nenačítají, takže
  je prázdný skoro vždycky. Kdyby se z toho vyvozovalo odmítnutí,
  nešlo by zveřejnit vůbec nic — a hláška by tvrdila něco, co jsme
  nezjistili.
*/
ok('prázdné schopnosti neodmítají',
  pujde({ ...ZAKLAD, kanal: 'instagram', schopnostiUctu: [] }))
ok('a chybějící taky ne',
  pujde({ ...ZAKLAD, kanal: 'instagram' }))

console.log('\n== Most mezi uloženým formátem a tabulkou formátů ==')

/*
  `marketing_publikace_ulohy.format` drží `'prispevek'`,
  `lib/marketing-formaty.ts` zná `feed` a `page_post`. Kdyby most
  nefungoval, nenašel by se spec a všechno by se odmítalo jako
  „neumíme".
*/
ma('prispevek na Instagramu je feed', specProUlohu('instagram', 'prispevek')?.key, 'instagram_feed')
ma('a na Facebooku page post', specProUlohu('facebook', 'prispevek')?.key, 'facebook_post')
ma('přesný klíč se vezme přímo', specProUlohu('instagram', 'instagram_story')?.key, 'instagram_story')
ma('a formát uvnitř sítě taky', specProUlohu('facebook', 'reel')?.key, 'facebook_reel')
ok('neznámá síť nemá spec', specProUlohu('tiktok', 'prispevek') === undefined)

console.log('\n== Odesílání to opravdu používá ==')

const ODESLANI = readFileSync('lib/marketing-odeslani.ts', 'utf8')
const ODESLANI_KOD = ODESLANI
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ok('odesílání volá kontrolu', /zkontrolovat\(/.test(ODESLANI_KOD))
ok('a blokuje jen to, co opravdu nejde', /coNejde\(/.test(ODESLANI_KOD))

/*
  A že tam nezůstalo staré pravidlo „bez obrázku ne" pro obě sítě.
  Kdyby se vrátilo, Facebook by se zase nedal poslat textem — a nic
  jiného by to neohlásilo.
*/
ok('staré pravidlo „bez obrázku ne" tam není',
  !/obrazky\.length === 0/.test(ODESLANI_KOD))
ok('a schopnosti účtu se předávají', /schopnosti_uctu/.test(ODESLANI_KOD))

console.log('\n== Fronta dotáhne schopnosti účtu ==')

const ROUTE = readFileSync('app/api/uloha/marketing-fronta/route.ts', 'utf8')
const ROUTE_KOD = ROUTE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ok('fronta čte účty', /from\('marketing_ucty'\)/.test(ROUTE_KOD))
ok('a předává schopnosti do odeslání', /schopnosti_uctu/.test(ROUTE_KOD))

/*
  JEDNÍM DOTAZEM ZA DÁVKU, NE PO JEDNÉ ÚLOZE. V dávce bývá několik
  úloh na týž účet; dotaz v cyklu by je vytáhl pořád dokola.
*/
ok('jedním dotazem za celou dávku, ne v cyklu',
  /\.in\('id', idUctu\)/.test(ROUTE_KOD)
  && !/for \(const uloha[\s\S]{0,400}from\('marketing_ucty'\)/.test(ROUTE_KOD))

console.log('\n== Účet pobočky se vyplňuje ==')

const AKCE = readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')
const AKCE_KOD = AKCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
const PLAN = AKCE_KOD.slice(AKCE_KOD.indexOf('export async function naplanovat'))

/*
  Tabulka `marketing_ucty` existovala a NIKDO JI NEČETL — `ucet_id`
  na úloze zůstávalo prázdné. Fungovalo to jen proto, že n8n má dnes
  napevno jeden účet; jakmile bude druhá pobočka, odešel by její
  příspěvek na cizí profil.
*/
ok('plánování čte účty pobočky', /from\('marketing_ucty'\)/.test(PLAN))
ok('a filtruje je podle pobočky', /\.eq\('branch_id', prispevek\.branch_id\)/.test(PLAN))
ok('bere jen aktivní', /\.eq\('aktivni', true\)/.test(PLAN))
ok('a zapisuje ucet_id na úlohu', /ucet_id:/.test(PLAN))

console.log('\n== Editor ukazuje pravidla u textu ==')

const DETAIL = readFileSync('app/[rozsah]/marketing/[prispevek]/page.tsx', 'utf8')
const DETAIL_KOD = DETAIL
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ok('editor zná pravidla sítí', /pravidlaKanalu\(/.test(DETAIL_KOD))
ok('a ukazuje nálezy u textu', /zkontrolovat\(/.test(DETAIL_KOD))

/*
  Název sítě se bere z pravidel, ne z podmínky. Dřív tu stálo
  `kanal === 'instagram' ? 'Instagram' : 'Facebook'` — cokoli jiného
  než Instagram se popsalo jako Facebook.
*/
ok('název sítě se nehádá podmínkou',
  !/kanal === 'instagram' \? 'Instagram' : 'Facebook'/.test(DETAIL_KOD))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
