import AuthGate from "./auth-gate";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <AuthGate
      supabaseUrl={process.env.SUPABASE_URL ?? ""}
      supabasePublishableKey={process.env.SUPABASE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
