#!/usr/bin/env node
/**
 * Kiosek Jiných plateb na telefonu pobočky (zadání Šéfíka 22. 10. 2026,
 * migrace 20261022100000_jine_platby_kiosek) — bez sítě a bez databáze.
 *
 *   1. sdílené jádro (lib/jine-platby-kiosek.ts): klíč, výběr, hlášky;
 *   2. SKUTEČNÉ serverové akce (app/kiosek/doklady/akce.ts) s podvrženým
 *      klientem služby: klíč se ověřuje dřív, než se cokoli zavolá;
 *      firmu a pobočku do cesty dává databáze, ne prohlížeč; soubor se
 *      stáhne, typ se pozná z obsahu, otisk spočítá server; cokoli selže
 *      → soubor pryč;
 *   3. skutečná obrazovka telefonu (obrazovka.tsx) ve všech stavech —
 *      žádná finanční data, žádná navigace;
 *   4. manifest telefonu, zdroje a migrace (granty jen service_role,
 *      žádné `set vlastni.parametr`), nastavení zařízení a autor ve
 *      Financích.
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
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
const TEXT = new TextEncoder().encode('<script>alert(1)</script>')

/* ================================================================== */
console.log('\n== 1. Sdílené jádro ==')
ok('klíč zařízení: jen 64 hex znaků', K.jeKlicZarizeni(KLIC) && !K.jeKlicZarizeni('A'.repeat(64)) && !K.jeKlicZarizeni('a'.repeat(63)) && !K.jeKlicZarizeni(null))
ok('klíč v prohlížeči je TENTÝŽ jako u kiosku Docházky (jedno spárování)', zdroj('app/kiosek/kiosek.tsx').includes(`const ULOZISTE = '${K.KLIC_ZARIZENI_ULOZISTE}'`))
ok('výběr: 1–10 souborů, jen JPEG/PNG/WebP/PDF', !K.overitVyber([]).ok && !K.overitVyber(Array(11).fill({ typ: 'image/jpeg', velikost: 1 })).ok &&
  !K.overitVyber([{ typ: 'image/heic', velikost: 10 }]).ok && !K.overitVyber([{ typ: 'text/html', velikost: 10 }]).ok && K.overitVyber([{ typ: 'image/jpeg', velikost: 10 }, { typ: 'application/pdf', velikost: 10 }]).ok)
ok('výběr: fotka nad 5 MB ne (telefon ji zmenší), PDF do 10 MB ano, prázdná ne',
  !K.overitVyber([{ typ: 'image/jpeg', velikost: 5 * 1024 * 1024 + 1 }]).ok && K.overitVyber([{ typ: 'application/pdf', velikost: 9 * 1024 * 1024 }]).ok &&
    !K.overitVyber([{ typ: 'application/pdf', velikost: 10 * 1024 * 1024 + 1 }]).ok && !K.overitVyber([{ typ: 'image/png', velikost: 0 }]).ok)
ok('stav podle chyby: neznámé zařízení → odpojeno, vypnutý kiosek → vypnuto, jinak chyba (klíč se maže jen u odpojeno)',
  K.stavPodleChyby({ code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' }) === 'odpojeno' &&
    K.stavPodleChyby({ code: '42501', message: K.HLASKA_KIOSEK_VYPNUTY }) === 'vypnuto' &&
    K.stavPodleChyby({ code: '42501', message: 'permission denied for function x' }) === 'chyba' && K.stavPodleChyby({ code: '23514', message: 'strop' }) === 'chyba')
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
    chybaPodpisu: false,
    odpovedi: {
      jine_platby_kiosek_stav: () => ({ data: { pobocka: 'Černá Perla', zarizeni: 'Telefon u baru' }, error: null }),
      jine_platby_kiosek_zalozit: () => ({ data: { zaznam: ZAZNAM, tenant: TENANT, branch: BRANCH }, error: null }),
      jine_platby_kiosek_pripojit_soubor: () => ({ data: 'S1', error: null }),
    },
    ...o,
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
ok('příprava: záznam založí databáze s klíčem zařízení, klíčem odeslání a oříznutým označením',
  p4.ok && S().rpc.length === 1 && S().rpc[0][0] === 'jine_platby_kiosek_zalozit' && S().rpc[0][1].p_klic === KLIC && S().rpc[0][1].p_klient_id === KLIENT &&
    S().rpc[0][1].p_oznaceni.startsWith('Stůl 4') && S().rpc[0][1].p_oznaceni.length === 200)
ok('příprava: cesty z FIRMY A POBOČKY OD DATABÁZE, nové id a přípona podle typu; podepsané v kbelíku jine-platby',
  p4.ok && p4.nahrani.length === 2 && p4.nahrani.every((n) => n.cesta.startsWith(`${TENANT}/${BRANCH}/${ZAZNAM}/`)) &&
    p4.nahrani[0].cesta.endsWith('.jpg') && p4.nahrani[1].cesta.endsWith('.pdf') && p4.nahrani[0].token === 'tok-1' &&
    S().podepsane.every(([b]) => b === 'jine-platby') && p4.zaznam === ZAZNAM)
svet({ odpovedi: { jine_platby_kiosek_zalozit: () => ({ data: null, error: { code: '23514', message: 'Z tohohle zařízení odešlo za poslední hodinu 20 dokladů — víc zatím ne.' } }) } })
const p5 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: strop odeslání z databáze se ukáže, nic se nepodepíše', !p5.ok && p5.chyba.startsWith('Z tohohle zařízení odešlo') && S().podepsane.length === 0)
svet({ odpovedi: { jine_platby_kiosek_zalozit: () => ({ data: null, error: { code: '42501', message: 'Zařízení není registrované nebo bylo odvolané.' } }) } })
const p6 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: odvolané zařízení → odpojeno', !p6.ok && p6.stav === 'odpojeno')
svet({ chybaPodpisu: true })
const p7 = await akce.pripravitDoklad({ klic: KLIC, oznaceni: '', klientId: KLIENT, soubory: VYBER })
ok('příprava: podpis nahrání selže → chyba (žádné tokeny)', !p7.ok && !('nahrani' in p7))

const cesta = (id, pripona, zaznam = ZAZNAM) => `${TENANT}/${BRANCH}/${zaznam}/${id}.${pripona}`
const C1 = cesta('55555555-5555-4555-8555-555555555551', 'jpg')
const C2 = cesta('55555555-5555-4555-8555-555555555552', 'jpg')
svet()
const d0 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [cesta('55555555-5555-4555-8555-555555555551', 'jpg', '66666666-6666-4666-8666-666666666666')] })
const d0b = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [`${TENANT}/${BRANCH}/${ZAZNAM}/../x.jpg`] })
ok('dokončení: cesta jiného záznamu nebo s „..“ → nic se nestáhne ani nepřipojí', !d0.ok && !d0b.ok && S().stazene.length === 0 && S().rpc.length === 0)
svet()
const d1 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: soubor v úložišti není → chyba, nic se nepřipojí', !d1.ok && S().rpc.length === 0)
svet({ soubory: { [C1]: TEXT } })
const d2 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: obsah není fotka (magic bytes) → soubor se smaže, nic se nepřipojí', !d2.ok && S().smazane.includes(C1) && S().rpc.length === 0)
svet({ soubory: { [C1]: PNG } })
const d3 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: PNG vydávané za .jpg → smazat, nepřipojit', !d3.ok && S().smazane.includes(C1) && S().rpc.length === 0)
const velka = new Uint8Array(5 * 1024 * 1024 + 1)
velka.set(JPEG)
svet({ soubory: { [C1]: velka } })
const d4 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: fotka nad 5 MB (podle stažených bajtů) → smazat, nepřipojit', !d4.ok && S().smazane.includes(C1) && S().rpc.length === 0)
svet({ soubory: { [C1]: JPEG, [C2]: JPEG } })
const d5 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1] })
ok('dokončení: platná fotka → databáze ji připojí s otiskem SPOČÍTANÝM SERVEREM ze stažených bajtů',
  d5.ok && d5.pripojeno === 1 && S().rpc.length === 1 && S().rpc[0][0] === 'jine_platby_kiosek_pripojit_soubor' &&
    S().rpc[0][1].p_otisk === createHash('sha256').update(JPEG).digest('hex') && S().rpc[0][1].p_cesta === C1 && S().rpc[0][1].p_klic === KLIC && S().smazane.length === 0)
let volani = 0
svet({
  soubory: { [C1]: JPEG, [C2]: new Uint8Array([...JPEG, 1]) },
  odpovedi: { jine_platby_kiosek_pripojit_soubor: () => (++volani === 2 ? { data: null, error: { code: '23505', message: 'Tahle fotka už v Jiných platbách je.' } } : { data: 'S', error: null }) },
})
const d6 = await akce.dokoncitDoklad({ klic: KLIC, zaznam: ZAZNAM, cesty: [C1, C2] })
ok('dokončení: druhou fotku databáze odmítne → první zůstane připojená (pripojeno 1), druhá se smaže, hláška projde',
  !d6.ok && d6.pripojeno === 1 && S().smazane.join() === C2 && d6.chyba === 'Tahle fotka už v Jiných platbách je.')

/* ================================================================== */
console.log('\n== 3. Obrazovka telefonu ==')
const Obrazovka = await nactiKomponentu('app/kiosek/doklady/obrazovka.tsx')
const nic = () => {}
const AKCE = { registrovat: nic, sparovatZnovu: nic, zkusitZnovu: nic, pridatFotky: nic, odebratFotku: nic, zmenitOznaceni: nic, odeslat: nic, dalsiDoklad: nic }
const html = (stav) => renderToStaticMarkup(createElement(Obrazovka, { stav, akce: AKCE }))
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const parovani = html({ druh: 'parovani', chyba: '', zPlochy: false })
ok('párování: pole na registrační kód (8 znaků) a odkaz na Nastavení → Zařízení', /<input[^>]*name="kod"[^>]*maxLength="8"|<input[^>]*maxLength="8"[^>]*name="kod"/i.test(parovani) && text(parovani).includes('Nastavení → Zařízení'))
const foceni = html({ druh: 'foceni', pobocka: 'Černá Perla', zarizeni: 'Telefon u baru', fotky: [{ id: 'a', nahled: 'blob:x', nazev: 'IMG_1.jpg', pdf: false, odeslana: false }, { id: 'b', nahled: null, nazev: 'sjetina.pdf', pdf: true, odeslana: false }], oznaceni: '', chyba: '', odesilam: false, postup: '' })
ok('focení: fotoaparát (capture="environment", jen obrázky) a galerie (víc souborů, i PDF)',
  /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/.test(foceni) && /<input[^>]*type="file"[^>]*accept="image\/\*,application\/pdf"[^>]*multiple/.test(foceni))
ok('focení: tlačítko „Odeslat doklad (2 fotky)“, pobočka a zařízení v hlavičce, poznámka nepovinná (max 200)',
  text(foceni).includes('Odeslat doklad (2 fotky)') && text(foceni).includes('Černá Perla · Telefon u baru') && /<textarea[^>]*maxLength="200"/.test(foceni))
ok('focení: žádná navigace ani odkazy (obsluha se odsud nikam nedostane) a žádné částky', !/<a\b/.test(foceni) && !/Kč|Finance →|Tržby/.test(text(foceni)))
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
ok('všechna tlačítka a volby mají aspoň 44 px (velká tlačítka 56 px)', !/min-height:\s*(?:[0-3]?\d|4[0-3])px/.test(foceni) && /min-height:56px/.test(foceni.replace(/\s/g, '')))

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
ok('klíč zařízení se maže na jediném místě (Spárovat znovu po výslovném „neznám“)', (klient.match(/localStorage\.removeItem/g) ?? []).length === 1 && /function sparovatZnovu\(\) \{\n[^}]*removeItem/.test(klient))
ok('přehled dnes: telefon ho načte po připojení i po každém odeslání; při chybě ho schová a odvolané/vypnuté zařízení přepne obrazovku',
  /nacistDnesniDoklady\(klic\)/.test(klient) && klient.includes('setDnes(p.ok ? p.doklady : null)') &&
    klient.includes("if (!p.ok && p.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })") && klient.includes("else if (!p.ok && p.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })") &&
    /setVerzePrehledu\(\(v\) => v \+ 1\)/.test(klient) && klient.includes('}, [klic, spojeni.druh, verzePrehledu])'))
ok('fotky jdou na podepsané adresy (uploadToSignedUrl), ne přes serverovou akci', klient.includes('uploadToSignedUrl') && !/formData\.append\(/.test(klient))
const akceZdroj = zdroj('app/kiosek/doklady/akce.ts')
ok('serverové akce kiosku: jen klient služby a jádro kiosku — žádné akce ani sezení Financí',
  akceZdroj.startsWith("'use server'") && akceZdroj.includes('klientUlohy') && !/getServerSupabase|hasAccess|zkusPristup|finance\//.test(akceZdroj.replace(/\/\*[\s\S]*?\*\//g, '')) &&
    [...akceZdroj.matchAll(/^export (?:async function|const|function|let)\s+(\w+)/gm)].every((m) => m[0].startsWith('export async function')))

const migrace = zdroj('supabase/migrations/20261022100000_jine_platby_kiosek.sql')
const grantFunkce = (jmeno) => {
  const r = new RegExp(`(revoke|grant)[^;]*function public\\.${jmeno}\\([^)]*\\)[^;]*;`, 'g')
  return [...migrace.matchAll(r)].map((m) => m[0])
}
ok('migrace: funkce kiosku (stav, přehled, založení, připojení) jen service_role — revoke od public, anon, authenticated, grant nikomu jinému',
  ['jine_platby_kiosek_stav', 'jine_platby_kiosek_dnes', 'jine_platby_kiosek_zalozit', 'jine_platby_kiosek_pripojit_soubor'].every((f) => {
    const g = grantFunkce(f)
    return g.some((x) => /^revoke all on function[\s\S]*from public, anon, authenticated;$/.test(x)) && g.filter((x) => x.startsWith('grant')).every((x) => /to service_role;$/.test(x)) && g.some((x) => x.startsWith('grant'))
  }))
ok('migrace: zapnutí kiosku pro přihlášené (anon ne); pomocné app funkce bez grantu', grantFunkce('jine_platby_kiosek_zapnout').some((x) => /from public, anon;$/.test(x)) &&
  /revoke all on function app\.jp_kiosek_zarizeni\(text\) from public, anon, authenticated;/.test(migrace))
ok('migrace: žádné `set vlastni.parametr` v definici funkce (Supabase ho vlastníkovi migrací nedovolí, 42501)', !/\bset\s+[a-z_]+\.[a-z_]+\s*(=|to)/i.test(migrace))
ok('migrace: hláška vypnutého kiosku je táž jako v aplikaci; neznámé zařízení táž jako kiosek Docházky',
  migrace.includes(`'${K.HLASKA_KIOSEK_VYPNUTY}'`) && migrace.includes("'Zařízení není registrované nebo bylo odvolané.'"))
ok('migrace: kiosek je na zařízení nutné výslovně zapnout (jine_platby_kiosky), odvolané zařízení neprojde (app.zarizeni_podle_klice)',
  /create table public\.jine_platby_kiosky/.test(migrace) && /d := app\.zarizeni_podle_klice\(p_klic\);/.test(migrace) && /from public\.jine_platby_kiosky k\s+where k\.zarizeni_id = d\.id/.test(migrace))

const nastaveni = zdroj('app/[rozsah]/nastaveni/zarizeni/page.tsx')
const nastaveniAkce = zdroj('app/[rozsah]/nastaveni/zarizeni/akce.ts')
const dnesSql = /create function public\.jine_platby_kiosek_dnes\(p_klic text\)[\s\S]*?end \$\$;/.exec(migrace)?.[0] ?? ''
ok('migrace: přehled jen pro zařízení z klíče (jp_kiosek_zarizeni), jen jeho záznamy a jen dnešní provozní den pobočky (app.business_date)',
  /d := app\.jp_kiosek_zarizeni\(p_klic\);/.test(dnesSql) && /where z\.zarizeni_id = d\.id and z\.tenant_id = d\.tenant_id and z\.branch_id = d\.branch_id/.test(dnesSql) &&
    /app\.business_date\(d\.branch_id, z\.vytvoreno\) = v_den/.test(dnesSql) && /v_den := app\.business_date\(d\.branch_id, now\(\)\);/.test(dnesSql))
ok('migrace: přehled vrací jen čas, počet fotek, poznámku a stav (žádná částka, důvod zrušení ani id)',
  [...dnesSql.matchAll(/'(\w+)', /g)].map((m) => m[1]).filter((k) => ['cas', 'fotek', 'oznaceni', 'stav'].includes(k)).length === 4 &&
    !/castka|zruseni_duvod|'id'|'zaznam'/.test(dnesSql.replace(/--.*$/gm, '')))
ok('víc zařízení na pobočce: tabulka kiosků má klíč jen zařízení (žádné „jedno na pobočku“)',
  /zarizeni_id uuid primary key references public\.branch_devices/.test(migrace) && !/unique\s*\(\s*(tenant_id,\s*)?branch_id\s*\)/.test(migrace) && !/create unique index[^;]*jine_platby_kiosky/.test(migrace))
ok('Nastavení → Zařízení: přepínač kiosku Jiných plateb u aktivního zařízení (jen po nasazení tabulky)',
  nastaveni.includes('action={prepnoutKiosekJinychPlateb}') && nastaveni.includes("z.stav === 'active' && kioskyNasazene"))
ok('… akce: přístup settings.manage, pak funkce databáze (právo a Finance ověří ona)',
  /export async function prepnoutKiosekJinychPlateb[\s\S]*zkusPristup\(tenantId, 'settings\.manage', rozsah\)[\s\S]*rpc\('jine_platby_kiosek_zapnout'/.test(nastaveniAkce))

const L = await import('../app/[rozsah]/finance/trzby/jine-platby/[zaznam]/logika.ts')
ok('Finance: autor záznamu z kiosku je zařízení, ne člověk', L.autorZaznamu({ zdroj: 'kiosek', zarizeniNazev: 'Telefon u baru', vytvoril: null }, {}) === 'kiosek Telefon u baru' &&
  L.autorZaznamu({ zdroj: 'aplikace', zarizeniNazev: null, vytvoril: 'U1' }, { U1: 'Jana' }) === 'Jana' && L.autorZaznamu({ zdroj: 'aplikace', zarizeniNazev: null, vytvoril: null }, {}) === null)
ok('Finance: v historii událost kiosku jako „kiosek …“, bez člověka „systém“',
  L.autorUdalosti(null, { zdroj: 'kiosek', zarizeni_nazev: 'Telefon u baru' }, {}) === 'kiosek Telefon u baru' && L.autorUdalosti(null, {}, {}) === 'systém' && L.autorUdalosti('U1', null, { U1: 'Jana' }) === 'Jana')

console.log(chyb ? `\n${chyb} z ${kontrol} kontrol SELHALO` : `\nVšech ${kontrol} kontrol prošlo`)
process.exit(chyb ? 1 : 0)
