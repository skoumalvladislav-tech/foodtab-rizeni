import { NextResponse, type NextRequest } from "next/server";

import { withService } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { overitPodpis } from "@/lib/storage/podpis";

/**
 * Podání souboru média — jen s platným podpisem a do vypršení.
 * Cesta na disku se nikdy nebere z adresy; bere se z databáze podle ID.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const exp = req.nextUrl.searchParams.get("exp");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !overitPodpis(id, exp, sig)) {
    return NextResponse.json({ error: "Neplatný nebo prošlý odkaz." }, { status: 403 });
  }
  const asset = await withService((tx) => tx.one<{ storage_path: string; mime_type: string; original_filename: string }>(
    "select storage_path, mime_type, original_filename from marketing.media_assets where id = $1", [id]));
  if (!asset) return NextResponse.json({ error: "Nenalezeno." }, { status: 404 });
  const bytes = await (await getStorage()).get(asset.storage_path);
  if (!bytes) return NextResponse.json({ error: "Soubor chybí v úložišti." }, { status: 404 });
  const download = req.nextUrl.searchParams.get("stahnout") === "1";
  return new NextResponse(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": asset.mime_type,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...(asset.mime_type === "image/svg+xml" ? { "Content-Security-Policy": "script-src 'none'" } : {}),
      ...(download ? { "Content-Disposition": `attachment; filename="${asset.original_filename.replace(/[^A-Za-z0-9._-]/g, "_")}"` } : {}),
    },
  });
}
