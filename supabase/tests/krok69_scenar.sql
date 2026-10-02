-- Scénář pro krok 69 — katalog surovin a historie nákupních cen (foodcost).
--
-- Migrace: 20261002100000_sklad_suroviny_zaklad.sql. Zadání:
-- docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 7 ("Gastro: receptury,
-- sklad, foodcost"), scénář 3 (řádek 211): "Nákup 10 kg za 1 000 Kč bez
-- DPH, receptura 200 g bez ztráty: náklad suroviny na porci 20 Kč."
--
-- Šťastná cesta + okrajové případy. Bezpečnost a izolace (cizí firma,
-- práva, immutabilní historie) je v krok70_scenar.sql — tenhle soubor
-- se ptá jen "počítá se to správně", ne "kdo smí co".
--
-- Navazuje na etapa0_scenar.sql (firma "Foodtab s.r.o.", pobočka
-- Černá Perla, majitel@foodtab.cz).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
-- Předchozí scénář (krok68) může nechat test.user_id nastavené.
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

-- Modul Objednávky dává purchasing.read/purchasing.manage smysl, ale
-- etapa0 ho nezapíná (jen 'provoz' je základní a 'finance' se zapíná
-- zvlášť). Bez něj by `app.has_access`/`app.can_read_scoped` odmítly
-- i majitele — ne proto, že by surovinám cokoli chybělo, ale proto, že
-- firma modul nemá. Zůstává zapnutý i pro navazující krok70.
insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'objednavky')
on conflict (tenant_id, module_key) do nothing;

\echo ''
\echo '== 0. Příprava měří to, co má ============================'

select pg_temp.check('příprava: modul Objednávky je u testovací firmy aktivní',
  exists (select 1 from public.tenant_modules
           where tenant_id = :'tenant' and module_key = 'objednavky'
             and status in ('active', 'trial')));

select pg_temp.check('příprava: oprávnění purchasing.read/purchasing.manage existují v katalogu',
  (select count(*) from public.permissions
    where key in ('purchasing.read', 'purchasing.manage')) = 2);


\echo ''
\echo '== 1. Cena KE DNI, ne nejnovější absolutně ================'
-- Tohle je jádro celé migrace: `app.ingredient_price_at` musí vrátit
-- cenu platnou k zadanému dni, ne prostě poslední vložený řádek. Druhá
-- cena je LEVNĚJŠÍ a vložená POZDĚJI (vyšším created_at) — kdyby se
-- funkce ptala "nejnovější řádek podle created_at" místo "nejvyšší
-- valid_from, který není v budoucnu", vrátila by tu novou i pro den
-- před jejím vznikem.

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok69 Brambory', 'g')
returning id as brambory \gset

-- Fixtura ze zadání: 10 kg za 1000 Kč bez DPH = 10000 g za 100000 haléřů.
insert into public.ingredient_purchase_prices
  (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'brambory', 10000, 100000, date '2026-09-01');

-- Druhá dodávka od poloviny měsíce: 10 kg za 500 Kč (levnější).
insert into public.ingredient_purchase_prices
  (tenant_id, ingredient_id, package_amount, package_price_haleru, valid_from)
values (:'tenant', :'brambory', 10000, 50000, date '2026-09-15');

select pg_temp.check('den před první dodávkou nemá žádnou cenu (NULL, ne 0 a ne přečtení dopředu)',
  app.ingredient_price_at(:'brambory', date '2026-08-31') is null);

select pg_temp.check('den mezi dodávkami počítá s tou PRVNÍ (10 haléřů/g), ne s novější',
  app.ingredient_price_at(:'brambory', date '2026-09-10') = 10);

select pg_temp.check('přesně v den druhé dodávky už počítá s ní',
  app.ingredient_price_at(:'brambory', date '2026-09-15') = 5);

select pg_temp.check('den po druhé dodávce zůstává na ní (5 haléřů/g)',
  app.ingredient_price_at(:'brambory', date '2026-09-20') = 5);


\echo ''
\echo '== 2. Fixtura ze zadání: app.recipe_cost_per_portion ======'
-- "Nákup 10 kg za 1000 Kč bez DPH, receptura 200 g bez ztráty: náklad
-- suroviny na porci 20 Kč." Počítáno ke dni, kdy platí první (dražší)
-- cena — 10 haléřů/g — aby číslo přesně sedělo na zadání.

insert into public.recipes (tenant_id, name, portions)
values (:'tenant', 'Krok69 Bramborová kaše', 1)
returning id as recept \gset

insert into public.recipe_ingredients (recipe_id, name, amount, unit, ingredient_id)
values (:'recept', 'Brambory', 200, 'g', :'brambory');

select pg_temp.check('fixtura zadání: 200 g při 10 h/g = 2000 haléřů = 20 Kč na porci',
  (select cost_haleru_per_portion from app.recipe_cost_per_portion(:'recept', date '2026-09-10')) = 2000);

select pg_temp.check('fixtura zadání: s kompletní cenou je výsledek ÚPLNÝ (neuplne = false)',
  (select neuplne from app.recipe_cost_per_portion(:'recept', date '2026-09-10')) = false);

select pg_temp.check('fixtura zadání: seznam chybějících položek je prázdný',
  (select chybejici_polozky from app.recipe_cost_per_portion(:'recept', date '2026-09-10')) = '{}');

-- Sto porcí má mít teoretickou spotřebu 20 kg (zadání, bod 3) — kontrola
-- navíc, že amount je skutečně PER PORTION a ne na celou dávku.
select pg_temp.check('100 porcí teoreticky spotřebuje 20 kg (200 g × 100 = 20000 g)',
  (select amount from public.recipe_ingredients where recipe_id = :'recept') * 100 = 20000);


\echo ''
\echo '== 3. neuplne=true — cesta A: položka bez ingredient_id ==='
-- Volný text (name/unit) beze změny funguje dál — ingredient_id je
-- NEPOVINNÝ. Recept s takovou položkou je NEÚPLNÝ, ne odhadnutý na nulu.

insert into public.recipes (tenant_id, name, portions)
values (:'tenant', 'Krok69 Volný text', 1)
returning id as recept_volny \gset

insert into public.recipe_ingredients (recipe_id, name, amount, unit)
values (:'recept_volny', 'Krok69 Sůl (volný text)', 5, 'g');

select pg_temp.check('bez ingredient_id: cena je NULL, ne 0',
  (select cost_haleru_per_portion from app.recipe_cost_per_portion(:'recept_volny')) is null);

select pg_temp.check('bez ingredient_id: neuplne = true',
  (select neuplne from app.recipe_cost_per_portion(:'recept_volny')) = true);

select pg_temp.check('bez ingredient_id: chybějící položka je pojmenovaná a vysvětlená',
  (select chybejici_polozky from app.recipe_cost_per_portion(:'recept_volny'))
    = array['Krok69 Sůl (volný text) (nenapojeno na katalog surovin)']);


\echo ''
\echo '== 4. neuplne=true — cesta B: ingredient_id bez jediné ceny'
-- JINÁ cesta k témuž výsledku — surovina v katalogu JE, napojení JE,
-- ale nikdo pro ni ještě nezadal nákupní cenu. Testuje se zvlášť,
-- protože by šlo napsat funkci, která cestu A pokryje a cestu B ne
-- (a naopak) — scenar skill, bod 2.

insert into public.ingredients (tenant_id, name, base_unit)
values (:'tenant', 'Krok69 Bez ceny', 'g')
returning id as bez_ceny \gset

insert into public.recipes (tenant_id, name, portions)
values (:'tenant', 'Krok69 Chybí cena', 1)
returning id as recept_bez_ceny \gset

insert into public.recipe_ingredients (recipe_id, name, amount, unit, ingredient_id)
values (:'recept_bez_ceny', 'Krok69 Nová surovina', 50, 'g', :'bez_ceny');

select pg_temp.check('s ingredient_id ale bez ceny: cena je NULL',
  (select cost_haleru_per_portion from app.recipe_cost_per_portion(:'recept_bez_ceny')) is null);

select pg_temp.check('s ingredient_id ale bez ceny: neuplne = true',
  (select neuplne from app.recipe_cost_per_portion(:'recept_bez_ceny')) = true);

select pg_temp.check('s ingredient_id ale bez ceny: důvod je "chybí platná nákupní cena", ne "nenapojeno"',
  (select chybejici_polozky from app.recipe_cost_per_portion(:'recept_bez_ceny'))
    = array['Krok69 Nová surovina (chybí platná nákupní cena)']);


\echo ''
\echo '== 4b. neuplne=true — cesta C: jednotka receptury nesedí ==='
-- Surovina JE napojená a MÁ platnou cenu, ale recipe_ingredients.unit
-- (volný text) neodpovídá ingredients.base_unit — bez kontroly by se
-- "0.2 kg" násobilo cenou za gram a vrátilo tisíckrát podhodnocené
-- číslo TVÁŘÍCÍ SE JAKO ÚPLNÉ (kontrola 2. 10. 2026, Nález A).

insert into public.recipes (tenant_id, name, portions)
values (:'tenant', 'Krok69 Spatna jednotka', 1)
returning id as recept_spatna_jednotka \gset

insert into public.recipe_ingredients (recipe_id, name, amount, unit, ingredient_id)
values (:'recept_spatna_jednotka', 'Brambory v kg', 0.2, 'kg', :'brambory');

select pg_temp.check('nesedící jednotka (kg vs g): cena je NULL, ne tichý špatný výsledek',
  (select cost_haleru_per_portion from app.recipe_cost_per_portion(:'recept_spatna_jednotka', date '2026-09-10')) is null);

select pg_temp.check('nesedící jednotka: neuplne = true',
  (select neuplne from app.recipe_cost_per_portion(:'recept_spatna_jednotka', date '2026-09-10')) = true);

select pg_temp.check('nesedící jednotka: důvod jmenuje obě jednotky, ne obecnou hlášku',
  (select chybejici_polozky from app.recipe_cost_per_portion(:'recept_spatna_jednotka', date '2026-09-10'))
    = array['Brambory v kg (jednotka receptury "kg" neodpovídá základní jednotce suroviny "g")']);


\echo ''
\echo '== 5. Žádný částečný odhad ================================'
-- Recept se dvěma položkami: jedna kompletní (Brambory, platná cena),
-- druhá neúplná (Bez ceny). Výsledek musí být CELÝ neúplný — ne
-- "spočítáme aspoň to, co víme" s tichým podhodnocením zbytku.

insert into public.recipes (tenant_id, name, portions)
values (:'tenant', 'Krok69 Smíchaný recept', 1)
returning id as recept_smichany \gset

insert into public.recipe_ingredients (recipe_id, name, amount, unit, ingredient_id) values
  (:'recept_smichany', 'Brambory', 200, 'g', :'brambory'),
  (:'recept_smichany', 'Krok69 Bez ceny (ve směsi)', 50, 'g', :'bez_ceny');

select pg_temp.check('smíchaný recept: jedna chybějící položka udělá NEÚPLNÝ celek, ne poloviční cenu',
  (select cost_haleru_per_portion from app.recipe_cost_per_portion(:'recept_smichany', date '2026-09-10')) is null
  and (select neuplne from app.recipe_cost_per_portion(:'recept_smichany', date '2026-09-10')) = true);

select pg_temp.check('smíchaný recept: v chybějících je JEN ta neúplná položka, ne obě',
  (select chybejici_polozky from app.recipe_cost_per_portion(:'recept_smichany', date '2026-09-10'))
    = array['Krok69 Bez ceny (ve směsi) (chybí platná nákupní cena)']);


\echo ''
\echo '== 6. Receptura, která neexistuje ========================='

select pg_temp.check('neexistující receptura: neuplne = true, ne chyba',
  (select neuplne from app.recipe_cost_per_portion(gen_random_uuid())) = true);


\echo ''
\echo '== Úklid ==================================================='

reset role;
delete from public.recipe_ingredients where recipe_id in
  (:'recept', :'recept_volny', :'recept_bez_ceny', :'recept_smichany', :'recept_spatna_jednotka');
delete from public.recipes where id in
  (:'recept', :'recept_volny', :'recept_bez_ceny', :'recept_smichany', :'recept_spatna_jednotka');
delete from public.ingredient_purchase_prices where ingredient_id in (:'brambory', :'bez_ceny');
delete from public.ingredients where id in (:'brambory', :'bez_ceny');

select pg_temp.check('úklid: po scénáři nezůstala žádná surovina ani receptura kroku 69',
  not exists (select 1 from public.ingredients where name like 'Krok69 %')
  and not exists (select 1 from public.recipes where name like 'Krok69 %'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 69 HOTOV ==========================================='
