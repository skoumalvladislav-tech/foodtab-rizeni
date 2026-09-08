/**
 * Zkouška na to, co bylo rozbité: po stornu příchodu má obrazovka
 * nabídnout PŘÍCHOD, ne Odchod.
 *
 * Volá se skutečná funkce z lib/dochazka-stav.ts, ne opsaná úvaha —
 * kontrola, která si testovanou logiku sestaví vedle, projde i nad
 * rozbitým kódem (CLAUDE.md).
 *
 *   node --experimental-strip-types scripts/dochazka-stav.test.mjs
 */
import { jeVPraci } from "../lib/dochazka-stav.ts";

let ok = 0;
let spadlo = 0;

function check(nazev, podminka) {
  if (podminka) {
    console.log(`  OK    ${nazev}`);
    ok++;
  } else {
    console.log(`  SELHALO: ${nazev}`);
    spadlo++;
  }
}

console.log("== Docházka: jsem v práci? ==============================");

const PRICHOD = { business_date: "2026-09-08", occurred_at: "2026-09-08T06:00:00Z" };

check("bez příchodu není v práci", jeVPraci(null, []) === false);

check("otevřený příchod bez odchodu = v práci", jeVPraci(PRICHOD, []) === true);

check(
  "po odchodu už v práci není",
  jeVPraci(PRICHOD, [
    { business_date: "2026-09-08", occurred_at: "2026-09-08T14:00:00Z" },
  ]) === false,
);

/*
  TOHLE JE TA CHYBA Z PROVOZU. Stornovaný ODCHOD nesmí příchod zavřít —
  a stornovaný PŘÍCHOD sem vůbec nesmí dojít (filtruje ho dotaz).
*/
check(
  "stornovaný odchod příchod nezavírá",
  jeVPraci(PRICHOD, [
    {
      business_date: "2026-09-08",
      occurred_at: "2026-09-08T14:00:00Z",
      stornovano_kdy: "2026-09-08T14:05:00Z",
    },
  ]) === true,
);

check(
  "stornovaný příchod znamená, že v práci nejsem",
  // Dotaz stornovaný příchod odfiltruje, takže sem přijde null —
  // a tehdy se musí nabídnout Příchod.
  jeVPraci(null, [
    { business_date: "2026-09-08", occurred_at: "2026-09-08T14:00:00Z" },
  ]) === false,
);

check(
  "odchod z JINÉHO provozního dne příchod nezavírá",
  jeVPraci(PRICHOD, [
    { business_date: "2026-09-07", occurred_at: "2026-09-08T14:00:00Z" },
  ]) === true,
);

check(
  "dřívější odchod téhož dne nepočítá — páruje se jen pozdější",
  jeVPraci(PRICHOD, [
    { business_date: "2026-09-08", occurred_at: "2026-09-08T05:00:00Z" },
  ]) === true,
);

/*
  Noční: příchod z včerejšího provozního dne bez odchodu. Člověk V PRÁCI
  JE a obrazovka to má říct — právě proto, že to není z dneška.
*/
check(
  "otevřený příchod z včerejška pořád znamená v práci",
  jeVPraci(
    { business_date: "2026-09-07", occurred_at: "2026-09-07T22:00:00Z" },
    [],
  ) === true,
);

console.log("");
if (spadlo) {
  console.log(`SELHALO: ${spadlo} (prošlo ${ok})`);
  process.exit(1);
}
console.log(`VŠECH ${ok} KONTROL PROŠLO`);
