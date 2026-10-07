#!/usr/bin/env node
/**
 * `hlaskaProChybu` — čistá logika z lib/integrace-mail-imap.ts, žádné
 * IO. Mapuje syrové chyby z `imapflow` na srozumitelné české hlášky.
 *
 * Pusť `node --experimental-strip-types --conditions=react-server
 * scripts/integrace-mail-imap.test.mjs` (`server-only`, stejný důvod
 * jako u integrace-fio.test.mjs).
 */

const { hlaskaProChybu, moznostiImap, MAX_VELIKOST_LITERALU } = await import('../lib/integrace-mail-imap.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Přihlašovací chyba ==')
ok(
  'authenticationFailed → hláška o jméně/heslu, ne syrová výjimka',
  /Přihlašovací jméno nebo heslo/.test(hlaskaProChybu({ authenticationFailed: true, message: 'Invalid credentials' })),
)
ok(
  'zpráva obsahující "auth" (case-insensitive) taky chytí',
  /Přihlašovací jméno nebo heslo/.test(hlaskaProChybu(new Error('AUTH failed'))),
)

console.log('\n== Síťové chyby podle kódu ==')
ok('ENOTFOUND → host se nenašel', /nepodařilo najít/.test(hlaskaProChybu({ code: 'ENOTFOUND', message: 'getaddrinfo' })))
ok('ECONNREFUSED → odmítnuté spojení, zkontrolovat port/zabezpečení', /odmítl spojení/.test(hlaskaProChybu({ code: 'ECONNREFUSED', message: 'connect' })))
ok('ETIMEDOUT → neodpověděl včas', /neodpověděl včas/.test(hlaskaProChybu({ code: 'ETIMEDOUT', message: 'timeout' })))

console.log('\n== TLS problém ==')
ok('zpráva s "certificate" → hláška o TLS', /TLS certifik/.test(hlaskaProChybu(new Error('self signed certificate'))))

console.log('\n== Neznámá chyba — appka ji nezahodí, ukáže aspoň zprávu ==')
ok('neznámá chyba obsahuje původní zprávu', hlaskaProChybu(new Error('Něco úplně jiného')).includes('Něco úplně jiného'))

console.log('\n== Heslo nikdy nešifrovaně ==')
{
  const zaklad = { host: 'imap.example.cz', port: 143, uzivatel: 'u', heslo: 'h' }
  const starttls = moznostiImap({ ...zaklad, zabezpeceni: 'starttls' })
  ok('STARTTLS: spojení musí přejít na TLS (doSTARTTLS: true), jinak spadne', starttls.doSTARTTLS === true && starttls.secure === false)
  const tls = moznostiImap({ ...zaklad, port: 993, zabezpeceni: 'tls' })
  ok('TLS: šifrované od prvního bajtu (secure: true)', tls.secure === true)
  ok('heslo jde jen do auth, nikam jinam', tls.auth?.pass === 'h' && JSON.stringify({ ...tls, auth: null }).indexOf('"h"') === -1)
}

console.log('\n== Strop paměti a časové limity (n8n padal na nedostatek paměti) ==')
{
  const m = moznostiImap({ host: 'x', port: 993, zabezpeceni: 'tls', uzivatel: 'u', heslo: 'h' })
  ok('maxLiteralSize je nastavený a menší než 64 MB', m.maxLiteralSize === MAX_VELIKOST_LITERALU && MAX_VELIKOST_LITERALU < 64 * 1024 * 1024)
  ok('maxResponseSize je nad maxLiteralSize (jinak by literál na stropu nešel přijmout)', m.maxResponseSize > m.maxLiteralSize)
  ok('časové limity kratší než výchozí (90 s / 5 min)', m.connectionTimeout <= 30_000 && m.socketTimeout <= 120_000)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
