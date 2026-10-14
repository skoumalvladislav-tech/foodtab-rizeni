#!/usr/bin/env node
/**
 * Zrušení / smazání směny i v JINÉ DNY najednou.
 *
 * Zadání Šéfíka 14. 10. 2026: „potřebuji u rušení směn označit více dní.“
 *
 *   1. lib/ruseni-smen.ts — ověření dnů z prohlížeče (datum, strop, okno).
 *   2. lib/ruseni-smen.ts — pravidlo, které směny v jiném dni se ruší
 *      (člověk: všechny jeho na téže pobočce; neobsazená: stejná pozice
 *      a čas), a výběr včetně výchozí směny.
 *   3. lib/ruseni-smen.ts — náhled po dnech, texty, otisky, souhrn výsledku.
 *   4. app/[rozsah]/smeny/ruseni.ts — serverové akce nad podstrčenou
 *      databází: oprávnění, zúžení dotazu, náhled, rušení PO SOBĚ, chyba
 *      jedné směny nezastaví ostatní, nesoulad s náhledem nezruší nic.
 *   5. ruseni-vice-dni.tsx — co se opravdu vykreslí (mřížka se zamčeným
 *      dnem, náhled, výsledek).
 *   6. Jedna směna beze změny — formulář jedné směny posílá totéž co dřív.
 *
 * Pusť `node scripts/smeny-ruseni.test.mjs`.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  barvaRuseni,
  jeIsoDatum,
  MAX_DNU_RUSENI,
  nahledPoDnech,
  odpovidaPravidlu,
  otiskRadku,
  otiskSmeny,
  overitDnyRuseni,
  souhrnNahledu,
  souhrnRuseni,
  stejneSmeny,
  stejnyCas,
  textTlacitkaRuseni,
  vybratKeZruseni,
  vysledekZRpc,
} from '../lib/ruseni-smen.ts'
import { nactiModul } from './vykreslit.mjs'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

/* =====================================================================
   1. Ověření dnů z prohlížeče
   ================================================================== */

// 2026-10-14 je středa; okno mřížky začíná pondělím 12. 10. a má 12 týdnů
// (TYDNU_MAX), tedy končí nedělí 3. 1. 2027.
const ZAKLADNI_DEN = '2026-10-14'

console.log('\n== Dny: co je datum ==')
je('platné datum', jeIsoDatum('2026-10-15'), true)
je('neexistující den (31. února) se nepustí — roundtrip, ne jen tvar', jeIsoDatum('2026-02-31'), false)
je('jiný tvar než RRRR-MM-DD se nepustí', [jeIsoDatum('15. 10. 2026'), jeIsoDatum('2026-10-5'), jeIsoDatum('')], [false, false, false])

console.log('\n== Dny: ověření výběru (overitDnyRuseni) ==')
je(
  'seřazené, bez duplicit, s dnem výchozí směny',
  overitDnyRuseni(['2026-10-16', '2026-10-15', '2026-10-16', ZAKLADNI_DEN], ZAKLADNI_DEN),
  { ok: true, dny: ['2026-10-14', '2026-10-15', '2026-10-16'] },
)
je(
  'den výchozí směny se doplní, i když ho prohlížeč nepošle — ruší se vždy',
  overitDnyRuseni(['2026-10-15'], ZAKLADNI_DEN),
  { ok: true, dny: ['2026-10-14', '2026-10-15'] },
)
je('neplatné datum ve výběru: odmítne se celé', overitDnyRuseni(['2026-10-15', '2026-02-31'], ZAKLADNI_DEN).ok, false)
je('nesmysl místo data: odmítne se', overitDnyRuseni(['zitra'], ZAKLADNI_DEN).ok, false)
je(
  `víc než ${MAX_DNU_RUSENI} položek (i opakovaný platný den): odmítne se dřív, než se cokoli zpracuje`,
  overitDnyRuseni(Array.from({ length: MAX_DNU_RUSENI + 1 }, () => '2026-10-15'), ZAKLADNI_DEN).ok,
  false,
)
je(
  `přesně ${MAX_DNU_RUSENI} položek projde (strop je „víc než“)`,
  overitDnyRuseni(Array.from({ length: MAX_DNU_RUSENI }, () => '2026-10-15'), ZAKLADNI_DEN).ok,
  true,
)
je('pondělí týdne výchozí směny (začátek mřížky) projde', overitDnyRuseni(['2026-10-12'], ZAKLADNI_DEN).ok, true)
je('neděle před mřížkou se odmítne', overitDnyRuseni(['2026-10-11'], ZAKLADNI_DEN).ok, false)
je('poslední den mřížky (12. týden, neděle 3. 1. 2027) projde', overitDnyRuseni(['2027-01-03'], ZAKLADNI_DEN).ok, true)
je('den za mřížkou (4. 1. 2027) se odmítne', overitDnyRuseni(['2027-01-04'], ZAKLADNI_DEN).ok, false)

/* =====================================================================
   2. Pravidlo — které směny v jiném dni se ruší
   ================================================================== */

const smena = (id, prepis = {}) => ({
  id,
  branch_id: 'b1',
  employee_id: 'e1',
  position_id: 'p1',
  shift_date: '2026-10-15',
  starts_at: '08:00:00',
  ends_at: '16:00:00',
  status: 'planned',
  published_at: null,
  ...prepis,
})

const zakladClovek = smena('s0', { shift_date: ZAKLADNI_DEN, published_at: '2026-10-10T10:00:00Z' })
const zakladVolna = smena('o0', { employee_id: null, shift_date: ZAKLADNI_DEN })

console.log('\n== Pravidlo: výchozí směna má člověka ==')
je('téhož člověka na téže pobočce v jiném dni: ANO', odpovidaPravidlu(zakladClovek, smena('a')), true)
je('i s jiným časem (ten den nepřijde vůbec): ANO', odpovidaPravidlu(zakladClovek, smena('a', { starts_at: '18:00:00', ends_at: '23:00:00' })), true)
je('i s jinou pozicí: ANO', odpovidaPravidlu(zakladClovek, smena('a', { position_id: 'p2' })), true)
je('jiného člověka: NE', odpovidaPravidlu(zakladClovek, smena('a', { employee_id: 'e2' })), false)
je('neobsazená v tom dni: NE', odpovidaPravidlu(zakladClovek, smena('a', { employee_id: null })), false)
je('téhož člověka na JINÉ pobočce: NE', odpovidaPravidlu(zakladClovek, smena('a', { branch_id: 'b2' })), false)
je('už zrušená: NE', odpovidaPravidlu(zakladClovek, smena('a', { status: 'cancelled' })), false)
je(
  'druhá směna téhož člověka v DEN VÝCHOZÍ směny: NE (tam se ruší jen ona, jako dosud)',
  odpovidaPravidlu(zakladClovek, smena('a', { shift_date: ZAKLADNI_DEN, starts_at: '18:00:00' })),
  false,
)
je('výchozí směna sama sebe nepřidá podruhé', odpovidaPravidlu(zakladClovek, zakladClovek), false)

console.log('\n== Pravidlo: výchozí směna je neobsazená ==')
je('neobsazená, stejná pozice a čas: ANO', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null })), true)
je('„08:00“ a „08:00:00“ je tentýž čas', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, starts_at: '08:00', ends_at: '16:00' })), true)
je('jiná pozice: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, position_id: 'p2' })), false)
je('bez pozice proti výchozí s pozicí: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, position_id: null })), false)
je(
  'obě bez pozice: ANO (null = null)',
  odpovidaPravidlu({ ...zakladVolna, position_id: null }, smena('a', { employee_id: null, position_id: null })),
  true,
)
je('jiný začátek: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, starts_at: '09:00:00' })), false)
je('jiný konec: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, ends_at: '17:00:00' })), false)
je('obsazená se stejnou pozicí a časem: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: 'e3' })), false)
je('neobsazená na jiné pobočce: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, branch_id: 'b2' })), false)
je('neobsazená už zrušená: NE', odpovidaPravidlu(zakladVolna, smena('a', { employee_id: null, status: 'cancelled' })), false)
je('stejnyCas: jiná minuta se nesmí slít', stejnyCas('08:00', '08:01:00'), false)

console.log('\n== Výběr: výchozí směna + co odpovídá, jen ve vybraných dnech ==')
je(
  'výchozí vždy, ostatní jen ve vybraných dnech, v pořadí kalendáře a začátku',
  vybratKeZruseni(
    zakladClovek,
    [
      smena('c', { shift_date: '2026-10-16', starts_at: '18:00:00' }),
      smena('b', { shift_date: '2026-10-16', starts_at: '08:00:00' }),
      smena('a', { shift_date: '2026-10-15' }),
      smena('mimo', { shift_date: '2026-10-20' }),
      smena('cizi', { employee_id: 'e2' }),
      smena('a', { shift_date: '2026-10-15' }),
    ],
    ['2026-10-14', '2026-10-15', '2026-10-16'],
  ).map((s) => s.id),
  ['s0', 'a', 'b', 'c'],
)
je('bez dalších dnů jen výchozí směna', vybratKeZruseni(zakladClovek, [smena('a')], [ZAKLADNI_DEN]).map((s) => s.id), ['s0'])

/* =====================================================================
   3. Náhled, texty, otisky, výsledek
   ================================================================== */

const polozka = (id, den, akce, prepis = {}) => ({ id, den, od: '08:00', do: '16:00', kdo: 'Láďa', pozice: null, akce, vychozi: false, ...prepis })

console.log('\n== Náhled po dnech ==')
const nahled = nahledPoDnech(
  ['2026-10-16', '2026-10-14', '2026-10-15', '2026-10-17'],
  [
    polozka('b2', '2026-10-16', 'smazat', { od: '18:00', do: '22:00' }),
    polozka('b1', '2026-10-16', 'zrusit'),
    polozka('s0', '2026-10-14', 'zrusit', { vychozi: true }),
    polozka('a', '2026-10-15', 'smazat'),
  ],
)
je(
  'každý vybraný den, v pořadí kalendáře, směny podle začátku',
  nahled.map((d) => [d.den, d.smeny.map((s) => s.id)]),
  [
    ['2026-10-14', ['s0']],
    ['2026-10-15', ['a']],
    ['2026-10-16', ['b1', 'b2']],
    ['2026-10-17', []],
  ],
)
je('souhrn náhledu', souhrnNahledu(nahled), 'K zrušení 2 směny, ke smazání 2 směny, nic k zrušení: 1 den')
je('souhrn bez prázdných dnů a jen mazání', souhrnNahledu(nahledPoDnech(['2026-10-15'], [polozka('a', '2026-10-15', 'smazat')])), 'Ke smazání 1 směna')

console.log('\n== Text potvrzovacího tlačítka (říká přesně, co se stane) ==')
const dny = (akce) => nahledPoDnech(['2026-10-15'], akce.map((a, i) => polozka(`x${i}`, '2026-10-15', a)))
je('jen vydané', textTlacitkaRuseni(dny(['zrusit', 'zrusit', 'zrusit'])), 'Zrušit 3 směny')
je('jen nevydané, jedna', textTlacitkaRuseni(dny(['smazat'])), 'Smazat 1 směnu')
je('jen nevydané, pět', textTlacitkaRuseni(dny(['smazat', 'smazat', 'smazat', 'smazat', 'smazat'])), 'Smazat 5 směn')
je('mix', textTlacitkaRuseni(dny(['zrusit', 'zrusit', 'smazat', 'smazat', 'smazat'])), 'Zrušit 2 a smazat 3 směny')

console.log('\n== Otisk: co člověk viděl × co je v databázi ==')
const radek = smena('a', { published_at: '2026-10-10T10:00:00Z' })
je(
  'otisk řádku z databáze = otisk položky náhledu téže směny',
  otiskRadku(radek),
  otiskSmeny({ id: 'a', den: '2026-10-15', od: '08:00', do: '16:00', akce: 'zrusit' }),
)
je('změněný čas mění otisk', otiskRadku({ ...radek, starts_at: '09:00:00' }) === otiskRadku(radek), false)
je('vydání (smazat → zrušit) mění otisk', otiskRadku({ ...radek, published_at: null }) === otiskRadku(radek), false)
je('stejneSmeny: pořadí nehraje roli', stejneSmeny(['a', 'b'], ['b', 'a']), true)
je('stejneSmeny: chybějící směna', stejneSmeny(['a'], ['a', 'b']), false)
je('stejneSmeny: směna navíc', stejneSmeny(['a', 'b', 'c'], ['a', 'b']), false)

console.log('\n== Odpověď RPC smazat_smenu ==')
je('smazaná', vysledekZRpc('smazana', null), { vysledek: 'smazana', chyba: null })
je('zrušená', vysledekZRpc('zrusena', null), { vysledek: 'zrusena', chyba: null })
je('chyba z databáze projde beze změny', vysledekZRpc(null, { message: 'Tahle směna patří pobočce, kterou nespravujete.' }), {
  vysledek: null,
  chyba: 'Tahle směna patří pobočce, kterou nespravujete.',
})
je('nečekaná odpověď bez chyby je chyba, ne úspěch', vysledekZRpc(null, null).vysledek, null)

console.log('\n== Souhrn výsledku ==')
const v = (vysledek, chyba = null) => ({ id: Math.random().toString(36), den: '2026-10-15', od: '08:00', do: '16:00', vysledek, chyba })
je(
  'celý souhrn (tvar ze zadání)',
  souhrnRuseni([v('zrusena'), v('zrusena'), v('smazana'), v('smazana'), v('smazana'), v(null, 'X')], 1),
  'Zrušeno 2, smazáno 3, nic k zrušení: 1 den, 1 chyba',
)
je('nulové části se vynechají', souhrnRuseni([v('smazana'), v('smazana')], 0), 'Smazáno 2')
je('skloňování dnů a chyb', souhrnRuseni([v(null, 'X'), v(null, 'Y'), v('zrusena')], 5), 'Zrušeno 1, nic k zrušení: 5 dní, 2 chyby')
je('už zrušená mezitím (souběh) se počítá zvlášť', souhrnRuseni([v('uz_zrusena')], 0), 'Už dřív zrušeno 1')
je('barva: bez chyby zelená', barvaRuseni([v('zrusena'), v('smazana')]), 'var(--dobre)')
je('barva: část neprošla — varování, ne zelená', barvaRuseni([v('zrusena'), v(null, 'X')]), 'var(--pozor)')
je('barva: nic neprošlo — červená', barvaRuseni([v(null, 'X'), v(null, 'Y')]), 'var(--bad)')

/* =====================================================================
   4. Serverové akce (app/[rozsah]/smeny/ruseni.ts) nad podstrčenou databází
   ================================================================== */

// Apostrof `encodeURIComponent` nechá být — a adresa se do importu vkládá
// v apostrofech, takže by ho ukončila. Proto %27.
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')

/*
  Podstrčená databáze vyhodnocuje filtry dotazu (eq / in / is) nad řádky
  v paměti — akce tak běží svou skutečnou cestou a zároveň se zapisuje,
  na co se ptala (zúžení dotazu se kontroluje níž).
*/
globalThis.__r = null
const SUPABASE = js(`
export async function getServerSupabase() {
  const r = globalThis.__r
  return {
    from(tabulka) {
      const filtry = []
      r.dotazy.push({ tabulka, filtry })
      const vysledek = () => (r.db[tabulka] ?? []).filter((radek) => filtry.every(([op, sloupec, hodnota]) =>
        op === 'eq' ? radek[sloupec] === hodnota
        : op === 'in' ? hodnota.includes(radek[sloupec])
        : op === 'is' ? radek[sloupec] === hodnota
        : false))
      const q = {
        select() { return q },
        eq(s, h) { filtry.push(['eq', s, h]); return q },
        in(s, h) { filtry.push(['in', s, h]); return q },
        is(s, h) { filtry.push(['is', s, h]); return q },
        async maybeSingle() { return { data: vysledek()[0] ?? null, error: null } },
        then(ano, ne) { return Promise.resolve({ data: vysledek(), error: null }).then(ano, ne) },
      }
      return q
    },
    async rpc(jmeno, args) {
      r.bezi++
      r.maxSoubeh = Math.max(r.maxSoubeh, r.bezi)
      await new Promise((res) => setTimeout(res, 5))
      r.bezi--
      r.volani.push(['rpc', jmeno, args])
      return r.rpc(jmeno, args)
    },
  }
}
`)
const FIRMA = js(`
export async function getCurrentTenantId() { return 't1' }
export async function zkusPristup(t, pravo, rozsah) {
  globalThis.__r.volani.push(['zkusPristup', pravo, rozsah])
  return globalThis.__r.pristup ? { stav: 'ok' } : { stav: 'odepren' }
}
`)
const AUTHZ = js(`
export async function hasAccess(t, pravo, pobocka) {
  globalThis.__r.volani.push(['hasAccess', pravo, pobocka])
  return globalThis.__r.pobocky.includes(pobocka)
}
`)
const CACHE = js(`export function revalidatePath(c) { globalThis.__r.volani.push(['revalidate', c]) }`)

const akce = await nactiModul('app/[rozsah]/smeny/ruseni.ts', [
  ['next/cache', CACHE],
  ['@/lib/firma', FIRMA],
  ['@/lib/authz', AUTHZ],
  ['@/lib/supabase/server', SUPABASE],
])

const radekDb = (id, prepis = {}) => ({ tenant_id: 't1', ...smena(id, prepis) })
const DB = {
  shifts: [
    // Výchozí směna člověka e1 (vydaná) a co kolem ní v rozpisu je.
    radekDb('s0', { shift_date: '2026-10-14', published_at: '2026-10-10T10:00:00Z' }),
    radekDb('s1', { shift_date: '2026-10-15', starts_at: '10:00:00', ends_at: '18:00:00' }),
    radekDb('s2', { shift_date: '2026-10-16', published_at: '2026-10-10T10:00:00Z' }),
    radekDb('s3', { shift_date: '2026-10-16', starts_at: '18:00:00', ends_at: '22:00:00' }),
    radekDb('s4', { shift_date: '2026-10-15', employee_id: 'e2' }),
    radekDb('s5', { shift_date: '2026-10-15', branch_id: 'b2' }),
    radekDb('s6', { shift_date: '2026-10-16', status: 'cancelled', published_at: '2026-10-10T10:00:00Z' }),
    radekDb('s7', { shift_date: '2026-10-14', starts_at: '18:00:00', ends_at: '20:00:00' }),
    radekDb('s8', { shift_date: '2026-10-20' }),
    { ...radekDb('s9', { shift_date: '2026-10-15', branch_id: 'b9' }), tenant_id: 't2' },
    // Neobsazená výchozí směna o0 (pozice p1, 08–16) a co kolem ní.
    radekDb('o0', { employee_id: null, shift_date: '2026-10-14' }),
    radekDb('o1', { employee_id: null, shift_date: '2026-10-15' }),
    radekDb('o2', { employee_id: null, shift_date: '2026-10-15', position_id: 'p2' }),
    radekDb('o3', { employee_id: null, shift_date: '2026-10-16', starts_at: '09:00:00' }),
    radekDb('o4', { employee_id: null, shift_date: '2026-10-16', ends_at: '17:00:00' }),
    radekDb('o5', { employee_id: 'e3', shift_date: '2026-10-16' }),
    radekDb('o6', { employee_id: null, shift_date: '2026-10-16', position_id: null }),
  ],
  employees: [{ id: 'e1', full_name: 'Láďa Novák' }],
  positions: [{ id: 'p1', label: 'Kuchař' }],
}

function priprava({ pristup = true, pobocky = ['b1', 'b2'], rpc } = {}) {
  globalThis.__r = {
    db: DB,
    pristup,
    pobocky,
    dotazy: [],
    volani: [],
    bezi: 0,
    maxSoubeh: 0,
    rpc: rpc ?? ((_jmeno, args) => ({ data: DB.shifts.find((s) => s.id === args.p_smena)?.published_at ? 'zrusena' : 'smazana', error: null })),
  }
  return globalThis.__r
}

async function zrusit(pole, nastaveni) {
  const r = priprava(nastaveni)
  const fd = new FormData()
  for (const [k, hodnota] of Object.entries(pole)) {
    for (const x of [hodnota].flat()) fd.append(k, x)
  }
  const vysledek = await akce.zrusitViceDni({ stav: 'nic' }, fd)
  return { vysledek, r, rpc: r.volani.filter((x) => x[0] === 'rpc') }
}

const DNY_CLOVEK = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']

console.log('\n== Akce náhled: výchozí směna s člověkem ==')
priprava()
const n1 = await akce.nahledRuseni('cerna-perla', 's0', DNY_CLOVEK)
je(
  'den po dni: výchozí, jeho směny v dalších dnech (i jiný čas, i dvě v jednom dni), prázdný den',
  n1.stav === 'ok' && n1.dny.map((d) => [d.den, d.smeny.map((s) => [s.id, s.akce])]),
  [
    ['2026-10-14', [['s0', 'zrusit']]],
    ['2026-10-15', [['s1', 'smazat']]],
    ['2026-10-16', [['s2', 'zrusit'], ['s3', 'smazat']]],
    ['2026-10-17', []],
  ],
)
je('jméno a pozice v náhledu', n1.stav === 'ok' && [n1.dny[1].smeny[0].kdo, n1.dny[1].smeny[0].pozice, n1.dny[0].smeny[0].vychozi], ['Láďa Novák', 'Kuchař', true])
je('náhled NIC neruší', globalThis.__r.volani.filter((x) => x[0] === 'rpc').length, 0)
je('první linie: shifts.manage nad rozsahem z adresy', globalThis.__r.volani.find((x) => x[0] === 'zkusPristup'), ['zkusPristup', 'shifts.manage', 'cerna-perla'])
je('a právo na pobočce TÉ SMĚNY (pravidlo 4)', globalThis.__r.volani.find((x) => x[0] === 'hasAccess'), ['hasAccess', 'shifts.manage', 'b1'])

const dotazKandidatu = (r) => r.dotazy.find((d) => d.tabulka === 'shifts' && d.filtry.some(([op, s]) => op === 'in' && s === 'shift_date'))
const filtry = (d) => d.filtry.map(([op, s, h]) => `${op} ${s} ${JSON.stringify(h)}`).sort()
je(
  'dotaz na kandidáty se ptá jen na firmu, pobočku, DALŠÍ dny a téhož člověka (strop řádků — viz hlavičku ruseni.ts)',
  filtry(dotazKandidatu(globalThis.__r)),
  [
    'eq branch_id "b1"',
    'eq employee_id "e1"',
    'eq tenant_id "t1"',
    `in shift_date ${JSON.stringify(['2026-10-15', '2026-10-16', '2026-10-17'])}`,
  ],
)

console.log('\n== Akce náhled: neobsazená výchozí směna ==')
priprava()
const n2 = await akce.nahledRuseni('cerna-perla', 'o0', ['2026-10-14', '2026-10-15', '2026-10-16'])
je(
  'jen neobsazené se stejnou pozicí a časem; den bez shody je prázdný',
  n2.stav === 'ok' && n2.dny.map((d) => [d.den, d.smeny.map((s) => s.id)]),
  [
    ['2026-10-14', ['o0']],
    ['2026-10-15', ['o1']],
    ['2026-10-16', []],
  ],
)
je('neobsazená se v náhledu tak i jmenuje', n2.stav === 'ok' && n2.dny[0].smeny[0].kdo, 'Neobsazená směna')
je(
  'dotaz na kandidáty u neobsazené: employee_id IS NULL',
  filtry(dotazKandidatu(globalThis.__r)).filter((f) => f.includes('employee_id')),
  ['is employee_id null'],
)

console.log('\n== Akce náhled: odmítnutí ==')
priprava({ pristup: false })
je('bez shifts.manage: chyba, směna se ani nenačte', [(await akce.nahledRuseni('x', 's0', DNY_CLOVEK)).stav, globalThis.__r.dotazy.length], ['chyba', 0])
priprava({ pobocky: ['b2'] })
je('bez práva na pobočce té směny: chyba, kandidáti se nenačtou', [(await akce.nahledRuseni('x', 's0', DNY_CLOVEK)).stav, globalThis.__r.dotazy.length], ['chyba', 1])
priprava()
je('směna cizí firmy se nenajde', await akce.nahledRuseni('x', 's9', ['2026-10-15']), { stav: 'chyba', text: 'Takovou směnu neznám.' })
priprava()
je('neplatný den: chyba z ověření', (await akce.nahledRuseni('x', 's0', ['2026-10-15', '2026-02-31'])).stav, 'chyba')

console.log('\n== Akce zrušení: šťastná cesta ==')
const OTISKY = ['s0', 's1', 's2', 's3'].map((id) => otiskRadku(DB.shifts.find((s) => s.id === id)))
const z1 = await zrusit({ rozsah: 'cerna-perla', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY })
je('RPC smazat_smenu jednou za každou směnu, výchozí včetně, v pořadí kalendáře', z1.rpc.map((x) => [x[1], x[2].p_smena]), [
  ['smazat_smenu', 's0'],
  ['smazat_smenu', 's1'],
  ['smazat_smenu', 's2'],
  ['smazat_smenu', 's3'],
])
je('kontrakt RPC: jen p_tenant a p_smena, firma ze serveru', z1.rpc.map((x) => x[2]).every((a) => Object.keys(a).sort().join() === 'p_smena,p_tenant' && a.p_tenant === 't1'), true)
je('PO SOBĚ, ne najednou (nikdy dvě volání současně)', z1.r.maxSoubeh, 1)
je('hotovo s výsledkem každé směny', z1.vysledek.stav === 'hotovo' && z1.vysledek.smeny.map((s) => [s.id, s.vysledek, s.chyba]), [
  ['s0', 'zrusena', null],
  ['s1', 'smazana', null],
  ['s2', 'zrusena', null],
  ['s3', 'smazana', null],
])
je('dny bez směny k zrušení', z1.vysledek.dnyBezSmen, ['2026-10-17'])
je('souhrn ze skutečného výsledku', souhrnRuseni(z1.vysledek.smeny, z1.vysledek.dnyBezSmen.length), 'Zrušeno 2, smazáno 2, nic k zrušení: 1 den')
je('rozpis se obnoví JEDNOU', z1.r.volani.filter((x) => x[0] === 'revalidate'), [['revalidate', '/cerna-perla/smeny']])

console.log('\n== Akce zrušení: chyba jedné směny nezastaví ostatní ==')
const z2 = await zrusit(
  { rozsah: 'cerna-perla', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY },
  {
    rpc: (_j, args) =>
      args.p_smena === 's1'
        ? { data: null, error: { message: 'Tahle směna patří pobočce, kterou nespravujete.' } }
        : args.p_smena === 's2'
          ? (() => {
              throw new Error('spojení')
            })()
          : { data: 'smazana', error: null },
  },
)
je('zkusí se všechny čtyři', z2.rpc.length, 4)
je(
  'chyba z databáze i pád spojení jsou u své směny vidět, ostatní prošly',
  z2.vysledek.smeny.map((s) => [s.id, s.vysledek, s.chyba]),
  [
    ['s0', 'smazana', null],
    ['s1', null, 'Tahle směna patří pobočce, kterou nespravujete.'],
    ['s2', null, 'Spojení s databází selhalo.'],
    ['s3', 'smazana', null],
  ],
)
je('souhrn hlásí chyby', souhrnRuseni(z2.vysledek.smeny, 0), 'Smazáno 2, 2 chyby')

const z3 = await zrusit(
  { rozsah: 'cerna-perla', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY },
  { rpc: () => ({ data: null, error: { message: 'Ne.' } }) },
)
je('když neprojde nic, rozpis se neobnovuje', z3.r.volani.filter((x) => x[0] === 'revalidate').length, 0)

console.log('\n== Akce zrušení: nesoulad s náhledem nezruší NIC ==')
const bezS3 = await zrusit({ rozsah: 'x', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY.slice(0, 3) })
je('v náhledu chyběla směna (přibyla mezitím): odmítnuto, žádné RPC', [bezS3.vysledek.stav, bezS3.rpc.length], ['chyba', 0])
const cizi = await zrusit({ rozsah: 'x', smena: 's0', dny: DNY_CLOVEK, smeny: [...OTISKY, otiskRadku(DB.shifts.find((s) => s.id === 's4'))] })
je('podvržená cizí směna (jiný člověk): odmítnuto, žádné RPC', [cizi.vysledek.stav, cizi.rpc.length], ['chyba', 0])
const jinyCas = await zrusit({
  rozsah: 'x',
  smena: 's0',
  dny: DNY_CLOVEK,
  smeny: [...OTISKY.slice(0, 3), otiskSmeny({ id: 's3', den: '2026-10-16', od: '17:00', do: '22:00', akce: 'smazat' })],
})
je('směna mezitím změnila čas: odmítnuto, žádné RPC', [jinyCas.vysledek.stav, jinyCas.rpc.length], ['chyba', 0])
const bezNahledu = await zrusit({ rozsah: 'x', smena: 's0', dny: DNY_CLOVEK })
je('bez náhledu (žádné otisky): odmítnuto, žádné RPC', [bezNahledu.vysledek.stav, bezNahledu.rpc.length], ['chyba', 0])
const spatnyDen = await zrusit({ rozsah: 'x', smena: 's0', dny: [...DNY_CLOVEK, '2027-01-04'], smeny: OTISKY })
je('den mimo okno mřížky: odmítnuto, žádné RPC', [spatnyDen.vysledek.stav, spatnyDen.rpc.length], ['chyba', 0])
const bezPrava = await zrusit({ rozsah: 'x', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY }, { pristup: false })
je('bez shifts.manage: odmítnuto, žádné RPC', [bezPrava.vysledek.stav, bezPrava.rpc.length], ['chyba', 0])
const cizíPobocka = await zrusit({ rozsah: 'x', smena: 's0', dny: DNY_CLOVEK, smeny: OTISKY }, { pobocky: ['b2'] })
je('bez práva na pobočce té směny: odmítnuto, žádné RPC', [cizíPobocka.vysledek.stav, cizíPobocka.rpc.length], ['chyba', 0])

/* =====================================================================
   5. Co se vykreslí (ruseni-vice-dni.tsx)
   ================================================================== */

const NAVIGACE = js('export function useRouter() { return { push() {}, replace() {}, refresh() {} } }\n')
const RUSENI_AKCE = js(
  'export async function nahledRuseni() { return { stav: "chyba", text: "" } }\n' +
    'export async function zrusitViceDni() { return { stav: "nic" } }\n',
)
const modulRuseni = await nactiModul('app/[rozsah]/smeny/ruseni-vice-dni.tsx', [
  ['next/navigation', NAVIGACE],
  ['./ruseni', RUSENI_AKCE],
])

console.log('\n== Výběr dnů při rušení ==')
const uvod = renderToStaticMarkup(
  createElement(modulRuseni.default, {
    rozsah: 'cerna-perla',
    smena: { id: 's0', shift_date: ZAKLADNI_DEN, employee_id: 'e1' },
    onZpet: () => {},
    onHotovo: () => {},
  }),
)
const tlacitkoDne = (html, den) => html.match(new RegExp(`<button[^>]*aria-label="[^"]*${den}[^"]*"[^>]*>`))?.[0] ?? ''
je('volba je zapnutá a pojmenovaná neutrálně (mix zrušit / smazat)', uvod.includes('checked=""') && uvod.includes('Zrušit / smazat i v jiné dny'), true)
je('den výchozí směny (Středa 14. října) je vybraný a zamčený', ['data-zamceno', 'aria-pressed="true"', 'aria-disabled="true"'].every((a) => tlacitkoDne(uvod, 'Středa 14. října').includes(a)), true)
je('jiný den (Čtvrtek 15. října) vybraný není a zamčený taky ne', ['aria-pressed="false"'].every((a) => tlacitkoDne(uvod, 'Čtvrtek 15. října').includes(a)) && !tlacitkoDne(uvod, 'Čtvrtek 15. října').includes('data-zamceno'), true)
je('mřížka začíná pondělím týdne té směny (12. 10.) — 4 týdny', (uvod.match(/class="ds-sm-vd-den"/g) ?? []).length, 28)
je('bez náhledu žádné potvrzovací tlačítko', uvod.includes('type="submit"'), false)
const tlacitkoNahledu = uvod.match(/<button[^>]*>Ukázat, co se zruší<\/button>/)?.[0] ?? ''
je('„Ukázat, co se zruší“ je vidět a s jediným dnem nejde', tlacitkoNahledu.includes('disabled'), true)
je('pravidlo pro člověka je napsané', uvod.includes('všechny směny téhož člověka na této pobočce'), true)
const uvodVolna = renderToStaticMarkup(
  createElement(modulRuseni.default, {
    rozsah: 'cerna-perla',
    smena: { id: 'o0', shift_date: ZAKLADNI_DEN, employee_id: null },
    onZpet: () => {},
    onHotovo: () => {},
  }),
)
je('pravidlo pro neobsazenou je napsané', uvodVolna.includes('se stejnou pozicí a stejným časem'), true)

console.log('\n== Náhled (NahledRuseni) ==')
const nahledHtml = renderToStaticMarkup(createElement(modulRuseni.NahledRuseni, { dny: n1.dny }))
const radkyDnu = [...nahledHtml.matchAll(/<li class="ds-sm-rv-den"[^>]*>(.*?)<\/li><\/ul><\/li>|<li class="ds-sm-rv-den" data-prazdny="">(.*?)<\/li>/g)].map((m) => (m[1] ?? m[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
je('každý den s datem, časem, kým a co se stane', radkyDnu, [
  'ST 14. 10. 08:00–16:00 Láďa Novák · Kuchař (tato směna) zruší se (vydaná)',
  'ČT 15. 10. 10:00–18:00 Láďa Novák · Kuchař smaže se (nevydaná)',
  'PÁ 16. 10. 08:00–16:00 Láďa Novák · Kuchař zruší se (vydaná) 18:00–22:00 Láďa Novák · Kuchař smaže se (nevydaná)',
  'SO 17. 10. nic k zrušení',
])
je('vysvětlení u vydaných je vidět', nahledHtml.includes('zmizí, až rozpis vydáte'), true)
je('bez vydaných se vysvětlení nekreslí', renderToStaticMarkup(createElement(modulRuseni.NahledRuseni, { dny: n2.dny })).includes('rozpis vydáte'), false)

console.log('\n== Výsledek (PrehledVysledku) ==')
const vysledekHtml = renderToStaticMarkup(
  createElement(modulRuseni.PrehledVysledku, { smeny: z2.vysledek.smeny, dnuBezSmen: 1, tlacitko: 'ft-tl', onHotovo: () => {} }),
)
je('souhrn v barvě varování (část neprošla)', vysledekHtml.includes('color:var(--pozor)">Smazáno 2, nic k zrušení: 1 den, 2 chyby.'), true)
je(
  'každá neúspěšná směna se dnem, časem a hláškou',
  [...vysledekHtml.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')),
  [
    'ČT 15. 10. 10:00–18:00: neprošlo — Tahle směna patří pobočce, kterou nespravujete.',
    'PÁ 16. 10. 08:00–16:00: neprošlo — Spojení s databází selhalo.',
  ],
)

/* =====================================================================
   6. Jedna směna beze změny
   ================================================================== */

console.log('\n== Jedna směna: formulář posílá totéž co dřív ==')
/*
  Static markup neumí kliknout na „Smazat směnu“, takže se potvrzení jedné
  směny ověří ve zdroji: v jeho <form> smějí být pole `rozsah` a `smena`
  a nic dalšího — zaškrtávátko „…i v jiné dny“ nesmí mít `name`.
*/
const formJedne = (soubor) => {
  const zdroj = fs.readFileSync(new URL(`../${soubor}`, import.meta.url), 'utf8')
  const od = zdroj.indexOf('<form action={akceSmazat}')
  const blok = zdroj.slice(od, zdroj.indexOf('</form>', od))
  return { blok, pole: [...blok.matchAll(/name=["{]([^"}]+)/g)].map((m) => m[1]) }
}
for (const soubor of ['app/[rozsah]/smeny/formular-smeny.tsx', 'app/[rozsah]/smeny/mobil/detail.tsx']) {
  const { blok, pole } = formJedne(soubor)
  je(`${soubor}: jen rozsah a smena`, pole, ['rozsah', 'smena'])
  je(`${soubor}: volba „…i v jiné dny“ je v potvrzení jedné směny`, /Zrušit i v jiné dny/.test(blok) && /Smazat i v jiné dny/.test(blok), true)
}

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
