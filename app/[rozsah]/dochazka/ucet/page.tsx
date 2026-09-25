import { redirect } from "next/navigation";

import { getContext, getUser } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import DochazkaZalozky from "../zalozky";
import zalozkyDochazky from "../zalozky-prava";
import UcetZamestnance, { type ObdobiUctu, type RadekUctu, type Zobrazeni } from "./ucet";

export const dynamic = "force-dynamic";

/**
 * Můj účet — záložka Docházky (24. 9. 2026 večer).
 *
 * Zadání majitele: „zaměstnanec ať má možnost vidět svůj výdělek
 * a odebrané zálohy, to bych zahrnul do sekce docházka. dal bych tam
 * přehled pracovního účtu.“
 *
 * Pracovní účet za měsíc po provozních dnech: odpracováno, hrubý
 * výdělek, zálohy a průběžný zůstatek. Počítá databáze
 * (`public.muj_pracovni_ucet` — rozklad téže mzdy jako dlaždice na
 * Docházce), sem chodí hotová čísla.
 *
 * PRÁVO: žádné. Na vlastní mzdu má právo každý, kdo je propojený se
 * zaměstnancem (zadání mezd, oddíl 4). Funkce nemá parametr
 * zaměstnance — kdo je „já“, říká přihlášení, ne adresa. Rozsah z adresy
 * rozhoduje jen o tom, pod jakou hlavičkou se stránka ukáže; účet je
 * vždycky za celou firmu (zálohy ze všech poboček), stejně jako dlaždice.
 *
 * Výdělky a zálohy jsou mzdová data: nikdy do jazykového modelu
 * (pravidlo 8).
 */
export default async function MujUcet({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ mesic?: string }>;
}) {
  const { rozsah } = await params;
  const { mesic: mesicParam } = await searchParams;

  const user = await getUser();
  if (!user) redirect("/prihlaseni");

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

  // Rozsah z adresy je návrh (pravidlo 4): cizí pobočka tu nemá co dělat,
  // ani když účet sám na pobočce nezávisí.
  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const mesicZAdresy = platnyMesic(mesicParam);
  const zalozky = (
    <DochazkaZalozky
      rozsah={rozsah}
      aktivni="ucet"
      viditelne={await zalozkyDochazky(tenantId, scope.branchId)}
      mesic={mesicZAdresy}
    />
  );

  const supabase = await getServerSupabase();

  // Tentýž dotaz jako Docházka: bez záznamu není čí účet ukázat.
  const { data: zaznamy, error: chybaZaznamy } = await supabase
    .from("employees")
    .select("id, branch_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1);
  if (chybaZaznamy) throw new DotazSelhal("zaměstnanci", chybaZaznamy);
  const ja = zaznamy?.[0] as { id: string; branch_id: string | null } | undefined;

  if (!ja) {
    return (
      <>
        <Hlavicka />
        <div style={obal}>
          {zalozky}
          <p style={ramecek}>
            <strong>Zatím nemáte zaměstnanecký záznam.</strong> Váš účet
            ještě není propojený se zaměstnancem, takže k němu není co
            ukázat. Doplní to správce firmy.
          </p>
        </div>
      </>
    );
  }

  /*
    VÝCHOZÍ MĚSÍC = měsíc DNEŠNÍHO PROVOZNÍHO DNE, ne kalendáře serveru
    (pravidlo 11). Na Vercelu běží server v UTC: 1. den v měsíci mezi
    půlnocí a druhou ráno by `new Date()` ukázal ještě minulý měsíc,
    a do začátku provozního dne (day_starts_at) patří noc pořád k němu.

    Kotvou je pobočka z adresy, jinak domovská pobočka člověka, jinak
    první pobočka firmy (majitel pobočku nemá) — stejně jako Výdělky.
  */
  const kotva = scope.branchId ?? ja.branch_id ?? ctx.branches[0]?.id ?? null;
  const dnes = kotva ? await provozniDen(kotva) : null;
  if (!dnes) {
    return (
      <>
        <Hlavicka />
        <div style={obal}>
          {zalozky}
          <p style={ramecek}>
            <strong>Nepodařilo se zjistit provozní den.</strong> Bez něj se
            nedá říct, který měsíc je ten běžící.
            {kotva ? " Zkuste to prosím za chvíli znovu." : " Firma zatím nemá žádnou pobočku."}
          </p>
        </div>
      </>
    );
  }

  const tenhleMesic = `${dnes.slice(0, 7)}-01`;
  // Do budoucna se nechodí — uzavřená docházka tam z principu není.
  const mesic =
    mesicZAdresy && `${mesicZAdresy}-01` <= tenhleMesic ? `${mesicZAdresy}-01` : tenhleMesic;
  const obdobi: ObdobiUctu = mesic < tenhleMesic ? "minuly" : "tento";

  const { data, error } = await supabase.rpc("muj_pracovni_ucet", {
    p_tenant: tenantId,
    p_mesic: mesic,
  });

  // Nenasazená migrace obrazovku neshodí; prominutí JEN pro chybějící
  // funkci, cokoli jiného je porucha a padá (stejně jako Výdělky).
  if (funkceNeexistuje(error)) {
    return (
      <>
        <Hlavicka />
        <div style={obal}>
          {zalozky}
          <p style={ramecek}>Pracovní účet bude dostupný po nasazení databáze.</p>
        </div>
      </>
    );
  }
  if (error) throw new DotazSelhal("můj pracovní účet", error);

  const radky = ((data ?? []) as Record<string, unknown>[]).map(naRadek);

  const predchozi = posunMesic(mesic, -1);
  const nasledujici = posunMesic(mesic, 1);
  const odkaz = (m: string) => `/${rozsah}/dochazka/ucet?mesic=${m.slice(0, 7)}`;

  return (
    <>
      <Hlavicka />
      <div style={obal}>
        {zalozky}
        <UcetZamestnance
          radky={radky}
          mesic={mesic}
          obdobi={obdobi}
          predchozi={{ href: odkaz(predchozi), mesic: predchozi }}
          nasledujici={nasledujici <= tenhleMesic ? { href: odkaz(nasledujici), mesic: nasledujici } : null}
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
      popis="Můj pracovní účet: odpracováno, výdělek a zálohy po dnech. Hrubá mzda, orientačně."
    >
      Docházka
    </Nadpis>
  );
}

/**
 * Řádek z databáze. U peněz se NULL nepřevádí na nulu — NULL tu znamená
 * „bez sazby“ nebo „firma to neukazuje“, a nula by lhala.
 */
function naRadek(r: Record<string, unknown>): RadekUctu {
  const neboNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const zobrazeni: Zobrazeni =
    r.zobrazeni === "jen_ukazat" || r.zobrazeni === "neukazovat" ? r.zobrazeni : "odecitat";
  return {
    den: String(r.den),
    odpracovano_minut: Number(r.odpracovano_minut ?? 0),
    hodinova_haleru: neboNull(r.hodinova_haleru),
    vydelano_haleru: neboNull(r.vydelano_haleru),
    sazba_chybi: r.sazba_chybi === true,
    zalohy_haleru: neboNull(r.zalohy_haleru),
    zaloh: neboNull(r.zaloh),
    zaloh_nepotvrzenych: neboNull(r.zaloh_nepotvrzenych),
    zustatek_haleru: neboNull(r.zustatek_haleru),
    zustatek_neuplny: r.zustatek_neuplny === true,
    zobrazeni,
  };
}

/**
 * Měsíc z adresy ve tvaru RRRR-MM, nebo null. Adrese se nevěří: nesmysl
 * se tiše nahradí měsícem provozního dne.
 */
function platnyMesic(hodnota: string | undefined): string | null {
  if (!hodnota || !/^\d{4}-\d{2}$/.test(hodnota)) return null;
  const rok = Number(hodnota.slice(0, 4));
  const m = Number(hodnota.slice(5, 7));
  if (rok < 2000 || rok > 2100 || m < 1 || m > 12) return null;
  return hodnota;
}

/** O kolik měsíců vedle. Čistě řetězcově — žádné Date, žádné pásmo serveru. */
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
