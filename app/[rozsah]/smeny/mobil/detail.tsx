"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Ikona from "@/app/[rozsah]/ikona";
import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import { datumACasSRokemVPasmu, datumACasVPasmu } from "@/lib/cas";
import { vyzadujePotvrzeni as vyzadujePotvrzeniDruhu } from "@/lib/upozorneni-text";
import { delkaPopis, minutSmeny, popisDne, rozsahCasu } from "@/lib/rozpis-mobil";
import { nactiStavSmeny, potvrditSmenu, potvrditZmenuSmeny, type StavUpozorneniSmeny } from "../potvrzeni";
import { smazatSmenu, type StavSmeny } from "../smena";
import { AvatarM } from "./prvky";
import { ListMobil } from "./sheet";
import type { KontextM, SmenaM } from "./typy";

/**
 * Detail směny na telefonu.
 *
 * Kdo směnu jen čte (zaměstnanec), vidí údaje a nic víc. Tlačítka
 * Upravit / Poznámka / Duplikovat / Smazat se kreslí jen tomu, kdo smí
 * plánovat (`jeVedouci`) — a to není zámek: `ulozit_smenu` a
 * `smazat_smenu` si právo ověří v databázi na pobočce té směny.
 *
 * MAZÁNÍ. Vydaná směna se neMAŽE, ale RUŠÍ — lidem zmizí až vydáním
 * rozpisu, kde se jim to ohlásí (rozhoduje `public.smazat_smenu`).
 * Tady se jen vybírá slovo na tlačítku a ptá se, než se to stane:
 * rozpis se staví večer a jedno ťuknutí vedle by sebralo směnu, kterou
 * už někdo naplánoval.
 */

export default function DetailSmeny({
  smena,
  ctx,
  rozsah,
  jeVedouci,
  onZavrit,
  onUpravit,
  onPoznamka,
  onDuplikovat,
}: {
  smena: SmenaM;
  ctx: KontextM;
  rozsah: string;
  jeVedouci: boolean;
  onZavrit: () => void;
  onUpravit: (s: SmenaM) => void;
  onPoznamka: (s: SmenaM) => void;
  onDuplikovat: (s: SmenaM) => void;
}) {
  const router = useRouter();
  const [stavSmazani, akceSmazat, cekaSmazani] = useActionState<StavSmeny, FormData>(smazatSmenu, {
    stav: "nic",
  });
  const [pta, setPta] = useState(false);

  useEffect(() => {
    if (stavSmazani.stav === "hotovo") {
      router.refresh();
      onZavrit();
    }
  }, [stavSmazani, router, onZavrit]);

  /*
    Upozornění a potvrzení k téhle směně. Načítá se až po otevření (a
    otevření je zároveň přečtení upozornění — viz ../potvrzeni). Chyba
    nebo nenasazená migrace = žádná data, detail se ukáže bez nich.
  */
  const [upozorneni, setUpozorneni] = useState<StavUpozorneniSmeny | null>(null);
  const [potvrzuje, setPotvrzuje] = useState(false);
  const [chybaPotvrzeni, setChybaPotvrzeni] = useState<string | null>(null);
  const [potvrzujeSmenu, setPotvrzujeSmenu] = useState(false);

  useEffect(() => {
    let zruseno = false;
    nactiStavSmeny(smena.id)
      .then((s) => {
        if (!zruseno) setUpozorneni(s);
      })
      .catch(() => {
        if (!zruseno) setUpozorneni(null);
      });
    return () => {
      zruseno = true;
    };
  }, [smena.id]);

  async function potvrdit(id: string) {
    setPotvrzuje(true);
    setChybaPotvrzeni(null);
    const r = await potvrditZmenuSmeny(id, rozsah);
    if (r.stav === "ok") {
      setUpozorneni((u) =>
        u && u.moje ? { ...u, moje: { ...u.moje, potvrzeno_at: new Date().toISOString() } } : u,
      );
      // Jedno tlačítko „Potvrdit změnu“ potvrdí i samotnou směnu, je-li k potvrzení (moje, vydaná
      // v tomhle znění). Chyba se ukáže, nepolyká se: změna je potvrzená, směna ještě ne.
      if (upozorneni?.potvrzeniSmeny?.mozePotvrdit) {
        const s = await potvrditSmenu(zneniSmeny, rozsah);
        if (s.stav === "chyba") setChybaPotvrzeni(s.text);
      }
      nactiStavSmeny(smena.id)
        .then(setUpozorneni)
        .catch(() => undefined);
      router.refresh();
    } else {
      setChybaPotvrzeni(r.text);
    }
    setPotvrzuje(false);
  }

  /*
    Potvrzení SMĚNY (Šéfík 20. 9. 2026): zaměstnanec vědomě potvrdí, že svou
    vydanou směnu zná. Vedoucí to vidí jako zelený puntík u času. Nová směna
    žádné tlačítko dřív neměla; u změny zůstává „Potvrdit změnu“ a potvrdí
    i směnu (jedno tlačítko, ne dvě).
  */
  async function potvrditSvouSmenu() {
    setPotvrzujeSmenu(true);
    setChybaPotvrzeni(null);
    const r = await potvrditSmenu(zneniSmeny, rozsah);
    if (r.stav === "ok") {
      nactiStavSmeny(smena.id)
        .then(setUpozorneni)
        .catch(() => undefined);
      router.refresh();
    } else {
      setChybaPotvrzeni(r.text);
    }
    setPotvrzujeSmenu(false);
  }

  const moje = upozorneni?.moje ?? null;
  const vedouciStav = upozorneni?.vedouci ?? null;
  const potvrzeniSmeny = upozorneni?.potvrzeniSmeny ?? null;
  // Znění, které člověk vidí — potvrzuje se právě to (změnila-li se směna mezitím, databáze potvrzení odmítne).
  const zneniSmeny = {
    id: smena.id,
    shift_date: smena.shift_date,
    starts_at: smena.starts_at,
    ends_at: smena.ends_at,
    pauza_od: smena.pauza_od ?? null,
    pauza_do: smena.pauza_do ?? null,
  };  // Změna, u které je k dispozici „Potvrdit změnu“ — ta potvrdí i směnu, druhé tlačítko by mátlo.
  const zmenaKPotvrzeni = Boolean(moje && moje.druh === "smena.zmenena" && moje.vyzaduje && !moje.potvrzeno_at);
  const osoba = smena.employee_id ? (ctx.osoby.get(smena.employee_id) ?? null) : null;
  const jmeno = osoba?.jmeno ?? (smena.employee_id ? "Neznámý" : "Neobsazená směna");
  const pozice = smena.position_id ? ctx.pozice.get(smena.position_id) : undefined;
  const usek = osoba?.usekId ? ctx.useky.get(osoba.usekId) : undefined;
  const misto = [pozice ?? usek, ctx.pobocky.get(smena.branch_id)].filter(Boolean).join(" · ");

  const jeVydana = Boolean(smena.published_at);
  const tvurce = smena.created_by ? ctx.tvurci.get(smena.created_by) : undefined;
  const vytvoreno = smena.created_at ? datumACasSRokemVPasmu(smena.created_at) : "";

  return (
    <ListMobil nadpis="Detail směny" onZavrit={onZavrit}>
      <div className="ds-sm-detail">
        {/*
          ZMĚNA, KTEROU MÁ ČLOVĚK POTVRDIT. Nahoře, ne u tlačítek: je to to
          první, co po otevření z upozornění hledá. „Původně → nově“ jen
          když upozornění původní stav nese (od 19. 9.).
        */}
        {moje && moje.druh === "smena.zmenena" ? (
          <div className="ds-sm-zmena" role="status">
            <p className="ds-sm-zmena-nadpis">Směna změněna</p>
            {moje.puvodne && moje.nove ? (
              <p className="ds-sm-zmena-casy">
                <s>{moje.puvodne}</s> <span aria-hidden="true">→</span>
                <span className="ft-jen-pro-odecitac"> změněno na </span> <b>{moje.nove}</b>
              </p>
            ) : null}
            {moje.potvrzeno_at ? (
              <p className="ds-sm-zmena-ok">
                <Ikona klic="fajfka" velikost={16} />
                Potvrzeno {datumACasVPasmu(moje.potvrzeno_at)}
              </p>
            ) : moje.vyzaduje ? (
              <button
                type="button"
                className="ds-sm-tl ds-sm-tl-hlavni"
                disabled={potvrzuje}
                onClick={() => potvrdit(moje.id)}
              >
                {potvrzuje ? "Potvrzuji…" : "Potvrdit změnu"}
              </button>
            ) : null}
            {chybaPotvrzeni ? <p className="hlaska-chyba">{chybaPotvrzeni}</p> : null}
          </div>
        ) : null}

        {/* Potvrzení směny: moje vydaná směna → tlačítko; potvrzená → řádek s časem. */}
        {potvrzeniSmeny?.mozePotvrdit && !zmenaKPotvrzeni ? (
          <div className="ds-sm-zmena" role="status">
            <p className="ds-sm-zmena-nadpis">Potvrďte směnu</p>
            <p className="ds-sm-zmena-casy">Dejte vedoucímu vědět, že o téhle směně víte.</p>
            <button
              type="button"
              className="ds-sm-tl ds-sm-tl-hlavni"
              disabled={potvrzujeSmenu}
              onClick={potvrditSvouSmenu}
            >
              {potvrzujeSmenu ? "Potvrzuji…" : "Potvrdit směnu"}
            </button>
            {chybaPotvrzeni ? <p className="hlaska-chyba">{chybaPotvrzeni}</p> : null}
          </div>
        ) : null}
        {potvrzeniSmeny?.jeMoje && potvrzeniSmeny.stav === "potvrzeno" && !(moje && moje.druh === "smena.zmenena") ? (
          <p className="ds-sm-zmena-ok">
            <Ikona klic="fajfka" velikost={16} />
            Směna potvrzena{potvrzeniSmeny.potvrzeno_at ? ` ${datumACasVPasmu(potvrzeniSmeny.potvrzeno_at)}` : ""}
          </p>
        ) : null}

        <div className="ds-sm-detail-osoba">          <AvatarM osoba={osoba} velikost="v" />
          <div className="ds-sm-detail-osoba-text">
            <p className="ds-sm-detail-jmeno">{jmeno}</p>
            {misto ? <p className="ds-sm-mista">{misto}</p> : null}
          </div>
        </div>

        <ul className="ds-sm-detail-radky">
          <Radek ikona="kalendar">
            <b>{popisDne(smena.shift_date)}</b>
          </Radek>
          <Radek ikona="hodiny">
            <b>{`${smena.starts_at.slice(0, 5)} – ${smena.ends_at.slice(0, 5)}`}</b>
            <span>{delkaPopis(minutSmeny(smena))}</span>
            {smena.pauza_od && smena.pauza_do ? (
              <span>{`pauza ${rozsahCasu(smena.pauza_od, smena.pauza_do)}`}</span>
            ) : null}
          </Radek>
        </ul>

        <dl className="ds-sm-detail-pole">
          {smena.note ? (
            <div>
              <dt>Poznámka</dt>
              <dd>{smena.note}</dd>
            </div>
          ) : null}
          <div>
            <dt>Stav</dt>
            <dd className="ds-sm-stav" data-stav={jeVydana ? "vydana" : "koncept"}>
              <span className="ds-sm-stav-tecka" aria-hidden="true" />
              {jeVydana ? "Publikovaná" : "Rozpracovaná"}
            </dd>
          </div>
          {tvurce || vytvoreno ? (
            <div>
              <dt>Vytvořil</dt>
              <dd>{[tvurce, vytvoreno].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>

        {/*
          PRO VEDOUCÍHO: kdo o téhle směně ví. Jen časy a jméno — obsah
          cizího upozornění se sem nedostane (viz stav_potvrzeni_smeny).
          Potvrzení se ukazuje jen u druhu, který ho vyžaduje.
        */}
        {vedouciStav ? (
          <section className="ds-sm-doruceni" aria-label="Upozornění zaměstnance">
            <p className="ds-sm-doruceni-jmeno">{vedouciStav.jmeno}</p>
            <ul>
              <li data-ok="true">
                <Ikona klic="fajfka" velikost={16} />
                Doručeno {datumACasVPasmu(vedouciStav.prijato_at)}
              </li>
              <li data-ok={vedouciStav.precteno_at ? "true" : "false"}>
                {vedouciStav.precteno_at ? (
                  <>
                    <Ikona klic="fajfka" velikost={16} />
                    Přečteno {datumACasVPasmu(vedouciStav.precteno_at)}
                  </>
                ) : (
                  <>
                    <span className="ds-sm-doruceni-cekani" aria-hidden="true" />
                    Zatím nepřečteno
                  </>
                )}
              </li>
              {vyzadujePotvrzeniDruhu(vedouciStav.druh) ? (
                <li data-ok={vedouciStav.potvrzeno_at ? "true" : "false"}>
                  {vedouciStav.potvrzeno_at ? (
                    <>
                      <Ikona klic="fajfka" velikost={16} />
                      Potvrzeno {datumACasVPasmu(vedouciStav.potvrzeno_at)}
                    </>
                  ) : (
                    <>
                      <span className="ds-sm-doruceni-cekani" aria-hidden="true" />
                      Čeká na potvrzení
                    </>
                  )}
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {jeVedouci ? (
          <div className="ds-sm-detail-akce">
            <button type="button" className="ds-sm-tl ds-sm-tl-hlavni" onClick={() => onUpravit(smena)}>
              Upravit směnu
            </button>
            <button type="button" className="ds-sm-tl" onClick={() => onPoznamka(smena)}>
              <Ikona klic="tuzka" velikost={18} />
              {smena.note ? "Upravit poznámku" : "Přidat poznámku"}
            </button>
            <button type="button" className="ds-sm-tl" onClick={() => onDuplikovat(smena)}>
              <Ikona klic="kopie" velikost={18} />
              Duplikovat směnu
            </button>

            {pta ? (
              <form action={akceSmazat} className="ds-sm-potvrzeni">
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="smena" value={smena.id} />
                <p>
                  <b>{jeVydana ? "Zrušit tuhle směnu?" : "Smazat tuhle směnu?"}</b>
                </p>
                {jeVydana ? (
                  <p className="ds-sm-mista">Zůstane vidět jako zrušená a lidem zmizí, až rozpis vydáte.</p>
                ) : null}
                <div className="ds-sm-potvrzeni-akce">
                  <button type="submit" className="ds-sm-tl ds-sm-tl-nebezpeci" disabled={cekaSmazani}>
                    {cekaSmazani ? (jeVydana ? "Ruším…" : "Mažu…") : jeVydana ? "Zrušit směnu" : "Smazat směnu"}
                  </button>
                  <button type="button" className="ds-sm-tl" onClick={() => setPta(false)}>
                    Zpět
                  </button>
                </div>
                {stavSmazani.stav === "chyba" ? <p className="hlaska-chyba">{stavSmazani.text}</p> : null}
              </form>
            ) : (
              <button type="button" className="ds-sm-tl ds-sm-tl-nebezpeci" onClick={() => setPta(true)}>
                <Ikona klic="kos" velikost={18} />
                {jeVydana ? "Zrušit směnu" : "Smazat směnu"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </ListMobil>
  );
}

function Radek({ ikona, children }: { ikona: IkonaKlic; children: React.ReactNode }) {
  return (
    <li className="ds-sm-detail-radek">
      <span className="ds-sm-detail-ikona" aria-hidden="true">
        <Ikona klic={ikona} velikost={20} />
      </span>
      <span className="ds-sm-detail-radek-text">{children}</span>
    </li>
  );
}
