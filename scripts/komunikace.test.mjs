#!/usr/bin/env node
/**
 * Provozní centrum — čistá logika (lib/komunikace/*).
 *
 * Pusť `node --experimental-strip-types scripts/komunikace.test.mjs`.
 *
 * Co se tu ověřuje: návrh úkolu ze zprávy (pravidlový, bez modelu),
 * poskytovatel přepisu (nedostupný, a říká to), skládání vlákna
 * a hledání příjemců. Databázová strana (kdo smí co, upozornění) je ve
 * scénářích krok42 a krok43.
 *
 * Návrh úkolu je nejzrádnější: má být užitečný, ale nikdy nevymýšlet.
 * Proto polovina kontrol hlídá, co se NEmá navrhnout (termín, který ve
 * zprávě není, a nejasný termín).
 */

import fs from 'node:fs'

import {
  jeNaleha,
  modelovyPoskytovatel,
  najdiTermin,
  navrhniNazev,
  navrhniUkol,
  pravidlovyPoskytovatel,
  pridejDny,
  vybratPoskytovateleNavrhu,
} from '../lib/komunikace/navrh-ukolu.ts'
import {
  DUVOD_NEDOSTUPNOSTI,
  POSKYTOVATELE,
  nedostupnyPrepis,
  popisStavuPrepisu,
  vybratPoskytovatelePrepisu,
} from '../lib/komunikace/prepis.ts'
import { denVPasmu } from '../lib/cas.ts'
import { slozitPush } from '../lib/komunikace/push-zprava.ts'
import {
  MAX_BAJTU,
  MAX_PRILOH,
  TYPY_PRILOH,
  cestaPriloh,
  jeTypPriloh,
  ocistitNazev,
  textZpravyPrilohy,
  typSouboru,
  velikostText,
  zkontrolujPoZmenseni,
  zkontrolujVyber,
} from '../lib/komunikace/prilohy.ts'
import { popisDne, poskladatVlakno } from '../lib/komunikace/vlakno.ts'
import {
  hledatPrijemce,
  normalizuj,
  seskupitPrijemce,
  souhrnVyberu,
} from '../lib/komunikace/prijemci.ts'

let chyb = 0
const je = (popis, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

// 21. 9. 2026 je pondělí.
const DNES = '2026-09-21'

console.log('\n== Datum: pomocné počty ==')
je('+4 dny z pondělí je pátek', pridejDny(DNES, 4), '2026-09-25')
je('přes konec měsíce', pridejDny('2026-09-29', 3), '2026-10-02')
je('přes konec roku', pridejDny('2026-12-31', 1), '2027-01-01')
je('přes přestupný den', pridejDny('2028-02-28', 1), '2028-02-29')

console.log('\n== Termín: co se pozná ==')
je('zítra', najdiTermin('Zítra přijede dodavatel.', DNES).termin, { datum: '2026-09-22', cas: null })
je('dnes', najdiTermin('Dnes musíme uklidit sklad.', DNES).termin, { datum: DNES, cas: null })
je('pozítří', najdiTermin('Pozítří je inventura.', DNES).termin, { datum: '2026-09-23', cas: null })
je('bez diakritiky (psáno z telefonu)', najdiTermin('zitra prijede dodavatel', DNES).termin, { datum: '2026-09-22', cas: null })
je('„do pátku“ z pondělí', najdiTermin('Objednej mrkev do pátku.', DNES).termin, { datum: '2026-09-25', cas: null })
je('„ve středu“', najdiTermin('Sejdeme se ve středu.', DNES).termin, { datum: '2026-09-23', cas: null })
je('čas „do 15:00“ + den', najdiTermin('Zítra do 15:00 pošli objednávku.', DNES).termin, { datum: '2026-09-22', cas: '15:00' })
je('čas „v 8.30“', najdiTermin('Pozítří v 8.30 přijde revize.', DNES).termin, { datum: '2026-09-23', cas: '08:30' })
je('čas „ve 14 hodin“', najdiTermin('Zítra ve 14 hodin porada.', DNES).termin, { datum: '2026-09-22', cas: '14:00' })
je('datum číslem „30. 9.“', najdiTermin('Inventura 30. 9.', DNES).termin, { datum: '2026-09-30', cas: null })
je('datum s rokem „3. 10. 2026“', najdiTermin('Kontrola 3. 10. 2026.', DNES).termin, { datum: '2026-10-03', cas: null })
je('datum slovem „30. září“', najdiTermin('Inventura 30. září.', DNES).termin, { datum: '2026-09-30', cas: null })
je('datum slovem „5. října“', najdiTermin('Servis 5. října.', DNES).termin, { datum: '2026-10-05', cas: null })

console.log('\n== Termín: co se NEvymýšlí ==')
const bez = najdiTermin('Doplň utěrky do skladu.', DNES)
je('žádný termín ve zprávě → žádný se nenavrhne', bez.termin, null)
je('… a není to důvod ke kontrole (nic nejasného)', bez.kontrola, false)
const vagni = najdiTermin('Udělejte to příští týden.', DNES)
je('„příští týden“ není datum', vagni.termin, null)
je('… ale je to k ověření', vagni.kontrola, true)
je('„co nejdřív“ není datum', najdiTermin('Vyřiď to co nejdřív.', DNES).termin, null)
const jenCas = najdiTermin('Dorazte do 15:00.', DNES)
je('čas bez dne se nepřipíše na dnešek potichu', jenCas.termin, null)
je('… ale hlásí se ke kontrole', jenCas.kontrola, true)
const dvaDny = najdiTermin('Sejdeme se v pátek, nebo v sobotu.', DNES)
je('dva různé dny: navrhne se první', dvaDny.termin?.datum, '2026-09-25')
je('… a označí se k ověření', dvaDny.kontrola, true)
const stejnyDen = najdiTermin('V pondělí porada.', DNES)
je('„v pondělí“ napsané v pondělí: dnes, nebo za týden? — týden dopředu', stejnyDen.termin?.datum, '2026-09-28')
je('… a k ověření', stejnyDen.kontrola, true)
const uplynule = najdiTermin('Inventura 3. 9.', DNES)
je('uplynulé datum bez roku → příští rok', uplynule.termin?.datum, '2027-09-03')
je('… a k ověření', uplynule.kontrola, true)
je('neexistující datum (30. 2.) se nenavrhne', najdiTermin('Servis 30. 2.', DNES).termin, null)
je('číslo, které není datum („15.30“ = čas), se za datum nebere', najdiTermin('Sejdeme se v 15.30.', DNES).termin, null)

console.log('\n== Naléhavost ==')
je('„naléhavé“', jeNaleha('Je to naléhavé.'), true)
je('„hned“', jeNaleha('Zavolej hned.'), true)
je('„ASAP“', jeNaleha('Potřebuju to asap'), true)
je('běžná zpráva není naléhavá', jeNaleha('Objednej mrkev do pátku.'), false)
je('„hnedle“ (slovo hned uvnitř) není naléhavé', jeNaleha('Přijdu hnedle po obědě.'), false)

console.log('\n== Název a poznámka ==')
je('povel ve větě: „Prosím“ se odřízne', navrhniNazev('Prosím objednej mrkev do pátku.').nazev, 'Objednej mrkev do pátku')
je('pozdrav se odřízne a vybere se věta s povelem', navrhniNazev('Ahoj, zítra nás čeká hodně práce. Nezapomeň zavolat do pojišťovny.').nazev, 'Nezapomeň zavolat do pojišťovny')
je('zbytek zprávy jde do poznámky', navrhniNazev('Nezapomeň zavolat do pojišťovny. Číslo smlouvy je na nástěnce.').poznamka, 'Číslo smlouvy je na nástěnce.')
je('bez povelu se vezme první věta', navrhniNazev('Přijede zboží. Kolem oběda.').nazev, 'Přijede zboží')
je('víceřádková zpráva', navrhniNazev('Dobrý den,\nchybí nám papír.\nDíky').nazev, 'Chybí nám papír')
const dlouha = 'Zkontroluj prosím, jestli jsou všechny chladicí boxy v provozu, jestli nejsou žádné výpadky a jestli se teploty drží v mezích, jinak nám hrozí problémy s hygienou a ztráty na zboží.'
const dl = navrhniNazev(dlouha)
je('dlouhý název se zkrátí na 80 znaků nejvýš', dl.nazev.length <= 80, true)
je('zkrácený název končí výpustkou', dl.nazev.endsWith('…'), true)
je('zkrácená věta se do poznámky dostane celá, nic se neztratí', dl.poznamka.startsWith('Zkontroluj prosím'), true)
je('prázdná zpráva nemá název', navrhniNazev('   ').nazev, '')

console.log('\n== Návrh jako celek ==')
const n1 = navrhniUkol({ text: 'Prosím objednej mrkev do pátku do 12:00.', dnes: DNES })
je('název', n1?.nazev, 'Objednej mrkev do pátku do 12:00')
je('termín i čas', n1?.termin, { datum: '2026-09-25', cas: '12:00' })
je('priorita běžná', n1?.priorita, 'normal')
je('zdroj je pravidlový (ne model)', n1?.zdroj, 'pravidla')
je('nic k ověření', n1?.vyzadujeKontrolu, [])
je('nálezy říkají, co se poznalo', n1?.nalezy.some((x) => x.includes('pá 25. 9.')), true)

const n2 = navrhniUkol({ text: 'Zavolej hned dodavateli, je to naléhavé.', dnes: DNES })
je('naléhavá zpráva → priorita high', n2?.priorita, 'high')
je('… a nálezy to říkají', n2?.nalezy.some((x) => x.includes('důležitý')), true)

const n3 = navrhniUkol({ text: 'Udělej to příští týden.', dnes: DNES })
je('nejasný termín: prázdný a k ověření', [n3?.termin, n3?.vyzadujeKontrolu], [null, ['termin']])

je('prázdná zpráva → žádný návrh', navrhniUkol({ text: '', dnes: DNES }), null)
je('jen mezery → žádný návrh', navrhniUkol({ text: '   \n ', dnes: DNES }), null)

console.log('\n== Poskytovatelé návrhu ==')
je('pravidlový je dostupný', pravidlovyPoskytovatel.stav(), { dostupny: true })
const stavModelu = modelovyPoskytovatel.stav()
je('modelový je NEDOSTUPNÝ', stavModelu.dostupny, false)
je('… a říká proč (obsah komunikace se modelu neposílá)', stavModelu.dostupny === false && stavModelu.duvod.includes('neposílá'), true)
je('výchozí poskytovatel je pravidlový', vybratPoskytovateleNavrhu().id, 'pravidla')
je('modelový nikdy nevrátí návrh', await modelovyPoskytovatel.navrhnout({ text: 'Objednej mrkev.', dnes: DNES }), null)
je('pravidlový přes rozhraní vrátí návrh', (await pravidlovyPoskytovatel.navrhnout({ text: 'Objednej mrkev.', dnes: DNES }))?.nazev, 'Objednej mrkev')

/*
  Text zprávy nesmí jít k modelu — ověřuje se na kódu: nikde v lib/komunikace
  se nevolá Anthropic SDK ani fetch. Kontrola je schválně hloupá a hlasitá;
  kdyby někdo model napojil, tenhle test má spadnout a vyžádat si rozhodnutí.
*/
console.log('\n== Zpráva neopouští server ==')
const zdrojeLib = ['navrh-ukolu.ts', 'prepis.ts', 'vlakno.ts', 'prijemci.ts']
  .map((s) => fs.readFileSync(new URL(`../lib/komunikace/${s}`, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((r) => !r.trim().startsWith('//') && !r.trim().startsWith('*'))
  .join('\n')
je('lib/komunikace nevolá Anthropic SDK', /@anthropic-ai|anthropic\./i.test(zdrojeLib), false)
je('lib/komunikace nevolá fetch ani jiný síťový klient', /\bfetch\s*\(|XMLHttpRequest|axios|http\.request/.test(zdrojeLib), false)

console.log('\n== Přepis hlasu ==')
je('výchozí poskytovatel přepisu je „žádný“', vybratPoskytovatelePrepisu().id, 'zadny')
je('neznámý poskytovatel = žádný, ne chyba', vybratPoskytovatelePrepisu('whisper').id, 'zadny')
je('registr poskytovatelů je zatím prázdný (a nic se nepředstírá)', Object.keys(POSKYTOVATELE).length, 0)
const v = await nedostupnyPrepis.prepsat({ cesta: 'a/b/c.webm', delkaS: 12, mime: 'audio/webm' })
je('přepis bez poskytovatele je „nedostupný“ s důvodem', v, { stav: 'nedostupny', duvod: DUVOD_NEDOSTUPNOSTI })
je('… a nikdy prázdný text vydávaný za přepis', v.stav === 'hotovo', false)
je('popis stavu: nedostupný', popisStavuPrepisu(v).text, 'Přepis na text není dostupný.')
je('popis stavu: bez výsledku taky nedostupný', popisStavuPrepisu(null).text, 'Přepis na text není dostupný.')
je('popis stavu: chyba je varování', popisStavuPrepisu({ stav: 'chyba', duvod: 'vypršel klíč' }).jeVarovani, true)
je('popis stavu: hotový přepis je jeho text', popisStavuPrepisu({ stav: 'hotovo', text: 'Ahoj', jazyk: 'cs' }).text, 'Ahoj')

console.log('\n== Vlákno ==')
const Z = (id, autor, vytvoreno, typ = 'zprava') => ({ id, autor, vytvoreno, typ })
const moznosti = { ja: 'ja', zona: 'Europe/Prague', dnes: DNES, precetoDo: null }

je('den v pásmu pobočky: 00:30 pražského času je už 21.', denVPasmu('2026-09-20T22:30:00Z', 'Europe/Prague'), '2026-09-21')
je('… ale v UTC je to ještě 20.', denVPasmu('2026-09-20T22:30:00Z', 'UTC'), '2026-09-20')
je('popis dne: dnes', popisDne('2026-09-21', DNES), 'Dnes')
je('popis dne: včera', popisDne('2026-09-20', DNES), 'Včera')
je('popis dne: starší', popisDne('2026-09-18', DNES), 'pá 18. 9.')

const vlakno = poskladatVlakno(
  [
    Z('1', 'ona', '2026-09-20T08:00:00Z'),
    Z('2', 'ona', '2026-09-20T08:02:00Z'),
    Z('3', 'ja', '2026-09-20T08:03:00Z'),
    Z('4', 'ona', '2026-09-21T07:00:00Z'),
    Z('5', 'ona', '2026-09-21T07:20:00Z'),
    Z('6', 'ja', '2026-09-21T07:21:00Z', 'system'),
  ],
  moznosti,
)
const druhy = vlakno.map((p) => p.druh)
je('pořadí položek: den, zprávy, den, dělítko Nové, zprávy, událost',
  druhy, ['den', 'nove', 'zprava', 'zprava', 'zprava', 'den', 'zprava', 'zprava', 'udalost'])
je('první den je „Včera“', vlakno[0].popis, 'Včera')
je('dělítko „Nové“ počítá jen cizí zprávy (4 z 5, moje ne)', vlakno[1].pocet, 4)
const zpravy = vlakno.filter((p) => p.druh === 'zprava')
je('dvě zprávy téhož autora do 5 minut jsou jedna skupina', [zpravy[0].zacatekSkupiny, zpravy[1].zacatekSkupiny, zpravy[0].konecSkupiny, zpravy[1].konecSkupiny], [true, false, false, true])
je('moje zpráva je označená', zpravy[2].moje, true)
je('zpráva po půlhodině je nová skupina (i od téhož autora)', zpravy[4].zacatekSkupiny, true)
je('jiný den = nová skupina', zpravy[3].zacatekSkupiny, true)

const prectene = poskladatVlakno([Z('1', 'ona', '2026-09-21T07:00:00Z'), Z('2', 'ona', '2026-09-21T07:10:00Z')],
  { ...moznosti, precetoDo: '2026-09-21T07:30:00Z' })
je('vše přečteno → žádné dělítko „Nové“', prectene.some((p) => p.druh === 'nove'), false)
const castecne = poskladatVlakno([Z('1', 'ona', '2026-09-21T07:00:00Z'), Z('2', 'ona', '2026-09-21T09:00:00Z')],
  { ...moznosti, precetoDo: '2026-09-21T08:00:00Z' })
je('částečně přečteno → dělítko před první nepřečtenou (počet 1)',
  castecne.map((p) => (p.druh === 'nove' ? `nove:${p.pocet}` : p.druh)), ['den', 'zprava', 'nove:1', 'zprava'])
const jenMoje = poskladatVlakno([Z('1', 'ja', '2026-09-21T07:00:00Z')], moznosti)
je('moje vlastní zprávy nikdy nejsou „nové“', jenMoje.some((p) => p.druh === 'nove'), false)
je('prázdné vlákno je prázdné', poskladatVlakno([], moznosti), [])
je('systémová událost nepřeruší dělítko ani nesměšuje skupiny', poskladatVlakno(
  [Z('1', 'ona', '2026-09-21T07:00:00Z'), Z('2', 'ja', '2026-09-21T07:01:00Z', 'system'), Z('3', 'ona', '2026-09-21T07:02:00Z')], moznosti)
  .filter((p) => p.druh === 'zprava').map((p) => p.zacatekSkupiny), [true, true])

console.log('\n== Výběr příjemců ==')
const P = (id, jmeno, branch, na_me) => ({ employee_id: id, jmeno, branch_id: branch, usek_id: null, position_id: null, na_me_pobocce: na_me })
const lide = [
  P('1', 'Karel Novák', 'perla', true),
  P('2', 'Božena Řezníčková', 'perla', true),
  P('3', 'Šárka Čermáková', 'bar', false),
  P('4', 'Adam Ždánský', 'bar', false),
  P('5', 'Ivo Bezpobočkový', null, false),
]
je('normalizace: bez diakritiky, malá písmena', normalizuj('  Řezníčková   ŠÁRKA '), 'reznickova sarka')
je('prázdné hledání vrátí všechny', hledatPrijemce(lide, '  ').length, 5)
je('hledání bez diakritiky', hledatPrijemce(lide, 'rezn').map((p) => p.employee_id), ['2'])
je('hledání s diakritikou i velikostí', hledatPrijemce(lide, 'ŘEZNÍČ').map((p) => p.employee_id), ['2'])
je('hledání dvou slov v libovolném pořadí', hledatPrijemce(lide, 'novak karel').map((p) => p.employee_id), ['1'])
je('hledání podle začátku slova, ne uvnitř („vak“ nenajde Nováka)', hledatPrijemce(lide, 'vak').length, 0)
je('nic nenalezeno = prázdno', hledatPrijemce(lide, 'xyz'), [])

const skup = seskupitPrijemce(lide, new Map([['perla', 'Černá Perla'], ['bar', 'Bernard bar']]))
je('první skupina jsou kolegové z mé pobočky', [skup[0].klic, skup[0].nazev], ['moje', 'Moje pobočka a vedení'])
je('uvnitř skupiny česky podle jména (Božena před Karlem)', skup[0].lide.map((p) => p.employee_id), ['2', '1'])
je('ostatní podle názvu pobočky česky, „Bez pobočky“ pod svým názvem', skup.slice(1).map((s) => s.nazev), ['Bernard bar', 'Bez pobočky'])
je('česká abeceda: Šárka za Adamem, ne na konci', skup[1].lide.map((p) => p.employee_id), ['4', '3'])
je('prázdné skupiny se nevypisují', seskupitPrijemce([P('1', 'A', 'x', false)], new Map()).map((s) => s.klic), ['x'])

je('souhrn: nikdo', souhrnVyberu([]), 'Nikdo není vybraný')
je('souhrn: jeden', souhrnVyberu([{ jmeno: 'Karel Novák' }]), 'Karel')
je('souhrn: dva', souhrnVyberu([{ jmeno: 'Karel Novák' }, { jmeno: 'Božena Řezníčková' }]), 'Karel a Božena')
je('souhrn: tři', souhrnVyberu([{ jmeno: 'A a' }, { jmeno: 'B b' }, { jmeno: 'C c' }]), 'A, B a 1 další')
je('souhrn: pět', souhrnVyberu(['A', 'B', 'C', 'D', 'E'].map((j) => ({ jmeno: `${j} x` }))), 'A, B a 3 další')
je('souhrn: osm', souhrnVyberu(Array.from({ length: 8 }, (_, i) => ({ jmeno: `J${i} x` }))), 'J0, J1 a 6 dalších')

console.log('\n== Text push oznámení ==')

const p1 = slozitPush({ typ: 'souhrn', pocet: 3, druh: null, telo: null, priorita: null })
je('souhrn po příchodu', [p1.title, p1.body, p1.tag], ['Foodtab', 'Čekají na vás 3 zprávy', 'souhrn'])
const p2 = slozitPush({ typ: 'jedna', pocet: 1, druh: 'vzkaz.novy', telo: { pocet: 1 }, priorita: 'normal' })
je('nový vzkaz nenese obsah zprávy ani jméno', [p2.body, p2.urgent], ['Nová zpráva v rozhovoru', false])
const p3 = slozitPush({ typ: 'jedna', pocet: 4, druh: 'vzkaz.novy', telo: { pocet: 4 }, priorita: 'normal' })
je('slučovaný vzkaz řekne počet', p3.body, '4 nové zprávy v rozhovorech')
const p4 = slozitPush({ typ: 'jedna', pocet: 1, druh: 'smena.zmenena', telo: { den: '2026-09-22', od: '16:00', do: '22:00' }, priorita: 'important' })
je('změna směny: den, žádné jméno', p4.body, 'Změnila se vám směna úterý 22. 9.')
const p5 = slozitPush({ typ: 'jedna', pocet: 1, druh: 'vzkaz.novy', telo: {}, priorita: 'urgent' })
je('naléhavé: příznak a označení v nadpisu', [p5.urgent, p5.title], [true, 'Foodtab — naléhavé'])
const p6 = slozitPush({ typ: 'jedna', pocet: 1, druh: null, telo: null, priorita: null })
je('upozornění, které mezitím zmizelo, se řekne obecně', p6.body, 'Máte nové upozornění')
je('souhrn nikdy není naléhavý', slozitPush({ typ: 'souhrn', pocet: 2, druh: null, telo: null, priorita: 'urgent' }).urgent, false)
const p7 = slozitPush({ typ: 'jedna', pocet: 1, druh: 'ukol.pridelen', telo: { nazev: 'Objednat petržel u Nováka' }, priorita: 'normal' })
je('nový úkol: název (z textu zprávy) se na zamčenou obrazovku nedostane', [p7.body, JSON.stringify(p7).includes('petržel')], ['Máte nový úkol', false])
je('neznámý druh nevyleze jinak než obecně', slozitPush({ typ: 'jedna', pocet: 1, druh: 'neznamy.druh', telo: {}, priorita: 'normal' }).body, 'Upozornění')

console.log('\n== Termín a naléhavost: nálezy z revize ==')
{

// 21. 9. 2026 je pondělí (DNES).
const c1 = najdiTermin('Objednej mrkev do 15.10.', DNES)
je('„do 15.10.“ je DATUM (15. října), ne čas 15:10', c1.termin, { datum: '2026-10-15', cas: null })
je('… a nepřidává se poznámka o „do“ s číslem (datum tam už je)', c1.nalezy.some((n) => n.includes('„do“ s číslem')), false)
je('„do 15.30.“ na konci věty je čas (30 není měsíc)', najdiTermin('Zítra to bud hotové do 15.30.', DNES).termin, { datum: '2026-09-22', cas: '15:30' })
je('„do 8.15“ je čas (15 není měsíc)', najdiTermin('Pozítří do 8.15 přijde revize.', DNES).termin, { datum: '2026-09-23', cas: '08:15' })
je('cena není čas („na 5.50 Kč“)', najdiTermin('Zítra kup na 5.50 Kč mrkev.', DNES).termin, { datum: '2026-09-22', cas: null })
je('rozměr není čas („do 1.20 m“)', najdiTermin('Zítra nařež do 1.20 m dřevo.', DNES).termin, { datum: '2026-09-22', cas: null })
je('z intervalu „od 8:00 do 16:00“ je termín KONEC (16:00)', najdiTermin('Zítra od 8:00 do 16:00 bude revize.', DNES).termin, { datum: '2026-09-22', cas: '16:00' })

je('„do střediska“ není den v týdnu', najdiTermin('Zavolej do střediska.', DNES).termin, null)
je('„ve čtvrt na osm“ není čtvrtek', najdiTermin('Sejdeme se ve čtvrt na osm.', DNES).termin, null)
je('„na utěrky“ není úterý', najdiTermin('Objednej peníze na utěrky.', DNES).termin, null)
je('„v neděli“ pořád funguje', najdiTermin('Otevřeno v neděli.', DNES).termin, { datum: '2026-09-27', cas: null })

const c2 = najdiTermin('Udělej to příští týden v pátek.', DNES)
je('„příští týden v pátek“ je pátek PŘÍŠTÍHO týdne (2. 10.), ne nejbližší', c2.termin, { datum: '2026-10-02', cas: null })
je('… a je to k ověření', c2.kontrola, true)
const c3 = najdiTermin('Objednávka je na příští týden, ve středu.', '2026-09-27')
je('z neděle: příští týden ve středu = 30. 9.', c3.termin, { datum: '2026-09-30', cas: null })

const c4 = najdiTermin('Sejdeme se 5. Prosím dej vědět.', DNES)
je('„5. Prosím“ není 5. prosince', c4.termin, null)
je('„3. listy“ (slovo) není 3. listopadu', najdiTermin('Vezmi 3. listy salátu.', DNES).termin, null)
je('„5. prosince“ se pozná', najdiTermin('Vánoční menu 5. prosince.', DNES).termin, { datum: '2026-12-05', cas: null })
je('uvedený rok u data slovem se respektuje („3. března 2027“)', najdiTermin('Kontrola 3. března 2027.', DNES).termin, { datum: '2027-03-03', cas: null })
const c5 = najdiTermin('Kontrola 3. 10. 2020.', DNES)
je('minulé datum s rokem se navrhne, ale je k ověření', [c5.termin, c5.kontrola], [{ datum: '2020-10-03', cas: null }, true])
const c6 = najdiTermin('Inventura 1. 9.', DNES)
je('datum bez roku, které už letos bylo, se posune na příští rok a řekne se to', [c6.termin.datum, c6.kontrola, c6.nalezy.some((n) => n.includes('příští rok'))], ['2027-09-01', true, true])

const c7 = najdiTermin('V pátek 22. 9. objednej mrkev.', DNES)
je('při „v pátek 22. 9.“ má přednost výslovné datum a je to k ověření (22. 9. 2026 je úterý)', [c7.termin.datum, c7.kontrola], ['2026-09-22', true])
const c8 = najdiTermin('Kontrola v pátek 25. 9.', DNES)
je('shoduje-li se den v týdnu s datem, je to jednoznačné (bez ověřování)', [c8.termin.datum, c8.kontrola], ['2026-09-25', false])

je('citace v „Co se poznalo“ nese PŮVODNÍ text s diakritikou', najdiTermin('Sejdeme se v pátek.', DNES).nalezy[0], 'Termín: „v pátek“ → pá 25. 9.')

je('„Není spěch“ není naléhavost', jeNaleha('Objednej mrkev, není spěch.'), false)
je('„Bez spěchu“ není naléhavost', jeNaleha('Udělej to bez spěchu.'), false)
je('„Nespěchej“ není naléhavost', jeNaleha('Nespěchej s tím.'), false)
je('„hned vedle“ (místo) není naléhavost', jeNaleha('Postav to hned vedle lednice.'), false)
je('„není naléhavé“ není naléhavost', jeNaleha('To není naléhavé.'), false)
je('„Hned zavolej dodavateli“ pořád je naléhavost', jeNaleha('Hned zavolej dodavateli.'), true)
je('„Je to naléhavé“ pořád je naléhavost', jeNaleha('Je to naléhavé!'), true)

const n1 = navrhniNazev('Objednej mrkev do 22. 9. prosím.')
je('název se neusekne uprostřed data', n1.nazev, 'Objednej mrkev do 22. 9. prosím')
const n2 = navrhniNazev('Ahojky, objednej mrkev.')
je('„Ahojky“ se neořezává na „Ky“', n2.nazev.startsWith('Ahojky'), true)
const n3 = navrhniNazev('Ahoj, objednej mrkev.')
je('„Ahoj,“ se ořízne', n3.nazev, 'Objednej mrkev')
const n4 = navrhniNazev('Prosím zavolej dodavateli.\nZítra v 8 přijede.')
je('nový řádek je vždy nová věta', n4.poznamka, 'Zítra v 8 přijede.')
const n5 = navrhniNazev('Kup ' + '😀'.repeat(90))
je('zkrácení nerozseká emoji (žádný osamělý surrogát)', /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(n5.nazev), false)

}

console.log('\n== Přepis a příjemci: nálezy z revize ==')

je('neznámé id poskytovatele přepisu = nedostupný', vybratPoskytovatelePrepisu('neexistuje').id, 'zadny')
for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  je('id z prototypu („' + id + '“) nespadne a vrátí nedostupný přepis', vybratPoskytovatelePrepisu(id).id, 'zadny')
}
je('prázdný „hotový“ přepis se neukáže jako ticho', popisStavuPrepisu({ stav: 'hotovo', text: '   ', jazyk: 'cs' }).jeVarovani, true)
je('neprázdný přepis se ukáže', popisStavuPrepisu({ stav: 'hotovo', text: 'Objednej mrkev.', jazyk: 'cs' }).text, 'Objednej mrkev.')

const dvojite = [{ employee_id: 'x1', jmeno: 'Marie Nováková-Svobodová', branch_id: null, usek_id: null, position_id: null, na_me_pobocce: false }]
je('hledání najde druhou část jména s pomlčkou („svob“)', hledatPrijemce(dvojite, 'svob').length, 1)
je('… i s pomlčkou v dotazu („nováková-svob“)', hledatPrijemce(dvojite, 'nováková-svob').length, 1)
je('… a neshoduje se, co ve jménu není', hledatPrijemce(dvojite, 'kučera').length, 0)

console.log('\n== Přílohy ke zprávám ==')

const MBP = 1024 * 1024
je('typ z prohlížeče', typSouboru({ name: 'a.jpg', type: 'image/jpeg' }), 'image/jpeg')
je('typ s parametrem se ořízne', typSouboru({ name: 'a.png', type: 'image/png; charset=x' }), 'image/png')
je('image/jpg se sjednotí na jpeg', typSouboru({ name: 'a.jpg', type: 'image/jpg' }), 'image/jpeg')
je('prázdný typ u PDF se dovodí z přípony', typSouboru({ name: 'Faktura.PDF', type: '' }), 'application/pdf')
je('prázdný typ a neznámá přípona = nic (neuhaduje se)', typSouboru({ name: 'a.exe', type: '' }), '')
je('povolené typy jsou čtyři', Object.keys(TYPY_PRILOH).sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
je('jeTypPriloh: pdf ano, html ne, toString ne', [jeTypPriloh('application/pdf'), jeTypPriloh('text/html'), jeTypPriloh('toString')], [true, false, false])
je('limity sedí s migrací (5 příloh, 10 MiB)', [MAX_PRILOH, MAX_BAJTU], [5, 10485760])

je('cesta v úložišti: firma/rozhovor/id.přípona',
  cestaPriloh('t1', 'k1', 'u1', 'application/pdf'), 't1/k1/u1.pdf')
je('velikost: bajty', velikostText(512), '512 B')
je('velikost: kB', velikostText(120000), '117 kB')
je('velikost: MB s čárkou', velikostText(1.5 * MBP), '1,5 MB')
je('velikost: nesmysl = prázdné', velikostText(-1), '')

je('název: složky pryč', ocistitNazev('../../etc/passwd'), 'passwd')
je('název: zpětná lomítka pryč', ocistitNazev('C:' + String.fromCharCode(92) + 'x' + String.fromCharCode(92) + 'foto.jpg'), 'foto.jpg')
je('název: prázdný = soubor', ocistitNazev('   '), 'soubor')
je('název: řídicí znaky pryč', ocistitNazev('a' + String.fromCharCode(0) + 'b.jpg'), 'ab.jpg')
je('název: strop 120 znaků', ocistitNazev('x'.repeat(300)).length, 120)

const sf = (name, type, size) => ({ name, type, size })
let vyb = zkontrolujVyber([sf('a.jpg', 'image/jpeg', MBP), sf('b.pdf', 'application/pdf', 2 * MBP)], 0)
je('platný výběr projde celý', [vyb.platne, vyb.chyby], [[0, 1], []])

vyb = zkontrolujVyber([sf('a.exe', 'application/x-msdownload', 100), sf('b.jpg', 'image/jpeg', 100)], 0)
je('nepovolený typ se odmítne jmenovitě, zbytek projde', [vyb.platne, vyb.chyby.length, vyb.chyby[0].includes('a.exe')], [[1], 1, true])

vyb = zkontrolujVyber([sf('velke.pdf', 'application/pdf', 11 * MBP)], 0)
je('PDF přes 10 MB se odmítne', [vyb.platne, vyb.chyby.length], [[], 1])

vyb = zkontrolujVyber([sf('velka.jpg', 'image/jpeg', 20 * MBP)], 0)
je('velká fotka projde výběrem (zmenší se, pak se kontroluje znovu)', vyb.platne, [0])

vyb = zkontrolujVyber([sf('nula.jpg', 'image/jpeg', 0)], 0)
je('prázdný soubor se odmítne', [vyb.platne, vyb.chyby.length], [[], 1])

vyb = zkontrolujVyber([1, 2, 3, 4].map((i) => sf(i + '.png', 'image/png', 100)), 3)
je('přebytek nad pět se odřízne a řekne se to (3 už vybrané + 4 nové = jen 2 volná)',
  [vyb.platne, vyb.chyby.length], [[0, 1], 2])

vyb = zkontrolujVyber([sf('a.png', 'image/png', 100)], 5)
je('při plném počtu nejde nic dalšího', [vyb.platne, vyb.chyby.length], [[], 1])

vyb = zkontrolujVyber([sf('a.png', 'image/png', 100)], 9)
je('přeplněno (uzMa > 5) nikdy nedá záporný počet', [vyb.platne, vyb.chyby.length], [[], 1])

vyb = zkontrolujVyber([sf('foto.heic', 'image/heic', 3 * MBP)], 0)
je('HEIC projde výběrem (komponenta ho zkusí převést)', vyb.platne, [0])

je('po zmenšení: JPEG do limitu prošel', zkontrolujPoZmenseni('a.jpg', 'image/jpeg', MBP), null)
je('po zmenšení: pořád přes limit', zkontrolujPoZmenseni('a.jpg', 'image/jpeg', 11 * MBP) !== null, true)
je('po zmenšení: HEIC, který se nepodařilo převést, se odmítne', zkontrolujPoZmenseni('a.heic', 'image/heic', MBP) !== null, true)
je('po zmenšení: nula bajtů se odmítne', zkontrolujPoZmenseni('a.jpg', 'image/jpeg', 0) !== null, true)

je('text zprávy: popisek má přednost', textZpravyPrilohy('  Tady je objednávka  ', ['a.pdf']), 'Tady je objednávka')
je('text zprávy: jedna příloha bez popisku', textZpravyPrilohy('', ['a.pdf']), 'Příloha: a.pdf')
je('text zprávy: víc příloh bez popisku', textZpravyPrilohy('   ', ['a.pdf', 'b.jpg']), 'Přílohy (2): a.pdf, b.jpg')
je('text zprávy: název v textu je očištěný', textZpravyPrilohy('', ['../x/a.pdf']), 'Příloha: a.pdf')
je('text zprávy: dlouhý popisek se ořízne na 4000', textZpravyPrilohy('x'.repeat(5000), []).length, 4000)
je('text zprávy: nikdy prázdný', textZpravyPrilohy('', []), 'Příloha')

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO\n' : `\nCHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
