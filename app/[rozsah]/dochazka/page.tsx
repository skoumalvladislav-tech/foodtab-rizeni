import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getContext, getUser, hasAccess } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import {
  dnu,
  hodinyAMinuty,
  koruny,
  nazevMesice,
  prvniDenMesice,
  sazbaZaHodinu,
} from "@/lib/mzdy";
import { posunDatum, provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { zapsatDochazku } from "./akce";
import PanelRucni from "./panel-rucni";
import PanelNedokoncene from "./panel-nedokoncene";

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

/** Výsledek public.my_earnings — hotová čísla z databáze. */
type Vydelek = {
  odpracovano_minut: number;
  vydelano_haleru: number;
  dnu_bez_dochazky: number;
  sazba_chybi: boolean;
  hodinova_haleru: number | null;
};

export default async function Dochazka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string; zapsano?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba: chybaRucne, zapsano } = await searchParams;

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
  const mesic = prvniDenMesice(new Date());
  const { data: vydelekData, error: vydelekChyba } = await supabase.rpc(
    "my_earnings",
    { p_tenant: tenantId, p_mesic: mesic },
  );
  if (vydelekChyba && !funkceNeexistuje(vydelekChyba)) {
    throw new DotazSelhal("můj výdělek", vydelekChyba);
  }
  const vydelek = vydelekChyba
    ? null
    : ((vydelekData?.[0] ?? null) as Vydelek | null);

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
    let dotaz = supabase
      .from("attendance_events")
      .select("id, employee_id, kind, occurred_at, branch_id")
      .eq("tenant_id", tenantId)
      .eq("business_date", den)
      .order("occurred_at", { ascending: true });

    if (scope.level === "branch" && scope.branchId) {
      dotaz = dotaz.eq("branch_id", scope.branchId);
    }
    if (!vidiOstatni) {
      dotaz = dotaz.eq("employee_id", ja.id);
    }

    const { data, error: chybaData } = await dotaz;
    if (chybaData) throw new DotazSelhal("zaměstnanci", chybaData);
    dnesni = (data ?? []) as Udalost[];
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
  const doVyberu: { id: string; jmeno: string; domovska: boolean }[] = [];
  if (smiZapsatRucne && scope.branchId && den) {
    const { data: lideProPobocku, error: chybaVyberu } = await supabase.rpc(
      "lide_pro_pobocku",
      {
        p_tenant: tenantId,
        p_branch: scope.branchId,
        p_od: posunDatum(den, -7),
        p_do: posunDatum(den, 7),
      },
    );
    // Dokud neproběhne migrace 20260901150000, průzor neexistuje —
    // formulář se pak nekreslí místo toho, aby obrazovka spadla.
    if (chybaVyberu && !funkceNeexistuje(chybaVyberu)) {
      throw new DotazSelhal("lidé pro ruční zápis", chybaVyberu);
    }
    for (const c of (lideProPobocku ?? []) as {
      employee_id: string;
      jmeno: string;
      domovska: boolean;
    }[]) {
      doVyberu.push({ id: c.employee_id, jmeno: c.jmeno, domovska: c.domovska });
    }
  }

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

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const ostatni = [...stavy.entries()].filter(([id]) => id !== ja.id);
  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

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
        <PanelNedokoncene zaznamy={nedokoncene} smiOpravit={smiZapsatRucne} />

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
            chyba={chybaRucne}
            zapsano={zapsano === "1"}
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
              {posledni ? ` · od ${hodina(posledni.occurred_at)}` : ""}
            </p>

            {/*
              Příchod i odchod jsou hlavní akce, ne varování. Píchnout
              odchod je nejběžnější úkon dne; --pozor zůstává skutečným
              problémům. Obě strany proto vypadají stejně — co je zrovna
              na řadě, říká text tlačítka a stav nad ním.
            */}
            <form action={zapsatDochazku} style={{ marginTop: "16px" }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="druh" value={dalsiDruh} />
              <button
                type="submit"
                className="ft-tl ft-tl-hlavni"
                style={{ width: "100%", minHeight: "56px", fontSize: "18px" }}
              >
                {jsemVPraci ? "Odchod" : "Příchod"}
              </button>
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
            nedokoncenych={nedokoncene.filter((z) => z.moje).length}
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
              ? `Poslední záznam: ${popisDruhu(stavy.get(ja.id)!.kind)} v ${hodina(stavy.get(ja.id)!.occurred_at)}.`
              : "Dnes zatím nemáte žádný záznam."}
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
                      whiteSpace: "nowrap",
                      color: vPraci ? "var(--good)" : "var(--muted)",
                    }}
                  >
                    {popisDruhu(u.kind)} · {hodina(u.occurred_at)}
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
  nedokoncenych,
}: {
  v: Vydelek;
  mesic: string;
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
      <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
        Hrubá mzda za {nazevMesice(mesic)} — orientačně
      </p>

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
          {nedokoncenych === 1
            ? "1 příchod bez odchodu se nezapočítal"
            : `${nedokoncenych} příchodů bez odchodu se nezapočítalo`}
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
function hodina(casISO: string): string {
  const d = new Date(casISO);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
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
