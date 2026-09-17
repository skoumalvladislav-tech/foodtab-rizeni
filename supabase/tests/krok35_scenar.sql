-- Scénář pro krok 35 — třístupňová priorita zpráv (NORMAL/IMPORTANT/URGENT).
--
-- Pokrývá migraci 20260917040000_priorita_zprav a noční zadání
-- "KOMUNIKACE / VZKAZY 2.0", bod 2 z doporučeného pořadí v
-- docs/hlaseni/komunikace-current-state-map-2026-09-17.md.
--
-- Navazuje na etapa0_scenar.sql až krok34_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- `priorita` je rozšíření, ne přepis (`nalehava` zůstává jako odvozený
-- sloupec). Past by byla, kdyby se odvození rozešlo: kdyby `important`
-- omylem obcházelo doručení mimo směnu stejně jako `urgent`, dostali by
-- lidé notifikace i mimo píchnutí za zprávu, která na to nemá právo —
-- přesně to, co `communication.urgent` hlídá. Druhá past je stará
-- signatura `poslat_zpravu(id, text, boolean)`: `CREATE OR REPLACE`
-- s přidaným parametrem musí zůstat TATÁŽ funkce, ne nová — jinak by
-- krok24_scenar.sql (starší, boolean volání) přestal fungovat.

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
-- Olda je v roli "kuchyně", která communication.urgent NEMÁ (ověřeno
-- krok22, oddíl 8) — přesně ten, na kom jde ukázat, že important
-- žádné právo nevyžaduje a urgent bez práva spadne.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('35350001-0000-0000-0000-000000000001', 'olda35@foodtab.cz', '{"full_name":"Olda Obyčejný"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '35350001-0000-0000-0000-000000000001', 'Olda Obyčejný', 'hpp');

select id as olda from public.employees where user_id = '35350001-0000-0000-0000-000000000001' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '35350001-0000-0000-0000-000000000001', :'role_kuchyne', 'branch', 'active');

select id as clen_olda from public.memberships
 where user_id = '35350001-0000-0000-0000-000000000001' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_olda', :'perla');

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Bez čtvrtého argumentu je priorita normal ============'

select set_config('test.user_id', '35350001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Priorita', null,
  array[:'sef']::uuid[]) as osobni \gset

select public.poslat_zpravu(:'osobni', 'Obyčejná zpráva.') as z_normal \gset

select pg_temp.check('priorita je normal',
  (select priorita from public.konverzace_zpravy where id = :'z_normal') = 'normal');
select pg_temp.check('nalehava je odvozené na false',
  (select nalehava from public.konverzace_zpravy where id = :'z_normal') = false);

reset role;
select set_config('test.osobni', :'osobni', false);


\echo ''
\echo '== 2. Important nevyžaduje communication.urgent ============'

select set_config('test.user_id', '35350001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('Olda nemá communication.urgent',
  not app.has_permission(:'tenant', 'communication.urgent'));

select public.poslat_zpravu(:'osobni', 'Důležitá zpráva.', false, 'important') as z_important \gset

select pg_temp.check('priorita je important',
  (select priorita from public.konverzace_zpravy where id = :'z_important') = 'important');
select pg_temp.check('nalehava zůstává false — important nebourá doručení',
  (select nalehava from public.konverzace_zpravy where id = :'z_important') = false);

reset role;


\echo ''
\echo '== 3. Urgent bez práva spadne =============================='

select set_config('test.user_id', '35350001-0000-0000-0000-000000000001', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.osobni')::uuid, 'Nemám na to právo.', false, 'urgent');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kuchyně poslala urgent bez práva'; end if;
  raise notice '  OK    kuchyně urgent bez práva nepošle';
end $$;

reset role;


\echo ''
\echo '== 4. Urgent s právem projde a notifikace ho nese =========='

-- Majitel má communication.urgent (má všechno z aktivních modulů,
-- stejně jako krok24 oddíl 3). Posílá Oldovi, ne naopak — notifikaci
-- kontrolujeme u PŘÍJEMCE.
select set_config('test.user_id', :'sef', false);
set role authenticated;

select public.poslat_zpravu(:'osobni', 'Zítra zavíráme dřív.', false, 'urgent') as z_urgent \gset

select pg_temp.check('priorita je urgent',
  (select priorita from public.konverzace_zpravy where id = :'z_urgent') = 'urgent');
select pg_temp.check('nalehava je odvozené na true',
  (select nalehava from public.konverzace_zpravy where id = :'z_urgent') = true);

reset role;

select set_config('test.user_id', '35350001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('Oldova notifikace o téhle zprávě má priorita = urgent',
  exists (
    select 1 from public.notifications
    where user_id = '35350001-0000-0000-0000-000000000001'::uuid
      and druh = 'vzkaz.novy'
      and priorita = 'urgent'
      and read_at is null
  ));

reset role;


\echo ''
\echo '== 5. Sloučení (coalescing) nese AKTUÁLNÍ prioritu, ne starou =='

-- Stejný den, stejný příjemce: app.upozornit_na_vzkaz_trg smaže
-- nepřečtenou notifikaci a založí novou (C4). Kdyby zůstala 'urgent'
-- ze zprávy výš, i když nová zpráva je jen normal, byl by odznak
-- trvale poplašný — přesně to, před čím noční zadání varuje (bod 36,
-- "nevytvářej notification spam").
select set_config('test.user_id', :'sef', false);
set role authenticated;

select public.poslat_zpravu(:'osobni', 'Ještě dodatek: otevíráme jako obvykle.') as z_dodatek \gset

select pg_temp.check('priorita dodatku je normal (výchozí)',
  (select priorita from public.konverzace_zpravy where id = :'z_dodatek') = 'normal');

reset role;

select set_config('test.user_id', '35350001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('po sloučení má Oldova jediná nepřečtená notifikace priorita = normal',
  (select count(*) from public.notifications
    where user_id = '35350001-0000-0000-0000-000000000001'::uuid
      and druh = 'vzkaz.novy' and read_at is null) = 1);
select pg_temp.check('a NENÍ to už urgent',
  not exists (
    select 1 from public.notifications
    where user_id = '35350001-0000-0000-0000-000000000001'::uuid
      and druh = 'vzkaz.novy'
      and priorita = 'urgent'
      and read_at is null
  ));

reset role;


\echo ''
\echo '== 6. Staré tříparametrové volání (boolean) funguje dál ===='

-- krok24_scenar.sql volá poslat_zpravu(id, text, true) bez čtvrtého
-- argumentu. CREATE OR REPLACE přidal parametr s výchozí hodnotou —
-- pořád TATÁŽ funkce, takže tohle musí projít beze změny.
select set_config('test.user_id', :'sef', false);
set role authenticated;

select public.poslat_zpravu(:'osobni', 'Staré volání, furt platí.', true) as z_stare \gset

select pg_temp.check('staré tříparametrové volání dá priorita = urgent',
  (select priorita from public.konverzace_zpravy where id = :'z_stare') = 'urgent');

reset role;


\echo ''
\echo '== 7. Neplatná priorita se odmítne ========================='

select set_config('test.user_id', :'sef', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.osobni')::uuid, 'Nesmysl.', false, 'kriticka');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neplatná priorita prošla'; end if;
  raise notice '  OK    neplatná priorita se odmítne';
end $$;

reset role;


\echo ''
\echo '== KROK 35 HOTOV ========================================'
