"use server";

import { redirect } from "next/navigation";

import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { zopakovatPublikaci, zpracovatFrontu } from "@/lib/domena/fronta";

import { chybaDoAdresy } from "../../ui";

export async function zpracovatAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  if (!muze(k, "content.publish")) redirect(`/${slug}/publikace?chyba=${encodeURIComponent("Nemáte oprávnění.")}`);
  const b = await zpracovatFrontu();
  redirect(`/${slug}/publikace?ok=${encodeURIComponent(`Fronta: ${b.publikace.published} zveřejněno, ${b.publikace.mock} demo, ${b.publikace.manual} ručně, ${b.publikace.retried} k opakování, ${b.publikace.dead} vyčerpáno.`)}`);
}

export async function zopakovatAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  try {
    await withUser(k.session.userId, (tx) => zopakovatPublikaci(tx, String(form.get("jobId"))));
    await zpracovatFrontu();
  } catch (e) {
    redirect(`/${slug}/publikace?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/publikace?ok=${encodeURIComponent("Zopakováno.")}`);
}
