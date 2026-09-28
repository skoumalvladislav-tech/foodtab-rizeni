import Link from "next/link";

import { koruny, nazevMesice } from "@/lib/mzdy";
import { pocet } from "@/lib/sklonovani";
import {
  casZaznamu,
  denNadpis,
  minutySlovy,
  naZdi,
  souhrnMesice,
  zdrojSlovy,
  type DenUseku,
  type Odkud,
  type PenizeDne,
  type RadekUseku,
} from "@/lib/useky-dochazky";
import { KpiKarta, PanelHlava } from "../../dnes/prvky";
import SeznamUseku from "./seznam-useku";
import UpravaUseku, { type Hodnota } from "./uprava-useku";

/**
 * Docházka jednoho člověka za měsíc po provozních dnech — kreslicí část
 * obrazovky /[rozsah]/dochazka/clovek/[id].
 *
 * ČISTĚ KRESLICÍ jako tabulka-vydelku.tsx: žádný dotaz, žádné právo.
 * Co se smí ukázat, rozhodla databáze (`public.useky_cloveka` —
 * viditelnost po záznamu, `den_minut` jen tomu, kdo vidí celý den,
 * `smi_spravovat` u řádku) a stránka (attendance.read, peníze jen
 * s payroll.read). Sem chodí hotová čísla; součet dne i měsíce se tu
 * NEPOČÍTÁ z úseků, jen se sečtou dny z databáze.
 *
 * Mzdy a docházka nikdy do jazykového modelu (pravidlo 8).
 */

export type ObdobiCloveka = "tento" | "minuly";

export type Vysledek =
  | { druh: "ulozeno" | "stornovano"; den: string | null }
  | { druh: "chyba"; den: string | null; text: string };

export default function SmenyCloveka({
  rozsah,
  osoba,
  mesic,
  obdobi,
  dnes,
  dny,
  penize,
  pobocky,
  spravovane,
  smiZapsat,
  odkud,
  predchozi,
  nasledujici,
  vysledek,
}: {
  rozsah: string;
  osoba: { id: string; jmeno: string };
  /** První den měsíce, RRRR-MM-DD. */
  mesic: string;
  obdobi: ObdobiCloveka;
  /** Dnešní provozní den (u otevřeného úseku „v práci od"). */
  dnes: string | null;
  dny: DenUseku[];
  /**
   * Peníze po dnech (`vydelek_cloveka_po_dnech`, VŠECHNY dny měsíce —
   * i ty, jejichž úseky volající nevidí). null = bez práva na peníze
   * (payroll.read) — pak se nekreslí vůbec.
   */
  penize: Map<string, PenizeDne> | null;
  /** Názvy všech poboček, které volající vidí. */
  pobocky: Record<string, string>;
  /** Pobočky, na kterých volající docházku spravuje (formulář). */
  spravovane: { id: string; nazev: string }[];
  /** Nabídnout „Zapsat úsek" (spravuje aspoň jednu pobočku a není to on sám, pokud není majitel). */
  smiZapsat: boolean;
  odkud: Odkud | null;
  predchozi: { href: string; mesic: string };
  nasledujici: { href: string; mesic: string } | null;
  vysledek: Vysledek | null;
}) {
  const sPenezi = penize !== null;
  const s = souhrnMesice(dny, penize);
  const nazev = `${velkym(nazevMesice(mesic))} ${mesic.slice(0, 4)}`;
  // Hláška patří ke dni; když ten den tady kartu nemá (nový úsek jinde),
  // ukáže se nahoře — jinak by uložení nemělo žádnou odezvu.
  const hlaskaNahore = vysledek !== null && (!vysledek.den || !dny.some((d) => d.den === vysledek.den));
  const mesicAdresy = mesic.slice(0, 7);
  const viceBranches =
    new Set(
      dny.flatMap((d) =>
        [...d.useky, ...d.nezapocitane, ...d.stornovane].flatMap((r) => [r.prichod?.pobocka, r.odchod?.pobocka]),
      ).filter(Boolean),
    ).size > 1;
  const smiNeco = dny.some((d) => [...d.useky, ...d.nezapocitane].some((r) => r.smiSpravovat));

  const spolecne = {
    rozsah,
    zamestnanec: osoba.id,
    mesic: mesicAdresy,
    odkud,
  };

  const akce = (den: DenUseku) =>
    function TlacitkaDne(r: RadekUseku) {
      return <TlacitkaUseku r={r} den={den} spolecne={spolecne} spravovane={spravovane} />;
    };

  const dnyNedokoncene = new Set(s.dnyNedokoncene);

  return (
    <div className="ds-vy ds-uc">
      <div className="ds-vy-lista">
        <p className="ds-vy-obdobi">
          <span className="ds-serif ds-vy-mesic">{nazev}</span>
          <span>{obdobi === "tento" ? "běžící měsíc — do dneška" : "uzavřený měsíc"}</span>
        </p>
        <nav className="ds-vy-mesice" aria-label="Měsíc">
          <Link
            href={predchozi.href}
            className="ft-tl ft-tl-vedlejsi ft-tl-male"
            aria-label={`Předchozí měsíc: ${nazevMesice(predchozi.mesic)} ${predchozi.mesic.slice(0, 4)}`}
          >
            ← {nazevMesice(predchozi.mesic)}
          </Link>
          {nasledujici ? (
            <Link
              href={nasledujici.href}
              className="ft-tl ft-tl-vedlejsi ft-tl-male"
              aria-label={`Následující měsíc: ${nazevMesice(nasledujici.mesic)} ${nasledujici.mesic.slice(0, 4)}`}
            >
              {nazevMesice(nasledujici.mesic)} →
            </Link>
          ) : null}
        </nav>
      </div>

      {obdobi === "minuly" && (smiNeco || smiZapsat) ? (
        <p className="ds-uc-pruh" role="note">
          <strong>Uzavřený měsíc.</strong> Úprava změní už spočítanou mzdu — zálohy ani výplata se tím
          samy neopraví.
        </p>
      ) : null}

      {vysledek && hlaskaNahore ? <Hlaska vysledek={vysledek} /> : null}

      {dny.length === 0 ? (
        <section className="ds-plocha ds-vy-prazdno" role="status">
          <p>
            Za {nazevMesice(mesic)} tu {osoba.jmeno} nemá žádnou docházku, kterou vidíte.
          </p>
          {sPenezi && s.dnuPenezJinde > 0 ? (
            <p>
              Mzda za měsíc podle Výdělků:{" "}
              <strong className="ds-cislo">
                {s.bezSazby && (s.haleru ?? 0) === 0 ? "bez sazby" : koruny(s.haleru ?? 0)}
              </strong>{" "}
              — ze dnů na pobočkách, kam docházku nevidíte.
            </p>
          ) : null}
          {smiZapsat ? <div className="ds-uc-novy">{novyUsek()}</div> : null}
        </section>
      ) : (
        <>
          <div className="ds-kpi-mrizka">
            <KpiKarta
              ikona="hodiny"
              ton="dobre"
              titulek="Odpracováno"
              hodnota={minutySlovy(s.minut)}
              popisy={[
                `${pocet(s.dni, "den", "dny", "dnů")} · ${pocet(s.useku, "úsek", "úseky", "úseků")}`,
                s.castecne ? "jen pobočky, kam vidíte — není to celá mzda" : "uzavřené úseky, jako mzda",
              ]}
            />
            <KpiKarta
              ikona={s.nedokoncene > 0 ? "varovani" : "fajfkaKruh"}
              ton={s.nedokoncene > 0 ? "pozor" : "neutral"}
              titulek="Nedokončené"
              hodnota={String(s.nedokoncene)}
              popisy={[
                s.nedokoncene > 0
                  ? `${pocet(s.dnyNedokoncene.length, "den", "dny", "dnů")} — do mzdy se nepočítá`
                  : "všechno spárované",
              ]}
            >
              {s.dnyNedokoncene.length > 0 ? (
                <p className="ds-kpi-popis ds-uc-kotvy">
                  {s.dnyNedokoncene.map((d, i) => (
                    <span key={d}>
                      {i > 0 ? ", " : ""}
                      <a href={`#den-${d}`}>{denNadpis(d)}</a>
                    </span>
                  ))}
                </p>
              ) : null}
            </KpiKarta>
            <KpiKarta
              ikona="tuzka"
              ton="info"
              titulek="Opravy"
              hodnota={String(s.opravy)}
              popisy={["stornované a nahrazené záznamy — nic se nemaže"]}
            />
            {sPenezi ? (
              <KpiKarta
                ikona="mince"
                ton="neutral"
                titulek="Vyděláno"
                hodnota={s.bezSazby && (s.haleru ?? 0) === 0 ? "bez sazby" : koruny(s.haleru ?? 0)}
                popisy={[
                  "hrubá mzda za celý měsíc, jako Výdělky",
                  s.dnuPenezJinde > 0
                    ? `včetně ${pocet(s.dnuPenezJinde, "dne", "dnů", "dnů")} na pobočkách, kam docházku nevidíte`
                    : null,
                  s.bezSazby ? "část dnů bez sazby — v součtu chybí" : null,
                ]}
              />
            ) : null}
          </div>

          <div className="ds-uc-rozlozeni">
            <div className="ds-uc-dny">
              {dny.map((d) => (
                <section
                  key={d.den}
                  id={`den-${d.den}`}
                  className="ds-plocha ds-uc-den"
                  data-den={d.den}
                  data-nedokoncene={dnyNedokoncene.has(d.den) ? "" : undefined}
                >
                  <div className="ds-uc-den-hlava">
                    <h3 className="ds-uc-den-nadpis">{denNadpis(d.den)}</h3>
                    <p className="ds-uc-den-soucet">
                      {d.denMinut === null ? (
                        <span className="ds-uc-castecne">součet jen s celým dnem</span>
                      ) : (
                        <span className="ds-cislo">{minutySlovy(d.denMinut)}</span>
                      )}
                      {sPenezi && d.penize ? (
                        <span className="ds-uc-den-penize">
                          {d.penize.haleru === null ? "bez sazby" : koruny(d.penize.haleru)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {vysledek && vysledek.den === d.den ? <Hlaska vysledek={vysledek} /> : null}
                  <SeznamUseku den={d} dnes={dnes} pobocky={pobocky} viceBranches={viceBranches} akce={akce(d)} />
                </section>
              ))}
              {smiZapsat ? <div className="ds-uc-novy">{novyUsek()}</div> : null}
            </div>

            <aside className="ds-uc-bok">
              <section className="ds-plocha">
                <PanelHlava ikona="vykricnik" nadpis="Nedokončené" />
                {s.dnyNedokoncene.length === 0 ? (
                  <p className="ds-uc-bok-text">Nic — každý příchod má svůj odchod.</p>
                ) : (
                  <ul className="ds-uc-bok-seznam">
                    {dny
                      .filter((d) => dnyNedokoncene.has(d.den))
                      .map((d) => (
                        <li key={d.den}>
                          <a href={`#den-${d.den}`}>{denNadpis(d.den)}</a>
                          <span>{popisNedokonceneho(d)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      <ul className="ds-vy-vysvetlivky">
        <li>
          Do mzdy se počítají jen <strong>uzavřené úseky</strong> — příchod a nejbližší odchod v témže
          provozním dni. Otevřený úsek, druhý příchod a odchod bez příchodu jsou vidět, ale nepočítají se.
        </li>
        <li>
          Odečítá se zapsaná přestávka; když žádná není, paušál podle nastavení firmy. Noc po půlnoci patří
          ke dni, kdy se přišlo.
        </li>
        <li>
          Den se počítá ze sekund, takže součet úseků se od dne může lišit o minutu. Platí číslo u dne —
          to je to, ze kterého je mzda.
        </li>
        <li>
          Oprava ani storno nic nemažou: starý záznam zůstane přeškrtnutý i s důvodem, kdo a kdy. Úprava se
          zapíše jako ruční záznam s vaším jménem.
        </li>
        {sPenezi ? <li>Částky jsou hrubá mzda, orientačně — před daněmi a odvody.</li> : null}
      </ul>
    </div>
  );

  function novyUsek() {
    return (
      <UpravaUseku
        {...spolecne}
        den={null}
        prichodId={null}
        odchodId={null}
        popisTed={null}
        rezim="novy"
        nadpis={`Zapsat úsek · ${osoba.jmeno}`}
        popisek="Zapsat úsek"
        ikona="plus"
        prichod={null}
        odchod={null}
        pobocky={spravovane}
      />
    );
  }
}

/* --- kousky ------------------------------------------------------------ */

/** Tlačítka u úseku podle jeho druhu. Jen kreslení; rozhoduje databáze. */
function TlacitkaUseku({
  r,
  den,
  spolecne,
  spravovane,
}: {
  r: RadekUseku;
  den: DenUseku;
  spolecne: { rozsah: string; zamestnanec: string; mesic: string; odkud: Odkud | null };
  spravovane: { id: string; nazev: string }[];
}) {
  if (!r.smiSpravovat) return null;
  const ted = popisTed(r);
  const nadpisDne = denNadpis(den.den);
  const zaklad = { ...spolecne, den: den.den, prichodId: r.prichod?.id ?? null, odchodId: r.odchod?.id ?? null, popisTed: ted };
  const p = hodnota(r.prichod);
  const o = hodnota(r.odchod);

  if (r.druh === "usek") {
    // Storno i vedle „Upravit" na kartě: majitel hledá „stornovat
    // směnu", ne „upravit" (zadání 27. 9.). V panelu úpravy zůstává taky.
    return (
      <>
        <UpravaUseku
          {...zaklad}
          rezim="upravit"
          nadpis={`Upravit úsek · ${nadpisDne}`}
          popisek="Upravit"
          ikona="tuzka"
          prichod={p}
          odchod={o}
          pobocky={spravovane}
          stornoPopisek="Stornovat úsek"
        />
        <UpravaUseku
          {...zaklad}
          rezim="storno"
          nadpis={`Stornovat úsek · ${nadpisDne}`}
          popisek="Stornovat úsek"
          prichod={null}
          odchod={null}
          pobocky={spravovane}
          stornoPopisek="Stornovat úsek"
        />
      </>
    );
  }
  if (r.druh === "otevreny") {
    return (
      <>
        <UpravaUseku
          {...zaklad}
          rezim="doplnit-odchod"
          nadpis={`Doplnit odchod · ${nadpisDne}`}
          popisek="Doplnit odchod"
          hlavni
          prichod={p}
          // Datum odchodu jako příchod, čas prázdný: ten aplikace vědět nemůže.
          odchod={p ? { datum: p.datum, cas: "", pobocka: p.pobocka } : null}
          pobocky={spravovane}
        />
        <UpravaUseku
          {...zaklad}
          rezim="storno"
          nadpis={`Stornovat příchod · ${nadpisDne}`}
          popisek="Stornovat příchod"
          prichod={null}
          odchod={null}
          pobocky={spravovane}
          stornoPopisek="Stornovat příchod"
        />
      </>
    );
  }
  return (
    <>
      {r.druh === "odchod_bez_prichodu" ? (
        <UpravaUseku
          {...zaklad}
          rezim="doplnit-prichod"
          nadpis={`Doplnit příchod · ${nadpisDne}`}
          popisek="Doplnit příchod"
          prichod={o ? { datum: den.den, cas: "", pobocka: o.pobocka } : null}
          odchod={o}
          pobocky={spravovane}
        />
      ) : null}
      <UpravaUseku
        {...zaklad}
        rezim="storno"
        nadpis={`Stornovat záznam · ${nadpisDne}`}
        popisek="Stornovat záznam"
        prichod={null}
        odchod={null}
        pobocky={spravovane}
        stornoPopisek="Stornovat záznam"
      />
    </>
  );
}

function Hlaska({ vysledek }: { vysledek: Vysledek }) {
  if (vysledek.druh === "chyba") {
    return (
      <p className="hlaska-chyba ds-uc-hlaska" role="alert">
        {vysledek.text}
      </p>
    );
  }
  return (
    <p className="ds-uc-hlaska" data-ton="dobre" role="status">
      {vysledek.druh === "ulozeno" ? "Uloženo. Čísla níž jsou už nová, z databáze." : "Stornováno. Záznam zůstal přeškrtnutý níž."}
    </p>
  );
}

/** „Teď: 08:39 kód → 21:10 kód · 12 h 21 min" do formuláře. */
function popisTed(r: RadekUseku): string | null {
  const kusy: string[] = [];
  if (r.prichod) kusy.push(`${casZaznamu(r.prichod)} ${zdrojSlovy(r.prichod)}`);
  if (r.druh === "usek" || r.druh === "otevreny") kusy.push("→");
  if (r.odchod) kusy.push(`${casZaznamu(r.odchod)} ${zdrojSlovy(r.odchod)}`);
  else if (r.druh === "otevreny") kusy.push("bez odchodu");
  const minuty = r.druh === "usek" ? ` · ${minutySlovy(r.cistychSekund / 60)}` : "";
  return kusy.length ? `Teď: ${kusy.join(" ")}${minuty}` : null;
}

function hodnota(z: RadekUseku["prichod"]): Hodnota {
  const w = naZdi(z);
  return w && z ? { ...w, pobocka: z.pobocka ?? "" } : null;
}

function popisNedokonceneho(d: DenUseku): string {
  const kusy: string[] = [];
  const otevrene = d.useky.filter((u) => u.druh === "otevreny").length;
  if (otevrene) kusy.push("chybí odchod");
  const navic = d.nezapocitane.filter((u) => u.druh === "navic_prichod").length;
  if (navic) kusy.push(pocet(navic, "druhý příchod", "druhé příchody", "druhých příchodů"));
  const bez = d.nezapocitane.filter((u) => u.druh === "odchod_bez_prichodu").length;
  if (bez) kusy.push("odchod bez příchodu");
  const prest = d.nezapocitane.filter((u) => u.druh === "prestavka_mimo").length;
  if (prest) kusy.push("přestávka mimo úsek");
  return kusy.join(", ");
}

function velkym(slovo: string): string {
  return slovo.charAt(0).toUpperCase() + slovo.slice(1);
}
