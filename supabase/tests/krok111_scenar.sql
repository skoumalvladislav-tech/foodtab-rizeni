-- Scénář pro krok 111 — Finance Fáze 0, krok 1: neutrální bankovní vrstva.
--
-- Migrace: 20261119100000_banka_neutralni_vrstva.sql.
-- Zadání: docs/finance-faze0-zadani.md, oddíl 3 (Krok 1), 5 (zkoušky 1 a 6).
--
-- Pokrývá:
--   1. Zkouška 1 — idempotence importu:
--      * dvojí import téhož stažení s id pohybu od banky nic nepřidá;
--      * dvojí import výpisu BEZ id nic nepřidá (obsahový klíč);
--      * dvě stejné platby v jednom výpisu zůstanou dvě (klíč není
--        unikátní, import počítá);
--      * překrývající se druhý výpis přidá jen nové řádky;
--      * výpis uložený v Excelu (VS bez úvodních nul) nic nepřidá;
--        klíč nezávisí na DateStyle relace;
--      * spadlý import nezanechá dávku — opakování projde;
--      * klíč = app.otisk_pohybu (bez pořadí), protiúčet se ukládá;
--      * ruční zápis si nezabere id ani dávku importu;
--   2. Dvojí zápis výpis × stažení z banky (kontrola kroku 1, 20. 11.):
--      * stránky stažení zvlášť (B1, B2), okno od poledne (B3), výpis
--        → stažení, stažení → výpis, opakování nic nepřidá;
--      * výpis omylem jako pokladní uzávěrka, stornovaný řádek výpisu,
--        pokladna nebo výpis s vymyšleným id pohyb z banky nezablokují;
--        pohyb z banky nezablokuje pokladní uzávěrku;
--      * storno (kontrola 23. 11.): stornovaný řádek výpisu (pokladní
--        uzávěrky) se dalším výpisem (uzávěrkou) nevrátí — ani když ho
--        banka už potvrdila —, stažení z banky ale nezablokuje (s id ani
--        bez id); stornovaný pohyb ze stažení bez id se dalším stažením
--        bez id nevrátí (druhou stejnou platbu doplní); storno pohybu
--        z banky výpis nezastaví (ROZHODNOUT) a jeho id zůstane jednou;
--        stornovaný potvrzený řádek výpisu stažení bez id jednou vrátí
--        (ROZHODNOUT); storno jen na pohyb téže firmy a účtu — cizí firma
--        storno našeho pohybu nezapíše a synchronizaci nezdvojí;
--      * každé id ze stažení je na účtu právě jednou: řádek `banka_api`,
--        nebo potvrzení řádku výpisu;
--      * přihlášený přímo zapíše jen ruční platbu; potvrzení nezapíše;
--      * import se řadí zámkem účtu;
--   3. Zkouška 6 — pobočky:
--      * člověk jiné pobočky nevidí cizí účty, pohyby, zůstatky ani
--        potvrzení z banky;
--      * člověk pobočky nevidí pohyby firemního účtu (bez pobočky),
--        jejich párování s fakturami ani zálohy na zakázku;
--      * zápis pohybů i zůstatků jen za celou firmu; dávky taky;
--      * přehled tržeb (definer) počítá banku stejně;
--      * druhá linie: účet nejde dát pod pobočku cizí firmy ani převést
--        do jiné firmy; připojení pobočky jen k účtu té pobočky; účet
--        s připojením pobočky se nepřestěhuje;
--   4. přístupové údaje k bance se přihlášenému nevydají (RPC ani select,
--      ani po přepnutí oblasti připojení), server ověří právo bez šifry
--      (integrace_overit_spravu);
--   5. v omezeních zdroje není jméno banky, `banka_api` projde, staré
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

-- Každé id, které kdy přišlo ze stažení z banky — pro kontrolu „žádné id
-- se neztratí" na konci oddílu 2b. Stažení v tomhle scénáři jde JEN přes
-- pg_temp.stahnout.
create temp table k111_stazena_id (ucet_id uuid not null, externi_id text not null);

create or replace function pg_temp.stahnout(p_tenant uuid, p_ucet uuid, p_hash text, p_radky jsonb)
returns integer language plpgsql as $$
begin
  insert into k111_stazena_id (ucet_id, externi_id)
  select p_ucet, x ->> 'externi_id'
    from jsonb_array_elements(p_radky) x
   where nullif(btrim(x ->> 'externi_id'), '') is not null;
  return pg_temp.importovat(p_tenant, p_ucet, 'banka_api', p_hash, p_radky);
end $$;

-- Řádek ve tvaru, jaký dává banka (Salt Edge: protiúčet i VS prázdné).
-- Bez id = řádek výpisu.
create or replace function pg_temp.r(p_datum text, p_id text default null, p_castka integer default 500,
                                     p_protistrana text default 'Poplatek')
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'datum', p_datum, 'smer', 'vydaj', 'castka_haleru', p_castka, 'mena', 'CZK',
    'protistrana', p_protistrana, 'protiucet', '', 'vs', '', 'poznamka', '', 'externi_id', p_id))
$$;

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
--   Petr    — finance.read + finance.manage + integrace.manage jen na P1;
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
  (:'firma_a', :'z_fin', 'integrace.manage'),
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

-- Účty firmy A bez pobočky jen na dvojí zápis (oddíl 2b) — každý případ
-- na vlastním účtu, počty se neplétou.
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 B1', 'banka') returning id as u_b1 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 B2', 'banka') returning id as u_b2 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 B3', 'banka') returning id as u_b3 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 výpis-stažení', 'banka') returning id as u_vs \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 stažení-výpis', 'banka') returning id as u_sv \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 omylem pokladna', 'banka') returning id as u_pokl \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 storno', 'banka') returning id as u_storno \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 vymyšlené id', 'banka') returning id as u_podvrh \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 dvě od banky', 'banka') returning id as u_dve \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 storno a další výpis', 'banka') returning id as u_storno2 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 cizí storno', 'banka') returning id as u_cizi_storno \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 storno potvrzeného', 'banka') returning id as u_storno3 \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_a', null, 'Krok111 storno stažení bez id', 'banka') returning id as u_stbez \gset


\echo ''
\echo '== 1. Zkouška 1: s id pohybu od banky ===================================='

-- Synchronizace běží jako úloha (service_role obchází RLS). Tady jako
-- vlastník databáze: čistý harness nemá výchozí práva Supabase, která
-- service_role dávají zápis do transakce.
select pg_temp.stahnout(:'firma_a', :'u_p1', 'krok111-api-1',
  '[{"datum":"2033-01-05","smer":"prijem","castka_haleru":50000,"mena":"CZK","protistrana":"Host A","protiucet":"CZ6508000000192000145399","vs":"1","poznamka":"","externi_id":"krok111-x1"},
    {"datum":"2033-01-06","smer":"vydaj","castka_haleru":7000,"mena":"CZK","protistrana":"Dodavatel","protiucet":"","vs":"2","poznamka":"","externi_id":"krok111-x2"}]'::jsonb) as api_prvni \gset
select pg_temp.check('první stažení zapíše dva pohyby', :'api_prvni'::int = 2);

select pg_temp.stahnout(:'firma_a', :'u_p1', 'krok111-api-2',
  '[{"datum":"2033-01-05","smer":"prijem","castka_haleru":50000,"mena":"CZK","protistrana":"Host A","protiucet":"CZ6508000000192000145399","vs":"1","poznamka":"","externi_id":"krok111-x1"},
    {"datum":"2033-01-06","smer":"vydaj","castka_haleru":7000,"mena":"CZK","protistrana":"Dodavatel","protiucet":"","vs":"2","poznamka":"","externi_id":"krok111-x2"},
    {"datum":"2033-01-07","smer":"prijem","castka_haleru":800,"mena":"CZK","protistrana":"","protiucet":"","vs":"","poznamka":"","externi_id":"krok111-x3"}]'::jsonb) as api_druhe \gset
select pg_temp.check('druhé stažení se stejnými pohyby přidá jen ten nový (1)', :'api_druhe'::int = 1);
select pg_temp.check('… a pohybů s id x1, x2 je na účtu pořád po jednom',
  (select count(*) from public.transakce where ucet_id = :'u_p1' and externi_id in ('krok111-x1', 'krok111-x2')) = 2);
select pg_temp.check('pohyb s id od banky má obsahový klíč (pozná ho výpis bez id)',
  coalesce((select otisk = app.otisk_pohybu(:'u_p1', '2033-01-05', 'prijem', 50000, 'CZK', '1',
                                            'CZ6508000000192000145399', 'Host A')
              from public.transakce where ucet_id = :'u_p1' and externi_id = 'krok111-x1'), false));
select pg_temp.check('protiúčet se uloží zvlášť od jména protistrany',
  (select protiucet = 'CZ6508000000192000145399' and protistrana = 'Host A'
     from public.transakce where ucet_id = :'u_p1' and externi_id = 'krok111-x1'));
select pg_temp.check('dávka stažení má typ banka_api a počet nových',
  (select typ = 'banka_api' and pocet_novych = 1 and pocet_radku = 3
     from public.import_davky where tenant_id = :'firma_a' and soubor_hash = 'krok111-api-2'));
select pg_temp.stahnout(:'firma_a', :'u_p1', 'krok111-api-3',
  '[{"datum":"2033-01-08","smer":"prijem","castka_haleru":900,"mena":"CZK","protistrana":"Dvakrát","protiucet":"","vs":"","poznamka":"","externi_id":"krok111-x4"},
    {"datum":"2033-01-08","smer":"prijem","castka_haleru":900,"mena":"CZK","protistrana":"Dvakrát","protiucet":"","vs":"","poznamka":"","externi_id":"krok111-x4"}]'::jsonb) as api_dvakrat \gset
select pg_temp.check('totéž id dvakrát v jednom stažení (dvě stránky) = jeden pohyb (1)',
  :'api_dvakrat'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_p1' and externi_id = 'krok111-x4') = 1);


\echo ''
\echo '== 2. Zkouška 1: výpis bez id (obsahový klíč) ============================'

-- Výpis V1: A, B, B (dvě STEJNÉ platby v jednom výpisu).
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v1',
  '[{"datum":"2033-01-10","smer":"vydaj","castka_haleru":12345,"mena":"CZK","protistrana":"Dodavatel A","protiucet":"CZ6508000000192000145399","vs":"111","poznamka":"faktura"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"první"},
    {"datum":"2033-01-11","smer":"vydaj","castka_haleru":9900,"mena":"CZK","protistrana":"Káva s.r.o.","protiucet":"","vs":"","poznamka":"druhá"}]'::jsonb) as v1 \gset
select pg_temp.check('výpis V1 zapíše tři pohyby', :'v1'::int = 3);
select pg_temp.check('dvě stejné platby v jednom výpisu zůstanou dvě',
  (select count(*) from public.transakce where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900) = 2);
select pg_temp.check('… se STEJNÝM obsahovým klíčem (klíč není unikátní, import počítá)',
  (select count(distinct otisk) = 1 and count(*) = 2 from public.transakce
    where ucet_id = :'u_p2' and datum = '2033-01-11' and castka_haleru = 9900 and otisk is not null));
select pg_temp.check('klíč = app.otisk_pohybu (jedna implementace)',
  (select otisk = app.otisk_pohybu(:'u_p2', '2033-01-10', 'vydaj', 12345, 'CZK', '111',
                                   'CZ6508000000192000145399', 'Dodavatel A')
     from public.transakce where ucet_id = :'u_p2' and datum = '2033-01-10'));
select pg_temp.check('poznámka do klíče nepatří, mezery a velikost písmen protistrany ano jen normalizovaně',
  app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'czk', ' ', ' ', '  KÁVA   s.r.o. ')
  = app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'káva s.r.o.')
  and app.otisk_pohybu(:'u_p2', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.')
   <> app.otisk_pohybu(:'u_p1', '2033-01-11', 'vydaj', 9900, 'CZK', '', '', 'Káva s.r.o.'));
select pg_temp.check('index klíče není unikátní (dvě stejné platby smí mít stejný klíč)',
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'transakce_otisk')
  and not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where c.relname = 'transakce_otisk' and i.indisunique));

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
select pg_temp.check('týž řádek na jiném účtu se zapíše (klíč je i z účtu)', :'v1_firma'::int = 1);

-- Prázdné id = bez id.
select pg_temp.importovat(:'firma_a', :'u_p2', 'csv_banka', 'krok111-v4',
  '[{"datum":"2033-01-13","smer":"prijem","castka_haleru":100,"mena":"CZK","protistrana":"Prázdné id","protiucet":"","vs":"","poznamka":"","externi_id":"  "}]'::jsonb) as v4 \gset
select pg_temp.check('prázdné id od banky se bere jako žádné (dostane klíč)',
  (select externi_id is null and otisk is not null from public.transakce
    where ucet_id = :'u_p2' and protistrana = 'Prázdné id'));

-- Starý podpis (stará appka během nasazení, scénář krok76) dál funguje.
insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, stav)
values (:'firma_a', 'banka_csv', 'stary.csv', 'krok111-stary', 'zpracovano') returning id as d_stary \gset
select coalesce(pg_temp.hodnota(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
  :'firma_a', :'u_p2', :'d_stary', 'csv_banka',
  '[{"datum":"2033-01-14","smer":"vydaj","castka_haleru":321,"protistrana":"Bez protiúčtu","vs":"","poznamka":""}]')), '-1') as stary \gset
select pg_temp.check('starý podpis importovat_transakce: řádek bez protiúčtu projde (prázdný protiúčet, klíč)',
  :'stary'::int = 1
  and (select protiucet = '' and otisk is not null from public.transakce where ucet_id = :'u_p2' and protistrana = 'Bez protiúčtu'));


\echo ''
\echo '== 2b. Dvojí zápis: výpis a stažení z banky ============================='

-- Zásada: pohyb stažený z banky (s id od banky) se NIKDY nezahodí kvůli
-- obsahu jiného řádku. Viditelná dvojice je přijatelná, ztracená platba
-- ne. Dvě stejné platby téhož dne (500 Kč „Poplatek"): banka stahuje po
-- stránkách nebo od poledne, výpis je celodenní nebo z půlky dne.

-- B1: stránky stažení zvlášť (Salt Edge), potom celodenní výpis bez id.
select pg_temp.stahnout(:'firma_a', :'u_b1', 'krok111-b1-s1', jsonb_build_array(pg_temp.r('2033-06-01', 'krok111-b1-x'))) as b1_s1 \gset
select pg_temp.stahnout(:'firma_a', :'u_b1', 'krok111-b1-s2', jsonb_build_array(pg_temp.r('2033-06-01', 'krok111-b1-y'))) as b1_s2 \gset
select pg_temp.importovat(:'firma_a', :'u_b1', 'csv_banka', 'krok111-b1-v',
  jsonb_build_array(pg_temp.r('2033-06-01'), pg_temp.r('2033-06-01'))) as b1_v \gset
select pg_temp.check('B1: stránky stažení zvlášť zapíšou obě platby, celodenní výpis potom nic (1/1/0, na účtu 2)',
  :'b1_s1'::int = 1 and :'b1_s2'::int = 1 and :'b1_v'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_b1') = 2);

-- B2: výpis z půlky dne (jen první platba), potom stránky stažení
-- (první, druhá) a znovu totéž.
select pg_temp.importovat(:'firma_a', :'u_b2', 'csv_banka', 'krok111-b2-v',
  jsonb_build_array(pg_temp.r('2033-06-02'))) as b2_v \gset
select pg_temp.stahnout(:'firma_a', :'u_b2', 'krok111-b2-s1', jsonb_build_array(pg_temp.r('2033-06-02', 'krok111-b2-x'))) as b2_s1 \gset
-- Hned po první stránce (dřív, než druhá stránka nárok využije): bez
-- zapsaného potvrzení by si druhá stránka zabrala týž řádek výpisu
-- a druhá platba by se ztratila — tahle kontrola řekne proč.
select pg_temp.check('B2: první stránka jen POTVRDÍ řádek výpisu (potvrzení s id banky, ne nový pohyb)',
  :'b2_v'::int = 1 and :'b2_s1'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_b2') = 1
  and (select count(*) from public.transakce_potvrzeni_banky b
         join public.transakce t on t.id = b.transakce_id
        where b.ucet_id = :'u_b2' and b.externi_id = 'krok111-b2-x' and t.zdroj = 'csv_banka') = 1);
select pg_temp.stahnout(:'firma_a', :'u_b2', 'krok111-b2-s2', jsonb_build_array(pg_temp.r('2033-06-02', 'krok111-b2-y'))) as b2_s2 \gset
select pg_temp.check('B2: výpis z půlky dne, pak stránky stažení — druhá platba se zapíše (1/0/1, na účtu 2)',
  :'b2_v'::int = 1 and :'b2_s1'::int = 0 and :'b2_s2'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_b2') = 2
  and exists (select 1 from public.transakce where ucet_id = :'u_b2' and zdroj = 'banka_api' and externi_id = 'krok111-b2-y'));
select pg_temp.stahnout(:'firma_a', :'u_b2', 'krok111-b2-s1b', jsonb_build_array(pg_temp.r('2033-06-02', 'krok111-b2-x'))) as b2_s1b \gset
select pg_temp.stahnout(:'firma_a', :'u_b2', 'krok111-b2-s2b', jsonb_build_array(pg_temp.r('2033-06-02', 'krok111-b2-y'))) as b2_s2b \gset
select pg_temp.check('B2: opakované stránky stažení nic nepřidají (0/0, na účtu 2, potvrzení 1)',
  :'b2_s1b'::int = 0 and :'b2_s2b'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_b2') = 2
  and (select count(*) from public.transakce_potvrzeni_banky where ucet_id = :'u_b2') = 1);

-- B3: KB, okno od poledne. Poledne: X. Celodenní výpis: X, Y. Běh
-- s celým dnem: X, Y. Další běh od poledne: jen Y.
select pg_temp.stahnout(:'firma_a', :'u_b3', 'krok111-b3-1', jsonb_build_array(pg_temp.r('2033-06-03', 'krok111-b3-x'))) as b3_1 \gset
select pg_temp.importovat(:'firma_a', :'u_b3', 'csv_banka', 'krok111-b3-v',
  jsonb_build_array(pg_temp.r('2033-06-03'), pg_temp.r('2033-06-03'))) as b3_v \gset
select pg_temp.stahnout(:'firma_a', :'u_b3', 'krok111-b3-2',
  jsonb_build_array(pg_temp.r('2033-06-03', 'krok111-b3-x'), pg_temp.r('2033-06-03', 'krok111-b3-y'))) as b3_2 \gset
select pg_temp.stahnout(:'firma_a', :'u_b3', 'krok111-b3-3', jsonb_build_array(pg_temp.r('2033-06-03', 'krok111-b3-y'))) as b3_3 \gset
select pg_temp.check('B3: stažení od poledne, celodenní výpis, další stažení — na účtu 2, ne 3 (1/1/0/0)',
  :'b3_1'::int = 1 and :'b3_v'::int = 1 and :'b3_2'::int = 0 and :'b3_3'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_b3') = 2);
select pg_temp.check('B3: druhou platbu (Y) banka jen potvrdila u řádku výpisu',
  exists (select 1 from public.transakce_potvrzeni_banky where ucet_id = :'u_b3' and externi_id = 'krok111-b3-y'));

-- Výpis → stažení: výpis se dvěma stejnými platbami, potom jedno stažení
-- s oběma; pak všechno znovu.
select pg_temp.importovat(:'firma_a', :'u_vs', 'csv_banka', 'krok111-vs-v',
  jsonb_build_array(pg_temp.r('2033-06-04'), pg_temp.r('2033-06-04'), pg_temp.r('2033-06-05', null, 700))) as vs_v \gset
select pg_temp.stahnout(:'firma_a', :'u_vs', 'krok111-vs-s',
  jsonb_build_array(pg_temp.r('2033-06-04', 'krok111-vs-a'), pg_temp.r('2033-06-04', 'krok111-vs-b'),
                    pg_temp.r('2033-06-06', 'krok111-vs-c', 800))) as vs_s \gset
select pg_temp.check('výpis → stažení: tytéž dvě platby se nezapíšou znovu, jen nová (3/1, na účtu 4)',
  :'vs_v'::int = 3 and :'vs_s'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_vs') = 4);
select pg_temp.check('výpis → stažení: oba řádky výpisu s 2. 6. mají potvrzení banky, každý jiné id',
  (select count(distinct b.externi_id) from public.transakce t
     join public.transakce_potvrzeni_banky b on b.transakce_id = t.id
    where t.ucet_id = :'u_vs' and t.datum = '2033-06-04' and t.zdroj = 'csv_banka') = 2);
select pg_temp.stahnout(:'firma_a', :'u_vs', 'krok111-vs-s2',
  jsonb_build_array(pg_temp.r('2033-06-04', 'krok111-vs-a'), pg_temp.r('2033-06-04', 'krok111-vs-b'),
                    pg_temp.r('2033-06-06', 'krok111-vs-c', 800))) as vs_s2 \gset
select pg_temp.importovat(:'firma_a', :'u_vs', 'csv_banka', 'krok111-vs-v2',
  jsonb_build_array(pg_temp.r('2033-06-04'), pg_temp.r('2033-06-04'), pg_temp.r('2033-06-05', null, 700),
                    pg_temp.r('2033-06-06', null, 800))) as vs_v2 \gset
select pg_temp.check('opakované stažení i výpis nic nepřidají (0/0, na účtu 4, potvrzení 2)',
  :'vs_s2'::int = 0 and :'vs_v2'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_vs') = 4
  and (select count(*) from public.transakce_potvrzeni_banky where ucet_id = :'u_vs') = 2);

-- Stažení → výpis: dvě stejné platby s různým id, potom výpis s oběma.
select pg_temp.stahnout(:'firma_a', :'u_sv', 'krok111-sv-s',
  jsonb_build_array(pg_temp.r('2033-06-07', 'krok111-sv-a'), pg_temp.r('2033-06-07', 'krok111-sv-b'))) as sv_s \gset
select pg_temp.importovat(:'firma_a', :'u_sv', 'csv_banka', 'krok111-sv-v',
  jsonb_build_array(pg_temp.r('2033-06-07'), pg_temp.r('2033-06-07'), pg_temp.r('2033-06-08'))) as sv_v \gset
select pg_temp.check('stažení → výpis: tytéž dvě platby výpis znovu nezapíše, jen novou (2/1, na účtu 3)',
  :'sv_s'::int = 2 and :'sv_v'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_sv') = 3);

-- Dvě stejné platby od banky s různým id, každá v jiném stažení (banka je
-- mezi staženími pošle v jiném pořadí).
select pg_temp.stahnout(:'firma_a', :'u_dve', 'krok111-dve-1', jsonb_build_array(pg_temp.r('2033-06-09', 'krok111-dve-a'))) as dve_1 \gset
select pg_temp.stahnout(:'firma_a', :'u_dve', 'krok111-dve-2',
  jsonb_build_array(pg_temp.r('2033-06-09', 'krok111-dve-b'), pg_temp.r('2033-06-09', 'krok111-dve-a'))) as dve_2 \gset
select pg_temp.check('dvě stejné platby od banky s různým id jsou dvě (1/1, na účtu 2)',
  :'dve_1'::int = 1 and :'dve_2'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_dve' and zdroj = 'banka_api') = 2);

-- Výpis omylem nahraný jako pokladní uzávěrka: pokladní řádky se do
-- kontroly dvojího zápisu banky nepočítají — pohyb z banky se zapíše.
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-v',
  jsonb_build_array(pg_temp.r('2033-06-10'))) as pokl_v \gset
select pg_temp.stahnout(:'firma_a', :'u_pokl', 'krok111-pokl-s', jsonb_build_array(pg_temp.r('2033-06-10', 'krok111-pokl-a'))) as pokl_s \gset
select pg_temp.check('výpis omylem jako pokladní uzávěrka, pak stažení: pohyb z banky se zapíše (1/1)',
  :'pokl_v'::int = 1 and :'pokl_s'::int = 1
  and exists (select 1 from public.transakce where ucet_id = :'u_pokl' and zdroj = 'banka_api' and externi_id = 'krok111-pokl-a'));
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-v2',
  jsonb_build_array(pg_temp.r('2033-06-10'))) as pokl_v2 \gset
select pg_temp.check('… a pokladní uzávěrka se počítá jen proti pokladním: znovu nahraná nic nepřidá (0)',
  :'pokl_v2'::int = 0);
-- A obráceně: pohyb z banky pokladní uzávěrku se stejným obsahem
-- nezablokuje — pokladní uzávěrka se počítá jen proti pokladním.
select pg_temp.stahnout(:'firma_a', :'u_pokl', 'krok111-pokl-s4', jsonb_build_array(pg_temp.r('2033-06-08', 'krok111-pokl-b'))) as pokl_s4 \gset
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-v4',
  jsonb_build_array(pg_temp.r('2033-06-08'))) as pokl_v4 \gset
select pg_temp.check('pohyb z banky, pak pokladní uzávěrka se stejným obsahem: uzávěrka se zapíše (1/1)',
  :'pokl_s4'::int = 1 and :'pokl_v4'::int = 1);
-- Stažení BEZ id se počítá podle obsahu (žádný nárok) — ani tam se
-- pokladní uzávěrka nepočítá, jinak by pohyb z banky zablokovala.
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-v3',
  jsonb_build_array(pg_temp.r('2033-06-09'))) as pokl_v3 \gset
select pg_temp.stahnout(:'firma_a', :'u_pokl', 'krok111-pokl-s3', jsonb_build_array(pg_temp.r('2033-06-09'))) as pokl_s3 \gset
select pg_temp.check('pokladní uzávěrka, pak stažení BEZ id: pohyb z banky se zapíše (1/1)',
  :'pokl_v3'::int = 1 and :'pokl_s3'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_pokl' and zdroj = 'banka_api' and datum = '2033-06-09') = 1);

-- Stornovaný řádek výpisu pohyb z banky nezablokuje.
-- (Storna tu mají opačný směr než stornovaný výdaj — od kroku 2,
-- 20261120100000, to hlídá spoušť trg_transakce_storno_kontrola.)
select pg_temp.importovat(:'firma_a', :'u_storno', 'csv_banka', 'krok111-storno-v',
  jsonb_build_array(pg_temp.r('2033-06-11'))) as storno_v \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_storno', 'prijem', 500, '2033-06-11', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_storno' and t.zdroj = 'csv_banka';
select pg_temp.stahnout(:'firma_a', :'u_storno', 'krok111-storno-s', jsonb_build_array(pg_temp.r('2033-06-11', 'krok111-storno-a'))) as storno_s \gset
select pg_temp.check('stornovaný řádek výpisu, pak stažení: pohyb z banky se zapíše (1/1)',
  :'storno_v'::int = 1 and :'storno_s'::int = 1
  and exists (select 1 from public.transakce where ucet_id = :'u_storno' and zdroj = 'banka_api' and externi_id = 'krok111-storno-a'));
-- … ani stažení BEZ id (počítá se podle obsahu): stornovaný řádek výpisu
-- proti stažení z banky místo nedrží.
select pg_temp.importovat(:'firma_a', :'u_storno', 'csv_banka', 'krok111-storno-v4',
  jsonb_build_array(pg_temp.r('2033-06-19'))) as stn_v \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_storno', 'prijem', 500, '2033-06-19', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_storno' and t.zdroj = 'csv_banka' and t.datum = '2033-06-19';
select pg_temp.stahnout(:'firma_a', :'u_storno', 'krok111-storno-s4', jsonb_build_array(pg_temp.r('2033-06-19'))) as stn_s \gset
select pg_temp.check('stornovaný řádek výpisu, pak stažení BEZ id: pohyb z banky se zapíše (1/1)',
  :'stn_v'::int = 1 and :'stn_s'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_storno' and zdroj = 'banka_api' and datum = '2033-06-19') = 1);

-- Storno drží proti dalšímu VÝPISU (kontrola 23. 11.). Případ z kontroly:
-- výpis „NOVAK JAN", banka stáhne týž pohyb jako „Jan Novák" (jiný klíč)
-- → viditelná dvojice; majitelka stornuje řádek výpisu; pak navazující
-- výpis (jiný soubor, překryv o den). Dřív se stornovaný řádek vrátil
-- a dvojice s ním.
select pg_temp.importovat(:'firma_a', :'u_storno2', 'csv_banka', 'krok111-st2-v1',
  jsonb_build_array(pg_temp.r('2033-06-15', null, 600, 'NOVAK JAN'))) as st2_v1 \gset
select pg_temp.stahnout(:'firma_a', :'u_storno2', 'krok111-st2-s',
  jsonb_build_array(pg_temp.r('2033-06-15', 'krok111-st2-x', 600, 'Jan Novák'))) as st2_s \gset
select coalesce((select id::text from public.transakce
                  where ucet_id = :'u_storno2' and zdroj = 'csv_banka' and protistrana = 'NOVAK JAN'), '') as t_st2 \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitelka stornuje řádek výpisu svého účtu přímým zápisem (storno na témže účtu projde)',
  pg_temp.projde(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of) values (%L, %L, %L, 600, %L, %L, %L)',
    :'firma_a', :'u_storno2', 'prijem', '2033-06-15', 'rucni', :'t_st2')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.importovat(:'firma_a', :'u_storno2', 'csv_banka', 'krok111-st2-v2',
  jsonb_build_array(pg_temp.r('2033-06-15', null, 600, 'NOVAK JAN'), pg_temp.r('2033-06-16', null, 600, 'Další'))) as st2_v2 \gset
select pg_temp.check('storno řádku výpisu, pak překrývající se výpis: stornovaný řádek se nevrátí, zapíše se jen nový (1/1/1, NOVAK JAN jednou)',
  :'st2_v1'::int = 1 and :'st2_s'::int = 1 and :'st2_v2'::int = 1
  and (select count(*) from public.transakce
        where ucet_id = :'u_storno2' and zdroj = 'csv_banka' and protistrana = 'NOVAK JAN') = 1);

-- Dvě stejné platby téhož dne: výpis z půlky dne má první, majitelka ji
-- stornuje, celodenní výpis má obě. Stornovaná drží své místo — doplní
-- se jen druhá.
select pg_temp.importovat(:'firma_a', :'u_storno2', 'csv_banka', 'krok111-st3-v1',
  jsonb_build_array(pg_temp.r('2033-06-17'))) as st3_v1 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_storno2', 'prijem', 500, '2033-06-17', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_storno2' and t.zdroj = 'csv_banka' and t.datum = '2033-06-17';
select pg_temp.importovat(:'firma_a', :'u_storno2', 'csv_banka', 'krok111-st3-v2',
  jsonb_build_array(pg_temp.r('2033-06-17'), pg_temp.r('2033-06-17'))) as st3_v2 \gset
select pg_temp.check('dvě stejné platby, storno první, celodenní výpis: doplní jen druhou (1/1, řádků výpisu 2)',
  :'st3_v1'::int = 1 and :'st3_v2'::int = 1
  and (select count(*) from public.transakce
        where ucet_id = :'u_storno2' and zdroj = 'csv_banka' and datum = '2033-06-17') = 2);

-- Totéž u pokladní uzávěrky: stornovaná drží místo proti uzávěrkám.
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-st1',
  jsonb_build_array(pg_temp.r('2033-06-18'))) as pokl_st1 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_pokl', 'prijem', 500, '2033-06-18', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_pokl' and t.zdroj = 'csv_pokladna' and t.datum = '2033-06-18';
select pg_temp.importovat(:'firma_a', :'u_pokl', 'csv_pokladna', 'krok111-pokl-st2',
  jsonb_build_array(pg_temp.r('2033-06-18'))) as pokl_st2 \gset
select pg_temp.check('storno pokladní uzávěrky, pak táž uzávěrka znovu: nic nepřidá (1/0)',
  :'pokl_st1'::int = 1 and :'pokl_st2'::int = 0);

-- ROZHODNOUT (migrace, hlavička): storno pohybu z BANKY výpis se stejným
-- obsahem nezastaví — řádek výpisu se zapíše (dvojice raději než
-- chybějící platba). Opakované stažení téhož id nic nepřidá.
select pg_temp.stahnout(:'firma_a', :'u_storno', 'krok111-storno-s5',
  jsonb_build_array(pg_temp.r('2033-06-20', 'krok111-storno-b'))) as stb_s \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_storno', 'prijem', 500, '2033-06-20', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_storno' and t.zdroj = 'banka_api' and t.externi_id = 'krok111-storno-b';
select pg_temp.importovat(:'firma_a', :'u_storno', 'csv_banka', 'krok111-storno-v5',
  jsonb_build_array(pg_temp.r('2033-06-20'))) as stb_v \gset
select pg_temp.stahnout(:'firma_a', :'u_storno', 'krok111-storno-s6',
  jsonb_build_array(pg_temp.r('2033-06-20', 'krok111-storno-b'))) as stb_s2 \gset
-- „Opakované stažení nic" se nedá měřit jen počtem nových: potvrzení se do
-- něj nepočítá. Kdyby stažení id stornovaného pohybu nepoznalo, nárokovalo
-- by si právě zapsaný řádek výpisu a id by bylo na účtu dvakrát (kontrola
-- 23. 11.) — proto i id jednou a žádné potvrzení s ním.
select pg_temp.check('stornovaný pohyb z banky, pak výpis se stejným obsahem: řádek výpisu se zapíše, opakované stažení nic (1/1/0, id jednou, bez potvrzení)',
  :'stb_s'::int = 1 and :'stb_v'::int = 1 and :'stb_s2'::int = 0
  and (select count(*) from public.transakce
        where ucet_id = :'u_storno' and zdroj = 'banka_api' and externi_id = 'krok111-storno-b') = 1
  and (select count(*) from public.transakce_potvrzeni_banky
        where ucet_id = :'u_storno' and externi_id = 'krok111-storno-b') = 0);

-- Storno pohybu ze stažení BEZ id drží proti dalšímu stažení bez id
-- (kontrola 23. 11.; ROZHODNOUT v migraci). Dřív se stornovaný pohyb
-- vrátil s každým stažením bez id, které ten den pokrývá. Storno ale
-- počítání nemění: celodenní stažení se dvěma stejnými platbami doplní
-- druhou.
select pg_temp.stahnout(:'firma_a', :'u_stbez', 'krok111-stbez-1',
  jsonb_build_array(pg_temp.r('2033-06-24', null, 500, 'Beta'))) as stbez_1 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_stbez', 'prijem', 500, '2033-06-24', 'rucni', t.id
  from public.transakce t where t.ucet_id = :'u_stbez' and t.zdroj = 'banka_api';
select pg_temp.stahnout(:'firma_a', :'u_stbez', 'krok111-stbez-2',
  jsonb_build_array(pg_temp.r('2033-06-24', null, 500, 'Beta'))) as stbez_2 \gset
select pg_temp.check('storno pohybu ze stažení bez id, pak totéž stažení bez id: pohyb se nevrátí (1/0, pohyb z banky jeden a stornovaný)',
  :'stbez_1'::int = 1 and :'stbez_2'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_stbez' and zdroj = 'banka_api') = 1
  and (select count(*) from public.transakce s
         join public.transakce t on t.id = s.storno_of
        where s.ucet_id = :'u_stbez' and t.zdroj = 'banka_api') = 1);
select pg_temp.stahnout(:'firma_a', :'u_stbez', 'krok111-stbez-3',
  jsonb_build_array(pg_temp.r('2033-06-24', null, 500, 'Beta'), pg_temp.r('2033-06-24', null, 500, 'Beta'))) as stbez_3 \gset
select pg_temp.check('… stažení bez id se dvěma stejnými platbami pak doplní právě druhou (1, pohybů z banky 2)',
  :'stbez_3'::int = 1
  and (select count(*) from public.transakce where ucet_id = :'u_stbez' and zdroj = 'banka_api') = 2);

-- Storno řádku výpisu, který banka už POTVRDILA (kontrola 23. 11.): výpis,
-- stažení s id ho potvrdí, majitelka ho pak stornuje (dvojice s ruční
-- platbou), přijde překrývající se výpis. Stornovaný potvrzený řádek drží
-- místo proti výpisu stejně jako nepotvrzený. (Kontrola „každé potvrzení
-- ukazuje na nestornovaný řádek výpisu" níž tohle id proto vynechává.)
select pg_temp.importovat(:'firma_a', :'u_storno3', 'csv_banka', 'krok111-sp-v1',
  jsonb_build_array(pg_temp.r('2033-06-22'))) as sp_v1 \gset
select pg_temp.stahnout(:'firma_a', :'u_storno3', 'krok111-sp-s1',
  jsonb_build_array(pg_temp.r('2033-06-22', 'krok111-sp-x'))) as sp_s1 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
select :'firma_a', :'u_storno3', 'prijem', 500, '2033-06-22', 'rucni', t.id
  from public.transakce t
  join public.transakce_potvrzeni_banky b on b.transakce_id = t.id
 where t.ucet_id = :'u_storno3' and t.zdroj = 'csv_banka' and b.externi_id = 'krok111-sp-x';
select pg_temp.importovat(:'firma_a', :'u_storno3', 'csv_banka', 'krok111-sp-v2',
  jsonb_build_array(pg_temp.r('2033-06-22'), pg_temp.r('2033-06-23'))) as sp_v2 \gset
select pg_temp.check('storno řádku výpisu potvrzeného bankou, pak překrývající se výpis: nevrátí se, zapíše se jen nový den (1/0/1, řádků výpisu 22. 6. jeden)',
  :'sp_v1'::int = 1 and :'sp_s1'::int = 0 and :'sp_v2'::int = 1
  and (select count(*) from public.transakce s
         join public.transakce_potvrzeni_banky b on b.transakce_id = s.storno_of
        where s.ucet_id = :'u_storno3' and b.externi_id = 'krok111-sp-x') = 1
  and (select count(*) from public.transakce
        where ucet_id = :'u_storno3' and zdroj = 'csv_banka' and datum = '2033-06-22') = 1);
select pg_temp.stahnout(:'firma_a', :'u_storno3', 'krok111-sp-s2',
  jsonb_build_array(pg_temp.r('2033-06-22', 'krok111-sp-x'))) as sp_s2 \gset
select pg_temp.check('… totéž id ze stažení znovu nic nezapíše ani nepotvrdí (0, pohyb z banky žádný, potvrzení jedno)',
  :'sp_s2'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_storno3' and zdroj = 'banka_api') = 0
  and (select count(*) from public.transakce_potvrzeni_banky where ucet_id = :'u_storno3') = 1);
-- ROZHODNOUT (migrace, hlavička): stornovaný potvrzený řádek je pořád
-- řádek výpisu — proti stažení BEZ id místo nedrží. Stažení bez id ho
-- jednou vrátí jako pohyb z banky, další už nic. Dnes nedosažitelné
-- (žádný konektor nedává řádek bez id).
select pg_temp.stahnout(:'firma_a', :'u_storno3', 'krok111-sp-s3',
  jsonb_build_array(pg_temp.r('2033-06-22'))) as sp_s3 \gset
select pg_temp.stahnout(:'firma_a', :'u_storno3', 'krok111-sp-s4',
  jsonb_build_array(pg_temp.r('2033-06-22'))) as sp_s4 \gset
select pg_temp.check('stornovaný potvrzený řádek výpisu stažení bez id jednou vrátí jako pohyb z banky, podruhé nic (1/0, ROZHODNOUT)',
  :'sp_s3'::int = 1 and :'sp_s4'::int = 0
  and (select count(*) from public.transakce
        where ucet_id = :'u_storno3' and zdroj = 'banka_api' and datum = '2033-06-22') = 1);

-- Řádek výpisu, jehož storno zkusí zapsat majitel cizí firmy (oddíl 4);
-- stažení téhož pohybu až za oddílem 4.
select pg_temp.importovat(:'firma_a', :'u_cizi_storno', 'csv_banka', 'krok111-cs-v',
  jsonb_build_array(pg_temp.r('2033-06-21'))) as cs_v \gset
select coalesce((select id::text from public.transakce
                  where ucet_id = :'u_cizi_storno' and zdroj = 'csv_banka'), '') as t_cizi_storno \gset

-- Pokladna (`pos_adapter`) a výpis se sloupcem „Externí ID" s id, které
-- banka teprve pošle: pohyb z banky se zapíše (id jen v rámci zdroje).
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id, protistrana)
values (:'firma_a', :'u_podvrh', 'vydaj', 500, '2033-06-12', 'pos_adapter', 'krok111-pv-a', 'Poplatek');
select pg_temp.importovat(:'firma_a', :'u_podvrh', 'csv_banka', 'krok111-pv-v',
  jsonb_build_array(pg_temp.r('2033-06-13', 'krok111-pv-b', 999))) as pv_v \gset
select pg_temp.stahnout(:'firma_a', :'u_podvrh', 'krok111-pv-s',
  jsonb_build_array(pg_temp.r('2033-06-12', 'krok111-pv-a'), pg_temp.r('2033-06-13', 'krok111-pv-b'))) as pv_s \gset
select pg_temp.check('pokladna a výpis s vymyšleným id, pak stažení: oba pohyby z banky se zapíšou (1/2)',
  :'pv_v'::int = 1 and :'pv_s'::int = 2
  and (select count(*) from public.transakce
        where ucet_id = :'u_podvrh' and zdroj = 'banka_api' and externi_id in ('krok111-pv-a', 'krok111-pv-b')) = 2);
select pg_temp.check('id od banky je unikátní v rámci zdroje (ucet_id, zdroj, externi_id)',
  (select pg_get_indexdef(c.oid) like '%(ucet_id, zdroj, externi_id)%' and i.indisunique
     from pg_class c join pg_index i on i.indexrelid = c.oid
    where c.relname = 'transakce_externi_id'));

-- Starý výpis z doby PŘED touhle migrací (bez klíče) dostal klíč dopočtem
-- — tady se jen ověří, že každý pohyb z importu klíč má.
select pg_temp.check('každý pohyb z importu (výpis, stažení, pokladní uzávěrka) má klíč, ruční a pokladna ne',
  not exists (select 1 from public.transakce
               where tenant_id = :'firma_a'
                 and ((zdroj in ('banka_api', 'csv_banka', 'csv_pokladna') and otisk is null)
                   or (zdroj in ('rucni', 'pos_adapter') and otisk is not null))));

-- Výpis uložený v Excelu: úvodní nuly VS zmizí („0012345" → „12345").
select pg_temp.importovat(:'firma_a', :'u_firma', 'csv_banka', 'krok111-e1',
  '[{"datum":"2033-05-12","smer":"vydaj","castka_haleru":2500,"mena":"CZK","protistrana":"Dodavatel E","protiucet":"CZ6508000000192000145399","vs":"0012345","poznamka":""}]'::jsonb) as e1 \gset
select pg_temp.importovat(:'firma_a', :'u_firma', 'csv_banka', 'krok111-e2',
  '[{"datum":"2033-05-12","smer":"vydaj","castka_haleru":2500,"mena":"CZK","protistrana":"Dodavatel E","protiucet":"CZ6508000000192000145399","vs":"12345","poznamka":""}]'::jsonb) as e2 \gset
select pg_temp.check('týž výpis po uložení v Excelu (VS bez úvodních nul) nic nepřidá',
  :'e1'::int = 1 and :'e2'::int = 0);

-- Klíč nesmí záviset na nastavení relace (jiný klient, ruční skript).
select app.otisk_pohybu(:'u_firma', '2033-05-02', 'vydaj', 1, 'CZK', '', '', 'x') as otisk_iso \gset
set datestyle = 'SQL, DMY';
select pg_temp.check('klíč nezávisí na DateStyle relace (datum přes to_char)',
  app.otisk_pohybu(:'u_firma', '2033-05-02', 'vydaj', 1, 'CZK', '', '', 'x') = :'otisk_iso');
reset datestyle;

-- Souběh: import se řadí zámkem na účet, a to SAMOSTATNÝM příkazem před
-- roztříděním (další příkaz už vidí, co zapsal souběžný import).
select pg_temp.check('importovat_transakce: zámek účtu samostatným příkazem PŘED roztříděním řádků',
  (select position(z in d) > 0 and position(z in d) < position('from app.import_roztridit' in d)
     from (select pg_get_functiondef('public.importovat_transakce(uuid, uuid, uuid, text, jsonb)'::regprocedure) as d,
                  'perform pg_advisory_xact_lock(hashtextextended(''transakce:'' || p_ucet::text, 0));' as z) x));



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
select pg_temp.check('otisk bez dávky databáze nepustí (23514)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, otisk) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-02', 'csv_banka', 'podvrzeny-otisk'), '23514', 'transakce_otisk_jen_z_importu'));

-- Ruční zápis nemá nic z importu (id od banky, dávku, klíč).
select pg_temp.check('importovat_transakce ruční zdroj odmítne (23514)',
  pg_temp.spadne_hlaskou(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', :'d_stary', 'rucni',
    '[{"datum":"2033-02-02","smer":"prijem","castka_haleru":5,"protistrana":"Zabraný otisk","vs":"","poznamka":""}]'),
    '23514', 'zdroje'));
select pg_temp.check('ruční zápis s id pohybu od banky databáze nepustí (23514)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-02', 'rucni', 'krok111-zabrane-id'), '23514', 'transakce_rucni_bez_importu'));
select pg_temp.check('ruční zápis s dávkou importu databáze nepustí (23514)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, import_davka_id) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-02', 'rucni', :'d_stary'), '23514', 'transakce_rucni_bez_importu'));

-- Dávka cizí firmy: import ani potvrzení z banky ji nepřijmou.
insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, stav)
values (:'firma_b', 'banka_csv', 'cizi.csv', 'krok111-cizi', 'zpracovano') returning id as d_cizi \gset
select pg_temp.check('import do dávky cizí firmy spadne (spoušť, 23514)',
  pg_temp.spadne_hlaskou(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', :'d_cizi', 'csv_banka',
    '[{"datum":"2033-02-05","smer":"prijem","castka_haleru":5,"protistrana":"Cizí dávka","vs":"","poznamka":""}]'),
    '23514', 'Importní dávka nepatří'));
select id as t_sv_volny from public.transakce where ucet_id = :'u_sv' and zdroj = 'csv_banka' \gset
-- Storno jen na témže účtu (složený cizí klíč) — jinak by storno z jiného
-- účtu (i jiné firmy) vyřadilo náš řádek výpisu z nároku synchronizace.
select pg_temp.check('storno pohybu jiného účtu databáze nepustí (23503, storno jen na témže účtu)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_b1', 'vydaj', '2033-02-07', 'rucni', :'t_sv_volny'), '23503', 'transakce_storno_tez_ucet'));
select pg_temp.check('potvrzení z banky k řádku jiného účtu databáze nepustí (složený cizí klíč, 23503)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce_potvrzeni_banky (tenant_id, ucet_id, transakce_id, externi_id, import_davka_id) values (%L, %L, %L, %L, %L)',
    :'firma_a', :'u_b1', :'t_sv_volny', 'krok111-fk-1', :'d_stary'), '23503', ''));
select pg_temp.check('potvrzení z banky s dávkou cizí firmy databáze nepustí (23503)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce_potvrzeni_banky (tenant_id, ucet_id, transakce_id, externi_id, import_davka_id) values (%L, %L, %L, %L, %L)',
    :'firma_a', :'u_sv', :'t_sv_volny', 'krok111-fk-2', :'d_cizi'), '23503', ''));


\echo ''
\echo '== 4. Import a přímý zápis přihlášeného ================================='

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
-- Řádek výpisu bez potvrzení na u_sv existuje — „stažení" přihlášeného by
-- zapsalo jen potvrzení (žádný nový pohyb). Spoušť zdroje tu nepomůže
-- (žádný řádek transakce), první linie je jen podmínka v importu; grant
-- a RLS potvrzení jsou druhá linie — proto se čeká hláška importu.
-- (Kontrolu výš drží i spoušť zdroje; tahle padne, i když import
-- podmínku ztratí a potvrzení by někdo omylem dal právo zápisu.)
select pg_temp.check('… ani stažení, které by jen potvrdilo řádek výpisu (42501, potvrzení zapíše jen služba)',
  pg_temp.spadne_hlaskou(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_sv', :'d_stary', 'banka_api', jsonb_build_array(pg_temp.r('2033-06-08', 'krok111-maj-potvrzeni'))::text),
    '42501', 'synchronizace'));
select pg_temp.check('majitel nezapíše potvrzení z banky přímo (42501, bez práva zápisu)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce_potvrzeni_banky (tenant_id, ucet_id, transakce_id, externi_id, import_davka_id) values (%L, %L, %L, %L, %L)',
    :'firma_a', :'u_sv', :'t_sv_volny', 'krok111-maj-potvrzeni', :'d_stary'), '42501', 'permission denied'));
-- Přímý zápis (REST) jen ruční platby. Výpis a pokladní uzávěrka jen přes
-- import — řádek „výpisu" s vymyšleným obsahem a id by jinak párování
-- faktur bralo jako platbu z banky.
select pg_temp.check('majitel: „výpis" (csv_banka) přímým zápisem nezapíše (42501, jen import)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-04', 'csv_banka', 'krok111-budouci-id'), '42501', 'import výpisu'));
select pg_temp.check('majitel: pokladní uzávěrku (csv_pokladna) přímým zápisem nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-04', 'csv_pokladna'), '42501', 'import výpisu'));
select pg_temp.check('majitel: pokladnu (pos_adapter) přímým zápisem nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-04', 'pos_adapter', 'krok111-budouci-id'), '42501', 'import výpisu'));
select pg_temp.check('majitel: pohyb „z banky" (banka_api) přímým zápisem nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-04', 'banka_api'), '42501', 'synchronizace'));
select pg_temp.check('majitel: ruční platbu přímým zápisem zapíše',
  pg_temp.projde(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-02-04', 'rucni', 'Krok111 ruční od majitelky')));
-- Příznak importu platí jen během importu: přímý zápis hned po něm (v téže
-- transakci) už neprojde.
select pg_temp.check('příznak importu se hned vrací: přímý zápis výpisu po importu v téže transakci neprojde (42501)',
  pg_temp.spadne_hlaskou(format(
    'with i as (select pg_temp.importovat(%L, %L, %L, %L, %L::jsonb) as n)
     insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana)
     select %L, %L, %L, 1, %L, %L, %L from i where i.n = 1',
    :'firma_a', :'u_p1', 'csv_banka', 'krok111-priznak',
    '[{"datum":"2033-02-06","smer":"prijem","castka_haleru":61,"mena":"CZK","protistrana":"Před přímým zápisem","protiucet":"","vs":"","poznamka":""}]',
    :'firma_a', :'u_p1', 'prijem', '2033-02-06', 'csv_banka', 'Krok111 po importu'),
    '42501', 'import výpisu'));
-- Výpis se sloupcem „Externí ID" smí id mít — pohyb z banky se stejným id
-- ho přesto zapíše (níž, po návratu do role služby).
select pg_temp.check('majitel importuje výpis s „Externí ID", které banka teprve pošle',
  pg_temp.importovat(:'firma_a', :'u_podvrh', 'csv_banka', 'krok111-pv-maj',
    jsonb_build_array(pg_temp.r('2033-06-14', 'krok111-pv-c', 999))) = 1);

select set_config('test.user_id', :'pob1', false);
select pg_temp.check('člověk jedné pobočky výpis neimportuje (dávka jen za celou firmu, 42501)',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_p1', 'csv_banka', 'x', 'krok111-pob1',
    '[{"datum":"2033-02-03","smer":"prijem","castka_haleru":1,"mena":"CZK","protistrana":"x","protiucet":"","vs":"","poznamka":""}]'),
    '42501', ''));
-- Kontrola dvojího zápisu čte pohyby účtu pod RLS — kdo účet nevidí, by
-- je nepoznal a zapsal podruhé. Import takový účet odmítne rovnou.
select pg_temp.check('import na účet, jehož platby přihlášený nevidí, odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
    :'firma_a', :'u_firma', :'d_stary', 'csv_banka',
    '[{"datum":"2033-02-03","smer":"prijem","castka_haleru":1,"protistrana":"x","vs":"","poznamka":""}]'),
    '42501', 'vidíte'));

-- Majitel cizí firmy (Bohdan) zná id našeho řádku výpisu (třeba jako
-- účetní). Na svůj účet si „storno" našeho pohybu nezapíše — jinak by
-- synchronizace naší banky řádek brala jako stornovaný a pohyb zapsala
-- podruhé (kontrola 23. 11.). Stažení téhož pohybu níž.
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('majitel cizí firmy nezapíše na svůj účet storno našeho pohybu (23503, storno jen téže firmy a účtu)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of) values (%L, %L, %L, 500, %L, %L, %L)',
    :'firma_b', :'u_cizi', 'vydaj', '2033-06-21', 'rucni', :'t_cizi_storno'), '23503', 'transakce_storno_tez_ucet'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.stahnout(:'firma_a', :'u_cizi_storno', 'krok111-cs-s',
  jsonb_build_array(pg_temp.r('2033-06-21', 'krok111-cs-x'))) as cs_s \gset
select pg_temp.check('po pokusu o cizí storno stažení téhož pohybu jen potvrdí náš řádek výpisu (1/0, na účtu 1, potvrzení 1)',
  :'cs_v'::int = 1 and :'cs_s'::int = 0
  and (select count(*) from public.transakce where ucet_id = :'u_cizi_storno') = 1
  and (select count(*) from public.transakce_potvrzeni_banky
        where ucet_id = :'u_cizi_storno' and externi_id = 'krok111-cs-x') = 1);

select pg_temp.stahnout(:'firma_a', :'u_podvrh', 'krok111-pv-s2',
  jsonb_build_array(pg_temp.r('2033-06-14', 'krok111-pv-c'))) as pv_s2 \gset
select pg_temp.check('… stažení s tím id pohyb z banky zapíše (1)',
  :'pv_s2'::int = 1
  and exists (select 1 from public.transakce where ucet_id = :'u_podvrh' and zdroj = 'banka_api' and externi_id = 'krok111-pv-c'));

-- Každé id ze stažení (všechna stažení scénáře jdou přes pg_temp.stahnout)
-- je na účtu PRÁVĚ JEDNOU: řádek `banka_api`, nebo potvrzení řádku výpisu.
select pg_temp.check('žádné id ze stažení se neztratí ani nezdvojí: každé je řádek banka_api, nebo potvrzení (právě jednou)',
  (select count(*) from k111_stazena_id) > 0
  and not exists (
    select 1 from (select distinct ucet_id, externi_id from k111_stazena_id) s
     where (select count(*) from public.transakce t
             where t.ucet_id = s.ucet_id and t.zdroj = 'banka_api' and t.externi_id = s.externi_id)
         + (select count(*) from public.transakce_potvrzeni_banky b
             where b.ucet_id = s.ucet_id and b.externi_id = s.externi_id) <> 1));
-- Storno potvrzeného řádku databáze nebrání (majitelka ho stornuje, když
-- je dvojicí s ruční platbou) — „nestornovaný" platí pro řádek v okamžiku
-- potvrzení. Jediné potvrzení, jehož řádek scénář stornoval AŽ PO
-- potvrzení, je krok111-sp-x (oddíl 2b); to se tu vynechává.
select pg_temp.check('každé potvrzení ukazuje na nestornovaný řádek výpisu (csv_banka) téhož účtu',
  (select count(*) from public.transakce_potvrzeni_banky where tenant_id = :'firma_a') > 0
  and not exists (
    select 1 from public.transakce_potvrzeni_banky b
      join public.transakce t on t.id = b.transakce_id
     where b.tenant_id = :'firma_a'
       and (t.zdroj <> 'csv_banka' or t.ucet_id <> b.ucet_id
            or (b.externi_id <> 'krok111-sp-x'
                and exists (select 1 from public.transakce s where s.storno_of = t.id)))));


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

-- Párování s fakturou: výdaj firemního účtu a výdaj účtu P2.
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana)
values (:'firma_a', :'u_firma', 'vydaj', 777, '2033-03-07', 'rucni', 'Krok111 párování firma') returning id as t_par_firma \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana)
values (:'firma_a', :'u_p2', 'vydaj', 555, '2033-03-07', 'rucni', 'Krok111 párování P2') returning id as t_par_p2 \gset
insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, potvrzeno_kdy) values
  (:'firma_a', :'t_par_firma', 'krok111-faktura-firma', 777, 'potvrzeno', now()),
  (:'firma_a', :'t_par_p2',    'krok111-faktura-p2',    555, 'potvrzeno', now());

-- Zakázka pobočky P1: záloha na firemní účet, doplatek na účet P1 (duben).
insert into public.kontakty (tenant_id, nazev, je_odberatel)
values (:'firma_a', 'Krok111 odběratel', true) returning id as kontakt \gset
insert into public.zakazky (tenant_id, branch_id, kontakt_id, cislo, nazev)
values (:'firma_a', :'p1', :'kontakt', 'KROK111-1', 'Krok111 oslava') returning id as zakazka \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, zakazka_id, protistrana) values
  (:'firma_a', :'u_firma', 'prijem', 7000, '2033-04-10', 'rucni', :'zakazka', 'Krok111 záloha'),
  (:'firma_a', :'u_p1',    'prijem', 3000, '2033-04-11', 'rucni', :'zakazka', 'Krok111 doplatek');

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
select pg_temp.check('pobočka P1: potvrzení z banky u firemních účtů nevidí',
  not exists (select 1 from public.transakce_potvrzeni_banky where ucet_id in (:'u_b2', :'u_b3', :'u_vs')));
-- Zápis pohybů a zůstatků jen za celou firmu (ROZHODNOUT v migraci): ani
-- ruční platbu na účet vlastní pobočky — jinak by pobočka stornovala
-- platbu, kterou nevidí, nebo podstrčila zůstatek.
select pg_temp.check('pobočka P1: ani ruční platbu na účet své pobočky nezapíše (zápis jen za celou firmu, 42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, protistrana) values (%L, %L, %L, 1, %L, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-03-06', 'rucni', 'Krok111 zápis P1'), '42501', ''));
select pg_temp.check('pobočka P1: zůstatek ani svého účtu P1 nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values (%L, %L, %L, 1, now(), %L)',
    :'firma_a', :'u_p1', 'knihovni', 'banka_api'), '42501', ''));
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
-- Uhrazeno na zakázku (SECURITY DEFINER) sčítá jen platby z účtů, které
-- volající vidí — záloha na firemní účet pobočce ne.
select pg_temp.check('pobočka P1: uhrazeno na zakázku své pobočky jen z účtu P1 (3000), záloha na firemní účet ne',
  public.zakazka_uhrazeno(:'firma_a', :'zakazka') = 3000);

-- Pavla: jen čtení na P2. Účet P1 Petr vidí i přes politiku správce
-- (platebni_ucty_spravce_cte, dřív `for all` platebni_ucty_write), proto čtecí politiku pobočky
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
select pg_temp.check('jen čtení na P2: párování s fakturou vidí jen u platby svého účtu, u firemního ne',
  coalesce((select array_agg(faktura_id order by faktura_id) from public.platby_faktury
             where faktura_id like 'krok111-faktura-%') = array['krok111-faktura-p2'], false));

-- Filip: čtení za celou firmu.
select set_config('test.user_id', :'firemni', false);
select pg_temp.check('rozsah celé firmy: vidí firemní účet i obě pobočky, cizí ne',
  (select array_agg(distinct ucet_id order by ucet_id) from public.transakce
    where ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi'))
  = (select array_agg(x order by x) from unnest(array[:'u_firma'::uuid, :'u_p1'::uuid, :'u_p2'::uuid]) x));
select pg_temp.check('rozsah celé firmy: vidí zůstatek firemního účtu',
  exists (select 1 from public.bankovni_zustatky where platebni_ucet_id = :'u_firma'));
select pg_temp.check('rozsah celé firmy (jen čtení): vidí párování plateb firemního účtu i P2',
  (select count(*) from public.platby_faktury where faktura_id like 'krok111-faktura-%') = 2);
select pg_temp.check('rozsah celé firmy (jen čtení): vidí potvrzení z banky firemních účtů (4)',
  (select count(*) from public.transakce_potvrzeni_banky where ucet_id in (:'u_b2', :'u_b3', :'u_vs')) = 4);

-- Bohdan: cizí firma.
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: nevidí žádný účet, pohyb ani zůstatek firmy A',
  not exists (select 1 from public.platebni_ucty where id in (:'u_firma', :'u_p1', :'u_p2'))
  and not exists (select 1 from public.transakce where ucet_id in (:'u_firma', :'u_p1', :'u_p2'))
  and not exists (select 1 from public.bankovni_zustatky where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2'))
  and not exists (select 1 from public.transakce_potvrzeni_banky where tenant_id = :'firma_a'));
select pg_temp.check('cizí firma: na účet firmy A nezapíše (42501)',
  pg_temp.spadne_hlaskou(format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 1, %L, %L)',
    :'firma_a', :'u_p1', 'prijem', '2033-03-06', 'rucni'), '42501', ''));

-- Přehled tržeb (SECURITY DEFINER) počítá banku stejně jako politika.
select set_config('test.user_id', :'pob1', false);
select public.pokladna_prehled_trzeb(:'firma_a', '2033-03-01', '2033-03-31', 'mesic') as prehled_p1 \gset
select pg_temp.check('přehled tržeb pobočky P1: banka jen z účtu P1 (20000), firemní ne',
  (select coalesce(sum((e ->> 'prijmy_haleru')::bigint), 0) from jsonb_array_elements(:'prehled_p1'::jsonb -> 'banka') e) = 20000
  and not exists (select 1 from jsonb_array_elements(:'prehled_p1'::jsonb -> 'banka') e where e ->> 'branch_id' is null));
select set_config('test.user_id', :'maj', false);
select public.pokladna_prehled_trzeb(:'firma_a', '2033-03-01', '2033-03-31', 'mesic') as prehled_maj \gset
select pg_temp.check('přehled tržeb majitelky: firemní účet (bez pobočky) i obě pobočky',
  (select coalesce(sum((e ->> 'prijmy_haleru')::bigint), 0) from jsonb_array_elements(:'prehled_maj'::jsonb -> 'banka') e) = 60000
  and exists (select 1 from jsonb_array_elements(:'prehled_maj'::jsonb -> 'banka') e where e ->> 'branch_id' is null));
select pg_temp.check('majitelka: uhrazeno na zakázku i se zálohou na firemní účet (10000)',
  public.zakazka_uhrazeno(:'firma_a', :'zakazka') = 10000);

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
-- Politiky pohybů a zůstatků se ptají jen na účet — účet převedený do
-- firmy B by ukázal historii firmy A lidem firmy B. Tady jako vlastník
-- databáze: majitel obou firem by politikou prošel, zastavit to musí
-- spoušť.
select pg_temp.check('firemní účet nejde převést do jiné firmy (spoušť, 23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set tenant_id = %L where id = %L', :'firma_b', :'u_firma'),
    '23514', 'jiné firmy'));


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
-- RPC odmítá šifru podle oblasti — přepnutím oblasti by ji majitelka
-- přečetla (PATCH /rest/v1/integrace_pripojeni) a oblast pak vrátila.
select pg_temp.check('majitelka: oblast bankovního připojení nepřepne (42501)',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set oblast = %L where id = %L', 'pokladna', :'pr_banka'),
    '42501', 'Oblast bankovního'));
select pg_temp.check('… ani jiné připojení na banku (42501)',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set oblast = %L where id = %L', 'banka', :'pr_rez'),
    '42501', 'Oblast bankovního'));

-- Připojení pobočky jen k účtu té pobočky: synchronizace zapisuje jako
-- služba, pohybům `banka_api` věří párování faktur.
select set_config('test.user_id', :'pob1', false);
select pg_temp.check('pobočka P1: připojení své pobočky k firemnímu účtu nezaloží (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma_a', :'p1', 'banka', 'krok111-banka-p1', 'zakaznicky', 'Krok111 banka P1', :'u_firma'), '23514', 'té pobočky'));
select pg_temp.check('… ani k účtu jiné pobočky (23514)',
  pg_temp.spadne_hlaskou(format('insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma_a', :'p1', 'banka', 'krok111-banka-p1', 'zakaznicky', 'Krok111 banka P1', :'u_p2'), '23514', 'té pobočky'));
select pg_temp.check('… k účtu své pobočky ano',
  pg_temp.projde(format('insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma_a', :'p1', 'banka', 'krok111-banka-p1', 'zakaznicky', 'Krok111 banka P1', :'u_p1')));
select pg_temp.check('… a přesměrovat ho na firemní účet nejde (23514)',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set platebni_ucet_id = %L where tenant_id = %L and poskytovatel = %L',
    :'u_firma', :'firma_a', 'krok111-banka-p1'), '23514', 'té pobočky'));
select pg_temp.check('pobočka P1 (integrace.manage jen na P1): integrace_overit_spravu firemního připojení odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_overit_spravu(%L)', :'pr_banka'), '42501', 'oprávnění'));

select set_config('test.user_id', :'pob2', false);
select pg_temp.check('bez integrace.manage: integrace_overit_spravu odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_overit_spravu(%L)', :'pr_banka'), '42501', 'oprávnění'));
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: integrace_overit_spravu odmítne (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_overit_spravu(%L)', :'pr_banka'), '42501', 'oprávnění'));
select pg_temp.check('cizí firma: ani číst šifru banky (42501)',
  pg_temp.spadne_hlaskou(format('select public.integrace_precti_tajemstvi(%L)', :'pr_banka'), '42501', 'oprávnění'));

-- Účet, na který míří připojení POBOČKY, se nepřestěhuje: spoušť u připojení
-- hlídá jen změnu připojení. Majitelka projde politikou — zastavit to musí
-- spoušť účtu.
select set_config('test.user_id', :'maj', false);
select pg_temp.check('účet s připojením pobočky P1 nejde přesunout na pobočku P2 (23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p1'),
    '23514', 'připojení jiné pobočky'));
select pg_temp.check('… ani na celou firmu (23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set branch_id = null where id = %L', :'u_p1'),
    '23514', 'připojení jiné pobočky'));
reset role;
update public.integrace_pripojeni set stav = 'odpojeno'
 where tenant_id = :'firma_a' and poskytovatel = 'krok111-banka-p1';
set role authenticated;
select pg_temp.check('… ani když má připojení jen stav odpojeno, bez času odpojení (23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p1'),
    '23514', 'připojení jiné pobočky'));
reset role;
update public.integrace_pripojeni set stav = 'pripojeno', odpojeno_kdy = now()
 where tenant_id = :'firma_a' and poskytovatel = 'krok111-banka-p1';
set role authenticated;
select pg_temp.check('… ani když má jen čas odpojení, stav ne (23514)',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p1'),
    '23514', 'připojení jiné pobočky'));
reset role;
update public.integrace_pripojeni set stav = 'odpojeno'
 where tenant_id = :'firma_a' and poskytovatel = 'krok111-banka-p1';
-- Připojení za celou firmu (bez pobočky) smí ke kterémukoli účtu firmy.
update public.integrace_pripojeni set platebni_ucet_id = :'u_p2' where id = :'pr_banka';
set role authenticated;
select pg_temp.check('úplně odpojené připojení pobočky přesun nebrání (P2 a zpět)',
  pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p1'))
  and pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p1', :'u_p1')));
select pg_temp.check('připojení za celou firmu přesun účtu nebrání (P2 → P1 a zpět)',
  pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p1', :'u_p2'))
  and pg_temp.projde(format('update public.platebni_ucty set branch_id = %L where id = %L', :'p2', :'u_p2')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('účty P1 a P2 po zkouškách pořád pod svou pobočkou',
  (select branch_id = :'p1'::uuid from public.platebni_ucty where id = :'u_p1')
  and (select branch_id = :'p2'::uuid from public.platebni_ucty where id = :'u_p2'));

select pg_temp.check('anon nemá integrace_overit_spravu, importovat_vypis, klíč ani roztřídění; authenticated ano',
  not has_function_privilege('anon', 'public.integrace_overit_spravu(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.importovat_vypis(uuid, uuid, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.otisk_pohybu(uuid, date, text, integer, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'app.import_roztridit(uuid, text, jsonb)', 'execute')
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

-- Potvrzení z banky: jen přidávání, zapisuje jen služba. Čistá databáze
-- harnessu nemá výchozí práva Supabase (ta dávají všechno i službě), takže
-- revoke od service_role tu nejde poznat — hlídá ho text migrace ve
-- scripts/provoz-granty.test.mjs (tabulky jen pro přidávání).
select pg_temp.check('potvrzení z banky: přihlášený jen čte, anon nic, služba čte a přidává, úpravu ani mazání nikdo',
  has_table_privilege('authenticated', 'public.transakce_potvrzeni_banky', 'select')
  and not has_table_privilege('authenticated', 'public.transakce_potvrzeni_banky', 'insert')
  and not has_table_privilege('authenticated', 'public.transakce_potvrzeni_banky', 'update')
  and not has_table_privilege('authenticated', 'public.transakce_potvrzeni_banky', 'delete')
  and not has_table_privilege('authenticated', 'public.transakce_potvrzeni_banky', 'truncate')
  and not has_table_privilege('anon', 'public.transakce_potvrzeni_banky', 'select')
  and not has_table_privilege('anon', 'public.transakce_potvrzeni_banky', 'insert')
  and has_table_privilege('service_role', 'public.transakce_potvrzeni_banky', 'insert')
  and not has_table_privilege('service_role', 'public.transakce_potvrzeni_banky', 'update')
  and not has_table_privilege('service_role', 'public.transakce_potvrzeni_banky', 'delete')
  and not has_table_privilege('service_role', 'public.transakce_potvrzeni_banky', 'truncate'));
select pg_temp.check('potvrzení z banky: RLS zapnuté, jediná politika je čtení',
  (select relrowsecurity from pg_class where oid = 'public.transakce_potvrzeni_banky'::regclass)
  and (select array_agg(cmd::text) from pg_policies
        where schemaname = 'public' and tablename = 'transakce_potvrzeni_banky') = array['SELECT']);


\echo ''
\echo '== Úklid ================================================================'

delete from public.integrace_tajemstvi where pripojeni_id in (:'pr_banka', :'pr_rez');
delete from public.integrace_pripojeni where tenant_id = :'firma_a' and poskytovatel like 'krok111-%';
delete from public.bankovni_zustatky where platebni_ucet_id in (:'u_firma', :'u_p1', :'u_p2', :'u_cizi');
delete from public.platby_faktury where transakce_id in (:'t_par_firma', :'t_par_p2');
delete from public.transakce_potvrzeni_banky where tenant_id in (:'firma_a', :'firma_b');
delete from public.transakce where tenant_id in (:'firma_a', :'firma_b');
delete from public.zakazky where id = :'zakazka';
delete from public.kontakty where id = :'kontakt';
delete from public.import_davky where tenant_id in (:'firma_a', :'firma_b');
delete from public.platebni_ucty where tenant_id in (:'firma_a', :'firma_b');
drop table k111_stazena_id;
-- Majitelé a jejich firmy zůstávají (jako v krocích 103 až 110): posledního
-- majitele firmy pojistka smazat nedovolí. Ostatní lidé pryč.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'firma_a' and user_id in (:'pob1', :'pob2', :'firemni'));
delete from public.memberships where tenant_id = :'firma_a' and user_id in (:'pob1', :'pob2', :'firemni');
delete from public.employees where id in (:'e_pob1', :'e_pob2', :'e_firemni');
delete from public.position_permissions where position_id in (:'z_fin', :'z_cteni');
delete from public.positions where id in (:'z_fin', :'z_cteni');

select pg_temp.check('úklid: účty, pohyby, potvrzení, zůstatky, dávky, párování, zakázka a připojení kroku 111 pryč',
  not exists (select 1 from public.platebni_ucty where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.transakce_potvrzeni_banky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.platby_faktury where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.zakazky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.transakce where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.bankovni_zustatky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.import_davky where tenant_id in (:'firma_a', :'firma_b'))
  and not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'firma_a', :'firma_b')));

\echo ''
\echo '== KROK 111 HOTOV ========================================'
