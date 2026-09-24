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
  -- Ověření adresy a čísla. V Supabase výchozí hodnotu nemají — nastaví
  -- je až potvrzení odkazem nebo kódem. Tady je výchozí now(): scénáře
  -- zakládají účty, které se už přihlásily, a přihlásit se u nás jde
  -- jen odkazem nebo kódem. Neověřený účet si scénář založí výslovně
  -- s NULL (krok56).
  email_confirmed_at timestamptz default now(),
  phone_confirmed_at timestamptz default now(),
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

-- ---------------------------------------------------------------------
-- ÚLOŽIŠTĚ SOUBORŮ
--
-- Supabase Storage je obyčejné schéma `storage` se dvěma tabulkami,
-- nad kterými běží RLS jako nad čímkoli jiným. Lokální PostgreSQL ho
-- nemá, takže bez téhle napodobeniny by se politiky u fotek NEDALY
-- OTESTOVAT VŮBEC — a to je přesně to místo, kde chyba znamená, že
-- fotky jedné restaurace uvidí druhá.
--
-- Sloupce jsou jen ty, na které politiky sahají. Není to Storage,
-- je to tolik Storage, kolik jí ta pravidla potřebují vidět.
-- ---------------------------------------------------------------------

create schema storage;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets(id) on delete cascade,
  name       text not null,
  owner      uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

/*
  `storage.foldername` vrací složky BEZ názvu souboru. Politiky se
  podle ní ptají, komu ta cesta patří, takže se chová stejně jako
  u Supabase: z 'firma/pobocka/soubor.jpg' udělá {firma,pobocka}.
*/
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

create or replace function storage.filename(name text)
returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated, anon, service_role;
grant select on storage.buckets to authenticated, anon, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
