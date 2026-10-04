-- Scénář pro krok 85 — foodcost % / beverage cost % z teoretické
-- spotřeby (zadání, oddíl 7), migrace 20261004200000_foodcost_beverage.sql.
--
-- Pokrývá:
--   1. recipes.druh — výchozí 'jidlo', CHECK odmítne cizí hodnotu.
--   2. upravit_recepturu přijímá a uloží p_druh, odmítne cizí hodnotu.
--   3. app.foodcost_beverage_prehled: jídlo a nápoj v samostatných
--      řádcích, prodej bez napojené receptury (nezařazeno), prodej
--      s neúplným nákladem (tržba se započítá, náklad ne).
--   4. Druhá linie / izolace cizí firmy.

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

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 1. recipes.druh — výchozí a CHECK =========================='

insert into public.recipes (tenant_id, branch_id, name, portions)
values (:'tenant', :'perla', 'Krok85 bez druhu', 1)
returning id as recept_vychozi \gset

select pg_temp.check('nová receptura bez druhu dostala výchozí "jidlo"',
  (select druh from public.recipes where id = :'recept_vychozi') = 'jidlo');

select pg_temp.check('cizí hodnota druhu spadne na CHECK',
  pg_temp.spadne_hlaskou(
    format('insert into public.recipes (tenant_id, branch_id, name, portions, druh) values (%L, %L, %L, %L, %L)',
      :'tenant', :'perla', 'Krok85 špatný druh', 1, 'dezert'),
    '23514', ''));


\echo ''
\echo '== 2. Fixtury — surovina s cenou (jídlo), surovina s cenou (nápoj), surovina BEZ ceny'

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok85 mouka', 'g')
returning id as surovina_mouka \gset

insert into public.ingredient_purchase_prices (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'surovina_mouka', 1000, 10000, current_date - 30)
returning id as cena_mouka \gset

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok85 kolový sirup', 'ml')
returning id as surovina_sirup \gset

insert into public.ingredient_purchase_prices (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'surovina_sirup', 1000, 5000, current_date - 30)
returning id as cena_sirup \gset

-- Surovina BEZ platné ceny — receptura na ní bude mít neúplný náklad.
insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok85 vývar bez ceny', 'ml')
returning id as surovina_bez_ceny \gset


\echo ''
\echo '== 3. Receptury: Chleba (jídlo, úplný náklad), Kola (nápoj, úplný náklad), Polévka (jídlo, NEÚPLNÝ náklad)'

insert into public.recipes (tenant_id, branch_id, name, portions, druh)
values (:'tenant', :'perla', 'Krok85 Chleba', 1, 'jidlo')
returning id as recept_chleba \gset

insert into public.recipe_ingredients (recipe_id, position, name, ingredient_id, amount, unit)
values (:'recept_chleba', 0, 'Krok85 mouka', :'surovina_mouka', 500, 'g');

insert into public.recipes (tenant_id, branch_id, name, portions, druh)
values (:'tenant', :'perla', 'Krok85 Kola 0,3l', 1, 'napoj')
returning id as recept_kola \gset

insert into public.recipe_ingredients (recipe_id, position, name, ingredient_id, amount, unit)
values (:'recept_kola', 0, 'Krok85 kolový sirup', :'surovina_sirup', 300, 'ml');

insert into public.recipes (tenant_id, branch_id, name, portions, druh)
values (:'tenant', :'perla', 'Krok85 Polévka bez ceny', 1, 'jidlo')
returning id as recept_polevka \gset

insert into public.recipe_ingredients (recipe_id, position, name, ingredient_id, amount, unit)
values (:'recept_polevka', 0, 'Krok85 vývar bez ceny', :'surovina_bez_ceny', 200, 'ml');

-- Ověření nákladu na porci přímo, dřív než appka přejde na agregát.
select cost_haleru_per_portion as chleba_cost, neuplne as chleba_neuplne
  from public.recipe_cost_per_portion(:'recept_chleba') \gset
select pg_temp.check('Chleba: náklad na porci 5000 haléřů (500 g × 10 h/g), úplný',
  :'chleba_cost'::integer = 5000 and :'chleba_neuplne'::boolean = false);

select cost_haleru_per_portion as kola_cost, neuplne as kola_neuplne
  from public.recipe_cost_per_portion(:'recept_kola') \gset
select pg_temp.check('Kola: náklad na porci 1500 haléřů (300 ml × 5 h/ml), úplný',
  :'kola_cost'::integer = 1500 and :'kola_neuplne'::boolean = false);

select neuplne as polevka_neuplne from public.recipe_cost_per_portion(:'recept_polevka') \gset
select pg_temp.check('Polévka: neúplný náklad (surovina bez ceny)', :'polevka_neuplne'::boolean = true);


\echo ''
\echo '== 4. Prodeje (pokladna) a agregát foodcost_beverage_prehled ==='

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, recipe_id, mnozstvi, trzba_haleru, zdroj)
values
  (:'tenant', :'perla', current_date, 'Krok85 Chleba',          :'recept_chleba',  3,  30000, 'csv'),
  (:'tenant', :'perla', current_date, 'Krok85 Kola 0,3l',       :'recept_kola',   10,  25000, 'csv'),
  (:'tenant', :'perla', current_date, 'Krok85 Polévka bez ceny', :'recept_polevka', 2,   4000, 'csv'),
  (:'tenant', :'perla', current_date, 'Krok85 Nezařazený prodej', null,             1,   5000, 'csv');

select trzby_haleru as jidlo_trzby, naklady_haleru as jidlo_naklady, trzby_bez_nakladu_haleru as jidlo_bez_nakladu
  from public.foodcost_beverage_prehled(:'tenant', :'perla', current_date, current_date)
  where druh = 'jidlo' \gset

select pg_temp.check('jídlo: tržby 34000 h (30000 chleba + 4000 polévka)', :'jidlo_trzby'::bigint = 34000);
select pg_temp.check('jídlo: náklady 15000 h (jen chleba: 5000 × 3; polévka vyloučena, neúplná)', :'jidlo_naklady'::bigint = 15000);
select pg_temp.check('jídlo: tržby bez nákladu 4000 h (jen polévka)', :'jidlo_bez_nakladu'::bigint = 4000);

select trzby_haleru as napoj_trzby, naklady_haleru as napoj_naklady, trzby_bez_nakladu_haleru as napoj_bez_nakladu
  from public.foodcost_beverage_prehled(:'tenant', :'perla', current_date, current_date)
  where druh = 'napoj' \gset

select pg_temp.check('nápoj: tržby 25000 h, náklady 15000 h (1500 × 10), tržby bez nákladu 0',
  :'napoj_trzby'::bigint = 25000 and :'napoj_naklady'::bigint = 15000 and :'napoj_bez_nakladu'::bigint = 0);

select trzby_haleru as nez_trzby, naklady_haleru as nez_naklady, trzby_bez_nakladu_haleru as nez_bez_nakladu
  from public.foodcost_beverage_prehled(:'tenant', :'perla', current_date, current_date)
  where druh = 'nezarazeno' \gset

select pg_temp.check('nezařazeno (bez receptury): tržby 5000 h, náklady 0, celé bez nákladu',
  :'nez_trzby'::bigint = 5000 and :'nez_naklady'::bigint = 0 and :'nez_bez_nakladu'::bigint = 5000);

select pg_temp.check('mimo zadané období appka nic nevidí (včerejšek)',
  not exists (
    select 1 from public.foodcost_beverage_prehled(:'tenant', :'perla', current_date - 1, current_date - 1)
  ));


\echo ''
\echo '== 5. Druhá linie — cizí firma do agregátu nepronikne, úprava druhu odmítne cizí hodnotu'

-- Výslovné přetypování každého %L — bez něj Postgres nedokázal
-- vyřešit přetížení funkce jen z citovaných literálů (ověřeno tady,
-- "function ... does not exist" i přes existující 9parametrovou
-- funkci).
select pg_temp.check('úprava receptury s cizí hodnotou druhu spadne',
  pg_temp.spadne_hlaskou(
    format('select public.upravit_recepturu(%L::uuid, %L::uuid, %L::text, %L::text, %L::smallint, %L::text, %L::boolean, %L::jsonb, %L::text)',
      :'tenant', :'recept_chleba', 'Krok85 Chleba', '', 1, '', true, '[]'::jsonb, 'dezert'),
    '23514', ''));

-- Výslovné přetypování i tady (viz komentář u spadne_hlaskou výš) —
-- bez něj Postgres nedokázal přetížení s devíti literály vyřešit.
select public.upravit_recepturu(:'tenant'::uuid, :'recept_chleba'::uuid, 'Krok85 Chleba'::text, ''::text, 1::smallint, ''::text, true::boolean, '[]'::jsonb, 'napoj'::text);

select pg_temp.check('úprava receptury uloží nový druh (jidlo -> napoj)',
  (select druh from public.recipes where id = :'recept_chleba') = 'napoj');

-- Vrátit zpátky na jidlo, ať úklid sedí na to, co appka čekala výš (jen pro čistotu, na kontroly výš to nemá vliv — už doběhly).
update public.recipes set druh = 'jidlo' where id = :'recept_chleba';

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('85850000-0000-0000-0000-000000000001', 'xaver85@jinafirma.cz', '{"full_name":"Xaver Osmdesátpět"}');
set role authenticated;
select set_config('test.user_id', '85850000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok85 Cizí s.r.o.', 'Xaver Osmdesátpět') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;

-- Fixtury cizí firmy bez role authenticated (RLS bypass) — stejný vzor
-- jako krok82/83_scenar.sql: branch/receptura/prodej cizí firmy nejsou
-- předmětem testu, jen podklad pro druhou linii.
insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok85 cizí pobočka', 'krok85-cizi', true)
returning id as perla_cizi \gset

insert into public.recipes (tenant_id, branch_id, name, portions, druh)
values (:'tenant_b', :'perla_cizi', 'Krok85 Cizí chleba', 1, 'jidlo')
returning id as recept_cizi \gset

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, recipe_id, mnozstvi, trzba_haleru, zdroj)
values (:'tenant_b', :'perla_cizi', current_date, 'Krok85 Cizí chleba', :'recept_cizi', 99, 999900, 'csv');

set role authenticated;
select set_config('test.user_id', '85850000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma VIDÍ svůj vlastní agregát (999900 h) — appka mu přístup nezablokovala úplně, test má co porovnávat',
  exists (
    select 1 from public.foodcost_beverage_prehled(:'tenant_b', :'perla_cizi', current_date, current_date)
    where trzby_haleru = 999900
  ));

select pg_temp.check('cizí firma NEVIDÍ naše číslo (34000) ve svém agregátu',
  not exists (
    select 1 from public.foodcost_beverage_prehled(:'tenant_b', :'perla_cizi', current_date, current_date)
    where trzby_haleru = 34000
  ));

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('naše firma po útoku vidí stejná čísla jako před ním (cizí prodej se nepřimíchal)',
  (select trzby_haleru from public.foodcost_beverage_prehled(:'tenant', :'perla', current_date, current_date) where druh = 'jidlo') = 34000);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.pokladna_prodeje_denni where tenant_id in (:'tenant', :'tenant_b') and produkt_nazev like 'Krok85 %';
delete from public.recipe_ingredients where recipe_id in (:'recept_chleba', :'recept_kola', :'recept_polevka', :'recept_cizi');
delete from public.recipes where id in (:'recept_vychozi', :'recept_chleba', :'recept_kola', :'recept_polevka', :'recept_cizi');
delete from public.ingredient_purchase_prices where id in (:'cena_mouka', :'cena_sirup');
delete from public.ingredients where id in (:'surovina_mouka', :'surovina_sirup', :'surovina_bez_ceny');

select pg_temp.check('úklid: po scénáři nezůstala žádná receptura kroku 85',
  not exists (select 1 from public.recipes where tenant_id = :'tenant' and name like 'Krok85 %'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 85 HOTOV =============================================='
