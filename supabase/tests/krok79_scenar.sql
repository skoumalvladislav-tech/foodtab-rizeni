-- Scénář pro krok 79 — Rozpočty a controlling (plan-to-control).
--
-- Migrace: 20261003210000_rozpocty_controlling.sql. Plán:
-- proud-scribbling-glade.md, oddíl "Finance a účetnictví — PLNÁ ŠÍŘE
-- zadání".
--
-- Pokrývá:
--   1. app.vysledovka: skutečnost agregovaná po kategorii/směru;
--   2. firemní účet (branch_id null) se nepromítá do pobočkového
--      vysledovka, stejně jako u cashflow_prehled;
--   3. app.rozpocet_prehled: plán vs. skutečnost, odchylka;
--   4. FULL OUTER JOIN: kategorie se skutečností bez plánu se ukáže;
--   5. cizí firma nevidí nic.

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
\echo '== 0. Příprava ================================================='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok79 pokladna', 'pokladna')
returning id as ucet \gset

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant', 'Krok79 firemní účet', 'banka')
returning id as ucet_firemni \gset

select pg_temp.check('příprava: oba účty se zapsaly', :'ucet' is not null and :'ucet_firemni' is not null);


\echo ''
\echo '== 1. app.vysledovka: agregace po kategorii/směru =============='

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, kategorie)
values (:'tenant', :'ucet', 'prijem', 500000, '2026-10-15', 'rucni', 'trzby');
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, kategorie)
values (:'tenant', :'ucet', 'vydaj', 150000, '2026-10-16', 'rucni', 'suroviny');
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, kategorie)
values (:'tenant', :'ucet', 'vydaj', 50000, '2026-10-17', 'rucni', 'suroviny');
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 10000, '2026-10-18', 'rucni'); -- bez kategorie

select kategorie as kat_trzby, castka_haleru as castka_trzby
  from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31')
  where kategorie = 'trzby' \gset

select pg_temp.check('tržby pobočky Perla = 500000', :'castka_trzby'::bigint = 500000);

select castka_haleru as castka_suroviny
  from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31')
  where kategorie = 'suroviny' \gset

select pg_temp.check('suroviny pobočky Perla = 150000+50000 = 200000', :'castka_suroviny'::bigint = 200000);

select castka_haleru as castka_nezarazeno
  from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31')
  where kategorie = 'nezarazeno' \gset

select pg_temp.check('transakce bez kategorie se ukáže jako "nezarazeno", ne zmizí', :'castka_nezarazeno'::bigint = 10000);


\echo ''
\echo '== 2. Firemní účet se NEpromítá do pobočkové výsledovky ========'

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, kategorie)
values (:'tenant', :'ucet_firemni', 'vydaj', 999999, '2026-10-20', 'rucni', 'najem');

select castka_haleru as castka_suroviny_znovu
  from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31')
  where kategorie = 'suroviny' \gset

select pg_temp.check('firemní účet (nájem) nezměnil pobočkovou kategorii suroviny',
  :'castka_suroviny_znovu'::bigint = 200000);

select pg_temp.check('pobočková výsledovka nemá kategorii najem vůbec (firemní účet patří jinam)',
  not exists (select 1 from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31') where kategorie = 'najem'));

select castka_haleru as castka_najem_firma
  from public.vysledovka(:'tenant', null, '2026-10-01', '2026-10-31')
  where kategorie = 'najem' \gset

select pg_temp.check('firemní výsledovka (branch null) vidí nájem', :'castka_najem_firma'::bigint = 999999);


\echo ''
\echo '== 3. app.rozpocet_prehled: plán vs. skutečnost, odchylka ======'

insert into public.rozpocty (tenant_id, branch_id, kategorie, smer, rok, mesic, castka_haleru, je_fixni)
values (:'tenant', :'perla', 'suroviny', 'vydaj', 2026, 10, 180000, false);

select plan_haleru, skutecnost_haleru, odchylka_haleru
  from public.rozpocet_prehled(:'tenant', :'perla', 2026, 10)
  where kategorie = 'suroviny' and smer = 'vydaj' \gset

select pg_temp.check('plán surovin = 180000', :'plan_haleru'::bigint = 180000);
select pg_temp.check('skutečnost surovin = 200000', :'skutecnost_haleru'::bigint = 200000);
select pg_temp.check('odchylka = skutečnost - plán = 20000 (přečerpáno)', :'odchylka_haleru'::bigint = 20000);


\echo ''
\echo '== 4. FULL OUTER JOIN: skutečnost bez plánu se ukáže ==========='

select plan_haleru, skutecnost_haleru
  from public.rozpocet_prehled(:'tenant', :'perla', 2026, 10)
  where kategorie = 'trzby' and smer = 'prijem' \gset

select pg_temp.check('tržby nemají plán (0), ale skutečnost se ukáže (500000), ne zmizí',
  :'plan_haleru'::bigint = 0 and :'skutecnost_haleru'::bigint = 500000);


\echo ''
\echo '== 5. Cizí firma nevidí nic ====================================='

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('79790000-0000-0000-0000-000000000001', 'xaver79@jinafirma.cz', '{"full_name":"Xaver Sedmdesátdevět"}');
set role authenticated;
select set_config('test.user_id', '79790000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok79 Cizí s.r.o.', 'Xaver Sedmdesátdevět') as tenant_b \gset

select pg_temp.check('cizí firma na náš tenant nevidí žádnou výsledovku',
  not exists (select 1 from public.vysledovka(:'tenant', :'perla', '2026-10-01', '2026-10-31')));
select pg_temp.check('cizí firma na náš tenant nevidí žádný rozpočet',
  not exists (select 1 from public.rozpocet_prehled(:'tenant', :'perla', 2026, 10)));

reset role;
select set_config('test.user_id', '', false);
set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.transakce where ucet_id in (:'ucet', :'ucet_firemni');
delete from public.platebni_ucty where id in (:'ucet', :'ucet_firemni');
delete from public.rozpocty where tenant_id = :'tenant';

select pg_temp.check('úklid: po scénáři nezůstal žádný rozpočet kroku 79',
  not exists (select 1 from public.rozpocty where tenant_id = :'tenant'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 79 HOTOV =============================================='
