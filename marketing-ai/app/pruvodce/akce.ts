"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { zalozitVychoziPreference } from "@/lib/domena/integrace";

import { chybaDoAdresy } from "../ui";

export async function dokoncitPruvodceAkce(form: FormData) {
  const k = await nacistKontext(null);
  const odpovedi = {
    tvorba: form.getAll("tvorba").map(String).join(","), provozoven: String(form.get("provozoven") ?? ""), priorita: String(form.get("priorita") ?? ""),
    publikace: String(form.get("publikace") ?? ""), ucty: String(form.get("ucty") ?? ""), ucet: form.getAll("ucet").map(String).join(","),
  };
  try {
    await withUser(k.session.userId, async (tx) => {
      const ok = await tx.one<{ ok: boolean }>("select marketing.has_access($1, 'settings.manage', null) as ok", [k.organization.id]);
      if (!ok?.ok) throw new Error("Průvodce může dokončit jen správce organizace.");
      await tx.q("update marketing.organizations set onboarding = $2, onboarding_done_at = coalesce(onboarding_done_at, now()) where id = $1", [k.organization.id, JSON.stringify(odpovedi)]);
      await zalozitVychoziPreference(tx, k.organization.id);
    });
  } catch (e) {
    redirect(`/pruvodce?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(k.venues[0] ? `/${k.venues[0].slug}/prehled?ok=${encodeURIComponent("Nastavení uloženo. Nástroje připojíte v Integracích.")}` : "/nastaveni/integrace");
}
