import Ikona from "@/app/[rozsah]/ikona";
import {
  BEZ_USEKU,
  ZKRATKY_DNU,
  cisloDne,
  hodinyKratce,
  jeVikend,
  lidiPopis,
  mesicniMrizka,
  neobsazenePopis,
  popisDne,
  popisDneKratce,
  popisMesice,
  popisTydne,
  rozsahCasu,
  sestavitDen,
  sestavitNadchazejici,
  sestavitTyden,
  smenaProOdecitac,
  smenyPodleDne,
  type FiltrSmen,
  type Osoba,
  type RadekDne,
} from "@/lib/rozpis-mobil";
import {
  AvatarM,
  CasKratce,
  CipFiltru,
  PilulkaSmeny,
  PilulkaVolno,
  PrazdnyStav,
  PruhDnu,
  TlacitkoFiltru,
} from "./prvky";
import type { KontextM, SmenaM } from "./typy";

/**
 * Tři hlavní mobilní pohledy: denní přehled týmu, týden po lidech
 * a moje směny. Čisté kreslení — data přichází hotová, změny odcházejí
 * přes `on…`. O tom, KDO smí co, rozhoduje `jeVedouci` (odvozené na
 * serveru z `shifts.manage`, ne z názvu role) a databáze znovu.
 */

/* --- společné pomůcky ------------------------------------------------ */

/** „Kuchyně“ — pozice směny, jinak úsek člověka; s pobočkou, je-li jich víc. */
function mistoSmeny(s: SmenaM, osoba: Osoba | null, ctx: KontextM, sPobockou: boolean): string {
  const pozice = s.position_id ? ctx.pozice.get(s.position_id) : undefined;
  const usek = osoba?.usekId ? ctx.useky.get(osoba.usekId) : undefined;
  const casti = [
    sPobockou ? ctx.pobocky.get(s.branch_id) : undefined,
    pozice ?? usek,
    s.pauza_od && s.pauza_do ? `pauza ${rozsahCasu(s.pauza_od, s.pauza_do)}` : undefined,
  ];
  return casti.filter(Boolean).join(" · ");
}

function stavProFiltr(filtr: FiltrSmen): string | null {
  return filtr.stav === "obsazene"
    ? "Obsazené"
    : filtr.stav === "neobsazene"
      ? "Neobsazené"
      : filtr.stav === "volno"
        ? "Volno"
        : null;
}

/* ===================================================================== */
/* DENNÍ PŘEHLED                                                         */
/* ===================================================================== */

export type DenProps = {
  den: string;
  dnes: string;
  smeny: SmenaM[];
  ctx: KontextM;
  filtr: FiltrSmen;
  /** Smí plánovat (má `shifts.manage`) — jinak je přehled jen ke čtení. */
  jeVedouci: boolean;
  onVybratDen: (d: string) => void;
  onTyden: (smer: -1 | 1) => void;
  onOtevritSmenu: (s: SmenaM) => void;
  onPridat: (pro: { osobaId: string | null; den: string }) => void;
  onFiltry: () => void;
  onZrusitFiltr: (druh: "pobocka" | "usek" | "stav", hodnota: string) => void;
  onZobrazitNeobsazene: () => void;
};

export function DenPrehled(p: DenProps) {
  const { den, dnes, smeny, ctx, filtr, jeVedouci } = p;
  const prehled = sestavitDen({ smeny, den, osoby: ctx.osoby, useky: ctx.useky, filtr });

  const poplach = new Set(
    smeny
      .filter(
        (s) =>
          s.status !== "cancelled" &&
          !s.employee_id &&
          (filtr.pobocky.length === 0 || filtr.pobocky.includes(s.branch_id)),
      )
      .map((s) => s.shift_date),
  );

  const pocetFiltru = filtr.pobocky.length + filtr.useky.length + (filtr.stav !== "vse" ? 1 : 0);
  const stav = stavProFiltr(filtr);
  const nikdoNepracuje = prehled.lidiPracuje === 0 && prehled.neobsazenychCelkem === 0;
  const radkuNic = prehled.pocetRadku === 0;

  return (
    <section className="ds-sm-den-pohled" aria-label={popisDne(den)}>
      <PruhDnu den={den} dnes={dnes} poplach={poplach} onVyber={p.onVybratDen} onTyden={p.onTyden} />

      <header className="ds-sm-hlava">
        <div className="ds-sm-hlava-text">
          <h2 className="ds-sm-titul">{popisDne(den)}</h2>
          <p className="ds-sm-podtitul">
            {nikdoNepracuje ? "Nikdo není naplánován" : lidiPopis(prehled.lidiPracuje)}
          </p>
        </div>
        <div className="ds-sm-hlava-akce">
          {den !== dnes ? (
            <button type="button" className="ds-sm-mala-akce" onClick={() => p.onVybratDen(dnes)}>
              Dnes
            </button>
          ) : null}
          <TlacitkoFiltru pocet={pocetFiltru} onKlik={p.onFiltry} />
        </div>
      </header>

      {prehled.poUsecich.length > 0 ? (
        <ul className="ds-sm-cipy" aria-label="Lidé podle úseku">
          {prehled.poUsecich.map((u, i) => (
            <li key={u.klic} className="ds-sm-cip" data-tona={i % 4}>
              {u.nazev} <b>{u.pocet}</b>
            </li>
          ))}
        </ul>
      ) : null}

      {prehled.neobsazenychCelkem > 0 ? (
        <div className="ds-sm-alarm" role="status">
          <Ikona klic="varovani" velikost={18} />
          <span>{neobsazenePopis(prehled.neobsazenychCelkem)}</span>
          {filtr.stav !== "neobsazene" ? (
            <button type="button" onClick={p.onZobrazitNeobsazene}>
              Zobrazit
            </button>
          ) : null}
        </div>
      ) : null}

      {pocetFiltru > 0 ? (
        <div className="ds-sm-filtr-cipy" aria-label="Aktivní filtry">
          {filtr.pobocky.map((id) => (
            <CipFiltru key={id} text={ctx.pobocky.get(id) ?? "Pobočka"} onZrusit={() => p.onZrusitFiltr("pobocka", id)} />
          ))}
          {filtr.useky.map((id) => (
            <CipFiltru
              key={id}
              text={id === BEZ_USEKU ? "Bez úseku" : (ctx.useky.get(id) ?? "Úsek")}
              onZrusit={() => p.onZrusitFiltr("usek", id)}
            />
          ))}
          {stav ? <CipFiltru text={stav} onZrusit={() => p.onZrusitFiltr("stav", "vse")} /> : null}
        </div>
      ) : null}

      {radkuNic ? (
        <PrazdnyStav
          text={
            pocetFiltru > 0
              ? "Filtrům neodpovídá žádná směna."
              : den === dnes
                ? "Dnes nejsou naplánované žádné směny."
                : "Na tento den nejsou naplánované žádné směny."
          }
        />
      ) : (
        <div className="ds-sm-skupiny">
          {prehled.skupiny.map((sk) => (
            <section key={sk.klic} aria-labelledby={`ds-sm-skupina-${sk.klic}`} className="ds-sm-skupina">
              <h3 className="ds-sm-skupina-nadpis" id={`ds-sm-skupina-${sk.klic}`}>
                {sk.nazev} <span>({sk.pracuje})</span>
              </h3>
              <ul className="ds-sm-radky">
                {sk.radky.map((r) => (
                  <RadekOsoby
                    key={r.klic}
                    radek={r}
                    usek={sk.nazev}
                    den={den}
                    ctx={ctx}
                    jeVedouci={jeVedouci}
                    onOtevritSmenu={p.onOtevritSmenu}
                    onPridat={p.onPridat}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/*
            Neobsazené směny až na konci: nahoře na ně upozorňuje čipový
            pruh s „Zobrazit“, takže seznam lidí zůstane tam, kde ho
            vedoucí čeká.
          */}
          {prehled.neobsazene.length > 0 ? (
            <section aria-labelledby="ds-sm-skupina-neobsazeno" className="ds-sm-skupina">
              <h3 className="ds-sm-skupina-nadpis" id="ds-sm-skupina-neobsazeno">
                Neobsazeno <span>({prehled.neobsazene.length})</span>
              </h3>
              <ul className="ds-sm-radky">
                {prehled.neobsazene.map((s) => (
                  <RadekNeobsazena key={s.id} smena={s} ctx={ctx} onOtevritSmenu={p.onOtevritSmenu} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RadekOsoby({
  radek,
  usek,
  den,
  ctx,
  jeVedouci,
  onOtevritSmenu,
  onPridat,
}: {
  radek: RadekDne<SmenaM>;
  usek: string;
  den: string;
  ctx: KontextM;
  jeVedouci: boolean;
  onOtevritSmenu: (s: SmenaM) => void;
  onPridat: (pro: { osobaId: string | null; den: string }) => void;
}) {
  const osoba = radek.osoba as Osoba;
  const [prvni] = radek.smeny;
  const misto = prvni ? mistoSmeny(prvni, osoba, ctx, ctx.vicePobocek) || usek : usek;
  const vice = radek.smeny.length > 1;

  if (vice) {
    // Víc směn v jednom dni (dělená směna, záskok): každá je vlastní cíl.
    return (
      <li className="ds-sm-radek" data-vice="true">
        <AvatarM osoba={osoba} />
        <span className="ds-sm-radek-text">
          <span className="ds-sm-jmeno">{osoba.jmeno}</span>
          <span className="ds-sm-mista">{misto}</span>
        </span>
        <span className="ds-sm-radek-cas">
          {radek.smeny.map((s) => (
            <button
              key={s.id}
              type="button"
              className="ds-sm-pilulka-tlacitko"
              onClick={() => onOtevritSmenu(s)}
              aria-label={`${osoba.jmeno}, ${usek}, ${smenaProOdecitac(s)}`}
            >
              <PilulkaSmeny smena={s} />
            </button>
          ))}
        </span>
      </li>
    );
  }

  const popisek = prvni
    ? `${osoba.jmeno}, ${usek}, ${smenaProOdecitac(prvni)}`
    : `${osoba.jmeno}, ${usek}, volno${jeVedouci ? ", přidat směnu" : ""}`;

  return (
    <li className="ds-sm-radek" data-volno={prvni ? undefined : "true"}>
      {prvni || jeVedouci ? (
        <button
          type="button"
          className="ds-sm-radek-tlacitko"
          aria-label={popisek}
          onClick={() => (prvni ? onOtevritSmenu(prvni) : onPridat({ osobaId: osoba.id, den }))}
        />
      ) : null}
      <AvatarM osoba={osoba} />
      <span className="ds-sm-radek-text" aria-hidden={prvni || jeVedouci ? "true" : undefined}>
        <span className="ds-sm-jmeno">{osoba.jmeno}</span>
        <span className="ds-sm-mista">{misto}</span>
      </span>
      <span className="ds-sm-radek-cas" aria-hidden={prvni || jeVedouci ? "true" : undefined}>
        {prvni ? <PilulkaSmeny smena={prvni} /> : <PilulkaVolno />}
      </span>
    </li>
  );
}

function RadekNeobsazena({
  smena,
  ctx,
  onOtevritSmenu,
}: {
  smena: SmenaM;
  ctx: KontextM;
  onOtevritSmenu: (s: SmenaM) => void;
}) {
  const misto = mistoSmeny(smena, null, ctx, ctx.vicePobocek) || "Bez zařazení";
  return (
    <li className="ds-sm-radek" data-neobsazena="true">
      <button
        type="button"
        className="ds-sm-radek-tlacitko"
        aria-label={`Neobsazená směna, ${misto}, ${smenaProOdecitac(smena)}`}
        onClick={() => onOtevritSmenu(smena)}
      />
      <AvatarM osoba={null} />
      <span className="ds-sm-radek-text" aria-hidden="true">
        <span className="ds-sm-jmeno">Neobsazená směna</span>
        <span className="ds-sm-mista">{misto}</span>
      </span>
      <span className="ds-sm-radek-cas" aria-hidden="true">
        <PilulkaSmeny smena={smena} />
      </span>
    </li>
  );
}

/* ===================================================================== */
/* TÝDEN PO LIDECH                                                       */
/* ===================================================================== */

export type TydenProps = {
  den: string;
  dnes: string;
  smeny: SmenaM[];
  ctx: KontextM;
  filtr: FiltrSmen;
  jeVedouci: boolean;
  onTyden: (smer: -1 | 1) => void;
  onDnes: () => void;
  onOtevritSmenu: (s: SmenaM) => void;
  onPridat: (pro: { osobaId: string | null; den: string }) => void;
  onFiltry: () => void;
  onZrusitFiltr: (druh: "pobocka" | "usek" | "stav", hodnota: string) => void;
};

export function TydenPrehled(p: TydenProps) {
  const { den, dnes, smeny, ctx, filtr, jeVedouci } = p;
  const tyden = sestavitTyden({ smeny, den, osoby: ctx.osoby, useky: ctx.useky, filtr });
  const jeTentoTyden = popisTydne(den) === popisTydne(dnes);
  const pocetFiltru = filtr.pobocky.length + filtr.useky.length + (filtr.stav !== "vse" ? 1 : 0);
  const stav = stavProFiltr(filtr);

  return (
    <section className="ds-sm-tyden-pohled" aria-label={`Týden ${popisTydne(den)}`}>
      <div className="ds-sm-rozsah">
        <button type="button" className="ds-sm-sipka" onClick={() => p.onTyden(-1)} aria-label="Předchozí týden">
          <Ikona klic="sipkaVlevo" />
        </button>
        <h2 className="ds-sm-rozsah-text">{popisTydne(den)}</h2>
        <button type="button" className="ds-sm-sipka" onClick={() => p.onTyden(1)} aria-label="Další týden">
          <Ikona klic="sipkaVpravo" />
        </button>
        <TlacitkoFiltru pocet={pocetFiltru} onKlik={p.onFiltry} kompaktni />
      </div>

      {!jeTentoTyden ? (
        <div className="ds-sm-hlava-akce ds-sm-hlava-akce-radek">
          <button type="button" className="ds-sm-mala-akce" onClick={p.onDnes}>
            Tento týden
          </button>
        </div>
      ) : null}

      {pocetFiltru > 0 ? (
        <div className="ds-sm-filtr-cipy" aria-label="Aktivní filtry">
          {filtr.pobocky.map((id) => (
            <CipFiltru key={id} text={ctx.pobocky.get(id) ?? "Pobočka"} onZrusit={() => p.onZrusitFiltr("pobocka", id)} />
          ))}
          {filtr.useky.map((id) => (
            <CipFiltru
              key={id}
              text={id === BEZ_USEKU ? "Bez úseku" : (ctx.useky.get(id) ?? "Úsek")}
              onZrusit={() => p.onZrusitFiltr("usek", id)}
            />
          ))}
          {stav ? <CipFiltru text={stav} onZrusit={() => p.onZrusitFiltr("stav", "vse")} /> : null}
        </div>
      ) : null}

      {tyden.radky.length === 0 ? (
        <PrazdnyStav
          text={pocetFiltru > 0 ? "Filtrům neodpovídá žádná směna." : "Na tento týden nejsou naplánované žádné směny."}
        />
      ) : (
        <ul className="ds-sm-tydny">
          {tyden.radky.map((r) => {
            const osoba = r.osoba;
            const jmeno = osoba?.jmeno ?? "Neobsazeno";
            const podtitul = osoba
              ? [r.usekNazev, r.minut > 0 ? hodinyKratce(r.minut) : null].filter(Boolean).join(" · ")
              : "Volné směny";
            return (
              <li key={r.klic} className="ds-sm-tyden-karta">
                <div className="ds-sm-tyden-hlava">
                  <AvatarM osoba={osoba} />
                  <span className="ds-sm-radek-text">
                    <span className="ds-sm-jmeno">{jmeno}</span>
                    {podtitul ? <span className="ds-sm-mista">{podtitul}</span> : null}
                  </span>
                </div>
                <div className="ds-sm-dlazdice">
                  {r.dny.map((d, i) => (
                    <DlazdiceDne
                      key={d.den}
                      den={d.den}
                      index={i}
                      smeny={d.smeny}
                      dnes={dnes}
                      jmeno={jmeno}
                      osobaId={osoba?.id ?? null}
                      jeVedouci={jeVedouci}
                      onOtevritSmenu={p.onOtevritSmenu}
                      onPridat={p.onPridat}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DlazdiceDne({
  den,
  index,
  smeny,
  dnes,
  jmeno,
  osobaId,
  jeVedouci,
  onOtevritSmenu,
  onPridat,
}: {
  den: string;
  index: number;
  smeny: SmenaM[];
  dnes: string;
  jmeno: string;
  osobaId: string | null;
  jeVedouci: boolean;
  onOtevritSmenu: (s: SmenaM) => void;
  onPridat: (pro: { osobaId: string | null; den: string }) => void;
}) {
  const [prvni] = smeny;
  const popisek = prvni
    ? `${jmeno}, ${popisDne(den)}, ${smeny.map(smenaProOdecitac).join(", ")}`
    : `${jmeno}, ${popisDne(den)}, volno${jeVedouci ? ", přidat směnu" : ""}`;
  const klikaci = Boolean(prvni) || jeVedouci;

  const obsah = (
    <>
      <span className="ds-sm-dl-den">{ZKRATKY_DNU[index]}</span>
      <span className="ds-sm-dl-cas">
        {prvni ? (
          <>
            {smeny.slice(0, 2).map((s) => (
              <span key={s.id} className="ds-sm-dl-radek" data-koncept={s.published_at ? undefined : "true"}>
                <CasKratce od={s.starts_at} doKdy={s.ends_at} />
              </span>
            ))}
            {smeny.length > 2 ? <span className="ds-sm-dl-vice">+{smeny.length - 2}</span> : null}
          </>
        ) : (
          "Volno"
        )}
      </span>
    </>
  );

  const spolecne = {
    className: "ds-sm-dl",
    "data-stav": prvni ? "smena" : "volno",
    "data-dnes": den === dnes ? "true" : undefined,
    "data-vikend": jeVikend(den) ? "true" : undefined,
  } as const;

  if (!klikaci) {
    return (
      <span {...spolecne} aria-label={popisek} role="img">
        {obsah}
      </span>
    );
  }

  return (
    <button
      type="button"
      {...spolecne}
      aria-label={popisek}
      onClick={() => (prvni ? onOtevritSmenu(prvni) : onPridat({ osobaId, den }))}
    >
      {obsah}
    </button>
  );
}

/* ===================================================================== */
/* MOJE SMĚNY (ZAMĚSTNANEC)                                              */
/* ===================================================================== */

export type MojeProps = {
  dnes: string;
  /** Vlastní směny v načteném okně. */
  moje: SmenaM[];
  ctx: KontextM;
  zalozka: "nadchazejici" | "kalendar";
  /** Měsíc kalendáře / vybraný den. */
  den: string;
  vybranyDen: string;
  /** Vidí i kolegy (`shifts.read`)? Pak se nabídne „Tým dnes“. */
  smiVidetTym: boolean;
  onOtevritSmenu: (s: SmenaM) => void;
  onTym: () => void;
  onKalendar: () => void;
  onVybratDen: (d: string) => void;
  onMesic: (smer: -1 | 1) => void;
};

/** Kolik dní dopředu ukáže „Nadcházející“; dál je Kalendář. */
const NADCHAZEJICI_DNI = 7;

export function MojeSmeny(p: MojeProps) {
  const { dnes, moje, ctx } = p;

  return (
    <div className="ds-sm-moje">
      {p.zalozka === "nadchazejici" ? (
        <>
          <ul className="ds-sm-karty">
            {sestavitNadchazejici(moje, dnes, NADCHAZEJICI_DNI).map((d) => (
              <KartaDne key={d.den} den={d.den} dnes={dnes} stitek={d.stitek} smeny={d.smeny} ctx={ctx} onOtevritSmenu={p.onOtevritSmenu} />
            ))}
          </ul>

          <button type="button" className="ds-sm-odkaz" onClick={p.onKalendar}>
            Další dny v kalendáři
            <Ikona klic="sipkaVpravo" velikost={14} />
          </button>

          {p.smiVidetTym ? (
            <button type="button" className="ds-sm-karta-tym" onClick={p.onTym}>
              <span className="ds-sm-karta-tym-ikona" aria-hidden="true">
                <Ikona klic="lide" velikost={22} />
              </span>
              <span className="ds-sm-karta-tym-text">
                <b>Tým dnes</b>
                <span>Zobrazit, kdo má dnes směnu</span>
              </span>
              <Ikona klic="sipkaVpravo" velikost={16} />
            </button>
          ) : null}

          <div className="ds-sm-pozdrav">
            <span className="ds-sm-pozdrav-ikona" aria-hidden="true">
              <Ikona klic="slunce" velikost={30} />
            </span>
            <p>
              <b>Hezkou směnu!</b>
              <span>Díky, že jsi součástí týmu.</span>
            </p>
          </div>
        </>
      ) : (
        <Kalendar {...p} />
      )}
    </div>
  );
}

function KartaDne({
  den,
  dnes,
  stitek,
  smeny,
  ctx,
  onOtevritSmenu,
}: {
  den: string;
  dnes: string;
  stitek: "Dnes" | "Zítra" | null;
  smeny: SmenaM[];
  ctx: KontextM;
  onOtevritSmenu: (s: SmenaM) => void;
}) {
  const kratce = popisDneKratce(den);
  const [zkratka, ...zbytek] = kratce.split(" ");

  const levy = (
    <span className="ds-sm-karta-den">
      {stitek ? (
        <>
          <b>{stitek}</b>
          <span>{kratce}</span>
        </>
      ) : (
        <span>
          <b>{zkratka}</b> {zbytek.join(" ")}
        </span>
      )}
    </span>
  );

  if (smeny.length === 0) {
    return (
      <li>
        <div className="ds-sm-karta" data-volno="true">
          {levy}
          <span className="ds-sm-karta-volno">
            <Ikona klic="postel" velikost={20} />
            <span className="ft-jen-pro-odecitac">Volno</span>
          </span>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="ds-sm-karta" data-dnes={den === dnes ? "true" : undefined}>
        {levy}
        <span className="ds-sm-karta-smeny">
          {smeny.map((s) => {
            const osoba = s.employee_id ? (ctx.osoby.get(s.employee_id) ?? null) : null;
            const misto = [
              ctx.pobocky.get(s.branch_id),
              s.position_id ? ctx.pozice.get(s.position_id) : osoba?.usekId ? ctx.useky.get(osoba.usekId) : undefined,
              // Rozpis se ještě připravuje: zaměstnanec ho vidí, ale je označený.
              s.published_at ? undefined : "rozpracováno",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={s.id}
                type="button"
                className="ds-sm-karta-smena"
                onClick={() => onOtevritSmenu(s)}
                aria-label={`${stitek ?? popisDne(den)}, ${smenaProOdecitac(s)}${misto ? `, ${misto}` : ""}`}
              >
                <b className="ds-sm-karta-cas" data-koncept={s.published_at ? undefined : "true"}>
                  {rozsahCasu(s.starts_at, s.ends_at)}
                </b>
                {misto ? <span className="ds-sm-karta-misto">{misto}</span> : null}
              </button>
            );
          })}
        </span>
      </div>
    </li>
  );
}

function Kalendar(p: MojeProps) {
  const { dnes, moje, ctx, den, vybranyDen } = p;
  const podleDne = smenyPodleDne(moje);
  const tydny = mesicniMrizka(den);
  const mesic = den.slice(0, 7);
  const vybrane = podleDne.get(vybranyDen) ?? [];

  return (
    <>
      <div className="ds-sm-rozsah">
        <button type="button" className="ds-sm-sipka" onClick={() => p.onMesic(-1)} aria-label="Předchozí měsíc">
          <Ikona klic="sipkaVlevo" />
        </button>
        <h2 className="ds-sm-rozsah-text">{popisMesice(den)}</h2>
        <button type="button" className="ds-sm-sipka" onClick={() => p.onMesic(1)} aria-label="Další měsíc">
          <Ikona klic="sipkaVpravo" />
        </button>
      </div>

      <div className="ds-sm-mesic" role="group" aria-label={popisMesice(den)}>
        {ZKRATKY_DNU.map((z) => (
          <span key={z} className="ds-sm-mesic-hlavicka" aria-hidden="true">
            {z}
          </span>
        ))}
        {tydny.flat().map((d) => {
          const smeny = podleDne.get(d) ?? [];
          const [prvni] = smeny;
          return (
            <button
              key={d}
              type="button"
              className="ds-sm-mesic-den"
              data-mimo={d.slice(0, 7) === mesic ? undefined : "true"}
              data-dnes={d === dnes ? "true" : undefined}
              data-vybrany={d === vybranyDen ? "true" : undefined}
              data-vikend={jeVikend(d) ? "true" : undefined}
              aria-pressed={d === vybranyDen}
              aria-label={`${popisDne(d)}${d === dnes ? ", dnes" : ""}, ${prvni ? smeny.map(smenaProOdecitac).join(", ") : "volno"}`}
              onClick={() => p.onVybratDen(d)}
            >
              <span className="ds-sm-mesic-cislo">{cisloDne(d)}</span>
              {prvni ? (
                <span className="ds-sm-mesic-cas">
                  <CasKratce od={prvni.starts_at} doKdy={prvni.ends_at} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ul className="ds-sm-karty">
        <KartaDne
          den={vybranyDen}
          dnes={dnes}
          stitek={vybranyDen === dnes ? "Dnes" : null}
          smeny={vybrane}
          ctx={ctx}
          onOtevritSmenu={p.onOtevritSmenu}
        />
      </ul>
    </>
  );
}
