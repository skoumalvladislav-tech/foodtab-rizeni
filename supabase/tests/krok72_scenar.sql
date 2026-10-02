-- Scénář pro krok 72 — úprava a storno úseku docházky s ID záznamů
-- z CIZÍ firmy.
--
-- PROČ TOHLE EXISTUJE. public.upravit_usek_dochazky a
-- public.stornovat_usek_dochazky (20260927110000_dochazka_smeny_cloveka.sql)
-- načítají attendance_events podle HOLÉHO id
--     select * … from public.attendance_events a where a.id = p_prichod for update
-- bez filtru na firmu a zaměstnance — záměrně (komentář v kroku 3 funkce:
-- filtry při načtení by byly druhou kopií kontroly, kterou nejde shodit).
-- Bezpečnost drží JEDINÁ navazující kontrola: řádek automatu
--     app.useky_dochazky(p_employee, v_den, v_den)
-- s `u.prichod_id is not distinct from p_prichod and u.odchod_id is not
-- distinct from p_odchod`. Automat interně filtruje employee_id =
-- p_employee, takže cizí id v něm nikdy není. Dnes to drží, ale je to
-- neprůhledné: kdo kontrolu „zjednoduší", otevře přímou úpravu a storno
-- cizí docházky — a nespadne nic z dosavadních testů.
--
-- CO KROK 63 NEMÁ. krok63 hlídá cizího MAJITELE (řádky ~980-986, ~1256-1258)
-- a záznam JINÉHO ČLOVĚKA TÉŽE FIRMY (Janin úsek pod Petrem, ~992-1012).
-- NEHLÍDÁ případ, který tenhle scénář zavírá: VLASTNÍ platný p_tenant,
-- VLASTNÍ platný p_employee a VLASTNÍ právo — ale p_prichod / p_odchod
-- jsou id záznamů z jiné firmy.
--
-- STOJÍ NA ETAPA0. Naše firma je „Foodtab s.r.o." z etapa0_scenar.sql
-- (majitel majitel@foodtab.cz, pobočka Černá Perla) — jako krok70. Pustit
-- samostatně:
--     node scripts/scenare-pglite.mjs etapa0_scenar krok72_scenar
-- Druhá firma je SKUTEČNÁ (app.create_tenant, její majitel Xaver), ne jen
-- „cizí tenant_id v proměnné". Všechna data jsou v srpnu 2026 (minulost),
-- takže výsledek nezáleží na dni běhu.
--
-- JAK JE KONTROLA SESTAVENÁ, ABY UMĚLA SPADNOUT.
--  * Naše N a cizí C mají ve STEJNÝCH dnech ZÁZNAMY STEJNÉHO DRUHU ve
--    stejný čas (uzavřený úsek 8–12, otevřený příchod 8:00, osamělý
--    odchod 17:00). Kdyby kontrola místo ID porovnávala jen „má ten člověk
--    ten den úsek tohoto druhu", odmítnutí by NEPROŠLO. Stejný den a druh
--    zároveň znamená, že odmítnutí není náhodný důsledek špatného data.
--  * Útoky posílají časy a pobočku NAŠÍ firmy tak, aby bez kontroly
--    úprava došla až k zápisu (stornovala by cizí řádky a zapsala nové).
--    Po každém pokusu se proto neměří jen hláška, ale celý stav
--    docházky obou firem (otisk všech sloupců všech řádků + počty +
--    audit) před a po.
--  * Hláška se porovnává NA CELÝ TEXT i s SQLSTATE 22023, ne jen „něco
--    spadlo". Jiná chyba (jiné pravidlo funkce, překlep) se nepočítá.
--  * Pozitivní kontroly (úprava a storno vlastního úseku; na konci
--    storno všeho, co jsme útokem zkoušeli „krást" ve dvojicích s naším
--    id i vlastního cizího úseku jeho majitelem) dokazují, že odmítnutí
--    nejsou důsledkem rozbitých dat nebo globální chyby.
--
-- ODDÍLY
--  0. Příprava měří to, co má (druhy řádků automatu, firmy, práva).
--  1. Pozitivní kontrola: majitel upraví a stornuje VLASTNÍ úsek.
--  2. upravit_usek_dochazky s cizími ID (úsek, smíšené dvojice, otevřený
--     příchod, osamělý odchod, cizí člověk pod naší firmou).
--  3. stornovat_usek_dochazky se stejnými variantami.
--  4. Náhodná ID dávají TUTÉŽ odpověď jako cizí (kdo zkouší, nepozná, že
--     cizí záznam existuje).
--  5. Po všech pokusech: cizí docházka přesně jako při založení; naše
--     záznamy pořád platné a majitel je smí stornovat; cizí majitel své.
--
-- ZÁMEK (jen popis, nic se tu neopravuje): `select … for update` nad CIZÍM
-- řádkem attendance_events dostane volající dřív, než kontrola řádek
-- odmítne. Řádkový zámek drží do konce transakce — a ta tu končí výjimkou
-- vzápětí (jednotky milisekund), takže cizí firmu nezablokuje trvale.
-- Po tu chvíli ale cizímu řádku čeká jeho vlastní storno/úprava (UPDATE a
-- FOR KEY SHARE z `nahrazuje` při vložení opravy). Útočník, který by
-- ve smyčce posílal cizí id, ji tak zdržuje. Teoretický deadlock: útočník
-- pošle (p_prichod = cizí odchod, p_odchod = cizí příchod), zamkne je tedy
-- v opačném pořadí než oběť (příchod, pak odchod) — postgres jednu stranu
-- po deadlock_timeout shodí (40P01). Souběh jedno sezení neověří, proto
-- tady jen popis.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Volání úpravy a storna jako text (vzor krok63).
create or replace function pg_temp.uprava(
  p_tenant uuid, p_emp uuid, p_in uuid, p_out uuid,
  p_in_kdy text, p_in_pob uuid, p_out_kdy text, p_out_pob uuid, p_duvod text)
returns text language sql as $$
  select format(
    'select * from public.upravit_usek_dochazky(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::timestamp, %L::uuid, %L::timestamp, %L::uuid, %L)',
    p_tenant, p_emp, p_in, p_out, p_in_kdy, p_in_pob, p_out_kdy, p_out_pob, p_duvod);
$$;

create or replace function pg_temp.storno(
  p_tenant uuid, p_emp uuid, p_in uuid, p_out uuid, p_duvod text)
returns text language sql as $$
  select format(
    'select * from public.stornovat_usek_dochazky(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)',
    p_tenant, p_emp, p_in, p_out, p_duvod);
$$;

-- Jeden pokus: spustí příkaz, vrátí 'PROSLO' nebo 'SQLSTATE|hláška'.
create or replace function pg_temp.pokus(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'PROSLO';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

-- Pokus, který MUSÍ skončit přesně tímhle SQLSTATE a hláškou a NESMÍ
-- změnit nic v docházce ani v auditu. Dvě kontroly: beze změny a přesná
-- hláška (nejdřív „beze změny" — když se přece zapsalo, je to ta důležitější
-- zpráva).
create or replace function pg_temp.zkus(p_popis text, p_sql text, p_stav text, p_hlaska text)
returns void language plpgsql as $$
declare
  v_pred  text := pg_temp.snap();
  v_vysl  text := pg_temp.pokus(p_sql);
  v_po    text := pg_temp.snap();
begin
  if v_po is distinct from v_pred then
    raise notice '    (docházka se ZMĚNILA; výsledek volání: %)', v_vysl;
  end if;
  perform pg_temp.check(p_popis || ' — docházka beze změny', v_po is not distinct from v_pred);
  if v_vysl is distinct from p_stav || '|' || p_hlaska then
    raise notice '    (skutečný výsledek: %)', v_vysl;
  end if;
  perform pg_temp.check(p_popis || ' — odmítnuto (' || p_stav || ': ' || p_hlaska || ')',
                        v_vysl = p_stav || '|' || p_hlaska);
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel_user from public.profiles where email = 'majitel@foodtab.cz' \gset


-- =====================================================================
-- PŘÍPRAVA: druhá firma (skutečná), naše zaměstnankyně N a cizí
-- zaměstnankyně C se záznamy ve STEJNÝCH dnech a časech.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('72720000-0000-0000-0000-000000000003', 'xaver72@jinafirma.cz', '{"full_name":"Xaver Sedmdesátdva"}');

-- Druhá firma vzniká tak, jak vzniká každá. Xaver ji založí a je v ní
-- majitel. Jeho firma má modul provoz (a s ním docházku) zapnutý sama.
set role authenticated;
select set_config('test.user_id', '72720000-0000-0000-0000-000000000003', false);
select app.create_tenant('Krok72 Cizí s.r.o.', 'Xaver Sedmdesátdva') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

select set_config('krok72.tenant',   :'tenant',   false);
select set_config('krok72.tenant_b', :'tenant_b', false);

-- Otisk celé docházky obou firem: počet a CELÝ řádek (to_jsonb → každý
-- sloupec včetně stornovano_kdy, duvod_storna, nahrazuje, source …) všech
-- záznamů, plus počet řádků auditu docházky. Security definer, ať jde
-- volat i pod rolí authenticated a vidí všechno (RLS tu nemá co omezovat —
-- měří se skutečný obsah tabulky, ne to, co vidí volající).
-- (Definice je až TADY, za set_config výš: čte oba nastavené klíče.)
create or replace function pg_temp.snap()
returns text language sql security definer as $$
  select concat_ws('#',
    (select count(*) from public.attendance_events),
    (select coalesce(md5(string_agg(to_jsonb(a)::text, ';' order by a.id)), '-')
       from public.attendance_events a
      where a.tenant_id in (current_setting('krok72.tenant')::uuid,
                            current_setting('krok72.tenant_b')::uuid)),
    (select count(*) from public.audit_log where action like 'attendance.%'));
$$;

insert into public.branches (tenant_id, name, slug)
values (:'tenant_b', 'Krok72 Cizí pobočka', 'krok72-cizi') returning id as pob_b \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name)
values (:'tenant', :'perla', null, 'Naše Sedmdesátdva') returning id as nas \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name)
values (:'tenant_b', :'pob_b', null, 'Cizinec Sedmdesátdva') returning id as cizinec \gset

/*
  NAŠE N (firma A, Černá Perla) — pět dnů:
    3. 8.  8:00–12:00                  uzavřený úsek   (útoky ve dvojicích, 5. oddíl)
    4. 8.  9:00–13:00                  uzavřený úsek   (pozitivní úprava, oddíl 1)
    5. 8.  odchod 17:00                osamělý odchod  (stejný den a čas jako cizí)
    6. 8.  8:00 příchod                otevřený        (stejný den a čas jako cizí)
    7. 8.  10:00–14:00                 uzavřený úsek   (pozitivní storno, oddíl 1)
  (Osamělý odchod je den PŘED otevřeným příchodem schválně: spoušť
  set_business_date dá odchodu den posledního neukončeného příchodu, takže
  osamělý odchod za otevřeným příchodem by osamělý nebyl.)
  CIZÍ C (firma B) — tři dny, KAŽDÝ ve stejném dni a čase jako naše:
    3. 8.  8:00–12:00                  uzavřený úsek
    5. 8.  odchod 17:00                osamělý odchod
    6. 8.  8:00 příchod                otevřený
*/
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'tenant', :'perla', :'nas', 'in',  '2026-08-03 08:00+02'),
  (:'tenant', :'perla', :'nas', 'out', '2026-08-03 12:00+02'),
  (:'tenant', :'perla', :'nas', 'in',  '2026-08-04 09:00+02'),
  (:'tenant', :'perla', :'nas', 'out', '2026-08-04 13:00+02'),
  (:'tenant', :'perla', :'nas', 'in',  '2026-08-06 08:00+02'),
  (:'tenant', :'perla', :'nas', 'out', '2026-08-05 17:00+02'),
  (:'tenant', :'perla', :'nas', 'in',  '2026-08-07 10:00+02'),
  (:'tenant', :'perla', :'nas', 'out', '2026-08-07 14:00+02');

insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'tenant_b', :'pob_b', :'cizinec', 'in',  '2026-08-03 08:00+02'),
  (:'tenant_b', :'pob_b', :'cizinec', 'out', '2026-08-03 12:00+02'),
  (:'tenant_b', :'pob_b', :'cizinec', 'in',  '2026-08-06 08:00+02'),
  (:'tenant_b', :'pob_b', :'cizinec', 'out', '2026-08-05 17:00+02');

select max(id::text) filter (where business_date = '2026-08-03' and kind = 'in')  as n_in,
       max(id::text) filter (where business_date = '2026-08-03' and kind = 'out') as n_out,
       max(id::text) filter (where business_date = '2026-08-04' and kind = 'in')  as p_in,
       max(id::text) filter (where business_date = '2026-08-04' and kind = 'out') as p_out,
       max(id::text) filter (where business_date = '2026-08-06' and kind = 'in')  as n_open,
       max(id::text) filter (where business_date = '2026-08-05' and kind = 'out') as n_lone,
       max(id::text) filter (where business_date = '2026-08-07' and kind = 'in')  as s_in,
       max(id::text) filter (where business_date = '2026-08-07' and kind = 'out') as s_out
  from public.attendance_events where employee_id = :'nas' \gset

select max(id::text) filter (where business_date = '2026-08-03' and kind = 'in')  as c_in,
       max(id::text) filter (where business_date = '2026-08-03' and kind = 'out') as c_out,
       max(id::text) filter (where business_date = '2026-08-06' and kind = 'in')  as c_open,
       max(id::text) filter (where business_date = '2026-08-05' and kind = 'out') as c_lone
  from public.attendance_events where employee_id = :'cizinec' \gset

-- Souhrn cizí docházky při založení — oddíl 5 ho porovná se stavem po všem.
select string_agg(id::text || '@' || occurred_at::text || '@' || kind, ',' order by id) as c_zaklad
  from public.attendance_events where employee_id = :'cizinec' \gset


\echo ''
\echo '== 0. Příprava měří to, co má ==============================='

select pg_temp.check('příprava: naše a cizí firma jsou dvě různé firmy',
  :'tenant' <> :'tenant_b'
  and exists (select 1 from public.employees where id = :'nas' and tenant_id = :'tenant')
  and exists (select 1 from public.employees where id = :'cizinec' and tenant_id = :'tenant_b'));

select pg_temp.check('příprava: všech osm našich a čtyři cizí záznamy opravdu vznikly',
  (select count(*) from public.attendance_events where employee_id = :'nas') = 8
  and (select count(*) from public.attendance_events where employee_id = :'cizinec') = 4
  and :'n_in' is not null and :'n_out' is not null and :'p_in' is not null
  and :'p_out' is not null and :'n_open' is not null and :'n_lone' is not null
  and :'s_in' is not null and :'s_out' is not null
  and :'c_in' is not null and :'c_out' is not null and :'c_open' is not null and :'c_lone' is not null);

-- Cizí záznamy musí být skutečně toho druhu, jakým se vydávají. Jinak by
-- kontroly dole zkoušely, že se „nedá upravit něco, co upravit nejde".
select pg_temp.check('příprava: automat vidí u CIZÍHO člověka uzavřený úsek, otevřený příchod i osamělý odchod',
  exists (select 1 from app.useky_dochazky(:'cizinec', date '2026-08-03', date '2026-08-03') u
           where u.druh = 'usek' and u.prichod_id = :'c_in' and u.odchod_id = :'c_out')
  and exists (select 1 from app.useky_dochazky(:'cizinec', date '2026-08-06', date '2026-08-06') u
               where u.druh = 'otevreny' and u.prichod_id = :'c_open' and u.odchod_id is null)
  and exists (select 1 from app.useky_dochazky(:'cizinec', date '2026-08-05', date '2026-08-05') u
               where u.druh = 'odchod_bez_prichodu' and u.prichod_id is null and u.odchod_id = :'c_lone'));

-- Naše záznamy jsou ve stejné dny, stejného druhu a ve stejný čas — o to
-- jde: kontrola, která by porovnávala jen druh a den, by cizí id propustila.
select pg_temp.check('příprava: u NÁS jsou tytéž dny a druhy (uzavřený 3. 8., osamělý odchod 5. 8., otevřený 6. 8.)',
  exists (select 1 from app.useky_dochazky(:'nas', date '2026-08-03', date '2026-08-03') u
           where u.druh = 'usek' and u.prichod_id = :'n_in' and u.odchod_id = :'n_out')
  and exists (select 1 from app.useky_dochazky(:'nas', date '2026-08-06', date '2026-08-06') u
               where u.druh = 'otevreny' and u.prichod_id = :'n_open' and u.odchod_id is null)
  and exists (select 1 from app.useky_dochazky(:'nas', date '2026-08-05', date '2026-08-05') u
               where u.druh = 'odchod_bez_prichodu' and u.prichod_id is null and u.odchod_id = :'n_lone')
  and not exists (select 1 from app.useky_dochazky(:'nas', date '2026-08-01', date '2026-08-31') u
                   where u.prichod_id in (:'c_in', :'c_open') or u.odchod_id in (:'c_out', :'c_lone')));

set role authenticated;
select set_config('test.user_id', :'majitel_user', false);
select pg_temp.check('příprava: náš majitel má attendance.manage u nás, ale ve firmě B NEMÁ nic',
  app.has_access(:'tenant', 'attendance.manage', :'perla')
  and not app.has_access(:'tenant_b', 'attendance.manage', null)
  and not app.has_access(:'tenant_b', 'attendance.manage', :'pob_b'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('příprava: otisk docházky je citlivý (změna řádku změní otisk)',
  (select md5(string_agg(to_jsonb(a)::text, ';' order by a.id))
     from public.attendance_events a where a.tenant_id = :'tenant_b')
  is distinct from
  (select md5(string_agg(to_jsonb(a)::text, ';' order by a.id))
     from public.attendance_events a where a.tenant_id = :'tenant_b' and a.id <> :'c_lone'));


\echo ''
\echo '== 1. Pozitivní kontrola: majitel upraví a stornuje VLASTNÍ úsek'

set role authenticated;
select set_config('test.user_id', :'majitel_user', false);

-- Úprava odchodu 13:00 → 14:00 u našeho úseku.
select odchod_id as p_out_novy from public.upravit_usek_dochazky(
  :'tenant', :'nas', :'p_in', :'p_out',
  null, null, '2026-08-04 14:00', null, 'Krok72 oprava odchodu') \gset

-- Storno našeho druhého úseku.
select stornovano as s_stornovano from public.stornovat_usek_dochazky(
  :'tenant', :'nas', :'s_in', :'s_out', 'Krok72 storno úseku') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('úprava: starý odchod je stornovaný, příchod beze změny, nový odchod 14:00 náhradou starého',
  (select stornovano_kdy is not null from public.attendance_events where id = :'p_out')
  and (select stornovano_kdy is null from public.attendance_events where id = :'p_in')
  and (select occurred_at = timestamptz '2026-08-04 14:00+02' and employee_id = :'nas'
              and tenant_id = :'tenant' and nahrazuje = :'p_out' and stornovano_kdy is null
              and source = 'manual'
         from public.attendance_events where id = :'p_out_novy'));
select pg_temp.check('storno: oba záznamy úseku jsou stornované, nic se nesmazalo',
  :s_stornovano = 2
  and (select count(*) from public.attendance_events
        where id in (:'s_in', :'s_out') and stornovano_kdy is not null
          and duvod_storna like 'Storno úseku:%') = 2);
select pg_temp.check('po pozitivních kontrolách: naše docházka má 9 řádků (8 + nový odchod), cizí 4',
  (select count(*) from public.attendance_events where employee_id = :'nas') = 9
  and (select count(*) from public.attendance_events where employee_id = :'cizinec') = 4);


\echo ''
\echo '== 2. upravit_usek_dochazky s ID z CIZÍ firmy ================'

-- Útok: VLASTNÍ firma, VLASTNÍ zaměstnanec, VLASTNÍ právo — cizí je jen
-- id záznamu. Časy a pobočka jsou naše a volné (14:00–15:00 se s ničím
-- naším nepřekrývá), takže BEZ kontroly by úprava došla až k zápisu:
-- stornovala by cizí řádky a zapsala by nové našemu člověku.
set role authenticated;
select set_config('test.user_id', :'majitel_user', false);

select pg_temp.zkus('upravit: cizí uzavřený úsek (oba konce z firmy B)',
  pg_temp.uprava(:'tenant', :'nas', :'c_in', :'c_out',
    '2026-08-03 14:00', :'perla', '2026-08-03 15:00', :'perla', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('upravit: smíšená dvojice — NÁŠ příchod + CIZÍ odchod',
  pg_temp.uprava(:'tenant', :'nas', :'n_in', :'c_out',
    null, null, '2026-08-03 15:00', :'perla', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('upravit: smíšená dvojice — CIZÍ příchod + NÁŠ odchod',
  pg_temp.uprava(:'tenant', :'nas', :'c_in', :'n_out',
    '2026-08-03 06:00', :'perla', null, null, 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('upravit: samotný cizí otevřený příchod (p_odchod null) — doplnění odchodu',
  pg_temp.uprava(:'tenant', :'nas', :'c_open', null,
    null, null, '2026-08-06 15:00', :'perla', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('upravit: samotný cizí osamělý odchod (p_prichod null) — doplnění příchodu',
  pg_temp.uprava(:'tenant', :'nas', null, :'c_lone',
    '2026-08-05 09:00', :'perla', null, null, 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

-- Další dvě smíšené dvojice, ať nezáleží na tom, který konec je cizí
-- a který druh řádku se vydává za který.
select pg_temp.zkus('upravit: NÁŠ otevřený příchod + CIZÍ osamělý odchod',
  pg_temp.uprava(:'tenant', :'nas', :'n_open', :'c_lone',
    null, null, '2026-08-05 18:00', :'perla', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('upravit: CIZÍ otevřený příchod + NÁŠ osamělý odchod',
  pg_temp.uprava(:'tenant', :'nas', :'c_open', :'n_lone',
    '2026-08-06 06:00', :'perla', null, null, 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

-- Bonus: p_employee je CIZÍ člověk, p_tenant naše firma. Tohle chytá
-- JINÁ kontrola (krok 2 funkce, e.tenant_id = p_tenant), ne ta, kterou
-- scénář hlídá — je tu, aby bylo vidět, že obě cesty (cizí člověk i cizí
-- záznam) jsou zavřené a každá svou větou.
select pg_temp.zkus('upravit: p_employee je cizí člověk pod naší firmou',
  pg_temp.uprava(:'tenant', :'cizinec', :'c_in', :'c_out',
    '2026-08-03 14:00', :'perla', '2026-08-03 15:00', :'perla', 'Krok72 útok'),
  'P0002', 'Takový zaměstnanec v téhle firmě není.');

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 3. stornovat_usek_dochazky s ID z CIZÍ firmy =============='

set role authenticated;
select set_config('test.user_id', :'majitel_user', false);

select pg_temp.zkus('storno: cizí uzavřený úsek (oba konce z firmy B)',
  pg_temp.storno(:'tenant', :'nas', :'c_in', :'c_out', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: smíšená dvojice — NÁŠ příchod + CIZÍ odchod',
  pg_temp.storno(:'tenant', :'nas', :'n_in', :'c_out', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: smíšená dvojice — CIZÍ příchod + NÁŠ odchod',
  pg_temp.storno(:'tenant', :'nas', :'c_in', :'n_out', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: samotný cizí otevřený příchod',
  pg_temp.storno(:'tenant', :'nas', :'c_open', null, 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: samotný cizí osamělý odchod',
  pg_temp.storno(:'tenant', :'nas', null, :'c_lone', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: NÁŠ otevřený příchod + CIZÍ osamělý odchod',
  pg_temp.storno(:'tenant', :'nas', :'n_open', :'c_lone', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: CIZÍ otevřený příchod + NÁŠ osamělý odchod',
  pg_temp.storno(:'tenant', :'nas', :'c_open', :'n_lone', 'Krok72 útok'),
  '22023', 'Mezitím to někdo změnil — obnovte stránku.');

select pg_temp.zkus('storno: p_employee je cizí člověk pod naší firmou',
  pg_temp.storno(:'tenant', :'cizinec', :'c_in', :'c_out', 'Krok72 útok'),
  'P0002', 'Takový zaměstnanec v téhle firmě není.');

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 4. Náhodná ID dávají TUTÉŽ odpověď jako cizí ==============='
-- Kdo zkouší cizí id, se nesmí dozvědět, že existuje: hláška i SQLSTATE
-- musí být u cizího a u neexistujícího id shodné (porovnává se celý text).

set role authenticated;
select set_config('test.user_id', :'majitel_user', false);

select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', :'c_in', :'c_out',
  '2026-08-03 14:00', :'perla', '2026-08-03 15:00', :'perla', 'Krok72 útok')) as u_cizi_usek \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', gen_random_uuid(), gen_random_uuid(),
  '2026-08-03 14:00', :'perla', '2026-08-03 15:00', :'perla', 'Krok72 útok')) as u_nahodny_usek \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', :'c_open', null,
  null, null, '2026-08-06 15:00', :'perla', 'Krok72 útok')) as u_cizi_open \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', gen_random_uuid(), null,
  null, null, '2026-08-06 15:00', :'perla', 'Krok72 útok')) as u_nahodny_open \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', null, :'c_lone',
  '2026-08-05 09:00', :'perla', null, null, 'Krok72 útok')) as u_cizi_lone \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', null, gen_random_uuid(),
  '2026-08-05 09:00', :'perla', null, null, 'Krok72 útok')) as u_nahodny_lone \gset
select pg_temp.pokus(pg_temp.uprava(:'tenant', :'nas', :'n_in', gen_random_uuid(),
  null, null, '2026-08-03 15:00', :'perla', 'Krok72 útok')) as u_smisene_nahodne \gset

select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', :'c_in', :'c_out', 'Krok72 útok')) as s_cizi_usek \gset
select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', gen_random_uuid(), gen_random_uuid(), 'Krok72 útok')) as s_nahodny_usek \gset
select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', :'c_open', null, 'Krok72 útok')) as s_cizi_open \gset
select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', gen_random_uuid(), null, 'Krok72 útok')) as s_nahodny_open \gset
select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', null, :'c_lone', 'Krok72 útok')) as s_cizi_lone \gset
select pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', null, gen_random_uuid(), 'Krok72 útok')) as s_nahodny_lone \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('upravit: cizí uzavřený úsek = náhodné id (stejný SQLSTATE i text)',
  :'u_cizi_usek' = :'u_nahodny_usek' and :'u_cizi_usek' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('upravit: cizí otevřený příchod = náhodné id',
  :'u_cizi_open' = :'u_nahodny_open' and :'u_cizi_open' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('upravit: cizí osamělý odchod = náhodné id',
  :'u_cizi_lone' = :'u_nahodny_lone' and :'u_cizi_lone' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('upravit: náš příchod + náhodný odchod → tatáž odpověď jako u cizího úseku',
  :'u_smisene_nahodne' = :'u_cizi_usek');
select pg_temp.check('storno: cizí uzavřený úsek = náhodné id',
  :'s_cizi_usek' = :'s_nahodny_usek' and :'s_cizi_usek' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('storno: cizí otevřený příchod = náhodné id',
  :'s_cizi_open' = :'s_nahodny_open' and :'s_cizi_open' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('storno: cizí osamělý odchod = náhodné id',
  :'s_cizi_lone' = :'s_nahodny_lone' and :'s_cizi_lone' like '22023|Mezitím to někdo změnil%');
select pg_temp.check('úprava i storno dávají u cizího id tutéž hlášku (žádný rozdíl, který by cizí záznam prozradil)',
  split_part(:'u_cizi_usek', '|', 2) = split_part(:'s_cizi_usek', '|', 2));


\echo ''
\echo '== 5. Po všech pokusech: cizí docházka jako při založení ====='

-- Absolutní porovnání se stavem ze založení (oddíly 2–4 měřily jen
-- „před a po" každého pokusu).
select pg_temp.check('cizí zaměstnanec má pořád přesně ty čtyři řádky (id, čas a druh jako při založení)',
  (select string_agg(id::text || '@' || occurred_at::text || '@' || kind, ',' order by id)
     from public.attendance_events where employee_id = :'cizinec') = :'c_zaklad'
  and (select count(*) from public.attendance_events where employee_id = :'cizinec') = 4
  and (select count(*) from public.attendance_events where tenant_id = :'tenant_b') = 4);
select pg_temp.check('žádný cizí záznam není stornovaný, nahrazený ani ruční; nic na ně neodkazuje',
  not exists (select 1 from public.attendance_events
               where tenant_id = :'tenant_b'
                 and (stornovano_kdy is not null or stornoval is not null or duvod_storna is not null
                      or nahrazuje is not null or source = 'manual' or entered_by is not null))
  and not exists (select 1 from public.attendance_events
                   where nahrazuje in (:'c_in', :'c_out', :'c_open', :'c_lone')));
select pg_temp.check('našemu zaměstnanci nepřibyl po útocích žádný řádek (9 = 8 + jediná náhrada z oddílu 1)',
  (select count(*) from public.attendance_events where employee_id = :'nas') = 9
  and (select count(*) from public.attendance_events where employee_id = :'nas' and source = 'manual') = 1);
select pg_temp.check('v auditu docházky jsou jen dvě operace z oddílu 1 (jedna úprava, jedno storno), žádná z útoků',
  (select count(*) from public.audit_log
    where action in ('attendance.usek_upraven', 'attendance.usek_stornovan')
      and tenant_id = :'tenant' and entity_id = :'nas') = 2
  and not exists (select 1 from public.audit_log where tenant_id = :'tenant_b' and action like 'attendance.usek_%'));

-- Záznamy, na které se útočilo, jsou pořád PLATNÉ — odmítnutí tedy nebylo
-- důsledkem rozbitých dat. Náš majitel stornuje všechny tři naše druhy
-- (uzavřený, otevřený, osamělý odchod), cizí majitel Xaver všechny tři své.
set role authenticated;
select set_config('test.user_id', :'majitel_user', false);
select pg_temp.check('pozitivně po útocích: majitel stornuje náš uzavřený úsek ze 3. 8.',
  pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', :'n_in', :'n_out', 'Krok72 úklid')) = 'PROSLO');
select pg_temp.check('pozitivně po útocích: majitel stornuje náš otevřený příchod ze 6. 8.',
  pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', :'n_open', null, 'Krok72 úklid')) = 'PROSLO');
select pg_temp.check('pozitivně po útocích: majitel stornuje náš osamělý odchod z 5. 8.',
  pg_temp.pokus(pg_temp.storno(:'tenant', :'nas', null, :'n_lone', 'Krok72 úklid')) = 'PROSLO');

select set_config('test.user_id', '72720000-0000-0000-0000-000000000003', false);
select pg_temp.check('pozitivně: cizí majitel Xaver stornuje cizí uzavřený úsek (platný, jen pro nás nedosažitelný)',
  pg_temp.pokus(pg_temp.storno(:'tenant_b', :'cizinec', :'c_in', :'c_out', 'Krok72 úklid')) = 'PROSLO');
select pg_temp.check('pozitivně: Xaver stornuje cizí otevřený příchod',
  pg_temp.pokus(pg_temp.storno(:'tenant_b', :'cizinec', :'c_open', null, 'Krok72 úklid')) = 'PROSLO');
select pg_temp.check('pozitivně: Xaver stornuje cizí osamělý odchod',
  pg_temp.pokus(pg_temp.storno(:'tenant_b', :'cizinec', null, :'c_lone', 'Krok72 úklid')) = 'PROSLO');
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po pozitivních stornech jsou stornované přesně ty záznamy, které měly být (naše čtyři, cizí čtyři)',
  (select count(*) from public.attendance_events
    where id in (:'n_in', :'n_out', :'n_open', :'n_lone', :'c_in', :'c_out', :'c_open', :'c_lone')
      and stornovano_kdy is not null) = 8);


\echo ''
\echo '== Úklid ====================================================='

reset role;
-- Záznamy pryč dřív než zaměstnanci (FK on delete restrict).
delete from public.attendance_events where employee_id in (:'nas', :'cizinec');
delete from public.employees where id in (:'nas', :'cizinec');

-- Firma B (a její pobočka a Xaver) ZŮSTÁVÁ, jako firmy v krok63. Smazat ji
-- nejde: Xaverova pozitivní storna (oddíl 5) zapsala do audit_log řádky
-- s branch_id její pobočky a `delete from tenants` / `delete from branches`
-- pak padá na "referential integrity query on "branches" from constraint
-- "audit_log_branch_id_fkey" … gave unexpected result" — FK audit_log.branch_id
-- je on delete set null, jenže pravidlo audit_log_no_update
-- (20260823120000_foundation.sql:325) UPDATE tiše zahodí a RI kontrola to
-- hlásí jako chybu. Stejně by padlo v ostré databázi (je to hláška PostgreSQL
-- pro pravidlo přepisující RI dotaz). Existující migraci tu NEOPRAVUJEME,
-- jde jen do hlášení.

select pg_temp.check('úklid: po scénáři nezůstal záznam docházky ani zaměstnanec z kroku 72',
  not exists (select 1 from public.employees where full_name in ('Naše Sedmdesátdva', 'Cizinec Sedmdesátdva'))
  and not exists (select 1 from public.attendance_events where tenant_id = :'tenant_b')
  and not exists (select 1 from public.attendance_events where employee_id in (:'nas', :'cizinec')));


