-- Scénář pro krok 54 — Checklisty 2.0: přímý zápis klienta.
--
-- Pokrývá 20260923200000_checklisty_prava_zapisu.sql.
--
-- Navazuje na etapa0_scenar.sql až krok53_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Záznamy položek jdou zapsat JEN přes zapsat_polozku_checklistu —
--   přímý insert/update/delete přihlášeného spadne.
-- * Běh smí přihlášený přímo jen založit; odpovědnost (kdo / do kdy /
--   směna) změní jen vedoucí a jen u otevřeného běhu. Stav, uzavření,
--   potvrzení a verze ne — ty drží RPC.
-- * „Kdo zahájil" se bere ze session, ne z těla požadavku.
-- * Šablona běhu musí být z téže firmy a pobočky a aktivní.
-- * RPC s právy vlastníka tím NEJSOU omezené: zápis, uzavření
--   i potvrzení (které mění UZAVŘENÝ běh) pod rolí authenticated projdou.
--
-- POZOR NA PGLITE: sloupcové granty se tam neprojeví, proto se hlídají
-- katalogem (has_column_privilege). Tabulkové granty a spoušť se
-- zkoušejí skutečným zápisem pod `set role authenticated`.

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

create or replace function pg_temp.spadne_pravem(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
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
  ('54540000-0000-0000-0000-000000000001', 'petra54@foodtab.cz',  '{"full_name":"Petra Padesátčtyři"}'),
  ('54540000-0000-0000-0000-000000000002', 'marek54@foodtab.cz',  '{"full_name":"Marek Padesátčtyři"}'),
  ('54540000-0000-0000-0000-000000000003', 'standa54@foodtab.cz', '{"full_name":"Standa Padesátčtyři"}'),
  ('54540000-0000-0000-0000-000000000004', 'olga54@foodtab.cz',   '{"full_name":"Olga Padesátčtyři"}');

-- Petra a Marek: vedoucí na Perle (tasks.read + tasks.manage).
-- Standa: jen tasks.read na Perle — běžná směna.
-- Olga: tasks.read na Perle I na Baru — vidí šablony obou poboček, takže
-- šablonu Baru na Perle nezastaví RLS, jen pravidlo „stejná pobočka".
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '54540000-0000-0000-0000-000000000001', 'Petra Padesátčtyři',  'hpp'),
  (:'tenant', :'perla', '54540000-0000-0000-0000-000000000002', 'Marek Padesátčtyři',  'hpp'),
  (:'tenant', :'perla', '54540000-0000-0000-0000-000000000003', 'Standa Padesátčtyři', 'hpp'),
  (:'tenant', :'perla', '54540000-0000-0000-0000-000000000004', 'Olga Padesátčtyři',   'hpp');

select id as petra  from public.employees where user_id = '54540000-0000-0000-0000-000000000001' \gset
select id as marek  from public.employees where user_id = '54540000-0000-0000-0000-000000000002' \gset
select id as standa from public.employees where user_id = '54540000-0000-0000-0000-000000000003' \gset
select id as olga   from public.employees where user_id = '54540000-0000-0000-0000-000000000004' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.read',   true),
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'marek',  'tasks.read',   true),
  (:'tenant', :'marek',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true),
  (:'tenant', :'olga',   'tasks.read',   true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '54540000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '54540000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active'),
  (:'tenant', '54540000-0000-0000-0000-000000000003', :'role_any', 'branch', 'active'),
  (:'tenant', '54540000-0000-0000-0000-000000000004', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id in ('54540000-0000-0000-0000-000000000001',
                     '54540000-0000-0000-0000-000000000002',
                     '54540000-0000-0000-0000-000000000003',
                     '54540000-0000-0000-0000-000000000004');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'bar'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id = '54540000-0000-0000-0000-000000000004';

insert into public.checklist_templates (tenant_id, branch_id, name, schedule, vyzaduje_potvrzeni)
values (:'tenant', :'perla', 'Uzávěrka — krok54', 'closing', true)
returning id as sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 1, 'Spočítat hotovost — krok54') returning id as polozka \gset

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'bar', 'Bar — krok54', 'opening')
returning id as sablona_bar \gset

insert into public.checklist_templates (tenant_id, branch_id, name, schedule, active)
values (:'tenant', :'perla', 'Vyřazená — krok54', 'opening', false)
returning id as sablona_vyrazena \gset

-- Otevřený běh se záznamem (založený jako vlastník — tak, jak by ho
-- založil plánovač) a uzavřený běh.
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 70) returning id as beh_otevreny \gset
insert into public.checklist_entries (run_id, item_id, checked, employee_id, recorded_at)
values (:'beh_otevreny', :'polozka', true, :'standa', now()) returning id as zaznam \gset

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, status, finished_at, completed_by)
values (:'tenant', :'perla', :'sablona', current_date - 71, 'done', now(), :'standa')
returning id as beh_hotovy \gset


\echo ''
\echo '== 1. Katalog — co smí přihlášený zapsat napřímo ============'

select pg_temp.check('checklist_entries: přihlášený čte, ale přímo nevloží, nezmění ani nesmaže',
  has_table_privilege('authenticated', 'public.checklist_entries', 'SELECT')
  and not has_any_column_privilege('authenticated', 'public.checklist_entries', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.checklist_entries', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.checklist_entries', 'DELETE'));

select pg_temp.check('checklist_runs: mazat nesmí nikdo přihlášený',
  not has_table_privilege('authenticated', 'public.checklist_runs', 'DELETE'));

select pg_temp.check('checklist_runs: měnit smí jen komu, do kdy a směnu',
  (select bool_and(has_column_privilege('authenticated', 'public.checklist_runs', c, 'UPDATE'))
     from unnest(array['assigned_employee_id', 'due_at', 'shift_label']) c)
  and not (select bool_or(has_column_privilege('authenticated', 'public.checklist_runs', c, 'UPDATE'))
     from unnest(array['status', 'completed_by', 'finished_at', 'potvrdil_kym', 'potvrzeno_kdy',
                       'sablona_verze_id', 'started_by', 'started_at', 'tenant_id', 'branch_id',
                       'template_id', 'business_date']) c));

select pg_temp.check('checklist_runs: založit smí jen s údaji pro spuštění, ne se stavem ani potvrzením',
  (select bool_and(has_column_privilege('authenticated', 'public.checklist_runs', c, 'INSERT'))
     from unnest(array['tenant_id', 'branch_id', 'template_id', 'business_date',
                       'assigned_employee_id', 'due_at', 'shift_label', 'started_by']) c)
  and not (select bool_or(has_column_privilege('authenticated', 'public.checklist_runs', c, 'INSERT'))
     from unnest(array['status', 'completed_by', 'finished_at', 'potvrdil_kym', 'potvrzeno_kdy',
                       'sablona_verze_id', 'started_at']) c));

select pg_temp.check('spouště z checklistů nesmí spouštět přihlášený ani anon',
  not has_function_privilege('authenticated', 'app.checklist_run_zapis_klienta_trg()', 'execute')
  and not has_function_privilege('anon', 'app.checklist_run_prirazeny_trg()', 'execute')
  and not has_function_privilege('anon', 'app.checklist_sablona_verze_je_nemenna()', 'execute'));


\echo ''
\echo '== 2. Záznam položky napřímo neprojde ======================'

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);

select pg_temp.check('přímý INSERT záznamu spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$insert into public.checklist_entries (run_id, item_id, checked) values (%L, %L, true)$q$,
    :'beh_hotovy', :'polozka')));

select pg_temp.check('přímý UPDATE záznamu (třeba přepis HACCP hodnoty) spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$update public.checklist_entries set checked = false, value_number = 99 where id = %L$q$,
    :'zaznam')));

select pg_temp.check('přímý DELETE záznamu spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$delete from public.checklist_entries where id = %L$q$, :'zaznam')));

select pg_temp.check('přímý DELETE běhu spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$delete from public.checklist_runs where id = %L$q$, :'beh_hotovy')));

reset role;
select pg_temp.check('záznam i běh po pokusech zůstaly, jak byly',
  (select checked and value_number is null from public.checklist_entries where id = :'zaznam')
  and exists (select 1 from public.checklist_runs where id = :'beh_hotovy'));


\echo ''
\echo '== 3. Založení běhu napřímo — „kdo zahájil" je ze session ==='

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);

-- Standa se pokusí zapsat, že běh zahájila Petra.
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, started_by, shift_label)
values (:'tenant', :'perla', :'sablona', current_date - 72, :'petra', 'Večerní směna')
returning id as beh_novy \gset

reset role;
select pg_temp.check('běh se založil, ale „zahájil" je Standa ze session, ne podvržená Petra',
  (select started_by = :'standa'::uuid and status = 'open' and shift_label = 'Večerní směna'
     from public.checklist_runs where id = :'beh_novy'));

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);

-- Olga šablonu Baru VIDÍ (má tasks.read i na Baru), takže tady ji
-- nezastaví RLS, ale jen pravidlo „šablona z téže pobočky".
select set_config('test.user_id', '54540000-0000-0000-0000-000000000004', false);
select pg_temp.check('Olga vidí šablonu Baru (jinak by další kontrola nic nedokazovala)',
  exists (select 1 from public.checklist_templates where id = :'sablona_bar'));

select pg_temp.check('běh na Perle se šablonou Baru se nezaloží, i když ji zakládající vidí',
  pg_temp.spadne_hlaskou(format(
    $q$insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
       values (%L, %L, %L, current_date - 73)$q$,
    :'tenant', :'perla', :'sablona_bar'), '23514', 'neběží'));

select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);

select pg_temp.check('běh s vyřazenou šablonou se nezaloží',
  pg_temp.spadne_hlaskou(format(
    $q$insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
       values (%L, %L, %L, current_date - 74)$q$,
    :'tenant', :'perla', :'sablona_vyrazena'), '23514', 'neběží'));


\echo ''
\echo '== 4. Odpovědnost napřímo — jen vedoucí, jen otevřený běh ==='

-- Standa (jen tasks.read) si checklist přeplánovat nesmí, i když
-- politika checklist_runs_write mu zápis pouští.
select pg_temp.check('bez tasks.manage odpovědnost změnit nejde',
  pg_temp.spadne_hlaskou(format(
    $q$update public.checklist_runs set assigned_employee_id = %L where id = %L$q$,
    :'standa', :'beh_otevreny'), '42501', 'jen vedoucí'));

select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);
update public.checklist_runs
   set assigned_employee_id = :'standa', shift_label = 'Ranní směna'
 where id = :'beh_otevreny';

reset role;
select pg_temp.check('vedoucí u otevřeného běhu změní komu a směnu',
  (select assigned_employee_id = :'standa'::uuid and shift_label = 'Ranní směna'
     from public.checklist_runs where id = :'beh_otevreny'));

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);

select pg_temp.check('u uzavřeného běhu odpovědnost nezmění ani vedoucí (je to záznam)',
  pg_temp.spadne_hlaskou(format(
    $q$update public.checklist_runs set assigned_employee_id = %L where id = %L$q$,
    :'petra', :'beh_hotovy'), '23514', 'Uzavřený'));


\echo ''
\echo '== 5. RPC s právy vlastníka dál fungují ===================='

-- Pod rolí authenticated, jako z aplikace: zápis, uzavření, potvrzení.
-- Potvrzení mění UZAVŘENÝ běh — spoušť ho nesmí zablokovat.
select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);
select public.zapsat_polozku_checklistu(:'tenant', :'beh_novy', :'polozka', null, '', false, '', null);

select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);
select public.uzavrit_checklist(:'tenant', :'beh_novy') as vysledek \gset

select set_config('test.user_id', '54540000-0000-0000-0000-000000000002', false);
select public.potvrdit_checklist(:'tenant', :'beh_novy');

reset role;
select pg_temp.check('zápis, uzavření a potvrzení přes RPC prošly i pod rolí authenticated',
  :'vysledek' = 'done'
  and (select status = 'done' and completed_by = :'petra'::uuid
              and potvrdil_kym = :'marek'::uuid and potvrzeno_kdy is not null
         from public.checklist_runs where id = :'beh_novy')
  and (select checked from public.checklist_entries
        where run_id = :'beh_novy' and item_id = :'polozka'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 54 HOTOV ========================================'
