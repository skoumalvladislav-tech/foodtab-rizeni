#!/usr/bin/env node
/**
 * `moznostiImap` — nastavení IMAP spojení (lib/integrace-mail-imap-moznosti.ts).
 * Čistá logika, běží v CI bez přepínačů (Node 24 odstraní typy sám).
 *
 * Hlídá, že heslo nikdy neodejde nešifrovaně: STARTTLS musí být vynucené
 * (doSTARTTLS: true), u TLS se doSTARTTLS nastavit nesmí (imapflow by
 * spojení odmítl jako chybnou konfiguraci a žádná TLS schránka by nešla).
 *
 * Pusť: node scripts/integrace-mail-imap-moznosti.test.mjs
 */

import { MAX_VELIKOST_LITERALU, moznostiImap } from '../lib/integrace-mail-imap-moznosti.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const zaklad = { host: 'imap.example.cz', port: 143, uzivatel: 'u', heslo: 'tajne-heslo' }

console.log('\n== Heslo nikdy nešifrovaně ==')
{
  const starttls = moznostiImap({ ...zaklad, zabezpeceni: 'starttls' })
  ok('STARTTLS: spojení musí přejít na TLS (doSTARTTLS: true), jinak spadne', starttls.doSTARTTLS === true)
  ok('STARTTLS: začíná bez TLS (secure: false) — jinak by STARTTLS nedávalo smysl', starttls.secure === false)

  const tls = moznostiImap({ ...zaklad, port: 993, zabezpeceni: 'tls' })
  ok('TLS: šifrované od prvního bajtu (secure: true)', tls.secure === true)
  ok('TLS: doSTARTTLS NENÍ nastavené (imapflow by TLS spojení odmítl)', !('doSTARTTLS' in tls))

  ok('heslo jde jen do auth', tls.auth?.pass === 'tajne-heslo')
  ok('heslo není nikde jinde v nastavení', JSON.stringify({ ...tls, auth: null }).indexOf('tajne-heslo') === -1)
  ok('logger je vypnutý (nic se nevypisuje do logů)', tls.logger === false)
}

console.log('\n== Strop paměti a časové limity (n8n padal na nedostatek paměti) ==')
{
  const m = moznostiImap({ ...zaklad, port: 993, zabezpeceni: 'tls' })
  ok('maxLiteralSize je nastavený a menší než 64 MB', m.maxLiteralSize === MAX_VELIKOST_LITERALU && MAX_VELIKOST_LITERALU < 64 * 1024 * 1024)
  ok('maxResponseSize je nad maxLiteralSize (jinak by literál na stropu nešel přijmout)', m.maxResponseSize > m.maxLiteralSize)
  ok('časové limity kratší než výchozí (90 s / 5 min)', m.connectionTimeout <= 30_000 && m.socketTimeout <= 120_000)
  ok('automatický IDLE vypnutý (spojení jen na čtení a hned pryč)', m.disableAutoIdle === true)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
