"use client";

import { useActionState, useRef, useSyncExternalStore } from "react";

import { prihlasit } from "./akce";
import { maUkazatNaPlochu, normalizujKod } from "@/lib/prihlaseni";
import PoslatZnovu from "./poslat-znovu";
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
    ODPOČET TU SCHVÁLNĚ NENÍ — je v `poslat-znovu.tsx`.

    Dokud tikal tady, překresloval každou vteřinou celou obrazovku
    včetně políčka na kód. Na iOS se tím zavírala bublina „Vložit"
    dřív, než na ni člověk stihl ťuknout: Šéfík ji 6. 9. viděl bliknout
    na pár milisekund a vložit kód nešlo vůbec.

    Tahle komponenta se teď překreslí jen tehdy, když se doopravdy něco
    stane. Kdyby se sem tik vrátil, vrátí se s ním i ta chyba.
  */

  /*
    Odkaz na políčko s kódem — kvůli tlačítku „Vložit kód".

    Pole zůstává NEŘÍZENÉ (bez `value` a `onChange`). Řízené pole by
    každý stisk klávesy protáhlo Reactem, a to je zrovna ta cesta, na
    které se vkládání celého kódu naráz nejčastěji láme.
  */
  const poleKodu = useRef<HTMLInputElement>(null);

  /*
    Umí tenhle prohlížeč přečíst schránku?

    Firefox `readText()` nemá vůbec, Safari ho pouští jen z gesta
    uživatele a jen na zabezpečeném spojení. Kde to nejde, tlačítko se
    nekreslí — mrtvé tlačítko, které po ťuknutí nic neudělá, je horší
    než žádné.
  */
  const umiSchranku = useSyncExternalStore(
    nicNeodebira,
    maCteniSchranky,
    naServeru,
  );

  /*
    Vložení ze schránky.

    Kód se prožene `normalizujKod`, protože z e-mailu se veze i to, co
    kolem něj je — mezery, nezlomitelné mezery, znaky nulové šířky.
    Píše se přímo do neřízeného pole; React o tom vědět nemusí,
    formulář si hodnotu vezme z DOM při odeslání.

    Chyba se polyká schválně: schránka může být prázdná nebo ji
    prohlížeč odmítne vydat, a ani jedno není porucha aplikace. Člověk
    má pořád možnost kód opsat.
  */
  async function vlozitZeSchranky() {
    try {
      const text = await navigator.clipboard.readText();
      const pole = poleKodu.current;
      if (!pole) return;
      pole.value = normalizujKod(text);
      pole.focus();
    } catch {
      // Nedá se nic dělat, pole zůstane, jak bylo.
    }
  }

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
                Opište kód z e-mailu
              </label>
              <input
                ref={poleKodu}
                id="kod"
                name="kod"
                type="text"
                required
                autoFocus
                /*
                  `one-time-code` NECH TADY, ale nic kolem něj neslibuj.

                  iPhone kód sám nabídne jen ze Zpráv (SMS) a z Apple
                  Mailu — kdo čte poštu v Gmailu, nedostane nic. Věta
                  „kód se vyplní sám" by tedy byla nepravda u většiny
                  lidí. Až přibude přihlášení přes SMS, začne to
                  fungovat samo a nebude se muset měnit nic.
                */
                autoComplete="one-time-code"
                /*
                  `type="text"` s `inputMode="numeric"`, NE `type="number"`.
                  Číselné pole na mobilech kroutí vkládání, přidává
                  šipky a u kódu s vedoucí nulou umí ukousnout znak.
                */
                inputMode="numeric"
                /*
                  Pole je NEŘÍZENÉ a nemá žádný `onChange`, který by
                  cestou zahazoval znaky. Vložení šesti číslic naráz
                  tudy projde celé; uklidí se až na serveru přes
                  `normalizujKod`. Filtr při psaní je nejčastější důvod,
                  proč vkládání kódu nefunguje.

                  `pattern` je jen nápověda prohlížeči, ne filtr —
                  proto v něm mezery jsou.
                */
                pattern="[0-9  ]*"
                maxLength={16}
                placeholder="123456"
                style={{ ...pole, letterSpacing: "0.25em", fontSize: "20px" }}
              />

              {/*
                Tlačítko „Vložit kód".

                Jedno ťuknutí místo podržení prstu a trefování se do
                bubliny, která na iOS mizí. V provozu, kde má člověk
                mokré ruce a spěchá, je to rozdíl mezi „jde to"
                a „nejde to".

                Když prohlížeč čtení schránky neumí nebo ho zakáže,
                tlačítko se NEUKÁŽE VŮBEC — mrtvé tlačítko je horší než
                žádné.
              */}
              {umiSchranku ? (
                <button
                  type="button"
                  onClick={vlozitZeSchranky}
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                  style={{ marginTop: "8px" }}
                >
                  Vložit kód
                </button>
              ) : null}

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
              {/*
                Odpočet žije VE VLASTNÍ KOMPONENTĚ, protože tiká —
                a tikání uvnitř téhle by každou vteřinou překreslilo
                i políčko na kód nad ním. Viz `poslat-znovu.tsx`.
              */}
              <div>
                <PoslatZnovu
                  odeslanoKdy={stav.odeslanoKdy}
                  email={stav.email}
                  kam={kam}
                  odeslat={odeslat}
                  ceka={ceka}
                />
              </div>

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

/* Umí prohlížeč přečíst schránku? Firefox ne, Safari jen z gesta. */
function maCteniSchranky(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.clipboard?.readText === "function";
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
