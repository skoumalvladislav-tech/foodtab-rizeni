#!/usr/bin/env node
/**
 * `hlaskaProChybu` — čistá logika z lib/integrace-mail-imap.ts, žádné
 * IO. Mapuje syrové chyby z `imapflow` na srozumitelné české hlášky.
 * (Nastavení spojení hlídá v CI scripts/integrace-mail-imap-moznosti.test.mjs.)
 *
 * Pusť `node --experimental-strip-types --conditions=react-server
 * scripts/integrace-mail-imap.test.mjs` (`server-only`, stejný důvod
 * jako u integrace-fio.test.mjs).
 */

const { hlaskaProChybu } = await import('../lib/integrace-mail-imap.ts')

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

console.log('\n== Odmítnutí serverem (imapflow: message "Command failed", důvod v responseText) ==')
{
  const e = Object.assign(new Error('Command failed'), { responseText: 'NO [NOPERM] Mailbox INBOX not readable' })
  const hlaska = hlaskaProChybu(e)
  ok('ukáže důvod od serveru, ne holé "Command failed"', hlaska.includes('NOPERM') && !hlaska.includes('Command failed'))
}

console.log('\n== Neznámá chyba — appka ji nezahodí, ukáže aspoň zprávu ==')
ok('neznámá chyba obsahuje původní zprávu', hlaskaProChybu(new Error('Něco úplně jiného')).includes('Něco úplně jiného'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
