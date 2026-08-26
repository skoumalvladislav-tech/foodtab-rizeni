-- Napodobenina prostředí Supabase pro lokální test. Není součástí migrací.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- V Supabase čte auth.uid() nárok z JWT. Tady ho bereme z proměnné sezení.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase dává rozšíření do schématu `extensions`, ne do `public`.
-- Zakládáme je tu stejně, aby test odhalil, kdyby se do migrací vloudilo
-- `public.digest()` nebo sloupec typu `citext` — na Supabase by to spadlo.
-- Naše migrace na těchto rozšířeních záměrně nestojí.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists citext   schema extensions;
