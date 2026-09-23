import Link from "next/link";
import { redirect } from "next/navigation";

import { getUser, hasAccess } from "@/lib/authz";
import { ZONA_VYCHOZI } from "@/lib/cas";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Ikona from "../../ikona";
import Nadpis from "../../nadpis";
import PcZalozky from "../../provozni-centrum/zalozky";
import BokBehu from "./bok";
import {
  nactiDetail,
  nactiLidi,
  nactiSeznam,
  nactiSouvisejici,
  sestavAktivitu,
  type FiltrSeznamu,
} from "./data";
import DetailBehu from "./detail-behu";
import DetailPolozky from "./detail-polozky";
import SeznamChecklistu from "./seznam";
import { jePohled, terazMs } from "./spolecne";
import ZivyChecklist from "./zivy-checklist";

/**
 * Obrazovka Checklisty — jedna skládačka pro tři adresy:
 *
 *   /[rozsah]/ukoly/checklisty                          seznam
 *   /[rozsah]/ukoly/checklisty/[beh]                    seznam + detail
 *   /[rozsah]/ukoly/checklisty/[beh]/polozka/[polozka]  … + detail položky
 *
 * Na počítači jsou vidět vedle sebe (mockup 23. 9.), na telefonu jen ta
 * nejhlubší úroveň — přepíná `data-zobrazit` v CSS, ne skript (vzor
 * Komunikace). Každá adresa načte, co potřebuje, znovu: jde ji poslat
 * kolegovi a funguje i bez JavaScriptu.
 *
 * Zůstává pod „Vzkazy a úkoly“ (záložka Checklisty), ne v levé nabídce
 * zvlášť — rozhodnutí Šéfíka 23. 9.
 */

export type Hledani = {
  cl?: string;
  usek?: string;
  stav?: string;
  strana?: string;
  den?: string;
  osoba?: string;
  sablona?: string;
  pobocka?: string;
  chyba?: string;
  polozka?: string;
  ulozeno?: string;
  ukol?: string;
};

const PARAMETRY_SEZNAMU = ["cl", "usek", "stav", "strana", "den", "osoba", "sablona"] as const;

export default async function ChecklistyStranka({
  rozsah,
  behId,
  polozkaId,
  hledani,
}: {
  rozsah: string;
  behId: string | null;
  polozkaId: string | null;
  hledani: Hledani;
}) {
  /* --- 1. PŘÍSTUP ----------------------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }
  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na checklisty vaše oprávnění nedosáhne. Pokud si myslíte, že by mělo, řekněte si správci firmy o úpravu.
      </Sdeleni>
    );
  }
  const { ctx, scope } = pristup;

  /* --- 2. PARAMETRY SEZNAMU --------------------------------------------- */

  const dotazSeznamu = new URLSearchParams();
  for (const k of PARAMETRY_SEZNAMU) {
    const v = hledani[k];
    if (v) dotazSeznamu.set(k, v);
  }
  const dotaz = dotazSeznamu.toString();

  // Filtr „Pobočka“ je jen přesměrování na tutéž obrazovku jiné pobočky.
  if (hledani.pobocka) {
    const cil = ctx.branches.find((b) => b.slug === hledani.pobocka);
    if (cil) redirect(`/${cil.slug}/ukoly/checklisty${dotaz ? `?${dotaz}` : ""}`);
  }

  const filtr: FiltrSeznamu = {
    pohled: jePohled(hledani.cl) ? hledani.cl : "dnes",
    usek: hledani.usek || null,
    stav: hledani.stav || null,
    strana: Math.max(1, Number(hledani.strana) || 1),
    den: hledani.den || null,
    osoba: hledani.osoba || null,
    sablona: hledani.sablona || null,
  };

  /* --- 3. DATA ---------------------------------------------------------- */

  const supabase = await getServerSupabase();
  const ted = terazMs();
  const [lide, user] = await Promise.all([nactiLidi(supabase, tenantId), getUser()]);

  let mujEmployeeId: string | null = null;
  if (user) {
    const { data, error } = await supabase
      .from("employees")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .limit(1);
    if (error) throw new DotazSelhal("můj zaměstnanecký záznam", error);
    mujEmployeeId = (data?.[0]?.id as string | undefined) ?? null;
  }

  const detail = behId ? await nactiDetail(supabase, tenantId, behId) : null;

  // Seznam se vede na pobočku. Na firemní úrovni se vezme pobočka
  // otevřeného běhu; bez něj se nabídne výběr pobočky.
  const branchId = scope.branchId ?? detail?.beh.branch_id ?? null;
  const pobocka = branchId ? ctx.branches.find((b) => b.id === branchId) : undefined;
  const zona = pobocka?.timezone ?? ctx.tenant.timezone ?? ZONA_VYCHOZI;

  const [seznam, smiSpravovat] = await Promise.all([
    branchId ? nactiSeznam(supabase, tenantId, branchId, mujEmployeeId, filtr, ted) : Promise.resolve(null),
    branchId ? hasAccess(tenantId, "tasks.manage", branchId) : Promise.resolve(false),
  ]);

  const souvisejici = detail ? await nactiSouvisejici(supabase, tenantId, detail.beh.id, lide) : [];
  const polozka = detail && polozkaId ? (detail.polozky.find((p) => p.id === polozkaId) ?? null) : null;

  /* --- 4. ADRESY -------------------------------------------------------- */

  const zakladCesta = `/${rozsah}/ukoly/checklisty`;
  const sDotazem = (cesta: string) => `${cesta}${dotaz ? `?${dotaz}` : ""}`;
  const naSeznam = sDotazem(zakladCesta);
  const naBeh = detail ? sDotazem(`${zakladCesta}/${detail.beh.id}`) : naSeznam;
  const naPolozku = (id: string) => sDotazem(`${zakladCesta}/${detail?.beh.id}/polozka/${id}`);
  const tady = polozka ? naPolozku(polozka.id) : naBeh;

  const zobrazit = polozka ? "polozka" : detail ? "detail" : "seznam";
  const chyba = hledani.chyba ? String(hledani.chyba).slice(0, 300) : null;

  /* --- 5. VYKRESLENÍ ----------------------------------------------------- */

  let pravySloupec: React.ReactNode;
  if (behId && !detail) {
    pravySloupec = (
      <div className="ds-plocha ck-prazdno">
        <Ikona klic="vykricnik" />
        <p style={{ margin: 0 }}>Checklist nenalezen — buď neexistuje, nebo není váš.</p>
        <Link href={naSeznam} className="ft-tl ft-tl-vedlejsi ft-tl-male">
          Zpět na checklisty
        </Link>
      </div>
    );
  } else if (detail) {
    const bok = polozka ? (
      <DetailPolozky
        rozsah={rozsah}
        tenantId={tenantId}
        detail={detail}
        polozka={polozka}
        jmena={lide.jmena}
        zona={zona}
        zpet={tady}
        zavrit={naBeh}
        ukolyPolozky={souvisejici.filter((u) => u.polozkaId === polozka.id)}
        smiSpravovat={smiSpravovat}
        chyba={hledani.polozka === polozka.id || !hledani.polozka ? chyba : null}
      />
    ) : (
      <BokBehu
        rozsah={rozsah}
        udalosti={sestavAktivitu(detail, souvisejici, lide)}
        ukoly={souvisejici}
        nazvyPolozek={new Map(detail.polozky.map((p) => [p.id, p.label]))}
        zona={zona}
        den={detail.beh.business_date}
      />
    );
    pravySloupec = (
      <>
        {hledani.ukol ? (
          <p className="ck-hlaska-ok" role="status">
            Úkol je vytvořený. <Link href={`/${rozsah}/ukoly/ukol/${hledani.ukol}`}>Otevřít úkol</Link>
          </p>
        ) : null}
        <DetailBehu
          rozsah={rozsah}
          detail={detail}
          jmena={lide.jmena}
          zona={zona}
          ted={ted}
          pobockaNazev={pobocka?.name ?? null}
          smiSpravovat={smiSpravovat}
          mujEmployeeId={mujEmployeeId}
          zpet={tady}
          zavrit={naSeznam}
          naPolozku={naPolozku}
          vybranaPolozka={polozka?.id ?? null}
          chyba={polozka ? null : chyba}
          chybaPolozka={polozka ? null : (hledani.polozka ?? null)}
          bok={bok}
        />
        <ZivyChecklist beh={detail.beh.id} />
      </>
    );
  } else {
    pravySloupec = (
      <div className="ds-plocha ck-prazdno">
        <Ikona klic="seznam" />
        <p style={{ margin: 0 }}>Vyberte checklist vlevo — otevře se tady.</p>
      </div>
    );
  }

  // `data-zobrazit` i na obalu: na telefonu detail a položka zabírají celou
  // obrazovku (mockup, obrazovky 2 a 3) — hlavička stránky a záložky zmizí.
  return (
    <div className="ck-stranka" data-zobrazit={zobrazit}>
      <Nadpis
        oci="Vzkazy a úkoly"
        popis="Pravidelné provozní kontroly a směnové postupy. Nic nezapomenout, mít vše pod kontrolou."
        vpravo={
          smiSpravovat ? (
            <Link href={`/${rozsah}/ukoly/sablona/nova`} className="ft-tl ft-tl-hlavni">
              <Ikona klic="plus" /> Nový checklist
            </Link>
          ) : undefined
        }
      >
        Checklisty
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px", maxWidth: "1480px" }}>
        <PcZalozky rozsah={rozsah} aktivni="checklisty" />

        {hledani.ulozeno ? (
          <p className="ck-hlaska-ok" role="status" style={{ marginBottom: "14px" }}>
            Uloženo.
          </p>
        ) : null}
        {chyba && !detail ? (
          <p className="hlaska-chyba" role="alert" style={{ marginBottom: "14px" }}>
            {chyba}
          </p>
        ) : null}
        {seznam && !seznam.plne ? (
          <p className="pc-poznamka-navrhu" style={{ marginBottom: "14px" }}>
            Fotky, poznámky, „nelze splnit“, potvrzení vedoucím a verze šablon se zapnou po nasazení databáze.
            Vyplňovat checklisty jde i teď.
          </p>
        ) : null}

        <div className="ck-split" data-zobrazit={zobrazit}>
          <div className="ck-seznam">
            {seznam ? (
              <SeznamChecklistu
                rozsah={rozsah}
                data={seznam}
                filtr={filtr}
                dotaz={dotaz}
                aktivniBeh={detail?.beh.id ?? null}
                jmena={lide.jmena}
                pobockaNazev={pobocka?.name ?? null}
                pobocky={ctx.branches.map((b) => ({ slug: b.slug, name: b.name }))}
                zona={zona}
                smiSpravovat={smiSpravovat}
              />
            ) : (
              <div className="ds-plocha">
                <p style={{ margin: "0 0 10px", fontSize: "14px" }}>
                  Checklisty se vedou po pobočkách. Vyberte, na kterou se podívat:
                </p>
                <ul className="ck-karty">
                  {ctx.branches.map((b) => (
                    <li key={b.id}>
                      <Link href={`/${b.slug}/ukoly/checklisty`} className="ck-karta" style={{ display: "flex" }}>
                        <Ikona klic="pobocka" /> {b.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="ck-detail">{pravySloupec}</div>
        </div>
      </div>
    </div>
  );
}
