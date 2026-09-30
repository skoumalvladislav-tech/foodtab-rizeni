-- Scénář pro krok 65 — úklid otázky 18 (body d, f): e-mail „někdo
-- přijal pozvánku" počítá podle AKTUÁLNÍHO systému práv, ne podle staré
-- role u členství; jméno autora oznámení na Nástěnce se nemá ztratit,
-- když se autora mezitím smaže v Lidech.
--
-- Pokrývá migraci 20260929120000_uklid_pozvanky_lide.sql.
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab s.r.o., pobočka Černá
-- Perla, majitel Vladislav Skoumal). Pouští se i samostatně:
--   node scripts/scenare-pglite.mjs etapa0_scenar krok66_scenar
--
-- ---------------------------------------------------------------------
-- ZADÁNÍ (otázka 18 d, f — docs/hlaseni/otazky.md)
--
-- D) `public.komu_ohlasit_prijeti` počítala sloupec `ceka` („čeká
--    ten, kdo právě přijal pozvánku, ještě na oprávnění?") podle
--    `memberships.role_id is null`. Firma přešla 9. 9. 2026
--    (20260909100000_zarazeni_jadro.sql) na zařazení
--    (`employees.position_id`, `position_permissions`,
--    `employee_permissions`, `je_majitel`) jako zdroj pravdy o
--    právech — `role_id` od té doby o ničem nerozhoduje. Oprava
--    přepisuje `ceka` na stejný vzor jako `cekaji_na_opravneni`
--    (20260925150000, oddíl 8).
--
-- F) `public.jmena_autoru_oznameni` vrací jméno autora oznámení i ze
--    SMAZANÉHO záznamu v Lidech — filtr live/smazaný patří jen dosahu,
--    ne zobrazení jména. Dosah si funkce ověřuje SAMA (SECURITY
--    DEFINER, žádné RLS na `announcements` uvnitř neplatí): kromě
--    `communication.read` navíc korelačně ověří, že požadované
--    user_id je opravdu autorem oznámení, které by volající uměl
--    přečíst i přímo (review nálezu 29. 9. 2026 — bez korelace by
--    prošlo libovolné id v tenantu).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. bod d, případ „stará role, bez zařazení": `role_id` NASTAVENÝ
--      (starý model), `position_id` prázdný, žádná vlastní výjimka →
--      `ceka = true`. STARÝ kód by tu vrátil `false` (role_id is not
--      null) — a tvářil by se, že dotyčný oprávnění má, i když nemá
--      žádné.
--   2. bod d, opačný případ: `role_id` prázdný (nový model bez staré
--      role), zařazení, které NESE oprávnění (`position_permissions`)
--      → `ceka = false`. STARÝ kód by tu vrátil `true` (role_id is
--      null) — a poslal by e-mail o „čekání", i když dotyčný už
--      oprávnění má.
--   3. bod d, třetí větev stejné podmínky: bez role, bez zařazení,
--      ale s VLASTNÍ výjimkou (`employee_permissions.granted`) →
--      `ceka = false`. Nová podmínka má tři OR větve (majitel /
--      zařazení / výjimka) — tenhle případ drží tu třetí, kterou
--      případy 1–2 netestují.
--   4. bod d, adresáti a jméno toho, kdo přijal, se nezměnily —
--      kontrola nad případem 1, že majitel je mezi adresáty a
--      `kdo_prijal` je jméno z Lidí.
--   5. bod f: jméno autora, jehož záznam v Lidech je SMAZANÝ
--      (`deleted_at`), se vrátí — ne prázdno, ne „Neznámý".
--   6. bod f: živý autor (beze změny) a autor bez záznamu v Lidech
--      (jméno z profilu) — oba SKUTEČNÍ autoři viditelného oznámení.
--   7. bod f: dosah zůstal na `communication.read` — kdo ho nemá,
--      dostane PRÁZDNOU tabulku (ne chybu, ne jména cizích lidí).
--   8. bod f (review 29. 9. 2026): id SKUTEČNÉHO kolegy (Cyril — v
--      Lidech, s profilem, viditelný jako spolupracovník), který ale
--      NENÍ autorem žádného oznámení na Nástěnce, se NEVRÁTÍ — funkce
--      nesmí prozradit jméno kohokoli v tenantu jen podle
--      `communication.read`, musí ověřit i skutečné autorství.
--   9. bod f: zcela neznámé/vymyšlené id se stejně nevrátí (0 řádků,
--      ne „Neznámý", ne chyba) a dávka čtyř id (tři skuteční autoři +
--      jeden cizí kolega) vrátí jen ty tři — cizí id se tiše vynechá.
--
-- POZOR NA PGLITE: superuživatel, bez RLS a sloupcových grantů — obě
-- funkce jsou SECURITY DEFINER a ověřují si právo samy (`app.has_access`
-- / `app.kdo_ma_pravo`), takže tenhle scénář měří jejich VLASTNÍ logiku
-- a ne to, co by jinak hlídala RLS. To je přesně to, co bylo rozbité.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
-- Předchozí scénář (v PGlite v témže sezení) nechává test.user_id
-- nastavené — bez tohohle by přímé inserty níž běžely pod cizím
-- auth.uid().
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
--   Alena  — má starou roli (role_id), zařazení chybí, žádná výjimka.
--            (bod d, případ 1 — „stará role, bez zařazení")
--   Bedřich — bez staré role, zařazení „Krok66 čtenář" NESE
--            communication.read. (bod d, případ 2; slouží i jako
--            ČTENÁŘ Nástěnky v bodu f)
--   Cyril  — bez staré role, bez zařazení, vlastní výjimka
--            communication.read = true. (bod d, případ 3)
--   Emil   — autor oznámení, jeho záznam v Lidech se SMAŽE.
--            (bod f)
--   Filip  — autor oznámení, živý záznam v Lidech. (bod f, kontrola)
--   Gita   — bez záznamu v Lidech, jen profil. (bod f, jméno z profilu)
--   (id '65650000-…-000099' — nikde založené, „Neznámý")
-- =====================================================================

select id as tenant  from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla   from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

-- Obranně: krok12 tenhle sloupec u majitele na chvíli vypíná a zpátky
-- zapíná, ale případ 1 níž se opírá o to, že majitel dostane e-mail.
-- Nezávisle na pořadí scénářů v run.sh.
update public.profiles set upozorneni_emailem = true where user_id = :'majitel';

-- Emil a Filip mají v auth.users (tedy v public.profiles) ZÁMĚRNĚ
-- jiné jméno než v Lidech ("…(profil)") — jinak by kontrola dole
-- neuměla poznat, jestli jméno přišlo z employees, nebo jen náhodou
-- ze stejně znějícího profilu. Bez tohohle rozdílu by kontrola „smazaný
-- autor" prošla i nad mutací, která do JOINu vrátí `and e.deleted_at
-- is null` (ověřeno: schválné rozbití 29. 9. 2026, viz hlášení).
insert into auth.users (id, email, raw_user_meta_data) values
  ('65650000-0000-4000-8000-000000000001', 'alena66@foodtab.cz',   '{"full_name":"Alena Pětašedesátová"}'),
  ('65650000-0000-4000-8000-000000000002', 'bedrich66@foodtab.cz', '{"full_name":"Bedřich Pětašedesátý"}'),
  ('65650000-0000-4000-8000-000000000003', 'cyril66@foodtab.cz',   '{"full_name":"Cyril Pětašedesátý"}'),
  ('65650000-0000-4000-8000-000000000004', 'emil65@foodtab.cz',    '{"full_name":"Emil Pětašedesátý (profil)"}'),
  ('65650000-0000-4000-8000-000000000005', 'filip65@foodtab.cz',   '{"full_name":"Filip Pětašedesátý (profil)"}'),
  ('65650000-0000-4000-8000-000000000006', 'gita65@foodtab.cz',    '{"full_name":"Gita Pětašedesátová"}');

-- Vlastní zařazení pro krok66 — nese communication.read (case 2 v
-- bodu d, čtenář v bodu f). Jiné oprávnění by ve větvi
-- position_permissions fungovalo stejně (funkce se ptá jen na
-- EXISTENCI řádku), zvolené je jen tak, ať se dá znovu použít.
insert into public.positions (tenant_id, key, label, department)
values (:'tenant', 'krok66_ctenar', 'Krok66 čtenář', 'provoz');
select id as z_ctenar from public.positions
  where tenant_id = :'tenant' and key = 'krok66_ctenar' \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_ctenar', 'communication.read');

insert into public.employees
  (tenant_id, branch_id, user_id, full_name, position_id, employment_type)
values
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000001', 'Alena Pětašedesátová', null,        'hpp'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000002', 'Bedřich Pětašedesátý', :'z_ctenar',  'hpp'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000003', 'Cyril Pětašedesátý',   null,        'hpp'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000004', 'Emil Pětašedesátý',    null,        'hpp'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000005', 'Filip Pětašedesátý',   null,        'hpp');
-- Gita schválně BEZ záznamu v Lidech (jen profil) — bod f, jméno z profilu.

select id as e_alena   from public.employees where user_id = '65650000-0000-4000-8000-000000000001' \gset
select id as e_bedrich from public.employees where user_id = '65650000-0000-4000-8000-000000000002' \gset
select id as e_cyril   from public.employees where user_id = '65650000-0000-4000-8000-000000000003' \gset
select id as e_emil    from public.employees where user_id = '65650000-0000-4000-8000-000000000004' \gset
select id as e_filip   from public.employees where user_id = '65650000-0000-4000-8000-000000000005' \gset

-- Cyrilova vlastní výjimka (bez zařazení, bez staré role — jen tahle).
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_cyril', 'communication.read', true);

-- Emil je od teď smazaný — bod f testuje přesně tenhle stav.
update public.employees set deleted_at = now()
 where id = :'e_emil';

-- Skutečná oznámení na Nástěnce, která Emil/Filip/Gita napsali — bez
-- nich by korelace „user_id je autor oznámení, které volající smí
-- vidět" (oprava reviewového nálezu, 29. 9. 2026) vrátila 0 řádků pro
-- každého a testy níž by neměřily nic. Firemní cíl (employee_id/
-- usek_id/position_id všechny null) na pobočce Černá Perla — vidí ho
-- kdokoli s communication.read na týhle pobočce, tedy i Bedřich.
insert into public.announcements (tenant_id, branch_id, author_id, body)
values
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000004', 'Krok66: oznámení od Emila'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000005', 'Krok66: oznámení od Filipa'),
  (:'tenant', :'perla', '65650000-0000-4000-8000-000000000006', 'Krok66: oznámení od Gity');

-- Členství: Alena se STAROU rolí (role_id), Bedřich a Cyril BEZ ní
-- (nový model). Scope 'tenant' schválně, ať test nezávisí na
-- membership_branches — o tom `ceka` ani `jmena_autoru_oznameni`
-- nerozhodují.
insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values
  (:'tenant', '65650000-0000-4000-8000-000000000001', :'role_kuchyne', 'active', 'tenant'),
  (:'tenant', '65650000-0000-4000-8000-000000000002', null,            'active', 'tenant'),
  (:'tenant', '65650000-0000-4000-8000-000000000003', null,            'active', 'tenant');

-- Pozvánky „právě přijaté" (accepted_at < 5 minut) — jinak by
-- komu_ohlasit_prijeti nevrátila pro tyhle uživatele ani řádek.
insert into public.invitations
  (tenant_id, channel, email, token_hash, expires_at, accepted_at, accepted_by)
values
  (:'tenant', 'email', 'alena66@foodtab.cz',   'krok66-hash-alena',   now() + interval '7 days', now(), '65650000-0000-4000-8000-000000000001'),
  (:'tenant', 'email', 'bedrich66@foodtab.cz', 'krok66-hash-bedrich', now() + interval '7 days', now(), '65650000-0000-4000-8000-000000000002'),
  (:'tenant', 'email', 'cyril66@foodtab.cz',   'krok66-hash-cyril',   now() + interval '7 days', now(), '65650000-0000-4000-8000-000000000003');


\echo ''
\echo '== 1. bod d — ceka podle zařazení, ne podle staré role ======'

-- Případ 1: stará role, bez zařazení → pořád čeká (oprava). Starý kód
-- (role_id is null) by tu vrátil false.
select set_config('test.user_id', '65650000-0000-4000-8000-000000000001', false);
set role authenticated;

select pg_temp.check('Alena (role bez zařazení): ceka = true',
  (select bool_and(ceka) from public.komu_ohlasit_prijeti(:'tenant')) = true);

select pg_temp.check('… a majitel je mezi adresáty se svým e-mailem',
  exists (select 1 from public.komu_ohlasit_prijeti(:'tenant') k
           where k.adresa = 'majitel@foodtab.cz'));

select pg_temp.check('… kdo_prijal je jméno Aleny z Lidí',
  (select distinct kdo_prijal from public.komu_ohlasit_prijeti(:'tenant')) = 'Alena Pětašedesátová');

reset role;

-- Případ 2: zařazení nese právo, stará role prázdná → nečeká (oprava).
-- Starý kód (role_id is null) by tu vrátil true.
select set_config('test.user_id', '65650000-0000-4000-8000-000000000002', false);
set role authenticated;

select pg_temp.check('Bedřich (zařazení bez staré role, s právem): ceka = false',
  (select bool_or(ceka) from public.komu_ohlasit_prijeti(:'tenant')) = false);

reset role;

-- Případ 3: bez role, bez zařazení, jen vlastní výjimka → nečeká.
-- Třetí větev podmínky (employee_permissions), kterou případy 1–2
-- nezkouší vůbec.
select set_config('test.user_id', '65650000-0000-4000-8000-000000000003', false);
set role authenticated;

select pg_temp.check('Cyril (bez role, bez zařazení, vlastní výjimka): ceka = false',
  (select bool_or(ceka) from public.komu_ohlasit_prijeti(:'tenant')) = false);

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 2. bod f — jméno autora i po smazání záznamu =============='

-- Bedřich čte Nástěnku (communication.read ze zařazení) — jeho pohled
-- je ten, který app/[rozsah]/vzkazy/nastenka.tsx opravdu použije.
select set_config('test.user_id', '65650000-0000-4000-8000-000000000002', false);
set role authenticated;

select pg_temp.check('smazaný autor (Emil): jméno se vrátí, ne prázdno ani Neznámý',
  (select jmeno from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000004']::uuid[])) = 'Emil Pětašedesátý');

select pg_temp.check('živý autor (Filip): jméno beze změny',
  (select jmeno from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000005']::uuid[])) = 'Filip Pětašedesátý');

select pg_temp.check('bez záznamu v Lidech (Gita): jméno z profilu',
  (select jmeno from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000006']::uuid[])) = 'Gita Pětašedesátová');

-- Review 29. 9. 2026: Cyril je skutečný kolega (v Lidech, s profilem),
-- ale nenapsal na Nástěnce nic. Bez korelace na skutečné autorství by
-- funkce jeho jméno vrátila jen podle Bedřichova communication.read —
-- přesně tohle byl nález. Musí se nevrátit vůbec, ne prázdno/„Neznámý".
select pg_temp.check('cizí kolega (Cyril), který nic nenapsal: nevrátí se (0 řádků)',
  (select count(*) from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000003']::uuid[])) = 0);

select pg_temp.check('zcela neznámé/vymyšlené id: nevrátí se (0 řádků, ne „Neznámý", ne chyba)',
  (select count(*) from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000099']::uuid[])) = 0);

select pg_temp.check('jeden dotaz, čtyři id (tři autoři + jeden cizí kolega) → jen tři řádky',
  (select count(*) from public.jmena_autoru_oznameni(:'tenant', :'perla', array[
     '65650000-0000-4000-8000-000000000004',
     '65650000-0000-4000-8000-000000000005',
     '65650000-0000-4000-8000-000000000006',
     '65650000-0000-4000-8000-000000000003']::uuid[])) = 3);

reset role;

-- Dosah zůstal na communication.read: Alena ho nemá (bod d, případ 1),
-- takže dostane prázdnou tabulku, ne cizí jména ani chybu.
select set_config('test.user_id', '65650000-0000-4000-8000-000000000001', false);
set role authenticated;

select pg_temp.check('bez communication.read: prázdná tabulka, ne chyba',
  (select count(*) from public.jmena_autoru_oznameni(:'tenant', :'perla',
     array['65650000-0000-4000-8000-000000000004', '65650000-0000-4000-8000-000000000005']::uuid[])) = 0);

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== úklid =================================================='

delete from public.announcements where body like 'Krok66: oznámení od %';
delete from public.employee_permissions where employee_id in (:'e_cyril');
delete from public.invitations where token_hash like 'krok66-hash-%';
delete from public.memberships
 where tenant_id = :'tenant' and user_id::text like '65650000-0000-4000-8000-00000000000%';
delete from public.employees where id in (:'e_alena', :'e_bedrich', :'e_cyril', :'e_emil', :'e_filip');
delete from public.position_permissions where position_id = :'z_ctenar';
delete from public.positions where id = :'z_ctenar';
-- auth.users/profiles se schválně nemažou — žádný jiný scénář v sadě
-- to nedělá (jejich id nikde nekoliduje) a mazání profilu tu na PGlite
-- padá na referenční integritě employee_rates.created_by (ON DELETE
-- SET NULL, který PGlite v týhle situaci nevyhodnotí správně).

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 65 v Lidech ani v zařazeních',
  not exists (select 1 from public.employees where full_name like '%Pětašedesát%')
  and not exists (select 1 from public.positions where key = 'krok66_ctenar')
  and not exists (select 1 from public.invitations where token_hash like 'krok66-hash-%')
  and not exists (select 1 from public.announcements where body like 'Krok66: oznámení od %'));

\echo ''
\echo '== KROK 66 HOTOV ========================================='
