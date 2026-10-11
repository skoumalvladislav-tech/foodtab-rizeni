/**
 * Pokladní systémy, které appka umí napojit — JEDEN seznam pro
 * formulář, kontrolu vyplnění i synchronizaci.
 *
 * Šéfík 11. 10. 2026: „potřebuji univerzální formu připojení — je
 * spoustu pos… okénko, kam se vloží API token a POS se připojí."
 * Obrazovka Integrace → Pokladní systémy kreslí formulář z `pole`
 * níž; přidání další pokladny je nový řádek tady + adaptér
 * (`lib/pos-provider-contract.ts`), ne nová obrazovka.
 *
 * Dva způsoby:
 *   * `token` — appka se ptá pokladny sama (vložený token, ověří ho
 *     živým voláním, pak každou hodinu stahuje prodeje).
 *   * `prijem` — pokladna, která v seznamu není, posílá prodeje SAMA
 *     na příjmové API Foodtabu (přímo, nebo přes prostředníka jako
 *     n8n/Make). Appka jí vydá klíč; viz `docs/pokladna-api.md`.
 *
 * V seznamu je jen pokladna, jejíž API appka ověřila v oficiální
 * dokumentaci. Storyous, Septim, Markeeta a další veřejnou dokumentaci
 * nemají (ověřeno 11. 10. 2026) — appka si jejich tvar nevymýšlí,
 * do té doby jdou přes `prijem` nebo CSV.
 *
 * Čistý modul (žádné IO, žádné `server-only`) — testuje ho
 * `scripts/pokladna-napojeni.test.mjs` přímo Nodem.
 */

import type { UdajePos } from './pos-provider-contract.ts'

export type PolePripojeni = {
  klic: string
  nazev: string
  /** Tajné pole se ukládá jen zašifrované a appka ho už nikdy nezobrazí. */
  tajne: boolean
  napoveda: string
  /** Kontrola tvaru dřív, než appka vůbec zavolá pokladnu. */
  vzor: RegExp
  chybaVzoru: string
}

export type PopisPokladny = {
  /** Totéž jako `integrace_pripojeni.poskytovatel`; zdroj řádků prodeje je `<klic>_api`. */
  klic: string
  nazev: string
  zpusob: 'token' | 'prijem'
  popis: string
  pole: PolePripojeni[]
  /** Kde majitel přístup vezme — krok za krokem, česky. */
  navod: string[]
}

export const POKLADNY: readonly PopisPokladny[] = [
  {
    klic: 'dotykacka',
    nazev: 'Dotykačka',
    zpusob: 'token',
    popis: 'Appka každou hodinu stáhne denní prodeje po produktech přes oficiální API Dotykačky (API v2).',
    pole: [
      {
        klic: 'refresh_token',
        nazev: 'API token (refresh token)',
        tajne: true,
        napoveda: 'Dlouhý přístupový token Dotykačky API v2. Vložte ho celý.',
        // Tvar tokenu Dotykačka nepopisuje — appka hlídá jen to, co
        // platí jistě: žádné mezery, rozumná délka. Zbytek ověří živé
        // volání (POST /v2/signin/token).
        vzor: /^\S{20,4000}$/,
        chybaVzoru: 'Token nemá očekávaný tvar — vložte ho celý, bez mezer a zalomení.',
      },
      {
        klic: 'cloud_id',
        nazev: 'Cloud ID',
        tajne: false,
        napoveda: 'Číslo cloudu v Dotykačce — dostanete ho spolu s tokenem.',
        vzor: /^\d{1,15}$/,
        chybaVzoru: 'Cloud ID je číslo.',
      },
    ],
    navod: [
      'Nejjednodušší je tlačítko „Přihlásit přes Dotykačku" — token si appka vezme sama.',
      'Když token a Cloud ID už máte (dala vám je Dotykačka nebo jiná integrace), vložte je do políček.',
      'Appka token hned ověří u Dotykačky; „Připojeno" ukáže, až když ověření projde.',
    ],
  },
  {
    klic: 'obecne',
    nazev: 'Jiná pokladna (příjmové API Foodtabu)',
    zpusob: 'prijem',
    popis: 'Pro pokladnu, kterou appka zatím nezná: appka vydá klíč a pokladna (nebo n8n/Make) posílá denní prodeje sama.',
    pole: [],
    navod: [
      'Klikněte na „Vytvořit klíč" — appka ho ukáže jen jednou, hned si ho zkopírujte.',
      'Klíč vložte do pokladny nebo do prostředníka (n8n, Make, Zapier), který umí poslat HTTP požadavek.',
      'Data posílejte na adresu /api/pokladna/prodeje — tvar je v návodu níž. „Připojeno" appka ukáže po prvních přijatých datech.',
    ],
  },
]

export function najitPokladnu(klic: string): PopisPokladny | null {
  return POKLADNY.find((p) => p.klic === klic) ?? null
}

/** Řádky prodeje z API se v `pokladna_prodeje_denni` poznají podle zdroje `<klic>_api` (stejné pravidlo jako v SQL `public.pokladna_nahradit_prodeje`). */
export function zdrojPokladny(klic: string): string {
  return `${klic}_api`
}

/**
 * Přečte a zkontroluje pole formuláře podle popisu pokladny. Nic
 * nevolá — jen tvar. Prázdné povinné pole i špatný tvar vrátí chybu
 * s názvem pole, ne obecné „něco je špatně".
 */
export function prectiUdaje(popis: PopisPokladny, ziskej: (klic: string) => string | null | undefined): { stav: 'ok'; udaje: UdajePos } | { stav: 'chyba'; duvod: string } {
  const udaje: UdajePos = {}
  for (const pole of popis.pole) {
    const hodnota = String(ziskej(pole.klic) ?? '').trim()
    if (!hodnota) return { stav: 'chyba', duvod: `Vyplňte „${pole.nazev}".` }
    if (!pole.vzor.test(hodnota)) return { stav: 'chyba', duvod: `${pole.nazev}: ${pole.chybaVzoru}` }
    udaje[pole.klic] = hodnota
  }
  return { stav: 'ok', udaje }
}
