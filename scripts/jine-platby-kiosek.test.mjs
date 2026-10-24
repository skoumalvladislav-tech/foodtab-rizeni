#!/usr/bin/env node
/**
 * Kiosek Jiných plateb na telefonu pobočky (zadání Šéfíka 22. 10. 2026,
 * migrace 20261022100000_jine_platby_kiosek) — bez sítě a bez databáze.
 *
 *   1. sdílené jádro (lib/jine-platby-kiosek.ts): klíč, výběr, hlášky,
 *      časový limit, nový klíč odeslání po uzavřeném dokladu;
 *   2. SKUTEČNÉ serverové akce (app/kiosek/doklady/akce.ts) s podvrženým
 *      klientem služby: klíč se ověřuje dřív, než se cokoli zavolá;
 *      firmu a pobočku do cesty dává databáze, ne prohlížeč; než se cokoli
 *      stáhne, databáze ověří klíč a záznam; soubor se stáhne, typ se pozná
 *      z obsahu, otisk spočítá server; smaže se JEN to, co databáze dovolí
 *      (kontrola 24. 10.: dřív šel smazat i cizí originál);
 *   3. skutečná obrazovka telefonu (obrazovka.tsx) ve všech stavech —
 *      žádná finanční data, žádná navigace;
 *   4. manifest telefonu, zdroje a migrace (granty jen service_role,
 *      účel zařízení, žádné `set vlastni.parametr`), nastavení zařízení,
 *      autor ve Financích a čtení Financí před nasazením migrace.
 *
 * Pusť `node scripts/jine-platby-kiosek.test.mjs`.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { adresaModulu, nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
let kontrol = 0
const ok = (popis, podminka) => {
  kontrol++
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zdroj = (cesta) => readFileSync(new URL('../' + cesta, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const js = (kod) => 'data:text/javascript;base64,' + Buffer.from(kod, 'utf8').toString('base64')

const K = await import('../lib/jine-platby-kiosek.ts')
const KLIC = 'a'.repeat(64)
const TENANT = '11111111-1111-4111-8111-111111111111'
const BRANCH = '22222222-2222-4222-8222-222222222222'
const ZAZNAM = '33333333-3333-4333-8333-333333333333'
const KLIENT = '44444444-4444-4444-8444-444444444444'
const CIZI_FIRMA = '77777777-7777-4777-8777-777777777777'
const CIZI_POBOCKA = '88888888-8888-4888-8888-888888888888'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
const TEXT = new TextEncoder().encode('<script>alert(1)</script>')

/* ================================================================== */
console.log('\n== 1. Sdílené jádro ==')
ok('klíč zařízení: jen 64 hex znaků', K.jeKlicZarizeni(KLIC) && !K.jeKlicZarizeni('A'.repeat(64)) && !K.jeKlicZarizeni('a'.repeat(63)) && !K.jeKlicZarizeni(null))
ok('klíč telefonu na doklady je v prohlížeči pod JINÝM jménem než u kiosku Docházky (ten by ho na „neznám“ smazal)',
  K.KLIC_ZARIZENI_ULOZISTE === 'foodtab-kiosek-doklady-klic' && zdroj('app/kiosek/kiosek.tsx').includes("const ULOZISTE = 'foodtab-kiosek-klic'") &&
    !zdroj('app/kiosek/kiosek.tsx').includes(K.KLIC_ZARIZENI_ULOZISTE))
ok('výběr: 1–10 souborů, jen JPEG/PNG/WebP/PDF', !K.overitVyber([]).ok && !K.overitVyber(Array(11).fill({ typ: 'image/jpeg', velikost: 1 })).ok &&
  !K.overitVyber([{ typ: 'image/heic', velikost: 10 }]).ok && !K.overitVyber([{ typ: 'text/html', velikost: 10 }]).ok && K.overitVyber([{ typ: 'image/jpeg', velikost: 10 }, { typ: 'application/pdf', velikost: 10 }]).ok)
ok('výběr: fotka nad 5 MB ne (telefon ji zmenší), PDF do 10 MB ano, prázdná ne',
  !K.overitVyber([{ typ: 'image/jpeg', velikost: 5 * 1024 * 1024 + 1 }]).ok && K.overitVyber([{ typ: 'application/pdf', velikost: 9 * 1024 * 1024 }]).ok &&
    !K.overitVyber([{ typ: 'application/pdf', velikost: 10 * 1024 * 1024 + 1 }]).ok && !K.overitVyber([{ typ: 'image/png', velikost: 0 }]).ok)
ok('stav podle chyby: neznámé zařízení → odpojeno, vypnutý kiosek → vypnuto, uzavřený doklad → uzavreno, jinak chyba (klíč se maže jen u odpojeno)',
  K.stavPodleChyby({ code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' }) === 'odpojeno' &&
    K.stavPodleChyby({ code: '42501', message: K.HLASKA_KIOSEK_VYPNUTY }) === 'vypnuto' &&
    K.stavPodleChyby({ code: '23514', message: K.HLASKA_ODESLANI_UZAVRENO }) === 'uzavreno' &&
    K.stavPodleChyby({ code: '23514', message: K.HLASKA_FOTKY_UZ_NE }) === 'uzavreno' &&
    K.stavPodleChyby({ code: '42501', message: 'permission denied for function x' }) === 'chyba' && K.stavPodleChyby({ code: '23514', message: 'strop' }) === 'chyba')
ok('nový klíč odeslání jen po uzavřeném dokladu — po výpadku sítě ne (opakování vrátí týž záznam)',
  K.novyKlicPoChybe('uzavreno') && !K.novyKlicPoChybe('chyba') && !K.novyKlicPoChybe('odpojeno') && !K.novyKlicPoChybe('vypnuto'))
const O = { odeslana: true }
const N = { odeslana: false }
ok('nový doklad při přidání fotek: prázdný seznam (i po odebrání nebo zrušeném odeslání) a „všechno odešlo“ ano; zbylé neodeslané fotky ne (opakování téhož účtu)',
  K.zacinaNovyDoklad([]) && K.zacinaNovyDoklad([O]) && K.zacinaNovyDoklad([O, O]) && !K.zacinaNovyDoklad([N]) && !K.zacinaNovyDoklad([O, N]))
ok('náhledy: uvolní se jen adresy, které ze seznamu zmizely; zůstávající ne',
  K.nahledyKUvolneni(['blob:a', 'blob:b', 'blob:c'], ['blob:a', 'blob:c']).join() === 'blob:b' && K.nahledyKUvolneni(new Set(['blob:a']), ['blob:a']).length === 0 &&
    K.nahledyKUvolneni(['blob:a'], []).join() === 'blob:a')
const nikdy = new Promise(() => {})
const limit1 = await K.sLimitem(Promise.resolve('hotovo'), 1000).catch((e) => e.message)
const zacatek = Date.now()
const limit2 = await K.sLimitem(nikdy, 30).catch((e) => e.message)
const trvalo = Date.now() - zacatek
const zruseni = new AbortController()
const limit3p = K.sLimitem(nikdy, 5000, zruseni.signal).catch((e) => e.message)
zruseni.abort()
const limit3 = await limit3p
const limit4 = await K.sLimitem(Promise.resolve(1), 1000, zruseni.signal).catch((e) => e.message)
ok('časový limit: rychlá odpověď projde; nekonečné čekání skončí hláškou o pomalém spojení; „Zrušit“ ukončí čekání hned',
  limit1 === 'hotovo' && limit2 === K.HLASKA_POMALE_SPOJENI && trvalo < 1000 && limit3 === K.HLASKA_ZRUSENO && limit4 === K.HLASKA_ZRUSENO)
ok('přehled dnes: převezme JEN čas, počet fotek, poznámku a stav (cokoli dalšího z databáze zahodí); neznámý stav → přijato',
  ((p) => p.length === 2 && Object.keys(p[0]).sort().join() === 'cas,fotek,oznaceni,stav' && p[0].stav === 'zkontrolovano' && p[1].stav === 'prijato' && !('castka_haleru' in p[0]))(
    K.prevzitDnesniDoklady([{ cas: '2026-10-24T12:05:00Z', fotek: 2, oznaceni: 'stůl 4', stav: 'zkontrolovano', castka_haleru: 45000, zaznam: 'x' }, { cas: '2026-10-24T11:00:00Z', fotek: '1', oznaceni: null, stav: 'nesmysl' }])))
ok('přehled dnes: řádek bez platného času se vynechá, nejvýš 50 řádků, ne-pole → prázdno',
  K.prevzitDnesniDoklady([{ cas: 'zitra', fotek: 1, stav: 'prijato' }]).length === 0 &&
    K.prevzitDnesniDoklady(Array(60).fill({ cas: '2026-10-24T12:00:00Z', fotek: 1, oznaceni: '', stav: 'prijato' })).length === 50 && K.prevzitDnesniDoklady({}).length === 0)
ok('čas odeslání v českém čase (14:05 z 12:05 UTC v létě)', K.casOdeslani('2026-10-24T12:05:00Z') === '14:05')
ok('hláška: česká z databáze projde, technika serveru ne', K.hlaskaOdeslani({ message: 'Z tohohle zařízení odešlo za poslední hodinu 20 dokladů' }).startsWith('Z tohohle') &&
  !K.hlaskaOdeslani({ message: 'permission denied for table jine_platby' }).includes('permission'))

/* ================================================================== */
console.log('\n== 2. Serverové akce s podvrženým klientem služby ==')
globalThis.__kiosek = null
const S = () => globalThis.__kiosek
function svet(o = {}) {
  globalThis.__kiosek = {
    bezSluzby: false,
    rpc: [],
    podepsane: [],
    stazene: [],
    smazane: [],
    soubory: {},
    pripojene: [],
    chybaPodpisu: false,
    ...o,
    odpovedi: {
      jine_platby_kiosek_stav: () => ({ data: { pobocka: 'Černá Perla', zarizeni: 'Telefon u baru' }, error: null }),
      jine_platby_kiosek_zalozit: () => ({ data: { zaznam: ZAZNAM, tenant: TENANT, branch: BRANCH }, error: null }),
      jine_platby_kiosek_overit_zaznam: () => ({ data: { zaznam: ZAZNAM, tenant: TENANT, branch: BRANCH }, error: null }),
      jine_platby_kiosek_pripojit_soubor: (a) => (S().pripojene.push(a.p_cesta), { data: { soubor: 'S1', uz_pripojen: false }, error: null }),
      // Jako databáze: smí jen soubor, který v úložišti je a nic na něj neukazuje.
      jine_platby_kiosek_muze_uklidit: (a) => ({ data: Boolean(S().soubory[a.p_cesta]) && !S().pripojene.includes(a.p_cesta), error: null }),
      ...(o.odpovedi ?? {}),
    },
  }
  return globalThis.__kiosek
}
const ULOHA = js(`
export function klientUlohy() {
  const S = globalThis.__kiosek
  if (S.bezSluzby) return null
  return {
    rpc: async (nazev, args) => { S.rpc.push([nazev, args]); const f = S.odpovedi[nazev]; return f ? f(args) : { data: null, error: { code: 'PGRST202', message: 'funkce není' } } },
    storage: { from: (kbelik) => ({
      createSignedUploadUrl: async (cesta) => { S.podepsane.push([kbelik, cesta]); return S.chybaPodpisu ? { data: null, error: { message: 'bucket' } } : { data: { token: 'tok-' + S.podepsane.length, path: cesta, signedUrl: 'x' }, error: null } },
      download: async (cesta) => { S.stazene.push([kbelik, cesta]); const b = S.soubory[cesta]; return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'Object not found' } } },
      remove: async (cesty) => { S.smazane.push(...cesty); return { data: [], error: null } },
    }) },
  }
}
`)
const akce = await import(adresaModulu('app/kiosek/doklady/akce.ts', [['@/lib/supabase/uloha', ULOHA]]))
const nazvyRpc = () => S().rpc.map(([n]) => n)

svet()
const s1 = await akce.nacistStavKiosku('nesmysl')
ok('stav: neplatný klíč → odpojeno a databáze se vůbec nevolá', !s1.ok && s1.stav === 'odpojeno' && S().rpc.length === 0)
svet()
const s2 = await akce.nacistStavKiosku(KLIC)
ok('stav: platný klíč → jen pobočka a název zařízení', s2.ok && s2.pobocka === 'Černá Perla' && s2.zarizeni === 'Telefon u baru' && Object.keys(s2).sort().join() === 'ok,pobocka,zarizeni' &&
  nazvyRpc().join() === 'jine_platby_kiosek_stav' && S().rpc[0][1].p_klic === KLIC)
svet({ odpovedi: { jine_platby_kiosek_stav: () => ({ data: null, error: { code: '42501', message: K.HLASKA_KIOSEK_VYPNUTY } }) } })
const s3 = await akce.nacistStavKiosku(KLIC)
ok('stav: vypnutý kiosek → vypnuto (klíč zůstává)', !s3.ok && s3.stav === 'vypnuto')
svet({ bezSluzby: true })
const s4 = await akce.nacistStavKiosku(KLIC)
ok('bez klíče služby na serveru → srozumitelná chyba, nic se nevolá', !s4.ok && s4.stav === 'chyba' && /nastavení/.test(s4.chyba))

svet()
const pr0 = await akce.nacistDnesniDoklady('nesmysl')
ok('přehled: neplatný klíč → odpojeno, databáze se nevolá', !pr0.ok && pr0.stav === 'odpojeno' && S().rpc.length === 0)
svet({ odpovedi: { jine_platby_kiosek_dnes: () => ({ data: [{ cas: '2026-10-24T12:05:00Z', fotek: 2, oznaceni: 'stůl 4', stav: 'prijato', castka_haleru: 9900 }], error: null }) } })
const pr1 = await akce.nacistDnesniDoklady(KLIC)
ok('přehled: databáze se ptá s klíčem zařízení; na telefon jdou jen čtyři údaje (částka by se zahodila)',
  pr1.ok && S().rpc.length === 1 && S().rpc[0][0] === 'jine_platby_kiosek_dnes' && S().rpc[0][1].p_klic === KLIC && pr1.doklady.length === 1 && !('castka_haleru' in pr1.doklady[0]))
svet({ odpovedi: { jine_platby_kiosek_dnes: () => ({ data: null, error: { code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' } }) } })
const pr2 = await akce.nacistDnesniDoklady(KLIC)
ok('přehled: odvolané zařízení → nic (odpojeno)', !pr2.ok && pr2.stav === 'odpojeno' && !('doklady' in pr2))

const VYBER = [{ typ: 'image/jpeg', velikost: 2000 }, { typ: 'application/pdf', velikost: 3000 }]
svet()
const p0 = await akce.pripravitDoklad({ klic: 'x', oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: neplatný klíč → odpojeno, nic se nezaloží ani nepodepíše', !p0.ok && p0.stav === 'odpojeno' && S().rpc.length === 0 && S().podepsane.length === 0)
svet()
const p1 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: 'neni-uuid', soubory: VYBER })
const p2 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: [{ typ: 'text/html', velikost: 5 }] })
const p3 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: Array(11).fill({ typ: 'image/jpeg', velikost: 5 }) })
ok('příprava: špatný klíč odeslání, typ souboru nebo víc než 10 fotek → nic se nezaloží', !p1.ok && !p2.ok && !p3.ok && S().rpc.length === 0)
svet()
const p4 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '  Stůl 4  ' + 'x'.repeat(300), klientId: KLIENT, soubory: VYBER })
ok('příprava: záznam založí databáze s klíčem zařízení, klíčem odeslání, oříznutým označením a POČTEM FOTEK (databáze počítá vydané adresy)',
  p4.ok && S().rpc.length === 1 && S().rpc[0][0] === 'jine_platby_kiosek_zalozit' && S().rpc[0][1].p_klic === KLIC && S().rpc[0][1].p_klient_id === KLIENT &&
    S().rpc[0][1].p_oznaceni.startsWith('Stůl 4') && S().rpc[0][1].p_oznaceni.length === 200 && S().rpc[0][1].p_souboru === 2)
ok('příprava: cesty z FIRMY A POBOČKY OD DATABÁZE, nové id a přípona podle typu; podepsané v kbelíku jine-platby, právě tolik, kolik je fotek',
  p4.ok && p4.nahrani.length === 2 && S().podepsane.length === 2 && p4.nahrani.every((n) => n.cesta.startsWith(`${TENANT}/${BRANCH}/${ZAZNAM}/`)) &&
    p4.nahrani[0].cesta.endsWith('.jpg') && p4.nahrani[1].cesta.endsWith('.pdf') && p4.nahrani[0].token === 'tok-1' &&
    S().podepsane.every(([b]) => b === 'jine-platby') && p4.zaznam === ZAZNAM)
svet({ odpovedi: { jine_platby_kiosek_zalozit: () => ({ data: null, error: { code: '23514', message: 'Z tohohle zařízení odešlo za poslední hodinu 20 dokladů — víc zatím ne.' } }) } })
const p5 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: strop odeslání z databáze se ukáže, nic se nepodepíše', !p5.ok && p5.chyba.startsWith('Z tohohle zařízení odešlo') && S().podepsane.length === 0)
svet({ odpovedi: { jine_platby_kiosek_zalozit: () => ({ data: null, error: { code: '23514', message: K.HLASKA_ODESLANI_UZAVRENO } }) } })
const p5b = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: opakování k uzavřenému dokladu (nebo nad strop adres) → uzavreno, žádná adresa pro nahrání', !p5b.ok && p5b.stav === 'uzavreno' && S().podepsane.length === 0)
svet({ odpovedi: { jine_platby_kiosek_zalozit: () => ({ data: null, error: { code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' } }) } })
const p6 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: odvolané zařízení → odpojeno', !p6.ok && p6.stav === 'odpojeno')
svet({ chybaPodpisu: true })
const p7 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: podpis nahrání selže → chyba (žádné tokeny)', !p7.ok && !('nahrani' in p7))

const cesta = (id, pripona, zaznam = ZAZNAM, firma = TENANT, pobocka = BRANCH) => `${firma}/${pobocka}/${zaznam}/${id}.${pripona}`
const C1 = cesta('55555555-5555-4555-8555-555555555551', 'jpg')
const C2 = cesta('55555555-5555-4555-8555-555555555552', 'jpg')
const C3 = cesta('55555555-5555-4555-8555-555555555553', 'jpg')
const ORIGINAL = cesta('55555555-5555-4555-8555-555555555559', 'jpg', ZAZNAM, CIZI_FIRMA, CIZI_POBOCKA)
const neznamy = { jine_platby_kiosek_overit_zaznam: () => ({ data: null, error: { code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' } }) }

// Útok z kontroly 24. 10.: klíč ze samých nul a cesta cizího originálu, který v kbelíku je.
svet({ soubory: { [ORIGINAL]: JPEG }, odpovedi: neznamy })
const u1 = await akce.dokoncitDoklad({ klic: '0'.repeat(64), zaznam: ZAZNAM, cesty: [ORIGINAL] })
ok('útok: vymyšlený klíč + cesta cizího originálu → databáze klíč odmítne DŘÍV, nic se nestáhne ani nesmaže',
  !u1.ok && u1.stav === 'odpojeno' && S().stazene.length === 0 && S().smazane.length === 0 && nazvyRpc().join() === 'jine_platby_kiosek_overit_zaznam')
svet({ soubory: { [ORIGINAL]: JPEG } })
const u2 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [ORIGINAL] })
ok('útok: platný telefon + cesta jiné firmy pod vlastním záznamem → firmu a pobočku dává databáze, cesta nesedí, nic se nestáhne ani nesmaže',
  !u2.ok && S().stazene.length === 0 && S().smazane.length === 0 && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor'))
svet({ soubory: { [C1]: TEXT }, odpovedi: neznamy })
const u3 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('odvolaný telefon: ani vlastní nahraný soubor se nestáhne ani nesmaže (zůstane jako neškodný sirotek)',
  !u3.ok && u3.stav === 'odpojeno' && S().stazene.length === 0 && S().smazane.length === 0)
svet({ odpovedi: { jine_platby_kiosek_overit_zaznam: () => ({ data: null, error: { code: '23514', message: K.HLASKA_FOTKY_UZ_NE } }) } })
const u4 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('uzavřený doklad (zkontrolovaný, starší dvou hodin) → uzavreno, nic se nestáhne', !u4.ok && u4.stav === 'uzavreno' && S().stazene.length === 0)

svet()
const d0 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [cesta('55555555-5555-4555-8555-555555555551', 'jpg', '66666666-6666-4666-8666-666666666666')] })
const d0b = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [`${TENANT}/${BRANCH}/${ZAZNAM}/../x.jpg`] })
const d0c = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1, C1] })
ok('dokončení: cesta jiného záznamu, s „..“ nebo dvakrát táž → nic se nestáhne, nepřipojí ani nesmaže',
  !d0.ok && !d0b.ok && !d0c.ok && S().stazene.length === 0 && S().smazane.length === 0 && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor'))
svet()
const d1 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: soubor v úložišti není → chyba, nic se nepřipojí ani nesmaže', !d1.ok && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor') && S().smazane.length === 0)
svet({ soubory: { [C1]: TEXT } })
const d2 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: obsah není fotka (magic bytes) → databáze úklid dovolí, soubor se smaže, nic se nepřipojí',
  !d2.ok && S().smazane.join() === C1 && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor') &&
    S().rpc.some(([n, a]) => n === 'jine_platby_kiosek_muze_uklidit' && a.p_cesta === C1 && a.p_zaznam === ZAZNAM && a.p_klic === KLIC))
svet({ soubory: { [C1]: TEXT }, odpovedi: { jine_platby_kiosek_muze_uklidit: () => ({ data: false, error: null }) } })
const d2b = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
svet({ soubory: { [C1]: TEXT }, odpovedi: { jine_platby_kiosek_muze_uklidit: () => ({ data: null, error: { code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' } }) } })
const d2c = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: když databáze úklid nedovolí (nebo odpoví chybou), nic se NESMAŽE', !d2b.ok && !d2c.ok && S().smazane.length === 0)
svet({ soubory: { [C1]: PNG } })
const d3 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: PNG vydávané za .jpg → smazat (s dovolením databáze), nepřipojit', !d3.ok && S().smazane.includes(C1) && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor'))
const velka = new Uint8Array(5 * 1024 * 1024 + 1)
velka.set(JPEG)
svet({ soubory: { [C1]: velka } })
const d4 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: fotka nad 5 MB (podle stažených bajtů) → smazat (s dovolením databáze), nepřipojit', !d4.ok && S().smazane.includes(C1) && !nazvyRpc().includes('jine_platby_kiosek_pripojit_soubor'))
svet({ soubory: { [C1]: JPEG, [C2]: JPEG } })
const d5 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: platná fotka → nejdřív ověření záznamu, pak připojení s otiskem SPOČÍTANÝM SERVEREM ze stažených bajtů',
  d5.ok && d5.pripojeno === 1 && nazvyRpc().join() === 'jine_platby_kiosek_overit_zaznam,jine_platby_kiosek_pripojit_soubor' &&
    S().rpc[1][1].p_otisk === createHash('sha256').update(JPEG).digest('hex') && S().rpc[1][1].p_cesta === C1 && S().rpc[1][1].p_klic === KLIC && S().smazane.length === 0)
let volani = 0
svet({
  soubory: { [C1]: JPEG, [C2]: new Uint8Array([...JPEG, 1]) },
  odpovedi: {
    jine_platby_kiosek_pripojit_soubor: (a) => (++volani === 2 ? { data: null, error: { code: '23505', message: 'Tahle fotka už v Jiných platbách je.' } } : (S().pripojene.push(a.p_cesta), { data: { soubor: 'S', uz_pripojen: false }, error: null })),
  },
})
const d6 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1, C2] })
ok('dokončení: druhou fotku databáze odmítne → první zůstane připojená (pripojeno 1), druhou databáze dovolí uklidit, hláška projde',
  !d6.ok && d6.pripojeno === 1 && S().smazane.join() === C2 && d6.chyba === 'Tahle fotka už v Jiných platbách je.' &&
    !S().rpc.some(([n, a]) => n === 'jine_platby_kiosek_muze_uklidit' && a.p_cesta === C1))
svet({ soubory: { [C1]: JPEG, [C3]: new Uint8Array([...JPEG, 3]) } })
const d7 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1, C2, C3] })
ok('dokončení: druhá fotka se nestáhne → uklidí se i nahrané zbývající (třetí), připojená první zůstane',
  !d7.ok && d7.pripojeno === 1 && S().smazane.join() === C3)
svet({ soubory: { [C1]: JPEG }, odpovedi: { jine_platby_kiosek_pripojit_soubor: () => ({ data: { soubor: 'S0', uz_pripojen: true }, error: null }) } })
const d8 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: tatáž fotka už u záznamu je (ztracená odpověď) → počítá se jako odeslaná, nová kopie se uklidí',
  d8.ok && d8.pripojeno === 1 && S().smazane.join() === C1)
const serverZdroj = zdroj('lib/jine-platby-kiosek-server.ts')
const dokonceniZdroj = serverZdroj.slice(serverZdroj.indexOf('export async function dokoncitOdeslani'))
ok('server: v dokončení ověření záznamu v databázi dřív než první stažení; smazat jde JEN přes úklid s dovolením databáze',
  dokonceniZdroj.indexOf("'jine_platby_kiosek_overit_zaznam'") > 0 && dokonceniZdroj.indexOf("'jine_platby_kiosek_overit_zaznam'") < dokonceniZdroj.indexOf('z.stahnout(') &&
    (serverZdroj.match(/z\.smazat\(/g) ?? []).length === 1 && /async function uklidit[\s\S]*?'jine_platby_kiosek_muze_uklidit'[\s\S]*?data === true[\s\S]*?z\.smazat\(smi\)/.test(serverZdroj))

/* ================================================================== */
console.log('\n== 3. Obrazovka telefonu ==')
const Obrazovka = await nactiKomponentu('app/kiosek/doklady/obrazovka.tsx')
const nic = () => {}
const AKCE = { registrovat: nic, sparovatZnovu: nic, zkusitZnovu: nic, pridatFotky: nic, odebratFotku: nic, zmenitOznaceni: nic, odeslat: nic, zrusitOdeslani: nic, dalsiDoklad: nic }
const html = (stav) => renderToStaticMarkup(createElement(Obrazovka, { stav, akce: AKCE }))
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const parovani = html({ druh: 'parovani', chyba: '', zPlochy: false })
ok('párování: pole na registrační kód (8 znaků) a odkaz na Nastavení → Zařízení; telefon je jen na doklady',
  /<input[^>]*name="kod"[^>]*maxLength="8"|<input[^>]*maxLength="8"[^>]*name="kod"/i.test(parovani) && text(parovani).includes('Nastavení → Zařízení') &&
    text(parovani).includes('kiosek Docházky na něm nefunguje'))
const foceni = html({ druh: 'foceni', pobocka: 'Černá Perla', zarizeni: 'Telefon u baru', fotky: [{ id: 'a', nahled: 'blob:x', nazev: 'IMG_1.jpg', pdf: false, odeslana: false }, { id: 'b', nahled: null, nazev: 'sjetina.pdf', pdf: true, odeslana: false }], oznaceni: '', chyba: '', odesilam: false, postup: '' })
ok('focení: fotoaparát (capture="environment", jen obrázky) a galerie (víc souborů, i PDF)',
  /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/.test(foceni) && /<input[^>]*type="file"[^>]*accept="image\/\*,application\/pdf"[^>]*multiple/.test(foceni))
ok('focení: tlačítko „Odeslat doklad (2 fotky)“, pobočka a zařízení v hlavičce, poznámka nepovinná (max 200)',
  text(foceni).includes('Odeslat doklad (2 fotky)') && text(foceni).includes('Černá Perla · Telefon u baru') && /<textarea[^>]*maxLength="200"/.test(foceni))
ok('focení: žádná navigace ani odkazy (obsluha se odsud nikam nedostane) a žádné částky', !/<a\b/.test(foceni) && !/Kč|Finance →|Tržby/.test(text(foceni)))
const odesilani = html({ druh: 'foceni', pobocka: 'P', zarizeni: 'Z', fotky: [{ id: 'a', nahled: null, nazev: 'x.jpg', pdf: false, odeslana: false }], oznaceni: '', chyba: '', odesilam: true, postup: 'Nahrávám fotku 1 z 1…' })
ok('odesílání: tlačítko „Zrušit odesílání“ jen během odesílání', text(odesilani).includes('Zrušit odesílání') && !text(foceni).includes('Zrušit odesílání'))
const vseOdeslane = html({ druh: 'foceni', pobocka: 'P', zarizeni: 'Z', fotky: [{ id: 'a', nahled: null, nazev: 'x.jpg', pdf: false, odeslana: true }], oznaceni: '', chyba: 'Druhá fotka neprošla.', odesilam: false, postup: '' })
ok('všechny fotky odešly (zbytek se odebral po chybě) → „Hotovo — vyfotit další doklad“ místo mrtvého Odeslat',
  text(vseOdeslane).includes('Hotovo — vyfotit další doklad') && !text(vseOdeslane).includes('Odeslat doklad') && !text(foceni).includes('Hotovo — vyfotit'))
const DNES = [
  { cas: '2026-10-24T12:05:00Z', fotek: 2, oznaceni: 'stůl 4, firma Novák', stav: 'prijato' },
  { cas: '2026-10-24T09:30:00Z', fotek: 1, oznaceni: '', stav: 'zkontrolovano' },
  { cas: '2026-10-24T08:10:00Z', fotek: 0, oznaceni: 'sjetina', stav: 'bez_fotky' },
]
const sPrehledem = html({ druh: 'foceni', pobocka: 'Černá Perla', zarizeni: 'Telefon u baru', fotky: [], oznaceni: '', chyba: '', odesilam: false, postup: '', dnes: DNES })
ok('přehled dnes na telefonu: čas, počet fotek, poznámka a stav srozumitelně, od nejnovějšího',
  text(sPrehledem).includes('Dnes odesláno z tohoto telefonu') && text(sPrehledem).includes('14:05 · 2 fotky · stůl 4, firma Novák') &&
    text(sPrehledem).includes('Přijato, čeká na kontrolu') && text(sPrehledem).includes('11:30 · 1 fotka') && text(sPrehledem).includes('Zkontrolováno') &&
    text(sPrehledem).includes('Bez fotky — pošlete znovu') && text(sPrehledem).indexOf('14:05') < text(sPrehledem).indexOf('11:30'))
const dlouhe = html({ druh: 'odeslano', pobocka: 'P', pocet: 1, cas: '14:05', dnes: [{ cas: '2026-10-24T12:05:00Z', fotek: 1, oznaceni: 'novak.velmi.dlouhy.email.bez.mezer@firma-s-dlouhym-nazvem.cz', stav: 'prijato' }] })
ok('přehled na 375 px: dlouhé slovo v poznámce se zalomí (overflow-wrap: anywhere, min-width: 0), stránka se neroztáhne do šířky',
  /<li[^>]*style="[^"]*min-width:0[^"]*"[^>]*><span style="[^"]*overflow-wrap:anywhere/.test(dlouhe.replace(/\s*;\s*/g, ';').replace(/:\s+/g, ':')))
ok('přehled: žádné částky, odkazy ani nic z Financí', !/Kč|<a\b|Tržby|položk/i.test(sPrehledem.replace(/Odeslat doklad/g, '')))
ok('přehled: prázdný den řekne „Dnes odsud zatím nic neodešlo“; nenačtený (nebo zakázaný) přehled se neukáže vůbec',
  text(html({ druh: 'foceni', pobocka: 'P', zarizeni: 'Z', fotky: [], oznaceni: '', chyba: '', odesilam: false, postup: '', dnes: [] })).includes('Dnes odsud zatím nic neodešlo') &&
    !text(html({ druh: 'foceni', pobocka: 'P', zarizeni: 'Z', fotky: [], oznaceni: '', chyba: '', odesilam: false, postup: '', dnes: null })).includes('Dnes odesláno'))
ok('po odeslání se přehled ukáže hned pod potvrzením', text(html({ druh: 'odeslano', pobocka: 'Černá Perla', pocet: 2, cas: '14:05', dnes: DNES })).includes('Dnes odesláno z tohoto telefonu'))
const odeslano = html({ druh: 'odeslano', pobocka: 'Černá Perla', pocet: 3, cas: '14:05' })
ok('odesláno: jen potvrzení (počet fotek, čas, pobočka) a „Vyfotit další doklad“', text(odeslano).includes('Doklad (3 fotky) odešel v 14:05') && text(odeslano).includes('Vyfotit další doklad') && !/<a\b/.test(odeslano))
ok('odpojeno: „Spárovat znovu“; vypnuto: kdo ho zapne; výpadek: „Zkusit znovu“',
  text(html({ druh: 'odpojeno' })).includes('Spárovat znovu') && text(html({ druh: 'vypnuto', chyba: '' })).includes('Nastavení → Zařízení') &&
    text(html({ druh: 'vypadek', chyba: 'Spojení vypadlo.' })).includes('Zkusit znovu'))
ok('všechna tlačítka a volby mají aspoň 44 px (velká tlačítka 56 px)', !/min-height:\s*(?:[0-3]?\d|4[0-3])px/.test(foceni + odesilani) && /min-height:56px/.test(foceni.replace(/\s/g, '')))

/* ================================================================== */
console.log('\n== 4. Manifest, zdroje, migrace, nastavení, Finance ==')
const manifestRoute = await import(adresaModulu('app/kiosek/doklady.webmanifest/route.ts'))
const manifest = JSON.parse(await manifestRoute.GET().text())
ok('manifest telefonu: vlastní id/start_url/scope /kiosek/doklady, na výšku (ne tablet Docházky)',
  manifest.id === '/kiosek/doklady' && manifest.start_url === '/kiosek/doklady' && manifest.scope === '/kiosek/doklady' && manifest.orientation === 'portrait')
const stranka = zdroj('app/kiosek/doklady/page.tsx')
ok('stránka kiosku je mimo /[rozsah] a mimo přihlášení a odkazuje svůj manifest', stranka.includes("manifest: '/kiosek/doklady.webmanifest'") && !/getServerSupabase|getCurrentTenantId|zkusPristup|redirect\(/.test(stranka))
const klient = zdroj('app/kiosek/doklady/kiosek-doklady.tsx')
ok('telefon mluví s databází jen anon klientem bez sezení (getKioskSupabase), nikdy přihlašovací cookie', klient.includes('getKioskSupabase') && !klient.includes('getBrowserSupabase'))
ok('telefon se páruje JEN jako telefon na doklady (registrovat_zarizeni_doklady), ne jako tablet Docházky',
  klient.includes("rpc('registrovat_zarizeni_doklady'") && !/rpc\('registrovat_zarizeni'/.test(klient))
ok('klíč zařízení se maže na jediném místě (Spárovat znovu po výslovném „neznám“)', (klient.match(/localStorage\.removeItem/g) ?? []).length === 1 && /function sparovatZnovu\(\) \{\n[^}]*removeItem/.test(klient))
ok('přehled dnes: telefon ho načte po připojení i po každém odeslání; při chybě ho schová a odvolané/vypnuté zařízení přepne obrazovku',
  /nacistDnesniDoklady\(klic\)/.test(klient) && klient.includes('setDnes(p.ok ? p.doklady : null)') &&
    klient.includes("if (!p.ok && p.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })") && klient.includes("else if (!p.ok && p.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })") &&
    /\n\s*setVerzePrehledu\(\(v\) => v \+ 1\)\n\s*const celkem = /.test(klient) && klient.includes('}, [klic, spojeni.druh, verzePrehledu])'))
ok('fotky jdou na podepsané adresy (uploadToSignedUrl), ne přes serverovou akci', klient.includes('uploadToSignedUrl') && !/formData\.append\(/.test(klient))
ok('klíč odeslání: po uzavřeném dokladu (příprava i dokončení) nový; při přidání do prázdného seznamu nebo k už odeslaným fotkám rozhoduje zacinaNovyDoklad',
  (klient.match(/else if \(novyKlicPoChybe\((?:pripraveno|hotovo)\.stav\)\) zacitNovyDokladPoUzavreni\(\)/g) ?? []).length === 2 &&
    /function zacitNovyDokladPoUzavreni\(\) \{\n\s*setKlientId\(noveId\(\)\)\n\s*setFotky\(\(f\) => f\.filter\(\(x\) => !x\.odeslana\)\)/.test(klient) &&
    /if \(zacinaNovyDoklad\(fotky\)\) \{\n\s*setKlientId\(noveId\(\)\)/.test(klient) && !/fotky\.length > 0 && fotky\.every/.test(klient))
ok('přehled se obnovuje sám (jednou za minutu a po návratu na obrazovku); odvolané/vypnuté zařízení ho vyprázdní hned při ověření stavu',
  /window\.setInterval\(obnovit, OBNOVA_PREHLEDU_MS\)/.test(klient) && /document\.addEventListener\('visibilitychange', obnovit\)/.test(klient) &&
    /if \(document\.visibilityState === 'visible'\) setVerzePrehledu\(\(v\) => v \+ 1\)/.test(klient) && klient.includes('if (!s.ok) setDnes(null)') &&
    /window\.clearInterval\(casovac\)/.test(klient))
ok('po limitu nebo chybě se nahrávání opravdu přeruší (abort ve finally), ne jen přestane čekat',
  /\} finally \{\n(?:\s*\/\/[^\n]*\n)*\s*tohleOdeslani\.abort\(\)/.test(klient))
ok('odesílání nikdy nevisí: příprava, každé nahrání i dokončení mají časový limit a jdou zrušit (nahrávání přes klienta se signálem)',
  /sLimitem\(\s*pripravitDoklad\([\s\S]*?LIMIT_AKCE_MS,\s*signal,?\s*\)/.test(klient) && /sLimitem\(kbelik\.uploadToSignedUrl\([^\n]*LIMIT_NAHRANI_MS, signal\)/.test(klient) &&
    /sLimitem\(dokoncitDoklad\([^\n]*LIMIT_AKCE_MS, signal\)/.test(klient) && klient.includes('getKioskSupabaseNahravani(signal)') && klient.includes('zrusitOdeslani: () => zruseni.current?.abort()') &&
    zdroj('lib/supabase/kiosek.ts').includes('global: { fetch: (vstup, init) => fetch(vstup, { ...init, signal }) }'))
const efektNahledu = /useEffect\(\(\) => \{\n\s*const drzene = nahledy\.current\n[\s\S]*?\n {2}\}, \[fotky\]\)/.exec(klient)?.[0] ?? ''
ok('náhledy: efekt seznamu uvolní jen to, co vrátí nahledyKUvolneni, a NEMÁ úklidovou funkci (ta by při každé změně zrušila všechny); zbytek až při odchodu',
  efektNahledu.includes('for (const adresa of nahledyKUvolneni(drzene, ted))') && !/return\b/.test(efektNahledu) && !/fotky\.forEach/.test(efektNahledu) &&
    /return \(\) => drzene\.forEach\(\(adresa\) => URL\.revokeObjectURL\(adresa\)\)\n\s*\}, \[\]\)/.test(klient))
const akceZdroj = zdroj('app/kiosek/doklady/akce.ts')
ok('serverové akce kiosku: jen klient služby a jádro kiosku — žádné akce ani sezení Financí',
  akceZdroj.startsWith("'use server'") && akceZdroj.includes('klientUlohy') && !/getServerSupabase|hasAccess|zkusPristup|finance\//.test(akceZdroj.replace(/\/\*[\s\S]*?\*\//g, '')) &&
    [...akceZdroj.matchAll(/^export (?:async function|const|function|let)\s+(\w+)/gm)].every((m) => m[0].startsWith('export async function')))

const migrace = zdroj('supabase/migrations/20261022100000_jine_platby_kiosek.sql')
const grantFunkce = (jmeno) => {
  const r = new RegExp(`(revoke|grant)[^;]*function public\\.${jmeno}\\([^)]*\\)[^;]*;`, 'g')
  return [...migrace.matchAll(r)].map((m) => m[0])
}
const funkce = (jmeno) => new RegExp(`create (?:or replace )?function ${jmeno.replace('.', '\\.')}\\([\\s\\S]*?\\$\\$;`).exec(migrace)?.[0] ?? ''
ok('migrace: funkce kiosku (stav, přehled, založení, ověření záznamu, úklid, připojení) jen service_role — revoke od public, anon, authenticated, grant nikomu jinému',
  ['jine_platby_kiosek_stav', 'jine_platby_kiosek_dnes', 'jine_platby_kiosek_zalozit', 'jine_platby_kiosek_overit_zaznam', 'jine_platby_kiosek_muze_uklidit', 'jine_platby_kiosek_pripojit_soubor'].every((f) => {
    const g = grantFunkce(f)
    return g.some((x) => /^revoke all on function[\s\S]*from public, anon, authenticated;$/.test(x)) && g.filter((x) => x.startsWith('grant')).every((x) => /to service_role;$/.test(x)) && g.some((x) => x.startsWith('grant'))
  }))
ok('migrace: zapnutí kiosku pro přihlášené (anon ne); pomocné app funkce bez grantu', grantFunkce('jine_platby_kiosek_zapnout').some((x) => /from public, anon;$/.test(x)) &&
  /revoke all on function app\.jp_kiosek_zarizeni\(text\) from public, anon, authenticated;/.test(migrace))
ok('migrace: žádné `set vlastni.parametr` v definici funkce (Supabase ho vlastníkovi migrací nedovolí, 42501)', !/\bset\s+[a-z_]+\.[a-z_]+\s*(=|to)/i.test(migrace))
ok('migrace: hlášky vypnutého kiosku a uzavřeného dokladu jsou tytéž jako v aplikaci; neznámé zařízení táž jako kiosek Docházky',
  migrace.includes(`'${K.HLASKA_KIOSEK_VYPNUTY}'`) && migrace.includes(`'${K.HLASKA_ODESLANI_UZAVRENO}'`) && migrace.includes(`'${K.HLASKA_FOTKY_UZ_NE}'`) &&
    migrace.includes("'Zařízení není registrované nebo bylo odvolané.'"))
ok('migrace: kiosek dokladů jen telefon s účelem „doklady“, aktivní a s výslovně zapnutým kioskem (jine_platby_kiosky)',
  /create table public\.jine_platby_kiosky/.test(funkce('public.jine_platby_kiosek_stav') + migrace) &&
    /where x\.key_hash = encode\(sha256\(convert_to\(coalesce\(p_klic, ''\), 'UTF8'\)\), 'hex'\)\s+and x\.stav = 'active'\s+and x\.ucel = 'doklady';/.test(funkce('app.jp_kiosek_zarizeni')) &&
    /from public\.jine_platby_kiosky k\s+where k\.zarizeni_id = d\.id/.test(funkce('app.jp_kiosek_zarizeni')))
ok('migrace: funkce kiosku Docházky (přes app.zarizeni_podle_klice) a „má pobočka tablet“ berou jen účel „dochazka“',
  /and d\.stav = 'active'\s+and d\.ucel = 'dochazka'/.test(funkce('app.zarizeni_podle_klice')) && /and d\.ucel = 'dochazka'/.test(funkce('public.pobocka_ma_kiosek')))
const registraceSql = funkce('app.registrovat_zarizeni_s_ucelem')
ok('migrace: účel jde do zařízení rovnou při spárování (doklady / Docházka podle adresy) a potom se nemění vůbec (spoušť), přihlášený ho jen čte',
  /app\.registrovat_zarizeni_s_ucelem\(p_kod, 'doklady'\)/.test(funkce('public.registrovat_zarizeni_doklady')) &&
    /app\.registrovat_zarizeni_s_ucelem\(p_kod, 'dochazka'\)/.test(funkce('public.registrovat_zarizeni')) &&
    /\(tenant_id, branch_id, nazev, key_hash, created_by, ucel\)[\s\S]*v_reg\.created_by, p_ucel/.test(registraceSql) && !/update public\.branch_devices set ucel/.test(migrace) &&
    grantFunkce('registrovat_zarizeni_doklady').some((x) => /to anon, authenticated;$/.test(x)) &&
    /if new\.ucel is distinct from old\.ucel then/.test(funkce('app.zarizeni_ucel_nemenny')) &&
    /grant select \(ucel\) on public\.branch_devices to authenticated;/.test(migrace) && !/grant update[^;]*ucel/.test(migrace))
ok('migrace: telefon na doklady má na pobočce jedinečný název (bez ohledu na velikost písmen a mezery)',
  /p_ucel = 'doklady' and exists \([\s\S]*d\.ucel = 'doklady'[\s\S]*lower\(btrim\(d\.nazev\)\) = lower\(btrim\(v_reg\.nazev\)\)/.test(registraceSql))
ok('migrace: zapnout kiosek jde jen na telefonu na doklady', /if d\.ucel <> 'doklady' then/.test(funkce('public.jine_platby_kiosek_zapnout')))
const uklidSql = funkce('public.jine_platby_kiosek_muze_uklidit')
ok('migrace: úklid smí jen soubor záznamu TOHOTO zařízení, na jeho cestě, bez vlastníka a nepřipojený',
  /d := app\.jp_kiosek_zarizeni\(p_klic\);/.test(uklidSql) && /z\.zarizeni_id = d\.id/.test(uklidSql) && /v_c\.zaznam_id is distinct from p_zaznam/.test(uklidSql) &&
    /o\.owner is null/.test(uklidSql) && /or exists \(select 1 from public\.jine_platby_soubory s where s\.cesta = p_cesta\)/.test(uklidSql))
ok('migrace: úklid a připojení se nepředběhnou — úklid rozhoduje pod zámkem záznamu (volatile, for update) a zapíše náhrobek; připojení náhrobek odmítne',
  /language plpgsql volatile security definer/.test(uklidSql) && /z\.zarizeni_id = d\.id\s+for update;/.test(uklidSql) &&
    /insert into public\.jine_platby_kiosek_uklid \(cesta, tenant_id, zaznam_id\)/.test(uklidSql) &&
    /exists \(select 1 from public\.jine_platby_kiosek_uklid u where u\.cesta = p_cesta\)/.test(funkce('public.jine_platby_kiosek_pripojit_soubor')) &&
    /for update;/.test(funkce('public.jine_platby_kiosek_pripojit_soubor')))
const zalozitSql = funkce('public.jine_platby_kiosek_zalozit')
ok('migrace: opakované odeslání vrátí záznam jen otevřený, do dvou hodin a pod stropem adres (zámek dřív než opakování)',
  zalozitSql.indexOf('pg_advisory_xact_lock') > 0 && zalozitSql.indexOf('pg_advisory_xact_lock') < zalozitSql.indexOf('klient_id = p_klient_id and zarizeni_id = d.id') &&
    /v_z\.stav_kontroly <> 'rozpracovano' or v_z\.vytvoreno < now\(\) - interval '2 hours'\s+or v_z\.kiosek_vydano \+ p_souboru > app\.jp_kiosek_strop_adres\(\)/.test(zalozitSql) &&
    /set kiosek_vydano = kiosek_vydano \+ p_souboru/.test(zalozitSql))

const nastaveni = zdroj('app/[rozsah]/nastaveni/zarizeni/page.tsx')
const nastaveniAkce = zdroj('app/[rozsah]/nastaveni/zarizeni/akce.ts')
const dnesSql = /create function public\.jine_platby_kiosek_dnes\(p_klic text\)[\s\S]*?end \$\$;/.exec(migrace)?.[0] ?? ''
ok('migrace: přehled jen pro zařízení z klíče (jp_kiosek_zarizeni), jen jeho záznamy a jen dnešní provozní den pobočky (app.business_date)',
  /d := app\.jp_kiosek_zarizeni\(p_klic\);/.test(dnesSql) && /where z\.zarizeni_id = d\.id and z\.tenant_id = d\.tenant_id and z\.branch_id = d\.branch_id/.test(dnesSql) &&
    /app\.business_date\(d\.branch_id, z\.vytvoreno\) = v_den/.test(dnesSql) && /v_den := app\.business_date\(d\.branch_id, now\(\)\);/.test(dnesSql))
ok('migrace: přehled ukazuje poznámku z telefonu (kiosek_oznaceni, píše ji jen založení) a fotky jen z tohoto telefonu — ne co přepsaly nebo přidaly Finance',
  /'oznaceni', x\.kiosek_oznaceni,/.test(dnesSql) && !/x\.oznaceni\b/.test(dnesSql) && /f\.zaznam_id = z\.id and f\.aktivni and f\.zarizeni_id = d\.id/.test(dnesSql) &&
    !/set\s+kiosek_oznaceni/.test(migrace) && /zarizeni_nazev, kiosek_vydano, kiosek_oznaceni\)/.test(funkce('public.jine_platby_kiosek_zalozit')))
ok('migrace: přehled vrací jen čas, počet fotek, poznámku a stav (žádná částka, důvod zrušení ani id)',
  [...dnesSql.matchAll(/'(\w+)', /g)].map((m) => m[1]).filter((k) => ['cas', 'fotek', 'oznaceni', 'stav'].includes(k)).length === 4 &&
    !/castka|zruseni_duvod|'id'|'zaznam'/.test(dnesSql.replace(/--.*$/gm, '')))
ok('víc zařízení na pobočce: tabulka kiosků má klíč jen zařízení (žádné „jedno na pobočku“)',
  /zarizeni_id uuid primary key references public\.branch_devices/.test(migrace) && !/unique\s*\(\s*(tenant_id,\s*)?branch_id\s*\)/.test(migrace) && !/create unique index[^;]*jine_platby_kiosky/.test(migrace))
ok('Nastavení → Zařízení: přepínač kiosku Jiných plateb jen u aktivního telefonu na doklady (jen po nasazení tabulky); účel se čte i před nasazením migrace',
  nastaveni.includes('action={prepnoutKiosekJinychPlateb}') && nastaveni.includes("z.stav === 'active' && kioskyNasazene && z.ucel === 'doklady'") &&
    /if \(sloupecNeexistuje\(error\)\) \(\{ data, error \} = await nacist\(SLOUPCE_ZARIZENI\)\)/.test(nastaveni) && nastaveni.includes('kiosek Docházky (kód k píchnutí, zálohy, směny) na něm nefunguje'))
ok('… akce: přístup settings.manage, pak funkce databáze (právo a Finance ověří ona)',
  /export async function prepnoutKiosekJinychPlateb[\s\S]*zkusPristup\(tenantId, 'settings\.manage', rozsah\)[\s\S]*rpc\('jine_platby_kiosek_zapnout'/.test(nastaveniAkce))

const L = await import('../app/[rozsah]/finance/trzby/jine-platby/[zaznam]/logika.ts')
ok('Finance: autor záznamu z kiosku je zařízení, ne člověk', L.autorZaznamu({ zdroj: 'kiosek', zarizeniNazev: 'Telefon u baru', vytvoril: null }, {}) === 'kiosek Telefon u baru' &&
  L.autorZaznamu({ zdroj: 'aplikace', zarizeniNazev: null, vytvoril: 'U1' }, { U1: 'Jana' }) === 'Jana' && L.autorZaznamu({ zdroj: 'aplikace', zarizeniNazev: null, vytvoril: null }, {}) === null)
ok('Finance: v historii událost kiosku jako „kiosek …“, bez člověka „systém“',
  L.autorUdalosti(null, { zdroj: 'kiosek', zarizeni_nazev: 'Telefon u baru' }, {}) === 'kiosek Telefon u baru' && L.autorUdalosti(null, {}, {}) === 'systém' && L.autorUdalosti('U1', null, { U1: 'Jana' }) === 'Jana')

// Mezi sloučením a db push: Finance → Jiné platby nesmí spadnout na chybějící sloupce kiosku.
const DB = await import('../lib/jine-platby-db.ts')
const dotazy = []
const zaloha = await DB.cistSeZalohou(async (sloupce) => (dotazy.push(sloupce), dotazy.length === 1 ? { data: null, error: { code: '42703' } } : { data: [{ id: 'z' }], error: null }))
const jinaChyba = await DB.cistSeZalohou(async () => ({ data: null, error: { code: '42501' } }))
ok('Finance před db push: chybí sloupce kiosku (42703) → dotaz znovu bez nich; jiná chyba se vrátí beze změny (nahlas)',
  dotazy.length === 2 && dotazy[0] === DB.SLOUPCE_ZAZNAMU && dotazy[1] === DB.SLOUPCE_ZAZNAMU_ZAKLAD && zaloha.error === null && zaloha.data.length === 1 &&
    jinaChyba.error.code === '42501' && !/\bzdroj\b|zarizeni_nazev/.test(DB.SLOUPCE_ZAZNAMU_ZAKLAD) && DB.zDbZaznam({ id: 'z', tenant_id: 't', branch_id: 'b' }).zdroj === 'aplikace')
const vypis = zdroj('app/[rozsah]/finance/trzby/jine-platby/page.tsx')
const detail = zdroj('app/[rozsah]/finance/trzby/jine-platby/[zaznam]/page.tsx')
const akceZaklad = zdroj('app/[rozsah]/finance/trzby/jine-platby/[zaznam]/akce-zaklad.ts')
ok('… výpis, detail i akce nad záznamem čtou přes cistSeZalohou (žádné přímé SLOUPCE_ZAZNAMU)',
  [vypis, detail, akceZaklad].every((s) => /cistSeZalohou\(\(sloupce\) =>/.test(s) && !s.includes('SLOUPCE_ZAZNAMU')) &&
    vypis.includes('.select(`${sloupce}, jine_platby_soubory(count)`)') && detail.includes('.select(`${sloupce}, faktura_podklady, vydej_externi_id, vydej_doklad, zruseni_duvod`)') &&
    akceZaklad.includes(".from('jine_platby').select(sloupce)"))

console.log(chyb ? `\n${chyb} z ${kontrol} kontrol SELHALO` : `\nVšech ${kontrol} kontrol prošlo`)
process.exit(chyb ? 1 : 0)
