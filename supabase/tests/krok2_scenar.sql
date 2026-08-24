-- Scénář pro krok 2 — provozní tabulky. Navazuje na etapa0_scenar.sql,
-- který už založil firmu, dvě pobočky, majitele a vedoucího Perly.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

-- Zaměstnanci: majitel má účet, brigádník ne.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Jana Kuchařka', 'hpp')
returning id as jana \gset
select id as brigadnik from public.employees
where full_name = 'Občasná výpomoc' \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla',  :'perla',  false);
select set_config('test.bar',    :'bar',    false);

\echo ''
\echo '== Provozní den ==========================================='
-- Pobočka otevírá provozní den v 05:00 (výchozí hodnota).
select pg_temp.check('účet ve 2:15 patří do včerejší uzávěrky',
  app.business_date(:'perla', '2026-08-24 02:15+02'::timestamptz) = date '2026-08-23');
select pg_temp.check('účet v 10:00 patří do dnešní uzávěrky',
  app.business_date(:'perla', '2026-08-24 10:00+02'::timestamptz) = date '2026-08-24');

reset role;
update public.branches set day_starts_at = '03:00' where id = :'perla';
select pg_temp.check('posun otevírací doby změní zařazení',
  app.business_date(:'perla', '2026-08-24 02:15+02'::timestamptz) = date '2026-08-23'
  and app.business_date(:'perla', '2026-08-24 04:00+02'::timestamptz) = date '2026-08-24');
update public.branches set day_starts_at = '05:00' where id = :'perla';

\echo ''
\echo '== Směny a rozsah vedoucího ==============================='
set role authenticated;
-- Vedoucí Perly
select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'jana', date '2026-08-25', '14:00', '22:00');
select pg_temp.check('vedoucí naplánoval směnu na své pobočce',
  (select count(*) from public.shifts) = 1);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.shifts (tenant_id, branch_id, shift_date, starts_at, ends_at)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.bar')::uuid, date '2026-08-25', '14:00', '22:00');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: vedoucí plánoval na cizí pobočku'; end if;
  raise notice '  OK    vedoucí neplánuje na cizí pobočku';
end $$;

insert into public.shifts (tenant_id, branch_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', date '2026-08-26', '10:00', '18:00');
select pg_temp.check('neobsazená směna jde založit (employee_id prázdné)',
  exists (select 1 from public.shifts where employee_id is null));

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'brigadnik', date '2026-08-27', '18:00', '23:00');
select pg_temp.check('brigádníka bez účtu jde zařadit na směnu',
  exists (select 1 from public.shifts s
          join public.employees e on e.id = s.employee_id
          where e.user_id is null));

\echo ''
\echo '== Docházka ==============================================='
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'tenant', :'perla', :'jana', 'in', '2026-08-25 13:52+02');
select pg_temp.check('provozní den se doplnil sám',
  (select business_date from public.attendance_events limit 1) = date '2026-08-25');

\echo ''
\echo '== Checklist s hodnotou ==================================='
insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule)
values (:'tenant', :'perla', 'Otevírací checklist', 'kuchyne', 'opening')
returning id as tpl \gset

select set_config('test.tpl', :'tpl', false);

insert into public.checklist_items (template_id, position, label, requires_value, value_type, value_unit, max_value)
values (:'tpl', 1, 'Teplota lednice', true, 'number', '°C', 5);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.checklist_items (template_id, position, label, requires_value)
    values (current_setting('test.tpl')::uuid, 2, 'Bez typu hodnoty', true);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: položka vyžaduje hodnotu, ale nemá typ'; end if;
  raise notice '  OK    položka s hodnotou musí mít určený typ';
end $$;

\echo ''
\echo '== Komunikace napříč úrovněmi ============================='
reset role;
-- Firemní zprávu napíše majitel (rozsah tenant).
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into public.announcements (tenant_id, branch_id, body)
values (:'tenant', null, 'Zítra ve 14:00 porada vedoucích.');
insert into public.announcements (tenant_id, branch_id, body)
values (:'tenant', :'bar', 'Došel Bernard 12°, objednáno.');

select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);
select pg_temp.check('vedoucí Perly vidí firemní zprávu',
  exists (select 1 from public.announcements where branch_id is null));
select pg_temp.check('vedoucí Perly NEVIDÍ zprávu Baru',
  not exists (select 1 from public.announcements where branch_id = :'bar'));

\echo ''
\echo '== Jídelní lístek a ceny =================================='
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into public.menu_items (tenant_id, branch_id, menu_type, name, price_haleru, category)
values (:'tenant', :'perla', 'weekly', 'Svíčková na smetaně', 18900, 'Hlavní jídla');
select pg_temp.check('cena je v celých haléřích jako integer',
  (select price_haleru from public.menu_items) = 18900);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.menu_items (tenant_id, branch_id, menu_type, name, price_haleru)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.perla')::uuid, 'weekly', 'Záporná cena', -100);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prošla záporná cena'; end if;
  raise notice '  OK    záporná cena neprojde';
end $$;

\echo ''
\echo '== Motivace a body ========================================'
insert into public.praises (tenant_id, branch_id, employee_id, points, reason)
values (:'tenant', :'perla', :'jana', 50, 'Zvládla plný servis sama.');
insert into public.reward_items (tenant_id, label, points_cost)
values (:'tenant', 'Káva a dezert', 350) returning id as reward \gset

select pg_temp.check('body se spočítaly z pochval',
  (select points from public.employee_points where employee_id = :'jana') = 50);

insert into public.reward_claims (tenant_id, reward_item_id, employee_id, points_spent, status)
values (:'tenant', :'reward', :'jana', 20, 'approved');
select pg_temp.check('schválená odměna body odečte',
  (select points from public.employee_points where employee_id = :'jana') = 30);

\echo ''
\echo '== Cizí uživatel nevidí provoz ============================'
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
select pg_temp.check('cizí nevidí směny',      (select count(*) from public.shifts) = 0);
select pg_temp.check('cizí nevidí docházku',   (select count(*) from public.attendance_events) = 0);
select pg_temp.check('cizí nevidí zprávy',     (select count(*) from public.announcements) = 0);
select pg_temp.check('cizí nevidí lístek',     (select count(*) from public.menu_items) = 0);
select pg_temp.check('cizí nevidí pochvaly',   (select count(*) from public.praises) = 0);

\echo ''
\echo '=========================================================='
\echo ' KROK 2 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
