#!/usr/bin/env node
/**
 * Živá aktualizace — kanál Realtime se připojí jako PŘIHLÁŠENÝ člověk.
 *
 * Pusť `node scripts/ziva-aktualizace.test.mjs` (Node 24, typy se
 * odstraňují samy).
 *
 * ---------------------------------------------------------------------
 * CO SE STALO
 *
 * Od 24. 9. 2026 hlásí ostrá databáze po skoro každém otevření aplikace
 * `invalid column for filter user_id` (a jednou i `... filter id` ze
 * stránky checklistu). Komponenty volaly `.channel(...).subscribe()`
 * hned po vytvoření klienta. Zpráva o připojení kanálu se sestaví v tu
 * chvíli, token v ní ještě nebyl (auth čte sezení z cookie až
 * asynchronně), Realtime vzal veřejný klíč = role `anon` a ta na
 * `notifications` ani na checklisty SELECT nemá. Kanál pak zůstal bez
 * přihlášení až do obnovy tokenu. Podrobně v lib/supabase/zive.ts.
 *
 * CO TO OVĚŘUJE
 *
 * Na výstup, který jde po drátě: test spustí SKUTEČNÉ komponenty
 * (ZivaAktualizace.tsx a zivy-checklist.tsx, přeložené TypeScriptem)
 * se skutečným `getBrowserSupabase()` a skutečnými knihovnami
 * @supabase/ssr + supabase-js + realtime-js. Místo Supabase stojí malý
 * websocket server tady v souboru a zapisuje, co mu klient poslal.
 * Přihlášení leží v cookie ve stejném tvaru, v jakém ho tam dává
 * aplikace. React a router jsou podstrčené: useEffect jen zapíše efekt,
 * test ho spustí jako React po vykreslení.
 *
 *   1. Tvrdé načtení stránky checklistu (čerstvý klient, oba kanály
 *      ve stejném okamžiku — přesně případ z logu 25. 9. v 11:39):
 *      `phx_join` obou kanálů nese token přihlášeného, filtry sedí.
 *   2. Změna ze serveru obnoví obrazovku (a tři naráz jen jednou).
 *   3. Odchod ze stránky kanály odhlásí.
 *   4. Jiný účet ve stejném okně (pozvánka pro člověka s jiným účtem
 *      přihlásí na serveru jiný účet; klient v prohlížeči je jeden na
 *      okno a drží token původního): kanál nese token NOVÉHO sezení.
 *      Na tomhle stojí výslovné `realtime.setAuth(token)` v pomocníkovi
 *      — v bodě 1 by token dodala knihovna sama a jeho vynechání by
 *      nic neshodilo.
 *   5. Odchod dřív, než se načetlo sezení → kanál nevznikne.
 *   6. Bez sezení se kanál nepřipojuje vůbec (jako anon by jen plnil log).
 *   7. KONTROLA KONTROLY: starý způsob (rovnou subscribe) se na tomhle
 *      serveru opravdu připojí bez tokenu. Kdyby ne, test by chybu
 *      z produkce vidět neuměl a zelená by nic neznamenala.
 *   8. Hlídač: kdo v app/, components/ nebo lib/ poslouchá
 *      `postgres_changes`, jde přes `odebiratZmeny`, ne přímo přes
 *      `.channel(` — další komponenta by jinak chybu vrátila.
 *
 * CO TO NEOVĚŘUJE
 *
 * Skutečný server Supabase Realtime a to, že role `authenticated` odběr
 * projde (`realtime.subscription_check_filters`). To je vidět jen
 * v ostré databázi: po nasazení má z postgres_logs zmizet
 * „invalid column for filter“ a v `realtime.subscription` mají být
 * u `notifications` jen řádky s claims_role = authenticated.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}
const plati = (popis, podminka, detail = '') => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka ? '' : ` → ${detail}`}`)
}

const cekej = (ms) => new Promise((r) => setTimeout(r, ms))
async function pockej(podminka, ms = 5000) {
  const konec = Date.now() + ms
  while (Date.now() < konec) {
    if (podminka()) return true
    await cekej(20)
  }
  return podminka()
}

// ---------------------------------------------------------------------
// Tokeny. Tvarem JWT, podpis nikdo nekontroluje (server je náš).
const jwt = (obsah) =>
  [{ alg: 'HS256', typ: 'JWT' }, obsah]
    .map((c) => Buffer.from(JSON.stringify(c)).toString('base64url'))
    .join('.') + '.podpis'

const ted = Math.floor(Date.now() / 1000)
const JA = '3253afd4-509e-4e06-abf5-63046b8290a3'
const BEH = '7f0c1e0a-9b8d-4c5e-8f00-000000000001'
const ANON = jwt({ iss: 'supabase', role: 'anon', exp: ted + 10 * 365 * 86400 })
const UZIVATEL = jwt({ sub: JA, role: 'authenticated', aud: 'authenticated', exp: ted + 3600 })

// ---------------------------------------------------------------------
// Podstrčený Realtime: websocket (RFC 6455) bez knihoven, jen tolik,
// kolik potřebuje realtime-js — textové rámce s JSON polem
// [join_ref, ref, topic, event, payload].

const zpravy = [] // všechno, co klient poslal: { spojeni, topic, event, payload }
const idVazeb = new Map() // topic → id vazeb z odpovědi na phx_join
const spojeni = []
const necekaneDotazy = []
let dalsiId = 1

function ramec(text) {
  const data = Buffer.from(text)
  let hlavicka
  if (data.length < 126) hlavicka = Buffer.from([0x81, data.length])
  else if (data.length < 65536) {
    hlavicka = Buffer.alloc(4)
    hlavicka[0] = 0x81
    hlavicka[1] = 126
    hlavicka.writeUInt16BE(data.length, 2)
  } else {
    hlavicka = Buffer.alloc(10)
    hlavicka[0] = 0x81
    hlavicka[1] = 127
    hlavicka.writeBigUInt64BE(BigInt(data.length), 2)
  }
  return Buffer.concat([hlavicka, data])
}

const server = http.createServer((req, res) => {
  // Auth ani REST se volat nemají: sezení je v cookie a platné.
  necekaneDotazy.push(`${req.method} ${req.url}`)
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})

server.on('upgrade', (req, socket) => {
  const klic = req.headers['sec-websocket-key']
  const prijmout = crypto
    .createHash('sha1')
    .update(klic + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${prijmout}\r\n\r\n`,
  )
  const cislo = spojeni.length
  spojeni.push({ socket, url: req.url })
  const poslat = (pole) => socket.write(ramec(JSON.stringify(pole)))
  let buf = Buffer.alloc(0)

  socket.on('data', (kus) => {
    buf = Buffer.concat([buf, kus])
    for (;;) {
      if (buf.length < 2) return
      const opcode = buf[0] & 0x0f
      let delka = buf[1] & 0x7f
      let pos = 2
      if (delka === 126) {
        if (buf.length < 4) return
        delka = buf.readUInt16BE(2)
        pos = 4
      } else if (delka === 127) {
        if (buf.length < 10) return
        delka = Number(buf.readBigUInt64BE(2))
        pos = 10
      }
      const maska = buf[1] & 0x80 ? buf.subarray(pos, pos + 4) : null
      if (maska) pos += 4
      if (buf.length < pos + delka) return
      const data = Buffer.from(buf.subarray(pos, pos + delka))
      if (maska) for (let i = 0; i < data.length; i++) data[i] ^= maska[i % 4]
      buf = buf.subarray(pos + delka)

      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0]))
        return
      }
      if (opcode !== 0x1) continue

      const [joinRef, ref, topic, event, payload] = JSON.parse(data.toString('utf8'))
      zpravy.push({ spojeni: cislo, topic, event, payload })

      if (event === 'phx_join') {
        const vazby = (payload?.config?.postgres_changes ?? []).map((f) => ({ ...f, id: dalsiId++ }))
        idVazeb.set(topic, vazby)
        poslat([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: vazby } }])
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        poslat([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
      }
    }
  })
  socket.on('error', () => {})
})

function zmenaZeServeru(topic, index, typ, tabulka, zaznam) {
  const vazba = idVazeb.get(topic)?.[index]
  if (!vazba) throw new Error(`na ${topic} není vazba ${index}`)
  const zprava = [
    null,
    null,
    topic,
    'postgres_changes',
    {
      ids: [vazba.id],
      data: {
        schema: 'public',
        table: tabulka,
        commit_timestamp: new Date().toISOString(),
        type: typ,
        columns: [{ name: 'id', type: 'uuid' }],
        record: zaznam,
        old_record: typ === 'UPDATE' ? zaznam : undefined,
        errors: null,
      },
    },
  ]
  for (const s of spojeni) if (!s.socket.destroyed) s.socket.write(ramec(JSON.stringify(zprava)))
}

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const URL_SUPABASE = `http://127.0.0.1:${server.address().port}`
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SUPABASE
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON

// ---------------------------------------------------------------------
// Prohlížeč: tolik z window/document, kolik sahá @supabase/ssr a auth.
// Přihlášení v cookie tak, jak ho zapisuje @supabase/ssr:
// `sb-<první část hostitele>-auth-token` = "base64-" + base64url(JSON).

const KLIC = `sb-${new URL(URL_SUPABASE).hostname.split('.')[0]}-auth-token`
const sezeniPro = (id, token) => ({
  access_token: token,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: ted + 3600,
  refresh_token: `obnovovaci-token-${id}`,
  user: { id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.com` },
})
const sklenice = new Map()
const prihlasit = (id = JA, token = UZIVATEL) =>
  sklenice.set(KLIC, 'base64-' + Buffer.from(JSON.stringify(sezeniPro(id, token))).toString('base64url'))
prihlasit()

globalThis.window = globalThis
globalThis.document = {
  get cookie() {
    return [...sklenice].map(([k, v]) => `${k}=${v}`).join('; ')
  },
  set cookie(retezec) {
    const [par, ...atributy] = retezec.split(';')
    const i = par.indexOf('=')
    const k = par.slice(0, i).trim()
    const v = par.slice(i + 1).trim()
    if (v === '' || atributy.some((a) => /^\s*max-age=0\s*$/i.test(a))) sklenice.delete(k)
    else sklenice.set(k, v)
  },
  visibilityState: 'visible',
}
globalThis.location = new URL('http://127.0.0.1/firma/prehled')
globalThis.addEventListener ??= () => {}
globalThis.removeEventListener ??= () => {}

// ---------------------------------------------------------------------
// Komponenty: .tsx → JS TypeScriptem; react a next/navigation podstrčené,
// `@/lib/...` na skutečné soubory v repu.

const podstrc = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
globalThis.__zive = { efekty: [], router: null }
const NAHRADY = {
  react: podstrc('export const useEffect = (efekt) => { globalThis.__zive.efekty.push(efekt) };'),
  'next/navigation': podstrc('export const useRouter = () => globalThis.__zive.router;'),
  '@/lib/supabase/client': pathToFileURL(path.join(koren, 'lib/supabase/client.ts')).href,
  '@/lib/supabase/zive': pathToFileURL(path.join(koren, 'lib/supabase/zive.ts')).href,
}

async function nacistKomponentu(soubor) {
  const zdroj = fs.readFileSync(path.join(koren, soubor), 'utf8')
  let js = ts.transpileModule(zdroj, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  js = js.replace(/from\s+["']([^"']+)["']/g, (_, spec) => {
    if (!(spec in NAHRADY)) throw new Error(`${soubor}: import "${spec}" test nezná — doplň ho do NAHRADY`)
    return `from "${NAHRADY[spec]}"`
  })
  return (await import(podstrc(js))).default
}

/** Vykreslí komponentu a spustí její efekt jako React po vykreslení. */
function vykreslit(Komponenta, props) {
  const router = { obnoveni: 0, refresh() { this.obnoveni++ } }
  globalThis.__zive.router = router
  globalThis.__zive.efekty = []
  Komponenta(props)
  const efekty = globalThis.__zive.efekty
  return { router, spustit: () => efekty.map((e) => e()).find((u) => typeof u === 'function') }
}

const ZivaAktualizace = await nacistKomponentu('components/shell/ZivaAktualizace.tsx')
const ZivyChecklist = await nacistKomponentu('app/[rozsah]/ukoly/checklisty/zivy-checklist.tsx')

const joiny = (topic) => zpravy.filter((z) => z.event === 'phx_join' && z.topic === topic)
const TOPIC_ZVONEK = `realtime:notifikace:${JA}`
const TOPIC_CHECKLIST = `realtime:checklist:${BEH}`

// ---------------------------------------------------------------------
console.log('\n== 1. Tvrdé načtení stránky checklistu: kanály se připojí s tokenem ==')

// React spouští efekty dítěte dřív než rodiče: stránka, pak layout.
// Oba ve stejném okamžiku, na klientovi, který do té chvíle neexistoval.
const checklist = vykreslit(ZivyChecklist, { beh: BEH })
const zvonek = vykreslit(ZivaAktualizace, { userId: JA })
const uklidChecklist = checklist.spustit()
const uklidZvonek = zvonek.spustit()

await pockej(() => joiny(TOPIC_ZVONEK).length > 0 && joiny(TOPIC_CHECKLIST).length > 0)
const [joinZvonek] = joiny(TOPIC_ZVONEK)
const [joinChecklist] = joiny(TOPIC_CHECKLIST)

plati('zvoneček poslal phx_join', !!joinZvonek, 'server žádné připojení kanálu notifikace nedostal')
plati('checklist poslal phx_join', !!joinChecklist, 'server žádné připojení kanálu checklistu nedostal')
ma('zvoneček: token v phx_join je token přihlášeného (ne žádný → anon)', joinZvonek?.payload?.access_token === UZIVATEL, true)
ma('checklist: token v phx_join je token přihlášeného', joinChecklist?.payload?.access_token === UZIVATEL, true)
ma(
  'zvoneček: odebírá jen INSERT do notifications, jen své řádky',
  JSON.stringify(joinZvonek?.payload?.config?.postgres_changes),
  JSON.stringify([{ event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${JA}` }]),
)
ma(
  'checklist: položky běhu (INSERT, UPDATE) a běh sám (UPDATE)',
  JSON.stringify(joinChecklist?.payload?.config?.postgres_changes),
  JSON.stringify([
    { event: 'INSERT', schema: 'public', table: 'checklist_entries', filter: `run_id=eq.${BEH}` },
    { event: 'UPDATE', schema: 'public', table: 'checklist_entries', filter: `run_id=eq.${BEH}` },
    { event: 'UPDATE', schema: 'public', table: 'checklist_runs', filter: `id=eq.${BEH}` },
  ]),
)
ma('oba kanály po jednom připojení (žádné druhé kolo)', joiny(TOPIC_ZVONEK).length + joiny(TOPIC_CHECKLIST).length, 2)

// ---------------------------------------------------------------------
console.log('\n== 2. Změna ze serveru obnoví obrazovku ==')

// Klient zpracuje odpověď na phx_join (id vazeb) — pak teprve umí událost přiřadit.
await cekej(200)
for (let i = 0; i < 3; i++) zmenaZeServeru(TOPIC_ZVONEK, 0, 'INSERT', 'notifications', { id: crypto.randomUUID() })
zmenaZeServeru(TOPIC_CHECKLIST, 2, 'UPDATE', 'checklist_runs', { id: BEH })
await pockej(() => zvonek.router.obnoveni > 0 && checklist.router.obnoveni > 0, 3000)
await cekej(1000) // kdyby dávka nefungovala, přišlo by další obnovení
ma('tři upozornění naráz → zvoneček obnoví obrazovku jednou', zvonek.router.obnoveni, 1)
ma('uzavřený běh checklistu → checklist obnoví obrazovku', checklist.router.obnoveni, 1)

// ---------------------------------------------------------------------
console.log('\n== 3. Odchod ze stránky kanály odhlásí ==')

uklidChecklist?.()
uklidZvonek?.()
await pockej(() => zpravy.some((z) => z.event === 'phx_leave' && z.topic === TOPIC_ZVONEK) &&
  zpravy.some((z) => z.event === 'phx_leave' && z.topic === TOPIC_CHECKLIST), 3000)
plati('zvoneček poslal phx_leave', zpravy.some((z) => z.event === 'phx_leave' && z.topic === TOPIC_ZVONEK), 'kanál zůstal viset')
plati('checklist poslal phx_leave', zpravy.some((z) => z.event === 'phx_leave' && z.topic === TOPIC_CHECKLIST), 'kanál zůstal viset')

// ---------------------------------------------------------------------
console.log('\n== 4. Jiný účet ve stejném okně: kanál nese token nového sezení ==')

// Server přihlásil jiný účet (cookie je jiná), klient v prohlížeči
// zůstal stejný a z bodu 1 pořád drží token původního. Obrazovka se
// přepne na nového člověka, efekt zvonečku se spustí znovu.
const ON = '00000000-0000-4000-8000-00000000000c'
const UZIVATEL_ON = jwt({ sub: ON, role: 'authenticated', aud: 'authenticated', exp: ted + 3600 })
prihlasit(ON, UZIVATEL_ON)
const druhyUcet = vykreslit(ZivaAktualizace, { userId: ON })
const uklidDruhyUcet = druhyUcet.spustit()
await pockej(() => joiny(`realtime:notifikace:${ON}`).length > 0)
const [joinDruhyUcet] = joiny(`realtime:notifikace:${ON}`)
plati('kanál nového účtu poslal phx_join', !!joinDruhyUcet, 'server připojení nedostal')
ma(
  'phx_join nese token právě přihlášeného, ne toho, kdo byl v okně předtím',
  joinDruhyUcet?.payload?.access_token === UZIVATEL_ON ? 'nový' : joinDruhyUcet?.payload?.access_token === UZIVATEL ? 'původní' : 'žádný',
  'nový',
)
uklidDruhyUcet?.()
prihlasit()

// ---------------------------------------------------------------------
console.log('\n== 5. Odchod dřív, než se načetlo sezení: kanál nevznikne ==')

const JINY = '00000000-0000-4000-8000-00000000000a'
const rychly = vykreslit(ZivaAktualizace, { userId: JINY })
rychly.spustit()?.() // efekt a hned úklid, jako při rychlém přechodu jinam
await cekej(800)
ma('žádný phx_join pro kanál komponenty, která už není', joiny(`realtime:notifikace:${JINY}`).length, 0)

// ---------------------------------------------------------------------
console.log('\n== 6. Bez sezení se kanál nepřipojuje ==')

sklenice.clear()
const ODHLASENY = '00000000-0000-4000-8000-00000000000b'
const bezSezeni = vykreslit(ZivaAktualizace, { userId: ODHLASENY })
const uklidBezSezeni = bezSezeni.spustit()
await cekej(800)
ma('žádný phx_join bez přihlášení (jako anon by jen plnil log)', joiny(`realtime:notifikace:${ODHLASENY}`).length, 0)
uklidBezSezeni?.()
prihlasit()

const bezTokenu = zpravy.filter(
  (z) => z.event === 'phx_join' && ![UZIVATEL, UZIVATEL_ON].includes(z.payload?.access_token),
)
ma('ze všech kanálů komponent se žádný nepřipojil bez tokenu přihlášeného', bezTokenu.length, 0)

// ---------------------------------------------------------------------
console.log('\n== 7. Kontrola kontroly: starý způsob se tu připojí bez tokenu ==')

// Přesně to, co komponenty dělaly do opravy: čerstvý klient a hned
// `.subscribe()`. Kdyby tenhle join token nesl, testovací prostředí
// by chybu z produkce neumělo vyrobit a body 1–6 by nic nedokazovaly.
const { createBrowserClient } = await import('@supabase/ssr')
const svezi = createBrowserClient(URL_SUPABASE, ANON, { isSingleton: false })
const stary = svezi
  .channel('kontrola-stary-zpusob')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${JA}` }, () => {})
  .subscribe()
await pockej(() => joiny('realtime:kontrola-stary-zpusob').length > 0)
const [joinStary] = joiny('realtime:kontrola-stary-zpusob')
plati('starý způsob poslal phx_join', !!joinStary, 'kontrolní kanál se nepřipojil vůbec')
ma(
  'starý způsob: v phx_join token přihlášeného NENÍ (server vezme veřejný klíč = anon)',
  joinStary?.payload?.access_token === UZIVATEL,
  false,
)
await svezi.removeChannel(stary)

// ---------------------------------------------------------------------
console.log('\n== 8. Hlídač: postgres_changes jen přes odebiratZmeny ==')

function projit(adresar) {
  const soubory = []
  for (const polozka of fs.readdirSync(adresar, { withFileTypes: true })) {
    const cesta = path.join(adresar, polozka.name)
    if (polozka.isDirectory()) soubory.push(...projit(cesta))
    else if (/\.(ts|tsx)$/.test(polozka.name)) soubory.push(cesta)
  }
  return soubory
}
const POMOCNIK = path.join(koren, 'lib/supabase/zive.ts')
const odberatele = ['app', 'components', 'lib']
  .flatMap((a) => projit(path.join(koren, a)))
  .filter((f) => f !== POMOCNIK)
  .filter((f) => /["']postgres_changes["']/.test(fs.readFileSync(f, 'utf8')))
const relativne = (f) => path.relative(koren, f).split(path.sep).join('/')

// Že hlídač odběry vůbec umí najít: oba známé musí být mezi nalezenými.
// (Nová komponenta s odběrem sem nepatří — stačí, že projde kontrolou níž.)
for (const znamy of ['components/shell/ZivaAktualizace.tsx', 'app/[rozsah]/ukoly/checklisty/zivy-checklist.tsx']) {
  plati(`hlídač najde odběr v ${znamy}`, odberatele.map(relativne).includes(znamy), 'hledání odběrů nic nenašlo — hlídač by mlčel vždycky')
}
for (const f of odberatele) {
  const kod = fs.readFileSync(f, 'utf8')
  plati(`${relativne(f)} volá odebiratZmeny a sám kanál nezakládá`, kod.includes('odebiratZmeny(') && !kod.includes('.channel('),
    'kanál rovnou přes .channel(...).subscribe() se po načtení stránky připojí jako anon')
}

// ---------------------------------------------------------------------
console.log('')
ma('auth ani REST se po síti nevolaly', necekaneDotazy.join(', '), '')

console.log(chyb ? `\n${chyb} kontrol neprošlo.` : '\nVšechny kontroly prošly.')
for (const s of spojeni) s.socket.destroy()
server.close()
process.exit(chyb ? 1 : 0)
