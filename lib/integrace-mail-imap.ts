/**
 * IMAP — read-only adaptér pro e-mailové schránky (zadání §8, upřesnění
 * 7.10.2026: napojení přes NASTAVENÍ SERVERU — host/port/zabezpečení/
 * jméno/heslo klienta —, ne primárně přes OAuth app appky).
 *
 * Appka se PŘIPOJÍ a OVĚŘÍ přístup (vybere INBOX, nic nestáhne, nic
 * nesmaže/nepřesune/neoznačí přečtené — zadání §8: appka ve výchozím
 * režimu se zprávami nehýbe) — teprve po úspěšném ověření appka
 * připojení uloží. Stejný vzor jako `lib/integrace-fio.ts`
 * (`overitPripojeniFio`): appka nikdy nehlásí „připojeno" bez
 * ověřeného přístupu.
 *
 * STAŽENÍ A ZPRACOVÁNÍ DOKLADŮ (OCR, dedup, směrování do Faktur) JE
 * MIMO ROZSAH TOHOTO SOUBORU — to je samostatná, větší práce čekající
 * na architektonické rozhodnutí (vlastní příjem vs. n8n pipeline,
 * docs/integrace-modul-plan.md). Tenhle soubor appce dovolí ŽIVĖ
 * OVĚŘIT a ULOŽIT přístupové údaje ke schránce — ne přečíst jedinou
 * zprávu.
 */

import 'server-only'

import { ImapFlow } from 'imapflow'

export type ZabezpeceniImap = 'tls' | 'starttls'

export type PrihlaseniImap = {
  host: string
  port: number
  zabezpeceni: ZabezpeceniImap
  uzivatel: string
  heslo: string
}

export type VysledekOvereniImap =
  | { stav: 'ok'; slozky: string[] }
  | { stav: 'chyba'; duvod: string }

/** Srozumitelná hláška pro běžné IMAP chyby — appka nehlásí syrovou výjimku z knihovny. Exportováno pro test bez živého IMAP serveru. */
export function hlaskaProChybu(e: unknown): string {
  const zprava = e instanceof Error ? e.message : String(e)
  const kod = (e as { authenticationFailed?: boolean; code?: string })?.code

  if (/auth/i.test(zprava) || (e as { authenticationFailed?: boolean })?.authenticationFailed) {
    return 'Přihlašovací jméno nebo heslo bylo odmítnuto. U Gmailu/Outlooku zkuste aplikační heslo, ne hlavní heslo k účtu.'
  }
  if (kod === 'ENOTFOUND' || kod === 'EAI_AGAIN') return 'Server se nepodařilo najít — zkontrolujte adresu (host).'
  if (kod === 'ECONNREFUSED') return 'Server odmítl spojení — zkontrolujte port a zabezpečení (TLS/STARTTLS).'
  if (kod === 'ETIMEDOUT' || /timeout/i.test(zprava)) return 'Server neodpověděl včas — zkontrolujte adresu, port a že server povoluje IMAP zvenku.'
  if (/certificate|self signed|SSL/i.test(zprava)) return 'Problém s TLS certifikátem serveru — zkontrolujte zabezpečení (TLS/STARTTLS) a port.'
  return `Připojení se nepodařilo: ${zprava}`
}

/**
 * Živé ověření: přihlásí se, vybere INBOX (bez čtení zpráv), vrátí
 * seznam dostupných složek, a hned se odhlásí. Appka tímhle NIKDY
 * nestahuje zprávy ani přílohy — jen dokazuje, že přístupové údaje
 * fungují.
 */
export async function overitPripojeniImap(prihlaseni: PrihlaseniImap): Promise<VysledekOvereniImap> {
  const klient = new ImapFlow({
    host: prihlaseni.host,
    port: prihlaseni.port,
    secure: prihlaseni.zabezpeceni === 'tls',
    auth: { user: prihlaseni.uzivatel, pass: prihlaseni.heslo },
    logger: false,
  })

  try {
    await klient.connect()
    const slozky = (await klient.list()).map((s) => s.path)
    await klient.logout()
    return { stav: 'ok', slozky }
  } catch (e) {
    try {
      await klient.close()
    } catch {
      // Appka se snaží zavřít spojení po chybě, ale druhá chyba při zavírání appku nezajímá.
    }
    return { stav: 'chyba', duvod: hlaskaProChybu(e) }
  }
}
