#!/usr/bin/env node
/**
 * Kontrola scénářů v supabase/tests/ — čte se to, co psql opravdu dostane.
 *
 * Pusť `node scripts/scenare.test.mjs`.
 *
 * Proč to existuje: dvakrát po sobě odešel scénář, ve kterém se cestou
 * ztratil jeden znak — z `do $$` bylo `do $` a z `\echo` bylo `echo`.
 * psql v takovém souboru spadne někde uprostřed, další kontroly už
 * neproběhnou a vypadá to, že prošly. Chyba se tak našla až u Šéfíka,
 * a navíc zamaskovala skutečnou díru o dvě stě řádků níž.
 *
 * NENÍ to náhrada za spuštění. Tohle neřekne, jestli scénář platí —
 * řekne jen, že se dá přečíst. Kontroluje se:
 *
 *   * uzavřené řetězce a dolarové uvozovky,
 *   * závorky v každém příkazu,
 *   * `do $$` proti `end $$;`,
 *   * příkazy psql: `\echo` bez zpětného lomítka je useknutý,
 *   * proměnná `:'neco'` použitá dřív, než ji `\gset` nebo `\set` vyrobí.
 */

import fs from 'node:fs'
import path from 'node:path'

const KOREN = path.join(import.meta.dirname, '..', 'supabase')
const SLOZKA = path.join(KOREN, 'tests')
const MIGRACE = path.join(KOREN, 'migrations')

const D = String.fromCharCode(36)

/** Příkazy psql, které v souborech používáme. Jiné se hlásí jako překlep. */
const META = new Set(['echo', 'set', 'gset', 'i', 'ir', 'qecho'])

/**
 * Rozsekání na příkazy tak, jak to dělá psql: středník mimo řetězec,
 * mimo dolarové uvozovky a mimo komentář.
 */
function prikazy(text) {
  const kusy = []
  let ted = ''
  let i = 0
  let uv = '' // ' nebo "
  let dolar = '' // $$ nebo $tag$
  let radek = 1
  let zacatek = 1

  const uloz = () => {
    if (ted.trim()) kusy.push({ text: ted, radek: zacatek })
    ted = ''
    zacatek = radek
  }

  while (i < text.length) {
    const z = text[i]
    if (z === '\n') radek++

    if (dolar) {
      if (text.startsWith(dolar, i)) {
        ted += dolar
        i += dolar.length
        dolar = ''
        continue
      }
      ted += z
      i++
      continue
    }

    if (uv) {
      ted += z
      if (z === uv) {
        // Zdvojená uvozovka je znak, ne konec.
        if (text[i + 1] === uv) {
          ted += uv
          i += 2
          continue
        }
        uv = ''
      }
      i++
      continue
    }

    // Komentáře
    if (z === '-' && text[i + 1] === '-') {
      const konec = text.indexOf('\n', i)
      i = konec === -1 ? text.length : konec
      continue
    }
    if (z === '/' && text[i + 1] === '*') {
      const konec = text.indexOf('*/', i)
      i = konec === -1 ? text.length : konec + 2
      continue
    }

    if (z === "'" || z === '"') {
      uv = z
      ted += z
      i++
      continue
    }

    const d = text.slice(i).match(/^\$[A-Za-z_]*\$/)
    if (d) {
      dolar = d[0]
      ted += d[0]
      i += d[0].length
      continue
    }

    if (z === ';') {
      ted += z
      uloz()
      i++
      continue
    }

    ted += z
    i++
  }

  if (dolar) return { kusy, nedovrena: `dolarová uvozovka ${dolar}` }
  if (uv) return { kusy, nedovrena: `řetězec v ${uv}` }
  uloz()
  return { kusy, nedovrena: null }
}

let chyb = 0
const chyba = (soubor, radek, popis) => {
  chyb++
  console.log(`  CHYBA ${soubor}:${radek} — ${popis}`)
}

const soubory = fs
  .readdirSync(SLOZKA)
  .filter((f) => f.endsWith('.sql'))
  .sort()

for (const soubor of soubory) {
  const text = fs.readFileSync(path.join(SLOZKA, soubor), 'utf8')
  const radky = text.split('\n')

  /* --- příkazy psql ------------------------------------------------ */
  radky.forEach((r, i) => {
    const t = r.trim()
    // Useknuté zpětné lomítko: `echo ''` na začátku řádku je vždycky
    // rozbitý `\echo`, žádný SQL příkaz tak nezačíná.
    //
    // U `set` to tak snadné není: `update ... \n set sloupec = 'x'` je
    // poctivé SQL a začíná stejně. Rozliší je rovnítko — `\set jméno
    // hodnota` ho nikdy nemá, přiřazení ve `update` vždycky.
    const psqlSet =
      /^set\s/i.test(t) &&
      !/^set\s+(role|search_path|local|session)/i.test(t) &&
      !t.includes('=')
    if (/^(echo|gset)\s/.test(t) || psqlSet) {
      chyba(soubor, i + 1, `chybí zpětné lomítko: ${JSON.stringify(t.slice(0, 40))}`)
    }
    const m = t.match(/^\\([a-z]+)/)
    if (m && !META.has(m[1])) {
      chyba(soubor, i + 1, `neznámý příkaz psql: \\${m[1]}`)
    }
  })

  /* --- dolarové bloky ---------------------------------------------- */
  const doBloku = radky.filter((r) => /^\s*do\s+\$\$\s*$/.test(r)).length
  const endBloku = radky.filter((r) => /^\s*end\s+\$\$;\s*$/.test(r)).length
  radky.forEach((r, i) => {
    const t = r.trim()
    if (/^do\s+\$(?!\$)/.test(t)) chyba(soubor, i + 1, `useknuté \`do $$\`: ${JSON.stringify(t)}`)
    if (/^end\s+\$;/.test(t)) chyba(soubor, i + 1, `useknuté \`end $$;\`: ${JSON.stringify(t)}`)
  })

  /* --- rozsekání na příkazy ---------------------------------------- */
  const { kusy, nedovrena } = prikazy(text)
  if (nedovrena) chyba(soubor, radky.length, `na konci souboru zůstala otevřená ${nedovrena}`)

  for (const k of kusy) {
    let hloubka = 0
    let spatne = false
    for (const z of k.text) {
      if (z === '(') hloubka++
      else if (z === ')') {
        hloubka--
        if (hloubka < 0) spatne = true
      }
    }
    if (spatne || hloubka !== 0) {
      chyba(soubor, k.radek, `nevyvážené závorky (${hloubka > 0 ? 'chybí ' + hloubka + ' zavírací' : 'přebývá zavírací'})`)
    }
  }

  /*
    Proměnné. Sbírá se po PŘÍKAZECH, ne po řádcích: `select id as perla
    ... \gset` bývá přes dva řádky a alias stojí na tom prvním. Kdyby se
    četlo po řádcích, hlásila by kontrola překlep u každého takového
    místa — a hlášení, které křičí i na to, co je v pořádku, si nikdo
    nepřečte.
  */
  const zname = new Set()
  let buf = []
  let bufRadek = 1

  const zpracuj = () => {
    if (buf.length === 0) return
    const cely = buf.join('\n')
    for (const m of cely.matchAll(/:'([a-z_][a-z0-9_]*)'/gi)) {
      if (!zname.has(m[1])) {
        chyba(soubor, bufRadek, `proměnná :'${m[1]}' se používá dřív, než vznikne`)
        zname.add(m[1]) // ať se to nehlásí u každého dalšího výskytu
      }
    }
    if (cely.includes('\\gset')) {
      // `select x as jmeno, y as druhe ... \gset` vyrábí proměnné podle
      // pojmenovaných sloupců.
      for (const m of cely.matchAll(/\bas\s+([a-z_][a-z0-9_]*)/gi)) zname.add(m[1])
    }
    for (const m of cely.matchAll(/\\set\s+([a-z_][a-z0-9_]*)/gi)) zname.add(m[1])
    buf = []
  }

  radky.forEach((r, i) => {
    if (buf.length === 0) bufRadek = i + 1
    buf.push(r)
    const t = r.trim()
    if (t.endsWith(';') || t.includes('\\gset') || t.startsWith('\\')) zpracuj()
  })
  zpracuj()

  /*
    Nastavení sezení. Do `do $$` bloku se proměnná psql nedostane, takže
    se hodnoty předávají přes `set_config('test.neco', …)` a čtou přes
    `current_setting('test.neco')`.

    Pořadí se snadno přehodí — `set_config` skončí až za blokem, který
    hodnotu čte. Chyba se pak ukáže až za běhu, hláškou o neexistujícím
    parametru, a to ještě jen když se ten blok vůbec dostane ke slovu.

    Sezení je pro každý soubor nové (run.sh volá psql zvlášť), takže
    pořadí uvnitř souboru je celá pravda. Dvouargumentové
    `current_setting(…, true)` se nehlásí: to je schválně „přečti, když
    je nastaveno“.
  */
  const nastavene = new Set()
  radky.forEach((r, i) => {
    for (const m of r.matchAll(/set_config\(\s*'([^']+)'/g)) nastavene.add(m[1])
    for (const m of r.matchAll(/current_setting\(\s*'([^']+)'\s*\)/g)) {
      if (!nastavene.has(m[1])) {
        chyba(soubor, i + 1, `current_setting('${m[1]}') se čte dřív, než ho set_config nastaví`)
        nastavene.add(m[1])
      }
    }
  })

  console.log(
    `  ${soubor}: ${kusy.length} příkazů, ${doBloku}× do $$, ${endBloku}× end $$;`,
  )
}

/*
  Migrace: hlídá se jen párování dolarových uvozovek, zato u všech.

  Odkud se ta chyba bere: skripty, kterými se soubory upravují, používaly
  `String.replace(kotva, novy)`. V NÁHRADNÍM řetězci má ale dolar zvláštní
  význam — `$$` je escape pro jeden dolar a `` $` `` vloží text před
  shodou. Z `do $$` se tak stalo `do $` a nikdo si toho nevšiml, dokud to
  nespadlo u Šéfíka. V migraci by to bylo horší než v testu.
*/
const parovaZnacka = new RegExp('\\' + D + '[A-Za-z_]*\\' + D, 'g')

for (const f of fs.readdirSync(MIGRACE).filter((x) => x.endsWith('.sql')).sort()) {
  const cely = fs.readFileSync(path.join(MIGRACE, f), 'utf8')
  const pocty = {}
  for (const m of cely.matchAll(parovaZnacka)) pocty[m[0]] = (pocty[m[0]] || 0) + 1
  const liche = Object.entries(pocty).filter(([, n]) => n % 2 !== 0)
  if (liche.length) {
    chyb++
    console.log(`  CHYBA migrations/${f} — lichý počet dolarových značek: ${JSON.stringify(liche)}`)
  }

  cely.split('\n').forEach((r, i) => {
    const t = r.trim()
    if (new RegExp('^do\\s+\\' + D + '(?!\\' + D + ')').test(t)) {
      chyb++
      console.log(`  CHYBA migrations/${f}:${i + 1} — useknuté \`do ${D}${D}\``)
    }
    if (new RegExp('^end\\s+\\' + D + ';').test(t)) {
      chyb++
      console.log(`  CHYBA migrations/${f}:${i + 1} — useknuté \`end ${D}${D};\``)
    }
  })
}
console.log(`  migrations: ${fs.readdirSync(MIGRACE).filter((x) => x.endsWith('.sql')).length} souborů`)

console.log(chyb === 0 ? '\nVŠECHNO JDE PŘEČÍST' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
