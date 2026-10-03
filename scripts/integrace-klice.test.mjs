#!/usr/bin/env node
/**
 * Šifrování přístupových údajů k poskytovatelům — lib/integrace-klice.ts.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/integrace-klice.test.mjs
 *
 * Zrcadlo scripts/marketing-klice.test.mjs — stejná mechanika (AES-256-GCM,
 * formát `v1.iv.tag.data`), jiný klíč v prostředí a jiná data. Tři věci,
 * které se u šifrování kazí beze stopy: náhodné IV, ověřovací značka,
 * žádný náhradní klíč bez proměnné v prostředí.
 */

const KLIC_A = 'a'.repeat(64)
const KLIC_B = '0123456789abcdef'.repeat(4)

process.env.INTEGRACE_KLIC_SIFRY = KLIC_A

const { zasifrovat, rozsifrovat, otiskUdaju, zaslepit, sifrovaniJeNastavene, NAZEV_PROMENNE } =
  await import('../lib/integrace-klice.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function spadlo(f) {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const UDAJE = {
  api_klic: 'sk_live_tohle-je-klic-k-bankovnimu-api',
  ucet_externi_id: 'CZ6508000000192000145399',
}

console.log('\n== Tam a zpátky ==')

const { sifra, otisk } = zasifrovat(UDAJE)
const zpet = rozsifrovat(sifra)

ok('rozšifrovaný klíč se rovná původnímu', zpet.api_klic === UDAJE.api_klic)
ok('rozšifrované číslo účtu se rovná původnímu', zpet.ucet_externi_id === UDAJE.ucet_externi_id)
ok('nic navíc nepřibylo', Object.keys(zpet).length === Object.keys(UDAJE).length)

console.log('\n== Šifra tajemství neobsahuje ==')

ok('klíč není v šifře čitelně', !sifra.includes(UDAJE.api_klic))
ok('číslo účtu není v šifře čitelně', !sifra.includes(UDAJE.ucet_externi_id))
ok('a není tam ani po rozkódování base64url', (() => {
  const cele = sifra.split('.').slice(1).map((c) => Buffer.from(c, 'base64url').toString('latin1')).join('')
  return !cele.includes(UDAJE.api_klic)
})())

console.log('\n== Náhodné IV: dvakrát totéž dá jinou šifru ==')

const druha = zasifrovat(UDAJE)

ok('dvě uložení téhož klíče dají jinou šifru', druha.sifra !== sifra)
ok('ale obě se rozšifrují na totéž', rozsifrovat(druha.sifra).api_klic === UDAJE.api_klic)
ok('a otisk mají stejný', druha.otisk === otisk)

console.log('\n== Přepsaná šifra spadne, nevrátí prázdno ==')

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

process.env.INTEGRACE_KLIC_SIFRY = KLIC_B
ok('šifra z jiného klíče spadne', spadlo(() => rozsifrovat(sifra)) !== null)
process.env.INTEGRACE_KLIC_SIFRY = KLIC_A
ok('a se správným klíčem zase projde', rozsifrovat(sifra).api_klic === UDAJE.api_klic)

console.log('\n== Bez klíče v prostředí se nešifruje vůbec ==')

delete process.env.INTEGRACE_KLIC_SIFRY
ok('bez proměnné nastavené není', sifrovaniJeNastavene() === false)
ok('bez proměnné se nezašifruje', spadlo(() => zasifrovat(UDAJE)) !== null)
ok('a hláška řekne, co chybí', (spadlo(() => zasifrovat(UDAJE)) ?? '').includes(NAZEV_PROMENNE))
ok('bez proměnné se ani nerozšifruje', spadlo(() => rozsifrovat(sifra)) !== null)

process.env.INTEGRACE_KLIC_SIFRY = 'krátký'
ok('krátký klíč se nebere', sifrovaniJeNastavene() === false)
ok('krátký klíč spadne', spadlo(() => zasifrovat(UDAJE)) !== null)

process.env.INTEGRACE_KLIC_SIFRY = 'z'.repeat(64)
ok('64 znaků, které nejsou hex, se nebere', sifrovaniJeNastavene() === false)

process.env.INTEGRACE_KLIC_SIFRY = KLIC_A
ok('se správnou proměnnou nastavené je', sifrovaniJeNastavene() === true)

console.log('\n== Otisk ==')

ok('stejné údaje dají stejný otisk', otiskUdaju(UDAJE) === otiskUdaju({ ...UDAJE }))
ok('na pořadí klíčů nezáleží', otiskUdaju({ ucet_externi_id: UDAJE.ucet_externi_id, api_klic: UDAJE.api_klic }) === otiskUdaju(UDAJE))
ok('jiný klíč dá jiný otisk', otiskUdaju({ ...UDAJE, api_klic: 'jiny' }) !== otiskUdaju(UDAJE))
ok('vyměněné číslo účtu při stejném klíči dá JINÝ otisk',
  otiskUdaju({ ...UDAJE, ucet_externi_id: 'CZ0000000000000000000000' }) !== otiskUdaju(UDAJE))

ok('otisk je kratší než sha256 celé', otiskUdaju(UDAJE).length === 32)
ok('a klíč z něj čitelně nekouká', !otiskUdaju(UDAJE).includes('sk_live'))

console.log('\n== Zaslepení ==')

ok('ukazuje se poslední čtyři znaky', zaslepit('abcdefghij') === '…ghij')
ok('krátká hodnota se neukáže vůbec', zaslepit('abc') === '…')
ok('prázdná hodnota je prázdná', zaslepit('') === '')
ok('celý klíč se neukáže', !zaslepit(UDAJE.api_klic).includes('sk_live'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
