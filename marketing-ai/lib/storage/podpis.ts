import { appSecret, hmacHex, safeEqual } from "../utils/hash.ts";

/**
 * Podepsané adresy souborů s omezenou platností.
 *
 * Soubor se nepodává podle cesty, ale podle ID média + podpisu. Podpis
 * pokrývá ID i čas vypršení, takže adresu nejde upravit ani prodloužit.
 */
export function podepsatSoubor(assetId: string, ttlSeconds = 3600, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const sig = hmacHex(appSecret(), `${assetId}.${exp}`);
  return `/api/v1/media/${assetId}/soubor?exp=${exp}&sig=${sig}`;
}

export function overitPodpis(assetId: string, exp: string | null, sig: string | null, now: Date = new Date()): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(now.getTime() / 1000)) return false;
  return safeEqual(hmacHex(appSecret(), `${assetId}.${exp}`), sig);
}
