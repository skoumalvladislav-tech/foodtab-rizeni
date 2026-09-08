import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { odkazNaPrihlaseni } from "@/lib/prihlaseni-adresa";

import {
  canSee,
  getContext,
  getUser,
  jeVedeni,
  maOpravneni,
  TENANT_SCOPE_SEGMENT,
  type Context,
} from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import CekajiciPozvanka, { nactiCekajici } from "@/app/cekajici-pozvanka";
import CekaNaOpravneni from "./ceka-na-opravneni";
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
  if (!user) {
    /*
      Kdo naskenoval QR z tabletu a není přihlášený, má po přihlášení
      dostat jinou větu než ostatní: ten kód už mezitím vypršel a musí
      k tabletu znovu. Příznak se veze přes přihlášení až do callbacku.

      Adresu podává proxy hlavičkou — layout `searchParams` nedostává.
    */
    const adresa = (await headers()).get("x-foodtab-adresa") ?? "";
    const zQr = adresa.includes("kod=");
    /*
      Adresa se veze DÁL, aby se člověk po přihlášení vrátil tam, kam
      šel. Sama `/prihlaseni` už tu hlavičku má nastavenou na sebe —
      přesměrování je nový požadavek —, takže se to musí zabalit teď.
    */
    redirect(await odkazNaPrihlaseni(zQr ? { qr: "1" } : {}));
  }

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    const cekajici = await nactiCekajici();
    if (cekajici.length > 0) {
      return <CekajiciPozvanka pozvanky={cekajici} />;
    }

    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Až vás někdo do firmy pozve, přijde vám e-mail s odkazem — stačí
        počkat, nebo se ozvat tomu, kdo firmu spravuje.
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
    Kdo čeká na přidělení oprávnění, není odmítnutý — jen mu zatím
    nikdo nic nedal. Hláška „Sem nemáte přístup“ by ho poslala shánět
    úpravu oprávnění, které ještě žádné nemá. Viz docs/pozvanky-zadani.md.
  */
  if (!maOpravneni(ctx)) redirect("/zatim-bez-opravneni");

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

  /*
    ŘADA MODULŮ JEN VEDENÍ.

    Vypnutý modul se v liště kreslí schválně — zákazník má vidět, co si
    může přikoupit. Jenže zaměstnanci ne: číšníkovi nabídka Tvorby menu,
    Financí a Marketingu nepatří. Do těch modulů se stejně nedostane,
    zabírá to nejcennější místo na obrazovce a na iPhonu to lezlo pod
    ostrůvek (docs/dnes-obrazovka-zadani.md, oddíl 5).

    Rozhoduje PRÁVO, ne název role (pravidlo 2). Není to zámek —
    o přístupu rozhoduje dál `app.has_access` a RLS; tohle je jen
    o tom, co se kreslí.
  */
  /*
    A VYPNUTÉ MODULY JEN TOMU, KDO JE MŮŽE ZAPNOUT.

    `jeVedeni` je vedení obecně — vedoucí směny s `people.manage` sem
    spadá taky. Jenže nabídka toho, co si firma může PŘIKOUPIT, patří
    tomu, kdo o tom rozhoduje, a to je `settings.manage`. Vedoucímu
    směny se tedy kreslí jen moduly, které firma opravdu má.

    Zadání docs/rychlost-a-pohled-zamestnance.md, část 2, bod 1.
  */
  const smiVidetVypnute = canSee(ctx, "settings.manage");
  const moduly: ModulProp[] = jeVedeni(ctx)
    ? ctx.modules
        .filter((m) => m.active || smiVidetVypnute)
        .map((m) => {
        const prvni = polozky.find((p) => p.modul === m.key && p.hotovo);
        return {
          klic: m.key,
          nazev: m.label || NAZVY_MODULU[m.key],
          aktivni: m.active,
          cil: m.active && prvni ? `/${rozsah}/${prvni.segment}` : null,
        };
      })
    : [];

  const nastaveni: PolozkaProp[] = polozkyNastaveni(ctx).map((p) => ({
    segment: p.segment,
    adresa: p.adresa,
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

  /*
    Nepřečtená upozornění do zvonečku. Politika na notifications pustí
    jen vlastní řádky, takže se tu nefiltruje podle uživatele znovu.

    Chyba se schválně nevyhazuje: dokud neproběhne migrace
    20260901130000, tabulka neexistuje a zvoneček prostě ukazuje nulu.
    Kvůli počítadlu nemá padat celý rám aplikace.
  */
  const { count: neprectenych } = await (await getServerSupabase())
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("read_at", null);

  /*
    Kdo čeká na přidělení oprávnění.

    Průzor pustí dovnitř jen toho, kdo ve firmě spravuje lidi, takže se
    tu právo neověřuje podruhé — ostatním se vrátí prázdno.

    Chyba se schválně nevyhazuje: dokud neproběhne migrace
    20260902070000, funkce neexistuje a okno se prostě neukáže. Kvůli
    upozornění nemá padat celý rám aplikace.
  */
  const { data: cekajiciNaOpravneni } = await (await getServerSupabase()).rpc(
    "cekaji_na_opravneni",
    { p_tenant: tenantId },
  );

  // Ozubené kolo nevisí na settings.manage. Kdo má právo aspoň na jednu
  // obrazovku nastavení — třeba jen na Lidi přes people.manage — se tam
  // musí dostat, a to na tu obrazovku, kterou opravdu smí vidět.
  const prvniNastaveni = nastaveni.find((p) => p.hotovo);
  const cilNastaveni = prvniNastaveni
    ? (prvniNastaveni.adresa ?? `/${rozsah}/${prvniNastaveni.segment}`)
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
      neprectenych={neprectenych ?? 0}
      moduly={moduly}
      polozky={polozky}
      nastaveni={nastaveni}
      cilNastaveni={cilNastaveni}
    >
      {/*
        PRUH O OSOBNÍCH ÚDAJÍCH TU SCHVÁLNĚ NENÍ.

        Kreslil se nad obsahem na KAŽDÉ obrazovce, dokud ho člověk
        neodklikl — a stálo u něj, že text čeká na právníka. Číšník ho
        viděl po každém přihlášení nad docházkou. Odebral Šéfík 8. 9.
        (docs/zarazeni-misto-roli.md, 6.4).

        MIZÍ UPOMÍNKA, NE INFORMACE. Povinnost informovat zaměstnance,
        co o nich firma vede, platí dál a celý text zůstává na Moje
        údaje pod kotvou `#informace`, aby fungovaly staré odkazy.

        Komponenta `pruh-informace.tsx` ani tabulky `privacy_notices`
        a `privacy_acknowledgements` se NEMAŽOU — až bude text od
        právníka, bude se to hodit. Vrátit se to sem dá jedním řádkem.
      */}
      {/*
        Okno jen tehdy, když někdo čeká. Když pozvánka oprávnění nesla,
        stačí zvoneček — viz komentář v ceka-na-opravneni.tsx.
      */}
      <CekaNaOpravneni
        rozsah={rozsah}
        lide={(cekajiciNaOpravneni ?? []) as { user_id: string; jmeno: string }[]}
      />
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
