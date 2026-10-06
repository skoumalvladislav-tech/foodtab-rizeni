-- Scénář pro krok 86 — oprava bezpečnostní díry z auditu bankovního
-- modulu (6. 10. 2026): migrace 20261004100000 odebrala přímý INSERT
-- do `platby_faktury` (jen přes `app.potvrdit_alokaci_platby`), ale
-- UPDATE zůstal omylem grantovaný `authenticated` ještě z P0 migrace
-- (20261003130000). Šlo tak přímým `.update()` z klienta obejít
-- advisory zámek i kontrolu přečerpání alokace, a třeba vrátit
-- zamítnutou alokaci zpátky na `potvrzeno` bez průchodu RPC.
-- Oprava: 20261006100000_platby_faktury_zamknuti_update.sql.
--
-- Pokrývá:
--   1. přímý UPDATE na `platby_faktury` vlastní firmou SPADNE (grant
--      odebraný) — i když by cílil jen na vlastní řádek;
--   2. konkrétně scénář, co oprava zavírá: obejití `zrusit_alokaci_platby`
--      přímým vrácením `zamitnuto` → `potvrzeno`;
--   3. `app.zrusit_alokaci_platby` (SECURITY DEFINER) dál funguje beze
--      změny — revoke neomezuje její vlastní zápis.

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

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok86 bankovní účet', 'banka')
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 50000, current_date, 'rucni')
returning id as transakce \gset

select alokovano_celkem_haleru as alokovano, plne_uhrazeno as plne
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce', 'FAKTURA-KROK86', 50000, 50000, null) \gset

select id as alokace from public.platby_faktury
  where transakce_id = :'transakce' and faktura_id = 'FAKTURA-KROK86' \gset

select pg_temp.check('alokace přes RPC se zapsala jako potvrzeno',
  exists (select 1 from public.platby_faktury where id = :'alokace' and stav = 'potvrzeno'));


\echo ''
\echo '== 1. Přímý UPDATE na platby_faktury (vlastní řádek, vlastní firma) SPADNE =='

select pg_temp.check('UPDATE castka_haleru přímo z klienta je odepřený (grant odebraný, ne jen RLS)',
  pg_temp.spadne_hlaskou(
    format('update public.platby_faktury set castka_haleru = 1 where id = %L', :'alokace'),
    '42501', 'permission denied'));

select pg_temp.check('po pádu zůstala castka_haleru beze změny',
  (select castka_haleru from public.platby_faktury where id = :'alokace') = 50000);


\echo ''
\echo '== 2. Konkrétní obcházený scénář: zamítnuto -> potvrzeno přímým zápisem SPADNE =='

select app.zrusit_alokaci_platby(:'tenant', :'alokace'::uuid, 'krok86 test');

select pg_temp.check('po zrušení má alokace stav zamitnuto',
  (select stav from public.platby_faktury where id = :'alokace') = 'zamitnuto');

select pg_temp.check('přímé vrácení zamitnuto -> potvrzeno mimo RPC je odepřené (přesně díra, co oprava zavírá)',
  pg_temp.spadne_hlaskou(
    format('update public.platby_faktury set stav = %L where id = %L', 'potvrzeno', :'alokace'),
    '42501', 'permission denied'));

select pg_temp.check('po pokusu zůstává alokace zamitnuto, ne potvrzeno',
  (select stav from public.platby_faktury where id = :'alokace') = 'zamitnuto');


\echo ''
\echo '== 3. app.zrusit_alokaci_platby dál funguje — revoke ji neomezuje (SECURITY DEFINER) =='

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 30000, current_date, 'rucni')
returning id as transakce_2 \gset

select alokovano_celkem_haleru as alokovano_2
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce_2', 'FAKTURA-KROK86-B', 30000, 30000, null) \gset

select id as alokace_2 from public.platby_faktury
  where transakce_id = :'transakce_2' and faktura_id = 'FAKTURA-KROK86-B' \gset

select app.zrusit_alokaci_platby(:'tenant', :'alokace_2'::uuid, 'krok86 druhý test');

select pg_temp.check('zrusit_alokaci_platby (SECURITY DEFINER) zapsal zamitnuto i po revoke UPDATE z authenticated',
  (select stav from public.platby_faktury where id = :'alokace_2') = 'zamitnuto');


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.platby_faktury where transakce_id in (:'transakce', :'transakce_2');
delete from public.transakce where id in (:'transakce', :'transakce_2');
delete from public.platebni_ucty where id = :'ucet';

select pg_temp.check('úklid: po scénáři nezůstala žádná alokace kroku 86',
  not exists (select 1 from public.platby_faktury where id in (:'alokace', :'alokace_2')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 86 HOTOV =============================================='
