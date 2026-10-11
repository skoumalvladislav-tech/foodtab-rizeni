/**
 * Ruční „Synchronizovat teď" u bankovního připojení — kterou
 * synchronizaci spustit, rozhoduje POSKYTOVATEL připojení.
 *
 * Nález 11. 10. 2026: tlačítko volalo u KAŽDÉHO připojení synchronizaci
 * Fio. U připojení přes agregátor (Salt Edge) ta nenašla token Fio,
 * přepnula připojení na „chyba" a naplánovaná úloha ho pak už nikdy
 * nevzala (bere jen „pripojeno"). Jedno kliknutí tak připojení rozbilo.
 *
 * Čistý modul — synchronizace se předávají jako funkce, takže pravidlo
 * jde ověřit bez databáze a sítě (`scripts/banka-synchronizace.test.mjs`).
 * Nový poskytovatel (KB ADAA) = nový řádek v mapě u volajícího.
 */

export type VysledekSynchronizaceBanky =
  | { stav: 'ok'; pocetNovychRadku: number }
  | { stav: 'preskoceno'; duvod: string }
  | { stav: 'chyba'; duvod: string }

export type Synchronizatory = Readonly<Record<string, (pripojeniId: string) => Promise<VysledekSynchronizaceBanky>>>

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
