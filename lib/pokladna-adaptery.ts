import 'server-only'

import type { PosProvider } from './pos-provider-contract.ts'
import { vytvoritDotykacku } from './pokladna-dotykacka.ts'

/**
 * Adaptéry pokladen, které se appka ptá SAMA (způsob `token`
 * v `lib/pokladna-poskytovatele.ts`). Klíč = `integrace_pripojeni.poskytovatel`.
 * Další pokladna = další řádek; `obecne` (příjmové API) tu není —
 * tam data posílá pokladna, appka se nikoho neptá.
 */
export const ADAPTERY_POKLADEN: Readonly<Record<string, PosProvider>> = {
  dotykacka: vytvoritDotykacku(),
}
