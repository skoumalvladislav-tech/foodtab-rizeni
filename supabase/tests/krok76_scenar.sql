-- Scénář pro krok 76 — public.importovat_transakce (Finance ERP).
--
-- Migrace: 20261003170000_import_transakce_rpc.sql. Plán:
-- proud-scribbling-glade.md, oddíl "Finance a účetnictví — gastro ERP
-- modul".
--
-- Pokrývá:
--   0. příprava (modul finance aktivní, skutečná druhá firma);
--   1. hromadný zápis: správný počet, správná dávka/zdroj na řádcích;
--   2. idempotence: opakování STEJNÝCH externi_id podruhé vloží 0 řádků,
--      ale nové externi_id ve STEJNÉM druhém volání se vloží;
--   3. druhá linie: p_ucet cizí firmy, zatímco p_tenant je vlastní,
--      spadne celý příkaz (žádný řádek se nevloží, ne částečně);
--   4. cizí firma (bez finance.manage na p_tenant) neprotlačí vůbec nic,
--      RLS WITH CHECK odmítne celý insert.

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

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('76760000-0000-0000-0000-000000000001', 'xaver76@jinafirma.cz', '{"full_name":"Xaver Sedmdesátšest"}');

set role authenticated;
select set_config('test.user_id', '76760000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok76 Cizí s.r.o.', 'Xaver Sedmdesátšest') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava ================================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok76 pokladna', 'pokladna')
returning id as ucet \gset

insert into public.import_davky (tenant_id, typ, soubor_hash, stav)
values (:'tenant', 'pokladna_csv', 'krok76-hash-1', 'zpracovano')
returning id as davka \gset

select pg_temp.check('příprava: účet a dávka se zapsaly', :'ucet' is not null and :'davka' is not null);


\echo ''
\echo '== 1. Hromadný zápis ==========================================='

select public.importovat_transakce(
  :'tenant', :'ucet', :'davka', 'csv_pokladna',
  '[
    {"datum":"2026-10-01","smer":"prijem","castka_haleru":10000,"protistrana":"Host 1","vs":"","poznamka":"","externi_id":"k76-001"},
    {"datum":"2026-10-01","smer":"prijem","castka_haleru":20000,"protistrana":"Host 2","vs":"","poznamka":"","externi_id":"k76-002"},
    {"datum":"2026-10-02","smer":"vydaj","castka_haleru":5000,"protistrana":"Nákup","vs":"","poznamka":"","externi_id":"k76-003"}
  ]'::jsonb
) as pocet_vlozenych \gset

select pg_temp.check('první import vložil přesně 3 řádky', :'pocet_vlozenych' = 3);

select pg_temp.check('vložené řádky nesou správnou dávku a zdroj',
  (select count(*) from public.transakce
    where import_davka_id = :'davka' and zdroj = 'csv_pokladna' and ucet_id = :'ucet') = 3);

select pg_temp.check('součet příjmů z importu sedí (10000+20000)',
  (select coalesce(sum(castka_haleru),0) from public.transakce
    where import_davka_id = :'davka' and smer = 'prijem') = 30000);


\echo ''
\echo '== 2. Idempotence =============================================='

select public.importovat_transakce(
  :'tenant', :'ucet', :'davka', 'csv_pokladna',
  '[
    {"datum":"2026-10-01","smer":"prijem","castka_haleru":10000,"protistrana":"Host 1","vs":"","poznamka":"","externi_id":"k76-001"},
    {"datum":"2026-10-01","smer":"prijem","castka_haleru":20000,"protistrana":"Host 2","vs":"","poznamka":"","externi_id":"k76-002"}
  ]'::jsonb
) as pocet_podruhe \gset

select pg_temp.check('opakovaný import STEJNÝCH externi_id vloží 0 řádků', :'pocet_podruhe' = 0);

select pg_temp.check('v databázi pořád jen 3 řádky z kroku 76 (ne 5)',
  (select count(*) from public.transakce where import_davka_id = :'davka') = 3);

select public.importovat_transakce(
  :'tenant', :'ucet', :'davka', 'csv_pokladna',
  '[
    {"datum":"2026-10-01","smer":"prijem","castka_haleru":10000,"protistrana":"Host 1","vs":"","poznamka":"","externi_id":"k76-001"},
    {"datum":"2026-10-03","smer":"prijem","castka_haleru":77700,"protistrana":"Host 4","vs":"","poznamka":"","externi_id":"k76-004"}
  ]'::jsonb
) as pocet_smiseny \gset

select pg_temp.check('smíšená dávka (1 starý + 1 nový externi_id) vloží jen ten nový (1)', :'pocet_smiseny' = 1);


\echo ''
\echo '== 3. Druhá linie: cizí ucet_id, vlastní tenant ================'

-- Fixtura cizí firmy se zakládá POD XAVEREM (majitelem tenant_b) —
-- majitel naší firmy přes RLS do cizí firmy nic nevloží (správně).
select set_config('test.user_id', '76760000-0000-0000-0000-000000000001', false);

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant_b', 'Krok76 cizí účet', 'banka')
returning id as ucet_cizi \gset

select set_config('test.user_id', :'majitel', false);

select pg_temp.check('p_ucet cizí firmy spadne celý příkaz, nic se nevloží',
  pg_temp.spadne_hlaskou(
    format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
      :'tenant', :'ucet_cizi', :'davka', 'csv_pokladna',
      '[{"datum":"2026-10-05","smer":"prijem","castka_haleru":999,"externi_id":"k76-utok-1"}]'),
    '23514', ''));

select pg_temp.check('po pokusu s cizím účtem se žádný útočný řádek nevložil',
  not exists (select 1 from public.transakce where externi_id = 'k76-utok-1'));


\echo ''
\echo '== 4. Cizí firma bez finance.manage na p_tenant ================'

set role authenticated;
select set_config('test.user_id', '76760000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma nemá na náš tenant finance.manage — RLS odmítne celý insert',
  pg_temp.spadne_hlaskou(
    format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
      :'tenant', :'ucet', :'davka', 'csv_pokladna',
      '[{"datum":"2026-10-06","smer":"prijem","castka_haleru":888,"externi_id":"k76-utok-2"}]'),
    '42501', ''));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po útoku cizí firmy se útočný řádek nevložil',
  not exists (select 1 from public.transakce where externi_id = 'k76-utok-2'));


\echo ''
\echo '== Úklid ======================================================'

delete from public.transakce where import_davka_id = :'davka' or externi_id like 'k76-%';
delete from public.import_davky where id = :'davka';
delete from public.platebni_ucty where id in (:'ucet', :'ucet_cizi');

select pg_temp.check('úklid: po scénáři nezůstala žádná transakce kroku 76',
  not exists (select 1 from public.transakce where externi_id like 'k76-%'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 76 HOTOV =============================================='
