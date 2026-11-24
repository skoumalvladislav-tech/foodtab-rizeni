/**
 * Variabilní symbol z volného textu platby (Finance Fáze 0, krok 2,
 * bod 10 zadání). Enable Banking (PSD2) VS jako samostatné pole nedává —
 * banky ho píšou do textu platby (`remittance_information`), typicky
 * „VS 123", „VS:123", „/VS/123/SS//KS/0308" nebo „VS123".
 *
 * Bere se jen to, co je jisté: číslo hned za značkou „VS" (oddělené
 * nanejvýš mezerou, dvojtečkou, lomítkem, tečkou nebo pomlčkou), 1 až 10
 * číslic (delší číslo VS není — spíš číslo účtu nebo karty). Před „VS"
 * nesmí být písmeno ani číslice (jinak by se chytlo i „KVS 12"). Když
 * text nese dva RŮZNÉ symboly, vrátí prázdno — nejistý VS je horší než
 * žádný (zadání: appka nesmí domýšlet). Stejný symbol dvakrát je v pořádku.
 *
 * Čistá funkce bez závislostí — testy scripts/banka-vs-z-textu.test.mjs.
 */

const ZNACKA = /(?:^|[^\p{L}\p{N}])VS[\s:/.-]{0,3}(\d+)/giu

export function vsZTextu(text: string | null | undefined): string {
  if (!text) return ''
  const nalezene = new Set<string>()
  for (const shoda of text.matchAll(ZNACKA)) {
    const cislo = shoda[1]
    if (cislo.length > 10) return ''
    nalezene.add(cislo)
  }
  return nalezene.size === 1 ? [...nalezene][0] : ''
}
