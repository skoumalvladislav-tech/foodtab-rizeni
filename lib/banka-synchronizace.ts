/**
 * Ruční „Synchronizovat teď" u bankovního připojení — kterou
 * synchronizaci spustit, rozhoduje POSKYTOVATEL připojení.
 *
 * Nález 11. 10. 2026: tlačítko volalo u KAŽDÉHO připojení synchronizaci
 * jedné konkrétní banky. U připojení přes agregátor ta nenašla svůj
 * token, přepnula připojení na „chyba" a naplánovaná úloha ho pak už
 * nikdy nevzala (bere jen „pripojeno"). Jedno kliknutí tak připojení
 * rozbilo.
 *
 * Čistý modul — synchronizace se předávají jako funkce, takže pravidlo
 * jde ověřit bez databáze a sítě (`scripts/banka-synchronizace.test.mjs`).
 * Mapu dává registr konektorů (`lib/banka/konektor.ts`,
 * `registr.synchronizatory()`); nová banka = nový konektor v registru.
 */

import type { Synchronizatory, VysledekSynchronizaceBanky } from './banka/konektor.ts'

export type { Synchronizatory, VysledekSynchronizaceBanky } from './banka/konektor.ts'

export async function synchronizovatPodlePoskytovatele(
  pripojeni: { id: string; poskytovatel: string },
  synchronizatory: Synchronizatory,
): Promise<VysledekSynchronizaceBanky> {
  const synchronizovat = Object.hasOwn(synchronizatory, pripojeni.poskytovatel) ? synchronizatory[pripojeni.poskytovatel] : undefined
  if (!synchronizovat) {
    return { stav: 'chyba', duvod: 'U tohohle připojení appka ruční synchronizaci neumí — data se k němu nestahují.' }
  }
  return synchronizovat(pripojeni.id)
}
