"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { bezpecnyCil } from "@/lib/auth/kam";
import { DEMO_COOKIE, isDemoMode, podepsatDemoCookie } from "@/lib/auth/session";
import { findDemoUser } from "@/lib/demo-ucty";

export async function prihlasitDemo(form: FormData) {
  if (!isDemoMode()) redirect("/prihlaseni?chyba=Demo+režim+je+vypnutý");
  const userId = String(form.get("userId") ?? "");
  const kam = bezpecnyCil(String(form.get("kam") ?? ""));
  const u = findDemoUser(userId);
  if (!u) redirect("/prihlaseni?chyba=Neznámý+demo+účet");
  const store = await cookies();
  store.set(DEMO_COOKIE, podepsatDemoCookie(u.id), {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7,
  });
  redirect(kam);
}

export async function odhlasit() {
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  if (!isDemoMode()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/prihlaseni");
}

async function supabaseServer() {
  const { createServerClient } = await import("@supabase/ssr");
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

export async function poslatKod(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const kam = bezpecnyCil(String(form.get("kam") ?? ""));
  const q = new URLSearchParams({ kam, email });
  if (isDemoMode()) redirect(`/prihlaseni?${q}`);
  const supabase = await supabaseServer();
  // Vstup jen na pozvánku: účet se přihlášením nezakládá.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) {
    q.set("chyba", "Kód se nepodařilo poslat. Zkontrolujte adresu — přístup je jen na pozvánku.");
    redirect(`/prihlaseni?${q}`);
  }
  q.set("krok", "kod");
  redirect(`/prihlaseni?${q}`);
}

export async function overitKod(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const kod = String(form.get("kod") ?? "").replace(/\s+/g, "");
  const kam = bezpecnyCil(String(form.get("kam") ?? ""));
  const q = new URLSearchParams({ kam, email, krok: "kod" });
  if (isDemoMode()) redirect(`/prihlaseni?${q}`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token: kod, type: "email" });
  if (error) {
    q.set("chyba", "Kód nesedí nebo vypršel. Nechte si poslat nový.");
    redirect(`/prihlaseni?${q}`);
  }
  redirect(kam);
}
