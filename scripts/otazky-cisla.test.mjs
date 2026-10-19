#!/usr/bin/env node
/**
 * Každá otázka v docs/hlaseni/otazky.md má své číslo jen jednou.
 *
 * Pusť: node scripts/otazky-cisla.test.mjs [soubor]
 *
 * Proč (kontrola PR #147, 19. 10. 2026): dvě větve (Jiné platby #146
 * a Faktury #147) přidaly každá „## 58." — po sloučení s „ponechat obě
 * strany" by v souboru byly dvě otázky 58 a Šéfíkova odpověď „k 58" by
 * se dala vztáhnout k té druhé. Hlídá i zbylé značky konfliktu.
 *
 * Pojistka proti kontrole naprázdno: když vzor nadpisů najde méně než
 * 50 otázek, je to chyba (ne „žádné duplicity").
 */

import { readFileSync } from 'node:fs'

const soubor = process.argv[2] ?? 'docs/hlaseni/otazky.md'
const text = readFileSync(soubor, 'utf8').replace(/\r\n/g, '\n')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log(`\nČísla otázek v ${soubor}`)
const nadpisy = [...text.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => ({ cislo: Number(m[1]), nazev: m[2] }))
ok(`nalezeno ${nadpisy.length} otázek (aspoň 50 — jinak vzor nic nenašel)`, nadpisy.length >= 50)
const podleCisla = new Map()
for (const n of nadpisy) podleCisla.set(n.cislo, [...(podleCisla.get(n.cislo) ?? []), n.nazev])
const dvakrat = [...podleCisla].filter(([, nazvy]) => nazvy.length > 1)
ok(`žádné číslo dvakrát${dvakrat.length ? ' — ' + dvakrat.map(([c, n]) => `${c}: ${n.join(' / ')}`).join('; ') : ''}`, dvakrat.length === 0)
ok('žádná značka konfliktu (<<<<<<< / ======= / >>>>>>>)', !/^(<{7}|={7}|>{7})( |$)/m.test(text))

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
