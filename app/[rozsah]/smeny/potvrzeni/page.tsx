import { redirect } from "next/navigation";

import { getContext, hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { posunDatum } from "@/lib/provozni-den";
import { pocet } from "@/lib/sklonovani";
import { funkceNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import { datumACasVPasmu } from "@/lib/cas";
import { denZkraceny } from "@/lib/upozorneni-text";
import Sdeleni from "@/app/sdeleni";
import { PanelHlava } from "../../dnes/prvky";
import Nadpis from "../../nadpis";
import { odmitnoutSmenu, potvrditRadekSmeny, potvrditVsechnyMojeSmeny } from "./akce";
import OdmitnoutSmenu from "./odmitnout";

export const dynamic = "force-dynamic";

/**
 * Potvrzení směn — „potvrzovací tabulka“, jak žádá Šéfík (zadání
 * 29. 9. 2026): „nastav aby při vydání směny se vyslala hromadná
 * notifikace těm lidem kterých se směna týká, zároveň možnost potvrzení
 * všech směn a nebo možnost nepotvrdit třeba jednu nebo více směn."
 *
 * Hromadnou notifikaci řeší databáze (`public.vydat_rozpis` teď jde přes
 * centrální `app.notifikovat` — migrace 20260929100000). Tahle obrazovka
 * je ta druhá půlka: kde se dá potvrdit/odmítnout.
 *
 * Dvě části na jedné obrazovce, stejný vzor jako Zálohy
 * (`dochazka/zalohy/page.tsx`, sekce „Čekají na potvrzení“ nad tabulkou):
 *
 *   MOJE     vydané směny volajícího za posledních 14 dní a bez horní
 *            meze do budoucna, se stavem a tlačítky Potvrdit / Odmítnout
 *            (`public.moje_smeny_k_potvrzeni`). Jen SVÉ směny — žádné
 *            „za zaměstnance“ (zadání o tom nemluví, viz migrace,
 *            oddíl „CO SE SCHVÁLNĚ NEDĚLÁ“).
 *   VEDOUCÍ  kdo na pobočkách, které volající plánuje (`shifts.manage`),
 *            potvrdil/odmítl/čeká (`public.smeny_potvrzeni_pobocky") —
 *            jen čtení, žádné akce.
 *
 * Vstupní brána: `shifts.read` NEBO `shifts.manage` aspoň na jedné
 * pobočce (ne jen `shifts.read`, jak to obrazovka dřív měla) — notifikace
 * `smena.odmitnuta` vede vedoucího rovnou sem a ten může mít jen
 * `shifts.manage` (nález kontroly 29. 9. 2026).
 *
 * Sem se nedá zapsat NIC přímo z aplikace — obojí jde přes RPC (akce.ts);
 * tabulka `smeny_potvrzeni` grant na přímý zápis z aplikace nemá.
 */

type MojeSmena = {
  shift_id: string;
  branch_id: string;
  pobocka: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  pauza_od: string | null;
  pauza_do: string | null;
  stav: "ceka" | "potvrzeno" | "odmitnuto";
  confirmed_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
};

type RadekPobockyDB = {
  shift_id: string;
  employee_id: string;
  jmeno: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  stav: "ceka" | "potvrzeno" | "odmitnuto";
  rozhodnuto_kdy: string | null;
  rejected_reason: string | null;
};

type RadekPobocky = RadekPobockyDB & { pobocka: string };

export default async function PotvrzeniSmen({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string; ulozeno?: string; pocet?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba, ulozeno, pocet: pocetText } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  // Dvě různá práva, jedna obrazovka — stejný vzor jako Zálohy
  // (dochazka/zalohy/page.tsx). Kdo vidí rozpis (shifts.read) patří
  // dovnitř, jako dřív; NOVĚ smí dovnitř i ten, kdo shifts.read nemá,
  // ale plánuje aspoň jednu pobočku (shifts.manage) — notifikace
  // „smena.odmitnuta” vede právě sem a čekala by i na vedoucího s jen
  // shifts.manage (nález kontroly 29. 9. 2026: Bedřich v krok64_scenar
  // má position_permissions jen shifts.manage). Obě sekce dole si právo
  // hlídají samy na zdroji (moje_smeny_k_potvrzeni podle vlastnictví
  // směny, smeny_potvrzeni_pobocky podle shifts.manage) — tenhle blok
  // jen rozhoduje, jestli se stránka vůbec otevře.
  const pristup = await zkusPristup(tenantId, "shifts.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");

  const mamShiftsRead = pristup.stav === "ok";
  const ctx = mamShiftsRead ? pristup.ctx : await getContext(tenantId);
  if (!ctx) redirect("/prihlaseni");

  const supabase = await getServerSupabase();

  /* --- VEDOUCÍ (spočteno napřed, ať se dá rozhodnout o vstupu) ------ */

  // Pobočky, na kterých volající plánuje (shifts.manage) — stejný výpočet
  // jako `pobockyProPlanovani` v hlavním Rozpisu (page.tsx).
  const pobockyProPlanovani = (
    await Promise.all(
      ctx.branches.map(async (b) => ((await hasAccess(tenantId, "shifts.manage", b.id)) ? b : null)),
    )
  ).filter((b): b is (typeof ctx.branches)[number] => b !== null);

  if (!mamShiftsRead && pobockyProPlanovani.length === 0) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Potvrzení směn vidí ten, kdo vidí rozpis (<code>shifts.read</code>), nebo kdo plánuje
        aspoň jednu pobočku (<code>shifts.manage</code>).
      </Sdeleni>
    );
  }

  /* --- MOJE ------------------------------------------------------- */

  const { data: mojeData, error: chybaMoje } = await supabase.rpc("moje_smeny_k_potvrzeni", {
    p_tenant: tenantId,
  });

  // Nenasazená migrace obrazovku neshodí, jen řekne, na co se čeká —
  // stejně jako Zálohy před 25. 9.
  if (funkceNeexistuje(chybaMoje)) {
    return (
      <>
        <Hlavicka />
        <div style={{ padding: "16px" }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{" "}
            Potvrzování a odmítání směn přibude migrací{" "}
            <code>20260929100000_smeny_potvrzeni_tabulka</code>.
          </p>
        </div>
      </>
    );
  }

  // Jiná chyba (PT403 — bez zaměstnaneckého záznamu, nebo modul „provoz”
  // vypnutý): není co potvrzovat, ne chyba stránky. Vedoucí sekce níž
  // pořád může mít co ukázat.
  const moje = (chybaMoje ? [] : ((mojeData ?? []) as MojeSmena[]));
  const cekajici = moje.filter((s) => s.stav === "ceka");

  /* --- VEDOUCÍ, pokračování ------------------------------------------ */

  // Okno pro přehled vedoucího: dva týdny zpátky (stejně jako „Moje”) a
  // dva týdny dopředu — RPC na rozdíl od moje_smeny_k_potvrzeni potřebuje
  // explicitní horní mez. Číslo je vlastní rozhodnutí (zadání ani vzor
  // zalohy_pobocky žádné nedávají), na obyčejném datu jako v databázi
  // (current_date), ne přes provozní den pobočky — je to jen okno
  // přehledu, ne uzávěrka.
  const dnes = new Date().toISOString().slice(0, 10);
  const odVedouci = posunDatum(dnes, -14);
  const doVedouci = posunDatum(dnes, 14);

  // Paralelne, stejne jako vypocet pobockyProPlanovani vyse - vic
  // pobocek se tu necekalo soucasne, kazde RPC volani cekalo na
  // predchozi (nalez kontroly 29. 9. 2026).
  const pobockovaData: RadekPobocky[] = (
    await Promise.all(
      pobockyProPlanovani.map(async (b) => {
        const { data, error } = await supabase.rpc("smeny_potvrzeni_pobocky", {
          p_tenant: tenantId,
          p_branch: b.id,
          p_od: odVedouci,
          p_do: doVedouci,
        });
        if (error) return [];
        return ((data ?? []) as RadekPobockyDB[]).map((r) => ({ ...r, pobocka: b.name }));
      }),
    )
  ).flat();
  pobockovaData.sort(
    (a, b) => a.shift_date.localeCompare(b.shift_date) || a.starts_at.localeCompare(b.starts_at),
  );
  const vicePobocek = pobockyProPlanovani.length > 1;

  const nicKUkazani = moje.length === 0 && pobockyProPlanovani.length === 0;

  return (
    <>
      <Hlavicka />
      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {chyba ? <p className="hlaska-chyba">{decodeURIComponent(chyba)}</p> : null}
        {ulozeno === "vse" ? (
          <p style={hlaskaDobre}>
            {pocetText && Number(pocetText) > 0
              ? `Potvrzeno ${pocet(Number(pocetText), "směna", "směny", "směn")}.`
              : "Nebylo co potvrdit — vydané směny už máte rozhodnuté."}
          </p>
        ) : null}
        {ulozeno === "jedna" ? <p style={hlaskaDobre}>Směna potvrzená.</p> : null}
        {ulozeno === "odmitnuto" ? (
          <p style={hlaskaDobre}>Směna odmítnutá. Vedoucí pobočky o tom dostal upozornění.</p>
        ) : null}

        {nicKUkazani ? (
          <Sdeleni nadpis="Není co potvrzovat">
            Nemáte tu vydanou směnu k rozhodnutí ani právo vidět, kdo potvrdil za pobočku.
          </Sdeleni>
        ) : null}

        {moje.length > 0 ? (
          <section className="ds-plocha" aria-label="Moje směny k potvrzení" style={{ marginBottom: "24px" }}>
            <PanelHlava ikona="fajfkaKruh" nadpis="Moje směny" />
            <p style={popisSekce}>
              Vydané směny za poslední dva týdny a všechny nadcházející. Potvrďte, že o směně víte,
              nebo ji odmítněte s důvodem — obojí jde kdykoli vzít zpět.
            </p>

            {cekajici.length > 0 ? (
              <form action={potvrditVsechnyMojeSmeny} style={{ margin: "4px 0 14px" }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <button type="submit" className="ft-tl ft-tl-hlavni">
                  Potvrdit vše ({cekajici.length})
                </button>
              </form>
            ) : null}

            {/*
              Tabulka (počítač) a karty (telefon) — STEJNÝ vzor jako
              Docházka → Výdělky (`ds-vy-tabulka-obal` / `ds-vy-karty` v
              app/_komponenty.css, 24. 9. 2026): obě varianty se vykreslí
              vždy, CSS `@container` mezi nimi přepíná podle šířky
              OBSAHU (`.ds-pot-tab`), ne podle okna — stejný důvod jako
              tam, levý sloupec aplikace ukrojí různě. Bez toho by na
              390 px zůstal jen vodorovný scroll bez náznaku a sloupce
              Stav a Akce (tlačítka Potvrdit/Odmítnout, hlavní smysl téhle
              obrazovky) by byly mimo viditelnou oblast (nález nezávislého
              vizuálního ověření 29. 9. 2026).
            */}
            <div className="ds-pot-tab">
              <div className="ds-pot-tabulka-obal">
                <table style={tabulka}>
                  <thead>
                    <tr style={headRow}>
                      <th style={th}>Den</th>
                      <th style={th}>Čas</th>
                      <th style={th}>Pobočka</th>
                      <th style={th}>Stav</th>
                      <th style={th}>Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moje.map((s) => (
                      <tr key={s.shift_id} style={tr} data-smena={s.shift_id}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{denZkraceny(s.shift_date)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {cas(s.starts_at)}–{cas(s.ends_at)}
                        </td>
                        <td style={td}>{s.pobocka}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <StavStitek
                            stav={s.stav}
                            kdy={s.confirmed_at ?? s.rejected_at}
                            duvod={s.rejected_reason}
                          />
                        </td>
                        <td style={td}>
                          <AkceMoje s={s} rozsah={rozsah} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Telefon: stejná data jako řádek tabulky, jen jako karta. */}
              <ul className="ds-pot-karty">
                {moje.map((s) => (
                  <li key={s.shift_id} className="ds-pot-karta" data-smena={s.shift_id}>
                    <div className="ds-pot-karta-hlava">
                      <span className="ds-pot-karta-den">{denZkraceny(s.shift_date)}</span>
                      <span className="ds-pot-karta-cas">
                        {cas(s.starts_at)}–{cas(s.ends_at)}
                      </span>
                    </div>
                    <p className="ds-pot-karta-pobocka">{s.pobocka}</p>
                    <div className="ds-pot-karta-stav">
                      <StavStitek
                        stav={s.stav}
                        kdy={s.confirmed_at ?? s.rejected_at}
                        duvod={s.rejected_reason}
                      />
                    </div>
                    <div className="ds-pot-karta-akce">
                      <AkceMoje s={s} rozsah={rozsah} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {pobockyProPlanovani.length > 0 ? (
          <section className="ds-plocha" aria-label="Kdo potvrdil">
            <PanelHlava ikona="lide" nadpis="Kdo potvrdil" />
            <p style={popisSekce}>
              Vydané směny na {vicePobocek ? "vašich pobočkách" : "vaší pobočce"} za poslední dva týdny
              a dva týdny dopředu. Potvrdit nebo odmítnout za zaměstnance odsud nejde — každý si
              rozhoduje sám.
            </p>
            {pobockovaData.length === 0 ? (
              <p style={popisSekce}>V tomhle období není žádná vydaná směna.</p>
            ) : (
              <div className="ds-pot-tab">
                <div className="ds-pot-tabulka-obal">
                  <table style={tabulka}>
                    <thead>
                      <tr style={headRow}>
                        <th style={th}>Den</th>
                        <th style={th}>Čas</th>
                        <th style={th}>Kdo</th>
                        {vicePobocek ? <th style={th}>Pobočka</th> : null}
                        <th style={th}>Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pobockovaData.map((r) => (
                        <tr
                          key={`${r.shift_id}-${r.employee_id}`}
                          style={tr}
                          data-radek={`${r.shift_id}-${r.employee_id}`}
                        >
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{denZkraceny(r.shift_date)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                            {cas(r.starts_at)}–{cas(r.ends_at)}
                          </td>
                          <td style={td}>{r.jmeno}</td>
                          {vicePobocek ? <td style={td}>{r.pobocka}</td> : null}
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <StavStitek stav={r.stav} kdy={r.rozhodnuto_kdy} duvod={r.rejected_reason} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Telefon: stejná data jako řádek tabulky, jen jako karta. */}
                <ul className="ds-pot-karty">
                  {pobockovaData.map((r) => (
                    <li
                      key={`${r.shift_id}-${r.employee_id}`}
                      className="ds-pot-karta"
                      data-radek={`${r.shift_id}-${r.employee_id}`}
                    >
                      <div className="ds-pot-karta-hlava">
                        <span className="ds-pot-karta-den">{denZkraceny(r.shift_date)}</span>
                        <span className="ds-pot-karta-cas">
                          {cas(r.starts_at)}–{cas(r.ends_at)}
                        </span>
                      </div>
                      <p className="ds-pot-karta-pobocka">
                        {r.jmeno}
                        {vicePobocek ? ` · ${r.pobocka}` : ""}
                      </p>
                      <div className="ds-pot-karta-stav">
                        <StavStitek stav={r.stav} kdy={r.rozhodnuto_kdy} duvod={r.rejected_reason} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}

/** Hlavička jako u ostatních obrazovek Provozu — jeden h1, věta pod ním. */
function Hlavicka() {
  return (
    <Nadpis
      oci="Provoz"
      popis="Potvrďte vydané směny, nebo je s důvodem odmítněte. Vedoucí tu vidí, kdo ještě nerozhodl."
    >
      Potvrzení směn
    </Nadpis>
  );
}

/** „08:00“ z „08:00:00“. */
function cas(t: string): string {
  return t.slice(0, 5);
}

/**
 * Tlačítka Potvrdit / Odmítnout… za jednu směnu — JEDNA funkce pro
 * tabulkovou buňku Akce i pro kartu na telefonu (stejný vzor jako
 * `bunky()` v `dochazka/vydelky/tabulka-vydelku.tsx`: dvě kopie by se
 * dřív nebo později rozešly). Vykreslí se na obou místech vždy; kdo se
 * ukáže, rozhoduje jen CSS (`ds-pot-tabulka-obal` / `ds-pot-karty`).
 */
function AkceMoje({ s, rozsah }: { s: MojeSmena; rozsah: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {s.stav !== "potvrzeno" ? (
        <form action={potvrditRadekSmeny}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="smena" value={s.shift_id} />
          <input type="hidden" name="den" value={s.shift_date} />
          <input type="hidden" name="od" value={s.starts_at} />
          <input type="hidden" name="do" value={s.ends_at} />
          <input type="hidden" name="pauza_od" value={s.pauza_od ?? ""} />
          <input type="hidden" name="pauza_do" value={s.pauza_do ?? ""} />
          <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
            Potvrdit
          </button>
        </form>
      ) : null}
      {s.stav !== "odmitnuto" ? (
        <OdmitnoutSmenu akce={odmitnoutSmenu} smena={s.shift_id} rozsah={rozsah} />
      ) : null}
    </div>
  );
}

/** Stav řádku — čeká / potvrzeno / odmítnuto. Stejný vzor jako StavStitek u Záloh. */
function StavStitek({
  stav,
  kdy,
  duvod,
}: {
  stav: "ceka" | "potvrzeno" | "odmitnuto";
  kdy: string | null;
  duvod: string | null;
}) {
  if (stav === "potvrzeno") {
    return (
      <span style={{ color: "var(--dobre)", fontSize: "13px" }}>
        potvrzeno
        {kdy ? (
          <span style={{ display: "block", color: "var(--muted)", fontSize: "12px" }}>
            {datumACasVPasmu(kdy)}
          </span>
        ) : null}
      </span>
    );
  }
  if (stav === "odmitnuto") {
    return (
      <span style={{ color: "var(--bad)", fontSize: "13px" }}>
        odmítnuto
        {duvod ? (
          <span style={{ display: "block", color: "var(--muted)", fontSize: "12px" }}>{duvod}</span>
        ) : null}
      </span>
    );
  }
  return <span style={{ color: "var(--pozor)", fontSize: "13px" }}>čeká na potvrzení</span>;
}

const popisSekce = {
  margin: "0 0 8px",
  fontSize: "13px",
  color: "var(--muted)",
  maxWidth: "62ch",
  lineHeight: 1.5,
} as const;

const hlaskaDobre = {
  margin: "0 0 16px",
  fontSize: "14px",
  color: "var(--dobre)",
} as const;

const tabulka = {
  width: "100%",
  borderCollapse: "collapse" as const,
  minWidth: "560px",
} as const;

const headRow = { borderBottom: "1px solid var(--line)" } as const;

const th = {
  padding: "10px 12px",
  textAlign: "left" as const,
  fontSize: "11px",
  fontWeight: "600",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".06em",
} as const;

const tr = { borderBottom: "1px solid var(--line)" } as const;
const td = { padding: "12px" } as const;

const ramecek = {
  margin: 0,
  padding: "10px 12px",
  border: "1px solid var(--pozor)",
  borderRadius: "var(--radius-sm)",
  background: "var(--pozor-bg)",
  color: "var(--pozor)",
  fontSize: "14px",
} as const;
