-- Scénář pro krok 81 — Vybavení (evidence, bez odpisů).
--
-- Migrace: 20261003230000_vybaveni.sql. Plán: proud-scribbling-glade.md,
-- oddíl "Finance a účetnictví — PLNÁ ŠÍŘE zadání".
--
-- Standardní RLS/grant vzor (žádné speciální RPC/trigger — je to
-- čistá evidence), scénář proto jen ověřuje základní čtení/zápis
-- a izolaci cizí firmy.

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

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('81810000-0000-0000-0000-000000000001', 'xaver81@jinafirma.cz', '{"full_name":"Xaver Osmdesátjeden"}');
set role authenticated;
select set_config('test.user_id', '81810000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok81 Cizí s.r.o.', 'Xaver Osmdesátjeden') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Majitel smí založit a vidí ==============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.vybaveni (tenant_id, branch_id, nazev, kategorie, datum_porizeni, cena_haleru, zaruka_do)
values (:'tenant', :'perla', 'Krok81 konvektomat', 'kuchyňské zařízení', '2026-01-15', 15000000, '2028-01-15')
returning id as vybaveni \gset

select pg_temp.check('vybavení se zapsalo', exists (select 1 from public.vybaveni where id = :'vybaveni'));
select pg_temp.check('majitel vidí vlastní vybavení', exists (select 1 from public.vybaveni where id = :'vybaveni' and tenant_id = :'tenant'));


\echo ''
\echo '== 2. Soft-delete (deleted_at), ne mazání ======================'

update public.vybaveni set deleted_at = now() where id = :'vybaveni';

select pg_temp.check('po soft-delete je řádek stále v databázi (jen deleted_at)',
  exists (select 1 from public.vybaveni where id = :'vybaveni' and deleted_at is not null));


\echo ''
\echo '== 3. Cizí firma nevidí ========================================='

select set_config('test.user_id', '81810000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma naše vybavení nevidí', not exists (select 1 from public.vybaveni where id = :'vybaveni'));

update public.vybaveni set poznamka = 'útok' where id = :'vybaveni';

reset role;
select poznamka as poznamka_po_utoku from public.vybaveni where id = :'vybaveni' \gset
set role authenticated;
select set_config('test.user_id', '81810000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma do našeho vybavení nezapíše (RLS update tiše nic nezmění)',
  :'poznamka_po_utoku' <> 'útok');

select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.vybaveni where id = :'vybaveni';

select pg_temp.check('úklid: po scénáři nezůstalo žádné vybavení kroku 81',
  not exists (select 1 from public.vybaveni where id = :'vybaveni'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 81 HOTOV =============================================='
