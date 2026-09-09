"use server";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { presunoutTermin } from "@/lib/domena/obsah";

export async function presunoutAkce(p: { slug: string; itemId: string; datum: string; cas: string }): Promise<{ ok: boolean; error?: string }> {
  const k = await nacistKontext(p.slug);
  try {
    await withUser(k.session.userId, (tx) => presunoutTermin(tx, { itemId: p.itemId, userId: k.session.userId, datum: p.datum, cas: p.cas, tz: k.tz }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba" };
  }
}
