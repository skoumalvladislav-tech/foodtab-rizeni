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
  bezpecnyCil,
  hlaskaProChybu,
  HLASKA_SPATNY_KOD,
  HLASKA_STROP,
  jeStrop,
  maUkazatNaPlochu,
  zbyvaDoZnovu,
} from '../lib/prihlaseni.ts'
import { nactiKomponentu } from './vykreslit.mjs'

const KOREN = new URL('..', import.meta.url)

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
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
ma('prázdno vede na rozcestník', bezpecnyCil(''), '/')
ma('nic vede na rozcestník', bezpecnyCil(null), '/')

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
const zdrojRam = nacti('app/[rozsah]/ram.tsx')

ma('odhlášení je na Moje údaje', zdrojMojeUdaje.includes('Odhlásit se'), true)
ma('a volá serverovou akci', zdrojMojeUdaje.includes('odhlasit'), true)

/*
  V HORNÍ LIŠTĚ NE. Omylem ťuknutý odhlas uprostřed směny je horší než
  o jedno ťuknutí delší cesta — číšník by se pak přihlašoval kódem
  z e-mailu s rukama plnýma talířů.
*/
ma('v horní liště odhlášení NENÍ', /odhl[aá]s/i.test(zdrojRam), false)

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


console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
