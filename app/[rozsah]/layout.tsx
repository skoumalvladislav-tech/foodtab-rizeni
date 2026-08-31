import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import {
  getContext,
  getUser,
  TENANT_SCOPE_SEGMENT,
  type Context,
} from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import Sdeleni from "@/app/sdeleni";
import { NAZVY_MODULU, polozkyNastaveni, polozkyModulu } from "./nabidka";
import Ram, { type ModulProp, type PolozkaProp } from "./ram";
import type { RozsahProp } from "./prepinac-rozsahu";

/**
 * Rám všech obrazovek uvnitř rozsahu.
 *
 * Adresa má tvar /<rozsah>/<obrazovka>, kde <rozsah> je „firma“ nebo slug
 * pobočky. Tomu, co přijde v adrese, se NEVĚŘÍ: resolveScope() ho porovná
 * s pobočkami, které uživateli vrátila databáze, a co nesedí, odmítne.
 *
 * Tady se jen spočítá, co se smí kreslit. Vykreslení má na starosti
 * klientský Ram, protože potřebuje znát adresu, aby zvýraznil správnou
 * položku. Nic z toho není zámek — každá obrazovka si přístup ověřuje
 * sama.
 */
export default async function RozsahLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
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

  // Až za tímhle voláním smí přijít redirect(). Uvnitř odchytávání by se
  // ztratil — redirect() funguje tak, že vyhodí výjimku.
  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni samostatne nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const polozky: PolozkaProp[] = ctx.modules.flatMap((m) =>
    polozkyModulu(ctx, m.key).map((p) => ({
      segment: p.segment,
      nazev: p.nazev,
      kratky: p.kratky,
      ikona: p.ikona,
      hotovo: p.hotovo,
      modul: p.modul,
      jenPobocka: p.jenPobocka,
    })),
  );

  // Vypnutý modul se v liště kreslí taky — zákazník má vidět, co si může
  // přikoupit. Cíl dostane jen ten, kde je aspoň jedna hotová obrazovka.
  const moduly: ModulProp[] = ctx.modules.map((m) => {
    const prvni = polozky.find((p) => p.modul === m.key && p.hotovo);
    return {
      klic: m.key,
      nazev: m.label || NAZVY_MODULU[m.key],
      aktivni: m.active,
      cil: m.active && prvni ? `/${rozsah}/${prvni.segment}` : null,
    };
  });

  const nastaveni: PolozkaProp[] = polozkyNastaveni(ctx).map((p) => ({
    segment: p.segment,
    nazev: p.nazev,
    kratky: p.kratky,
    ikona: p.ikona,
    hotovo: p.hotovo,
    modul: p.modul,
    jenPobocka: p.jenPobocka,
  }));

  // Volby přepínače. „Celá firma“ jen tomu, kdo má firemní členství —
  // vedoucí jedné pobočky ji vidět nemá a databáze by ho tam stejně
  // nepustila. Pobočky jsou ty, které vrátilo my_context, tedy ty,
  // na které uživatel doopravdy vidí.
  const rozsahy: RozsahProp[] = [
    ...(ctx.membership.scope === "tenant"
      ? [
          {
            slug: TENANT_SCOPE_SEGMENT,
            nazev: "Celá firma",
            barva: "firma",
          },
        ]
      : []),
    ...ctx.branches.map((b) => ({
      slug: b.slug,
      nazev: b.name,
      barva: b.color,
    })),
  ];

  // Ozubené kolo nevisí na settings.manage. Kdo má právo aspoň na jednu
  // obrazovku nastavení — třeba jen na Lidi přes people.manage — se tam
  // musí dostat, a to na tu obrazovku, kterou opravdu smí vidět.
  const prvniNastaveni = nastaveni.find((p) => p.hotovo);
  const cilNastaveni = prvniNastaveni
    ? `/${rozsah}/${prvniNastaveni.segment}`
    : null;

  return (
    <Ram
      rozsah={rozsah}
      barva={barvaRozsahu(ctx, scope.branchId)}
      druh={scope.level === "tenant" ? "Rozsah" : "Pobočka"}
      nazevRozsahu={scope.branchName ?? ctx.tenant.name}
      rozsahy={rozsahy}
      aktivniRozsah={scope.branchSlug ?? TENANT_SCOPE_SEGMENT}
      segmentFirmy={TENANT_SCOPE_SEGMENT}
      nazevFirmy={ctx.tenant.name}
      iniciraly={iniciraly(user.email)}
      moduly={moduly}
      polozky={polozky}
      nastaveni={nastaveni}
      cilNastaveni={cilNastaveni}
    >
      {children}
    </Ram>
  );
}

/**
 * Klíč barvy pro rozsah.
 *
 * Firemní úroveň má vlastní klíč "firma", ne "slate". Slate je osmá
 * barva, kterou přidělovací spouštěč dá osmé pobočce — a od chvíle, kdy
 * se klíčem barví celá lišta a sloupec, by firma a osmá pobočka vypadaly
 * úplně stejně. Do databáze se "firma" nikdy neukládá, žije jen tady
 * a v _tokeny.css.
 *
 * Vedle tečky je vždycky název, barva sama nikdy nenese informaci.
 */
function barvaRozsahu(ctx: Context, branchId: string | null): string {
  if (!branchId) return "firma";
  return ctx.branches.find((b) => b.id === branchId)?.color ?? "slate";
}

/**
 * Iniciály do kolečka. Bere se e-mail, protože jméno by znamenalo další
 * dotaz do profiles jen kvůli dvěma písmenům.
 */
function iniciraly(email: string | null): string {
  const zaklad = (email ?? "").split("@")[0] ?? "";
  const casti = zaklad.split(/[^\p{L}]+/u).filter(Boolean);
  if (casti.length >= 2) {
    return (casti[0][0] + casti[1][0]).toUpperCase();
  }
  return (zaklad.slice(0, 2) || "?").toUpperCase();
}
