import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type FoodtabAccessProfile = {
  user_id: string;
  email: string;
  full_name: string;
  auth_provider: "email" | "google" | "apple";
  status: "pending" | "approved" | "rejected" | "suspended";
  branch_id: string | null;
  role:
    | "administrator"
    | "branch_manager"
    | "kitchen"
    | "service"
    | "bar"
    | null;
  permissions: string[];
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type AuthorizedFoodtabUser = {
  user: User;
  profile: FoodtabAccessProfile;
  supabase: SupabaseClient;
  displayName: string;
  email: string;
  isAdministrator: boolean;
};

export class FoodtabAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function credentials() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new FoodtabAuthError("Supabase není nakonfigurovaný.", 503);
  }
  return { url, publishableKey };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new FoodtabAuthError("Přihlášení je vyžadováno.", 401);
  }
  return token;
}

export async function authorizeFoodtabRequest(
  request: Request,
  permission?: string,
): Promise<AuthorizedFoodtabUser> {
  const token = bearerToken(request);
  const { url, publishableKey } = credentials();
  const supabase = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    throw new FoodtabAuthError("Přihlášení vypršelo. Přihlaste se znovu.", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_access")
    .select(
      "user_id,email,full_name,auth_provider,status,branch_id,role,permissions,requested_at,reviewed_at,reviewed_by",
    )
    .eq("user_id", userData.user.id)
    .single<FoodtabAccessProfile>();

  if (profileError || !profile) {
    throw new FoodtabAuthError("Žádost o přístup nebyla nalezena.", 403);
  }
  if (profile.status !== "approved") {
    throw new FoodtabAuthError("Účet zatím nemá schválený přístup.", 403);
  }

  const isAdministrator = profile.role === "administrator";
  if (
    permission &&
    !isAdministrator &&
    !profile.permissions.includes(permission)
  ) {
    throw new FoodtabAuthError("Pro tuto část aplikace nemáte oprávnění.", 403);
  }

  const email = profile.email || userData.user.email || "";
  const displayName = profile.full_name || email.split("@")[0] || "Uživatel";
  return {
    user: userData.user,
    profile,
    supabase,
    displayName,
    email,
    isAdministrator,
  };
}

export function authErrorResponse(error: unknown) {
  if (error instanceof FoodtabAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Ověření přístupu se nezdařilo.",
    },
    { status: 500 },
  );
}
