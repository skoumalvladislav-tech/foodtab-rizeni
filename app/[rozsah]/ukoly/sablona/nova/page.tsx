import Link from "next/link";
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../../nadpis";
import { vytvoritSablonuChecklistu } from "../../akce";
import FormularSablony from "./formular-sablony";

export const dynamic = "force-dynamic";

/**
 * Nová šablona checklistu — název, úsek, rozvrh a položky, jedním
 * odesláním (viz akce.ts, vytvoritSablonuChecklistu; formulář samotný
 * je formular-sablony.tsx, ať se dá vykreslit i v dočasném náhledu).
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

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na checklisty vaše oprávnění nedosáhne.
      </Sdeleni>
    );
  }

  const { scope } = pristup;

  if (!scope.branchId) {
    return (
      <Sdeleni nadpis="Vyberte pobočku">
        Checklist se zakládá na konkrétní pobočku. Přepněte se na ni
        nahoře a zkuste to znovu.
      </Sdeleni>
    );
  }

  const smiZadat = await hasAccess(tenantId, "tasks.manage", scope.branchId);
  if (!smiZadat) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nové checklisty zakládá jen ten, kdo smí zadávat úkoly na téhle
        pobočce.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);
  const useky = (usekyData ?? []) as { id: string; nazev: string }[];

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  return (
    <>
      <Nadpis
        oci="Checklist"
        popis="Název, úsek a položky. Prázdné řádky se přeskočí."
        vpravo={
          <Link href={`/${rozsah}/ukoly#checklisty`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Zpět na úkoly
          </Link>
        }
      >
        Nový checklist
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px", maxWidth: "720px" }}>
        <FormularSablony
          akce={vytvoritSablonuChecklistu}
          rozsah={rozsah}
          useky={useky}
          chyba={chyba}
        />
      </div>
    </>
  );
}
