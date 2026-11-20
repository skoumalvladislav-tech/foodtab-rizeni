-- Scénář pro krok 111 — Finance Fáze 0, krok 1: neutrální bankovní vrstva.
--
-- Migrace: 20261119100000_banka_neutralni_vrstva.sql.
-- Zadání: docs/finance-faze0-zadani.md, oddíl 3 (Krok 1), 5 (zkoušky 1 a 6).
--
-- Pokrývá:
--   1. Zkouška 1 — idempotence importu:
--      * dvojí import téhož stažení s id pohybu od banky nic nepřidá;
--      * dvojí import výpisu BEZ id nic nepřidá (otisk);
--      * dvě stejné platby v jednom výpisu zůstanou dvě;
--      * překrývající se druhý výpis přidá jen nové řádky;
--      * spadlý import nezanechá dávku — opakování projde;
--      * otisk = app.otisk_pohybu i s pořadím, protiúčet se ukládá;
--   2. Zkouška 6 — pobočky:
--      * člověk jiné pobočky nevidí cizí účty, pohyby ani zůstatky;
--      * člověk pobočky nevidí pohyby firemního účtu (bez pobočky);
--      * zápis jen na účty, ke kterým má právo; dávky jen za celou firmu;
--      * pobočka zapíše jen ruční platbu, „výpis z banky" ne;
--      * přehled tržeb (definer) počítá banku stejně;
--      * druhá linie: účet nejde dát pod pobočku cizí firmy;
--   3. přístupové údaje k bance se přihlášenému nevydají (RPC ani select),
--      server ověří právo bez šifry (integrace_overit_spravu);
--   4. v omezeních zdroje není jméno banky, `banka_api` projde, staré
--      hodnoty ne.
--
-- Vlastní firmy a vlastní id — CI pouští všechny scénáře v jedné
-- databázi, nic se nepočítá přes cizí řádky.

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
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

-- Import výpisu, vrací počet NOVÝCH pohybů. Když import spadne, vrátí -1
-- a vypíše proč — kontrola za ním pak spadne SVÝM jménem, ne syrovou
-- chybou uprostřed přípravy (schválné rozbití dedupu to dřív schovalo).
create or replace function pg_temp.importovat(p_tenant uuid, p_ucet uuid, p_zdroj text, p_hash text, p_radky jsonb)
returns integer language plpgsql as $$
declare
  v_pocet integer;
begin
  select v.pocet_novych into v_pocet
    from public.importovat_vypis(p_tenant, p_ucet, p_zdroj, 'krok111.csv', p_hash, p_radky) v;
  return v_pocet;
exception when others then
  raise notice '  (import spadl: % %)', sqlstate, sqlerrm;
  return -1;
end $$;

-- Výsledek dotazu jako text, nebo NULL, když dotaz spadne (vypíše proč).
create or replace function pg_temp.hodnota(p_sql text)
returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  raise notice '  (dotaz spadl: % %)', sqlstate, sqlerrm;
  return null;
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Firma A (Provoz + Finance), pobočky P1 a P2:
--   Marie   — majitelka;
--   Petr    — finance.read + finance.manage jen na P1;
--   Pavla   — finance.read jen na P2;
--   Filip   — finance.read za celou firmu (ne majitel).
-- Firma B (cizí): Bohdan — majitel.
-- Účty A: firemní (bez pobočky), P1, P2. Účet B: pobočka B1.
-- =====================================================================

\set maj     11110000-0000-0000-0000-000000000001
\set pob1    11110000-0000-0000-0000-000000000002
\set pob2    11110000-0000-0000-0000-000000000003
\set firemni 11110000-0000-0000-0000-000000000004
\set cizi    11110000-0000-0000-0000-000000000005

insert into auth.users (id, email, raw_user_meta_data) values
  (:'maj',     'marie111@foodtab.cz',  '{"full_name":"Marie Stojedenáctá"}'),
  (:'pob1',    'petr111@foodtab.cz',   '{"full_name":"Petr Stojedenáctý"}'),
  (:'pob2',    'pavla111@foodtab.cz',  '{"full_name":"Pavla Stojedenáctá"}'),
  (:'firemni', 'filip111@foodtab.cz',  '{"full_name":"Filip Stojedenáctý"}'),
  (:'cizi',    'bohdan111@foodtab.cz', '{"full_name":"Bohdan Stojedenáctý"}');

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok111 Alfa s.r.o.', 'Krok111 Alfa s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_a \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_a', 'provoz'), (:'firma_a', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_a', 'Alfa Jedna Krok111', 'krok111-p1') returning id as p1 \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma_a', 'Alfa Dva Krok111', 'krok111-p2') returning id as p2 \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_a', 'krok111_finance', 'Krok111 — finance', 'provoz', true) returning id as z_fin \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_a', 'krok111_cteni', 'Krok111 — čtení financí', 'provoz', true) returning id as z_cteni \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'firma_a', :'z_fin', 'finance.read'),
  (:'firma_a', :'z_fin', 'finance.manage'),
  (:'firma_a', :'z_cteni', 'finance.read');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_a', :'p1', :'maj', 'Marie Stojedenáctá', 'hpp', true) returning id as e_maj \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'p1', :'pob1', :'z_fin', 'Petr Stojedenáctý', 'hpp') returning id as e_pob1 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'p2', :'pob2', :'z_cteni', 'Pavla Stojedenáctá', 'hpp') returning id as e_pob2 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'p1', :'firemni', :'z_cteni', 'Filip Stojedenáctý', 'hpp') returning id as e_firemni \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma_a', :'maj',     null, 'tenant', 'active'),
  (:'firma_a', :'firemni', null, 'tenant', 'active'),
  (:'firma_a', :'pob1',    null, 'branch', 'active'),
  (:'firma_a', :'pob2',    null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'pob2' then :'p2'::uuid else :'p1'::uuid end
  from public.memberships m
 where m.tenant_id = :'firma_a' and m.user_id in (:'pob1', :'pob2');

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok111 Beta s.r.o.', 'Krok111 Beta s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_b \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_b', 'provoz'), (:'firma_b', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_b', 'Beta Krok111', 'krok111-b1') returning id as b1 \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_b', :'b1', :'cizi', 'Bohdan Stojedenáctý', 'hpp', true) returning id as e_cizi \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'firma_b', :'cizi', null, 'tenant', 'active');

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 firemní účet', 'banka') returning id as u_firma \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', :'p1', 'Krok111 účet P1', 'banka') returning id as u_p1 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', :'p2', 'Krok111 účet P2', 'banka') returning id as u_p2 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_b', :'b1', 'Krok111 cizí účet', 'banka') returning id as u_cizi \gset


\echo ''
\echo '== 1. Zkouška 1: s id pohybu od banky ===================================='

-- Synchronizace běží jako úloha (service_role obchází RLS). Tady jako
-- vlastník databáze: čistý harness nemá výchozí práva Supabase, která
-- service_role dávají zápis do transakce.
select pg_temp.importovat(:'firma_a', :'u_p1', 'banka_api', 'krok111-api-1',
  '[{"datum":"2033-01-05","smer":"prijem","castka_haleru":50000,"mena":"CZK","protistrana":"Host A","protiucet":"CZ6508000000192000145399","vs":"1","poznamka":"","externi_id":"krok111-x1"},
    {"datum":"2033-01-06","smer":"vydaj","castka_haleru":7000,"mena":"CZK","protistrana":"Dodavatel","protiucet":"","vs":"2","poznamka":"","externi_id":"krok111-x2"}]'::jsonb) as api_prvni \gset
select pg_temp.check('první stažení zapíše dva pohyby', :'api_prvni'::int = 2);

select pg_temp.importovat(:'firma_a', :'u_p1', 'banka_api', 'krok111-api-2',
  '[{"datum":"2033-01-05","smer":"prijem","castka_haleru":50000,"mena":"CZK","protistrana":"Host A","protiucet":"CZ6508000000192000145399","vs":"1","poznamka":"","externi_id":"krok111-x1"},
    {"datum":"2033-01-06","smer":"vydaj","castka_haleru":7000,"mena":"CZK","protistrana":"Dodavatel","protiucet":"","vs":"2","poznamka":"","externi_id":"krok111-x2"},
    {"datum":"2033-01-07","smer":"prijem","castka_haleru":800,"mena":"CZK","protistrana":"","protiucet":"","vs":"","poznamka":"","externi_id":"krok111-x3"}]'::jsonb) as api_druhe \gset
select pg_temp.check('druhé stažení se stejnými pohyby přidá jen ten nový (1)', :'api_druhe'::int = 1);
select pg_temp.check('… a pohybů s id x1, x2 je na účtu pořád po jednom',
  (select count(*) from public.transakce where ucet_id = :'u_p1' and externi_id in ('krok111-x1', 'krok111-x2')) = 2);
select pg_temp.check('pohyb s id od banky nemá otisk (hlídá ho id)',
  (select otisk is null from public.transakce where ucet_id = :'u_p1' and externi_id = 'krok111-x1'));
select pg_temp.check('protiúčet se uloží zvlášť od jména protistrany',
  (select protiucet = 'CZ6508000000192000145399' and protistrana = 'Host A'
     from public.transakce where ucet_id = :'u_p1' and externi_id = 'krok111-x1'));
select pg_temp.check('dávka stažení má typ banka_api a počet nových',
  (select typ = 'banka_api' and pocet_novych = 1 and pocet_radku = 3
     from public.import_davky where tenant_id = :'firma_a' and soubor_hash = 'krok111-api-2'));


\echo ''
\echo '== 2. Zkouška 1: výpis bez id (otisk) ===================================='

-- Výpis V1: A, B, B (dvě STEJNÉ platby v jednom výpisu).
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v1',
  '[{"datum":"2033-01-10","smer":"vydaj","castka_haleru":12345,"mena":"CZK","protistrana":"Dodavatel A","protiucet":"CZ6508000000192000145399","vs":"111","poznamka":"faktura"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"první"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"druhá"}]'::jsonb) as v1 \gset
select pg_temp.check('výpis V1 zapíše tři pohyby', :'v1'::int = 3);
select pg_temp.check('dvě stejné platby v jednom výpisu zůstanou dvě',
  (select count(*) from public.transakce where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900) = 2);
select pg_temp.check('… s různým otiskem (pořadí 1 a 2)',
  (select count(distinct otisk) from public.transakce
    where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900 and otisk is not null) = 2);
select pg_temp.check('otisk = app.otisk_pohybu s pořadím 1 (jedna implementace)',
  (select otisk = app.otisk_pohybu(:'u_p2', '2033-01-10', 'vydaj', 12345, 'CZK', '111',
                                   'CZ6508000000192000145399', 'Dodavatel A', 1)
     from public.transakce where ucet_id = :'u_p2' and datum = '2033-01-10'));
select pg_temp.check('otisky stejných plateb jsou přesně pořadí 1 a 2',
  (select array_agg(otisk order by otisk) from public.transakce
    where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900)
  = (select array_agg(o order by o) from (values
       (app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.', 1)),
       (app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.', 2))) x(o)));
select pg_temp.check('poznámka do otisku nepatří, mezery a velikost písmen protistrany ano jen normalizovaně',
  app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'czk', ' ', ' ', '  KÁVA   s.r.o. ', 1)
  = app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'káva s.r.o.', 1)
  and app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.', 1)
   <> app.otisk_pohybu(:'u_p1', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.', 1));

-- Týž výpis podruhé (jiný soubor, stejný obsah — třeba znovu stažený export).
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v1-znovu',
  '[{"datum":"2033-01-10","smer":"vydaj","castka_haleru":12345,"mena":"CZK","protistrana":"Dodavatel A","protiucet":"CZ6508000000192000145399","vs":"111","poznamka":"faktura"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"první"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"druhá"}]'::jsonb) as v1_znovu \gset
select pg_temp.check('dvojí import téhož výpisu bez id nepřidá nic', :'v1_znovu'::int = 0);
select pg_temp.check('… a na účtu P2 jsou pořád tři pohyby z výpisu',
  (select count(*) from public.transakce where ucet_id = :'u_p2' and zdroj = 'csv_banka') = 3);

-- Překrývající se výpis V2: B, B, C — nový je jen C.
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v2',
  '[{"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"jinak popsaná"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"KÁVA s.r.o.","protiucet":"","vs":"","poznamka":""},
    {"datum":"2033-01-12","smer":"prijem","castka_haleru":4000,"mena":"CZK","protistrana":"Host C","protiucet":"19-2000145399/0800","vs":"","poznamka":""}]'::jsonb) as v2 \gset
select pg_temp.check('překrývající se výpis přidá jen nový řádek (1)', :'v2'::int = 1);
select pg_temp.check('… a stejných plateb B jsou na účtu pořád dvě',
  (select count(*) from public.transakce where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900) = 2);

-- Výpis V3 má třetí stejnou platbu B — ta je nová.
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v3',
  '[{"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":""},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":""},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":""}]'::jsonb) as v3 \gset
select pg_temp.check('výpis se třemi stejnými platbami (dvě už jsou) přidá právě třetí', :'v3'::int = 1);

-- Stejný obsah na JINÉM účtu je jiný pohyb.
select pg_temp.importovat(:'firma_a', :'u_firma', 'csv_banka', 'krok111-v1-firma',
  '[{"datum":"2033-01-10","smer":"vydaj","castka_haleru":12345,"mena":"CZK","protistrana":"Dodavatel A","protiucet":"CZ6508000000192000145399","vs":"111","poznamka":"faktura"}]'::jsonb) as v1_firma \gset
select pg_temp.check('týž řádek na jiném účtu se zapíše (otisk je i z účtu)', :'v1_firma'::int = 1);

-- Prázdné id = bez id.
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v4',
  '[{"datum":"2033-01-13","smer":"prijem","castka_haleru":100,"mena":"CZK","protistrana":"Prázdné id","protiucet":"","vs":"","poznamka":"","externi_id":"  "}]'::jsonb) as v4 \gset
select pg_temp.check('prázdné id od banky se bere jako žádné (dostane otisk)',
  (select externi_id is null and otisk is not null from public.transakce
    where ucet_id = :'u_p2' and protistrana = 'Prázdné id'));

-- Starý podpis (stará appka během nasazení, scénář krok76) dál funguje.
insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, stav)
values (:'firma_a', 'banka_csv', 'stary.csv', 'krok111-stary', 'zpracovano') returning id as d_stary \gset
select coalesce(pg_temp.hodnota(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
  :'firma_a', :'u_p2', :'d_stary', 'csv_banka',
  '[{"datum":"2033-01-14","smer":"vydaj","castka_haleru":321,"protistrana":"Bez protiúčtu","vs":"","poznamka":""}]')), '-1') as stary \gset
select pg_temp.check('starý podpis importovat_transakce: řádek bez protiúčtu projde (prázdný protiúčet, otisk)',
  :'stary'::int = 1
  and (select protiucet = '' and otisk is not null from public.transakce where ucet_id = :'u_p2' and protistrana = 'Bez protiúčtu'));


\echo ''
\echo '== 3. Spadlý import nezanechá dávku ======================================'

-- Druhý řádek má nulovou částku (transakce ji nepřijme) — spadne celé volání.
select pg_temp.check('import s vadným řádkem spadne celý (23514)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'csv_banka', 'vadny.csv', 'krok111-vadny',
    '[{"datum":"2033-02-01","smer":"prijem","castka_haleru":500,"mena":"CZK","protistrana":"Dobrý","protiucet":"","vs":"","poznamka":""},
      {"datum":"2033-02-01","smer":"prijem","castka_haleru":0,"mena":"CZK","protistrana":"Nulový","protiucet":"","vs":"","poznamka":""}]'),
    '23514', ''));
select pg_temp.check('… a dávka s tím souborem nezůstala (opakování neblokuje „už importováno")',
  not exists (select 1 from public.import_davky where tenant_id = :'firma_a' and soubor_hash = 'krok111-vadny'));
select pg_temp.check('… ani dobrý řádek z toho souboru',
  not exists (select 1 from public.transakce where ucet_id = :'u_p1' and protistrana = 'Dobrý'));
select pg_temp.importovat(:'firma_a', :'u_p1', 'csv_banka', 'krok111-vadny',
  '[{"datum":"2033-02-01","smer":"prijem","castka_haleru":500,"mena":"CZK","protistrana":"Dobrý","protiucet":"","vs":"","poznamka":""}]'::jsonb) as opraveny \gset
select pg_temp.check('opravený soubor se stejným hashem pak projde', :'opraveny'::int = 1);
select pg_temp.check('stejný soubor (hash) podruhé spadne na unikátní dávku (23505)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'csv_banka', 'znovu.csv', 'krok111-vadny', '[]'), '23505', ''));
select pg_temp.check('neznámý zdroj importu odmítnut (23514)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'rucni', 'x.csv', 'krok111-rucni', '[]'), '23514', 'zdroje'));
select pg_temp.check('otisk bez dávky (ruční zápis) databáze nepustí (23514)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, otisk) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-02', 'rucni', 'podvrzeny-otisk'), '23514', 'transakce_otisk_jen_z_importu'));


\echo ''
\echo '== 4. Import přihlášeného ==============================================='

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitel importuje výpis (csv_banka) přes importovat_vypis',
  pg_temp.importovat(:'firma_a', :'u_p1', 'csv_banka', 'krok111-maj',
    '[{"datum":"2033-02-03","smer":"prijem","castka_haleru":700,"mena":"CZK","protistrana":"Od majitelky","protiucet":"","vs":"","poznamka":""}]'::jsonb) = 1);
select pg_temp.check('… ale zdroj banka_api přihlášený nezapíše (42501, jen synchronizace)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'banka_api', 'x', 'krok111-maj-api',
    '[{"datum":"2033-02-03","smer":"prijem","castka_haleru":700,"mena":"CZK","protistrana":"x","protiucet":"","vs":"","poznamka":"","externi_id":"krok111-maj-x"}]'),
    '42501', 'synchronizace'));
select set_config('test.user_id', :'pob1', false);
select pg_temp.check('člověk jedné pobočky výpis neimportuje (dávka jen za celou firmu, 42501)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'csv_banka', 'x', 'krok111-pob1',
    '[{"datum":"2033-02-03","smer":"prijem","castka_haleru":1,"mena":"CZK","protistrana":"x","protiucet":"","vs":"","poznamka":""}]'),
    '42501', ''));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 5. Zkouška 6: kdo vidí které účty, pohyby a zůstatky ================='

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values
  (:'firma_a', :'u_firma', 'prijem', 30000, '2033-03-05', 'rucni'),
  (:'firma_a', :'u_p1',    'prijem', 20000, '2033-03-05', 'rucni'),
  (:'firma_a', :'u_p2',    'prijem', 10000, '2033-03-05', 'rucni'),
  (:'firma_b', :'u_cizi',  'prijem',  5000, '2033-03-05', 'rucni');
insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values
  (:'firma_a', :'u_firma', 'knihovni', 100, now(), 'banka_api'),
  (:'firma_a', :'u_p1',    'knihovni', 200, now(), 'banka_api'),
  (:'firma_a', :'u_p2',    'knihovni', 300, now(), 'banka_api'),
  (:'firma_b', :'u_cizi',  'knihovni', 400, now(), 'banka_api');

set role authenticated;

-- Petr: finance na P1.
select set_config('test.user_id', :'pob1', false);
select pg_temp.check('pobočka P1: vidí jen účet P1 (ne firemní, ne P2, ne cizí)',
  (select array_agg(id order by id) from public.platebni_ucty
    where id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p1'::uuid]);
select pg_temp.check('pobočka P1: pohyby jen z účtu P1 — firemní účet NE',
  (select array_agg(distinct ucet_id) from public.transakce
    where ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p1'::uuid]);
select pg_temp.check('pobočka P1: zůstatky jen účtu P1',
  (select array_agg(platebni_ucet_id) from public.bankovni_zustatky
    where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p1'::uuid]);
select pg_temp.check('pobočka P1: dávky importu nevidí (jsou za celou firmu)',
  not exists (select 1 from public.import_davky where tenant_id = :'firma_a'));
select pg_temp.check('pobočka P1: app.platebni_ucty_s_pravem(finance.read) = jen účet P1',
  (select array_agg(x) from app.platebni_ucty_s_pravem('finance.read') x
    where x in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p1'::uuid]);
select pg_temp.check('pobočka P1: zapíše ruční platbu na účet P1',
  pg_temp.projde(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-03-06', 'rucni', 'Krok111 zápis P1')));
-- Výpisu z banky věří párování faktur i úhrady Jiných plateb jako důkazu
-- o zaplacení — vedoucí pobočky si ho přímým zápisem nenapíše.
select pg_temp.check('pobočka P1: „výpis z banky" (csv_banka) přímým zápisem ani na svůj účet nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-03-06', 'csv_banka', 'Krok111 podvržený výpis'), '42501', ''));
select pg_temp.check('pobočka P1: na firemní účet nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_firma', 'prijem', '2033-03-06', 'rucni'), '42501', ''));
select pg_temp.check('pobočka P1: na účet P2 nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p2', 'prijem', '2033-03-06', 'rucni'), '42501', ''));
select pg_temp.check('pobočka P1: zůstatek firemního účtu nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values (%L, %L, %L, 1, now(), %L)',
    :'firma_a', :'u_firma', 'knihovni', 'rucni'), '42501', ''));

-- Pavla: jen čtení na P2. Účet P1 Petr vidí i přes politiku zápisu
-- (platebni_ucty_write je `for all`), proto čtecí politiku pobočky
-- hlídá až Pavla bez finance.manage.
select set_config('test.user_id', :'pob2', false);
select pg_temp.check('jen čtení na P2: vidí svůj účet P2 (ne firemní, ne P1, ne cizí)',
  coalesce((select array_agg(id order by id) from public.platebni_ucty
    where id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p2'::uuid], false));
select pg_temp.check('jiná pobočka (P2): nevidí účet ani pohyby P1, vidí svoje',
  (select array_agg(distinct ucet_id) from public.transakce
    where ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p2'::uuid]
  and not exists (select 1 from public.platebni_ucty where id = :'u_p1'));
select pg_temp.check('jiná pobočka (P2): nevidí zůstatek P1 ani firemní',
  (select array_agg(platebni_ucet_id) from public.bankovni_zustatky
    where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi')) = array[:'u_p2'::uuid]);
select pg_temp.check('jen čtení na P2: na svůj účet nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p2', 'prijem', '2033-03-06', 'rucni'), '42501', ''));

-- Filip: čtení za celou firmu.
select set_config('test.user_id', :'firemni', false);
select pg_temp.check('rozsah celé firmy: vidí firemní účet i obě pobočky, cizí ne',
  (select array_agg(distinct ucet_id order by ucet_id) from public.transakce
    where ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi'))
  = (select array_agg(x order by x) from unnest(array[:'u_firma'::uuid, :'u_p1'::uuid, :'u_p2'::uuid]) x));
select pg_temp.check('rozsah celé firmy: vidí zůstatek firemního účtu',
  exists (select 1 from public.bankovni_zustatky where platebni_ucet_id = :'u_firma'));

-- Bohdan: cizí firma.
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: nevidí žádný účet, pohyb ani zůstatek firmy A',
  not exists (select 1 from public.platebni_ucty where id in (:'u_firma', :'u_p1', :'u_p2'))
  and not exists (select 1 from public.transakce where ucet_id in (:'u_firma', :'u_p1', :'u_p2'))
  and not exists (select 1 from public.bankovni_zustatky where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2')));
select pg_temp.check('cizí firma: na účet firmy A nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-03-06', 'rucni'), '42501', ''));

-- Přehled tržeb (SECURITY DEFINER) počítá banku stejně jako politika.
select set_config('test.user_id', :'pob1', false);
select public.pokladna_prehled_trzeb(:'firma_a', '2033-03-01', '2033-03-31', 'mesic') as prehled_p1 \gset
select pg_temp.check('přehled tržeb pobočky P1: banka jen z účtu P1 (20000 + 1), firemní ne',
  (select coalesce(sum((e ->> 'prijmy_haleru')::bigint), 0) from jsonb_array_elements(:'prehled_p1'::jsonb -> 'banka') e) = 20001
  and not exists (select 1 from jsonb_array_elements(:'prehled_p1'::jsonb -> 'banka') e where e ->> 'branch_id' is null));
select set_config('test.user_id', :'maj', false);
select public.pokladna_prehled_trzeb(:'firma_a', '2033-03-01', '2033-03-31', 'mesic') as prehled_maj \gset
select pg_temp.check('přehled tržeb majitelky: firemní účet (bez pobočky) i obě pobočky',
  (select coalesce(sum((e ->> 'prijmy_haleru')::bigint), 0) from jsonb_array_elements(:'prehled_maj'::jsonb -> 'banka') e) = 60001
  and exists (select 1 from jsonb_array_elements(:'prehled_maj'::jsonb -> 'banka') e where e ->> 'branch_id' is null));

-- Druhá linie: majitelka (rozsah celé firmy) projde politikou i s cizí
-- pobočkou — zastavit to musí spoušť.
select pg_temp.check('účet nejde přestěhovat pod pobočku cizí firmy (spoušť, 23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set branch_id = %L where id = %L', :'b1', :'u_p1'),
    '23514', 'Pobočka nepatří'));
select pg_temp.check('… ani založit (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (%L, %L, %L, %L)',
    :'firma_a', :'b1', 'Krok111 pod cizí pobočkou', 'banka'), '23514', 'Pobočka nepatří'));
select pg_temp.check('… ale pod vlastní pobočku ano',
  pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p1'))
  and pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p1', :'u_p1')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('účet P1 po zkouškách pořád pod P1',
  (select branch_id = :'p1'::uuid from public.platebni_ucty where id = :'u_p1'));


\echo ''
\echo '== 6. Přístupové údaje k bance se přihlášenému nevydají ================='

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev)
values (:'firma_a', 'banka', 'krok111-banka', 'zakaznicky', 'Krok111 banka') returning id as pr_banka \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'firma_a', :'p1', 'rezervace', 'krok111-rezervace', 'zakaznicky', 'Krok111 rezervace') returning id as pr_rez \gset
insert into public.integrace_tajemstvi (pripojeni_id, tenant_id, sifra, otisk) values
  (:'pr_banka', :'firma_a', 'krok111-sifra-banky', 'o1'),
  (:'pr_rez',   :'firma_a', 'krok111-sifra-rezervace', 'o2');

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitelka: app.integrace_precti_tajemstvi u banky odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select app.integrace_precti_tajemstvi(%L)', :'pr_banka'), '42501', 'server'));
select pg_temp.check('majitelka: public.integrace_precti_tajemstvi (/rest/v1/rpc) u banky odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_precti_tajemstvi(%L)', :'pr_banka'), '42501', 'server'));
select pg_temp.check('majitelka: přímý select z integrace_tajemstvi nevrátí nic',
  not exists (select 1 from public.integrace_tajemstvi where pripojeni_id in (:'pr_banka', :'pr_rez')));
select public.integrace_overit_spravu(:'pr_banka') as sprava \gset
select pg_temp.check('integrace_overit_spravu vrátí jen firmu připojení — ne šifru',
  :'sprava' = :'firma_a' and :'sprava' <> 'krok111-sifra-banky');
select pg_temp.check('jiné oblasti (rezervace) RPC šifru vydává dál — přepnutí mimo Finance',
  coalesce(pg_temp.hodnota(format('select public.integrace_precti_tajemstvi(%L)', :'pr_rez')) = 'krok111-sifra-rezervace', false));

select set_config('test.user_id', :'pob1', false);
select pg_temp.check('bez integrace.manage: integrace_overit_spravu odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_overit_spravu(%L)', :'pr_banka'), '42501', 'oprávnění'));
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: integrace_overit_spravu odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_overit_spravu(%L)', :'pr_banka'), '42501', 'oprávnění'));
select pg_temp.check('cizí firma: ani číst šifru banky (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_precti_tajemstvi(%L)', :'pr_banka'), '42501', 'oprávnění'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('anon nemá integrace_overit_spravu, importovat_vypis ani otisk; authenticated ano',
  not has_function_privilege('anon', 'public.integrace_overit_spravu(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.importovat_vypis(uuid, uuid, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.otisk_pohybu(uuid, date, text, integer, text, text, text, text, bigint)', 'execute')
  and has_function_privilege('authenticated', 'public.integrace_overit_spravu(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.importovat_vypis(uuid, uuid, text, text, text, jsonb)', 'execute'));
select pg_temp.check('spoušť pobočky účtu a výběr účtů nezavolá přihlášený přímo jako spoušť (bez execute)',
  not has_function_privilege('authenticated', 'app.hlida_firmu_platebniho_uctu()', 'execute')
  and not has_function_privilege('anon', 'app.platebni_ucty_s_pravem(text)', 'execute'));


\echo ''
\echo '== 7. Zdroj bez jména banky ============================================='

select pg_temp.check('omezení zdroje/typu: žádné jméno banky ani agregátoru, banka_api ano',
  (select bool_and(def !~* '(fio|agregator|kb_|komer|enable|salt|csob|čsob|raiff|moneta|air)' and def like '%banka_api%')
     from (select pg_get_constraintdef(c.oid) as def
             from pg_constraint c
            where c.conname in ('transakce_zdroj_check', 'import_davky_typ_check', 'bankovni_zustatky_zdroj_check')) x)
  and (select count(*) from pg_constraint
        where conname in ('transakce_zdroj_check', 'import_davky_typ_check', 'bankovni_zustatky_zdroj_check')) = 3);
select pg_temp.check('funkce kolem plateb z banky staré hodnoty nemají a banka_api znají',
  (select bool_and(def !~ '(fio_api|bankovni_agregator)' and def like '%banka_api%')
     from (select pg_get_functiondef(p.oid) as def
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'hlida_zdroj_transakce'), ('app', 'automaticky_sparovat_platbu'),
                                              ('app', 'automaticky_sparovat_fakturu'), ('public', 'jine_platby_evidovat_uhradu'))) x)
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname, p.proname) in (('app', 'hlida_zdroj_transakce'), ('app', 'automaticky_sparovat_platbu'),
                                          ('app', 'automaticky_sparovat_fakturu'), ('public', 'jine_platby_evidovat_uhradu'))) = 4);
select pg_temp.check('pohyb se zdrojem banka_api projde (synchronizace)',
  pg_temp.projde(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-04-01', 'banka_api', 'krok111-api-rucne')));
select pg_temp.check('starý zdroj fio_api neprojde (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-04-01', 'fio_api'), '23514', 'transakce_zdroj_check'));
select pg_temp.check('starý zdroj bankovni_agregator u zůstatku neprojde (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values (%L, %L, %L, 1, now(), %L)',
    :'firma_a', :'u_p1', 'knihovni', 'bankovni_agregator'), '23514', 'bankovni_zustatky_zdroj_check'));
select pg_temp.check('starý typ dávky fio_api neprojde (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.import_davky (tenant_id, typ, soubor_hash, stav) values (%L, %L, %L, %L)',
    :'firma_a', 'fio_api', 'krok111-stary-typ', 'zpracovano'), '23514', 'import_davky_typ_check'));


\echo ''
\echo '== Úklid ================================================================'

delete from public.integrace_tajemstvi where pripojeni_id in (:'pr_banka', :'pr_rez');
delete from public.integrace_pripojeni where id in (:'pr_banka', :'pr_rez');
delete from public.bankovni_zustatky where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi');
delete from public.transakce where ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi');
delete from public.import_davky where tenant_id in (:'firma_a', :'firma_b');
delete from public.platebni_ucty where id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi');
-- Majitelé a jejich firmy zůstávají (jako v krocích 103 až 110): posledního
-- majitele firmy pojistka smazat nedovolí. Ostatní lidé pryč.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'firma_a' and user_id in (:'pob1', :'pob2', :'firemni'));
delete from public.memberships where tenant_id = :'firma_a' and user_id in (:'pob1', :'pob2', :'firemni');
delete from public.employees where id in (:'e_pob1', :'e_pob2', :'e_firemni');
delete from public.position_permissions where position_id in (:'z_fin', :'z_cteni');
delete from public.positions where id in (:'z_fin', :'z_cteni');

select pg_temp.check('úklid: účty, pohyby, zůstatky, dávky a připojení kroku 111 pryč',
  not exists (select 1 from public.platebni_ucty where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.transakce where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.bankovni_zustatky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.import_davky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'firma_a', :'firma_b')));

\echo ''
\echo '== KROK 111 HOTOV ========================================'
