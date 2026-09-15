/**
 * Kde se fotka používá (krok 5 zadání: „Detail fotky").
 *
 * Čistá funkce — obrazovka `marketing/media` z ní staví, kam fotka
 * patří, dřív než ji někdo smaže. `smazatFotku` (`media/akce.ts`) maže
 * doopravdy a nekontroluje nic: bez týhle viditelnosti by smazání
 * fotky, kterou drží rozpracovaný koncept, nechalo v příspěvku
 * nefunkční odkaz a nikdo by nevěděl proč.
 */

export type PrispevekAktualniVerze = {
  id: string
  nazev: string
  stav: string
  aktualniVerzeId: string | null
}

export type VerzeMedia = {
  id: string
  mediaIds: readonly string[]
}

export type PouzitiFotky = { prispevekId: string; nazev: string; stav: string }

/** Fotka → seznam příspěvků, které ji drží ve své AKTUÁLNÍ verzi. */
export function sestavPouziti(
  prispevky: readonly PrispevekAktualniVerze[],
  verze: readonly VerzeMedia[],
): Map<string, PouzitiFotky[]> {
  const mediaPodleVerze = new Map(verze.map((v) => [v.id, v.mediaIds]))
  const vysledek = new Map<string, PouzitiFotky[]>()

  for (const p of prispevky) {
    if (!p.aktualniVerzeId) continue
    const mediaIds = mediaPodleVerze.get(p.aktualniVerzeId)
    if (!mediaIds) continue

    for (const mediaId of mediaIds) {
      const seznam = vysledek.get(mediaId) ?? []
      seznam.push({ prispevekId: p.id, nazev: p.nazev, stav: p.stav })
      vysledek.set(mediaId, seznam)
    }
  }

  return vysledek
}
