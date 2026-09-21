/**
 * Skládání vlákna rozhovoru pro zobrazení.
 *
 * Čistá funkce: z plochého seznamu zpráv (od nejstarší) udělá pořadí
 * položek, které obrazovka jen vykreslí — oddělovače dnů, dělítko
 * „Nové“ a seskupení zpráv téhož autora za sebou. Skládat to přímo
 * v komponentě by znamenalo, že se dá ověřit jen po přihlášení do
 * aplikace; takhle se ověřuje testem.
 *
 * Dny se počítají v pásmu POBOČKY, ne serveru — zpráva napsaná ve 23:50
 * nesmí přeskočit na další den jen proto, že server běží v UTC.
 */

import { denZkraceny } from '../upozorneni-text'

export type ZpravaVlakna = {
  id: string
  /** employees.id autora; prázdné u systémových událostí. */
  autor: string | null
  /** ISO čas vzniku. */
  vytvoreno: string
  typ: 'zprava' | 'system'
}

export type PolozkaVlakna<T extends ZpravaVlakna> =
  | { druh: 'den'; klic: string; popis: string }
  | { druh: 'nove'; pocet: number }
  | { druh: 'udalost'; zprava: T }
  | { druh: 'zprava'; zprava: T; moje: boolean; zacatekSkupiny: boolean; konecSkupiny: boolean }

export type MoznostiVlakna = {
  /** employees.id přihlášeného, nebo null. */
  ja: string | null
  /** IANA pásmo pobočky, např. Europe/Prague. */
  zona: string
  /** Dnešní den v pásmu pobočky (YYYY-MM-DD). */
  dnes: string
  /** Do kdy má přihlášený přečteno (ISO), nebo null = nic. */
  precetoDo: string | null
  /** Zprávy téhož autora blíž než tolik minut se slučují do skupiny. */
  mezeraMin?: number
}

/** YYYY-MM-DD daného okamžiku v pásmu. Neplatné pásmo padá na UTC, ne na chybu. */
export function denVPasmu(iso: string, zona: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function posunDne(iso: string, dny: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dny)
  return d.toISOString().slice(0, 10)
}

/** „Dnes“, „Včera“, „po 21. 9.“. */
export function popisDne(den: string, dnes: string): string {
  if (den === dnes) return 'Dnes'
  if (den === posunDne(dnes, -1)) return 'Včera'
  return denZkraceny(den)
}

export function poskladatVlakno<T extends ZpravaVlakna>(
  zpravy: T[],
  m: MoznostiVlakna,
): PolozkaVlakna<T>[] {
  const mezera = (m.mezeraMin ?? 5) * 60_000
  const vysledek: PolozkaVlakna<T>[] = []

  const precetoDo = m.precetoDo ? new Date(m.precetoDo).getTime() : null
  const jeNova = (z: T) =>
    z.typ === 'zprava' &&
    z.autor !== m.ja &&
    (precetoDo === null || new Date(z.vytvoreno).getTime() > precetoDo)

  const pocetNovych = zpravy.filter(jeNova).length
  let delitkoPouzito = false
  let predchozi: T | null = null
  let predchoziDen = ''

  for (const z of zpravy) {
    const den = denVPasmu(z.vytvoreno, m.zona)
    if (den !== predchoziDen) {
      vysledek.push({ druh: 'den', klic: den, popis: popisDne(den, m.dnes) })
      predchoziDen = den
      predchozi = null
    }

    if (!delitkoPouzito && pocetNovych > 0 && jeNova(z)) {
      vysledek.push({ druh: 'nove', pocet: pocetNovych })
      delitkoPouzito = true
      predchozi = null
    }

    if (z.typ === 'system') {
      vysledek.push({ druh: 'udalost', zprava: z })
      predchozi = null
      continue
    }

    const navazuje =
      predchozi !== null &&
      predchozi.typ === 'zprava' &&
      predchozi.autor === z.autor &&
      new Date(z.vytvoreno).getTime() - new Date(predchozi.vytvoreno).getTime() <= mezera

    vysledek.push({
      druh: 'zprava',
      zprava: z,
      moje: m.ja !== null && z.autor === m.ja,
      zacatekSkupiny: !navazuje,
      konecSkupiny: true,
    })

    // Předchozí zpráva už není poslední ve skupině, když tahle navazuje.
    if (navazuje) {
      for (let i = vysledek.length - 2; i >= 0; i--) {
        const p = vysledek[i]
        if (p.druh === 'zprava' && p.zprava === predchozi) {
          p.konecSkupiny = false
          break
        }
      }
    }
    predchozi = z
  }

  return vysledek
}
