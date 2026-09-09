import { z } from "zod";

/**
 * Strukturovaný výstup AI agenta — validovaný Zodem. Co neprojde, se
 * neuloží. AI nesmí domýšlet cenu, datum ani alergeny: fakta bere ze
 * `zadani.fakta` a v `kontrolaFaktu` hlásí, co chybí nebo nesedí.
 */

export const ScenaSchema = z.object({
  poradi: z.number().int().min(1),
  druh: z.enum(["intro", "photo", "item", "items", "text", "cta", "outro"]),
  sekundy: z.number().min(0.5).max(30),
  /** Odkaz na médium (ID) nebo null */
  mediaAssetId: z.string().nullable().default(null),
  textVObraze: z.string().max(120).default(""),
  titulek: z.string().max(200).default(""),
  poznamka: z.string().max(300).default(""),
});

export const KanalTextSchema = z.object({
  hook: z.string().max(150),
  popisek: z.string().max(2200),
  cta: z.string().max(120),
  hashtagy: z.array(z.string().regex(/^#[^\s#]+$/)).max(30),
});

export const VariantaSchema = z.object({
  klic: z.string().min(1).max(40),
  nazev: z.string().min(1).max(80),
  proc: z.string().max(400),
  instagram: KanalTextSchema,
  facebook: KanalTextSchema,
  textyVObraze: z.array(z.string().max(80)).max(6).default([]),
  titulniFotoAssetId: z.string().nullable().default(null),
  vybranaMediaIds: z.array(z.string()).default([]),
  storyboard: z.array(ScenaSchema).default([]),
});

export const KontrolaFaktuSchema = z.object({
  chybi: z.array(z.string().max(200)).default([]),
  rozpory: z.array(z.string().max(200)).default([]),
  pouziteUdaje: z.array(z.string().max(200)).default([]),
});

export const AiNavrhSchema = z.object({
  shrnutiCile: z.string().max(400),
  varianty: z.array(VariantaSchema).min(1).max(3),
  doporucenaVarianta: z.string(),
  kontrolaFaktu: KontrolaFaktuSchema,
  upozorneni: z.array(z.string().max(300)).default([]),
});

export type AiNavrh = z.infer<typeof AiNavrhSchema>;
export type AiVarianta = z.infer<typeof VariantaSchema>;
export type AiScena = z.infer<typeof ScenaSchema>;

export const AiZadaniSchema = z.object({
  /** Co člověk napsal běžným jazykem */
  brief: z.string().max(4000),
  ucel: z.string(),
  sablonaKey: z.string().nullable(),
  kanaly: z.array(z.enum(["instagram", "facebook"])).min(1),
  formaty: z.array(z.string()).default([]),
  termin: z.string().nullable().default(null),
  /** Brand kit bez kontaktů, které nemají do modelu chodit */
  brand: z.object({
    nazev: z.string(),
    popis: z.string().default(""),
    tonHlasu: z.string().default(""),
    cta: z.array(z.string()).default([]),
    povoleneVyrazy: z.array(z.string()).default([]),
    zakazaneVyrazy: z.array(z.string()).default([]),
    hashtagy: z.array(z.string()).default([]),
    podpis: z.string().default(""),
    delkaVidea: z.number().default(15),
  }),
  /** Fakta ze schváleného zdroje: menu, ceny, datum. Jediný zdroj pravdy. */
  fakta: z.object({
    menuNazev: z.string().nullable().default(null),
    platnostOd: z.string().nullable().default(null),
    platnostDo: z.string().nullable().default(null),
    polozky: z.array(z.object({
      kategorie: z.string(),
      nazev: z.string(),
      popis: z.string().default(""),
      cenaKc: z.number().nullable(),
      alergeny: z.array(z.string()).default([]),
    })).default([]),
    vstupy: z.record(z.string(), z.unknown()).default({}),
  }),
  media: z.array(z.object({
    id: z.string(),
    druh: z.string(),
    titulek: z.string().default(""),
    popis: z.string().default(""),
    tagy: z.array(z.string()).default([]),
    jeHero: z.boolean().default(false),
  })).default([]),
});

export type AiZadani = z.infer<typeof AiZadaniSchema>;

export const AiZpetnaVazbaSchema = z.object({
  /** zkratit | mene_umele | pro_mlade | zmenit_cenu | jina_fotka | volne */
  typ: z.enum(["zkratit", "mene_umele", "pro_mlade", "zmenit_cenu", "jina_fotka", "volne"]),
  text: z.string().max(1000).default(""),
  /** Jen dotčená část: caption:instagram | caption:facebook | storyboard | media | vse */
  cast: z.string().default("vse"),
  variantaKlic: z.string().nullable().default(null),
});

export type AiZpetnaVazba = z.infer<typeof AiZpetnaVazbaSchema>;

/** JSON Schema pro tool use — odvozené z Zodu, aby existovalo jen jedno. */
export function aiNavrhJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AiNavrhSchema, { target: "draft-7" }) as Record<string, unknown>;
}
