"use client";

import { FormEvent, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

type Stav = "formular" | "odesilam" | "odeslano";

export default function PrihlasovaciFormular({
  chybaZOdkazu,
}: {
  chybaZOdkazu: boolean;
}) {
  const [email, setEmail] = useState("");
  const [stav, setStav] = useState<Stav>("formular");
  const [chyba, setChyba] = useState(
    chybaZOdkazu
      ? "Odkaz už neplatí. Nechte si prosím poslat nový."
      : "",
  );

  async function odeslat(udalost: FormEvent) {
    udalost.preventDefault();
    // Malá písmena schválně: databáze e-maily ukládá zmenšené a hlídá
    // to podmínkou na sloupci, takže ať se shodují i tady.
    const adresa = email.trim().toLowerCase();
    if (!adresa) return;

    setStav("odesilam");
    setChyba("");

    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: adresa,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      setStav("odeslano");
    } catch (duvod) {
      setStav("formular");
      setChyba(
        duvod instanceof Error
          ? duvod.message
          : "Odkaz se nepodařilo odeslat. Zkuste to prosím znovu.",
      );
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          padding: "32px",
        }}
      >
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: "24px",
            color: "var(--accent)",
          }}
        >
          Foodtab
        </h1>

        {stav === "odeslano" ? (
          <>
            <p style={{ margin: "0 0 8px", color: "var(--ink)" }}>
              Odkaz je na cestě.
            </p>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
              Poslali jsme ho na <strong>{email.trim().toLowerCase()}</strong>.
              Otevřete ho na tomhle zařízení — přihlásí vás bez hesla.
              Platí omezenou dobu.
            </p>
            <button
              type="button"
              onClick={() => setStav("formular")}
              style={{
                marginTop: "24px",
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--accent)",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Zadat jinou adresu
            </button>
          </>
        ) : (
          <>
            <p
              style={{
                margin: "0 0 24px",
                color: "var(--muted)",
                fontSize: "14px",
              }}
            >
              Zadejte pracovní e-mail. Pošleme vám odkaz, kterým se
              přihlásíte — heslo nepotřebujete.
            </p>

            <form onSubmit={odeslat}>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "14px",
                  color: "var(--ink)",
                }}
              >
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jmeno@podnik.cz"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: "16px",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
              />

              {chyba ? (
                <p
                  role="alert"
                  style={{
                    margin: "12px 0 0",
                    color: "var(--bad)",
                    fontSize: "14px",
                  }}
                >
                  {chyba}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={stav === "odesilam"}
                style={{
                  width: "100%",
                  marginTop: "20px",
                  padding: "12px 16px",
                  fontSize: "16px",
                  borderRadius: "10px",
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--card)",
                  cursor: stav === "odesilam" ? "progress" : "pointer",
                  opacity: stav === "odesilam" ? 0.7 : 1,
                }}
              >
                {stav === "odesilam" ? "Odesílám…" : "Poslat přihlašovací odkaz"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
