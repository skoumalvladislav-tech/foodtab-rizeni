/**
 * Klikání do skutečné komponenty bez prohlížeče.
 *
 * ---------------------------------------------------------------------
 * K ČEMU TO JE
 *
 * `vykreslit.mjs` umí komponentu vykreslit do HTML — jednou, ve stavu,
 * ve kterém začíná. Menu „Více" ale začíná zavřené, a 25. 9. 2026
 * nezávislá kontrola ukázala, co z toho plyne: v MobileVice šlo rozbít
 * otevírání (`setOtevrenoNa(null)`), dotaz na odhlášení i zavírání po
 * změně adresy, a všechny kontroly zůstaly zelené. Náhradní Drawer
 * kreslil obsah i zavřený a nikdo nikdy neťukl.
 *
 * Tady se ťuká: vykreslí se strom, najde se tlačítko, zavolá se jeho
 * SKUTEČNÁ obsluha `onClick` a strom se vykreslí znovu s novým stavem.
 *
 * ---------------------------------------------------------------------
 * JAK
 *
 * Opravdový React v Node na obrazovku kreslit neumí (react-dom chce
 * DOM a jsdom v projektu není). Tenhle soubor proto stojí v roli Reactu:
 * komponentám se místo `react` a `react-dom` podstrčí (`NAHRADY` níž,
 * předávají se do `nahrady` ve vykreslit.mjs) a dodá jim háčky a malý
 * kreslič, který rozbalí komponenty na strom HTML prvků.
 *
 * Je to NÁHRADA, ne React. Umí jen to, co rám aplikace potřebuje:
 *   - stav drží podle místa ve stromu, jako React; komponenta, která ze
 *     stromu zmizí, stav zapomene a její efekty se uklidí,
 *   - efekty běží hned po každém vykreslení, děti před rodiči, se
 *     závislostmi jako v Reactu; změna stavu vykreslí strom znovu,
 *   - HTML prvek na stejném místě zůstává týž uzel (jako v DOM), `ref`
 *     na něj dostane uzel s `focus()` a `contains()`,
 *   - klik jde jako v Chromu: pointerdown a mousedown nejdřív obsluhám
 *     Reactu (`onPointerDown`, `onMouseDown`) a teprve pak posluchačům
 *     na `document` — kořen Reactu je v Next App Routeru sám `document`
 *     a React se na něm přihlásí při hydrataci, dřív než jakýkoli efekt;
 *     pak se přesune fokus (na nejbližší zaměřitelný prvek, jinak pryč
 *     — `onBlur` dostane `relatedTarget`) a změny stavu se vykreslí
 *     DŘÍV, než přijde click, jako když člověk tlačítko ještě drží; co
 *     mezitím ze stromu zmizelo, click nedostane; `onClick` probublá
 *     nahoru a odesílací tlačítko pak zavolá `action` formuláře,
 *   - `zamerit()` přesune fokus jako Tab (i s `onBlur`); fokus se chová
 *     jako v Chromu — Safari tlačítko ani odkaz kliknutím nezaměří
 *     (`relatedTarget` je tam prázdný) a to tu vidět není,
 *   - `createPortal` kreslí na místě, `document` umí posluchače
 *     událostí a `activeElement`,
 *   - `useSyncExternalStore` vrací serverovou hodnotu.
 * Co neumí (kontext, Suspense, memo, …), na tom SPADNE s hláškou —
 * tiše by to nahradilo něčím jiným, a to je přesně ta chyba, kvůli
 * které vykreslit.mjs vznikl.
 *
 * Skutečné chování v prohlížeči (vzhled, rozměry, portál do body,
 * animace) tohle neověří; na to jsou snímky obrazovky.
 */

export { Children, Fragment, cloneElement, createElement, isValidElement } from 'react'

const PRVEK = new Set([Symbol.for('react.transitional.element'), Symbol.for('react.element')])
const FRAGMENT = Symbol.for('react.fragment')

/** Co podstrčit komponentám přes `nahrady` ve vykreslit.mjs. */
export const NAHRADY = [
  ['react', import.meta.url],
  ['react-dom', import.meta.url],
]

/** Portál se kreslí na místě — ověřuje se obsah, ne kam ho prohlížeč pověsí. */
export function createPortal(deti) {
  return deti
}

/* =====================================================================
 * HÁČKY
 * ===================================================================== */

let scena = null // běžící `spustit`
let instance = null // komponenta, která se právě vykresluje

function slot() {
  if (!instance) throw new Error('Háček zavolaný mimo vykreslování komponenty')
  return instance.index++
}

const stejne = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

export function useReducer(reducer, pocatek, init) {
  const i = slot()
  const h = instance.hacky
  if (!(i in h)) {
    const s = { hodnota: init ? init(pocatek) : pocatek }
    const tady = scena
    s.poslat = (akce) => {
      if (scena !== tady) throw new Error('Změna stavu po skončení scény')
      s.hodnota = s.reducer(s.hodnota, akce)
      tady.spinave = true
    }
    h[i] = s
  }
  h[i].reducer = reducer
  return [h[i].hodnota, h[i].poslat]
}

export function useState(pocatek) {
  return useReducer(
    (stav, akce) => (typeof akce === 'function' ? akce(stav) : akce),
    pocatek,
    (p) => (typeof p === 'function' ? p() : p),
  )
}

export function useRef(pocatek) {
  const i = slot()
  const h = instance.hacky
  if (!(i in h)) h[i] = { current: pocatek }
  return h[i]
}

export function useMemo(vypocet, zavislosti) {
  const i = slot()
  const h = instance.hacky
  if (i in h && stejne(h[i].zavislosti, zavislosti)) return h[i].hodnota
  h[i] = { zavislosti, hodnota: vypocet() }
  return h[i].hodnota
}

export function useCallback(fce, zavislosti) {
  const i = slot()
  const h = instance.hacky
  if (!(i in h) || !stejne(h[i].zavislosti, zavislosti)) h[i] = { zavislosti, hodnota: fce }
  return h[i].hodnota
}

export function useEffect(efekt, zavislosti) {
  const i = slot()
  const h = instance.hacky
  const s = h[i] ?? (h[i] = { uklid: null, zavislosti: null, poprve: true })
  if (!s.poprve && zavislosti && stejne(s.zavislosti, zavislosti)) return
  s.poprve = false
  s.zavislosti = zavislosti
  instance.efekty.push(() => {
    s.uklid?.()
    const u = efekt()
    s.uklid = typeof u === 'function' ? u : null
  })
}

export const useLayoutEffect = useEffect

export function useId() {
  const i = slot()
  const h = instance.hacky
  if (!(i in h)) h[i] = `:r${scena.dalsiId++}:`
  return h[i]
}

/** Jako při prvním vykreslení na serveru — odběr se nezakládá. */
export function useSyncExternalStore(_odebirat, hodnota, hodnotaServer) {
  slot()
  return (hodnotaServer ?? hodnota)()
}

/* =====================================================================
 * UZLY A DOCUMENT
 * ===================================================================== */

class Uzel {
  constructor(typ) {
    this.typ = typ
    this.props = {}
    this.deti = []
    this.rodic = null
  }
  /** Přesun fokusu; kdo ho ztratil, dostane `onBlur` s tím, kam odešel. */
  focus() {
    const predtim = scena.fokus
    if (predtim === this) return
    scena.fokus = this
    if (predtim) scena.odchodFokusu(predtim, this)
  }
  blur() {
    if (scena.fokus !== this) return
    scena.fokus = null
    scena.odchodFokusu(this, null)
  }
  contains(jiny) {
    for (let u = jiny; u; u = u.rodic) if (u === this) return true
    return false
  }
  getAttribute(jmeno) {
    const v = this.props[jmeno === 'class' ? 'className' : jmeno]
    return v == null ? null : String(v)
  }
}

/** Dá se na prvek kliknutím zaměřit? (Chrome: tlačítko, odkaz, pole, tabIndex.) */
function zameritelny(u) {
  if (u.props.disabled) return false
  if (['button', 'input', 'select', 'textarea', 'summary'].includes(u.typ)) return true
  if (u.typ === 'a' && u.props.href != null) return true
  return u.props.tabIndex != null
}

function novyDokument(tady) {
  const posluchaci = new Map()
  const body = new Uzel('body')
  return {
    body,
    documentElement: new Uzel('html'),
    get activeElement() {
      return tady.fokus ?? body
    },
    addEventListener(typ, fce) {
      if (!posluchaci.has(typ)) posluchaci.set(typ, new Set())
      posluchaci.get(typ).add(fce)
    },
    removeEventListener(typ, fce) {
      posluchaci.get(typ)?.delete(fce)
    },
    /** Kolik posluchačů čeká — ať jde ověřit, že se po sobě uklidily. */
    pocetPosluchacu() {
      let n = 0
      for (const s of posluchaci.values()) n += s.size
      return n
    },
    poslat(typ, udalost) {
      for (const fce of [...(posluchaci.get(typ) ?? [])]) fce(udalost)
    },
  }
}

/* =====================================================================
 * KRESLENÍ
 * ===================================================================== */

function rozvin(prvek, misto, rodic) {
  if (prvek == null || typeof prvek === 'boolean') return []
  if (typeof prvek === 'string' || typeof prvek === 'number') {
    return [{ text: String(prvek), rodic }]
  }
  if (Array.isArray(prvek)) {
    return prvek.flatMap((p, i) => rozvin(p, `${misto}[${p?.key ?? i}]`, rodic))
  }
  if (!PRVEK.has(prvek.$$typeof)) {
    throw new Error(`Tohle náhradní vykreslení nezná prvek: ${String(prvek)}`)
  }

  const { type: typ, props, key } = prvek
  const klic = key != null ? `#${key}` : ''

  if (typ === FRAGMENT) return rozvin(props.children, `${misto}/<>${klic}`, rodic)

  if (typeof typ === 'function') {
    const id = `${misto}/${typ.displayName || typ.name || 'bez-jmena'}${klic}`
    let inst = scena.instance.get(id)
    if (!inst) {
      inst = { hacky: [] }
      scena.instance.set(id, inst)
    }
    scena.navstivene.add(id)
    const predchozi = instance
    instance = inst
    inst.index = 0
    inst.efekty = []
    let vysledek
    try {
      vysledek = typ(props)
    } finally {
      instance = predchozi
    }
    const uzly = rozvin(vysledek, id, rodic)
    // Po dětech — efekty dětí běží dřív než rodičovy, jako v Reactu.
    scena.fronta.push(...inst.efekty)
    return uzly
  }

  if (typeof typ === 'string') {
    const cesta = `${misto}/${typ}${klic}`
    let uzel = scena.uzly.get(cesta)
    if (!uzel || uzel.typ !== typ) uzel = new Uzel(typ)
    scena.noveUzly.set(cesta, uzel)
    uzel.props = props
    uzel.rodic = rodic
    uzel.deti = rozvin(props.children, cesta, uzel)
    if (props.ref) scena.refy.push([props.ref, uzel])
    return [uzel]
  }

  throw new Error(
    `Tohle náhradní vykreslení neumí prvek typu ${String(typ?.$$typeof ?? typ)} — doplň ho do scripts/klikat.mjs, nepodstrkávej.`,
  )
}

function nastavRef(ref, hodnota) {
  if (typeof ref === 'function') ref(hodnota)
  else if (ref && typeof ref === 'object') ref.current = hodnota
}

/* =====================================================================
 * HTML
 * ===================================================================== */

const PRAZDNE = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function atributy(props) {
  let s = ''
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || k === 'ref' || v == null || typeof v === 'function') continue
    const jmeno = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k === 'tabIndex' ? 'tabindex' : k
    const vlastni = /^(aria|data)-/.test(k)
    if (k === 'style' && typeof v === 'object') {
      const css = Object.entries(v)
        .map(([a, b]) => `${a.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${b}`)
        .join(';')
      s += ` style="${esc(css)}"`
    } else if (v === false && !vlastni) {
      continue
    } else if (v === true && !vlastni) {
      s += ` ${jmeno}=""`
    } else {
      s += ` ${jmeno}="${esc(String(v))}"`
    }
  }
  return s
}

function naHtml(uzly) {
  return uzly
    .map((u) =>
      u.text != null
        ? esc(u.text)
        : `<${u.typ}${atributy(u.props)}>` + (PRAZDNE.has(u.typ) ? '' : `${naHtml(u.deti)}</${u.typ}>`),
    )
    .join('')
}

function naText(uzly) {
  return uzly.map((u) => (u.text != null ? u.text : naText(u.deti))).join('')
}

function* vsechnyUzly(uzly) {
  for (const u of uzly) {
    if (u.text != null) continue
    yield u
    yield* vsechnyUzly(u.deti)
  }
}

/* =====================================================================
 * SCÉNA
 * ===================================================================== */

/**
 * Vykreslí `vytvor()` a vrátí ovládání: najít, kliknout, zmáčknout
 * klávesu, překreslit (třeba po změně adresy) a na konci `ukoncit()`.
 *
 * `vytvor` se volá při každém překreslení, takže si může sáhnout po
 * aktuální adrese nebo jiném vnějším stavu.
 */
export function spustit(vytvor) {
  if (scena) throw new Error('Scéna už běží — nejdřív ukoncit()')

  const tady = {
    instance: new Map(),
    uzly: new Map(),
    refy: [],
    strom: [],
    fokus: null,
    spinave: false,
    dalsiId: 0,
  }
  scena = tady
  const puvodniDokument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const dokument = novyDokument(tady)
  globalThis.document = dokument

  function kreslit() {
    tady.navstivene = new Set()
    tady.noveUzly = new Map()
    tady.fronta = []
    const stareRefy = tady.refy
    tady.refy = []

    tady.strom = rozvin(vytvor(), 'koren', null)

    // Uzel, který ze stromu zmizel, fokus neudrží — jako v prohlížeči.
    const zive = new Set(tady.noveUzly.values())
    if (tady.fokus && !zive.has(tady.fokus)) tady.fokus = null
    tady.uzly = tady.noveUzly

    for (const [ref] of stareRefy) nastavRef(ref, null)
    for (const [ref, uzel] of tady.refy) nastavRef(ref, uzel)

    for (const [id, inst] of tady.instance) {
      if (tady.navstivene.has(id)) continue
      for (const h of inst.hacky) h?.uklid?.()
      tady.instance.delete(id)
    }
    for (const efekt of tady.fronta) efekt()
  }

  function prekreslit() {
    for (let kolo = 0; kolo < 25; kolo++) {
      tady.spinave = false
      kreslit()
      if (!tady.spinave) return
    }
    throw new Error('Stav se mění pořád dokola — komponenta se nepřestala překreslovat')
  }

  function bublat(od, obsluha, udalost) {
    for (let u = od; u; u = u.rodic) {
      if (udalost.zastaveno) return
      const f = u.props?.[obsluha]
      if (typeof f === 'function') {
        udalost.currentTarget = u
        f(udalost)
      }
    }
  }

  function novaUdalost(typ, cil, dalsi = {}) {
    return {
      type: typ,
      target: cil,
      currentTarget: null,
      defaultPrevented: false,
      zastaveno: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {
        this.zastaveno = true
      },
      ...dalsi,
    }
  }

  // React `onBlur` je `focusout`: bublá a nese `relatedTarget`.
  tady.odchodFokusu = (odkud, kam) =>
    bublat(odkud, 'onBlur', novaUdalost('focusout', odkud, { relatedTarget: kam }))

  /** Je uzel v posledním vykreslení? */
  const zivy = (uzel) => [...tady.uzly.values()].includes(uzel)

  const ovladani = {
    /** HTML celého stromu, nebo jen uzlu (i s ním). */
    html(uzel) {
      return naHtml(uzel ? [uzel] : tady.strom)
    },
    text(uzel) {
      return naText(uzel ? [uzel] : tady.strom)
    },
    /** Přímé potomky uzlu, jen prvky (bez textu). */
    deti(uzel) {
      return uzel.deti.filter((d) => d.text == null)
    },
    najdi(podminka, v) {
      for (const u of vsechnyUzly(v ? [v] : tady.strom)) if (podminka(u)) return u
      return null
    },
    vsechny(podminka, v) {
      return [...vsechnyUzly(v ? [v] : tady.strom)].filter(podminka)
    },
    /** Uzel podle třídy (jedné z nich). */
    podleTridy(trida, v) {
      return ovladani.najdi((u) => String(u.props.className ?? '').split(/\s+/).includes(trida), v)
    },
    /** Tlačítko podle viditelného textu nebo aria-label — přesně, ne začátkem. */
    tlacitko(nazev, v) {
      return ovladani.najdi(
        (u) => u.typ === 'button' && (u.props['aria-label'] === nazev || naText([u]).trim() === nazev),
        v,
      )
    },
    get fokus() {
      return tady.fokus
    },
    get dokument() {
      return dokument
    },
    prekreslit,

    /** Klik jako v Chromu. Uzel musí být z posledního vykreslení. */
    klik(uzel) {
      if (!uzel) throw new Error('klik(): uzel nenalezen')
      if (!zivy(uzel)) throw new Error('klik(): uzel není v posledním vykreslení — najdi ho znovu')

      // Obsluhy Reactu dřív než posluchači z efektů (viz hlavička).
      let zadnyFokus = false
      for (const typ of ['pointerdown', 'mousedown']) {
        const e = novaUdalost(typ, uzel)
        bublat(uzel, typ === 'pointerdown' ? 'onPointerDown' : 'onMouseDown', e)
        dokument.poslat(typ, e)
        if (typ === 'mousedown') zadnyFokus = e.defaultPrevented
      }

      // Fokus se přesouvá při mousedown: na nejbližší zaměřitelný prvek,
      // a když žádný není, odejde pryč (na body) — `relatedTarget` je pak
      // prázdný. `preventDefault()` na mousedown ho nechá na místě.
      if (!zadnyFokus) {
        let cil = null
        for (let u = uzel; u && !cil; u = u.rodic) if (zameritelny(u)) cil = u
        if (cil) cil.focus()
        else tady.fokus?.blur()
      }

      // Člověk tlačítko ještě drží a React už změny vykreslil. Co mezitím
      // ze stromu zmizelo, click nedostane — v prohlížeči pustí myš nad
      // něčím jiným.
      prekreslit()
      if (!zivy(uzel)) return

      const klik = novaUdalost('click', uzel)
      bublat(uzel, 'onClick', klik)
      dokument.poslat('click', klik)

      // Odesílací tlačítko odešle formulář — a React zavolá jeho `action`.
      const odesila = uzel.typ === 'button' && (uzel.props.type ?? 'submit') === 'submit'
      if (odesila && !klik.defaultPrevented) {
        let form = uzel.rodic
        while (form && form.typ !== 'form') form = form.rodic
        if (form) {
          const odeslani = novaUdalost('submit', form)
          bublat(form, 'onSubmit', odeslani)
          if (!odeslani.defaultPrevented && typeof form.props.action === 'function') {
            form.props.action(new FormData())
          }
        }
      }
      prekreslit()
    },

    /** Fokus na prvek, jako by na něj člověk přešel Tabem. */
    zamerit(uzel) {
      if (!uzel || !zivy(uzel)) throw new Error('zamerit(): uzel není v posledním vykreslení')
      uzel.focus()
      prekreslit()
    },

    /** Klávesa na zaměřeném prvku; probublá i na `document`. */
    klavesa(klic) {
      const cil = tady.fokus ?? dokument.body
      const e = novaUdalost('keydown', cil, { key: klic })
      bublat(tady.fokus, 'onKeyDown', e)
      dokument.poslat('keydown', e)
      prekreslit()
    },

    /** Odmontuje všechno (uklidí efekty) a vrátí `document`, jak byl. */
    ukoncit() {
      for (const inst of tady.instance.values()) for (const h of inst.hacky) h?.uklid?.()
      tady.instance.clear()
      if (puvodniDokument) Object.defineProperty(globalThis, 'document', puvodniDokument)
      else delete globalThis.document
      scena = null
    },
  }

  try {
    prekreslit()
  } catch (e) {
    ovladani.ukoncit()
    throw e
  }
  return ovladani
}
