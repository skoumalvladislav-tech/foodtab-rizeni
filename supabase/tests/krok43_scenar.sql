-- Scénář pro krok 43 — Provozní centrum (etapa 2): zpráva → úkol, výběr
-- příjemců, systémové události, idempotentní odeslání.
--
-- Pokrývá migraci 20260921110000_provozni_centrum.
--
-- Navazuje na etapa0_scenar.sql až krok42_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Všechno tady jsou definer funkce, uvnitř kterých neplatí RLS. Proto se
-- u každé zkouší SKUTEČNĚ CIZÍ zpráva z jiné firmy (ne jen náhodné id) a
-- člověk, který je ve firmě, ale do rozhovoru nepatří — právě tam, kde
-- by chybějící filtr nebyl vidět jinak než únikem.
--
-- Kontroly nejsou postavené na čtení pod rolí (`set role authenticated`
-- na superuživateli PGlite nic nedělá), ale na výsledku v tabulkách
-- a na chybách, které funkce sama vyhodí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Zavolá SQL a vrátí, jestli spadlo s daným SQLSTATE.
create or replace function pg_temp.spadne(p_sql text, p_stav text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav;
end $$;

create or replace function pg_temp.pocet(p_user uuid, p_druh text)
returns integer language sql as $$
  select count(*)::integer from public.notifications
   where user_id = p_user and druh = p_druh and read_at is null
$$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as sef from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as sef_emp from public.employees where tenant_id = :'tenant' and user_id = :'sef' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('43430000-0000-0000-0000-00000000000a', 'anna43@foodtab.cz',  '{"full_name":"Anna Čtyřicettři"}'),
  ('43430000-0000-0000-0000-00000000000b', 'borek43@foodtab.cz', '{"full_name":"Bořek Čtyřicettři"}'),
  ('43430000-0000-0000-0000-00000000000c', 'cyril43@foodtab.cz', '{"full_name":"Cyril Čtyřicettři"}'),
  ('43430000-0000-0000-0000-00000000000d', 'dana43@foodtab.cz',  '{"full_name":"Dana Čtyřicettři"}'),
  ('43430000-0000-0000-0000-00000000000e', 'petr43@foodtab.cz',  '{"full_name":"Petr Čtyřicettři"}'),
  ('43430000-0000-0000-0000-00000000000f', 'hugo43@foodtab.cz',  '{"full_name":"Hugo Smazaný"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.useky (tenant_id, branch_id, nazev, poradi) values
  (:'tenant', null, 'Kuchyně — krok43', 930);
select id as usek_k from public.useky where tenant_id = :'tenant' and nazev = 'Kuchyně — krok43' \gset

-- Anna, Bořek: Perla + Kuchyně. Cyril: Bar. Dana: Perla i Bar (střídá).
-- Petr: Perla, bez oprávnění (běžný zaměstnanec). Hugo: smazaný.
insert into public.employees (tenant_id, branch_id, usek_id, user_id, full_name, employment_type, deleted_at) values
  (:'tenant', :'perla', :'usek_k', '43430000-0000-0000-0000-00000000000a', 'Anna Čtyřicettři',  'hpp', null),
  (:'tenant', :'perla', :'usek_k', '43430000-0000-0000-0000-00000000000b', 'Bořek Čtyřicettři', 'hpp', null),
  -- Cyril je také v Kuchyni (úsek je firemní), jen na jiné pobočce — na něm
  -- se pozná, že úkol pro úsek na pobočce nepípá kuchařům z jiné pobočky.
  (:'tenant', :'bar',   :'usek_k', '43430000-0000-0000-0000-00000000000c', 'Cyril Čtyřicettři', 'hpp', null),
  (:'tenant', :'perla', null,      '43430000-0000-0000-0000-00000000000d', 'Dana Čtyřicettři',  'hpp', null),
  (:'tenant', :'perla', null,      '43430000-0000-0000-0000-00000000000e', 'Petr Čtyřicettři',  'hpp', null),
  (:'tenant', :'perla', null,      '43430000-0000-0000-0000-00000000000f', 'Hugo Smazaný',      'hpp', now());
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bez Účtu Čtyřicettři', 'hpp')
returning id as bez_uctu \gset

select id as anna  from public.employees where user_id = '43430000-0000-0000-0000-00000000000a' \gset
select id as borek from public.employees where user_id = '43430000-0000-0000-0000-00000000000b' \gset
select id as cyril from public.employees where user_id = '43430000-0000-0000-0000-00000000000c' \gset
select id as dana  from public.employees where user_id = '43430000-0000-0000-0000-00000000000d' \gset
select id as petr  from public.employees where user_id = '43430000-0000-0000-0000-00000000000e' \gset
select id as hugo  from public.employees where user_id = '43430000-0000-0000-0000-00000000000f' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
select :'tenant', u, :'role_kuchyne', 'branch', 'active'
from (values
  ('43430000-0000-0000-0000-00000000000a'::uuid),
  ('43430000-0000-0000-0000-00000000000b'::uuid),
  ('43430000-0000-0000-0000-00000000000c'::uuid),
  ('43430000-0000-0000-0000-00000000000d'::uuid),
  ('43430000-0000-0000-0000-00000000000e'::uuid)
) t(u);

-- Domovská pobočka + rozsah členství: Anna, Bořek, Petr = Perla; Cyril = Bar;
-- Dana = Perla i Bar.
insert into public.membership_branches (membership_id, branch_id)
select m.id, x.b
  from public.memberships m
  join (values
    ('43430000-0000-0000-0000-00000000000a'::uuid, :'perla'::uuid),
    ('43430000-0000-0000-0000-00000000000b'::uuid, :'perla'::uuid),
    ('43430000-0000-0000-0000-00000000000c'::uuid, :'bar'::uuid),
    ('43430000-0000-0000-0000-00000000000d'::uuid, :'perla'::uuid),
    ('43430000-0000-0000-0000-00000000000d'::uuid, :'bar'::uuid),
    ('43430000-0000-0000-0000-00000000000e'::uuid, :'perla'::uuid)
  ) x(u, b) on x.u = m.user_id
 where m.tenant_id = :'tenant';

-- Cizí firma se zprávou, ke které nemá nikdo z naší firmy přístup.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok43 Cizí s.r.o.', 'Krok43 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
-- Cizí zaměstnanec MÁ účet (cizi@jinafirma.cz z etapa0). Bez účtu by ho
-- z nabídky vyřadila podmínka na účet, ne filtr firmy, a schválné rozbití
-- filtru firmy by neprošlo (nalezeno mutační zkouškou).
insert into public.employees (tenant_id, user_id, full_name, employment_type)
values (:'cizi_firma', (select user_id from public.profiles where email = 'cizi@jinafirma.cz'),
        'Cizí Zaměstnanec Krok43', 'hpp')
returning id as cizi_emp \gset
insert into public.konverzace (tenant_id, druh, nazev)
values (:'cizi_firma', 'osobni', 'Cizí rozhovor krok43')
returning id as cizi_konv \gset
insert into public.konverzace_zpravy (konverzace_id, tenant_id, text)
values (:'cizi_konv', :'cizi_firma', 'Cizí zpráva krok43')
returning id as cizi_zprava \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog: podpisy a práva ============================='

select pg_temp.check('poslat_zpravu má právě JEDEN podpis (starý šestiparametrový je pryč)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'poslat_zpravu') = 1
  and to_regprocedure('public.poslat_zpravu(uuid, text, boolean, text, text, integer)') is null
  and to_regprocedure('public.poslat_zpravu(uuid, text, boolean, text, text, integer, uuid)') is not null);

select pg_temp.check('zalozit_ukol_ze_zpravy smí přihlášený, ne anon',
  has_function_privilege('authenticated',
    'public.zalozit_ukol_ze_zpravy(uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)',
    'execute')
  and not has_function_privilege('anon',
    'public.zalozit_ukol_ze_zpravy(uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)',
    'execute'));

select pg_temp.check('komu_muzu_psat smí přihlášený, ne anon',
  has_function_privilege('authenticated', 'public.komu_muzu_psat(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.komu_muzu_psat(uuid)', 'execute'));


\echo ''
\echo '== 2. Idempotentní odeslání (klientské id) ================='

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Krok43 hlavní', null,
  array[:'anna', :'borek']::uuid[]) as konv \gset
reset role;

select set_config('test.user_id', '43430000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.poslat_zpravu(:'konv', 'Krok43: objednej mrkev.', false, null, null, null,
  '43431111-0000-0000-0000-000000000001') as m1 \gset
select public.poslat_zpravu(:'konv', 'Krok43: objednej mrkev.', false, null, null, null,
  '43431111-0000-0000-0000-000000000001') as m1_znovu \gset
select public.poslat_zpravu(:'konv', 'Krok43: druhá zpráva.', false, null, null, null,
  '43431111-0000-0000-0000-000000000002') as m2 \gset
select public.poslat_zpravu(:'konv', 'Krok43: bez klíče.') as m3 \gset
select public.poslat_zpravu(:'konv', 'Krok43: bez klíče.') as m4 \gset
reset role;

select pg_temp.check('opakované odeslání téhož klientského id vrátí PŮVODNÍ zprávu',
  :'m1' = :'m1_znovu');
select pg_temp.check('… a v rozhovoru je jen jedna taková zpráva',
  (select count(*) from public.konverzace_zpravy
    where konverzace_id = :'konv' and klient_id = '43431111-0000-0000-0000-000000000001') = 1);
select pg_temp.check('jiné klientské id = nová zpráva',
  :'m2' <> :'m1' and (select count(*) from public.konverzace_zpravy
                       where konverzace_id = :'konv' and klient_id is not null) = 2);
select pg_temp.check('bez klientského id se neslučuje (dvě stejné zprávy jsou dvě zprávy)',
  :'m3' <> :'m4');
select pg_temp.check('opakování nevyrobilo druhé upozornění: Bořek má 1 upozornění se 4 zprávami (m1, m2, m3, m4)',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 1
  and (select coalesce((telo->>'pocet')::integer, 1) from public.notifications
        where user_id = '43430000-0000-0000-0000-00000000000b' and druh = 'vzkaz.novy' and read_at is null) = 4);

-- Klíč nesmí prozradit cizí zprávy: kdo v rozhovoru není, dostane chybu,
-- ne původní id.
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000c', false);
select pg_temp.check('nezúčastněný Cyril se stejným klíčem chybu (ne id cizí zprávy)',
  pg_temp.spadne(format($q$select public.poslat_zpravu(%L::uuid, 'x', false, null, null, null,
    '43431111-0000-0000-0000-000000000001')$q$, :'konv'), '42501'));


\echo ''
\echo '== 3. Zpráva → úkol ======================================='

-- sef (tasks.manage) je v rozhovoru; zakládá úkol Anně ze Aniny zprávy.
select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.zalozit_ukol_ze_zpravy(
  :'tenant', :'m1', :'perla', 'Objednat mrkev', 'Na pátek do kuchyně.',
  timestamp '2026-11-13 12:00', 'high', null, null, :'anna') as ukol \gset
reset role;

select pg_temp.check('úkol vznikl a nese vazbu na zprávu a rozhovor',
  (select zprava_id = :'m1' and konverzace_id = :'konv' and zdroj = 'zprava'
          and title = 'Objednat mrkev' and employee_id = :'anna' and status = 'open'
     from public.tasks where id = :'ukol'));

select pg_temp.check('do rozhovoru přibyla systémová událost s odkazem na úkol',
  exists (select 1 from public.konverzace_zpravy
           where konverzace_id = :'konv' and typ = 'system'
             and objekt_typ = 'ukol' and objekt_id = :'ukol'
             and autor = :'sef_emp' and text like 'Vytvořen úkol: Objednat mrkev%'));

select pg_temp.check('systémová událost nikoho nepípá: Bořek má pořád 1 upozornění a 4 zprávy',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 1
  and (select coalesce((telo->>'pocet')::integer, 1) from public.notifications
        where user_id = '43430000-0000-0000-0000-00000000000b' and druh = 'vzkaz.novy' and read_at is null) = 4);

select pg_temp.check('přidělenému (Anna) přišlo PŘESNĚ JEDNO upozornění ukol.pridelen',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000a', 'ukol.pridelen') = 1);
select pg_temp.check('… s názvem úkolu a důležitostí (high = important)',
  (select telo->>'nazev' = 'Objednat mrkev' and priorita = 'important'
          and zdroj_typ = 'ukol' and zdroj_id = :'ukol'
     from public.notifications
    where user_id = '43430000-0000-0000-0000-00000000000a' and druh = 'ukol.pridelen'));
select pg_temp.check('… a s termínem v pásmu pobočky',
  (select telo->>'termin' from public.notifications
    where user_id = '43430000-0000-0000-0000-00000000000a' and druh = 'ukol.pridelen')
  = '2026-11-13T12:00');
select pg_temp.check('zadavatel si upozornění o vlastním úkolu nezakládá',
  pg_temp.pocet(:'sef', 'ukol.pridelen') = 0);
select pg_temp.check('nezúčastněný Petr o úkolu upozornění nedostal',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000e', 'ukol.pridelen') = 0);

select pg_temp.check('v auditu je odkaz na rozhovor a zprávu, ale NE text ani název',
  exists (select 1 from public.audit_log
           where action = 'ukol.ze_zpravy' and entity_id = :'ukol'::text
             and after->>'zprava' = :'m1' and after->>'konverzace' = :'konv')
  and not exists (select 1 from public.audit_log
                   where action = 'ukol.ze_zpravy' and entity_id = :'ukol'::text
                     and after::text like '%mrkev%'));

-- Kdo to nesmí
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000e', false);
select pg_temp.check('člověk, který v rozhovoru NENÍ (Petr), úkol ze zprávy nezaloží',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Cizí')$q$,
    :'tenant', :'m1', :'perla'), '42501'));

-- Kdo má tasks.manage, ale v rozhovoru NENÍ: právo samo nestačí, musí být
-- účastník. Petr to nezkouší — nemá právo ani účastnictví, takže by ho
-- zastavila kterákoli z obou podmínek a jedna by šla vyndat neviděna.
-- Rozhovor Anny s Bořkem, majitel v něm není (osobní = jen účastníci).
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Krok43 bez majitele', null,
  array[:'borek']::uuid[]) as konv_bez \gset
select public.poslat_zpravu(:'konv_bez', 'Krok43: porada v pátek.') as m_bez \gset
reset role;

select set_config('test.user_id', :'sef', false);
select pg_temp.check('majitel MÁ tasks.manage, ale v rozhovoru není → úkol z něj nezaloží',
  app.has_permission(:'tenant', 'tasks.manage')
  and pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Z cizího rozhovoru')$q$,
    :'tenant', :'m_bez', :'perla'), '42501'));

select set_config('test.user_id', '43430000-0000-0000-0000-00000000000a', false);
select pg_temp.check('účastník BEZ oprávnění tasks.manage (Anna) úkol nezaloží',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Bez práva')$q$,
    :'tenant', :'m1', :'perla'), '42501'));

select set_config('test.user_id', :'sef', false);
select pg_temp.check('zpráva JINÉ firmy s naším tenantem: odmítnuto',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Cizí zpráva')$q$,
    :'tenant', :'cizi_zprava', :'perla'), '42501'));
select pg_temp.check('zpráva JINÉ firmy s cizím tenantem: odmítnuto (sef tam není účastník)',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Cizí zpráva')$q$,
    :'cizi_firma', :'cizi_zprava', :'perla'), '42501'));
select pg_temp.check('neexistující zpráva se tváří stejně (nejde zkoušet id)',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, gen_random_uuid(), %L::uuid, 'Nic')$q$,
    :'tenant', :'perla'), '42501'));

select pg_temp.check('systémová událost není zdrojem úkolu',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Z události')$q$,
    :'tenant',
    (select id from public.konverzace_zpravy where konverzace_id = :'konv' and typ = 'system' limit 1),
    :'perla'), '23514'));

select pg_temp.check('prázdný název odmítne zadat_ukol (jedna cesta pro ruční i úkol ze zprávy)',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, '   ')$q$,
    :'tenant', :'m1', :'perla'), '23514'));

select pg_temp.check('po všech odmítnutých pokusech je úkolů z té zprávy pořád jeden',
  (select count(*) from public.tasks where zprava_id = :'m1') = 1);

-- Stornovaná zpráva
reset role;
update public.konverzace_zpravy set stornovano_kdy = now() where id = :'m2';
select set_config('test.user_id', :'sef', false);
select pg_temp.check('stornovaná zpráva není zdrojem úkolu',
  pg_temp.spadne(format($q$select public.zalozit_ukol_ze_zpravy(%L::uuid, %L::uuid, %L::uuid, 'Ze stornované')$q$,
    :'tenant', :'m2', :'perla'), '42501'));


\echo ''
\echo '== 4. Vazba úkolu na rozhovor nejde podvrhnout =============='

-- Přímý zápis (tasks_write dovolí tasks.manage insert): vazba na CIZÍ
-- rozhovor i na cizí zprávu je odmítnuta triggerem.
select set_config('test.user_id', :'sef', false);
select pg_temp.check('vazba na rozhovor JINÉ firmy se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, konverzace_id)
    values (%L::uuid, %L::uuid, 'Podvrh', %L::uuid)$q$, :'tenant', :'perla', :'cizi_konv'), '42501'));
select pg_temp.check('vazba na cizí zprávu s naším rozhovorem se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, konverzace_id, zprava_id)
    values (%L::uuid, %L::uuid, 'Podvrh 2', %L::uuid, %L::uuid)$q$,
    :'tenant', :'perla', :'konv', :'cizi_zprava'), '42501'));

select set_config('test.user_id', '43430000-0000-0000-0000-00000000000e', false);
select pg_temp.check('vazba na rozhovor, jehož účastníkem nejsem (Petr), se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, konverzace_id)
    values (%L::uuid, %L::uuid, 'Podvrh 3', %L::uuid)$q$, :'tenant', :'perla', :'konv'), '42501'));

select set_config('test.user_id', :'sef', false);
insert into public.tasks (tenant_id, branch_id, title, konverzace_id, zprava_id)
values (:'tenant', :'perla', 'Legitimní vazba', :'konv', :'m1')
returning id as legit \gset
select pg_temp.check('účastník rozhovoru vazbu zapsat smí (trigger nepřehání)',
  exists (select 1 from public.tasks where id = :'legit' and konverzace_id = :'konv'));


\echo ''
\echo '== 5. Producent: přidělený úkol — adresáti ================'

-- Úsek Kuchyně na Perle: Anna a Bořek. Ne Dana, Cyril, Petr; ne zadavatel.
insert into public.tasks (tenant_id, branch_id, title, usek_id, created_by)
values (:'tenant', :'perla', 'Umýt digestoře', :'usek_k', '43430000-0000-0000-0000-00000000000b')
returning id as u_usek \gset

select pg_temp.check('úkol pro úsek: Anna dostala právě jedno upozornění (má už jedno z minulého úkolu, celkem 2)',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000a', 'ukol.pridelen') = 2);
select pg_temp.check('… Bořek, který úkol zadal, ne',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000b', 'ukol.pridelen') = 0);
select pg_temp.check('… Dana (bez úseku), Cyril (jiná pobočka) a Petr ne',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000d', 'ukol.pridelen') = 0
  and pg_temp.pocet('43430000-0000-0000-0000-00000000000c', 'ukol.pridelen') = 0
  and pg_temp.pocet('43430000-0000-0000-0000-00000000000e', 'ukol.pridelen') = 0);

-- Úkol pro konkrétního člověka bez účtu nebo smazaného: nikomu nic.
insert into public.tasks (tenant_id, branch_id, title, employee_id)
values (:'tenant', :'perla', 'Pro nikoho 1', :'bez_uctu'), (:'tenant', :'perla', 'Pro nikoho 2', :'hugo');
select pg_temp.check('úkol pro zaměstnance bez účtu ani pro smazaného nikoho nepípá',
  not exists (select 1 from public.notifications
               where druh = 'ukol.pridelen' and telo->>'nazev' in ('Pro nikoho 1', 'Pro nikoho 2')));

-- Úkol pro oprávnění (role_id) je štítek, nikoho nepípá.
insert into public.tasks (tenant_id, branch_id, title, role_id)
values (:'tenant', :'perla', 'Pro roli', :'role_kuchyne');
select pg_temp.check('úkol pro oprávnění (role) nikoho nepípá',
  not exists (select 1 from public.notifications where druh = 'ukol.pridelen' and telo->>'nazev' = 'Pro roli'));

-- Dva úkoly téhož člověka se neslučují (klíč je konkrétní úkol).
insert into public.tasks (tenant_id, branch_id, title, employee_id)
values (:'tenant', :'perla', 'Druhý pro Petra 1', :'petr'), (:'tenant', :'perla', 'Druhý pro Petra 2', :'petr');
select pg_temp.check('dva úkoly jednoho člověka = dvě upozornění (žádný se neztratí)',
  pg_temp.pocet('43430000-0000-0000-0000-00000000000e', 'ukol.pridelen') = 2);


\echo ''
\echo '== 6. Výběr příjemců (komu_muzu_psat) ====================='

-- Petr: běžný zaměstnanec, Perla. Seznam má všechny kolegy s účtem; „moje
-- pobočka“ řadí nahoru.
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000e', false);
set role authenticated;
create temp table petr_vidi as
  select employee_id, na_me_pobocce
    from public.komu_muzu_psat(current_setting('test.tenant')::uuid);
reset role;

select pg_temp.check('Petr vidí Annu, Bořka a Danu (Perla) — na jeho pobočce',
  (select count(*) from petr_vidi where employee_id in (:'anna', :'borek', :'dana') and na_me_pobocce) = 3);
select pg_temp.check('Cyril (jiná pobočka) v nabídce je, ale ne jako „moje pobočka“ (hledá se přes vyhledávání)',
  exists (select 1 from petr_vidi where employee_id = :'cyril' and not na_me_pobocce));
select pg_temp.check('majitel (celofiremní rozsah nepracuje na jedné pobočce) je „na mé pobočce“ pro každého',
  exists (select 1 from petr_vidi where employee_id = :'sef_emp' and na_me_pobocce));
select pg_temp.check('nabídka nezahrnuje sebe, zaměstnance bez účtu ani smazaného',
  not exists (select 1 from petr_vidi where employee_id in (:'petr', :'bez_uctu', :'hugo')));
select pg_temp.check('a nikoho z JINÉ firmy (ani zaměstnance cizí firmy)',
  not exists (select 1 from petr_vidi where employee_id = :'cizi_emp'));
drop table petr_vidi;

-- Cyril (Bar): Dana střídá obě pobočky, takže je „na jeho pobočce“; Petr ne.
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000c', false);
set role authenticated;
create temp table cyril_vidi as
  select employee_id, na_me_pobocce
    from public.komu_muzu_psat(current_setting('test.tenant')::uuid);
reset role;
select pg_temp.check('Cyril: Dana (střídá Perla/Bar) je na jeho pobočce, Petr a Anna nejsou',
  exists (select 1 from cyril_vidi where employee_id = :'dana' and na_me_pobocce)
  and exists (select 1 from cyril_vidi where employee_id = :'petr' and not na_me_pobocce)
  and exists (select 1 from cyril_vidi where employee_id = :'anna' and not na_me_pobocce));
drop table cyril_vidi;

-- Nečlen (uživatel z etapa0, který ve firmě není) nedostane nic.
select set_config('test.user_id', (select user_id::text from public.profiles where email = 'cizi@jinafirma.cz'), false);
select pg_temp.check('člověk, který ve firmě není, nedostane žádný seznam (definer bez RLS ho musí zastavit sám)',
  (select count(*) from public.komu_muzu_psat(:'tenant')) = 0);

-- Rozhovor s kolegou z jiné pobočky zůstává možný (zalozit_rozhovor se nemění).
select set_config('test.user_id', '43430000-0000-0000-0000-00000000000e', false);
select pg_temp.check('rozhovor mezi pobočkami se nezakázal — zalozit_rozhovor beze změny (krok 24/25 to vyžadují)',
  (select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Petr a Cyril', null, array[:'cyril']::uuid[])) is not null);



\echo ''
\echo '== 7. kdo_nepotvrdil vyžaduje oprávnění ===================='

insert into public.announcements (tenant_id, branch_id, body, author_id, requires_acknowledgment)
values (:'tenant', :'perla', 'Krok43: potvrďte.', :'sef', true)
returning id as oz \gset

select set_config('test.user_id', :'sef', false);
select pg_temp.check('majitel (communication.manage) vidí, kdo nepotvrdil',
  (select count(*) from public.kdo_nepotvrdil(:'tenant', :'oz')) >= 3);

select set_config('test.user_id', '43430000-0000-0000-0000-00000000000e', false);
select pg_temp.check('běžný zaměstnanec (Petr) jména nedostane, ač zná id oznámení',
  (select count(*) from public.kdo_nepotvrdil(:'tenant', :'oz')) = 0);


-- Úklid: cizí firma se maže (kaskádou i její rozhovor, zpráva a upozornění).
reset role;
delete from public.tenants where id = :'cizi_firma';

\echo ''
\echo '  VŠECHNY KONTROLY KROKU 43 PROŠLY'
