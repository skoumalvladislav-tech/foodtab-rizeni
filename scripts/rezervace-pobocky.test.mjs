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
 *      zkratky u každé rezervace v měsíci, jedna barva na pobočku všude.
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
import { nactiModul } from './vykreslit.mjs'

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
  const skupiny = [...html.matchAll(/<div class="ds-rez-skupina" data-branch="([a-z]+)" data-pobocka="([^"]+)" role="group" aria-label="([^"]+)">([\s\S]*?)<\/div>/g)]
  ok(`týden za firmu: rezervace jsou po pobočkách v rámečcích (${skupiny.length} skupin)`, skupiny.length === 5)
  const spatne = skupiny.filter(([, barva, id, nazev, vnitrek]) => {
    const p = POBOCKY.find((x) => x.id === id)
    const odkazy = [...vnitrek.matchAll(/href="\/firma\/rezervace\/([^"]+)"/g)].map((m) => m[1])
    return !p || p.barva !== barva || p.nazev !== nazev || odkazy.length === 0 || odkazy.some((r) => VSECHNY.find((x) => x.id === r)?.branch_id !== id)
  })
  ok('týden: v rámečku pobočky jsou jen její rezervace, rámeček v její barvě', spatne.length === 0)
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

console.log(chyb ? `\n${chyb} kontrol NEPROŠLO\n` : '\nVšechny kontroly prošly.\n')
process.exit(chyb ? 1 : 0)
