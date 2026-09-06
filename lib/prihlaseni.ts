/**
 * Přihlášení kódem — rozhodnutí, která se dají vyzkoušet bez prohlížeče
 * a bez Supabase.
 *
 * Je to tady schválně, a ne rozeseté v `app/prihlaseni/`: přihlášení je
 * jediná obrazovka, ke které se nedostane nikdo zvenčí, takže se nedá
 * proklikat ani odzkoušet v provozu. Co z ní jde vytáhnout do funkcí,
 * které si berou vstup a vracejí výstup, se vytáhnout MÁ — jinak se to
 * neověří vůbec.
 *
 * Zkoušky jsou v `scripts/prihlaseni.test.mjs`.
 */

/** Jak dlouho je „Poslat znovu" zašedlé. */
export const ZNOVU_PO_VTERINACH = 60

/**
 * Hláška pro překročený strop.
 *
 * Limity Supabase jsou na IP ADRESU (30 ověření / 5 minut) a celá
 * provozovna má na wifi jednu IP. Osm lidí, kteří se ráno hlásí ze
 * stejné sítě, se do toho vejde jen tak tak.
 */
export const HLASKA_STROP =
  'Zkoušeli jsme to moc rychle za sebou. Počkejte prosím pár minut ' +
  'a zkuste to znovu.'

/** Hláška pro kód, který nesedí nebo už neplatí. */
export const HLASKA_SPATNY_KOD =
  'Kód nesedí, nebo už neplatí. Nechte si prosím poslat nový.'

/**
 * Je to odpověď „moc rychle za sebou"?
 *
 * MUSÍ se to poznat a NESMÍ to splynout s „kód nesedí". Když osm lidí
 * na jedné wifi překročí strop, aplikace jim řekne „kód nesedí" —
 * a hledá se pak chyba v kódu, který je správně. Tohle je jediné
 * místo, kde se ty dva stavy rozdělují.
 *
 * Kouká se na `status` i na `code`: Supabase vrací 429 v HTTP stavu,
 * ale u některých cest přijde jen textový kód (`over_email_send_rate_limit`,
 * `over_request_rate_limit`). Kdyby se hlídal jen jeden z nich, druhá
 * půlka případů by propadla do „kód nesedí".
 */
export function jeStrop(chyba: unknown): boolean {
  if (!chyba || typeof chyba !== 'object') return false
  const e = chyba as { status?: unknown; code?: unknown }
  if (e.status === 429) return true
  return typeof e.code === 'string' && e.code.includes('rate_limit')
}

/** Co se má člověku ukázat, když ověření kódu neprošlo. */
export function hlaskaProChybu(chyba: unknown): string {
  return jeStrop(chyba) ? HLASKA_STROP : HLASKA_SPATNY_KOD
}

/**
 * Kam se po přihlášení vrátit.
 *
 * Bere se jen relativní cesta uvnitř aplikace. `//zloduch.cz` je
 * platná adresa, kterou prohlížeč přečte jako CIZÍ DOMÉNU — proto se
 * kontroluje i druhý znak. Bez toho by šlo poslat člověku odkaz na
 * přihlášení, po kterém by ho aplikace odnesla jinam, a on by si
 * myslel, že je pořád u nás.
 *
 * Zpátky na přihlášení se taky nevrací: skončil by na ní znovu
 * a vypadalo by to, že se přihlášení nepovedlo.
 */
export function bezpecnyCil(kam: string | null | undefined): string {
  const c = String(kam ?? '')
  if (!c.startsWith('/')) return '/'
  // Druhý znak: `//host` i `/\host` prohlížeče berou jako cizí adresu.
  if (c.startsWith('//') || c.startsWith('/\\')) return '/'
  if (c === '/prihlaseni' || c.startsWith('/prihlaseni/') || c.startsWith('/prihlaseni?')) {
    return '/'
  }
  return c
}

/**
 * Kolik vteřin ještě zbývá, než půjde poslat kód znovu.
 *
 * `odeslanoKdy` je čas ze SERVERU. Kdyby si ho měřil prohlížeč, obejde
 * se čekání přetočením hodin v telefonu.
 */
export function zbyvaDoZnovu(
  odeslanoKdy: number,
  ted: number,
  vterin: number = ZNOVU_PO_VTERINACH,
): number {
  if (!odeslanoKdy) return 0
  const uplynulo = (ted - odeslanoKdy) / 1000
  return Math.max(0, Math.ceil(vterin - uplynulo))
}

/**
 * Kód opsaný nebo vložený člověkem → kód, který přijme Supabase.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ JEN `trim()`
 *
 * Lidé kód **kopírují z e-mailu i s tím, co je kolem**. Z Gmailu se
 * vedle číslic veze:
 *
 *   * obyčejná mezera (kód bývá vysázený `123 456`),
 *   * NEZLOMITELNÁ mezera U+00A0 — tu `trim()` neodstraní a `\s`
 *     v JavaScriptu ano, ale spolehnout se na to naslepo je zbytečné
 *     riziko,
 *   * úzká nezlomitelná mezera U+202F a znak nulové šířky U+200B,
 *     které do HTML propašuje sazba e-mailu a člověk je NEVIDÍ.
 *
 * Zůstane tedy jen to, co je opravdu kód. Nečíslice se schválně
 * NEODSTRAŇUJÍ všechny — kdyby Supabase někdy vydával kód s písmeny,
 * tohle by ho tiše rozbilo. Odstraňují se jen mezery a neviditelné
 * znaky, tedy to, co do kódu nepatří v žádné jeho podobě.
 */
export function normalizujKod(vstup: string | null | undefined): string {
  return String(vstup ?? '')
    // Všechny druhy mezer a zalomení, včetně NBSP a úzké NBSP.
    .replace(/[\s  ]+/g, '')
    // Znaky nulové šířky — v e-mailu je nikdo neuvidí, Supabase ano.
    .replace(/[​‌‍﻿]/g, '')
}

/**
 * Má se ukázat věta „nejdřív na plochu, pak se přihlas"?
 *
 * Na iPhonu má aplikace přidaná na plochu VLASTNÍ ÚLOŽIŠTĚ, oddělené
 * od Safari. Kdo se přihlásí v Safari a pak si ji přidá na plochu, je
 * v ní nepřihlášený — a vypadá to jako chyba aplikace, ne jako pořadí
 * kroků.
 *
 * Věta patří jen tam, kde se tomu dá předejít: v PROHLÍŽEČI na
 * telefonu. V aplikaci na ploše by byla matoucí („vždyť ji tam mám")
 * a na počítači zbytečná — tam žádné oddělené úložiště není.
 */
export function maUkazatNaPlochu(kde: {
  naPlose: boolean
  uzkaObrazovka: boolean
}): boolean {
  return kde.uzkaObrazovka && !kde.naPlose
}
