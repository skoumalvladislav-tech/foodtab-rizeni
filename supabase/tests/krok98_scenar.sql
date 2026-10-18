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
--      čísla účtu jen ±7 dní a bez pokladny v téže pobočce, audit položek.
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
      and p.proname not in ('jine_platby_zahajit_rozpoznani', 'jine_platby_dokoncit_rozpoznani', 'jine_platby_zapsat_kontrolu')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and p.proconfig @> array['search_path=""']) = 21);

select pg_temp.check('serverové funkce (AI, kontrola v pokladně, operace, katalog): jen service_role',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('jine_platby_zahajit_rozpoznani', 'jine_platby_dokoncit_rozpoznani', 'jine_platby_zapsat_kontrolu',
                        'pos_operace_zahajit', 'pos_operace_dokoncit', 'pos_katalog_nahradit')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 6);

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
select public.jine_platby_pripojit_soubor(:'z1', :'cesta1', repeat('a', 64)) as soubor1 \gset
select pg_temp.check('druhá stránka (PDF) se připojí s pořadím 2',
  pg_temp.projde(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z1', :'cesta2', repeat('b', 64))));
select pg_temp.check('stejná fotka (otisk) k jinému záznamu NEPROJDE — opakovaná sjetina',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z2', :'cesta_z2', repeat('a', 64)),
    '23505', 'už je připojený k záznamu'));
select pg_temp.check('soubor, který nahrál někdo jiný, nejde připojit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z1', :'cesta_cizi', repeat('c', 64)),
    '23514', 'nahrál někdo jiný'));
select pg_temp.check('cesta jiného záznamu nesedí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z1', :'cesta_z2', repeat('d', 64)),
    '23514', 'nesedí'));
select pg_temp.check('soubor, který v úložišti není, nejde připojit',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z1',
    format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z1', '98980000-bbbb-0000-0000-00000000ffff'), repeat('e', 64)),
    '23514', 'v úložišti není'));
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

-- Změna po schválení: obsluha změní množství piva → schválení padá.
select (jsonb_set(:'polozky'::jsonb, '{1,pos_mnozstvi}', '"5"'))::text as polozky5 \gset
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_ulozit_navrh(:'z1', :'verze_z1', :'hlavicka'::jsonb, :'polozky5'::jsonb) as verze_z1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('změna položky po schválení: návrh nahrazený, operace zrušená, sklad znovu „bez návrhu"',
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
reset role;
set role service_role;
select public.jine_platby_zapsat_kontrolu(:'z1', :'verze_z1', 'sklad', 'neodecteno', jsonb_build_object('ucet', 'otevřený'), null);
reset role;
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
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
select pg_temp.check('obsluha (bez finance.read) vidí pokladnu své pobočky — jen netajné údaje a provozovnu 11',
  (select count(*) = 1 and min(pos_provozovna) = '11' and min(id::text) = :'pos' from public.jine_platby_pokladny(:'tenant', :'perla')));
select pg_temp.check('obsluha Perly nedostane pokladny Baru (bez práva na pobočce = prázdno)',
  (select count(*) from public.jine_platby_pokladny(:'tenant', :'bar')) = 0);
select set_config('test.user_id', '98980000-0000-0000-0000-000000000004', false);
select pg_temp.check('vedoucí Baru vidí obě pokladny, které Bar obsluhují',
  (select count(*) from public.jine_platby_pokladny(:'tenant', :'bar')) = 2);
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
values (:'tenant', :'ucet', 'prijem', 160000, 'CZK', '2026-03-20', 'rucni') returning id as t_prijem \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 160000, 'CZK', '2026-03-20', 'rucni') returning id as t_vydaj \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 160000, 'EUR', '2026-03-20', 'rucni') returning id as t_eur \gset
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
select pg_temp.check('obsluha schválení zrušit nesmí (jen oprávněná osoba pro výdej)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit_schvaleni(%L, %L)', :'z5', 'Nic se neodepsalo.'), '42501', 'oprávněná osoba'));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ani majitel záznam během ručního odpisu nezruší',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_zrusit(%L, %L)', :'z5', 'Omylem.'), '23514', 'předaný k ručnímu provedení'));
select set_config('test.user_id', '98980000-0000-0000-0000-000000000003', false);
select pg_temp.check('ruční doložení s cizím otiskem (stará stránka) neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_rucne_dolozit_vydej(%L, %L, %L, %L)', :'z5', repeat('0', 64), 'D-1', 'Odepsáno.'),
    '23514', 'Schválený návrh je jiný'));
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
values (:'tenant', :'ucet_firma', 'prijem', 13100, 'CZK', '2026-03-20', 'rucni') returning id as t_firma \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'perla', :'z6', '98980000-bbbb-0000-0000-000000000006') as cesta6 \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta6', '98980000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":2000}');
set role authenticated;
select set_config('test.user_id', '98980000-0000-0000-0000-000000000001', false);
select public.jine_platby_pripojit_soubor(:'z6', :'cesta6', repeat('f', 64));
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
select pg_temp.check('doklad ze zrušeného záznamu jde připojit ke správnému záznamu',
  pg_temp.projde(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'z7', :'cesta7', repeat('f', 64))));

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
select pg_temp.check('stejná fotka jako na Perle: hláška neprozradí id záznamu pobočky, kterou vedoucí Baru nevidí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_pripojit_soubor(%L, %L, %L)', :'zb', :'cesta_b', repeat('a', 64)),
    '23505', 'kterou nevidíte'));
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
select verze as v8b from public.jine_platby where id = :'z8' \gset
set role service_role;
select pg_temp.check('dodatečná kontrola jde zapsat i k zapsané tržbě',
  pg_temp.projde(format('select public.jine_platby_zapsat_kontrolu(%L, %s, %L, %L, %L::jsonb, null)', :'z8', :'v8b', 'trzba', 'nalezeno', '{"doklad": "D-9"}')));
reset role;
select pg_temp.check('po dodatečné kontrole tržba zůstala zapsaná a započtená, výsledek je „nalezeno“',
  (select stav_trzby = 'zapsano' and kontrola_trzby ->> 'vysledek' = 'nalezeno' from public.jine_platby where id = :'z8')
  and exists (select 1 from public.ostatni_trzby where zaznam_id = :'z8' and stav = 'platna' and zapocitat));
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
delete from public.integrace_pripojeni where id in (:'pos', :'pos_bar', :'cizi_pos');
delete from public.membership_branches where membership_id in (:'m1', :'m2', :'m3', :'m4', :'m6');
delete from public.memberships where id in (:'m1', :'m2', :'m3', :'m4', :'m6');
delete from public.employees where id in (:'e1', :'e2', :'e3', :'e4', :'e6');
delete from public.position_permissions where position_id in (:'z_obsluha', :'z_pokladni', :'z_sklad', :'z_bar', :'z_vedouci');
delete from public.positions where id in (:'z_obsluha', :'z_pokladni', :'z_sklad', :'z_bar', :'z_vedouci');

\echo ''
\echo '== KROK 98 HOTOV =============================================='
