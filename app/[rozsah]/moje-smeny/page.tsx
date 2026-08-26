import { redirect } from "next/navigation";

import { getUser } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";

export const dynamic = "force-dynamic";

/**
 * Moje směny.
 *
 * VZOR PRO DALŠÍ OBRAZOVKY. Drží se tří kroků v tomhle pořadí:
 *   1. kontrola přístupu — dřív, než se sáhne na data
 *   2. načtení dat — výhradně přes lib/supabase/server.ts, ať platí RLS
 *   3. vykreslení — žádné rozhodování o právech, to je hotové v kroku 1
 *
 * Data se netahají servisním klíčem. Dotazy jdou pod přihlášeným
 * uživatelem, takže i kdyby se do podmínky vloudila chyba, Row Level
 * Security cizí řádky nepustí ven.
 */

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

export default async function MojeSmeny({
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

  // Až za odchytáváním: redirect() vyhazuje výjimku a uvnitř try by se
  // ztratil.
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

  const user = await getUser();
  const supabase = await getServerSupabase();

  // Kdo jsem v téhle firmě. Směny visí na zaměstnaneckém záznamu,
  // samotný účet nestačí.
  const { data: mojeZaznamy } = await supabase
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user?.id ?? "")
    .is("deleted_at", null);

  const mojeIds = (mojeZaznamy ?? []).map((z) => z.id as string);

  if (mojeIds.length === 0) {
    return (
      <Sdeleni nadpis="Nemáte zaměstnanecký záznam">
        Váš účet zatím není propojený se zaměstnancem, takže k němu
        nejdou přiřadit směny. Doplní to správce firmy.
      </Sdeleni>
    );
  }

  let dotaz = supabase
    .from("shifts")
    .select("id, branch_id, shift_date, starts_at, ends_at, status")
    .in("employee_id", mojeIds)
    .gte("shift_date", vcerejsiDatum())
    .neq("status", "cancelled")
    .order("shift_date", { ascending: true })
    .order("starts_at", { ascending: true });

  // Na pobočkové adrese ukazujeme jen tu pobočku, na firemní všechno.
  if (scope.level === "branch" && scope.branchId) {
    dotaz = dotaz.eq("branch_id", scope.branchId);
  }

  const { data: nactene } = await dotaz;
  const smeny = ((nactene ?? []) as Smena[]).filter(jeNadchazejici);

  // Kdo je na směně se mnou: ostatní směny na téže pobočce a v tentýž
  // provozní den. RLS vrátí jen to, na co uživatel dosáhne.
  let kolegove: Kolega[] = [];
  const jmena = new Map<string, string>();

  if (smeny.length > 0) {
    const pobocky = [...new Set(smeny.map((s) => s.branch_id))];
    const dny = [...new Set(smeny.map((s) => s.shift_date))];

    const { data: spolu } = await supabase
      .from("shifts")
      .select("branch_id, shift_date, employee_id")
      .in("branch_id", pobocky)
      .in("shift_date", dny)
      .neq("status", "cancelled");

    kolegove = ((spolu ?? []) as Kolega[]).filter(
      (k) => k.employee_id !== null && !mojeIds.includes(k.employee_id),
    );

    const idLidi = [...new Set(kolegove.map((k) => k.employee_id as string))];
    if (idLidi.length > 0) {
      const { data: lide } = await supabase
        .from("employees")
        .select("id, full_name")
        .in("id", idLidi);
      for (const clovek of lide ?? []) {
        jmena.set(clovek.id as string, clovek.full_name as string);
      }
    }
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  if (smeny.length === 0) {
    return (
      <Sdeleni nadpis="Žádné nadcházející směny">
        {scope.level === "branch"
          ? `Na pobočce ${scope.branchName} na vás zatím žádná směna nečeká.`
          : "Zatím na vás nečeká žádná směna."}
      </Sdeleni>
    );
  }

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    <main style={{ padding: "16px", paddingBottom: "32px" }}>
      <h2
        style={{
          margin: "0 0 16px",
          fontSize: "16px",
          color: "var(--muted)",
          fontWeight: 500,
        }}
      >
        Moje směny
      </h2>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "12px",
        }}
      >
        {smeny.map((s) => {
          const semnou = kolegove
            .filter(
              (k) =>
                k.branch_id === s.branch_id && k.shift_date === s.shift_date,
            )
            .map((k) => jmena.get(k.employee_id as string))
            .filter((j): j is string => Boolean(j));

          return (
            <li
              key={s.id}
              style={{
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderLeft: `4px solid ${
                  s.status === "confirmed" ? "var(--good)" : "var(--warn)"
                }`,
                borderRadius: "14px",
                boxShadow: "var(--shadow)",
                padding: "16px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
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
                {hodina(s.starts_at)} – {hodina(s.ends_at)}
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
    </main>
  );
}

/* --- pomocné funkce ---------------------------------------------- */

function naDatum(d: Date): string {
  const mesic = String(d.getMonth() + 1).padStart(2, "0");
  const den = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mesic}-${den}`;
}

/**
 * Dolní hranice dotazu. Bereme i včerejšek: směna přes půlnoc patří
 * pořád do včerejšího provozního dne, a dokud neskončí, je to
 * nadcházející směna.
 *
 * Čtení hodin je schválně tady a ne v těle komponenty — pravidlo
 * react-hooks/purity nedovolí volat nečisté funkce přímo v ní.
 */
function vcerejsiDatum(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return naDatum(d);
}

/** Směna je nadcházející, dokud neskončila. */
function jeNadchazejici(s: Smena): boolean {
  return konecSmeny(s).getTime() > Date.now();
}

function hodina(cas: string): string {
  return cas.slice(0, 5);
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

  const den = DNY[d.getDay()];
  return `${den.charAt(0).toUpperCase()}${den.slice(1)} · ${cislo}`;
}
