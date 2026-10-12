-- Scénář pro krok 95 — tržby z pokladen v přehledech a platby podle
-- způsobu (hotovost, karta, stravenky…).
--
-- Migrace: 20261012200000_pokladna_trzby_obdobi.sql.
--
-- Pokrývá:
--   1. práva: platby čte authenticated jen přes RLS, píše jen
--      service_role (přes pokladna_nahradit_prodeje); přehled smí
--      authenticated, anon ne; přehled je SECURITY INVOKER;
--   2. zápis plateb v téže transakci jako prodeje: přepis dne, sečtení
--      téhož způsobu, `p_platby = null` platby nechá, `[]` je smaže,
--      platba ke dni mimo p_dny a součet mimo rozsah odmítnuty;
--      platby odpojeného jiného API zdroje ustoupí i bez p_platby;
--   3. úklid připojení maže i platby;
--   4. přehled: tržby po dnech / měsících / rocích a pobočkách, CSV dne
--      s API se nepočítá, dny s platbami, platby po druhu, rozpad po
--      způsobu za období, příjmy jen na bankovní účty a jen příjmy;
--      neplatné členění a příliš dlouhé období po dnech odmítnuty;
--   5. RLS: majitel vidí obě pobočky, člověk z cizí firmy nic.
--
-- Navazuje na etapa0_scenar.sql (firma „Foodtab s.r.o.", pobočky
-- cerna-perla a bernard-bar).

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
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select id as bar   from public.branches where tenant_id = :'tenant' and slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

-- Cizí firma: jen kdo se ptá, ne čí data (stejný vzor jako krok93).
insert into auth.users (id, email, raw_user_meta_data) values
  ('95950000-0000-0000-0000-000000000001', 'xaver95@jinafirma.cz', '{"full_name":"Xaver Devadesátpět"}');
set role authenticated;
select set_config('test.user_id', '95950000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok95 Cizí s.r.o.', 'Xaver Devadesátpět') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);
insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok95 cizí pobočka', 'krok95-cizi', true)
returning id as cizi_pobocka \gset

-- Firemní připojení se dvěma provozovnami (vlastní poskytovatel — Dotykačku
-- už má firma z krok94 a dvě živá připojení téhož poskytovatele nejdou).
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok95pos', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '1', 'nazev', 'Perla', 'branch_id', :'perla', 'dohnano_od', '2031-01-01'),
    jsonb_build_object('id', '2', 'nazev', 'Bar',   'branch_id', :'bar',   'dohnano_od', '2031-01-01'))))
returning id as pos \gset


\echo ''
\echo '== 1. Práva ======================================================'

select pg_temp.check('platby: authenticated jen SELECT (RLS), žádný zápis',
  has_table_privilege('authenticated', 'public.pokladna_platby_denni', 'select')
  and not has_table_privilege('authenticated', 'public.pokladna_platby_denni', 'insert')
  and not has_table_privilege('authenticated', 'public.pokladna_platby_denni', 'update')
  and not has_table_privilege('authenticated', 'public.pokladna_platby_denni', 'delete'));
select pg_temp.check('platby: anon nic',
  not has_table_privilege('anon', 'public.pokladna_platby_denni', 'select'));
select pg_temp.check('platby: service_role select/insert/delete, update ne',
  has_table_privilege('service_role', 'public.pokladna_platby_denni', 'insert')
  and has_table_privilege('service_role', 'public.pokladna_platby_denni', 'delete')
  and not has_table_privilege('service_role', 'public.pokladna_platby_denni', 'update'));
select pg_temp.check('platby mají zapnuté RLS',
  (select relrowsecurity from pg_class where oid = 'public.pokladna_platby_denni'::regclass));
select pg_temp.check('zápis (6 parametrů) jen service_role',
  has_function_privilege('service_role', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb)', 'execute'));
select pg_temp.check('stará pětiparametrová verze zmizela (žádné dvojí přetížení)',
  (select count(*) from pg_proc where proname = 'pokladna_nahradit_prodeje') = 1);
select pg_temp.check('přehled: authenticated ano, anon ne',
  has_function_privilege('authenticated', 'public.pokladna_prehled_trzeb(uuid, date, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.pokladna_prehled_trzeb(uuid, date, date, text)', 'execute'));
select pg_temp.check('přehled je SECURITY INVOKER (nic nezpřístupní, jen sčítá)',
  not (select prosecdef from pg_proc where oid = 'public.pokladna_prehled_trzeb(uuid, date, date, text)'::regprocedure));


\echo ''
\echo '== 2. Zápis plateb s prodeji ====================================='

set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2031-03-01']::date[],
  '[{"datum":"2031-03-01","produkt_nazev":"Krok95 Svíčková","mnozstvi":2,"trzba_haleru":1000},
    {"datum":"2031-03-01","produkt_nazev":"Krok95 Pivo","mnozstvi":3,"trzba_haleru":500}]'::jsonb,
  '1',
  '[{"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":1,"castka_haleru":400},
    {"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":1,"castka_haleru":200},
    {"datum":"2031-03-01","zpusob":"900000002","nazev":"Platební karta","druh":"karta","pocet":2,"castka_haleru":900}]'::jsonb) as zapsano \gset
reset role;

select pg_temp.check('vrací počet řádků PRODEJE (2), ne plateb',
  :'zapsano' = 2);
select pg_temp.check('stejný způsob v jednom dni se sečte (hotovost 400 + 200 = 600, 2 platby)',
  (select castka_haleru from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01' and zpusob = '900000001') = 600
  and (select pocet from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01' and zpusob = '900000001') = 2);
select pg_temp.check('platby nesou zdroj a připojení (krok95pos_api)',
  (select count(*) from public.pokladna_platby_denni where integrace_pripojeni_id = :'pos' and zdroj = 'krok95pos_api') = 2);

-- Přepis téhož dne: karta zmizí (storno), hotovost se změní.
set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2031-03-01']::date[],
  '[{"datum":"2031-03-01","produkt_nazev":"Krok95 Svíčková","mnozstvi":2,"trzba_haleru":1000},
    {"datum":"2031-03-01","produkt_nazev":"Krok95 Pivo","mnozstvi":3,"trzba_haleru":500}]'::jsonb,
  '1',
  '[{"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":3,"castka_haleru":1500}]'::jsonb);
reset role;
select pg_temp.check('přepis dne: zůstane jen nový stav (hotovost 1500), karta zmizela',
  (select count(*) from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01') = 1
  and (select castka_haleru from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01') = 1500);

-- p_platby = null (pokladna platby neposílá): platby dne zůstanou.
set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2031-03-01']::date[],
  '[{"datum":"2031-03-01","produkt_nazev":"Krok95 Svíčková","mnozstvi":2,"trzba_haleru":1000},
    {"datum":"2031-03-01","produkt_nazev":"Krok95 Pivo","mnozstvi":3,"trzba_haleru":500}]'::jsonb,
  '1');
reset role;
select pg_temp.check('bez p_platby (5 parametrů, jako příjmové API) platby zůstanou',
  (select castka_haleru from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01') = 1500);

-- p_platby = [] : den bez plateb (zavřeno) — dřívější platby zmizí.
set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'bar', array['2031-03-05']::date[],
  '[]'::jsonb, '2',
  '[{"datum":"2031-03-05","zpusob":"900000002","nazev":"Platební karta","druh":"karta","pocet":1,"castka_haleru":100}]'::jsonb);
select public.pokladna_nahradit_prodeje(:'pos', :'bar', array['2031-03-05']::date[], '[]'::jsonb, '2', '[]'::jsonb);
reset role;
select pg_temp.check('p_platby = [] smaže platby dne',
  not exists (select 1 from public.pokladna_platby_denni where branch_id = :'bar' and datum = '2031-03-05'));

set role service_role;
select pg_temp.check('platba ke dni, který se nepřepisuje, odmítnuta',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_nahradit_prodeje(%L, %L, array['2031-03-01']::date[], '[]'::jsonb, '1',
    '[{"datum":"2031-03-02","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":1,"castka_haleru":1}]'::jsonb)$q$, :'pos', :'perla'),
    '22023', 'Platba patří ke dni'));
select pg_temp.check('součet jednoho způsobu za den mimo rozsah odmítnut',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_nahradit_prodeje(%L, %L, array['2031-03-01']::date[], '[]'::jsonb, '1',
    '[{"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":1,"castka_haleru":2000000000},
      {"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"hotovost","pocet":1,"castka_haleru":2000000000}]'::jsonb)$q$, :'pos', :'perla'),
    '22003', 'mimo rozsah'));
select pg_temp.check('neznámý druh platby odmítne tabulka',
  not pg_temp.projde(format($q$select public.pokladna_nahradit_prodeje(%L, %L, array['2031-03-01']::date[], '[]'::jsonb, '1',
    '[{"datum":"2031-03-01","zpusob":"900000001","nazev":"Hotovost","druh":"bitcoin","pocet":1,"castka_haleru":1}]'::jsonb)$q$, :'pos', :'perla')));
select pg_temp.check('platby nejsou seznam → odmítnuto',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_nahradit_prodeje(%L, %L, array['2031-03-01']::date[], '[]'::jsonb, '1', '{"a":1}'::jsonb)$q$, :'pos', :'perla'),
    '22023', 'Platby musí být seznam'));
reset role;
select pg_temp.check('… a odmítnuté zápisy nic nezměnily (hotovost 1500, prodeje 1500)',
  (select castka_haleru from public.pokladna_platby_denni where branch_id = :'perla' and datum = '2031-03-01') = 1500
  and (select sum(trzba_haleru) from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2031-03-01' and zdroj = 'krok95pos_api') = 1500);

-- Platby z ODPOJENÉHO jiného API ustoupí, i když živá pokladna platby neposílá.
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, odpojeno_kdy)
values (:'tenant', 'pokladna', 'krok95stara', 'zakaznicky', 'odpojeno', now())
returning id as stara \gset
insert into public.pokladna_platby_denni (tenant_id, branch_id, datum, zpusob, nazev, druh, pocet, castka_haleru, zdroj, integrace_pripojeni_id)
values (:'tenant', :'perla', '2031-03-01', '7', 'Stará karta', 'karta', 1, 777, 'krok95stara_api', :'stara'),
       (:'tenant', :'perla', '2031-03-02', '7', 'Stará karta', 'karta', 1, 778, 'krok95stara_api', :'stara');
set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2031-03-01']::date[],
  '[{"datum":"2031-03-01","produkt_nazev":"Krok95 Svíčková","mnozstvi":2,"trzba_haleru":1000},
    {"datum":"2031-03-01","produkt_nazev":"Krok95 Pivo","mnozstvi":3,"trzba_haleru":500}]'::jsonb,
  '1');
reset role;
select pg_temp.check('platby odpojeného jiného zdroje v přepisovaném dni zmizely (i bez p_platby)',
  not exists (select 1 from public.pokladna_platby_denni where zdroj = 'krok95stara_api' and datum = '2031-03-01'));
select pg_temp.check('… v jiném dni zůstaly a vlastní platby taky',
  exists (select 1 from public.pokladna_platby_denni where zdroj = 'krok95stara_api' and datum = '2031-03-02')
  and exists (select 1 from public.pokladna_platby_denni where zdroj = 'krok95pos_api' and datum = '2031-03-01'));
delete from public.pokladna_platby_denni where zdroj = 'krok95stara_api';

select pg_temp.check('druhá linie: platba s pobočkou cizí firmy odmítnuta',
  pg_temp.spadne_hlaskou(format($q$insert into public.pokladna_platby_denni (tenant_id, branch_id, datum, zpusob, nazev, druh, castka_haleru, zdroj)
    values (%L, %L, '2031-03-01', '1', 'X', 'jine', 1, 'csv')$q$, :'tenant', :'cizi_pobocka'),
    '23514', 'Pobočka nepatří'));


\echo ''
\echo '== 3. Úklid připojení maže i platby =============================='

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok95uklid', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '9', 'nazev', 'P', 'branch_id', :'perla', 'dohnano_od', null))))
returning id as uklid \gset
set role service_role;
select public.pokladna_nahradit_prodeje(:'uklid', :'perla', array['2031-02-01']::date[],
  '[{"datum":"2031-02-01","produkt_nazev":"Krok95 U","mnozstvi":1,"trzba_haleru":1}]'::jsonb, '9',
  '[{"datum":"2031-02-01","zpusob":"1","nazev":"H","druh":"hotovost","pocet":1,"castka_haleru":1}]'::jsonb);
select public.pokladna_odebrat_prodeje(:'uklid', null) as smazano \gset
reset role;
select pg_temp.check('odebrat: prodeje (1) i platby připojení pryč',
  :'smazano' = 1
  and not exists (select 1 from public.pokladna_platby_denni where integrace_pripojeni_id = :'uklid'));
select pg_temp.check('… cizí platby (krok95pos) zůstaly',
  exists (select 1 from public.pokladna_platby_denni where integrace_pripojeni_id = :'pos'));


\echo ''
\echo '== 4. Přehled ===================================================='

-- Data navíc (rok 2031, ať se nepotkají s ostatními scénáři):
--   Perla 1. 3.: API 1500 (výš) + CSV 9999, které se nepočítá; platby hotovost 1500
--   Perla 2. 3.: jen CSV 700 (počítá se — API ten den nic nemá), bez plateb
--   Bar   1. 3.: jen CSV 300 (počítá se — API má jen Perla)
--   Perla 1. 4.: API 4000, platby karta 4000
--   Perla 1. 1. 2032: API 50 (jiný rok)
insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj) values
  (:'tenant', :'perla', '2031-03-01', 'Krok95 Svíčková', 2, 9999, 'csv'),
  (:'tenant', :'perla', '2031-03-02', 'Krok95 Guláš',    1,  700, 'csv'),
  (:'tenant', :'bar',   '2031-03-01', 'Krok95 Rum',      1,  300, 'csv');
set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2031-04-01']::date[],
  '[{"datum":"2031-04-01","produkt_nazev":"Krok95 Svíčková","mnozstvi":8,"trzba_haleru":4000}]'::jsonb, '1',
  '[{"datum":"2031-04-01","zpusob":"900000002","nazev":"Platební karta","druh":"karta","pocet":4,"castka_haleru":4000}]'::jsonb);
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2032-01-01']::date[],
  '[{"datum":"2032-01-01","produkt_nazev":"Krok95 Voda","mnozstvi":1,"trzba_haleru":50}]'::jsonb, '1', '[]'::jsonb);
reset role;

-- Banka: příjem 2000 na bankovní účet Perly, 300 na firemní bankovní účet,
-- výdaj 999 (nepočítá se) a příjem 555 na účet typu pokladna (nepočítá se).
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (:'tenant', :'perla', 'Krok95 KB Perla', 'banka') returning id as ucet_perla \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (:'tenant', null, 'Krok95 KB firma', 'banka') returning id as ucet_firma \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (:'tenant', :'perla', 'Krok95 kasa', 'pokladna') returning id as ucet_kasa \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values
  (:'tenant', :'ucet_perla', 'prijem', 2000, '2031-03-02', 'rucni'),
  (:'tenant', :'ucet_perla', 'vydaj',   999, '2031-03-02', 'rucni'),
  (:'tenant', :'ucet_firma', 'prijem',  300, '2031-03-20', 'rucni'),
  (:'tenant', :'ucet_kasa',  'prijem',  555, '2031-03-02', 'rucni');

select public.pokladna_prehled_trzeb(:'tenant', '2031-03-01', '2031-03-31', 'den') as den_json \gset
select public.pokladna_prehled_trzeb(:'tenant', '2031-01-01', '2031-12-31', 'mesic') as mesic_json \gset
select public.pokladna_prehled_trzeb(:'tenant', '2031-01-01', '2032-12-31', 'rok') as rok_json \gset

select pg_temp.check('po dnech: Perla 1. 3. = jen API 1500 (CSV 9999 téhož dne ne), 2 položky',
  exists (select 1 from jsonb_array_elements(:'den_json'::jsonb -> 'trzby') e
           where e ->> 'obdobi' = '2031-03-01' and e ->> 'branch_id' = :'perla'
             and (e ->> 'trzba_haleru')::bigint = 1500 and (e ->> 'polozek')::int = 2));
select pg_temp.check('po dnech: Perla 2. 3. = CSV 700 (API ten den nic nemá)',
  exists (select 1 from jsonb_array_elements(:'den_json'::jsonb -> 'trzby') e
           where e ->> 'obdobi' = '2031-03-02' and e ->> 'branch_id' = :'perla' and (e ->> 'trzba_haleru')::bigint = 700));
select pg_temp.check('po dnech: Bar 1. 3. = CSV 300 (API má jen jiná pobočka)',
  exists (select 1 from jsonb_array_elements(:'den_json'::jsonb -> 'trzby') e
           where e ->> 'obdobi' = '2031-03-01' and e ->> 'branch_id' = :'bar' and (e ->> 'trzba_haleru')::bigint = 300));
select pg_temp.check('po dnech: březen celkem 2500, duben se nepřimíchá',
  (select sum((e ->> 'trzba_haleru')::bigint) from jsonb_array_elements(:'den_json'::jsonb -> 'trzby') e) = 2500);
select pg_temp.check('po měsících: Perla březen 2200 ve 2 dnech, z nich 1 s platbami',
  exists (select 1 from jsonb_array_elements(:'mesic_json'::jsonb -> 'trzby') e
           where e ->> 'obdobi' = '2031-03-01' and e ->> 'branch_id' = :'perla'
             and (e ->> 'trzba_haleru')::bigint = 2200 and (e ->> 'dnu')::int = 2 and (e ->> 'dnu_s_platbami')::int = 1));
select pg_temp.check('po měsících: duben je samostatné období (4000, obdobi = 1. 4.)',
  exists (select 1 from jsonb_array_elements(:'mesic_json'::jsonb -> 'trzby') e
           where e ->> 'obdobi' = '2031-04-01' and (e ->> 'trzba_haleru')::bigint = 4000));
select pg_temp.check('po rocích: 2031 = 6500, 2032 = 50',
  (select sum((e ->> 'trzba_haleru')::bigint) from jsonb_array_elements(:'rok_json'::jsonb -> 'trzby') e where e ->> 'obdobi' = '2031-01-01') = 6500
  and (select sum((e ->> 'trzba_haleru')::bigint) from jsonb_array_elements(:'rok_json'::jsonb -> 'trzby') e where e ->> 'obdobi' = '2032-01-01') = 50);
select pg_temp.check('platby po druhu za rok 2031: hotovost 1500, karta 4000',
  (select sum((e ->> 'castka_haleru')::bigint) from jsonb_array_elements(:'rok_json'::jsonb -> 'platby') e where e ->> 'obdobi' = '2031-01-01' and e ->> 'druh' = 'hotovost') = 1500
  and (select sum((e ->> 'castka_haleru')::bigint) from jsonb_array_elements(:'rok_json'::jsonb -> 'platby') e where e ->> 'obdobi' = '2031-01-01' and e ->> 'druh' = 'karta') = 4000);
select pg_temp.check('rozpad po způsobu za březen: jen hotovost Perly 1500 s názvem',
  jsonb_array_length(:'den_json'::jsonb -> 'zpusoby') = 1
  and (:'den_json'::jsonb -> 'zpusoby' -> 0 ->> 'nazev') = 'Hotovost'
  and (:'den_json'::jsonb -> 'zpusoby' -> 0 ->> 'castka_haleru')::bigint = 1500);
select pg_temp.check('banka za březen: příjem Perly 2000 + firemní 300; výdaj ani účet typu pokladna ne',
  (select sum((e ->> 'prijmy_haleru')::bigint) from jsonb_array_elements(:'den_json'::jsonb -> 'banka') e) = 2300
  and exists (select 1 from jsonb_array_elements(:'den_json'::jsonb -> 'banka') e
               where e ->> 'branch_id' is null and (e ->> 'prijmy_haleru')::bigint = 300));
select pg_temp.check('neplatné členění odmítnuto',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_prehled_trzeb(%L, '2031-03-01', '2031-03-31', 'tyden')$q$, :'tenant'), '22023', 'Členění'));
select pg_temp.check('po dnech víc než 401 dní odmítnuto (ne potichu useknuto)',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_prehled_trzeb(%L, '2031-01-01', '2032-02-06', 'den')$q$, :'tenant'), '22023', 'nejvýš 401'));
select pg_temp.check('… 401 dní po dnech ještě projde',
  pg_temp.projde(format($q$select public.pokladna_prehled_trzeb(%L, '2031-01-01', '2032-02-05', 'den')$q$, :'tenant')));
select pg_temp.check('obrácené období odmítnuto',
  pg_temp.spadne_hlaskou(format($q$select public.pokladna_prehled_trzeb(%L, '2031-03-31', '2031-03-01', 'den')$q$, :'tenant'), '22023', 'Neplatné období'));
select pg_temp.check('období bez dat: prázdné seznamy, ne chyba',
  (select public.pokladna_prehled_trzeb(:'tenant', '2030-01-01', '2030-01-31', 'den'))
    = '{"trzby":[],"platby":[],"zpusoby":[],"banka":[]}'::jsonb);


\echo ''
\echo '== 5. RLS volajícího =============================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel vidí obě pobočky (březen 2500) i platby a banku',
  (select sum((e ->> 'trzba_haleru')::bigint)
     from jsonb_array_elements(public.pokladna_prehled_trzeb(:'tenant', '2031-03-01', '2031-03-31', 'den') -> 'trzby') e) = 2500
  and jsonb_array_length(public.pokladna_prehled_trzeb(:'tenant', '2031-03-01', '2031-03-31', 'den') -> 'zpusoby') = 1
  and jsonb_array_length(public.pokladna_prehled_trzeb(:'tenant', '2031-03-01', '2031-03-31', 'den') -> 'banka') = 2);
select pg_temp.check('majitel nesmí platby zapsat přímo',
  not pg_temp.projde(format($q$insert into public.pokladna_platby_denni (tenant_id, branch_id, datum, zpusob, nazev, druh, castka_haleru, zdroj)
    values (%L, %L, '2031-03-09', '1', 'X', 'jine', 1, 'csv')$q$, :'tenant', :'perla')));

select set_config('test.user_id', '95950000-0000-0000-0000-000000000001', false);
select pg_temp.check('člověk z cizí firmy nedostane nic, ani když zná id firmy',
  (select public.pokladna_prehled_trzeb(:'tenant', '2031-01-01', '2031-12-31', 'mesic'))
    = '{"trzby":[],"platby":[],"zpusoby":[],"banka":[]}'::jsonb);

reset role;
select set_config('test.user_id', '', false);


-- Úklid: prodeje, platby a transakce pryč (transakce nemají grant delete —
-- maže superuser); připojení zůstávají (audit), cizí firma taky.
delete from public.pokladna_platby_denni where zdroj like 'krok95%';
delete from public.pokladna_prodeje_denni where produkt_nazev ilike 'krok95%';
delete from public.transakce where ucet_id in (:'ucet_perla', :'ucet_firma', :'ucet_kasa');
delete from public.platebni_ucty where id in (:'ucet_perla', :'ucet_firma', :'ucet_kasa');

\echo ''
\echo '== KROK 95 HOTOV =============================================='
