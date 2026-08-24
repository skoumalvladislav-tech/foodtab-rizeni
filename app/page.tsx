import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import {
  getContext,
  getMyTenants,
  getUser,
  resolveScope,
  type Context,
  type Scope,
} from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * Rozcestí po přihlášení.
 *
 * Nepřihlášený jde na přihlášení. Přihlášený jde tam, kam podle své
 * role patří — na firemní úroveň, nebo na svou první pobočku. To
 * rozhodnutí nedělá tahle stránka: dělá ho resolveScope() v authz,
 * stejná funkce, kterou používají i adresy s výslovným rozsahem.
 * Kdyby si to stránka dopočítala sama, měli bychom pravidlo dvakrát.
 */
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenants = await getMyTenants();
  if (tenants.length === 0) {
    return (
      <Rozcestnik nadpis="Účet zatím nepatří k žádné firmě">
        Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
        členství. Požádejte o pozvánku někoho, kdo firmu ve Foodtabu už
        spravuje.
      </Rozcestnik>
    );
  }

  const ctx = await getContext(tenants[0].tenantId);
  if (!ctx) {
    return (
      <Rozcestnik nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu. Pokud potíž trvá, ozvěte se
        správci firmy.
      </Rozcestnik>
    );
  }

  const scope = bezpecnyRozsah(ctx);
  if (!scope) {
    return (
      <Rozcestnik nadpis="Není kam vás pustit">
        Vaše členství je vedené na pobočku, ale žádná vám zatím není
        přiřazená. Doplní ji správce firmy.
      </Rozcestnik>
    );
  }

  // Až za try/catch: redirect() uvnitř funguje tak, že vyhodí výjimku,
  // a ta by se v odchytávání ztratila.
  redirect(`/${scope.branchSlug}`);
}

/**
 * resolveScope() umí odmítnout — vedoucí pobočky bez přiřazené pobočky
 * nemá kam jít. Tady z toho děláme null, ať stránka může místo pádu
 * ukázat vysvětlení.
 */
function bezpecnyRozsah(ctx: Context): Scope | null {
  try {
    return resolveScope(ctx);
  } catch {
    return null;
  }
}

function Rozcestnik({
  nadpis,
  children,
}: {
  nadpis: string;
  children: ReactNode;
}) {
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
          style={{ margin: "0 0 12px", fontSize: "20px", color: "var(--green)" }}
        >
          {nadpis}
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
          {children}
        </p>
      </div>
    </main>
  );
}
