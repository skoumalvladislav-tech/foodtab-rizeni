-- Scénář pro krok 88 — dopravek k 20261006120000: `platby_faktury`
-- omylem chyběla v seznamu šesti tabulek, co dostaly odebraný DELETE
-- grant (nahrazeno `kontakty_osoby`, aniž by se zkontrolovalo, že
-- `platby_faktury` byl v PŮVODNÍM nálezu taky). Odhaleno živým
-- dotazem proti `foodtab-test` PO nasazení 20261006120000, ne
-- čtením kódu. Oprava: 20261006130000_platby_faktury_delete_zapomenuto.sql.
--
-- Pokrývá: přímý DELETE na `platby_faktury` SPADNE, a alokace
-- vytvořená přes `app.potvrdit_alokaci_platby` PŘEŽIJE pokus o smazání.

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
values (:'tenant', :'perla', 'Krok88 bankovní účet', 'banka')
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 15000, current_date, 'rucni')
returning id as transakce \gset

select alokovano_celkem_haleru as alokovano
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce', 'FAKTURA-KROK88', 15000, 15000, null) \gset

select id as alokace from public.platby_faktury
  where transakce_id = :'transakce' and faktura_id = 'FAKTURA-KROK88' \gset


\echo ''
\echo '== 1. Přímý DELETE na platby_faktury SPADNE — alokace PŘEŽIJE =='

select pg_temp.check('přímý DELETE na platby_faktury je odepřený',
  pg_temp.spadne_hlaskou(
    format('delete from public.platby_faktury where id = %L', :'alokace'),
    '42501', 'permission denied'));

select pg_temp.check('po pokusu alokace STÁLE existuje a je potvrzeno',
  (select stav from public.platby_faktury where id = :'alokace') = 'potvrzeno');


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.platby_faktury where id = :'alokace';
delete from public.transakce where id = :'transakce';
delete from public.platebni_ucty where id = :'ucet';

select pg_temp.check('úklid: po scénáři nezůstal žádný účet kroku 88',
  not exists (select 1 from public.platebni_ucty where id = :'ucet'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 88 HOTOV =============================================='
