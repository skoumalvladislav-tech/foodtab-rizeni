import { NextResponse, type NextRequest } from "next/server";

import { chyba, jeCron } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { withService, withUser } from "@/lib/db";
import { navrhnout, oznacitSelhaniNavrhu } from "@/lib/domena/obsah";
import { overitPodpisWebhooku } from "@/lib/providers/workflow";

/**
 * Vytvoření AI návrhu pro obsah. Volá rozhraní (přihlášený uživatel)
 * nebo n8n (content-generation.json) s podpisem HMAC — pak se návrh
 * vytvoří jménem autora obsahu, aby platila jeho práva a RLS.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Neplatné ID." }, { status: 400 });
  const raw = await req.text();
  const podepsano = overitPodpisWebhooku(process.env.N8N_WEBHOOK_SECRET ?? "", req.headers.get("x-foodtab-timestamp"), req.headers.get("x-foodtab-signature"), raw);
  const s = podepsano || jeCron(req) ? null : await getSession();
  let userId = s?.userId ?? null;
  if (!userId && (podepsano || jeCron(req))) {
    const it = await withService((tx) => tx.one<{ created_by: string | null }>("select created_by from marketing.content_items where id = $1", [id]));
    userId = it?.created_by ?? null;
  }
  if (!userId) return NextResponse.json({ error: "Nepřihlášen nebo neplatný podpis." }, { status: 401 });
  try {
    const r = await withUser(userId, (tx) => navrhnout(tx, { itemId: id, userId: userId! }));
    return NextResponse.json({ ok: true, versionId: r.versionId, isMock: r.isMock, variants: r.navrh.varianty.map((v) => v.klic) });
  } catch (e) {
    // Stav se zapisuje až tady: transakce s návrhem se kvůli chybě
    // vrátila zpátky, takže by se v ní zápis neudržel.
    await oznacitSelhaniNavrhu(userId, id).catch(() => {});
    return chyba(e);
  }
}
