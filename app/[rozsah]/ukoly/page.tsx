import Link from "next/link";
import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { dokoncitUkol, spustitChecklist, zadatUkol } from "./akce";

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

type Sablona = {
  id: string;
  branch_id: string | null;
  name: string;
  /*
    Úsek místo napevno psaného `department`.

    Dřív se tu vypisovala strojová hodnota z pětice zadrátované v kódu
    (`kuchyne`, `bar`, …) — takže bistro s jedním pultem mělo v tabulce
    „servis“, protože nic bližšího na výběr nebylo. Teď je to název,
    který si firma zadala sama (20260906030000_useky).

    Může být prázdný: šablona bez úseku je platná a znamená „nikam
    zvlášť“.
  */
  /*
    Tvar je schválně „objekt NEBO pole“. PostgREST vrací u vazby na
    jeden řádek objekt, ale typ odvozený z klienta ji hlásí jako pole —
    a `as Sablona[]` na to spadne při překladu typů. Přetypovat to přes
    `unknown` by chybu jen umlčelo; tohle ji řeší tak, že projde obojí.
  */
  useky: { nazev: string } | { nazev: string }[] | null;
  schedule: string;
};

/** Název úseku ze vztahu, ať přijde jako objekt nebo jako pole. */
function nazevUseku(u: Sablona["useky"]): string | null {
  if (!u) return null;
  const r = Array.isArray(u) ? u[0] : u;
  const nazev = String(r?.nazev ?? "").trim();
  return nazev === "" ? null : nazev;
}

export default async function Ukoly({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ ukol?: string; chyba?: string }>;
}) {
  const { rozsah } = await params;
  const { ukol: chybnyUkol, chyba } = await searchParams;

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
  const branchId = scope.branchId;
  let sablony: Sablona[] = [];
  const behy = new Map<string, { id: string; status: string; hotovo: number }>();
  const poctyPolozek = new Map<string, number>();
  let den: string | null = null;

  if (branchId) {
    den = await provozniDen(branchId);

    const { data: sablonyData, error: chybaSablonyData } = await supabase
      .from("checklist_templates")
      .select("id, branch_id, name, schedule, useky(nazev)")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order("name", { ascending: true });
    if (chybaSablonyData) throw new DotazSelhal("šablony checklistů", chybaSablonyData);

    sablony = (sablonyData ?? []) as Sablona[];

    if (sablony.length > 0) {
      const idSablon = sablony.map((s) => s.id);

      const { data: polozky, error: chybaPolozky } = await supabase
        .from("checklist_items")
        .select("id, template_id")
        .in("template_id", idSablon);
      if (chybaPolozky) throw new DotazSelhal("položky checklistu", chybaPolozky);

      for (const p of polozky ?? []) {
        const t = p.template_id as string;
        poctyPolozek.set(t, (poctyPolozek.get(t) ?? 0) + 1);
      }

      if (den) {
        const { data: behyData, error: chybaBehyData } = await supabase
          .from("checklist_runs")
          .select("id, template_id, status")
          .eq("branch_id", branchId)
          .eq("business_date", den)
          .in("template_id", idSablon);
        if (chybaBehyData) throw new DotazSelhal("běhy checklistů", chybaBehyData);

        const idBehu = (behyData ?? []).map((b) => b.id as string);
        const hotoveVBehu = new Map<string, number>();

        if (idBehu.length > 0) {
          const { data: zaznamy, error: chybaZaznamy } = await supabase
            .from("checklist_entries")
            .select("run_id, checked")
            .in("run_id", idBehu);
          if (chybaZaznamy) throw new DotazSelhal("odškrtnuté položky", chybaZaznamy);

          for (const z of zaznamy ?? []) {
            if (z.checked !== true) continue;
            const r = z.run_id as string;
            hotoveVBehu.set(r, (hotoveVBehu.get(r) ?? 0) + 1);
          }
        }

        for (const b of behyData ?? []) {
          behy.set(b.template_id as string, {
            id: b.id as string,
            status: b.status as string,
            hotovo: hotoveVBehu.get(b.id as string) ?? 0,
          });
        }
      }
    }
  }

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

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    <>
      <Nadpis oci="Provoz" popis="Jednorázové úkoly a checklisty, které se opakují každou směnu.">
        Úkoly a checklisty
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
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
            <summary style={{ cursor: "pointer", fontSize: "15px" }}>
              Zadat úkol
            </summary>

            <form action={zadatUkol} style={{ marginTop: "12px" }}>
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

        <h2 style={nadpisSekce}>Otevřené úkoly</h2>

        {ukoly.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Žádný otevřený úkol. Hotovo.
          </p>
        ) : (
          <ul style={seznam}>
            {ukoly.map((u) => (
              <li
                key={u.id}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderLeft: `4px solid ${
                    u.priority === "high" ? "var(--warn)" : "var(--line)"
                  }`,
                  borderRadius: "12px",
                  padding: "14px",
                }}
              >
                <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                  {u.title}
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

        <h2 style={{ ...nadpisSekce, marginTop: "28px" }}>Checklisty</h2>

        {!branchId ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Checklisty se vedou po pobočkách. Přepněte se na konkrétní
            pobočku.
          </p>
        ) : !den ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Nepodařilo se zjistit provozní den, takže checklisty nelze
            zobrazit.
          </p>
        ) : sablony.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Pro tuhle pobočku není nastavený žádný checklist.
          </p>
        ) : (
          <ul style={seznam}>
            {sablony.map((s) => {
              const beh = behy.get(s.id);
              const celkem = poctyPolozek.get(s.id) ?? 0;

              return (
                <li
                  key={s.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "14px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                    {s.name}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {[
                      nazevUseku(s.useky),
                      beh
                        ? `${beh.hotovo} z ${celkem} hotovo`
                        : `${celkem} položek`,
                      beh?.status === "done" ? "uzavřeno" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  {beh ? (
                    <Link
                      href={`/${rozsah}/ukoly/${beh.id}`}
                      className="ft-tl ft-tl-hlavni ft-tl-male"
                      style={{ marginTop: "10px" }}
                    >
                      {beh.status === "done" ? "Zobrazit" : "Pokračovat"}
                    </Link>
                  ) : (
                    <form action={spustitChecklist} style={{ marginTop: "10px" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="sablona" value={s.id} />
                      <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                        Spustit
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
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
  borderRadius: "14px",
  padding: "14px",
  marginBottom: "20px",
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
  borderRadius: "10px",
  border: "1px solid var(--line)",
  background: "var(--paper)",
  color: "var(--ink)",
} as const;

const vyber = {
  ...pole,
  width: "auto",
  flex: 1,
  minHeight: "44px",
} as const;
