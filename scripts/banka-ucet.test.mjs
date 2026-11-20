#!/usr/bin/env node
/**
 * Číslo účtu v jednom tvaru — lib/banka/ucet.ts (Finance Fáze 0, krok 1).
 *
 * Pusť `node scripts/banka-ucet.test.mjs`.
 *
 * Proč na tom záleží: otisk pohybu bez id od banky (migrace
 * 20261119100000) počítá i s protiúčtem. Kdyby tentýž účet přišel
 * jednou jako `19-2000145399/0800` a podruhé jako IBAN, byl by tentýž
 * pohyb v databázi dvakrát. Kontroly tu proto porovnávají PŘESNÝ tvar
 * výstupu, ne „něco se vrátilo".
 */

const { jePlatnyIban, ceskyUcetNaIban, normalizovatUcet, overitCisloUctu } = await import('../lib/banka/ucet.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
// Výjimka v jedné kontrole nesmí schovat ostatní.
const zkus = (popis, fn) => {
  try { ok(popis, fn()) } catch (e) { ok(`${popis} (výjimka: ${e?.message ?? e})`, false) }
}

// Vzorový účet z dokumentace ČNB k IBANu: 19-2000145399/0800.
const VZOR_IBAN = 'CZ6508000000192000145399'

console.log('\n== IBAN: kontrolní číslice (modulo 97) ==')
zkus('vzorový český IBAN je platný', () => jePlatnyIban(VZOR_IBAN))
zkus('IBAN s mezerami a malými písmeny je platný', () => jePlatnyIban('cz65 0800 0000 1920 0014 5399'))
zkus('cizí IBAN (DE) je platný', () => jePlatnyIban('DE89370400440532013000'))
zkus('změněná kontrolní číslice → neplatný', () => !jePlatnyIban('CZ6608000000192000145399'))
zkus('přehozené dvě číslice v čísle → neplatný', () => !jePlatnyIban('CZ6508000000192000145939'))
zkus('nesmysl → neplatný', () => !jePlatnyIban('ahoj'))

console.log('\n== Český účet → IBAN (modulo 11, váhy ČNB) ==')
zkus('19-2000145399/0800 → vzorový IBAN', () => ceskyUcetNaIban('19', '2000145399', '0800') === VZOR_IBAN)
zkus('výsledek je platný IBAN', () => jePlatnyIban(ceskyUcetNaIban('19', '2000145399', '0800') ?? ''))
zkus('špatný kontrolní součet čísla → null', () => ceskyUcetNaIban('19', '2000145398', '0800') === null)
zkus('špatný kontrolní součet předčíslí → null', () => ceskyUcetNaIban('18', '2000145399', '0800') === null)
// Samé nuly projdou modulem 11 (součet 0), účet to ale není. Jediná
// nenulová číslice modulem 11 neprojde nikdy (11 je prvočíslo).
zkus('číslo ze samých nul → null', () => ceskyUcetNaIban('', '00', '0800') === null && ceskyUcetNaIban('0', '0000000000', '0100') === null)
zkus('kód banky musí mít 4 číslice', () => ceskyUcetNaIban('19', '2000145399', '800') === null)

console.log('\n== normalizovatUcet: jeden tvar, ať přijde jakkoli ==')
const TVARY = [
  '19-2000145399/0800',
  ' 19-2000145399/0800 ',
  '19 - 2000145399 / 0800',
  'CZ65 0800 0000 1920 0014 5399',
  'cz6508000000192000145399',
  VZOR_IBAN,
]
for (const t of TVARY) zkus(`„${t}" → ${VZOR_IBAN}`, () => normalizovatUcet(t) === VZOR_IBAN)
zkus('prázdný vstup → prázdný text (sloupec je not null)', () => normalizovatUcet('') === '' && normalizovatUcet(null) === '' && normalizovatUcet(undefined) === '')
zkus('jen mezery → prázdný text', () => normalizovatUcet('   ') === '')
zkus('IBAN se špatnou kontrolní číslicí se nedomýšlí — zůstane, jak přišel (očištěný)', () => normalizovatUcet(' CZ66 0800 0000 1920 0014 5399 ') === 'CZ66 0800 0000 1920 0014 5399')
zkus('český účet se špatným součtem zůstane jako text', () => normalizovatUcet('19-2000145398/0800') === '19-2000145398/0800')
zkus('účet bez kódu banky zůstane jako text (sražené mezery)', () => normalizovatUcet('  2000145399   x ') === '2000145399 x')
zkus('cizí platný IBAN → velkými bez mezer', () => normalizovatUcet('de89 3704 0044 0532 0130 00') === 'DE89370400440532013000')
// Excel při uložení výpisu smaže úvodní nulu kódu banky — týž pohyb by
// jinak měl jiný protiúčet a jiný otisk (zapsal by se podruhé).
zkus('„19-2000145399/800" (Excel smazal nulu kódu banky) → vzorový IBAN', () => normalizovatUcet('19-2000145399/800') === VZOR_IBAN)
zkus('… i se špatným součtem: kód banky doplněný na 4 číslice', () => normalizovatUcet('19-2000145398/800') === '19-2000145398/0800')
zkus('dvoučíslicový „kód banky" se nedomýšlí — zůstane jako text', () => normalizovatUcet('2000145399/80') === '2000145399/80')

console.log('\n== overitCisloUctu: vlastní účet z formuláře ==')
zkus('prázdné = účet bez čísla', () => {
  const v = overitCisloUctu('  ')
  return v.stav === 'ok' && v.ucet === ''
})
zkus('český účet → uloží se jako IBAN', () => {
  const v = overitCisloUctu('19-2000145399/0800')
  return v.stav === 'ok' && v.ucet === VZOR_IBAN
})
zkus('IBAN s překlepem → chyba s vysvětlením (kontrolní číslice)', () => {
  const v = overitCisloUctu('CZ66 0800 0000 1920 0014 5399')
  return v.stav === 'chyba' && v.text.includes('IBAN nesedí')
})
zkus('český účet s překlepem → chyba (kontrolní součet)', () => {
  const v = overitCisloUctu('19-2000145398/0800')
  return v.stav === 'chyba' && v.text.includes('Číslo účtu nesedí')
})
zkus('český účet s kódem banky bez úvodní nuly → uloží se jako IBAN', () => {
  const v = overitCisloUctu('19-2000145399/800')
  return v.stav === 'ok' && v.ucet === VZOR_IBAN
})
zkus('jiný text (účet bez kódu banky) projde očištěný', () => {
  const v = overitCisloUctu('  123456789  ')
  return v.stav === 'ok' && v.ucet === '123456789'
})
zkus('příliš dlouhý text → chyba', () => overitCisloUctu('1'.repeat(65)).stav === 'chyba')

console.log('\n== Platby → nový platební účet: číslo účtu se ověří ==')
const { readFileSync } = await import('node:fs')
const koren = new URL('..', import.meta.url)
const stranka = readFileSync(new URL('app/[rozsah]/finance/platby/page.tsx', koren), 'utf8')
const akce = readFileSync(new URL('app/[rozsah]/finance/platby/akce.ts', koren), 'utf8')
zkus('formulář má pole cislo_uctu', () => /<input[^>]*name="cislo_uctu"/.test(stranka))
zkus('akce číslo ověří (overitCisloUctu) a uloží ověřený tvar', () =>
  /overitCisloUctu\(\s*String\(\s*formData\.get\(\s*'cislo_uctu'\s*\)/.test(akce) && /cislo_uctu:\s*cislo\.ucet\b/.test(akce))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
