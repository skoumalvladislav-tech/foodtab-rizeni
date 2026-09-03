import Link from "next/link";
import { redirect } from "next/navigation";

import { getUser, hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { prvniDenMesice, sazbaZaHodinu } from "@/lib/mzdy";
import { smimPridelit } from "@/lib/prideleni";
import { DotazSelhal, funkceNeexistuje, seznam } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import { kratkyUvazek, UVAZKY } from "@/lib/uvazky";
import { BARVY_LIDI, NAZVY_BAREV_LIDI } from "@/lib/barvy-lidi";
import ZnackaOsoby from "@/app/znacka-osoby";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { nastavitSazbu, upravitZamestnance, smazatZamestnance } from "./akce";
import PolePozice from "./pole-pozice";
import PanelOpravneni from "./panel-opravneni";
import PanelPinu from "./pin";
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
  /** Klic z palety, nebo null. Prazdno je platny stav: bez barvy. */
  color: string | null;
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
    text?: string;
    ulozeno?: string;
    upravuji?: string;
    opravneni?: string;
    kdo?: string;
    mail?: string;
    pozice?: string;
    nazev?: string;
    /** Komu se přiděluje PIN. Samotný PIN adresou NIKDY nechodí. */
    pin?: string;
  }>;
}) {
  const { rozsah } = await params;
  const {
    chyba,
    text: textChyby,
    ulozeno,
    upravuji,
    opravneni: opravneniProId,
    kdo: kdoUlozen,
    mail: chybaMailu,
    pozice: poziceStav,
    nazev: nazevPozice,
    pin: pinProId,
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

  // Kdo je přihlášený. Vlastní členství měnit nejde ani vlastníkem —
  // panel to má říct dřív, než na to člověk klikne.
  const uzivatel = await getUser();

  // Zaměstnanci
  const zamestnanci = await seznam<Zamestnanec>(
    "zaměstnanci firmy",
    supabase
      .from("employees")
      .select(
        "id, full_name, position_id, branch_id, user_id, employment_type, started_on, active, deleted_at, color",
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

  /*
    Oprávnění do nabídky pozvánky.

    Nabídne se jen to, co ten, kdo zve, sám smí přidělit
    (docs/pravidlo-neprideluj-vic.md). Je to POHODLÍ, ne ochrana —
    rozhodnutí padá uvnitř app.create_invitation, takže i kdyby se sem
    role propašovala, databáze ji odmítne.

    Počítá se jen z práv ŽIVÝCH modulů — stejně jako na obrazovce
    Oprávnění a stejně jako `app.ziva_prava_role` v databázi. Šablona
    Účetní nosí i finance.read; bez modulu Finance to nikomu nic
    neotevírá, a kdyby se to počítalo, nešla by ta role nabídnout ani
    vlastníkovi firmy.
  */
  const roleFirmy = await seznam<{
    id: string;
    label: string;
    is_owner: boolean;
  }>(
    "role firmy",
    supabase
      .from("roles")
      .select("id, label, is_owner")
      .eq("tenant_id", tenantId)
      .order("label"),
  );

  const katalogPrav = await seznam<{ key: string; module_key: string }>(
    "katalog práv",
    supabase.from("permissions").select("key, module_key"),
  );

  const zapnuteModuly = new Set<string>(
    ctx.modules.filter((m) => m.active).map((m) => String(m.key)),
  );
  const ziva = new Set(
    katalogPrav.filter((p) => zapnuteModuly.has(p.module_key)).map((p) => p.key),
  );

  const vazby = await seznam<{ role_id: string; permission_key: string }>(
    "obsah sad oprávnění",
    supabase
      .from("role_permissions")
      .select("role_id, permission_key")
      .in("role_id", roleFirmy.map((r) => r.id)),
  );

  const pravaRole = new Map<string, string[]>();
  for (const v of vazby) {
    if (!ziva.has(v.permission_key)) continue;
    if (!pravaRole.has(v.role_id)) pravaRole.set(v.role_id, []);
    pravaRole.get(v.role_id)!.push(v.permission_key);
  }

  const nabizenaOpravneni = roleFirmy
    .filter((r) =>
      smimPridelit(ctx, {
        isOwner: r.is_owner,
        prava: pravaRole.get(r.id) ?? [],
      }),
    )
    .map((r) => ({ id: r.id, label: r.label }));

  /*
    Kdo má jaké oprávnění. Sloupec v seznamu je kvůli tomu, že pozvánka
    smí přijít bez role (docs/pozvanky-zadani.md): u takového člověka
    musí stát „čeká na přidělení“, ne prázdno. Prázdné políčko vypadá
    jako chyba a nikdo podle něj nepozná, že se na něj ještě čeká.
  */
  const clenstvi = await seznam<{
    id: string;
    user_id: string;
    role_id: string | null;
    scope: string;
  }>(
    "členství ve firmě",
    supabase
      .from("memberships")
      .select("id, user_id, role_id, scope")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
  );
  const roleUctu = new Map(clenstvi.map((m) => [m.user_id, m.role_id]));
  const nazevRole = new Map(roleFirmy.map((r) => [r.id, r.label]));

  /*
    Poslední majitel se nesmí dát odebrat (docs/vlastniku-muze-byt-vic.md).

    Rozhodnutí padá ve spoušti v databázi; tohle je jen druhá obranná
    linie — tlačítko se nenabídne a je u toho vysvětlení. Bez ní by
    člověk klikl a dostal chybu, kterou nečekal.

    Nenasazená migrace se promíjí: než projde, funkce v databázi není
    a chová se to jako dosud. Zamknout Smazat u všech kvůli nedeplojnuté
    funkci by bylo horší.
  */
  const rolMajitele = roleFirmy.find((r) => r.is_owner)?.id ?? null;
  const jeMajitel = (userId: string | null) =>
    userId != null && rolMajitele != null && roleUctu.get(userId) === rolMajitele;

  const { data: pocetMajitelu } = await supabase.rpc("pocet_majitelu", {
    p_tenant: tenantId,
  });
  const posledniMajitel = (userId: string | null) =>
    typeof pocetMajitelu === "number" && pocetMajitelu === 1 && jeMajitel(userId);

  /*
    Podklad pro panel přidělení. Načítá se jen pro toho jednoho člověka,
    kterého má vedoucí zrovna otevřeného — rozsahy všech by byl dotaz
    navíc kvůli sloupci, který v tabulce stejně není.
  */
  const prideluje = opravneniProId
    ? (zamestnanci ?? []).find((z) => z.id === opravneniProId) ?? null
    : null;

  const clenstviProPanel = prideluje?.user_id
    ? clenstvi.find((m) => m.user_id === prideluje.user_id) ?? null
    : null;

  const pobockyClena = clenstviProPanel
    ? await seznam<{ branch_id: string }>(
        "pobočky členství",
        supabase
          .from("membership_branches")
          .select("branch_id")
          .eq("membership_id", clenstviProPanel.id),
      )
    : [];

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

  /*
    PIN přiděluje ten, kdo spravuje docházku (pravidlo 2 — podle
    práva, ne podle názvu role). Průzor si to ověří znovu na
    pobočce toho člověka; tady se jen rozhoduje o kreslení.
  */
  const smiPin = await hasAccess(tenantId, "attendance.manage", null);

  /*
    Stav PINu a návrh nového. Návrh chodí z databáze, protože jen ona
    ví, který je na té pobočce volný — vygenerovat ho v prohlížeči by
    znamenalo hádat a nechat se odmítnout až při uložení.
  */
  async function panelPinu(id: string) {
    const clovek = (zamestnanci ?? []).find((z) => z.id === id);
    if (!clovek) return null;

    const { data: pinRadek } = await supabase
      .from("employee_pins")
      .select("employee_id, nastaven_kdy")
      .eq("employee_id", id)
      .maybeSingle();

    const { data: navrh } = await supabase.rpc("navrh_pinu", {
      p_tenant: tenantId,
      p_employee: id,
    });

    return (
      <PanelPinu
        rozsah={rozsah}
        zamestnanec={clovek.id}
        jmeno={clovek.full_name}
        maUcet={Boolean(clovek.user_id)}
        maPin={Boolean(pinRadek)}
        nastavenKdy={(pinRadek?.nastaven_kdy as string | null) ?? null}
        navrh={(navrh as string | null) ?? null}
      />
    );
  }

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
            Barva v rozpisu.

            Nepovinná pomůcka: v kalendáři je u jména čtvereček, ať se
            týden dá přejet očima. Jméno je tam napsané tak jako tak,
            takže barva nic nenese sama.

            Volba „bez barvy“ je první a je to platný stav, ne prázdné
            pole. U NOVÉHO člověka znamená „přiděl volnou“ — to udělá
            databáze; u stávajícího „žádnou“.

            Rádia, ne rozbalovátko: devět odstínů má být vidět naráz
            i s názvem. Stejně to má výběr barvy pobočky.
          */}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ ...formularLabel, padding: 0 }}>Barva v rozpisu</legend>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              <label style={volbaBarvy}>
                <input
                  type="radio"
                  name="barva"
                  value=""
                  defaultChecked={!upravuje?.color}
                  style={{ accentColor: "var(--ink)" }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "3px",
                    border: "1px solid var(--line-2)",
                    flex: "none",
                  }}
                />
                <span>{upravuje ? "Bez barvy" : "Přidělit volnou"}</span>
              </label>

              {BARVY_LIDI.map((klic) => (
                <label key={klic} data-osoba={klic} style={volbaBarvy}>
                  <input
                    type="radio"
                    name="barva"
                    value={klic}
                    defaultChecked={klic === upravuje?.color}
                    style={{ accentColor: "var(--osoba)" }}
                  />
                  {/*
                    Čtvereček, ne kolečko — kolečko má výběr barvy
                    pobočky a ty dvě věci se nesmějí plést.
                  */}
                  <span
                    aria-hidden="true"
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "3px",
                      background: "var(--osoba)",
                      flex: "none",
                    }}
                  />
                  {/* Barva nikdy nestojí sama — vedle čtverečku je název. */}
                  <span>{NAZVY_BAREV_LIDI[klic]}</span>
                </label>
              ))}
            </div>
          </fieldset>

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

          {chyba && (
            <p className="hlaska-chyba">
              {popisChyby(chyba)}
              {textChyby ? ` (${textChyby})` : ""}
            </p>
          )}
          {ulozeno === "opravneni" ? (
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: "var(--dobre)" }}>
              Oprávnění uloženo{kdoUlozen ? ` — ${kdoUlozen}` : ""}.{" "}
              {chybaMailu
                ? `Upozornění v aplikaci má, ale e-mail neodešel: ${chybaMailu}.`
                : "Dostal upozornění v aplikaci i e-mailem."}
            </p>
          ) : null}
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

      {/* PIN u konkrétního člověka */}
      {pinProId && smiPin ? await panelPinu(pinProId) : null}

      {prideluje ? (
        <div style={{ padding: "0 16px" }}>
          {!prideluje.user_id ? (
            <p className="hlaska-chyba">
              {prideluje.full_name} nemá účet. Oprávnění se přiděluje
              přihlášenému člověku — nejdřív mu pošlete pozvánku.
            </p>
          ) : !clenstviProPanel ? (
            <p className="hlaska-chyba">
              {prideluje.full_name} má účet, ale ve firmě zatím žádné
              členství. Pozvánku nejspíš ještě nepřijal.
            </p>
          ) : (
            <PanelOpravneni
              rozsah={rozsah}
              jmeno={prideluje.full_name}
              zamestnanec={prideluje.id}
              opravneni={nabizenaOpravneni}
              pobocky={ctx.branches.map((b) => ({ id: b.id, nazev: b.name }))}
              smiFiremni={ctx.membership.scope === "tenant"}
              nynejsiRole={clenstviProPanel.role_id}
              nynejsiUroven={clenstviProPanel.scope === "tenant" ? "tenant" : "branch"}
              nynejsiPobocky={pobockyClena.map((r) => String(r.branch_id))}
              jaSam={clenstviProPanel.user_id === uzivatel?.id}
              posledniMajitel={posledniMajitel(clenstviProPanel.user_id)}
            />
          )}
        </div>
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
              <th style={th}>Oprávnění</th>
              {smiVidetSazby ? <th style={th}>Sazba</th> : null}
              <th style={th}>Akce</th>
            </tr>
          </thead>
          <tbody>
            {(zamestnanci ?? []).map((z) => (
              <tr key={z.id} style={{ ...tr, opacity: z.deleted_at ? 0.5 : 1 }}>
                {/*
                  Čtvereček u jména je táž značka jako v rozpisu — kdo
                  barvu zrovna nastavil, musí ji poznat i tady, ne až
                  o dvě obrazovky dál.
                */}
                <td style={td}>
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                  >
                    <ZnackaOsoby barva={z.color} />
                    {z.full_name}
                  </span>
                </td>
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
                  Tři různé stavy, ne dva. Bez účtu se na oprávnění
                  nečeká — brigádník bez přihlášení je běžný a v pořádku.
                  Čeká se u toho, kdo účet MÁ a roli ne.
                */}
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {!z.user_id ? (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  ) : posledniMajitel(z.user_id) ? (
                    <span title="Ve firmě musí zůstat aspoň jeden majitel.">
                      {nazevRole.get(roleUctu.get(z.user_id) as string) ?? "—"}{" "}
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                        (jediný)
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={`/${rozsah}/nastaveni/lide?opravneni=${z.id}`}
                      style={roleUctu.get(z.user_id) ? undefined : cekaNaPrideleni}
                      title="Přidělit oprávnění a rozsah"
                    >
                      {roleUctu.get(z.user_id)
                        ? nazevRole.get(roleUctu.get(z.user_id) as string) ?? "—"
                        : "čeká na přidělení"}
                    </Link>
                  )}
                </td>

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
                  {/*
                    PIN. Kreslí se jen tomu, kdo spravuje docházku —
                    a jen u nesmazaného člověka. U brigádníka bez účtu
                    je to jediná cesta, jak mu píchání zpřístupnit.
                  */}
                  {smiPin && !z.deleted_at ? (
                    <Link
                      href={`/${rozsah}/nastaveni/lide?pin=${z.id}`}
                      className="ft-tl ft-tl-vedlejsi ft-tl-male"
                      style={{ marginRight: "8px" }}
                    >
                      PIN
                    </Link>
                  ) : null}
                  {/*
                    Poslední majitel se smazat nedá — spoušť v databázi
                    to odmítne. Tlačítko se proto nenabízí a je u toho
                    vysvětlení; klikat na něco, co skončí chybou, nemá
                    smysl nabízet.
                  */}
                  {!z.deleted_at && posledniMajitel(z.user_id) ? (
                    <span
                      style={{ fontSize: "12.5px", color: "var(--muted)" }}
                      title="Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího."
                    >
                      jediný majitel
                    </span>
                  ) : null}
                  {!z.deleted_at && !posledniMajitel(z.user_id) && (
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
          branch_id: z.branch_id,
        }))}
        opravneni={nabizenaOpravneni}
        pobocky={ctx.branches.map((b) => ({ id: b.id, nazev: b.name }))}
        smiFiremni={ctx.membership.scope === "tenant"}
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

/* Jedna volba v paletě. `minHeight: 44` je kvůli prstu na telefonu —
   stejně jako u výběru barvy pobočky. */
const volbaBarvy = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: "7px",
  padding: "7px 11px",
  borderRadius: "999px",
  border: "1px solid var(--line-2)",
  fontSize: "12.5px",
  cursor: "pointer",
  minHeight: "44px",
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

/*
  Čeká na přidělení není chyba, ale ani běžný stav — je to nedodělek,
  na který se má vedoucí podívat. Proto stejné žluté jako jinde
  v aplikaci, ne červená.
*/
const cekaNaPrideleni = {
  color: "var(--pozor)",
  fontSize: "13px",
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
    // Text píše databáze a chodí v adrese; tenhle je jen návěští.
    case "smazani":
      return "Smazat se to nepovedlo.";
    case "opravneni-bez-uctu":
      return "Oprávnění se přiděluje přihlášenému člověku. Tenhle účet nemá — pošlete mu nejdřív pozvánku.";
    case "opravneni-bez-clenstvi":
      return "Ten člověk zatím pozvánku nepřijal, takže ve firmě nemá členství, kterému by šlo oprávnění přidělit.";
    case "opravneni-neprovedeno":
      return "Oprávnění se neuložilo. Buď je to vaše vlastní členství (to měnit nejde), nebo přidělujete víc, než máte sami.";
    case "opravneni-pobocky":
      return "Oprávnění se uložilo, ale pobočky ne — nejspíš mezi nimi je taková, na kterou sami nemáte právo.";
    case "barva-obsazena":
      return "Tuhle barvu už na téhle pobočce někdo má. Vyberte jinou, nebo nechte bez barvy — jedinečnost se hlídá v rámci pobočky, aby se v jednom rozpisu nesešli dva lidé stejné barvy.";
    case "opravneni":
      return "Oprávnění se nepodařilo uložit.";
    default:
      return "Uložení se nepovedlo. Zkuste to prosím znovu.";
  }
}
