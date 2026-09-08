/**
 * Čas — pásmo je POVINNÝ údaj.
 *
 * Co člověk napíše do políčka („2026-09-12“ + „18:00“), je hodina na zdi
 * provozovny. Na okamžik (timestamptz) ji převádíme podle pásma
 * provozovny, ne serveru — a zpět stejně. Nikdy `new Date('…T18:00')`
 * ani `getHours()` bez pásma (na Vercelu běží server v UTC).
 *
 * Přechod na letní/zimní čas: hledáme takový okamžik, jehož zobrazení
 * v daném pásmu odpovídá zadané hodině. Neexistující hodina (2:30 při
 * jarním posunu) se posune dopředu; dvojznačná hodina (2:30 na podzim)
 * vezme první výskyt. Ověřeno v tests/unit/cas.test.ts.
 */
export const VYCHOZI_PASMO = "Europe/Prague";

const partsCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface Rozlozeny {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

/** Rozloží okamžik na hodinu na zdi v daném pásmu. */
export function rozlozit(d: Date, tz: string = VYCHOZI_PASMO): Rozlozeny {
  const p = Object.fromEntries(fmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

/** Posun pásma vůči UTC v minutách pro daný okamžik. */
export function offsetMinut(d: Date, tz: string): number {
  const r = rozlozit(d, tz);
  const asUtc = Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/**
 * Hodina na zdi → okamžik. `datum` je 'YYYY-MM-DD', `cas` 'HH:MM'.
 */
export function okamzik(datum: string, cas: string, tz: string = VYCHOZI_PASMO): Date {
  const [y, m, d] = datum.split("-").map(Number);
  const [hh, mm] = cas.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error(`Neplatné datum nebo čas: ${datum} ${cas}`);
  }
  // První odhad: jako by pásmo bylo UTC, pak korekce podle skutečného posunu.
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let result = new Date(guess - offsetMinut(new Date(guess), tz) * 60000);
  // Druhá iterace pokrývá okamžiky těsně u přechodu času.
  const check = rozlozit(result, tz);
  if (check.hour !== hh || check.minute !== mm) {
    result = new Date(guess - offsetMinut(result, tz) * 60000);
  }
  return result;
}

/** Okamžik → 'YYYY-MM-DD' v pásmu. */
export function datumVPasmu(d: Date, tz: string = VYCHOZI_PASMO): string {
  const r = rozlozit(d, tz);
  return `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`;
}

/** Okamžik → 'HH:MM' v pásmu. */
export function casVPasmu(d: Date, tz: string = VYCHOZI_PASMO): string {
  const r = rozlozit(d, tz);
  return `${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;
}

const DNY = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const DNY_KRATCE = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const MESICE_2P = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const MESICE = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

/** '12. 9. 2026' */
export function formatDatum(d: Date | string, tz: string = VYCHOZI_PASMO): string {
  const r = typeof d === "string" ? rozlozitIso(d) : rozlozit(d, tz);
  return `${r.day}. ${r.month}. ${r.year}`;
}

/** 'sobota 12. září' */
export function formatDatumSlovy(d: Date | string, tz: string = VYCHOZI_PASMO): string {
  const dt = typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d;
  const r = typeof d === "string" ? rozlozitIso(d) : rozlozit(dt, tz);
  const weekday = typeof d === "string" ? new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCDay() : denVTydnu(dt, tz);
  return `${DNY[weekday]} ${r.day}. ${MESICE_2P[r.month - 1]}`;
}

/** '12. 9. 2026 18:00' */
export function formatDatumCas(d: Date, tz: string = VYCHOZI_PASMO): string {
  return `${formatDatum(d, tz)} ${casVPasmu(d, tz)}`;
}

export function denVTydnu(d: Date, tz: string = VYCHOZI_PASMO): number {
  const r = rozlozit(d, tz);
  return new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCDay();
}

export function denVTydnuKratce(d: Date | string, tz: string = VYCHOZI_PASMO): string {
  if (typeof d === "string") {
    const r = rozlozitIso(d);
    return DNY_KRATCE[new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCDay()];
  }
  return DNY_KRATCE[denVTydnu(d, tz)];
}

export function nazevMesice(month1: number): string {
  return MESICE[month1 - 1] ?? "";
}

function rozlozitIso(iso: string): Rozlozeny {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { year: y, month: m, day: d, hour: 0, minute: 0, second: 0 };
}

/** Posun data o N dní (ISO řetězec, bez pásma — jde o kalendářní den). */
export function posunDne(iso: string, dni: number): string {
  const r = rozlozitIso(iso);
  const d = new Date(Date.UTC(r.year, r.month - 1, r.day + dni));
  return d.toISOString().slice(0, 10);
}

/** Dnešní kalendářní datum v pásmu. */
export function dnes(tz: string = VYCHOZI_PASMO, now: Date = new Date()): string {
  return datumVPasmu(now, tz);
}

/** Nejbližší sobota (včetně dneška, je-li sobota). */
export function nejblizsiSobota(tz: string = VYCHOZI_PASMO, now: Date = new Date()): string {
  const today = dnes(tz, now);
  const r = rozlozitIso(today);
  const dow = new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCDay();
  const diff = (6 - dow + 7) % 7;
  return posunDne(today, diff);
}

/** Relativní popis: 'za 3 dny', 'dnes', 'včera'. */
export function relativne(d: Date, tz: string = VYCHOZI_PASMO, now: Date = new Date()): string {
  const a = datumVPasmu(d, tz);
  const b = datumVPasmu(now, tz);
  const ra = rozlozitIso(a);
  const rb = rozlozitIso(b);
  const diff = Math.round((Date.UTC(ra.year, ra.month - 1, ra.day) - Date.UTC(rb.year, rb.month - 1, rb.day)) / 86400000);
  if (diff === 0) return "dnes";
  if (diff === 1) return "zítra";
  if (diff === -1) return "včera";
  if (diff > 1 && diff < 5) return `za ${diff} dny`;
  if (diff >= 5) return `za ${diff} dní`;
  if (diff < -1 && diff > -5) return `před ${-diff} dny`;
  return `před ${-diff} dny`;
}
