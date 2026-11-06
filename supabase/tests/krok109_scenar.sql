-- Scénář pro krok 109 — Rezervace: stoly a číslo rezervace ze zdroje.
--
-- Pokrývá migraci 20261107100000_rezervace_misto_zdroje.sql (sloupce
-- rezervace.misto_zdroje, cislo_zdroje a prani_zdroje, nové klíče řádku
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
--   6. ruční uložení (rezervace_ulozit) stoly ani číslo nezmění;
--   7. přání hosta (prani_zdroje, Choice preferArea): appka ho posílá
--      zvlášť a zároveň jako prostor (radekZChoice, 3. kolo kontroly
--      kódu: i u rezervace se stoly); přání se uloží, jeho změna je
--      „změněná“, chybějící klíč nechá uložené, prázdné a null smažou,
--      délku hlídá funkce i databáze (120); soubor ani ruční uložení ho
--      nemění;
--   8. kdo napsal prostor (prostor_ze_zdroje, 3. kolo): zdroj, který do
--      prázdného prostoru doplní přání hosta → true; bez přání, jiný
--      text, soubor, ruční zápis → false; spoušť příznak shodí, kdykoli
--      prostor změní kdokoli jiný (rezervace_ulozit i přímý zápis),
--      stejný text ho nechá; řádek bez příznaku (null, před migrací)
--      zůstane null, dokud prostor nezmění obsluha nebo ho nedoplní zdroj;
--      true bez prostoru databáze nepustí;
--   9. akce: změna stolů ani přání ze zdroje upozornění NEPOŠLE — prostor
--      se nemění; kontrola naproti: změna prostoru obsluhou ho pošle.
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

-- Přání hosta ('chybí', když rezervace není).
create or replace function pg_temp.prani(p_posk text, p_ext text)
returns text language sql as $$
  select coalesce((select r.prani_zdroje from public.rezervace r
                    where r.poskytovatel = p_posk and r.externi_id = p_ext), 'chybí')
$$;

-- Kdo napsal prostor jako text: 'true' | 'false' | 'null' ('chybí', když
-- rezervace není) — null se tak nedá splést s „rezervace není“.
create or replace function pg_temp.priznak(p_posk text, p_ext text)
returns text language sql as $$
  select coalesce((select coalesce(r.prostor_ze_zdroje::text, 'null') from public.rezervace r
                    where r.poskytovatel = p_posk and r.externi_id = p_ext), 'chybí')
$$;

-- Kolik upozornění (jakéhokoli druhu) má rezervace — kdokoli je dostal.
create or replace function pg_temp.upozorneni(p_posk text, p_ext text)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.zdroj_typ = 'rezervace'
     and n.zdroj_id = (select r.id from public.rezervace r where r.poskytovatel = p_posk and r.externi_id = p_ext)
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

select pg_temp.check('sloupce misto_zdroje, cislo_zdroje a prani_zdroje: text, povinné, výchozí prázdné',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rezervace'
      and column_name in ('misto_zdroje', 'cislo_zdroje', 'prani_zdroje')
      and data_type = 'text' and is_nullable = 'NO' and column_default = '''''::text') = 3);

select pg_temp.check('authenticated stoly, číslo a přání ČTE (kalendář je ukazuje), zapsat ani vložit je nesmí',
  has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'SELECT')
  and has_column_privilege('authenticated', 'public.rezervace', 'cislo_zdroje', 'SELECT')
  and has_column_privilege('authenticated', 'public.rezervace', 'prani_zdroje', 'SELECT')
  and not has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'cislo_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'prani_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'misto_zdroje', 'INSERT')
  and not has_column_privilege('authenticated', 'public.rezervace', 'prani_zdroje', 'INSERT')
  and not has_column_privilege('anon', 'public.rezervace', 'misto_zdroje', 'SELECT')
  and not has_column_privilege('anon', 'public.rezervace', 'prani_zdroje', 'SELECT'));

select pg_temp.check('sloupec prostor_ze_zdroje: boolean, smí být null (řádky před migrací), nové řádky výchozí false',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rezervace' and column_name = 'prostor_ze_zdroje'
      and data_type = 'boolean' and is_nullable = 'YES' and column_default = 'false') = 1);

select pg_temp.check('authenticated příznak ČTE (kalendář podle něj skládá místo), zapsat ani vložit ho nesmí; anon ani číst',
  has_column_privilege('authenticated', 'public.rezervace', 'prostor_ze_zdroje', 'SELECT')
  and not has_column_privilege('authenticated', 'public.rezervace', 'prostor_ze_zdroje', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.rezervace', 'prostor_ze_zdroje', 'INSERT')
  and not has_column_privilege('anon', 'public.rezervace', 'prostor_ze_zdroje', 'SELECT'));

select pg_temp.check('spoušť trg_rezervace_prostor_od_obsluhy: před změnou řádku, její funkci nikdo zvenku nezavolá',
  exists (select 1 from pg_trigger t
           where t.tgrelid = 'public.rezervace'::regclass and t.tgname = 'trg_rezervace_prostor_od_obsluhy'
             and not t.tgisinternal and t.tgenabled = 'O'
             and t.tgfoid = 'app.rezervace_prostor_od_obsluhy()'::regprocedure
             and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 1) = 1)
  and not has_function_privilege('authenticated', 'app.rezervace_prostor_od_obsluhy()', 'execute')
  and not has_function_privilege('anon', 'app.rezervace_prostor_od_obsluhy()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'app.rezervace_prostor_od_obsluhy()'::regprocedure
                     and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  and (select p.proconfig from pg_proc p where p.oid = 'app.rezervace_prostor_od_obsluhy()'::regprocedure) = array['search_path=""']);

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
-- #105 ze snímku Šéfíka — Patro, S1–S12, 2 osoby. Host si přál „Patro“
-- (preferArea): přání jde zvlášť (prani_zdroje) a zároveň jako prostor
-- — i u rezervace se stoly (3. kolo kontroly kódu; appka podle příznaku
-- pozná, že je to přání, a vedle stolů ho neukáže). #106 bez stolů
-- a bez přání: prostor null.
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Patro: S1–S12","cislo_zdroje":"105"},{"externi_id":"krok109-106","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T19:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","telefon":"","email":"","poznamka":"","prostor":null,"prani_zdroje":""}]' as davka1 \gset

set role service_role;
select public.rezervace_importovat_zdroj(:'choice', :'davka1'::jsonb)::text as imp1 \gset
reset role;

select pg_temp.check(format('stejnou cestou jako server (rezervace_importovat_zdroj): #105 má stoly, číslo, přání hosta „Patro“ i prostor „Patro“ s příznakem „ze zdroje“ (%s, přání %s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.prani('krok109-choice', 'krok109-105'), pg_temp.priznak('krok109-choice', 'krok109-105')),
  (:'imp1'::jsonb ->> 'nove')::int = 2
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Patro: S1–S12|105|Patro'
  and pg_temp.prani('krok109-choice', 'krok109-105') = 'Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-105') = 'true');
select pg_temp.check(format('rezervace bez klíčů (zdroj stoly nepřidělil) má prázdné stoly, číslo, přání i prostor, příznak false (%s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-106'), pg_temp.priznak('krok109-choice', 'krok109-106')),
  pg_temp.udaje('krok109-choice', 'krok109-106') = '||'
  and pg_temp.prani('krok109-choice', 'krok109-106') = ''
  and pg_temp.priznak('krok109-choice', 'krok109-106') = 'false');

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
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Terasa: L7, L8","cislo_zdroje":"105"}]' as presazeni \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'presazeni'::jsonb)::text as imp2 \gset
select pg_temp.check(format('změna stolů v Choice: „změněná“, nové stoly; přání, prostor i příznak beze změny (%s, přání %s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.prani('krok109-choice', 'krok109-105'), pg_temp.priznak('krok109-choice', 'krok109-105')),
  (:'imp2'::jsonb ->> 'zmenene')::int = 1 and (:'imp2'::jsonb ->> 'beze_zmeny')::int = 0
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L7, L8|105|Patro'
  and pg_temp.prani('krok109-choice', 'krok109-105') = 'Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-105') = 'true');

select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'presazeni'::jsonb)::text as imp3 \gset
select pg_temp.check('totéž podruhé: „beze změny“ (čas načtení ani nic jiného se nepřepisuje)',
  (:'imp3'::jsonb ->> 'beze_zmeny')::int = 1 and (:'imp3'::jsonb ->> 'zmenene')::int = 0);

-- Seznam stolů se v Choice nenačetl: appka klíče stolů a čísla nepošle
-- (přání hosta je v rezervaci samé, to pošle vždycky).
select '[{"externi_id":"krok109-105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Patro Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","prani_zdroje":"Patro"}]' as bez_klicu \gset
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
select pg_temp.check(format('prázdný text = žádné stoly: uložené se smažou, číslo (klíč chybí) zůstane, prostor a příznak taky (%s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.priznak('krok109-choice', 'krok109-105')),
  (:'imp6'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-105') = '|105|Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-105') = 'true');

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
\echo '== 3b. Přání hosta (prani_zdroje) ========================'

-- Vlastní rezervace, ať se nepletou kontroly výše. Tvar jako radekZChoice:
-- přání zvlášť i jako prostor, stoly zvlášť.
select '[{"externi_id":"krok109-p1","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2099-11-27T17:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Přání Krok109","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Patro: S3","cislo_zdroje":"110"}]' as prani1 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'prani1'::jsonb)::text as imp_p1 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'prani1'::jsonb)::text as imp_p2 \gset
select pg_temp.check(format('nová rezervace: přání „Patro“ uložené i v prostoru (příznak „ze zdroje“); totéž podruhé „beze změny“ (%s, %s, přání %s, příznak %s)', :'imp_p1', :'imp_p2', pg_temp.prani('krok109-choice', 'krok109-p1'), pg_temp.priznak('krok109-choice', 'krok109-p1')),
  (:'imp_p1'::jsonb ->> 'nove')::int = 1
  and (:'imp_p2'::jsonb ->> 'beze_zmeny')::int = 1 and (:'imp_p2'::jsonb ->> 'zmenene')::int = 0
  and pg_temp.prani('krok109-choice', 'krok109-p1') = 'Patro'
  and pg_temp.udaje('krok109-choice', 'krok109-p1') = 'Patro: S3|110|Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-p1') = 'true');

-- Host v Choice změnil JEN přání (stoly stejné): i to je změna. Appka
-- pošle nové přání i jako prostor — ten už vyplněný je a zůstane.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(jsonb_set(:'prani1'::jsonb, '{0,prani_zdroje}', '"Terasa"'), '{0,prostor}', '"Terasa"'))::text as imp_p3 \gset
select pg_temp.check(format('změní-li se JEN přání hosta, je to „změněná“ a přání se přepíše; prostor „Patro“ i příznak „ze zdroje“ zůstanou (%s, přání %s, %s, příznak %s)', :'imp_p3', pg_temp.prani('krok109-choice', 'krok109-p1'), pg_temp.udaje('krok109-choice', 'krok109-p1'), pg_temp.priznak('krok109-choice', 'krok109-p1')),
  (:'imp_p3'::jsonb ->> 'zmenene')::int = 1 and (:'imp_p3'::jsonb ->> 'beze_zmeny')::int = 0
  and pg_temp.prani('krok109-choice', 'krok109-p1') = 'Terasa'
  and pg_temp.udaje('krok109-choice', 'krok109-p1') = 'Patro: S3|110|Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-p1') = 'true');

-- Klíč přání chybí (starší appka, jiný zdroj): uložené zůstane, není to změna.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  (:'prani1'::jsonb #- '{0,prani_zdroje}'))::text as imp_p4 \gset
select pg_temp.check(format('klíč přání chybí: uložené „Terasa“ zůstane a je to „beze změny“ (%s, přání %s)', :'imp_p4', pg_temp.prani('krok109-choice', 'krok109-p1')),
  (:'imp_p4'::jsonb ->> 'beze_zmeny')::int = 1 and (:'imp_p4'::jsonb ->> 'zmenene')::int = 0
  and pg_temp.prani('krok109-choice', 'krok109-p1') = 'Terasa');

-- Klíč přání chybí a změnil se počet osob: změna se zapíše, přání zůstane.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set((:'prani1'::jsonb #- '{0,prani_zdroje}'), '{0,pocet_osob}', '"5"'))::text as imp_p4b \gset
select pg_temp.check(format('klíč přání chybí a změnil se počet osob: změna projde, přání „Terasa“ zůstane (%s, přání %s)', :'imp_p4b', pg_temp.prani('krok109-choice', 'krok109-p1')),
  (:'imp_p4b'::jsonb ->> 'zmenene')::int = 1
  and (select pocet_osob from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-p1') = 5
  and pg_temp.prani('krok109-choice', 'krok109-p1') = 'Terasa');

-- Dlouhé přání s mezerami okolo: zkrátí se na 120, dávka nespadne.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(:'prani1'::jsonb, '{0,prani_zdroje}', to_jsonb('  ' || repeat('P', 200) || '  ')))::text as imp_p5 \gset
select pg_temp.check(format('dlouhé přání (200 znaků) se zkrátí na 120 a ořežou se mezery (%s, délka %s)', :'imp_p5', char_length(pg_temp.prani('krok109-choice', 'krok109-p1'))),
  (:'imp_p5'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.prani('krok109-choice', 'krok109-p1') = repeat('P', 120));
select pg_temp.check('délku přání hlídá i databáze: 121 znaků přímým zápisem neprojde',
  pg_temp.spadne_hlaskou(format($q$update public.rezervace set prani_zdroje = repeat('x', 121) where poskytovatel = 'krok109-choice' and externi_id = %L$q$, 'krok109-p1'),
    '23514', 'rezervace_prani_zdroje_check'));

-- Host přání v Choice zrušil: prázdné smaže; null taky.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(:'prani1'::jsonb, '{0,prani_zdroje}', '""'))::text as imp_p6 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice', :'prani1'::jsonb)::text as imp_p7 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(:'prani1'::jsonb, '{0,prani_zdroje}', 'null'))::text as imp_p8 \gset
select pg_temp.check(format('prázdné přání smaže uložené, null taky; obojí je „změněná“ (%s, %s, %s, přání „%s“)', :'imp_p6', :'imp_p7', :'imp_p8', pg_temp.prani('krok109-choice', 'krok109-p1')),
  (:'imp_p6'::jsonb ->> 'zmenene')::int = 1 and (:'imp_p7'::jsonb ->> 'zmenene')::int = 1
  and (:'imp_p8'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.prani('krok109-choice', 'krok109-p1') = '');

-- Rezervace BEZ stolů s přáním: appka pošle přání i do prostoru (tam ho
-- obsluha vidí jako dosud) — obojí se uloží.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-p2","zacatek":"2099-11-27T16:00:00.000Z","jmeno_hosta":"Přání bez stolů Krok109","pocet_osob":"2","prostor":"Salonek","prani_zdroje":"Salonek","misto_zdroje":""}]'::jsonb)::text as imp_p9 \gset
select pg_temp.check(format('rezervace bez stolů: přání v prostoru (příznak „ze zdroje“) i ve vlastním sloupci (%s, přání %s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-p2'), pg_temp.prani('krok109-choice', 'krok109-p2'), pg_temp.priznak('krok109-choice', 'krok109-p2')),
  (:'imp_p9'::jsonb ->> 'nove')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-p2') = '||Salonek'
  and pg_temp.prani('krok109-choice', 'krok109-p2') = 'Salonek'
  and pg_temp.priznak('krok109-choice', 'krok109-p2') = 'true');


\echo ''
\echo '== 4. Prostor patří Foodtabu ============================='

-- Obsluha v detailu napsala „u okna“ (přímo — jako po rezervace_ulozit).
update public.rezervace set prostor = 'u okna' where poskytovatel = 'krok109-choice' and externi_id = 'krok109-105';
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(jsonb_set(jsonb_set(:'bez_klicu'::jsonb, '{0,pocet_osob}', '"3"'), '{0,misto_zdroje}', '"Terasa: L9"'), '{0,prostor}', '"Terasa"'))::text as imp9 \gset
select pg_temp.check(format('stoly ze zdroje se přepíšou, „u okna“ od obsluhy zůstane — ani přání hosta „Terasa“ ho nepřepíše; příznak „obsluha“ (shodila ho spoušť) (%s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.priznak('krok109-choice', 'krok109-105')),
  (:'imp9'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|u okna'
  and pg_temp.priznak('krok109-choice', 'krok109-105') = 'false');
-- Příjmové API (nebo jiný zdroj) přání neposílá — prostor je jeho text,
-- ne přání hosta: příznak false.
select pg_temp.check('prázdný prostor zdroj doplní (rezervace bez prostoru dostane „Bar“), stoly mu nevadí; bez klíče přání je to false',
  (select (pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
     '[{"externi_id":"krok109-106","zacatek":"2099-11-27T19:00:00.000Z","jmeno_hosta":"Bez stolů Krok109","pocet_osob":"4","prostor":"Bar","misto_zdroje":"Bar: 1–3"}]'::jsonb) ->> 'zmenene')::int) = 1
  and pg_temp.udaje('krok109-choice', 'krok109-106') = 'Bar: 1–3|106|Bar'
  and pg_temp.priznak('krok109-choice', 'krok109-106') = 'false');


\echo ''
\echo '== 5. Soubor (CSV) klíče nečte ==========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
-- Nová rezervace ze souboru se „stoly“ a číslem: klíče se nečtou.
select public.rezervace_importovat_csv(:'tenant', :'perla', 'krok109-csv',
  '[{"externi_id":"krok109-csv1","zacatek":"2099-11-28T18:00:00+01:00","jmeno_hosta":"Soubor Krok109","pocet_osob":"2","prostor":"Salonek","misto_zdroje":"Patro: S1–S12","cislo_zdroje":"666","prani_zdroje":"Patro"}]'::jsonb)::text as csv1 \gset
-- Soubor se stejným poskytovatelem jako Choice (páruje se na rezervaci
-- z Choice): stoly z Choice soubor nesmaže ani nepřepíše.
select public.rezervace_importovat_csv(:'tenant', :'perla', 'krok109-choice',
  '[{"externi_id":"krok109-105","zacatek":"2099-11-27T18:00:00.000Z","jmeno_hosta":"Patro Krok109","pocet_osob":"3","misto_zdroje":"","cislo_zdroje":"666","prani_zdroje":""}]'::jsonb)::text as csv2 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check(format('soubor: nová rezervace bez stolů, čísla i přání, i když je soubor posílal; prostor ze souboru je text člověka — příznak false (%s, přání „%s“, příznak %s)', pg_temp.udaje('krok109-csv', 'krok109-csv1'), pg_temp.prani('krok109-csv', 'krok109-csv1'), pg_temp.priznak('krok109-csv', 'krok109-csv1')),
  (:'csv1'::jsonb ->> 'nove')::int = 1
  and pg_temp.udaje('krok109-csv', 'krok109-csv1') = '||Salonek'
  and pg_temp.prani('krok109-csv', 'krok109-csv1') = ''
  and pg_temp.priznak('krok109-csv', 'krok109-csv1') = 'false');
select pg_temp.check(format('soubor nad rezervací z Choice: stoly, číslo i přání z Choice zůstanou (%s, přání %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.prani('krok109-choice', 'krok109-105')),
  pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|u okna'
  and pg_temp.prani('krok109-choice', 'krok109-105') = 'Patro');


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
  '{"prostor":"zahrádka","menu":"Krok109 menu","misto_zdroje":"Ručně: X","cislo_zdroje":"1","prani_zdroje":"Ručně"}'::jsonb) as ulozeno \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check(format('ruční uložení změní prostor a menu, stoly, číslo ani přání ze zdroje ne (%s, přání %s)', pg_temp.udaje('krok109-choice', 'krok109-105'), pg_temp.prani('krok109-choice', 'krok109-105')),
  :'ulozeno' = :'r105'
  and pg_temp.udaje('krok109-choice', 'krok109-105') = 'Terasa: L9|105|zahrádka'
  and pg_temp.prani('krok109-choice', 'krok109-105') = 'Patro'
  and (select menu from public.rezervace where id = :'r105') = 'Krok109 menu');

-- Příznak u ručního uložení (3. kolo kontroly kódu): rezervace_ulozit se
-- neměnila, příznak shodí spoušť. #p1 má prostor „Patro“ ze zdroje.
select id as rp1 from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-p1' \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.rezervace_ulozit(:'tenant', :'rp1', :'perla', '{"menu":"Krok109 p1"}'::jsonb) as u_p1a \gset
select pg_temp.priznak('krok109-choice', 'krok109-p1') as pr_menu \gset
select public.rezervace_ulozit(:'tenant', :'rp1', :'perla', '{"prostor":"Patro","menu":"Krok109 p1 b"}'::jsonb) as u_p1b \gset
select pg_temp.priznak('krok109-choice', 'krok109-p1') as pr_stejny \gset
select public.rezervace_ulozit(:'tenant', :'rp1', :'perla', '{"prostor":"Patro u okna"}'::jsonb) as u_p1c \gset
select pg_temp.priznak('krok109-choice', 'krok109-p1') as pr_jiny \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check(format('ruční uložení bez prostoru i se STEJNÝM prostorem příznak „ze zdroje“ nechá (%s, %s)', :'pr_menu', :'pr_stejny'),
  :'pr_menu' = 'true' and :'pr_stejny' = 'true'
  and (select menu from public.rezervace where id = :'rp1') = 'Krok109 p1 b');
select pg_temp.check(format('obsluha prostor přepsala („Patro u okna“): příznak „obsluha“ (%s, %s)', :'pr_jiny', pg_temp.udaje('krok109-choice', 'krok109-p1')),
  :'pr_jiny' = 'false' and pg_temp.udaje('krok109-choice', 'krok109-p1') = 'Patro: S3|110|Patro u okna');

-- Obsluha prostor smazala, další načtení ho doplní přáním znovu.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.rezervace_ulozit(:'tenant', :'rp1', :'perla', '{"prostor":""}'::jsonb) as u_p1d \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.udaje('krok109-choice', 'krok109-p1') || ' ' || pg_temp.priznak('krok109-choice', 'krok109-p1') as po_smazani \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  jsonb_set(jsonb_set(:'prani1'::jsonb, '{0,prani_zdroje}', '"Zahrada"'), '{0,prostor}', '"Zahrada"'))::text as imp_p10 \gset
select pg_temp.check(format('obsluha prostor smazala (%s) → další načtení ho doplní aktuálním přáním a příznak je zase „ze zdroje“ (%s, %s, příznak %s)', :'po_smazani', :'imp_p10', pg_temp.udaje('krok109-choice', 'krok109-p1'), pg_temp.priznak('krok109-choice', 'krok109-p1')),
  :'po_smazani' = 'Patro: S3|110| false'
  and (:'imp_p10'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-p1') = 'Patro: S3|110|Zahrada'
  and pg_temp.priznak('krok109-choice', 'krok109-p1') = 'true');


\echo ''
\echo '== 7. Kdo napsal prostor — okraje ========================'

-- Zdroj s přáním, ale prostor posílá jiný (jiný systém, ruční přepis
-- v něm): do prázdného prostoru se doplní, příznak false — není to přání.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-f1","zacatek":"2099-11-27T15:00:00.000Z","jmeno_hosta":"Jiný prostor Krok109","pocet_osob":"2","prostor":"Salonek","prani_zdroje":"Patro","misto_zdroje":""}]'::jsonb)::text as imp_f1 \gset
select pg_temp.check(format('zdroj s přáním „Patro“ a prostorem „Salonek“: prostor se uloží, příznak false (%s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-f1'), pg_temp.priznak('krok109-choice', 'krok109-f1')),
  (:'imp_f1'::jsonb ->> 'nove')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-f1') = '||Salonek'
  and pg_temp.priznak('krok109-choice', 'krok109-f1') = 'false');

-- Řádek s false (#f1): zápis mění příznak, takže ho spoušť nepřepíše
-- (u řádku s true by spoušť true sama shodila a kontrola by nic nehlídala).
select pg_temp.check('true bez prostoru databáze nepustí (rezervace_prostor_ze_zdroje_neprazdny)',
  pg_temp.spadne_hlaskou(format($q$update public.rezervace set prostor = '', prostor_ze_zdroje = true where poskytovatel = 'krok109-choice' and externi_id = %L$q$, 'krok109-f1'),
    '23514', 'rezervace_prostor_ze_zdroje_neprazdny'));
-- Smazání prostoru u řádku se „ze zdroje“: spoušť příznak shodí dřív,
-- než ho kontrola hlídá — obsluha smí prostor vymazat.
update public.rezervace set prostor = '' where poskytovatel = 'krok109-choice' and externi_id = 'krok109-p2';
select pg_temp.check(format('obsluha smaže prostor u řádku „ze zdroje“: projde, příznak false (%s, příznak %s)', pg_temp.udaje('krok109-choice', 'krok109-p2'), pg_temp.priznak('krok109-choice', 'krok109-p2')),
  pg_temp.udaje('krok109-choice', 'krok109-p2') = '||' and pg_temp.priznak('krok109-choice', 'krok109-p2') = 'false');

-- Řádek z doby před migrací: příznak null. Změna jen příznaku (prostor
-- stejný) spoušť nespustí — tak tu vznikne „starý“ řádek.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-f2","zacatek":"2099-11-27T14:00:00.000Z","jmeno_hosta":"Starý Krok109","pocet_osob":"2","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Patro: S5"}]'::jsonb)::text as imp_f2 \gset
update public.rezervace set prostor_ze_zdroje = null where poskytovatel = 'krok109-choice' and externi_id = 'krok109-f2';
select pg_temp.priznak('krok109-choice', 'krok109-f2') as f2_null \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-f2","zacatek":"2099-11-27T14:00:00.000Z","jmeno_hosta":"Starý Krok109","pocet_osob":"2","prostor":"Terasa","prani_zdroje":"Terasa","misto_zdroje":"Terasa: L1"}]'::jsonb)::text as imp_f2b \gset
select pg_temp.check(format('starý řádek (null): změna stolů a přání ze zdroje příznak nechá null — neví se, kdo prostor napsal (%s → %s, %s, příznak %s)', :'f2_null', :'imp_f2b', pg_temp.udaje('krok109-choice', 'krok109-f2'), pg_temp.priznak('krok109-choice', 'krok109-f2')),
  :'f2_null' = 'null'
  and (:'imp_f2b'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-f2') = 'Terasa: L1||Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-f2') = 'null');
update public.rezervace set prostor = 'u baru' where poskytovatel = 'krok109-choice' and externi_id = 'krok109-f2';
select pg_temp.check(format('starý řádek (null): obsluha změní prostor → false (příznak, který se nezměnil, spoušť přepíše i z null) (příznak %s)', pg_temp.priznak('krok109-choice', 'krok109-f2')),
  pg_temp.priznak('krok109-choice', 'krok109-f2') = 'false');

-- Starý řádek bez prostoru: zdroj ho doplní přáním → true.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-f3","zacatek":"2099-11-27T13:00:00.000Z","jmeno_hosta":"Starý prázdný Krok109","pocet_osob":"2","prostor":null,"prani_zdroje":""}]'::jsonb)::text as imp_f3 \gset
update public.rezervace set prostor_ze_zdroje = null where poskytovatel = 'krok109-choice' and externi_id = 'krok109-f3';
select pg_temp.priznak('krok109-choice', 'krok109-f3') as f3_null \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-f3","zacatek":"2099-11-27T13:00:00.000Z","jmeno_hosta":"Starý prázdný Krok109","pocet_osob":"2","prostor":"Patro","prani_zdroje":"Patro"}]'::jsonb)::text as imp_f3b \gset
select pg_temp.check(format('starý řádek (null) bez prostoru: zdroj doplní přání „Patro“ → true (%s → %s, %s, příznak %s)', :'f3_null', :'imp_f3b', pg_temp.udaje('krok109-choice', 'krok109-f3'), pg_temp.priznak('krok109-choice', 'krok109-f3')),
  :'f3_null' = 'null'
  and (:'imp_f3b'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-f3') = '||Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-f3') = 'true');


\echo ''
\echo '== 8. Akce: stoly ze zdroje upozornění nepošlou ==========='

-- Kontrola kódu 4. 11., 3. kolo (#5): kdyby zdroj doplnil přání do
-- prostoru až ve chvíli, kdy stoly zmizí, u akce by to byla „změna
-- prostoru“ s upozorněním. Prostor se proto doplní hned při prvním
-- načtení a stoly ani přání ho pak nemění.
--
-- Příjemce: majitel, vybraný na akce na Perle. Výběr, který tu možná
-- nechal jiný scénář (sdílená databáze), se zapamatuje a na konci vrátí.
select id as e_majitel from public.employees where tenant_id = :'tenant' and user_id = :'majitel' and deleted_at is null \gset
select coalesce((select row_to_json(u)::text from public.rezervace_upozorneni u
                  where u.branch_id = :'perla' and u.employee_id = :'e_majitel'), '') as vyber_pred \gset
insert into public.rezervace_upozorneni (tenant_id, branch_id, employee_id, akce)
values (:'tenant', :'perla', :'e_majitel', true)
on conflict (branch_id, employee_id) do update set akce = true;

select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-a1","zacatek":"2099-11-26T18:00:00.000Z","jmeno_hosta":"Akce Krok109","pocet_osob":"30","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Patro: S1–S12"}]'::jsonb)::text as imp_a1 \gset
-- Obsluha z ní udělala akci (jako rezervace_ulozit {"druh":"akce"}).
update public.rezervace set druh = 'akce', typ_akce = 'Firemní večírek'
 where poskytovatel = 'krok109-choice' and externi_id = 'krok109-a1';
select pg_temp.upozorneni('krok109-choice', 'krok109-a1') as a1_nova \gset
delete from public.notifikace_doruceni
 where notification_id in (select n.id from public.notifications n where n.zdroj_typ = 'rezervace'
                             and n.zdroj_id = (select id from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-a1'));
delete from public.notifications
 where zdroj_typ = 'rezervace'
   and zdroj_id = (select id from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-a1');

-- V Choice akci přesadili, pak stoly odebrali, pak host změnil přání.
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-a1","zacatek":"2099-11-26T18:00:00.000Z","jmeno_hosta":"Akce Krok109","pocet_osob":"30","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":"Terasa: L1–L9"}]'::jsonb)::text as imp_a2 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-a1","zacatek":"2099-11-26T18:00:00.000Z","jmeno_hosta":"Akce Krok109","pocet_osob":"30","prostor":"Patro","prani_zdroje":"Patro","misto_zdroje":""}]'::jsonb)::text as imp_a3 \gset
select pg_temp.zapsat(:'tenant', :'perla', 'externi', 'krok109-choice', :'choice',
  '[{"externi_id":"krok109-a1","zacatek":"2099-11-26T18:00:00.000Z","jmeno_hosta":"Akce Krok109","pocet_osob":"30","prostor":"Zahrada","prani_zdroje":"Zahrada","misto_zdroje":""}]'::jsonb)::text as imp_a4 \gset
select pg_temp.check(format('akce: přesazení, odebrání stolů ani změna přání v Choice upozornění nepošlou — prostor se nezměnil (%s / %s / %s, %s, příznak %s, upozornění %s)', :'imp_a2', :'imp_a3', :'imp_a4', pg_temp.udaje('krok109-choice', 'krok109-a1'), pg_temp.priznak('krok109-choice', 'krok109-a1'), pg_temp.upozorneni('krok109-choice', 'krok109-a1')),
  (:'imp_a2'::jsonb ->> 'zmenene')::int = 1 and (:'imp_a3'::jsonb ->> 'zmenene')::int = 1 and (:'imp_a4'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.udaje('krok109-choice', 'krok109-a1') = '||Patro'
  and pg_temp.priznak('krok109-choice', 'krok109-a1') = 'true'
  and pg_temp.prani('krok109-choice', 'krok109-a1') = 'Zahrada'
  and pg_temp.upozorneni('krok109-choice', 'krok109-a1') = 0);

-- Kontrola naproti: bez ní by „0 upozornění“ prošlo i s příjemcem, který
-- nic nedostane nikdy. Obsluha přepíše prostor → „změněná akce: prostor“.
update public.rezervace set prostor = 'Salonek'
 where poskytovatel = 'krok109-choice' and externi_id = 'krok109-a1';
select pg_temp.check(format('kontrola naproti: „nová akce“ přišla (%s) a změna prostoru obsluhou pošle majiteli „změněná akce: prostor“, příznak false (upozornění %s, příznak %s)', :'a1_nova', pg_temp.upozorneni('krok109-choice', 'krok109-a1'), pg_temp.priznak('krok109-choice', 'krok109-a1')),
  :'a1_nova'::int >= 1
  and (select count(*) from public.notifications n
        where n.user_id = :'majitel' and n.druh = 'akce.zmenena' and n.zdroj_typ = 'rezervace'
          and n.zdroj_id = (select id from public.rezervace where poskytovatel = 'krok109-choice' and externi_id = 'krok109-a1')
          and n.telo -> 'co_se_zmenilo' = '["prostor"]'::jsonb) = 1
  and pg_temp.priznak('krok109-choice', 'krok109-a1') = 'false');

-- Výběr upozornění zpátky, jak byl.
delete from public.rezervace_upozorneni where branch_id = :'perla' and employee_id = :'e_majitel' and :'vyber_pred' = '';
update public.rezervace_upozorneni u
   set akce = (nullif(:'vyber_pred', '')::jsonb ->> 'akce')::boolean
 where :'vyber_pred' <> '' and u.branch_id = :'perla' and u.employee_id = :'e_majitel';
select pg_temp.check('výběr upozornění majitele na Perle vrácený, jak byl',
  case when :'vyber_pred' = '' then not exists (select 1 from public.rezervace_upozorneni where branch_id = :'perla' and employee_id = :'e_majitel')
       else (select akce from public.rezervace_upozorneni where branch_id = :'perla' and employee_id = :'e_majitel') = (nullif(:'vyber_pred', '')::jsonb ->> 'akce')::boolean end);


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
