"use server";

import { redirect } from "next/navigation";

import { isDemoMode } from "@/lib/auth/session";
import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { findDemoUser } from "@/lib/demo-ucty";
import { assertAccess } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../ui";

export async function clenAkce(form: FormData) {
  const k = await nacistKontext(null);
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "team.manage", null);
      const membershipId = String(form.get("membershipId") ?? "");
      const venues = form.getAll("venue").map(String);
      if (membershipId) {
        if (form.has("status")) {
          await tx.q("update marketing.memberships set status = $2 where id = $1 and organization_id = $3", [membershipId, String(form.get("status")), k.organization.id]);
          return;
        }
        const role = await tx.one<{ id: string }>("select id from marketing.roles where organization_id = $1 and key = $2", [k.organization.id, String(form.get("roleKey"))]);
        if (!role) throw new Error("Role nenalezena.");
        await tx.q("update marketing.memberships set role_id = $2, scope = $3 where id = $1 and organization_id = $4", [membershipId, role.id, String(form.get("scope") ?? "venues"), k.organization.id]);
        await tx.q("delete from marketing.venue_access where membership_id = $1", [membershipId]);
        for (const v of venues) await tx.q("insert into marketing.venue_access (membership_id, venue_id) values ($1, $2)", [membershipId, v]);
        return;
      }
      // Pozvání
      let userId: string;
      if (isDemoMode()) {
        const u = findDemoUser(String(form.get("demoUser") ?? ""));
        if (!u) throw new Error("Vyberte demo účet.");
        userId = u.id;
        await tx.q("insert into marketing.profiles (user_id, email, display_name) values ($1, $2, $3) on conflict (user_id) do nothing", [u.id, u.email, u.name]);
      } else {
        const email = String(form.get("email") ?? "").trim().toLowerCase();
        if (!email) throw new Error("Zadejte e-mail.");
        userId = await pozvatPresSupabase(email);
        await tx.q("insert into marketing.profiles (user_id, email, display_name) values ($1, $2, $2) on conflict (user_id) do nothing", [userId, email]);
      }
      const role = await tx.one<{ id: string; is_owner: boolean }>("select id, is_owner from marketing.roles where organization_id = $1 and key = $2", [k.organization.id, String(form.get("roleKey"))]);
      if (!role || role.is_owner) throw new Error("Vlastníka nejde pozvat — vlastnictví se převádí zvlášť.");
      const m = await tx.one<{ id: string }>("insert into marketing.memberships (organization_id, user_id, role_id, scope, status, invited_by) values ($1, $2, $3, $4, 'active', $5) on conflict (organization_id, user_id) do update set status = 'active', role_id = excluded.role_id, scope = excluded.scope, deleted_at = null returning id",
        [k.organization.id, userId, role.id, String(form.get("scope") ?? "venues"), k.session.userId]);
      await tx.q("delete from marketing.venue_access where membership_id = $1", [m!.id]);
      for (const v of venues) await tx.q("insert into marketing.venue_access (membership_id, venue_id) values ($1, $2)", [m!.id, v]);
    });
  } catch (e) {
    redirect(`/nastaveni/tym?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/nastaveni/tym?ok=${encodeURIComponent("Uloženo.")}`);
}

/** Supabase: pozvánka e-mailem přes Auth (servisní klíč jen tady, na serveru). */
async function pozvatPresSupabase(email: string): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Chybí servisní klíč Supabase pro odeslání pozvánky.");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/prihlaseni` });
  if (error || !data.user) {
    // Už existuje? Najdi ho.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = list?.users.find((x) => x.email?.toLowerCase() === email);
    if (!u) throw new Error(`Pozvánku se nepodařilo odeslat: ${error?.message ?? "neznámá chyba"}`);
    return u.id;
  }
  return data.user.id;
}

export async function roleAkce(form: FormData) {
  const k = await nacistKontext(null);
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "team.manage", null);
      const roleId = String(form.get("roleId"));
      const perm = String(form.get("permission"));
      if (form.get("grant") === "1") await tx.q("insert into marketing.role_permissions (role_id, permission_key) values ($1, $2) on conflict do nothing", [roleId, perm]);
      else await tx.q("delete from marketing.role_permissions where role_id = $1 and permission_key = $2", [roleId, perm]);
    });
  } catch (e) {
    redirect(`/nastaveni/tym?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/nastaveni/tym?ok=${encodeURIComponent("Oprávnění upraveno.")}`);
}
