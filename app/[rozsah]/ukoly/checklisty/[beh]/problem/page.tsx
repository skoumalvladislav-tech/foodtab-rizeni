import { redirect } from "next/navigation";
import Link from "next/link";

import { hasAccess } from "@/lib/authz";
import { MAX_FOTEK } from "@/lib/checklisty/fotky";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../../../nadpis";
import { zalozitUkolZChecklistu } from "../../akce";
import { nactiDetail, nactiLidi } from "../../data";
import FotoNahrat from "../../foto-nahrat";
import FormularProblem from "./formular-problem";

export const dynamic = "force-dynamic";

/**
 * Nahlásit problém z checklistu → úkol (z položky, nebo z celého běhu).
 *
 * Úkol zakládá jen kdo smí zadávat úkoly (tasks.manage) — tak to drží
 * databáze (zadat_ukol). Zaměstnanec bez toho práva problém nahlásí
 * v detailu položky jako „Nelze splnit“ s důvodem; vedoucí dostane
 * upozornění hned (checklist.problem).
 */
export default async function NahlasitProblem({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string }>;
  searchParams: Promise<{ polozka?: string; chyba?: string }>;
}) {
  const { rozsah, beh } = await params;
  const { polozka: polozkaId, chyba } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>;
  }
  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return <Sdeleni nadpis="Sem nemáte přístup">Na checklisty vaše oprávnění nedosáhne.</Sdeleni>;
  }

  const supabase = await getServerSupabase();
  const detail = await nactiDetail(supabase, tenantId, beh);
  const naBeh = `/${rozsah}/ukoly/checklisty/${beh}`;
  if (!detail) {
    return (
      <Sdeleni nadpis="Checklist nenalezen">
        Buď neexistuje, nebo není váš. <Link href={`/${rozsah}/ukoly/checklisty`}>Zpět na checklisty</Link>.
      </Sdeleni>
    );
  }

  const polozka = polozkaId ? (detail.polozky.find((p) => p.id === polozkaId) ?? null) : null;
  const zpet = polozka ? `${naBeh}/polozka/${polozka.id}` : naBeh;

  if (!(await hasAccess(tenantId, "tasks.manage", detail.beh.branch_id))) {
    return (
      <Sdeleni nadpis="Úkol zadat nemůžete">
        Úkoly zadává jen ten, kdo na to má oprávnění. Problém ale nahlásit jde: otevřete položku, zvolte „Nelze
        splnit“ a napište důvod — vedoucí dostane upozornění. <Link href={zpet}>Zpět</Link>.
      </Sdeleni>
    );
  }

  const [lide, usekyVysledek, poziceVysledek] = await Promise.all([
    nactiLidi(supabase, tenantId),
    supabase.from("useky").select("id, nazev").eq("tenant_id", tenantId).eq("active", true).order("poradi"),
    supabase.from("positions").select("id, label").eq("tenant_id", tenantId).eq("active", true).order("label"),
  ]);
  if (usekyVysledek.error) throw new DotazSelhal("úseky", usekyVysledek.error);
  if (poziceVysledek.error) throw new DotazSelhal("pozice", poziceVysledek.error);

  const odpovednyId = detail.beh.assigned_employee_id;
  const pocetFotek = polozka ? (detail.fotky.get(polozka.id)?.length ?? 0) : 0;

  return (
    <>
      <Nadpis
        oci="Checklisty"
        popis="Vznikne úkol s odkazem na checklist; checklist samotný se tím nemění."
        vpravo={
          <Link href={zpet} className="ft-tl ft-tl-vedlejsi">
            Zpět
          </Link>
        }
      >
        Nahlásit problém
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <FormularProblem
          akce={zalozitUkolZChecklistu}
          rozsah={rozsah}
          beh={detail.beh.id}
          checklistNazev={detail.sablona.name}
          polozka={polozka ? { id: polozka.id, label: polozka.label } : null}
          odpovedny={odpovednyId ? { id: odpovednyId, jmeno: lide.jmena.get(odpovednyId) ?? "odpovědný" } : null}
          chyba={chyba ?? null}
          lide={[...lide.jmena].map(([employee_id, jmeno]) => ({ employee_id, jmeno }))}
          useky={((usekyVysledek.data ?? []) as { id: string; nazev: string }[]).map((u) => [u.id, u.nazev] as [string, string])}
          pozice={((poziceVysledek.data ?? []) as { id: string; label: string }[]).map((p) => [p.id, p.label] as [string, string])}
          zpet={zpet}
          kritickaDostupna={detail.plne}
          fotky={
            polozka && detail.fotkyDostupne && detail.beh.status === "open" ? (
              <div className="ck-fotky">
                <FotoNahrat
                  rozsah={rozsah}
                  tenantId={tenantId}
                  beh={detail.beh.id}
                  polozka={polozka.id}
                  uzMa={pocetFotek}
                  max={MAX_FOTEK}
                />
              </div>
            ) : null
          }
        />
      </div>
    </>
  );
}
