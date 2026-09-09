"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withService, withUser } from "@/lib/db";
import { odpojit, otestovat, ulozitKlic, vybratPoskytovatele } from "@/lib/domena/integrace";

import { chybaDoAdresy } from "../../ui";

const zpet = (q: string, provozovna?: string) => redirect(`/nastaveni/integrace?${provozovna ? `provozovna=${provozovna}&` : ""}${q}`);

export async function vybratAkce(form: FormData) {
  const provozovna = String(form.get("provozovna") ?? "") || undefined;
  const k = await nacistKontext(provozovna ?? null);
  const key = String(form.get("providerKey"));
  let r: { connectionId: string; needs: string } | null = null;
  try {
    r = await withUser(k.session.userId, (tx) => vybratPoskytovatele(tx, { organizationId: k.organization.id, venueId: provozovna ? k.venue!.id : null, providerKey: key, userId: k.session.userId }));
  } catch (e) {
    zpet(`chyba=${chybaDoAdresy(e)}`, provozovna);
  }
  if (r!.needs === "oauth") redirect(`/api/v1/meta/oauth/start?connection=${r!.connectionId}`);
  if (r!.needs === "none") zpet(`ok=${encodeURIComponent("Nástroj vybrán a aktivní.")}`, provozovna);
  zpet(`pripojit=${r!.connectionId}&ok=${encodeURIComponent("Nástroj vybrán. Zadejte klíč a otestujte spojení.")}`, provozovna);
}

export async function ulozitKlicAkce(form: FormData) {
  const k = await nacistKontext(null);
  const connectionId = String(form.get("connectionId"));
  const creds: Record<string, string> = {};
  for (const key of ["api_key", "webhook_secret", "env", "model", "base_url"]) {
    const v = String(form.get(key) ?? "");
    if (v) creds[key] = v;
  }
  let r: { ok: boolean; message: string };
  try {
    r = await withUser(k.session.userId, (tx) => ulozitKlic(tx, { connectionId, credentials: creds, userId: k.session.userId }));
  } catch (e) {
    zpet(`chyba=${chybaDoAdresy(e)}`);
    return;
  }
  zpet(r.ok ? `ok=${encodeURIComponent("Klíč uložen. " + r.message)}` : `pozor=${encodeURIComponent("Klíč uložen, ale test selhal: " + r.message)}`);
}

export async function otestovatAkce(form: FormData) {
  const k = await nacistKontext(null);
  let r: { ok: boolean; message: string };
  try {
    r = await withUser(k.session.userId, (tx) => otestovat(tx, String(form.get("connectionId"))));
  } catch (e) {
    zpet(`chyba=${chybaDoAdresy(e)}`);
    return;
  }
  zpet(r.ok ? `ok=${encodeURIComponent(r.message)}` : `pozor=${encodeURIComponent("Test selhal: " + r.message)}`);
}

export async function odpojitAkce(form: FormData) {
  const k = await nacistKontext(null);
  try {
    await withUser(k.session.userId, (tx) => odpojit(tx, String(form.get("connectionId")), k.session.userId));
  } catch (e) {
    zpet(`chyba=${chybaDoAdresy(e)}`);
  }
  zpet(`ok=${encodeURIComponent("Odpojeno. Tajemství smazáno, kategorie přepnuta na vestavěný nástroj. Obsah a historie zůstaly.")}`);
}

/** Orientační cena je globální údaj katalogu — mění ho správce (vlastník). */
export async function cenaAkce(form: FormData) {
  const k = await nacistKontext(null);
  if (!k.isOwner) zpet(`chyba=${encodeURIComponent("Jen vlastník organizace.")}`);
  await withService((tx) => tx.q("update marketing.provider_catalog set pricing_note = $2, pricing_url = $3, pricing_checked_at = current_date, updated_at = now() where key = $1",
    [String(form.get("providerKey")), String(form.get("pricing_note") ?? ""), String(form.get("pricing_url") ?? "") || null]));
  zpet(`ok=${encodeURIComponent("Orientační cena aktualizována s dnešním datem.")}`);
}
