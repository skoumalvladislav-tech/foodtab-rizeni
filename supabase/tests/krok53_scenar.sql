-- Scénář pro krok 53 — Checklisty 2.0: plánování, termíny, „přidělen".
--
-- Pokrývá 20260923170000_checklisty_planovani.sql a
-- 20260923190000_checklisty_notifikace_trigger.sql.
--
-- Navazuje na etapa0_scenar.sql až krok52_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Plánovač založí běh jen tam, kde to rozvrh opravdu říká — every_shift
--   a manual NE (rozhodnutí Šéfíka 23. 9.), weekly/selected_days jen ve
--   vybrané dny a bez vybraných dnů vůbec, neaktivní šablona nikdy.
-- * Firemní šablona (bez pobočky) se rozvětví na všechny aktivní pobočky.
-- * Dvojí spuštění nic nezdvojí (plánovač i hlídač termínů).
-- * „Přidělen" chodí z obou cest (INSERT i UPDATE), ne při změně jiného
--   sloupce, a ne tomu, kdo si checklist přidělil sám.
--
-- Realtime publikace se tu NEOVĚŘUJE — v PGlite `supabase_realtime`
-- neexistuje a migrace ho schválně toleruje. Ověřuje se až po nasazení
-- dotazem na pg_publication_tables.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
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
  ('53530000-0000-0000-0000-000000000001', 'petra53@foodtab.cz',  '{"full_name":"Petra Třiapadesát"}'),
  ('53530000-0000-0000-0000-000000000002', 'standa53@foodtab.cz', '{"full_name":"Standa Třiapadesát"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '53530000-0000-0000-0000-000000000001', 'Petra Třiapadesát',  'hpp'),
  (:'tenant', :'perla', '53530000-0000-0000-0000-000000000002', 'Standa Třiapadesát', 'hpp');

select id as petra  from public.employees where user_id = '53530000-0000-0000-0000-000000000001' \gset
select id as standa from public.employees where user_id = '53530000-0000-0000-0000-000000000002' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.read',   true),
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '53530000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '53530000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.user_id in ('53530000-0000-0000-0000-000000000001', '53530000-0000-0000-0000-000000000002')
   and m.tenant_id = :'tenant';

select app.business_date(:'perla', now()) as den \gset
select extract(dow from :'den'::date)::int as dnes_dow \gset

insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Denní — krok53', 'daily') returning id as t_denni \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Ruční — krok53', 'manual') returning id as t_rucni \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Každá směna — krok53', 'every_shift') returning id as t_smena \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule, dny_v_tydnu)
values (:'tenant', :'perla', 'Vybrané dny ANO — krok53', 'selected_days',
        array[:'dnes_dow']::smallint[]) returning id as t_sel_ano \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule, dny_v_tydnu)
values (:'tenant', :'perla', 'Vybrané dny NE — krok53', 'selected_days',
        array[(:'dnes_dow'::int + 1) % 7]::smallint[]) returning id as t_sel_ne \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', :'perla', 'Týdenní bez dnů — krok53', 'weekly') returning id as t_tyden_prazdny \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule, active)
values (:'tenant', :'perla', 'Neaktivní — krok53', 'daily', false) returning id as t_neaktivni \gset
insert into public.checklist_templates (tenant_id, branch_id, name, schedule)
values (:'tenant', null, 'Firemní denní — krok53', 'daily') returning id as t_firemni \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Plánovač zakládá jen podle rozvrhu ================='

select public.vytvorit_naplanovane_checklisty();

select pg_temp.check('denní šablona má dnešní běh na Perle, NEPŘIŘAZENÝ (žádné hádání)',
  exists (select 1 from public.checklist_runs
           where template_id = :'t_denni' and branch_id = :'perla'
             and business_date = :'den' and assigned_employee_id is null and status = 'open'));

select pg_temp.check('vybrané dny: dnešní den v seznamu → běh je',
  exists (select 1 from public.checklist_runs where template_id = :'t_sel_ano'));

select pg_temp.check('vybrané dny: dnešek v seznamu NENÍ → běh není',
  not exists (select 1 from public.checklist_runs where template_id = :'t_sel_ne'));

select pg_temp.check('ruční a každá směna (bez automatiky, rozhodnutí 23. 9.): žádný běh',
  not exists (select 1 from public.checklist_runs
               where template_id in (:'t_rucni', :'t_smena')));

select pg_temp.check('týdenní bez vybraných dnů: žádný běh (prázdno není „každý den")',
  not exists (select 1 from public.checklist_runs where template_id = :'t_tyden_prazdny'));

select pg_temp.check('neaktivní šablona: žádný běh',
  not exists (select 1 from public.checklist_runs where template_id = :'t_neaktivni'));

select pg_temp.check('firemní šablona (bez pobočky) má běh na KAŽDÉ aktivní pobočce firmy',
  (select count(distinct branch_id) from public.checklist_runs where template_id = :'t_firemni')
  = (select count(*) from public.branches where tenant_id = :'tenant' and active)
  and exists (select 1 from public.checklist_runs
               where template_id = :'t_firemni' and branch_id = :'bar'));

select count(*) as pocet_behu_po_prvnim from public.checklist_runs
 where template_id in (:'t_denni', :'t_sel_ano', :'t_firemni') \gset

select public.vytvorit_naplanovane_checklisty();
select pg_temp.check('druhé spuštění nezaložilo nic navíc',
  (select count(*) from public.checklist_runs
    where template_id in (:'t_denni', :'t_sel_ano', :'t_firemni')) = :'pocet_behu_po_prvnim'::int);


\echo ''
\echo '== 2. Hlídač termínů ====================================='

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id, due_at)
values (:'tenant', :'perla', :'t_rucni', current_date - 80, :'standa', now() + interval '30 minutes')
returning id as r_blizi \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id, due_at)
values (:'tenant', :'perla', :'t_rucni', current_date - 81, :'standa', now() - interval '1 hour')
returning id as r_po \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id, due_at)
values (:'tenant', :'perla', :'t_rucni', current_date - 82, :'standa', now() + interval '5 hours')
returning id as r_daleko \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id, due_at, status)
values (:'tenant', :'perla', :'t_rucni', current_date - 83, :'standa', now() - interval '1 hour', 'done')
returning id as r_hotovo \gset

select public.ohlasit_checklisty_terminy();
select public.ohlasit_checklisty_terminy();

select pg_temp.check('blížící se termín: Standa má právě jedno upozornění (i po dvou bězích hlídače)',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.blizi_se_termin', :'r_blizi') = 1);

select pg_temp.check('po termínu: právě jedno, a DŮLEŽITÉ',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.po_terminu', :'r_po') = 1
  and (select priorita from public.notifications
        where druh = 'checklist.po_terminu' and zdroj_id = :'r_po' and read_at is null) = 'important');

select pg_temp.check('běh „po termínu" se zároveň nehlásí jako „blíží se"',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.blizi_se_termin', :'r_po') = 0);

select pg_temp.check('termín za 5 hodin ani hotový běh nic nehlásí',
  not exists (select 1 from public.notifications
               where zdroj_id in (:'r_daleko', :'r_hotovo')
                 and druh in ('checklist.blizi_se_termin', 'checklist.po_terminu')));

-- Přečtené upozornění se nesmí vrátit: hlídač se neřídí stavem
-- upozornění, ale vlastní tabulkou ohlášených.
update public.notifications set read_at = now()
 where druh = 'checklist.po_terminu' and zdroj_id = :'r_po';
select public.ohlasit_checklisty_terminy();
select pg_temp.check('po přečtení a dalším běhu hlídače nové „po termínu" nevzniklo',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.po_terminu', :'r_po') = 0);


\echo ''
\echo '== 3. „Checklist přidělen" ==============================='

-- r_blizi už vznikl s přiřazením (INSERT) — upozornění z téhle cesty.
select pg_temp.check('INSERT s přiřazením: Standa dostal checklist.prideleno',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.prideleno', :'r_blizi') = 1);

select pg_temp.check('tělo upozornění nese běh, název šablony, slug pobočky a termín — nic víc',
  (select telo->>'beh' = :'r_blizi' and telo->>'nazev' = 'Ruční — krok53'
          and telo->>'pobocka_slug' = 'cerna-perla' and telo ? 'termin'
          and (select count(*) from jsonb_object_keys(telo)) = 4
     from public.notifications
    where druh = 'checklist.prideleno' and zdroj_id = :'r_blizi'));

select set_config('test.user_id', '53530000-0000-0000-0000-000000000002', false);
update public.checklist_runs set assigned_employee_id = :'petra' where id = :'r_daleko';
select pg_temp.check('UPDATE přiřazení na Petru: Petra dostala checklist.prideleno',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000001', 'checklist.prideleno', :'r_daleko') = 1);

update public.notifications set read_at = now()
 where druh = 'checklist.prideleno' and zdroj_id = :'r_daleko';
update public.checklist_runs set due_at = now() + interval '6 hours' where id = :'r_daleko';
select pg_temp.check('změna JINÉHO sloupce (termín) upozornění nevyrobí',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000001', 'checklist.prideleno', :'r_daleko') = 0);

-- Standa (přihlášený) si přidělí checklist sám sobě.
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date, assigned_employee_id)
values (:'tenant', :'perla', :'t_rucni', current_date - 84, :'standa')
returning id as r_sam \gset
select pg_temp.check('kdo si checklist přidělil sám, upozornění sám sobě nedostane',
  pg_temp.upozorneni('53530000-0000-0000-0000-000000000002', 'checklist.prideleno', :'r_sam') = 0);

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 53 HOTOV ========================================'
