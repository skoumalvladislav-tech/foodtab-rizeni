-- Scénář pro krok 47 — Checklisty 2.0: lehká odpovědnost na běhu.
--
-- Pokrývá migraci 20260923100000_checklist_odpovednost.sql.
--
-- Navazuje na etapa0_scenar.sql až krok46_scenar.sql.
--
-- Netestuje znovu základní RLS na checklist_runs (kdo smí číst/psát) —
-- to je hotovo jinde a touhle migrací se nemění. Testuje jen to nové:
-- assigned_employee_id/due_at existují, jdou zapsat, a hlavně — cizí
-- zaměstnanec (jiná firma) se zapsat NEDÁ (trg_checklist_run_prirazeny).

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('47470000-0000-0000-0000-00000000000a', 'standa47@foodtab.cz', '{"full_name":"Standa Sedmačtyřicet"}'),
  ('47470000-0000-0000-0000-00000000000b', 'jana47@foodtab.cz',   '{"full_name":"Jana Sedmačtyřicet"}');

select id as role_any from public.roles where tenant_id = :'tenant' limit 1 \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '47470000-0000-0000-0000-00000000000a', 'Standa Sedmačtyřicet', 'hpp'),
  (:'tenant', :'perla', '47470000-0000-0000-0000-00000000000b', 'Jana Sedmačtyřicet',   'hpp');

select id as standa from public.employees where user_id = '47470000-0000-0000-0000-00000000000a' \gset
select id as jana   from public.employees where user_id = '47470000-0000-0000-0000-00000000000b' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '47470000-0000-0000-0000-00000000000a', :'role_any', 'branch', 'active'),
  (:'tenant', '47470000-0000-0000-0000-00000000000b', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.user_id in ('47470000-0000-0000-0000-00000000000a', '47470000-0000-0000-0000-00000000000b')
   and m.tenant_id = :'tenant';

-- Cizí firma, s vlastním zaměstnancem — pro test "cizí přiřazený nejde".
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok47 Cizí s.r.o.', 'Krok47 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('47470000-0000-0000-0000-00000000000c', 'cizi47@jinafirma.cz', '{"full_name":"Cizí Sedmačtyřicet"}');
insert into public.employees (tenant_id, user_id, full_name, employment_type)
values (:'cizi_firma', '47470000-0000-0000-0000-00000000000c', 'Cizí Sedmačtyřicet', 'hpp')
returning id as cizi_zamestnanec \gset

-- Šablona a běh, na kterých se bude testovat.
insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Krok47 test checklist', 'closing')
returning id as sablona \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog: sloupce a trigger existují ================='

select pg_temp.check('checklist_runs.assigned_employee_id existuje',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'checklist_runs'
             and column_name = 'assigned_employee_id'));
select pg_temp.check('checklist_runs.due_at existuje',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'checklist_runs'
             and column_name = 'due_at' and data_type = 'timestamp with time zone'));
select pg_temp.check('checklist_runs.completed_by existuje',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'checklist_runs'
             and column_name = 'completed_by'));
select pg_temp.check('trigger trg_checklist_run_prirazeny existuje',
  exists (select 1 from pg_trigger where tgname = 'trg_checklist_run_prirazeny'
           and not tgisinternal));


\echo ''
\echo '== 2. Bez přiřazení je platný stav (nic se nemění) ========='

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 10)
returning id as beh_bez_prirazeni \gset

select pg_temp.check('běh bez přiřazení a bez termínu se založí bez chyby',
  (select assigned_employee_id is null and due_at is null
     from public.checklist_runs where id = :'beh_bez_prirazeni'));


\echo ''
\echo '== 3. Přiřazení vlastnímu zaměstnanci projde ================'

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id, due_at)
values (:'tenant', :'perla', :'sablona', current_date - 9, :'standa', now() + interval '2 hours')
returning id as beh_standa \gset

select pg_temp.check('přiřazení Standovi (stejná firma) prošlo',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') = :'standa');
select pg_temp.check('due_at se uložilo',
  (select due_at is not null from public.checklist_runs where id = :'beh_standa'));

update public.checklist_runs set assigned_employee_id = :'jana' where id = :'beh_standa';
select pg_temp.check('přeřazení na Janu (UPDATE, taky stejná firma) prošlo',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') = :'jana');

update public.checklist_runs set assigned_employee_id = null where id = :'beh_standa';
select pg_temp.check('zrušení přiřazení (na NULL) prošlo',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') is null);


\echo ''
\echo '== 4. Cizí zaměstnanec (jiná firma) se přiřadit NEDÁ ========'

select pg_temp.check('INSERT s cizím zaměstnancem spadne na insufficient_privilege',
  pg_temp.spadne_hlaskou(
    format(
      'insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id) '
      'values (%L, %L, %L, current_date - 8, %L)',
      :'tenant', :'perla', :'sablona', :'cizi_zamestnanec'
    ),
    '42501', 'nepatří k vaší firmě'
  ));

select pg_temp.check('a v tabulce po tom pokusu nic nepřibylo',
  not exists (select 1 from public.checklist_runs
               where template_id = :'sablona' and business_date = current_date - 8));

select pg_temp.check('UPDATE na cizího zaměstnance spadne stejně (druhá linie funguje i při přeřazení)',
  pg_temp.spadne_hlaskou(
    format('update public.checklist_runs set assigned_employee_id = %L where id = %L',
      :'cizi_zamestnanec', :'beh_standa'),
    '42501', 'nepatří k vaší firmě'
  ));

select pg_temp.check('… a přiřazení zůstalo beze změny (pořád NULL, ne cizí id)',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') is null);


\echo ''
\echo '== 5. completed_by — stejná kontrola, nezávislá na assigned_employee_id =='

update public.checklist_runs set completed_by = :'jana' where id = :'beh_standa';
select pg_temp.check('completed_by pro vlastního zaměstnance prošlo',
  (select completed_by from public.checklist_runs where id = :'beh_standa') = :'jana');

select pg_temp.check('completed_by s cizím zaměstnancem spadne stejně jako assigned_employee_id',
  pg_temp.spadne_hlaskou(
    format('update public.checklist_runs set completed_by = %L where id = %L',
      :'cizi_zamestnanec', :'beh_standa'),
    '42501', 'nepatří k vaší firmě'
  ));
select pg_temp.check('… a completed_by zůstalo beze změny (pořád Jana, ne cizí id)',
  (select completed_by from public.checklist_runs where id = :'beh_standa') = :'jana');

-- assigned_employee_id je tady NULL (zrušeno v oddílu 3) — nastavíme ho
-- znovu, ať jde doopravdy vidět, že zápis JEN assigned_employee_id
-- nesáhne na už uložené completed_by (a naopak).
update public.checklist_runs set assigned_employee_id = :'standa' where id = :'beh_standa';
select pg_temp.check('nastavení JEN assigned_employee_id nesáhne na kontrolu completed_by (a naopak)',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') = :'standa'
  and (select completed_by from public.checklist_runs where id = :'beh_standa') = :'jana');


\echo ''
\echo '== 6. Nezměněná hodnota se neověřuje znovu ==================='

-- UPDATE, který assigned_employee_id vůbec nemění (jiný sloupec), nesmí
-- spadnout jen proto, že by se stará hodnota přezkoušela znovu —
-- accepted-a-uložená hodnota je vždycky platná, přezkoumávat ji podruhé
-- při každé nesouvisející změně by bylo zbytečné (viz WHEN klauzule
-- triggeru: `before ... of assigned_employee_id`).
update public.checklist_runs set assigned_employee_id = :'standa' where id = :'beh_standa';
update public.checklist_runs set due_at = now() + interval '1 hour' where id = :'beh_standa';
select pg_temp.check('update jiného sloupce (due_at) nesáhne na kontrolu přiřazení',
  (select assigned_employee_id from public.checklist_runs where id = :'beh_standa') = :'standa');


\echo ''
\echo '== KROK 47 HOTOV ========================================'
