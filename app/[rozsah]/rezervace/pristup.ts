import 'server-only'

import { hasAccess, type Context, type Scope } from '@/lib/authz'
import { ZONA_VYCHOZI } from '@/lib/cas'
import { zkusPristup } from '@/lib/firma'
import { BARVY_KALENDARE, vzhledPobocek, type BarvaKalendare } from '@/lib/rezervace-pobocky'

/**
 * Vstup do Rezervací — jedna otázka pro všechny stránky i akce modulu.
 *
 * Dovnitř pustí `rezervace.read` NEBO `rezervace.manage` (kdo zapisuje,
 * musí i vidět, co zapsal — stejně jako politika `rezervace_cist`).
 * Pak se zeptá databáze pobočku po pobočce, kde člověk čte a kde
 * zapisuje: rozsah z adresy je NÁVRH (lib/authz.ts) a firemní rozsah
 * ukazuje jen pobočky, na které člověk opravdu dosáhne.
 *
 * Tohle je první linie a kreslení. Druhá je RLS a funkce
 * `rezervace_*`, které se na právo ptají znovu, na pobočce řádku.
 */

export type PobockaRezervaci = {
  id: string
  nazev: string
  slug: string
  zona: string
  /** Smí tady zapisovat (`rezervace.manage`). */
  zapis: boolean
  /** Zkratka do kalendáře („RČP“) — z názvu, lib/rezervace-pobocky.ts. */
  zkratka: string
  /** Barva rámečku a štítku v kalendáři — z nastavení, když se nepoplete se stavy. */
  barva: BarvaKalendare
}

export type PristupRezervace =
  | {
      stav: 'ok'
      ctx: Context
      scope: Scope
      /** Pobočky rozsahu, které člověk vidí. Na pobočkovém rozsahu nejvýš jedna. */
      pobocky: PobockaRezervaci[]
    }
  | { stav: 'neprihlasen' }
  | { stav: 'odepren' }

export async function zkusPristupRezervacim(tenantId: string, rozsah: string): Promise<PristupRezervace> {
  let pristup = await zkusPristup(tenantId, 'rezervace.read', rozsah)
  if (pristup.stav === 'odepren') pristup = await zkusPristup(tenantId, 'rezervace.manage', rozsah)
  if (pristup.stav !== 'ok') return pristup

  const { ctx, scope } = pristup
  const kandidati = scope.branchId ? ctx.branches.filter((b) => b.id === scope.branchId) : ctx.branches
  // Ze všech poboček kontextu, ne z kandidátů: táž pobočka má na
  // pobočkovém kalendáři tutéž zkratku i barvu jako na firemním.
  const vzhled = vzhledPobocek(ctx.branches)

  const pobocky = (
    await Promise.all(
      kandidati.map(async (b) => {
        const [cte, pise] = await Promise.all([
          hasAccess(tenantId, 'rezervace.read', b.id),
          hasAccess(tenantId, 'rezervace.manage', b.id),
        ])
        const v = vzhled.get(b.id)
        return cte || pise
          ? {
              id: b.id,
              nazev: b.name,
              slug: b.slug,
              zona: b.timezone ?? ZONA_VYCHOZI,
              zapis: pise,
              zkratka: v?.zkratka ?? b.name,
              barva: v?.barva ?? BARVY_KALENDARE[0],
            }
          : null
      }),
    )
  ).filter((p): p is PobockaRezervaci => p !== null)

  if (pobocky.length === 0) return { stav: 'odepren' }
  return { stav: 'ok', ctx, scope, pobocky }
}

/** Pobočka z formuláře — jen taková, na které člověk v tomhle rozsahu zapisuje. */
export function pobockaKZapisu(pristup: Extract<PristupRezervace, { stav: 'ok' }>, id: string): PobockaRezervaci | null {
  return pristup.pobocky.find((p) => p.id === id && p.zapis) ?? null
}
