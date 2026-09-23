-- Scénář pro krok 49 — Checklisty 2.0: priorita „kritická" jen z checklistu.
--
-- Pokrývá migraci 20260923130000_checklisty_priorita_critical.sql.
--
-- Navazuje na etapa0_scenar.sql až krok48_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- 1. critical vznikne JEN z checklistu — obecné zadat_ukol ho srazí na
--    normal, a přímý zápis bez checklist_run_id odmítne CHECK (druhá
--    linie, nezávislá na funkcích).
-- 2. Adresát dostane NALÉHAVÉ upozornění, i když úkol vzniká INSERTEM
--    s 'high' a na 'critical' se povyšuje až UPDATEm. Tahle kontrola
--    vznikla, protože první verze migrace naléhavost tiše ztrácela
--    (trigger poslouchal jen INSERT).
-- 3. Po povýšení má adresát dál PRÁVĚ JEDNO nepřečtené upozornění.

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
  ('49490000-0000-0000-0000-000000000001', 'petra49@foodtab.cz',  '{"full_name":"Petra Devětačtyřicet"}'),
  ('49490000-0000-0000-0000-000000000002', 'standa49@foodtab.cz', '{"full_name":"Standa Devětačtyřicet"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '49490000-0000-0000-0000-000000000001', 'Petra Devětačtyřicet',  'hpp'),
  (:'tenant', :'perla', '49490000-0000-0000-0000-000000000002', 'Standa Devětačtyřicet', 'hpp');

select id as petra  from public.employees where user_id = '49490000-0000-0000-0000-000000000001' \gset
select id as standa from public.employees where user_id = '49490000-0000-0000-0000-000000000002' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '49490000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '49490000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.user_id in ('49490000-0000-0000-0000-000000000001', '49490000-0000-0000-0000-000000000002')
   and m.tenant_id = :'tenant';

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Zavírací — krok49', 'closing')
returning id as sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 1, 'Zamknout zahrádku — krok49')
returning id as polozka \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 40)
returning id as beh \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog: tři úrovně na tasks, dvě na task_templates ===='

select pg_temp.check('CHECK tasks_critical_jen_checklist existuje',
  exists (select 1 from pg_constraint
           where conname = 'tasks_critical_jen_checklist'
             and conrelid = 'public.tasks'::regclass));

select pg_temp.check('task_templates critical NEPŘIJME (opakované úkoly zůstávají na dvou úrovních)',
  pg_temp.spadne_hlaskou(format(
    $q$insert into public.task_templates (tenant_id, title, priority) values (%L, 'x', 'critical')$q$,
    :'tenant'),
    '23514', 'priority'));

select pg_temp.check('trigger upozornit_na_ukol poslouchá i UPDATE priority',
  exists (select 1 from information_schema.triggers
           where trigger_name = 'upozornit_na_ukol'
             and event_object_table = 'tasks'
             and event_manipulation = 'UPDATE'));


\echo ''
\echo '== 2. Obecné zadat_ukol critical srazí na normal ============='

select set_config('test.user_id', '49490000-0000-0000-0000-000000000001', false);
select public.zadat_ukol(:'tenant', :'perla', 'Ruční úkol — krok49', '', null,
  'critical', null, null, :'standa') as rucni \gset

select pg_temp.check('ruční úkol s critical skončil jako normal (ne high, ne critical)',
  (select priority from public.tasks where id = :'rucni') = 'normal');


\echo ''
\echo '== 3. Z checklistu: critical se uloží a upozornění je naléhavé ='

select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', :'polozka', 'Vyměnit zámek zahrádky', 'Zámek je poškozený.',
  null, 'critical', null, null, :'standa') as kriticky \gset

select pg_temp.check('úkol má critical A vazbu na běh i položku',
  (select priority = 'critical' and checklist_run_id = :'beh'
          and checklist_item_id = :'polozka' and zdroj = 'checklist'
     from public.tasks where id = :'kriticky'));

select pg_temp.check('adresát má PRÁVĚ JEDNO nepřečtené upozornění na ten úkol',
  (select count(*) from public.notifications
    where user_id = '49490000-0000-0000-0000-000000000002'
      and druh = 'ukol.pridelen' and zdroj_id = :'kriticky' and read_at is null) = 1);

select pg_temp.check('… a je NALÉHAVÉ (urgent), ne jen důležité',
  (select priorita from public.notifications
    where user_id = '49490000-0000-0000-0000-000000000002'
      and druh = 'ukol.pridelen' and zdroj_id = :'kriticky' and read_at is null) = 'urgent');

select pg_temp.check('zadavatelka sama sobě upozornění nezaložila',
  not exists (select 1 from public.notifications
               where user_id = '49490000-0000-0000-0000-000000000001'
                 and zdroj_id = :'kriticky'));

select pg_temp.check('priorita je v auditu vzniku úkolu',
  exists (select 1 from public.audit_log
           where action = 'ukol.z_checklistu' and entity_id = :'kriticky'::text
             and after->>'priorita' = 'critical'));


\echo ''
\echo '== 4. Z checklistu: high zůstane high, nesmysl je normal ====='

select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', :'polozka', 'Důležitý — krok49', '', null, 'high',
  null, null, :'standa') as dulezity \gset
select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', :'polozka', 'Nesmysl — krok49', '', null, 'nejvyssi!!',
  null, null, :'standa') as nesmysl \gset

select pg_temp.check('high z checklistu zůstane high a upozornění je important',
  (select priority from public.tasks where id = :'dulezity') = 'high'
  and (select priorita from public.notifications
        where user_id = '49490000-0000-0000-0000-000000000002'
          and zdroj_id = :'dulezity' and read_at is null) = 'important');

select pg_temp.check('neznámá priorita se nepřijme potichu jako vyšší — je normal',
  (select priority from public.tasks where id = :'nesmysl') = 'normal');

-- Celofiremní rozsah: has_access pro scope='tenant' pustí na JAKOUKOLI
-- pobočku, i cizí firmy. Filtr `r.tenant_id = p_tenant` v přepsané
-- zalozit_ukol_z_checklistu musí zůstat.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok49 Cizí s.r.o.', 'Krok49 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 49', 'krok49-cizi') returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí — krok49') returning id as cizi_sablona \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date) returning id as cizi_beh \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('49490000-0000-0000-0000-000000000009', 'majka49@foodtab.cz', '{"full_name":"Majka Devětačtyřicet"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '49490000-0000-0000-0000-000000000009', 'Majka Devětačtyřicet', 'hpp')
returning id as majka \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'majka', 'tasks.read', true), (:'tenant', :'majka', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '49490000-0000-0000-0000-000000000009', :'role_any', 'tenant', 'active');

select set_config('test.user_id', '49490000-0000-0000-0000-000000000009', false);
select pg_temp.check('celofiremní vedoucí NAŠÍ firmy z CIZÍHO běhu úkol nezaloží',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, null, 'Podvrh', '', null, 'critical', null, null, null)$q$,
    :'tenant', :'cizi_beh'),
    '42501', 'nemáte přístup')
  and not exists (select 1 from public.tasks where checklist_run_id = :'cizi_beh'));

select set_config('test.user_id', '', false);


\echo ''
\echo '== 5. Druhá linie: critical bez checklistu databáze odmítne ==='

select pg_temp.check('UPDATE ručního úkolu na critical spadne na CHECK',
  pg_temp.spadne_hlaskou(format(
    'update public.tasks set priority = %L where id = %L', 'critical', :'rucni'),
    '23514', 'tasks_critical_jen_checklist'));

select pg_temp.check('… a ruční úkol zůstal normal',
  (select priority from public.tasks where id = :'rucni') = 'normal');

select pg_temp.check('INSERT úkolu s critical bez checklist_run_id spadne',
  pg_temp.spadne_hlaskou(format(
    $q$insert into public.tasks (tenant_id, branch_id, title, priority) values (%L, %L, 'x', 'critical')$q$,
    :'tenant', :'perla'),
    '23514', 'tasks_critical_jen_checklist'));

\echo ''
\echo '== KROK 49 HOTOV ========================================'
