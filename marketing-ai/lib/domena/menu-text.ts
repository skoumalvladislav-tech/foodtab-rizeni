import type { MenuRozpoznanaPolozka, MenuRozpoznani } from "../providers/types.ts";

/**
 * Rozpoznání menu z vloženého běžného textu — bez AI, deterministicky.
 *
 * Co se z řádku pozná: název, cena („189 Kč“, „189,-“, „189“ na konci),
 * alergeny („(1,3,7)“ nebo „A: 1,3,7“), kategorie podle nadpisu
 * (Polévka, Hlavní jídla, Dezert, Nápoje) a dny (Pondělí…, „Po 12. 9.“).
 *
 * Co se nepozná, dostane `needs_review` — AI ani tenhle kód nic
 * nedomýšlí. Nejasná cena zůstane prázdná.
 */
const KATEGORIE: [RegExp, string][] = [
  [/^(pol[eé]vk[ay]|soup)/i, "polevka"],
  [/^(hlavn[ií]|main|j[ií]dla|menu)/i, "hlavni"],
  [/^(dezert|desert|sladk|moučník|moucnik)/i, "dezert"],
  [/^(n[aá]poj|drink|pivo|v[ií]no)/i, "napoj"],
  [/^(p[řr]edkrm|starter)/i, "predkrm"],
];

const DNY: [RegExp, string][] = [
  [/^(pond[eě]l[ií]|po\b)/i, "Pondělí"], [/^([uú]ter[yý]|[uú]t\b)/i, "Úterý"], [/^(st[řr]eda|st\b)/i, "Středa"],
  [/^([čc]tvrtek|[čc]t\b)/i, "Čtvrtek"], [/^(p[aá]tek|p[aá]\b)/i, "Pátek"], [/^(sobota|so\b)/i, "Sobota"], [/^(ned[eě]le|ne\b)/i, "Neděle"],
];

const CENA_RE = /(?:(\d{1,4})(?:[,.](\d{2}))?\s*(?:kč|kc|czk|,-|,–|-)\s*$)|(?:\s(\d{2,4})\s*$)/i;
const ALERGENY_RE = /(?:\(|\bA:?\s*)((?:\d{1,2}\s*[,;/]\s*)*\d{1,2})\)?\s*$/i;
const DATUM_RE = /(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/;

export function rozpoznatMenuZTextu(text: string, opts: { rok?: number } = {}): MenuRozpoznani {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: MenuRozpoznani = { kind: "daily", title: "", valid_from: null, valid_to: null, days: [], items: [], warnings: [] };
  let kategorie = "hlavni";
  let den: MenuRozpoznani["days"][number] | null = null;
  const rok = opts.rok ?? new Date().getFullYear();

  for (const raw of lines) {
    const line = raw.replace(/^[-•*]\s*/, "");
    // Den?
    const d = DNY.find(([re]) => re.test(line));
    if (d && line.length < 40) {
      const m = DATUM_RE.exec(line);
      const day_date = m ? `${m[3] ?? rok}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` : null;
      den = { label: d[1], day_date, items: [] };
      out.days.push(den);
      continue;
    }
    // Kategorie?
    const k = KATEGORIE.find(([re]) => re.test(line));
    if (k && line.length < 30 && !jeCenovyRadek(line)) {
      kategorie = k[1];
      continue;
    }
    // Titulek (první řádek bez ceny, bez kategorie)
    if (!out.title && out.items.length === 0 && out.days.length === 0 && !jeCenovyRadek(line) && line.length < 60) {
      out.title = line;
      const m = DATUM_RE.exec(line);
      if (m) out.valid_from = `${m[3] ?? rok}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
      if (/t[yý]den/i.test(line)) out.kind = "weekly";
      if (/v[ií]kend/i.test(line)) out.kind = "weekend";
      continue;
    }
    const item = rozpoznatPolozku(line, kategorie);
    (den ? den.items : out.items).push(item);
  }

  if (out.days.length > 0 && out.kind === "daily") out.kind = "weekly";
  const vsechny = [...out.items, ...out.days.flatMap((x) => x.items)];
  if (vsechny.length === 0) out.warnings.push("V textu se nenašla žádná položka menu.");
  const bezCeny = vsechny.filter((i) => i.price_cents === null).length;
  if (bezCeny > 0) out.warnings.push(`${bezCeny} položek bez rozpoznané ceny — doplňte ručně.`);
  if (out.days.some((x) => !x.day_date)) out.warnings.push("U některých dnů chybí datum.");
  return out;
}

/** Holé číslo na konci řádku je cena jen tehdy, když řádek není datum („Denní menu 9. 9. 2026“). */
function jeCenovyRadek(line: string): boolean {
  if (!CENA_RE.test(line)) return false;
  const m = CENA_RE.exec(line)!;
  if (m[3] !== undefined && DATUM_RE.test(line)) return false;
  return true;
}

export function rozpoznatPolozku(line: string, kategorie: string): MenuRozpoznanaPolozka {
  let rest = line;
  let price_cents: number | null = null;
  let allergens: string[] = [];
  let needs_review = false;
  let review_reason: string | null = null;

  const a = ALERGENY_RE.exec(rest);
  if (a) {
    allergens = a[1].split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
    rest = rest.slice(0, a.index).trim();
  }
  const c = jeCenovyRadek(rest) ? CENA_RE.exec(rest) : null;
  if (c) {
    const whole = c[1] ?? c[3];
    const frac = c[2] ?? "00";
    price_cents = Number(whole) * 100 + Number(frac);
    rest = rest.slice(0, c.index).trim().replace(/[.…\-–]+$/, "").trim();
  } else {
    needs_review = true;
    review_reason = "Nerozpoznaná cena";
  }
  // Alergeny mohly být před cenou
  if (allergens.length === 0) {
    const a2 = /\((\d{1,2}(?:\s*[,;/]\s*\d{1,2})*)\)\s*$/.exec(rest);
    if (a2) {
      allergens = a2[1].split(/[,;/]/).map((s) => s.trim());
      rest = rest.slice(0, a2.index).trim();
    }
  }
  let name = rest;
  let description = "";
  const sep = rest.indexOf(" – ") >= 0 ? " – " : rest.indexOf(" - ") >= 0 ? " - " : null;
  if (sep) {
    name = rest.slice(0, rest.indexOf(sep)).trim();
    description = rest.slice(rest.indexOf(sep) + sep.length).trim();
  }
  if (!name) {
    name = line;
    needs_review = true;
    review_reason = "Nerozpoznaný název";
  }
  if (/\?|tbd|dopln/i.test(line)) {
    needs_review = true;
    review_reason = review_reason ?? "Řádek obsahuje otazník nebo poznámku k doplnění";
  }
  return { category: kategorie, name, description, price_cents, allergens, note: "", needs_review, review_reason };
}
