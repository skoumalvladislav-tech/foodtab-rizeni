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
    <section
      aria-label="Zálohy k potvrzení"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: "14px",
        marginBottom: "16px",
      }}
    >
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
            "Potvrďte jen tehdy, když ji máte v ruce. Kdo ji vydal, dostane zprávu.",
          ]}
          paticka={
            <form action={akce}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="zaloha" value={z.id} />
              <button type="submit" className="ft-tl ft-tl-hlavni ds-kpi-tlacitko">
                Potvrdit, že jsem ji dostal/a
              </button>
            </form>
          }
        />
      ))}
    </section>
  );
}
