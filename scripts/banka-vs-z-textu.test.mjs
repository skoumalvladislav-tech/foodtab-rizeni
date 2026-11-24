#!/usr/bin/env node
/**
 * Variabilní symbol z volného textu platby — lib/banka/vs-z-textu.ts
 * (Finance Fáze 0, krok 2, bod 10: Enable Banking dává VS jen v textu).
 *
 * Pusť `node --experimental-strip-types scripts/banka-vs-z-textu.test.mjs`.
 *
 * Nejcennější kontroly: nejistý VS se nevymýšlí — dva různé symboly,
 * příliš dlouhé číslo nebo „VS" uprostřed slova dají prázdno. Špatný VS
 * by návrh párování svedl k cizí faktuře.
 */

const { vsZTextu } = await import('../lib/banka/vs-z-textu.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const ma = (popis, text, cekam) => {
  let namereno
  try { namereno = vsZTextu(text) } catch (e) { namereno = `výjimka: ${e instanceof Error ? e.message : e}` }
  ok(`${popis} → „${cekam}" — naměřeno: „${namereno}"`, namereno === cekam)
}

console.log('\n== Běžné zápisy VS v textu platby ==')
ma('„VS 123"', 'Platba faktury VS 123', '123')
ma('„VS:123"', 'VS:123 nájem', '123')
ma('„VS: 2026001"', 'Faktura 2026001, VS: 2026001', '2026001')
ma('„/VS/123/SS//KS/0308" (formát českých bank)', '/VS/123/SS//KS/0308', '123')
ma('„VS123" bez mezery', 'VS123', '123')
ma('„VS-123"', 'Dodavatel VS-123', '123')
ma('malými „vs 77"', 'zálohová vs 77', '77')
ma('úvodní nuly zůstanou (porovnání je normalizuje samo)', 'VS 000123', '000123')
ma('10 číslic je ještě VS', 'VS 1234567890', '1234567890')
ma('stejný VS dvakrát → ten jeden', 'VS 55 / opakovaně VS:55', '55')

console.log('\n== Co jisté není → prázdno ==')
ma('bez značky VS', 'Platba za zboží 12345', '')
ma('prázdný text', '', '')
ma('chybějící text (null)', null, '')
ma('11 číslic není VS (spíš účet nebo karta)', 'VS 12345678901', '')
ma('dva různé VS → nic (nejistý VS je horší než žádný)', 'VS 111 a VS 222', '')
ma('„VS" uprostřed slova (KVS) se nepočítá', 'KVS 123', '')
ma('„VS" za číslicí se nepočítá', '12VS 34', '')
ma('značka bez čísla', 'VS: neuveden', '')
ma('mezi VS a číslem jiný text', 'VS faktury 123', '')

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
