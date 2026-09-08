/**
 * Demo data pro dvě provozovny (Černá Perla, Bernard Bar Tábor) a druhou
 * organizaci pro test oddělení. Skutečné ceny, adresy a kontakty se
 * NEVYMÝŠLEJÍ — všechno je označené jako demo.
 *
 * Spouští se jako správce databáze (PGlite superuživatel nebo
 * service_role), nikdy z prohlížeče.
 */
import { randomUUID } from "node:crypto";

import { dnes, nejblizsiSobota, posunDne } from "../cas.ts";
import type { Driver, Tx } from "../db/driver.ts";
import { DEMO_ORG, DEMO_ORG_2, DEMO_USERS, DEMO_VENUES } from "../demo-ucty.ts";
import { SABLONY, inputJsonSchema } from "../sablony/katalog.ts";
import { getStorage, mediaPath } from "../storage/index.ts";
import { sha256Hex } from "../utils/hash.ts";
import { BRAND_KITY, SDILENE_SLOZKY, SLOZKY_MEDII } from "./brand-kity.ts";
import { ukazkovyObrazekSvg } from "./ukazkove-obrazky.ts";

export async function seedDemo(driver: Driver): Promise<void> {
  await driver.transaction(async (tx) => {
    if (driver.kind === "postgres") {
      await tx.q("select set_config('role', 'service_role', true)");
    }
    await seedLide(tx, driver.kind);
    await seedOrganizace(tx);
    await seedSablony(tx);
    await seedProvidery(tx);
    await seedMenu(tx);
    await seedObsah(tx);
  });
  // Soubory až po transakci — storage není transakční.
  await seedMedia(driver);
}

async function seedLide(tx: Tx, kind: Driver["kind"]) {
  for (const u of DEMO_USERS) {
    if (kind === "pglite") {
      await tx.q("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [u.id, u.email]);
    }
    await tx.q(
      "insert into marketing.profiles (user_id, email, display_name) values ($1, $2, $3) on conflict (user_id) do nothing",
      [u.id, u.email, u.name],
    );
  }
}

async function seedOrganizace(tx: Tx) {
  const orgs = [
    { ...DEMO_ORG, venues: [DEMO_VENUES.cernaPerla, DEMO_VENUES.bernardBar] },
    { ...DEMO_ORG_2, venues: [DEMO_VENUES.bistro] },
  ];
  for (const org of orgs) {
    await tx.q(
      "insert into marketing.organizations (id, name, slug, is_demo, onboarding_done_at) values ($1, $2, $3, true, now())",
      [org.id, org.name, org.slug],
    );
    const templates = await tx.q<{ key: string; name: string; description: string; is_owner: boolean; permissions: string[]; sort_order: number }>(
      "select * from marketing.role_templates order by sort_order",
    );
    for (const t of templates) {
      const role = await tx.one<{ id: string }>(
        `insert into marketing.roles (organization_id, key, name, description, is_owner, sort_order)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [org.id, t.key, t.name, t.description, t.is_owner, t.sort_order],
      );
      for (const p of t.permissions) {
        await tx.q("insert into marketing.role_permissions (role_id, permission_key) values ($1, $2)", [role!.id, p]);
      }
    }
    for (const v of org.venues) {
      await tx.q(
        "insert into marketing.venues (id, organization_id, name, slug, color) values ($1, $2, $3, $4, $5)",
        [v.id, org.id, v.name, v.slug, v.color],
      );
      for (const [i, s] of SLOZKY_MEDII.entries()) {
        await tx.q(
          "insert into marketing.media_collections (organization_id, venue_id, key, name, is_system, sort_order) values ($1, $2, $3, $4, true, $5)",
          [org.id, v.id, s.key, s.name, i],
        );
      }
      const bk = v.id === DEMO_VENUES.cernaPerla.id ? BRAND_KITY.cernaPerla : v.id === DEMO_VENUES.bernardBar.id ? BRAND_KITY.bernardBar : BRAND_KITY.bistro;
      await tx.q(
        `insert into marketing.brand_kits (organization_id, venue_id, name, short_description, colors, fonts, tone_of_voice,
           preferred_ctas, allowed_phrases, forbidden_phrases, default_hashtags, signature, logo_placement,
           music_style, voice_style, default_video_seconds, is_demo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true)`,
        [org.id, v.id, bk.name, bk.short_description, JSON.stringify(bk.colors), JSON.stringify(bk.fonts), bk.tone_of_voice,
          bk.preferred_ctas, bk.allowed_phrases, bk.forbidden_phrases, bk.default_hashtags, bk.signature,
          JSON.stringify(bk.logo_placement), bk.music_style, bk.voice_style, bk.default_video_seconds],
      );
    }
    for (const [i, s] of SDILENE_SLOZKY.entries()) {
      await tx.q(
        "insert into marketing.media_collections (organization_id, venue_id, key, name, is_system, sort_order) values ($1, null, $2, $3, true, $4)",
        [org.id, s.key, s.name, 100 + i],
      );
    }
  }

  for (const u of DEMO_USERS) {
    const role = await tx.one<{ id: string }>(
      "select id from marketing.roles where organization_id = $1 and key = $2",
      [u.organizationId, u.role],
    );
    const m = await tx.one<{ id: string }>(
      `insert into marketing.memberships (organization_id, user_id, role_id, scope, status)
       values ($1, $2, $3, $4, 'active') returning id`,
      [u.organizationId, u.id, role!.id, u.scope === "organization" ? "organization" : "venues"],
    );
    if (Array.isArray(u.scope)) {
      for (const venueId of u.scope) {
        await tx.q("insert into marketing.venue_access (membership_id, venue_id) values ($1, $2)", [m!.id, venueId]);
      }
    }
  }
}

async function seedSablony(tx: Tx) {
  for (const def of SABLONY) {
    const t = await tx.one<{ id: string }>(
      `insert into marketing.templates (organization_id, venue_id, key, name, category, description, pillar, is_system)
       values (null, null, $1, $2, $3, $4, $5, true) returning id`,
      [def.key, def.name, def.category, def.description, def.pillar],
    );
    await tx.q(
      `insert into marketing.template_versions (template_id, version, input_schema, layout, formats, text_rules, storyboard, brand_tokens)
       values ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [t!.id, JSON.stringify(inputJsonSchema(def)), JSON.stringify(def.layout), def.formats,
        JSON.stringify(def.textRules), def.storyboard ? JSON.stringify(def.storyboard) : null,
        JSON.stringify({ purpose: def.purpose, checklist: def.checklist, inputs: def.inputs })],
    );
  }
}

/** Výchozí volba nástrojů: demo organizace má všechno v mock režimu. */
async function seedProvidery(tx: Tx) {
  const volby: Record<string, Record<string, { key: string; mode: string }>> = {
    [DEMO_ORG.id]: {
      ai_generation: { key: "internal_mock_ai", mode: "mock" },
      image_rendering: { key: "internal_svg_renderer", mode: "foodtab_managed" },
      video_rendering: { key: "internal_mock_video", mode: "mock" },
      workflow_automation: { key: "internal_queue", mode: "foodtab_managed" },
      social_publishing: { key: "mock_publisher", mode: "mock" },
      analytics: { key: "mock_metrics", mode: "mock" },
      notifications: { key: "internal_notifications", mode: "foodtab_managed" },
      external_storage: { key: "local_storage", mode: "mock" },
      menu_source: { key: "manual_menu", mode: "foodtab_managed" },
    },
    // Druhá organizace má jinou volbu — test, že se organizace liší a nevidí si připojení.
    [DEMO_ORG_2.id]: {
      ai_generation: { key: "internal_mock_ai", mode: "mock" },
      image_rendering: { key: "internal_svg_renderer", mode: "foodtab_managed" },
      video_rendering: { key: "internal_mock_video", mode: "mock" },
      workflow_automation: { key: "internal_queue", mode: "foodtab_managed" },
      social_publishing: { key: "manual_export", mode: "manual_export" },
      analytics: { key: "mock_metrics", mode: "mock" },
      notifications: { key: "internal_notifications", mode: "foodtab_managed" },
      external_storage: { key: "local_storage", mode: "mock" },
      menu_source: { key: "manual_menu", mode: "foodtab_managed" },
    },
  };
  for (const [orgId, kategorie] of Object.entries(volby)) {
    for (const [category, v] of Object.entries(kategorie)) {
      const conn = await tx.one<{ id: string }>(
        `insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name, last_test_at, last_test_ok)
         values ($1, $2, $3, 'connected', $4, now(), true) returning id`,
        [orgId, v.key, v.mode, v.mode === "mock" ? "Demo režim" : "Vestavěné"],
      );
      await tx.q(
        `insert into marketing.organization_provider_preferences (organization_id, venue_id, category, provider_key, connection_id, is_active)
         values ($1, null, $2, $3, $4, true)`,
        [orgId, category, v.key, conn!.id],
      );
    }
  }
  // Demo sociální účty pro mock publisher (FoodTab demo organizace).
  const mockConn = await tx.one<{ id: string }>(
    "select id from marketing.integration_connections where organization_id = $1 and provider_key = 'mock_publisher'",
    [DEMO_ORG.id],
  );
  for (const v of [DEMO_VENUES.cernaPerla, DEMO_VENUES.bernardBar]) {
    await tx.q(
      `insert into marketing.social_accounts (organization_id, venue_id, connection_id, platform, kind, external_id, name, username, capabilities)
       values ($1, $2, $3, 'instagram', 'ig_business', $4, $5, $6, $7),
              ($1, $2, $3, 'facebook', 'page', $8, $9, null, $10)`,
      [DEMO_ORG.id, v.id, mockConn!.id,
        `mock-ig-${v.slug}`, `${v.name} (demo Instagram)`, `demo_${v.slug.replace(/-/g, "_")}`,
        ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story"],
        `mock-fb-${v.slug}`, `${v.name} (demo Facebook Page)`,
        ["publish.facebook.post", "publish.facebook.reel"]],
    );
  }
}

async function seedMenu(tx: Tx) {
  const today = dnes();
  const perla = await tx.one<{ id: string }>(
    `insert into marketing.menus (organization_id, venue_id, kind, title, valid_from, valid_to, source, status, created_by, confirmed_by, confirmed_at)
     values ($1, $2, 'daily', 'Demo denní menu (ukázkové ceny)', $3, $3, 'manual', 'confirmed', $4, $4, now()) returning id`,
    [DEMO_ORG.id, DEMO_VENUES.cernaPerla.id, today, DEMO_USERS[1].id],
  );
  const perlaItems: [string, string, string, number | null, string[]][] = [
    ["polevka", "Hovězí vývar s nudlemi", "", 4500, ["1", "3", "9"]],
    ["hlavni", "Svíčková na smetaně s houskovým knedlíkem", "Brusinky, šlehačka", 18900, ["1", "3", "7"]],
    ["hlavni", "Kuřecí řízek s bramborovou kaší", "Domácí strouhanka", 16900, ["1", "3", "7"]],
    ["hlavni", "Zapečené těstoviny se špenátem a nivou", "Vegetariánské", 14900, ["1", "3", "7"]],
    ["dezert", "Palačinka s tvarohem a lesním ovocem", "", 7900, ["1", "3", "7"]],
  ];
  for (const [i, [cat, name, desc, price, all]] of perlaItems.entries()) {
    await tx.q(
      `insert into marketing.menu_items (menu_id, category, name, description, price_cents, allergens, sort_order) values ($1, $2, $3, $4, $5, $6, $7)`,
      [perla!.id, cat, name, desc, price, all, i],
    );
  }

  const sobota = nejblizsiSobota();
  const nedele = posunDne(sobota, 1);
  const bernard = await tx.one<{ id: string }>(
    `insert into marketing.menus (organization_id, venue_id, kind, title, valid_from, valid_to, source, status, created_by, confirmed_by, confirmed_at)
     values ($1, $2, 'weekend', 'Demo víkendové menu (ukázkové ceny)', $3, $4, 'manual', 'confirmed', $5, $5, now()) returning id`,
    [DEMO_ORG.id, DEMO_VENUES.bernardBar.id, sobota, nedele, DEMO_USERS[1].id],
  );
  const bernardItems: [string, string, string, number | null, string[]][] = [
    ["polevka", "Česnečka se sýrem a krutony", "", 5500, ["1", "7"]],
    ["hlavni", "Pomalu pečená vepřová žebra v BBQ omáčce", "S chlebem a křenem", 24900, ["1", "10"]],
    ["hlavni", "Burger Bernard s trhaným hovězím", "Hranolky, domácí majonéza", 21900, ["1", "3", "7", "10"]],
    ["hlavni", "Smažený sýr s hranolky a tatarkou", "Klasika", 15900, ["1", "3", "7"]],
    ["dezert", "Pivní zmrzlina", "Ochutnávka", 6900, ["7"]],
  ];
  for (const [i, [cat, name, desc, price, all]] of bernardItems.entries()) {
    await tx.q(
      `insert into marketing.menu_items (menu_id, category, name, description, price_cents, allergens, sort_order) values ($1, $2, $3, $4, $5, $6, $7)`,
      [bernard!.id, cat, name, desc, price, all, i],
    );
  }

  // Druhá organizace — jedno menu, aby měl test izolace co nevidět.
  await tx.q(
    `insert into marketing.menus (organization_id, venue_id, kind, title, valid_from, valid_to, source, status, created_by)
     values ($1, $2, 'daily', 'Menu druhé organizace (nesmí být vidět z FoodTab demo)', $3, $3, 'manual', 'draft', $4)`,
    [DEMO_ORG_2.id, DEMO_VENUES.bistro.id, today, DEMO_USERS[6].id],
  );
}

async function seedObsah(tx: Tx) {
  // Kampaň s automatickým publikováním VYPNUTÝM (výchozí).
  const sobota = nejblizsiSobota();
  await tx.q(
    `insert into marketing.campaigns (organization_id, venue_id, name, goal, kind, pillar, starts_on, ends_on, status, created_by)
     values ($1, $2, 'Víkendové menu — pravidelná propagace', 'Každý čtvrtek a pátek pozvat na víkendové menu', 'recurring', 'menu', $3, $4, 'active', $5)`,
    [DEMO_ORG.id, DEMO_VENUES.bernardBar.id, posunDne(sobota, -2), posunDne(sobota, 1), DEMO_USERS[1].id],
  );
  await tx.q(
    `insert into marketing.automations (organization_id, venue_id, kind, name, is_enabled, owner_id, config, schedule)
     values ($1, $2, 'weekend_menu_promo', 'Čtvrteční propagace víkendového menu', false, $3, $4, 'Čtvrtek 10:00'),
            ($1, $5, 'daily_story_from_menu', 'Ranní Story z denního menu', false, $3, $6, 'Po–Pá 09:30')`,
    [DEMO_ORG.id, DEMO_VENUES.bernardBar.id, DEMO_USERS[1].id,
      JSON.stringify({ template: "vikendove_menu", formats: ["instagram_feed", "facebook_post"], time: "10:00", weekday: 4 }),
      DEMO_VENUES.cernaPerla.id,
      JSON.stringify({ template: "denni_menu", formats: ["instagram_story"], time: "09:30" })],
  );
  await tx.q(
    `insert into marketing.ideas (organization_id, venue_id, text, pillar, created_by)
     values ($1, $2, 'Představit nového kuchaře — krátké video z kuchyně', 'lide', $3),
            ($1, $4, 'Hokejové přenosy v říjnu: sestavit sérii pozvánek', 'akce', $3)`,
    [DEMO_ORG.id, DEMO_VENUES.cernaPerla.id, DEMO_USERS[1].id, DEMO_VENUES.bernardBar.id],
  );
}

/**
 * Ukázkové obrázky — SVG vygenerované na místě, aby knihovna nebyla
 * prázdná. Nejsou to fotografie jídel a jsou tak i popsané.
 */
async function seedMedia(driver: Driver) {
  const storage = await getStorage();
  const sady: { venueId: string; orgId: string; obrazky: { nazev: string; slozka: string; barva: string }[] }[] = [
    { venueId: DEMO_VENUES.cernaPerla.id, orgId: DEMO_ORG.id, obrazky: [
      { nazev: "Ukázka: svíčková (demo obrázek)", slozka: "jidla-foto", barva: "#6b4c8a" },
      { nazev: "Ukázka: interiér (demo obrázek)", slozka: "prostory", barva: "#1f1a2e" },
      { nazev: "Ukázka: dezert (demo obrázek)", slozka: "jidla-foto", barva: "#a35c7a" },
    ] },
    { venueId: DEMO_VENUES.bernardBar.id, orgId: DEMO_ORG.id, obrazky: [
      { nazev: "Ukázka: žebra (demo obrázek)", slozka: "jidla-foto", barva: "#8a4a1c" },
      { nazev: "Ukázka: bar (demo obrázek)", slozka: "prostory", barva: "#3a2214" },
      { nazev: "Ukázka: hokej na plátně (demo obrázek)", slozka: "akce", barva: "#2c4a6b" },
    ] },
    { venueId: DEMO_VENUES.bistro.id, orgId: DEMO_ORG_2.id, obrazky: [
      { nazev: "Ukázka druhé organizace (demo obrázek)", slozka: "jidla-foto", barva: "#1c3a3a" },
    ] },
  ];
  await driver.transaction(async (tx) => {
    if (driver.kind === "postgres") await tx.q("select set_config('role', 'service_role', true)");
    for (const sada of sady) {
      for (const o of sada.obrazky) {
        const id = randomUUID();
        const svg = ukazkovyObrazekSvg(o.nazev, o.barva);
        const bytes = new TextEncoder().encode(svg);
        const filename = `${o.slozka}-${id.slice(0, 8)}.svg`;
        const p = mediaPath({ organizationId: sada.orgId, venueId: sada.venueId, assetId: id, filename });
        await storage.put(p, bytes, "image/svg+xml");
        const col = await tx.one<{ id: string }>(
          "select id from marketing.media_collections where organization_id = $1 and venue_id = $2 and key = $3",
          [sada.orgId, sada.venueId, o.slozka],
        );
        await tx.q(
          `insert into marketing.media_assets (id, organization_id, venue_id, collection_id, kind, original_filename, storage_path, storage_provider,
             mime_type, size_bytes, width, height, orientation, sha256, title, description, is_hero, author, license, uploaded_by)
           values ($1, $2, $3, $4, 'image', $5, $6, $7, 'image/svg+xml', $8, 1080, 1350, 'portrait', $9, $10, 'Ukázkový obrázek vygenerovaný při založení demo dat. Není to fotografie jídla.', $11, 'FoodTab demo', 'Interní demo — bez licence k publikaci', $12)`,
          [id, sada.orgId, sada.venueId, col?.id ?? null, filename, p, storage.key, bytes.length, sha256Hex(bytes), o.nazev,
            o.slozka === "jidla-foto" && o.nazev.includes("svíčková"), DEMO_USERS[1].id],
        );
        await tx.q("insert into marketing.media_tags (asset_id, tag, source) values ($1, 'demo', 'user'), ($1, $2, 'ai')", [id, o.slozka]);
      }
    }
  });
}
