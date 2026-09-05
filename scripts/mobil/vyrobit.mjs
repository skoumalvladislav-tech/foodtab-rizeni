#!/usr/bin/env node
/**
 * Vyrobí měřicí stránku pro hlavičku na telefonu.
 *
 * Pusť `node --experimental-strip-types scripts/mobil/vyrobit.mjs`,
 * pak stránku otevři v prohlížeči a zúž okno na 430 a 375 px. Měření
 * se spustí samo a napíše PROŠLO/SPADLO.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ OBYČEJNÁ KONTROLA V NODE
 *
 * Zadání chce `getBoundingClientRect().right <= window.innerWidth`.
 * To umí jenom prohlížeč — v repozitáři není playwright ani puppeteer
 * a přidávat kvůli tomu závislost jsem si nedovolil. Kontrola tedy
 * bydlí ve stránce, ne v nodu; tenhle skript ji jen vyrobí ze
 * SKUTEČNÉ komponenty a SKUTEČNÉHO sestaveného CSS.
 *
 * Kdyby se sem markup opsal ručně, měřila by se kopie.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nactiKomponentu } from '../vykreslit.mjs'

const KOREN = new URL('../..', import.meta.url)
const VEN = new URL('./', import.meta.url)

/* --- podstrčené moduly ------------------------------------------------ */

const dat = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

const NAVIGACE = dat(
  'export function usePathname() { return "/cerna-perla/dochazka" }\n' +
    'export function useRouter() { return { push() {}, refresh() {} } }\n' +
    'export function useSearchParams() { return new URLSearchParams() }\n',
)

const ODKAZ = dat(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) {\n' +
    '  return createElement("a", { href, ...z }, children)\n' +
    '}\n',
)

const Ram = await nactiKomponentu('app/[rozsah]/ram.tsx', [
  ['next/navigation', NAVIGACE],
  ['next/link', ODKAZ],
])

/* --- data, jaká byla na fotce ---------------------------------------- */

const polozka = (segment, nazev, kratky, ikona) => ({
  segment,
  nazev,
  kratky,
  ikona,
  hotovo: true,
  modul: 'provoz',
})

const html = renderToStaticMarkup(
  createElement(
    Ram,
    {
      rozsah: 'bernard-bar',
      barva: 'rose',
      druh: 'Pobočka',
      // Nejdelší název, který ve firmě je — na něm se to 4. 9. zlomilo.
      nazevRozsahu: 'Bernard Bar Tábor',
      rozsahy: [
        { slug: 'cerna-perla', nazev: 'Restaurace Černá Perla', barva: 'rose' },
        { slug: 'bernard-bar', nazev: 'Bernard Bar Tábor', barva: 'rose' },
      ],
      aktivniRozsah: 'bernard-bar',
      segmentFirmy: 'firma',
      nazevFirmy: 'Foodtab s.r.o.',
      iniciraly: 'FS',
      // Dvojciferné číslo je širší než jednociferné.
      neprectenych: 12,
      moduly: [
        { klic: 'provoz', nazev: 'Provoz', aktivni: true },
        { klic: 'menu', nazev: 'Tvorba menu', aktivni: true },
        { klic: 'finance', nazev: 'Finance', aktivni: false },
        { klic: 'marketing', nazev: 'Marketing', aktivni: false },
      ],
      polozky: [
        polozka('smeny', 'Rozpis směn', 'Směny', 'kalendar'),
        polozka('dochazka', 'Docházka', 'Docházka', 'hodiny'),
        polozka('ukoly', 'Úkoly a checklisty', 'Úkoly', 'fajfka'),
        polozka('zpravy', 'Nástěnka', 'Zprávy', 'zprava'),
        polozka('zalohy', 'Zálohy', 'Zálohy', 'kniha'),
      ],
      nastaveni: [polozka('nastaveni/firma', 'Firma', 'Firma', 'kolo')],
      cilNastaveni: '/bernard-bar/nastaveni/firma',
    },
    /*
      Do rámu se vloží to, co se 4. 9. rozjelo do strany: dlouhý
      e-mail v mřížce „Co o vás aplikace vede“.

      Markup je opsaný (dt/dd v `.ft-udaje`), protože `moje-udaje/
      page.tsx` je serverová komponenta s dotazy do databáze a mimo
      Next se vykreslit nedá. OPRAVA ALE BYDLÍ V CSS — `.ft-udaje`
      a `overflow-wrap` — a to CSS je tady skutečné, sestavené. Měří
      se tedy to pravidlo, ne moje představa o něm.
    */
    createElement(
      'div',
      { style: { padding: '16px' } },
      createElement(
        'dl',
        { className: 'ft-udaje', style: { display: 'grid',
          gridTemplateColumns: 'minmax(0, 12em) minmax(0, 1fr)',
          gap: '6px 16px', margin: 0, fontSize: '14px' } },
        createElement('dt', { style: { color: 'var(--muted)', margin: 0 } },
          'Přihlašovací e-mail'),
        createElement('dd', { style: { color: 'var(--ink)', margin: 0,
          overflowWrap: 'anywhere' } },
          'vladislavskoumalnejdelsiadresajakaexistuje@velmidlouhadomena.example.com'),
      ),
    ),
  ),
)

/* --- sestavené CSS --------------------------------------------------- */

const chunky = path.join(new URL(KOREN).pathname.replace(/^\//, ''), '.next/static/chunks')
const cssSoubor = fs
  .readdirSync(chunky)
  .filter((f) => f.endsWith('.css'))
  .map((f) => path.join(chunky, f))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]

if (!cssSoubor) {
  console.error('Nenašel jsem sestavené CSS. Pusť napřed `npx next build`.')
  process.exit(1)
}

fs.copyFileSync(cssSoubor, new URL('./sestavene.css', VEN))

const MERENI = `
  /*
    Měří se to, co uvidí člověk: hotové rozměry prvků v hlavičce proti
    šířce okna. Ne třídy, ne pravidla — souřadnice.
  */
  const SIRKY = [430, 375]

  function zmer() {
    // NE innerWidth. Při přetečení se na telefonu roztáhne SÁM
    // a podmínka by nespustila nikdy — změřeno. clientWidth drží.
    const okno = document.documentElement.clientWidth
    const hlavicka = document.querySelector('.ft-topbar')

    /*
      Zavřené rozbalovátko se nepočítá. Panel přepínače pobočky je
      schovaný mimo obrazovku a hlásil by přetečení pokaždé — a přitom
      ho nikdo nevidí.
    */
    const vidno = (e) => {
      if (e.closest('details:not([open]) .ft-rozsah-panel')) return false
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }

    const pretekaji = [...hlavicka.querySelectorAll('*')]
      .filter(vidno)
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.right > okno + 0.5 || r.left < -0.5)
      .map(({ e, r }) => ({
        co: e.className || e.tagName.toLowerCase(),
        text: (e.textContent || '').trim().slice(0, 20),
        vpravo: Math.round(r.right),
      }))

    const doStrany = document.documentElement.scrollWidth > okno + 0.5

    // Název pobočky nesmí být zkrácený na jedno písmeno.
    const nazev = document.querySelector('.ft-rozsah > summary > span:nth-child(2)')
    const sirkaNazvu = nazev ? Math.round(nazev.getBoundingClientRect().width) : 0

    /*
      KOLIK OVLÁDACÍCH PRVKŮ V LIŠTĚ STOJÍ.

      Tohle je ta kontrola, která doopravdy hlídá. Měření přetečení
      samo NESTAČÍ: zkusil jsem přidat šestou ikonu a nic nepřeteklo —
      jen se zúžil název pobočky ze 106 na 97 px. Přesně tak to
      4. 9. začalo, než se na 430 px useklo ozubené kolo.

      Na telefonu mají v liště stát DVA prvky: přepínač pobočky
      a zvoneček. Když jich přibude, je to rozhodnutí, ne náhoda —
      a má se o něm vědět.
    */
    const ovladaci = [...hlavicka.querySelector('.ft-tools').children]
      .filter(vidno)
      .map((e) => e.className || e.tagName.toLowerCase())

    return { okno, pretekaji, doStrany, sirkaNazvu, ovladaci }
  }

  window.zmerHlavicku = zmer

  function vypis() {
    const v = zmer()
    const potize = []
    if (v.pretekaji.length) {
      potize.push('z okna vytéká ' + v.pretekaji.length + ' prvků: ' +
        v.pretekaji.map((p) => p.co + (p.text ? ' („' + p.text + '“)' : '') +
          ' vpravo ' + p.vpravo).join(', '))
    }
    if (v.doStrany) potize.push('stránka jde posunout do strany')

    // Pod ~60 px se z názvu pobočky stane zkratka, kterou nikdo
    // nepřečte. Jedno písmeno místo „Bernard Bar“ je horší než nic.
    if (v.sirkaNazvu > 0 && v.sirkaNazvu < 60) {
      potize.push('název pobočky je zúžený na ' + v.sirkaNazvu + ' px')
    }

    if (v.okno <= 640 && v.ovladaci.length !== 2) {
      potize.push('v liště je ' + v.ovladaci.length +
        ' ovládacích prvků místo dvou: ' + v.ovladaci.join(', '))
    }

    document.getElementById('vysledek').innerHTML =
      '<b>Šířka okna ' + v.okno + ' px</b> — ' +
      (potize.length
        ? '<span style="color:#b00">SPADLO</span><br>' + potize.join('<br>')
        : '<span style="color:#070">PROŠLO</span>') +
      '<br><small>Zúžit okno na ' + SIRKY.join(' a ') + ' px.</small>'
  }

  addEventListener('resize', vypis)
  vypis()
`

fs.writeFileSync(
  new URL('./hlavicka.html', VEN),
  `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Měření hlavičky na telefonu</title>
<link rel="stylesheet" href="sestavene.css">
<div id="vysledek" style="position:fixed;bottom:0;left:0;right:0;z-index:99;
  background:#fff;color:#111;border-top:2px solid #111;padding:8px 10px;
  font:13px/1.4 system-ui"></div>
${html}
<script>${MERENI}</script>
`,
)

console.log('Vyrobeno: scripts/mobil/hlavicka.html (CSS z ' + path.basename(cssSoubor) + ')')
