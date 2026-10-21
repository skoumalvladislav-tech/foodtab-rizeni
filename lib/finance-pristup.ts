import 'server-only'

import { canSee, hasAccess, isModuleActive, type Context, type Permission, type Scope } from '@/lib/authz'
import { zkusPristup, type Pristup } from '@/lib/firma'

/**
 * Vstup na obrazovku Financí.
 *
 * ---------------------------------------------------------------------
 * POBOČKA — JEN PRO TOHO, KDO VIDÍ FINANCE CELÉ FIRMY
 *
 * Na pobočku smí jen ten, kdo má `finance.read` ZA CELOU FIRMU
 * (`hasAccess(…, null)`): RLS části finančních tabulek (transakce,
 * kontakty, párování, bankovní zůstatky — `can_read_scoped(…, null)`)
 * rozsah členství nehlídá, takže člověk s finance.read jen v jedné
 * pobočce by přes ně dosáhl na data celé firmy. Pustit ho sem jde až po
 * zúžení těch politik (migrace) — ROZHODNOUT, docs/hlaseni/otazky.md.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEHLÍDÁ LAYOUT (N23, kontrola 19. 10. 2026)
 *
 * Dřív to rozhodoval i rám `app/[rozsah]/finance/layout.tsx` — s výjimkou
 * pro Jiné platby podle adresy (hlavička `x-foodtab-adresa`). Jenže:
 *   * layout stránku NEZASTAVÍ: Next vykreslí stránku souběžně s layoutem
 *     a její data pošle do prohlížeče, i když ji layout nevloží
 *     (kontrola 14. 10. 2026);
 *   * sdílený layout se při přechodu přes menu (next/link) znovu
 *     nevykreslí — výsledek výjimky pak závisel na tom, odkud člověk
 *     přišel (z hlášky „jen s přehledem celé firmy" se do Jiných plateb
 *     nedostal, dokud stránku nenačetl znovu).
 * Proto o tom rozhoduje KAŽDÁ stránka sama, prvním řádkem: tahle funkce
 * vrátí `pobocka_bez_firmy` a stránka ukáže `SdeleniPobockyBezFirmy`
 * (app/[rozsah]/finance/pobocka-bez-firmy.tsx). Stránky Jiných plateb mají
 * vlastní vstup (`zkusPristupJinymPlatbam`) a tu hlášku nedostanou.
 * Hlídá scripts/finance-pobocky.test.mjs.
 */
export type PristupFinanci = Pristup | { stav: 'pobocka_bez_firmy' }

/**
 * `zkusPristup` + druhá podmínka pro pobočku: na pobočce smí jen ten, kdo
 * má finance.read ZA CELOU FIRMU, jinak `pobocka_bez_firmy` (důvod výš).
 */
export async function zkusPristupFinanci(tenantId: string, pravo: Permission, rozsah: string): Promise<PristupFinanci> {
  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav !== 'ok' || pristup.scope.level !== 'branch') return pristup
  return (await hasAccess(tenantId, 'finance.read', null)) ? pristup : { stav: 'pobocka_bez_firmy' }
}

/**
 * Totéž rozhodnutí pro obrazovku pod Financemi, která vstupuje JINÝM
 * právem (Nákup — `purchasing.read`, modul Objednávky): člověk, který
 * finanční přehled má jen na pobočce, by přes ni na pobočce viděl data
 * celé firmy (dodavatelé z Kontaktů). Dřív ho zastavil rám Financí; teď
 * stránka sama, hned za svou vstupní kontrolou (N23).
 *
 * `true` = ukázat `SdeleniPobockyBezFirmy` místo dat. Kdo finance.read
 * nemá nikde nebo Finance nemá zapnuté, toho se to netýká (tak to měl
 * i rám).
 */
export async function pobockaBezPrehleduFirmy(tenantId: string, pristup: { ctx: Context; scope: Scope }): Promise<boolean> {
  if (pristup.scope.level !== 'branch') return false
  if (!isModuleActive(pristup.ctx, 'finance') || !canSee(pristup.ctx, 'finance.read')) return false
  return !(await hasAccess(tenantId, 'finance.read', null))
}
