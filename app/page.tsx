import { redirect } from "next/navigation";

import { getContext, getUser } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";

export const dynamic = "force-dynamic";

/**
 * Rozcestí po přihlášení.
 *
 * Nepřihlášený jde na přihlášení. Přihlášený jde tam, kam podle své role
 * patří — na firemní úroveň, nebo na svou první pobočku. To rozhodnutí
 * nedělá tahle stránka: dělá ho resolveScope() v authz, stejná funkce,
 * kterou používají i adresy s výslovným rozsahem.
 */
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
        členství. Požádejte o pozvánku někoho, kdo firmu ve Foodtabu už
        spravuje.
      </Sdeleni>
    );
  }

  const ctx = await getContext(tenantId);
  if (!ctx) {
    return (
      <Sdeleni samostatne nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu. Pokud potíž trvá, ozvěte se
        správci firmy.
      </Sdeleni>
    );
  }

  // Bez určení rozsahu: resolveScope() vybere firemní úroveň tomu, kdo na
  // ni má, ostatním jejich první pobočku.
  const scope = bezpecnyRozsah(ctx);
  if (!scope) {
    return (
      <Sdeleni samostatne nadpis="Není kam vás pustit">
        Vaše členství je vedené na pobočku, ale žádná vám zatím není
        přiřazená. Doplní ji správce firmy.
      </Sdeleni>
    );
  }

  // Až za vyhodnocením rozsahu: redirect() funguje tak, že vyhodí
  // výjimku, a uvnitř odchytávání by se ztratila.
  redirect(`/${scope.branchSlug}`);
}
