#!/usr/bin/env node
/**
 * Rezervace a akce — pobočky v kalendáři (Šéfík 27. 10. 2026): rámeček
 * a barva každé pobočky, souhrn za zobrazené období, zkratka u každé
 * rezervace v měsíci.
 *
 * Pusť `node scripts/rezervace-pobocky.test.mjs`.
 *
 *   1. zkratka: z názvu i s diakritikou, nikde natvrdo, ze všech poboček;
 *   2. barva: obě pobočky Růžové → dvě různé, barva z nastavení se
 *      použije, jen když se nepoplete;
 *   3. paleta kalendáře ZMĚŘENÁ z app/_tokeny.css (ΔE2000 a kontrast,
 *      týmž vzorcem jako scripts/barvy.js) — bezpečné klíče jsou přesně
 *      ty v BARVY_KALENDARE;
 *   4. souhrn pobočky: jen dny období (ne sousední měsíc z mřížky), bez
 *      zrušených, akce zvlášť, pobočka bez rezervací má nuly;
 *   5. VYKRESLENÝ kalendář (scripts/vykreslit.mjs, skutečné obsah.tsx
 *      a prvky.tsx): legenda, rámečky po pobočkách v týdnu i dni, štítek
 *      zkratky u každé rezervace v měsíci, jedna barva na pobočku všude;
 *   6. dokumenty u rezervací (3. 11. 2026), taky VYKRESLENÉ: v týdnu
 *      a dni štítky za odkazem na rezervaci (ne v něm), kam vedou a jak
 *      se otevřou, „Zpět“ z náhledu Wordu; v měsíci jen sponka.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { lab, MEZ_DE, ctiToken, de, pomer, samokontrola, vyrez } from './barvy.js'
import {
  BARVY_KALENDARE,
  NEROZLISITELNE,
  barvyPobocek,
  obdobiPohledu,
  poPobockach,
  rozlisitelne,
  souhrnText,
  souhrnyPobocek,
  vzhledPobocek,
} from '../lib/rezervace-pobocky.ts'
import { mistoKratce, prostorZeZdroje } from '../lib/rezervace-misto.ts'
import { zpatkyZKalendare } from '../lib/rezervace-typy.ts'
import { adresaModulu, nactiModul } from './vykreslit.mjs'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8')
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Zdroj bez komentářů (blokových, JSX i řádkových). */
const bezKomentaru = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const BERNARD = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Bernard Bar Tábor', color: 'rose' }
const PERLA = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Restaurace Černá Perla', color: 'rose' }

console.log('\n== 1. Zkratka pobočky ==\n')
{
  const v = vzhledPobocek([BERNARD, PERLA])
  ok('Bernard Bar Tábor → BBT', v.get(BERNARD.id)?.zkratka === 'BBT')
  ok('Restaurace Černá Perla → RČP (diakritika zůstane)', v.get(PERLA.id)?.zkratka === 'RČP')

  const dalsi = vzhledPobocek([
    { id: '1', name: 'Bistro žabka' },
    { id: '2', name: 'Restaurace Černá Pivnice' },
    { id: '3', name: 'Restaurace Černá Perla' },
  ])
  ok('nová pobočka jiného zákazníka: „Bistro žabka“ → BŽ (velké i s háčkem)', dalsi.get('1')?.zkratka === 'BŽ')
  const [p2, p3] = [dalsi.get('2')?.zkratka, dalsi.get('3')?.zkratka]
  ok(`dvě pobočky se stejnými iniciálami se rozliší prodloužením (${p2} / ${p3})`, p2 !== p3 && p2?.startsWith('Re') && p3?.startsWith('Re'))

  const pristup = bezKomentaru(cti('app/[rozsah]/rezervace/pristup.ts'))
  ok(
    'zkratka a barva se počítají ze VŠECH poboček kontextu, ne z rozsahu (firemní i pobočkový kalendář říkají totéž)',
    /vzhledPobocek\(ctx\.branches\)/.test(pristup) && !/vzhledPobocek\(kandidati\)/.test(pristup),
  )

  const kod = [
    'lib/rezervace-pobocky.ts',
    ...fs
      .readdirSync(path.join(KOREN, 'app/[rozsah]/rezervace'), { recursive: true })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => path.join('app/[rozsah]/rezervace', f)),
  ]
  const natvrdo = kod.filter((f) => /['"`](BBT|RČP)['"`]/.test(bezKomentaru(cti(f))))
  ok('zkratky nejsou nikde v kódu Rezervací natvrdo', natvrdo.length === 0)
  if (natvrdo.length) console.log('        natvrdo v:', natvrdo.join(', '))
}

console.log('\n== 2. Barva pobočky v kalendáři ==\n')
{
  const obe = barvyPobocek([BERNARD, PERLA])
  ok(
    `obě pobočky Růžové (jak je mají dnes) → dvě různé rozlišitelné (${obe.get(BERNARD.id)}, ${obe.get(PERLA.id)})`,
    rozlisitelne(obe.get(BERNARD.id), obe.get(PERLA.id)),
  )
  ok('růžová se v kalendáři nepoužije (plete se se Zrušenou a s Akcí)', ![...obe.values()].includes('rose'))

  const vlastni = barvyPobocek([
    { id: 'a', color: 'violet' },
    { id: 'b', color: 'sky' },
  ])
  ok('barva z Nastavení → Pobočky se použije, když se hodí', vlastni.get('a') === 'violet' && vlastni.get('b') === 'sky')

  const nesebrat = barvyPobocek([
    { id: 'a', color: 'rose' },
    { id: 'b', color: 'sky' },
  ])
  ok('pobočka s nevhodnou barvou nesebere vhodnou barvu té, která je v pořadí za ní', nesebrat.get('b') === 'sky' && nesebrat.get('a') !== 'sky')

  const stejne = barvyPobocek([
    { id: 'a', color: 'violet' },
    { id: 'b', color: 'violet' },
  ])
  ok('dvě pobočky se stejnou barvou: první si ji nechá, druhá dostane jinou', stejne.get('a') === 'violet' && rozlisitelne('violet', stejne.get('b')))

  const blizke = barvyPobocek([
    { id: 'a', color: 'violet' },
    { id: 'b', color: 'indigo' },
  ])
  ok('fialová a indigová vedle sebe ne (oko je nerozezná) — druhá dostane jinou', blizke.get('a') === 'violet' && blizke.get('b') !== 'indigo' && rozlisitelne('violet', blizke.get('b')))

  const nezname = barvyPobocek([{ id: 'a', color: 'neonova' }, { id: 'b', color: null }, { id: 'c' }, { id: 'd', color: 'amber' }])
  ok('neznámá, prázdná i nevhodná barva → vždycky klíč z palety kalendáře', [...nezname.values()].every((b) => BARVY_KALENDARE.includes(b)) && nezname.size === 4)
  ok('první dvě pobočky jsou od sebe rozlišitelné i bez barev v nastavení', rozlisitelne(nezname.get('a'), nezname.get('b')))
}

console.log('\n== 3. Paleta kalendáře změřená z app/_tokeny.css ==\n')
{
  samokontrola()
  const css = fs.readFileSync(path.join(KOREN, 'app/_tokeny.css'), 'utf8')
  const bloky = {
    svetlo: vyrez(css, ':root {', '@media (prefers-color-scheme: dark)'),
    tma: vyrez(css, ':root[data-theme="dark"] {', '/* ---'),
    'tma (systémový)': vyrez(css, '@media (prefers-color-scheme: dark)', ':root[data-theme="dark"] {'),
  }
  const STAVY = ['dobre', 'pozor', 'bad', 'vino'] // Potvrzená, Předběžná, Zrušená a Nedorazili, Akce
  const MIN_SYTOST = 15
  const sytost = (hex) => {
    const [, a, b] = lab(hex)
    return Math.hypot(a, b)
  }
  // Klíče palety poboček z lib/authz.ts (odpovídá CHECK na branches.color).
  // Čte se text: authz.ts sahá na server a v Node by se nenačetl.
  const BRANCH_COLORS = [...(cti('lib/authz.ts').match(/BRANCH_COLORS = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1])
  ok(`paleta poboček z lib/authz.ts načtená (${BRANCH_COLORS.join(', ')})`, BRANCH_COLORS.length === 8 && BARVY_KALENDARE.every((k) => BRANCH_COLORS.includes(k)))
  /** Proč se klíč do kalendáře nehodí (v kterémkoli režimu), nebo '' když se hodí. */
  const vadaKlice = new Map(BRANCH_COLORS.map((k) => [k, '']))

  for (const [rezim, blok] of Object.entries(bloky)) {
    const mez = rezim === 'svetlo' ? MEZ_DE.svetlo : MEZ_DE.tma
    const t = (n) => ctiToken(blok, n)
    const vada = (k) => {
      const hex = t('b-' + k)
      if (!hex) return 'chybí --b-' + k
      if (sytost(hex) < MIN_SYTOST) return `šedá (sytost ${sytost(hex).toFixed(1)})`
      const blizky = STAVY.map((s) => [s, de(hex, t(s))]).find(([, d]) => d < mez)
      return blizky ? `ΔE ${blizky[1].toFixed(1)} od --${blizky[0]}` : ''
    }
    for (const k of BRANCH_COLORS) if (!vadaKlice.get(k) && vada(k)) vadaKlice.set(k, `${rezim}: ${vada(k)}`)

    const spatne = BARVY_KALENDARE.filter((k) => vada(k))
    ok(`${rezim}: barvy kalendáře nejsou šedé a od stavů jsou aspoň ΔE ${mez}`, spatne.length === 0)
    for (const k of spatne) console.log(`        ${k}: ${vada(k)}`)

    const dvojice = []
    for (let i = 0; i < BARVY_KALENDARE.length; i++)
      for (let j = i + 1; j < BARVY_KALENDARE.length; j++) dvojice.push([BARVY_KALENDARE[i], BARVY_KALENDARE[j]])
    const nesedi = dvojice.filter(([a, b]) => de(t('b-' + a), t('b-' + b)) >= mez !== rozlisitelne(a, b))
    ok(`${rezim}: NEROZLISITELNE sedí s měřením (ΔE pod ${mez} právě u ${NEROZLISITELNE.map((d) => d.join('/')).join(', ')})`, nesedi.length === 0)
    for (const [a, b] of nesedi) console.log(`        ${a}/${b}: ΔE ${de(t('b-' + a), t('b-' + b)).toFixed(1)}`)

    const kontrast = []
    for (const k of BARVY_KALENDARE) {
      const [br, fill, soft] = [t('b-' + k), t('b-' + k + '-fill'), t('b-' + k + '-soft')]
      const dvojiceKontrastu = [
        ['zkratka na štítku', t('branch-ink'), fill, 4.5],
        ['štítek proti kartě', fill, t('card'), 3.0],
        ['čísla souhrnu na kartě', br, t('card'), 4.5],
        ['hlavička rámečku na jeho podkladu', br, soft, 4.5],
      ]
      for (const [co, a, b, min] of dvojiceKontrastu) if (!a || !b || pomer(a, b) < min) kontrast.push(`${k}: ${co} ${a && b ? pomer(a, b).toFixed(2) : '?'} < ${min}`)
    }
    ok(`${rezim}: kontrast štítku, čísel a rámečku (4,5 text / 3,0 plocha)`, kontrast.length === 0)
    for (const k of kontrast) console.log('        ' + k)
  }

  // Seznam je PŘESNĚ množina bezpečných: vynechaná barva, která se se
  // stavy nepoplete, by tu chyběla zbytečně (a třetí pobočka by se pak
  // opakovala dřív, než musí).
  const vynechane = BRANCH_COLORS.filter((k) => !BARVY_KALENDARE.includes(k))
  const zbytecne = vynechane.filter((k) => !vadaKlice.get(k))
  ok(`každá vynechaná barva (${vynechane.join(', ')}) se se stavem opravdu plete nebo je šedá`, vynechane.length > 0 && zbytecne.length === 0)
  for (const k of vynechane) console.log(`        ${k.padEnd(8)} ${vadaKlice.get(k) || 'BEZPEČNÁ — patří do BARVY_KALENDARE'}`)

  const pravidla = BARVY_KALENDARE.filter((k) => !new RegExp(`\\[data-branch="${k}"\\]\\s*\\{[^}]*--branch:\\s*var\\(--b-${k}\\)`).test(css))
  ok('každá barva kalendáře má v _tokeny.css pravidlo [data-branch="…"] (jinak by štítek vyšel průhledný)', pravidla.length === 0)
}

console.log('\n== 4. Souhrn pobočky za období ==\n')

let n = 0
/** Rezervace v pásmu Praha (zimní čas). */
function rez(pobocka, den, od, o = {}) {
  n += 1
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`,
    branch_id: pobocka.id,
    den,
    druh: 'rezervace',
    stav: 'potvrzeno',
    nazev: '',
    jmeno_hosta: `Host ${n}`,
    zacatek: `${den}T${od}:00+01:00`,
    konec: null,
    pocet_osob: 2,
    prostor: '',
    typ_akce: '',
    zdroj: 'rucne',
    zona: 'Europe/Prague',
    dokumenty: [],
    ...o,
  }
}

const A = {
  a1: rez(BERNARD, '2026-10-30', '18:00', { jmeno_hosta: 'Jan Novák', pocet_osob: 4 }),
  a2: rez(BERNARD, '2026-10-30', '19:00', { jmeno_hosta: 'Eva Malá', stav: 'ceka' }),
  a3: rez(BERNARD, '2026-10-30', '19:30', { jmeno_hosta: 'Karel Zrušený', pocet_osob: 6, stav: 'zrusena' }),
  a4: rez(BERNARD, '2026-10-30', '20:00', { jmeno_hosta: 'Bez Počtu', pocet_osob: null }),
  a5: rez(BERNARD, '2026-10-30', '21:00', { jmeno_hosta: 'Čtvrtý Host', pocet_osob: 3 }),
  a6: rez(BERNARD, '2026-10-09', '18:00', { druh: 'akce', nazev: 'Degustace vín', pocet_osob: 30 }),
  // Neděle 1. 11.: v mřížce října je (dorovnání týdne), do října nepatří.
  a7: rez(BERNARD, '2026-11-01', '12:00', { jmeno_hosta: 'Rodina Černých', pocet_osob: 8 }),
}
const B = {
  b3: rez(PERLA, '2026-10-28', '12:00', { jmeno_hosta: 'Eva Dvořáková' }),
  b1: rez(PERLA, '2026-10-30', '20:00', { druh: 'akce', nazev: 'Narozeniny Petra', pocet_osob: 25 }),
  b2: rez(PERLA, '2026-10-31', '12:30', { jmeno_hosta: 'Nedorazil', stav: 'nedostavil_se' }),
}
const VSECHNY = [...Object.values(A), ...Object.values(B)].sort((x, y) => x.zacatek.localeCompare(y.zacatek))

{
  const o = (od, doDne) => ({ od, do: doDne })
  const eq = (a, b) => a.od === b.od && a.do === b.do
  ok('měsíc: jen jeho dny (1.–31. 10.), ne dorovnání mřížky', eq(obdobiPohledu('mesic', '2026-10-15'), o('2026-10-01', '2026-10-31')))
  ok('měsíc: přestupný únor 2028 do 29.', eq(obdobiPohledu('mesic', '2028-02-03'), o('2028-02-01', '2028-02-29')))
  ok('týden: pondělí–neděle', eq(obdobiPohledu('tyden', '2026-10-30'), o('2026-10-26', '2026-11-01')))
  ok('den: ten den', eq(obdobiPohledu('den', '2026-10-30'), o('2026-10-30', '2026-10-30')))

  const mesic = souhrnyPobocek(VSECHNY, [BERNARD.id, PERLA.id], obdobiPohledu('mesic', '2026-10-30'))
  const sa = mesic.get(BERNARD.id)
  const sb = mesic.get(PERLA.id)
  ok(`Bernard v říjnu: 4 rezervace, 1 akce, 39 hostů + 1 bez počtu (je ${JSON.stringify(sa)})`, sa.rezervaci === 4 && sa.akci === 1 && sa.hostu === 39 && sa.bezPoctu === 1 && sa.zrusenych === 1)
  ok(`Perla v říjnu: 1 rezervace, 1 akce, 27 hostů, nedorazivší zvlášť (je ${JSON.stringify(sb)})`, sb.rezervaci === 1 && sb.akci === 1 && sb.hostu === 27 && sb.zrusenych === 1)

  const tyden = souhrnyPobocek(VSECHNY, [BERNARD.id, PERLA.id], obdobiPohledu('tyden', '2026-10-30'))
  ok('Bernard v týdnu 26. 10.–1. 11.: i neděle 1. 11., bez akce z 9. 10. (5 rezervací, 17 hostů)', tyden.get(BERNARD.id).rezervaci === 5 && tyden.get(BERNARD.id).akci === 0 && tyden.get(BERNARD.id).hostu === 17)

  const prazdna = souhrnyPobocek([], ['nova'], obdobiPohledu('tyden', '2026-10-30')).get('nova')
  ok('pobočka bez rezervací má v souhrnu nuly (v legendě je vidět)', prazdna && prazdna.rezervaci === 0 && prazdna.hostu === 0)

  const s = (rezervaci, akci, hostu, bezPoctu = 0) => ({ rezervaci, akci, hostu, bezPoctu, zrusenych: 0 })
  ok('text: 1 rezervace · 1 host', souhrnText(s(1, 0, 1)) === '1 rezervace · 1 host')
  ok('text: 3 rezervace · 2 akce · 4 hosté', souhrnText(s(3, 2, 4)) === '3 rezervace · 2 akce · 4 hosté')
  ok('text: 12 rezervací · 5 akcí · 87 hostů + 2 bez počtu', souhrnText(s(12, 5, 87, 2)) === '12 rezervací · 5 akcí · 87 hostů + 2 bez počtu')
  ok('text: nic', souhrnText(s(0, 0, 0)) === 'Nic zapsaného')

  const po = poPobockach(VSECHNY.filter((r) => r.den === '2026-10-30'), [PERLA.id, BERNARD.id])
  ok('rozdělení dne po pobočkách drží pořadí poboček a vynechá prázdné', po.length === 2 && po[0].id === PERLA.id && po[1].rezervace.length === 5)
}

console.log('\n== 5. Vykreslený kalendář ==\n')

const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
const NIC = js('export default function Nic() { return null }\n')
const AKCE = js(
  'const akce = async () => {}\n' +
    'export const zmenitStav = akce, odebratPrilohu = akce, pridatPoznamku = akce, smazatPoznamku = akce, upravitPoznamku = akce, ulozitRezervaci = akce\n',
)
const obsah = await nactiModul('app/[rozsah]/rezervace/obsah.tsx', [
  ['next/link', ODKAZ],
  ['./akce', AKCE],
  ['./formular', NIC],
  ['./prilohy-nahrat', NIC],
])

const vzhled = vzhledPobocek([BERNARD, PERLA])
const pobocka = (b) => ({ id: b.id, nazev: b.name, slug: b.id === BERNARD.id ? 'bernard-bar' : 'cerna-perla', zona: 'Europe/Prague', zapis: true, ...vzhled.get(b.id) })
const POBOCKY = [pobocka(BERNARD), pobocka(PERLA)]
const [PB, PP] = POBOCKY

const kalendar = (pohled, pobocky) =>
  renderToStaticMarkup(
    createElement(obsah.KalendarObsah, {
      rozsah: pobocky.length > 1 ? 'firma' : pobocky[0].slug,
      pohled,
      datum: '2026-10-30',
      dnes: '2026-10-30',
      pobocky,
      rezervace: VSECHNY.filter((r) => pobocky.some((p) => p.id === r.branch_id)),
      znacky: new Map(),
    }),
  )
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const karta = (html, p) => html.match(new RegExp(`<li class="ds-rez-pobocka-karta" data-branch="([a-z]+)" data-pobocka="${p.id}">([\\s\\S]*?)</li>`))
/** Každá (pobočka → barva) v celém HTML: legenda, rámečky, skupiny buněk, oddíly dne. */
const barvyVHtml = (html) => {
  const mapa = new Map()
  for (const m of html.matchAll(/data-branch="([a-z]+)" data-pobocka="([^"]+)"/g)) mapa.set(m[2], new Set([...(mapa.get(m[2]) ?? []), m[1]]))
  // Štítky nesou název v `title` — přeložit na id.
  for (const m of html.matchAll(/class="ds-rez-znacka" data-branch="([a-z]+)" title="([^"]+)"/g)) {
    const p = POBOCKY.find((x) => x.nazev === m[2])
    if (p) mapa.set(p.id, new Set([...(mapa.get(p.id) ?? []), m[1]]))
  }
  return mapa
}
const jednaBarva = (html, pobocky) => {
  const mapa = barvyVHtml(html)
  return pobocky.every((p) => mapa.get(p.id)?.size === 1 && mapa.get(p.id).has(p.barva))
}

{
  const html = kalendar('mesic', POBOCKY)
  const kb = karta(html, PB)
  const kp = karta(html, PP)
  ok('měsíc za firmu: legenda má rámeček každé pobočky v její barvě', kb?.[1] === PB.barva && kp?.[1] === PP.barva && PB.barva !== PP.barva)
  ok(
    `legenda Bernardu: zkratka, název a souhrn za říjen („${kb ? text(kb[2]) : '—'}“)`,
    !!kb && /BBT/.test(kb[2]) && text(kb[2]).includes('Bernard Bar Tábor') && text(kb[2]).includes('4 rezervace') && text(kb[2]).includes('39 hostů + 1 bez počtu') && text(kb[2]).includes('1 akce') && text(kb[2]).includes('za říjen 2026'),
  )
  ok(`legenda Perly: 1 rezervace, 27 hostů („${kp ? text(kp[2]) : '—'}“)`, !!kp && /RČP/.test(kp[2]) && text(kp[2]).includes('1 rezervace') && text(kp[2]).includes('27 hostů'))

  const mrizka = html.slice(html.indexOf('class="ds-rez-mesic"'))
  const radky = [...mrizka.matchAll(/class="ds-rez-bunka-radek" data-druh="([a-z]+)" title="([^"]*)"><span class="ds-rez-znacka" data-branch="([a-z]+)" title="([^"]+)"><span aria-hidden="true">([^<]*)<\/span>/g)]
  const vsechnyRadky = (mrizka.match(/class="ds-rez-bunka-radek"/g) ?? []).length
  ok(`měsíc: každá vypsaná rezervace začíná štítkem zkratky (${radky.length} z ${vsechnyRadky})`, vsechnyRadky > 0 && radky.length === vsechnyRadky)
  const cizi = radky.filter(([, , titulek, barva, nazev, zkratka]) => {
    const p = POBOCKY.find((x) => titulek.startsWith(x.nazev + ' ·'))
    return !p || p.nazev !== nazev || p.zkratka !== zkratka || p.barva !== barva
  })
  ok('měsíc: štítek nese zkratku a barvu TÉ pobočky, které rezervace patří', radky.length > 0 && cizi.length === 0)
  const vypsane = new Set(radky.map((m) => m[2].split(' · ')[1].replace(/^\d\d:\d\d /, '')))
  ok(
    'měsíc: vypsané jsou platné rezervace i akce, zrušené a nedorazivší ne',
    ['Jan Novák', 'Eva Malá', 'Bez Počtu', 'Degustace vín', 'Narozeniny Petra', 'Eva Dvořáková'].every((j) => vypsane.has(j)) &&
      !vypsane.has('Karel Zrušený') &&
      !vypsane.has('Nedorazil'),
  )
  ok('měsíc: čtvrtá rezervace Bernardu 30. 10. je v „+ 1 další (BBT)“, ne vypsaná', !vypsane.has('Čtvrtý Host') && text(mrizka).includes('+ 1 další (BBT)'))
  ok('měsíc: akce v buňce má praporek (tvar, ne jen vínová barva)', /data-druh="akce"[^>]*>(?:(?!ds-rez-bunka-radek).)*class="ft-i"/s.test(mrizka))
  ok('měsíc: jedna pobočka = jedna barva všude (legenda, skupiny v buňkách, štítky)', jednaBarva(html, POBOCKY))
  ok(
    'měsíc: popis buňky pro odečítač má souhrn každé pobočky',
    /aria-label="pá 30\. 10\.: Bernard Bar Tábor: 4 rezervace · [^"]*; Restaurace Černá Perla: 0 rezervací · 1 akce · 25 hostů"/.test(html),
  )

  const jedna = kalendar('mesic', [PP])
  ok('měsíc za pobočku: legenda jen té pobočky, štítek RČP i tady', (jedna.match(/ds-rez-pobocka-karta/g) ?? []).length === 1 && /<span aria-hidden="true">RČP<\/span>/.test(jedna.slice(jedna.indexOf('class="ds-rez-mesic"'))))
  ok('měsíc za pobočku: tatáž barva jako na firemním kalendáři', jednaBarva(jedna, [PP]))
}

{
  const html = kalendar('tyden', POBOCKY)
  // Konec skupiny: začátek další nebo konec dne — karty uvnitř jsou taky
  // <div>, líné `</div>` by vzalo jen první z nich.
  const skupiny = [...html.matchAll(/<div class="ds-rez-skupina" data-branch="([a-z]+)" data-pobocka="([^"]+)" role="group" aria-label="([^"]+)">/g)].map((m) => {
    const od = m.index + m[0].length
    const konec = Math.min(...[html.indexOf('<div class="ds-rez-skupina"', od), html.indexOf('</section>', od)].filter((i) => i !== -1))
    return [m[0], m[1], m[2], m[3], html.slice(od, konec)]
  })
  ok(`týden za firmu: rezervace jsou po pobočkách v rámečcích (${skupiny.length} skupin)`, skupiny.length === 5)
  const spatne = skupiny.filter(([, barva, id, nazev, vnitrek]) => {
    const p = POBOCKY.find((x) => x.id === id)
    const odkazy = [...vnitrek.matchAll(/href="\/firma\/rezervace\/([0-9a-f-]{36})"/g)].map((m) => m[1])
    return !p || p.barva !== barva || p.nazev !== nazev || odkazy.length === 0 || odkazy.some((r) => VSECHNY.find((x) => x.id === r)?.branch_id !== id)
  })
  const karet = skupiny.reduce((n, s) => n + (s[4].match(/class="ds-rez-polozka"/g) ?? []).length, 0)
  ok(`týden: v rámečku pobočky jsou jen její rezervace (všech ${karet} karet), rámeček v její barvě`, spatne.length === 0 && karet === VSECHNY.filter((r) => r.den >= '2026-10-26' && r.den <= '2026-11-01').length)
  const patek = html.slice(html.indexOf('aria-label="pá 30. 10."'), html.indexOf('aria-label="so 31. 10."'))
  const vPatek = [...patek.matchAll(/class="ds-rez-skupina" data-branch="[a-z]+" data-pobocka="([^"]+)"/g)].map((m) => m[1])
  ok('týden: v pátek 30. 10. nejdřív rámeček Bernardu, pak Perly (pořadí legendy)', vPatek.join() === [PB.id, PP.id].join())
  ok(
    'týden: hlavička rámečku nese souhrn pobočky za den',
    text(patek).includes('BBT 4 rez. · 9 hostů + 1 bez počtu') && text(patek).includes('RČP 1 akce · 25 hostů'),
  )
  const kb = karta(html, PB)
  ok(`týden: legenda za týden („${kb ? text(kb[2]) : '—'}“)`, !!kb && text(kb[2]).includes('5 rezervací') && text(kb[2]).includes('17 hostů') && text(kb[2]).includes('za týden 26. 10. – 1. 11. 2026'))
  ok('týden: jedna pobočka = jedna barva všude', jednaBarva(html, POBOCKY))

  const jedna = kalendar('tyden', [PB])
  ok('týden za pobočku: bez rámečků po pobočkách (je jen jedna), legenda s její barvou', !jedna.includes('ds-rez-skupina') && karta(jedna, PB)?.[1] === PB.barva)
}

{
  const den = (pobocky) =>
    renderToStaticMarkup(
      createElement(obsah.DenObsah, {
        rozsah: pobocky.length > 1 ? 'firma' : pobocky[0].slug,
        datum: '2026-10-30',
        dnes: '2026-10-30',
        tenantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kDnu: pobocky.map((p) => ({ pobocka: p, rezervace: VSECHNY.filter((r) => r.den === '2026-10-30' && r.branch_id === p.id), poznamky: [], prilohy: [] })),
      }),
    )
  const html = den(POBOCKY)
  const oddily = [...html.matchAll(/<section class="ds-plocha ds-rez-oddil" data-branch="([a-z]+)" data-pobocka="([^"]+)">([\s\S]*?)<\/section>/g)]
  ok('den za firmu: každá pobočka ve svém oddílu v její barvě', oddily.length === 2 && oddily.every(([, b, id]) => POBOCKY.find((p) => p.id === id)?.barva === b))
  const hlavicka = (o) => text(o[3].slice(0, o[3].indexOf('</div>')))
  ok(
    `den: hlavička oddílu = název, zkratka, souhrn dne („${oddily[0] ? hlavicka(oddily[0]) : '—'}“ / „${oddily[1] ? hlavicka(oddily[1]) : '—'}“)`,
    oddily.length === 2 &&
      hlavicka(oddily[0]) === 'Bernard Bar Tábor BBT 4 rezervace · 9 hostů + 1 bez počtu' &&
      hlavicka(oddily[1]) === 'Restaurace Černá Perla RČP 0 rezervací · 1 akce · 25 hostů',
  )
  ok('den: jedna pobočka = jedna barva všude (i u poznámek v boku)', jednaBarva(html, POBOCKY))
  const jedna = den([PP])
  ok('den za pobočku: oddíl v barvě pobočky, štítek s celým názvem pro odečítač', /ds-rez-oddil" data-branch="[a-z]+" data-pobocka/.test(jedna) && jedna.includes('<span class="sr-only">Restaurace Černá Perla</span>') && jednaBarva(jedna, [PP]))
}

console.log('\n== 6. Dokumenty u rezervací — vykreslené (3. 11. 2026) ==\n')

{
  // Zadání Šéfíka 2. 11.: „aby v kalendáři akcí bylo vidět, že je
  // u jednotlivé rezervace dokument, a možnost ho otevřít“. Tady se
  // kontroluje vykreslené HTML skutečných obsah.tsx a prvky.tsx, ne
  // zdroják: kam odkaz vede, jak se otevře, u které rezervace je.
  const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  let k = 0
  const dok = (nazev, mime) => ({ id: `eeeeeeee-eeee-4eee-8eee-${String((k += 1)).padStart(12, '0')}`, nazev, mime })
  const D = {
    smlouva: dok('Smlouva Novákovi.docx', MIME_DOCX),
    menu: dok('Menu svatba.pdf', 'application/pdf'),
    plan: dok('Plán sálu.jpg', 'image/jpeg'),
    storno: dok('Storno.pdf', 'application/pdf'),
    pozde: dok('Pozdní objednávka.pdf', 'application/pdf'),
    rozpis: dok('Rozpis.docx', MIME_DOCX),
    dort: dok('Dort.png', 'image/png'),
    jenZrusena: dok('Zrušeno.pdf', 'application/pdf'),
  }
  // Pátek 30. 10.: Bernard má čtyři platné (do buňky měsíce se vejdou
  // tři, čtvrtá s dokumentem je až v „+ 1 další“) a jednu zrušenou
  // s dokumentem; Perla jednu se dvěma. Čtvrtek 29. 10. jen zrušená
  // s dokumentem, středa 28. 10. jen rezervace bez dokumentu.
  const S = {
    tri: rez(BERNARD, '2026-10-30', '17:00', { druh: 'akce', nazev: 'Svatba Novákovi', dokumenty: [D.smlouva, D.menu, D.plan] }),
    bez: rez(BERNARD, '2026-10-30', '18:00', { jmeno_hosta: 'Host Bez Přílohy' }),
    zrusena: rez(BERNARD, '2026-10-30', '18:30', { jmeno_hosta: 'Zrušená S Přílohou', stav: 'zrusena', dokumenty: [D.storno] }),
    treti: rez(BERNARD, '2026-10-30', '19:00', { jmeno_hosta: 'Třetí Host' }),
    pozde: rez(BERNARD, '2026-10-30', '21:00', { jmeno_hosta: 'Čtvrtá Pozdě', dokumenty: [D.pozde] }),
    perla: rez(PERLA, '2026-10-30', '20:00', { jmeno_hosta: 'Perla Dva', dokumenty: [D.rozpis, D.dort] }),
    ctvrtek: rez(PERLA, '2026-10-29', '12:00', { jmeno_hosta: 'Jen Zrušená', stav: 'zrusena', dokumenty: [D.jenZrusena] }),
    streda: rez(PERLA, '2026-10-28', '12:00', { jmeno_hosta: 'Středa Bez' }),
  }
  const VSE = Object.values(S).sort((x, y) => x.zacatek.localeCompare(y.zacatek))
  const kal = (pohled, pobocky = POBOCKY) =>
    renderToStaticMarkup(
      createElement(obsah.KalendarObsah, {
        rozsah: pobocky.length > 1 ? 'firma' : pobocky[0].slug,
        pohled,
        datum: '2026-10-30',
        dnes: '2026-10-30',
        pobocky,
        rezervace: VSE.filter((r) => pobocky.some((p) => p.id === r.branch_id)),
        znacky: new Map(),
      }),
    )
  const odEntit = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const atributy = (znacka) => Object.fromEntries([...znacka.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], odEntit(m[2])]))
  /** Nejhlubší zanoření <a> — 2 a víc = odkaz v odkazu, ten prohlížeč rozbije. */
  const hloubkaOdkazu = (html) => {
    let h = 0
    let nejvic = 0
    for (const m of html.matchAll(/<a[\s>]|<\/a>/g)) {
      h += m[0] === '</a>' ? -1 : 1
      nejvic = Math.max(nejvic, h)
    }
    return nejvic
  }
  /** Odkazy na dokumenty v kusu HTML: název (title), kam, jak se otevře, viditelná přípona, nápověda pro čtečku. */
  const stitky = (html) =>
    [...html.matchAll(/<a ([^>]*class="ds-rez-dokument"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
      const a = atributy(m[1])
      return {
        nazev: a.title,
        href: a.href,
        target: a.target ?? null,
        rel: a.rel ?? null,
        pripona: odEntit(m[2].match(/<span class="ds-rez-dokument-pripona">([^<]*)<\/span>/)?.[1] ?? ''),
        napoveda: odEntit(m[2].match(/<span class="sr-only">([^<]*)<\/span>/)?.[1] ?? ''),
      }
    })
  /** Jak má vypadat odkaz na dokument `d` z kalendáře, který se vrací na `zpet`. */
  const ocekavany = (d, zpet, rozsah = 'firma') =>
    d.mime === MIME_DOCX
      ? { nazev: d.nazev, href: `/${rozsah}/rezervace/dokument/${d.id}?zpet=${encodeURIComponent(zpet)}`, target: null, rel: null, pripona: '.docx', napoveda: ' (náhled dokumentu)' }
      : { nazev: d.nazev, href: `/api/rezervace/soubor/${d.id}`, target: '_blank', rel: 'noopener noreferrer', pripona: d.nazev.slice(d.nazev.lastIndexOf('.')), napoveda: ' (otevře se v nové záložce)' }
  const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  /** Odkud se náhled Wordu vrátí: `?zpet=` z vykresleného odkazu, jak ho přečte stránka náhledu. */
  const zpatkyZOdkazu = (rozsah, href) => zpatkyZKalendare(rozsah, new URL(href, 'https://foodtab.test').searchParams.get('zpet') ?? undefined)

  // --- týden -------------------------------------------------------------
  try {
    const html = kal('tyden')
    const zpet = '/firma/rezervace?pohled=tyden&datum=2026-10-30'
    ok(`týden: žádný odkaz v odkazu (nejhlubší zanoření ${hloubkaOdkazu(html)})`, hloubkaOdkazu(html) === 1)
    // Karta = odkaz na rezervaci a hned za ním (ne v něm) její dokumenty.
    const karty = new Map(
      [...html.matchAll(/<div class="ds-rez-polozka"[^>]*><a href="\/firma\/rezervace\/([0-9a-f-]{36})" class="ds-rez-polozka-odkaz">(?:(?!<\/?a[\s>])[\s\S])*<\/a>(<ul class="ds-rez-dokumenty"[\s\S]*?<\/ul>)?<\/div>/g)].map((m) => [m[1], m[2] ?? '']),
    )
    ok(`týden: každá rezervace má kartu s odkazem a dokumenty za ním, ne v něm (${karty.size} z ${VSE.length})`, karty.size === VSE.length && VSE.every((r) => karty.has(r.id)))
    const tri = karty.get(S.tri.id) ?? ''
    const dalsi = tri.match(/<a href="([^"]*)" class="ds-rez-dokument-dalsi">([\s\S]*?)<\/a>/)
    ok(
      `týden: akce se třemi dokumenty ukáže první dva v pořadí a „+ 1 další dokument“ rovnou k dokumentům v detailu (${dalsi ? `„${text(dalsi[2])}“ → ${dalsi[1]}` : 'chybí'})`,
      stejne(stitky(tri), [ocekavany(D.smlouva, zpet), ocekavany(D.menu, zpet)]) && !!dalsi && dalsi[1] === `/firma/rezervace/${S.tri.id}#dokumenty` && text(dalsi[2]) === '+ 1 další dokument',
    )
    ok(
      'týden: Word se vrací na tenhle týden a PDF/fotka jdou do nové záložky — u každého štítku přípona a nápověda pro čtečku',
      stejne(stitky(karty.get(S.perla.id) ?? ''), [ocekavany(D.rozpis, zpet), ocekavany(D.dort, zpet)]) && !(karty.get(S.perla.id) ?? '').includes('ds-rez-dokument-dalsi'),
    )
    ok('týden: zrušená rezervace dokument ukáže taky', stejne(stitky(karty.get(S.zrusena.id) ?? ''), [ocekavany(D.storno, zpet)]))
    ok('týden: rezervace bez dokumentu nemá seznam dokumentů', karty.get(S.bez.id) === '' && karty.get(S.streda.id) === '' && karty.get(S.treti.id) === '')
    const vsechny = stitky(html)
    const cizi = [...karty].filter(([id, ul]) => !stitky(ul).every((s) => VSE.find((r) => r.id === id)?.dokumenty.some((d) => d.nazev === s.nazev)))
    ok(`týden: každý dokument jen u své rezervace (${vsechny.length} štítků, ${cizi.length} cizích)`, vsechny.length === 7 && cizi.length === 0)
    ok('týden: seznam dokumentů je pro čtečku seznam se jménem rezervace', tri.startsWith('<ul class="ds-rez-dokumenty" role="list" aria-label="Dokumenty: Svatba Novákovi">'))
    const zTydne = zpatkyZOdkazu('firma', stitky(tri)[0]?.href ?? '')
    ok(`týden → náhled Wordu → „Zpět na kalendář“ na tenhle týden (adresa z vykresleného odkazu, jak ji přečte stránka náhledu; je „${zTydne?.text}“ na ${zTydne?.href})`, stejne(zTydne, { href: zpet, text: 'Zpět na kalendář' }))

    const jedna = kal('tyden', [PB])
    const zJedne = stitky(jedna)
    ok(
      `týden za pobočku (bez rámečků): stejné dokumenty, Word se vrací na týden pobočky (${zJedne.length} štítků)`,
      zJedne.length === 4 && hloubkaOdkazu(jedna) === 1 && stejne(zJedne[0], ocekavany(D.smlouva, '/bernard-bar/rezervace?pohled=tyden&datum=2026-10-30', 'bernard-bar')),
    )
  } catch (e) {
    ok(`týden s dokumenty se vykreslí — výjimka: ${e.message}`, false)
  }

  // --- měsíc -------------------------------------------------------------
  try {
    const html = kal('mesic')
    ok(`měsíc: žádný odkaz v odkazu (nejhlubší zanoření ${hloubkaOdkazu(html)})`, hloubkaOdkazu(html) === 1)
    ok('měsíc: v buňkách žádný odkaz na dokument (buňka je celá odkaz na den)', stitky(html).length === 0 && !html.includes('/rezervace/dokument/') && !html.includes('/api/rezervace/soubor/'))
    const bunka = (den) => {
      const m = html.match(new RegExp(`<a href="/firma/rezervace/den/${den}" class="ds-rez-bunka"[^>]*aria-label="([^"]*)"[^>]*>([\\s\\S]*?)</a>`))
      return m ? { popis: odEntit(m[1]), vnitrek: m[2] } : { popis: '', vnitrek: '' }
    }
    /** Řádky buňky (rezervace a „+ N další“) a sponka u každého: null = žádná, '1' = jeden dokument, jinak číslo. */
    const radky = (vnitrek) =>
      vnitrek
        .split(/(?=<span class="ds-rez-bunka-(?:radek|dalsi)")/)
        .slice(1)
        .map((kus) => {
          const sponka = kus.match(/<span class="ds-rez-bunka-dokumenty"[^>]*>[\s\S]*?<\/svg>(\d*)<\/span>/)
          return { dalsi: kus.startsWith('<span class="ds-rez-bunka-dalsi"'), title: odEntit(kus.match(/^<span [^>]*title="([^"]*)"/)?.[1] ?? ''), sponka: sponka ? sponka[1] || '1' : null }
        })
    const patek = bunka('2026-10-30')
    const r = radky(patek.vnitrek)
    const popis = r.map((x) => `${x.dalsi ? 'další' : x.title.split(' · ')[1]}: ${x.sponka ?? '-'}`).join(', ')
    ok(
      `měsíc 30. 10.: sponka s počtem jen u rezervací s dokumentem, zrušená vynechaná, schovaná čtvrtá dá sponku k „+ 1 další“ (${popis})`,
      r.length === 5 &&
        r[0].title.includes('Svatba Novákovi') && r[0].title.endsWith(' · 3 dokumenty') && r[0].sponka === '3' &&
        r[1].title.includes('Host Bez Přílohy') && r[1].sponka === null && !r[1].title.includes('dokument') &&
        r[2].title.includes('Třetí Host') && r[2].sponka === null &&
        r[3].dalsi && r[3].sponka === '1' &&
        r[4].title.includes('Perla Dva') && r[4].title.endsWith(' · 2 dokumenty') && r[4].sponka === '2',
    )
    ok(`měsíc 30. 10.: popis buňky pro čtečku počítá i schovanou („${patek.popis}“)`, patek.popis.endsWith(', 3 rezervace s dokumentem'))
    const ctvrtek = bunka('2026-10-29')
    ok(`měsíc 29. 10.: jen zrušená s dokumentem = žádná sponka ani zmínka („${ctvrtek.popis}“)`, ctvrtek.popis.startsWith('čt 29. 10.') && !ctvrtek.vnitrek.includes('ds-rez-bunka-dokumenty') && !ctvrtek.popis.includes('dokument'))
    const streda = bunka('2026-10-28')
    ok(`měsíc 28. 10.: bez dokumentu = žádná sponka ani zmínka („${streda.popis}“)`, streda.vnitrek.includes('Středa Bez') && !streda.vnitrek.includes('ds-rez-bunka-dokumenty') && !streda.popis.includes('dokument'))
  } catch (e) {
    ok(`měsíc s dokumenty se vykreslí — výjimka: ${e.message}`, false)
  }

  // --- den ---------------------------------------------------------------
  try {
    const html = renderToStaticMarkup(
      createElement(obsah.DenObsah, {
        rozsah: 'firma',
        datum: '2026-10-30',
        dnes: '2026-10-30',
        tenantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kDnu: POBOCKY.map((p) => ({ pobocka: p, rezervace: VSE.filter((r) => r.den === '2026-10-30' && r.branch_id === p.id), poznamky: [], prilohy: [] })),
      }),
    )
    const zpet = '/firma/rezervace/den/2026-10-30'
    ok(`den: žádný odkaz v odkazu (nejhlubší zanoření ${hloubkaOdkazu(html)})`, hloubkaOdkazu(html) === 1)
    const radky = new Map(
      [...html.matchAll(/<li><a href="\/firma\/rezervace\/([0-9a-f-]{36})" class="ds-rez-radek"[^>]*>(?:(?!<\/?a[\s>])[\s\S])*<\/a>(<ul class="ds-rez-dokumenty"[\s\S]*?<\/ul>)?<\/li>/g)].map((m) => [m[1], m[2] ?? '']),
    )
    const dne = VSE.filter((r) => r.den === '2026-10-30')
    ok(`den: každá rezervace dne má řádek a dokumenty za odkazem (${radky.size} z ${dne.length})`, radky.size === dne.length && dne.every((r) => radky.has(r.id)))
    ok(
      'den: všechny tři dokumenty akce v pořadí (bez „další“), Word s návratem na den',
      stejne(stitky(radky.get(S.tri.id) ?? ''), [ocekavany(D.smlouva, zpet), ocekavany(D.menu, zpet), ocekavany(D.plan, zpet)]) && !(radky.get(S.tri.id) ?? '').includes('ds-rez-dokument-dalsi'),
    )
    ok('den: zrušená i s dokumentem, Perla s Wordem i fotkou', stejne(stitky(radky.get(S.zrusena.id) ?? ''), [ocekavany(D.storno, zpet)]) && stejne(stitky(radky.get(S.perla.id) ?? ''), [ocekavany(D.rozpis, zpet), ocekavany(D.dort, zpet)]))
    ok('den: bez dokumentu bez seznamu', radky.get(S.bez.id) === '' && radky.get(S.treti.id) === '')
    // Úzké rozvržení řádku se řídí šířkou hlavního sloupce (`rez-hlavni`
    // v app/_rezervace.css): řádky musí ležet v něm, v kalendáři.
    const predci = []
    const otevrene = []
    for (const m of html.matchAll(/<(\/?)div\b([^>]*)>|class="ds-rez-radek"/g)) {
      if (m[0].startsWith('class=')) predci.push(otevrene.map((c) => c.split(' ')))
      else if (m[1]) otevrene.pop()
      else otevrene.push(m[2].match(/class="([^"]*)"/)?.[1] ?? '')
    }
    const vHlavnim = predci.filter((p) => p.findIndex((c) => c.includes('ds-rez')) >= 0 && p.findIndex((c) => c.includes('ds-rez')) < p.findIndex((c) => c.includes('ds-dnes-hlavni'))).length
    ok(`den: každý řádek rezervace leží v hlavním sloupci (.ds-dnes-hlavni) uvnitř kalendáře (.ds-rez) (${vHlavnim} z ${dne.length})`,
      predci.length === dne.length && vHlavnim === dne.length)
    const zDne = zpatkyZOdkazu('firma', stitky(radky.get(S.tri.id) ?? '')[0]?.href ?? '')
    ok(`den → náhled Wordu → „Zpět na den“ na tenhle den (je „${zDne?.text}“ na ${zDne?.href})`, stejne(zDne, { href: zpet, text: 'Zpět na den' }))
  } catch (e) {
    ok(`den s dokumenty se vykreslí — výjimka: ${e.message}`, false)
  }
}

console.log('\n== 7. Stoly z rezervačního systému — vykreslené i načtené (4. 11. 2026) ==\n')

{
  // Zadání Šéfíka 4. 11.: z Choice se nenačítá „umístění a obsazení
  // stolů“ (Booking #105: Patro, S1–S12). Stoly patří zdroji
  // (`misto_zdroje`), „Stůl / prostor“ dál obsluze — tady se kontroluje,
  // že se obojí ukáže tam, kde se na rezervaci kouká, a nic se nezdvojí.
  const stejneObj = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const T = {
    choice: rez(BERNARD, '2026-10-30', '17:30', { jmeno_hosta: 'Choice Patro', pocet_osob: 2, zdroj: 'api', prostor: 'Patro', misto_zdroje: 'Patro: S1–S12' }),
    obsluha: rez(BERNARD, '2026-10-30', '18:15', { jmeno_hosta: 'Obsluha Okno', zdroj: 'api', prostor: 'u okna', misto_zdroje: 'Terasa: L7' }),
    jenProstor: rez(BERNARD, '2026-10-30', '19:15', { jmeno_hosta: 'Jen Prostor', prostor: 'Salonek' }),
    nic: rez(PERLA, '2026-10-30', '20:30', { jmeno_hosta: 'Bez Místa' }),
    // Řádek ze staré databáze (před 20261107100000) klíč vůbec nemá.
    stary: rez(PERLA, '2026-10-30', '21:30', { jmeno_hosta: 'Starý Řádek', prostor: 'Bar' }),
    // 3. kolo kontroly kódu: kdo napsal prostor, říká příznak z databáze.
    // Zdroj doplnil „Patro“, host si pak v Choice přání změnil na „Zahrada“.
    zmenenePrani: rez(BERNARD, '2026-10-30', '20:00', { jmeno_hosta: 'Zmenene Prani', zdroj: 'api', prostor: 'Patro', prani_zdroje: 'Zahrada', prostor_ze_zdroje: true, misto_zdroje: 'Terasa: L7' }),
    // Obsluha napsala „Patro“ — stejně jako přání hosta, ale je to její text.
    obsluhaJakoPrani: rez(BERNARD, '2026-10-30', '20:15', { jmeno_hosta: 'Obsluha Jako Prani', zdroj: 'api', prostor: 'Patro', prani_zdroje: 'Patro', prostor_ze_zdroje: false, misto_zdroje: 'Terasa: L7' }),
  }
  const VSE = Object.values(T).sort((x, y) => x.zacatek.localeCompare(y.zacatek))
  // mistoKratce a prostorZeZdroje jsou od 4. kola v lib/rezervace-misto.ts
  // (sdílí je ranní souhrn); kalendář je bere odtamtud — vykreslení níž
  // (týden, den, detail) jde přes skutečný prvky.tsx.
  // Čtvrtý argument je příznak `prostor_ze_zdroje`; vynechaný = klíč chybí
  // (řádek z doby před migrací), rozhodne shoda s přáním.
  const mk = (prostor, misto_zdroje, prani_zdroje, ...priznak) =>
    JSON.stringify(mistoKratce({ prostor, misto_zdroje, prani_zdroje, ...(priznak.length ? { prostor_ze_zdroje: priznak[0] } : {}) }))
  // Každá kontrola zvlášť: výjimka shodí jen ji, ne zbytek oddílu (2. kolo kontroly kódu).
  const okMk = (popis, fn) => {
    let x
    try { x = fn() } catch (e) { ok(`${popis} — výjimka: ${e?.message}`, false); return }
    ok(popis, x)
  }
  okMk('místo krátce: prostor obsažený ve stolech se nezdvojí (i jinou velikostí písmen)', () => mk('Patro', 'Patro: S1–S12') === '["Patro: S1–S12"]' && mk('patro', 'Patro: S1–S12') === '["Patro: S1–S12"]')
  okMk('místo krátce: jiný prostor od obsluhy zůstane před stoly', () => mk('u okna', 'Terasa: L7') === '["u okna","Terasa: L7"]')
  okMk('místo krátce: jen jedno z nich, nic, chybějící klíč, mezery', () => mk('Salonek', '') === '["Salonek"]' && mk('', 'Bar: 1–7') === '["Bar: 1–7"]' && mk('', '') === '[]' && mk('Bar', undefined) === '["Bar"]' && mk('  ', '  ') === '[]')
  // Kontrola kódu 4. 11.: prostor, který je jen KUSEM textu stolů, se
  // schovával — „S1“ od obsluhy vedle stolu „S12“ zmizel, a obsluha by
  // si myslela, že host sedí u S12 jen proto, že tam Choice přesadil.
  // Schová se jen celý text stolů nebo celé jméno oblasti.
  okMk('místo krátce: prostor „S1“ od obsluhy vedle stolu „Patro: S12“ zůstane (není to tentýž stůl)', () => mk('S1', 'Patro: S12') === '["S1","Patro: S12"]')
  okMk('místo krátce: „1“ vedle „Patro: S10, S11“ zůstane, „Pat“ vedle „Patro: S1“ taky', () => mk('1', 'Patro: S10, S11') === '["1","Patro: S10, S11"]' && mk('Pat', 'Patro: S1') === '["Pat","Patro: S1"]')
  okMk('místo krátce: jméno druhé oblasti („Terasa“ v „Patro: S1 · Terasa: L7“) se nezdvojí, celý text stolů taky ne',
    () => mk('Terasa', 'Patro: S1 · Terasa: L7') === '["Patro: S1 · Terasa: L7"]' && mk('patro: s1–s12', 'Patro: S1–S12') === '["Patro: S1–S12"]' && mk(' Patro ', 'Patro: S1–S12') === '["Patro: S1–S12"]')
  okMk('místo krátce: stoly bez jména oblasti („3 stoly bez názvu“) a prostor „stoly“ — oba zůstanou', () => mk('stoly', '3 stoly bez názvu') === '["stoly","3 stoly bez názvu"]')
  // 2. kolo kontroly kódu: jméno oblasti s „: “ nebo „ · “ uvnitř se dřív
  // rozdělilo špatně a prostor se ukázal dvakrát.
  okMk('místo krátce: jméno oblasti s „: “ („Zahrada: vzadu“) i s „ · “ („Bar · Restaurace“) se pozná a nezdvojí',
    () => mk('Zahrada: vzadu', 'Zahrada: vzadu: S1') === '["Zahrada: vzadu: S1"]' && mk('Bar · Restaurace', 'Patro: S1 · Bar · Restaurace: 1–3') === '["Patro: S1 · Bar · Restaurace: 1–3"]')
  // 2. kolo kontroly kódu: přání hosta („Patro“), které zdroj doplnil do
  // prostoru, dokud stoly nebyly, se vedle stolů „Terasa: L7“ četlo jako
  // druhé místo. Podle `prani_zdroje` se vedle stolů neukáže.
  okMk('místo krátce: prostor = přání hosta ze zdroje („Patro“) se vedle stolů „Terasa: L7“ neukáže (i jinou velikostí písmen)',
    () => mk('Patro', 'Terasa: L7', 'Patro') === '["Terasa: L7"]' && mk('patro', 'Terasa: L7', 'Patro') === '["Terasa: L7"]')
  okMk('místo krátce: přání bez stolů zůstane; jiný prostor obsluhy vedle přání i stolů zůstane; prázdné přání nic neschová',
    () => mk('Patro', '', 'Patro') === '["Patro"]' && mk('u okna', 'Terasa: L7', 'Patro') === '["u okna","Terasa: L7"]' && mk('u okna', 'Terasa: L7', '') === '["u okna","Terasa: L7"]')
  // 3. kolo kontroly kódu (#4, #6–#10): kdo prostor napsal, neříká shoda
  // textu, ale příznak `prostor_ze_zdroje` z databáze. Shoda textu platí
  // jen pro řádek bez příznaku (null / chybějící klíč).
  okMk('místo krátce: příznak „ze zdroje“ a přání se v Choice změnilo — vedle stolů jen stoly, bez stolů AKTUÁLNÍ přání (ne staré „Patro“)',
    () => mk('Patro', 'Terasa: L7', 'Zahrada', true) === '["Terasa: L7"]' && mk('Patro', '', 'Zahrada', true) === '["Zahrada"]')
  // 4. kolo (#12): host přání v Choice smazal. Staré „Patro“ v prostoru
  // je přání, ne text obsluhy — v krátkém řádku se neukáže (detail ho
  // ukáže s poznámkou „doplněno z Choice“).
  okMk('místo krátce: zdroj doplnil přání a host ho v Choice smazal — staré přání se neukáže (bez stolů nic, se stoly jen stoly)',
    () => mk('Patro', '', '', true) === '[]' && mk('Patro', 'Terasa: L7', '', true) === '["Terasa: L7"]')
  okMk('místo krátce: příznak „obsluha“ a text stejný jako přání — prostor se ukáže vedle stolů (nepřebije ho shoda s přáním)',
    () => mk('Patro', 'Terasa: L7', 'Patro', false) === '["Patro","Terasa: L7"]' && mk('patro', 'Terasa: L7', 'Patro', false) === '["patro","Terasa: L7"]' && mk('Patro', '', 'Patro', false) === '["Patro"]')
  okMk('místo krátce: obsluha bez stolů — její text, ne přání hosta (s příznakem i bez něj)',
    () => mk('u okna', '', 'Patro', false) === '["u okna"]' && mk('u okna', '', 'Patro') === '["u okna"]' && mk('u okna', '', 'Patro', null) === '["u okna"]')
  okMk('místo krátce: příznak „obsluha“ = jméno oblasti ve stolech se dál nezdvojí',
    () => mk('Patro', 'Patro: S1', 'Patro', false) === '["Patro: S1"]' && mk('Patro', 'Patro: S1', '', false) === '["Patro: S1"]')
  okMk('místo krátce: příznak null = jako bez klíče (shoda s přáním)',
    () => mk('Patro', 'Terasa: L7', 'Patro', null) === '["Terasa: L7"]' && mk('u okna', 'Terasa: L7', 'Patro', null) === '["u okna","Terasa: L7"]')
  okMk('místo krátce: příznak true u prázdného prostoru nic nevymyslí',
    () => mk('', 'Terasa: L7', 'Patro', true) === '["Terasa: L7"]' && mk('  ', '', 'Patro', true) === '["Patro"]' && mk('', '', '', true) === '[]')
  // 3. kolo (#10): stoly, které v seznamu míst nejsou, jdou jako „N stolů
  // bez názvu“; samy o sobě neřeknou, kde host sedí — přidá se přání.
  okMk('místo krátce: jen „2 stoly bez názvu“ → přání hosta před nimi (ze zdroje i ze starého řádku); „1 stůl“ i „5 stolů“ taky',
    () => mk('Patro', '2 stoly bez názvu', 'Patro', true) === '["Patro","2 stoly bez názvu"]' && mk('Patro', '1 stůl bez názvu', 'Patro') === '["Patro","1 stůl bez názvu"]'
      && mk('', '5 stolů bez názvu', 'Zahrada') === '["Zahrada","5 stolů bez názvu"]' && mk('Patro', '12 stolů bez názvu', 'Zahrada', true) === '["Zahrada","12 stolů bez názvu"]')
  okMk('místo krátce: stoly s jménem oblasti a „bez názvu“ jen na konci — přání se nepřidá; bez přání se nic nepřidá',
    () => mk('Patro', 'Patro: S1, 2 stoly bez názvu', 'Patro', true) === '["Patro: S1, 2 stoly bez názvu"]' && mk('Patro', 'Patro: 2 stoly bez názvu', 'Patro', true) === '["Patro: 2 stoly bez názvu"]'
      && mk('', '2 stoly bez názvu', '') === '["2 stoly bez názvu"]' && mk('Patro', 'Terasa: L1 · 1 stůl bez názvu', 'Patro', true) === '["Terasa: L1 · 1 stůl bez názvu"]')
  okMk('místo krátce: obsluha vedle „2 stoly bez názvu“ — její text, ne přání',
    () => mk('u okna', '2 stoly bez názvu', 'Patro', false) === '["u okna","2 stoly bez názvu"]')
  okMk('prostor ze zdroje: příznak rozhoduje, bez něj shoda s přáním (i jinou velikostí písmen a s mezerami), prázdný prostor nikdy',
    () => prostorZeZdroje({ prostor: 'Patro', prani_zdroje: 'Zahrada', prostor_ze_zdroje: true }) === true
      && prostorZeZdroje({ prostor: 'Patro', prani_zdroje: 'Patro', prostor_ze_zdroje: false }) === false
      && prostorZeZdroje({ prostor: ' patro ', prani_zdroje: 'Patro' }) === true
      && prostorZeZdroje({ prostor: 'Patro', prani_zdroje: 'Patro', prostor_ze_zdroje: null }) === true
      && prostorZeZdroje({ prostor: 'Patro', prani_zdroje: '' }) === false
      && prostorZeZdroje({ prostor: '', prani_zdroje: '', prostor_ze_zdroje: true }) === false)

  // --- týden ---
  try {
    const html = renderToStaticMarkup(
      createElement(obsah.KalendarObsah, { rozsah: 'firma', pohled: 'tyden', datum: '2026-10-30', dnes: '2026-10-30', pobocky: POBOCKY, rezervace: VSE, znacky: new Map() }),
    )
    const karta = (r) => html.match(new RegExp(`<a href="/firma/rezervace/${r.id}" class="ds-rez-polozka-odkaz">([\\s\\S]*?)</a>`))?.[1] ?? ''
    const misto = (r) => {
      const m = karta(r).match(/<small class="ds-rez-polozka-misto" title="([^"]*)">([^<]*)<\/small>/)
      return m ? { title: m[1], text: m[2] } : null
    }
    ok(`týden: karta z Choice má druhý řádek „Patro: S1–S12“, prostor podruhé ne (${JSON.stringify(misto(T.choice))})`,
      stejneObj(misto(T.choice), { title: 'Patro: S1–S12', text: 'Patro: S1–S12' }) && !karta(T.choice).includes('Patro · Patro'))
    ok(`týden: prostor od obsluhy i stoly (${JSON.stringify(misto(T.obsluha))})`, stejneObj(misto(T.obsluha), { title: 'u okna · Terasa: L7', text: 'u okna · Terasa: L7' }))
    ok('týden: jen prostor obsluhy → řádek s prostorem; bez místa → žádný řádek; starý řádek bez klíče → prostor',
      misto(T.jenProstor)?.text === 'Salonek' && misto(T.nic) === null && karta(T.nic) !== '' && misto(T.stary)?.text === 'Bar')
    ok('týden: řádek místa je uvnitř odkazu karty (klik na stoly otevře rezervaci)', karta(T.choice).includes('ds-rez-polozka-misto'))
    ok(`týden: příznak z databáze dojde až do karty — prostor ze zdroje vedle stolů ne (${JSON.stringify(misto(T.zmenenePrani))}), obsluha se stejným textem jako přání ano (${JSON.stringify(misto(T.obsluhaJakoPrani))})`,
      misto(T.zmenenePrani)?.text === 'Terasa: L7' && misto(T.obsluhaJakoPrani)?.text === 'Patro · Terasa: L7')
  } catch (e) {
    ok(`týden se stoly se vykreslí — výjimka: ${e.message}`, false)
  }

  // --- den ---
  try {
    const html = renderToStaticMarkup(
      createElement(obsah.DenObsah, {
        rozsah: 'firma',
        datum: '2026-10-30',
        dnes: '2026-10-30',
        tenantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kDnu: POBOCKY.map((p) => ({ pobocka: p, rezervace: VSE.filter((r) => r.branch_id === p.id), poznamky: [], prilohy: [] })),
      }),
    )
    const meta = (r) => html.match(new RegExp(`<a href="/firma/rezervace/${r.id}" class="ds-rez-radek"[\\s\\S]*?<p class="ds-rez-meta">([^<]*)</p>`))?.[1] ?? null
    ok(`den: Choice „2 osoby · Patro: S1–S12“ (je „${meta(T.choice)}“)`, meta(T.choice) === '2 osoby · Patro: S1–S12')
    ok(`den: obsluha a stoly „2 osoby · u okna · Terasa: L7“ (je „${meta(T.obsluha)}“)`, meta(T.obsluha) === '2 osoby · u okna · Terasa: L7')
    ok(`den: jen prostor, bez místa, starý řádek (${[T.jenProstor, T.nic, T.stary].map((r) => `„${meta(r)}“`).join(', ')})`,
      meta(T.jenProstor) === '2 osoby · Salonek' && meta(T.nic) === '2 osoby' && meta(T.stary) === '2 osoby · Bar')
    ok(`den: příznak z databáze — „${meta(T.zmenenePrani)}“ a „${meta(T.obsluhaJakoPrani)}“`,
      meta(T.zmenenePrani) === '2 osoby · Terasa: L7' && meta(T.obsluhaJakoPrani) === '2 osoby · Patro · Terasa: L7')
  } catch (e) {
    ok(`den se stoly se vykreslí — výjimka: ${e.message}`, false)
  }

  // --- detail ---
  const detail = (radek, o = {}) =>
    renderToStaticMarkup(
      createElement(obsah.DetailObsah, {
        rozsah: 'bernard-bar',
        tenantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        detail: { radek, menu: '', zaloha: { haleru: null, stav: 'zadna' }, poznamkaZdroje: '', stavZdroje: '', poskytovatel: 'choice', importovanoKdy: null, cisloZdroje: '', ...o },
        pobocka: PB,
        poznamky: [],
        prilohy: [],
        kontakt: null,
      }),
    )
  const udaje = (html) => Object.fromEntries([...html.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]))
  try {
    const html = detail(T.choice, { cisloZdroje: '105' })
    const u = udaje(html)
    ok(`detail: „Stoly v Choice: Patro: S1–S12“ a „Stůl / prostor: Patro“ zvlášť (${JSON.stringify({ stoly: u['Stoly v Choice'], prostor: u['Stůl / prostor'] })})`,
      u['Stoly v Choice'] === 'Patro: S1–S12' && u['Stůl / prostor'] === 'Patro')
    const zdroj = html.match(/<p class="ds-rez-zdroj"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
    ok(`detail: původ s číslem rezervace „(Choice, č. 105)“ a stoly ve výčtu převzatého (${text(zdroj).slice(0, 120)}…)`,
      text(zdroj).startsWith('Převzato z rezervačního systému (Choice, č. 105)') && text(zdroj).includes('kontakt a stoly se mění tam'))
    const bez = detail(T.jenProstor, { poskytovatel: null })
    const ub = udaje(bez)
    ok('detail ručně zapsané: bez řádku stolů, bez čísla', !('Stoly v Choice' in ub) && !('Stoly v rezervačním systému' in ub) && ub['Stůl / prostor'] === 'Salonek' && !bez.includes('č. '))
    const stary = udaje(detail(T.stary, { poskytovatel: 'choice' }))
    ok('detail starého řádku (bez klíče misto_zdroje): vykreslí se, bez řádku stolů', !('Stoly v Choice' in stary) && stary['Stůl / prostor'] === 'Bar')
    const neznamy = udaje(detail(T.obsluha, { poskytovatel: 'neznamy-system' }))
    ok(`detail z neznámého systému: obecný nadpis „Stoly v rezervačním systému“ (${JSON.stringify(Object.keys(neznamy))})`, neznamy['Stoly v rezervačním systému'] === 'Terasa: L7')
  } catch (e) {
    ok(`detail se stoly se vykreslí — výjimka: ${e.message}`, false)
  }
  try {
    // Přání hosta (2. kolo kontroly kódu): v detailu je vidět, odkud se vzalo.
    const stejne = udaje(detail({ ...T.choice, prostor: 'Patro', prani_zdroje: 'Patro', misto_zdroje: 'Terasa: L7' }))
    ok(`detail: prostor, který je přáním hosta, má poznámku „(přání hosta v Choice)“ a samostatný řádek přání není (${JSON.stringify(stejne)})`,
      stejne['Stůl / prostor'] === 'Patro (přání hosta v Choice)' && !('Přání hosta v Choice' in stejne) && stejne['Stoly v Choice'] === 'Terasa: L7')
    const jine = udaje(detail({ ...T.obsluha, prani_zdroje: 'Patro' }))
    ok(`detail: jiný prostor od obsluhy zůstane, přání hosta má vlastní řádek „Přání hosta v Choice: Patro“ (${JSON.stringify(jine)})`,
      jine['Stůl / prostor'] === 'u okna' && jine['Přání hosta v Choice'] === 'Patro')
    const bezPrani = udaje(detail(T.choice))
    ok('detail bez přání (starý řádek nebo host nic nechtěl): žádná poznámka ani řádek přání', bezPrani['Stůl / prostor'] === 'Patro' && !Object.keys(bezPrani).some((k) => k.startsWith('Přání')))
  } catch (e) {
    ok(`detail s přáním hosta se vykreslí — výjimka: ${e.message}`, false)
  }
  // 3. kolo kontroly kódu (#6–#9, #16): poznámka u prostoru podle příznaku.
  const detailUdaje = (popis, radek, o, fn) => {
    let u
    try { u = udaje(detail(radek, o)) } catch (e) { ok(`${popis} — výjimka: ${e.message}`, false); return }
    ok(`${popis} (${JSON.stringify(Object.fromEntries(Object.entries(u).filter(([k]) => k.startsWith('Stůl') || k.startsWith('Přání') || k.startsWith('Stoly'))))})`, fn(u))
  }
  detailUdaje('detail: prostor ze zdroje, přání se v Choice změnilo → „Patro (doplněno z Choice)“ a aktuální přání na vlastním řádku',
    T.zmenenePrani, {}, (u) => u['Stůl / prostor'] === 'Patro (doplněno z Choice)' && u['Přání hosta v Choice'] === 'Zahrada' && u['Stoly v Choice'] === 'Terasa: L7')
  detailUdaje('detail: prostor ze zdroje a pořád stejné přání → „(přání hosta v Choice)“, bez řádku přání',
    { ...T.zmenenePrani, prani_zdroje: 'patro' }, {}, (u) => u['Stůl / prostor'] === 'Patro (přání hosta v Choice)' && !('Přání hosta v Choice' in u))
  detailUdaje('detail: obsluha napsala totéž co přání → prostor bez poznámky, přání na vlastním řádku',
    T.obsluhaJakoPrani, {}, (u) => u['Stůl / prostor'] === 'Patro' && u['Přání hosta v Choice'] === 'Patro')
  detailUdaje('detail: prostor ze zdroje a přání v Choice smazané → „(doplněno z Choice)“, žádný řádek přání',
    { ...T.zmenenePrani, prani_zdroje: '' }, {}, (u) => u['Stůl / prostor'] === 'Patro (doplněno z Choice)' && !Object.keys(u).some((k) => k.startsWith('Přání')))
  detailUdaje('detail: neznámý systém → „(doplněno z rezervačního systému)“ a „Přání hosta v rezervačním systému“',
    T.zmenenePrani, { poskytovatel: 'neznamy-system' }, (u) => u['Stůl / prostor'] === 'Patro (doplněno z rezervačního systému)' && u['Přání hosta v rezervačním systému'] === 'Zahrada')
  detailUdaje('detail: řádek bez příznaku (null) a prostor = přání → jako ve 2. kole „(přání hosta v Choice)“',
    { ...T.zmenenePrani, prani_zdroje: 'Patro', prostor_ze_zdroje: null }, {}, (u) => u['Stůl / prostor'] === 'Patro (přání hosta v Choice)' && !('Přání hosta v Choice' in u))

  // --- načtení: nová i stará databáze (data.ts naostro, databáze podstrčená) ---
  // Vercel nasadí kód dřív než db push: do té doby sloupce nejsou a kalendář
  // nesmí spadnout. Podstrčená je jen odpověď databáze, rozhoduje skutečné
  // data.ts a skutečné `sloupecNeexistuje` z lib/supabase/dotaz.ts.
  const PRAZDNY = js('')
  const DOTAZ = adresaModulu('lib/supabase/dotaz.ts', [['server-only', PRAZDNY]])
  const data = await nactiModul('app/[rozsah]/rezervace/data.ts', [
    ['server-only', PRAZDNY],
    ['@/lib/supabase/dotaz', DOTAZ],
    ['@/lib/supabase/server', js('export async function getServerSupabase() { return globalThis.__rezDb }')],
    ['@/lib/provozni-den', js('export async function provozniDen() { return null }')],
  ])
  /** Databáze, která na každý dotaz odpoví `odpoved(dotaz)` a zapamatuje si ho. */
  const falesna = (odpoved) => {
    const dotazy = []
    return {
      dotazy,
      from(tabulka) {
        const d = { tabulka, select: '', filtry: [] }
        dotazy.push(d)
        const b = {
          select: (s) => ((d.select = s), b),
          maybeSingle: () => ((d.jeden = true), b),
          then: (a, c) => Promise.resolve(odpoved(d)).then(a, c),
        }
        for (const f of ['eq', 'in', 'gte', 'lte', 'order', 'limit']) b[f] = (...x) => (d.filtry.push([f, ...x]), b)
        return b
      },
    }
  }
  const TEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const PBR = { id: BERNARD.id, nazev: BERNARD.name, slug: 'bernard-bar', zona: 'Europe/Prague', zapis: true }
  const radekDb = (o = {}) => ({ id: T.choice.id, branch_id: BERNARD.id, den: '2026-10-30', druh: 'rezervace', stav: 'potvrzeno', nazev: '', jmeno_hosta: 'Choice Patro', zacatek: T.choice.zacatek, konec: null, pocet_osob: 2, prostor: 'Patro', typ_akce: '', zdroj: 'api', ...o })
  const filtry = (d) => JSON.stringify(d.filtry)
  const nemaSloupec = (kod) => (d) =>
    d.select.includes('misto_zdroje') || d.select.includes('cislo_zdroje')
      ? { data: null, error: { code: kod, message: 'column rezervace.misto_zdroje does not exist' } }
      : { data: d.jeden ? radekDb({ menu: '', zaloha_hosta_haleru: null, zaloha_hosta_stav: 'zadna', poznamka_zdroje: '', stav_zdroje: '', poskytovatel: 'choice', importovano_kdy: null, externi_zmeneno_kdy: null }) : [{ ...radekDb(), rezervace_prilohy: [] }], error: null }

  /** Načtení nad podstrčenou databází; výjimka se vrátí, ať shodí svou kontrolu, ne všechny další. */
  const nacti = async (db, fn) => {
    globalThis.__rezDb = db
    try {
      return { v: await fn(), dotazy: db.dotazy, e: null }
    } catch (e) {
      return { v: null, dotazy: db.dotazy, e }
    } finally {
      delete globalThis.__rezDb
    }
  }
  const kalendar = (db) => nacti(db, () => data.nacistRezervace(TEN, [PBR], '2026-10-26', '2026-11-01'))
  const detailDb = (db) => nacti(db, () => data.nacistRezervaci(TEN, T.choice.id, [PBR]))
  const proc = (r) => (r.e ? `, výjimka: ${r.e.message}` : '')
  const detailRadek = (o = {}) => radekDb({ menu: '', zaloha_hosta_haleru: null, zaloha_hosta_stav: 'zadna', poznamka_zdroje: '', stav_zdroje: '', poskytovatel: 'choice', importovano_kdy: null, externi_zmeneno_kdy: null, ...o })

  {
    const r = await kalendar(falesna(() => ({ data: [{ ...radekDb({ misto_zdroje: 'Patro: S1–S12', prani_zdroje: 'Patro', prostor_ze_zdroje: true }), rezervace_prilohy: [] }], error: null })))
    ok(`načtení kalendáře (nová DB): jeden dotaz se stoly, přáním hosta, příznakem a vnořenými dokumenty; vše v řádku (${r.dotazy.length} dotaz, „${r.v?.[0]?.misto_zdroje}“, přání „${r.v?.[0]?.prani_zdroje}“, příznak ${r.v?.[0]?.prostor_ze_zdroje}${proc(r)})`,
      !r.e && r.dotazy.length === 1 && r.dotazy[0].select.endsWith(', misto_zdroje, prani_zdroje, prostor_ze_zdroje, rezervace_prilohy(id, nazev, mime, nahrano)') && r.v[0]?.misto_zdroje === 'Patro: S1–S12' && r.v[0]?.prani_zdroje === 'Patro' && r.v[0]?.prostor_ze_zdroje === true && stejneObj(r.v[0]?.dokumenty, []))
  }
  {
    // Příznak jinak než boolean (null z legacy řádku, nebo nečekaný tvar) → null.
    const r = await kalendar(falesna(() => ({ data: [false, null, 't', 1].map((p, i) => ({ ...radekDb({ id: `${T.choice.id.slice(0, -1)}${i}`, prostor_ze_zdroje: p }), rezervace_prilohy: [] })), error: null })))
    ok(`načtení kalendáře: příznak false zůstane false, null / 't' / 1 → null (${JSON.stringify(r.v?.map((x) => x.prostor_ze_zdroje))}${proc(r)})`,
      !r.e && JSON.stringify(r.v?.map((x) => x.prostor_ze_zdroje)) === '[false,null,null,null]')
  }
  for (const kod of ['42703', 'PGRST204']) {
    const r = await kalendar(falesna(nemaSloupec(kod)))
    const [a, b] = r.dotazy
    ok(`načtení kalendáře (stará DB, ${kod}): druhý dotaz bez stolů, se stejnými filtry a dokumenty; řádek má stoly '' (${r.dotazy.length} dotazy${proc(r)})`,
      !r.e && r.dotazy.length === 2 && !b.select.includes('misto_zdroje') && !b.select.includes('prani_zdroje') && b.select.endsWith(', zdroj, rezervace_prilohy(id, nazev, mime, nahrano)') && filtry(a) === filtry(b) && filtry(b).includes(TEN) && r.v[0]?.misto_zdroje === '' && r.v[0]?.prani_zdroje === '' && r.v[0]?.prostor === 'Patro' && r.v[0]?.prostor_ze_zdroje === null && !b.select.includes('prostor_ze_zdroje'))
  }
  {
    const r = await kalendar(falesna(() => ({ data: null, error: { code: '42501', message: 'permission denied for table rezervace' } })))
    ok(`načtení kalendáře: jiná chyba se neopakuje a vyhodí se (${r.dotazy.length} dotaz, ${r.e?.name})`,
      r.dotazy.length === 1 && r.e?.name === 'DotazSelhal' && r.e.message.includes('42501'))
  }
  {
    const r = await detailDb(falesna(() => ({ data: detailRadek({ misto_zdroje: 'Patro: S1–S12', cislo_zdroje: '105', prani_zdroje: 'Patro', prostor_ze_zdroje: false }), error: null })))
    ok(`načtení detailu (nová DB): stoly, číslo, přání hosta i příznak (${r.v?.radek.misto_zdroje}, č. ${r.v?.cisloZdroje}, přání ${r.v?.radek.prani_zdroje}, příznak ${r.v?.radek.prostor_ze_zdroje}${proc(r)})`,
      !r.e && r.dotazy.length === 1 && r.dotazy[0].select.endsWith('externi_zmeneno_kdy, misto_zdroje, cislo_zdroje, prani_zdroje, prostor_ze_zdroje') && r.v?.radek.misto_zdroje === 'Patro: S1–S12' && r.v?.cisloZdroje === '105' && r.v?.radek.prani_zdroje === 'Patro' && r.v?.radek.prostor_ze_zdroje === false)
  }
  {
    const r = await detailDb(falesna(nemaSloupec('42703')))
    ok(`načtení detailu (stará DB): druhý dotaz bez sloupců zdroje, stoly '', číslo '' i přání '' (${r.dotazy.length} dotazy${proc(r)})`,
      !r.e && r.dotazy.length === 2 && r.dotazy[1].select.endsWith('externi_zmeneno_kdy') && r.v?.radek.misto_zdroje === '' && r.v?.cisloZdroje === '' && r.v?.radek.prani_zdroje === '' && r.v?.radek.prostor_ze_zdroje === null)
  }
  {
    const r = await kalendar(falesna(() => ({ data: [{ ...radekDb({ misto_zdroje: null }), rezervace_prilohy: null }], error: null })))
    ok(`načtení kalendáře: stoly null → '' (do vykreslení nejde nic jiného než text)${proc(r)}`, !r.e && r.v[0]?.misto_zdroje === '')
  }
}

console.log(chyb ? `\n${chyb} kontrol NEPROŠLO\n` : '\nVšechny kontroly prošly.\n')
process.exit(chyb ? 1 : 0)
