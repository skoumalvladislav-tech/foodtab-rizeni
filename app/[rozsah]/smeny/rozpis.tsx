"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pocet } from "@/lib/sklonovani";
import {
  DNU_V_ROZPISU,
  MAX_LIDI_V_MESICI,
  VYCHOZI_POHLED,
  jeMesicniPohled,
  jePohled,
  zacatekOkna,
} from "@/lib/rozpis-konstanty";

// Posun data (z lib/provozni-den.ts, duplikovaný pro klient)
function posunDatum(datum: string, dnu: number): string {
  const [r, m, d] = datum.split("-").map(Number);
  const posunuty = new Date(Date.UTC(r, m - 1, d + dnu));
  return posunuty.toISOString().slice(0, 10);
}

// Posun měsíce (měsíční aritmetika, ne ±30 dnů)
function posunMesic(datum: string, mesicu: number): string {
  const [r, m] = datum.split("-").map(Number);
  const posunuty = new Date(Date.UTC(r, m - 1 + mesicu, 1));
  return posunuty.toISOString().slice(0, 10);
}

import Ikona from "@/app/[rozsah]/ikona";
import ZnackaOsoby from "@/app/znacka-osoby";
import Drawer from "@/components/ui/Drawer";
import DropdownMenu from "@/components/ui/DropdownMenu";
import {
  FILTR_DESKTOP_PRAZDNY,
  cekaNaVydani,
  jeFiltrPrazdny,
  puvodniStav,
  sestavitMrizku,
  smenaVyhovuje,
  souhrnZmen,
  stavSmeny,
  zmenyRozpisu,
  type FiltrDesktop,
  type OsobaD,
} from "@/lib/rozpis-desktop";
import { nazevMesice } from "@/lib/rozpis-export";
import { BEZ_USEKU, denVTydnu, dnyTydne, mesicniMrizka, minutSmeny } from "@/lib/rozpis-mobil";
import Nadpis from "../nadpis";
import FormularSmeny, { type PredvyplneniSmeny, type SmenaKUprave } from "./formular-smeny";
// `import type`, ne `import { type … }`: tenhle soubor z ./sablony nic
// nespouští a serverová akce by se sem tahat neměla vůbec.
import type { NabidnutaSablona } from "./sablony";
// Stejný průvodce jako Nastavení → Nahrání dat → Rozpis směn — žádná
// druhá kopie logiky, jen druhé místo, odkud se dá spustit (Šéfíkovo
// zadání 16.9.2026: nahrání rozpisu patří přímo do Rozpisu směn).
import PruvodceNahranim from "../nastaveni/nahrani/rozpis/pruvodce";
import MobilniRozpis from "./mobil/mobilni-rozpis";
import type { KontextM, MobilVstup } from "./mobil/typy";
import type { KontextSmeny } from "./desktop/hlavicka-smeny";
import MesicLidi from "./desktop/mesic-lidi";
import MrizkaTydne from "./desktop/mrizka";
import Nastroje, { type MoznostiFiltru, type Pohled } from "./desktop/nastroje";
import PanelKeSmene from "./desktop/panel-ke-smene";
import type { VydaniProp } from "./desktop/typy";
import { KontrolaVydani, PruhVydani } from "./desktop/vydani";
import ZpravaVydani, { type VysledekVydani } from "./zprava-vydani";

/**
 * Co obrazovka potřebuje, aby šlo směnu založit.
 *
 * `null` znamená „tenhle člověk plánovat nesmí“ — pak se tlačítka
 * nekreslí. Zámek to není: rozhoduje `shifts.manage` v databázi,
 * tady jde jen o to, aby se nenabízelo, co stejně neprojde.
 */
export type Planovani = {
  rozsah: string;
  pobocky: { id: string; nazev: string }[];
  vychoziPobocka: string | null;
  lide: {
    id: string;
    jmeno: string;
    /** Úsek, pozice a barva člověka — pro filtry a řádky lidí bez směny v mřížce na počítači. */
    usekId?: string | null;
    poziceId?: string | null;
    barva?: string | null;
  }[];
  pozice: { id: string; label: string }[];
  /** Smí číst docházku (`attendance.read`)? Rozhoduje, jestli panel směny ukáže kartu Docházka. */
  vidiDochazku?: boolean;
  /*
    Šablony pro VÝCHOZÍ pobočku. Formulář si je po otevření dotáhne
    znovu podle toho, co je zrovna vybrané — tohle je jen proto, aby
    nabídka stála hned při prvním vykreslení a neprobliklo prázdno.
  */
  sablony: NabidnutaSablona[];
};

/**
 * Které okno je otevřené. `smena` prázdná = nová.
 *
 * `predvyplneni` je jen pro novou směnu (kopie jiné směny, zadání
 * konkrétnímu člověku ze seznamu); `zamerit` posune kurzor do poznámky;
 * `nonce` odliší dvě kopie téže směny za sebou, aby se formulář znovu
 * sestavil a nezůstaly v něm hodnoty z té první.
 */
export type Otevrene = {
  den: string;
  smena: SmenaKUprave | null;
  predvyplneni?: PredvyplneniSmeny | null;
  zamerit?: "poznamka";
  nonce?: number;
};

export type Smena = {
  id: string;
  branch_id: string;
  employee_id: string | null;
  position_id: string | null;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string;
  // Vydaná směna se nedá smazat — lidem už je v rozpisu vidět.
  published_at: string | null;
  // Trhaná směna — pauza uvnitř (migrace 20260916200000). Obě, nebo žádná.
  pauza_od: string | null;
  pauza_do: string | null;
  // Kdo a kdy směnu založil — do detailu na telefonu.
  created_by: string | null;
  created_at: string | null;
  // Stav při posledním vydání — mřížka na počítači podle něj rozlišuje
  // nevydané a po vydání změněné směny (lib/rozpis-desktop).
  published_employee_id?: string | null;
  published_starts_at?: string | null;
  published_ends_at?: string | null;
  published_status?: string | null;
};

type RozsahContext = {
  level: "tenant" | "branch";
  branchId: string | null;
  branchName: string | null;
};

type Props = {
  smeny: Smena[];
  dnesni: string;
  dayStartsAt: string;
  jmena: Map<string, string>;
  /*
    Barva člověka — klíč z palety, nebo null.

    Chybějící záznam a null znamenají totéž: bez barvy. Vykreslí se
    prázdný čtvereček s obrysem, ne mezera; viz app/znacka-osoby.
  */
  barvy: Map<string, string | null>;
  pozice: Map<string, string>;
  /** Domovský úsek každého člověka (employees.usek_id) — pro seskupení týdenní mřížky. */
  domovskeUseky: Map<string, string | null>;
  /** Název úseku podle id (useky.nazev). */
  nazvyUseku: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
};

export default function RozpisView({
  smeny: nactene,
  dnesni,
  dayStartsAt,
  jmena,
  barvy,
  pozice,
  domovskeUseky,
  nazvyUseku,
  nazvyPobocek,
  rozsah,
  planovani,
  mobil,
  poziceLidi,
  zrusene,
  vydani,
  vysledekVydani,
}: Props & {
  planovani: Planovani | null;
  mobil: MobilVstup;
  /** employees.position_id — štítek pod jménem v mřížce na počítači. */
  poziceLidi: Map<string, string | null>;
  /** Směny zrušené po vydání, o kterých se ještě nehlásilo — jen pro přehled změn. */
  zrusene: Smena[];
  /** `null` = člověk rozpis neplánuje, žádné vydání nevidí. */
  vydani: VydaniProp | null;
  vysledekVydani?: VysledekVydani;
}) {
  const router = useRouter();
  const [otevrene, setOtevrene] = useState<Otevrene | null>(null);
  const [filtr, setFiltr] = useState<FiltrDesktop>(FILTR_DESKTOP_PRAZDNY);
  const [sbalene, setSbalene] = useState<Set<string>>(() => new Set());
  const [kontrola, setKontrola] = useState(false);
  const [importOtevren, setImportOtevren] = useState(false);
  const [zavrenoZUrl, setZavrenoZUrl] = useState<string | null>(null);
  const naTelefonu = useNaTelefonu();
  const searchParams = useSearchParams();

  // Přečíst z URL nebo použít výchozí (sedm následujících dní od dneška).
  const pohledZUrl = searchParams.get("pohled");
  const denZUrl = searchParams.get("den") ?? dnesni;

  /*
    „Celý měsíc“ (`osoby`) má smysl jen pro vyfiltrované jednoho nebo dva
    lidi. Bez nich (filtr se zrušil, nebo jich je víc) se ukáže výchozí
    pohled, ať se člověk nedívá na prázdný kalendář. Adresa se přitom
    nemění — vybere-li lidi znovu, celý měsíc je zpátky.
  */
  const mesicLidiMozny = filtr.osoby.length >= 1 && filtr.osoby.length <= MAX_LIDI_V_MESICI;
  const pohledZAdresy: Pohled = jePohled(pohledZUrl) ? pohledZUrl : VYCHOZI_POHLED;
  const pohled: Pohled = pohledZAdresy === "osoby" && !mesicLidiMozny ? VYCHOZI_POHLED : pohledZAdresy;
  const den = denZUrl;

  /*
    Odkaz na konkrétní směnu (`?smena=`) — z Docházky a z upozornění. Na
    telefonu ho vyřizuje mobilní detail; na počítači se otevře panel
    vpravo. Odvozeně, ne efektem: pokud si člověk panel zavře, adresa se
    znovu neuplatní (proto \`zavrenoZUrl\`), a nemusí se nikam přepisovat.
  */
  const idZUrl = searchParams.get("smena");
  const smenaZUrl =
    !naTelefonu && idZUrl && idZUrl !== zavrenoZUrl ? (nactene.find((s) => s.id === idZUrl) ?? null) : null;
  const okno: Otevrene | null =
    otevrene ?? (smenaZUrl ? { den: smenaZUrl.shift_date, smena: smenaZUrl } : null);
  const zavritOkno = () => {
    setOtevrene(null);
    if (idZUrl) setZavrenoZUrl(idZUrl);
  };

  /*
    Server načítá o něco víc, než desktop potřebuje (celý ISO týden pro
    telefon), takže mřížka si vezme jen svých `DNU_V_ROZPISU` dnů. Bez
    toho by dny před `den` dostaly vlastní sloupec.
  */
  const zacatek = zacatekOkna(pohled, den);
  const dny = Array.from({ length: DNU_V_ROZPISU }, (_, i) => posunDatum(zacatek, i));
  const konecOkna = dny[dny.length - 1];
  const smeny = nactene.filter((s) => s.shift_date >= zacatek && s.shift_date <= konecOkna);

  /*
    Kontext pro mobilní pohledy. Jména a barvy má `page.tsx` jen u lidí,
    kteří mají v okně směnu — kdo jinde není, se v mobilním přehledu
    nekreslí (viz lib/rozpis-mobil, „Kdo je v rozpisu“).
  */
  const kontext: KontextM = {
    dnesni,
    osoby: new Map(
      [...jmena].map(([id, jmeno]) => [
        id,
        { id, jmeno, usekId: domovskeUseky.get(id) ?? null, barva: barvy.get(id) ?? null },
      ]),
    ),
    useky: nazvyUseku,
    pobocky: nazvyPobocek,
    pozice,
    tvurci: mobil.tvurci,
    vicePobocek: new Set(nactene.map((s) => s.branch_id)).size > 1,
  };

  const updateUrl = (newPohled: Pohled, newDay: string) => {
    const params = new URLSearchParams();
    params.set("pohled", newPohled);
    params.set("den", newDay);
    router.push(`?${params.toString()}`);
  };

  // Měsíc se posouvá po měsících, týden i sedm dní po týdnu, den po dni.
  const posun = (smer: -1 | 1) =>
    updateUrl(
      pohled,
      jeMesicniPohled(pohled)
        ? posunMesic(den, smer)
        : posunDatum(den, (pohled === "sedm" || pohled === "tyden" ? 7 : 1) * smer),
    );

  /* --- lidé, pozice a nabídky filtrů --------------------------------- */

  /*
    Lidé pro mřížku: kdo má v okně směnu (jména dodává page.tsx) plus ti,
    které vedoucí smí plánovat a nemají žádnou — tihle se kreslí dole, ať
    jim jde směna zadat. Úsek, pozici a barvu má page.tsx u obou skupin.
  */
  const osoby = new Map<string, OsobaD>();
  for (const [id, jmeno] of jmena) {
    osoby.set(id, {
      id,
      jmeno,
      usekId: domovskeUseky.get(id) ?? null,
      poziceId: poziceLidi.get(id) ?? null,
      barva: barvy.get(id) ?? null,
    });
  }
  const idSeSmenou = new Set(smeny.map((s) => s.employee_id).filter((i): i is string => i !== null));
  const lideBezSmeny: OsobaD[] = planovani
    ? planovani.lide
        .filter((c) => !idSeSmenou.has(c.id))
        .map((c) => ({
          id: c.id,
          jmeno: c.jmeno,
          usekId: c.usekId ?? null,
          poziceId: c.poziceId ?? null,
          barva: c.barva ?? null,
        }))
    : [];
  const jmenoOsoby = (id: string): string =>
    jmena.get(id) ?? planovani?.lide.find((c) => c.id === id)?.jmeno ?? "Neznámý";

  // Štítky pozic: ty, které zná server u lidí ze směn, a všechny aktivní u plánujícího.
  const nazvyPozic = new Map<string, string>(pozice);
  for (const p of planovani?.pozice ?? []) nazvyPozic.set(p.id, p.label);
  const poziceOsoby = (osobaId: string): string | null => {
    const id = osoby.get(osobaId)?.poziceId ?? planovani?.lide.find((c) => c.id === osobaId)?.poziceId ?? null;
    return id ? (nazvyPozic.get(id) ?? null) : null;
  };

  const moznosti: MoznostiFiltru = {
    useky: [
      ...[...nazvyUseku].map(([klic, nazev]) => ({ klic, nazev })),
      ...([...osoby.values(), ...lideBezSmeny].some((o) => !o.usekId || !nazvyUseku.has(o.usekId))
        ? [{ klic: BEZ_USEKU, nazev: "Bez úseku" }]
        : []),
    ],
    pozice: [...nazvyPozic].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "cs")),
    lide: [...osoby.values(), ...lideBezSmeny]
      .map((o) => ({ id: o.id, jmeno: o.jmeno }))
      .sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs")),
  };

  const mrizka = sestavitMrizku({
    smeny,
    dny,
    osoby,
    useky: nazvyUseku,
    pobocky: nazvyPobocek,
    lideBezSmeny,
    filtr,
  });

  // Den a měsíc filtrují po směnách (nemají řádky lidí).
  const smenyFiltrovane = jeFiltrPrazdny(filtr)
    ? smeny
    : smeny.filter((s) => smenaVyhovuje(s, osoby, filtr, nazvyUseku));
  const nactenoFiltrovane = jeFiltrPrazdny(filtr)
    ? nactene
    : nactene.filter((s) => smenaVyhovuje(s, osoby, filtr, nazvyUseku));

  /* --- vydání rozpisu ---------------------------------------------- */

  const zmeny = vydani ? zmenyRozpisu([...smeny, ...zrusene]) : [];
  const obdobi = popisObdobi(zacatek, "sedm");
  const cekaVydani = souhrnZmen(zmeny).smen > 0 && vydani?.pobockaId != null && vydani.mozeVydat;

  /*
    Kolik minut má člověk v zobrazeném týdnu naplánováno (bez směny, která
    se právě upravuje). Formulář z toho ukazuje průběžný součet. Datum
    mimo načtené dny → `null`: součet by byl nepravdivý, tak se neukáže.
  */
  const souctyTydne = (zamestnanec: string, datum: string, ignorovat: string | null): number | null => {
    // Týden je kalendářní (pondělí–neděle), ať se rozpis dívá na sedm dní od
    // kteréhokoli dne. Součet je pravdivý jen s celým týdnem v načtených datech.
    const tyden = dnyTydne(datum);
    if (tyden[0] < mobil.okno.od || tyden[6] > mobil.okno.do) return null;
    return nactene
      .filter(
        (s) =>
          s.employee_id === zamestnanec &&
          s.id !== ignorovat &&
          s.shift_date >= tyden[0] &&
          s.shift_date <= tyden[6],
      )
      .reduce((n, s) => n + minutSmeny(s), 0);
  };

  /* --- akce nad směnou -------------------------------------------- */

  // Je vyfiltrovaný právě jeden člověk, formulář se otevře rovnou s ním.
  const novaSmena = () =>
    setOtevrene({
      den: pohled === "den" ? den : dny.includes(dnesni) ? dnesni : den,
      smena: null,
      predvyplneni: filtr.osoby.length === 1 ? { employee_id: filtr.osoby[0] } : null,
      nonce: Date.now(),
    });

  const duplikovat = (s: SmenaKUprave) =>
    setOtevrene({
      den: s.shift_date,
      smena: null,
      predvyplneni: {
        employee_id: s.employee_id,
        position_id: s.position_id,
        branch_id: s.branch_id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        note: s.note,
        pauza_od: s.pauza_od,
        pauza_do: s.pauza_do,
      },
      nonce: Date.now(),
    });

  // Směna v panelu, ale s CELÝMI daty (stav při vydání), ne jen s tím, co formulář potřebuje.
  const upravovana = okno?.smena?.id ? (smeny.find((s) => s.id === okno.smena?.id) ?? null) : null;
  const kontextSmeny: KontextSmeny | undefined = upravovana
    ? (() => {
        const puv = puvodniStav(upravovana);
        const usekId = upravovana.employee_id ? (domovskeUseky.get(upravovana.employee_id) ?? null) : null;
        return {
          jmeno: upravovana.employee_id ? jmenoOsoby(upravovana.employee_id) : null,
          role: upravovana.employee_id ? poziceOsoby(upravovana.employee_id) : null,
          usek: usekId ? (nazvyUseku.get(usekId) ?? null) : null,
          stav: stavSmeny(upravovana),
          puvodne: puv?.casSeZmenil ? `Původně ${puv.od}–${puv.do}` : null,
        };
      })()
    : undefined;

  return (
    <>
      <ZpravaVydani vysledek={vysledekVydani ?? { vydano: null, chyba: null }} />

      {/*
      TELEFON. Jiná prezentace téhož rozpisu, ne druhý rozpis — data,
      oprávnění i formulář jsou společné. Které z obou stromů je vidět,
      rozhoduje CSS (app/_komponenty.css, `ds-sm-jen-*`), ne JavaScript.
    */}
      <div className="ds-sm-jen-mobil">
        <MobilniRozpis
          smeny={nactene}
          mojeSmeny={mobil.mojeSmeny}
          ctx={kontext}
          okno={mobil.okno}
          jeVedouci={planovani !== null}
          maSve={mobil.maSve}
          smiVidetTym
          rozsah={mobil.rozsah}
          onPridat={({ osobaId, den: d }) =>
            setOtevrene({
              den: d,
              smena: null,
              predvyplneni: osobaId ? { employee_id: osobaId } : null,
              nonce: Date.now(),
            })
          }
          onUpravit={(s) => setOtevrene({ den: s.shift_date, smena: s })}
          onPoznamka={(s) => setOtevrene({ den: s.shift_date, smena: s, zamerit: "poznamka" })}
          onDuplikovat={duplikovat}
        />
      </div>

      {/*
        POČÍTAČ. Mřížka je hlavní pracovní plocha: všechno kolem ní je
        jeden řádek nástrojů a (jen když je co vydávat) jeden úzký pruh.
        Sloupec s pevnou výškou, aby mřížka zabrala zbytek obrazovky a
        scrollovala sama v sobě — záhlaví dnů a sloupec se jmény tak
        zůstanou přilepené.
      */}
      <div className="ds-sm-jen-desktop ds-smd">
        <Nadpis
          popis="Plánujte směny, sledujte obsazenost a jednoduše vydávejte změny."
          vpravo={
            planovani ? (
              <>
                {/*
                  Export tabulky za měsíc, který se zrovna prohlíží. Je to
                  obyčejný odkaz na soubor (`/api/smeny/export`): právo
                  `shifts.manage` si ověří server, ne tlačítko.
                */}
                <DropdownMenu
                  zarovnani="end"
                  spoustec={
                    <span className="ft-tl ft-tl-male ft-tl-vedlejsi">
                      <Ikona klic="faktura" velikost={15} />
                      Export
                    </span>
                  }
                  polozky={(["xlsx", "pdf"] as const).map((format) => ({
                    klic: format,
                    nazev: `${format === "xlsx" ? "Excel (.xlsx)" : "PDF"} — ${nazevMesice(den.slice(0, 7))}`,
                    href: `/api/smeny/export?rozsah=${encodeURIComponent(planovani.rozsah)}&mesic=${den.slice(0, 7)}&format=${format}`,
                  }))}
                />
                <button type="button" className="ft-tl ft-tl-male ft-tl-vedlejsi" onClick={() => setImportOtevren(true)}>
                  <Ikona klic="seznam" velikost={15} />
                  Import z tabulky
                </button>
                <button
                  type="button"
                  className={`ft-tl ft-tl-male ${cekaVydani ? "ft-tl-vedlejsi" : "ft-tl-hlavni"}`}
                  onClick={novaSmena}
                >
                  <Ikona klic="plus" velikost={15} />
                  Přidat směnu
                </button>
              </>
            ) : null
          }
        >
          Rozpis směn
        </Nadpis>

        <Nastroje
          pohled={pohled}
          obdobi={popisObdobi(den, pohled)}
          onPosun={posun}
          onDnes={() => updateUrl(pohled, dnesni)}
          onPohled={(p) => updateUrl(p, den)}
          filtr={filtr}
          onFiltr={setFiltr}
          moznosti={moznosti}
          mesicLidiMozny={mesicLidiMozny}
        />

        <PruhVydani
          zmeny={zmeny}
          vydani={vydani}
          obdobi={obdobi}
          kontrolaAktivni={filtr.stav === "nevydane"}
          onZkontrolovat={() => setFiltr((f) => ({ ...f, stav: f.stav === "nevydane" ? "vse" : "nevydane" }))}
          onVydat={() => setKontrola(true)}
        />

        {(pohled === "sedm" || pohled === "tyden") && (
          <MrizkaTydne
            mrizka={mrizka}
            dny={dny}
            dnesni={dnesni}
            planovani={planovani}
            poziceOsob={poziceOsoby}
            barvy={barvy}
            jmena={jmena}
            vybranaId={okno?.smena?.id || null}
            sbalene={sbalene}
            onPrepnout={(klic) =>
              setSbalene((s) => {
                const dalsi = new Set(s);
                if (!dalsi.delete(klic)) dalsi.add(klic);
                return dalsi;
              })
            }
            onOtevrit={setOtevrene}
            filtrAktivni={!jeFiltrPrazdny(filtr)}
            onZrusitFiltry={() => setFiltr(FILTR_DESKTOP_PRAZDNY)}
            maSmeny={smeny.length > 0}
          />
        )}

        {pohled === "osoby" && (
          <div className="ds-smd-pohled">
            <MesicLidi
              lide={filtr.osoby.map((id) => ({ id, jmeno: jmenoOsoby(id) }))}
              mesic={den.slice(0, 7)}
              tydny={mesicniMrizka(den)}
              smeny={nactene}
              dnesni={dnesni}
              planovani={planovani}
              jmena={jmena}
              poziceOsob={poziceOsoby}
              barvy={barvy}
              nazvyPobocek={nazvyPobocek}
              vybranaId={okno?.smena?.id || null}
              onOtevrit={setOtevrene}
            />
          </div>
        )}

        {pohled === "mesic" && (
          <div className="ds-smd-pohled">
            <MesicView
              smeny={nactenoFiltrovane}
              den={den}
              onSelectDay={(newDay) => updateUrl("den", newDay)}
            />
          </div>
        )}

        {pohled === "den" && (
          <div className="ds-smd-pohled">
            <DenView
              smeny={smenyFiltrovane}
              den={den}
              dnesni={dnesni}
              dayStartsAt={dayStartsAt}
              jmena={jmena}
              barvy={barvy}
              pozice={pozice}
              nazvyPobocek={nazvyPobocek}
              rozsah={rozsah}
              planovani={planovani}
              onOtevrit={setOtevrene}
            />
          </div>
        )}
        {/*
          V přehledovém měsíci (počty směn) se nezakládá schválně (zadání,
          bod 2): do dne se tam neklikne přesně a člověk by směnu zapsal o
          den vedle. Zakládá se v „Celém měsíci“ vybraných lidí — tam je
          člověk dán a každý den má vlastní tlačítko.
        */}
      </div>

      {planovani && okno ? (
        <FormularSmeny
          /*
            key podle toho, co se otevřelo. defaultValue se uplatní jen
            při prvním připojení — kdyby se okno znovupoužilo pro jinou
            směnu, zůstaly by v něm časy té předchozí. Přesně tak se
            2. 9. předvyplňoval odchod jako příchod.
          */
          key={okno.smena?.id || `nova-${okno.den}-${okno.nonce ?? 0}`}
          varianta={naTelefonu ? "list" : "drawer"}
          predvyplneni={okno.predvyplneni}
          zamerit={okno.zamerit}
          rozsah={planovani.rozsah}
          den={okno.den}
          smena={okno.smena}
          pobocky={planovani.pobocky}
          vychoziPobocka={planovani.vychoziPobocka}
          lide={planovani.lide}
          pozice={planovani.pozice}
          sablony={planovani.sablony}
          kontext={kontextSmeny}
          souctyTydne={souctyTydne}
          onDuplikovat={okno.smena?.id ? () => duplikovat(okno.smena as SmenaKUprave) : undefined}
          dole={
            upravovana ? (
              <PanelKeSmene
                rozsah={planovani.rozsah}
                smena={upravovana}
                jmeno={upravovana.employee_id ? jmenoOsoby(upravovana.employee_id) : null}
                dnesni={dnesni}
                vidiDochazku={planovani.vidiDochazku ?? false}
              />
            ) : null
          }
          onZavrit={zavritOkno}
        />
      ) : null}

      {kontrola && vydani ? (
        <KontrolaVydani
          rozsah={planovani?.rozsah ?? mobil.rozsah}
          zmeny={zmeny}
          vydani={vydani}
          obdobi={obdobi}
          pobockaNazev={vydani.pobockaId ? (nazvyPobocek.get(vydani.pobockaId) ?? null) : null}
          jmeno={jmenoOsoby}
          onZavrit={() => setKontrola(false)}
        />
      ) : null}

      {importOtevren && planovani ? (
        <Drawer otevreno onZavrit={() => setImportOtevren(false)} nadpis="Import rozpisu z tabulky" sirka="plna">
          {/*
            Nahrání rozpisu z tabulky — přímo tady, ne jen v Nastavení
            (Šéfíkovo zadání 16. 9. 2026). Týž průvodce jako Nastavení →
            Nahrání dat → Rozpis směn: jedna logika, dvě místa, odkud se
            dá spustit. Stejné právo jako ruční zakládání směny
            (`planovani` je `null`, když ho člověk nemá).
          */}
          <PruvodceNahranim rozsah={planovani.rozsah} pobocky={planovani.pobocky} />
        </Drawer>
      ) : null}
    </>
  );
}

function popisObdobi(den: string, pohled: Pohled): string {
  const d = new Date(`${den}T00:00:00Z`);

  if (pohled === "mesic" || pohled === "osoby") {
    const mesice = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
    return `${mesice[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  if (pohled === "sedm" || pohled === "tyden") {
    // „7 dní“ běží od zvoleného dne dopředu, „Týden“ od pondělí — dotaz na
    // směny počítá začátek okna týmž `zacatekOkna` a obojí čte
    // DNU_V_ROZPISU, takže hlavička nemůže hlásit jiné dny, než jsou ve
    // sloupcích (kdysi hlásila kalendářní týden nad sloupci od dneška).
    const od = new Date(`${zacatekOkna(pohled, den)}T00:00:00Z`);
    const konec = new Date(od);
    konec.setUTCDate(od.getUTCDate() + DNU_V_ROZPISU - 1);

    const mesice = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
    const m1 = mesice[od.getUTCMonth()];
    const m2 = mesice[konec.getUTCMonth()];

    if (od.getUTCMonth() === konec.getUTCMonth()) {
      return `${od.getUTCDate()}.–${konec.getUTCDate()}. ${m1}`;
    }
    return `${od.getUTCDate()}. ${m1} – ${konec.getUTCDate()}. ${m2}`;
  }

  const dny = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const mesice = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${mesice[d.getUTCMonth()]}`;
}

/** Šířka sloupce se jmény v denním pohledu (dřív 80 px: „Lucie Skoum…“). */
const ETIKETA_DNE = 170;

function DenView({
  smeny,
  den,
  dnesni,
  dayStartsAt,
  jmena,
  barvy,
  pozice,
  nazvyPobocek,
  rozsah,
  planovani,
  onOtevrit,
}: {
  smeny: Smena[];
  den: string;
  dnesni: string;
  dayStartsAt: string;
  jmena: Map<string, string>;
  barvy: Map<string, string | null>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
  planovani: Planovani | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  // Smeny na daný den
  const smenySeDnem = smeny.filter((s) => s.shift_date === den);

  // Parsuj dayStartsAt (např. "05:00")
  const [hodStart, minStart] = dayStartsAt.split(":").map(Number);
  const osStart = hodStart * 60 + minStart; // v minutách od půlnoci
  const osTotalMin = 24 * 60; // délka provozního dne (24 hodin)

  // Pomocná funkce: převede čas HH:MM na minuty od osStart
  const casNaMinuty = (cas: string): number => {
    const [h, m] = cas.split(":").map(Number);
    let casVMin = h * 60 + m;
    // Pokud je čas "do zítřka" (menší než osStart), přičti 24 hodin
    // (znamená to, že směna pokračuje do příštího provozního dne)
    if (casVMin < osStart && h < 12) {
      casVMin += 24 * 60;
    }
    return casVMin - osStart;
  };

  // Seřaď směny
  const serazeno = [...smenySeDnem].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // Identifikuj mezery — doby bez obsazení
  const mezery: Array<{ od: number; do: number }> = [];
  if (serazeno.length === 0) {
    mezery.push({ od: 0, do: osTotalMin });
  } else {
    let posledniKonec = 0;
    for (const s of serazeno) {
      const zacatek = casNaMinuty(s.starts_at);
      const konec = casNaMinuty(s.ends_at);
      if (zacatek > posledniKonec) {
        mezery.push({ od: posledniKonec, do: zacatek });
      }
      posledniKonec = Math.max(posledniKonec, konec);
    }
    if (posledniKonec < osTotalMin) {
      mezery.push({ od: posledniKonec, do: osTotalMin });
    }
  }

  // "Teď" indikátor — jen pro dnešní den a jen v prohlížeči.
  //
  // Čára se počítá z new Date(). Tahle komponenta je sice klientská, ale
  // Next ji stejně vykreslí i na serveru, aby měl co poslat v HTML —
  // a server má jiné hodiny a hlavně jiný okamžik než prohlížeč.
  // Vyšlo tedy pokaždé jiné procento, obě vykreslení se rozešla a React
  // hlásil neshodu při hydrataci.
  //
  // Na serveru i při prvním vykreslení v prohlížeči je proto null, tedy
  // žádná čára — obojí vypadá stejně a hydratace sedne. Doplní se hned
  // po připojení, kdy už se není s čím rozcházet.
  const vProhlizeci = useVProhlizeci();
  const ted = vProhlizeci && den === dnesni ? getTedMinuta(osStart) : null;

  // Podíl (0–100%) — kolik procent dne uplynulo?
  const tedProc = ted !== null ? (ted / osTotalMin) * 100 : null;

  // Layout: 1200px = 24 hodin, 50px za hodinu
  const pixelPerMin = 1200 / osTotalMin;
  const rowHeight = 48;

  return (
    <div style={{ display: "grid", gap: "0px", position: "relative", minWidth: `${ETIKETA_DNE + 1200}px` }}>
      {/* Záhlaví — časová osa */}
      <div style={{ display: "flex", height: "32px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--card)", zIndex: 5 }}>
        <div style={{ width: `${ETIKETA_DNE}px`, flexShrink: 0, padding: "4px 8px", fontSize: "11px", fontWeight: 600 }}>Čas</div>
        <div style={{ flex: 1, position: "relative", minWidth: "1200px" }}>
          {Array.from({ length: 24 }).map((_, i) => {
            const h = (hodStart + i) % 24;
            const x = i * (1200 / 24);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}px`,
                  top: 0,
                  width: "50px",
                  height: "100%",
                  borderLeft: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  color: "var(--muted)",
                }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            );
          })}
        </div>
      </div>

      {/* Řady se směnami */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {serazeno.map((s, idx) => {
          const obsazena = s.employee_id !== null;
          const jmeno = obsazena ? jmena.get(s.employee_id as string) ?? "Neznámý" : "Neobsazeno";
          const zacatek = casNaMinuty(s.starts_at);
          const konec = casNaMinuty(s.ends_at);
          const left = zacatek * pixelPerMin;
          const width = (konec - zacatek) * pixelPerMin;

          return (
            <div key={s.id} style={{ display: "flex", height: `${rowHeight}px`, borderBottom: "1px solid var(--line)", position: "relative" }}>
              <div style={{ width: `${ETIKETA_DNE}px`, flexShrink: 0, padding: "8px 10px", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: "6px" }}>
                {obsazena ? <ZnackaOsoby barva={barvy.get(s.employee_id as string) ?? null} velikost={8} /> : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{jmeno}</span>
              </div>
              <div style={{ flex: 1, position: "relative", minWidth: "1200px" }}>
                {/* Pruh směny. Kdo smí plánovat, může na něj kliknout. */}
                {(() => {
                  /*
                    Nevydaná směna má stejný vzhled jako v týdenní mřížce:
                    přerušovaný jantarový rámeček a slovo „nevydáno“ (barva
                    nikdy nestojí sama). Vydaná zůstává v barvě pobočky.
                  */
                  const nevydana = cekaNaVydani(s);
                  const styl = {
                    position: "absolute" as const,
                    left: `${left}px`,
                    top: "8px",
                    width: `${width}px`,
                    height: `${rowHeight - 16}px`,
                    background: nevydana
                      ? "color-mix(in srgb, var(--mosaz-sv) 20%, var(--card))"
                      : obsazena
                        ? "var(--branch-soft)"
                        : "var(--pozor-bg)",
                    border: `1px ${nevydana ? "dashed" : "solid"} ${nevydana ? "var(--mosaz)" : obsazena ? "var(--branch)" : "var(--pozor)"}`,
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    // Vlevo místo na proužek s barvou člověka.
                    padding: "0 4px 0 8px",
                    fontSize: "11px",
                    color: nevydana ? "var(--ink)" : obsazena ? "var(--branch)" : "var(--pozor)",
                    whiteSpace: "nowrap" as const,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  };

                  /*
                    PLOCHA JE POBOČKA, PROUŽEK JE ČLOVĚK.

                    Výplň a rámeček pruhu drží barvu pobočky
                    (`--branch-soft` / `--branch`). Barva člověka se do
                    nich plést nesmí — dnes mají obě pobočky Růžovou,
                    takže rozdíl odstínu by nikoho nezachránil. Proto
                    úzký proužek na náběžné hraně a vlastní proměnná
                    `--osoba`.

                    U neobsazené směny žádný není: není čí.
                  */
                  const barvaOsoby = obsazena
                    ? barvy.get(s.employee_id as string) ?? null
                    : null;
                  const prouzek = barvaOsoby ? (
                    <span
                      aria-hidden="true"
                      data-osoba={barvaOsoby}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: "4px",
                        borderRadius: "4px 0 0 4px",
                        background: "var(--osoba)",
                      }}
                    />
                  ) : null;

                  const obsah = nevydana ? `${popisSmeny(s)} · nevydáno` : popisSmeny(s);
                  return planovani ? (
                    <button
                      type="button"
                      onClick={() => onOtevrit({ den, smena: s })}
                      style={{ ...styl, cursor: "pointer", font: "inherit", fontSize: "11px" }}
                      title="Upravit směnu"
                    >
                      {prouzek}
                      {obsah}
                    </button>
                  ) : (
                    <div style={styl}>
                      {prouzek}
                      {obsah}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mezery — horizontální pásy pod řadami */}
      {mezery.length > 0 && (
        <div style={{ display: "flex" }}>
          <div style={{ width: `${ETIKETA_DNE}px`, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: "1200px", position: "relative", height: `${mezery.length * rowHeight}px` }}>
            {mezery.map((m, i) => (
              <div
                key={`gap-${i}`}
                style={{
                  position: "absolute",
                  top: `${i * rowHeight}px`,
                  left: `${m.od * pixelPerMin}px`,
                  width: `${(m.do - m.od) * pixelPerMin}px`,
                  height: `${rowHeight}px`,
                  background: "rgba(100, 100, 100, 0.08)",
                  borderTop: "1px dashed var(--line)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* "Teď" indikátor — svislá čára */}
      {tedProc !== null && (
        <div style={{ display: "flex", position: "absolute", top: 0, left: `${ETIKETA_DNE}px`, right: 0, height: "100%", pointerEvents: "none", zIndex: 3 }}>
          <div
            style={{
              position: "absolute",
              left: `${tedProc}%`,
              top: 0,
              bottom: 0,
              width: "2px",
              background: "var(--warn)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function getTedMinuta(osStart: number): number {
  const ted = new Date();
  const tedMin = ted.getHours() * 60 + ted.getMinutes();
  return tedMin - osStart;
}

/* Prázdné odhlášení. Musí to být stálá hodnota, jinak by se React
   přihlašoval znovu při každém vykreslení. */
const NEODEBIRAT = () => () => {};

/**
 * Běžíme už v prohlížeči?
 *
 * Vrací false na serveru i při prvním vykreslení v prohlížeči, teprve
 * potom true. Obě strany tak vykreslí totéž a hydratace sedne; co se
 * liší, se dopočítá až v druhém průchodu.
 *
 * Patří sem cokoli, co se ptá na aktuální čas — server má jiné hodiny
 * i jiný okamžik než prohlížeč a nikdy se netrefí. Přes useState
 * v efektu se to dělat nedá: nastavit stav rovnou v efektu spustí
 * druhé vykreslení navíc a hlídá to i lint.
 */
function useVProhlizeci(): boolean {
  return useSyncExternalStore(
    NEODEBIRAT,
    () => true,
    () => false,
  );
}

/**
 * Je okno tak úzké, že se kreslí telefonní varianta (do 640 px — tam,
 * kde je i spodní lišta)? Na serveru vždy ne; kdo se ptá, se ptá až po
 * kliknutí, takže hydratace nemá s čím se rozejít. Stejný zlom má CSS
 * (`ds-sm-jen-mobil` v app/_komponenty.css).
 */
const TELEFON = "(max-width: 640px)";

function useNaTelefonu(): boolean {
  return useSyncExternalStore(
    (zmena) => {
      const m = window.matchMedia(TELEFON);
      m.addEventListener("change", zmena);
      return () => m.removeEventListener("change", zmena);
    },
    () => window.matchMedia(TELEFON).matches,
    () => false,
  );
}

function MesicView({
  smeny,
  den,
  onSelectDay,
}: {
  smeny: Smena[];
  den: string;
  onSelectDay: (day: string) => void;
}) {
  // Rozložit datum na rok a měsíc
  const [rok, mesic] = den.split("-");
  const mesicNum = parseInt(mesic);
  const rokNum = parseInt(rok);

  // Počet dnů v měsíci
  const pocetDnuVMesici = new Date(rokNum, mesicNum, 0).getDate();

  // První den měsíce: 0 = pondělí … 6 = neděle (týden začíná pondělím).
  const prvniDenTydne = denVTydnu(`${rok}-${mesic}-01`);

  // Seskupit směny po dnech
  const smenePoDnech = new Map<number, Smena[]>();
  for (const s of smeny) {
    const [s_rok, s_mesic, s_den] = s.shift_date.split("-");
    if (s_rok === rok && s_mesic === mesic) {
      const denNum = parseInt(s_den);
      const seznam = smenePoDnech.get(denNum) ?? [];
      seznam.push(s);
      smenePoDnech.set(denNum, seznam);
    }
  }

  // Zjistit chybějící lidi v každém dni
  const chybejiciPoDnech = new Map<number, number>();
  for (let denNum = 1; denNum <= pocetDnuVMesici; denNum++) {
    const smenyDne = smenePoDnech.get(denNum) ?? [];
    const chybejici = smenyDne.filter((s) => s.employee_id === null).length;
    chybejiciPoDnech.set(denNum, chybejici);
  }

  // Mřížka: řádky jsou týdny, sloupce jsou dny
  const tydny = [];
  let radek = Array(7).fill(null);
  let indexVRadku = prvniDenTydne;

  for (let denNum = 1; denNum <= pocetDnuVMesici; denNum++) {
    radek[indexVRadku] = denNum;
    indexVRadku++;
    if (indexVRadku === 7) {
      tydny.push([...radek]);
      radek = Array(7).fill(null);
      indexVRadku = 0;
    }
  }
  if (radek.some((x) => x !== null)) {
    tydny.push(radek);
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "16px",
        padding: "16px",
        background: "var(--card)",
        border: "1px solid var(--line-2)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
      }}
    >
      {/*
        Záhlaví dní v týdnu — dřív žádné nebylo, takže se muselo
        počítat, který sloupec je který den (Šéfík 17.9.2026: "abych
        věděl který den to je"). Pořadí Po–Ne sedí s tím, jak mřížku pod
        ním sestavuje prvniDenTydne (0 = pondělí). Dřív šlo Ne–So, což
        česky nikdo nečeká — kalendář na telefonu i celý Rozpis začínají
        pondělím.
      */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
        {DNY_V_TYDNU_ZKRACENE.map((nazev, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".04em",
              color: i >= 5 ? "var(--mosaz)" : "var(--muted)",
            }}
          >
            {nazev}
          </div>
        ))}
      </div>
      {tydny.map((radek_items, tydenIdx) => (
        <div
          key={tydenIdx}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: "8px",
          }}
        >
          {radek_items.map((denNum, sloupecIdx) => {
            const datumStr = denNum
              ? `${rok}-${String(mesic).padStart(2, "0")}-${String(denNum).padStart(2, "0")}`
              : "";

            const pocetSmeny = smenePoDnech.get(denNum)?.length ?? 0;
            const pocetChybejicich = chybejiciPoDnech.get(denNum) ?? 0;
            // Sloupce jdou Po–Ne (viz záhlaví výš): 5 = sobota, 6 = neděle.
            const vikend = sloupecIdx >= 5;

            return (
              <button
                key={sloupecIdx}
                onClick={() => denNum && onSelectDay(datumStr)}
                style={{
                  padding: "12px 8px",
                  borderRadius: "var(--radius-md)",
                  border: denNum ? "1px solid var(--line-2)" : "none",
                  boxShadow: denNum && datumStr === den ? "var(--shadow-sm)" : "none",
                  /*
                    Okolní rám je teď taky --card (bílá) — den se
                    směnami proto potřebuje jiné pozadí než "beze
                    změny", jinak by v bílém rámu zmizel v bílé
                    (stejná past jako u chipů v týdenním pohledu).
                  */
                  background:
                    denNum && datumStr === den
                      ? "var(--branch-soft)"
                      : denNum && vikend
                        ? `color-mix(in srgb, var(--mosaz-sv) ${pocetSmeny === 0 ? 14 : 24}%, ${pocetSmeny === 0 ? "var(--card)" : "var(--sunken)"})`
                        : denNum && pocetSmeny === 0
                          ? "transparent"
                          : denNum
                            ? "var(--sunken)"
                            : "transparent",
                  cursor: denNum ? "pointer" : "default",
                  fontSize: "13px",
                  color: denNum ? "var(--ink)" : "transparent",
                  textAlign: "center",
                  minHeight: "60px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {denNum && (
                  <>
                    <strong>{denNum}</strong>
                    {pocetSmeny > 0 && (
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {pocet(pocetSmeny, "směna", "směny", "směn")}
                      </span>
                    )}
                    {pocetChybejicich > 0 && (
                      <span style={{ fontSize: "12px", color: "var(--warn)" }}>
                        {pocetChybejicich} chybí
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function hodina(cas: string): string {
  return cas.slice(0, 5);
}

/**
 * Popisek směny do chipu — trhaná (pauza uvnitř) se ukáže jako dva
 * úseky, ne jedno souvislé od–do, ať je zlom vidět i v hustém rozpisu.
 */
function popisSmeny(s: { starts_at: string; ends_at: string; pauza_od: string | null; pauza_do: string | null }): string {
  if (s.pauza_od && s.pauza_do) {
    return `${hodina(s.starts_at)}–${hodina(s.pauza_od)} · ${hodina(s.pauza_do)}–${hodina(s.ends_at)}`;
  }
  return `${hodina(s.starts_at)}–${hodina(s.ends_at)}`;
}

const DNY = [
  "neděle",
  "pondělí",
  "úterý",
  "středa",
  "čtvrtek",
  "pátek",
  "sobota",
];

/** Zkrácené názvy dní od pondělí (MesicView). */
const DNY_V_TYDNU_ZKRACENE = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

function popisDne(datum: string, dnesni: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  const cislo = `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;

  if (datum === dnesni) return `Dnes · ${cislo}`;

  // Zítřa — spočítáme si dní
  const dnes = new Date(`${dnesni}T00:00:00Z`);
  const zitra = new Date(dnes);
  zitra.setUTCDate(zitra.getUTCDate() + 1);
  const zítraStr = zitra.toISOString().split("T")[0];
  if (datum === zítraStr) return `Zítra · ${cislo}`;

  const den = DNY[d.getUTCDay()];
  return `${den.charAt(0).toUpperCase()}${den.slice(1)} · ${cislo}`;
}
