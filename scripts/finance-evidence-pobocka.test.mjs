#!/usr/bin/env node
/**
 * Evidence po pobočkách — Nákup, Zakázky, Vybavení, Rozpočty
 * (lib/finance-evidence-pobocka.ts a serverové akce, které ho používají).
 *
 * Pusť `node scripts/finance-evidence-pobocka.test.mjs`.
 *
 * Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru." Nejcennější kontroly tady:
 *
 *   1. Na pobočce se pobočka nového záznamu NIKDY nebere z formuláře —
 *      skryté pole si kdokoli přepíše a objednávka/zakázka/vybavení/
 *      rozpočet by z Bernard Baru vznikly jiné pobočce nebo celé firmě.
 *   2. Na pobočce akce nesáhne na záznam jiné pobočky ani celé firmy
 *      (vyřazení vybavení, stav zakázky, příjem na objednávku, platba na
 *      zakázku a na firemní účet).
 *   3. Za celou firmu se chování nemění — jen pobočka z formuláře musí
 *      být aktivní pobočka TÉHLE firmy.
 *
 * Akce se tu doopravdy SPOUŠTĚJÍ (module.registerHooks podstrčí
 * `next/*`, přihlášení a falešnou databázi, která filtry `.eq/.is`
 * opravdu uplatní na řádky) — kontrola se dívá, co by odešlo do
 * databáze, ne jestli ve zdrojáku stojí správné slovo. Stránky jsou
 * serverové komponenty s JSX; u nich zbývá kontrola zdroje (dole).
 */

import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const KOREN = path.resolve(import.meta.dirname, '..')

// ---------------------------------------------------------------------
// Podstrčené moduly — jen to, na co akce sahají. Stav drží globalThis.__t.
// ---------------------------------------------------------------------

const STUBY = {
  'next/cache': 'export function revalidatePath() {}',
  'next/navigation':
    "export function redirect(url) { throw Object.assign(new Error('PRESMEROVANI'), { presmerovani: url }) }",
  '@/lib/firma':
    'export const getCurrentTenantId = async () => globalThis.__t.tenantId;' +
    'export const zkusPristup = async (tenantId, pravo, rozsah) => globalThis.__t.zkusPristup(tenantId, pravo, rozsah)',
  '@/lib/authz': 'export const hasAccess = async (...a) => globalThis.__t.hasAccess(...a)',
  '@/lib/supabase/server': 'export const getServerSupabase = async () => globalThis.__t.supabase',
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBY, specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(STUBY[specifier])}`, shortCircuit: true }
    }
    // Zbytek `@/…` jsou skutečné soubory (lib/finance-rozsah.ts, lib/mzdy.ts…).
    if (specifier.startsWith('@/')) {
      return { url: pathToFileURL(path.join(KOREN, `${specifier.slice(2)}.ts`)).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const {
  pobockaZaznamu, zaznamPatriRozsahu, pohledRozpoctu, hodnotaPohleduRozpoctu, ROZPOCTY_FIRMY,
} = await import('../lib/finance-evidence-pobocka.ts')

const nacti = (cesta) => import(pathToFileURL(path.join(KOREN, cesta)).href)
const nakup = await nacti('app/[rozsah]/finance/nakup/akce.ts')
const zakazky = await nacti('app/[rozsah]/finance/zakazky/akce.ts')
const vybaveni = await nacti('app/[rozsah]/finance/vybaveni/akce.ts')
const rozpocty = await nacti('app/[rozsah]/finance/rozpocty/akce.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const FIRMA = 't-firma'
const BERNARD = 'b-bernard'
const KAVARNA = 'b-kavarna'
const VYPNUTA = 'b-vypnuta'
const CIZI = 'b-cizi-firma'

// ---------------------------------------------------------------------
// Falešná databáze: řádky po tabulkách, filtry .eq/.is se na ně
// doopravdy uplatní (update „zasáhne" jen řádky, které jimi projdou).
// ---------------------------------------------------------------------

function zakladniData() {
  return {
    branches: [
      { id: BERNARD, tenant_id: FIRMA, active: true, deleted_at: null },
      { id: KAVARNA, tenant_id: FIRMA, active: true, deleted_at: null },
      { id: VYPNUTA, tenant_id: FIRMA, active: false, deleted_at: null },
      { id: CIZI, tenant_id: 't-cizi', active: true, deleted_at: null },
    ],
    objednavky_dodavatelum: [
      { id: 'obj-b', tenant_id: FIRMA, branch_id: BERNARD },
      { id: 'obj-k', tenant_id: FIRMA, branch_id: KAVARNA },
      { id: 'obj-f', tenant_id: FIRMA, branch_id: null },
    ],
    objednavky_polozky: [
      { id: 'pol-b', tenant_id: FIRMA, objednavka_id: 'obj-b' },
      { id: 'pol-k', tenant_id: FIRMA, objednavka_id: 'obj-k' },
    ],
    zakazky: [
      { id: 'zak-b', tenant_id: FIRMA, branch_id: BERNARD },
      { id: 'zak-k', tenant_id: FIRMA, branch_id: KAVARNA },
      { id: 'zak-f', tenant_id: FIRMA, branch_id: null },
    ],
    platebni_ucty: [
      { id: 'ucet-b', tenant_id: FIRMA, branch_id: BERNARD },
      { id: 'ucet-k', tenant_id: FIRMA, branch_id: KAVARNA },
      { id: 'ucet-f', tenant_id: FIRMA, branch_id: null },
    ],
    vybaveni: [
      { id: 'vyb-b', tenant_id: FIRMA, branch_id: BERNARD, deleted_at: null },
      { id: 'vyb-k', tenant_id: FIRMA, branch_id: KAVARNA, deleted_at: null },
      { id: 'vyb-f', tenant_id: FIRMA, branch_id: null, deleted_at: null },
    ],
  }
}

function falesnaDatabaze(data) {
  const dotazy = []
  const rpc = []
  const projde = (radek, filtry) => filtry.every(([, k, v]) => radek[k] === v)

  function from(tabulka) {
    const d = { tabulka, op: 'select', filtry: [], payload: null, jeden: false, zasazeno: [] }
    dotazy.push(d)
    const b = {
      select() { return b },
      insert(p) { d.op = 'insert'; d.payload = p; return b },
      update(p) { d.op = 'update'; d.payload = p; return b },
      upsert(p) { d.op = 'upsert'; d.payload = p; return b },
      eq(k, v) { d.filtry.push(['eq', k, v]); return b },
      is(k, v) { d.filtry.push(['is', k, v]); return b },
      order() { return b },
      limit() { return b },
      maybeSingle() { d.jeden = true; return b },
      then(splnit, odmitnout) {
        const radky = (data[tabulka] ?? []).filter((r) => projde(r, d.filtry))
        let odpoved = { data: null, error: null }
        if (d.op === 'select') odpoved = { data: d.jeden ? (radky[0] ?? null) : radky, error: null }
        if (d.op === 'update') d.zasazeno = radky.map((r) => r.id)
        return Promise.resolve(odpoved).then(splnit, odmitnout)
      },
    }
    return b
  }

  return {
    dotazy,
    rpc,
    klient: {
      from,
      rpc: async (nazev, argumenty) => {
        rpc.push({ nazev, argumenty })
        return { data: nazev === 'zapsat_prijem_zbozi' ? [] : 'nove-id', error: null }
      },
    },
  }
}

function rozsahZAdresy(rozsah) {
  if (rozsah === 'firma') return { level: 'tenant', branchId: null, branchName: 'Firma', branchSlug: 'firma' }
  if (rozsah === 'bernard-bar') return { level: 'branch', branchId: BERNARD, branchName: 'Bernard Bar', branchSlug: 'bernard-bar' }
  return null
}

/**
 * Spustí akci v rozsahu s poli formuláře. Vrací, kam akce přesměrovala,
 * a co poslala do databáze. `firemniPravo` = odpověď `hasAccess(…, null)`.
 */
async function spust(akce, rozsah, pole, { firemniPravo = true } = {}) {
  const db = falesnaDatabaze(zakladniData())
  globalThis.__t = {
    tenantId: FIRMA,
    supabase: db.klient,
    zkusPristup: async (_t, _pravo, r) => {
      const scope = rozsahZAdresy(r)
      return scope ? { stav: 'ok', ctx: {}, scope } : { stav: 'odepren' }
    },
    hasAccess: async (_t, _pravo, pobocka) => (pobocka === null ? firemniPravo : true),
  }
  const formData = new FormData()
  formData.set('rozsah', rozsah)
  for (const [k, v] of Object.entries(pole)) formData.set(k, v)

  let presmerovani = null
  try {
    await akce(formData)
  } catch (e) {
    if (!e?.presmerovani) throw e
    presmerovani = e.presmerovani
  }
  const zapisy = db.dotazy.filter((d) => d.op !== 'select')
  return { presmerovani, rpc: db.rpc, zapisy, chyba: presmerovani?.includes('chyba=') ?? false }
}

const volaniRpc = (vysledek, nazev) => vysledek.rpc.find((r) => r.nazev === nazev)
const zapis = (vysledek, tabulka, op) => vysledek.zapisy.find((d) => d.tabulka === tabulka && d.op === op)

// =====================================================================
console.log('\n== Čisté funkce: pobočka nového záznamu ==')

const naBernardu = pobockaZaznamu(BERNARD, KAVARNA, [KAVARNA])
ok('na Bernard Baru s podvrženou Kavárnou ve formuláři → Bernard Bar',
  naBernardu.stav === 'ok' && naBernardu.branchId === BERNARD)
const naBernarduPrazdne = pobockaZaznamu(BERNARD, '', [])
ok('na Bernard Baru s prázdným polem („celá firma") → pořád Bernard Bar, ne null',
  naBernarduPrazdne.stav === 'ok' && naBernarduPrazdne.branchId === BERNARD)
const firmaPrazdne = pobockaZaznamu(null, '  ', [BERNARD])
ok('za celou firmu prázdné → záznam celé firmy (null)', firmaPrazdne.stav === 'ok' && firmaPrazdne.branchId === null)
const firmaNic = pobockaZaznamu(null, undefined, [])
ok('za celou firmu chybějící pole → null', firmaNic.stav === 'ok' && firmaNic.branchId === null)
const firmaKavarna = pobockaZaznamu(null, ` ${KAVARNA} `, new Set([BERNARD, KAVARNA]))
ok('za celou firmu aktivní pobočka (s mezerami, Set) → ta pobočka',
  firmaKavarna.stav === 'ok' && firmaKavarna.branchId === KAVARNA)
ok('za celou firmu pobočka mimo seznam → chyba', pobockaZaznamu(null, CIZI, [BERNARD]).stav === 'chyba')
ok('za celou firmu prázdný seznam (dotaz nic nevrátil) → chyba', pobockaZaznamu(null, BERNARD, []).stav === 'chyba')

console.log('\n== Čisté funkce: patří záznam rozsahu? ==')

ok('celá firma: záznam firmy i pobočky smí',
  zaznamPatriRozsahu(null, { branch_id: null }) && zaznamPatriRozsahu(null, { branch_id: KAVARNA }))
ok('celá firma: nenalezený záznam nesmí', !zaznamPatriRozsahu(null, null) && !zaznamPatriRozsahu(null, undefined))
ok('Bernard Bar: jeho záznam smí', zaznamPatriRozsahu(BERNARD, { branch_id: BERNARD }))
ok('Bernard Bar: záznam CELÉ FIRMY (null) nesmí', !zaznamPatriRozsahu(BERNARD, { branch_id: null }))
ok('Bernard Bar: záznam Kavárny nesmí', !zaznamPatriRozsahu(BERNARD, { branch_id: KAVARNA }))
ok('Bernard Bar: nenalezený záznam nesmí', !zaznamPatriRozsahu(BERNARD, null))

console.log('\n== Čisté funkce: čí rozpočty stránka ukazuje ==')

const POBOCKY = [{ id: BERNARD }, { id: KAVARNA }]
ok('na pobočce vždy ta z rozsahu, ?pobocka= se nečte',
  pohledRozpoctu(BERNARD, KAVARNA, POBOCKY) === BERNARD && pohledRozpoctu(BERNARD, ROZPOCTY_FIRMY, POBOCKY) === BERNARD)
ok('za celou firmu ?pobocka=firma → firemní rozpočty (null)', pohledRozpoctu(null, ROZPOCTY_FIRMY, POBOCKY) === null)
ok('za celou firmu id aktivní pobočky → ta pobočka', pohledRozpoctu(null, KAVARNA, POBOCKY) === KAVARNA)
ok('za celou firmu bez výběru → první pobočka jako dosud', pohledRozpoctu(null, undefined, POBOCKY) === BERNARD)
ok('za celou firmu vypnutá / cizí pobočka → první pobočka (ne cizí id do dotazu)',
  pohledRozpoctu(null, VYPNUTA, POBOCKY) === BERNARD && pohledRozpoctu(null, CIZI, POBOCKY) === BERNARD)
ok('firma bez poboček → firemní rozpočty jako dosud', pohledRozpoctu(null, undefined, []) === null)
ok('hodnota výběru: null → "firma", pobočka → její id, a zpět stejný pohled',
  hodnotaPohleduRozpoctu(null) === ROZPOCTY_FIRMY && hodnotaPohleduRozpoctu(KAVARNA) === KAVARNA &&
  [null, BERNARD, KAVARNA].every((p) => pohledRozpoctu(null, hodnotaPohleduRozpoctu(p), POBOCKY) === p))

// =====================================================================
console.log('\n== Nákup: nová objednávka ==')

const POLOZKA = { kontakt_id: 'k-1', nazev_1: 'Mouka', mnozstvi_1: '20', cena_1: '15' }

let v = await spust(nakup.zalozitObjednavku, 'bernard-bar', { ...POLOZKA, branch_id: KAVARNA })
ok('na Bernard Baru s podvrženou Kavárnou → objednávka Bernard Baru',
  volaniRpc(v, 'zalozit_objednavku')?.argumenty.p_branch === BERNARD)
v = await spust(nakup.zalozitObjednavku, 'bernard-bar', { ...POLOZKA, branch_id: '' })
ok('na Bernard Baru s prázdnou pobočkou → Bernard Bar, ne celá firma',
  volaniRpc(v, 'zalozit_objednavku')?.argumenty.p_branch === BERNARD)
v = await spust(nakup.zalozitObjednavku, 'firma', { ...POLOZKA, branch_id: '' })
ok('za celou firmu prázdná pobočka → objednávka celé firmy (null)',
  volaniRpc(v, 'zalozit_objednavku') && volaniRpc(v, 'zalozit_objednavku').argumenty.p_branch === null)
v = await spust(nakup.zalozitObjednavku, 'firma', { ...POLOZKA, branch_id: KAVARNA })
ok('za celou firmu Kavárna → Kavárna', volaniRpc(v, 'zalozit_objednavku')?.argumenty.p_branch === KAVARNA)
v = await spust(nakup.zalozitObjednavku, 'firma', { ...POLOZKA, branch_id: VYPNUTA })
ok('za celou firmu vypnutá pobočka → chyba, objednávka nevznikne', v.chyba && !volaniRpc(v, 'zalozit_objednavku'))
v = await spust(nakup.zalozitObjednavku, 'firma', { ...POLOZKA, branch_id: CIZI })
ok('za celou firmu pobočka CIZÍ firmy → chyba, objednávka nevznikne', v.chyba && !volaniRpc(v, 'zalozit_objednavku'))

console.log('\n== Nákup: příjem zboží ==')

const prijem = (objednavka, polozka, navic = {}) => ({
  objednavka_id: objednavka,
  polozky: JSON.stringify([{ objednavky_polozka_id: polozka, nazev: 'Mouka', jednotka: 'kg', mnozstvi_prijato: 5, cena_za_jednotku_haleru: 1500 }]),
  ...navic,
})

v = await spust(nakup.zapsatPrijem, 'bernard-bar', prijem('obj-k', 'pol-k'))
ok('na Bernard Baru příjem na objednávku Kavárny → chyba, nic se nezapíše', v.chyba && v.rpc.length === 0)
v = await spust(nakup.zapsatPrijem, 'bernard-bar', prijem('obj-f', null))
ok('na Bernard Baru příjem na objednávku CELÉ FIRMY → chyba, nic se nezapíše', v.chyba && v.rpc.length === 0)
v = await spust(nakup.zapsatPrijem, 'bernard-bar', prijem('obj-b', 'pol-b', { branch_id: KAVARNA }))
ok('na Bernard Baru vlastní objednávka s podvrženou pobočkou → příjemka Bernard Baru',
  volaniRpc(v, 'zapsat_prijem_zbozi')?.argumenty.p_branch === BERNARD &&
  volaniRpc(v, 'zapsat_prijem_zbozi')?.argumenty.p_objednavka === 'obj-b')
v = await spust(nakup.zapsatPrijem, 'bernard-bar', prijem('obj-b', 'pol-k'))
ok('vlastní objednávka, ale položka objednávky Kavárny → chyba, nic se nepřičte', v.chyba && v.rpc.length === 0)
v = await spust(nakup.zapsatPrijem, 'firma', prijem('obj-k', 'pol-k', { branch_id: BERNARD }))
ok('za celou firmu pobočka příjemky = pobočka objednávky z databáze (Kavárna), ne z formuláře',
  volaniRpc(v, 'zapsat_prijem_zbozi')?.argumenty.p_branch === KAVARNA)
v = await spust(nakup.zapsatPrijem, 'firma', prijem('obj-f', 'pol-b'))
ok('za celou firmu položka JINÉ objednávky → chyba i tady', v.chyba && v.rpc.length === 0)
v = await spust(nakup.zapsatPrijem, 'firma', prijem('obj-neni', null))
ok('neexistující objednávka → chyba, nic se nezapíše', v.chyba && v.rpc.length === 0)

// =====================================================================
console.log('\n== Zakázky ==')

const ZAKAZKA = { kontakt_id: 'k-1', nazev: 'Vánoční večírek', popis_1: 'Raut', cena_1: '500' }

v = await spust(zakazky.zalozitZakazku, 'bernard-bar', { ...ZAKAZKA, branch_id: KAVARNA })
ok('nová zakázka na Bernard Baru s podvrženou Kavárnou → zakázka Bernard Baru',
  volaniRpc(v, 'zalozit_zakazku')?.argumenty.p_branch === BERNARD)
v = await spust(zakazky.zalozitZakazku, 'firma', { ...ZAKAZKA, branch_id: '' })
ok('za celou firmu prázdná pobočka → zakázka celé firmy (null)',
  volaniRpc(v, 'zalozit_zakazku') && volaniRpc(v, 'zalozit_zakazku').argumenty.p_branch === null)
v = await spust(zakazky.zalozitZakazku, 'firma', { ...ZAKAZKA, branch_id: CIZI })
ok('za celou firmu pobočka cizí firmy → chyba, zakázka nevznikne', v.chyba && !volaniRpc(v, 'zalozit_zakazku'))
v = await spust(zakazky.zalozitZakazku, 'bernard-bar', { ...ZAKAZKA }, { firemniPravo: false })
ok('na pobočce bez finance.read za celou firmu (druhá linie za layoutem) → nic se nezaloží',
  v.presmerovani !== null && !volaniRpc(v, 'zalozit_zakazku'))
v = await spust(zakazky.zalozitZakazku, 'firma', { ...ZAKAZKA }, { firemniPravo: false })
ok('…za celou firmu se tahle brána neptá (chování beze změny)', !!volaniRpc(v, 'zalozit_zakazku'))

v = await spust(zakazky.zmenitStavZakazky, 'bernard-bar', { zakazka_id: 'zak-k', stav: 'zrušeno' })
ok('stav zakázky Kavárny z Bernard Baru → nezasáhne žádný řádek', zapis(v, 'zakazky', 'update')?.zasazeno.length === 0)
v = await spust(zakazky.zmenitStavZakazky, 'bernard-bar', { zakazka_id: 'zak-f', stav: 'zrušeno' })
ok('stav zakázky CELÉ FIRMY z Bernard Baru → nezasáhne žádný řádek', zapis(v, 'zakazky', 'update')?.zasazeno.length === 0)
v = await spust(zakazky.zmenitStavZakazky, 'bernard-bar', { zakazka_id: 'zak-b', stav: 'potvrzeno' })
ok('stav vlastní zakázky → změní ji', zapis(v, 'zakazky', 'update')?.zasazeno.join() === 'zak-b')
v = await spust(zakazky.zmenitStavZakazky, 'firma', { zakazka_id: 'zak-k', stav: 'potvrzeno' })
ok('za celou firmu stav zakázky Kavárny → změní ji (beze změny)', zapis(v, 'zakazky', 'update')?.zasazeno.join() === 'zak-k')

v = await spust(zakazky.zapsatPlatbuZakazky, 'bernard-bar', { zakazka_id: 'zak-b', ucet_id: 'ucet-f', castka: '1000' })
ok('platba vlastní zakázky na FIREMNÍ účet z Bernard Baru → chyba, nic se nezapíše',
  v.chyba && !zapis(v, 'transakce', 'insert'))
v = await spust(zakazky.zapsatPlatbuZakazky, 'bernard-bar', { zakazka_id: 'zak-b', ucet_id: 'ucet-k', castka: '1000' })
ok('platba na účet Kavárny z Bernard Baru → chyba, nic se nezapíše', v.chyba && !zapis(v, 'transakce', 'insert'))
v = await spust(zakazky.zapsatPlatbuZakazky, 'bernard-bar', { zakazka_id: 'zak-k', ucet_id: 'ucet-b', castka: '1000' })
ok('platba na zakázku Kavárny (účet Bernard Baru) → chyba, nic se nezapíše', v.chyba && !zapis(v, 'transakce', 'insert'))
v = await spust(zakazky.zapsatPlatbuZakazky, 'bernard-bar', { zakazka_id: 'zak-b', ucet_id: 'ucet-b', castka: '1000' })
ok('vlastní zakázka + účet Bernard Baru → platba 1000 Kč (100000 haléřů) se zapíše',
  zapis(v, 'transakce', 'insert')?.payload.castka_haleru === 100000 && zapis(v, 'transakce', 'insert')?.payload.ucet_id === 'ucet-b')
v = await spust(zakazky.zapsatPlatbuZakazky, 'firma', { zakazka_id: 'zak-k', ucet_id: 'ucet-f', castka: '1000' })
ok('za celou firmu platba na firemní účet → zapíše se (beze změny)', !!zapis(v, 'transakce', 'insert'))

// =====================================================================
console.log('\n== Vybavení ==')

v = await spust(vybaveni.zalozitVybaveni, 'bernard-bar', { nazev: 'Konvektomat', branch_id: KAVARNA })
ok('nové vybavení na Bernard Baru s podvrženou Kavárnou → vybavení Bernard Baru',
  zapis(v, 'vybaveni', 'insert')?.payload.branch_id === BERNARD)
v = await spust(vybaveni.zalozitVybaveni, 'bernard-bar', { nazev: 'Konvektomat' })
ok('…i bez pole pobočky → Bernard Bar, ne celá firma', zapis(v, 'vybaveni', 'insert')?.payload.branch_id === BERNARD)
v = await spust(vybaveni.zalozitVybaveni, 'firma', { nazev: 'Konvektomat', branch_id: '' })
ok('za celou firmu prázdná pobočka → vybavení celé firmy (null)',
  zapis(v, 'vybaveni', 'insert') && zapis(v, 'vybaveni', 'insert').payload.branch_id === null)
v = await spust(vybaveni.zalozitVybaveni, 'firma', { nazev: 'Konvektomat', branch_id: KAVARNA })
ok('za celou firmu Kavárna → Kavárna', zapis(v, 'vybaveni', 'insert')?.payload.branch_id === KAVARNA)
v = await spust(vybaveni.zalozitVybaveni, 'firma', { nazev: 'Konvektomat', branch_id: VYPNUTA })
ok('za celou firmu vypnutá pobočka → chyba, nic se neuloží', v.chyba && !zapis(v, 'vybaveni', 'insert'))

v = await spust(vybaveni.smazatVybaveni, 'bernard-bar', { id: 'vyb-k' })
ok('vyřazení vybavení Kavárny z Bernard Baru → nezasáhne žádný řádek', zapis(v, 'vybaveni', 'update')?.zasazeno.length === 0)
v = await spust(vybaveni.smazatVybaveni, 'bernard-bar', { id: 'vyb-f' })
ok('vyřazení vybavení CELÉ FIRMY z Bernard Baru → nezasáhne žádný řádek', zapis(v, 'vybaveni', 'update')?.zasazeno.length === 0)
v = await spust(vybaveni.smazatVybaveni, 'bernard-bar', { id: 'vyb-b' })
ok('vyřazení vlastního vybavení → vyřadí ho', zapis(v, 'vybaveni', 'update')?.zasazeno.join() === 'vyb-b')
v = await spust(vybaveni.smazatVybaveni, 'firma', { id: 'vyb-k' })
ok('za celou firmu vyřazení vybavení Kavárny → vyřadí ho (beze změny)', zapis(v, 'vybaveni', 'update')?.zasazeno.join() === 'vyb-k')
v = await spust(vybaveni.smazatVybaveni, 'bernard-bar', { id: 'vyb-b' }, { firemniPravo: false })
ok('na pobočce bez finance.read za celou firmu → nic se nevyřadí', !zapis(v, 'vybaveni', 'update'))

// =====================================================================
console.log('\n== Rozpočty ==')

const ROZPOCET = { kategorie: 'suroviny', smer: 'vydaj', rok: '2026', mesic: '10', castka: '180000' }

v = await spust(rozpocty.zalozitRozpocet, 'bernard-bar', { ...ROZPOCET, branch_id: '' })
ok('rozpočet z Bernard Baru s „Celou firmou" ve formuláři → rozpočet Bernard Baru (nepřepíše firemní)',
  zapis(v, 'rozpocty', 'upsert')?.payload.branch_id === BERNARD)
v = await spust(rozpocty.zalozitRozpocet, 'bernard-bar', { ...ROZPOCET, branch_id: KAVARNA })
ok('rozpočet z Bernard Baru s podvrženou Kavárnou → Bernard Bar', zapis(v, 'rozpocty', 'upsert')?.payload.branch_id === BERNARD)
ok('…a 180 000 Kč jako 18 000 000 haléřů', zapis(v, 'rozpocty', 'upsert')?.payload.castka_haleru === 18_000_000)
ok('…zpět na rozpočty pobočky bez ?pobocka=', v.presmerovani === '/bernard-bar/finance/rozpocty?rok=2026&mesic=10')
v = await spust(rozpocty.zalozitRozpocet, 'firma', { ...ROZPOCET, branch_id: '' })
ok('za celou firmu prázdná pobočka → firemní rozpočet (null)',
  zapis(v, 'rozpocty', 'upsert') && zapis(v, 'rozpocty', 'upsert').payload.branch_id === null)
ok('…a zpět na pohled firemních rozpočtů, kde je vidět', v.presmerovani === '/firma/finance/rozpocty?rok=2026&mesic=10&pobocka=firma')
v = await spust(rozpocty.zalozitRozpocet, 'firma', { ...ROZPOCET, branch_id: KAVARNA })
ok('za celou firmu Kavárna → rozpočet Kavárny a zpět na její pohled',
  zapis(v, 'rozpocty', 'upsert')?.payload.branch_id === KAVARNA && v.presmerovani.endsWith(`&pobocka=${KAVARNA}`))
v = await spust(rozpocty.zalozitRozpocet, 'firma', { ...ROZPOCET, branch_id: CIZI })
ok('za celou firmu pobočka cizí firmy → chyba, nic se neuloží', v.chyba && !zapis(v, 'rozpocty', 'upsert'))
v = await spust(rozpocty.zalozitRozpocet, 'bernard-bar', { ...ROZPOCET }, { firemniPravo: false })
ok('na pobočce bez finance.read za celou firmu → nic se neuloží', !zapis(v, 'rozpocty', 'upsert'))

// =====================================================================
console.log('\n== Zdroj stránek: seznamy filtrují, detaily odmítají cizí záznam ==')

const zdroj = (cesta) => readFileSync(path.join(KOREN, cesta), 'utf8').replace(/\r\n/g, '\n')

for (const [cesta, promenna] of [
  ['app/[rozsah]/finance/nakup/page.tsx', 'dotazObjednavek'],
  ['app/[rozsah]/finance/zakazky/page.tsx', 'dotazZakazek'],
  ['app/[rozsah]/finance/vybaveni/page.tsx', 'dotazVybaveni'],
]) {
  const t = zdroj(cesta)
  ok(`${cesta}: pobočka z rozsahu a seznam .eq('branch_id', pobocka)`,
    /const pobocka = pobockaFinanci\(pristup\.scope\)/.test(t) &&
    new RegExp(`if \\(pobocka\\) ${promenna} = ${promenna}\\.eq\\('branch_id', pobocka\\)`).test(t) &&
    new RegExp(`${promenna}\\s*\\.order\\(`).test(t))
  ok(`${cesta}: na pobočce skryté pole s pobočkou místo výběru „Celá firma"`,
    /\{pobocka \? \(/.test(t) && /<input type="hidden" name="branch_id" value=\{pobocka\} \/>/.test(t))
}

for (const [cesta, data] of [
  ['app/[rozsah]/finance/nakup/[objednavka]/page.tsx', 'objednavkaData'],
  ['app/[rozsah]/finance/zakazky/[zakazka]/page.tsx', 'zakazkaData'],
]) {
  const t = zdroj(cesta)
  const odmitnuti = t.indexOf(`if (!zaznamPatriRozsahu(pobocka, ${data}))`)
  const vykresleni = t.indexOf('<Navigace rozsah={rozsah}>')
  ok(`${cesta}: cizí záznam odmítne DŘÍV, než se cokoli vykreslí`,
    odmitnuti > 0 && vykresleni > 0 && odmitnuti < vykresleni && /branch_id/.test(t.slice(0, odmitnuti)))
}

const detailZakazky = zdroj('app/[rozsah]/finance/zakazky/[zakazka]/page.tsx')
ok('detail zakázky: na pobočce nabízí jen účty pobočky a bez účtu to řekne větou',
  /if \(pobocka\) dotazUctu = dotazUctu\.eq\('branch_id', pobocka\)/.test(detailZakazky) &&
  /smiPsat && pobocka && ucty\.length === 0/.test(detailZakazky))

const stranaRozpoctu = zdroj('app/[rozsah]/finance/rozpocty/page.tsx')
ok('rozpočty: pohled přes pohledRozpoctu(pobocka, …) a ten jde do rozpocet_prehled',
  /const branchId = pohledRozpoctu\(pobocka, pobockaParam, branches\)/.test(stranaRozpoctu) &&
  /rpc\('rozpocet_prehled', \{ p_tenant: tenantId, p_branch: branchId,/.test(stranaRozpoctu))
ok('rozpočty: výběr pobočky jen za celou firmu a v něm volba firemních rozpočtů',
  /\{pobocka \? null : \(\s*<select name="pobocka"/.test(stranaRozpoctu) &&
  /<option value=\{ROZPOCTY_FIRMY\}>/.test(stranaRozpoctu))
ok('rozpočty: pobočka bez účtu → věta místo „0 Kč" skutečnosti',
  /const skrytSkutecnost = pobocka !== null && bezUctu/.test(stranaRozpoctu) &&
  /\{skrytSkutecnost \? \(/.test(stranaRozpoctu) && /BEZ_UCTU_POBOCKY/.test(stranaRozpoctu))

console.log(chyb === 0 ? '\nVše v pořádku.' : `\n${chyb} kontrol selhalo.`)
process.exit(chyb === 0 ? 0 : 1)
