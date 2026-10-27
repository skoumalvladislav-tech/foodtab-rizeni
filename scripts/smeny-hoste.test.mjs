#!/usr/bin/env node
/**
 * Rozpis směn — hosté z rezervací u dne (Šéfík 27. 10. 2026: „když najedu
 * myší na konkrétní den, aby se ukazoval počet hostů na jednotlivých
 * pobočkách — podle toho budu vědět, kolik dát zaměstnanců“).
 *
 * Pusť `node scripts/smeny-hoste.test.mjs`.
 *
 *   1. počítání (lib/rezervace-pobocky.ts): po PROVOZNÍCH dnech
 *      (`rezervace.den`, rezervace v 1:30 patří k večeru předtím), po
 *      pobočkách, bez zrušených a nedorazivších; výběr poboček z filtru;
 *   2. KDO TO VIDÍ — se SPOUŠTÍ skutečný app/[rozsah]/rezervace/hoste.ts
 *      i skutečný přístup Rezervací (pristup.ts); podstrčená je jen
 *      databáze a odpovědi na práva. Bez práva na rezervace se na ně
 *      nesáhne vůbec; čte se jen pobočka, den, druh, stav a počet osob;
 *      chyba dotazu rozpis neshodí a neukáže nuly;
 *   3. VYKRESLENÍ (scripts/vykreslit.mjs): skutečná týdenní mřížka
 *      (desktop/mrizka.tsx) má u záhlaví dne spouštěč okénka, skutečný
 *      denní přehled na telefonu (mobil/pohledy.tsx) řádek v toku stránky;
 *      bez práva ani jedno. Obsah okénka: zkratka a barva pobočky, počty,
 *      celkem, odkaz na den v Rezervacích.
 *
 * Ovládání (najetí myší, Tab, klepnutí, Esc) se v Node spustit nedá —
 * ověřené je průchodem v headless Chromu (snímky v PR).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { celkemDne, hostePobocek, souhrnyPoDnech, vzhledPobocek } from '../lib/rezervace-pobocky.ts'
import { FILTR_DESKTOP_PRAZDNY, sestavitMrizku } from '../lib/rozpis-desktop.ts'
import { FILTR_PRAZDNY } from '../lib/rozpis-mobil.ts'
import { adresaModulu, nactiModul } from './vykreslit.mjs'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8').replace(/\r\n/g, '\n')
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VETVE = [
  { id: B, name: 'Bernard Bar Tábor', slug: 'bernard-bar', color: 'rose', timezone: 'Europe/Prague' },
  { id: P, name: 'Restaurace Černá Perla', slug: 'cerna-perla', color: 'rose', timezone: 'Europe/Prague' },
]

/* Řádky tak, jak je vrací dotaz v hoste.ts (pobočka, provozní den, druh, stav, počet). */
const R = (branch_id, den, o = {}) => ({ branch_id, den, druh: 'rezervace', stav: 'potvrzeno', pocet_osob: 2, ...o })
const RADKY = [
  R(B, '2026-10-27', { pocet_osob: 4 }),
  // Začátek v 1:30 v noci na 28. — databáze ji počítá k provoznímu dni 27. (den začíná v 5:00).
  R(B, '2026-10-27', { pocet_osob: 3 }),
  R(B, '2026-10-27', { pocet_osob: 6, stav: 'zrusena' }),
  R(B, '2026-10-27', { pocet_osob: null, stav: 'ceka' }),
  R(P, '2026-10-27', { druh: 'akce', pocet_osob: 25 }),
  R(P, '2026-10-27', { pocet_osob: 2, stav: 'nedostavil_se' }),
  R(P, '2026-10-28', { pocet_osob: 40, druh: 'akce' }),
]

console.log('\n== 1. Počítání po provozních dnech a pobočkách ==\n')
{
  const dny = souhrnyPoDnech(RADKY)
  const b27 = dny['2026-10-27']?.[B]
  const p27 = dny['2026-10-27']?.[P]
  ok(`Bernard 27. 10.: 3 rezervace (i ta z 1:30 v noci), 7 hostů + 1 bez počtu, zrušená stranou (${JSON.stringify(b27)})`,
    b27?.rezervaci === 3 && b27.hostu === 7 && b27.bezPoctu === 1 && b27.zrusenych === 1)
  ok(`Perla 27. 10.: 1 akce, 25 hostů, nedorazivší se nepočítají (${JSON.stringify(p27)})`, p27?.akci === 1 && p27.hostu === 25 && p27.zrusenych === 1)
  ok('jiný den, jiná pobočka zvlášť; den bez rezervací chybí', dny['2026-10-28']?.[P]?.hostu === 40 && !dny['2026-10-28']?.[B] && !dny['2026-10-29'])

  const vz = vzhledPobocek(VETVE)
  const pobocky = VETVE.map((v) => ({ id: v.id, nazev: v.name, ...vz.get(v.id) }))
  const hoste = { pobocky, dny, chyba: false }
  const c = celkemDne(hoste, '2026-10-27')
  ok('celkem za den sečte pobočky (3 rezervace, 1 akce, 32 hostů + 1 bez počtu)', c.rezervaci === 3 && c.akci === 1 && c.hostu === 32 && c.bezPoctu === 1)
  ok('celkem za den bez rezervací = nuly', celkemDne(hoste, '2026-10-30').hostu === 0)
  ok('výběr pobočky z filtru „Zobrazit“: jen ona', hostePobocek(hoste, [P])?.pobocky.map((p) => p.id).join() === P)
  ok('prázdný filtr = všechny pobočky', hostePobocek(hoste, [])?.pobocky.length === 2)
  ok('filtr na pobočku bez práva na rezervace → nic (okénko se nekreslí)', hostePobocek(hoste, ['jina']) === null)
  ok('bez práva vůbec → nic', hostePobocek(null, []) === null && hostePobocek(null, [B]) === null)
}

console.log('\n== 2. Kdo hosty uvidí — hoste.ts a přístup Rezervací se SPOUŠTĚJÍ ==\n')

/** Podstrčená databáze: zapisuje, na co se ptalo, a vrátí `globalThis.__hOdpoved`. */
function databaze() {
  const dotaz = { tabulka: null, sloupce: null, podminky: [] }
  globalThis.__hDotazy.push(dotaz)
  const q = {
    select(s) { dotaz.sloupce = s; return q },
    eq(k, v) { dotaz.podminky.push(['eq', k, v]); return q },
    in(k, v) { dotaz.podminky.push(['in', k, v]); return q },
    gte(k, v) { dotaz.podminky.push(['gte', k, v]); return q },
    lte(k, v) { dotaz.podminky.push(['lte', k, v]); return q },
    limit(n) { dotaz.podminky.push(['limit', n]); return q },
    then(hotovo, chyba) { return Promise.resolve(globalThis.__hOdpoved).then(hotovo, chyba) },
  }
  return { from(t) { dotaz.tabulka = t; return q } }
}
globalThis.__hDatabaze = databaze

const PRAZDNY = js('')
const AUTHZ = js('export async function hasAccess(t, pravo, pobocka) { return globalThis.__hPrava.some(([p, b]) => p === pravo && b === pobocka) }\n')
const FIRMA = js('export async function zkusPristup(t, pravo, rozsah) { return globalThis.__hPristup(pravo, rozsah) }\n')
const SUPABASE = js('export async function getServerSupabase() { return globalThis.__hDatabaze() }\n')
const PRISTUP = adresaModulu('app/[rozsah]/rezervace/pristup.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
])
const { hosteProRozpis } = await nactiModul('app/[rozsah]/rezervace/hoste.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/supabase/server', SUPABASE],
  ['./pristup', PRISTUP],
])

const FIRMA_S = { level: 'tenant', branchId: null }
async function spustit({ pristupJen = null, scope = FIRMA_S, prava = [], odpoved = { data: RADKY, error: null } } = {}) {
  globalThis.__hDotazy = []
  globalThis.__hPrava = prava
  globalThis.__hOdpoved = odpoved
  globalThis.__hPristup = (pravo) =>
    pristupJen && !pristupJen.includes(pravo) ? { stav: 'odepren' } : { stav: 'ok', ctx: { branches: VETVE }, scope }
  const v = await hosteProRozpis('t1', scope.branchId ? 'cerna-perla' : 'firma', '2026-10-26', '2026-11-01')
  return { v, dotazy: globalThis.__hDotazy }
}
const vsePrava = [['rezervace.read', B], ['rezervace.read', P]]

{
  const bez = await spustit({ pristupJen: [] })
  ok('rozpis vidí i člověk bez práva na rezervace → hosté null, na rezervace se nesáhne', bez.v === null && bez.dotazy.length === 0)

  const bezPobocky = await spustit({ prava: [] })
  ok('právo za firmu, ale na žádné pobočce → null, bez dotazu', bezPobocky.v === null && bezPobocky.dotazy.length === 0)

  const vse = await spustit({ prava: vsePrava })
  const d = vse.dotazy[0]
  ok('s právem na obou pobočkách: jeden dotaz na tabulku rezervace', vse.dotazy.length === 1 && d.tabulka === 'rezervace')
  ok(`čtou se jen počty — pobočka, provozní den, druh, stav, počet osob (žádná jména ani kontakty): „${d?.sloupce}“`,
    d?.sloupce?.split(',').map((s) => s.trim()).sort().join() === 'branch_id,den,druh,pocet_osob,stav')
  ok('omezení: firma, pobočky s právem, provozní dny okna rozpisu',
    JSON.stringify(d?.podminky.slice(0, 4)) === JSON.stringify([['eq', 'tenant_id', 't1'], ['in', 'branch_id', [B, P]], ['gte', 'den', '2026-10-26'], ['lte', 'den', '2026-11-01']]))
  ok('pobočky nesou zkratku a barvu jako v kalendáři Rezervací (BBT/RČP, dvě různé barvy)',
    vse.v?.pobocky.map((p) => p.zkratka).join() === 'BBT,RČP' && vse.v.pobocky[0].barva !== vse.v.pobocky[1].barva)
  ok('souhrn po dnech došel až do výsledku', vse.v?.chyba === false && vse.v.dny['2026-10-27']?.[B]?.hostu === 7)

  const jenBernard = await spustit({ prava: [['rezervace.read', B]] })
  ok('právo jen na Bernardu → hosté jen Bernardu, dotaz jen na něj',
    jenBernard.v?.pobocky.map((p) => p.id).join() === B && JSON.stringify(jenBernard.dotazy[0].podminky[1]) === JSON.stringify(['in', 'branch_id', [B]]))

  const spravce = await spustit({ prava: [['rezervace.manage', P]], pristupJen: ['rezervace.manage'] })
  ok('kdo rezervace jen spravuje (rezervace.manage), hosty vidí taky', spravce.v?.pobocky.map((p) => p.id).join() === P)

  const pobocka = await spustit({ prava: vsePrava, scope: { level: 'branch', branchId: P } })
  ok('na pobočce (rozsah z adresy) jen ta pobočka, i když člověk vidí obě', pobocka.v?.pobocky.map((p) => p.id).join() === P)

  const chyba = await spustit({ prava: vsePrava, odpoved: { data: null, error: { code: '42P01', message: 'relation does not exist' } } })
  ok('chyba dotazu rozpis neshodí a NEUKÁŽE NULY: chyba = true, žádné dny', chyba.v?.chyba === true && Object.keys(chyba.v.dny).length === 0)

  const strop = await spustit({ prava: vsePrava, odpoved: { data: Array.from({ length: 10000 }, () => R(B, '2026-10-27')), error: null } })
  ok('narazí-li dotaz na strop řádků, součet by lhal → chyba, ne čísla', strop.v?.chyba === true)

  const stranka = cti('app/[rozsah]/smeny/page.tsx')
  ok('Rozpis bere hosty za tytéž provozní dny, které načítá (nacistOd … nacistDo)', /hosteProRozpis\(tenantId, rozsah, nacistOd, nacistDo\)/.test(stranka))
  ok('hoste.ts se na právo ptá přes zkusPristupRezervacim (táž funkce jako stránka Rezervací)', /await zkusPristupRezervacim\(tenantId, rozsah\)/.test(cti('app/[rozsah]/rezervace/hoste.ts')))
}

console.log('\n== 3. Vykreslení ==\n')

const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
const vz = vzhledPobocek(VETVE)
const HOSTE = { pobocky: VETVE.map((v) => ({ id: v.id, nazev: v.name, ...vz.get(v.id) })), dny: souhrnyPoDnech(RADKY), chyba: false }
const DNY = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']

const hosteDne = await nactiModul('app/[rozsah]/smeny/hoste-dne.tsx', [['next/link', ODKAZ]])
{
  const html = renderToStaticMarkup(createElement(hosteDne.SeznamHostu, { hoste: HOSTE, den: '2026-10-27', rozsah: 'firma' }))
  const radky = [...html.matchAll(/<li class="ds-hoste-radek" data-branch="([a-z]+)" data-pobocka="([^"]+)">([\s\S]*?)<\/li>/g)]
  ok('okénko: řádek za každou pobočku v její barvě', radky.length === 2 && radky.every(([, b, id]) => HOSTE.pobocky.find((p) => p.id === id)?.barva === b))
  ok(`Bernard: zkratka, název, „3 rezervace · 7 hostů + 1 bez počtu“ („${radky[0] ? text(radky[0][3]) : '—'}“)`,
    !!radky[0] && text(radky[0][3]) === 'BBT Bernard Bar Tábor 3 rezervace · 7 hostů + 1 bez počtu')
  ok(`Perla: „0 rezervací · 1 akce · 25 hostů“ („${radky[1] ? text(radky[1][3]) : '—'}“)`, !!radky[1] && text(radky[1][3]) === 'RČP Restaurace Černá Perla 0 rezervací · 1 akce · 25 hostů')
  ok('okénko: celkem za den a odkaz na den v Rezervacích', text(html).includes('Celkem: 3 rezervace · 1 akce · 32 hostů + 1 bez počtu') && html.includes('href="/firma/rezervace/den/2026-10-27"'))

  const prazdny = text(renderToStaticMarkup(createElement(hosteDne.SeznamHostu, { hoste: HOSTE, den: '2026-10-30', rozsah: 'firma' })))
  ok('den bez rezervací: „Bez rezervací“ u každé pobočky (ne prázdno)', (prazdny.match(/Bez rezervací/g) ?? []).length === 2)
  const chyba = text(renderToStaticMarkup(createElement(hosteDne.SeznamHostu, { hoste: { ...HOSTE, dny: {}, chyba: true }, den: '2026-10-27', rozsah: 'firma' })))
  ok('chyba načtení: řekne to, žádná čísla', chyba.includes('nepodařilo načíst') && !/\d+ host/.test(chyba))
  const jedna = text(renderToStaticMarkup(createElement(hosteDne.SeznamHostu, { hoste: { ...HOSTE, pobocky: [HOSTE.pobocky[1]] }, den: '2026-10-27', rozsah: 'cerna-perla' })))
  ok('jedna pobočka: bez řádku Celkem', !jedna.includes('Celkem'))
}

{
  const MrizkaTydne = (await nactiModul('app/[rozsah]/smeny/desktop/mrizka.tsx', [['next/link', ODKAZ]])).default
  const mrizka = sestavitMrizku({ smeny: [], dny: DNY, osoby: new Map(), useky: new Map(), pobocky: new Map(), lideBezSmeny: [], filtr: FILTR_DESKTOP_PRAZDNY })
  const vykreslit = (hoste) =>
    renderToStaticMarkup(
      createElement(MrizkaTydne, {
        mrizka, dny: DNY, dnesni: '2026-10-27', planovani: null, potvrzeni: null, poziceOsob: () => null, barvy: new Map(), jmena: new Map(),
        nazvyPobocek: new Map(), zkratkyPobocek: new Map(), pobockaProNovou: null, vybranaId: null, sbalene: new Set(), onPrepnout() {}, onOtevrit() {},
        filtrAktivni: false, onZrusitFiltry() {}, maSmeny: false, hoste, rozsahAdresa: 'firma',
      }),
    )
  const s = vykreslit(HOSTE)
  const zahlavi = [...s.matchAll(/<div role="columnheader" class="ds-smd-den"[^>]*data-hoste="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)]
  ok(`mřížka: každé záhlaví dne nese spouštěč okénka hostů (${zahlavi.length} ze 7)`, zahlavi.length === 7 && zahlavi.every(([, , v]) => v.includes('class="ds-hoste-spoustec"')))
  const ut = zahlavi.find(([, den]) => den === '2026-10-27')?.[2] ?? ''
  ok('úterý 27. 10.: spouštěč ukazuje „32 hostů“, je zavřený a říká souhrn i odečítači',
    text(ut).includes('32 hostů') && ut.includes('aria-expanded="false"') && ut.includes('aria-label="Hosté z rezervací, út 27. 10.: 3 rezervace · 1 akce · 32 hostů + 1 bez počtu"'))
  ok('zavřené okénko v HTML není (otevře ho až najetí, Tab nebo klepnutí)', !s.includes('ds-hoste-okno'))
  const bez = vykreslit(null)
  ok('bez práva na rezervace: záhlaví dnů beze změny, žádný spouštěč', !bez.includes('ds-hoste') && (bez.match(/class="ds-smd-den"/g) ?? []).length === 7)
}

{
  const { DenPrehled } = await nactiModul('app/[rozsah]/smeny/mobil/pohledy.tsx', [['next/link', ODKAZ]])
  const nic = () => {}
  const vykreslit = (hoste, den = '2026-10-27') =>
    renderToStaticMarkup(
      createElement(DenPrehled, {
        den, dnes: '2026-10-27', smeny: [], filtr: FILTR_PRAZDNY, jeVedouci: true, hoste, rozsah: 'firma',
        ctx: { dnesni: '2026-10-27', osoby: new Map(), useky: new Map(), pobocky: new Map(), pozice: new Map(), tvurci: new Map(), vicePobocek: false },
        onVybratDen: nic, onTyden: nic, onOtevritSmenu: nic, onPridat: nic, onFiltry: nic, onZrusitFiltr: nic, onZobrazitNeobsazene: nic,
      }),
    )
  const s = vykreslit(HOSTE)
  const radek = s.match(/<section class="ds-hoste-mobil" aria-label="Hosté z rezervací" data-hoste="([^"]+)">([\s\S]*?)<\/section>/)
  ok('telefon: denní přehled má hosty vybraného dne v toku stránky (sekce, ne plovoucí okénko)', radek?.[1] === '2026-10-27' && !s.includes('ds-hoste-okno'))
  const [iHlava, iHoste, iSmeny] = [s.indexOf('class="ds-sm-hlava"'), s.indexOf('class="ds-hoste-mobil"'), s.indexOf('nejsou naplánované žádné směny')]
  ok('telefon: řádek stojí pod hlavičkou dne, před seznamem směn', iHlava >= 0 && iHlava < iHoste && iSmeny > iHoste)
  ok('telefon: obě pobočky se zkratkou a počty', !!radek && text(radek[2]).includes('BBT Bernard Bar Tábor 3 rezervace') && text(radek[2]).includes('RČP Restaurace Černá Perla 0 rezervací · 1 akce · 25 hostů'))
  ok('telefon: jiný vybraný den = jeho čísla', text(vykreslit(HOSTE, '2026-10-28')).includes('1 akce · 40 hostů'))
  ok('telefon bez práva: nic', !vykreslit(null).includes('ds-hoste'))
}

console.log(chyb ? `\n${chyb} kontrol NEPROŠLO\n` : '\nVšechny kontroly prošly.\n')
process.exit(chyb ? 1 : 0)
