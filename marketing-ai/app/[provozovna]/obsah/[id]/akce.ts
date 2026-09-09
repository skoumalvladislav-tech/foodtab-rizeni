"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { zopakovatPublikaci, zpracovatFrontu } from "@/lib/domena/fronta";
import { duplikovat, nacistAktualniVerzi, naplanovat, novaVerze, obnovitVerzi, pozadatOSchvaleni, prepracovat, rozhodnout, spustitRender, vybratVariantu, zrusitPlan } from "@/lib/domena/obsah";
import { AiZpetnaVazbaSchema } from "@/lib/providers/ai/schema";

import { chybaDoAdresy } from "../../../ui";

function zpet(slug: string, itemId: string, q: string) {
  redirect(`/${slug}/obsah/${itemId}?${q}`);
}

async function proved(form: FormData, fn: (userId: string, tz: string) => Promise<string>) {
  const slug = String(form.get("slug"));
  const itemId = String(form.get("itemId"));
  const k = await nacistKontext(slug);
  let ok = "";
  try {
    ok = await fn(k.session.userId, k.tz);
  } catch (e) {
    zpet(slug, itemId, `chyba=${chybaDoAdresy(e)}`);
  }
  zpet(slug, itemId, `ok=${encodeURIComponent(ok)}`);
}

export async function vybratVariantuAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => { await vybratVariantu(tx, String(form.get("itemId")), uid, String(form.get("klic"))); return "Varianta použita (nová verze)."; }));
}

export async function prepracovatAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    const zv = AiZpetnaVazbaSchema.parse({ typ: form.get("typ"), cast: form.get("cast") || "vse", text: form.get("text") ?? "", variantaKlic: null });
    await prepracovat(tx, { itemId: String(form.get("itemId")), userId: uid, zpetnaVazba: zv });
    return "Přepracováno — vznikla nová verze.";
  }));
}

export async function ulozitUpravyAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    const itemId = String(form.get("itemId"));
    const cur = await nacistAktualniVerzi(tx, itemId);
    if (!cur) throw new Error("Obsah nemá verzi.");
    const title = String(form.get("title") ?? "").trim();
    if (title) await tx.q("update marketing.content_items set title = $2 where id = $1", [itemId, title]);
    const media = form.getAll("media").map(String).filter(Boolean);
    const cover = String(form.get("cover") ?? "") || media[0] || null;
    const inputs: Record<string, unknown> = { ...cur.inputs };
    const price = String(form.get("in_price") ?? "");
    inputs.price = price === "" ? undefined : Number(price);
    const date = String(form.get("in_date") ?? "");
    if (date) inputs.date = date; else delete inputs.date;
    const t = String(form.get("in_title") ?? "").trim();
    if (t) inputs.title = t;
    inputs.titulky = form.get("titulky") === "on";
    inputs.hudba = form.get("hudba") === "on";
    inputs.voiceover = form.get("voiceover") === "on";
    const cta = String(form.get("cta") ?? "").trim();
    const texts = {
      ...cur.texts,
      instagram: { ...(cur.texts.instagram ?? { hashtags: [], cta: "" }), caption: String(form.get("ig_caption") ?? ""), hashtags: String(form.get("ig_hashtags") ?? "").split(/\s+/).filter((h) => h.startsWith("#")), cta: cta || cur.texts.instagram?.cta || "" },
      facebook: { ...(cur.texts.facebook ?? { hashtags: [], cta: "" }), caption: String(form.get("fb_caption") ?? ""), cta: cta || cur.texts.facebook?.cta || "" },
    };
    let storyboard = cur.storyboard as { poradi: number; sekundy: number; textVObraze: string; titulek: string }[] | null;
    if (Array.isArray(storyboard)) {
      storyboard = storyboard.map((s) => ({
        ...s,
        sekundy: Number(form.get(`sc_${s.poradi}_sekundy`) ?? s.sekundy) || s.sekundy,
        textVObraze: String(form.get(`sc_${s.poradi}_text`) ?? s.textVObraze),
        titulek: String(form.get(`sc_${s.poradi}_titulek`) ?? s.titulek),
      }));
    }
    const id = await novaVerze(tx, { itemId, userId: uid, note: String(form.get("note") ?? "") || "Ruční úprava", changes: { inputs, texts, media_asset_ids: media, cover_asset_id: cover, storyboard } });
    return id === cur.id ? "Beze změny — nová verze nevznikla." : "Uloženo jako nová verze.";
  }));
}

export async function renderAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    const r = await spustitRender(tx, { versionId: String(form.get("versionId")), variantId: String(form.get("variantId")), userId: uid, force: true });
    if (r.status === "failed") throw new Error(r.error ?? "Render selhal.");
    return r.status === "submitted" ? "Render odeslán poskytovateli, výsledek dorazí za chvíli." : "Vykresleno.";
  }));
}

export async function prepnoutVariantuAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    await tx.q("update marketing.content_variants set is_enabled = $2 where id = $1", [String(form.get("variantId")), form.get("enabled") === "1"]);
    return "Výstup přepnut.";
  }));
}

export async function pozadatAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => { await pozadatOSchvaleni(tx, { itemId: String(form.get("itemId")), userId: uid, summary: String(form.get("summary") ?? "") }); return "Žádost o schválení odeslána."; }));
}

export async function rozhodnoutAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    const decision = String(form.get("decision")) as "approved" | "rejected" | "changes_requested";
    const comment = String(form.get("comment") ?? "").trim();
    if (decision !== "approved" && !comment) throw new Error("U vrácení nebo zamítnutí napište, co se má změnit.");
    await rozhodnout(tx, { requestId: String(form.get("requestId")), userId: uid, decision, comment });
    return { approved: "Schváleno.", rejected: "Zamítnuto.", changes_requested: "Vráceno k úpravě." }[decision];
  }));
}

export async function naplanovatAkce(form: FormData) {
  await proved(form, (uid, tz) => withUser(uid, async (tx) => {
    const ted = form.get("rezim") === "ted";
    const r = await naplanovat(tx, { itemId: String(form.get("itemId")), userId: uid, datum: ted ? null : String(form.get("datum")), cas: ted ? null : String(form.get("cas")), tz });
    let msg = ted ? "Zařazeno ke zveřejnění." : `Naplánováno na ${r.scheduledAt.toLocaleString("cs-CZ", { timeZone: tz })}.`;
    if (r.warnings.length) msg += " " + r.warnings.join(" ");
    if (ted) {
      const b = await zpracovatFrontu();
      msg += ` Výsledek: ${b.publikace.published} zveřejněno, ${b.publikace.mock} demo (published_mock), ${b.publikace.manual} k ručnímu zveřejnění, ${b.publikace.retried + b.publikace.dead} selhalo.`;
    }
    return msg;
  }));
}

export async function zrusitPlanAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => { await zrusitPlan(tx, String(form.get("itemId"))); return "Naplánování zrušeno."; }));
}

export async function zopakovatAkce(form: FormData) {
  await proved(form, async (uid) => {
    await withUser(uid, (tx) => zopakovatPublikaci(tx, String(form.get("jobId"))));
    const b = await zpracovatFrontu();
    return `Zopakováno: ${b.publikace.published + b.publikace.mock} zveřejněno, ${b.publikace.manual} k ručnímu zveřejnění, ${b.publikace.retried + b.publikace.dead} selhalo.`;
  });
}

export async function zpracovatFrontuAkce(form: FormData) {
  await proved(form, async () => {
    const b = await zpracovatFrontu();
    return `Fronta zpracována: ${b.publikace.published + b.publikace.mock} zveřejněno, ${b.publikace.manual} ručně, ${b.publikace.retried} k opakování, ${b.publikace.dead} vyčerpáno; rendery hotovo ${b.rendery.done}.`;
  });
}

export async function komentarAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => {
    const itemId = String(form.get("itemId"));
    const it = await tx.one<{ organization_id: string; current_version_id: string | null }>("select organization_id, current_version_id from marketing.content_items where id = $1", [itemId]);
    if (!it) throw new Error("Obsah nenalezen.");
    await tx.q("insert into marketing.comments (organization_id, content_item_id, content_version_id, author_id, part, body) values ($1, $2, $3, $4, $5, $6)",
      [it.organization_id, itemId, it.current_version_id, uid, String(form.get("part") ?? "") || null, String(form.get("body") ?? "").trim()]);
    return "Komentář přidán.";
  }));
}

export async function obnovitVerziAkce(form: FormData) {
  await proved(form, (uid) => withUser(uid, async (tx) => { await obnovitVerzi(tx, String(form.get("itemId")), String(form.get("versionId")), uid); return "Verze obnovena jako nová verze."; }));
}

export async function duplikovatAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  let id = "";
  try {
    id = await withUser(k.session.userId, (tx) => duplikovat(tx, String(form.get("itemId")), k.session.userId));
  } catch (e) {
    zpet(slug, String(form.get("itemId")), `chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/obsah/${id}?ok=${encodeURIComponent("Kopie vytvořena.")}`);
}
