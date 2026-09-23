-- Scénář pro krok 48 — Checklisty 2.0, vrstva A: fotky, poznámka, směna.
--
-- Pokrývá migraci 20260923110000_checklisty_mockup.sql.
--
-- Navazuje na etapa0_scenar.sql až krok47_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- pripojit_checklist_fotku je definer — uvnitř neplatí RLS, takže každou
-- hranici (firma, pobočka, šablona, cesta, soubor, počet) si hlídá sama.
-- Každá se tu zkouší SKUTEČNÝM protipříkladem (existující řádek cizí
-- firmy, existující položka jiné šablony), ne jen náhodným id.
--
-- Co PGlite neověří: RLS na storage.objects a na checklist_polozka_fotky
-- (běží jako superuživatel). Ověřuje se tu jen katalog (granty, politiky
-- existují) — rozhoduje workflow Databáze proti PostgreSQL.

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
  ('48480000-0000-0000-0000-000000000001', 'standa48@foodtab.cz', '{"full_name":"Standa Osmačtyřicet"}'),
  ('48480000-0000-0000-0000-000000000002', 'zuzana48@foodtab.cz', '{"full_name":"Zuzana Osmačtyřicet"}');

-- Standa: tasks.read na PERLE — smí vyplňovat a fotit.
-- Zuzana: tasks.read, ale na BARU — na checklist Perly nedosáhne.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '48480000-0000-0000-0000-000000000001', 'Standa Osmačtyřicet', 'hpp'),
  (:'tenant', :'bar',   '48480000-0000-0000-0000-000000000002', 'Zuzana Osmačtyřicet', 'hpp');

select id as standa from public.employees where user_id = '48480000-0000-0000-0000-000000000001' \gset
select id as zuzana from public.employees where user_id = '48480000-0000-0000-0000-000000000002' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'standa', 'tasks.read', true),
  (:'tenant', :'zuzana', 'tasks.read', true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '48480000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '48480000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, x.b
  from public.memberships m
  join (values
    ('48480000-0000-0000-0000-000000000001'::uuid, :'perla'::uuid),
    ('48480000-0000-0000-0000-000000000002'::uuid, :'bar'::uuid)
  ) x(u, b) on x.u = m.user_id
 where m.tenant_id = :'tenant';

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Zavírací — krok48', 'closing')
returning id as sablona \gset

insert into public.checklist_items (template_id, position, label, requires_value, value_type, instructions)
values (:'sablona', 1, 'Fotka pracovní plochy — krok48', true, 'photo', 'Vyfoť celou plochu.')
returning id as polozka_foto \gset
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 2, 'Druhá položka — krok48')
returning id as polozka_druha \gset

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, shift_label, started_by)
values (:'tenant', :'perla', :'sablona', current_date - 30, 'Večerní směna', :'standa')
returning id as beh \gset

insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'tenant', :'perla', 'Jiná šablona — krok48')
returning id as jina_sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'jina_sablona', 1, 'Cizí položka — krok48')
returning id as jina_polozka \gset

-- Cizí firma se SKUTEČNÝM během a zaměstnancem.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok48 Cizí s.r.o.', 'Krok48 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí pobočka 48', 'krok48-cizi')
returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí šablona — krok48')
returning id as cizi_sablona \gset
insert into public.checklist_items (template_id, position, label)
values (:'cizi_sablona', 1, 'Cizí firmy položka 48')
returning id as cizi_polozka \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date)
returning id as cizi_beh \gset
insert into auth.users (id, email, raw_user_meta_data) values
  ('48480000-0000-0000-0000-00000000000c', 'cizi48@jinafirma.cz', '{"full_name":"Cizí 48"}');
insert into public.employees (tenant_id, user_id, full_name, employment_type)
values (:'cizi_firma', '48480000-0000-0000-0000-00000000000c', 'Cizí 48', 'hpp')
returning id as cizi_zamestnanec \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog: sloupce, tabulka, kbelík, granty ============'

select pg_temp.check('nové sloupce instructions/shift_label/started_by/note existují',
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'checklist_items'   and column_name = 'instructions')
        or (table_name = 'checklist_runs'    and column_name in ('shift_label', 'started_by'))
        or (table_name = 'checklist_entries' and column_name = 'note'))) = 4);

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'jina_sablona', current_date - 30)
returning id as beh_bez_smeny \gset

select pg_temp.check('výchozí hodnoty jsou prázdný text, ne NULL (konvence note-sloupců)',
  (select shift_label = '' and started_by is null
     from public.checklist_runs where id = :'beh_bez_smeny')
  and (select instructions = '' from public.checklist_items where id = :'polozka_druha'));

select pg_temp.check('kbelík checklist-fotky je soukromý, 10 MB, jen obrázky',
  exists (select 1 from storage.buckets
           where id = 'checklist-fotky' and public = false
             and file_size_limit = 10485760
             and not ('application/pdf' = any (allowed_mime_types))));

select pg_temp.check('checklist_polozka_fotky: přihlášený SELECT smí, INSERT/UPDATE/DELETE ne',
  has_table_privilege('authenticated', 'public.checklist_polozka_fotky', 'SELECT')
  and not has_table_privilege('authenticated', 'public.checklist_polozka_fotky', 'INSERT')
  and not has_table_privilege('authenticated', 'public.checklist_polozka_fotky', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.checklist_polozka_fotky', 'DELETE'));

select pg_temp.check('RPC pripojit_checklist_fotku smí přihlášený, ne anon',
  has_function_privilege('authenticated',
    'public.pripojit_checklist_fotku(uuid, uuid, text, text, text, integer)', 'execute')
  and not has_function_privilege('anon',
    'public.pripojit_checklist_fotku(uuid, uuid, text, text, text, integer)', 'execute'));

select pg_temp.check('tři politiky na storage.objects pro checklist-fotky existují',
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('checklist_fotky_select', 'checklist_fotky_insert',
                         'checklist_fotky_delete_sirotka')) = 3);


\echo ''
\echo '== 2. Parser cesty: nesmysl je prázdno, ne výjimka ========='

select pg_temp.check('platná cesta tenant/run/item/soubor se rozebere',
  (select tenant_id = :'tenant' and run_id = :'beh' and item_id = :'polozka_foto'
     from app.checklist_fotka_cesta_rozsah(
       :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/a.jpg')));

select pg_temp.check('cesta se DVĚMA složkami (tvar příloh) vrací prázdno',
  not exists (select 1 from app.checklist_fotka_cesta_rozsah(
    :'tenant' || '/' || :'beh' || '/a.jpg')));

select pg_temp.check('ne-uuid ve složce vrací prázdno, ne chybu serveru',
  not exists (select 1 from app.checklist_fotka_cesta_rozsah('abc/def/ghi/a.jpg')));


\echo ''
\echo '== 3. started_by — druhá linie jako u assigned/completed ===='

select pg_temp.check('běh se started_by vlastního zaměstnance a shift_label se uložil',
  (select started_by = :'standa' and shift_label = 'Večerní směna'
     from public.checklist_runs where id = :'beh'));

select pg_temp.check('INSERT se started_by cizí firmy spadne na 42501',
  pg_temp.spadne_hlaskou(format(
    'insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, started_by) '
    'values (%L, %L, %L, current_date - 31, %L)',
    :'tenant', :'perla', :'sablona', :'cizi_zamestnanec'),
    '42501', 'nepatří k vaší firmě'));

select pg_temp.check('UPDATE started_by na cizího spadne a hodnota zůstane',
  pg_temp.spadne_hlaskou(format(
    'update public.checklist_runs set started_by = %L where id = %L',
    :'cizi_zamestnanec', :'beh'),
    '42501', 'nepatří k vaší firmě')
  and (select started_by from public.checklist_runs where id = :'beh') = :'standa');


\echo ''
\echo '== 4. Připojení fotky — šťastná cesta ======================='

insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/f1.jpg');

select set_config('test.user_id', '48480000-0000-0000-0000-000000000001', false);
select public.pripojit_checklist_fotku(
  :'beh', :'polozka_foto',
  :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/f1.jpg',
  'plocha/../x.jpg', 'image/jpeg', 12345) as fotka1 \gset

select pg_temp.check('fotka vznikla, nese firmu, běh, položku a KDO ji nahrál (ze session)',
  (select tenant_id = :'tenant' and run_id = :'beh' and item_id = :'polozka_foto'
          and employee_id = :'standa'
     from public.checklist_polozka_fotky where id = :'fotka1'));

select pg_temp.check('lomítka v názvu se zahladila (název je jen popisek)',
  (select position('/' in nazev) = 0 from public.checklist_polozka_fotky where id = :'fotka1'));


\echo ''
\echo '== 5. Hranice — každá SKUTEČNÝM protipříkladem =============='

-- Soubor, který v úložišti JE, ale leží pod jinou položkou téhož běhu.
insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh' || '/' || :'polozka_druha' || '/f2.jpg');

select pg_temp.check('cesta jiné položky téhož běhu se k téhle nepřipojí',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_foto',
    :'tenant' || '/' || :'beh' || '/' || :'polozka_druha' || '/f2.jpg'),
    '23514', 'Cesta k fotce nesedí'));

-- Cesta s cizí firmou v první složce (soubor fyzicky existuje).
insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'cizi_firma' || '/' || :'beh' || '/' || :'polozka_foto' || '/f3.jpg');

select pg_temp.check('cesta s cizí firmou se nepřipojí, i když soubor existuje',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_foto',
    :'cizi_firma' || '/' || :'beh' || '/' || :'polozka_foto' || '/f3.jpg'),
    '23514', 'Cesta k fotce nesedí'));

select pg_temp.check('položka z jiné šablony k tomuhle běhu nepatří',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'jina_polozka',
    :'tenant' || '/' || :'beh' || '/' || :'jina_polozka' || '/f4.jpg'),
    '23514', 'Ta položka k tomuhle checklistu nepatří'));

select pg_temp.check('správná cesta, ale soubor v úložišti NENÍ → odmítnuto',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_foto',
    :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/neexistuje.jpg'),
    '23514', 'Soubor v úložišti není'));

select pg_temp.check('SKUTEČNÝ běh cizí firmy: přístup odepřen',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'cizi_beh', :'cizi_polozka',
    :'cizi_firma' || '/' || :'cizi_beh' || '/' || :'cizi_polozka' || '/f5.jpg'),
    '42501', 'nemáte přístup'));

-- Zuzana: tasks.read jen na Baru — checklist Perly jí nedosáhne.
select set_config('test.user_id', '48480000-0000-0000-0000-000000000002', false);
select pg_temp.check('tasks.read na JINÉ pobočce k fotce na Perle nepustí',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_foto',
    :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/f1.jpg'),
    '42501', 'nemáte přístup'));

select pg_temp.check('… a po odmítnutých pokusech je u položky pořád jen jedna fotka',
  (select count(*) from public.checklist_polozka_fotky where item_id = :'polozka_foto') = 1);


\echo ''
\echo '== 6. Strop 6 fotek na položku ============================='

select set_config('test.user_id', '48480000-0000-0000-0000-000000000001', false);

insert into storage.objects (bucket_id, name)
select 'checklist-fotky', :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/s' || g || '.jpg'
  from generate_series(2, 7) g;

select public.pripojit_checklist_fotku(:'beh', :'polozka_foto',
  :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/s' || g || '.jpg',
  's.jpg', 'image/jpeg', 100)
  from generate_series(2, 6) g;

select pg_temp.check('šest fotek projde',
  (select count(*) from public.checklist_polozka_fotky where item_id = :'polozka_foto') = 6);

select pg_temp.check('sedmá spadne na strop',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 's.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_foto',
    :'tenant' || '/' || :'beh' || '/' || :'polozka_foto' || '/s7.jpg'),
    '23514', 'nejvýš 6'));

-- Strop je na BĚH: v dalším běhu téže šablony se u stejné položky fotit
-- dá dál (první znění počítalo napříč běhy a po šesti dnech by nešlo nic).
select set_config('test.user_id', '', false);
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date - 29) returning id as beh2 \gset
insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh2' || '/' || :'polozka_foto' || '/d.jpg');

select set_config('test.user_id', '48480000-0000-0000-0000-000000000001', false);
select public.pripojit_checklist_fotku(:'beh2', :'polozka_foto',
  :'tenant' || '/' || :'beh2' || '/' || :'polozka_foto' || '/d.jpg', 'd.jpg', 'image/jpeg', 100) as fotka_beh2 \gset
select pg_temp.check('v dalším běhu téže šablony fotka projde (strop je na běh)',
  (select run_id from public.checklist_polozka_fotky where id = :'fotka_beh2') = :'beh2');


\echo ''
\echo '== 7. Uzavřený běh a položka mimo verzi ==================='

select set_config('test.user_id', '', false);
update public.checklist_runs set status = 'done' where id = :'beh2';
insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh2' || '/' || :'polozka_foto' || '/pozde.jpg');

select set_config('test.user_id', '48480000-0000-0000-0000-000000000001', false);
select pg_temp.check('do uzavřeného běhu fotka nepřibude',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh2', :'polozka_foto',
    :'tenant' || '/' || :'beh2' || '/' || :'polozka_foto' || '/pozde.jpg'),
    '23514', 'Uzavřený'));

select set_config('test.user_id', '', false);
insert into public.checklist_items (template_id, position, label)
values (:'sablona', 9, 'Přidaná po spuštění — krok48') returning id as polozka_pozde \gset
insert into storage.objects (bucket_id, name)
values ('checklist-fotky', :'tenant' || '/' || :'beh' || '/' || :'polozka_pozde' || '/p.jpg');

select set_config('test.user_id', '48480000-0000-0000-0000-000000000001', false);
select pg_temp.check('k položce, která do verze běhu nepatří, fotka nepřibude',
  pg_temp.spadne_hlaskou(format(
    $q$select public.pripojit_checklist_fotku(%L, %L, %L, 'x.jpg', 'image/jpeg', 100)$q$,
    :'beh', :'polozka_pozde',
    :'tenant' || '/' || :'beh' || '/' || :'polozka_pozde' || '/p.jpg'),
    '23514', 'nepatří'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 48 HOTOV ========================================'
