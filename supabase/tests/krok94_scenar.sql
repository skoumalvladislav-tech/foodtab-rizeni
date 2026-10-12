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
--      přejmenovaná receptura) — jen kde chybí, jen ve správné pobočce.
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
  not has_function_privilege('authenticated', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text)', 'execute'));


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


-- Úklid: řádky prodeje a receptury pryč; připojení zůstává (audit).
delete from public.pokladna_prodeje_denni where produkt_nazev ilike 'krok94%';
delete from public.recipes where name ilike 'krok94%';

\echo ''
\echo '== KROK 94 HOTOV =============================================='
