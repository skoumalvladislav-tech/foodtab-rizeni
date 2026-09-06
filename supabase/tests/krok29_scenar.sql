-- Scénář pro krok 29 — „Dnes": jsem v práci, nebo ne?
--
-- Pokrývá migraci 20260907010000_muj_den a zadání
-- docs/dnes-obrazovka-zadani.md, body 3 a 7.
--
-- Navazuje na etapa0_scenar.sql až krok28_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Na otázku „jsem v práci?" umí aplikace odpovědět třemi různými
-- způsoby a dva z nich se liší:
--
--   * Docházka se ptá na POSLEDNÍ UDÁLOST a nefiltruje ani storno, ani
--     příchod uzavřený systémem,
--   * `app.otevreny_prichod` se ptá na otevřený příchod a filtruje
--     obojí,
--   * `app.smena_ted` k tomu přidává, že musí jít o dnešní provozní den.
--
-- `muj_den` bere ten prostřední a je to schválně. Nejdůležitější
-- kontroly tady jsou proto ty, které měří rozdíl: stornovaný příchod
-- a příchod uzavřený systémem NESMÍ tvrdit „jste v práci", zatímco
-- otevřený příchod z včerejší noční ANO — ten se má ukázat právě proto,
-- že není z dneška.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
--
-- Vlastní člověk, ne někdo ze seedu: bude se mu schválně přepisovat
-- docházka a ostatní scénáře s ním počítají jinak.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset
select id as role_servis from public.roles
 where tenant_id = :'tenant' and key = 'servis' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('77770000-0000-0000-0000-000000000077', 'karel@foodtab.cz',
   '{"full_name":"Karel Dnešní"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '77770000-0000-0000-0000-000000000077',
        'Karel Dnešní', 'hpp');
select id as karel from public.employees
 where user_id = '77770000-0000-0000-0000-000000000077' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '77770000-0000-0000-0000-000000000077', :'role_servis',
        'branch', 'active');
select id as clen_karel from public.memberships
 where user_id = '77770000-0000-0000-0000-000000000077' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_karel', :'perla');

select set_config('test.tenant', :'tenant', false);
select set_config('test.karel', :'karel', false);
select app.business_date(:'perla', now()) as dnes \gset


\echo ''
\echo '== 1. Bez příchodu není člověk v práci =================='

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;

select v_praci as vp0, pobocka as pob0, provozni_den as pd0
from public.muj_den(:'tenant') \gset

select pg_temp.check('bez příchodu není v práci', :'vp0' = 'f');
select pg_temp.check('a pobočka je ta domovská', :'pob0' = :'perla');
select pg_temp.check('provozní den je dnešní', :'pd0' = :'dnes');

reset role;


\echo ''
\echo '== 2. Po píchnutí je v práci ============================'

select udalost as u1 from app.pichnout(:'tenant', :'perla', :'karel', 'in') \gset

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp1, od_kdy as od1, den_prichodu as dp1
from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('po píchnutí je v práci', :'vp1' = 't');
select pg_temp.check('a ví se, od kdy', :'od1' <> '');
select pg_temp.check('příchod je z dnešního provozního dne', :'dp1' = :'dnes');


\echo ''
\echo '== 3. Stornovaný příchod „v práci" neznamená ============'

/*
  TOHLE JE ROZDÍL PROTI DOCHÁZCE.

  Docházka se ptá na poslední událost a `stornovano_kdy` nefiltruje —
  po stornu tedy pořád tvrdí „jste v práci". `muj_den` bere
  `app.otevreny_prichod`, která storno filtruje.

  Schválně rozbito: když se `muj_den` přepíše na „poslední událost",
  tahle kontrola spadne.
*/
reset role;
update public.attendance_events set stornovano_kdy = now() where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp2 from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('stornovaný příchod v práci nedrží', :'vp2' = 'f');

-- Vrátit, ať se dá pokračovat.
update public.attendance_events set stornovano_kdy = null where id = :'u1';


\echo ''
\echo '== 4. Příchod uzavřený systémem taky ne ================='

/*
  `uzavreno_systemem` znamená „tenhle už neblokuje další příchod"
  (20260905010000). Není to čas odchodu a do hodin se nezapočítá —
  ale hlavně: člověk podle něj v práci NENÍ.
*/
reset role;
update public.attendance_events set uzavreno_systemem = now() where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp3 from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('příchod uzavřený systémem v práci nedrží', :'vp3' = 'f');

update public.attendance_events set uzavreno_systemem = null where id = :'u1';


\echo ''
\echo '== 5. Noční směna z včerejška se UKÁŽE =================='

/*
  Zadání, bod 3: „Když je otevřený příchod z včerejška (noční), karta
  ukáže jeho, ne dnešek."

  Je to schválně jinak než u doručování zpráv. `app.smena_ted` od 6. 9.
  končí s provozním dnem, ve kterém se píchlo — tam jde o to, aby
  aplikace nezvonila ve tři ráno zapomenutému odchodu. Na kartě je to
  obráceně: člověk se na to potřebuje podívat PRÁVĚ PROTO, že je to
  z včerejška.

  Posouvá se o 26 hodin, ne o 20: dvacet hodin zpátky je jiný
  kalendářní den jen do osmé večer (CLAUDE.md, „Testy, které závisí
  na kalendáři").
*/
reset role;
update public.attendance_events
   set occurred_at = now() - interval '26 hours',
       business_date = :'dnes'::date - 1
 where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp4, den_prichodu as dp4, provozni_den as pd4
from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('otevřený příchod z včerejška je pořád „v práci"', :'vp4' = 't');
select pg_temp.check('a je poznat, že je ze staršího dne',
  :'dp4'::date < :'pd4'::date);

/*
  A pro srovnání: doručování zpráv ho už za směnu NEBERE. Ty dvě
  odpovědi se schválně liší a tahle kontrola to drží — kdyby se
  `muj_den` někdo pokusil „sjednotit" se `smena_ted`, spadne oddíl 5.
*/
select pg_temp.check('doručování zpráv ho za směnu už nebere',
  app.smena_ted(:'tenant', :'karel') is null);


\echo ''
\echo '== 6. Vypnutý modul a cizí firma ========================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma nedostane nic',
  (select count(*) from public.muj_den(:'tenant')) = 0);

reset role;

select pg_temp.check('muj_den se ptá na zapnutý modul',
  pg_get_functiondef('public.muj_den(uuid)'::regprocedure) like '%modul_zapnuty%');

/*
  A že se „v práci" bere z otevřeného příchodu, ne z poslední události.
  Je to strukturální kontrola, ale drží tvrzení z hlavičky: tři různé
  odpovědi na jednu otázku by se časem rozešly.
*/
select pg_temp.check('a „v práci" staví na app.otevreny_prichod',
  pg_get_functiondef('public.muj_den(uuid)'::regprocedure) like '%otevreny_prichod%');


\echo ''
\echo '== KROK 29 HOTOV ========================================'
