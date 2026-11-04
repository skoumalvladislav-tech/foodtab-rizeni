-- Scénář pro krok 109 — Rezervace: stoly a číslo rezervace ze zdroje.
--
-- Pokrývá migraci 20261107100000_rezervace_misto_zdroje.sql (sloupce
-- rezervace.misto_zdroje a cislo_zdroje, nové klíče řádku
-- v app.rezervace_zapsat_radky).
--
-- Zadání Šéfíka 4. 11. 2026: z Choice se nenačítá „umístění a obsazení
-- stolů“ (rezervace #105: Patro, S1–S12). Appka id stolů převede na
-- text (lib/rezervace-choice.ts, `mistoZChoice`) a pošle ho v řádku.
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab, Perla, majitel).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. sloupce: výchozí '', délka hlídaná databází (300 / 40 znaků),
--      čtení pro authenticated, zápis ne — ani přímo, ani funkcí app.*;
--   2. nová rezervace ze zdroje: stoly i číslo se uloží (a dlouhý text
--      se zkrátí, ne odmítne — jedna divná rezervace nesmí shodit
--      dávku); zápis STEJNOU cestou jako server (rezervace_importovat_
--      zdroj, service_role) — obalová funkce klíče nezahodí;
--   3. další načtení: změna stolů = „změněná“; stejné stoly = „beze
--      změny“; klíč CHYBÍ (seznam stolů se nenačetl) = uložené zůstanou
--      a nic se nepočítá jako změna; prázdný text = smazat; null = smazat;
--      číslo jako JSON číslo projde jako text;
--   4. prostor („Stůl nebo prostor“) dál patří Foodtabu: zdroj ho jen
--      doplní, stoly ze zdroje ho nepřepíšou a naopak;
--   5. soubor (CSV) — klíče se od něj NEČTOU: nová rezervace bez stolů,
--      už načtená z Choice si stoly nechá;
--   6. ruční uložení (rezervace_ulozit) stoly ani číslo nezmění.
--
-- Data rezervací jsou v roce 2099 (spoušť upozornění minulý den nehlásí).
--
-- POZOR, SDÍLENÁ DATABÁZE: kontroly se ptají jen na rezervace tohohle
-- scénáře (poskytovatel krok109-*), nikdy na celkové počty.
--
-- PGlite běží jako superuživatel: „authenticated nesmí“ se tu ověřuje
-- katalogem (has_*_privilege), skutečné odmítnutí hlídá workflow
-- Databáze proti PostgreSQL.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
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

-- Zápis jako appka, ale chyba se vrátí jako {"chyba": …}: kontrola pak
-- spadne SVÝM jménem, ne výjimkou, která by schovala zbytek scénáře.
create or replace function pg_temp.zapsat(p_tenant uuid, p_branch uuid, p_zdroj text, p_posk text, p_prip uuid, p_radky jsonb)
returns jsonb language plpgsql as $$
begin
  return app.rezervace_zapsat_radky(p_tenant, p_branch, p_zdroj, p_posk, p_prip, p_radky);
exception when others then
  raise notice '  (zápis spadl: % %)', sqlstate, sqlerrm;
  return jsonb_build_object('chyba', sqlstate || ' ' || sqlerrm);
end $$;

-- Stoly, číslo a prostor rezervace jako jeden text „stoly|číslo|prostor“
-- ('chybí', když rezervace není) — jedna kontrola pak vypíše všechno.
create or replace function pg_temp.udaje(p_posk text, p_ext text)
returns text language sql as $$
  select coalesce((select r.misto_zdroje || '|' || r.cislo_zdroje || '|' || r.prostor
                     from public.rezervace r
                    where r.poskytovatel = p_posk and r.externi_id = p_ext), 'chybí')
$$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'krok109-choice', 'zakaznicky', 'Choice Krok109')
returning id as choice \gset
update public.integrace_pripojeni
   set stav = 'pripojeno', posledni_test_ok = true, posledni_test_kdy = now()
 where id = :'choice';


\echo ''
\echo '== 1. Sloupce a práva ===================================='

select pg_temp.check('sloupce misto_zdroje a cislo_zdroje: text, povinné, výchozí prázdné',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rezervace'
      and column_name in ('misto_zdroje', 'cislo_zdroje')
      and data_type = 'text' and is_nullable = 'NO' and column_default = '''''::text') = 2);

select pg_temp.check('authenticated stoly a číslo ČTE (kalendář je ukazuje), zapsat ani vložit je nesmí',
  has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'SELECT')
  and has_column_privilege('authenticated', 'public.rezervace', 'cislo_zdroje', 'SELECT')
  and not has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'cislo_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'INSERT')
  and not has_column_privilege('anon', 'public.rezervace', 'misto_zdroje', 'SELECT'));

select pg_temp.check('app.rezervace_zapsat_radky nevolá nikdo zvenku (anon, authenticated, public); jen přes obalové funkce',
  not has_function_privilege('authenticated', 'app.rezervace_zapsat_radky(uuid, uuid, text, text, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.rezervace_zapsat_radky(uuid, uuid, text, text, uuid, jsonb)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'app.rezervace_zapsat_radky(uuid, uuid, text, text, uuid, jsonb)'::regprocedure
                     and a.grantee = 0 and a.privilege_type = 'EXECUTE'));

select pg_temp.check('zápis ze zdroje dál jen service_role, soubor jen přihlášený (granty obalových funkcí beze změny)',
  has_function_privilege('service_role', 'public.rezervace_importovat_zdroj(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_importovat_zdroj(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.rezervace_importovat_csv(uuid, uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_importovat_csv(uuid, uuid, text, jsonb)', 'execute'));


\echo ''
\echo '== 2. Nová rezervace ze zdroje ==========================='

-- Tvar řádku přesně podle radekZChoice (lib/rezervace-choice.ts):
-- #105 ze snímku Šéfíka — Patro, S1–S12, 2 osoby.
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","misto_zdroje":"Patro: S1–S12","cislo_zdroje":"105"},{"externi_id":"krok109-106","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T19:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","telefon":"","email":"","poznamka":"","prostor":""}]' as davka1 \gset

set role service_role;
select public.rezervace_importovat_zdroj(:'choice', :'davka1'::jsonb)::text as imp1 \gset
reset role;

select pg_temp.check(format('stejnou cestou jako server (rezervace_importovat_zdroj): #105 má stoly i číslo, prostor z přání hosta (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp1'::jsonb ->> 'nove')::int = 2
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Patro: S1–S12|105|Patro');
select pg_temp.check('rezervace bez klíčů (zdroj stoly nepřidělil) má prázdné stoly i číslo',
  pg_temp.udaje('krok109-choice', 'krok109-106') = '||');

-- Dlouhý text a mezery okolo: zkrátí se, dávka nespadne.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_build_array(jsonb_build_object(
    'externi_id', 'krok109-dlouhy', 'zacatek', '2099-11-27T20:00:00.000Z', 'jmeno_hosta', 'Dlouhý Krok109',
    'pocet_osob', '2', 'misto_zdroje', '  ' || repeat('S', 400) || '  ', 'cislo_zdroje', repeat('9', 60))))::text as imp_dlouhy \gset
select pg_temp.check('dlouhé stoly (400 znaků) a číslo (60) se zkrátí na 300 a 40 a ořežou se mezery — dávka nespadne',
  (:'imp_dlouhy'::jsonb ->> 'nove')::int = 1
  and (select char_length(misto_zdroje) = 300 and misto_zdroje = repeat('S', 300) and cislo_zdroje = repeat('9', 40)
         from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-dlouhy'));

select pg_temp.check('délku hlídá i databáze: 301 znaků stolů přímým zápisem neprojde',
  pg_temp.spadne_hlaskou(format($q$update public.rezervace set misto_zdroje = repeat('x', 301) where poskytovatel = 'krok109-choice' and externi_id = %L$q$, 'krok109-105'),
    '23514', 'rezervace_misto_zdroje_check'));
select pg_temp.check('… a 41 znaků čísla taky ne',
  pg_temp.spadne_hlaskou(format($q$update public.rezervace set cislo_zdroje = repeat('1', 41) where poskytovatel = 'krok109-choice' and externi_id = %L$q$, 'krok109-105'),
    '23514', 'rezervace_cislo_zdroje_check'));


\echo ''
\echo '== 3. Další načtení ======================================'

-- V Choice přesadili hosta: Terasa, L7 a L8.
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","misto_zdroje":"Terasa: L7, L8","cislo_zdroje":"105"}]' as presazeni \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'presazeni'::jsonb)::text as imp2 \gset
select pg_temp.check(format('změna stolů v Choice: „změněná“, nové stoly, prostor Foodtabu zůstal (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp2'::jsonb ->> 'zmenene')::int = 1 and (:'imp2'::jsonb ->> 'beze_zmeny')::int = 0
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L7, L8|105|Patro');

select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'presazeni'::jsonb)::text as imp3 \gset
select pg_temp.check('totéž podruhé: „beze změny“ (čas načtení ani nic jiného se nepřepisuje)',
  (:'imp3'::jsonb ->> 'beze_zmeny')::int = 1 and (:'imp3'::jsonb ->> 'zmenene')::int = 0);

-- Seznam stolů se v Choice nenačetl: appka klíče nepošle.
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro"}]' as bez_klicu \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'bez_klicu'::jsonb)::text as imp4 \gset
select pg_temp.check(format('klíč chybí (stoly se nenačetly): uložené stoly i číslo zůstanou a není to změna (%s, %s)', :'imp4', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp4'::jsonb ->> 'beze_zmeny')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L7, L8|105|Patro');

-- Bez klíčů, ale se změnou počtu osob: změna se zapíše, stoly zůstanou.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(:'bez_klicu'::jsonb, '{0,pocet_osob}', '"3"'))::text as imp5 \gset
select pg_temp.check(format('klíč chybí a změnil se počet osob: změna projde, stoly zůstanou (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp5'::jsonb ->> 'zmenene')::int = 1
  and (select pocet_osob from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-105') = 3
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L7, L8|105|Patro');

-- V Choice host stoly ztratil (prázdný seznam) — appka pošle ''.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(jsonb_set(:'bez_klicu'::jsonb, '{0,pocet_osob}', '"3"'), '{0,misto_zdroje}', '""'))::text as imp6 \gset
select pg_temp.check(format('prázdný text = žádné stoly: uložené se smažou, číslo (klíč chybí) zůstane (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp6'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-105') = '|105|Patro');

select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-106","zacatek":"2099-11-27T19:00:00.000Z","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","misto_zdroje":"Bar: 1","cislo_zdroje":106}]'::jsonb)::text as imp7 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-106","zacatek":"2099-11-27T19:00:00.000Z","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","misto_zdroje":null,"cislo_zdroje":106}]'::jsonb)::text as imp8 \gset
select pg_temp.check(format('číslo jako JSON číslo se uloží jako text; null ve stolech = smazat (%s → %s)', :'imp7', pg_temp.udaje('krok109-choice', 'krok109-106')),
  (:'imp7'::jsonb ->> 'zmenene')::int = 1 and (:'imp8'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-106') = '|106|');

-- Rezervace načtená před db push (bez klíčů, bez stolů); po něm přijde
-- totéž, jen s číslem a prázdnými stoly. Změnilo se JEN číslo — i to je
-- změna, jinak by se „(Choice, č. 108)“ u ní neukázalo nikdy.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-108","zacatek":"2099-11-27T21:00:00.000Z","jmeno_hosta":"Jen číslo Krok109","pocet_osob":"2"}]'::jsonb)::text as imp_c1 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-108","zacatek":"2099-11-27T21:00:00.000Z","jmeno_hosta":"Jen číslo Krok109","pocet_osob":"2","misto_zdroje":"","cislo_zdroje":"108"}]'::jsonb)::text as imp_c2 \gset
select pg_temp.check(format('změní-li se JEN číslo rezervace (stoly prázdné jako dřív), je to „změněná“ a číslo se zapíše (%s → %s)', :'imp_c2', pg_temp.udaje('krok109-choice', 'krok109-108')),
  (:'imp_c1'::jsonb ->> 'nove')::int = 1
  and (:'imp_c2'::jsonb ->> 'zmenene')::int = 1 and (:'imp_c2'::jsonb ->> 'beze_zmeny')::int = 0
  and pg_temp.udaje('krok109-choice', 'krok109-108') = '|108|');


\echo ''
\echo '== 4. Prostor patří Foodtabu ============================='

-- Obsluha v detailu napsala „u okna“ (přímo — jako po rezervace_ulozit).
update public.rezervace set prostor = 'u okna' where poskytovatel = 'krok109-choice' and externi_id = 'krok109-105';
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(jsonb_set(jsonb_set(:'bez_klicu'::jsonb, '{0,pocet_osob}', '"3"'), '{0,misto_zdroje}', '"Terasa: L9"'), '{0,prostor}', '"Terasa"'))::text as imp9 \gset
select pg_temp.check(format('stoly ze zdroje se přepíšou, „u okna“ od obsluhy zůstane — ani přání hosta „Terasa“ ho nepřepíše (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  (:'imp9'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|u okna');
select pg_temp.check('prázdný prostor zdroj doplní (rezervace bez prostoru dostane „Bar“), stoly mu nevadí',
  (select (pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
     '[{"externi_id":"krok109-106","zacatek":"2099-11-27T19:00:00.000Z","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","prostor":"Bar","misto_zdroje":"Bar: 1–3"}]'::jsonb) ->> 'zmenene')::int) = 1
  and pg_temp.udaje('krok109-choice', 'krok109-106') = 'Bar: 1–3|106|Bar');


\echo ''
\echo '== 5. Soubor (CSV) klíče nečte ==========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
-- Nová rezervace ze souboru se „stoly“ a číslem: klíče se nečtou.
select public.rezervace_importovat_csv(:'tenant', :'perla', 'krok109-csv',
  '[{"externi_id":"krok109-csv1","zacatek":"2099-11-28T18:00:00+01:00","jmeno_hosta":"Soubor Krok109","pocet_osob":"2","prostor":"Salonek","misto_zdroje":"Patro: S1–S12","cislo_zdroje":"666"}]'::jsonb)::text as csv1 \gset
-- Soubor se stejným poskytovatelem jako Choice (páruje se na rezervaci
-- z Choice): stoly z Choice soubor nesmaže ani nepřepíše.
select public.rezervace_importovat_csv(:'tenant', :'perla', 'krok109-choice',
  '[{"externi_id":"krok109-105","zacatek":"2099-11-27T18:00:00.000Z","jmeno_hosta":"Patro Krok109","pocet_osob":"3","misto_zdroje":"","cislo_zdroje":"666"}]'::jsonb)::text as csv2 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check(format('soubor: nová rezervace bez stolů a čísla, i když je soubor posílal (%s)', pg_temp.udaje('krok109-csv', 'krok109-csv1')),
  (:'csv1'::jsonb ->> 'nove')::int = 1
  and pg_temp.udaje('krok109-csv', 'krok109-csv1') = '||Salonek');
select pg_temp.check(format('soubor nad rezervací z Choice: stoly a číslo z Choice zůstanou (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|u okna');


\echo ''
\echo '== 6. Ruční uložení stoly nemění ========================='

select id as r105 from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-105' \gset
-- Soubor výše přepnul zdroj na „csv“; zpátky na Choice, ať ruční uložení
-- jde po rezervaci z rezervačního systému.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(:'bez_klicu'::jsonb, '{0,pocet_osob}', '"3"'))::text as imp10 \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.rezervace_ulozit(:'tenant', :'r105', :'perla',
  '{"prostor":"zahrádka","menu":"Krok109 menu","misto_zdroje":"Ručně: X","cislo_zdroje":"1"}'::jsonb) as ulozeno \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check(format('ruční uložení změní prostor a menu, stoly ani číslo ze zdroje ne (%s)', pg_temp.udaje('krok109-choice', 'krok109-105')),
  :'ulozeno' = :'r105'
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|zahrádka'
  and (select menu from public.rezervace where id = :'r105') = 'Krok109 menu');


\echo ''
\echo '== Úklid ================================================='

delete from public.notifikace_doruceni
 where notification_id in (select n.id from public.notifications n
                            where n.zdroj_typ = 'rezervace'
                              and n.zdroj_id in (select id from public.rezervace where poskytovatel like 'krok109-%'));
delete from public.notifications
 where zdroj_typ = 'rezervace'
   and zdroj_id in (select id from public.rezervace where poskytovatel like 'krok109-%');
delete from public.rezervace where poskytovatel like 'krok109-%';
delete from public.integrace_pripojeni where id = :'choice';

select pg_temp.check('úklid: rezervace a připojení kroku 109 pryč',
  not exists (select 1 from public.rezervace where poskytovatel like 'krok109-%')
  and not exists (select 1 from public.integrace_pripojeni where poskytovatel like 'krok109-%'));

\echo ''
\echo '== KROK 109 HOTOV ========================================'
