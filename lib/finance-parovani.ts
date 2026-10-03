/**
 * Párování bankovních/pokladních transakcí s fakturami.
 *
 * Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5): VS přesná
 * shoda (+0.5), částka (+0.3), protistrana fuzzy (+0.2), blízkost data
 * (+0.1). Jistota ≥ `PRAH_NAVRHU` se NABÍDNE, nikdy se nepotvrdí sama —
 * potvrzení je vždy lidský klik (`platby_faktury.stav`).
 *
 * Čistá logika, žádné IO — proto bez `import 'server-only'`, testovatelná
 * přímo Nodem (scripts/finance-parovani.test.mjs). Volající (server akce
 * v app/[rozsah]/finance/platby/) si data z obou databází (hlavní +
 * Faktury) natáhne sama a sem předá jen tenhle tvar.
 */

export type KandidatTransakce = {
  id: string
  vs: string
  castkaHaleru: number
  protistrana: string
  datum: string
}

export type KandidatFaktura = {
  id: string
  vs: string | null
  castkaHaleru: number
  dodavatel: string | null
  datum: string | null
}

export type Navrh = {
  transakceId: string
  fakturaId: string
  jistota: number
}

/** Jistota ≥ tohle se nabídne jako návrh — ale nikdy se nepotvrdí sama. */
export const PRAH_NAVRHU = 0.9

/** Bez diakritiky, malá písmena, bez okrajových mezer — na porovnání textu, ne na zobrazení. */
function normalizovat(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Přesná shoda VS po trimu nuly vlevo nejsou — „123" a „0123" se neshodují, banky je nedoplňují samy. */
function shodaVs(a: string, b: string | null): boolean {
  if (!b) return false
  const ta = a.trim()
  const tb = b.trim()
  return ta.length > 0 && ta === tb
}

/** Podíl slov protistrany, která se objeví i v názvu dodavatele (a naopak) — nejhorší ze dvou směrů vyhrává přísnost. */
function podobnostProtistrany(a: string, b: string | null): number {
  if (!b) return 0
  const na = normalizovat(a)
  const nb = normalizovat(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.8

  const slovaA = new Set(na.split(' ').filter((s) => s.length > 2))
  const slovaB = new Set(nb.split(' ').filter((s) => s.length > 2))
  if (slovaA.size === 0 || slovaB.size === 0) return 0

  let shoda = 0
  for (const s of slovaA) if (slovaB.has(s)) shoda++
  return shoda / Math.max(slovaA.size, slovaB.size)
}

/** Dny mezi dvěma kalendářními daty (`'YYYY-MM-DD'`), bez posunu pásmem. */
function rozdilDni(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000
}

/** Plná váha do 3 dnů, lineárně klesá k nule po 30 dnech. */
function blizkostData(a: string, b: string | null): number {
  if (!b) return 0
  const d = rozdilDni(a, b)
  if (d <= 3) return 1
  if (d >= 30) return 0
  return 1 - (d - 3) / 27
}

/** Jistota shody jedné transakce s jednou fakturou, 0 až 1. */
export function jistotaShody(transakce: KandidatTransakce, faktura: KandidatFaktura): number {
  let jistota = 0
  if (shodaVs(transakce.vs, faktura.vs)) jistota += 0.5
  if (transakce.castkaHaleru === faktura.castkaHaleru) jistota += 0.3
  jistota += 0.2 * podobnostProtistrany(transakce.protistrana, faktura.dodavatel)
  jistota += 0.1 * blizkostData(transakce.datum, faktura.datum)
  return Math.min(1, Math.round(jistota * 1000) / 1000)
}

/**
 * Nejlepší návrh pro jednu transakci napříč fakturami — jen pod prahem
 * se nic nevrátí, ať se slabá shoda nenabízí jako by byla jistá.
 */
export function navrhnoutParovani(
  transakce: KandidatTransakce,
  faktury: readonly KandidatFaktura[],
): Navrh | null {
  let nejlepsi: Navrh | null = null
  for (const f of faktury) {
    const jistota = jistotaShody(transakce, f)
    if (jistota < PRAH_NAVRHU) continue
    if (!nejlepsi || jistota > nejlepsi.jistota) {
      nejlepsi = { transakceId: transakce.id, fakturaId: f.id, jistota }
    }
  }
  return nejlepsi
}
