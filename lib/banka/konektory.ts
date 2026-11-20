import 'server-only'

/**
 * Registr bankovních konektorů — JEDINÉ místo, které zná jednotlivé
 * banky jménem a spojuje je s neutrální vrstvou (lib/banka/konektor.ts).
 *
 * Konektory jen obalují stávající, v provozu ověřený kód bank beze změny
 * chování: synchronizace, výběr připojení pro úlohu, strop času u
 * dlouhého stahování. Úloha `banka-synchronizace` i „Synchronizovat
 * teď" berou banky odsud — nová banka = nový záznam tady.
 *
 * Pořadí je pořadí zpracování v úloze (dřív napevno v úloze).
 *
 * Banka je jen pro čtení: žádný konektor nic nezadává.
 */

import { vytvoritRegistr, type KonektorBanky, type PohybBanky, type PristupKUctu } from './konektor.ts'
import { KONEKTOR_IMPORT_VYPISU } from './import-vypisu.ts'
import { fioProvider, nactiPohybyFio } from '../integrace-fio.ts'
import { synchronizovatFioPripojeni, vsechnaAktivniFioPripojeni } from '../integrace-fio-sync.ts'
import { jeNakonfigurovano as saltEdgeNakonfigurovano, nactiTransakceSaltEdge, nactiZustatkySaltEdge } from '../integrace-saltedge.ts'
import { synchronizovatSaltEdgePripojeni, vsechnaAktivniSaltEdgePripojeni } from '../integrace-saltedge-sync.ts'
import { konfiguraceKb, nactiTransakce as nactiTransakceKb, nactiZustatky as nactiZustatkyKb } from '../kb-adaa.ts'
import { synchronizovatKbPripojeni, vsechnaAktivniKbPripojeni } from '../kb-adaa-sync.ts'
import { enableBankingProvider, jeNakonfigurovano as enableBankingNakonfigurovano, podepsatJwt } from '../integrace-enablebanking.ts'

const dnes = () => new Date().toISOString().slice(0, 10)

/** Přístup bez potřebné položky — chyba s vysvětlením, ne výjimka. */
function chybiPristup(nazev: string) {
  return { stav: 'chyba' as const, duvod: `Přístup k účtu (${nazev}) je neúplný.` }
}

const fio: KonektorBanky = {
  poskytovatel: 'fio',
  nazev: 'Fio banka',
  druh: 'api',
  nabizetPripojeni: () => true,
  async stahnoutPohyby(pristup: PristupKUctu, od: string) {
    if (!pristup.token) return chybiPristup('token')
    const v = await nactiPohybyFio(pristup.token, od, dnes())
    return v.stav === 'ok' ? { stav: 'ok', pohyby: v.radky } : v
  },
  async nactiZustatky(pristup: PristupKUctu) {
    if (!pristup.token) return chybiPristup('token')
    return fioProvider.nactiZustatky!('', pristup.token)
  },
  synchronizovat: synchronizovatFioPripojeni,
  aktivniPripojeni: vsechnaAktivniFioPripojeni,
}

// Salt Edge v1 je ukončený (app/[rozsah]/finance/integrace/banka/page.tsx,
// SALTEDGE_V1_UKONCENO): nové připojení se nenabízí, stávající se dál
// synchronizují.
const SALTEDGE_V1_UKONCENO = true

const saltEdge: KonektorBanky = {
  poskytovatel: 'saltedge',
  nazev: 'Salt Edge',
  druh: 'api',
  nabizetPripojeni: () => !SALTEDGE_V1_UKONCENO && saltEdgeNakonfigurovano(),
  async stahnoutPohyby(pristup: PristupKUctu, od: string) {
    if (!pristup.connectionId || !pristup.accountId) return chybiPristup('připojení a účet')
    // API stránkuje podle id, ne podle data — stránky se projdou celé
    // a pohyby starší než `od` se vynechají.
    const pohyby: PohybBanky[] = []
    let odId: string | null = null
    do {
      const stranka = await nactiTransakceSaltEdge(pristup.connectionId, pristup.accountId, odId)
      if (stranka.stav === 'chyba') return { stav: 'chyba', duvod: stranka.duvod }
      pohyby.push(...stranka.radky.filter((r) => r.datum >= od))
      odId = stranka.dalsiId
    } while (odId)
    return { stav: 'ok', pohyby }
  },
  async nactiZustatky(pristup: PristupKUctu) {
    if (!pristup.connectionId || !pristup.accountId) return chybiPristup('připojení a účet')
    return nactiZustatkySaltEdge(pristup.connectionId, pristup.accountId)
  },
  synchronizovat: synchronizovatSaltEdgePripojeni,
  aktivniPripojeni: vsechnaAktivniSaltEdgePripojeni,
}

const kb: KonektorBanky = {
  poskytovatel: 'kb_adaa',
  nazev: 'Komerční banka',
  druh: 'api',
  nabizetPripojeni: () => konfiguraceKb() !== null,
  async stahnoutPohyby(pristup: PristupKUctu, od: string) {
    const konf = konfiguraceKb()
    if (!konf) return { stav: 'chyba', duvod: 'Napojení na Komerční banku není na serveru nastavené.' }
    if (!pristup.accessToken || !pristup.accountId) return chybiPristup('token a účet')
    const v = await nactiTransakceKb(konf, {
      accessToken: pristup.accessToken,
      accountId: pristup.accountId,
      menaUctu: pristup.menaUctu ?? 'CZK',
      od: new Date(`${od}T00:00:00Z`),
      do: new Date(),
    })
    return v.stav === 'ok' ? { stav: 'ok', pohyby: v.radky } : { stav: 'chyba', duvod: v.duvod }
  },
  async nactiZustatky(pristup: PristupKUctu) {
    const konf = konfiguraceKb()
    if (!konf) return { stav: 'chyba', duvod: 'Napojení na Komerční banku není na serveru nastavené.' }
    if (!pristup.accessToken || !pristup.accountId) return chybiPristup('token a účet')
    const v = await nactiZustatkyKb(konf, { accessToken: pristup.accessToken, accountId: pristup.accountId, menaUctu: pristup.menaUctu ?? 'CZK' })
    return v.stav === 'ok' ? v : { stav: 'chyba', duvod: v.duvod }
  },
  synchronizovat: synchronizovatKbPripojeni,
  aktivniPripojeni: vsechnaAktivniKbPripojeni,
  // Jeden běh trvá až ~30 s (stahování má strop 25 s); úloha má strop 60 s.
  zacitNejpozdejiMs: 25_000,
}

// Enable Banking: souhlas a první zůstatek ano (app/api/integrace/enablebanking),
// do úlohy synchronizace zapojený není (vědomá mezera, beze změny).
const enableBanking: KonektorBanky = {
  poskytovatel: 'enablebanking',
  nazev: 'Enable Banking',
  druh: 'api',
  nabizetPripojeni: () => enableBankingNakonfigurovano(),
  async stahnoutPohyby(pristup: PristupKUctu, od: string) {
    if (!pristup.ucetId) return chybiPristup('účet')
    let token: string
    try {
      token = await podepsatJwt()
    } catch {
      return { stav: 'chyba', duvod: 'Přihlášení k Enable Banking se nepodařilo.' }
    }
    const v = await enableBankingProvider.nactiTransakce!(pristup.ucetId, token, od, dnes())
    return v.stav === 'ok' ? { stav: 'ok', pohyby: v.radky } : v
  },
  async nactiZustatky(pristup: PristupKUctu) {
    if (!pristup.ucetId) return chybiPristup('účet')
    let token: string
    try {
      token = await podepsatJwt()
    } catch {
      return { stav: 'chyba', duvod: 'Přihlášení k Enable Banking se nepodařilo.' }
    }
    return enableBankingProvider.nactiZustatky!(pristup.ucetId, token)
  },
}

export const REGISTR_BANK = vytvoritRegistr([fio, saltEdge, kb, enableBanking, KONEKTOR_IMPORT_VYPISU])
