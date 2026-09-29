-- Scénář pro krok 64 — hromadná notifikace při vydání rozpisu, hromadné
-- potvrzení směn a explicitní odmítnutí s povinným důvodem.
--
-- Pokrývá migraci 20260929100000_smeny_potvrzeni_tabulka.sql.
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab s.r.o., pobočky Černá
-- Perla a Bernard Bar, majitel Vladislav Skoumal, vedoucí Klára Veselá
-- s shifts.manage jen na Perle) a krok40_scenar.sql (potvrdit_smenu —
-- tenhle scénář ho nemění, jen dokládá, že se nezměnil zápis pod ním).
-- Pouští se i samostatně: node scripts/scenare-pglite.mjs etapa0_scenar
-- krok40_scenar krok64_scenar.
--
-- ---------------------------------------------------------------------
-- ZADÁNÍ ŠÉFÍKA 29. 9. 2026 (doslovně)
--
-- „nastav aby při vydání směny se vyslala hromadná notifikace těm lidem
-- kterých se směna týká, zároveň možnost potvrzení všech směn a nebo
-- možnost nepotvrdit třeba jednu nebo více směn. chtělo by to potvrzovací
-- tabulku.“
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. vydat_rozpis notifikuje CENTRÁLNÍ CESTOU (app.notifikovat) —
--      končí ve frontě `notifikace_doruceni`, ne jen v `notifications`
--      (dřív šlo o přímý insert, který push nikdy nezaložil);
--   2. hromadné potvrzení (2+ směn najednou) přes
--      potvrdit_vsechny_moje_smeny — jen vydané a dosud nerozhodnuté,
--      je idempotentní a nevydanou/nesedící směnu přeskočí;
--   3. nevydaná směna nejde potvrdit ani odmítnout (PT409); totéž pro
--      vydanou směnu, kterou vedoucí POTÉ zrušil (status='cancelled',
--      published_* beze změny — přesně stav po public.smazat_smenu),
--      a to zvlášť pro odmitnout_smenu i potvrdit_vsechny_moje_smeny,
--      ne jen pro potvrdit_smenu (krok40, proměnná s_zrus);
--   4. odmítnutí vyžaduje důvod (prázdný i jen mezery selžou), cizí
--      směna a cizí tenant selžou (PT403);
--   5. přepnutí potvrzeno → odmítnuto → potvrzeno je symetrické, CHECK
--      na vzájemné vyloučení a na povinný důvod drží i nad přímým
--      zápisem;
--   6. notifikace při odmítnutí jde JEN lidem se shifts.manage na téhle
--      POBOČCE (vedoucí Perly i majitel jako vlastník), ne komukoli
--      jinému (vedoucí jiné pobočky, kolega bez práva, ten, kdo odmítl);
--   7. smeny_potvrzeni_pobocky vrací správný stav pro vedoucího a bez
--      práva tiše mlčí (žádná chyba, prázdný výsledek);
--   8. audit a granty (pomocnou funkci nevolá zvenku nikdo).
--
-- POZOR NA PGLITE: superuživatel, bez RLS a sloupcových grantů — co je
-- tu měřeno katalogem (grant/RLS zapnutá), rozhoduje až CI proti
-- PostgreSQL 16 (workflow „Migrace a scénáře“).

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

reset role;
-- Předchozí scénář (v PGlite v témže sezení) nechává test.user_id
-- nastavené — bez tohohle by přímé dotazy spadly na cizí kontrole.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

select set_config('test.tenant', :'tenant', false);

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

-- Majitel a vedoucí mají zaměstnanecký záznam už z etapa0 (create_tenant
-- / přijatá pozvánka) — insert je jen pojistka pro samostatné spuštění.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'vedouci', 'Účet Vedoucí', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'vedouci');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'majitel', 'Účet Majitel', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'majitel');

select id as e_vedouci from public.employees where tenant_id = :'tenant' and user_id = :'vedouci' limit 1 \gset
select id as e_majitel from public.employees where tenant_id = :'tenant' and user_id = :'majitel' limit 1 \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('64640000-0000-0000-0000-000000000001', 'petra64@foodtab.cz',   '{"full_name":"Petra Šedesátčtyři"}'),
  ('64640000-0000-0000-0000-000000000002', 'bedrich64@foodtab.cz', '{"full_name":"Bedřich Šedesátčtyři"}'),
  ('64640000-0000-0000-0000-000000000003', 'kolega64@foodtab.cz',  '{"full_name":"Kolega Šedesátčtyři"}');

-- Petra: obyčejná zaměstnankyně Perly, bez zvláštních práv — na ní se
-- zkouší hromadné potvrzení a odmítnutí.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '64640000-0000-0000-0000-000000000001', 'Petra Šedesátčtyři', 'hpp')
returning id as e_petra \gset

-- Kolega: taky na Perle, taky bez shifts.manage — dokazuje, že
-- notifikace při odmítnutí nejde jen tak někomu na pobočce, ale jen
-- lidem s právem.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '64640000-0000-0000-0000-000000000003', 'Kolega Šedesátčtyři', 'hpp')
returning id as e_kolega \gset

-- Bedřich: vede Bernard Bar (shifts.manage JEN tam) — dokazuje, že
-- notifikace o odmítnutí na Perle nejde vedoucímu JINÉ pobočky.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska64_vedeni', 'Zkouška 64 — vedení baru', 'provoz', true)
returning id as z_vedeni \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_vedeni', 'shifts.manage');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'bar', '64640000-0000-0000-0000-000000000002', :'z_vedeni', 'Bedřich Šedesátčtyři', 'hpp')
returning id as e_bedrich \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '64640000-0000-0000-0000-000000000001', null, 'branch', 'active'),
  (:'tenant', '64640000-0000-0000-0000-000000000002', null, 'branch', 'active'),
  (:'tenant', '64640000-0000-0000-0000-000000000003', null, 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = '64640000-0000-0000-0000-000000000002'
                  then :'bar'::uuid else :'perla'::uuid end
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.scope = 'branch'
   and m.user_id::text like '64640000-0000-0000-0000-00000000000%';

-- Petřin telefon — bez předplatného push by `app.zaradit_doruceni`
-- nezaložil do fronty doručení vůbec nic a bod 1 by nic neměřil.
set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/krok64-petra',
                                'klic-p256dh-petra-64', 'auth-petra-64');
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 0. Příprava měří to, co má ============================='

select set_config('test.user_id', '64640000-0000-0000-0000-000000000002', false);
select pg_temp.check('Bedřich vede Bar', app.has_access(:'tenant', 'shifts.manage', :'bar'));
select pg_temp.check('… a NE Perlu', not app.has_access(:'tenant', 'shifts.manage', :'perla'));

select set_config('test.user_id', '64640000-0000-0000-0000-000000000003', false);
select pg_temp.check('Kolega nemá shifts.manage nikde',
  not app.has_access(:'tenant', 'shifts.manage', :'perla')
  and not app.has_access(:'tenant', 'shifts.manage', :'bar'));

select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('vedoucí (Klára) vede Perlu, ne Bar',
  app.has_access(:'tenant', 'shifts.manage', :'perla')
  and not app.has_access(:'tenant', 'shifts.manage', :'bar'));

select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel má shifts.manage na obou (vlastník)',
  app.has_access(:'tenant', 'shifts.manage', :'perla')
  and app.has_access(:'tenant', 'shifts.manage', :'bar'));

select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Vydání rozpisu: hromadná notifikace centrální cestou =='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s1 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-07', time '08:00', time '16:00', 'krok64 první') \gset
select smena as s2 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-08', time '08:00', time '16:00', 'krok64 druhá') \gset
-- Koncept: schválně BEZ vydání, mimo okno níž — na něm se zkouší PT409.
select smena as s4 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-20', time '08:00', time '16:00', 'krok64 koncept') \gset

select public.vydat_rozpis(:'tenant', :'perla', date '2026-12-01', date '2026-12-08') as zprav_a \gset
reset role;

select pg_temp.check('vydání ohlásí jednu zprávu (Petra — obě její směny v jedné)', :'zprav_a'::int = 1);

select id as notif_a, telo as telo_a from public.notifications
 where druh = 'rozpis.vydan' and user_id = '64640000-0000-0000-0000-000000000001'
 order by created_at desc limit 1 \gset

select pg_temp.check('Petra dostala PRÁVĚ JEDNU rozpis.vydan (ne dvě, po jedné za směnu)',
  (select count(*) from public.notifications
    where druh = 'rozpis.vydan' and user_id = '64640000-0000-0000-0000-000000000001') = 1);
select pg_temp.check('… a nese OBĚ směny v jednom těle',
  jsonb_array_length(:'telo_a'::jsonb -> 'zmeny') = 2);
select pg_temp.check('vydávající (majitel) sám sobě nepíše',
  not exists (select 1 from public.notifications where druh = 'rozpis.vydan' and user_id = :'majitel'::uuid));

-- Přesně tohle je ten dluh, který migrace 20260929100000 splácí: dřív šlo
-- o přímý insert do notifications, který app.zaradit_doruceni (a tedy
-- frontu k odeslání) nikdy nezavolal.
select pg_temp.check('… a KONČÍ VE FRONTĚ DORUČENÍ (centrální cesta, ne přímý insert)',
  exists (select 1 from public.notifikace_doruceni where notification_id = :'notif_a'));


\echo ''
\echo '== 1b. Pozastavené členství: náhled i počet o něm nevědí ===='

-- Nález nezávislé kontroly 29. 9. 2026: employees.deleted_at a
-- memberships.status jsou dvě různé věci — zaměstnanecký řádek po
-- pozastavení zůstává. app.notifikovat (20260921100000) pozastavenému
-- mlčky nezaloží nic; app.rozdil_rozpisu (a tedy rozpis_nahled i
-- v_zprav z vydat_rozpis, bod 7b migrace 20260929100000) to musí vědět
-- taky, jinak by náhled slíbil zprávu, která reálně nikam nedojde.

reset role;
select set_config('test.user_id', '', false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('64640000-0000-0000-0000-000000000004', 'slavka64@foodtab.cz', '{"full_name":"Slávka Šedesátčtyři"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '64640000-0000-0000-0000-000000000004', 'Slávka Šedesátčtyři', 'hpp')
returning id as e_slavka \gset

-- Pozastavené rovnou při vzniku — nejde o to zkoušet přechod, jen stav.
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '64640000-0000-0000-0000-000000000004', null, 'branch', 'suspended')
returning id as m_slavka \gset

insert into public.membership_branches (membership_id, branch_id) values (:'m_slavka', :'perla');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_slavka from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_slavka', null,
  date '2026-12-13', time '08:00', time '16:00', 'krok64 pozastavená') \gset

select count(*)::int as pocet_slavka_nahled
  from public.rozpis_nahled(:'tenant', :'perla', date '2026-12-13', date '2026-12-13')
 where user_id = '64640000-0000-0000-0000-000000000004'::uuid \gset

select pg_temp.check('pozastavený člen se v náhledu vůbec neobjeví, i když má vydávanou směnu',
  :'pocet_slavka_nahled'::int = 0);

select public.vydat_rozpis(:'tenant', :'perla', date '2026-12-13', date '2026-12-13') as zprav_slavka \gset
reset role;

select pg_temp.check('… a vydání za tenhle den nenahlásí žádnou zprávu (jediný dotčený je pozastavený)',
  :'zprav_slavka'::int = 0);
select pg_temp.check('… v notifications pro ni skutečně nic není (i kdyby počet lhal, tohle je pravda)',
  not exists (select 1 from public.notifications
    where druh = 'rozpis.vydan' and user_id = '64640000-0000-0000-0000-000000000004'));


\echo ''
\echo '== 2. Hromadné potvrzení (2+ směn najednou) ================'

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.potvrdit_vsechny_moje_smeny(:'tenant') as pocet_1 \gset
reset role;

select pg_temp.check('hromadné potvrdí obě vydané, dosud nerozhodnuté směny', :'pocet_1'::int = 2);
select pg_temp.check('obě jsou vidět jako potvrzené, s opisem',
  (select count(*) from public.smeny_potvrzeni
    where shift_id in (:'s1', :'s2') and employee_id = :'e_petra'
      and confirmed_at is not null and rejected_at is null) = 2);

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.potvrdit_vsechny_moje_smeny(:'tenant') as pocet_2 \gset
reset role;

select pg_temp.check('podruhé nemá co potvrzovat (idempotentní, ne chyba)', :'pocet_2'::int = 0);


\echo ''
\echo '== 3. Nevydaná směna: PT409, hromadné ji přeskočí =========='

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select pg_temp.check('nevydaný koncept nejde potvrdit',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_smenu(%L, %L, date %L, time %L, time %L)',
    :'tenant', :'s4', '2026-12-20', '08:00', '16:00'),
    'PT409', 'není vydaná'));
select pg_temp.check('… ani odmítnout',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)',
    :'tenant', :'s4', 'nemám čas'),
    'PT409', 'není vydaná'));
select pg_temp.check('… a nic se nezapsalo',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s4'));

select public.potvrdit_vsechny_moje_smeny(:'tenant') as pocet_3 \gset
reset role;
select pg_temp.check('hromadné potvrzení nevydaný koncept mlčky přeskočí (ne chyba, ne zápis)',
  :'pocet_3'::int = 0);


\echo ''
\echo '== 3b. Vydaná směna zrušená AŽ PO vydání: taky PT409/přeskočí =='

-- Nález nezávislé kontroly 29. 9. 2026: kontrola „je směna vydaná a
-- nezrušená?" se v migraci 20260929100000 opakuje třikrát (potvrdit_smenu,
-- odmitnout_smenu, potvrdit_vsechny_moje_smeny) a krok40 ji pro tenhle
-- konkrétní tvar (vydaná, pak zrušená přes status — published_* zůstávají
-- beze změny, přesně jako po public.smazat_smenu) cvičí jen u
-- potvrdit_smenu. Tady se stejný stav zkouší i u zbylých dvou cest —
-- schválné rozbití (odstranění „v_s.status = 'cancelled' or" resp.
-- „s.status <> 'cancelled'") tuhle mezeru chytí, sekce 3 výš (nevydaný
-- koncept) ne, protože je to jiná větev podmínky.

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_zrus64 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-15', time '08:00', time '16:00', 'krok64 zrušená po vydání') \gset

select public.vydat_rozpis(:'tenant', :'perla', date '2026-12-15', date '2026-12-15');
reset role;

-- Přímý update status, ne public.smazat_smenu: ta na vydané směně taky
-- mění jen status (viz migrace o mazání směn), tohle je kratší cesta ke
-- stejnému výslednému stavu řádku.
update public.shifts set status = 'cancelled' where id = :'s_zrus64';

select pg_temp.check('… published_* opravdu zůstaly (jinak by test neměřil, co má)',
  (select published_at is not null and published_status <> 'cancelled'
     from public.shifts where id = :'s_zrus64'));

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select pg_temp.check('vydaná a POTÉ zrušená směna: odmítnout nejde',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)',
    :'tenant', :'s_zrus64', 'nemám čas'),
    'PT409', 'není vydaná'));
select pg_temp.check('… a nic se nezapsalo',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_zrus64'));

select public.potvrdit_vsechny_moje_smeny(:'tenant') as pocet_3b \gset
reset role;

select pg_temp.check('hromadné potvrzení vydanou a POTÉ zrušenou směnu taky mlčky přeskočí',
  :'pocet_3b'::int = 0);
select pg_temp.check('… a nezaložilo pro ni řádek',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_zrus64'));


\echo ''
\echo '== 4. Druhé okno: individuální potvrzení/odmítnutí ========='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s3 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-09', time '08:00', time '16:00', 'krok64 tam a zpět') \gset
select smena as s5 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_petra', null,
  date '2026-12-11', time '08:00', time '16:00', 'krok64 odmítnutá') \gset
-- Cizí směna (patří Kláře) — na ní se zkouší, že Petra na ni nedosáhne.
select smena as s_cizi from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_vedouci', null,
  date '2026-12-10', time '08:00', time '16:00', 'krok64 cizí') \gset

select public.vydat_rozpis(:'tenant', :'perla', date '2026-12-09', date '2026-12-11');
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 5. Přepnutí potvrzeno <-> odmítnuto je symetrické ========'

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select public.potvrdit_smenu(:'tenant', :'s3', date '2026-12-09', time '08:00', time '16:00') as kdy1 \gset
select pg_temp.check('s3 potvrzená poprvé', :'kdy1' is not null);

select public.odmitnout_smenu(:'tenant', :'s3', 'Změna plánů') as id_odm \gset
reset role;

select pg_temp.check('po odmítnutí confirmed_at zmizí a rejected_at se objeví',
  (select confirmed_at is null and rejected_at is not null and rejected_reason = 'Změna plánů'
   from public.smeny_potvrzeni where shift_id = :'s3' and employee_id = :'e_petra'));
select pg_temp.check('pořád jeden řádek (přepsání, ne druhý záznam)',
  (select count(*) from public.smeny_potvrzeni where shift_id = :'s3' and employee_id = :'e_petra') = 1);

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.potvrdit_smenu(:'tenant', :'s3', date '2026-12-09', time '08:00', time '16:00') as kdy2 \gset
reset role;

select pg_temp.check('a zase zpátky na potvrzeno — s NOVÝM časem, ne starým',
  (select confirmed_at is not null and rejected_at is null
   from public.smeny_potvrzeni where shift_id = :'s3' and employee_id = :'e_petra')
  and :'kdy2' <> :'kdy1');


\echo ''
\echo '== 6. Odmítnutí: povinný důvod ============================='

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select pg_temp.check('prázdný důvod selže',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)', :'tenant', :'s5', ''),
    '23514', 'Napište důvod odmítnutí'));
select pg_temp.check('jen mezery taky selžou (ořezává se před kontrolou)',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)', :'tenant', :'s5', '   '),
    '23514', 'Napište důvod odmítnutí'));
select pg_temp.check('… a nic se nezapsalo',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s5'));

reset role;


\echo ''
\echo '== 7. Odmítnutí: notifikace JEN vedoucímu pobočky =========='

-- Před odmítnutím: nikdo z hlídaných lidí nemá „smena.odmitnuta“ k s5.
select pg_temp.check('příprava: čisto — nikdo zatím smena.odmitnuta k s5 nemá',
  not exists (select 1 from public.notifications where druh = 'smena.odmitnuta' and zdroj_id = :'s5'));

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.odmitnout_smenu(:'tenant', :'s5', '  Jsem nemocná  ') as id_s5 \gset
reset role;

select pg_temp.check('odmítnutí uspělo a vrátilo id záznamu', :'id_s5' is not null);
select pg_temp.check('důvod se uloží OŘEZANÝ (bez okolních mezer)',
  (select rejected_reason from public.smeny_potvrzeni where shift_id = :'s5') = 'Jsem nemocná');

select pg_temp.check('vedoucí Perly (Klára) dostala smena.odmitnuta — jednu',
  (select count(*) from public.notifications
    where druh = 'smena.odmitnuta' and user_id = :'vedouci'::uuid and zdroj_id = :'s5') = 1);
select pg_temp.check('majitel (vlastník, i bez výslovného shifts.manage) taky',
  (select count(*) from public.notifications
    where druh = 'smena.odmitnuta' and user_id = :'majitel'::uuid and zdroj_id = :'s5') = 1);
select pg_temp.check('… a tělo nese den, čas a důvod',
  exists (select 1 from public.notifications
           where druh = 'smena.odmitnuta' and user_id = :'vedouci'::uuid and zdroj_id = :'s5'
             and telo ->> 'duvod' = 'Jsem nemocná' and telo ->> 'od' = '08:00' and telo ->> 'do' = '16:00'));

select pg_temp.check('Bedřich (vede JEN Bar) nedostal NIC',
  not exists (select 1 from public.notifications
               where druh = 'smena.odmitnuta'
                 and user_id = '64640000-0000-0000-0000-000000000002' and zdroj_id = :'s5'));
select pg_temp.check('Kolega (na Perle, bez shifts.manage) taky nic',
  not exists (select 1 from public.notifications
               where druh = 'smena.odmitnuta'
                 and user_id = '64640000-0000-0000-0000-000000000003' and zdroj_id = :'s5'));
select pg_temp.check('Petra (odmítla sama) sama sobě nepíše',
  not exists (select 1 from public.notifications
               where druh = 'smena.odmitnuta'
                 and user_id = '64640000-0000-0000-0000-000000000001' and zdroj_id = :'s5'));

select pg_temp.check('v auditu je smena.odmitnuta s důvodem',
  exists (select 1 from public.audit_log
           where action = 'smena.odmitnuta' and entity_id = :'s5'::text
             and after ->> 'duvod' = 'Jsem nemocná'));

/*
  Zjištěné chování (ne chyba k opravě v tomhle kroku — mimo zadání):
  odmitnout_smenu nemá dedupe klíč (na rozdíl od rozpis.vydan). Opakované
  odmítnutí STEJNÉ směny se STEJNÝM důvodem je dovolené (bod „symetricky
  jde vzít zpět“) a pokaždé pošle DALŠÍ upozornění vedoucímu — i když se
  v `smeny_potvrzeni` nic nezmění. Scénář to jen zaznamenává, ať se
  chování nezmění tiše.
*/
set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);
select public.odmitnout_smenu(:'tenant', :'s5', 'Jsem nemocná') as id_s5_znovu \gset
reset role;

select pg_temp.check('opakované odmítnutí se stejným důvodem: řádek v smeny_potvrzeni beze změny',
  :'id_s5_znovu' = :'id_s5');
select pg_temp.check('… ale POŠLE DALŠÍ upozornění vedoucímu (žádný dedupe klíč — zjištěné chování)',
  (select count(*) from public.notifications
    where druh = 'smena.odmitnuta' and user_id = :'vedouci'::uuid and zdroj_id = :'s5') = 2);


\echo ''
\echo '== 8. Cizí směna a cizí tenant selžou ======================'

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí směnu (patří Kláře) Petra nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_smenu(%L, %L, date %L, time %L, time %L)',
    :'tenant', :'s_cizi', '2026-12-10', '08:00', '16:00'),
    'PT403', 'nemůžete potvrdit'));
select pg_temp.check('… ani odmítnout',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)',
    :'tenant', :'s_cizi', 'zkouška'),
    'PT403', 'nemůžete odmítnout'));
select pg_temp.check('neexistující směna dá tutéž odpověď jako cizí',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)',
    :'tenant', gen_random_uuid()::text, 'zkouška'),
    'PT403', 'nemůžete odmítnout'));
select pg_temp.check('… a cizí směna zůstala nedotčená',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_cizi'));

-- Náhodný tenant: Petra v něm nemá ani ČLENSTVÍ, takže spadne hned na
-- prvním testu obou funkcí (app.modul_zapnuty — bez aktivního členství
-- v TÉHLE firmě vrátí false dřív, než se vůbec podívá na zaměstnance).
select pg_temp.check('cizí tenant: hromadné potvrzení odmítnuto',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_vsechny_moje_smeny(%L)', gen_random_uuid()::text),
    'PT403', 'nemůžete potvrzovat'));
select pg_temp.check('cizí tenant: odmítnutí taky (i se správným id směny)',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_smenu(%L, %L, %L)',
    gen_random_uuid()::text, :'s3', 'zkouška'),
    'PT403', 'nemůžete odmítat'));

reset role;


\echo ''
\echo '== 9. CHECK: vzájemné vyloučení a povinný důvod ============'

-- Přímý zápis (superuživatel PGlite/psql) — CHECK platí bez ohledu na
-- roli a RLS, na rozdíl od nich se dá ověřit i tady. s3 je teď potvrzená
-- (oddíl 5) — na jejím řádku se zkouší rozbít oba CHECKy přímým UPDATE.
-- `test.*` proměnné se nastaví PŘED `do $$` blokem, který je čte —
-- psql proměnná dovnitř `do $$` bloku nejde, viz skill scenar, bod 5.
select set_config('test.s3', :'s3', false);
select set_config('test.e_petra', :'e_petra', false);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.smeny_potvrzeni
       set rejected_at = now(), rejected_reason = 'obojí najednou'
     where shift_id = current_setting('test.s3')::uuid
       and employee_id = current_setting('test.e_petra')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: confirmed_at i rejected_at šlo mít vyplněné naráz'; end if;
  raise notice '  OK    CHECK drží: potvrzení a odmítnutí se vzájemně vylučují';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    update public.smeny_potvrzeni
       set rejected_at = now(), confirmed_at = null, rejected_reason = ''
     where shift_id = current_setting('test.s3')::uuid
       and employee_id = current_setting('test.e_petra')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: odmítnutí s prázdným důvodem prošlo přímým zápisem'; end if;
  raise notice '  OK    CHECK drží: rejected_at bez důvodu neprojde';
end $$;

-- Řádek s3 zůstává v posledním PLATNÉM stavu (potvrzeno, z oddílu 5) —
-- oba pokusy výš spadly na CHECK, takže se nic nezapsalo.
select pg_temp.check('s3 zůstala potvrzená (oba pokusy o rozbití spadly, nic se nezapsalo)',
  (select confirmed_at is not null and rejected_at is null
   from public.smeny_potvrzeni where shift_id = :'s3' and employee_id = :'e_petra'));


\echo ''
\echo '== 10. moje_smeny_k_potvrzeni: konečné stavy ================'

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000001', false);

select stav as stav_s1 from public.moje_smeny_k_potvrzeni(:'tenant') where shift_id = :'s1' \gset
select stav as stav_s3 from public.moje_smeny_k_potvrzeni(:'tenant') where shift_id = :'s3' \gset
select stav as stav_s5, rejected_reason as duvod_s5 from public.moje_smeny_k_potvrzeni(:'tenant') where shift_id = :'s5' \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('s1: potvrzeno (hromadně)', :'stav_s1' = 'potvrzeno');
select pg_temp.check('s3: potvrzeno (po zpáteční cestě)', :'stav_s3' = 'potvrzeno');
select pg_temp.check('s5: odmítnuto, s důvodem', :'stav_s5' = 'odmitnuto' and :'duvod_s5' = 'Jsem nemocná');
select pg_temp.check('s4 (koncept, nevydaný) se v seznamu vůbec neobjeví',
  not exists (select 1 from public.moje_smeny_k_potvrzeni(:'tenant') where shift_id = :'s4'));


\echo ''
\echo '== 11. smeny_potvrzeni_pobocky: stav pro vedoucího ========='

set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select stav as pobocka_stav_s1 from public.smeny_potvrzeni_pobocky(
  :'tenant', :'perla', date '2026-12-01', date '2026-12-20') where shift_id = :'s1' \gset
select stav as pobocka_stav_s5, rejected_reason as pobocka_duvod_s5 from public.smeny_potvrzeni_pobocky(
  :'tenant', :'perla', date '2026-12-01', date '2026-12-20') where shift_id = :'s5' \gset
select stav as pobocka_stav_cizi from public.smeny_potvrzeni_pobocky(
  :'tenant', :'perla', date '2026-12-01', date '2026-12-20') where shift_id = :'s_cizi' \gset

reset role;

select pg_temp.check('vedoucí Perly vidí Petřinu potvrzenou směnu', :'pobocka_stav_s1' = 'potvrzeno');
select pg_temp.check('… i odmítnutou, s důvodem',
  :'pobocka_stav_s5' = 'odmitnuto' and :'pobocka_duvod_s5' = 'Jsem nemocná');
select pg_temp.check('… i tu svou (Klářinu, nikdy nerozhodnutou)', :'pobocka_stav_cizi' = 'ceka');

-- Bez shifts.manage na téhle pobočce: tiše prázdno, ne chyba (vzor zalohy_pobocky).
set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000003', false);
select pg_temp.check('Kolega (bez shifts.manage) na Perle nevidí nic — i když tam vydané směny jsou',
  not exists (select 1 from public.smeny_potvrzeni_pobocky(
    :'tenant', :'perla', date '2026-12-01', date '2026-12-20')));
reset role;

set role authenticated;
select set_config('test.user_id', '64640000-0000-0000-0000-000000000002', false);
select pg_temp.check('Bedřich (vede jen Bar) na PERLE taky nic nevidí',
  not exists (select 1 from public.smeny_potvrzeni_pobocky(
    :'tenant', :'perla', date '2026-12-01', date '2026-12-20')));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 11b. Vedoucí odmítne SVOU vlastní směnu — nepíše sama sobě'

/*
  Oddíl 7 dokázal, že Petra (bez shifts.manage) svou notifikaci nedostane
  — ale to je pravda, i kdyby výluka volajícího v odmitnout_smenu chyběla
  úplně, protože Petra stejně není v `kdo_ma_pravo_na_pobocce`. Skutečnou
  pojistku „kromě volajícího“ prověří jen člověk, který PRÁVO MÁ a
  odmítá VLASTNÍ směnu — to je Klára (s_cizi, vede Perlu). Bez týhle
  kontroly by šlo řádek `where k.user_id is distinct from (select
  auth.uid())` z migrace vyndat a scénář by to neřekl (ověřeno schválným
  rozbitím: mutace prošla, dokud tahle část chyběla).
*/
select pg_temp.check('příprava: s_cizi je pořád nerozhodnutá (jen se čekalo s testem)',
  not exists (select 1 from public.smeny_potvrzeni where shift_id = :'s_cizi'));

set role authenticated;
select set_config('test.user_id', :'vedouci', false);
select public.odmitnout_smenu(:'tenant', :'s_cizi', 'Klářin vlastní důvod') as id_vlastni \gset
reset role;

select pg_temp.check('Klára odmítla svou vlastní vydanou směnu', :'id_vlastni' is not null);
select pg_temp.check('majitel (taky shifts.manage na Perle) se to dozví',
  (select count(*) from public.notifications
    where druh = 'smena.odmitnuta' and user_id = :'majitel'::uuid and zdroj_id = :'s_cizi') = 1);
select pg_temp.check('ale KLÁRA SAMA SOBĚ NEPÍŠE, i když shifts.manage na Perle má',
  not exists (select 1 from public.notifications
               where druh = 'smena.odmitnuta'
                 and user_id = :'vedouci'::uuid and zdroj_id = :'s_cizi'));

select set_config('test.user_id', '', false);


\echo ''
\echo '== 12. Audit, granty a pomocná funkce ======================'

select pg_temp.check('audit_zmenu se vede i na smeny_potvrzeni (insert i update)',
  exists (select 1 from public.audit_log where action = 'smena_potvrzeni.insert')
  and exists (select 1 from public.audit_log where action = 'smena_potvrzeni.update'));

select pg_temp.check('app.zapsat_potvrzeni_smeny zvenku nevolá nikdo',
  not has_function_privilege('authenticated',
    'app.zapsat_potvrzeni_smeny(public.shifts, uuid, text, text)', 'execute')
  and not has_function_privilege('anon',
    'app.zapsat_potvrzeni_smeny(public.shifts, uuid, text, text)', 'execute'));

select pg_temp.check('nové RPC: přihlášený smí, anonym ne',
  has_function_privilege('authenticated', 'public.potvrdit_vsechny_moje_smeny(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_vsechny_moje_smeny(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.odmitnout_smenu(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.odmitnout_smenu(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.moje_smeny_k_potvrzeni(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.moje_smeny_k_potvrzeni(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.smeny_potvrzeni_pobocky(uuid, uuid, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.smeny_potvrzeni_pobocky(uuid, uuid, date, date)', 'execute'));

select pg_temp.check('potvrdit_smenu (beze změny signatury): granty jako dřív',
  has_function_privilege('authenticated', 'public.potvrdit_smenu(uuid, uuid, date, time, time, time, time)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_smenu(uuid, uuid, date, time, time, time, time)', 'execute'));

select pg_temp.check('nové sloupce (rejected_at, rejected_reason) čte přihlášený',
  has_column_privilege('authenticated', 'public.smeny_potvrzeni', 'rejected_at', 'select')
  and has_column_privilege('authenticated', 'public.smeny_potvrzeni', 'rejected_reason', 'select'));
select pg_temp.check('… ale nezapisuje je přímo',
  not has_column_privilege('authenticated', 'public.smeny_potvrzeni', 'rejected_at', 'update')
  and not has_column_privilege('authenticated', 'public.smeny_potvrzeni', 'rejected_reason', 'update'));


\echo ''
\echo '== Úklid ===================================================='

select set_config('test.user_id', '', false);

delete from public.audit_log
 where entity_id in (:'s1', :'s2', :'s3', :'s4', :'s5', :'s_cizi', :'s_zrus64', :'s_slavka')
    or (entity_type = 'smena_potvrzeni'
        and (before ->> 'employee_id' in (:'e_petra', :'e_kolega', :'e_bedrich', :'e_slavka')
             or after  ->> 'employee_id' in (:'e_petra', :'e_kolega', :'e_bedrich', :'e_slavka')));
delete from public.notifikace_doruceni
 where user_id::text like '64640000-0000-0000-0000-00000000000%'
    or notification_id in (select id from public.notifications where zdroj_id in (:'s1', :'s2', :'s3', :'s5', :'s_cizi'));
delete from public.notifications
 where user_id::text like '64640000-0000-0000-0000-00000000000%'
    or zdroj_id in (:'s1', :'s2', :'s3', :'s5', :'s_cizi')
    or (druh = 'rozpis.vydan' and user_id in (:'vedouci'::uuid));
delete from public.push_odbery where user_id::text like '64640000-0000-0000-0000-00000000000%';
delete from public.smeny_potvrzeni where shift_id in (:'s1', :'s2', :'s3', :'s4', :'s5', :'s_cizi', :'s_zrus64', :'s_slavka');
delete from public.shifts where id in (:'s1', :'s2', :'s3', :'s4', :'s5', :'s_cizi', :'s_zrus64', :'s_slavka');
delete from public.membership_branches
 where membership_id in (select id from public.memberships
   where tenant_id = :'tenant' and user_id::text like '64640000-0000-0000-0000-00000000000%');
delete from public.memberships
 where tenant_id = :'tenant' and user_id::text like '64640000-0000-0000-0000-00000000000%';
delete from public.employees where id in (:'e_petra', :'e_kolega', :'e_bedrich', :'e_slavka');
delete from public.position_permissions where position_id = :'z_vedeni';
delete from public.positions where id = :'z_vedeni';

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 64',
  not exists (select 1 from public.employees where full_name like '%Šedesátčtyři')
  and not exists (select 1 from public.shifts where note like 'krok64%')
  and not exists (select 1 from public.notifications
                   where user_id::text like '64640000-0000-0000-0000-00000000000%')
  and not exists (select 1 from public.positions where id = :'z_vedeni'));

\echo ''
\echo '== KROK 64 HOTOV ========================================='
