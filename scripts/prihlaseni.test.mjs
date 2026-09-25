#!/usr/bin/env node
/**
 * Přihlášení kódem — co jde ověřit bez prohlížeče a bez Supabase.
 *
 * Pusť `node --experimental-strip-types scripts/prihlaseni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TO STOJÍ ZA TO OVĚŘOVAT TAKHLE
 *
 * Přihlašovací obrazovka je jediná, ke které se nedostane nikdo
 * zvenčí — nedá se proklikat v provozu a nedá se na ni podívat, dokud
 * se člověk nepřihlásí. Právě proto se na ní dvakrát po sobě přehlédlo
 * to podstatné: nejdřív že odkaz z e-mailu nejde dokončit v jiném
 * prohlížeči, pak že tři vyžádané kódy vypadají stejně, ale platí jen
 * poslední.
 *
 * ---------------------------------------------------------------------
 * CO TÍMHLE OVĚŘENÉ NENÍ — a je poctivé to říct nahlas
 *
 * Ze zadání (`docs/prihlaseni-dokonceni-2026-09-06.md`, Testy) jde
 * odsud ověřit pět bodů z deseti. Zbylých pět potřebuje živý Supabase
 * nebo prohlížeč:
 *
 *   1. kód z e-mailu projde a přihlásí   — živý Supabase
 *   3. vypršelý kód neprojde             — živý Supabase (platnost hlídá on)
 *   4. kód nejde použít dvakrát          — živý Supabase
 *   5. nový kód zneplatní předchozí      — živý Supabase
 *   8. odhlášení a tlačítko zpět         — prohlížeč
 *   9. přihlášení drží po zavření        — prohlížeč
 *
 * Ty se musí projít rukou po nasazení. Seznam je v hlášení.
 * ---------------------------------------------------------------------
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  adresaProPrvniKod,
  bezpecnyCil,
  hlaskaProChybu,
  HLASKA_SPATNY_KOD,
  HLASKA_STROP,
  jeStrop,
  maUkazatNaPlochu,
  normalizujKod,
  ucetUzExistuje,
  zbyvaDoZnovu,
} from '../lib/prihlaseni.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

const KOREN = new URL('..', import.meta.url)

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/**
 * Zdroják bez komentářů — hlídá se KÓD, ne to, co se o něm píše.
 *
 * Napoprvé tady komentáře nebyly odstraněné a dvě kontroly spadly na
 * vlastní dokumentaci: v hlavičce obou souborů je vysvětlené, PROČ se
 * `getBrowserSupabase` nepoužívá, a hledaný výraz se trefil do té věty.
 * Kontrola by tak zakazovala i psát o tom, čemu brání — a kdo by ten
 * odstavec smazal, „opravil" by ji.
 *
 * Řetězce se přeskakují, aby `'https://…'` nevypadalo jako začátek
 * komentáře.
 */
function bezKomentaru(zdroj) {
  let out = ''
  let i = 0
  while (i < zdroj.length) {
    const c = zdroj[i]
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < zdroj.length && zdroj[j] !== c) {
        if (zdroj[j] === '\\') j++
        j++
      }
      out += zdroj.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '/' && zdroj[i + 1] === '/') {
      const k = zdroj.indexOf('\n', i)
      i = k === -1 ? zdroj.length : k
      continue
    }
    if (c === '/' && zdroj[i + 1] === '*') {
      const k = zdroj.indexOf('*/', i + 2)
      i = k === -1 ? zdroj.length : k + 2
      continue
    }
    out += c
    i++
  }
  return out
}

const nacti = (cesta) =>
  bezKomentaru(fs.readFileSync(new URL(cesta, KOREN), 'utf8'))

/**
 * Kód bez obsahu řetězců — `klic="odhlasit"` je jméno ikony, ne volání.
 *
 * Výrazy `${…}` v šablonových řetězcích zůstávají: je to kód a volání
 * schované do šablony by se jinak ztratilo s ní. Apostrof a uvozovka
 * končí na konci řádku — v textu JSX („don't") by jinak spolkly kód
 * až k další uvozovce kdesi níž.
 */
function bezRetezcu(kod) {
  let out = ''
  let i = 0
  const hloubky = [] // otevřené `${`: kolik neuzavřených { v každém
  while (i < kod.length) {
    const c = kod[i]
    if (c === '`' || (c === '}' && hloubky.length > 0 && hloubky.at(-1) === 0)) {
      // Začátek šablony, nebo návrat do ní za koncem `${…}`.
      if (c === '}') hloubky.pop()
      let j = i + 1
      while (j < kod.length && kod[j] !== '`' && !(kod[j] === '$' && kod[j + 1] === '{')) {
        if (kod[j] === '\\') j++
        j++
      }
      if (kod[j] === '$') {
        hloubky.push(0)
        out += '`${'
        i = j + 2
      } else {
        out += '``'
        i = j + 1
      }
      continue
    }
    if (c === '{' && hloubky.length > 0) hloubky[hloubky.length - 1]++
    if (c === '}' && hloubky.length > 0) hloubky[hloubky.length - 1]--
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < kod.length && kod[j] !== c && kod[j] !== '\n') {
        if (kod[j] === '\\') j++
        j++
      }
      if (kod[j] === c) {
        out += c + c
        i = j + 1
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/** Zdrojáky aplikace (bez dočasných náhledů v app/nahled), cesty od kořene. */
function zdrojakyAplikace(slozky) {
  const vysledek = []
  const projit = (slozka) => {
    for (const z of fs.readdirSync(new URL(slozka + '/', KOREN), { withFileTypes: true })) {
      const cesta = `${slozka}/${z.name}`
      if (z.isDirectory()) {
        if (cesta !== 'app/nahled' && z.name !== 'node_modules') projit(cesta)
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(z.name)) {
        vysledek.push(cesta)
      }
    }
  }
  for (const s of slozky) projit(s)
  return vysledek
}

/* --- 1. „moc pokusů" se nesmí splést se „špatný kód" ------------------ */

console.log('\n== 1. Strop na IP se odliší od špatného kódu ==============')

/*
  Limity Supabase jsou na IP ADRESU a celá provozovna má na wifi jednu.
  Když se strop překročí a aplikace řekne „kód nesedí", hledá se chyba
  v kódu, který je správně. Tohle je jediné místo, kde se ty dva stavy
  rozdělují — proto je na něj šest kontrol, ne jedna.
*/
ma('stav 429 je strop', jeStrop({ status: 429 }), true)
ma('over_email_send_rate_limit je strop',
  jeStrop({ code: 'over_email_send_rate_limit' }), true)
ma('over_request_rate_limit je strop',
  jeStrop({ code: 'over_request_rate_limit' }), true)
ma('obyčejná chyba strop není',
  jeStrop({ status: 400, code: 'otp_expired' }), false)
ma('prázdná chyba strop není', jeStrop(null), false)

ma('u stropu se ukáže „počkejte pár minut"',
  hlaskaProChybu({ status: 429 }), HLASKA_STROP)
ma('u špatného kódu ta druhá věta',
  hlaskaProChybu({ status: 400 }), HLASKA_SPATNY_KOD)

// Obě hlášky jsou pro člověka: česky a bez čísel chyb.
ma('hláška o stropu neobsahuje číslo chyby', /\d{3}/.test(HLASKA_STROP), false)
ma('hláška o kódu neobsahuje číslo chyby', /\d{3}/.test(HLASKA_SPATNY_KOD), false)
ma('hláška o stropu je česky', /[ěščřžýáíéůú]/i.test(HLASKA_STROP), true)
ma('hláška o kódu je česky', /[ěščřžýáíéůú]/i.test(HLASKA_SPATNY_KOD), true)


/* --- 2. „Poslat znovu" je minutu zašedlé ----------------------------- */

console.log('\n== 2. Odpočet u „Poslat znovu" ===========================')

/*
  Šéfík si vyžádal tři kódy během tří minut a platil jen ten poslední;
  z obrazovky to poznat nešlo, takže zkoušel ten první.
*/
const T = 1_757_000_000_000

ma('hned po odeslání zbývá 60 s', zbyvaDoZnovu(T, T), 60)
ma('po vteřině 59', zbyvaDoZnovu(T, T + 1000), 59)
ma('po 59 vteřinách ještě 1', zbyvaDoZnovu(T, T + 59_000), 1)
ma('po minutě 0', zbyvaDoZnovu(T, T + 60_000), 0)
ma('později taky 0, ne záporné číslo', zbyvaDoZnovu(T, T + 600_000), 0)
ma('bez odeslání se nečeká', zbyvaDoZnovu(0, T), 0)

/*
  Přetočené hodiny v telefonu čekání NEZKRÁTÍ na zápor, ale ani ho
  neprodlouží donekonečna — `odeslanoKdy` je čas ze serveru, takže
  posun dopředu jen ubere. Kontrola je tu na to, aby se nestalo, že
  se tlačítko zasekne navždy.
*/
ma('hodiny přetočené dozadu tlačítko nezaseknou',
  zbyvaDoZnovu(T, T - 3_600_000) <= 60 * 60 + 60, true)


/* --- 3. Návrat po přihlášení nesmí odnést jinam ---------------------- */

console.log('\n== 3. Kam se po přihlášení vrátit ========================')

ma('obyčejná cesta projde', bezpecnyCil('/firma/rozhovory'), '/firma/rozhovory')
ma('cesta s dotazem projde', bezpecnyCil('/perla/ukoly?ukol=1'), '/perla/ukoly?ukol=1')
// `/` je úvod (app/page.tsx), odtud se jde na Dnes.
ma('prázdno vede na úvod', bezpecnyCil(''), '/')
ma('nic vede na úvod', bezpecnyCil(null), '/')

/*
  `//zloduch.cz` je platná adresa, kterou prohlížeč přečte jako CIZÍ
  DOMÉNU. Kdyby prošla, dá se poslat odkaz na naše přihlášení, po
  kterém člověk skončí jinde a myslí si, že je pořád u nás.
*/
ma('dvě lomítka = cizí doména, neprojde', bezpecnyCil('//zloduch.cz'), '/')
ma('lomítko a zpětné lomítko taky ne', bezpecnyCil('/\\zloduch.cz'), '/')
ma('celá adresa neprojde', bezpecnyCil('https://zloduch.cz'), '/')
ma('zpátky na přihlášení se nevrací', bezpecnyCil('/prihlaseni'), '/')
ma('ani s dotazem', bezpecnyCil('/prihlaseni?chyba=odkaz'), '/')


/* --- 4. Věta o přidání na plochu ------------------------------------- */

console.log('\n== 4. „Nejdřív na plochu, pak se přihlas" ================')

/*
  Na iPhonu má aplikace na ploše vlastní úložiště. Kdo se přihlásí
  v Safari a pak si ji přidá na plochu, je v ní nepřihlášený — a vypadá
  to jako chyba aplikace, ne jako pořadí kroků.
*/
ma('v prohlížeči na telefonu se ukáže',
  maUkazatNaPlochu({ naPlose: false, uzkaObrazovka: true }), true)
ma('v aplikaci na ploše NE',
  maUkazatNaPlochu({ naPlose: true, uzkaObrazovka: true }), false)
ma('na počítači NE — tam oddělené úložiště není',
  maUkazatNaPlochu({ naPlose: false, uzkaObrazovka: false }), false)
ma('a v aplikaci na počítači taky ne',
  maUkazatNaPlochu({ naPlose: true, uzkaObrazovka: false }), false)


/* --- 5. Obrazovka: pole na kód a co na ní není ----------------------- */

console.log('\n== 5. Obrazovka přihlášení ===============================')

/*
  Serverová akce se podstrkuje: doopravdy by sáhla na Supabase.
  `useActionState` si z ní bere jen výchozí stav, takže se vykreslí
  první krok — zadání adresy.
*/
const STUB_AKCE =
  'data:text/javascript,' +
  encodeURIComponent(
    'export async function prihlasit(s) { return s }\n' +
      'export async function odhlasit() {}\n',
  )

const PrihlaseniKodem = await nactiKomponentu(
  'app/prihlaseni/prihlaseni-kodem.tsx',
  [['./akce', STUB_AKCE]],
)

function obrazovka(vlastnosti) {
  return renderToStaticMarkup(
    createElement(PrihlaseniKodem, {
      chybaZOdkazu: false,
      zQr: false,
      odhlaseny: false,
      kam: '/',
      ...vlastnosti,
    }),
  )
}

/** Značka `<input>` s daným id. Hledá se podle id, ne podle pořadí. */
function vstup(html, id) {
  const m = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))
  return m ? m[0] : null
}

const uvod = obrazovka({})

ma('první krok je zadání e-mailu', vstup(uvod, 'email') !== null, true)
ma('pole na kód se ukáže až po odeslání', vstup(uvod, 'kod'), null)
ma('tlačítko říká, že přijde kód', uvod.includes('Poslat kód'), true)
ma('o odkazu se nemluví', /odkaz/i.test(uvod), false)

/*
  ATRIBUTY SE HLEDAJÍ UVNITŘ ZNAČKY, NE VZORCEM PŘES CELÝ ŘÁDEK.

  React řadí atributy jinak, než jak jsou napsané v JSX — kontrola
  tvaru `/id="kod"[^>]*autocomplete/` by se nemusela trefit nikdy
  a tvářila by se přitom jako důkaz. Přesně tahle chyba se v projektu
  už jednou stala (CLAUDE.md, „Každá nová kontrola musí umět spadnout").
  Proto se nejdřív vyřízne celá značka a teprve v ní se hledá.
*/
const sChybou = obrazovka({ chybaZOdkazu: true })
ma('kdo přišel z mrtvého odkazu, dostane větu o kódu',
  sChybou.includes('Nechte si prosím poslat nový kód'), true)

// Věta o ploše se při serverovém vykreslení neukazuje — hodnotu dodá
// až prohlížeč. Kdyby se ukázala i tady, byla by v aplikaci na ploše.
ma('při serverovém vykreslení věta o ploše není',
  /na plochu ještě před přihlášením/.test(uvod), false)

/* --- druhý krok: pole na kód -------------------------------------- */

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA OBRAZOVKY.

  `autoComplete="one-time-code"` je to, co iPhonu řekne, že sem patří
  kód z oznámení. Bez něj ho musí člověk přepisovat ručně mezi dvěma
  aplikacemi — a to je přesně ta chvíle, kdy to lidi vzdají.

  Čte se z VYKRESLENÉHO výstupu, ne ze zdrojáku, a atribut se hledá
  UVNITŘ vyříznuté značky. Vzorec přes celý řádek (`/id="kod"[^>]*
  autocomplete/`) by se nemusel trefit nikdy, protože React řadí
  atributy jinak, než jak jsou napsané v JSX — a tvářil by se přitom
  jako důkaz. Tahle chyba se v projektu už jednou stala
  (CLAUDE.md, „Každá nová kontrola musí umět spadnout").
*/
const naKodu = obrazovka({
  vychoziStav: {
    krok: 'kod',
    email: 'sefik@foodtab.cz',
    chyba: '',
    odeslanoKdy: 0,
  },
})

const poleKodu = vstup(naKodu, 'kod')

/**
 * Má ta značka atribut s tou hodnotou?
 *
 * Jméno se porovnává BEZ OHLEDU NA VELIKOST PÍSMEN. Napoprvé tu stálo
 * `includes('autocomplete="one-time-code"')` a kontrola spadla, i když
 * atribut na svém místě byl: React 19 ho do výstupu vypíše tak, jak je
 * napsaný v JSX — `autoComplete`, ne `autocomplete`. Kdybych to tehdy
 * „opravil" v komponentě místo v kontrole, rozbil bych funkční kód
 * podle chybné zkoušky.
 */
function maAtribut(znacka, jmeno, hodnota) {
  const re = new RegExp(`\\b${jmeno}="${hodnota}"`, 'i')
  return re.test(znacka ?? '')
}

ma('druhý krok má pole na kód', poleKodu !== null, true)
ma('a iPhone do něj nabídne kód z oznámení',
  maAtribut(poleKodu, 'autocomplete', 'one-time-code'), true)
ma('otevře se číselná klávesnice',
  maAtribut(poleKodu, 'inputmode', 'numeric'), true)
ma('řekne se, kam kód přišel', naKodu.includes('sefik@foodtab.cz'), true)
ma('a jde zadat jiná adresa bez načtení stránky',
  naKodu.includes('Zadat jinou adresu'), true)
ma('„Poslat znovu" tam je', naKodu.includes('Poslat znovu'), true)

/*
  A že se ten atribut opravdu HLEDÁ: kdyby ho vyřezávač značky
  přehlédl, obě kontroly výš by prošly nad čímkoli. Tohle je zkouška
  té zkoušky.
*/
ma('vyřezávač značky by chybějící atribut poznal',
  maAtribut(vstup('<input id="kod" type="text">', 'kod'),
    'autocomplete', 'one-time-code'),
  false)
ma('a nespletl by si jinou hodnotu',
  maAtribut('<input autoComplete="email">', 'autocomplete', 'one-time-code'),
  false)
ma('a značku bez toho id nenajde vůbec',
  vstup('<input id="email" autocomplete="one-time-code">', 'kod'), null)

/* --- vložení celého kódu naráz -------------------------------------- */

/*
  TOHLE JE ZKOUŠKA NA TO, CO SE 6. 9. ROZBILO.

  Šéfík nemohl na iPhonu vložit zkopírovaný kód: bublina „Vložit"
  problikla a zmizela. Příčina nebyla ve vkládání, ale v překreslování —
  odpočet „Poslat znovu" tikal po vteřinách uvnitř téže komponenty jako
  políčko, takže se pole každou vteřinou překreslilo a bublina se
  zavřela.

  Měří se tedy obojí: že kód vložený NARÁZ projde celý, a že tikání
  není ve stromu s polem.
*/

ma('šest číslic vložených naráz projde celých',
  normalizujKod('123456'), '123456')
ma('a projde i s mezerou, jak se kód sází v e-mailu',
  normalizujKod('123 456'), '123456')
ma('i s nezlomitelnou mezerou, kterou trim() neodstraní',
  normalizujKod('123 456'), '123456')
ma('i s úzkou nezlomitelnou mezerou',
  normalizujKod('123 456'), '123456')
ma('i se znakem nulové šířky, který člověk nevidí',
  normalizujKod('1​23456'), '123456')
ma('i se značkou pořadí bajtů na začátku',
  normalizujKod('﻿123456'), '123456')
ma('i se zalomením řádku z kopírování',
  normalizujKod('123\n456'), '123456')
ma('prázdno zůstane prázdné', normalizujKod('   '), '')
ma('nic zůstane prázdné', normalizujKod(null), '')

/*
  Písmena se NEODSTRAŇUJÍ. Kdyby Supabase někdy vydával kód s písmeny,
  odstraňování nečíslic by ho tiše rozbilo — a hledalo by se to
  v ověřování, ne tady.
*/
ma('písmena se nezahazují', normalizujKod('a1b2c3'), 'a1b2c3')

/*
  A že pole a odpočet nejsou v jednom stromu. Tohle je ta vlastní
  příčina, ne příznak.
*/
const zdrojFormularSurovy = fs.readFileSync(
  new URL('app/prihlaseni/prihlaseni-kodem.tsx', KOREN),
  'utf8',
)
const zdrojOdpoctu = nacti('app/prihlaseni/poslat-znovu.tsx')

ma('odpočet má vlastní komponentu',
  zdrojFormularSurovy.includes('poslat-znovu'), true)
ma('a tik je v ní, ne u pole',
  zdrojOdpoctu.includes('setInterval'), true)
ma('komponenta s polem už netiká',
  nacti('app/prihlaseni/prihlaseni-kodem.tsx').includes('setInterval'), false)
/*
  V komponentě s tikem nesmí být žádné pole, DO KTERÉHO SE PÍŠE.

  Skryté `<input type="hidden">` vadit nemůže — nese jen hodnotu do
  formuláře, nedá se do něj ťuknout a bublinu „Vložit" nad ním nikdo
  neotevře. Napoprvé tahle kontrola hledala prostě `<input` a spadla
  právě na nich; měřila by tedy něco jiného, než na co míří.
*/
const poleVOdpoctu = (zdrojOdpoctu.match(/<input\b[^>]*>/g) ?? [])
  .filter((z) => !z.includes('type="hidden"'))

ma('komponenta s tikem nemá pole, do kterého se píše',
  poleVOdpoctu.length, 0)
ma('a ten filtr by pole poznal',
  ['<input type="hidden" name="a" />', '<input id="kod" />']
    .filter((z) => !z.includes('type="hidden"')).length,
  1)

/*
  Pole nesmí mít měnící se `key` — to by ho při každém překreslení
  odpojilo a připojilo znovu, a bublina „Vložit" by mizela dál, i když
  tikání zmizelo.
*/
/**
 * Vyřízne ze ZDROJÁKU celou značku `<input …/>`, která má dané id.
 *
 * Nedá se to udělat regulárním výrazem s délkovým stropem: mezi
 * `<input` a `/>` je u pole na kód přes tisíc znaků komentářů. Přesně
 * na tom tahle kontrola napoprvé selhala — vzorec `[\s\S]{0,900}?` se
 * netrefil, vrátil prázdno, a všechny tři kontroly pod ním prošly nad
 * čímkoli. Kontrola, která nic nenajde a tváří se jako důkaz, je horší
 * než žádná.
 *
 * Scanuje se proto poctivě: od `<input` dopředu, se sledováním
 * složených závorek, dokud nepřijde `/>` na nulté úrovni.
 */
function znackaVeZdrojaku(zdroj, id) {
  const kde = zdroj.indexOf(`id="${id}"`)
  if (kde < 0) return ''
  const zac = zdroj.lastIndexOf('<input', kde)
  if (zac < 0) return ''
  let hloubka = 0
  for (let i = zac; i < zdroj.length; i++) {
    const c = zdroj[i]
    if (c === '{') hloubka++
    else if (c === '}') hloubka--
    else if (c === '/' && zdroj[i + 1] === '>' && hloubka === 0) {
      return zdroj.slice(zac, i + 2)
    }
  }
  return ''
}

/*
  KOMENTÁŘE SE MUSÍ ODSTRANIT I TADY.

  Uvnitř té značky jsou vysvětlivky, které samy zmiňují `onChange`
  i `type="number"` — je v nich napsané, PROČ tam nejsou. Bez
  odstranění se kontroly trefily přesně do nich a hlásily chybu nad
  správným kódem. Je to potřetí, co mě na tomhle projektu chytila
  vlastní próza; proto se `bezKomentaru` používá všude, kde se sahá
  na zdroják.
*/
const poleSurove = bezKomentaru(znackaVeZdrojaku(zdrojFormularSurovy, 'kod'))

// Nejdřív že se vůbec něco našlo — jinak jsou kontroly pod tím slepé.
ma('značka pole na kód se ve zdrojáku našla', poleSurove.length > 0, true)
ma('a je to opravdu to pole', poleSurove.includes('name="kod"'), true)
ma('a komentáře z ní odešly',
  poleSurove.includes('one-time-code` NECH TADY'), false)

ma('pole na kód nemá key', /\bkey=/.test(poleSurove), false)
ma('a je neřízené — žádný onChange, který by zahazoval znaky',
  /onChange/.test(poleSurove), false)
ma('a není type="number"', /type="number"/.test(poleSurove), false)
ma('ale autoComplete one-time-code v něm zůstal',
  /autoComplete="one-time-code"/.test(poleSurove), true)

// A že ten vyřezávač pozná i to, co hledáme.
ma('vyřezávač by našel key, kdyby tam bylo',
  /\bkey=/.test(znackaVeZdrojaku('<input key={x} id="kod" name="kod" />', 'kod')),
  true)
ma('a type="number", kdyby tam bylo',
  /type="number"/.test(
    znackaVeZdrojaku('<input type="number" id="kod" name="kod" />', 'kod')),
  true)

ma('QR poznámka se ukáže jen po načtení kódu',
  obrazovka({ zQr: true }).includes('QR kódu na tabletu'), true)
ma('a jinak ne', uvod.includes('QR kódu na tabletu'), false)

ma('po odhlášení se to řekne',
  obrazovka({ odhlaseny: true }).includes('Odhlásili jsme vás'), true)


/* --- 6. Zdrojáky: co v nich SMÍ a NESMÍ být -------------------------- */

console.log('\n== 6. Cookie zakládá server, ne javascript ===============')

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V SOUBORU a je jediná, která
  hlídá chybu, na kterou se přišlo až po týdnu provozu.

  Browser klient (`getBrowserSupabase`) ukládá sezení do
  `document.cookie` — javascriptem. Safari takovou cookie zkracuje na
  SEDM DNÍ, takže by lidem přihlášení po týdnu mizelo a nikdo by
  nepoznal proč. Serverový klient zapisuje hlavičku `Set-Cookie` a na
  tu se to omezení nevztahuje.

  Kontrola se dívá na ZDROJÁK, ne na chování: kdyby někdo příště sáhl
  na Supabase přímo z přihlašovací obrazovky, spadne to tady, a ne až
  za týden na Šéfíkově telefonu.
*/

const zdrojFormular = nacti('app/prihlaseni/prihlaseni-kodem.tsx')
const zdrojAkce = nacti('app/prihlaseni/akce.ts')
const zdrojCallback = nacti('app/auth/callback/route.ts')

// A pojistka, že ten odstraňovač komentářů opravdu něco odstraňuje.
// Kdyby vracel vstup beze změny, obě kontroly níž by zase měřily prózu.
ma('odstraňovač komentářů opravdu ubírá',
  bezKomentaru('const a = 1 // getBrowserSupabase\n').includes('getBrowser'),
  false)
ma('a kód nechává být',
  bezKomentaru('const a = 1 // pozn\n').includes('const a = 1'), true)
ma('řetězec s dvěma lomítky přežije',
  bezKomentaru("const u = 'https://x.cz'").includes('https://x.cz'), true)

ma('přihlašovací obrazovka nesahá na Supabase z prohlížeče',
  /getBrowserSupabase|createBrowserClient/.test(zdrojFormular), false)
ma('a neukládá nic do localStorage',
  /localStorage|sessionStorage/.test(zdrojFormular), false)
ma('ověření kódu běží v serverové akci',
  zdrojAkce.includes("'use server'") && zdrojAkce.includes('verifyOtp'), true)
ma('serverová akce bere serverový klient',
  zdrojAkce.includes('getServerSupabase'), true)
ma('a nesahá na browser klient',
  /getBrowserSupabase|createBrowserClient/.test(zdrojAkce), false)
ma('odhlášení taky běží na serveru',
  zdrojAkce.includes('signOut'), true)
ma('výměna kódu za sezení je route handler na serveru',
  zdrojCallback.includes('exchangeCodeForSession')
    && zdrojCallback.includes('getServerSupabase'), true)

/*
  Účet se přihlášením NEZAKLÁDÁ. Do Foodtabu se vstupuje jen na
  pozvánku; bez `shouldCreateUser: false` by si vstup udělal kdokoli
  s e-mailovou adresou.
*/
ma('přihlášení nezaloží účet neznámé adrese',
  /shouldCreateUser:\s*false/.test(zdrojAkce), true)

/*
  Neznámý e-mail dostane STEJNOU odpověď jako známý — ověřuje se tím,
  že po `signInWithOtp` se chyba (kromě stropu) nikam nepropisuje.
  Kdyby se propsala, dá se zkoušením adres zjistit, kdo ve firmě
  pracuje.
*/
const poOdeslani = zdrojAkce.slice(
  zdrojAkce.indexOf('signInWithOtp'),
  zdrojAkce.indexOf("if (akce === 'overit')"),
)
ma('po odeslání kódu se chyba (kromě stropu) nikam nepropíše',
  /chyba:\s*error|error\.message/.test(poOdeslani), false)


/* --- 7. Odhlásit se je v aplikaci k nalezení ------------------------- */

console.log('\n== 7. Odhlásit se ========================================')

/*
  Do 6. 9. 2026 nebylo slovo „odhlásit" v aplikaci NIKDE. Na sdíleném
  telefonu za barem se tak nedal přepnout člověk a Šéfík se nemohl
  přihlásit jako číšník, aby viděl, co číšník vidí.
*/
const zdrojMojeUdaje = nacti('app/moje-udaje/page.tsx')
// Rám (`app/[rozsah]/ram.tsx`) se 15. 9. rozdělil na components/shell/ —
// horní lišta je GlobalTopbar.
const zdrojRam = nacti('components/shell/GlobalTopbar.tsx')

ma('odhlášení je na Moje údaje', zdrojMojeUdaje.includes('Odhlásit se'), true)
ma('a volá serverovou akci', zdrojMojeUdaje.includes('odhlasit'), true)

/*
  A JE I VLEVO DOLE A POD „VÍCE".

  Na Mých údajích bylo od 6. 9. a bylo udělané dobře — jen ho tam nikdo
  nenašel. Cesta k němu vede přes Více → Moje údaje → sjet úplně dolů,
  pod souhlasy a stahování dat; Šéfík ho nenašel, ačkoli věděl, že tam
  je. 8. 9.: „ikonu odhlásit dát na základní obrazovku třeba vlevo
  dolů, teď je schovaná" (docs/zarazeni-misto-roli.md, 6.6).

  Do 25. 9. 2026 to byl rozcestník (`app/[rozsah]/page.tsx`); ten je
  zrušený. Teď je odhlášení:
    - na telefonu ve výsuvném menu „Více" (components/shell/MobileVice.tsx),
    - nad 640 px, kde spodní lišta s „Více" není, vlevo dole na konci
      levého sloupce (components/shell/ModuleSidebar.tsx) — a na konci
      sloupců Marketingu a Faktur, které ho na počítači nahrazují.
  Všude TUTÁŽ komponenta s dotazem (components/shell/Odhlaseni.tsx).
  Že se opravdu zeptá a teprve pak odhlásí, ověřuje klikáním
  scripts/nabidka.test.mjs.

  Na Mých údajích zůstává taky — tam patří k výdeji dat a k souhlasům.
  Místa se hlídají zvlášť, aby se jedno nedalo omylem zrušit s tím,
  že „je to přece i vedle".
*/
const zdrojOdhlaseni = nacti('components/shell/Odhlaseni.tsx')
const zdrojVice = nacti('components/shell/MobileVice.tsx')
const zdrojMenuUctu = nacti('components/shell/MenuUctu.tsx')
ma('odhlášení s dotazem volá serverovou akci', /action=\{odhlasit\}/.test(zdrojOdhlaseni), true)
ma('  a nejdřív se ptá', zdrojOdhlaseni.includes('Odhlásit se?'), true)
ma('je pod „Více" na telefonu', /<Odhlaseni\s+varianta="menu"\s*\/>/.test(zdrojVice), true)
for (const [popis, soubor] of [
  ['a vlevo dole v levém sloupci', 'components/shell/ModuleSidebar.tsx'],
  ['  i ve sloupci Marketingu', 'app/[rozsah]/marketing/navigace.tsx'],
  ['  i ve sloupci Faktur', 'app/[rozsah]/finance/faktury/navigace.tsx'],
]) {
  ma(popis, /<Odhlaseni\s+varianta="sloupec"\s*\/>/.test(nacti(soubor)), true)
}

/*
  V HORNÍ LIŠTĚ NE. Omylem ťuknutý odhlas uprostřed směny je horší než
  o jedno ťuknutí delší cesta — číšník by se pak přihlašoval kódem
  z e-mailu s rukama plnýma talířů.

  Platí i pro nabídku pod iniciálami, kterou horní lišta kreslí
  (MenuUctu): 25. 9. 2026 tam odhlášení na chvíli bylo, „jen přes
  dotaz". Šéfík ale 7. 9. napsal „Do horní lišty ne" a 8. 9., že
  schované pod něčím je právě to, co mu vadí.
*/
ma('v horní liště odhlášení NENÍ', /odhl[aá]s/i.test(zdrojRam), false)
ma('ani v nabídce pod iniciálami', /odhl[aá]s/i.test(zdrojMenuUctu), false)

/*
  A NEOBEJDE SE TO JINUDY.

  Hledat cestu importu (`prihlaseni/akce`) nestačí: nezávislá kontrola
  25. 9. nechala Odhlaseni akci znovu vyvézt (`export { odhlasit }`)
  a nabídka pod iniciálami ji pak zavolala jedním klikem — oba testy
  zůstaly zelené. Hlídá se proto IDENTIFIKÁTOR `odhlasit`: v kódu
  aplikace (bez komentářů a řetězců — `klic="odhlasit"` je jméno
  ikony) smí stát jen tam, kde akce vzniká, v Odhlaseni s dotazem
  a na Mých údajích. Jediná další povolená podoba je klíč ikony
  v sadě ikon (`odhlasit: (`).
*/
{
  const POVOLENE = new Set([
    'app/prihlaseni/akce.ts',
    'components/shell/Odhlaseni.tsx',
    'app/moje-udaje/page.tsx',
  ])
  const nalezy = []
  for (const soubor of zdrojakyAplikace(['app', 'components', 'lib'])) {
    const kod = bezRetezcu(nacti(soubor))
    for (const m of kod.matchAll(/\bodhlasit\b/g)) {
      if (POVOLENE.has(soubor)) continue
      const klicIkony =
        soubor === 'app/[rozsah]/ikona.tsx' && /^odhlasit\s*:\s*\(/.test(kod.slice(m.index))
      if (!klicIkony) nalezy.push(soubor)
    }
  }
  // Že hledání vůbec něco najde: v povolených souborech akce je.
  ma('identifikátor akce se najde, kde má být (Odhlaseni, Moje údaje)',
    /\bodhlasit\b/.test(bezRetezcu(zdrojOdhlaseni)) && /\bodhlasit\b/.test(bezRetezcu(zdrojMojeUdaje)), true)
  ma(`akci odhlášení jinde nikdo nevolá ani nepřeposílá${nalezy.length ? ' — ' + [...new Set(nalezy)].join(', ') : ''}`,
    nalezy.length, 0)
}

/*
  Na kiosku taky ne: tam se odhlašuje samo po nečinnosti (krok E).
  Sdílený tablet a osobní telefon jsou dvě různé věci.
*/
const zdrojKiosek = nacti('app/kiosek/kiosek.tsx')
ma('na kiosku odhlášení NENÍ', /Odhlásit se/.test(zdrojKiosek), false)


/* --- 8. Odmítnutí si pamatuje, kam člověk šel ------------------------ */

console.log('\n== 8. Návrat na místo, odkud člověk šel ==================')

/*
  Prosté přesměrování na přihlášení původní adresu ZAHODÍ. Kdo si
  otevřel odkaz na konkrétní rozhovor a nebyl přihlášený, skončil po
  přihlášení na rozcestníku a musel ho hledat znovu — u člověka,
  kterému někdo poslal odkaz na vzkaz vedení, je to rozdíl mezi
  „přečetl si to" a „vzdal to".

  Cesta se proto zabaluje do adresy UŽ VE CHVÍLI ODMÍTNUTÍ: na
  přihlašovací obrazovce je hlavička `x-foodtab-adresa` rovna
  `/prihlaseni`, protože přesměrování je nový požadavek.
*/
const zdrojLayout = nacti('app/[rozsah]/layout.tsx')
const zdrojAdresa = nacti('lib/prihlaseni-adresa.ts')
const zdrojStranka = nacti('app/prihlaseni/page.tsx')

/*
  HLEDÁ SE ADRESA, NE TVAR VOLÁNÍ.

  Napoprvé tu byl vzorec `/redirect\(\s*["']\/prihlaseni/` a schválné
  rozbití ho NESHODILO: původní podoba v rámu byla
  `redirect(zQr ? "/prihlaseni?qr=1" : "/prihlaseni")`, tedy s ternárním
  operátorem hned za závorkou. Vzorec počítal jen s adresou nalepenou
  na `redirect(` a tuhle — jedinou, která tam doopravdy byla — minul.

  Proto se teď hledá prostě to, že se v souboru vyskytne napsaná adresa
  přihlášení. Cesta tam patřit nemá vůbec; od skládání je helper.
*/
const napsanaAdresa = /["']\/prihlaseni/

ma('rám nemá napsanou adresu přihlášení',
  napsanaAdresa.test(zdrojLayout), false)
ma('a skládá ji helperem', zdrojLayout.includes('odkazNaPrihlaseni'), true)
ma('Moje údaje ji taky nemají napsanou',
  napsanaAdresa.test(nacti('app/moje-udaje/page.tsx')), false)
ma('adresa se skládá přes bezpecnyCil, ne syrová',
  zdrojAdresa.includes('bezpecnyCil'), true)

/*
  A u přihlašovací obrazovky se hledá POUŽITÍ, ne existence proměnné.

  I tohle napoprvé nespadlo: kontrola se ptala, jestli se v souboru
  vyskytuje `kamZAdresy` — a to platilo dál, protože zůstala řádka,
  kde se rozbaluje ze `searchParams`. Měřila deklaraci, ne to, že se
  hodnota opravdu použije.
*/
const radekKam = zdrojStranka
  .split('\n')
  .find((r) => r.includes('const kam =' ) || r.includes('const kam ='))
const vypocetKam = zdrojStranka.slice(
  zdrojStranka.indexOf('const kam ='),
  zdrojStranka.indexOf('const kam =') + 200,
)

ma('řádka, která počítá kam, existuje', radekKam !== undefined, true)
ma('a bere hodnotu z adresy', vypocetKam.includes('kamZAdresy'), true)
ma('a prožene ji bezpecnyCil', vypocetKam.includes('bezpecnyCil'), true)

// Že ty vzorce vůbec něco poznají — jinak by kontroly výš prošly nad
// čímkoli.
ma('vzorec napsané adresy se trefí i v ternárním operátoru',
  napsanaAdresa.test('redirect(zQr ? "/prihlaseni?qr=1" : "/prihlaseni")'), true)
ma('a trefí se i v jednoduchých uvozovkách',
  napsanaAdresa.test("redirect('/prihlaseni')"), true)
ma('a nechytá se na to správné',
  napsanaAdresa.test('redirect(await odkazNaPrihlaseni())'), false)


console.log('\n== 9. První přihlášení z pozvánky (nový člověk) ==========')

/*
  Od 6. 9. přihlašovací stránka účty nezakládá — a stránka pozvánky
  posílala nepřihlášené právě tam. Nově pozvaný (Juli Yaniv, 24. 9.) se
  neměl kudy dostat dovnitř. Teď se poprvé přihlásí přímo na pozvánce
  a účet mu založí server — JEN pro adresu z pozvánky v databázi.
*/
ma('platná e-mailová pozvánka → adresa (malými, bez mezer)',
  adresaProPrvniKod({ stav: 'ok', kanal: 'email', kontakt: '  Juli@Example.CZ ' }), 'juli@example.cz')
ma('použitá pozvánka → nic',
  adresaProPrvniKod({ stav: 'pouzita', kanal: 'email', kontakt: 'juli@example.cz' }), null)
ma('propadlá pozvánka → nic',
  adresaProPrvniKod({ stav: 'propadla', kanal: 'email', kontakt: 'juli@example.cz' }), null)
// Kontakt ve tvaru e-mailu — jinak by „nic" vrátil už regex na zavináč
// a filtr kanálu by nešel rozbít. V databázi je kanál 'email' nebo 'sms'.
ma('pozvánka na telefon → nic (kód jde jen e-mailem)',
  adresaProPrvniKod({ stav: 'ok', kanal: 'sms', kontakt: 'juli@example.cz' }), null)
ma('zrušená pozvánka → nic',
  adresaProPrvniKod({ stav: 'zrusena', kanal: 'email', kontakt: 'juli@example.cz' }), null)
ma('pozvánka bez stavu → nic',
  adresaProPrvniKod({ kanal: 'email', kontakt: 'juli@example.cz' }), null)
ma('nesmyslný kontakt → nic',
  adresaProPrvniKod({ stav: 'ok', kanal: 'email', kontakt: 'bez zavináče' }), null)
ma('žádná pozvánka → nic', adresaProPrvniKod(undefined), null)

ma('účet už je: kód email_exists', ucetUzExistuje({ code: 'email_exists' }), true)
ma('účet už je: kód user_already_exists', ucetUzExistuje({ code: 'user_already_exists' }), true)
ma('účet už je: jen text (starší Supabase)',
  ucetUzExistuje({ message: 'A user with this email address has already been registered' }), true)
ma('jiná chyba NENÍ „účet už je"',
  ucetUzExistuje({ code: 'unexpected_failure', message: 'Database error' }), false)
ma('žádná chyba NENÍ „účet už je"', ucetUzExistuje(null), false)

const STUB_POZVANKA =
  'data:text/javascript,' +
  encodeURIComponent(
    'export async function poslatPrvniKod() { return { ok: true, odeslanoKdy: 1 } }\n' +
      'export async function overitPrvniKod() { return { ok: true } }\n',
  )
const PrvniPrihlaseni = await nactiKomponentu(
  'app/pozvanka/[token]/prvni-prihlaseni.tsx',
  [['./akce', STUB_POZVANKA]],
)
const prvni = renderToStaticMarkup(
  createElement(PrvniPrihlaseni, { token: 't', adresaZkracena: 'j…i@example.cz' }),
)
ma('první obrazovka nabízí „Poslat kód"', prvni.includes('Poslat kód'), true)
ma('a říká, kam kód půjde (zkrácená adresa)', prvni.includes('j…i@example.cz'), true)
ma('adresu člověk NEZADÁVÁ — na první obrazovce žádné pole',
  (prvni.match(/<input(?![^>]*type="hidden")/g) ?? []).length, 0)

// Druhý krok (pole na kód) — stejná pravidla jako na přihlašovací
// stránce po 6. 9. (commit 344094b).
const druhy = renderToStaticMarkup(
  createElement(PrvniPrihlaseni, { token: 't', adresaZkracena: 'j…i@example.cz', vychoziKrok: 'kod' }),
)
const vstupy = druhy.match(/<input(?![^>]*type="hidden")[^>]*>/g) ?? []
ma('druhý krok: právě jedno pole', vstupy.length, 1)
ma('… a je to pole na kód', /id="kod-z-pozvanky"/.test(vstupy[0] ?? ''), true)
ma('… s one-time-code a číselnou klávesnicí',
  /autoComplete="one-time-code"/i.test(vstupy[0] ?? '') && /inputMode="numeric"/i.test(vstupy[0] ?? ''), true)
ma('… textové, ne type="number"', /type="text"/.test(vstupy[0] ?? ''), true)
ma('… a popisek k němu patří', druhy.includes('for="kod-z-pozvanky"'), true)
ma('… a jde se k němu dostat „Poslat kód znovu"', druhy.includes('Poslat kód znovu'), true)

const zdrojPrvniBezKom = bezKomentaru(nacti('app/pozvanka/[token]/prvni-prihlaseni.tsx'))
ma('komponenta s polem na kód NETIKÁ (odpočet je jinde)',
  /setInterval|useSyncExternalStore\(odebiratTik/.test(zdrojPrvniBezKom), false)
ma('pole na kód je NEŘÍZENÉ (bez value/onChange)',
  /<input[\s\S]*?(onChange|value=)[\s\S]*?\/>/.test(zdrojPrvniBezKom), false)
ma('komponenta s odpočtem nemá žádné pole',
  /<input/.test(bezKomentaru(nacti('app/pozvanka/[token]/poslat-znovu.tsx'))), false)

const zdrojPozvanky = nacti('app/pozvanka/[token]/page.tsx')
const zdrojAkciPozvanky = nacti('app/pozvanka/[token]/akce.ts')
ma('stránka pozvánky nepřihlášeného NEpřesměruje na přihlášení',
  /redirect\(/.test(zdrojPozvanky), false)
ma('a nabídne mu první přihlášení', zdrojPozvanky.includes('<PrvniPrihlaseni'), true)
ma('poslatPrvniKod bere jen token — adresa z prohlížeče do něj nejde',
  /export async function poslatPrvniKod\(token: string\)/.test(zdrojAkciPozvanky), true)
ma('a novému člověku řekne, kudy jít poprvé',
  uvod.includes('Jste tu poprvé'), true)

/*
  SERVEROVÉ AKCE NAOSTRO — s podstrčenou databází a přihlašovací
  službou. Regex nad zdrojákem by prošel i tehdy, kdyby se createUser
  zavolal DŘÍV než kontrola pozvánky; tohle kód opravdu spustí a zapíše,
  co a s čím zavolal.
*/
const STUB_SERVER = 'data:text/javascript,' + encodeURIComponent(
  'export async function getServerSupabase() { return globalThis.__pozvankaSupabase }\n')
const STUB_ULOHA = 'data:text/javascript,' + encodeURIComponent(
  'export function klientUlohy() { return globalThis.__pozvankaSluzba }\n')
const STUB_AUTHZ = 'data:text/javascript,' + encodeURIComponent(
  'export async function getUser() { return null }\n')
const STUB_OHLAS = 'data:text/javascript,' + encodeURIComponent(
  'export async function ohlasPrijetiPozvanky(id) { globalThis.__pozvankaVolani.push(["ohlas", id]) }\n')
const akcePozvanky = await nactiModul('app/pozvanka/[token]/akce.ts', [
  ['@/lib/supabase/server', STUB_SERVER],
  ['@/lib/supabase/uloha', STUB_ULOHA],
  ['@/lib/authz', STUB_AUTHZ],
  ['@/lib/ohlas-prijeti', STUB_OHLAS],
])

/** Nastaví podstrčenou databázi a vrátí seznam volání. */
function podstrcit({ pozvanka, chybaUctu = null, chybaKodu = null, chybaOvereni = null, chybaPrijeti = null }) {
  const volani = []
  globalThis.__pozvankaVolani = volani
  globalThis.__pozvankaSupabase = {
    rpc: async (jmeno, args) => {
      volani.push(['rpc', jmeno, args])
      if (jmeno === 'pozvanka_info') return { data: pozvanka ? [pozvanka] : [], error: null }
      if (jmeno === 'accept_invitation') return chybaPrijeti ? { data: null, error: chybaPrijeti } : { data: 'firma-1', error: null }
      return { data: null, error: { message: 'neznámá funkce' } }
    },
    auth: {
      signInWithOtp: async (args) => { volani.push(['signInWithOtp', args]); return { error: chybaKodu } },
      verifyOtp: async (args) => { volani.push(['verifyOtp', args]); return { error: chybaOvereni } },
      signOut: async (args) => { volani.push(['signOut', args]); return { error: null } },
    },
  }
  globalThis.__pozvankaSluzba = {
    auth: { admin: { createUser: async (args) => { volani.push(['createUser', args]); return { error: chybaUctu } } } },
  }
  return volani
}
const jen = (volani, co) => volani.filter((v) => v[0] === co)
const PLATNA = { stav: 'ok', kanal: 'email', kontakt: 'juli@example.cz', firma: 'Černá Perla' }

let v = podstrcit({ pozvanka: PLATNA })
let odpoved = await akcePozvanky.poslatPrvniKod('token-1')
ma('akce: platná pozvánka → účet pro adresu Z DATABÁZE, potvrzený',
  JSON.stringify(jen(v, 'createUser').map((x) => x[1])), JSON.stringify([{ email: 'juli@example.cz', email_confirm: true }]))
ma('akce: … a kód na tutéž adresu, bez zakládání dalšího účtu',
  JSON.stringify(jen(v, 'signInWithOtp').map((x) => [x[1].email, x[1].options?.shouldCreateUser])),
  JSON.stringify([['juli@example.cz', false]]))
ma('akce: … a odpoví „poslano"', odpoved.ok === true && typeof odpoved.odeslanoKdy === 'number', true)

for (const [popis, pozvanka] of [
  ['použitá', { ...PLATNA, stav: 'pouzita' }],
  ['propadlá', { ...PLATNA, stav: 'propadla' }],
  ['zrušená', { ...PLATNA, stav: 'zrusena' }],
  ['na telefon', { ...PLATNA, kanal: 'sms' }],
  ['neexistující token', null],
]) {
  v = podstrcit({ pozvanka })
  odpoved = await akcePozvanky.poslatPrvniKod('token-x')
  ma(`akce: ${popis} pozvánka → žádný účet ani kód`,
    jen(v, 'createUser').length + jen(v, 'signInWithOtp').length, 0)
}
ma('akce: … a hláška, že pozvánka neplatí', /neplatí/.test(odpoved.chyba ?? ''), true)

v = podstrcit({ pozvanka: PLATNA, chybaUctu: { code: 'unexpected_failure', message: 'Database error' } })
odpoved = await akcePozvanky.poslatPrvniKod('token-1')
ma('akce: účet nejde založit → kód se neposílá', jen(v, 'signInWithOtp').length, 0)

v = podstrcit({ pozvanka: PLATNA, chybaUctu: { code: 'email_exists' } })
odpoved = await akcePozvanky.poslatPrvniKod('token-1')
ma('akce: účet už je → kód se pošle', jen(v, 'signInWithOtp').length === 1 && odpoved.ok === true, true)

v = podstrcit({ pozvanka: PLATNA, chybaKodu: { status: 429, code: 'over_email_send_rate_limit' } })
odpoved = await akcePozvanky.poslatPrvniKod('token-1')
ma('akce: limit odesílání → obrazovka přejde na opsání kódu', odpoved.zadatKod === true && !odpoved.ok, true)

v = podstrcit({ pozvanka: PLATNA })
odpoved = await akcePozvanky.overitPrvniKod('token-1', ' 123 456 ')
ma('akce: ověření kódu pro adresu Z DATABÁZE (ne z prohlížeče)',
  JSON.stringify(jen(v, 'verifyOtp').map((x) => x[1])),
  JSON.stringify([{ email: 'juli@example.cz', token: '123456', type: 'email' }]))
ma('akce: … pak se přijme TATÁŽ pozvánka',
  JSON.stringify(jen(v, 'rpc').filter((x) => x[1] === 'accept_invitation').map((x) => x[2])),
  JSON.stringify([{ p_token: 'token-1' }]))
ma('akce: … a odpoví ok', odpoved.ok, true)

v = podstrcit({ pozvanka: { ...PLATNA, stav: 'pouzita' } })
odpoved = await akcePozvanky.overitPrvniKod('token-1', '123456')
ma('akce: použitá pozvánka → kód se ani neověřuje', jen(v, 'verifyOtp').length, 0)

v = podstrcit({ pozvanka: PLATNA, chybaOvereni: { status: 403, code: 'otp_expired' } })
odpoved = await akcePozvanky.overitPrvniKod('token-1', '123456')
ma('akce: špatný kód → pozvánka se NEpřijímá',
  jen(v, 'rpc').filter((x) => x[1] === 'accept_invitation').length, 0)

v = podstrcit({ pozvanka: PLATNA, chybaPrijeti: { message: 'Pozvánka byla vystavena na jinou e-mailovou adresu.' } })
odpoved = await akcePozvanky.overitPrvniKod('token-1', '123456')
ma('akce: přihlášen, ale přijetí neprošlo → hláška z databáze se propustí',
  odpoved.prihlasen === true && /jinou e-mailovou/.test(odpoved.chyba ?? ''), true)

v = podstrcit({ pozvanka: PLATNA })
await akcePozvanky.prihlasitSeAdresouZPozvanky('token-1')
ma('akce: přepnutí účtu odhlásí jen tenhle prohlížeč',
  JSON.stringify(jen(v, 'signOut').map((x) => x[1])), JSON.stringify([{ scope: 'local' }]))

/*
  Telefon: odkaz z pozvánky se otevře v kartě uvnitř Gmailu, člověk ji
  zavře, aby si přečetl kód, a ťukne na odkaz znovu — je zase na začátku.
  K opsání kódu se musí dát dostat BEZ nového odeslání (nový kód by ten
  v e-mailu zneplatnil) a limit odesílání nesmí skončit slepou uličkou.
*/
ma('první obrazovka nabízí i „Už mám kód z e-mailu"', prvni.includes('Už mám kód z e-mailu'), true)
ma('limit odesílání vede na opsání kódu (server)',
  /jeStrop\(chybaKodu\)\) return \{ zadatKod: true/.test(zdrojAkciPozvanky), true)
const zdrojPrvni = nacti('app/pozvanka/[token]/prvni-prihlaseni.tsx')
ma('limit odesílání vede na opsání kódu (obrazovka)',
  /if \(v\.zadatKod\) setKrok\('kod'\)/.test(zdrojPrvni), true)
ma('neodeslaný kód se zapíše do logu (kód chyby, ne adresa)',
  /console\.error\('Pozvánka: kód se nepodařilo poslat:', chybaKodu\.code/.test(zdrojAkciPozvanky), true)
ma('nepotvrzený existující účet se NEdopotvrzuje',
  /updateUserById/.test(zdrojAkciPozvanky), false)
ma('přihlášený na použité pozvánce dostane „Do aplikace", ne „Přihlásit se"',
  zdrojPozvanky.includes("prihlaseny ? 'Do aplikace' : 'Přihlásit se'"), true)


console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
