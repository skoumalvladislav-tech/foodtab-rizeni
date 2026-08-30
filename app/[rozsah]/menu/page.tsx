import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";

export const dynamic = "force-dynamic";

/**
 * Tvorba menu — zatím jen ohlášení.
 *
 * Modul existuje, funkce ještě ne. Zadání (docs/modul-menu-zadani.md,
 * oddíl 7) říká výslovně, že se do vysvětlení agenta nemá nic domýšlet:
 * podle čeho navrhovat, na jak dlouho dopředu ani kdo návrh schvaluje
 * zatím není rozhodnuté. Prázdná obrazovka je proto správný stav, ne
 * nedodělek.
 *
 * Kontrola přístupu tu ale prázdná není. Stránka se ptá na menu_ai.use,
 * a protože to oprávnění patří do modulu `menu`, neprojde u firmy, která
 * modul zapnutý nemá — ani majiteli. Přesně o tom je pravidlo 5: vypnutý
 * modul musí odmítnout i přímé zadání adresy, ne jen schovat položku
 * v nabídce. Odsud se to nedá obejít vynecháním kontroly, protože
 * rozhoduje app.has_access() nad tenant_modules.
 */
export default async function TvorbaMenu({
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

  const pristup = await zkusPristup(tenantId, "menu_ai.use", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Tvorba menu není zapnutá">
        Modul si firma zapíná zvlášť. Pokud ho chcete používat, řekněte
        si o něj správci firmy — a pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    );
  }

  return (
    <>
      <Nadpis
        oci="Tvorba menu"
        popis="Dílna na návrhy denního menu a stálého lístku. Hotové lístky zůstávají v Provozu."
      >
        Tvorba menu
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <Sdeleni nadpis="Připravujeme">
          Modul je zapnutý, ale navrhování zatím neumí. Až bude, vznikne
          tu návrh menu, který někdo schválí — teprve schválením se
          z návrhu stane jídelní lístek.
        </Sdeleni>
      </div>
    </>
  );
}
