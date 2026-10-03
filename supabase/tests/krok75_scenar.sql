-- Scénář pro krok 75 — public.* průzor pro PostgREST (Finance ERP).
--
-- Migrace: 20261003160000_finance_public_rpc.sql. Plán:
-- proud-scribbling-glade.md, oddíl "Finance a účetnictví — gastro ERP
-- modul".
--
-- PostgREST vidí jen `public` (supabase/config.toml), takže appka na
-- `app.integrace_*`/`app.cashflow_prehled*` nedosáhne přímo — tenhle
-- scénář ověřuje, že obal v `public` doopravdy PŘEPOSÍLÁ (stejná
-- hodnota jako přímé volání `app.*`), ne že si dělá vlastní rozhodnutí,
-- a že `anon` na něj nemá exekuci.
--
-- Pokrývá:
--   0. příprava (modul finance aktivní);
--   1. public.integrace_uloz_tajemstvi/_precti_tajemstvi přeposílají
--      přesně to, co by vrátilo přímé app.*;
--   2. public.cashflow_prehled/_firma přeposílají přesně to, co app.*;
--   3. anon nemá execute na žádnou z pěti funkcí.

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


\echo ''
\echo '== 1. integrace_* — public přeposílá přesně to, co app ======'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', 'banka', 'csv_import', 'csv', 'Krok75 testovací banka')
returning id as pripojeni \gset

select public.integrace_uloz_tajemstvi(:'pripojeni', 'sifra-krok75', 'otisk-krok75');

select pg_temp.check('public.integrace_precti_tajemstvi vrátí to, co se uložilo přes public.integrace_uloz_tajemstvi',
  public.integrace_precti_tajemstvi(:'pripojeni') = 'sifra-krok75');

select pg_temp.check('public.integrace_precti_tajemstvi se shoduje s přímým app.integrace_precti_tajemstvi',
  public.integrace_precti_tajemstvi(:'pripojeni') = app.integrace_precti_tajemstvi(:'pripojeni'));


\echo ''
\echo '== 2. cashflow_prehled* — public přeposílá přesně to, co app =='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok75 pokladna', 'pokladna')
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 33300, current_date, 'rucni')
returning id as transakce \gset

select prijmy_haleru as pub_prijmy, vydaje_haleru as pub_vydaje
  from public.cashflow_prehled(:'tenant', current_date, current_date)
  where branch_id = :'perla' \gset

select prijmy_haleru as app_prijmy, vydaje_haleru as app_vydaje
  from app.cashflow_prehled(:'tenant', current_date, current_date)
  where branch_id = :'perla' \gset

select pg_temp.check('public.cashflow_prehled vrací stejné příjmy jako app.cashflow_prehled',
  :'pub_prijmy' = :'app_prijmy');
select pg_temp.check('public.cashflow_prehled vrací stejné výdaje jako app.cashflow_prehled',
  :'pub_vydaje' = :'app_vydaje');
select pg_temp.check('public.cashflow_prehled skutečně zachytil novou transakci (33300)',
  :'pub_prijmy'::integer = 33300);

select prijmy_haleru as pubf_prijmy from public.cashflow_prehled_firma(:'tenant', current_date, current_date) \gset
select prijmy_haleru as appf_prijmy from app.cashflow_prehled_firma(:'tenant', current_date, current_date) \gset

select pg_temp.check('public.cashflow_prehled_firma vrací stejnou hodnotu jako app.cashflow_prehled_firma',
  :'pubf_prijmy' = :'appf_prijmy');


\echo ''
\echo '== 3. anon nemá execute na žádnou z pěti funkcí =============='

reset role;
set role anon;

select pg_temp.check('anon: integrace_uloz_tajemstvi odepřeno',
  pg_temp.spadne_hlaskou(format('select public.integrace_uloz_tajemstvi(%L, %L, %L)', :'pripojeni', 'x', 'y'), '42501', ''));
select pg_temp.check('anon: integrace_precti_tajemstvi odepřeno',
  pg_temp.spadne_hlaskou(format('select public.integrace_precti_tajemstvi(%L)', :'pripojeni'), '42501', ''));
select pg_temp.check('anon: integrace_smaz_tajemstvi odepřeno',
  pg_temp.spadne_hlaskou(format('select public.integrace_smaz_tajemstvi(%L)', :'pripojeni'), '42501', ''));
select pg_temp.check('anon: cashflow_prehled odepřeno',
  pg_temp.spadne_hlaskou(format('select * from public.cashflow_prehled(%L, current_date, current_date)', :'tenant'), '42501', ''));
select pg_temp.check('anon: cashflow_prehled_firma odepřeno',
  pg_temp.spadne_hlaskou(format('select * from public.cashflow_prehled_firma(%L, current_date, current_date)', :'tenant'), '42501', ''));


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.transakce where tenant_id = :'tenant' and id = :'transakce';
delete from public.platebni_ucty where tenant_id = :'tenant' and id = :'ucet';
delete from public.integrace_tajemstvi where pripojeni_id = :'pripojeni';
delete from public.integrace_pripojeni where id = :'pripojeni';

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 75 HOTOV =============================================='
