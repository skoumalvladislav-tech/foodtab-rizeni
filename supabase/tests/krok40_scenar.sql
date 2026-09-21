-- Scénář pro krok 40 — potvrzení směny zaměstnancem.
--
-- Pokrývá migraci 20260920120000_potvrzeni_smen (puntík u času směny:
-- červený nevydáno, žlutý vydáno a nepotvrzeno, zelený vydáno a potvrzeno).
--
-- ---------------------------------------------------------------------
-- CO SE TU ZKOUŠÍ
--
--  1. potvrdit_smenu zapíše potvrzení s opisem směny a je opakovatelné,
--  2. potvrdit jde jen SVOU směnu, a jen vydanou a od vydání beze změny,
--  3. změna po potvrzení potvrzení nesmaže, ale opis přestane sedět
--     (aplikace pak směnu ukáže jako nepotvrzenou); nové potvrzení opis
--     přepíše,
--  4. tabulka nemá zápis mimo funkci, anon nemá nic,
--  5. RLS: vedoucí vidí potvrzení jen na pobočkách, kde plánuje.
--
-- Kontroly 1–4 stojí na výsledku funkce a katalogu. Oddíl 6 potřebuje
-- opravdový PostgreSQL: nad PGlite (jediný superuživatel) se RLS
-- neuplatní, tak se tam přeskočí a řekne se to nahlas; rozhoduje běh
-- proti PostgreSQL 16 (workflow Databáze).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

/*
  Zavolá potvrdit_smenu jako daný uživatel a vrátí „ok“ nebo kód chyby
  (`err:PT403`). Chybu polyká záměrně: scénář se ptá, ZDA a JAK funkce
  odmítla, ne aby spadl. Znění směny (den, časy, pauza) bere z databáze,
  tedy jako by si člověk právě obnovil obrazovku; `pg_temp.potvrdit_zneni`
  posílá znění výslovně (zastaralá obrazovka).
*/
create or replace function pg_temp.potvrdit_zneni(
  p_kdo uuid, p_smena uuid, p_den date, p_od time, p_do time,
  p_pauza_od time default null, p_pauza_do time default null, p_tenant uuid default null)
returns text language plpgsql as $$
begin
  perform set_config('test.user_id', p_kdo::text, false);
  begin
    perform public.potvrdit_smenu(coalesce(p_tenant, current_setting('test.tenant', true)::uuid), p_smena,
      p_den, p_od, p_do, p_pauza_od, p_pauza_do);
    return 'ok';
  exception when others then
    return 'err:' || sqlstate;
  end;
end $$;

create or replace function pg_temp.potvrdit(p_kdo uuid, p_smena uuid, p_tenant uuid default null)
returns text language plpgsql as $$
declare v public.shifts%rowtype;
begin
  select * into v from public.shifts where id = p_smena;
  -- Neexistující směna: znění je jedno, funkce ji odmítne dřív, než se na něj podívá.
  return pg_temp.potvrdit_zneni(p_kdo, p_smena,
    coalesce(v.shift_date, date '2026-01-01'), coalesce(v.starts_at, time '00:00'), coalesce(v.ends_at, time '00:00'),
    v.pauza_od, v.pauza_do, p_tenant);
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

select set_config('test.tenant', :'tenant', false);

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

-- Zaměstnanci s účtem (potvrzují) a jeden bez účtu (není komu psát).
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'vedouci', 'Účet Vedoucí', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'vedouci');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'majitel', 'Účet Majitel', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'majitel');
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bez Účtu Krok40', 'hpp')
returning id as e_bez \gset

select id as e_ucet    from public.employees where tenant_id = :'tenant' and user_id = :'vedouci' limit 1 \gset
select id as e_majitel from public.employees where tenant_id = :'tenant' and user_id = :'majitel' limit 1 \gset


\echo ''
\echo '== 1. Směny: vydaná, nevydaná, na Baru ==================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Vydá se vše do 9. 11.; koncept 10. 11. zůstane nevydaný.
select smena as s1 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-03', time '08:00', time '16:00', 'první') \gset
select smena as s_bez from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_bez', null,
  date '2026-11-03', time '10:00', time '18:00', 'bez účtu') \gset
select smena as s_zrus from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-04', time '08:00', time '16:00', 'zrušená') \gset
select smena as s_bar from public.ulozit_smenu(
  :'tenant', null, :'bar', :'e_majitel', null,
  date '2026-11-05', time '08:00', time '16:00', 'na baru') \gset
select smena as s_koncept from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-10', time '08:00', time '16:00', 'koncept') \gset
select smena as s_m from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_majitel', null,
  date '2026-11-07', time '08:00', time '16:00', 'majitel na Perle') \gset
select smena as s_prer from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-08', time '08:00', time '16:00', 'přeřazení a obnovení') \gset
select smena as s_dva from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-06', time '08:00', time '16:00', 'začátek a konec zvlášť') \gset

select public.vydat_rozpis(:'tenant', :'perla', date '2026-11-01', date '2026-11-09');
select public.vydat_rozpis(:'tenant', :'bar',   date '2026-11-01', date '2026-11-09');

reset role;

select pg_temp.check('nevydaná směna: potvrdit nejde (stav neodpovídá vydání)',
  pg_temp.potvrdit(:'vedouci', :'s_koncept') = 'err:PT409');


\echo ''
\echo '== 2. Potvrzení vydané směny =============================='

select pg_temp.potvrdit(:'vedouci', :'s1') as r1 \gset
select pg_temp.check('zaměstnanec potvrdí svou vydanou směnu', :'r1' = 'ok');

select confirmed_at::text as kdy1,
       (starts_at = time '08:00' and ends_at = time '16:00' and shift_date = date '2026-11-03'
        and branch_id = :'perla' and employee_id = :'e_ucet')::text as opis_ok
from public.smeny_potvrzeni where shift_id = :'s1' \gset

select pg_temp.check('záznam nese opis směny (den, časy), pobočku a zaměstnance', :'opis_ok' = 'true');

select pg_temp.potvrdit(:'vedouci', :'s1') as r2 \gset
select confirmed_at::text as kdy2 from public.smeny_potvrzeni where shift_id = :'s1' \gset

select pg_temp.check('potvrdit totéž podruhé projde a čas potvrzení se nemění',
  :'r2' = 'ok' and :'kdy1' = :'kdy2');
select pg_temp.check('a záznam je pořád jeden',
  (select count(*) from public.smeny_potvrzeni where shift_id = :'s1') = 1);


\echo ''
\echo '== 3. Kdo smí a co smí ===================================='

select pg_temp.check('cizí směnu (patří jinému zaměstnanci) potvrdit nejde',
  pg_temp.potvrdit(:'majitel', :'s1') = 'err:PT403');
select pg_temp.check('směna zaměstnance bez účtu: nikdo ji nepotvrdí za něj',
  pg_temp.potvrdit(:'vedouci', :'s_bez') = 'err:PT403');
select pg_temp.check('neexistující směna dá tutéž odpověď jako cizí (nedá se zkoušet, co existuje)',
  pg_temp.potvrdit(:'vedouci', gen_random_uuid()) = 'err:PT403');
select pg_temp.check('cizí firma (jiné tenant_id): odmítnuto',
  pg_temp.potvrdit(:'vedouci', :'s1', gen_random_uuid()) = 'err:PT403');

update public.shifts set status = 'cancelled' where id = :'s_zrus';
select pg_temp.check('zrušená směna: potvrdit nejde',
  pg_temp.potvrdit(:'vedouci', :'s_zrus') = 'err:PT409');
select pg_temp.check('… a nic se nezapsalo',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_zrus'));


-- Znění, které člověk vidí, musí sedět s databází (vedoucí mohl směnu mezitím změnit a vydat).
select pg_temp.check('zastaralá obrazovka (jiné časy, než jsou v databázi): potvrdit nejde',
  pg_temp.potvrdit_zneni(:'vedouci', :'s_prer', date '2026-11-08', time '07:00', time '15:00') = 'err:PT409');
select pg_temp.check('zastaralá obrazovka (jiný den): potvrdit nejde',
  pg_temp.potvrdit_zneni(:'vedouci', :'s_prer', date '2026-11-09', time '08:00', time '16:00') = 'err:PT409');
select pg_temp.check('zastaralá obrazovka (pauza, která v databázi není): potvrdit nejde',
  pg_temp.potvrdit_zneni(:'vedouci', :'s_prer', date '2026-11-08', time '08:00', time '16:00', time '12:00', time '13:00') = 'err:PT409');
select pg_temp.check('… a nic se nezapsalo', not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_prer'));

-- Směna přeřazená na jiného člověka bez nového vydání: nový držitel ji potvrdit nemůže.
update public.shifts set employee_id = :'e_majitel' where id = :'s_prer';
select pg_temp.check('přeřazená a nevydaná směna: nový držitel nepotvrdí (vydaná byla jinému)',
  pg_temp.potvrdit(:'majitel', :'s_prer') = 'err:PT409');
select pg_temp.check('… a původní držitel už není držitelem, taky nepotvrdí',
  pg_temp.potvrdit(:'vedouci', :'s_prer') = 'err:PT403');
update public.shifts set employee_id = :'e_ucet' where id = :'s_prer';

-- Zrušená a obnovená směna (published_status cancelled) se bere jako nevydaná.
update public.shifts set published_status = 'cancelled' where id = :'s_prer';
select pg_temp.check('zrušená a obnovená směna: potvrdit nejde', pg_temp.potvrdit(:'vedouci', :'s_prer') = 'err:PT409');
update public.shifts set published_status = 'planned' where id = :'s_prer';
select pg_temp.check('… a s vráceným stavem už jde', pg_temp.potvrdit(:'vedouci', :'s_prer') = 'ok');

\echo ''
\echo '== 4. Změna po potvrzení =================================='

-- Vedoucí posune čas potvrzené směny (zatím jen uloží, nevydá).
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-11-03', time '10:00', time '18:00', 'posun') \gset
reset role;

select pg_temp.check('po změně času potvrzení zůstává, ale opis už nesedí se směnou',
  (select p.starts_at = time '08:00' and s.starts_at = time '10:00'
   from public.smeny_potvrzeni p join public.shifts s on s.id = p.shift_id
   where p.shift_id = :'s1'));

select pg_temp.check('změněnou a nevydanou směnu potvrdit nejde',
  pg_temp.potvrdit(:'vedouci', :'s1') = 'err:PT409');

-- Vydá se znovu; teprve teď jde potvrdit nové znění.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.vydat_rozpis(:'tenant', :'perla', date '2026-11-01', date '2026-11-09');
reset role;

-- Pauza vydání nemění (není v jeho opisu), ale patří do opisu potvrzení.
update public.shifts set pauza_od = time '13:00', pauza_do = time '14:00' where id = :'s1';

select pg_temp.potvrdit(:'vedouci', :'s1') as r3 \gset
select (confirmed_at::text <> :'kdy1' and starts_at = time '10:00' and ends_at = time '18:00')::text as prepsano
from public.smeny_potvrzeni where shift_id = :'s1' \gset

select pg_temp.check('po novém vydání jde potvrdit; opis se přepíše a čas potvrzení je nový',
  :'r3' = 'ok' and :'prepsano' = 'true');
select pg_temp.check('pořád jeden záznam na směnu a člověka',
  (select count(*) from public.smeny_potvrzeni where shift_id = :'s1') = 1);

-- Pauza je součástí opisu: potvrzení si ji pamatuje a změna jen pauzy ho zneplatní.
select pg_temp.check('potvrzení nese pauzu, která platila při potvrzení',
  (select pauza_od = time '13:00' and pauza_do = time '14:00' from public.smeny_potvrzeni where shift_id = :'s1'));
update public.shifts set pauza_do = time '14:30' where id = :'s1';
select pg_temp.check('změna jen pauzy: opis přestane sedět',
  (select p.pauza_do is distinct from s.pauza_do
   from public.smeny_potvrzeni p join public.shifts s on s.id = p.shift_id
   where p.shift_id = :'s1'));


\echo ''
\echo '== 4b. Začátek a konec zvlášť, vrácení změny ============'

select pg_temp.potvrdit(:'vedouci', :'s_dva') as r_dva \gset
select pg_temp.check('druhá směna potvrzená (08–16)', :'r_dva' = 'ok');

-- Posune se jen konec: potvrdit nové znění bez vydání nejde (a naopak jen začátek).
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select smena from public.ulozit_smenu(:'tenant', :'s_dva', :'perla', :'e_ucet', null,
  date '2026-11-06', time '08:00', time '17:00', 'jen konec') \gset
reset role;
select pg_temp.check('změněný jen konec: potvrdit nejde', pg_temp.potvrdit(:'vedouci', :'s_dva') = 'err:PT409');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select smena from public.ulozit_smenu(:'tenant', :'s_dva', :'perla', :'e_ucet', null,
  date '2026-11-06', time '09:00', time '16:00', 'jen začátek') \gset
reset role;
select pg_temp.check('změněný jen začátek: potvrdit nejde', pg_temp.potvrdit(:'vedouci', :'s_dva') = 'err:PT409');

-- Vrátí-li se směna do vydaného znění, potvrdit jde zas a opis sedí s původním potvrzením.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select smena from public.ulozit_smenu(:'tenant', :'s_dva', :'perla', :'e_ucet', null,
  date '2026-11-06', time '08:00', time '16:00', 'zpět') \gset
reset role;
select pg_temp.check('směna zpět v původním znění: opis potvrzení sedí, potvrdit jde',
  (select p.starts_at = s.starts_at and p.ends_at = s.ends_at from public.smeny_potvrzeni p
   join public.shifts s on s.id = p.shift_id where p.shift_id = :'s_dva')
  and pg_temp.potvrdit(:'vedouci', :'s_dva') = 'ok');


-- Pobočka je součástí opisu: přesun potvrzené směny na jinou pobočku potvrzení zneplatní.
select pg_temp.check('potvrzení nese pobočku, na které platilo',
  (select branch_id = :'perla' from public.smeny_potvrzeni where shift_id = :'s_dva'));
update public.shifts set branch_id = :'bar' where id = :'s_dva';
select pg_temp.check('po přesunu na jinou pobočku opis nesedí (potvrzení platilo pro Perlu)',
  (select p.branch_id <> s.branch_id from public.smeny_potvrzeni p join public.shifts s on s.id = p.shift_id where p.shift_id = :'s_dva'));

-- Člověk potvrdí směnu na nové pobočce: opis (pobočka) se přepíše a čas potvrzení je nový.
select confirmed_at::text as kdy_pred from public.smeny_potvrzeni where shift_id = :'s_dva' \gset
select pg_temp.potvrdit(:'vedouci', :'s_dva') as r_presun \gset
select (branch_id = :'bar' and confirmed_at::text <> :'kdy_pred')::text as presun_ok from public.smeny_potvrzeni where shift_id = :'s_dva' \gset
select pg_temp.check('po přesunu jde potvrdit znovu: pobočka v opisu se přepíše a čas potvrzení je nový',
  :'r_presun' = 'ok' and :'presun_ok' = 'true');
update public.shifts set branch_id = :'perla' where id = :'s_dva';

\echo ''
\echo '== 5. Zápis jen funkcí, anon nemá nic ====================='

select pg_temp.check('RLS je zapnutá',
  (select relrowsecurity from pg_class where oid = 'public.smeny_potvrzeni'::regclass));
select pg_temp.check('přihlášený smí číst',
  has_table_privilege('authenticated', 'public.smeny_potvrzeni', 'select'));
select pg_temp.check('přihlášený nesmí zapisovat přímo (insert, update, delete)',
  not has_table_privilege('authenticated', 'public.smeny_potvrzeni', 'insert')
  and not has_table_privilege('authenticated', 'public.smeny_potvrzeni', 'update')
  and not has_table_privilege('authenticated', 'public.smeny_potvrzeni', 'delete'));
select pg_temp.check('anon nemá k tabulce nic',
  not has_table_privilege('anon', 'public.smeny_potvrzeni', 'select'));
select pg_temp.check('anon funkci volat nesmí, přihlášený smí (právo se ověřuje uvnitř)',
  not has_function_privilege('anon', 'public.potvrdit_smenu(uuid, uuid, date, time, time, time, time)', 'execute')
  and has_function_privilege('authenticated', 'public.potvrdit_smenu(uuid, uuid, date, time, time, time, time)', 'execute'));
select pg_temp.check('čtecí politika existuje a zápisová ne',
  (select count(*) from pg_policies where tablename = 'smeny_potvrzeni' and cmd = 'SELECT') = 1
  and (select count(*) from pg_policies where tablename = 'smeny_potvrzeni' and cmd <> 'SELECT') = 0);


\echo ''
\echo '== 6. RLS: vedoucí vidí jen pobočky, kde plánuje ==========='

-- Majitel potvrdí svou směnu na Baru; vedoucí Perly ji vidět nesmí.
select pg_temp.potvrdit(:'majitel', :'s_bar') as r_bar \gset
select pg_temp.check('majitel potvrdí svou vydanou směnu na Baru', :'r_bar' = 'ok');
select pg_temp.potvrdit(:'majitel', :'s_m') as r_m \gset
select pg_temp.check('majitel potvrdí svou vydanou směnu na Perle', :'r_m' = 'ok');

set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select (rolsuper or rolbypassrls)::text as obchazi_rls from pg_roles where rolname = current_user \gset

select count(*) filter (where shift_id = :'s1')    as v_perla,
       count(*) filter (where shift_id = :'s_m')   as v_cizi_perla,
       count(*) filter (where shift_id = :'s_bar') as v_bar
from public.smeny_potvrzeni \gset

select set_config('test.user_id', :'majitel', false);
select count(*) filter (where shift_id = :'s1')    as m_perla,
       count(*) filter (where shift_id = :'s_bar') as m_bar
from public.smeny_potvrzeni \gset

reset role;

select set_config('test.obchazi_rls', :'obchazi_rls', false);
select set_config('test.v_perla', :'v_perla', false);
select set_config('test.v_bar', :'v_bar', false);
select set_config('test.v_cizi_perla', :'v_cizi_perla', false);
select set_config('test.m_perla', :'m_perla', false);
select set_config('test.m_bar', :'m_bar', false);

do $$
begin
  if current_setting('test.obchazi_rls') = 'true' then
    raise notice '  PŘESKOČENO  RLS (spojení je superuživatel/bypassrls — PGlite); rozhoduje běh proti PostgreSQL';
  else
    if current_setting('test.v_perla')::int <> 1 then raise exception 'SELHALO: vedoucí Perly nevidí potvrzení na své pobočce'; end if;
    if current_setting('test.v_cizi_perla')::int <> 1 then raise exception 'SELHALO: vedoucí Perly nevidí potvrzení JINÉHO člověka na své pobočce (politika has_access)'; end if;
    if current_setting('test.v_bar')::int <> 0 then raise exception 'SELHALO: vedoucí Perly vidí potvrzení na Baru, který nespravuje'; end if;
    if current_setting('test.m_perla')::int <> 1 or current_setting('test.m_bar')::int <> 1 then
      raise exception 'SELHALO: majitel nevidí potvrzení na obou pobočkách';
    end if;
    raise notice '  OK    vedoucí Perly vidí Perlu a ne Bar; majitel vidí obě';
  end if;
end $$;

-- Přímý zápis pod rolí authenticated musí spadnout (jen v opravdovém PostgreSQL).
set role authenticated;
select set_config('test.user_id', :'vedouci', false);

do $$
declare v_ok boolean := false;
begin
  if (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) then
    raise notice '  PŘESKOČENO  přímý zápis (superuživatel)';
    return;
  end if;
  begin
    insert into public.smeny_potvrzeni (tenant_id, branch_id, shift_id, employee_id, shift_date, starts_at, ends_at)
    values (current_setting('test.tenant')::uuid, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
            date '2026-11-03', time '08:00', time '16:00');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přihlášený zapsal do smeny_potvrzeni přímo'; end if;
  raise notice '  OK    přímý zápis do smeny_potvrzeni spadl na právech';
end $$;

reset role;


\echo ''
\echo '== KROK 40 HOTOV ========================================'
