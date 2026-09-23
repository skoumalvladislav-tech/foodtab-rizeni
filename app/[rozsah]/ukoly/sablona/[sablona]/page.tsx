import Link from "next/link";
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../../nadpis";
import { upravitSablonu } from "../../checklisty/akce";
import FormularSablony, { type RadekFormulare } from "../nova/formular-sablony";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Úprava šablony checklistu (zadání bod 25).
 *
 * Ukládá přes public.upravit_sablonu_checklistu: odebrané položky se
 * vyřadí, ne smažou, a když se obsah položek změnil, vznikne nová verze.
 * Rozdělané i hotové běhy drží svou verzi — úprava je nezmění (bod 24/47).
 */
export default async function UpravitSablonu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; sablona: string }>;
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>;
}) {
  const { rozsah, sablona } = await params;
  const { chyba, ulozeno } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>;
  }
  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren" || !UUID.test(sablona)) {
    return <Sdeleni nadpis="Sem nemáte přístup">Na checklisty vaše oprávnění nedosáhne.</Sdeleni>;
  }

  const supabase = await getServerSupabase();

  // `sloupce: string` (ne literál): oba výběry mají stejný typ, takže
  // tolerantní druhý pokus jde přiřadit do téže proměnné.
  const nactiSablonu = (sloupce: string): PromiseLike<{ data: unknown; error: unknown }> =>
    supabase.from("checklist_templates").select(sloupce).eq("id", sablona).eq("tenant_id", tenantId).limit(1);

  let plne = true;
  let { data: tplData, error: chybaTpl } = await nactiSablonu(
    "id, name, schedule, usek_id, branch_id, active, dny_v_tydnu, vyzaduje_potvrzeni",
  );
  if (chybaTpl && sloupecNeexistuje(chybaTpl as Parameters<typeof sloupecNeexistuje>[0])) {
    plne = false;
    ({ data: tplData, error: chybaTpl } = await nactiSablonu("id, name, schedule, usek_id, branch_id, active"));
  }
  if (chybaTpl) throw new DotazSelhal("šablona checklistu", chybaTpl as ConstructorParameters<typeof DotazSelhal>[1]);
  const t = (tplData as Record<string, unknown>[] | null)?.[0];
  if (!t) {
    return (
      <Sdeleni nadpis="Šablona nenalezena">
        Buď neexistuje, nebo není vaše. <Link href={`/${rozsah}/ukoly/checklisty?cl=sablony`}>Zpět na šablony</Link>.
      </Sdeleni>
    );
  }

  if (!(await hasAccess(tenantId, "tasks.manage", (t.branch_id as string | null) ?? null))) {
    return <Sdeleni nadpis="Sem nemáte přístup">Šablony upravuje jen ten, kdo smí zadávat úkoly na téhle pobočce.</Sdeleni>;
  }

  const sloupcePolozek = plne
    ? "id, position, label, section, instructions, povinna, requires_value, value_type, value_unit, min_value, max_value, active"
    : "id, position, label, requires_value, value_type, value_unit, min_value, max_value";
  const { data: polozkyData, error: chybaPolozek } = await supabase
    .from("checklist_items")
    .select(sloupcePolozek)
    .eq("template_id", sablona)
    .order("position", { ascending: true });
  if (chybaPolozek) throw new DotazSelhal("položky šablony", chybaPolozek);

  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);

  const cislo = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  const polozky: RadekFormulare[] = ((polozkyData ?? []) as unknown as Record<string, unknown>[])
    .filter((p) => p.active !== false)
    .map((p) => ({
      id: String(p.id),
      nazev: String(p.label ?? ""),
      sekce: String(p.section ?? ""),
      instrukce: String(p.instructions ?? ""),
      povinna: p.povinna === undefined ? true : p.povinna !== false,
      vyzaduje: p.requires_value === true,
      typ: p.value_type === "text" || p.value_type === "photo" ? p.value_type : "number",
      jednotka: String(p.value_unit ?? ""),
      min: cislo(p.min_value),
      max: cislo(p.max_value),
    }));

  return (
    <>
      <Nadpis
        oci="Checklisty"
        popis="Úprava platí pro nové checklisty. Rozdělané a hotové drží obsah, se kterým vznikly."
        vpravo={
          <Link href={`/${rozsah}/ukoly/checklisty?cl=sablony`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Zpět na šablony
          </Link>
        }
      >
        {String(t.name)}
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {ulozeno ? (
          <p className="ck-hlaska-ok" role="status" style={{ marginBottom: "14px", maxWidth: "860px" }}>
            Šablona je uložená.
          </p>
        ) : null}
        {!plne ? (
          <p className="pc-poznamka-navrhu" style={{ marginBottom: "14px", maxWidth: "860px" }}>
            Úprava šablon bude dostupná po nasazení databáze (verze šablon). Dosud se dala šablona jen založit.
          </p>
        ) : null}
        <FormularSablony
          akce={upravitSablonu}
          rozsah={rozsah}
          useky={(usekyData ?? []) as { id: string; nazev: string }[]}
          chyba={chyba ?? null}
          sablonaId={sablona}
          plne={plne}
          vychozi={{
            nazev: String(t.name ?? ""),
            usek: (t.usek_id as string | null) ?? null,
            rozvrh: String(t.schedule ?? "daily"),
            dny: Array.isArray(t.dny_v_tydnu) ? (t.dny_v_tydnu as number[]).map(Number) : [],
            potvrzeni: t.vyzaduje_potvrzeni === true,
            aktivni: t.active !== false,
            polozky,
          }}
        />
      </div>
    </>
  );
}
