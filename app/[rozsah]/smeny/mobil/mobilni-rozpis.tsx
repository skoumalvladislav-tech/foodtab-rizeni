"use client";

import { useState, useTransition, type TouchEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Ikona from "@/app/[rozsah]/ikona";
import {
  FILTR_PRAZDNY,
  dnyTydne,
  posunDatum,
  posunMesic,
  type FiltrSmen,
} from "@/lib/rozpis-mobil";
import DetailSmeny from "./detail";
import FiltrySheet from "./filtry";
import { DenPrehled, MojeSmeny, TydenPrehled } from "./pohledy";
import { Prepinac } from "./prvky";
import type { KontextM, SmenaM } from "./typy";

/**
 * Mobilní rozpis směn — kořen.
 *
 * Nemá vlastní data ani vlastní pravidla: dostane hotové směny ze
 * serverové stránky a jen rozhoduje, KTERÝ POHLED se ukáže.
 *
 * ---------------------------------------------------------------------
 * KDO VIDÍ CO
 *
 *   vedoucí (`jeVedouci`, tedy má `shifts.manage`)   Den · Týden · Moje
 *   ostatní                                          Moje směny · Tým dnes
 *
 * Rozhoduje se podle oprávnění, které spočítal server, ne podle názvu
 * role (pravidlo 2). Není to zámek: směnu smí zapsat jen ten, komu to
 * dovolí databáze; tady se jen nekreslí, co by stejně neprošlo.
 *
 * ---------------------------------------------------------------------
 * URL A STAV
 *
 * `?pohled=` a `?den=` říkají, co server načte; `den` je KOTVA načteného
 * týdne. Klepnutí na jiný den téhož týdne nic nenačítá — mění jen
 * vybraný den. Do jiného týdne se jde přes server (`router.push`),
 * protože data tam ještě nejsou. Přepnutí Den ⇄ Týden data nemění,
 * proto jde přes `history.replaceState` a server se neptá.
 */

export type MobilProps = {
  /** Všechny načtené směny (týden + přesah). */
  smeny: SmenaM[];
  /** Vlastní směny přihlášeného v okně nadcházejících a kalendáře. */
  mojeSmeny: SmenaM[];
  ctx: KontextM;
  /** Které dny server načetl (včetně). */
  okno: { od: string; do: string };
  jeVedouci: boolean;
  /** Má přihlášený vlastní záznam zaměstnance (a tedy vlastní směny)? */
  maSve: boolean;
  /** Smí vidět kolegy (`shifts.read`)? */
  smiVidetTym: boolean;
  /** Adresní segment rozsahu — potřebují ho serverové akce. */
  rozsah: string;
  /** Otevře formulář pro novou směnu (případně předvyplněnou člověkem). */
  onPridat: (pro: { osobaId: string | null; den: string }) => void;
  onUpravit: (s: SmenaM) => void;
  onPoznamka: (s: SmenaM) => void;
  onDuplikovat: (s: SmenaM) => void;
};

type Pohled = "den" | "tyden" | "moje" | "tym";

const PRAH_TAHU = 60;

export default function MobilniRozpis(p: MobilProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [ceka, zahajit] = useTransition();

  const { dnesni } = p.ctx;
  const denUrl = params.get("den") ?? dnesni;

  const dovolene: Pohled[] = p.jeVedouci
    ? p.maSve
      ? ["den", "tyden", "moje"]
      : ["den", "tyden"]
    : p.smiVidetTym
      ? ["moje", "tym"]
      : ["moje"];
  const zUrl = params.get("pohled") as Pohled | null;
  const pohled: Pohled = zUrl && dovolene.includes(zUrl) ? zUrl : dovolene[0];

  /*
    Vybraný den se drží zvlášť, aby klepnutí uvnitř načteného týdne
    nechodilo na server. Když se změní KOTVA v adrese (server načetl
    jiný týden), vybraný den se s ní srovná — odvozeně při vykreslení,
    ne efektem, ať se nespouští kaskáda překreslení.
  */
  const [vybranyDen, setVybranyDen] = useState(denUrl);
  const [videnaKotva, setVidenaKotva] = useState(denUrl);
  if (videnaKotva !== denUrl) {
    setVidenaKotva(denUrl);
    setVybranyDen(denUrl);
  }

  const [zalozka, setZalozka] = useState<"nadchazejici" | "kalendar">("nadchazejici");
  const [filtr, setFiltr] = useState<FiltrSmen>(FILTR_PRAZDNY);
  const [filtryOtevrene, setFiltryOtevrene] = useState(false);

  /*
    Detail se drží podle id, ne jako kopie směny: po úpravě přijde ze
    serveru nová data a detail má ukázat je. Směna, která mezitím zmizela
    (smazaná, zrušená), se nenajde a detail se zavře sám.
  */
  /*
    Odkaz z upozornění (`?smena=`) otevře rovnou detail té směny. Čte se
    jen jednou, při prvním vykreslení; po zavření se z adresy odstraní,
    ať ho obnovení stránky neotevře znovu.
  */
  const [detailId, setDetailId] = useState<string | null>(params.get("smena"));
  const detail = detailId ? ([...p.smeny, ...p.mojeSmeny].find((s) => s.id === detailId) ?? null) : null;

  function zavritDetail() {
    setDetailId(null);
    if (params.get("smena")) {
      const q = new URLSearchParams(params.toString());
      q.delete("smena");
      window.history.replaceState(null, "", `?${q.toString()}`);
    }
  }

  function jdi(novyPohled: Pohled, den: string) {
    const q = new URLSearchParams();
    q.set("pohled", novyPohled);
    q.set("den", den);
    zahajit(() => router.push(`?${q.toString()}`));
  }

  /** Celý ISO týden dne už je načtený? Jinak se musí na server. */
  const tydenNacteny = (d: string) => {
    const t = dnyTydne(d);
    return t[0] >= p.okno.od && t[6] <= p.okno.do;
  };

  function vybratDen(d: string) {
    if (tydenNacteny(d)) setVybranyDen(d);
    else jdi(pohled, d);
  }

  function oTyden(smer: -1 | 1) {
    vybratDen(posunDatum(vybranyDen, 7 * smer));
  }

  function zmenitPohled(novy: Pohled) {
    // Stejná data, jiné kreslení — server se neptá. `den` v adrese zůstává
    // kotvou načteného týdne, ne vybraným dnem.
    const q = new URLSearchParams();
    q.set("pohled", novy);
    q.set("den", denUrl);
    window.history.replaceState(null, "", `?${q.toString()}`);
  }

  function oMesic(smer: -1 | 1) {
    // Kalendář měsíce potřebuje vlastní směny jiného měsíce — ty přinese server.
    jdi(pohled, posunMesic(vybranyDen, smer));
  }

  /* --- tah prstem: předchozí / další den -------------------------------- */

  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const tahDnu = pohled === "den" || pohled === "tym";

  function naZacatek(e: TouchEvent) {
    if (!tahDnu) return;
    const t = e.touches[0];
    setStart({ x: t.clientX, y: t.clientY });
  }

  function naKonec(e: TouchEvent) {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    setStart(null);
    // Jen převážně vodorovný tah; svislé posouvání seznamu se nesmí
    // vyložit jako přepnutí dne.
    if (Math.abs(dx) >= PRAH_TAHU && Math.abs(dx) > Math.abs(dy) * 2) {
      vybratDen(posunDatum(vybranyDen, dx < 0 ? 1 : -1));
    }
  }

  /* --- filtry ---------------------------------------------------------- */

  /*
    „Volno“ je stav jen denního přehledu. Kdo ho nechal zvolený a přepnul
    na týden, nesmí vidět chip, který nic nedělá — v týdnu se bere jako
    „Vše“.
  */
  const filtrPlatny: FiltrSmen =
    pohled === "tyden" && filtr.stav === "volno" ? { ...filtr, stav: "vse" } : filtr;

  const zrusitFiltr = (druh: "pobocka" | "usek" | "stav", hodnota: string) =>
    setFiltr(
      druh === "pobocka"
        ? { ...filtr, pobocky: filtr.pobocky.filter((x) => x !== hodnota) }
        : druh === "usek"
          ? { ...filtr, useky: filtr.useky.filter((x) => x !== hodnota) }
          : { ...filtr, stav: FILTR_PRAZDNY.stav },
    );

  const spolecne = {
    dnes: dnesni,
    ctx: p.ctx,
    filtr: filtrPlatny,
    jeVedouci: p.jeVedouci,
    onOtevritSmenu: (s: SmenaM) => setDetailId(s.id),
    onPridat: p.onPridat,
    onFiltry: () => setFiltryOtevrene(true),
    onZrusitFiltr: zrusitFiltr,
  };

  const NAZVY: Record<Pohled, string> = { den: "Den", tyden: "Týden", moje: "Moje", tym: "Tým" };

  return (
    <div
      className="ds-sm"
      aria-busy={ceka || undefined}
      data-ceka={ceka ? "true" : undefined}
      onTouchStart={naZacatek}
      onTouchEnd={naKonec}
    >
      {p.jeVedouci ? (
        <Prepinac
          popis="Pohled na rozpis"
          volby={dovolene.map((k) => [k, NAZVY[k]] as const)}
          hodnota={pohled}
          onZmena={zmenitPohled}
        />
      ) : pohled === "tym" ? (
        <div className="ds-sm-zpet-radek">
          <button type="button" className="ds-sm-zpet" onClick={() => zmenitPohled("moje")} aria-label="Zpět na moje směny">
            <Ikona klic="zpet" />
          </button>
          <h1 className="ds-sm-titul ds-sm-titul-velky">Tým dnes</h1>
        </div>
      ) : (
        <h1 className="ds-sm-titul ds-sm-titul-velky">Moje směny</h1>
      )}

      {pohled === "den" || pohled === "tym" ? (
        <DenPrehled
          {...spolecne}
          den={vybranyDen}
          smeny={p.smeny}
          jeVedouci={p.jeVedouci && pohled === "den"}
          onVybratDen={vybratDen}
          onTyden={oTyden}
          onZobrazitNeobsazene={() => setFiltr({ ...filtr, stav: "neobsazene" })}
        />
      ) : null}

      {pohled === "tyden" ? (
        <TydenPrehled
          {...spolecne}
          den={vybranyDen}
          smeny={p.smeny}
          onTyden={oTyden}
          onDnes={() => vybratDen(dnesni)}
        />
      ) : null}

      {pohled === "moje" ? (
        <>
          <Prepinac
            varianta="zalozky"
            popis="Moje směny"
            volby={[
              ["nadchazejici", "Nadcházející"],
              ["kalendar", "Kalendář"],
            ] as const}
            hodnota={zalozka}
            onZmena={setZalozka}
          />
          <MojeSmeny
            dnes={dnesni}
            ctx={p.ctx}
            moje={p.mojeSmeny}
            zalozka={zalozka}
            den={denUrl}
            vybranyDen={vybranyDen}
            smiVidetTym={p.smiVidetTym && !p.jeVedouci}
            onOtevritSmenu={(s) => setDetailId(s.id)}
            onTym={() => zmenitPohled("tym")}
            onKalendar={() => setZalozka("kalendar")}
            onVybratDen={setVybranyDen}
            onMesic={oMesic}
          />
        </>
      ) : null}

      {p.jeVedouci && (pohled === "den" || pohled === "tyden") ? (
        <button type="button" className="ds-sm-pridat" onClick={() => p.onPridat({ osobaId: null, den: vybranyDen })}>
          <Ikona klic="plus" />
          Přidat směnu
        </button>
      ) : null}

      {detail ? (
        <DetailSmeny
          smena={detail}
          ctx={p.ctx}
          rozsah={p.rozsah}
          jeVedouci={p.jeVedouci}
          onZavrit={zavritDetail}
          onUpravit={(s) => {
            zavritDetail();
            p.onUpravit(s);
          }}
          onPoznamka={(s) => {
            zavritDetail();
            p.onPoznamka(s);
          }}
          onDuplikovat={(s) => {
            zavritDetail();
            p.onDuplikovat(s);
          }}
        />
      ) : null}

      {filtryOtevrene && (pohled === "den" || pohled === "tyden") ? (
        <FiltrySheet
          pohled={pohled}
          den={vybranyDen}
          smeny={p.smeny}
          ctx={p.ctx}
          filtr={filtrPlatny}
          onPouzit={setFiltr}
          onZavrit={() => setFiltryOtevrene(false)}
        />
      ) : null}
    </div>
  );
}
