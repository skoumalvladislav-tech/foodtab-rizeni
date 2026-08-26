-- Scénářový test etapy 0. Ověřuje bezpečnostní vlastnosti, ne jen to,
-- že migrace projdou.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'majitel@foodtab.cz', '{"full_name":"Vladislav Skoumal"}'),
  ('22222222-2222-2222-2222-222222222222', 'vedouci@foodtab.cz', '{"full_name":"Klára Veselá"}'),
  ('33333333-3333-3333-3333-333333333333', 'cizi@jinafirma.cz',  '{"full_name":"Cizí Člověk"}');
insert into auth.users (id, phone, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', '+420601234567', '{"full_name":"Tomáš Brigádník"}');

\echo ''
\echo '== Profily ==============================================='
select pg_temp.check('profil vzniká automaticky při registraci',
  (select count(*) from public.profiles) = 4);
select pg_temp.check('profil jde založit i jen s telefonem',
  exists (select 1 from public.profiles where phone = '+420601234567' and email is null));

\echo ''
\echo '== Založení firmy ========================================'
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select app.create_tenant('Foodtab s.r.o.', '12345678') as tenant \gset
select set_config('test.tenant', :'tenant', false);

reset role;
select pg_temp.check('firma vznikla', (select count(*) from public.tenants) = 1);
select pg_temp.check('základní modul se zapnul sám',
  exists (select 1 from public.tenant_modules where module_key = 'provoz' and status = 'active'));
select pg_temp.check('volitelné moduly zapnuté nejsou',
  (select count(*) from public.tenant_modules) = 1);
select pg_temp.check('role vznikly ze šablon (7)',
  (select count(*) from public.roles where tenant_id = :'tenant') = 7);
select pg_temp.check('majitel má členství s rozsahem celé firmy',
  exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
          where m.user_id = '11111111-1111-1111-1111-111111111111'
            and m.scope = 'tenant' and r.is_owner));
select pg_temp.check('majitel má i zaměstnanecký záznam',
  exists (select 1 from public.employees where user_id = '11111111-1111-1111-1111-111111111111'));
select pg_temp.check('založení firmy je v auditu',
  exists (select 1 from public.audit_log where action = 'tenant.create'));

\echo ''
\echo '== Pobočky ==============================================='
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into public.branches (tenant_id, name, slug) values
  (:'tenant', 'Restaurace Černá Perla', 'cerna-perla'),
  (:'tenant', 'Bernard Bar Tábor', 'bernard-bar');
select id as perla from public.branches where slug = 'cerna-perla' \gset
select id as bar   from public.branches where slug = 'bernard-bar' \gset

select pg_temp.check('majitel založil dvě pobočky',
  (select count(*) from public.branches) = 2);
select pg_temp.check('majitel vidí obě pobočky',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 2);

\echo ''
\echo '== Oprávnění a moduly ===================================='
select pg_temp.check('majitel smí plánovat směny na Perle',
  app.has_access(:'tenant', 'shifts.manage', :'perla'));
select pg_temp.check('majitel NEMÁ finance — modul není zaplacený',
  not app.has_access(:'tenant', 'finance.read'));

reset role;
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'finance');
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('po zapnutí modulu má majitel finance',
  app.has_access(:'tenant', 'finance.read'));

\echo ''
\echo '== Pozvánky =============================================='
select id as role_vedouci from public.roles where tenant_id = :'tenant' and key = 'vedouci_smeny' \gset
select id as role_majitel from public.roles where tenant_id = :'tenant' and key = 'majitel' \gset
select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset
select set_config('test.role_majitel', :'role_majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.create_invitation(current_setting('test.tenant')::uuid,
      current_setting('test.role_majitel')::uuid, 'sms', '+420601234567');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: citlivá role šla pozvat přes SMS'; end if;
  raise notice '  OK    citlivá role přes SMS je odmítnutá';
end $$;

select token as sms_token from app.create_invitation(
  :'tenant', :'role_kuchyne', 'sms', '+420601234567') \gset
select pg_temp.check('nekritická role přes SMS projde', length(:'sms_token') = 64);

select token as inv_token from app.create_invitation(
  :'tenant', :'role_vedouci', 'email', 'vedouci@foodtab.cz',
  'branch', array[:'perla']::uuid[]) \gset
select set_config('test.inv_token', :'inv_token', false);

reset role;
select pg_temp.check('v databázi je jen otisk, ne token',
  not exists (select 1 from public.invitations where token_hash = :'inv_token'));

set role authenticated;
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
do $$
declare v_ok boolean := false;
begin
  begin perform app.accept_invitation(current_setting('test.inv_token'));
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'SELHALO: cizí účet přijal cizí pozvánku'; end if;
  raise notice '  OK    cizí účet pozvánku nepřijme';
end $$;

select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);
select app.accept_invitation(:'inv_token') as accepted \gset
select pg_temp.check('vedoucí přijal pozvánku', :'accepted' = :'tenant');

do $$
declare v_ok boolean := false;
begin
  begin perform app.accept_invitation(current_setting('test.inv_token'));
  exception when invalid_parameter_value then v_ok := true; end;
  if not v_ok then raise exception 'SELHALO: pozvánka šla použít dvakrát'; end if;
  raise notice '  OK    pozvánka je jednorázová';
end $$;

\echo ''
\echo '== Rozsah vedoucího pobočky =============================='
select pg_temp.check('vedoucí vidí jen svou pobočku',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 1);
select pg_temp.check('vedoucí plánuje směny na své pobočce',
  app.has_access(:'tenant', 'shifts.manage', :'perla'));
select pg_temp.check('vedoucí NEPLÁNUJE směny na cizí pobočce',
  not app.has_access(:'tenant', 'shifts.manage', :'bar'));
select pg_temp.check('vedoucí nevidí firemní úroveň',
  not app.has_access(:'tenant', 'shifts.manage', null));
select pg_temp.check('vedoucí nevidí finance ani se zapnutým modulem',
  not app.has_access(:'tenant', 'finance.read'));
select pg_temp.check('vedoucí nesmí do nastavení',
  not app.has_access(:'tenant', 'settings.manage'));
select pg_temp.check('RLS: vedoucí vidí v tabulce jen jednu pobočku',
  (select count(*) from public.branches) = 1);

\echo ''
\echo '== Cizí uživatel ========================================='
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
select pg_temp.check('cizí uživatel nevidí žádnou firmu',
  (select count(*) from public.tenants) = 0);
select pg_temp.check('cizí uživatel nevidí žádnou pobočku',
  (select count(*) from public.branches) = 0);
select pg_temp.check('cizí uživatel nevidí zaměstnance',
  (select count(*) from public.employees) = 0);
select pg_temp.check('cizí uživatel nevidí audit',
  (select count(*) from public.audit_log) = 0);

\echo ''
\echo '== Zaměstnanec bez účtu =================================='
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Občasná výpomoc', 'dpp');
select pg_temp.check('brigádník bez účtu jde založit a plánovat',
  exists (select 1 from public.employees
          where full_name = 'Občasná výpomoc' and user_id is null));

\echo ''
\echo '== Neměnnost a ochrany ==================================='
reset role;
select count(*) as audit_pred from public.audit_log \gset
update public.audit_log set action = 'podvrh';
delete from public.audit_log;
select pg_temp.check('audit nejde změnit ani smazat',
  (select count(*) from public.audit_log) = :audit_pred
  and not exists (select 1 from public.audit_log where action = 'podvrh'));

do $$
declare v_ok boolean := false;
begin
  begin update public.tenant_modules set status = 'suspended' where module_key = 'provoz';
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'SELHALO: základní modul šlo vypnout'; end if;
  raise notice '  OK    základní modul nejde vypnout';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin delete from public.tenant_modules where module_key = 'provoz';
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'SELHALO: základní modul šlo smazat'; end if;
  raise notice '  OK    základní modul nejde smazat';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.roles (tenant_id, key, label, is_owner)
    values (current_setting('test.tenant')::uuid, 'druhy_majitel', 'Druhý majitel', true);
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'SELHALO: firma měla dva vlastníky'; end if;
  raise notice '  OK    firma má právě jednoho vlastníka';
end $$;

\echo ''
\echo '=========================================================='
\echo ' VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
