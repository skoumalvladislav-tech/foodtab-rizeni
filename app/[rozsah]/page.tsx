import Link from "next/link";

import { getContext } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import PrepinacRezimu from "@/app/prepinac-rezimu";
import { odhlasit } from "@/app/prihlaseni/akce";
import Nadpis from "./nadpis";
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
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { rozsah } = await params;
  // Dotaz na odhlášení se přepíná ADRESOU, ne javascriptem — stejně
  // jako záložky ve Vzkazech. Funguje to i bez skriptu a na sdíleném
  // telefonu za barem je to ta podstatná vlastnost.
  const ptaSeNaOdhlaseni = (await searchParams).odhlasit === "1";

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
        Vaše oprávnění nemá otevřenou žádnou obrazovku. Řekněte si správci
        firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  return (
    <>
      <Nadpis oci="Foodtab" popis="Kam dál. Vidíte jen to, na co máte právo.">
        Rozcestník
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
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

        {/*
          Přepínač vzhledu. Na telefonu z horní lišty zmizel — pět prvků
          se tam nevešlo a ozubené kolo přetékalo z obrazovky. Ubrat ho
          bez náhrady by ale znamenalo funkci zrušit, ne přestěhovat,
          takže je tady, kam se z telefonu chodí přes „Více“.

          Na počítači je pořád i v liště; tady navíc nepřekáží.
        */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: "1px solid var(--line)",
            fontSize: "14px",
            color: "var(--muted)",
          }}
        >
          <span>Vzhled</span>
          <PrepinacRezimu />
        </div>

        {/*
          ODHLÁŠENÍ I TADY.

          Na Mých údajích zůstává — tam patří k výdeji dat a k souhlasům.
          Jenže cesta k němu vede přes Více → Moje údaje → sjet úplně
          dolů, pod souhlasy a stahování. Šéfík ho 6. 9. nenašel, a to
          věděl, že tam je.

          Rozcestník je pod „Více" a je to místo, kam člověk jde, když
          hledá „něco ostatního". Proto sem, dolů a oddělené čarou.

          Do horní lišty ne: omylem ťuknuté odhlášení uprostřed směny je
          horší než o jedno ťuknutí delší cesta.
        */}
        <div
          style={{
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid var(--line)",
          }}
        >
          {/*
            AŤ SE TO ZEPTÁ (podmínka Šéfíka, 8. 9.).

            Přesně tenhle důvod mě vedl k tomu odhlášení dřív schovávat:
            na sdíleném telefonu za barem, s mokrýma rukama, je omylem
            ťuknuté odhlášení uprostřed směny horší než ťuknutí navíc.
            Krátký dotaz ten důvod odstraní a Šéfíkovi zůstane, co chce
            — odhlášení na dosah, ne schované pod Mými údaji.

            Bez javascriptu: přepíná se adresou (`?odhlasit=1`), takže
            „Zpět" je obyčejný odkaz a odhlášení pořád obyčejný formulář.
          */}
          {ptaSeNaOdhlaseni ? (
            <>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--ink)",
                }}
              >
                Odhlásit se?
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <form action={odhlasit}>
                  <button type="submit" className="ft-tl">
                    Odhlásit
                  </button>
                </form>
                <Link href={`/${rozsah}`} className="ft-tl ft-tl-vedlejsi">
                  Zpět
                </Link>
              </div>
            </>
          ) : (
            <Link
              href={`/${rozsah}?odhlasit=1`}
              className="ft-tl ft-tl-vedlejsi"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
            >
              {/*
                Ikona A slovo. Samotná ikona se dá splést s čímkoli —
                zvlášť u něčeho, co se nesmí ťuknout omylem.
              */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
                <path d="M10.5 11 14 8l-3.5-3" />
                <path d="M14 8H6" />
              </svg>
              Odhlásit se
            </Link>
          )}
          <p
            style={{
              margin: "8px 0 0",
              fontSize: "12px",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Odhlásí vás z tohohle zařízení. Příště se přihlásíte kódem
            z e-mailu.
          </p>
        </div>
      </div>
    </>
  );
}
