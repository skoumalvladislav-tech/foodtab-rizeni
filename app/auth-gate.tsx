"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Dashboard from "./dashboard";

type AccessProfile = {
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
};

type AuthGateProps = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export default function AuthGate({
  supabaseUrl,
  supabasePublishableKey,
}: AuthGateProps) {
  const supabase = useMemo(
    () =>
      supabaseUrl && supabasePublishableKey
        ? createClient(supabaseUrl, supabasePublishableKey, {
            auth: {
              // Keep the trusted device signed in between browser/PWA launches.
              // Supabase rotates the short-lived access token using the stored
              // refresh token; no password or magic link is stored by the app.
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          })
        : null,
    [supabaseUrl, supabasePublishableKey],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [loading, setLoading] = useState(
    Boolean(supabaseUrl && supabasePublishableKey),
  );
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadProfile = useCallback(
    async (activeSession: Session | null) => {
      setSession(activeSession);
      if (!supabase || !activeSession) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data, error: profileError } = await supabase
        .from("user_access")
        .select(
          "user_id,email,full_name,auth_provider,status,branch_id,role,permissions",
        )
        .eq("user_id", activeSession.user.id)
        .single<AccessProfile>();
      if (profileError || !data) {
        setError(
          "Profil přístupu se nepodařilo načíst. Zkuste stránku obnovit.",
        );
        setProfile(null);
      } else {
        setProfile(data);
        setError("");
      }
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) {
          setError(
            "Uložené přihlášení se nepodařilo obnovit. Přihlaste se znovu.",
          );
        }
        return loadProfile(data.session);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        window.setTimeout(() => void loadProfile(nextSession), 0);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, [loadProfile, supabase]);

  async function sendEmailLink(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });
    if (signInError) setError(signInError.message);
    else {
      setLinkSent(true);
      setMessage(
        "Přihlašovací odkaz byl odeslán. Otevřete e-mail na stejném telefonu nebo počítači a klepněte na odkaz.",
      );
    }
    setBusy(false);
  }

  async function signInWithProvider(provider: "google") {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: providerError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (providerError) {
      setError(providerError.message);
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    // Remove only this phone's remembered session. Other approved devices stay
    // signed in until the user logs them out or an administrator revokes them.
    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setProfile(null);
    setLinkSent(false);
  }

  if (!supabase) {
    return (
      <AuthScreen>
        <AuthCard
          title="Připojení se dokončuje"
          description="Přihlašovací služba zatím není nastavená v prostředí aplikace."
        />
      </AuthScreen>
    );
  }
  if (loading) {
    return (
      <AuthScreen>
        <AuthCard
          title="Ověřuji přístup"
          description="Bezpečně načítáme váš účet a přidělená oprávnění."
          loading
        />
      </AuthScreen>
    );
  }
  if (session && profile?.status === "approved") {
    return (
      <Dashboard
        userName={profile.full_name || profile.email.split("@")[0]}
        userEmail={profile.email}
        accessToken={session.access_token}
        userRole={profile.role || "service"}
        branchId={profile.branch_id}
        permissions={profile.permissions}
        onSignOut={signOut}
      />
    );
  }
  if (session && profile) {
    const state =
      profile.status === "pending"
        ? {
            title: "Čeká se na schválení",
            text: "Vaše identita je ověřená. Vedení Foodtabu vám nyní přiřadí pobočku, pracovní roli a povolené moduly.",
          }
        : profile.status === "suspended"
          ? {
              title: "Přístup je pozastavený",
              text: "Obraťte se na vedení Foodtabu. Do obnovení oprávnění nejsou firemní data dostupná.",
            }
          : {
              title: "Žádost nebyla schválena",
              text: "Tento účet nemá povolený přístup k interní aplikaci Foodtab.",
            };
    return (
      <AuthScreen>
        <AuthCard title={state.title} description={state.text}>
          <div className="auth-account">
            <strong>{profile.full_name || "Ověřený účet"}</strong>
            <span>{profile.email}</span>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="auth-actions">
            <button
              className="primary"
              onClick={() => void loadProfile(session)}
            >
              Zkontrolovat stav
            </button>
            <button className="outline" onClick={signOut}>
              Použít jiný účet
            </button>
          </div>
        </AuthCard>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthCard
        title="Přihlášení do Foodtabu"
        description="Přihlaste se svým e-mailem nebo firemním účtem. Nový účet musí před prvním použitím schválit vedení."
      >
        <form className="auth-form" onSubmit={sendEmailLink}>
          <label>
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy || linkSent}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="jmeno@firma.cz"
            />
          </label>
          {message && <p className="auth-message">{message}</p>}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || linkSent}>
            {busy ? "Odesílám…" : linkSent ? "Odkaz byl odeslán" : "Poslat přihlašovací odkaz"}
          </button>
          {linkSent && (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setLinkSent(false);
                setMessage("");
              }}
            >
              Změnit e-mail nebo poslat nový odkaz
            </button>
          )}
        </form>
        <div className="auth-divider">
          <span>nebo</span>
        </div>
        <div className="auth-providers">
          <button disabled={busy} onClick={() => signInWithProvider("google")}>
            <b>G</b> Pokračovat přes Google
          </button>
        </div>
        <p className="auth-security">
          Foodtab neukládá vaše heslo. Ověření zajišťuje Supabase Auth a firemní
          data se zpřístupní až po schválení účtu.
        </p>
      </AuthCard>
    </AuthScreen>
  );
}

function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-screen">
      <div className="auth-brand">
        <span>F</span>
        <div>
          <strong>foodtab</strong>
          <small>restaurant operations</small>
        </div>
      </div>
      {children}
    </main>
  );
}

function AuthCard({
  title,
  description,
  loading,
  children,
}: {
  title: string;
  description: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="auth-card">
      <span className="auth-kicker">BEZPEČNÝ PŘÍSTUP</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {loading && <div className="auth-loader" aria-label="Načítání" />}
      {children}
    </section>
  );
}
