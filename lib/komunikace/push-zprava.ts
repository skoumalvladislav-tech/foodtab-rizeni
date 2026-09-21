import { nadpisUpozorneni, obdobiRozpisu, souhrnCekajicich, type TeloUpozorneni } from '../upozorneni-text.ts'

/**
 * Text push oznámení.
 *
 * PUSH PUTUJE PŘES CIZÍ SLUŽBU (Google, Mozilla, Apple) a ukáže se na zamčené
 * obrazovce. Proto nese jen to, co nese i nadpis upozornění v aplikaci — ani
 * text zprávy, ani jméno odesílatele, ani jméno kohokoli jiného. Skládá se
 * z holých údajů upozornění stejnou funkcí jako zvoneček, ne podruhé po svém.
 *
 * Mimo pracovní dobu se neposílá dávka pípnutí: víc čekajících se sloučí do
 * jednoho souhrnu „Čekají na vás N zpráv“ (app.uvolnit_cekajici).
 */

export type RadekDoruceni = {
  typ: 'jedna' | 'souhrn'
  pocet: number
  /** Druh upozornění; prázdný u souhrnu a u upozornění, které mezitím zmizelo. */
  druh: string | null
  telo: TeloUpozorneni | null
  priorita: string | null
}

export type ZpravaPush = {
  title: string
  body: string
  /** Stejný tag = novější oznámení nahradí starší místo hromadění. */
  tag: string
  url: string
  urgent: boolean
}

export function slozitPush(r: RadekDoruceni): ZpravaPush {
  const urgent = r.priorita === 'urgent'

  if (r.typ === 'souhrn') {
    return { title: 'Foodtab', body: souhrnCekajicich(r.pocet), tag: 'souhrn', url: '/', urgent: false }
  }

  // NÁZEV ÚKOLU se do push nedává: úkol ze zprávy má název předvyplněný
  // z textu zprávy a přidělený nemusí být účastníkem rozhovoru. V aplikaci
  // je název součástí úkolu; na zamčené obrazovce přes cizí službu ne.
  const body =
    r.druh === 'ukol.pridelen'
      ? 'Máte nový úkol'
      : r.druh
        ? nadpisUpozorneni(r.druh, r.telo ?? {}, obdobiRozpisu)
        : 'Máte nové upozornění'

  return {
    title: urgent ? 'Foodtab — naléhavé' : 'Foodtab',
    body,
    tag: r.druh ?? 'upozorneni',
    url: '/',
    urgent,
  }
}
