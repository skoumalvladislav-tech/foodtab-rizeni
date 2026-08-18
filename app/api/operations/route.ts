import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  announcements,
  assignedTasks,
  attendanceEvents,
  branches,
  menuItems,
  operationTasks,
  recipes,
  weeklyMenuDocuments,
} from "../../../db/schema";
import {
  authErrorResponse,
  authorizeFoodtabRequest,
  type AuthorizedFoodtabUser,
} from "../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

function hasPermission(user: AuthorizedFoodtabUser, permission: string) {
  return user.isAdministrator || user.profile.permissions.includes(permission);
}

function canSeeBranch(user: AuthorizedFoodtabUser, branchId: string) {
  return (
    user.isAdministrator ||
    user.profile.branch_id === "company" ||
    user.profile.branch_id === branchId
  );
}

function canSeeAudience(
  user: AuthorizedFoodtabUser,
  item: {
    audienceType: string;
    targetBranchId: string | null;
    targetPersonEmail: string | null;
    authorEmail?: string;
    createdByEmail?: string;
  },
) {
  return (
    user.isAdministrator ||
    user.profile.branch_id === "company" ||
    item.audienceType === "company" ||
    (item.audienceType === "branch" &&
      item.targetBranchId === user.profile.branch_id) ||
    (item.audienceType === "person" &&
      item.targetPersonEmail?.toLowerCase() === user.email.toLowerCase()) ||
    item.authorEmail?.toLowerCase() === user.email.toLowerCase() ||
    item.createdByEmail?.toLowerCase() === user.email.toLowerCase()
  );
}

export async function GET(request: Request) {
  try {
    const user = await authorizeFoodtabRequest(request);
    const db = getDb();
    const [
      tasks,
      attendance,
      posts,
      branchRows,
      assignedTaskRows,
      recipeRows,
      menuItemRows,
      weeklyMenuRows,
    ] = await Promise.all([
      db.select().from(operationTasks),
      db
        .select()
        .from(attendanceEvents)
        .where(eq(attendanceEvents.employeeEmail, user.email))
        .orderBy(desc(attendanceEvents.id))
        .limit(1),
      db.select().from(announcements).orderBy(desc(announcements.id)).limit(20),
      db.select().from(branches).orderBy(branches.name),
      db.select().from(assignedTasks).orderBy(desc(assignedTasks.id)).limit(50),
      db.select().from(recipes).orderBy(recipes.name),
      db.select().from(menuItems).orderBy(menuItems.category, menuItems.name),
      db
        .select()
        .from(weeklyMenuDocuments)
        .orderBy(desc(weeklyMenuDocuments.id))
        .limit(50),
    ]);
    return Response.json({
      tasks: hasPermission(user, "attendance") ? tasks : [],
      lastAttendance: hasPermission(user, "attendance")
        ? (attendance[0] ?? null)
        : null,
      posts: hasPermission(user, "communication")
        ? posts.filter((item) => canSeeAudience(user, item))
        : [],
      branches: branchRows.filter((branch) => canSeeBranch(user, branch.id)),
      assignedTasks: hasPermission(user, "tasks")
        ? assignedTaskRows.filter((item) => canSeeAudience(user, item))
        : [],
      recipes: hasPermission(user, "recipes")
        ? recipeRows.filter((item) => canSeeBranch(user, item.branchId))
        : [],
      menuItems: hasPermission(user, "menus")
        ? menuItemRows.filter((item) => canSeeBranch(user, item.branchId))
        : [],
      weeklyMenus: hasPermission(user, "menus")
        ? weeklyMenuRows.filter((item) => canSeeBranch(user, item.branchId))
        : [],
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authorizeFoodtabRequest(request);
    const payload = (await request.json()) as {
      action?:
        | "task"
        | "attendance"
        | "post"
        | "assignedTask"
        | "assignedTaskCompletion"
        | "recipe"
        | "menuItem";
      taskId?: number;
      completed?: boolean;
      attendanceAction?: "in" | "out";
      text?: string;
      location?: string;
      authorName?: string;
      audienceType?: "company" | "branch" | "person";
      targetBranchId?: string;
      targetPersonEmail?: string;
      targetPersonName?: string;
      title?: string;
      note?: string;
      dueAt?: string;
      priority?: "normal" | "high";
      branchId?: string;
      name?: string;
      category?: string;
      portions?: number;
      allergens?: string;
      ingredients?: string;
      instructions?: string;
      menuType?: "permanent" | "weekly";
      description?: string;
      price?: number;
      dayLabel?: string;
    };
    const db = getDb();
    const requestedLocation =
      payload.location?.slice(0, 120) || "Černá Perla · Bernard Bar";
    const location =
      user.isAdministrator || user.profile.branch_id === "company"
        ? requestedLocation
        : user.profile.branch_id === "bernard-bar-tabor"
          ? "Bernard Bar Tábor"
          : "Restaurace Černá Perla";
    const audienceType =
      payload.audienceType === "branch" || payload.audienceType === "person"
        ? payload.audienceType
        : "company";
    const targetBranchId =
      audienceType === "branch"
        ? payload.targetBranchId?.slice(0, 80) || null
        : null;
    const targetPersonEmail =
      audienceType === "person"
        ? payload.targetPersonEmail?.slice(0, 160) || null
        : null;
    const targetPersonName =
      audienceType === "person"
        ? payload.targetPersonName?.slice(0, 100) || null
        : null;

    if (payload.action === "task") {
      if (!hasPermission(user, "attendance"))
        return Response.json(
          { error: "Nemáte oprávnění k docházce." },
          { status: 403 },
        );
      const taskId = Number(payload.taskId);
      if (
        ![1, 2, 3, 4].includes(taskId) ||
        typeof payload.completed !== "boolean"
      ) {
        return Response.json({ error: "Neplatný úkol." }, { status: 400 });
      }
      const [task] = await db
        .insert(operationTasks)
        .values({
          id: taskId,
          completed: payload.completed,
          updatedBy: user.email,
        })
        .onConflictDoUpdate({
          target: operationTasks.id,
          set: {
            completed: payload.completed,
            updatedBy: user.email,
            updatedAt: new Date().toISOString(),
          },
        })
        .returning();
      return Response.json({ task });
    }

    if (
      payload.action === "attendance" &&
      (payload.attendanceAction === "in" || payload.attendanceAction === "out")
    ) {
      if (!hasPermission(user, "attendance"))
        return Response.json(
          { error: "Nemáte oprávnění k docházce." },
          { status: 403 },
        );
      const [event] = await db
        .insert(attendanceEvents)
        .values({
          employeeEmail: user.email,
          action: payload.attendanceAction,
          location,
        })
        .returning();
      return Response.json({ event });
    }

    if (payload.action === "post") {
      if (!hasPermission(user, "communication"))
        return Response.json(
          { error: "Nemáte oprávnění ke komunikaci." },
          { status: 403 },
        );
      const text = payload.text?.trim().slice(0, 1000) ?? "";
      if (!text)
        return Response.json({ error: "Zpráva je prázdná." }, { status: 400 });
      if (audienceType === "branch" && !targetBranchId)
        return Response.json(
          { error: "Vyberte cílovou pobočku." },
          { status: 400 },
        );
      if (
        audienceType === "person" &&
        (!targetPersonEmail || !targetPersonName)
      )
        return Response.json({ error: "Vyberte příjemce." }, { status: 400 });
      const [post] = await db
        .insert(announcements)
        .values({
          authorName: user.displayName,
          authorEmail: user.email,
          text,
          location,
          audienceType,
          targetBranchId,
          targetPersonEmail,
          targetPersonName,
        })
        .returning();
      return Response.json({ post });
    }

    if (payload.action === "assignedTask") {
      if (!hasPermission(user, "tasks"))
        return Response.json(
          { error: "Nemáte oprávnění k úkolům." },
          { status: 403 },
        );
      const title = payload.title?.trim().slice(0, 160) ?? "";
      const dueAt = payload.dueAt?.trim().slice(0, 40) ?? "";
      if (!title || !dueAt)
        return Response.json(
          { error: "Doplňte název a termín úkolu." },
          { status: 400 },
        );
      if (audienceType === "branch" && !targetBranchId)
        return Response.json(
          { error: "Vyberte cílovou pobočku." },
          { status: 400 },
        );
      if (
        audienceType === "person" &&
        (!targetPersonEmail || !targetPersonName)
      )
        return Response.json({ error: "Vyberte řešitele." }, { status: 400 });
      const [assignedTask] = await db
        .insert(assignedTasks)
        .values({
          title,
          note: payload.note?.trim().slice(0, 1000) ?? "",
          createdByEmail: user.email,
          createdByName: user.displayName,
          originLocation: location,
          audienceType,
          targetBranchId,
          targetPersonEmail,
          targetPersonName,
          dueAt,
          priority: payload.priority === "high" ? "high" : "normal",
        })
        .returning();
      return Response.json({ assignedTask });
    }

    if (payload.action === "assignedTaskCompletion") {
      if (!hasPermission(user, "tasks"))
        return Response.json(
          { error: "Nemáte oprávnění k úkolům." },
          { status: 403 },
        );
      const taskId = Number(payload.taskId);
      if (
        !Number.isInteger(taskId) ||
        taskId < 1 ||
        typeof payload.completed !== "boolean"
      ) {
        return Response.json({ error: "Neplatný úkol." }, { status: 400 });
      }
      const [existingTask] = await db
        .select()
        .from(assignedTasks)
        .where(eq(assignedTasks.id, taskId))
        .limit(1);
      if (!existingTask)
        return Response.json({ error: "Úkol nebyl nalezen." }, { status: 404 });
      if (!canSeeAudience(user, existingTask))
        return Response.json(
          { error: "K tomuto úkolu nemáte přístup." },
          { status: 403 },
        );
      const [assignedTask] = await db
        .update(assignedTasks)
        .set({ completed: payload.completed })
        .where(eq(assignedTasks.id, taskId))
        .returning();
      return Response.json({ assignedTask });
    }

    if (payload.action === "recipe") {
      if (!hasPermission(user, "recipes"))
        return Response.json(
          { error: "Nemáte oprávnění k receptům." },
          { status: 403 },
        );
      const branchId = payload.branchId?.trim().slice(0, 80) ?? "";
      const name = payload.name?.trim().slice(0, 160) ?? "";
      const category = payload.category?.trim().slice(0, 80) ?? "";
      const ingredients = payload.ingredients?.trim().slice(0, 5000) ?? "";
      const instructions = payload.instructions?.trim().slice(0, 5000) ?? "";
      if (!branchId || !name || !category || !ingredients || !instructions) {
        return Response.json(
          { error: "Doplňte pobočku, název, kategorii, suroviny a postup." },
          { status: 400 },
        );
      }
      if (!canSeeBranch(user, branchId))
        return Response.json(
          { error: "K receptům této pobočky nemáte přístup." },
          { status: 403 },
        );
      const [recipe] = await db
        .insert(recipes)
        .values({
          branchId,
          name,
          category,
          portions: Math.min(999, Math.max(1, Number(payload.portions) || 1)),
          allergens: payload.allergens?.trim().slice(0, 300) ?? "",
          ingredients,
          instructions,
          updatedBy: user.email,
        })
        .returning();
      return Response.json({ recipe });
    }

    if (payload.action === "menuItem") {
      if (!hasPermission(user, "menus"))
        return Response.json(
          { error: "Nemáte oprávnění k jídelním lístkům." },
          { status: 403 },
        );
      const branchId = payload.branchId?.trim().slice(0, 80) ?? "";
      const menuType = "permanent";
      const name = payload.name?.trim().slice(0, 160) ?? "";
      const category = payload.category?.trim().slice(0, 80) ?? "";
      const rawPrice = Number(payload.price);
      if (
        !branchId ||
        !name ||
        !category ||
        !Number.isFinite(rawPrice) ||
        rawPrice <= 0
      ) {
        return Response.json(
          { error: "Doplňte pobočku, název, kategorii a cenu položky." },
          { status: 400 },
        );
      }
      if (!canSeeBranch(user, branchId))
        return Response.json(
          { error: "K jídelnímu lístku této pobočky nemáte přístup." },
          { status: 403 },
        );
      const price = Math.min(100000, Math.round(rawPrice));
      const [menuItem] = await db
        .insert(menuItems)
        .values({
          branchId,
          menuType,
          name,
          description: payload.description?.trim().slice(0, 1000) ?? "",
          category,
          price,
          allergens: payload.allergens?.trim().slice(0, 300) ?? "",
          dayLabel: "",
          updatedBy: user.email,
        })
        .returning();
      return Response.json({ menuItem });
    }

    return Response.json({ error: "Neznámá operace." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
