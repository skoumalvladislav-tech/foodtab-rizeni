-- Scénář pro krok 70 — bezpečnost a izolace katalogu surovin a historie
-- nákupních cen.
--
-- krok69_scenar.sql ověřuje VÝPOČET (cena ke dni, foodcost). Tenhle
-- scénář se ptá KDO SMÍ CO — vzor krok58_scenar.sql (skutečná druhá
-- firma, ne jen "cizí tenant_id v proměnné").
--
-- Migrace: 20261002100000_sklad_suroviny_zaklad.sql, včetně oprav
-- přidaných v TÉTO ověřovací fázi (viz komentáře v migraci značené
-- "OPRAVA"):
--   a) `unique (tenant_id, lower(name))` byla neplatná syntaxe table
--      constraint — migrace se vůbec nenasadila. Nahrazeno částečným
--      indexem `ingredients_tenant_nazev` (vzor `employees_tenant_jmeno`).
--   b) `ingredient_purchase_prices` měla `grant ... delete ...
--      authenticated` + politiku `for all` jen na `purchasing.manage` —
--      DELETE historie cen tím byl dovolený, přestože komentář tabulky
--      slibuje immutabilitu. Grant DELETE odebrán (vzor employee_rates:
--      "authenticated na sazby nedosáhne vůbec").
--   c) chyběla druhá linie hlídající, že `ingredient_id` patří TÉŽE
--      firmě jako `tenant_id` řádku (vzor `trg_firma_opravneni_cloveka`
--      z krok58) — přidána spoušť `trg_firma_cena_suroviny`.
--
-- Pokrývá:
--   0. příprava měří to, co má (skladník/čtečka/cizí majitel);
--   1. cizí firma nevidí suroviny ani ceny (RLS read);
--   2. cizí firma nezapíše cenu k NAŠÍ surovině — ani pod naším
--      tenant_id (RLS, první linie), ani pod SVÝM tenant_id s cizím
--      ingredient_id (spoušť, druhá linie);
--   3. purchasing.read bez purchasing.manage cenu nezapíše (RLS write);
--   4. historie je immutabilní: UPDATE neprojde (pravidlo, i na
--      superuživateli), DELETE neprojde (chybějící grant);
--   5. kaskáda z ingredients na ingredient_purchase_prices funguje dál,
--      i když authenticated samotnou historii cen smazat nesmí — na
--      tomhle předpokladu oprava (b) stojí a scénář ho ověřuje, ne
--      jen předpokládá.
--
-- Navazuje na etapa0_scenar.sql a krok69_scenar.sql (firma "Foodtab
-- s.r.o.", pobočka Černá Perla, majitel, modul Objednávky aktivní).

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

-- Projde příkaz BEZ výjimky?
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
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

-- Modul Objednávky — scénář musí fungovat i spuštěný samostatně
-- (node scripts/scenare-pglite.mjs krok70_scenar), ne jen po krok69.
insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'objednavky')
on conflict (tenant_id, module_key) do nothing;


-- =====================================================================
-- PŘÍPRAVA: skladník (purchasing.manage) a jen-čtečka (purchasing.read)
-- u NÁS, a SKUTEČNÁ druhá firma se svým majitelem (krok58 styl).
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70700000-0000-0000-0000-000000000001', 'sklad70@foodtab.cz',   '{"full_name":"Skladník Sedmdesát"}'),
  ('70700000-0000-0000-0000-000000000002', 'ctecka70@foodtab.cz',  '{"full_name":"Jen Čtenářka Sedmdesát"}'),
  ('70700000-0000-0000-0000-000000000003', 'xaver70@jinafirma.cz', '{"full_name":"Xaver Sedmdesát"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok70_sklad', 'Zkouška 70 — sklad', 'kuchyne', true)
returning id as z_sklad \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok70_ctecka', 'Zkouška 70 — jen čtení skladu', 'kuchyne', true)
returning id as z_ctecka \gset

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_sklad',  'purchasing.manage'),
  (:'tenant', :'z_sklad',  'purchasing.read'),
  (:'tenant', :'z_ctecka', 'purchasing.read');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '70700000-0000-0000-0000-000000000001', :'z_sklad', 'Skladník Sedmdesát', 'hpp')
returning id as sklad \gset

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '70700000-0000-0000-0000-000000000002', :'z_ctecka', 'Jen Čtenářka Sedmdesát', 'hpp')
returning id as ctecka \gset

-- `app.has_access` (jádro, 20260909100000_zarazeni_jadro.sql): "p_branch
-- = NULL (firemní úroveň) → vyžaduje rozsah 'tenant'". Suroviny nemají
-- branch_id vůbec, politiky proto volají has_access/can_read_scoped
-- vždy s `null` — kdo má jen `scope = 'branch'`, has_access mu ZÁPIS
-- nepustí, ať má v zařazení purchasing.manage nebo ne. Skladník proto
-- MUSÍ mít rozsah celé firmy, jinak by test měřil tohle omezení rozsahu,
-- ne oprávnění purchasing.manage, které se tu zkouší.
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '70700000-0000-0000-0000-000000000001', null, 'tenant', 'active')
returning id as m_sklad \gset

-- Čtečka zůstává záměrně na rozsahu pobočky — `can_read_scoped` s
-- `p_branch = null` se ptá jen `app.has_permission` (bez omezení na
-- rozsah), takže čtení jí rozsah pobočky neomezí. Scénář tím zkouší
-- přesně to, co se liší: ZÁPIS rozsah vyžaduje, ČTENÍ ne.
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '70700000-0000-0000-0000-000000000002', null, 'branch', 'active')
returning id as m_ctecka \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'m_ctecka', :'perla');

-- Druhá firma vzniká tak, jak vzniká každá — Xaver ji založí a je v ní
-- majitel. app.create_tenant mu sama vytvoří zaměstnanecký záznam
-- (je_majitel) i členství s rozsahem celé firmy.
set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000003', false);
select app.create_tenant('Krok70 Cizí s.r.o.', 'Xaver Sedmdesát') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

-- Modul Objednávky i ve firmě B — bez něj by `has_access` odmítla
-- i jejího majitele (modul, ne jen právo, viz krok4 "finance.read
-- nedává ve vypnutém modulu nic ani vlastníkovi").
insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'objednavky')
on conflict (tenant_id, module_key) do nothing;

-- Naše surovina a její cena (vytváří ji náš skladník).
set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000001', false);

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok70 Naše mouka', 'g')
returning id as nase_surovina \gset

insert into public.ingredient_purchase_prices
  (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'nase_surovina', 5000, 20000, date '2026-09-01')
returning id as nase_cena \gset

-- Cizí surovina a cena (vytváří je Xaver ve firmě B).
reset role;
set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000003', false);

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant_b', 'Krok70 Cizí mouka', 'g')
returning id as cizi_surovina \gset

insert into public.ingredient_purchase_prices
  (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant_b', :'cizi_surovina', 5000, 25000, date '2026-09-01')
returning id as cizi_cena \gset

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 0. Příprava měří to, co má =============================='

set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000001', false);
select pg_temp.check('příprava: skladník má purchasing.manage u nás',
  app.has_access(:'tenant', 'purchasing.manage', null));

select set_config('test.user_id', '70700000-0000-0000-0000-000000000002', false);
select pg_temp.check('příprava: čtečka má purchasing.read, ale NE purchasing.manage',
  app.can_read_scoped(:'tenant', 'purchasing.read', null)
  and not app.has_access(:'tenant', 'purchasing.manage', null));

select set_config('test.user_id', '70700000-0000-0000-0000-000000000003', false);
select pg_temp.check('příprava: Xaver má purchasing.manage jen ve FIRMĚ B, ne u nás',
  app.has_access(:'tenant_b', 'purchasing.manage', null)
  and not app.has_access(:'tenant', 'purchasing.manage', null));
reset role;


\echo ''
\echo '== 1. Cizí firma nevidí suroviny ani ceny ==================='

set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000001', false);

select pg_temp.check('náš skladník vidí NAŠI surovinu',
  exists (select 1 from public.ingredients where id = :'nase_surovina'));
select pg_temp.check('náš skladník NEVIDÍ surovinu firmy B',
  not exists (select 1 from public.ingredients where id = :'cizi_surovina'));
select pg_temp.check('náš skladník NEVIDÍ cenu firmy B',
  not exists (select 1 from public.ingredient_purchase_prices where id = :'cizi_cena'));

reset role;
set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000003', false);

select pg_temp.check('Xaver (firma B) vidí SVOJI surovinu',
  exists (select 1 from public.ingredients where id = :'cizi_surovina'));
select pg_temp.check('Xaver (firma B) NEVIDÍ naši surovinu',
  not exists (select 1 from public.ingredients where id = :'nase_surovina'));
select pg_temp.check('Xaver (firma B) NEVIDÍ naši cenu',
  not exists (select 1 from public.ingredient_purchase_prices where id = :'nase_cena'));
reset role;


\echo ''
\echo '== 2. Cizí firma nezapíše cenu k naší surovině =============='

set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000003', false);

-- Přímo pod naším tenant_id Xaver u nás purchasing.manage nemá vůbec —
-- první linie (RLS) ho zastaví dřív, než dojde na druhou.
select pg_temp.check('cena přímo pod naším tenant_id mu RLS nepustí (nemá u nás purchasing.manage)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ingredient_purchase_prices
       (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
     values (%L, %L, 1000, 1000, current_date)', :'tenant', :'nase_surovina'),
    '42501', ''));

-- Pod SVÝM tenant_id (B), ale s ingredient_id cizí (naší) suroviny.
-- RLS samotná (`has_access(tenant_id=B, purchasing.manage, null)`) by
-- tohle pustila — Xaver má purchasing.manage ve firmě B. Zastavit ho
-- musí DRUHÁ linie, spoušť trg_firma_cena_suroviny.
select pg_temp.check('cena s tenant_id=B, ale cizí ingredient_id (naše surovina), neprojde — "Surovina nepatří této firmě"',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ingredient_purchase_prices
       (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
     values (%L, %L, 1000, 1000, current_date)', :'tenant_b', :'nase_surovina'),
    '23514', 'Surovina nepatří této firmě'));

reset role;

select pg_temp.check('žádný z pokusů Xavera se do historie cen nezapsal',
  not exists (select 1 from public.ingredient_purchase_prices
               where ingredient_id = :'nase_surovina' and package_amount = 1000));


\echo ''
\echo '== 3. purchasing.read nestačí na zápis ceny ================='

set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000002', false);

select pg_temp.check('čtečka vidí naši surovinu (purchasing.read stačí na čtení)',
  exists (select 1 from public.ingredients where id = :'nase_surovina'));

select pg_temp.check('čtečka NEZAPÍŠE novou cenu (má jen purchasing.read, ne purchasing.manage)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ingredient_purchase_prices
       (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
     values (%L, %L, 2000, 500, current_date)', :'tenant', :'nase_surovina'),
    '42501', ''));

reset role;

select pg_temp.check('pokus čtečky se do historie cen opravdu nezapsal',
  not exists (select 1 from public.ingredient_purchase_prices
               where ingredient_id = :'nase_surovina' and package_amount = 2000));


\echo ''
\echo '== 4. Historie cen je immutabilní (UPDATE i DELETE) ========='

select set_config('krok70.nase_cena', :'nase_cena', false);

-- UPDATE: i skladník s purchasing.manage historii NEPŘEPÍŠE — brání
-- tomu pravidlo ingredient_purchase_prices_no_update, ne chybějící
-- právo. Měří se čtením před/po (pravidlo nehlásí chybu, jen tiše
-- neprovede nic — skill scenar, krok58 i krok4 u employee_rates).
set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000001', false);

do $$
declare
  v_id uuid := current_setting('krok70.nase_cena')::uuid;
  v_pred integer; v_po integer;
begin
  select package_price_haleru into v_pred from public.ingredient_purchase_prices where id = v_id;
  update public.ingredient_purchase_prices set package_price_haleru = 999999 where id = v_id;
  select package_price_haleru into v_po from public.ingredient_purchase_prices where id = v_id;
  if v_po is distinct from v_pred then
    raise exception 'SELHALO: cena šla přepsat i s purchasing.manage (% -> %)', v_pred, v_po;
  end if;
  raise notice '  OK    cena se nepřepíše ani s purchasing.manage (pravidlo no_update)';
end $$;

-- DELETE: `authenticated` na tabulce nemá grant DELETE vůbec (oprava
-- této fáze) — zastaví ho grant, dřív než se RLS stihne zeptat.
do $$
declare
  v_id uuid := current_setting('krok70.nase_cena')::uuid;
  v_ok boolean := false;
  v_pred int; v_po int;
begin
  select count(*) into v_pred from public.ingredient_purchase_prices where id = v_id;
  begin
    delete from public.ingredient_purchase_prices where id = v_id;
  exception when insufficient_privilege then v_ok := true;
  end;
  select count(*) into v_po from public.ingredient_purchase_prices where id = v_id;
  if v_po <> v_pred then
    raise exception 'SELHALO: cena šla smazat i s purchasing.manage (DELETE)';
  end if;
  if not v_ok then
    raise exception 'SELHALO: DELETE neskončil chybou insufficient_privilege';
  end if;
  raise notice '  OK    cena se nesmaže ani s purchasing.manage (chybí grant DELETE)';
end $$;

-- Pravidlo platí bezpodmínečně, i na superuživateli (stejně jako
-- employee_rates_no_update u mezd — krok4). Kdyby platilo jen díky
-- RLS/grantu u authenticated, přepsání zvenčí (migrace, servisní
-- klíč) by prošlo tiše.
reset role;
do $$
declare
  v_id uuid := current_setting('krok70.nase_cena')::uuid;
  v_pred integer; v_po integer;
begin
  select package_price_haleru into v_pred from public.ingredient_purchase_prices where id = v_id;
  update public.ingredient_purchase_prices set package_price_haleru = 1 where id = v_id;
  select package_price_haleru into v_po from public.ingredient_purchase_prices where id = v_id;
  if v_po is distinct from v_pred then
    raise exception 'SELHALO: pravidlo no_update neplatí ani na superuživatele (% -> %)', v_pred, v_po;
  end if;
  raise notice '  OK    pravidlo no_update platí bezpodmínečně, i na superuživateli';
end $$;


\echo ''
\echo '== 5. Kaskáda funguje dál, i bez práva mazat ceny přímo ====='
-- Zdánlivý rozpor s oddílem 4: DELETE na ingredient_purchase_prices
-- authenticated nemá, ale smazání SUROVINY (kam má přes ingredients_write
-- právo) musí kaskádově vzít i její historii cen s sebou — jinak by
-- zůstaly osiřelé řádky. FK cascade běží mimo granty volajícího
-- (stejně jako u employees → employee_rates), tohle to ověřuje přímo,
-- ne jen předpokládá.

set role authenticated;
select set_config('test.user_id', '70700000-0000-0000-0000-000000000001', false);

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok70 Na smazání', 'g')
returning id as na_smazani \gset

insert into public.ingredient_purchase_prices
  (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'na_smazani', 1000, 1000, current_date)
returning id as cena_na_smazani \gset

select pg_temp.check('příprava 5: cena existuje před smazáním suroviny',
  exists (select 1 from public.ingredient_purchase_prices where id = :'cena_na_smazani'));

select pg_temp.check('smazání suroviny (má na ni purchasing.manage) projde',
  pg_temp.projde(format('delete from public.ingredients where id = %L', :'na_smazani')));

reset role;

select pg_temp.check('kaskáda smazala i historii cen, přestože authenticated na ni DELETE přímo nemá',
  not exists (select 1 from public.ingredient_purchase_prices where id = :'cena_na_smazani')
  and not exists (select 1 from public.ingredients where id = :'na_smazani'));


\echo ''
\echo '== Úklid ====================================================='

reset role;
delete from public.ingredient_purchase_prices where ingredient_id = :'nase_surovina';
delete from public.ingredients where id = :'nase_surovina';
-- Smazání firmy B vezme kaskádou i její surovinu, cenu, zaměstnance
-- a členství.
delete from public.tenants where id = :'tenant_b';
delete from public.membership_branches where membership_id in (:'m_sklad', :'m_ctecka');
delete from public.memberships where id in (:'m_sklad', :'m_ctecka');
delete from public.employees where id in (:'sklad', :'ctecka');
delete from public.position_permissions where position_id in (:'z_sklad', :'z_ctecka');
delete from public.positions where id in (:'z_sklad', :'z_ctecka');

select pg_temp.check('úklid: po scénáři nezůstalo nic z kroku 70',
  not exists (select 1 from public.tenants where id = :'tenant_b')
  and not exists (select 1 from public.ingredients where name like 'Krok70 %')
  and not exists (select 1 from public.employees where full_name like '%Sedmdesát')
  and not exists (select 1 from public.positions where key like 'krok70_%'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 70 HOTOV =============================================='
