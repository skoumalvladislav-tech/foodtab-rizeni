"use client";

import { Fragment } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import ZnackaOsoby from "@/app/znacka-osoby";
import {
  POPIS_PUNTIKU,
  kratkyCas,
  puntikSmeny,
  puvodniStav,
  stavSmeny,
  type Mrizka,
  type PotvrzeniRozpisu,
  type PuntikSmeny,
  type RadekMrizky,
  type SkupinaMrizky,
  type SmenaD,
} from "@/lib/rozpis-desktop";
import {
  denVTydnu,
  hhmm,
  hodinyKratce,
  inicialy,
  jeVikend,
  stitekDne,
  ZKRATKY_DNU,
} from "@/lib/rozpis-mobil";
import { pocet } from "@/lib/sklonovani";

import type { SmenaKUprave } from "../formular-smeny";
import type { Otevrene, Planovani, Smena } from "../rozpis";

/**
 * Prázdná směna pro formulář: člověk a den jsou dané, časy výchozí.
 * Společné pro týdenní mřížku i měsíc jednoho člověka — obojí otevírá
 * formulář stejně skoro vyplněný.
 */
export function novaSmenaProOsobu(osobaId: string, den: string, pobockaId: string): SmenaKUprave {
  return {
    id: "",
    branch_id: pobockaId,
    employee_id: osobaId,
    position_id: null,
    shift_date: den,
    starts_at: "08:00",
    ends_at: "16:00",
    note: "",
    pauza_od: null,
    pauza_do: null,
  };
}

/**
 * Týdenní mřížka — hlavní pracovní plocha manažera.
 *
 * Řádky = lidé, sloupce = dny. Sloupec se jmény i záhlaví dnů jsou
 * „přilepené“ (sticky) a mřížka sama scrolluje ve vlastním rámu — přesně
 * z důvodů popsaných v git historii (pět pokusů nechat sticky uvnitř
 * <table> a scrollovat celou stránku selhalo): sticky na blokových
 * prvcích uvnitř obalu s vlastní výškou funguje předvídatelně.
 *
 * ---------------------------------------------------------------------
 * ČISTÁ PLOCHA
 *
 * Prázdná buňka nemá nic. „+ Přidat“ se ukáže až při najetí nebo
 * zaměření (klávesnice na tlačítko dosáhne pořád). Směna je jedna
 * kompaktní karta s časem a puntíkem. Puntík je červený (nevydáno),
 * žlutý (vydáno a nepotvrzeno) nebo zelený s fajfkou (vydáno a potvrzeno);
 * slovo se nepíše, je v `title` a v odečítači a barvy vysvětluje lišta
 * nástrojů nad mřížkou. Kdo odstíny nerozliší, pozná zelený podle fajfky.
 *
 * ---------------------------------------------------------------------
 * POBOČKA, A POD NÍ ÚSEKY
 *
 * Pruh pobočky se kreslí VŽDY, i když je pobočka jediná (Šéfík 19. 9. 2026:
 * „potřebuji zobrazit pobočku a pod ní jednotlivé úseky“). Dřív se při
 * jedné pobočce schovával, takže po výběru pobočky v nabídce Zobrazit
 * zmizel právě ten nadpis, podle kterého se vedoucí orientoval. Nese počet
 * lidí a hodin jako hlavičky úseků — a dá se sbalit celý, i s úseky pod ním.
 *
 * ---------------------------------------------------------------------
 * JMÉNA SE NELÁMOU PO ZNACÍCH
 *
 * Lámat se smí jen mezi slovy (nejvýš dva řádky), pak se ořízne
 * s výpustkou; celé jméno je vždycky v `title`. Sloupec je široký tak,
 * aby se běžné jméno vešlo na jeden řádek.
 */

const ODSTUP_SLOUPCE = "minmax(196px, 216px)";

export default function MrizkaTydne({
  mrizka,
  dny,
  dnesni,
  planovani,
  potvrzeni,
  poziceOsob,
  barvy,
  jmena,
  nazvyPobocek,
  zkratkyPobocek,
  pobockaProNovou,
  vybranaId,
  sbalene,
  onPrepnout,
  onOtevrit,
  filtrAktivni,
  onZrusitFiltry,
  maSmeny,
}: {
  mrizka: Mrizka;
  dny: string[];
  dnesni: string;
  planovani: Planovani | null;
  /** Kdo směny potvrdil (puntík u času); `null` = neví se. */
  potvrzeni: PotvrzeniRozpisu | null;
  /** Štítek pod jménem: název pozice člověka, nebo `null`. */
  poziceOsob: (osobaId: string) => string | null;
  barvy: Map<string, string | null>;
  jmena: Map<string, string>;
  /** id pobočky → název; do `title` karty, když je v okně víc poboček. */
  nazvyPobocek: Map<string, string>;
  /** id pobočky → zkratka („Černá Perla“ → „ČP“); to je to, co je na kartě vidět. */
  zkratkyPobocek: Map<string, string>;
  /** Na které pobočce zakládat novou směnu, když mřížka není dělená po pobočkách. */
  pobockaProNovou: string | null;
  /** Směna otevřená v panelu vpravo — v mřížce zvýrazněná. */
  vybranaId: string | null;
  sbalene: Set<string>;
  onPrepnout: (klic: string) => void;
  onOtevrit: (co: Otevrene) => void;
  filtrAktivni: boolean;
  onZrusitFiltry: () => void;
  /** Je v okně vůbec nějaká směna? Bez ní je prázdný stav o něčem jiném než o filtru. */
  maSmeny: boolean;
}) {
  const sablona = `${ODSTUP_SLOUPCE} repeat(${dny.length}, minmax(112px, 1fr))`;

  return (
    <>
      <div className="ds-smd-mrizka">
        <div
          role="table"
          aria-label="Rozpis směn na týden"
          className="ds-smd-tabulka"
          style={{ gridTemplateColumns: sablona }}
        >
          <div role="row" className="ds-smd-radek">
            <div role="columnheader" className="ds-smd-roh">
              Zaměstnanec
              <span className="ds-smd-roh-pocet">
                {pocet(mrizka.pocetLidi, "člověk", "lidé", "lidí")}
              </span>
            </div>
            {dny.map((den) => {
              const souhrn = mrizka.poDnech.get(den);
              const stitek = stitekDne(den, dnesni);
              const cislo = Number(den.slice(8, 10));
              return (
                <div
                  key={den}
                  role="columnheader"
                  className="ds-smd-den"
                  data-dnes={den === dnesni ? "" : undefined}
                  data-vikend={jeVikend(den) ? "" : undefined}
                  aria-label={`${ZKRATKY_DNU[denVTydnu(den)]} ${cislo}. ${Number(den.slice(5, 7))}.`}
                >
                  <span className="ds-smd-den-hlava">
                    <span className="ds-smd-den-nazev">{stitek ?? ZKRATKY_DNU[denVTydnu(den)]}</span>
                    <span className="ds-smd-den-cislo">{cislo}.</span>
                  </span>
                  <span
                    className="ds-smd-den-soucet"
                    title="Kolik lidí ten den pracuje a kolik hodin je naplánováno (bez neobsazených směn)"
                  >
                    {souhrn && souhrn.lidi > 0 ? (
                      <>
                        <Ikona klic="lide" velikost={12} />
                        {souhrn.lidi} · {hodinyKratce(souhrn.minut)}
                      </>
                    ) : (
                      <span aria-label="nikdo nepracuje">—</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {mrizka.pobocky.map((pobocka) => {
            const sbalenaPobocka = pobocka.jePobocka && sbalene.has(pobocka.klic);
            return (
            <Fragment key={pobocka.klic}>
              {/*
                Pruh pobočky jen tehdy, když je v okně JEDNA pobočka. Při víc
                pobočkách má každý člověk jeden řádek se všemi směnami (aby se
                nezdvojil a jeho hodiny seděly s exportem), takže pod žádnou
                pobočku nepatří — tu pak nese karta směny.
              */}
              {pobocka.jePobocka ? (
                <div role="row" className="ds-smd-radek ds-smd-radek-siroky">
                  <div role="rowheader" className="ds-smd-pobocka-obal">
                    <button
                      type="button"
                      className="ds-smd-pobocka"
                      aria-expanded={!sbalenaPobocka}
                      onClick={() => onPrepnout(pobocka.klic)}
                    >
                      <span className="ds-smd-skupina-sipka" aria-hidden="true">
                        <Ikona klic="sipkaVpravo" velikost={15} />
                      </span>
                      <Ikona klic="pobocka" velikost={17} />
                      <span className="ds-smd-pobocka-nazev">{pobocka.nazev}</span>
                      <span className="ds-smd-skupina-pocty">
                        {[
                          pocet(pobocka.lidi, "člověk", "lidé", "lidí"),
                          pobocka.minut > 0 ? hodinyKratce(pobocka.minut) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </div>
                </div>
              ) : null}
              {sbalenaPobocka
                ? null
                : pobocka.skupiny.map((skupina) => (
                <SkupinaMrizkyView
                  key={skupina.klic}
                  skupina={skupina}
                  /* Bez pruhu pobočky se zakládá na vybrané (Zobrazit), jinak na výchozí. */
                  pobockaId={pobocka.jePobocka ? pobocka.klic : pobockaProNovou}
                  nazvyPobocek={nazvyPobocek}
                  zkratkyPobocek={zkratkyPobocek}
                  psatPobocku={!pobocka.jePobocka}
                  dny={dny}
                  dnesni={dnesni}
                  planovani={planovani}
                  potvrzeni={potvrzeni}
                  poziceOsob={poziceOsob}
                  barvy={barvy}
                  jmena={jmena}
                  vybranaId={vybranaId}
                  sbaleno={sbalene.has(skupina.klic)}
                  onPrepnout={onPrepnout}
                  onOtevrit={onOtevrit}
                />
              ))}
            </Fragment>
            );
          })}

          {mrizka.bezSmeny ? (
            <SkupinaMrizkyView
              skupina={mrizka.bezSmeny}
              pobockaId={pobockaProNovou ?? planovani?.vychoziPobocka ?? null}
              nazvyPobocek={nazvyPobocek}
              zkratkyPobocek={zkratkyPobocek}
              psatPobocku={false}
              dny={dny}
              dnesni={dnesni}
              planovani={planovani}
              potvrzeni={potvrzeni}
              poziceOsob={poziceOsob}
              barvy={barvy}
              jmena={jmena}
              vybranaId={vybranaId}
              sbaleno={sbalene.has(mrizka.bezSmeny.klic)}
              onPrepnout={onPrepnout}
              onOtevrit={onOtevrit}
            />
          ) : null}
        </div>

        {mrizka.pocetRadku === 0 ? (
          <div className="ds-smd-prazdno" role="status">
            {filtrAktivni ? (
              <>
                <p>Hledání ani filtrům nevyhovuje žádný řádek.</p>
                <button type="button" className="ft-tl ft-tl-male ft-tl-vedlejsi" onClick={onZrusitFiltry}>
                  Zrušit filtry
                </button>
              </>
            ) : (
              <>
                <p>{maSmeny ? "V tomto období není co ukázat." : "V tomto období zatím není žádná směna."}</p>
                {planovani ? (
                  <button
                    type="button"
                    className="ft-tl ft-tl-male ft-tl-hlavni"
                    onClick={() => onOtevrit({ den: dny[0], smena: null, nonce: Date.now() })}
                  >
                    + Přidat směnu
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="ds-smd-paticka">
        <ul className="ds-smd-legenda" aria-label="Vysvětlivky">
          <li>
            <span className="ds-smd-vzorek" data-stav="vydana" aria-hidden="true" />
            Vydaná směna
          </li>
          <li>
            <span className="ds-smd-vzorek" data-stav="koncept" aria-hidden="true" />
            Nevydaná
          </li>
          <li>
            <span className="ds-smd-vzorek" data-stav="zmenena" aria-hidden="true" />
            Změněná po vydání
          </li>
        </ul>
        <p className="ds-smd-celkem" title="Plánované hodiny lidí v tom, co je vidět. Neobsazené směny a automatická přestávka pobočky se nepočítají.">
          Celkem: <strong>{hodinyKratce(mrizka.celkemMinut)}</strong>
        </p>
      </div>
    </>
  );
}

/* --- skupina (úsek) ---------------------------------------------------- */

function SkupinaMrizkyView({
  skupina,
  pobockaId,
  nazvyPobocek,
  zkratkyPobocek,
  psatPobocku,
  dny,
  dnesni,
  planovani,
  potvrzeni,
  poziceOsob,
  barvy,
  jmena,
  vybranaId,
  sbaleno,
  onPrepnout,
  onOtevrit,
}: {
  skupina: SkupinaMrizky;
  pobockaId: string | null;
  nazvyPobocek: Map<string, string>;
  zkratkyPobocek: Map<string, string>;
  psatPobocku: boolean;
  dny: string[];
  dnesni: string;
  planovani: Planovani | null;
  potvrzeni: PotvrzeniRozpisu | null;
  poziceOsob: (osobaId: string) => string | null;
  barvy: Map<string, string | null>;
  jmena: Map<string, string>;
  vybranaId: string | null;
  sbaleno: boolean;
  onPrepnout: (klic: string) => void;
  onOtevrit: (co: Otevrene) => void;
}) {
  const nazev = skupina.nazev;
  const neobsazenychSmen = skupina.radky.reduce(
    (n, r) => n + [...r.smenyPodleDne.values()].reduce((m, seznam) => m + seznam.length, 0),
    0,
  );
  const souhrn =
    skupina.druh === "neobsazene"
      ? `${pocet(neobsazenychSmen, "směna", "směny", "směn")} k obsazení · ${hodinyKratce(skupina.minut)}`
      : [
          pocet(skupina.lidi, "člověk", "lidé", "lidí"),
          skupina.minut > 0 ? hodinyKratce(skupina.minut) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <>
      {/*
        Neobsazené směny nemají vlastní hlavičku: je to jeden řádek nahoře
        a jeho součet stojí v buňce se jménem („Neobsazeno · 2 směny · 16 h“).
        Hlavička navíc by nad ním brala řádek místa a nedala by se k ničemu
        sbalit — poplach, „sem někoho potřebujeme“, se schovávat nemá.
      */}
      {skupina.druh === "neobsazene" ? null : (
        <div role="row" className="ds-smd-radek ds-smd-radek-siroky">
          <div role="rowheader" className="ds-smd-skupina-obal">
            <button
              type="button"
              className="ds-smd-skupina"
              data-druh={skupina.druh}
              aria-expanded={!sbaleno}
              onClick={() => onPrepnout(skupina.klic)}
            >
              <span className="ds-smd-skupina-sipka" aria-hidden="true">
                <Ikona klic="sipkaVpravo" velikost={14} />
              </span>
              <span className="ds-smd-skupina-nazev">{nazev}</span>
              <span className="ds-smd-skupina-pocty">{souhrn}</span>
            </button>
          </div>
        </div>
      )}

      {sbaleno
        ? null
        : skupina.radky.map((radek) => (
            <RadekMrizkyView
              key={`${skupina.klic}|${radek.klic}`}
              radek={radek}
              pobockaId={pobockaId}
              nazvyPobocek={nazvyPobocek}
              zkratkyPobocek={zkratkyPobocek}
              psatPobocku={psatPobocku}
              dny={dny}
              dnesni={dnesni}
              planovani={planovani}
              potvrzeni={potvrzeni}
              role={radek.osoba ? poziceOsob(radek.osoba.id) : souhrn}
              barva={radek.osoba ? (barvy.get(radek.osoba.id) ?? null) : null}
              jmena={jmena}
              vybranaId={vybranaId}
              onOtevrit={onOtevrit}
            />
          ))}
    </>
  );
}

/* --- řádek člověka ----------------------------------------------------- */

function RadekMrizkyView({
  radek,
  pobockaId,
  nazvyPobocek,
  zkratkyPobocek,
  psatPobocku,
  dny,
  dnesni,
  planovani,
  potvrzeni,
  role,
  barva,
  jmena,
  vybranaId,
  onOtevrit,
}: {
  radek: RadekMrizky;
  pobockaId: string | null;
  nazvyPobocek: Map<string, string>;
  /** id pobočky → zkratka („Černá Perla“ → „ČP“); počítá se ze VŠECH poboček firmy, ať je stálá. */
  zkratkyPobocek: Map<string, string>;
  /** Psát na kartu pobočku? V mřížce nedělené po pobočkách ano, jinak je jasná z pruhu. */
  psatPobocku: boolean;
  dny: string[];
  dnesni: string;
  planovani: Planovani | null;
  potvrzeni: PotvrzeniRozpisu | null;
  role: string | null;
  barva: string | null;
  jmena: Map<string, string>;
  vybranaId: string | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  const { osoba, jmeno } = radek;

  return (
    <div role="row" className="ds-smd-radek ds-smd-radek-osoby">
      <div role="rowheader" className="ds-smd-osoba" data-volna={osoba ? undefined : ""}>
        {osoba ? (
          <>
            <span className="ds-smd-avatar" aria-hidden="true">
              {inicialy(jmeno)}
            </span>
            <span className="ds-smd-osoba-text">
              <span className="ds-smd-jmeno" title={jmeno}>
                <ZnackaOsoby barva={barva} velikost={9} />
                <span className="ds-smd-jmeno-text">{jmeno}</span>
              </span>
              {/*
                Kolik hodin má člověk v tomhle týdnu naplánováno — za pozicí,
                aby se dalo sledovat, jak přibývá s každou přidanou směnou.
                Plánované délky bez automatické přestávky (stejně jako
                součty v hlavičkách).
              */}
              <span className="ds-smd-role">
                {role ? <>{role} · </> : null}
                <span className="ds-smd-hodiny" title="Naplánováno v tomto týdnu">
                  {hodinyKratce(radek.minut)}
                </span>
              </span>
            </span>
            {/* Jen plánující: „nevydané změny“ jsou věc toho, kdo rozpis vydává. */}
            {planovani && radek.nevydanych > 0 ? (
              <span
                className="ds-smd-tecka"
                title={`${pocet(radek.nevydanych, "nevydaná změna", "nevydané změny", "nevydaných změn")}`}
              >
                <span className="ft-jen-pro-odecitac">
                  {pocet(radek.nevydanych, "nevydaná změna", "nevydané změny", "nevydaných změn")}
                </span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="ds-smd-osoba-text">
            <span className="ds-smd-jmeno">{jmeno}</span>
            <span className="ds-smd-role">{role ?? "volné směny"}</span>
          </span>
        )}
      </div>

      {/*
        Pobočka na kartě jen tehdy, když řádek míchá víc poboček — jinak by ji
        nesla každá směna zbytečně (pobočka je pak v pruhu nad řádky).
      */}
      {dny.map((den) => {
        const smeny = (radek.smenyPodleDne.get(den) ?? []) as Smena[];
        const obsazeno = smeny.length > 0;
        return (
          <div
            key={den}
            role="cell"
            className="ds-smd-bunka"
            data-dnes={den === dnesni ? "" : undefined}
            data-vikend={jeVikend(den) ? "" : undefined}
          >
            {smeny.map((s) => (
              <KartaSmeny
                key={s.id}
                s={s}
                jmena={jmena}
                vybrana={vybranaId === s.id}
                klikaci={planovani !== null}
                puntik={puntikSmeny(s as SmenaD, potvrzeni, dnesni)}
                pobocka={psatPobocku ? (zkratkyPobocek.get(s.branch_id) ?? null) : null}
                pobockaNazev={psatPobocku ? (nazvyPobocek.get(s.branch_id) ?? null) : null}
                onOtevrit={() => onOtevrit({ den, smena: s })}
              />
            ))}

            {/*
              Jen PRÁZDNÉ políčko: člověk i den jsou dané, formulář se
              otevře skoro vyplněný. Kam dát další směnu téhož dne, řeší
              otevřená směna (Šéfík 16. 9. 2026: „odebrat druhé plus“).
            */}
            {planovani && !obsazeno ? (
              <button
                type="button"
                className="ds-smd-pridat"
                aria-label={`Přidat směnu: ${jmeno}, ${den}`}
                onClick={() => {
                  /*
                    Pobočka je ta, v jejímž pruhu se kliklo — i u neobsazeného
                    řádku, který nemá člověka, a tedy ani hotovou směnu
                    k předvyplnění. Bez toho by volná směna vznikla na výchozí
                    pobočce a z rozpisu, kde se právě zakládala, by zmizela.
                  */
                  const pobocka = pobockaId ?? planovani.vychoziPobocka ?? "";
                  onOtevrit({
                    den,
                    smena: osoba ? novaSmenaProOsobu(osoba.id, den, pobocka) : null,
                    predvyplneni: osoba || !pobocka ? null : { branch_id: pobocka },
                    nonce: Date.now(),
                  });
                }}
              >
                <Ikona klic="plus" velikost={12} />
                Přidat
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* --- karta směny ------------------------------------------------------- */

export function KartaSmeny({
  s,
  jmena,
  vybrana,
  klikaci,
  onOtevrit,
  kompaktni = false,
  pobocka = null,
  pobockaNazev = null,
  puntik = null,
}: {
  s: Smena;
  jmena: Map<string, string>;
  vybrana: boolean;
  klikaci: boolean;
  onOtevrit: () => void;
  /** Úzká buňka (měsíc dvou lidí vedle sebe): „8–16“ místo „08:00–16:00“ a „pauza 15–17“. */
  kompaktni?: boolean;
  /** Zkratka pobočky na kartě; `null` = nepsat (pobočka je jasná odjinud). */
  pobocka?: string | null;
  /** Celý název pobočky do `title` — zkratka sama by nikomu nic neřekla. */
  pobockaNazev?: string | null;
  /** Barva puntíku u času; `null` = bez puntíku. Počítá `puntikSmeny` (lib/rozpis-desktop.ts). */
  puntik?: PuntikSmeny | null;
}) {
  const stav = stavSmeny(s as SmenaD);
  const puvodne = puvodniStav(s as SmenaD);
  const cas = `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}`;
  const trhana = Boolean(s.pauza_od && s.pauza_do);

  /*
    Stav se na kartě nepíše slovem, jen puntíkem u času (Šéfík 20. 9. 2026:
    červený = nevydáno, žlutý = vydáno a nepotvrzeno, zelený = vydáno a
    potvrzeno). Slovo zůstává v `title` a pro odečítač, barvy vysvětluje
    lišta nad mřížkou. Karta je tak o řádek nižší.
  */
  const stitek =
    stav === "koncept"
      ? POPIS_PUNTIKU.nevydano
      : stav === "zmenena"
        ? "Změněno po vydání, nevydáno"
        : puntik
          ? POPIS_PUNTIKU[puntik]
          : null;
  const pauza = trhana ? `pauza ${hhmm(s.pauza_od as string)}–${hhmm(s.pauza_do as string)}` : null;
  // Do karty se píše krátce; celý zápis zůstává v `title` a pro odečítač.
  const casNaKarte = kompaktni ? `${kratkyCas(hhmm(s.starts_at))}–${kratkyCas(hhmm(s.ends_at))}` : cas;
  const pauzaNaKarte = trhana
    ? kompaktni
      ? `pauza ${kratkyCas(hhmm(s.pauza_od as string))}–${kratkyCas(hhmm(s.pauza_do as string))}`
      : pauza
    : null;
  const popisek = pauzaNaKarte;

  // Celý popis do `title` a odečítače — karta sama je záměrně strohá.
  const podrobnosti = [
    cas,
    trhana ? `trhaná směna, ${pauza}` : null,
    pobockaNazev,
    stitek,
    puvodne
      ? [
          puvodne.casSeZmenil ? `původně ${puvodne.od}–${puvodne.do}` : null,
          puvodne.osobaSeZmenila
            ? `původně ${puvodne.osobaId ? (jmena.get(puvodne.osobaId) ?? "jiný člověk") : "neobsazeno"}`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null,
    s.note ? `poznámka: ${s.note}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const obsah = (
    <>
      <span className="ds-smd-cas">{casNaKarte}</span>
      {pobocka ? (
        <span className="ds-smd-pobocka-zkr" title={pobockaNazev ?? undefined}>
          {pobocka}
        </span>
      ) : null}
      {puntik ? <span className="ds-smd-znacka" data-puntik={puntik} aria-hidden="true" /> : null}
      {popisek ? <span className="ds-smd-popisek">{popisek}</span> : null}
    </>
  );

  if (!klikaci) {
    return (
      <div className="ds-smd-smena" data-stav={stav} title={podrobnosti} aria-label={podrobnosti} role="group">
        {obsah}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="ds-smd-smena"
      data-stav={stav}
      data-vybrana={vybrana ? "" : undefined}
      aria-pressed={vybrana}
      title={podrobnosti}
      aria-label={podrobnosti}
      onClick={onOtevrit}
    >
      {obsah}
    </button>
  );
}
