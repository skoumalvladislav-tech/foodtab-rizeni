/**
 * „Jsem v práci?" — jedna odpověď, ne tři.
 *
 * Zdroj pravdy je `app.otevreny_prichod` v databázi (20260905010000)
 * a chodí se na něj průzorem `public.muj_den`. Tenhle soubor je jen
 * NÁHRADNÍ CESTA pro chvíli, kdy průzor ještě není nasazený — pravidlo
 * z nočního zadání: obrazovka musí fungovat i tehdy, když její migrace
 * v databázi není.
 *
 * Proč je to tady a ne přímo ve stránce: aby se to dalo zkoušet. Chyba,
 * kvůli které tohle vzniklo, byla přesně v téhle úvaze — obrazovka se
 * ptala na POSLEDNÍ UDÁLOST a nefiltrovala storno, takže po stornu
 * nabízela Odchod ke směně, která neexistuje. Úvaha zavřená uvnitř
 * serverové komponenty se nedá spustit, takže se taková chyba pozná až
 * v provozu.
 */

/** Příchod, o kterém se rozhoduje. `null` = žádný otevřený není. */
export type Prichod = {
  /** Provozní den příchodu — odchod se páruje v TÉMŽE provozním dni. */
  business_date: string;
  /** Okamžik příchodu. Odchod se počítá jen ten pozdější. */
  occurred_at: string;
} | null;

/** Odchod, který připadá v úvahu jako protějšek. */
export type Odchod = {
  business_date: string;
  occurred_at: string;
  /** Stornovaný odchod příchod nezavírá. */
  stornovano_kdy?: string | null;
};

/**
 * Je člověk v práci?
 *
 * Očekává příchod, který je UŽ VYFILTROVANÝ: nestornovaný a systémem
 * neuzavřený. Tady se dopočítá jen to poslední — jestli k němu přišel
 * odchod.
 *
 * Definice se schválně neopisuje jinak než v `app.otevreny_prichod`:
 * odchod se páruje v TÉMŽE provozním dni a musí být POZDĚJŠÍ. Dvě
 * různá „otevřeno" by se rozešla — a přesně tím ta chyba vznikla.
 */
export function jeVPraci(prichod: Prichod, odchody: Odchod[]): boolean {
  if (!prichod) return false;
  return !odchody.some(
    (o) =>
      o.stornovano_kdy == null &&
      o.business_date === prichod.business_date &&
      o.occurred_at > prichod.occurred_at,
  );
}
