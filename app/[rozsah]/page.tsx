import { redirect } from "next/navigation";

import { getContext, getUser, maOpravneni } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { vychoziObrazovka } from "@/lib/vychozi-obrazovka";
import Sdeleni from "@/app/sdeleni";
import { viditelnaNabidka } from "./nabidka";

/**
 * Holá adresa rozsahu — `/<rozsah>` — už nic nekreslí.
 *
 * ROZCESTNÍK JE PRYČ (Šéfík 24. 9. 2026: „odstraň kartu rozcestník — je
 * zbytečná"). Byla tu mřížka dlaždic „Kam dál", pod ní přepínač vzhledu
 * a odhlášení. Domovská obrazovka je od 16. 9. Dnes a všechno ostatní
 * se přestěhovalo do výsuvného menu „Více" ve spodní liště na telefonu
 * (`components/shell/MobileVice.tsx`) — obrazovky všech modulů,
 * Nastavení, Moje údaje, Vzhled i Odhlásit se. Na počítači a tabletu
 * je Odhlásit se vlevo dole na konci levého sloupce
 * (`components/shell/ModuleSidebar.tsx`), Moje údaje a Vzhled
 * v nabídce pod iniciálami v horní liště (`components/shell/MenuUctu.tsx`).
 *
 * Adresa zůstává a přesměruje tam, kam vede i logo: na Dnes, a když by
 * ji člověk neměl, na první hotovou obrazovku, kterou smí
 * (`lib/vychozi-obrazovka.ts`). Starý odkaz na dotaz k odhlášení
 * (`?odhlasit=1`) skončí taky na Dnes — dotaz je teď v „Více"
 * a vlevo dole.
 *
 * ---------------------------------------------------------------------
 * PROČ `redirect`, NE `permanentRedirect`
 *
 * Trvalé přesměrování (308) si prohlížeč zapamatuje napořád a příště se
 * serveru už nezeptá. Tady ale cíl závisí na tom, kdo je přihlášený a co
 * smí — na sdíleném telefonu za barem se střídá víc lidí. Dočasné
 * přesměrování stojí jeden dotaz navíc a nikdy nepošle člověka na
 * obrazovku spočítanou pro někoho jiného.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TU TAK OPATRNĚ VRACÍ `null`
 *
 * Layout a stránka se v App Routeru renderují paralelně. Nepřihlášeného
 * posílá na přihlášení LAYOUT, i s adresou, kam šel; kdyby tady
 * přesměrování přišlo dřív, cíl by se ztratil. Stejně tak „čeká na
 * oprávnění" a „sem nemáte přístup" řeší layout. Stránka proto
 * přesměrovává, jen když je jasné kam, a jinak nechá mluvit layout.
 */
export default async function RozsahBezObrazovky({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  const user = await getUser();
  if (!user) return null;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  const ctx = await getContext(tenantId);
  if (!ctx || !maOpravneni(ctx)) return null;

  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) return null;

  const cil = vychoziObrazovka(viditelnaNabidka(ctx), scope.level === "tenant");

  if (!cil) {
    return (
      <Sdeleni nadpis="Zatím tu pro vás nic není">
        Vaše oprávnění nemá otevřenou žádnou obrazovku. Řekněte si správci
        firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  // Až za všemi kontrolami: redirect() funguje tak, že vyhodí výjimku.
  redirect(`/${scope.branchSlug}/${cil}`);
}
