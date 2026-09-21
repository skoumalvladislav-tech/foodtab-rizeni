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
import { denVPasmu, popisDne, poskladatVlakno } from '../lib/komunikace/vlakno.ts'
import {
  hledatPrijemce,
  normalizuj,
  seskupitPrijemce,
  souhrnVyberu,
  vychoziNazevRozhovoru,
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
je('… a říká proč (pravidlo 8)', stavModelu.dostupny === false && stavModelu.duvod.includes('pravidlo 8'), true)
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
je('neplatné pásmo nespadne', denVPasmu('2026-09-20T12:00:00Z', 'Nikde/Neni'), '2026-09-20')
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
je('výchozí název: jeden příjemce = jeho celé jméno', vychoziNazevRozhovoru([{ jmeno: 'Karel Novák' }]), 'Karel Novák')
je('výchozí název: víc příjemců = souhrn', vychoziNazevRozhovoru([{ jmeno: 'Karel Novák' }, { jmeno: 'Božena Řezníčková' }]), 'Karel a Božena')
je('výchozí název: nikdo = prázdný', vychoziNazevRozhovoru([]), '')

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO\n' : `\nCHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
