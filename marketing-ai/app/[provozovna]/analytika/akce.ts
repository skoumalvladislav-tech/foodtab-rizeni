"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { synchronizovatMetriky } from "@/lib/domena/metriky";
import { vytvoritUtmOdkaz } from "@/lib/domena/utm";

import { chybaDoAdresy } from "../../ui";

export async function synchronizovatAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  let n = 0;
  try {
    n = await withUser(k.session.userId, (tx) => synchronizovatMetriky(tx, k.organization.id, k.venue!.id));
  } catch (e) {
    redirect(`/${slug}/analytika?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/analytika?ok=${encodeURIComponent(`Načteno ${n} snímků metrik.`)}`);
}

export async function utmAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  try {
    await withUser(k.session.userId, (tx) => vytvoritUtmOdkaz(tx, {
      organizationId: k.organization.id, venueId: k.venue!.id, contentItemId: null, target: String(form.get("target")),
      source: String(form.get("source") ?? "instagram"), medium: String(form.get("medium") ?? "social"), campaign: String(form.get("campaign") ?? "").trim().toLowerCase().replace(/\s+/g, "-"),
    }));
  } catch (e) {
    redirect(`/${slug}/analytika?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/analytika?ok=${encodeURIComponent("Odkaz vytvořen.")}`);
}
