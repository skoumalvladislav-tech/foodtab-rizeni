/**
 * Rozbalovací nabídka, která se vejde do okna a nezavře se omylem.
 *
 * Šéfík 9. 11. 2026: v Rozpisu směn (Celá firma, notebook 1920 px se
 * zvětšením Windows 125 %, tedy okno 1536 CSS px) přetekl panel Filtry
 * o 100 px přes pravý kraj. Stránka dostala vodorovný posuvník, a když
 * na něj Šéfík sáhl, aby panel dojel, panel se zavřel: klik na posuvník
 * stránky Chrome hlásí jako `mousedown` na `<html>`, tedy „klik mimo".
 *
 * Dvě čisté funkce, obě bez DOM (kreslí je `app/[rozsah]/smeny/desktop/
 * nastroje.tsx`, hlídá je `scripts/nabidka-v-okne.test.mjs`):
 *
 *   umisteniNabidky  kam nabídku posunout, ať je celá v okně, a jak
 *                    vysoká smí být (zbytek se posouvá uvnitř ní)
 *   naPosuvniku      leží klik na posuvníku — stránky, nebo prvku, na
 *                    který se kliklo? Takový klik nabídku nezavírá.
 *
 * Všechno v CSS pixelech, souřadnice jako `getBoundingClientRect` a
 * `clientX/clientY` (vůči oknu).
 */

/** Mezera mezi nabídkou a krajem okna. */
export const OKRAJ_NABIDKY = 8;

/**
 * Nižší nabídka nemá smysl (vešly by se dva řádky). Když pod tlačítkem
 * tolik místa není, nabídka si ho vezme a stránka se pod ni posune.
 */
export const MIN_VYSKA_NABIDKY = 200;

export type Umisteni = {
  /** O kolik posunout nabídku vůči jejímu obalu (CSS `left`), px. */
  vlevo: number;
  /** CSS `max-height`, px — co se nevejde, posouvá se uvnitř nabídky. */
  maxVyska: number;
};

/**
 * Nabídka visí pod tlačítkem a začíná pod jeho levým okrajem. Když by
 * vpravo přetekla, přisune se doleva ke kraji okna; doleva přes kraj
 * nikdy (užší okno než nabídka hlídá CSS `max-width`).
 */
export function umisteniNabidky(v: {
  /** Levý okraj obalu (= tlačítka) v okně. */
  kotva: number;
  /** Šířka nabídky. */
  sirka: number;
  /** Horní okraj nabídky v okně. */
  nahore: number;
  /** Šířka a výška okna BEZ posuvníků (`documentElement.clientWidth/Height`). */
  oknoSirka: number;
  oknoVyska: number;
}): Umisteni {
  const nejvicVpravo = v.oknoSirka - OKRAJ_NABIDKY - v.sirka;
  const levy = Math.max(OKRAJ_NABIDKY, Math.min(v.kotva, nejvicVpravo));
  const misto = Math.floor(v.oknoVyska - v.nahore - OKRAJ_NABIDKY);
  return {
    vlevo: Math.round(levy - v.kotva),
    // Ani nejmenší výška nesmí být vyšší než celé okno (telefon na šířku).
    maxVyska: Math.max(Math.min(MIN_VYSKA_NABIDKY, v.oknoVyska - 2 * OKRAJ_NABIDKY), misto),
  };
}

/** Rozměry prvku, na který se kliklo — co o něm `naPosuvniku` potřebuje. */
export type PrvekPodBodem = {
  /** `getBoundingClientRect().left/top`. */
  vlevo: number;
  nahore: number;
  /** Šířka levého a horního rámečku (`clientLeft`, `clientTop`). */
  ramLevy: number;
  ramHorni: number;
  /** `clientWidth`, `clientHeight` — vnitřek bez rámečku a bez posuvníků. */
  sirkaVnitrku: number;
  vyskaVnitrku: number;
  /** Šířka svislého a výška vodorovného posuvníku; 0 = posuvník není (nebo je překryvný). */
  posuvnikSvisly: number;
  posuvnikVodorovny: number;
};

/**
 * Leží bod na posuvníku? Posuvník stránky je vpravo a dole za klientskou
 * plochou okna; posuvník prvku je mezi jeho vnitřkem a pravým (dolním)
 * rámečkem. Klik na posuvník je posouvání, ne „klik mimo".
 */
export function naPosuvniku(
  bod: { x: number; y: number },
  okno: { sirka: number; vyska: number },
  prvek: PrvekPodBodem | null,
): boolean {
  if (bod.x >= okno.sirka || bod.y >= okno.vyska) return true;
  if (!prvek) return false;
  const x = bod.x - prvek.vlevo - prvek.ramLevy;
  const y = bod.y - prvek.nahore - prvek.ramHorni;
  const naSvislem =
    prvek.posuvnikSvisly > 0 &&
    x >= prvek.sirkaVnitrku &&
    x < prvek.sirkaVnitrku + prvek.posuvnikSvisly &&
    y >= 0 &&
    y < prvek.vyskaVnitrku + prvek.posuvnikVodorovny;
  const naVodorovnem =
    prvek.posuvnikVodorovny > 0 &&
    y >= prvek.vyskaVnitrku &&
    y < prvek.vyskaVnitrku + prvek.posuvnikVodorovny &&
    x >= 0 &&
    x < prvek.sirkaVnitrku + prvek.posuvnikSvisly;
  return naSvislem || naVodorovnem;
}
