/**
 * Jiné platby — peníze a množství bez desetinných čísel.
 *
 * Proč tolik práce kolem „obyčejného" čísla: částka z dokladu je TEXT
 * („1 234,50 Kč", „45,-", „1.234"), a kdo ho prožene přes
 * `parseFloat`, dostane buď plovoucí chybu (0,1 + 0,2), nebo tiše
 * špatný výklad oddělovačů („1.234" jako 1,234 Kč místo 1 234 Kč).
 * Peníze jsou proto vždycky celé haléře (`integer`, jako v databázi)
 * a množství text s tečkou (numeric(12,3) v databázi). Kde výklad není
 * jednoznačný, funkce to řekne (`nejasne` + důvod) — nehádá.
 *
 * Čisté funkce, žádné importy za běhu — testuje
 * `scripts/jine-platby.test.mjs` přímo Nodem.
 */

/** Strop částky: `integer` v databázi (2 147 483 647 haléřů = 21 474 836,47). */
export const MAX_HALERU = 2_147_483_647

/** Strop množství: numeric(12,3) → nejvýš 999 999 999 (a tři desetinná místa). */
export const MAX_MNOZSTVI_TISICIN = 999_999_999_000

export type VysledekCastky = { stav: 'ok'; haleru: number } | { stav: 'prazdne' } | { stav: 'nejasne'; duvod: string }

export type VysledekMnozstvi = { stav: 'ok'; mnozstvi: string } | { stav: 'prazdne' } | { stav: 'nejasne'; duvod: string }

/* ------------------------------------------------------------------ */
/* Společné rozebrání čísla z textu                                     */
/* ------------------------------------------------------------------ */

/** Mezery, které se v číslech na dokladech objevují (nezlomitelná, úzká, tenká). */
const MEZERY = /[\u00a0\u202f\u2009\u2007]/g
/** Znaky, které na dokladu znamenají mínus (spojovník, matematické mínus, pomlčky). */
const MINUSY = /^[-\u2212\u2013\u2014]/
/** „45,-" / „45,–" / „45.—" = celé koruny. */
const CELE_KORUNY = /[.,][-\u2212\u2013\u2014]$/

type Rozebrane = { stav: 'ok'; zaporne: boolean; cele: string; desetinne: string } | { stav: 'nejasne'; duvod: string }

/**
 * Rozebere číselný text (bez měny a jednotek) na znaménko, celou část
 * a desetinnou část — obě jako řetězce číslic, bez převodu na číslo.
 *
 * `troj` říká, co dělat s jediným oddělovačem, za kterým jsou PŘESNĚ
 * tři číslice („1.234", „1,234"):
 *   'nejasne'  — u peněz: může to být tisíc dvě stě třicet čtyři
 *                i jedna koruna dvacet tři a kousek → neumíme rozhodnout;
 *   'desetinne' — u množství: „1.250" kg je 1,25 kg (tisíce kusů
 *                na účtence z restaurace nebývají).
 */
function rozebratCislo(vstup: string, troj: 'nejasne' | 'desetinne'): Rozebrane {
  let s = vstup.replace(MEZERY, ' ').trim()
  let zaporne = false
  if (MINUSY.test(s)) {
    zaporne = true
    s = s.slice(1).trim()
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim()
  }
  if (CELE_KORUNY.test(s)) s = s.slice(0, -2)
  if (s === '') return { stav: 'nejasne', duvod: 'Chybí číslo' }
  if (/[^0-9 .,]/.test(s)) return { stav: 'nejasne', duvod: `Nečíselný znak v „${zkratit(vstup)}"` }
  if (!/[0-9]/.test(s)) return { stav: 'nejasne', duvod: 'Chybí číslo' }

  const tecek = (s.match(/\./g) ?? []).length
  const carek = (s.match(/,/g) ?? []).length

  let cela: string
  let des = ''

  if (tecek > 0 && carek > 0) {
    // Oba oddělovače: poslední z nich je desetinný, druhý tisícový.
    const posledniTecka = s.lastIndexOf('.')
    const posledniCarka = s.lastIndexOf(',')
    const desOdd = posledniTecka > posledniCarka ? '.' : ','
    const tisOdd = desOdd === '.' ? ',' : '.'
    const kolikDes = desOdd === '.' ? tecek : carek
    if (kolikDes > 1) return { stav: 'nejasne', duvod: `Desetinný oddělovač „${desOdd}" je v čísle víckrát` }
    const i = s.lastIndexOf(desOdd)
    cela = s.slice(0, i)
    des = s.slice(i + 1)
    const skupiny = cela.split(tisOdd)
    if (!platneTisice(skupiny.map((x) => x.trim()))) return { stav: 'nejasne', duvod: `Tisíce v „${zkratit(vstup)}" nejsou po třech číslicích` }
    cela = skupiny.join('')
  } else if (tecek + carek > 1) {
    // Jeden druh oddělovače víckrát → tisícový („1.234.567").
    const odd = tecek > 0 ? '.' : ','
    const skupiny = s.split(odd)
    if (!platneTisice(skupiny.map((x) => x.trim()))) return { stav: 'nejasne', duvod: `Tisíce v „${zkratit(vstup)}" nejsou po třech číslicích` }
    cela = skupiny.join('')
  } else if (tecek + carek === 1) {
    const odd = tecek > 0 ? '.' : ','
    const i = s.indexOf(odd)
    cela = s.slice(0, i)
    des = s.slice(i + 1)
    if (des.trim() === '') return { stav: 'nejasne', duvod: `Za oddělovačem v „${zkratit(vstup)}" nic není` }
    if (/^\d{3}$/.test(des) && /^\d{1,3}$/.test(cela.trim()) && cela.trim() !== '0' && troj === 'nejasne') {
      return {
        stav: 'nejasne',
        duvod: `„${zkratit(vstup)}" může být ${cela.trim()} ${des} (tisíce) i ${cela.trim()},${des} — ověřte`,
      }
    }
  } else {
    cela = s
  }

  // Mezery jako tisícový oddělovač v celé části („1 234").
  cela = cela.trim()
  if (cela.includes(' ')) {
    if (!platneTisice(cela.split(/ +/))) return { stav: 'nejasne', duvod: `Mezery v „${zkratit(vstup)}" nejsou po třech číslicích` }
    cela = cela.replace(/ +/g, '')
  }
  if (des.includes(' ')) return { stav: 'nejasne', duvod: `Mezera v desetinné části „${zkratit(vstup)}"` }
  if (cela === '') cela = '0'
  if (!/^\d+$/.test(cela) || !/^\d*$/.test(des)) return { stav: 'nejasne', duvod: `„${zkratit(vstup)}" není číslo` }
  return { stav: 'ok', zaporne, cele: cela, desetinne: des }
}

/** První skupina 1–3 číslice, každá další přesně 3. */
function platneTisice(skupiny: string[]): boolean {
  if (skupiny.length < 2) return /^\d+$/.test(skupiny[0] ?? '')
  return /^\d{1,3}$/.test(skupiny[0]) && skupiny.slice(1).every((g) => /^\d{3}$/.test(g))
}

/**
 * Text z dokladu do důvodu ke kontrole: ořezaný a nejvýš 40 znaků
 * (`duvod_kontroly` má v databázi strop 1000 znaků a cizí text do
 * hlášky nepatří celý).
 */
export function zkratit(text: string, max = 40): string {
  const t = text.replace(MEZERY, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Odstraní úvodní nuly („007" → „7", „0" zůstane). */
const bezUvodnichNul = (s: string) => s.replace(/^0+(?=\d)/, '')

/* ------------------------------------------------------------------ */
/* Částky                                                               */
/* ------------------------------------------------------------------ */

/** Měny, které umíme z textu částky odstranit (zbytek musí být číslo). */
const MENA_V_TEXTU = /^(kč|kc|czk|eur|€|euro)\.?\s*|\s*(kč|kc|czk|eur|€|euro)\.?$/i

/**
 * Text (nebo číslo) z dokladu → haléře. Záporné částky propustí
 * (sleva, vratka) — o tom, jestli jsou v daném místě v pořádku,
 * rozhoduje volající.
 *
 * Číslo na vstupu se bere jako koruny („12.5" = 12,50 Kč) a smí mít
 * nejvýš dvě desetinná místa — posuzuje se jeho nejkratší přesný zápis
 * (`String(x)`), takže 1.1 projde jako 110 haléřů, 1.005 ne.
 */
export function prevestCastku(vstup: string | number | null | undefined): VysledekCastky {
  if (vstup === null || vstup === undefined) return { stav: 'prazdne' }

  if (typeof vstup === 'number') {
    if (!Number.isFinite(vstup)) return { stav: 'nejasne', duvod: 'Částka není konečné číslo' }
    const text = String(vstup)
    if (/e/i.test(text)) return { stav: 'nejasne', duvod: 'Částka je mimo rozsah' }
    const des = text.split('.')[1] ?? ''
    if (des.length > 2) return { stav: 'nejasne', duvod: `Částka ${text} má víc než dvě desetinná místa` }
    const haleru = Math.round(vstup * 100)
    // Kontrola, že zaokrouhlení jen spravilo plovoucí chybu (1.1 * 100 = 110.00000000000001),
    // a ne že spolklo skutečnou hodnotu.
    if (Math.abs(vstup * 100 - haleru) > 1e-6 || !Number.isSafeInteger(haleru)) {
      return { stav: 'nejasne', duvod: `Částku ${text} nejde přesně převést na haléře` }
    }
    if (Math.abs(haleru) > MAX_HALERU) return { stav: 'nejasne', duvod: 'Částka je větší, než databáze unese' }
    return { stav: 'ok', haleru: haleru === 0 ? 0 : haleru }
  }

  if (typeof vstup !== 'string') return { stav: 'nejasne', duvod: 'Částka není text ani číslo' }
  let s = vstup.replace(MEZERY, ' ').trim()
  if (s === '') return { stav: 'prazdne' }

  // Měna před nebo za číslem (i „-12,00 Kč" a „Kč -12,00").
  let predtim = ''
  while (s !== predtim) {
    predtim = s
    s = s.replace(MENA_V_TEXTU, '').trim()
  }
  if (s === '') return { stav: 'nejasne', duvod: `V „${zkratit(vstup)}" není číslo` }

  const r = rozebratCislo(s, 'nejasne')
  if (r.stav === 'nejasne') return r
  if (r.desetinne.length > 2) {
    return { stav: 'nejasne', duvod: `„${zkratit(vstup)}" má víc než dvě desetinná místa` }
  }
  const cele = bezUvodnichNul(r.cele)
  if (cele.length > 8) return { stav: 'nejasne', duvod: 'Částka je větší, než databáze unese' }
  const haleru = Number(cele) * 100 + Number(r.desetinne.padEnd(2, '0'))
  if (haleru > MAX_HALERU) return { stav: 'nejasne', duvod: 'Částka je větší, než databáze unese' }
  return { stav: 'ok', haleru: r.zaporne && haleru !== 0 ? -haleru : haleru }
}

/* ------------------------------------------------------------------ */
/* Množství                                                             */
/* ------------------------------------------------------------------ */

/** Označení kusů kolem čísla: „2x", „x2", „2 ×", „2 ks", „2 ks.", „2 kusy". */
const KUSY_V_TEXTU = /^(x|×)\s*|\s*(x|×|ks\.?|kus|kusy|kusů|kusu)$/i
const ZLOMKY = /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞/]/

/**
 * Množství z dokladu → text s tečkou bez koncových nul („2", „0.5",
 * „1.25"). U množství je jediný oddělovač se třemi číslicemi DESETINNÝ
 * („1.250" kg = 1,25 kg). Nula, záporné číslo a zlomky jsou
 * `nejasne` — nula na dokladu skoro vždycky znamená, že se číslo
 * nepřečetlo.
 */
export function prevestMnozstvi(vstup: string | number | null | undefined): VysledekMnozstvi {
  if (vstup === null || vstup === undefined) return { stav: 'prazdne' }

  let cela: string
  let des: string
  let zaporne: boolean

  if (typeof vstup === 'number') {
    if (!Number.isFinite(vstup)) return { stav: 'nejasne', duvod: 'Množství není konečné číslo' }
    const text = String(vstup)
    if (/e/i.test(text)) return { stav: 'nejasne', duvod: 'Množství je mimo rozsah' }
    zaporne = text.startsWith('-')
    const [c, d = ''] = text.replace('-', '').split('.')
    cela = c
    des = d
  } else if (typeof vstup === 'string') {
    let s = vstup.replace(MEZERY, ' ').trim()
    if (s === '') return { stav: 'prazdne' }
    if (ZLOMKY.test(s)) return { stav: 'nejasne', duvod: `Množství „${s}" je zlomek — zapište ho desetinným číslem` }
    let predtim = ''
    while (s !== predtim) {
      predtim = s
      s = s.replace(KUSY_V_TEXTU, '').trim()
    }
    if (s === '') return { stav: 'nejasne', duvod: `V „${zkratit(vstup)}" není číslo` }
    const r = rozebratCislo(s, 'desetinne')
    if (r.stav === 'nejasne') return { stav: 'nejasne', duvod: r.duvod.startsWith('Nečíselný') ? `Množství „${zkratit(vstup)}" obsahuje jednotku nebo text — jednotka patří do vlastního políčka` : r.duvod }
    cela = r.cele
    des = r.desetinne
    zaporne = r.zaporne
  } else {
    return { stav: 'nejasne', duvod: 'Množství není text ani číslo' }
  }

  if (des.length > 3) return { stav: 'nejasne', duvod: 'Množství má víc než tři desetinná místa' }
  const normal = normalizovat(cela, des)
  const tisicin = mnozstviNaTisiciny(normal)
  if (tisicin === null) return { stav: 'nejasne', duvod: 'Množství není číslo' }
  if (tisicin === 0) return { stav: 'nejasne', duvod: 'Množství přečtené jako 0 — ověřte, kolik to opravdu bylo' }
  if (zaporne) return { stav: 'nejasne', duvod: 'Záporné množství — vratku zapište jako opravu' }
  if (tisicin > MAX_MNOZSTVI_TISICIN) return { stav: 'nejasne', duvod: 'Množství je větší, než databáze unese' }
  return { stav: 'ok', mnozstvi: normal }
}

function normalizovat(cela: string, des: string): string {
  const c = bezUvodnichNul(cela === '' ? '0' : cela)
  const d = des.replace(/0+$/, '')
  return d === '' ? c : `${c}.${d}`
}

/**
 * Normalizované množství („2", "0.5", "-1.25") → tisíciny jako celé číslo.
 * `null`, když text není číslo s nejvýš třemi desetinnými místy nebo je
 * mimo rozsah bezpečných celých čísel. Pomocník pro přesné počty.
 */
export function mnozstviNaTisiciny(m: string): number | null {
  const x = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(m.trim())
  if (!x) return null
  if (x[2].replace(/^0+/, '').length > 12) return null
  const t = Number(x[2]) * 1000 + Number((x[3] ?? '').padEnd(3, '0'))
  if (!Number.isSafeInteger(t)) return null
  return x[1] === '-' && t !== 0 ? -t : t
}

/** Tisíciny → normalizovaný text s tečkou („2500" → "2.5"). */
export function tisicinyNaMnozstvi(t: number): string {
  if (!Number.isSafeInteger(t)) throw new RangeError('Tisíciny musí být celé číslo')
  const zap = t < 0
  const a = Math.abs(t)
  const cela = String(Math.floor(a / 1000))
  const des = String(a % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${zap ? '-' : ''}${des === '' ? cela : `${cela}.${des}`}`
}

/**
 * Množství × jednotková cena → haléře, přesně a celočíselně.
 *
 * Množství se převede na tisíciny, násobí se v `BigInt` (999 999 999 kusů
 * × 21 mil. Kč by v obyčejném čísle ztratilo přesnost) a výsledek se
 * dělí tisícem se zaokrouhlením „půlka od nuly" (0,5 haléře → 1 haléř,
 * −0,5 → −1), jak se zaokrouhluje na dokladech.
 *
 * Volej s výsledkem `prevestMnozstvi` a s celými haléři; jiný vstup je
 * chyba v kódu a funkce hodí `RangeError` (radši pád než tichý nesmysl).
 * Totéž u výsledku mimo bezpečná celá čísla (přes 90 bilionů Kč) — ten by
 * už nebyl přesný. Strop databáze (`MAX_HALERU`) hlídá volající.
 */
export function vynasobit(mnozstvi: string, cenaHaleru: number): number {
  const t = mnozstviNaTisiciny(mnozstvi)
  if (t === null) throw new RangeError(`Množství „${mnozstvi}" není číslo s nejvýš třemi desetinnými místy`)
  if (!Number.isSafeInteger(cenaHaleru)) throw new RangeError('Cena musí být celé číslo haléřů')
  const soucin = BigInt(t) * BigInt(cenaHaleru)
  const zap = soucin < BigInt(0)
  const abs = zap ? -soucin : soucin
  const tisic = BigInt(1000)
  let podil = abs / tisic
  if ((abs % tisic) * BigInt(2) >= tisic) podil += BigInt(1)
  const v = Number(zap ? -podil : podil)
  if (!Number.isSafeInteger(v)) throw new RangeError('Součin množství a ceny je mimo rozsah přesných čísel')
  return v === 0 ? 0 : v
}

/** Porovná dvě množství (text s tečkou) bez plovoucí čárky: -1, 0, 1. Neplatný vstup = `RangeError`. */
export function porovnatMnozstvi(a: string, b: string): number {
  const ta = mnozstviNaTisiciny(a)
  const tb = mnozstviNaTisiciny(b)
  if (ta === null || tb === null) throw new RangeError('Množství není číslo s nejvýš třemi desetinnými místy')
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

/** Množství pro člověka: „0.5" → „0,5", „1250.5" → „1 250,5" (nezlomitelné mezery jako cs-CZ). */
export function mnozstviNaText(m: string): string {
  const x = /^(-?)(\d+)(?:\.(\d+))?$/.exec(m.trim())
  if (!x) return m
  return `${x[1]}${seskupit(x[2])}${x[3] ? `,${x[3]}` : ''}`
}

/* ------------------------------------------------------------------ */
/* Zobrazení                                                            */
/* ------------------------------------------------------------------ */

const NBSP = '\u00a0'

function seskupit(cislice: string): string {
  return cislice.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

function haleruNaCasti(haleru: number): { zap: boolean; cela: string; des: string } {
  const zap = haleru < 0
  const a = Math.abs(haleru)
  return { zap, cela: String(Math.floor(a / 100)), des: String(a % 100).padStart(2, '0') }
}

/**
 * Haléře → „1 234,50 Kč" jako cs-CZ (nezlomitelná mezera mezi tisíci
 * i před měnou, spojovník jako mínus). CZK se píše „Kč", ostatní měny
 * kódem („12,00 EUR"). `mena` null → „(měna neuvedena)" — měnu nikdy
 * nedomýšlíme ani ve zobrazení. Necelé číslo (chyba v datech) → „—".
 */
export function formatHaleru(haleru: number, mena: string | null): string {
  if (!Number.isSafeInteger(haleru)) return '—'
  const cislo = formatCislaHaleru(haleru)
  if (mena === null || mena.trim() === '') return `${cislo}${NBSP}(měna neuvedena)`
  const m = mena.trim().toUpperCase()
  return `${cislo}${NBSP}${m === 'CZK' ? 'Kč' : m}`
}

/** Haléře → „1 234,50" bez měny (do vět, kde měna stojí jinde nebo je neznámá). */
export function formatCislaHaleru(haleru: number): string {
  if (!Number.isSafeInteger(haleru)) return '—'
  const { zap, cela, des } = haleruNaCasti(haleru)
  return `${zap ? '-' : ''}${seskupit(cela)},${des}`
}

/** Haléře → „1234,50" pro předvyplnění políčka (bez mezer, ať se dá rovnou upravit). `null` → ''. */
export function haleruNaText(haleru: number | null): string {
  if (haleru === null || !Number.isSafeInteger(haleru)) return ''
  const { zap, cela, des } = haleruNaCasti(haleru)
  return `${zap ? '-' : ''}${cela},${des}`
}
