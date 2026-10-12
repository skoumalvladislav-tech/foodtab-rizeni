-- Scénář pro krok 93 — univerzální napojení pokladen.
--
-- Migrace: 20261011100000_pokladna_univerzalni_napojeni.sql.
--
-- Pokrývá:
--   1. práva: zapisovací a úklidová funkce jen pro service_role —
--      přihlášený ani nepřihlášený je volat nesmí;
--   2. připojení PRO POBOČKU (příjmové API): přepis celých dnů (storno
--      zmizí, nic se nezdvojí, stejný název se sečte), jiné dny beze
--      změny, cizí pobočka odmítnuta;
--   3. připojení PRO FIRMU (pokladna s tokenem): zapíše jen do pobočky,
--      ke které je provozovna přiřazená; nepřiřazená pobočka, odpojené
--      připojení a připojení jiné oblasti odmítnuty; pobočka cizí firmy
--      podstrčená do přiřazení spadne na druhé linii;
--   4. úklid po změně přiřazení maže jen řádky TOHOTO připojení;
--   5. druhá linie: cizí připojení a cizí receptura v řádku prodeje;
--   6. receptura podle názvu jen při přesné shodě (podobné se nehádá);
--   7. foodcost nesčítá CSV a API téhož dne a pobočky;
--   8. `zdroj` jen v tvaru `<malá písmena>_…`.
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

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

-- Cizí firma: jen podklad pro druhou linii obrany (stejný vzor jako krok82).
insert into auth.users (id, email, raw_user_meta_data) values
  ('93930000-0000-0000-0000-000000000001', 'xaver93@jinafirma.cz', '{"full_name":"Xaver Devadesáttři"}');
set role authenticated;
select set_config('test.user_id', '93930000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok93 Cizí s.r.o.', 'Xaver Devadesáttři') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok93 cizí pobočka', 'krok93-cizi', true)
returning id as cizi_pobocka \gset
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim)
values (:'tenant_b', 'pokladna', 'obecne', 'zakaznicky')
returning id as cizi_pripojeni \gset
insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant_b', 'Krok93 Cizí guláš', 1, 'jidlo')
returning id as cizi_receptura \gset

-- Naše připojení.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav)
values (:'tenant', :'perla', 'pokladna', 'obecne', 'zakaznicky', 'nepripojeno')
returning id as prijem \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'dotykacka', 'zakaznicky', 'pripojeno',
  jsonb_build_object('cloud_id', '123', 'provozovny', jsonb_build_array(
    jsonb_build_object('id', '11', 'nazev', 'Perla v Dotykačce', 'branch_id', :'perla', 'dohnano_od', null),
    jsonb_build_object('id', '12', 'nazev', 'Bar v Dotykačce', 'branch_id', null, 'dohnano_od', null))))
returning id as dotyk \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim)
values (:'tenant', 'ucetnictvi', 'krok93-ucto', 'csv')
returning id as ucto \gset


\echo ''
\echo '== 1. Zápis a úklid smí jen service_role ========================'

select pg_temp.check('anon nemá EXECUTE na pokladna_nahradit_prodeje',
  not has_function_privilege('anon', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text)', 'execute'));
select pg_temp.check('authenticated nemá EXECUTE na pokladna_nahradit_prodeje (zapisuje za pokladnu, ne za sebe)',
  not has_function_privilege('authenticated', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text)', 'execute'));
select pg_temp.check('authenticated nemá EXECUTE na pokladna_odebrat_prodeje',
  not has_function_privilege('authenticated', 'public.pokladna_odebrat_prodeje(uuid, uuid)', 'execute'));
select pg_temp.check('service_role EXECUTE na obě má',
  has_function_privilege('service_role', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.pokladna_odebrat_prodeje(uuid, uuid)', 'execute'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ani majitel ji opravdu nezavolá (permission denied)',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, null, array[%L]::date[], %L::jsonb)', :'prijem', '2026-10-01', '[]'),
    '42501', ''));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 2. Připojení pro pobočku: přepis celých dnů =================='

set role service_role;

select public.pokladna_nahradit_prodeje(:'prijem', null, array['2026-10-01', '2026-10-02']::date[], '[
  {"datum":"2026-10-01","produkt_nazev":"Krok93 Pivo","mnozstvi":10,"trzba_haleru":50000},
  {"datum":"2026-10-01","produkt_nazev":" Krok93 Pivo ","mnozstvi":5,"trzba_haleru":25000},
  {"datum":"2026-10-01","produkt_nazev":"Krok93 Limonáda","mnozstvi":2,"trzba_haleru":8000},
  {"datum":"2026-10-02","produkt_nazev":"Krok93 Pivo","mnozstvi":7,"trzba_haleru":35000}
]'::jsonb) as zapsano_1 \gset

reset role;

select pg_temp.check('zapsány 3 řádky (stejný název v jednom dni se sečetl do jednoho)', :'zapsano_1' = 3);
select pg_temp.check('Pivo 1. 10.: 15 ks za 75 000 h (10 + 5)',
  exists (select 1 from public.pokladna_prodeje_denni
           where branch_id = :'perla' and datum = '2026-10-01' and produkt_nazev = 'Krok93 Pivo'
             and mnozstvi = 15 and trzba_haleru = 75000));
select pg_temp.check('zdroj = obecne_api a řádek nese připojení',
  (select bool_and(zdroj = 'obecne_api' and integrace_pripojeni_id = :'prijem')
     from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev like 'Krok93 %'));

set role service_role;
select public.pokladna_nahradit_prodeje(:'prijem', null, array['2026-10-01']::date[], '[
  {"datum":"2026-10-01","produkt_nazev":"Krok93 Pivo","mnozstvi":14,"trzba_haleru":70000}
]'::jsonb) as zapsano_2 \gset
reset role;

select pg_temp.check('opakovaný den: Limonáda (stornovaná v pokladně) zmizela',
  not exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-01' and produkt_nazev = 'Krok93 Limonáda'));
select pg_temp.check('opakovaný den: Pivo PŘEPSANÉ na 14 ks, ne přičtené',
  (select mnozstvi from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-01' and produkt_nazev = 'Krok93 Pivo') = 14);
select pg_temp.check('den, který v dávce nebyl (2. 10.), zůstal beze změny',
  (select mnozstvi from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-02' and produkt_nazev = 'Krok93 Pivo') = 7);

set role service_role;
select public.pokladna_nahradit_prodeje(:'prijem', null, array['2026-10-02']::date[], '[]'::jsonb) as zapsano_3 \gset
reset role;
select pg_temp.check('den bez položek (vše stornováno) se vyprázdní',
  not exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-02' and zdroj = 'obecne_api'));

set role service_role;
select pg_temp.check('připojení pro Perlu nezapíše do Baru',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb)', :'prijem', :'bar', '2026-10-03', '[]'),
    '23514', 'jiné pobočce'));
select pg_temp.check('řádek ze dne, který se nepřepisuje → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, null, array[%L]::date[], %L::jsonb)', :'prijem', '2026-10-03',
      '[{"datum":"2026-10-04","produkt_nazev":"X","mnozstvi":1,"trzba_haleru":1}]'),
    '22023', 'nepřepisuje'));
select pg_temp.check('bez dnů → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, null, array[]::date[], %L::jsonb)', :'prijem', '[]'),
    '22023', 'Chybí dny'));
reset role;


\echo ''
\echo '== 3. Připojení pro firmu: jen přiřazené pobočky ==============='

set role service_role;
select public.pokladna_nahradit_prodeje(:'dotyk', :'perla', array['2026-10-05']::date[], '[
  {"datum":"2026-10-05","produkt_nazev":"Krok93 Svíčková","mnozstvi":3,"trzba_haleru":75000}
]'::jsonb, '11') as zapsano_4 \gset
reset role;

select pg_temp.check('provozovna přiřazená k Perle zapsala do Perly, zdroj dotykacka_api',
  exists (select 1 from public.pokladna_prodeje_denni
           where branch_id = :'perla' and datum = '2026-10-05' and zdroj = 'dotykacka_api' and integrace_pripojeni_id = :'dotyk'));

set role service_role;
select pg_temp.check('pobočka bez přiřazené provozovny (Bar) → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'bar', '2026-10-05', '[]', '12'),
    '23514', 'není přiřazená'));
select pg_temp.check('bez pobočky u firemního připojení → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, null, array[%L]::date[], %L::jsonb)', :'dotyk', '2026-10-05', '[]'),
    '23514', 'není přiřazená'));
select pg_temp.check('připojení jiné oblasti (účetnictví) → „neexistuje"',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb)', :'ucto', :'perla', '2026-10-05', '[]'),
    'P0002', 'neexistuje'));
reset role;

-- Pobočka cizí firmy podstrčená do přiřazení (kdyby ji tam dostal omyl
-- v kódu): funkce ji pustí dál, ale zápis zastaví druhá linie.
update public.integrace_pripojeni
   set externi_ucet = jsonb_set(externi_ucet, '{provozovny,1,branch_id}', to_jsonb(:'cizi_pobocka'::text))
 where id = :'dotyk';
set role service_role;
select pg_temp.check('cizí pobočka v přiřazení → druhá linie („Pobočka nepatří této firmě")',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'cizi_pobocka', '2026-10-05',
      '[{"datum":"2026-10-05","produkt_nazev":"X","mnozstvi":1,"trzba_haleru":1}]', '12'),
    '23514', 'Pobočka nepatří'));
reset role;
update public.integrace_pripojeni
   set externi_ucet = jsonb_set(externi_ucet, '{provozovny,1,branch_id}', 'null'::jsonb)
 where id = :'dotyk';

update public.integrace_pripojeni set odpojeno_kdy = now() where id = :'prijem';
set role service_role;
select pg_temp.check('odpojené připojení už nezapíše nic',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, null, array[%L]::date[], %L::jsonb)', :'prijem', '2026-10-01', '[]'),
    'P0002', 'odpojené'));
reset role;
update public.integrace_pripojeni set odpojeno_kdy = null where id = :'prijem';


\echo ''
\echo '== 4. Úklid po změně přiřazení maže jen řádky toho připojení ==='

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj)
values (:'tenant', :'perla', '2026-10-05', 'Krok93 Ruční CSV', 1, 1000, 'csv');

set role service_role;
select public.pokladna_odebrat_prodeje(:'dotyk', :'perla') as odebrano \gset
reset role;

select pg_temp.check('řádky Dotykačky v Perle smazané (1)', :'odebrano' = 1
  and not exists (select 1 from public.pokladna_prodeje_denni where integrace_pripojeni_id = :'dotyk'));
select pg_temp.check('CSV téže pobočky a dne zůstalo',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok93 Ruční CSV'));
select pg_temp.check('řádky jiného připojení (příjmové API) zůstaly',
  exists (select 1 from public.pokladna_prodeje_denni where integrace_pripojeni_id = :'prijem'));


\echo ''
\echo '== 5. Druhá linie: cizí připojení a cizí receptura =============='

select pg_temp.check('řádek s připojením cizí firmy → spadne',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, integrace_pripojeni_id) values (%L, %L, %L, %L, 1, 1, %L, %L)',
      :'tenant', :'perla', '2026-10-06', 'X', 'obecne_api', :'cizi_pripojeni'),
    '23514', 'Připojení pokladny nepatří'));
select pg_temp.check('řádek s připojením jiné oblasti (účetnictví) → spadne',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, integrace_pripojeni_id) values (%L, %L, %L, %L, 1, 1, %L, %L)',
      :'tenant', :'perla', '2026-10-06', 'X', 'obecne_api', :'ucto'),
    '23514', 'Připojení pokladny nepatří'));
select pg_temp.check('řádek s recepturou cizí firmy → spadne',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, recipe_id, mnozstvi, trzba_haleru, zdroj) values (%L, %L, %L, %L, %L, 1, 1, %L)',
      :'tenant', :'perla', '2026-10-06', 'X', :'cizi_receptura', 'csv'),
    '23514', 'Receptura nepatří'));


\echo ''
\echo '== 6. Receptura podle názvu — jen přesná shoda ==================='

insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', 'Krok93 Guláš', 1, 'jidlo')
returning id as gulas \gset
insert into public.recipes (tenant_id, name, portions, druh, active) values (:'tenant', 'Krok93 Vyřazená', 1, 'jidlo', false);
insert into public.recipes (tenant_id, branch_id, name, portions, druh) values (:'tenant', :'bar', 'Krok93 Jen v baru', 1, 'jidlo');
-- Stejné jméno jako cizí receptura — cizí firma se do shody nesmí počítat.
insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', 'Krok93 Cizí guláš', 1, 'jidlo')
returning id as nas_cizi_gulas \gset

set role service_role;
select public.pokladna_nahradit_prodeje(:'prijem', null, array['2026-10-07']::date[], '[
  {"datum":"2026-10-07","produkt_nazev":"  krok93 GULÁŠ ","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-07","produkt_nazev":"Krok93 Bez receptury","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-07","produkt_nazev":"Krok93 Guláš velký","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-07","produkt_nazev":"Krok93 Vyřazená","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-07","produkt_nazev":"Krok93 Jen v baru","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-07","produkt_nazev":"Krok93 Cizí guláš","mnozstvi":1,"trzba_haleru":100}
]'::jsonb) as zapsano_5 \gset
reset role;

select pg_temp.check('shoda názvu bez ohledu na velikost písmen a mezery → receptura dosazena',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'krok93 GULÁŠ') = :'gulas');
select pg_temp.check('produkt bez receptury stejného jména zůstane bez receptury',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'Krok93 Bez receptury') is null);
select pg_temp.check('podobný název („Guláš velký") se nehádá',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'Krok93 Guláš velký') is null);
select pg_temp.check('neaktivní receptura se nepřiřadí',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'Krok93 Vyřazená') is null);
select pg_temp.check('receptura jiné pobočky se nepřiřadí',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'Krok93 Jen v baru') is null);
select pg_temp.check('stejné jméno u cizí firmy se do shody nepočítá (dosazena naše)',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-07' and produkt_nazev = 'Krok93 Cizí guláš') = :'nas_cizi_gulas');

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, recipe_id, mnozstvi, trzba_haleru, zdroj)
values (:'tenant', :'perla', '2026-10-07', 'Krok93 Guláš ručně', :'nas_cizi_gulas', 1, 1, 'csv')
returning id as rucni \gset
select pg_temp.check('výslovně zadanou recepturu shoda názvu nepřepíše',
  (select recipe_id from public.pokladna_prodeje_denni where id = :'rucni') = :'nas_cizi_gulas');
update public.pokladna_prodeje_denni set produkt_nazev = 'Krok93 Guláš' where id = :'rucni';
select pg_temp.check('přejmenovaný produkt dostane recepturu podle nového jména',
  (select recipe_id from public.pokladna_prodeje_denni where id = :'rucni') = :'gulas');


\echo ''
\echo '== 7. Foodcost: CSV a API téhož dne se nesčítají ================'

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj) values
  (:'tenant', :'perla', '2026-10-08', 'Krok93 CSV den A', 1, 40000, 'csv'),
  (:'tenant', :'perla', '2026-10-09', 'Krok93 CSV den B', 1, 30000, 'csv'),
  (:'tenant', :'bar',   '2026-10-08', 'Krok93 CSV bar',   1, 20000, 'csv');
set role service_role;
select public.pokladna_nahradit_prodeje(:'prijem', null, array['2026-10-08']::date[], '[
  {"datum":"2026-10-08","produkt_nazev":"Krok93 API den A","mnozstvi":1,"trzba_haleru":45000}
]'::jsonb) as zapsano_6 \gset
reset role;

select pg_temp.check('Perla 8. 10. (CSV i API): foodcost počítá jen API (45 000)',
  (select sum(trzby_haleru) from public.foodcost_beverage_prehled(:'tenant', :'perla', '2026-10-08', '2026-10-08')) = 45000);
select pg_temp.check('Perla 9. 10. (jen CSV): CSV se počítá (30 000)',
  (select sum(trzby_haleru) from public.foodcost_beverage_prehled(:'tenant', :'perla', '2026-10-09', '2026-10-09')) = 30000);
select pg_temp.check('Bar 8. 10. (jen CSV, API má jiná pobočka): CSV se počítá (20 000)',
  (select sum(trzby_haleru) from public.foodcost_beverage_prehled(:'tenant', :'bar', '2026-10-08', '2026-10-08')) = 20000);
select pg_temp.check('CSV řádek 8. 10. v Perle v tabulce zůstal (jen se nepočítá)',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok93 CSV den A'));


\echo ''
\echo '== 8. Zdroj jen v povoleném tvaru ==============================='

select pg_temp.check('zdroj s mezerou a velkými písmeny → spadne na CHECK',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj) values (%L, %L, %L, %L, 1, 1, %L)',
      :'tenant', :'perla', '2026-10-10', 'X', 'Dotykacka API'),
    '23514', 'zdroj_check'));
select pg_temp.check('nový poskytovatel (storyous_api) projde bez migrace',
  pg_temp.projde(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj) values (%L, %L, %L, %L, 1, 1, %L)',
      :'tenant', :'perla', '2026-10-10', 'Krok93 Storyous', 'storyous_api')));


-- Úklid: řádky prodeje a receptury pryč (krok85/82 počítají vlastní
-- součty jen nad svými názvy, ale nechávat cizí data v pobočce nemá smysl).
-- Připojení zůstávají (audit je drží) — jsou z jednorázových id.
delete from public.pokladna_prodeje_denni where produkt_nazev ilike 'krok93%';
delete from public.recipes where name ilike 'krok93%';

\echo ''
\echo '== KROK 93 HOTOV =============================================='
