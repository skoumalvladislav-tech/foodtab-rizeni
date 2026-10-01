import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

// Přípona `.ts` schválně — viz CLAUDE.md, oddíl Testy: soubory v `lib/`
// se pouštějí přímo Nodem v testech a bez ní by modul nenašel.
import { STROP_BAJTU } from './marketing-obrazek.ts'

/**
 * Bezpečné stažení obrázku z cizí adresy (ochrana proti SSRF).
 *
 * ---------------------------------------------------------------------
 * PROČ TENHLE SOUBOR EXISTUJE
 *
 * `lib/marketing-profil-ai.ts` nechá jazykový model najít na webu
 * firmy kandidátní adresu loga (přes `web_search`/`web_fetch` — ty
 * běží na Anthropic infrastruktuře, ne u nás). Aby se logo dostalo do
 * knihovny (`marketing_media`), musí si ho ale stáhnout NÁŠ VLASTNÍ
 * server — a to je přesně situace, kterou SSRF zneužívá: model (nebo
 * kdokoli, kdo mu web podstrčí) může poslat adresu mířící dovnitř naší
 * sítě místo na opravdové logo — `http://169.254.169.254/...`
 * (cloudový metadata endpoint), `http://10.0.0.5/` (naše vlastní
 * infrastruktura) a podobně.
 *
 * ---------------------------------------------------------------------
 * PROČ SE IP OVĚŘUJE A PAK SE NA NI PŘIPOJUJE RUČNĚ, NE PŘES `fetch()`
 *
 * Kdyby se jen „zavolal `fetch(url)` a před tím ověřilo, že `dns.lookup`
 * téhle adresy nevrátí nic zakázaného", zůstala by mezera: `fetch()` si
 * doménu přeloží ZNOVU, sám, a mezi naším ověřením a jeho připojením
 * může DNS odpovědět jinak (tzv. DNS rebinding). Proto se tady doména
 * přeloží NA KONKRÉTNÍ IP jednou, ta IP se ověří, a požadavek se pošle
 * přímo na tu IP (`host: ip`) — se `servername`/hlavičkou `Host`
 * nastavenou na původní jméno, aby TLS (certifikát) i server (který
 * web běží na tomtéž stroji) viděly správnou doménu.
 *
 * ---------------------------------------------------------------------
 * PŘESMĚROVÁNÍ SE OVĚŘUJE ZNOVU, NE JEN NÁSLEDUJE
 *
 * CDN s logem běžně přesměruje (301/302) na jinou adresu. Kdyby se
 * přesměrování následovalo bez druhého kola kontrol, stačilo by poslat
 * odkaz na neškodnou adresu, která přesměruje na tu zakázanou — a celá
 * kontrola by byla k ničemu. Proto každé přesměrování projde CELOU
 * kontrolou znovu (schéma, DNS, zakázané rozsahy) a počet přesměrování
 * má strop.
 */

/** Jak dlouho se čeká na odpověď (a na každé přesměrování zvlášť). */
export const CEKANI_MS = 10_000

/** Víc přesměrování než tohle je podezřelé, ne obvyklé chování CDN. */
const MAX_PRESMEROVANI = 3

/**
 * Je IPv4 adresa v privátním/vyhrazeném rozsahu?
 *
 * Rozsahy přesně podle zadání: 10/8, 172.16/12, 192.168/16 (privátní
 * sítě), 127/8 (loopback), 169.254/16 (link-local — VČETNĚ
 * 169.254.169.254, cloudového metadata endpointu). K tomu 0/8
 * („tahle síť“) — stejně nikdy nemíří na opravdový web.
 */
export function jeZakazanaIpv4(ip: string): boolean {
  const casti = ip.split('.')
  if (casti.length !== 4) return true // nejde rozebrat → radši zamítnout

  const cisla = casti.map((c) => Number(c))
  if (cisla.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true

  const [a, b] = cisla
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  return false
}

/**
 * Je IPv6 adresa v privátním/vyhrazeném rozsahu?
 *
 * `::1` (loopback), `fc00::/7` (unikátní lokální, obdoba 10/8 pro v6),
 * `fe80::/10` (link-local, obdoba 169.254/16) a IPv4 adresa zabalená
 * do IPv6 tvaru (`::ffff:a.b.c.d`) — ta se rozbalí a ověří jako IPv4,
 * jinak by tudy prošlo totéž 169.254.169.254 jen v jiném zápisu.
 */
export function jeZakazanaIpv6(ip: string): boolean {
  const i = ip.toLowerCase()

  if (i === '::1') return true

  const mapovana = i.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapovana) return jeZakazanaIpv4(mapovana[1])

  if (/^f[cd][0-9a-f]{2}:/.test(i)) return true // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(i)) return true // fe80::/10

  return false
}

/** Rozhoduje podle verze IP, kterou kontrolu použít. Neznámý tvar → zamítnout. */
export function jeZakazanaIp(ip: string): boolean {
  const verze = isIP(ip)
  if (verze === 4) return jeZakazanaIpv4(ip)
  if (verze === 6) return jeZakazanaIpv6(ip)
  return true
}

export type VysledekStazeni =
  | { stav: 'ok'; data: Uint8Array; contentType: string }
  | { stav: 'chyba'; duvod: string }

/**
 * Bezpečné stažení obrázku.
 *
 * Typ obsahu (magic number) se tady NEKONTROLUJE — to dělá
 * `precistObrazek()` z `lib/marketing-obrazek.ts` nad staženými bajty,
 * ať v appce není druhý paralelní validátor. Tahle funkce jen smí,
 * nebo nesmí se vůbec připojit, a hlídá strop velikosti a čas.
 */
export async function stahnoutObrazekBezpecne(urlText: string): Promise<VysledekStazeni> {
  let aktualni: URL

  try {
    aktualni = new URL(urlText)
  } catch {
    return { stav: 'chyba', duvod: 'Adresa obrázku není platná URL.' }
  }

  for (let krok = 0; krok <= MAX_PRESMEROVANI; krok++) {
    if (aktualni.protocol !== 'http:' && aktualni.protocol !== 'https:') {
      return { stav: 'chyba', duvod: 'Adresa obrázku musí být http nebo https.' }
    }
    if (!aktualni.hostname) {
      return { stav: 'chyba', duvod: 'Adrese obrázku chybí doména.' }
    }

    let adresy: { address: string; family: number }[]
    try {
      adresy = await lookup(aktualni.hostname, { all: true, verbatim: true })
    } catch {
      return { stav: 'chyba', duvod: 'Doménu obrázku se nepodařilo přeložit.' }
    }

    if (adresy.length === 0 || adresy.some((a) => jeZakazanaIp(a.address))) {
      return { stav: 'chyba', duvod: 'Adresa obrázku míří do privátní nebo jinak zakázané sítě.' }
    }

    const vysledek = await jedenPozadavek(aktualni, adresy[0].address)

    if (vysledek.stav === 'presmerovani') {
      try {
        aktualni = new URL(vysledek.kam, aktualni)
      } catch {
        return { stav: 'chyba', duvod: 'Přesměrování vedlo na neplatnou adresu.' }
      }
      continue
    }

    return vysledek
  }

  return { stav: 'chyba', duvod: 'Příliš mnoho přesměrování za sebou.' }
}

type VysledekPozadavku = VysledekStazeni | { stav: 'presmerovani'; kam: string }

/** Jeden HTTP(S) požadavek na JIŽ OVĚŘENOU IP adresu. */
function jedenPozadavek(u: URL, ip: string): Promise<VysledekPozadavku> {
  return new Promise((resolve) => {
    let vyrizeno = false
    const dokonci = (v: VysledekPozadavku) => {
      if (vyrizeno) return
      vyrizeno = true
      resolve(v)
    }

    const posli = u.protocol === 'https:' ? httpsRequest : httpRequest
    const volba: Record<string, unknown> = {
      host: ip,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: { Host: u.hostname, 'User-Agent': 'FoodtabLogoFetch/1.0' },
      timeout: CEKANI_MS,
    }
    // SNI a ověření certifikátu musí jít proti PŮVODNÍMU jménu, ne
    // proti IP — jinak by TLS k cizímu certifikátu (nebo bez SNI)
    // buď spadl zbytečně, nebo přestal ověřovat to podstatné.
    if (u.protocol === 'https:') volba.servername = u.hostname

    const req = posli(volba, (res) => {
      const stav = res.statusCode ?? 0

      if (stav >= 300 && stav < 400 && res.headers.location) {
        res.resume()
        dokonci({ stav: 'presmerovani', kam: res.headers.location })
        return
      }

      if (stav < 200 || stav >= 300) {
        res.resume()
        dokonci({ stav: 'chyba', duvod: `Server odpověděl kódem ${stav}.` })
        return
      }

      const kusy: Buffer[] = []
      let bajtu = 0

      res.on('data', (kus: Buffer) => {
        bajtu += kus.length
        if (bajtu > STROP_BAJTU) {
          dokonci({ stav: 'chyba', duvod: 'Obrázek je větší, než se smí stáhnout.' })
          req.destroy()
          return
        }
        kusy.push(kus)
      })

      res.on('end', () => {
        dokonci({
          stav: 'ok',
          data: new Uint8Array(Buffer.concat(kusy)),
          contentType: String(res.headers['content-type'] ?? ''),
        })
      })

      res.on('error', () => {
        dokonci({ stav: 'chyba', duvod: 'Stahování obrázku selhalo.' })
      })
    })

    req.on('timeout', () => {
      req.destroy()
      dokonci({ stav: 'chyba', duvod: 'Stahování obrázku vypršelo.' })
    })

    req.on('error', () => {
      dokonci({ stav: 'chyba', duvod: 'Stahování obrázku selhalo (síť).' })
    })

    req.end()
  })
}
