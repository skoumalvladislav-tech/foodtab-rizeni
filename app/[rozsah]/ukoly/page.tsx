import Link from "next/link";
import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { redirect } from "next/navigation";

import { getUser, hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import EmptyState from "@/components/ui/EmptyState";
import Nadpis from "../nadpis";
import PcZalozky from "../provozni-centrum/zalozky";
import Ikona from "../ikona";
import Checklisty, { type KlicPohledu } from "./checklisty";
import { dokoncitUkol, zadatUkol } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Úkoly a checklisty.
 *
 * Úkol bez pobočky (`branch_id` prázdné) patří celé firmě a vidí ho každý
 * s oprávněním — proto se na pobočkové adrese ptáme na „moje pobočka nebo
 * nic“, ne jen na pobočku.
 *
 * Odškrtnout úkol smí podle politiky tasks_write jen ten, kdo má
 * tasks.manage. Ostatním se seznam ukáže, ale bez tlačítka.
 */

type Ukol = {
  id: string;
  branch_id: string | null;
  title: string;
  note: string;
  due_at: string | null;
  priority: string;
  status: string;
  // Jeden cíl na úkol — hlídá to omezení `tasks_jeden_cil` v databázi.
  usek_id: string | null;
  position_id: string | null;
  employee_id: string | null;
};

/**
 * Je úkol po termínu?
 *
 * Porovnávají se OKAMŽIKY (`due_at` je timestamptz), ne hodiny na zdi,
 * takže se tu žádné pásmo dodávat nemusí — a hlavně nesmí. Pásmo je
 * potřeba až při VYPISOVÁNÍ času, což dělá `denAcas`.
 */
function poTerminu(due: string | null): boolean {
  if (!due) return false;
  return new Date(due).getTime() < Date.now();
}

/** Komu úkol zní. Nanejvýš jeden z těch tří je vyplněný. */
function adresat(
  u: Ukol,
  useky: Map<string, string>,
  pozice: Map<string, string>,
  lide: Map<string, string>,
): string | null {
  if (u.usek_id) return useky.get(u.usek_id) ?? "úsek";
  if (u.position_id) return pozice.get(u.position_id) ?? "pozice";
  if (u.employee_id) return lide.get(u.employee_id) ?? "konkrétní člověk";
  return null;
}

export default async function Ukoly({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{
    ukol?: string;
    chyba?: string;
    /** Pohled na Checklisty: dnes/moje/sablony/historie (viz checklisty.tsx). */
    cl?: string;
    usek?: string;
    stav?: string;
    strana?: string;
  }>;
}) {
  const { rozsah } = await params;
  const { ukol: chybnyUkol, chyba, cl, usek, stav, strana } = await searchParams;
  const POHLEDY_CL: KlicPohledu[] = ["dnes", "moje", "sablony", "historie"];
  const pohledCl: KlicPohledu = (POHLEDY_CL as string[]).includes(cl ?? "") ? (cl as KlicPohledu) : "dnes";
  const stranaCl = Math.max(1, Number(strana) || 1);

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na úkoly vaše oprávnění nedosáhne. Pokud si myslíte, že by měla,
        řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  let dotazUkoly = supabase
    .from("tasks")
    .select("id, branch_id, title, note, due_at, priority, status, usek_id, position_id, employee_id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (scope.level === "branch" && scope.branchId) {
    // Firemní úkoly (branch_id prázdné) patří i pobočce.
    dotazUkoly = dotazUkoly.or(
      `branch_id.eq.${scope.branchId},branch_id.is.null`,
    );
  }

  const { data: ukolyData, error: chybaUkolyData } = await dotazUkoly;
  if (chybaUkolyData) throw new DotazSelhal("úkoly", chybaUkolyData);
  const ukoly = (ukolyData ?? []) as Ukol[];

  // Checklisty se vedou na pobočku — checklist_runs.branch_id je NOT NULL.
  // Vlastní data/dotazy má checklisty.tsx (Checklisty 2.0, 23. 9.).
  const branchId = scope.branchId;

  /*
    Číselníky pro adresáta a pro formulář.

    Úseky a pozice čte každý člen firmy (politiky useky_select
    a positions_select), takže tyhle dva dotazy projdou i číšníkovi.
    U lidí to tak není: employees_select pouští jen vlastní řádek,
    shifts.read na pobočce nebo people.manage — kdo má tasks.manage
    a nic z toho, dostane prázdný seznam. Formulář to pak přizná
    místo toho, aby tvářil, že firma nemá zaměstnance.
  */
  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);
  const nazvyUseku = new Map(
    (usekyData ?? []).map((u) => [u.id as string, String(u.nazev)]),
  );

  const { data: poziceData, error: chybaPozice } = await supabase
    .from("positions")
    .select("id, label")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("label", { ascending: true });
  if (chybaPozice) throw new DotazSelhal("pozice", chybaPozice);
  const nazvyPozic = new Map(
    (poziceData ?? []).map((p) => [p.id as string, String(p.label)]),
  );

  const { data: lideData, error: chybaLide } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (chybaLide) throw new DotazSelhal("lidé pro zadání úkolu", chybaLide);
  const jmenaLidi = new Map(
    (lideData ?? []).map((l) => [l.id as string, String(l.full_name)]),
  );

  const smiZadat = await hasAccess(tenantId, "tasks.manage", scope.branchId);

  // Pro záložku "Moje" v Checklistech — čí je to zaměstnanecký záznam.
  // null u účtu bez vlastního řádku v employees (výjimečné, ale platné).
  const user = await getUser();
  let mujEmployeeId: string | null = null;
  if (user) {
    const { data: jaData, error: chybaJa } = await supabase
      .from("employees")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1);
    if (chybaJa) throw new DotazSelhal("můj zaměstnanecký záznam", chybaJa);
    mujEmployeeId = (jaData?.[0]?.id as string | undefined) ?? null;
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    <>
      <Nadpis oci="Provoz" popis="Jednorázové úkoly a checklisty, které se opakují každou směnu.">
        Úkoly a checklisty
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {/* Záložky Provozního centra — kdo tuhle obrazovku vidí, má tasks.read. */}
        <PcZalozky rozsah={rozsah} aktivni="ukoly" pocty={{ ukoly: ukoly.length }} />

        {/*
          Kompaktní souhrn — UX redesign, druhé kolo (oddíl 9). Jen
          čísla, která appka umí spočítat bez odhadu: otevřené úkoly už
          má načtené, po termínu je stejné porovnání jako u štítku
          u každého úkolu níž. "Dnes"/"Hotovo" by potřebovaly datum
          podle pásma pobočky a na firemní úrovni ho nemá o co opřít —
          radši žádné číslo než tiše špatné.
        */}
        {ukoly.length > 0 ? (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "18px", fontSize: "13px", color: "var(--muted)" }}>
            <span><strong style={{ color: "var(--ink)" }}>{ukoly.length}</strong> otevřených</span>
            {ukoly.some((u) => poTerminu(u.due_at)) ? (
              <span style={{ color: "var(--bad)" }}>
                <strong>{ukoly.filter((u) => poTerminu(u.due_at)).length}</strong> po termínu
              </span>
            ) : null}
          </div>
        ) : null}

        {/*
          JEDEN FORMULÁŘ, JEDEN ADRESÁT.

          7shifts to má stejně: *„a specific Location, Department, Role,
          or Employee“*. Víc adresátů = víc úkolů, proto přepínač a ne
          zaškrtávátka — pole na seznam příjemců se nevymýšlí.

          Přepínač ale není zámek: hlídá to omezení `tasks_jeden_cil`
          na tabulce a ještě jednou průzor `zadat_ukol`, který na to
          odpoví větou místo hláškou o porušení `check`.
        */}
        {smiZadat ? (
          <details style={ramecekFormulare}>
            <summary style={{ cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
              + Zadat úkol
            </summary>

            {/*
              `id` je schválně na formuláři, ne na `details`. Odkaz
              „+ Zadat úkol“ z prázdného stavu (níž) míří na `#zadat-ukol`
              a spoléhá na to, že prohlížeč sám rozbalí `details`, když
              cíl kotvy leží uvnitř skrytého obsahu — `details` samotný
              je ale vidět pořád (jen sbalený), takže odkaz na jeho
              vlastní `id` by ho k otevření nedonutil a tlačítko by
              vypadalo, že nereaguje.
            */}
            <form id="zadat-ukol" action={zadatUkol} style={{ marginTop: "12px" }}>
              <input type="hidden" name="rozsah" value={rozsah} />

              <fieldset style={poleSkupina}>
                <legend style={popisek}>Komu</legend>

                <label style={volba}>
                  <input type="radio" name="komu" value="pobocka" defaultChecked />
                  {scope.level === "tenant" ? "celá firma" : `celá pobočka ${scope.branchName ?? ""}`}
                </label>

                <label style={volba}>
                  <input type="radio" name="komu" value="usek" />
                  úsek
                  <select name="usek" style={vyber} defaultValue="">
                    <option value="">— vyberte —</option>
                    {[...nazvyUseku].map(([id, nazev]) => (
                      <option key={id} value={id}>{nazev}</option>
                    ))}
                  </select>
                </label>

                <label style={volba}>
                  <input type="radio" name="komu" value="pozice" />
                  pozice
                  <select name="pozice" style={vyber} defaultValue="">
                    <option value="">— vyberte —</option>
                    {[...nazvyPozic].map(([id, nazev]) => (
                      <option key={id} value={id}>{nazev}</option>
                    ))}
                  </select>
                </label>

                <label style={volba}>
                  <input type="radio" name="komu" value="clovek" />
                  člověk
                  <select name="clovek" style={vyber} defaultValue="">
                    <option value="">— vyberte —</option>
                    {[...jmenaLidi].map(([id, jmeno]) => (
                      <option key={id} value={id}>{jmeno}</option>
                    ))}
                  </select>
                </label>

                {/*
                  Jmenovité přiřazení je štítek, ne zámek — až na to, že
                  dnes zámek ještě je. Radši to napsat, než aby vedoucí
                  čekal na zástup, který úkol splnit nesmí.
                  Viz docs/hlaseni/stav-2026-09-06.md.
                */}
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                  Úkol na člověka dnes smí splnit jen on sám nebo vedoucí.
                  Chystá se změna, aby mohl zaskočit kdokoli.
                </p>
              </fieldset>

              <fieldset style={poleSkupina}>
                <legend style={popisek}>Kdy</legend>
                {/*
                  `datetime-local` je hodina NA ZDI, bez pásma — a tak se
                  taky posílá dál. Okamžik z toho dělá až databáze podle
                  pásma pobočky (`zadat_ukol`). Kdyby se tu volalo
                  `new Date(...)`, přečte se ten řetězec v pásmu serveru,
                  a ten je na Vercelu v UTC: termín by na obrazovce seděl
                  a v databázi byl o dvě hodiny vedle. Pravidlo 11.
                */}
                <input
                  type="datetime-local"
                  name="termin"
                  style={{ ...pole, minHeight: "44px" }}
                />
              </fieldset>

              <fieldset style={poleSkupina}>
                <legend style={popisek}>Co</legend>
                <input
                  type="text"
                  name="nazev"
                  required
                  maxLength={200}
                  placeholder="Co se má udělat"
                  style={pole}
                />
                <textarea
                  name="poznamka"
                  rows={2}
                  placeholder="Poznámka (nepovinné)"
                  style={{ ...pole, marginTop: "8px", resize: "vertical" }}
                />
                <label style={{ ...volba, marginTop: "8px" }}>
                  <input type="checkbox" name="priorita" value="high" />
                  přednostně
                </label>
              </fieldset>

              <button type="submit" className="ft-tl ft-tl-hlavni">
                Zadat úkol
              </button>
            </form>
          </details>
        ) : null}

        {/*
          Úkoly a checklisty vedle sebe od ~900px — stejný princip jako
          Docházka (design systém, 16.9.2026): dvě rovnocenné sekce,
          auto-fit grid se sám podsune pod sebe, když se dvě 320px
          položky vedle sebe nevejdou, žádný media dotaz netřeba.
        */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px", alignItems: "start" }}>
        <div>
        <h2 style={nadpisSekce}>Otevřené úkoly</h2>

        {ukoly.length === 0 ? (
          <EmptyState
            ikona={<Ikona klic="fajfka" />}
            nadpis="Všechno je hotové"
            akce={smiZadat ? <a href="#zadat-ukol" className="ft-tl ft-tl-hlavni ft-tl-male">+ Zadat úkol</a> : undefined}
          >
            Nemáte žádné otevřené úkoly.
          </EmptyState>
        ) : (
          <ul style={seznam}>
            {ukoly.map((u) => (
              <li
                key={u.id}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderLeft: `3px solid ${
                    u.priority === "high" ? "var(--warn)" : "var(--line)"
                  }`,
                  borderRadius: "var(--radius-md)",
                  padding: "14px",
                  boxShadow: u.priority === "high" ? "var(--shadow-sm)" : "none",
                }}
              >
                <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                  <Link href={`/${rozsah}/ukoly/ukol/${u.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {u.title}
                  </Link>
                </p>

                {u.note ? (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: "var(--muted)",
                    }}
                  >
                    {u.note}
                  </p>
                ) : null}

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  {[
                    u.branch_id === null
                      ? "celá firma"
                      : scope.level === "tenant"
                        ? (nazvyPobocek.get(u.branch_id) ?? "jiná pobočka")
                        : null,
                    // Komu to zní. Štítek, ne zámek — kdo na úkol vidí,
                    // ten ho i splní, a `done_by` pak řekne kdo.
                    adresat(u, nazvyUseku, nazvyPozic, jmenaLidi),
                    u.due_at ? `termín ${denAcas(u.due_at)}` : null,
                    /*
                      ÚKOL PO TERMÍNU NEZMIZÍ.

                      7shifts ho po dvou hodinách skryje; nepřebíráme to.
                      Úkol, který se ztratí z očí, nikdo nedodělá — a
                      pozdě zapsaná teplota lednice je pořád lepší než
                      žádná. Zůstane vidět, jen označený.
                    */
                    poTerminu(u.due_at) ? "PO TERMÍNU" : null,
                    u.priority === "high" ? "přednostně" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {/*
                  Tlačítko se ukáže každému, kdo úkol vidí. O tom, jestli
                  ho smí zavřít, rozhoduje public.complete_task() — vedoucí,
                  adresát i jeho role. Ptát se dopředu přes canSee by
                  znamenalo mít pravidlo na dvou místech.
                */}
                <form action={dokoncitUkol} style={{ marginTop: "10px" }}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="ukol" value={u.id} />
                  <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                    Hotovo
                  </button>
                </form>

                {chybnyUkol === u.id && chyba ? (
                  <p
                    role="alert"
                    style={{
                      margin: "8px 0 0",
                      fontSize: "13px",
                      color: "var(--bad)",
                    }}
                  >
                    {popisChyby(chyba)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        </div>

        <div id="checklisty" style={{ scrollMarginTop: "72px" }}>
          <Checklisty
            rozsah={rozsah}
            tenantId={tenantId}
            branchId={branchId}
            branches={ctx.branches}
            mujEmployeeId={mujEmployeeId}
            jmenaLidi={jmenaLidi}
            smiZadat={smiZadat}
            pohled={pohledCl}
            usekFiltr={usek ?? null}
            stavFiltr={stav ?? null}
            strana={stranaCl}
            chyba={chyba ?? null}
          />
        </div>
        </div>
      </div>
    </>
  );
}

/* --- styly a pomocné funkce -------------------------------------- */

const nadpisSekce = {
  margin: "0 0 12px",
  fontSize: "16px",
  color: "var(--muted)",
  fontWeight: 500,
} as const;

const seznam = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "10px",
} as const;

/** Hlášky z ?chyba= po neúspěšném zavření úkolu. */
function popisChyby(kod: string): string {
  switch (kod) {
    case "cizi":
      return "Tenhle úkol není váš.";
    case "chybi":
      return "Úkol už neexistuje.";
    default:
      return "Úkol se nepodařilo zavřít. Zkuste to prosím znovu.";
  }
}

/*
  Pásmo se dodává vždycky. Bez něj bere JavaScript pásmo serveru — na
  Vercelu UTC — a čas je v létě o dvě hodiny vedle. Viz lib/cas.ts.
*/
function denAcas(iso: string, zona?: string): string {
  return datumACasVPasmu(iso, zona ?? ZONA_VYCHOZI);
}

/* --- Vzhled formuláře pro zadání úkolu ------------------------- */

const ramecekFormulare = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  marginBottom: "16px",
} as const;

const poleSkupina = {
  border: "none",
  padding: 0,
  margin: "0 0 14px",
} as const;

const popisek = {
  fontSize: "13px",
  color: "var(--muted)",
  padding: 0,
  marginBottom: "6px",
} as const;

const volba = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "14px",
  color: "var(--ink)",
  marginBottom: "6px",
} as const;

const pole = {
  width: "100%",
  padding: "10px 12px",
  // 16 px schválně: iOS jinak při zaostření pole zoomuje celou stránku.
  fontSize: "16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const vyber = {
  ...pole,
  width: "auto",
  flex: 1,
  minHeight: "44px",
} as const;
