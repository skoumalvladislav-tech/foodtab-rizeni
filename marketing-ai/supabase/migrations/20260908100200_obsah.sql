-- =====================================================================
-- FoodTab Marketing AI — brand kit, média, šablony, menu, obsah,
-- schvalování, render a publikace, kalendář, automatizace
--
-- Stavový model obsahu (content_items.status):
--   idea → draft → generating → preview_ready → changes_requested
--   → awaiting_approval → approved → scheduled → publishing → published
-- chybové: generation_failed, render_failed, publish_failed,
--          connection_required, cancelled, archived
--
-- Tři pravidla, která hlídá DATABÁZE, ne jen aplikace:
--   1. schválení patří PŘESNÉ verzi (otisk obsahu); nová verze schválení
--      ruší a vrací obsah do stavu draft,
--   2. publish job nejde založit bez platného schválení téže verze,
--   3. schválený obsah se nemění — úprava = nová verze.
-- =====================================================================


-- ---------------------------------------------------------------------
-- MÉDIA
-- ---------------------------------------------------------------------

create table marketing.media_collections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  -- NULL = sdílené pro všechny provozovny
  venue_id        uuid references marketing.venues(id) on delete cascade,
  key             text not null,
  name            text not null,
  is_system       boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create unique index media_collections_key_idx
  on marketing.media_collections (organization_id, coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table marketing.media_assets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references marketing.organizations(id) on delete cascade,
  -- NULL = sdílené pro všechny provozovny
  venue_id              uuid references marketing.venues(id) on delete cascade,
  collection_id         uuid references marketing.media_collections(id) on delete set null,
  kind                  text not null check (kind in ('image', 'video', 'audio', 'document', 'render')),
  original_filename     text not null,
  -- organizations/{org}/venues/{venue}/media/{yyyy}/{mm}/{id}/{filename}
  storage_path          text not null,
  storage_provider      text not null default 'local',
  mime_type             text not null,
  size_bytes            bigint not null default 0,
  width                 integer,
  height                integer,
  duration_seconds      numeric,
  orientation           text check (orientation in ('landscape', 'portrait', 'square')),
  sha256                text,
  title                 text not null default '',
  description           text not null default '',
  ai_description        text,
  is_hero               boolean not null default false,
  author                text,
  license               text,
  consent_note          text,
  usable_until          date,
  -- Odvozené varianty (ořezy, rendery) drží vazbu na originál.
  derived_from_asset_id uuid references marketing.media_assets(id) on delete set null,
  derivation            jsonb,
  ai_generated          boolean not null default false,
  ai_edited             boolean not null default false,
  uploaded_by           uuid references marketing.profiles(user_id),
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_media_assets_updated before update on marketing.media_assets
  for each row execute function marketing.set_updated_at();

create index media_assets_venue_idx on marketing.media_assets (organization_id, venue_id, created_at desc);
-- Duplicita se pozná otiskem: stejný soubor ve stejném rozsahu podruhé nejde.
create unique index media_assets_dedupe_idx
  on marketing.media_assets (organization_id, coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid), sha256)
  where sha256 is not null and derived_from_asset_id is null and archived_at is null;

create table marketing.media_tags (
  asset_id uuid not null references marketing.media_assets(id) on delete cascade,
  tag      text not null,
  source   text not null default 'user' check (source in ('user', 'ai')),
  primary key (asset_id, tag)
);


-- ---------------------------------------------------------------------
-- BRAND KIT PROVOZOVNY
-- ---------------------------------------------------------------------

create table marketing.brand_kits (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references marketing.organizations(id) on delete cascade,
  venue_id              uuid not null unique references marketing.venues(id) on delete cascade,
  name                  text not null,
  short_description     text not null default '',
  logo_light_asset_id   uuid references marketing.media_assets(id) on delete set null,
  logo_dark_asset_id    uuid references marketing.media_assets(id) on delete set null,
  -- {primary, secondary, accent, background, text}
  colors                jsonb not null default '{}'::jsonb,
  -- {heading, body}
  fonts                 jsonb not null default '{}'::jsonb,
  address               text not null default '',
  phone                 text not null default '',
  website_url           text not null default '',
  reservation_url       text not null default '',
  ordering_url          text not null default '',
  tone_of_voice         text not null default '',
  preferred_ctas        text[] not null default array[]::text[],
  allowed_phrases       text[] not null default array[]::text[],
  forbidden_phrases     text[] not null default array[]::text[],
  default_hashtags      text[] not null default array[]::text[],
  signature             text not null default '',
  -- {position: 'top-left'|…, safe_zone_percent: 8}
  logo_placement        jsonb not null default '{}'::jsonb,
  reels_intro_asset_id  uuid references marketing.media_assets(id) on delete set null,
  reels_outro_asset_id  uuid references marketing.media_assets(id) on delete set null,
  music_style           text not null default '',
  voice_style           text not null default '',
  default_video_seconds integer not null default 15,
  -- Demo pole jsou označená — nevymýšlíme adresy ani telefony.
  is_demo               boolean not null default false,
  updated_by            uuid references marketing.profiles(user_id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_brand_kits_updated before update on marketing.brand_kits
  for each row execute function marketing.set_updated_at();


-- ---------------------------------------------------------------------
-- ŠABLONY — data, ne obrázky
-- ---------------------------------------------------------------------

create table marketing.templates (
  id                 uuid primary key default gen_random_uuid(),
  -- NULL = globální šablona FoodTabu; jinak vlastní šablona organizace
  organization_id    uuid references marketing.organizations(id) on delete cascade,
  venue_id           uuid references marketing.venues(id) on delete cascade,
  key                text not null,
  name               text not null,
  -- menu | akce | prubezne
  category           text not null check (category in ('menu', 'akce', 'prubezne')),
  description        text not null default '',
  -- Obsahový pilíř (menu, lide, atmosfera, akce, zakulisi, prodej)
  pillar             text not null default 'menu',
  parent_template_id uuid references marketing.templates(id) on delete set null,
  is_system          boolean not null default false,
  created_by         uuid references marketing.profiles(user_id),
  archived_at        timestamptz,
  created_at         timestamptz not null default now()
);

create unique index templates_key_idx
  on marketing.templates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  where archived_at is null;

create table marketing.template_versions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references marketing.templates(id) on delete cascade,
  version       integer not null default 1,
  -- JSON Schema vstupů (validuje se v aplikaci Zodem z téhle definice)
  input_schema  jsonb not null,
  -- Rozvržení: bloky, pozice, bezpečné zóny, uzamčené brand prvky
  layout        jsonb not null,
  -- Výstupy, které šablona umí: instagram_feed, instagram_story, …
  formats       text[] not null,
  -- Pravidla pro dlouhé texty: max řádků, min velikost písma, rozdělení na slidy
  text_rules    jsonb not null default '{}'::jsonb,
  storyboard    jsonb,
  brand_tokens  jsonb not null default '{}'::jsonb,
  created_by    uuid references marketing.profiles(user_id),
  created_at    timestamptz not null default now(),
  unique (template_id, version)
);

-- Výchozí šablona provozovny pro daný účel.
create table marketing.venue_template_defaults (
  venue_id    uuid not null references marketing.venues(id) on delete cascade,
  purpose     text not null,
  template_id uuid not null references marketing.templates(id) on delete cascade,
  primary key (venue_id, purpose)
);


-- ---------------------------------------------------------------------
-- MENU
-- ---------------------------------------------------------------------

create table marketing.menus (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references marketing.organizations(id) on delete cascade,
  venue_id         uuid not null references marketing.venues(id) on delete cascade,
  -- daily | weekly | weekend | lunch3 | special | seasonal | drinks | dessert
  kind             text not null,
  title            text not null default '',
  valid_from       date,
  valid_to         date,
  -- manual | text | image | pdf | foodtab
  source           text not null default 'manual',
  source_asset_id  uuid references marketing.media_assets(id) on delete set null,
  -- Původní text/výsledek OCR se zachovává vedle opravené verze.
  raw_import       jsonb,
  status           text not null default 'draft' check (status in ('draft', 'confirmed', 'archived')),
  currency         text not null default 'CZK',
  -- Verzovaná událost z FoodTabu (menu.approved), pokud odtud přišlo
  foodtab_event_id text,
  created_by       uuid references marketing.profiles(user_id),
  confirmed_by     uuid references marketing.profiles(user_id),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_menus_updated before update on marketing.menus
  for each row execute function marketing.set_updated_at();

create index menus_venue_idx on marketing.menus (venue_id, valid_from desc);

create table marketing.menu_days (
  id         uuid primary key default gen_random_uuid(),
  menu_id    uuid not null references marketing.menus(id) on delete cascade,
  day_date   date,
  label      text not null default '',
  sort_order integer not null default 0
);

create table marketing.menu_items (
  id            uuid primary key default gen_random_uuid(),
  menu_id       uuid not null references marketing.menus(id) on delete cascade,
  menu_day_id   uuid references marketing.menu_days(id) on delete cascade,
  -- polevka | hlavni | dezert | napoj | predkrm | ostatni
  category      text not null default 'hlavni',
  name          text not null,
  description   text not null default '',
  -- Cena v haléřích. NULL = neznámá (AI ji nesmí domýšlet).
  price_cents   integer check (price_cents is null or price_cents >= 0),
  allergens     text[] not null default array[]::text[],
  note          text not null default '',
  availability  text not null default 'available' check (availability in ('available', 'limited', 'sold_out')),
  needs_review  boolean not null default false,
  review_reason text,
  sort_order    integer not null default 0
);

create index menu_items_menu_idx on marketing.menu_items (menu_id, sort_order);


-- ---------------------------------------------------------------------
-- KAMPANĚ A OBSAH
-- ---------------------------------------------------------------------

create table marketing.campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid not null references marketing.venues(id) on delete cascade,
  name            text not null,
  goal            text not null default '',
  kind            text not null default 'custom',
  pillar          text not null default 'akce',
  starts_on       date,
  ends_on         date,
  status          text not null default 'active' check (status in ('draft', 'active', 'paused', 'finished', 'archived')),
  -- Automatické publikování je VĚDOMÉ nastavení konkrétní kampaně.
  -- Výchozí je vypnuto a nic jiného ho nezapne.
  auto_publish    boolean not null default false,
  created_by      uuid references marketing.profiles(user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_campaigns_updated before update on marketing.campaigns
  for each row execute function marketing.set_updated_at();

create table marketing.content_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references marketing.organizations(id) on delete cascade,
  venue_id            uuid not null references marketing.venues(id) on delete cascade,
  campaign_id         uuid references marketing.campaigns(id) on delete set null,
  template_id         uuid references marketing.templates(id) on delete set null,
  menu_id             uuid references marketing.menus(id) on delete set null,
  title               text not null default '',
  -- účel / šablona: denni_menu, vikendove_menu, burger_vikend, sportovni_prenos, volne…
  purpose             text not null default 'volne',
  pillar              text not null default 'menu',
  status              text not null default 'draft' check (status in (
                        'idea', 'draft', 'generating', 'preview_ready', 'changes_requested',
                        'awaiting_approval', 'approved', 'scheduled', 'publishing', 'published',
                        'generation_failed', 'render_failed', 'publish_failed', 'connection_required',
                        'cancelled', 'archived')),
  current_version_id  uuid,
  approved_version_id uuid,
  -- Termín: okamžik (timestamptz) + pásmo provozovny pro zobrazení
  scheduled_at        timestamptz,
  channels            text[] not null default array['instagram', 'facebook']::text[],
  is_evergreen        boolean not null default false,
  created_by          uuid references marketing.profiles(user_id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create trigger trg_content_items_updated before update on marketing.content_items
  for each row execute function marketing.set_updated_at();

create index content_items_venue_idx on marketing.content_items (venue_id, status, scheduled_at);
create index content_items_calendar_idx on marketing.content_items (organization_id, scheduled_at);

create table marketing.content_versions (
  id                    uuid primary key default gen_random_uuid(),
  content_item_id       uuid not null references marketing.content_items(id) on delete cascade,
  version               integer not null,
  brief                 text not null default '',
  -- Vyplněné vstupy šablony
  inputs                jsonb not null default '{}'::jsonb,
  -- Validovaný návrh AI (varianty, storyboard, vysvětlení)
  ai_proposal           jsonb,
  selected_variant_key  text,
  -- {instagram: {caption, hashtags, cta}, facebook: {…}}
  texts                 jsonb not null default '{}'::jsonb,
  storyboard            jsonb,
  media_asset_ids       uuid[] not null default array[]::uuid[],
  cover_asset_id        uuid references marketing.media_assets(id) on delete set null,
  -- Otisk celého obsahu verze; na něj se váže schválení.
  checksum              text not null,
  change_note           text not null default '',
  ai_model              text,
  ai_prompt_version     text,
  ai_cost_estimate_cents integer,
  ai_generated_at       timestamptz,
  created_by            uuid references marketing.profiles(user_id),
  created_at            timestamptz not null default now(),
  unique (content_item_id, version)
);

alter table marketing.content_items
  add constraint content_items_current_version_fk
  foreign key (current_version_id) references marketing.content_versions(id) on delete set null;
alter table marketing.content_items
  add constraint content_items_approved_version_fk
  foreign key (approved_version_id) references marketing.content_versions(id) on delete set null;

create table marketing.content_variants (
  id                 uuid primary key default gen_random_uuid(),
  content_version_id uuid not null references marketing.content_versions(id) on delete cascade,
  channel            text not null check (channel in ('instagram', 'facebook', 'print', 'internal')),
  -- feed | carousel | story | reel | page_post | cover | thumbnail | pdf_a4 | pdf_a5
  format             text not null,
  -- {width, height, duration_seconds, aspect}
  spec               jsonb not null default '{}'::jsonb,
  caption_override   text,
  is_enabled         boolean not null default true,
  render_job_id      uuid,
  output_asset_id    uuid references marketing.media_assets(id) on delete set null,
  unique (content_version_id, channel, format)
);

create table marketing.comments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references marketing.organizations(id) on delete cascade,
  content_item_id    uuid not null references marketing.content_items(id) on delete cascade,
  content_version_id uuid references marketing.content_versions(id) on delete cascade,
  author_id          uuid references marketing.profiles(user_id),
  -- Ke které části: caption:instagram, scene:2, media, price…
  part               text,
  body               text not null,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index comments_item_idx on marketing.comments (content_item_id, created_at);


-- ---------------------------------------------------------------------
-- SCHVALOVÁNÍ — vázané na otisk verze
-- ---------------------------------------------------------------------

create table marketing.approval_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references marketing.organizations(id) on delete cascade,
  venue_id           uuid not null references marketing.venues(id) on delete cascade,
  content_item_id    uuid not null references marketing.content_items(id) on delete cascade,
  content_version_id uuid not null references marketing.content_versions(id) on delete cascade,
  version_checksum   text not null,
  summary            text not null default '',
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected', 'changes_requested', 'superseded')),
  requested_by       uuid references marketing.profiles(user_id),
  requested_at       timestamptz not null default now(),
  resolved_at        timestamptz
);

create index approval_requests_item_idx on marketing.approval_requests (content_item_id, requested_at desc);

create table marketing.approval_decisions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references marketing.organizations(id) on delete cascade,
  approval_request_id uuid not null references marketing.approval_requests(id) on delete cascade,
  decided_by          uuid references marketing.profiles(user_id),
  decision            text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  comment             text not null default '',
  version_checksum    text not null,
  decided_at          timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- RENDER A PUBLIKACE — asynchronní úlohy s idempotencí
-- ---------------------------------------------------------------------

create table marketing.render_jobs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references marketing.organizations(id) on delete cascade,
  venue_id             uuid not null references marketing.venues(id) on delete cascade,
  content_version_id   uuid not null references marketing.content_versions(id) on delete cascade,
  variant_id           uuid references marketing.content_variants(id) on delete cascade,
  provider_key         text not null references marketing.provider_catalog(key),
  connection_id        uuid references marketing.integration_connections(id) on delete set null,
  mode                 text not null check (mode in ('customer_managed', 'foodtab_managed', 'manual_export', 'mock')),
  status               text not null default 'queued'
                         check (status in ('queued', 'submitted', 'rendering', 'done', 'failed', 'cancelled')),
  external_id          text,
  idempotency_key      text not null unique,
  request              jsonb not null default '{}'::jsonb,
  response             jsonb,
  output_asset_id      uuid references marketing.media_assets(id) on delete set null,
  error                text,
  attempts             integer not null default 0,
  max_attempts         integer not null default 3,
  next_attempt_at      timestamptz,
  cost_estimate_cents  integer,
  created_by           uuid references marketing.profiles(user_id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  finished_at          timestamptz
);

create trigger trg_render_jobs_updated before update on marketing.render_jobs
  for each row execute function marketing.set_updated_at();

alter table marketing.content_variants
  add constraint content_variants_render_job_fk
  foreign key (render_job_id) references marketing.render_jobs(id) on delete set null;

create table marketing.publish_jobs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references marketing.organizations(id) on delete cascade,
  venue_id            uuid not null references marketing.venues(id) on delete cascade,
  content_item_id     uuid not null references marketing.content_items(id) on delete cascade,
  content_version_id  uuid not null references marketing.content_versions(id) on delete cascade,
  version_checksum    text not null,
  approval_request_id uuid not null references marketing.approval_requests(id),
  variant_id          uuid references marketing.content_variants(id) on delete set null,
  social_account_id   uuid references marketing.social_accounts(id) on delete set null,
  channel             text not null check (channel in ('instagram', 'facebook')),
  format              text not null,
  provider_key        text not null references marketing.provider_catalog(key),
  connection_id       uuid references marketing.integration_connections(id) on delete set null,
  mode                text not null check (mode in ('customer_managed', 'foodtab_managed', 'manual_export', 'mock')),
  status              text not null default 'scheduled' check (status in (
                        'scheduled', 'queued', 'publishing', 'published', 'published_mock',
                        'manual_export', 'failed', 'dead_letter', 'cancelled')),
  scheduled_for       timestamptz not null,
  idempotency_key     text not null unique,
  attempts            integer not null default 0,
  max_attempts        integer not null default 5,
  next_attempt_at     timestamptz,
  last_error          text,
  external_post_id    text,
  response            jsonb,
  created_by          uuid references marketing.profiles(user_id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz
);

create trigger trg_publish_jobs_updated before update on marketing.publish_jobs
  for each row execute function marketing.set_updated_at();

create index publish_jobs_due_idx on marketing.publish_jobs (status, scheduled_for);

-- Ochrana před duplicitní publikací: jedna živá úloha na verzi + kanál + formát + účet.
create unique index publish_jobs_one_live_idx
  on marketing.publish_jobs (content_version_id, channel, format, coalesce(social_account_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('scheduled', 'queued', 'publishing', 'published', 'published_mock');

create table marketing.publications (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references marketing.organizations(id) on delete cascade,
  venue_id           uuid not null references marketing.venues(id) on delete cascade,
  content_item_id    uuid not null references marketing.content_items(id) on delete cascade,
  content_version_id uuid not null references marketing.content_versions(id) on delete cascade,
  publish_job_id     uuid not null unique references marketing.publish_jobs(id) on delete cascade,
  social_account_id  uuid references marketing.social_accounts(id) on delete set null,
  channel            text not null,
  format             text not null,
  external_post_id   text,
  permalink          text,
  -- Mock publikace je vždy viditelně odlišená od skutečné.
  is_mock            boolean not null default false,
  published_at       timestamptz not null default now(),
  raw_response       jsonb
);

create table marketing.metric_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid not null references marketing.venues(id) on delete cascade,
  publication_id  uuid not null references marketing.publications(id) on delete cascade,
  captured_at     timestamptz not null default now(),
  source          text not null check (source in ('provider', 'mock', 'estimate')),
  is_estimate     boolean not null default false,
  metrics         jsonb not null default '{}'::jsonb
);

create index metric_snapshots_pub_idx on marketing.metric_snapshots (publication_id, captured_at desc);


-- ---------------------------------------------------------------------
-- AUTOMATIZACE, NÁPADY, NOTIFIKACE, UTM
-- ---------------------------------------------------------------------

create table marketing.automations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid not null references marketing.venues(id) on delete cascade,
  -- daily_story_from_menu | weekend_menu_promo | evergreen_queue | recurring_campaign | series
  kind            text not null,
  name            text not null,
  is_enabled      boolean not null default false,
  owner_id        uuid references marketing.profiles(user_id),
  config          jsonb not null default '{}'::jsonb,
  schedule        text not null default '',
  last_run_at     timestamptz,
  last_result     text,
  next_run_at     timestamptz,
  run_history     jsonb not null default '[]'::jsonb,
  paused_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_automations_updated before update on marketing.automations
  for each row execute function marketing.set_updated_at();

create table marketing.ideas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid not null references marketing.venues(id) on delete cascade,
  text            text not null,
  pillar          text not null default 'akce',
  media_asset_ids uuid[] not null default array[]::uuid[],
  status          text not null default 'new' check (status in ('new', 'used', 'dismissed')),
  created_by      uuid references marketing.profiles(user_id),
  created_at      timestamptz not null default now()
);

create table marketing.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  user_id         uuid not null references marketing.profiles(user_id) on delete cascade,
  kind            text not null,
  title           text not null,
  body            text not null default '',
  link            text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_user_idx on marketing.notifications (user_id, read_at, created_at desc);

create table marketing.utm_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid not null references marketing.venues(id) on delete cascade,
  content_item_id uuid references marketing.content_items(id) on delete set null,
  target_url      text not null,
  utm             jsonb not null default '{}'::jsonb,
  short_code      text not null unique,
  clicks          integer not null default 0,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- SPOUŠTĚ — pravidla, která aplikace nemůže obejít
-- ---------------------------------------------------------------------

-- Nová verze: stane se aktuální, zruší schválení a naplánované publikace.
create or replace function marketing.on_content_version_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from marketing.content_items where id = new.content_item_id;

  update marketing.content_items
     set current_version_id = new.id,
         approved_version_id = null,
         status = case when v_status in ('approved', 'scheduled', 'awaiting_approval', 'publishing',
                                        'published', 'changes_requested', 'preview_ready')
                       then 'draft' else v_status end
   where id = new.content_item_id;

  update marketing.approval_requests
     set status = 'superseded', resolved_at = now()
   where content_item_id = new.content_item_id and status in ('pending', 'approved');

  update marketing.publish_jobs
     set status = 'cancelled', last_error = 'Vznikla nová verze obsahu; schválení už neplatí.'
   where content_item_id = new.content_item_id and status in ('scheduled', 'queued');

  return new;
end $$;

create trigger trg_content_version_insert after insert on marketing.content_versions
  for each row execute function marketing.on_content_version_insert();

-- Verze se nepřepisuje. Jediné, co se u ní smí měnit, je nic.
create or replace function marketing.forbid_version_update()
returns trigger language plpgsql
as $$
begin
  raise exception 'Verze obsahu se neupravuje — vytvořte novou verzi' using errcode = 'check_violation';
end $$;

create trigger trg_content_versions_immutable before update on marketing.content_versions
  for each row execute function marketing.forbid_version_update();

-- Rozhodnutí schvalovatele: propíše stav do žádosti a do obsahu.
-- Schválení platí jen pro verzi, jejíž otisk se shoduje s otiskem
-- v žádosti i v rozhodnutí — jinak se odmítne.
create or replace function marketing.on_approval_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r marketing.approval_requests%rowtype;
  v_current uuid;
  v_checksum text;
begin
  select * into r from marketing.approval_requests where id = new.approval_request_id;
  if r.status <> 'pending' then
    raise exception 'Žádost o schválení už není otevřená' using errcode = 'check_violation';
  end if;
  select current_version_id into v_current from marketing.content_items where id = r.content_item_id;
  select checksum into v_checksum from marketing.content_versions where id = r.content_version_id;
  if v_current <> r.content_version_id or v_checksum <> r.version_checksum or new.version_checksum <> r.version_checksum then
    raise exception 'Obsah se od žádosti změnil; schválení starší verze neplatí' using errcode = 'check_violation';
  end if;

  update marketing.approval_requests set status = new.decision, resolved_at = now() where id = r.id;

  update marketing.content_items
     set status = case new.decision
                    when 'approved' then 'approved'
                    when 'rejected' then 'changes_requested'
                    else 'changes_requested' end,
         approved_version_id = case when new.decision = 'approved' then r.content_version_id else null end
   where id = r.content_item_id;

  return new;
end $$;

create trigger trg_approval_decision after insert on marketing.approval_decisions
  for each row execute function marketing.on_approval_decision();

-- Publikační úloha bez platného schválení PŘESNÉ verze nevznikne.
create or replace function marketing.guard_publish_job()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r marketing.approval_requests%rowtype;
  v_approved uuid;
  v_checksum text;
begin
  select * into r from marketing.approval_requests where id = new.approval_request_id;
  select approved_version_id into v_approved from marketing.content_items where id = new.content_item_id;
  select checksum into v_checksum from marketing.content_versions where id = new.content_version_id;

  if r.id is null or r.status <> 'approved'
     or r.content_version_id <> new.content_version_id
     or v_approved is distinct from new.content_version_id
     or v_checksum <> new.version_checksum
     or r.version_checksum <> new.version_checksum then
    raise exception 'Bez platného schválení této verze nelze publikovat' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_guard_publish_job before insert on marketing.publish_jobs
  for each row execute function marketing.guard_publish_job();

-- Stav obsahu: povolené přechody. Ne každý stav vede kamkoli.
create or replace function marketing.guard_content_status()
returns trigger language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'scheduled' and new.approved_version_id is null then
    raise exception 'Naplánovat lze jen schválený obsah' using errcode = 'check_violation';
  end if;
  if new.status in ('publishing', 'published') and new.approved_version_id is null then
    raise exception 'Publikovat lze jen schválený obsah' using errcode = 'check_violation';
  end if;
  if new.status = 'approved' and old.status not in ('awaiting_approval', 'approved') then
    raise exception 'Schválení musí projít žádostí o schválení' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_guard_content_status before update on marketing.content_items
  for each row execute function marketing.guard_content_status();


-- ---------------------------------------------------------------------
-- GRANTY A RLS
-- ---------------------------------------------------------------------

grant select, insert, update on marketing.media_collections to authenticated;
grant select, insert, update on marketing.media_assets to authenticated;
grant select, insert, delete on marketing.media_tags to authenticated;
grant select, insert, update on marketing.brand_kits to authenticated;
grant select, insert, update on marketing.templates to authenticated;
grant select, insert on marketing.template_versions to authenticated;
grant select, insert, update, delete on marketing.venue_template_defaults to authenticated;
grant select, insert, update on marketing.menus to authenticated;
grant select, insert, update, delete on marketing.menu_days to authenticated;
grant select, insert, update, delete on marketing.menu_items to authenticated;
grant select, insert, update on marketing.campaigns to authenticated;
grant select, insert, update on marketing.content_items to authenticated;
grant select, insert on marketing.content_versions to authenticated;
grant select, insert, update, delete on marketing.content_variants to authenticated;
grant select, insert, update on marketing.comments to authenticated;
grant select, insert, update on marketing.approval_requests to authenticated;
grant select, insert on marketing.approval_decisions to authenticated;
grant select, insert, update on marketing.render_jobs to authenticated;
grant select, insert, update on marketing.publish_jobs to authenticated;
grant select, insert on marketing.publications to authenticated;
grant select, insert on marketing.metric_snapshots to authenticated;
grant select, insert, update on marketing.automations to authenticated;
grant select, insert, update on marketing.ideas to authenticated;
grant select, insert, update on marketing.notifications to authenticated;
grant select, insert, update on marketing.utm_links to authenticated;
grant all on all tables in schema marketing to service_role;

alter table marketing.media_collections      enable row level security;
alter table marketing.media_assets           enable row level security;
alter table marketing.media_tags             enable row level security;
alter table marketing.brand_kits             enable row level security;
alter table marketing.templates              enable row level security;
alter table marketing.template_versions      enable row level security;
alter table marketing.venue_template_defaults enable row level security;
alter table marketing.menus                  enable row level security;
alter table marketing.menu_days              enable row level security;
alter table marketing.menu_items             enable row level security;
alter table marketing.campaigns              enable row level security;
alter table marketing.content_items          enable row level security;
alter table marketing.content_versions       enable row level security;
alter table marketing.content_variants       enable row level security;
alter table marketing.comments               enable row level security;
alter table marketing.approval_requests      enable row level security;
alter table marketing.approval_decisions     enable row level security;
alter table marketing.render_jobs            enable row level security;
alter table marketing.publish_jobs           enable row level security;
alter table marketing.publications           enable row level security;
alter table marketing.metric_snapshots       enable row level security;
alter table marketing.automations            enable row level security;
alter table marketing.ideas                  enable row level security;
alter table marketing.notifications          enable row level security;
alter table marketing.utm_links              enable row level security;

-- Média
create policy media_collections_select on marketing.media_collections for select to authenticated
  using (marketing.can_read(organization_id, 'media.read', venue_id));
create policy media_collections_write on marketing.media_collections for insert to authenticated
  with check (marketing.can_write(organization_id, 'media.manage', venue_id));
create policy media_collections_update on marketing.media_collections for update to authenticated
  using (marketing.can_write(organization_id, 'media.manage', venue_id))
  with check (marketing.can_write(organization_id, 'media.manage', venue_id));

create policy media_assets_select on marketing.media_assets for select to authenticated
  using (marketing.can_read(organization_id, 'media.read', venue_id));
create policy media_assets_insert on marketing.media_assets for insert to authenticated
  with check (marketing.can_write(organization_id, 'media.manage', venue_id));
create policy media_assets_update on marketing.media_assets for update to authenticated
  using (marketing.can_write(organization_id, 'media.manage', venue_id))
  with check (marketing.can_write(organization_id, 'media.manage', venue_id));

-- Přesun mezi provozovnami (nebo do sdílených) jen s media.share.
-- Politika nevidí starý řádek, spoušť ano.
create or replace function marketing.guard_media_move()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.venue_id is distinct from old.venue_id
     and not marketing.has_access(new.organization_id, 'media.share', null) then
    raise exception 'Přesun média mezi provozovnami vyžaduje oprávnění sdílet média' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_guard_media_move before update of venue_id on marketing.media_assets
  for each row execute function marketing.guard_media_move();

create policy media_tags_select on marketing.media_tags for select to authenticated
  using (exists (select 1 from marketing.media_assets a where a.id = asset_id
                 and marketing.can_read(a.organization_id, 'media.read', a.venue_id)));
create policy media_tags_write on marketing.media_tags for all to authenticated
  using (exists (select 1 from marketing.media_assets a where a.id = asset_id
                 and marketing.can_write(a.organization_id, 'media.manage', a.venue_id)))
  with check (exists (select 1 from marketing.media_assets a where a.id = asset_id
                 and marketing.can_write(a.organization_id, 'media.manage', a.venue_id)));

-- Brand kit
create policy brand_kits_select on marketing.brand_kits for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy brand_kits_insert on marketing.brand_kits for insert to authenticated
  with check (marketing.can_write(organization_id, 'brand.manage', venue_id));
create policy brand_kits_update on marketing.brand_kits for update to authenticated
  using (marketing.can_write(organization_id, 'brand.manage', venue_id))
  with check (marketing.can_write(organization_id, 'brand.manage', venue_id));

-- Šablony: globální (organization_id NULL) čte každý přihlášený,
-- vlastní jen členové organizace.
create policy templates_select on marketing.templates for select to authenticated
  using (organization_id is null or marketing.can_read(organization_id, 'content.read', venue_id));
create policy templates_insert on marketing.templates for insert to authenticated
  with check (organization_id is not null and marketing.can_write(organization_id, 'templates.manage', venue_id));
create policy templates_update on marketing.templates for update to authenticated
  using (organization_id is not null and marketing.can_write(organization_id, 'templates.manage', venue_id))
  with check (organization_id is not null and marketing.can_write(organization_id, 'templates.manage', venue_id));

create policy template_versions_select on marketing.template_versions for select to authenticated
  using (exists (select 1 from marketing.templates t where t.id = template_id
                 and (t.organization_id is null or marketing.can_read(t.organization_id, 'content.read', t.venue_id))));
create policy template_versions_insert on marketing.template_versions for insert to authenticated
  with check (exists (select 1 from marketing.templates t where t.id = template_id
                 and t.organization_id is not null and marketing.can_write(t.organization_id, 'templates.manage', t.venue_id)));

create policy venue_template_defaults_select on marketing.venue_template_defaults for select to authenticated
  using (exists (select 1 from marketing.venues v where v.id = venue_id
                 and marketing.can_read(v.organization_id, 'content.read', v.id)));
create policy venue_template_defaults_write on marketing.venue_template_defaults for all to authenticated
  using (exists (select 1 from marketing.venues v where v.id = venue_id
                 and marketing.can_write(v.organization_id, 'templates.manage', v.id)))
  with check (exists (select 1 from marketing.venues v where v.id = venue_id
                 and marketing.can_write(v.organization_id, 'templates.manage', v.id)));

-- Menu
create policy menus_select on marketing.menus for select to authenticated
  using (marketing.can_read(organization_id, 'menu.read', venue_id));
create policy menus_insert on marketing.menus for insert to authenticated
  with check (marketing.can_write(organization_id, 'menu.manage', venue_id));
create policy menus_update on marketing.menus for update to authenticated
  using (marketing.can_write(organization_id, 'menu.manage', venue_id))
  with check (marketing.can_write(organization_id, 'menu.manage', venue_id));

create policy menu_days_all on marketing.menu_days for all to authenticated
  using (exists (select 1 from marketing.menus m where m.id = menu_id
                 and marketing.can_read(m.organization_id, 'menu.read', m.venue_id)))
  with check (exists (select 1 from marketing.menus m where m.id = menu_id
                 and marketing.can_write(m.organization_id, 'menu.manage', m.venue_id)));
create policy menu_items_all on marketing.menu_items for all to authenticated
  using (exists (select 1 from marketing.menus m where m.id = menu_id
                 and marketing.can_read(m.organization_id, 'menu.read', m.venue_id)))
  with check (exists (select 1 from marketing.menus m where m.id = menu_id
                 and marketing.can_write(m.organization_id, 'menu.manage', m.venue_id)));

-- Kampaně a obsah
create policy campaigns_select on marketing.campaigns for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy campaigns_insert on marketing.campaigns for insert to authenticated
  with check (marketing.can_write(organization_id, 'campaigns.manage', venue_id));
create policy campaigns_update on marketing.campaigns for update to authenticated
  using (marketing.can_write(organization_id, 'campaigns.manage', venue_id))
  with check (marketing.can_write(organization_id, 'campaigns.manage', venue_id));

create policy content_items_select on marketing.content_items for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy content_items_insert on marketing.content_items for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.create', venue_id));
create policy content_items_update on marketing.content_items for update to authenticated
  using (marketing.can_write(organization_id, 'content.create', venue_id)
      or marketing.can_write(organization_id, 'content.approve', venue_id)
      or marketing.can_write(organization_id, 'content.schedule', venue_id)
      or marketing.can_write(organization_id, 'content.publish', venue_id))
  with check (marketing.can_write(organization_id, 'content.create', venue_id)
      or marketing.can_write(organization_id, 'content.approve', venue_id)
      or marketing.can_write(organization_id, 'content.schedule', venue_id)
      or marketing.can_write(organization_id, 'content.publish', venue_id));

create policy content_versions_select on marketing.content_versions for select to authenticated
  using (exists (select 1 from marketing.content_items i where i.id = content_item_id
                 and marketing.can_read(i.organization_id, 'content.read', i.venue_id)));
create policy content_versions_insert on marketing.content_versions for insert to authenticated
  with check (exists (select 1 from marketing.content_items i where i.id = content_item_id
                 and marketing.can_write(i.organization_id, 'content.create', i.venue_id)));

create policy content_variants_all on marketing.content_variants for all to authenticated
  using (exists (select 1 from marketing.content_versions v join marketing.content_items i on i.id = v.content_item_id
                 where v.id = content_version_id and marketing.can_read(i.organization_id, 'content.read', i.venue_id)))
  with check (exists (select 1 from marketing.content_versions v join marketing.content_items i on i.id = v.content_item_id
                 where v.id = content_version_id and marketing.can_write(i.organization_id, 'content.create', i.venue_id)));

create policy comments_select on marketing.comments for select to authenticated
  using (exists (select 1 from marketing.content_items i where i.id = content_item_id
                 and marketing.can_read(i.organization_id, 'content.read', i.venue_id)));
create policy comments_insert on marketing.comments for insert to authenticated
  with check (exists (select 1 from marketing.content_items i where i.id = content_item_id
                 and marketing.can_read(i.organization_id, 'content.read', i.venue_id)));
create policy comments_update on marketing.comments for update to authenticated
  using (author_id = (select auth.uid()) or marketing.has_access(organization_id, 'content.approve', null))
  with check (author_id = (select auth.uid()) or marketing.has_access(organization_id, 'content.approve', null));

-- Schvalování
create policy approval_requests_select on marketing.approval_requests for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy approval_requests_insert on marketing.approval_requests for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.create', venue_id));
create policy approval_requests_update on marketing.approval_requests for update to authenticated
  using (marketing.can_write(organization_id, 'content.create', venue_id)
      or marketing.can_write(organization_id, 'content.approve', venue_id))
  with check (marketing.can_write(organization_id, 'content.create', venue_id)
      or marketing.can_write(organization_id, 'content.approve', venue_id));

create policy approval_decisions_select on marketing.approval_decisions for select to authenticated
  using (exists (select 1 from marketing.approval_requests r where r.id = approval_request_id
                 and marketing.can_read(r.organization_id, 'content.read', r.venue_id)));
-- Rozhodnout smí jen content.approve — a jen na provozovně, kam vidí.
create policy approval_decisions_insert on marketing.approval_decisions for insert to authenticated
  with check (exists (select 1 from marketing.approval_requests r where r.id = approval_request_id
                 and marketing.can_write(r.organization_id, 'content.approve', r.venue_id)));

-- Render a publikace
create policy render_jobs_select on marketing.render_jobs for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy render_jobs_insert on marketing.render_jobs for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.create', venue_id));
create policy render_jobs_update on marketing.render_jobs for update to authenticated
  using (marketing.can_write(organization_id, 'content.create', venue_id))
  with check (marketing.can_write(organization_id, 'content.create', venue_id));

create policy publish_jobs_select on marketing.publish_jobs for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
-- Založit publikaci smí jen content.publish (spoušť navíc chce schválení).
create policy publish_jobs_insert on marketing.publish_jobs for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.publish', venue_id));
create policy publish_jobs_update on marketing.publish_jobs for update to authenticated
  using (marketing.can_write(organization_id, 'content.publish', venue_id)
      or marketing.can_write(organization_id, 'content.schedule', venue_id))
  with check (marketing.can_write(organization_id, 'content.publish', venue_id)
      or marketing.can_write(organization_id, 'content.schedule', venue_id));

create policy publications_select on marketing.publications for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy publications_insert on marketing.publications for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.publish', venue_id));

create policy metric_snapshots_select on marketing.metric_snapshots for select to authenticated
  using (marketing.can_read(organization_id, 'analytics.read', venue_id));
create policy metric_snapshots_insert on marketing.metric_snapshots for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.publish', venue_id));

-- Automatizace, nápady, notifikace, UTM
create policy automations_select on marketing.automations for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy automations_write on marketing.automations for insert to authenticated
  with check (marketing.can_write(organization_id, 'campaigns.manage', venue_id));
create policy automations_update on marketing.automations for update to authenticated
  using (marketing.can_write(organization_id, 'campaigns.manage', venue_id))
  with check (marketing.can_write(organization_id, 'campaigns.manage', venue_id));

create policy ideas_select on marketing.ideas for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy ideas_write on marketing.ideas for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.create', venue_id));
create policy ideas_update on marketing.ideas for update to authenticated
  using (marketing.can_write(organization_id, 'content.create', venue_id))
  with check (marketing.can_write(organization_id, 'content.create', venue_id));

create policy notifications_own on marketing.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark on marketing.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_insert on marketing.notifications for insert to authenticated
  with check (marketing.is_member(organization_id));

create policy utm_links_select on marketing.utm_links for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy utm_links_insert on marketing.utm_links for insert to authenticated
  with check (marketing.can_write(organization_id, 'content.create', venue_id));
create policy utm_links_update on marketing.utm_links for update to authenticated
  using (marketing.can_write(organization_id, 'content.create', venue_id))
  with check (marketing.can_write(organization_id, 'content.create', venue_id));

-- Audit kritických rozhodnutí — spouští
create trigger trg_audit_approval_decisions after insert on marketing.approval_decisions
  for each row execute function marketing.audit_trigger('approval_decision');
create trigger trg_audit_publish_jobs after insert or update on marketing.publish_jobs
  for each row execute function marketing.audit_trigger('publish_job');
create trigger trg_audit_publications after insert on marketing.publications
  for each row execute function marketing.audit_trigger('publication');
create trigger trg_audit_content_status after update of status, scheduled_at on marketing.content_items
  for each row execute function marketing.audit_trigger('content_item');
