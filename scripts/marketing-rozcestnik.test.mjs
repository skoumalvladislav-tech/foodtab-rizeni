#!/usr/bin/env node
/**
 * Rozcestník marketingu.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-rozcestnik.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * Zadání, obrazovka 3 z oddílu 22: velké tlačítko „Vytvořit", blížící
 * se akce, čekající schválení, dnešní naplánovaný obsah, chyby
 * připojení a stručný výkon posledních příspěvků.
 *
 * Do 14. 9. 2026 tu stálo dvacet posledních příspěvků a tři čísla
 * spočítaná z nich. Vypadalo to jako přehled a nebylo.
 *
 * Obrazovka je serverová komponenta a mimo aplikaci se vykreslit nedá,
 * takže se čte její zdroj. Zákazy se ptají kódu BEZ komentářů — jinak
 * se trefí do vlastního vysvětlení, na což jsme narazili u fronty ke
 * schválení.
 */

import { readFileSync } from 'node:fs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const STRANKA = readFileSync('app/[rozsah]/marketing/page.tsx', 'utf8')
const KOD = STRANKA
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

console.log('\n== Zdroj se vůbec přečetl ==')

ok('obrazovka má tělo', STRANKA.length > 4000)

console.log('\n== Šest věcí, které zadání na rozcestníku chce ==')

ok('velké tlačítko na vytvoření', /Vytvořit příspěvek/.test(STRANKA))
ok('čekající schválení', /Čeká na odklepnutí/.test(STRANKA))
ok('dnešní naplánovaný obsah', /Dnes<\/h2>|>Dnes</.test(STRANKA))
ok('blížící se akce', /Blížící se akce/.test(STRANKA))
ok('chyby připojení', /Připojení zlobí/.test(STRANKA))
ok('a poslední odeslané', /Naposledy odesláno/.test(STRANKA))

/*
  ČÍSLA VEDOU NĚKAM. Číslo „3 čekají" bez cesty k těm třem je k ničemu
  — člověk je pak hledá ručně a příště se na rozcestník nepodívá.
*/
ok('čísla jsou prokliknutelná', /function Cislo\(/.test(KOD) && /kam=\{/.test(KOD))
ok('a vedou na frontu, kalendář a publikované',
  /marketing\/schvalovani/.test(KOD)
  && /marketing\/kalendar/.test(KOD)
  && /marketing\/publikovane/.test(KOD))

console.log('\n== Čísla se počítají v databázi, ne z dvaceti řádků ==')

/*
  TOHLE BYLA SKUTEČNÁ CHYBA, ne jen ošklivost.

  Původní obrazovka načetla dvacet posledních příspěvků a z nich
  spočítala „ke schválení: 3". Při dvaceti pěti příspěvcích se ta
  trojka stala nepravdou — a nepoznalo by se to, protože číslo tam
  pořád nějaké stálo.
*/
ok('počítá se přes count: exact', /count: 'exact', head: true/.test(KOD))
ok('a jsou tři taková počítání',
  (KOD.match(/count: 'exact', head: true/g) ?? []).length >= 3)

/*
  A ŽE SE ČÍSLA NEPOČÍTAJÍ Z NAČTENÉHO SEZNAMU. `prispevky.filter(…)
  .length` je přesně ta původní chyba.
*/
ok('žádné číslo se nebere z délky načteného seznamu',
  !/const (keSchvaleni|rozdelane|nepovedlo)[\s\S]{0,120}\.filter\([\s\S]{0,80}\.length/.test(KOD))

console.log('\n== tenant_id v každém dotazu (pravidlo 3) ==')

/*
  DRUHÁ SKUTEČNÁ CHYBA, kterou tu čtení našlo: dotazy se ptaly bez
  `tenant_id` a spoléhaly se jen na RLS. To je jedna obranná linie
  místo dvou. RLS drží — ověřeno scénáři —, ale pravidlo neříká
  „když jedna funguje, druhá je zbytečná".

  Kontrola prochází VŠECHNY dotazy do marketingových tabulek a ptá se,
  jestli má každý filtr na firmu do dvou set znaků.
*/
/*
  DOTAZ SE KRÁJÍ PO `from(`, NE PO N ZNACÍCH.

  Napsal jsem to nejdřív jako okno 260 znaků za `from('…')` — a
  kontrola NEUMĚLA SPADNOUT: když jsem `tenant_id` z jednoho dotazu
  schválně smazal, okno přeteklo do dotazu NÁSLEDUJÍCÍHO a jeho filtr
  se započítal tomu prvnímu. Zelená nad rozbitým kódem.

  Teď se text rozseká na úseky od jednoho `from(` k dalšímu, takže do
  sebe dotazy nemůžou vidět.
*/
const useky = KOD.split(/(?=from\(')/).filter((u) => u.startsWith("from('"))
const dotazy = useky.filter((u) => /^from\('(marketing_[a-z_]+|branches|tenants)'\)/.test(u))

ok('nějaké dotazy se našly', dotazy.length >= 6)

const bezFirmy = dotazy.filter((d) =>
  !/\.eq\('tenant_id', tenantId\)/.test(d) && !/\.eq\('id', tenantId\)/.test(d))

ok(`každý dotaz má filtr na firmu (bez něj: ${bezFirmy.length})`, bezFirmy.length === 0)

console.log('\n== Čas jde přes pásmo (pravidlo 11) ==')

ok('dnešek se počítá v pásmu firmy',
  /const dnes = denVPasmu\(new Date\(\), zonaFirmy\)/.test(KOD))
ok('den příspěvku podle pásma POBOČKY', /denVPasmu\(p\.planovano_na, zona\(p\.branch_id\)\)/.test(KOD))
ok('čas se formátuje přes lib/cas.ts', /datumACasVPasmu\(/.test(KOD))
ok('nepoužívají se místní getry', !/\.get(Hours|Date|Month|FullYear)\(\)/.test(KOD))
ok('ani toISOString na datum', !/toISOString\(\)\.slice/.test(KOD))
ok('pásmo se čte z poboček', /branches'\)[\s\S]{0,120}timezone/.test(KOD))
ok('s pojistkou přes firmu', /tenants'\)[\s\S]{0,80}timezone/.test(KOD))

console.log('\n== Rozcestník nic nemění ==')

/*
  Je to přehled. Kdyby odsud šlo zveřejnit nebo schválit, vznikla by
  druhá cesta vedle té, kterou hlídají spouště.
*/
ok('obrazovka do databáze nepíše',
  !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(KOD))

console.log('\n== Nanečisto se nevydává za skutečné ==')

ok('nanečisto má i tady vlastní štítek', /NANEČISTO/.test(STRANKA))
ok('a pozná se podle stavu, ne podle dohadu',
  /u\.stav === 'zverejneno_nanecisto'/.test(KOD))

console.log('\n== Neměřené se nevydává za nulu ==')

/*
  Zadání chce na rozcestníku „stručný výkon posledních příspěvků".
  Zobrazení a dosah nikde nejsou — analytika (oddíl 18) zatím není.

  Ukázat místo nich nuly by bylo HORŠÍ než neukázat nic: nula
  zobrazení vypadá jako propadák, ne jako „neměřeno". Obrazovka to
  proto říká rovnou.
*/
ok('obrazovka přiznává, že se výkon neměří',
  /neměří/.test(STRANKA))

ok('a žádná vymyšlená čísla tam nejsou',
  !/zobrazení: 0|dosah: 0|0 zobrazení/.test(STRANKA.replace(/ukázali nuly/g, '')))

console.log('\n== Přístup ==')

ok('ptá se na marketing.read', /'marketing\.read'/.test(KOD))
ok('nepřihlášeného posílá na přihlášení', KOD.includes('odkazNaPrihlaseni'))
/*
  HLEDÁ SE V BLOKU, NE V OKNĚ N ZNAKŮ.

  Napsal jsem to nejdřív jako „do 300 znaků za `smiPsat ?`" a spadlo to
  nad SPRÁVNÝM kódem — mezera je o pár znaků delší. Okno pevné délky je
  křehké z obou stran: protáhne se kód a kontrola spadne bez chyby;
  zkrátí se, a chytne se něco vedle. Je to táž past, na kterou jsem
  narazil u práv v kampaních.
*/
const odSmiPsat = KOD.indexOf('smiPsat ? (')
const blokSmiPsat = odSmiPsat < 0 ? '' : KOD.slice(odSmiPsat, KOD.indexOf(') : null}', odSmiPsat))

ok('blok podmíněný právem psát se našel', blokSmiPsat.length > 100)
ok('tlačítko na vytvoření je uvnitř něj',
  /Vytvořit příspěvek/.test(blokSmiPsat))

/*
  Nenasazená databáze se má říct, ne spadnout na hlášce, ze které to
  nikdo nepozná.
*/
ok('nenasazená databáze se vysvětlí', /tabulkaNeexistuje\(/.test(KOD))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
