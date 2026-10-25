-- Scénář pro krok 103 — Jiné platby: výdej ze skladu v Dotykačce, příprava
-- zápisu (migrace 20261025230000_jine_platby_vydej_dotykacka.sql, návrh
-- docs/jine-platby-vydej-dotykacka.md).
--
-- Pokrývá:
--   1. granty: nová tabulka pokusů o přiřazení přes AI jen SELECT přes RLS,
--      funkce pokusů jen service_role, app.jp_provozovna_vydeje nikomu;
--   2. receptury v katalogu: `suroviny` se uloží a `ma_recepturu` z nich
--      odvodí databáze ([] = bez receptury, pole = s recepturou, bez pole =
--      jak řekl adaptér); nečitelná surovina se vynechá, množství mimo tvar
--      zůstane prázdné;
--   3. náhled výdeje: položka, která je surovinou pokrmu ze STEJNÉHO výdeje,
--      dá konkrétní varování (i rozlévaný nápoj); známá receptura bez
--      překryvu varování nedá; neznámá receptura dá obecné varování jako
--      dřív; otisk na recepturách nezávisí; schválení s varováním chce
--      p_bez_surovin;
--   4. provozovna požadavku při zabrání: u pokladny pobočky ji doplní
--      z přiřazení (právě jedna), dvě nebo žádná = neodešle se, přeřazení
--      uložené provozovny = neodešle se, operace s jinou provozovnou, než
--      dává přiřazení = neodešle se; filtry firmy a odpojení;
--   5. pokusy o přiřazení přes AI: verze, zamčený výdej, rozsah položek,
--      souběh, strop 10 na záznam a 100 na firmu, dokončení jen běžícího
--      pokusu s platným výsledkem a zápis do historie.
--
-- Navazuje na etapa0_scenar.sql (firma „Foodtab s.r.o.", pobočky
-- cerna-perla a bernard-bar, majitel@foodtab.cz). Všechno se počítá jen nad
-- vlastními fixturami (CI pouští scénáře v jedné databázi).

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
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

-- Cizí firma (jen kvůli filtru firmy v app.jp_provozovna_vydeje).
insert into auth.users (id, email, raw_user_meta_data) values
  ('10310000-0000-0000-0000-000000000009', 'cizi103@jinafirma.cz', '{"full_name":"Cizí Stotři"}');
set role authenticated;
select set_config('test.user_id', '10310000-0000-0000-0000-000000000009', false);
select app.create_tenant('Krok103 Cizí s.r.o.', 'Cizí Stotři') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

-- Pokladna celé firmy: provozovna 11 = Perla, 12 = Bar.
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok103firma', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '11', 'nazev', 'Perla', 'branch_id', :'perla'),
    jsonb_build_object('id', '12', 'nazev', 'Bar',   'branch_id', :'bar'))))
returning id as pos \gset
-- Pokladna připojená k POBOČCE Perla (záznam pak provozovnu nenese).
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', :'perla', 'pokladna', 'krok103pobocka', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '31', 'nazev', 'Perla výčep', 'branch_id', :'perla'))))
returning id as pos_pob \gset

-- Katalog firmy: svíčková s recepturou (S1 smetana, M1 mouka), koktejl
-- s recepturou (R1 rum), hranolky, smetana, rum, polévka bez receptury
-- (adaptér ji nezná → ma_recepturu null).
set role service_role;
select public.pos_katalog_nahradit(:'pos', jsonb_build_array(
  jsonb_build_object('externi_id', 'P1', 'nazev', 'Svíčková', 'jednotka', 'Piece', 'odecita_sklad', false, 'ma_recepturu', false,
    'suroviny', jsonb_build_array(
      jsonb_build_object('produkt', 'S1', 'mnozstvi', '0.1', 'jednotka', 'Liter'),
      jsonb_build_object('produkt', 'M1', 'mnozstvi', 'hodně', 'jednotka', 'Kilogram'),
      jsonb_build_object('mnozstvi', '1'),
      to_jsonb('rozbité'::text))),
  jsonb_build_object('externi_id', 'P2', 'nazev', 'Koktejl Perla', 'jednotka', 'Piece', 'odecita_sklad', false,
    'suroviny', jsonb_build_array(jsonb_build_object('produkt', 'R1', 'mnozstvi', '0.04', 'jednotka', 'Liter'))),
  jsonb_build_object('externi_id', 'H1', 'nazev', 'Hranolky', 'jednotka', 'Piece', 'odecita_sklad', true, 'ma_recepturu', true, 'suroviny', '[]'::jsonb),
  jsonb_build_object('externi_id', 'S1', 'nazev', 'Smetana 33 %', 'jednotka', 'Liter', 'odecita_sklad', true, 'suroviny', '[]'::jsonb),
  jsonb_build_object('externi_id', 'R1', 'nazev', 'Rum', 'jednotka', 'Liter', 'odecita_sklad', true, 'suroviny', '[]'::jsonb),
  jsonb_build_object('externi_id', 'P9', 'nazev', 'Polévka dne', 'jednotka', 'Piece', 'odecita_sklad', false)
)) as katalog_pocet \gset
select public.pos_katalog_nahradit(:'pos_pob', jsonb_build_array(
  jsonb_build_object('externi_id', 'X1', 'nazev', 'Pivo 0,5 l', 'jednotka', 'Piece', 'odecita_sklad', true, 'suroviny', '[]'::jsonb)
)) as katalog_pob \gset
reset role;


\echo ''
\echo '== 1. Granty ====================================================='

select pg_temp.check('jine_platby_ai_parovani: RLS zapnuté, authenticated jen SELECT, anon nic',
  (select relrowsecurity from pg_class where oid = 'public.jine_platby_ai_parovani'::regclass)
  and has_table_privilege('authenticated', 'public.jine_platby_ai_parovani', 'select')
  and not has_table_privilege('authenticated', 'public.jine_platby_ai_parovani', 'insert')
  and not has_table_privilege('authenticated', 'public.jine_platby_ai_parovani', 'update')
  and not has_table_privilege('authenticated', 'public.jine_platby_ai_parovani', 'delete')
  and not has_table_privilege('anon', 'public.jine_platby_ai_parovani', 'select'));
select pg_temp.check('pokusy o přiřazení zahajuje a dokončuje jen service_role (ne authenticated, ne anon)',
  has_function_privilege('service_role', 'public.jine_platby_zahajit_parovani(uuid, uuid, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.jine_platby_dokoncit_parovani(uuid, text, text, text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.jine_platby_zahajit_parovani(uuid, uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.jine_platby_dokoncit_parovani(uuid, text, text, text, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.jine_platby_zahajit_parovani(uuid, uuid, integer, integer)', 'execute'));
select pg_temp.check('app.jp_provozovna_vydeje nikdo zvenku nevolá; zabrání operace dál jen service_role',
  not has_function_privilege('authenticated', 'app.jp_provozovna_vydeje(public.jine_platby)', 'execute')
  and not has_function_privilege('anon', 'app.jp_provozovna_vydeje(public.jine_platby)', 'execute')
  and has_function_privilege('service_role', 'public.pos_operace_zahajit(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.pos_operace_zahajit(uuid, timestamptz)', 'execute'));
select pg_temp.check('pos_katalog.suroviny čte authenticated (celotabulkový SELECT, žádná sloupcová výjimka)',
  has_column_privilege('authenticated', 'public.pos_katalog', 'suroviny', 'select'));


\echo ''
\echo '== 2. Receptury v katalogu ======================================='

select pg_temp.check('svíčková: suroviny S1 a M1 (nečitelná surovina vynechaná), ma_recepturu odvozené = true, i když adaptér poslal false',
  (select ma_recepturu is true and jsonb_array_length(suroviny) = 2
          and suroviny -> 0 ->> 'produkt' = 'S1' and suroviny -> 0 ->> 'mnozstvi' = '0.1' and suroviny -> 0 ->> 'jednotka' = 'Liter'
          and suroviny -> 1 ->> 'produkt' = 'M1'
     from public.pos_katalog where pripojeni_id = :'pos' and externi_id = 'P1'));
select pg_temp.check('množství suroviny mimo tvar čísla zůstane prázdné (nic se nedomýšlí)',
  (select suroviny -> 1 -> 'mnozstvi' = 'null'::jsonb from public.pos_katalog where pripojeni_id = :'pos' and externi_id = 'P1'));
select pg_temp.check('hranolky: suroviny [] → ma_recepturu false, i když adaptér poslal true (rozhoduje receptura)',
  (select ma_recepturu is false and suroviny = '[]'::jsonb from public.pos_katalog where pripojeni_id = :'pos' and externi_id = 'H1'));
select pg_temp.check('polévka bez pole surovin: suroviny null a ma_recepturu jak řekl adaptér (null = neví se)',
  (select suroviny is null and ma_recepturu is null from public.pos_katalog where pripojeni_id = :'pos' and externi_id = 'P9'));
select pg_temp.check('suroviny jiného tvaru než pole nejdou ani přímým zápisem (check)',
  pg_temp.spadne_hlaskou(format('update public.pos_katalog set suroviny = %L::jsonb where pripojeni_id = %L and externi_id = %L', '{"a":1}', :'pos', 'P1'),
    '23514', 'pos_katalog_suroviny_check'));


\echo ''
\echo '== 3. Náhled výdeje s recepturami ================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Hlavička: provozní den 2026-02-03, každý záznam jiná částka (ať se nehlásí duplicity).
select jsonb_build_object('datum_prodeje', '2026-02-03', 'oznaceni', 'Krok103', 'mena', 'CZK',
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', null, 'kontakt_id', null)::text as hlavicka \gset

-- zA: svíčková + smetana (surovina svíčkové) → konkrétní varování.
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Krok103 A', '10310000-aaaa-0000-0000-00000000000a') as za \gset
select public.jine_platby_ulozit_navrh(:'za', 1, jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '63100'), jsonb_build_array(
  jsonb_build_object('nazev', 'Svíčková', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 29000, 'cena_celkem_haleru', 58000,
    'zdroj', 'rucne', 'druh', 'pokrm', 'pos_produkt_id', 'P1', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Smetana navíc', 'mnozstvi', '1', 'jednotka', 'l', 'cena_jednotkova_haleru', 5100, 'cena_celkem_haleru', 5100,
    'zdroj', 'rucne', 'druh', 'kusove_zbozi', 'pos_produkt_id', 'S1', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as verze_za \gset
select public.jine_platby_sestavit_vydej(:'za')::text as vydej_a \gset
select pg_temp.check('zA: smetana je surovinou svíčkové ve stejném výdeji → JEDNO konkrétní varování se jmény, obecné ne',
  jsonb_array_length(:'vydej_a'::jsonb -> 'varovani') = 1
  and (:'vydej_a'::jsonb -> 'varovani' ->> 0) like '„Smetana 33 %“ je surovinou „Svíčková“ ve stejném výdeji%'
  and jsonb_array_length(:'vydej_a'::jsonb -> 'blokace') = 0);

-- zB: svíčková + hranolky (známá receptura, hranolky v ní nejsou) → bez varování.
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Krok103 B', '10310000-aaaa-0000-0000-00000000000b') as zb \gset
select public.jine_platby_ulozit_navrh(:'zb', 1, jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '64200'), jsonb_build_array(
  jsonb_build_object('nazev', 'Svíčková', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 29000, 'cena_celkem_haleru', 58000,
    'zdroj', 'rucne', 'druh', 'pokrm', 'pos_produkt_id', 'P1', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Hranolky', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 6200, 'cena_celkem_haleru', 6200,
    'zdroj', 'rucne', 'druh', 'kusove_zbozi', 'pos_produkt_id', 'H1', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as verze_zb \gset
select public.jine_platby_sestavit_vydej(:'zb')::text as vydej_b \gset
select pg_temp.check('zB: pokrm i kusové zboží, ale receptura známá a zboží v ní není → žádné varování',
  jsonb_array_length(:'vydej_b'::jsonb -> 'varovani') = 0
  and jsonb_array_length(:'vydej_b'::jsonb -> 'obsah' -> 'polozky') = 2);

-- zC: polévka (receptura neznámá) + hranolky → obecné varování jako dřív.
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Krok103 C', '10310000-aaaa-0000-0000-00000000000c') as zc \gset
select public.jine_platby_ulozit_navrh(:'zc', 1, jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '10300'), jsonb_build_array(
  jsonb_build_object('nazev', 'Polévka', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 4100, 'cena_celkem_haleru', 4100,
    'zdroj', 'rucne', 'druh', 'pokrm', 'pos_produkt_id', 'P9', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Hranolky', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 6200, 'cena_celkem_haleru', 6200,
    'zdroj', 'rucne', 'druh', 'kusove_zbozi', 'pos_produkt_id', 'H1', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as verze_zc \gset
select public.jine_platby_sestavit_vydej(:'zc')::text as vydej_c \gset
select pg_temp.check('zC: receptura pokrmu neznámá → obecné varování „pokrm i kusové zboží“ (jako před 25. 10.)',
  jsonb_array_length(:'vydej_c'::jsonb -> 'varovani') = 1
  and (:'vydej_c'::jsonb -> 'varovani' ->> 0) like 'Výdej obsahuje pokrm i kusové zboží.%');

-- zD: koktejl + rum (rozlévaný nápoj je surovinou koktejlu) → konkrétní varování i bez kusového zboží.
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Krok103 D', '10310000-aaaa-0000-0000-00000000000d') as zd \gset
select public.jine_platby_ulozit_navrh(:'zd', 1, jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '30400'), jsonb_build_array(
  jsonb_build_object('nazev', 'Koktejl', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 12000, 'cena_celkem_haleru', 24000,
    'zdroj', 'rucne', 'druh', 'pokrm', 'pos_produkt_id', 'P2', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Rum panák', 'mnozstvi', '0.04', 'jednotka', 'l', 'cena_jednotkova_haleru', 160000, 'cena_celkem_haleru', 6400,
    'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'R1', 'pos_mnozstvi', '0.04', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as verze_zd \gset
select public.jine_platby_sestavit_vydej(:'zd')::text as vydej_d \gset
select pg_temp.check('zD: rozlévaný nápoj, který je surovinou pokrmu ve stejném výdeji → konkrétní varování (dřív žádné)',
  jsonb_array_length(:'vydej_d'::jsonb -> 'varovani') = 1
  and (:'vydej_d'::jsonb -> 'varovani' ->> 0) like '„Rum“ je surovinou „Koktejl Perla“%');
reset role;
select set_config('test.user_id', '', false);

-- Otisk nezávisí na recepturách: jiná receptura svíčkové (bez smetany) otisk zA nezmění.
-- (Svíčková BEZ receptury a bez odečtu by z výdeje vypadla — to je jiný případ, viz app.jp_sestavit_vydej.)
update public.pos_katalog set suroviny = jsonb_build_array(jsonb_build_object('produkt', 'M1', 'mnozstvi', null, 'jednotka', 'Kilogram'))
 where pripojeni_id = :'pos' and externi_id = 'P1';
select app.jp_sestavit_vydej(:'za') ->> 'otisk' as otisk_a_bez \gset
select pg_temp.check('otisk výdeje na recepturách nezávisí (receptura svíčkové bez smetany: stejný otisk, varování zmizí)',
  :'otisk_a_bez' = :'vydej_a'::jsonb ->> 'otisk'
  and jsonb_array_length(app.jp_sestavit_vydej(:'za') -> 'varovani') = 0);
update public.pos_katalog set suroviny = jsonb_build_array(jsonb_build_object('produkt', 'S1', 'mnozstvi', '0.1', 'jednotka', 'Liter')), ma_recepturu = true
 where pripojeni_id = :'pos' and externi_id = 'P1';

-- Schválení zA s konkrétním varováním chce p_bez_surovin (beze změny v rozhodnout_vydej).
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_oznacit_zkontrolovano(:'za', :'verze_za');
select public.jine_platby_odeslat_sklad(:'za', :'verze_za') as navrh_a \gset
select otisk as otisk_a from public.jine_platby_skladove_navrhy where id = :'navrh_a' \gset
select public.jine_platby_prohlasit(:'za', :'verze_za', 'sklad', 'neodecteno', 'Ověřeno v pokladně: nic neodečteno.');
select pg_temp.check('zA: schválení s konkrétním varováním bez p_bez_surovin neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, null, false)', :'navrh_a', :'otisk_a'),
    '23514', 'potvrďte'));
select public.jine_platby_rozhodnout_vydej(:'navrh_a', :'otisk_a', true, null, true) as op_a \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zA: s p_bez_surovin schváleno, operace s uloženou provozovnou 11, historie má potvrzení',
  (select stav = 'pripraveno' and externi_provozovna = '11' from public.pos_operace where id = :'op_a')
  and exists (select 1 from public.jine_platby_historie where zaznam_id = :'za' and udalost = 'vydej_schvalen' and detail ->> 'bez_surovin_potvrzeno' = 'true'));


\echo ''
\echo '== 4. Provozovna požadavku při zabrání ==========================='

-- zA (pokladna firmy): provozovnu 11 přeřadí v Integracích na Bar → zabrání neodešle nic.
update public.integrace_pripojeni
   set externi_ucet = jsonb_set(externi_ucet, '{provozovny,0,branch_id}', to_jsonb(:'bar'::text))
 where id = :'pos';
set role service_role;
select public.pos_operace_zahajit(:'op_a', now() + interval '5 minutes')::text as zah_a1 \gset
reset role;
select pg_temp.check('uložená provozovna přeřazená jiné pobočce → zabrání „nelze“, operace zůstává připravená, nic neodešlo',
  :'zah_a1'::jsonb ->> 'stav' = 'nelze' and (:'zah_a1'::jsonb ->> 'duvod') like '%právě jednu provozovnu%'
  and (select stav = 'pripraveno' and pokusu = 0 from public.pos_operace where id = :'op_a'));
update public.integrace_pripojeni
   set externi_ucet = jsonb_set(externi_ucet, '{provozovny,0,branch_id}', to_jsonb(:'perla'::text))
 where id = :'pos';
set role service_role;
select public.pos_operace_zahajit(:'op_a', now() + interval '5 minutes')::text as zah_a2 \gset
reset role;
select pg_temp.check('po vrácení přiřazení zabrání projde: odesílá se do provozovny 11 a historie ji nese',
  :'zah_a2'::jsonb ->> 'stav' = 'ok' and :'zah_a2'::jsonb -> 'operace' ->> 'externiProvozovna' = '11'
  and (select stav = 'odesila_se' and externi_provozovna = '11' from public.pos_operace where id = :'op_a')
  and exists (select 1 from public.jine_platby_historie where zaznam_id = :'za' and udalost = 'vydej_odesila_se' and detail ->> 'provozovna' = '11'));

-- zE (pokladna POBOČKY): záznam provozovnu nenese, doplní ji zabrání.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos_pob', 'Krok103 E', '10310000-aaaa-0000-0000-00000000000e') as ze \gset
select public.jine_platby_ulozit_navrh(:'ze', 1, jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '13500'), jsonb_build_array(
  jsonb_build_object('nazev', 'Pivo', 'mnozstvi', '3', 'jednotka', 'ks', 'cena_jednotkova_haleru', 4500, 'cena_celkem_haleru', 13500,
    'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'X1', 'pos_mnozstvi', '3', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as verze_ze \gset
select public.jine_platby_oznacit_zkontrolovano(:'ze', :'verze_ze');
select public.jine_platby_odeslat_sklad(:'ze', :'verze_ze') as navrh_e \gset
select otisk as otisk_e from public.jine_platby_skladove_navrhy where id = :'navrh_e' \gset
select public.jine_platby_prohlasit(:'ze', :'verze_ze', 'sklad', 'neodecteno', 'Ověřeno v pokladně: nic neodečteno.');
select public.jine_platby_rozhodnout_vydej(:'navrh_e', :'otisk_e', true) as op_e \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zE: záznam pokladny pobočky provozovnu nenese a operace po schválení taky ne',
  (select pos_provozovna is null from public.jine_platby where id = :'ze')
  and (select externi_provozovna is null and stav = 'pripraveno' from public.pos_operace where id = :'op_e'));

-- Dvě provozovny přiřazené pobočce → nejde vybrat, neodešle se.
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(
     jsonb_build_object('id', '31', 'nazev', 'Perla výčep', 'branch_id', :'perla'),
     jsonb_build_object('id', '32', 'nazev', 'Perla terasa', 'branch_id', :'perla')))
 where id = :'pos_pob';
set role service_role;
select public.pos_operace_zahajit(:'op_e', now() + interval '5 minutes')::text as zah_e1 \gset
reset role;
select pg_temp.check('pokladna pobočky se dvěma provozovnami pro pobočku → zabrání „nelze“, nic neodešlo',
  :'zah_e1'::jsonb ->> 'stav' = 'nelze' and (select stav = 'pripraveno' and externi_provozovna is null from public.pos_operace where id = :'op_e'));
-- Žádná provozovna pro pobočku → taky ne.
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '31', 'nazev', 'Perla výčep', 'branch_id', null)))
 where id = :'pos_pob';
set role service_role;
select public.pos_operace_zahajit(:'op_e', now() + interval '5 minutes')::text as zah_e0 \gset
reset role;
select pg_temp.check('pokladna pobočky bez přiřazené provozovny → zabrání „nelze“',
  :'zah_e0'::jsonb ->> 'stav' = 'nelze' and (select stav = 'pripraveno' from public.pos_operace where id = :'op_e'));
-- Jedna provozovna → zabrání ji doplní do operace.
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(
     jsonb_build_object('id', '31', 'nazev', 'Perla výčep', 'branch_id', :'perla'),
     jsonb_build_object('id', '35', 'nazev', 'Bar jinde', 'branch_id', :'bar')))
 where id = :'pos_pob';
set role service_role;
select public.pos_operace_zahajit(:'op_e', now() + interval '5 minutes')::text as zah_e2 \gset
reset role;
select pg_temp.check('jediná provozovna pobočky (31) → zabrání ji doplní a vrátí orchestrátoru',
  :'zah_e2'::jsonb ->> 'stav' = 'ok' and :'zah_e2'::jsonb -> 'operace' ->> 'externiProvozovna' = '31'
  and (select externi_provozovna = '31' and stav = 'odesila_se' from public.pos_operace where id = :'op_e'));

-- Nový pokus po prokázané chybě nese provozovnu 31; přiřazení se mezitím změní na 33 → neodešle se.
set role service_role;
select public.pos_operace_dokoncit(:'op_e', 'chyba', null, null, null, 'Pokladna požadavek prokazatelně neprovedla (test).');
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_vydej_znovu(:'ze') as op_e2 \gset
reset role;
select set_config('test.user_id', '', false);
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '33', 'nazev', 'Perla nová', 'branch_id', :'perla')))
 where id = :'pos_pob';
set role service_role;
select public.pos_operace_zahajit(:'op_e2', now() + interval '5 minutes')::text as zah_e3 \gset
reset role;
select pg_temp.check('nový pokus s provozovnou 31, přiřazení teď dává 33 → zabrání „nelze“ (provozovna se změnila)',
  (select externi_provozovna = '31' from public.pos_operace where id = :'op_e2')
  and :'zah_e3'::jsonb ->> 'stav' = 'nelze' and (:'zah_e3'::jsonb ->> 'duvod') like '%se od schválení výdeje změnila%');

-- Filtry app.jp_provozovna_vydeje: firma a odpojení (každý zvlášť).
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '31', 'nazev', 'Perla výčep', 'branch_id', :'perla')))
 where id = :'pos_pob';
select pg_temp.check('provozovna záznamu E (kontrola, že funkce vrací hodnotu): 31',
  (select app.jp_provozovna_vydeje(z) = '31' from public.jine_platby z where id = :'ze'));
select pg_temp.check('záznam s firmou, které pokladna nepatří → žádná provozovna (filtr firmy)',
  (select app.jp_provozovna_vydeje(jsonb_populate_record(z, jsonb_build_object('tenant_id', :'tenant_b'))) is null
     from public.jine_platby z where id = :'ze'));
select pg_temp.check('záznam jiné pobočky u pokladny Perly → žádná (pokladna pobočky obsluhuje jen svou pobočku)',
  (select app.jp_provozovna_vydeje(jsonb_populate_record(z, jsonb_build_object('branch_id', :'bar'))) is null
     from public.jine_platby z where id = :'ze'));
update public.integrace_pripojeni set odpojeno_kdy = now() where id = :'pos_pob';
select pg_temp.check('odpojená pokladna → žádná provozovna (filtr odpojení)',
  (select app.jp_provozovna_vydeje(z) is null from public.jine_platby z where id = :'ze'));
update public.integrace_pripojeni set odpojeno_kdy = null where id = :'pos_pob';
select pg_temp.check('pokladna firmy: záznam A s provozovnou 11 → 11; s neznámou provozovnou → žádná',
  (select app.jp_provozovna_vydeje(z) = '11' from public.jine_platby z where id = :'za')
  and (select app.jp_provozovna_vydeje(jsonb_populate_record(z, jsonb_build_object('pos_provozovna', '99'))) is null
         from public.jine_platby z where id = :'za'));


\echo ''
\echo '== 5. Pokusy o přiřazení přes AI ================================='

set role service_role;
select pg_temp.check('stará verze → 40001, nic nezapsáno',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 1)', :'zb', :'majitel', :'verze_zb'::int + 5),
    '40001', 'mezitím upravil')
  and not exists (select 1 from public.jine_platby_ai_parovani where zaznam_id = :'zb'));
select pg_temp.check('0 položek i 201 položek odmítnuto',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 0)', :'zb', :'majitel', :'verze_zb'), '23514', '1 až 200')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 201)', :'zb', :'majitel', :'verze_zb'), '23514', '1 až 200'));
select pg_temp.check('schválený výdej (zA) → přiřazení se nezahájí (položky skladu jsou zamčené)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 1)', :'za',
    :'majitel', (select verze from public.jine_platby where id = :'za')), '23514', 'schválený nebo provedený'));
select public.jine_platby_zahajit_parovani(:'zb', :'majitel', :'verze_zb', 2) as pokus1 \gset
select pg_temp.check('běžící pokus: druhý se nezahájí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 2)', :'zb', :'majitel', :'verze_zb'), '23514', 'už běží'));
select pg_temp.check('dokončení s neznámým výsledkem a s víc návrhy než položkami neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_dokoncit_parovani(%L, %L, null, null, null, null)', :'pokus1', 'hotovo'), '23514', 'Neznámý výsledek')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_dokoncit_parovani(%L, %L, %L, %L, 3, null)', :'pokus1', 'ok', 'claude-opus-5-5', 'v1'), '23514', 'mimo rozsah'));
select public.jine_platby_dokoncit_parovani(:'pokus1', 'ok', 'claude-opus-5-5', 'jine-platby-parovani-v1', 1, null);
select pg_temp.check('dokončený pokus: ok, 1 návrh, model a verze; historie „prirazeni_ai“ se spouštějícím',
  (select stav = 'ok' and navrzeno = 1 and polozek = 2 and model = 'claude-opus-5-5' and dokonceno is not null and spustil::text = :'majitel'
     from public.jine_platby_ai_parovani where id = :'pokus1')
  and exists (select 1 from public.jine_platby_historie where zaznam_id = :'zb' and udalost = 'prirazeni_ai' and kdo::text = :'majitel'
                and detail ->> 'stav' = 'ok' and detail ->> 'navrzeno' = '1'));
select pg_temp.check('dokončený pokus podruhé dokončit nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_dokoncit_parovani(%L, %L, null, null, null, %L)', :'pokus1', 'chyba', 'x'), '23514', 'neběží'));
select public.jine_platby_zahajit_parovani(:'zb', :'majitel', :'verze_zb', 1) as pokus2 \gset
select public.jine_platby_dokoncit_parovani(:'pokus2', 'chyba', null, 'jine-platby-parovani-v1', null, 'AI má výpadek (test).');
select pg_temp.check('chyba se zapíše s důvodem a bez počtu návrhů',
  (select stav = 'chyba' and navrzeno is null and duvod like 'AI má výpadek%' from public.jine_platby_ai_parovani where id = :'pokus2'));

-- Strop 10 na záznam: 2 pokusy už jsou, dalších 8 projde, jedenáctý ne.
select set_config('test.zb', :'zb', false);
do $$
declare v_id uuid; v_z uuid := current_setting('test.zb')::uuid; v_ver integer;
begin
  select verze into v_ver from public.jine_platby where id = v_z;
  for i in 1..8 loop
    v_id := public.jine_platby_zahajit_parovani(v_z, null, v_ver, 1);
    perform public.jine_platby_dokoncit_parovani(v_id, 'bez_klice', null, null, null, 'Chybí klíč k AI.');
  end loop;
end $$;
select pg_temp.check('strop na záznam: 10 pokusů za den, jedenáctý odmítnut',
  (select count(*) = 10 from public.jine_platby_ai_parovani where zaznam_id = :'zb')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 1)', :'zb', :'majitel', :'verze_zb'),
    '23514', 'u tohohle dokladu (10)'));
reset role;

-- Strop 100 na firmu: doplní se staré pokusy jiného záznamu (zD) do 100 za dnešek, pak zC neprojde.
insert into public.jine_platby_ai_parovani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav, polozek, vytvoreno, dokonceno)
select :'tenant', :'perla', :'zd', 1, 'ok', 1, now(), now()
  from generate_series(1, greatest(0, 100 - (select count(*)::int from public.jine_platby_ai_parovani
                                                where tenant_id = :'tenant'
                                                  and vytvoreno >= (date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague'))));
set role service_role;
select pg_temp.check('strop na firmu: 100 pokusů za den, další (jiný záznam) odmítnut',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_parovani(%L, %L, %s, 1)', :'zc', :'majitel', :'verze_zc'),
    '23514', '100 za firmu'));
reset role;
-- Úklid stropu firmy (ať neovlivní další scénáře): pokusy zD a zB.
delete from public.jine_platby_ai_parovani where zaznam_id in (:'zd', :'zb');
set role service_role;
select public.jine_platby_zahajit_parovani(:'zc', :'majitel', :'verze_zc', 1) as pokus_c \gset
reset role;
select pg_temp.check('po úklidu (pod stropem) se pokus zahájí',
  (select stav = 'bezi' from public.jine_platby_ai_parovani where id = :'pokus_c'));

\echo ''
\echo '== KROK 103 HOTOV =============================================='
