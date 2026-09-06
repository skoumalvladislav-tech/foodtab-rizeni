-- Scénář pro krok 26 — úseky místo napevno psaných oddělení.
--
-- Pokrývá migraci 20260906030000_useky a zadání
-- docs/nocni-prace-komunikace-2026-09-05.md, krok D.
--
-- Navazuje na etapa0_scenar.sql až krok25_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Nová tabulka je nejnebezpečnější v tom, na co se u ní zapomíná:
-- GRANTY. Politika říká, KTERÉ řádky; grant říká, jestli se na tabulku
-- vůbec smí sáhnout — a poslední plošný `grant … on all tables` je
-- v migraci z 23. 8. Tabulka založená dnes tedy nemá pro
-- `authenticated` právo žádné a dotaz spadne na 42501 DŘÍV, než se
-- politika zeptá na řádky. Nespadne pak jen seznam úseků, ale celá
-- obrazovka. Přesně takhle položil `employees.color` Lidi i Rozpis
-- směn 3. 9. večer a kontrola to nechytila, protože sahala pod
-- superuživatelem.
--
-- Proto se v oddílu 1 čte i zapisuje POD ROLÍ `authenticated`.
--
-- Druhá věc: převod starých dat. Šablona, která měla `department`, musí
-- mít po migraci `usek_id` — a nesmí ho ztratit ani ta, kterou zakládá
-- seed a krok2_scenar, protože ty o `usek_id` nevědí.

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

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);


\echo ''
\echo '== 1. Tabulka je vidět POD ROLÍ, ne jen superuživateli =='

/*
  Kdyby chyběl `grant select … to authenticated`, spadne tahle první
  kontrola na 42501 — a přesně to je ta chyba, kterou u nové tabulky
  nikdo nečeká. Schválně vyzkoušeno vyndáním grantu z migrace: spadlo.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;

select pg_temp.check('člen firmy na tabulku úseků dosáhne',
  (select count(*) from public.useky) >= 0);

-- Zápis smí jen settings.manage. Majitel má všechno z aktivních modulů.
insert into public.useky (tenant_id, branch_id, nazev, poradi)
values (:'tenant', null, 'Cukrárna', 60);
select id as cukrarna from public.useky
 where tenant_id = :'tenant' and nazev = 'Cukrárna' \gset

select pg_temp.check('majitel úsek založí', :'cukrarna' is not null);
select pg_temp.check('a hned ho i vidí',
  (select count(*) from public.useky where id = :'cukrarna') = 1);

reset role;


\echo ''
\echo '== 2. Dvakrát týž název v jedné firmě neprojde ==========='

/*
  `nulls not distinct` v jedinečném indexu je tu to podstatné. Bez něj
  se dva firemní úseky (`branch_id is null`) považují za různé, protože
  dva NULLy si v SQL nejsou rovny — a jedinečnost by u těch
  nejčastějších úseků nehlídala vůbec nic.

  Zkoušeno i s jiným psaním velkých písmen, protože „Bar" a „bar" jsou
  pro člověka jedno a totéž.
*/

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.useky (tenant_id, branch_id, nazev)
    values (current_setting('test.tenant')::uuid, null, 'cukrárna');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhý úsek téhož jména prošel'; end if;
  raise notice '  OK    druhý firemní úsek téhož jména neprojde';
end $$;

-- Na pobočce je to jiný úsek a projít MÁ: řetězec může mít „Bar“
-- v každé provozovně jiný.
insert into public.useky (tenant_id, branch_id, nazev)
values (:'tenant', :'perla', 'Cukrárna');
select pg_temp.check('týž název u pobočky projde — je to jiné pracoviště',
  (select count(*) from public.useky
   where tenant_id = :'tenant' and lower(nazev) = 'cukrárna') = 2);


\echo ''
\echo '== 3. Pětice zmizela z kódu ============================='

/*
  Tohle je vlastní smysl kroku D: v omezení tabulky nesmí zbýt výčet
  cizího provozu. Kdyby se `check` vrátil, tahle kontrola spadne.
*/

select pg_temp.check('checklist_templates už nemá omezení na pětici',
  not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'checklist_templates'
      and pg_get_constraintdef(c.oid) like '%kuchyne%'));

select pg_temp.check('a má odkaz na úsek',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'checklist_templates'
      and column_name = 'usek_id'));

/*
  POZNÁMKA K ROZSAHU, ať to ráno není překvapení: `public.positions` má
  TENTÝŽ sloupec `department` s TOUŽ napevno psanou pěticí
  (20260823120000_foundation.sql). Nesahal jsem na něj — převod by
  shodil krok17_scenar a krok20_scenar, a ty jsou cizí. Tahle kontrola
  to tvrzení drží pravdivé: až se pětice odstraní i tam, spadne
  a bude se muset přepsat.
*/
select pg_temp.check('u positions pětice ZATÍM zůstává (nález do hlášení)',
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'positions'
      and pg_get_constraintdef(c.oid) like '%kuchyne%'));


\echo ''
\echo '== 4. Stará data se převedla ============================'

-- Šablonu z krok2_scenar zakládal `department = 'kuchyne'`.
select pg_temp.check('šablona z krok2 má po migraci úsek',
  exists (
    select 1 from public.checklist_templates t
    join public.useky u on u.id = t.usek_id
    where t.name = 'Otevírací checklist' and u.nazev = 'Kuchyně'));

-- A seedovaná šablona (`department = 'provoz'`) taky. Seed běží až po
-- scénářích, takže tady se kontroluje ta z krok2; ta druhá se ověří
-- mostem níž.
select pg_temp.check('převod nezaložil úseky pro hodnoty, které v datech nejsou',
  not exists (
    select 1 from public.useky
    where tenant_id = :'tenant' and nazev in ('Vedení')
      and not exists (
        select 1 from public.checklist_templates t
        where t.tenant_id = :'tenant' and t.department = 'vedeni')));


\echo ''
\echo '== 5. Most pro starý zápis =============================='

/*
  Seed a krok2_scenar pořád zapisují `department` a `usek_id` neznají.
  Bez mostu by jim šablona vznikla bez úseku a obrazovka by u ní ukázala
  prázdno — chyba, která nespadne a jen tiše chybí. To je ten nejhorší
  druh.
*/

insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule)
values (:'tenant', :'perla', 'Zavírací checklist', 'bar', 'closing');

select pg_temp.check('starý zápis přes department dostal úsek',
  exists (
    select 1 from public.checklist_templates t
    join public.useky u on u.id = t.usek_id
    where t.name = 'Zavírací checklist' and u.nazev = 'Bar'));

-- Neznámá hodnota se přenese, jak je — nepřepisuje se na nic z pětice.
insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule)
values (:'tenant', :'perla', 'Zahrádka ráno', 'zahradka', 'opening');

select pg_temp.check('neznámý úsek se založí pod svým jménem',
  exists (
    select 1 from public.checklist_templates t
    join public.useky u on u.id = t.usek_id
    where t.name = 'Zahrádka ráno' and u.nazev = 'zahradka'));

-- Kdo `usek_id` vyplní sám, tomu ho most nepřepíše.
insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule, usek_id)
values (:'tenant', :'perla', 'Vlastní úsek', 'bar', 'opening', :'cukrarna');

select pg_temp.check('vyplněný usek_id most nepřepíše',
  (select usek_id from public.checklist_templates where name = 'Vlastní úsek') = :'cukrarna');


\echo ''
\echo '== 6. Kdo nemá settings.manage, úsek nezaloží ==========='

select id as role_kuchyne from public.roles
 where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffff0000-0000-0000-0000-00000000000f', 'filip@foodtab.cz', '{"full_name":"Filip Kuchař"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', 'ffff0000-0000-0000-0000-00000000000f', 'Filip Kuchař', 'hpp');
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', 'ffff0000-0000-0000-0000-00000000000f', :'role_kuchyne', 'branch', 'active');
select id as clen_filip from public.memberships
 where user_id = 'ffff0000-0000-0000-0000-00000000000f' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_filip', :'perla');

select set_config('test.user_id', 'ffff0000-0000-0000-0000-00000000000f', false);
set role authenticated;

select pg_temp.check('kuchař settings.manage nemá',
  not app.has_access(:'tenant', 'settings.manage', :'perla'));

-- Číst je ale musí: jinak by u úkolu neviděl, kam patří.
select pg_temp.check('a přesto úseky ČTE — jinak by nevěděl, kam úkol patří',
  (select count(*) from public.useky where tenant_id = :'tenant') > 0);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.useky (tenant_id, branch_id, nazev)
    values (current_setting('test.tenant')::uuid, null, 'Podvrh');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kuchař založil úsek'; end if;
  raise notice '  OK    kuchař úsek nezaloží';
end $$;

reset role;


\echo ''
\echo '== 7. Cizí firma ========================================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma úseky nevidí',
  (select count(*) from public.useky where tenant_id = :'tenant') = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.useky (tenant_id, branch_id, nazev)
    values (current_setting('test.tenant')::uuid, null, 'Cizí');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí firma založila úsek'; end if;
  raise notice '  OK    cizí firma úsek nezaloží';
end $$;

reset role;


\echo ''
\echo '== 8. Úsek je v auditu =================================='

select pg_temp.check('založení úseku se zapsalo do auditu',
  exists (select 1 from public.audit_log
          where entity_type = 'usek' and action = 'usek.insert'));


\echo ''
\echo '== KROK 26 HOTOV ========================================'
