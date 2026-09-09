import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (dřív middleware): podává dál původní adresu a obnovuje
 * přihlašovací cookie Supabase. O PŘÍSTUPU NEROZHODUJE — cookie umí
 * kdokoli podvrhnout; kdo kam smí, řeší lib/authz.ts a RLS.
 */
export async function proxy(request: NextRequest) {
  request.headers.set("x-ftm-adresa", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || process.env.APP_MODE === "demo") return response;

  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
