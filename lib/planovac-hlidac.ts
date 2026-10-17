/**
 * Hlídač plánovače úloh — rozhodnutí „běží to, nebo ne".
 *
 * ---------------------------------------------------------------------
 * PROČ
 *
 * Úlohy `/api/uloha/*` volá pg_cron v databázi (docs/planovac-pg-cron.md).
 * pg_cron ale nikomu nenapíše, když přestane volat nebo když úloha vrací
 * chybu — GitHub Actions u každého neúspěšného běhu poslal e-mail. Bez
 * hlídače by se o zastaveném plánovači nikdo nedozvěděl, a právě kvůli
 * tichým výpadkům GitHubu plánovač vznikl.
 *
 * Tady je jen rozhodnutí nad tím, co vrátí `public.planovac_zdravi()`.
 * Adresa `app/api/planovac/hlidac` ho jen zavolá a odpoví 200 / 503;
 * workflow `planovac-hlidac.yml` při 503 zčervená a GitHub pošle e-mail.
 *
 * ---------------------------------------------------------------------
 * CO JE PROBLÉM
 *
 *   * úloha není v pg_cronu (nikdo nespustil `app.naplanovat_ulohy()`,
 *     nebo ji někdo odebral),
 *   * databáze úlohu nezavolala déle, než je nejdelší mezera v jejím
 *     plánu + rezerva,
 *   * poslední odpověď nebyla 2xx (401 = tajemství ve Vaultu nesedí
 *     s Vercelem) nebo volání vypršelo / spadlo na síti.
 *
 * Odpověď „zatím bez odpovědi" problém není — volání ještě běží.
 * Texty jdou do VEŘEJNÉHO logu GitHubu: jen jméno úlohy, kód a minuty,
 * nikdy obsah chyby z pg_net.
 */

/** Řádek z `public.planovac_zdravi()` (= `app.planovac_stav()`). */
export type StavUlohy = {
  uloha: string
  plan_utc: string
  v_cronu: boolean
  posledni_volani: string | null
  posledni_kod: number | null
  posledni_chyba: string | null
  chyb_6h: number | null
}

export type Problem = { uloha: string; duvod: string }

/** Rezerva nad nejdelší mezeru v plánu: pg_net, zpoždění workeru, hodiny. */
export const REZERVA_MINUT = 10

/**
 * Nejdelší mezera mezi dvěma plánovanými spuštěními během dne, v minutách.
 *
 * Umí jen tvar, který plánovač používá: `minuty hodiny * * *`, kde minuty
 * jsou číslo nebo výčet a hodiny `*`, `*\/k` nebo výčet. Cokoli jiného
 * vrátí `null` — hlídač to ohlásí, místo aby hádal.
 */
export function nejdelsiMezeraMinut(cron: string): number | null {
  const casti = cron.trim().split(/\s+/)
  if (casti.length !== 5 || casti.slice(2).some((c) => c !== '*')) return null

  const minuty = hodnoty(casti[0], 59)
  const hodiny = hodnoty(casti[1], 23)
  if (!minuty || !hodiny) return null

  const casy = hodiny.flatMap((h) => minuty.map((m) => h * 60 + m)).sort((a, b) => a - b)
  let nejdelsi = 0
  for (let i = 0; i < casy.length; i++) {
    const dalsi = i + 1 < casy.length ? casy[i + 1] : casy[0] + 24 * 60
    nejdelsi = Math.max(nejdelsi, dalsi - casy[i])
  }
  return nejdelsi
}

function hodnoty(pole: string, nejvys: number): number[] | null {
  const vse = Array.from({ length: nejvys + 1 }, (_, i) => i)
  if (pole === '*') return vse
  const krok = pole.match(/^\*\/(\d+)$/)
  if (krok) {
    const k = Number(krok[1])
    return k >= 1 && k <= nejvys ? vse.filter((x) => x % k === 0) : null
  }
  if (!/^\d+(,\d+)*$/.test(pole)) return null
  const cisla = [...new Set(pole.split(',').map(Number))]
  return cisla.every((n) => n <= nejvys) ? cisla : null
}

export function problemyPlanovace(stav: StavUlohy[], ted: Date): Problem[] {
  if (stav.length === 0) {
    return [{ uloha: '(žádná)', duvod: 'plánovač nevrátil žádné úlohy' }]
  }

  const problemy: Problem[] = []
  for (const u of stav) {
    if (!u.v_cronu) {
      problemy.push({ uloha: u.uloha, duvod: 'není naplánovaná v pg_cronu — spusť select * from app.naplanovat_ulohy();' })
      continue
    }

    const mezera = nejdelsiMezeraMinut(u.plan_utc)
    if (mezera === null) {
      problemy.push({ uloha: u.uloha, duvod: `neznámý tvar plánu „${u.plan_utc}"` })
      continue
    }

    if (!u.posledni_volani) {
      problemy.push({ uloha: u.uloha, duvod: 'databáze ji za posledních 6 h nezavolala' })
      continue
    }
    const stariMinut = Math.round((ted.getTime() - new Date(u.posledni_volani).getTime()) / 60_000)
    if (stariMinut > mezera + REZERVA_MINUT) {
      problemy.push({ uloha: u.uloha, duvod: `poslední volání před ${stariMinut} min, plán nejdéle po ${mezera} min` })
      continue
    }

    if (u.posledni_kod !== null && (u.posledni_kod < 200 || u.posledni_kod >= 300)) {
      problemy.push({
        uloha: u.uloha,
        duvod: u.posledni_kod === 401
          ? 'poslední odpověď HTTP 401 — tajemství ve Vaultu nesedí s CRON_SECRET na Vercelu'
          : `poslední odpověď HTTP ${u.posledni_kod}`,
      })
      continue
    }

    if (u.posledni_kod === null && u.posledni_chyba && u.posledni_chyba !== 'zatím bez odpovědi') {
      problemy.push({
        uloha: u.uloha,
        duvod: u.posledni_chyba === 'vypršel čas' ? 'poslední volání vypršelo' : 'poslední volání spadlo na síti (detail v app.planovac_stav())',
      })
    }
  }
  return problemy
}
