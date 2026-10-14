#!/usr/bin/env node
/**
 * Fokus v bočním panelu a dialogu (components/ui/Drawer.tsx, Dialog.tsx,
 * společná logika v components/ui/fokus-okna.tsx).
 *
 * Do 14. 10. 2026 měl efekt, který při otevření bere fokus a při zavření
 * ho vrací, v závislostech `onZavrit`. Rodiče (formulář směny, rozpis)
 * tu funkci skládají v těle komponenty, takže je při každém vykreslení
 * nová — a každé překreslení (zaškrtnutí „Trhaná směna“ nebo „…i v jiné
 * dny“ mezerníkem, obnovení rozpisu) efekt zrušilo a spustilo znovu:
 * fokus skočil z prvku, se kterým člověk pracoval, na celý panel.
 * Kontrola téhle opravy pak našla další dvě věci (obě už starší):
 * přepnutí na jinou směnu v nemodálním panelu vrátilo fokus — a rozpis —
 * k první otevřené směně, a panel sebral fokus poli s `autoFocus`.
 *
 * Jak: komponenta se přeloží skutečná (scripts/vykreslit.mjs), jen
 * `react` a `react-dom` jsou podstrčené. Háčky si pamatují sloty, efekt
 * se spustí znovu jen při změně závislostí (Object.is), úklid změněných
 * běží před novými efekty a při odpojení všechny — jako v Reactu. Ref se
 * připojí na prvek, kterému ho komponenta opravdu dala (role="dialog"),
 * a `document.activeElement` se mění podle `focus()` a odpojení panelu.
 * Kontrola tak sahá na opravdové závislosti a opravdové zacházení
 * s fokusem, ne na text zdrojáku.
 *
 * Pusť `node scripts/ui-okna.test.mjs`.
 */

import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`)
}

/*
  Podstrčený React: jen to, co okna používají. Kdyby budoucí úprava
  sáhla po dalším háčku, test spadne nahlas při načtení (chybějící
  export) — ne tiše.
*/
const REACT = `data:text/javascript,${encodeURIComponent(`
export function useRef(pocatek) {
  const h = globalThis.__haky
  const i = h.i++
  if (!h.sloty[i]) h.sloty[i] = { current: pocatek }
  return h.sloty[i]
}
export function useId() { globalThis.__haky.i++; return ':r0:' }
export function useEffect(fn, zavislosti) {
  const h = globalThis.__haky
  const i = h.i++
  const minule = h.efekty.get(i)
  const zmena = !minule || !zavislosti || zavislosti.length !== minule.zavislosti.length ||
    zavislosti.some((z, k) => !Object.is(z, minule.zavislosti[k]))
  if (zmena) h.fronta.push({ i, fn, zavislosti })
}
`)}`
const REACT_DOM = `data:text/javascript,${encodeURIComponent('export function createPortal(prvek) { return prvek }')}`
// Sousední fokus-okna.tsx přeloží vykreslit.mjs sám, se stejnými náhradami.
const NAHRADY = [
  ['react', REACT],
  ['react-dom', REACT_DOM],
]

/** Prvek stránky: umí focus() a contains(), zná rodiče. */
function prostredi() {
  const zaznam = { fokusy: [] }
  let aktivni = null
  const posluchaci = []
  function uzel(jmeno, rodic = null) {
    const u = {
      jmeno,
      rodic,
      focus(volby) {
        zaznam.fokusy.push(volby?.preventScroll ? `${jmeno} (bez posunu)` : jmeno)
        aktivni = u
      },
      contains(x) {
        for (let y = x; y; y = y.rodic) if (y === u) return true
        return false
      },
    }
    return u
  }
  const body = uzel('body')
  aktivni = body
  globalThis.document = {
    body,
    get activeElement() { return aktivni },
    addEventListener: (typ, fn) => posluchaci.push({ typ, fn }),
    removeEventListener: (typ, fn) => {
      const i = posluchaci.findIndex((p) => p.typ === typ && p.fn === fn)
      if (i >= 0) posluchaci.splice(i, 1)
    },
  }

  /** Jedna instance okna (jako jedno připojení komponenty v Reactu). */
  function instance(Okno) {
    const h = { sloty: [], efekty: new Map(), i: 0, fronta: [] }
    let panel = null
    let refy = []

    function pripojitRefy(strom) {
      const nove = []
      const projdi = (x) => {
        if (!x || typeof x !== 'object') return
        if (Array.isArray(x)) return x.forEach(projdi)
        const p = x.props ?? {}
        if (p.ref && typeof p.ref === 'object') {
          if (p.role === 'dialog') {
            if (!panel) panel = uzel('panel', body)
            p.ref.current = panel
          } else p.ref.current = uzel('prvek', panel ?? body)
          nove.push(p.ref)
        }
        projdi(p.children)
      }
      projdi(strom)
      return nove
    }

    function odebratPanel() {
      // Prvek s fokusem zmizí z DOM → prohlížeč dá fokus na <body>.
      if (panel && panel.contains(aktivni)) aktivni = body
      for (const r of refy) r.current = null
      refy = []
      panel = null
    }

    function spustitEfekty() {
      for (const { i } of h.fronta) h.efekty.get(i)?.uklid?.()
      for (const { i, fn, zavislosti } of h.fronta) {
        const uklid = fn()
        h.efekty.set(i, { zavislosti, uklid: typeof uklid === 'function' ? uklid : undefined })
      }
    }

    return {
      /** `predEfekty` = co se stane mezi vykreslením a efekty (autoFocus). */
      vykreslit(props, predEfekty) {
        globalThis.__haky = h
        h.i = 0
        h.fronta = []
        const strom = Okno({ nadpis: 'Okno', ...props })
        if (strom === null) odebratPanel()
        else refy = pripojitRefy(strom)
        predEfekty?.(panel)
        spustitEfekty()
      },
      odpojit() {
        globalThis.__haky = h
        odebratPanel() // React odpojí refy a DOM dřív, než pustí úklid efektů.
        for (const e of h.efekty.values()) e.uklid?.()
        h.efekty.clear()
      },
      get panel() { return panel },
    }
  }

  const stisk = (key) => { for (const p of [...posluchaci]) if (p.typ === 'keydown') p.fn({ key }) }
  return { zaznam, uzel, body, instance, stisk, aktivni: () => aktivni, posluchacu: () => posluchaci.length, setAktivni: (u) => { aktivni = u } }
}

for (const [jmeno, soubor] of [
  ['Drawer', 'components/ui/Drawer.tsx'],
  ['Dialog', 'components/ui/Dialog.tsx'],
]) {
  const Okno = await nactiKomponentu(soubor, NAHRADY)

  console.log(`\n== ${jmeno}: otevřít, pracovat uvnitř, překreslovat, zavřít ==`)
  {
    const s = prostredi()
    const tlacitko = s.uzel('tlačítko', s.body)
    tlacitko.focus()
    s.zaznam.fokusy = []
    const okno = s.instance(Okno)
    const volano = []

    okno.vykreslit({ otevreno: true, onZavrit: () => volano.push('první'), children: 'a' })
    ma(`${jmeno}: otevření dá fokus panelu (ref je na prvku role="dialog")`, s.aktivni()?.jmeno, 'panel')

    // Člověk v panelu zaškrtne políčko mezerníkem — rodič se překreslí
    // s NOVOU onZavrit (přesně jako formulář směny) a jiným obsahem.
    const policko = s.uzel('políčko', okno.panel)
    policko.focus()
    okno.vykreslit({ otevreno: true, onZavrit: () => volano.push('druhá'), children: 'b' })
    okno.vykreslit({ otevreno: true, onZavrit: () => volano.push('třetí'), children: 'c' })
    ma(`${jmeno}: překreslení s novou onZavrit nechá fokus na políčku`, s.aktivni()?.jmeno, 'políčko')
    ma(`${jmeno}: … a nikam jinam ho mezitím nepřehodí`, s.zaznam.fokusy, ['panel', 'políčko'])
    ma(`${jmeno}: posluchač klávesnice je jeden`, s.posluchacu(), 1)

    s.stisk('Enter')
    ma(`${jmeno}: jiná klávesa než Esc okno nezavírá`, volano, [])
    s.stisk('Escape')
    ma(`${jmeno}: Esc zavolá NEJNOVĚJŠÍ onZavrit (ne tu z prvního vykreslení)`, volano, ['třetí'])

    okno.vykreslit({ otevreno: false, onZavrit: () => volano.push('čtvrtá') })
    ma(`${jmeno}: zavření vrátí fokus na tlačítko, které okno otevřelo, bez posunu stránky`,
      [s.aktivni()?.jmeno, s.zaznam.fokusy.at(-1)], ['tlačítko', 'tlačítko (bez posunu)'])
    ma(`${jmeno}: po zavření žádný posluchač nezůstal`, s.posluchacu(), 0)

    // Znovu otevřít a zavřít odpojením — tak se Drawer v appce zavírá nejčastěji.
    okno.vykreslit({ otevreno: true, onZavrit: () => volano.push('pátá') })
    ma(`${jmeno}: opětovné otevření zase dá fokus panelu`, s.aktivni()?.jmeno, 'panel')
    okno.odpojit()
    ma(`${jmeno}: odpojení vrátí fokus na tlačítko`, s.aktivni()?.jmeno, 'tlačítko')
    ma(`${jmeno}: po odpojení žádný posluchač nezůstal`, s.posluchacu(), 0)
  }

  console.log(`\n== ${jmeno}: přepnutí na jinou směnu vedle panelu ==`)
  {
    // Rozpis: klik na kartu A otevře panel, klik na kartu B (fokus na B)
    // panel odpojí a připojí znovu s jiným klíčem.
    const s = prostredi()
    const kartaA = s.uzel('karta A', s.body)
    const kartaB = s.uzel('karta B', s.body)
    kartaA.focus()
    const a = s.instance(Okno)
    a.vykreslit({ otevreno: true, onZavrit: () => {} })
    kartaB.focus()
    s.zaznam.fokusy = []
    a.odpojit()
    ma(`${jmeno}: odpojení starého panelu NEvrátí fokus na kartu A (rozpis se neodroluje)`, s.zaznam.fokusy, [])
    const b = s.instance(Okno)
    b.vykreslit({ otevreno: true, onZavrit: () => {} })
    b.vykreslit({ otevreno: false, onZavrit: () => {} })
    ma(`${jmeno}: zavření nového panelu vrátí fokus na kartu B`, s.aktivni()?.jmeno, 'karta B')
  }

  console.log(`\n== ${jmeno}: pole s autoFocus uvnitř ==`)
  {
    const s = prostredi()
    const tlacitko = s.uzel('tlačítko', s.body)
    tlacitko.focus()
    const okno = s.instance(Okno)
    let pole = null
    // React dá fokus poli s autoFocus při zápisu do DOM, dřív než efekty.
    okno.vykreslit({ otevreno: true, onZavrit: () => {} }, (panel) => {
      pole = s.uzel('pole s autoFocus', panel)
      pole.focus()
    })
    ma(`${jmeno}: panel poli s autoFocus fokus nesebere`, s.aktivni()?.jmeno, 'pole s autoFocus')
    okno.vykreslit({ otevreno: false, onZavrit: () => {} })
    ma(`${jmeno}: zavření pak fokus nevrací na zmizelé pole`, s.aktivni()?.jmeno, 'body')
  }
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
