import Link from "next/link";
import { redirect } from "next/navigation";

import { canSee, getContext, getUser, jeVedeni } from "@/lib/authz";
import { barvaNeboNic } from "@/lib/barvy-lidi";
import { denVPasmu, hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { osloveni } from "@/lib/osloveni";
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
import { NAZVY_DRUHU } from "../vzkazy/seznam-rozhovoru";
import {
  Citat,
  Hero,
  KpiKarta,
  KpiOdkaz,
  PanelHlava,
  PanelRozpisu,
  PanelVzkazu,
  PocasiKarta,
  RychleAkce,
  TymDnes,
  type DenRozpisu,
  type RadekSmeny,
  type RychlaAkceProp,
  type VzkazNahled,
} from "./prvky";

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
 *
 * ---------------------------------------------------------------------
 * PŘESTAVBA 19.9.2026 — nový mockup Šéfíka (docs/vzhled-dnes-mockup-2026-09-19.webp)
 *
 * Banner přes celou šířku je zpět (16.9. ho druhé kolo zmenšilo na
 * značku), karty mají ikonu a tlačítko dole, rozpis má proužek dnů, pod
 * ním jména s pozicí a barevným časem, vpravo boční panel. Vzhled je
 * v `./prvky.tsx` a `app/_komponenty.css` (třídy `ds-*`) a platí jako
 * PRAVIDLO pro všechna okna — viz docs/vzhled-zadani.md.
 *
 * ČEHO SE MOCKUP DOTÝKÁ A ZDE SE NEKRESLÍ: „Rychlý přehled" dole
 * (tržby, online objednávky, hodnocení Google). Appka na to nemá zdroj
 * dat a čísla se nevymýšlejí — viz výše. Stejně tak chybí věta „Ideální
 * den na zahrádku" u počasí: byla by to domněnka, ne údaj.
 */

const PRISTICH_SMEN = 3;
/** Kolik dní dopředu ukazuje proužek rozpisu (dnešek + šest dalších). */
const DNU_V_PROUZKU = 7;
/** Kolik řádků směn se vejde pod proužek; zbytek je odkaz na celý rozpis. */
const RADKU_ROZPISU = 8;
const POSLEDNICH_VZKAZU = 4;
/** Zkratky dnů podle `getUTCDay()` (0 = neděle) — stejné pořadí jako v Rozpisu. */
const DNY_ZKRATKY = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

type Smena = {
  id: string;
  branch_id: string;
  employee_id: string | null;
  position_id: string | null;
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

type Rozhovor = {
  konverzace_id: string;
  druh: string;
  branch_id: string | null;
  nazev: string | null;
  neprectenych: number;
};

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
    den?: string;
  }>;
}) {
  const { rozsah } = await params;
  const { chyba, text, pichnuto, uzavreno, kod, den: denZAdresy } = await searchParams;

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
    .select("id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at")
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
    Rozpis na týden dopředu, barevně — jen s `shifts.read` (stejné právo,
    jaké hlídá Rozpis směn). Dřív se jen filtroval dnešek z `smeny` výš,
    jenže ta má strop 200 řádků přes všechny dny a firmy: počty lidí na
    pozdější dny v proužku by tiše vycházely nižší. Proto vlastní dotaz na
    okno dnešek + 6 dní, na pobočce jen její směny.

    Jména, barvy a pozice se dotahují TÝMŽ způsobem jako v
    app/[rozsah]/smeny/page.tsx (`barvaNeboNic`, tabulka `positions`), ať
    barva člověka a název pozice na Dnes a v Rozpisu vždycky sedí.
  */
  const smiCistRozpis = canSee(ctx, "shifts.read");
  const dnyProuzku = Array.from({ length: DNU_V_PROUZKU }, (_, i) => posunDatum(den.provozni_den, i));
  const vybranyDen =
    typeof denZAdresy === "string" && dnyProuzku.includes(denZAdresy) ? denZAdresy : den.provozni_den;

  let smenyProuzku: Smena[] = [];
  if (smiCistRozpis) {
    let dotazProuzek = supabase
      .from("shifts")
      .select("id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at")
      .eq("tenant_id", tenantId)
      .gte("shift_date", dnyProuzku[0])
      .lte("shift_date", dnyProuzku[DNU_V_PROUZKU - 1])
      .neq("status", "cancelled")
      .order("shift_date", { ascending: true })
      .order("starts_at", { ascending: true })
      .limit(1000);
    if (scope.level === "branch" && scope.branchId) {
      dotazProuzek = dotazProuzek.eq("branch_id", scope.branchId);
    }
    const { data: prouzekData, error: chybaProuzku } = await dotazProuzek;
    if (chybaProuzku) throw new DotazSelhal("rozpis na týden dopředu", chybaProuzku);
    smenyProuzku = (prouzekData ?? []) as Smena[];
  }

  const lidiPoDnech = new Map<string, Set<string>>();
  for (const s of smenyProuzku) {
    if (s.employee_id === null) continue;
    const mnozina = lidiPoDnech.get(s.shift_date) ?? new Set<string>();
    mnozina.add(s.employee_id);
    lidiPoDnech.set(s.shift_date, mnozina);
  }
  const smenyVybranehoDne = smenyProuzku.filter((s) => s.shift_date === vybranyDen && s.employee_id !== null);
  const planovanoDnes = lidiPoDnech.get(den.provozni_den)?.size ?? 0;

  // Moje příští směna může mít pozici, stejně jako řádky rozpisu.
  const dalsiSmena = dnesniSmena ?? pristi[0] ?? null;
  const idLidiVRozpisu = [...new Set(smenyVybranehoDne.map((s) => s.employee_id as string))];
  const idPozic = [
    ...new Set(
      [...smenyVybranehoDne, ...(dalsiSmena ? [dalsiSmena] : [])]
        .map((s) => s.position_id)
        .filter((i): i is string => !!i),
    ),
  ];

  const lidiVRozpisu = new Map<string, { jmeno: string; barva: string | null }>();
  if (idLidiVRozpisu.length > 0) {
    const { data: lideDnes, error: chybaLideDnes } = await supabase
      .from("employees")
      .select("id, full_name, color")
      .in("id", idLidiVRozpisu);
    if (chybaLideDnes) throw new DotazSelhal("lidé v rozpisu", chybaLideDnes);
    for (const c of lideDnes ?? []) {
      lidiVRozpisu.set(c.id as string, { jmeno: String(c.full_name ?? "").trim() || "?", barva: barvaNeboNic(c.color) });
    }
  }

  const nazvyPozic = new Map<string, string>();
  if (idPozic.length > 0) {
    const { data: poziceData } = await supabase.from("positions").select("id, label").in("id", idPozic);
    for (const p of poziceData ?? []) nazvyPozic.set(p.id as string, String(p.label ?? ""));
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
  const dotazNaPosledniVzkazy = (sloupce: string) =>
    supabase
      .from("konverzace_zpravy")
      .select(sloupce)
      .is("stornovano_kdy", null)
      .order("vytvoreno_kdy", { ascending: false })
      .limit(POSLEDNICH_VZKAZU);

  /*
    Sloupce přibývaly migracemi: `zvuk_cesta` (20260917060000) a
    `priorita` (20260917040000). Dokud kterákoli neproběhne, dotaz na ni
    selže — zkouší se proto od nejúplnějšího výběru k nejskromnějšímu
    a obrazovka pokračuje s tím, co databáze umí (stejný vzor jako jinde).
  */
  const VYBERY_VZKAZU = [
    "id, konverzace_id, autor, text, zvuk_cesta, priorita, vytvoreno_kdy",
    "id, konverzace_id, autor, text, zvuk_cesta, vytvoreno_kdy",
    "id, konverzace_id, autor, text, vytvoreno_kdy",
  ];
  let zpravyData: unknown[] | null = null;
  for (const vyber of VYBERY_VZKAZU) {
    const { data: d, error: e } = await dotazNaPosledniVzkazy(vyber);
    if (e && sloupecNeexistuje(e)) continue;
    zpravyData = e ? null : (d as unknown[] | null);
    break;
  }

  const kalendarniDnes = denVPasmu(new Date(), ZONA_VYCHOZI);
  const kdyKratce = (iso: string): string => {
    const d = denVPasmu(iso, ZONA_VYCHOZI);
    if (d === kalendarniDnes) return hodinaVPasmu(iso, ZONA_VYCHOZI);
    if (d === posunDatum(kalendarniDnes, -1)) return "Včera";
    const [, m, dd] = d.split("-");
    return `${Number(dd)}. ${Number(m)}.`;
  };
  const nazevRozhovoru = (id: string): { nazev: string; druh: string } => {
    const r = rozhovory.find((x) => x.konverzace_id === id);
    if (!r) return { nazev: "Rozhovor", druh: "" };
    const nazev =
      r.nazev ??
      (r.branch_id
        ? (nazvyPobocek.get(r.branch_id) ?? "Jiná pobočka")
        : ((NAZVY_DRUHU as Record<string, string>)[r.druh] ?? "Rozhovor"));
    return { nazev, druh: r.druh };
  };

  const posledniVzkazy: VzkazNahled[] = [];
  if (zpravyData && zpravyData.length > 0) {
    const radky = zpravyData as {
      id: string;
      konverzace_id: string;
      autor: string | null;
      text: string;
      zvuk_cesta?: string | null;
      priorita?: string | null;
      vytvoreno_kdy: string;
    }[];
    const autoriIds = [...new Set(radky.map((z) => z.autor).filter((a): a is string => a !== null))];
    const { data: autoriData } = autoriIds.length > 0
      ? await supabase.from("employees").select("id, full_name").in("id", autoriIds)
      : { data: [] as { id: string; full_name: string }[] };
    const jmenaAutoru = new Map((autoriData ?? []).map((a) => [a.id as string, String(a.full_name ?? "").trim()]));
    for (const z of radky) {
      const { nazev, druh } = nazevRozhovoru(z.konverzace_id);
      posledniVzkazy.push({
        id: z.id,
        konverzaceId: z.konverzace_id,
        druh,
        nazev,
        inicialy: initialy(nazev),
        autor: (z.autor ? jmenaAutoru.get(z.autor) : null) || "Někdo, kdo mezitím odešel",
        // Hlasovka nemá text (viz 20260917060000_hlasove_zpravy) —
        // bez týhle větve by náhled zůstal prázdný, jako by zpráva
        // nic neobsahovala.
        text: z.text || (z.zvuk_cesta ? "Hlasová zpráva" : ""),
        kdy: kdyKratce(z.vytvoreno_kdy),
        naleha: z.priorita === "urgent",
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

  const rychleAkce: RychlaAkceProp[] = [];
  if (canSee(ctx, "menu_ai.use")) {
    rychleAkce.push({ popisek: "Vytvořit nové menu", href: `/${rozsah}/menu`, ikona: "seznam" });
  }
  if (canSee(ctx, "marketing.read")) {
    rychleAkce.push({ popisek: "Nahrát fotky a obsah", href: `/${rozsah}/marketing/media`, ikona: "fotka" });
  }
  if (canSee(ctx, "tasks.read")) {
    // Míří na formulář v Úkolech — kotva je na formuláři uvnitř `details`,
    // takže ho prohlížeč sám rozbalí (viz komentář v ukoly/page.tsx).
    rychleAkce.push({ popisek: "Přidat úkol", href: `/${rozsah}/ukoly#zadat-ukol`, ikona: "fajfkaCtverec" });
  }
  if (canSee(ctx, "shifts.manage")) {
    rychleAkce.push({ popisek: "Zapsat směnu", href: `/${rozsah}/smeny`, ikona: "kalendar" });
  }
  if (canSee(ctx, "faktury.manage") && fakturyJsouNastavene()) {
    rychleAkce.push({ popisek: "Nová faktura", href: `/${rozsah}/finance/faktury/nova`, ikona: "faktura" });
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

  const oslovene = osloveni(krestni) || null;

  /*
    Kód z tabletu zůstává POVINNÝ — píchnutí jde pořád přes `zapsatDochazku`
    a pořád ho ověřuje databáze. Karta má jen tlačítko, po jehož rozbalení
    se ukáže políčko. Rozbalená je rovnou, když se právě něco stalo
    (chybný kód, hláška z akce) nebo kód přišel z naskenovaného QR — jinak
    by člověk po chybě viděl zavřenou kartu a nevěděl proč.
  */
  const otevritPichnuti =
    chyba === "kod" || chyba === "kod-vyprsel" || (chyba === "pichnuti" && !!text) || platnyKod !== null;

  const popisyDochazky: (string | null)[] = vPraci
    ? [
        `od ${hodinaVPasmu(den.od_kdy as string, zona)} · ${trvani(minutVPraci)}`,
        zVcerejska ? `Příchod je z ${denCesky(den.den_prichodu as string)}, ne z dneška.` : null,
      ]
    : dnesniSmena
      ? [
          `Dnes ${dnesniSmena.starts_at.slice(0, 5)}–${dnesniSmena.ends_at.slice(0, 5)}`,
          // Jen jména, nic víc — viz docs/dnes-obrazovka-zadani.md, oddíl 6.
          jmena.length > 0 ? `Na směně s vámi: ${jmena.join(", ")}` : null,
        ]
      : [
          "Dnes nemáte směnu.",
          pristi.length > 0
            ? `Nejbližší ${denCesky(pristi[0].shift_date)} od ${pristi[0].starts_at.slice(0, 5)}.`
            : "Ani v příštích dnech není žádná zadaná.",
        ];

  const casSmeny = (s: Smena) => `${s.starts_at.slice(0, 5)} – ${s.ends_at.slice(0, 5)}`;
  const dalsiHodnota = dnesniSmena
    ? `Dnes ${casSmeny(dnesniSmena)}`
    : pristi[0]
      ? `${denCesky(pristi[0].shift_date)} ${casSmeny(pristi[0])}`
      : "Zatím žádná";

  const vsechnyRadky: RadekSmeny[] = smenyVybranehoDne
    .map((s) => {
      const clovek = lidiVRozpisu.get(s.employee_id as string);
      const jmeno = clovek?.jmeno ?? "?";
      return {
        id: s.id,
        jmeno,
        inicialy: initialy(jmeno),
        barva: clovek?.barva ?? null,
        pozice: s.position_id ? (nazvyPozic.get(s.position_id) ?? null) : null,
        pobocka: scope.level === "tenant" ? (nazvyPobocek.get(s.branch_id) ?? null) : null,
        od: s.starts_at.slice(0, 5),
        do: s.ends_at.slice(0, 5),
      };
    })
    .sort((a, b) => a.od.localeCompare(b.od) || a.jmeno.localeCompare(b.jmeno, "cs"));
  const radkyRozpisu = vsechnyRadky.slice(0, RADKU_ROZPISU);

  const dnyRozpisu: DenRozpisu[] = dnyProuzku.map((datum) => {
    const dow = new Date(Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)))).getUTCDay();
    return {
      datum,
      zkratka: `${DNY_ZKRATKY[dow]} ${Number(datum.slice(8, 10))}. ${Number(datum.slice(5, 7))}.`,
      pocet: lidiPoDnech.get(datum)?.size ?? 0,
      vikend: dow === 0 || dow === 6,
      vybrany: datum === vybranyDen,
      href: datum === den.provozni_den ? `/${rozsah}/dnes` : `/${rozsah}/dnes?den=${datum}`,
    };
  });

  const nadpisRozpisu = scope.level === "branch" && scope.branchName ? `Rozpis směn – ${scope.branchName}` : "Rozpis směn";

  const panelPristichSmen = (
    <section className="ds-plocha" aria-label="Příští směny">
      <PanelHlava ikona="kalendar" nadpis="Příští směny" />
      {pristi.length === 0 ? (
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>Zatím nemáte zadanou žádnou další směnu.</p>
      ) : (
        <ul style={{ ...seznam, margin: 0 }}>
          {pristi.map((s) => (
            <li key={s.id} style={{ fontSize: "14px", color: "var(--ink)" }}>
              <strong>{denCesky(s.shift_date)}</strong> {casSmeny(s)} · {nazvyPobocek.get(s.branch_id) ?? "jiná pobočka"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div style={{ padding: "16px", paddingBottom: "32px", maxWidth: "1480px" }}>
      {/* ---------- HERO ------------------------------------------
         Mockup Šéfíka z 19.9.2026 vrátil banner přes celou šířku (druhé
         kolo UX redesignu ho 16.9. zmenšilo na malou značku). Fotku
         nahrává pobočka v Nastavení → Pobočky; bez ní zůstane barva. */}
      <Hero
        datum={denDlouze(den.provozni_den)}
        pozdrav={pozdrav(zona)}
        oslovene={oslovene}
        popis="Tady je přehled dnešního dne."
        fotoUrl={heroFotoUrl}
      />

      <div className="ds-dnes" style={{ marginTop: "22px" }}>
        <div className="ds-dnes-hlavni">
          {/* ---------- CO POTŘEBUJE VAŠI POZORNOST (jen vedení) ----
             První skutečně důležitý blok, ne schovaný pod kartami. */}
          {pozornost.length > 0 ? (
            <section>
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

          {/* ---------- ČTYŘI PŘEHLEDOVÉ KARTY ---------------------- */}
          <div className="ds-kpi-mrizka">
            <KpiKarta
              ikona="fajfkaKruh"
              ton="dobre"
              titulek="Docházka"
              hodnota={vPraci ? "Jste v práci" : "Nejste v práci"}
              popisy={popisyDochazky}
              paticka={
                /*
                  PÍCHNUTÍ JDE PŘES TUTÉŽ AKCI JAKO NA DOCHÁZCE.

                  `zpet=dnes` říká jen to, kam se vrátit; ověřuje se to výčtem
                  v akci, ne cestou z formuláře. Kód je pořád povinný a pořád
                  patří jedné pobočce — pobočka se schválně neposílá. `PoleKodu`
                  bere předvyplněný kód z QR a sám si ho z adresy uklidí.
                */
                <details className="ds-pichnuti" open={otevritPichnuti}>
                  <summary className="ft-tl ft-tl-hlavni">
                    {vPraci ? "Píchnout odchod" : "Píchnout příchod"} →
                  </summary>
                  <form action={zapsatDochazku}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="druh" value={dalsiDruh} />
                    <input type="hidden" name="zpet" value="dnes" />
                    <PoleKodu zQr={platnyKod} />
                    <button
                      type="submit"
                      className="ft-tl ft-tl-hlavni"
                      style={{
                        width: "100%",
                        // Nejčastější úkon v aplikaci — dvakrát denně, ve spěchu,
                        // často jednou rukou. Musí se na něj trefit palec.
                        minHeight: "56px",
                        fontSize: "17px",
                        marginTop: "10px",
                      }}
                    >
                      {vPraci ? "Zapsat odchod" : "Zapsat příchod"}
                    </button>
                    <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                      Kód je na tabletu na provozovně a mění se každou minutu.
                    </p>
                  </form>
                </details>
              }
            >
              {chyba === "kod" ? <p className="hlaska-chyba">Opište prosím kód z tabletu.</p> : null}
              {chyba === "kod-vyprsel" ? (
                <p className="hlaska-chyba">
                  Kód už neplatí — mění se každou minutu. Načtěte prosím nový z tabletu.
                </p>
              ) : null}
              {chyba === "pichnuti" && text ? <p className="hlaska-chyba">{text}</p> : null}
              {pichnuto ? (
                <p style={hlaskaDobre} role="status">
                  {pichnuto === "in" ? "Příchod zapsán." : "Odchod zapsán."}
                </p>
              ) : null}
              {uzavreno ? (
                <p style={hlaskaDobre}>
                  Váš příchod z {uzavreno} zůstal bez odchodu. Vedoucí o tom ví a doplní ho.
                </p>
              ) : null}
            </KpiKarta>

            <KpiKarta
              ikona="kalendar"
              ton="info"
              titulek="Další směna"
              hodnota={dalsiHodnota}
              popisy={
                dalsiSmena
                  ? [
                      dalsiSmena.position_id ? (nazvyPozic.get(dalsiSmena.position_id) ?? null) : null,
                      nazvyPobocek.get(dalsiSmena.branch_id) ?? null,
                    ]
                  : ["Ani v příštích dnech"]
              }
              paticka={<KpiOdkaz href={`/${rozsah}/smeny`} popisek="Zobrazit rozpis" />}
            />

            <KpiKarta
              ikona="zprava"
              ton={maVedeniVzkaz ? "bad" : "pozor"}
              odznak={neprecteneVzkazy}
              titulek="Vzkazy"
              hodnota={neprecteneVzkazy > 0 ? pocet(neprecteneVzkazy, "nová zpráva", "nové zprávy", "nových zpráv") : "Vše přečteno"}
              popisy={[maVedeniVzkaz ? "Nová zpráva z vedení" : neprecteneVzkazy > 0 ? "Čeká na přečtení" : null]}
              popisTon={maVedeniVzkaz ? "bad" : undefined}
              paticka={<KpiOdkaz href={`/${rozsah}/vzkazy`} popisek="Otevřít vzkazy" />}
            />

            {canSee(ctx, "tasks.read") ? (
              <KpiKarta
                ikona="fajfkaCtverec"
                ton="dobre"
                titulek="Úkoly"
                hodnota={otevrenoUkolu > 0 ? pocet(otevrenoUkolu, "otevřený úkol", "otevřené úkoly", "otevřených úkolů") : "Hotovo"}
                popisy={[poTerminuUkolu > 0 ? `${poTerminuUkolu} po termínu` : null]}
                popisTon={poTerminuUkolu > 0 ? "bad" : undefined}
                paticka={<KpiOdkaz href={`/${rozsah}/ukoly`} popisek="Zobrazit úkoly" />}
              />
            ) : null}
          </div>

          {/* ---------- ROZPIS + POSLEDNÍ VZKAZY --------------------
             Bez `shifts.read` rozpis nikoho jiného vidět nesmí — místo
             něj jsou tu jen moje příští směny. */}
          <div className="ds-stred">
            {smiCistRozpis ? (
              <PanelRozpisu
                nadpis={nadpisRozpisu}
                rozsah={rozsah}
                dny={dnyRozpisu}
                radky={radkyRozpisu}
                zbyva={Math.max(0, vsechnyRadky.length - RADKU_ROZPISU)}
                prazdno={vybranyDen === den.provozni_den ? "Dnes nikdo nemá směnu." : "Na tenhle den není nikdo v rozpisu."}
              />
            ) : (
              panelPristichSmen
            )}
            <PanelVzkazu rozsah={rozsah} vzkazy={posledniVzkazy} />
          </div>
        </div>

        {/* ---------- BOČNÍ PANEL ----------------------------------- */}
        <aside className="ds-dnes-bok" aria-label="Doplňující informace">
          <RychleAkce akce={rychleAkce} />

          {jeVedeni(ctx) && planovanoDnes > 0 ? (
            <TymDnes
              pritomno={tymPritomno.length}
              planovano={planovanoDnes}
              jmena={tymPritomno.map((j) => ({ inicialy: initialy(j), jmeno: j }))}
              href={`/${rozsah}/dochazka`}
            />
          ) : null}

          {pocasi ? <PocasiKarta misto={den.pobocka_nazev} teplota={pocasi.teplotaC} stav={pocasi.stavPocasi} /> : null}

          <Citat />

          <p style={{ margin: 0, fontSize: "13px" }}>
            <Link href={`/${rozsah}/dochazka`} style={odkaz}>
              Tenhle měsíc — odpracováno, hrubá mzda, zálohy
            </Link>
          </p>

          {/*
            Push do mobilu zatím nechodí a NEPÍŠE SE, že chodí. Věta,
            která není pravda, je horší než žádná: člověk by na ni
            spoléhal.
          */}
          <p style={{ ...prazdno, fontSize: "12px", margin: 0 }}>
            Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím nechodí.
          </p>
        </aside>
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

/** „Neděle 14. září 2026" — provozní datum, s rokem jako v mockupu. */
function denDlouze(datum: string): string {
  const [rok, m, d] = datum.split("-").map(Number);
  const dny = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
  // `datum` je provozní DATUM bez pásma — nepouštět přes `new Date()` se
  // stringem, ať se den v týdnu neposune. Sestaví se z jednotlivých čísel.
  const den = new Date(Date.UTC(rok, m - 1, d));
  return `${dny[den.getUTCDay()]} ${d}. ${MESICE[m - 1]} ${rok}`;
}
const MESICE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

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
