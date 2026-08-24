-- =====================================================================
-- Foodtab — Etapa 0, krok 1: základní schéma
--
-- Zavádí firmu, pobočky, lidi, role, oprávnění, moduly a audit.
-- Nic z toho není zapsané v kódu aplikace — všechno jsou data.
--
-- Návaznost: dokument "Bezpečný základ Foodtabu", §5 Datový model.
-- =====================================================================

-- Záměrně bez citext. E-maily se ukládají už zmenšené na malá písmena
-- a hlídá to podmínka, takže jedinečnost funguje stejně. Kdybychom sáhli
-- po rozšíření, museli bychom hádat, ve kterém schématu leží — Supabase
-- ho dává do `extensions`, lokální Postgres do `public` — a funkce
-- se search_path = '' by spadly na jednom z těch dvou prostředí.

-- Pomocné funkce a katalogy žijí v samostatném schématu, které se
-- nevystavuje přes API. Aplikace na ně sahá jen přes RPC, ne přímo.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;


-- ---------------------------------------------------------------------
-- ORGANIZACE
-- ---------------------------------------------------------------------

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  legal_name  text,
  ico         text,
  dic         text,
  country     char(2) not null default 'CZ',
  timezone    text    not null default 'Europe/Prague',
  currency    char(3) not null default 'CZK',
  created_at  timestamptz not null default now(),
  created_by  uuid,
  deleted_at  timestamptz
);

comment on table public.tenants is
  'Firma. Rozhraní je zatím jednofiremní, ale model je připravený na víc.';


create table public.branches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  slug          text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  address       text,
  timezone      text,
  -- Provozní den se odvozuje odsud, ne z kalendáře. Účet z 2:15 patří
  -- do včerejší uzávěrky. Viz §8 specifikace.
  opening_hours jsonb  not null default '{}'::jsonb,
  day_starts_at time   not null default '05:00',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (tenant_id, slug)
);

comment on column public.branches.slug is
  'Jedinečný v rámci firmy, ne globálně. Počet poboček není omezený.';
comment on column public.branches.day_starts_at is
  'Hodina, kdy začíná nový provozní den. Určuje business_date u tržeb.';


create table public.positions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9_]+$'),
  label      text not null,
  department text not null default 'provoz'
             check (department in ('kuchyne', 'bar', 'servis', 'provoz', 'vedeni')),
  active     boolean not null default true,
  unique (tenant_id, key)
);

comment on table public.positions is
  'Pozice v provozu. Definuje si každá firma sama.';


-- ---------------------------------------------------------------------
-- MODULY
-- Modul je balík funkcí, který si firma zapíná. Leží NAD oprávněními:
-- vypnutý modul zneúčinní i oprávnění, které role obsahuje.
-- ---------------------------------------------------------------------

create table public.modules (
  key        text primary key check (key ~ '^[a-z_]+$'),
  label      text not null,
  is_base    boolean not null default false,
  sort_order int not null default 100
);

comment on table public.modules is
  'Systémový katalog. Zákazník needituje.';


create table public.tenant_modules (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module_key  text not null references public.modules(key),
  status      text not null default 'active'
              check (status in ('active', 'trial', 'suspended')),
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  -- Např. {"ai_dotazu_mesicne": 500}. Gastro AI je v základu, takže
  -- náklad na model je potřeba ohraničit tady, ne příplatkem.
  limits      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, module_key)
);


-- Základní modul nejde vypnout ani smazat.
create or replace function app.protect_base_module()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.modules m
               where m.key = old.module_key and m.is_base) then
      raise exception 'Základní modul % nejde odebrat.', old.module_key
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if exists (select 1 from public.modules m
             where m.key = new.module_key and m.is_base)
     and (new.status <> 'active' or new.valid_until is not null) then
    raise exception 'Základní modul % musí zůstat aktivní.', new.module_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_protect_base_module
  before update or delete on public.tenant_modules
  for each row execute function app.protect_base_module();


-- ---------------------------------------------------------------------
-- OPRÁVNĚNÍ A ROLE
-- ---------------------------------------------------------------------

create table public.permissions (
  key        text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module_key text not null references public.modules(key),
  label      text not null,
  -- Citlivé oprávnění vyžaduje u účtu druhý faktor a vylučuje
  -- přihlášení pouze přes SMS. Viz §7.1 a §10 specifikace.
  sensitive  boolean not null default false,
  sort_order int not null default 100
);


create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  key             text not null check (key ~ '^[a-z0-9_]+$'),
  label           text not null,
  -- Majitel dostává vše, co spadá do aktivních modulů, bez ohledu na
  -- to, jaká oprávnění mu kdo přiřadil. Jinak by šel zamknout ven.
  is_owner        boolean not null default false,
  system_template text,
  created_at      timestamptz not null default now(),
  unique (tenant_id, key)
);

-- V každé firmě právě jedna role vlastníka.
create unique index roles_one_owner_per_tenant
  on public.roles (tenant_id) where is_owner;


create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);


-- ---------------------------------------------------------------------
-- LIDÉ
--
-- profiles    = přihlašovací účet (nemá tenant_id, může být ve víc firmách)
-- employees   = člověk, který pro firmu pracuje (účet je VOLITELNÝ)
-- memberships = spojení účtu s firmou plus role
--
-- Brigádník bez účtu musí jít zařadit na směnu. Proto ta tři místa,
-- ne jedno. Viz §5.2 specifikace.
-- ---------------------------------------------------------------------

create table public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text unique check (email is null or email = lower(btrim(email))),
  phone       text unique check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  full_name   text not null default '',
  -- Druhý faktor je podmínkou pro role s citlivými oprávněními.
  mfa_enabled boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint profiles_needs_identity check (email is not null or phone is not null)
);

comment on column public.profiles.phone is
  'V tvaru E.164. Telefon je plnohodnotný přihlašovací údaj — velká část '
  'lidí v gastru pracovní e-mail nemá.';


create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete restrict,
  status     text not null default 'active'
             check (status in ('active', 'suspended')),
  -- 'tenant' vidí firemní úroveň i všechny pobočky.
  -- 'branch'  vidí jen pobočky vyjmenované v membership_branches.
  scope      text not null default 'branch'
             check (scope in ('tenant', 'branch')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_active
  on public.memberships (user_id, tenant_id) where status = 'active';


create table public.membership_branches (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  primary key (membership_id, branch_id)
);

create index membership_branches_branch on public.membership_branches (branch_id);


create table public.employees (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete set null,
  -- Prázdné u brigádníka nebo občasné výpomoci, která se nikdy nepřihlásí.
  user_id         uuid references public.profiles(user_id) on delete set null,
  position_id     uuid references public.positions(id) on delete set null,
  full_name       text not null check (length(btrim(full_name)) > 0),
  employment_type text not null default 'hpp'
                  check (employment_type in ('hpp', 'dpp', 'dpc', 'ico', 'jine')),
  started_on      date,
  ended_on        date,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  -- Mazání je označení, ne výmaz — kvůli návaznosti docházky.
  deleted_at      timestamptz,
  unique (tenant_id, user_id)
);

create index employees_tenant_branch on public.employees (tenant_id, branch_id)
  where deleted_at is null;


-- ---------------------------------------------------------------------
-- POZVÁNKY
-- Do firmy se vstupuje jen na pozvánku. Samoregistrace se ruší:
-- prozrazovala existenci firmy a dělala administrátorovi frontu žádostí.
-- ---------------------------------------------------------------------

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  channel     text not null check (channel in ('email', 'sms')),
  email       text check (email is null or email = lower(btrim(email))),
  phone       text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  scope       text not null default 'branch' check (scope in ('tenant', 'branch')),
  branch_ids  uuid[] not null default '{}',
  -- Uložený je jen otisk. Token vidí jednou příjemce a nikdo jiný.
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(user_id) on delete set null,
  revoked_at  timestamptz,
  invited_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint invitations_channel_matches_contact check (
    (channel = 'email' and email is not null and phone is null) or
    (channel = 'sms'   and phone is not null and email is null)
  )
);

create index invitations_open on public.invitations (tenant_id)
  where accepted_at is null and revoked_at is null;


-- ---------------------------------------------------------------------
-- AUDIT
-- Zapisuje se každá změna oprávnění a modulů, každý přístup k financím
-- a každá akce agenta. Z aplikace nejde měnit ani mazat.
-- ---------------------------------------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  actor_type  text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id    text,
  actor_label text,
  action      text not null,
  entity_type text,
  entity_id   text,
  branch_id   uuid references public.branches(id) on delete set null,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);

create index audit_log_tenant_time on public.audit_log (tenant_id, occurred_at desc);
create index audit_log_entity on public.audit_log (entity_type, entity_id);

-- Neměnnost auditu vynucená v databázi, ne jen dohodou v týmu.
create rule audit_log_no_update as on update to public.audit_log do instead nothing;
create rule audit_log_no_delete as on delete to public.audit_log do instead nothing;
