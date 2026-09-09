import { safeEqual } from "./utils/hash.ts";

/**
 * Sedí tajemství pro cron?
 *
 * Vlastní CRON_SECRET, ne APP_SECRET. Dřív se na APP_SECRET spadlo
 * a mělo to dvě vady: jedno tajemství sloužilo dvěma různým věcem
 * (podepisování adres médií i spouštění úloh), a v demo režimu je
 * APP_SECRET pevný řetězec z kódu — úlohy by tak spustil kdokoli, kdo
 * viděl repozitář.
 *
 * Když CRON_SECRET není nastavené (nebo je kratší než 16 znaků), cron
 * cesta se nezapne vůbec. Není to výpadek: přihlášený uživatel
 * a podepsané webhooky z n8n fungují dál.
 */
export function cronTajemstviSedi(hlavicka: string | null | undefined): boolean {
  const ocekavane = process.env.CRON_SECRET ?? "";
  if (ocekavane.length < 16) return false;
  const h = (hlavicka ?? "").replace(/^Bearer\s+/i, "");
  return h.length > 0 && safeEqual(h, ocekavane);
}
