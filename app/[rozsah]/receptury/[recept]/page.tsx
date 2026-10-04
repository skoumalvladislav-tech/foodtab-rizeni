import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal, funkceNeexistuje, jeden } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { upravitRecepturu } from "../akce";
import FormularReceptury, { type HodnotyReceptury } from "../formular-receptury";
import { kc, type KatalogSurovina, type NakladPorce, type RadekSuroviny } from "../spolecne";

export const dynamic = "force-dynamic";

type Receptura = {
  id: string;
  name: string;
  category: string;
  druh: string;
  portions: number;
  instructions: string;
  active: boolean;
};

type RadekDb = {
  id: string;
  position: number;
  name: string;
  ingredient_id: string | null;
  amount: number;
  unit: string;
  note: string;
};

/**
 * Receptura — detail a úprava.
 *
 * Karta "Náklad na porci" je živá: `public.recipe_cost_per_portion`
 * (→ app.recipe_cost_per_portion) se volá při KAŽDÉM vykreslení, nikde
 * se nic neukládá — migrace (20261002100000_sklad_suroviny_zaklad.sql)
 * to zdůvodňuje: "cena se nesmí zamrznout špatně".
 */
export default async function DetailReceptury({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; recept: string }>;
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>;
}) {
  const { rozsah, recept } = await params;
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
  const smiUpravovat = (await zkusPristup(tenantId, "recipes.manage", rozsah)).stav === "ok";

  const supabase = await getServerSupabase();
  const receptura = await jeden<Receptura>(
    "receptura",
    supabase.from("recipes").select("id, name, category, druh, portions, instructions, active").eq("id", recept).single(),
  );
  if (!receptura) {
    return <Sdeleni nadpis="Receptura nenalezena">Buď neexistuje, nebo na ni (RLS) nemáte přístup.</Sdeleni>;
  }

  const [{ data: polozkyData, error: chybaPolozek }, { data: katalogData, error: chybaKatalogu }, { data: nakladData, error: chybaNakladu }] =
    await Promise.all([
      supabase
        .from("recipe_ingredients")
        .select("id, position, name, ingredient_id, amount, unit, note")
        .eq("recipe_id", recept)
        .order("position", { ascending: true }),
      supabase.from("ingredients").select("id, name, base_unit").eq("tenant_id", tenantId).eq("active", true).order("name", { ascending: true }),
      supabase.rpc("recipe_cost_per_portion", { p_recipe: recept }),
    ]);
  if (chybaPolozek) throw new DotazSelhal("suroviny receptury", chybaPolozek);
  if (chybaKatalogu) throw new DotazSelhal("katalog surovin", chybaKatalogu);
  if (chybaNakladu && !funkceNeexistuje(chybaNakladu)) throw new DotazSelhal("náklad receptury", chybaNakladu);

  const polozky = (polozkyData ?? []) as RadekDb[];
  const katalog = (katalogData ?? []) as KatalogSurovina[];
  const naklad = (nakladData as NakladPorce[] | null)?.[0] ?? null;
  const vypocetDostupny = !chybaNakladu || !funkceNeexistuje(chybaNakladu);

  const vychozi: HodnotyReceptury = {
    nazev: receptura.name,
    kategorie: receptura.category,
    druh: receptura.druh,
    porce: String(receptura.portions),
    instrukce: receptura.instructions,
    aktivni: receptura.active,
    radky: polozky.map(
      (p): RadekSuroviny => ({
        id: p.id,
        ingredientId: p.ingredient_id,
        name: p.name,
        amount: String(p.amount),
        unit: p.unit,
        note: p.note,
      }),
    ),
  };

  return (
    <>
      <Nadpis
        oci="Receptury"
        popis={receptura.category || undefined}
        vpravo={
          <Link href={`/${rozsah}/receptury`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Zpět na receptury
          </Link>
        }
      >
        {receptura.name}
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px", display: "grid", gap: "16px" }}>
        {ulozeno ? <p style={{ margin: 0, fontSize: "13px", color: "var(--dobre)" }}>Uloženo.</p> : null}

        <section className="ds-plocha" style={{ display: "grid", gap: "6px" }}>
          <h2 style={{ margin: 0, fontSize: "17px" }}>Náklad na porci</h2>
          {naklad && !naklad.neuplne && naklad.cost_haleru_per_portion !== null ? (
            <p style={{ margin: 0, fontSize: "24px", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{kc(naklad.cost_haleru_per_portion)}</p>
          ) : naklad ? (
            <>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--pozor)" }}>Neúplné</p>
              {naklad.chybejici_polozky.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--muted)" }}>
                  {naklad.chybejici_polozky.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
              {vypocetDostupny ? "Databáze náklad nevrátila." : "Výpočet nákladu bude dostupný po nasazení databáze."}
            </p>
          )}
          <p style={{ margin: 0, fontSize: "12px", color: "var(--faint)" }}>Přepočítává se při každém zobrazení — neukládá se, ceny surovin se mění.</p>
        </section>

        {smiUpravovat ? (
          <FormularReceptury akce={upravitRecepturu} rozsah={rozsah} katalog={katalog} chyba={chyba ?? null} receptId={receptura.id} vychozi={vychozi} />
        ) : (
          <Sdeleni nadpis="Jen ke čtení">Úpravu receptur má jen ten, kdo smí spravovat recepty.</Sdeleni>
        )}
      </div>
    </>
  );
}
