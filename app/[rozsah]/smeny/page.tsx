import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { posunDatum, provozniDen } from "@/lib/provozni-den";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import RozpisView from "./rozpis";

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

const DNU_DOPREDU = 7;

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
};

export default async function Rozpis({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

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
        Na rozpis směn vaše role nedosáhne. Pokud si myslíte, že by měla,
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
  const { data: branchData } = await supabase
    .from("branches")
    .select("day_starts_at")
    .eq("id", kotva)
    .single();
  const dayStartsAt = (branchData?.day_starts_at as string | undefined) ?? "05:00";

  const odKdy = await provozniDen(kotva);
  if (!odKdy) {
    return (
      <Sdeleni nadpis="Nepodařilo se zjistit provozní den">
        Bez něj nelze rozpis sestavit. Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    );
  }
  const doKdy = posunDatum(odKdy, DNU_DOPREDU - 1);

  let dotaz = supabase
    .from("shifts")
    .select(
      "id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at, status, note",
    )
    .eq("tenant_id", tenantId)
    .gte("shift_date", odKdy)
    .lte("shift_date", doKdy)
    .neq("status", "cancelled")
    .order("shift_date", { ascending: true })
    .order("starts_at", { ascending: true });

  if (scope.level === "branch" && scope.branchId) {
    dotaz = dotaz.eq("branch_id", scope.branchId);
  }

  const { data: nactene } = await dotaz;
  const smeny = (nactene ?? []) as Smena[];

  // Jména lidí a názvy pozic. Neobsazená směna nemá employee_id — ta se
  // do dotazu nedostane a v rozpisu se ukáže jako neobsazená.
  const jmena = new Map<string, string>();
  const pozice = new Map<string, string>();

  const idLidi = [
    ...new Set(smeny.map((s) => s.employee_id).filter((i): i is string => !!i)),
  ];
  if (idLidi.length > 0) {
    const { data: lide } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", idLidi);
    for (const c of lide ?? []) jmena.set(c.id as string, c.full_name as string);
  }

  const idPozic = [
    ...new Set(smeny.map((s) => s.position_id).filter((i): i is string => !!i)),
  ];
  if (idPozic.length > 0) {
    const { data: p } = await supabase
      .from("positions")
      .select("id, label")
      .in("id", idPozic);
    for (const c of p ?? []) pozice.set(c.id as string, c.label as string);
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  if (smeny.length === 0) {
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
    <>
      <h2
        style={{
          margin: "0 0 16px",
          fontSize: "16px",
          color: "var(--muted)",
          fontWeight: 500,
        }}
      >
        Rozpis směn
      </h2>
      <RozpisView
        smeny={smeny}
        dnesni={odKdy}
        dayStartsAt={dayStartsAt}
        jmena={jmena}
        pozice={pozice}
        nazvyPobocek={nazvyPobocek}
        rozsah={{
          level: scope.level,
          branchId: scope.branchId ?? null,
          branchName: scope.branchName ?? null,
        }}
      />
    </>
  );
}
