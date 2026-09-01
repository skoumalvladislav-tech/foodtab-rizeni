import { redirect } from "next/navigation";

import { getContext, getUser } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import CekajiciPozvanka, { nactiCekajici } from "@/app/cekajici-pozvanka";

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
    /*
      Nejdřív se podíváme, jestli na tuhle adresu nečeká pozvánka
      (docs/ukoly-codea-drobnosti-2026-09-01.md, bod 7a). Radit člověku,
      ať si zařídí něco, co už má, je to nejhorší, co může aplikace
      udělat hned po přihlášení — a přesně to dělala.
    */
    const cekajici = await nactiCekajici();
    if (cekajici.length > 0) {
      return <CekajiciPozvanka pozvanky={cekajici} />;
    }

    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
        členství. Až vás někdo do firmy pozve, přijde vám e-mail
        s odkazem — stačí počkat, nebo se ozvat tomu, kdo firmu spravuje.
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

  /*
    Člen bez přiděleného oprávnění (docs/pozvanky-zadani.md, oddíl 2
    bod 2). Pozvánka smí přijít bez role — teprve vedoucí pak rozhodne,
    co člověk uvidí.

    Má to vlastní adresu, ne jen jinou větev téhle stránky: obrazovka
    se ze své podstaty ukazuje člověku bez rozsahu a musí jít poslat
    odkazem („mrkni sem, ozvi se mi“).
  */
  if (!ctx.role) redirect("/zatim-bez-opravneni");

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
