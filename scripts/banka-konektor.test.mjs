#!/usr/bin/env node
/**
 * Registr bankovních konektorů a společná cesta zápisu —
 * lib/banka/konektor.ts, lib/banka/zapis.ts (Finance Fáze 0, krok 1).
 *
 * Pusť `node scripts/banka-konektor.test.mjs`.
 *
 * Konektory se tu podstrkují (žádná síť, žádná databáze). Ověřuje se:
 *   * registr odmítne dvojí nebo prázdného poskytovatele;
 *   * „Synchronizovat teď" dostane jen konektory, které synchronizaci
 *     mají, a mapa nepustí jméno z prototypu (`constructor`, `toString`);
 *   * nabídka (dlaždice, hlášky) je z registru a vynechá, co se nabízet
 *     nesmí;
 *   * úloha zpracuje připojení JEDNO PO DRUHÉM v pořadí registru
 *     a dlouhý konektor po svém stropu času přeskočí;
 *   * řádky pro databázi zachovají pořadí i stejné řádky (pořadí je
 *     v otisku) a protiúčet převedou na jeden tvar;
 *   * zápis jde jedinou RPC `importovat_vypis` a prázdné stažení nic
 *     nezaloží;
 *   * úloha i tlačítko „Synchronizovat teď" berou banky jen z registru.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { vytvoritRegistr, popisNabidky, radkyProImport, synchronizovatVsechnaPripojeni, ZDROJ_BANKY_API } = await import('../lib/banka/konektor.ts')
const { zapsatVypis } = await import('../lib/banka/zapis.ts')
const { synchronizovatPodlePoskytovatele } = await import('../lib/banka-synchronizace.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zkus = async (popis, fn) => {
  try { ok(popis, await fn()) } catch (e) { ok(`${popis} (výjimka: ${e?.message ?? e})`, false) }
}

const deniK = []
function konektor(poskytovatel, nazev, { nabizet = true, pripojeni = null, zacitNejpozdejiMs, vysledek } = {}) {
  const k = { poskytovatel, nazev, druh: pripojeni ? 'api' : 'vypis', nabizetPripojeni: () => nabizet }
  if (pripojeni) {
    k.aktivniPripojeni = async () => pripojeni.map((id) => ({ id }))
    k.synchronizovat = async (id) => {
      deniK.push(`${poskytovatel}:${id}`)
      return vysledek ? vysledek(id) : { stav: 'ok', pocetNovychRadku: 1 }
    }
  }
  if (zacitNejpozdejiMs !== undefined) k.zacitNejpozdejiMs = zacitNejpozdejiMs
  return k
}

console.log('\n== Registr ==')
await zkus('dvakrát tentýž poskytovatel → výjimka', () => {
  try { vytvoritRegistr([konektor('a', 'A'), konektor('a', 'A2')]); return false } catch { return true }
})
await zkus('prázdný poskytovatel → výjimka', () => {
  try { vytvoritRegistr([konektor('  ', 'X')]); return false } catch { return true }
})
const registr = vytvoritRegistr([
  konektor('vypis', 'import výpisu (CSV)'),
  konektor('prvni', 'První', { pripojeni: ['p1', 'p2'] }),
  konektor('ukonceny', 'Ukončený', { nabizet: false, pripojeni: ['u1'] }),
  konektor('dlouhy', 'Dlouhý', { pripojeni: ['d1', 'd2'], zacitNejpozdejiMs: 25_000 }),
  konektor('bez_sync', 'Bez synchronizace'),
])
await zkus('najit podle poskytovatele', () => registr.najit('dlouhy')?.nazev === 'Dlouhý' && registr.najit('nic') === undefined)
await zkus('pořadí registru se zachová', () => registr.vsechny.map((k) => k.poskytovatel).join(',') === 'vypis,prvni,ukonceny,dlouhy,bez_sync')
await zkus('registr nejde zvenku přepsat (zmrazený seznam)', () => Object.isFrozen(registr.vsechny))

console.log('\n== „Synchronizovat teď": mapa z registru ==')
const mapa = registr.synchronizatory()
await zkus('mapa má jen konektory se synchronizací', () => Object.keys(mapa).sort().join(',') === 'dlouhy,prvni,ukonceny')
await zkus('mapa nemá prototyp (jméno „constructor" není synchronizace)', () => Object.getPrototypeOf(mapa) === null)
await zkus('připojení s neznámým poskytovatelem → chyba, nic se nezavolá', async () => {
  const pred = deniK.length
  const v = await synchronizovatPodlePoskytovatele({ id: 'x', poskytovatel: 'constructor' }, mapa)
  return v.stav === 'chyba' && deniK.length === pred
})
await zkus('připojení konektoru bez synchronizace → chyba (ne cizí synchronizace)', async () => {
  const v = await synchronizovatPodlePoskytovatele({ id: 'x', poskytovatel: 'bez_sync' }, mapa)
  return v.stav === 'chyba'
})
await zkus('známý poskytovatel → jeho synchronizace s id připojení', async () => {
  deniK.length = 0
  const v = await synchronizovatPodlePoskytovatele({ id: 'p9', poskytovatel: 'prvni' }, mapa)
  return v.stav === 'ok' && deniK.join() === 'prvni:p9'
})

console.log('\n== Nabídka pro lidi ==')
await zkus('kNabidce vynechá ukončený konektor', () => registr.kNabidce().map((k) => k.poskytovatel).join(',') === 'vypis,prvni,dlouhy,bez_sync')
await zkus('popis nabídky: „a" před posledním, čárky mezi ostatními', () =>
  popisNabidky(registr) === 'import výpisu (CSV), První, Dlouhý a Bez synchronizace')
await zkus('popis nabídky: jedna položka bez „a"', () => popisNabidky({ nazvyKNabidce: () => ['import výpisu (CSV)'] }) === 'import výpisu (CSV)')
await zkus('popis nabídky: dvě položky', () => popisNabidky({ nazvyKNabidce: () => ['A', 'B'] }) === 'A a B')
await zkus('popis nabídky: nic', () => popisNabidky({ nazvyKNabidce: () => [] }) === '')

console.log('\n== Úloha: jedno po druhém, v pořadí registru ==')
await zkus('všechna připojení, v pořadí registru a seznamu', async () => {
  deniK.length = 0
  const v = await synchronizovatVsechnaPripojeni(registr, { zacatek: 0, ted: () => 0 })
  return deniK.join(',') === 'prvni:p1,prvni:p2,ukonceny:u1,dlouhy:d1,dlouhy:d2'
    && v.length === 5 && v.every((x) => x.stav === 'ok' && x.novychRadku === 1)
})
await zkus('ukončený konektor (nenabízí nová připojení) stávající připojení dál synchronizuje', async () => {
  deniK.length = 0
  await synchronizovatVsechnaPripojeni(registr, { zacatek: 0, ted: () => 0 })
  return deniK.includes('ukonceny:u1')
})
await zkus('po stropu času konektor další připojení nezačne (přeskočeno), ostatní ano', async () => {
  deniK.length = 0
  const v = await synchronizovatVsechnaPripojeni(registr, { zacatek: 0, ted: () => 25_001 })
  return deniK.join(',') === 'prvni:p1,prvni:p2,ukonceny:u1'
    && v.filter((x) => x.stav === 'preskoceno').length === 2
})
await zkus('přesně na stropu se ještě začne', async () => {
  deniK.length = 0
  await synchronizovatVsechnaPripojeni(registr, { zacatek: 1000, ted: () => 26_000 })
  return deniK.includes('dlouhy:d1')
})
await zkus('druhé připojení nezačne, když první strop přetáhlo', async () => {
  deniK.length = 0
  let cas = 0
  const r = vytvoritRegistr([konektor('dlouhy', 'Dlouhý', {
    pripojeni: ['d1', 'd2'], zacitNejpozdejiMs: 25_000,
    vysledek: () => { cas = 30_000; return { stav: 'ok', pocetNovychRadku: 4 } },
  })])
  const v = await synchronizovatVsechnaPripojeni(r, { zacatek: 0, ted: () => cas })
  return deniK.join(',') === 'dlouhy:d1' && v[0].novychRadku === 4 && v[1].stav === 'preskoceno'
})
await zkus('chyba jednoho připojení nezastaví další; počet nových jen u „ok"', async () => {
  deniK.length = 0
  const r = vytvoritRegistr([konektor('x', 'X', {
    pripojeni: ['a', 'b'],
    vysledek: (id) => (id === 'a' ? { stav: 'chyba', duvod: 'nejde' } : { stav: 'ok', pocetNovychRadku: 3 }),
  })])
  const v = await synchronizovatVsechnaPripojeni(r, { zacatek: 0, ted: () => 0 })
  return deniK.join(',') === 'x:a,x:b' && v[0].stav === 'chyba' && v[0].novychRadku === 0 && v[1].novychRadku === 3
})
await zkus('synchronizace neběží souběžně (další začne až po dokončení předchozí)', async () => {
  let bezi = 0
  let nejvic = 0
  const r = vytvoritRegistr([konektor('x', 'X', { pripojeni: ['a', 'b', 'c'] })])
  r.vsechny[0].synchronizovat = async () => {
    bezi++; nejvic = Math.max(nejvic, bezi)
    await new Promise((h) => setTimeout(h, 5))
    bezi--
    return { stav: 'ok', pocetNovychRadku: 0 }
  }
  await synchronizovatVsechnaPripojeni(r, { zacatek: 0, ted: () => 0 })
  return nejvic === 1
})

console.log('\n== Řádky pro databázi ==')
const POHYB = { datum: '2026-02-01', smer: 'prijem', castkaHaleru: 100, mena: 'CZK', protistrana: 'Káva', protiucet: '19-2000145399/0800', vs: '1', poznamka: '', externiId: null }
const radky = radkyProImport([POHYB, { ...POHYB }, { ...POHYB, castkaHaleru: 200, externiId: 'id-2' }])
await zkus('dva stejné pohyby zůstanou dva a pořadí se zachová', () =>
  radky.length === 3 && radky[0].castka_haleru === 100 && radky[1].castka_haleru === 100 && radky[2].castka_haleru === 200)
await zkus('klíče v tvaru databáze (snake_case), bez id = null', () =>
  radky[0].externi_id === null && radky[2].externi_id === 'id-2' && 'castka_haleru' in radky[0] && !('castkaHaleru' in radky[0]))
await zkus('protiúčet v jednom tvaru (IBAN)', () => radky[0].protiucet === 'CZ6508000000192000145399')
await zkus('zdroj z banky je neutrální', () => ZDROJ_BANKY_API === 'banka_api')

console.log('\n== Zápis: jedna RPC, atomicky ==')
function klient(odpoved) {
  const volani = []
  return { volani, rpc: async (funkce, parametry) => { volani.push({ funkce, parametry }); return odpoved } }
}
const ZAPIS = { tenantId: 't', ucetId: 'u', zdroj: 'csv_banka', souborNazev: 'v.csv', souborHash: 'h', pohyby: [POHYB, { ...POHYB }] }
await zkus('prázdné stažení: žádná RPC, žádná dávka', async () => {
  const k = klient({ data: null, error: null })
  const v = await zapsatVypis(k, { ...ZAPIS, pohyby: [] })
  return k.volani.length === 0 && v.stav === 'ok' && v.davkaId === null && v.pocetNovych === 0
})
await zkus('volá importovat_vypis s řádky v pořadí (i stejnými)', async () => {
  const k = klient({ data: [{ davka_id: 'd-1', pocet_novych: 2 }], error: null })
  const v = await zapsatVypis(k, ZAPIS)
  const p = k.volani[0]?.parametry
  return k.volani.length === 1 && k.volani[0].funkce === 'importovat_vypis'
    && p.p_tenant === 't' && p.p_ucet === 'u' && p.p_zdroj === 'csv_banka' && p.p_soubor_hash === 'h'
    && p.p_radky.length === 2 && p.p_radky[0].protiucet === 'CZ6508000000192000145399'
    && v.stav === 'ok' && v.davkaId === 'd-1' && v.pocetNovych === 2
})
await zkus('chyba databáze → chyba s kódem (např. 23505 = soubor už importovaný)', async () => {
  const k = klient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "import_davky_tenant_hash"' } })
  const v = await zapsatVypis(k, ZAPIS)
  return v.stav === 'chyba' && v.kod === '23505' && v.duvod.includes('import_davky_tenant_hash')
})
await zkus('databáze nevrátí dávku → chyba, ne „ok s nulou"', async () => {
  const k = klient({ data: [], error: null })
  const v = await zapsatVypis(k, ZAPIS)
  return v.stav === 'chyba'
})
await zkus('jeden řádek místo pole se přečte taky', async () => {
  const k = klient({ data: { davka_id: 'd-2', pocet_novych: 0 }, error: null })
  const v = await zapsatVypis(k, ZAPIS)
  return v.stav === 'ok' && v.davkaId === 'd-2' && v.pocetNovych === 0
})

console.log('\n== Úloha a „Synchronizovat teď" berou banky jen z registru ==')
const cist = (soubor) => readFileSync(path.join(ROOT, soubor), 'utf8')
const tělo = (text, zacatek) => {
  const i = text.indexOf(zacatek)
  if (i === -1) return null
  const konec = text.indexOf('\nexport ', i + zacatek.length)
  return text.slice(i, konec === -1 ? undefined : konec)
}
await zkus('úloha: synchronizovatVsechnaPripojeni(REGISTR_BANK, …)', () =>
  /synchronizovatVsechnaPripojeni\(\s*REGISTR_BANK\b/.test(cist('app/api/uloha/banka-synchronizace/route.ts')))
await zkus('úloha: žádný vlastní seznam synchronizací (import z …-sync)', () =>
  !/from\s+['"][^'"]*-sync['"]/.test(cist('app/api/uloha/banka-synchronizace/route.ts')))
const synchronizovatTeto = tělo(cist('app/[rozsah]/finance/integrace/banka/akce.ts'), 'export async function synchronizovatTeto')
await zkus('„Synchronizovat teď": mapa z REGISTR_BANK.synchronizatory()', () =>
  synchronizovatTeto !== null && /synchronizovatPodlePoskytovatele\([\s\S]*REGISTR_BANK\.synchronizatory\(\)/.test(synchronizovatTeto))
await zkus('„Synchronizovat teď": žádná mapa poskytovatel → funkce napsaná ručně', () =>
  synchronizovatTeto !== null && !/\{\s*[a-z_]+\s*:\s*synchronizovat[A-Z]\w*Pripojeni/.test(synchronizovatTeto))

console.log('\n== Synchronizace bank zapisují přes zapsatVypis se zdrojem banka_api ==')
// Synchronizace samy v Node nejdou pustit (importují next/server) — proto
// text. Každé volání zapsatVypis v souboru musí mít zdroj ZDROJ_BANKY_API;
// jiný zdroj by pohyb od banky vydával za výpis a obešel párování podle id.
const volaniZapisu = (text) => {
  const vysledek = []
  let i = text.indexOf('zapsatVypis(')
  while (i !== -1) {
    const konec = text.indexOf('})', i)
    vysledek.push(text.slice(i, konec === -1 ? undefined : konec))
    i = text.indexOf('zapsatVypis(', i + 1)
  }
  // Jen opravdová volání (klient, { … }), ne zmínky v komentářích.
  return vysledek.filter((v) => /^zapsatVypis\(\s*\w+\s*,\s*\{/.test(v))
}
for (const soubor of ['lib/integrace-fio-sync.ts', 'lib/integrace-saltedge-sync.ts', 'lib/kb-adaa-sync.ts']) {
  const volani = volaniZapisu(cist(soubor))
  await zkus(`${soubor}: zapisuje přes zapsatVypis (aspoň jedno volání)`, () => volani.length >= 1)
  await zkus(`${soubor}: každé volání má zdroj: ZDROJ_BANKY_API`, () =>
    volani.length >= 1 && volani.every((v) => /\bzdroj\s*:\s*ZDROJ_BANKY_API\b/.test(v)))
}
await zkus('ZDROJ_BANKY_API je „banka_api"', () => ZDROJ_BANKY_API === 'banka_api')

console.log('\n== Import výpisu v appce jde stejnou cestou ==')
// Dřív akce založila dávku samostatným zápisem a pohyby až po ní — spadlý
// zápis pohybů nechal dávku a stejný soubor pak šel odmítnout napořád.
const importAkce = cist('app/[rozsah]/finance/platby/import/akce.ts')
await zkus('potvrzení importu zapisuje přes zapsatVypis (dávka i pohyby v jedné transakci)', () =>
  /await\s+zapsatVypis\(\s*supabase\s*,/.test(importAkce))
await zkus('potvrzení importu nezakládá dávku samo ani nevolá importovat_transakce', () =>
  !/from\(\s*['"]import_davky['"]\s*\)\s*\.insert/.test(importAkce) && !/rpc\(\s*['"]importovat_transakce['"]/.test(importAkce))
const nahled = cist('app/[rozsah]/finance/platby/import/akce-nahled.ts')
await zkus('náhled čte bajty souboru přes naparsovatVypis (pozná windows-1250), ne soubor.text()', () =>
  /naparsovatVypis\(\s*new Uint8Array\(\s*await\s+soubor\.arrayBuffer\(\)\s*\)\s*\)/.test(nahled) && !/soubor\.text\(\)\s*$/m.test(nahled.replace(/\/\/.*$/gm, '')))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
