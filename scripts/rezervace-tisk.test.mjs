#!/usr/bin/env node
/**
 * Tisk přehledu akcí a rezervací (Šéfík 25. 11. 2026: tlačítko v Rozpisu
 * a v Rezervacích, kterým si vytiskne přehled akcí).
 *
 * Pusť `node scripts/rezervace-tisk.test.mjs`.
 *
 *   1. ČISTÉ FUNKCE (lib/rezervace-tisk.ts): období a volby z adresy,
 *      odkaz zpátky (jen do Rezervací / Rozpisu téhož rozsahu), názvy
 *      období, sestavení přehledu (pořadí, provozní den, zrušené, jen
 *      akce, stůl/prostor, poznámky);
 *   2. KDO CO UVIDÍ — SPOUŠTÍ se skutečná tisková stránka
 *      (rezervace/tisk/page.tsx) se skutečným přístupem (pristup.ts)
 *      a skutečným načtením (data.ts). Podstrčená je jen databáze
 *      (filtruje řádky podle podmínek dotazu) a odpovědi na práva.
 *      Bez práva žádný dotaz; rozsah a `?pobocky=` jen zúží; telefon jen
 *      z poboček s `rezervace.manage`; strop řádků = žádný zkrácený list;
 *   3. VYKRESLENÍ listu (skutečný tisk/obsah.tsx): co je v řádku, v listu
 *      žádné ovládání;
 *   4. TLAČÍTKA: kalendář Rezervací (prvky.tsx, `NastrojePohledu`) a celý
 *      Rozpis směn (rozpis.tsx) vedou na tisk TÉHOŽ období, které ukazují;
 *   5. PAPÍR (app/_tisk.css): bez navigace a ovládání, A4, jen černá a bílá.
 *
 * Jak to vypadá na papíře, ukazují snímky tiskového náhledu v PR
 * (headless Chrome, `Emulation.setEmulatedMedia` print + `Page.printToPDF`).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  NEJDELSI_OBDOBI,
  PRAZDNE_DNY_DO,
  adresaTisku,
  dnyObdobi,
  nazevObdobi,
  obdobiTiskuZPohledu,
  obdobiTiskuZRozpisu,
  polozkaTisku,
  volbyZAdresy,
  zpatkyZTisku,
} from '../lib/rezervace-tisk.ts'
import { adresaModulu, nactiModul } from './vykreslit.mjs'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8').replace(/\r\n/g, '\n')
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
/** Kontrola, která může vyhodit — výjimka ji shodí, ale další kontroly poběží. */
async function zkus(popis, fn) {
  try {
    ok(popis, await fn())
  } catch (e) {
    ok(`${popis} — vyhodilo: ${e?.message ?? e}`, false)
  }
}

const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CIZI = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const VETVE = [
  { id: B, name: 'Bernard Bar Tábor', slug: 'bernard-bar', color: 'rose', timezone: 'Europe/Prague' },
  { id: P, name: 'Restaurace Černá Perla', slug: 'cerna-perla', color: 'rose', timezone: 'Europe/Prague' },
]

/* Řádek tabulky `rezervace` tak, jak je v databázi (i s vnořenými poznámkami a kontaktem). */
const R = (id, branch_id, den, zacatek, o = {}) => ({
  id, branch_id, den, druh: 'rezervace', stav: 'potvrzeno', nazev: '', jmeno_hosta: '', zacatek, konec: null, pocet_osob: 2,
  prostor: '', typ_akce: '', zdroj: 'rucne', misto_zdroje: '', prani_zdroje: '', prostor_ze_zdroje: false, menu: '', poznamka_zdroje: '',
  tenant_id: 't1', rezervace_poznamky: [], rezervace_kontakty: null, ...o,
})
const RB1 = R('r-b1', B, '2026-11-27', '2026-11-27T18:30:00+00:00', {
  pocet_osob: 4, jmeno_hosta: 'Jana Nováková', prostor: 'Okno', poznamka_zdroje: 'dětská židlička',
  rezervace_poznamky: [{ nadpis: 'Alergie', obsah: 'lepek', vytvoreno_kdy: '2026-11-20T10:00:00+00:00' }],
  rezervace_kontakty: { telefon: '+420 777 111 222' },
})
const RB2 = R('r-b2', B, '2026-11-27', '2026-11-27T16:00:00+00:00', {
  druh: 'akce', stav: 'ceka', konec: '2026-11-27T22:00:00+00:00', pocet_osob: 40, nazev: 'Firemní večírek Alfa', typ_akce: 'Firemní večírek',
  jmeno_hosta: 'Petr Dvořák', prostor: 'Salonek', menu: 'Raut A',
  rezervace_poznamky: [
    { nadpis: '', obsah: 'Dort v 21:00', vytvoreno_kdy: '2026-11-22T10:00:00+00:00' },
    { nadpis: 'Kapela', obsah: 'od 19:00', vytvoreno_kdy: '2026-11-21T10:00:00+00:00' },
  ],
  rezervace_kontakty: { telefon: '+420 777 333 444' },
})
const RB3 = R('r-b3', B, '2026-11-28', '2026-11-28T19:00:00+00:00', { stav: 'zrusena', pocet_osob: 6, jmeno_hosta: 'Zrušený Host' })
// Z Choice: stoly ze zdroje, prostor doplnil zdroj (přání hosta), počet neznámý.
const RB4 = R('r-b4', B, '2026-11-28', '2026-11-28T19:00:00+00:00', {
  pocet_osob: null, jmeno_hosta: 'Karel Choice', zdroj: 'externi', misto_zdroje: 'Patro: S1–S3', prani_zdroje: 'Patro', prostor: 'Patro', prostor_ze_zdroje: true,
})
// Začátek v 1:30 v noci na 29. — provozní den je 28. (počítá ho databáze, `den`).
const RB5 = R('r-b5', B, '2026-11-28', '2026-11-29T00:30:00+00:00', { pocet_osob: 2, jmeno_hosta: 'Noční Host' })
const RP1 = R('r-p1', P, '2026-11-27', '2026-11-27T11:00:00+00:00', {
  druh: 'akce', pocet_osob: 25, typ_akce: 'Svatba', jmeno_hosta: 'Novákovi', rezervace_kontakty: { telefon: '+420 608 000 111' },
})
// Mimo týden (pondělí dalšího) — databáze ho do týdne nevydá.
const RX = R('r-x', B, '2026-11-30', '2026-11-30T17:00:00+00:00', { jmeno_hosta: 'Příští Týden' })
// Jiná firma, stejná pobočka v podstrčené databázi — dotaz bez tenant_id by ji vytáhl.
const RCIZI = R('r-cizi', B, '2026-11-27', '2026-11-27T17:00:00+00:00', { tenant_id: 't-jina', jmeno_hosta: 'Cizí Firma' })
const REZERVACE = [RB1, RB2, RB3, RB4, RB5, RP1, RX, RCIZI]

const PZ = (branch_id, den, nadpis, obsah, o = {}) => ({ tenant_id: 't1', branch_id, rezervace_id: null, den, nadpis, obsah, vytvoreno_kdy: '2026-11-24T10:00:00+00:00', ...o })
const POZNAMKY = [
  PZ(B, '2026-11-27', 'Sál', 'zavřený od 22:00'),
  PZ(P, '2026-11-27', '', 'Perla: kapela od 20:00'),
  // Poznámka k rezervaci (den null) — mezi poznámky ke dni nepatří.
  PZ(B, null, '', 'K rezervaci, ne ke dni', { rezervace_id: 'r-b1' }),
]

/* ---------------------------------------------------------------------
 * 1. Čisté funkce
 * ------------------------------------------------------------------ */

console.log('\n== 1. Období, volby, odkaz zpátky, sestavení ==\n')
{
  const t = volbyZAdresy({}, '2026-11-25')
  ok(`bez od/do = tento týden po–ne (${t?.od}–${t?.do})`, t?.od === '2026-11-23' && t?.do === '2026-11-29' && t.pobocky.length === 0 && !t.jenAkce && !t.sZrusenymi)
  const v = volbyZAdresy({ od: '2026-11-01', do: '2026-11-30', co: 'akce', zrusene: '1', pobocky: `${B},${P}`, zpet: '/firma/rezervace' }, '2026-11-25')
  ok('volby z adresy: období, jen akce, i zrušené, pobočky, zpět', v?.od === '2026-11-01' && v.do === '2026-11-30' && v.jenAkce && v.sZrusenymi && v.pobocky.join() === `${B},${P}` && v.zpet === '/firma/rezervace')
  ok('neplatné datum (30. 2.) → null', volbyZAdresy({ od: '2026-02-30', do: '2026-03-01' }, '2026-11-25') === null)
  ok('jen jeden konec období → null (ne „tento týden“)', volbyZAdresy({ od: '2026-11-23' }, '2026-11-25') === null)
  ok('konec před začátkem → null', volbyZAdresy({ od: '2026-11-29', do: '2026-11-23' }, '2026-11-25') === null)
  ok(`nejvýš ${NEJDELSI_OBDOBI} dní: 62 ano, 63 ne`,
    volbyZAdresy({ od: '2026-11-01', do: '2027-01-01' }, '2026-11-25') !== null && volbyZAdresy({ od: '2026-11-01', do: '2027-01-02' }, '2026-11-25') === null)
  ok('parametr v adrese dvakrát (Next dá pole) → null', volbyZAdresy({ od: ['2026-11-23', '2026-11-24'], do: '2026-11-29' }, '2026-11-25') === null)
  ok('pobočky, které nejsou id, → null (ne potichu „všechny“)',
    volbyZAdresy({ od: '2026-11-23', do: '2026-11-29', pobocky: 'perla' }, '2026-11-25') === null
    && volbyZAdresy({ od: '2026-11-23', do: '2026-11-29', pobocky: '' }, '2026-11-25') === null
    && volbyZAdresy({ od: '2026-11-23', do: '2026-11-29', pobocky: [B, P] }, '2026-11-25') === null)

  const adresa = adresaTisku('firma', { od: '2026-11-23', do: '2026-11-29', pobocky: [B], zpet: '/firma/smeny?pohled=tyden&den=2026-11-23', hned: true })
  const zpet = volbyZAdresy(Object.fromEntries(new URL(adresa, 'https://foodtab.test').searchParams), '2026-01-01')
  ok('adresa tisku se přečte zpátky beze změny (období, pobočka, zpět s & uvnitř)',
    adresa.startsWith('/firma/rezervace/tisk?') && zpet?.od === '2026-11-23' && zpet.do === '2026-11-29' && zpet.pobocky.join() === B && zpet.zpet === '/firma/smeny?pohled=tyden&den=2026-11-23')
  ok('výchozí volby se do adresy nepíšou', adresaTisku('perla', { od: '2026-11-27', do: '2026-11-27' }) === '/perla/rezervace/tisk?od=2026-11-27&do=2026-11-27')

  const kam = (z) => zpatkyZTisku('perla', z, '2026-11-23')
  ok('zpět do Rezervací téhož rozsahu', kam('/perla/rezervace?pohled=mesic&datum=2026-11-25').href === '/perla/rezervace?pohled=mesic&datum=2026-11-25' && kam('/perla/rezervace/den/2026-11-27').text === 'Zpět do Rezervací')
  ok('zpět na Rozpis směn téhož rozsahu', kam('/perla/smeny?pohled=tyden&den=2026-11-23').href === '/perla/smeny?pohled=tyden&den=2026-11-23' && kam('/perla/smeny').text === 'Zpět na Rozpis směn')
  const VYCHOZI = '/perla/rezervace?pohled=tyden&datum=2026-11-23'
  const zle = ['https://zly.example', '//zly.example', '/jina/rezervace', '/jina/smeny', '/perla/smenyx', '/perla/smeny/../../k/abc', '/perla/smeny/%2e%2e/x',
    '/perla/rezervace/../../k/abc', '/perla/rezervace/tisk?od=2026-11-23&do=2026-11-29', '/perla/dochazka', '', null]
  const prosle = zle.filter((z) => kam(z).href !== VYCHOZI)
  ok(`zpět ven, o složku výš, do jiného rozsahu ani na tisk sám nevede (prošlo: ${JSON.stringify(prosle)})`, prosle.length === 0)

  ok(`název období: den, týden, měsíc, jinak rozsah dnů („${nazevObdobi('2026-11-25', '2026-12-01')}“)`,
    nazevObdobi('2026-11-27', '2026-11-27') === 'Pátek 27. listopadu 2026'
    && nazevObdobi('2026-11-23', '2026-11-29') === 'Týden 23. 11. – 29. 11. 2026'
    && nazevObdobi('2026-11-01', '2026-11-30') === 'Listopad 2026'
    && nazevObdobi('2026-11-25', '2026-12-01') === '25. 11. – 1. 12. 2026'
    && nazevObdobi('2026-12-30', '2027-01-02') === '30. 12. 2026 – 2. 1. 2027')

  const mesic = obdobiTiskuZPohledu('mesic', '2026-02-14')
  ok(`Rezervace: měsíc = jen jeho dny, ne sousední z mřížky (${mesic.od}–${mesic.do})`, mesic.od === '2026-02-01' && mesic.do === '2026-02-28')
  const tyden = obdobiTiskuZPohledu('tyden', '2026-11-25')
  ok('Rezervace: týden po–ne, den = ten den', tyden.od === '2026-11-23' && tyden.do === '2026-11-29' && obdobiTiskuZPohledu('den', '2026-11-27').od === '2026-11-27')

  const r7 = obdobiTiskuZRozpisu('sedm', '2026-11-25', '2026-11-25')
  ok(`Rozpis: 7 dní od zvoleného dne (${r7.od}–${r7.do})`, r7.od === '2026-11-25' && r7.do === '2026-12-01')
  const rt = obdobiTiskuZRozpisu('tyden', '2026-11-25', '2026-11-23')
  ok('Rozpis: týden od pondělí okna, měsíc i měsíc lidí celý měsíc, den ten den',
    rt.od === '2026-11-23' && rt.do === '2026-11-29'
    && obdobiTiskuZRozpisu('mesic', '2026-11-25', '2026-11-25').do === '2026-11-30' && obdobiTiskuZRozpisu('osoby', '2026-11-25', '2026-11-25').od === '2026-11-01'
    && obdobiTiskuZRozpisu('den', '2026-11-25', '2026-11-25').do === '2026-11-25')

  ok('dny období včetně obou konců', dnyObdobi('2026-11-28', '2026-12-01').join() === '2026-11-28,2026-11-29,2026-11-30,2026-12-01')

  // Sestavení přímo (řádky jako po načtení: zóna pobočky, bez tenant_id).
  const kTisku = (r) => ({ ...r, zona: 'Europe/Prague', poznamky: r.rezervace_poznamky })
  const p = polozkaTisku(kTisku(RB2), '')
  ok(`akce: čas v pásmu pobočky 17:00–23:00, název, popis „${p.popis}“`, p.cas === '17:00–23:00' && p.nazev === 'Firemní večírek Alfa' && p.popis === 'Akce · Firemní večírek · Předběžná')
  ok(`poznámky obsluhy podle vzniku, pak menu (${JSON.stringify(p.poznamky)})`, JSON.stringify(p.poznamky) === JSON.stringify(['Kapela: od 19:00', 'Dort v 21:00', 'Menu: Raut A']))
  const r1 = polozkaTisku(kTisku(RB1), '')
  ok(`rezervace bez názvu: „Rezervace“, bez opakování druhu v popisu, kontakt = host (${JSON.stringify(r1)})`,
    r1.nazev === 'Rezervace' && r1.popis === '' && r1.kontakt === 'Jana Nováková' && r1.hoste === '4' && r1.misto === 'Okno' && r1.telefon === '')
  ok('poznámka hosta ze zdroje se tiskne s popiskem', r1.poznamky.join(' | ') === 'Alergie: lepek | Poznámka hosta: dětská židlička')
  const c = polozkaTisku(kTisku(RB4), '')
  ok(`Choice: stoly ze zdroje místo přání (${c.misto}), počet neuvedený „—“`, c.misto === 'Patro: S1–S3' && c.hoste === '—')
  const s = polozkaTisku(kTisku(RP1), '')
  ok('akce bez názvu se jmenuje typem akce („Svatba“), popis jen „Akce“', s.nazev === 'Svatba' && s.popis === 'Akce')
  ok('telefon jen ten, který přišel (polozkaTisku sám nic nepovolí)', polozkaTisku(kTisku(RB1), ' +420 1 ').telefon === '+420 1')
}

/* ---------------------------------------------------------------------
 * 2. Kdo co uvidí — skutečná stránka
 * ------------------------------------------------------------------ */

console.log('\n== 2. Kdo co uvidí — tisk/page.tsx, pristup.ts, data.ts se SPOUŠTĚJÍ ==\n')

/** Vrchní sloupce ze `select` („id, x(a, b), y“ → id, x, y). */
function sloupce(select) {
  const ven = []
  let hloubka = 0
  let kus = ''
  for (const z of select) {
    if (z === '(') hloubka++
    if (z === ')') hloubka--
    if (z === ',' && hloubka === 0) {
      ven.push(kus)
      kus = ''
    } else kus += z
  }
  ven.push(kus)
  return ven.map((k) => k.trim().replace(/\(.*$/s, '').trim()).filter(Boolean)
}

/**
 * Podstrčená databáze. Zapíše dotaz a vydá řádky tabulky, které splní
 * jeho podmínky (eq, in, gte, lte, limit) — jen sloupce, o které si řekl.
 * RLS nedělá: tady se zkouší první linie (o co se stránka ptá).
 */
function databaze() {
  return {
    from(tabulka) {
      const dotaz = { tabulka, select: '', podminky: [] }
      globalThis.__tDotazy.push(dotaz)
      const q = {
        select(s) { dotaz.select = s; return q },
        eq(k, v) { dotaz.podminky.push(['eq', k, v]); return q },
        in(k, v) { dotaz.podminky.push(['in', k, v]); return q },
        gte(k, v) { dotaz.podminky.push(['gte', k, v]); return q },
        lte(k, v) { dotaz.podminky.push(['lte', k, v]); return q },
        order() { return q },
        limit(n) { dotaz.podminky.push(['limit', n]); return q },
        then(hotovo, chyba) {
          const vynuceno = globalThis.__tChyba?.(dotaz)
          if (vynuceno) return Promise.resolve({ data: null, error: vynuceno }).then(hotovo, chyba)
          let radky = (globalThis.__tTabulky[tabulka] ?? []).filter((r) =>
            dotaz.podminky.every(([op, k, v]) =>
              op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'gte' ? r[k] != null && r[k] >= v : op === 'lte' ? r[k] != null && r[k] <= v : true,
            ),
          )
          const limit = dotaz.podminky.find(([op]) => op === 'limit')
          if (limit) radky = radky.slice(0, limit[1])
          const chci = sloupce(dotaz.select)
          return Promise.resolve({ data: radky.map((r) => Object.fromEntries(chci.map((k) => [k, r[k]]))), error: null }).then(hotovo, chyba)
        },
      }
      return q
    },
  }
}
globalThis.__tDatabaze = databaze

const PRAZDNY = js('')
const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
const NAVIGACE_SERVER = js('export function redirect(kam) { throw { presmerovano: kam } }\n')
const AUTHZ = js('export async function hasAccess(t, pravo, pobocka) { return globalThis.__tPrava.some(([p, b]) => p === pravo && b === pobocka) }\n')
const FIRMA = js(
  'export async function getCurrentTenantId() { return globalThis.__tTenant }\n' +
    'export async function zkusPristup(t, pravo, rozsah) { return globalThis.__tPristup(pravo, rozsah) }\n',
)
const SUPABASE = js('export async function getServerSupabase() { return globalThis.__tDatabaze() }\n')
const PROVOZNI_DEN = js('export async function provozniDen(pobocka) { globalThis.__tProvozni.push(pobocka); return "2026-11-25" }\n')
const PRIHLASENI = js('export async function odkazNaPrihlaseni() { return "/prihlaseni?dal=tisk" }\n')

const DOTAZ = adresaModulu('lib/supabase/dotaz.ts', [['server-only', PRAZDNY]])
const PRISTUP = adresaModulu('app/[rozsah]/rezervace/pristup.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
])
const DATA = adresaModulu('app/[rozsah]/rezervace/data.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SUPABASE],
])
const stranka = await nactiModul('app/[rozsah]/rezervace/tisk/page.tsx', [
  ['next/link', ODKAZ],
  ['next/navigation', NAVIGACE_SERVER],
  ['@/lib/firma', FIRMA],
  ['@/lib/prihlaseni-adresa', PRIHLASENI],
  ['../data', DATA],
  ['../pristup', PRISTUP],
])

const FIRMA_S = { level: 'tenant', branchId: null }
const PLNA = [['rezervace.read', B], ['rezervace.manage', B], ['rezervace.read', P]]
const JEN_CTENI = [['rezervace.read', B], ['rezervace.read', P]]

async function tisk({ rozsah = 'firma', hledani = { od: '2026-11-23', do: '2026-11-29' }, prava = PLNA, pristupJen = null, scope = FIRMA_S, tenant = 't1', stav = 'ok', tabulky = null, chyba = null } = {}) {
  globalThis.__tDotazy = []
  globalThis.__tProvozni = []
  globalThis.__tPrava = prava
  globalThis.__tTenant = tenant
  globalThis.__tChyba = chyba
  globalThis.__tTabulky = tabulky ?? { rezervace: REZERVACE, rezervace_poznamky: POZNAMKY }
  globalThis.__tPristup = (pravo) =>
    stav !== 'ok' ? { stav } : pristupJen && !pristupJen.includes(pravo) ? { stav: 'odepren' } : { stav: 'ok', ctx: { branches: VETVE }, scope }
  const vysledek = { html: '', dotazy: globalThis.__tDotazy, provozni: globalThis.__tProvozni, presmerovani: null, vyjimka: null }
  try {
    const prvek = await stranka.default({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(hledani) })
    vysledek.html = renderToStaticMarkup(prvek)
  } catch (e) {
    if (e && typeof e === 'object' && 'presmerovano' in e) vysledek.presmerovani = e.presmerovano
    else vysledek.vyjimka = e
  }
  return vysledek
}
const naRezervace = (v) => v.dotazy.filter((d) => d.tabulka.startsWith('rezervace'))
const podminka = (d, op, k) => d?.podminky.find(([o, kk]) => o === op && kk === k)?.[2]
const hlavni = (v) => v.dotazy.find((d) => d.tabulka === 'rezervace' && d.select.includes('menu'))
const telefonni = (v) => v.dotazy.find((d) => d.select.includes('rezervace_kontakty'))

await zkus('bez práva na rezervace: sdělení „nemáte oprávnění“, ŽÁDNÝ dotaz do databáze (ani provozní den)', async () => {
  const v = await tisk({ pristupJen: [] })
  return v.html.includes('Na tohle nemáte oprávnění') && v.dotazy.length === 0 && v.provozni.length === 0
})
await zkus('právo za firmu, ale na žádné pobočce: odepřeno, žádný dotaz', async () => {
  const v = await tisk({ prava: [] })
  return v.html.includes('Na tohle nemáte oprávnění') && v.dotazy.length === 0
})
await zkus('nepřihlášený: přesměrování na přihlášení, žádný dotaz', async () => {
  const v = await tisk({ stav: 'neprihlasen' })
  return v.presmerovani === '/prihlaseni?dal=tisk' && v.dotazy.length === 0
})
await zkus('účet bez firmy: sdělení, žádný dotaz', async () => {
  const v = await tisk({ tenant: null })
  return v.html.includes('nepatří k žádné firmě') && v.dotazy.length === 0 && v.provozni.length === 0
})

await zkus('plné právo na firmě: rezervace, poznámky ke dnům a telefony — vždy firma, pobočky s právem a období', async () => {
  const v = await tisk()
  const d = naRezervace(v)
  return d.length === 3 && d.every((x) => podminka(x, 'eq', 'tenant_id') === 't1' && podminka(x, 'gte', 'den') === '2026-11-23' && podminka(x, 'lte', 'den') === '2026-11-29')
    && JSON.stringify(podminka(hlavni(v), 'in', 'branch_id')) === JSON.stringify([B, P])
})
await zkus('hlavní dotaz nenese kontakty (telefon ani e-mail)', async () => {
  const v = await tisk()
  return !!hlavni(v) && !/kontakt|telefon|email/.test(hlavni(v).select)
})
await zkus('telefony jen z poboček s rezervace.manage (Bernard), ne z Perly', async () => {
  const v = await tisk()
  return JSON.stringify(podminka(telefonni(v), 'in', 'branch_id')) === JSON.stringify([B])
    && v.html.includes('+420 777 111 222') && v.html.includes('+420 777 333 444') && !v.html.includes('+420 608 000 111')
})
await zkus('jen čtení všude: na telefony se neptá vůbec a žádný se netiskne', async () => {
  const v = await tisk({ prava: JEN_CTENI })
  return !telefonni(v) && naRezervace(v).length === 2 && !v.html.includes('+420') && v.html.includes('Jana Nováková')
})
await zkus('pobočkový rozsah (Perla): jen Perla v dotazech i v listu, i když člověk vidí obě', async () => {
  const v = await tisk({ rozsah: 'cerna-perla', scope: { level: 'branch', branchId: P } })
  return naRezervace(v).every((d) => JSON.stringify(podminka(d, 'in', 'branch_id')) === JSON.stringify([P]))
    && v.html.includes('Novákovi') && !v.html.includes('Jana Nováková') && !v.html.includes('Bernard Bar')
})
await zkus('právo jen na Perlu (firma): Bernard se nečte ani netiskne', async () => {
  const v = await tisk({ prava: [['rezervace.read', P]] })
  return naRezervace(v).every((d) => !(podminka(d, 'in', 'branch_id') ?? []).includes(B)) && !v.html.includes('Jana Nováková') && v.html.includes('Novákovi')
})
await zkus('kdo jen spravuje (rezervace.manage), tiskne taky — i s telefonem své pobočky', async () => {
  const v = await tisk({ prava: [['rezervace.manage', P]], pristupJen: ['rezervace.manage'] })
  return v.html.includes('Novákovi') && v.html.includes('+420 608 000 111') && !v.html.includes('Jana Nováková')
})
await zkus('?pobocky=Bernard na firmě: jen Bernard (dotazy i list)', async () => {
  const v = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', pobocky: B } })
  return naRezervace(v).every((d) => JSON.stringify(podminka(d, 'in', 'branch_id')) === JSON.stringify([B])) && !v.html.includes('Novákovi') && v.html.includes('Jana Nováková')
})
await zkus('?pobocky= pobočka bez práva: sdělení, na rezervace se neptá', async () => {
  const v = await tisk({ prava: [['rezervace.read', P]], hledani: { od: '2026-11-23', do: '2026-11-29', pobocky: B } })
  return v.html.includes('Rezervace téhle pobočky nevidíte') && naRezervace(v).length === 0
})
await zkus('?pobocky= pobočka jiné firmy: sdělení, na rezervace se neptá', async () => {
  const v = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', pobocky: CIZI } })
  return v.html.includes('Rezervace téhle pobočky nevidíte') && naRezervace(v).length === 0
})
await zkus('?pobocky=Bernard,Perla na pobočkovém rozsahu Perly: jen Perla (výběr rozsah nerozšíří)', async () => {
  const v = await tisk({ rozsah: 'cerna-perla', scope: { level: 'branch', branchId: P }, hledani: { od: '2026-11-23', do: '2026-11-29', pobocky: `${B},${P}` } })
  return naRezervace(v).length > 0 && naRezervace(v).every((d) => JSON.stringify(podminka(d, 'in', 'branch_id')) === JSON.stringify([P]))
})
await zkus('neplatné období: sdělení, na rezervace se neptá', async () => {
  const v = await tisk({ hledani: { od: '2026-11-01', do: '2027-02-01' } })
  return v.html.includes('Tohle období vytisknout nejde') && naRezervace(v).length === 0
})
await zkus('bez od/do: tento týden podle provozního dne první pobočky', async () => {
  const v = await tisk({ hledani: {} })
  return v.provozni.join() === B && podminka(hlavni(v), 'gte', 'den') === '2026-11-23' && podminka(hlavni(v), 'lte', 'den') === '2026-11-29'
})
// Strop: vždy přeteče JEN JEDEN dotaz (jen čtení = na telefony se neptá),
// ať každou podmínku stropu drží její vlastní kontrola.
await zkus('víc rezervací než strop: sdělení „moc“, ŽÁDNÝ zkrácený list (dotaz si řekne o strop + 1)', async () => {
  const mnoho = Array.from({ length: 3001 }, (_, i) => R(`m${i}`, B, '2026-11-27', '2026-11-27T18:00:00+00:00'))
  const v = await tisk({ prava: JEN_CTENI, tabulky: { rezervace: mnoho, rezervace_poznamky: [] } })
  return v.html.includes('Na jeden přehled je toho moc') && !v.html.includes('ds-tisk-list') && !telefonni(v)
    && hlavni(v).podminky.some(([o, n]) => o === 'limit' && n === 3001)
})
await zkus('víc poznámek ke dnům než strop: taky sdělení „moc“, ne zkrácený list', async () => {
  const mnoho = Array.from({ length: 3001 }, (_, i) => PZ(B, '2026-11-27', '', `poznámka ${i}`))
  const v = await tisk({ prava: JEN_CTENI, tabulky: { rezervace: REZERVACE, rezervace_poznamky: mnoho } })
  return v.html.includes('Na jeden přehled je toho moc') && !v.html.includes('ds-tisk-list')
})
// Chyba každého ze tří dotazů zvlášť — výjimka musí jmenovat PRÁVĚ ten dotaz.
const ODEPRENO = { code: '42501', message: 'permission denied' }
const chybaDotazu = async (ktery) => {
  const v = await tisk({ chyba: (d) => (ktery(d) ? ODEPRENO : null) })
  return { zprava: String(v.vyjimka?.message ?? ''), html: v.html }
}
await zkus('chyba dotazu na rezervace se nespolkne (výjimka „rezervace k tisku“), nevytiskne se prázdný list', async () => {
  const c = await chybaDotazu((d) => d.tabulka === 'rezervace' && d.select.includes('menu'))
  return c.zprava.includes('„rezervace k tisku“') && c.html === ''
})
await zkus('chyba dotazu na poznámky ke dnům se nespolkne (výjimka „poznámky ke dnům k tisku“)', async () => {
  const c = await chybaDotazu((d) => d.tabulka === 'rezervace_poznamky')
  return c.zprava.includes('„poznámky ke dnům k tisku“') && c.html === ''
})
await zkus('chyba dotazu na telefony se nespolkne (výjimka „telefony k tisku“), netiskne se bez nich', async () => {
  const c = await chybaDotazu((d) => d.select.includes('rezervace_kontakty'))
  return c.zprava.includes('„telefony k tisku“') && c.html === ''
})
await zkus('cizí firma v téže pobočce (jiný tenant_id) se netiskne', async () => {
  const v = await tisk()
  return !v.html.includes('Cizí Firma') && !v.html.includes('Příští Týden')
})
await zkus('zpět z Rozpisu → „Zpět na Rozpis směn“; zpět ven → do Rezervací a cizí adresa se do stránky nevrátí (ani do skrytého pole)', async () => {
  const z = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', zpet: '/firma/smeny?pohled=tyden&den=2026-11-23' } })
  const ven = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', zpet: 'https://zly.example' } })
  return z.html.includes('href="/firma/smeny?pohled=tyden&amp;den=2026-11-23"') && z.html.includes('Zpět na Rozpis směn')
    && ven.html.includes('href="/firma/rezervace?pohled=tyden&amp;datum=2026-11-23"') && !ven.html.includes('zly.example')
})

{
  // Data jdou JEN uživatelským klientem — služební klíč by obešel RLS.
  const soubory = ['app/[rozsah]/rezervace/tisk/page.tsx', 'app/[rozsah]/rezervace/tisk/obsah.tsx', 'app/[rozsah]/rezervace/tisk/tlacitko.tsx', 'app/[rozsah]/rezervace/data.ts']
  const podezrele = soubory.filter((f) => {
    const s = cti(f)
    const supabase = [...s.matchAll(/from ['"](@\/lib\/supabase\/[^'"]+|@supabase\/[^'"]+)['"]/g)].map((m) => m[1])
    return /service_role|SERVICE_ROLE/i.test(s) || supabase.some((m) => m !== '@/lib/supabase/server' && m !== '@/lib/supabase/dotaz')
  })
  ok(`tisk čte jen uživatelským klientem (getServerSupabase), žádný služební klíč (podezřelé: ${JSON.stringify(podezrele)})`, podezrele.length === 0)
}

/* ---------------------------------------------------------------------
 * 3. Vykreslení listu
 * ------------------------------------------------------------------ */

console.log('\n== 3. Vykreslení listu (skutečný tisk/obsah.tsx) ==\n')
{
  const v = await tisk()
  const html = v.html
  const list = html.match(/<article class="ds-tisk-list"[\s\S]*<\/article>/)?.[0] ?? ''
  const ovladani = html.match(/<div class="ds-tisk-ovladani">[\s\S]*?<\/form>/)?.[0] ?? ''
  /** Oddíl pobočky podle aria-label. */
  const oddil = (nazev) => list.match(new RegExp(`<section class="ds-tisk-oddil" aria-label="${nazev}">([\\s\\S]*?)</section></section>(?=<section class="ds-tisk-oddil"|<footer)`))?.[1] ?? ''
  const den = (o, nadpis) => o.match(new RegExp(`<section class="ds-tisk-den"><h[23] class="ds-tisk-den-nadpis">${nadpis}[\\s\\S]*?(?=<section class="ds-tisk-den">|$)`))?.[0] ?? ''
  const radky = (h) => [...h.matchAll(/<tr( data-zrusena="")?>([\s\S]*?)<\/tr>/g)].filter(([, , r]) => r.includes('<td')).map(([, z, r]) => ({ zrusena: !!z, bunky: [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1])) }))
  const bernard = oddil('Bernard Bar Tábor')
  const perla = oddil('Restaurace Černá Perla')
  const b27 = radky(den(bernard, 'Pátek 27. listopadu 2026'))
  const b28 = radky(den(bernard, 'Sobota 28. listopadu 2026'))

  ok('kořen stránky je .ds-tisk (tisková pravidla podle něj schovají zbytek <main>)', html.startsWith('<div class="ds-tisk">'))
  ok('v listu žádné tlačítko, formulář, pole ani odkaz', list.length > 0 && !/<(button|form|input|a)[\s>]/.test(list))
  ok('ovládání: Zpět, Vytisknout, volby se skrytým obdobím',
    ovladani.includes('Zpět do Rezervací') && /<button[^>]*>.*Vytisknout<\/button>/s.test(ovladani)
    && ovladani.includes('name="od" value="2026-11-23"') && ovladani.includes('name="do" value="2026-11-29"'))
  ok(`záhlaví: nadpis, týden, obě pobočky, bez zrušených s počtem („${text(list.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '')}“)`,
    /^Přehled akcí a rezervací Týden 23\. 11\. – 29\. 11\. 2026 Bernard Bar Tábor, Restaurace Černá Perla · Akce i rezervace · bez zrušených a nedorazivších \(1 vynechaná\) · stav k \d/.test(text(list.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '')))
  ok('dvě pobočky: každá svůj oddíl s nadpisem (h2), dny pod ním (h3)', bernard.includes('<h2 class="ds-tisk-pobocka">Bernard Bar Tábor') && perla.includes('<h2 class="ds-tisk-pobocka">Restaurace Černá Perla') && bernard.includes('<h3 class="ds-tisk-den-nadpis">'))
  ok('sloupce: Čas, Akce / rezervace, Hosté, Stůl / prostor, Kontakt, Poznámka',
    text(list.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '') === 'Čas Akce / rezervace Hosté Stůl / prostor Kontakt Poznámka')
  ok(`Bernard 27. 11.: akce 17:00 před rezervací 19:30 (${b27.map((r) => r.bunky[0]).join(', ')})`, b27.length === 2 && b27[0].bunky[0] === '17:00–23:00' && b27[1].bunky[0] === '19:30')
  ok(`akce: celý řádek (${JSON.stringify(b27[0]?.bunky)})`,
    JSON.stringify(b27[0]?.bunky) === JSON.stringify(['17:00–23:00', 'Firemní večírek Alfa Akce · Firemní večírek · Předběžná', '40', 'Salonek', 'Petr Dvořák +420 777 333 444', 'Kapela: od 19:00 Dort v 21:00 Menu: Raut A']))
  ok(`rezervace: celý řádek (${JSON.stringify(b27[1]?.bunky)})`,
    JSON.stringify(b27[1]?.bunky) === JSON.stringify(['19:30', 'Rezervace', '4', 'Okno', 'Jana Nováková +420 777 111 222', 'Alergie: lepek Poznámka hosta: dětská židlička']))
  ok(`Bernard 28. 11.: Choice se stoly, noční v 1:30 patří k 28. (provozní den), zrušená vynechaná (${JSON.stringify(b28.map((r) => r.bunky.slice(0, 5)))})`,
    b28.length === 2 && JSON.stringify(b28[0].bunky.slice(0, 5)) === JSON.stringify(['20:00', 'Rezervace', '—', 'Patro: S1–S3', 'Karel Choice'])
    && b28[1].bunky[0] === '01:30' && b28[1].bunky[4] === 'Noční Host' && !list.includes('Zrušený Host')
    && !den(bernard, 'Neděle 29. listopadu 2026').includes('Noční Host'))
  ok('souhrn dne: „1 akce · 1 rezervace · 44 hostů“', den(bernard, 'Pátek 27. listopadu 2026').includes('<span class="ds-tisk-souhrn">1 akce · 1 rezervace · 44 hostů</span>'))
  ok('týden: den bez záznamu je v listu s „Žádná akce ani rezervace“ (ne „nic“ — poznámka ke dni být může)',
    den(bernard, 'Pondělí 23. listopadu 2026').includes('<span class="ds-tisk-souhrn">Žádná akce ani rezervace</span>') && !den(bernard, 'Pondělí 23. listopadu 2026').includes('<table'))
  ok('poznámka ke dni u své pobočky a dne (ne poznámka k rezervaci)',
    den(bernard, 'Pátek 27. listopadu 2026').includes('<li>Sál: zavřený od 22:00</li>') && den(perla, 'Pátek 27. listopadu 2026').includes('<li>Perla: kapela od 20:00</li>')
    && !perla.includes('Sál: zavřený') && !list.includes('K rezervaci, ne ke dni'))

  const sZrusenymi = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', zrusene: '1' } })
  const bernardZr = sZrusenymi.html.match(/<section class="ds-tisk-oddil" aria-label="Bernard Bar Tábor">[\s\S]*?(?=<section class="ds-tisk-oddil")/)?.[0] ?? ''
  const zr = radky(den(bernardZr, 'Sobota 28. listopadu 2026'))
  const zrusena = zr.find((r) => r.bunky[4] === 'Zrušený Host')
  ok(`zrusene=1: zrušená vytištěná, označená (data-zrusena) a se slovem „Zrušená“ (${JSON.stringify(zrusena)})`,
    !!zrusena && zrusena.zrusena && zrusena.bunky[1] === 'Rezervace Zrušená' && sZrusenymi.html.includes('i zrušené a nedorazivší'))

  const jenAkce = await tisk({ hledani: { od: '2026-11-23', do: '2026-11-29', co: 'akce' } })
  ok('co=akce: nadpis „Přehled akcí“, jen akce', jenAkce.html.includes('<h1>Přehled akcí</h1>') && jenAkce.html.includes('Firemní večírek Alfa') && jenAkce.html.includes('Svatba') && !jenAkce.html.includes('Jana Nováková'))
  ok('co=akce: den jen s rezervacemi má souhrn „Žádná akce“ (ne „ani rezervace“ — ty se netisknou)',
    /Sobota 28\. listopadu 2026 <span class="ds-tisk-souhrn">Žádná akce<\/span>/.test(jenAkce.html) && !jenAkce.html.includes('Žádná akce ani rezervace'))

  const mesic = await tisk({ hledani: { od: '2026-11-01', do: '2026-11-30' } })
  const dnyBernardu = [...(mesic.html.match(/<section class="ds-tisk-oddil" aria-label="Bernard Bar Tábor">[\s\S]*?(?=<section class="ds-tisk-oddil")/)?.[0] ?? '').matchAll(/<h3 class="ds-tisk-den-nadpis">([^<]+)/g)].map((m) => m[1].trim())
  ok(`měsíc (víc než ${PRAZDNE_DNY_DO} dní): jen dny, kde něco je — 27., 28. a 30. 11. (${dnyBernardu.join(', ')})`, dnyBernardu.join('|') === 'Pátek 27. listopadu 2026|Sobota 28. listopadu 2026|Pondělí 30. listopadu 2026')

  const prazdno = await tisk({ hledani: { od: '2026-12-01', do: '2026-12-31' } })
  ok('prázdné období: „V tomhle období není nic zapsáno.“ u každé pobočky', (prazdno.html.match(/V tomhle období není nic zapsáno\./g) ?? []).length === 2)

  const jedna = await tisk({ rozsah: 'cerna-perla', scope: { level: 'branch', branchId: P } })
  ok('jedna pobočka: bez nadpisu pobočky, dny jako h2', !jedna.html.includes('ds-tisk-pobocka') && jedna.html.includes('<h2 class="ds-tisk-den-nadpis">Pátek 27. listopadu 2026'))
}

/* ---------------------------------------------------------------------
 * 4. Tlačítka v kalendáři Rezervací a v Rozpisu směn
 * ------------------------------------------------------------------ */

console.log('\n== 4. Tlačítka: tisk téhož období, které obrazovka ukazuje ==\n')
{
  const NIC = js('export default function Nic() { return null }\n')
  const AKCE = js(
    'const akce = async () => {}\n' +
      'export const zmenitStav = akce, odebratPrilohu = akce, pridatPoznamku = akce, smazatPoznamku = akce, upravitPoznamku = akce, ulozitRezervaci = akce\n',
  )
  const prvky = await nactiModul('app/[rozsah]/rezervace/prvky.tsx', [['next/link', ODKAZ], ['./akce', AKCE], ['./prilohy-nahrat', NIC]])
  const tlacitko = (pohled, datum, smiZapisovat = true) => {
    const html = renderToStaticMarkup(createElement(prvky.NastrojePohledu, { rozsah: 'perla', pohled, datum, dnes: '2026-11-25', smiZapisovat }))
    const href = html.match(/<a href="([^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*Vytisknout<\/a>/)?.[1]?.replace(/&amp;/g, '&')
    return { html, href, volby: href ? volbyZAdresy(Object.fromEntries(new URL(href, 'https://foodtab.test').searchParams), '2000-01-01') : null }
  }
  const t = tlacitko('tyden', '2026-11-25')
  ok(`kalendář, týden: Vytisknout → tisk po–ne, zpátky na týden, okno tisku hned (${t.href})`,
    t.href === '/perla/rezervace/tisk?od=2026-11-23&do=2026-11-29&zpet=%2Fperla%2Frezervace%3Fpohled%3Dtyden%26datum%3D2026-11-25&hned=1'
    && zpatkyZTisku('perla', t.volby?.zpet, t.volby?.od).href === '/perla/rezervace?pohled=tyden&datum=2026-11-25')
  const m = tlacitko('mesic', '2026-11-25')
  ok(`kalendář, měsíc: tisk jen dnů měsíce, ne sousedních z mřížky (${m.volby?.od}–${m.volby?.do})`, m.volby?.od === '2026-11-01' && m.volby?.do === '2026-11-30')
  const d = tlacitko('den', '2026-11-27')
  ok(`kalendář, den: tisk toho dne, zpátky na den (${d.href})`, d.volby?.od === '2026-11-27' && d.volby?.do === '2026-11-27' && zpatkyZTisku('perla', d.volby?.zpet, '2026-11-27').href === '/perla/rezervace/den/2026-11-27')
  const cteni = tlacitko('tyden', '2026-11-25', false)
  ok('kalendář bez práva zapisovat: Vytisknout je, Nová rezervace ne', !!cteni.href && !cteni.html.includes('Nová rezervace'))
  ok('tlačítko má ikonu tiskárny ze sdílené sady (ne vlastní SVG na místě)', /<a [^>]*><svg class="ft-i"[^>]*><path d="M6 7V2.5h8V7"/.test(t.html))

  // Celý Rozpis směn (jako scripts/svatky.test.mjs) — tlačítko je na počítači v záhlaví.
  globalThis.__rHledani = ''
  const NAVIGACE = js(
    'export function useRouter() { return { push() {}, refresh() {}, replace() {} } }\n' +
      'export function useSearchParams() { return new URLSearchParams(globalThis.__rHledani) }\n' +
      'export function usePathname() { return "/bernard-bar/smeny" }\n',
  )
  const pojmenovane = (...jmena) => js(jmena.map((j) => `export function ${j}() { return null }\n`).join('') + 'export default function Nic() { return null }\n')
  const rozpis = await nactiModul('app/[rozsah]/smeny/rozpis.tsx', [
    ['next/link', ODKAZ],
    ['next/navigation', NAVIGACE],
    ['./formular-smeny', NIC],
    ['../nastaveni/nahrani/rozpis/pruvodce', NIC],
    ['@/components/ui/Drawer', NIC],
    ['@/components/ui/DropdownMenu', NIC],
    ['./detail', NIC],
    ['./filtry', NIC],
    ['./desktop/vydani', pojmenovane('KontrolaVydani', 'PruhVydani')],
    ['./desktop/panel-ke-smene', NIC],
    ['./zprava-vydani', NIC],
  ])
  const HOSTE = { pobocky: [{ id: B, nazev: VETVE[0].name, zkratka: 'BBT', barva: 'sky' }], dny: {}, chyba: false }
  const vRozpisu = (hledani, hoste = HOSTE) => {
    globalThis.__rHledani = hledani
    const html = renderToStaticMarkup(
      createElement(rozpis.default, {
        smeny: [], dnesni: '2026-11-25', dayStartsAt: '05:00', jmena: new Map(), barvy: new Map(), pozice: new Map(), domovskeUseky: new Map(),
        nazvyUseku: new Map(), nazvyPobocek: new Map([[B, VETVE[0].name]]), rozsah: { level: 'branch', branchId: B, branchName: VETVE[0].name },
        planovani: null, mobil: { mojeSmeny: [], okno: { od: '2026-10-26', do: '2026-12-06' }, maSve: false, tvurci: new Map(), rozsah: 'bernard-bar' },
        poziceLidi: new Map(), zrusene: [], potvrzeni: null, vydani: null, hoste, zemeSvatku: 'CZ',
      }),
    )
    const pocitac = html.slice(html.indexOf('class="ds-sm-jen-desktop'))
    const href = pocitac.match(/<a href="([^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*Tisk akcí<\/a>/)?.[1]?.replace(/&amp;/g, '&')
    return { href, volby: href ? volbyZAdresy(Object.fromEntries(new URL(href, 'https://foodtab.test').searchParams), '2000-01-01') : null, telefon: html.slice(0, html.indexOf('class="ds-sm-jen-desktop')) }
  }
  await zkus('Rozpis, týden: Tisk akcí → po–ne okna, zpátky na týž Rozpis, okno tisku hned', async () => {
    const r = vRozpisu('pohled=tyden&den=2026-11-25')
    return r.volby?.od === '2026-11-23' && r.volby?.do === '2026-11-29' && r.href.includes('hned=1') && r.volby.pobocky.length === 0
      && zpatkyZTisku('bernard-bar', r.volby.zpet, r.volby.od).href === '/bernard-bar/smeny?pohled=tyden&den=2026-11-25'
  })
  await zkus('Rozpis, 7 dní: od zvoleného dne sedm dní', async () => {
    const r = vRozpisu('pohled=sedm&den=2026-11-25')
    return r.volby?.od === '2026-11-25' && r.volby?.do === '2026-12-01'
  })
  await zkus('Rozpis, měsíc: celý měsíc; den: ten den', async () => {
    const m = vRozpisu('pohled=mesic&den=2026-11-25')
    const d = vRozpisu('pohled=den&den=2026-11-27')
    return m.volby?.od === '2026-11-01' && m.volby?.do === '2026-11-30' && d.volby?.od === '2026-11-27' && d.volby?.do === '2026-11-27'
  })
  await zkus('Rozpis bez práva na rezervace (hoste null): Tisk akcí tam není', async () => vRozpisu('pohled=tyden&den=2026-11-25', null).href === undefined)
  await zkus('Rozpis na telefonu tlačítko nemá (tisk je pro počítač)', async () => !vRozpisu('pohled=tyden&den=2026-11-25').telefon.includes('Tisk akcí'))

  // Výběr poboček v „Zobrazit“ je stav na klientu (useState) — vykreslením ho
  // nastavit nejde. Hlídá se zdroj: tlačítko jen pro vybrané pobočky, které člověk
  // na rezervace vidí, a do adresy jde celý výběr (tisková stránka ho jen zúží).
  const zdroj = cti('app/[rozsah]/smeny/rozpis.tsx')
  ok('Rozpis: tlačítko podle hostePobocek(hoste, filtr.pobocky) a do tisku jde výběr filtr.pobocky',
    /\{hostePobocek\(hoste, filtr\.pobocky\) \? \(\s*<Link\s+href=\{adresaTisku\(mobil\.rozsah, \{\s*\.\.\.obdobiTiskuZRozpisu\(pohled, den, zacatek\),\s*pobocky: filtr\.pobocky,/.test(zdroj))
}

/* ---------------------------------------------------------------------
 * 5. Papír — app/_tisk.css
 * ------------------------------------------------------------------ */

console.log('\n== 5. Papír (app/_tisk.css) ==\n')
{
  const css = cti('app/_tisk.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const zacatek = css.indexOf('@media print {')
  let konec = zacatek
  for (let h = 0, i = css.indexOf('{', zacatek); i < css.length; i++) {
    if (css[i] === '{') h++
    if (css[i] === '}' && --h === 0) {
      konec = i
      break
    }
  }
  const tisk = zacatek >= 0 ? css.slice(zacatek, konec + 1) : ''
  const pravidlo = (selektor) => tisk.match(new RegExp(`${selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1] ?? ''

  ok('globals.css načítá _tisk.css', /@import "\.\/_tisk\.css";/.test(cti('app/globals.css')))
  const skryte = ['html:has(.ds-tisk) .ft-shell > :not(.ft-body)', 'html:has(.ds-tisk) .ft-body > :not(.ft-main)', 'html:has(.ds-tisk) .ft-main > :not(.ds-tisk)', '.ds-tisk-ovladani']
  const blokSkryti = tisk.match(/([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/)?.[1] ?? ''
  ok(`na papíře pryč: horní lišta, sloupec, spodní lišta, zbytek <main>, ovládání (chybí: ${JSON.stringify(skryte.filter((s) => !blokSkryti.includes(s)))})`,
    skryte.every((s) => blokSkryti.includes(s)))
  ok('papír A4 na výšku', /@page\s*\{[^}]*size:\s*A4 portrait/.test(tisk))
  const barvy = [...tisk.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(--|color-mix/gi)].map((m) => m[0].toLowerCase())
  ok(`na papíře jen černá a bílá, žádná barva z tokenů (${JSON.stringify([...new Set(barvy)])})`, barvy.length > 0 && barvy.every((b) => b === '#000' || b === '#fff'))
  ok('písmo listu černé i z tmavého režimu (!important na list i potomky)', /color:\s*#000\s*!important/.test(pravidlo('.ds-tisk-list, .ds-tisk-list *')))
  ok('zrušená se pozná přeškrtnutím, ne barvou', /text-decoration:\s*line-through/.test(css.match(/tr\[data-zrusena\] \.ds-tisk-nazev[^{]*\{([^}]*)\}/)?.[1] ?? ''))
  ok('každá pobočka od nové stránky, řádek se nepůlí', /break-before:\s*page/.test(pravidlo('.ds-tisk-oddil + .ds-tisk-oddil')) && /break-inside:\s*avoid/.test(pravidlo('.ds-tisk-tabulka tr')))
}

console.log(chyb ? `\n${chyb} kontrol NEPROŠLO\n` : '\nVšechny kontroly prošly.\n')
process.exit(chyb ? 1 : 0)
