-- Scénář pro krok 77 — počáteční zůstatek a app.aktualni_zustatky_uctu.
--
-- Migrace: 20261003180000_pocatecni_zustatek.sql,
-- 20261003190000_aktualni_zustatky.sql. Plán: proud-scribbling-glade.md,
-- oddíl "Finance a účetnictví — PLNÁ ŠÍŘE zadání".
--
-- Pokrývá:
--   1. pocatecni_zustatek_haleru se započítá do aktuálního zůstatku;
--   2. transakce (prijem/vydaj) saldo upraví správným znaménkem;
--   3. firemní účet (branch_id null) se počítá samostatně, ne do pobočky;
--   4. cizí firma na public.aktualni_zustatky_uctu nic nevidí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 1. Počáteční zůstatek + transakce ==========================='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, pocatecni_zustatek_haleru)
values (:'tenant', :'perla', 'Krok77 pokladna', 'pokladna', 500000)
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 200000, current_date, 'rucni');
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 50000, current_date, 'rucni');

select zustatek_haleru as zustatek_perla
  from public.aktualni_zustatky_uctu(:'tenant')
  where branch_id = :'perla' \gset

select pg_temp.check('zůstatek = počáteční (500000) + příjem (200000) - výdaj (50000) = 650000',
  :'zustatek_perla'::bigint = 650000);


\echo ''
\echo '== 2. Firemní účet (bez pobočky) se počítá samostatně =========='

insert into public.platebni_ucty (tenant_id, nazev, typ, pocatecni_zustatek_haleru)
values (:'tenant', 'Krok77 firemní účet', 'banka', 1000000)
returning id as ucet_firemni \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet_firemni', 'vydaj', 100000, current_date, 'rucni');

select zustatek_haleru as zustatek_firma
  from public.aktualni_zustatky_uctu(:'tenant')
  where branch_id is null \gset

select pg_temp.check('firemní účet: 1000000 - 100000 = 900000, nesečteno s pobočkou',
  :'zustatek_firma'::bigint = 900000);

select zustatek_haleru as zustatek_perla_znovu
  from public.aktualni_zustatky_uctu(:'tenant')
  where branch_id = :'perla' \gset

select pg_temp.check('zůstatek pobočky se firemním účtem NEzměnil (stále 650000)',
  :'zustatek_perla_znovu'::bigint = 650000);


\echo ''
\echo '== 3. Cizí firma nevidí nic ===================================='

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('77770000-0000-0000-0000-000000000001', 'xaver77@jinafirma.cz', '{"full_name":"Xaver Sedmdesátsedm"}');
set role authenticated;
select set_config('test.user_id', '77770000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok77 Cizí s.r.o.', 'Xaver Sedmdesátsedm') as tenant_b \gset

select pg_temp.check('cizí firma na náš tenant nevidí žádný zůstatek',
  not exists (select 1 from public.aktualni_zustatky_uctu(:'tenant')));

reset role;
select set_config('test.user_id', '', false);
set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.transakce where ucet_id in (:'ucet', :'ucet_firemni');
delete from public.platebni_ucty where id in (:'ucet', :'ucet_firemni');

select pg_temp.check('úklid: po scénáři nezůstala žádná transakce kroku 77',
  not exists (select 1 from public.platebni_ucty where id in (:'ucet', :'ucet_firemni')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 77 HOTOV =============================================='
