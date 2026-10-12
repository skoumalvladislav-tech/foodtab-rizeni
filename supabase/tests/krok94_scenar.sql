-- Scénář pro krok 94 — opravy napojení pokladen před prvním ostrým
-- připojením Dotykačky.
--
-- Migrace: 20261012100000_pokladna_opravy_pred_spustenim.sql.
--
-- Pokrývá:
--   1. práva: `pokladna_ulozit_postup` jen pro service_role;
--   2. zápis u firemního připojení jen s PROVOZOVNOU přiřazenou k té
--      pobočce — jiná provozovna, chybějící provozovna a neznámá
--      provozovna odmítnuty (dřív stačila jakákoli provozovna na pobočce);
--   3. tržba produktu za den mimo rozsah sloupce → srozumitelná chyba;
--   4. postup synchronizace: kurzory jen provozovnám se stejným id
--      i pobočkou; přeřazená provozovna nic nedostane; přiřazení, Cloud ID
--      a historie_od zůstávají; historie_od se doplní, jen když chybí;
--   5. receptura se k prodeji dosadí i dodatečně (nová, aktivovaná,
--      přejmenovaná receptura) — jen kde chybí, jen ve správné pobočce;
--      a při uložení postupu i tam, kde ji souběh s triggerem minul;
--   6. uvázlý den v postupu: zapíše se i smaže (null = povedl se);
--   7. řádky jiného API zdroje z ODPOJENÉHO připojení ustoupí živé
--      pokladně; živé jiné připojení ani CSV se nemažou;
--   8. úklid připojení ve všech pobočkách naráz (p_branch = null);
--   9. souhrn pro stránku Prodeje: CSV se za den s API nepočítá, práva.
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

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select id as bar   from public.branches where tenant_id = :'tenant' and slug = 'bernard-bar' \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'dotykacka', 'zakaznicky', 'pripojeno',
  jsonb_build_object('cloud_id', '94', 'provozovny', jsonb_build_array(
    jsonb_build_object('id', '41', 'nazev', 'Perla v Dotykačce', 'branch_id', :'perla', 'dohnano_od', null),
    jsonb_build_object('id', '42', 'nazev', 'Bar v Dotykačce', 'branch_id', :'bar', 'dohnano_od', '2026-09-01', 'souvisle_do', '2026-10-01'),
    jsonb_build_object('id', '43', 'nazev', 'Nepřiřazená', 'branch_id', null, 'dohnano_od', null))))
returning id as dotyk \gset


\echo ''
\echo '== 1. Práva ======================================================'

select pg_temp.check('anon nemá EXECUTE na pokladna_ulozit_postup',
  not has_function_privilege('anon', 'public.pokladna_ulozit_postup(uuid, jsonb, date)', 'execute'));
select pg_temp.check('authenticated nemá EXECUTE na pokladna_ulozit_postup (kurzory píše jen synchronizace)',
  not has_function_privilege('authenticated', 'public.pokladna_ulozit_postup(uuid, jsonb, date)', 'execute'));
select pg_temp.check('service_role ano',
  has_function_privilege('service_role', 'public.pokladna_ulozit_postup(uuid, jsonb, date)', 'execute'));
select pg_temp.check('zapisovací funkce má i s provozovnou EXECUTE jen service_role',
  not has_function_privilege('authenticated', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb)', 'execute'));


\echo ''
\echo '== 2. Firemní připojení: zápis jen s provozovnou té pobočky ====='

set role service_role;
select public.pokladna_nahradit_prodeje(:'dotyk', :'perla', array['2026-10-05']::date[], '[
  {"datum":"2026-10-05","produkt_nazev":"Krok94 Svíčková","mnozstvi":2,"trzba_haleru":50000}
]'::jsonb, '41') as zapsano \gset
reset role;
select pg_temp.check('provozovna 41 přiřazená k Perle zapsala do Perly',
  :'zapsano' = 1 and exists (select 1 from public.pokladna_prodeje_denni
                               where branch_id = :'perla' and datum = '2026-10-05' and produkt_nazev = 'Krok94 Svíčková'));

set role service_role;
select pg_temp.check('provozovna Baru (42) do Perly → odmítnuto (dřív stačila jakákoli provozovna na pobočce)',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'perla', '2026-10-05', '[]', '42'),
    '23514', 'tahle provozovna'));
select pg_temp.check('bez provozovny u firemního připojení → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb)', :'dotyk', :'perla', '2026-10-05', '[]'),
    '23514', 'tahle provozovna'));
select pg_temp.check('neznámá provozovna → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'perla', '2026-10-05', '[]', '99'),
    '23514', 'tahle provozovna'));
select pg_temp.check('nepřiřazená provozovna (43) → odmítnuto',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'bar', '2026-10-05', '[]', '43'),
    '23514', 'tahle provozovna'));
reset role;

select pg_temp.check('odmítnuté zápisy Perlu nesmazaly',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-05' and produkt_nazev = 'Krok94 Svíčková'));


\echo ''
\echo '== 3. Tržba mimo rozsah → srozumitelná chyba ===================='

set role service_role;
select pg_temp.check('součet za produkt a den nad 21 474 836,47 Kč → numeric_value_out_of_range s vysvětlením',
  pg_temp.spadne_hlaskou(
    format('select public.pokladna_nahradit_prodeje(%L, %L, array[%L]::date[], %L::jsonb, %L)', :'dotyk', :'perla', '2026-10-05',
      '[{"datum":"2026-10-05","produkt_nazev":"Krok94 X","mnozstvi":1,"trzba_haleru":2000000000},{"datum":"2026-10-05","produkt_nazev":" Krok94 X ","mnozstvi":1,"trzba_haleru":2000000000}]', '41'),
    '22003', 'mimo rozsah'));
reset role;
select pg_temp.check('… a den zůstal, jak byl',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-05' and produkt_nazev = 'Krok94 Svíčková'));


\echo ''
\echo '== 4. Postup synchronizace — jen kurzory, přiřazení nemění ======'

-- Během běhu si člověk přeřadil Bar (42) do Perly a Perlu (41) odebral —
-- běh pak hlásí kurzory podle STARÉHO přiřazení.
update public.integrace_pripojeni
   set externi_ucet = externi_ucet - 'historie_od'
     || jsonb_build_object('provozovny', jsonb_build_array(
          jsonb_build_object('id', '41', 'nazev', 'Perla v Dotykačce', 'branch_id', null, 'dohnano_od', null),
          jsonb_build_object('id', '42', 'nazev', 'Bar v Dotykačce', 'branch_id', :'perla', 'dohnano_od', null, 'souvisle_do', null),
          jsonb_build_object('id', '43', 'nazev', 'Nepřiřazená', 'branch_id', :'bar', 'dohnano_od', null)))
 where id = :'dotyk';

set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', jsonb_build_array(
  jsonb_build_object('id', '41', 'branch_id', :'perla', 'dohnano_od', '2026-10-03', 'souvisle_do', '2026-10-12'),
  jsonb_build_object('id', '42', 'branch_id', :'bar',   'dohnano_od', '2026-08-01', 'souvisle_do', '2026-10-12')
), '2026-01-01');
reset role;

select externi_ucet as ucet from public.integrace_pripojeni where id = :'dotyk' \gset
select pg_temp.check('přeřazený Bar (teď v Perle) kurzor ze starého běhu nedostal — nová pobočka začíná od nuly',
  (:'ucet'::jsonb -> 'provozovny' -> 1 ->> 'dohnano_od') is null
  and (:'ucet'::jsonb -> 'provozovny' -> 1 ->> 'souvisle_do') is null
  and (:'ucet'::jsonb -> 'provozovny' -> 1 ->> 'branch_id') = :'perla');
select pg_temp.check('odebraná Perla (41) zůstala odebraná, kurzor nedostala',
  (:'ucet'::jsonb -> 'provozovny' -> 0 ->> 'branch_id') is null
  and (:'ucet'::jsonb -> 'provozovny' -> 0 ->> 'dohnano_od') is null);
select pg_temp.check('nově přiřazená 43 zůstala přiřazená',
  (:'ucet'::jsonb -> 'provozovny' -> 2 ->> 'branch_id') = :'bar');
select pg_temp.check('Cloud ID zůstalo, historie_od doplněna (chyběla)',
  (:'ucet'::jsonb ->> 'cloud_id') = '94' and (:'ucet'::jsonb ->> 'historie_od') = '2026-01-01');

-- Běh, jehož přiřazení sedí: kurzory se zapíšou; historie_od se nepřepíše.
set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', jsonb_build_array(
  jsonb_build_object('id', '42', 'branch_id', :'perla', 'dohnano_od', '2026-10-01', 'souvisle_do', '2026-10-12')
), '2025-06-01');
reset role;
select externi_ucet as ucet from public.integrace_pripojeni where id = :'dotyk' \gset
select pg_temp.check('provozovna se stejným id i pobočkou kurzory dostala',
  (:'ucet'::jsonb -> 'provozovny' -> 1 ->> 'dohnano_od') = '2026-10-01'
  and (:'ucet'::jsonb -> 'provozovny' -> 1 ->> 'souvisle_do') = '2026-10-12');
select pg_temp.check('historie_od, která už byla, se nepřepíše',
  (:'ucet'::jsonb ->> 'historie_od') = '2026-01-01');
select pg_temp.check('pořadí a počet provozoven beze změny',
  jsonb_array_length(:'ucet'::jsonb -> 'provozovny') = 3
  and (:'ucet'::jsonb -> 'provozovny' -> 0 ->> 'id') = '41'
  and (:'ucet'::jsonb -> 'provozovny' -> 2 ->> 'id') = '43');

-- Běh bez nového kurzoru (null) starý kurzor nesmaže.
set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', jsonb_build_array(
  jsonb_build_object('id', '42', 'branch_id', :'perla', 'dohnano_od', null, 'souvisle_do', null)
));
reset role;
select pg_temp.check('prázdný kurzor z běhu nepřepíše uložený',
  (select externi_ucet -> 'provozovny' -> 1 ->> 'dohnano_od' from public.integrace_pripojeni where id = :'dotyk') = '2026-10-01');


\echo ''
\echo '== 5. Receptura k prodeji i dodatečně =========================='

set role service_role;
select public.pokladna_nahradit_prodeje(:'dotyk', :'perla', array['2026-10-06']::date[], '[
  {"datum":"2026-10-06","produkt_nazev":"Krok94 Pozdní guláš","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-06","produkt_nazev":"Krok94 Jen bar","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-06","produkt_nazev":"Krok94 Neaktivní","mnozstvi":1,"trzba_haleru":100},
  {"datum":"2026-10-06","produkt_nazev":"Krok94 Přejmenovaný","mnozstvi":1,"trzba_haleru":100}
]'::jsonb, '42') as zapsano_5 \gset
reset role;

select pg_temp.check('prodej bez receptury (zatím neexistuje) zůstal bez receptury',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Pozdní guláš') is null);

insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', ' krok94 POZDNÍ guláš', 1, 'jidlo')
returning id as gulas \gset
select pg_temp.check('nová receptura stejného jména se k dřívějšímu prodeji dosadí sama',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Pozdní guláš') = :'gulas');

insert into public.recipes (tenant_id, branch_id, name, portions, druh) values (:'tenant', :'bar', 'Krok94 Jen bar', 1, 'jidlo');
select pg_temp.check('receptura jen pro jinou pobočku (Bar) se k prodeji v Perle nedosadí',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Jen bar') is null);

insert into public.recipes (tenant_id, name, portions, druh, active) values (:'tenant', 'Krok94 Neaktivní', 1, 'jidlo', false)
returning id as neaktivni \gset
select pg_temp.check('neaktivní receptura se nedosadí',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Neaktivní') is null);
update public.recipes set active = true where id = :'neaktivni';
select pg_temp.check('… po aktivaci ano',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Neaktivní') = :'neaktivni');

insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', 'Krok94 Starý název', 1, 'jidlo')
returning id as prejmenovana \gset
update public.recipes set name = 'Krok94 Přejmenovaný' where id = :'prejmenovana';
select pg_temp.check('přejmenovaná receptura se dosadí k prodejům nového jména',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Přejmenovaný') = :'prejmenovana');

-- Guláš se přejmenuje a jeho dřívější jméno dostane nová receptura: dřív
-- dosazená shoda se zpětně nepřepíše (foodcost minulých dní se nemění sám).
update public.recipes set name = 'Krok94 Pozdní guláš II' where id = :'gulas';
insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', 'Krok94 Pozdní guláš', 1, 'jidlo');
select pg_temp.check('dřív dosazená receptura se novou recepturou téhož jména nepřepíše (doplňuje se jen chybějící)',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Pozdní guláš') = :'gulas');


-- Souběh: receptura vznikla, ale trigger řádek „neviděl" (napodobeno
-- vypnutým triggerem) — uložení postupu ho dopáruje.
set role service_role;
select public.pokladna_nahradit_prodeje(:'dotyk', :'perla', array['2026-10-10']::date[], '[{"datum":"2026-10-10","produkt_nazev":"Krok94 Souběh","mnozstvi":1,"trzba_haleru":100}]'::jsonb, '42');
reset role;
alter table public.recipes disable trigger trg_receptura_doparovat_prodeje;
insert into public.recipes (tenant_id, name, portions, druh) values (:'tenant', 'Krok94 Souběh', 1, 'jidlo')
returning id as minuta \gset
alter table public.recipes enable trigger trg_receptura_doparovat_prodeje;
select pg_temp.check('(příprava) řádek, který trigger minul, je bez receptury',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Souběh') is null);
set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', '[]'::jsonb);
reset role;
select pg_temp.check('uložení postupu dopáruje recepturu, kterou souběh minul',
  (select recipe_id from public.pokladna_prodeje_denni where branch_id = :'perla' and produkt_nazev = 'Krok94 Souběh') = :'minuta');


\echo ''
\echo '== 6. Uvázlý den v postupu ======================================'

set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', jsonb_build_array(
  jsonb_build_object('id', '42', 'branch_id', :'perla', 'dohnano_od', null, 'souvisle_do', null, 'uvazl', jsonb_build_object('den', '2026-09-30', 'pokusu', 2))));
reset role;
select pg_temp.check('uvázlý den se zapíše k provozovně',
  (select externi_ucet -> 'provozovny' -> 1 -> 'uvazl' ->> 'pokusu' from public.integrace_pripojeni where id = :'dotyk') = '2');
set role service_role;
select public.pokladna_ulozit_postup(:'dotyk', jsonb_build_array(
  jsonb_build_object('id', '42', 'branch_id', :'perla', 'dohnano_od', null, 'souvisle_do', null, 'uvazl', null)));
reset role;
select pg_temp.check('uvazl = null (den se povedl) uvázlost smaže, kurzory zůstanou',
  not ((select externi_ucet -> 'provozovny' -> 1 from public.integrace_pripojeni where id = :'dotyk') ? 'uvazl')
  and (select externi_ucet -> 'provozovny' -> 1 ->> 'dohnano_od' from public.integrace_pripojeni where id = :'dotyk') = '2026-10-01');


\echo ''
\echo '== 7. Jiný API zdroj z odpojeného připojení ustoupí ============='

-- Perla dřív dostávala prodeje přes příjmové API (teď odpojené), Bar má živé.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav)
values (:'tenant', :'perla', 'pokladna', 'obecne', 'zakaznicky', 'pripojeno')
returning id as stare_api \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav)
values (:'tenant', :'bar', 'pokladna', 'obecne', 'zakaznicky', 'pripojeno')
returning id as zive_api \gset
-- Živé jiné API přímo v Perle (appka to přiřazením nedovolí, databáze ano) — nesmí zmizet.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav)
values (:'tenant', :'perla', 'pokladna', 'krok94zive', 'zakaznicky', 'pripojeno')
returning id as zive_v_perle \gset
insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, integrace_pripojeni_id) values
  (:'tenant', :'perla', '2026-10-08', 'Krok94 Staré API', 1, 1000, 'obecne_api', :'stare_api'),
  (:'tenant', :'perla', '2026-10-09', 'Krok94 Staré API jiný den', 1, 1000, 'obecne_api', :'stare_api'),
  (:'tenant', :'bar',   '2026-10-08', 'Krok94 Živé API v baru', 1, 1000, 'obecne_api', :'zive_api'),
  (:'tenant', :'perla', '2026-10-08', 'Krok94 Živé API v Perle', 1, 1000, 'krok94zive_api', :'zive_v_perle');
insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj)
values (:'tenant', :'perla', '2026-10-08', 'Krok94 CSV', 1, 1000, 'csv');
update public.integrace_pripojeni set odpojeno_kdy = now(), stav = 'odpojeno' where id = :'stare_api';

set role service_role;
select public.pokladna_nahradit_prodeje(:'dotyk', :'perla', array['2026-10-08']::date[], '[
  {"datum":"2026-10-08","produkt_nazev":"Krok94 Z Dotykačky","mnozstvi":1,"trzba_haleru":500}
]'::jsonb, '42') as zapsano_7 \gset
reset role;
select pg_temp.check('řádek odpojeného příjmového API téhož dne a pobočky ustoupil Dotykačce (nesečtou se)',
  not exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-08' and produkt_nazev = 'Krok94 Staré API'));
select pg_temp.check('jiný den odpojeného API zůstal (přepisuje se jen zapsaný den)',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-09' and produkt_nazev = 'Krok94 Staré API jiný den'));
select pg_temp.check('CSV téhož dne zůstalo (foodcost ho za den s API sám nepočítá)',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-08' and zdroj = 'csv' and produkt_nazev = 'Krok94 CSV'));
select pg_temp.check('živé jiné API téže pobočky a dne nedotčené (ustupuje jen odpojené)',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'perla' and datum = '2026-10-08' and produkt_nazev = 'Krok94 Živé API v Perle'));
select pg_temp.check('živé API jiné pobočky nedotčené',
  exists (select 1 from public.pokladna_prodeje_denni where branch_id = :'bar' and produkt_nazev = 'Krok94 Živé API v baru'));


\echo ''
\echo '== 8. Úklid připojení ve všech pobočkách naráz =================='

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok94pos', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '1', 'nazev', 'P', 'branch_id', :'perla', 'dohnano_od', null),
    jsonb_build_object('id', '2', 'nazev', 'B', 'branch_id', :'bar', 'dohnano_od', null))))
returning id as dvoji \gset
set role service_role;
select public.pokladna_nahradit_prodeje(:'dvoji', :'perla', array['2026-10-01']::date[], '[{"datum":"2026-10-01","produkt_nazev":"Krok94 U1","mnozstvi":1,"trzba_haleru":1}]'::jsonb, '1');
select public.pokladna_nahradit_prodeje(:'dvoji', :'bar',   array['2026-10-01']::date[], '[{"datum":"2026-10-01","produkt_nazev":"Krok94 U2","mnozstvi":1,"trzba_haleru":1}]'::jsonb, '2');
select public.pokladna_odebrat_prodeje(:'dvoji', null) as smazano_8 \gset
reset role;
select pg_temp.check('p_branch = null smaže prodeje připojení ve všech pobočkách (2 řádky)',
  :'smazano_8' = 2 and not exists (select 1 from public.pokladna_prodeje_denni where integrace_pripojeni_id = :'dvoji'));
select pg_temp.check('… a nic cizího (Dotykačka v Perle zůstala)',
  exists (select 1 from public.pokladna_prodeje_denni where integrace_pripojeni_id = :'dotyk'));


\echo ''
\echo '== 9. Souhrn pro stránku Prodeje ================================'

select pg_temp.check('souhrn smí authenticated (RLS volajícího), anon ne',
  has_function_privilege('authenticated', 'public.pokladna_prodeje_souhrn(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.pokladna_prodeje_souhrn(uuid, integer)', 'execute'));

select trzba_haleru as souhrn_trzba, polozek as souhrn_polozek
  from public.pokladna_prodeje_souhrn(:'tenant', 400) where datum = '2026-10-08' \gset
-- Perla: Dotykačka 500 + živé jiné API 1000 (+ CSV 1000, které se nepočítá); Bar: API 1000.
select pg_temp.check('den s API: CSV téže pobočky se nepočítá (500 + 1000 + 1000 = 2500, 3 položky)',
  :'souhrn_trzba' = 2500 and :'souhrn_polozek' = 3);
select pg_temp.check('souhrn je jen za dny s daty, nejnovější první, nejvýš p_dnu',
  (select count(*) from public.pokladna_prodeje_souhrn(:'tenant', 2)) = 2);


-- Úklid: řádky prodeje a receptury pryč; připojení zůstává (audit).
delete from public.pokladna_prodeje_denni where produkt_nazev ilike 'krok94%';
delete from public.recipes where name ilike 'krok94%';

\echo ''
\echo '== KROK 94 HOTOV =============================================='
