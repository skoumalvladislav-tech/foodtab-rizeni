#!/usr/bin/env node
/**
 * Ochrana proti SSRF při stahování navrženého loga — co jde ověřit bez
 * sítě.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-ssrf.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * 1. KONKRÉTNÍ IP ADRESY, KTERÉ SE MAJÍ ZAMÍTNOUT A KTERÉ PUSTIT —
 *    přesně podle zadání: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16
 *    (včetně cloudového metadata endpointu 169.254.169.254), ::1,
 *    fc00::/7, fe80::/10 a IPv4 zabalené do IPv6 tvaru.
 *
 * 2. HRANICE ROZSAHŮ, NE JEN JEJICH STŘED — 172.16.0.0/12 se dá splést
 *    s „celým 172.*“ nebo s příliš úzkým rozsahem; test proto zkouší
 *    i adresy těsně za hranicí (172.15.255.255, 172.32.0.0), které
 *    projít MUSÍ.
 *
 * 3. ŽE SE STAHOVÁNÍ ZASTAVÍ DŘÍV, NEŽ SE KAMKOLI PŘIPOJÍ — literální
 *    loopback/metadata adresa a zakázané schéma se zamítnou bez toho,
 *    aby `stahnoutObrazekBezpecne` cokoli poslala po síti (test proto
 *    nepotřebuje připojení k internetu).
 */

import { jeZakazanaIp, jeZakazanaIpv4, jeZakazanaIpv6, stahnoutObrazekBezpecne } from '../lib/marketing-ssrf.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== IPv4: co se MUSÍ zamítnout ==')

for (const ip of [
  '10.0.0.5',
  '10.255.255.255',
  '172.16.0.0',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.0.1',
  '192.168.255.255',
  '127.0.0.1',
  '127.0.0.53',
  '169.254.0.1',
  '169.254.169.254', // cloudový metadata endpoint — nejdůležitější řádek v celém souboru
  '0.0.0.0',
]) {
  ok(`${ip} je zakázaná`, jeZakazanaIpv4(ip) === true)
}

console.log('\n== IPv4: co se MUSÍ pustit (vč. hranic rozsahů) ==')

for (const ip of [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '172.15.255.255', // těsně PŘED 172.16.0.0/12
  '172.32.0.0', // těsně ZA 172.16.0.0/12
  '192.167.255.255', // těsně před 192.168.0.0/16
  '192.169.0.0', // těsně za 192.168.0.0/16
  '11.0.0.0', // těsně za 10.0.0.0/8
]) {
  ok(`${ip} se pustí`, jeZakazanaIpv4(ip) === false)
}

console.log('\n== IPv6: co se MUSÍ zamítnout ==')

for (const ip of [
  '::1',
  'fc00::1',
  'fd12:3456:789a::1',
  'fe80::1',
  'fe80::abcd:1234',
  '::ffff:10.0.0.1', // IPv4 schovaná v IPv6 tvaru — totéž 10/8 jinak zapsané
  '::ffff:169.254.169.254',
]) {
  ok(`${ip} je zakázaná`, jeZakazanaIpv6(ip) === true)
}

console.log('\n== IPv6: co se MUSÍ pustit ==')

for (const ip of [
  '2606:4700:4700::1111', // Cloudflare, veřejná
  '2001:4860:4860::8888', // Google DNS, veřejná
  '::ffff:93.184.216.34', // IPv4 schovaná v IPv6, ale veřejná
]) {
  ok(`${ip} se pustí`, jeZakazanaIpv6(ip) === false)
}

console.log('\n== Společná funkce rozhoduje podle verze, neznámý tvar zamítá ==')

ok('veřejná IPv4 projde přes jeZakazanaIp', jeZakazanaIp('8.8.8.8') === false)
ok('privátní IPv6 je zakázaná přes jeZakazanaIp', jeZakazanaIp('fe80::1') === true)
ok('nesmyslný řetězec se zamítne, ne spadne', jeZakazanaIp('neni-to-ip') === true)

console.log('\n== Stahování se zastaví PŘED síťovým voláním ==')

const schema = await stahnoutObrazekBezpecne('javascript:alert(1)')
ok('zakázané schéma se zamítne', schema.stav === 'chyba')

const neplatna = await stahnoutObrazekBezpecne('tohle neni url')
ok('neplatná URL se zamítne', neplatna.stav === 'chyba')

const loopback = await stahnoutObrazekBezpecne('http://127.0.0.1:1/logo.png')
ok('literální loopback adresa se zamítne', loopback.stav === 'chyba')
ok('a hláška je srozumitelná česká věta, ne prázdný řetězec',
  loopback.stav === 'chyba' && loopback.duvod.length > 0)

const metadata = await stahnoutObrazekBezpecne('http://169.254.169.254/latest/meta-data/')
ok('cloudový metadata endpoint se zamítne', metadata.stav === 'chyba')

const ftp = await stahnoutObrazekBezpecne('ftp://example.com/logo.png')
ok('jiné schéma než http/https se zamítne', ftp.stav === 'chyba')

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
