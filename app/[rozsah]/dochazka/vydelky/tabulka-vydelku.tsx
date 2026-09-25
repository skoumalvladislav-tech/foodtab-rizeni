import Link from "next/link";
import type { ReactNode } from "react";

import { hodinyAMinuty, koruny, nazevMesice, sazbaZaHodinu } from "@/lib/mzdy";
import { pocet } from "@/lib/sklonovani";
import { KpiKarta, PanelHlava } from "../../dnes/prvky";

/**
 * Výdělky lidí za měsíc — kreslicí část záložky Výdělky v Docházce.
 *
 * ČISTĚ KRESLICÍ, stejně jako dnes/prvky.tsx: žádný dotaz, žádné právo.
 * Co se smí ukázat, rozhodla stránka (payroll.read) a databáze
 * (`public.vydelky_prehled`); sem chodí hotová čísla. Díky tomu se
 * dá vykreslit v testu s podstrčenými daty (scripts/vydelky.test.mjs)
 * a ověřit, co opravdu stojí na obrazovce.
 *
 * Nic se tu nepočítá ze sazby — jen se sčítají a odečítají hotové
 * haléře z databáze. Sazby aplikace ani nevidí (employee_rates je pro
 * ni zavřená).
 *
 * Tři pravidla ze zadání mezd (docs/mzdy-zadani.md, oddíl 6), každé
 * s důvodem:
 *   * chybějící sazba NIKDY jako „0 Kč“ — nula vypadá jako výsledek,
 *     a tady je to díra v podkladech; píše se „bez sazby“
 *   * všechno je HRUBÁ mzda a orientačně — lidé si čísla čtou jako slib
 *   * hodiny jedním tvarem (`hodinyAMinuty`) v celé tabulce, ať se dají
 *     sloupce porovnat očima
 *
 * Výdělky jsou mzdová data: nikdy do žádné cesty k jazykovému modelu
 * (CLAUDE.md, pravidlo 8) — ani jako souhrn.
 */

/** Jeden řádek z `public.vydelky_prehled` — kontrakt DB → aplikace. */
export type RadekVydelku = {
  employee_id: string;
  full_name: string;
  branch_id: string | null;
  /** Uzavřená docházka v měsíci (app.earnings). */
  odpracovano_minut: number;
  vydelano_haleru: number;
  /** Některý odpracovaný den bez sazby — ten v částce chybí. */
  sazba_chybi: boolean;
  /** Sazba k dnešnímu provoznímu dni (u minulého měsíce k jeho konci, u budoucího k 1. dni). */
  hodinova_haleru: number | null;
  /** Zbývající směny z rozpisu, čisté minuty (po pauze a paušálu). */
  plan_minut: number;
  plan_haleru: number;
  plan_sazba_chybi: boolean;
  plan_smen: number;
  /** Nestornované zálohy v měsíci, všechny pobočky. */
  zalohy_haleru: number;
  /** vydelano + plán */
  predbezne_haleru: number;
};

/** Který měsíc se ukazuje vůči dnešnímu provoznímu dni. */
export type Obdobi = "minuly" | "tento" | "budouci";

export default function TabulkaVydelku({
  radky,
  mesic,
  obdobi,
  naPobocce,
  pobocky,
  predchozi,
  nasledujici,
  poDnech = null,
}: {
  radky: RadekVydelku[];
  /** První den měsíce, RRRR-MM-DD. */
  mesic: string;
  obdobi: Obdobi;
  /** Pobočkový rozsah — lidé s touto domovskou pobočkou. */
  naPobocce: boolean;
  /** Názvy poboček podle id; na firemní úrovni u jména, jinak prázdné. */
  pobocky: Record<string, string>;
  /** Odkazy přepínače měsíců. `nasledujici` prázdné = dál se nejde. */
  predchozi: { href: string; mesic: string };
  nasledujici: { href: string; mesic: string } | null;
  /** Oddíl „Po dnech“ (po-dnech.tsx) — kreslí se pod lidmi. */
  poDnech?: ReactNode;
}) {
  const serazene = [...radky].sort((a, b) => a.full_name.localeCompare(b.full_name, "cs"));
  const s = souhrn(serazene);
  const nazev = `${velkym(nazevMesice(mesic))} ${mesic.slice(0, 4)}`;

  return (
    <div className="ds-vy">
      <div className="ds-vy-lista">
        <p className="ds-vy-obdobi">
          <span className="ds-serif ds-vy-mesic">{nazev}</span>
          <span>{POPIS_OBDOBI[obdobi]}</span>
        </p>
        {/*
          Šipky jsou odkazy, ne tlačítka: měsíc patří do adresy, ať se dá
          poslat i vrátit tlačítkem zpět (stejně jako dlaždice výdělku).
          Popisek slovem — samotná šipka odečítači nic neřekne.
        */}
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

      {serazene.length === 0 ? (
        <section className="ds-plocha ds-vy-prazdno" role="status">
          <p>
            Za {nazevMesice(mesic)} tu nikdo nemá uzavřenou docházku, směnu
            v rozpisu ani zálohu.
          </p>
        </section>
      ) : (
        <>
          <div className="ds-kpi-mrizka">
            <KpiKarta
              ikona="mince"
              ton="dobre"
              titulek={TITULEK_VYDELANO[obdobi]}
              hodnota={castkaSouctu(s.vydelano, s.bezSazby > 0)}
              popisy={[
                s.minut > 0
                  ? `${hodinyAMinuty(s.minut)} uzavřené docházky`
                  : "zatím žádná uzavřená docházka",
              ]}
            >
              <Varovani
                text={s.bezSazby > 0 ? `${pocet(s.bezSazby, "člověk", "lidé", "lidí")} bez sazby — v součtu chybí` : null}
              />
            </KpiKarta>

            <KpiKarta
              ikona="kalendar"
              ton="info"
              titulek="Předběžně za měsíc"
              hodnota={castkaSouctu(s.predbezne, s.bezSazby + s.planBezSazby > 0)}
              popisy={[popisPlanu(obdobi, s.planSmen, s.planMinut)]}
            >
              <Varovani
                text={
                  s.planBezSazby > 0
                    ? `${pocet(s.planBezSazby, "člověk má", "lidé mají", "lidí má")} v plánu dny bez sazby`
                    : null
                }
              />
            </KpiKarta>

            <KpiKarta
              ikona="kniha"
              ton="neutral"
              titulek="Zálohy"
              hodnota={koruny(s.zalohy)}
              popisy={[
                s.seZalohou > 0
                  ? `${pocet(s.seZalohou, "člověk", "lidé", "lidí")} · všechny pobočky`
                  : "za tenhle měsíc žádná",
                "nestornované, i ty, které čekají na PIN",
              ]}
            />

            {/*
              Po lidech, ne rozdíl součtů: kdo si vybral víc, než vydělal,
              nesnižuje výplatu ostatním. Přeplatek se proto ukáže zvlášť
              a lidé bez sazby se vynechají (vyděláno mají nižší, než je).
            */}
            <KpiKarta
              ikona={s.preplacenoLidi > 0 ? "varovani" : "fajfkaKruh"}
              ton={s.preplacenoLidi > 0 ? "pozor" : "neutral"}
              titulek="Zbývá k výplatě"
              hodnota={s.bezSazby > 0 && s.zbyvaLidi === 0 ? "bez sazby" : koruny(s.zbyva)}
              popisy={["po lidech: vyděláno minus zálohy, před daněmi a odvody"]}
            >
              <Varovani
                text={
                  s.preplacenoLidi > 0
                    ? `přeplaceno ${koruny(s.preplaceno)} u ${pocet(s.preplacenoLidi, "člověka", "lidí", "lidí")} — od ostatních se neodečítá`
                    : null
                }
              />
              <Varovani
                text={s.bezSazby > 0 ? `${pocet(s.bezSazby, "člověk", "lidé", "lidí")} bez sazby — v součtu chybí` : null}
              />
            </KpiKarta>
          </div>

          <section className="ds-plocha">
            <PanelHlava ikona="lide" nadpis={`Po lidech (${serazene.length})`} />

            {/*
              Široká plocha: tabulka. Když je obsah užší než 820 px
              (telefon, úzké okno vedle levého sloupce), nahradí ji karty
              níž — rozhoduje šířka `.ds-vy` (@container), ne okna.
            */}
            <div className="ds-vy-tabulka-obal">
              <table className="ds-vy-tabulka">
                <thead>
                  <tr>
                    {SLOUPCE.map((sl) => (
                      <th key={sl} scope="col" className={zvyraznit(sl)}>
                        {sl}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {serazene.map((r) => (
                    <tr key={r.employee_id} data-clovek={r.employee_id}>
                      <th scope="row">
                        <Clovek r={r} pobocka={naPobocce ? null : jmenoPobocky(r, pobocky)} />
                      </th>
                      {bunky(r).map((b, i) => (
                        <td key={SLOUPCE[i + 1]} className={zvyraznit(SLOUPCE[i + 1])}>
                          {b}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Telefon: každý člověk jako karta, stejné buňky, stejné tvary. */}
            <ul className="ds-vy-karty">
              {serazene.map((r) => (
                <li key={r.employee_id} className="ds-vy-karta" data-clovek={r.employee_id}>
                  <Clovek r={r} pobocka={naPobocce ? null : jmenoPobocky(r, pobocky)} />
                  <dl>
                    {bunky(r).map((b, i) => (
                      <div
                        key={SLOUPCE[i + 1]}
                        className={`ds-vy-radek${zvyraznit(SLOUPCE[i + 1]) ? " ds-vy-zbyva" : ""}`}
                      >
                        <dt>{SLOUPCE[i + 1]}</dt>
                        <dd>{b}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </section>

          {poDnech}
        </>
      )}

      <ul className="ds-vy-vysvetlivky">
        <li>
          Všechny částky jsou <strong>hrubá mzda</strong>, orientačně — před
          daněmi a odvody.
        </li>
        <li>
          „Vyděláno“ počítá jen uzavřenou docházku (příchod i odchod), se
          sazbou platnou v ten den. Kdo je právě v práci, přičte se po
          odchodu.
        </li>
        <li>
          „Předběžně“ je vyděláno a k tomu zbývající směny z rozpisu do
          konce měsíce — orientačně, včetně nevydaných konceptů, bez pauzy
          uvnitř směny a s paušální přestávkou jako u mzdy. Den, kdy už
          člověk docházku má, se nepočítá dvakrát.
        </li>
        <li>
          Zálohy jsou nestornované zálohy za měsíc ze všech poboček, i ty,
          které ještě čekají na PIN. „Zbývá“ = vyděláno minus zálohy,
          u každého zvlášť; kdo si vybral víc, má „přeplaceno“ a výplatu
          ostatních to nesnižuje.
        </li>
        <li>
          „Bez sazby“ znamená, že sazba chybí a z hodin se mzda spočítat
          nedá. Doplní ji ten, kdo spravuje mzdy.
        </li>
        <li>
          „Po dnech“ jsou tytéž mzdy rozložené na provozní dny (noc po
          půlnoci patří ke dni, kdy směna začala) a zálohy podle dne výdeje.
          Součet dnů je přesně součet sloupce Vyděláno — jednotlivý den se
          může lišit o haléř, protože mzda se zaokrouhluje až za měsíc.
        </li>
        {naPobocce ? (
          <li>
            Na pobočce jsou lidé, kteří k ní patří (domovská pobočka) —
            s hodinami a zálohami ze všech poboček, i po dnech.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* --- kousky ------------------------------------------------------------ */

const SLOUPCE = ["Jméno", "Odpracováno", "Vyděláno", "Zálohy", "Zbývá", "Plán", "Předběžně"] as const;

/**
 * „Zbývá“ je zůstatek člověka — to, na co se majitel ptá („kolik kdo má
 * zůstatek“, 24. 9. večer). Proto je sloupec zvýrazněný písmem, ne jen
 * barvou (oddíl 7 vzhledu), v tabulce i na kartách telefonu.
 */
function zvyraznit(sloupec: (typeof SLOUPCE)[number]): string | undefined {
  return sloupec === "Zbývá" ? "ds-vy-zbyva" : undefined;
}

const TITULEK_VYDELANO: Record<Obdobi, string> = {
  tento: "Vyděláno do dneška",
  minuly: "Vyděláno za měsíc",
  budouci: "Vyděláno",
};

const POPIS_OBDOBI: Record<Obdobi, string> = {
  tento: "běžící měsíc — vyděláno k dnešku, zbytek podle rozpisu",
  minuly: "uzavřený měsíc — jen odpracované, plán se nepřičítá",
  budouci: "měsíc teprve přijde — zatím jen podle rozpisu",
};

function Clovek({ r, pobocka }: { r: RadekVydelku; pobocka: string | null }) {
  return (
    <span className="ds-vy-clovek">
      <span className="ds-vy-jmeno">{r.full_name}</span>
      <span className="ds-vy-sazba">
        {r.hodinova_haleru !== null ? sazbaZaHodinu(r.hodinova_haleru) : "bez sazby"}
        {pobocka ? ` · ${pobocka}` : ""}
      </span>
    </span>
  );
}

/**
 * Buňky řádku po jménu, v pořadí `SLOUPCE`. Jedna funkce pro tabulku
 * i karty na telefonu — dvě kopie by se dřív nebo později rozešly.
 */
function bunky(r: RadekVydelku): ReactNode[] {
  return [
    r.odpracovano_minut > 0 ? hodinyAMinuty(r.odpracovano_minut) : <Nic key="o" />,
    vydelano(r),
    r.zalohy_haleru > 0 ? koruny(r.zalohy_haleru) : <Nic key="z" />,
    zbyva(r),
    r.plan_smen > 0 ? (
      `${pocet(r.plan_smen, "směna", "směny", "směn")} · ${hodinyAMinuty(r.plan_minut)}`
    ) : (
      <Nic key="p" />
    ),
    predbezne(r),
  ];
}

/** Vyděláno z uzavřené docházky. */
function vydelano(r: RadekVydelku): ReactNode {
  if (r.odpracovano_minut === 0) return <Nic />;
  if (r.sazba_chybi && r.vydelano_haleru === 0) return <BezSazby />;
  return (
    <>
      {koruny(r.vydelano_haleru)}
      {r.sazba_chybi ? <CastBezSazby /> : null}
    </>
  );
}

/**
 * Vyděláno minus zálohy. Bez sazby se spočítat nedá: částka by vyšla
 * nižší, než je, a mohla by tvrdit „přeplaceno“ tam, kde to neplatí.
 */
function zbyva(r: RadekVydelku): ReactNode {
  if (r.sazba_chybi) return <BezSazby />;
  if (r.vydelano_haleru === 0 && r.zalohy_haleru === 0) return <Nic />;
  const navic = preplatek(r);
  if (navic > 0) {
    // Slovo, ne jen červená: barva sama nic neřekne tomu, kdo ji nerozezná.
    return <span className="ds-vy-preplaceno">přeplaceno {koruny(navic)}</span>;
  }
  return koruny(zbyvaHaleru(r));
}

/** Kolik zbývá vyplatit v haléřích; přeplatek je nula, ne zápor. */
function zbyvaHaleru(r: RadekVydelku): number {
  return Math.max(0, r.vydelano_haleru - r.zalohy_haleru);
}

/**
 * Přeplatek v haléřích (zálohy nad výdělek), jinak 0.
 *
 * Rozhoduje ZAOKROUHLENÁ částka, tatáž, kterou ukáže `koruny()`:
 * přeplatek pod 50 haléřů by se jinak ukázal jako „přeplaceno 0 Kč“.
 * Bez sazby se přeplatek neurčuje vůbec — vyděláno je pak nižší, než
 * má být, a „přeplaceno“ by mohlo lhát.
 */
function preplatek(r: RadekVydelku): number {
  // Pojistka: oba volající řádky bez sazby vyřadí dřív, takže ji žádný
  // test neshodí (vědomě — viz memory „nadbytečná podmínka“).
  if (r.sazba_chybi) return 0;
  const haleru = r.zalohy_haleru - r.vydelano_haleru;
  return Math.round(haleru / 100) > 0 ? haleru : 0;
}

/** Vyděláno + zbývající plán. */
function predbezne(r: RadekVydelku): ReactNode {
  if (r.odpracovano_minut === 0 && r.plan_minut === 0) return <Nic />;
  const chybi = r.sazba_chybi || r.plan_sazba_chybi;
  if (chybi && r.predbezne_haleru === 0) return <BezSazby />;
  return (
    <>
      {koruny(r.predbezne_haleru)}
      {chybi ? <CastBezSazby /> : null}
    </>
  );
}

function BezSazby() {
  return <span className="ds-vy-bez-sazby">bez sazby</span>;
}

/** Část dnů bez sazby — částka je menší, než by měla být. Štítek, ne odstín. */
function CastBezSazby() {
  return <span className="ds-vy-znacka">část bez sazby</span>;
}

/** Prázdná buňka. Pomlčka, ne nula: nula by tvrdila výsledek. */
function Nic() {
  return (
    <span className="ds-vy-nic">
      <span aria-hidden="true">—</span>
      <span className="sr-only">nic</span>
    </span>
  );
}

function Varovani({ text }: { text: string | null }) {
  return text ? (
    <p className="ds-kpi-popis" data-tone="bad">
      {text}
    </p>
  ) : null;
}

function jmenoPobocky(r: RadekVydelku, pobocky: Record<string, string>): string | null {
  return r.branch_id ? (pobocky[r.branch_id] ?? null) : null;
}

/**
 * Součet za lidi v tabulce. Jen sčítání hotových čísel z databáze.
 *
 * „Zbývá“ se sčítá PO LIDECH (součet max(0, vyděláno − zálohy)), ne
 * jako rozdíl součtů: jinak by přeplatek jednoho snížil výplatu všem
 * ostatním. Přeplatky jdou zvlášť. Lidé bez sazby v obojím chybí — jejich
 * vyděláno je nižší, než má být (počítají se v `bezSazby`).
 */
function souhrn(radky: RadekVydelku[]) {
  const s = {
    vydelano: 0,
    minut: 0,
    bezSazby: 0,
    predbezne: 0,
    planSmen: 0,
    planMinut: 0,
    planBezSazby: 0,
    zalohy: 0,
    seZalohou: 0,
    zbyva: 0,
    /** Kolik lidí se sazbou do „zbývá“ vstoupilo — nula znamená díru, ne 0 Kč. */
    zbyvaLidi: 0,
    preplaceno: 0,
    preplacenoLidi: 0,
  };
  for (const r of radky) {
    s.vydelano += r.vydelano_haleru;
    s.minut += r.odpracovano_minut;
    if (r.sazba_chybi) s.bezSazby++;
    s.predbezne += r.predbezne_haleru;
    s.planSmen += r.plan_smen;
    s.planMinut += r.plan_minut;
    if (r.plan_sazba_chybi) s.planBezSazby++;
    s.zalohy += r.zalohy_haleru;
    if (r.zalohy_haleru > 0) s.seZalohou++;
    if (r.sazba_chybi) continue;
    s.zbyvaLidi++;
    s.zbyva += zbyvaHaleru(r);
    const navic = preplatek(r);
    if (navic > 0) {
      s.preplaceno += navic;
      s.preplacenoLidi++;
    }
  }
  return s;
}

/**
 * Součet peněz do přehledové karty. Když v něm jsou jen lidé bez sazby,
 * není to nula, ale díra — „bez sazby“. Když chybí jen část, číslo se
 * ukáže a pod ním varování.
 */
function castkaSouctu(haleru: number, nekdoBezSazby: boolean): string {
  if (nekdoBezSazby && haleru === 0) return "bez sazby";
  return koruny(haleru);
}

function popisPlanu(obdobi: Obdobi, smen: number, minut: number): string {
  if (obdobi === "minuly") return "měsíc skončil — plán se nepřičítá";
  if (smen === 0) {
    return obdobi === "tento"
      ? "v rozpisu už do konce měsíce nic nezbývá"
      : "v rozpisu zatím nic není";
  }
  const kolik = `${pocet(smen, "směna", "směny", "směn")} · ${hodinyAMinuty(minut)}`;
  return obdobi === "tento" ? `+ ${kolik} podle rozpisu` : `${kolik} podle rozpisu`;
}

function velkym(slovo: string): string {
  return slovo.charAt(0).toUpperCase() + slovo.slice(1);
}
