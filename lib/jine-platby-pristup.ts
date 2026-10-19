import 'server-only'

import {
  canSee,
  hasAccess,
  isModuleActive,
  NeprihlasenError,
  PristupOdepren,
  requireContext,
  type Context,
  type Permission,
  type Scope,
} from '@/lib/authz'
import { bezpecnyRozsah } from '@/lib/firma'
import { PRAVA_CTENI_JINYCH_PLATEB, type PravoJinychPlateb } from '@/lib/jine-platby-typy'

/**
 * Vstupní kontrola agendy Finance → Tržby → Jiné platby
 * (docs/jine-platby-navrh.md, oddíly 4 a 6).
 *
 * ---------------------------------------------------------------------
 * PROČ NE zkusPristupFinanci
 *
 * Agendu používá i OBSLUHA: vyfotí sjetinu, založí záznam a nahraje
 * doklad (`jine_platby.zadat`). Finanční přehled (`finance.read`) nemá
 * a mít nemá — viděla by tržby, banku a cashflow celé firmy.
 * `zkusPristupFinanci` chce `finance.read` (na pobočce dokonce za celou
 * firmu), takže by ji odmítl. Tahle funkce proto pustí každého, kdo má
 * NA POBOČCE ROZSAHU kterékoli právo agendy nebo `finance.read` — přesně
 * stejné pravidlo, jakým databáze pouští řádky (`app.jine_platby_vidi`,
 * RLS všech tabulek agendy). Data hlídá i tak RLS; tohle je první linie.
 *
 * Rám Financí (app/[rozsah]/finance/layout.tsx) od 19. 10. 2026 nic
 * nerozhoduje (N23) — každá stránka Financí si vstup hlídá sama a tahle
 * funkce je vstup stránek agendy.
 *
 * ---------------------------------------------------------------------
 * POZOR: finance.read JEN NA POBOČCE
 *
 * Kdo má `finance.read` jen na své pobočce (členství pobočky), toho
 * tahle funkce PUSTÍ (ostatní obrazovky Financí mu ukážou hlášku „jen
 * s přehledem celé firmy", lib/finance-pristup.ts) — záznamy agendy mu
 * RLS ukáže jen z jeho pobočky. Díra by tu ale BYLA: detail záznamu sahá i na data
 * celé firmy (bankovní platby k párování úhrady, Kontakty pro odběratele
 * faktury), jejichž RLS rozsah členství nehlídá (`can_read_scoped(…, null)`).
 * Proto je detail načítá jen s `finance.read` ZA CELOU FIRMU
 * (`hasAccess(…, 'finance.read', null)`), ne s tím, co vrátí tahle
 * funkce — `prava` tady platí jen v rozsahu adresy a na pobočce
 * `finance.read` neznamená přístup k firemním datům.
 *
 * ---------------------------------------------------------------------
 * VYPNUTÝ MODUL
 *
 * Všechna práva agendy patří modulu `finance` a `app.has_access` sama
 * spojuje `permissions.module_key` s `tenant_modules` (aktivní nebo
 * zkušební, `valid_until` v budoucnu). Firma bez Financí tedy dostane
 * na každé právo „ne" a sem se nedostane nikdo — i přímou adresou
 * (pravidlo 5). Zvláštní kontrolu modulu proto nepřidávám: byla by to
 * podmínka napsaná dvakrát, kterou žádná kontrola neumí shodit.
 */

export type PravoCteniJinychPlateb = PravoJinychPlateb | 'finance.read'

export type PristupJinePlatby =
  | {
      stav: 'ok'
      ctx: Context
      scope: Scope
      /** Která práva agendy (a `finance.read`) platí V ROZSAHU adresy — na pobočce pro ni, na firmě za celou firmu. */
      prava: ReadonlySet<PravoJinychPlateb | 'finance.read'>
      /**
       * Vidí záznamy rozsahu? U `stav: 'ok'` vždy `true` (bez práva se sem
       * nedostane) — pole drží tvar smlouvy, ať se obrazovka nemusí ptát
       * na velikost množiny.
       */
      vidi: boolean
    }
  | { stav: 'neprihlasen' }
  | { stav: 'odepren' }

/**
 * Pustí, když má přihlášený v rozsahu z adresy aspoň jedno z
 * `PRAVA_CTENI_JINYCH_PLATEB`. Rozsah z adresy je jen návrh —
 * `resolveScope` ho ověří proti členství (cizí pobočka i firemní úroveň
 * pro člena pobočky = odepřeno).
 */
export async function zkusPristupJinymPlatbam(tenantId: string, rozsah: string): Promise<PristupJinePlatby> {
  let ctx: Context
  try {
    ctx = await requireContext(tenantId)
  } catch (duvod) {
    if (duvod instanceof NeprihlasenError) return { stav: 'neprihlasen' }
    if (duvod instanceof PristupOdepren) return { stav: 'odepren' }
    throw duvod
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return { stav: 'odepren' }

  // Na pobočce has_access s její id, na firmě s null (= za celou firmu).
  // Všechna práva najednou — osm rychlých dotazů souběžně, ne za sebou.
  const vysledky = await Promise.all(
    PRAVA_CTENI_JINYCH_PLATEB.map(async (pravo) => [pravo, await hasAccess(tenantId, pravo, scope.branchId)] as const),
  )
  const prava = new Set<PravoCteniJinychPlateb>(vysledky.filter(([, ma]) => ma).map(([pravo]) => pravo))
  if (prava.size === 0) return { stav: 'odepren' }

  return { stav: 'ok', ctx, scope, prava, vidi: true }
}

/**
 * Práva pro navigaci Financí na stránkách agendy (N24, `sestavNavigaci`
 * v lib/finance-navigace.ts): práva agendy a `finance.read` V ROZSAHU
 * adresy (`pristup.prava`) a k tomu Nákup a Faktury podle toho, jestli
 * je člověk má někde (`canSee`, stejně jako levý sloupec aplikace
 * v app/[rozsah]/nabidka.ts; Nákup jen se zapnutými Objednávkami).
 *
 * Obsluha jen s `jine_platby.zadat` tak v navigaci uvidí jen Jiné platby
 * — ne Přehled, Tržby ani Platby, kam by ji pustit nešlo. Navigace nic
 * nechrání (každá stránka si přístup ověří sama); jen nenabízí slepé
 * odkazy.
 */
export function pravaNavigaceFinanci(pristup: Extract<PristupJinePlatby, { stav: 'ok' }>): string[] {
  const prava: string[] = [...pristup.prava]
  if (isModuleActive(pristup.ctx, 'objednavky') && canSee(pristup.ctx, 'purchasing.read')) prava.push('purchasing.read')
  if (canSee(pristup.ctx, 'faktury.read')) prava.push('faktury.read')
  return prava
}

/**
 * Pobočky (z `kandidatu`), na kterých má přihlášený aspoň jedno z `prav`.
 *
 * Kandidáty dává volající — vždy pobočky TÉHLE firmy (`ctx.branches`).
 * `has_access` firemního člena nehlídá, jestli pobočka firmě patří, takže
 * cizí id by prošlo.
 *
 * Ptá se databáze na každou pobočku zvlášť (pravidlo 2 — rozhoduje
 * `app.has_access`, ne odvozování v aplikaci). Prázdný seznam práv nebo
 * poboček = prázdná množina.
 */
export async function pobockySPravem(
  tenantId: string,
  kandidati: readonly string[],
  prava: readonly Permission[],
): Promise<Set<string>> {
  if (prava.length === 0 || kandidati.length === 0) return new Set()
  const vysledky = await Promise.all(
    kandidati.map(async (branchId) => {
      const odpovedi = await Promise.all(prava.map((pravo) => hasAccess(tenantId, pravo, branchId)))
      return [branchId, odpovedi.some(Boolean)] as const
    }),
  )
  return new Set(vysledky.filter(([, ma]) => ma).map(([branchId]) => branchId))
}

/**
 * Vidí přihlášený záznamy téhle pobočky? Stejná otázka jako RLS
 * (`app.jine_platby_vidi`), položená v aplikaci — první linie pro místa
 * bez rozsahu v adrese (odkaz na originál dokladu).
 */
export async function vidiPobocku(tenantId: string, branchId: string): Promise<boolean> {
  return (await pobockySPravem(tenantId, [branchId], [...PRAVA_CTENI_JINYCH_PLATEB])).has(branchId)
}
