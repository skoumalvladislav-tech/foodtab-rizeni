-- Scénář pro krok 58 — majitel přiděluje práva lidem a zařazením.
--
-- NEPOKRÝVÁ ŽÁDNOU NOVOU MIGRACI. Příčina hlášení byla v aplikaci
-- a hlídá ji scripts/prava-osob.test.mjs. Tady se hlídá druhá půlka
-- téže cesty: že zápisy, ke kterým se aplikace po opravě konečně
-- dostane, databáze majiteli PUSTÍ — pod rolí `authenticated`, přes
-- granty i politiky.
--
-- Navazuje na etapa0_scenar.sql až krok57_scenar.sql (seed firmy,
-- poboček Černá Perla / Bernard Bar a majitele).
--
-- ---------------------------------------------------------------------
-- HLÁŠENÍ (24. 9. 2026)
--
-- „Nefunguje přiřazování práv k osobám." V ostré databázi byla
-- `employee_permissions` prázdná a za den v logu ani jeden zápis do ní
-- ani do `position_permissions`. Obrazovky Lidé a Zařazení i akce
-- u člověka se ptaly `has_access` se SLUGEM z adresy („firma",
-- „cerna-perla") místo id pobočky — databáze odpověděla 22P02,
-- aplikace to přečetla jako „nesmí" a zamkla zaškrtávátka všem,
-- majiteli taky. Oddíl 1 tu příčinu dokládá přímo v databázi.
--
-- Že to databáze po opravě pustí, nebylo samozřejmé: od 9. 9. 2026 tudy
-- naostro neprošel ani jeden zápis a mezitím se čistily granty
-- (20260917000000_granty_provoz_uklid.sql) i audit (insert do
-- `audit_log` už `authenticated` nemá — píše jen definer spoušť).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   0. příprava: majitel bez pobočky (branch_id NULL), rozsah celá firma;
--   1. příčina: has_access se slugem spadne 22P02, s `null` majitele pustí;
--   2. výjimky u člověka BEZ ÚČTU: insert, přepsání tak, jak ho posílá
--      supabase-js `upsert` (insert … on conflict do update), smazání;
--   3. práva zařazení: přidání a odebrání;
--   4. přeřazení člověka pod jiné zařazení a zpět;
--   5. rozsah člověka s účtem: `memberships.scope`, `membership_branches`;
--   6. audit: každá změna práv má záznam s majitelem jako autorem.
--
-- Každý zápis se ověřuje ČTENÍM po `reset role`, ne tím, že nespadl:
-- politika, která řádek nepustí, u UPDATE a DELETE nehlásí chybu —
-- změní nula řádků a mlčí (docs/pravidlo-neprideluj-vic.md).
--
-- PGLITE: tady grant i politiku pod `set role authenticated` uplatní —
-- ověřeno schválným rozbitím 25. 9. 2026 (odebraný insert na
-- employee_permissions, politika delete `using (false)`, politika
-- memberships_update `using (… and false)`: všechny tři spadly, ta
-- s delete na kontrole čtením, ne na chybě). Rozhoduje stejně běh
-- Databáze proti PostgreSQL 16.
--
-- Oddíl 1 dokládá SMLOUVU, na které stojí oprava v aplikaci: třetí
-- parametr `has_access` je uuid. Kdyby se jednou funkce naučila slug,
-- kontrola spadne — a má: pak je potřeba znovu promyslet
-- `smiSpravovatPrava` v lib/authz.ts, ne kontrolu změkčit.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

-- Projde příkaz BEZ výjimky? Když neprojde, ať to spadne pojmenovanou
-- kontrolou a důvod se vypíše — ne holou výjimkou uprostřed scénáře.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
-- Předchozí scénář nechává test.user_id nastavené.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('58580000-0000-0000-0000-000000000001', 'petr58@foodtab.cz', '{"full_name":"Petr Padesátosm"}');

-- Zařazení jako Číšník: rozpis a docházka, nic víc.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska58_cisnik', 'Zkouška 58 — číšník', 'servis', true)
returning id as z_cisnik \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska58_kuchar', 'Zkouška 58 — kuchař', 'kuchyne', true)
returning id as z_kuchar \gset

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_cisnik', 'shifts.read'),
  (:'tenant', :'z_cisnik', 'attendance.read'),
  (:'tenant', :'z_kuchar', 'shifts.read');

-- Jana: brigádnice BEZ ÚČTU — tak vypadá většina lidí v ostré firmě.
insert into public.employees (tenant_id, branch_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'z_cisnik', 'Jana Padesátosm', 'dpp')
returning id as jana \gset

-- Petr: s účtem a členstvím jen na Perle.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '58580000-0000-0000-0000-000000000001', :'z_cisnik', 'Petr Padesátosm', 'hpp')
returning id as petr \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '58580000-0000-0000-0000-000000000001', null, 'branch', 'active')
returning id as m_petr \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'m_petr', :'perla');


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

-- Zadání: majitel firmy má employees.branch_id NULL a členství scope
-- tenant. Kdyby seed vypadal jinak, oddíly níž by zkoušely jiného
-- člověka, než o kterém je hlášení.
select pg_temp.check('příprava: majitel je majitel a nemá pobočku (branch_id NULL)',
  exists (select 1 from public.employees
           where tenant_id = :'tenant' and user_id = :'majitel'
             and deleted_at is null and je_majitel and branch_id is null));

select pg_temp.check('příprava: majitel má členství s rozsahem celé firmy',
  exists (select 1 from public.memberships
           where tenant_id = :'tenant' and user_id = :'majitel'
             and status = 'active' and scope = 'tenant'));

select pg_temp.check('příprava: Jana nemá účet, Petr ano',
  (select user_id is null from public.employees where id = :'jana')
  and (select user_id is not null from public.employees where id = :'petr'));


\echo ''
\echo '== 1. Příčina: slug z adresy místo id pobočky ============'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Přesně tohle volala aplikace na /firma/nastaveni/lide a /role.
select pg_temp.check('has_access s „firma" místo pobočky spadne na uuid (22P02)',
  pg_temp.spadne_hlaskou(format(
    'select public.has_access(%L, %L, %L)', :'tenant', 'settings.manage', 'firma'),
    '22P02', 'uuid'));

-- A tohle na adrese pobočky. Nepomohla ani ta.
select pg_temp.check('… a stejně tak se slugem pobočky „cerna-perla"',
  pg_temp.spadne_hlaskou(format(
    'select public.has_access(%L, %L, %L)', :'tenant', 'settings.manage', 'cerna-perla'),
    '22P02', 'uuid'));

-- Oprava se ptá na firmu (null), stejně jako politiky obou tabulek.
select pg_temp.check('s null (firemní úroveň) majitele pustí',
  public.has_access(:'tenant', 'settings.manage', null));

reset role;


\echo ''
\echo '== 2. Výjimky u člověka bez účtu ========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel přidá výjimku navíc (mzdy)',
  pg_temp.projde(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, true)', :'tenant', :'jana', 'payroll.read')));

select pg_temp.check('… a odebere právo, které dává zařazení (docházka)',
  pg_temp.projde(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, false)', :'tenant', :'jana', 'attendance.read')));

/*
  Takhle zapisuje aplikace: supabase-js `upsert(…, { onConflict:
  'employee_id,permission_key' })` pošle PostgRESTu insert s přepsáním
  všech poslaných sloupců. Na PostgreSQL to kromě insertu chce i politiku
  UPDATE a SELECT na existující řádek.
*/
select pg_temp.check('… a přepíše výjimku tak, jak to posílá aplikace (upsert)',
  pg_temp.projde(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, false)
     on conflict (employee_id, permission_key) do update
       set tenant_id = excluded.tenant_id, employee_id = excluded.employee_id,
           permission_key = excluded.permission_key, granted = excluded.granted',
    :'tenant', :'jana', 'payroll.read')));

reset role;

select pg_temp.check('výjimky jsou v tabulce, jak je majitel zadal',
  (select string_agg(permission_key || '=' || granted, ',' order by permission_key)
     from public.employee_permissions where employee_id = :'jana')
  = 'attendance.read=false,payroll.read=false');

select pg_temp.check('skládací pravidlo je bere: docházku Jana nemá, i když ji dává zařazení',
  not app.ma_pravo_clovek(:'tenant', :'jana', 'attendance.read')
  and app.ma_pravo_clovek(:'tenant', :'jana', 'shifts.read'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- „Vrátit na zařazení": aplikace výjimku smaže.
select pg_temp.check('majitel výjimku smaže (vrátit na zařazení)',
  pg_temp.projde(format(
    'delete from public.employee_permissions where employee_id = %L and permission_key in (%L)',
    :'jana', 'attendance.read')));

reset role;

select pg_temp.check('výjimka docházky je opravdu pryč a Jana má docházku zase ze zařazení',
  not exists (select 1 from public.employee_permissions
               where employee_id = :'jana' and permission_key = 'attendance.read')
  and app.ma_pravo_clovek(:'tenant', :'jana', 'attendance.read'));


\echo ''
\echo '== 3. Práva zařazení ====================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel přidá zařazení právo',
  pg_temp.projde(format(
    'insert into public.position_permissions (tenant_id, position_id, permission_key)
     values (%L, %L, %L)', :'tenant', :'z_cisnik', 'tasks.read')));

select pg_temp.check('… a jiné odebere',
  pg_temp.projde(format(
    'delete from public.position_permissions where position_id = %L and permission_key in (%L)',
    :'z_cisnik', 'attendance.read')));

reset role;

select pg_temp.check('zařazení má přesně to, co majitel nechal',
  (select string_agg(permission_key, ',' order by permission_key)
     from public.position_permissions where position_id = :'z_cisnik')
  = 'shifts.read,tasks.read');


\echo ''
\echo '== 4. Přeřazení člověka =================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel přeřadí Janu pod jiné zařazení',
  pg_temp.projde(format(
    'update public.employees set position_id = %L where id = %L', :'z_kuchar', :'jana')));

reset role;
select pg_temp.check('Jana je opravdu kuchař',
  (select position_id from public.employees where id = :'jana') = :'z_kuchar'::uuid);

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('a zpátky, i na „žádné"',
  pg_temp.projde(format(
    'update public.employees set position_id = null where id = %L', :'jana')));
reset role;
select pg_temp.check('Jana je bez zařazení',
  (select position_id is null from public.employees where id = :'jana'));


\echo ''
\echo '== 5. Rozsah člověka s účtem ============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Pořadí jako v aplikaci: napřed členství, pak pobočky.
select pg_temp.check('majitel přepíše rozsah (celá firma)',
  pg_temp.projde(format(
    'update public.memberships set scope = %L where id = %L', 'tenant', :'m_petr')));

reset role;
select pg_temp.check('Petr má rozsah celé firmy',
  (select scope from public.memberships where id = :'m_petr') = 'tenant');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('… a zpátky na vybrané pobočky',
  pg_temp.projde(format(
    'update public.memberships set scope = %L where id = %L', 'branch', :'m_petr')));

select pg_temp.check('… přidá pobočku Bar',
  pg_temp.projde(format(
    'insert into public.membership_branches (membership_id, branch_id) values (%L, %L)',
    :'m_petr', :'bar')));

select pg_temp.check('… a Perlu odebere',
  pg_temp.projde(format(
    'delete from public.membership_branches where membership_id = %L and branch_id in (%L)',
    :'m_petr', :'perla')));

reset role;

select pg_temp.check('Petr má vybrané pobočky a z nich jen Bar',
  (select scope from public.memberships where id = :'m_petr') = 'branch'
  and (select string_agg(branch_id::text, ',') from public.membership_branches
        where membership_id = :'m_petr') = :'bar');


\echo ''
\echo '== 6. Audit ============================================='

/*
  `authenticated` od 20260917000000 do `audit_log` sám nezapíše.
  Zapisuje definer spoušť `app.audit_zmenu` — kdyby přestala, práva by
  se měnila dál a nikde by nebylo kdo a kdy. V ostré databázi za tři
  dny žádná změna práv v auditu nebyla; tady se ověřuje, že ji tam
  po opravě uvidíme.
*/
select pg_temp.check('výjimka u člověka je v auditu a autorem je majitel',
  exists (select 1 from public.audit_log
           where action = 'opravneni_cloveka.insert'
             and actor_id = :'majitel'
             and after ->> 'employee_id' = :'jana'));

select pg_temp.check('smazání výjimky taky',
  exists (select 1 from public.audit_log
           where action = 'opravneni_cloveka.delete'
             and actor_id = :'majitel'
             and before ->> 'employee_id' = :'jana'));

select pg_temp.check('a změna práv zařazení taky',
  exists (select 1 from public.audit_log
           where action = 'opravneni_zarazeni.insert'
             and actor_id = :'majitel'
             and after ->> 'position_id' = :'z_cisnik'));


\echo ''
\echo '== Úklid ================================================='

select set_config('test.user_id', '', false);

delete from public.employee_permissions where employee_id in (:'jana', :'petr');
delete from public.membership_branches where membership_id = :'m_petr';
delete from public.memberships where id = :'m_petr';
delete from public.employees where id in (:'jana', :'petr');
delete from public.position_permissions where position_id in (:'z_cisnik', :'z_kuchar');
delete from public.positions where id in (:'z_cisnik', :'z_kuchar');

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 58',
  not exists (select 1 from public.employees where full_name like '%Padesátosm')
  and not exists (select 1 from public.positions where key like 'zkouska58_%')
  and not exists (select 1 from public.memberships where id = :'m_petr'));

\echo ''
\echo '== KROK 58 HOTOV ========================================'
