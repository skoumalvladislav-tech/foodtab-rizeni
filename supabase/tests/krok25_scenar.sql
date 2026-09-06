-- Scénář pro krok 25 — kanál pobočky se odvozuje, nezakládá.
--
-- Pokrývá migraci 20260906020000_odvozene_kanaly a zadání
-- docs/nocni-prace-komunikace-2026-09-05.md, krok B a oddíl 1.
--
-- Navazuje na etapa0_scenar.sql až krok24_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Odvozené členství je pohodlné a přesně proto nebezpečné: rozšiřuje
-- okruh čtenářů bez toho, aby to bylo někde vidět jako seznam. Kdyby
-- odvození uteklo z `pobocka` na ostatní druhy, četl by majitel —
-- který má dosah na všechny pobočky — každou osobní zprávu a každou
-- stížnost napsanou na sebe. Modul by pak dělal přesný opak toho,
-- k čemu vznikl.
--
-- Nejdůležitější je proto oddíl 3: odvození SE NESMÍ chytit na
-- `osobni`, `mezi_pobockami` ani `vedeni`. Kladná kontrola z oddílu 1
-- („kdo na pobočku dosáhne, kanál čte") projde i nad databází, kde
-- čtou úplně všichni všechno. Teprve oddíl 3 říká, že odvození má
-- hranici.

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
-- Vlastní lidé, ne ti z kroku 24: tam už mají rozečtené konverzace
-- a otevřený příchod, a počty nepřečtených by se tím rozjely.
--
-- Danuše dosáhne jen na Perlu, Emil jen na Bernard. To je celý pokus:
-- jeden kanál, dva lidé, a odvození má rozhodnout za oba.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('dddd0000-0000-0000-0000-00000000000d', 'danuse@foodtab.cz', '{"full_name":"Danuše Perlová"}'),
  ('eeee0000-0000-0000-0000-00000000000e', 'emil@foodtab.cz',   '{"full_name":"Emil Bernardský"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', 'dddd0000-0000-0000-0000-00000000000d', 'Danuše Perlová', 'hpp'),
  (:'tenant', :'bar',   'eeee0000-0000-0000-0000-00000000000e', 'Emil Bernardský', 'hpp');

select id as danuse from public.employees where user_id = 'dddd0000-0000-0000-0000-00000000000d' \gset
select id as emil   from public.employees where user_id = 'eeee0000-0000-0000-0000-00000000000e' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', 'dddd0000-0000-0000-0000-00000000000d', :'role_kuchyne', 'branch', 'active'),
  (:'tenant', 'eeee0000-0000-0000-0000-00000000000e', :'role_kuchyne', 'branch', 'active');

select id as clen_danuse from public.memberships
 where user_id = 'dddd0000-0000-0000-0000-00000000000d' \gset
select id as clen_emil from public.memberships
 where user_id = 'eeee0000-0000-0000-0000-00000000000e' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_danuse', :'perla'),
  (:'clen_emil',   :'bar');

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);
select set_config('test.bar', :'bar', false);


\echo ''
\echo '== 1. Kanál se založí sám a členství se odvodí ==========='

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;

select public.kanal_pobocky(:'tenant', :'perla') as kanal \gset
select pg_temp.check('kanál pobočky vznikl', :'kanal' is not null);

-- Druhé volání nesmí založit druhý kanál. Dvě otevřené obrazovky by
-- jinak rozdělily zprávy do dvou vláken a nikdo by je nedal dohromady.
select public.kanal_pobocky(:'tenant', :'perla') as kanal2 \gset
select pg_temp.check('druhé volání vrátí týž kanál, nezaloží nový',
  :'kanal' = :'kanal2');

select public.poslat_zpravu(:'kanal', 'Zítra přijede kontrola z hygieny.') as z1 \gset

reset role;
select set_config('test.kanal', :'kanal', false);

/*
  A TEĎ TO PODSTATNÉ: v `konverzace_ucastnici` nemá kanál ŽÁDNÝ řádek
  pro Danuši. Že ho čte, neplyne ze seznamu, ale z toho, že na Perlu
  dosáhne. Kdyby tahle kontrola spadla, znamenalo by to, že se členství
  někde tiše zapisuje — a pak by se při přeřazení člověka rozešlo
  s realitou přesně tak, jak to popisuje 7shifts.
*/
select pg_temp.check('členství NENÍ zapsané, je odvozené',
  not exists (select 1 from public.konverzace_ucastnici
              where konverzace_id = :'kanal' and employee_id = :'danuse'));

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;
/*
  Počítá se KONKRÉTNÍ zpráva, ne kolik jich v kanálu je.

  Kanál Perly totiž existuje už z krok24_scenar — i tam se zakládal
  pobočkový kanál — a jedinečný index ho správně nezaložil podruhé:
  „kanal_pobocky" vrátila ten stávající. Kontrola na „count = 1" proto
  spadla, i když odvození fungovalo úplně správně. Absolutní počty
  přes scénáře nedrží; jmenovitá zpráva ano.

  Je to zároveň důkaz, že jedinečný index dělá, co má.
*/
select pg_temp.check('a přesto kanál čte',
  exists (select 1 from public.konverzace_zpravy where id = :'z1'));
select pg_temp.check('a má ho i v seznamu rozhovorů',
  exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal'));
reset role;


\echo ''
\echo '== 2. Kdo na pobočku nedosáhne, kanál nečte =============='

select set_config('test.user_id', 'eeee0000-0000-0000-0000-00000000000e', false);
set role authenticated;

select pg_temp.check('Emil na Perlu nedosáhne',
  :'perla' not in (select app.visible_branch_ids(:'tenant')));
select pg_temp.check('perlový kanál proto nečte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'kanal') = 0);
select pg_temp.check('nemá ho ani v seznamu',
  not exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal'));
select pg_temp.check('a není účastník', app.je_ucastnik(:'kanal') = false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.kanal')::uuid, 'Ahoj z Bernardu.');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: do cizího pobočkového kanálu se dalo psát'; end if;
  raise notice '  OK    do cizího pobočkového kanálu nenapíše';
end $$;

-- A kanál si pro cizí pobočku ani nevyrobí.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kanal_pobocky(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kanál cizí pobočky si vyrobil sám'; end if;
  raise notice '  OK    kanál cizí pobočky si nevyrobí';
end $$;

reset role;


\echo ''
\echo '== 3. Odvození se NECHYTÍ na ostatní druhy =============='

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V SOUBORU.

  Majitel má dosah na VŠECHNY pobočky. Kdyby se odvození pustilo mimo
  `pobocka`, přečetl by tím každou osobní zprávu a každý vzkaz vedení —
  včetně těch, které jsou napsané na něj.

  Schválně rozbito: po vyndání podmínky `k.druh = 'pobocka'` z
  `app.je_ucastnik` spadne v tomhle oddíle první kontrola. Ověřeno.
*/

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Danuše a Emil', null,
  array[:'emil']::uuid[]) as osobni \gset
select public.poslat_zpravu(:'osobni', 'Nesnáším ranní směny.') as z2 \gset
select public.zalozit_rozhovor(:'tenant', 'vedeni', null, 'Stížnost', 'majitel') as vedeni \gset
reset role;

select set_config('test.osobni', :'osobni', false);

select set_config('test.user_id', :'sef', false);
set role authenticated;

select pg_temp.check('majitel dosáhne na obě pobočky',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 2);
select pg_temp.check('a PŘESTO osobní zprávu nečte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'osobni') = 0);
select pg_temp.check('ani není jejím účastníkem',
  app.je_ucastnik(:'osobni') = false);
select pg_temp.check('pobočkový kanál naopak čte — tam odvození platí',
  app.je_ucastnik(:'kanal') = true);

reset role;

-- Mezi pobočkami: dosah na obě pobočky nestačí, rozhoduje seznam.
select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'mezi_pobockami', null, 'Sifony', null,
  array[:'emil']::uuid[]) as mezi \gset
select public.poslat_zpravu(:'mezi', 'Půjčíme vám sifon.') as z3 \gset
reset role;

select set_config('test.user_id', :'sef', false);
set role authenticated;
select pg_temp.check('majitel nečte ani mezi_pobockami',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'mezi') = 0);
reset role;


\echo ''
\echo '== 4. Záložka vzniká až čtením a přístup nedrží =========='

/*
  U odvozeného kanálu je řádek v `konverzace_ucastnici` ZÁLOŽKA, ne
  povolení. Rozdíl je vidět na tom, že po jeho smazání člověk kanál
  pořád čte — jen mu zprávy zase naskočí jako nepřečtené.
*/

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;

select pg_temp.check('před přečtením je v kanálu nepřečtené',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal') > 0);

select public.oznacit_precteno(:'kanal') as kdy \gset

select pg_temp.check('po přečtení už nepřečtené není',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal') = 0);

reset role;

select pg_temp.check('teprve teď má kanál řádek účastníka — záložku',
  exists (select 1 from public.konverzace_ucastnici
          where konverzace_id = :'kanal' and employee_id = :'danuse'));

delete from public.konverzace_ucastnici
 where konverzace_id = :'kanal' and employee_id = :'danuse';

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;
select pg_temp.check('po smazání záložky kanál pořád čte',
  exists (select 1 from public.konverzace_zpravy where id = :'z1'));
select pg_temp.check('jen jsou zprávy zase nepřečtené',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal') > 0);
reset role;


\echo ''
\echo '== 5. Nepřečtené nahoře, od nejstaršího ================='

/*
  Deputy: *„Posts that have not been confirmed will always be shown at
  the top of the News Feed, sorted by oldest to newest."* Řadí se
  v databázi schválně — obrazovka to pak nemůže splést.

  Danuše má teď dva rozhovory s nepřečteným: pobočkový kanál (starší)
  a osobní (novější, protože do něj psala sama — ale odpoví jí Emil).
*/

select set_config('test.user_id', 'eeee0000-0000-0000-0000-00000000000e', false);
set role authenticated;
select public.poslat_zpravu(:'osobni', 'Já taky ne.') as z4 \gset
reset role;

select set_config('test.user_id', 'dddd0000-0000-0000-0000-00000000000d', false);
set role authenticated;

select pg_temp.check('nepřečtené jsou nahoře',
  (select count(*) from (
     select neprectenych, row_number() over () as poradi
     from public.moje_rozhovory(:'tenant')
   ) r where r.poradi <= 2 and r.neprectenych > 0) = 2);

select pg_temp.check('a ze dvou nepřečtených je první ten starší',
  (select konverzace_id from public.moje_rozhovory(:'tenant') limit 1) = :'kanal');

reset role;


\echo ''
\echo '== 6. Cizí firma ========================================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma odvozený kanál nevidí',
  (select count(*) from public.konverzace where id = :'kanal') = 0);
select pg_temp.check('a nevyrobí si ho ani zavoláním',
  (select count(*) from public.moje_rozhovory(:'tenant')) = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kanal_pobocky(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí firma si vyrobila kanál'; end if;
  raise notice '  OK    cizí firma si kanál nevyrobí';
end $$;

reset role;


\echo ''
\echo '== KROK 25 HOTOV ========================================'
