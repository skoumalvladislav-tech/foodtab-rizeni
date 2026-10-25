import 'server-only'

import type { ReservationProvider } from './reservation-provider-contract.ts'

/**
 * Adaptéry rezervačních systémů. Klíč = `integrace_pripojeni.poskytovatel`
 * (stejné klíče jako `SYSTEMY` v `lib/rezervace-poskytovatele.ts`).
 *
 * ZATÍM PRÁZDNÉ, A SCHVÁLNĚ. Adaptér se píše až k systému, ke kterému
 * máme dokumentaci a přístup (docs/rezervace-navrh.md, oddíl 4 — první
 * kandidát je Dotykačka). Do té doby je každé připojení „čeká na
 * připojení“ a rezervace přicházejí ručně nebo souborem.
 *
 * Kdo sem přidá adaptér, nemění nic jiného: převod řádků je
 * v `lib/rezervace-import.ts`, zápis v `public.rezervace_importovat_zdroj`.
 */
export const ADAPTERY_REZERVACI: Readonly<Record<string, ReservationProvider>> = {}
