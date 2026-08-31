import { redirect } from "next/navigation";

import { NAZVY_MODULU } from "../../nabidka";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { ulozitOpravneni } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Nastavení → Oprávnění
 *
 * Oprávnění je POJMENOVANÁ SADA práv: Majitel, Provozní, Servis. To, co
 * je uvnitř, jsou zaškrtávátka s větou („Vidět rozpis směn“) — ta se
 * oprávněním nikde neříká, jinak by to slovo znamenalo dvě věci naráz.
 *
 * S pozicí to nesouvisí. Pozice říká, čím ten člověk je; tohle říká,
 * co smí v aplikaci. Brigádník má pozici a žádné oprávnění.
 *
 * Majitel se needituje. Dostává všechno, co spadá do zapnutých modulů,
 * přes app.has_access — kdyby se mu práva odebírala tady, dal by se
 * zamknout ven z vlastní firmy.
 */

type Role = {
  id: string;
  key: string;
  label: string;
  is_owner: boolean;
};

type Pravo = {
  key: string;
  module_key: string;
  label: string;
  sensitive: boolean;
  sort_order: number;
};

export default async function NastaveniOpravneni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{
    chyba?: string;
    ulozeno?: string;
    pridano?: string;
    odebrano?: string;
  }>;
}) {
  const { rozsah } = await params;
  const { chyba, ulozeno, pridano, odebrano } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  /*
    Obrazovka je zavřená na settings.manage. Kdo si adresu napíše ručně
    a právo nemá, dostane vysvětlení — ne obsah. Schovaná položka
    v nabídce není zámek, zámek je tenhle řádek a politiky v databázi.
  */
  const pristup = await zkusPristup(tenantId, "settings.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Oprávnění nastavuje jen ten, kdo má právo{" "}
        <code>settings.manage</code>. Řekněte si o ně správci firmy.
      </Sdeleni>
    );
  }

  const { ctx } = pristup;
  const supabase = await getServerSupabase();

  const { data: roleData } = await supabase
    .from("roles")
    .select("id, key, label, is_owner")
    .eq("tenant_id", tenantId)
    .order("is_owner", { ascending: false })
    .order("label");

  const role = (roleData ?? []) as Role[];

  const { data: pravaData } = await supabase
    .from("permissions")
    .select("key, module_key, label, sensitive, sort_order")
    .order("sort_order");

  /*
    Nabízejí se jen práva ze zapnutých modulů. Právo z modulu, který
    firma nemá, by nic neotevřelo — app.has_access ho stejně odmítne —
    a v seznamu by jen mátlo. Až se modul zapne, objeví se sama.
  */
  const zapnute = new Set<string>(
    ctx.modules.filter((m) => m.active).map((m) => String(m.key)),
  );
  const prava = ((pravaData ?? []) as Pravo[]).filter((p) =>
    zapnute.has(p.module_key),
  );

  const { data: vazby } = await supabase
    .from("role_permissions")
    .select("role_id, permission_key")
    .in("role_id", role.map((r) => r.id));

  const maPravo = new Map<string, Set<string>>();
  for (const v of vazby ?? []) {
    const id = v.role_id as string;
    if (!maPravo.has(id)) maPravo.set(id, new Set());
    maPravo.get(id)!.add(v.permission_key as string);
  }

  // Práva po modulech, ať se dlouhý seznam dá číst.
  const podleModulu = new Map<string, Pravo[]>();
  for (const p of prava) {
    if (!podleModulu.has(p.module_key)) podleModulu.set(p.module_key, []);
    podleModulu.get(p.module_key)!.push(p);
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Pojmenované sady práv. Čím kdo je (číšník, kuchař) se nastavuje v Pozicích — to je něco jiného."
      >
        Oprávnění
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
        {ulozeno ? (
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "var(--good)" }}>
            {ulozeno} uloženo — {zmena(pridano, odebrano)}
          </p>
        ) : null}

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "16px" }}>
          {role.map((r) => {
            const moje = maPravo.get(r.id) ?? new Set<string>();

            return (
              <li
                key={r.id}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: "14px",
                  boxShadow: "var(--shadow)",
                  padding: "18px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "18px", color: "var(--ink)" }}>
                  {r.label}
                </h2>

                {r.is_owner ? (
                  <>
                    <p style={popisRole}>
                      Majitel má všechno ze zapnutých modulů a nedá se to
                      měnit. Kdyby se mu práva odebírala, mohl by se
                      zamknout ven z vlastní firmy — proto o tom rozhoduje
                      databáze, ne tahle obrazovka.
                    </p>
                    <div style={mrizka}>
                      {prava.map((p) => (
                        <span key={p.key} style={{ ...radekPrava, opacity: 0.75 }}>
                          <span aria-hidden="true">✓</span>
                          <span>
                            {p.label}
                            {p.sensitive ? <Citlive /> : null}
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <form key={`role-${r.id}`} action={ulozitOpravneni}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="role" value={r.id} />

                    {[...podleModulu.entries()].map(([modul, seznam]) => (
                      <div key={modul} style={{ marginTop: "14px" }}>
                        <p style={nadpisModulu}>
                          {NAZVY_MODULU[modul as keyof typeof NAZVY_MODULU] ?? modul}
                        </p>
                        <div style={mrizka}>
                          {seznam.map((p) => (
                            <label key={p.key} style={radekPrava}>
                              {/*
                                Skryté pole říká akci, co obrazovka
                                nabízela. Bez něj by se při uložení
                                odebrala i práva z vypnutých modulů,
                                která se nekreslila a nikdo je neodškrtl.
                              */}
                              <input type="hidden" name="nabizeno" value={p.key} />
                              <input
                                type="checkbox"
                                name="pravo"
                                value={p.key}
                                defaultChecked={moje.has(p.key)}
                              />
                              <span>
                                {p.label}
                                {p.sensitive ? <Citlive /> : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}

                    <button
                      type="submit"
                      className="ft-tl ft-tl-hlavni"
                      style={{ marginTop: "16px" }}
                    >
                      Uložit {r.label}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/**
 * Štítek u citlivého práva.
 *
 * Vyplněný štítek se slovem, ne jiný odstín — barvu sama o sobě
 * nepřečte ten, kdo ji nerozezná, a tohle je právě to místo, kde se
 * omylem rozdají mzdy nebo docházka.
 *
 * Příznak `sensitive` není ozdoba: role s citlivým právem nejde pozvat
 * přes SMS, jen e-mailem.
 */
function Citlive() {
  return (
    <span
      style={{
        marginLeft: "8px",
        padding: "1px 7px",
        borderRadius: "999px",
        background: "var(--pozor-bg)",
        color: "var(--pozor)",
        fontSize: "11.5px",
        whiteSpace: "nowrap",
      }}
    >
      citlivé
    </span>
  );
}

function popisChyby(kod: string): string {
  switch (kod) {
    case "majitel":
      return "Oprávnění majitele se needituje.";
    case "neznama":
      return "Taková sada oprávnění ve firmě není.";
    case "pravo":
      return "Na změnu oprávnění nemáte právo.";
    default:
      return "Uložení se nepovedlo. Zkuste to prosím znovu.";
  }
}

function zmena(pridano?: string, odebrano?: string): string {
  const p = Number(pridano ?? 0);
  const o = Number(odebrano ?? 0);
  if (p === 0 && o === 0) return "nic se nezměnilo";
  const casti = [];
  if (p > 0) casti.push(`přidáno ${p}`);
  if (o > 0) casti.push(`odebráno ${o}`);
  return casti.join(", ");
}

/* --- styly ------------------------------------------------------- */

const popisRole = {
  margin: "8px 0 12px",
  fontSize: "13px",
  color: "var(--muted)",
  maxWidth: "68ch",
} as const;

const nadpisModulu = {
  margin: "0 0 8px",
  fontSize: "11.5px",
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: ".1em",
  color: "var(--mosaz)",
} as const;

const mrizka = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "8px 18px",
} as const;

const radekPrava = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "14px",
  color: "var(--ink)",
  minHeight: "32px",
} as const;
