-- Scénář pro krok 51 — Checklisty 2.0: uzavření a dvojí kontrola.
--
-- Pokrývá public.uzavrit_checklist a public.potvrdit_checklist z
-- 20260923160000_checklisty_rpc.sql.
--
-- Navazuje na etapa0_scenar.sql až krok50_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Stav po uzavření počítá databáze z položek (done vs. s výhradami),
--   ne ten, kdo zavírá.
-- * Dvojí kontrola: kdo běh dokončil, ho NESMÍ sám potvrdit; kdo má jen
--   tasks.read, nepotvrdí vůbec; rozdělaný běh nejde potvrdit.
-- * Upozornění: přiřazený se dozví, když mu běh zavřel jiný; vedoucí se
--   dozví o potvrzení / o výhradách — ale NIKDY ten, kdo právě zavřel;
--   běžné dokončení bez výhrad nikomu nechodí.

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

create or replace function pg_temp.upozorneni(p_user uuid, p_druh text, p_beh uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications
   where user_id = p_user and druh = p_druh and zdroj_id = p_beh and read_at is null
$$;

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
  ('51510000-0000-0000-0000-000000000001', 'petra51@foodtab.cz',  '{"full_name":"Petra Jednapadesát"}'),
  ('51510000-0000-0000-0000-000000000002', 'marek51@foodtab.cz',  '{"full_name":"Marek Jednapadesát"}'),
  ('51510000-0000-0000-0000-000000000003', 'standa51@foodtab.cz', '{"full_name":"Standa Jednapadesát"}'),
  ('51510000-0000-0000-0000-000000000004', 'zuzana51@foodtab.cz', '{"full_name":"Zuzana Jednapadesát"}');

-- Petra a Marek: tasks.read + tasks.manage na Perle (vedoucí). Standa:
-- jen tasks.read na Perle. Zuzana: obojí, ale na Baru.
--
-- tasks.manage NEZAHRNUJE tasks.read (app.ma_pravo_clovek práva
-- neskládá) — vedoucí, který checklist vyplňuje i zavírá, potřebuje
-- obě, stejně jako dnes kvůli RLS na checklist_entries.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '51510000-0000-0000-0000-000000000001', 'Petra Jednapadesát',  'hpp'),
  (:'tenant', :'perla', '51510000-0000-0000-0000-000000000002', 'Marek Jednapadesát',  'hpp'),
  (:'tenant', :'perla', '51510000-0000-0000-0000-000000000003', 'Standa Jednapadesát', 'hpp'),
  (:'tenant', :'bar',   '51510000-0000-0000-0000-000000000004', 'Zuzana Jednapadesát', 'hpp');

select id as petra  from public.employees where user_id = '51510000-0000-0000-0000-000000000001' \gset
select id as marek  from public.employees where user_id = '51510000-0000-0000-0000-000000000002' \gset
select id as standa from public.employees where user_id = '51510000-0000-0000-0000-000000000003' \gset
select id as zuzana from public.employees where user_id = '51510000-0000-0000-0000-000000000004' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.read',   true),
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'marek',  'tasks.read',   true),
  (:'tenant', :'marek',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true),
  (:'tenant', :'zuzana', 'tasks.read',   true),
  (:'tenant', :'zuzana', 'tasks.manage', true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '51510000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '51510000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active'),
  (:'tenant', '51510000-0000-0000-0000-000000000003', :'role_any', 'branch', 'active'),
  (:'tenant', '51510000-0000-0000-0000-000000000004', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, x.b
  from public.memberships m
  join (values
    ('51510000-0000-0000-0000-000000000001'::uuid, :'perla'::uuid),
    ('51510000-0000-0000-0000-000000000002'::uuid, :'perla'::uuid),
    ('51510000-0000-0000-0000-000000000003'::uuid, :'perla'::uuid),
    ('51510000-0000-0000-0000-000000000004'::uuid, :'bar'::uuid)
  ) x(u, b) on x.u = m.user_id
 where m.tenant_id = :'tenant';

-- Šablona S potvrzením a šablona BEZ potvrzení.
insert into public.checklist_templates (tenant_id, branch_id, name, schedule, vyzaduje_potvrzeni)
values (:'tenant', :'perla', 'Uzávěrka pokladny — krok51', 'closing', true)
returning id as s_potvrzeni \gset
insert into public.checklist_items (template_id, position, label)
values (:'s_potvrzeni', 1, 'Spočítat hotovost — krok51') returning id as p_a1 \gset

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Zavírací — krok51', 'closing')
returning id as s_bezne \gset
insert into public.checklist_items (template_id, position, label)
values (:'s_bezne', 1, 'Vynést odpad — krok51') returning id as p_b1 \gset
insert into public.checklist_items (template_id, position, label)
values (:'s_bezne', 2, 'Zamknout zahrádku — krok51') returning id as p_b2 \gset

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id)
values (:'tenant', :'perla', :'s_potvrzeni', current_date - 60, :'standa') returning id as beh_a \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id)
values (:'tenant', :'perla', :'s_bezne', current_date - 60, :'standa') returning id as beh_b \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id)
values (:'tenant', :'perla', :'s_bezne', current_date - 61, :'standa') returning id as beh_c \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog ============================================='

select pg_temp.check('uzavrit_checklist a potvrdit_checklist smí přihlášený, ne anon',
  has_function_privilege('authenticated', 'public.uzavrit_checklist(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.potvrdit_checklist(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.uzavrit_checklist(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_checklist(uuid, uuid)', 'execute'));


\echo ''
\echo '== 2. Vedoucí zavře Standův běh se šablonou „vyžaduje potvrzení" =='

select set_config('test.user_id', '51510000-0000-0000-0000-000000000001', false);
select public.zapsat_polozku_checklistu(:'tenant', :'beh_a', :'p_a1', null, '', false, '', null);
select public.uzavrit_checklist(:'tenant', :'beh_a') as vysledek_a \gset

select pg_temp.check('stav done, zavřela Petra (ze session), čas uzavření vyplněný',
  :'vysledek_a' = 'done'
  and (select status = 'done' and completed_by = :'petra' and finished_at is not null
         from public.checklist_runs where id = :'beh_a'));

select pg_temp.check('přiřazený Standa se dozvěděl, že mu běh zavřel někdo jiný',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000003', 'checklist.dokonceno', :'beh_a') = 1);

select pg_temp.check('druhý vedoucí (Marek) dostal žádost o potvrzení',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000002', 'checklist.vyzaduje_kontrolu', :'beh_a') = 1);

select pg_temp.check('… ale Petra, která zavřela, žádost NEdostala (čtyři oči)',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000001', 'checklist.vyzaduje_kontrolu', :'beh_a') = 0);

select pg_temp.check('vedoucí z JINÉ pobočky (Zuzana, Bar) žádost nedostala',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000004', 'checklist.vyzaduje_kontrolu', :'beh_a') = 0);

select pg_temp.check('druhé uzavření téhož běhu spadne',
  pg_temp.spadne_hlaskou(format('select public.uzavrit_checklist(%L, %L)', :'tenant', :'beh_a'),
    '23514', 'už je uzavřený'));


\echo ''
\echo '== 3. Dvojí kontrola ======================================'

select pg_temp.check('Petra (dokončila) svůj běh sama nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_checklist(%L, %L)', :'tenant', :'beh_a'),
    '42501', 'nemůže sám potvrdit'));

select pg_temp.check('… a potvrzení zůstalo prázdné',
  (select potvrdil_kym is null and potvrzeno_kdy is null
     from public.checklist_runs where id = :'beh_a'));

select set_config('test.user_id', '51510000-0000-0000-0000-000000000003', false);
select pg_temp.check('Standa (jen tasks.read) nepotvrdí vůbec',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_checklist(%L, %L)', :'tenant', :'beh_a'),
    '42501', 'Potvrzovat'));

select set_config('test.user_id', '51510000-0000-0000-0000-000000000004', false);
select pg_temp.check('Zuzana (tasks.manage na JINÉ pobočce) nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_checklist(%L, %L)', :'tenant', :'beh_a'),
    '42501', 'Potvrzovat'));

select set_config('test.user_id', '51510000-0000-0000-0000-000000000002', false);
select pg_temp.check('rozdělaný běh (C) potvrdit nejde',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_checklist(%L, %L)', :'tenant', :'beh_c'),
    '23514', 'Nedokončený'));

select public.potvrdit_checklist(:'tenant', :'beh_a');
select pg_temp.check('Marek (druhý vedoucí) potvrdí: potvrdil_kym = Marek, čas vyplněný',
  (select potvrdil_kym = :'marek' and potvrzeno_kdy is not null
     from public.checklist_runs where id = :'beh_a'));

select pg_temp.check('potvrzení je v auditu',
  exists (select 1 from public.audit_log
           where action = 'checklist.potvrzen' and entity_id = :'beh_a'::text));


\echo ''
\echo '== 4. Standa zavře svůj běh s nesplnitelnou položkou ======'

select set_config('test.user_id', '51510000-0000-0000-0000-000000000003', false);
select public.zapsat_polozku_checklistu(:'tenant', :'beh_b', :'p_b1', null, '', false, '', null);
select public.zapsat_polozku_checklistu(:'tenant', :'beh_b', :'p_b2', null, '',
  true, 'Zámek je poškozený.', null);
select public.uzavrit_checklist(:'tenant', :'beh_b') as vysledek_b \gset

select pg_temp.check('výsledek je completed_with_issues, ne done',
  :'vysledek_b' = 'completed_with_issues'
  and (select status from public.checklist_runs where id = :'beh_b') = 'completed_with_issues');

select pg_temp.check('Standa (zavřel sám sobě) upozornění o vlastním uzavření nedostal',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000003', 'checklist.dokonceno', :'beh_b') = 0);

select pg_temp.check('vedoucí se o výhradách dozvěděli, i když šablona potvrzení nevyžaduje',
  pg_temp.upozorneni('51510000-0000-0000-0000-000000000001', 'checklist.dokonceno', :'beh_b') = 1
  and pg_temp.upozorneni('51510000-0000-0000-0000-000000000002', 'checklist.dokonceno', :'beh_b') = 1);

select pg_temp.check('… jako DŮLEŽITÉ',
  (select priorita from public.notifications
    where user_id = '51510000-0000-0000-0000-000000000002'
      and druh = 'checklist.dokonceno' and zdroj_id = :'beh_b' and read_at is null) = 'important');


\echo ''
\echo '== 5. Běžné dokončení bez výhrad nikomu nechodí ==========='

select public.zapsat_polozku_checklistu(:'tenant', :'beh_c', :'p_b1', null, '', false, '', null);
select public.zapsat_polozku_checklistu(:'tenant', :'beh_c', :'p_b2', null, '', false, '', null);
select public.uzavrit_checklist(:'tenant', :'beh_c');

select pg_temp.check('žádné checklist.dokonceno ani vyzaduje_kontrolu k běhu C',
  not exists (select 1 from public.notifications
               where zdroj_id = :'beh_c'
                 and druh in ('checklist.dokonceno', 'checklist.vyzaduje_kontrolu')));


\echo ''
\echo '== 5b. Povinné položky blokují uzavření, nepovinné ne ====='

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Povinné — krok51', 'closing') returning id as s_povinne \gset
insert into public.checklist_items (template_id, position, label)
values (:'s_povinne', 1, 'Zamknout zahrádku — povinná — krok51') returning id as p_pov \gset
insert into public.checklist_items (template_id, position, label, povinna)
values (:'s_povinne', 2, 'Zalít květiny — nepovinná — krok51', false) returning id as p_nepov \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'s_povinne', current_date - 63) returning id as beh_e \gset

select set_config('test.user_id', '51510000-0000-0000-0000-000000000003', false);
select pg_temp.check('s nevyřešenou povinnou položkou se běh neuzavře',
  pg_temp.spadne_hlaskou(format('select public.uzavrit_checklist(%L, %L)', :'tenant', :'beh_e'),
    '23514', 'povinné položky')
  and (select status from public.checklist_runs where id = :'beh_e') = 'open');

select public.zapsat_polozku_checklistu(:'tenant', :'beh_e', :'p_pov', null, '', false, '', null);
select public.uzavrit_checklist(:'tenant', :'beh_e') as vysledek_e \gset
select pg_temp.check('povinná splněná, nepovinná nevyřešená → uzavře se jako done',
  :'vysledek_e' = 'done');
select set_config('test.user_id', '', false);


\echo ''
\echo '== 6. Uzavřít cizí pobočku nejde ========================='

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'s_bezne', current_date - 62) returning id as beh_d \gset

select set_config('test.user_id', '51510000-0000-0000-0000-000000000004', false);
select pg_temp.check('Zuzana (Bar) běh na Perle nezavře',
  pg_temp.spadne_hlaskou(format('select public.uzavrit_checklist(%L, %L)', :'tenant', :'beh_d'),
    '42501', 'nemáte přístup'));
select pg_temp.check('… a běh zůstal otevřený',
  (select status from public.checklist_runs where id = :'beh_d') = 'open');


\echo ''
\echo '== 7. Celofiremní vedoucí na cizí firmu nedosáhne ========'

-- app.has_access pro scope='tenant' vrací true pro JAKOUKOLI pobočku,
-- i cizí firmy. Jediná bariéra je filtr `r.tenant_id = p_tenant` ve
-- funkci — uživatel vázaný na pobočku by jeho chybění neodhalil.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok51 Cizí s.r.o.', 'Krok51 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 51', 'krok51-cizi') returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí — krok51') returning id as cizi_sablona \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date) returning id as cizi_otevreny \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, status)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date - 1, 'done') returning id as cizi_hotovy \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('51510000-0000-0000-0000-000000000009', 'majka51@foodtab.cz', '{"full_name":"Majka Jednapadesát"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '51510000-0000-0000-0000-000000000009', 'Majka Jednapadesát', 'hpp')
returning id as majka \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'majka', 'tasks.read', true), (:'tenant', :'majka', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '51510000-0000-0000-0000-000000000009', :'role_any', 'tenant', 'active');

select set_config('test.user_id', '51510000-0000-0000-0000-000000000009', false);
select pg_temp.check('cizí otevřený běh nezavře (p_tenant = naše firma)',
  pg_temp.spadne_hlaskou(format('select public.uzavrit_checklist(%L, %L)', :'tenant', :'cizi_otevreny'),
    '42501', 'nemáte přístup')
  and (select status from public.checklist_runs where id = :'cizi_otevreny') = 'open');
select pg_temp.check('cizí hotový běh nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_checklist(%L, %L)', :'tenant', :'cizi_hotovy'),
    '42501', 'Potvrzovat')
  and (select potvrdil_kym is null from public.checklist_runs where id = :'cizi_hotovy'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 51 HOTOV ========================================'
