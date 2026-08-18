import {
  authErrorResponse,
  authorizeFoodtabRequest,
  type FoodtabAccessProfile,
} from "../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

const allowedRoles = new Set([
  "administrator",
  "branch_manager",
  "kitchen",
  "service",
  "bar",
]);
const allowedPermissions = new Set([
  "attendance",
  "tasks",
  "communication",
  "recipes",
  "menus",
  "ai",
  "motivation",
  "finance",
]);
const allowedBranches = new Set([
  "restaurace-cerna-perla",
  "bernard-bar-tabor",
  "company",
]);
const profileColumns =
  "user_id,email,full_name,auth_provider,status,branch_id,role,permissions,requested_at,reviewed_at,reviewed_by";

export async function GET(request: Request) {
  try {
    const reviewer = await authorizeFoodtabRequest(request);
    if (!reviewer.isAdministrator) {
      return Response.json(
        { error: "Správa přístupů je dostupná pouze administrátorovi." },
        { status: 403 },
      );
    }
    const { data, error } = await reviewer.supabase
      .from("user_access")
      .select(profileColumns)
      .order("requested_at", { ascending: false });
    if (error) throw error;
    return Response.json({
      users: (data as FoodtabAccessProfile[]).map(serializeUser),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const reviewer = await authorizeFoodtabRequest(request);
    if (!reviewer.isAdministrator) {
      return Response.json(
        { error: "Správa přístupů je dostupná pouze administrátorovi." },
        { status: 403 },
      );
    }
    const payload = (await request.json()) as {
      action?: "review";
      id?: string;
      decision?: "approved" | "rejected" | "suspended";
      branchId?: string;
      role?: string;
      permissions?: string[];
    };

    if (payload.action !== "review" || !payload.id || !payload.decision) {
      return Response.json({ error: "Neplatná žádost." }, { status: 400 });
    }
    if (payload.id === reviewer.user.id && payload.decision !== "approved") {
      return Response.json(
        {
          error:
            "Nemůžete pozastavit nebo zamítnout vlastní administrátorský účet.",
        },
        { status: 400 },
      );
    }

    let changes: Record<string, unknown>;
    if (payload.decision === "approved") {
      const branchId = payload.branchId ?? "";
      const role = payload.role ?? "";
      const permissions = Array.from(new Set(payload.permissions ?? [])).filter(
        (item) => allowedPermissions.has(item),
      );
      if (
        !allowedBranches.has(branchId) ||
        !allowedRoles.has(role) ||
        permissions.length === 0
      ) {
        return Response.json(
          { error: "Vyberte pobočku, roli a alespoň jeden modul." },
          { status: 400 },
        );
      }
      changes = {
        status: "approved",
        branch_id: branchId,
        role,
        permissions,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewer.user.id,
      };
    } else {
      changes = {
        status: payload.decision,
        branch_id: null,
        role: null,
        permissions: [],
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewer.user.id,
      };
    }

    const { data, error } = await reviewer.supabase
      .from("user_access")
      .update(changes)
      .eq("user_id", payload.id)
      .select(profileColumns)
      .single<FoodtabAccessProfile>();
    if (error) throw error;
    return Response.json({ user: serializeUser(data) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function serializeUser(user: FoodtabAccessProfile) {
  return {
    id: user.user_id,
    email: user.email,
    fullName: user.full_name,
    authProvider: user.auth_provider,
    status: user.status,
    branchId: user.branch_id,
    role: user.role,
    permissions: user.permissions ?? [],
    requestedAt: user.requested_at,
    reviewedAt: user.reviewed_at,
    reviewedBy: user.reviewed_by,
  };
}
