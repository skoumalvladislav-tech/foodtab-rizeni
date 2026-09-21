import { createECDH, createCipheriv, createDecipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'

/**
 * Web Push bez knihovny — šifrování (RFC 8291, aes128gcm) a identifikace
 * odesílatele (VAPID, RFC 8292).
 *
 * PROČ VLASTNÍ, KDYŽ EXISTUJE `web-push`. Nová závislost je nová plocha pro
 * řetězec dodavatele, a tohle jsou zhruba sto řádků nad `node:crypto`. Cena:
 * musí se to ověřit. Ověřuje se proti PŘÍKLADU Z RFC 8291 (příloha A —
 * vstupy i všechny mezivýsledky) a zpětným dešifrováním, viz
 * `scripts/web-push.test.mjs`.
 *
 * CO SE NEOVĚŘILO: doručení opravdovému push službě (FCM, Mozilla, Apple).
 * K tomu chybí klíče VAPID a zařízení. Formát je standardní a příklad z RFC
 * sedí, ale první ostrý pokus je třeba zkusit s vědomím, že se ještě nikdy
 * nespustil naostro.
 *
 * Do zprávy patří JEN krátký text bez obsahu rozhovoru — push putuje přes
 * cizí službu a zobrazí se na zamčené obrazovce.
 */

export type KliceVapid = {
  /** Veřejný klíč, base64url, 65 bajtů (nekomprimovaný bod P-256). */
  verejny: string
  /** Soukromý klíč, base64url, 32 bajtů. NIKDY do prohlížeče ani do logu. */
  soukromy: string
  /** `mailto:` nebo `https:` adresa provozovatele (RFC 8292 „sub“). */
  predmet: string
}

export type OdberPush = {
  endpoint: string
  /** Veřejný klíč zařízení (base64url, 65 bajtů). */
  p256dh: string
  /** Sdílené tajemství zařízení (base64url, 16 bajtů). */
  auth_secret: string
}

/** Klíče z prostředí, nebo null (push není nakonfigurovaný). */
export function nactiKliceVapid(env: Record<string, string | undefined>): KliceVapid | null {
  const verejny = env.VAPID_PUBLIC_KEY?.trim()
  const soukromy = env.VAPID_PRIVATE_KEY?.trim()
  const predmet = env.VAPID_SUBJECT?.trim()
  if (!verejny || !soukromy || !predmet) return null
  if (Buffer.from(verejny, 'base64url').length !== 65) return null
  if (Buffer.from(soukromy, 'base64url').length !== 32) return null
  if (!/^(mailto:|https:\/\/)/.test(predmet)) return null
  return { verejny, soukromy, predmet }
}

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url')

/* ---------------------------------------------------------------------
   Šifrování zprávy (RFC 8291 + RFC 8188)
   --------------------------------------------------------------------- */

export type Nahoda = {
  /** Soukromý klíč odesílatele (32 B). Jen pro test s příkladem z RFC. */
  soukromyKlic?: Buffer
  /** Sůl (16 B). Jen pro test s příkladem z RFC. */
  salt?: Buffer
}

export type Mezivysledky = {
  ecdhTajemstvi: Buffer
  ikm: Buffer
  cek: Buffer
  nonce: Buffer
}

const VELIKOST_ZAZNAMU = 4096
/** Nejdelší text, který se do jednoho záznamu vejde (záznam − hlavička − oddělovač − značka). */
export const NEJVIC_BAJTU_ZPRAVY = VELIKOST_ZAZNAMU - 86 - 1 - 16

function odvodit(uaVerejny: Buffer, authTajemstvi: Buffer, asVerejny: Buffer, ecdhTajemstvi: Buffer, salt: Buffer): Mezivysledky {
  // RFC 8291, 3.4: IKM z tajemství zařízení a sdíleného tajemství ECDH.
  const info = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaVerejny, asVerejny])
  const ikm = Buffer.from(hkdfSync('sha256', ecdhTajemstvi, authTajemstvi, info, 32))
  // RFC 8188, 2.2 a 2.3: klíč a nonce záznamu.
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12))
  return { ecdhTajemstvi, ikm, cek, nonce }
}

/** Zašifruje zprávu pro zařízení. Vrací tělo požadavku (hlavička aes128gcm + záznam). */
export function zasifrovat(
  zprava: Uint8Array,
  p256dh: string,
  authSecret: string,
  nahoda: Nahoda = {},
  mezivysledky?: (m: Mezivysledky) => void,
): Buffer {
  if (zprava.length > NEJVIC_BAJTU_ZPRAVY) {
    throw new Error(`Zpráva je moc dlouhá pro jeden záznam (${zprava.length} > ${NEJVIC_BAJTU_ZPRAVY} bajtů).`)
  }

  const uaVerejny = Buffer.from(p256dh, 'base64url')
  const authTajemstvi = Buffer.from(authSecret, 'base64url')
  if (uaVerejny.length !== 65) throw new Error('Veřejný klíč zařízení má špatnou délku.')
  if (authTajemstvi.length !== 16) throw new Error('Tajemství zařízení má špatnou délku.')

  const ecdh = createECDH('prime256v1')
  if (nahoda.soukromyKlic) ecdh.setPrivateKey(nahoda.soukromyKlic)
  else ecdh.generateKeys()
  const asVerejny = ecdh.getPublicKey()
  const ecdhTajemstvi = ecdh.computeSecret(uaVerejny)
  const salt = nahoda.salt ?? randomBytes(16)

  const m = odvodit(uaVerejny, authTajemstvi, asVerejny, ecdhTajemstvi, salt)
  mezivysledky?.(m)

  // Poslední (jediný) záznam: data + oddělovač 0x02, bez další výplně.
  const zaznam = Buffer.concat([Buffer.from(zprava), Buffer.from([0x02])])
  const sifra = createCipheriv('aes-128-gcm', m.cek, m.nonce)
  const sifrovany = Buffer.concat([sifra.update(zaznam), sifra.final(), sifra.getAuthTag()])

  const hlavicka = Buffer.alloc(16 + 4 + 1 + asVerejny.length)
  salt.copy(hlavicka, 0)
  hlavicka.writeUInt32BE(VELIKOST_ZAZNAMU, 16)
  hlavicka.writeUInt8(asVerejny.length, 20)
  asVerejny.copy(hlavicka, 21)

  return Buffer.concat([hlavicka, sifrovany])
}

/** Dešifrování na straně zařízení — jen pro zkoušku, že šifrování je vratné. */
export function desifrovat(telo: Buffer, uaSoukromy: Buffer, uaVerejny: Buffer, authSecret: string): Buffer {
  const salt = telo.subarray(0, 16)
  const idlen = telo.readUInt8(20)
  const asVerejny = telo.subarray(21, 21 + idlen)
  const zaznam = telo.subarray(21 + idlen)

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaSoukromy)
  const ecdhTajemstvi = ecdh.computeSecret(asVerejny)
  const m = odvodit(uaVerejny, Buffer.from(authSecret, 'base64url'), asVerejny, ecdhTajemstvi, salt)

  const znacka = zaznam.subarray(zaznam.length - 16)
  const data = zaznam.subarray(0, zaznam.length - 16)
  const sifra = createDecipheriv('aes-128-gcm', m.cek, m.nonce)
  sifra.setAuthTag(znacka)
  const vysledek = Buffer.concat([sifra.update(data), sifra.final()])

  // Odřízne se výplň a oddělovač: poslední nenulový bajt musí být 0x02 (poslední záznam).
  let konec = vysledek.length
  while (konec > 0 && vysledek[konec - 1] === 0) konec--
  if (konec === 0 || vysledek[konec - 1] !== 0x02) throw new Error('Záznam nekončí oddělovačem.')
  return vysledek.subarray(0, konec - 1)
}

/* ---------------------------------------------------------------------
   VAPID (RFC 8292)
   --------------------------------------------------------------------- */

/** Hlavička `Authorization` pro daný koncový bod. Platí 12 hodin (RFC dovoluje nejvýš 24). */
export function vapidHlavicka(endpoint: string, klice: KliceVapid, ted: number = Date.now()): string {
  const url = new URL(endpoint)
  const hlava = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const telo = b64(
    Buffer.from(
      JSON.stringify({
        aud: url.origin,
        exp: Math.floor(ted / 1000) + 12 * 3600,
        sub: klice.predmet,
      }),
    ),
  )
  const podepisovane = `${hlava}.${telo}`

  const verejny = Buffer.from(klice.verejny, 'base64url')
  const soukromyKlic = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64(verejny.subarray(1, 33)),
      y: b64(verejny.subarray(33, 65)),
      d: klice.soukromy,
    },
    format: 'jwk',
  })
  // ES256 = podpis ECDSA/SHA-256 ve formátu r||s (ne DER).
  const podpis = sign('sha256', Buffer.from(podepisovane), { key: soukromyKlic, dsaEncoding: 'ieee-p1363' })

  return `vapid t=${podepisovane}.${b64(podpis)}, k=${klice.verejny}`
}

/* ---------------------------------------------------------------------
   Odeslání
   --------------------------------------------------------------------- */

/**
 * Patří adresa zařízení skutečné push službě prohlížeče?
 *
 * Odesílač na ni posílá požadavek Z NAŠEHO SERVERU, podepsaný klíčem VAPID.
 * Kdyby si někdo zaregistroval libovolnou adresu, posílal by server slepé
 * POSTy kamkoli (i dovnitř sítě) nebo by ho zdržel pomalý cizí server. Proto
 * jen https, žádný port ani uživatelské jméno a hostitel ze známých služeb
 * (Chrome/Edge: fcm.googleapis.com, Firefox: updates.push.services.mozilla.com,
 * Safari: *.push.apple.com, Edge/Windows: *.notify.windows.com).
 *
 * TOTÉŽ pravidlo drží databáze (push_odber_ulozit, migrace 20260921100000) —
 * tohle je druhá linie pro řádky, které tam nějak přesto jsou.
 */
export function jeDuveryhodnyEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return (
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.push.apple.com') ||
    host.endsWith('.notify.windows.com')
  )
}

export type VysledekOdeslani =
  | { stav: 'odeslano' }
  /** 404 / 410: zařízení odběr zrušilo — řádek se vypne, nezkouší se dál. */
  | { stav: 'vyprselo' }
  /** Adresa nepatří známé push službě — nikam se neposílá, řádek se vypne. */
  | { stav: 'neplatny' }
  | { stav: 'selhalo'; chyba: string }

export type VolbyOdeslani = {
  urgency?: 'normal' | 'high'
  /** Jak dlouho smí push služba zprávu držet, když je zařízení vypnuté (s). */
  ttl?: number
  fetchFn?: typeof fetch
  ted?: number
}

export async function odeslatWebPush(
  odber: OdberPush,
  zprava: object,
  klice: KliceVapid,
  volby: VolbyOdeslani = {},
): Promise<VysledekOdeslani> {
  const f = volby.fetchFn ?? fetch
  if (!jeDuveryhodnyEndpoint(odber.endpoint)) return { stav: 'neplatny' }
  let telo: Buffer
  try {
    telo = zasifrovat(Buffer.from(JSON.stringify(zprava), 'utf8'), odber.p256dh, odber.auth_secret)
  } catch (e) {
    return { stav: 'selhalo', chyba: e instanceof Error ? e.message : 'Šifrování selhalo.' }
  }

  try {
    const odpoved = await f(odber.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHlavicka(odber.endpoint, klice, volby.ted),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(volby.ttl ?? 86_400),
        Urgency: volby.urgency ?? 'normal',
      },
      // Buffer je Uint8Array; typy fetch jsou tu přísné na ArrayBuffer.
      body: new Uint8Array(telo),
      signal: AbortSignal.timeout(8000),
    })
    if (odpoved.status === 201 || odpoved.status === 200 || odpoved.status === 202) return { stav: 'odeslano' }
    if (odpoved.status === 404 || odpoved.status === 410) return { stav: 'vyprselo' }
    return { stav: 'selhalo', chyba: `Push služba odpověděla ${odpoved.status}.` }
  } catch (e) {
    return { stav: 'selhalo', chyba: e instanceof Error ? e.message.slice(0, 200) : 'Spojení s push službou selhalo.' }
  }
}
