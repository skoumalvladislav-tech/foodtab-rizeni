import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";

export const dynamic = "force-dynamic";

/**
 * Marketing — zatím jen ohlášení.
 *
 * Modul a jeho tři oprávnění (marketing.read/manage/publish) existují
 * od úplného začátku (supabase/migrations/20260823120100_catalog.sql).
 * Tahle obrazovka a datové tabulky (20260903040000_marketing_tabulky.sql)
 * jsou první krok podle docs/marketing-zadani.md, oddíl 7 — jen tolik,
 * aby modul šel zapnout a měl kam ukládat. Skutečné navrhování a
 * publikování příspěvků je samostatný, pozdější krok.
 *
 * Kontrola přístupu se ptá na marketing.read — nejnižší právo modulu,
 * jen "vidět marketingový plán". Stejně jako u Tvorby menu: patří do
 * modulu `marketing`, takže neprojde u firmy, která modul zapnutý nemá
 * (pravidlo 5 — vypnutý modul odmítne i přímé zadání adresy).
 */
export default async function Marketing({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "marketing.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho chcete používat, řekněte
        si o něj správci firmy — a pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    );
  }

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis="Dílna na denní příspěvky ze schváleného jídelníčku. Nic se nepublikuje samo."
      >
        Marketing
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <Sdeleni nadpis="Připravujeme">
          Modul je zapnutý, ale navrhování a publikování příspěvků zatím
          neumí. Až bude, vznikne tu návrh příspěvku ze schváleného
          jídelníčku, který někdo se schvalovacím oprávněním pustí ven —
          nikdy automaticky.
        </Sdeleni>
      </div>
    </>
  );
}
