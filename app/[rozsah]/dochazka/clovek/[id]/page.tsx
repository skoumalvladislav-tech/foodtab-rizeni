import Link from "next/link";
import { redirect } from "next/navigation";

import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  adresaCloveka,
  JE_UUID,
  naOdkud,
  naRadekUseku,
  odkazZpet,
  platnyDen,
  platnyMesic,
  posunMesic,
  seskupitPoDnech,
  type PenizeDne,
  type RadekUseku,
} from "@/lib/useky-dochazky";
import Sdeleni from "@/app/sdeleni";
import Ikona from "../../../ikona";
import Nadpis from "../../../nadpis";
import DochazkaZalozky from "../../zalozky";
import zalozkyDochazky from "../../zalozky-prava";
import SmenyCloveka, { type ObdobiCloveka, type Vysledek } from "../smeny-cloveka";

export const dynamic = "force-dynamic";

/**
 * Docházka člověka — odpracované úseky jednoho člověka po provozních
 * dnech, s úpravou a stornem (27. 9. 2026).
 *
 * Zadání majitele: „potřebuji mít možnost u jednotlivých lidí zkouknout
 * odpracované směny po dnech a případně je upravovat. dále možnost
 * stornovat směnu která započala píchnutím (stala se chyba)".
 *
 * Adresa /[rozsah]/dochazka/clovek/[id]?mesic=RRRR-MM&z=vydelky|prehled|lide.
 * Vstupy: jméno ve Výdělcích, boční panel živého přehledu, Nastavení →
 * Lidé. `z` je jen výčet pro odkaz zpět, žádná adresa.
 *
 * PRÁVA
 *   * stránka: attendance.read v rozsahu z adresy (první linie);
 *     databáze pak po záznamu jako RLS attendance_read (druhá linie,
 *     `public.useky_cloveka`) — vedoucí jedné pobočky vidí úseky na své
 *     pobočce, majitel (bez pobočky, členství „celá firma") všechno;
 *   * peníze po dnech jen s payroll.read (jako Výdělky), úseky samotné
 *     payroll.read nepouštějí (otázka 30);
 *   * úprava a storno: attendance.manage na pobočce každého záznamu,
 *     vlastní docházku jen majitel — rozhoduje databáze, tlačítka se
 *     podle ní jen kreslí (`smi_spravovat`).
 *   * kdo na docházku ostatních nemá a otevře svou vlastní adresu, jde
 *     na Můj účet.
 *
 * ID z adresy je návrh: ověřuje se tvarem a pak databází
 * (`public.dochazka_clovek` — jméno jen tomu, kdo toho člověka smí vidět).
 *
 * Výchozí měsíc = měsíc DNEŠNÍHO PROVOZNÍHO DNE, ne hodin serveru
 * (pravidlo 11). Do budoucna se nechodí.
 *
 * Docházka, úseky ani peníze nikdy do jazykového modelu (pravidlo 8).
 */
export default async function DochazkaCloveka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; id: string }>;
  searchParams: Promise<{
    mesic?: string;
    z?: string;
    ulozeno?: string;
    stornovano?: string;
    chyba?: string;
    /** Hláška z databáze. Propouští se beze změny (vzor rucni.ts). */
    text?: string;
    den?: string;
  }>;
}) {
  const { rozsah, id } = await params;
  const sp = await searchParams;
  const odkud = naOdkud(sp.z);

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  if (!JE_UUID.test(id)) {
    return <Sdeleni nadpis="Takový člověk tu není">Adresa neukazuje na nikoho z firmy.</Sdeleni>;
  }

  const pristup = await zkusPristup(tenantId, "attendance.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");

  const supabase = await getServerSupabase();

  // Kdo to je — jen když ho volající smí vidět (sám sebe vždycky).
  const { data: lide, error: chybaCloveka } = await supabase.rpc("dochazka_clovek", {
    p_tenant: tenantId,
    p_employee: id,
  });
  if (funkceNeexistuje(chybaCloveka)) {
    return <Sdeleni nadpis="Docházka člověka">Bude dostupná po nasazení databáze.</Sdeleni>;
  }
  if (chybaCloveka) throw new DotazSelhal("člověk v docházce", chybaCloveka);
  const clovek = ((lide ?? []) as { full_name: string; branch_id: string | null; je_sam: boolean }[])[0];

  if (pristup.stav === "odepren") {
    // Vlastní docházku má každý na Můj účet — bez práva na ostatní.
    if (clovek?.je_sam) redirect(`/${rozsah}/dochazka/ucet`);
    return (
      <Sdeleni nadpis="Na docházku ostatních nemáte oprávnění">
        Docházku ostatních po dnech vidí jen ten, kdo docházku spravuje nebo čte (
        <code>attendance.read</code>). Svoji vlastní najdete na záložce Můj účet.
      </Sdeleni>
    );
  }

  if (!clovek) {
    return (
      <Sdeleni nadpis="Takový člověk tu není">
        Buď v téhle firmě není, byl smazaný, nebo jeho docházku nevidíte.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;

  /*
    Kotva provozního dne: pobočka z adresy, jinak domovská pobočka
    člověka, jinak první pobočka firmy (majitel pobočku nemá) — jako
    Výdělky a Můj účet.
  */
  const kotva = scope.branchId ?? clovek.branch_id ?? ctx.branches[0]?.id ?? null;
  const dnes = kotva ? await provozniDen(kotva) : null;

  const mesicZAdresy = platnyMesic(sp.mesic);
  const zalozky = (
    <DochazkaZalozky
      rozsah={rozsah}
      aktivni={odkud === "vydelky" ? "vydelky" : "dochazka"}
      viditelne={await zalozkyDochazky(tenantId, scope.branchId)}
      mesic={mesicZAdresy}
    />
  );
  const zpet = odkazZpet(rozsah, odkud, id, (mesicZAdresy ?? dnes?.slice(0, 7)) || "");
  const hlavicka = (
    <>
      <Link href={zpet.href} className="ds-uc-zpet">
        <Ikona klic="zpet" velikost={16} />
        {zpet.popisek}
      </Link>
      <Nadpis oci="Docházka" popis="Odpracované úseky po provozních dnech, úprava a storno.">
        {clovek.full_name}
      </Nadpis>
    </>
  );

  if (!dnes) {
    return (
      <>
        {hlavicka}
        <div style={obal}>
          {zalozky}
          <p className="ds-uc-pruh" role="status">
            <strong>Nepodařilo se zjistit provozní den.</strong> Bez něj se nedá říct, který měsíc je ten
            běžící.{kotva ? " Zkuste to prosím za chvíli znovu." : " Firma zatím nemá žádnou pobočku."}
          </p>
        </div>
      </>
    );
  }

  const tenhleMesic = `${dnes.slice(0, 7)}-01`;
  const mesic =
    mesicZAdresy && `${mesicZAdresy}-01` <= tenhleMesic ? `${mesicZAdresy}-01` : tenhleMesic;
  const obdobi: ObdobiCloveka = mesic < tenhleMesic ? "minuly" : "tento";

  /*
    Peníze: payroll.read s týmž pravidlem jako databáze (vydelky_prehled,
    bod 8) — člověk bez pobočky jen s právem na firemní úrovni. Tohle
    rozhoduje jen o tom, jestli se na ně ptát a kreslit je; databáze bez
    práva stejně nevrátí ani řádek.
  */
  const [sPenezi, spravovane] = await Promise.all([
    hasAccess(tenantId, "payroll.read", clovek.branch_id),
    Promise.all(
      ctx.branches.map(async (b) =>
        (await hasAccess(tenantId, "attendance.manage", b.id)) ? { id: b.id, nazev: b.name } : null,
      ),
    ).then((p) => p.filter((b): b is { id: string; nazev: string } => b !== null)),
  ]);
  // Vlastní docházku upravuje jen majitel (otázka 25) — databáze to hlídá
  // sama, tady se jen nenabízí tlačítko, které by skončilo odmítnutím.
  const smiZapsat = spravovane.length > 0 && (!clovek.je_sam || ctx.jeMajitel);

  const [useky, penize] = await Promise.all([
    supabase.rpc("useky_cloveka", { p_tenant: tenantId, p_employee: id, p_mesic: mesic }),
    sPenezi
      ? supabase.rpc("vydelek_cloveka_po_dnech", { p_tenant: tenantId, p_employee: id, p_mesic: mesic })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (funkceNeexistuje(useky.error)) {
    return (
      <>
        {hlavicka}
        <div style={obal}>
          {zalozky}
          <p className="ds-uc-pruh" role="status">Docházka po dnech bude dostupná po nasazení databáze.</p>
        </div>
      </>
    );
  }
  if (useky.error) throw new DotazSelhal("úseky docházky", useky.error);
  if (penize.error && !funkceNeexistuje(penize.error)) throw new DotazSelhal("výdělek po dnech", penize.error);

  const radky = ((useky.data ?? []) as Record<string, unknown>[])
    .map(naRadekUseku)
    .filter((r): r is RadekUseku => r !== null);
  const penizeDnu =
    sPenezi && !penize.error
      ? new Map<string, PenizeDne>(
          ((penize.data ?? []) as { den: string; sazba: number | null; haleru: number | null }[]).map((p) => [
            String(p.den).slice(0, 10),
            // Den bez sazby: NULL, nikdy 0 Kč (zadání mezd, oddíl 6).
            { haleru: p.sazba === null || p.haleru === null ? null : Number(p.haleru) },
          ]),
        )
      : null;
  const dny = seskupitPoDnech(radky, penizeDnu);

  const odkazMesice = (m: string) => adresaCloveka(rozsah, id, { mesic: m.slice(0, 7), odkud });
  const predchozi = posunMesic(mesic, -1);
  const nasledujici = posunMesic(mesic, 1);

  return (
    <>
      {hlavicka}
      <div style={obal}>
        {zalozky}
        <SmenyCloveka
          rozsah={rozsah}
          osoba={{ id, jmeno: clovek.full_name }}
          mesic={mesic}
          obdobi={obdobi}
          dnes={dnes}
          dny={dny}
          penize={penizeDnu}
          pobocky={Object.fromEntries(ctx.branches.map((b) => [b.id, b.name]))}
          spravovane={spravovane}
          smiZapsat={smiZapsat}
          odkud={odkud}
          predchozi={{ href: odkazMesice(predchozi), mesic: predchozi }}
          nasledujici={nasledujici <= tenhleMesic ? { href: odkazMesice(nasledujici), mesic: nasledujici } : null}
          vysledek={vysledekZAdresy(sp)}
        />
      </div>
    </>
  );
}

/** Výsledek úpravy nebo storna z adresy (redirect z akce.ts). */
function vysledekZAdresy(sp: {
  ulozeno?: string;
  stornovano?: string;
  chyba?: string;
  text?: string;
  den?: string;
}): Vysledek | null {
  if (sp.chyba === "uprava") {
    return {
      druh: "chyba",
      den: platnyDen(sp.den),
      text: sp.text?.trim() || "Úpravu se nepodařilo uložit. Zkuste to prosím znovu.",
    };
  }
  if (sp.ulozeno) return { druh: "ulozeno", den: platnyDen(sp.ulozeno) };
  if (sp.stornovano) return { druh: "stornovano", den: platnyDen(sp.stornovano) };
  return null;
}

const obal = { padding: "16px", paddingBottom: "32px" } as const;
