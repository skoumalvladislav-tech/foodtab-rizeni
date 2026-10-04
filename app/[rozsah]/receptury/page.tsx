import Link from "next/link";
import { redirect } from "next/navigation";

import { pocet } from "@/lib/sklonovani";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Ikona from "../ikona";
import Nadpis from "../nadpis";
import { kc, type NakladPorce } from "./spolecne";

export const dynamic = "force-dynamic";

type RadekReceptury = {
  id: string;
  name: string;
  category: string;
  druh: string;
  portions: number;
};

/**
 * Receptury — seznam.
 *
 * Náklad na porci se počítá při KAŽDÉM vykreslení
 * (public.recipe_cost_per_portion → app.recipe_cost_per_portion,
 * 20261002100000_sklad_suroviny_zaklad.sql) — nikdy se neukládá,
 * komentář v migraci to vysvětluje: "cena se nesmí zamrznout špatně".
 * Neúplná položka se ukazuje jako "Neúplné", nikdy jako 0 Kč ani
 * prázdno (zadání, oddíl 2, bod 1).
 */
export default async function Receptury({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba, ulozeno } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>;
  }

  const pristup = await zkusPristup(tenantId, "recipes.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return <Sdeleni nadpis="Sem nemáte přístup">Na receptury vaše oprávnění nedosáhne.</Sdeleni>;
  }
  const smiSpravovat = (await zkusPristup(tenantId, "recipes.manage", rozsah)).stav === "ok";

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, category, druh, portions")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new DotazSelhal("receptury", error);
  const recepty = (data ?? []) as RadekReceptury[];

  // Náklad na porci pro každou recepturu zvlášť — žádný souhrnný dotaz
  // nad app.recipe_cost_per_portion v projektu není (je to funkce nad
  // jedním id, ne pohled). Dokud migrace s průzorem
  // (public.recipe_cost_per_portion) neběží, PGRST202/42883 znamená
  // "čeká na nasazení", ne chybu receptury.
  let vypocetDostupny = true;
  const naklady = new Map<string, NakladPorce>();
  if (recepty.length > 0) {
    const vysledky = await Promise.all(recepty.map((r) => supabase.rpc("recipe_cost_per_portion", { p_recipe: r.id })));
    for (let i = 0; i < vysledky.length; i++) {
      const { data: nakladData, error: chybaNakladu } = vysledky[i];
      if (chybaNakladu) {
        if (funkceNeexistuje(chybaNakladu)) {
          vypocetDostupny = false;
          continue;
        }
        throw new DotazSelhal("náklad receptury", chybaNakladu);
      }
      const radek = (nakladData as NakladPorce[] | null)?.[0];
      if (radek) naklady.set(recepty[i].id, radek);
    }
  }

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={pocet(recepty.length, "receptura", "receptury", "receptur")}
        vpravo={
          smiSpravovat ? (
            <Link href={`/${rozsah}/receptury/novy`} className="ft-tl ft-tl-hlavni ft-tl-male">
              + Nová receptura
            </Link>
          ) : null
        }
      >
        Receptury
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px", display: "grid", gap: "12px" }}>
        {ulozeno ? <p style={{ margin: 0, fontSize: "13px", color: "var(--dobre)" }}>Uloženo.</p> : null}
        {chyba ? (
          <p className="hlaska-chyba" role="alert">
            {chyba}
          </p>
        ) : null}
        {!vypocetDostupny ? (
          <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>Náklad na porci bude dostupný po nasazení databáze.</p>
        ) : null}

        {recepty.length === 0 ? (
          <div className="ds-plocha" style={{ textAlign: "center", color: "var(--muted)" }}>
            <p style={{ margin: 0 }}>Zatím tu není žádná receptura.</p>
          </div>
        ) : (
          recepty.map((r) => {
            const naklad = naklady.get(r.id) ?? null;
            const uplna = naklad && !naklad.neuplne && naklad.cost_haleru_per_portion !== null;
            return (
              <Link
                key={r.id}
                href={`/${rozsah}/receptury/${r.id}`}
                className="ds-plocha"
                style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none", color: "inherit" }}
              >
                <span aria-hidden="true" style={{ color: "var(--muted)" }}>
                  <Ikona klic={r.druh === "napoj" ? "napoj" : "vidlicka"} />
                </span>
                <span style={{ display: "grid", gap: "2px", minWidth: 0, flex: 1 }}>
                  <strong>{r.name}</strong>
                  <small style={{ color: "var(--muted)" }}>{[r.category || null, pocet(r.portions, "porce", "porce", "porcí")].filter(Boolean).join(" · ")}</small>
                </span>
                {uplna && naklad && naklad.cost_haleru_per_portion !== null ? (
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, whiteSpace: "nowrap" }}>{kc(naklad.cost_haleru_per_portion)} / porce</span>
                ) : naklad ? (
                  <span
                    title={naklad.chybejici_polozky.length > 0 ? naklad.chybejici_polozky.join("; ") : undefined}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "12px",
                      fontWeight: 600,
                      background: "var(--pozor-bg)",
                      color: "var(--pozor)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Neúplné{naklad.chybejici_polozky.length > 0 ? ` — chybí ${naklad.chybejici_polozky[0]}` : ""}
                  </span>
                ) : (
                  <span style={{ color: "var(--faint)", fontSize: "12px" }}>–</span>
                )}
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}
