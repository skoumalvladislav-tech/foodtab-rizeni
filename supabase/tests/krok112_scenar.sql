-- Scénář pro krok 112 — Finance Fáze 0, krok 2: párování faktur s pohyby.
--
-- Migrace: 20261120100000_parovani_pravidla.sql.
-- Zadání: docs/finance-faze0-zadani.md, oddíl Krok 2, zkoušky 2, 3, 4 a 11.
--
-- Pokrývá:
--   1. sdílené příklady účtů (PRIKLADY_UCTU) — SQL app.normalizovat_ucet;
--      tytéž příklady čte scripts/finance-parovani.test.mjs pro TS;
--   2. zkouška 2 — jistá shoda jen při VS + částce v téže měně + shodném
--      platném IBAN + důvěryhodném zdroji; bez IBAN, s jiným nebo
--      neplatným účtem, se soupeřem (i vyřízeným), s prázdnou nebo jinou
--      měnou, u storna, mimo okno nebo u vrácené platby NE; výpis jen
--      potvrzený bankou nebo z dávky, kterou právě nahrál člověk s právem
--      potvrzovat párování (kdo dávku nahrál, zapíše databáze);
--   3. zkouška 3 — jedna platba na dvě faktury, dvě platby na jednu (na
--      haléř), nic přes částku platby, přeplatek faktury s varováním,
--      automatika nesahá na zčásti zaplacenou, EUR/EUR, jiná měna ne,
--      prázdná měna = CZK; návrhy jen do zbytku faktury i platby;
--   4. zkouška 4 — zrušení vrátí původní stav (ruční i automatické),
--      ruční úhrada s důvodem a její zrušení, spoušť proti přímému
--      „Uhrazeno", párovat jen schválenou fakturu, jiná měna jen ruční
--      úhradou, dobropis (vratka i započtení téhož dodavatele, IČO
--      firmy a sporné IČO ne), storno z banky ruší párování (i z importu),
--      ruční storno ne, storno jen opačné se stejnou částkou a měnou,
--      jediná funkce stavu, „Vrátit mezi neuhrazené" celé nebo nic;
--   5. návrhy: jednou, odmítnutý se nevrací, potvrzení, práva;
--   6. zkouška 11 — živé tvary faktur projdou beze změny;
--   7. granty a přímý zápis (obejití funkcí), RLS ručních úhrad;
--   8. audit bez čísel účtů;
--   9. ukázka: výpis × stažení z banky s jiným VS.
--
-- POZOR: PGlite běží jako superuživatel — kontroly RLS (oddíl 7) rozhoduje
-- až workflow Databáze proti PostgreSQL 16 („ověří CI").
--
-- Vlastní firmy a vlastní id — CI pouští všechny scénáře v jedné
-- databázi, nic se nepočítá přes cizí řádky. Data zůstávají (faktury
-- otevřené firmy smí smazat jen převod; firmy jsou jen tohoto scénáře).

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
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
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

-- Výsledek dotazu jako text, nebo 'chyba …' (kontrola pak spadne svým jménem).
create or replace function pg_temp.hodnota(p_sql text)
returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, '(NULL)');
exception when others then
  return 'chyba ' || sqlstate || ': ' || sqlerrm;
end $$;

-- Faktura (superuživatel = služba). Datum vystavení 5 dní zpátky.
create or replace function pg_temp.faktura(
  p_tenant uuid, p_cislo text, p_vs text, p_castka integer,
  p_mena text default 'CZK', p_ucet text default null, p_stav text default 'Ke kontrole úhrady',
  p_dodavatel text default 'Dodavatel 112 s.r.o.', p_ico text default null, p_datum date default null)
returns uuid language plpgsql as $$
declare
  v uuid;
  d date := coalesce(p_datum, current_date - 5);
begin
  insert into public.faktury (tenant_id, dodavatel, dodavatel_ico, cislo_faktury, variabilni_symbol, castka_haleru,
                              mena, datum_vystaveni, duzp, splatnost, ucet_dodavatele, stav)
  values (p_tenant, p_dodavatel, p_ico, p_cislo, p_vs, p_castka, p_mena, d, d, d + 14, p_ucet, p_stav)
  returning id into v;
  return v;
end $$;

-- Pohyb (superuživatel). Z banky dostane vlastní id. Při chybě NULL
-- a důvod — kontrola za ním spadne svým jménem.
create or replace function pg_temp.pohyb(
  p_tenant uuid, p_ucet uuid, p_smer text, p_castka integer, p_vs text,
  p_protiucet text default '19-2000145399/0800', p_zdroj text default 'banka_api', p_mena text default 'CZK',
  p_storno uuid default null, p_datum date default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, protistrana, protiucet, vs,
                                zdroj, externi_id, storno_of)
  values (p_tenant, p_ucet, p_smer, p_castka, p_mena, coalesce(p_datum, current_date - 2), 'Dodavatel 112 s.r.o.',
          p_protiucet, p_vs, p_zdroj,
          case when p_zdroj = 'banka_api' then 'k112-' || gen_random_uuid()::text end, p_storno)
  returning id into v;
  return v;
exception when others then
  raise notice '  (pohyb nezapsán: % %)', sqlstate, sqlerrm;
  return null;
end $$;

-- Řádek výpisu / stažení. Bez id = řádek výpisu.
create or replace function pg_temp.radek(
  p_smer text, p_castka integer, p_vs text, p_protiucet text default '19-2000145399/0800',
  p_id text default null, p_storno text default null, p_datum date default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'datum', to_char(coalesce(p_datum, current_date - 3), 'YYYY-MM-DD'), 'smer', p_smer,
    'castka_haleru', p_castka, 'mena', 'CZK', 'protistrana', 'Dodavatel 112 s.r.o.',
    'protiucet', p_protiucet, 'vs', p_vs, 'poznamka', '',
    'externi_id', p_id, 'storno_externi_id', p_storno))
$$;

-- Import (výpis i stažení), vrací id dávky, při chybě NULL.
create or replace function pg_temp.nahrat(p_tenant uuid, p_ucet uuid, p_zdroj text, p_hash text, p_radky jsonb)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  select x.davka_id into v
    from public.importovat_vypis(p_tenant, p_ucet, p_zdroj, 'krok112.csv', p_hash, p_radky) x;
  return v;
exception when others then
  raise notice '  (import spadl: % %)', sqlstate, sqlerrm;
  return null;
end $$;

-- Proč dvojice není jistá shoda (kód), 'jistá' = je.
create or replace function pg_temp.kod_shody(p_tenant uuid, p_t uuid, p_f uuid, p_davka uuid default null)
returns text language plpgsql as $$
begin
  return coalesce(app.posoudit_jistou_shodu(p_tenant, p_t, p_f, p_davka), 'jistá');
exception when others then
  return 'chyba ' || sqlstate || ': ' || sqlerrm;
end $$;

create or replace function pg_temp.shoda(p_nazev text, p_tenant uuid, p_t uuid, p_f uuid, p_ocekavany text)
returns void language plpgsql as $$
declare
  v text := pg_temp.kod_shody(p_tenant, p_t, p_f);
begin
  perform pg_temp.check(p_nazev || ' — naměřeno: ' || v, v = p_ocekavany);
end $$;

-- Automatické párování úlohou (superuživatel bez přihlášeného).
create or replace function pg_temp.automatika(p_tenant uuid, p_t uuid, p_f uuid, p_castka integer)
returns text language plpgsql as $$
begin
  return case when public.automaticky_sparovat_fakturu(p_tenant, p_t, p_f, p_castka) then 'ano' else 'ne' end;
exception when others then
  return 'chyba ' || sqlstate || ': ' || sqlerrm;
end $$;

-- Ruční párování v roli, která právě platí: 'stav;alokováno;plně;přebytek'.
create or replace function pg_temp.sparuj(p_tenant uuid, p_t uuid, p_f uuid, p_castka integer)
returns text language plpgsql as $$
declare
  v record;
begin
  select * into v from public.sparovat_platbu_s_fakturou(p_tenant, p_t, p_f, p_castka, null);
  return concat_ws(';', coalesce(v.stav_faktury, '(beze změny)'), v.alokovano_celkem_haleru, v.plne_uhrazeno::text, v.prebytek_haleru);
exception when others then
  return 'chyba ' || sqlstate || ': ' || sqlerrm;
end $$;

create or replace function pg_temp.potvrd(p_tenant uuid, p_navrh uuid)
returns text language plpgsql as $$
declare
  v record;
begin
  select * into v from public.potvrdit_navrh_parovani(p_tenant, p_navrh);
  return concat_ws(';', coalesce(v.stav_faktury, '(beze změny)'), v.alokovano_celkem_haleru, v.plne_uhrazeno::text, v.prebytek_haleru);
exception when others then
  return 'chyba ' || sqlstate || ': ' || sqlerrm;
end $$;

create or replace function pg_temp.stav(p_f uuid)
returns text language sql as $$
  select coalesce((select f.stav from public.faktury f where f.id = p_f), '(žádná)')
$$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Firma A (Finance, Faktury otevřené, IČO 21249946 jen v testu):
--   Marie — majitelka (smí párovat i ručně uhradit);
--   Filip — finance.read + finance.manage za celou firmu, BEZ Faktur
--           (párovat ani potvrzovat nesmí).
-- Firma B (cizí): Bohdan — majitel.
-- Účet dodavatele A = 19-2000145399/0800 (IBAN CZ6508000000192000145399).
-- =====================================================================

\set maj  11120000-0000-0000-0000-000000000001
\set fin  11120000-0000-0000-0000-000000000002
\set cizi 11120000-0000-0000-0000-000000000003

insert into auth.users (id, email, raw_user_meta_data) values
  (:'maj',  'marie112@foodtab.cz',  '{"full_name":"Marie Stodvanáctá"}'),
  (:'fin',  'filip112@foodtab.cz',  '{"full_name":"Filip Stodvanáctý"}'),
  (:'cizi', 'bohdan112@foodtab.cz', '{"full_name":"Bohdan Stodvanáctý"}');

set role authenticated;
select set_config('test.user_id', :'maj', false);
select app.create_tenant('Krok112 Alfa s.r.o.', 'Marie Stodvanáctá') as firma \gset
select set_config('test.user_id', :'cizi', false);
select app.create_tenant('Krok112 Beta s.r.o.', 'Bohdan Stodvanáctý') as firma_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'firma', 'finance'), (:'firma_b', 'finance')
on conflict (tenant_id, module_key) do nothing;
update public.tenants set ico = '21249946' where id = :'firma';
-- Faktury firmy otevřené (převod sám zkouší krok99).
insert into public.faktury_prevod (tenant_id, stav, zdroj, dokonceno_kdy)
values (:'firma', 'dokonceno', 'krok112.test', now());

insert into public.positions (tenant_id, key, label, department, active)
values (:'firma', 'krok112_finance', 'Krok112 — finance bez faktur', 'provoz', true) returning id as z_fin \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'firma', :'z_fin', 'finance.read'),
  (:'firma', :'z_fin', 'finance.manage');
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'fin', :'z_fin', 'Filip Stodvanáctý', 'hpp');
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'firma', :'fin', null, 'tenant', 'active');

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma', null, 'Krok112 účet', 'banka') returning id as ucet \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma', null, 'Krok112 výpis a stažení', 'banka') returning id as ucet_vs \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_b', null, 'Krok112 cizí účet', 'banka') returning id as ucet_b \gset

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('příprava: majitelka smí potvrzovat párování (public.smi_potvrdit_parovani)',
  public.smi_potvrdit_parovani(:'firma', null));
select set_config('test.user_id', :'fin', false);
select pg_temp.check('příprava: finance bez Faktur potvrzovat párování nesmí',
  not public.smi_potvrdit_parovani(:'firma', null));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Sdílené příklady účtů (SQL i TS) ===================================='

-- Blok mezi značkami čte scripts/finance-parovani.test.mjs a pouští ho
-- proti ibanZUctu v TS. Tvar řádku: ('vstup', 'IBAN') nebo ('vstup', null).
create temp table k112_ucty (vstup text not null, iban text);
insert into k112_ucty (vstup, iban) values
-- PRIKLADY_UCTU_ZACATEK
  ('19-2000145399/0800', 'CZ6508000000192000145399'),
  ('CZ65 0800 0000 1920 0014 5399', 'CZ6508000000192000145399'),
  ('cz6508000000192000145399', 'CZ6508000000192000145399'),
  ('19-2000145399/800', 'CZ6508000000192000145399'),
  (' 19-2000145399 / 0800 ', 'CZ6508000000192000145399'),
  ('000019-2000145399/0800', 'CZ6508000000192000145399'),
  ('2000145399/0800', 'CZ7908000000002000145399'),
  ('86-199488014/0300', 'CZ9703000000860199488014'),
  ('DE89370400440532013000', 'DE89370400440532013000'),
  ('GB82 WEST 1234 5698 7654 32', 'GB82WEST12345698765432'),
  ('123456789/0100', null),
  ('2001234567/2010', null),
  ('1000001018/0300', null),
  ('CZ6508000000192000145398', null),
  ('19-2000145398/0800', null),
  ('0000000001/0100', null),
  ('', null),
  ('účet u dodavatele', null),
  ('670100-2202419906/6210', null),
  ('2900123456/2010', null)
-- PRIKLADY_UCTU_KONEC
;

select pg_temp.check('příklady účtů: aspoň 10 příkladů, platné i neplatné — naměřeno: '
    || (select count(*) from k112_ucty) || ' / s IBAN ' || (select count(iban) from k112_ucty),
  (select count(*) from k112_ucty) >= 10
  and (select count(iban) from k112_ucty) >= 5
  and (select count(*) - count(iban) from k112_ucty) >= 5);
select pg_temp.check('příklady účtů: app.normalizovat_ucet dává očekávaný IBAN u každého — rozdíly: '
    || coalesce((select string_agg(format('%s → %s', vstup, coalesce(app.normalizovat_ucet(vstup), 'NULL')), '; ')
                   from k112_ucty where app.normalizovat_ucet(vstup) is distinct from iban), 'žádné'),
  not exists (select 1 from k112_ucty where app.normalizovat_ucet(vstup) is distinct from iban));
select pg_temp.check('VS bez úvodních nul a bez nečíslic, prázdný = NULL',
  app.normalizovat_vs('00123') = '123' and app.normalizovat_vs('VS: 0045/6') = '456'
  and app.normalizovat_vs('') is null and app.normalizovat_vs('000') is null);


\echo ''
\echo '== 2. Zkouška 2: jistá shoda ============================================'

-- J1: VS s úvodní nulou na faktuře, IBAN zapsaný jinak než číslo účtu.
select pg_temp.faktura(:'firma', 'K112-J1', '0011201', 112100, 'CZK', 'CZ65 0800 0000 1920 0014 5399') as f_j1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112100, '11201') as t_j1 \gset

select pg_temp.shoda('jistá shoda: VS s nulou, IBAN jinak zapsaný, pohyb z banky → jistá', :'firma', :'t_j1', :'f_j1', 'jistá');
select pg_temp.automatika(:'firma', :'t_j1', :'f_j1', 112100) as v \gset
select pg_temp.check('jistá shoda: automatika spáruje — naměřeno: ' || :'v', :'v' = 'ano');
select pg_temp.check('jistá shoda: faktura Uhrazeno, stav před úhradou Ke kontrole úhrady — naměřeno: '
    || pg_temp.stav(:'f_j1') || ' / ' || coalesce((select stav_pred_uhradou from public.faktury where id = :'f_j1'), 'NULL'),
  pg_temp.stav(:'f_j1') = 'Uhrazeno'
  and (select stav_pred_uhradou from public.faktury where id = :'f_j1') = 'Ke kontrole úhrady');
select pg_temp.check('jistá shoda: párování automaticky, důvod vs+castka+ucet, jistota 1, celá částka',
  exists (select 1 from public.platby_faktury
           where transakce_id = :'t_j1' and faktura = :'f_j1' and stav = 'potvrzeno'
             and zpusob = 'automaticky' and duvod = 'vs+castka+ucet' and jistota = 1 and castka_haleru = 112100));
select id as al_j1 from public.platby_faktury where transakce_id = :'t_j1' and faktura = :'f_j1' \gset

-- Účet: bez IBAN, nečitelný, jiný, prázdný protiúčet, neplatný (oba stejně).
select pg_temp.faktura(:'firma', 'K112-U1', '11202', 112200, 'CZK', null) as f_u1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112200, '11202') as t_u1 \gset
select pg_temp.faktura(:'firma', 'K112-U2', '11203', 112300, 'CZK', 'účet u dodavatele') as f_u2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112300, '11203') as t_u2 \gset
select pg_temp.faktura(:'firma', 'K112-U3', '11204', 112400, 'CZK', '19-2000145399/0800') as f_u3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112400, '11204', '86-199488014/0300') as t_u3 \gset
select pg_temp.faktura(:'firma', 'K112-U4', '11205', 112500, 'CZK', '19-2000145399/0800') as f_u4 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112500, '11205', '') as t_u4 \gset
select pg_temp.faktura(:'firma', 'K112-U5', '11217', 113700, 'CZK', '19-2000145398/0800') as f_u5 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 113700, '11217', '19-2000145398/0800') as t_u5 \gset

select pg_temp.shoda('jistá shoda: faktura bez účtu dodavatele → ucet', :'firma', :'t_u1', :'f_u1', 'ucet');
select pg_temp.shoda('jistá shoda: nečitelný účet dodavatele → ucet', :'firma', :'t_u2', :'f_u2', 'ucet');
select pg_temp.shoda('jistá shoda: jiný platný účet protistrany → ucet', :'firma', :'t_u3', :'f_u3', 'ucet');
select pg_temp.shoda('jistá shoda: prázdný protiúčet → ucet', :'firma', :'t_u4', :'f_u4', 'ucet');
select pg_temp.shoda('jistá shoda: stejný, ale neplatný účet (modul 11) → ucet', :'firma', :'t_u5', :'f_u5', 'ucet');
select pg_temp.automatika(:'firma', :'t_u1', :'f_u1', 112200) || '/' || pg_temp.automatika(:'firma', :'t_u3', :'f_u3', 112400)
    || '/' || pg_temp.automatika(:'firma', :'t_u4', :'f_u4', 112500) as v \gset
select pg_temp.check('automatika: bez účtu, s jiným účtem i bez protiúčtu nespáruje — naměřeno: ' || :'v', :'v' = 'ne/ne/ne');
select pg_temp.check('automatika: faktury bez shody účtu zůstaly Ke kontrole úhrady',
  pg_temp.stav(:'f_u1') = 'Ke kontrole úhrady' and pg_temp.stav(:'f_u3') = 'Ke kontrole úhrady'
  and pg_temp.stav(:'f_u4') = 'Ke kontrole úhrady');

-- Soupeř faktura: odmítnutá archivovaná se stejným VS a částkou; nepřečtená částka.
select pg_temp.faktura(:'firma', 'K112-S1', '11206', 112600, 'CZK', '19-2000145399/0800') as f_s1 \gset
select pg_temp.faktura(:'firma', 'K112-S1B', '11206', 112600, 'CZK', '19-2000145399/0800', 'Odmítnuto') as f_s1b \gset
update public.faktury set archivovano = true where id = :'f_s1b';
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112600, '11206') as t_s1 \gset
select pg_temp.faktura(:'firma', 'K112-S2', '11207', 112700, 'CZK', '19-2000145399/0800') as f_s2 \gset
select pg_temp.faktura(:'firma', 'K112-S2B', '11207', 0, 'CZK', null, 'Nutná ruční kontrola (chybí částka)') as f_s2b \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112700, '11207') as t_s2 \gset

select pg_temp.shoda('jistá shoda: soupeř je odmítnutá archivovaná faktura se stejným VS a částkou → souper_faktura',
  :'firma', :'t_s1', :'f_s1', 'souper_faktura');
select pg_temp.shoda('jistá shoda: soupeř je faktura se stejným VS a nepřečtenou částkou → souper_faktura',
  :'firma', :'t_s2', :'f_s2', 'souper_faktura');
select pg_temp.automatika(:'firma', :'t_s1', :'f_s1', 112600) as v \gset
select pg_temp.check('automatika: soupeř mezi vyřízenými → nespáruje — naměřeno: ' || :'v', :'v' = 'ne');

-- Soupeř platba: dva výdaje se stejným VS a částkou.
select pg_temp.faktura(:'firma', 'K112-P1', '11208', 112800, 'CZK', '19-2000145399/0800') as f_p1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112800, '11208') as t_p1a \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112800, '11208') as t_p1b \gset
select pg_temp.shoda('jistá shoda: dvě platby se stejným VS a částkou → souper_platba', :'firma', :'t_p1a', :'f_p1', 'souper_platba');
select pg_temp.automatika(:'firma', :'t_p1a', :'f_p1', 112800) || '/' || pg_temp.automatika(:'firma', :'t_p1b', :'f_p1', 112800) as v \gset
select pg_temp.check('automatika: ani jedna ze dvou stejných plateb se nespáruje — naměřeno: ' || :'v', :'v' = 'ne/ne');

-- Měna: prázdná na faktuře, prázdná na pohybu, jiná.
select pg_temp.faktura(:'firma', 'K112-M1', '11209', 112900, '', '19-2000145399/0800') as f_m1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 112900, '11209') as t_m1 \gset
select pg_temp.faktura(:'firma', 'K112-M2', '11210', 113000, 'CZK', '19-2000145399/0800') as f_m2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 113000, '11210', '19-2000145399/0800', 'banka_api', '') as t_m2 \gset
select pg_temp.faktura(:'firma', 'K112-E1', '11211', 50000, 'EUR', '19-2000145399/0800') as f_e1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 50000, '11211') as t_e1 \gset
select pg_temp.shoda('jistá shoda: faktura bez měny → mena_prazdna', :'firma', :'t_m1', :'f_m1', 'mena_prazdna');
select pg_temp.shoda('jistá shoda: pohyb bez měny → mena_prazdna', :'firma', :'t_m2', :'f_m2', 'mena_prazdna');
select pg_temp.shoda('jistá shoda: faktura v EUR, platba v Kč → mena', :'firma', :'t_e1', :'f_e1', 'mena');
select pg_temp.automatika(:'firma', :'t_m1', :'f_m1', 112900) || '/' || pg_temp.automatika(:'firma', :'t_e1', :'f_e1', 50000) as v \gset
select pg_temp.check('automatika: prázdná ani jiná měna se nespáruje — naměřeno: ' || :'v', :'v' = 'ne/ne');

-- Storno, směr, okno, vrácená platba.
select pg_temp.faktura(:'firma', 'K112-ST1', '11212', 113200, 'CZK', '19-2000145399/0800') as f_st1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 113200, '11212') as t_st1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'prijem', 113200, '11212', '19-2000145399/0800', 'banka_api', 'CZK', :'t_st1') as t_st1s \gset
select pg_temp.shoda('jistá shoda: stornovaný pohyb → storno', :'firma', :'t_st1', :'f_st1', 'storno');
select pg_temp.shoda('jistá shoda: příjem (storno) k přijaté faktuře → smer', :'firma', :'t_st1s', :'f_st1', 'smer');
select pg_temp.automatika(:'firma', :'t_st1', :'f_st1', 113200) as v \gset
select pg_temp.check('automatika: stornovaný pohyb nespáruje — naměřeno: ' || :'v', :'v' = 'ne');

select pg_temp.faktura(:'firma', 'K112-OK', '11218', 113800, 'CZK', '19-2000145399/0800', 'Ke kontrole úhrady',
                       'Dodavatel 112 s.r.o.', null, current_date - 200) as f_ok \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 113800, '11218') as t_ok \gset
select pg_temp.shoda('jistá shoda: platba víc než 90 dní po faktuře → okno', :'firma', :'t_ok', :'f_ok', 'okno');

select pg_temp.faktura(:'firma', 'K112-VC', '11219', 113900, 'CZK', '19-2000145399/0800') as f_vc \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 113900, '11219') as t_vc \gset
select pg_temp.pohyb(:'firma', :'ucet', 'prijem', 113900, '11219', '19-2000145399/0800', 'banka_api', 'CZK', null, current_date - 1) as t_vcp \gset
select pg_temp.shoda('jistá shoda: platba se vrátila (příjem se stejným VS) → vracena', :'firma', :'t_vc', :'f_vc', 'vracena');

-- Řádek výpisu potvrzený bankou → jistá; nepotvrzený (úloha) → ne.
select pg_temp.faktura(:'firma', 'K112-C1', '11213', 113300, 'CZK', '19-2000145399/0800') as f_c1 \gset
select pg_temp.nahrat(:'firma', :'ucet', 'csv_banka', 'k112-c1-vypis',
                      jsonb_build_array(pg_temp.radek('vydaj', 113300, '11213'))) is not null as v \gset
select coalesce((select id::text from public.transakce
                  where ucet_id = :'ucet' and zdroj = 'csv_banka' and vs = '11213'), 'žádný') as t_c1 \gset
select pg_temp.nahrat(:'firma', :'ucet', 'banka_api', 'k112-c1-stazeni',
                      jsonb_build_array(pg_temp.radek('vydaj', 113300, '11213', '19-2000145399/0800', 'k112-c1'))) is not null as v2 \gset
select pg_temp.check('výpis potvrzený bankou: řádek výpisu jednou, potvrzení z banky ho drží',
  :'v' and :'v2'
  and (select count(*) from public.transakce where ucet_id = :'ucet' and vs = '11213') = 1
  and exists (select 1 from public.transakce_potvrzeni_banky where transakce_id::text = :'t_c1' and externi_id = 'k112-c1'));
select pg_temp.shoda('jistá shoda: řádek výpisu potvrzený bankou → jistá', :'firma', :'t_c1', :'f_c1', 'jistá');
select pg_temp.automatika(:'firma', :'t_c1', :'f_c1', 113300) as v \gset
select pg_temp.check('automatika: řádek výpisu potvrzený bankou spáruje — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_c1'),
  :'v' = 'ano' and pg_temp.stav(:'f_c1') = 'Uhrazeno');

select pg_temp.faktura(:'firma', 'K112-C2', '11214', 113400, 'CZK', '19-2000145399/0800') as f_c2 \gset
select pg_temp.nahrat(:'firma', :'ucet', 'csv_banka', 'k112-c2-vypis',
                      jsonb_build_array(pg_temp.radek('vydaj', 113400, '11214'))) as davka_c2 \gset
select coalesce((select id::text from public.transakce
                  where ucet_id = :'ucet' and zdroj = 'csv_banka' and vs = '11214'), 'žádný') as t_c2 \gset
select pg_temp.shoda('jistá shoda: nepotvrzený řádek výpisu pro úlohu → zdroj', :'firma', :'t_c2', :'f_c2', 'zdroj');
select pg_temp.automatika(:'firma', :'t_c2', :'f_c2', 113400) as v \gset
select pg_temp.check('automatika: nepotvrzený výpis úloha nespáruje — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_c2'),
  :'v' = 'ne' and pg_temp.stav(:'f_c2') = 'Ke kontrole úhrady');

-- Dávka nahraná člověkem: Filip (bez práva potvrzovat) → nic; Marie → ano.
select pg_temp.faktura(:'firma', 'K112-F1', '11215', 113500, 'CZK', '19-2000145399/0800') as f_f \gset
select pg_temp.faktura(:'firma', 'K112-MM', '11216', 113600, 'CZK', '19-2000145399/0800') as f_mm \gset

set role authenticated;
select set_config('test.user_id', :'fin', false);
select coalesce(pg_temp.nahrat(:'firma', :'ucet', 'csv_banka', 'k112-f-vypis',
                               jsonb_build_array(pg_temp.radek('vydaj', 113500, '11215')))::text, 'žádná') as davka_f \gset
select pg_temp.hodnota(format('select public.sparovat_jiste_z_davky(%L, %L)', :'firma', :'davka_f')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('dávka finance bez Faktur: jistá shoda z ní nic nespáruje — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_f'),
  :'v' = '0' and pg_temp.stav(:'f_f') = 'Ke kontrole úhrady');
select pg_temp.check('dávka: kdo ji nahrál, zapsala databáze (Filip)',
  (select nahral from public.import_davky where id::text = :'davka_f') = :'fin');
-- Posouzení přímo (jako by Filip ručil za svou dávku): bez práva
-- potvrzovat párování mu dávka nestačí.
select set_config('test.user_id', :'fin', false);
select pg_temp.kod_shody(:'firma', (select id from public.transakce where import_davka_id::text = :'davka_f'), :'f_f',
                         :'davka_f'::uuid) as v \gset
select set_config('test.user_id', '', false);
select pg_temp.check('jistá shoda z dávky: kdo nemá právo potvrzovat párování, tomu dávka nestačí → zdroj — naměřeno: ' || :'v',
  :'v' = 'zdroj');
-- … a majitelce (právo má) nestačí dávka, kterou nahrál někdo jiný. Přímo
-- posouzení: sparovat_jiste_z_davky hlídá autora dávky ještě jednou sama,
-- takže kontrola níž (přes ni) by chybu v posouzení nepoznala.
select set_config('test.user_id', :'maj', false);
select pg_temp.kod_shody(:'firma', (select id from public.transakce where import_davka_id::text = :'davka_f'), :'f_f',
                         :'davka_f'::uuid) as v \gset
select set_config('test.user_id', '', false);
select pg_temp.check('jistá shoda z dávky: cizí dávka nestačí ani s právem potvrzovat → zdroj — naměřeno: ' || :'v',
  :'v' = 'zdroj');

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format('select public.sparovat_jiste_z_davky(%L, %L)', :'firma', :'davka_f')) as v \gset
select pg_temp.check('dávka jiného člověka: majitelka z ní nic nespáruje — naměřeno: ' || :'v', :'v' = '0');
select coalesce(pg_temp.nahrat(:'firma', :'ucet', 'csv_banka', 'k112-m-vypis',
                               jsonb_build_array(pg_temp.radek('vydaj', 113600, '11216')))::text, 'žádná') as davka_m \gset
select pg_temp.hodnota(format('select public.sparovat_jiste_z_davky(%L, %L)', :'firma', :'davka_m')) as v \gset
select pg_temp.hodnota(format('select public.sparovat_jiste_z_davky(%L, %L)', :'firma', :'davka_m')) as v2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('vlastní dávka s právem potvrzovat: jistá shoda spárována, podruhé nic — naměřeno: '
    || :'v' || ' / ' || :'v2' || ' / ' || pg_temp.stav(:'f_mm'),
  :'v' = '1' and :'v2' = '0' and pg_temp.stav(:'f_mm') = 'Uhrazeno');
select pg_temp.check('dávka finance bez Faktur: úloha ji jistě nespáruje ani potom',
  pg_temp.automatika(:'firma', (select id from public.transakce where import_davka_id::text = :'davka_f'), :'f_f', 113500) = 'ne'
  and pg_temp.stav(:'f_f') = 'Ke kontrole úhrady');

-- „nahral" si přihlášený nevybírá.
set role authenticated;
select set_config('test.user_id', :'fin', false);
select pg_temp.projde(format(
  $s$insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, pocet_radku, stav, nahral)
     values (%L, 'banka_csv', 'podvrh.csv', 'k112-podvrh', 0, 'zpracovano', %L)$s$, :'firma', :'maj')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('dávka: přihlášený si „nahral" nevybere — zapíše se on sám',
  :'v' and (select nahral from public.import_davky where tenant_id = :'firma' and soubor_hash = 'k112-podvrh') = :'fin');


\echo ''
\echo '== 3. Zkouška 3: dělení a součty ========================================'

-- Jedna platba na dvě faktury, nic přes částku platby.
select pg_temp.faktura(:'firma', 'K112-A1', '11301', 30000) as f_a1 \gset
select pg_temp.faktura(:'firma', 'K112-A2', '11302', 20000) as f_a2 \gset
select pg_temp.faktura(:'firma', 'K112-A3', '11303', 5000) as f_a3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 50000, '') as t_a \gset
-- Dvě platby na jednu fakturu (na haléř).
select pg_temp.faktura(:'firma', 'K112-B1', '11304', 100001) as f_b \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 60000, '') as t_b1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 40001, '') as t_b2 \gset
-- Zčásti zaplacená a automatika.
select pg_temp.faktura(:'firma', 'K112-B2', '11305', 70000, 'CZK', '19-2000145399/0800') as f_b2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 30000, '') as t_b3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 40000, '11305') as t_b4 \gset
-- Přeplatek, EUR/EUR, jiná měna, prázdná měna = CZK.
select pg_temp.faktura(:'firma', 'K112-O1', '11306', 10000) as f_o \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 12000, '') as t_o \gset
select pg_temp.faktura(:'firma', 'K112-E2', '11307', 4000, 'EUR') as f_e2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 4000, '', '19-2000145399/0800', 'banka_api', 'EUR') as t_e2 \gset
select pg_temp.faktura(:'firma', 'K112-E3', '11308', 5000, 'EUR') as f_e3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 5000, '') as t_e3 \gset
select pg_temp.faktura(:'firma', 'K112-M3', '11309', 3000, '') as f_m3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 3000, '') as t_m3 \gset

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.sparuj(:'firma', :'t_a', :'f_a1', 30000) as v1 \gset
select pg_temp.sparuj(:'firma', :'t_a', :'f_a2', 20000) as v2 \gset
select pg_temp.check('jedna platba na dvě faktury: obě Uhrazeno — naměřeno: ' || :'v1' || ' | ' || :'v2',
  :'v1' = 'Uhrazeno;30000;true;0' and :'v2' = 'Uhrazeno;20000;true;0');
select pg_temp.check('jedna platba: třetí alokace přes částku platby (o 1 haléř) se odmítne',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1, null)', :'firma', :'t_a', :'f_a3'),
                         '23514', 'přesahuje částku platby'));

select pg_temp.sparuj(:'firma', :'t_b1', :'f_b', 60000) as v1 \gset
select pg_temp.sparuj(:'firma', :'t_b2', :'f_b', 40001) as v2 \gset
select pg_temp.check('dvě platby na jednu fakturu na haléř: Částečně, pak Uhrazeno bez přebytku — naměřeno: ' || :'v1' || ' | ' || :'v2',
  :'v1' = 'Částečně uhrazeno;60000;false;0' and :'v2' = 'Uhrazeno;100001;true;0');

select pg_temp.sparuj(:'firma', :'t_b3', :'f_b2', 30000) as v \gset
select pg_temp.check('zčásti zaplacená: Částečně uhrazeno — naměřeno: ' || :'v', :'v' = 'Částečně uhrazeno;30000;false;0');

select pg_temp.sparuj(:'firma', :'t_o', :'f_o', 12000) as v \gset
select pg_temp.check('přeplatek faktury: Uhrazeno s přebytkem 2 000 — naměřeno: ' || :'v', :'v' = 'Uhrazeno;12000;true;2000');

select pg_temp.sparuj(:'firma', :'t_e2', :'f_e2', 4000) as v \gset
select pg_temp.check('EUR faktura a EUR platba: Uhrazeno — naměřeno: ' || :'v', :'v' = 'Uhrazeno;4000;true;0');
select pg_temp.check('EUR faktura a platba v Kč: ruční párování odmítnuto',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 5000, null)', :'firma', :'t_e3', :'f_e3'),
                         '23514', 'jiné měně'));
select pg_temp.sparuj(:'firma', :'t_m3', :'f_m3', 3000) as v \gset
select pg_temp.check('faktura bez měny se platbou v Kč spáruje jako CZK — naměřeno: ' || :'v', :'v' = 'Uhrazeno;3000;true;0');
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('jedna platba: součet potvrzených alokací = částka platby (50 000)',
  (select sum(castka_haleru) from public.platby_faktury where transakce_id = :'t_a' and stav = 'potvrzeno') = 50000);
select pg_temp.check('přeplatek: v auditu příznak přeplatku a přebytek',
  exists (select 1 from public.audit_log where tenant_id = :'firma' and action = 'finance.platba_alokovana'
            and entity_id = :'f_o' and (after ->> 'preplatek')::boolean and (after ->> 'prebytek_haleru')::bigint = 2000));
select pg_temp.shoda('automatika: zčásti zaplacená faktura → stav', :'firma', :'t_b4', :'f_b2', 'stav');
select pg_temp.automatika(:'firma', :'t_b4', :'f_b2', 40000) as v \gset
select pg_temp.check('automatika: zčásti zaplacenou fakturu nedoplatí — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_b2'),
  :'v' = 'ne' and pg_temp.stav(:'f_b2') = 'Částečně uhrazeno');
select pg_temp.check('EUR/EUR: faktura Uhrazeno; EUR a Kč: nic nezapsáno, Ke kontrole úhrady',
  pg_temp.stav(:'f_e2') = 'Uhrazeno' and pg_temp.stav(:'f_e3') = 'Ke kontrole úhrady'
  and not exists (select 1 from public.platby_faktury where transakce_id = :'t_e3'));

-- Návrh jen do zbytku faktury a do zbytku platby.
select pg_temp.faktura(:'firma', 'K112-N1', '11311', 50000) as f_n \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 30000, '') as t_n1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 45000, '11311') as t_n2 \gset
select pg_temp.faktura(:'firma', 'K112-N2', '11312', 90000) as f_n2 \gset
select pg_temp.faktura(:'firma', 'K112-N3', '11313', 15000) as f_n3 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 25000, '') as t_n3 \gset

set role authenticated;
select set_config('test.user_id', :'maj', false);
select split_part(pg_temp.sparuj(:'firma', :'t_n1', :'f_n', 30000), ';', 1) || '/'
    || split_part(pg_temp.sparuj(:'firma', :'t_n3', :'f_n3', 15000), ';', 1) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('návrhy, příprava: N1 zčásti (30 000 z 50 000), platba N3 z 15 000 vyčerpaná — naměřeno: ' || :'v',
  :'v' = 'Částečně uhrazeno/Uhrazeno');

select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_n2', 'faktura', :'f_n', 'castka_haleru', 45000,
                                       'duvod', 'vs+castka', 'jistota', 0.8)))) as v \gset
select pg_temp.check('návrh nad zbytek faktury se zkrátí na zbytek (20 000) — naměřeno: ' || :'v' || ' / '
    || coalesce((select string_agg(castka_haleru::text, ',') from public.platby_faktury
                  where transakce_id = :'t_n2' and faktura = :'f_n' and stav = 'navrzeno'), 'nic'),
  :'v' = '1'
  and (select castka_haleru from public.platby_faktury where transakce_id = :'t_n2' and faktura = :'f_n' and stav = 'navrzeno') = 20000);
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_n3', 'faktura', :'f_n2', 'castka_haleru', 25000,
                                       'duvod', 'castka+dodavatel+okno', 'jistota', 0.6)))) as v \gset
select pg_temp.check('návrh nad zbytek platby se zkrátí na zbytek platby (10 000) — naměřeno: ' || :'v' || ' / '
    || coalesce((select string_agg(castka_haleru::text, ',') from public.platby_faktury
                  where transakce_id = :'t_n3' and faktura = :'f_n2' and stav = 'navrzeno'), 'nic'),
  :'v' = '1'
  and (select castka_haleru from public.platby_faktury where transakce_id = :'t_n3' and faktura = :'f_n2' and stav = 'navrzeno') = 10000);
select pg_temp.check('návrh: kód důvodu a jistota uložené, stav faktury návrh nezmění',
  exists (select 1 from public.platby_faktury where transakce_id = :'t_n2' and faktura = :'f_n'
            and duvod = 'vs+castka' and jistota = 0.8 and zpusob = 'automaticky')
  and pg_temp.stav(:'f_n2') = 'Ke kontrole úhrady');


\echo ''
\echo '== 4. Zkouška 4: stav, ruční úhrada, dobropis, storno ===================='

-- Zrušení párování vrátí původní stav (ruční párování).
select pg_temp.faktura(:'firma', 'K112-R1', '11401', 20000, 'CZK', null, 'Neuhrazeno') as f_r \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 20000, '') as t_r \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.sparuj(:'firma', :'t_r', :'f_r', 20000) as v \gset
reset role;
select set_config('test.user_id', '', false);
select id as al_r from public.platby_faktury where transakce_id = :'t_r' and faktura = :'f_r' and stav = 'potvrzeno' \gset
select pg_temp.check('párování z Neuhrazeno: Uhrazeno a stav před úhradou Neuhrazeno — naměřeno: ' || :'v',
  :'v' = 'Uhrazeno;20000;true;0' and (select stav_pred_uhradou from public.faktury where id = :'f_r') = 'Neuhrazeno');
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format($s$select public.zrusit_parovani_faktury(%L, %L, 'Omyl při párování')$s$, :'firma', :'al_r')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušení ručního párování vrátí Neuhrazeno (ne Ke kontrole úhrady) — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_r'),
  :'v' = 'Neuhrazeno' and pg_temp.stav(:'f_r') = 'Neuhrazeno'
  and (select stav_pred_uhradou from public.faktury where id = :'f_r') is null);

-- Zrušení jedné ze dvou plateb: zpět na Částečně.
select id as al_b2 from public.platby_faktury where transakce_id = :'t_b2' and faktura = :'f_b' and stav = 'potvrzeno' \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format($s$select public.zrusit_parovani_faktury(%L, %L, 'Druhá platba patří jinam')$s$, :'firma', :'al_b2')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušení jedné ze dvou plateb: Částečně uhrazeno — naměřeno: ' || :'v', :'v' = 'Částečně uhrazeno');

-- Zrušení automatického párování (úloha / „Vrátit" ve Fakturách).
select pg_temp.hodnota(format($s$select public.zrusit_automaticke_parovani_faktury(%L, %L, 'Zkouška zrušení')$s$, :'firma', :'al_j1')) as v \gset
select pg_temp.check('zrušení automatického párování vrátí Ke kontrole úhrady — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_j1'),
  :'v' = 'true' and pg_temp.stav(:'f_j1') = 'Ke kontrole úhrady');
select pg_temp.shoda('automatika: zrušenou dvojici znovu nespáruje → zamitnuto', :'firma', :'t_j1', :'f_j1', 'zamitnuto');

-- Ruční úhrada: důvod povinný, právo, zrušení s důvodem.
select pg_temp.faktura(:'firma', 'K112-RU1', '11402', 30000, 'CZK', null, 'Neuhrazeno') as f_ru \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('ruční úhrada bez důvodu se odmítne',
  pg_temp.spadne_hlaskou(format('select public.rucne_uhradit_fakturu(%L, %L, 30000, null)', :'firma', :'f_ru'),
                         '23514', 'Napište důvod ruční úhrady'));
select pg_temp.check('ruční úhrada s důvodem kratším než 5 znaků se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.rucne_uhradit_fakturu(%L, %L, 30000, ' abc ')$s$, :'firma', :'f_ru'),
                         '23514', 'Napište důvod ruční úhrady'));
select set_config('test.user_id', :'fin', false);
select pg_temp.check('ruční úhrada: finance bez správy Faktur nesmí',
  pg_temp.spadne_hlaskou(format($s$select public.rucne_uhradit_fakturu(%L, %L, 30000, 'Zaplaceno hotově')$s$, :'firma', :'f_ru'),
                         '42501', 'spravuje přijaté faktury'));
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format($s$select public.rucne_uhradit_fakturu(%L, %L, 30000, 'Zaplaceno hotově na pokladně')$s$, :'firma', :'f_ru')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('ruční úhrada s důvodem: Uhrazeno, autor a důvod zapsané — naměřeno: ' || :'v',
  :'v' = 'Uhrazeno' and pg_temp.stav(:'f_ru') = 'Uhrazeno'
  and exists (select 1 from public.faktury_rucni_uhrady where faktura = :'f_ru' and zapsal = :'maj'
                and duvod = 'Zaplaceno hotově na pokladně' and castka_haleru = 30000 and zruseno_kdy is null));
select id as u_ru from public.faktury_rucni_uhrady where faktura = :'f_ru' \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('zrušení ruční úhrady bez důvodu se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_rucni_uhradu(%L, %L, 'x')$s$, :'firma', :'u_ru'),
                         '23514', 'Napište důvod zrušení'));
select pg_temp.hodnota(format($s$select public.zrusit_rucni_uhradu(%L, %L, 'Omyl, nezaplaceno')$s$, :'firma', :'u_ru')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušení ruční úhrady vrátí Neuhrazeno, zůstane záznam se zrušením — naměřeno: ' || :'v',
  :'v' = 'Neuhrazeno' and pg_temp.stav(:'f_ru') = 'Neuhrazeno'
  and exists (select 1 from public.faktury_rucni_uhrady where id = :'u_ru' and zruseno_kdy is not null
                and zrusil = :'maj' and duvod_zruseni = 'Omyl, nezaplaceno'));

-- Spoušť: přihlášený „Uhrazeno" přímo nezapíše ani nezruší.
select pg_temp.faktura(:'firma', 'K112-RU2', '11403', 30000) as f_ru2 \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('přímý zápis: přihlášený nezaloží fakturu jako Uhrazeno',
  pg_temp.spadne_hlaskou(format($s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, stav)
                                    values (%L, 'Podvrh s.r.o.', 'K112-G0', 1000, 'Uhrazeno')$s$, :'firma'),
                         '42501', 'Fakturu nejde založit'));
select pg_temp.check('přímý zápis: přihlášený nezaloží fakturu jako Částečně uhrazeno',
  pg_temp.spadne_hlaskou(format($s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, stav)
                                    values (%L, 'Podvrh s.r.o.', 'K112-G00', 1000, 'Částečně uhrazeno')$s$, :'firma'),
                         '42501', 'Fakturu nejde založit'));
select pg_temp.check('přímý zápis: přihlášený nepřepne stav na Uhrazeno',
  pg_temp.spadne_hlaskou(format($s$update public.faktury set stav = 'Uhrazeno' where id = %L$s$, :'f_ru2'),
                         '42501', 'mění jen párování'));
select pg_temp.check('přímý zápis: přihlášený nevrátí zaplacenou fakturu na Neuhrazeno',
  pg_temp.spadne_hlaskou(format($s$update public.faktury set stav = 'Neuhrazeno' where id = %L$s$, :'f_a1'),
                         '42501', 'mění jen párování'));
select pg_temp.projde(format(
  $s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, stav, stav_pred_uhradou)
     values (%L, 'Podvrh s.r.o.', 'K112-G1', 1000, 'Ke kontrole úhrady', 'Neuhrazeno')$s$, :'firma')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('přímý zápis: stav před úhradou se při založení vynuluje',
  :'v' and (select stav_pred_uhradou from public.faktury where tenant_id = :'firma' and cislo_faktury = 'K112-G1') is null);
-- Služba stav mění (opravy, převod); stav před úhradou drží spoušť.
select pg_temp.check('služba: stav zčásti zaplacené faktury jde změnit (Neuhrazeno)',
  pg_temp.projde(format($s$update public.faktury set stav = 'Neuhrazeno' where id = %L$s$, :'f_b2')));
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('přímý zápis: faktura se spárovanou platbou nepřepne stav ani mimo zaplacené',
  pg_temp.spadne_hlaskou(format($s$update public.faktury set stav = 'Odmítnuto' where id = %L$s$, :'f_b2'),
                         '42501', 'spárovanou platbu'));
reset role;
select set_config('test.user_id', '', false);
set role service_role;
select pg_temp.check('služba: fakturu jako Uhrazeno založit smí a přepnout zpět taky',
  pg_temp.projde(format($s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, stav)
                           values (%L, 'Služba s.r.o.', 'K112-SL1', 1000, 'Uhrazeno')$s$, :'firma'))
  and pg_temp.projde(format($s$update public.faktury set stav = 'Neuhrazeno' where tenant_id = %L and cislo_faktury = 'K112-SL1'$s$, :'firma')));
reset role;
select pg_temp.check('služba: přepnutí z Uhrazeno ruční stav před úhradou nevymyslí',
  (select stav from public.faktury where tenant_id = :'firma' and cislo_faktury = 'K112-SL1') = 'Neuhrazeno'
  and (select stav_pred_uhradou from public.faktury where tenant_id = :'firma' and cislo_faktury = 'K112-SL1') is null);

-- Párovat jen schválenou: neschválená, duplicita, upomínka, ruční kontrola, odmítnutá, archiv.
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 1000, '') as t_x \gset
select pg_temp.faktura(:'firma', 'K112-KS', null, 1000, 'CZK', null, 'Ke schválení') as f_ks \gset
select pg_temp.faktura(:'firma', 'K112-DUP', null, 1000) as f_dup1 \gset
select pg_temp.faktura(:'firma', 'K112-DUP', null, 1000) as f_dup \gset
select pg_temp.faktura(:'firma', 'K112-UPO', null, 1000, 'CZK', null, 'Upomínka - zkontrolovat') as f_upo \gset
select pg_temp.faktura(:'firma', 'K112-NRK', null, 1000, 'CZK', null, 'Nutná ruční kontrola (chybí VS)') as f_nrk \gset
select pg_temp.faktura(:'firma', 'K112-ODM', null, 1000, 'CZK', null, 'Odmítnuto') as f_odm \gset
select pg_temp.faktura(:'firma', 'K112-ARC', null, 1000) as f_arc \gset
update public.faktury set archivovano = true where id = :'f_arc';
select pg_temp.check('příprava: druhá faktura se stejným číslem je duplicita',
  (select duplicita from public.faktury where id = :'f_dup'));
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('párování: neschválená, duplicitní, upomínka, ruční kontrola, odmítnutá ani archivovaná ne',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_ks'), '23514', 'schválenou k úhradě')
  and pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_dup'), '23514', 'schválenou k úhradě')
  and pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_upo'), '23514', 'schválenou k úhradě')
  and pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_nrk'), '23514', 'schválenou k úhradě')
  and pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_odm'), '23514', 'schválenou k úhradě')
  and pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_arc'), '23514', 'schválenou k úhradě'));
select pg_temp.check('ruční úhrada upomínky se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.rucne_uhradit_fakturu(%L, %L, 1000, 'Zaplaceno předem')$s$, :'firma', :'f_upo'),
                         '23514', 'schválenou k úhradě'));
select set_config('test.user_id', :'fin', false);
select pg_temp.check('párování: finance bez Faktur nesmí',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_u1'),
                         '42501', 'Vidět přijaté faktury'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('párování neschválených: k platbě nic nezapsáno, stavy beze změny',
  not exists (select 1 from public.platby_faktury where transakce_id = :'t_x')
  and pg_temp.stav(:'f_upo') = 'Upomínka - zkontrolovat' and pg_temp.stav(:'f_ks') = 'Ke schválení');

-- Jiná měna: návrh 'jina_mena', potvrzení jen ruční úhradou.
select pg_temp.faktura(:'firma', 'K112-JM', '11416', 2000, 'EUR') as f_jm \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 50000, '11416') as t_jm \gset
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_jm', 'faktura', :'f_jm', 'castka_haleru', 50000,
                                       'duvod', 'vs+castka', 'jistota', 0.5)))) as v1 \gset
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_jm', 'faktura', :'f_jm', 'castka_haleru', 50000,
                                       'duvod', 'jina_mena', 'jistota', 0.5)))) as v2 \gset
select pg_temp.check('jiná měna: návrh jen s důvodem jina_mena — naměřeno: ' || :'v1' || ' / ' || :'v2',
  :'v1' = '0' and :'v2' = '1');
select id as n_jm from public.platby_faktury where transakce_id = :'t_jm' and faktura = :'f_jm' and stav = 'navrzeno' \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.potvrd(:'firma', :'n_jm') as v \gset
select pg_temp.check('jiná měna: potvrzení návrhu párováním se odmítne — naměřeno: ' || :'v',
  :'v' like 'chyba 23514:%potvrďte ji jako ruční úhradu%');
select pg_temp.check('ruční úhrada k platbě ve stejné měně se odmítne (spárovat)',
  pg_temp.spadne_hlaskou(format($s$select public.rucne_uhradit_fakturu(%L, %L, 1000, 'Platba v korunách', %L)$s$, :'firma', :'f_u1', :'t_x'),
                         '23514', 've stejné měně'));
select pg_temp.hodnota(format($s$select public.rucne_uhradit_fakturu(%L, %L, 2000, 'Platba v Kč kurzem banky', %L)$s$, :'firma', :'f_jm', :'t_jm')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('jiná měna: ruční úhrada v EUR k platbě v Kč → Uhrazeno, návrh vyřízený — naměřeno: ' || :'v',
  :'v' = 'Uhrazeno'
  and exists (select 1 from public.faktury_rucni_uhrady where faktura = :'f_jm' and transakce_id = :'t_jm'
                and ucet_id = :'ucet' and castka_haleru = 2000 and zapsal = :'maj')
  and (select stav from public.platby_faktury where id = :'n_jm') = 'zamitnuto');
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_jm', 'faktura', :'f_e3', 'castka_haleru', 5000,
                                       'duvod', 'jina_mena', 'jistota', 0.5)))) as v \gset
select pg_temp.check('návrh k platbě vyřízené ruční úhradou se nezapíše — naměřeno: ' || :'v', :'v' = '0');

-- Dobropis: vratka (příjem) a započtení proti faktuře téhož dodavatele.
select pg_temp.faktura(:'firma', 'K112-DBR', '11404', -15000) as f_dbr \gset
select pg_temp.pohyb(:'firma', :'ucet', 'prijem', 15000, '') as t_vr \gset
select pg_temp.faktura(:'firma', 'K112-D2', '11405', -5000, 'CZK', null, 'Ke kontrole úhrady', 'Dodavatel Z s.r.o.', '27082440') as f_d2 \gset
select pg_temp.faktura(:'firma', 'K112-Z', '11406', 20000, 'CZK', null, 'Ke kontrole úhrady', 'DODAVATEL Z, s.r.o.', null) as f_z \gset
select pg_temp.faktura(:'firma', 'K112-D3', '11407', -3000, 'CZK', null, 'Ke kontrole úhrady', 'Jiný dodavatel a.s.', '11111111') as f_d3 \gset
select pg_temp.faktura(:'firma', 'K112-D5', '11408', -2000, 'CZK', null, 'Ke kontrole úhrady', 'Beta Servis s.r.o.', '45317055') as f_d5 \gset
select pg_temp.faktura(:'firma', 'K112-Z5', '11409', 9000, 'CZK', null, 'Ke kontrole úhrady', 'Gama Servis s.r.o.', '45317055') as f_z5 \gset
select pg_temp.faktura(:'firma', 'K112-D6', '11410', -1000, 'CZK', null, 'Ke kontrole úhrady', '', '21249946') as f_d6 \gset
select pg_temp.faktura(:'firma', 'K112-Z6', '11411', 4000, 'CZK', null, 'Ke kontrole úhrady', 'Epsilon s.r.o.', '21249946') as f_z6 \gset
select pg_temp.faktura(:'firma', 'K112-D7', '11412', -1500, 'CZK', null, 'Ke kontrole úhrady', '', '45317054') as f_d7 \gset
select pg_temp.faktura(:'firma', 'K112-Z7', '11413', 8000, 'CZK', null, 'Ke kontrole úhrady', 'Delta Obchod s.r.o.', '45317054') as f_z7 \gset

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('dobropis: s odchozí platbou se nespáruje',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1000, null)', :'firma', :'t_x', :'f_dbr'),
                         '23514', 'jen s příchozí platbou'));
select pg_temp.check('přijatá faktura: s příchozí platbou se nespáruje',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)', :'firma', :'t_vr', :'f_u1'),
                         '23514', 'jen odchozí platbu'));
select pg_temp.sparuj(:'firma', :'t_vr', :'f_dbr', 15000) as v \gset
select pg_temp.check('dobropis + vratka od dodavatele: Uhrazeno — naměřeno: ' || :'v', :'v' = 'Uhrazeno;15000;true;0');

select pg_temp.check('započtení bez důvodu se odmítne',
  pg_temp.spadne_hlaskou(format('select public.zapocitat_dobropis(%L, %L, %L, 5000, null)', :'firma', :'f_d2', :'f_z'),
                         '23514', 'Napište důvod započtení'));
select pg_temp.check('započtení víc, než na dobropisu zbývá, se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.zapocitat_dobropis(%L, %L, %L, 6000, 'Započet dobropisu')$s$, :'firma', :'f_d2', :'f_z'),
                         '23514', 'nejvýš částku'));
select pg_temp.check('započtení: jiný dodavatel (jméno ani IČO) ne',
  pg_temp.spadne_hlaskou(format($s$select public.zapocitat_dobropis(%L, %L, %L, 3000, 'Započet dobropisu')$s$, :'firma', :'f_d3', :'f_z'),
                         '23514', 'nejsou od téhož dodavatele'));
select pg_temp.check('započtení: sporné IČO (pod ním dvě různá jména) ne',
  pg_temp.spadne_hlaskou(format($s$select public.zapocitat_dobropis(%L, %L, %L, 2000, 'Započet dobropisu')$s$, :'firma', :'f_d5', :'f_z5'),
                         '23514', 'víc různých dodavatelů'));
select pg_temp.check('započtení: IČO vlastní firmy (tenants.ico) dodavatele nepozná',
  pg_temp.spadne_hlaskou(format($s$select public.zapocitat_dobropis(%L, %L, %L, 1000, 'Započet dobropisu')$s$, :'firma', :'f_d6', :'f_z6'),
                         '23514', 'IČO vaší firmy'));
select set_config('test.user_id', :'fin', false);
select pg_temp.check('započtení: finance bez správy Faktur nesmí',
  pg_temp.spadne_hlaskou(format($s$select public.zapocitat_dobropis(%L, %L, %L, 5000, 'Započet dobropisu')$s$, :'firma', :'f_d2', :'f_z'),
                         '42501', 'spravuje přijaté faktury'));
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format($s$select public.zapocitat_dobropis(%L, %L, %L, 5000, 'Započet dobropisu 5/2026')$s$, :'firma', :'f_d2', :'f_z')) as zapocet \gset
select pg_temp.hodnota(format($s$select public.zapocitat_dobropis(%L, %L, %L, 1500, 'Započet podle IČO')$s$, :'firma', :'f_d7', :'f_z7')) as zapocet7 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('započtení téhož dodavatele (jméno jinak zapsané): dobropis Uhrazeno, faktura Částečně, dva řádky — naměřeno: '
    || pg_temp.stav(:'f_d2') || ' / ' || pg_temp.stav(:'f_z'),
  pg_temp.stav(:'f_d2') = 'Uhrazeno' and pg_temp.stav(:'f_z') = 'Částečně uhrazeno'
  and (select count(*) from public.faktury_rucni_uhrady where zapocet_id::text = :'zapocet' and zruseno_kdy is null) = 2);
select pg_temp.check('započtení podle IČO (dobropis beze jména, IČO jen jednoho dodavatele) projde — naměřeno: ' || :'zapocet7',
  :'zapocet7' not like 'chyba%' and pg_temp.stav(:'f_d7') = 'Uhrazeno');

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('Vrátit mezi neuhrazené: fakturu se započteným dobropisem ne',
  pg_temp.spadne_hlaskou(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, 'Zkouška')$s$, :'firma', :'f_d2'),
                         '23514', 'započtený dobropis'));
select pg_temp.hodnota(format($s$select public.zrusit_rucni_uhradu(%L, (select id from public.faktury_rucni_uhrady where faktura = %L and zapocet_id is not null), 'Započteno omylem')$s$,
                              :'firma', :'f_d2')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušení započtení zruší oba řádky a vrátí oba stavy — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_z'),
  :'v' = 'Ke kontrole úhrady' and pg_temp.stav(:'f_d2') = 'Ke kontrole úhrady' and pg_temp.stav(:'f_z') = 'Ke kontrole úhrady'
  and not exists (select 1 from public.faktury_rucni_uhrady where zapocet_id::text = :'zapocet' and zruseno_kdy is null));

-- Storno z banky zruší párování a vrátí stav; otevřený návrh zamítne.
select pg_temp.faktura(:'firma', 'K112-SB', '11414', 40000, 'CZK', null, 'Neuhrazeno') as f_sb \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 40000, '') as t_sb \gset
select pg_temp.faktura(:'firma', 'K112-SB2', '11415', 41000) as f_sb2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 41000, '11415') as t_sb2 \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.sparuj(:'firma', :'t_sb', :'f_sb', 40000) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_sb2', 'faktura', :'f_sb2', 'castka_haleru', 41000,
                                       'duvod', 'vs+castka', 'jistota', 0.9)))) as v2 \gset
select pg_temp.check('storno, příprava: spárováno a návrh otevřený — naměřeno: ' || :'v' || ' / ' || :'v2',
  :'v' = 'Uhrazeno;40000;true;0' and :'v2' = '1');
select coalesce(pg_temp.pohyb(:'firma', :'ucet', 'prijem', 40000, '', '19-2000145399/0800', 'banka_api', 'CZK', :'t_sb')::text, 'žádný') as t_sbs \gset
select coalesce(pg_temp.pohyb(:'firma', :'ucet', 'prijem', 41000, '11415', '19-2000145399/0800', 'banka_api', 'CZK', :'t_sb2')::text, 'žádný') as t_sbs2 \gset
select pg_temp.check('storno z banky: párování zrušené, faktura zpět Neuhrazeno — naměřeno: ' || pg_temp.stav(:'f_sb'),
  :'t_sbs' <> 'žádný' and pg_temp.stav(:'f_sb') = 'Neuhrazeno'
  and not exists (select 1 from public.platby_faktury where transakce_id = :'t_sb' and stav = 'potvrzeno')
  and exists (select 1 from public.audit_log where tenant_id = :'firma' and action = 'finance.parovani_zruseno_stornem'
                and entity_id = :'f_sb'));
select pg_temp.check('storno z banky: otevřený návrh ke stornovanému pohybu zamítnut',
  (select stav from public.platby_faktury where transakce_id = :'t_sb2' and faktura = :'f_sb2') = 'zamitnuto');

select pg_temp.faktura(:'firma', 'K112-SR', '11417', 42000) as f_sr \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 42000, '') as t_sr \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.sparuj(:'firma', :'t_sr', :'f_sr', 42000) as v \gset
reset role;
select set_config('test.user_id', '', false);
select coalesce(pg_temp.pohyb(:'firma', :'ucet', 'prijem', 42000, '', '', 'rucni', 'CZK', :'t_sr')::text, 'žádný') as t_srs \gset
select pg_temp.check('ruční storno párování nezmění (jen se ukáže v Platbách) — naměřeno: ' || :'v' || ' / ' || pg_temp.stav(:'f_sr'),
  :'t_srs' <> 'žádný' and pg_temp.stav(:'f_sr') = 'Uhrazeno'
  and exists (select 1 from public.platby_faktury where transakce_id = :'t_sr' and stav = 'potvrzeno'));

select pg_temp.check('storno se stejným směrem se odmítne',
  pg_temp.spadne_hlaskou(format($s$insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
                                    values (%L, %L, 'vydaj', 1000, current_date, 'rucni', %L)$s$, :'firma', :'ucet', :'t_x'),
                         '23514', 'opačný směr'));
select pg_temp.check('storno s jinou částkou se odmítne',
  pg_temp.spadne_hlaskou(format($s$insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
                                    values (%L, %L, 'prijem', 999, current_date, 'rucni', %L)$s$, :'firma', :'ucet', :'t_x'),
                         '23514', 'opačný směr'));
select pg_temp.check('storno v jiné měně se odmítne',
  pg_temp.spadne_hlaskou(format($s$insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, mena, datum, zdroj, storno_of)
                                    values (%L, %L, 'prijem', 1000, 'EUR', current_date, 'rucni', %L)$s$, :'firma', :'ucet', :'t_x'),
                         '23514', 'opačný směr'));
select pg_temp.check('storno pohybu jiné firmy odmítne složený cizí klíč',
  pg_temp.spadne_hlaskou(format($s$insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, storno_of)
                                    values (%L, %L, 'prijem', 1000, current_date, 'rucni', %L)$s$, :'firma_b', :'ucet_b', :'t_x'),
                         '23503', ''));

-- Storno ve stažení z banky (storno_externi_id).
select pg_temp.faktura(:'firma', 'K112-SI', '11418', 43000) as f_si \gset
select pg_temp.nahrat(:'firma', :'ucet', 'banka_api', 'k112-si-1',
                      jsonb_build_array(pg_temp.radek('vydaj', 43000, '', '19-2000145399/0800', 'k112-si'))) is not null as v \gset
select coalesce((select id::text from public.transakce where ucet_id = :'ucet' and externi_id = 'k112-si'), 'žádný') as t_si \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select split_part(pg_temp.sparuj(:'firma', :'t_si', :'f_si', 43000), ';', 1) as v2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('storno z importu, příprava: pohyb ze stažení spárován — naměřeno: ' || :'v2', :'v' and :'v2' = 'Uhrazeno');
select pg_temp.nahrat(:'firma', :'ucet', 'banka_api', 'k112-si-2',
                      jsonb_build_array(pg_temp.radek('prijem', 42999, '', '19-2000145399/0800', 'k112-si-spatne', 'k112-si'))) is not null as v \gset
select pg_temp.check('stažení: storno s jinou částkou se zapíše jako obyčejný pohyb, párování drží',
  :'v' and (select storno_of from public.transakce where ucet_id = :'ucet' and externi_id = 'k112-si-spatne') is null
  and pg_temp.stav(:'f_si') = 'Uhrazeno');
select pg_temp.nahrat(:'firma', :'ucet', 'banka_api', 'k112-si-3',
                      jsonb_build_array(pg_temp.radek('prijem', 43000, '', '19-2000145399/0800', 'k112-si-storno', 'k112-si'))) is not null as v \gset
select pg_temp.check('stažení se stornem: storno_of = stornovaný pohyb, párování zrušené, faktura zpět — naměřeno: ' || pg_temp.stav(:'f_si'),
  :'v' and (select storno_of::text from public.transakce where ucet_id = :'ucet' and externi_id = 'k112-si-storno') = :'t_si'
  and pg_temp.stav(:'f_si') = 'Ke kontrole úhrady'
  and not exists (select 1 from public.platby_faktury where transakce_id::text = :'t_si' and stav = 'potvrzeno'));
select pg_temp.nahrat(:'firma', :'ucet', 'banka_api', 'k112-si-4',
                      jsonb_build_array(pg_temp.radek('prijem', 43000, '', '19-2000145399/0800', 'k112-si-storno2', 'k112-si'))) is not null as v \gset
select pg_temp.check('stažení: druhé storno téhož pohybu už storno_of nedostane',
  :'v' and (select storno_of from public.transakce where ucet_id = :'ucet' and externi_id = 'k112-si-storno2') is null);

-- Jediný výpočet stavu.
select pg_temp.check('stav faktury podle plateb počítá jediná funkce (app.faktura_stav_podle_plateb(uuid, uuid)) — naměřeno: '
    || (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p where p.proname = 'faktura_stav_podle_plateb'),
  (select count(*) from pg_proc p where p.proname = 'faktura_stav_podle_plateb') = 1
  and to_regprocedure('app.faktura_stav_podle_plateb(uuid, uuid)') is not null);

-- „Vrátit mezi neuhrazené": celé, nebo nic.
select pg_temp.faktura(:'firma', 'K112-V1', '11419', 25000, 'CZK', null, 'Neuhrazeno') as f_v \gset
select pg_temp.faktura(:'firma', 'K112-J2', '11221', 122100, 'CZK', '19-2000145399/0800') as f_j2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 122100, '11221') as t_j2 \gset
select pg_temp.faktura(:'firma', 'K112-V2', '11420', 30000) as f_v2 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 30000, '') as t_v2 \gset
select pg_temp.automatika(:'firma', :'t_j2', :'f_j2', 122100) as v \gset
select pg_temp.check('Vrátit, příprava: jistá shoda J2 spárována — naměřeno: ' || :'v', :'v' = 'ano');
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.hodnota(format($s$select public.rucne_uhradit_fakturu(%L, %L, 25000, 'Zaplaceno kartou')$s$, :'firma', :'f_v')) as v1 \gset
select pg_temp.hodnota(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, 'Platba se vrátila')$s$, :'firma', :'f_v')) as v2 \gset
select pg_temp.hodnota(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, null)$s$, :'firma', :'f_j2')) as v3 \gset
select pg_temp.hodnota(format($s$select public.rucne_uhradit_fakturu(%L, %L, 10000, 'Záloha v hotovosti')$s$, :'firma', :'f_v2')) as v4 \gset
select split_part(pg_temp.sparuj(:'firma', :'t_v2', :'f_v2', 30000), ';', 1) as v5 \gset
select pg_temp.check('Vrátit: faktura zaplacená ručně platbou z výpisu celá → odmítnuto, nic se nezměnilo',
  pg_temp.spadne_hlaskou(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, 'Zkouška')$s$, :'firma', :'f_v2'),
                         '23514', 'zaplacená celá'));
select pg_temp.check('Vrátit: faktura mimo Uhrazeno se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, 'Zkouška')$s$, :'firma', :'f_u1'),
                         '23514', 'není ve stavu Uhrazeno'));
select set_config('test.user_id', :'fin', false);
select pg_temp.check('Vrátit: finance bez správy Faktur nesmí',
  pg_temp.spadne_hlaskou(format($s$select public.vratit_fakturu_mezi_neuhrazene(%L, %L, 'Zkouška')$s$, :'firma', :'f_v2'),
                         '42501', 'spravuje přijaté faktury'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('Vrátit ruční úhradu: Neuhrazeno, úhrada zrušená s důvodem — naměřeno: ' || :'v1' || ' / ' || :'v2',
  :'v1' = 'Uhrazeno' and :'v2' = 'Neuhrazeno' and pg_temp.stav(:'f_v') = 'Neuhrazeno'
  and exists (select 1 from public.faktury_rucni_uhrady where faktura = :'f_v' and zruseno_kdy is not null
                and duvod_zruseni = 'Platba se vrátila'));
select pg_temp.check('Vrátit automatické párování: Ke kontrole úhrady, párování zrušené — naměřeno: ' || :'v3',
  :'v3' = 'Ke kontrole úhrady' and pg_temp.stav(:'f_j2') = 'Ke kontrole úhrady'
  and (select stav from public.platby_faktury where transakce_id = :'t_j2' and faktura = :'f_j2') = 'zamitnuto');
select pg_temp.check('Vrátit celé nebo nic: po odmítnutí ruční úhrada platí a faktura Uhrazeno — naměřeno: ' || :'v4' || ' / ' || :'v5',
  :'v4' = 'Částečně uhrazeno' and :'v5' = 'Uhrazeno' and pg_temp.stav(:'f_v2') = 'Uhrazeno'
  and exists (select 1 from public.faktury_rucni_uhrady where faktura = :'f_v2' and zruseno_kdy is null));


\echo ''
\echo '== 5. Návrhy: jednou, odmítnutý se nevrací, potvrzení, práva ============'

select id as n_n2 from public.platby_faktury where transakce_id = :'t_n2' and faktura = :'f_n' and stav = 'navrzeno' \gset
select id as n_n3 from public.platby_faktury where transakce_id = :'t_n3' and faktura = :'f_n2' and stav = 'navrzeno' \gset

select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_n2', 'faktura', :'f_n', 'castka_haleru', 45000,
                                       'duvod', 'vs+castka', 'jistota', 0.8)))) as v \gset
select pg_temp.check('návrh podruhé: nic nového, pořád jeden řádek — naměřeno: ' || :'v',
  :'v' = '0' and (select count(*) from public.platby_faktury where transakce_id = :'t_n2' and faktura = :'f_n') = 1);
select pg_temp.check('návrh: druhý otevřený řádek téže dvojice nepustí ani přímý zápis (unikátní index)',
  pg_temp.spadne_hlaskou(format($s$insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, stav, zpusob)
                                    values (%L, %L, %L, 100, 'navrzeno', 'automaticky')$s$, :'firma', :'t_n2', :'f_n'),
                         '23505', 'platby_faktury_navrh_jednou'));
select pg_temp.check('návrh: kód důvodu jen ze seznamu (číslo účtu do řádku nejde)',
  pg_temp.spadne_hlaskou(format($s$insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, stav, zpusob, duvod)
                                    values (%L, %L, %L, 100, 'navrzeno', 'automaticky', '19-2000145399/0800')$s$, :'firma', :'t_n1', :'f_n2'),
                         '23514', 'platby_faktury_duvod_kod'));
select pg_temp.check('návrh: neznámý důvod se odmítne',
  pg_temp.spadne_hlaskou(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
    jsonb_build_array(jsonb_build_object('transakce', :'t_n1', 'faktura', :'f_n2', 'castka_haleru', 100, 'duvod', 'ucet 19-2000145399'))),
    '23514', 'Neznámý důvod'));
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_st1', 'faktura', :'f_st1', 'castka_haleru', 113200,
                                       'duvod', 'vs+castka+ucet', 'jistota', 1)))) as v \gset
select pg_temp.check('návrh ke stornovanému pohybu se nezapíše — naměřeno: ' || :'v', :'v' = '0');

set role authenticated;
select set_config('test.user_id', :'fin', false);
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_x', 'faktura', :'f_u1', 'castka_haleru', 1000,
                                       'duvod', 'vs+castka', 'jistota', 0.9)))) as v \gset
select pg_temp.check('návrh: finance bez Faktur nic nezapíše — naměřeno: ' || :'v', :'v' = '0');
select pg_temp.potvrd(:'firma', :'n_n2') as v \gset
select pg_temp.check('návrh: finance bez Faktur nepotvrdí — naměřeno: ' || :'v', :'v' like 'chyba 42501:%');
select pg_temp.check('návrh: finance bez Faktur neodmítne',
  pg_temp.spadne_hlaskou(format('select public.odmitnout_navrh_parovani(%L, %L)', :'firma', :'n_n3'), '42501', 'odmítat návrhy'));
select set_config('test.user_id', :'maj', false);
select pg_temp.potvrd(:'firma', :'n_n2') as v \gset
select pg_temp.check('návrh potvrzen: faktura Uhrazeno (30 000 + 20 000) — naměřeno: ' || :'v', :'v' = 'Uhrazeno;50000;true;0');
select pg_temp.check('návrh: potvrzený podruhé ne',
  pg_temp.spadne_hlaskou(format('select * from public.potvrdit_navrh_parovani(%L, %L)', :'firma', :'n_n2'), '23514', 'není otevřený'));
select pg_temp.projde(format('select public.odmitnout_navrh_parovani(%L, %L)', :'firma', :'n_n3')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('návrh potvrzen: tentýž řádek potvrzený ručně, žádný druhý',
  (select stav from public.platby_faktury where id = :'n_n2') = 'potvrzeno'
  and (select zpusob from public.platby_faktury where id = :'n_n2') = 'rucne'
  and (select potvrdil from public.platby_faktury where id = :'n_n2') = :'maj'
  and (select count(*) from public.platby_faktury where transakce_id = :'t_n2' and faktura = :'f_n') = 1);
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_n3', 'faktura', :'f_n2', 'castka_haleru', 10000,
                                       'duvod', 'castka+dodavatel+okno', 'jistota', 0.6)))) as v2 \gset
select pg_temp.check('odmítnutý návrh se znovu nenavrhne — naměřeno: ' || :'v2',
  :'v' and :'v2' = '0' and (select stav from public.platby_faktury where id = :'n_n3') = 'zamitnuto'
  and (select count(*) from public.platby_faktury where transakce_id = :'t_n3' and faktura = :'f_n2') = 1
  and pg_temp.stav(:'f_n2') = 'Ke kontrole úhrady');

-- Faktura se mezitím zčásti zaplatila → návrh nad zbytek nepotvrdí.
select pg_temp.faktura(:'firma', 'K112-NP', '11421', 50000) as f_np \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 50000, '11421') as t_np1 \gset
select pg_temp.pohyb(:'firma', :'ucet', 'vydaj', 10000, '') as t_np2 \gset
select pg_temp.hodnota(format($s$select public.zapsat_navrhy_parovani(%L, %L::jsonb)$s$, :'firma',
  jsonb_build_array(jsonb_build_object('transakce', :'t_np1', 'faktura', :'f_np', 'castka_haleru', 50000,
                                       'duvod', 'vs+castka', 'jistota', 0.9)))) as v \gset
select id as n_np from public.platby_faktury where transakce_id = :'t_np1' and faktura = :'f_np' and stav = 'navrzeno' \gset
set role authenticated;
select set_config('test.user_id', :'maj', false);
select split_part(pg_temp.sparuj(:'firma', :'t_np2', :'f_np', 10000), ';', 1) as v2 \gset
select pg_temp.potvrd(:'firma', :'n_np') as v3 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('návrh nad zbytek zčásti zaplacené faktury se nepotvrdí — naměřeno: ' || :'v' || ' / ' || :'v2' || ' / ' || :'v3',
  :'v' = '1' and :'v2' = 'Částečně uhrazeno' and :'v3' like 'chyba 23514:%zčásti zaplacená%'
  and pg_temp.stav(:'f_np') = 'Částečně uhrazeno');


\echo ''
\echo '== 6. Zkouška 11: živé tvary faktur projdou beze změny ==================='

select pg_temp.faktura(:'firma', 'K112-Z11A', '11501', 1000, '', null, 'Duplicitní - zkontrolovat (Ke kontrole úhrady)') as z11a \gset
select pg_temp.faktura(:'firma', 'K112-Z11B', null, 0, 'CZK', null, 'Nutná ruční kontrola (chybí částka)') as z11b \gset
select pg_temp.faktura(:'firma', 'K112-Z11C', '11503', 1000, 'CZK', null, 'Upomínka - zkontrolovat') as z11c \gset
select pg_temp.check('zkouška 11 (služba): Duplicitní…, Nutná ruční kontrola…, Upomínka a prázdná měna uložené beze změny',
  (select stav || '|' || mena from public.faktury where id = :'z11a') = 'Duplicitní - zkontrolovat (Ke kontrole úhrady)|'
  and (select stav || '|' || castka_haleru from public.faktury where id = :'z11b') = 'Nutná ruční kontrola (chybí částka)|0'
  and (select stav from public.faktury where id = :'z11c') = 'Upomínka - zkontrolovat');
set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.projde(format($s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, mena, stav)
                                values (%L, 'Živý tvar s.r.o.', 'K112-Z11D', 1000, '', 'Upomínka - zkontrolovat')$s$, :'firma'))
  and pg_temp.projde(format($s$insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru, mena, stav)
                                values (%L, 'Živý tvar s.r.o.', 'K112-Z11E', 0, 'CZK', 'Nutná ruční kontrola (chybí VS)')$s$, :'firma'))
  and pg_temp.projde(format($s$update public.faktury set stav = 'Duplicitní - zkontrolovat (Neuhrazeno)' where id = %L$s$, :'f_u2')) as v \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zkouška 11 (přihlášený): živé tvary založí i přepne beze změny',
  :'v'
  and (select stav || '|' || mena from public.faktury where tenant_id = :'firma' and cislo_faktury = 'K112-Z11D') = 'Upomínka - zkontrolovat|'
  and (select stav from public.faktury where tenant_id = :'firma' and cislo_faktury = 'K112-Z11E') = 'Nutná ruční kontrola (chybí VS)'
  and pg_temp.stav(:'f_u2') = 'Duplicitní - zkontrolovat (Neuhrazeno)');
select pg_temp.check('zkouška 11: pohyb s prázdnou měnou uložen beze změny',
  (select mena from public.transakce where id = :'t_m2') = '');
select pg_temp.check('zkouška 11: na existujících sloupcích faktur, pohybů, párování a kontaktů nepřibyl CHECK ani NOT NULL z kroku 2',
  not exists (select 1 from pg_constraint c
               where c.conrelid in ('public.faktury'::regclass, 'public.transakce'::regclass,
                                    'public.platby_faktury'::regclass, 'public.kontakty'::regclass)
                 and c.contype = 'c' and c.conname <> 'platby_faktury_duvod_kod'
                 and pg_get_constraintdef(c.oid) ~ '(stav_pred_uhradou|duvod)')
  and (select attnotnull from pg_attribute where attrelid = 'public.faktury'::regclass and attname = 'stav_pred_uhradou') = false
  and (select attnotnull from pg_attribute where attrelid = 'public.platby_faktury'::regclass and attname = 'duvod') = false);


\echo ''
\echo '== 7. Granty, přímý zápis, RLS ručních úhrad ============================'

select pg_temp.check('granty: ruční úhrady přihlášený jen čte, služba taky, anon nic',
  has_table_privilege('authenticated', 'public.faktury_rucni_uhrady', 'select')
  and not has_table_privilege('authenticated', 'public.faktury_rucni_uhrady', 'insert')
  and not has_table_privilege('authenticated', 'public.faktury_rucni_uhrady', 'update')
  and not has_table_privilege('authenticated', 'public.faktury_rucni_uhrady', 'delete')
  and not has_table_privilege('authenticated', 'public.faktury_rucni_uhrady', 'truncate')
  and not has_table_privilege('service_role', 'public.faktury_rucni_uhrady', 'insert')
  and not has_table_privilege('service_role', 'public.faktury_rucni_uhrady', 'update')
  and not has_table_privilege('service_role', 'public.faktury_rucni_uhrady', 'delete')
  and not has_table_privilege('anon', 'public.faktury_rucni_uhrady', 'select'));
select pg_temp.check('granty: párování přihlášený přímo nezapíše ani nezmění; stav před úhradou nezmění',
  not has_table_privilege('authenticated', 'public.platby_faktury', 'insert')
  and not has_table_privilege('authenticated', 'public.platby_faktury', 'update')
  and not has_column_privilege('authenticated', 'public.faktury', 'stav_pred_uhradou', 'update'));
select pg_temp.check('granty: vnitřní funkce (přepočet, zrušení, jistá shoda, storno z importu) přihlášený nespustí',
  not has_function_privilege('authenticated', 'app.prepocitat_stav_faktury(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.prepocitat_stav_faktury(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.zrusit_parovani_interne(uuid, uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.sparovat_jiste_interne(uuid, uuid, uuid, integer, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.posoudit_jistou_shodu(uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.uhrazeno_faktury(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.faktura_stav_podle_plateb(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.storno_z_importu(uuid, uuid, jsonb, text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.faktura_k_rucni_uhrade(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.stejny_dodavatel(uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.prepocitat_stav_faktury(uuid, uuid)', 'execute'));
select pg_temp.check('granty: anon žádnou novou funkci párování ani úhrad nespustí, přihlášený ano',
  not has_function_privilege('anon', 'public.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.zapocitat_dobropis(uuid, uuid, uuid, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.zrusit_rucni_uhradu(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_navrh_parovani(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.odmitnout_navrh_parovani(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.zapsat_navrhy_parovani(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.sparovat_jiste_z_davky(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.smi_potvrdit_parovani(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.potvrdit_navrh_parovani(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.sparovat_jiste_z_davky(uuid, uuid)', 'execute'));

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('přímý zápis: ruční úhradu přihlášený nevloží ani nezruší (obejití funkce)',
  pg_temp.spadne_hlaskou(format($s$insert into public.faktury_rucni_uhrady (tenant_id, faktura, castka_haleru, duvod)
                                    values (%L, %L, 1000, 'Obejití funkce')$s$, :'firma', :'f_u1'), '42501', '')
  and pg_temp.spadne_hlaskou(format($s$update public.faktury_rucni_uhrady set zruseno_kdy = now() where tenant_id = %L$s$, :'firma'), '42501', ''));
select pg_temp.check('přímý zápis: potvrzené párování přihlášený nevloží ani nezmění (obejití funkce)',
  pg_temp.spadne_hlaskou(format($s$insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, stav)
                                    values (%L, %L, %L, 1000, 'potvrzeno')$s$, :'firma', :'t_x', :'f_u1'), '42501', '')
  and pg_temp.spadne_hlaskou(format($s$update public.platby_faktury set stav = 'zamitnuto' where tenant_id = %L$s$, :'firma'), '42501', '')
  and pg_temp.spadne_hlaskou(format($s$update public.faktury set stav_pred_uhradou = 'Neuhrazeno' where id = %L$s$, :'f_u1'), '42501', ''));
select count(*) as rls_maj from public.faktury_rucni_uhrady where tenant_id = :'firma' \gset
select set_config('test.user_id', :'fin', false);
select count(*) filter (where transakce_id is null) as rls_fin_bez,
       count(*) filter (where transakce_id = :'t_jm') as rls_fin_jm
  from public.faktury_rucni_uhrady where tenant_id = :'firma' \gset
select set_config('test.user_id', :'cizi', false);
select count(*) as rls_cizi from public.faktury_rucni_uhrady where tenant_id = :'firma' \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('RLS ručních úhrad (ověří CI): majitelka vidí všechny, finance jen úhradu k pohybu svého účtu, cizí nic — naměřeno: '
    || :'rls_maj' || '/' || :'rls_fin_bez' || '/' || :'rls_fin_jm' || '/' || :'rls_cizi',
  :'rls_maj'::bigint = (select count(*) from public.faktury_rucni_uhrady where tenant_id = :'firma')
  and :'rls_fin_bez'::bigint = 0 and :'rls_fin_jm'::bigint = 1 and :'rls_cizi'::bigint = 0);


\echo ''
\echo '== 8. Audit bez čísel účtů ==============================================='

select pg_temp.check('audit: každá cesta zapsala svou akci — chybí: '
    || coalesce((select string_agg(a, ', ') from unnest(array[
         'finance.platba_alokovana', 'finance.platba_alokovana_automaticky', 'finance.platba_zrusena',
         'finance.automaticke_parovani_zruseno', 'finance.parovani_zruseno_stornem', 'finance.navrh_parovani_odmitnut',
         'faktury.rucni_uhrada', 'faktury.rucni_uhrada_zrusena', 'faktury.dobropis_zapocten',
         'faktury.vraceno_mezi_neuhrazene', 'faktura_rucni_uhrada.insert', 'faktura_rucni_uhrada.update']) a
        where not exists (select 1 from public.audit_log l where l.tenant_id = :'firma' and l.action = a)), 'nic'),
  not exists (select 1 from unnest(array[
         'finance.platba_alokovana', 'finance.platba_alokovana_automaticky', 'finance.platba_zrusena',
         'finance.automaticke_parovani_zruseno', 'finance.parovani_zruseno_stornem', 'finance.navrh_parovani_odmitnut',
         'faktury.rucni_uhrada', 'faktury.rucni_uhrada_zrusena', 'faktury.dobropis_zapocten',
         'faktury.vraceno_mezi_neuhrazene', 'faktura_rucni_uhrada.insert', 'faktura_rucni_uhrada.update']) a
        where not exists (select 1 from public.audit_log l where l.tenant_id = :'firma' and l.action = a)));
select pg_temp.check('audit párování, návrhů, ručních úhrad a faktur neobsahuje číslo účtu — řádků s účtem: '
    || (select count(*) from public.audit_log l
         where l.tenant_id = :'firma'
           and (l.action in ('finance.platba_alokovana', 'finance.platba_alokovana_automaticky', 'finance.platba_zrusena',
                         'finance.automaticke_parovani_zruseno', 'finance.parovani_zruseno_stornem',
                         'finance.navrh_parovani_odmitnut', 'faktury.rucni_uhrada', 'faktury.rucni_uhrada_zrusena',
                         'faktury.dobropis_zapocten', 'faktury.vraceno_mezi_neuhrazene')
                or l.entity_type in ('platba_faktury', 'faktura_rucni_uhrada', 'faktura'))
           and (coalesce(l.before::text, '') || coalesce(l.after::text, '')) ~ '(2000145399|199488014|CZ6508|CZ9703)'),
  (select count(*) from public.audit_log l where l.tenant_id = :'firma'
     and (l.action in ('finance.platba_alokovana', 'finance.platba_alokovana_automaticky', 'finance.platba_zrusena',
                         'finance.automaticke_parovani_zruseno', 'finance.parovani_zruseno_stornem',
                         'finance.navrh_parovani_odmitnut', 'faktury.rucni_uhrada', 'faktury.rucni_uhrada_zrusena',
                         'faktury.dobropis_zapocten', 'faktury.vraceno_mezi_neuhrazene')
                or l.entity_type in ('platba_faktury', 'faktura_rucni_uhrada', 'faktura'))) > 20
  and not exists (select 1 from public.audit_log l
                   where l.tenant_id = :'firma'
                     and (l.action in ('finance.platba_alokovana', 'finance.platba_alokovana_automaticky', 'finance.platba_zrusena',
                         'finance.automaticke_parovani_zruseno', 'finance.parovani_zruseno_stornem',
                         'finance.navrh_parovani_odmitnut', 'faktury.rucni_uhrada', 'faktury.rucni_uhrada_zrusena',
                         'faktury.dobropis_zapocten', 'faktury.vraceno_mezi_neuhrazene')
                or l.entity_type in ('platba_faktury', 'faktura_rucni_uhrada', 'faktura'))
                     and (coalesce(l.before::text, '') || coalesce(l.after::text, '')) ~ '(2000145399|199488014|CZ6508|CZ9703)'));


\echo ''
\echo '== 9. Ukázka: výpis × stažení z banky a VS ==============================='

-- Stejný VS: stažení řádek výpisu jen potvrdí. Stažení BEZ VS (Salt Edge
-- VS nedává) má jiný obsahový klíč → pohyb se zapíše podruhé (krok 1,
-- otázka v hlášení). Párování to neohrozí: ani jeden z dvojice se
-- automaticky nespáruje.
select pg_temp.faktura(:'firma', 'K112-VS2', '1191', 119100, 'CZK', '19-2000145399/0800') as f_vs2 \gset
select pg_temp.nahrat(:'firma', :'ucet_vs', 'csv_banka', 'k112-vs-1',
                      jsonb_build_array(pg_temp.radek('vydaj', 119000, '1190'), pg_temp.radek('vydaj', 119100, '1191'))) is not null as v \gset
select pg_temp.nahrat(:'firma', :'ucet_vs', 'banka_api', 'k112-vs-2',
                      jsonb_build_array(pg_temp.radek('vydaj', 119000, '1190', '19-2000145399/0800', 'k112-vs1'),
                                        pg_temp.radek('vydaj', 119100, '', '19-2000145399/0800', 'k112-vs2'))) is not null as v2 \gset
select pg_temp.check('výpis × stažení se stejným VS: pohyb jednou, banka ho potvrdila',
  :'v' and :'v2'
  and (select count(*) from public.transakce where ucet_id = :'ucet_vs' and castka_haleru = 119000) = 1
  and exists (select 1 from public.transakce_potvrzeni_banky where ucet_id = :'ucet_vs' and externi_id = 'k112-vs1'));
select pg_temp.check('výpis s VS × stažení bez VS: ani jeden z dvojice se automaticky nespáruje — pohybů: '
    || (select count(*) from public.transakce where ucet_id = :'ucet_vs' and castka_haleru = 119100),
  (select bool_and(pg_temp.automatika(:'firma', t.id, :'f_vs2', 119100) = 'ne')
     from public.transakce t where t.ucet_id = :'ucet_vs' and t.castka_haleru = 119100)
  and pg_temp.stav(:'f_vs2') = 'Ke kontrole úhrady');

\echo ''
\echo '== KROK 112 HOTOV ========================================'
