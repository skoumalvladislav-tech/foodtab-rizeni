-- Scénář pro krok 36 — uživatelské nastavení upozornění (vzkazy/nástěnka).
--
-- Pokrývá migraci 20260917050000_nastaveni_upozorneni a noční zadání
-- "KOMUNIKACE / VZKAZY 2.0", bod 4 z doporučeného pořadí v
-- docs/hlaseni/komunikace-current-state-map-2026-09-17.md.
--
-- Navazuje na etapa0_scenar.sql až krok35_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Past by byla, kdyby vypnutí kategorie tiše smazalo i JIŽ EXISTUJÍCÍ
-- nepřečtené upozornění — člověk by přišel o něco, co mu už dorazilo
-- právem. Vypnutí smí zabránit jen NOVÉMU založení, ne sáhnout na
-- minulost. Druhá past, ta nejdůležitější: "změny směn se nedají
-- vypnout" musí být VYNUCENÉ, ne jen "checkbox v UI chybí" — ověřuje
-- se přímo na CHECK constraintu tabulky, ne na tom, že se obrazovka
-- nedovolí otevřít.

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
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as sef from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as sef_emp from public.employees
 where tenant_id = :'tenant' and user_id = :'sef' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('36360001-0000-0000-0000-000000000001', 'nora36@foodtab.cz', '{"full_name":"Nora Nová"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '36360001-0000-0000-0000-000000000001', 'Nora Nová', 'hpp');

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '36360001-0000-0000-0000-000000000001', :'role_kuchyne', 'branch', 'active');

select id as clen_nora from public.memberships
 where user_id = '36360001-0000-0000-0000-000000000001' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_nora', :'perla');

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Bez řádku je kategorie povolená (výchozí zapnuto) ====='

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Nastaveni', null,
  array[:'sef_emp']::uuid[]) as osobni \gset

select pg_temp.check('Nora zatím nemá žádný řádek nastavení',
  not exists (select 1 from public.notification_preferences
              where user_id = '36360001-0000-0000-0000-000000000001'::uuid));

reset role;
select set_config('test.osobni', :'osobni', false);

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.poslat_zpravu(:'osobni', 'První zpráva.') as z1 \gset
reset role;

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select id as notif1 from public.notifications
 where user_id = '36360001-0000-0000-0000-000000000001'::uuid
   and druh = 'vzkaz.novy' and read_at is null \gset

select pg_temp.check('bez nastavení dorazí upozornění na vzkaz',
  :'notif1' is not null);

reset role;


\echo ''
\echo '== 2. Vypnutí vzkazů zastaví NOVÉ, ale nesahá na staré ======'

-- Nora si vzkazy vypne — přímý zápis, RLS pustí jen vlastní řádek
-- (přesně to, co dělá /upozorneni/nastaveni).
select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', '36360001-0000-0000-0000-000000000001', 'vzkazy', false);

reset role;

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.poslat_zpravu(:'osobni', 'Druhá zpráva, po vypnutí.') as z2 \gset
reset role;

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('stará nepřečtená notifikace pořád existuje se stejným id',
  exists (select 1 from public.notifications
          where id = :'notif1'::uuid and read_at is null));
select pg_temp.check('a je jediná — druhá zpráva žádnou novou nezaložila',
  (select count(*) from public.notifications
    where user_id = '36360001-0000-0000-0000-000000000001'::uuid
      and druh = 'vzkaz.novy' and read_at is null) = 1);

reset role;


\echo ''
\echo '== 3. Zapnutí zpátky obnoví upozorňování ====================='

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

update public.notification_preferences
   set povoleno = true, updated_at = now()
 where tenant_id = :'tenant'
   and user_id = '36360001-0000-0000-0000-000000000001'::uuid
   and kategorie = 'vzkazy';

reset role;

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.poslat_zpravu(:'osobni', 'Třetí zpráva, po zapnutí.') as z3 \gset
reset role;

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('po zapnutí zase dorazí upozornění (sloučení dalo NOVÉ id)',
  exists (select 1 from public.notifications
          where user_id = '36360001-0000-0000-0000-000000000001'::uuid
            and druh = 'vzkaz.novy' and read_at is null
            and id <> :'notif1'::uuid));

reset role;


\echo ''
\echo '== 4. Totéž pro nástěnku, nezávisle na vzkazech =============='

select set_config('test.user_id', :'sef', false);
set role authenticated;
insert into public.announcements (tenant_id, branch_id, body)
values (:'tenant', :'perla', 'Zítra sanitární den.');
reset role;

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select id as onotif1 from public.notifications
 where user_id = '36360001-0000-0000-0000-000000000001'::uuid
   and druh = 'oznameni.nova' and read_at is null \gset

select pg_temp.check('bez nastavení dorazí upozornění na nástěnku',
  :'onotif1' is not null);

insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', '36360001-0000-0000-0000-000000000001', 'nastenka', false);

reset role;

select set_config('test.user_id', :'sef', false);
set role authenticated;
insert into public.announcements (tenant_id, branch_id, body)
values (:'tenant', :'perla', 'Druhé oznámení, po vypnutí.');
reset role;

select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.check('vypnutí nástěnky se vzkazů netýká (ty jsou zapnuté z kroku 3)',
  exists (select 1 from public.notifications
          where user_id = '36360001-0000-0000-0000-000000000001'::uuid
            and druh = 'vzkaz.novy' and read_at is null));
select pg_temp.check('stará nástěnková notifikace zůstává, nová nepřibyla',
  (select count(*) from public.notifications
    where user_id = '36360001-0000-0000-0000-000000000001'::uuid
      and druh = 'oznameni.nova' and read_at is null) = 1
  and exists (select 1 from public.notifications
              where id = :'onotif1'::uuid and read_at is null));

reset role;


\echo ''
\echo '== 5. Směny se vůbec nedají zapsat jako kategorie ============'

-- Strukturální pojistka, ne jen UI bez zaškrtávátka — CHECK constraint
-- na tabulce zná jen 'vzkazy' a 'nastenka'. Kdyby tenhle insert prošel,
-- znamenalo by to, že se dá založit vypínatelná kategorie pro směny.
select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
    values (
      current_setting('test.tenant')::uuid,
      '36360001-0000-0000-0000-000000000001'::uuid,
      'smena',
      false
    );
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kategorie smena se dala založit'; end if;
  raise notice '  OK    kategorie "smena" neexistuje, CHECK ji odmítne';
end $$;

reset role;


\echo ''
\echo '== 6. Cizí nastavení nevidí ani nezapíše ======================'

select set_config('test.user_id', :'sef', false);
set role authenticated;

select pg_temp.check('majitel Nořino nastavení nevidí',
  not exists (select 1 from public.notification_preferences
              where user_id = '36360001-0000-0000-0000-000000000001'::uuid));

do $$
declare v_pocet int;
begin
  update public.notification_preferences
     set povoleno = true
   where user_id = '36360001-0000-0000-0000-000000000001'::uuid;
  get diagnostics v_pocet = row_count;
  if v_pocet <> 0 then
    raise exception 'SELHALO: majitel přepsal cizí nastavení (% řádků)', v_pocet;
  end if;
  raise notice '  OK    majitel cizí nastavení nepřepíše (RLS, 0 řádků)';
end $$;

reset role;


\echo ''
\echo '== 7. Oznámení pro úsek/pozici cílí jen tam, ne na celou pobočku'

/*
  Přidáno DODATEČNĚ (multi-agentní revize): app.upozornit_na_oznameni_trg
  se v týhle migraci přepisoval jen kvůli přidání app.upozorneni_povoleno
  filtru — a přepsal se z tříbranžové verze (20260913110000), ne
  z aktuální pětibranžové (20260913160000_nastenka_adresat.sql,
  employee_id > usek_id > position_id > branch_id > firma). Oznámení
  pro úsek by tak omylem notifikovalo CELOU pobočku nebo CELOU firmu.
  Bez tohodle oddílu by to krok36 neodhalil — dosavadní oddíly testují
  jen pobočku a celou firmu.
*/

-- Nora měla nástěnku vypnutou od oddílu 4 (jinak by test testoval
-- filtr preferencí, ne adresování) — zapnout zpátky, ať oddíl 7
-- ověří jen usek_id/position_id, ne kombinaci obojího.
select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;
update public.notification_preferences
   set povoleno = true, updated_at = now()
 where tenant_id = :'tenant'
   and user_id = '36360001-0000-0000-0000-000000000001'::uuid
   and kategorie = 'nastenka';
select id as nora from public.employees
 where user_id = '36360001-0000-0000-0000-000000000001'::uuid \gset
reset role;

insert into public.useky (tenant_id, branch_id, nazev, poradi) values
  (:'tenant', null, 'Kuchyně — krok36', 910),
  (:'tenant', null, 'Bar — krok36', 911);

select id as usek_kuchyne36 from public.useky
 where tenant_id = :'tenant' and nazev = 'Kuchyně — krok36' \gset
select id as usek_bar36 from public.useky
 where tenant_id = :'tenant' and nazev = 'Bar — krok36' \gset

update public.employees set usek_id = :'usek_kuchyne36' where id = :'nora';

insert into auth.users (id, email, raw_user_meta_data) values
  ('36360002-0000-0000-0000-000000000002', 'olda36@foodtab.cz', '{"full_name":"Olda Barman"}');

insert into public.employees (tenant_id, branch_id, usek_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', :'usek_bar36', '36360002-0000-0000-0000-000000000002', 'Olda Barman', 'hpp');

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '36360002-0000-0000-0000-000000000002', :'role_kuchyne', 'branch', 'active');

select id as clen_olda36 from public.memberships
 where user_id = '36360002-0000-0000-0000-000000000002' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_olda36', :'perla');

-- Majitel pošle oznámení pro úsek Kuchyně — Olda je na STEJNÉ pobočce
-- (Perla), ale v JINÉM úseku (Bar), takže nesmí dostat nic. Kdyby
-- se trigger vrátil ke třem větvím, chytil by se na "branch_id sedí"
-- (protože se u úsekového cíle branch_id nevyplňuje) nebo na "firma".
select set_config('test.user_id', :'sef', false);
set role authenticated;
insert into public.announcements (tenant_id, usek_id, body)
values (:'tenant', :'usek_kuchyne36', 'Kuchyně, zítra revize hasicích přístrojů.');
reset role;

-- Kontroluje se přes NOVÉ id, ne holý exists — Nora má z oddílu 4
-- pořád nepřečtenou starou nástěnkovou notifikaci (onotif1) a holý
-- exists by prošel, i kdyby tohle oznámení nedorazilo vůbec. Sloučení
-- (stejný den/druh) tu navíc funguje ve prospěch testu: starou
-- notifikaci smaže a založí novou s jiným id.
select set_config('test.user_id', '36360001-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.check('Nora (úsek Kuchyně) oznámení pro Kuchyni dostane (nové id, ne staré onotif1)',
  exists (select 1 from public.notifications
          where user_id = '36360001-0000-0000-0000-000000000001'::uuid
            and druh = 'oznameni.nova' and read_at is null
            and id <> :'onotif1'::uuid));
reset role;

select set_config('test.user_id', '36360002-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.check('Olda (úsek Bar, stejná pobočka) oznámení pro Kuchyni NEDOSTANE',
  not exists (select 1 from public.notifications
              where user_id = '36360002-0000-0000-0000-000000000002'::uuid
                and druh = 'oznameni.nova' and read_at is null));
reset role;


\echo ''
\echo '== KROK 36 HOTOV ========================================'
