-- Scénář pro krok 58 — majitel přiděluje práva lidem a zařazením.
--
-- Oddíly 0–6 NEPOKRÝVAJÍ ŽÁDNOU MIGRACI. Příčina hlášení byla
-- v aplikaci a hlídá ji scripts/prava-osob.test.mjs. Tady se hlídá
-- druhá půlka téže cesty: že zápisy, ke kterým se aplikace po opravě
-- konečně dostane, databáze majiteli PUSTÍ — pod rolí `authenticated`,
-- přes granty i politiky.
--
-- Oddíly 7 a 8 pokrývají 20260925120000_prava_firma_radku.sql:
-- oprávnění nejde zapsat pod cizí firmu (spouště) a jádro cizí řádek
-- nezapočítá (filtr v šesti funkcích). Každá linie má vlastní kontroly
-- a každou jde shodit zvlášť — oddíl 8 proto běží s VYPNUTÝMI spouštěmi.
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
--   6. audit: každá změna práv má záznam s majitelem jako autorem;
--   7. cizí firma, první linie: majitel firmy B, který je u nás číšníkem,
--      si pod firmou B nezapíše výjimku ani právo zařazení NAŠEMU
--      člověku a nedá svému člověku naše zařazení;
--   8. cizí firma, druhá linie: řádek z doby před spouštěmi jádro
--      nezapočítá — `has_access`, `has_permission`, `ma_pravo_clovek`,
--      `cekaji_na_opravneni`, `upozorni_na_clenstvi`, `upozorni_na_prijeti`,
--      každá zvlášť pro výjimku (ep) i pro zařazení (pp).
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


-- =====================================================================
-- CIZÍ FIRMA (20260925120000_prava_firma_radku.sql)
--
-- Xaver je u nás číšník na Perle a zároveň majitel vlastní firmy B.
-- Ve firmě B má `settings.manage`, takže mu politiky na obou tabulkách
-- pustí každý řádek s `tenant_id = B`. Do 25. 9. 2026 stačilo do toho
-- řádku napsat NAŠEHO zaměstnance nebo NAŠE zařazení a jádro ho u nás
-- započítalo (nález nezávislé kontroly, ověřeno v PGlite).
--
-- Yveta a Zdeněk jsou naši lidé bez jediného práva u nás. Jsou tu kvůli
-- funkcím, které se ptají „má vůbec nějaké právo?" (okno čekajících
-- a dvě upozornění): Yveta na výjimku, Zdeněk na zařazení.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('58580000-0000-0000-0000-000000000002', 'xaver58@jinafirma.cz', '{"full_name":"Xaver Padesátosm"}'),
  ('58580000-0000-0000-0000-000000000003', 'yveta58@foodtab.cz',   '{"full_name":"Yveta Padesátosm"}'),
  ('58580000-0000-0000-0000-000000000004', 'zdenek58@foodtab.cz',  '{"full_name":"Zdeněk Padesátosm"}');

-- Firma B vzniká tak, jak vzniká každá: Xaver ji založí a je v ní majitel.
set role authenticated;
select set_config('test.user_id', '58580000-0000-0000-0000-000000000002', false);
select app.create_tenant('Krok58 Cizí s.r.o.', 'Xaver Padesátosm') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

select id as z_b from public.positions where tenant_id = :'tenant_b' and key = 'servis' \gset

-- U nás: Xaverovo zařazení dává jen rozpis. Zdeňkovo nedává nic.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska58_xaver', 'Zkouška 58 — Xaverův číšník', 'servis', true)
returning id as z_xaver \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska58_prazdne', 'Zkouška 58 — bez práv', 'servis', true)
returning id as z_prazdne \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_xaver', 'shifts.read');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '58580000-0000-0000-0000-000000000002', :'z_xaver', 'Xaver Padesátosm', 'dpp')
returning id as xaver \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '58580000-0000-0000-0000-000000000002', null, 'branch', 'active')
returning id as m_xaver \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'m_xaver', :'perla');

-- Yveta a Zdeněk dostanou členství až v oddílu 8, po starých řádcích:
-- spoušť upozornění na členství se ptá v okamžiku zápisu.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '58580000-0000-0000-0000-000000000003', null, 'Yveta Padesátosm', 'dpp')
returning id as yveta \gset

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '58580000-0000-0000-0000-000000000004', :'z_prazdne', 'Zdeněk Padesátosm', 'dpp')
returning id as zdenek \gset

/*
  Šárka spravuje u nás nastavení a nic jiného — výjimkou, bez zařazení.
  Lidi NEVIDÍ: `employees_select` pouští podle rozpisu na pobočce nebo
  správy lidí. Spoušť, která by zaměstnance hledala pod jejími právy,
  by ho nenašla a odmítla by jí i zápis, na který právo má.
*/
insert into auth.users (id, email, raw_user_meta_data) values
  ('58580000-0000-0000-0000-000000000005', 'sarka58@foodtab.cz', '{"full_name":"Šárka Padesátosm"}');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', null, '58580000-0000-0000-0000-000000000005', null, 'Šárka Padesátosm', 'ico')
returning id as sarka \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'sarka', 'settings.manage', true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '58580000-0000-0000-0000-000000000005', null, 'tenant', 'active');


\echo ''
\echo '== 7. Cizí firma: zápis se do tabulky nedostane =========='

set role authenticated;
select set_config('test.user_id', '58580000-0000-0000-0000-000000000002', false);

-- Příprava měří to, co má: kdyby Xaver u nás mzdy už měl, nebo ve
-- firmě B nastavení nespravoval, kontroly níž by nic nedokazovaly.
select pg_temp.check('příprava 7: Xaver má u nás jen rozpis, mzdy ani správu nastavení ne',
  public.has_access(:'tenant', 'shifts.read', :'perla')
  and not public.has_access(:'tenant', 'payroll.read', :'perla')
  and not public.has_access(:'tenant', 'settings.manage', :'perla'));

select pg_temp.check('příprava 7: ve firmě B spravuje nastavení (politika ho pustí)',
  public.has_access(:'tenant_b', 'settings.manage', null));

-- Pod NAŠÍ firmou ho zastaví politika. Tudy se nechodilo.
select pg_temp.check('výjimku pod naší firmou mu nepustí politika (42501)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, true)', :'tenant', :'xaver', 'settings.manage'),
    '42501', ''));

-- Tudy ano: řádek firmy B, zaměstnanec náš.
select pg_temp.check('výjimku pod firmou B našemu člověku nezapíše — „Zaměstnanec nepatří"',
  pg_temp.spadne_hlaskou(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, true)', :'tenant_b', :'xaver', 'settings.manage'),
    '23514', 'Zaměstnanec nepatří této firmě'));

select pg_temp.check('právo pod firmou B našemu zařazení nezapíše — „Zařazení nepatří"',
  pg_temp.spadne_hlaskou(format(
    'insert into public.position_permissions (tenant_id, position_id, permission_key)
     values (%L, %L, %L)', :'tenant_b', :'z_xaver', 'people.manage'),
    '23514', 'Zařazení nepatří této firmě'));

-- Ve vlastní firmě spoušť nepřekáží.
select pg_temp.check('ve firmě B založí svého člověka se zařazením firmy B',
  pg_temp.projde(format(
    'insert into public.employees (tenant_id, position_id, full_name, employment_type)
     values (%L, %L, %L, %L)', :'tenant_b', :'z_b', 'Bára Padesátosm', 'dpp')));

reset role;
select id as bara from public.employees
 where tenant_id = :'tenant_b' and full_name = 'Bára Padesátosm' \gset
set role authenticated;
select set_config('test.user_id', '58580000-0000-0000-0000-000000000002', false);

select pg_temp.check('… a dá jí výjimku',
  pg_temp.projde(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, true)', :'tenant_b', :'bara', 'shifts.manage')));

-- Oklikou přes úpravu: vlastní řádek přepíše na našeho člověka.
select pg_temp.check('výjimku Báry nepřepíše na našeho člověka (update)',
  pg_temp.spadne_hlaskou(format(
    'update public.employee_permissions set employee_id = %L where employee_id = %L',
    :'xaver', :'bara'),
    '23514', 'Zaměstnanec nepatří této firmě'));

-- Totéž u zařazení: právo vlastnímu zařazení dá, přepsat ho na naše ne.
select pg_temp.check('zařazení firmy B přidá právo (vlastní firmě spoušť nepřekáží)',
  pg_temp.projde(format(
    'insert into public.position_permissions (tenant_id, position_id, permission_key)
     values (%L, %L, %L)', :'tenant_b', :'z_b', 'payroll.read')));

select pg_temp.check('… ale nepřepíše ho na naše zařazení (update)',
  pg_temp.spadne_hlaskou(format(
    'update public.position_permissions set position_id = %L
      where position_id = %L and permission_key = %L',
    :'z_xaver', :'z_b', 'payroll.read'),
    '23514', 'Zařazení nepatří této firmě'));

-- Strop by tohle nezastavil: práva našeho zařazení ve firmě B nevidí,
-- takže „nepřiděluje nic navíc".
select pg_temp.check('Báru nepřeřadí pod naše zařazení',
  pg_temp.spadne_hlaskou(format(
    'update public.employees set position_id = %L where id = %L', :'z_xaver', :'bara'),
    '23514', 'Zařazení nepatří této firmě'));

select pg_temp.check('ani nezaloží nového člověka s naším zařazením',
  pg_temp.spadne_hlaskou(format(
    'insert into public.employees (tenant_id, position_id, full_name, employment_type)
     values (%L, %L, %L, %L)', :'tenant_b', :'z_xaver', 'Boris Padesátosm', 'dpp'),
    '23514', 'Zařazení nepatří této firmě'));

select pg_temp.check('a u nás pořád nemá mzdy, správu nastavení ani správu lidí',
  not public.has_access(:'tenant', 'payroll.read', :'perla')
  and not public.has_access(:'tenant', 'settings.manage', :'perla')
  and not public.has_access(:'tenant', 'people.manage', :'perla'));

-- Spoušť nesmí zastavit toho, kdo na zápis právo má, jen lidi nevidí.
select set_config('test.user_id', '58580000-0000-0000-0000-000000000005', false);

select pg_temp.check('příprava 7: Šárka spravuje nastavení, ale Janu nevidí',
  public.has_access(:'tenant', 'settings.manage', null)
  and not exists (select 1 from public.employees where id = :'jana'));

-- `granted = false` bere, takže ji nezastaví ani strop.
select pg_temp.check('Šárka Janě výjimku zapíše, i když ji nevidí',
  pg_temp.projde(format(
    'insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
     values (%L, %L, %L, false)', :'tenant', :'jana', 'attendance.read')));

reset role;
select set_config('test.user_id', '', false);

-- Čtením, ne tím, že to spadlo: v tabulkách opravdu nic takového není.
select pg_temp.check('v tabulkách nezůstal ani jeden řádek z pokusů',
  not exists (select 1 from public.employee_permissions where employee_id = :'xaver')
  and not exists (select 1 from public.position_permissions where position_id = :'z_xaver'
                    and tenant_id <> :'tenant')
  and (select position_id from public.employees where id = :'bara') = :'z_b'::uuid
  and (select employee_id from public.employee_permissions
        where tenant_id = :'tenant_b' and permission_key = 'shifts.manage') = :'bara'::uuid
  and exists (select 1 from public.position_permissions
               where tenant_id = :'tenant_b' and position_id = :'z_b'
                 and permission_key = 'payroll.read'));

select pg_temp.check('a Šárčina výjimka u Jany v tabulce je',
  exists (select 1 from public.employee_permissions
           where tenant_id = :'tenant' and employee_id = :'jana'
             and permission_key = 'attendance.read' and not granted));


\echo ''
\echo '== 8. Cizí firma: starý řádek jádro nezapočítá ==========='

/*
  Řádky, které by v databázi zůstaly z doby před spouštěmi, nebo které
  spoušť obešly (servisní klíč, ruční zásah v SQL editoru). Zapisují
  se s VYPNUTÝMI spouštěmi z oddílu 7 — jinak by se sem nedostaly
  a kontroly níž by zůstaly zelené i bez filtru v jádru (skill scenar,
  3b). Vypíná se jen ta jedna dvojice spouští, audit běží dál.

  Xaver: výjimka mzdy (přidat), výjimka rozpisu (sebrat — i tohle
  cizí firma uměla: vzít našemu člověku právo) a jeho zařazení dostane
  správu lidí. Yveta: výjimka rozpisu. Zdeněk: jeho prázdné zařazení
  dostane rozpis.
*/
alter table public.employee_permissions disable trigger trg_firma_opravneni_cloveka;
alter table public.position_permissions disable trigger trg_firma_opravneni_zarazeni;

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant_b', :'xaver', 'payroll.read', true),
  (:'tenant_b', :'xaver', 'shifts.read',  false),
  (:'tenant_b', :'yveta', 'shifts.read',  true);

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant_b', :'z_xaver',   'people.manage'),
  (:'tenant_b', :'z_prazdne', 'shifts.read');

alter table public.employee_permissions enable trigger trg_firma_opravneni_cloveka;
alter table public.position_permissions enable trigger trg_firma_opravneni_zarazeni;

-- Vypnutá spoušť, na kterou by se zapomnělo, je díra, ne test.
select pg_temp.check('obě spouště jsou zase zapnuté',
  (select count(*) from pg_trigger
    where tgname in ('trg_firma_opravneni_cloveka', 'trg_firma_opravneni_zarazeni')
      and tgenabled = 'O') = 2);

select pg_temp.check('příprava 8: pět cizích řádků opravdu leží v tabulkách',
  (select count(*) from public.employee_permissions
    where tenant_id = :'tenant_b' and employee_id in (:'xaver', :'yveta')) = 3
  and (select count(*) from public.position_permissions
    where tenant_id = :'tenant_b' and position_id in (:'z_xaver', :'z_prazdne')) = 2);

-- Členství Yvety a Zdeňka až teď, ať se spoušť upozornění ptá nad nimi.
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '58580000-0000-0000-0000-000000000003', null, 'branch', 'active'),
  (:'tenant', '58580000-0000-0000-0000-000000000004', null, 'branch', 'active');


-- ---------------------------------------------------------------------
-- has_access a has_permission: ptá se přihlášený Xaver sám za sebe.
-- ---------------------------------------------------------------------

set role authenticated;
select set_config('test.user_id', '58580000-0000-0000-0000-000000000002', false);

select pg_temp.check('has_access: cizí výjimka mu u nás mzdy nedá ani rozpis nevezme (ep)',
  not public.has_access(:'tenant', 'payroll.read', :'perla')
  and public.has_access(:'tenant', 'shifts.read', :'perla'));

select pg_temp.check('has_access: cizí právo na našem zařazení nedá správu lidí (pp)',
  not public.has_access(:'tenant', 'people.manage', :'perla'));

select pg_temp.check('has_permission: totéž pro výjimku (ep)',
  not app.has_permission(:'tenant', 'payroll.read')
  and app.has_permission(:'tenant', 'shifts.read'));

select pg_temp.check('has_permission: totéž pro zařazení (pp)',
  not app.has_permission(:'tenant', 'people.manage'));

reset role;
select set_config('test.user_id', '', false);


-- ---------------------------------------------------------------------
-- ma_pravo_clovek: na přihlášeného se neptá, pro `authenticated` je
-- odebraná. Ptají se jí upozornění, adresáti vzkazů a strop.
-- ---------------------------------------------------------------------

select pg_temp.check('ma_pravo_clovek: cizí výjimka se nepočítá (ep)',
  not app.ma_pravo_clovek(:'tenant', :'xaver', 'payroll.read')
  and app.ma_pravo_clovek(:'tenant', :'xaver', 'shifts.read'));

select pg_temp.check('ma_pravo_clovek: cizí právo zařazení se nepočítá (pp)',
  not app.ma_pravo_clovek(:'tenant', :'xaver', 'people.manage'));


-- ---------------------------------------------------------------------
-- „Má vůbec nějaké právo?" Yveta a Zdeněk u nás nemají nic, takže na
-- oprávnění čekají — cizí řádek to nesmí zakrýt.
-- ---------------------------------------------------------------------

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('cekaji_na_opravneni: Yveta čeká, cizí výjimka se nepočítá (ep)',
  exists (select 1 from public.cekaji_na_opravneni(:'tenant')
           where user_id = '58580000-0000-0000-0000-000000000003'));

select pg_temp.check('cekaji_na_opravneni: Zdeněk čeká, cizí právo zařazení se nepočítá (pp)',
  exists (select 1 from public.cekaji_na_opravneni(:'tenant')
           where user_id = '58580000-0000-0000-0000-000000000004'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('upozorni_na_clenstvi: Yvetě nepřišlo „bylo vám přiděleno" (ep)',
  not exists (select 1 from public.notifications
               where tenant_id = :'tenant' and druh = 'opravneni.prideleno'
                 and user_id = '58580000-0000-0000-0000-000000000003'));

select pg_temp.check('upozorni_na_clenstvi: Zdeňkovi taky ne (pp)',
  not exists (select 1 from public.notifications
               where tenant_id = :'tenant' and druh = 'opravneni.prideleno'
                 and user_id = '58580000-0000-0000-0000-000000000004'));

-- Zvoneček správcům lidí: „přijal pozvánku a ČEKÁ", ne „jen informace".
select app.upozorni_na_prijeti(:'tenant', '58580000-0000-0000-0000-000000000003');
select app.upozorni_na_prijeti(:'tenant', '58580000-0000-0000-0000-000000000004');

select pg_temp.check('upozorni_na_prijeti: u Yvety hlásí, že čeká (ep)',
  (select bool_and((telo ->> 'ceka')::boolean) and count(*) > 0
     from public.notifications
    where tenant_id = :'tenant' and druh = 'pozvanka.prijata'
      and telo ->> 'kdo' = '58580000-0000-0000-0000-000000000003'));

select pg_temp.check('upozorni_na_prijeti: u Zdeňka taky (pp)',
  (select bool_and((telo ->> 'ceka')::boolean) and count(*) > 0
     from public.notifications
    where tenant_id = :'tenant' and druh = 'pozvanka.prijata'
      and telo ->> 'kdo' = '58580000-0000-0000-0000-000000000004'));


\echo ''
\echo '== Úklid ================================================='

select set_config('test.user_id', '', false);

/*
  Firma B se maže celá. Kaskáda přes `tenant_id` vezme i cizí řádky
  z oddílu 8 — ty nesou firmu B, i když míří na naše lidi.
*/
delete from public.tenants where id = :'tenant_b';

delete from public.notifications
 where tenant_id = :'tenant'
   and (user_id in ('58580000-0000-0000-0000-000000000002',
                    '58580000-0000-0000-0000-000000000003',
                    '58580000-0000-0000-0000-000000000004',
                    '58580000-0000-0000-0000-000000000005')
        or telo ->> 'kdo' in ('58580000-0000-0000-0000-000000000003',
                              '58580000-0000-0000-0000-000000000004'));
delete from public.membership_branches where membership_id = :'m_xaver';
delete from public.memberships
 where tenant_id = :'tenant'
   and user_id in ('58580000-0000-0000-0000-000000000002',
                   '58580000-0000-0000-0000-000000000003',
                   '58580000-0000-0000-0000-000000000004',
                   '58580000-0000-0000-0000-000000000005');
delete from public.employee_permissions where employee_id = :'sarka';
delete from public.employees where id in (:'xaver', :'yveta', :'zdenek', :'sarka');
delete from public.position_permissions where position_id in (:'z_xaver', :'z_prazdne');
delete from public.positions where id in (:'z_xaver', :'z_prazdne');

select pg_temp.check('úklid: firma B je pryč i s cizími řádky',
  not exists (select 1 from public.tenants where id = :'tenant_b')
  and not exists (select 1 from public.employee_permissions where tenant_id = :'tenant_b')
  and not exists (select 1 from public.position_permissions where tenant_id = :'tenant_b'));

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
