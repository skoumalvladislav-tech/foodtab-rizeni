"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";

export async function precteneAkce() {
  const k = await nacistKontext(null);
  await withUser(k.session.userId, (tx) => tx.q("update marketing.notifications set read_at = now() where user_id = $1 and read_at is null", [k.session.userId]));
  redirect("/upozorneni");
}
