import Link from "next/link";

import { getContext } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import { viditelnaNabidka } from "./nabidka";

/**
 * Rozcestník rozsahu.
 *
 * Sem míří přesměrování z domovské stránky, takže tohle je první, co
 * člověk po přihlášení uvidí. Ukazuje totéž co navigace, jen v ploše —
 * na telefonu se to trefuje líp než do lišty nahoře.
 *
 * Stavy, kdy není co ukázat, řeší layout nad tímhle. Když se sem přesto
 * dostaneme bez kontextu, nekreslíme nic a nechá se mluvit layout.
 */
export default async function RozsahRozcestnik({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  const ctx = await getContext(tenantId);
  if (!ctx) return null;

  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) return null;

  const polozky = viditelnaNabidka(ctx);

  if (polozky.length === 0) {
    return (
      <Sdeleni nadpis="Zatím tu pro vás nic není">
        Vaše role nemá otevřenou žádnou obrazovku. Řekněte si správci
        firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  return (
    <main style={{ padding: "16px", paddingBottom: "32px" }}>
      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        }}
      >
        {polozky.map((p) =>
          p.hotovo ? (
            <Link
              key={p.segment}
              href={`/${scope.branchSlug}/${p.segment}`}
              style={{
                display: "block",
                padding: "20px 16px",
                borderRadius: "14px",
                background: "var(--card)",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow)",
                color: "var(--branch)",
                textDecoration: "none",
                fontSize: "16px",
              }}
            >
              {p.nazev}
            </Link>
          ) : (
            <div
              key={p.segment}
              style={{
                padding: "20px 16px",
                borderRadius: "14px",
                background: "transparent",
                border: "1px dashed var(--line)",
                color: "var(--muted)",
                fontSize: "16px",
              }}
            >
              {p.nazev}
              <span style={{ display: "block", fontSize: "12px", marginTop: "4px" }}>
                Připravujeme
              </span>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
