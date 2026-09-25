import { koruny } from "@/lib/mzdy";
import { denCesky } from "@/lib/upozorneni-text";

import { KpiKarta } from "../dnes/prvky";

/**
 * Nepotvrzené zálohy přihlášeného — karta na hlavní záložce Docházky
 * (zadání majitele 25. 9. 2026: „pracovníkovi který si zálohu bere přijde
 * notifikace a potvrdí ve svém telefonu že si ji vzal").
 *
 * Kam vede upozornění `zaloha.vyplacena`. Potvrzuje se TADY, ne ve
 * zvonečku: tady je vidět, co je opravdu nepotvrzené (upozornění může
 * být starší než potvrzení PINem na tabletu).
 *
 * ČISTĚ KRESLICÍ. Data dává `public.moje_nepotvrzene_zalohy` (jen vlastní,
 * jen nepotvrzené) a zámek je v `potvrdit_moji_zalohu`. Serverová akce
 * přichází jako parametr, ať jde karta vykreslit i mimo aplikaci
 * (scripts/zalohy.test.mjs).
 *
 * Vzhled podle oddílu 11 (docs/vzhled-zadani.md): `KpiKarta` s ikonou ze
 * sdílené sady, částka patkově, jedno hlavní tlačítko na kartu.
 */

export type ZalohaKPotvrzeni = {
  id: string;
  castka_haleru: number;
  business_date: string;
  vyplaceno_kdy: string;
  /** Kdo ji vydal. Prázdné, když se jméno nedá dohledat. */
  vydal: string | null;
  pobocka: string | null;
};

export default function ZalohyKPotvrzeni({
  zalohy,
  rozsah,
  akce,
}: {
  zalohy: ZalohaKPotvrzeni[];
  rozsah: string;
  akce: (formData: FormData) => Promise<void>;
}) {
  if (zalohy.length === 0) return null;

  return (
    <section aria-label="Zálohy k potvrzení" className="ds-zalohy-potvrdit">
      {zalohy.map((z) => (
        <KpiKarta
          key={z.id}
          ikona="mince"
          ton="pozor"
          titulek="Máte nepotvrzenou zálohu"
          hodnota={koruny(z.castka_haleru)}
          popisy={[
            [z.vydal ? `Vydal(a) ${z.vydal}` : null, denCesky(z.business_date), z.pobocka]
              .filter(Boolean)
              .join(" · "),
            "Potvrďte jen tehdy, když ji máte v ruce. Kdo ji vydal, uvidí potvrzení v upozorněních.",
          ]}
          paticka={
            <form action={akce}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="zaloha" value={z.id} />
              {/*
                Víc karet = víc stejných tlačítek. Čtečka čte jen nápis
                tlačítka, takže nese i částku a den — jinak by dvakrát
                přečetla totéž a nebylo by poznat, co se potvrzuje.
              */}
              <button
                type="submit"
                className="ft-tl ft-tl-hlavni ds-kpi-tlacitko"
                aria-label={`Potvrdit převzetí zálohy ${koruny(z.castka_haleru)} (${denCesky(z.business_date)})`}
              >
                Potvrdit, že jsem ji dostal/a
              </button>
            </form>
          }
        />
      ))}
    </section>
  );
}

/**
 * Kde se karta na Docházce kreslí (vytažené sem, ať to jde ověřit
 * vykreslením, ne čtením stránky):
 *
 *   zadne       při píchání (kód z QR, výsledek píchnutí) — po
 *               naskenování QR má být píchačka nahoře sama;
 *   v-prehledu  vedoucí s živým přehledem: hned pod záložky přehledu,
 *               NAD jeho karty a seznamy — jinak by ji našel až po
 *               dlouhém posouvání pod celým přehledem;
 *   nahore      ostatní: nahoře pod záložkami, nad píchačkou.
 */
export type MistoZaloh = "zadne" | "v-prehledu" | "nahore";

export function mistoZaloh({
  pichaSe,
  prehled,
}: {
  pichaSe: boolean;
  prehled: boolean;
}): MistoZaloh {
  if (pichaSe) return "zadne";
  return prehled ? "v-prehledu" : "nahore";
}

/**
 * Hláška po potvrzení v telefonu (`?zaloha=potvrzena` / `?zaloha=chyba`).
 *
 * Zprávu neslibuje natvrdo: vydávající ji nedostane, když zálohu vydal
 * i potvrdil sám, když nemá aktivní členství nebo když už účet nemá.
 * A na telefon mimo směnu dojde až s příchodem. „Potvrzená" se ukáže
 * JEN u `potvrzena`, nikdy vedle chyby.
 */
export function HlaskaPotvrzeniZalohy({
  vysledek,
  duvod,
}: {
  vysledek?: string;
  duvod?: string;
}) {
  if (vysledek === "potvrzena") {
    return (
      <p role="status" className="ds-zalohy-hlaska" style={{ fontSize: "14px", color: "var(--dobre)" }}>
        Záloha je potvrzená. Kdo vám ji vydal, uvidí to v upozorněních.
      </p>
    );
  }
  if (vysledek === "chyba" && duvod?.trim()) {
    return (
      <p role="alert" className="hlaska-chyba ds-zalohy-hlaska">
        {duvod}
      </p>
    );
  }
  return null;
}
