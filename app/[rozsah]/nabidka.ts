import {
  canSee,
  isModuleActive,
  type Context,
  type ModuleKey,
  type Permission,
} from '@/lib/authz'

/**
 * Nabídka obrazovek.
 *
 * Jedno místo, ze kterého se skládá navigace i rozcestník. Položka se
 * nakreslí jen tehdy, když má firma zapnutý příslušný modul a uživatel
 * má právo ji vidět.
 *
 * POZOR: tohle je jen o kreslení. Schovaná položka není zámek — každá
 * obrazovka si přístup ověřuje sama přes requireAccess. (Viz varování
 * u canSee v lib/authz.ts.)
 */
export type Polozka = {
  /** Segment za rozsahem: /<rozsah>/<segment> */
  segment: string
  nazev: string
  modul: ModuleKey
  /**
   * Právo, bez kterého se položka nekreslí.
   *
   * `null` znamená „stačí být členem firmy“. Je to pro obrazovky, které
   * dělá každý sám za sebe — docházku si zapisuje i brigádník, který
   * nemá právo vidět docházku ostatních. Politika attendance_insert to
   * říká stejně: vlastní příchod si zapíše každý zaměstnanec s účtem.
   */
  pravo: Permission | null
  /** Hotové obrazovky se odkazují, ostatní se kreslí zašedle. */
  hotovo: boolean
}

export const NABIDKA: Polozka[] = [
  { segment: 'moje-smeny', nazev: 'Moje směny', modul: 'provoz', pravo: 'shifts.read', hotovo: true },
  { segment: 'smeny', nazev: 'Rozpis směn', modul: 'provoz', pravo: 'shifts.read', hotovo: true },
  { segment: 'dochazka', nazev: 'Docházka', modul: 'provoz', pravo: null, hotovo: true },
  { segment: 'ukoly', nazev: 'Úkoly', modul: 'provoz', pravo: 'tasks.read', hotovo: false },
  { segment: 'komunikace', nazev: 'Komunikace', modul: 'provoz', pravo: 'communication.read', hotovo: false },
  { segment: 'receptury', nazev: 'Receptury', modul: 'provoz', pravo: 'recipes.read', hotovo: false },
  { segment: 'listky', nazev: 'Jídelní lístky', modul: 'provoz', pravo: 'menus.read', hotovo: false },
  { segment: 'motivace', nazev: 'Motivace', modul: 'provoz', pravo: 'motivation.read', hotovo: false },
  { segment: 'finance', nazev: 'Finance', modul: 'finance', pravo: 'finance.read', hotovo: false },
  { segment: 'marketing', nazev: 'Marketing', modul: 'marketing', pravo: 'marketing.read', hotovo: false },
  { segment: 'nakup', nazev: 'Nákup', modul: 'objednavky', pravo: 'purchasing.read', hotovo: false },
]

export function viditelnaNabidka(ctx: Context): Polozka[] {
  return NABIDKA.filter(
    (p) =>
      isModuleActive(ctx, p.modul) &&
      (p.pravo === null || canSee(ctx, p.pravo)),
  )
}
