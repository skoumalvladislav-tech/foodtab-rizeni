-- Scénář pro krok 50 — Checklisty 2.0: zápis položky přes RPC.
--
-- Pokrývá public.zapsat_polozku_checklistu z
-- 20260923160000_checklisty_rpc.sql a sloupce/CHECK z
-- 20260923120000_checklisty_schema_zaklad.sql (nelze_splnit, verze).
--
-- Navazuje na etapa0_scenar.sql až krok49_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Meze a povinnost hodnoty se čtou z databáze (dřív TS v akce.ts).
-- * Souběh: zastaralá verze vrátí serialization_failure (40001) a řádek
--   ZŮSTANE beze změny — ne tiché přepsání „vyhrává poslední".
-- * „Nelze splnit" je jiný stav než „nezaškrtnuto" a s „splněno" se
--   vylučuje i na úrovni tabulky (CHECK), ne jen ve funkci.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select id as role_any from public.roles where tenant_id = :'tenant' limit 1 \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('50500000-0000-0000-0000-000000000001', 'standa50@foodtab.cz', '{"full_name":"Standa Padesát"}'),
  ('50500000-0000-0000-0000-000000000002', 'zuzana50@foodtab.cz', '{"full_name":"Zuzana Padesát"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '50500000-0000-0000-0000-000000000001', 'Standa Padesát', 'hpp'),
  (:'tenant', :'bar',   '50500000-0000-0000-0000-000000000002', 'Zuzana Padesát', 'hpp');

select id as standa from public.employees where user_id = '50500000-0000-0000-0000-000000000001' \gset
select id as zuzana from public.employees where user_id = '50500000-0000-0000-0000-000000000002' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'standa', 'tasks.read', true),
  (:'tenant', :'zuzana', 'tasks.read', true);

-- Vedoucí na Perle: má dostat upozornění, když Standa nahlásí „nelze splnit".
insert into auth.users (id, email, raw_user_meta_data) values
  ('50500000-0000-0000-0000-000000000005', 'vedouci50@foodtab.cz', '{"full_name":"Vedoucí Padesát"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '50500000-0000-0000-0000-000000000005', 'Vedoucí Padesát', 'hpp')
returning id as vedouci \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'vedouci', 'tasks.read', true), (:'tenant', :'vedouci', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '50500000-0000-0000-0000-000000000005', :'role_any', 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.user_id = '50500000-0000-0000-0000-000000000005' and m.tenant_id = :'tenant';

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '50500000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '50500000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, x.b
  from public.memberships m
  join (values
    ('50500000-0000-0000-0000-000000000001'::uuid, :'perla'::uuid),
    ('50500000-0000-0000-0000-000000000002'::uuid, :'bar'::uuid)
  ) x(u, b) on x.u = m.user_id
 where m.tenant_id = :'tenant';

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'HACCP — krok50', 'haccp')
returning id as sablona \gset

insert into public.checklist_items (template_id, position, label)
values (:'sablona', 1, 'Vyčistit kávovar — krok50') returning id as p_check \gset
insert into public.checklist_items (template_id, position, label, requires_value, value_type, value_unit, min_value, max_value)
values (:'sablona', 2, 'Teplota lednice — krok50', true, 'number', '°C', 0, 8) returning id as p_teplota \gset
insert into public.checklist_items (template_id, position, label, requires_value, value_type)
values (:'sablona', 3, 'Stav skladu — krok50', true, 'text') returning id as p_text \gset
insert into public.checklist_items (template_id, position, label, requires_value, value_type)
values (:'sablona', 4, 'Foto plochy — krok50', true, 'photo') returning id as p_foto \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 5, 'Zamknout zahrádku — krok50') returning id as p_zahradka \gset

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 50)
returning id as beh \gset

insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'tenant', :'perla', 'Jiná — krok50') returning id as jina_sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'jina_sablona', 1, 'Cizí položka — krok50') returning id as jina_polozka \gset

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok50 Cizí s.r.o.', 'Krok50 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 50', 'krok50-cizi') returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí — krok50') returning id as cizi_sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'cizi_sablona', 1, 'Cizí 50') returning id as cizi_polozka \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date) returning id as cizi_beh \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog ============================================='

select pg_temp.check('RPC zapsat_polozku_checklistu smí přihlášený, ne anon',
  has_function_privilege('authenticated',
    'public.zapsat_polozku_checklistu(uuid, uuid, uuid, text, text, boolean, text, integer, boolean)', 'execute')
  and not has_function_privilege('anon',
    'public.zapsat_polozku_checklistu(uuid, uuid, uuid, text, text, boolean, text, integer, boolean)', 'execute'));

select pg_temp.check('běh dostal při vzniku verzi šablony (spoušť, ne volající)',
  (select sablona_verze_id is not null from public.checklist_runs where id = :'beh'));

select pg_temp.check('CHECK checklist_entries_stav_check existuje',
  exists (select 1 from pg_constraint
           where conname = 'checklist_entries_stav_check'
             and conrelid = 'public.checklist_entries'::regclass));


\echo ''
\echo '== 2. Obyčejné odškrtnutí + poznámka ======================='

select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);

select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_check', null,
  'Kávovar byl hodně zanesený.', false, '', null) as v1 \gset

select pg_temp.check('první zápis: checked, verze 1, kdo = Standa ze session, poznámka uložena',
  :'v1'::int = 1
  and (select checked and verze = 1 and employee_id = :'standa'
              and note = 'Kávovar byl hodně zanesený.' and not nelze_splnit
         from public.checklist_entries where run_id = :'beh' and item_id = :'p_check'));


\echo ''
\echo '== 3. Souběh: zastaralá verze se NEPŘEPÍŠE ================'

select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_check', null,
  'Oprava poznámky od Standy.', false, '', 1) as v2 \gset

select pg_temp.check('zápis se SPRÁVNOU verzí projde a verze se zvýší na 2',
  :'v2'::int = 2
  and (select note from public.checklist_entries
        where run_id = :'beh' and item_id = :'p_check') = 'Oprava poznámky od Standy.');

select pg_temp.check('druhý zápis se ZASTARALOU verzí (1) spadne na serialization_failure',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, 'Přepis od kolegy.', false, '', 1)$q$,
    :'tenant', :'beh', :'p_check'),
    '40001', 'mezitím'));

select pg_temp.check('… a řádek zůstal přesně, jak byl (poznámka i verze 2)',
  (select note = 'Oprava poznámky od Standy.' and verze = 2
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_check'));


\echo ''
\echo '== 4. Číselná položka — meze z databáze =================='

select pg_temp.check('prázdná povinná hodnota spadne',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, '  ', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_teplota'),
    '23514', 'povinná'));

select pg_temp.check('ne-číslo spadne čitelnou hláškou, ne chybou serveru',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, 'hodně', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_teplota'),
    '23514', 'platné číslo'));

select pg_temp.check('11 °C je mimo meze 0–8 a spadne',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, '11', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_teplota'),
    '23514', 'mimo povolené meze'));

select pg_temp.check('-1 °C je pod dolní mezí a spadne (obě meze, ne jen horní)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, '-1', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_teplota'),
    '23514', 'mimo povolené meze'));

select pg_temp.check('… a mimo meze se nic neuložilo',
  not exists (select 1 from public.checklist_entries
               where run_id = :'beh' and item_id = :'p_teplota'));

select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_teplota', '3,5', '', false, '', null);
select pg_temp.check('česká desetinná čárka 3,5 se uloží jako 3.5',
  (select value_number = 3.5 and checked
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_teplota'));


\echo ''
\echo '== 5. Textová a fotková položka =========================='

select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_text', 'Plný', '', false, '', null);
select pg_temp.check('textová hodnota se uloží do value_text',
  (select value_text = 'Plný' and value_number is null
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_text'));

select pg_temp.check('fotková položka BEZ fotky se odškrtnout nedá',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, 'x', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_foto'),
    '23514', 'fotku'));

insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh' || '/' || :'p_foto' || '/f.jpg');
select public.pripojit_checklist_fotku(:'beh', :'p_foto',
  :'tenant' || '/' || :'beh' || '/' || :'p_foto' || '/f.jpg', 'f.jpg', 'image/jpeg', 100);
select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_foto', 'x', '', false, '', null);

select pg_temp.check('… s připojenou fotkou už projde',
  (select checked from public.checklist_entries where run_id = :'beh' and item_id = :'p_foto'));


\echo ''
\echo '== 6. Nelze splnit — jiný stav než nezaškrtnuto ==========='

select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_zahradka', null, '',
  true, 'Zámek je poškozený.', null);

select pg_temp.check('položka je nelze_splnit s důvodem, NENÍ checked',
  (select nelze_splnit and not checked and nelze_splnit_duvod = 'Zámek je poškozený.'
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_zahradka'));

select pg_temp.check('vedoucí pobočky dostal upozornění checklist.problem hned (ne až při uzavření)',
  (select count(*) from public.notifications
    where user_id = '50500000-0000-0000-0000-000000000005' and druh = 'checklist.problem'
      and zdroj_id = :'beh' and read_at is null) = 1);

select pg_temp.check('… v upozornění je název položky, ale NE text důvodu (psal ho člověk)',
  (select telo->>'polozka_nazev' = 'Zamknout zahrádku — krok50'
          and telo::text not like '%poškozený%'
     from public.notifications
    where user_id = '50500000-0000-0000-0000-000000000005' and druh = 'checklist.problem'
      and zdroj_id = :'beh' and read_at is null));

select pg_temp.check('zapisující (Standa) si upozornění o vlastním problému nezaložil',
  not exists (select 1 from public.notifications
               where user_id = '50500000-0000-0000-0000-000000000001' and druh = 'checklist.problem'));

-- Opakovaný zápis „nelze splnit" (jen oprava důvodu) už nic nehlásí —
-- upozorňuje se na PŘECHOD do stavu, ne na každý zápis.
update public.notifications set read_at = now()
 where user_id = '50500000-0000-0000-0000-000000000005' and druh = 'checklist.problem';
select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_zahradka', null, '',
  true, 'Zámek je poškozený, objednán nový.', null);
select pg_temp.check('oprava důvodu u už nahlášené položky nové upozornění nevyrobí',
  not exists (select 1 from public.notifications
               where user_id = '50500000-0000-0000-0000-000000000005' and druh = 'checklist.problem'
                 and read_at is null));

select pg_temp.check('„nelze splnit" BEZ důvodu se nepřijme (jinak by to bylo jen tiché nezaškrtnutí)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', true, '   ', null)$q$,
    :'tenant', :'beh', :'p_check'),
    '23514', 'důvod'));

select set_config('test.user_id', '', false);

select pg_temp.check('přímý UPDATE na checked=true u nesplnitelné spadne na CHECK tabulky',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_entries set checked = true where run_id = %L and item_id = %L',
    :'beh', :'p_zahradka'),
    '23514', 'checklist_entries_stav_check'));


\echo ''
\echo '== 6b. Vrátit položku (reopen) ==========================='

select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);
select verze as verze_pred from public.checklist_entries
 where run_id = :'beh' and item_id = :'p_check' \gset
select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_check', null,
  'Kávovar se musí vyčistit znovu.', false, '', :'verze_pred'::int, true);

select pg_temp.check('vrácená položka není checked ani nelze_splnit, poznámka zůstala, verze +1',
  (select not checked and not nelze_splnit and note = 'Kávovar se musí vyčistit znovu.'
          and verze = :'verze_pred'::int + 1
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_check'));

select pg_temp.check('řádek se nesmazal (DELETE nesmí být cestou — realtime ho nefiltruje)',
  exists (select 1 from public.checklist_entries where run_id = :'beh' and item_id = :'p_check'));

-- Rychlé odškrtnutí z řádku seznamu poznámku neposílá (NULL) — nesmí ji smazat.
select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p_check', null, null, false, '', null);
select pg_temp.check('odškrtnutí bez poznámky (NULL) poznámku ponechá',
  (select checked and note = 'Kávovar se musí vyčistit znovu.'
     from public.checklist_entries where run_id = :'beh' and item_id = :'p_check'));


\echo ''
\echo '== 6c. Položka mimo verzi běhu se do něj nezapíše ========='

-- Meze z VERZE běhu: šablona je po spuštění uvolněná na 0–20, ale běh
-- drží 0–8. (Tahle kontrola je PŘED pozdě přidanou položkou schválně:
-- mutace „čti živé položky" ji má shodit tady, ne až o řádek níž.)
select set_config('test.user_id', '', false);
update public.checklist_items set max_value = 20 where id = :'p_teplota';
select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);
select pg_temp.check('meze se berou z verze běhu, ne z dnešní šablony (15 °C pořád neprojde)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, '15', '', false, '', null)$q$,
    :'tenant', :'beh', :'p_teplota'),
    '23514', 'mimo povolené meze'));

-- Položka přidaná do šablony AŽ PO spuštění běhu do verze běhu nepatří.
select set_config('test.user_id', '', false);
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 6, 'Pozdě přidaná — krok50') returning id as p_pozde \gset

select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);
select pg_temp.check('položku přidanou po spuštění do běhu zapsat nejde',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'beh', :'p_pozde'),
    '23514', 'nepatří'));
select set_config('test.user_id', '', false);


\echo ''
\echo '== 7. Hranice přístupu ===================================='

select set_config('test.user_id', '50500000-0000-0000-0000-000000000002', false);
select pg_temp.check('tasks.read na JINÉ pobočce (Bar) položku na Perle nezapíše',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'beh', :'p_check'),
    '42501', 'nemáte přístup'));

select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);
select pg_temp.check('SKUTEČNÝ běh cizí firmy: odepřeno',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'cizi_beh', :'cizi_polozka'),
    '42501', 'nemáte přístup'));

select pg_temp.check('položka z jiné šablony k běhu nepatří',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'beh', :'jina_polozka'),
    '23514', 'nepatří'));

-- CELOFIREMNÍ ROZSAH. app.has_access pro scope='tenant' vrací true pro
-- JAKOUKOLI pobočku — i cizí firmy. Filtr `r.tenant_id = p_tenant` je
-- proto jediná bariéra; uživatel vázaný na pobočku (Standa výš) by jeho
-- chybění neodhalil, protože ho zastaví už rozsah pobočky.
insert into auth.users (id, email, raw_user_meta_data) values
  ('50500000-0000-0000-0000-000000000009', 'majka50@foodtab.cz', '{"full_name":"Majka Padesát"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '50500000-0000-0000-0000-000000000009', 'Majka Padesát', 'hpp')
returning id as majka \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'majka', 'tasks.read', true), (:'tenant', :'majka', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '50500000-0000-0000-0000-000000000009', :'role_any', 'tenant', 'active');

select set_config('test.user_id', '50500000-0000-0000-0000-000000000009', false);
select pg_temp.check('celofiremní vedoucí NAŠÍ firmy nezapíše do běhu CIZÍ firmy (p_tenant = naše)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'cizi_beh', :'cizi_polozka'),
    '42501', 'nemáte přístup'));
select pg_temp.check('… a v cizím běhu žádný zápis nevznikl',
  not exists (select 1 from public.checklist_entries where run_id = :'cizi_beh'));


\echo ''
\echo '== 8. Uzavřený běh je historie ============================'

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, status)
values (:'tenant', :'perla', :'sablona', current_date - 51, 'done') returning id as hotovy \gset

select set_config('test.user_id', '50500000-0000-0000-0000-000000000001', false);
select pg_temp.check('do uzavřeného běhu se položka nezapíše',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zapsat_polozku_checklistu(%L, %L, %L, null, '', false, '', null)$q$,
    :'tenant', :'hotovy', :'p_check'),
    '23514', 'Uzavřený'));
select pg_temp.check('… a nic v něm nevzniklo',
  not exists (select 1 from public.checklist_entries where run_id = :'hotovy'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 50 HOTOV ========================================'
