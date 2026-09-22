#!/usr/bin/env node
/**
 * Web Push (lib/komunikace/web-push.ts): šifrování zprávy a VAPID.
 *
 * Pusť `node --experimental-strip-types scripts/web-push.test.mjs`.
 *
 * Šifrování se ověřuje proti příkladu z RFC 8291, příloha A: dosadí se
 * VŠECHNY vstupy z příkladu (klíče, sůl) a porovnají se mezivýsledky, které
 * RFC uvádí (sdílené tajemství ECDH, IKM, klíč záznamu, nonce). Kdyby
 * implementace odvozovala klíče o kousek jinak, mezivýsledky se rozejdou —
 * a hlásí se, KTERÝ krok.
 *
 * Nad tím zpětné dešifrování (vratnost), VAPID podpis (ověřený veřejným
 * klíčem) a odeslání proti podvržené push službě.
 *
 * ČEHO SE TO NETÝKÁ: skutečné doručení push službou Googlu, Mozilly a Applu
 * se tu neověřuje (chybí klíče a zařízení).
 */

import { createECDH, createPublicKey, verify } from 'node:crypto'

import {
  NEJVIC_BAJTU_ZPRAVY,
  desifrovat,
  jeDuveryhodnyEndpoint,
  nactiKliceVapid,
  odeslatWebPush,
  vapidHlavicka,
  zasifrovat,
} from '../lib/komunikace/web-push.ts'

let chyb = 0
const je = (popis, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}
const b64 = (b) => Buffer.from(b).toString('base64url')
const z64 = (s) => Buffer.from(s, 'base64url')

console.log('\n== Příklad z RFC 8291, příloha A ==')

const RFC = {
  zprava: 'When I grow up, I want to be a watermelon',
  asSoukromy: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asVerejny: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaSoukromy: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaVerejny: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
}

// Vstupy příkladu si sedí navzájem (veřejný klíč odpovídá soukromému).
const ecdhAs = createECDH('prime256v1')
ecdhAs.setPrivateKey(z64(RFC.asSoukromy))
je('veřejný klíč odesílatele z příkladu odpovídá jeho soukromému', b64(ecdhAs.getPublicKey()), RFC.asVerejny)
const ecdhUa = createECDH('prime256v1')
ecdhUa.setPrivateKey(z64(RFC.uaSoukromy))
je('veřejný klíč zařízení z příkladu odpovídá jeho soukromému', b64(ecdhUa.getPublicKey()), RFC.uaVerejny)

let m
const telo = zasifrovat(
  Buffer.from(RFC.zprava),
  RFC.uaVerejny,
  RFC.auth,
  { soukromyKlic: z64(RFC.asSoukromy), salt: z64(RFC.salt) },
  (x) => { m = x },
)
je('sdílené tajemství ECDH', b64(m.ecdhTajemstvi), RFC.ecdh)
je('IKM', b64(m.ikm), RFC.ikm)
je('klíč záznamu (CEK)', b64(m.cek), RFC.cek)
je('nonce', b64(m.nonce), RFC.nonce)

console.log('\n== Tvar těla ==')
je('začíná solí', b64(telo.subarray(0, 16)), RFC.salt)
je('velikost záznamu 4096', telo.readUInt32BE(16), 4096)
je('délka klíče 65', telo.readUInt8(20), 65)
je('následuje veřejný klíč odesílatele', b64(telo.subarray(21, 86)), RFC.asVerejny)
je('délka = hlavička 86 + zpráva + oddělovač 1 + značka 16', telo.length, 86 + Buffer.byteLength(RFC.zprava) + 1 + 16)

console.log('\n== Vratnost ==')
je('zařízení z těla dešifruje původní zprávu', desifrovat(telo, z64(RFC.uaSoukromy), z64(RFC.uaVerejny), RFC.auth).toString(), RFC.zprava)

// Nahodilý pár zařízení: dvě šifrování téhož textu se liší (jiný klíč i sůl).
const zar = createECDH('prime256v1'); zar.generateKeys()
const auth2 = b64(Buffer.alloc(16, 7))
const a = zasifrovat(Buffer.from('Ahoj'), b64(zar.getPublicKey()), auth2)
const b = zasifrovat(Buffer.from('Ahoj'), b64(zar.getPublicKey()), auth2)
je('dvě šifrování téhož textu se liší (nahodilá sůl a klíč)', a.equals(b), false)
je('obě se dešifrují na totéž', [desifrovat(a, zar.getPrivateKey(), zar.getPublicKey(), auth2).toString(), desifrovat(b, zar.getPrivateKey(), zar.getPublicKey(), auth2).toString()], ['Ahoj', 'Ahoj'])
je('poškozený záznam se nedešifruje (značka GCM)', (() => { const c = Buffer.from(a); c[c.length - 1] ^= 1; try { desifrovat(c, zar.getPrivateKey(), zar.getPublicKey(), auth2); return 'dešifrovalo' } catch { return 'chyba' } })(), 'chyba')
je('jiné tajemství zařízení se nedešifruje', (() => { try { desifrovat(a, zar.getPrivateKey(), zar.getPublicKey(), b64(Buffer.alloc(16, 9))); return 'dešifrovalo' } catch { return 'chyba' } })(), 'chyba')
je('nejdelší zpráva se ještě vejde', zasifrovat(Buffer.alloc(NEJVIC_BAJTU_ZPRAVY, 65), b64(zar.getPublicKey()), auth2).length, 86 + NEJVIC_BAJTU_ZPRAVY + 1 + 16)
je('o bajt delší zpráva se odmítne', (() => { try { zasifrovat(Buffer.alloc(NEJVIC_BAJTU_ZPRAVY + 1), b64(zar.getPublicKey()), auth2); return 'prošlo' } catch { return 'chyba' } })(), 'chyba')
je('špatná délka klíče zařízení se odmítne', (() => { try { zasifrovat(Buffer.from('x'), b64(Buffer.alloc(10)), auth2); return 'prošlo' } catch { return 'chyba' } })(), 'chyba')

console.log('\n== VAPID ==')

const vapid = createECDH('prime256v1'); vapid.generateKeys()
const env = {
  VAPID_PUBLIC_KEY: b64(vapid.getPublicKey()),
  VAPID_PRIVATE_KEY: b64(vapid.getPrivateKey()),
  VAPID_SUBJECT: 'mailto:sef@foodtab.cz',
}
const klice = nactiKliceVapid(env)
je('klíče z prostředí se načtou', klice !== null, true)
je('bez klíče = null (push není nakonfigurovaný)', nactiKliceVapid({}), null)
je('chybějící předmět = null', nactiKliceVapid({ ...env, VAPID_SUBJECT: '' }), null)
je('předmět bez mailto/https = null', nactiKliceVapid({ ...env, VAPID_SUBJECT: 'sef@foodtab.cz' }), null)
je('veřejný klíč špatné délky = null', nactiKliceVapid({ ...env, VAPID_PUBLIC_KEY: b64(Buffer.alloc(10)) }), null)
je('soukromý klíč špatné délky = null', nactiKliceVapid({ ...env, VAPID_PRIVATE_KEY: b64(Buffer.alloc(10)) }), null)

const TED = Date.UTC(2026, 8, 21, 12, 0, 0)
const hlavicka = vapidHlavicka('https://fcm.googleapis.com/fcm/send/abc', klice, TED)
je('hlavička má tvar „vapid t=…, k=…“', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(hlavicka), true)
const [, jwt, k] = /^vapid t=(.+), k=(.+)$/.exec(hlavicka)
const [h, p, podpis] = jwt.split('.')
je('k = veřejný klíč VAPID', k, env.VAPID_PUBLIC_KEY)
je('hlavička JWT: ES256', JSON.parse(z64(h).toString()), { typ: 'JWT', alg: 'ES256' })
const telo2 = JSON.parse(z64(p).toString())
je('aud = původ push služby (bez cesty)', telo2.aud, 'https://fcm.googleapis.com')
je('sub = předmět', telo2.sub, 'mailto:sef@foodtab.cz')
je('exp = teď + 12 h', telo2.exp, Math.floor(TED / 1000) + 12 * 3600)
je('exp je pod limitem 24 h z RFC 8292', telo2.exp - Math.floor(TED / 1000) < 24 * 3600, true)
const verejnyKlic = createPublicKey({
  key: { kty: 'EC', crv: 'P-256', x: b64(vapid.getPublicKey().subarray(1, 33)), y: b64(vapid.getPublicKey().subarray(33, 65)) },
  format: 'jwk',
})
je('podpis ověří veřejný klíč VAPID (ES256, r||s)', verify('sha256', Buffer.from(`${h}.${p}`), { key: verejnyKlic, dsaEncoding: 'ieee-p1363' }, z64(podpis)), true)
je('podpis nesedí na pozměněný obsah', verify('sha256', Buffer.from(`${h}.${p}x`), { key: verejnyKlic, dsaEncoding: 'ieee-p1363' }, z64(podpis)), false)
je('podpis má 64 bajtů (r||s), ne DER', z64(podpis).length, 64)

console.log('\n== Odeslání proti podvržené push službě ==')

const odber = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64(zar.getPublicKey()), auth_secret: auth2 }
async function zkus(status, extra = {}, adresa = odber.endpoint) {
  let volani = null
  const fetchFn = async (url, init) => {
    volani = { url, init }
    if (status === 'vyjimka') throw new Error('síť spadla')
    return { status }
  }
  const v = await odeslatWebPush({ ...odber, endpoint: adresa }, { title: 'Foodtab', body: 'Nová zpráva' }, klice, { fetchFn, ted: TED, ...extra })
  return { v, volani }
}
const ok = await zkus(201)
je('201 = odesláno', ok.v, { stav: 'odeslano' })
je('POST na koncový bod odběru', [ok.volani.url, ok.volani.init.method], [odber.endpoint, 'POST'])
je('hlavičky: aes128gcm, TTL, urgency, vapid', [
  ok.volani.init.headers['Content-Encoding'], ok.volani.init.headers.TTL, ok.volani.init.headers.Urgency,
  ok.volani.init.headers.Authorization.startsWith('vapid t='),
], ['aes128gcm', '86400', 'normal', true])
je('tělo je šifrované (nesnese čtení jako text) a zařízení ho dešifruje',
  JSON.parse(desifrovat(Buffer.from(ok.volani.init.body), zar.getPrivateKey(), zar.getPublicKey(), auth2).toString()),
  { title: 'Foodtab', body: 'Nová zpráva' })
je('tělo neobsahuje text zprávy otevřeně', Buffer.from(ok.volani.init.body).includes(Buffer.from('Nová zpráva')), false)
je('naléhavé: urgency high', (await zkus(201, { urgency: 'high' })).volani.init.headers.Urgency, 'high')
je('410 = odběr vypršel', (await zkus(410)).v, { stav: 'vyprselo' })
je('404 = odběr vypršel', (await zkus(404)).v, { stav: 'vyprselo' })
je('500 = selhalo (zkusí se znovu)', (await zkus(500)).v.stav, 'selhalo')
je('429 = selhalo, nezahazuje se odběr', (await zkus(429)).v.stav, 'selhalo')
je('výjimka sítě = selhalo, ne pád', (await zkus('vyjimka')).v, { stav: 'selhalo', chyba: 'síť spadla' })
je('rozbitý klíč zařízení = selhalo, ne pád', (await odeslatWebPush({ ...odber, p256dh: 'x' }, {}, klice, { fetchFn: async () => ({ status: 201 }) })).stav, 'selhalo')

console.log('\n== Kam se smí posílat (SSRF) ==')

for (const [adresa, cekano] of [
  ['https://fcm.googleapis.com/fcm/send/abc', true],
  ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
  ['https://web.push.apple.com/abc', true],
  ['https://wns2-par02p.notify.windows.com/w/?token=x', true],
  ['http://fcm.googleapis.com/fcm/send/abc', false],
  ['https://interni-host.local/x', false],
  ['https://localhost/x', false],
  ['https://169.254.169.254/latest/meta-data', false],
  ['https://fcm.googleapis.com@evil.example/x', false],
  ['https://fcm.googleapis.com:8443/x', false],
  ['https://user:pass@fcm.googleapis.com/x', false],
  ['https://fcm.googleapis.com.evil.example/x', false],
  ['https://evilfcm.googleapis.com.evil.example/x', false],
  ['https://web.push.apple.com.evil.example/x', false],
  ['https://evil-push.apple.com.example/x', false],
  ['nesmysl', false],
  ['', false],
]) {
  je('endpoint ' + (adresa || '(prázdný)') + (cekano ? ' smí' : ' nesmí'), jeDuveryhodnyEndpoint(adresa), cekano)
}
const cizi = await zkus(201, {}, 'https://interni-host.local/x')
je('cizí adresa: nikam se neposílá a odběr se vypne', [cizi.v, cizi.volani], [{ stav: 'neplatny' }, null])

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO\n' : `\nCHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
