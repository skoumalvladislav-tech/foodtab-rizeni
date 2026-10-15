#!/usr/bin/env node
/**
 * Finance na telefonu: nic nesmí roztáhnout stránku do šířky.
 *
 * 15. 10. 2026 se v produkci při šířce 360 px (nejužší běžný telefon)
 * měřilo `document.documentElement.scrollWidth`:
 *   * Přehled za firmu 535 px, za pobočku 393 px — kořen stránky je
 *     `display: grid` bez šablony sloupců a jediný automatický sloupec se
 *     roztáhl podle tabulky „Co vyžaduje pozornost" (posuvný obal ho
 *     neomezí);
 *   * Cashflow 381 px — přepínač scénářů v záhlaví se nezalamoval;
 *   * Integrace 418 px — karty jsou odkazy se třídou tlačítka (`ft-tl`
 *     má `white-space: nowrap`) a dlouhý popisek vyčníval;
 *   * Integrace → Pokladna 394 px — přiřazení provozoven mělo sloupce
 *     `minmax(140px, 1fr) minmax(180px, 1.2fr)`, které se nezúží pod 330.
 * Ostatní obrazovky Financí a Faktur se vešly.
 *
 * Rozložení se v Node vykreslit nedá — tady se hlídá, že opravy zůstanou
 * a že žádná mřížka ve Financích nemá pevné minimum sloupce bez `min(…,
 * 100%)`. Samotné chování se ověřuje v prohlížeči (šířka 360 a 320 px).
 *
 * Pusť `node scripts/finance-telefon.test.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const koren = fileURLToPath(new URL('..', import.meta.url))
/** Zdroj bez komentářů a s LF konci řádků. */
const zdroj = (cesta) =>
  readFileSync(join(koren, cesta), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

function soubory(adresar) {
  const out = []
  for (const jmeno of readdirSync(join(koren, adresar))) {
    const cesta = `${adresar}/${jmeno}`
    if (statSync(join(koren, cesta)).isDirectory()) out.push(...soubory(cesta))
    else if (/\.tsx?$/.test(jmeno)) out.push(cesta)
  }
  return out
}

console.log('\n== Společná pravidla (app/globals.css) ==')
{
  const css = zdroj('app/globals.css')
  ok('kořen stránky modulu: jediný sloupec minmax(0, 1fr), ne podle nejširšího obsahu',
    /\.modul-obsah-vnitrek > \* \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css))
  ok('tlačítka v záhlaví stránky se zalamují', /\.ft-hlava-vpravo \{[^}]*flex-wrap: wrap;[^}]*\}/.test(css))
}

console.log('\n== Mřížky ve Financích: pevné minimum sloupce jen přes min(…, 100%) ==')
{
  const finance = soubory('app/[rozsah]/finance')
  ok(`souborů ve Financích přečteno (${finance.length})`, finance.length > 40)
  const pevne = []
  let sMin = 0
  for (const s of finance) {
    const t = zdroj(s)
    for (const m of t.matchAll(/minmax\((\d+)px/g)) pevne.push(`${s}: minmax(${m[1]}px`)
    sMin += (t.match(/minmax\(min\(\d+px, 100%\)/g) ?? []).length
  }
  ok(`žádné minmax(Npx, …) bez min(…, 100%)${pevne.length ? ' — ' + pevne.slice(0, 4).join('; ') : ''}`, pevne.length === 0)
  ok(`… a opravené mřížky na místě (${sMin}, čekáno aspoň 28)`, sMin >= 28)
}

console.log('\n== Konkrétní místa z měření 15. 10. ==')
{
  const cashflow = zdroj('app/[rozsah]/finance/cashflow/page.tsx')
  ok('Cashflow: přepínač scénářů se zalomí', /<div style=\{\{ display: 'flex', gap: '8px', flexWrap: 'wrap' \}\}>\s*\{\(Object\.keys\(NAZVY_SCENARU\)/.test(cashflow))
  const integrace = zdroj('app/[rozsah]/finance/integrace/page.tsx')
  ok('Integrace: všechny tři karty-odkazy zalamují text (ft-tl je nowrap)',
    (integrace.match(/className="ft-tl" style=\{\{ \.\.\.karta, display: 'block', whiteSpace: 'normal' \}\}/g) ?? []).length === 3
    && !/className="ft-tl" style=\{\{ \.\.\.karta, display: 'block' \}\}/.test(integrace))
  const pokladna = zdroj('app/[rozsah]/finance/integrace/pokladna/obsah.tsx')
  ok('Pokladna: přiřazení provozovny — popisek a výběr pod sebou, když se nevejdou',
    pokladna.includes("gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: '10px', alignItems: 'center'")
    && !pokladna.includes('minmax(140px, 1fr) minmax(180px, 1.2fr)'))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
