import { NextResponse } from "next/server";

import { withService } from "@/lib/db";

/** Krátký UTM odkaz → počítadlo kliknutí → přesměrování. Jen http(s) cíle. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[0-9a-f]{8}$/.test(code)) return NextResponse.json({ error: "Neplatný odkaz." }, { status: 404 });
  const row = await withService((tx) => tx.one<{ target_url: string }>("update marketing.utm_links set clicks = clicks + 1 where short_code = $1 returning target_url", [code]));
  if (!row) return NextResponse.json({ error: "Odkaz nenalezen." }, { status: 404 });
  let target: URL;
  try {
    target = new URL(row.target_url);
  } catch {
    return NextResponse.json({ error: "Neplatný cíl." }, { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return NextResponse.json({ error: "Neplatný cíl." }, { status: 400 });
  return NextResponse.redirect(target.toString(), 302);
}
