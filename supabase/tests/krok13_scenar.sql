-- Scénář pro krok 13 — upozornění na zapomenutý odchod.
--
-- Pokrývá migraci 20260902080000_zapomenuty_odchod a deset kontrol
-- z oddílu 5 zadání docs/zapomenuty-odchod-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok12_scenar.sql.
--
-- Kontroly míří na to, co NEMÁ jít: druhé upozornění při druhém
-- spuštění, upozornění pro toho, kdo docházku nespravuje, částka
-- v textu, a cizí firma.

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
-- Tři lidé: jeden s účtem, který zapomněl; jeden s účtem, který přišel
-- před chvílí; a brigádník BEZ ÚČTU, protože ten upozornění dostat
-- nemůže a tím spíš musí přijít vedoucímu.
-- =====================================================================

-- Podle jména, ne `limit 1`. Od krok11 jsou v databázi dvě firmy
-- a bez řazení si Postgres vybere, kterou chce — scénář pak padal
-- na tom, že „majitel nespravuje lidi“ v cizí firmě.
select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1b1b1b1-b1b1-4b1b-b1b1-b1b1b1b1b1b1', 'zapomnel@foodtab.cz',
   '{"full_name":"Zapomněl Zkouška"}'),
  ('b2b2b2b2-b2b2-4b2b-b2b2-b2b2b2b2b2b2', 'cerstvy@foodtab.cz',
   '{"full_name":"Čerstvý Zkouška"}')
on conflict (id) do nothing;

insert into public.employees (tenant_id, branch_id, full_name, employment_type, user_id)
values (:'tenant', :'perla', 'Zapomněl Zkouška', 'hpp',
        'b1b1b1b1-b1b1-4b1b-b1b1-b1b1b1b1b1b1')
returning id as e_zapomnel \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type, user_id)
values (:'tenant', :'perla', 'Čerstvý Zkouška', 'hpp',
        'b2b2b2b2-b2b2-4b2b-b2b2-b2b2b2b2b2b2')
returning id as e_cerstvy \gset

-- Brigádník bez účtu. Upozornění dostat nemůže — musí přijít vedoucímu.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Brigádník Bez Účtu', 'dpp')
returning id as e_brigadnik \gset

select set_config('test.tenant', :'tenant', false);

-- Hranice 20 hodin a hodina, která už dnes nastala. Kdyby se nechala
-- devátá, scénář by v osm ráno neprošel — a nebyla by to chyba kódu.
insert into public.tenant_settings (tenant_id, zapomenuty_odchod_hodin, zapomenuty_odchod_kdy)
values (:'tenant', 20, time '00:00')
on conflict (tenant_id) do update
  set zapomenuty_odchod_hodin = 20, zapomenuty_odchod_kdy = time '00:00';


\echo ''
\echo '== 1.+2. Starý příchod ano, čerstvý ne ===================='

-- Starý příchod: před 30 hodinami, bez odchodu.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_zapomnel', 'in', 'app', now() - interval '30 hours')
returning id as ud_stary \gset

-- Čerstvý příchod: před hodinou.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_cerstvy', 'in', 'app', now() - interval '1 hour');

-- Brigádník taky zapomněl.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_brigadnik', 'in', 'app', now() - interval '26 hours')
returning id as ud_brigadnik \gset

select public.ohlasit_zapomenute_odchody() as ohlaseno1 \gset

select pg_temp.check('starý příchod se ohlásil',
  exists (select 1 from public.zapomenute_odchody where attendance_id = :'ud_stary'));

select pg_temp.check('čerstvý příchod se neohlásil',
  not exists (
    select 1 from public.zapomenute_odchody z
    join public.attendance_events a on a.id = z.attendance_id
    where a.employee_id = :'e_cerstvy'));

select pg_temp.check('zaměstnanec dostal upozornění',
  exists (select 1 from public.notifications
          where user_id = 'b1b1b1b1-b1b1-4b1b-b1b1-b1b1b1b1b1b1'
            and druh = 'dochazka.zapomenuty_odchod'));

select pg_temp.check('a je označené jako jeho vlastní',
  (select telo ->> 'moje' from public.notifications
   where user_id = 'b1b1b1b1-b1b1-4b1b-b1b1-b1b1b1b1b1b1'
     and druh = 'dochazka.zapomenuty_odchod') = 'true');


\echo ''
\echo '== 3. Dvojí spuštění nevyrobí druhé upozornění ============'

select count(*) as pred_druhym from public.notifications
  where druh = 'dochazka.zapomenuty_odchod' \gset

select public.ohlasit_zapomenute_odchody() as ohlaseno2 \gset

select pg_temp.check('druhé spuštění nic nového neohlásilo', :'ohlaseno2'::integer = 0);

select pg_temp.check('a upozornění nepřibylo',
  (select count(*) from public.notifications
   where druh = 'dochazka.zapomenuty_odchod') = :'pred_druhym'::integer);

select pg_temp.check('poznámka o záznamu je právě jedna',
  (select count(*) from public.zapomenute_odchody
   where attendance_id = :'ud_stary') = 1);


\echo ''
\echo '== 4. Komu to přijde ======================================'

select pg_temp.check('majitel docházku na Perle spravuje',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'attendance.manage', :'perla')
          where user_id = :'majitel'));

select pg_temp.check('a upozornění dostal',
  exists (select 1 from public.notifications
          where user_id = :'majitel' and druh = 'dochazka.zapomenuty_odchod'
            and telo ->> 'jmeno' = 'Zapomněl Zkouška'));

select pg_temp.check('u něj je označené jako cizí, ne jeho',
  (select telo ->> 'moje' from public.notifications
   where user_id = :'majitel' and druh = 'dochazka.zapomenuty_odchod'
     and telo ->> 'jmeno' = 'Zapomněl Zkouška') = 'false');

-- A tohle je ta mez: čerstvě pozvaný člověk bez attendance.manage.
select pg_temp.check('kdo docházku nespravuje, nedostal nic',
  not exists (select 1 from public.notifications
              where user_id = 'a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2'
                and druh = 'dochazka.zapomenuty_odchod'));


\echo ''
\echo '== 5. Brigádník bez účtu =================================='

select pg_temp.check('brigádníkův záznam se ohlásil',
  exists (select 1 from public.zapomenute_odchody where attendance_id = :'ud_brigadnik'));

select pg_temp.check('vedoucímu o něm přišlo upozornění',
  exists (select 1 from public.notifications
          where user_id = :'majitel' and druh = 'dochazka.zapomenuty_odchod'
            and telo ->> 'jmeno' = 'Brigádník Bez Účtu'));

-- Bez účtu není komu poslat. Musí být poznat, že se to neztratilo —
-- proto se ověřuje, že upozornění existuje právě jen to vedoucímu.
select pg_temp.check('a jemu samotnému nikam nic nešlo',
  (select count(*) from public.notifications
   where druh = 'dochazka.zapomenuty_odchod'
     and telo ->> 'jmeno' = 'Brigádník Bez Účtu'
     and telo ->> 'moje' = 'true') = 0);


\echo ''
\echo '== 6. Cizí firma se o ničem nedozví ======================='

select id as tenant2 from public.tenants
  where id <> :'tenant' order by created_at limit 1 \gset

select pg_temp.check('v cizí firmě žádné takové upozornění není',
  not exists (select 1 from public.notifications
              where tenant_id = :'tenant2'
                and druh = 'dochazka.zapomenuty_odchod'));


\echo ''
\echo '== 7. Po doplnění odchodu už nic nechodí =================='

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at, note)
values (:'tenant', :'perla', :'e_zapomnel', 'out', 'manual',
        now() - interval '22 hours', 'zkouška: doplněný odchod');

select count(*) as pred_doplnenim from public.notifications
  where druh = 'dochazka.zapomenuty_odchod' \gset

select public.ohlasit_zapomenute_odchody() as ohlaseno3 \gset

select pg_temp.check('po doplnění se nic dalšího neposlalo',
  (select count(*) from public.notifications
   where druh = 'dochazka.zapomenuty_odchod') = :'pred_doplnenim'::integer);

/*
  A poznámka ZŮSTÁVÁ. Kdyby ji doplněný odchod mazal a člověk by si
  odchod zase smazal, přišlo by upozornění znovu a vypadalo by to jako
  chyba (zadání, oddíl 3).
*/
select pg_temp.check('poznámka o ohlášení se doplněním nesmazala',
  exists (select 1 from public.zapomenute_odchody where attendance_id = :'ud_stary'));


\echo ''
\echo '== 8. Cizí upozornění se nepřečte ========================='

set role authenticated;
select set_config('test.user_id', 'b1b1b1b1-b1b1-4b1b-b1b1-b1b1b1b1b1b1', false);

select pg_temp.check('své upozornění vidí',
  (select count(*) from public.notifications
   where druh = 'dochazka.zapomenuty_odchod') = 1);

select pg_temp.check('cizí NE, ani přímým dotazem',
  (select count(*) from public.notifications
   where user_id = :'majitel') = 0);

-- Poznámky úlohy nejsou pro nikoho.
do $$
declare v_ok boolean := false;
begin
  begin
    perform 1 from public.zapomenute_odchody limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: poznámky úlohy jdou přečíst'; end if;
  raise notice '  OK    poznámky úlohy nejde přečíst';
end $$;

-- A samotnou úlohu nikdo z aplikace nespustí.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ohlasit_zapomenute_odchody();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: úlohu jde spustit z aplikace'; end if;
  raise notice '  OK    úlohu z aplikace nikdo nespustí';
end $$;

reset role;


\echo ''
\echo '== 9. V textu není žádná částka ==========================='

/*
  Ověřuje se na ŘETĚZCI, ne okem. Chybějící odchod je provozní věc, ne
  mzdová — kdyby se do těla dostala sazba, byl by z upozornění mzdový
  údaj a platila by na něj jiná pravidla.
*/
select pg_temp.check('v těle není „Kč“',
  not exists (select 1 from public.notifications
              where druh = 'dochazka.zapomenuty_odchod'
                and telo::text like '%Kč%'));

select pg_temp.check('ani „halere“ nebo „sazba“',
  not exists (select 1 from public.notifications
              where druh = 'dochazka.zapomenuty_odchod'
                and (telo::text ilike '%haler%' or telo::text ilike '%sazb%')));

select pg_temp.check('a žádné číslo, které by mohlo být částka',
  not exists (
    select 1 from public.notifications
    where druh = 'dochazka.zapomenuty_odchod'
      and jsonb_path_exists(telo, '$.* ? (@.type() == "number")')));


\echo ''
\echo '== 10. Zmeškané spuštění doběhne později =================='

/*
  Když plánovač v devět neběžel, běh v jedenáct musí doběhnout. Hodina
  z nastavení se porovnává „aspoň tolik“, ne „přesně tolik“ — tady se
  proto nastaví hodina o dvě zpátky a ověří se, že to pořád projde.

  Před druhou ráno by se odečtením spadlo do včerejška, takže se v tu
  dobu bere půlnoc. Scénář má projít v kteroukoli hodinu.
*/
-- Bez účtu: jeden účet smí mít ve firmě jen jeden zaměstnanecký
-- záznam, a o účet tady nejde — jde o hodinu spuštění.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Zmeškaný Zkouška', 'dpp')
returning id as e_zmeskany \gset

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_zmeskany', 'in', 'app', now() - interval '40 hours')
returning id as ud_zmeskany \gset

update public.tenant_settings
  set zapomenuty_odchod_kdy = case
        when (now() at time zone 'Europe/Prague')::time >= time '02:00'
          then ((now() at time zone 'Europe/Prague') - interval '2 hours')::time
        else time '00:00'
      end
  where tenant_id = :'tenant';

select public.ohlasit_zapomenute_odchody() as ohlaseno4 \gset

select pg_temp.check('běh o dvě hodiny později doběhl',
  exists (select 1 from public.zapomenute_odchody where attendance_id = :'ud_zmeskany'));

-- A obráceně: dokud hodina nenastala, neozve se nic.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Předčasný Zkouška', 'dpp')
returning id as e_brzy \gset

insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, source, occurred_at)
values (:'tenant', :'perla', :'e_brzy', 'in', 'app', now() - interval '40 hours')
returning id as ud_brzy \gset

update public.tenant_settings
  set zapomenuty_odchod_kdy = case
        when (now() at time zone 'Europe/Prague')::time < time '22:00'
          then ((now() at time zone 'Europe/Prague') + interval '2 hours')::time
        else time '23:59:59'
      end
  where tenant_id = :'tenant';

select public.ohlasit_zapomenute_odchody() as ohlaseno5 \gset

select pg_temp.check('před nastavenou hodinou se neozve nic',
  not exists (select 1 from public.zapomenute_odchody where attendance_id = :'ud_brzy'));

-- Uklidit po sobě, ať další scénáře nekoukají na podivné nastavení.
update public.tenant_settings
  set zapomenuty_odchod_kdy = time '09:00', zapomenuty_odchod_hodin = 20
  where tenant_id = :'tenant';


\echo ''
\echo '== KROK 13 HOTOV ========================================='
