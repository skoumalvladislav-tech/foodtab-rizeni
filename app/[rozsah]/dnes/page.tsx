import Link from "next/link";
import { redirect } from "next/navigation";

import { canSee, getContext, getUser, jeVedeni } from "@/lib/authz";
import { barvaNeboNic } from "@/lib/barvy-lidi";
import { hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { pocet } from "@/lib/sklonovani";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { posunDatum } from "@/lib/provozni-den";
import { KBELIK as KBELIK_POZADI, PLATNOST_ODKAZU_S as PLATNOST_ODKAZU_POZADI_S } from "@/lib/pobocky-pozadi";
import { nactiPocasi, type Pocasi } from "@/lib/pocasi";
import { odkazNaPrihlaseni } from "@/lib/prihlaseni-adresa";
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { fakturyJsouNastavene, getFakturySupabase } from "@/lib/supabase/faktury";
import { STAV_KE_SCHVALENI, STAV_UHRAZENO } from "@/lib/faktury-types";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Nadpis from "../nadpis";
import { zapsatDochazku } from "../dochazka/akce";
import PoleKodu from "../dochazka/pole-kodu";

export const dynamic = "force-dynamic";

/**
 * Dnes — domovská obrazovka zaměstnance.
 *
 * ---------------------------------------------------------------------
 * PROČ VZNIKLA
 *
 * Číšník, který si aplikaci otevře, má v hlavě jednu otázku: KDY MÁM
 * PŘÍŠTĚ JÍT A JSEM TEĎ ZAPÍCHNUTÝ? Do dneška dostal rozcestník
 * s šesti dlaždicemi a odpověď si musel najít sám — v provozu, kde na
 * to má vteřiny mezi objednávkami.
 *
 * NENÍ TO NOVÁ FUNKCE. Všechno, co je tady vidět, už v aplikaci bylo;
 * mění se jen pořadí a to, co uvidí první. Píchnutí jde přes TUTÉŽ
 * serverovou akci jako na Docházce (`zapsatDochazku`) — druhá cesta do
 * databáze by znamenala druhé místo, kde se dá zapomenout na kód nebo
 * na hlášku o uzavřeném příchodu.
 *
 * ---------------------------------------------------------------------
 * CO SE SEM NESMÍ DOSTAT
 *
 * Cizí mzdy, cizí sazby, podíl nákladů, tržby. Na telefonu to platí
 * dvojnásob — obrazovku vidí každý, kdo stojí vedle. „Na směně s vámi"
 * jsou proto JEN JMÉNA: `select` si říká o `id, full_name` a nic víc,
 * i když by RLS pustila i barvu nebo pozici.
 *
 * ---------------------------------------------------------------------
 * DESIGN SYSTÉM, 16.9.2026 — přestavba podle mockupu Šéfíka
 *
 * Pozdrav + přehledové karty (Docházka/Další směna/Vzkazy/Úkoly) a
 * postranní panel Rychlých akcí jsou nové, ale JEN vrstva nad
 * existujícími daty — žádný nový zdroj pravdy, žádné vymyšlené číslo.
 * Co appka nemá odkud vzít (tržby, online objednávky, hodnocení
 * Google, počasí), se nekreslí vůbec — čeká na Šéfíkovo napojení
 * zdroje dat, ne na vymyšlená čísla.
 *
 * Hero fotka provozovny — od 16.9.2026 večer už appka odkud vzít
 * SKUTEČNOU fotku MÁ: Nastavení → Pobočky umí nahrát vlastní snímek
 * (branches.hero_photo_path, app/[rozsah]/nastaveni/pobocky/akce.ts).
 * Dokud ji nikdo nenahraje, banner nese jen barvu pobočky — pořád ne
 * cizí/stock snímek, který by předstíral, že je to ona.
 */

const PRISTICH_SMEN = 3;

type Smena = {
  id: string;
  branch_id: string;
  employee_id: string | null;
  shift_date: string;
  starts_at: string;
  ends_at: string;
};

type MujDen = {
  employee_id: string;
  v_praci: boolean;
  od_kdy: string | null;
  minut_v_praci: number | null;
  den_prichodu: string | null;
  pobocka: string | null;
  pobocka_nazev: string | null;
  provozni_den: string;
};

type Rozhovor = { druh: string; neprectenych: number };

export default async function Dnes({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{
    chyba?: string;
    text?: string;
    pichnuto?: string;
    uzavreno?: string;
    kod?: string;
  }>;
}) {
  const { rozsah } = await params;
  const { chyba, text, pichnuto, uzavreno, kod } = await searchParams;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const user = await getUser();
  if (!user) redirect(await odkazNaPrihlaseni());

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const ctx = await getContext(tenantId);
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    );
  }

  /*
    Žádné právo se tu nevyžaduje — Dnes je obrazovka, kterou má každý
    sám za sebe, stejně jako Docházku. Kdyby visela na oprávnění,
    nedostal by se na ni brigádník, tedy zrovna ten, komu má nejvíc
    ušetřit hledání.
  */
  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  const { data: denData, error: chybaDen } = await supabase.rpc("muj_den", {
    p_tenant: tenantId,
  });

  // Nenasazená migrace obrazovku neshodí — rámeček místo pádu.
  if (funkceNeexistuje(chybaDen)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Co potřebujete vědět hned teď.">
          Dnes
        </Nadpis>
        <div style={{ padding: "16px" }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong> Dnes
            přibude migrací <code>20260907010000_muj_den</code>.
          </p>
        </div>
      </>
    );
  }
  if (chybaDen) throw new DotazSelhal("můj den", chybaDen);

  const den = ((denData ?? [])[0] ?? null) as MujDen | null;

  if (!den) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Co potřebujete vědět hned teď.">
          Dnes
        </Nadpis>
        <div style={{ padding: "16px" }}>
          <Sdeleni nadpis="Zatím nemáte zaměstnanecký záznam">
            Až vás někdo ve firmě zavede mezi lidi, uvidíte tu svoje směny
            i docházku.
          </Sdeleni>
        </div>
      </>
    );
  }

  /*
    Hero fotka a souřadnice pro počasí — jen na konkrétní pobočce, ne
    na „Celá firma". Na firemní úrovni nemá smysl ukazovat fotku nebo
    počasí jedné konkrétní pobočky; tam banner zůstává na barvě
    a widget počasí se nekreslí, stejně jako beze dat vůbec.
    Oba sloupce čekají na migrace (20260916160000, 20260916170000) —
    dokud neproběhnou, dotaz na ně selže a Dnes má prostě pokračovat
    beze fotky/počasí, ne spadnout na chybějícím sloupci.
  */
  let heroFotoUrl: string | null = null;
  let pocasi: Pocasi | null = null;
  if (scope.level === "branch" && scope.branchId) {
    const { data: pobockaData, error: chybaPobocky } = await supabase
      .from("branches")
      .select("hero_photo_path, lat, lon")
      .eq("id", scope.branchId)
      .maybeSingle();
    const radek = sloupecNeexistuje(chybaPobocky)
      ? null
      : (pobockaData as { hero_photo_path: string | null; lat: number | null; lon: number | null } | null);

    if (radek?.hero_photo_path) {
      const { data: podepsany } = await supabase.storage
        .from(KBELIK_POZADI)
        .createSignedUrl(radek.hero_photo_path, PLATNOST_ODKAZU_POZADI_S);
      heroFotoUrl = podepsany?.signedUrl ?? null;
    }

    if (radek?.lat !== null && radek?.lat !== undefined && radek?.lon !== null && radek?.lon !== undefined) {
      const vysledek = await nactiPocasi(radek.lat, radek.lon);
      if (vysledek.stav === "ok") pocasi = vysledek.pocasi;
      // Chyba (výpadek MET Norska, zablokovaná IP…) se schválně
      // nikam nehlásí — widget počasí se prostě nekreslí, stejné
      // pravidlo jako u chybějících souřadnic.
    }
  }

  /*
    Směny: dnešek a nejbližší příští. Čte se přímo z tabulky, protože
    RLS na `shifts` už rozhoduje o tom, kdo co vidí — a stejně to dělá
    i Rozpis směn.
  */
  const { data: smenyData, error: chybaSmeny } = await supabase
    .from("shifts")
    .select("id, branch_id, employee_id, shift_date, starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .gte("shift_date", den.provozni_den)
    .neq("status", "cancelled")
    .order("shift_date", { ascending: true })
    .order("starts_at", { ascending: true })
    .limit(200);
  if (chybaSmeny) throw new DotazSelhal("moje směny", chybaSmeny);
  const smeny = (smenyData ?? []) as Smena[];

  const mojeSmeny = smeny.filter((s) => s.employee_id === den.employee_id);
  const dnesniSmena = mojeSmeny.find((s) => s.shift_date === den.provozni_den) ?? null;
  const pristi = mojeSmeny
    .filter((s) => s.shift_date > den.provozni_den)
    .slice(0, PRISTICH_SMEN);

  /*
    „Na směně s vámi" — jen jména, nic víc.

    `select` si říká o `id, full_name` schválně: RLS by pustila i barvu
    nebo pozici, ale zadání (bod 6) říká jména a nic jiného, a na
    telefonu obrazovku vidí každý, kdo stojí vedle.
  */
  const kolegoveIds = dnesniSmena
    ? [
        ...new Set(
          smeny
            .filter(
              (s) =>
                s.shift_date === den.provozni_den &&
                s.branch_id === dnesniSmena.branch_id &&
                s.employee_id !== null &&
                s.employee_id !== den.employee_id,
            )
            .map((s) => s.employee_id as string),
        ),
      ]
    : [];

  const jmena: string[] = [];
  if (kolegoveIds.length > 0) {
    const { data: lide, error: chybaLide } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", kolegoveIds);
    if (chybaLide) throw new DotazSelhal("kolegové na směně", chybaLide);
    for (const l of lide ?? []) {
      const j = String(l.full_name ?? "").trim();
      if (j !== "") jmena.push(j);
    }
    jmena.sort((a, b) => a.localeCompare(b, "cs"));
  }

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  /*
    Dnešní rozpis, barevně — jen s `shifts.read` (stejné právo, jaké
    hlídá Rozpis směn). `smeny` už appka má načtené (viz výš), tady se
    jen filtruje na dnešek a dotáhnou se jména/barvy — TÝŽ dotaz a TÁŽ
    `barvaNeboNic` normalizace jako v app/[rozsah]/smeny/page.tsx, ať
    barva člověka na Dnes a v Rozpisu vždycky sedí na totéž.
  */
  const dnesniRozpis: { id: string; employeeId: string; jmeno: string; barva: string | null; od: string; do: string }[] = [];
  if (canSee(ctx, "shifts.read")) {
    const smenyDnes = smeny.filter((s) => s.shift_date === den.provozni_den && s.employee_id !== null);
    const idDnes = [...new Set(smenyDnes.map((s) => s.employee_id as string))];
    if (idDnes.length > 0) {
      const { data: lideDnes, error: chybaLideDnes } = await supabase
        .from("employees")
        .select("id, full_name, color")
        .in("id", idDnes);
      if (chybaLideDnes) throw new DotazSelhal("lidé v dnešním rozpisu", chybaLideDnes);
      const jmenaDnes = new Map((lideDnes ?? []).map((c) => [c.id as string, c.full_name as string]));
      const barvyDnes = new Map((lideDnes ?? []).map((c) => [c.id as string, barvaNeboNic(c.color)]));
      for (const s of smenyDnes) {
        dnesniRozpis.push({
          id: s.id,
          employeeId: s.employee_id as string,
          jmeno: jmenaDnes.get(s.employee_id as string) ?? "?",
          barva: barvyDnes.get(s.employee_id as string) ?? null,
          od: s.starts_at.slice(0, 5),
          do: s.ends_at.slice(0, 5),
        });
      }
      dnesniRozpis.sort((a, b) => a.od.localeCompare(b.od));
    }
  }

  /*
    Vlastní jméno pro pozdrav — jen křestní, ne celé úřední jméno.
    Chyba se nevyhazuje: bez jména appka řekne jen „Dobré odpoledne",
    což je horší UX, ne rozbitá obrazovka.
  */
  const { data: vlastni } = await supabase
    .from("employees")
    .select("full_name")
    .eq("id", den.employee_id)
    .maybeSingle();
  const krestni = String(vlastni?.full_name ?? "").trim().split(/\s+/)[0] || null;

  /*
    Nepřečtené vzkazy — stejná RPC jako appka volá v layoutu pro
    zvoneček (`moje_rozhovory`), jen spočítaná ještě jednou tady. Sdílet
    číslo mezi serverovými komponentami by znamenalo protahovat ho přes
    kontext jen kvůli jedné kartě — dotaz navíc je levnější než to.
  */
  const { data: rozhovoryData } = await supabase
    .rpc("moje_rozhovory", { p_tenant: tenantId })
    .then((r) => ({ data: r.error ? null : (r.data as Rozhovor[] | null) }));
  const rozhovory = rozhovoryData ?? [];
  const neprecteneVzkazy = rozhovory.reduce((s, r) => s + r.neprectenych, 0);
  const maVedeniVzkaz = rozhovory.some((r) => r.druh === "vedeni" && r.neprectenych > 0);

  /*
    Poslední vzkazy — náhled pro Dnes (design systém, 16.9.2026,
    dvousloupcové rozvržení podle mockupu). `moje_rozhovory` výš dává
    jen počty, ne náhled textu, takže se sáhne rovnou na
    `konverzace_zpravy` — RLS (`je_ucastnik`) samo omezí na rozhovory,
    kde je přihlášený člověk účastník, stejně jako ve vlákně samotném
    (app/[rozsah]/vzkazy/[konverzace]/page.tsx). Stornované zprávy se
    tu na rozdíl od vlákna nezobrazují vůbec — v náhledu není místo na
    přeškrtnutý text s vysvětlením, jen by matlo.
  */
  const POSLEDNICH_VZKAZU = 4;
  const dotazNaPosledniVzkazy = (sloupce: string) =>
    supabase
      .from("konverzace_zpravy")
      .select(sloupce)
      .is("stornovano_kdy", null)
      .order("vytvoreno_kdy", { ascending: false })
      .limit(POSLEDNICH_VZKAZU);

  let { data: zpravyData, error: chybaVzkazu } = await dotazNaPosledniVzkazy(
    "id, autor, text, zvuk_cesta, vytvoreno_kdy",
  );
  // Sloupec z 20260917060000_hlasove_zpravy — dokud neproběhne migrací,
  // dotaz se zopakuje bez něj (stejný vzor jako jinde v appce).
  if (chybaVzkazu && sloupecNeexistuje(chybaVzkazu)) {
    ({ data: zpravyData, error: chybaVzkazu } = await dotazNaPosledniVzkazy(
      "id, autor, text, vytvoreno_kdy",
    ));
  }
  const posledniVzkazy: { id: string; jmeno: string; text: string; kdy: string }[] = [];
  if (zpravyData && zpravyData.length > 0) {
    const radky = zpravyData as unknown as {
      id: string; autor: string | null; text: string; zvuk_cesta?: string | null; vytvoreno_kdy: string;
    }[];
    const autoriIds = [...new Set(radky.map((z) => z.autor).filter((a): a is string => a !== null))];
    const { data: autoriData } = autoriIds.length > 0
      ? await supabase.from("employees").select("id, full_name").in("id", autoriIds)
      : { data: [] as { id: string; full_name: string }[] };
    const jmenaAutoru = new Map((autoriData ?? []).map((a) => [a.id as string, String(a.full_name ?? "").trim()]));
    for (const z of radky) {
      posledniVzkazy.push({
        id: z.id,
        jmeno: (z.autor ? jmenaAutoru.get(z.autor) : null) || "Někdo, kdo mezitím odešel",
        // Hlasovka nemá text (viz 20260917060000_hlasove_zpravy) —
        // bez týhle větve by náhled zůstal prázdný, jako by zpráva
        // nic neobsahovala.
        text: z.text || (z.zvuk_cesta ? "🎤 Hlasovka" : ""),
        // ZONA_VYCHOZI přímo, ne přes `zona` — ta se přiřazuje až ve
        // vykreslovací části níž, tady bychom na ni sáhli dřív, než
        // vznikne.
        kdy: hodinaVPasmu(z.vytvoreno_kdy, ZONA_VYCHOZI),
      });
    }
  }

  /*
    Otevřené úkoly — stejná tabulka/podmínky jako Úkoly a checklisty,
    jen bez checklistů (ty na jednu KPI kartu nesbalíš smysluplně).
    Karta se nekreslí vůbec bez `tasks.read` — ne prázdná, žádná.
  */
  let otevrenoUkolu = 0;
  let poTerminuUkolu = 0;
  if (canSee(ctx, "tasks.read")) {
    let dotazUkoly = supabase
      .from("tasks")
      .select("id, due_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "open");
    if (scope.level === "branch" && scope.branchId) {
      dotazUkoly = dotazUkoly.or(`branch_id.eq.${scope.branchId},branch_id.is.null`);
    }
    const { data: ukolyData, count } = await dotazUkoly;
    otevrenoUkolu = count ?? 0;
    const ted = new Date().toISOString();
    poTerminuUkolu = (ukolyData ?? []).filter(
      (u) => typeof u.due_at === "string" && u.due_at < ted,
    ).length;
  }

  /* --- 2b. OWNER ATTENTION CENTER ---------------------------------
     Jen pro vedení (jeVedeni) — zaměstnanec vidí Dnes beze změny,
     vedoucí/majitel NAVÍC uvidí, co potřebuje pozornost teď (master
     prompt, sekce 16-17). Jen REÁLNÁ data — appka nemá zdroj pro
     tržby/počasí/hodnocení, takže ty se sem nedávají. Zdroje níž jsou
     stejné dotazy/RPC jako na Docházce a ve Financích/Fakturách, jen
     souhrnně na jednom místě. Chyba v kterémkoli zdroji položku jen
     vynechá — nemá kvůli chybějící faktuře spadnout celá obrazovka. */

  type UrovenPozornosti = "critical" | "warning" | "info";
  type Pozornost = { uroven: UrovenPozornosti; text: string; akce: { popisek: string; href: string } };
  const pozornost: Pozornost[] = [];

  /*
    Tým dnes — kolik z naplánovaných je zrovna přítomno. Přítomnost je
    „otevřený příchod ke dnešnímu provoznímu dni" — TÁŽ RPC jako
    o pár řádků níž pro nedokončené záznamy, jen s rozsahem den–den
    místo 30denního okna. Je to schválně stejný zdroj: appka nemá mít
    čtvrtou definici „kdo je v práci" vedle muj_den/panelu/32denního
    hlášení (viz komentář u migrace 20260907010000_muj_den.sql).
  */
  let tymPritomno: string[] = [];

  if (jeVedeni(ctx)) {
    const pobockaProDochazku = scope.level === "branch" ? scope.branchId : null;

    const [nedokoncenaRes, fakturyRes, dnesRes] = await Promise.allSettled([
      supabase.rpc("nedokoncena_dochazka", {
        p_tenant: tenantId,
        p_od: posunDatum(den.provozni_den, -30),
        p_do: posunDatum(den.provozni_den, -1),
        p_branch: pobockaProDochazku,
      }),
      canSee(ctx, "faktury.read") && fakturyJsouNastavene()
        ? (async () => {
            const fakturySupabase = getFakturySupabase();
            const dnesniDatum = den.provozni_den;
            const [keKontrole, poSplatnosti] = await Promise.all([
              fakturySupabase.from("invoices").select("*", { count: "exact", head: true })
                .eq("is_archived", false).eq("needs_review", true),
              fakturySupabase.from("invoices").select("*", { count: "exact", head: true })
                .eq("is_archived", false).neq("status", STAV_UHRAZENO).neq("status", STAV_KE_SCHVALENI)
                .not("due_date", "is", null).lt("due_date", dnesniDatum),
            ]);
            return { keKontrole: keKontrole.count ?? 0, poSplatnosti: poSplatnosti.count ?? 0 };
          })()
        : Promise.resolve(null),
      supabase.rpc("nedokoncena_dochazka", {
        p_tenant: tenantId,
        p_od: den.provozni_den,
        p_do: den.provozni_den,
        p_branch: pobockaProDochazku,
      }),
    ]);

    if (dnesRes.status === "fulfilled" && !dnesRes.value.error) {
      tymPritomno = ((dnesRes.value.data ?? []) as { jmeno: string }[]).map((r) => r.jmeno);
    }

    if (nedokoncenaRes.status === "fulfilled" && !nedokoncenaRes.value.error) {
      const pocetNedokoncenych = (nedokoncenaRes.value.data ?? []).length;
      if (pocetNedokoncenych > 0) {
        pozornost.push({
          uroven: "warning",
          text: `${pocet(pocetNedokoncenych, "nedokončený příchod", "nedokončené příchody", "nedokončených příchodů")} za posledních 30 dní — chybí odchod.`,
          akce: { popisek: "Zkontrolovat docházku", href: `/${rozsah}/dochazka` },
        });
      }
    }

    if (fakturyRes.status === "fulfilled" && fakturyRes.value) {
      const { keKontrole, poSplatnosti } = fakturyRes.value;
      if (poSplatnosti > 0) {
        pozornost.push({
          uroven: "critical",
          text: `${pocet(poSplatnosti, "faktura je po splatnosti", "faktury jsou po splatnosti", "faktur je po splatnosti")}.`,
          akce: { popisek: "Zobrazit faktury", href: `/${rozsah}/finance/faktury/seznam` },
        });
      }
      if (keKontrole > 0) {
        pozornost.push({
          uroven: "info",
          text: `${pocet(keKontrole, "faktura čeká", "faktury čekají", "faktur čeká")} na kontrolu.`,
          akce: { popisek: "Zkontrolovat faktury", href: `/${rozsah}/finance/faktury/seznam?kontrola=1` },
        });
      }
    }
  }

  /* --- 2c. RYCHLÉ AKCE ---------------------------------------------
     Zástupci pro nejčastější „chci něco vytvořit/zapsat", každý
     schovaný za tímtéž oprávněním, jaké hlídá cílová obrazovka —
     odkaz, který vede na stránku beze smyslu, je horší než žádný. */

  type RychlaAkce = { popisek: string; href: string; ikona: React.ReactNode };
  const rychleAkce: RychlaAkce[] = [];
  if (canSee(ctx, "menu_ai.use")) {
    rychleAkce.push({ popisek: "Vytvořit nové menu", href: `/${rozsah}/menu`, ikona: <IkonaIkona d="M4 6h16M4 12h16M4 18h10" /> });
  }
  if (canSee(ctx, "marketing.read")) {
    rychleAkce.push({ popisek: "Nahrát fotky a obsah", href: `/${rozsah}/marketing/media`, ikona: <IkonaIkona d="M4 16l4.5-5 4 4 3-3 4.5 4.5M4 6h16v12H4z" /> });
  }
  if (canSee(ctx, "tasks.read")) {
    rychleAkce.push({ popisek: "Přidat úkol", href: `/${rozsah}/ukoly`, ikona: <IkonaIkona d="M5 12.5l3.5 3.5L19 6" /> });
  }
  if (canSee(ctx, "shifts.manage")) {
    rychleAkce.push({ popisek: "Zapsat směnu", href: `/${rozsah}/smeny`, ikona: <IkonaIkona d="M4 4.5h12v12H4zM7 2.5v4M13 2.5v4M4 8.5h12" /> });
  }
  if (canSee(ctx, "faktury.manage") && fakturyJsouNastavene()) {
    rychleAkce.push({ popisek: "Nová faktura", href: `/${rozsah}/finance/faktury/nova`, ikona: <IkonaIkona d="M5 3h7l4 4v13H5zM12 3v4h4M8 12h6M8 15h6" /> });
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const zona = ZONA_VYCHOZI;
  const platnyKod =
    typeof kod === "string" && /^[A-Za-z0-9]{8}$/.test(kod)
      ? kod.toUpperCase()
      : null;
  const vPraci = den.v_praci;
  const dalsiDruh = vPraci ? "out" : "in";
  const minutVPraci = den.minut_v_praci ?? 0;
  const zVcerejska =
    vPraci && den.den_prichodu !== null && den.den_prichodu < den.provozni_den;

  return (
    <div style={{ padding: "16px", paddingBottom: "32px", maxWidth: "1080px" }}>
      {/* ---------- KOMPAKTNÍ HLAVIČKA --------------------------
         UX redesign, druhé kolo (oddíl 5): dřív tu stál vysoký hero
         banner přes celou šířku — zabíral nejcennější plochu obrazovky
         na pozdrav, který se dá říct jedním řádkem. Fotka pobočky
         (kdo ji nahrál v Nastavení → Pobočky) teď žije jako malá
         značka vedle textu, ne jako celoplošné pozadí. */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: pozornost.length > 0 ? "16px" : "22px" }}>
        {heroFotoUrl ? (
          <img
            src={heroFotoUrl}
            alt=""
            aria-hidden="true"
            style={{ width: "44px", height: "44px", borderRadius: "var(--radius-md)", objectFit: "cover", flex: "none" }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{ width: "44px", height: "44px", borderRadius: "var(--radius-md)", flex: "none", background: "linear-gradient(135deg, var(--branch-fill), var(--branch))" }}
          />
        )}
        <div>
          <h1 style={{ margin: 0, fontSize: "25px", color: "var(--ink)" }}>
            {pozdrav(zona)}
            {krestni ? <>, {krestni}</> : null}
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>
            {denDlouze(den.provozni_den)}
            {den.pobocka_nazev ? ` · ${den.pobocka_nazev}` : ""}
          </p>
        </div>
      </div>

      {/* ---------- CO POTŘEBUJE VAŠI POZORNOST (jen vedení) ----
         Oddíl 5: první skutečně důležitý blok, ne schovaný pod
         čtyřmi kartami — proto stojí hned pod hlavičkou. */}
      {pozornost.length > 0 ? (
        <section style={{ marginBottom: "20px" }}>
          <p style={nadpisPozornosti}>Potřebuje vaši pozornost</p>
          <ul style={{ ...seznam, marginBottom: 0 }}>
            {pozornost.map((p, i) => (
              <Card
                key={i}
                as="li"
                padding="12px 14px"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  borderLeft: `3px solid ${barvaPozornosti(p.uroven)}`,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "var(--ink)" }}>
                  <Badge tone={tonPozornosti(p.uroven)}>{popisekUrovne(p.uroven)}</Badge>
                  {p.text}
                </span>
                <Link href={p.akce.href} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  {p.akce.popisek} →
                </Link>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- 4 PŘEHLEDOVÉ KARTY -------------------------- */}
        <div style={mrizkaKaret}>
          <StavovaKarta
            ikona={<IkonaIkona d="M5 12.5l3.5 3.5L19 6" />}
            tone={vPraci ? "success" : "neutral"}
            titulek="Docházka"
            hodnota={vPraci ? "Jste v práci" : "Nejste v práci"}
            popis={
              vPraci
                ? `od ${hodinaVPasmu(den.od_kdy as string, zona)} · ${trvani(minutVPraci)}`
                : dnesniSmena
                  ? `Dnes ${dnesniSmena.starts_at.slice(0, 5)}–${dnesniSmena.ends_at.slice(0, 5)}`
                  : "Dnes nemáte směnu"
            }
            odkaz={{ popisek: "Zobrazit docházku", href: `/${rozsah}/dochazka` }}
          />
          <StavovaKarta
            ikona={<IkonaIkona d="M4 4.5h12v12H4zM7 2.5v4M13 2.5v4M4 8.5h12" />}
            tone="neutral"
            titulek="Další směna"
            hodnota={
              dnesniSmena
                ? `Dnes ${dnesniSmena.starts_at.slice(0, 5)}–${dnesniSmena.ends_at.slice(0, 5)}`
                : pristi.length > 0
                  ? `${denCesky(pristi[0].shift_date)} od ${pristi[0].starts_at.slice(0, 5)}`
                  : "Zatím žádná"
            }
            popis={dnesniSmena ? (nazvyPobocek.get(dnesniSmena.branch_id) ?? "") : pristi.length > 0 ? (nazvyPobocek.get(pristi[0].branch_id) ?? "") : "Ani v příštích dnech"}
            odkaz={{ popisek: "Zobrazit rozpis", href: `/${rozsah}/smeny` }}
          />
          <StavovaKarta
            ikona={<IkonaIkona d="M3.5 5.5a2 2 0 012-2h9a2 2 0 012 2v6a2 2 0 01-2 2H8l-4 3.2V5.5z" />}
            tone={maVedeniVzkaz ? "danger" : neprecteneVzkazy > 0 ? "warning" : "neutral"}
            titulek="Vzkazy"
            hodnota={neprecteneVzkazy > 0 ? pocet(neprecteneVzkazy, "nová zpráva", "nové zprávy", "nových zpráv") : "Vše přečteno"}
            popis={maVedeniVzkaz ? "Nová zpráva z vedení" : neprecteneVzkazy > 0 ? "Čeká na přečtení" : undefined}
            odkaz={{ popisek: "Otevřít vzkazy", href: `/${rozsah}/vzkazy` }}
          />
          {canSee(ctx, "tasks.read") ? (
            <StavovaKarta
              ikona={<IkonaIkona d="M5 12.5l3.5 3.5L19 6" />}
              tone={poTerminuUkolu > 0 ? "danger" : otevrenoUkolu > 0 ? "neutral" : "success"}
              titulek="Úkoly"
              hodnota={otevrenoUkolu > 0 ? pocet(otevrenoUkolu, "otevřený úkol", "otevřené úkoly", "otevřených úkolů") : "Hotovo"}
              popis={poTerminuUkolu > 0 ? `${pocet(poTerminuUkolu, "po termínu", "po termínu", "po termínu")}` : undefined}
              odkaz={{ popisek: "Zobrazit úkoly", href: `/${rozsah}/ukoly` }}
            />
          ) : null}
        </div>

        <div className="ds-dvasloupec">
          <div>
            {/* ---------- KARTA, KTERÁ ODPOVÍDÁ ---------------------- */}
            <Card as="section" padding="18px" style={{ marginBottom: "24px" }}>
              {chyba === "kod" ? (
                <p className="hlaska-chyba">Opište prosím kód z tabletu.</p>
              ) : null}
              {chyba === "kod-vyprsel" ? (
                <p className="hlaska-chyba">
                  Kód už neplatí — mění se každou minutu. Načtěte prosím nový
                  z tabletu.
                </p>
              ) : null}
              {chyba === "pichnuti" && text ? (
                <p className="hlaska-chyba">{text}</p>
              ) : null}
              {pichnuto ? (
                <p style={hlaskaDobre} role="status">
                  {pichnuto === "in" ? "Příchod zapsán." : "Odchod zapsán."}
                </p>
              ) : null}
              {uzavreno ? (
                <p style={hlaskaDobre}>
                  Váš příchod z {uzavreno} zůstal bez odchodu. Vedoucí o tom ví
                  a doplní ho.
                </p>
              ) : null}

              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                {den.pobocka_nazev ?? "Vaše pobočka"}
              </p>

              {vPraci ? (
                <>
                  <h2 style={{ ...nadpisKarty, color: "var(--good)" }}>
                    Jste v práci
                  </h2>
                  <p style={podnadpis}>
                    od {hodinaVPasmu(den.od_kdy as string, zona)} ·{" "}
                    <strong>{trvani(minutVPraci)}</strong>
                  </p>
                  {/*
                    Otevřený příchod z dřívějška se NESCHOVÁVÁ. Je to buď
                    noční směna, nebo zapomenutý odchod — a v obou případech
                    to člověk potřebuje vidět právě proto, že to není dnešek.
                  */}
                  {zVcerejska ? (
                    <p style={{ ...podnadpis, color: "var(--warn)" }}>
                      Příchod je z {denCesky(den.den_prichodu as string)}, ne
                      z dneška.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <h2 style={nadpisKarty}>Nejste v práci</h2>
                  {dnesniSmena ? (
                    <>
                      <p style={podnadpis}>
                        Dnes {dnesniSmena.starts_at.slice(0, 5)}–
                        {dnesniSmena.ends_at.slice(0, 5)} ·{" "}
                        {nazvyPobocek.get(dnesniSmena.branch_id) ?? "jiná pobočka"}
                      </p>
                      {jmena.length > 0 ? (
                        <p style={podnadpis}>Na směně s vámi: {jmena.join(", ")}</p>
                      ) : null}
                    </>
                  ) : (
                    /*
                      Když dnes směna není, karta to řekne rovnou a hned
                      nabídne nejbližší příští. Prázdno by člověka nechalo
                      hledat jinde.
                    */
                    <p style={podnadpis}>
                      Dnes nemáte směnu.
                      {pristi.length > 0
                        ? ` Nejbližší ${denCesky(pristi[0].shift_date)} od ${pristi[0].starts_at.slice(0, 5)}.`
                        : " Ani v příštích dnech není žádná zadaná."}
                    </p>
                  )}
                </>
              )}

              {/*
                PÍCHNUTÍ JDE PŘES TUTÉŽ AKCI JAKO NA DOCHÁZCE.

                `zpet=dnes` říká jen to, kam se vrátit; ověřuje se to výčtem
                v akci, ne cestou z formuláře. Kód je pořád povinný a pořád
                patří jedné pobočce — pobočka se schválně neposílá.
              */}
              <form action={zapsatDochazku} style={{ marginTop: "16px" }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="druh" value={dalsiDruh} />
                <input type="hidden" name="zpet" value="dnes" />
                {/*
                  `PoleKodu` bere předvyplněný kód, ne příznak: sám si ho
                  po vykreslení z adresy uklidí, aby nezůstal v historii
                  prohlížeče. Tvar se ověřuje stejně jako na Docházce —
                  osm znaků, písmena a číslice; z adresy je to NÁVRH, ne
                  oprávnění, a platnost stejně rozhoduje databáze.
                */}
                <PoleKodu zQr={platnyKod} />
                <button
                  type="submit"
                  className="ft-tl ft-tl-hlavni"
                  style={{
                    width: "100%",
                    // Nejčastější úkon v aplikaci — dvakrát denně, ve spěchu,
                    // často jednou rukou. Musí se na něj trefit palec.
                    minHeight: "56px",
                    fontSize: "18px",
                    marginTop: "12px",
                  }}
                >
                  {vPraci ? "Píchnout odchod" : "Píchnout příchod"}
                </button>
              </form>
              <p style={{ ...podnadpis, fontSize: "12px", marginTop: "10px" }}>
                Kód je na tabletu na provozovně a mění se každou minutu.
              </p>
            </Card>

            {/* ---------- DNEŠNÍ ROZPIS + POSLEDNÍ VZKAZY, VEDLE SEBE ---
               Design systém, 16.9.2026 (dvousloupcové rozvržení podle
               mockupu). Dvě samostatné, nezávislé sekce — sloupec se
               na užší obrazovce zalomí sám (auto-fit), žádný nový
               zlom navíc. Ani jedna nekreslí nic, když nemá co. */}
            {dnesniRozpis.length > 0 || posledniVzkazy.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", alignItems: "start" }}>
                {dnesniRozpis.length > 0 ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
                      <h2 style={{ ...nadpisSekce, margin: 0 }}>Dnes v rozpisu</h2>
                      <Link href={`/${rozsah}/smeny`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                        Zobrazit celý rozpis →
                      </Link>
                    </div>
                    <ul style={seznam}>
                      {dnesniRozpis.map((s) => (
                        <Card
                          key={s.id}
                          as="li"
                          padding="10px 14px"
                          style={{ position: "relative", paddingLeft: "18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", fontSize: "14px", color: "var(--ink)" }}
                        >
                          {s.barva ? (
                            <span
                              aria-hidden="true"
                              data-osoba={s.barva}
                              style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "4px", borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)", background: "var(--osoba)" }}
                            />
                          ) : null}
                          <span>{s.jmeno}</span>
                          <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                            {s.od}–{s.do}
                          </span>
                        </Card>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {posledniVzkazy.length > 0 ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
                      <h2 style={{ ...nadpisSekce, margin: 0 }}>Poslední vzkazy</h2>
                      <Link href={`/${rozsah}/vzkazy`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                        Zobrazit všechny →
                      </Link>
                    </div>
                    <ul style={seznam}>
                      {posledniVzkazy.map((z) => (
                        <Card key={z.id} as="li" padding="10px 14px" style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                          <span
                            aria-hidden="true"
                            style={{
                              flex: "none", width: "28px", height: "28px", borderRadius: "50%",
                              background: "var(--sunken)", color: "var(--muted)",
                              display: "grid", placeItems: "center", fontSize: "11px", fontWeight: 600,
                            }}
                          >
                            {initialy(z.jmeno)}
                          </span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13.5px", color: "var(--ink)", fontWeight: 600 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.jmeno}</span>
                              <span style={{ flex: "none", color: "var(--muted)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>{z.kdy}</span>
                            </span>
                            <span
                              style={{
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                overflow: "hidden", fontSize: "13px", color: "var(--muted)", marginTop: "2px",
                              }}
                            >
                              {z.text}
                            </span>
                          </span>
                        </Card>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---------- PŘÍŠTÍ SMĚNY ------------------------------- */}
            <h2 style={nadpisSekce}>Příští směny</h2>
            {pristi.length === 0 ? (
              <p style={prazdno}>Zatím nemáte zadanou žádnou další směnu.</p>
            ) : (
              <ul style={seznam}>
                {pristi.map((s) => (
                  <Card key={s.id} as="li" padding="12px 14px" style={{ fontSize: "14px", color: "var(--ink)" }}>
                    <strong>{denCesky(s.shift_date)}</strong>{" "}
                    {s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)} ·{" "}
                    {nazvyPobocek.get(s.branch_id) ?? "jiná pobočka"}
                  </Card>
                ))}
              </ul>
            )}
          </div>

          {/* ---------- POSTRANNÍ PANEL ----------------------------- */}
          <div>
            {jeVedeni(ctx) && dnesniRozpis.length > 0 ? (
              <>
                <h2 style={nadpisSekce}>Tým dnes</h2>
                <Card padding="16px" style={{ marginBottom: "24px" }}>
                  <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--ink)" }}>
                    {tymPritomno.length} / {new Set(dnesniRozpis.map((s) => s.employeeId)).size}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: "2px" }}>
                    zaměstnanců přítomno
                  </div>
                  {tymPritomno.length > 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "10px", lineHeight: 1.6 }}>
                      {tymPritomno.join(", ")}
                    </div>
                  ) : null}
                  <Link href={`/${rozsah}/dochazka`} className="ft-tl ft-tl-vedlejsi ft-tl-male" style={{ marginTop: "10px", display: "inline-block" }}>
                    Zobrazit docházku →
                  </Link>
                </Card>
              </>
            ) : null}

            {pocasi ? (
              <Card
                padding="12px 14px"
                style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}
              >
                <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>
                  Počasí{den.pobocka_nazev ? ` – ${den.pobocka_nazev}` : ""}
                </span>
                <span style={{ marginLeft: "auto", fontSize: "15px", fontWeight: 600, color: "var(--ink)" }}>
                  {pocasi.teplotaC}°C
                </span>
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>{pocasi.stavPocasi}</span>
              </Card>
            ) : null}

            {rychleAkce.length > 0 ? (
              <>
                <h2 style={nadpisSekce}>Rychlé akce</h2>
                <ul style={{ ...seznam, marginBottom: "24px" }}>
                  {rychleAkce.map((a) => (
                    <Card key={a.href + a.popisek} as="li" padding="0">
                      <Link
                        href={a.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "12px 14px",
                          fontSize: "14px",
                          color: "var(--ink)",
                          textDecoration: "none",
                        }}
                      >
                        <span aria-hidden="true" style={{ color: "var(--mosaz)", display: "flex" }}>
                          {a.ikona}
                        </span>
                        {a.popisek}
                        <span style={{ marginLeft: "auto", color: "var(--muted)" }} aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </Card>
                  ))}
                </ul>
              </>
            ) : null}

            <h2 style={nadpisSekce}>Kam dál</h2>
            <ul style={seznam}>
              <Card as="li" padding="12px 14px" style={{ fontSize: "14px", color: "var(--ink)" }}>
                <Link href={`/${rozsah}/dochazka`} style={odkaz}>
                  Tenhle měsíc — odpracováno, hrubá mzda, zálohy
                </Link>
              </Card>
              <Card as="li" padding="12px 14px" style={{ fontSize: "14px", color: "var(--ink)" }}>
                <Link href={`/${rozsah}/ukoly`} style={odkaz}>
                  Úkoly a checklisty
                </Link>
              </Card>
            </ul>

            {/*
              Citát — čistě značková ozdoba (design systém, 16.9.2026,
              podle mockupu), ne tvrzení o datech. Proto stojí jasně
              podepsaný "Foodtab", ne jako by šlo o vyjádření KONKRÉTNÍ
              provozovny nebo zákazníka — to by bylo totéž předstírání,
              kterému se vyhýbá hero fotka (viz komentář výš).
            */}
            <Card padding="16px 18px" style={{ marginTop: "24px" }}>
              <p style={{ margin: 0, fontSize: "14.5px", fontStyle: "italic", color: "var(--ink)", lineHeight: 1.5 }}>
                „Dobrá restaurace stojí na skvělém týmu.“
              </p>
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--muted)" }}>— Foodtab</p>
            </Card>

            {/*
              Push do mobilu zatím nechodí a NEPÍŠE SE, že chodí. Věta,
              která není pravda, je horší než žádná: člověk by na ni
              spoléhal.
            */}
            <p style={{ ...prazdno, fontSize: "12px" }}>
              Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím
              nechodí.
            </p>
          </div>
        </div>
      </div>
  );
}


/** Iniciály ze jména pro kolečko u náhledu vzkazu — první písmeno
 * prvních dvou slov, nebo první dvě písmena jednoho slova. */
function initialy(jmeno: string): string {
  const slova = jmeno.split(/\s+/).filter(Boolean);
  if (slova.length >= 2) return (slova[0][0] + slova[1][0]).toUpperCase();
  return (jmeno.slice(0, 2) || "?").toUpperCase();
}

/** Pozdrav podle denní doby v pásmu appky — žádné vymyšlené jméno dne. */
function pozdrav(zona: string): string {
  const hodina = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: zona }).format(new Date()),
  );
  if (hodina < 5) return "Dobrou noc";
  if (hodina < 10) return "Dobré ráno";
  if (hodina < 17) return "Dobré odpoledne";
  if (hodina < 22) return "Dobrý večer";
  return "Dobrou noc";
}

/** „Neděle 14. září" — provozní datum, bez roku u letošního. */
function denDlouze(datum: string): string {
  const [, m, d] = datum.split("-").map(Number);
  const dny = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
  // `datum` je provozní DATUM bez pásma — nepouštět přes `new Date()` se
  // stringem, ať se den v týdnu neposune. Sestaví se z jednotlivých čísel.
  const den = new Date(Date.UTC(Number(datum.slice(0, 4)), m - 1, d));
  return `${dny[den.getUTCDay()]} ${d}. ${MESICE[m - 1]}`;
}
const MESICE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

/**
 * Jedna ze 4 přehledových karet nahoře.
 *
 * UX redesign, druhé kolo (oddíl 5): dřív každá nesla vlastní velké
 * vedlejší tlačítko dole — čtyři tlačítka vedle sebe na obrazovce,
 * která má být souhrn, ne rozcestník. Celá karta je teď odkaz, malá
 * šipka v rohu jen naznačuje, že se dá otevřít.
 */
function StavovaKarta({
  ikona,
  tone,
  titulek,
  hodnota,
  popis,
  odkaz,
}: {
  ikona: React.ReactNode;
  tone: "success" | "warning" | "danger" | "neutral";
  titulek: string;
  hodnota: string;
  popis?: string;
  odkaz: { popisek: string; href: string };
}) {
  const barva =
    tone === "success" ? "var(--dobre)" : tone === "warning" ? "var(--pozor)" : tone === "danger" ? "var(--bad)" : "var(--mosaz)";
  const pozadi =
    tone === "success" ? "var(--dobre-bg)" : tone === "warning" ? "var(--pozor-bg)" : tone === "danger" ? "var(--bad-bg)" : "var(--sunken)";

  return (
    <Link
      href={odkaz.href}
      style={{
        background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)",
        padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px",
        textDecoration: "none", color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          aria-hidden="true"
          style={{
            width: "26px", height: "26px", borderRadius: "var(--radius-sm)",
            background: pozadi, color: barva,
            display: "grid", placeItems: "center", flex: "none",
          }}
        >
          {ikona}
        </span>
        <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}>{titulek}</span>
        <span aria-hidden="true" style={{ marginLeft: "auto", color: "var(--faint)", fontSize: "13px" }}>→</span>
      </div>
      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--ink)" }}>{hodnota}</div>
      {popis ? <div style={{ fontSize: "12px", color: tone === "danger" ? "var(--bad)" : "var(--muted)" }}>{popis}</div> : null}
    </Link>
  );
}

/** Drobná ikona pro Rychlé akce a přehledové karty — obrys 20×20, stejný styl jako app/[rozsah]/ikona.tsx. */
function IkonaIkona({ d }: { d: string }) {
  return (
    <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true" style={{ width: "17px", height: "17px" }}>
      <path d={d} />
    </svg>
  );
}

/** Barva pruhu na kartě „Co potřebuje pozornost" podle závažnosti. */
function barvaPozornosti(uroven: "critical" | "warning" | "info"): string {
  if (uroven === "critical") return "var(--bad)";
  if (uroven === "warning") return "var(--pozor)";
  return "var(--mosaz)";
}

/** Odstín štítku (Badge) podle závažnosti — viz components/ui/Badge.tsx. */
function tonPozornosti(uroven: "critical" | "warning" | "info"): "danger" | "warning" | "accent" {
  if (uroven === "critical") return "danger";
  if (uroven === "warning") return "warning";
  return "accent";
}

function popisekUrovne(uroven: "critical" | "warning" | "info"): string {
  if (uroven === "critical") return "Kritické";
  if (uroven === "warning") return "Pozor";
  return "Info";
}

/** „4 h 12 min", ne „252". */
function trvani(minut: number): string {
  const h = Math.floor(minut / 60);
  const m = minut % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/**
 * Datum česky, bez roku u letošního.
 *
 * `shift_date` je provozní DATUM (`date`), ne okamžik — nemá pásmo
 * a žádné se k němu nedodává. Kdyby se protáhlo přes `new Date()`
 * a formátovalo v pásmu, posunulo by se o den zpátky všude východně
 * od Greenwiche.
 */
function denCesky(datum: string): string {
  const [, m, d] = datum.split("-");
  return `${Number(d)}. ${Number(m)}.`;
}

const nadpisPozornosti = {
  margin: "0 0 8px",
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  color: "var(--muted)",
} as const;

const mrizkaKaret = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: "10px",
  margin: "0 0 22px",
} as const;

const nadpisKarty = {
  margin: "4px 0 0",
  fontSize: "22px",
  color: "var(--ink)",
} as const;

const podnadpis = {
  margin: "6px 0 0",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "var(--muted)",
} as const;

const nadpisSekce = {
  margin: "0 0 10px",
  fontSize: "15px",
  color: "var(--muted)",
} as const;

const seznam = {
  listStyle: "none",
  margin: "0 0 24px",
  padding: 0,
  display: "grid",
  gap: "8px",
} as const;

const odkaz = {
  color: "var(--branch)",
  textDecoration: "none",
} as const;

const prazdno = {
  margin: "0 0 24px",
  fontSize: "14px",
  color: "var(--muted)",
} as const;

const hlaskaDobre = {
  margin: "0 0 12px",
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  background: "var(--dobre-bg)",
  border: "1px solid var(--dobre-bg)",
  fontSize: "14px",
  color: "var(--dobre)",
  fontWeight: 600,
} as const;

const ramecek = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "14px",
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.5,
} as const;
