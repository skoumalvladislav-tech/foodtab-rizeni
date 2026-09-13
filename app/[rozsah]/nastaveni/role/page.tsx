import { redirect } from "next/navigation";

import { NAZVY_MODULU } from "../../nabidka";
import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { smimPridelit } from "@/lib/prideleni";
import { seznam } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { ulozitOpravneni } from "./akce";
import {
  prejmenovatPozici,
  prepnoutPozici,
  zalozitPozici,
} from "../pozice/akce";

export const dynamic = "force-dynamic";

/**
 * Nastavení → Oprávnění
 *
 * Oprávnění nese ZAŘAZENÍ — Číšník, Kuchař, Provozní. Je to jedna věc,
 * ne dvě: do 9. 9. 2026 tu byly zvlášť „pozice" (čím ten člověk je)
 * a „role" (co smí), a Šéfík to právem vnímal jako dvojí zadávání
 * téhož. Zadání: docs/zarazeni-misto-roli.md, oddíl 6.1.
 *
 * To, co je uvnitř, jsou zaškrtávátka s větou („Vidět rozpis směn“) —
 * ta se oprávněním nikde neříká, jinak by to slovo znamenalo dvě věci
 * naráz.
 *
 * ŽIVÉ PRAVIDLO: co se tu zaškrtne, platí okamžitě všem, kdo to
 * zařazení mají. Nic se nikomu nekopíruje — proto je u každého
 * zařazení napsané, kolika lidí se změna týká.
 *
 * MAJITEL TU NENÍ, a je to schválně. Majitelství je vlastnost ČLOVĚKA
 * (`employees.je_majitel`), ne pracovní zařazení: Šéfík může být
 * v rozpisu vedený jako provozní a majitelem být pořád. Dostává
 * všechno ze zapnutých modulů přes `app.has_access` — kdyby se mu
 * práva odebírala tady, dal by se zamknout ven z vlastní firmy.
 */

type Zarazeni = {
  id: string;
  key: string;
  label: string;
  active: boolean;
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
    DVĚ PRÁVA NA JEDNÉ OBRAZOVCE, a je to schválně.

    Od 9. 9. je tohle jediná obrazovka zařazení — Nastavení → Pozice
    zaniklo a slilo se sem (zadání 6.1). Dva seznamy pro jednu věc byly
    přesně to, na co si Šéfík stěžoval.

    Jenže ty dvě obrazovky měly různá práva a slepit je na to přísnější
    by vedoucímu tiše sebralo správu seznamu, kterou dneska má:

      SEZNAM zařazení (založit, přejmenovat, vyřadit)  → people.manage
      PRÁVA zařazení (zaškrtávátka)                    → settings.manage

    To druhé je zpřísnění z migrace 20260901090000 („kdo zakládá lidi,
    nesmí rozhodovat, kdo vidí mzdy") a nesmí se rozvolnit tím, že se
    obrazovky spojily. Dovnitř se proto pouští `people.manage`
    a zaškrtávátka se zamykají zvlášť.

    Schovaná položka v nabídce není zámek — zámek je tenhle řádek
    a politiky v databázi.
  */
  const pristup = await zkusPristup(tenantId, "people.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Zařazení spravuje jen ten, kdo má právo <code>people.manage</code>.
        Řekněte si o ně správci firmy.
      </Sdeleni>
    );
  }

  const { ctx } = pristup;
  // Práva zařazení mění jen settings.manage. Seznam smí i people.manage.
  const smiMenitPrava = await hasAccess(tenantId, "settings.manage", rozsah);
  const supabase = await getServerSupabase();

  const zarazeni = await seznam<Zarazeni>(
    "zařazení firmy",
    supabase
      .from("positions")
      .select("id, key, label, active")
      .eq("tenant_id", tenantId)
      .order("active", { ascending: false })
      .order("label"),
  );

  const vsechnaPrava = await seznam<Pravo>(
    "katalog práv",
    supabase
      .from("permissions")
      .select("key, module_key, label, sensitive, sort_order")
      .order("sort_order"),
  );

  /*
    Nabízejí se jen práva ze zapnutých modulů. Právo z modulu, který
    firma nemá, by nic neotevřelo — app.has_access ho stejně odmítne —
    a v seznamu by jen mátlo. Až se modul zapne, objeví se sama.
  */
  const zapnute = new Set<string>(
    ctx.modules.filter((m) => m.active).map((m) => String(m.key)),
  );
  const prava = vsechnaPrava.filter((p) => zapnute.has(p.module_key));
  const vKatalogu = new Set(prava.map((p) => p.key));

  const vazby = await seznam<{ position_id: string; permission_key: string }>(
    "oprávnění zařazení",
    supabase
      .from("position_permissions")
      .select("position_id, permission_key")
      .eq("tenant_id", tenantId),
  );

  const maPravo = new Map<string, Set<string>>();
  for (const v of vazby) {
    const id = v.position_id as string;
    if (!maPravo.has(id)) maPravo.set(id, new Set());
    maPravo.get(id)!.add(v.permission_key as string);
  }

  /*
    Kolik lidí to zařazení má. Zadání 6.1 to chce vidět na obrazovce:
    když se mění práva zařazení, má být poznat, KOLIKA LIDÍ se to týká —
    změna platí hned všem a nikde se nic nepotvrzuje.

    Počítá se ze živých zaměstnanců, i těch bez účtu: brigádníkovi se
    oprávnění uloží a začne platit, jakmile se přihlásí (zadání, oddíl 3).
  */
  const lideNaZarazeni = await seznam<{ position_id: string | null }>(
    "lidé podle zařazení",
    supabase
      .from("employees")
      .select("position_id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null),
  );

  const pocetLidi = new Map<string, number>();
  for (const z of lideNaZarazeni) {
    if (!z.position_id) continue;
    pocetLidi.set(z.position_id, (pocetLidi.get(z.position_id) ?? 0) + 1);
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
        popis="Kdo je čím a co smí. Změna práv platí hned všem, kdo to zařazení mají."
      >
        Zařazení
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
        {ulozeno ? (
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "var(--good)" }}>
            {ulozeno} uloženo — {zmena(pridano, odebrano)}
          </p>
        ) : null}

        <p style={{ ...popisRole, maxWidth: "68ch" }}>
          Majitel firmy tu není. Majitelství je vlastnost člověka, ne
          zařazení — nastavuje se u něj v Lidech a dává mu všechno ze
          zapnutých modulů. Kdyby se mu práva odebírala tady, šel by
          zamknout ven z vlastní firmy.
        </p>

        {/*
          ZALOŽIT ZAŘAZENÍ. Přišlo sem z Nastavení → Pozice, které
          zaniklo (zadání 6.1). Akce zůstala tam, kde byla — kopírovat
          ji sem by znamenalo dvě místa, kde se zakládá zařazení, a to
          je přesně ta chyba, kvůli které se obrazovky slévají.
        */}
        <form action={zalozitPozici} style={zalozeni}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <label style={{ display: "grid", gap: "4px", flex: "1 1 220px" }}>
            <span style={popisRole}>Nové zařazení</span>
            <input
              type="text"
              name="nazev"
              required
              maxLength={60}
              placeholder="např. Barman"
              style={poleText}
            />
          </label>
          <button type="submit" className="ft-tl ft-tl-vedlejsi">
            Založit
          </button>
        </form>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "16px" }}>
          {zarazeni.map((r) => {
            const moje = maPravo.get(r.id) ?? new Set<string>();
            const lidi = pocetLidi.get(r.id) ?? 0;

            /*
              Třetí obranná linie z docs/pravidlo-neprideluj-vic.md, ta
              nejslabší: obrazovka má říct, co přidělit nemůžu, ještě
              než to zkusím. Rozhodnutí padá v databázi — tady jde jen
              o to, aby se člověk nedozvěděl „nemáte právo“ až po
              odeslání formuláře, který se mu nabídl.

              Počítá se jen z práv živých modulů. Šablona Účetní nosí
              i finance.read; bez modulu Finance to nikomu nic
              neotevírá, a kdyby se to počítalo, hlásila by obrazovka
              „nemůžete přidělit“ i vlastníkovi firmy.
            */
            const smim = smimPridelit(ctx, {
              // Majitel není zařazení, takže tudy nikdy neprochází.
              isOwner: false,
              prava: [...moje].filter((k) => vKatalogu.has(k)),
            });

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
                  {r.active ? null : (
                    <span style={stitek}>vyřazené</span>
                  )}
                </h2>
                <p style={{ ...popisRole, margin: "4px 0 10px" }}>
                  {lidi === 0
                    ? "Zatím ho nemá nikdo — změna se teď nedotkne nikoho."
                    : lidi === 1
                      ? "Má ho jeden člověk. Změna u něj platí hned."
                      : `Má ho ${lidi} lidí. Změna u nich platí hned.`}
                </p>

                {/*
                  Přejmenovat a vyřadit — taky ze zaniklého Nastavení →
                  Pozice. Vyřazené zařazení se přestane nabízet u nových
                  lidí, ale těm, kdo ho mají, zůstane: kdyby zmizelo,
                  přišli by o práva a nikdo by nevěděl proč.
                */}
                <div style={spravaRadku}>
                  <form action={prejmenovatPozici} style={spravaFormular}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="pozice" value={r.id} />
                    <input
                      type="text"
                      name="nazev"
                      defaultValue={r.label}
                      required
                      maxLength={60}
                      aria-label={`Název zařazení ${r.label}`}
                      style={{ ...poleText, maxWidth: "220px" }}
                    />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Přejmenovat
                    </button>
                  </form>

                  <form action={prepnoutPozici} style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="pozice" value={r.id} />
                    <input type="hidden" name="zapnout" value={r.active ? "ne" : "ano"} />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      {r.active ? "Vyřadit" : "Vrátit"}
                    </button>
                  </form>
                </div>

                {smim ? null : (
                  <p style={{ ...popisRole, marginBottom: "4px" }}>
                    <strong style={{ color: "var(--pozor)" }}>
                      Tohle zařazení nemůžete nikomu přidělit.
                    </strong>{" "}
                    Obsahuje práva, která sami nemáte — a nikdo
                    nepřiděluje víc, než má sám.
                  </p>
                )}

                {!smiMenitPrava ? (
                  <p style={{ ...popisRole, marginBottom: "8px" }}>
                    Práva zařazení mění jen ten, kdo spravuje nastavení
                    firmy. Tady je vidíte, jak jsou.
                  </p>
                ) : null}

                {(
                  /*
                    Práva mění jen `settings.manage`. Vedoucí
                    s `people.manage` se sem dostane kvůli správě
                    seznamu, ale zaškrtávátka má zamčená — zpřísnění
                    z migrace 20260901090000 se sloučením obrazovek
                    nesmí rozvolnit. Rozhoduje stejně politika
                    v databázi; `fieldset` je jen první linie.
                  */
                  <form key={`zarazeni-${r.id}`} action={ulozitOpravneni}>
                    <fieldset
                      disabled={!smiMenitPrava}
                      style={{ border: "none", margin: 0, padding: 0 }}
                    >
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="zarazeni" value={r.id} />

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
                    </fieldset>
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

/**
 * Vyřazené zařazení (`positions.active = false`).
 *
 * Nenabízí se u nových lidí, ale u těch, kdo ho mají, PLATÍ DÁL —
 * v ostrých datech je takový Barman a visí na něm člověk s právy.
 * Proto se tu ukazuje i s možností úpravy, jen označené.
 */
const stitek = {
  marginLeft: "8px",
  padding: "1px 7px",
  borderRadius: "999px",
  background: "var(--pozor-bg)",
  color: "var(--pozor)",
  fontSize: "11.5px",
  whiteSpace: "nowrap" as const,
  verticalAlign: "middle" as const,
} as const;

const radekPrava = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "14px",
  color: "var(--ink)",
  minHeight: "32px",
} as const;

/* --- styly převzaté ze zaniklého Nastavení → Pozice ------------------ */

const zalozeni = {
  display: "flex",
  flexWrap: "wrap" as const,
  alignItems: "flex-end",
  gap: "8px",
  margin: "0 0 20px",
  padding: "14px",
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "14px",
};

const poleText = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "16px",
  borderRadius: "10px",
  border: "1px solid var(--line)",
  background: "var(--paper)",
  color: "var(--ink)",
};

const spravaRadku = {
  display: "flex",
  flexWrap: "wrap" as const,
  alignItems: "center",
  gap: "8px",
  margin: "0 0 12px",
  paddingBottom: "12px",
  borderBottom: "1px solid var(--line)",
};

const spravaFormular = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};
