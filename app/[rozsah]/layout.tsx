import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getContext,
  getUser,
  TENANT_SCOPE_SEGMENT,
  type Context,
} from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import { viditelnaNabidka } from "./nabidka";

/**
 * Rám všech obrazovek uvnitř rozsahu.
 *
 * Adresa má tvar /<rozsah>/<obrazovka>, kde <rozsah> je „firma“ nebo slug
 * pobočky. Tomu, co přijde v adrese, se NEVĚŘÍ: resolveScope() ho porovná
 * s pobočkami, které uživateli vrátila databáze, a co nesedí, odmítne.
 * Kdyby si stačilo domyslet slug cizí pobočky, byla by to díra.
 *
 * Navigace se skládá z modulů firmy a práv uživatele. Schované položky
 * ale nejsou zámek — každá obrazovka si přístup ověřuje sama.
 */
export default async function RozsahLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const ctx = await getContext(tenantId);
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu. Pokud potíž trvá, ozvěte se
        správci firmy.
      </Sdeleni>
    );
  }

  // Až za tímhle voláním smí přijít redirect(). Uvnitř odchytávání by se
  // ztratil — redirect() funguje tak, že vyhodí výjimku.
  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu role.
      </Sdeleni>
    );
  }

  const polozky = viditelnaNabidka(ctx);
  const rozsahy = dostupneRozsahy(ctx);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--paper)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--green)",
          color: "var(--mint)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div style={{ padding: "12px 16px 0" }}>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.75 }}>
            {ctx.tenant.name}
          </p>
          <h1 style={{ margin: "2px 0 0", fontSize: "18px" }}>
            {scope.branchName}
          </h1>
        </div>

        {rozsahy.length > 1 ? (
          <nav
            aria-label="Přepnout pobočku"
            style={{
              display: "flex",
              gap: "8px",
              overflowX: "auto",
              padding: "12px 16px 0",
            }}
          >
            {rozsahy.map((r) => {
              const aktivni = r.slug === scope.branchSlug;
              return (
                <Link
                  key={r.slug}
                  href={`/${r.slug}`}
                  aria-current={aktivni ? "page" : undefined}
                  style={{
                    flex: "0 0 auto",
                    padding: "6px 12px",
                    borderRadius: "999px",
                    fontSize: "13px",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    background: aktivni ? "var(--mint)" : "transparent",
                    color: aktivni ? "var(--green)" : "var(--mint)",
                    border: `1px solid ${aktivni ? "var(--mint)" : "rgba(227,245,236,0.35)"}`,
                  }}
                >
                  {r.nazev}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <nav
          aria-label="Hlavní nabídka"
          style={{
            display: "flex",
            gap: "4px",
            overflowX: "auto",
            padding: "12px 16px 0",
          }}
        >
          {polozky.map((p) =>
            p.hotovo ? (
              <Link
                key={p.segment}
                href={`/${scope.branchSlug}/${p.segment}`}
                style={{
                  flex: "0 0 auto",
                  padding: "8px 12px",
                  fontSize: "14px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: "var(--mint)",
                }}
              >
                {p.nazev}
              </Link>
            ) : (
              <span
                key={p.segment}
                title="Připravujeme"
                style={{
                  flex: "0 0 auto",
                  padding: "8px 12px",
                  fontSize: "14px",
                  whiteSpace: "nowrap",
                  color: "var(--mint)",
                  opacity: 0.4,
                }}
              >
                {p.nazev}
              </span>
            ),
          )}
        </nav>
        <div style={{ height: "12px" }} />
      </header>

      {children}
    </div>
  );
}

function dostupneRozsahy(ctx: Context): { slug: string; nazev: string }[] {
  const firemni =
    ctx.membership.scope === "tenant"
      ? [{ slug: TENANT_SCOPE_SEGMENT, nazev: "Celá firma" }]
      : [];
  return [
    ...firemni,
    ...ctx.branches.map((b) => ({ slug: b.slug, nazev: b.name })),
  ];
}
