import Link from "next/link";
import type { ReactNode } from "react";

import { hodinyAMinuty, koruny, nazevMesice, sazbaZaHodinu } from "@/lib/mzdy";
import { pocet } from "@/lib/sklonovani";
import { denZkraceny } from "@/lib/upozorneni-text";
import { KpiKarta, PanelHlava } from "../../dnes/prvky";

/**
 * Můj pracovní účet — kreslicí část záložky Můj účet v Docházce.
 *
 * Zadání majitele 24. 9. večer: „zaměstnanec ať má možnost vidět svůj
 * výdělek a odebrané zálohy … dal bych tam přehled pracovního účtu.“
 *
 * ČISTĚ KRESLICÍ, stejně jako tabulka Výdělků: žádný dotaz, žádné
 * právo. Kdo to je, rozhodla databáze (`public.muj_pracovni_ucet` —
 * jen já, podle přihlášení); co se ze záloh smí ukázat, taky ona
 * (volba firmy `zalohy_zobrazeni` chodí v každém řádku a sloupce, které
 * se ukázat nemají, jsou NULL). Sem chodí hotová čísla, nic se tu
 * nenásobí sazbou — jen se sčítají haléře do přehledových karet.
 *
 * Pravidla ze zadání mezd (oddíl 6), každé s důvodem:
 *   * chybějící sazba NIKDY jako „0 Kč“ — nula vypadá jako výsledek;
 *     píše se „bez sazby“
 *   * všechno je HRUBÁ mzda a orientačně — lidé si čísla čtou jako slib
 *   * pod částkou, z čeho vyšla (hodiny a sazba ke dni)
 *
 * Mzdy a zálohy nikdy do jazykového modelu (CLAUDE.md, pravidlo 8).
 */

/** Jeden řádek z `public.muj_pracovni_ucet` — kontrakt DB → aplikace. */
export type RadekUctu = {
  /** Provozní den, RRRR-MM-DD. */
  den: string;
  odpracovano_minut: number;
  /** Sazba ke dni; NULL = bez sazby, nebo den jen se zálohou. */
  hodinova_haleru: number | null;
  /** NULL = bez sazby, nebo den jen se zálohou (bez docházky). */
  vydelano_haleru: number | null;
  sazba_chybi: boolean;
  /** NULL = firma zálohy zaměstnancům neukazuje. */
  zalohy_haleru: number | null;
  zaloh: number | null;
  zaloh_nepotvrzenych: number | null;
  /** Průběžně k tomuto dni včetně; NULL = firma „zbývá“ neukazuje. */
  zustatek_haleru: number | null;
  /** Některý den do teď byl bez sazby — zůstatek je nižší, než bude. */
  zustatek_neuplny: boolean;
  zobrazeni: Zobrazeni;
};

export type Zobrazeni = "odecitat" | "jen_ukazat" | "neukazovat";

/** Běžící, nebo uzavřený měsíc (do budoucna se tu nechodí). */
export type ObdobiUctu = "tento" | "minuly";

export default function UcetZamestnance({
  radky,
  mesic,
  obdobi,
  predchozi,
  nasledujici,
}: {
  radky: RadekUctu[];
  /** První den měsíce, RRRR-MM-DD. */
  mesic: string;
  obdobi: ObdobiUctu;
  /** Odkazy přepínače měsíců. `nasledujici` prázdné = dál se nejde. */
  predchozi: { href: string; mesic: string };
  nasledujici: { href: string; mesic: string } | null;
}) {
  const dny = [...radky].sort((a, b) => a.den.localeCompare(b.den));
  const s = souhrn(dny);
  const zobrazeni = dny[0]?.zobrazeni ?? "odecitat";
  const sZalohami = zobrazeni !== "neukazovat";
  const sZustatkem = zobrazeni === "odecitat";
  const sloupce = [
    "Den",
    "Odpracováno",
    "Výdělek",
    ...(sZalohami ? ["Zálohy"] : []),
    ...(sZustatkem ? ["Zůstatek"] : []),
  ];

  return (
    <div className="ds-vy">
      <div className="ds-vy-lista">
        <p className="ds-vy-obdobi">
          <span className="ds-serif ds-vy-mesic">
            {velkym(nazevMesice(mesic))} {mesic.slice(0, 4)}
          </span>
          <span>
            {obdobi === "tento"
              ? "běžící měsíc — do dneška, co je uzavřené"
              : "uzavřený měsíc"}
          </span>
        </p>
        {/* Měsíc v adrese, šipky jsou odkazy — stejně jako na Výdělcích. */}
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

      {dny.length === 0 ? (
        <section className="ds-plocha ds-vy-prazdno" role="status">
          <p>
            Za {nazevMesice(mesic)} tu zatím nic není — žádná uzavřená docházka
            {sZalohami ? " ani záloha" : ""}.
            {obdobi === "tento" ? " Kdo je právě v práci, přičte se po odchodu." : ""}
          </p>
        </section>
      ) : (
        <>
          <div className="ds-kpi-mrizka">
            <KpiKarta
              ikona="mince"
              ton="dobre"
              titulek={obdobi === "tento" ? "Vyděláno do dneška" : "Vyděláno za měsíc"}
              hodnota={s.dnuBezSazby > 0 && s.vydelano === 0 ? "bez sazby" : koruny(s.vydelano)}
              popisy={[
                s.minut > 0 ? `${hodinyAMinuty(s.minut)} uzavřené docházky` : "zatím žádná uzavřená docházka",
                "hrubá mzda, orientačně",
              ]}
            >
              <Varovani
                text={
                  s.dnuBezSazby > 0
                    ? `${pocet(s.dnuBezSazby, "den", "dny", "dnů")} bez sazby — v součtu chybí`
                    : null
                }
              />
            </KpiKarta>

            {sZalohami ? (
              <KpiKarta
                ikona="kniha"
                ton="neutral"
                titulek="Zálohy"
                hodnota={koruny(s.zalohy)}
                popisy={[
                  s.zaloh > 0 ? pocet(s.zaloh, "záloha", "zálohy", "záloh") : "za tenhle měsíc žádná",
                  s.nepotvrzenych > 0
                    ? `${pocet(s.nepotvrzenych, "čeká", "čekají", "čeká")} na potvrzení PINem`
                    : null,
                ]}
              />
            ) : null}

            {sZustatkem ? (
              <KpiKarta
                ikona={napred(s.zbyva) ? "varovani" : "fajfkaKruh"}
                ton={napred(s.zbyva) ? "pozor" : "neutral"}
                titulek="Zbývá k výplatě"
                hodnota={zbyvaHodnota(s)}
                popisy={["hrubá mzda minus zálohy, před daněmi a odvody"]}
              >
                <Varovani
                  text={napred(s.zbyva) ? `zálohy předběhly výdělek o ${koruny(-s.zbyva)}` : null}
                />
                <Varovani
                  text={s.dnuBezSazby > 0 ? "část dnů bez sazby — skutečně zbývá víc" : null}
                />
              </KpiKarta>
            ) : null}
          </div>

          <section className="ds-plocha ds-vy-dny">
            <PanelHlava ikona="kalendar" nadpis="Po dnech" />

            <div className="ds-vy-tabulka-obal">
              <table className="ds-vy-tabulka">
                <thead>
                  <tr>
                    {sloupce.map((sl) => (
                      <th key={sl} scope="col">
                        {sl}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dny.map((r) => (
                    <tr key={r.den} data-den={r.den}>
                      <th scope="row">{denZkraceny(r.den)}</th>
                      {bunky(r, sZalohami, sZustatkem).map((b, i) => (
                        <td key={sloupce[i + 1]}>{b}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Telefon: každý den jako karta, stejné buňky, stejné tvary. */}
            <ul className="ds-vy-karty">
              {dny.map((r) => (
                <li key={r.den} className="ds-vy-karta" data-den={r.den}>
                  <span className="ds-vy-jmeno">{denZkraceny(r.den)}</span>
                  <dl>
                    {bunky(r, sZalohami, sZustatkem).map((b, i) => (
                      <div key={sloupce[i + 1]} className="ds-vy-radek">
                        <dt>{sloupce[i + 1]}</dt>
                        <dd>{b}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <ul className="ds-vy-vysvetlivky">
        <li>
          Všechny částky jsou <strong>hrubá mzda</strong>, orientačně — před
          daněmi a odvody. Na výplatní pásce bude číslo jiné.
        </li>
        <li>
          Výdělek počítá jen uzavřenou docházku (příchod i odchod), se
          sazbou platnou v ten den. Noc po půlnoci patří do provozního dne,
          kdy směna začala.
        </li>
        {sZalohami ? (
          <li>
            Zálohy jsou nestornované zálohy ze všech poboček, i ty, které
            ještě čekají na potvrzení PINem.
          </li>
        ) : (
          <li>Zálohy tu firma neukazuje — zeptejte se vedoucího.</li>
        )}
        {sZustatkem ? (
          <li>
            Zůstatek je výdělek do toho dne minus zálohy do toho dne.
            Zálohy se vyplácejí z čisté mzdy, takže na pásce bude „zbývá“
            nižší.
          </li>
        ) : sZalohami ? (
          <li>Zálohy se tu od výdělku neodečítají — tak to firma nastavila.</li>
        ) : null}
        <li>
          „Bez sazby“ znamená, že sazba chybí a z hodin se mzda spočítat
          nedá. Doplní ji ten, kdo spravuje mzdy.
        </li>
      </ul>
    </div>
  );
}

/* --- kousky ------------------------------------------------------------ */

/**
 * Buňky dne po sloupci Den. Jedna funkce pro tabulku i karty na
 * telefonu — dvě kopie by se dřív nebo později rozešly.
 */
function bunky(r: RadekUctu, sZalohami: boolean, sZustatkem: boolean): ReactNode[] {
  // Den jen se zálohou nemá sazbu ani příznak — docházka ten den nebyla.
  const prace = r.hodinova_haleru !== null || r.sazba_chybi;
  return [
    prace ? hodinyAMinuty(r.odpracovano_minut) : <Nic key="o" />,
    vydelek(r, prace),
    ...(sZalohami ? [zalohy(r)] : []),
    ...(sZustatkem ? [zustatek(r)] : []),
  ];
}

function vydelek(r: RadekUctu, prace: boolean): ReactNode {
  if (!prace) return <Nic />;
  if (r.sazba_chybi || r.vydelano_haleru === null || r.hodinova_haleru === null) return <BezSazby />;
  return (
    <>
      {koruny(r.vydelano_haleru)}
      <span className="ds-vy-sazba ds-vy-pod">{sazbaZaHodinu(r.hodinova_haleru)}</span>
    </>
  );
}

function zalohy(r: RadekUctu): ReactNode {
  const pocetZaloh = r.zaloh ?? 0;
  if (pocetZaloh === 0 || r.zalohy_haleru === null) return <Nic />;
  return (
    <>
      {koruny(r.zalohy_haleru)}
      <span className={r.zaloh_nepotvrzenych ? "ds-vy-znacka ds-vy-pod" : "ds-vy-sazba ds-vy-pod"}>
        {stavZaloh(pocetZaloh, r.zaloh_nepotvrzenych ?? 0)}
      </span>
    </>
  );
}

/**
 * Stav záloh dne slovem. Nepotvrzená se nezahazuje — počítá se, jen je
 * vidět, že na PIN teprve čeká.
 */
function stavZaloh(zaloh: number, nepotvrzenych: number): string {
  if (nepotvrzenych === 0) return zaloh === 1 ? "potvrzená PINem" : "potvrzené PINem";
  if (zaloh === 1) return "čeká na PIN";
  return `${pocet(nepotvrzenych, "čeká", "čekají", "čeká")} na PIN`;
}

/**
 * Průběžný zůstatek. Záporný není „−100 Kč“ bez vysvětlení, ale slovy:
 * záloha předběhla výdělek. Rozhoduje zaokrouhlená koruna, stejně jako
 * u přeplatku na Výdělcích — „napřed 0 Kč“ by nic neříkalo.
 */
function zustatek(r: RadekUctu): ReactNode {
  if (r.zustatek_haleru === null) return <Nic />;
  const castka =
    napred(r.zustatek_haleru) ? (
      <span className="ds-vy-preplaceno">zálohy napřed {koruny(-r.zustatek_haleru)}</span>
    ) : (
      koruny(Math.max(0, r.zustatek_haleru))
    );
  return (
    <>
      {castka}
      {r.zustatek_neuplny ? <span className="ds-vy-znacka ds-vy-pod">část bez sazby</span> : null}
    </>
  );
}

/** Zálohy předběhly výdělek aspoň o korunu (po zaokrouhlení jako `koruny()`). */
function napred(zustatekHaleru: number): boolean {
  return Math.round(-zustatekHaleru / 100) > 0;
}

/** Hodnota karty „Zbývá“. Nikdy záporná — přeplatek řekne varování pod ní. */
function zbyvaHodnota(s: Souhrn): string {
  if (s.dnuBezSazby > 0 && s.vydelano === 0) return "bez sazby";
  return koruny(Math.max(0, s.zbyva));
}

function BezSazby() {
  return <span className="ds-vy-bez-sazby">bez sazby</span>;
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

type Souhrn = ReturnType<typeof souhrn>;

/**
 * Součty do přehledových karet — jen sčítání hotových čísel z databáze.
 * „Zbývá“ je poslední průběžný zůstatek (tentýž, který stojí v tabulce
 * u posledního dne), ne vlastní rozdíl: dvě místa, kde se to počítá, by
 * se dřív nebo později rozešla.
 */
function souhrn(dny: RadekUctu[]) {
  const s = { minut: 0, vydelano: 0, dnuBezSazby: 0, zalohy: 0, zaloh: 0, nepotvrzenych: 0, zbyva: 0 };
  for (const r of dny) {
    s.minut += r.odpracovano_minut;
    s.vydelano += r.vydelano_haleru ?? 0;
    if (r.sazba_chybi) s.dnuBezSazby++;
    s.zalohy += r.zalohy_haleru ?? 0;
    s.zaloh += r.zaloh ?? 0;
    s.nepotvrzenych += r.zaloh_nepotvrzenych ?? 0;
  }
  s.zbyva = dny[dny.length - 1]?.zustatek_haleru ?? 0;
  return s;
}

function velkym(slovo: string): string {
  return slovo.charAt(0).toUpperCase() + slovo.slice(1);
}
