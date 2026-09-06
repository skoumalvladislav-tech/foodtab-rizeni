import Link from "next/link";
import { redirect } from "next/navigation";

import { getContext, getUser } from "@/lib/authz";
import { hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { odkazNaPrihlaseni } from "@/lib/prihlaseni-adresa";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
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

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const zona = ZONA_VYCHOZI;
  const platnyKod =
    typeof kod === "string" && /^[A-Za-z0-9]{8}$/.test(kod)
      ? kod.toUpperCase()
      : null;
  const vPraci = den.v_praci;
  const dalsiDruh = vPraci ? "out" : "in";

  /*
    Jak dlouho už je v práci. Číslo POČÍTÁ DATABÁZE.

    `Date.now()` uvnitř vykreslení je nečistá funkce — eslint to právem
    hlásí jako chybu a React nezaručuje, kolikrát se vykreslení pustí.
    A hlavně: čas by se bral odjinud než , takže by se ty dva
    údaje mohly rozejít.
  */
  const minutVPraci = den.minut_v_praci ?? 0;

  const zVcerejska =
    vPraci && den.den_prichodu !== null && den.den_prichodu < den.provozni_den;

  return (
    <>
      <Nadpis oci="Provoz" popis="Co potřebujete vědět hned teď.">
        Dnes
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px", maxWidth: "760px" }}>
        {/* ---------- KARTA, KTERÁ ODPOVÍDÁ ---------------------- */}
        <section style={karta}>
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
        </section>

        {/* ---------- PŘÍŠTÍ SMĚNY ------------------------------- */}
        <h2 style={nadpisSekce}>Příští směny</h2>
        {pristi.length === 0 ? (
          <p style={prazdno}>Zatím nemáte zadanou žádnou další směnu.</p>
        ) : (
          <ul style={seznam}>
            {pristi.map((s) => (
              <li key={s.id} style={radek}>
                <strong>{denCesky(s.shift_date)}</strong>{" "}
                {s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)} ·{" "}
                {nazvyPobocek.get(s.branch_id) ?? "jiná pobočka"}
              </li>
            ))}
          </ul>
        )}

        {/* ---------- ODKAZY DÁL --------------------------------- */}
        {/*
          Tenhle měsíc a Co je nového mají vlastní obrazovky, na kterých
          je toho víc. Odsud se na ně jen ukazuje — dvě čísla navíc na
          domovské obrazovce by z ní udělaly další rozcestník.
        */}
        <h2 style={nadpisSekce}>Kam dál</h2>
        <ul style={seznam}>
          <li style={radek}>
            <Link href={`/${rozsah}/dochazka`} style={odkaz}>
              Tenhle měsíc — odpracováno, hrubá mzda, zálohy
            </Link>
          </li>
          <li style={radek}>
            <Link href={`/${rozsah}/rozhovory`} style={odkaz}>
              Zprávy a rozhovory
            </Link>
          </li>
          <li style={radek}>
            <Link href={`/${rozsah}/ukoly`} style={odkaz}>
              Úkoly a checklisty
            </Link>
          </li>
        </ul>

        {/*
          Push do mobilu zatím nechodí a NEPÍŠE SE, že chodí. Věta, která
          není pravda, je horší než žádná: člověk by na ni spoléhal.
        */}
        <p style={{ ...prazdno, marginTop: "20px", fontSize: "12px" }}>
          Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím
          nechodí.
        </p>
      </div>
    </>
  );
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

const karta = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "16px",
  padding: "18px",
  marginBottom: "24px",
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

const radek = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "14px",
  color: "var(--ink)",
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
  borderRadius: "10px",
  background: "var(--paper)",
  border: "1px solid var(--line)",
  fontSize: "14px",
  color: "var(--ink)",
} as const;

const ramecek = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "14px",
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.5,
} as const;
