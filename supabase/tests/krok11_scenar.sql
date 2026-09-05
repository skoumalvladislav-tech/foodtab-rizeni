-- Scénář pro krok 11 — příchod na jedné pobočce, odchod na druhé.
--
-- Pokrývá migraci 20260902060000_prechod_mezi_pobockami a osm kontrol
-- z oddílu 5 zadání docs/prechod-mezi-pobockami-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok10_scenar.sql.
--
-- Kontroly míří na to, co NEMÁ jít: že se hodiny neztratí při jiném
-- začátku provozního dne, že vedoucí jedné pobočky nepřečte víc než
-- protějšek dvojice, a že se do toho cizí firma nedostane.

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
-- Vlastní člověk, ať se ostatní scénáře nerozhodí. Má směnu na Černé
-- Perle a odejde v Bernard Baru.
-- =====================================================================

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci  from public.profiles where email = 'vedouci@foodtab.cz' \gset
select user_id as cizi     from public.profiles where email = 'cizi@jinafirma.cz' \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Přechodová Zkouška', 'hpp')
returning id as putnik \gset

-- Druhý člověk, jen na Bernard Baru. Vedoucí Černé Perly ho vidět
-- nesmí — na něm se pozná, jestli se protějškem neotevřela celá
-- docházka cizí pobočky.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Barový Zkouška', 'hpp')
returning id as barman \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.putnik', :'putnik', false);
select set_config('test.barman', :'barman', false);
select set_config('test.perla',  :'perla',  false);
select set_config('test.bar',    :'bar',    false);

-- Provozní den, o kterém se celý scénář baví.
select app.business_date(:'perla', now()) as den \gset
select set_config('test.den', :'den', false);

-- Směna na Černé Perle. Kvůli kontrole 6: příchod v rozpisu byl.
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'putnik', :'den', '08:00', '16:00');

-- Stav ranního přehledu PŘED čímkoli. Předchozí scénáře nechaly na
-- Černé Perle svoje hodiny, takže se nedají porovnávat absolutní čísla
-- — porovnává se, o kolik se přehled po přechodu změní.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select odpracovano_minut as min_perla_pred, nedokoncenych as nedok_perla_pred
  from public.ranni_prehled(:'tenant', :'den') where branch_id = :'perla' \gset
select odpracovano_minut as min_bar_pred, nedokoncenych as nedok_bar_pred
  from public.ranni_prehled(:'tenant', :'den') where branch_id = :'bar' \gset

reset role;


\echo ''
\echo '== 1. Odpíchnutí na druhé pobočce ========================='

-- Příchod v Černé Perle v 8:00, odchod v Bernard Baru v 16:00.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'putnik', 'in',  'app', (:'den'::date + time '08:00') at time zone 'Europe/Prague');

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'bar', :'putnik', 'out', 'app', (:'den'::date + time '16:00') at time zone 'Europe/Prague');

select pg_temp.check('vznikly dvě události, ne víc',
  (select count(*) from public.attendance_events where employee_id = :'putnik') = 2);

select pg_temp.check('příchod je na Černé Perle',
  (select branch_id from public.attendance_events
   where employee_id = :'putnik' and kind = 'in') = :'perla');

select pg_temp.check('odchod je v Bernard Baru',
  (select branch_id from public.attendance_events
   where employee_id = :'putnik' and kind = 'out') = :'bar');

select pg_temp.check('obě události mají týž provozní den',
  (select count(distinct business_date) from public.attendance_events
   where employee_id = :'putnik') = 1);


\echo ''
\echo '== 2. Nedokončená docházka je prázdná ====================='

select pg_temp.check('ani jedna pobočka nehlásí rozdělanou směnu',
  (select count(*) from public.nedokoncena_dochazka(:'tenant', :'den', :'den')
   where employee_id = :'putnik') = 0);

select pg_temp.check('a nehlásí ji ani Černá Perla sama za sebe',
  (select count(*) from public.nedokoncena_dochazka(:'tenant', :'den', :'den', :'perla')
   where employee_id = :'putnik') = 0);


\echo ''
\echo '== 3. Odpracované minuty sedí ============================='

select pg_temp.check('osm hodin od příchodu do odchodu',
  (select minut from app.worked_minutes(:'putnik', :'den', :'den')) = 480);


\echo ''
\echo '== 4. Jiný začátek provozního dne hodiny nesní ============'

-- Tohle je ta kontrola, kvůli které se to celé píše. Bernard Bar
-- přepne začátek dne na 04:00, Černá Perla zůstane na 05:00. Kdo přijde
-- ve 4:30 do Perly a odejde v 5:30 v Baru, měl by mít hodinu — dřív by
-- každá událost padla na jiný provozní den a hodina by beze slova
-- zmizela.

update public.branches set day_starts_at = '04:00' where id = :'bar';
update public.branches set day_starts_at = '05:00' where id = :'perla';

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Půlnoční Zkouška', 'hpp')
returning id as nocni \gset
select set_config('test.nocni', :'nocni', false);

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'nocni', 'in', 'app',
   (:'den'::date + time '04:30') at time zone 'Europe/Prague');

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'bar', :'nocni', 'out', 'app',
   (:'den'::date + time '05:30') at time zone 'Europe/Prague');

select pg_temp.check('odchod zdědil provozní den příchodu',
  (select count(distinct business_date) from public.attendance_events
   where employee_id = :'nocni') = 1);

select pg_temp.check('hodina se napočítala, nezmizela',
  (select coalesce(sum(minut), 0) from app.worked_minutes(
     :'nocni', :'den'::date - 2, :'den'::date + 2)) = 60);

select pg_temp.check('a je jen jeden den, ne dva půlpáry',
  (select count(*) from app.worked_minutes(
     :'nocni', :'den'::date - 2, :'den'::date + 2)) = 1);

-- Vlastní provozní den se pořád použije, když otevřený příchod není.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'bar', :'barman', 'out', 'app',
   (:'den'::date + time '04:45') at time zone 'Europe/Prague');

select pg_temp.check('osamocený odchod si vezme provozní den své pobočky',
  (select business_date from public.attendance_events
   where employee_id = :'barman' and kind = 'out')
  = app.business_date(:'bar', (:'den'::date + time '04:45') at time zone 'Europe/Prague'));

reset role;
update public.branches set day_starts_at = '05:00' where id = :'bar';


\echo ''
\echo '== 5. Vedoucí vidí protějšek, ale ne cizí docházku ========'

-- Klára je vedoucí SMĚNY s rozsahem jen na Černou Perlu.
set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select pg_temp.check('vedoucí čte docházku Černé Perly',
  app.can_read_scoped(:'tenant', 'attendance.read', :'perla'));
select pg_temp.check('a docházku Bernard Baru NEČTE',
  not app.can_read_scoped(:'tenant', 'attendance.read', :'bar'));

select pg_temp.check('protějšek dvojice z Bernard Baru přečte',
  (select count(*) from public.attendance_events
   where employee_id = :'putnik' and branch_id = :'bar') = 1);

-- A tohle je ta mez. Barman s Černou Perlou nemá nic společného.
select pg_temp.check('cizí docházku Bernard Baru NEPŘEČTE',
  (select count(*) from public.attendance_events
   where employee_id = :'barman') = 0);

/*
  Ta nula výš by vyšla i tehdy, kdyby ta událost vůbec neexistovala —
  a pak by kontrola neověřovala nic. Takže se hned potvrdí, že tam JE
  a že ji vidí jen ten, kdo na ni má právo.
*/
reset role;
select pg_temp.check('a ta událost přitom existuje — jinak by kontrola výš byla prázdná',
  (select count(*) from public.attendance_events where employee_id = :'barman') = 1);

set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select pg_temp.check('a nepřečte ani jiný den téhož člověka',
  (select count(*) from public.attendance_events
   where employee_id = :'putnik'
     and business_date <> :'den'::date) = 0);

select pg_temp.check('nedokončená docházka mu ukáže celý den, ne půlku',
  (select count(*) from public.nedokoncena_dochazka(
     :'tenant', :'den'::date - 2, :'den'::date + 2, :'perla')
   where employee_id = :'barman') = 0);

reset role;


\echo ''
\echo '== 6. „Mimo rozpis“ se neuplatní =========================='

-- Píchá se přes app.pichnout, ať se ověří ta cesta, po které se
-- opravdu chodí, ne jen přímý insert.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Rozpisová Zkouška', 'hpp')
returning id as rozpis \gset
select set_config('test.rozpis', :'rozpis', false);

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'rozpis', app.business_date(:'perla', now()), '08:00', '16:00');

-- `app.pichnout` vrací od 5. 9. řádek (událost + jestli se uzavřel
-- starý příchod), ne holé uuid. Bere se z něj sloupec, ne celá n-tice.
select udalost as ud_in from app.pichnout(:'tenant', :'perla', :'rozpis', 'in') \gset
select pg_temp.check('příchod podle rozpisu není mimo rozpis',
  not (select mimo_rozpis from public.attendance_events where id = :'ud_in'));

select udalost as ud_out from app.pichnout(:'tenant', :'bar', :'rozpis', 'out') \gset
select pg_temp.check('odchod jinde NENÍ mimo rozpis, když příchod v rozpisu byl',
  not (select mimo_rozpis from public.attendance_events where id = :'ud_out'));

-- A obráceně: kdo v rozpisu nebyl, příznak dostat MÁ.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bez Rozpisu Zkouška', 'hpp')
returning id as bezrozpisu \gset

select udalost as ud_bez from app.pichnout(:'tenant', :'perla', :'bezrozpisu', 'in') \gset
select pg_temp.check('příchod bez směny mimo rozpis je',
  (select mimo_rozpis from public.attendance_events where id = :'ud_bez'));

select udalost as ud_bez_out from app.pichnout(:'tenant', :'bar', :'bezrozpisu', 'out') \gset
select pg_temp.check('a odchod po něm taky',
  (select mimo_rozpis from public.attendance_events where id = :'ud_bez_out'));


\echo ''
\echo '== 7. Náklad připadne pobočce odchodu ====================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select odpracovano_minut as min_perla, nedokoncenych as nedok_perla
  from public.ranni_prehled(:'tenant', :'den') where branch_id = :'perla' \gset
select odpracovano_minut as min_bar
  from public.ranni_prehled(:'tenant', :'den') where branch_id = :'bar' \gset

select pg_temp.check('osm hodin poutníka přibylo Bernard Baru',
  :'min_bar'::integer - :'min_bar_pred'::integer >= 480);
select pg_temp.check('Černé Perle za ně nepřibylo nic',
  :'min_perla'::integer = :'min_perla_pred'::integer);
select pg_temp.check('a nehlásí za něj ani rozdělanou směnu',
  :'nedok_perla'::integer = :'nedok_perla_pred'::integer);

reset role;

-- Otevřená směna: počítá se tam, kde se začalo.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Otevřená Zkouška', 'hpp')
returning id as otevreny \gset

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values
  (:'tenant', :'perla', :'otevreny', 'in', 'app',
   (:'den'::date + time '09:00') at time zone 'Europe/Prague');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select nedokoncenych as nedok2 from public.ranni_prehled(:'tenant', :'den')
  where branch_id = :'perla' \gset
select nedokoncenych as nedok_bar from public.ranni_prehled(:'tenant', :'den')
  where branch_id = :'bar' \gset

select pg_temp.check('otevřená směna se počítá tam, kde začala',
  :'nedok2'::integer = :'nedok_perla'::integer + 1);
select pg_temp.check('a Bernard Baru za ni nepřibylo nic',
  :'nedok_bar'::integer = :'nedok_bar_pred'::integer);

reset role;


\echo ''
\echo '== 8. Cizí firma se do toho nedostane ====================='

-- Druhá firma s vlastní pobočkou. Kód jedné firmy nesmí píchnout
-- v druhé a její docházka se odsud nesmí přečíst.
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select app.create_tenant('Jiná firma s.r.o.', '87654321') as tenant2 \gset
reset role;

insert into public.branches (tenant_id, name, slug)
values (:'tenant2', 'Cizí pobočka', 'cizi-pobocka')
returning id as bar2 \gset

select set_config('test.tenant2', :'tenant2', false);
select set_config('test.bar2', :'bar2', false);

-- Kód naší Černé Perly zkusíme uplatnit v cizí firmě.
select app.kiosk_kod(:'perla', app.kiosk_okno(:'perla')) as kod_perly \gset
select set_config('test.kod_perly', :'kod_perly', false);

set role authenticated;
select set_config('test.user_id', :'cizi', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.pichnout_kodem(
      current_setting('test.tenant2')::uuid,
      current_setting('test.kod_perly'));
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kód jedné firmy píchnul v druhé'; end if;
  raise notice '  OK    kód jedné firmy v druhé neplatí';
end $$;

select pg_temp.check('cizí účet nepřečte ani jednu naši událost',
  (select count(*) from public.attendance_events where tenant_id = :'tenant') = 0);

select pg_temp.check('a přechody mezi pobočkami mu nic nevrátí',
  (select count(*) from public.prechody_mezi_pobockami(:'tenant', :'den')) = 0);

reset role;


\echo ''
\echo '== Věta u záznamu ========================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('přechod je vidět jako dvojice pobočka → pobočka',
  exists (
    select 1 from public.prechody_mezi_pobockami(:'tenant', :'den')
    where employee_id = :'putnik'
      and prichod_nazev = 'Restaurace Černá Perla'
      and odchod_nazev = 'Bernard Bar Tábor'
      and uzavreno
  ));

select pg_temp.check('kdo pobočku nezměnil, mezi přechody není',
  not exists (
    select 1 from public.prechody_mezi_pobockami(:'tenant', :'den')
    where employee_id = :'otevreny'
  ));

reset role;


\echo ''
\echo '== KROK 11 HOTOV ========================================='
