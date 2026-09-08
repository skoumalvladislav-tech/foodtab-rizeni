-- =====================================================================
-- Náhrada Supabase prostředí pro lokální PGlite / čistý PostgreSQL.
--
-- Na Supabase existuje schéma `auth`, funkce `auth.uid()` a role
-- `anon`, `authenticated`, `service_role`. Migrace je NEZAKLÁDAJÍ —
-- tenhle soubor se pouští jen lokálně, před migracemi, aby se stejné
-- SQL dalo spustit i bez Supabase.
--
-- `authenticated` je schválně NOSUPERUSER: díky tomu PGlite vynucuje
-- Row Level Security stejně jako Supabase a lokální testy izolace mají
-- smysl (ověřeno: superuživatel by politiky obešel a testy by lhaly).
-- =====================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  phone      text unique,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin nosuperuser;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin nosuperuser;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin nosuperuser bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
