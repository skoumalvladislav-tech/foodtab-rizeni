import { redirect } from "next/navigation";

import { getUser, hasAccess } from "@/lib/authz";
import { barvaNeboNic } from "@/lib/barvy-lidi";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { posunDatum, provozniDen } from "@/lib/provozni-den";
import { DNU_V_ROZPISU } from "@/lib/rozpis-konstanty";
import { dnyTydne, mesicniMrizka } from "@/lib/rozpis-mobil";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import PanelVydani from "./panel-vydani";
import RozpisView from "./rozpis";
import { nabidnoutSablony } from "./sablony";

export const dynamic = "force-dynamic";

/**
 * Rozpis směn na týden dopředu.
 *
 * Postup je stejný jako u moje-smeny: kontrola přístupu, načtení dat přes
 * lib/supabase/server.ts (ať platí RLS), vykreslení.
 *
 * Neobsazená směna má employee_id prázdné a musí být vidět — je to
 * „sem někoho potřebujeme“, ne chybějící záznam. Brigádník bez účtu se
 * kreslí úplně stejně jako kdokoli jiný: zaměstnanecký záznam existuje
 * i bez uživatelského účtu.
 */


type Smena = {
  id: string;
  branch_id: string;
  employee_id: string | null;
  position_id: string | null;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string;
  // Vydaná směna se nedá smazat — lidem už je v rozpisu vidět.
  published_at: string | null;
  // Trhaná směna — pauza uvnitř (migrace 20260916200000). Obě, nebo žádná.
  pauza_od: string | null;
  pauza_do: string | null;
  // Kdo a kdy směnu založil — do detailu na telefonu.
  created_by: string | null;
  created_at: string | null;
};

/**
 * Je to opravdové datum RRRR-MM-DD?
 *
 * Adresa je vstup od uživatele. Dřív se `?den=` posílalo rovnou do
 * dotazu; teď se z něj počítá i týden, a nesmyslné datum by shodilo
 * stránku výjimkou z `toISOString`, ne hláškou. Roundtrip chytí i
 * „2026-02-31“, které regulární výraz pustí.
 */
function jeDatum(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export default async function Rozpis({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ den?: string }>;
}) {
  const { rozsah } = await params;
  const { den: denSurovy } = await searchParams;
  const denZUrl = jeDatum(denSurovy) ? denSurovy : undefined;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "shifts.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na rozpis směn vaše oprávnění nedosáhne. Pokud si myslíte, že by měla,
        řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  // Odkud se počítá týden. Provozní den patří pobočce, takže se na něj
  // ptáme databáze. Na firemní úrovni bereme první pobočku jako kotvu —
  // pobočky se stejnou otevírací dobou vyjdou stejně.
  const kotva = scope.branchId ?? ctx.branches[0]?.id ?? null;
  if (!kotva) {
    return (
      <Sdeleni nadpis="Firma nemá žádnou pobočku">
        Rozpis se váže na pobočku. Nejdřív ji musí někdo se správou
        nastavení založit.
      </Sdeleni>
    );
  }

  // Načíst day_starts_at z databáze
  const supabase = await getServerSupabase();
  const { data: branchData, error: chybaBranchData } = await supabase
    .from("branches")
    .select("day_starts_at")
    .eq("id", kotva)
    .single();
  if (chybaBranchData) throw new DotazSelhal("pobočky", chybaBranchData);
  const dayStartsAt = (branchData?.day_starts_at as string | undefined) ?? "05:00";

  const dnesProvozni = await provozniDen(kotva);
  if (!dnesProvozni) {
    return (
      <Sdeleni nadpis="Nepodařilo se zjistit provozní den">
        Bez něj nelze rozpis sestavit. Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    );
  }

  // Pokud je v URL zadán konkrétní den, počítáme rozsah od něj
  const odKdy = denZUrl ?? dnesProvozni;
  const doKdy = posunDatum(odKdy, DNU_V_ROZPISU - 1);

  /*
    CO SE NAČÍTÁ.

    Počítač: `odKdy` … `doKdy` (sedm dnů od zvoleného dne). Telefon: celý
    týden od pondělí do neděle, do kterého `odKdy` patří — denní přehled
    i týden po lidech se kreslí po ISO týdnech. Sjednocení je nejvýš
    třináct dní; nic víc (ani měsíc, ani lidé bez směny).

    Vlastní směny přihlášeného (Moje směny, Kalendář) jdou zvlášť, přes
    `employee_id`, bez omezení na pobočku z adresy — člověk chce vidět
    všechny své směny, ať je má kde chce; co smí číst, hlídá RLS.
  */
  const tyden = dnyTydne(odKdy);
  const nacistOd = tyden[0];
  const nacistDo = tyden[6] > doKdy ? tyden[6] : doKdy;

  const mrizka = mesicniMrizka(odKdy).flat();
  const nadchazejiciDo = posunDatum(dnesProvozni, 13);
  const mojeOd = dnesProvozni < mrizka[0] ? dnesProvozni : mrizka[0];
  const mojeDo = nadchazejiciDo > mrizka[mrizka.length - 1] ? nadchazejiciDo : mrizka[mrizka.length - 1];

  // Sloupce pauza_od/pauza_do přidává migrace 20260916200000 (trhaná
  // směna) — dokud neproběhne, dotaz na ně spadne s PGRST204/42703.
  // Stránka to nesmí strhnout s sebou, proto se v tom případě zopakuje
  // bez nich (viz lib/supabase/dotaz.ts, sloupecNeexistuje).
  const zakladniSloupce =
    "id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at, status, note, published_at, created_by, created_at";

  function dotazNaSmeny(sloupce: string, od: string, doDne: string, zamestnanec?: string) {
    let d = supabase
      .from("shifts")
      .select(sloupce)
      .eq("tenant_id", tenantId)
      .gte("shift_date", od)
      .lte("shift_date", doDne)
      .neq("status", "cancelled")
      .order("shift_date", { ascending: true })
      .order("starts_at", { ascending: true });

    if (zamestnanec) {
      d = d.eq("employee_id", zamestnanec);
    } else if (scope.level === "branch" && scope.branchId) {
      d = d.eq("branch_id", scope.branchId);
    }
    return d;
  }

  async function nactiSmeny(od: string, doDne: string, zamestnanec?: string): Promise<Smena[]> {
    let { data, error } = await dotazNaSmeny(
      `${zakladniSloupce}, pauza_od, pauza_do`,
      od,
      doDne,
      zamestnanec,
    );
    let maPauzy = true;
    if (error && sloupecNeexistuje(error)) {
      maPauzy = false;
      ({ data, error } = await dotazNaSmeny(zakladniSloupce, od, doDne, zamestnanec));
    }
    if (error) throw new DotazSelhal("směny", error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((s) => ({
      ...s,
      pauza_od: maPauzy ? ((s.pauza_od as string | null) ?? null) : null,
      pauza_do: maPauzy ? ((s.pauza_do as string | null) ?? null) : null,
    })) as unknown as Smena[];
  }

  // Kdo je přihlášený jako zaměstnanec. Ne každý účet má záznam (majitel
  // bez směn) — pak `jaId` chybí a Moje směny zůstanou prázdné.
  const uzivatel = await getUser();
  let jaId: string | null = null;
  if (uzivatel) {
    const { data: ja, error: chybaJa } = await supabase
      .from("employees")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", uzivatel.id)
      .is("deleted_at", null)
      .limit(1);
    if (chybaJa) throw new DotazSelhal("zaměstnanec", chybaJa);
    jaId = (ja?.[0]?.id as string | undefined) ?? null;
  }

  const [smeny, mojeSmeny] = await Promise.all([
    nactiSmeny(nacistOd, nacistDo),
    jaId ? nactiSmeny(mojeOd, mojeDo, jaId) : Promise.resolve([] as Smena[]),
  ]);

  // Jména lidí a názvy pozic. Neobsazená směna nemá employee_id — ta se
  // do dotazu nedostane a v rozpisu se ukáže jako neobsazená.
  const jmena = new Map<string, string>();
  const pozice = new Map<string, string>();
  /*
    Barvy lidí do rozpisu. Klíč z palety, nebo null u toho, kdo barvu
    nemá — a to je platný stav, ne chybějící údaj. Viz lib/barvy-lidi.
  */
  const barvy = new Map<string, string | null>();

  /*
    Domovský úsek každého člověka (do jakého týmu patří — Kuchyně,
    Bar, Vedení), pro seskupení týdenní mřížky. Jiná osa než pozice
    níž: úsek se váže na ČLOVĚKA (employees.usek_id), ne na směnu —
    stejná úvaha jako u domovské pobočky v maticovém dovozu rozpisu
    (lib/nahrani-rozpisu-matice.ts).
  */
  const domovskeUseky = new Map<string, string | null>();

  const idLidi = [
    ...new Set(
      [...smeny, ...mojeSmeny]
        .map((s) => s.employee_id)
        .concat(jaId)
        .filter((i): i is string => !!i),
    ),
  ];
  if (idLidi.length > 0) {
    const { data: lide, error: chybaLide } = await supabase
      .from("employees")
      .select("id, full_name, color, usek_id")
      .in("id", idLidi);
    if (chybaLide) throw new DotazSelhal("zaměstnanci", chybaLide);
    for (const c of lide ?? []) {
      jmena.set(c.id as string, c.full_name as string);
      barvy.set(c.id as string, barvaNeboNic(c.color));
      domovskeUseky.set(c.id as string, (c.usek_id as string | null) ?? null);
    }
  }

  const idPozic = [
    ...new Set([...smeny, ...mojeSmeny].map((s) => s.position_id).filter((i): i is string => !!i)),
  ];
  if (idPozic.length > 0) {
    const { data: p, error: chybaP } = await supabase
      .from("positions")
      .select("id, label")
      .in("id", idPozic);
    if (chybaP) throw new DotazSelhal("pozice", chybaP);
    for (const c of p ?? []) pozice.set(c.id as string, c.label as string);
  }

  const nazvyUseku = new Map<string, string>();
  const idUseku = [...new Set([...domovskeUseky.values()].filter((i): i is string => !!i))];
  if (idUseku.length > 0) {
    // Pořadí si určuje firma (`poradi`); telefon podle něj řadí skupiny.
    const { data: u, error: chybaU } = await supabase
      .from("useky")
      .select("id, nazev")
      .in("id", idUseku)
      .order("poradi", { ascending: true })
      .order("nazev", { ascending: true });
    if (chybaU) throw new DotazSelhal("úseky", chybaU);
    for (const c of u ?? []) nazvyUseku.set(c.id as string, c.nazev as string);
  }

  /*
    Jména těch, kdo směny zakládali (řádek „Vytvořil“ v detailu).
    Přes `employees.user_id`; komu se jméno nenajde, u směny žádný
    „Vytvořil“ nebude — nevymýšlí se.
  */
  const tvurci = new Map<string, string>();
  const idTvurcu = [
    ...new Set([...smeny, ...mojeSmeny].map((s) => s.created_by).filter((i): i is string => !!i)),
  ];
  if (idTvurcu.length > 0) {
    const { data: t, error: chybaT } = await supabase
      .from("employees")
      .select("user_id, full_name")
      .eq("tenant_id", tenantId)
      .in("user_id", idTvurcu);
    if (chybaT) throw new DotazSelhal("zaměstnanci", chybaT);
    for (const c of t ?? []) tvurci.set(c.user_id as string, c.full_name as string);
  }

  /* --- 3. ZADÁVÁNÍ ---------------------------------------------- */

  /*
    Pobočky, na kterých ten člověk smí plánovat. Rozhoduje se podle
    práva, ne podle rozsahu z adresy — pobočka z prohlížeče je návrh
    (pravidlo 4) a databáze si to stejně ověří znovu.
  */
  const pobockyProPlanovani = (
    await Promise.all(
      ctx.branches.map(async (b) =>
        (await hasAccess(tenantId, "shifts.manage", b.id))
          ? { id: b.id, nazev: b.name }
          : null,
      ),
    )
  ).filter((b): b is { id: string; nazev: string } => b !== null);

  let planovani = null;
  if (pobockyProPlanovani.length > 0) {
    /*
      Lidé do nabídky „Kdo“: všichni zaměstnanci firmy, ne jen ti
      z jedné pobočky. Kdo vypomáhá jinde, se do rozpisu dostat musí —
      a že člověk patří do téhle firmy, si ověří sama funkce v databázi.
    */
    const { data: lideData, error: chybaLide2 } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("full_name");
    if (chybaLide2) throw new DotazSelhal("zaměstnanci", chybaLide2);

    const { data: poziceData } = await supabase
      .from("positions")
      .select("id, label")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("label");

    const vychoziPobocka =
      scope.branchId ?? (pobockyProPlanovani[0]?.id ?? null);

    /*
      Šablony pro tu pobočku, se kterou se okno otevře. Formulář si je
      po přepnutí pobočky nebo pozice dotáhne znovu; tohle je jen proto,
      aby nabídka stála hned a neproblikla prázdná.

      Bez `await` na výsledku by se nedalo poznat, jestli je prázdná
      proto, že firma šablony nemá, nebo proto, že se dotaz nestihl.
    */
    const sablony = vychoziPobocka
      ? await nabidnoutSablony(rozsah, vychoziPobocka, null)
      : [];

    planovani = {
      rozsah,
      pobocky: pobockyProPlanovani,
      vychoziPobocka,
      sablony,
      lide: (lideData ?? []).map((c) => ({
        id: c.id as string,
        jmeno: c.full_name as string,
      })),
      pozice: (poziceData ?? []).map((p) => ({
        id: p.id as string,
        label: p.label as string,
      })),
    };
  }

  /* --- 4. VYKRESLENÍ -------------------------------------------- */

  /*
    Prázdný rozpis se hlásí jen tomu, kdo s tím stejně nic neudělá.
    Kdo plánovat smí, potřebuje kalendář — právě do prázdného týdne
    se směny zadávají a hláška místo něj by ho o to připravila.
  */
  if (smeny.length === 0 && mojeSmeny.length === 0 && !planovani) {
    return (
      <Sdeleni nadpis="Na příští týden není nic naplánováno">
        {scope.level === "branch"
          ? `Pobočka ${scope.branchName} nemá v rozpisu žádnou směnu.`
          : "Ani jedna pobočka nemá v rozpisu žádnou směnu."}
      </Sdeleni>
    );
  }

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    /*
      Sloupec, aby šlo na telefonu panel vydání přesunout pod seznam
      (`ds-sm-vydani`, app/_komponenty.css). Na počítači je pořadí beze
      změny: nadpis, vydání, rozpis.
    */
    <div className="ds-sm-stranka">
      {/* Na telefonu má nadpis roli hlavičky obrazovky sám mobilní pohled. */}
      <div className="ds-sm-jen-desktop">
        <Nadpis oci="Provoz" popis="Kdo kdy stojí. Týden dopředu.">
          Rozpis směn
        </Nadpis>
      </div>

      {/*
        Vydání rozpisu. Jen na pobočce a jen tomu, kdo smí plánovat:
        upozornění se vážou na pobočku a „vydat za celou firmu“ by
        znamenalo rozeslat lidem i to, co se jich netýká.

        Panel si sám ověří právo přes průzor v databázi — tady se jen
        rozhoduje o kreslení, což zámek není.
      */}
      {scope.level === "branch" && scope.branchId ? (
        <div className="ds-sm-vydani">
          <PanelVydani
            rozsah={rozsah}
            tenantId={tenantId}
            branchId={scope.branchId}
            od={odKdy}
            doKdy={doKdy}
          />
        </div>
      ) : null}

      <RozpisView
        smeny={smeny}
        /*
          Skutečné „dnes“ (provozní den pobočky), ne den z adresy. Dřív se
          sem posílal `odKdy`, který se po posunu o týden stal „dneškem“:
          první sloupec se zvýraznil jako dnešní a tlačítko Dnes nevrátilo
          nikam.
        */
        dnesni={dnesProvozni}
        mobil={{
          mojeSmeny,
          okno: { od: nacistOd, do: nacistDo },
          maSve: jaId !== null,
          tvurci,
          rozsah,
        }}
        dayStartsAt={dayStartsAt}
        jmena={jmena}
        barvy={barvy}
        pozice={pozice}
        domovskeUseky={domovskeUseky}
        nazvyUseku={nazvyUseku}
        nazvyPobocek={nazvyPobocek}
        rozsah={{
          level: scope.level,
          branchId: scope.branchId ?? null,
          branchName: scope.branchName ?? null,
        }}
        planovani={planovani}
      />
    </div>
  );
}
