import Link from "next/link";
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { prvniDenMesice, sazbaZaHodinu } from "@/lib/mzdy";
import { DotazSelhal, funkceNeexistuje, seznam } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import { kratkyUvazek, UVAZKY } from "@/lib/uvazky";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { nastavitSazbu, upravitZamestnance, smazatZamestnance } from "./akce";
import PolePozice from "./pole-pozice";
import SmazatZamestnance from "./smazani";
import VystavitPozvankuFormular from "./vystaveni";

export const dynamic = "force-dynamic";

type Zamestnanec = {
  id: string;
  full_name: string;
  position_id: string | null;
  branch_id: string | null;
  user_id: string | null;
  employment_type: string;
  started_on: string | null;
  active: boolean;
  deleted_at: string | null;
};

/**
 * Nastavení → Lidé a pozvánky
 *
 * Seznam zaměstnanců s možností přidat, upravit a smazat (soft-delete).
 * Brigádník bez účtu je normální stav, ne chyba.
 */
export default async function NastaveniLide({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{
    chyba?: string;
    ulozeno?: string;
    upravuji?: string;
    pozice?: string;
    nazev?: string;
  }>;
}) {
  const { rozsah } = await params;
  const {
    chyba,
    ulozeno,
    upravuji,
    pozice: poziceStav,
    nazev: nazevPozice,
  } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "people.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Správa lidí je otevřená jen oprávněním s právem <code>people.manage</code>.
      </Sdeleni>
    );
  }

  const { ctx } = pristup;
  const supabase = await getServerSupabase();

  // Zaměstnanci
  const zamestnanci = await seznam<Zamestnanec>(
    "zaměstnanci firmy",
    supabase
      .from("employees")
      .select(
        "id, full_name, position_id, branch_id, user_id, employment_type, started_on, active, deleted_at",
      )
      .eq("tenant_id", tenantId)
      .order("full_name"),
  );

  /*
    Pozice. Sloupec se jmenuje `label`, ne `name` — dotaz se tu dřív ptal
    na `name`, tiše selhal a rozbalovátko proto nabízelo jen „Neurčeno“,
    i kdyby v tabulce nějaká pozice byla.

    Do nabídky jdou jen aktivní; vyřazená se přestane nabízet u nových,
    ale u lidí, kteří ji mají, zůstane vidět (proto se níž hledá ve všech).
  */
  const vsechnyPozice = await seznam<{
    id: string;
    label: string;
    active: boolean;
  }>(
    "pozice firmy",
    supabase
      .from("positions")
      .select("id, label, active")
      .eq("tenant_id", tenantId)
      .order("label"),
  );
  const nabizenePozice = vsechnyPozice
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, label: p.label }));

  const upravujeId = upravuji ? String(upravuji) : null;
  const upravuje =
    upravujeId && zamestnanci
      ? (zamestnanci.find((z) => z.id === upravujeId) as Zamestnanec)
      : null;

  /*
    Sazby. Zadání §4 na to upozorňuje zvlášť: people.manage NESTAČÍ.
    Kdo spravuje lidi, nemusí vidět na mzdy — v malém provozu to bývá
    dokonce jeden člověk a jeho účetní. Sloupec se proto neváže na
    právo, kterým se sem člověk dostal.

    Chyba se nevyhazuje ze stejného důvodu jako u dlaždice na Docházce:
    dokud není nasazená migrace se sazbami, sloupec se prostě nekreslí
    a správa lidí funguje dál.
  */
  /*
    Dvě obranné linie (pravidlo 3). Tahle je ta v aplikaci: bez
    payroll.read se na sazby ani neptáme. Druhá je v databázi —
    employee_earnings bez toho práva nevrátí ani řádek, takže i kdyby se
    tenhle řádek jednou pokazil, ven se nic nedostane.

    Ptáme se bez pobočky: rozsah dořeší can_read_scoped uvnitř funkce
    u každého člověka zvlášť (pravidlo 4). Kdo má právo jen na jednu
    pobočku, dostane jen její lidi.
  */
  const smiCistSazby = await hasAccess(tenantId, "payroll.read", null);

  const sazby = new Map<string, number | null>();
  let sazbyDostupne = false;

  if (smiCistSazby) {
    const { data: vydelky, error: sazbyChyba } = await supabase.rpc(
      "employee_earnings",
      {
        p_tenant: tenantId,
        p_mesic: prvniDenMesice(new Date()),
        p_branch: null,
      },
    );

    // Nenasazená migrace sloupec jen schová. Cokoli jiného je porucha
    // a musí být slyšet — tiše skrytá sazba vypadá stejně jako sazba,
    // kterou nikdo nezadal.
    if (sazbyChyba && !funkceNeexistuje(sazbyChyba)) {
      throw new DotazSelhal("výdělky zaměstnanců", sazbyChyba);
    }
    sazbyDostupne = !sazbyChyba;

    for (const v of (vydelky ?? []) as {
      employee_id: string;
      hodinova_haleru: number | null;
    }[]) {
      sazby.set(v.employee_id, v.hodinova_haleru);
    }
  }

  const smiVidetSazby = smiCistSazby && sazbyDostupne;

  // Zadávat sazby je jiné právo než je vidět. payroll.manage v katalogu
  // i v PERMISSIONS je, takže kontrola v aplikaci tady být může —
  // rozhodnutí ale stejně padá v public.set_rate.
  const smiZadavatSazby = await hasAccess(tenantId, "payroll.manage", null);

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Přidávejte zaměstnance, brigádníky a hosty. Bez účtu se tu objeví, až si někdo vystaví pozvánku."
      >
        Lidé
      </Nadpis>

      {/*
        key je tu podstatné, ne kosmetika.

        Políčka jsou neřízená (defaultValue), a ta se v Reactu uplatní
        JEN při připojení prvku. Když se z jednoho zaměstnance přejde na
        druhého, je to pořád tentýž <form> na tomtéž místě stromu —
        React DOM ponechá a novou výchozí hodnotu zahodí. Formulář pak
        ukazuje údaje předchozího člověka, zatímco tabulka vedle je
        správně, protože ta je jen text.

        Nebezpečné to je proto, že se ta cizí hodnota uloží: kdo otevře
        Upravit a dá Uložit, zapíše tomu člověku typ poměru někoho
        jiného. Přesně tak se u jedné zaměstnankyně přepsalo HPP na Jiné.

        Změna key přinutí React formulář zahodit a postavit znovu, takže
        se výchozí hodnoty vezmou z nového záznamu.
      */}
      <form
        key={upravuje?.id ?? "novy"}
        action={upravitZamestnance}
        style={{ ...formular, marginBottom: "24px" }}
      >
        <input type="hidden" name="rozsah" value={rozsah} />
        {upravuje && <input type="hidden" name="id" value={upravuje.id} />}

        <div style={{ display: "grid", gap: "16px", maxWidth: "620px" }}>
          <label style={formularLabel}>
            <span>Jméno *</span>
            <input
              name="jmeno"
              defaultValue={upravuje?.full_name ?? ""}
              required
              maxLength={200}
              style={inputPole}
            />
          </label>

          <PolePozice
            pozice={nabizenePozice}
            vybrana={upravuje?.position_id ?? ""}
            stylLabel={formularLabel}
            stylSelect={selectPole}
            stylInput={inputPole}
          />

          <label style={formularLabel}>
            <span>Pobočka</span>
            <select name="pobocka" defaultValue={upravuje?.branch_id ?? ""} style={selectPole}>
              <option value="">— Firemní —</option>
              {ctx.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label style={formularLabel}>
            <span>Typ pracovního poměru</span>
            <select name="typ" defaultValue={upravuje?.employment_type ?? "hpp"} style={selectPole}>
              {UVAZKY.map((u) => (
                <option key={u.kod} value={u.kod}>
                  {u.nazev}
                </option>
              ))}
            </select>
          </label>

          {/*
            Nástup je nepovinný. U brigádníka, kterého někdo zapsal
            zpětně, se datum často neví — prázdné pole je poctivější
            než dnešek dosazený za něj.
          */}
          <label style={formularLabel}>
            <span>Nástup</span>
            <input
              name="nastup"
              type="date"
              defaultValue={upravuje?.started_on ?? ""}
              style={inputPole}
            />
          </label>

          {chyba && <p className="hlaska-chyba">{popisChyby(chyba)}</p>}
          {ulozeno && <p style={{ ...chybaHlaska, color: "var(--good)" }}>Uloženo.</p>}

          {/*
            Když někdo napíše „číšník“ a v databázi je „Číšník“, druhá
            pozice nevznikne. Mlčet by bylo horší než to říct: člověk by
            čekal svůj zápis a našel cizí velké písmeno.
          */}
          {poziceStav === "existujici" && nazevPozice ? (
            <p style={{ ...chybaHlaska, color: "var(--muted)" }}>
              Pozice {nazevPozice} už existuje, použil jsem ji.
            </p>
          ) : null}

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="submit" className="ft-tl ft-tl-hlavni">
              {upravuje ? "Uložit" : "Přidat"}
            </button>
            {upravuje && (
              <Link
                href={`/${rozsah}/nastaveni/lide`}
                className="ft-tl ft-tl-vedlejsi"
              >
                Storno
              </Link>
            )}
          </div>
        </div>
      </form>

      {/*
        Sazba má vlastní formulář, ne políčko v tom nahoře. Zakládá
        totiž nový řádek historie, ne úpravu zaměstnance — a „od kdy
        platí“ je otázka, kterou u jména ani pobočky nikdo neřeší.
      */}
      {upravuje && smiZadavatSazby ? (
        <form
          key={`sazba-${upravuje.id}`}
          action={nastavitSazbu}
          style={{ ...formular, marginBottom: "24px" }}
        >
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="zamestnanec" value={upravuje.id} />

          <p style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--ink)" }}>
            Hodinová sazba — {upravuje.full_name}
          </p>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: "13px",
              color: "var(--muted)",
              maxWidth: "62ch",
            }}
          >
            Zadáním vznikne nový záznam. Starý zůstane, takže se
            už uzavřené měsíce nepřepočítají. Sazba platí od zadaného dne
            dál.
          </p>

          <div
            style={{
              display: "grid",
              gap: "16px",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              maxWidth: "620px",
            }}
          >
            <label style={formularLabel}>
              <span>Sazba v Kč za hodinu *</span>
              <input
                name="koruny"
                inputMode="decimal"
                required
                placeholder="220"
                style={inputPole}
              />
            </label>

            <label style={formularLabel}>
              <span>Platí od *</span>
              <input name="od" type="date" required style={inputPole} />
            </label>

            <label style={formularLabel}>
              <span>Poznámka</span>
              <input
                name="poznamka"
                maxLength={200}
                placeholder="přidáno po zkušební době"
                style={inputPole}
              />
            </label>
          </div>

          <button
            type="submit"
            className="ft-tl ft-tl-hlavni"
            style={{ marginTop: "16px" }}
          >
            Uložit sazbu
          </button>
        </form>
      ) : null}

      {/* Seznam */}
      <div style={{ overflowX: "auto", marginTop: "32px" }}>
        <table style={tabulka}>
          <thead>
            <tr style={headRow}>
              <th style={th}>Jméno</th>
              <th style={th}>Pozice</th>
              <th style={th}>Pobočka</th>
              <th style={th}>Typ</th>
              <th style={th}>Účet</th>
              {smiVidetSazby ? <th style={th}>Sazba</th> : null}
              <th style={th}>Akce</th>
            </tr>
          </thead>
          <tbody>
            {(zamestnanci ?? []).map((z) => (
              <tr key={z.id} style={{ ...tr, opacity: z.deleted_at ? 0.5 : 1 }}>
                <td style={td}>{z.full_name}</td>
                <td style={td}>
                  {z.position_id
                    ? vsechnyPozice.find((p) => p.id === z.position_id)?.label || "—"
                    : "—"}
                </td>
                <td style={td}>
                  {z.branch_id
                    ? ctx.branches.find((b) => b.id === z.branch_id)?.name || "—"
                    : "Firemní"}
                </td>
                <td style={td}>
                  {kratkyUvazek(z.employment_type)}
                </td>
                <td style={td}>{z.user_id ? "Ano" : "Ne"}</td>

                {/*
                  Chybějící sazba se píše slovem, ne jako 0 Kč. Nula
                  vypadá jako výsledek, ne jako údaj, který nikdo nezadal
                  — a u brigádníka, kterého ještě nikdo nenacenil, je to
                  normální stav, ne chyba.
                */}
                {smiVidetSazby ? (
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {sazby.get(z.id) != null ? (
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {sazbaZaHodinu(sazby.get(z.id) as number)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>nezadaná</span>
                    )}
                  </td>
                ) : null}

                <td style={td}>
                  <Link
                    href={`/${rozsah}/nastaveni/lide?upravuji=${z.id}`}
                    className="ft-tl ft-tl-vedlejsi ft-tl-male"
                    style={{ marginRight: "8px" }}
                  >
                    Upravit
                  </Link>
                  {!z.deleted_at && (
                    <SmazatZamestnance
                      akce={smazatZamestnance}
                      id={z.id}
                      rozsah={rozsah}
                      jmeno={z.full_name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vystavení pozvánky */}
      <VystavitPozvankuFormular
        rozsah={rozsah}
        zamestnanci={(zamestnanci ?? []).filter((z) => !z.deleted_at).map((z) => ({
          id: z.id,
          full_name: z.full_name,
        }))}
      />
    </>
  );
}

/* --- Styly --- */

const formular = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "16px 18px",
  boxShadow: "var(--shadow)",
} as const;

const formularLabel = {
  display: "grid" as const,
  gap: "6px",
  fontSize: "13px",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".06em",
} as const;

const inputPole = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "16px",
  borderRadius: "10px",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const selectPole = {
  ...inputPole,
  cursor: "pointer",
} as const;

const chybaHlaska = {
  margin: "14px 0 0",
  fontSize: "13px",
} as const;

const tabulka = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "14px",
} as const;

const headRow = {
  background: "var(--sunken)",
  borderBottom: "1px solid var(--line)",
} as const;

const th = {
  padding: "10px 12px",
  textAlign: "left" as const,
  fontSize: "11px",
  fontWeight: "600",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".06em",
} as const;

const tr = {
  borderBottom: "1px solid var(--line)",
} as const;

const td = {
  padding: "12px",
} as const;

/** Hlášky z ?chyba=. Uživatel nemá číst strojové kódy. */
function popisChyby(kod: string): string {
  switch (kod) {
    case "jmeno":
      return "Jméno nesmí zůstat prázdné.";
    case "pozice-prazdny":
      return "Název nové pozice nesmí zůstat prázdný.";
    case "pozice-dlouhy":
      return "Název pozice je moc dlouhý, zkraťte ho.";
    case "pozice-pravo":
      return "Na zakládání pozic nemáte právo.";
    case "sazba-neuplna":
      return "Sazba i den, od kterého platí, musí být vyplněné.";
    case "sazba-cislo":
      return "Sazba musí být číslo a nesmí být záporná.";
    case "sazba-pravo":
      return "Na zadávání sazeb nemáte právo.";
    default:
      return "Uložení se nepovedlo. Zkuste to prosím znovu.";
  }
}
