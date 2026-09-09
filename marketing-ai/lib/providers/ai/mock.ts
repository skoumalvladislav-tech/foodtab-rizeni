import { formatDatumSlovy } from "../../cas.ts";
import type { AIProvider, MenuRozpoznani, ProviderContext } from "../types.ts";
import { AiNavrhSchema, type AiNavrh, type AiVarianta, type AiZadani, type AiZpetnaVazba } from "./schema.ts";
import { rozpoznatMenuZTextu } from "../../domena/menu-text.ts";

/**
 * Interní návrhář (demo) — deterministický, bez externí služby.
 *
 * Vždy označený jako mock. Umí totéž rozhraní jako Claude adaptér,
 * takže celá cesta „zadání → návrh → náhled → schválení → publikace“
 * jde vyzkoušet bez klíče. Texty jsou šablonové a je to vidět.
 */
export function createMockAi(ctx: ProviderContext): AIProvider {
  return {
    key: "internal_mock_ai",
    category: "ai_generation",
    capabilities: ["text.caption", "text.storyboard", "text.variants", "text.revise", "menu.ocr"],
    mode: "mock",
    isMock: true,
    async testConnection() {
      return { ok: true, message: "Demo návrhář nepotřebuje připojení." };
    },
    async navrhnout(zadani) {
      const navrh = AiNavrhSchema.parse(sestavitNavrh(zadani));
      return { navrh, model: "internal-mock-v1", promptVersion: "mock-1", costEstimateCents: 0 };
    },
    async prepracovat(zadani, puvodni, zv) {
      const navrh = AiNavrhSchema.parse(prepracovat(zadani, puvodni, zv));
      return { navrh, model: "internal-mock-v1", promptVersion: "mock-1", costEstimateCents: 0 };
    },
    async rozpoznatMenu({ bytes, mime, hint }): Promise<MenuRozpoznani> {
      // Mock neumí číst obrázky. Text (nebo nápověda) ano.
      if (mime.startsWith("text/") || hint) {
        const text = hint ?? new TextDecoder().decode(bytes);
        return rozpoznatMenuZTextu(text);
      }
      return {
        kind: "daily", title: "", valid_from: null, valid_to: null, days: [], items: [],
        warnings: [`Demo návrhář neumí rozpoznat menu z ${mime}. Připojte AI poskytovatele se schopností menu.ocr, nebo vložte text menu.`],
      };
    },
    // ctx se nepoužívá — mock nemá přístupové údaje
    ...(ctx.mode === "mock" ? {} : {}),
  };
}

function kc(n: number | null): string {
  return n === null ? "" : `${Math.round(n)} Kč`;
}

function polozkyText(z: AiZadani, max = 4): string {
  return z.fakta.polozky.slice(0, max).map((p) => `${p.nazev}${p.cenaKc !== null ? ` – ${kc(p.cenaKc)}` : ""}`).join("\n");
}

function hashtagy(z: AiZadani, extra: string[]): string[] {
  const base = z.brand.hashtagy.filter((h) => h.startsWith("#"));
  return [...new Set([...base, ...extra])].slice(0, 12);
}

function hero(z: AiZadani): string | null {
  return z.media.find((m) => m.jeHero)?.id ?? z.media[0]?.id ?? null;
}

function scenyZ(z: AiZadani, delka: number): AiVarianta["storyboard"] {
  const items = z.fakta.polozky.slice(0, 4);
  const mediaIds = z.media.map((m) => m.id);
  const sceny: AiVarianta["storyboard"] = [
    { poradi: 1, druh: "intro", sekundy: 2, mediaAssetId: mediaIds[0] ?? null, textVObraze: z.brand.nazev, titulek: "", poznamka: "Logo a název podle brand kitu" },
  ];
  let i = 2;
  for (const it of items) {
    sceny.push({ poradi: i++, druh: "item", sekundy: Math.round(Math.max(2, Math.min(4, (delka - 5) / Math.max(1, items.length))) * 2) / 2, mediaAssetId: mediaIds[(i - 2) % Math.max(1, mediaIds.length)] ?? null, textVObraze: it.nazev, titulek: it.cenaKc !== null ? kc(it.cenaKc) : "", poznamka: "" });
  }
  if (items.length === 0) {
    sceny.push({ poradi: i++, druh: "photo", sekundy: 4, mediaAssetId: mediaIds[0] ?? null, textVObraze: (z.fakta.vstupy.title as string) ?? "", titulek: "", poznamka: "" });
  }
  sceny.push({ poradi: i++, druh: "cta", sekundy: 2, mediaAssetId: null, textVObraze: z.brand.cta[0] ?? "Přijďte ochutnat", titulek: "", poznamka: "" });
  sceny.push({ poradi: i, druh: "outro", sekundy: 1, mediaAssetId: null, textVObraze: z.brand.podpis || z.brand.nazev, titulek: "", poznamka: "" });
  return sceny;
}

export function sestavitNavrh(z: AiZadani): AiNavrh {
  const nazev = z.brand.nazev;
  const datum = z.fakta.platnostOd ? formatDatumSlovy(z.fakta.platnostOd) : null;
  const rozsah = z.fakta.platnostOd && z.fakta.platnostDo && z.fakta.platnostOd !== z.fakta.platnostDo
    ? `${formatDatumSlovy(z.fakta.platnostOd)} – ${formatDatumSlovy(z.fakta.platnostDo)}`
    : datum;
  const titul = (z.fakta.vstupy.title as string | undefined) ?? z.fakta.menuNazev ?? z.ucel.replace(/_/g, " ");
  const cta = z.brand.cta[0] ?? "Přijďte ochutnat";
  const zakazane = z.brand.zakazaneVyrazy;
  const clean = (s: string) => zakazane.reduce((acc, f) => acc.split(f).join(""), s);
  const items = polozkyText(z);
  const chybi: string[] = [];
  if (z.fakta.polozky.some((p) => p.cenaKc === null)) chybi.push("U některých položek chybí cena — v návrhu je vynechaná, nedomýšlí se.");
  if (!z.fakta.platnostOd && /menu/.test(z.ucel)) chybi.push("Chybí datum nebo platnost menu.");
  if (z.media.length === 0) chybi.push("Nebyla vybrána žádná fotografie ani video.");
  const pouzite = z.fakta.polozky.map((p) => `${p.nazev}${p.cenaKc !== null ? ` ${kc(p.cenaKc)}` : ""}`);
  if (rozsah) pouzite.push(`platnost: ${rozsah}`);

  const v1: AiVarianta = {
    klic: "vecna", nazev: "Věcná", proc: "Krátký, přehledný text s položkami a cenami — funguje u denního i víkendového menu.",
    instagram: {
      hook: clean(`${titul}${rozsah ? ` · ${rozsah}` : ""}`),
      popisek: clean(`${titul}${rozsah ? ` (${rozsah})` : ""}\n\n${items}${items ? "\n\n" : ""}${z.brief ? z.brief + "\n\n" : ""}${cta}.`),
      cta, hashtagy: hashtagy(z, ["#dennimenu", "#restaurace", "#poledne"]),
    },
    facebook: {
      hook: clean(`${titul}${rozsah ? ` – ${rozsah}` : ""}`),
      popisek: clean(`${titul}${rozsah ? ` – ${rozsah}` : ""}\n${items}${items ? "\n" : ""}${z.brief ? "\n" + z.brief + "\n" : ""}\n${cta}. ${z.brand.podpis}`.trim()),
      cta, hashtagy: hashtagy(z, []).slice(0, 3),
    },
    textyVObraze: [titul, rozsah ?? "", cta].filter(Boolean),
    titulniFotoAssetId: hero(z), vybranaMediaIds: z.media.slice(0, 5).map((m) => m.id),
    storyboard: scenyZ(z, z.brand.delkaVidea),
  };
  const v2: AiVarianta = {
    klic: "prijemna", nazev: "Přátelská", proc: "Osobnější tón podle brand kitu, jedna hlavní položka jako lákadlo.",
    instagram: {
      hook: clean(`Máme pro vás ${titul.toLowerCase()} 🍽️`),
      popisek: clean(`${z.fakta.polozky[0] ? `Dnes doporučujeme: ${z.fakta.polozky[0].nazev}${z.fakta.polozky[0].cenaKc !== null ? ` za ${kc(z.fakta.polozky[0].cenaKc)}` : ""}.\n\n` : ""}${items}${items ? "\n\n" : ""}${z.brand.tonHlasu ? "" : ""}${cta} – těšíme se na vás v ${nazev}.`),
      cta, hashtagy: hashtagy(z, ["#dobrejidlo", "#jdemenaobed"]),
    },
    facebook: {
      hook: clean(`${titul} v ${nazev}`),
      popisek: clean(`${z.fakta.polozky[0] ? `Doporučujeme ${z.fakta.polozky[0].nazev}. ` : ""}${items ? "Celá nabídka:\n" + items + "\n\n" : ""}${cta}.`),
      cta, hashtagy: hashtagy(z, []).slice(0, 2),
    },
    textyVObraze: [z.fakta.polozky[0]?.nazev ?? titul, cta].filter(Boolean),
    titulniFotoAssetId: hero(z), vybranaMediaIds: z.media.slice(0, 3).map((m) => m.id),
    storyboard: scenyZ(z, Math.max(8, z.brand.delkaVidea - 3)),
  };
  const v3: AiVarianta = {
    klic: "strucna", nazev: "Stručná", proc: "Jen to nejnutnější — pro Story a rychlé připomenutí.",
    instagram: { hook: clean(titul), popisek: clean(`${titul}${rozsah ? ` · ${rozsah}` : ""}. ${cta}.`), cta, hashtagy: hashtagy(z, []).slice(0, 5) },
    facebook: { hook: clean(titul), popisek: clean(`${titul}${rozsah ? ` · ${rozsah}` : ""}. ${cta}.`), cta, hashtagy: [] },
    textyVObraze: [titul].filter(Boolean),
    titulniFotoAssetId: hero(z), vybranaMediaIds: z.media.slice(0, 1).map((m) => m.id),
    storyboard: scenyZ(z, 8),
  };

  return {
    shrnutiCile: `Propagovat „${titul}“ pro ${nazev}${rozsah ? ` (${rozsah})` : ""} na ${z.kanaly.join(" a ")}.`,
    varianty: [v1, v2, v3],
    doporucenaVarianta: "vecna",
    kontrolaFaktu: { chybi, rozpory: [], pouziteUdaje: pouzite },
    upozorneni: ["Návrh vytvořil interní demo návrhář (mock). Texty jsou šablonové — pro kreativní text připojte AI poskytovatele."],
  };
}

export function prepracovat(z: AiZadani, puvodni: AiNavrh, zv: AiZpetnaVazba): AiNavrh {
  const klic = zv.variantaKlic ?? puvodni.doporucenaVarianta;
  const varianty = puvodni.varianty.map((v) => {
    if (v.klic !== klic) return v;
    const uprav = (t: AiVarianta["instagram"]): AiVarianta["instagram"] => {
      switch (zv.typ) {
        case "zkratit": return { ...t, popisek: t.popisek.split("\n").slice(0, 2).join("\n").slice(0, 160), hashtagy: t.hashtagy.slice(0, 5) };
        case "mene_umele": return { ...t, hook: t.hook.replace(/[🍽️✨🔥]/g, "").trim(), popisek: t.popisek.replace(/[🍽️✨🔥]/g, "").replace(/!+/g, ".") };
        case "pro_mlade": return { ...t, hook: `${t.hook} 🔥`, popisek: `${t.popisek}\n\nBer to jako pozvánku 😉`, hashtagy: [...t.hashtagy, "#foodie", "#letsgo"].slice(0, 30) };
        case "zmenit_cenu": return { ...t, popisek: `${t.popisek}\n\n(Poznámka: cenu je potřeba upravit ve zdrojovém menu — návrhář ceny nemění sám.)` };
        default: return zv.text ? { ...t, popisek: `${t.popisek}\n\n${zv.text}` } : t;
      }
    };
    const cast = zv.cast;
    return {
      ...v,
      instagram: cast === "vse" || cast === "caption:instagram" ? uprav(v.instagram) : v.instagram,
      facebook: cast === "vse" || cast === "caption:facebook" ? uprav(v.facebook) : v.facebook,
      vybranaMediaIds: zv.typ === "jina_fotka" ? [...v.vybranaMediaIds.slice(1), ...v.vybranaMediaIds.slice(0, 1)] : v.vybranaMediaIds,
      titulniFotoAssetId: zv.typ === "jina_fotka" ? (z.media.find((m) => m.id !== v.titulniFotoAssetId)?.id ?? v.titulniFotoAssetId) : v.titulniFotoAssetId,
    };
  });
  return {
    ...puvodni,
    varianty,
    upozorneni: [...puvodni.upozorneni.filter((u) => !u.startsWith("Přepracováno")), `Přepracováno (${zv.typ}, část: ${zv.cast}) demo návrhářem; ostatní části zůstaly beze změny.`],
  };
}
