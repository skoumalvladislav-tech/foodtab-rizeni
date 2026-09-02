import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getContext, getUser, hasAccess } from "@/lib/authz";
import { hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import {
  dnu,
  hodinyAMinuty,
  koruny,
  nazevMesice,
  prvniDenMesice,
  sazbaZaHodinu,
} from "@/lib/mzdy";
import { lideProPobocku } from "@/lib/lide-pobocky";
import { pocet, prisudek } from "@/lib/sklonovani";
import { posunDatum, provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { zapsatDochazku } from "./akce";
import PanelRucni from "./panel-rucni";
import PanelNedokoncene from "./panel-nedokoncene";
import PoleKodu from "./pole-kodu";

export const dynamic = "force-dynamic";

/**
 * Docházka — příchod, odchod a moje směny na jednom místě.
 *
 * Obrazovka Moje směny se sem sloučila. Byly to dvě obrazovky o téže
 * věci: co mám dneska za směnu a jestli na ní zrovna jsem. Kdo si
 * přišel píchnout, hned vidí, co ho čeká; kdo se přišel podívat na
 * směny, má píchačku po ruce. Rozpis směn tím dotčený není — to je
 * rozpis všech lidí, ne můj.
 *
 * Na rozdíl od ostatních obrazovek se nezavírá na jedno oprávnění.
 * Vlastní příchod si zapisuje každý zaměstnanec s účtem — říká to tak
 * i politika attendance_insert. `attendance.read` rozhoduje až o tom,
 * jestli člověk uvidí i ostatní.
 *
 * Provozní den se nepočítá v kódu, ptá se na něj databáze.
 */

type Udalost = {
  id: string;
  employee_id: string;
  kind: string;
  occurred_at: string;
  branch_id: string;
};

type Smena = {
  id: string;
  branch_id: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

type Kolega = {
  branch_id: string;
  shift_date: string;
  employee_id: string | null;
};

/** Jak dopadla docházka u odpracované směny. */
type StavDochazky = "uzavrena" | "neuzavrena" | "bez_zaznamu";

/** Výsledek public.muj_vyplatni_prehled — hotová čísla z databáze. */
type Vydelek = {
  odpracovano_minut: number;
  vydelano_haleru: number;
  zalohy_haleru: number;
  zbyva_haleru: number;
  zaloh_nepotvrzenych: number;
  /**
   * Pozastavené zálohy. Ukazuje se schválně: kdo to neví, přijde
   * si k okénku a odmítnutí zjistí před kolegy.
   * Viz docs/pozastaveni-zaloh-zadani.md, oddíl 4.
   */
  zalohy_pozastavene: boolean;
  /**
   * Volba firmy, jak se mají zálohy ukázat. Chodí spolu s čísly
   * schválně: kdyby si obrazovka skládala součty z dvou dotazů, dřív
   * nebo později by ukázala „zbývá k výplatě“ tam, kde si to firma
   * nepřeje. Viz docs/kiosek-pin-zalohy-zadani.md, oddíl 7.
   */
  zobrazeni: "odecitat" | "jen_ukazat" | "neukazovat";
  dnu_bez_dochazky: number;
  sazba_chybi: boolean;
  hodinova_haleru: number | null;
};

export default async function Dochazka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{
    chyba?: string;
    zapsano?: string;
    mesic?: string;
    doplnit?: string;
    den?: string;
    /** Kód z QR na tabletu. Předvyplní políčko, nic nezapisuje. */
    kod?: string;
  }>;
}) {
  const { rozsah } = await params;
  const {
    chyba: chybaRucne,
    zapsano,
    mesic: mesicParam,
    doplnit,
    den: denDoplneni,
    kod: kodZQr,
  } = await searchParams;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const ctx = await getContext(tenantId);
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    );
  }

  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  // Rozhoduje jen o tom, jestli uvidí i ostatní. Vlastní docházku má
  // každý bez ohledu na tohle.
  const vidiOstatni = await hasAccess(
    tenantId,
    "attendance.read",
    scope.branchId,
  );

  // Ruční zápis je jiné právo než čtení: kdo docházku vidí, ještě ji
  // nesmí vyrábět. Formulář se podle toho kreslí, ale zámek je
  // v politice attendance_insert.
  const smiZapsatRucne = await hasAccess(
    tenantId,
    "attendance.manage",
    scope.branchId,
  );

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  const { data: zaznamy, error: chybaZaznamy } = await supabase
    .from("employees")
    .select("id, branch_id, full_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1);
  if (chybaZaznamy) throw new DotazSelhal("zaměstnanci", chybaZaznamy);

  const ja = zaznamy?.[0] as
    | { id: string; branch_id: string | null; full_name: string }
    | undefined;

  /*
    Bez zaměstnaneckého záznamu se nedá píchat ani stát na směně —
    obojí visí na zaměstnanci, ne na účtu. Není to ale chyba a nemá to
    obrazovku shodit: takhle to vypadá každému hned po přijetí pozvánky,
    dřív než ho někdo přiřadí. Dostane vysvětlení pod obvyklou
    hlavičkou, ne chybovou stránku.
  */
  if (!ja) {
    return (
      <>
        <HlavickaDochazky />
        <div style={obal}>
          <Vysvetleni nadpis="Zatím nemáte zaměstnanecký záznam">
            Váš účet ještě není propojený se zaměstnancem, takže k němu
            nejdou přiřadit směny ani docházka. Doplní to správce firmy.
          </Vysvetleni>
        </div>
      </>
    );
  }

  // Píchačka se váže na pobočku a její provozní den. Když jedno z toho
  // chybí, netrpí tím zbytek obrazovky — směny se ukážou dál.
  const branchId = scope.branchId ?? ja.branch_id;
  const den = branchId ? await provozniDen(branchId) : null;
  const muzePichat = Boolean(branchId && den);

  /* --- 2a. MOJE SMĚNY -------------------------------------------- */

  let dotazSmeny = supabase
    .from("shifts")
    .select("id, branch_id, shift_date, starts_at, ends_at, status")
    .eq("employee_id", ja.id)
    .gte("shift_date", vcerejsiDatum())
    .neq("status", "cancelled")
    .order("shift_date", { ascending: true })
    .order("starts_at", { ascending: true });

  // Na pobočkové adrese ukazujeme jen tu pobočku, na firemní všechno.
  if (scope.level === "branch" && scope.branchId) {
    dotazSmeny = dotazSmeny.eq("branch_id", scope.branchId);
  }

  const { data: nactene, error: chybaNactene } = await dotazSmeny;
  if (chybaNactene) throw new DotazSelhal("směny", chybaNactene);
  const smeny = (nactene ?? []) as Smena[];

  /*
    Odpracovaná = už skončila. U těch se ptáme, jestli je docházka
    uzavřená. Zapomenutý odchod je přesně to, co má být vidět hned,
    a ne až na konci měsíce, kdy z toho bude dohadování o hodinách.
  */
  const odpracovane = smeny.filter(jeOdpracovana);
  const dochazkaSmen = new Map<string, StavDochazky>();

  if (odpracovane.length > 0) {
    const { data: udalosti, error: chybaUdalosti } = await supabase
      .from("attendance_events")
      .select("kind, occurred_at, branch_id, business_date")
      .eq("employee_id", ja.id)
      .in("business_date", [...new Set(odpracovane.map((s) => s.shift_date))])
      .order("occurred_at", { ascending: true });
    if (chybaUdalosti) throw new DotazSelhal("záznamy docházky", chybaUdalosti);

    // Poslední událost dne rozhoduje: 'out' znamená uzavřeno, cokoli
    // jiného, že se člověk zapomněl odepsat.
    const posledniVeDni = new Map<string, string>();
    for (const u of udalosti ?? []) {
      posledniVeDni.set(`${u.business_date}|${u.branch_id}`, u.kind as string);
    }

    for (const s of odpracovane) {
      const kind = posledniVeDni.get(`${s.shift_date}|${s.branch_id}`);
      dochazkaSmen.set(
        s.id,
        kind === undefined
          ? "bez_zaznamu"
          : kind === "out"
            ? "uzavrena"
            : "neuzavrena",
      );
    }
  }

  // Kdo je na směně se mnou. RLS vrátí jen to, na co uživatel dosáhne.
  let kolegove: Kolega[] = [];
  const jmenaKolegu = new Map<string, string>();

  if (smeny.length > 0) {
    const { data: spolu, error: chybaSpolu } = await supabase
      .from("shifts")
      .select("branch_id, shift_date, employee_id")
      .in("branch_id", [...new Set(smeny.map((s) => s.branch_id))])
      .in("shift_date", [...new Set(smeny.map((s) => s.shift_date))])
      .neq("status", "cancelled");
    if (chybaSpolu) throw new DotazSelhal("směny", chybaSpolu);

    kolegove = ((spolu ?? []) as Kolega[]).filter(
      (k) => k.employee_id !== null && k.employee_id !== ja.id,
    );

    const idLidi = [...new Set(kolegove.map((k) => k.employee_id as string))];
    if (idLidi.length > 0) {
      const { data: lide, error: chybaLide } = await supabase
        .from("employees")
        .select("id, full_name")
        .in("id", idLidi);
      if (chybaLide) throw new DotazSelhal("zaměstnanci", chybaLide);
      for (const clovek of lide ?? []) {
        jmenaKolegu.set(clovek.id as string, clovek.full_name as string);
      }
    }
  }

  /* --- 2c. VLASTNÍ VÝDĚLEK --------------------------------------- */

  /*
    Počítá databáze, sem chodí hotové číslo — nikdy cizí sazba a nikdy
    podklady k dopočítání. Na vlastní mzdu není potřeba oprávnění.

    Nenasazená migrace se schválně promíjí: než projde, funkce
    v databázi není a dlaždice se prostě nekreslí. Rozbít píchačku kvůli
    nedeplojnuté funkci by bylo horší než chybějící dlaždice.

    Prominutí ale platí JEN na tenhle jeden důvod. Kdyby se zahodila
    každá chyba, vypadala by rozbitá funkce úplně stejně jako
    nenasazená — a nikdo by se to nedozvěděl.
  */
  /*
    Měsíc se dá přepnout. Panel uměl jen ten aktuální, takže kdo si
    dopsal příchod z konce minulého měsíce, ty hodiny nikde neviděl —
    a u výplaty se hádá právě o minulý měsíc.

    Adrese se nevěří: co nesedí na tvar, se tiše nahradí aktuálním
    měsícem. Do budoucnosti se nechodí, tam z principu není co ukázat.
  */
  const tenhleMesic = prvniDenMesice(new Date());
  const mesic = platnyMesic(mesicParam) ?? tenhleMesic;
  const predchozi = posunMesic(mesic, -1);
  const nasledujici = mesic < tenhleMesic ? posunMesic(mesic, 1) : null;
  const { data: vydelekData, error: vydelekChyba } = await supabase.rpc(
    "muj_vyplatni_prehled",
    { p_tenant: tenantId, p_mesic: mesic },
  );
  if (vydelekChyba && !funkceNeexistuje(vydelekChyba)) {
    throw new DotazSelhal("můj výdělek", vydelekChyba);
  }

  let vydelek = vydelekChyba
    ? null
    : ((vydelekData?.[0] ?? null) as Vydelek | null);

  /*
    Dokud není nasazená migrace se zálohami, `muj_vyplatni_prehled`
    v databázi není — a bez tohohle by dlaždice s výdělkem zmizela
    úplně. Ne že by neukázala zálohy: zmizela by CELÁ, i s hodinami
    a hrubou mzdou, které fungovaly rok.

    Našlo se to kliknutím, ne úvahou: obrazovka se prostě vykreslila
    bez ní a nic nikde nekřičelo. Proto se sáhne po starší funkci, která
    umí totéž bez záloh. Až migrace projde, použije se ta novější a tahle
    větev se přestane volat sama od sebe.
  */
  if (vydelekChyba) {
    const { data: stara, error: staraChyba } = await supabase.rpc("my_earnings", {
      p_tenant: tenantId,
      p_mesic: mesic,
    });
    if (staraChyba && !funkceNeexistuje(staraChyba)) {
      throw new DotazSelhal("můj výdělek (starší podoba)", staraChyba);
    }
    const r = stara?.[0] as Omit<
      Vydelek,
      "zalohy_haleru" | "zbyva_haleru" | "zaloh_nepotvrzenych" | "zobrazeni"
    > | undefined;
    vydelek = r
      ? {
          ...r,
          zalohy_haleru: 0,
          zbyva_haleru: r.vydelano_haleru,
          zaloh_nepotvrzenych: 0,
          zalohy_pozastavene: false,
          // Bez záloh není co odečítat, takže se řádky se zálohami
          // nekreslí — ne proto, že si to firma přeje, ale proto, že
          // žádné nejsou.
          zobrazeni: "neukazovat",
        }
      : null;
  }

  /*
    Má pobočka vůbec nějaký tablet?

    Bez něj se nedá píchnout ani kódem, ani PINem — a obrazovka o tom
    mlčela. Člověk viděl políčko na kód, který nemá kde vzít.

    Ven z databáze jde jenom ano/ne: soupis zařízení zůstává zavřený na
    settings.manage a číšníkovi do něj nic není.

    Nenasazená migrace se promíjí stejně jako u výdělku — dokud funkce
    není, tvrdí se, že tablet JE, a obrazovka vypadá přesně jako dosud.
    Vyhlásit „tablet chybí“ tam, kde se to jen nedá zjistit, by bylo
    horší než mlčet: lidi by chodili za vedoucím zbytečně.
  */
  let maKiosek = true;
  if (branchId) {
    const { data: kioskData, error: kioskChyba } = await supabase.rpc(
      "pobocka_ma_kiosek",
      { p_tenant: tenantId, p_branch: branchId },
    );
    if (kioskChyba && !funkceNeexistuje(kioskChyba)) {
      throw new DotazSelhal("zařízení pobočky", kioskChyba);
    }
    if (!kioskChyba) maKiosek = kioskData === true;
  }

  /* --- 2b. PÍCHAČKA A DNEŠNÍ STAV -------------------------------- */

  // Moje poslední událost — podle ní se rozhoduje, co nabídnout.
  const { data: posledniData, error: chybaPosledniData } = await supabase
    .from("attendance_events")
    .select("id, employee_id, kind, occurred_at, branch_id")
    .eq("employee_id", ja.id)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (chybaPosledniData) throw new DotazSelhal("záznamy docházky", chybaPosledniData);

  const posledni = (posledniData?.[0] ?? null) as Udalost | null;
  const jsemVPraci =
    posledni !== null &&
    (posledni.kind === "in" || posledni.kind === "break_end");
  const dalsiDruh = jsemVPraci ? "out" : "in";

  // Dnešní stav. Bez attendance.read vrátí politika jen vlastní řádky,
  // ale filtrujeme i tady, ať se zbytečně netahá, co se stejně nesmí.
  let dnesni: Udalost[] = [];
  if (den) {
    /*
      Filtr na pobočku se dělá přes LIDI, ne přes události.

      Dřív se filtrovalo `branch_id = scope.branchId`, takže komu se
      odchod zapsal na druhé pobočce, tomu poslední událost vypadla —
      a obrazovka o něm tvrdila, že je pořád v práci. Přesně to je
      chyba z docs/prechod-mezi-pobockami-zadani.md, oddílu 2.3.

      Teď se nejdřív zjistí, kdo tu dnes vůbec byl, a pak se pro ty
      lidi vezme celý jejich den. Víc než protějšek dvojice politika
      stejně nepustí — a je na to kontrola v krok11_scenar.sql.
    */
    let idNaPobocce: string[] | null = null;
    if (scope.level === "branch" && scope.branchId) {
      const { data: tady, error: chybaTady } = await supabase
        .from("attendance_events")
        .select("employee_id")
        .eq("tenant_id", tenantId)
        .eq("business_date", den)
        .eq("branch_id", scope.branchId);
      if (chybaTady) throw new DotazSelhal("záznamy docházky", chybaTady);
      idNaPobocce = [...new Set((tady ?? []).map((r) => r.employee_id as string))];
    }

    let dotaz = supabase
      .from("attendance_events")
      .select("id, employee_id, kind, occurred_at, branch_id")
      .eq("tenant_id", tenantId)
      .eq("business_date", den)
      .order("occurred_at", { ascending: true });

    if (idNaPobocce !== null) {
      dotaz = dotaz.in("employee_id", idNaPobocce.length > 0 ? idNaPobocce : [ja.id]);
    }
    if (!vidiOstatni) {
      dotaz = dotaz.eq("employee_id", ja.id);
    }

    const { data, error: chybaData } = await dotaz;
    if (chybaData) throw new DotazSelhal("zaměstnanci", chybaData);
    dnesni = (data ?? []) as Udalost[];
  }

  /*
    Kdo dnes přišel jinde, než odešel.

    Párování počítá databáze (`prechody_mezi_pobockami`), ne prohlížeč:
    dvě kopie téhož pravidla se vždycky rozejdou.
  */
  type Prechod = {
    employee_id: string;
    prichod_nazev: string;
    odchod_nazev: string;
    uzavreno: boolean;
  };
  const prechody = new Map<string, Prechod>();
  if (den) {
    const { data: pr } = await supabase.rpc("prechody_mezi_pobockami", {
      p_tenant: tenantId,
      p_den: den,
    });
    for (const x of (pr ?? []) as Prechod[]) prechody.set(x.employee_id, x);
  }

  // Poslední událost každého člověka = jeho aktuální stav.
  const stavy = new Map<string, Udalost>();
  for (const u of dnesni) stavy.set(u.employee_id, u);

  const jmena = new Map<string, string>([[ja.id, ja.full_name]]);
  const cizi = [...stavy.keys()].filter((i) => i !== ja.id);
  if (cizi.length > 0) {
    const { data: lide, error: chybaLide } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", cizi);
    if (chybaLide) throw new DotazSelhal("zaměstnanci", chybaLide);
    for (const c of lide ?? []) jmena.set(c.id as string, c.full_name as string);
  }

  /*
    Lidé do ručního zápisu.

    Je to potřetí, co se tahle nabídka staví — a dvakrát ze špatného
    zdroje. Nejdřív z dnešních událostí (chyběl každý, kdo dnes nepíchl,
    tedy přesně ten, komu se zapisuje ručně). Pak podle domovské
    pobočky (chyběl každý, kdo na pobočce jen zaskakuje — a člověk na
    cizí pobočce, který zapomene telefon, je nejpravděpodobnější případ
    ze všech).

    Teď je to dotaz v databázi: kdo na pobočku patří PLUS kdo tam má
    směnu týden zpátky a týden dopředu. Je v databázi schválně, aby to
    šlo zkontrolovat scénářem a nevznikalo to počtvrté znovu.
  */
  const doVyberu =
    smiZapsatRucne && scope.branchId && den
      ? await lideProPobocku(tenantId, scope.branchId, den)
      : [];

  /*
    Nedokončená docházka. Nález z kontroly: obrazovka tvrdila „Jste
    v práci · od 21:42“ a hned pod tím 0 h 0 min, 0 Kč. Otevřený příchod
    se do mzdy nepočítá — a to je správně, z vymyšleného času odchodu by
    se počítala mzda — ale musí být poznat, že se něco nezapočítalo.
    Tichá nula je horší než chyba.
  */
  type Nedokoncena = {
    employee_id: string;
    jmeno: string;
    /** Pobočka záznamu — formulář ručního zápisu je jen na ní. */
    branch_id: string;
    business_date: string;
    zacatek: string;
    moje: boolean;
  };
  let nedokoncene: Nedokoncena[] = [];
  if (den) {
    const { data: otevrene, error: chybaOtevrene } = await supabase.rpc(
      "nedokoncena_dochazka",
      {
        p_tenant: tenantId,
        p_od: posunDatum(den, -30),
        // Do VČEREJŠKA. Otevřený příchod v dnešním provozním dni není
        // nedokončený záznam, ale člověk, který je právě v práci —
        // hlásit mu to by znamenalo křičet na každého, kdo si píchl
        // příchod a ještě neodešel.
        p_do: posunDatum(den, -1),
        p_branch: scope.branchId ?? null,
      },
    );
    if (chybaOtevrene && !funkceNeexistuje(chybaOtevrene)) {
      throw new DotazSelhal("nedokončená docházka", chybaOtevrene);
    }
    nedokoncene = (otevrene ?? []) as Nedokoncena[];
  }

  /*
    „Doplnit odchod“ z panelu nedokončených (zadání, body 4 a 8).

    Adrese se nevěří: člověk se bere z nedokončených záznamů, které
    databáze vrátila TOMUHLE uživateli, ne podle toho, co přišlo
    v parametru. Kdo si adresu upraví na cizí id, nedostane nic —
    a zápis by mu stejně neprošel politikou.
  */
  const predvyplnit = (() => {
    if (!doplnit || !denDoplneni) return null;
    const z = nedokoncene.find(
      (r) => r.employee_id === doplnit && r.business_date === denDoplneni,
    );
    if (!z) return null;
    return {
      zamestnanec: z.employee_id,
      den: z.business_date,
      jmeno: z.jmeno,
      // Pobočka, kde ten člověk naposled byl. Odchod se doplňuje tam,
      // ne tam, kde se zrovna dívá vedoucí.
      pobocka: z.branch_id,
    };
  })();

  /*
    Pobočky do ručního zápisu.

    Zadání docs/prechod-mezi-pobockami-zadani.md, oddíl 3: kdo doplňuje
    zapomenutý odchod, MUSÍ MOCT VYBRAT POBOČKU — jinak se nedá zadat,
    že člověk odešel jinde, než přišel, a ta informace se ztratí.

    Nabízejí se jen pobočky, na kterých ten člověk docházku spravovat
    smí. Politika `attendance_insert` by ostatní stejně odmítla, ale
    nabídnout je a nechat to spadnout až na zápisu je horší než je
    nenabízet.
  */
  const pobockyProRucni = smiZapsatRucne
    ? (
        await Promise.all(
          ctx.branches.map(async (b) =>
            (await hasAccess(tenantId, "attendance.manage", b.id))
              ? { id: b.id, nazev: b.name }
              : null,
          ),
        )
      ).filter((b): b is { id: string; nazev: string } => b !== null)
    : [];


  /*
    Kód z QR. Adrese se nevěří ani tady: bere se z ní jen tvar, který
    kód mít může, a ověřuje ho až databáze v `pichnout_kodem` proti
    pobočce zařízení. To, že přišel z adresy, na tom nemění nic —
    je to obdoba pravidla 4.
  */
  const platnyKod =
    typeof kodZQr === "string" && /^[A-Za-z0-9]{8}$/.test(kodZQr)
      ? kodZQr.toUpperCase()
      : null;

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const ostatni = [...stavy.entries()].filter(([id]) => id !== ja.id);
  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  /*
    Pásmo se bere u POBOČKY, ne u firmy: čas se ukazuje vedle jména
    provozovny a ta může stát v jiné zemi. Když ho neznáme (nenasazená
    migrace 20260902090000), platí výchozí — nikdy pásmo serveru.
  */
  const zonyPobocek = new Map(
    ctx.branches.map((b) => [b.id, b.timezone ?? ZONA_VYCHOZI]),
  );
  const zonaUdalosti = (branchId: string | null | undefined) =>
    (branchId ? zonyPobocek.get(branchId) : undefined) ?? ZONA_VYCHOZI;

  return (
    <>
      <HlavickaDochazky />

      <div style={obal}>
        {/*
          Ruční zápis. Je nad píchačkou schválně: kdo sem chodí zapisovat
          za druhé, hledá tohle, a kdo si píchá sám, ten formulář vůbec
          nevidí. Váže se na pobočku — na firemní úrovni se nekreslí,
          protože docházka patří k místu.
        */}
        <PanelNedokoncene
          zaznamy={nedokoncene.map((z) => ({
            ...z,
            pobockaSlug: ctx.branches.find((b) => b.id === z.branch_id)?.slug ?? null,
            pobockaNazev: ctx.branches.find((b) => b.id === z.branch_id)?.name ?? null,
            zona:
              ctx.branches.find((b) => b.id === z.branch_id)?.timezone ?? null,
          }))}
          smiOpravit={smiZapsatRucne}
          naPobocce={scope.level === "branch"}
        />

        {/*
          Prázdná nabídka = formulář, do kterého nejde nic vybrat.
          Stane se to, dokud není nasazená migrace 20260901150000
          s průzorem lide_pro_pobocku. Radši se nekreslí nic než
          formulář, který nejde odeslat.
        */}
        {smiZapsatRucne && scope.branchId && doVyberu.length > 0 ? (
          <PanelRucni
            rozsah={rozsah}
            pobockaId={scope.branchId}
            pobockaNazev={scope.branchName ?? ctx.tenant.name}
            lide={doVyberu}
            pobocky={pobockyProRucni}
            chyba={chybaRucne}
            zapsano={zapsano === "1"}
            predvyplnit={predvyplnit}
          />
        ) : null}

        {/* 1. Karta stavu s píchačkou */}
        {muzePichat ? (
          <section
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: "16px",
              boxShadow: "var(--shadow)",
              padding: "20px",
            }}
          >
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
              {scope.branchName ?? nazvyPobocek.get(branchId as string)}
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "18px",
                color: jsemVPraci ? "var(--good)" : "var(--muted)",
              }}
            >
              {jsemVPraci ? "Jste v práci" : "Nejste v práci"}
              {posledni
                ? ` · od ${hodina(posledni.occurred_at, zonaUdalosti(posledni.branch_id))}`
                : ""}
            </p>

            {/*
              Příchod i odchod jsou hlavní akce, ne varování. Píchnout
              odchod je nejběžnější úkon dne; --pozor zůstává skutečným
              problémům. Obě strany proto vypadají stejně — co je zrovna
              na řadě, říká text tlačítka a stav nad ním.
            */}
            {/*
              Píchá se KÓDEM Z TABLETU, ne samotným tlačítkem.

              Do 1. 9. tady stačilo zmáčknout Příchod a zapsal se
              libovolný čas — přímým voláním rozhraní šlo založit
              příchod měsíc zpátky a nebyl nijak označený. Dokud byla
              docházka evidence, byla to drobnost; teď se z ní počítá
              mzda a zálohy.

              Kód se mění každou minutu, takže vyfocený nebo opsaný je
              za chvíli k ničemu. To je celý jeho smysl.
            */}
            {chybaRucne === "kod-vyprsel" ? (
              <p style={ramecekKodu}>
                <strong>Kód mezitím vypršel.</strong> Na tabletu už svítí
                jiný — naskenujte ho znovu.
              </p>
            ) : null}

            {platnyKod ? (
              <p style={{ margin: "12px 0 0", fontSize: "13px", color: "var(--dobre)" }}>
                Kód z tabletu je načtený. Ťukněte na to, co zrovna děláte
                — teprve tím se píchnutí zapíše.
              </p>
            ) : null}

            {/*
              Kudy ven, když na pobočce žádný tablet není. Formulář
              zůstává: kdyby se tablet zaregistroval o minutu později,
              nemá smysl nutit člověka obnovovat stránku. Ale nesmí to
              být jediné, co uvidí.
            */}
            {!maKiosek ? (
              <p
                style={{
                  margin: "16px 0 0",
                  padding: "10px 12px",
                  border: "1px solid var(--pozor)",
                  borderRadius: "10px",
                  background: "var(--pozor-bg)",
                  color: "var(--pozor)",
                  fontSize: "13.5px",
                  lineHeight: 1.5,
                }}
              >
                <strong>Na téhle pobočce zatím není zaregistrovaný žádný tablet</strong>,
                takže není odkud kód opsat a píchnout se nedá. Požádejte
                vedoucího, ať vám {jsemVPraci ? "odchod" : "příchod"} zapíše
                ručně — a ať tablet zaregistruje v Nastavení → Zařízení.
              </p>
            ) : null}

            <form action={zapsatDochazku} style={{ marginTop: "16px" }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="druh" value={dalsiDruh} />
              <label
                style={{
                  display: "grid",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                <span>Kód z tabletu</span>
                {/*
                  Kód z QR se sem předvyplní a z adresy se hned zahodí
                  (docs/qr-na-kiosku-zadani.md, oddíl 3). Zapisovat při
                  otevření odkazu nesmí nic — prohlížeč si adresy načítá
                  dopředu a člověk se vrací tlačítkem zpět.
                */}
                <PoleKodu zQr={platnyKod} />
              </label>
              <button
                type="submit"
                className="ft-tl ft-tl-hlavni"
                style={{
                  width: "100%",
                  minHeight: "56px",
                  fontSize: "18px",
                  marginTop: "12px",
                }}
              >
                {jsemVPraci ? "Odchod" : "Příchod"}
              </button>
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "12.5px",
                  color: "var(--muted)",
                }}
              >
                Kód je na tabletu na provozovně a mění se každou minutu.
                Kdo tablet po ruce nemá, píchne na něm PINem.
              </p>
            </form>
          </section>
        ) : (
          <Vysvetleni nadpis="Píchat zatím nejde">
            {branchId
              ? "Nepodařilo se zjistit provozní den pobočky. Zkuste to prosím za chvíli znovu."
              : "Docházka se zapisuje na pobočku a vaše členství žádnou nemá. Doplní ji správce firmy, nebo se přepněte na konkrétní pobočku."}
          </Vysvetleni>
        )}

        {/* 2. Hrubá mzda za tenhle měsíc */}
        {vydelek ? (
          <DlazdiceVydelku
            v={vydelek}
            mesic={mesic}
            rozsah={rozsah}
            predchozi={predchozi}
            nasledujici={nasledujici}
            /*
              Jen ty z UKAZOVANÉHO měsíce. Seznam nedokončených chodí za
              posledních třicet dní, což je pro panel výš správně — ale
              tady by ta věta stála pod součtem za jiný měsíc a tvrdila
              o něm něco, co o něm neplatí. Po přidání přepínače měsíce
              to přestalo být totéž číslo.
            */
            nedokoncenych={
              nedokoncene.filter(
                (z) => z.moje && z.business_date.slice(0, 7) === mesic.slice(0, 7),
              ).length
            }
          />
        ) : null}

        {/* 3. Moje nejbližší směny */}
        <h2 style={nadpisSekce}>Moje nejbližší směny</h2>

        {smeny.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            {scope.level === "branch"
              ? `Na pobočce ${scope.branchName} na vás zatím žádná směna nečeká.`
              : "Zatím na vás nečeká žádná směna."}
          </p>
        ) : (
          <ol style={seznam}>
            {smeny.map((s) => {
              const semnou = kolegove
                .filter(
                  (k) =>
                    k.branch_id === s.branch_id && k.shift_date === s.shift_date,
                )
                .map((k) => jmenaKolegu.get(k.employee_id as string))
                .filter((j): j is string => Boolean(j));

              const stav = dochazkaSmen.get(s.id);

              return (
                <li
                  key={s.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderLeft: `4px solid ${
                      s.status === "confirmed" ? "var(--good)" : "var(--line-2)"
                    }`,
                    borderRadius: "14px",
                    boxShadow: "var(--shadow)",
                    padding: "16px",
                  }}
                >
                  <p
                    style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}
                  >
                    {popisDne(s.shift_date)}
                  </p>

                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "22px",
                      color: "var(--ink)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {hodinaZCasu(s.starts_at)} – {hodinaZCasu(s.ends_at)}
                  </p>

                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: "14px",
                      color: "var(--branch)",
                    }}
                  >
                    {nazvyPobocek.get(s.branch_id) ?? "Jiná pobočka"}
                    {s.status === "planned" ? " · zatím v plánu" : ""}
                  </p>

                  {/*
                    Jen u odpracovaných. U směny, která teprve bude, nemá
                    smysl hlásit, že docházka není uzavřená.
                  */}
                  {stav ? (
                    <p
                      style={{
                        margin: "10px 0 0",
                        fontSize: "13px",
                        color:
                          stav === "uzavrena" ? "var(--good)" : "var(--pozor)",
                      }}
                    >
                      {stav === "uzavrena"
                        ? "✓ Docházka uzavřená"
                        : stav === "neuzavrena"
                          ? "Docházka není uzavřená — chybí odchod"
                          : "Bez záznamu docházky"}
                    </p>
                  ) : null}

                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: "13px",
                      color: "var(--muted)",
                    }}
                  >
                    {semnou.length > 0
                      ? `Se mnou: ${semnou.join(", ")}`
                      : "Na směně jste sami."}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        {/* 3. Dnešní stav ostatních */}
        <h2 style={nadpisSekce}>
          {vidiOstatni ? "Dnes na pobočce" : "Moje dnešní docházka"}
        </h2>

        {!den ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Bez provozního dne pobočky se dnešek zobrazit nedá.
          </p>
        ) : !vidiOstatni ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            {stavy.has(ja.id)
              ? `Poslední záznam: ${popisDruhu(stavy.get(ja.id)!.kind)} v ${hodina(stavy.get(ja.id)!.occurred_at, zonaUdalosti(stavy.get(ja.id)!.branch_id))}.`
              : "Dnes zatím nemáte žádný záznam."}
            {prechody.has(ja.id) ? (
              <span style={vetaPrechodu}>
                Příchod {prechody.get(ja.id)!.prichod_nazev} · odchod{" "}
                {prechody.get(ja.id)!.odchod_nazev}
              </span>
            ) : null}
          </p>
        ) : ostatni.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Kromě vás dnes zatím nikdo nic nezapsal.
          </p>
        ) : (
          <ul style={{ ...seznam, gap: "8px" }}>
            {ostatni.map(([id, u]) => {
              const vPraci = u.kind === "in" || u.kind === "break_end";
              return (
                <li
                  key={id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "12px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontSize: "15px", color: "var(--ink)" }}>
                    {jmena.get(id) ?? "Neznámý člověk"}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      textAlign: "right",
                      color: vPraci ? "var(--good)" : "var(--muted)",
                    }}
                  >
                    <span style={{ whiteSpace: "nowrap" }}>
                      {popisDruhu(u.kind)} ·{" "}
                      {hodina(u.occurred_at, zonaUdalosti(u.branch_id))}
                    </span>
                    {prechody.has(id) ? (
                      /*
                        Bez téhle věty vypadá odchod na druhé pobočce
                        jako chyba v zápisu. Takhle je vidět, co se
                        stalo — a že „mimo rozpis“ u toho schválně není.
                      */
                      <span style={vetaPrechodu}>
                        Příchod {prechody.get(id)!.prichod_nazev} · odchod{" "}
                        {prechody.get(id)!.odchod_nazev}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

const vetaPrechodu = {
  display: "block",
  marginTop: "2px",
  fontSize: "12.5px",
  color: "var(--muted)",
  fontWeight: 400,
} as const;

/* --- kousky rozhraní --------------------------------------------- */

/** Jedna hlavička pro všechny stavy obrazovky — i pro ty prázdné. */
function HlavickaDochazky() {
  return (
    <Nadpis
      oci="Provoz"
      popis="Příchod, odchod a moje směny. Rozpis všech lidí je v Rozpisu směn."
    >
      Docházka
    </Nadpis>
  );
}

/**
 * Hrubá mzda za měsíc.
 *
 * Oddíl 6 zadání a každé slovo v něm má důvod:
 *   * VŽDYCKY „hrubá“ a „orientačně“ — odvody, zálohy ani srážky v tom
 *     nejsou a lidé si to číslo přečtou jako slib
 *   * pod částkou, z čeho vyšla, ať se to dá zkontrolovat
 *   * chybějící docházka jako štítek se slovem, ne jiný odstín
 *   * chybějící sazba NIKDY jako nula — nula vypadá jako výsledek
 */
function DlazdiceVydelku({
  v,
  mesic,
  rozsah,
  predchozi,
  nasledujici,
  nedokoncenych,
}: {
  v: Vydelek;
  mesic: string;
  rozsah: string;
  predchozi: string;
  /** Prázdné = jsme v aktuálním měsíci, dál dopředu není co ukázat. */
  nasledujici: string | null;
  /** Kolik MÝCH příchodů nemá odchod. Do součtu se nezapočítaly. */
  nedokoncenych: number;
}) {
  return (
    <section
      style={{
        marginTop: "16px",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        boxShadow: "var(--shadow)",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", flex: 1 }}>
          Hrubá mzda za {nazevMesice(mesic)} {rokMesice(mesic)} — orientačně
        </p>

        {/*
          Šipky jsou odkazy, ne tlačítka: měsíc patří do adresy, ať se
          dá poslat i vrátit tlačítkem zpět. Popisek je slovem, ne jen
          znakem — samotná šipka odečítači nic neřekne.
        */}
        <a
          href={`/${rozsah}/dochazka?mesic=${predchozi.slice(0, 7)}`}
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
          aria-label={`Předchozí měsíc: ${nazevMesice(predchozi)} ${rokMesice(predchozi)}`}
        >
          ← {nazevMesice(predchozi)}
        </a>

        {nasledujici ? (
          <a
            href={`/${rozsah}/dochazka?mesic=${nasledujici.slice(0, 7)}`}
            className="ft-tl ft-tl-vedlejsi ft-tl-male"
            aria-label={`Následující měsíc: ${nazevMesice(nasledujici)} ${rokMesice(nasledujici)}`}
          >
            {nazevMesice(nasledujici)} →
          </a>
        ) : null}
      </div>

      {/*
        Čtyři řádky ze zadání, oddíl 7 — kolik z nich se ukáže, říká
        volba firmy. Hrubá mzda je pořád ta velká: je to hlavní číslo,
        kvůli kterému sem člověk chodí.
      */}
      {v.sazba_chybi || v.hodinova_haleru === null ? (
        <p style={{ margin: "6px 0 0", fontSize: "18px", color: "var(--ink)" }}>
          Sazba není zadaná
        </p>
      ) : (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "28px",
            color: "var(--ink)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {koruny(v.vydelano_haleru)}
        </p>
      )}

      <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--muted)" }}>
        {hodinyAMinuty(v.odpracovano_minut)}
        {v.hodinova_haleru !== null
          ? ` · ${sazbaZaHodinu(v.hodinova_haleru)}`
          : ""}
      </p>

      {v.zobrazeni !== "neukazovat" && v.zalohy_haleru > 0 ? (
        <dl style={radky}>
          <dt style={radekPopis}>Vyplacené zálohy</dt>
          <dd style={radekCastka}>{koruny(v.zalohy_haleru)}</dd>

          {v.zobrazeni === "odecitat" ? (
            <>
              <dt style={{ ...radekPopis, color: "var(--ink)" }}>Zbývá k výplatě</dt>
              <dd style={{ ...radekCastka, color: "var(--ink)", fontWeight: 600 }}>
                {koruny(v.zbyva_haleru)}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {/*
        Bez téhle věty skončí první výplata po zavedení záloh hádkou
        u baru — a bude oprávněná. Zálohy se vyplácejí z ČISTÉ mzdy,
        takže na výplatní pásce bude číslo nižší než tady.
      */}
      {v.zobrazeni === "odecitat" && v.zalohy_haleru > 0 ? (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: "12.5px",
            color: "var(--muted)",
            maxWidth: "56ch",
            lineHeight: 1.5,
          }}
        >
          „Zbývá k výplatě“ je hrubá mzda po odečtení záloh —{" "}
          <strong>před daněmi a odvody</strong>. Na výplatní pásce bude
          číslo nižší: zálohy se vyplácejí z čisté mzdy.
        </p>
      ) : null}

      {/*
        Důvod se neuvádí — ten patří do rozhovoru, ne na obrazovku.
        Jde o to, aby se to člověk dozvěděl sám a ne až u okénka.
      */}
      {v.zalohy_pozastavene ? (
        <p
          style={{
            margin: "12px 0 0",
            padding: "10px 12px",
            border: "1px solid var(--pozor)",
            borderRadius: "10px",
            background: "var(--pozor-bg)",
            color: "var(--pozor)",
            fontSize: "13.5px",
            lineHeight: 1.5,
          }}
        >
          <strong>Zálohy máte pozastavené.</strong> Domluvte se s vedením.
        </p>
      ) : null}

      {v.zobrazeni !== "neukazovat" && v.zaloh_nepotvrzenych > 0 ? (
        <p
          style={{
            display: "inline-block",
            margin: "12px 0 0",
            padding: "4px 10px",
            borderRadius: "999px",
            background: "var(--pozor-bg)",
            color: "var(--pozor)",
            fontSize: "13px",
          }}
        >
          {pocet(v.zaloh_nepotvrzenych, "záloha", "zálohy", "záloh")}{" "}
          {prisudek(v.zaloh_nepotvrzenych, "čeká", "čekají", "čeká")} na
          potvrzení PINem
        </p>
      ) : null}

      {/*
        Nula si říká o vysvětlení. Aplikace ví, PROČ je nula — jestli
        chybí sazba, nebo docházka — a člověk to z prázdného čísla
        nepozná. Mlčící nula vypadá jako porucha aplikace, i když je to
        správný výsledek.
      */}
      {duvodNuly(v, nedokoncenych) ? (
        <p
          style={{
            margin: "10px 0 0",
            fontSize: "13px",
            color: "var(--muted)",
            maxWidth: "56ch",
            lineHeight: 1.5,
          }}
        >
          {duvodNuly(v, nedokoncenych)}
        </p>
      ) : null}

      {/*
        Štítek, ne odstín: barva sama nic neřekne tomu, kdo ji nerozezná,
        a tohle je údaj o penězích.
      */}
      {v.dnu_bez_dochazky > 0 ? (
        <p
          style={{
            display: "inline-block",
            margin: "12px 0 0",
            padding: "4px 10px",
            borderRadius: "999px",
            background: "var(--pozor-bg)",
            color: "var(--pozor)",
            fontSize: "13px",
          }}
        >
          {dnu(v.dnu_bez_dochazky)} bez docházky
        </p>
      ) : null}

      {/*
        Nedokončený příchod se do součtu nezapočítal. Bez téhle věty je
        pod „Jste v práci“ nula, která vypadá jako výsledek — přesně to
        našla kontrola 1. 9. Podrobnosti jsou v panelu výš, tady stačí,
        že to číslo není celé.
      */}
      {nedokoncenych > 0 ? (
        <p
          style={{
            display: "inline-block",
            margin: "12px 0 0 8px",
            padding: "4px 10px",
            borderRadius: "999px",
            background: "var(--pozor-bg)",
            color: "var(--pozor)",
            fontSize: "13px",
          }}
        >
          {pocet(nedokoncenych, "příchod", "příchody", "příchodů")} bez
          odchodu{" "}
          {prisudek(
            nedokoncenych,
            "se nezapočítal",
            "se nezapočítaly",
            "se nezapočítalo",
          )}
        </p>
      ) : null}
    </section>
  );
}

/** Vysvětlení místo obsahu, když se něco nedá ukázat. Není to chyba. */
function Vysvetleni({
  nadpis,
  children,
}: {
  nadpis: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        boxShadow: "var(--shadow)",
        padding: "20px",
      }}
    >
      <p style={{ margin: 0, fontSize: "16px", color: "var(--ink)" }}>
        {nadpis}
      </p>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "14px",
          color: "var(--muted)",
          maxWidth: "56ch",
        }}
      >
        {children}
      </p>
    </section>
  );
}

/* --- styly ------------------------------------------------------- */

const obal = { padding: "16px", paddingBottom: "32px" } as const;

const nadpisSekce = {
  margin: "24px 0 12px",
  fontSize: "16px",
  color: "var(--muted)",
  fontWeight: 500,
} as const;

const seznam = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "12px",
} as const;

/* --- pomocné funkce ---------------------------------------------- */

/** Čas z timestamptz, tedy z okamžiku. */
/*
  Formátování je v lib/cas.ts a VŽDYCKY chce pásmo. Dřív tu stálo
  `new Date(iso).getHours()`, což je hodina v pásmu serveru — na
  Vercelu v UTC. Událost z 13:27 pražského času se ukazovala jako
  11:27.
*/
function hodina(casISO: string, zona?: string): string {
  return hodinaVPasmu(casISO, zona ?? ZONA_VYCHOZI);
}

/** Čas ze sloupce `time`, tedy „07:30:00“. */
function hodinaZCasu(cas: string): string {
  return cas.slice(0, 5);
}

function popisDruhu(kind: string): string {
  switch (kind) {
    case "in":
      return "Příchod";
    case "out":
      return "Odchod";
    case "break_start":
      return "Pauza";
    case "break_end":
      return "Konec pauzy";
    default:
      return kind;
  }
}

function naDatum(d: Date): string {
  const mesic = String(d.getMonth() + 1).padStart(2, "0");
  const den = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mesic}-${den}`;
}

/**
 * Dolní hranice dotazu na směny. Bereme i včerejšek: směna přes půlnoc
 * patří pořád do včerejšího provozního dne, a odpracovaná směna má být
 * chvíli vidět i potom — jinak by nebylo kde poznat, že u ní chybí
 * odchod.
 *
 * Čtení hodin je schválně tady a ne v těle komponenty — pravidlo
 * react-hooks/purity nedovolí volat nečisté funkce přímo v ní.
 */
function vcerejsiDatum(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return naDatum(d);
}

/** Směna je odpracovaná, jakmile skončila. */
function jeOdpracovana(s: Smena): boolean {
  return konecSmeny(s).getTime() <= Date.now();
}

/**
 * Konec směny jako okamžik. Když je čas konce menší nebo roven začátku,
 * směna přetéká přes půlnoc a končí až druhý den.
 */
function konecSmeny(s: Smena): Date {
  const [zh, zm] = s.starts_at.split(":").map(Number);
  const [kh, km] = s.ends_at.split(":").map(Number);
  const d = new Date(`${s.shift_date}T00:00:00`);
  d.setHours(kh, km, 0, 0);
  if (kh * 60 + km <= zh * 60 + zm) d.setDate(d.getDate() + 1);
  return d;
}

const DNY = [
  "neděle",
  "pondělí",
  "úterý",
  "středa",
  "čtvrtek",
  "pátek",
  "sobota",
];

function popisDne(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  const dnes = new Date();
  dnes.setHours(0, 0, 0, 0);
  const rozdil = Math.round((d.getTime() - dnes.getTime()) / 86400000);

  const cislo = `${d.getDate()}. ${d.getMonth() + 1}.`;
  if (rozdil === 0) return `Dnes · ${cislo}`;
  if (rozdil === 1) return `Zítra · ${cislo}`;
  if (rozdil === -1) return `Včera · ${cislo}`;

  const den = DNY[d.getDay()];
  return `${den.charAt(0).toUpperCase()}${den.slice(1)} · ${cislo}`;
}

/**
 * Měsíc z adresy ve tvaru YYYY-MM. Vrací první den měsíce, nebo null.
 *
 * Adrese se nevěří. Nesmysl se nehlásí jako chyba — člověk si adresu
 * upravil nebo mu ji zkomolil poštovní program a smysluplná odpověď je
 * ukázat aktuální měsíc, ne chybovou stránku.
 */
function platnyMesic(hodnota: string | undefined): string | null {
  if (!hodnota || !/^\d{4}-\d{2}$/.test(hodnota)) return null;
  const m = Number(hodnota.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return `${hodnota}-01`;
}

/** O kolik měsíců vedle. Přetečení roku řeší Date sám. */
function posunMesic(prvniDen: string, o: number): string {
  const d = new Date(`${prvniDen}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + o);
  return prvniDenMesice(
    new Date(d.getUTCFullYear(), d.getUTCMonth(), 1),
  );
}

/** Rok se píše jen tehdy, když není letošní — jinak jen překáží. */
function rokMesice(prvniDen: string): string {
  const rok = prvniDen.slice(0, 4);
  return rok === String(new Date().getFullYear()) ? "" : rok;
}

/**
 * Proč je nula nula.
 *
 * Vrací větu, nebo prázdno, když se nic vysvětlovat nemusí. Rozlišuje
 * tři různé nuly, protože každá se řeší jinak: sazbu doplní vedoucí,
 * docházku si člověk zapíše sám, nedokončený příchod musí někdo uzavřít.
 */
function duvodNuly(v: Vydelek, nedokoncenych: number): string {
  if (v.sazba_chybi || v.hodinova_haleru === null) {
    return v.odpracovano_minut > 0
      ? "Hodiny máte zapsané, chybí jen sazba — tu vám doplní vedoucí. Do té doby se z nich mzda spočítat nedá."
      : "Sazbu vám zatím nikdo nezadal a za tenhle měsíc nemáte ani žádnou zapsanou docházku.";
  }

  if (v.odpracovano_minut > 0) return "";

  if (nedokoncenych > 0) {
    return "Za tenhle měsíc nemáte hotový ani jeden záznam docházky — jen příchod bez odchodu, a ten se do hodin nepočítá. Doplnit ho může vedoucí.";
  }

  return "Za tenhle měsíc nemáte zapsanou žádnou docházku. Sazbu zadanou máte, takže jakmile se něco píchne, číslo se tu objeví.";
}

/* --- styly řádků výplatního přehledu -------------------------------- */

const radky = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "2px 16px",
  margin: "12px 0 0",
  paddingTop: "10px",
  borderTop: "1px solid var(--line)",
} as const;

const radekPopis = {
  margin: 0,
  fontSize: "13.5px",
  color: "var(--muted)",
} as const;

const radekCastka = {
  margin: 0,
  fontSize: "13.5px",
  color: "var(--muted)",
  textAlign: "right" as const,
  fontVariantNumeric: "tabular-nums" as const,
} as const;

const ramecekKodu = {
  margin: "12px 0 0",
  padding: "10px 12px",
  border: "1px solid var(--pozor)",
  borderRadius: "10px",
  background: "var(--pozor-bg)",
  color: "var(--pozor)",
  fontSize: "13.5px",
  lineHeight: 1.5,
} as const;
