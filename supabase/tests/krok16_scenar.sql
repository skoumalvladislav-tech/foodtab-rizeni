-- Scénář pro krok 16 — otevřený příchod v panelu (A) a odmítnutý
-- ruční odchod bez otevřené směny (B).
--
-- Pokrývá migrace 20260903010000 a 20260903020000 a nález
-- docs/nesedi-hodiny-po-rucnim-odchodu.md, body A a B.
--
-- Navazuje na etapa0_scenar.sql až krok15_scenar.sql.
--
-- ---------------------------------------------------------------------
-- DATA JSOU PODLE SKUTEČNOSTI
--
-- Den se staví přesně v tom tvaru, na kterém se to 31. srpna zlomilo:
-- příchod, o devatenáct vteřin později odchod, večer další příchody
-- a odchody a jeden příchod nakonec otevřený. Vymyšlený jednoduchý
-- den by chybu neodhalil — u něj nejstarší příchod a otevřený příchod
-- splývají.

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

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Otevřený Příchod', 'hpp')
returning id as e_otevreny \gset

select set_config('test.tenant',     :'tenant',     false);
select set_config('test.perla',      :'perla',      false);
select set_config('test.e_otevreny', :'e_otevreny', false);

-- Den 5. 5. 2026 v tvaru 31. srpna. Časy jsou pražské.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'e_otevreny', 'in',  'app', timestamptz '2026-05-05 13:27:18+02'),
  (:'tenant', :'perla', :'e_otevreny', 'out', 'app', timestamptz '2026-05-05 13:27:37+02'),
  (:'tenant', :'perla', :'e_otevreny', 'in',  'app', timestamptz '2026-05-05 21:19:17+02'),
  (:'tenant', :'perla', :'e_otevreny', 'out', 'app', timestamptz '2026-05-05 21:19:50+02'),
  (:'tenant', :'perla', :'e_otevreny', 'in',  'app', timestamptz '2026-05-05 21:42:59+02');


\echo ''
\echo '== A. Panel ukazuje OTEVŘENÝ příchod ====================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('den se hlásí jako nedokončený',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', date '2026-05-05', date '2026-05-05')
   where employee_id = :'e_otevreny') = 1);

select pg_temp.check('začátek je otevřený příchod ve 21:42:59',
  (select zacatek from public.nedokoncena_dochazka(
     :'tenant', date '2026-05-05', date '2026-05-05')
   where employee_id = :'e_otevreny')
  = timestamptz '2026-05-05 21:42:59+02');

/*
  A tohle je ta chyba: nejstarší příchod dne. Podle něj Šéfík doplnil
  odchod a uzavřel dvouhodinovou směnu místo desetihodinové.
*/
select pg_temp.check('NENÍ to nejstarší příchod ve 13:27:18',
  (select zacatek from public.nedokoncena_dochazka(
     :'tenant', date '2026-05-05', date '2026-05-05')
   where employee_id = :'e_otevreny')
  <> timestamptz '2026-05-05 13:27:18+02');

reset role;


\echo ''
\echo '== A. Když otevřený příchod není, panel mlčí ============='

/*
  Odchylka ohlášená v hlavičce migrace: den, který končí přestávkou po
  uzavřené směně, se v panelu neobjeví. Doplnit se tam nedá nic a věta
  „odchod chybí“ by byla nepravdivá — odchod tam je.
*/
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Uzavřený A Pauza', 'hpp')
returning id as e_pauza \gset

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'e_pauza', 'in',          'app', timestamptz '2026-05-06 08:00:00+02'),
  (:'tenant', :'perla', :'e_pauza', 'out',         'app', timestamptz '2026-05-06 16:00:00+02'),
  (:'tenant', :'perla', :'e_pauza', 'break_start', 'app', timestamptz '2026-05-06 17:00:00+02');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('poslední událost není odchod, a přesto se nehlásí',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', date '2026-05-06', date '2026-05-06')
   where employee_id = :'e_pauza') = 0);

reset role;


\echo ''
\echo '== B. Odchod bez otevřené směny se odmítne ==============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

/*
  Přesně Šéfíkových pět pokusů: den, kde poslední záznam před zadaným
  časem je odchod. Dřív to prošlo a aplikace napsala „Zapsáno“.
*/
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Marný Pokus', 'hpp')
returning id as e_marny \gset
select set_config('test.e_marny', :'e_marny', false);

reset role;
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'e_marny', 'in',  'app', timestamptz '2026-05-07 08:00:00+02'),
  (:'tenant', :'perla', :'e_marny', 'out', 'app', timestamptz '2026-05-07 08:00:19+02');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare
  v_ok    boolean := false;
  v_text  text;
begin
  begin
    perform public.zapsat_rucni_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.perla')::uuid,
      current_setting('test.e_marny')::uuid,
      'out', timestamp '2026-05-07 20:00', 'Zapomenutý odchod, doplněno majitelem');
  exception when invalid_parameter_value then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then raise exception 'SELHALO: odchod bez otevřené směny prošel'; end if;

  -- Věta musí říct, CO se stalo a CO S TÍM — ne „nepovedlo se“.
  if v_text not like '%není co uzavřít%' then
    raise exception 'SELHALO: hláška neříká, co se stalo: %', v_text;
  end if;
  if v_text not like '%příchod%' then
    raise exception 'SELHALO: hláška neporadí, co s tím: %', v_text;
  end if;
  -- A je v ní čas toho posledního záznamu, v pražském čase.
  if v_text not like '%08:00%' then
    raise exception 'SELHALO: hláška neuvádí čas posledního záznamu: %', v_text;
  end if;

  raise notice '  OK    odchod bez otevřené směny se odmítne větou, ne mlčením';
end $$;

select pg_temp.check('a žádný mrtvý řádek po něm nezůstal',
  (select count(*) from public.attendance_events
   where employee_id = :'e_marny' and source = 'manual') = 0);


\echo ''
\echo '== B. Když je co uzavřít, projde ========================='

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_otevreny',
  'out', timestamp '2026-05-05 22:00', 'Zapomenutý odchod, doplněno majitelem') as ud_ok \gset

select pg_temp.check('odchod k otevřené směně projde', :'ud_ok' is not null);

reset role;

/*
  A uzavřel se ten OTEVŘENÝ příchod, ne nejstarší: 21:42:59 → 22:00
  je 17 minut. Celkem s ranními 19 vteřinami a 33 vteřinami to dá
  17 minut — ne 8 hodin 33 minut, jak by vyšlo z nejstaršího příchodu.
*/
select pg_temp.check('spárovalo se to s otevřeným příchodem, tedy 17 minut',
  (select minut from app.worked_minutes(
     :'e_otevreny', date '2026-05-05', date '2026-05-05')) = 17);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('a den z panelu zmizel',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', date '2026-05-05', date '2026-05-05')
   where employee_id = :'e_otevreny') = 0);


\echo ''
\echo '== B. Příchod se neodmítá nikdy =========================='

/*
  Kdo si zapomněl píchnout příchod, ho musí doplnit — a to, že za ním
  leží odchod, je právě ten případ, kvůli kterému ruční zápis je.
*/
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'e_marny',
  'in', timestamp '2026-05-07 07:30', 'Zapomenutý příchod') as ud_in \gset

select pg_temp.check('příchod projde, i když za ním leží odchod', :'ud_in' is not null);

-- A konec přestávky bez začátku taky ne (vědomé rozšíření nad zadání).
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zapsat_rucni_dochazku(
      current_setting('test.tenant')::uuid,
      current_setting('test.perla')::uuid,
      current_setting('test.e_marny')::uuid,
      'break_end', timestamp '2026-05-07 12:00', 'Konec přestávky');
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: konec přestávky bez začátku prošel'; end if;
  raise notice '  OK    konec přestávky bez začátku se odmítne taky';
end $$;

reset role;


\echo ''
\echo '== KROK 16 HOTOV ========================================='
