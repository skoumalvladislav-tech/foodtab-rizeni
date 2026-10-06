-- Scénář pro krok 89 — integrace.manage ODDĚLENÉ od finance.manage.
--
-- Migrace: 20261007110000_integrace_opravneni_a_sjednoceni.sql. Zadání:
-- C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 2 ("Odděl
-- oprávnění správce integrací od oprávnění číst data cílových modulů").
--
-- Pokrývá:
--   1. zaměstnanec s integrace.manage (BEZ finance.manage) smí založit
--      připojení a spravovat tajemství;
--   2. zaměstnanec s finance.manage (BEZ integrace.manage) NESMÍ ani
--      jedno — finance.manage sám o sobě napojení nespravuje;
--   3. app.integrace_manage_zpetne_dosadit() OPRAVDU kopíruje
--      finance.manage → integrace.manage (ne tiše nedělá nic) a je
--      idempotentní (druhé spuštění nezdvojí řádek).
--
-- Navazuje na etapa0_scenar.sql (firma "Foodtab s.r.o.", majitel@foodtab.cz).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as role_jakakoli from public.roles where tenant_id = :'tenant' and key = 'bar' limit 1 \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava: dva zaměstnanci, dvě zcela oddělená zařazení ===='

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok89_spravce_integrace', 'Krok89 — správce integrací', 'provoz', true)
returning id as poz_integrace \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'poz_integrace', 'integrace.manage');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok89_jen_finance', 'Krok89 — jen finance.manage', 'provoz', true)
returning id as poz_finance \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'poz_finance', 'finance.manage');

select pg_temp.check('zařazení "správce integrací" NEMÁ finance.manage',
  not exists (select 1 from public.position_permissions
    where position_id = :'poz_integrace' and permission_key = 'finance.manage'));

select pg_temp.check('zařazení "jen finance.manage" NEMÁ integrace.manage',
  not exists (select 1 from public.position_permissions
    where position_id = :'poz_finance' and permission_key = 'integrace.manage'));

insert into auth.users (id, email) values
  ('89890000-0000-0000-0000-000000000001', 'krok89.integrace@foodtab.cz'),
  ('89890000-0000-0000-0000-000000000002', 'krok89.finance@foodtab.cz')
on conflict (id) do nothing;

insert into public.profiles (user_id, email, full_name) values
  ('89890000-0000-0000-0000-000000000001', 'krok89.integrace@foodtab.cz', 'Krok89 SprávceIntegrace'),
  ('89890000-0000-0000-0000-000000000002', 'krok89.finance@foodtab.cz', 'Krok89 FinanceManažer')
on conflict (user_id) do nothing;

insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '89890000-0000-0000-0000-000000000001', :'poz_integrace', 'Krok89 SprávceIntegrace', 'hpp')
returning id as e_integrace \gset

insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '89890000-0000-0000-0000-000000000002', :'poz_finance', 'Krok89 FinanceManažer', 'hpp')
returning id as e_finance \gset

-- `scope = 'tenant'` — testy níž pracují s připojením na úrovni celé
-- firmy (branch_id NULL), `app.has_access(..., null)` proto vyžaduje
-- firemní rozsah členství, ne pobočkový (krok30 pattern).
insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', '89890000-0000-0000-0000-000000000001', :'role_jakakoli', 'active', 'tenant');

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', '89890000-0000-0000-0000-000000000002', :'role_jakakoli', 'active', 'tenant');


\echo ''
\echo '== 1. integrace.manage SMÍ založit připojení a spravovat tajemství, BEZ finance.manage =='

set role authenticated;
select set_config('test.user_id', '89890000-0000-0000-0000-000000000001', false);

select pg_temp.check('sanity: tenhle uživatel integrace.manage skutečně má',
  app.has_access(:'tenant', 'integrace.manage', null));
select pg_temp.check('sanity: a finance.manage NEMÁ',
  not app.has_access(:'tenant', 'finance.manage', null));

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', 'pokladna', 'krok89-test', 'demo', 'Krok89 testovací připojení')
returning id as pripojeni \gset

select pg_temp.check('správce integrací založil připojení BEZ finance.manage',
  exists (select 1 from public.integrace_pripojeni where id = :'pripojeni'));

select app.integrace_uloz_tajemstvi(:'pripojeni', 'krok89-sifra-v1', 'krok89-otisk-v1');

select pg_temp.check('a uložil tajemství k němu',
  app.integrace_precti_tajemstvi(:'pripojeni') = 'krok89-sifra-v1');

select app.integrace_smaz_tajemstvi(:'pripojeni');

reset role;
select pg_temp.check('a smazal ho — tajemství je skutečně pryč',
  not exists (select 1 from public.integrace_tajemstvi where pripojeni_id = :'pripojeni'));
set role authenticated;
select set_config('test.user_id', '89890000-0000-0000-0000-000000000001', false);


\echo ''
\echo '== 2. finance.manage SÁM O SOBĖ napojení nespravuje ============'

select set_config('test.user_id', '89890000-0000-0000-0000-000000000002', false);

select pg_temp.check('sanity: tenhle uživatel finance.manage skutečně má',
  app.has_access(:'tenant', 'finance.manage', null));
select pg_temp.check('sanity: a integrace.manage NEMÁ',
  not app.has_access(:'tenant', 'integrace.manage', null));

select pg_temp.check('finance.manage BEZ integrace.manage připojení nezaloží (RLS write)',
  pg_temp.spadne_hlaskou(
    format('insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim) values (%L, %L, %L, %L)',
      :'tenant', 'pokladna', 'krok89-utok', 'demo'),
    '42501', ''));

select pg_temp.check('finance.manage BEZ integrace.manage tajemství neuloží',
  pg_temp.spadne_hlaskou(
    format('select app.integrace_uloz_tajemstvi(%L, %L, %L)', :'pripojeni', 'podvrzeno', 'podvrzeno'),
    '42501', 'oprávnění'));

select pg_temp.check('finance.manage BEZ integrace.manage připojení neodpojí',
  pg_temp.spadne_hlaskou(
    format('select app.integrace_smaz_tajemstvi(%L)', :'pripojeni'),
    '42501', 'oprávnění'));


\echo ''
\echo '== 3. app.integrace_manage_zpetne_dosadit() OPRAVDU kopíruje, ne jen tiše neudělá nic =='

reset role;
select set_config('test.user_id', '', false);

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok89_zpetny_test', 'Krok89 — zpětný test', 'provoz', true)
returning id as poz_zpetny \gset

-- Vznikla PO migraci (tahle fixtura), takže ji jednorázové spuštění
-- migrace logicky nemohlo zahrnout — přesně proto je to funkce, ne
-- holé příkazy (stejný důvod jako u app.prevod_zarazeni()).
insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'poz_zpetny', 'finance.manage');

select pg_temp.check('příprava: nové zařazení s finance.manage zatím integrace.manage NEMÁ',
  not exists (select 1 from public.position_permissions
    where position_id = :'poz_zpetny' and permission_key = 'integrace.manage'));

select app.integrace_manage_zpetne_dosadit();

select pg_temp.check('po spuštění funkce zařazení integrace.manage SKUTEČNĚ dostalo',
  exists (select 1 from public.position_permissions
    where position_id = :'poz_zpetny' and permission_key = 'integrace.manage'));

select app.integrace_manage_zpetne_dosadit();

select pg_temp.check('druhé spuštění je idempotentní — pořád jen jeden řádek, ne duplicita',
  (select count(*) from public.position_permissions
    where position_id = :'poz_zpetny' and permission_key = 'integrace.manage') = 1);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.integrace_tajemstvi where pripojeni_id = :'pripojeni';
delete from public.integrace_pripojeni where id = :'pripojeni';
delete from public.memberships where tenant_id = :'tenant' and user_id in
  ('89890000-0000-0000-0000-000000000001', '89890000-0000-0000-0000-000000000002');
delete from public.employees where id in (:'e_integrace', :'e_finance');
delete from public.position_permissions where position_id in (:'poz_integrace', :'poz_finance', :'poz_zpetny');
delete from public.positions where id in (:'poz_integrace', :'poz_finance', :'poz_zpetny');

-- `auth.users`/`profiles` pro tyhle dva testovací lidi se SCHVÁLNĚ
-- nemažou — stejná konvence jako krok30/krok73 (cizí firma "Xaver").
-- PGlite hlásilo při mazání `profiles` referenční chybu na
-- `employee_rates_created_by_fkey`, byť žádný řádek kroku 89 na tyhle
-- UUID neukazuje — jsou to jednorázová UUID bez kolize napříč běhy,
-- zůstat ležet neškodí.

select pg_temp.check('úklid: po scénáři nezůstalo žádné připojení kroku 89',
  not exists (select 1 from public.integrace_pripojeni where poskytovatel = 'krok89-test'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 89 HOTOV =============================================='
