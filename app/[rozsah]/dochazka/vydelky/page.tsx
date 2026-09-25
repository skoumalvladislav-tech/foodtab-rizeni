import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import DochazkaZalozky from "../zalozky";
import zalozkyDochazky from "../zalozky-prava";
import NakladyPoDnech, { type RadekDne } from "./po-dnech";
import TabulkaVydelku, { type Obdobi, type RadekVydelku } from "./tabulka-vydelku";

export const dynamic = "force-dynamic";

/**
 * Výdělky — záložka Docházky (24. 9. 2026).
 *
 * Zadání majitele: „ukazovat majitelům aktuální výdělek zaměstnanců,
 * dále předběžný výdělek dle rozpisu směn.“
 *
 *   aktuální   = uzavřená docházka do teď × sazba ke dni (app.earnings)
 *   předběžný  = aktuální + zbývající směny z rozpisu do konce měsíce
 *
 * Počítá všechno databáze (`public.vydelky_prehled`), sem chodí hotová
 * čísla — sazby aplikace nevidí vůbec.
 *
 * Pod lidmi je od 24. 9. večer oddíl „Po dnech“ (`public.vydelky_po_dnech`):
 * „denní přehled nákladů na mzdy a odečtené zálohy“. Tytéž mzdy rozložené
 * na provozní dny, stejní lidé, stejná práva — součet sedí s Vyděláno.
 *
 * PRÁVO: payroll.read v rozsahu z adresy, ne „je majitel“ (pravidlo 2).
 * Majitel ho má přes je_majitel, účetní přes zařazení. Vedoucí, který
 * vidí docházku (attendance.read) nebo vyplácí zálohy (advances.manage),
 * cizí výdělky NEVIDÍ — to je mzdová práce. Na /firma je rozsah NULL,
 * a to chce firemní členství. Tahle kontrola je první linie; druhá je
 * uvnitř databázové funkce, která bez práva nevrátí ani řádek.
 *
 * Výdělky jsou mzdová data: nikdy do jazykového modelu (pravidlo 8).
 */
export default async function Vydelky({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ mesic?: string }>;
}) {
  const { rozsah } = await params;
  const { mesic: mesicParam } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "payroll.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Na výdělky nemáte oprávnění">
        Výdělky ostatních vidí jen ten, kdo dělá mzdy (
        <code>payroll.read</code>). Docházka ani vyplácení záloh k tomu
        nestačí. Svůj vlastní výdělek najdete na záložce Docházka.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;

  // Měsíc z adresy se nese i do záložek — přepnutím na Docházku se
  // nemá ztratit, na který měsíc se člověk díval.
  const mesicZAdresy = platnyMesic(mesicParam);
  const zalozky = (
    <DochazkaZalozky
      rozsah={rozsah}
      aktivni="vydelky"
      viditelne={await zalozkyDochazky(tenantId, scope.branchId)}
      mesic={mesicZAdresy}
    />
  );

  /*
    VÝCHOZÍ MĚSÍC = měsíc DNEŠNÍHO PROVOZNÍHO DNE, ne kalendáře serveru
    (pravidlo 11). Na Vercelu běží server v UTC: 1. den v měsíci mezi
    půlnocí a druhou ráno by `new Date()` ukázal ještě minulý měsíc,
    a do začátku provozního dne (day_starts_at) patří noc pořád k němu.

    Na firemní úrovni je kotvou první pobočka — stejně jako Rozpis směn;
    pobočky se stejnou otevírací dobou vyjdou stejně. Hranici „dnešek“
    pro plán si databáze stejně počítá u každé směny podle její pobočky.
  */
  const kotva = scope.branchId ?? ctx.branches[0]?.id ?? null;
  const dnes = kotva ? await provozniDen(kotva) : null;
  if (!dnes) {
    return (
      <>
        <Hlavicka />
        <div style={obal}>
          {zalozky}
          <p style={ramecek}>
            <strong>Nepodařilo se zjistit provozní den.</strong> Bez něj
            se nedá říct, co je už odpracované a co teprve v plánu.
            {kotva ? " Zkuste to prosím za chvíli znovu." : " Firma zatím nemá žádnou pobočku."}
          </p>
        </div>
      </>
    );
  }

  const tenhleMesic = `${dnes.slice(0, 7)}-01`;
  const mesic = mesicZAdresy ? `${mesicZAdresy}-01` : tenhleMesic;
  const obdobi: Obdobi =
    mesic < tenhleMesic ? "minuly" : mesic === tenhleMesic ? "tento" : "budouci";

  const supabase = await getServerSupabase();
  // Po lidech a po dnech: tytéž parametry, táž pravidla práv v databázi.
  const [{ data, error }, { data: dnyData, error: dnyChyba }] = await Promise.all([
    supabase.rpc("vydelky_prehled", {
      p_tenant: tenantId,
      p_branch: scope.branchId,
      p_mesic: mesic,
    }),
    supabase.rpc("vydelky_po_dnech", {
      p_tenant: tenantId,
      p_branch: scope.branchId,
      p_mesic: mesic,
    }),
  ]);

  /*
    Nenasazená migrace obrazovku neshodí, jen řekne, na co se čeká —
    stejně jako checklisty. Prominutí platí JEN pro chybějící funkci;
    cokoli jiného (odmítnuté právo, chyba uvnitř) je porucha a padá.
  */
  if (funkceNeexistuje(error)) {
    return (
      <>
        <Hlavicka />
        <div style={obal}>
          {zalozky}
          <p style={ramecek}>Výdělky budou dostupné po nasazení databáze.</p>
        </div>
      </>
    );
  }
  if (error) throw new DotazSelhal("výdělky lidí", error);

  /*
    Po dnech přibylo o migraci později (20260925130000). Když ještě není
    nasazená, tabulka po lidech zůstane a místo dnů je věta — stejné
    prominutí jako výš, a zase JEN pro chybějící funkci.
  */
  if (dnyChyba && !funkceNeexistuje(dnyChyba)) {
    throw new DotazSelhal("náklady po dnech", dnyChyba);
  }
  const poDnech = dnyChyba ? null : ((dnyData ?? []) as Record<string, unknown>[]).map(naDen);

  const radky = ((data ?? []) as Record<string, unknown>[]).map(naRadek);

  // Do budoucna jen o měsíc: rozpis dál obvykle není a prázdné měsíce
  // by jen vypadaly jako chyba.
  const predchozi = posunMesic(mesic, -1);
  const nasledujici = posunMesic(mesic, 1);
  const nejdal = posunMesic(tenhleMesic, 1);
  const odkaz = (m: string) => `/${rozsah}/dochazka/vydelky?mesic=${m.slice(0, 7)}`;

  return (
    <>
      <Hlavicka />
      <div style={obal}>
        {zalozky}
        <TabulkaVydelku
          radky={radky}
          mesic={mesic}
          obdobi={obdobi}
          naPobocce={scope.level === "branch"}
          pobocky={Object.fromEntries(ctx.branches.map((b) => [b.id, b.name]))}
          predchozi={{ href: odkaz(predchozi), mesic: predchozi }}
          nasledujici={nasledujici <= nejdal ? { href: odkaz(nasledujici), mesic: nasledujici } : null}
          poDnech={<NakladyPoDnech radky={poDnech} mesic={mesic} />}
        />
      </div>
    </>
  );
}

/** Hlavička jako na Docházce: jeden h1, záložky pod ním. */
function Hlavicka() {
  return (
    <Nadpis
      oci="Provoz"
      popis="Výdělky lidí za měsíc: odpracováno, zálohy a předběžně podle rozpisu, náklady po dnech. Hrubá mzda, orientačně."
    >
      Docházka
    </Nadpis>
  );
}

/**
 * Řádek z databáze na čísla. PostgREST posílá bigint jako číslo, ale
 * spoléhat se na to u peněz nechceme — Number() a u NULL nula, kromě
 * sazby, kde NULL znamená „bez sazby“ a nula by lhala.
 */
function naRadek(r: Record<string, unknown>): RadekVydelku {
  const cislo = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    employee_id: String(r.employee_id),
    full_name: String(r.full_name ?? ""),
    branch_id: r.branch_id ? String(r.branch_id) : null,
    odpracovano_minut: cislo(r.odpracovano_minut),
    vydelano_haleru: cislo(r.vydelano_haleru),
    sazba_chybi: r.sazba_chybi === true,
    hodinova_haleru:
      r.hodinova_haleru === null || r.hodinova_haleru === undefined
        ? null
        : Number(r.hodinova_haleru),
    plan_minut: cislo(r.plan_minut),
    plan_haleru: cislo(r.plan_haleru),
    plan_sazba_chybi: r.plan_sazba_chybi === true,
    plan_smen: cislo(r.plan_smen),
    zalohy_haleru: cislo(r.zalohy_haleru),
    predbezne_haleru: cislo(r.predbezne_haleru),
  };
}

/**
 * Den z `vydelky_po_dnech` na čísla. Mzdy NULL zůstávají NULL — den,
 * kdy pracovali jen lidé bez sazby, není „0 Kč“.
 */
function naDen(r: Record<string, unknown>): RadekDne {
  const cislo = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    den: String(r.den),
    lidi: cislo(r.lidi),
    odpracovano_minut: cislo(r.odpracovano_minut),
    mzdy_haleru: r.mzdy_haleru === null || r.mzdy_haleru === undefined ? null : Number(r.mzdy_haleru),
    bez_sazby_lidi: cislo(r.bez_sazby_lidi),
    zalohy_haleru: cislo(r.zalohy_haleru),
    zaloh: cislo(r.zaloh),
    zaloh_nepotvrzenych: cislo(r.zaloh_nepotvrzenych),
  };
}

/**
 * Měsíc z adresy ve tvaru RRRR-MM, nebo null.
 *
 * Adrese se nevěří: nesmysl (a rok, který databáze nevezme) se tiše
 * nahradí dnešním měsícem, ne chybovou stránkou.
 */
function platnyMesic(hodnota: string | undefined): string | null {
  if (!hodnota || !/^\d{4}-\d{2}$/.test(hodnota)) return null;
  const rok = Number(hodnota.slice(0, 4));
  const m = Number(hodnota.slice(5, 7));
  if (rok < 2000 || rok > 2100 || m < 1 || m > 12) return null;
  return hodnota;
}

/**
 * O kolik měsíců vedle. Čistě řetězcově — žádné Date, žádné časové
 * pásmo serveru, přetečení roku ošetřené ručně.
 */
function posunMesic(prvniDen: string, o: number): string {
  const index = Number(prvniDen.slice(0, 4)) * 12 + Number(prvniDen.slice(5, 7)) - 1 + o;
  const rok = Math.floor(index / 12);
  const mesic = (index % 12) + 1;
  return `${rok}-${String(mesic).padStart(2, "0")}-01`;
}

const obal = { padding: "16px", paddingBottom: "32px" } as const;

const ramecek = {
  margin: 0,
  padding: "10px 12px",
  border: "1px solid var(--pozor)",
  borderRadius: "var(--radius-sm)",
  background: "var(--pozor-bg)",
  color: "var(--pozor)",
  fontSize: "14px",
} as const;
