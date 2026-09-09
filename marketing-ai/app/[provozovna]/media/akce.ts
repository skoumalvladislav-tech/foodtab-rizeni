"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { archivovatMedium, nahratMedium, obnovitMedium, oznacitHero, presunoutMedium, upravitMedium } from "@/lib/domena/media";

import { chybaDoAdresy } from "../../ui";

export async function nahratAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  const soubory = form.getAll("soubory").filter((f): f is File => f instanceof File && f.size > 0);
  if (soubory.length === 0) redirect(`/${slug}/media?chyba=${encodeURIComponent("Vyberte aspoň jeden soubor.")}`);
  const slozka = String(form.get("slozka") ?? "");
  const sdilene = slozka === "sdilene";
  const tags = String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const vysledky: string[] = [];
  let chyby = 0;
  for (const f of soubory) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await withUser(k.session.userId, (tx) => nahratMedium(tx, {
        organizationId: k.organization.id, venueId: sdilene ? null : v.id, userId: k.session.userId, filename: f.name, mime: f.type || "application/octet-stream",
        bytes, collectionKey: sdilene ? "sdilene" : slozka, tags,
        author: String(form.get("author") ?? "") || undefined, license: String(form.get("license") ?? "") || undefined, usableUntil: String(form.get("usable_until") ?? "") || null,
      }));
      vysledky.push(r.duplicate ? `${f.name}: už v knihovně (${r.duplicate})` : `${f.name}: nahráno`);
    } catch (e) {
      chyby++;
      vysledky.push(`${f.name}: ${e instanceof Error ? e.message : "chyba"}`);
    }
  }
  redirect(`/${slug}/media?${chyby ? "pozor" : "ok"}=${encodeURIComponent(vysledky.join(" · "))}`);
}

export async function upravitAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  try {
    await withUser(k.session.userId, async (tx) => {
      const hero = form.get("hero");
      const archiv = form.get("archiv");
      if (hero !== null) { await oznacitHero(tx, id, hero === "1"); return; }
      if (archiv !== null) { if (archiv === "1") await archivovatMedium(tx, id); else await obnovitMedium(tx, id); return; }
      await upravitMedium(tx, id, {
        title: String(form.get("title") ?? "") || undefined, description: String(form.get("description") ?? ""), collectionKey: String(form.get("slozka") ?? "") || null,
        tags: String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        author: String(form.get("author") ?? ""), license: String(form.get("license") ?? ""), consentNote: String(form.get("consent") ?? ""), usableUntil: String(form.get("usable_until") ?? "") || null,
      });
    });
  } catch (e) {
    redirect(`/${slug}/media/${id}?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/media/${id}?ok=${encodeURIComponent("Uloženo.")}`);
}

export async function presunoutAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  let novy = id;
  try {
    novy = await withUser(k.session.userId, (tx) => presunoutMedium(tx, id, String(form.get("cil") ?? "") || null, form.get("kopie") === "1"));
  } catch (e) {
    redirect(`/${slug}/media/${id}?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/media/${novy}?ok=${encodeURIComponent("Hotovo.")}`);
}
