-- Scénář pro krok 52 — Checklisty 2.0: verzování šablon a audit.
--
-- Pokrývá 20260923140000_checklisty_verzovani.sql,
-- public.upravit_sablonu_checklistu z 20260923160000_checklisty_rpc.sql,
-- CHECK na schedule z 20260923120000_checklisty_schema_zaklad.sql
-- a 20260923180000_checklisty_audit.sql.
--
-- Navazuje na etapa0_scenar.sql až krok51_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Historický běh drží verzi, se kterou vznikl — úprava šablony ho
--   nepřepíše, a starou verzi nejde upravit ani přímo.
-- * Nová verze vzniká jen při změně OBSAHU položek, ne při přejmenování.
-- * Položka, která ze šablony zmizí, se vyřadí, ne smaže (na historii
--   visí on delete restrict).
-- * Audit se u položek a zápisů OPRAVDU zapíše — ne jen že spoušť
--   existuje. (app.audit_zmenu by na tabulkách bez tenant_id tiše skončila.)

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
select id as role_any from public.roles where tenant_id = :'tenant' limit 1 \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('52520000-0000-0000-0000-000000000001', 'petra52@foodtab.cz',  '{"full_name":"Petra Dvapadesát"}'),
  ('52520000-0000-0000-0000-000000000002', 'standa52@foodtab.cz', '{"full_name":"Standa Dvapadesát"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '52520000-0000-0000-0000-000000000001', 'Petra Dvapadesát',  'hpp'),
  (:'tenant', :'perla', '52520000-0000-0000-0000-000000000002', 'Standa Dvapadesát', 'hpp');

select id as petra  from public.employees where user_id = '52520000-0000-0000-0000-000000000001' \gset
select id as standa from public.employees where user_id = '52520000-0000-0000-0000-000000000002' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.read',   true),
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '52520000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '52520000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.user_id in ('52520000-0000-0000-0000-000000000001', '52520000-0000-0000-0000-000000000002')
   and m.tenant_id = :'tenant';

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Zavření kuchyně — krok52', 'closing')
returning id as sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 1, 'Vyčistit kávovar — krok52') returning id as p1 \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 2, 'Vynést odpad — krok52') returning id as p2 \gset

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok52 Cizí s.r.o.', 'Krok52 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.checklist_templates (tenant_id, name)
values (:'cizi_firma', 'Cizí šablona — krok52') returning id as cizi_sablona \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Rozvrh má konečně omezení v databázi ================'

select pg_temp.check('neznámý rozvrh databáze odmítne',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_templates set schedule = %L where id = %L', 'kazdou_druhou_stredu', :'sablona'),
    '23514', 'checklist_templates_schedule_check'));

update public.checklist_templates set schedule = 'every_shift' where id = :'sablona';
select pg_temp.check('every_shift je platná volba (připravené, jen bez automatiky)',
  (select schedule from public.checklist_templates where id = :'sablona') = 'every_shift');
update public.checklist_templates set schedule = 'closing' where id = :'sablona';

select pg_temp.check('den v týdnu mimo 0–6 odmítnut',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_templates set dny_v_tydnu = %L where id = %L', '{1,9}', :'sablona'),
    '23514', 'dny_v_tydnu'));


\echo ''
\echo '== 2. První uložení založí verzi 1 ========================'

select set_config('test.user_id', '52520000-0000-0000-0000-000000000001', false);
select public.upravit_sablonu_checklistu(
  :'tenant', :'sablona', 'Zavření kuchyně — krok52', null, 'closing', '{}', false, true,
  jsonb_build_array(
    jsonb_build_object('id', :'p1', 'position', 1, 'label', 'Vyčistit kávovar — krok52'),
    jsonb_build_object('id', :'p2', 'position', 2, 'label', 'Vynést odpad — krok52')));

select id as v1 from public.checklist_sablona_verze where template_id = :'sablona' and cislo = 1 \gset

select pg_temp.check('verze 1 existuje, má 2 položky a je aktuální',
  (select jsonb_array_length(polozky) = 2 and vytvoril = :'petra'
     from public.checklist_sablona_verze where id = :'v1')
  and (select aktualni_verze_id from public.checklist_templates where id = :'sablona') = :'v1');


\echo ''
\echo '== 3. Přejmenování šablony novou verzi nezaloží =========='

select public.upravit_sablonu_checklistu(
  :'tenant', :'sablona', 'Zavření kuchyně (večer) — krok52', null, 'closing', '{}', false, true,
  jsonb_build_array(
    jsonb_build_object('id', :'p1', 'position', 1, 'label', 'Vyčistit kávovar — krok52'),
    jsonb_build_object('id', :'p2', 'position', 2, 'label', 'Vynést odpad — krok52')));

select pg_temp.check('název se změnil, ale verze je pořád jen jedna',
  (select name from public.checklist_templates where id = :'sablona') = 'Zavření kuchyně (večer) — krok52'
  and (select count(*) from public.checklist_sablona_verze where template_id = :'sablona') = 1);


\echo ''
\echo '== 4. Běh drží svou verzi i po změně obsahu šablony ======='

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, sablona_verze_id)
values (:'tenant', :'perla', :'sablona', current_date - 70, :'v1')
returning id as beh \gset
select public.zapsat_polozku_checklistu(:'tenant', :'beh', :'p2', null, '', false, '', null);

-- Změna obsahu: p1 přejmenovaná, p2 VYPUŠTĚNÁ, nová p3.
select public.upravit_sablonu_checklistu(
  :'tenant', :'sablona', 'Zavření kuchyně (večer) — krok52', null, 'closing', '{}', true, true,
  jsonb_build_array(
    jsonb_build_object('id', :'p1', 'position', 1, 'label', 'Vyčistit a odvápnit kávovar — krok52'),
    jsonb_build_object('position', 2, 'label', 'Zkontrolovat lednice — krok52',
                       'section', 'Chlazení', 'instructions', 'Změř teplotu prostřední lednice.',
                       'requires_value', true, 'value_type', 'number', 'value_unit', '°C',
                       'min_value', '0', 'max_value', '8')));

select id as v2 from public.checklist_sablona_verze where template_id = :'sablona' and cislo = 2 \gset

select pg_temp.check('vznikla verze 2 a je aktuální',
  (select aktualni_verze_id from public.checklist_templates where id = :'sablona') = :'v2');

select pg_temp.check('historický běh ukazuje pořád na verzi 1',
  (select sablona_verze_id from public.checklist_runs where id = :'beh') = :'v1');

select pg_temp.check('verze 1 drží PŮVODNÍ znění (kávovar bez odvápnění, s odpadem)',
  (select polozky::text like '%Vyčistit kávovar — krok52%'
          and polozky::text like '%Vynést odpad — krok52%'
          and polozky::text not like '%odvápnit%'
     from public.checklist_sablona_verze where id = :'v1'));

select pg_temp.check('vypuštěná položka p2 NENÍ smazaná, jen vyřazená (historie na ni visí)',
  (select not active from public.checklist_items where id = :'p2')
  and exists (select 1 from public.checklist_entries where run_id = :'beh' and item_id = :'p2'));

select pg_temp.check('nová položka má sekci, instrukci a meze',
  exists (select 1 from public.checklist_items
           where template_id = :'sablona' and label = 'Zkontrolovat lednice — krok52'
             and section = 'Chlazení' and instructions = 'Změř teplotu prostřední lednice.'
             and min_value = 0 and max_value = 8 and active));

select pg_temp.check('šablona si pamatuje vyzaduje_potvrzeni = true',
  (select vyzaduje_potvrzeni from public.checklist_templates where id = :'sablona'));


\echo ''
\echo '== 4b. Nový běh dostane dnešní verzi, a ta se nemění ======'

select set_config('test.user_id', '', false);
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 71) returning id as beh_novy \gset

select pg_temp.check('běh založený bez verze dostal AKTUÁLNÍ verzi (2), ne starou',
  (select sablona_verze_id from public.checklist_runs where id = :'beh_novy') = :'v2');

select pg_temp.check('verzi existujícího běhu přepsat nejde',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_runs set sablona_verze_id = %L where id = %L', :'v2', :'beh'),
    '23514', 'Verze běhu se nemění'));

select pg_temp.check('… ani ji vynulovat (historie by se tiše vrátila na živé položky)',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_runs set sablona_verze_id = null where id = %L', :'beh'),
    '23514', 'Verze běhu se nemění')
  and (select sablona_verze_id from public.checklist_runs where id = :'beh') = :'v1');

insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'tenant', :'perla', 'Jiná — krok52') returning id as jina_sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'jina_sablona', 1, 'Cizí položka — krok52');
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'jina_sablona', current_date - 72) returning sablona_verze_id as jina_verze \gset

select pg_temp.check('běh nejde založit s verzí CIZÍ šablony',
  pg_temp.spadne_hlaskou(format(
    'insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, sablona_verze_id) '
    'values (%L, %L, %L, current_date - 73, %L)',
    :'tenant', :'perla', :'sablona', :'jina_verze'),
    '23514', 'Verze nepatří'));

select pg_temp.check('přihlášený verze jen čte — insert/update/delete grant nemá',
  has_table_privilege('authenticated', 'public.checklist_sablona_verze', 'SELECT')
  and not has_table_privilege('authenticated', 'public.checklist_sablona_verze', 'INSERT')
  and not has_table_privilege('authenticated', 'public.checklist_sablona_verze', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.checklist_sablona_verze', 'DELETE'));

select pg_temp.check('položka povinna a id jsou ve snímku verze (na nich stojí zápis i uzavření)',
  (select bool_and(p ? 'id' and p ? 'povinna')
     from public.checklist_sablona_verze v, jsonb_array_elements(v.polozky) p
    where v.id = :'v2'));


\echo ''
\echo '== 5. Verze je neměnná ===================================='

select set_config('test.user_id', '', false);
select pg_temp.check('přímý UPDATE staré verze spadne (oprava = nová verze)',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_sablona_verze set polozky = %L where id = %L', '[]', :'v1'),
    '23001', 'neupravuje'));

select pg_temp.check('… a verze 1 zůstala se dvěma položkami',
  (select jsonb_array_length(polozky) from public.checklist_sablona_verze where id = :'v1') = 2);


\echo ''
\echo '== 6. Kdo nesmí, neupraví ================================'

select set_config('test.user_id', '52520000-0000-0000-0000-000000000002', false);
select pg_temp.check('Standa (jen tasks.read) šablonu neupraví',
  pg_temp.spadne_hlaskou(format(
    $q$select public.upravit_sablonu_checklistu(%L, %L, 'Podvrh', null, 'closing', '{}', false, true, '[]'::jsonb)$q$,
    :'tenant', :'sablona'),
    '42501', 'Upravovat'));

select set_config('test.user_id', '52520000-0000-0000-0000-000000000001', false);
select pg_temp.check('šablona CIZÍ firmy se tváří jako neexistující',
  pg_temp.spadne_hlaskou(format(
    $q$select public.upravit_sablonu_checklistu(%L, %L, 'Podvrh', null, 'closing', '{}', false, true, '[]'::jsonb)$q$,
    :'tenant', :'cizi_sablona'),
    '23514', 'neexistuje'));

select pg_temp.check('prázdný název odmítnut',
  pg_temp.spadne_hlaskou(format(
    $q$select public.upravit_sablonu_checklistu(%L, %L, '   ', null, 'closing', '{}', false, true, '[]'::jsonb)$q$,
    :'tenant', :'sablona'),
    '23514', 'povinný'));

select pg_temp.check('… a po odmítnutých pokusech se šablona nezměnila',
  (select name from public.checklist_templates where id = :'sablona') = 'Zavření kuchyně (večer) — krok52');

-- Celofiremní rozsah: app.has_access pro scope='tenant' pustí na
-- JAKOUKOLI pobočku. Filtr `t.tenant_id = p_tenant` je jediná bariéra.
insert into auth.users (id, email, raw_user_meta_data) values
  ('52520000-0000-0000-0000-000000000009', 'majka52@foodtab.cz', '{"full_name":"Majka Dvapadesát"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '52520000-0000-0000-0000-000000000009', 'Majka Dvapadesát', 'hpp')
returning id as majka \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'majka', 'tasks.read', true), (:'tenant', :'majka', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '52520000-0000-0000-0000-000000000009', :'role_any', 'tenant', 'active');

select set_config('test.user_id', '52520000-0000-0000-0000-000000000009', false);
select pg_temp.check('celofiremní vedoucí NAŠÍ firmy cizí šablonu neupraví',
  pg_temp.spadne_hlaskou(format(
    $q$select public.upravit_sablonu_checklistu(%L, %L, 'Podvrh', null, 'closing', '{}', false, true, '[]'::jsonb)$q$,
    :'tenant', :'cizi_sablona'),
    '23514', 'neexistuje')
  and (select name from public.checklist_templates where id = :'cizi_sablona') = 'Cizí šablona — krok52');
select set_config('test.user_id', '', false);


\echo ''
\echo '== 7. Audit se OPRAVDU zapisuje (ne jen že spoušť existuje) =='

select pg_temp.check('vyřazení položky p2 je v auditu jako checklist_item.update s firmou a pobočkou',
  exists (select 1 from public.audit_log
           where action = 'checklist_item.update' and entity_id = :'p2'::text
             and tenant_id = :'tenant' and branch_id = :'perla'
             and after->>'active' = 'false'));

select pg_temp.check('zápis položky běhu je v auditu jako checklist_entry.insert',
  exists (select 1 from public.audit_log a
           join public.checklist_entries e on e.id::text = a.entity_id
          where a.action = 'checklist_entry.insert' and a.tenant_id = :'tenant'
            and e.run_id = :'beh' and e.item_id = :'p2'));

select pg_temp.check('vznik verze je v auditu',
  exists (select 1 from public.audit_log
           where action = 'checklist_sablona_verze.insert' and entity_id = :'v2'::text));

select pg_temp.check('úprava šablony je v auditu i jako akce RPC',
  exists (select 1 from public.audit_log
           where action = 'checklist.sablona_upravena' and entity_id = :'sablona'::text));

\echo ''
\echo '== KROK 52 HOTOV ========================================'
