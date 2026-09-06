"use client";

import { useActionState, useSyncExternalStore } from "react";

import { prihlasit } from "./akce";
import { maUkazatNaPlochu, zbyvaDoZnovu } from "@/lib/prihlaseni";
import { PRAZDNY_STAV, type StavPrihlaseni } from "./stav";

/**
 * Přihlášení kódem.
 *
 * JMÉNO JE PODLE KÓDU, NE PODLE E-MAILU, a je to schválně. Telefon je
 * podle závazných rozhodnutí plnohodnotný přihlašovací údaj a jednou
 * sem přibude i SMS. Až se to stane, změní se, KAM se kód posílá —
 * pole na jeho opsání, odpočet i hlášky zůstanou. Kdyby se komponenta
 * jmenovala podle e-mailu, muselo by se přejmenovávat něco, co se
 * nemění.
 *
 * SMS se teď NEDĚLÁ. Tohle je jen otevřená vrátka, ne polovina funkce.
 *
 * ---------------------------------------------------------------------
 * CO TU SCHVÁLNĚ NENÍ
 *
 * Žádný `getBrowserSupabase()`. Dřív se odsud volal `signInWithOtp`
 * přímo, a browser klient ukládá sezení do `document.cookie` —
 * javascriptem. Safari takovou cookie zkracuje na sedm dní, takže by
 * lidem přihlášení po týdnu mizelo a nikdo by nepoznal proč. Všechno
 * proto běží v serverové akci (`akce.ts`).
 */

type Props = {
  /** Přišel z odkazu, který už neplatil. */
  chybaZOdkazu: boolean;
  /** Přišel načtením QR na tabletu. */
  zQr: boolean;
  /** Právě se odhlásil — ať to není němé. */
  odhlaseny: boolean;
  /** Kam se po přihlášení vrátit. Ověřené na serveru. */
  kam: string;
  /**
   * Ve kterém kroku formulář začíná.
   *
   * V aplikaci se nepředává — začíná se vždycky zadáním adresy.
   * Existuje proto, aby šel vykreslit i druhý krok: `useActionState`
   * si při vykreslení na serveru bere jen výchozí hodnotu, takže bez
   * tohohle by pole na kód nešlo ověřit vůbec. A zrovna u něj na tom
   * záleží — bez `autoComplete="one-time-code"` iPhone kód z oznámení
   * nenabídne a je to poloviční řešení.
   */
  vychoziStav?: StavPrihlaseni;
};

export default function PrihlaseniKodem({
  chybaZOdkazu,
  zQr,
  odhlaseny,
  kam,
  vychoziStav = PRAZDNY_STAV,
}: Props) {
  const [stav, odeslat, ceka] = useActionState<StavPrihlaseni, FormData>(
    prihlasit,
    vychoziStav,
  );

  /*
    Věta o přidání na plochu se ukazuje JEN v prohlížeči na telefonu.

    Na iPhonu má aplikace přidaná na plochu vlastní úložiště, oddělené
    od Safari — kdo se přihlásí v Safari a pak si ji přidá na plochu,
    je v ní nepřihlášený a vypadá to jako chyba aplikace.

    V samotné aplikaci na ploše by ta věta byla matoucí („vždyť ji tam
    mám"), proto se tam nekreslí.

    `useSyncExternalStore` a ne `useState` v efektu: serverové
    vykreslení dostane `false` (`naServeru`), prohlížeč skutečnou
    hodnotu, a React ty dva stavy sám srovná. Se `setState` uvnitř
    efektu by to fungovalo taky, ale je to překreslení navíc a eslint
    to tu právem hlídá.
  */
  const ukazatNaPlochu = useSyncExternalStore(
    nicNeodebira,
    vProhlizeciNaTelefonu,
    naServeru,
  );

  /*
    Odpočet u „Poslat znovu".

    Šéfík si vyžádal tři kódy během tří minut a platil jen ten poslední;
    z obrazovky to poznat nešlo, takže zkoušel ten první. Zašedlé
    tlačítko s číslem je to jediné, co tomu brání.

    Počítá se z času, který přišel ze SERVERU — kdyby si ho měřil
    prohlížeč, obejde se to přetočením hodin. `ted` tiká po vteřinách
    a `zbyva` je z něj jen spočítané; není to samostatný stav, takže
    se ty dva nemají jak rozejít.
  */
  const ted = useSyncExternalStore(odebiratTik, celeVteriny, nulaNaServeru);
  const zbyva = zbyvaDoZnovu(stav.odeslanoKdy, ted);

  const uvodniChyba = chybaZOdkazu
    ? "Odkaz už neplatí. Nechte si prosím poslat nový kód."
    : "";
  const chyba = stav.chyba || uvodniChyba;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          padding: "32px",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: "24px", color: "var(--accent)" }}>
          Foodtab
        </h1>

        {odhlaseny ? (
          <p style={hlaskaDobre} role="status">
            Odhlásili jsme vás. Můžete se přihlásit znovu.
          </p>
        ) : null}

        {stav.krok === "email" ? (
          /* ---------- 1. ZADÁNÍ ADRESY ---------------------------- */
          <form action={odeslat}>
            <input type="hidden" name="akce" value="poslat" />
            <input type="hidden" name="kam" value={kam} />

            <p style={popis}>
              Zadejte pracovní e-mail. Pošleme vám kód, který sem opíšete —
              heslo nepotřebujete.
            </p>

            <label htmlFor="email" style={popisekPole}>
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              defaultValue={stav.email}
              placeholder="jmeno@podnik.cz"
              style={pole}
            />

            {chyba ? (
              <p className="hlaska-chyba" role="alert">
                {chyba}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={ceka}
              className="ft-tl ft-tl-hlavni"
              style={{ width: "100%", marginTop: "20px" }}
            >
              {ceka ? "Odesílám…" : "Poslat kód"}
            </button>
          </form>
        ) : (
          /* ---------- 2. OPSÁNÍ KÓDU ------------------------------ */
          /*
            Na TOMTÉŽ místě, ne na jiné stránce. Kdo si mezitím otevře
            e-mail, se vrátí do rozepsaného okna a nemusí začínat znovu.
          */
          <>
            <form action={odeslat}>
              <input type="hidden" name="akce" value="overit" />
              <input type="hidden" name="email" value={stav.email} />
              <input type="hidden" name="kam" value={kam} />
              <input type="hidden" name="odeslanoKdy" value={stav.odeslanoKdy} />

              <p style={popis}>
                Kód jsme poslali na <strong>{stav.email}</strong>. Platí
                několik minut a použije se jednou.
              </p>

              <label htmlFor="kod" style={popisekPole}>
                Kód z e-mailu
              </label>
              <input
                id="kod"
                name="kod"
                type="text"
                required
                autoFocus
                /*
                  `one-time-code` je to podstatné: bez něj iPhone kód
                  z oznámení nenabídne a člověk ho musí přepisovat ručně
                  mezi dvěma aplikacemi. To je přesně ta chvíle, kdy to
                  lidi vzdají.
                */
                autoComplete="one-time-code"
                inputMode="numeric"
                /* Číslice a mezery; kód se jinam než sem neopisuje. */
                pattern="[0-9 ]*"
                maxLength={10}
                placeholder="123456"
                style={{ ...pole, letterSpacing: "0.25em", fontSize: "20px" }}
              />

              {chyba ? (
                <p className="hlaska-chyba" role="alert">
                  {chyba}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={ceka}
                className="ft-tl ft-tl-hlavni"
                style={{ width: "100%", marginTop: "20px" }}
              >
                {ceka ? "Ověřuji…" : "Přihlásit se"}
              </button>
            </form>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginTop: "16px",
              }}
            >
              <form action={odeslat}>
                <input type="hidden" name="akce" value="poslat" />
                <input type="hidden" name="email" value={stav.email} />
                <input type="hidden" name="kam" value={kam} />
                <button
                  type="submit"
                  disabled={ceka || zbyva > 0}
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                >
                  {zbyva > 0 ? `Poslat znovu (${zbyva} s)` : "Poslat znovu"}
                </button>
              </form>

              {/*
                Změna adresy je taky odeslání formuláře, ne odkaz —
                stránka se tím nenačítá znovu a rozepsané zůstává.
              */}
              <form action={odeslat}>
                <input type="hidden" name="akce" value="zmenit" />
                <button
                  type="submit"
                  disabled={ceka}
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                >
                  Zadat jinou adresu
                </button>
              </form>
            </div>

            {zbyva > 0 ? (
              <p style={{ ...popis, margin: "10px 0 0", fontSize: "12px" }}>
                Nový kód zneplatní ten předchozí. Platí vždycky jen ten
                poslední.
              </p>
            ) : null}
          </>
        )}

        {ukazatNaPlochu ? (
          <p style={ramecekNaPlochu}>
            <strong>Přidejte si Foodtab na plochu ještě před přihlášením</strong>{" "}
            — jinak se budete muset přihlásit dvakrát. Aplikace na ploše má
            vlastní paměť, oddělenou od prohlížeče.
          </p>
        ) : null}

        {zQr ? (
          <p style={{ ...popis, margin: "16px 0 0", fontSize: "12px" }}>
            Přihlašujete se z QR kódu na tabletu.
          </p>
        ) : null}
      </div>
    </main>
  );
}


/* --- Zdroje pro useSyncExternalStore ---------------------------- */

/*
  Tik po vteřinách pro odpočet.

  Zaokrouhlení na celé vteřiny je nutnost, ne úhlednost: `getSnapshot`
  musí mezi dvěma tiky vracet TOTÉŽ číslo. Kdyby vracelo `Date.now()`,
  je pokaždé jiné, React by to bral jako změnu úložiště a překresloval
  by donekonečna.
*/
function odebiratTik(zmena: () => void): () => void {
  const t = setInterval(zmena, 1000);
  return () => clearInterval(t);
}
function celeVteriny(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}
function nulaNaServeru(): number {
  return 0;
}

/* Běží aplikace v prohlížeči na telefonu, a ne přidaná na ploše? */
function nicNeodebira(): () => void {
  return () => {};
}
function vProhlizeciNaTelefonu(): boolean {
  const naPlose =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return maUkazatNaPlochu({
    naPlose,
    uzkaObrazovka: window.matchMedia("(max-width: 820px)").matches,
  });
}
function naServeru(): boolean {
  return false;
}

const popis = {
  margin: "0 0 20px",
  fontSize: "14px",
  lineHeight: 1.6,
  color: "var(--muted)",
} as const;

const popisekPole = {
  display: "block",
  fontSize: "13px",
  color: "var(--muted)",
  marginBottom: "6px",
} as const;

const pole = {
  width: "100%",
  padding: "12px 14px",
  // 16 px schválně: iOS jinak při zaostření pole zoomuje celou stránku.
  fontSize: "16px",
  borderRadius: "10px",
  border: "1px solid var(--line)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const hlaskaDobre = {
  margin: "0 0 16px",
  padding: "10px 12px",
  borderRadius: "10px",
  background: "var(--paper)",
  border: "1px solid var(--line)",
  fontSize: "14px",
  color: "var(--ink)",
} as const;

const ramecekNaPlochu = {
  margin: "24px 0 0",
  padding: "12px 14px",
  borderRadius: "10px",
  background: "var(--paper)",
  border: "1px solid var(--line)",
  fontSize: "13px",
  lineHeight: 1.55,
  color: "var(--ink)",
} as const;
