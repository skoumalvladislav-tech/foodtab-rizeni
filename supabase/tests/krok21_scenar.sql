-- Scénář pro krok 21 — barva u člověka.
--
-- Pokrývá migraci 20260903080000_barva_u_cloveka a zadání
-- docs/barva-u-cloveka-zadani.md, oddíl „Testy“.
--
-- Navazuje na etapa0_scenar.sql až krok20_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Nejdůležitější kontrola je čtvrtá: až barvy dojdou, člověk zůstane
-- BEZ barvy. Kdyby se paleta začala točit dokola, dvě různé Aničky by
-- v jednom kalendáři měly tutéž barvu a vypadaly jako jeden člověk.
-- Prázdno je poctivější — je vidět, že barvy došly.

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
-- Vlastní firma, ne ta ze seedu: paleta se tu bude schválně vyčerpávat
-- a v Foodtabu s.r.o. už dvanáct lidí barvy má. Cizí firma by se navíc
-- musela uklidit, aby další scénáře běžely nad tím, co čekají.
-- =====================================================================

insert into public.tenants (name, currency, timezone)
values ('Barevná s.r.o.', 'CZK', 'Europe/Prague')
returning id as tenant \gset

insert into public.branches (tenant_id, name, slug, timezone, day_starts_at, color)
values (:'tenant', 'Barevná — Jedna', 'barevna-jedna', 'Europe/Prague', '05:00', 'rose')
returning id as b1 \gset

insert into public.branches (tenant_id, name, slug, timezone, day_starts_at, color)
values (:'tenant', 'Barevná — Dvě', 'barevna-dve', 'Europe/Prague', '05:00', 'rose')
returning id as b2 \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.b1', :'b1', false);


\echo ''
\echo '== 1. Barva se přidělí sama a uloží se ==================='

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'b1', 'Anička První', 'hpp')
returning id as a1 \gset

select color as barva_a1 from public.employees where id = :'a1' \gset

select pg_temp.check('nový člověk barvu dostal',
  (select color is not null from public.employees where id = :'a1'));

select pg_temp.check('a je to klíč z palety, ne hex (' || :'barva_a1' || ')',
  :'barva_a1' in ('firma','slate','indigo','violet','sky','teal','emerald','amber','rose'));

-- Barva je ÚDAJ, ne výpočet ze jména. Přejmenování s ní nehne.
update public.employees set full_name = 'Anička Přejmenovaná' where id = :'a1';

select pg_temp.check('přejmenování barvu nezmění',
  (select color from public.employees where id = :'a1') = :'barva_a1');

-- A dá se přepsat i vyprázdnit.
update public.employees set color = 'teal' where id = :'a1';
select pg_temp.check('barva jde přepsat ručně',
  (select color from public.employees where id = :'a1') = 'teal');

update public.employees set color = null where id = :'a1';
select pg_temp.check('a jde i vyprázdnit — spouštěč ji nevrátí',
  (select color is null from public.employees where id = :'a1'));

update public.employees set color = :'barva_a1' where id = :'a1';


\echo ''
\echo '== 2. Na téže pobočce dva stejnou barvu nedostanou ======='

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'b1', 'Anička Druhá', 'hpp')
returning id as a2 \gset

select pg_temp.check('druhý člověk na téže pobočce dostal jinou',
  (select color from public.employees where id = :'a1')
  <> (select color from public.employees where id = :'a2'));

-- A ručně se stejná vnutit nedá.
do $$
declare v_ok boolean := false;
begin
  begin
    update public.employees
       set color = (select color from public.employees
                    where full_name = 'Anička Přejmenovaná'
                      and tenant_id = current_setting('test.tenant')::uuid)
     where full_name = 'Anička Druhá'
       and tenant_id = current_setting('test.tenant')::uuid;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: dva lidé na pobočce mají stejnou barvu'; end if;
  raise notice '  OK    stejnou barvu na pobočce nevnutí ani ruční zápis';
end $$;


\echo ''
\echo '== 3. Na různých pobočkách stejnou mít můžou ============='

-- Paleta má devět odstínů a lidí bývá víc. Kalendář je ale vždycky za
-- jednu pobočku, takže napříč firmou se lišit nemusí.

insert into public.employees (tenant_id, branch_id, full_name, employment_type, color)
values (:'tenant', :'b2', 'Anička Odjinud', 'hpp',
        (select color from public.employees where id = :'a1'))
returning id as a3 \gset

select pg_temp.check('na druhé pobočce smí mít tutéž barvu',
  (select color from public.employees where id = :'a3')
  = (select color from public.employees where id = :'a1'));


\echo ''
\echo '== 4. Když barvy dojdou, člověk zůstane bez barvy ========'

-- Na b1 je zatím dvojice. Doplní se na devět, tedy na celou paletu,
-- a desátý už nemá z čeho brát.

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
select :'tenant', :'b1', 'Výplň ' || i, 'hpp'
from generate_series(3, 9) as i;

select count(*) as obsazenych from public.employees
where tenant_id = :'tenant' and branch_id = :'b1'
  and color is not null and deleted_at is null \gset

select pg_temp.check('paleta se na pobočce vyčerpala (' || :'obsazenych' || ' z 9)',
  :'obsazenych'::int = 9);

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'b1', 'Desátý Bez Barvy', 'hpp')
returning id as a10 \gset

select pg_temp.check('desátý zůstal bez barvy',
  (select color is null from public.employees where id = :'a10'));

-- A hlavně: nic se nepřidělilo podruhé.
select pg_temp.check('žádná barva na pobočce není dvakrát',
  (select count(*) from (
     select color from public.employees
     where tenant_id = :'tenant' and branch_id = :'b1'
       and color is not null and deleted_at is null
     group by color having count(*) > 1
   ) x) = 0);

-- Smazaný člověk barvu uvolní — jinak by se pobočka po roce fluktuace
-- zasekla na samých prázdných.
update public.employees set deleted_at = now(), color = null
 where full_name = 'Výplň 9' and tenant_id = :'tenant';

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'b1', 'Po Odchodu', 'hpp')
returning id as a11 \gset

select pg_temp.check('po odchodu se barva uvolní pro dalšího',
  (select color is not null from public.employees where id = :'a11'));


\echo ''
\echo '== 5. Lidé bez pobočky tvoří vlastní skupinu ============='

-- „Firemní“ člověk nemá branch_id. Bez `nulls not distinct` by dva
-- NULLy platily za různé pobočky a jedinečnost by mezi nimi neplatila.

insert into public.employees (tenant_id, branch_id, full_name, employment_type, color)
values (:'tenant', null, 'Firemní Jedna', 'hpp', 'indigo')
returning id as f1 \gset

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.employees (tenant_id, branch_id, full_name, employment_type, color)
    values (current_setting('test.tenant')::uuid, null, 'Firemní Dvě', 'hpp', 'indigo');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: dva firemní lidé mají stejnou barvu'; end if;
  raise notice '  OK    ani mezi lidmi bez pobočky se barva neopakuje';
end $$;


\echo ''
\echo '== 6. Mimo paletu se nic neuloží ========================='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.employees (tenant_id, branch_id, full_name, employment_type, color)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.b1')::uuid, 'Svítivá', 'hpp', '#ffff00');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: do sloupce prošel hex místo klíče'; end if;
  raise notice '  OK    hex ani cizí klíč do sloupce neprojde';
end $$;


\echo ''
\echo '== 7. Barvu mění, kdo spravuje lidi ======================'

-- Žádné nové právo: změna barvy je běžná úprava člověka a jede přes
-- tutéž politiku jako jméno nebo pozice. Ověřuje se, že to tak zůstalo
-- — kdyby barva potřebovala něco navíc, brigádník by ji přepsal.

select user_id as marek from public.profiles where email = 'cisnik@foodtab.cz' \gset

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_zmeneno int;
begin
  update public.employees set color = 'violet'
   where tenant_id = current_setting('test.tenant')::uuid
     and full_name = 'Desátý Bez Barvy';
  get diagnostics v_zmeneno = row_count;
  if v_zmeneno <> 0 then
    raise exception 'SELHALO: cizí účet přepsal barvu v cizí firmě';
  end if;
  raise notice '  OK    do cizí firmy na barvu nikdo nedosáhne';
end $$;

reset role;


\echo ''
\echo '== 8. Doplnění lidem, kteří barvu nemají ================='

/*
  Doplnění je součást migrace, ale migrace běží nad prázdnou tabulkou —
  jako holý `update` by to byla prázdná operace a tahle kontrola by na
  ni nesáhla. Proto je to funkce a volá se tady.

  Zkouší se na zkušební firmě: barvy se všem seberou a doplní znovu.
*/

update public.employees set color = null where tenant_id = :'tenant';

select pg_temp.check('před doplněním nemá barvu nikdo',
  (select count(*) from public.employees
    where tenant_id = :'tenant' and color is not null) = 0);

select app.doplnit_barvy_lidem(:'tenant');

select pg_temp.check('po doplnění mají barvu ti, na které vyšla',
  (select count(*) from public.employees
    where tenant_id = :'tenant' and branch_id = :'b1'
      and color is not null and deleted_at is null) = 9);

select pg_temp.check('a doplněním se žádná barva nezopakovala',
  (select count(*) from (
     select branch_id, color from public.employees
     where tenant_id = :'tenant' and color is not null and deleted_at is null
     group by branch_id, color having count(*) > 1
   ) x) = 0);

select pg_temp.check('na koho nevyšla, zůstal bez barvy',
  (select count(*) from public.employees
    where tenant_id = :'tenant' and branch_id = :'b1'
      and color is null and deleted_at is null) > 0);


\echo ''
\echo '== 9. Doplnění vyšlo i na skutečných lidech =============='

/*
  Až sem se zkoušelo na vyrobené firmě. Tohle se ptá na tu ze seedu —
  na dvanáct lidí, kvůli kterým se to celé počítalo.

  Doplnění je součást migrace: bez něj by barvu měl jen ten, koho někdo
  založí zítra, funkce by se nasadila a nebylo by po ní nic vidět.
*/

select id as seed from public.tenants where name = 'Foodtab s.r.o.' \gset

select string_agg(x.popis, ' | ' order by x.popis) as rozlozeni from (
  select coalesce(b.name, '(bez pobočky)') || ': ' || count(*) || ' lidí, '
         || count(e.color) || ' s barvou' as popis
  from public.employees e
  left join public.branches b on b.id = e.branch_id
  where e.tenant_id = :'seed' and e.deleted_at is null
  group by coalesce(b.name, '(bez pobočky)')
) x \gset

/*
  „Všichni mají barvu“ tady NEPLATÍ a platit nemá.

  V ostrých datech má Černá Perla osm lidí a Bernard Bar čtyři, takže
  devět odstínů stačí. V testovací databázi jich ale na Perle je pětadvacet
  — každý scénář si přidá svoje —, a od desátého se barva správně
  nepřiděluje.

  Kontrola proto říká to, co má doopravdy platit: na každé pobočce má
  barvu tolik lidí, kolik jich jde obarvit, a ani o jednoho víc.
  Rozložení je v popisu, ať je při pádu vidět, o co šlo.
*/
select pg_temp.check('obarveno tolik lidí, kolik jde (' || :'rozlozeni' || ')',
  (select count(*) from (
     select e.branch_id
     from public.employees e
     where e.tenant_id = :'seed' and e.deleted_at is null
     group by e.branch_id
     having count(e.color) <> least(count(*), 9)
   ) x) = 0);

select pg_temp.check('a na žádné pobočce se barva neopakuje',
  (select count(*) from (
     select branch_id, color
     from public.employees
     where tenant_id = :'seed' and deleted_at is null and color is not null
     group by branch_id, color
     having count(*) > 1
   ) x) = 0);

-- Zkušební úklid: zaměstnanci ano, firma a pobočky zůstávají.
--
-- `delete from public.branches` tady být nemůže. PGlite, na kterém se
-- scénáře pouští bez psql, spadne na kontrole cizího klíče
-- `audit_log_branch_id_fkey` („gave unexpected result“) i nad prázdným
-- auditem — je to jeho omezení, ne porušené pravidlo. Psát do scénáře
-- krok, který si neumím pustit, nebudu.
--
-- Nevadí to: „Barevná s.r.o.“ se pozná podle jména a žádný scénář se
-- neptá na „všechny firmy“. Kdyby se někdy začal, je tohle to místo,
-- kde se to má dopsat.
delete from public.employees where tenant_id = :'tenant';

select pg_temp.check('zkušební lidé jsou pryč',
  (select count(*) from public.employees where tenant_id = :'tenant') = 0);


\echo ''
\echo '== KROK 21 HOTOV ========================================='
