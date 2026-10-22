-- Scénář pro krok 98 — Finance → Tržby → Jiné platby.
--
-- Migrace: 20261016100000_jine_platby.sql. Návrh: docs/jine-platby-navrh.md.
--
-- Pokrývá (zadání Šéfíka 15. 10. 2026, oddíl 13 „Ověř"):
--   1. granty: tabulky jen SELECT přes RLS, zápis jen funkcemi; serverové
--      funkce jen service_role; anon nic;
--   2. přímý zápis mimo funkce neprojde (ani do Ostatních tržeb);
--   3. založení: právo na pobočce, cizí pobočka a cizí pokladna odmítnuty,
--      dvojklik = tentýž záznam;
--   4. originály: soubor musí v úložišti být a patřit nahrávajícímu, stejná
--      fotka podruhé neprojde (ani k jinému záznamu);
--   5. návrh: verze (souběžná úprava), neplatné hodnoty, produkt mimo
--      katalog, příznak kontroly blokuje „zkontrolováno";
--   6. tržba: bez kontroly v pokladně nic; obsluha ani skladník tržbu
--      nepotvrdí; nová tržba jen po vyloučení prodeje v pokladně; propojení
--      nic nepřičte; možná duplicita chce důvod; tentýž prodej z pokladny
--      nejde propojit dvakrát; zapsanou částku nejde tiše změnit;
--   7. pozdější import téhož prodeje z pokladny Ostatní tržby nezmění
--      a přehled tržeb z pokladen o nich neví;
--   8. sklad: obsah sestaví databáze (pokrm jako pokrm, bez spropitného
--      a bez položky, kterou pokladna neodečítá); tržba ≠ sklad (právo);
--      jiná pobočka neschválí; bez čerstvé kontroly a s „už odečteno"
--      neschválí; změna návrhu po schválení schválení zruší;
--   9. operace v pokladně: souběh (druhé zabrání = obsazeno/nelze), úspěch
--      jen s ID, nejasný výsledek se neopakuje ani ručně nedoloží,
--      po prokázané chybě nový pokus s novým klíčem, po výdeji nejde měnit
--      položky, korekce jen s právem na opravy;
--  10. faktura a úhrada: propojení faktury není úhrada, oprava tržby
--      s fakturou jen s opravným dokladem (storno + nový řádek), úhrada
--      jen z příchozí platby téže měny a nevytvoří žádnou transakci;
--  11. izolace: cizí firma nic nevidí a nic nezmění; druhá linie
--      (spouště) odmítne řádek s pobočkou nebo pokladnou cizí firmy;
--  12. opravy z nezávislé kontroly 17. 10.: ruční odpis zamyká položky
--      a uvolní ho jen „Zrušit schválení“, doložení je svázané s otiskem,
--      blokace po odeslání návrh zneplatní, druhý výdej téže sjetiny chce
--      důvod, rozdíl součtu chce důvod, úhrada z firemního účtu jen pro
--      přehled celé firmy, zrušení s úhradou ne, zrušený záznam uvolní
--      doklad i frontu, faktura z pokladny ≠ druhá tržba, katalog a alias
--      jen pro pobočky pokladny, hlášky bez id cizích poboček, duplicita
--      čísla účtu jen ±7 dní a bez pokladny v téže pobočce, audit položek;
--  13. opravy z druhé kontroly 19. 10.: pokladna bez katalogu a přeřazená
--      provozovna, ruční prohlášení vs. výsledek z pokladny, úhrada na
--      zrušený záznam / platbou faktury / stornem, „jen propojit“ s důvodem,
--      součet z množství × ceny, číslo účtu s pokladnou i bez, upozornění
--      AI k dokladu, zámky firmy a denní strop AI, druhá linie vazeb
--      operací a tržeb, varování pokrm + zboží; připojení souboru jen přes
--      server; schválený výdej zamčený (oddíly 4, 8, 12a, 12b);
--  14. ověření oprav 20. 10.: výsledek pokladny nepřepíše ruční prohlášení
--      ani po uložení beze změny, „pravděpodobně“ s potvrzením, párování
--      s fakturou počítá Jiné platby, sjetina bez „nenalezeno“ z pokladny,
--      pokrm + kusové zboží s potvrzením, východ z nejasného výsledku po
--      platnosti (i po změně katalogu), vazba návrhu na rozpoznání, další
--      spouště druhé linie a hláška odběratele cizí firmy;
--  15. druhé ověření 20. 10.: výsledek pokladny nejde vyprat ručním „je“,
--      „pravděpodobně“ ze shody čísla účtu jen s právem na opravy, po
--      zrušení nejasné operace stará kontrola skladu neplatí;
--  16. třetí ověření 21. 10. (migrace 20261021100000): konkrétní nález
--      pokladny drží i po nové kontrole nad upraveným návrhem (cesta B,
--      tržba i sklad), značka přepisu, nedohledaný zrušený požadavek,
--      „pravděpodobně“ bez shody, úhrada jen z banky, storno platby
--      a storno tržby;
--  17. čtvrté ověření 22. 10. („cesta C“): zrušení záznamu s nálezem nebo
--      značkou jen s právem na opravy; nová tržba a schválení výdeje
--      proti nálezu / značce jiného záznamu téhož dokladu nebo prodeje
--      (stejná fotka, nebo den a částka) jen s právem na opravy; značka
--      přepisu nepřejde na jiné číslo; značka i po „odesílá se“.
--
-- Navazuje na etapa0_scenar.sql (firma „Foodtab s.r.o.", pobočky
-- cerna-perla a bernard-bar, majitel@foodtab.cz).
--
-- Datum prodeje je pevné (2026-03-14) — žádná kontrola tu neměří
-- posuvným oknem; „datum v budoucnu" se zkouší proti current_date + 30,
-- což je budoucnost v kteroukoli hodinu.

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

-- Cizí firma se svou pobočkou a pokladnou.
insert into auth.users (id, email, raw_user_meta_data) values
  ('98980000-0000-0000-0000-000000000005', 'xaver98@jinafirma.cz', '{"full_name":"Xaver Devadesátosm"}');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000005', false);
select app.create_tenant('Krok98 Cizí s.r.o.', 'Xaver Devadesátosm') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;
insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok98 cizí pobočka', 'krok98-cizi', true)
returning id as cizi_pobocka \gset
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant_b', 'pokladna', 'krok98cizi', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '91', 'nazev', 'Cizí', 'branch_id', :'cizi_pobocka'))))
returning id as cizi_pos \gset

-- Pokladna firmy: provozovna 11 = Perla, 12 = Bar.
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok98pos', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '11', 'nazev', 'Perla', 'branch_id', :'perla'),
    jsonb_build_object('id', '12', 'nazev', 'Bar',   'branch_id', :'bar'))))
returning id as pos \gset
-- Pokladna, která Perlu NEobsluhuje (jen Bar).
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok98bar', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(jsonb_build_object('id', '21', 'nazev', 'Bar', 'branch_id', :'bar'))))
returning id as pos_bar \gset

-- Lidé (každý jen na jedné pobočce, rozsah 'branch'):
--   01 obsluha Perla: zadat, upravit, sklad_odeslat
--   02 pokladní Perla: trzba, upravit
--   03 skladník Perla: vydej_pos
--   04 vedoucí Baru: vydej_pos, zadat (jen Bar)
insert into auth.users (id, email, raw_user_meta_data) values
  ('98980000-0000-0000-0000-000000000001', 'obsluha98@foodtab.cz', '{"full_name":"Obsluha Devadesátosm"}'),
  ('98980000-0000-0000-0000-000000000002', 'pokladni98@foodtab.cz', '{"full_name":"Pokladní Devadesátosm"}'),
  ('98980000-0000-0000-0000-000000000003', 'sklad98@foodtab.cz', '{"full_name":"Skladník Devadesátosm"}'),
  ('98980000-0000-0000-0000-000000000004', 'bar98@foodtab.cz', '{"full_name":"Bar Devadesátosm"}');

insert into public.positions (tenant_id, key, label, department, active) values
  (:'tenant', 'krok98_obsluha', 'Zkouška 98 — obsluha', 'servis', true) returning id as z_obsluha \gset
insert into public.positions (tenant_id, key, label, department, active) values
  (:'tenant', 'krok98_pokladni', 'Zkouška 98 — pokladní', 'servis', true) returning id as z_pokladni \gset
insert into public.positions (tenant_id, key, label, department, active) values
  (:'tenant', 'krok98_sklad', 'Zkouška 98 — sklad', 'kuchyne', true) returning id as z_sklad \gset
insert into public.positions (tenant_id, key, label, department, active) values
  (:'tenant', 'krok98_bar', 'Zkouška 98 — bar', 'bar', true) returning id as z_bar \gset

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_obsluha', 'jine_platby.zadat'),
  (:'tenant', :'z_obsluha', 'jine_platby.upravit'),
  (:'tenant', :'z_obsluha', 'jine_platby.sklad_odeslat'),
  (:'tenant', :'z_pokladni', 'jine_platby.trzba'),
  (:'tenant', :'z_pokladni', 'jine_platby.upravit'),
  (:'tenant', :'z_sklad', 'jine_platby.vydej_pos'),
  (:'tenant', :'z_bar', 'jine_platby.vydej_pos'),
  (:'tenant', :'z_bar', 'jine_platby.zadat');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', '98980000-0000-0000-0000-000000000001', :'z_obsluha', 'Obsluha Devadesátosm', 'hpp') returning id as e1 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', '98980000-0000-0000-0000-000000000002', :'z_pokladni', 'Pokladní Devadesátosm', 'hpp') returning id as e2 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', '98980000-0000-0000-0000-000000000003', :'z_sklad', 'Skladník Devadesátosm', 'hpp') returning id as e3 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'bar', '98980000-0000-0000-0000-000000000004', :'z_bar', 'Bar Devadesátosm', 'hpp') returning id as e4 \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '98980000-0000-0000-0000-000000000001', null, 'branch', 'active') returning id as m1 \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '98980000-0000-0000-0000-000000000002', null, 'branch', 'active') returning id as m2 \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '98980000-0000-0000-0000-000000000003', null, 'branch', 'active') returning id as m3 \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '98980000-0000-0000-0000-000000000004', null, 'branch', 'active') returning id as m4 \gset
insert into public.membership_branches (membership_id, branch_id) values
  (:'m1', :'perla'), (:'m2', :'perla'), (:'m3', :'perla'), (:'m4', :'bar');

-- Katalog pokladny: pokrm s recepturou (sklad neodečítá sám, suroviny
-- ano), pivo 0,5 l (odečítá, 0,5 l na kus), vstupné (sklad se netýká).
set role service_role;
select public.pos_katalog_nahradit(:'pos', jsonb_build_array(
  jsonb_build_object('externi_id', 'P1', 'nazev', 'Svíčková', 'jednotka', 'Piece', 'odecita_sklad', false, 'ma_recepturu', true),
  jsonb_build_object('externi_id', 'P2', 'nazev', 'Pivo 0,5 l', 'jednotka', 'Liter', 'mira', 0.5, 'odecita_sklad', true, 'ma_recepturu', false),
  jsonb_build_object('externi_id', 'P3', 'nazev', 'Vstupné', 'jednotka', 'Piece', 'odecita_sklad', false, 'ma_recepturu', false),
  jsonb_build_object('externi_id', 'P4', 'nazev', 'Polévka dne', 'jednotka', 'Piece', 'odecita_sklad', false)
)) as katalog_pocet \gset
reset role;


\echo ''
\echo '== 1. Granty ====================================================='

select pg_temp.check('všech 10 tabulek má RLS a authenticated jen SELECT',
  (select count(*) from pg_class c
    where c.oid in ('public.jine_platby'::regclass, 'public.jine_platby_soubory'::regclass, 'public.jine_platby_rozpoznani'::regclass,
                    'public.jine_platby_polozky'::regclass, 'public.pos_katalog'::regclass, 'public.pos_mapovani'::regclass,
                    'public.jine_platby_skladove_navrhy'::regclass, 'public.pos_operace'::regclass,
                    'public.ostatni_trzby'::regclass, 'public.jine_platby_historie'::regclass)
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
      and not has_table_privilege('authenticated', c.oid, 'update')
      and not has_table_privilege('authenticated', c.oid, 'delete')
      and not has_table_privilege('authenticated', c.oid, 'truncate')
      and not has_table_privilege('anon', c.oid, 'select')) = 10);

select pg_temp.check('funkce pro přihlášené: authenticated ano, anon ne, všechny SECURITY DEFINER se search_path=""',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'jine_platby\_%'
      and p.proname not in ('jine_platby_zahajit_rozpoznani', 'jine_platby_dokoncit_rozpoznani', 'jine_platby_zapsat_kontrolu',
                            'jine_platby_pripojit_soubor')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and p.proconfig @> array['search_path=""']) = 20);

select pg_temp.check('serverové funkce (AI, kontrola v pokladně, operace, katalog, připojení souboru): jen service_role',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('jine_platby_zahajit_rozpoznani', 'jine_platby_dokoncit_rozpoznani', 'jine_platby_zapsat_kontrolu',
                        'pos_operace_zahajit', 'pos_operace_dokoncit', 'pos_katalog_nahradit', 'jine_platby_pripojit_soubor')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 7);

select pg_temp.check('katalog se nahrál (4 produkty)', :'katalog_pocet'::integer = 4);


\echo ''
\echo '== 2. Přímý zápis mimo funkce ==================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ani majitel nevloží záznam přímo (jen funkcí)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.jine_platby (tenant_id, branch_id, klient_id) values (%L, %L, gen_random_uuid())', :'tenant', :'perla'),
    '42501', 'permission denied'));
select pg_temp.check('ani majitel nevloží tržbu do Ostatních tržeb přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zapocitat) values (%L, %L, %L, 100, %L, %L, true)',
    :'tenant', :'perla', '2026-03-14', 'CZK', 'jine_platby'),
    '42501', 'permission denied'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 3. Založení ==================================================='

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Firma Novák — stůl 5', '98980000-aaaa-0000-0000-000000000001') as z1 \gset
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Firma Novák — stůl 5', '98980000-aaaa-0000-0000-000000000001') as z1_znovu \gset
select pg_temp.check('dvojklik (stejný klíč formuláře) = tentýž záznam', :'z1' = :'z1_znovu');
select pg_temp.check('obsluha Perly nezaloží záznam v Baru (právo jen na Perle)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zalozit(%L, %L, null, %L, gen_random_uuid())', :'tenant', :'bar', 'x'),
    '42501', 'nemáte právo'));
select pg_temp.check('pobočka cizí firmy odmítnuta',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zalozit(%L, %L, null, %L, gen_random_uuid())', :'tenant', :'cizi_pobocka', 'x'),
    '23514', 'nepatří této firmě'));
select pg_temp.check('pokladna cizí firmy odmítnuta',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zalozit(%L, %L, %L, %L, gen_random_uuid())', :'tenant', :'perla', :'cizi_pos', 'x'),
    '23514', 'nepatří této firmě'));
select pg_temp.check('pokladna, která Perlu neobsluhuje, odmítnuta',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zalozit(%L, %L, %L, %L, gen_random_uuid())', :'tenant', :'perla', :'pos_bar', 'x'),
    '23514', 'neobsluhuje'));
-- Druhý záznam téhož dne (pro duplicitu) a třetí bez pokladny.
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Druhá fotka téže sjetiny', '98980000-aaaa-0000-0000-000000000002') as z2 \gset
select public.jine_platby_zalozit(:'tenant', :'perla', null, 'Ručně psané — bez pokladny', '98980000-aaaa-0000-0000-000000000003') as z3 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('záznam má pobočku, provozovnu pokladny 11 a stavy na začátku',
  (select branch_id = :'perla' and pos_provozovna = '11' and stav_kontroly = 'rozpracovano' and stav_trzby = 'nezapsano'
          and stav_skladu = 'bez_navrhu' and stav_faktury = 'bez_faktury' and stav_uhrady = 'neovereno' and verze = 1
     from public.jine_platby where id = :'z1'));

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru záznam Perly NEVIDÍ (RLS po pobočkách)',
  (select count(*) from public.jine_platby where id = :'z1') = 0);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma záznam NEVIDÍ',
  (select count(*) from public.jine_platby where id = :'z1') = 0);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník Perly záznam vidí (vydej_pos na Perle stačí ke čtení)',
  (select count(*) from public.jine_platby where id = :'z1') = 1);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 4. Originály dokladu =========================================='

-- Soubory nahrané z prohlížeče (napodobenina úložiště): dva od obsluhy,
-- jeden od někoho jiného, metadata jako u Supabase.
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-000000000001') as cesta1 \gset
select format('%s/%s/%s/%s.pdf', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-000000000002') as cesta2 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-000000000003') as cesta_cizi \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z2', '98980000-bbbb-0000-0000-000000000004') as cesta_z2 \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta1', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":250000}'),
  ('jine-platby', :'cesta2', '98980000-0000-0000-0000-000000000001', '{"mimetype":"application/pdf","size":90000}'),
  ('jine-platby', :'cesta_cizi', '98980000-0000-0000-0000-000000000002', '{"mimetype":"image/jpeg","size":1000}'),
  ('jine-platby', :'cesta_z2', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":250000}');

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
-- Otisk a typ podle obsahu ověřuje server ze stažených bajtů; přihlášený by
-- jinak poslal vymyšlený otisk a tutéž fotku připojil podruhé (kontrola 19. 10.).
select pg_temp.check('přihlášený soubor sám nepřipojí (vymyšlený otisk) — jen server',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z1', :'cesta1', repeat('9', 64), '98980000-0000-0000-0000-000000000001'),
    '42501', 'permission denied'));
set role service_role;
select public.jine_platby_pripojit_soubor(:'z1', :'cesta1', repeat('a', 64), '98980000-0000-0000-0000-000000000001') as soubor1 \gset
select pg_temp.check('druhá stránka (PDF) se připojí s pořadím 2',
  pg_temp.projde(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z1', :'cesta2', repeat('b', 64), '98980000-0000-0000-0000-000000000001')));
select pg_temp.check('stejná fotka (otisk) k jinému záznamu NEPROJDE — opakovaná sjetina',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z2', :'cesta_z2', repeat('a', 64), '98980000-0000-0000-0000-000000000001'),
    '23505', 'už je připojený k záznamu'));
select pg_temp.check('soubor, který nahrál někdo jiný, nejde připojit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z1', :'cesta_cizi', repeat('c', 64), '98980000-0000-0000-0000-000000000001'),
    '23514', 'nahrál někdo jiný'));
select pg_temp.check('cesta jiného záznamu nesedí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z1', :'cesta_z2', repeat('d', 64), '98980000-0000-0000-0000-000000000001'),
    '23514', 'nesedí'));
select pg_temp.check('soubor, který v úložišti není, nejde připojit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z1',
    format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-00000000ffff'), repeat('e', 64), '98980000-0000-0000-0000-000000000001'),
    '23514', 'v úložišti není'));
set role authenticated;
select pg_temp.check('obsluha originál čte (politika úložiště)',
  (select count(*) from storage.objects where bucket_id = 'jine-platby' and name = :'cesta1') = 1);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru originál Perly NEČTE',
  (select count(*) from storage.objects where bucket_id = 'jine-platby' and name = :'cesta1') = 0);
select pg_temp.check('vedoucí Baru nenahraje soubor do cesty Perly',
  not pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'jine-platby', format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-000000000009'),
    '98980000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg","size":10}')));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma originál NEČTE',
  (select count(*) from storage.objects where bucket_id = 'jine-platby' and name = :'cesta1') = 0);
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('připojené soubory: 2, pořadí 1 a 2, otisk uložený',
  (select count(*) = 2 and min(poradi) = 1 and max(poradi) = 2 from public.jine_platby_soubory where zaznam_id = :'z1'));


\echo ''
\echo '== 5. Návrh a kontrola dokladu ==================================='

-- Sjetina: svíčková 2× (pokrm s recepturou), pivo 0,5 l 4× (rozlévaný
-- nápoj → 4 kusy v pokladně), spropitné (bez skladu), vstupné (produkt,
-- který pokladna ze skladu neodečítá).
select jsonb_build_object('datum_prodeje', '2026-03-14', 'oznaceni', 'Firma Novák — stůl 5', 'mena', 'CZK',
  'castka_haleru', 140000, 'castka_puvod', 'doklad', 'typ_dokladu', 'otevreny_ucet', 'externi_ucet', 'Účet 125', 'kontakt_id', null)::text as hlavicka \gset
select jsonb_build_array(
  jsonb_build_object('nazev_puvodni', 'Svickova', 'nazev', 'Svíčková', 'mnozstvi', '2', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 29000, 'cena_celkem_haleru', 58000, 'zdroj', 'ai', 'druh', 'pokrm',
    'pos_produkt_id', 'P1', 'pos_produkt_nazev', 'Svíčková', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev_puvodni', 'Pivo 0,5', 'nazev', 'Pivo 0,5 l', 'mnozstvi', '4', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 6500, 'cena_celkem_haleru', 26000, 'zdroj', 'ai', 'druh', 'rozlevany_napoj',
    'pos_produkt_id', 'P2', 'pos_produkt_nazev', 'Pivo 0,5 l', 'pos_mnozstvi', '4', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev_puvodni', 'Vstupne', 'nazev', 'Vstupné', 'mnozstvi', '2', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 20000, 'cena_celkem_haleru', 40000, 'zdroj', 'ai', 'druh', 'kusove_zbozi',
    'pos_produkt_id', 'P3', 'pos_produkt_nazev', 'Vstupné', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev_puvodni', 'Tip', 'nazev', 'Spropitné', 'mnozstvi', null, 'jednotka', null,
    'cena_jednotkova_haleru', null, 'cena_celkem_haleru', 16000, 'zdroj', 'ai', 'druh', 'spropitne',
    'mapovani', 'neskladova', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev_puvodni', 'Polevka', 'nazev', 'Polévka dne', 'mnozstvi', '1', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 0, 'cena_celkem_haleru', 0, 'zdroj', 'rucne', 'druh', 'pokrm',
    'pos_produkt_id', 'P4', 'pos_produkt_nazev', 'Polévka dne', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false)
)::text as polozky \gset

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník (bez práva upravit) návrh neuloží',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 1, %L::jsonb, %L::jsonb)', :'z1', :'hlavicka', :'polozky'),
    '42501', 'nemáte oprávnění'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('stará verze (souběžná úprava) = 40001, nic se nepřepíše',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 7, %L::jsonb, %L::jsonb)', :'z1', :'hlavicka', :'polozky'),
    '40001', 'mezitím upravil'));
select pg_temp.check('nulové množství odmítnuto (nic se nedomýšlí)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 1, %L::jsonb, %L::jsonb)', :'z1', :'hlavicka',
    jsonb_build_array(jsonb_build_object('nazev', 'Pivo', 'mnozstvi', '0', 'zdroj', 'rucne'))::text),
    '23514', 'neplatnou hodnotu'));
select pg_temp.check('produkt, který v katalogu pokladny není, odmítnut',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 1, %L::jsonb, %L::jsonb)', :'z1', :'hlavicka',
    jsonb_build_array(jsonb_build_object('nazev', 'Vymyšlené', 'zdroj', 'ai', 'druh', 'pokrm', 'pos_produkt_id', 'NEEXISTUJE', 'mapovani', 'navrh'))::text),
    '23514', 'v katalogu pokladny není'));
select pg_temp.check('datum prodeje v budoucnu odmítnuto',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 1, %L::jsonb, %L::jsonb)', :'z1',
    jsonb_set(:'hlavicka'::jsonb, '{datum_prodeje}', to_jsonb((current_date + 30)::text))::text, '[]'),
    '23514', 'v budoucnu'));

-- Položka s příznakem ke kontrole: uloží se, ale „zkontrolováno" ne.
select public.jine_platby_ulozit_navrh(:'z1', 1, :'hlavicka'::jsonb,
  jsonb_set(:'polozky'::jsonb, '{0,vyzaduje_kontrolu}', 'true')) as verze_z1 \gset
select pg_temp.check('s položkou ke kontrole je záznam „ke kontrole" a nejde označit jako zkontrolovaný',
  (select stav_kontroly = 'ke_kontrole' from public.jine_platby where id = :'z1')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_oznacit_zkontrolovano(%L, %s)', :'z1', :'verze_z1'),
    '23514', 'čekají na kontrolu'));
select public.jine_platby_ulozit_navrh(:'z1', :'verze_z1', :'hlavicka'::jsonb, :'polozky'::jsonb) as verze_z1 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z1', :'verze_z1', 'Celkem na dokladu je včetně spropitného 160 Kč.');
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('návrh: 5 položek, verze 3, zkontrolováno, částka 1 400 Kč',
  (select count(*) from public.jine_platby_polozky where zaznam_id = :'z1') = 5
  and (select verze = 3 and stav_kontroly = 'zkontrolovano' and castka_haleru = 140000 from public.jine_platby where id = :'z1'));


\echo ''
\echo '== 6. Zápis do Ostatních tržeb ==================================='

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('bez kontroly prodeje v pokladně tržbu nejde zapsat',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z1', :'verze_z1', 'nova'),
    '23514', 'zkontrolujte prodej v pokladně'));
select pg_temp.check('ruční doložení bez důvodu neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z1', :'verze_z1', 'trzba', 'nenalezeno', 'ok'),
    '23514', 'důvod'));
-- Pokladní doloží, že účet 125 je v pokladně otevřený (ne uzavřený prodej).
select public.jine_platby_prohlasit(:'z1', :'verze_z1', 'trzba', 'nenalezeno', 'Účet 125 je v pokladně otevřený, nebude uzavřen — fakturujeme.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('obsluha (bez práva na tržby) tržbu nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z1', :'verze_z1', 'nova'),
    '42501', 'právo evidovat tržby'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník (Potvrdit výdej do POS) tržbu nepotvrdí — oddělená práva',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z1', :'verze_z1', 'nova'),
    '42501', 'právo evidovat tržby'));
select pg_temp.check('skladník ani prodej v pokladně za tržby nedoloží',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z1', :'verze_z1', 'trzba', 'nenalezeno', 'Neprodalo se to.'),
    '42501', 'potvrzuje tržby'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_potvrdit_trzbu(:'z1', :'verze_z1', 'nova') as trzba1 \gset
select pg_temp.check('podruhé zapsat nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z1', :'verze_z1', 'nova'),
    '23514', 'už zapsaná'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Ostatní tržby: jeden platný řádek, započtený, 1 400 Kč, provozní den, autor = pokladní',
  (select count(*) = 1 and bool_and(zapocitat) and sum(castka_haleru) = 140000 and min(datum) = '2026-03-14'
          and min(potvrdil::text) = '98980000-0000-0000-0000-000000000002'
     from public.ostatni_trzby where zaznam_id = :'z1' and stav = 'platna'));
select pg_temp.check('zápis tržby nezměnil sklad ani fakturu ani úhradu (každá část zvlášť)',
  (select stav_trzby = 'zapsano' and stav_skladu = 'bez_navrhu' and stav_faktury = 'bez_faktury' and stav_uhrady = 'neovereno'
     from public.jine_platby where id = :'z1'));
select pg_temp.check('přímý řádek „započtený prodej z pokladny" odmítne databáze (check)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zapocitat, pos_pripojeni_id, pos_prodej_id) values (%L, %L, %L, 100, %L, %L, true, %L, %L)',
    :'tenant', :'perla', '2026-03-14', 'CZK', 'jine_platby', :'pos', 'X1'),
    '23514', 'ostatni_trzby_check'));

-- Druhá fotka téže sjetiny (z2): stejná pobočka, den, částka, měna.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z2', 1, jsonb_set(:'hlavicka'::jsonb, '{externi_ucet}', 'null'), '[]') as verze_z2 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z2', :'verze_z2');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'z2', :'verze_z2', 'trzba', 'nenalezeno', 'V pokladně není.');
select pg_temp.check('možná duplicita (pobočka + den + částka + měna) bez důvodu neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z2', :'verze_z2', 'nova'),
    '23514', 'Možná duplicita'));
-- Kontrola v pokladně (server) najde uzavřený prodej: propojit, nepřičítat.
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z2', :'verze_z2', 'trzba', 'nalezeno',
  jsonb_build_object('pos_prodej_id', 'ORDER-777', 'cislo_dokladu', '2026/0815'), '98980000-0000-0000-0000-000000000002');
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('když pokladna prodej má, novou tržbu zapsat nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z2', :'verze_z2', 'nova'),
    '23514', 'nebyl vyloučen'));
select (select coalesce(sum(castka_haleru), 0) from public.ostatni_trzby where tenant_id = :'tenant' and stav = 'platna' and zapocitat) as soucet_pred \gset
select public.jine_platby_potvrdit_trzbu(:'z2', :'verze_z2', 'propojit', 'Je to tentýž prodej, který pokladna uzavřela — jen propojuji.') as trzba2 \gset
select pg_temp.check('propojení nic nepřičte: součet započtených Ostatních tržeb beze změny',
  (select coalesce(sum(castka_haleru), 0) from public.ostatni_trzby where tenant_id = :'tenant' and stav = 'platna' and zapocitat) = :'soucet_pred'::bigint);
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('propojený řádek: zapocitat=false, ID prodeje v pokladně, záznam „propojeno" s rozhodnutím o duplicitě',
  (select not zapocitat and pos_prodej_id = 'ORDER-777' from public.ostatni_trzby where id = :'trzba2')
  and (select stav_trzby = 'propojeno' and pos_prodej_id = 'ORDER-777' and duplicita ->> 'duvod' like 'Je to tentýž%'
         from public.jine_platby where id = :'z2'));
update public.ostatni_trzby set kategorie = 'catering' where id = :'trzba2';
select pg_temp.check('změna kategorie celkovou tržbu nezmění',
  (select coalesce(sum(castka_haleru), 0) from public.ostatni_trzby where tenant_id = :'tenant' and stav = 'platna' and zapocitat) = :'soucet_pred'::bigint);

-- Třetí záznam se STEJNÝM prodejem z pokladny: nejde ho propojit podruhé.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Třetí fotka', '98980000-aaaa-0000-0000-000000000004') as z4 \gset
select public.jine_platby_ulozit_navrh(:'z4', 1, jsonb_set(jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '99900'), '{externi_ucet}', 'null'), '[]') as verze_z4 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z4', :'verze_z4');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z4', :'verze_z4', 'trzba', 'nalezeno', jsonb_build_object('pos_prodej_id', 'ORDER-777'), null);
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('tentýž prodej z pokladny nejde propojit podruhé (jiná fotka téže sjetiny)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z4', :'verze_z4', 'propojit'),
    '23505', 'už propojený'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('zapsanou částku nejde tiše změnit v návrhu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z1', :'verze_z1',
    jsonb_set(:'hlavicka'::jsonb, '{castka_haleru}', '150000')::text, :'polozky'),
    '23514', 'opravou tržby'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 7. Pozdější import téhož prodeje z pokladny ==================='

set role service_role;
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2026-03-14']::date[],
  '[{"datum":"2026-03-14","produkt_nazev":"Krok98 Svíčková","mnozstvi":2,"trzba_haleru":58000},
    {"datum":"2026-03-14","produkt_nazev":"Krok98 Pivo 0,5 l","mnozstvi":4,"trzba_haleru":26000}]'::jsonb, '11');
select public.pokladna_nahradit_prodeje(:'pos', :'perla', array['2026-03-14']::date[],
  '[{"datum":"2026-03-14","produkt_nazev":"Krok98 Svíčková","mnozstvi":2,"trzba_haleru":58000}]'::jsonb, '11');
reset role;
select pg_temp.check('synchronizace pokladny Ostatní tržby nesmazala ani nezměnila',
  (select count(*) from public.ostatni_trzby where zaznam_id in (:'z1', :'z2') and stav = 'platna') = 2
  and (select castka_haleru from public.ostatni_trzby where id = :'trzba1') = 140000);
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('přehled tržeb z pokladen o Ostatních tržbách neví (jen 580 Kč z pokladny)',
  (select coalesce(sum((r ->> 'trzba_haleru')::bigint), 0)
     from jsonb_array_elements(public.pokladna_prehled_trzeb(:'tenant', '2026-03-14', '2026-03-14', 'den') -> 'trzby') r
    where r ->> 'branch_id' = :'perla') = 58000);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 8. Skladový návrh a schválení ================================='

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_sestavit_vydej(:'z1')::text as vydej \gset
select pg_temp.check('výdej: svíčková JAKO POKRM (2), pivo (4 kusy) a polévka (receptura neznámá → zůstává); bez spropitného a bez vstupného, které pokladna výslovně neodečítá',
  (select jsonb_agg(e ->> 'pos_produkt_id' order by e ->> 'pos_produkt_id') from jsonb_array_elements(:'vydej'::jsonb -> 'obsah' -> 'polozky') e)
    = '["P1", "P2", "P4"]'::jsonb
  and (select (e ->> 'mnozstvi')::numeric from jsonb_array_elements(:'vydej'::jsonb -> 'obsah' -> 'polozky') e where e ->> 'pos_produkt_id' = 'P2') = 4
  and jsonb_array_length(:'vydej'::jsonb -> 'blokace') = 0);
select public.jine_platby_odeslat_sklad(:'z1', :'verze_z1') as navrh1 \gset
select pg_temp.check('odeslání ke schválení nic neprovedlo: žádná operace v pokladně, stav „čeká na schválení"',
  (select count(*) from public.pos_operace where zaznam_id = :'z1') = 0
  and (select stav_skladu = 'ceka_na_schvaleni' from public.jine_platby where id = :'z1'));
select otisk as otisk1 from public.jine_platby_skladove_navrhy where id = :'navrh1' \gset
select pg_temp.check('obsluha výdej neschválí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    '42501', 'oprávněná osoba'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('pokladní (právo na tržby) výdej neschválí — tržba neumožňuje odečíst sklad',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    '42501', 'oprávněná osoba'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru výdej Perly neschválí (právo jen pro svou provozovnu)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    'P0002', 'nenalezen'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník bez kontroly v pokladně neschválí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    '23514', 'zkontrolujte výdej v pokladně'));
select public.jine_platby_prohlasit(:'z1', :'verze_z1', 'sklad', 'jiz_odecteno', 'Pokladna ráno účet uzavřela, sklad odečetla.');
select pg_temp.check('„už odečteno" = výdej nevytvářet, jen propojit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    '23514', 'jen ho propojte'));
select public.jine_platby_prohlasit(:'z1', :'verze_z1', 'sklad', 'neodecteno', 'Ověřeno v pokladně: účet 125 otevřený, nic neodečteno.');
select pg_temp.check('se starým otiskem neschválí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', repeat('0', 64)),
    '23514', 'změnil'));
select public.jine_platby_rozhodnout_vydej(:'navrh1', :'otisk1', true) as op1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('schváleno: operace „připraveno" s klíčem, položky z návrhu, schvalovatel zapsaný',
  (select stav = 'pripraveno' and idempotencni_klic like 'ftjp%' and jsonb_array_length(polozky) = 3 and externi_provozovna = '11'
     from public.pos_operace where id = :'op1')
  and (select stav = 'schvaleno' and schvalil::text = '98980000-0000-0000-0000-000000000003' from public.jine_platby_skladove_navrhy where id = :'navrh1'));

-- Změna po schválení: schválený výdej může schvalovatel právě odepisovat
-- v pokladně (i když provedení přes API selhalo) — obsluha ho tiše
-- nezneplatní. Uvolní ho jen Zrušit schválení (kontrola 19. 10.).
select (jsonb_set(:'polozky'::jsonb, '{1,pos_mnozstvi}', '"5"'))::text as polozky5 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('schválený výdej: obsluha množství nezmění (schválení se tiše nezneplatní)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z1', :'verze_z1', :'hlavicka', :'polozky5'),
    '23514', 'Výdej je schválený'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_zrusit_schvaleni(:'z1', 'V pokladně nic neodepsáno, obsluha opraví množství piva.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z1', :'verze_z1', :'hlavicka'::jsonb, :'polozky5'::jsonb) as verze_z1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('po Zrušit schválení jde množství změnit: návrh nahrazený, operace zrušená, sklad znovu „bez návrhu"',
  (select stav = 'nahrazeno' from public.jine_platby_skladove_navrhy where id = :'navrh1')
  and (select stav = 'zruseno' from public.pos_operace where id = :'op1')
  and (select stav_skladu = 'bez_navrhu' and stav_trzby = 'zapsano' from public.jine_platby where id = :'z1'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('starý návrh už schválit nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh1', :'otisk1'),
    '23514', 'není ke schválení'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_oznacit_zkontrolovano(:'z1', :'verze_z1', 'Celkem na dokladu je včetně spropitného 160 Kč.');
select public.jine_platby_odeslat_sklad(:'z1', :'verze_z1') as navrh2 \gset
select otisk as otisk2 from public.jine_platby_skladove_navrhy where id = :'navrh2' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('kontrola ke staré verzi neplatí — po úpravě se musí zopakovat',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh2', :'otisk2'),
    '23514', 'zkontrolujte výdej v pokladně'));
-- z1 je otevřený účet: „neodečteno“ dotaz do pokladny neprokáže (kontrola
-- 20. 10.), skladník ho ověří v pokladně a doloží ručně.
select public.jine_platby_prohlasit(:'z1', :'verze_z1', 'sklad', 'neodecteno', 'Ověřeno v pokladně: účet 125 otevřený, nic neodečteno.');
select pg_temp.check('zamítnutí bez důvodu neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, false, %L)', :'navrh2', :'otisk2', ''),
    '23514', 'důvod'));
select public.jine_platby_rozhodnout_vydej(:'navrh2', :'otisk2', true) as op2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('se změnou položky obsah návrhu jiný (5 piv) a otisk jiný',
  :'otisk1' <> :'otisk2'
  and (select (e ->> 'mnozstvi')::numeric from public.jine_platby_skladove_navrhy n, jsonb_array_elements(n.obsah -> 'polozky') e
        where n.id = :'navrh2' and e ->> 'pos_produkt_id' = 'P2') = 5);


set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
-- Jiné scénáře (krok93–95) nechávají ve firmě vlastní pokladny — počítají se
-- jen pokladny tohoto scénáře.
select pg_temp.check('jine_platby_pokladny vrací jen netajné sloupce (žádné přístupy, kurzory ani nastavení)',
  (select array_agg(n order by n) from pg_proc p, unnest(p.proargnames) with ordinality a(n, i)
    where p.oid = 'public.jine_platby_pokladny(uuid, uuid)'::regprocedure and p.proargmodes[i] = 't')
  = array['id', 'nazev', 'pos_provozovna', 'poskytovatel', 'provozovna_nazev', 'stav']);
select pg_temp.check('obsluha (bez finance.read) vidí pokladnu své pobočky s provozovnou 11, pokladnu jen Baru ne',
  (select count(*) = 1 and min(pos_provozovna) = '11' from public.jine_platby_pokladny(:'tenant', :'perla') where id = :'pos')
  and not exists (select 1 from public.jine_platby_pokladny(:'tenant', :'perla') where id in (:'pos_bar', :'cizi_pos')));
select pg_temp.check('obsluha Perly nedostane pokladny Baru (bez práva na pobočce = prázdno)',
  (select count(*) from public.jine_platby_pokladny(:'tenant', :'bar')) = 0);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru vidí obě pokladny, které Bar obsluhují',
  (select count(*) from public.jine_platby_pokladny(:'tenant', :'bar') where id in (:'pos', :'pos_bar')) = 2
  and not exists (select 1 from public.jine_platby_pokladny(:'tenant', :'bar') where id = :'cizi_pos'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma pokladny naší firmy nedostane',
  (select count(*) from public.jine_platby_pokladny(:'tenant', :'perla')) = 0);
-- Záznam bez pokladny: návrh výdeje nevznikne, oprávněná osoba doloží ručně.
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z3', 1, jsonb_set(:'hlavicka'::jsonb, '{externi_ucet}', 'null'), '[]') as verze_z3 \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('bez pokladny: nezkontrolovaný záznam ručně doložit nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, null, %L, %L)', :'z3', 'X', 'Zkouším bez kontroly.'),
    '23514', 'Nejdřív zkontrolujte'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_oznacit_zkontrolovano(:'z3', :'verze_z3');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('záznam s pokladnou bez schváleného návrhu ručně doložit nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, null, %L, %L)', :'z4', 'X', 'Zkouším bez schválení.'),
    '23514', 'jen schválený návrh'));
select public.jine_platby_rucne_dolozit_vydej(:'z3', null, 'VYD-papír-12', 'Provozovna nemá pokladnu se skladem, zapsáno do papírové výdejky.');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('bez pokladny: ručně doloženo s dokladem, žádný návrh ani operace',
  (select stav_skladu = 'rucne_dolozeno' and vydej_doklad = 'VYD-papír-12' from public.jine_platby where id = :'z3')
  and (select count(*) from public.jine_platby_skladove_navrhy where zaznam_id = :'z3') = 0
  and (select count(*) from public.pos_operace where zaznam_id = :'z3') = 0);

\echo ''
\echo '== 9. Operace v pokladně: souběh, timeout, obnova ================'

set role service_role;
select public.pos_operace_zahajit(:'op2', now() + interval '5 minutes')::text as zabrani1 \gset
select public.pos_operace_zahajit(:'op2', now() + interval '5 minutes')::text as zabrani2 \gset
reset role;
select pg_temp.check('první zabrání projde, druhé (souběžný klik) už ne — nic se neodešle dvakrát',
  :'zabrani1'::jsonb ->> 'stav' = 'ok' and :'zabrani2'::jsonb ->> 'stav' in ('nelze', 'obsazeno')
  and (select stav = 'odesila_se' and pokusu = 1 from public.pos_operace where id = :'op2')
  and (select stav_skladu = 'zpracovava_se' from public.jine_platby where id = :'z1'));
set role service_role;
select pg_temp.check('úspěch bez ID z pokladny odmítnut (Odečteno v POS jen ověřené)',
  not pg_temp.projde(format('select public.pos_operace_dokoncit(%L, %L, null, null, null, null)', :'op2', 'uspech')));
select public.pos_operace_dokoncit(:'op2', 'nejasny_vysledek', null, null, null, 'Timeout po 20 s.');
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('nejasný výsledek: ruční doložení neprojde (výdej by se mohl zdvojit)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z1', :'otisk2', 'X', 'Udělal jsem to ručně.'),
    '23514', 'nejasný výsledek'));
select pg_temp.check('nejasný výsledek: nový pokus neprojde (nejdřív dohledat)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_vydej_znovu(%L)', :'z1'),
    '23514', 'dohledejte'));
reset role;
set role service_role;
select public.pos_operace_dokoncit(:'op2', 'chyba', null, null, jsonb_build_object('dohledano', false), 'Po platnosti nenalezeno — pokladna požadavek neprovedla.');
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_vydej_znovu(:'z1') as op3 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('po prokázané chybě nový pokus s NOVÝM klíčem',
  (select idempotencni_klic from public.pos_operace where id = :'op3') <> (select idempotencni_klic from public.pos_operace where id = :'op2')
  and (select stav from public.pos_operace where id = :'op3') = 'pripraveno');
set role service_role;
select (public.pos_operace_zahajit(:'op3', now() + interval '5 minutes') ->> 'stav') as zabrani3 \gset
select public.pos_operace_dokoncit(:'op3', 'uspech', 'ORDER-ODPIS-1', '2026/ODP/7', jsonb_build_object('dohledano', true), null);
reset role;
select pg_temp.check('ověřený úspěch: Odečteno v POS, ID operace uložené, návrh proveden',
  :'zabrani3' = 'ok'
  and (select stav_skladu = 'odecteno_v_pos' and vydej_externi_id = 'ORDER-ODPIS-1' from public.jine_platby where id = :'z1')
  and (select stav = 'provedeno' from public.jine_platby_skladove_navrhy where id = :'navrh2'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('po provedeném výdeji nejde položky změnit (jen opravou)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z1', :'verze_z1', :'hlavicka', :'polozky'),
    '23514', 'opravou'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('korekce výdeje jen s právem na opravy (skladník ho nemá)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_korekce_vydeje(%L, %L, %L)', :'z1', 'KOR-1', 'Vrátili dvě piva.'),
    '42501', 'právo na opravy'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_korekce_vydeje(:'z1', 'KOR-1', 'Host vrátil dvě piva, opraveno v pokladně.') as korekce \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('korekce: nová operace (původní zůstává), stav „opraveno"',
  (select druh = 'korekce' and stav = 'rucne_dolozeno' and korekce_pro = :'op3' from public.pos_operace where id = :'korekce')
  and (select stav = 'uspech' from public.pos_operace where id = :'op3')
  and (select stav_skladu = 'opraveno' from public.jine_platby where id = :'z1'));


\echo ''
\echo '== 10. Faktura, oprava, úhrada ==================================='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, mena)
values (:'tenant', :'perla', 'Krok98 účet', 'banka', 'CZK') returning id as ucet \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 160000, 'CZK', '2026-03-20', 'csv_banka') returning id as t_prijem \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 160000, 'CZK', '2026-03-20', 'csv_banka') returning id as t_vydaj \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 160000, 'EUR', '2026-03-20', 'csv_banka') returning id as t_eur \gset
select count(*) as transakci_pred from public.transakce where tenant_id = :'tenant' \gset

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('obsluha fakturu nepropojí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_faktura(%L, %L, %L::jsonb)', :'z1', 'propojit', '{"cislo":"FV-1","zdroj":"externi"}'),
    '42501', 'Fakturu smí'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_faktura(:'z1', 'propojit', '{"cislo":"FV-2026-0042","zdroj":"externi","castka_haleru":140000}'::jsonb);
select pg_temp.check('propojená faktura NENÍ úhrada (úhrada dál neověřená)',
  (select stav_faktury = 'propojena' and faktura_cislo = 'FV-2026-0042' and stav_uhrady = 'neovereno' from public.jine_platby where id = :'z1'));
select pg_temp.check('s propojenou fakturou oprava tržby bez opravného dokladu neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_opravit_trzbu(%L, %s, 130000, %L)', :'z1', :'verze_z1', 'Sleva dodatečně.'),
    '23514', 'opravným dokladem'));
select public.jine_platby_opravit_trzbu(:'z1', :'verze_z1', 130000, 'Dodatečná sleva 100 Kč.', 'DOB-2026-0003') as trzba1b \gset
select pg_temp.check('úhrada z odchozí platby neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 130000)', :'z1', :'t_vydaj'),
    '23514', 'příchozí'));
select pg_temp.check('úhrada v jiné měně neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 130000)', :'z1', :'t_eur'),
    '23514', 'Měna'));
select public.jine_platby_evidovat_uhradu(:'z1', :'t_prijem', 130000);
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('oprava = storno + nový řádek (nahrazuje), historie zůstává; započteno 1 300 Kč',
  (select stav = 'stornovana' and storno_duvod like '%DOB-2026-0003%' from public.ostatni_trzby where id = :'trzba1')
  and (select stav = 'platna' and nahrazuje = :'trzba1' and castka_haleru = 130000 and faktura_cislo = 'FV-2026-0042' from public.ostatni_trzby where id = :'trzba1b')
  and (select sum(castka_haleru) from public.ostatni_trzby where zaznam_id = :'z1' and stav = 'platna' and zapocitat) = 130000);
select pg_temp.check('úhrada = vazba na existující platbu; žádná nová transakce nevznikla',
  (select stav_uhrady = 'uhrazeno' and uhrada_transakce_id = :'t_prijem' from public.jine_platby where id = :'z1')
  and (select count(*) from public.transakce where tenant_id = :'tenant') = :'transakci_pred'::bigint);
select pg_temp.check('historie záznamu nese tržbu, schválení, výdej, korekci, fakturu, opravu a úhradu',
  (select count(distinct udalost) from public.jine_platby_historie where zaznam_id = :'z1'
    and udalost in ('trzba_zapsana', 'vydej_schvalen', 'vydej_uspech', 'vydej_korigovan', 'faktura_propojena', 'trzba_opravena', 'uhrada_evidovana')) = 7);


\echo ''
\echo '== 11. Izolace firem a druhá linie ==============================='

set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma: náhled výdeje = nenalezeno',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_sestavit_vydej(%L)', :'z1'), 'P0002', 'nenalezen'));
select pg_temp.check('cizí firma: úprava návrhu = nenalezeno',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, 1, %L::jsonb, %L::jsonb)', :'z3', :'hlavicka', '[]'), 'P0002', 'nenalezen'));
select pg_temp.check('cizí firma: storno tržby = nenalezeno',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_opravit_trzbu(%L, 1, null, %L)', :'z1', 'Zkouším cizí data.'), 'P0002', 'nenalezen'));
select pg_temp.check('cizí firma nevidí Ostatní tržby, katalog ani historii',
  (select count(*) from public.ostatni_trzby where tenant_id = :'tenant') = 0
  and (select count(*) from public.pos_katalog where tenant_id = :'tenant') = 0
  and (select count(*) from public.jine_platby_historie where tenant_id = :'tenant') = 0);
select pg_temp.check('cizí firma nezaloží záznam v naší firmě',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zalozit(%L, %L, null, %L, gen_random_uuid())', :'tenant', :'perla', 'x'),
    '42501', 'nemáte právo'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('mapování nejde uložit na produkt mimo katalog',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_mapovani(%L, %L, %L)', :'z1', 'pivko', 'NEEXISTUJE'), '23514', 'není'));
select public.jine_platby_ulozit_mapovani(:'z1', 'Pivko 0,5', 'P2');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('ověřený alias uložený malými písmeny',
  (select pos_produkt_id from public.pos_mapovani where pripojeni_id = :'pos' and alias = 'pivko 0,5') = 'P2');

select pg_temp.check('druhá linie: položka s pobočkou jiné než záznamu odmítnuta',
  pg_temp.spadne_hlaskou(format(
    'insert into public.jine_platby_polozky (tenant_id, branch_id, zaznam_id, poradi, nazev, zdroj) values (%L, %L, %L, 99, %L, %L)',
    :'tenant', :'bar', :'z3', 'X', 'rucne'),
    '23514', 'nepatří záznamu'));
select pg_temp.check('druhá linie: záznam s pobočkou cizí firmy odmítnut',
  pg_temp.spadne_hlaskou(format(
    'insert into public.jine_platby (tenant_id, branch_id, klient_id) values (%L, %L, gen_random_uuid())', :'tenant', :'cizi_pobocka'),
    '23514', 'Pobočka nepatří'));
select pg_temp.check('druhá linie: záznam s pokladnou cizí firmy odmítnut',
  pg_temp.spadne_hlaskou(format(
    'insert into public.jine_platby (tenant_id, branch_id, pripojeni_id, klient_id) values (%L, %L, %L, gen_random_uuid())', :'tenant', :'perla', :'cizi_pos'),
    '23514', 'Pokladna nepatří'));
-- Pojistky pro souběh: funkce mají vlastní kontrolu s českou hláškou,
-- ale dva souběžné požadavky by ji oba prošly — rozhoduje unikátní index.
-- Kontroly výš míří na hlášku funkce, tyhle na index (jinak by vyndání
-- jednoho z nich nic neshodilo).
select pg_temp.check('index: stejný otisk souboru podruhé ani přímým zápisem',
  pg_temp.spadne_hlaskou(format(
    'insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk) values (%L, %L, %L, 1, %L, %L, 10, %L)',
    :'tenant', :'perla', :'z2', 'x/y/z/w.jpg', 'image/jpeg', repeat('a', 64)),
    '23505', 'otisk'));
select pg_temp.check('index: tentýž prodej z pokladny nejde mít ve dvou platných Ostatních tržbách',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat, pos_pripojeni_id, pos_prodej_id) values (%L, %L, %L, 100, %L, %L, %L, false, %L, %L)',
    :'tenant', :'perla', '2026-03-14', 'CZK', 'jine_platby', :'z4', :'pos', 'ORDER-777'),
    '23505', 'ostatni_trzby_jedna_na_prodej'));
select pg_temp.check('index: tentýž prodej z pokladny nejde přiřadit dvěma živým záznamům',
  pg_temp.spadne_hlaskou(format('update public.jine_platby set pos_prodej_id = %L where id = %L', 'ORDER-777', :'z4'),
    '23505', 'jine_platby_pos_prodej'));
select pg_temp.check('index: k jednomu návrhu nejde mít dvě živé operace výdeje',
  pg_temp.spadne_hlaskou(format(
    'insert into public.pos_operace (tenant_id, branch_id, pripojeni_id, zaznam_id, navrh_id, druh, idempotencni_klic, stav) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'pos', :'z1', :'navrh2', 'vydej', 'ftjpzkouska-soubeh', 'pripraveno'),
    '23505', 'pos_operace_jedna_ziva'));

select pg_temp.check('druhá linie: tržba s pobočkou cizí firmy odmítnuta',
  pg_temp.spadne_hlaskou(format(
    'insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zapocitat) values (%L, %L, %L, 100, %L, %L, true)',
    :'tenant', :'cizi_pobocka', '2026-03-14', 'CZK', 'jine_platby'),
    '23514', 'Pobočka nepatří'));


\echo ''
\echo '== 12. Opravy z nezávislé kontroly (17. 10.) ====================='

-- Vedoucí Perly: finanční přehled a faktury JEN na Perle (rozsah pobočky).
insert into auth.users (id, email, raw_user_meta_data) values
  ('98980000-0000-0000-0000-000000000006', 'vedouci98@foodtab.cz', '{"full_name":"Vedoucí Devadesátosm"}');
insert into public.positions (tenant_id, key, label, department, active) values
  (:'tenant', 'krok98_vedouci', 'Zkouška 98 — vedoucí', 'vedeni', true) returning id as z_vedouci \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_vedouci', 'finance.read'),
  (:'tenant', :'z_vedouci', 'jine_platby.faktura');
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', '98980000-0000-0000-0000-000000000006', :'z_vedouci', 'Vedoucí Devadesátosm', 'hpp') returning id as e6 \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '98980000-0000-0000-0000-000000000006', null, 'branch', 'active') returning id as m6 \gset
insert into public.membership_branches (membership_id, branch_id) values (:'m6', :'perla');

select jsonb_build_object('datum_prodeje', '2026-03-15', 'oznaceni', 'Ruční odpis', 'mena', 'CZK', 'castka_haleru', 13100,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', null, 'kontakt_id', null)::text as hl5 \gset
select jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '2', 'jednotka', 'ks',
  'cena_jednotkova_haleru', 6500, 'cena_celkem_haleru', 13000, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj',
  'pos_produkt_id', 'P2', 'pos_produkt_nazev', 'Svíčková (podvržený název)', 'pos_mnozstvi', '2', 'mapovani', 'overeno',
  'vyzaduje_kontrolu', false))::text as pol5 \gset

-- 12a. Ruční režim (dnešní Dotykačka): schváleno a předáno k ručnímu odpisu.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Ruční odpis', '98980000-aaaa-0000-0000-000000000005') as z5 \gset
select public.jine_platby_ulozit_navrh(:'z5', 1, :'hl5'::jsonb, :'pol5'::jsonb) as v5 \gset
select pg_temp.check('název produktu se bere z katalogu pokladny, ne z prohlížeče',
  (select pos_produkt_nazev from public.jine_platby_polozky where zaznam_id = :'z5') = 'Pivo 0,5 l');
select pg_temp.check('součet položek (130 Kč) ≠ celkem (131 Kč): bez důvodu „zkontrolováno" neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_oznacit_zkontrolovano(%L, %s)', :'z5', :'v5'), '23514', 'nesedí'));
select public.jine_platby_oznacit_zkontrolovano(:'z5', :'v5', 'Na účtence zaokrouhleno na celou korunu nahoru.');
select public.jine_platby_odeslat_sklad(:'z5', :'v5') as navrh5a \gset
-- Nejasná skladová položka přidaná po odeslání musí návrh zneplatnit.
select public.jine_platby_ulozit_navrh(:'z5', :'v5', :'hl5'::jsonb,
  (:'pol5'::jsonb || jsonb_build_array(jsonb_build_object('nazev', 'Svíčková', 'zdroj', 'rucne', 'druh', 'pokrm', 'mapovani', 'nenamapovano')))) as v5 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('nejasná skladová položka po odeslání: návrh nahrazený, sklad znovu „bez návrhu"',
  (select stav = 'nahrazeno' from public.jine_platby_skladove_navrhy where id = :'navrh5a')
  and (select stav_skladu = 'bez_navrhu' from public.jine_platby where id = :'z5'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z5', :'v5', :'hl5'::jsonb, :'pol5'::jsonb) as v5 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z5', :'v5', 'Na účtence zaokrouhleno na celou korunu nahoru.');
select public.jine_platby_odeslat_sklad(:'z5', :'v5') as navrh5 \gset
select otisk as otisk5 from public.jine_platby_skladove_navrhy where id = :'navrh5' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z5', :'v5', 'sklad', 'neodecteno', 'Ověřeno v pokladně: nic neodepsáno.');
select public.jine_platby_rozhodnout_vydej(:'navrh5', :'otisk5', true) as op5 \gset
reset role;
set role service_role;
select public.pos_operace_dokoncit(:'op5', 'nepodporovano', null, null, null, 'Pokladna zápis přes API neumí — ručně.');
reset role;
select pg_temp.check('pokladna bez zápisu: schválený výdej je „předaný k ručnímu odpisu"',
  (select stav_skladu = 'nepodporovano' from public.jine_platby where id = :'z5'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('během ručního odpisu obsluha nezmění množství (hrozil by druhý odpis)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z5', :'v5', :'hl5',
    jsonb_set(:'pol5'::jsonb, '{0,pos_mnozstvi}', '"3"')::text), '23514', 'předaný k ručnímu provedení'));
select pg_temp.check('během ručního odpisu obsluha nepřidá ani nejasnou skladovou položku (schválení by ji obešlo)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z5', :'v5', :'hl5',
    (:'pol5'::jsonb || jsonb_build_array(jsonb_build_object('nazev', 'Pivo navíc', 'mnozstvi', '3', 'zdroj', 'rucne',
      'druh', 'nezarazeno', 'mapovani', 'nenamapovano')))::text), '23514', 'předaný k ručnímu provedení'));
select pg_temp.check('obsluha schválení zrušit nesmí (jen oprávněná osoba pro výdej)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit_schvaleni(%L, %L)', :'z5', 'Nic se neodepsalo.'), '42501', 'oprávněná osoba'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ani majitel záznam během ručního odpisu nezruší',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'z5', 'Omylem.'), '23514', 'předaný k ručnímu provedení'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('ruční doložení s cizím otiskem (stará stránka) neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z5', repeat('0', 64), 'D-1', 'Odepsáno.'),
    '23514', 'Schválený návrh je jiný'));
-- Druhá linie: nevyřešená položka vložená mimo uložení návrhu.
reset role;
insert into public.jine_platby_polozky (tenant_id, branch_id, zaznam_id, poradi, nazev, zdroj, druh, mapovani)
values (:'tenant', :'perla', :'z5', 99, 'Vložené pivo', 'rucne', 'nezarazeno', 'nenamapovano');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('ruční doložení s nevyřešenou položkou neprojde (neodečetla by se nikdy)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z5', :'otisk5', 'D-1', 'Odepsáno.'),
    '23514', 'nevyřešené položky'));
reset role;
delete from public.jine_platby_polozky where zaznam_id = :'z5' and poradi = 99;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_rucne_dolozit_vydej(:'z5', :'otisk5', 'ODP-2026-0007', 'Odepsáno v Dotykačce způsobem Odpis.');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('ručně doloženo k TOMU návrhu: operace, návrh i záznam',
  (select stav = 'rucne_dolozeno' and externi_doklad = 'ODP-2026-0007' from public.pos_operace where id = :'op5')
  and (select stav = 'provedeno' from public.jine_platby_skladove_navrhy where id = :'navrh5')
  and (select stav_skladu = 'rucne_dolozeno' from public.jine_platby where id = :'z5'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('po výdeji jde záznam uložit, když se mění jen název a označení (otisk = produkt a množství)',
  pg_temp.projde(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z5', :'v5',
    jsonb_set(:'hl5'::jsonb, '{oznaceni}', '"Ruční odpis — host Novák"')::text,
    jsonb_set(:'pol5'::jsonb, '{0,nazev}', '"Pivo točené"')::text)));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('potvrzená spotřeba nese druh položky (pro Foodcost)',
  (select count(*) = 1 and min(druh) = 'rozlevany_napoj' and sum(mnozstvi) = 2
     from public.jine_platby_spotreba(:'tenant', :'perla', '2026-03-15', '2026-03-15')));
reset role;
select set_config('test.user_id', '', false);

-- 12b. Druhý výdej téže sjetiny, zrušení schválení.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Táž sjetina znovu', '98980000-aaaa-0000-0000-000000000006') as z6 \gset
select public.jine_platby_ulozit_navrh(:'z6', 1, :'hl5'::jsonb, :'pol5'::jsonb) as v6 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z6', :'v6', 'Na účtence zaokrouhleno na celou korunu nahoru.');
select public.jine_platby_odeslat_sklad(:'z6', :'v6') as navrh6 \gset
select otisk as otisk6 from public.jine_platby_skladove_navrhy where id = :'navrh6' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z6', :'v6', 'sklad', 'neodecteno', 'Ověřeno v pokladně.');
-- Druhá linie: nejasná skladová položka vložená mimo uložení návrhu (přímo do
-- tabulky) otisk nezmění — schválení ji přesto musí odmítnout.
reset role;
insert into public.jine_platby_polozky (tenant_id, branch_id, zaznam_id, poradi, nazev, zdroj, druh, mapovani)
values (:'tenant', :'perla', :'z6', 99, 'Vložená svíčková', 'rucne', 'pokrm', 'nenamapovano');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('schválení odmítne návrh s nevyřešenou skladovou položkou (i když otisk sedí)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, %L)', :'navrh6', :'otisk6', 'Jiný host.'),
    '23514', 'nevyřešené položky'));
reset role;
delete from public.jine_platby_polozky where zaznam_id = :'z6' and poradi = 99;
set role authenticated;
-- Uložení po odeslání, které výdej nemění (jen jiné označení), návrh nechá —
-- ale záznam už není zkontrolovaný a schválit ho nejde, dokud ho někdo
-- znovu nezkontroluje.
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z6', :'v6', (:'hl5'::jsonb || '{"oznaceni": "Perla — dvě piva (přejmenováno)"}'::jsonb), :'pol5'::jsonb) as v6 \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z6', :'v6', 'sklad', 'neodecteno', 'Ověřeno v pokladně.');
select pg_temp.check('po uložení bez změny výdeje návrh zůstal ke schválení',
  (select stav = 'ceka_na_schvaleni' from public.jine_platby_skladove_navrhy where id = :'navrh6'));
select pg_temp.check('schválení ale čeká na novou kontrolu záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, %L)', :'navrh6', :'otisk6', 'Jiný host.'),
    '23514', 'není zkontrolovaný'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_oznacit_zkontrolovano(:'z6', :'v6', 'Na účtence zaokrouhleno na celou korunu nahoru.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('druhý výdej téže sjetiny (pobočka + den + částka + měna) bez důvodu neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh6', :'otisk6'),
    '23514', 'Možná duplicita výdeje'));
select public.jine_platby_rozhodnout_vydej(:'navrh6', :'otisk6', true, 'Jiný host, stejná objednávka dvou piv.') as op6 \gset
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('schválený výdej: ani majitel záznam nezruší (nejdřív Zrušit schválení)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'z6', 'Omylem.'), '23514', 'Výdej je schválený'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_zrusit_schvaleni(:'z6', 'V pokladně nic neodepsáno, host odešel bez placení.');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušené schválení: sklad „bez návrhu", návrh nahrazený, operace zrušená, důvod duplicity v historii',
  (select stav_skladu = 'bez_navrhu' from public.jine_platby where id = :'z6')
  and (select stav = 'nahrazeno' from public.jine_platby_skladove_navrhy where id = :'navrh6')
  and (select stav = 'zruseno' from public.pos_operace where id = :'op6')
  and exists (select 1 from public.jine_platby_historie where zaznam_id = :'z6' and udalost = 'vydej_schvalen' and detail ->> 'duplicita_duvod' like 'Jiný host%'));

-- 12c. Úhrada z firemního účtu, zrušení s úhradou, fronta a otisk po zrušení.
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, mena)
values (:'tenant', null, 'Krok98 firemní účet', 'banka', 'CZK') returning id as ucet_firma \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 13100, 'CZK', '2026-03-20', 'csv_banka') returning id as t_firma \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z6', '98980000-bbbb-0000-0000-000000000006') as cesta6 \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta6', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
set role service_role;
select public.jine_platby_pripojit_soubor(:'z6', :'cesta6', repeat('f', 64), '98980000-0000-0000-0000-000000000001');
set role authenticated;
select public.jine_platby_odeslat_sklad(:'z6', :'v6') as navrh6b \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000006', false);
select pg_temp.check('vedoucí s finančním přehledem jen na Perle nenapáruje platbu z FIREMNÍHO účtu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 13100)', :'z6', :'t_firma'), '42501', 'nemáte přístup'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_evidovat_uhradu(:'z6', :'t_firma', 13100);
-- Změna částky po napárování úhrady stav úhrady přepočítá.
select verze as v6u from public.jine_platby where id = :'z6' \gset
select public.jine_platby_ulozit_navrh(:'z6', :'v6u', (:'hl5'::jsonb || '{"castka_haleru": 39300}'::jsonb), :'pol5'::jsonb) as v6 \gset
select pg_temp.check('po zvýšení částky nad napárovanou úhradu je stav úhrady „částečně“, ne „uhrazeno“',
  (select stav_uhrady = 'castecne' from public.jine_platby where id = :'z6'));
-- Změna odběratele v podkladech faktury zvedne verzi: otevřený editor
-- návrhu by ho jinak při uložení tiše přepsal.
reset role;
insert into public.kontakty (tenant_id, nazev, je_odberatel) values (:'tenant', 'Krok98 Odběratel s.r.o.', true) returning id as kontakt98 \gset
set role authenticated;
select public.jine_platby_faktura(:'z6', 'podklady', jsonb_build_object('kontakt_id', :'kontakt98', 'podklady', '{}'::jsonb));
select pg_temp.check('změna odběratele v podkladech faktury zvedne verzi (editor se starou verzí neuloží)',
  (select verze = :'v6'::integer + 1 and kontakt_id = :'kontakt98'::uuid from public.jine_platby where id = :'z6')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z6', :'v6', :'hl5', :'pol5'), '40001', ''));
select pg_temp.check('záznam s napárovanou úhradou nejde zrušit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'z6', 'Omylem založeno.'), '23514', 'odpojte úhradu'));
select public.jine_platby_evidovat_uhradu(:'z6', null, null);
select public.jine_platby_zrusit(:'z6', 'Omylem založeno, správný je jiný záznam.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Správný záznam', '98980000-aaaa-0000-0000-000000000007') as z7 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušený záznam: nic nečeká na schválení, soubor zůstal v historii neaktivní',
  (select stav_kontroly = 'zruseno' and stav_skladu = 'bez_navrhu' from public.jine_platby where id = :'z6')
  and (select stav = 'nahrazeno' from public.jine_platby_skladove_navrhy where id = :'navrh6b')
  and (select not aktivni from public.jine_platby_soubory where zaznam_id = :'z6'));
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z7', '98980000-bbbb-0000-0000-000000000007') as cesta7 \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta7', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
set role service_role;
select pg_temp.check('doklad ze zrušeného záznamu jde připojit ke správnému záznamu',
  pg_temp.projde(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'z7', :'cesta7', repeat('f', 64), '98980000-0000-0000-0000-000000000001')));
set role authenticated;

-- 12d. Faktura z pokladny a dvojí tržba.
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('k ZAPSANÉ tržbě nejde propojit fakturu z pokladny (pokladna má tržbu sama)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_faktura(%L, %L, %L::jsonb)', :'z1', 'propojit',
    '{"cislo":"FV-2026-0042","zdroj":"pos"}'), '23514', 'Faktura z pokladny'));
select public.jine_platby_ulozit_navrh(:'z7', 1,
  jsonb_build_object('datum_prodeje', '2026-03-16', 'oznaceni', 'Faktura z pokladny', 'mena', 'CZK', 'castka_haleru', 4000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', null, 'kontakt_id', null), '[]') as v7 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z7', :'v7');
select public.jine_platby_faktura(:'z7', 'propojit', '{"cislo":"POS-INV-1","zdroj":"pos"}'::jsonb);
select public.jine_platby_prohlasit(:'z7', :'v7', 'trzba', 'nenalezeno', 'V denních tržbách to zatím není.');
select pg_temp.check('s fakturou z pokladny nejde zapsat NOVOU Ostatní tržbu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z7', :'v7', 'nova'), '23514', 'faktura z pokladny'));
reset role;
select set_config('test.user_id', '', false);

-- 12e. Katalog a alias pokladny cizí pobočky; id cizí pobočky v hlášce.
set role service_role;
select public.pos_katalog_nahradit(:'pos_bar', jsonb_build_array(jsonb_build_object('externi_id', 'B1', 'nazev', 'Kofola 0,3 l')));
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select public.jine_platby_zalozit(:'tenant', :'bar', :'pos_bar', 'Bar — Kofola', '98980000-aaaa-0000-0000-000000000008') as zb \gset
select pg_temp.check('vedoucí Baru vidí katalog pokladny Baru',
  (select count(*) from public.pos_katalog where pripojeni_id = :'pos_bar') = 1);
select format('%s/%s/%s/%s.jpg', :'tenant', :'bar', :'zb', '98980000-bbbb-0000-0000-000000000008') as cesta_b \gset
reset role;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta_b', '98980000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg","size":2000}');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
set role service_role;
select pg_temp.check('stejná fotka jako na Perle: hláška neprozradí id záznamu jiné pobočky',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'zb', :'cesta_b', repeat('a', 64), '98980000-0000-0000-0000-000000000004'),
    '23505', 'kterou nevidíte')
  and not pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L, %L)', :'zb', :'cesta_b', repeat('a', 64), '98980000-0000-0000-0000-000000000004'),
    '23505', :'z1'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('obsluha Perly katalog pokladny Baru nevidí (svou pokladnu ano)',
  (select count(*) from public.pos_katalog where pripojeni_id = :'pos_bar') = 0
  and (select count(*) from public.pos_katalog where pripojeni_id = :'pos') = 4);
select pg_temp.check('obsluha Perly nezapíše alias pokladně Baru',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_mapovani(%L, %L, %L)', :'zb', 'kofola', 'B1'), 'P0002', 'nenalezen'));

-- 12f. Duplicita podle čísla účtu: bez pokladny jen v téže pobočce a do ±7 dní.
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_zalozit(:'tenant', :'bar', null, 'Bar — stůl 9', '98980000-aaaa-0000-0000-000000000009') as zb2 \gset
select public.jine_platby_ulozit_navrh(:'zb2', 1,
  jsonb_build_object('datum_prodeje', '2026-03-10', 'oznaceni', 'Bar — stůl 9', 'mena', 'CZK', 'castka_haleru', 5000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'Stůl 9', 'kontakt_id', null), '[]') as vb2 \gset
select public.jine_platby_oznacit_zkontrolovano(:'zb2', :'vb2');
select public.jine_platby_prohlasit(:'zb2', :'vb2', 'trzba', 'nenalezeno', 'Ručně psaný účet, v pokladně není.');
select public.jine_platby_potvrdit_trzbu(:'zb2', :'vb2', 'nova');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', null, 'Perla — stůl 9', '98980000-aaaa-0000-0000-00000000000a') as z8 \gset
select public.jine_platby_ulozit_navrh(:'z8', 1,
  jsonb_build_object('datum_prodeje', '2026-03-12', 'oznaceni', 'Perla — stůl 9', 'mena', 'CZK', 'castka_haleru', 7770,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'stůl 9', 'kontakt_id', null), '[]') as v8 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z8', :'v8');
select public.jine_platby_zalozit(:'tenant', :'perla', null, 'Perla — stůl 9 znovu', '98980000-aaaa-0000-0000-00000000000b') as z9 \gset
select public.jine_platby_ulozit_navrh(:'z9', 1,
  jsonb_build_object('datum_prodeje', '2026-03-13', 'oznaceni', 'Perla — stůl 9 znovu', 'mena', 'CZK', 'castka_haleru', 1000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'stůl  9', 'kontakt_id', null), '[]') as v9 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z9', :'v9');
select public.jine_platby_zalozit(:'tenant', :'perla', null, 'Perla — stůl 9 o dva týdny později', '98980000-aaaa-0000-0000-00000000000c') as z10 \gset
select public.jine_platby_ulozit_navrh(:'z10', 1,
  jsonb_build_object('datum_prodeje', '2026-03-25', 'oznaceni', 'Perla — stůl 9 později', 'mena', 'CZK', 'castka_haleru', 2000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'stůl 9', 'kontakt_id', null), '[]') as v10 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z10', :'v10');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'z8', :'v8', 'trzba', 'nenalezeno', 'Ručně psaný účet, v pokladně není.');
select pg_temp.check('stejné číslo účtu bez pokladny na JINÉ pobočce duplicita není (zapíše se bez důvodu)',
  pg_temp.projde(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z8', :'v8', 'nova')));
-- Dodatečná kontrola po zápisu (pozdější import z pokladny): výsledek jde
-- zapsat i k zapsané tržbě, appka podle něj varuje „možná zapsáno dvakrát“.
-- Nic se samo nestornuje — rozhodne člověk.
reset role;
select verze as v1b from public.jine_platby where id = :'z1' \gset
set role service_role;
select pg_temp.check('dodatečná kontrola jde zapsat i k zapsané tržbě',
  pg_temp.projde(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z1', :'v1b', 'trzba', 'nalezeno', '{"doklad": "D-9"}')));
reset role;
select pg_temp.check('po dodatečné kontrole tržba zůstala zapsaná a započtená, výsledek je „nalezeno“',
  (select stav_trzby = 'zapsano' and kontrola_trzby ->> 'vysledek' = 'nalezeno' from public.jine_platby where id = :'z1')
  and exists (select 1 from public.ostatni_trzby where zaznam_id = :'z1' and stav = 'platna' and zapocitat));
select pg_temp.check('kontrolu z pokladny nejde zapsat k záznamu bez pokladny',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z8',
    (select verze from public.jine_platby where id = :'z8'), 'trzba', 'nalezeno', '{}'), '23514', 'neobsluhuje'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'z9', :'v9', 'trzba', 'nenalezeno', 'Ručně psaný účet, v pokladně není.');
select pg_temp.check('stejné číslo účtu (bez mezer) v téže pobočce do 7 dní = možná duplicita s id viditelného záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z9', :'v9', 'nova'), '23514', :'z8'));
select public.jine_platby_prohlasit(:'z10', :'v10', 'trzba', 'nenalezeno', 'Ručně psaný účet, v pokladně není.');
select pg_temp.check('stejné číslo účtu o 13 dní později duplicita není (stoly se opakují)',
  pg_temp.projde(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z10', :'v10', 'nova')));
-- Duplicita výdeje na jiné provozovně téže pokladny (pokladna firmy
-- obsluhuje Perlu i Bar): majitel v hlášce vidí id podobného záznamu,
-- vedoucí Baru se id záznamu Perly nedozví.
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_zalozit(:'tenant', :'bar', :'pos', 'Bar — účet 125', '98980000-aaaa-0000-0000-00000000000d') as z11 \gset
select public.jine_platby_ulozit_navrh(:'z11', 1,
  jsonb_build_object('datum_prodeje', '2026-03-16', 'oznaceni', 'Bar — účet 125', 'mena', 'CZK', 'castka_haleru', 6500,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'účet125', 'kontakt_id', null),
  jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '1', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 6500, 'cena_celkem_haleru', 6500, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj',
    'pos_produkt_id', 'P2', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as v11 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z11', :'v11');
select public.jine_platby_odeslat_sklad(:'z11', :'v11') as navrh11 \gset
select otisk as otisk11 from public.jine_platby_skladove_navrhy where id = :'navrh11' \gset
select public.jine_platby_prohlasit(:'z11', :'v11', 'sklad', 'neodecteno', 'Ověřeno v pokladně.');
select pg_temp.check('duplicita výdeje u téže pokladny napříč provozovnami: majitel vidí id podobného záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh11', :'otisk11'), '23514', :'z1'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru se z hlášky o duplicitě nedozví id záznamu Perly',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh11', :'otisk11'), '23514', 'kterou nevidíte')
  and not pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh11', :'otisk11'), '23514', :'z1'));
reset role;
select set_config('test.user_id', '', false);

-- 12g. Audit položek (každé uložení je smaže a vloží znovu).
select pg_temp.check('položky návrhu mají audit',
  exists (select 1 from public.audit_log where tenant_id = :'tenant' and entity_type = 'jina_platba_polozka'));


-- ---------------------------------------------------------------------
-- 13. Opravy z druhé nezávislé kontroly (19. 10.)
-- ---------------------------------------------------------------------
reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== 13. Druhá kontrola 19. 10. ====================================='

-- 13a. Pokladna bez katalogu: přiřazení ani výdej nejdou ověřit. Pokladna,
-- jejíž provozovnu v Integracích přeřadili jiné pobočce, nesmí dál sloužit
-- kontrole ani výdeji.
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', 'pokladna', 'krok98bez', 'zakaznicky', 'pripojeno',
  jsonb_build_object('provozovny', jsonb_build_array(
    jsonb_build_object('id', '31', 'nazev', 'Bar bez katalogu', 'branch_id', :'bar'),
    jsonb_build_object('id', '32', 'nazev', 'Perla bez katalogu', 'branch_id', :'perla'))))
returning id as pos_bez \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_zalozit(:'tenant', :'bar', :'pos_bez', 'Bar — pokladna bez katalogu', '98980000-aaaa-0000-0000-00000000000e') as z12 \gset
select public.jine_platby_ulozit_navrh(:'z12', 1,
  jsonb_build_object('datum_prodeje', '2026-03-18', 'oznaceni', 'Bar bez katalogu', 'mena', 'CZK', 'castka_haleru', 13000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', null, 'kontakt_id', null),
  jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '2', 'jednotka', 'ks',
    'cena_jednotkova_haleru', 6500, 'cena_celkem_haleru', 13000, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj',
    'pos_produkt_id', 'DRAHA-LAHEV', 'pos_produkt_nazev', 'Pivo 0,5 l', 'pos_mnozstvi', '2', 'mapovani', 'overeno',
    'vyzaduje_kontrolu', false))) as v12 \gset
select pg_temp.check('pokladna bez katalogu: výdej s produktem z prohlížeče je blokovaný (přiřazení nejde ověřit)',
  (select exists (select 1 from jsonb_array_elements(v -> 'blokace') b
                   where b ->> 'poradi' = '1' and b ->> 'duvod' like 'Produkt v katalogu pokladny není%')
          and not exists (select 1 from jsonb_array_elements(v -> 'blokace') b where b ->> 'duvod' like '%neobsluhuje%')
     from (select public.jine_platby_sestavit_vydej(:'z12') as v) x));
select pg_temp.check('pokladna bez katalogu: ověřený alias nejde uložit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_mapovani(%L, %L, %L)', :'z12', 'pivo 0,5 l', 'DRAHA-LAHEV'),
    '23514', 'Katalog pokladny není načtený'));
-- Přeřazení provozoven v Integracích: 31 teď patří Perle, Baru 32.
reset role;
update public.integrace_pripojeni
   set externi_ucet = jsonb_build_object('provozovny', jsonb_build_array(
         jsonb_build_object('id', '31', 'nazev', 'Teď Perla', 'branch_id', :'perla'),
         jsonb_build_object('id', '32', 'nazev', 'Teď Bar', 'branch_id', :'bar')))
 where id = :'pos_bez';
select pg_temp.check('po přeřazení provozovny: výdej přes pokladnu záznamu je blokovaný (provozovna patří jiné pobočce)',
  (select exists (select 1 from jsonb_array_elements(v -> 'blokace') b where b ->> 'poradi' is null and b ->> 'duvod' like '%neobsluhuje%')
     from (select app.jp_sestavit_vydej(:'z12') as v) x));
set role service_role;
select pg_temp.check('po přeřazení provozovny: kontrolu z pokladny nejde zapsat (prohledala by cizí pobočku)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z12', :'v12', 'trzba', 'nenalezeno', '{}'),
    '23514', 'neobsluhuje'));
reset role;

-- 13b. Ruční prohlášení nepřepíše opačný výsledek z pokladny (z1 má od 12f
-- výsledek z pokladny „nalezeno“ k aktuální verzi).
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('pokladní ručním „není“ nepřepíše „nalezeno“ z pokladny',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z1', :'v1b', 'trzba', 'nenalezeno', 'Není tam.'),
    '23514', 'Pokladna při kontrole tohle našla'));
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z1', :'v1b', 'sklad', 'jiz_odecteno', '{}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník ručním „neodečteno“ nepřepíše „už odečteno“ z pokladny',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z1', :'v1b', 'sklad', 'neodecteno', 'Nic tam není.'),
    '23514', 'Pokladna při kontrole tohle našla'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_prohlasit(:'z1', :'v1b', 'trzba', 'nenalezeno', 'Ověřeno osobně: v pokladně je jiný účet.', null, true);
reset role;
select pg_temp.check('s právem na opravy jde výsledek z pokladny přepsat a historie to nese',
  exists (select 1 from public.jine_platby_historie
           where zaznam_id = :'z1' and udalost = 'rucne_dolozeno_trzba' and detail ->> 'prepsano_pokladny' = 'nalezeno'));

-- 13c. Úhrada: ne na zrušený záznam; ne platbou spárovanou s fakturou; ne stornem.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('úhradu nejde napárovat na zrušený záznam',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 13100)', :'z6', :'t_firma'), '23514', 'zrušený'));
reset role;
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 6500, 'CZK', '2026-03-21', 'csv_banka') returning id as t_faktura \gset
insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, potvrzeno_kdy)
values (:'tenant', :'t_faktura', 'FV-KROK98-1', 6500, 'potvrzeno', now());
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 6500, 'CZK', '2026-03-22', 'csv_banka') returning id as t_storno \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj, storno_of)
values (:'tenant', :'ucet_firma', 'vydaj', 6500, 'CZK', '2026-03-23', 'csv_banka', :'t_storno');
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 6500, 'CZK', '2026-03-24', 'csv_banka') returning id as t_volna \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('platba celá spárovaná s fakturou nezaplatí i Jinou platbu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 6500)', :'z11', :'t_faktura'), '23514', 'nebo fakturám'));
select pg_temp.check('stornovaná platba úhradu neprokazuje',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 6500)', :'z11', :'t_storno'), '23514', 'stornovaná'));
select pg_temp.check('volná nestornovaná platba se napáruje (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_evidovat_uhradu(%L, %L, 6500)', :'z11', :'t_volna')));
reset role;

-- 13d. „Jen propojit“ bez konkrétního prodeje v pokladně chce důvod.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — catering 450 Kč', '98980000-aaaa-0000-0000-00000000000f') as z13 \gset
select public.jine_platby_ulozit_navrh(:'z13', 1,
  jsonb_build_object('datum_prodeje', '2026-03-24', 'oznaceni', 'Catering', 'mena', 'CZK', 'castka_haleru', 45000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', 'Účet 77', 'kontakt_id', null), '[]') as v13 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z13', :'v13');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z13', :'v13', 'trzba', 'pravdepodobne', '{"shoda": "castka"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('„jen propojit“ při shodě jen částky bez důvodu neprojde (tržba by zmizela ze všech součtů)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z13', :'v13', 'propojit'),
    '23514', 'Propojit jde jen s důvodem'));
select public.jine_platby_potvrdit_trzbu(:'z13', :'v13', 'propojit', null, 'Obsluha účet 77 v pokladně viděla, číslo dokladu chybí.');
reset role;
select pg_temp.check('propojeno s důvodem: nezapočítáno a důvod v historii',
  (select stav_trzby = 'propojeno' from public.jine_platby where id = :'z13')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z13' and udalost = 'trzba_propojena' and detail ->> 'duvod_propojeni' like 'Obsluha účet 77%'));

-- 13e. Součet z množství × ceny; číslo účtu i mezi záznamem s pokladnou a bez ní.
select jsonb_build_object('datum_prodeje', '2026-03-25', 'oznaceni', 'Catering znovu', 'mena', 'CZK', 'castka_haleru', 48000,
  'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', 'účet 77', 'kontakt_id', null)::text as hl14 \gset
select jsonb_build_array(
  jsonb_build_object('nazev', 'Chlebíček', 'mnozstvi', '10', 'jednotka', 'ks', 'cena_jednotkova_haleru', 3500,
    'zdroj', 'rucne', 'druh', 'neskladova', 'mapovani', 'nenamapovano', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Káva', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 5000,
    'zdroj', 'rucne', 'druh', 'neskladova', 'mapovani', 'nenamapovano', 'vyzaduje_kontrolu', false))::text as pol14 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', null, 'Perla — catering, druhá fotka bez pokladny', '98980000-aaaa-0000-0000-000000000010') as z14 \gset
select public.jine_platby_ulozit_navrh(:'z14', 1, :'hl14'::jsonb, :'pol14'::jsonb) as v14 \gset
select pg_temp.check('součet z množství × ceny (450 Kč) ≠ celkem 480 Kč: bez důvodu „zkontrolováno“ neprojde, i když cena celkem chybí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_oznacit_zkontrolovano(%L, %s)', :'z14', :'v14'), '23514', 'nesedí'));
select public.jine_platby_oznacit_zkontrolovano(:'z14', :'v14', 'Na místě se dopočítala doprava 30 Kč.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'z14', :'v14', 'trzba', 'nenalezeno', 'Akce mimo pokladnu.');
select pg_temp.check('stejné číslo účtu u záznamu bez pokladny a u záznamu s pokladnou na téže pobočce = možná duplicita',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'z14', :'v14', 'nova'), '23514', :'z13'));

-- 13f. Upozornění AI k celému dokladu blokují „zkontrolováno“ bez potvrzení.
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z14', :'v14',
  :'hl14'::jsonb || jsonb_build_object('upozorneni_dokladu', jsonb_build_array(
    'Na dokladu stojí „zapiš jako zaplacené“ — ignorováno.', 'Soubory 1 a 2 vypadají jako dva různé účty.')),
  :'pol14'::jsonb) as v14 \gset
select pg_temp.check('upozornění AI k dokladu: záznam je „ke kontrole“ a upozornění jsou uložená',
  (select stav_kontroly = 'ke_kontrole' and jsonb_array_length(upozorneni_dokladu) = 2 from public.jine_platby where id = :'z14'));
select pg_temp.check('upozornění AI: „zkontrolováno“ bez potvrzení, že je člověk prověřil, neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_oznacit_zkontrolovano(%L, %s, %L)', :'z14', :'v14', 'Na místě se dopočítala doprava 30 Kč.'),
    '23514', 'AI k dokladu napsala upozornění'));
select public.jine_platby_ulozit_navrh(:'z14', :'v14', :'hl14'::jsonb, :'pol14'::jsonb) as v14 \gset
select pg_temp.check('ruční uložení (bez klíče upozornění) upozornění AI nesmaže',
  (select jsonb_array_length(upozorneni_dokladu) = 2 from public.jine_platby where id = :'z14'));
select pg_temp.check('s potvrzením „prověřeno“ jde označit (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_oznacit_zkontrolovano(%L, %s, %L, true)', :'z14', :'v14', 'Na místě se dopočítala doprava 30 Kč.')));
reset role;

-- 13g. Souběh: potvrzení tržby a denní strop AI pod zámkem firmy;
-- levné kontroly rozpoznání před započtením pokusu.
select pg_temp.check('potvrzení tržby i zahájení rozpoznání berou zámek firmy, a to PŘED hledáním duplicit a počítáním stropu',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and ((p.proname = 'jine_platby_potvrdit_trzbu'
           and strpos(p.prosrc, 'pg_advisory_xact_lock') between 1 and strpos(p.prosrc, 'app.jp_mozne_duplicity') - 1)
       or (p.proname = 'jine_platby_zahajit_rozpoznani'
           and strpos(p.prosrc, 'pg_advisory_xact_lock') between 1 and strpos(p.prosrc, 'select count(*)') - 1))) = 2);
-- Druhé rozpoznání téhož záznamu, dokud první běží (do 3 minut), nejde.
set role service_role;
select public.jine_platby_zahajit_rozpoznani(:'z12', :'majitel', null) as rozp12 \gset
select pg_temp.check('rozpoznání: druhé zahájení, dokud první běží, neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, null)', :'z12', :'majitel'), '23514', 'už běží'));
reset role;
update public.jine_platby_rozpoznani set vytvoreno = now() - interval '4 minutes' where id = :'rozp12';
set role service_role;
select pg_temp.check('rozpoznání: pokus starší než 3 minuty zahájení nebrání (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, null)', :'z12', :'majitel')));
reset role;
insert into public.jine_platby_rozpoznani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav)
select :'tenant', :'bar', :'z11', 1, 'chyba'
  from generate_series(1, 199 - (select count(*)::integer from public.jine_platby_rozpoznani
                                  where tenant_id = :'tenant'
                                    and vytvoreno >= (date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague')));
set role service_role;
select pg_temp.check('rozpoznání: stará verze formuláře se odmítne dřív, než se pokus započítá',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, 999)', :'z11', :'majitel'), '40001', 'mezitím upravil'));
select pg_temp.check('rozpoznání: provedený výdej se znovu nečte (uložení by spadlo až po zaplaceném čtení)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, null)', :'z1', :'majitel'), '23514', 'Výdej je schválený nebo provedený'));
select pg_temp.check('rozpoznání: propojená tržba čtení nebrání — dvoustý pokus dne projde',
  pg_temp.projde(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, null)', :'z13', :'majitel')));
select pg_temp.check('rozpoznání: dvoustý první pokus už ne (strop 200 za firmu)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zahajit_rozpoznani(%L, %L, null)', :'z14', :'majitel'), '23514', 'strop'));
reset role;

-- 13h. Druhá linie: vazby, které funkce berou z řádků, hlídá i spoušť.
select pg_temp.check('druhá linie: operace s návrhem jiného záznamu neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.pos_operace (tenant_id, branch_id, zaznam_id, navrh_id, druh, idempotencni_klic) values (%L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'z1', :'navrh6', 'vydej', 'krok98-cizi-navrh-1'), '23514', 'Návrh nepatří'));
select pg_temp.check('druhá linie: operace s pokladnou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.pos_operace (tenant_id, branch_id, zaznam_id, pripojeni_id, druh, idempotencni_klic) values (%L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'z1', :'cizi_pos', 'vydej', 'krok98-cizi-pokl-1'), '23514', 'Pokladna nepatří'));
select pg_temp.check('druhá linie: korekce operace jiného záznamu neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.pos_operace (tenant_id, branch_id, zaznam_id, korekce_pro, druh, idempotencni_klic) values (%L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'z1', :'op6', 'korekce', 'krok98-cizi-kor-1'), '23514', 'Opravovaná operace'));
select pg_temp.check('druhá linie: tržba nahrazující tržbu jiného záznamu neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat, nahrazuje) values (%L, %L, %L, 100, %L, %L, %L, false, (select id from public.ostatni_trzby where zaznam_id = %L limit 1))',
    :'tenant', :'perla', '2026-03-20', 'CZK', 'jine_platby', :'z14', :'z13'), '23514', 'Nahrazovaná tržba'));
insert into public.kontakty (tenant_id, nazev) values (:'tenant_b', 'Krok98 cizí odběratel') returning id as kontakt_cizi \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, mena) values (:'tenant_b', null, 'Krok98 cizí účet', 'banka', 'CZK') returning id as ucet_cizi \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant_b', :'ucet_cizi', 'prijem', 100, 'CZK', '2026-03-20', 'csv_banka') returning id as t_cizi \gset
select pg_temp.check('druhá linie: záznam s kontaktem cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('update public.jine_platby set kontakt_id = %L where id = %L', :'kontakt_cizi', :'z13'), '23514', 'Kontakt nepatří'));
select pg_temp.check('druhá linie: záznam s platbou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('update public.jine_platby set uhrada_transakce_id = %L, uhrada_castka_haleru = 100, stav_uhrady = %L where id = %L',
    :'t_cizi', 'castecne', :'z13'), '23514', 'Platba nepatří'));
select pg_temp.check('druhá linie: katalog s pokladnou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.pos_katalog (tenant_id, pripojeni_id, externi_id, nazev) values (%L, %L, %L, %L)',
    :'tenant', :'cizi_pos', 'X', 'X'), '23514', 'Pokladna nepatří'));
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel nenapáruje platbu cizí firmy a z hlášky se nedozví nic o její částce',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 200)', :'z13', :'t_cizi'), '23514', 'Platba nepatří této firmě'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('skladník (bez práva zadat/upravit) nenahraje doklad ani do cesty své pobočky',
  pg_temp.spadne_hlaskou(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'jine-platby', format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z13', '98980000-bbbb-0000-0000-00000000000d'),
    '98980000-0000-0000-0000-000000000003', '{"mimetype":"image/jpeg","size":10}'), '42501', 'row-level security'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('obsluha (právo zadat) do cesty své pobočky nahraje (kontrola rozezná oba stavy)',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'jine-platby', format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z13', '98980000-bbbb-0000-0000-00000000000e'),
    '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":10}')));

-- 13i. Pokrm a další zboží v jednom výdeji: varování pro schvalovatele.
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('pokrm s pivem ani samotné pivo varování „surovina“ nemají (pivo surovinou pokrmu není)',
  (select jsonb_array_length(v -> 'varovani') = 0 from (select public.jine_platby_sestavit_vydej(:'z1') as v) x)
  and (select jsonb_array_length(v -> 'varovani') = 0 from (select public.jine_platby_sestavit_vydej(:'z11') as v) x));
reset role;
select set_config('test.user_id', '', false);

-- ---------------------------------------------------------------------
-- 14. Opravy po ověření oprav (20. 10.)
-- ---------------------------------------------------------------------
reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== 14. Ověření oprav 20. 10. ======================================'

-- 14a. Výsledek z pokladny nepřepíše ruční prohlášení ani po uložení návrhu
-- beze změny (verze se zvedne); „pravděpodobně“ jde přepsat s potvrzením.
select jsonb_build_object('datum_prodeje', '2026-03-29', 'oznaceni', 'Perla — účet 555', 'mena', 'CZK', 'castka_haleru', 55500,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'ORDER-555', 'kontakt_id', null)::text as hl17 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet 555', '98980000-aaaa-0000-0000-000000000011') as z17 \gset
select public.jine_platby_ulozit_navrh(:'z17', 1, :'hl17'::jsonb, '[]') as v17 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z17', :'v17');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z17', :'v17', 'trzba', 'nalezeno', '{"pos_prodej_id": "ORDER-555"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z17', :'v17', :'hl17'::jsonb, '[]') as v17 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z17', :'v17');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('po uložení beze změny (nová verze) ruční „není“ pořád nepřepíše „nalezeno“ z pokladny',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z17', :'v17', 'trzba', 'nenalezeno', 'Není tam.'),
    '23514', 'Pokladna při kontrole tohle našla'));
select pg_temp.check('ani s potvrzením nepřepíše konkrétní prodej z pokladny ten, kdo nemá právo na opravy',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L, null, true)', :'z17', :'v17', 'trzba', 'nenalezeno', 'Není tam.'),
    '23514', 'konkrétní prodej nebo odpis'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_prohlasit(:'z17', :'v17', 'trzba', 'nenalezeno', 'V pokladně je ORDER-555 jiný host, ověřeno osobně.', null, true);
reset role;
select pg_temp.check('přepsaný výsledek z pokladny je celý v historii (i id prodeje)',
  exists (select 1 from public.jine_platby_historie
           where zaznam_id = :'z17' and udalost = 'rucne_dolozeno_trzba'
             and detail -> 'prepsany_vysledek' ->> 'zdroj' = 'pos_api'
             and detail -> 'prepsany_vysledek' -> 'detail' ->> 'pos_prodej_id' = 'ORDER-555'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — catering, shoda jen částky', '98980000-aaaa-0000-0000-000000000012') as z18 \gset
select public.jine_platby_ulozit_navrh(:'z18', 1,
  jsonb_build_object('datum_prodeje', '2026-03-30', 'oznaceni', 'Catering 2', 'mena', 'CZK', 'castka_haleru', 45000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null), '[]') as v18 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z18', :'v18');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z18', :'v18', 'trzba', 'pravdepodobne', '{"shoda": "castka"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('„pravděpodobně“ (shoda jen částky): ruční „není“ bez potvrzení neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z18', :'v18', 'trzba', 'nenalezeno', 'Catering mimo pokladnu.'),
    '23514', 'Pokladna při kontrole tohle našla'));
select pg_temp.check('„pravděpodobně“: s výslovným potvrzením „prodej v pokladně je jiný“ projde i bez práva na opravy',
  pg_temp.projde(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L, null, true)', :'z18', :'v18', 'trzba', 'nenalezeno', 'Catering mimo pokladnu, v pokladně je jiný účet na 450 Kč.')));
reset role;

-- 14b. Párování s fakturou počítá i Jiné platby (t_volna je celá u z11).
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('platba celá napárovaná na Jinou platbu nejde potvrdit k faktuře (opačný směr)',
  pg_temp.spadne_hlaskou(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 6500, 6500)', :'tenant', :'t_volna', 'FV-KROK98-2'),
    '23514', 'přesahuje částku platby'));
reset role;
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 6500, 'CZK', '2026-03-25', 'csv_banka') returning id as t_volna2 \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_evidovat_uhradu(:'z14', :'t_volna2', 3000);
select pg_temp.check('zbytek platby po Jiné platbě jde k faktuře potvrdit (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 3500, 3500)', :'tenant', :'t_volna2', 'FV-KROK98-3')));
select pg_temp.check('… ale ani haléř navíc ne',
  pg_temp.spadne_hlaskou(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 1, 1)', :'tenant', :'t_volna2', 'FV-KROK98-4'),
    '23514', 'přesahuje částku platby'));
reset role;

-- 14c. Sjetina a neurčený doklad: „v pokladně není“ z dotazu nejde zapsat.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — sjetina stolu 5', '98980000-aaaa-0000-0000-000000000013') as z19 \gset
select public.jine_platby_ulozit_navrh(:'z19', 1,
  jsonb_build_object('datum_prodeje', '2026-03-31', 'oznaceni', 'Sjetina stolu 5', 'mena', 'CZK', 'castka_haleru', 112000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'informativni_sjetina', 'externi_ucet', '5', 'kontakt_id', null), '[]') as v19 \gset
reset role;
set role service_role;
select pg_temp.check('sjetina: „nenalezeno“ z dotazu do pokladny nejde zapsat (může jít o tentýž účet pod jiným číslem)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z19', :'v19', 'trzba', 'nenalezeno', '{}'),
    '23514', 'neprokáže'));
select pg_temp.check('sjetina: „neodečteno“ z dotazu do pokladny taky ne',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z19', :'v19', 'sklad', 'neodecteno', '{}'),
    '23514', 'neprokáže'));
select pg_temp.check('sjetina: „nelze ověřit“ zapsat jde (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z19', :'v19', 'trzba', 'nelze_overit', '{}')));
reset role;

-- 14d. Pokrm a kusové zboží v jednom výdeji: schválení chce výslovné potvrzení.
-- Nejasný výsledek z pokladny: po platnosti jde schválení zrušit nebo výdej doložit.
select jsonb_build_array(
  jsonb_build_object('nazev', 'Svíčková', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 10000, 'cena_celkem_haleru', 20000,
    'zdroj', 'rucne', 'druh', 'pokrm', 'pos_produkt_id', 'P1', 'pos_mnozstvi', '2', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false),
  jsonb_build_object('nazev', 'Smetana', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 10000, 'cena_celkem_haleru', 10000,
    'zdroj', 'rucne', 'druh', 'kusove_zbozi', 'pos_produkt_id', 'P4', 'pos_mnozstvi', '1', 'mapovani', 'overeno', 'vyzaduje_kontrolu', false))::text as pol16 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — kuchyň, svíčková a smetana', '98980000-aaaa-0000-0000-000000000014') as z16 \gset
select public.jine_platby_ulozit_navrh(:'z16', 1,
  jsonb_build_object('datum_prodeje', '2026-03-28', 'oznaceni', 'Kuchyň', 'mena', 'CZK', 'castka_haleru', 30000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null), :'pol16'::jsonb) as v16 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z16', :'v16');
select public.jine_platby_odeslat_sklad(:'z16', :'v16') as navrh16 \gset
select otisk as otisk16 from public.jine_platby_skladove_navrhy where id = :'navrh16' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z16', :'v16', 'sklad', 'neodecteno', 'Ověřeno v pokladně.');
select pg_temp.check('pokrm a kusové zboží ve výdeji: varování (pivo s pokrmem ho nemá)',
  (select jsonb_array_length(v -> 'varovani') = 1 and v -> 'varovani' ->> 0 like '%pokrm i kusové zboží%'
     from (select public.jine_platby_sestavit_vydej(:'z16') as v) x));
select pg_temp.check('pokrm a kusové zboží: schválení bez potvrzení, že zboží není surovina, neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh16', :'otisk16'), '23514', 'surovina'));
select public.jine_platby_rozhodnout_vydej(:'navrh16', :'otisk16', true, null, true) as op16 \gset
reset role;
select pg_temp.check('s potvrzením projde a historie potvrzení nese',
  exists (select 1 from public.jine_platby_historie where zaznam_id = :'z16' and udalost = 'vydej_schvalen' and (detail ->> 'bez_surovin_potvrzeno')::boolean));
set role service_role;
select public.pos_operace_zahajit(:'op16', now() + interval '10 minutes');
select public.pos_operace_dokoncit(:'op16', 'nejasny_vysledek', null, null, null, 'Timeout po 20 s.');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('nejasný výsledek v platnosti: schválení zrušit nejde (pokladna může požadavek ještě provést)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit_schvaleni(%L, %L)', :'z16', 'Nic se neodepsalo.'), '23514', 'až po vypršení'));
select pg_temp.check('nejasný výsledek v platnosti: ručně doložit nejde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z16', :'otisk16', 'D-16', 'Odepsáno.'), '23514', 'až po vypršení'));
reset role;
update public.pos_operace set platnost_do = now() - interval '5 minutes' where id = :'op16';
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_zrusit_schvaleni(:'z16', 'Po platnosti ověřeno v pokladně: požadavek neproběhl, nic neodepsáno.');
reset role;
select pg_temp.check('po platnosti nejasného výsledku jde schválení zrušit: operace zrušená, sklad „bez návrhu“',
  (select stav_skladu = 'bez_navrhu' from public.jine_platby where id = :'z16')
  and (select stav = 'zruseno' from public.pos_operace where id = :'op16'));
-- Doložení po platnosti, a to i když mezitím pokladna produkt zrušila (katalog).
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — pivo k odpisu', '98980000-aaaa-0000-0000-000000000015') as z15 \gset
select public.jine_platby_ulozit_navrh(:'z15', 1,
  jsonb_build_object('datum_prodeje', '2026-03-27', 'oznaceni', 'Pivo k odpisu', 'mena', 'CZK', 'castka_haleru', 6500,
    'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null),
  jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 6500,
    'cena_celkem_haleru', 6500, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'P2', 'pos_mnozstvi', '1',
    'mapovani', 'overeno', 'vyzaduje_kontrolu', false))) as v15 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z15', :'v15');
select public.jine_platby_odeslat_sklad(:'z15', :'v15') as navrh15 \gset
select otisk as otisk15 from public.jine_platby_skladove_navrhy where id = :'navrh15' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z15', :'v15', 'sklad', 'neodecteno', 'Ověřeno v pokladně.');
select public.jine_platby_rozhodnout_vydej(:'navrh15', :'otisk15', true) as op15 \gset
reset role;
set role service_role;
select public.pos_operace_zahajit(:'op15', now() + interval '10 minutes');
select public.pos_operace_dokoncit(:'op15', 'nejasny_vysledek', null, null, null, 'Timeout po 20 s.');
reset role;
update public.pos_operace set platnost_do = now() - interval '5 minutes' where id = :'op15';
update public.pos_katalog set smazano = true where pripojeni_id = :'pos' and externi_id = 'P2';
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('po platnosti nejasného výsledku jde ručně doložit — i když mezitím pokladna produkt zrušila (katalog)',
  pg_temp.projde(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z15', :'otisk15', 'ODP-15',
    'Po platnosti ověřeno v pokladně: odpis proběhl.')));
reset role;
update public.pos_katalog set smazano = false where pripojeni_id = :'pos' and externi_id = 'P2';
select pg_temp.check('ručně doloženo: operace i záznam „ručně doloženo“',
  (select stav = 'rucne_dolozeno' from public.pos_operace where id = :'op15')
  and (select stav_skladu = 'rucne_dolozeno' from public.jine_platby where id = :'z15'));

-- 14e. Panel „Částky na dokladu“: návrh si pamatuje rozpoznání, ze kterého je.
insert into public.jine_platby_rozpoznani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav)
values (:'tenant', :'perla', :'z19', :'v19', 'ok') returning id as rozp19 \gset
insert into public.jine_platby_rozpoznani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav)
values (:'tenant', :'perla', :'z19', :'v19', 'chyba') returning id as rozp19chyba \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('uložení návrhu nepřijme neúspěšné rozpoznání ani rozpoznání jiného záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z19', :'v19',
    jsonb_build_object('datum_prodeje', '2026-03-31', 'oznaceni', 'Sjetina stolu 5', 'mena', 'CZK', 'castka_haleru', 112000,
      'castka_puvod', 'doklad', 'typ_dokladu', 'informativni_sjetina', 'externi_ucet', '5', 'kontakt_id', null, 'rozpoznani_id', :'rozp19chyba'), '[]'),
    '23514', 'Rozpoznání nepatří')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z18', :'v18',
    jsonb_build_object('datum_prodeje', '2026-03-30', 'oznaceni', 'Catering 2', 'mena', 'CZK', 'castka_haleru', 45000,
      'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null, 'rozpoznani_id', :'rozp19'), '[]'),
    '23514', 'Rozpoznání nepatří'));
select public.jine_platby_ulozit_navrh(:'z19', :'v19',
  jsonb_build_object('datum_prodeje', '2026-03-31', 'oznaceni', 'Sjetina stolu 5', 'mena', 'CZK', 'castka_haleru', 112000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'informativni_sjetina', 'externi_ucet', '5', 'kontakt_id', null, 'rozpoznani_id', :'rozp19'),
  '[]') as v19 \gset
select public.jine_platby_ulozit_navrh(:'z19', :'v19',
  jsonb_build_object('datum_prodeje', '2026-03-31', 'oznaceni', 'Sjetina stolu 5 (ručně)', 'mena', 'CZK', 'castka_haleru', 112000,
    'castka_puvod', 'doklad', 'typ_dokladu', 'informativni_sjetina', 'externi_ucet', '5', 'kontakt_id', null),
  '[]') as v19 \gset
reset role;
select pg_temp.check('návrh si pamatuje úspěšné rozpoznání a ruční uložení vazbu nechá',
  (select rozpoznani_id = :'rozp19'::uuid from public.jine_platby where id = :'z19'));

-- 14f. Druhá linie: další spouště a filtry cizí firmy.
select pg_temp.check('druhá linie: alias s pokladnou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.pos_mapovani (tenant_id, pripojeni_id, alias, pos_produkt_id) values (%L, %L, %L, %L)',
    :'tenant', :'cizi_pos', 'x', 'X'), '23514', 'Pokladna nepatří'));
select pg_temp.check('druhá linie: tržba se záznamem jiné pobočky neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat) values (%L, %L, %L, 100, %L, %L, %L, true)',
    :'tenant', :'perla', '2026-03-20', 'CZK', 'jine_platby', :'z11'), '23514', 'Tržba nepatří záznamu'));
select pg_temp.check('druhá linie: tržba s pokladnou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format('insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat, pos_pripojeni_id) values (%L, %L, %L, 100, %L, %L, %L, false, %L)',
    :'tenant', :'perla', '2026-03-20', 'CZK', 'jine_platby', :'z18', :'cizi_pos'), '23514', 'Pokladna nepatří'));
select pg_temp.check('druhá linie: soubor, historie, rozpoznání, návrh i operace se záznamem jiné pobočky neprojdou',
  pg_temp.spadne_hlaskou(format('insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk) values (%L, %L, %L, 1, %L, %L, 10, %L)',
      :'tenant', :'perla', :'z11', 'krok98/dite.jpg', 'image/jpeg', repeat('c', 64)), '23514', 'nepatří záznamu')
  and pg_temp.spadne_hlaskou(format('insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, udalost, detail) values (%L, %L, %L, %L, %L::jsonb)',
      :'tenant', :'perla', :'z11', 'x', '{}'), '23514', 'nepatří záznamu')
  and pg_temp.spadne_hlaskou(format('insert into public.jine_platby_rozpoznani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav) values (%L, %L, %L, 1, %L)',
      :'tenant', :'perla', :'z11', 'chyba'), '23514', 'nepatří záznamu')
  and pg_temp.spadne_hlaskou(format('insert into public.jine_platby_skladove_navrhy (tenant_id, branch_id, zaznam_id, verze_zaznamu, obsah, otisk, stav) values (%L, %L, %L, 1, %L::jsonb, %L, %L)',
      :'tenant', :'perla', :'z11', '{}', repeat('d', 64), 'ceka_na_schvaleni'), '23514', 'nepatří záznamu')
  and pg_temp.spadne_hlaskou(format('insert into public.pos_operace (tenant_id, branch_id, zaznam_id, druh, idempotencni_klic) values (%L, %L, %L, %L, %L)',
      :'tenant', :'perla', :'z11', 'vydej', 'krok98-dite-op-1'), '23514', 'nepatří záznamu'));
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('uložení návrhu s odběratelem cizí firmy: hláška funkce (ne až spoušť)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_ulozit_navrh(%L, %s, %L::jsonb, %L::jsonb)', :'z18',
    (select verze from public.jine_platby where id = :'z18'),
    jsonb_build_object('datum_prodeje', '2026-03-30', 'oznaceni', 'Catering 2', 'mena', 'CZK', 'castka_haleru', 45000,
      'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', :'kontakt_cizi'), '[]'),
    '23514', 'Odběratel nepatří této firmě'));
reset role;
select set_config('test.user_id', '', false);

-- ---------------------------------------------------------------------
-- 15. Druhé ověření oprav (20. 10.)
-- ---------------------------------------------------------------------
reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== 15. Druhé ověření 20. 10. ======================================'

-- 15a. Výsledek pokladny nejde „vyprat“ ručním prohlášením stejného znění.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet 777', '98980000-aaaa-0000-0000-000000000016') as z20 \gset
select public.jine_platby_ulozit_navrh(:'z20', 1,
  jsonb_build_object('datum_prodeje', '2026-04-01', 'oznaceni', 'Účet 777', 'mena', 'CZK', 'castka_haleru', 77700,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'Účet 777', 'kontakt_id', null), '[]') as v20 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z20', :'v20');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z20', :'v20', 'trzba', 'nalezeno', '{"pos_prodej_id": "ORDER-777"}'::jsonb, null);
select public.jine_platby_zapsat_kontrolu(:'z20', :'v20', 'sklad', 'jiz_odecteno', '{"pos_prodej_id": "ORDER-777"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'z20', :'v20', 'trzba', 'nalezeno', 'Ano, je to ORDER-777.');
select pg_temp.check('pokladna našla → ruční „je“ → ruční „není“ pořád neprojde (výsledek pokladny se nevypere)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z20', :'v20', 'trzba', 'nenalezeno', 'Není tam.'),
    '23514', 'Pokladna při kontrole tohle našla'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'z20', :'v20', 'sklad', 'jiz_odecteno', 'Ano, pokladna odečetla.');
select pg_temp.check('pokladna „už odečteno“ → ruční „už odečteno“ → ruční „neodečteno“ pořád neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z20', :'v20', 'sklad', 'neodecteno', 'Nic neodečteno.'),
    '23514', 'Pokladna při kontrole tohle našla'));
reset role;
select pg_temp.check('ruční prohlášení výsledek pokladny (sloupce pokladna_*) nepřepíše',
  (select pokladna_trzby ->> 'zdroj' = 'pos_api' and pokladna_trzby ->> 'vysledek' = 'nalezeno'
          and kontrola_trzby ->> 'zdroj' = 'rucni_prohlaseni'
          and pokladna_skladu ->> 'vysledek' = 'jiz_odecteno' and kontrola_skladu ->> 'zdroj' = 'rucni_prohlaseni'
     from public.jine_platby where id = :'z20'));

-- 15b. „Pravděpodobně“ ze shody čísla účtu je konkrétní stopa jako „nalezeno“.
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z20', :'v20', 'trzba', 'pravdepodobne', '{"shoda": "cislo_vice"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('„pravděpodobně“ ze shody čísla účtu: ani s potvrzením nepřepíše, kdo nemá právo na opravy',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L, null, true)', :'z20', :'v20', 'trzba', 'nenalezeno', 'Jiný účet.'),
    '23514', 'konkrétní prodej nebo odpis'));
reset role;

-- 15c. Zrušení schválení po nejasném výsledku: stará kontrola skladu přestane platit.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_odeslat_sklad(:'z16', :'v16') as navrh16b \gset
select otisk as otisk16b from public.jine_platby_skladove_navrhy where id = :'navrh16b' \gset
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('po zrušení nejasné operace nejde výdej hned znovu schválit (stará kontrola „neodečteno“ neplatí)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, null, true)', :'navrh16b', :'otisk16b'),
    '23514', 'zkontrolujte výdej v pokladně'));
reset role;
select set_config('test.user_id', '', false);

-- ---------------------------------------------------------------------
-- 16. Třetí ověření (21. 10.) — migrace 20261021100000
-- ---------------------------------------------------------------------
reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== 16. Třetí ověření 21. 10. ======================================'

-- 16a. Cesta B, tržba: smazat číslo účtu a pustit novou kontrolu.
select jsonb_build_object('datum_prodeje', '2026-05-07', 'oznaceni', 'Perla — účet B7', 'mena', 'CZK', 'castka_haleru', 17700,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'POS-B7', 'kontakt_id', null)::text as hl24 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet B7', '98980000-aaaa-0000-0000-000000000020') as z24 \gset
select public.jine_platby_ulozit_navrh(:'z24', 1, :'hl24'::jsonb, '[]') as v24 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z24', :'v24');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z24', :'v24', 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-B7"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_ulozit_navrh(:'z24', :'v24', :'hl24'::jsonb || '{"externi_ucet": null}'::jsonb, '[]') as v24 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z24', :'v24');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z24', :'v24', 'trzba', 'pravdepodobne', '{"shoda": "castka", "castka_presne": true, "kandidatu": 1}'::jsonb, null);
reset role;
select pg_temp.check('cesta B: slabší výsledek nové kontroly konkrétní nález pokladny nepřepíše (drží „nalezeno“ POS-B7)',
  (select pokladna_trzby ->> 'vysledek' = 'nalezeno' and pokladna_trzby -> 'detail' ->> 'pos_prodej_id' = 'POS-B7'
          and kontrola_trzby ->> 'vysledek' = 'pravdepodobne'
     from public.jine_platby where id = :'z24'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('cesta B: po smazání čísla účtu „není“ s potvrzením pořád neprojde bez práva na opravy',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L, null, true)', :'z24', :'v24', 'trzba', 'nenalezeno', 'Jiný účet.'),
    '23514', 'konkrétní prodej'));
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z24', :'v24', 'trzba', 'nenalezeno', '{"uplne": true}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('cesta B: ani „nenalezeno“ z nové kontroly novou tržbu nezapíše — pokladna našla konkrétní prodej',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L, %L)', :'z24', :'v24', 'nova', 'Není duplicita.'),
    '23514', 'Pokladna při kontrole našla konkrétní prodej'));
reset role;
select pg_temp.check('historie kontroly v pokladně nese celý výsledek (id účtu POS-B7) i ponechaný nález',
  exists (select 1 from public.jine_platby_historie
           where zaznam_id = :'z24' and udalost = 'kontrola_pos_trzba' and detail -> 'kontrola' -> 'detail' ->> 'pos_prodej_id' = 'POS-B7')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z24' and udalost = 'kontrola_pos_trzba' and detail -> 'ponechany_nalez' -> 'detail' ->> 'pos_prodej_id' = 'POS-B7'));

-- 16b. Oprávněný přepis platí dál (falešná blokace po uložení návrhu).
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_prohlasit(:'z24', :'v24', 'trzba', 'nenalezeno', 'POS-B7 je jiný host, ověřeno osobně.', null, true);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_ulozit_navrh(:'z24', :'v24',
  :'hl24'::jsonb || '{"externi_ucet": null, "oznaceni": "Perla — účet B7, host Novák"}'::jsonb, '[]') as v24 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z24', :'v24');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z24', :'v24', 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-B7"}'::jsonb, null);
reset role;
select pg_temp.check('přepis člověkem s právem na opravy je ve výsledku pokladny a nová kontrola téhož účtu ho nesmaže',
  (select pokladna_trzby ? 'prepsano' and pokladna_trzby -> 'prepsano' ->> 'vysledek' = 'nenalezeno'
          and pokladna_trzby -> 'detail' ->> 'pos_prodej_id' = 'POS-B7'
     from public.jine_platby where id = :'z24'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('po oprávněném přepisu a uložení návrhu pokladní „není“ zopakuje bez práva na opravy',
  pg_temp.projde(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z24', :'v24', 'trzba', 'nenalezeno', 'Majitel ověřil, POS-B7 je jiný host.')));
select pg_temp.check('… a novou tržbu zapíše (oprávněný postup zůstává možný)',
  pg_temp.projde(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L, %L)', :'z24', :'v24', 'nova', 'Není duplicita.')));
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z24', :'v24', 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-B7-JINY"}'::jsonb, null);
reset role;
select pg_temp.check('nový konkrétní nález JINÉHO účtu značku přepisu nepřevezme',
  (select not (pokladna_trzby ? 'prepsano') and pokladna_trzby -> 'detail' ->> 'pos_prodej_id' = 'POS-B7-JINY'
     from public.jine_platby where id = :'z24'));

-- 16c. Cesta B, sklad: „už odečteno“, pak smazané číslo účtu a nová kontrola.
select jsonb_build_object('datum_prodeje', '2026-05-08', 'oznaceni', 'Perla — účet S8', 'mena', 'CZK', 'castka_haleru', 8800,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'POS-S8', 'kontakt_id', null)::text as hl25 \gset
select jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '1', 'jednotka', 'ks', 'cena_jednotkova_haleru', 8800,
    'cena_celkem_haleru', 8800, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'P2', 'pos_mnozstvi', '1',
    'mapovani', 'overeno', 'vyzaduje_kontrolu', false))::text as pol25 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet S8', '98980000-aaaa-0000-0000-000000000021') as z25 \gset
select public.jine_platby_ulozit_navrh(:'z25', 1, :'hl25'::jsonb, :'pol25'::jsonb) as v25 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z25', :'v25');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'jiz_odecteno', '{"zdroj_shody": "prodej", "externi_id": "POS-S8"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z25', :'v25', :'hl25'::jsonb || '{"externi_ucet": null}'::jsonb, :'pol25'::jsonb) as v25 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z25', :'v25');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'nelze_zjistit', '{"zdroj_shody": "castka", "castka_presne": true, "kandidatu": 1}'::jsonb, null);
reset role;
select pg_temp.check('cesta B sklad: „nelze zjistit“ z nové kontroly „už odečteno“ POS-S8 nepřepíše',
  (select pokladna_skladu ->> 'vysledek' = 'jiz_odecteno' and pokladna_skladu -> 'detail' ->> 'externi_id' = 'POS-S8'
     from public.jine_platby where id = :'z25'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('cesta B sklad: skladník po smazání čísla účtu ručně „neodečteno“ neprohlásí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z25', :'v25', 'sklad', 'neodecteno', 'Ověřeno.'),
    '23514', 'Pokladna při kontrole tohle našla'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_odeslat_sklad(:'z25', :'v25') as navrh25 \gset
reset role;
select otisk as otisk25 from public.jine_platby_skladove_navrhy where id = :'navrh25' \gset
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'neodecteno', '{"zdroj_shody": null}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('cesta B sklad: ani „neodečteno“ z nové kontroly výdej neschválí — pokladna už odečetla',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh25', :'otisk25'),
    '23514', 'spotřebu už odečetla'));
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_prohlasit(:'z25', :'v25', 'sklad', 'neodecteno', 'POS-S8 je jiný účet, ověřeno v pokladně.', null, true);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('cesta B sklad: po přepisu člověkem s právem na opravy výdej schválit jde (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrh25', :'otisk25')));
reset role;

-- 16d. Zrušený požadavek s nejasným výsledkem (z16, oddíly 14d a 15c).
select pg_temp.check('zrušení schválení po nejasném výsledku zanechá značku nedohledaného požadavku',
  (select nedohledana_operace ->> 'operace' = :'op16' and nedohledana_operace ->> 'klic' is not null
          and nedohledana_operace ->> 'stav' in ('odesila_se', 'nejasny_vysledek')
     from public.jine_platby where id = :'z16'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('po zrušení nejasného požadavku skladník ručně „neodečteno“ neprohlásí (požadavek nikdo nedohledal)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z16', :'v16', 'sklad', 'neodecteno', 'Ověřeno v pokladně.'),
    '23514', 'nikdo ho nedohledal'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('člověk s právem na opravy „neodečteno“ ručně doloží',
  pg_temp.projde(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'z16', :'v16', 'sklad', 'neodecteno', 'Ověřeno v pokladně osobně, požadavek neproběhl.')));
reset role;
select pg_temp.check('… tím značku vymaže a v historii zůstane, který požadavek doložil',
  (select nedohledana_operace is null from public.jine_platby where id = :'z16')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z16' and udalost = 'rucne_dolozeno_sklad' and detail -> 'nedohledana_operace' ->> 'operace' = :'op16'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('… a výdej pak schválit jde',
  pg_temp.projde(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, %L, true)', :'navrh16b', :'otisk16b', 'Není duplicita.')));
reset role;
-- Kontrola v pokladně: jasný výsledek značku vymaže, „nelze zjistit“ ne.
update public.jine_platby set nedohledana_operace = '{"operace": "test", "klic": "ftjp-test", "stav": "nejasny_vysledek"}'::jsonb where id = :'z25';
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'nelze_zjistit', '{"zdroj_shody": null}'::jsonb, null);
reset role;
select pg_temp.check('kontrola v pokladně bez jasného výsledku značku nedohledaného požadavku nechá',
  (select nedohledana_operace ->> 'klic' = 'ftjp-test' from public.jine_platby where id = :'z25'));
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'neodecteno', '{"zdroj_shody": null}'::jsonb, null);
reset role;
select pg_temp.check('jasný výsledek kontroly v pokladně (dohledá i klíče zrušených operací) značku vymaže a zapíše do historie',
  (select nedohledana_operace is null from public.jine_platby where id = :'z25')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z25' and udalost = 'kontrola_pos_sklad' and detail -> 'dohledana_operace' ->> 'klic' = 'ftjp-test'));

-- Zahájení a opakování požadavku stojí na témže nálezu (z25 je schválený z 16c).
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'jiz_odecteno', '{"zdroj_shody": "prodej", "externi_id": "POS-S8"}'::jsonb, null);
select public.jine_platby_zapsat_kontrolu(:'z25', :'v25', 'sklad', 'neodecteno', '{"zdroj_shody": null}'::jsonb, null);
reset role;
select id as op25 from public.pos_operace where zaznam_id = :'z25' and druh = 'vydej' and stav = 'pripraveno' \gset
set role service_role;
select public.pos_operace_zahajit(:'op25', now() + interval '10 minutes') as zahajeni25 \gset
reset role;
select pg_temp.check('požadavek do pokladny se nezahájí, když pokladna už odečetla (i s novější kontrolou „neodečteno“)',
  (:'zahajeni25')::jsonb ->> 'stav' = 'nelze' and (:'zahajeni25')::jsonb ->> 'duvod' like '%už odečetla%');
-- Prokázaná chyba požadavku (stav nastavený přímo): opakování taky ne.
update public.pos_operace set stav = 'chyba', chyba = 'Test: pokladna odmítla' where id = :'op25';
update public.jine_platby set stav_skladu = 'chyba' where id = :'z25';
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('výdej po chybě nejde zopakovat, když pokladna už odečetla (i s novější kontrolou „neodečteno“)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_vydej_znovu(%L)', :'z25'), '23514', 'už odečetla'));
reset role;
select set_config('test.user_id', '', false);

-- 16e. „Pravděpodobně“ bez uvedené shody (NULL v podmínce). Čerstvý záznam:
--      dřívější konkrétní nález by pojistku držel sám a test by NULL nepoznal
--      (rozbití C12/C13 tak napoprvé prošla).
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet 27', '98980000-aaaa-0000-0000-000000000023') as z27 \gset
select public.jine_platby_ulozit_navrh(:'z27', 1,
  jsonb_build_object('datum_prodeje', '2026-05-10', 'oznaceni', 'Perla — účet 27', 'mena', 'CZK', 'castka_haleru', 27700,
    'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'POS-27', 'kontakt_id', null), '[]') as v27 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z27', :'v27');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z27', :'v27', 'trzba', 'pravdepodobne', '{}'::jsonb, null);
reset role;
select pg_temp.check('(výsledek pokladny je jen „pravděpodobně“ bez uvedené shody)',
  (select pokladna_trzby ->> 'vysledek' = 'pravdepodobne' and not (pokladna_trzby -> 'detail' ? 'shoda') from public.jine_platby where id = :'z27'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('„pravděpodobně“ bez uvedené shody: bez práva na opravy nepřepíše ani s potvrzením',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L, null, true)', :'z27', :'v27', 'trzba', 'nenalezeno', 'Jiný účet.'),
    '23514', 'konkrétní prodej'));
reset role;

-- 16f. Úhrada jen z banky; storno platby po napárování úhradu zruší.
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet_firma', 'prijem', 6500, 'CZK', '2026-03-26', 'rucni') returning id as t_rucni \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ručně zapsaná platba úhradu neprokazuje',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 6500)', :'z11', :'t_rucni'), '23514', 'jen platba z banky'));
reset role;
select uhrada_transakce_id as t_parovana from public.jine_platby where id = :'z11' \gset
select pg_temp.check('(z11 má napárovanou platbu z banky a stav „uhrazeno“)',
  (select uhrada_transakce_id is not null and stav_uhrady = 'uhrazeno' from public.jine_platby where id = :'z11'));
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj, storno_of)
values (:'tenant', :'ucet_firma', 'vydaj', 6500, 'CZK', '2026-03-27', 'csv_banka', :'t_parovana');
select pg_temp.check('storno platby po napárování úhradu zruší (neověřeno, bez platby) a zapíše to do historie',
  (select stav_uhrady = 'neovereno' and uhrada_transakce_id is null and uhrada_castka_haleru is null from public.jine_platby where id = :'z11')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z11' and udalost = 'uhrada_zrusena_stornem' and detail ->> 'transakce' = :'t_parovana'));

-- 16g. Storno tržby ruší i id propojeného prodeje.
select jsonb_build_object('datum_prodeje', '2026-05-09', 'oznaceni', 'Perla — účet 26', 'mena', 'CZK', 'castka_haleru', 26600,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'POS-26', 'kontakt_id', null)::text as hl26 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet 26', '98980000-aaaa-0000-0000-000000000022') as z26 \gset
select public.jine_platby_ulozit_navrh(:'z26', 1, :'hl26'::jsonb, '[]') as v26 \gset
select public.jine_platby_oznacit_zkontrolovano(:'z26', :'v26');
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z26', :'v26', 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-26"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_potvrdit_trzbu(:'z26', :'v26', 'propojit');
reset role;
select pg_temp.check('(propojená tržba nese id prodeje POS-26)',
  (select stav_trzby = 'propojeno' and pos_prodej_id = 'POS-26' from public.jine_platby where id = :'z26'));
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_opravit_trzbu(:'z26', :'v26', null, 'Propojení omylem, jiný host.');
reset role;
select pg_temp.check('storno tržby smaže i id propojeného prodeje',
  (select stav_trzby = 'stornovano' and pos_prodej_id is null from public.jine_platby where id = :'z26'));
select set_config('test.user_id', '', false);

-- ---------------------------------------------------------------------
-- 17. Čtvrté ověření (22. 10.) — „cesta C“ přes víc záznamů
-- ---------------------------------------------------------------------
reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== 17. Čtvrté ověření 22. 10. ====================================='

-- 17a. Tržba: autor záznam s nálezem pokladny nezruší; týž doklad u nového
--      záznamu (stejná fotka, jiná částka) novou tržbu bez práva na opravy nezapíše.
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet C1', '98980000-cccc-0000-0000-0000000000c1') as zc1a \gset
reset role;
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'zc1a', '98980000-cccc-0000-0000-0000000001a1') as cestac1a \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cestac1a', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select public.jine_platby_pripojit_soubor(:'zc1a', :'cestac1a', repeat('ce', 32), '98980000-0000-0000-0000-000000000001');
reset role;
select verze as vc1a from public.jine_platby where id = :'zc1a' \gset
select jsonb_build_object('datum_prodeje', '2026-06-01', 'oznaceni', 'Perla — účet C1', 'mena', 'CZK', 'castka_haleru', 31100,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', 'POS-C1', 'kontakt_id', null)::text as hlc1 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'zc1a', :vc1a, :'hlc1'::jsonb, '[]') as vc1a \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc1a', :vc1a);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc1a', :vc1a, 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-C1"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('cesta C: autor záznam s nálezem pokladny nezruší (uvolnil by doklad pro nový záznam)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'zc1a', 'Špatně založeno, založím znovu.'),
    '23514', 'Zrušit ho smí jen člověk s právem na opravy'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('… člověk s právem na opravy ho zrušit smí (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_zrusit(%L, %L)', :'zc1a', 'Založeno omylem, ověřeno.')));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet C1 znovu', '98980000-cccc-0000-0000-0000000000c2') as zc1b \gset
reset role;
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'zc1b', '98980000-cccc-0000-0000-0000000001b1') as cestac1b \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cestac1b', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select public.jine_platby_pripojit_soubor(:'zc1b', :'cestac1b', repeat('ce', 32), '98980000-0000-0000-0000-000000000001');
reset role;
select verze as vc1b from public.jine_platby where id = :'zc1b' \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'zc1b', :vc1b,
  :'hlc1'::jsonb || '{"externi_ucet": null, "castka_haleru": 31000, "datum_prodeje": "2026-06-11"}'::jsonb, '[]') as vc1b \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc1b', :vc1b);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc1b', :vc1b, 'trzba', 'pravdepodobne', '{"shoda": "castka", "castka_presne": true, "kandidatu": 1}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'zc1b', :vc1b, 'trzba', 'nenalezeno', 'Jiný účet.', null, true);
select pg_temp.check('cesta C: týž doklad (stejná fotka) u nového záznamu — nová tržba bez práva na opravy neprojde, ani s jinou částkou a dnem',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L)', :'zc1b', :vc1b, 'nova'),
    '23514', 'u jiného záznamu téhož dokladu nebo prodeje'));
reset role;

-- 17b. Tržba bez zrušení: druhý záznam téhož dne a částky (jiná fotka).
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet CN', '98980000-cccc-0000-0000-0000000000c3') as zcna \gset
select public.jine_platby_ulozit_navrh(:'zcna', 1, :'hlc1'::jsonb || '{"externi_ucet": "POS-CN", "castka_haleru": 31300, "datum_prodeje": "2026-06-03"}'::jsonb, '[]') as vcna \gset
select public.jine_platby_oznacit_zkontrolovano(:'zcna', :vcna);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zcna', :vcna, 'trzba', 'nalezeno', '{"shoda": "cislo_dokladu", "pos_prodej_id": "POS-CN"}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet CN podruhé', '98980000-cccc-0000-0000-0000000000c4') as zcnb \gset
select public.jine_platby_ulozit_navrh(:'zcnb', 1, :'hlc1'::jsonb || '{"externi_ucet": null, "castka_haleru": 31300, "datum_prodeje": "2026-06-03"}'::jsonb, '[]') as vcnb \gset
select public.jine_platby_oznacit_zkontrolovano(:'zcnb', :vcnb);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zcnb', :vcnb, 'trzba', 'pravdepodobne', '{"shoda": "castka", "castka_presne": true, "kandidatu": 1}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_prohlasit(:'zcnb', :vcnb, 'trzba', 'nenalezeno', 'Jiný účet.', null, true);
select pg_temp.check('cesta C: druhý záznam téhož dne a částky (jiná fotka) — nová tržba bez práva na opravy neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L, %L)', :'zcnb', :vcnb, 'nova', 'Není duplicita.'),
    '23514', 'u jiného záznamu téhož dokladu nebo prodeje'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('… člověk s právem na opravy ji zapíše (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_potvrdit_trzbu(%L, %s, %L, %L)', :'zcnb', :vcnb, 'nova', 'Jiný host se stejnou útratou, ověřeno.')));
reset role;

-- 17c. Sklad: zrušený nejasný požadavek (značka) na záznamu A.
select jsonb_build_object('datum_prodeje', '2026-06-02', 'oznaceni', 'Perla — výdej C2', 'mena', 'CZK', 'castka_haleru', 12300,
  'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null)::text as hlc2 \gset
select jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '3', 'jednotka', 'ks', 'cena_jednotkova_haleru', 4100,
    'cena_celkem_haleru', 12300, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'P2', 'pos_mnozstvi', '3',
    'mapovani', 'overeno', 'vyzaduje_kontrolu', false))::text as polc2 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — výdej C2', '98980000-cccc-0000-0000-0000000000c5') as zc2a \gset
reset role;
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'zc2a', '98980000-cccc-0000-0000-0000000002a1') as cestac2a \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cestac2a', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select public.jine_platby_pripojit_soubor(:'zc2a', :'cestac2a', repeat('de', 32), '98980000-0000-0000-0000-000000000001');
reset role;
select verze as vc2a from public.jine_platby where id = :'zc2a' \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'zc2a', :vc2a, :'hlc2'::jsonb, :'polc2'::jsonb) as vc2a \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc2a', :vc2a);
select public.jine_platby_odeslat_sklad(:'zc2a', :vc2a) as navrhc2a \gset
reset role;
select otisk as otiskc2a from public.jine_platby_skladove_navrhy where id = :'navrhc2a' \gset
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc2a', :vc2a, 'sklad', 'neodecteno', '{"uplne": true}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_rozhodnout_vydej(:'navrhc2a', :'otiskc2a', true) as opc2a \gset
reset role;
set role service_role;
select public.pos_operace_zahajit(:'opc2a', now() + interval '5 minutes');
select public.pos_operace_dokoncit(:'opc2a', 'nejasny_vysledek', null, null, null, 'Timeout.');
reset role;
update public.pos_operace set platnost_do = now() - interval '3 minutes' where id = :'opc2a';
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_zrusit_schvaleni(:'zc2a', 'Pokladna nejde otevřít.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select pg_temp.check('cesta C: autor záznam se zrušeným nedohledaným požadavkem nezruší',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'zc2a', 'Zaseklo se to, založím znovu.'),
    '23514', 'Zrušit ho smí jen člověk s právem na opravy'));

-- 17d. Sklad bez zrušení: nový záznam téhož dne a částky (bez fotky).
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — výdej C3', '98980000-cccc-0000-0000-0000000000c7') as zc3 \gset
select public.jine_platby_ulozit_navrh(:'zc3', 1, :'hlc2'::jsonb, :'polc2'::jsonb) as vc3 \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc3', :vc3);
select public.jine_platby_odeslat_sklad(:'zc3', :vc3) as navrhc3 \gset
reset role;
select otisk as otiskc3 from public.jine_platby_skladove_navrhy where id = :'navrhc3' \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_prohlasit(:'zc3', :vc3, 'sklad', 'neodecteno', 'Ověřeno.');
select pg_temp.check('cesta C: nový záznam téhož dne a částky — výdej bez práva na opravy neschválí (jiný záznam má nedohledaný požadavek)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true, %L)', :'navrhc3', :'otiskc3', 'Není duplicita.'),
    '23514', 'výdej schválí jen člověk s právem na opravy'));
reset role;

-- 17e. Sklad se zrušením: týž doklad (stejná fotka) u nového záznamu jiného dne.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_zrusit(:'zc2a', 'Založím znovu, požadavek ověřím.');
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — výdej C2 znovu', '98980000-cccc-0000-0000-0000000000c6') as zc2b \gset
reset role;
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'zc2b', '98980000-cccc-0000-0000-0000000002b1') as cestac2b \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cestac2b', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select public.jine_platby_pripojit_soubor(:'zc2b', :'cestac2b', repeat('de', 32), '98980000-0000-0000-0000-000000000001');
reset role;
select verze as vc2b from public.jine_platby where id = :'zc2b' \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'zc2b', :vc2b, :'hlc2'::jsonb || '{"datum_prodeje": "2026-06-12"}'::jsonb, :'polc2'::jsonb) as vc2b \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc2b', :vc2b);
select public.jine_platby_odeslat_sklad(:'zc2b', :vc2b) as navrhc2b \gset
reset role;
select otisk as otiskc2b from public.jine_platby_skladove_navrhy where id = :'navrhc2b' \gset
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc2b', :vc2b, 'sklad', 'neodecteno', '{"uplne": true}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('cesta C: týž doklad (stejná fotka) u nového záznamu jiného dne — výdej bez práva na opravy neschválí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrhc2b', :'otiskc2b'),
    '23514', 'výdej schválí jen člověk s právem na opravy'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('… člověk s právem na opravy výdej schválí (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_rozhodnout_vydej(%L, %L, true)', :'navrhc2b', :'otiskc2b')));
reset role;

-- 17f. Značka přepisu nepřejde na „víc účtů“ JINÉHO čísla.
select jsonb_build_object('datum_prodeje', '2026-06-04', 'oznaceni', 'Perla — účet 12', 'mena', 'CZK', 'castka_haleru', 14400,
  'castka_puvod', 'doklad', 'typ_dokladu', 'uzavreny_prodej', 'externi_ucet', '12', 'kontakt_id', null)::text as hlc4 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — účet 12', '98980000-cccc-0000-0000-0000000000c8') as zc4 \gset
select public.jine_platby_ulozit_navrh(:'zc4', 1, :'hlc4'::jsonb, '[]') as vc4 \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc4', :vc4);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc4', :vc4, 'trzba', 'pravdepodobne',
  '{"shoda": "cislo_vice", "hledane_cislo": "12", "ucty": [{"externi_id": "POS-12A"}, {"externi_id": "POS-12B"}]}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_prohlasit(:'zc4', :vc4, 'trzba', 'nenalezeno', 'Oba účty č. 12 jsou jiní hosté, ověřeno.', null, true);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select public.jine_platby_ulozit_navrh(:'zc4', :vc4, :'hlc4'::jsonb || '{"externi_ucet": "47"}'::jsonb, '[]') as vc4 \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc4', :vc4);
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc4', :vc4, 'trzba', 'pravdepodobne',
  '{"shoda": "cislo_vice", "hledane_cislo": "47", "ucty": [{"externi_id": "POS-47A"}, {"externi_id": "POS-47B"}]}'::jsonb, null);
reset role;
select pg_temp.check('„víc účtů“ JINÉHO čísla značku přepisu nepřevezme',
  (select not (pokladna_trzby ? 'prepsano') and pokladna_trzby -> 'detail' ->> 'hledane_cislo' = '47' from public.jine_platby where id = :'zc4'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000002', false);
select pg_temp.check('… a pokladní „není“ proti němu bez potvrzení neprohlásí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'zc4', :vc4, 'trzba', 'nenalezeno', 'Jiný účet.'),
    '23514', 'Pokladna při kontrole tohle našla'));
reset role;

-- 17g. Značka i po zrušení zaseknutého požadavku („odesila_se“ po platnosti).
select jsonb_build_object('datum_prodeje', '2026-06-07', 'oznaceni', 'Perla — výdej C7', 'mena', 'CZK', 'castka_haleru', 8200,
  'castka_puvod', 'doklad', 'typ_dokladu', 'rucni_spotreba', 'externi_ucet', null, 'kontakt_id', null)::text as hlc7 \gset
select jsonb_build_array(jsonb_build_object('nazev', 'Pivo 0,5 l', 'mnozstvi', '2', 'jednotka', 'ks', 'cena_jednotkova_haleru', 4100,
    'cena_celkem_haleru', 8200, 'zdroj', 'rucne', 'druh', 'rozlevany_napoj', 'pos_produkt_id', 'P2', 'pos_mnozstvi', '2',
    'mapovani', 'overeno', 'vyzaduje_kontrolu', false))::text as polc7 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_zalozit(:'tenant', :'perla', :'pos', 'Perla — výdej C7', '98980000-cccc-0000-0000-0000000000cd') as zc7 \gset
select public.jine_platby_ulozit_navrh(:'zc7', 1, :'hlc7'::jsonb, :'polc7'::jsonb) as vc7 \gset
select public.jine_platby_oznacit_zkontrolovano(:'zc7', :vc7);
select public.jine_platby_odeslat_sklad(:'zc7', :vc7) as navrhc7 \gset
reset role;
select otisk as otiskc7 from public.jine_platby_skladove_navrhy where id = :'navrhc7' \gset
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'zc7', :vc7, 'sklad', 'neodecteno', '{"uplne": true}'::jsonb, null);
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_rozhodnout_vydej(:'navrhc7', :'otiskc7', true) as opc7 \gset
reset role;
set role service_role;
select public.pos_operace_zahajit(:'opc7', now() + interval '5 minutes');
reset role;
update public.pos_operace set platnost_do = now() - interval '3 minutes' where id = :'opc7';
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select public.jine_platby_zrusit_schvaleni(:'zc7', 'Požadavek se zasekl.');
reset role;
select pg_temp.check('zrušení zaseknutého požadavku („odesílá se“ po platnosti) taky zanechá značku',
  (select nedohledana_operace ->> 'operace' = :'opc7' and nedohledana_operace ->> 'stav' = 'odesila_se' from public.jine_platby where id = :'zc7'));
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('… a skladník pak ručně „neodečteno“ neprohlásí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_prohlasit(%L, %s, %L, %L, %L)', :'zc7', :vc7, 'sklad', 'neodecteno', 'Ověřeno.'),
    '23514', 'nikdo ho nedohledal'));
reset role;
select set_config('test.user_id', '', false);

-- Úklid: vlastní řádky pryč (zápisové granty nemá nikdo — maže superuživatel).
-- Pořadí kvůli cizím klíčům. Cizí firma zůstává (jako v krok93/95).
delete from public.jine_platby_historie where tenant_id = :'tenant';
delete from public.pos_operace where tenant_id = :'tenant' and korekce_pro is not null;
delete from public.pos_operace where tenant_id = :'tenant';
delete from public.jine_platby_skladove_navrhy where tenant_id = :'tenant';
delete from public.jine_platby_polozky where tenant_id = :'tenant';
delete from public.jine_platby_rozpoznani where tenant_id = :'tenant';
delete from public.jine_platby_soubory where tenant_id = :'tenant';
delete from public.ostatni_trzby where tenant_id = :'tenant' and nahrazuje is not null;
delete from public.ostatni_trzby where tenant_id = :'tenant';
delete from public.jine_platby where tenant_id = :'tenant';
delete from public.kontakty where tenant_id = :'tenant' and nazev = 'Krok98 Odběratel s.r.o.';
delete from public.pos_mapovani where tenant_id = :'tenant';
delete from public.pos_katalog where tenant_id = :'tenant';
delete from storage.objects where bucket_id = 'jine-platby';
delete from public.pokladna_prodeje_denni where produkt_nazev like 'Krok98%';
delete from public.transakce where ucet_id in (:'ucet', :'ucet_firma');
delete from public.platebni_ucty where id in (:'ucet', :'ucet_firma');
delete from public.integrace_pripojeni where id in (:'pos', :'pos_bar', :'cizi_pos', :'pos_bez');
delete from public.transakce where ucet_id = :'ucet_cizi';
delete from public.platebni_ucty where id = :'ucet_cizi';
delete from public.kontakty where id = :'kontakt_cizi';
delete from public.membership_branches where membership_id in (:'m1', :'m2', :'m3', :'m4', :'m6');
delete from public.memberships where id in (:'m1', :'m2', :'m3', :'m4', :'m6');
delete from public.employees where id in (:'e1', :'e2', :'e3', :'e4', :'e6');
delete from public.position_permissions where position_id in (:'z_obsluha', :'z_pokladni', :'z_sklad', :'z_bar', :'z_vedouci');
delete from public.positions where id in (:'z_obsluha', :'z_pokladni', :'z_sklad', :'z_bar', :'z_vedouci');

\echo ''
\echo '== KROK 98 HOTOV =============================================='
