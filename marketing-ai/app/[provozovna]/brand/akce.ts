"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { assertAccess } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../ui";

const list = (s: FormDataEntryValue | null) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const hex = (form: FormData, key: string) => {
  const h = String(form.get(`ch_${key}`) ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h : String(form.get(`c_${key}`) ?? "");
};

export async function ulozitBrandAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "brand.manage", v.id);
      const colors = { primary: hex(form, "primary"), secondary: hex(form, "secondary"), accent: hex(form, "accent"), background: hex(form, "background"), text: hex(form, "text") };
      const fonts = { heading: String(form.get("f_heading") ?? ""), body: String(form.get("f_body") ?? "") };
      const placement = { position: String(form.get("logo_position") ?? "bottom-right"), safe_zone_percent: Number(form.get("safe_zone") ?? 8) };
      const asset = (n: string) => String(form.get(n) ?? "") || null;
      await tx.q(
        `update marketing.brand_kits set name = $2, short_description = $3, colors = $4, fonts = $5, address = $6, phone = $7, website_url = $8, reservation_url = $9, ordering_url = $10,
           tone_of_voice = $11, preferred_ctas = $12, allowed_phrases = $13, forbidden_phrases = $14, default_hashtags = $15, signature = $16, logo_placement = $17,
           music_style = $18, voice_style = $19, default_video_seconds = $20, logo_light_asset_id = $21, logo_dark_asset_id = $22, reels_intro_asset_id = $23, reels_outro_asset_id = $24,
           is_demo = false, updated_by = $25
         where venue_id = $1`,
        [v.id, String(form.get("name") ?? "").trim(), String(form.get("short_description") ?? ""), JSON.stringify(colors), JSON.stringify(fonts),
          String(form.get("address") ?? ""), String(form.get("phone") ?? ""), String(form.get("website_url") ?? ""), String(form.get("reservation_url") ?? ""), String(form.get("ordering_url") ?? ""),
          String(form.get("tone_of_voice") ?? ""), list(form.get("preferred_ctas")), list(form.get("allowed_phrases")), list(form.get("forbidden_phrases")), list(form.get("default_hashtags")).map((h) => (h.startsWith("#") ? h : "#" + h)),
          String(form.get("signature") ?? ""), JSON.stringify(placement), String(form.get("music_style") ?? ""), String(form.get("voice_style") ?? ""), Number(form.get("default_video_seconds") ?? 15),
          asset("logo_light_asset_id"), asset("logo_dark_asset_id"), asset("reels_intro_asset_id"), asset("reels_outro_asset_id"), k.session.userId]);
      await tx.q("select marketing.audit($1, $2, 'brand.updated', 'brand_kit', $2::text)", [k.organization.id, v.id]);
    });
  } catch (e) {
    redirect(`/${slug}/brand?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/brand?ok=${encodeURIComponent("Brand kit uložen.")}`);
}
