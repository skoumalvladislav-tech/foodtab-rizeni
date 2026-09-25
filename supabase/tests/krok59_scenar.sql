-- Scénář pro krok 59 — pracovní účet zaměstnance a denní náklady na mzdy.
--
-- Pokrývá 20260925130000_ucet_a_naklady.sql: app.vydelek_po_dnech,
-- public.vydelky_po_dnech (Výdělky → „Po dnech") a
-- public.muj_pracovni_ucet (Docházka → „Můj účet"), rozhodnutí A–K
-- z hlavičky té migrace.
--
-- Stojí na VLASTNÍCH dvou firmách (naše a cizí) a na datech předchozích
-- scénářů nezávisí — dá se pustit i samotný:
--   node scripts/scenare-pglite.mjs krok59_scenar
--
-- Měsíce jsou pevné (duben a květen 2026, oba minulé), takže výsledek
-- nezáleží na dni, kdy scénář běží.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Kontrakt s aplikací: jména a typy sloupců, práva vlastníka, execute
--   jen pro přihlášené; pomocná app.vydelek_po_dnech zavřená úplně.
-- * ROZKLAD = app.earnings: po dnech sečteno přesně earnings (minuty,
--   haléře, příznak sazby) u každého člověka a měsíce. Dva případy, kde
--   by zaokrouhlení po dnech dalo jiný součet — a příprava, která to
--   ukáže na samotných číslech, ať kontrola měří to, kvůli čemu je.
-- * KONTROLA SHODY po dnech s vydelky_prehled: součet mzdy, minut
--   i záloh za měsíc je týž pro majitele (celá firma, pobočka A, B),
--   vedoucího jedné pobočky i účetní.
-- * Provozní den (odchod ve 3:00 patří do včerejška, i přes hranici
--   měsíce), storno se nepočítá, záloha podstrčená cizí firmou ne.
-- * Práva po dnech: bez payroll.read nic; vedoucí jen na A nemá
--   majitelovy hodiny ani zálohy (řádek bez pobočky), ani lidi z B;
--   cizí firma nic a její lidé nikdy k nám.
-- * Můj účet: jen já. Člen firmy bez záznamu nic (ani se záznamem
--   v cizí firmě), smazaný záznam nic, pozastavené členství nic, cizí
--   majitel nic, já s cizí firmou nic. Na každý filtr funkce jedna
--   kontrola, která bez něj spadne.
-- * Můj účet sedí s muj_vyplatni_prehled (dlaždice na Docházce):
--   vyděláno, zálohy, zbývá, nepotvrzené, příznak sazby.
-- * Zobrazení záloh podle volby firmy: odecitat / jen_ukazat /
--   neukazovat — i to, že den jen se zálohou při „neukazovat" zmizí.
-- * Bez sazby: NULL a příznak, nikdy nula; zůstatek od toho dne
--   „neúplný".
-- * Nový člověk, kterému se sazba zadá až po pár směnách (Nováček,
--   duben): chybějící haléř nedostane den bez sazby (tam by se ztratil)
--   a „neúplný" zůstatek začíná prvním dnem bez sazby — záloha před ním
--   ho nemá.
--
-- POZOR NA PGLITE: funkce jsou SECURITY DEFINER a práva si ověřují
-- samy přes auth.uid() → test.user_id, takže kontroly práv tady měří
-- i pod superuživatelem. Granty se hlídají katalogem
-- (has_function_privilege), ne voláním pod rolí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Majitel (…01) zakládá naši firmu, cizí majitel (…09) cizí. Majitel
-- má z app.create_tenant zaměstnanecký záznam BEZ pobočky.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('59590000-0000-0000-0000-000000000001', 'majitel59@foodtab.cz',   '{"full_name":"Majitel Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000002', 'vedouci59@foodtab.cz',   '{"full_name":"Vedoucí Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000003', 'provozni59@foodtab.cz',  '{"full_name":"Provozní Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000004', 'ucetni59@foodtab.cz',    '{"full_name":"Účetní Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000005', 'zuzana59@foodtab.cz',    '{"full_name":"Zuzana Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000006', 'tomas59@foodtab.cz',     '{"full_name":"Tomáš Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000007', 'clen59@foodtab.cz',      '{"full_name":"Člen Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000008', 'pozastaven59@foodtab.cz','{"full_name":"Pozastavený Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000009', 'cizi59@jinafirma.cz',    '{"full_name":"Cizí Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000010', 'smazany59@foodtab.cz',   '{"full_name":"Smazaný Padesátdevět"}'),
  ('59590000-0000-0000-0000-000000000011', 'novacek59@foodtab.cz',   '{"full_name":"Nováček Padesátdevět"}');

set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok59 Účet s.r.o.', 'Majitel Padesátdevět') as firma \gset
select set_config('test.user_id', '59590000-0000-0000-0000-000000000009', false);
select app.create_tenant('Krok59 Cizí s.r.o.', 'Cizí Padesátdevět') as cizi_firma \gset
reset role;
select set_config('test.user_id', '', false);

-- A i B: Praha, den od 5:00 (výchozí). Na nich stojí provozní den.
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok59 A', 'krok59-a') returning id as pob_a \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok59 B', 'krok59-b') returning id as pob_b \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Krok59 Cizí', 'krok59-cizi') returning id as pob_c \gset

select id as majitel      from public.employees where tenant_id = :'firma'      and je_majitel \gset
select id as cizi_majitel from public.employees where tenant_id = :'cizi_firma' and je_majitel \gset
select id as role_f from public.roles where tenant_id = :'firma' and not is_owner order by key limit 1 \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name) values
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000002', 'Vedoucí Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000003', 'Provozní Padesátdevět'),
  (:'firma', :'pob_b', '59590000-0000-0000-0000-000000000004', 'Účetní Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000005', 'Zuzana Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000006', 'Tomáš Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000008', 'Pozastavený Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000010', 'Smazaný Padesátdevět'),
  (:'firma', :'pob_a', '59590000-0000-0000-0000-000000000011', 'Nováček Padesátdevět'),
  (:'firma', :'pob_b', null, 'Bedřich Padesátdevět'),
  (:'firma', :'pob_a', null, 'Haléř Padesátdevět'),
  (:'firma', :'pob_a', null, 'Třetina Padesátdevět'),
  (:'firma', :'pob_a', null, 'Nula Padesátdevět'),
  -- Člen naší firmy BEZ našeho záznamu, ale se záznamem v cizí firmě.
  (:'cizi_firma', :'pob_c', '59590000-0000-0000-0000-000000000007', 'Člen Padesátdevět');

select max(id::text) filter (where full_name = 'Vedoucí Padesátdevět')     as vedouci,
       max(id::text) filter (where full_name = 'Provozní Padesátdevět')    as provozni,
       max(id::text) filter (where full_name = 'Účetní Padesátdevět')      as ucetni,
       max(id::text) filter (where full_name = 'Zuzana Padesátdevět')      as zuzana,
       max(id::text) filter (where full_name = 'Tomáš Padesátdevět')       as tomas,
       max(id::text) filter (where full_name = 'Pozastavený Padesátdevět') as pozastaveny,
       max(id::text) filter (where full_name = 'Smazaný Padesátdevět')     as smazany,
       max(id::text) filter (where full_name = 'Nováček Padesátdevět')     as novacek,
       max(id::text) filter (where full_name = 'Bedřich Padesátdevět')     as bedrich,
       max(id::text) filter (where full_name = 'Haléř Padesátdevět')       as haler,
       max(id::text) filter (where full_name = 'Třetina Padesátdevět')     as tretina,
       max(id::text) filter (where full_name = 'Nula Padesátdevět')        as nula,
       max(id::text) filter (where full_name = 'Člen Padesátdevět')        as clen_cizi
from public.employees where tenant_id in (:'firma', :'cizi_firma') \gset

-- Vedoucí: payroll.read, ale členství jen na pobočku A.
-- Provozní: docházka a zálohy na A, payroll.read NE.
-- Účetní: payroll.read s firemním rozsahem — není majitel.
-- Zuzana, Tomáš, Pozastavený, Smazaný, Nováček: žádné právo, jen
-- členství na A.
-- Člen: členství na A, zaměstnanecký záznam jen v CIZÍ firmě.
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'firma', :'vedouci',  'payroll.read',    true),
  (:'firma', :'provozni', 'attendance.read', true),
  (:'firma', :'provozni', 'advances.manage', true),
  (:'firma', :'ucetni',   'payroll.read',    true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma', '59590000-0000-0000-0000-000000000002', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000003', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000004', :'role_f', 'tenant', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000005', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000006', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000007', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000008', :'role_f', 'branch', 'suspended'),
  (:'firma', '59590000-0000-0000-0000-000000000010', :'role_f', 'branch', 'active'),
  (:'firma', '59590000-0000-0000-0000-000000000011', :'role_f', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pob_a'::uuid
  from public.memberships m
 where m.tenant_id = :'firma' and m.scope = 'branch';

/*
  Sazby. Tomáš nemá sazbu do 19. 5. (4. a 16. 5. bez ní, 21. 5. s ní).
  Nováček je nový: sazbu 200 Kč/h dostal až od 15. 4. (6. 4. bez ní,
  20. 4. s ní). Haléř a Třetina mají sazby, u kterých by zaokrouhlení
  po dnech dalo jiný součet než earnings (oddíl 2).
*/
insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from) values
  (:'firma', :'majitel',     30000, '2026-01-01'),
  (:'firma', :'zuzana',      20000, '2026-01-01'),
  (:'firma', :'zuzana',      26000, '2026-05-16'),
  (:'firma', :'tomas',       15000, '2026-05-20'),
  (:'firma', :'novacek',     20000, '2026-04-15'),
  (:'firma', :'bedrich',     18000, '2026-01-01'),
  (:'firma', :'haler',       10001, '2026-01-01'),
  (:'firma', :'tretina',        10, '2026-01-01'),
  (:'firma', :'nula',        15000, '2026-01-01'),
  (:'firma', :'pozastaveny', 15000, '2026-01-01'),
  (:'firma', :'smazany',     15000, '2026-01-01'),
  (:'cizi_firma', :'clen_cizi', 25000, '2026-01-01'),
  (:'cizi_firma', :'cizi_majitel', 25000, '2026-01-01');

/*
  Docházka. Provozní den dopočítá spoušť z pobočky (Praha, od 5:00),
  odchod zdědí den příchodu.
    Zuzana 1. 5. 2:00–4:00  → provozně 30. 4. (DUBEN), 120 min
    Zuzana 4. 5. 10–18      → 480 min × 200 Kč
    Zuzana 5. 5. 22:00–2:30 → provozně 5. 5., 270 min
    Zuzana 8. 5. 1:00–3:00  → provozně 7. 5., 120 min
    Zuzana 20. 5. 10–16     → 360 min × 260 Kč (nová sazba od 16.)
*/
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'zuzana', 'in',  '2026-05-01 02:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'out', '2026-05-01 04:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'in',  '2026-05-04 10:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'out', '2026-05-04 18:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'in',  '2026-05-05 22:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'out', '2026-05-06 02:30+02'),
  (:'firma', :'pob_a', :'zuzana', 'in',  '2026-05-08 01:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'out', '2026-05-08 03:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'in',  '2026-05-20 10:00+02'),
  (:'firma', :'pob_a', :'zuzana', 'out', '2026-05-20 16:00+02'),
  (:'firma', :'pob_a', :'tomas',  'in',  '2026-05-04 10:00+02'),
  (:'firma', :'pob_a', :'tomas',  'out', '2026-05-04 14:00+02'),
  -- 16. 5. pracuje SÁM a ještě bez sazby: den, kdy mzda není „0 Kč“.
  (:'firma', :'pob_a', :'tomas',  'in',  '2026-05-16 10:00+02'),
  (:'firma', :'pob_a', :'tomas',  'out', '2026-05-16 13:00+02'),
  (:'firma', :'pob_a', :'tomas',  'in',  '2026-05-21 10:00+02'),
  (:'firma', :'pob_a', :'tomas',  'out', '2026-05-21 12:00+02'),
  -- Nováček: 6. 4. dvě hodiny bez sazby, 20. 4. 4 h 2 min × 200 Kč/h
  -- = 806,666… Kč (oddíl 2).
  (:'firma', :'pob_a', :'novacek', 'in',  '2026-04-06 10:00+02'),
  (:'firma', :'pob_a', :'novacek', 'out', '2026-04-06 12:00+02'),
  (:'firma', :'pob_a', :'novacek', 'in',  '2026-04-20 10:00+02'),
  (:'firma', :'pob_a', :'novacek', 'out', '2026-04-20 14:02+02'),
  (:'firma', :'pob_b', :'bedrich','in',  '2026-05-04 10:00+02'),
  (:'firma', :'pob_b', :'bedrich','out', '2026-05-04 15:00+02'),
  -- Majitel (bez pobočky) pracuje na A — den, kdy je v práci sám.
  (:'firma', :'pob_a', :'majitel','in',  '2026-05-15 10:00+02'),
  (:'firma', :'pob_a', :'majitel','out', '2026-05-15 18:00+02'),
  -- Haléř: tři dny po minutě, 100,01 Kč/h. Třetina: 2, 2 a 5 minut
  -- za 0,10 Kč/h (oddíl 2).
  (:'firma', :'pob_a', :'haler',  'in',  '2026-05-12 10:00:00+02'),
  (:'firma', :'pob_a', :'haler',  'out', '2026-05-12 10:01:00+02'),
  (:'firma', :'pob_a', :'haler',  'in',  '2026-05-13 10:00:00+02'),
  (:'firma', :'pob_a', :'haler',  'out', '2026-05-13 10:01:00+02'),
  (:'firma', :'pob_a', :'haler',  'in',  '2026-05-14 10:00:00+02'),
  (:'firma', :'pob_a', :'haler',  'out', '2026-05-14 10:01:00+02'),
  (:'firma', :'pob_a', :'tretina','in',  '2026-05-25 10:00:00+02'),
  (:'firma', :'pob_a', :'tretina','out', '2026-05-25 10:02:00+02'),
  (:'firma', :'pob_a', :'tretina','in',  '2026-05-26 10:00:00+02'),
  (:'firma', :'pob_a', :'tretina','out', '2026-05-26 10:02:00+02'),
  (:'firma', :'pob_a', :'tretina','in',  '2026-05-27 10:00:00+02'),
  (:'firma', :'pob_a', :'tretina','out', '2026-05-27 10:05:00+02'),
  -- Nula: příchod a odchod omylem po sobě (30 s) — záznam s nulou minut.
  (:'firma', :'pob_a', :'nula',   'in',  '2026-05-22 09:00:00+02'),
  (:'firma', :'pob_a', :'nula',   'out', '2026-05-22 09:00:30+02'),
  (:'firma', :'pob_a', :'pozastaveny', 'in',  '2026-05-18 10:00+02'),
  (:'firma', :'pob_a', :'pozastaveny', 'out', '2026-05-18 12:00+02'),
  (:'firma', :'pob_a', :'smazany',     'in',  '2026-05-19 10:00+02'),
  (:'firma', :'pob_a', :'smazany',     'out', '2026-05-19 12:00+02'),
  (:'cizi_firma', :'pob_c', :'clen_cizi', 'in',  '2026-05-06 10:00+02'),
  (:'cizi_firma', :'pob_c', :'clen_cizi', 'out', '2026-05-06 12:00+02'),
  -- Cizí majitel (bez pobočky, jako náš): kdyby se ztratil filtr firmy,
  -- náš majitel by jeho 28. 5. uviděl — firemní payroll.read mu řádek
  -- bez pobočky pustí.
  (:'cizi_firma', :'pob_c', :'cizi_majitel', 'in',  '2026-05-28 10:00+02'),
  (:'cizi_firma', :'pob_c', :'cizi_majitel', 'out', '2026-05-28 12:00+02');

/*
  Zálohy (business_date = provozní den výdeje).
    Zuzana 4. 5.: 500 Kč potvrzená + 200 Kč nepotvrzená (dvě v jeden den)
    Zuzana 10. 5.: 300 Kč nepotvrzená — den bez práce
    Zuzana 11. 5.: 999 Kč STORNOVANÁ — den se neukáže vůbec
    Zuzana 30. 4.: 111 Kč — duben
    PODVRŽENÁ: cizí firma, cizí pobočka, NAŠE Zuzana, 12. 5., 777 Kč
    Tomáš 4. 5.: 100 Kč; Bedřich (B) 4. 5. vyplacená na A: 200 Kč
    Majitel 15. 5.: 500 Kč potvrzená; Smazaný 19. 5.: 50 Kč
    Nováček 2. 4.: 50 Kč — dřív, než poprvé pracoval (oddíl 5)
*/
insert into public.advances
  (tenant_id, branch_id, employee_id, castka_haleru, business_date, stav, potvrzeno_kdy, storno_duvod)
values
  (:'firma', :'pob_a', :'zuzana',  50000, '2026-05-04', 'potvrzena',   '2026-05-04 12:00+02', null),
  (:'firma', :'pob_a', :'zuzana',  20000, '2026-05-04', 'nepotvrzena', null, null),
  (:'firma', :'pob_b', :'zuzana',  30000, '2026-05-10', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'zuzana',  99900, '2026-05-11', 'stornovana',  null, 'Překlep v částce'),
  (:'firma', :'pob_a', :'zuzana',  11100, '2026-04-30', 'nepotvrzena', null, null),
  (:'cizi_firma', :'pob_c', :'zuzana', 77700, '2026-05-12', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'tomas',   10000, '2026-05-04', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'bedrich', 20000, '2026-05-04', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'majitel', 50000, '2026-05-15', 'potvrzena',   '2026-05-15 12:00+02', null),
  (:'firma', :'pob_a', :'smazany',  5000, '2026-05-19', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'novacek',  5000, '2026-04-02', 'nepotvrzena', null, null);

-- Smazaný je smazaný až teď — docházku a zálohu má z doby předtím.
update public.employees set deleted_at = now() where id = :'smazany';

select set_config('test.firma',      :'firma',      false);
select set_config('test.cizi_firma', :'cizi_firma', false);
select set_config('test.pob_a',      :'pob_a',      false);
select set_config('test.pob_b',      :'pob_b',      false);


\echo ''
\echo '== 1. Kontrakt s aplikací ===================================='

select pg_temp.check('vydelky_po_dnech: sloupce a typy přesně podle kontraktu',
  pg_get_function_result('public.vydelky_po_dnech(uuid, uuid, date)'::regprocedure)
  = 'TABLE(den date, lidi integer, odpracovano_minut integer, mzdy_haleru bigint, '
    'bez_sazby_lidi integer, zalohy_haleru bigint, zaloh integer, zaloh_nepotvrzenych integer)');

select pg_temp.check('muj_pracovni_ucet: sloupce a typy přesně podle kontraktu',
  pg_get_function_result('public.muj_pracovni_ucet(uuid, date)'::regprocedure)
  = 'TABLE(den date, odpracovano_minut integer, hodinova_haleru integer, vydelano_haleru bigint, '
    'sazba_chybi boolean, zalohy_haleru bigint, zaloh integer, zaloh_nepotvrzenych integer, '
    'zustatek_haleru bigint, zustatek_neuplny boolean, zobrazeni text)');

select pg_temp.check('obě běží s právy vlastníka a s prázdnou search_path',
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.vydelky_po_dnech(uuid, uuid, date)'::regprocedure,
                    'public.muj_pracovni_ucet(uuid, date)'::regprocedure)));

select pg_temp.check('volat je smí přihlášený, anon ne',
  has_function_privilege('authenticated', 'public.vydelky_po_dnech(uuid, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.vydelky_po_dnech(uuid, uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.muj_pracovni_ucet(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.muj_pracovni_ucet(uuid, date)', 'execute'));

select pg_temp.check('app.vydelek_po_dnech je zavřená: přihlášený ani anon ji volat nesmí',
  not has_function_privilege('authenticated', 'app.vydelek_po_dnech(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'app.vydelek_po_dnech(uuid, date)', 'execute'));

select pg_temp.check('příprava: provozní den pobočky A — 1:00 patří do včerejška, 10:00 do dneška',
  app.business_date(:'pob_a', '2026-05-08 01:00+02') = '2026-05-07'
  and app.business_date(:'pob_a', '2026-05-08 10:00+02') = '2026-05-08');


\echo ''
\echo '== 2. Rozklad po dnech = app.earnings ========================'

/*
  Haléř: 3 dny po minutě × 10 001 haléřů/h. Den přesně 166,68 haléře.
  Po dnech zaokrouhleno by to bylo 167 × 3 = 501, earnings zaokrouhlí
  součet: 30 003 / 60 = 500,05 → 500.

  Třetina: 20, 20 a 50 haléřominut (2, 2 a 5 minut × 0,10 Kč/h),
  součet 90/60 = 1,5 → 2. Po dnech zaokrouhleno 0 + 0 + 1 = 1. A sečtené
  numeric podíly (0,333…33 + 0,333…33 + 0,833…33) se uříznou na
  1,499…99 → 1 — proto rozklad počítá v celých číslech (bod B).

  Přípravy ověřují, že tyhle případy opravdu rozlišují správný rozklad
  od obou špatných — jinak by kontroly pod nimi nic neměřily.
*/
select pg_temp.check('příprava: u Haléře by zaokrouhlení po dnech dalo 501, earnings dá 500',
  (select sum(round(w.minut * 10001 / 60.0)) from app.worked_minutes(:'haler', '2026-05-01', '2026-05-31') w) = 501
  and (select vydelano_haleru from app.earnings(:'haler', '2026-05-01')) = 500);

select pg_temp.check('příprava: u Třetiny dá zaokrouhlení po dnech 1 i součet desetinných podílů 1, earnings 2',
  (select sum(round(w.minut * 10 / 60.0)) from app.worked_minutes(:'tretina', '2026-05-01', '2026-05-31') w) = 1
  and (select round(sum(w.minut * 10 / 60.0)) from app.worked_minutes(:'tretina', '2026-05-01', '2026-05-31') w) = 1
  and (select vydelano_haleru from app.earnings(:'tretina', '2026-05-01')) = 2);

select pg_temp.check('Haléř po dnech: 167 · 167 · 166 — chybějící haléře dostanou první dny se stejným zbytkem',
  (select string_agg(v.den || '=' || v.haleru, ' ' order by v.den)
     from app.vydelek_po_dnech(:'haler', '2026-05-17') v)
  = '2026-05-12=167 2026-05-13=167 2026-05-14=166');

select pg_temp.check('Třetina po dnech: 1 · 0 · 1 — haléř dostane největší zbytek (50), pak dřívější ze stejných (20)',
  (select string_agg(v.den || '=' || v.haleru, ' ' order by v.den)
     from app.vydelek_po_dnech(:'tretina', '2026-05-01') v)
  = '2026-05-25=1 2026-05-26=0 2026-05-27=1');

select pg_temp.check('Tomáš: dny bez sazby mají haléře NULL (ne 0), den se sazbou 300 Kč',
  (select string_agg(v.den || '=' || coalesce(v.haleru::text, 'NULL') || '/' || coalesce(v.sazba::text, 'NULL'),
                     ' ' order by v.den)
     from app.vydelek_po_dnech(:'tomas', '2026-05-01') v)
  = '2026-05-04=NULL/NULL 2026-05-16=NULL/NULL 2026-05-21=30000/15000');

/*
  Nováček: den bez sazby (6. 4.) PŘED dnem se zbytkem (20. 4., 242 min
  × 20 000 = 4 840 000 haléřominut, dolů 80 666, zbytek 40/60). earnings
  zaokrouhlí na 80 667, chybí tedy jeden haléř. Řazení zbytků je `desc`
  a NULL by v PostgreSQL stálo PRVNÍ — bez `nulls last` by haléř dostal
  den bez sazby, NULL + 1 = NULL, a ze součtu by se ztratil. U Tomáše
  se to projevit nemůže: 120 min × 15 000 dělí 60 beze zbytku.
*/
select pg_temp.check('příprava: Nováček má den bez sazby a jeden chybějící haléř (earnings 80 667, dolů 80 666)',
  (select sazba_chybi and vydelano_haleru = 80667 from app.earnings(:'novacek', '2026-04-01'))
  and (select count(*) filter (where app.rate_at(:'novacek', w.den) is null) = 1
              and sum(w.minut::bigint * 20000 / 60) filter (where w.den = '2026-04-20') = 80666
         from app.worked_minutes(:'novacek', '2026-04-01', '2026-04-30') w));

select pg_temp.check('Nováček po dnech: chybějící haléř dostane 20. 4. (se sazbou), ne 6. 4. bez sazby',
  (select string_agg(v.den || '=' || coalesce(v.haleru::text, 'NULL') || '/' || coalesce(v.sazba::text, 'NULL'),
                     ' ' order by v.den)
     from app.vydelek_po_dnech(:'novacek', '2026-04-01') v)
  = '2026-04-06=NULL/NULL 2026-04-20=80667/20000');

-- U každého člověka obou firem a obou měsíců: minuty, haléře i příznak
-- sazby sečtené po dnech = app.earnings. Čísla se neskládají vedle,
-- bere se přímo výstup obou funkcí.
do $$
declare
  c record;
begin
  for c in
    select e.id, e.full_name, m.mesic,
           ern.odpracovano_minut as e_minut, ern.vydelano_haleru as e_haleru, ern.sazba_chybi as e_chybi,
           coalesce(r.minut, 0) as r_minut, coalesce(r.haleru, 0) as r_haleru, coalesce(r.chybi, false) as r_chybi,
           coalesce(r.dnu, 0) as dnu
      from public.employees e
      cross join (values (date '2026-04-01'), (date '2026-05-01')) m(mesic)
      cross join lateral app.earnings(e.id, m.mesic) ern
      cross join lateral (
        select sum(v.minut) as minut, sum(v.haleru) as haleru,
               bool_or(v.sazba is null) as chybi, count(*) as dnu
          from app.vydelek_po_dnech(e.id, m.mesic) v
      ) r
     where e.tenant_id in (current_setting('test.firma')::uuid, current_setting('test.cizi_firma')::uuid)
     order by e.full_name, m.mesic
  loop
    if c.r_minut <> c.e_minut or c.r_haleru <> c.e_haleru or c.r_chybi <> c.e_chybi then
      raise exception 'SELHALO: rozklad % za %: po dnech % min / % hal. / chybí %, earnings % / % / %',
        c.full_name, c.mesic, c.r_minut, c.r_haleru, c.r_chybi, c.e_minut, c.e_haleru, c.e_chybi;
    end if;
    if c.dnu > 0 then
      raise notice '  OK    rozklad = earnings: % za % (% dnů, % min, % hal.)',
        c.full_name, to_char(c.mesic, 'MM/YYYY'), c.dnu, c.r_minut, c.r_haleru;
    end if;
  end loop;
end $$;


\echo ''
\echo '== 3. Po dnech: KONTROLA SHODY s vydelky_prehled ============='

/*
  Součet po dnech = součet po lidech, pro každého, kdo se ptá, a každý
  rozsah. Kdyby „Po dnech" počítalo mzdu jinak, pustilo jiné lidi nebo
  jiné zálohy, rozejde se to tady — čísla bere z obou funkcí.
*/
do $$
declare
  c        record;
  v_dny    record;
  v_lide   record;
  v_radku  integer;
begin
  for c in
    select * from (values
      (1, 'majitel, celá firma, květen',   '59590000-0000-0000-0000-000000000001', 'firma', null,    date '2026-05-01'),
      (2, 'majitel, pobočka A, květen',    '59590000-0000-0000-0000-000000000001', 'firma', 'pob_a', date '2026-05-01'),
      (3, 'majitel, pobočka B, květen',    '59590000-0000-0000-0000-000000000001', 'firma', 'pob_b', date '2026-05-01'),
      (4, 'majitel, celá firma, duben',    '59590000-0000-0000-0000-000000000001', 'firma', null,    date '2026-04-01'),
      (5, 'vedoucí jen s A, celá firma',   '59590000-0000-0000-0000-000000000002', 'firma', null,    date '2026-05-01'),
      (6, 'účetní s firemním rozsahem',    '59590000-0000-0000-0000-000000000004', 'firma', null,    date '2026-05-01'),
      (7, 'cizí majitel ve své firmě',     '59590000-0000-0000-0000-000000000009', 'cizi_firma', null, date '2026-05-01')
    ) t(n, popis, uzivatel, firma, pob, mesic)
    order by n
  loop
    perform set_config('test.user_id', c.uzivatel, false);

    select coalesce(sum(d.mzdy_haleru), 0) as mzdy, coalesce(sum(d.odpracovano_minut), 0) as minut,
           coalesce(sum(d.zalohy_haleru), 0) as zalohy, count(*) as radku
      into v_dny
      from public.vydelky_po_dnech(
             current_setting('test.' || c.firma)::uuid,
             case when c.pob is null then null else current_setting('test.' || c.pob)::uuid end,
             c.mesic) d;

    select coalesce(sum(v.vydelano_haleru), 0) as mzdy, coalesce(sum(v.odpracovano_minut), 0) as minut,
           coalesce(sum(v.zalohy_haleru), 0) as zalohy
      into v_lide
      from public.vydelky_prehled(
             current_setting('test.' || c.firma)::uuid,
             case when c.pob is null then null else current_setting('test.' || c.pob)::uuid end,
             c.mesic) v;

    if v_dny.mzdy <> v_lide.mzdy or v_dny.minut <> v_lide.minut or v_dny.zalohy <> v_lide.zalohy then
      raise exception 'SELHALO: shoda % (%): po dnech mzdy % / min % / zálohy %, po lidech % / % / %',
        c.n, c.popis, v_dny.mzdy, v_dny.minut, v_dny.zalohy, v_lide.mzdy, v_lide.minut, v_lide.zalohy;
    end if;
    -- Prázdné obě strany by se „shodly" taky; každý případ tu má data.
    if v_dny.radku = 0 then
      raise exception 'SELHALO: shoda % (%): po dnech nevrátilo nic — shoda nuly s nulou nic neměří',
        c.n, c.popis;
    end if;
    raise notice '  OK    shoda %: % — mzdy % hal., % min, zálohy % hal. (% dnů)',
      c.n, c.popis, v_dny.mzdy, v_dny.minut, v_dny.zalohy, v_dny.radku;
  end loop;
end $$;

set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000001', false);

/*
  Celý květen majitele na celou firmu. Řádek: den | lidí | minut |
  mzdy | bez sazby | zálohy | počet | nepotvrzených. Ruční čísla, ne
  dopočítaná (4. 5.: Zuzana 480 min 1 600 Kč, Tomáš 240 min bez
  sazby, Bedřich 300 min 900 Kč; zálohy 500 + 200 + 100 + 200 Kč).
  NULL u mzdy: 10. 5. (jen záloha) a 16. 5. (pracoval jen Tomáš bez
  sazby — tam by nula tvrdila, že den nic nestál).
*/
select pg_temp.check('majitel, květen, celá firma: všechny dny přesně',
  (select string_agg(concat_ws('|', d.den, d.lidi, d.odpracovano_minut, coalesce(d.mzdy_haleru::text, 'NULL'),
                               d.bez_sazby_lidi, d.zalohy_haleru, d.zaloh, d.zaloh_nepotvrzenych),
                     ' ' order by d.den)
     from public.vydelky_po_dnech(:'firma', null, '2026-05-01') d)
  = '2026-05-04|3|1020|250000|1|100000|4|3'
    ' 2026-05-05|1|270|90000|0|0|0|0'
    ' 2026-05-07|1|120|40000|0|0|0|0'
    ' 2026-05-10|0|0|NULL|0|30000|1|1'
    ' 2026-05-12|1|1|167|0|0|0|0'
    ' 2026-05-13|1|1|167|0|0|0|0'
    ' 2026-05-14|1|1|166|0|0|0|0'
    ' 2026-05-15|1|480|240000|0|50000|1|0'
    ' 2026-05-16|1|180|NULL|1|0|0|0'
    ' 2026-05-18|1|120|30000|0|0|0|0'
    ' 2026-05-20|1|360|156000|0|0|0|0'
    ' 2026-05-21|1|120|30000|0|0|0|0'
    ' 2026-05-22|1|0|0|0|0|0|0'
    ' 2026-05-25|1|2|1|0|0|0|0'
    ' 2026-05-26|1|2|0|0|0|0|0'
    ' 2026-05-27|1|5|1|0|0|0|0');

select pg_temp.check('provozní den: noc 8. 5. od 1:00 je řádek 7. 5., žádný 8. 5.',
  exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-07')
  and not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-08'));

select pg_temp.check('provozní den přes hranici měsíce: noc 1. 5. je v DUBNU (30. 4.), v květnu 1. 5. není',
  (select d.odpracovano_minut = 120 and d.zalohy_haleru = 11100
     from public.vydelky_po_dnech(:'firma', null, '2026-04-01') d
    where d.den = '2026-04-30')
  and not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01')
                   where den < '2026-05-04'));

select pg_temp.check('storno se nepočítá: den jen se stornovanou zálohou (11. 5.) v přehledu není',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-11'));

select pg_temp.check('zálohu podstrčenou cizí firmou (12. 5., 777 Kč) nepočítá',
  (select zalohy_haleru = 0 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-12'));

select pg_temp.check('smazaný člověk (19. 5.) v přehledu není — ani hodiny, ani záloha',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-19'));

select pg_temp.check('cizí firma: její člověk (6. 5.) ani její majitel bez pobočky (28. 5.) u nás nejsou',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01')
               where den in ('2026-05-06', '2026-05-28')));

select pg_temp.check('den uprostřed měsíce dá tentýž měsíc',
  (select string_agg(d::text, ' ' order by d.den) from public.vydelky_po_dnech(:'firma', null, '2026-05-17') d)
  = (select string_agg(d::text, ' ' order by d.den) from public.vydelky_po_dnech(:'firma', null, '2026-05-01') d));

select pg_temp.check('pobočka B: jen Bedřich (domovská B) — 4. 5. 300 min, 900 Kč, záloha 200 Kč vyplacená na A',
  (select string_agg(concat_ws('|', d.den, d.lidi, d.odpracovano_minut, d.mzdy_haleru, d.zalohy_haleru), ' ')
     from public.vydelky_po_dnech(:'firma', :'pob_b', '2026-05-01') d)
  = '2026-05-04|1|300|90000|20000');


\echo ''
\echo '== 4. Po dnech: práva ========================================'

select set_config('test.user_id', '59590000-0000-0000-0000-000000000002', false);

select pg_temp.check('vedoucí s payroll.read jen na A: 4. 5. jen Zuzana a Tomáš (bez Bedřicha z B)',
  (select concat_ws('|', d.lidi, d.odpracovano_minut, d.mzdy_haleru, d.zalohy_haleru)
     from public.vydelky_po_dnech(:'firma', null, '2026-05-01') d
    where d.den = '2026-05-04')
  = '2|720|160000|80000');

select pg_temp.check('… a den, kdy pracoval jen majitel (15. 5.), NEVIDÍ — ani hodiny, ani jeho zálohu',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') where den = '2026-05-15'));

select pg_temp.check('… a když si o pobočku B řekne sám, nedostane nic',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', :'pob_b', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000004', false);

select pg_temp.check('účetní s payroll.read na celou firmu (není majitel) vidí i majitelův 15. 5.',
  (select d.odpracovano_minut = 480 and d.mzdy_haleru = 240000
     from public.vydelky_po_dnech(:'firma', null, '2026-05-01') d
    where d.den = '2026-05-15'));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000003', false);

select pg_temp.check('docházka a zálohy bez payroll.read: nic, ani na své pobočce',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01'))
  and not exists (select 1 from public.vydelky_po_dnech(:'firma', :'pob_a', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

select pg_temp.check('zaměstnankyně bez práva: po dnech nic',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000009', false);

select pg_temp.check('majitel cizí firmy do naší nevidí',
  not exists (select 1 from public.vydelky_po_dnech(:'firma', null, '2026-05-01')));

-- Zároveň příprava pro kontrolu pod ní: v cizí firmě data JSOU. A náš
-- majitel (bez pobočky, 15. 5.) tu není — z jeho strany je to ta díra.
select pg_temp.check('ve své firmě vidí svého člověka (6. 5.) a sebe (28. 5.), nikoho od nás',
  (select string_agg(concat_ws('|', d.den, d.odpracovano_minut, d.mzdy_haleru), ' ' order by d.den)
     from public.vydelky_po_dnech(:'cizi_firma', null, '2026-05-01') d)
  = '2026-05-06|120|50000 2026-05-28|120|50000');

select pg_temp.check('… a naši Zuzanu se zálohou, kterou jí cizí firma podstrčila, nevidí',
  not exists (select 1 from public.vydelky_po_dnech(:'cizi_firma', null, '2026-05-01')
               where den = '2026-05-12'));


\echo ''
\echo '== 5. Můj účet: jen já, a sedí s dlaždicí ===================='

select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

/*
  Zuzana, květen, volba firmy „odecitat" (firma nastavení nemá →
  výchozí). Řádek: den | minut | sazba | vyděláno | bez sazby |
  zálohy | počet | nepotvrzených | zůstatek | neúplný | volba.
*/
select pg_temp.check('Zuzana, květen: každý den přesně, zůstatek průběžně',
  (select string_agg(concat_ws('|', u.den, u.odpracovano_minut, coalesce(u.hodinova_haleru::text, 'NULL'),
                               coalesce(u.vydelano_haleru::text, 'NULL'), u.sazba_chybi::text,
                               u.zalohy_haleru, u.zaloh, u.zaloh_nepotvrzenych,
                               u.zustatek_haleru, u.zustatek_neuplny::text, u.zobrazeni),
                     ' ' order by u.den)
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u)
  = '2026-05-04|480|20000|160000|false|70000|2|1|90000|false|odecitat'
    ' 2026-05-05|270|20000|90000|false|0|0|0|180000|false|odecitat'
    ' 2026-05-07|120|20000|40000|false|0|0|0|220000|false|odecitat'
    ' 2026-05-10|0|NULL|NULL|false|30000|1|1|190000|false|odecitat'
    ' 2026-05-20|360|26000|156000|false|0|0|0|346000|false|odecitat');

select pg_temp.check('den uprostřed měsíce dá tentýž účet',
  (select string_agg(u::text, ' ' order by u.den) from public.muj_pracovni_ucet(:'firma', '2026-05-17') u)
  = (select string_agg(u::text, ' ' order by u.den) from public.muj_pracovni_ucet(:'firma', '2026-05-01') u));

select pg_temp.check('provozní den přes hranici měsíce: noc 1. 5. je v dubnovém účtu jako 30. 4., se zálohou 111 Kč',
  (select string_agg(concat_ws('|', u.den, u.odpracovano_minut, u.vydelano_haleru, u.zalohy_haleru, u.zustatek_haleru), ' ')
     from public.muj_pracovni_ucet(:'firma', '2026-04-01') u)
  = '2026-04-30|120|40000|11100|28900');

/*
  Oddíl 4 migrace: dlaždice sčítala zálohy bez filtru firmy a od
  p_mesic dál. Obě kontroly bez té opravy spadnou (1 777 Kč; 0 Kč).
*/
select pg_temp.check('dlaždice (muj_vyplatni_prehled) zálohu podstrčenou cizí firmou nepočítá: 1 000 Kč, ne 1 777 Kč',
  (select zalohy_haleru = 100000 and zbyva_haleru = 346000 and zaloh_nepotvrzenych = 2
     from public.muj_vyplatni_prehled(:'firma', '2026-05-01')));

select pg_temp.check('… a se dnem uprostřed měsíce počítá zálohy od jeho začátku (4. a 10. 5.)',
  (select zalohy_haleru = 100000 from public.muj_vyplatni_prehled(:'firma', '2026-05-17')));

/*
  Shoda s dlaždicí na Docházce (muj_vyplatni_prehled) a s app.earnings
  — u Zuzany (vše se sazbou) i Tomáše (první den bez sazby). Konec
  zůstatku = zbývá k výplatě.
*/
do $$
declare
  c      record;
  v_ucet record;
  v_dl   record;
  v_konec bigint;
begin
  for c in
    select * from (values
      ('Zuzana, květen', '59590000-0000-0000-0000-000000000005', date '2026-05-01'),
      ('Zuzana, duben',  '59590000-0000-0000-0000-000000000005', date '2026-04-01'),
      ('Tomáš, květen',  '59590000-0000-0000-0000-000000000006', date '2026-05-01'),
      ('Nováček, duben', '59590000-0000-0000-0000-000000000011', date '2026-04-01')
    ) t(popis, uzivatel, mesic)
  loop
    perform set_config('test.user_id', c.uzivatel, false);

    select sum(u.odpracovano_minut) as minut, coalesce(sum(u.vydelano_haleru), 0) as vydelano,
           sum(u.zalohy_haleru) as zalohy, sum(u.zaloh_nepotvrzenych) as nepotvrzenych,
           bool_or(u.sazba_chybi) as chybi, count(*) as radku
      into v_ucet
      from public.muj_pracovni_ucet(current_setting('test.firma')::uuid, c.mesic) u;
    select u.zustatek_haleru into v_konec
      from public.muj_pracovni_ucet(current_setting('test.firma')::uuid, c.mesic) u
     order by u.den desc limit 1;
    select * into v_dl
      from public.muj_vyplatni_prehled(current_setting('test.firma')::uuid, c.mesic);

    if v_ucet.radku = 0
       or v_ucet.minut <> v_dl.odpracovano_minut
       or v_ucet.vydelano <> v_dl.vydelano_haleru
       or v_ucet.zalohy <> v_dl.zalohy_haleru
       or v_konec <> v_dl.zbyva_haleru
       or v_ucet.nepotvrzenych <> v_dl.zaloh_nepotvrzenych
       or v_ucet.chybi <> v_dl.sazba_chybi then
      raise exception 'SELHALO: účet × dlaždice (%): účet % min / % hal. / zálohy % / konec % / nepotvrz. % / chybí %; dlaždice % / % / % / % / % / %',
        c.popis, v_ucet.minut, v_ucet.vydelano, v_ucet.zalohy, v_konec, v_ucet.nepotvrzenych, v_ucet.chybi,
        v_dl.odpracovano_minut, v_dl.vydelano_haleru, v_dl.zalohy_haleru, v_dl.zbyva_haleru,
        v_dl.zaloh_nepotvrzenych, v_dl.sazba_chybi;
    end if;
    raise notice '  OK    účet = dlaždice: % — % min, % hal., zálohy %, zbývá %',
      c.popis, v_ucet.minut, v_ucet.vydelano, v_ucet.zalohy, v_konec;
  end loop;
end $$;

select set_config('test.user_id', '59590000-0000-0000-0000-000000000006', false);

select pg_temp.check('Tomáš: den bez sazby = NULL a příznak, ne 0 Kč; zůstatek od něj „neúplný" i dál',
  (select string_agg(concat_ws('|', u.den, u.odpracovano_minut, coalesce(u.vydelano_haleru::text, 'NULL'),
                               u.sazba_chybi::text, u.zustatek_haleru, u.zustatek_neuplny::text),
                     ' ' order by u.den)
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u)
  = '2026-05-04|240|NULL|true|-10000|true'
    ' 2026-05-16|180|NULL|true|-10000|true'
    ' 2026-05-21|120|30000|false|20000|true');

/*
  Bod J: „neúplný" je PRŮBĚŽNÝ — od prvního dne bez sazby dál, ne za
  celý měsíc. U Tomáše se to nerozliší (den bez sazby je hned první),
  u Nováčka ano: záloha 2. 4. je před prací bez sazby 6. 4. a zůstatek
  toho dne je úplný (−50 Kč = jen ta záloha).
*/
select set_config('test.user_id', '59590000-0000-0000-0000-000000000011', false);

select pg_temp.check('Nováček: záloha před prvním dnem bez sazby — ten den zůstatek ještě úplný, od 6. 4. „neúplný"',
  (select string_agg(concat_ws('|', u.den, u.odpracovano_minut, coalesce(u.vydelano_haleru::text, 'NULL'),
                               u.sazba_chybi::text, u.zustatek_haleru, u.zustatek_neuplny::text),
                     ' ' order by u.den)
     from public.muj_pracovni_ucet(:'firma', '2026-04-01') u)
  = '2026-04-02|0|NULL|false|-5000|false'
    ' 2026-04-06|120|NULL|true|-5000|true'
    ' 2026-04-20|242|80667|false|75667|true');

select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

select pg_temp.check('storno (11. 5.) ani záloha podstrčená cizí firmou (12. 5.) v Zuzanině účtu nejsou',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')
               where den in ('2026-05-11', '2026-05-12')));

select pg_temp.check('Zuzana s CIZÍ firmou: nic',
  not exists (select 1 from public.muj_pracovni_ucet(:'cizi_firma', '2026-05-01')));


\echo ''
\echo '== 6. Můj účet: nikdo jiný ==================================='

/*
  Na každý filtr v `ja` jedna kontrola, která bez něj spadne:
    e.user_id = auth.uid()  — člen bez našeho záznamu by dostal cizí řádky
    e.tenant_id = p_tenant  — … a jeho záznam z CIZÍ firmy (má tam 6. 5.)
    e.deleted_at is null    — smazaný by viděl svůj 19. 5.
    app.is_member(p_tenant) — pozastavený by viděl svůj 18. 5.
*/
-- Příprava čte tabulky jako superuživatel: pod authenticated by na
-- opravdovém PostgreSQL cizí firmu schovalo RLS a příprava by lhala.
reset role;
select pg_temp.check('příprava: člen má u nás živé členství, žádný záznam, a záznam s docházkou v cizí firmě',
  exists (select 1 from public.memberships where tenant_id = :'firma' and status = 'active'
             and user_id = '59590000-0000-0000-0000-000000000007')
  and not exists (select 1 from public.employees where tenant_id = :'firma'
                     and user_id = '59590000-0000-0000-0000-000000000007')
  and exists (select 1 from public.employees e
                join lateral app.worked_minutes(e.id, '2026-05-01', '2026-05-31') w on true
               where e.tenant_id = :'cizi_firma'
                 and e.user_id = '59590000-0000-0000-0000-000000000007'));

set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000007', false);

select pg_temp.check('člen bez našeho záznamu: nic — ani cizí lidi, ani svůj řádek z cizí firmy',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')));

select pg_temp.check('… a v cizí firmě, kde záznam má, ale členem není: taky nic',
  not exists (select 1 from public.muj_pracovni_ucet(:'cizi_firma', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000010', false);

select pg_temp.check('smazaný záznam (členství živé): nic, ani jeho 19. 5.',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000008', false);

select pg_temp.check('pozastavené členství: nic, ani jeho 18. 5.',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000009', false);

select pg_temp.check('majitel cizí firmy do našeho účtu nic',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')));

select set_config('test.user_id', '59590000-0000-0000-0000-000000000001', false);

select pg_temp.check('majitel (bez pobočky) vidí svůj účet: 15. 5., 480 min, 2 400 Kč, záloha 500 Kč',
  (select string_agg(concat_ws('|', u.den, u.odpracovano_minut, u.vydelano_haleru, u.zalohy_haleru, u.zustatek_haleru), ' ')
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u)
  = '2026-05-15|480|240000|50000|190000');

select set_config('test.user_id', '', false);

select pg_temp.check('nepřihlášený: nic',
  not exists (select 1 from public.muj_pracovni_ucet(:'firma', '2026-05-01')));


\echo ''
\echo '== 7. Můj účet: zálohy podle volby firmy ====================='

reset role;
insert into public.tenant_settings (tenant_id, zalohy_zobrazeni) values (:'firma', 'jen_ukazat');
set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

select pg_temp.check('jen_ukazat: zálohy vidí, zůstatek NULL u každého dne',
  (select bool_and(u.zustatek_haleru is null and u.zobrazeni = 'jen_ukazat') and sum(u.zalohy_haleru) = 100000
          and count(*) = 5
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u));

reset role;
update public.tenant_settings set zalohy_zobrazeni = 'neukazovat' where tenant_id = :'firma';
set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

select pg_temp.check('neukazovat: sloupce záloh i zůstatek NULL, výdělek beze změny',
  (select bool_and(u.zalohy_haleru is null and u.zaloh is null and u.zaloh_nepotvrzenych is null
                   and u.zustatek_haleru is null and u.zobrazeni = 'neukazovat')
          and sum(u.vydelano_haleru) = 446000
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u));

select pg_temp.check('… a den jen se zálohou (10. 5.) v účtu vůbec není',
  (select string_agg(u.den::text, ' ' order by u.den) from public.muj_pracovni_ucet(:'firma', '2026-05-01') u)
  = '2026-05-04 2026-05-05 2026-05-07 2026-05-20');

select set_config('test.user_id', '59590000-0000-0000-0000-000000000001', false);

select pg_temp.check('volba je pro zaměstnance, ne pro vedení: po dnech ukazuje zálohy dál',
  (select sum(d.zalohy_haleru) = 180000 from public.vydelky_po_dnech(:'firma', null, '2026-05-01') d));

reset role;
update public.tenant_settings set zalohy_zobrazeni = 'odecitat' where tenant_id = :'firma';
set role authenticated;
select set_config('test.user_id', '59590000-0000-0000-0000-000000000005', false);

select pg_temp.check('zpátky na odecitat: zůstatek zase je (konec 3 460 Kč)',
  (select u.zustatek_haleru = 346000
     from public.muj_pracovni_ucet(:'firma', '2026-05-01') u
    order by u.den desc limit 1));


reset role;
select set_config('test.user_id', '', false);

/*
  ÚKLID TU SCHVÁLNĚ NENÍ — firmy s pobočkami smazat nejde (viz konec
  krok55_scenar.sql: kaskáda z tenants narazí na audit_log.branch_id
  a pravidlo audit_log_no_update). Obě firmy zůstávají, stejně jako po
  krok54 a krok55.
*/


\echo ''
\echo '== KROK 59 HOTOV ========================================'
