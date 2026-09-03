-- Scénář pro krok 17 — zadávání směn z kalendáře.
--
-- Pokrývá migraci 20260903030000_zadavani_smen a bod 2 zadání
-- docs/nocni-prace-2026-09-03.md.
--
-- Navazuje na etapa0_scenar.sql až krok16_scenar.sql.
--
-- ---------------------------------------------------------------------
-- KONTROLY MÍŘÍ NA SEDM PASTÍ ZE ZADÁNÍ
--
-- Zvlášť na dvě, na kterých se počítá nejsnáz špatně: směna přes
-- půlnoc (odečtením vyjde záporná délka) a překryv, který přes půlnoc
-- přesahuje do dalšího dne.

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
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Kalendářová Zkouška', 'hpp')
returning id as e_rozpis \gset

-- Pozici si scénář založí sám. V ostrých datech ji má jediný člověk
-- a v testovací firmě žádná není — spoléhat na to, že tam nějaká
-- bude, by scénář rozbilo podle toho, co po sobě nechaly kroky výš.
insert into public.positions (tenant_id, key, label, department)
values (:'tenant', 'zkouska_rozpis', 'Zkouška — rozpis', 'provoz')
on conflict (tenant_id, key) do update set label = excluded.label
returning id as pozice \gset

select set_config('test.tenant',   :'tenant',   false);
select set_config('test.perla',    :'perla',    false);
select set_config('test.bar',      :'bar',      false);
select set_config('test.e_rozpis', :'e_rozpis', false);


\echo ''
\echo '== Délka směny přes půlnoc není záporná =================='

select pg_temp.check('22:00–06:00 je osm hodin',
  app.delka_smeny_minut(time '22:00', time '06:00') = 480);
select pg_temp.check('08:00–16:00 je taky osm',
  app.delka_smeny_minut(time '08:00', time '16:00') = 480);
select pg_temp.check('a rozhodně to není záporné číslo',
  app.delka_smeny_minut(time '22:00', time '06:00') > 0);
select pg_temp.check('23:30–00:30 je hodina',
  app.delka_smeny_minut(time '23:30', time '00:30') = 60);


\echo ''
\echo '== Založení směny ========================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_denni from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_rozpis', :'pozice',
  date '2026-10-05', time '08:00', time '16:00', 'ranní') \gset

select pg_temp.check('směna vznikla', :'s_denni' is not null);

reset role;

select pg_temp.check('a sedí, co se zadalo',
  (select shift_date::text || ' ' || starts_at::text || ' ' || ends_at::text
   from public.shifts where id = :'s_denni')
  = '2026-10-05 08:00:00 16:00:00');

select pg_temp.check('založení je v auditu',
  exists (select 1 from public.audit_log
          where action = 'smena.zalozena' and entity_id = :'s_denni'));


\echo ''
\echo '== Směna přes půlnoc: varuje, ale uloží se ==============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select varovani as v_noc from public.ulozit_smenu(
  :'tenant', null, :'perla', null, null,
  date '2026-10-06', time '22:00', time '06:00', 'noční') \gset

reset role;

select pg_temp.check('řekne, že končí druhý den',
  exists (select 1 from unnest(:'v_noc'::text[]) v where v like '%druhý den%'));

select pg_temp.check('a spočítá osm hodin, ne mínus šestnáct',
  exists (select 1 from unnest(:'v_noc'::text[]) v where v like '%8 h 00 min%'));

select pg_temp.check('směna se přesto uložila',
  exists (select 1 from public.shifts
          where shift_date = date '2026-10-06' and starts_at = time '22:00'));


\echo ''
\echo '== Provozní den: začátek před pátou varuje ==============='

/*
  Pobočka začíná provozní den v 05:00. Směna od 03:00 tedy patří do dne
  předchozího — a kiosek i docházka ji podle `shift_date` budou hledat
  tam. Datum se nepřepisuje, jen se to řekne.
*/
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select varovani as v_rano from public.ulozit_smenu(
  :'tenant', null, :'perla', null, null,
  date '2026-10-07', time '03:00', time '11:00', 'brzká') \gset

reset role;

select pg_temp.check('upozorní, že patří do předchozího dne',
  exists (select 1 from unnest(:'v_rano'::text[]) v where v like '%06.10.2026%'));

select pg_temp.check('ale datum nepřepsal',
  exists (select 1 from public.shifts
          where shift_date = date '2026-10-07' and starts_at = time '03:00'));

-- A normální ranní směna nevaruje.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select varovani as v_klid from public.ulozit_smenu(
  :'tenant', null, :'perla', null, null,
  date '2026-10-08', time '09:00', time '17:00', 'klidná') \gset

reset role;

select pg_temp.check('u obyčejné směny žádné varování', array_length(:'v_klid'::text[], 1) is null);


\echo ''
\echo '== Překryv varuje, ale nezakazuje ========================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Přes tu ranní z 5. 10. (08:00–16:00).
select varovani as v_prekryv from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_rozpis', null,
  date '2026-10-05', time '14:00', time '20:00', 'odpolední') \gset

reset role;

select pg_temp.check('řekne, že se překrývá',
  exists (select 1 from unnest(:'v_prekryv'::text[]) v where v like '%Překrývá se%'));

select pg_temp.check('a přesto se uložila — dělené směny existují',
  (select count(*) from public.shifts
   where employee_id = :'e_rozpis' and shift_date = date '2026-10-05') = 2);

/*
  Překryv PŘES PŮLNOC. Noční 22:00–06:00 z 10. 10. zasahuje do 11. 10.,
  takže ranní 05:00–09:00 z 11. 10. se s ní kryje — i když mají jiné
  `shift_date`. Tohle je ten případ, kvůli kterému se překryv počítá
  v minutách od začátku dne a ne porovnáním časů.
*/
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_noc2 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_rozpis', null,
  date '2026-10-10', time '22:00', time '06:00', 'noční') \gset

select varovani as v_pres from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_rozpis', null,
  date '2026-10-11', time '05:00', time '09:00', 'ranní po noční') \gset

reset role;

select pg_temp.check('překryv přes půlnoc se pozná',
  exists (select 1 from unnest(:'v_pres'::text[]) v where v like '%Překrývá se%'));

/*
  A směna, která na noční NAVAZUJE bez překryvu, varovat nesmí.

  Vlastní člověk a vlastní dny schválně: napoprvé jsem to zkoušel na
  tomtéž a narazil na směnu, kterou jsem si o dva testy dřív sám
  založil. Kontrola měla pravdu a scénář ne.
*/
reset role;
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Navazující Zkouška', 'hpp')
returning id as e_navaz \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_navaz', null,
  date '2026-10-20', time '22:00', time '06:00', 'noční');

select varovani as v_navaz from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_navaz', null,
  date '2026-10-21', time '06:00', time '10:00', 'navazuje') \gset

reset role;

select pg_temp.check('navazující směna se za překryv nepovažuje',
  not exists (select 1 from unnest(:'v_navaz'::text[]) v where v like '%Překrývá se%'));


\echo ''
\echo '== Co se odmítá =========================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_smenu(
      current_setting('test.tenant')::uuid, null,
      current_setting('test.perla')::uuid, null, null,
      date '2026-10-09', time '08:00', time '08:00', 'nulová');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nulová směna prošla'; end if;
  raise notice '  OK    směna nulové délky neprojde';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_smenu(
      current_setting('test.tenant')::uuid, null,
      current_setting('test.perla')::uuid,
      '00000000-0000-0000-0000-000000000000', null,
      date '2026-10-09', time '08:00', time '16:00', 'cizí člověk');
  exception when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí zaměstnanec prošel'; end if;
  raise notice '  OK    cizí zaměstnanec neprojde';
end $$;

reset role;


\echo ''
\echo '== Pobočka z prohlížeče je jen návrh ====================='

/*
  Klára je vedoucí SMĚNY s rozsahem na Černou Perlu. Na Bernard Baru
  plánovat nesmí — ani když jeho id pošle v parametru.
*/
set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select pg_temp.check('vedoucí plánuje na Černé Perle',
  app.has_access(:'tenant', 'shifts.manage', :'perla'));
select pg_temp.check('a na Bernard Baru NE',
  not app.has_access(:'tenant', 'shifts.manage', :'bar'));

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_smenu(
      current_setting('test.tenant')::uuid, null,
      current_setting('test.bar')::uuid, null, null,
      date '2026-10-09', time '08:00', time '16:00', 'cizí pobočka');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šlo plánovat na cizí pobočce'; end if;
  raise notice '  OK    na cizí pobočce směnu nezaloží';
end $$;

reset role;

-- A při ÚPRAVĚ se ověřuje i pobočka PŮVODNÍ: cizí směnu si nikdo
-- nepřetáhne k sobě jen tím, že pošle její id.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_bar from public.ulozit_smenu(
  :'tenant', null, :'bar', null, null,
  date '2026-10-12', time '08:00', time '16:00', 'na baru') \gset

select set_config('test.s_bar', :'s_bar', false);
select set_config('test.user_id', :'vedouci', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_smenu(
      current_setting('test.tenant')::uuid,
      current_setting('test.s_bar')::uuid,
      current_setting('test.perla')::uuid, null, null,
      date '2026-10-12', time '08:00', time '16:00', 'přetažená');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí směna se dala přetáhnout'; end if;
  raise notice '  OK    cizí směnu si k sobě nikdo nepřetáhne';
end $$;

reset role;


\echo ''
\echo '== Vydaný rozpis a změna po vydání ======================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select zmen as zmen_pred from public.rozpis_stav(
  :'tenant', :'perla', date '2026-10-05', date '2026-10-12') \gset

select pg_temp.check('před vydáním jsou všechny směny „změna“',
  :'zmen_pred'::integer > 0);

select vydano_kdy as vyd_pred from public.rozpis_stav(
  :'tenant', :'perla', date '2026-10-05', date '2026-10-12') \gset

select pg_temp.check('a rozpis ještě nebyl vydaný', :'vyd_pred' = '');

select public.vydat_rozpis(:'tenant', :'perla', date '2026-10-05', date '2026-10-12');

select vydano_kdy as vyd_po, zmen as zmen_po from public.rozpis_stav(
  :'tenant', :'perla', date '2026-10-05', date '2026-10-12') \gset

select pg_temp.check('po vydání je vidět, kdy se vydalo', :'vyd_po' <> '');
select pg_temp.check('a nic nečeká na doručení', :'zmen_po'::integer = 0);

/*
  A teď to, co bude Šéfík dělat dnes večer: přidá směnu do už vydaného
  rozpisu. Musí být poznat, že se o ní lidé nedozvěděli.
*/
select public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_rozpis', null,
  date '2026-10-09', time '12:00', time '18:00', 'dodatečná');

select vydano_kdy as vyd_pote, zmen as zmen_pote from public.rozpis_stav(
  :'tenant', :'perla', date '2026-10-05', date '2026-10-12') \gset

select pg_temp.check('rozpis je pořád vydaný', :'vyd_pote' <> '');
select pg_temp.check('ale jedna změna čeká na doručení', :'zmen_pote'::integer = 1);

reset role;


\echo ''
\echo '== KROK 17 HOTOV ========================================='
