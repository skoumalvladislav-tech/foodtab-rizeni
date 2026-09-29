/**
 * Kam vede klepnutí na upozornění ve zvonečku.
 *
 * Do 27. 9. vedla každá položka panelu zvonečku na obecnou stránku
 * Upozornění a tam se musel člověk proklikat znovu. Teď položka vede
 * rovnou na věc: směnu, úkol, checklist, zálohu, rozhovor, Nástěnku.
 *
 * ADRESA SE POČÍTÁ Z ULOŽENÉHO ŘÁDKU, NE Z FORMULÁŘE (pravidlo 4).
 * Serverová akce `app/[rozsah]/upozorneni/otevrit.ts` si řádek načte
 * sama (RLS pustí jen vlastní) a teprve z něj tahle funkce složí cíl.
 * Kdyby cíl posílal prohlížeč, dal by se podvrhnout odkaz kamkoli.
 *
 * Kvůli tomu se každá hodnota z `telo`, která jde do adresy, ještě
 * ověří tvarem (uuid, slug, datum). Co nesedí, spadne na obecnou
 * stránku Upozornění — nikdy na adresu mimo aplikaci.
 *
 * Kde se na upozornění musí něco POTVRDIT (změna a zrušení směny),
 * vede klepnutí na stránku Upozornění, kde je tlačítko „Potvrdit“.
 * Rozpis tlačítko nemá. Nepotvrzené upozornění akce klepnutím za
 * přečtené NEOZNAČÍ (28. 9., `otevrit.ts`): přečte se až potvrzením,
 * takže do té doby zůstane ve zvonečku jako připomínka. Stejně
 * pozvánky: jejich odkaz teď mění souběžná úloha, tak se tu nezdvojuje.
 *
 * „Nový vzkaz“ se slučuje za den (`app.notifikovat`): „3 nové zprávy“
 * můžou být ze tří rozhovorů, `zdroj_id` nese jen tu poslední. Sloučené
 * upozornění proto vede na seznam nepřečtených, do rozhovoru jen to
 * s jednou zprávou (28. 9.).
 *
 * Čistá funkce, test: scripts/upozorneni.test.mjs.
 */

import {
  odkazNaChecklist,
  odkazNaSmenu,
  odkazNaZalohu,
  pocetUpozorneni,
  vyzadujePotvrzeni,
  type TeloUpozorneni,
} from './upozorneni-text.ts'

export type RadekUpozorneni = {
  druh: string
  telo: TeloUpozorneni
  shift_id?: string | null
  zdroj_typ?: string | null
  zdroj_id?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const DEN = /^\d{4}-\d{2}-\d{2}$/

const jeUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)
const jeSlug = (x: unknown): x is string => typeof x === 'string' && SLUG.test(x)
const jeDen = (x: unknown): x is string => typeof x === 'string' && DEN.test(x)

/**
 * Cíl klepnutí na upozornění.
 *
 * `konverzace` je rozhovor, do kterého patří zpráva ze `zdroj_id`
 * u „nového vzkazu“ — dohledá ho akce (RLS pustí jen účastníka).
 * Bez něj vede „nový vzkaz“ na seznam rozhovorů.
 */
export function odkazUpozorneni(rozsah: string, z: RadekUpozorneni, konverzace?: string | null): string {
  const vychozi = `/${rozsah}/upozorneni`
  if (!jeSlug(rozsah)) return '/'
  const telo = z.telo ?? {}

  if (vyzadujePotvrzeni(z.druh)) return vychozi

  if (z.druh === 'smena.nova' || z.druh === 'smena.zmenena') {
    if (!jeDen(telo.den)) return vychozi
    return odkazNaSmenu(rozsah, { den: telo.den }, jeUuid(z.shift_id) ? z.shift_id : null)
  }

  if (z.druh === 'ukol.pridelen') {
    return jeUuid(telo.ukol) ? `/${rozsah}/ukoly/ukol/${telo.ukol}` : `/${rozsah}/ukoly`
  }

  if (z.druh.startsWith('checklist.')) {
    if (!jeUuid(telo.beh)) return vychozi
    if (telo.pobocka_slug !== undefined && !jeSlug(telo.pobocka_slug)) return vychozi
    if (telo.polozka !== undefined && !jeUuid(telo.polozka)) return vychozi
    return odkazNaChecklist(rozsah, telo) ?? vychozi
  }

  if (z.druh.startsWith('zaloha.')) {
    return odkazNaZalohu(rozsah, z.druh)?.href ?? vychozi
  }

  if (z.druh === 'dochazka.zapomenuty_odchod') {
    if (jeSlug(telo.pobocka_slug) && jeUuid(telo.zamestnanec) && jeDen(telo.den)) {
      return `/${telo.pobocka_slug}/dochazka?doplnit=${telo.zamestnanec}&den=${telo.den}`
    }
    return vychozi
  }

  if (z.druh === 'marketing.zadost') return `/${rozsah}/marketing/schvalovani`
  if (z.druh.startsWith('marketing.')) {
    return jeUuid(telo.prispevek) ? `/${rozsah}/marketing/${telo.prispevek}` : vychozi
  }

  if (z.druh === 'oznameni.nova') return `/${rozsah}/vzkazy?zalozka=nastenka`

  if (z.druh === 'vzkaz.novy') {
    if (pocetUpozorneni(telo) > 1) return `/${rozsah}/vzkazy?filtr=neprectene`
    return jeUuid(konverzace) ? `/${rozsah}/vzkazy/${konverzace}` : `/${rozsah}/vzkazy`
  }

  return vychozi
}
