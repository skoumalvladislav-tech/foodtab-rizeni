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
 *   3. lib/ruseni-smen.ts — náhled po dnech, texty, otisky, souhrn výsledku;
 *      rozhodnutí obrazovky (platný náhled, zamítnutí) a podržený detail
 *      na telefonu (lib/rozpis-mobil.ts).
 *   4. app/[rozsah]/smeny/ruseni.ts — serverové akce nad podstrčenou
 *      databází: oprávnění, zúžení a pořadí dotazu, useknutí limitem
 *      řádků, strop počtu směn, už zrušená výchozí směna, náhled, rušení
 *      PO SOBĚ, chyba jedné směny nezastaví ostatní, nesoulad s náhledem
 *      nezruší nic.
 *   5. ruseni-vice-dni.tsx — co se opravdu vykreslí (mřížka se zamčeným
 *      dnem, zamčení během odesílání, náhled, výsledek).
 *   6. Jedna směna beze změny — formulář jedné směny posílá totéž co dřív
 *      a zaškrtávátko „…i v jiné dny“ stojí mimo něj; zapojení rodičů
 *      (podržení okna, stav akce, fokus) a CSS.
 *
 * Pusť `node scripts/smeny-ruseni.test.mjs`.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  barvaRuseni,
  casSmenyKRuseni,
  dnySeSmenouKRuseni,
  jeIsoDatum,
  jeZamitnuto,
  klicVyberu,
  MAX_DNU_RUSENI,
  MAX_SMEN_RUSENI,
  nahledPoDnech,
  odpovidaPravidlu,
  oknoRuseni,
  otiskRadku,
  otiskSmeny,
  overitDnyRuseni,
  platnyNahled,
  souhrnNahledu,
  souhrnRuseni,
  stejneSmeny,
  stejnyCas,
  TEXT_MOC_SMEN,
  textTlacitkaRuseni,
  vybratKeZruseni,
  vysledekZRpc,
} from '../lib/ruseni-smen.ts'
import { vyberDetailu } from '../lib/rozpis-mobil.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

const cist = (soubor) => fs.readFileSync(new URL(`../${soubor}`, import.meta.url), 'utf8')

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
je('souhrn náhledu', souhrnNahledu(nahled), 'Ke zrušení 2 směny, ke smazání 2 směny, nic ke zrušení: 1 den')
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
  'Zrušeno 2, smazáno 3, nic ke zrušení: 1 den, 1 chyba',
)
je('nulové části se vynechají', souhrnRuseni([v('smazana'), v('smazana')], 0), 'Smazáno 2')
je('skloňování dnů a chyb', souhrnRuseni([v(null, 'X'), v(null, 'Y'), v('zrusena')], 5), 'Zrušeno 1, nic ke zrušení: 5 dní, 2 chyby')
je('už zrušená mezitím (souběh) se počítá zvlášť', souhrnRuseni([v('uz_zrusena')], 0), 'Už dřív zrušeno 1')
je('barva: bez chyby zelená', barvaRuseni([v('zrusena'), v('smazana')]), 'var(--dobre)')
je('barva: část neprošla — varování, ne zelená', barvaRuseni([v('zrusena'), v(null, 'X')]), 'var(--pozor)')
je('barva: nic neprošlo — červená', barvaRuseni([v(null, 'X'), v(null, 'Y')]), 'var(--bad)')

console.log('\n== Čeština: „ke zrušení“, ne „k zrušení“ (předložka před z- se vokalizuje) ==')
for (const soubor of ['lib/ruseni-smen.ts', 'app/[rozsah]/smeny/ruseni-vice-dni.tsx', 'app/[rozsah]/smeny/ruseni.ts']) {
  je(`${soubor}: nikde „k zrušení“`, /(^|[^\p{L}])[kK] zrušení/u.test(cist(soubor)), false)
}

/* =====================================================================
   3b. Rozhodnutí obrazovky (ruseni-vice-dni.tsx) — čisté funkce
   ================================================================== */

console.log('\n== Platný náhled: jen pro SOUČASNÝ výběr dnů (platnyNahled) ==')
const NAHLED_14_15 = { pro: klicVyberu(['2026-10-14', '2026-10-15']), dny: [], verze: 7 }
je('stejný výběr: náhled platí', platnyNahled(NAHLED_14_15, ['2026-10-14', '2026-10-15']), NAHLED_14_15)
je('na pořadí kliknutí nezáleží', platnyNahled(NAHLED_14_15, ['2026-10-15', '2026-10-14']), NAHLED_14_15)
je('přibyl den: náhled neplatí (potvrzovací tlačítko zmizí)', platnyNahled(NAHLED_14_15, ['2026-10-14', '2026-10-15', '2026-10-16']), null)
je('ubyl den: náhled neplatí', platnyNahled(NAHLED_14_15, ['2026-10-14']), null)
je('bez náhledu nic', platnyNahled(null, ['2026-10-14', '2026-10-15']), null)

console.log('\n== Zamítnutí potvrzení: kdy se ukáže „Nic se nezrušilo“ (jeZamitnuto) ==')
const CHYBA = { stav: 'chyba', text: 'Rozpis se od náhledu změnil…' }
je('chyba k náhledu, se kterým se odesílalo: ANO', jeZamitnuto(CHYBA, 7, { verze: 7 }, false), true)
je(
  'TÁŽ chyba, ale akce právě běží (druhé odeslání drží starý stav): NE — tlačítko „Provádím…“ zůstane',
  jeZamitnuto(CHYBA, 7, { verze: 7 }, true),
  false,
)
je('po novém náhledu (jiná verze): NE — potvrdit jde znovu', jeZamitnuto(CHYBA, 7, { verze: 8 }, false), false)
je('nic se neodeslalo (odeslanaVerze null): NE', jeZamitnuto(CHYBA, null, { verze: 7 }, false), false)
je('bez náhledu: NE', jeZamitnuto(CHYBA, 7, null, false), false)
je('stav „nic“: NE', jeZamitnuto({ stav: 'nic' }, 7, { verze: 7 }, false), false)
je('stav „hotovo“: NE', jeZamitnuto({ stav: 'hotovo', smeny: [], dnyBezSmen: [] }, 7, { verze: 7 }, false), false)

console.log('\n== Detail na telefonu: podržená směna (lib/rozpis-mobil.ts, vyberDetailu) ==')
const d1 = { id: 'd1', verze: 'nova' }
je('směna v datech: detail ukáže data (ne starou kopii)', vyberDetailu([d1], 'd1', { id: 'd1', verze: 'stara' }), d1)
je(
  'směna z dat zmizela, ale je podržená (rušení ve víc dnech): detail i s výsledkem zůstane',
  vyberDetailu([], 'd1', { id: 'd1', verze: 'stara' }),
  { id: 'd1', verze: 'stara' },
)
je('zmizela a podržená není: detail se zavře', vyberDetailu([], 'd1', null), null)
je('podržená je JINÁ směna: detail se zavře', vyberDetailu([], 'd1', { id: 'd2' }), null)
je('žádný otevřený detail: nic', vyberDetailu([d1], null, d1), null)

/* =====================================================================
   4. Serverové akce (app/[rozsah]/smeny/ruseni.ts) nad podstrčenou databází
   ================================================================== */

// Apostrof `encodeURIComponent` nechá být — a adresa se do importu vkládá
// v apostrofech, takže by ho ukončila. Proto %27.
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')

/*
  Podstrčená databáze vyhodnocuje filtry dotazu (eq / neq / in / is) a řazení
  nad řádky v paměti — akce tak běží svou skutečnou cestou a zároveň se
  zapisuje, na co se ptala (zúžení dotazu se kontroluje níž).

  `maxRadku` napodobuje max_rows PostgRESTu: vrátí nejvýš tolik řádků
  a NIC neohlásí — jen `count` (když si o něj dotaz řekl) prozradí, kolik
  jich ve skutečnosti odpovídá.
*/
globalThis.__r = null
const SUPABASE = js(`
export async function getServerSupabase() {
  const r = globalThis.__r
  return {
    from(tabulka) {
      const filtry = []
      const razeni = []
      const zaznam = { tabulka, filtry, razeni, pocet: null }
      r.dotazy.push(zaznam)
      const vysledek = () => {
        const radky = (r.db[tabulka] ?? []).filter((radek) => filtry.every(([op, sloupec, hodnota]) =>
          op === 'eq' ? radek[sloupec] === hodnota
          : op === 'neq' ? radek[sloupec] !== hodnota
          : op === 'in' ? hodnota.includes(radek[sloupec])
          : op === 'is' ? radek[sloupec] === hodnota
          : op === 'gte' ? radek[sloupec] >= hodnota
          : op === 'lte' ? radek[sloupec] <= hodnota
          : false))
        return razeni.length === 0 ? radky : [...radky].sort((a, b) => {
          for (const s of razeni) {
            const c = String(a[s]).localeCompare(String(b[s]))
            if (c !== 0) return c
          }
          return 0
        })
      }
      const q = {
        select(_sloupce, volby) { zaznam.pocet = volby?.count ?? null; return q },
        eq(s, h) { filtry.push(['eq', s, h]); return q },
        neq(s, h) { filtry.push(['neq', s, h]); return q },
        in(s, h) { filtry.push(['in', s, h]); return q },
        is(s, h) { filtry.push(['is', s, h]); return q },
        gte(s, h) { filtry.push(['gte', s, h]); return q },
        lte(s, h) { filtry.push(['lte', s, h]); return q },
        order(s) { razeni.push(s); return q },
        async maybeSingle() { return { data: vysledek()[0] ?? null, error: null } },
        then(ano, ne) {
          const vse = vysledek()
          const data = vse.slice(0, r.maxRadku)
          return Promise.resolve({ data, error: null, count: zaznam.pocet === 'exact' ? vse.length : null }).then(ano, ne)
        },
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

function priprava({ pristup = true, pobocky = ['b1', 'b2'], rpc, db = DB, maxRadku = Infinity } = {}) {
  globalThis.__r = {
    db,
    pristup,
    pobocky,
    maxRadku,
    dotazy: [],
    volani: [],
    bezi: 0,
    maxSoubeh: 0,
    rpc: rpc ?? ((_jmeno, args) => ({ data: db.shifts.find((s) => s.id === args.p_smena)?.published_at ? 'zrusena' : 'smazana', error: null })),
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
  'dotaz na kandidáty se ptá jen na firmu, pobočku, DALŠÍ dny, nezrušené a téhož člověka (strop řádků — viz hlavičku ruseni.ts)',
  filtry(dotazKandidatu(globalThis.__r)),
  [
    'eq branch_id "b1"',
    'eq employee_id "e1"',
    'eq tenant_id "t1"',
    `in shift_date ${JSON.stringify(['2026-10-15', '2026-10-16', '2026-10-17'])}`,
    'neq status "cancelled"',
  ],
)
je(
  'dotaz je seřazený (den, začátek, id) a ptá se na přesný počet — pojistka proti useknutí',
  [dotazKandidatu(globalThis.__r).razeni, dotazKandidatu(globalThis.__r).pocet],
  [['shift_date', 'starts_at', 'id'], 'exact'],
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
  'dotaz na kandidáty u neobsazené: employee_id IS NULL, stejná pozice, začátek, konec, nezrušené',
  filtry(dotazKandidatu(globalThis.__r)).filter((f) => !/tenant_id|branch_id|shift_date/.test(f)),
  ['eq ends_at "16:00:00"', 'eq position_id "p1"', 'eq starts_at "08:00:00"', 'is employee_id null', 'neq status "cancelled"'],
)
priprava()
await akce.nahledRuseni('cerna-perla', 'o6', ['2026-10-16', '2026-10-15'])
je(
  'neobsazená BEZ pozice: position_id IS NULL (ne eq null)',
  filtry(dotazKandidatu(globalThis.__r)).filter((f) => f.includes('position_id')),
  ['is position_id null'],
)

console.log('\n== Akce: useknutí odpovědi limitem řádků (max_rows) se nesmí tvářit jako „nic“ ==')
/*
  Neobsazená výchozí směna v0 a ve dnech 15. a 16. 10. po jedné shodě
  (v1, v2). Kolem: po DVOU řádcích, které se liší vždy jen jedním z filtrů
  dotazu — zrušené, jiná pozice, jiný začátek, jiný konec, obsazené.
  Limit tři řádky: zúžený dotaz vrátí dvě shody a vejde se. Kdyby kterýkoli
  filtr chyběl, odpovídalo by aspoň čtyři, PostgREST by vrátil tři, počet
  by to prozradil a náhled by se odmítl.
*/
const vRadek = (id, den, prepis = {}) => radekDb(id, { employee_id: null, shift_date: den, ...prepis })
const DB_ORIZNUTI = {
  shifts: [
    vRadek('v0', '2026-10-14'),
    vRadek('v1', '2026-10-15'),
    vRadek('v2', '2026-10-16'),
    ...['2026-10-15', '2026-10-16'].flatMap((den, i) => [
      vRadek(`vz${i}`, den, { status: 'cancelled', published_at: '2026-10-10T10:00:00Z' }),
      vRadek(`vp${i}`, den, { position_id: 'p2' }),
      vRadek(`vs${i}`, den, { starts_at: '09:00:00' }),
      vRadek(`ve${i}`, den, { ends_at: '17:00:00' }),
      vRadek(`vc${i}`, den, { employee_id: 'e1' }),
    ]),
  ],
  employees: [],
  positions: [],
}
const DNY_V = ['2026-10-14', '2026-10-15', '2026-10-16']
priprava({ db: DB_ORIZNUTI, maxRadku: 3 })
const nV = await akce.nahledRuseni('x', 'v0', DNY_V)
je(
  'zúžený dotaz se vejde do limitu: náhled ukáže všechny shody',
  nV.stav === 'ok' ? nV.dny.map((d) => [d.den, d.smeny.map((s) => s.id)]) : nV,
  [
    ['2026-10-14', ['v0']],
    ['2026-10-15', ['v1']],
    ['2026-10-16', ['v2']],
  ],
)
priprava({ db: DB_ORIZNUTI, maxRadku: 1 })
je(
  'shod je víc, než limit vrátí: náhled se ODMÍTNE (ne „nic ke zrušení“ u dne, který se nevešel)',
  await akce.nahledRuseni('x', 'v0', DNY_V),
  { stav: 'chyba', text: 'Ve vybraných dnech je příliš mnoho směn — vyberte méně dní.' },
)
const OTISKY_V = ['v0', 'v1', 'v2'].map((id) => otiskRadku(DB_ORIZNUTI.shifts.find((s) => s.id === id)))
const zV = await zrusit({ rozsah: 'x', smena: 'v0', dny: DNY_V, smeny: OTISKY_V }, { db: DB_ORIZNUTI, maxRadku: 1 })
je('… a stejně i potvrzení: odmítnuto, žádné RPC', [zV.vysledek.stav, zV.rpc.length], ['chyba', 0])

console.log(`\n== Akce: strop ${MAX_SMEN_RUSENI} směn na jedno potvrzení (stejně v náhledu i v potvrzení) ==`)
const posunDen = (den, n) => {
  const [r, m, d] = den.split('-').map(Number)
  return new Date(Date.UTC(r, m - 1, d + n)).toISOString().slice(0, 10)
}
// Člověk e7: výchozí směna 14. 10. a k ní `dalsich` dalších, dvě denně (dopoledne, odpoledne).
function dbSeSmenami(dalsich) {
  const shifts = [radekDb('m0', { employee_id: 'e7', shift_date: '2026-10-14' })]
  for (let n = 1; shifts.length - 1 < dalsich; n++) {
    const den = posunDen('2026-10-14', n)
    shifts.push(radekDb(`m${n}a`, { employee_id: 'e7', shift_date: den, starts_at: '08:00:00', ends_at: '12:00:00' }))
    if (shifts.length - 1 < dalsich) shifts.push(radekDb(`m${n}b`, { employee_id: 'e7', shift_date: den, starts_at: '14:00:00', ends_at: '18:00:00' }))
  }
  return { shifts, employees: [], positions: [] }
}
const dnyDb = (db) => [...new Set(db.shifts.map((s) => s.shift_date))]
const DB_NA_STROPU = dbSeSmenami(MAX_SMEN_RUSENI - 1)
const DB_PRES_STROP = dbSeSmenami(MAX_SMEN_RUSENI)
priprava({ db: DB_NA_STROPU })
const nStrop = await akce.nahledRuseni('x', 'm0', dnyDb(DB_NA_STROPU))
je(`přesně ${MAX_SMEN_RUSENI} směn: náhled projde`, nStrop.stav === 'ok' && nStrop.dny.flatMap((d) => d.smeny).length, MAX_SMEN_RUSENI)
priprava({ db: DB_PRES_STROP })
je(`${MAX_SMEN_RUSENI + 1} směn: náhled se odmítne`, await akce.nahledRuseni('x', 'm0', dnyDb(DB_PRES_STROP)), { stav: 'chyba', text: TEXT_MOC_SMEN })
const zStrop = await zrusit(
  { rozsah: 'x', smena: 'm0', dny: dnyDb(DB_PRES_STROP), smeny: DB_PRES_STROP.shifts.map(otiskRadku) },
  { db: DB_PRES_STROP },
)
je(`${MAX_SMEN_RUSENI + 1} směn: potvrzení odmítne totéž, žádné RPC`, [zStrop.vysledek, zStrop.rpc.length], [{ stav: 'chyba', text: TEXT_MOC_SMEN }, 0])

console.log('\n== Akce náhled: odmítnutí ==')
priprava({ pristup: false })
je('bez shifts.manage: chyba, směna se ani nenačte', [(await akce.nahledRuseni('x', 's0', DNY_CLOVEK)).stav, globalThis.__r.dotazy.length], ['chyba', 0])
priprava({ pobocky: ['b2'] })
je('bez práva na pobočce té směny: chyba, kandidáti se nenačtou', [(await akce.nahledRuseni('x', 's0', DNY_CLOVEK)).stav, globalThis.__r.dotazy.length], ['chyba', 1])
priprava()
je('směna cizí firmy se nenajde', await akce.nahledRuseni('x', 's9', ['2026-10-15']), { stav: 'chyba', text: 'Takovou směnu neznám.' })
priprava()
je('neplatný den: chyba z ověření', (await akce.nahledRuseni('x', 's0', ['2026-10-15', '2026-02-31'])).stav, 'chyba')
priprava()
je(
  'výchozí směna už je zrušená (mezitím jiným vedoucím): odmítnuto, ne „zruší se“',
  await akce.nahledRuseni('x', 's6', ['2026-10-16', '2026-10-17']),
  { stav: 'chyba', text: 'Tahle směna už je zrušená — obnovte rozpis.' },
)
const uzZrusena = await zrusit({
  rozsah: 'x',
  smena: 's6',
  dny: ['2026-10-16', '2026-10-17'],
  smeny: [otiskRadku(DB.shifts.find((s) => s.id === 's6'))],
})
je('… a potvrzení nad ní (souběh mezi náhledem a potvrzením): odmítnuto, žádné RPC', [uzZrusena.vysledek.stav, uzZrusena.rpc.length], ['chyba', 0])

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
je('dny bez směny ke zrušení', z1.vysledek.dnyBezSmen, ['2026-10-17'])
je('souhrn ze skutečného výsledku', souhrnRuseni(z1.vysledek.smeny, z1.vysledek.dnyBezSmen.length), 'Zrušeno 2, smazáno 2, nic ke zrušení: 1 den')
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
    'export async function zrusitViceDni() { return { stav: "nic" } }\n' +
    'export async function dnySeSmenou() { return { stav: "chyba", text: "" } }\n',
)
const modulRuseni = await nactiModul('app/[rozsah]/smeny/ruseni-vice-dni.tsx', [
  ['next/navigation', NAVIGACE],
  ['./ruseni', RUSENI_AKCE],
])

// Stav akce drží rodič (useActionState) — tady se předává rovnou, i „běží“.
const vykreslit = (props = {}) =>
  renderToStaticMarkup(
    createElement(modulRuseni.default, {
      rozsah: 'cerna-perla',
      smena: { id: 's0', shift_date: ZAKLADNI_DEN, employee_id: 'e1' },
      stav: { stav: 'nic' },
      akce: () => {},
      ceka: false,
      onZpet: () => {},
      onHotovo: () => {},
      ...props,
    }),
  )

console.log('\n== Výběr dnů při rušení ==')
const uvod = vykreslit()
const tlacitkoDne = (html, den) => html.match(new RegExp(`<button[^>]*aria-label="[^"]*${den}[^"]*"[^>]*>`))?.[0] ?? ''
je('zaškrtávátko „…i v jiné dny“ tu NENÍ — kreslí ho jednou rodič (fokus při přepnutí)', uvod.includes('type="checkbox"'), false)
je('den výchozí směny (Středa 14. října) je vybraný a zamčený', ['data-zamceno', 'aria-pressed="true"', 'aria-disabled="true"'].every((a) => tlacitkoDne(uvod, 'Středa 14. října').includes(a)), true)
je('jiný den (Čtvrtek 15. října) vybraný není a zamčený taky ne', ['aria-pressed="false"'].every((a) => tlacitkoDne(uvod, 'Čtvrtek 15. října').includes(a)) && !tlacitkoDne(uvod, 'Čtvrtek 15. října').includes('data-zamceno'), true)
je('mřížka začíná pondělím týdne té směny (12. 10.) — 4 týdny', (uvod.match(/class="ds-sm-vd-den"/g) ?? []).length, 28)
je('bez náhledu žádné potvrzovací tlačítko', uvod.includes('type="submit"'), false)
const tlacitkoNahledu = uvod.match(/<button[^>]*>Ukázat, co se zruší<\/button>/)?.[0] ?? ''
je('„Ukázat, co se zruší“ je vidět a s jediným dnem nejde', tlacitkoNahledu.includes('disabled'), true)
je('pravidlo pro člověka je napsané', uvod.includes('všechny směny téhož člověka na této pobočce'), true)
const uvodVolna = vykreslit({ smena: { id: 'o0', shift_date: ZAKLADNI_DEN, employee_id: null } })
je('pravidlo pro neobsazenou je napsané', uvodVolna.includes('se stejnou pozicí a stejným časem'), true)
je(
  '… i to, že v dalším dni zmizí VŠECHNY stejné sloty (ne jen jeden jako ve výchozím dni)',
  uvodVolna.includes('všechny neobsazené směny') && uvodVolna.includes('i když jich je v tom dni víc'),
  true,
)

console.log('\n== Během odesílání (ceka) se nic nemění — výsledek se nesmí ztratit ==')
const behem = vykreslit({ ceka: true })
const zpet = (html) => html.match(/<button[^>]*>Zpět<\/button>/)?.[0] ?? ''
const dnyMrizky = (html) => [...html.matchAll(/<button[^>]*class="ds-sm-vd-den"[^>]*>/g)].map((m) => m[0])
const vicTydnu = (html) => html.match(/<button[^>]*>Zobrazit další týdny<\/button>/)?.[0] ?? ''
je('„Zpět“ v klidu jde', zpet(uvod) !== '' && !zpet(uvod).includes('disabled'), true)
je('„Zpět“ během odesílání nejde (odpojilo by okno i s výsledkem)', zpet(behem).includes('disabled=""'), true)
je('mřížka v klidu: žádný den není vypnutý', dnyMrizky(uvod).filter((b) => b.includes(' disabled=""')).length, 0)
je('mřížka během odesílání: všech 28 dnů vypnutých (výběr se nezmění)', dnyMrizky(behem).filter((b) => b.includes(' disabled=""')).length, 28)
je('„Zobrazit další týdny“ v klidu jde', vicTydnu(uvod) !== '' && !vicTydnu(uvod).includes('disabled'), true)
je('… a během odesílání ne', vicTydnu(behem).includes('disabled=""'), true)

console.log('\n== Po výsledku (stav „hotovo“ od rodiče) ==')
const hotovoHtml = vykreslit({ stav: { stav: 'hotovo', smeny: z1.vysledek.smeny, dnyBezSmen: ['2026-10-17'] } })
je('souhrn místo výběru dnů', hotovoHtml.includes('Zrušeno 2, smazáno 2, nic ke zrušení: 1 den.') && !hotovoHtml.includes('ds-sm-vd-den'), true)
je('výsledek si vezme fokus (tabindex=-1, role=status) — odeslací tlačítko, které ho mělo, zmizelo', /<div class="ds-sm-rv" role="status" tabindex="-1">/.test(hotovoHtml), true)

console.log('\n== Zapojení rozhodnutí v komponentě (ve zdroji — static markup neumí klikat) ==')
const zdrojRV = cist('app/[rozsah]/smeny/ruseni-vice-dni.tsx')
je('platnost náhledu rozhoduje platnyNahled nad SOUČASNÝM výběrem', zdrojRV.includes('const platny = platnyNahled(nahled, vybrane)'), true)
je('zamítnutí rozhoduje jeZamitnuto i s `ceka`', zdrojRV.includes('const zamitnuto = jeZamitnuto(stav, odeslanaVerze, nahled, ceka)'), true)
je('potvrzovací tlačítko jen s platným náhledem a bez zamítnutí', zdrojRV.includes('{platny && !zamitnuto ? ('), true)
je('„Načíst náhled znovu“ během odesílání nejde (vyměnilo by verzi, ke které patří odpověď)', zdrojRV.includes('disabled={nacita || ceka || vybrane.length < 2}'), true)
const odSubmit = zdrojRV.indexOf('onSubmit={() => {')
const onSubmit = odSubmit < 0 ? '' : zdrojRV.slice(odSubmit, zdrojRV.indexOf('}}', odSubmit))
je('onSubmit se ve zdroji našel', onSubmit.length > 20 && onSubmit.length < 200, true)
je('odeslání si pamatuje verzi náhledu', onSubmit.includes('setOdeslanaVerze(platny?.verze ?? null)'), true)
je('odeslání řekne rodiči, ať okno podrží (onOdeslano)', onSubmit.includes('onOdeslano?.()'), true)

console.log('\n== Náhled (NahledRuseni) ==')
const nahledHtml = renderToStaticMarkup(createElement(modulRuseni.NahledRuseni, { dny: n1.dny }))
const radkyDnu = [...nahledHtml.matchAll(/<li class="ds-sm-rv-den"[^>]*>(.*?)<\/li><\/ul><\/li>|<li class="ds-sm-rv-den" data-prazdny="">(.*?)<\/li>/g)].map((m) => (m[1] ?? m[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
je('každý den s datem, časem, kým a co se stane', radkyDnu, [
  'ST 14. 10. 08:00–16:00 Láďa Novák · Kuchař (tato směna) zruší se (vydaná)',
  'ČT 15. 10. 10:00–18:00 Láďa Novák · Kuchař smaže se (nevydaná)',
  'PÁ 16. 10. 08:00–16:00 Láďa Novák · Kuchař zruší se (vydaná) 18:00–22:00 Láďa Novák · Kuchař smaže se (nevydaná)',
  'SO 17. 10. nic ke zrušení',
])
je('vysvětlení u vydaných je vidět', nahledHtml.includes('zmizí, až rozpis vydáte'), true)
je('bez vydaných se vysvětlení nekreslí', renderToStaticMarkup(createElement(modulRuseni.NahledRuseni, { dny: n2.dny })).includes('rozpis vydáte'), false)

console.log('\n== Výsledek (PrehledVysledku) ==')
const vysledekHtml = renderToStaticMarkup(
  createElement(modulRuseni.PrehledVysledku, { smeny: z2.vysledek.smeny, dnuBezSmen: 1, tlacitko: 'ft-tl', onHotovo: () => {} }),
)
je('souhrn v barvě varování (část neprošla)', vysledekHtml.includes('color:var(--pozor)">Smazáno 2, nic ke zrušení: 1 den, 2 chyby.'), true)
je(
  'každá neúspěšná směna se dnem, časem a hláškou',
  [...vysledekHtml.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')),
  [
    'ČT 15. 10. 10:00–18:00: neprošlo — Tahle směna patří pobočce, kterou nespravujete.',
    'PÁ 16. 10. 08:00–16:00: neprošlo — Spojení s databází selhalo.',
  ],
)

/* =====================================================================
   6. Jedna směna beze změny + zapojení rodičů
   ================================================================== */

console.log('\n== Jedna směna: formulář posílá totéž co dřív, zaškrtávátko stojí MIMO něj ==')
/*
  Static markup neumí kliknout na „Smazat směnu“, takže se potvrzení jedné
  směny ověří ve zdroji: v jeho <form> smějí být pole `rozsah` a `smena`
  a nic dalšího. Zaškrtávátko „…i v jiné dny“ v něm být nesmí — Enter na
  zaměřeném zaškrtávátku formulář implicitně odešle (ověřeno v Chromiu),
  takže by smazal jednu směnu bez náhledu.
*/
const formJedne = (zdroj) => {
  const od = zdroj.indexOf('<form action={akceSmazat}')
  const blok = od < 0 ? '' : zdroj.slice(od, zdroj.indexOf('</form>', od))
  return { blok, pole: [...blok.matchAll(/name=["{]([^"}]+)/g)].map((m) => m[1]) }
}
for (const soubor of ['app/[rozsah]/smeny/formular-smeny.tsx', 'app/[rozsah]/smeny/mobil/detail.tsx']) {
  const zdroj = cist(soubor)
  const { blok, pole } = formJedne(zdroj)
  je(`${soubor}: formulář jedné směny se ve zdroji našel`, blok.includes('name="rozsah"') && blok.includes('type="submit"'), true)
  je(`${soubor}: jen rozsah a smena`, pole, ['rozsah', 'smena'])
  je(`${soubor}: volba „…i v jiné dny“ NENÍ ve formuláři jedné směny (Enter by ho odeslal)`, /i v jiné dny|type="checkbox"/.test(blok), false)
  const volba = zdroj.indexOf('ref={volbaRef}')
  je(`${soubor}: zaškrtávátko se kreslí JEDNOU (při přepnutí zůstane tentýž prvek i s fokusem)`, zdroj.split('ref={volbaRef}').length - 1, 1)
  je(
    `${soubor}: … a stojí PŘED oběma podobami, ne uvnitř některé z nich`,
    volba > 0 && volba < zdroj.indexOf('<RuseniViceDni') && volba < zdroj.indexOf('<form action={akceSmazat}'),
    true,
  )
  je(`${soubor}: zaškrtávátko je během odesílání zamčené`, /ref=\{volbaRef\}[^>]*disabled=\{cekaRuseni\}/.test(zdroj), true)
  je(`${soubor}: po výsledku se schová`, /stavRuseni\.stav === ["']hotovo["'] \? null : \(\s*<label className="ds-sm-rv-volba">/.test(zdroj), true)
  je(
    `${soubor}: stav akce drží rodič a předává ho dál (přežije přepnutí)`,
    /<RuseniViceDni[^>]*stav=\{stavRuseni\}[^>]*akce=\{akceRuseni\}[^>]*ceka=\{cekaRuseni\}/.test(zdroj),
    true,
  )
  je(`${soubor}: „Zpět“ z výběru dnů vrátí fokus na zaškrtávátko`, zdroj.includes('volbaRef.current?.focus()'), true)
  je(`${soubor}: při zapnuté volbě neutrální popisek (mix zrušit / smazat)`, zdroj.includes('Zrušit / smazat i v jiné dny'), true)
}

console.log('\n== Zapojení: podržení okna, aby výsledek nezmizel se zrušenou směnou ==')
const zdrojFormulare = cist('app/[rozsah]/smeny/formular-smeny.tsx')
je(
  'panel: chyba rušení JEDNÉ směny se pod rušením ve víc dnech neukazuje',
  zdrojFormulare.includes("{!rusiViceDni && stavSmazani.stav === 'chyba' ? ("),
  true,
)
je('panel: po odeslání si okno podrží rodič (onOdeslano={onPodrzet})', zdrojFormulare.includes('onOdeslano={onPodrzet}'), true)
je('panel: pod rušením ve víc dnech se nekreslí `dole`', zdrojFormulare.includes('{rusiViceDni ? null : dole}'), true)
je('telefon: detail se po odeslání podrží', cist('app/[rozsah]/smeny/mobil/detail.tsx').includes('onOdeslano={() => onPodrzet?.(smena)}'), true)
je('rozpis na počítači podrží okno otevřené odkazem', cist('app/[rozsah]/smeny/rozpis.tsx').includes('onPodrzet={() => setOtevrene((o) => o ?? okno)}'), true)
const zdrojMobil = cist('app/[rozsah]/smeny/mobil/mobilni-rozpis.tsx')
je('mobilní rozpis si směnu podrží', zdrojMobil.includes('onPodrzet={setPodrzeny}'), true)
je('mobilní rozpis vybírá detail přes vyberDetailu (i s podrženou)', zdrojMobil.includes('vyberDetailu([...p.smeny, ...p.mojeSmeny], detailId, podrzeny)'), true)

console.log('\n== CSS (app/_komponenty.css) ==')
const css = cist('app/_komponenty.css')
je(
  'chyby uvnitř okna červené i v detailu na telefonu (přebije `.ds-sm-potvrzeni p`)',
  /\.ds-sm-rv p\.hlaska-chyba \{[^}]*color: var\(--bad\)/.test(css),
  true,
)
je('zaškrtávátko „…i v jiné dny“ 20 px v mosazi', /\.ds-sm-rv-volba input \{[^}]*width: 20px; height: 20px;[^}]*accent-color: var\(--mosaz\)/.test(css), true)
je('samotné „Zpět“ přes celou šířku — jen uvnitř .ds-sm-rv', css.includes('.ds-sm-rv .ds-sm-potvrzeni-akce > :only-child { grid-column: 1 / -1; }'), true)
je('… potvrzení jedné směny (vždy dvě tlačítka) se nemění', /^\.ds-sm-potvrzeni-akce > :only-child/m.test(css), false)
je(
  'věta pod otázkou na telefonu tlumeně a zalomená (přebije `.ds-sm-potvrzeni p`)',
  /\.ds-sm-potvrzeni p\.ds-sm-potvrzeni-pozn \{[^}]*color: var\(--muted\)/.test(css) && !/\.ds-sm-potvrzeni-pozn \{[^}]*nowrap/.test(css),
  true,
)
je(
  '… a detail ji už nekreslí třídou jednořádkového údaje .ds-sm-mista (uřízla se na „až roz…“)',
  /<p className="ds-sm-mista">Zůstane vidět/.test(cist('app/[rozsah]/smeny/mobil/detail.tsx')),
  false,
)

/*
  Fokus, když zaměřené tlačítko zmizí. Do 14. 10. 2026 ho omylem chytal
  panel (Drawer bral fokus při každém překreslení — scripts/ui-okna.test.mjs);
  po opravě Draweru by spadl na <body>. Chování ověřeno klávesnicí
  v headless Chrome, tady se hlídá zapojení.
*/
console.log('\n== Fokus v potvrzení smazání ==')
for (const [soubor, prepinac] of [
  ['app/[rozsah]/smeny/formular-smeny.tsx', 'ptaSeNaSmazani'],
  ['app/[rozsah]/smeny/mobil/detail.tsx', 'pta'],
]) {
  const zdroj = cist(soubor)
  je(`${soubor}: otázka „…tuhle směnu?“ má ref a jde zaměřit`, /<p ref=\{otazkaRef\} tabIndex=\{-1\}/.test(zdroj), true)
  je(`${soubor}: tlačítko „Smazat/Zrušit směnu“ má ref`, /ref=\{smazatRef\}[\s\S]{0,120}onClick=\{\(\) => setPta(SeNaSmazani)?\(true\)\}/.test(zdroj), true)
  je(
    `${soubor}: otevření potvrzení zaměří otázku, „Zpět“ tlačítko — jen při změně, ne při prvním vykreslení`,
    new RegExp(
      `if \\(ptaloSe\\.current === ${prepinac}\\) return;?\\s*ptaloSe\\.current = ${prepinac};?\\s*` +
        `if \\(${prepinac}\\) \\(otazkaRef\\.current \\?\\? volbaRef\\.current\\)\\?\\.focus\\(\\);?\\s*else smazatRef\\.current\\?\\.focus\\(\\)`,
    ).test(zdroj),
    true,
  )
}
je(
  'panel: výsledek uložení dostane fokus (nahradí formulář i s tlačítkem „Uložit“)',
  /if \(stav\.stav === 'hotovo'\) vysledekRef\.current\?\.focus\(\)/.test(zdrojFormulare) &&
    zdrojFormulare.split('<p ref={vysledekRef} tabIndex={-1}').length - 1 === 2,
  true,
)

/*
  Chybové cesty: odesílací tlačítko je během čekání zakázané a Chrome mu
  fokus vezme. Bez přesunu na hlášku skončí na <body> (do 14. 10. 2026 ho
  omylem chytal panel). Samotné „jen když se ztratil“ hlídá ui-okna.
*/
console.log('\n== Fokus na chybových cestách ==')
je(
  'panel: chyba uložení — fokus na hlášku, hláška se ohlásí',
  /else if \(stav\.stav === 'chyba'\) zameritKdyzSeZtratil\(chybaUlozeniRef\.current\)/.test(zdrojFormulare) &&
    zdrojFormulare.includes('<p ref={chybaUlozeniRef} tabIndex={-1} role="alert" className="hlaska-chyba"'),
  true,
)
je(
  'panel: chyba smazání jedné směny — fokus na hlášku, hláška se ohlásí',
  /if \(stavSmazani\.stav === 'chyba'\) zameritKdyzSeZtratil\(chybaSmazaniRef\.current\)/.test(zdrojFormulare) &&
    zdrojFormulare.includes('<p ref={chybaSmazaniRef} tabIndex={-1} role="alert" className="hlaska-chyba"'),
  true,
)
{
  const detail = cist('app/[rozsah]/smeny/mobil/detail.tsx')
  je(
    'telefon: chyba zrušení směny — fokus na hlášku, hláška se ohlásí',
    /if \(stavSmazani\.stav === "chyba"\) zameritKdyzSeZtratil\(chybaSmazaniRef\.current\)/.test(detail) &&
      detail.includes('<p ref={chybaSmazaniRef} tabIndex={-1} role="alert" className="hlaska-chyba"'),
    true,
  )
  const rv = cist('app/[rozsah]/smeny/ruseni-vice-dni.tsx')
  je(
    'víc dnů: po načtení náhledu fokus na chybu náhledu, jinak na souhrn',
    rv.includes('zameritKdyzSeZtratil(chybaNahleduRef.current ?? souhrnRef.current)') &&
      rv.includes('<p ref={chybaNahleduRef} tabIndex={-1}') &&
      rv.includes('<p ref={souhrnRef} tabIndex={-1} className="ds-sm-rv-souhrn"'),
    true,
  )
  je(
    'víc dnů: … jen po skončeném načítání (ne při prvním vykreslení)',
    /if \(nacita\) \{\s*nacitalo\.current = true\s*return\s*\}\s*if \(!nacitalo\.current\) return/.test(rv),
    true,
  )
  je(
    'víc dnů: odmítnutí — fokus na hlášku',
    /if \(zamitnuto\) zameritKdyzSeZtratil\(zamitnutiRef\.current\)/.test(rv) && rv.includes('<p ref={zamitnutiRef} tabIndex={-1}'),
    true,
  )
}

/* =====================================================================
   Dny se směnou v mřížce (Šéfík 15. 10. 2026: „při rušení směn potřebuji
   mít označené dny, kdy je směna v kalendáři, teď hádám“)
   ================================================================== */

console.log('\n== Dny se směnou: čistá funkce (stejné pravidlo jako náhled) ==')
{
  const kandidati = [
    smena('a', { shift_date: '2026-10-15', starts_at: '10:00:00', ends_at: '18:00:00' }),
    smena('c', { shift_date: '2026-10-16', starts_at: '18:00:00', ends_at: '22:00:00' }),
    smena('b', { shift_date: '2026-10-16' }),
    smena('d', { shift_date: '2026-10-17', employee_id: 'e2' }), // jiný člověk
    smena('e', { shift_date: '2026-10-18', branch_id: 'b2' }), // jiná pobočka
    smena('f', { shift_date: '2026-10-19', status: 'cancelled' }), // zrušená
    smena('g', { shift_date: ZAKLADNI_DEN, starts_at: '18:00:00', ends_at: '20:00:00' }), // druhá ve výchozím dni
  ]
  const dny = dnySeSmenouKRuseni(zakladClovek, kandidati)
  je(
    'člověk: dny jeho směn na pobočce s časy (seřazenými); výchozí den jen ona; jiný člověk, pobočka, zrušená nic',
    dny,
    { '2026-10-14': ['08:00–16:00'], '2026-10-15': ['10:00–18:00'], '2026-10-16': ['08:00–16:00', '18:00–22:00'] },
  )
  const kolikByVzal = (d) => vybratKeZruseni(zakladClovek, kandidati, [d]).filter((s) => s.shift_date === d).length
  je(
    'značka v každém dni sedí s tím, co by náhled v tom dni vzal',
    Object.fromEntries(Object.entries(dny).map(([d, c]) => [d, c.length])),
    Object.fromEntries(Object.keys(dny).map((d) => [d, kolikByVzal(d)])),
  )
  const volne = [
    smena('o1', { employee_id: null, shift_date: '2026-10-15' }),
    smena('o2', { employee_id: null, shift_date: '2026-10-15', position_id: 'p2' }),
    smena('o3', { employee_id: null, shift_date: '2026-10-16', starts_at: '09:00:00' }),
    smena('o4', { employee_id: null, shift_date: '2026-10-17' }),
    smena('o5', { employee_id: null, shift_date: '2026-10-17' }),
  ]
  je(
    'neobsazená: jen stejná pozice a čas; dva stejné sloty v jednom dni = dva časy',
    dnySeSmenouKRuseni(zakladVolna, volne),
    { '2026-10-14': ['08:00–16:00'], '2026-10-15': ['08:00–16:00'], '2026-10-17': ['08:00–16:00', '08:00–16:00'] },
  )
  je('čas směny „08:00–16:00“', casSmenyKRuseni({ starts_at: '08:00:00', ends_at: '16:00:00' }), '08:00–16:00')
  je('okno mřížky: 12 týdnů od pondělí týdne výchozí směny', oknoRuseni(ZAKLADNI_DEN), { od: '2026-10-12', doDne: '2027-01-03' })
  je(
    '… stejné okno, jaké hlídá ověření dnů (poslední den ano, den po něm ne)',
    [overitDnyRuseni(['2027-01-03'], ZAKLADNI_DEN).ok, overitDnyRuseni(['2027-01-04'], ZAKLADNI_DEN).ok, overitDnyRuseni(['2026-10-11'], ZAKLADNI_DEN).ok],
    [true, false, false],
  )
}

console.log('\n== Dny se směnou: akce (jen čte, celé okno, stejné zúžení) ==')
{
  priprava()
  const d1 = await akce.dnySeSmenou('cerna-perla', 's0')
  je(
    'člověk: dny jeho směn v okně (i 20. 10.), výchozí den jen ona — ne druhá směna téhož dne, cizí firma, pobočka ani zrušená',
    d1,
    { stav: 'ok', dny: { '2026-10-14': ['08:00–16:00'], '2026-10-15': ['10:00–18:00'], '2026-10-16': ['08:00–16:00', '18:00–22:00'], '2026-10-20': ['08:00–16:00'] } },
  )
  je('nic neruší', globalThis.__r.volani.filter((x) => x[0] === 'rpc').length, 0)
  je(
    'obě linie práv jako u náhledu',
    [globalThis.__r.volani.find((x) => x[0] === 'zkusPristup'), globalThis.__r.volani.find((x) => x[0] === 'hasAccess')],
    [['zkusPristup', 'shifts.manage', 'cerna-perla'], ['hasAccess', 'shifts.manage', 'b1']],
  )
  const dotazOkna = globalThis.__r.dotazy.find((d) => d.tabulka === 'shifts' && d.filtry.some(([op]) => op === 'gte'))
  je(
    'dotaz: firma, pobočka, celé okno mřížky, nezrušené, týž člověk; seřazený a s přesným počtem',
    dotazOkna && [filtry(dotazOkna), dotazOkna.razeni, dotazOkna.pocet],
    [
      ['eq branch_id "b1"', 'eq employee_id "e1"', 'eq tenant_id "t1"', 'gte shift_date "2026-10-12"', 'lte shift_date "2027-01-03"', 'neq status "cancelled"'],
      ['shift_date', 'starts_at', 'id'],
      'exact',
    ],
  )
  priprava()
  je('neobsazená: jen stejné sloty (pozice a čas)', await akce.dnySeSmenou('cerna-perla', 'o0'), { stav: 'ok', dny: { '2026-10-14': ['08:00–16:00'], '2026-10-15': ['08:00–16:00'] } })
  priprava({ maxRadku: 2 })
  const useknuto = await akce.dnySeSmenou('cerna-perla', 's0')
  je('useknutá odpověď (limit řádků) → chyba, ne „tady nic není“', useknuto.stav === 'chyba' && /příliš mnoho/.test(useknuto.text), true)
  priprava({ pristup: false })
  je('bez práva na směny nic', (await akce.dnySeSmenou('cerna-perla', 's0')).stav, 'chyba')
  priprava({ pobocky: ['b2'] })
  je('cizí pobočka té směny nic', (await akce.dnySeSmenou('cerna-perla', 's0')).stav, 'chyba')
  priprava()
  je('už zrušená výchozí směna nic', (await akce.dnySeSmenou('cerna-perla', 's6')).stav, 'chyba')
}

console.log('\n== Dny se směnou: mřížka (vyber-dnu.tsx) ==')
{
  const VyberDnu = await nactiKomponentu('app/[rozsah]/smeny/vyber-dnu.tsx')
  const props = { zacatek: ZAKLADNI_DEN, vybrane: [ZAKLADNI_DEN, '2026-10-16'], pocetTydnu: 1, zamcene: [ZAKLADNI_DEN], onPrepnout() {} }
  const html = renderToStaticMarkup(createElement(VyberDnu, { ...props, oznacene: { [ZAKLADNI_DEN]: ['08:00–16:00'], '2026-10-16': ['08:00–16:00', '18:00–22:00'] } }))
  const den = (d) => html.match(new RegExp(`<button[^>]*aria-label="[^"]*${d}[^"]*"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? ''
  je('dva dny se směnou, dvě tečky', [(html.match(/data-ma-smenu=""/g) ?? []).length, (html.match(/class="ds-sm-vd-tecka"/g) ?? []).length], [2, 2])
  je(
    'pátek 16.: čas v popisku pro odečítač i v bublince, tečka',
    ['aria-label="Pátek 16. října, má směnu 08:00–16:00, 18:00–22:00"', 'title="08:00–16:00, 18:00–22:00"', 'ds-sm-vd-tecka'].every((x) => den('Pátek 16. října').includes(x)),
    true,
  )
  je('zamčený den výchozí směny: čas i „den této směny“', den('Středa 14. října').includes('Středa 14. října, má směnu 08:00–16:00, den této směny'), true)
  je('den bez směny (čtvrtek 15.) bez značky', !den('Čtvrtek 15. října').includes('data-ma-smenu') && !den('Čtvrtek 15. října').includes('ds-sm-vd-tecka'), true)
  const bez = renderToStaticMarkup(createElement(VyberDnu, props))
  je('bez `oznacene` (zakládání víc dnů) se nic nemění', [bez.includes('data-ma-smenu'), bez.includes('ds-sm-vd-tecka'), bez.includes('má směnu')], [false, false, false])
}

console.log('\n== Dny se směnou: zapojení v okně rušení ==')
{
  const rv = cist('app/[rozsah]/smeny/ruseni-vice-dni.tsx')
  je('okno načte dny se směnou jednou po otevření (s ochranou proti pozdní odpovědi)',
    rv.includes("import { dnySeSmenou, nahledRuseni } from './ruseni'")
      && /useEffect\(\(\) => \{\s*let zruseno = false\s*dnySeSmenou\(rozsah, smena\.id\)/.test(rv)
      && /\}, \[rozsah, smena\.id\]\)/.test(rv),
    true)
  je('… a předá je mřížce', rv.includes('oznacene={oznacene ?? undefined}'), true)
  je('legenda pod mřížkou: načítání, vysvětlení tečky (člověk / neobsazená) i chyba',
    ['Hledám, ve kterých dnech směna je…', 'Den, kdy má tenhle člověk na pobočce směnu.', 'Den se stejnou neobsazenou směnou (pozice a čas).', 'Vyberte dny podle rozpisu.'].every((t) => rv.includes(t)),
    true)
  je('v okně se legenda „Hledám…“ ukáže hned (bez značek se dá vybírat dál)', vykreslit().includes('Hledám, ve kterých dnech směna je…'), true)
  const css = cist('app/_komponenty.css')
  je('CSS: legenda drobně a tlumeně i v detailu na telefonu (přebije `.ds-sm-potvrzeni p`)',
    /\.ds-sm-rv p\.ds-sm-rv-legenda \{[^}]*font-size: 12\.5px;[^}]*color: var\(--muted\)/.test(css), true)
  je('CSS: tečka pod číslem dne, na vybraném dni v barvě výběru',
    /\.ds-sm-vd-tecka \{ position: absolute;[^}]*bottom: 6px;/.test(css) && /\.ds-sm-vd-den\[data-vybrano\] \.ds-sm-vd-tecka \{ background: var\(--branch\); \}/.test(css),
    true)
}

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
