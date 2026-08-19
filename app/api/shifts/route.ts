import { and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { shifts } from "../../../db/schema";
import {
  authErrorResponse,
  authorizeFoodtabRequest,
  type AuthorizedFoodtabUser,
} from "../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

function isDepartment(value: unknown): value is "bar" | "kuchyne" {
  return value === "bar" || value === "kuchyne";
}
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const monthRe = /^\d{4}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}$/;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function canSeeBranch(user: AuthorizedFoodtabUser, branchId: string) {
  return (
    user.isAdministrator ||
    user.profile.branch_id === "company" ||
    user.profile.branch_id === branchId
  );
}

function canManageShifts(user: AuthorizedFoodtabUser) {
  return user.isAdministrator || user.profile.permissions.includes("shifts");
}

function nextMonthStart(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const ny = mon === 12 ? year + 1 : year;
  const nm = mon === 12 ? 1 : mon + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export async function GET(request: Request) {
  try {
    const user = await authorizeFoodtabRequest(request, "attendance");
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? "";
    const month = url.searchParams.get("month") ?? "";

    if (!branchId || !monthRe.test(month)) {
      return Response.json(
        { error: "Zadejte pobočku a měsíc ve formátu RRRR-MM." },
        { status: 400 },
      );
    }
    if (!canSeeBranch(user, branchId)) {
      return Response.json(
        { error: "K rozpisu směn této pobočky nemáte přístup." },
        { status: 403 },
      );
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.branchId, branchId),
          gte(shifts.shiftDate, `${month}-01`),
          lt(shifts.shiftDate, nextMonthStart(month)),
        ),
      );

    let roster: { userId: string; fullName: string; email: string; role: string }[] | undefined;
    if (canManageShifts(user)) {
      const { data, error } = await user.supabase
        .from("user_access")
        .select("user_id,full_name,email,role")
        .eq("branch_id", branchId)
        .eq("status", "approved");
      if (!error && data) {
        roster = data.map((row) => ({
          userId: row.user_id as string,
          fullName: row.full_name as string,
          email: row.email as string,
          role: row.role as string,
        }));
      }
    }

    return Response.json({ shifts: rows, roster });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorizeFoodtabRequest(request, "shifts");
    const payload = (await request.json()) as {
      action?: "create" | "update" | "delete";
      id?: number;
      branchId?: string;
      department?: "bar" | "kuchyne";
      shiftDate?: string;
      startTime?: string;
      endTime?: string;
      note?: string;
      employeeSource?: "registered" | "new";
      employeeUserId?: string;
      employeeName?: string;
      employeeEmail?: string;
    };

    const db = getDb();

    if (payload.action === "delete") {
      const id = Number(payload.id);
      if (!Number.isInteger(id)) {
        return Response.json({ error: "Neplatná směna." }, { status: 400 });
      }
      const [existing] = await db
        .select()
        .from(shifts)
        .where(eq(shifts.id, id))
        .limit(1);
      if (!existing) {
        return Response.json({ error: "Směna nebyla nalezena." }, { status: 404 });
      }
      if (!canSeeBranch(user, existing.branchId)) {
        return Response.json(
          { error: "K této směně nemáte přístup." },
          { status: 403 },
        );
      }
      await db.delete(shifts).where(eq(shifts.id, id));
      return Response.json({ ok: true });
    }

    if (payload.action === "create" || payload.action === "update") {
      const branchId = payload.branchId?.trim().slice(0, 80) ?? "";
      const department = payload.department;
      const shiftDate = payload.shiftDate?.trim() ?? "";
      const startTime = payload.startTime?.trim() ?? "";
      const endTime = payload.endTime?.trim() ?? "";
      const note = payload.note?.trim().slice(0, 500) ?? "";

      if (
        !branchId ||
        !isDepartment(department) ||
        !dateRe.test(shiftDate) ||
        !timeRe.test(startTime) ||
        !timeRe.test(endTime)
      ) {
        return Response.json(
          { error: "Doplňte pobočku, středisko, datum a časy směny." },
          { status: 400 },
        );
      }
      if (!canSeeBranch(user, branchId)) {
        return Response.json(
          { error: "K rozpisu směn této pobočky nemáte přístup." },
          { status: 403 },
        );
      }

      let existing: typeof shifts.$inferSelect | undefined;
      if (payload.action === "update") {
        const id = Number(payload.id);
        if (!Number.isInteger(id)) {
          return Response.json({ error: "Neplatná směna." }, { status: 400 });
        }
        const [row] = await db
          .select()
          .from(shifts)
          .where(eq(shifts.id, id))
          .limit(1);
        if (!row) {
          return Response.json(
            { error: "Směna nebyla nalezena." },
            { status: 404 },
          );
        }
        if (!canSeeBranch(user, row.branchId)) {
          return Response.json(
            { error: "K této směně nemáte přístup." },
            { status: 403 },
          );
        }
        existing = row;
      }

      let employeeUserId: string | null = null;
      let employeeName = "";
      let employeeEmail = "";
      let isPlaceholder = true;

      if (payload.employeeSource === "registered") {
        const registeredId = payload.employeeUserId?.trim() ?? "";
        if (!registeredId) {
          return Response.json(
            { error: "Vyberte registrovaného zaměstnance." },
            { status: 400 },
          );
        }
        const { data, error } = await user.supabase
          .from("user_access")
          .select("user_id,full_name,email")
          .eq("user_id", registeredId)
          .eq("status", "approved")
          .single();
        if (error || !data) {
          return Response.json(
            { error: "Zaměstnanec nebyl nalezen." },
            { status: 400 },
          );
        }
        employeeUserId = data.user_id as string;
        employeeName = data.full_name as string;
        employeeEmail = (data.email as string).trim().toLowerCase();
        isPlaceholder = false;
      } else if (payload.employeeSource === "new") {
        const name = payload.employeeName?.trim().slice(0, 100) ?? "";
        const emailInput = payload.employeeEmail?.trim().toLowerCase() ?? "";
        if (!name || !emailRe.test(emailInput)) {
          return Response.json(
            { error: "Zadejte jméno a platný e-mail nového zaměstnance." },
            { status: 400 },
          );
        }
        employeeName = name;
        employeeEmail = emailInput;
        isPlaceholder = true;
        const { data } = await user.supabase
          .from("user_access")
          .select("user_id")
          .eq("email", emailInput)
          .eq("status", "approved")
          .maybeSingle();
        if (data) {
          employeeUserId = data.user_id as string;
          isPlaceholder = false;
        }
      } else {
        return Response.json(
          { error: "Vyberte zdroj zaměstnance." },
          { status: 400 },
        );
      }

      const values = {
        branchId,
        department,
        shiftDate,
        startTime,
        endTime,
        employeeUserId,
        employeeName,
        employeeEmail,
        isPlaceholder,
        note,
        createdBy: user.email,
        updatedAt: new Date().toISOString(),
      };

      if (payload.action === "update" && existing) {
        const [shift] = await db
          .update(shifts)
          .set(values)
          .where(eq(shifts.id, existing.id))
          .returning();
        return Response.json({ shift });
      }

      const [shift] = await db.insert(shifts).values(values).returning();
      return Response.json({ shift });
    }

    return Response.json({ error: "Neznámá operace." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
