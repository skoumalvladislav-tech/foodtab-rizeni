import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { bezpecnyCil } from "./auth/kam.ts";
import { getSession, type Session } from "./auth/session.ts";
import { withUser, type Tx } from "./db/index.ts";

/**
 * Autorizační vrstva — jediné místo, kde se řeší „smí to ten člověk?“.
 *
 * Rozhodnutí samo se tu nepočítá: dělá ho marketing.has_access v databázi,
 * tatáž funkce, kterou používají politiky RLS. Aplikace se jí jen ptá.
 *
 *  1. Provozovna z adresy je NÁVRH. Vždy se ověřuje proti členství.
 *  2. Při nejistotě se přístup odmítá.
 *  3. Kontrola tady nenahrazuje RLS; obě linie platí současně.
 */

export const PERMISSIONS = [
  "content.read", "content.create", "content.approve", "content.schedule", "content.publish",
  "media.read", "media.manage", "media.share", "menu.read", "menu.manage", "templates.manage",
  "brand.manage", "campaigns.manage", "analytics.read", "integrations.use", "integrations.manage",
  "team.manage", "audit.read", "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface Venue {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  color: string;
  timezone: string | null;
  is_active: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  onboarding: Record<string, unknown>;
  onboarding_done_at: string | null;
  is_demo: boolean;
}

export interface Kontext {
  session: Session;
  organization: Organization;
  venues: Venue[];
  venue: Venue | null;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  permissions: Set<string>;
  tz: string;
}

/** Adresa přihlášení, která si pamatuje, odkud člověk šel. */
export async function odkazNaPrihlaseni(): Promise<string> {
  const adresa = (await headers()).get("x-ftm-adresa") ?? "";
  const kam = bezpecnyCil(adresa);
  return kam !== "/" ? `/prihlaseni?kam=${encodeURIComponent(kam)}` : "/prihlaseni";
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect(await odkazNaPrihlaseni());
  return s;
}

/**
 * Načte organizaci a provozovny přihlášeného. Uživatel může být členem
 * víc organizací (multi-tenant), rozhraní pracuje s jednou — vybere se
 * podle cookie/parametru, jinak první.
 */
export const nacistKontext = cache(async function nacistKontext(provozovnaSlug?: string | null): Promise<Kontext> {
  const session = await requireSession();
  return withUser(session.userId, async (tx) => {
    const orgs = await tx.q<Organization & { role_key: string; role_name: string; is_owner: boolean }>(
      `select o.id, o.name, o.slug, o.timezone, o.onboarding, o.onboarding_done_at, o.is_demo,
              r.key as role_key, r.name as role_name, r.is_owner
         from marketing.memberships m
         join marketing.organizations o on o.id = m.organization_id
         join marketing.roles r on r.id = m.role_id
        where m.user_id = $1 and m.status = 'active' and m.deleted_at is null
        order by o.created_at`,
      [session.userId],
    );
    if (orgs.length === 0) redirect("/bez-organizace");

    // Provozovna z adresy určuje i organizaci — ale jen pokud na ni člověk vidí.
    let org = orgs[0];
    let venues: Venue[] = [];
    let venue: Venue | null = null;
    for (const o of orgs) {
      const vs = await tx.q<Venue>(
        `select v.id, v.organization_id, v.name, v.slug, v.color, v.timezone, v.is_active
           from marketing.venues v
          where v.organization_id = $1 and v.id in (select marketing.visible_venue_ids($1))
          order by v.name`,
        [o.id],
      );
      const hit = provozovnaSlug ? vs.find((v) => v.slug === provozovnaSlug) : undefined;
      if (hit || (!provozovnaSlug && o === orgs[0])) {
        org = o;
        venues = vs;
        venue = hit ?? null;
        if (hit) break;
      }
    }
    if (provozovnaSlug && !venue) {
      // Neexistuje nebo na ni člověk nevidí — obojí je pro něj totéž.
      redirect("/");
    }
    if (!provozovnaSlug && venues.length === 0) {
      const vs = await tx.q<Venue>(
        `select v.id, v.organization_id, v.name, v.slug, v.color, v.timezone, v.is_active
           from marketing.venues v where v.organization_id = $1 and v.id in (select marketing.visible_venue_ids($1)) order by v.name`,
        [org.id],
      );
      venues = vs;
    }

    const perms = await tx.q<{ permission_key: string }>(
      `select rp.permission_key
         from marketing.memberships m join marketing.role_permissions rp on rp.role_id = m.role_id
        where m.user_id = $1 and m.organization_id = $2 and m.status = 'active' and m.deleted_at is null`,
      [session.userId, org.id],
    );
    const permissions = new Set(org.is_owner ? [...PERMISSIONS] : perms.map((p) => p.permission_key));

    return {
      session,
      organization: { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, onboarding: org.onboarding, onboarding_done_at: org.onboarding_done_at, is_demo: org.is_demo },
      venues,
      venue,
      roleKey: org.role_key,
      roleName: org.role_name,
      isOwner: org.is_owner,
      permissions,
      tz: venue?.timezone ?? org.timezone ?? "Europe/Prague",
    };
  });
});

/** Dotaz do databáze: má přihlášený uživatel právo v daném rozsahu? */
export async function hasAccess(tx: Tx, organizationId: string, permission: Permission, venueId: string | null): Promise<boolean> {
  const r = await tx.one<{ ok: boolean }>("select marketing.has_access($1, $2, $3) as ok", [organizationId, permission, venueId]);
  return r?.ok === true;
}

export class PristupOdmitnut extends Error {
  constructor(message = "Na tuhle akci nemáte oprávnění.") {
    super(message);
    this.name = "PristupOdmitnut";
  }
}

/** Server action / API: ověří právo proti databázi, jinak vyhodí. */
export async function assertAccess(tx: Tx, organizationId: string, permission: Permission, venueId: string | null): Promise<void> {
  if (!(await hasAccess(tx, organizationId, permission, venueId))) throw new PristupOdmitnut();
}

/** Rychlá kontrola pro rozhraní (schování tlačítka). Není to ochrana. */
export function muze(k: Kontext, permission: Permission): boolean {
  return k.isOwner || k.permissions.has(permission);
}
