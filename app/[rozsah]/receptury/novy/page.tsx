import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { vytvoritRecepturu } from "../akce";
import FormularReceptury from "../formular-receptury";
import type { KatalogSurovina } from "../spolecne";

export const dynamic = "force-dynamic";

/**
 * Nová receptura — název, kategorie, porce, instrukce a suroviny,
 * jedním odesláním (receptury/akce.ts, vytvoritRecepturu).
 *
 * Kdo tohle smí, rozhoduje recipes.manage na rozsahu — stejné právo,
 * které hlídá politika recipes_write v databázi. Stránka to ověřuje
 * jen proto, aby formulář vůbec neviděl ten, komu by ho databáze
 * stejně odmítla — dvě linie, ne jedna.
 */
export default async function NovaReceptura({
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

  const pristup = await zkusPristup(tenantId, "recipes.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return <Sdeleni nadpis="Sem nemáte přístup">Nové receptury zakládá jen ten, kdo smí spravovat recepty.</Sdeleni>;
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, base_unit")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new DotazSelhal("katalog surovin", error);
  const katalog = (data ?? []) as KatalogSurovina[];

  return (
    <>
      <Nadpis
        oci="Receptury"
        popis="Název, kategorie, porce a suroviny. Prázdné řádky surovin se přeskočí."
        vpravo={
          <Link href={`/${rozsah}/receptury`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Zpět na receptury
          </Link>
        }
      >
        Nová receptura
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <FormularReceptury akce={vytvoritRecepturu} rozsah={rozsah} katalog={katalog} chyba={chyba ?? null} />
      </div>
    </>
  );
}
