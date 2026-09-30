-- Scénář pro krok 65 — vlastní vydaná směna bez shifts.read.
--
-- Pokrývá migraci 20260929130000_shifts_read_vlastni_smena.sql.
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab s.r.o., pobočky Černá
-- Perla a Bernard Bar). Pouští se i samostatně:
--   node scripts/scenare-pglite.mjs etapa0_scenar krok65_scenar
--
-- ---------------------------------------------------------------------
-- KONTEXT (docs/hlaseni/otazky.md, otázka 2)
--
-- Politika `shifts_read` na `public.shifts` pouštěla čtení jen podle
-- `app.can_read_scoped(tenant, 'shifts.read', branch)`. Firma, která
-- zařazení upraví a odebere mu `shifts.read`, tím člověku vzala i
-- pohled na JEHO VLASTNÍ vydanou směnu — „Dnes" mu ukázalo „Dnes
-- nemáte směnu", i když ji měl. Migrace přidává druhou větev, přesně
-- podle vzoru `attendance_read`:
--
--   or employee_id in (select e.id from employees e
--                       where e.user_id = auth.uid())
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. člověk BEZ shifts.read vidí SVOU vlastní vydanou směnu;
--   2. NEVIDÍ vydanou směnu kolegy se stejným (chybějícím) právem na
--      téže pobočce — vlastní řádek navíc neotvírá nic cizího;
--   3. totéž symetricky z pohledu kolegy — aby kontrola neměřila
--      náhodou jen jedno napevno zapsané ID;
--   4. člověk BEZ shifts.read a BEZ vlastní směny nevidí nic;
--   5. regrese beze změny: člověk SE shifts.read na pobočce vidí OBĚ
--      směny jako dřív — rozšíření politiky nezúžilo ani nerozšířilo
--      branch-scope větev `can_read_scoped`.
--
-- POZOR NA PGLITE: `set role authenticated` + `test.user_id` tu RLS
-- skutečně uplatňuje (grant je `all tables in schema public`, žádný
-- sloupcový grant tomu nepřekáží — ověřeno i jinde v sadě, např.
-- krok2 „cizí nevidí směny"), ale zbytek mezer z hlavičky
-- scripts/scenare-pglite.mjs platí i tady. Rozhoduje až workflow
-- Databáze proti PostgreSQL 16.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
-- Předchozí scénář (v PGlite v témže sezení) nechává test.user_id
-- nastavené — bez tohohle by první dotaz spadl na cizí kontrole.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

-- Zařazení BEZ jediného práva — přesně situace z hlášení: firma
-- odebrala shifts.read (a nedala nic jiného).
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok65_bez_prav', 'Krok 65 — bez práv', 'provoz', true)
returning id as z_bez \gset

-- Zařazení SE shifts.read, pro regresní kontrolu č. 5.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok65_se_shifts_read', 'Krok 65 — se shifts.read', 'provoz', true)
returning id as z_ma \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_ma', 'shifts.read');

insert into auth.users (id, email, raw_user_meta_data) values
  ('65650000-0000-0000-0000-000000000001', 'petr65@foodtab.cz',   '{"full_name":"Petr Šedesátpět"}'),
  ('65650000-0000-0000-0000-000000000002', 'kolega65@foodtab.cz', '{"full_name":"Kolega Šedesátpět"}'),
  ('65650000-0000-0000-0000-000000000003', 'nikdo65@foodtab.cz',  '{"full_name":"Nikdo Šedesátpět"}'),
  ('65650000-0000-0000-0000-000000000004', 'pravo65@foodtab.cz',  '{"full_name":"Právo Šedesátpět"}');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values
  (:'tenant', :'perla', '65650000-0000-0000-0000-000000000001', :'z_bez', 'Petr Šedesátpět',   'hpp'),
  (:'tenant', :'perla', '65650000-0000-0000-0000-000000000002', :'z_bez', 'Kolega Šedesátpět', 'hpp'),
  (:'tenant', :'perla', '65650000-0000-0000-0000-000000000003', :'z_bez', 'Nikdo Šedesátpět',  'hpp'),
  (:'tenant', :'perla', '65650000-0000-0000-0000-000000000004', :'z_ma',  'Právo Šedesátpět',  'hpp');

select id as e_petr   from public.employees where tenant_id = :'tenant' and full_name = 'Petr Šedesátpět'   \gset
select id as e_kolega from public.employees where tenant_id = :'tenant' and full_name = 'Kolega Šedesátpět' \gset
select id as e_nikdo  from public.employees where tenant_id = :'tenant' and full_name = 'Nikdo Šedesátpět'  \gset
select id as e_pravo  from public.employees where tenant_id = :'tenant' and full_name = 'Právo Šedesátpět'  \gset

-- Členství: všichni jen na Perle (rozsah 'branch'), role_id se
-- nevyplňuje — práva dnes dává zařazení, ne role (viz krok57/64).
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '65650000-0000-0000-0000-000000000001', null, 'branch', 'active'),
  (:'tenant', '65650000-0000-0000-0000-000000000002', null, 'branch', 'active'),
  (:'tenant', '65650000-0000-0000-0000-000000000003', null, 'branch', 'active'),
  (:'tenant', '65650000-0000-0000-0000-000000000004', null, 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id::text like '65650000-0000-0000-0000-00000000000%';

-- Dvě VYDANÉ směny na Perle — Petrova a Kolegova. Nikdo nemá žádnou.
insert into public.shifts
  (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, note, published_at)
values
  (:'tenant', :'perla', :'e_petr', current_date, '08:00', '16:00', 'krok65 own row', now())
returning id as s_petr \gset

insert into public.shifts
  (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, note, published_at)
values
  (:'tenant', :'perla', :'e_kolega', current_date, '08:00', '16:00', 'krok65 own row', now())
returning id as s_kolega \gset


-- =====================================================================
-- KONTROLY
-- =====================================================================

\echo ''
\echo '== Vlastní vydaná směna bez shifts.read ==================='

-- 1) Petr (bez shifts.read) vidí SVOU vlastní vydanou směnu ----------
set role authenticated;
select set_config('test.user_id', '65650000-0000-0000-0000-000000000001', false);

select pg_temp.check('BEZ shifts.read vidí vlastní vydanou směnu',
  (select count(*) from public.shifts where id = :'s_petr') = 1);

-- …ale NEVIDÍ vydanou směnu kolegy se stejným (chybějícím) právem ----
select pg_temp.check('BEZ shifts.read NEVIDÍ vydanou směnu kolegy',
  (select count(*) from public.shifts where id = :'s_kolega') = 0);

reset role;

-- 2) Symetricky Kolega — aby kontrola neměřila náhodou jen ID Petra --
set role authenticated;
select set_config('test.user_id', '65650000-0000-0000-0000-000000000002', false);

select pg_temp.check('symetricky: kolega BEZ shifts.read vidí SVOU vydanou směnu',
  (select count(*) from public.shifts where id = :'s_kolega') = 1);

select pg_temp.check('symetricky: kolega BEZ shifts.read NEVIDÍ Petrovu směnu',
  (select count(*) from public.shifts where id = :'s_petr') = 0);

reset role;

-- 3) Nikdo (bez shifts.read a BEZ vlastní směny) nevidí nic ----------
set role authenticated;
select set_config('test.user_id', '65650000-0000-0000-0000-000000000003', false);

select pg_temp.check('BEZ shifts.read a BEZ vlastní směny nevidí ani jednu z obou směn',
  (select count(*) from public.shifts where id in (:'s_petr', :'s_kolega')) = 0);

reset role;

-- 4) Regresní kontrola: SE shifts.read na pobočce vidí OBĚ, jako dřív.
-- Rozšíření politiky nesmí branch-scope větev can_read_scoped nijak
-- zúžit ani rozšířit.
set role authenticated;
select set_config('test.user_id', '65650000-0000-0000-0000-000000000004', false);

select pg_temp.check('SE shifts.read na pobočce vidí obě vydané směny (beze změny)',
  (select count(*) from public.shifts where id in (:'s_petr', :'s_kolega')) = 2);

reset role;


-- =====================================================================
-- ÚKLID
-- =====================================================================

select set_config('test.user_id', '', false);

delete from public.shifts where id in (:'s_petr', :'s_kolega');
delete from public.membership_branches
 where membership_id in (select id from public.memberships
   where tenant_id = :'tenant' and user_id::text like '65650000-0000-0000-0000-00000000000%');
delete from public.memberships
 where tenant_id = :'tenant' and user_id::text like '65650000-0000-0000-0000-00000000000%';
delete from public.employees where id in (:'e_petr', :'e_kolega', :'e_nikdo', :'e_pravo');
delete from public.position_permissions where position_id = :'z_ma';
delete from public.positions where id in (:'z_bez', :'z_ma');

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 65',
  not exists (select 1 from public.employees where full_name like '%Šedesátpět')
  and not exists (select 1 from public.shifts where note = 'krok65 own row')
  and not exists (select 1 from public.positions where key like 'krok65_%'));

\echo ''
\echo '== KROK 65 HOTOV ========================================='
