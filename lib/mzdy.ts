/**
 * Tvar mzdových údajů na obrazovce.
 *
 * Oddíl 6 zadání (docs/mzdy-zadani.md) není kosmetika: lidé si to číslo
 * přečtou jako slib. Proto je tvar tady, na jednom místě, a ne pokaždé
 * jinak podle toho, kdo obrazovku psal.
 *
 * Počítá se v databázi. Sem chodí hotová čísla, tohle je jen převod na
 * text — žádné násobení sazbou, žádné dopočítávání.
 */

/** Celé koruny z haléřů. V databázi haléře, na obrazovce koruny. */
export function koruny(haleru: number): string {
  // Mezera je pevná, aby se částka nezalomila mezi tisíci a stovkami.
  return `${Math.round(haleru / 100)
    .toLocaleString("cs-CZ")
    .replace(/\s/g, " ")} Kč`;
}

/** „84 h 30 min“. Hodiny bez minut se píšou taky s minutami, ať sloupec sedí. */
export function hodinyAMinuty(minut: number): string {
  const h = Math.floor(minut / 60);
  const m = minut % 60;
  return `${h} h ${m} min`;
}

/** „220 Kč/h“ */
export function sazbaZaHodinu(haleru: number): string {
  return `${koruny(haleru)}/h`;
}

/**
 * „1 den“, „3 dny“, „5 dnů“.
 *
 * Zadání na skloňování upozorňuje zvlášť. Číslo se štítkem, který se
 * nedá přečíst, je horší než žádný štítek — a „3 den bez docházky“
 * čtenáře zastaví dřív než ta informace samotná.
 */
export function dnu(pocet: number): string {
  if (pocet === 1) return "1 den";
  if (pocet >= 2 && pocet <= 4) return `${pocet} dny`;
  return `${pocet} dnů`;
}

/**
 * Název měsíce do nadpisu dlaždice: „Hrubá mzda za srpen“.
 *
 * Jeden seznam stačí — čeština má u měsíců čtvrtý pád stejný jako první,
 * takže „srpen“ i „za srpen“ berou totéž slovo.
 */
const MESICE = [
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
];

export function nazevMesice(datum: string): string {
  const m = Number(datum.slice(5, 7));
  return MESICE[m - 1] ?? datum;
}

/** První den měsíce ve tvaru YYYY-MM-DD. Parametr funkcí v databázi. */
export function prvniDenMesice(d: Date): string {
  const mesic = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mesic}-01`;
}
