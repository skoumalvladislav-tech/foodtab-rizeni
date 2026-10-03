/**
 * Rozpočet opakovaných položek (`predpisy_plateb`) do dnů/týdnů/měsíců.
 *
 * Čistá logika, žádné IO — proto bez `import 'server-only'` a testovatelná
 * přímo Nodem (scripts/finance-plan.test.mjs), stejný vzor jako
 * lib/marketing-kalendar.ts. `lib/finance-prehled.ts` (server-only, mluví
 * s Supabase) tohle importuje a jen sčítá skutečnost s plánem — nikdy
 * do jednoho čísla (zadání, oddíl 4: „Jasně rozliš skutečnost, plán
 * a odhad.").
 */

export type Perioda = 'jednorazove' | 'mesicne' | 'tydne'

export type RadekPredpisu = {
  branchId: string | null
  smer: 'prijem' | 'vydaj'
  castkaHaleru: number
  perioda: Perioda
  dalsiSplatnost: string
}

/** `'YYYY-MM-DD'` → dny od epochy v UTC. Žádné posuny pásmem — datum je kalendářní, ne okamžik. */
function naDen(datum: string): number {
  const [y, m, d] = datum.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * Kolikrát předpis padne do [od, do] včetně. Krok se počítá kalendářně
 * (měsíc jako měsíc, ne 30 dní) — `dalsiSplatnost` je výchozí bod, od
 * kterého se jede dopředu, i když je dávno v minulosti (uživatel si
 * datum neaktualizuje po každé platbě — zadání i `predpisy_plateb`
 * záměrně nemají scénářový motor, jen plochý seznam).
 *
 * Strop 2000 kroků je pojistka proti nesmyslným vstupům (datum
 * z minulého tisíciletí u týdenní periody), ne reálný limit.
 */
export function pocetVyskytu(perioda: Perioda, dalsiSplatnost: string, od: string, doData: string): number {
  const odD = naDen(od)
  const doD = naDen(doData)
  if (doD < odD) return 0

  if (perioda === 'jednorazove') {
    const d = naDen(dalsiSplatnost)
    return d >= odD && d <= doD ? 1 : 0
  }

  const krok = perioda === 'tydne' ? 7 : null
  const [y0, m0, d] = dalsiSplatnost.split('-').map(Number)
  let y = y0
  let m = m0
  let aktualni = Date.UTC(y, m - 1, d) / 86_400_000

  let pocet = 0
  for (let i = 0; i < 2000 && aktualni <= doD; i++) {
    if (aktualni >= odD) pocet++
    if (krok !== null) {
      aktualni += krok
    } else {
      // mesicne: posun o kalendářní měsíc, ne o 30 dní
      m += 1
      if (m > 12) { m = 1; y += 1 }
      aktualni = Date.UTC(y, m - 1, d) / 86_400_000
    }
  }

  return pocet
}

/** Součet plánovaných příjmů/výdajů jedné pobočky (nebo firmy, branchId null) v [od, do]. */
export function secistPlan(
  predpisy: readonly RadekPredpisu[],
  branchId: string | null,
  od: string,
  doData: string,
): { prijmyHaleru: number; vydajeHaleru: number } {
  let prijmy = 0
  let vydaje = 0
  for (const p of predpisy) {
    if (p.branchId !== branchId) continue
    const n = pocetVyskytu(p.perioda, p.dalsiSplatnost, od, doData)
    if (n === 0) continue
    if (p.smer === 'prijem') prijmy += p.castkaHaleru * n
    else vydaje += p.castkaHaleru * n
  }
  return { prijmyHaleru: prijmy, vydajeHaleru: vydaje }
}
