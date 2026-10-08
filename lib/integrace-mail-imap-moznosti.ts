/**
 * Nastavení IMAP spojení — jedno místo pro ověření schránky i příjem
 * dokladů. Bez `server-only` (jen typový import), ať tuhle pojistku
 * hlídá test v CI: scripts/integrace-mail-imap-moznosti.test.mjs.
 */

import type { ImapFlowOptions } from 'imapflow'

export type ZabezpeceniImap = 'tls' | 'starttls'

export type PrihlaseniImap = {
  host: string
  port: number
  zabezpeceni: ZabezpeceniImap
  uzivatel: string
  heslo: string
}

/** Strop na jednu odpověď serveru — n8n na téhle práci padal na nedostatek paměti (UID 4365). */
export const MAX_VELIKOST_LITERALU = 40 * 1024 * 1024

/**
 * `doSTARTTLS: true` u STARTTLS je povinné: bez něj imapflow při
 * serveru, který STARTTLS neohlásí (nebo kterému to útočník na cestě
 * z nabídky vyškrtne), pokračuje NEŠIFROVANĚ a heslo odejde v čistém
 * textu. S ním spojení raději spadne. U TLS se `doSTARTTLS` nastavit
 * nesmí — imapflow pak spojení odmítne jako chybnou konfiguraci.
 */
export function moznostiImap(prihlaseni: PrihlaseniImap): ImapFlowOptions {
  return {
    host: prihlaseni.host,
    port: prihlaseni.port,
    secure: prihlaseni.zabezpeceni === 'tls',
    ...(prihlaseni.zabezpeceni === 'starttls' ? { doSTARTTLS: true } : {}),
    auth: { user: prihlaseni.uzivatel, pass: prihlaseni.heslo },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
    disableAutoIdle: true,
    maxLiteralSize: MAX_VELIKOST_LITERALU,
    maxResponseSize: MAX_VELIKOST_LITERALU + 1024 * 1024,
  }
}
