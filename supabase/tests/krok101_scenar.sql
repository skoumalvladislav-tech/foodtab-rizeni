-- Scénář pro krok 101 — jedna záloha se nezapíše dvakrát.
--
-- Pokrývá migraci 20261025100000_zalohy_jedno_odeslani.sql.
--
-- Navazuje na etapa0_scenar.sql až krok100_scenar.sql (seed firmy,
-- poboček Černá Perla / Bernard Bar a majitele).
--
-- ---------------------------------------------------------------------
-- HLÁŠENÍ (25. 10. 2026)
--
-- „Odečítání záloh se zdvojovalo." Týž den nešel na provozovně
-- internet. Výpočty zálohu dvakrát nesčítají; dvakrát se ZAPSALA —
-- odpověď se ztratila, obsluha vyplatila znovu.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. totéž odeslání (p_klic) podruhé: jedna záloha, vrátí se ta první
--      s opakovane = true, audit i upozornění jen jednou, varování
--      stejné jako napoprvé;
--   2. bez p_klic jako dřív (dvě volání = dvě zálohy) a jiné číslo =
--      nová záloha — dvě zálohy týž den jsou běžné;
--   3. číslo, které patří jiné záloze (jiná osoba, částka, pobočka,
--      vydávající): výplata spadne a nic se nezapíše;
--   4. právo se ptá PRVNÍ: kdo ho nemá, nedozví se, že číslo existuje;
--   5. opakování po pozastavení vrátí zapsanou zálohu, nespadne;
--   6. číslo je jedinečné ve FIRMĚ, ne napříč firmami;
--   7. granty: jedna výplata, přihlášený ano, anonym ne, pomocná funkce
--      zavřená. Čtení sloupce klic_odeslani se schválně NEkontroluje —
--      na Supabase ho výchozí práva pustí a lokálně ne (hlavička migrace).
--
-- SOUBĚH (dvě volání se stejným číslem NARÁZ) se v jednom psql spojení
-- napodobit nedá. Větev `on conflict … do nothing` + druhé hledání je
-- vyzkoušená dvěma spojeními při vývoji (hlášení 2026-10-25) a v textu
-- migrace ji hlídá scripts/zalohy.test.mjs.
--
-- POZOR NA PGLITE: běží jako superuživatel, RLS ani granty se tam
-- neuplatní. Tady nevadí — měří se uvnitř definer funkcí a granty se
-- čtou katalogem.

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

-- Projde příkaz BEZ výjimky? Když ne, ať to spadne pojmenovanou
-- kontrolou s důvodem, ne holou výjimkou uprostřed scénáře.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('10110000-0000-0000-0000-000000000001', 'juli101@foodtab.cz', '{"full_name":"Juli Stojedna"}'),
  ('10110000-0000-0000-0000-000000000002', 'hana101@foodtab.cz', '{"full_name":"Hana Stojedna"}'),
  ('10110000-0000-0000-0000-000000000003', 'ivan101@foodtab.cz', '{"full_name":"Ivan Stojedna"}'),
  ('10110000-0000-0000-0000-000000000004', 'adam101@foodtab.cz', '{"full_name":"Adam Stojedna"}');

-- Juli vyplácí zálohy na Perle (právo dává zařazení).
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska101_obsluha', 'Zkouška 101 — obsluha', 'servis', true)
returning id as z_obsluha \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_obsluha', 'advances.manage');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '10110000-0000-0000-0000-000000000001', :'z_obsluha', 'Juli Stojedna', 'hpp')
returning id as juli \gset

-- Hana: z Perly, bez práva na zálohy.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '10110000-0000-0000-0000-000000000002', 'Hana Stojedna', 'hpp')
returning id as hana \gset

-- Ivan: zálohy smí v celé firmě — jiný vydávající s právem.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '10110000-0000-0000-0000-000000000003', 'Ivan Stojedna', 'hpp')
returning id as ivan \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'ivan', 'advances.manage', true);

-- Komu se vyplácí. Adam má účet a členství, aby se dalo spočítat
-- upozornění (app.notifikovat píše jen členům).
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '10110000-0000-0000-0000-000000000004', 'Adam Stojedna', 'hpp')
returning id as adam \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bedřich Stojedna', 'hpp')
returning id as bedrich \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '10110000-0000-0000-0000-000000000001', null, 'branch', 'active'),
  (:'tenant', '10110000-0000-0000-0000-000000000002', null, 'branch', 'active'),
  (:'tenant', '10110000-0000-0000-0000-000000000003', null, 'tenant', 'active'),
  (:'tenant', '10110000-0000-0000-0000-000000000004', null, 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id in ('10110000-0000-0000-0000-000000000001',
                     '10110000-0000-0000-0000-000000000002',
                     '10110000-0000-0000-0000-000000000004');

-- Cizí firma s vlastním člověkem — na číslo odeslání napříč firmami.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok101 Cizí s.r.o.', 'Krok101 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset

insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 101', 'krok101-cizi')
returning id as cizi_pobocka \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'cizi_firma', :'cizi_pobocka', 'Cizinec Stojedna', 'hpp')
returning id as cizinec \gset

-- Čísla odeslání.
\set klic1 '10110000-aaaa-0000-0000-000000000001'
\set klic2 '10110000-aaaa-0000-0000-000000000002'
\set klic3 '10110000-aaaa-0000-0000-000000000003'
\set klic4 '10110000-aaaa-0000-0000-000000000004'
\set klic5 '10110000-aaaa-0000-0000-000000000005'


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);
select pg_temp.check('příprava: Juli smí vyplácet zálohy na Perle',
  app.has_access(:'tenant', 'advances.manage', :'perla'));
select set_config('test.user_id', '10110000-0000-0000-0000-000000000002', false);
select pg_temp.check('příprava: Hana vyplácet NEsmí',
  not app.has_access(:'tenant', 'advances.manage', :'perla'));
select set_config('test.user_id', '10110000-0000-0000-0000-000000000003', false);
select pg_temp.check('příprava: Ivan smí taky (jiný vydávající s právem)',
  app.has_access(:'tenant', 'advances.manage', :'perla'));
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Totéž odeslání podruhé = jedna záloha =============='

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);

select zaloha as z1, coalesce(varovani, '') as var1, opakovane::text as opak1
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 1', :'perla', :'klic1') \gset

-- Odpověď se „ztratila", obsluha ťukne znovu.
select zaloha as z1b, coalesce(varovani, '') as var1b, opakovane::text as opak1b
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 1', :'perla', :'klic1') \gset

-- A ještě jednou, s jinou poznámkou — poznámka se nesrovnává.
select zaloha as z1c, opakovane::text as opak1c
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 1 znovu', :'perla', :'klic1') \gset

reset role;

select pg_temp.check('napoprvé se zapsala nová záloha (opakovane = false)',
  :'opak1' = 'false');

select pg_temp.check('podruhé se vrátila TATÁŽ záloha (opakovane = true)',
  :'z1b' = :'z1' and :'opak1b' = 'true');

select pg_temp.check('potřetí s jinou poznámkou taky tatáž',
  :'z1c' = :'z1' and :'opak1c' = 'true');

select pg_temp.check('v databázi je s tím číslem JEDNA záloha',
  (select count(*) from public.advances where employee_id = :'adam' and poznamka like 'krok101 1%') = 1);

select pg_temp.check('… a nese číslo odeslání',
  (select klic_odeslani from public.advances where id = :'z1') = :'klic1'::uuid);

select pg_temp.check('audit výplaty je jen jeden',
  (select count(*) from public.audit_log
    where action = 'advance.vyplaceno' and entity_id = :'z1') = 1);

select pg_temp.check('upozornění příjemci je jen jedno',
  (select count(*) from public.notifications n
    where n.druh = 'zaloha.vyplacena'
      and n.user_id = '10110000-0000-0000-0000-000000000004'
      and n.telo ->> 'zaloha' = :'z1') = 1);

-- Adam nemá odpracováno nic, takže výplata varuje. Opakování musí
-- říct TOTÉŽ — kdyby se záloha tohoto odeslání počítala do „už
-- dostal", vyšlo by „vyplaceno 600 Kč".
select pg_temp.check('napoprvé varování je (příprava další kontroly)',
  :'var1' like '%bude vyplaceno 300%');

select pg_temp.check('varování při opakování je stejné jako napoprvé',
  :'var1b' = :'var1');

select pg_temp.check('součet záloh Adama za měsíc je 300 Kč, ne 600',
  (select sum(castka_haleru) from public.advances
    where employee_id = :'adam' and stav <> 'stornovana') = 30000);


\echo ''
\echo '== 2. Bez čísla jako dřív, jiné číslo = nová záloha ======'

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);

select zaloha as z2a, opakovane::text as opak2a
  from public.vyplatit_zalohu(:'tenant', :'bedrich', 20000, 'krok101 2', :'perla') \gset
select zaloha as z2b, opakovane::text as opak2b
  from public.vyplatit_zalohu(:'tenant', :'bedrich', 20000, 'krok101 2', :'perla') \gset

select zaloha as z2c
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 2', :'perla', :'klic2') \gset

reset role;

select pg_temp.check('bez čísla: dvě volání = dvě zálohy (stará aplikace)',
  :'z2a' <> :'z2b' and :'opak2a' = 'false' and :'opak2b' = 'false'
  and (select count(*) from public.advances where employee_id = :'bedrich' and poznamka = 'krok101 2') = 2);

select pg_temp.check('stejná osoba a částka s JINÝM číslem = nová záloha',
  :'z2c' <> :'z1'
  and (select count(*) from public.advances where employee_id = :'adam') = 2);


\echo ''
\echo '== 3. Číslo jiné zálohy neprojde ========================='

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);

select pg_temp.check('jiná částka se týmž číslem spadne',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 50000, %L, %L, %L)',
    :'tenant', :'adam', 'krok101 3', :'perla', :'klic1'),
    '23514', 'patří jiné záloze'));

select pg_temp.check('jiný člověk se týmž číslem spadne',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 30000, %L, %L, %L)',
    :'tenant', :'bedrich', 'krok101 3', :'perla', :'klic1'),
    '23514', 'patří jiné záloze'));

reset role;

-- Jiná pobočka: Ivan smí v celé firmě, takže ho právo na Baru
-- nezastaví. Vyplatí Bedřichovi na Perle a totéž odeslání pak zkusí
-- na Baru — liší se JEN pobočka. Bedřich na Baru nepracuje, takže
-- kdyby se číslo nehlídalo, spadlo by to až na „nepracuje" (jiná hláška).
set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000003', false);

select zaloha as z3 from public.vyplatit_zalohu(
  :'tenant', :'bedrich', 15000, 'krok101 3 Ivan', :'perla', :'klic5') \gset

select pg_temp.check('jiná pobočka se týmž číslem spadne na čísle, ne na „patří"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 15000, %L, %L, %L)',
    :'tenant', :'bedrich', 'krok101 3', :'bar', :'klic5'),
    '23514', 'patří jiné záloze'));

select pg_temp.check('jiný vydávající (i s právem) se týmž číslem spadne',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 30000, %L, %L, %L)',
    :'tenant', :'adam', 'krok101 3', :'perla', :'klic1'),
    '23514', 'patří jiné záloze'));

reset role;

select pg_temp.check('nic z oddílu 3 se nezapsalo',
  not exists (select 1 from public.advances where poznamka = 'krok101 3'));


\echo ''
\echo '== 4. Právo se ptá první ================================='

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000002', false);

select pg_temp.check('bez práva: hláška o oprávnění, ne o čísle odeslání',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 30000, %L, %L, %L)',
    :'tenant', :'adam', 'krok101 4', :'perla', :'klic1'),
    '42501', 'kdo na to má oprávnění'));

reset role;


\echo ''
\echo '== 5. Opakování po pozastavení ==========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.pozastavit_zalohy(:'tenant', :'adam', true);
reset role;

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);

select zaloha as z5, opakovane::text as opak5
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 1', :'perla', :'klic1') \gset

select pg_temp.check('příprava: nová záloha pozastavenému neprojde',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L, %L)',
    :'tenant', :'adam', 'krok101 5', :'perla', :'klic3'),
    '42501', 'pozastavené'));

reset role;

select pg_temp.check('opakování zapsané zálohy po pozastavení ji vrátí, nespadne',
  :'z5' = :'z1' and :'opak5' = 'true');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.pozastavit_zalohy(:'tenant', :'adam', false);
reset role;


\echo ''
\echo '== 6. Číslo je jedinečné ve firmě ========================'

-- Cizí firma smí mít totéž číslo — losuje ho každý telefon sám
-- a jedinečnost napříč firmami by jen prozrazovala, že číslo jinde je.
insert into public.advances
  (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka, klic_odeslani)
values (:'cizi_firma', :'cizi_pobocka', :'cizinec', 10000, current_date, 'krok101 6', :'klic4');

set role authenticated;
select set_config('test.user_id', '10110000-0000-0000-0000-000000000001', false);
-- Kdyby se číslo hledalo napříč firmami, spadlo by to tady na „patří
-- jiné záloze" — proto nejdřív pojmenovaná kontrola, pak teprve \gset.
select pg_temp.check('číslo, které má cizí firma, u nás výplatu neshodí',
  pg_temp.projde(format(
    'select public.vyplatit_zalohu(%L, %L, 30000, %L, %L, %L)',
    :'tenant', :'adam', 'krok101 6', :'perla', :'klic4')));
select zaloha as z6, opakovane::text as opak6
  from public.vyplatit_zalohu(:'tenant', :'adam', 30000, 'krok101 6', :'perla', :'klic4') \gset
reset role;

-- Projde-li kontrola výš, zapsala se záloha a tohle volání je její
-- opakování (opakovane = true) — měří se, že je NAŠE, ne ta cizí.
select pg_temp.check('číslo cizí firmy u nás zapíše NOVOU zálohu (ne tu cizí)',
  :'opak6' = 'true'
  and (select count(*) from public.advances where klic_odeslani = :'klic4') = 2
  and (select tenant_id from public.advances where id = :'z6') = :'tenant'::uuid);

select pg_temp.check('ve firmě se totéž číslo uložit dvakrát nedá (index)',
  pg_temp.spadne_hlaskou(format(
    'insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, klic_odeslani)
     values (%L, %L, %L, 100, current_date, %L)',
    :'tenant', :'perla', :'bedrich', :'klic1'),
    '23505', 'advances_klic_odeslani'));


\echo ''
\echo '== 7. Granty ============================================='

select pg_temp.check('výplata existuje JEDNOU — PostgREST nemá dva kandidáty',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vyplatit_zalohu') = 1);

select pg_temp.check('výplatu smí volat přihlášený, anonym ne',
  has_function_privilege('authenticated',
    'public.vyplatit_zalohu(uuid, uuid, integer, text, uuid, uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.vyplatit_zalohu(uuid, uuid, integer, text, uuid, uuid)', 'execute'));

select pg_temp.check('pomocnou funkci nevolá zvenku nikdo',
  not has_function_privilege('authenticated',
    'app.zaloha_podle_klice(uuid, uuid, uuid, integer, uuid)', 'execute')
  and not has_function_privilege('anon',
    'app.zaloha_podle_klice(uuid, uuid, uuid, integer, uuid)', 'execute'));


\echo ''
\echo '== Úklid ================================================='

select set_config('test.user_id', '', false);

delete from public.advances
 where employee_id in (:'adam', :'bedrich', :'cizinec');
delete from public.memberships
 where tenant_id = :'tenant'
   and user_id in ('10110000-0000-0000-0000-000000000001', '10110000-0000-0000-0000-000000000002',
                   '10110000-0000-0000-0000-000000000003', '10110000-0000-0000-0000-000000000004');
delete from public.employee_permissions where employee_id = :'ivan';
delete from public.employees
 where id in (:'juli', :'hana', :'ivan', :'adam', :'bedrich');
delete from public.position_permissions where position_id = :'z_obsluha';
delete from public.positions where id = :'z_obsluha';
delete from public.employees where id = :'cizinec';

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 101',
  not exists (select 1 from public.employees where full_name like '%Stojedna')
  and not exists (select 1 from public.positions where id = :'z_obsluha'));

\echo ''
\echo '== KROK 101 HOTOV ========================================'
