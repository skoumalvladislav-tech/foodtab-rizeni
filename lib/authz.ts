import 'server-only'

import { cache } from 'react'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * =====================================================================
 * Autorizační vrstva Foodtabu
 * =====================================================================
 *
 * Tenhle soubor je jediné místo v aplikaci, kde se řeší „smí to ten
 * člověk vidět?“. Nikde jinde se taková podmínka psát nemá.
 *
 * Vlastní rozhodnutí se tu ale nepočítá — o něm rozhoduje databázová
 * funkce `app.has_access(firma, oprávnění, pobočka)`, kterou používají
 * i politiky Row Level Security. Kdyby si aplikace pravidla dopočítávala
 * sama, měli bychom je na dvou místech a časem by se rozešla: obrazovka
 * by se otevřela, ale data by nedorazila — nebo hůř, otevřela by se
 * někomu, komu neměla. (Pravidlo č. 2)
 *
 * Tři věci, které tu platí bez výjimky:
 *
 *  1. Pobočka z adresy je NÁVRH, ne oprávnění. Vždycky se ověřuje proti
 *     členství přihlášeného uživatele. Jinak stačí v URL přepsat jedno
 *     číslo. (Pravidlo č. 4)
 *
 *  2. Při jakékoli nejistotě se přístup ODMÍTÁ. Spadlé spojení, neznámé
 *     oprávnění, prázdná odpověď — všechno znamená ne.
 *
 *  3. Kontrola v aplikaci nenahrazuje RLS a RLS nenahrazuje ji. Obě
 *     linie platí současně. (Pravidlo č. 3)
 */

/* ---------------------------------------------------------------------
 * Oprávnění
 *
 * Seznam odpovídá tabulce `permissions` (migrace `..._catalog.sql`).
 * Je tu proto, aby překlep v názvu oprávnění spadl při psaní kódu,
 * ne až v provozu — a hlavně ne potichu.
 *
 * Když přidáváte oprávnění, přidáváte ho do migrace I sem. Že se to
 * rozešlo, pozná test `supabase/tests/krok3_scenar.sql` a řekne o tom
 * nahlas. Neznámý klíč by jinak jen tiše odmítal přístup a hledalo by
 * se to týden.
 * ------------------------------------------------------------------ */

export const PERMISSIONS = [
  // Provoz
  'shifts.read',
  'shifts.manage',
  'attendance.read',
  'attendance.manage',
  'tasks.read',
  'tasks.manage',
  'communication.read',
  'communication.manage',
  'recipes.read',
  'recipes.manage',
  'menus.read',
  'menus.manage',
  'ai.use',
  'motivation.read',
  'motivation.manage',
  'people.manage',
  'payroll.manage',
  'payroll.read',
  'payroll.export',
  // Vydávat peníze a vidět mzdy jsou dvě různé věci: vedoucí směny
  // u okénka potřebuje vydat dva tisíce, ne vidět, kolik kdo bere.
  'advances.manage',
  'approvals.decide',
  'agents.manage',
  'settings.manage',
  // Finance
  'finance.read',
  'finance.manage',
  'banking.read',
  // Marketing
  'marketing.read',
  'marketing.manage',
  'marketing.publish',
  // Objednávky
  'purchasing.read',
  'purchasing.manage',
  // Tvorba menu
  'menu_ai.use',
  'menu_ai.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Moduly. Pořadí odpovídá sort_order v databázi, `menu` stojí za
 * provozem — je to dílna na návrhy menu, ne místo, kde lístky bydlí.
 * Receptury a jídelní lístky zůstávají v provozu.
 */
export const MODULES = ['provoz', 'menu', 'finance', 'marketing', 'objednavky'] as const
export type ModuleKey = (typeof MODULES)[number]

/**
 * Paleta pro odlišení poboček. V databázi je uložený klíč, ne odstín —
 * konkrétní barvu určuje rozhraní, aby zůstala čitelná ve světlém
 * i tmavém režimu. Odpovídá podmínce na sloupci `branches.color`.
 */
export const BRANCH_COLORS = [
  'slate',
  'indigo',
  'violet',
  'sky',
  'teal',
  'emerald',
  'amber',
  'rose',
] as const

export type BranchColor = (typeof BRANCH_COLORS)[number]

/* ---------------------------------------------------------------------
 * Typy
 * ------------------------------------------------------------------ */

/** Úroveň zobrazení: celá firma, nebo jedna pobočka. */
export type ScopeLevel = 'tenant' | 'branch'

export type Scope = {
  level: ScopeLevel
  /** `null` znamená firemní úroveň. Stejně jako `branch_id` v databázi. */
  branchId: string | null
  branchName: string | null
  branchSlug: string | null
}

export type Branch = {
  id: string
  name: string
  slug: string
  color: BranchColor
  /**
   * Pásmo, ve kterém se u téhle pobočky ukazují časy.
   *
   * Chodí z `my_context` (migrace 20260902090000). Dokud není nasazená,
   * je `undefined` a obrazovky sáhnou po `ZONA_VYCHOZI` — nikdy po
   * pásmu serveru, to je právě ta chyba, kvůli které to vzniklo.
   */
  timezone?: string
}

/** Modul firmy. `active: false` = firma ho nemá — v rozcestníku zašedlý. */
export type Module = {
  key: ModuleKey
  label: string
  isBase: boolean
  active: boolean
}

export type Context = {
  tenant: { id: string; name: string; currency: string; timezone: string }
  membership: { scope: ScopeLevel; status: 'active' | 'suspended' }
  /**
   * `null` = člen čeká na přidělení oprávnění (docs/pozvanky-zadani.md).
   * Pozvánka smí přijít bez role; do aplikace ho to nepustí nikam —
   * `permissions` je prázdné a `app.has_access` vrací nepravdu pro
   * každé právo. Vykreslení musí ten rozdíl poznat, aby místo prázdného
   * rozcestníku ukázalo vysvětlení.
   */
  role: { id: string; key: string; label: string; isOwner: boolean } | null
  /** Všechny moduly Foodtabu, včetně těch, které firma nemá. */
  modules: Module[]
  /** Jen pobočky, na které uživatel doopravdy vidí. */
  branches: Branch[]
  /** Co má uživatel někde ve firmě. Slouží k VYKRESLENÍ, ne k pouštění dál. */
  permissions: Permission[]
}

/** Uživatel není přihlášený. Volající ho má poslat na přihlášení. */
export class NeprihlasenError extends Error {
  constructor() {
    super('Nejste přihlášeni.')
    this.name = 'NeprihlasenError'
  }
}

/** Uživatel je přihlášený, ale na tohle nemá právo. */
export class PristupOdepren extends Error {
  constructor(
    public readonly permission: string,
    public readonly branchId: string | null,
  ) {
    super('K téhle části Foodtabu nemáte přístup.')
    this.name = 'PristupOdepren'
  }
}

/** URL segment, kterým se v adrese pozná firemní úroveň: `/firma/smeny`. */
export const TENANT_SCOPE_SEGMENT = 'firma'

/* ---------------------------------------------------------------------
 * Kdo je přihlášený
 *
 * `getUser()` ověřuje token u Supabase, nespoléhá na obsah cookie.
 * Cookie umí kdokoli podvrhnout, podpis ne.
 *
 * `cache()` z Reactu drží výsledek po dobu jednoho požadavku, takže
 * i když se na uživatele zeptá pět komponent, dotaz odejde jednou.
 * ------------------------------------------------------------------ */

export type User = { id: string; email: string | null; phone: string | null }

export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  }
})

export async function requireUser(): Promise<User> {
  const user = await getUser()
  if (!user) throw new NeprihlasenError()
  return user
}

/* ---------------------------------------------------------------------
 * Do jaké firmy uživatel patří
 * ------------------------------------------------------------------ */

export type TenantSummary = {
  tenantId: string
  name: string
  roleKey: string
  roleLabel: string
  isOwner: boolean
  scope: ScopeLevel
}

export const getMyTenants = cache(async (): Promise<TenantSummary[]> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('my_tenants')
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((r) => ({
    tenantId: String(r.tenant_id),
    name: String(r.name),
    roleKey: String(r.role_key),
    roleLabel: String(r.role_label),
    isOwner: Boolean(r.is_owner),
    scope: r.scope === 'tenant' ? 'tenant' : 'branch',
  }))
})

/* ---------------------------------------------------------------------
 * Kontext firmy — podklad pro vykreslení
 *
 * Vrátí `null`, když uživatel do firmy nepatří nebo firma neexistuje.
 * Rozdíl mezi „nepatříš“ a „neexistuje“ schválně nerozlišujeme: jinak
 * by šlo zkoušením adres zjistit, které firmy Foodtab používají.
 * ------------------------------------------------------------------ */

export const getContext = cache(async (tenantId: string): Promise<Context | null> => {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('my_context', { p_tenant: tenantId })
  if (error || !data) return null

  const raw = data as {
    tenant: Context['tenant']
    membership: { scope: string; status: string }
    role: Context['role']
    modules: { key: string; label: string; isBase: boolean; active: boolean }[]
    branches: { id: string; name: string; slug: string; color: string }[]
    permissions: string[]
  }

  if (raw.membership?.status !== 'active') return null

  return {
    tenant: raw.tenant,
    membership: {
      scope: raw.membership.scope === 'tenant' ? 'tenant' : 'branch',
      status: 'active',
    },
    role: raw.role ?? null,
    modules: (raw.modules ?? []).filter((m): m is Module =>
      (MODULES as readonly string[]).includes(m.key),
    ),
    // Neznámý klíč barvy (třeba po ruční úpravě v databázi) spadne na
    // neutrální odstín. Pobočka se kvůli barvě nikdy nesmí nevykreslit.
    branches: (raw.branches ?? []).map((b) => ({
      ...b,
      color: ((BRANCH_COLORS as readonly string[]).includes(b.color)
        ? b.color
        : 'slate') as BranchColor,
    })),
    permissions: (raw.permissions ?? []).filter((p): p is Permission =>
      (PERMISSIONS as readonly string[]).includes(p),
    ),
  }
})

export async function requireContext(tenantId: string): Promise<Context> {
  await requireUser()
  const ctx = await getContext(tenantId)
  if (!ctx) throw new PristupOdepren('membership', null)
  return ctx
}

/* ---------------------------------------------------------------------
 * Rozsah z adresy
 *
 * Adresa vypadá takhle:
 *   /firma/smeny          → celá firma
 *   /cerna-perla/smeny    → jedna pobočka
 *
 * Slug z adresy se NEVĚŘÍ. Hledá se jen mezi pobočkami, které uživateli
 * vrátila databáze — kdo na pobočku nevidí, tomu neexistuje. Firemní
 * úroveň smí jen ten, kdo má rozsah členství `tenant`.
 * ------------------------------------------------------------------ */

export function resolveScope(ctx: Context, scopeParam?: string | null): Scope {
  const companyScope: Scope = {
    level: 'tenant',
    branchId: null,
    branchName: ctx.tenant.name,
    branchSlug: TENANT_SCOPE_SEGMENT,
  }

  // Bez určení: kdo vidí na celou firmu, začíná u firmy; ostatní
  // u své první pobočky.
  if (!scopeParam) {
    if (ctx.membership.scope === 'tenant') return companyScope
    const first = ctx.branches[0]
    if (!first) throw new PristupOdepren('scope', null)
    return {
      level: 'branch',
      branchId: first.id,
      branchName: first.name,
      branchSlug: first.slug,
    }
  }

  if (scopeParam === TENANT_SCOPE_SEGMENT) {
    // Vedoucí jedné pobočky se na firemní úroveň nedostane. Databáze by
    // ho odmítla taky, ale bez tohohle by mezitím uviděl prázdnou
    // obrazovku a nepochopil proč.
    if (ctx.membership.scope !== 'tenant') throw new PristupOdepren('scope', null)
    return companyScope
  }

  const branch = ctx.branches.find((b) => b.slug === scopeParam)
  if (!branch) throw new PristupOdepren('scope', null)

  return {
    level: 'branch',
    branchId: branch.id,
    branchName: branch.name,
    branchSlug: branch.slug,
  }
}

/* ---------------------------------------------------------------------
 * Vlastní kontrola přístupu
 *
 * Ptá se databáze pokaždé. Je to jeden rychlý dotaz a stojí za to:
 * odpověď pak vždycky odpovídá tomu, co povolí i RLS.
 * ------------------------------------------------------------------ */

export async function hasAccess(
  tenantId: string,
  permission: Permission,
  branchId: string | null = null,
): Promise<boolean> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('has_access', {
    p_tenant: tenantId,
    p_permission: permission,
    p_branch: branchId,
  })
  // Chyba spojení, neznámé oprávnění, cokoli nečekaného → ne.
  if (error) return false
  return data === true
}

/**
 * Kontrola, která se pouští na začátku stránky nebo serverové akce.
 * Když neprojde, dál se nic nenačítá.
 */
export async function requireAccess(
  tenantId: string,
  permission: Permission,
  branchId: string | null = null,
): Promise<void> {
  await requireUser()
  if (!(await hasAccess(tenantId, permission, branchId))) {
    throw new PristupOdepren(permission, branchId)
  }
}

/** Zkratka pro stránku, která si zároveň bere rozsah z adresy. */
export async function requireScopedAccess(
  tenantId: string,
  permission: Permission,
  scopeParam?: string | null,
): Promise<{ ctx: Context; scope: Scope }> {
  const ctx = await requireContext(tenantId)
  const scope = resolveScope(ctx, scopeParam)
  await requireAccess(tenantId, permission, scope.branchId)
  return { ctx, scope }
}

/* ---------------------------------------------------------------------
 * Moduly
 *
 * Vypnutý modul musí odmítnout i přímé volání svého rozhraní, ne jen
 * zmizet z menu. (Pravidlo č. 5)
 *
 * `app.has_access` aktivní modul kontroluje sama, takže `requireAccess`
 * na modul nesahá. `requireModule` je pro místa, kde se ještě žádné
 * konkrétní oprávnění neověřuje — třeba rozcestník modulu.
 * ------------------------------------------------------------------ */

export function isModuleActive(ctx: Context, module: ModuleKey): boolean {
  return ctx.modules.some((m) => m.key === module && m.active)
}

/** Moduly, které firma má. Pro navigaci. */
export function activeModules(ctx: Context): Module[] {
  return ctx.modules.filter((m) => m.active)
}

export async function requireModule(tenantId: string, module: ModuleKey): Promise<Context> {
  const ctx = await requireContext(tenantId)
  if (!isModuleActive(ctx, module)) throw new PristupOdepren(`module:${module}`, null)
  return ctx
}

/* ---------------------------------------------------------------------
 * Vykreslování
 *
 * VAROVÁNÍ: `canSee` NENÍ kontrola přístupu. Odpovídá na otázku
 * „má smysl tu položku vůbec kreslit?“ a neví nic o pobočce. Data se
 * podle něj vydat nesmí — od toho je `requireAccess`.
 *
 * Schované tlačítko není zámek. Zámek je až kontrola na serveru
 * a Row Level Security pod ní.
 * ------------------------------------------------------------------ */

export function canSee(ctx: Context, permission: Permission): boolean {
  return ctx.permissions.includes(permission)
}

export function canSeeAny(ctx: Context, permissions: Permission[]): boolean {
  return permissions.some((p) => canSee(ctx, p))
}
