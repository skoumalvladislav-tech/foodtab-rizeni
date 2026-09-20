-- Scénář pro krok 41 — nastavení modulu Směny (výběr zařazení ve formuláři).
--
-- Pokrývá migraci 20260920130000_nastaveni_smeny: sloupec
-- tenant_settings.smeny_zarazeni_ve_formulari (výchozí true) a funkci
-- nastavit_smeny_formular (settings.manage, audit).
--
-- Kontroly stojí na výsledku funkce a na katalogu; RLS a sloupcové granty
-- v PGlite (jediný superuživatel) neplatí, ty ověřuje běh proti PostgreSQL.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

/* Zavolá funkci jako daný uživatel; vrátí „ok“ nebo `err:<sqlstate>`. */
create or replace function pg_temp.nastavit(p_kdo uuid, p_tenant uuid, p_hodnota boolean)
returns text language plpgsql as $$
begin
  perform set_config('test.user_id', p_kdo::text, false);
  begin
    perform public.nastavit_smeny_formular(p_tenant, p_hodnota);
    return 'ok';
  exception when others then
    return 'err:' || sqlstate;
  end;
end $$;

reset role;

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

\echo ''
\echo '== 1. Výchozí hodnota ===================================='

select pg_temp.check('sloupec existuje a výchozí je true (bez zásahu se nabízí jako dřív)',
  (select column_default = 'true' and is_nullable = 'NO' from information_schema.columns
   where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'smeny_zarazeni_ve_formulari'));

select pg_temp.check('firma bez řádku v nastavení nebo s řádkem bez zásahu má true',
  coalesce((select smeny_zarazeni_ve_formulari from public.tenant_settings where tenant_id = :'tenant'), true));

\echo ''
\echo '== 2. Kdo smí a co se zapíše ================================'

select pg_temp.check('vedoucí bez settings.manage nastavení nezmění',
  pg_temp.nastavit(:'vedouci', :'tenant', false) = 'err:42501');
select pg_temp.check('… a nic se nezměnilo',
  coalesce((select smeny_zarazeni_ve_formulari from public.tenant_settings where tenant_id = :'tenant'), true));

select pg_temp.check('majitel vypne', pg_temp.nastavit(:'majitel', :'tenant', false) = 'ok');
select pg_temp.check('… a v databázi je false',
  (select smeny_zarazeni_ve_formulari from public.tenant_settings where tenant_id = :'tenant') = false);

select pg_temp.check('a zase zapne', pg_temp.nastavit(:'majitel', :'tenant', true) = 'ok');
select pg_temp.check('… a v databázi je true',
  (select smeny_zarazeni_ve_formulari from public.tenant_settings where tenant_id = :'tenant') = true);

select pg_temp.check('prázdná hodnota se odmítne (není to „vypnuto“, je to chyba)',
  pg_temp.nastavit(:'majitel', :'tenant', null) = 'err:22004');

select pg_temp.check('cizí firma (jiné tenant_id): odmítnuto a nic se nezaložilo',
  pg_temp.nastavit(:'majitel', gen_random_uuid(), false) = 'err:42501');

\echo ''
\echo '== 3. Audit ==============================================='

select pg_temp.check('každá změna je v auditu, s hodnotou před a po',
  (select count(*) from public.audit_log
   where tenant_id = :'tenant' and action = 'settings.smeny_zarazeni_ve_formulari') = 2
  and exists (select 1 from public.audit_log
   where tenant_id = :'tenant' and action = 'settings.smeny_zarazeni_ve_formulari'
     and ("before"->>'zarazeni')::boolean = true and ("after"->>'zarazeni')::boolean = false));

\echo ''
\echo '== 4. Práva ==============================================='

select pg_temp.check('anon funkci volat nesmí, přihlášený smí (právo se ověřuje uvnitř)',
  not has_function_privilege('anon', 'public.nastavit_smeny_formular(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.nastavit_smeny_formular(uuid, boolean)', 'execute'));
select pg_temp.check('přihlášený smí sloupec číst, ale ne zapisovat přímo',
  has_column_privilege('authenticated', 'public.tenant_settings', 'smeny_zarazeni_ve_formulari', 'select')
  and not has_column_privilege('authenticated', 'public.tenant_settings', 'smeny_zarazeni_ve_formulari', 'update'));
select pg_temp.check('anon sloupec nevidí',
  not has_column_privilege('anon', 'public.tenant_settings', 'smeny_zarazeni_ve_formulari', 'select'));

\echo ''
\echo '== KROK 41 HOTOV ========================================'
