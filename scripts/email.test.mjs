#!/usr/bin/env node
/**
 * Odesílání e-mailů — lib/email.ts.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/email.test.mjs
 *
 * `--conditions=react-server` je tam kvůli `import 'server-only'`. Ten
 * balíček má dvě podoby: pod touhle podmínkou je prázdný, jinak schválně
 * padá. Bez přepínače by test spadl na hlášce o klientské komponentě.
 *
 * Proč se to vůbec testuje: podle docs/pozvanky-zadani.md se neodeslaný
 * e-mail MUSÍ poznat. Nejhorší možný výsledek je ten, který se tváří
 * jako úspěch — a to je přesně to, co se stane, když se chybějící klíč
 * nebo odmítnutí od Resendu spolkne. Tiché selhání je horší než pád.
 */

import { odeslatEmail } from '../lib/email.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const zprava = {
  komu: 'kdo@example.com',
  predmet: 'Pozvánka do Foodtabu',
  text: 'odkaz',
  html: '<p>odkaz</p>',
}

/** Podstrčí odpověď místo skutečného volání Resendu. */
function misto(odpoved) {
  const puvodni = globalThis.fetch
  const volani = []
  globalThis.fetch = async (url, opts) => {
    volani.push({ url, opts })
    if (typeof odpoved === 'function') return odpoved()
    return odpoved
  }
  return {
    volani,
    vratit: () => {
      globalThis.fetch = puvodni
    },
  }
}

const jakoOdpoved = (stav, telo) => ({
  ok: stav >= 200 && stav < 300,
  status: stav,
  text: async () => telo,
})

console.log('\n== Chybějící klíč ==')

delete process.env.RESEND_API_KEY
{
  const s = misto(() => {
    throw new Error('Resend se neměl volat, když klíč není')
  })
  ma('bez klíče se nic neposílá a řekne se to', await odeslatEmail(zprava), {
    stav: 'nenastaveno',
  })
  ma('a Resend se opravdu nevolal', s.volani.length, 0)
  s.vratit()
}

console.log('\n== S klíčem ==')

process.env.RESEND_API_KEY = 'testovaci-klic'

{
  const s = misto(jakoOdpoved(200, '{"id":"abc"}'))
  ma('úspěch se pozná', await odeslatEmail(zprava), { stav: 'odeslano' })
  ma('volá se Resend', s.volani[0].url, 'https://api.resend.com/emails')
  ma('klíč jde v hlavičce, ne v adrese',
    s.volani[0].opts.headers.Authorization, 'Bearer testovaci-klic')
  const telo = JSON.parse(s.volani[0].opts.body)
  ma('odesílatel je ověřená doména', telo.from, 'Foodtab <noreply@foodtab.cz>')
  ma('příjemce sedí', telo.to, ['kdo@example.com'])
  ma('posílá se i prostý text, ne jen HTML', typeof telo.text, 'string')
  s.vratit()
}

{
  const s = misto(jakoOdpoved(403, '{"message":"The foodtab.cz domain is not verified."}'))
  ma('odmítnutí se NESPOLKNE', await odeslatEmail(zprava), {
    stav: 'chyba',
    text: 'The foodtab.cz domain is not verified.',
  })
  s.vratit()
}

{
  const s = misto(jakoOdpoved(500, 'Internal Server Error'))
  ma('i odpověď, která není JSON, něco řekne', await odeslatEmail(zprava), {
    stav: 'chyba',
    text: 'Internal Server Error',
  })
  s.vratit()
}

{
  const s = misto(jakoOdpoved(502, ''))
  ma('prázdná odpověď se popíše stavovým kódem', await odeslatEmail(zprava), {
    stav: 'chyba',
    text: 'Resend odpověděl 502.',
  })
  s.vratit()
}

{
  const s = misto(() => {
    throw new Error('fetch failed')
  })
  ma('výpadek sítě se pozná taky', await odeslatEmail(zprava), {
    stav: 'chyba',
    text: 'fetch failed',
  })
  s.vratit()
}

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
