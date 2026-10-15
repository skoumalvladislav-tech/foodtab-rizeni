#!/usr/bin/env node
/**
 * Platby po pobočkách — lib/finance-platby-pobocka.ts a to, že ho
 * akce a stránka Plateb doopravdy používají.
 *
 * Pusť `node scripts/finance-platby-pobocka.test.mjs`.
 *
 * Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru." Nejcennější kontroly tady:
 *
 *   1. Na pobočce se pobočka účtu NIKDY nebere z formuláře — skryté pole
 *      si kdokoli přepíše a účet by z Bernard Baru založil jiné pobočce
 *      nebo celé firmě.
 *   2. Na pobočce se nedá zapsat platba na firemní účet ani účet jiné
 *      pobočky (`branch_id` null není „patří všem").
 *   3. Pouhé „Uložit" u účtu ve vypnuté pobočce ho nepřesune na celou
 *      firmu (výběr musí současnou pobočku nabízet).
 *   4. Párování s fakturami, pobočka účtu a import výpisu chtějí právo
 *      ZA CELOU FIRMU, ne za rozsah z formuláře (zdrojové kontroly dole —
 *      bez nich by čisté funkce prošly i nad akcí, která je nevolá).
 */

import { readFileSync } from 'node:fs'

const { pobockaUctu, ucetPatriRozsahu, nazevPobockyUctu, volbyPobockyUctu, CELA_FIRMA } =
  await import('../lib/finance-platby-pobocka.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const BERNARD = 'b-bernard'
const KAVARNA = 'b-kavarna'
const VYPNUTA = 'b-vypnuta'

console.log('\n== Pobočka nového účtu: na pobočce vždy ta z rozsahu ==')

const zFormulareJina = pobockaUctu(BERNARD, KAVARNA, [KAVARNA])
ok('na Bernard Baru s podvrženou Kavárnou ve formuláři → Bernard Bar',
  zFormulareJina.stav === 'ok' && zFormulareJina.branchId === BERNARD)
const zFormularePrazdna = pobockaUctu(BERNARD, '', [])
ok('na Bernard Baru s prázdným polem („celá firma") → pořád Bernard Bar, ne null',
  zFormularePrazdna.stav === 'ok' && zFormularePrazdna.branchId === BERNARD)
const bezPole = pobockaUctu(BERNARD, null, [])
ok('na Bernard Baru bez pole → Bernard Bar', bezPole.stav === 'ok' && bezPole.branchId === BERNARD)

console.log('\n== Pobočka nového účtu: za celou firmu jen pobočka firmy ==')

const firma = pobockaUctu(null, '', [BERNARD])
ok('prázdný výběr → účet celé firmy (null)', firma.stav === 'ok' && firma.branchId === null)
const mezery = pobockaUctu(null, '   ', [BERNARD])
ok('jen mezery → účet celé firmy (null)', mezery.stav === 'ok' && mezery.branchId === null)
const nic = pobockaUctu(null, undefined, [])
ok('chybějící pole → účet celé firmy (null)', nic.stav === 'ok' && nic.branchId === null)
const platna = pobockaUctu(null, KAVARNA, [BERNARD, KAVARNA])
ok('aktivní pobočka firmy → ta pobočka', platna.stav === 'ok' && platna.branchId === KAVARNA)
const sMezerou = pobockaUctu(null, ` ${KAVARNA} `, new Set([KAVARNA]))
ok('id s mezerami okolo a povolené jako Set → ta pobočka', sMezerou.stav === 'ok' && sMezerou.branchId === KAVARNA)
ok('pobočka mimo seznam firmy (cizí firma, vypnutá) → chyba, ne zápis',
  pobockaUctu(null, 'b-cizi-firma', [BERNARD]).stav === 'chyba')
ok('prázdný seznam poboček (dotaz nic nevrátil) → chyba, ne zápis',
  pobockaUctu(null, BERNARD, []).stav === 'chyba')

console.log('\n== Zápis platby: na pobočce jen účet té pobočky ==')

ok('celá firma: firemní účet smí', ucetPatriRozsahu(null, { branch_id: null }))
ok('celá firma: účet pobočky smí', ucetPatriRozsahu(null, { branch_id: BERNARD }))
ok('celá firma: nenalezený účet nesmí', !ucetPatriRozsahu(null, null))
ok('Bernard Bar: jeho účet smí', ucetPatriRozsahu(BERNARD, { branch_id: BERNARD }))
ok('Bernard Bar: FIREMNÍ účet (branch_id null) nesmí', !ucetPatriRozsahu(BERNARD, { branch_id: null }))
ok('Bernard Bar: účet Kavárny nesmí', !ucetPatriRozsahu(BERNARD, { branch_id: KAVARNA }))
ok('Bernard Bar: nenalezený účet nesmí (null i undefined)',
  !ucetPatriRozsahu(BERNARD, null) && !ucetPatriRozsahu(BERNARD, undefined))

console.log('\n== Název pobočky účtu ==')

const POBOCKY = [
  { id: BERNARD, name: 'Bernard Bar', active: true },
  { id: KAVARNA, name: 'Kavárna', active: true },
  { id: VYPNUTA, name: 'Stará výdejna', active: false },
]
ok('bez pobočky → Celá firma', nazevPobockyUctu(null, POBOCKY) === CELA_FIRMA && CELA_FIRMA === 'Celá firma')
ok('aktivní pobočka → její jméno', nazevPobockyUctu(BERNARD, POBOCKY) === 'Bernard Bar')
ok('vypnutá pobočka → jméno s „(vypnutá)"', nazevPobockyUctu(VYPNUTA, POBOCKY) === 'Stará výdejna (vypnutá)')
ok('neznámé id → řekne to, nepředstírá Celou firmu', nazevPobockyUctu('b-smazana', POBOCKY) === 'Pobočka mimo seznam')

console.log('\n== Volby u existujícího účtu: „Uložit" beze změny účet nepřesune ==')

const hodnoty = (volby) => volby.map((v) => v.value)
const firemniVolby = volbyPobockyUctu(POBOCKY, null)
ok('první volba je Celá firma ("")', firemniVolby[0]?.value === '' && firemniVolby[0]?.label === CELA_FIRMA)
ok('firemní účet: Celá firma + jen aktivní pobočky',
  JSON.stringify(hodnoty(firemniVolby)) === JSON.stringify(['', BERNARD, KAVARNA]))
const veVypnute = volbyPobockyUctu(POBOCKY, VYPNUTA)
ok('účet ve vypnuté pobočce: ta pobočka je mezi volbami (jinak by prohlížeč předvybral Celou firmu)',
  hodnoty(veVypnute).includes(VYPNUTA))
ok('…a je popsaná jako vypnutá', veVypnute.find((v) => v.value === VYPNUTA)?.label === 'Stará výdejna (vypnutá)')
const veSmazane = volbyPobockyUctu(POBOCKY, 'b-smazana')
ok('účet v pobočce mimo seznam (smazaná): pořád mezi volbami', hodnoty(veSmazane).includes('b-smazana'))
ok('žádná volba dvakrát', [firemniVolby, veVypnute, veSmazane, volbyPobockyUctu(POBOCKY, BERNARD)]
  .every((v) => new Set(hodnoty(v)).size === v.length))
// Pro KAŽDÝ účet: jeho současná hodnota (defaultValue = branch_id ?? '') je mezi volbami.
ok('pro každou současnou pobočku je defaultValue mezi volbami',
  [null, BERNARD, KAVARNA, VYPNUTA, 'b-smazana'].every((soucasna) => hodnoty(volbyPobockyUctu(POBOCKY, soucasna)).includes(soucasna ?? '')))

console.log('\n== Zdroj: akce a stránka to doopravdy používají ==')

const zdroj = (cesta) => readFileSync(new URL(`../${cesta}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Tělo funkce `nazev` — od její hlavičky po další funkci nejvyšší úrovně. */
const telo = (text, nazev) => {
  const zacatek = text.search(new RegExp(`\\n(export )?async function ${nazev}\\(`))
  if (zacatek < 0) return ''
  const dalsi = text.slice(zacatek + 1).search(/\n(export )?(async )?function |\n\/\*\*|\nconst /)
  return dalsi < 0 ? text.slice(zacatek) : text.slice(zacatek, zacatek + 1 + dalsi)
}

const akce = zdroj('app/[rozsah]/finance/platby/akce.ts')
const firemni = telo(akce, 'pripravitFiremni')
ok('pripravitFiremni ověřuje právo za celou firmu (TENANT_SCOPE_SEGMENT), ne za rozsah',
  /zkusPristup\(tenantId, pravo, TENANT_SCOPE_SEGMENT\)/.test(firemni) && !/zkusPristup\(tenantId, pravo, rozsah\)/.test(firemni))
for (const nazev of ['potvrditParovani', 'zrusitAlokaci', 'zmenitPobockuUctu']) {
  const t = telo(akce, nazev)
  ok(`${nazev}: jde přes pripravitFiremni, ne přes pripravit s rozsahem`,
    t.length > 0 && /await pripravitFiremni\(/.test(t) && !/await pripravit\(/.test(t))
}
ok('potvrditParovani: právo na faktury za celou firmu',
  /zkusPristup\(tenantId, 'faktury\.read', TENANT_SCOPE_SEGMENT\)/.test(telo(akce, 'potvrditParovani')))
const pripravit = telo(akce, 'pripravit')
ok('pripravit: pobočka z rozsahu a na pobočce brána finance.read za celou firmu (jako finance/layout.tsx)',
  /pobockaFinanci\(pristup\.scope\)/.test(pripravit) && /hasAccess\(tenantId, 'finance\.read', null\)/.test(pripravit))
const zalozit = telo(akce, 'zalozitPlatebniUcet')
ok('zalozitPlatebniUcet: pobočka přes pobockaUctu(pobocka, …) a do insertu jde jen její výsledek',
  /pobockaUctu\(pobocka,/.test(zalozit) && /branch_id: volba\.branchId/.test(zalozit) && !/branch_id: branchId/.test(zalozit))
ok('zapsatTransakci: na pobočce ověřuje účet přes ucetPatriRozsahu',
  /if \(pobocka\)/.test(telo(akce, 'zapsatTransakci')) && /ucetPatriRozsahu\(pobocka, ucet\)/.test(telo(akce, 'zapsatTransakci')))
const zmenit = telo(akce, 'zmenitPobockuUctu')
ok('zmenitPobockuUctu: ověří pobočku firmy a kontroluje vrácený řádek (.select)',
  /pobockaUctu\(null,/.test(zmenit) && /aktivniPobockaFirmy\(/.test(zmenit) && /\.select\('id'\)/.test(zmenit) && /\.length !== 1/.test(zmenit))

for (const soubor of ['app/[rozsah]/finance/platby/import/akce.ts', 'app/[rozsah]/finance/platby/import/akce-nahled.ts']) {
  const t = zdroj(soubor)
  ok(`${soubor}: import chce finance.manage za celou firmu, nikde za rozsah`,
    /zkusPristup\(tenantId, 'finance\.manage', TENANT_SCOPE_SEGMENT\)/.test(t) && !/zkusPristup\(tenantId, 'finance\.manage', rozsah\)/.test(t))
}
const importLayout = zdroj('app/[rozsah]/finance/platby/import/layout.tsx')
ok('import/layout.tsx: mimo celou firmu kreslí JenProFirmu',
  /if \(jeRozsahFirmy\(rozsah\)\) return <>\{children\}<\/>/.test(importLayout) && /<JenProFirmu /.test(importLayout))
ok('import/page.tsx: na pobočce nic nenačítá',
  /if \(!jeRozsahFirmy\(rozsah\)\) return null/.test(zdroj('app/[rozsah]/finance/platby/import/page.tsx')))

const stranka = zdroj('app/[rozsah]/finance/platby/page.tsx')
ok('stránka: účty na pobočce jen té pobočky', /if \(pobocka\) dotazUctu = dotazUctu\.eq\('branch_id', pobocka\)/.test(stranka))
ok('stránka: platby na pobočce přes !inner a pobočku účtu',
  /platebni_ucty!inner\(branch_id\)/.test(stranka) && /dotazTransakci\.eq\('platebni_ucty\.branch_id', pobocka\)/.test(stranka))
ok('stránka: návrhy i potvrzená párování se na pobočce nenačítají',
  /pobocka\s*\?\s*\{ navrhy: \[\], faktury: \[\] \}\s*:\s*await nactiNavrhyParovani\(/.test(stranka)
  && /pobocka\s*\?\s*\[\]\s*:\s*await nactiPotvrzeneAlokace\(/.test(stranka))
ok('stránka: odkaz na import jen mimo pobočku',
  /\{!pobocka \? <Link href=\{`\/\$\{rozsah\}\/finance\/platby\/import`\}/.test(stranka)
  && (stranka.match(/finance\/platby\/import`/g) ?? []).length === 1)
ok('stránka: na pobočce věta o firemních položkách', /\{POZNAMKA_FIREMNI\}/.test(stranka))

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
