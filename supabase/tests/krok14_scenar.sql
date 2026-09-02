-- Scénář pro krok 14 — ruční záznam v pásmu pobočky.
--
-- Pokrývá migraci 20260902090000_pasmo_u_rucnich_zaznamu a nález
-- docs/nesedi-hodiny-po-rucnim-odchodu.md.
--
-- Navazuje na etapa0_scenar.sql až krok13_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU OVĚŘUJE A PROČ NA MINUTU
--
-- Kontrola „odpracovaných minut je víc než nula“ tuhle chybu neodhalila
-- a odhalit nemohla: minut bylo víc než nula pořád, jen jich bylo
-- o dvě hodiny víc, než mělo. Proto se tu všechno porovnává na
-- PŘESNOU HODNOTU.
--
-- Posun není konstantní: v létě dvě hodiny, v zimě jedna. Proto je
-- v scénáři letní i zimní datum — paušální „minus dvě hodiny“ by
-- prošlo jen jedno z nich.

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
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

-- Pásmo a začátek dne natvrdo, ať scénář nezávisí na tom, co po sobě
-- nechaly předchozí kroky.
update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id = :'perla';

-- Druhá pobočka v JINÉM pásmu. Na ní se pozná, že se pásmo bere
-- z pobočky, a ne že je někde zadrátovaná Praha.
update public.branches
  set timezone = 'Atlantic/Reykjavik', day_starts_at = '05:00'
  where id = :'bar';

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Pásmová Zkouška', 'hpp')
returning id as e_pasmo \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Islandská Zkouška', 'hpp')
returning id as e_island \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla',  :'perla',  false);
select set_config('test.e_pasmo', :'e_pasmo', false);


\echo ''
\echo '== 1. „22:00 pražského času“ se uloží jako 20:00 UTC ======'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pasmo', 'in',
  timestamp '2026-08-31 11:27', 'zkouška pásma — příchod') as ud_in_leto \gset

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pasmo', 'out',
  timestamp '2026-08-31 22:00', 'zkouška pásma — odchod') as ud_out_leto \gset

reset role;

select pg_temp.check('letní odchod leží na 20:00 UTC',
  (select occurred_at from public.attendance_events where id = :'ud_out_leto')
  = timestamptz '2026-08-31 20:00:00+00');

select pg_temp.check('a zpátky v Praze je z něj zase 22:00',
  to_char(
    (select occurred_at from public.attendance_events where id = :'ud_out_leto')
      at time zone 'Europe/Prague', 'HH24:MI') = '22:00');

/*
  A tohle je ta chyba, která tam byla: „22:00“ uložené jako 22:00 UTC,
  tedy půlnoc pražského času. Kdyby se převod vrátil, tenhle řádek
  spadne.
*/
select pg_temp.check('NENÍ uloženo jako 22:00 UTC',
  (select occurred_at from public.attendance_events where id = :'ud_out_leto')
  <> timestamptz '2026-08-31 22:00:00+00');


\echo ''
\echo '== 2. V zimě je posun jiný, ne dvě hodiny ================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

/*
  Nejdřív příchod. Od migrace 20260903020000 se odchod, ke kterému
  není co zavřít, odmítá — a je to tak správně; tenhle scénář si ho
  dřív zapisoval do prázdna, což je přesně to, co Šéfík dělal pětkrát
  za sebou. Na ověření pásma to nic nemění.
*/
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pasmo', 'in',
  timestamp '2026-01-15 14:00', 'zkouška pásma — zimní příchod') as ud_zima_in \gset

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pasmo', 'out',
  timestamp '2026-01-15 22:00', 'zkouška pásma — zima') as ud_zima \gset

reset role;

select pg_temp.check('zimní 22:00 leží na 21:00 UTC, ne na 20:00',
  (select occurred_at from public.attendance_events where id = :'ud_zima')
  = timestamptz '2026-01-15 21:00:00+00');

/*
  Kdyby se to opravovalo paušálním posunem o dvě hodiny, tenhle řádek
  by spadl. Je tu schválně.
*/
select pg_temp.check('paušální „minus dvě hodiny“ by na zimu nesedělo',
  (select occurred_at from public.attendance_events where id = :'ud_zima')
  <> timestamptz '2026-01-15 20:00:00+00');


\echo ''
\echo '== 3. Odpracované minuty sedí NA MINUTU ==================='

/*
  Příchod 11:27, odchod 22:00 — tedy 10 h 33 min, přesně ta směna,
  o které byl celý nález. Ne „víc než nula“.
*/
select pg_temp.check('10 h 33 min, ani o minutu jinak',
  (select minut from app.worked_minutes(:'e_pasmo', date '2026-08-31', date '2026-08-31'))
  = 633);

-- A ať je vidět, co by vyšlo se starou chybou: o dvě hodiny víc.
select pg_temp.check('rozhodně ne 12 h 33 min, jak to počítalo dřív',
  (select minut from app.worked_minutes(:'e_pasmo', date '2026-08-31', date '2026-08-31'))
  <> 753);


\echo ''
\echo '== 4. Pásmo se bere z POBOČKY, ne odjinud ================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Reykjavík je celoročně na UTC. Táž hodina na zdi tedy vyjde jinam
-- než v Praze — kdyby bylo pásmo zadrátované, tenhle řádek spadne.
select public.zapsat_rucni_dochazku(
  :'tenant', :'bar', :'e_island', 'in',
  timestamp '2026-08-31 22:00', 'zkouška pásma — Island') as ud_island \gset

reset role;

select pg_temp.check('na Islandu je 22:00 na zdi rovno 22:00 UTC',
  (select occurred_at from public.attendance_events where id = :'ud_island')
  = timestamptz '2026-08-31 22:00:00+00');

select pg_temp.check('a v Praze byla táž hodina na zdi o dvě hodiny dřív',
  (select occurred_at from public.attendance_events where id = :'ud_out_leto')
  < (select occurred_at from public.attendance_events where id = :'ud_island'));


\echo ''
\echo '== 5. Směna přes hranici provozního dne ==================='

/*
  Pobočka začíná den v 05:00. Příchod ve 22:00 patří do 14. 7., odchod
  ve 3:30 ráno taky — ještě se nezačal nový provozní den.

  Se starou chybou by se „03:30“ uložilo jako 03:30 UTC, tedy 05:30
  pražského času, a odchod by spadl do 15. 7. Směna by se rozpadla
  přes hranici dne a otevřená půlka by podle komentáře v mzdy_vypocet
  PROPADLA. Tady se to pozná.
*/
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Půlnoční Pásmo', 'hpp')
returning id as e_pulnoc \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pulnoc', 'in',
  timestamp '2026-07-14 22:00', 'zkouška hranice dne — příchod') as ud_noc_in \gset

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_pulnoc', 'out',
  timestamp '2026-07-15 03:30', 'zkouška hranice dne — odchod') as ud_noc_out \gset

reset role;

select pg_temp.check('příchod patří do 14. 7.',
  (select business_date from public.attendance_events where id = :'ud_noc_in')
  = date '2026-07-14');

select pg_temp.check('odchod ve 3:30 patří do TÉHOŽ dne, ne do 15. 7.',
  (select business_date from public.attendance_events where id = :'ud_noc_out')
  = date '2026-07-14');

select pg_temp.check('a odchod leží na 01:30 UTC',
  (select occurred_at from public.attendance_events where id = :'ud_noc_out')
  = timestamptz '2026-07-15 01:30:00+00');

select pg_temp.check('směna má 5 h 30 min, ne 7 h 30 min',
  (select minut from app.worked_minutes(:'e_pulnoc', date '2026-07-14', date '2026-07-14'))
  = 330);

select pg_temp.check('a nic nepropadlo do 15. 7.',
  coalesce((select minut from app.worked_minutes(
     :'e_pulnoc', date '2026-07-15', date '2026-07-15')), 0) = 0);


\echo ''
\echo '== 6. Kdo nemá právo, ručně nezapíše ======================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Číšník docházku nespravuje.
select user_id as marek from public.profiles where email = 'cisnik@foodtab.cz' \gset
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zapsat_rucni_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.perla')::uuid,
      current_setting('test.e_pasmo')::uuid,
      'out', timestamp '2026-08-31 23:00', 'zkouška bez oprávnění');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: ruční zápis prošel bez oprávnění'; end if;
  raise notice '  OK    bez attendance.manage ruční zápis neprojde';
end $$;

reset role;

-- Uklidit po sobě: Bernard Bar zpátky do Prahy.
update public.branches set timezone = 'Europe/Prague' where id = :'bar';


\echo ''
\echo '== KROK 14 HOTOV ========================================='
