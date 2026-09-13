#!/usr/bin/env node
/**
 * Knihovna fotek — co se nedá ověřit v databázi.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-media.test.mjs
 *
 * ---------------------------------------------------------------------
 * ÚDAJE, KTERÉ MUSÍ SEDĚT NA DVOU MÍSTECH
 *
 * Obrazovka i migrace mluví o témž kbelíku a o téže cestě, ale každá
 * po svém: aplikace řetězcem, databáze politikou. Když se jedno
 * přejmenuje, druhé o tom neví — a pozná se to až tím, že nahrávání
 * v ostrém provozu hlásí „nemáte oprávnění" a nikdo neví proč.
 *
 * Překlad tuhle třídu chyby nechytí: jsou to řetězce.
 */

import { readFileSync } from 'node:fs'

import { KBELIK, PLATNOST_ODKAZU_S, SBIRKY, cestaVUlozisti } from '../lib/marketing-media.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const migraceUlozne = readFileSync('supabase/migrations/20260913170000_marketing_ulozne.sql', 'utf8')
const migracePodklady = readFileSync('supabase/migrations/20260909180000_marketing_podklady.sql', 'utf8')
const migraceFronta = readFileSync('supabase/migrations/20260910040000_marketing_fronta.sql', 'utf8')
const akce = readFileSync('app/[rozsah]/marketing/media/akce.ts', 'utf8')
const obrazovka = readFileSync('app/[rozsah]/marketing/media/page.tsx', 'utf8')

console.log('\n== Kbelík ==')

ok('kbelík se jmenuje stejně v kódu i v migraci',
  migraceUlozne.includes(`'${KBELIK}',\n  '${KBELIK}',`))

ok('a je v migraci založený jako soukromý',
  /values \(\s*'marketing',\s*'marketing',\s*false,/.test(migraceUlozne))

console.log('\n== Cesta ==')

const c = cestaVUlozisti('FIRMA', 'POBOCKA', 'NAZEV', 'jpg')
ok('cesta začíná firmou', c.startsWith('FIRMA/'))
ok('pak je pobočka', c === 'FIRMA/POBOCKA/NAZEV.jpg')

/*
  Firemní fotka má místo pobočky slovo `firma`, ne prázdno. Dvě
  lomítka za sebou se v cestách čtou různě podle toho, kdo je čte —
  a politika by z takové cesty nepoznala vlastníka.
*/
const cf = cestaVUlozisti('FIRMA', null, 'NAZEV', 'png')
ok('firemní fotka má slovo firma', cf === 'FIRMA/firma/NAZEV.png')
ok('a nikdy nevznikne dvojité lomítko', !cf.includes('//'))

ok('totéž slovo zná i politika v migraci',
  migraceUlozne.includes("v_slozky[2] = 'firma'"))

/*
  Politika čte firmu z první složky a pobočku z druhé. Kdyby si to
  aplikace prohodila, nahrávalo by se do cizí firmy — a politika by to
  buď odmítla, nebo, což je horší, povolila.
*/
ok('politika bere firmu z první složky', migraceUlozne.includes('v_slozky[1]::uuid'))
ok('a pobočku z druhé', migraceUlozne.includes('v_slozky[2]::uuid'))

ok('a hloubka cesty je přesně dvě složky',
  migraceUlozne.includes('array_length(v_slozky, 1) is distinct from 2'))

console.log('\n== Nahrávání jde pod přihlášeným člověkem ==')

/*
  Druhá obranná linie (pravidlo 3). Servisní klíč by politiky u
  úložiště obešel a zůstala by jen kontrola v aplikaci.
*/
ok('akce berou klienta se sezením uživatele', akce.includes('getServerSupabase'))
ok('a nesahají na servisní klíč',
  !akce.includes('SERVICE_ROLE') && !akce.includes('klientUlohy'))
ok('před zápisem se ptají na marketing.manage', akce.includes("'marketing.manage'"))

/*
  Pobočka se bere z ověřeného rozsahu, ne z formuláře. `branch_id`
  z prohlížeče je návrh, ne oprávnění (pravidlo 4) — jinak stačí
  přepsat jedno pole a fotka se uloží cizí provozovně.
*/
ok('pobočka se bere ze scope, ne z formuláře',
  akce.includes('branch_id: branchId') && !akce.includes("formData.get('branch_id')"))

console.log('\n== Typ souboru se ověřuje ==')

ok('akce volají čtení obrázku', akce.includes('precistObrazek'))
ok('a ukládají mime z obsahu, ne z prohlížeče',
  akce.includes('mime: obrazek.typ') && !akce.includes('soubor.type'))
ok('otisk se ukládá z obsahu', akce.includes('otisk: obrazek.otisk'))

console.log('\n== Duplicita ==')

ok('před nahráním se hledá týž otisk',
  akce.includes(".eq('otisk', obrazek.otisk)"))
ok('sloupec otisk v tabulce opravdu je',
  migracePodklady.includes('otisk             text not null'))

console.log('\n== Osiřelý soubor po neúspěšném zápisu ==')

/*
  Soubor je nahraný, řádek nevznikl. Bez úklidu by v kbelíku zůstal
  soubor, na který se z aplikace nedá dostat, nikdo o něm neví — a
  platí se za něj.
*/
ok('při chybě zápisu se soubor z kbelíku odstraní',
  /if \(error\) \{[\s\S]{0,600}storage\.from\(KBELIK\)\.remove/.test(akce))

console.log('\n== Náhledy jdou přes podepsaný odkaz ==')

ok('obrazovka podepisuje odkazy', obrazovka.includes('createSignedUrls'))
ok('a nesestavuje veřejnou adresu', !obrazovka.includes('getPublicUrl'))
ok('platnost odkazu je hodina', PLATNOST_ODKAZU_S === 3600)

/*
  Dvě stě samostatných volání by obrazovku natahovalo vteřiny. Proto
  se podepisuje jedním voláním nad seznamem.
*/
ok('odkazy se podepisují na jeden zátah, ne fotku po fotce',
  !obrazovka.includes('createSignedUrl('))

console.log('\n== Sbírky ==')

for (const s of SBIRKY) {
  ok(`sbírka ${s.klic} je i v omezení sloupce`, migracePodklady.includes(`'${s.klic}'`))
}

console.log('\n== Práva k použití hlídá fronta, ne obrazovka ==')

/*
  Obrazovka prošlou fotku jen obarví. O tom, jestli smí ven, rozhoduje
  fronta podle PROVOZNÍHO dne pobočky — kdyby se to počítalo na dvou
  místech, rozešlo by se to.
*/
ok('fronta porovnává pouzitelne_do s provozním dnem',
  migraceFronta.includes('m.pouzitelne_do < app.business_date(p.branch_id, now())'))

/*
  A obrazovka prošlou fotku NESCHOVÁVÁ. Kdyby ji odfiltrovala, člověk
  by ji hledal a nevěděl proč — a hlavně by nevěděl, že příspěvek
  s ní se nezveřejní. Má ji vidět i s vysvětlením.
*/
ok('obrazovka prošlé fotky neodfiltrovává',
  !obrazovka.includes(".lt('pouzitelne_do") && !obrazovka.includes(".gte('pouzitelne_do"))
ok('ale řekne u nich, že se příspěvek nezveřejní',
  obrazovka.includes('Práva vypršela') && obrazovka.includes('nezveřejní'))

console.log('\n== Připojení fotky k příspěvku ==')

const akceVerze = readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')
const detail = readFileSync('app/[rozsah]/marketing/[prispevek]/page.tsx', 'utf8')

ok('obrazovka příspěvku nabízí fotky ke zaškrtnutí', detail.includes('name="media"'))
ok('a předvybere ty z aktuální verze', detail.includes('defaultChecked={vybrane.has(f.id)}'))

/*
  Zaškrtávátka jsou údaj z prohlížeče, tedy návrh (pravidlo 4).
  Bez ověření proti knihovně by stačilo přepsat jedno id a do verze by
  se uložila fotka cizí firmy — RLS by ji nikdy neukázala, ale otisk
  verze by ji zahrnul a fronta by se ji pokusila poslat ven.
*/
ok('uložení verze čte vybrané fotky z formuláře',
  akceVerze.includes("formData.getAll('media')"))
ok('a ověřuje je proti knihovně téže firmy',
  /from\('marketing_media'\)[\s\S]{0,200}\.eq\('tenant_id', tenantId\)[\s\S]{0,120}\.in\('id', vybrane\)/.test(akceVerze))
ok('do verze jdou jen ty nalezené',
  akceVerze.includes('vybrane.filter((id) => platne.has(id))'))
ok('titulní je první vybraná', akceVerze.includes('const titulni = mediaIds[0] ?? null'))
ok('a nekopírují se už jen fotky z předchozí verze',
  !akceVerze.includes('media_ids: soucasna.media_ids'))

/*
  Otisk verze počítá i s fotkami. Kdyby ne, dala by se u schválené
  verze vyměnit fotka beze změny otisku — a schválení by pořád sedělo
  na obsah, který nikdo neviděl.
*/
const lib = readFileSync('lib/marketing.ts', 'utf8')
ok('otisk verze počítá i s fotkami', lib.includes('media_ids: [...v.media_ids].sort()'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
