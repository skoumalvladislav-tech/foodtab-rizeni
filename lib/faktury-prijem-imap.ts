import 'server-only'

/**
 * Čtení schránky pro příjem faktur — jen pro čtení (EXAMINE, BODY.PEEK):
 * appka zprávy nemaže, nepřesouvá ani neoznačuje přečtené.
 *
 * Nejdřív se posbírá struktura VŠECH zpráv dávky a teprve potom se
 * stahují přílohy — imapflow uvnitř běžícího FETCH jiný příkaz nesnese
 * (zablokuje se).
 */

import { ImapFlow, type ImapFlowOptions } from 'imapflow'

import { moznostiImap, type PrihlaseniImap } from './integrace-mail-imap-moznosti.ts'
import { najitPrilohy } from './faktury-prijem-prilohy.ts'
import type { KandidatPrilohy, UzelStruktury } from './faktury-prijem-typy.ts'

export type ZpravaSPrilohami = {
  uid: number
  messageId: string | null
  /** ISO čas přijetí (IMAP internal date). */
  prijatoKdy: string | null
  /** Holá e-mailová adresa odesílatele, malými písmeny. */
  odesilatel: string | null
  predmet: string | null
  kandidati: KandidatPrilohy[]
}

export type StazenaZprava = ZpravaSPrilohami & {
  /** Obsah stažených příloh podle `cast`. */
  stazene: Map<string, Uint8Array>
}

export type DavkaZprav = {
  uidvalidity: string
  zpravy: StazenaZprava[]
  /** Nejvyšší UID, které je v dávce CELÉ zpracované — sem se smí posunout kurzor. */
  posledniUid: number
  /** true = za `posledniUid` už ve složce nic není. */
  hotovo: boolean
  /** true = UIDVALIDITY se změnilo, starý kurzor neplatí (dávka začala od `od`). */
  resetKurzoru: boolean
}

/** Strop stažených bajtů na jednu dávku — n8n na stejné práci padal na nedostatek paměti. */
export const MAX_BAJTU_DAVKY = 60 * 1024 * 1024

type ZpravaZeServeru = {
  uid: number
  envelope?: { messageId?: string; subject?: string; from?: { address?: string }[] }
  bodyStructure?: UzelStruktury
  internalDate?: Date | string
}

/** Jen to, co z imapflow používáme — test si za to dosadí falešnou schránku. */
export type KlientImap = {
  connect(): Promise<void>
  on(udalost: 'error', posluchac: (chyba: unknown) => void): unknown
  getMailboxLock(cesta: string, moznosti: { readOnly: boolean }): Promise<{ release(): void }>
  readonly mailbox: { uidValidity: bigint | number | string } | false
  search(dotaz: Record<string, unknown>, moznosti: { uid: true }): Promise<number[] | false | undefined>
  fetch(rozsah: number[], dotaz: Record<string, unknown>, moznosti: { uid: true }): AsyncIterable<ZpravaZeServeru>
  download(uid: string, cast: string, moznosti: { uid: true }): Promise<{ content?: AsyncIterable<Uint8Array | string> }>
  logout(): Promise<void>
  close(): void
}

function vytvoritKlientaImap(moznosti: ImapFlowOptions): KlientImap {
  return new ImapFlow(moznosti) as unknown as KlientImap
}

function isoNeboNull(v: Date | string | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function adresaOdesilatele(od: { address?: string }[] | undefined): string | null {
  const adresa = od?.[0]?.address?.trim().toLowerCase()
  return adresa ? adresa : null
}

async function doBajtu(obsah: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const kusy: Uint8Array[] = []
  for await (const kus of obsah) kusy.push(typeof kus === 'string' ? new TextEncoder().encode(kus) : kus)
  const vysledek = new Uint8Array(kusy.reduce((s, k) => s + k.byteLength, 0))
  let pozice = 0
  for (const k of kusy) {
    vysledek.set(k, pozice)
    pozice += k.byteLength
  }
  return vysledek
}

/**
 * Jedno spojení: otevře `slozka` jen pro čtení, najde zprávy za kurzorem
 * (posledniUid > 0 → UID posledniUid+1:* a ručně odfiltrovat uid ≤
 * posledniUid; jinak SEARCH SINCE `od`), vezme nejstarší `limitZprav`,
 * načte jejich strukturu (nejdřív VŠE posbírat, žádný jiný příkaz uvnitř
 * fetch smyčky), pro každou kandidátní přílohu bez `duvodBezStazeni` se
 * zeptá `stahnout(zprava, kandidat)` a stáhne jen ty, kde je odpověď
 * true. Strop součtu stažených bajtů na dávku 60 MB — po překročení
 * dávku ukončí PŘED další zprávou (posledniUid = poslední celá zpráva).
 * Spojení vždy zavře (finally), i po chybě. Moznosti spojení přes
 * moznostiImap() z lib/integrace-mail-imap-moznosti.ts.
 */
export async function nactiDavkuZprav(
  prihlaseni: PrihlaseniImap,
  slozka: string,
  kurzor: { uidvalidity: string | null; posledniUid: number },
  od: string,
  limitZprav: number,
  stahnout: (zprava: ZpravaSPrilohami, kandidat: KandidatPrilohy) => Promise<boolean>,
  /** Po tomhle čase (ms) dávka skončí na hranici celé zprávy — aspoň jedna zpráva projde vždy. */
  konecCteniMs: number = Number.POSITIVE_INFINITY,
  _vytvoritKlienta: (moznosti: ImapFlowOptions) => KlientImap = vytvoritKlientaImap,
): Promise<DavkaZprav> {
  const klient = _vytvoritKlienta(moznostiImap(prihlaseni))
  // Bez posluchače by chyba spojení po přihlášení (vypršení, ECONNRESET)
  // vyletěla jako nezachycená výjimka a shodila proces.
  klient.on('error', () => {})

  try {
    await klient.connect()
    const zamek = await klient.getMailboxLock(slozka, { readOnly: true })
    let davka: DavkaZprav
    try {
      davka = await precistDavku(klient, slozka, kurzor, od, limitZprav, stahnout, konecCteniMs)
    } finally {
      zamek.release()
    }
    await klient.logout()
    return davka
  } catch (e) {
    try {
      klient.close()
    } catch {
      // Zavírání po chybě je jen úklid; původní chyba je důležitější.
    }
    throw e
  }
}

async function precistDavku(
  klient: KlientImap,
  slozka: string,
  kurzor: { uidvalidity: string | null; posledniUid: number },
  od: string,
  limitZprav: number,
  stahnout: (zprava: ZpravaSPrilohami, kandidat: KandidatPrilohy) => Promise<boolean>,
  konecCteniMs: number,
): Promise<DavkaZprav> {
  const schranka = klient.mailbox
  if (!schranka) throw new Error(`Složku „${slozka}" se nepodařilo otevřít.`)
  const uidvalidity = String(schranka.uidValidity)
  const resetKurzoru = kurzor.uidvalidity !== null && kurzor.uidvalidity !== uidvalidity
  const posledni = resetKurzoru ? 0 : Math.max(0, Math.floor(kurzor.posledniUid))

  const nalezene = posledni > 0
    ? await klient.search({ uid: `${posledni + 1}:*` }, { uid: true })
    : await klient.search({ since: new Date(`${od}T00:00:00Z`) }, { uid: true })
  // imapflow při chybě příkazu vrací false — to NENÍ prázdná schránka. Jako
  // „nic nového" by se schránka tvářila přečtená a příjem by tiše stál.
  if (!Array.isArray(nalezene)) throw new Error(`Hledání ve složce „${slozka}" se nepodařilo.`)
  // `n:*` v IMAP vždycky trefí i nejvyšší existující zprávu, i když je pod n.
  const uids = [...new Set(nalezene)].filter((u) => Number.isInteger(u) && u > posledni).sort((a, b) => a - b)
  if (uids.length === 0) return { uidvalidity, zpravy: [], posledniUid: posledni, hotovo: true, resetKurzoru }

  const vybrane = uids.slice(0, Math.max(1, Math.floor(limitZprav)))

  const surove: ZpravaZeServeru[] = []
  for await (const zprava of klient.fetch(vybrane, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
    surove.push(zprava)
  }
  surove.sort((a, b) => a.uid - b.uid)

  const zpravy: StazenaZprava[] = []
  let bajtu = 0
  let preruseno = false
  let posledniCela = posledni
  for (const s of surove) {
    // Čas běhu: skončit před další zprávou (kurzor zůstane na poslední celé).
    if (zpravy.length > 0 && Date.now() >= konecCteniMs) {
      preruseno = true
      break
    }
    const zprava: ZpravaSPrilohami = {
      uid: s.uid,
      messageId: s.envelope?.messageId?.trim() || null,
      prijatoKdy: isoNeboNull(s.internalDate),
      odesilatel: adresaOdesilatele(s.envelope?.from),
      predmet: s.envelope?.subject ?? null,
      kandidati: najitPrilohy(s.bodyStructure),
    }
    const stazene = new Map<string, Uint8Array>()
    for (const kandidat of zprava.kandidati) {
      if (kandidat.duvodBezStazeni) continue
      if (!(await stahnout(zprava, kandidat))) continue
      const stazeni = await klient.download(String(s.uid), kandidat.cast, { uid: true })
      if (!stazeni?.content) continue
      const data = await doBajtu(stazeni.content)
      bajtu += data.byteLength
      stazene.set(kandidat.cast, data)
    }
    zpravy.push({ ...zprava, stazene })
    posledniCela = s.uid
    if (bajtu >= MAX_BAJTU_DAVKY) {
      preruseno = true
      break
    }
  }

  // Zprávy z výběru, které mezi SEARCH a FETCH zmizely, se přeskočí — jinak
  // by se o ně kurzor zasekl navždy.
  const posledniUid = preruseno ? posledniCela : Math.max(posledniCela, vybrane[vybrane.length - 1])
  const hotovo = !preruseno && uids.length <= vybrane.length
  return { uidvalidity, zpravy, posledniUid, hotovo, resetKurzoru }
}
