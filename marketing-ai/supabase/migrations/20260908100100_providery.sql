-- =====================================================================
-- FoodTab Marketing AI — katalog poskytovatelů a zákaznická připojení
--
-- Tři vrstvy, které se schválně nemíchají:
--
--   1. provider_catalog / provider_capabilities — co FoodTab UMÍ nabídnout.
--      Globální data, stejná pro všechny. Řádek v katalogu NIC nepřipojuje
--      a nesmí předstírat funkční integraci: `implementation_status`
--      říká, jestli adaptér v kódu skutečně existuje a je otestovaný.
--
--   2. organization_provider_preferences — co si organizace (nebo
--      provozovna) VYBRALA pro danou schopnost. Volba, ne připojení.
--
--   3. integration_connections — konkrétní PŘIPOJENÝ účet. Tajemství
--      bydlí odděleně v integration_secrets, kam `authenticated` nevidí
--      vůbec; čte se jen přes funkci a jen šifrované.
--
-- Funkce aplikace se zapínají podle skutečných capabilities připojeného
-- poskytovatele, ne podle jeho jména.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KATALOG
-- ---------------------------------------------------------------------

create table marketing.provider_catalog (
  key                   text primary key,
  category              text not null check (category in (
                          'ai_generation', 'image_rendering', 'video_rendering', 'voiceover',
                          'workflow_automation', 'social_publishing', 'analytics', 'notifications',
                          'external_storage', 'menu_source')),
  name                  text not null,
  vendor                text not null,
  description           text not null,
  -- Doporučeno FoodTabem / Jiná podporovaná možnost / Připravujeme
  recommendation        text not null check (recommendation in ('foodtab_recommended', 'supported', 'planned')),
  -- implemented = adaptér v kódu existuje a má test; planned = jen položka
  implementation_status text not null check (implementation_status in ('implemented', 'planned')),
  -- Které režimy připojení dávají u nástroje smysl.
  connection_modes      text[] not null default array['customer_managed']::text[],
  -- api_key | oauth | webhook_secret | none
  auth_type             text not null check (auth_type in ('api_key', 'oauth', 'webhook_secret', 'none')),
  -- Kdo hradí poplatky: customer_pays_provider | included | free
  billing               text not null default 'customer_pays_provider'
                          check (billing in ('customer_pays_provider', 'included', 'free')),
  docs_url              text,
  pricing_url           text,
  -- Orientační cena — administrátorsky aktualizovatelná, s datem
  -- poslední kontroly. NIKDY není obchodní pravda v kódu.
  pricing_note          text,
  pricing_checked_at    date,
  -- Porovnání 1–5 (1 = nejnižší / nejjednodušší, 5 = nejvyšší)
  score_cost            smallint check (score_cost between 1 and 5),
  score_simplicity      smallint check (score_simplicity between 1 and 5),
  score_quality         smallint check (score_quality between 1 and 5),
  score_speed           smallint check (score_speed between 1 and 5),
  score_automation      smallint check (score_automation between 1 and 5),
  setup_complexity      smallint check (setup_complexity between 1 and 5),
  benefits              text[] not null default array[]::text[],
  limitations           text[] not null default array[]::text[],
  sort_order            integer not null default 0,
  updated_at            timestamptz not null default now()
);

create table marketing.provider_capabilities (
  provider_key text not null references marketing.provider_catalog(key) on delete cascade,
  capability   text not null,
  -- Pravdivý stav: available = funguje; partial = s omezením; planned = zatím ne.
  status       text not null default 'available' check (status in ('available', 'partial', 'planned')),
  note         text,
  primary key (provider_key, capability)
);

-- Katalog schopností, o které se aplikace ptá. Jméno je smlouva mezi
-- adaptérem a rozhraním; nové se přidává sem, ne do `if` v kódu.
create table marketing.capabilities (
  key         text primary key,
  category    text not null,
  description text not null
);

insert into marketing.capabilities (key, category, description) values
  ('text.caption',          'ai_generation',       'Popisek, hook, CTA a hashtagy'),
  ('text.storyboard',       'ai_generation',       'Storyboard videa po scénách'),
  ('text.variants',         'ai_generation',       'Více kreativních variant jednoho zadání'),
  ('text.revise',           'ai_generation',       'Přepracování jen dotčené části podle zpětné vazby'),
  ('menu.ocr',              'ai_generation',       'Rozpoznání menu z fotografie nebo PDF'),
  ('render.image',          'image_rendering',     'Statický obrázek (feed, story, cover, thumbnail)'),
  ('render.pdf',            'image_rendering',     'Tisková varianta A4/A5'),
  ('render.video',          'video_rendering',     'Video z fotografií a klipů (Reel)'),
  ('render.subtitles',      'video_rendering',     'Automatické české titulky'),
  ('render.audio_mix',      'video_rendering',     'Hudba a automatická hlasitost'),
  ('voice.cs',              'voiceover',           'Český voice-over'),
  ('workflow.trigger',      'workflow_automation', 'Spuštění dlouhého procesu mimo aplikaci'),
  ('workflow.callback',     'workflow_automation', 'Podepsaný návrat výsledku do aplikace'),
  ('publish.instagram.feed','social_publishing',   'Instagram feed příspěvek'),
  ('publish.instagram.carousel','social_publishing','Instagram carousel'),
  ('publish.instagram.reel','social_publishing',   'Instagram Reel'),
  ('publish.instagram.story','social_publishing',  'Instagram Story'),
  ('publish.facebook.post', 'social_publishing',   'Facebook Page příspěvek'),
  ('publish.facebook.reel', 'social_publishing',   'Facebook Reel'),
  ('publish.schedule',      'social_publishing',   'Naplánování na straně poskytovatele'),
  ('metrics.basic',         'analytics',           'Dosah, reakce, komentáře, uložení'),
  ('metrics.video',         'analytics',           'Přehrání a doba sledování'),
  ('notify.email',          'notifications',       'E-mailové upozornění'),
  ('notify.push',           'notifications',       'Push / chat upozornění'),
  ('storage.external',      'external_storage',    'Externí úložiště médií'),
  ('menu.source',           'menu_source',         'Načtení schváleného menu z externího systému');

alter table marketing.provider_capabilities
  add constraint provider_capabilities_capability_fk
  foreign key (capability) references marketing.capabilities(key);


-- ---------------------------------------------------------------------
-- VOLBA ORGANIZACE / PROVOZOVNY
-- ---------------------------------------------------------------------

create table marketing.organization_provider_preferences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  -- NULL = platí pro celou organizaci; provozovna volbu přebíjí.
  venue_id        uuid references marketing.venues(id) on delete cascade,
  category        text not null,
  provider_key    text not null references marketing.provider_catalog(key),
  connection_id   uuid,
  is_active       boolean not null default true,
  set_by          uuid references marketing.profiles(user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_provider_prefs_updated before update on marketing.organization_provider_preferences
  for each row execute function marketing.set_updated_at();

-- Nejvýš jedna aktivní volba na kategorii a rozsah. NULL provozovna se
-- řeší pevnou náhradou, jinak by NULL <> NULL dovolilo víc řádků.
create unique index provider_prefs_one_active
  on marketing.organization_provider_preferences (
    organization_id,
    coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
    category
  ) where is_active;


-- ---------------------------------------------------------------------
-- PŘIPOJENÍ
-- ---------------------------------------------------------------------

create table marketing.integration_connections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references marketing.organizations(id) on delete cascade,
  venue_id         uuid references marketing.venues(id) on delete cascade,
  provider_key     text not null references marketing.provider_catalog(key),
  -- customer_managed | foodtab_managed | manual_export | mock
  mode             text not null check (mode in ('customer_managed', 'foodtab_managed', 'manual_export', 'mock')),
  status           text not null default 'not_connected'
                     check (status in ('not_connected', 'connecting', 'connected', 'needs_attention', 'error', 'revoked')),
  display_name     text not null default '',
  -- Bezpečná metadata o připojeném účtu (jméno stránky, uživatelské
  -- jméno, ID). Nikdy token.
  external_account jsonb not null default '{}'::jsonb,
  granted_scopes   text[] not null default array[]::text[],
  -- Odkaz do integration_secrets; samotné tajemství tu není.
  secret_ref       uuid,
  expires_at       timestamptz,
  last_test_at     timestamptz,
  last_test_ok     boolean,
  last_error       text,
  -- Limity a využití si každé připojení nese zvlášť (odhad, ne účtování).
  limits           jsonb not null default '{}'::jsonb,
  connected_by     uuid references marketing.profiles(user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  revoked_at       timestamptz
);

create trigger trg_connections_updated before update on marketing.integration_connections
  for each row execute function marketing.set_updated_at();

create index connections_org_idx on marketing.integration_connections (organization_id, provider_key);

alter table marketing.organization_provider_preferences
  add constraint provider_prefs_connection_fk
  foreign key (connection_id) references marketing.integration_connections(id) on delete set null;

-- Tajemství: vlastní tabulka, ŽÁDNÝ grant pro authenticated, RLS bez
-- politik. Jediná cesta dovnitř i ven jsou dvě funkce níže. Hodnota je
-- šifrovaná aplikací (CREDENTIALS_ENCRYPTION_KEY) — databáze vidí jen
-- ciphertext, takže ani záloha databáze neobsahuje čitelný token.
create table marketing.integration_secrets (
  id              uuid primary key default gen_random_uuid(),
  connection_id   uuid not null unique references marketing.integration_connections(id) on delete cascade,
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  ciphertext      text not null,
  key_version     integer not null default 1,
  -- Otisk tajemství — pro porovnání „je to pořád ten samý klíč?“ bez čtení.
  fingerprint     text not null,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz
);

create or replace function marketing.store_secret(p_connection uuid, p_ciphertext text, p_fingerprint text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from marketing.integration_connections where id = p_connection;
  if v_org is null or not marketing.has_access(v_org, 'integrations.manage', null) then
    raise exception 'Nemáte oprávnění ukládat přístupové údaje' using errcode = 'insufficient_privilege';
  end if;
  insert into marketing.integration_secrets (connection_id, organization_id, ciphertext, fingerprint)
  values (p_connection, v_org, p_ciphertext, p_fingerprint)
  on conflict (connection_id) do update
    set ciphertext = excluded.ciphertext, fingerprint = excluded.fingerprint,
        key_version = marketing.integration_secrets.key_version + 1, rotated_at = now();
  update marketing.integration_connections set secret_ref = (
    select id from marketing.integration_secrets where connection_id = p_connection
  ) where id = p_connection;
  perform marketing.audit(v_org, null, 'integration.secret_stored', 'integration_connection', p_connection::text,
                          jsonb_build_object('fingerprint', p_fingerprint));
end $$;

-- Čtení: jen kdo smí nástroj používat, jen v rámci vlastní organizace.
-- Vrací ciphertext — dešifruje server, nikdy prohlížeč.
create or replace function marketing.read_secret(p_connection uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_ct  text;
begin
  select organization_id into v_org from marketing.integration_connections where id = p_connection;
  if v_org is null or not (marketing.has_access(v_org, 'integrations.use', null)
                           or marketing.has_access(v_org, 'integrations.manage', null)) then
    raise exception 'Nemáte oprávnění číst přístupové údaje' using errcode = 'insufficient_privilege';
  end if;
  select ciphertext into v_ct from marketing.integration_secrets where connection_id = p_connection;
  return v_ct;
end $$;

create or replace function marketing.delete_secret(p_connection uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from marketing.integration_connections where id = p_connection;
  if v_org is null or not marketing.has_access(v_org, 'integrations.manage', null) then
    raise exception 'Nemáte oprávnění odvolat přístupové údaje' using errcode = 'insufficient_privilege';
  end if;
  delete from marketing.integration_secrets where connection_id = p_connection;
  update marketing.integration_connections set secret_ref = null, status = 'revoked', revoked_at = now()
  where id = p_connection;
  perform marketing.audit(v_org, null, 'integration.secret_deleted', 'integration_connection', p_connection::text);
end $$;

grant execute on function marketing.store_secret(uuid, text, text), marketing.read_secret(uuid),
  marketing.delete_secret(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- SOCIÁLNÍ ÚČTY (Facebook Page, Instagram profesionální účet)
-- ---------------------------------------------------------------------

create table marketing.social_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid references marketing.venues(id) on delete cascade,
  connection_id   uuid not null references marketing.integration_connections(id) on delete cascade,
  platform        text not null check (platform in ('instagram', 'facebook')),
  -- page | ig_business | ig_creator
  kind            text not null,
  external_id     text not null,
  name            text not null,
  username        text,
  -- Co poskytovatel pro tenhle účet opravdu povolil.
  capabilities    text[] not null default array[]::text[],
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (connection_id, platform, external_id)
);

create index social_accounts_venue_idx on marketing.social_accounts (venue_id);


-- ---------------------------------------------------------------------
-- VYUŽITÍ A NÁKLADY — odděleně za organizaci, provozovnu, poskytovatele
-- ---------------------------------------------------------------------

create table marketing.provider_usage_records (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references marketing.organizations(id) on delete cascade,
  venue_id             uuid references marketing.venues(id) on delete set null,
  provider_key         text not null references marketing.provider_catalog(key),
  connection_id        uuid references marketing.integration_connections(id) on delete set null,
  capability           text not null,
  units                numeric not null default 1,
  unit                 text not null default 'request',
  -- Odhad v haléřích; NULL = poskytovatel neumožňuje spočítat.
  estimated_cost_cents integer,
  currency             text not null default 'CZK',
  is_estimate          boolean not null default true,
  ref_type             text,
  ref_id               text,
  occurred_at          timestamptz not null default now()
);

create index usage_org_period_idx on marketing.provider_usage_records (organization_id, occurred_at desc);


-- ---------------------------------------------------------------------
-- WEBHOOKY — idempotentně, podle externího ID
-- ---------------------------------------------------------------------

create table marketing.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider_key      text not null,
  external_event_id text not null,
  signature_ok      boolean not null default false,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  result            text,
  unique (provider_key, external_event_id)
);


-- ---------------------------------------------------------------------
-- GRANTY A RLS
-- ---------------------------------------------------------------------

grant select on marketing.provider_catalog, marketing.provider_capabilities, marketing.capabilities to authenticated;
grant select, insert, update on marketing.organization_provider_preferences to authenticated;
grant select, insert, update on marketing.integration_connections to authenticated;
grant select, insert, update on marketing.social_accounts to authenticated;
grant select, insert on marketing.provider_usage_records to authenticated;
-- webhook_events a integration_secrets: pro authenticated NIC.
grant all on all tables in schema marketing to service_role;

alter table marketing.provider_catalog       enable row level security;
alter table marketing.provider_capabilities  enable row level security;
alter table marketing.capabilities           enable row level security;
alter table marketing.organization_provider_preferences enable row level security;
alter table marketing.integration_connections enable row level security;
alter table marketing.integration_secrets    enable row level security;
alter table marketing.social_accounts        enable row level security;
alter table marketing.provider_usage_records enable row level security;
alter table marketing.webhook_events         enable row level security;

create policy catalog_read on marketing.provider_catalog for select to authenticated using (true);
create policy provider_capabilities_read on marketing.provider_capabilities for select to authenticated using (true);
create policy capabilities_read on marketing.capabilities for select to authenticated using (true);

create policy provider_prefs_select on marketing.organization_provider_preferences for select to authenticated
  using (marketing.is_member(organization_id));
create policy provider_prefs_write on marketing.organization_provider_preferences for insert to authenticated
  with check (marketing.has_access(organization_id, 'integrations.manage', null));
create policy provider_prefs_update on marketing.organization_provider_preferences for update to authenticated
  using (marketing.has_access(organization_id, 'integrations.manage', null))
  with check (marketing.has_access(organization_id, 'integrations.manage', null));

-- Připojení vidí, kdo je smí používat nebo spravovat. Cizí organizace
-- nevidí nic — ani že připojení existuje.
-- Připojení na úrovni organizace (venue_id NULL) vidí každý, kdo smí
-- nástroje používat — i člen s rozsahem jen na provozovny. Pobočkové
-- připojení jen ten, kdo na pobočku vidí. Spravovat smí jen
-- integrations.manage s rozsahem organizace.
create policy connections_select on marketing.integration_connections for select to authenticated
  using (marketing.can_read(organization_id, 'integrations.use', venue_id)
      or marketing.has_access(organization_id, 'integrations.manage', null));
create policy connections_insert on marketing.integration_connections for insert to authenticated
  with check (marketing.has_access(organization_id, 'integrations.manage', null));
create policy connections_update on marketing.integration_connections for update to authenticated
  using (marketing.has_access(organization_id, 'integrations.manage', null))
  with check (marketing.has_access(organization_id, 'integrations.manage', null));

create policy social_accounts_select on marketing.social_accounts for select to authenticated
  using (marketing.can_read(organization_id, 'content.read', venue_id));
create policy social_accounts_write on marketing.social_accounts for insert to authenticated
  with check (marketing.has_access(organization_id, 'integrations.manage', null));
create policy social_accounts_update on marketing.social_accounts for update to authenticated
  using (marketing.has_access(organization_id, 'integrations.manage', null))
  with check (marketing.has_access(organization_id, 'integrations.manage', null));

create policy usage_select on marketing.provider_usage_records for select to authenticated
  using (marketing.has_access(organization_id, 'analytics.read', null)
      or marketing.has_access(organization_id, 'integrations.manage', null));
create policy usage_insert on marketing.provider_usage_records for insert to authenticated
  with check (marketing.is_member(organization_id));

-- Audit připojení: spouští, ne dobrá vůle aplikace.
create trigger trg_audit_connections after insert or update or delete on marketing.integration_connections
  for each row execute function marketing.audit_trigger('integration_connection');
create trigger trg_audit_provider_prefs after insert or update on marketing.organization_provider_preferences
  for each row execute function marketing.audit_trigger('provider_preference');
