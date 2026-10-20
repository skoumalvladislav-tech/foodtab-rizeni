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
 * CO JE PROBLÉM (u každé úlohy první, který platí)
 *
 *   1. úloha není v pg_cronu (nikdo nespustil `app.naplanovat_ulohy()`,
 *      nebo ji někdo odebral),
 *   2. databáze úlohu nezavolala déle, než je nejdelší mezera v jejím
 *      plánu + rezerva — nebo za 6 h vůbec (hned po zapnutí normální,
 *      dokud úloha nepřijde na řadu; text to říká),
 *   3. poslední odpověď nebyla 2xx (401 = tajemství ve Vaultu nesedí),
 *   4. poslední volání vypršelo / spadlo na síti — nebo je BEZ ODPOVĚDI
 *      déle, než smí trvat jakékoli volání. pg_net musí odpovědět nebo
 *      vypršet do `limit_sekund` (nejvýš 300 s); starší volání bez
 *      odpovědi znamená, že pg_net požadavky neodesílá (zaseknutý worker).
 *      pg_cron přitom dál zapisuje čerstvá volání, takže bod 2 to nepozná,
 *   5. za 6 h aspoň `CHYB_6H_PRAH` chybných odpovědí — poslední volání
 *      může náhodou vyjít a opakované pády by zakrylo,
 *   6. úloha v aplikaci naposledy ZAČALA (`posledni_zacatek`, zapisuje ho
 *      zámek `uloha_zabrat` v adrese) déle než mezera + rezerva. Je to
 *      kontrola celé cesty: volání chodí a vrací 200, ale úloha nezačíná
 *      (zaseknutý zámek, adresa vede jinam).
 *
 * Texty jdou do VEŘEJNÉHO logu GitHubu: jen jméno úlohy, kód, počty
 * a minuty, nikdy obsah chyby z pg_net.
 */

/** Řádek z `public.planovac_zdravi()` (= `app.planovac_stav()`). */
export type StavUlohy = {
  uloha: string
  plan_utc: string
  v_cronu: boolean
  posledni_zacatek: string | null
  posledni_volani: string | null
  posledni_kod: number | null
  posledni_chyba: string | null
  volani_6h: number | null
  chyb_6h: number | null
}

export type Problem = { uloha: string; duvod: string }

/** Rezerva nad nejdelší mezeru v plánu: pg_net, zpoždění workeru, hodiny. */
export const REZERVA_MINUT = 10

/**
 * Nejdelší možný limit jednoho volání — `limit_sekund between 30 and 300`
 * v `app.planovac_ulohy` (migrace 20261014120000). Do té doby musí pg_net
 * odpovědět nebo vypršet.
 */
export const NEJDELSI_LIMIT_VOLANI_MINUT = 5

/**
 * Od kolika chybných odpovědí za 6 h je to problém. Jedna chyba projde —
 * výpadek pokladny nebo banky na jedno volání není porucha plánovače;
 * dvě a víc už ano.
 */
export const CHYB_6H_PRAH = 2

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

const minutOd = (cas: string, ted: Date) => Math.round((ted.getTime() - new Date(cas).getTime()) / 60_000)

export function problemyPlanovace(stav: StavUlohy[], ted: Date): Problem[] {
  if (stav.length === 0) {
    return [{ uloha: '(žádná)', duvod: 'plánovač nevrátil žádné úlohy' }]
  }

  const problemy: Problem[] = []
  const problem = (u: StavUlohy, duvod: string) => problemy.push({ uloha: u.uloha, duvod })

  for (const u of stav) {
    // 1.
    if (!u.v_cronu) {
      problem(u, 'není naplánovaná v pg_cronu — spusť select * from app.naplanovat_ulohy();')
      continue
    }

    const mezera = nejdelsiMezeraMinut(u.plan_utc)
    if (mezera === null) {
      problem(u, `neznámý tvar plánu „${u.plan_utc}"`)
      continue
    }
    const smiMinut = mezera + REZERVA_MINUT

    // 2.
    if (!u.posledni_volani) {
      problem(u, `databáze ji za posledních 6 h nezavolala — hned po zapnutí plánovače je to normální, ` +
        `dokud nepřijde na řadu (nejdéle ${mezera} min); později je to porucha`)
      continue
    }
    const volaniPred = minutOd(u.posledni_volani, ted)
    if (volaniPred > smiMinut) {
      problem(u, `poslední volání před ${volaniPred} min, plán nejdéle po ${mezera} min`)
      continue
    }

    // 3.
    if (u.posledni_kod !== null && (u.posledni_kod < 200 || u.posledni_kod >= 300)) {
      problem(u, u.posledni_kod === 401
        ? 'poslední odpověď HTTP 401 — tajemství ve Vaultu nesedí s CRON_SECRET na Vercelu'
        : `poslední odpověď HTTP ${u.posledni_kod}`)
      continue
    }

    // 4.
    if (u.posledni_kod === null && u.posledni_chyba) {
      if (u.posledni_chyba !== 'zatím bez odpovědi') {
        problem(u, u.posledni_chyba === 'vypršel čas'
          ? 'poslední volání vypršelo'
          : 'poslední volání spadlo na síti (detail v app.planovac_stav())')
        continue
      }
      if (volaniPred > NEJDELSI_LIMIT_VOLANI_MINUT + REZERVA_MINUT) {
        problem(u, `poslední volání před ${volaniPred} min je pořád bez odpovědi — pg_net požadavky ` +
          `neodesílá; zkus select net.check_worker_is_up(); a select net.worker_restart();`)
        continue
      }
    }

    // 5.
    if ((u.chyb_6h ?? 0) >= CHYB_6H_PRAH) {
      problem(u, `za posledních 6 h ${u.chyb_6h}× chyba (z ${u.volani_6h ?? '?'} volání) — detail v app.planovac_stav()`)
      continue
    }

    // 6.
    if (!u.posledni_zacatek) {
      problem(u, 'volání chodí, ale úloha v aplikaci ještě nikdy nezačala')
      continue
    }
    const zacatekPred = minutOd(u.posledni_zacatek, ted)
    if (zacatekPred > smiMinut) {
      problem(u, `volání chodí, ale úloha v aplikaci naposledy začala před ${zacatekPred} min ` +
        `(plán nejdéle po ${mezera} min) — zaseknutý zámek, nebo adresa vede jinam`)
    }
  }
  return problemy
}
