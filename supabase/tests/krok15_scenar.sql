-- Scénář pro krok 15 — storno záznamu docházky.
--
-- Pokrývá migraci 20260902100000_storno_dochazky a rozhodnutí
-- docs/rozhodnuti-stara-data-pasmo.md.
--
-- Navazuje na etapa0_scenar.sql až krok14_scenar.sql.
--
-- ---------------------------------------------------------------------
-- PROČ SE ZKOUŠÍ VŠECH SEDM MÍST
--
-- Storno, které zabere jen v mzdě, je horší než žádné: záznam se tváří
-- jako zrušený a přitom se dál počítá do ranního přehledu nebo drží
-- směnu otevřenou. Každý čtenář docházky se proto ptá zvlášť — a u
-- každého se nejdřív ověří, že PŘED stornem ten záznam vidí. Kontrola,
-- která tvrdí „nevidí ho“, ale nikdy ho neviděla, neověřuje nic.

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
-- Jeden člověk, jedna uzavřená směna 10. 6. od 8:00 do 18:00.
-- Datum je schválně jinde než u ostatních kroků, ať se nemíchají.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id = :'perla';

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Stornová Zkouška', 'hpp')
returning id as e_storno \gset

select set_config('test.tenant',   :'tenant',   false);
select set_config('test.e_storno', :'e_storno', false);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_storno', 'in',
  timestamp '2026-06-10 08:00', 'zkouška storna — příchod') as ud_in \gset

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_storno', 'out',
  timestamp '2026-06-10 18:00', 'zkouška storna — odchod') as ud_out \gset

reset role;
select set_config('test.ud_out', :'ud_out', false);
select set_config('test.ud_in',  :'ud_in',  false);


\echo ''
\echo '== PŘED stornem to všichni vidí =========================='

select pg_temp.check('mzda počítá 10 hodin',
  (select minut from app.worked_minutes(:'e_storno', date '2026-06-10', date '2026-06-10'))
  = 600);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select odpracovano_minut as min_pred, nedokoncenych as nedok_pred
  from public.ranni_prehled(:'tenant', date '2026-06-10')
  where branch_id = :'perla' \gset

select pg_temp.check('ranní přehled je taky vidí',
  :'min_pred'::integer >= 600);

select pg_temp.check('a nedokončená docházka nic nehlásí — směna je uzavřená',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', date '2026-06-10', date '2026-06-10')
   where employee_id = :'e_storno') = 0);

reset role;


\echo ''
\echo '== Storno ================================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.stornovat_dochazku(
  :'tenant', :'ud_out', 'Zkušební záznam z doby před opravou časového pásma.');

reset role;

select pg_temp.check('záznam se NESMAZAL, jen je označený',
  exists (select 1 from public.attendance_events where id = :'ud_out'));

select pg_temp.check('má čas storna',
  (select stornovano_kdy from public.attendance_events where id = :'ud_out') is not null);

select pg_temp.check('a má u sebe důvod',
  (select duvod_storna from public.attendance_events where id = :'ud_out')
  like 'Zkušební záznam%');

select pg_temp.check('storno je v auditu i s tím, co se ruší',
  exists (select 1 from public.audit_log
          where action = 'attendance.storno'
            and entity_id = :'ud_out'
            and before ->> 'kind' = 'out'));


\echo ''
\echo '== PO stornu ho nevidí nikdo ============================='

/*
  Odchod je pryč, takže z uzavřené směny je otevřená: mzda nepočítá
  nic (otevřený příchod se do součtu nedostane) a panel nedokončených
  ji naopak nově hlásí. Obojí je správně — a obojí se musí projevit.
*/
select pg_temp.check('mzda z té směny nepočítá nic',
  coalesce((select minut from app.worked_minutes(
     :'e_storno', date '2026-06-10', date '2026-06-10')), 0) = 0);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select odpracovano_minut as min_po, nedokoncenych as nedok_po
  from public.ranni_prehled(:'tenant', date '2026-06-10')
  where branch_id = :'perla' \gset

select pg_temp.check('ranní přehled o těch minutách přišel',
  :'min_po'::integer = :'min_pred'::integer - 600);

select pg_temp.check('a hlásí o jednu rozdělanou směnu víc',
  :'nedok_po'::integer = :'nedok_pred'::integer + 1);

select pg_temp.check('panel nedokončených ji nově ukazuje',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', date '2026-06-10', date '2026-06-10')
   where employee_id = :'e_storno') = 1);

select pg_temp.check('a jako začátek bere ten příchod, ne stornovaný odchod',
  (select posledni_druh from public.nedokoncena_dochazka(
     :'tenant', date '2026-06-10', date '2026-06-10')
   where employee_id = :'e_storno') = 'in');

reset role;


\echo ''
\echo '== Stornovaný záznam nedrží ani provozní den ============='

/*
  Nová událost dědí provozní den z otevřené směny. Stornovaný odchod
  do toho mluvit nesmí — kdyby ho spoušť brala jako poslední událost,
  usoudila by, že směna je zavřená.
*/
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_storno', 'break_start', 'app',
        timestamptz '2026-06-10 20:00:00+02')
returning id as ud_pauza \gset

select pg_temp.check('přestávka zdědila den otevřeného příchodu',
  (select business_date from public.attendance_events where id = :'ud_pauza')
  = date '2026-06-10');


\echo ''
\echo '== Storno podruhé neprojde, a bez práva vůbec ============'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.stornovat_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.ud_out')::uuid, 'podruhé');
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šlo stornovat podruhé'; end if;
  raise notice '  OK    stornovat podruhé nejde';
end $$;

-- Číšník docházku nespravuje.
select user_id as marek from public.profiles where email = 'cisnik@foodtab.cz' \gset
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.stornovat_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.ud_in')::uuid, 'zkouška bez oprávnění');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: storno prošlo bez oprávnění'; end if;
  raise notice '  OK    bez attendance.manage storno neprojde';
end $$;

-- A bez důvodu taky ne: storno bez důvodu je za půl roku
-- k nerozeznání od chyby.
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.stornovat_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.ud_in')::uuid, '');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: storno prošlo bez důvodu'; end if;
  raise notice '  OK    bez důvodu storno neprojde';
end $$;

reset role;


\echo ''
\echo '== Zapomenutý odchod stornovaný příchod neřeší ==========='

/*
  Stornovaný příchod už není rozdělaná směna, takže se o něm nemá
  ozývat. A obráceně: stornovaný ODCHOD nesmí udělat z otevřené směny
  uzavřenou.
*/
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Zapomněl A Stornoval', 'hpp')
returning id as e_zapstorno \gset

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_zapstorno', 'in', 'app', now() - interval '40 hours')
returning id as ud_zapstorno \gset

reset role;
update public.tenant_settings
  set zapomenuty_odchod_hodin = 20, zapomenuty_odchod_kdy = time '00:00'
  where tenant_id = :'tenant';

update public.attendance_events
  set stornovano_kdy = now(), duvod_storna = 'zkouška'
  where id = :'ud_zapstorno';

select public.ohlasit_zapomenute_odchody() as ohlaseno \gset

select pg_temp.check('o stornovaném příchodu se úloha neozve',
  not exists (select 1 from public.zapomenute_odchody
              where attendance_id = :'ud_zapstorno'));

update public.tenant_settings
  set zapomenuty_odchod_kdy = time '09:00'
  where tenant_id = :'tenant';


\echo ''
\echo '== KROK 15 HOTOV ========================================='
