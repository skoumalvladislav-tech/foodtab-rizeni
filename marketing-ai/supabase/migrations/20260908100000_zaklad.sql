-- =====================================================================
-- FoodTab Marketing AI — základ: organizace, provozovny, lidé, role
--
-- Všechno bydlí ve vlastním schématu `marketing`. Důvod: aplikace vzniká
-- jako samostatný projekt, ale má se později vložit do FoodTab Řízení,
-- a ten už má vlastní `profiles`, `memberships`, `menus`, `audit_log`.
-- Vlastní schéma znamená, že se při sloučení nic nepřejmenovává —
-- jen se `marketing.organizations` nahradí pohledem na `public.tenants`
-- a `marketing.venues` pohledem na `public.branches`
-- (docs/FOODTAB_INTEGRATION.md).
--
-- Názvosloví: organizace = firma (FoodTab `tenant`), provozovna =
-- pobočka (FoodTab `branch`). Sloupce `foodtab_tenant_id` a
-- `foodtab_branch_id` jsou na tu vazbu připravené už teď.
--
-- Pravidla přebíráme z FoodTabu:
--   * o přístupu rozhoduje JEDNO místo: marketing.has_access(org, právo, provozovna)
--   * role a oprávnění jsou data organizace, ne kód
--   * každá tabulka má organization_id, zapnuté RLS a politiku
--   * rozsah z prohlížeče je návrh, ne oprávnění — ověřuje se proti členství
--   * mazání lidí je označení, ne výmaz
-- =====================================================================

create schema marketing;

grant usage on schema marketing to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Pomocné funkce pro čas — všechny časy jsou timestamptz, "hodina na
-- zdi" se převádí přes pásmo provozovny (nikdy new Date('…T22:00')).
-- ---------------------------------------------------------------------

create or replace function marketing.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- ---------------------------------------------------------------------
-- ORGANIZACE A PROVOZOVNY
-- ---------------------------------------------------------------------

create table marketing.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Vazba na FoodTab Řízení (public.tenants.id). Vyplní se při propojení.
  foodtab_tenant_id  uuid,
  timezone           text not null default 'Europe/Prague',
  -- Odpovědi průvodce prvním spuštěním (priority, počet provozoven…).
  onboarding         jsonb not null default '{}'::jsonb,
  onboarding_done_at timestamptz,
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_organizations_updated before update on marketing.organizations
  for each row execute function marketing.set_updated_at();

create table marketing.venues (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references marketing.organizations(id) on delete cascade,
  name               text not null,
  slug               text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Vazba na FoodTab Řízení (public.branches.id).
  foodtab_branch_id  uuid,
  timezone           text,
  -- Barva provozovny v kalendáři a přepínači — klíč, ne odstín.
  color              text not null default 'slate'
                       check (color in ('slate','indigo','violet','sky','teal','amber','rose','copper','plum')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, slug)
);

create trigger trg_venues_updated before update on marketing.venues
  for each row execute function marketing.set_updated_at();

create index venues_org_idx on marketing.venues (organization_id);


-- ---------------------------------------------------------------------
-- LIDÉ
-- ---------------------------------------------------------------------

create table marketing.profiles (
  user_id      uuid primary key,
  email        text,
  phone        text,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_profiles_updated before update on marketing.profiles
  for each row execute function marketing.set_updated_at();


-- ---------------------------------------------------------------------
-- OPRÁVNĚNÍ A ROLE
--
-- `permissions` je katalog (stejný pro všechny), `roles` jsou řádky
-- organizace. Šest výchozích rolí ze zadání vzniká ze šablon při
-- založení organizace — potom si je organizace může upravit.
-- ---------------------------------------------------------------------

create table marketing.permissions (
  key         text primary key,
  description text not null,
  sort_order  integer not null default 0
);

insert into marketing.permissions (key, description, sort_order) values
  ('content.read',        'Vidět návrhy, kalendář a publikace',            10),
  ('content.create',      'Vytvářet a upravovat návrhy obsahu',            20),
  ('content.approve',     'Schvalovat, zamítat a vracet k úpravě',         30),
  ('content.schedule',    'Plánovat termín zveřejnění',                    40),
  ('content.publish',     'Zveřejňovat schválený obsah',                   50),
  ('media.read',          'Prohlížet mediální knihovnu',                   60),
  ('media.manage',        'Nahrávat, upravovat a archivovat média',        70),
  ('media.share',         'Přesouvat a sdílet média mezi provozovnami',    80),
  ('menu.read',           'Vidět menu',                                    90),
  ('menu.manage',         'Zadávat a importovat menu',                    100),
  ('templates.manage',    'Upravovat šablony a nastavovat výchozí',       110),
  ('brand.manage',        'Upravovat brand kit provozovny',               120),
  ('campaigns.manage',    'Spravovat kampaně a automatizace',             130),
  ('analytics.read',      'Vidět analytiku',                              140),
  ('integrations.use',    'Používat připojené nástroje při tvorbě',       150),
  ('integrations.manage', 'Připojovat, testovat a odpojovat nástroje',    160),
  ('team.manage',         'Spravovat členy a jejich oprávnění',           170),
  ('audit.read',          'Číst auditní přehled',                         180),
  ('settings.manage',     'Měnit nastavení organizace a provozoven',      190);

create table marketing.role_templates (
  key         text primary key,
  name        text not null,
  description text not null,
  is_owner    boolean not null default false,
  permissions text[] not null,
  sort_order  integer not null default 0
);

insert into marketing.role_templates (key, name, description, is_owner, permissions, sort_order) values
  ('owner', 'Vlastník', 'Vlastník organizace. Má všechno, včetně převodu vlastnictví.',
    true, array[]::text[], 10),
  ('admin', 'Správce', 'Správa provozoven, uživatelů a integrací.',
    false, array['content.read','content.create','content.approve','content.schedule','content.publish',
                 'media.read','media.manage','media.share','menu.read','menu.manage','templates.manage',
                 'brand.manage','campaigns.manage','analytics.read','integrations.use','integrations.manage',
                 'team.manage','audit.read','settings.manage'], 20),
  ('marketing_manager', 'Marketingový manažer', 'Tvorba, plánování a publikování.',
    false, array['content.read','content.create','content.approve','content.schedule','content.publish',
                 'media.read','media.manage','media.share','menu.read','menu.manage','templates.manage',
                 'brand.manage','campaigns.manage','analytics.read','integrations.use'], 30),
  ('editor', 'Editor', 'Tvorba a úpravy bez finálního schválení.',
    false, array['content.read','content.create','media.read','media.manage','menu.read','menu.manage',
                 'analytics.read','integrations.use'], 40),
  ('approver', 'Schvalovatel', 'Schválení nebo vrácení k úpravě.',
    false, array['content.read','content.approve','content.schedule','media.read','menu.read','analytics.read'], 50),
  ('viewer', 'Pozorovatel', 'Pouze náhled a analytika.',
    false, array['content.read','media.read','menu.read','analytics.read'], 60);

create table marketing.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  key             text not null,
  name            text not null,
  description     text not null default '',
  is_owner        boolean not null default false,
  sort_order      integer not null default 0,
  unique (organization_id, key)
);

create table marketing.role_permissions (
  role_id        uuid not null references marketing.roles(id) on delete cascade,
  permission_key text not null references marketing.permissions(key),
  primary key (role_id, permission_key)
);

create table marketing.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  user_id         uuid not null references marketing.profiles(user_id) on delete cascade,
  role_id         uuid not null references marketing.roles(id),
  -- 'organization' = vidí všechny provozovny; 'venues' = jen ty z venue_access
  scope           text not null default 'venues' check (scope in ('organization', 'venues')),
  status          text not null default 'active' check (status in ('active', 'suspended')),
  invited_by      uuid references marketing.profiles(user_id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, user_id)
);

create index memberships_user_idx on marketing.memberships (user_id);

create table marketing.venue_access (
  membership_id uuid not null references marketing.memberships(id) on delete cascade,
  venue_id      uuid not null references marketing.venues(id) on delete cascade,
  primary key (membership_id, venue_id)
);


-- ---------------------------------------------------------------------
-- ROZHODOVÁNÍ O PŘÍSTUPU — jediné místo
--
-- SECURITY DEFINER, aby politiky nečetly členství znovu přes RLS
-- (nekonečná rekurze). search_path prázdný, všechno kvalifikované.
-- ---------------------------------------------------------------------

create or replace function marketing.uid() returns uuid
language sql stable set search_path = ''
as $$ select auth.uid() $$;

create or replace function marketing.is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from marketing.memberships m
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org
      and m.status = 'active'
      and m.deleted_at is null
  );
$$;

create or replace function marketing.is_owner(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from marketing.memberships m
    join marketing.roles r on r.id = m.role_id
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org
      and m.status = 'active'
      and m.deleted_at is null
      and r.is_owner
  );
$$;

-- Provozovny, na které přihlášený uživatel vidí.
create or replace function marketing.visible_venue_ids(p_org uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select v.id
  from marketing.memberships m
  join marketing.venues v on v.organization_id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.organization_id = p_org
    and m.status = 'active'
    and m.deleted_at is null
    and (
      m.scope = 'organization'
      or exists (select 1 from marketing.venue_access va
                 where va.membership_id = m.id and va.venue_id = v.id)
    );
$$;

-- has_access(organizace, oprávnění, provozovna)
--   provozovna NULL = věc na úrovni organizace, vyžaduje rozsah 'organization'
--   jinak musí rozsah členství provozovnu pokrývat.
create or replace function marketing.has_access(p_org uuid, p_permission text, p_venue uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from marketing.memberships m
    join marketing.roles r on r.id = m.role_id
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org
      and m.status = 'active'
      and m.deleted_at is null
      and (
        r.is_owner
        or exists (select 1 from marketing.role_permissions rp
                   where rp.role_id = r.id and rp.permission_key = p_permission)
      )
      and (
        (p_venue is null and m.scope = 'organization')
        or (p_venue is not null and (
              m.scope = 'organization'
              or exists (select 1 from marketing.venue_access va
                         where va.membership_id = m.id and va.venue_id = p_venue)
        ))
      )
  );
$$;

-- Čtení věci, která visí na organizaci (venue NULL = sdílené) NEBO
-- na provozovně: sdílené vidí každý člen s právem, pobočkové jen ten,
-- kdo na pobočku vidí.
create or replace function marketing.can_read(p_org uuid, p_permission text, p_venue uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from marketing.memberships m
    join marketing.roles r on r.id = m.role_id
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org
      and m.status = 'active'
      and m.deleted_at is null
      and (
        r.is_owner
        or exists (select 1 from marketing.role_permissions rp
                   where rp.role_id = r.id and rp.permission_key = p_permission)
      )
      and (
        p_venue is null
        or m.scope = 'organization'
        or exists (select 1 from marketing.venue_access va
                   where va.membership_id = m.id and va.venue_id = p_venue)
      )
  );
$$;

-- Zápis do věci na organizaci nebo provozovně: sdílené (NULL) smí jen
-- rozsah 'organization', pobočkové podle rozsahu. Totéž co has_access,
-- jen pojmenované podle použití v politikách.
create or replace function marketing.can_write(p_org uuid, p_permission text, p_venue uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select marketing.has_access(p_org, p_permission, p_venue) $$;

grant execute on function marketing.uid(), marketing.is_member(uuid), marketing.is_owner(uuid),
  marketing.visible_venue_ids(uuid), marketing.has_access(uuid, text, uuid),
  marketing.can_read(uuid, text, uuid), marketing.can_write(uuid, text, uuid)
  to authenticated, service_role;


-- ---------------------------------------------------------------------
-- AUDIT
--
-- Zápis jde přes funkci (security definer), aby ho mohl udělat každý
-- přihlášený člen, ale nikdo nemohl řádky měnit ani mazat. Kritické
-- tabulky navíc píší do auditu spouští — aplikace to nemůže vynechat.
-- ---------------------------------------------------------------------

create table marketing.audit_logs (
  id              bigserial primary key,
  organization_id uuid not null references marketing.organizations(id) on delete cascade,
  venue_id        uuid references marketing.venues(id) on delete set null,
  actor_id        uuid,
  action          text not null,
  entity_type     text not null,
  entity_id       text,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index audit_logs_org_idx on marketing.audit_logs (organization_id, created_at desc);

create or replace function marketing.audit(
  p_org uuid, p_venue uuid, p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into marketing.audit_logs (organization_id, venue_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, p_venue, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

grant execute on function marketing.audit(uuid, uuid, text, text, text, jsonb) to authenticated, service_role;

-- Obecná spoušť pro kritické tabulky: zapíše starý a nový řádek bez
-- sloupců, které by do auditu nepatřily (tajemství se v těch tabulkách
-- nikdy neukládají, ale pro jistotu se odstraní i případný ciphertext).
create or replace function marketing.audit_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_org   uuid;
  v_venue uuid;
  v_id    text;
  v_new   jsonb;
  v_old   jsonb;
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'ciphertext' end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'ciphertext' end;
  v_org   := coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid);
  v_venue := coalesce((v_new ->> 'venue_id')::uuid, (v_old ->> 'venue_id')::uuid);
  v_id    := coalesce(v_new ->> 'id', v_old ->> 'id');
  if v_org is null then
    return coalesce(new, old);
  end if;
  insert into marketing.audit_logs (organization_id, venue_id, actor_id, action, entity_type, entity_id, details)
  values (v_org, v_venue, (select auth.uid()), lower(tg_op), tg_argv[0], v_id,
          jsonb_build_object('old', v_old, 'new', v_new));
  return coalesce(new, old);
end $$;

create trigger trg_audit_memberships after insert or update or delete on marketing.memberships
  for each row execute function marketing.audit_trigger('membership');
create trigger trg_audit_role_permissions after insert or delete on marketing.role_permissions
  for each row execute function marketing.audit_trigger('role_permission');


-- ---------------------------------------------------------------------
-- ZALOŽENÍ ORGANIZACE
--
-- V jedné transakci: organizace, šest rolí ze šablon, členství
-- zakladatele jako vlastníka. Bez toho by na prázdné databázi nikdo
-- nikam nepatřil.
-- ---------------------------------------------------------------------

create or replace function marketing.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_org  uuid;
  v_role uuid;
  t      record;
begin
  if v_uid is null then
    raise exception 'Založit organizaci může jen přihlášený uživatel' using errcode = 'insufficient_privilege';
  end if;

  insert into marketing.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;

  insert into marketing.organizations (name, slug) values (p_name, p_slug) returning id into v_org;

  for t in select * from marketing.role_templates order by sort_order loop
    insert into marketing.roles (organization_id, key, name, description, is_owner, sort_order)
    values (v_org, t.key, t.name, t.description, t.is_owner, t.sort_order)
    returning id into v_role;
    insert into marketing.role_permissions (role_id, permission_key)
    select v_role, unnest(t.permissions);
  end loop;

  insert into marketing.memberships (organization_id, user_id, role_id, scope, status)
  select v_org, v_uid, r.id, 'organization', 'active'
  from marketing.roles r where r.organization_id = v_org and r.is_owner;

  perform marketing.audit(v_org, null, 'organization.created', 'organization', v_org::text,
                          jsonb_build_object('name', p_name));
  return v_org;
end $$;

grant execute on function marketing.create_organization(text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- GRANTY A RLS
-- ---------------------------------------------------------------------

grant select, insert, update on marketing.organizations to authenticated;
grant select, insert, update on marketing.venues to authenticated;
-- E-mail a telefon spolučlenů se nečtou přímo: granty jsou po sloupcích,
-- takže dotaz, který si o ně řekne, spadne dřív, než se dostane na řádky.
-- Vlastní e-mail zná aplikace z přihlášení, do tabulky pro něj nechodí.
grant select (user_id, display_name, created_at, updated_at) on marketing.profiles to authenticated;
grant insert (user_id, email, phone, display_name) on marketing.profiles to authenticated;
grant update (email, phone, display_name, updated_at) on marketing.profiles to authenticated;
grant select on marketing.permissions to authenticated;
grant select on marketing.role_templates to authenticated;
grant select, insert, update, delete on marketing.roles to authenticated;
grant select, insert, delete on marketing.role_permissions to authenticated;
grant select, insert, update on marketing.memberships to authenticated;
grant select, insert, delete on marketing.venue_access to authenticated;
grant select on marketing.audit_logs to authenticated;
grant all on all tables in schema marketing to service_role;
grant usage, select on all sequences in schema marketing to authenticated, service_role;

alter table marketing.organizations    enable row level security;
alter table marketing.venues           enable row level security;
alter table marketing.profiles         enable row level security;
alter table marketing.permissions      enable row level security;
alter table marketing.role_templates   enable row level security;
alter table marketing.roles            enable row level security;
alter table marketing.role_permissions enable row level security;
alter table marketing.memberships      enable row level security;
alter table marketing.venue_access     enable row level security;
alter table marketing.audit_logs       enable row level security;

create policy organizations_select on marketing.organizations for select to authenticated
  using (marketing.is_member(id));
create policy organizations_update on marketing.organizations for update to authenticated
  using (marketing.has_access(id, 'settings.manage', null))
  with check (marketing.has_access(id, 'settings.manage', null));
-- Vložení přímo do tabulky se nepovoluje — jde přes create_organization().

create policy venues_select on marketing.venues for select to authenticated
  using (id in (select marketing.visible_venue_ids(organization_id)));
create policy venues_insert on marketing.venues for insert to authenticated
  with check (marketing.has_access(organization_id, 'settings.manage', null));
create policy venues_update on marketing.venues for update to authenticated
  using (marketing.has_access(organization_id, 'settings.manage', null))
  with check (marketing.has_access(organization_id, 'settings.manage', null));

-- Profil: svůj celý; cizí jen jméno spolučlenů (e-mail a telefon jsou
-- osobní údaje — pravidlo 8 FoodTabu: kontakty nikam neprosakují).
create policy profiles_own on marketing.profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy profiles_colleagues on marketing.profiles for select to authenticated
  using (exists (
    select 1 from marketing.memberships a
    join marketing.memberships b on b.organization_id = a.organization_id
    where a.user_id = (select auth.uid()) and a.status = 'active' and a.deleted_at is null
      and b.user_id = marketing.profiles.user_id and b.deleted_at is null
  ));

create policy permissions_read on marketing.permissions for select to authenticated using (true);
create policy role_templates_read on marketing.role_templates for select to authenticated using (true);

create policy roles_select on marketing.roles for select to authenticated
  using (marketing.is_member(organization_id));
create policy roles_write on marketing.roles for all to authenticated
  using (marketing.has_access(organization_id, 'team.manage', null))
  with check (marketing.has_access(organization_id, 'team.manage', null));

create policy role_permissions_select on marketing.role_permissions for select to authenticated
  using (exists (select 1 from marketing.roles r where r.id = role_id and marketing.is_member(r.organization_id)));
create policy role_permissions_write on marketing.role_permissions for all to authenticated
  using (exists (select 1 from marketing.roles r where r.id = role_id
                 and marketing.has_access(r.organization_id, 'team.manage', null) and not r.is_owner))
  with check (exists (select 1 from marketing.roles r where r.id = role_id
                 and marketing.has_access(r.organization_id, 'team.manage', null) and not r.is_owner));

create policy memberships_select on marketing.memberships for select to authenticated
  using (user_id = (select auth.uid()) or marketing.is_member(organization_id));
create policy memberships_insert on marketing.memberships for insert to authenticated
  with check (marketing.has_access(organization_id, 'team.manage', null));
create policy memberships_update on marketing.memberships for update to authenticated
  using (marketing.has_access(organization_id, 'team.manage', null))
  with check (marketing.has_access(organization_id, 'team.manage', null));

create policy venue_access_select on marketing.venue_access for select to authenticated
  using (exists (select 1 from marketing.memberships m where m.id = membership_id
                 and (m.user_id = (select auth.uid()) or marketing.is_member(m.organization_id))));
create policy venue_access_write on marketing.venue_access for all to authenticated
  using (exists (select 1 from marketing.memberships m where m.id = membership_id
                 and marketing.has_access(m.organization_id, 'team.manage', null)))
  with check (exists (select 1 from marketing.memberships m where m.id = membership_id
                 and marketing.has_access(m.organization_id, 'team.manage', null)));

create policy audit_logs_select on marketing.audit_logs for select to authenticated
  using (marketing.has_access(organization_id, 'audit.read', null));

-- Poslední vlastník nesmí zmizet: pozastavení nebo smazání posledního
-- aktivního vlastníka organizaci zamkne pro všechny.
create or replace function marketing.guard_last_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'UPDATE') and (new.status <> 'active' or new.deleted_at is not null
      or new.role_id <> old.role_id) then
    if exists (select 1 from marketing.roles r where r.id = old.role_id and r.is_owner)
       and not exists (
         select 1 from marketing.memberships m join marketing.roles r on r.id = m.role_id
         where m.organization_id = old.organization_id and r.is_owner and m.status = 'active'
           and m.deleted_at is null and m.id <> old.id
       ) then
      raise exception 'Organizace musí mít aspoň jednoho aktivního vlastníka' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger trg_guard_last_owner before update on marketing.memberships
  for each row execute function marketing.guard_last_owner();
