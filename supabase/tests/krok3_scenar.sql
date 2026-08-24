-- Scénář pro krok 3 — rozhraní autorizace pro aplikaci.
-- Navazuje na etapa0_scenar.sql a krok2_scenar.sql: firma, dvě pobočky,
-- majitel (1111…), vedoucí Perly (2222…) a cizí uživatel (3333…) už
-- existují.
--
-- Kontroly jsou psané tak, aby ověřovaly, že se někdo NEDOSTANE tam,
-- kam nemá — ne že šťastná cesta funguje.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select set_config('test.tenant', :'tenant', false);

\echo ''
\echo '== Katalog sedí s aplikací ================================'
-- Když tahle kontrola spadne, přibylo (nebo zmizelo) oprávnění
-- v migraci a nedoplnilo se do seznamu PERMISSIONS v lib/authz.ts.
-- Neznámý klíč by pak jen tiše odmítal přístup a hledalo by se to dlouho.
select pg_temp.check('seznam oprávnění odpovídá lib/authz.ts',
  (select array_agg(key order by key) from public.permissions) = array[
    'agents.manage','ai.use','approvals.decide','attendance.manage',
    'attendance.read','banking.read','communication.manage',
    'communication.read','finance.manage','finance.read',
    'marketing.manage','marketing.publish','marketing.read',
    'menus.manage','menus.read','motivation.manage','motivation.read',
    'payroll.export','payroll.manage','people.manage','purchasing.manage',
    'purchasing.read','recipes.manage','recipes.read','settings.manage',
    'shifts.manage','shifts.read','tasks.manage','tasks.read'
  ]::text[]);

select pg_temp.check('seznam modulů odpovídá lib/authz.ts',
  (select array_agg(key order by key) from public.modules)
    = array['finance','marketing','objednavky','provoz']::text[]);

\echo ''
\echo '== Průzor přeposílá stejné rozhodnutí ====================='
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

select pg_temp.check('majitel: public.has_access = app.has_access',
  public.has_access(:'tenant', 'settings.manage', null)
    = app.has_access(:'tenant', 'settings.manage', null)
  and public.has_access(:'tenant', 'settings.manage', null));

select pg_temp.check('neznámé oprávnění neprojde',
  public.has_access(:'tenant', 'neexistujici.pravo', null) = false);

\echo ''
\echo '== Rozsah vedoucího ======================================='
select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);

select pg_temp.check('vedoucí smí plánovat na Perle',
  public.has_access(:'tenant', 'shifts.manage', :'perla'));
select pg_temp.check('vedoucí NESMÍ plánovat na Baru',
  public.has_access(:'tenant', 'shifts.manage', :'bar') = false);
select pg_temp.check('vedoucí NESMÍ na firemní úroveň',
  public.has_access(:'tenant', 'shifts.manage', null) = false);
select pg_temp.check('vedoucí nemá nastavení firmy ani na své pobočce',
  public.has_access(:'tenant', 'settings.manage', :'perla') = false);

\echo ''
\echo '== Kontext pro vykreslení ================================='
select pg_temp.check('vedoucí vidí jednu pobočku, a to svou',
  jsonb_array_length(public.my_context(:'tenant') -> 'branches') = 1
  and public.my_context(:'tenant') -> 'branches' -> 0 ->> 'slug' = 'cerna-perla');

select pg_temp.check('vedoucí má rozsah branch',
  public.my_context(:'tenant') -> 'membership' ->> 'scope' = 'branch');

select pg_temp.check('vedoucí nemá v kontextu nastavení firmy',
  not (public.my_context(:'tenant') -> 'permissions' ? 'settings.manage'));

select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('majitel vidí obě pobočky a má rozsah tenant',
  jsonb_array_length(public.my_context(:'tenant') -> 'branches') = 2
  and public.my_context(:'tenant') -> 'membership' ->> 'scope' = 'tenant');

select pg_temp.check('majitel je v kontextu označený jako vlastník',
  (public.my_context(:'tenant') -> 'role' ->> 'isOwner')::boolean);

select pg_temp.check('majitel má v seznamu tenantů právě tuhle firmu',
  (select count(*) from public.my_tenants()) = 1
  and (select tenant_id from public.my_tenants()) = :'tenant');

\echo ''
\echo '== Stav modulu se propisuje do kontextu ==================='
-- Modul Finance je od scénáře etapy 0 zapnutý. Kontrolujeme, že se to
-- projeví v kontextu — a hlavně že se vypnutí projeví taky. Schovaná
-- položka v menu není zámek, ale nesmí zůstat svítit, když modul zhasne.
select pg_temp.check('zapnutý modul je v kontextu i s oprávněními',
  exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'modules') m
    where m ->> 'key' = 'finance')
  and public.my_context(:'tenant') -> 'permissions' ? 'finance.read');

reset role;
update public.tenant_modules set status = 'suspended'
where tenant_id = :'tenant' and module_key = 'finance';

set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

-- Majitel má jinak všechno. Přes vypnutý modul se ale nedostane taky.
select pg_temp.check('pozastavený modul zavírá i majiteli',
  public.has_access(:'tenant', 'finance.read', null) = false);
select pg_temp.check('pozastavený modul zmizí z kontextu',
  not exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'modules') m
    where m ->> 'key' = 'finance'));
select pg_temp.check('oprávnění vypnutého modulu zmizí z kontextu',
  not (public.my_context(:'tenant') -> 'permissions' ? 'finance.read'));

-- Vracíme stav, ve kterém jsme ho našli.
reset role;
update public.tenant_modules set status = 'active'
where tenant_id = :'tenant' and module_key = 'finance';

\echo ''
\echo '== Cizí uživatel =========================================='
set role authenticated;
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);

select pg_temp.check('cizí nemá přístup nikam',
  public.has_access(:'tenant', 'shifts.read', :'perla') = false
  and public.has_access(:'tenant', 'shifts.read', null) = false);
select pg_temp.check('cizí nedostane kontext firmy',
  public.my_context(:'tenant') is null);
select pg_temp.check('cizí nemá žádnou firmu',
  (select count(*) from public.my_tenants()) = 0);

\echo ''
\echo '== Nepřihlášený se nedostane k ničemu ====================='
reset role;
set role anon;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.has_access(current_setting('test.tenant')::uuid, 'shifts.read', null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal has_access'; end if;
  raise notice '  OK    nepřihlášený nezavolá has_access';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.my_context(current_setting('test.tenant')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal my_context'; end if;
  raise notice '  OK    nepřihlášený nezavolá my_context';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.my_tenants();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal my_tenants'; end if;
  raise notice '  OK    nepřihlášený nezavolá my_tenants';
end $$;

reset role;
select set_config('test.user_id', '', false);

\echo ''
\echo '=========================================================='
\echo ' KROK 3 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
