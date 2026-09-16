import { redirect } from "next/navigation";

import { BRANCH_COLORS } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { KBELIK, PLATNOST_ODKAZU_S } from "@/lib/pobocky-pozadi";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { nahratPozadiPobocky, smazatPozadiPobocky, upravitPobocku } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Nastavení poboček.
 *
 * Název, barva a hodina, kterou pobočce začíná provozní den. Zapisuje se
 * do branches, o povolení rozhoduje politika branches_update.
 *
 * Barvy si vybírá zákazník z palety — do kódu žádná napevno nepatří.
 * Vedle každé tečky je název odstínu, protože barva sama nesmí nést
 * informaci.
 */

type Pobocka = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  day_starts_at: string | null;
  hero_photo_path: string | null;
  lat: number | null;
  lon: number | null;
};

const NAZVY_BAREV: Record<string, string> = {
  slate: "Břidlicová",
  indigo: "Indigová",
  violet: "Fialová",
  sky: "Blankytná",
  teal: "Modrozelená",
  emerald: "Smaragdová",
  amber: "Jantarová",
  rose: "Růžová",
};

export default async function NastaveniPobocek({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ pobocka?: string; chyba?: string; ulozeno?: string }>;
}) {
  const { rozsah } = await params;
  const { pobocka: dotcena, chyba, ulozeno } = await searchParams;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "settings.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nastavení firmy je otevřené jen oprávněním se správou nastavení.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  /*
    Fotka pozadí a souřadnice pro počasí čekají na dvě migrace
    (20260916160000_pobocka_pozadi, 20260916170000_pobocka_pocasi) —
    dokud neproběhnou, sloupce v databázi nejsou. Dotaz se proto
    zkusí se všemi, a při „sloupec neznámý“ zopakuje beze; jinak by
    celá obrazovka spadla kvůli věcem, o které tu jinak vůbec nejde
    (barva a začátek dne fungují nezávisle na obou).
  */
  let novaPoleHotova = true;
  const zaklad = supabase
    .from("branches")
    .select("id, name, slug, color, day_starts_at, hero_photo_path, lat, lon")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  let dotaz = await zaklad;
  if (dotaz.error && sloupecNeexistuje(dotaz.error)) {
    novaPoleHotova = false;
    dotaz = (await supabase
      .from("branches")
      .select("id, name, slug, color, day_starts_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })) as typeof dotaz;
  }
  if (dotaz.error) throw new DotazSelhal("pobočky", dotaz.error);

  const pobocky = (dotaz.data ?? []) as Pobocka[];

  // Podepsané odkazy na náhled se žádají jedním dávkovým voláním pro
  // všechny pobočky najednou, ne po jedné — stejný důvod jako
  // v marketingové knihovně fotek.
  const cesty = pobocky.map((p) => p.hero_photo_path).filter((c): c is string => Boolean(c));
  const nahledy = new Map<string, string>();
  if (novaPoleHotova && cesty.length > 0) {
    const { data: podepsane } = await supabase.storage.from(KBELIK).createSignedUrls(cesty, PLATNOST_ODKAZU_S);
    for (const p of podepsane ?? []) {
      if (p.path && p.signedUrl) nahledy.set(p.path, p.signedUrl);
    }
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  if (pobocky.length === 0) {
    return (
      <Sdeleni nadpis="Firma nemá žádnou pobočku">
        Zakládání poboček zatím není hotové. Přibude sem.
      </Sdeleni>
    );
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Barva odlišuje pobočku v celém rozhraní. Provozní den určuje, do které uzávěrky spadne účet vystavený po půlnoci."
      >
        Pobočky
      </Nadpis>

      <div style={{ display: "grid", gap: "16px", maxWidth: "620px" }}>
        {pobocky.map((p) => {
          const jeDotcena = dotcena === p.id;
          const barva = p.color ?? "slate";

          const nahled = p.hero_photo_path ? nahledy.get(p.hero_photo_path) : undefined;

          return (
            <div key={p.id} style={{ display: "grid", gap: "12px" }}>
            <form
              action={upravitPobocku}
              data-branch={barva}
              style={{
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-md)",
                padding: "16px 18px",
                boxShadow: "var(--shadow)",
              }}
            >
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="pobocka" value={p.id} />

              <div
                style={{
                  height: "3px",
                  borderRadius: "2px",
                  background: "var(--branch)",
                  marginBottom: "14px",
                }}
              />

              <label style={stitek} htmlFor={`nazev-${p.id}`}>
                Název
              </label>
              <input
                id={`nazev-${p.id}`}
                name="nazev"
                defaultValue={p.name}
                required
                maxLength={120}
                style={pole}
              />

              <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
                <legend style={{ ...stitek, padding: 0 }}>Barva</legend>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginTop: "8px",
                  }}
                >
                  {BRANCH_COLORS.map((klic) => (
                    <label
                      key={klic}
                      data-branch={klic}
                      title={NAZVY_BAREV[klic] ?? klic}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                        padding: "7px 11px",
                        borderRadius: "var(--radius-full)",
                        border: "1px solid var(--line-2)",
                        fontSize: "12.5px",
                        cursor: "pointer",
                        minHeight: "44px",
                      }}
                    >
                      <input
                        type="radio"
                        name="barva"
                        value={klic}
                        defaultChecked={klic === barva}
                        style={{ accentColor: "var(--branch)" }}
                      />
                      <span
                        aria-hidden="true"
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: "var(--branch)",
                          flex: "none",
                        }}
                      />
                      {/* Barva nikdy nestojí sama — vedle tečky je název. */}
                      <span>{NAZVY_BAREV[klic] ?? klic}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label
                style={{ ...stitek, marginTop: "16px", display: "block" }}
                htmlFor={`zacatek-${p.id}`}
              >
                Provozní den začíná
              </label>
              <input
                id={`zacatek-${p.id}`}
                name="zacatek"
                type="time"
                required
                defaultValue={(p.day_starts_at ?? "05:00").slice(0, 5)}
                className="mono"
                style={{ ...pole, maxWidth: "140px" }}
              />

              {novaPoleHotova ? (
                <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
                  <legend style={{ ...stitek, padding: 0 }}>
                    Souřadnice pro počasí na Dnes (nepovinné)
                  </legend>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      aria-label="Zeměpisná šířka"
                      name="lat"
                      type="number"
                      inputMode="decimal"
                      step="0.00001"
                      min={-90}
                      max={90}
                      placeholder="Šířka, např. 49.41"
                      defaultValue={p.lat ?? ""}
                      className="mono"
                      style={{ ...pole, maxWidth: "160px" }}
                    />
                    <input
                      aria-label="Zeměpisná délka"
                      name="lon"
                      type="number"
                      inputMode="decimal"
                      step="0.00001"
                      min={-180}
                      max={180}
                      placeholder="Délka, např. 14.66"
                      defaultValue={p.lon ?? ""}
                      className="mono"
                      style={{ ...pole, maxWidth: "160px" }}
                    />
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                    Beze souřadnic se widget počasí na Dnes nekreslí vůbec.
                  </p>
                </fieldset>
              ) : null}

              {jeDotcena && chyba ? (
                <p role="alert" className="hlaska-chyba">
                  {popisChyby(chyba)}
                </p>
              ) : null}

              {jeDotcena && ulozeno ? (
                <p style={{ ...hlaska, color: "var(--good)" }}>Uloženo.</p>
              ) : null}

              <button type="submit" className="ft-tl ft-tl-hlavni" style={{ marginTop: "16px" }}>
                Uložit
              </button>
            </form>

            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-md)",
                padding: "16px 18px",
                boxShadow: "var(--shadow)",
                display: "grid",
                gap: "10px",
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: "13.5px", fontWeight: 600 }}>Fotka pozadí</p>
                <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
                  Hero banner na Dnes. Beze fotky nese jen barvu pobočky.
                </p>
              </div>

              {!novaPoleHotova ? (
                <p style={{ margin: 0, fontSize: "12.5px", color: "var(--muted)" }}>
                  Tahle část čeká na nasazení databáze (migrace{" "}
                  <code>20260916160000_pobocka_pozadi</code>).
                </p>
              ) : (
                <>
                  {nahled ? (
                    // eslint-disable-next-line @next/next/no-img-element -- podepsaný odkaz, ne statická cesta; next/image by ho nešlo cachovat rozumně.
                    <img
                      src={nahled}
                      alt=""
                      style={{
                        width: "100%",
                        maxWidth: "360px",
                        height: "120px",
                        objectFit: "cover",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--line-2)",
                      }}
                    />
                  ) : null}

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <form action={nahratPozadiPobocky} encType="multipart/form-data" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="pobocka" value={p.id} />
                      <input type="file" name="fotka" accept="image/jpeg,image/png,image/webp" required style={{ fontSize: "13px", maxWidth: "220px" }} />
                      <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                        {nahled ? "Nahradit" : "Nahrát"}
                      </button>
                    </form>

                    {nahled ? (
                      <form action={smazatPozadiPobocky}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="pobocka" value={p.id} />
                        <button type="submit" className="ft-tl ft-tl-nebezpecne ft-tl-male">
                          Smazat
                        </button>
                      </form>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* --- styly a hlášky ---------------------------------------------- */

const stitek = {
  display: "block",
  fontSize: "12px",
  color: "var(--muted)",
  marginBottom: "6px",
} as const;

const pole = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const hlaska = {
  margin: "14px 0 0",
  fontSize: "13px",
} as const;

function popisChyby(kod: string): string {
  switch (kod) {
    case "nazev":
      return "Název nesmí zůstat prázdný.";
    case "barva":
      return "Vyberte prosím barvu z palety.";
    case "hodina":
      return "Zadejte čas ve tvaru HH:MM.";
    case "pravo":
      return "Na úpravu pobočky nemáte oprávnění.";
    case "fotka":
      return "Fotka musí být JPG, PNG nebo WebP.";
    case "nahrani":
      return "Fotku se nepodařilo nahrát. Zkuste to prosím znovu.";
    case "souradnice":
      return "Zadejte obě souřadnice (šířku i délku), nebo žádnou.";
    default:
      return "Pobočku se nepodařilo uložit. Zkuste to prosím znovu.";
  }
}
