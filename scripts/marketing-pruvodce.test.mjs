#!/usr/bin/env node
/**
 * Průvodce prvním spuštěním.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-pruvodce.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * Zadání, oddíl 6: „Doporučení musí být transparentní a nesmí tvrdit,
 * že jedna placená služba je povinná."
 *
 * Nejdůležitější je proto DŮVOD u každé položky a to, že ruční režim
 * je plnohodnotná volba — ne nouzovka, ke které se člověk odsoudí tím,
 * že nic nepřipojí.
 */

import { readFileSync } from 'node:fs'

import { POSKYTOVATELE, PORADI_KATEGORII } from '../lib/marketing-katalog.ts'
import {
  OTAZKY,
  VYCHOZI,
  doporucenaSestava,
  kolikKPripojeni,
  precistOdpovedi,
} from '../lib/marketing-pruvodce.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, sk, ce) => ok(popis, sk === ce, `${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`)

console.log('\n== Čtyři otázky, ne dotazník ==')

ma('otázky jsou čtyři', OTAZKY.length, 4)
ok('každá má aspoň dvě možnosti', OTAZKY.every((o) => o.moznosti.length >= 2))
ok('a každá možnost má vysvětlení, ne jen název',
  OTAZKY.every((o) => o.moznosti.every((m) => m.popis.length > 10)))

/*
  VÝCHOZÍ ODPOVĚDI JSOU TY NEJMÉNĚ ZAVAZUJÍCÍ.

  Kdo průvodce proklikne bez čtení, nesmí skončit s doporučením zapnout
  automatické zveřejňování na účtu Foodtabu.
*/
ma('výchozí zveřejňování je ruční', VYCHOZI.zverejnovani, 'rucne')
ma('výchozí účty jsou vlastní', VYCHOZI.ucty, 'vlastni')
ma('a výchozí cíl jen texty', VYCHOZI.cil, 'texty')

console.log('\n== Odpověď z adresy se ověřuje ==')

const podvrzene = precistOdpovedi((k) => (k === 'cil' ? 'smazat_vsechno' : null))
ma('neznámá hodnota se nahradí výchozí', podvrzene.cil, VYCHOZI.cil)

const platne = precistOdpovedi((k) => ({ cil: 'vse_vcetne_videa', priorita: 'kvalita' })[k] ?? null)
ma('platná hodnota projde', platne.cil, 'vse_vcetne_videa')
ma('a zbytek dostane výchozí', platne.zverejnovani, VYCHOZI.zverejnovani)

console.log('\n== Sestava pokrývá všechny kategorie ==')

const zakladni = doporucenaSestava(VYCHOZI)
ma('sestava má tolik položek, kolik je kategorií', zakladni.length, PORADI_KATEGORII.length)

/*
  CO SE NEDOPORUČUJE, SE ŘEKNE TAKY. Vynechat kategorii by vypadalo
  jako nedodělek — člověk by nevěděl, jestli se na ni zapomnělo, nebo
  ji nepotřebuje.
*/
ok('žádná kategorie nechybí',
  PORADI_KATEGORII.every((k) => zakladni.some((s) => s.kategorie === k)))

ok('a pořadí sedí s katalogem',
  zakladni.map((s) => s.kategorie).join() === PORADI_KATEGORII.join())

/*
  DŮVOD JE POVINNÁ ČÁST. Doporučení bez důvodu je reklama — a zadání
  chce průhlednost.
*/
ok('KAŽDÁ položka má důvod, i ta nedoporučená',
  zakladni.every((s) => s.duvod.length > 25))

console.log('\n== Ruční režim je plnohodnotná volba ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  Zadání: „nesmí tvrdit, že jedna placená služba je povinná". Kdo si
  vybral ruční zveřejňování, nesmí dostat doporučení připojit
  publikování — a musí se dozvědět, že modul funguje i tak.
*/
const rucne = doporucenaSestava({ ...VYCHOZI, zverejnovani: 'rucne' })
const publikovaniRucne = rucne.find((s) => s.kategorie === 'publikovani')

ok('u ručního režimu se publikování nedoporučuje', publikovaniRucne.poskytovatel === null)
ok('a řekne se, že modul funguje i tak',
  /vložíte na síť sami|fungují stejně/.test(publikovaniRucne.duvod))
ma('a režim je ruční', publikovaniRucne.rezim, 'rucni')

const automatizaceRucne = rucne.find((s) => s.kategorie === 'automatizace')
ok('a automatizace se taky nedoporučuje', automatizaceRucne.poskytovatel === null)

const automaticky = doporucenaSestava({ ...VYCHOZI, zverejnovani: 'automaticky' })
ok('u automatického režimu se publikování doporučí',
  automaticky.find((s) => s.kategorie === 'publikovani').poskytovatel !== null)

console.log('\n== Sestava se mění podle odpovědí ==')

/*
  Kdyby vycházela pořád stejná, byly by ty otázky na ozdobu — a to je
  horší než se neptat: člověk by čtyřikrát klikal a nic by to neudělalo.
*/
const jenTexty = doporucenaSestava({ ...VYCHOZI, cil: 'texty' })
const vse = doporucenaSestava({ ...VYCHOZI, cil: 'vse_vcetne_videa' })

ok('u „jen texty" se obrázky nedoporučují',
  jenTexty.find((s) => s.kategorie === 'render_obrazek').poskytovatel === null)
ok('a video taky ne',
  jenTexty.find((s) => s.kategorie === 'render_video').poskytovatel === null)

/*
  POZOR — TADY SE KONTROLA MUSELA PŘEPSAT PODLE SKUTEČNOSTI.

  Napsal jsem ji nejdřív jako „u ‚i videa\' se doporučí VÍC nástrojů".
  Spadla — a odhalila, že v katalogu není JEDINÝ podporovaný nástroj
  na grafiku ani na video. Render zatím nikdo nenapojil (zadání,
  oddíl 12), takže `vezmi()` vrací prázdno pro obě volby.

  Nechat tam původní podobu by znamenalo červenou, která říká něco
  jiného, než co je rozbité. Kontrola proto míří na to, co JE pravda
  a co se dá pokazit: DŮVOD se musí lišit. „Nepotřebujete" a „nemáme
  k tomu nástroj" jsou dvě různé věty a nesmí splynout — člověk má
  vědět, jestli si nevybral, nebo jestli to neumíme.
*/
const obrazkyTexty = jenTexty.find((s) => s.kategorie === 'render_obrazek')
const obrazkyVse = vse.find((s) => s.kategorie === 'render_obrazek')

ok('u „jen texty" se řekne, že to nepotřebujete',
  /Nepotřebujete/.test(obrazkyTexty.duvod))
ok('u „i videa" se řekne něco jiného',
  obrazkyVse.duvod !== obrazkyTexty.duvod)
ok('a je z toho poznat, že chybí nástroj — ne že si to nevybral',
  /nemáme odzkoušený nástroj|Vyrobí obrázek/.test(obrazkyVse.duvod))

/*
  A ŽE TA VĚTVENÍ NEJSOU NAPRÁZDNO: až se renderer napojí, počet
  doporučených nástrojů u „i videa" MÁ vyjít vyšší. Tahle kontrola
  se tedy dnes drží mírně — a je u ní napsané, co se má stát potom.
*/
ok('a u „i videa" se nedoporučí MÍŇ než u samotných textů',
  kolikKPripojeni(vse) >= kolikKPripojeni(jenTexty))

/*
  A ŽE SE VÝSLEDEK LIŠÍ U KAŽDÉ OTÁZKY, ne jen u jedné. Otázka, která
  nic nemění, je klikání navíc.
*/
const otisk = (o) => doporucenaSestava(o).map((s) => `${s.poskytovatel?.klic ?? '-'}:${s.rezim}:${s.duvod.length}`).join('|')
const zaklad = otisk(VYCHOZI)

ok('změna cíle změní sestavu', otisk({ ...VYCHOZI, cil: 'vse_vcetne_videa' }) !== zaklad)
ok('změna priority taky', otisk({ ...VYCHOZI, priorita: 'cena' }) !== zaklad)
ok('změna zveřejňování taky', otisk({ ...VYCHOZI, zverejnovani: 'automaticky' }) !== zaklad)
ok('a změna účtů taky',
  otisk({ ...VYCHOZI, ucty: 'foodtab', zverejnovani: 'automaticky' })
  !== otisk({ ...VYCHOZI, ucty: 'vlastni', zverejnovani: 'automaticky' }))

console.log('\n== Doporučuje se jen to, co umíme připojit ==')

/*
  Poskytovatel bez odzkoušeného adaptéru (`podporovany: false`) se
  nesmí doporučit. Zadání, oddíl 3.1: „pouhá položka v katalogu nesmí
  předstírat funkční integraci."
*/
const vsechnyOdpovedi = []
for (const cil of ['texty', 'texty_a_grafika', 'vse_vcetne_videa']) {
  for (const priorita of ['jednoduchost', 'cena', 'kvalita']) {
    for (const zverejnovani of ['automaticky', 'rucne']) {
      for (const ucty of ['vlastni', 'foodtab']) {
        vsechnyOdpovedi.push({ cil, priorita, zverejnovani, ucty })
      }
    }
  }
}

ma('prošlo se všech 36 kombinací', vsechnyOdpovedi.length, 36)

let nepodporovany = 0
let bezDuvodu = 0
let cizirezim = 0

for (const o of vsechnyOdpovedi) {
  for (const s of doporucenaSestava(o)) {
    if (s.poskytovatel && !s.poskytovatel.podporovany) nepodporovany++
    if (s.duvod.length < 25) bezDuvodu++
    // Režim, který poskytovatel neumí, by se poznal až při připojování.
    if (s.poskytovatel && s.rezim !== 'rucni' && !s.poskytovatel.rezimy.includes(s.rezim)) cizirezim++
  }
}

ma('v žádné kombinaci se nedoporučí nepodporovaný nástroj', nepodporovany, 0)
ma('a v žádné nechybí důvod', bezDuvodu, 0)
ma('a nikde se neslíbí režim, který ten nástroj neumí', cizirezim, 0)

/*
  A ŽE V KATALOGU NĚJAKÝ NEPODPOROVANÝ VŮBEC JE — jinak by kontrola
  výš byla zelená nad ničím.
*/
ok('v katalogu nepodporovaný nástroj existuje',
  POSKYTOVATELE.some((p) => !p.podporovany))

console.log('\n== Obrazovka to používá ==')

const STRANKA = readFileSync('app/[rozsah]/marketing/zacatek/page.tsx', 'utf8')
const KOD = STRANKA.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

ok('obrazovka má tělo', STRANKA.length > 3000)
ok('kreslí otázky z knihovny', /OTAZKY\.map\(/.test(KOD))
ok('a sestavu z knihovny', /doporucenaSestava\(/.test(KOD))
ok('odpovědi se ověřují', /precistOdpovedi\(/.test(KOD))

/*
  PRŮVODCE NIC NEPŘIPOJUJE. Připojení — s klíči, šifrováním a zkouškou
  spojení — dělá obrazovka Nástroje. Dvě cesty k témuž by se rozešly.
*/
/*
  HLEDÁ SE ZÁPIS DO DATABÁZE, NE SLOVO `delete`.

  Napsal jsem to nejdřív jako zákaz `.delete(` kdekoli — a spadlo to
  nad SPRÁVNÝM kódem: `URLSearchParams.delete()` maže parametr
  z adresy, ne řádek z tabulky. Kontrola, která se plete, je horší než
  žádná: příště by ji někdo umlčel a s ní i to skutečné hlídání.
*/
const zapisy = [...KOD.matchAll(/supabase[\s\S]{0,200}?\.(update|insert|upsert|delete)\(/g)]
ok('průvodce do databáze nepíše', zapisy.length === 0,
  zapisy.map((z) => z[1]).join())
ok('a posílá na Nástroje', /marketing\/nastroje/.test(KOD))

ok('u každé položky se kreslí důvod', /s\.duvod/.test(KOD))

/*
  A že se nahlas říká, že nic z toho není povinné.
*/
ok('obrazovka říká, že modul funguje i bez nástrojů',
  /bez jediného připojeného nástroje/.test(STRANKA))
ok('a že to není zámek', /Není to zámek/.test(STRANKA))

ok('ptá se na marketing.read', /'marketing\.read'/.test(KOD))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
