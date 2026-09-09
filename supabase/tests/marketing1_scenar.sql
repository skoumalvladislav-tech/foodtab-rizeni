-- Scénář marketing 1 — po opuštění starého modulu.
--
-- Zadání: docs/marketing-je-modul.md, oddíl 3.
--
-- ---------------------------------------------------------------------
-- PROČ JE TENHLE SOUBOR CELÝ JINÝ NEŽ BYL
--
-- Do 9. 9. 2026 tu bylo 260 řádků, které zkoušely pět tabulek
-- z 20260903040000_marketing_tabulky.sql. Ty tabulky
-- 20260909160000_stary_marketing_pryc.sql zahodila, protože se do nich
-- nikdy nic nezapsalo a marketing se staví znovu jako modul Foodtabu.
--
-- Nechat ten scénář ležet by byl přesně případ ze skillu `scenar`,
-- oddíl 6: kontrola, která zůstane zelená a přestane měřit. Padl by
-- hned na prvním `insert` — ale kdyby ne, ověřoval by model, který už
-- neplatí.
--
-- Zbývají dvě věci, které mají cenu hlídat:
--
--   1. že se těch pět tabulek NEVRÁTÍ. Prázdná schránka po opuštěném
--      modulu je horší než žádná: za půl roku ji někdo vezme jako
--      platný model a začne na ní stavět.
--   2. že modul `marketing` a jeho tři oprávnění platí dál. Ty NEJSOU
--      z té zahozené migrace — jsou z 20260823120100_catalog.sql
--      a nový modul je používá. Kdyby je úklid vzal s sebou, firmy by
--      o zapnutý modul přišly a nikdo by nevěděl proč.
--
-- Až vzniknou tabulky nového modulu, přibude marketing2_scenar. Tenhle
-- soubor zůstane tím, čím je: stráží, že se staré nevrátí.
--
-- Vlastní číselná řada (marketingN_scenar.sql), oddělená od provozní
-- krokN_scenar.sql — CLAUDE.md, „Dvě relace v jednom repozitáři".

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as cisnik   from public.profiles where email = 'cisnik@foodtab.cz'   \gset


\echo ''
\echo '== Pět tabulek starého modulu je pryč a nevrací se ==========='

-- Jmenovitě, ne plošně přes `marketing\_%`. Plošná podmínka by spadla
-- v tu chvíli, kdy nový modul založí první tabulku — a někdo by ji
-- prostě smazal. Těchhle pět je úplný výčet toho, co zahozená migrace
-- zakládala; nic dalšího po ní nezbylo (politiky, granty, indexy
-- a spouště padají s tabulkou).

select pg_temp.check('marketing_settings neexistuje',
  to_regclass('public.marketing_settings') is null);
select pg_temp.check('marketing_integrations neexistuje',
  to_regclass('public.marketing_integrations') is null);
select pg_temp.check('marketing_photos neexistuje',
  to_regclass('public.marketing_photos') is null);
select pg_temp.check('marketing_templates neexistuje',
  to_regclass('public.marketing_templates') is null);
select pg_temp.check('marketing_posts neexistuje',
  to_regclass('public.marketing_posts') is null);

select pg_temp.check('strážce přechodů příspěvku je pryč taky',
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'strez_prechod_marketing_postu'));


-- MODUL A JEHO TŘI OPRÁVNĚNÍ: hlídá je krok3, ne tenhle scénář.
--
-- Napsal jsem sem nejdřív čtyři kontroly, že po úklidu zůstal v katalogu
-- modul `marketing` a jeho tři práva. Při schválném rozbití se ukázalo,
-- že žádná z nich nemůže spadnout jako první: `krok3_scenar` porovnává
-- CELÝ seznam oprávnění proti lib/authz.ts, takže jakoukoli ztrátu
-- ohlásí dřív — a přísněji, protože pozná i práva, na která bych tady
-- zapomněl.
--
-- Čtyři kontroly, které nikdy nefiknou, jsou přesně to, před čím varuje
-- skill `scenar`: tváří se jako důkaz a nic neměří. Proto tu nejsou.
-- Kdyby někdo krok3 zúžil, patří ta ochrana zpátky sem.

\echo ''
\echo '== Vypnutý modul odmítne i přímé volání — pravidlo 5 ========='

-- Výchozí stav firmy: marketing zapnutý NEMÁ. Kdyby ho měla, kontrola
-- níž by byla zelená ze špatného důvodu, proto se to ověřuje zvlášť.
select pg_temp.check('firma marketing zapnutý nemá (výchozí stav)',
  not exists (select 1 from public.tenant_modules
              where tenant_id = :'tenant' and module_key = 'marketing'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel bez zapnutého modulu nemá marketing.read',
  not app.has_access(:'tenant', 'marketing.read', :'perla'));
select pg_temp.check('majitel bez zapnutého modulu nemá marketing.manage',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));
select pg_temp.check('majitel bez zapnutého modulu nemá marketing.publish',
  not app.has_access(:'tenant', 'marketing.publish', :'perla'));


\echo ''
\echo '== Po zapnutí práva naskočí ze zařazení ======================'

reset role;
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('po zapnutí má majitel marketing.read/manage/publish',
  app.has_access(:'tenant', 'marketing.read', :'perla')
  and app.has_access(:'tenant', 'marketing.manage', :'perla')
  and app.has_access(:'tenant', 'marketing.publish', :'perla'));

select set_config('test.user_id', :'provozni', false);
select pg_temp.check('provozní dostal marketing.manage ze svého zařazení, bez zásahu',
  app.has_access(:'tenant', 'marketing.manage', :'perla'));

-- Kdo do modulu nepatří, ho nedostane ani po zapnutí. Bez téhle
-- kontroly by „po zapnutí to má majitel" nerozlišilo mezi právem ze
-- zařazení a tím, že modul rozdává všem.
select set_config('test.user_id', :'cisnik', false);
select pg_temp.check('číšník marketing.manage nemá ani po zapnutí modulu',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';
select pg_temp.check('scénář vrátil modul do vypnutého stavu',
  not exists (select 1 from public.tenant_modules
              where tenant_id = :'tenant' and module_key = 'marketing'));


\echo ''
\echo '=========================================================='
\echo ' MARKETING 1 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
