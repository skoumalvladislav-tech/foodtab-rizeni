import Link from "next/link";

import { hodinaVPasmu } from "@/lib/cas";
import Ikona from "../../ikona";
import { spustitChecklist } from "./akce";
import type { FiltrSeznamu, Karta, Seznam } from "./data";
import { STRANKA_HISTORIE } from "./data";
import FiltryFormular from "./filtry-formular";
import { Avatar, Pruh, SouhrnKarta, StavChip } from "./prvky";
import { denText, NAZVY_ROZVRHU, POHLEDY, STAV_TON, type KlicPohledu } from "./spolecne";

/**
 * Levý sloupec: pohledy, souhrn, filtry a karty checklistů.
 *
 * Všechno se přepíná ADRESOU (odkazy a GET formulář) — funguje bez
 * JavaScriptu a pohled jde poslat kolegovi. Parametry seznamu se nesou
 * i do odkazu na detail, ať se po otevření checklistu seznam vlevo
 * nezmění.
 */
export default function SeznamChecklistu({
  rozsah,
  data,
  filtr,
  dotaz,
  aktivniBeh,
  jmena,
  pobockaNazev,
  pobocky,
  zona,
  smiSpravovat,
}: {
  rozsah: string;
  data: Seznam;
  filtr: FiltrSeznamu;
  /** Parametry seznamu (bez `?`) — přidávají se k odkazům na detail. */
  dotaz: string;
  aktivniBeh: string | null;
  jmena: Map<string, string>;
  pobockaNazev: string | null;
  pobocky: { slug: string; name: string }[];
  zona: string;
  smiSpravovat: boolean;
}) {
  const zaklad = `/${rozsah}/ukoly/checklisty`;
  const sPohledem = (p: KlicPohledu, extra?: Record<string, string>) => {
    const q = new URLSearchParams({ cl: p, ...extra });
    return `${zaklad}?${q.toString()}`;
  };
  const naDetail = (beh: string) => `${zaklad}/${beh}${dotaz ? `?${dotaz}` : ""}`;

  return (
    <div>
      <nav className="ck-pohledy" aria-label="Pohled na checklisty">
        {POHLEDY.map(([klic, nazev]) => (
          <Link key={klic} href={sPohledem(klic)} aria-current={klic === filtr.pohled ? "page" : undefined}>
            {nazev}
            {klic === "dnes" && data.souhrn.celkem > 0 ? <span className="pc-pocet">{data.souhrn.celkem}</span> : null}
          </Link>
        ))}
      </nav>

      {/* Souhrn jen tam, kde jsou skutečná data — prázdné nuly nic neříkají. */}
      {data.souhrn.celkem > 0 ? (
        <div className="ck-souhrn">
          <SouhrnKarta nazev="Dnes" cislo={data.souhrn.celkem} popis="checklistů k vyplnění" ikona="schranka" />
          <SouhrnKarta nazev="Probíhá" cislo={data.souhrn.probiha} popis="právě se vyplňuje" ikona="hodiny" ton="pozor" />
          <SouhrnKarta nazev="Po termínu" cislo={data.souhrn.poTerminu} popis="vyžaduje pozornost" ikona="vykricnik" ton="bad" />
          <SouhrnKarta nazev="Hotovo" cislo={data.souhrn.hotovo} popis="dnes dokončeno" ikona="fajfkaKruh" ton="dobre" />
        </div>
      ) : null}

      {data.sablony.length > 0 ? (
        <FiltryFormular action={zaklad} tlacitko={filtr.pohled === "historie"}>
          <input type="hidden" name="cl" value={filtr.pohled} />
          {pobocky.length > 1 ? (
            <label>
              Pobočka:
              <select name="pobocka" defaultValue="">
                <option value="">{pobockaNazev ?? "—"}</option>
                {pobocky.map((b) => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Úsek:
            <select name="usek" defaultValue={filtr.usek ?? ""}>
              <option value="">Vše</option>
              {[...data.useky].map(([id, nazev]) => (
                <option key={id} value={id}>{nazev}</option>
              ))}
            </select>
          </label>
          <label>
            Stav:
            <select name="stav" defaultValue={filtr.stav ?? "vse"}>
              <option value="vse">Vše</option>
              <option value="nezahajeno">Nezahájeno</option>
              <option value="probiha">Probíhá</option>
              <option value="poterminu">Po termínu</option>
              <option value="hotovo">Hotovo</option>
              <option value="vyhrady">S výhradami</option>
            </select>
          </label>
          {filtr.pohled === "historie" ? (
            <>
              <label>
                Den:
                <input type="date" name="den" defaultValue={filtr.den ?? ""} />
              </label>
              <label>
                Typ:
                <select name="sablona" defaultValue={filtr.sablona ?? ""}>
                  <option value="">Vše</option>
                  {data.sablony.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Osoba:
                <select name="osoba" defaultValue={filtr.osoba ?? ""}>
                  <option value="">Kdokoli</option>
                  {[...jmena].map(([id, jmeno]) => (
                    <option key={id} value={id}>{jmeno}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </FiltryFormular>
      ) : null}

      {!data.den ? (
        <p className="pc-prazdno">Nepodařilo se zjistit provozní den pobočky, takže checklisty nejde zobrazit.</p>
      ) : data.sablony.length === 0 ? (
        <div className="ds-plocha ck-prazdno">
          <Ikona klic="fajfkaKruh" />
          <p style={{ margin: 0 }}>Pro tuhle pobočku zatím není žádný checklist.</p>
          {smiSpravovat ? (
            <Link href={`/${rozsah}/ukoly/sablona/nova`} className="ft-tl ft-tl-hlavni ft-tl-male">
              + Vytvořit checklist
            </Link>
          ) : null}
        </div>
      ) : data.karty.length === 0 ? (
        <div className="ds-plocha ck-prazdno">
          <Ikona klic="fajfkaKruh" />
          <p style={{ margin: 0 }}>
            {filtr.pohled === "dnes"
              ? "Dnes nejsou žádné checklisty."
              : filtr.pohled === "moje"
                ? "Nemáte přiřazený žádný checklist."
                : filtr.pohled === "historie"
                  ? "V historii nic neodpovídá filtru."
                  : "Nic neodpovídá filtru."}
          </p>
        </div>
      ) : (
        <ul className="ck-karty">
          {data.karty.map((k) => (
            <li key={k.klic}>
              <KartaChecklistu
                rozsah={rozsah}
                karta={k}
                den={data.den!}
                pohled={filtr.pohled}
                href={k.beh ? naDetail(k.beh.id) : null}
                aktivni={k.beh !== null && k.beh.id === aktivniBeh}
                jmena={jmena}
                pobockaNazev={pobockaNazev}
                zona={zona}
                smiSpravovat={smiSpravovat}
                zpet={`${zaklad}${dotaz ? `?${dotaz}` : ""}`}
              />
            </li>
          ))}
        </ul>
      )}

      {filtr.pohled === "historie" && data.celkemHistorie > STRANKA_HISTORIE ? (
        <div className="ck-strankovani">
          {filtr.strana > 1 ? (
            <Link href={sPohledem("historie", { strana: String(filtr.strana - 1) })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
              ← Novější
            </Link>
          ) : null}
          <span>
            Strana {filtr.strana} z {Math.ceil(data.celkemHistorie / STRANKA_HISTORIE)}
          </span>
          {filtr.strana * STRANKA_HISTORIE < data.celkemHistorie ? (
            <Link href={sPohledem("historie", { strana: String(filtr.strana + 1) })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
              Starší →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function KartaChecklistu({
  rozsah,
  karta: k,
  den,
  pohled,
  href,
  aktivni,
  jmena,
  pobockaNazev,
  zona,
  smiSpravovat,
  zpet,
}: {
  rozsah: string;
  karta: Karta;
  den: string;
  pohled: KlicPohledu;
  href: string | null;
  aktivni: boolean;
  jmena: Map<string, string>;
  pobockaNazev: string | null;
  zona: string;
  smiSpravovat: boolean;
  zpet: string;
}) {
  const ton = STAV_TON[k.stav];
  const b = k.beh;
  const kdy = b ? (b.business_date === den ? "dnes" : denText(b.business_date)) : pohled === "sablony" ? null : "dnes";
  const meta = [
    k.usekNazev,
    pobockaNazev,
    b?.shift_label || (pohled === "sablony" ? (NAZVY_ROZVRHU[k.sablona.schedule] ?? null) : null),
    kdy,
    pohled === "sablony" && !k.sablona.active ? "vyřazená" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const odpovedny = b?.assigned_employee_id ? (jmena.get(b.assigned_employee_id) ?? null) : null;
  const dokoncil = b?.completed_by ? (jmena.get(b.completed_by) ?? null) : null;
  const hotovyBeh = b && b.status !== "open";
  const osoba = hotovyBeh ? (dokoncil ?? odpovedny) : odpovedny;
  const podOsobou = hotovyBeh
    ? b.finished_at
      ? `hotovo ${hodinaVPasmu(b.finished_at, zona)}`
      : "hotovo"
    : b?.due_at
      ? `do ${hodinaVPasmu(b.due_at, zona)}`
      : null;

  const obsah = (
    <>
      <span className="ck-karta-ikona" aria-hidden="true">
        <Ikona klic="schranka" />
      </span>
      <span className="ck-karta-hlavni">
        <strong>{k.sablona.name}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
      {k.celkem > 0 ? (
        <span className="ck-karta-postup">
          <span>
            {k.hotovo} / {k.celkem}
          </span>
          <Pruh hotovo={k.hotovo} celkem={k.celkem} ton={ton} />
        </span>
      ) : (
        <span className="ck-karta-postup" />
      )}
      {href && pohled !== "sablony" ? (
        <span className="ck-karta-kdo">
          {osoba ? <Avatar jmeno={osoba} /> : null}
          <span>
            {osoba ?? (podOsobou ? "" : "Nepřiřazeno")}
            {podOsobou ? <small data-ton={k.stav === "poterminu" ? "bad" : undefined}>{podOsobou}</small> : null}
          </span>
        </span>
      ) : null}
      <StavChip stav={k.stav} />
    </>
  );

  if (href && pohled !== "sablony") {
    return (
      <Link href={href} className="ck-karta" data-ton={ton} aria-current={aktivni ? "true" : undefined}>
        {obsah}
        <span className="ck-karta-sipka" aria-hidden="true">
          <Ikona klic="sipkaVpravo" />
        </span>
      </Link>
    );
  }

  // Šablona, která dnes běh nemá: spustit (kdokoli, kdo checklist vidí —
  // stejně jako dosud), upravit (jen kdo smí spravovat).
  return (
    <div className="ck-karta" data-ton={ton}>
      {obsah}
      <span className="ck-karta-akce">
        {smiSpravovat ? (
          <Link href={`/${rozsah}/ukoly/sablona/${k.sablona.id}`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Upravit
          </Link>
        ) : null}
        {href ? (
          <Link href={href} className="ft-tl ft-tl-hlavni ft-tl-male">
            Otevřít dnešní
          </Link>
        ) : k.sablona.active ? (
          <form action={spustitChecklist}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="sablona" value={k.sablona.id} />
            <input type="hidden" name="zpet" value={zpet} />
            <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
              Spustit
            </button>
          </form>
        ) : null}
      </span>
    </div>
  );
}
