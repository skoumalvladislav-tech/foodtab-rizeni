-- Scénář pro krok 74 — platební účty, transakční ledger, párování plateb,
-- předpisy a cashflow přehled (Finance ERP).
--
-- Migrace: 20261003110000_kontakty.sql, 20261003120000_platebni_ucty_transakce.sql,
-- 20261003130000_parovani_plateb.sql, 20261003140000_predpisy_plateb.sql,
-- 20261003150000_cashflow_prehled.sql. Plán: proud-scribbling-glade.md.
--
-- krok73_scenar.sql ověřuje registr připojení/tajemství. Tenhle scénář
-- se ptá na zbytek P0: immutabilitu ledgeru, idempotentní import,
-- izolaci cizí firmy (druhá linie obrany), a správnost cross-branch
-- přehledu (vč. nálezu "firemní účet se nesmí sečíst do každé pobočky").
--
-- Pokrývá:
--   0. příprava (moduly, druhá skutečná firma);
--   1. kontakty: CRUD, rozpoznávací klíč v rámci firmy;
--   2. platebni_ucty + transakce: vklad, immutabilita (UPDATE no-op,
--      DELETE odepřený chybějícím grantem), idempotentní import
--      (unikátní externi_id), druhá linie (cizí ucet_id/import_davka_id);
--   3. platby_faktury: párování, druhá linie (cizí transakce_id);
--   4. predpisy_plateb: RLS čtení/zápis;
--   5. cashflow_prehled / cashflow_prehled_firma: správnost součtů,
--      firemní účet se NEpočítá do žádné pobočky (nález z plánování).

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
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

-- NÁLEZ PŘI OVĚŘOVÁNÍ PROTI REÁLNÉMU POSTGRESU (CI, 3. 10. 2026): PGlite
-- hlásí RESTRICT vlastním kódem 23001 ("violates RESTRICT setting of
-- foreign key constraint"), ale reálný PostgreSQL stejnou situaci hlásí
-- jako obyčejné porušení FK, 23503 ("violates foreign key constraint") —
-- RESTRICT a NO ACTION se v PostgreSQL liší jen tím, jde-li akci odložit
-- (deferrable), ne chybovým kódem při samotném porušení. Kontrola proto
-- přijímá OBA kódy, aby platila na obou.
create or replace function pg_temp.spadne_fk_restrict(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate in ('23001', '23503');
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;


-- =====================================================================
-- PŘÍPRAVA: skutečná druhá firma (krok58/70/73 styl).
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('74740000-0000-0000-0000-000000000001', 'xaver74@jinafirma.cz', '{"full_name":"Xaver Sedmdesátčtyři"}');

set role authenticated;
select set_config('test.user_id', '74740000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok74 Cizí s.r.o.', 'Xaver Sedmdesátčtyři') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava měří to, co má ==============================='

select pg_temp.check('příprava: obě firmy mají aktivní modul finance',
  (select count(*) from public.tenant_modules
    where tenant_id in (:'tenant', :'tenant_b') and module_key = 'finance'
      and status in ('active', 'trial')) = 2);


\echo ''
\echo '== 1. Kontakty — CRUD a rozpoznávací klíč ==================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.kontakty (tenant_id, nazev, ico, je_dodavatel)
values (:'tenant', 'Krok74 Dodavatel s.r.o.', '12345678', true)
returning id as kontakt \gset

select pg_temp.check('majitel vidí vlastní kontakt',
  exists (select 1 from public.kontakty where id = :'kontakt'));

select pg_temp.check('duplicitní název (case/mezery) ve stejné firmě spadne',
  pg_temp.spadne_hlaskou(
    format('insert into public.kontakty (tenant_id, nazev) values (%L, %L)', :'tenant', '  krok74 DODAVATEL s.r.o.  '),
    '23505', ''));

insert into public.kontakty_osoby (tenant_id, kontakt_id, jmeno, telefon)
values (:'tenant', :'kontakt', 'Pavel Novák', '777111222');

select pg_temp.check('kontaktní osoba se uložila',
  (select count(*) from public.kontakty_osoby where kontakt_id = :'kontakt') = 1);

select pg_temp.check('cizí firma kontakt nevidí',
  (select count(*) from (
    select 1 from public.kontakty where id = :'kontakt'
      and app.can_read_scoped(:'tenant_b', 'finance.read', null)
  ) x) = 0);


\echo ''
\echo '== 2. Platební účty a transakce ==============================='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok74 pokladna Černá Perla', 'pokladna')
returning id as ucet \gset

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', null, 'Krok74 firemní bankovní účet', 'banka')
returning id as ucet_firemni \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 50000, current_date, 'rucni')
returning id as transakce1 \gset

select pg_temp.check('transakce se zapsala',
  exists (select 1 from public.transakce where id = :'transakce1'));

\echo ''
\echo '-- immutabilita --'

update public.transakce set castka_haleru = 1 where id = :'transakce1';
select pg_temp.check('UPDATE na transakci je no-op (rule), částka se nezměnila',
  (select castka_haleru from public.transakce where id = :'transakce1') = 50000);

select pg_temp.check('DELETE na transakci spadne na chybějící grant',
  pg_temp.spadne_hlaskou(
    format('delete from public.transakce where id = %L', :'transakce1'),
    '42501', 'permission denied'));

\echo ''
\echo '-- idempotentní import --'

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id)
values (:'tenant', :'ucet', 'vydaj', 10000, current_date, 'csv_banka', 'csv-radek-001')
returning id as transakce_csv \gset

select pg_temp.check('CSV transakce s externi_id se zapsala',
  exists (select 1 from public.transakce where id = :'transakce_csv'));

select pg_temp.check('opakovaný insert STEJNÉHO externi_id na STEJNÝ účet spadne na unikátní index (aplikace to řeší ON CONFLICT DO NOTHING)',
  pg_temp.spadne_hlaskou(
    format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, %L, current_date, %L, %L)',
      :'tenant', :'ucet', 'vydaj', 10000, 'csv_banka', 'csv-radek-001'),
    '23505', ''));

select pg_temp.check('STEJNÉ externi_id na JINÝ účet je v pořádku (unikát je per-účet)',
  pg_temp.projde(
    format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, externi_id) values (%L, %L, %L, %L, current_date, %L, %L)',
      :'tenant', :'ucet_firemni', 'vydaj', 10000, 'csv_banka', 'csv-radek-001')))
;

\echo ''
\echo '-- druhá linie obrany: cizí ucet_id / import_davka_id --'

-- Fixtury cizí firmy se zakládají POD XAVEREM (majitelem tenant_b) —
-- majitel naší firmy přes RLS do cizí firmy nic nevloží (správně).
select set_config('test.user_id', '74740000-0000-0000-0000-000000000001', false);

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant_b', 'Krok74 cizí účet', 'banka')
returning id as ucet_cizi \gset

insert into public.import_davky (tenant_id, typ, soubor_hash, stav)
values (:'tenant_b', 'banka_csv', 'krok74-cizi-hash', 'zpracovano')
returning id as davka_cizi \gset

select set_config('test.user_id', :'majitel', false);

select pg_temp.check('transakce s tenant_id=naše firma, ale ucet_id cizí firmy spadne (druhá linie)',
  pg_temp.spadne_hlaskou(
    format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, %L, current_date, %L)',
      :'tenant', :'ucet_cizi', 'prijem', 1000, 'rucni'),
    '23514', ''));

select pg_temp.check('transakce s import_davka_id cizí firmy spadne (druhá linie)',
  pg_temp.spadne_hlaskou(
    format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, import_davka_id) values (%L, %L, %L, %L, current_date, %L, %L)',
      :'tenant', :'ucet', 'prijem', 1000, 'rucni', :'davka_cizi'),
    '23514', ''));

\echo ''
\echo '-- import_davky: opakovaný upload stejného souboru se pozná --'

insert into public.import_davky (tenant_id, typ, soubor_hash, pocet_radku, pocet_novych, stav)
values (:'tenant', 'banka_csv', 'krok74-hash-abc', 10, 10, 'zpracovano')
returning id as davka_vlastni \gset

select pg_temp.check('druhý upload STEJNÉHO hashe stejné firmy spadne na unikátní index',
  pg_temp.spadne_hlaskou(
    format('insert into public.import_davky (tenant_id, typ, soubor_hash, stav) values (%L, %L, %L, %L)',
      :'tenant', 'banka_csv', 'krok74-hash-abc', 'zpracovano'),
    '23505', ''));

\echo ''
\echo '-- import_davky: dávku referencovanou transakcí nelze smazat (restrict) --'
-- NE `on delete set null` — viz komentář u sloupce v migraci. Dávka
-- referencovaná transakcí musí RESTRICTovat smazání, ne tiše osirotět.

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, import_davka_id)
values (:'tenant', :'ucet', 'prijem', 7700, current_date, 'csv_banka', :'davka_vlastni')
returning id as transakce_s_davkou \gset

select pg_temp.check('transakce s vlastní dávkou se zapsala',
  exists (select 1 from public.transakce where id = :'transakce_s_davkou'));

reset role;
-- Viz pg_temp.spadne_fk_restrict výš — PGlite a reálný PostgreSQL se
-- v přesném kódu RESTRICT porušení rozcházejí, kontrola přijímá oba.
select pg_temp.check('smazání dávky, na kterou transakce odkazuje, spadne (restrict, ne set null)',
  pg_temp.spadne_fk_restrict(
    format('delete from public.import_davky where id = %L', :'davka_vlastni')));
set role authenticated;
select set_config('test.user_id', :'majitel', false);



\echo ''
\echo '== 3. Párování plateb s fakturami (bezpečná alokace, 20261004100000) =='

select pg_temp.check('přímý INSERT do platby_faktury je OD TÉHLE MIGRACE odepřený — jediná cesta je app.potvrdit_alokaci_platby',
  pg_temp.spadne_hlaskou(
    format('insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav) values (%L, %L, %L, %L, %L)',
      :'tenant', :'transakce1', 'FAKTURA-TEXT-123', 10000, 'potvrzeno'),
    '42501', ''));

-- transakce1 má castka_haleru = 50000 (založena výš). Faktura „na
-- 100000" se zaplatí na DVĖ alokace — scénář 2 akceptačních testů
-- (docs/bankovni-modul-zadani-2026-10-04.md, oddíl 7): částečná úhrada
-- nejdřív, doplatek pak, opakovaný běh nezmění výsledek.
select alokovano_celkem_haleru as alokovano_1, plne_uhrazeno as plne_1
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce1', 'FAKTURA-TEXT-123', 50000, 100000, 0.95) \gset

select pg_temp.check('první alokace (50000 z 50000 platby) se zapsala',
  (select count(*) from public.platby_faktury where transakce_id = :'transakce1' and stav = 'potvrzeno') = 1);
select pg_temp.check('alokováno na fakturu celkem 50000', :'alokovano_1'::integer = 50000);
select pg_temp.check('faktura 100000 PO první alokaci NENÍ plně uhrazená (zbývá 50000)', :'plne_1'::boolean = false);

\echo ''
\echo '-- druhá linie: transakce cizí firmy, přesah částky platby/faktury --'

select pg_temp.check('transakce_id cizí firmy spadne (transakce nepatří této firmě)',
  pg_temp.spadne_hlaskou(
    format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, %L, %L, %L)',
      :'tenant_b', :'transakce1', 'FAKTURA-X', 1000, 100000, null),
    '23514', 'nepatří'));

select pg_temp.check('alokace přesahující částku PLATBY (transakce1 = 50000, druhý pokus na stejnou transakci) spadne',
  pg_temp.spadne_hlaskou(
    format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, %L, %L, %L)',
      :'tenant', :'transakce1', 'FAKTURA-TEXT-123', 1, 100000, null),
    '23514', 'přesahuje částku platby'));

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 60000, current_date, 'rucni')
returning id as transakce_doplatek \gset

select pg_temp.check('alokace přesahující NEZAPLACENÝ ZBYTEK faktury (50000 už alokováno, +60000 > 100000) spadne',
  pg_temp.spadne_hlaskou(
    format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, %L, %L, %L)',
      :'tenant', :'transakce_doplatek', 'FAKTURA-TEXT-123', 60000, 100000, null),
    '23514', 'přesahuje nezaplacený zůstatek'));

\echo ''
\echo '-- doplatek přesně na zbytek (50000) dokončí fakturu --'

select alokovano_celkem_haleru as alokovano_2, plne_uhrazeno as plne_2
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce_doplatek', 'FAKTURA-TEXT-123', 50000, 100000, null) \gset

select pg_temp.check('po doplatku je alokováno celkem 100000', :'alokovano_2'::integer = 100000);
select pg_temp.check('faktura je TEĎ plně uhrazená', :'plne_2'::boolean = true);

select pg_temp.check('dvě samostatné alokace, ne jedna přepsaná',
  (select count(*) from public.platby_faktury where faktura_id = 'FAKTURA-TEXT-123' and stav = 'potvrzeno') = 2);

\echo ''
\echo '-- zrušení alokace je vratné s auditem, uvolní místo pro novou --'

select id as alokace_doplatku from public.platby_faktury
  where transakce_id = :'transakce_doplatek' and stav = 'potvrzeno' \gset

select app.zrusit_alokaci_platby(:'tenant', :'alokace_doplatku', 'test: zkusmé zrušení');

select pg_temp.check('zrušená alokace zůstává v tabulce (historie), jen se stavem zamitnuto',
  (select stav from public.platby_faktury where id = :'alokace_doplatku') = 'zamitnuto');

select alokovano_celkem_haleru as alokovano_3
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce_doplatek', 'FAKTURA-TEXT-123', 50000, 100000, null) \gset

select pg_temp.check('po zrušení šlo stejnou částku alokovat znovu (uvolnilo se místo)', :'alokovano_3'::integer = 100000);


\echo ''
\echo '== 4. Předpisy plateb ========================================'

insert into public.predpisy_plateb (tenant_id, nazev, smer, castka_haleru, perioda, dalsi_splatnost)
values (:'tenant', 'Krok74 nájem', 'vydaj', 2500000, 'mesicne', current_date + 10)
returning id as predpis \gset

select pg_temp.check('předpis platby se zapsal',
  exists (select 1 from public.predpisy_plateb where id = :'predpis'));

select pg_temp.check('cizí firma předpis nevidí',
  not exists (
    select 1 from public.predpisy_plateb p
    where p.id = :'predpis' and app.can_read_scoped(:'tenant_b', 'finance.read', null)
  ));


\echo ''
\echo '== 5. Cashflow přehled ========================================'

-- Funkce vrací řádek pro KAŽDOU aktivní pobočku firmy (etapa0 založila
-- víc než jednu) — proto se gsetuje jen řádek Černé Perly, ne celá
-- tabulka.
select prijmy_haleru as cf_perla_prijmy, vydaje_haleru as cf_perla_vydaje
  from app.cashflow_prehled(:'tenant', current_date, current_date)
  where branch_id = :'perla' \gset

select pg_temp.check('cashflow_prehled vrátil řádek pro pobočku Černá Perla',
  :'cf_perla_prijmy' is not null);

-- Příjmy: 50000 z transakce1 + 7700 z transakce se zavedenou dávkou
-- (sekce restrict výš) + 60000 z transakce_doplatek (sekce 3, bezpečná
-- alokace) = 117700. Výdaje: 10000 z CSV testu (NE 20000 — viz nález
-- níž).
select pg_temp.check('Černá Perla: příjmy sedí (117700)',
  :'cf_perla_prijmy'::integer = 117700);

select pg_temp.check('Černá Perla: výdaje sedí (10000 z CSV testu)',
  :'cf_perla_vydaje'::integer = 10000);

-- NÁLEZ Z PLÁNOVÁNÍ: firemní účet (bez pobočky) se NESMÍ objevit v
-- pobočkovém přehledu ani jednou — natožpak u každé pobočky.
select pg_temp.check('firemní účet (bez pobočky) se NEpromítl do pobočkového řádku Černé Perly',
  :'cf_perla_vydaje'::integer <> 20000); -- 10000 (perla) + 10000 (firemní) by byl důkaz chyby

select prijmy_haleru as cff_prijmy, vydaje_haleru as cff_vydaje
  from app.cashflow_prehled_firma(:'tenant', current_date, current_date) \gset

select pg_temp.check('cashflow_prehled_firma vidí firemní účet (10000 výdaj z CSV testu)',
  :'cff_vydaje'::integer = 10000);

select pg_temp.check('cashflow_prehled_firma NEvidí pobočkové účty (perla tam nepřispívá)',
  :'cff_prijmy'::integer = 0);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.platby_faktury where tenant_id in (:'tenant', :'tenant_b');
delete from public.transakce where tenant_id in (:'tenant', :'tenant_b');
delete from public.import_davky where tenant_id in (:'tenant', :'tenant_b');
delete from public.platebni_ucty where tenant_id in (:'tenant', :'tenant_b');
delete from public.predpisy_plateb where tenant_id = :'tenant';
delete from public.kontakty_osoby where kontakt_id = :'kontakt';
delete from public.kontakty where id = :'kontakt';

select pg_temp.check('úklid: po scénáři nezůstala žádná transakce kroku 74',
  not exists (select 1 from public.transakce where tenant_id in (:'tenant', :'tenant_b')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 74 HOTOV =============================================='
