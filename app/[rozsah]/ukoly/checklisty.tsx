import Link from "next/link";

import { hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import EmptyState from "@/components/ui/EmptyState";
import Ikona from "../ikona";
import { spustitChecklist } from "./akce";

/**
 * Checklisty — sekce na /ukoly. Vlastní soubor (ne přímo page.tsx),
 * protože Checklisty 2.0 (23. 9., Šéfíkovo zadání) přidaly čtyři
 * záložky (Dnes/Moje/Šablony/Historie), filtry a souhrn — v jednom
 * souboru s Úkoly by to bylo nepřehledné.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE (pravidlo projektu). Sloupce
 * assigned_employee_id/due_at/completed_by (20260923100000) se proto
 * čtou TOLERANTNĚ — chybí-li v databázi, dotaz se zopakuje bez nich
 * a karty se vykreslí beze jména/termínu, ne s pádem stránky.
 */

export type KlicPohledu = "dnes" | "moje" | "sablony" | "historie";

export type Beh = {
  id: string;
  template_id: string;
  business_date: string;
  status: "open" | "done";
  due_at: string | null;
  assigned_employee_id: string | null;
  completed_by: string | null;
};

type Sablona = {
  id: string;
  name: string;
  schedule: string;
  usek_id: string | null;
};

/** Karta, kterou kreslí všechny čtyři pohledy — sjednocený tvar. */
export type Karta = {
  klic: string;
  sablonaId: string;
  nazev: string;
  schedule: string;
  usekNazev: string | null;
  beh: Beh | null;
  hotovo: number;
  celkem: number;
};

export const NAZVY_ROZVRHU: Record<string, string> = {
  opening: "Otevírací",
  closing: "Zavírací",
  haccp: "HACCP",
  weekly: "Týdenní",
};

/** Okamžik „teď". Zvlášť, aby se `Date.now()` nevolalo uvnitř těla komponenty. */
export function terazMs(): number {
  return Date.now();
}

/** Barva/text stavu — jeden zdroj pravdy pro kartu i souhrn. */
export type Stav = "hotovo" | "probiha" | "poterminu" | "nezahajeno";

export function stavKarty(k: Pick<Karta, "beh" | "hotovo">, ted: number): Stav {
  if (k.beh?.status === "done") return "hotovo";
  if (k.beh?.due_at && new Date(k.beh.due_at).getTime() < ted) return "poterminu";
  if (k.beh && k.hotovo > 0) return "probiha";
  return "nezahajeno";
}

/**
 * `business_date` je DATE, ne timestamptz — "2026-09-20", bez hodiny a
 * bez pásma. Posílat to přes datumACasVPasmu (Date() + pásmo pobočky)
 * by u některých hodin/pásem uteklo o den vedle (pravidlo 11 — pásmo se
 * dodává jen tam, kde je OKAMŽIK, ne kalendářní den). Čistě textové
 * rozebrání, žádný Date().
 */
export function denText(businessDate: string): string {
  const [, mesic, den] = businessDate.split("-");
  return `${Number(den)}. ${Number(mesic)}.`;
}

export const STAV_POPIS: Record<Stav, string> = {
  hotovo: "Hotovo",
  probiha: "Probíhá",
  poterminu: "Po termínu",
  nezahajeno: "Nezahájeno",
};

// Barvy podle stejné trojice jako jinde v appce (--dobre/--pozor/--bad),
// „nezahájeno" schválně neutrální (--muted) — je to čekání, ne problém.
export const STAV_BARVA: Record<Stav, { bg: string; fg: string }> = {
  hotovo: { bg: "var(--dobre-bg, var(--sunken))", fg: "var(--dobre, var(--muted))" },
  probiha: { bg: "var(--pozor-bg, var(--sunken))", fg: "var(--pozor, var(--muted))" },
  poterminu: { bg: "var(--bad-bg, var(--sunken))", fg: "var(--bad, var(--muted))" },
  nezahajeno: { bg: "var(--sunken)", fg: "var(--muted)" },
};

export default async function Checklisty({
  rozsah,
  tenantId,
  branchId,
  branches,
  mujEmployeeId,
  jmenaLidi,
  smiZadat,
  pohled,
  usekFiltr,
  stavFiltr,
  strana,
  chyba,
}: {
  rozsah: string;
  tenantId: string;
  branchId: string | null;
  branches: { id: string; slug: string; name: string }[];
  /** null = nemám zaměstnanecký záznam (vlastník bez vlastního employee řádku apod). */
  mujEmployeeId: string | null;
  jmenaLidi: Map<string, string>;
  smiZadat: boolean;
  pohled: KlicPohledu;
  usekFiltr: string | null;
  stavFiltr: string | null;
  /** Stránkování Historie, 1-based. */
  strana: number;
  chyba?: string | null;
}) {
  if (!branchId) {
    return (
      <div>
        <h2 style={{ ...nadpisSekce, marginBottom: "12px" }}>Checklisty</h2>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
          Checklisty se vedou po pobočkách. Vyberte, na kterou se podívat:
        </p>
        {branches.length > 0 ? (
          <ul style={{ ...seznam, marginTop: "10px" }}>
            {branches.map((b) => (
              <li key={b.id}>
                <Link href={`/${b.slug}/ukoly`} className="ft-tl ft-tl-vedlejsi" style={{ width: "100%" }}>
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const supabase = await getServerSupabase();
  const den = await provozniDen(branchId);

  /* --- Úseky (pro filtr a název u karty) -------------------------- */

  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);
  const nazvyUseku = new Map((usekyData ?? []).map((u) => [u.id as string, String(u.nazev)]));

  /* --- Šablony pro tuhle pobočku (+ firemní) ---------------------- */

  const { data: sablonyData, error: chybaSablonyData } = await supabase
    .from("checklist_templates")
    .select("id, name, schedule, usek_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .order("name", { ascending: true });
  if (chybaSablonyData) throw new DotazSelhal("šablony checklistů", chybaSablonyData);
  const sablony = (sablonyData ?? []) as Sablona[];
  const sablonyPodleId = new Map(sablony.map((s) => [s.id, s]));

  /* --- Počty položek na šablonu ------------------------------------ */

  const poctyPolozek = new Map<string, number>();
  if (sablony.length > 0) {
    const { data: polozky, error: chybaPolozky } = await supabase
      .from("checklist_items")
      .select("id, template_id")
      .in("template_id", sablony.map((s) => s.id));
    if (chybaPolozky) throw new DotazSelhal("položky checklistu", chybaPolozky);
    for (const p of polozky ?? []) {
      const t = p.template_id as string;
      poctyPolozek.set(t, (poctyPolozek.get(t) ?? 0) + 1);
    }
  }

  /* --- Běhy — dotaz podle pohledu, tolerantně na nové sloupce ------ */

  const SLOUPCE_PLNE = "id, template_id, business_date, status, due_at, assigned_employee_id, completed_by";
  const SLOUPCE_ZAKLAD = "id, template_id, business_date, status";
  let odpovednostDostupna = true;

  // Vrací výsledek (ne mutuje vnější proměnnou) — reassign uvnitř
  // vnořené async funkce hlásí react-hooks/immutability jako riziko
  // (nekonzistence mezi souběžnými rendery). Volající si `odpovednostDostupna`
  // nastaví sami, v těle komponenty, kde je to bezpečné.
  async function nactiBehy(
    sestavDotaz: (sloupce: string) => PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<{ behy: Beh[]; odpovednostDostupna: boolean }> {
    let { data, error } = await sestavDotaz(SLOUPCE_PLNE);
    let plna = true;
    if (error && sloupecNeexistuje(error as Parameters<typeof sloupecNeexistuje>[0])) {
      plna = false;
      ({ data, error } = await sestavDotaz(SLOUPCE_ZAKLAD));
    }
    if (error) throw new DotazSelhal("běhy checklistů", error as ConstructorParameters<typeof DotazSelhal>[1]);
    return {
      behy: ((data ?? []) as Record<string, unknown>[]).map(
        (b): Beh => ({
          id: b.id as string,
          template_id: b.template_id as string,
          business_date: b.business_date as string,
          status: b.status as "open" | "done",
          due_at: (b.due_at as string | undefined) ?? null,
          assigned_employee_id: (b.assigned_employee_id as string | undefined) ?? null,
          completed_by: (b.completed_by as string | undefined) ?? null,
        }),
      ),
      odpovednostDostupna: plna,
    };
  }

  const idSablon = sablony.map((s) => s.id);
  const CELKEM_HISTORIE = 20;

  /*
    DNEŠNÍ běhy se načtou VŽDYCKY, nezávisle na aktivním pohledu/filtru
    — souhrn (Dnes/Probíhá/Po termínu/Hotovo) musí zůstat pravdivý, ať
    se dívám na Historii nebo na Moje s libovolným filtrem. 'dnes'
    a 'sablony' tenhle stejný dotaz zároveň použijí jako svá data karet,
    ať se nenačítá dvakrát.
  */
  let behyDnes: Beh[] = [];
  if (idSablon.length > 0 && den) {
    const vysledekDnes = await nactiBehy((sloupce) =>
      supabase
        .from("checklist_runs")
        .select(sloupce)
        .eq("branch_id", branchId)
        .eq("business_date", den)
        .in("template_id", idSablon),
    );
    behyDnes = vysledekDnes.behy;
    odpovednostDostupna = vysledekDnes.odpovednostDostupna;
  }
  const behyDnesPodleSablony = new Map<string, Beh>();
  for (const b of behyDnes) behyDnesPodleSablony.set(b.template_id, b);

  let behy: Beh[] = behyDnes;
  let celkemHistorie = 0;

  if (idSablon.length > 0 && den) {
    if (pohled === "historie") {
      const vysledekHistorie = await nactiBehy((sloupce) =>
        supabase
          .from("checklist_runs")
          .select(sloupce)
          .eq("branch_id", branchId)
          .neq("business_date", den)
          .in("template_id", idSablon)
          .order("business_date", { ascending: false })
          .range((strana - 1) * CELKEM_HISTORIE, strana * CELKEM_HISTORIE - 1),
      );
      behy = vysledekHistorie.behy;
      odpovednostDostupna = vysledekHistorie.odpovednostDostupna;
      const { count } = await supabase
        .from("checklist_runs")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .neq("business_date", den)
        .in("template_id", idSablon);
      celkemHistorie = count ?? 0;
    } else if (pohled === "moje" && !mujEmployeeId) {
      // Bez vlastního zaměstnaneckého záznamu nemůže mít nic přiřazeno —
      // honest prázdno, ne dnešní seznam omylem (viz behy = behyDnes výš).
      behy = [];
    } else if (pohled === "moje" && mujEmployeeId) {
      // "Moje" FILTRUJE podle assigned_employee_id — na rozdíl od ostatních
      // pohledů se tu nový sloupec objevuje i ve WHERE, ne jen ve SELECT.
      // Chybějící sloupec proto chybu vyhodí i s tolerantním výběrem sloupců
      // (nactiBehy) — bez migrace tenhle pohled nedává smysl vůbec, takže
      // se rovnou vzdává, místo aby zkoušel druhý dotaz, který spadne
      // stejně.
      const { data, error } = await supabase
        .from("checklist_runs")
        .select(SLOUPCE_PLNE)
        .eq("branch_id", branchId)
        .eq("assigned_employee_id", mujEmployeeId)
        .or(`status.eq.open,business_date.eq.${den}`)
        .in("template_id", idSablon)
        .order("business_date", { ascending: false });
      if (error && sloupecNeexistuje(error as Parameters<typeof sloupecNeexistuje>[0])) {
        odpovednostDostupna = false;
        behy = [];
      } else if (error) {
        throw new DotazSelhal("moje běhy checklistů", error as ConstructorParameters<typeof DotazSelhal>[1]);
      } else {
        behy = ((data ?? []) as Record<string, unknown>[]).map(
          (b): Beh => ({
            id: b.id as string,
            template_id: b.template_id as string,
            business_date: b.business_date as string,
            status: b.status as "open" | "done",
            due_at: (b.due_at as string | undefined) ?? null,
            assigned_employee_id: (b.assigned_employee_id as string | undefined) ?? null,
            completed_by: (b.completed_by as string | undefined) ?? null,
          }),
        );
      }
    }
    // 'dnes' a 'sablony' nedělají nic navíc — `behy` už je `behyDnes`.
  }

  /* --- Hotovo/celkem z checklist_entries --------------------------- */

  // Sjednocené id běhů karet i dnešního souhrnu — jeden dotaz na obojí
  // (u 'dnes'/'sablony' je to stejná množina, u 'moje'/'historie' dvě
  // různé, `Set` dedup vyřeší obojí stejně).
  const idBehuPotreba = [...new Set([...behy.map((b) => b.id), ...behyDnes.map((b) => b.id)])];

  const hotoveVBehu = new Map<string, number>();
  if (idBehuPotreba.length > 0) {
    const { data: zaznamy, error: chybaZaznamy } = await supabase
      .from("checklist_entries")
      .select("run_id, checked")
      .in("run_id", idBehuPotreba);
    if (chybaZaznamy) throw new DotazSelhal("odškrtnuté položky", chybaZaznamy);
    for (const z of zaznamy ?? []) {
      if (z.checked !== true) continue;
      const r = z.run_id as string;
      hotoveVBehu.set(r, (hotoveVBehu.get(r) ?? 0) + 1);
    }
  }

  /* --- Sestavení karet podle pohledu ------------------------------- */

  const behyPodleSablony = new Map<string, Beh>();
  for (const b of behy) behyPodleSablony.set(b.template_id, b);

  let karty: Karta[];
  if (pohled === "moje" || pohled === "historie") {
    // Tyhle dva pohledy jsou seznam BĚHŮ, ne šablon — jedna šablona v nich
    // klidně může mít víc karet (víc dnů historie).
    karty = behy
      .map((b): Karta | null => {
        const s = sablonyPodleId.get(b.template_id);
        if (!s) return null;
        return {
          klic: b.id,
          sablonaId: s.id,
          nazev: s.name,
          schedule: s.schedule,
          usekNazev: s.usek_id ? (nazvyUseku.get(s.usek_id) ?? null) : null,
          beh: b,
          hotovo: hotoveVBehu.get(b.id) ?? 0,
          celkem: poctyPolozek.get(s.id) ?? 0,
        };
      })
      .filter((k): k is Karta => k !== null);
  } else {
    // 'dnes' a 'sablony': jedna karta na šablonu, běh (pokud dnes existuje)
    // se k ní jen připojí.
    karty = sablony.map((s) => {
      const b = behyPodleSablony.get(s.id) ?? null;
      return {
        klic: s.id,
        sablonaId: s.id,
        nazev: s.name,
        schedule: s.schedule,
        usekNazev: s.usek_id ? (nazvyUseku.get(s.usek_id) ?? null) : null,
        beh: b,
        hotovo: b ? (hotoveVBehu.get(b.id) ?? 0) : 0,
        celkem: poctyPolozek.get(s.id) ?? 0,
      } satisfies Karta;
    });
  }

  /* --- Filtry (úsek, stav) — nad už sestavenými kartami ------------ */

  const ted = terazMs();

  if (usekFiltr) {
    karty = karty.filter((k) => {
      const s = sablonyPodleId.get(k.sablonaId);
      return s?.usek_id === usekFiltr;
    });
  }
  if (stavFiltr && stavFiltr !== "vse") {
    karty = karty.filter((k) => stavKarty(k, ted) === stavFiltr);
  }

  /*
    Souhrn — VŽDY z dnešních běhů (behyDnes), nezávisle na aktivním
    pohledu i na úsek/stav filtru. Kdo se dívá na Historii s filtrem
    "úsek: Bar", má pořád vidět, kolik toho čeká DNES, ne "0", protože
    filtr zrovna míří jinam.
  */
  const dnesniKarty: Karta[] = sablony.map((s) => {
    const b = behyDnesPodleSablony.get(s.id) ?? null;
    return {
      klic: s.id,
      sablonaId: s.id,
      nazev: s.name,
      schedule: s.schedule,
      usekNazev: null,
      beh: b,
      hotovo: b ? (hotoveVBehu.get(b.id) ?? 0) : 0,
      celkem: poctyPolozek.get(s.id) ?? 0,
    };
  });
  const souhrn = {
    celkem: sablony.length,
    probiha: dnesniKarty.filter((k) => stavKarty(k, ted) === "probiha").length,
    poTerminu: dnesniKarty.filter((k) => stavKarty(k, ted) === "poterminu").length,
    hotovo: dnesniKarty.filter((k) => stavKarty(k, ted) === "hotovo").length,
  };

  // Odznak u záložky "Moje" schválně nemá číslo — počet by byl přesný
  // jen na pohledu Dnes (odjinud nese jiná data behyPodleSablony) a
  // špatné číslo je horší než žádné.

  /* --- Vykreslení ---------------------------------------------------- */

  // `#checklisty` MUSÍ být na konci adresy — parametry za fragmentem
  // (`...#checklisty&strana=2`) prohlížeč bere jako součást fragmentu,
  // ne jako dotaz, a stránkování by tiše přestalo fungovat.
  const zaklad = (p: KlicPohledu, extra?: Record<string, string>) =>
    `/${rozsah}/ukoly?${new URLSearchParams({ cl: p, ...extra }).toString()}#checklisty`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
        <h2 style={{ ...nadpisSekce, margin: 0 }}>Checklisty</h2>
        {smiZadat ? (
          <Link href={`/${rozsah}/ukoly/sablona/nova`} className="ft-tl ft-tl-hlavni ft-tl-male">
            + Nový checklist
          </Link>
        ) : null}
      </div>

      {chyba === "odpovednost" ? (
        <p role="alert" style={{ ...ramecekChyby, marginBottom: "12px" }}>
          Přiřazení se nepodařilo uložit — vybraný člověk možná nepatří
          k vaší firmě. Zkuste to prosím znovu.
        </p>
      ) : null}

      {sablony.length > 0 ? (
        <div style={souhrnRadek}>
          <SouhrnKarta ikona="seznam" nazev="Dnes" cislo={souhrn.celkem} popis="checklistů pro pobočku" />
          <SouhrnKarta ikona="hodiny" nazev="Probíhá" cislo={souhrn.probiha} popis="právě se vyplňuje" barva="pozor" />
          <SouhrnKarta ikona="vykricnik" nazev="Po termínu" cislo={souhrn.poTerminu} popis="vyžaduje pozornost" barva="bad" />
          <SouhrnKarta ikona="fajfkaKruh" nazev="Hotovo" cislo={souhrn.hotovo} popis="dnes dokončeno" barva="dobre" />
        </div>
      ) : null}

      <nav style={zalozkyRadek} aria-label="Pohled na checklisty">
        {(
          [
            ["dnes", "Dnes"],
            ["moje", "Moje"],
            ["sablony", "Šablony"],
            ["historie", "Historie"],
          ] as [KlicPohledu, string][]
        ).map(([klic, nazev]) => (
          <Link
            key={klic}
            href={zaklad(klic)}
            aria-current={klic === pohled ? "page" : undefined}
            style={klic === pohled ? zalozkaAktivni : zalozkaNeaktivni}
          >
            {nazev}
          </Link>
        ))}
      </nav>

      {/* action nese #checklisty, ať filtrování nezhodí stránku nahoru. */}
      {sablony.length > 0 ? (
        <form method="get" action={`/${rozsah}/ukoly#checklisty`} style={filtryRadek}>
          <input type="hidden" name="cl" value={pohled} />
          <select name="usek" defaultValue={usekFiltr ?? ""} style={filtrVyber} aria-label="Úsek">
            <option value="">Úsek: vše</option>
            {[...nazvyUseku].map(([id, nazev]) => (
              <option key={id} value={id}>{nazev}</option>
            ))}
          </select>
          <select name="stav" defaultValue={stavFiltr ?? "vse"} style={filtrVyber} aria-label="Stav">
            <option value="vse">Stav: vše</option>
            <option value="nezahajeno">Nezahájeno</option>
            <option value="probiha">Probíhá</option>
            <option value="poterminu">Po termínu</option>
            <option value="hotovo">Hotovo</option>
          </select>
          <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">Filtrovat</button>
        </form>
      ) : null}

      {!den ? (
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
          Nepodařilo se zjistit provozní den, takže checklisty nelze zobrazit.
        </p>
      ) : sablony.length === 0 ? (
        <EmptyState
          ikona={<Ikona klic="seznam" />}
          nadpis="Zatím žádné checklisty"
          akce={smiZadat ? <Link href={`/${rozsah}/ukoly/sablona/nova`} className="ft-tl ft-tl-hlavni ft-tl-male">+ Vytvořit checklist</Link> : undefined}
        >
          Pro tuhle pobočku není nastavený žádný checklist.
        </EmptyState>
      ) : karty.length === 0 ? (
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
          {pohled === "historie"
            ? "V historii nic neodpovídá zvolenému filtru."
            : pohled === "moje"
              ? "Nemáte přiřazený žádný checklist."
              : "Ničemu tady neodpovídá zvolený filtr."}
        </p>
      ) : (
        <>
          <ul style={seznam}>
            {karty.map((k) => (
              <KartaChecklistu
                key={k.klic}
                rozsah={rozsah}
                karta={k}
                stav={stavKarty(k, ted)}
                jmenaLidi={jmenaLidi}
                zona={ZONA_VYCHOZI}
                odpovednostDostupna={odpovednostDostupna}
                zobrazitDatum={pohled === "historie" || pohled === "moje"}
              />
            ))}
          </ul>

          {pohled === "historie" && celkemHistorie > CELKEM_HISTORIE ? (
            <div style={{ display: "flex", gap: "8px", marginTop: "14px", fontSize: "13px" }}>
              {strana > 1 ? (
                <Link href={zaklad("historie", { strana: String(strana - 1) })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  ← Novější
                </Link>
              ) : null}
              <span style={{ color: "var(--muted)", alignSelf: "center" }}>
                Strana {strana} z {Math.ceil(celkemHistorie / CELKEM_HISTORIE)}
              </span>
              {strana * CELKEM_HISTORIE < celkemHistorie ? (
                <Link href={zaklad("historie", { strana: String(strana + 1) })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  Starší →
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {!odpovednostDostupna ? (
        <p style={{ margin: "14px 0 0", fontSize: "12px", color: "var(--muted)" }}>
          Odpovědnost (kdo/do kdy) se zobrazí po nasazení nejnovější
          databázové migrace.
        </p>
      ) : null}
    </div>
  );
}

/* --- karta jednoho checklistu -------------------------------------- */

export function KartaChecklistu({
  rozsah,
  karta: k,
  stav,
  jmenaLidi,
  zona,
  odpovednostDostupna,
  zobrazitDatum,
}: {
  rozsah: string;
  karta: Karta;
  stav: Stav;
  jmenaLidi: Map<string, string>;
  zona: string;
  odpovednostDostupna: boolean;
  zobrazitDatum: boolean;
}) {
  const barva = STAV_BARVA[stav];
  const jmenoOdpovedneho = k.beh?.assigned_employee_id ? jmenaLidi.get(k.beh.assigned_employee_id) : null;
  const jmenoDokoncil = k.beh?.completed_by ? jmenaLidi.get(k.beh.completed_by) : null;
  const procenta = k.celkem > 0 ? Math.round((k.hotovo / k.celkem) * 100) : 0;

  return (
    <li style={kartaStyl}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
        <p style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--ink)" }}>{k.nazev}</p>
        <span style={{ ...stavStitek, background: barva.bg, color: barva.fg }}>{STAV_POPIS[stav]}</span>
      </div>

      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
        {[
          k.usekNazev,
          NAZVY_ROZVRHU[k.schedule] ?? k.schedule,
          zobrazitDatum && k.beh ? denText(k.beh.business_date) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {k.celkem > 0 ? (
        <div style={{ marginTop: "8px" }}>
          <div style={progressPozadi}>
            <div style={{ ...progressVypln, width: `${procenta}%`, background: barva.fg }} />
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
            {k.hotovo} z {k.celkem} hotovo
          </p>
        </div>
      ) : null}

      {odpovednostDostupna && (jmenoOdpovedneho || k.beh?.due_at) ? (
        <p style={{ margin: "8px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
          {jmenoOdpovedneho ? <>Odpovědný: <strong style={{ color: "var(--ink)" }}>{jmenoOdpovedneho}</strong></> : null}
          {jmenoOdpovedneho && k.beh?.due_at ? " · " : null}
          {k.beh?.due_at ? `do ${hodinaVPasmu(k.beh.due_at, zona)}` : null}
        </p>
      ) : null}

      {odpovednostDostupna && k.beh?.status === "done" && jmenoDokoncil ? (
        <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
          Dokončil: {jmenoDokoncil}
        </p>
      ) : null}

      <div style={{ marginTop: "10px" }}>
        {k.beh ? (
          <Link href={`/${rozsah}/ukoly/${k.beh.id}`} className="ft-tl ft-tl-hlavni ft-tl-male">
            {k.beh.status === "done" ? "Zobrazit" : "Pokračovat"}
          </Link>
        ) : (
          <form action={spustitChecklist} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="sablona" value={k.sablonaId} />
            {odpovednostDostupna ? (
              <>
                <select name="komu" defaultValue="" style={mikroVyber} aria-label="Přiřadit">
                  <option value="">Nepřiřazeno</option>
                  {[...jmenaLidi].map(([id, jmeno]) => (
                    <option key={id} value={id}>{jmeno}</option>
                  ))}
                </select>
                <input type="datetime-local" name="doKdy" style={mikroVyber} aria-label="Do kdy" />
              </>
            ) : null}
            <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">Spustit</button>
          </form>
        )}
      </div>
    </li>
  );
}

export function SouhrnKarta({
  ikona,
  nazev,
  cislo,
  popis,
  barva,
}: {
  ikona: Parameters<typeof Ikona>[0]["klic"];
  nazev: string;
  cislo: number;
  popis: string;
  barva?: "pozor" | "bad" | "dobre";
}) {
  return (
    <div style={souhrnKartaStyl}>
      <span
        style={{
          ...souhrnIkona,
          color: barva ? `var(--${barva})` : "var(--muted)",
          background: barva ? `var(--${barva}-bg, var(--sunken))` : "var(--sunken)",
        }}
      >
        <Ikona klic={ikona} />
      </span>
      <div>
        <p style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--ink)", lineHeight: 1.1 }}>{cislo}</p>
        <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>{nazev} · {popis}</p>
      </div>
    </div>
  );
}

/* --- styly ------------------------------------------------------- */

const nadpisSekce = {
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

const kartaStyl = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "14px",
} as const;

const stavStitek = {
  flex: "none",
  padding: "3px 9px",
  borderRadius: "999px",
  fontSize: "11.5px",
  fontWeight: 700,
  whiteSpace: "nowrap",
} as const;

const progressPozadi = {
  height: "6px",
  borderRadius: "999px",
  background: "var(--sunken)",
  overflow: "hidden",
} as const;

const progressVypln = {
  height: "100%",
  borderRadius: "999px",
} as const;

const souhrnRadek = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "10px",
  marginBottom: "14px",
} as const;

const souhrnKartaStyl = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
} as const;

const souhrnIkona = {
  display: "inline-grid",
  placeItems: "center",
  flex: "none",
  width: "34px",
  height: "34px",
  borderRadius: "50%",
} as const;

const zalozkyRadek = {
  display: "flex",
  gap: "4px",
  flexWrap: "wrap",
  marginBottom: "12px",
  borderBottom: "1px solid var(--line)",
  paddingBottom: "0",
} as const;

const zalozkaSpolecne = {
  padding: "8px 12px",
  fontSize: "13.5px",
  textDecoration: "none",
  borderBottom: "2px solid transparent",
  marginBottom: "-1px",
} as const;

const zalozkaAktivni = {
  ...zalozkaSpolecne,
  color: "var(--ink)",
  fontWeight: 600,
  borderBottomColor: "var(--mosaz, var(--accent))",
} as const;

const zalozkaNeaktivni = {
  ...zalozkaSpolecne,
  color: "var(--muted)",
} as const;

const filtryRadek = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  marginBottom: "14px",
} as const;

const filtrVyber = {
  padding: "8px 10px",
  fontSize: "13.5px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "38px",
} as const;

const mikroVyber = {
  ...filtrVyber,
  minHeight: "40px",
  fontSize: "13px",
} as const;

const ramecekChyby = {
  background: "var(--bad-bg)",
  color: "var(--bad)",
  border: "1px solid var(--bad)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  fontSize: "14px",
} as const;
