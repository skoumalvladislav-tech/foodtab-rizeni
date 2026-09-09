"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { assertAccess } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../ui";

export async function duplikovatSablonuAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  let novy = "";
  try {
    novy = await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "templates.manage", k.venue!.id);
      const t = await tx.one<{ key: string; name: string; category: string; description: string; pillar: string }>("select key, name, category, description, pillar from marketing.templates where id = $1", [id]);
      if (!t) throw new Error("Šablona nenalezena.");
      const n = await tx.one<{ id: string }>(
        "insert into marketing.templates (organization_id, venue_id, key, name, category, description, pillar, parent_template_id, created_by) values ($1, null, $2, $3, $4, $5, $6, $7, $8) returning id",
        [k.organization.id, `${t.key}-${Date.now().toString(36)}`, `${t.name} (vlastní)`, t.category, t.description, t.pillar, id, k.session.userId]);
      await tx.q(
        `insert into marketing.template_versions (template_id, version, input_schema, layout, formats, text_rules, storyboard, brand_tokens, created_by)
         select $2, 1, input_schema, layout, formats, text_rules, storyboard, brand_tokens, $3 from marketing.template_versions where template_id = $1 order by version desc limit 1`, [id, n!.id, k.session.userId]);
      return n!.id;
    });
  } catch (e) {
    redirect(`/${slug}/sablony?sablona=${id}&chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/sablony?sablona=${novy}&ok=${encodeURIComponent("Vlastní kopie vytvořena. Upravte povolené části.")}`);
}

export async function ulozitSablonuAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "templates.manage", k.venue!.id);
      if (form.get("archiv") === "1") {
        await tx.q("update marketing.templates set archived_at = now() where id = $1 and organization_id = $2", [id, k.organization.id]);
        return;
      }
      await tx.q("update marketing.templates set name = $2, description = $3 where id = $1 and organization_id = $4", [id, String(form.get("name") ?? ""), String(form.get("description") ?? ""), k.organization.id]);
      const cur = await tx.one<{ version: number; input_schema: unknown; layout: unknown; text_rules: Record<string, unknown>; storyboard: unknown; brand_tokens: unknown }>("select * from marketing.template_versions where template_id = $1 order by version desc limit 1", [id]);
      if (!cur) throw new Error("Šablona nemá verzi.");
      const formats = form.getAll("formats").map(String);
      const text_rules = { ...cur.text_rules, itemsPerSlide: Number(form.get("itemsPerSlide") ?? 5), minFontPx: Number(form.get("minFontPx") ?? 28) };
      await tx.q(
        "insert into marketing.template_versions (template_id, version, input_schema, layout, formats, text_rules, storyboard, brand_tokens, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, cur.version + 1, JSON.stringify(cur.input_schema), JSON.stringify(cur.layout), formats, JSON.stringify(text_rules), cur.storyboard ? JSON.stringify(cur.storyboard) : null, JSON.stringify(cur.brand_tokens), k.session.userId]);
    });
  } catch (e) {
    redirect(`/${slug}/sablony?sablona=${id}&chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/sablony?${form.get("archiv") === "1" ? "" : `sablona=${id}&`}ok=${encodeURIComponent("Uloženo.")}`);
}

export async function nastavitVychoziAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "templates.manage", k.venue!.id);
      await tx.q("insert into marketing.venue_template_defaults (venue_id, purpose, template_id) values ($1, $2, $3) on conflict (venue_id, purpose) do update set template_id = excluded.template_id", [k.venue!.id, String(form.get("purpose")), id]);
    });
  } catch (e) {
    redirect(`/${slug}/sablony?sablona=${id}&chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/sablony?sablona=${id}&ok=${encodeURIComponent("Nastaveno jako výchozí.")}`);
}
