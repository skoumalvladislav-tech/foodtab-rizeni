import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { branches, weeklyMenuDocuments } from "../../../db/schema";
import { getBucket } from "../../../storage";
import {
  authErrorResponse,
  authorizeFoodtabRequest,
} from "../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1)
    return Response.json({ error: "Neplatný dokument." }, { status: 400 });

  try {
    const user = await authorizeFoodtabRequest(request, "menus");
    const db = getDb();
    const [document] = await db
      .select()
      .from(weeklyMenuDocuments)
      .where(eq(weeklyMenuDocuments.id, id))
      .limit(1);
    if (!document)
      return Response.json(
        { error: "Dokument nebyl nalezen." },
        { status: 404 },
      );
    if (
      !user.isAdministrator &&
      user.profile.branch_id !== "company" &&
      document.branchId !== user.profile.branch_id
    ) {
      return Response.json(
        { error: "K menu této pobočky nemáte přístup." },
        { status: 403 },
      );
    }

    const object = await getBucket().get(document.objectKey);
    if (!object)
      return Response.json(
        { error: "Soubor nebyl nalezen v úložišti." },
        { status: 404 },
      );

    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/pdf",
        "content-length": String(object.size),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorizeFoodtabRequest(request, "menus");
    const form = await request.formData();
    const file = form.get("file");
    const branchId = String(form.get("branchId") || "")
      .trim()
      .slice(0, 80);
    const weekLabel = String(form.get("weekLabel") || "")
      .trim()
      .slice(0, 100);
    const source =
      String(form.get("source")) === "ai_agent" ? "ai_agent" : "dashboard";

    if (!(file instanceof File) || !branchId || !weekLabel) {
      return Response.json(
        { error: "Vyberte pobočku, týden a PDF soubor." },
        { status: 400 },
      );
    }
    if (
      !user.isAdministrator &&
      user.profile.branch_id !== "company" &&
      branchId !== user.profile.branch_id
    ) {
      return Response.json(
        { error: "Do této pobočky nemáte právo nahrávat menu." },
        { status: 403 },
      );
    }
    if (file.size < 5 || file.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: "PDF musí mít velikost od 5 B do 10 MB." },
        { status: 400 },
      );
    }
    const signature = new TextDecoder().decode(
      await file.slice(0, 5).arrayBuffer(),
    );
    if (file.type !== "application/pdf" || signature !== "%PDF-") {
      return Response.json(
        { error: "Nahrát lze pouze platný PDF dokument." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    if (!branch)
      return Response.json(
        { error: "Pobočka nebyla nalezena." },
        { status: 404 },
      );

    const safeFileName =
      file.name
        .replace(/[^a-zA-Z0-9._\-áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]/g, "_")
        .slice(0, 160) || "tydenni-menu.pdf";
    const objectKey = `weekly-menus/${branchId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
    const bucket = getBucket();
    await bucket.put(objectKey, file.stream(), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { branchId, weekLabel, source, uploadedBy: user.email },
    });

    try {
      const [document] = await db
        .insert(weeklyMenuDocuments)
        .values({
          branchId,
          weekLabel,
          fileName: safeFileName,
          objectKey,
          fileSize: file.size,
          source,
          status: "ready",
          active: true,
          uploadedBy: user.email,
        })
        .returning();
      await db
        .update(weeklyMenuDocuments)
        .set({ active: false })
        .where(
          and(
            eq(weeklyMenuDocuments.branchId, branchId),
            ne(weeklyMenuDocuments.id, document.id),
          ),
        );
      return Response.json({ document });
    } catch (error) {
      await bucket.delete(objectKey);
      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
