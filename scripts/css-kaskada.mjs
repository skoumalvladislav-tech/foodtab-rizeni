/**
 * Kaskáda skutečného CSS aplikace mimo prohlížeč.
 *
 * ---------------------------------------------------------------------
 * K ČEMU TO JE
 *
 * Od 19. 9. do 27. 10. 2026 se na telefonu pod mobilním rozpisem směn
 * kreslila i celá týdenní mřížka z počítače. Obal mřížky měl třídu
 * `ds-sm-jen-desktop` (do 640 px `display: none`), ale o 600 řádků níž
 * stálo `.ds-smd { display: flex }` se stejnou specifičností — a pozdější
 * pravidlo vyhrálo. Kontrola, která čte jen pravidlo pro schování, by
 * u toho hlásila „prošlo“: rozhoduje až to, co z celé kaskády VYHRAJE.
 *
 * ---------------------------------------------------------------------
 * JAK
 *
 * `nactiCss()` načte app/globals.css i soubory, které importuje, v tom
 * pořadí, v jakém je skládá prohlížeč. `vitez()` pak pro prvek s danými
 * třídami a šířku okna spočítá, která deklarace vlastnosti vyhraje:
 * nejdřív `!important`, pak specifičnost, pak pořadí ve zdroji.
 * `prvkySTridou()` najde v .tsx prvky, které třídu opravdu nesou.
 *
 * Co rozhodnout neumí (pravidlo, které závisí na předcích prvku, na
 * stavu jako `:hover`, na `@container` nebo `@supports`), nezahodí: když
 * by takové pravidlo mohlo vyhrát, vrátí ho v `nejiste` a kontrola nad
 * tím má spadnout, ne mlčet. Neznámé @pravidlo nebo vnořené CSS
 * nahlas shodí už načtení.
 *
 * Utility z Tailwindu (`@import "tailwindcss"`) leží ve vrstvách a
 * vlastní pravidla aplikace (mimo vrstvu) je přebijí vždycky; proto se
 * nenačítají.
 */

import fs from 'node:fs'
import path from 'node:path'

export const KOREN = path.join(import.meta.dirname, '..')

/** @pravidla, uvnitř kterých nejsou pravidla pro prvky stránky. */
const BEZ_PRVKU = new Set([
  'keyframes', 'font-face', 'property', 'page', 'counter-style', 'font-feature-values',
  'theme', 'utility', 'custom-variant', 'variant', 'source', 'plugin', 'config',
])
/** @pravidla s podmínkou, uvnitř kterých platí běžná pravidla. */
const S_PODMINKOU = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style'])

/** Nahradí komentáře mezerami; nové řádky nechá, ať čísla řádků sedí. */
function bezKomentaru(text) {
  let ven = ''
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      ven += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '*') {
      const konec = text.indexOf('*/', i + 2)
      const k = konec < 0 ? text.length : konec + 2
      ven += text.slice(i, k).replace(/[^\n]/g, ' ')
      i = k
    } else {
      ven += c
      i++
    }
  }
  return ven
}

/**
 * Index prvního z `znaky` na hloubce 0 (mimo závorky a uvozovky) od `od`,
 * nebo `do`, když tam žádný není.
 */
function najdiMimoZavorky(text, od, doo, znaky) {
  let hloubka = 0
  for (let i = od; i < doo; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      i++
      while (i < doo && text[i] !== c) i += text[i] === '\\' ? 2 : 1
    } else if (c === '\\') i++
    else if (c === '(' || c === '[') hloubka++
    else if (c === ')' || c === ']') hloubka--
    else if (hloubka === 0 && znaky.includes(c)) return i
  }
  return doo
}

/** Index `}`, která uzavírá blok otevřený na `otevrena`. */
function parovaZavorka(text, otevrena, kde) {
  let hloubka = 0
  for (let i = otevrena; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
    } else if (c === '\\') i++
    else if (c === '{') hloubka++
    else if (c === '}' && --hloubka === 0) return i
  }
  throw new Error(`${kde} — neuzavřený blok`)
}

/** Rozdělí text podle `oddelovac` na hloubce 0; prázdné kusy vynechá. */
function rozdel(text, oddelovac) {
  const kusy = []
  for (let od = 0; od <= text.length; ) {
    const k = najdiMimoZavorky(text, od, text.length, oddelovac)
    const kus = text.slice(od, k).trim()
    if (kus) kusy.push(kus)
    od = k + 1
  }
  return kusy
}

function deklarace(telo) {
  return rozdel(telo, ';').map((d) => {
    const dvojtecka = d.indexOf(':')
    if (dvojtecka < 0) throw new Error(`nečitelná deklarace „${d}“`)
    let hodnota = d.slice(dvojtecka + 1).trim()
    const dulezite = /!\s*important$/i.test(hodnota)
    if (dulezite) hodnota = hodnota.replace(/!\s*important$/i, '').trim()
    return { vlastnost: d.slice(0, dvojtecka).trim().toLowerCase(), hodnota, dulezite }
  })
}

/**
 * Načte CSS aplikace od `vstup` (výchozí app/globals.css) i s importy.
 * Vrací `{ pravidla }` v pořadí kaskády; každé pravidlo zná soubor,
 * řádek, selektory, deklarace a podmínky (@media…), pod kterými leží.
 */
export function nactiCss(vstup = 'app/globals.css', koren = KOREN) {
  const pravidla = []
  const nacteno = new Set()

  function soubor(rel, podminky) {
    const plna = path.join(koren, rel)
    if (nacteno.has(plna)) throw new Error(`${rel} je importovaný dvakrát`)
    nacteno.add(plna)
    const text = bezKomentaru(fs.readFileSync(plna, 'utf8'))
    const zacatkyRadku = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') zacatkyRadku.push(i + 1)
    const radek = (index) => {
      let lo = 0, hi = zacatkyRadku.length - 1
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (zacatkyRadku[m] <= index) lo = m
        else hi = m - 1
      }
      return lo + 1
    }

    function blok(od, doo, podminky) {
      for (let i = od; i < doo; ) {
        while (i < doo && /\s/.test(text[i])) i++
        if (i >= doo) break
        const k = najdiMimoZavorky(text, i, doo, '{;}')
        const kde = `${rel}:${radek(i)}`
        const prelude = text.slice(i, k).trim()
        if (k >= doo || text[k] === '}') throw new Error(`${kde} — „${prelude.slice(0, 40)}“ bez bloku`)
        if (text[k] === ';') {
          const imp = /^@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?\s*(.*)$/s.exec(prelude)
          if (imp) {
            if (imp[2]) throw new Error(`${kde} — import s podmínkou („${imp[2]}“) neumím`)
            // Tailwind: utility ve vrstvách, vlastní pravidla je přebijí (viz nahoře).
            if (imp[1].startsWith('.')) soubor(path.posix.join(path.posix.dirname(rel), imp[1]), podminky)
          } else if (!prelude.startsWith('@')) {
            throw new Error(`${kde} — deklarace mimo pravidlo: „${prelude}“`)
          }
          i = k + 1
          continue
        }
        const konec = parovaZavorka(text, k, kde)
        if (prelude.startsWith('@')) {
          const [, jmeno, podminka] = /^@([\w-]+)\s*(.*)$/s.exec(prelude)
          if (S_PODMINKOU.has(jmeno)) blok(k + 1, konec, [...podminky, { druh: jmeno, text: podminka.trim() }])
          else if (!BEZ_PRVKU.has(jmeno)) throw new Error(`${kde} — neznámé @${jmeno}`)
        } else {
          if (najdiMimoZavorky(text, k + 1, konec, '{') < konec) throw new Error(`${kde} — vnořené CSS neumím`)
          pravidla.push({
            soubor: rel,
            radek: radek(i),
            selektory: rozdel(prelude, ',').map(rozeberSelektor),
            deklarace: deklarace(text.slice(k + 1, konec)),
            podminky,
            poradi: pravidla.length,
          })
        }
        i = konec + 1
      }
    }
    blok(0, text.length, podminky)
  }

  soubor(vstup, [])
  return { pravidla, podleVlastnosti: rejstrik(pravidla) }
}

/** vlastnost → pravidla, která ji deklarují (ať `vitez` nechodí přes všechna). */
function rejstrik(pravidla) {
  const r = new Map()
  for (const p of pravidla) {
    for (const v of new Set(p.deklarace.map((d) => d.vlastnost))) {
      if (!r.has(v)) r.set(v, [])
      r.get(v).push(p)
    }
  }
  return r
}

/** Jen vybraná pravidla (třeba jedno), ve tvaru, který bere `vitez`. */
export const jenPravidla = (pravidla) => ({ pravidla, podleVlastnosti: rejstrik(pravidla) })

/* ---------------------------------------------------------------------
   Selektory
   --------------------------------------------------------------------- */

const STARE_PSEUDOPRVKY = new Set(['before', 'after', 'first-line', 'first-letter'])

/**
 * `.a.b > .c:hover` → { text, slozene: [{ tridy, znacka, idy, atributy,
 * pseudo: [{ jmeno, argument }], pseudoprvek }], kombinatoru }.
 */
function rozeberSelektor(text) {
  const slozene = []
  let aktualni = null
  const nove = () => (aktualni = { tridy: [], znacka: null, idy: [], atributy: [], pseudo: [], pseudoprvek: null })
  const jmeno = /^(?:\\.|[\w-])+/
  let i = 0
  let kombinator = true
  while (i < text.length) {
    const c = text[i]
    if (/[\s>+~]/.test(c)) {
      i++
      kombinator = true
      continue
    }
    if (kombinator) {
      slozene.push(nove())
      kombinator = false
    }
    const zbytek = text.slice(i)
    if (c === '&') throw new Error(`vnořený selektor „${text}“ neumím`)
    if (c === '.' || c === '#') {
      const m = jmeno.exec(zbytek.slice(1))
      if (!m) throw new Error(`nečitelný selektor „${text}“`)
      const hodnota = m[0].replace(/\\(.)/g, '$1')
      ;(c === '.' ? aktualni.tridy : aktualni.idy).push(hodnota)
      i += 1 + m[0].length
    } else if (c === '[') {
      const k = najdiMimoZavorky(text, i + 1, text.length, ']')
      aktualni.atributy.push(text.slice(i + 1, k))
      i = k + 1
    } else if (c === ':') {
      const dve = text[i + 1] === ':'
      const m = jmeno.exec(zbytek.slice(dve ? 2 : 1))
      if (!m) throw new Error(`nečitelný selektor „${text}“`)
      let j = i + (dve ? 2 : 1) + m[0].length
      let argument = null
      if (text[j] === '(') {
        let hloubka = 0, k = j
        for (; k < text.length; k++) {
          if (text[k] === '(') hloubka++
          else if (text[k] === ')' && --hloubka === 0) break
        }
        argument = text.slice(j + 1, k)
        j = k + 1
      }
      const pj = m[0].toLowerCase()
      if (dve || STARE_PSEUDOPRVKY.has(pj)) aktualni.pseudoprvek = pj
      else aktualni.pseudo.push({ jmeno: pj, argument })
      i = j
    } else if (c === '*') {
      aktualni.znacka = '*'
      i++
    } else {
      const m = jmeno.exec(zbytek)
      if (!m) throw new Error(`nečitelný selektor „${text}“ (u „${zbytek.slice(0, 10)}“)`)
      aktualni.znacka = m[0].toLowerCase()
      i += m[0].length
    }
  }
  return { text, slozene, kombinatoru: slozene.length - 1 }
}

const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const porovnej = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Specifičnost [id, třída/atribut/pseudotřída, značka/pseudoprvek]. */
export function specificnost(sel) {
  sel.spec ??= spocitejSpecificnost(sel)
  return sel.spec
}

function spocitejSpecificnost(sel) {
  let s = [0, 0, 0]
  for (const k of sel.slozene) {
    s = plus(s, [k.idy.length, k.tridy.length + k.atributy.length, k.znacka && k.znacka !== '*' ? 1 : 0])
    if (k.pseudoprvek) s = plus(s, [0, 0, 1])
    for (const p of k.pseudo) {
      if (p.jmeno === 'where') continue
      if (['is', 'not', 'has'].includes(p.jmeno) && p.argument) {
        const nej = rozdel(p.argument, ',').map((a) => specificnost(rozeberSelektor(a))).sort(porovnej).at(-1)
        s = plus(s, nej)
      } else s = plus(s, [0, 1, 0])
    }
  }
  return s
}

/**
 * Sedí selektor na prvek `{ tridy: Set, znacka }`? 'ano', 'ne', nebo
 * 'mozna' — když záleží na předcích, stavu nebo atributech, které
 * z třídy nepoznáme.
 */
export function shoda(sel, prvek) {
  const posledni = sel.slozene.at(-1)
  if (!posledni || posledni.pseudoprvek) return 'ne' // ::before kreslí jiný box než prvek sám
  if (posledni.tridy.some((t) => !prvek.tridy.has(t))) return 'ne'
  const z = posledni.znacka
  if (z && z !== '*' && prvek.znacka && z !== prvek.znacka) return 'ne'
  const jiste =
    sel.kombinatoru === 0 &&
    !posledni.idy.length && !posledni.atributy.length && !posledni.pseudo.length &&
    (!z || z === '*' || z === prvek.znacka)
  return jiste ? 'ano' : 'mozna'
}

/* ---------------------------------------------------------------------
   Podmínky (@media) — trojhodnotově: true, false, null = nevím
   --------------------------------------------------------------------- */

const a3 = (h) => (h.includes(false) ? false : h.includes(null) ? null : true)
const nebo3 = (h) => (h.includes(true) ? true : h.includes(null) ? null : false)

/** Výchozí prostředí: světlý režim, bez omezení pohybu a vynucených barev. */
const PROSTREDI = { 'prefers-color-scheme': 'light', 'prefers-reduced-motion': 'no-preference', 'forced-colors': 'none' }

function px(hodnota) {
  const m = /^(-?[\d.]+)px$/.exec(hodnota.trim())
  if (!m) throw new Error(`šířku „${hodnota}“ neumím (jen px)`)
  return Number(m[1])
}

function vlastnostMedia(text, prostredi) {
  const t = text.trim()
  const rozsah = /^(width)\s*(<=|>=|<|>)\s*(.+)$/.exec(t) ?? /^(.+?)\s*(<=|>=|<|>)\s*(width)$/.exec(t)
  if (rozsah) {
    const [, l, op, p] = rozsah
    const [a, b] = l === 'width' ? [prostredi.sirka, px(p)] : [px(l), prostredi.sirka]
    return { '<=': a <= b, '>=': a >= b, '<': a < b, '>': a > b }[op]
  }
  const [klic, hodnota] = t.split(':').map((x) => x.trim())
  if (klic === 'max-width') return prostredi.sirka <= px(hodnota)
  if (klic === 'min-width') return prostredi.sirka >= px(hodnota)
  if (klic in prostredi && hodnota !== undefined) return prostredi[klic] === hodnota
  return null
}

export function platiMedia(text, prostredi) {
  return nebo3(
    rozdel(text, ',').map((dotaz) => {
      let d = dotaz.trim()
      const ne = /^not\s+/i.test(d)
      d = d.replace(/^(not|only)\s+/i, '')
      const casti = d.split(/\s+and\s+/i).map((cast) => {
        const c = cast.trim()
        if (c.startsWith('(') && c.endsWith(')')) return vlastnostMedia(c.slice(1, -1), prostredi)
        if (c === 'all' || c === 'screen') return true
        if (c === 'print') return false
        return null
      })
      const h = a3(casti)
      return ne && h !== null ? !h : h
    }),
  )
}

function platiPodminky(podminky, prostredi) {
  return a3(
    podminky.map((p) => (p.druh === 'media' ? platiMedia(p.text, prostredi) : null)),
  )
}

/** Jde o pravidlo, které platí jen od / do nějaké šířky okna? */
export const zavisiNaSirce = (pravidlo) =>
  pravidlo.podminky.some((p) => p.druh === 'media' && /width/.test(p.text))

/* ---------------------------------------------------------------------
   Vítěz kaskády
   --------------------------------------------------------------------- */

/** Kladné číslo, když deklarace `a` přebije `b`. */
function silnejsi(a, b) {
  return (a.dulezite - b.dulezite) || porovnej(a.spec, b.spec) || (a.poradi - b.poradi)
}

/**
 * Která deklarace `vlastnost` vyhraje u prvku `{ tridy: Set, znacka }`
 * při šířce `prostredi.sirka`?
 *
 * Vrací `{ hodnota, vyherce, nejiste }`. `hodnota` je null, když žádné
 * pravidlo jistě neplatí (zůstane výchozí hodnota prohlížeče).
 * `nejiste` jsou pravidla, o kterých nejde rozhodnout, jestli platí,
 * a přitom by vyhrála — dokud tu něco je, `hodnota` nic nedokazuje.
 */
export function vitez(css, prvek, vlastnost, prostredi) {
  const prost = { ...PROSTREDI, ...prostredi }
  const kandidati = []
  for (const pravidlo of css.podleVlastnosti.get(vlastnost) ?? []) {
    const dekl = pravidlo.deklarace
      .map((d, i) => ({ ...d, i }))
      .filter((d) => d.vlastnost === vlastnost)
    if (!dekl.length) continue
    const podminka = platiPodminky(pravidlo.podminky, prost)
    if (podminka === false) continue
    for (const sel of pravidlo.selektory) {
      const s = shoda(sel, prvek)
      if (s === 'ne') continue
      for (const d of dekl) {
        kandidati.push({
          hodnota: d.hodnota,
          dulezite: d.dulezite ? 1 : 0,
          spec: specificnost(sel),
          poradi: pravidlo.poradi + d.i / 1000,
          jiste: s === 'ano' && podminka === true,
          pravidlo,
          selektor: sel.text,
        })
      }
    }
  }
  let vyherce = null
  for (const k of kandidati) if (k.jiste && (!vyherce || silnejsi(k, vyherce) > 0)) vyherce = k
  const nejiste = kandidati.filter((k) => !k.jiste && (!vyherce || silnejsi(k, vyherce) > 0))
  return { hodnota: vyherce?.hodnota ?? null, vyherce, nejiste }
}

/** `app/_komponenty.css:1118 .ds-smd { display: flex }` */
export function popisKandidata(k) {
  return `${k.pravidlo.soubor}:${k.pravidlo.radek} ${k.selektor} { ${k.hodnota}${k.dulezite ? ' !important' : ''} }` +
    (k.pravidlo.podminky.length ? ` uvnitř ${k.pravidlo.podminky.map((p) => `@${p.druh} ${p.text}`).join(' › ')}` : '')
}

/* ---------------------------------------------------------------------
   Prvky ve zdrojácích
   --------------------------------------------------------------------- */

/** Všechny soubory .tsx pod `slozky`. */
export function souboryTsx(slozky = ['app', 'components'], koren = KOREN) {
  return slozky.flatMap((s) =>
    fs.readdirSync(path.join(koren, s), { recursive: true })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => path.join(s, f).split(path.sep).join('/')),
  )
}

/** Kód bez komentářů (`/* … *\/`, `{/* … *\/}`, `// …`); řádky zůstanou. */
function kodBezKomentaru(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pred) => pred + ' '.repeat(m.length - pred.length))
}

const ATRIBUT = /\bclassName=(?:"([^"]*)"|\{\s*(["'])((?:(?!\2).)*)\2\s*\}|\{\s*`([^`]*)`\s*\})/g

/**
 * Prvky v .tsx, které mají className zapsaný přímo (řetězec nebo šablona),
 * jako `{ soubor, radek, znacka, tridy: Set, sablona }`. U šablony se
 * počítají jen pevné třídy; `sablona` říká, že za běhu může přibýt další.
 * `znacka` je null, když className dostává komponenta (`<Panel …>`) —
 * skutečný prvek pak neznáme.
 */
export function prvkyVKodu(soubory = souboryTsx(), koren = KOREN) {
  const prvky = []
  const kody = new Map()
  for (const soubor of soubory) {
    const kod = kodBezKomentaru(fs.readFileSync(path.join(koren, soubor), 'utf8'))
    kody.set(soubor, kod)
    let radek = 1
    let docteno = 0
    for (const m of kod.matchAll(ATRIBUT)) {
      for (; docteno < m.index; docteno++) if (kod[docteno] === '\n') radek++
      const hodnota = m[1] ?? m[3] ?? m[4]
      const pred = kod.lastIndexOf('<', m.index)
      prvky.push({
        soubor,
        radek,
        znacka: /^<([a-z][\w-]*)\b/.exec(kod.slice(pred))?.[1] ?? null,
        tridy: new Set(hodnota.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)),
        sablona: m[4] !== undefined && m[4].includes('${'),
      })
    }
  }
  return { prvky, kody }
}

/**
 * Prvky, které nesou třídu `trida`. `vyskytu` je počet výskytů třídy
 * v kódu (mimo komentáře): když je větší než počet nalezených prvků,
 * třída stojí i někde, kde ji tohle čtení nevidí (spojování řetězců,
 * proměnná…), a kontrola nad tím nesmí tvrdit, že prošla všechno.
 */
export function prvkySTridou(trida, { prvky, kody } = prvkyVKodu()) {
  const token = new RegExp(`(?<![\\w-])${trida.replace(/-/g, '\\-')}(?![\\w-])`, 'g')
  let vyskytu = 0
  for (const kod of kody.values()) vyskytu += (kod.match(token) ?? []).length
  return { prvky: prvky.filter((p) => p.tridy.has(trida)), vyskytu }
}

/** Šířky okna, na kterých se v CSS něco láme: každý zlom, ±1 px a telefon. */
export function sirkyZlomu(css) {
  const sirky = new Set([320, 390])
  for (const p of css.pravidla) {
    for (const c of p.podminky) {
      if (c.druh !== 'media') continue
      for (const m of c.text.matchAll(/([\d.]+)px/g)) for (const d of [-1, 0, 0.5, 1]) sirky.add(Number(m[1]) + d)
    }
  }
  return [...sirky].filter((w) => w >= 300).sort((a, b) => a - b)
}

/**
 * Stejná past kdekoli: pravidlo pro určitou šířku okna (`@media … width`),
 * které na prvek jistě sedí a při té šířce platí, ale vyhraje místo něj
 * pravidlo BEZ podmínky šířky s jinou hodnotou — typicky pozdější se
 * stejnou specifičností. Vrací `[{ prvek, vlastnost, prohrava, vyhrava,
 * sirky }]`.
 */
export function prebitaPodleSirky(css, prvky, vlastnost, sirky = sirkyZlomu(css)) {
  const nalezy = new Map()
  const podleSirky = (css.podleVlastnosti.get(vlastnost) ?? []).filter(zavisiNaSirce)
  for (const prvek of prvky) {
    const svoje = podleSirky.filter((r) => r.selektory.some((s) => shoda(s, prvek) === 'ano'))
    for (const w of sirky) {
      if (!svoje.length) break
      if (!svoje.some((r) => platiPodminky(r.podminky, { ...PROSTREDI, sirka: w }))) continue
      const v = vitez(css, prvek, vlastnost, { sirka: w })
      if (!v.vyherce || zavisiNaSirce(v.vyherce.pravidlo)) continue
      for (const r of svoje) {
        const vr = vitez(jenPravidla([r]), prvek, vlastnost, { sirka: w }).vyherce
        if (!vr || vr.hodnota === v.hodnota) continue
        const klic = `${prvek.soubor}:${prvek.radek}|${r.poradi}|${v.vyherce.pravidlo.poradi}`
        if (!nalezy.has(klic)) nalezy.set(klic, { prvek, vlastnost, prohrava: vr, vyhrava: v.vyherce, sirky: [] })
        nalezy.get(klic).sirky.push(w)
      }
    }
  }
  return [...nalezy.values()]
}
