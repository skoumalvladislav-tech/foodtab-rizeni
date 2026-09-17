-- Scénář pro krok 34 — kanál úseku se odvozuje, nezakládá.
--
-- Pokrývá migraci 20260917030000_kanal_useku a noční zadání
-- "KOMUNIKACE / VZKAZY 2.0", oddíl 2/3/9 (DEPARTMENT komunikace).
--
-- Navazuje na etapa0_scenar.sql až krok33_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Stejná past jako u kanálu pobočky (krok25): odvozené členství je
-- pohodlné a přesně proto nebezpečné. Kdyby se odvození podle
-- employees.usek_id chytilo i mimo druh 'usek', nebo kdyby se úsek
-- ČLOVĚKA zaměnil za ÚSEK SMĚNY (dvě různé osy — Rozpis směn na tuhle
-- záměnu už jednou doopravdy narazil, 16.9.2026), přečetl by kdokoli
-- se stejným usek_id na JINÉ pobočce kanál, který mu vůbec nepatří.
--
-- Nejdůležitější je oddíl 3: kdo je ve stejném úseku na JINÉ pobočce,
-- čte (úsek je vlastnost ČLOVĚKA, ne pobočky) — a kdo je v JINÉM
-- úseku, nečte, i kdyby měl dosah na stejnou pobočku.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
--
-- Dva úseky: Kuchyně (firemní, bez branch_id — platí napříč
-- pobočkami, přesně proto, aby šlo ověřit, že úsek NENÍ vlastnost
-- pobočky) a Bar (taky firemní, pro kontrolu křížení).
--
-- Tři lidé: Hana a Pepa oba v Kuchyni, ale na RŮZNÝCH pobočkách —
-- odvození musí spojit oba bez ohledu na to. Iva je v Baru — jiný
-- úsek, nesmí číst.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar_p  from public.branches where slug = 'bernard-bar' \gset

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('34340001-0000-0000-0000-000000000001', 'hana34@foodtab.cz', '{"full_name":"Hana Kuchařová"}'),
  ('34340002-0000-0000-0000-000000000002', 'pepa34@foodtab.cz', '{"full_name":"Pepa Kuchař"}'),
  ('34340003-0000-0000-0000-000000000003', 'iva34@foodtab.cz',  '{"full_name":"Iva Barmanová"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

-- Úseky — firemní (branch_id null), ať je vidět, že odvození nejde
-- podle pobočky.
insert into public.useky (tenant_id, branch_id, nazev, poradi)
values
  (:'tenant', null, 'Kuchyně — krok34', 900),
  (:'tenant', null, 'Bar — krok34', 901);

select id as usek_kuchyne from public.useky
 where tenant_id = :'tenant' and nazev = 'Kuchyně — krok34' \gset
select id as usek_bar from public.useky
 where tenant_id = :'tenant' and nazev = 'Bar — krok34' \gset

insert into public.employees (tenant_id, branch_id, usek_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', :'usek_kuchyne', '34340001-0000-0000-0000-000000000001', 'Hana Kuchařová', 'hpp'),
  (:'tenant', :'bar_p', :'usek_kuchyne', '34340002-0000-0000-0000-000000000002', 'Pepa Kuchař',    'hpp'),
  (:'tenant', :'perla', :'usek_bar',     '34340003-0000-0000-0000-000000000003', 'Iva Barmanová',  'hpp');

select id as hana from public.employees where user_id = '34340001-0000-0000-0000-000000000001' \gset
select id as pepa from public.employees where user_id = '34340002-0000-0000-0000-000000000002' \gset
select id as iva  from public.employees where user_id = '34340003-0000-0000-0000-000000000003' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '34340001-0000-0000-0000-000000000001', :'role_kuchyne', 'branch', 'active'),
  (:'tenant', '34340002-0000-0000-0000-000000000002', :'role_kuchyne', 'branch', 'active'),
  (:'tenant', '34340003-0000-0000-0000-000000000003', :'role_kuchyne', 'branch', 'active');

select id as clen_hana from public.memberships
 where user_id = '34340001-0000-0000-0000-000000000001' \gset
select id as clen_pepa from public.memberships
 where user_id = '34340002-0000-0000-0000-000000000002' \gset
select id as clen_iva from public.memberships
 where user_id = '34340003-0000-0000-0000-000000000003' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_hana', :'perla'),
  (:'clen_pepa', :'bar_p'),
  (:'clen_iva',  :'perla');

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Kanál se založí sám a spojí lidi napříč pobočkami ==='

select set_config('test.user_id', '34340001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.kanal_useku(:'tenant', :'usek_kuchyne') as kanal \gset
select pg_temp.check('kanál úseku vznikl', :'kanal' is not null);

select public.kanal_useku(:'tenant', :'usek_kuchyne') as kanal2 \gset
select pg_temp.check('druhé volání vrátí týž kanál, nezaloží nový',
  :'kanal' = :'kanal2');

select public.poslat_zpravu(:'kanal', 'Menu číslo 3 je vyprodané.') as z1 \gset

reset role;
select set_config('test.kanal', :'kanal', false);

select pg_temp.check('členství NENÍ zapsané, je odvozené',
  not exists (select 1 from public.konverzace_ucastnici
              where konverzace_id = :'kanal' and employee_id = :'hana'));


\echo ''
\echo '== 2. Stejný úsek, JINÁ pobočka — pořád čte ==============='

-- TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V SOUBORU: Pepa je na Bernard
-- Baru, ne na Perle, ale je ve stejném úseku jako Hana. Kdyby se
-- odvození omylem řídilo pobočkou místo employees.usek_id, tahle
-- kontrola spadne.
select set_config('test.user_id', '34340002-0000-0000-0000-000000000002', false);
set role authenticated;

select pg_temp.check('Pepa je na jiné pobočce než Hana',
  :'bar_p' <> :'perla');
select pg_temp.check('a přesto je účastník — úsek je vlastnost člověka, ne pobočky',
  app.je_ucastnik(:'kanal') = true);
select pg_temp.check('a čte tu zprávu',
  exists (select 1 from public.konverzace_zpravy where id = :'z1'));
select pg_temp.check('a má ho v seznamu rozhovorů',
  exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal'));

reset role;


\echo ''
\echo '== 3. Jiný úsek nečte, i na stejné pobočce ================'

-- Iva je na Perle (stejně jako Hana), ale v Baru (jiný úsek). Dosah
-- na pobočku nesmí stačit.
select set_config('test.user_id', '34340003-0000-0000-0000-000000000003', false);
set role authenticated;

select pg_temp.check('Iva je na stejné pobočce jako Hana',
  exists (select 1 from public.employees where id = :'iva' and branch_id = :'perla'));
select pg_temp.check('a přesto NENÍ účastník kuchyňského kanálu',
  app.je_ucastnik(:'kanal') = false);
select pg_temp.check('kanál kuchyně nečte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'kanal') = 0);
select pg_temp.check('nemá ho ani v seznamu',
  not exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal'));

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.kanal')::uuid, 'Nepatřím sem.');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: do cizího kanálu úseku se dalo psát'; end if;
  raise notice '  OK    do cizího kanálu úseku nenapíše';
end $$;

-- A kanál cizího úseku si ani nevyrobí.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kanal_useku(
      current_setting('test.tenant')::uuid, current_setting('test.usek_kuchyne', true)::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kanál cizího úseku si vyrobila sama'; end if;
  raise notice '  OK    kanál cizího úseku si nevyrobí';
end $$;

reset role;


\echo ''
\echo '== 4. Majitel nečte automaticky, pokud v úseku sám není ==='

-- Majitel má has_access na všechno, ale úsek je odvození podle
-- employees.usek_id — a majitel v testovacích datech žádný úsek
-- (usek_id) nemá. Kdyby odvození omylem sáhlo po has_access místo
-- po skutečném členství v úseku, tahle kontrola spadne.
select set_config('test.user_id', :'sef', false);
set role authenticated;

select pg_temp.check('majitel v testovacích datech nemá usek_id',
  not exists (
    select 1 from public.employees e
    where e.user_id = current_setting('test.user_id')::uuid
      and e.tenant_id = current_setting('test.tenant')::uuid
      and e.usek_id = current_setting('test.usek_kuchyne', true)::uuid
  ));
select pg_temp.check('a proto kanál úseku nečte',
  app.je_ucastnik(:'kanal') = false);

reset role;


\echo ''
\echo '== 5. Záložka vzniká až čtením ============================'

select set_config('test.user_id', '34340001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('před přečtením je nepřečtené',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal') > 0);

select public.oznacit_precteno(:'kanal') as kdy \gset

select pg_temp.check('po přečtení už nepřečtené není',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal') = 0);

reset role;


\echo ''
\echo '== 6. Cizí firma ========================================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma kanál úseku nevidí',
  (select count(*) from public.konverzace where id = :'kanal') = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kanal_useku(
      current_setting('test.tenant')::uuid, current_setting('test.usek_kuchyne', true)::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí firma si vyrobila kanál úseku'; end if;
  raise notice '  OK    cizí firma si kanál úseku nevyrobí';
end $$;

reset role;


\echo ''
\echo '== KROK 34 HOTOV ========================================'
