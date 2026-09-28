-- Scénář pro krok 61 — pozvánka nesmí potichu vyrobit člena bez
-- záznamu v Lidech; přesun účtu na novou adresu; okno „čeká na
-- oprávnění" s důvodem; odebrat z firmy; smazání pozastaví členství.
--
-- Pokrývá 20260925150000_pozvanka_druhy_ucet.sql (hlášení majitele
-- 25. 9. 2026 — Kateřina Jirášková se dvěma účty).
--
-- Stojí na VLASTNÍCH dvou firmách (naše A a cizí B) a na datech
-- předchozích scénářů nezávisí — dá se pustit i samotný:
--   node scripts/scenare-pglite.mjs krok61_scenar
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   0. katalog: zápis do pozvánek jen přes funkce, nový sloupec čitelný,
--      pomocné funkce zavřené, jedinečnost employees(tenant_id, user_id)
--      přes celou tabulku (na ní stojí, že se u přesunu a smazání
--      nepíše „jen když nemá jiný živý záznam");
--   1. obejití přímým zápisem: vedoucí si pozvánku nezapíše ani
--      nepřepíše a účet u člověka nepřepojí ani neodpojí — majitel
--      taky ne; jiné sloupce jdou upravovat dál; záznam tvrdě nesmaže;
--   2. pozvánka pro člověka, který už má JINÝ účet, bez přesunu →
--      chyba „už máte jiný účet (k***@…)" a ŽÁDNÉ členství (Kateřina);
--   3. majitel vystaví pozvánku s přesunem → přijetí přepojí záznam,
--      starý účet má členství pozastavené (ne smazané), audit;
--   4. vedoucí se správou lidí přesun nevystaví (ani pro majitelův
--      záznam), pozvánku na TUTÉŽ adresu ano — e-mailem i SMS — a když
--      ji člověk přijme SVÝM účtem, vrátí se mu pozastavené členství
--      a nic se nepřesouvá; majitel nepřesouvá majitele (ani sebe);
--   5. přesun, když se záznam mezitím přepojil jinam → chyba;
--   6. smazaný záznam a záznam z cizí firmy → chyba, nic se nezapíše;
--      účet, který už ve firmě patří jinému člověku (živému i smazanému)
--      → česká chyba; pozvánka BEZ člověka nepřepíše členství člověka,
--      který v Lidech je (rozsah, pobočky — ani majiteli);
--   7. druhá linie přesunu (pozvánka zapsaná mimo `create_invitation`):
--      nevystavil ji majitel → chyba; míří na majitele → chyba;
--      `app.je_majitel_uctu` — každý filtr zvlášť;
--   8. `cekaji_na_opravneni`: jméno, kontakt, důvod pro všechny typy,
--      nic z cizí firmy, jen pro správce lidí;
--   9. `odebrat_z_firmy`: ne majitele, ne sebe, ne člověka se živým
--      záznamem, ne bez práva, ne z cizí firmy; cizí členství nechá;
--  10. smazání v Lidech pozastaví členství (jen v téhle firmě),
--      obnovení ho vrátí; obnovit bohatšího člověka vedoucí nesmí (strop);
--      majitele smaže jen majitel; posledního nesmaže nikdo;
--  11. `ucty_lidi`: zamaskovaný účet jen živých lidí naší firmy;
--  12. `zrusit_pozvanku`: správce lidí, přesun jen majitel, jen čekající,
--      nic z cizí firmy.
--
-- PGLITE: granty i politiky pod `set role authenticated` uplatní
-- (krok56, krok58 — PGlite 0.5.8). Funkce jsou SECURITY DEFINER a práva
-- si ověřují přes auth.uid() → test.user_id, takže jejich kontroly měří
-- i tady. Rozhoduje stejně běh proti PostgreSQL 16 (workflow Databáze).

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

-- Příkaz, který MÁ projít — jako kontrola, ne holý příkaz. Holý příkaz
-- by při rozbití shodil scénář chybou uprostřed a z výpisu by nebylo
-- poznat, co přestalo platit.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

-- Jen chyba GRANTU (`permission denied…`), ne jakákoli 42501 — tentýž
-- kód hlásí i RLS a naše spoušť. Věta je anglicky: PGlite i postgres:16
-- ve workflow hlásí bez překladu.
create or replace function pg_temp.spadne_pravem(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return sqlerrm like 'permission denied%';
end $$;

-- PGlite pouští všechny scénáře v jednom sezení a `reset role`
-- nevyprázdní `test.user_id` — bez tohohle by se příprava dělala pod
-- cizím `auth.uid()`.
reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Účty 61610000-…-0000000000NN, zaměstnanci …-0000000001NN (NN = číslo
-- účtu), zařazení …-0000000002NN, pobočky …-0000000003NN.
-- =====================================================================

insert into auth.users (id, email, phone, raw_user_meta_data) values
  ('61610000-0000-4000-8000-000000000001', 'majitel61@foodtab.cz',    null, '{"full_name":"Majitel Šedesátjedna"}'),
  ('61610000-0000-4000-8000-000000000002', 'vedouci61@foodtab.cz',    null, '{"full_name":"Vedoucí Šedesátjedna"}'),
  ('61610000-0000-4000-8000-000000000003', 'kata61@stary.cz',         null, '{}'),
  ('61610000-0000-4000-8000-000000000004', 'kata61@novy.cz',          null, '{}'),
  ('61610000-0000-4000-8000-000000000005', 'cizi61@foodtab.cz',       null, '{"full_name":"Cizí Šedesátjedna"}'),
  ('61610000-0000-4000-8000-000000000006', 'druhy61@foodtab.cz',      null, '{"full_name":"Druhý Majitel"}'),
  ('61610000-0000-4000-8000-000000000007', 'lucie61@foodtab.cz',      null, '{}'),
  ('61610000-0000-4000-8000-000000000008', 'lucie61@novy.cz',         null, '{}'),
  ('61610000-0000-4000-8000-000000000009', 'jiny61@foodtab.cz',       null, '{}'),
  ('61610000-0000-4000-8000-000000000010', 'smazany61@foodtab.cz',    null, '{}'),
  ('61610000-0000-4000-8000-000000000011', 'petr61@foodtab.cz',       null, '{}'),
  ('61610000-0000-4000-8000-000000000012', 'petr61@novy.cz',          null, '{}'),
  ('61610000-0000-4000-8000-000000000013', 'majitel61@novy.cz',       null, '{}'),
  ('61610000-0000-4000-8000-000000000014', 'treti61@foodtab.cz',      null, '{}'),
  ('61610000-0000-4000-8000-000000000015', 'ctvrty61@foodtab.cz',     null, '{}'),
  ('61610000-0000-4000-8000-000000000020', 'bezzaznamu61@foodtab.cz', null, '{}'),
  ('61610000-0000-4000-8000-000000000021', 'smazana61@foodtab.cz',    null, '{}'),
  -- Jméno v profilu JINÉ než v Lidech: okno má ukázat to z Lidí.
  ('61610000-0000-4000-8000-000000000022', 'bezzarazeni61@foodtab.cz', null, '{"full_name":"Profil Dvacetdva"}'),
  ('61610000-0000-4000-8000-000000000023', 'obsluha61@foodtab.cz',    null, '{}'),
  ('61610000-0000-4000-8000-000000000024', 'profil61@foodtab.cz',     null, '{"full_name":"Profilová Šedesátjedna"}'),
  ('61610000-0000-4000-8000-000000000025', 'jencizi61@foodtab.cz',    null, '{}'),
  ('61610000-0000-4000-8000-000000000026', 'cizipozice61@foodtab.cz', null, '{}'),
  ('61610000-0000-4000-8000-000000000027', 'pozastaveny61@foodtab.cz', null, '{}'),
  ('61610000-0000-4000-8000-000000000028', 'cisnik61@foodtab.cz',     null, '{}'),
  ('61610000-0000-4000-8000-000000000029', null,                      '+420601616129', '{}'),
  -- Člen obou firem: u nás číšník, v cizí bez záznamu (filtr firmy ve spoušti smazání).
  ('61610000-0000-4000-8000-000000000030', 'oba61@foodtab.cz',        null, '{}'),
  -- SMS pozvánka na totéž číslo. „+" se hned níž sundá.
  ('61610000-0000-4000-8000-000000000031', null,                      '+420601616131', '{}'),
  -- Bohatší než vedoucí (settings.manage): strop na obnovení.
  ('61610000-0000-4000-8000-000000000032', 'wanda61@foodtab.cz',      null, '{}');

/*
  Supabase Auth ukládá telefon BEZ „+" (20260924130000, hlavička
  TELEFON). Profil zakládá `app.handle_new_user` při vložení a tvar bez
  „+" by v něm neprošel omezením — to je samostatná věc. Proto se účet
  založí s „+" a teprve pak se mu telefon přepíše, jak by ho měl v Auth.
*/
update auth.users set phone = '420601616131'
 where id = '61610000-0000-4000-8000-000000000031';

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select app.create_tenant('Krok61 Firma s.r.o.', 'Majitel Šedesátjedna') as firma \gset
select set_config('test.user_id', '61610000-0000-4000-8000-000000000005', false);
select app.create_tenant('Krok61 Cizí s.r.o.', 'Cizí Šedesátjedna') as cizi \gset
reset role;
select set_config('test.user_id', '', false);

select id as e01 from public.employees where tenant_id = :'firma' and je_majitel \gset
select id as eb05 from public.employees where tenant_id = :'cizi' and je_majitel \gset

insert into public.branches (id, tenant_id, name, slug) values
  ('61610000-0000-4000-8000-000000000301', :'firma', 'Krok61 Pobočka', 'krok61-pobocka'),
  ('61610000-0000-4000-8000-000000000302', :'cizi',  'Krok61 Cizí pobočka', 'krok61-cizi');
select '61610000-0000-4000-8000-000000000301' as pob \gset

insert into public.positions (id, tenant_id, key, label) values
  ('61610000-0000-4000-8000-000000000201', :'firma', 'cisnik61',  'Číšník61'),
  ('61610000-0000-4000-8000-000000000202', :'firma', 'obsluha61', 'Obsluha61'),
  ('61610000-0000-4000-8000-000000000203', :'cizi',  'cizi61',    'Cizí pozice61'),
  ('61610000-0000-4000-8000-000000000204', :'firma', 'provozni61', 'Provozní61');

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'firma', '61610000-0000-4000-8000-000000000201', 'shifts.read'),
  (:'firma', '61610000-0000-4000-8000-000000000201', 'attendance.read'),
  (:'cizi',  '61610000-0000-4000-8000-000000000203', 'shifts.read'),
  (:'firma', '61610000-0000-4000-8000-000000000204', 'settings.manage'),
  (:'firma', '61610000-0000-4000-8000-000000000204', 'shifts.read');

-- Zaměstnanci naší firmy. Smazaní se zakládají rovnou smazaní (insert,
-- ne update) — tak vypadají lidé smazaní před touhle migrací: záznam
-- smazaný, členství živé.
insert into public.employees (id, tenant_id, user_id, full_name, position_id, branch_id, je_majitel, deleted_at) values
  ('61610000-0000-4000-8000-000000000102', :'firma', '61610000-0000-4000-8000-000000000002', 'Vedoucí Šedesátjedna', null, null, false, null),
  ('61610000-0000-4000-8000-000000000103', :'firma', '61610000-0000-4000-8000-000000000003', 'Kateřina Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000105', :'firma', '61610000-0000-4000-8000-000000000005', 'Cizí V Naší', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000106', :'firma', '61610000-0000-4000-8000-000000000006', 'Druhý Majitel', null, null, true, null),
  ('61610000-0000-4000-8000-000000000107', :'firma', '61610000-0000-4000-8000-000000000007', 'Lucie Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000110', :'firma', null,                                   'Marta Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000111', :'firma', '61610000-0000-4000-8000-000000000011', 'Petr Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000114', :'firma', '61610000-0000-4000-8000-000000000014', 'Třetí Majitel', null, null, true, now()),
  ('61610000-0000-4000-8000-000000000115', :'firma', '61610000-0000-4000-8000-000000000015', 'Čtvrtý Majitel', null, null, true, null),
  ('61610000-0000-4000-8000-000000000116', :'firma', null,                                   'Nikola Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000121', :'firma', '61610000-0000-4000-8000-000000000021', 'Smazaná Šedesátjedna', null, null, false, now()),
  ('61610000-0000-4000-8000-000000000122', :'firma', '61610000-0000-4000-8000-000000000022', 'Bez Zařazení Šedesátjedna', null, :'pob', false, null),
  ('61610000-0000-4000-8000-000000000123', :'firma', '61610000-0000-4000-8000-000000000023', 'Obsluha Šedesátjedna', '61610000-0000-4000-8000-000000000202', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000128', :'firma', '61610000-0000-4000-8000-000000000028', 'Číšník Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000130', :'firma', '61610000-0000-4000-8000-000000000030', 'Oba Šedesátjedna', '61610000-0000-4000-8000-000000000201', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000131', :'firma', '61610000-0000-4000-8000-000000000031', 'Esemeska Šedesátjedna', '61610000-0000-4000-8000-000000000202', :'pob', false, null),
  ('61610000-0000-4000-8000-000000000132', :'firma', '61610000-0000-4000-8000-000000000032', 'Wanda Šedesátjedna', '61610000-0000-4000-8000-000000000204', :'pob', false, null);

-- Cizí firma: záznam účtu 20 (u nás záznam nemá) a brigádník bez účtu.
insert into public.employees (id, tenant_id, user_id, full_name, position_id) values
  ('61610000-0000-4000-8000-000000000190', :'cizi', '61610000-0000-4000-8000-000000000020', 'Cizí Záznam Šedesátjedna', '61610000-0000-4000-8000-000000000203'),
  ('61610000-0000-4000-8000-000000000191', :'cizi', null,                                   'Cizí Brigádník Šedesátjedna', null);

/*
  Zaměstnanec naší firmy pod CIZÍM zařazením — řádek z doby před
  spouští `trg_firma_zarazeni` (20260925120000). Jen tak jde ověřit,
  že okno název cizího zařazení neukáže (filtr `po.tenant_id`).
*/
alter table public.employees disable trigger trg_firma_zarazeni;
insert into public.employees (id, tenant_id, user_id, full_name, position_id) values
  ('61610000-0000-4000-8000-000000000126', :'firma', '61610000-0000-4000-8000-000000000026', 'Cizí Zařazení Šedesátjedna', '61610000-0000-4000-8000-000000000203');
alter table public.employees enable trigger trg_firma_zarazeni;

-- Vedoucí: správa lidí a rozpis za celou firmu, nic dalšího (hlavně ne
-- settings.manage ani majitelství).
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'firma', '61610000-0000-4000-8000-000000000102', 'people.manage',   true),
  (:'firma', '61610000-0000-4000-8000-000000000102', 'shifts.read',     true),
  (:'firma', '61610000-0000-4000-8000-000000000102', 'attendance.read', true);

insert into public.memberships (tenant_id, user_id, role_id, status, scope) values
  (:'firma', '61610000-0000-4000-8000-000000000002', null, 'active',    'tenant'),
  (:'firma', '61610000-0000-4000-8000-000000000003', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000005', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000006', null, 'active',    'tenant'),
  (:'firma', '61610000-0000-4000-8000-000000000007', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000011', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000014', null, 'active',    'tenant'),
  (:'firma', '61610000-0000-4000-8000-000000000015', null, 'suspended', 'tenant'),
  (:'firma', '61610000-0000-4000-8000-000000000020', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000021', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000022', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000023', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000024', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000026', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000027', null, 'suspended', 'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000028', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000029', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000030', null, 'active',    'branch'),
  (:'firma', '61610000-0000-4000-8000-000000000032', null, 'active',    'branch'),
  (:'cizi',  '61610000-0000-4000-8000-000000000015', null, 'active',    'tenant'),
  (:'cizi',  '61610000-0000-4000-8000-000000000020', null, 'active',    'tenant'),
  (:'cizi',  '61610000-0000-4000-8000-000000000025', null, 'active',    'tenant'),
  (:'cizi',  '61610000-0000-4000-8000-000000000030', null, 'active',    'tenant');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pob'::uuid
  from public.memberships m
 where m.tenant_id = :'firma' and m.scope = 'branch';

-- Pozvánka vystavená PŘED touhle migrací: bez `nahrazuje_ucet`. Přesně
-- takové čtyři poslal majitel Kateřině na gmail. Zapisuje ji vlastník,
-- protože `create_invitation` by dnes nesla přesun.
insert into public.invitations (tenant_id, employee_id, channel, email, scope, branch_ids,
                                token_hash, expires_at, invited_by) values
  (:'firma', '61610000-0000-4000-8000-000000000103', 'email', 'kata61@novy.cz', 'branch',
   array[:'pob']::uuid[], encode(sha256(convert_to('token-61-stara', 'UTF8')), 'hex'),
   now() + interval '7 days', '61610000-0000-4000-8000-000000000001');

select pg_temp.check('příprava: naše firma má dva živé majitele s aktivním členstvím (01 a 06)',
  (select count(*) from public.employees e
     join public.memberships m on m.user_id = e.user_id and m.tenant_id = e.tenant_id
    where e.tenant_id = :'firma' and e.je_majitel and e.deleted_at is null
      and m.status = 'active') = 2);


\echo ''
\echo '== 0. Katalog ============================================'

select pg_temp.check('do pozvánek přihlášený nezapíše, nepřepíše ani nesmaže (jen přes funkce)',
  not has_table_privilege('authenticated', 'public.invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invitations', 'DELETE')
  and not has_any_column_privilege('authenticated', 'public.invitations', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.invitations', 'INSERT'));

select pg_temp.check('záznam v Lidech přihlášený tvrdě nesmaže (DELETE) — maže se jen deleted_at',
  not has_table_privilege('authenticated', 'public.employees', 'DELETE'));

select pg_temp.check('nový sloupec nahrazuje_ucet přihlášený přečte (sloupcové granty)',
  has_column_privilege('authenticated', 'public.invitations', 'nahrazuje_ucet', 'SELECT'));

select pg_temp.check('pomocné funkce (maska účtu, majitel účtu) nevolá přihlášený ani anon',
  not has_function_privilege('authenticated', 'app.zamaskuj_ucet(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.zamaskuj_ucet(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.je_majitel_uctu(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.je_majitel_uctu(uuid, uuid)', 'execute'));

select pg_temp.check('okno, odebrat z firmy, účty lidí a zrušení pozvánky volá přihlášený, anon ne',
  has_function_privilege('authenticated', 'public.cekaji_na_opravneni(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.odebrat_z_firmy(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.ucty_lidi(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.zrusit_pozvanku(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cekaji_na_opravneni(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.odebrat_z_firmy(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.ucty_lidi(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.zrusit_pozvanku(uuid, uuid)', 'execute'));

/*
  Na tomhle stojí, že se u přesunu a u smazání nepíše „jen když účet
  nemá ve firmě jiný živý záznam": nemá ho nikdy. Kdyby se jedinečnost
  zúžila na živé řádky, tahle kontrola spadne a ta podmínka musí do
  migrace přibýt (hlavička 20260925150000).
*/
select pg_temp.check('jedinečnost employees(tenant_id, user_id) platí přes CELOU tabulku, i smazané',
  exists (
    select 1 from pg_index i
    where i.indrelid = 'public.employees'::regclass
      and i.indisunique
      and i.indpred is null
      and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
            where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['tenant_id', 'user_id']));

select pg_temp.check('maska účtu: e-mail na první znak a doménu',
  app.zamaskuj_ucet('61610000-0000-4000-8000-000000000003') = 'k***@stary.cz');

select pg_temp.check('maska účtu: telefon na předvolbu a konec',
  app.zamaskuj_ucet('61610000-0000-4000-8000-000000000029') = '+420 *** *** 129');

select pg_temp.check('maska účtu: telefon bez „+" (tak ho ukládá Supabase Auth) dostane „+"',
  app.zamaskuj_ucet('61610000-0000-4000-8000-000000000031') = '+420 *** *** 131');


\echo ''
\echo '== 1. Obejití přímým zápisem ============================='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select pg_temp.check('vedoucí má správu lidí (jinak by oddíl nic neměřil)',
  app.has_access(:'firma', 'people.manage'));

select pg_temp.check('vedoucí si pozvánku s přesunem na majitelův záznam sám NEZAPÍŠE (grant)',
  pg_temp.spadne_pravem(format(
    $q$insert into public.invitations (tenant_id, employee_id, channel, email, scope,
         token_hash, expires_at, invited_by, nahrazuje_ucet)
       values (%L, %L, 'email', 'vedouci61@druhy.cz', 'tenant', 'x61', now() + interval '1 day',
               '61610000-0000-4000-8000-000000000001', '61610000-0000-4000-8000-000000000001')$q$,
    :'firma', :'e01')));

select pg_temp.check('… ani nepřepíše existující pozvánku',
  pg_temp.spadne_pravem(
    $q$update public.invitations set nahrazuje_ucet = '61610000-0000-4000-8000-000000000003'
        where email = 'kata61@novy.cz'$q$));

select pg_temp.check('… ani ji nesmaže',
  pg_temp.spadne_pravem($q$delete from public.invitations where email = 'kata61@novy.cz'$q$));

select pg_temp.check('vedoucí si na cizí záznam nepřipojí svůj druhý účet (update user_id)',
  pg_temp.spadne_hlaskou(
    $q$update public.employees set user_id = '61610000-0000-4000-8000-000000000012'
        where id = '61610000-0000-4000-8000-000000000111'$q$,
    '42501', 'mění jen přijetím pozvánky'));

select pg_temp.check('vedoucí neodpojí majitele od jeho záznamu (user_id = null)',
  pg_temp.spadne_hlaskou(format(
    $q$update public.employees set user_id = null where id = %L$q$, :'e01'),
    '42501', 'mění jen přijetím pozvánky'));

-- Jiné sloupce jdou upravovat dál — i když se user_id pošle beze změny,
-- jak to dělá formulář, který posílá celý řádek.
/*
  Tvrdé smazání: druhý způsob, jak rozbít totéž co katalog výš (grant
  vrácený jen na tuhle tabulku by katalog chytil, ale politika
  `employees_write` pro všechny operace by pustila i tohle).
*/
select pg_temp.check('vedoucí záznam v Lidech tvrdě NESMAŽE (grant) — Nikola bez účtu',
  pg_temp.spadne_pravem(
    $q$delete from public.employees where id = '61610000-0000-4000-8000-000000000116'$q$));

select pg_temp.check('vedoucí upraví jméno, i když formulář pošle user_id beze změny',
  pg_temp.projde($q$update public.employees
                       set full_name = 'Petr Šedesátjedna', user_id = user_id
                     where id = '61610000-0000-4000-8000-000000000111'$q$));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select pg_temp.check('ani majitel účet u člověka přímým zápisem nepřepojí (jen pozvánkou)',
  pg_temp.spadne_hlaskou(
    $q$update public.employees set user_id = '61610000-0000-4000-8000-000000000004'
        where id = '61610000-0000-4000-8000-000000000103'$q$,
    '42501', 'mění jen přijetím pozvánky'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Petrův záznam má pořád svůj účet a úprava jména prošla',
  (select user_id = '61610000-0000-4000-8000-000000000011' and full_name = 'Petr Šedesátjedna'
     from public.employees where id = '61610000-0000-4000-8000-000000000111'));

select pg_temp.check('majitel je pořád propojený se svým záznamem',
  (select user_id = '61610000-0000-4000-8000-000000000001' from public.employees where id = :'e01'));


\echo ''
\echo '== 2. Pozvánka pro člověka s JINÝM účtem, bez přesunu ==='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000004', false);

select pg_temp.check('přijetí → „už máte jiný účet (k***@stary.cz)", ne tiché členství',
  pg_temp.spadne_hlaskou(
    $q$select public.accept_invitation('token-61-stara')$q$,
    '23514', 'V téhle firmě už máte jiný účet (k***@stary.cz)'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('nový účet NENÍ členem firmy (ani pozastaveným)',
  not exists (select 1 from public.memberships
              where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000004'));

select pg_temp.check('záznam zůstal na starém účtu a pozvánka nepoužitá',
  (select user_id = '61610000-0000-4000-8000-000000000003'
     from public.employees where id = '61610000-0000-4000-8000-000000000103')
  and (select accepted_at is null from public.invitations
        where token_hash = encode(sha256(convert_to('token-61-stara', 'UTF8')), 'hex')));


\echo ''
\echo '== 3. Majitel přesune účet na novou adresu =============='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select invitation_id as inv_presun, token as tok_presun from app.create_invitation(
  :'firma', null, 'email', 'Kata61@Novy.cz ', 'branch', array[:'pob']::uuid[],
  '61610000-0000-4000-8000-000000000103') \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('pozvánka nese, který účet nahrazuje (ten starý)',
  (select nahrazuje_ucet = '61610000-0000-4000-8000-000000000003'
     from public.invitations where id = :'inv_presun'));

select pg_temp.check('… a v auditu vystavení je taky',
  exists (select 1 from public.audit_log
          where action = 'invitation.create' and entity_id = :'inv_presun'
            and after ->> 'nahrazuje_ucet' = '61610000-0000-4000-8000-000000000003'));

select pg_temp.check('před přijetím: starý účet do firmy vidí',
  exists (select 1 from public.memberships
          where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000003'
            and status = 'active'));

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000004', false);

select public.accept_invitation(:'tok_presun') as prijato_presun \gset

select pg_temp.check('nový účet po přesunu vidí rozpis své pobočky (práva ze zařazení)',
  app.has_access(:'firma', 'shifts.read', :'pob'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000003', false);

select pg_temp.check('starý účet už do firmy nevidí nic',
  not app.has_access(:'firma', 'shifts.read', :'pob')
  and not exists (select 1 from public.my_tenants() where tenant_id = :'firma'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('přijetí vrátilo naši firmu',
  :'prijato_presun' = :'firma');

select pg_temp.check('záznam Kateřiny je teď na novém účtu',
  (select user_id = '61610000-0000-4000-8000-000000000004'
     from public.employees where id = '61610000-0000-4000-8000-000000000103'));

select pg_temp.check('nový účet má aktivní členství',
  exists (select 1 from public.memberships
          where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000004'
            and status = 'active'));

select pg_temp.check('členství starého účtu je POZASTAVENÉ, ne smazané',
  (select status from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000003') = 'suspended');

select pg_temp.check('audit přesunu nese starý i nový účet',
  exists (select 1 from public.audit_log
          where tenant_id = :'firma'
            and action = 'employee.ucet_presunut'
            and entity_id = '61610000-0000-4000-8000-000000000103'
            and before ->> 'user_id' = '61610000-0000-4000-8000-000000000003'
            and after  ->> 'user_id' = '61610000-0000-4000-8000-000000000004'));

select pg_temp.check('pozvánka je použitá novým účtem',
  (select accepted_by = '61610000-0000-4000-8000-000000000004'
     from public.invitations where id = :'inv_presun'));


\echo ''
\echo '== 4. Kdo přesun vystaví a kdo ne ======================='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select pg_temp.check('vedoucí se správou lidí přesun NEVYSTAVÍ — „může jen majitel" i s maskou účtu',
  pg_temp.spadne_hlaskou(format(
    $q$select * from app.create_invitation(%L, null, 'email', 'lucie61@novy.cz', 'branch',
         array[%L]::uuid[], '61610000-0000-4000-8000-000000000107')$q$, :'firma', :'pob'),
    '42501', 'má účet (l***@foodtab.cz). Přesunout jeho přístup na jinou adresu může jen majitel'));

/*
  Na majitelův záznam vedoucího zastaví už strop (majitelství je víc,
  než má sám). Přesunové pravidlo „majitele nikdy" by ho zastavilo
  taky — tahle kontrola proto míří na strop a přesunové pravidlo pro
  majitele měří „majitel nepřesouvá druhého majitele" níž.
*/
select pg_temp.check('vedoucí nevystaví pozvánku na majitelův záznam (strop)',
  pg_temp.spadne_hlaskou(format(
    $q$select * from app.create_invitation(%L, null, 'email', 'vedouci61@druhy.cz', 'tenant',
         '{}'::uuid[], %L)$q$, :'firma', :'e01'),
    '42501', 'nemůžete pozvat'));

-- Tutéž adresu, jakou má propojený účet, přesun není. Token si
-- schovává dočasná tabulka — pozvánku níž Lucie přijme.
select pg_temp.check('vedoucí vystaví pozvánku na TUTÉŽ adresu, jakou má účet (přesun to není)',
  pg_temp.projde(format(
    $q$create temp table tataz61 as
       select * from app.create_invitation(%L, null, 'email', 'Lucie61@Foodtab.cz', 'branch',
         array[%L]::uuid[], '61610000-0000-4000-8000-000000000107')$q$, :'firma', :'pob')));

/*
  Totéž pro SMS. Supabase Auth ukládá telefon BEZ „+" (420601616131),
  pozvánka ho nese s ním — porovnání to musí srovnat, jinak by každá SMS
  pozvánka pro člověka s účtem byla přesun a vedoucí by ji nevystavil.
  Esemeska má zařazení bez práv, takže SMS nezastaví citlivé právo.
*/
select pg_temp.check('SMS na TOTÉŽ číslo, jaké má účet, vystaví i vedoucí (přesun to není)',
  pg_temp.projde(format(
    $q$select * from app.create_invitation(%L, null, 'sms', '+420601616131', 'branch',
         array[%L]::uuid[], '61610000-0000-4000-8000-000000000131')$q$, :'firma', :'pob')));

select pg_temp.check('SMS na JINÉ číslo pro člověka s účtem je přesun — vedoucí ne, i s maskou',
  pg_temp.spadne_hlaskou(format(
    $q$select * from app.create_invitation(%L, null, 'sms', '+420601616199', 'branch',
         array[%L]::uuid[], '61610000-0000-4000-8000-000000000131')$q$, :'firma', :'pob'),
    '42501', 'má účet (+420 *** *** 131). Přesunout jeho přístup na jinou adresu může jen majitel'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select pg_temp.check('majitel nepřesouvá druhého majitele (a hláška neposílá do Mých údajů)',
  pg_temp.spadne_hlaskou(format(
    $q$select * from app.create_invitation(%L, null, 'email', 'druhy61@novy.cz', 'tenant',
         '{}'::uuid[], '61610000-0000-4000-8000-000000000106')$q$, :'firma'),
    '42501', 'Účet majitele se pozvánkou nepřesouvá. Přihlašovací adresu majitele zatím změní jen správce Foodtabu'));

select pg_temp.check('… ani sám sebe',
  pg_temp.spadne_hlaskou(format(
    $q$select * from app.create_invitation(%L, null, 'email', 'majitel61@novy.cz', 'tenant',
         '{}'::uuid[], %L)$q$, :'firma', :'e01'),
    '42501', 'Účet majitele se pozvánkou nepřesouvá'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('vedoucí žádnou pozvánku na novou adresu nevystavil',
  not exists (select 1 from public.invitations
              where invited_by = '61610000-0000-4000-8000-000000000002'
                and email in ('lucie61@novy.cz', 'vedouci61@druhy.cz')));

select pg_temp.check('pozvánka na tutéž adresu vznikla a přesun nenese',
  (select count(*) from public.invitations
    where email = 'lucie61@foodtab.cz'
      and invited_by = '61610000-0000-4000-8000-000000000002'
      and nahrazuje_ucet is null) = 1);

select pg_temp.check('pro majitele žádná pozvánka na novou adresu nevznikla',
  not exists (select 1 from public.invitations
              where email in ('druhy61@novy.cz', 'majitel61@novy.cz')));

select pg_temp.check('SMS pozvánka na totéž číslo vznikla a přesun nenese; na jiné číslo žádná',
  (select count(*) from public.invitations
    where phone = '+420601616131' and nahrazuje_ucet is null
      and invited_by = '61610000-0000-4000-8000-000000000002') = 1
  and not exists (select 1 from public.invitations where phone = '+420601616199'));

/*
  Pozvánku na tutéž adresu přijme SÁM ten účet, který u záznamu je —
  typicky po pozastaveném členství. Přijetí nesmí skončit „patří
  k jinému člověku" (záznam je jeho) ani nic přesouvat, a pozastavené
  členství má vrátit.
*/
update public.memberships set status = 'suspended'
 where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000007';

select token as tok_tataz from tataz61 \gset

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000007', false);

select pg_temp.check('Lucie s pozastaveným členstvím rozpis nevidí (jinak by další nic neměřila)',
  not app.has_access(:'firma', 'shifts.read', :'pob'));

select pg_temp.check('Lucie přijme pozvánku na tutéž adresu SVÝM účtem',
  pg_temp.projde(format($q$select public.accept_invitation(%L)$q$, :'tok_tataz')));

select pg_temp.check('… členství je zase aktivní a rozpis vidí',
  app.has_access(:'firma', 'shifts.read', :'pob'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Luciin záznam zůstal na jejím účtu a přesun v auditu není',
  (select user_id = '61610000-0000-4000-8000-000000000007'
     from public.employees where id = '61610000-0000-4000-8000-000000000107')
  and not exists (select 1 from public.audit_log
                  where action = 'employee.ucet_presunut'
                    and entity_id = '61610000-0000-4000-8000-000000000107'));


\echo ''
\echo '== 5. Přesun, když se záznam mezitím přepojil jinam ======'

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select invitation_id as inv_mezitim, token as tok_mezitim from app.create_invitation(
  :'firma', null, 'email', 'lucie61@novy.cz', 'branch', array[:'pob']::uuid[],
  '61610000-0000-4000-8000-000000000107') \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('pozvánka nahrazuje Luciin účet (07)',
  (select nahrazuje_ucet = '61610000-0000-4000-8000-000000000007'
     from public.invitations where id = :'inv_mezitim'));

-- Mezitím: záznam dostal jiný účet (ruční oprava v databázi).
update public.employees set user_id = '61610000-0000-4000-8000-000000000009'
 where id = '61610000-0000-4000-8000-000000000107';

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000008', false);

select pg_temp.check('přijetí → „mezitím se změnil účet", nic se nepřepojí',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_mezitim'),
    '23514', 'mezitím změnil účet'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('záznam zůstal na účtu z mezitímní změny a nový účet není členem',
  (select user_id = '61610000-0000-4000-8000-000000000009'
     from public.employees where id = '61610000-0000-4000-8000-000000000107')
  and not exists (select 1 from public.memberships
                  where user_id = '61610000-0000-4000-8000-000000000008'));


\echo ''
\echo '== 6. Smazaný záznam, cizí firma, účet s jiným záznamem =='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select token as tok_marta from app.create_invitation(
  :'firma', null, 'email', 'smazany61@foodtab.cz', 'branch', array[:'pob']::uuid[],
  '61610000-0000-4000-8000-000000000110') \gset

select invitation_id as inv_nikola, token as tok_nikola from app.create_invitation(
  :'firma', null, 'email', 'vedouci61@foodtab.cz', 'branch', array[:'pob']::uuid[],
  '61610000-0000-4000-8000-000000000116') \gset

-- Totéž pro Nikolu na adresu účtu 21, jehož záznam v Lidech je SMAZANÝ
-- (tak vypadá „smazat a založit znovu": lucka, Láďa v ostré databázi).
select token as tok_nikola_smazana from app.create_invitation(
  :'firma', null, 'email', 'smazana61@foodtab.cz', 'branch', array[:'pob']::uuid[],
  '61610000-0000-4000-8000-000000000116') \gset

-- Martu mezitím smaže v Lidech (tak, jak to dělá aplikace). Záznam bez
-- účtu: spoušť smazání (oddíl 10) nemá čí členství pozastavit.
select pg_temp.check('majitel smaže v Lidech člověka bez účtu',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000110'$q$));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000010', false);

select pg_temp.check('pozvánka pro smazaný záznam → „už ve firmě v Lidech není"',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_marta'),
    '22023', 'už ve firmě v Lidech není'));

reset role;
select set_config('test.user_id', '', false);

/*
  Pozvánka do naší firmy pro zaměstnance CIZÍ firmy — `create_invitation`
  ji nevystaví, zapisuje se proto napřímo. Hlídá filtr firmy v přijetí:
  bez něj by se náš člen připojil na cizí záznam.
*/
insert into public.invitations (tenant_id, employee_id, channel, email, scope, branch_ids,
                                token_hash, expires_at, invited_by) values
  (:'firma', '61610000-0000-4000-8000-000000000191', 'email', 'smazany61@foodtab.cz', 'branch',
   array[:'pob']::uuid[], encode(sha256(convert_to('token-61-cizi', 'UTF8')), 'hex'),
   now() + interval '7 days', '61610000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000010', false);

select pg_temp.check('pozvánka pro záznam z cizí firmy → táž chyba',
  pg_temp.spadne_hlaskou($q$select public.accept_invitation('token-61-cizi')$q$,
    '22023', 'už ve firmě v Lidech není'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select pg_temp.check('účet, který už ve firmě patří jinému člověku → česky, se jménem toho člověka',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_nikola'),
    '23514', 'Váš účet už ve firmě patří k člověku v Lidech (Vedoucí Šedesátjedna)'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000021', false);

select pg_temp.check('účet se SMAZANÝM záznamem → vlastní věta (vyřeší správce), ne tiché přepojení',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_nikola_smazana'),
    '23514', 'patří k člověku, který je v Lidech smazaný (Smazaná Šedesátjedna)'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('účet ze smazané a cizí pozvánky není členem nikde',
  not exists (select 1 from public.memberships
              where user_id = '61610000-0000-4000-8000-000000000010'));

select pg_temp.check('cizí brigádník zůstal bez účtu',
  (select user_id is null from public.employees where id = '61610000-0000-4000-8000-000000000191'));

select pg_temp.check('Nikola zůstala bez účtu a vedoucí na svém záznamu',
  (select user_id is null from public.employees where id = '61610000-0000-4000-8000-000000000116')
  and (select user_id = '61610000-0000-4000-8000-000000000002'
         from public.employees where id = '61610000-0000-4000-8000-000000000102'));

select pg_temp.check('smazaná zůstala na svém smazaném záznamu a její členství se nezměnilo',
  (select user_id = '61610000-0000-4000-8000-000000000021'
     from public.employees where id = '61610000-0000-4000-8000-000000000121')
  and (select status = 'active' and scope = 'branch' from public.memberships
        where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000021'));

/*
  POZVÁNKA BEZ ČLOVĚKA (jen přes API — obrazovka vždycky vybírá člověka)
  a účet, který v Lidech JE. Dřív ji přijetí vzalo a přepsalo členství:
  rozsah, pobočky i stav — bez stropu. Vedoucí tak rozšířil kolegovi
  rozsah nad svůj, nebo majiteli zúžil rozsah na pobočku a zamkl ho
  (nezávislá kontrola 28. 9. 2026, U1 a U8).
*/
set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select token as tok_bez_petr from app.create_invitation(
  :'firma', null, 'email', 'petr61@foodtab.cz', 'tenant', '{}'::uuid[], null) \gset

select token as tok_bez_majitel from app.create_invitation(
  :'firma', null, 'email', 'majitel61@foodtab.cz', 'branch', array[:'pob']::uuid[], null) \gset

select token as tok_bez_20 from app.create_invitation(
  :'firma', null, 'email', 'bezzaznamu61@foodtab.cz', 'branch', array[:'pob']::uuid[], null) \gset

select set_config('test.user_id', '61610000-0000-4000-8000-000000000011', false);

select pg_temp.check('pozvánku BEZ člověka nepřijme účet, který v Lidech je (Petr, rozsah pobočka)',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_bez_petr'),
    '23514', 'Váš účet už ve firmě patří k člověku v Lidech (Petr Šedesátjedna)'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select pg_temp.check('… ani majitel (pozvánka od vedoucího by mu zúžila rozsah na pobočku)',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_bez_majitel'),
    '23514', 'Váš účet už ve firmě patří k člověku v Lidech (Majitel Šedesátjedna)'));

select pg_temp.check('majitel má dál správu lidí za celou firmu',
  app.has_access(:'firma', 'people.manage'));

-- 20 má živý záznam jen v CIZÍ firmě. U nás je bez záznamu — pozvánka
-- bez člověka mu projde jako dosud (otázka 18 h). Hlídá filtr firmy.
select set_config('test.user_id', '61610000-0000-4000-8000-000000000020', false);

select pg_temp.check('účet se záznamem jen v cizí firmě pozvánku bez člověka u nás přijme',
  pg_temp.projde(format($q$select public.accept_invitation(%L)$q$, :'tok_bez_20')));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Petrovo členství se nezměnilo (rozsah pobočka, jen jeho pobočka)',
  (select m.scope = 'branch'
          and array(select mb.branch_id from public.membership_branches mb
                     where mb.membership_id = m.id) = array[:'pob']::uuid[]
     from public.memberships m
    where m.tenant_id = :'firma' and m.user_id = '61610000-0000-4000-8000-000000000011'));

select pg_temp.check('majitelovo členství zůstalo za celou firmu',
  (select scope from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000001') = 'tenant');

select pg_temp.check('pozvánky bez člověka pro Petra a majitele zůstaly nepoužité, pro 20 použitá',
  (select count(*) from public.invitations
    where tenant_id = :'firma' and employee_id is null and accepted_at is null
      and email in ('petr61@foodtab.cz', 'majitel61@foodtab.cz')) = 2
  and exists (select 1 from public.invitations
              where tenant_id = :'firma' and employee_id is null
                and email = 'bezzaznamu61@foodtab.cz'
                and accepted_by = '61610000-0000-4000-8000-000000000020'));


\echo ''
\echo '== 7. Druhá linie přesunu ================================'

/*
  Pozvánky zapsané mimo `create_invitation` — jako by se zápis do
  tabulky jednou vrátil (plošný grant). Přijetí je musí odmítnout samo.
*/
insert into public.invitations (tenant_id, employee_id, channel, email, scope, branch_ids,
                                token_hash, expires_at, invited_by, nahrazuje_ucet) values
  (:'firma', '61610000-0000-4000-8000-000000000111', 'email', 'petr61@novy.cz', 'branch',
   array[:'pob']::uuid[], encode(sha256(convert_to('token-61-vedouci', 'UTF8')), 'hex'),
   now() + interval '7 days', '61610000-0000-4000-8000-000000000002',
   '61610000-0000-4000-8000-000000000011'),
  (:'firma', '61610000-0000-4000-8000-000000000106', 'email', 'majitel61@novy.cz', 'tenant',
   '{}'::uuid[], encode(sha256(convert_to('token-61-majitel', 'UTF8')), 'hex'),
   now() + interval '7 days', '61610000-0000-4000-8000-000000000001',
   '61610000-0000-4000-8000-000000000006');

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000012', false);

select pg_temp.check('přesun, který nevystavil majitel (vedoucí) → odmítnut',
  pg_temp.spadne_hlaskou($q$select public.accept_invitation('token-61-vedouci')$q$,
    '42501', 'potvrzuje majitel firmy'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000013', false);

select pg_temp.check('přesun majitelova záznamu (i od majitele) → odmítnut',
  pg_temp.spadne_hlaskou($q$select public.accept_invitation('token-61-majitel')$q$,
    '42501', 'Účet majitele se pozvánkou nepřesouvá'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Petr i druhý majitel zůstali na svých účtech, noví nejsou členy',
  (select user_id = '61610000-0000-4000-8000-000000000011'
     from public.employees where id = '61610000-0000-4000-8000-000000000111')
  and (select user_id = '61610000-0000-4000-8000-000000000006'
         from public.employees where id = '61610000-0000-4000-8000-000000000106')
  and not exists (select 1 from public.memberships
                  where user_id in ('61610000-0000-4000-8000-000000000012',
                                    '61610000-0000-4000-8000-000000000013')));

-- app.je_majitel_uctu: každý filtr vlastní kontrolou.
select pg_temp.check('je_majitel_uctu: majitel ano (jinak by zbytek nic neměřil)',
  app.je_majitel_uctu(:'firma', '61610000-0000-4000-8000-000000000001'));

select pg_temp.check('je_majitel_uctu: vedoucí ne (je_majitel)',
  not app.je_majitel_uctu(:'firma', '61610000-0000-4000-8000-000000000002'));

-- 05 je majitelem CIZÍ firmy a u nás obyčejný číšník.
select pg_temp.check('je_majitel_uctu: majitel cizí firmy, u nás číšník, ne (firma záznamu)',
  not app.je_majitel_uctu(:'firma', '61610000-0000-4000-8000-000000000005'));

-- 14 má majitelský záznam smazaný a členství živé.
select pg_temp.check('je_majitel_uctu: smazaný majitel ne (deleted_at)',
  not app.je_majitel_uctu(:'firma', '61610000-0000-4000-8000-000000000014'));

-- 15: majitelský záznam u nás, členství u nás POZASTAVENÉ, v cizí živé.
select pg_temp.check('je_majitel_uctu: majitel s pozastaveným členstvím ne (firma a stav členství)',
  not app.je_majitel_uctu(:'firma', '61610000-0000-4000-8000-000000000015'));


\echo ''
\echo '== 8. Kdo čeká na oprávnění — a proč ===================='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

create temp table ceka61 as select * from public.cekaji_na_opravneni(:'firma');

select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);
select pg_temp.check('číšník bez správy lidí seznam nedostane',
  not exists (select 1 from public.cekaji_na_opravneni(:'firma')));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select pg_temp.check('majitel naší firmy seznam cizí firmy nedostane',
  not exists (select 1 from public.cekaji_na_opravneni(:'cizi')));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('bez záznamu: důvod, kontakt, jméno z e-mailu — NE ze záznamu v cizí firmě',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000020'
            and duvod = 'bez_zaznamu'
            and employee_id is null
            and jmeno = 'bezzaznamu61@foodtab.cz'
            and kontakt = 'bezzaznamu61@foodtab.cz'));

select pg_temp.check('smazaný záznam: jméno ze smazaného záznamu, bez odkazu na něj',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000021'
            and duvod = 'zaznam_smazany'
            and employee_id is null
            and jmeno = 'Smazaná Šedesátjedna'
            and kontakt = 'smazana61@foodtab.cz'));

select pg_temp.check('bez zařazení: jméno z Lidí (ne z profilu) a id živého záznamu',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000022'
            and duvod = 'bez_zarazeni'
            and employee_id = '61610000-0000-4000-8000-000000000122'
            and jmeno = 'Bez Zařazení Šedesátjedna'
            and zarazeni is null));

select pg_temp.check('zařazení bez práv: název a id zařazení',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000023'
            and duvod = 'zarazeni_bez_prav'
            and employee_id = '61610000-0000-4000-8000-000000000123'
            and zarazeni = 'Obsluha61'
            and zarazeni_id = '61610000-0000-4000-8000-000000000202'));

select pg_temp.check('bez záznamu, jméno v profilu: jméno z profilu',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000024'
            and duvod = 'bez_zaznamu'
            and jmeno = 'Profilová Šedesátjedna'));

select pg_temp.check('účet jen s telefonem: jméno i kontakt je číslo, ne „Nový člověk"',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000029'
            and jmeno = '+420601616129'
            and kontakt = '+420601616129'));

select pg_temp.check('cizí zařazení (starý řádek): čeká, ale název cizího zařazení neukáže',
  exists (select 1 from ceka61
          where user_id = '61610000-0000-4000-8000-000000000026'
            and duvod = 'zarazeni_bez_prav'
            and zarazeni is null and zarazeni_id is null));

select pg_temp.check('nečeká majitel, člověk s právy, ani Kateřina po přesunu',
  not exists (select 1 from ceka61
              where user_id in ('61610000-0000-4000-8000-000000000001',
                                '61610000-0000-4000-8000-000000000028',
                                '61610000-0000-4000-8000-000000000005',
                                '61610000-0000-4000-8000-000000000004')));

select pg_temp.check('nečeká člen jen cizí firmy (firma členství) ani pozastavený (stav členství)',
  not exists (select 1 from ceka61
              where user_id in ('61610000-0000-4000-8000-000000000025',
                                '61610000-0000-4000-8000-000000000027',
                                '61610000-0000-4000-8000-000000000003')));

select pg_temp.check('nikde „Nový člověk" — všichni mají jméno nebo kontakt',
  not exists (select 1 from ceka61 where jmeno = 'Nový člověk'));


\echo ''
\echo '== 9. Odebrat z firmy ===================================='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select pg_temp.check('majitel neodebere sám sebe (má živý záznam)',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000001'),
    '23514', 'patří k člověku v Lidech'));

select pg_temp.check('ani člověka se živým záznamem (bez zařazení)',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000022'),
    '23514', 'patří k člověku v Lidech'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select pg_temp.check('vedoucí neodebere majitele',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000001'),
    '23514', 'patří k člověku v Lidech'));

select pg_temp.check('ani sám sebe',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000002'),
    '23514', 'patří k člověku v Lidech'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);

select pg_temp.check('bez správy lidí nikoho neodebere',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000020'),
    '42501', 'Odebírat lidi z firmy může jen'));

-- 05 je majitelem cizí firmy, u nás obyčejný číšník.
select set_config('test.user_id', '61610000-0000-4000-8000-000000000005', false);

select pg_temp.check('majitel cizí firmy z naší firmy nikoho neodebere',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000020'),
    '42501', 'Odebírat lidi z firmy může jen'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

-- Náš majitel v cizí firmě nic nespravuje. 25 je tam člen bez záznamu —
-- u sebe by ho cizí majitel odebrat směl.
select pg_temp.check('majitel naší firmy z CIZÍ firmy nikoho neodebere',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'cizi', '61610000-0000-4000-8000-000000000025'),
    '42501', 'Odebírat lidi z firmy může jen'));

-- 20 má živý záznam v CIZÍ firmě, u nás žádný — odebrat jde.
select pg_temp.check('účet bez záznamu u nás (živý záznam má jen v cizí firmě) odebrat jde',
  pg_temp.projde(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000020')));

-- 21 má u nás záznam, ale smazaný.
select pg_temp.check('účet se smazaným záznamem odebrat jde',
  pg_temp.projde(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000021')));

select pg_temp.check('podruhé → „už ve firmě aktivní není"',
  pg_temp.spadne_hlaskou(format($q$select public.odebrat_z_firmy(%L, %L)$q$,
    :'firma', '61610000-0000-4000-8000-000000000020'),
    '22023', 'už ve firmě aktivní není'));

select pg_temp.check('odebraní z okna zmizeli',
  not exists (select 1 from public.cekaji_na_opravneni(:'firma')
              where user_id in ('61610000-0000-4000-8000-000000000020',
                                '61610000-0000-4000-8000-000000000021')));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('účet bez záznamu u nás (živý jen v cizí firmě): u nás pozastavený',
  (select status from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000020') = 'suspended');

select pg_temp.check('… a jeho členství v cizí firmě zůstalo aktivní',
  (select status from public.memberships
    where tenant_id = :'cizi' and user_id = '61610000-0000-4000-8000-000000000020') = 'active');

select pg_temp.check('člen cizí firmy, na kterého sáhl náš majitel, je tam pořád aktivní',
  (select status from public.memberships
    where tenant_id = :'cizi' and user_id = '61610000-0000-4000-8000-000000000025') = 'active');

select pg_temp.check('účet se smazaným záznamem: pozastavený',
  (select status from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000021') = 'suspended');

select pg_temp.check('majitel, vedoucí a člověk bez zařazení zůstali aktivní',
  (select count(*) from public.memberships
    where tenant_id = :'firma' and status = 'active'
      and user_id in ('61610000-0000-4000-8000-000000000001',
                      '61610000-0000-4000-8000-000000000002',
                      '61610000-0000-4000-8000-000000000022')) = 3);

select pg_temp.check('odebrání je v auditu, i kdo to udělal',
  exists (select 1 from public.audit_log
          where tenant_id = :'firma' and action = 'membership.odebrano'
            and actor_id = '61610000-0000-4000-8000-000000000001'
            and after ->> 'user_id' = '61610000-0000-4000-8000-000000000020'
            and after ->> 'status' = 'suspended'));


\echo ''
\echo '== 10. Smazání v Lidech pozastaví členství ==============='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);
select pg_temp.check('číšník před smazáním vidí rozpis (jinak by oddíl nic neměřil)',
  app.has_access(:'firma', 'shifts.read', :'pob'));

-- Smazání tak, jak ho dělá aplikace (smazatZamestnance): update deleted_at.
-- Jako kontrola: kdyby spoušť sáhla na víc členství (třeba i majitelova),
-- smazání spadne na pojistce posledního majitele a tady je to vidět.
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select pg_temp.check('majitel číšníka v Lidech smaže',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000128'$q$));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('smazáním v Lidech se členství pozastavilo (v téže transakci)',
  (select status from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000028') = 'suspended');

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select pg_temp.check('… a zase obnoví',
  pg_temp.projde($q$update public.employees set deleted_at = null
                     where id = '61610000-0000-4000-8000-000000000128'$q$));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);
select pg_temp.check('obnovením se členství vrátilo a číšník zase vidí rozpis',
  app.has_access(:'firma', 'shifts.read', :'pob'));

/*
  Filtr firmy ve spoušti (je SECURITY DEFINER, druhá linie tam není).
  30 je u nás číšník a v cizí firmě člen bez záznamu: smazání u nás nesmí
  sáhnout na jeho členství v cizí firmě. (Ne 05 — ten je v cizí firmě
  jediný majitel a filtr by za spoušť držela pojistka posledního majitele.)

  Maže a obnovuje VEDOUCÍ: číšníkova práva (rozpis, docházka) má sám,
  takže strop na obnovení ho pustit musí.
*/
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);
select pg_temp.check('vedoucí smaže člena obou firem u nás',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000130'$q$));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('smazání u nás pozastaví jen naše členství, v cizí firmě zůstane aktivní',
  (select status from public.memberships
    where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000030') = 'suspended'
  and (select status from public.memberships
         where tenant_id = :'cizi' and user_id = '61610000-0000-4000-8000-000000000030') = 'active');

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);
select pg_temp.check('… a obnoví (jeho práva vedoucí má, strop pustí)',
  pg_temp.projde($q$update public.employees set deleted_at = null
                     where id = '61610000-0000-4000-8000-000000000130'$q$));

/*
  STROP NA OBNOVENÍ. Wanda má settings.manage, vedoucí ne. Majitel jí
  pozastaví členství; vedoucí ho přímo vrátit nesmí (politika
  memberships_update) — a nesmí to obejít ani smazáním a obnovením
  v Lidech (nezávislá kontrola 28. 9. 2026, U2).
*/
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select pg_temp.check('majitel Wandě pozastaví členství',
  pg_temp.projde($q$update public.memberships set status = 'suspended'
                     where user_id = '61610000-0000-4000-8000-000000000032'$q$));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);
select pg_temp.check('vedoucí nemá settings.manage (jinak by strop nic neměřil)',
  not app.has_access(:'firma', 'settings.manage'));

select pg_temp.check('vedoucí Wandu v Lidech smaže (smazání bere, strop nemá)',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000132'$q$));

select pg_temp.check('… ale obnovit ji nesmí — vrátil by práva, která sám nemá',
  pg_temp.spadne_hlaskou($q$update public.employees set deleted_at = null
                             where id = '61610000-0000-4000-8000-000000000132'$q$,
    '42501', 'Obnovit člověka s oprávněními, která sami nemáte'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000032', false);
select pg_temp.check('Wanda do firmy nevidí (nic z obnovení nezůstalo)',
  not app.has_access(:'firma', 'settings.manage', :'pob')
  and not app.has_access(:'firma', 'shifts.read', :'pob'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Wandin záznam zůstal smazaný a členství pozastavené',
  (select deleted_at is not null from public.employees where id = '61610000-0000-4000-8000-000000000132')
  and (select status from public.memberships
        where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000032') = 'suspended');

/*
  MAJITELE SMAŽE JEN MAJITEL. Firma má dva živé majitele (01, 06),
  takže pojistka posledního majitele tu nerozhoduje — rozhoduje nová
  spoušť (nezávislá kontrola 28. 9. 2026, U9).
*/
set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);
select pg_temp.check('vedoucí druhého majitele v Lidech NESMAŽE',
  pg_temp.spadne_hlaskou($q$update public.employees set deleted_at = now()
                             where id = '61610000-0000-4000-8000-000000000106'$q$,
    '42501', 'Majitele v Lidech smaže jen majitel'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000006', false);
select pg_temp.check('druhý majitel do firmy vidí dál',
  app.has_access(:'firma', 'people.manage'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);
select pg_temp.check('majitel druhého majitele smaže',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000106'$q$));

select pg_temp.check('… a obnoví (majitelství vrátí jen majitel — strop to pustí)',
  pg_temp.projde($q$update public.employees set deleted_at = null
                     where id = '61610000-0000-4000-8000-000000000106'$q$));

reset role;
select set_config('test.user_id', '', false);

-- Bez přihlášeného (migrace, servisní klíč) se strop ani zábrana neměří.
select pg_temp.check('bez přihlášeného jde majitele smazat i obnovit',
  pg_temp.projde($q$update public.employees set deleted_at = now()
                     where id = '61610000-0000-4000-8000-000000000106'$q$)
  and pg_temp.projde($q$update public.employees set deleted_at = null
                         where id = '61610000-0000-4000-8000-000000000106'$q$));

select pg_temp.check('druhý majitel je na konci živý a aktivní',
  (select deleted_at is null from public.employees where id = '61610000-0000-4000-8000-000000000106')
  and (select status from public.memberships
        where tenant_id = :'firma' and user_id = '61610000-0000-4000-8000-000000000006') = 'active');

set role authenticated;

-- Cizí firma má jediného majitele (05). Smazat ho nejde ani touhle cestou.
select set_config('test.user_id', '61610000-0000-4000-8000-000000000005', false);
select pg_temp.check('posledního majitele smazat nejde (pojistka z 20260909100000, oddíl 7)',
  pg_temp.spadne_hlaskou(format(
    $q$update public.employees set deleted_at = now() where id = %L$q$, :'eb05'),
    '23001', 'aspoň jeden majitel'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('… a jeho členství zůstalo aktivní',
  (select status from public.memberships
    where tenant_id = :'cizi' and user_id = '61610000-0000-4000-8000-000000000005') = 'active');


\echo ''
\echo '== 11. Účty lidí pro formulář pozvánky ==================='

set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

create temp table ucty61 as select * from public.ucty_lidi(:'firma');

select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);
select pg_temp.check('bez správy lidí účty nedostane',
  not exists (select 1 from public.ucty_lidi(:'firma')));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Kateřina má po přesunu zamaskovaný nový účet',
  exists (select 1 from ucty61
          where employee_id = '61610000-0000-4000-8000-000000000103' and ucet = 'k***@novy.cz'));

select pg_temp.check('smazaný člověk a lidé z cizí firmy v seznamu nejsou',
  not exists (select 1 from ucty61
              where employee_id in ('61610000-0000-4000-8000-000000000121',
                                    '61610000-0000-4000-8000-000000000190',
                                    '61610000-0000-4000-8000-000000000114')));

select pg_temp.check('lidé bez účtu v seznamu nejsou',
  not exists (select 1 from ucty61
              where employee_id in ('61610000-0000-4000-8000-000000000116')));

\echo ''
\echo '== 12. Zrušit pozvánku ==================================='

/*
  Pozvánky do tabulky od téhle migrace nikdo přímo nezapíše, tak ani
  nezruší (oddíl 1). Zrušení jde přes funkci:
    * inv_nikola  — obyčejná, čeká (vystavil majitel, Nikola bez účtu);
    * inv_mezitim — PŘESUN Luciina účtu, čeká (přijetí v oddílu 5 spadlo);
    * inv_presun  — přesun Kateřiny, PŘIJATÁ (oddíl 3).
*/
set role authenticated;
select set_config('test.user_id', '61610000-0000-4000-8000-000000000028', false);

select pg_temp.check('bez správy lidí pozvánku nezruší',
  pg_temp.spadne_hlaskou(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_nikola'),
    '42501', 'Rušit pozvánky může jen'));

-- 05 je majitelem cizí firmy: tam správu lidí má, naši pozvánku přes
-- svou firmu zrušit nesmí (filtr firmy u pozvánky).
select set_config('test.user_id', '61610000-0000-4000-8000-000000000005', false);

select pg_temp.check('majitel cizí firmy naši pozvánku nezruší (ani přes svou firmu)',
  pg_temp.spadne_hlaskou(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'cizi', :'inv_nikola'),
    '22023', 'Takovou pozvánku ve firmě nemáte'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000002', false);

select pg_temp.check('vedoucí pozvánku k PŘESUNU nezruší (přesun je věc majitele)',
  pg_temp.spadne_hlaskou(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_mezitim'),
    '42501', 'zruší jen majitel'));

select pg_temp.check('vedoucí obyčejnou pozvánku zruší',
  pg_temp.projde(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_nikola')));

select pg_temp.check('podruhé → „už je zrušená"',
  pg_temp.spadne_hlaskou(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_nikola'),
    '22023', 'už je zrušená'));

select pg_temp.check('přijatou pozvánku zrušit nejde',
  pg_temp.spadne_hlaskou(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_presun'),
    '22023', 'už byla přijatá'));

select pg_temp.check('zrušenou pozvánku přijetí odmítne',
  pg_temp.spadne_hlaskou(format($q$select public.accept_invitation(%L)$q$, :'tok_nikola'),
    '22023', 'Pozvánka byla zrušena'));

select set_config('test.user_id', '61610000-0000-4000-8000-000000000001', false);

select pg_temp.check('majitel pozvánku k přesunu zruší',
  pg_temp.projde(format($q$select public.zrusit_pozvanku(%L, %L)$q$, :'firma', :'inv_mezitim')));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('zrušené mají revoked_at, přijatá ne',
  (select count(*) from public.invitations
    where id in (:'inv_nikola', :'inv_mezitim') and revoked_at is not null) = 2
  and (select revoked_at is null from public.invitations where id = :'inv_presun'));

select pg_temp.check('zrušení je v auditu i s tím, kdo to udělal',
  exists (select 1 from public.audit_log
          where tenant_id = :'firma' and action = 'invitation.revoke'
            and entity_id = :'inv_nikola'
            and actor_id = '61610000-0000-4000-8000-000000000002')
  and exists (select 1 from public.audit_log
              where tenant_id = :'firma' and action = 'invitation.revoke'
                and entity_id = :'inv_mezitim'
                and actor_id = '61610000-0000-4000-8000-000000000001'
                and after ->> 'nahrazuje_ucet' = '61610000-0000-4000-8000-000000000007'));

\echo ''
\echo '== KROK 61 HOTOV ========================================'
