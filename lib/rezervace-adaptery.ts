import 'server-only'

import type { ReservationProvider } from './reservation-provider-contract.ts'

/**
 * Adaptéry rezervačních systémů. Klíč = `integrace_pripojeni.poskytovatel`
 * (stejné klíče jako `SYSTEMY` v `lib/rezervace-poskytovatele.ts`).
 *
 * CHOICE (od 25. 10. 2026) TU SCHVÁLNĚ NENÍ, i když adaptér má
 * (`adapter: true` v seznamu systémů): lib/rezervace-choice.ts (převod
 * a průchod) + lib/rezervace-choice-sync.ts (server). Obecné
 * `nacistRezervace(od, do)` by se k Choice nehodilo — Choice pustí jen
 * 1 dotaz za 5 s, takže načtení okna trvá přes víc běhů a pamatuje si,
 * kde skončilo, a každý dotaz čeká ve frontě v databázi. Řádky ale jdou
 * stejnou cestou jako u každého adaptéru: `RadekRezervace` →
 * `zRadkuZdroje` (lib/rezervace-import.ts) → `public.rezervace_importovat_zdroj`.
 *
 * Pro další systém: adaptér se píše až k systému, ke kterému máme
 * dokumentaci a přístup (docs/rezervace-navrh.md, oddíl 4). Kdo sem
 * přidá adaptér, nemění nic jiného: převod řádků je
 * v `lib/rezervace-import.ts`, zápis v `public.rezervace_importovat_zdroj`.
 */
export const ADAPTERY_REZERVACI: Readonly<Record<string, ReservationProvider>> = {}
