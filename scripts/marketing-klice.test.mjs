#!/usr/bin/env node
/**
 * Šifrování zákaznických přístupových údajů — lib/marketing-klice.ts.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-klice.test.mjs
 *
 * `--conditions=react-server` je kvůli `import 'server-only'` — stejný
 * důvod jako u scripts/email.test.mjs.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TO TESTUJE ZVLÁŠŤ
 *
 * Šifrování je jediná věc v modulu, u které se PRÁVĚ ÚSPĚCH nedá poznat
 * pohledem. Když se rozpis směn uloží špatně, je to na obrazovce vidět.
 * Když se špatně zašifruje token k Instagramu, vypadá to úplně stejně
 * jako když se zašifruje dobře — pozná se to až tím, že klíč unikne,
 * nebo že ho nikdo nerozšifruje zpátky.
 *
 * Kontroly proto míří na tři věci, které se u tohohle kazí:
 *   1. NÁHODNÉ IV — dvě uložení téhož klíče musí dát jinou šifru.
 *   2. OVĚŘOVACÍ ZNAČKA — přepsaná šifra musí SPADNOUT, ne vrátit
 *      prázdno nebo nesmysl.
 *   3. ŽÁDNÝ NÁHRADNÍ KLÍČ — bez proměnné v prostředí se nesmí nic
 *      zašifrovat „aspoň nějak".
 */

const KLIC_A = 'a'.repeat(64)
const KLIC_B = '0123456789abcdef'.repeat(4)

process.env.MARKETING_KLIC_SIFRY = KLIC_A

const { zasifrovat, rozsifrovat, otiskUdaju, zaslepit, sifrovaniJeNastavene, NAZEV_PROMENNE } =
  await import('../lib/marketing-klice.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Spustí `f` a řekne, jestli spadla. Nic o hlášce — ta se ptá zvlášť. */
function spadlo(f) {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const UDAJE = {
  access_token: 'EAAG-tohle-je-token-k-instagramu-firmy',
  page_id: '17841400000000000',
}

console.log('\n== Tam a zpátky ==')

const { sifra, otisk } = zasifrovat(UDAJE)
const zpet = rozsifrovat(sifra)

ok('rozšifrovaný token se rovná původnímu', zpet.access_token === UDAJE.access_token)
ok('rozšifrované id stránky se rovná původnímu', zpet.page_id === UDAJE.page_id)
ok('nic navíc nepřibylo', Object.keys(zpet).length === Object.keys(UDAJE).length)

console.log('\n== Šifra token neobsahuje ==')

/*
  Vypadá to jako samozřejmost, ale není. Kdyby se někdo omylem uložil
  „v1.<iv>.<značka>.<otevřený text>", projdou VŠECHNY ostatní kontroly
  včetně té na cizí klíč — tahle je jediná, která to chytí.
*/
ok('token není v šifře čitelně', !sifra.includes(UDAJE.access_token))
ok('id stránky není v šifře čitelně', !sifra.includes(UDAJE.page_id))
ok('a není tam ani po rozkódování base64url', (() => {
  const cele = sifra.split('.').slice(1).map((c) => Buffer.from(c, 'base64url').toString('latin1')).join('')
  return !cele.includes(UDAJE.access_token)
})())

console.log('\n== Náhodné IV: dvakrát totéž dá jinou šifru ==')

const druha = zasifrovat(UDAJE)

ok('dvě uložení téhož klíče dají jinou šifru', druha.sifra !== sifra)
ok('ale obě se rozšifrují na totéž', rozsifrovat(druha.sifra).access_token === UDAJE.access_token)
ok('a otisk mají stejný', druha.otisk === otisk)

console.log('\n== Přepsaná šifra spadne, nevrátí prázdno ==')

/*
  Tohle je celý důvod, proč je zvolený režim GCM. Bez ověřovací značky
  by se dal uložený řetězec po bajtech přepsat a rozšifrování by mlčky
  vrátilo jiná data — poskytovatel by odpověděl „nepřihlášen" a hledalo
  by se u Mety něco, co je u nás.
*/
const [v, iv, znacka, data] = sifra.split('.')
const prohozeny = Buffer.from(data, 'base64url')
prohozeny[0] ^= 0xff
const poskozena = [v, iv, znacka, prohozeny.toString('base64url')].join('.')

ok('poškozená data spadnou', spadlo(() => rozsifrovat(poskozena)) !== null)
ok('přepsaná značka spadne', spadlo(() => rozsifrovat([v, iv, 'AAAAAAAAAAAAAAAAAAAAAA', data].join('.'))) !== null)
ok('cizí tvar spadne', spadlo(() => rozsifrovat('tohle není šifra')) !== null)
ok('neznámá verze spadne', spadlo(() => rozsifrovat(['v9', iv, znacka, data].join('.'))) !== null)
ok('a hláška o verzi mluví o tvaru', /tvar/i.test(spadlo(() => rozsifrovat(['v9', iv, znacka, data].join('.')))))

console.log('\n== Cizí klíč nerozšifruje ==')

process.env.MARKETING_KLIC_SIFRY = KLIC_B
ok('šifra z jiného klíče spadne', spadlo(() => rozsifrovat(sifra)) !== null)
process.env.MARKETING_KLIC_SIFRY = KLIC_A
ok('a se správným klíčem zase projde', rozsifrovat(sifra).access_token === UDAJE.access_token)

console.log('\n== Bez klíče v prostředí se nešifruje vůbec ==')

/*
  Žádný náhradní klíč odvozený z jiného tajemství. Odvozený klíč vypadá,
  že šifrování funguje, a přitom je uhodnutelný z něčeho, co je jinde
  v prostředí — CLAUDE.md: „Je to bezpečné, protože někdo něco
  nenastavil" není pojistka.
*/
delete process.env.MARKETING_KLIC_SIFRY
ok('bez proměnné nastavené není', sifrovaniJeNastavene() === false)
ok('bez proměnné se nezašifruje', spadlo(() => zasifrovat(UDAJE)) !== null)
ok('a hláška řekne, co chybí', (spadlo(() => zasifrovat(UDAJE)) ?? '').includes(NAZEV_PROMENNE))
ok('bez proměnné se ani nerozšifruje', spadlo(() => rozsifrovat(sifra)) !== null)

process.env.MARKETING_KLIC_SIFRY = 'krátký'
ok('krátký klíč se nebere', sifrovaniJeNastavene() === false)
ok('krátký klíč spadne', spadlo(() => zasifrovat(UDAJE)) !== null)

process.env.MARKETING_KLIC_SIFRY = 'z'.repeat(64)
ok('64 znaků, které nejsou hex, se nebere', sifrovaniJeNastavene() === false)

process.env.MARKETING_KLIC_SIFRY = KLIC_A
ok('se správnou proměnnou nastavené je', sifrovaniJeNastavene() === true)

console.log('\n== Otisk ==')

ok('stejné údaje dají stejný otisk', otiskUdaju(UDAJE) === otiskUdaju({ ...UDAJE }))
ok('na pořadí klíčů nezáleží', otiskUdaju({ page_id: UDAJE.page_id, access_token: UDAJE.access_token }) === otiskUdaju(UDAJE))
ok('jiný token dá jiný otisk', otiskUdaju({ ...UDAJE, access_token: 'jiny' }) !== otiskUdaju(UDAJE))

/*
  Tahle je proti dřívější podobě, která počítala otisk jen z tokenu:
  výměna id stránky při zachovaném tokenu dávala tentýž otisk a v auditu
  to vypadalo, že se nic nestalo.
*/
ok('vyměněné id stránky při stejném tokenu dá JINÝ otisk',
  otiskUdaju({ ...UDAJE, page_id: '17841499999999999' }) !== otiskUdaju(UDAJE))

ok('otisk je kratší než sha256 celé', otiskUdaju(UDAJE).length === 32)
ok('a token z něj čitelně nekouká', !otiskUdaju(UDAJE).includes('EAAG'))

console.log('\n== Zaslepení ==')

ok('ukazuje se poslední čtyři znaky', zaslepit('abcdefghij') === '…ghij')
ok('krátká hodnota se neukáže vůbec', zaslepit('abc') === '…')
ok('prázdná hodnota je prázdná', zaslepit('') === '')
ok('celý token se neukáže', !zaslepit(UDAJE.access_token).includes('EAAG'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
