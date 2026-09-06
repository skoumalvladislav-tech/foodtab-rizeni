"use client";

import { useSyncExternalStore } from "react";

import { zbyvaDoZnovu } from "@/lib/prihlaseni";

/**
 * Tlačítko „Poslat znovu" s odpočtem — a JEN ono.
 *
 * ---------------------------------------------------------------------
 * PROČ TO MÁ VLASTNÍ SOUBOR
 *
 * Odpočet tiká po vteřinách. Dokud byl uvnitř `prihlaseni-kodem.tsx`,
 * překresloval každou vteřinou celou obrazovku — a s ní i políčko na
 * kód. Na iOS to má následek, který nevypadá jako chyba v kódu:
 *
 *   bublina „Vložit" nad polem zmizí ve chvíli, kdy pole ztratí
 *   označení, tedy při každém překreslení. Šéfík ji 6. 9. viděl
 *   bliknout na pár milisekund a kód nešlo vložit vůbec.
 *
 * Tikání proto musí zůstat v komponentě, ve které ŽÁDNÉ pole není.
 * Rodič se překreslí jen tehdy, když se doopravdy něco stane —
 * odešle se formulář, přijde chyba.
 *
 * Kdyby sem někdy někdo přidal `<input>`, vrátí tím tu chybu zpátky.
 */

type Props = {
  /** Kdy se kód odeslal. Čas ze serveru, ne z prohlížeče. */
  odeslanoKdy: number;
  /** E-mail, na který se má poslat znovu. */
  email: string;
  /** Kam se po přihlášení vrátit. */
  kam: string;
  /** Akce formuláře — táž, jakou používá rodič. */
  odeslat: (formData: FormData) => void;
  /** Běží zrovna odeslání? */
  ceka: boolean;
};

export default function PoslatZnovu({
  odeslanoKdy,
  email,
  kam,
  odeslat,
  ceka,
}: Props) {
  /*
    `ted` tiká po vteřinách; `zbyva` je z něj jen spočítané. Není to
    samostatný stav, takže se ty dva nemají jak rozejít — a čas přišel
    ze serveru, aby se čekání nedalo zkrátit přetočením hodin.
  */
  const ted = useSyncExternalStore(odebiratTik, celeVteriny, nulaNaServeru);
  const zbyva = zbyvaDoZnovu(odeslanoKdy, ted);

  return (
    <>
      <form action={odeslat}>
        <input type="hidden" name="akce" value="poslat" />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="kam" value={kam} />
        <button
          type="submit"
          disabled={ceka || zbyva > 0}
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
        >
          {zbyva > 0 ? `Poslat znovu (${zbyva} s)` : "Poslat znovu"}
        </button>
      </form>

      {zbyva > 0 ? (
        <p style={poznamka}>
          Nový kód zneplatní ten předchozí. Platí vždycky jen ten
          poslední.
        </p>
      ) : null}
    </>
  );
}

/*
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

const poznamka = {
  margin: "10px 0 0",
  fontSize: "12px",
  lineHeight: 1.6,
  color: "var(--muted)",
} as const;
