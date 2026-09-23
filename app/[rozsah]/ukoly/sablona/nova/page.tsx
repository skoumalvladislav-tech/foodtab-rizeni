import Link from "next/link";
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../../nadpis";
import { vytvoritSablonuChecklistu } from "../../checklisty/akce";
import FormularSablony from "./formular-sablony";

export const dynamic = "force-dynamic";

/**
 * Nová šablona checklistu — název, úsek, rozvrh a položky, jedním
 * odesláním (checklisty/akce.ts, vytvoritSablonuChecklistu).
 *
 * Kdo tohle smí, rozhoduje `tasks.manage` na pobočce — stejné právo,
 * které hlídá politika checklist_templates_write v databázi. Stránka to
 * ověřuje jen proto, aby formulář vůbec neviděl ten, komu by ho databáze
 * stejně odmítla — dvě linie, ne jedna.
 */
export default async function NovaSablonaChecklistu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>;
  }

  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return <Sdeleni nadpis="Sem nemáte přístup">Na checklisty vaše oprávnění nedosáhne.</Sdeleni>;
  }

  const { scope } = pristup;
  if (!scope.branchId) {
    return (
      <Sdeleni nadpis="Vyberte pobočku">
        Checklist se zakládá na konkrétní pobočku. Přepněte se na ni nahoře a zkuste to znovu.
      </Sdeleni>
    );
  }

  if (!(await hasAccess(tenantId, "tasks.manage", scope.branchId))) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nové checklisty zakládá jen ten, kdo smí zadávat úkoly na téhle pobočce.
      </Sdeleni>
    );
  }

  const supabase = await getServerSupabase();
  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);

  // Nasazená migrace? (Nové rozvrhy, sekce, instrukce, povinnost.)
  const pokus = await supabase.from("checklist_templates").select("dny_v_tydnu").limit(1);
  if (pokus.error && !sloupecNeexistuje(pokus.error)) throw new DotazSelhal("šablony", pokus.error);
  const plne = !pokus.error;

  return (
    <>
      <Nadpis
        oci="Checklisty"
        popis="Název, kdy se dělá a položky. Prázdné řádky se přeskočí."
        vpravo={
          <Link href={`/${rozsah}/ukoly/checklisty?cl=sablony`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Zpět na checklisty
          </Link>
        }
      >
        Nový checklist
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <FormularSablony
          akce={vytvoritSablonuChecklistu}
          rozsah={rozsah}
          useky={(usekyData ?? []) as { id: string; nazev: string }[]}
          chyba={chyba ?? null}
          plne={plne}
        />
      </div>
    </>
  );
}
