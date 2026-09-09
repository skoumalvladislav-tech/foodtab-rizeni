"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { rozhodnout } from "@/lib/domena/obsah";

export async function hromadneAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const ids = form.getAll("req").map(String);
  const decision = String(form.get("decision")) as "approved" | "changes_requested";
  const comment = String(form.get("comment") ?? "").trim();
  if (ids.length === 0) redirect(`/${slug}/schvalovani?chyba=${encodeURIComponent("Nic není vybrané.")}`);
  if (decision === "changes_requested" && !comment) redirect(`/${slug}/schvalovani?chyba=${encodeURIComponent("U vrácení napište, co se má změnit.")}`);
  const vysledky: string[] = [];
  for (const id of ids) {
    try {
      await withUser(k.session.userId, (tx) => rozhodnout(tx, { requestId: id, userId: k.session.userId, decision, comment }));
      vysledky.push("ok");
    } catch (e) {
      vysledky.push(e instanceof Error ? e.message : "chyba");
    }
  }
  const ok = vysledky.filter((x) => x === "ok").length;
  const chyby = vysledky.filter((x) => x !== "ok");
  redirect(`/${slug}/schvalovani?${chyby.length ? "pozor" : "ok"}=${encodeURIComponent(`Souhrn: ${ok} z ${ids.length} ${decision === "approved" ? "schváleno" : "vráceno"}.${chyby.length ? " Chyby: " + chyby.join("; ") : ""}`)}`);
}
