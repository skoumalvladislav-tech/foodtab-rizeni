-- Scénář pro krok 54 — Checklisty 2.0: přímý zápis klienta a odpovědnost.
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
-- * Běh smí přihlášený napřímo jen ZALOŽIT (čtyři sloupce). Nic nezmění
--   ani nesmaže — stav, uzavření, potvrzení, verze i odpovědnost drží RPC.
-- * „Kdo zahájil" se bere ze session, ne z těla požadavku; zápisy mimo
--   roli authenticated (plánovač, systém) spoušť nepřepisuje.
-- * Šablona běhu musí být z téže firmy a pobočky a aktivní.
-- * Odpovědnost (nastavit_odpovednost_checklistu): jen vedoucí, jen
--   otevřený běh, jen vlastní firma; termín je hodina na zdi a okamžik
--   z ní dělá databáze v pásmu pobočky (léto i zima, uložení beze změny
--   termín neposune).
-- * RPC s právy vlastníka tím nejsou omezené: zápis, uzavření
--   i potvrzení pod rolí authenticated projdou.
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

-- Otevřený běh se záznamem a uzavřený běh — založené jako vlastník
-- (tak, jak by je založil plánovač).
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

select pg_temp.check('checklist_runs: přihlášený čte, ale žádný sloupec nezmění a nic nesmaže',
  has_table_privilege('authenticated', 'public.checklist_runs', 'SELECT')
  and not has_any_column_privilege('authenticated', 'public.checklist_runs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.checklist_runs', 'DELETE'));

select pg_temp.check('checklist_runs: založit smí jen se čtyřmi údaji — bez stavu, lidí, termínu a potvrzení',
  (select bool_and(has_column_privilege('authenticated', 'public.checklist_runs', c, 'INSERT'))
     from unnest(array['tenant_id', 'branch_id', 'template_id', 'business_date']) c)
  and not (select bool_or(has_column_privilege('authenticated', 'public.checklist_runs', c, 'INSERT'))
     from unnest(array['status', 'completed_by', 'finished_at', 'potvrdil_kym', 'potvrzeno_kdy',
                       'sablona_verze_id', 'started_at', 'started_by', 'assigned_employee_id',
                       'due_at', 'shift_label']) c));

select pg_temp.check('nastavit_odpovednost_checklistu smí přihlášený, ne anon',
  has_function_privilege('authenticated',
    'public.nastavit_odpovednost_checklistu(uuid, uuid, uuid, timestamp, text)', 'execute')
  and not has_function_privilege('anon',
    'public.nastavit_odpovednost_checklistu(uuid, uuid, uuid, timestamp, text)', 'execute'));

select pg_temp.check('spouště z checklistů nesmí spouštět přihlášený ani anon',
  not has_function_privilege('authenticated', 'app.checklist_run_zalozeni_klientem_trg()', 'execute')
  and not has_function_privilege('anon', 'app.checklist_run_prirazeny_trg()', 'execute')
  and not has_function_privilege('anon', 'app.checklist_sablona_verze_je_nemenna()', 'execute'));


\echo ''
\echo '== 2. Záznam položky ani běh napřímo nezmění ================'

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);

select pg_temp.check('přímý INSERT záznamu spadne na právech (i vedoucímu)',
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

select pg_temp.check('přímý UPDATE běhu (třeba „potvrzeno") spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$update public.checklist_runs set potvrdil_kym = %L, potvrzeno_kdy = now() where id = %L$q$,
    :'petra', :'beh_hotovy')));

select pg_temp.check('přímý DELETE běhu spadne na právech',
  pg_temp.spadne_pravem(format(
    $q$delete from public.checklist_runs where id = %L$q$, :'beh_hotovy')));

reset role;
select pg_temp.check('záznam i běh po pokusech zůstaly, jak byly',
  (select checked and value_number is null from public.checklist_entries where id = :'zaznam')
  and (select potvrdil_kym is null from public.checklist_runs where id = :'beh_hotovy'));


\echo ''
\echo '== 3. Založení běhu napřímo ================================='

-- Systémový zápis (mimo roli authenticated) spoušť nepřepisuje.
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, started_by)
values (:'tenant', :'perla', :'sablona', current_date - 75, :'marek')
returning id as beh_systemovy \gset
select pg_temp.check('systémový zápis si „kdo zahájil" nechá (spoušť hlídá jen přihlášené)',
  (select started_by = :'marek'::uuid from public.checklist_runs where id = :'beh_systemovy'));

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000003', false);

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 72)
returning id as beh_novy \gset

reset role;
select pg_temp.check('běh se založil otevřený a „zahájil" je Standa ze session',
  (select started_by = :'standa'::uuid and status = 'open'
     from public.checklist_runs where id = :'beh_novy'));

set role authenticated;

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
\echo '== 4. Odpovědnost — jen vedoucí, jen otevřený běh ==========='

select pg_temp.check('bez tasks.manage odpovědnost změnit nejde',
  pg_temp.spadne_hlaskou(format(
    $q$select public.nastavit_odpovednost_checklistu(%L, %L, %L, null, null)$q$,
    :'tenant', :'beh_otevreny', :'standa'), '42501', 'jen vedoucí'));

select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);
select pg_temp.check('u uzavřeného běhu odpovědnost nezmění ani vedoucí (je to záznam)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.nastavit_odpovednost_checklistu(%L, %L, %L, null, null)$q$,
    :'tenant', :'beh_hotovy', :'petra'), '23514', 'Uzavřený'));

select public.nastavit_odpovednost_checklistu(:'tenant', :'beh_otevreny', :'standa',
  '2026-09-23 14:00'::timestamp, 'Ranní směna');

reset role;
select pg_temp.check('pobočka je v pásmu Europe/Prague (na tom stojí další kontroly)',
  app.zona_pobocky(:'perla') = 'Europe/Prague');

select pg_temp.check('vedoucí přidělil a přeplánoval: 14:00 v Praze v létě = 12:00 UTC',
  (select assigned_employee_id = :'standa'::uuid and shift_label = 'Ranní směna'
          and due_at = timestamptz '2026-09-23 12:00:00+00'
     from public.checklist_runs where id = :'beh_otevreny'));

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);

-- Formulář ukáže uložený termín jako hodinu na zdi a pošle ji beze změny
-- zpátky — termín se nesmí posunout (dřív utíkal o 2 h při každém uložení).
select public.nastavit_odpovednost_checklistu(:'tenant', :'beh_otevreny', :'standa',
  (select (due_at at time zone 'Europe/Prague') from public.checklist_runs where id = :'beh_otevreny'),
  null);

reset role;
select pg_temp.check('uložení beze změny termín neposune a směnu (NULL) nechá',
  (select due_at = timestamptz '2026-09-23 12:00:00+00' and shift_label = 'Ranní směna'
     from public.checklist_runs where id = :'beh_otevreny'));

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000001', false);
select public.nastavit_odpovednost_checklistu(:'tenant', :'beh_otevreny', :'standa',
  '2026-12-01 14:00'::timestamp, '');

reset role;
select pg_temp.check('v zimě: 14:00 v Praze = 13:00 UTC; prázdná směna se smaže',
  (select due_at = timestamptz '2026-12-01 13:00:00+00' and shift_label = ''
     from public.checklist_runs where id = :'beh_otevreny'));


\echo ''
\echo '== 5. Celofiremní vedoucí na cizí firmu nedosáhne ==========='

-- app.has_access pro scope='tenant' vrací true pro JAKOUKOLI pobočku,
-- i cizí firmy. Jediná bariéra je filtr `r.tenant_id = p_tenant`.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok54 Cizí s.r.o.', 'Krok54 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 54', 'krok54-cizi') returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí — krok54') returning id as cizi_sablona \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date) returning id as cizi_beh \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('54540000-0000-0000-0000-000000000009', 'majka54@foodtab.cz', '{"full_name":"Majka Padesátčtyři"}');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '54540000-0000-0000-0000-000000000009', 'Majka Padesátčtyři', 'hpp')
returning id as majka \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'majka', 'tasks.read', true), (:'tenant', :'majka', 'tasks.manage', true);
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '54540000-0000-0000-0000-000000000009', :'role_any', 'tenant', 'active');

set role authenticated;
select set_config('test.user_id', '54540000-0000-0000-0000-000000000009', false);
select pg_temp.check('celofiremní vedoucí NAŠÍ firmy cizí běh nepřeplánuje (p_tenant = naše)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.nastavit_odpovednost_checklistu(%L, %L, null, '2026-09-23 14:00', 'Podvrh')$q$,
    :'tenant', :'cizi_beh'), '42501', 'jen vedoucí'));

reset role;
select pg_temp.check('cizí běh zůstal nedotčený',
  (select due_at is null and shift_label = '' from public.checklist_runs where id = :'cizi_beh'));


\echo ''
\echo '== 6. RPC s právy vlastníka dál fungují ===================='

-- Pod rolí authenticated, jako z aplikace: zápis, uzavření, potvrzení.
set role authenticated;
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
