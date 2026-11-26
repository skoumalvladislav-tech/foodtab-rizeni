-- Scénář pro krok 113 — Finance Fáze 0, krok 3: pobočky a platební účty.
--
-- Migrace: 20261121100000_pobocky_ucty.sql.
-- Zadání: docs/finance-faze0-zadani.md, oddíl Krok 3.
--
-- Pokrývá:
--   1. jedna definice „pobočka bez aktivního účtu"
--      (public.pobocky_bez_aktivniho_uctu):
--      * vypnutý účet = žádný účet; firemní účet bez pobočky se žádné
--        pobočce nepočítá;
--      * za celou firmu jen aktivní a nesmazané pobočky této firmy;
--        dotaz na jednu pobočku vrací jen ji, i vypnutou;
--      * vlastní filtry funkce změřené BEZ RLS (vlastník databáze):
--        cizí účet na naší pobočce, cizí pobočky, smazané pobočky;
--      * bez práva 42501, ne prázdný seznam: pobočkový uživatel za
--        celou firmu i za cizí pobočku, cizí firma, prázdná firma;
--      * zapnutí a vypnutí účtu se v seznamu hned projeví;
--   2. úprava účtu jen se Správou financí za celou firmu:
--      * správce pobočky, čtenář pobočky, správa bez čtení i čtenář
--        celé firmy účet neupraví (0 řádků) — ověří CI;
--      * pobočkový uživatel nevidí firemní účet — ověří CI;
--      * správce pobočky dál založí účet své pobočky, firemní ne;
--      * založit účet jde jen se sloupci formuláře — počáteční zůstatek,
--        měnu ani vypnutý účet přihlášený nezaloží (sloupcový grant)
--        — ověří CI;
--      * správce celé firmy (ne majitel) přesune účet ze smazané pobočky;
--      * měnu, typ ani firmu účtu přihlášený nezmění (sloupcový grant)
--        — ověří CI; katalog grantů a politik ověří i PGlite;
--   3. účet, na který míří živé připojení banky, nejde vypnout
--      (spoušť platí i pro vlastníka databáze); po úplném odpojení ano;
--   3b. a naopak: k vypnutému účtu nejde živé připojení založit,
--      přesměrovat ani obnovit; staré živé připojení synchronizace dál
--      mění a odpojit ho jde; spoušť filtruje firmu sama a zamyká účet;
--   3c. na vypnutý účet přihlášený platbu nezapíše — přímý zápis,
--      výpis přes importovat_vypis ani uzávěrku pokladny přes
--      importovat_transakce; služba dál stahuje;
--      ruční platba v dnešním tvaru appky na zapnutý účet beze změny;
--   3d. společný firemní účet (dodatek 3d, rozhodnutí Šéfíka 25. 11.):
--      public.firma_ma_firemni_ucet — jen ano/ne, i pro pobočku:
--      * aktivní firemní účet → ano; jen vypnutý firemní → ne; jen
--        pobočkový → ne; firma bez jediného účtu → ne, i když jiná firma
--        aktivní firemní účet má — filtr firmy ve funkci;
--      * čtenář pobočky dostane odpověď, ale řádek firemního účtu dál
--        nevidí — ověří CI; a dostane i „ne" (čtenářka Gamy ve firmě B
--        u každého kroku firmy B), ne vždycky „ano";
--      * bez finance.read, cizí firma a prázdná firma 42501; anonym ji
--        nespustí — ověří CI;
--      * vrací jen boolean, s právy vlastníka a prázdnou search_path;
--   4. zkouška 11 — živé tvary účtů (firemní bez čísla, účet pobočky
--      s číslem ve starém zápisu) po všech zkouškách beze změny.
--
-- Spoušť z kroku 1 proti cizí pobočce se tu znovu nezkouší — dělá to
-- krok111 (oddíl Druhá linie).
--
-- POZOR: PGlite běží jako superuživatel — kontroly RLS a sloupcových
-- grantů („ověří CI") rozhoduje až workflow Databáze proti PostgreSQL 16.
--
-- Vlastní firmy a vlastní id — CI pouští všechny scénáře v jedné
-- databázi, nic se nepočítá přes cizí řádky.

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

-- Kolik řádků příkaz změnil; -1, když spadl (vypíše proč) — kontrola
-- za ním pak spadne SVÝM jménem.
create or replace function pg_temp.zmeneno(p_sql text)
returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when others then
  raise notice '  (spadlo: % %)', sqlstate, sqlerrm;
  return -1;
end $$;

-- Výsledek dotazu jako číslo (počet nových pohybů importu); -1, když
-- spadl (vypíše proč) — kontrola za ním pak spadne SVÝM jménem.
create or replace function pg_temp.novych(p_sql text)
returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql into n;
  return n;
exception when others then
  raise notice '  (spadlo: % %)', sqlstate, sqlerrm;
  return -1;
end $$;

-- Názvy poboček bez aktivního účtu, seřazené a spojené čárkou;
-- '(nic)' pro prázdný seznam, 'chyba SQLSTATE' když funkce spadne.
create or replace function pg_temp.bez_uctu(p_tenant uuid, p_branch uuid default null)
returns text language plpgsql as $$
declare
  v text;
begin
  select coalesce(string_agg(f.nazev, ', ' order by f.nazev collate "C"), '(nic)') into v
    from public.pobocky_bez_aktivniho_uctu(p_tenant, p_branch) f;
  return v;
exception when others then
  return 'chyba ' || sqlstate;
end $$;

-- Odpověď public.firma_ma_firemni_ucet jako text: 'ano', 'ne', nebo
-- 'chyba SQLSTATE', když funkce spadne — kontrola pak spadne SVÝM jménem.
create or replace function pg_temp.firemni(p_tenant uuid)
returns text language plpgsql as $$
declare
  v boolean;
begin
  v := public.firma_ma_firemni_ucet(p_tenant);
  return case when v then 'ano' when not v then 'ne' else 'prázdno' end;
exception when others then
  return 'chyba ' || sqlstate;
end $$;

-- Příprava jako služba: bez role a bez přihlášeného (PGlite pouští
-- scénáře jedním spojením, nastavení z předchozího by se přeneslo).
reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Firma A (Provoz + Finance), pobočky:
--   Alfa  — aktivní, bez účtu;
--   Beta  — aktivní, aktivní účet (číslo ve starém zápisu) a druhý účet
--           s připojením banky;
--   Cyril — aktivní, jen VYPNUTÝ účet;
--   Dora  — vypnutá pobočka, bez účtu;
--   Emil  — smazaná pobočka (active zůstalo true), bez účtu;
--   Fany  — smazaná a vypnutá pobočka s aktivním účtem.
-- Firemní účet A: bez pobočky, bez čísla, CZK.
-- Lidé A:
--   Marie  — majitelka;
--   Petr   — finance.read + finance.manage jen na Betě;
--   Pavla  — finance.read jen na Betě;
--   Filip  — finance.read za celou firmu;
--   Simona — finance.read + finance.manage za celou firmu (ne majitelka);
--   Jan    — jen finance.manage na Betě, bez čtení.
-- Firma B (cizí): Bohdan — majitel; pobočka Gama bez účtu;
--   Gabriela — finance.read jen na Gamě (oddíl 3d).
-- =====================================================================

\set maj       11130000-0000-0000-0000-000000000001
\set spr_pob   11130000-0000-0000-0000-000000000002
\set cte_pob   11130000-0000-0000-0000-000000000003
\set cte_firma 11130000-0000-0000-0000-000000000004
\set spr_firma 11130000-0000-0000-0000-000000000005
\set jen_sprava 11130000-0000-0000-0000-000000000006
\set cizi      11130000-0000-0000-0000-000000000007
\set cte_pob_b 11130000-0000-0000-0000-000000000008

insert into auth.users (id, email, raw_user_meta_data) values
  (:'maj',        'marie113@foodtab.cz',  '{"full_name":"Marie Stotřináctá"}'),
  (:'spr_pob',    'petr113@foodtab.cz',   '{"full_name":"Petr Stotřináctý"}'),
  (:'cte_pob',    'pavla113@foodtab.cz',  '{"full_name":"Pavla Stotřináctá"}'),
  (:'cte_firma',  'filip113@foodtab.cz',  '{"full_name":"Filip Stotřináctý"}'),
  (:'spr_firma',  'simona113@foodtab.cz', '{"full_name":"Simona Stotřináctá"}'),
  (:'jen_sprava', 'jan113@foodtab.cz',    '{"full_name":"Jan Stotřináctý"}'),
  (:'cizi',       'bohdan113@foodtab.cz', '{"full_name":"Bohdan Stotřináctý"}'),
  (:'cte_pob_b',  'gabriela113@foodtab.cz', '{"full_name":"Gabriela Stotřináctá"}');

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok113 Alfa s.r.o.', 'Krok113 Alfa s.r.o.', 'CZK', 'Europe/Prague') returning id as firma \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma', 'provoz'), (:'firma', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok113 Alfa', 'krok113-alfa') returning id as pa \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok113 Beta', 'krok113-beta') returning id as pb \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok113 Cyril', 'krok113-cyril') returning id as pc \gset
insert into public.branches (tenant_id, name, slug, active)
values (:'firma', 'Krok113 Dora', 'krok113-dora', false) returning id as pd \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok113 Emil', 'krok113-emil') returning id as pe \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok113 Fany', 'krok113-fany') returning id as pf \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'firma', 'krok113_sprava', 'Krok113 — správa financí', 'provoz', true) returning id as z_sprava \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma', 'krok113_cteni', 'Krok113 — čtení financí', 'provoz', true) returning id as z_cteni \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma', 'krok113_jen_sprava', 'Krok113 — jen správa financí', 'provoz', true) returning id as z_jen_sprava \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'firma', :'z_sprava', 'finance.read'),
  (:'firma', :'z_sprava', 'finance.manage'),
  (:'firma', :'z_cteni', 'finance.read'),
  (:'firma', :'z_jen_sprava', 'finance.manage');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma', :'pb', :'maj', 'Marie Stotřináctá', 'hpp', true) returning id as e_maj \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'pb', :'spr_pob', :'z_sprava', 'Petr Stotřináctý', 'hpp') returning id as e_spr_pob \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'pb', :'cte_pob', :'z_cteni', 'Pavla Stotřináctá', 'hpp') returning id as e_cte_pob \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'pb', :'cte_firma', :'z_cteni', 'Filip Stotřináctý', 'hpp') returning id as e_cte_firma \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'pb', :'spr_firma', :'z_sprava', 'Simona Stotřináctá', 'hpp') returning id as e_spr_firma \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma', :'pb', :'jen_sprava', :'z_jen_sprava', 'Jan Stotřináctý', 'hpp') returning id as e_jen_sprava \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma', :'maj',        null, 'tenant', 'active'),
  (:'firma', :'cte_firma',  null, 'tenant', 'active'),
  (:'firma', :'spr_firma',  null, 'tenant', 'active'),
  (:'firma', :'spr_pob',    null, 'branch', 'active'),
  (:'firma', :'cte_pob',    null, 'branch', 'active'),
  (:'firma', :'jen_sprava', null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pb'::uuid
  from public.memberships m
 where m.tenant_id = :'firma' and m.user_id in (:'spr_pob', :'cte_pob', :'jen_sprava');

insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok113 Cizí s.r.o.', 'Krok113 Cizí s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_b \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_b', 'provoz'), (:'firma_b', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_b', 'Krok113 Gama', 'krok113-gama') returning id as pg \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_b', :'pg', :'cizi', 'Bohdan Stotřináctý', 'hpp', true) returning id as e_cizi \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'firma_b', :'cizi', null, 'tenant', 'active');
-- Gabriela: finance.read jen na Gamě (rozsah pobočky) — pobočkový čtenář
-- firmy B, která firemní účet střídavě má a nemá (oddíl 3d).
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_b', 'krok113_cteni_b', 'Krok113 — čtení financí B', 'provoz', true) returning id as z_cteni_b \gset
insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'firma_b', :'z_cteni_b', 'finance.read');
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_b', :'pg', :'cte_pob_b', :'z_cteni_b', 'Gabriela Stotřináctá', 'hpp') returning id as e_cte_pob_b \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'firma_b', :'cte_pob_b', null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pg'::uuid
  from public.memberships m
 where m.tenant_id = :'firma_b' and m.user_id = :'cte_pob_b';

-- Účty firmy A. Firemní a Beta jsou v živém tvaru (zkouška 11).
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma', null, 'Krok113 firemní účet', 'banka') returning id as u_firma \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, cislo_uctu)
values (:'firma', :'pb', 'Krok113 účet Beta', 'banka', '19-2000145399/0800') returning id as u_beta \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma', :'pb', 'Krok113 účet s připojením', 'banka') returning id as u_spoj \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, aktivni)
values (:'firma', :'pc', 'Krok113 vypnutý účet Cyril', 'banka', false) returning id as u_cyril \gset
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma', :'pf', 'Krok113 účet Fany', 'banka') returning id as u_fany \gset

-- Emil a Fany smazané až po založení účtů (tak to v provozu vzniká).
-- Emilovi zůstane active = true — i takový tvar v datech je.
update public.branches set deleted_at = now() where id = :'pe';
update public.branches set deleted_at = now(), active = false where id = :'pf';

select md5(string_agg(u::text, '|' order by u.id)) as otisk_pred
  from public.platebni_ucty u where u.id in (:'u_firma', :'u_beta') \gset

select pg_temp.check('příprava: firemní účet bez pobočky a čísla v CZK, účet Bety s číslem ve starém zápisu',
  exists (select 1 from public.platebni_ucty
           where id = :'u_firma' and branch_id is null and cislo_uctu = '' and mena = 'CZK' and aktivni)
  and exists (select 1 from public.platebni_ucty
               where id = :'u_beta' and branch_id = :'pb' and cislo_uctu = '19-2000145399/0800' and aktivni));


\echo ''
\echo '== 1. Pobočky bez aktivního účtu: jedna definice ========================'

-- Vlastní filtry funkce BEZ RLS: vlastník databáze RLS obchází, právo
-- (has_access) se ptá na test.user_id = majitelka. Co tu projde, drží
-- filtr ve funkci, ne politika.
reset role;
select set_config('test.user_id', :'maj', false);

-- Cizí účet na naší pobočce Alfa: v provozu ho spoušť z kroku 1
-- nepustí, tady se obejde, ať je filtr firmy ve funkci měřitelný.
alter table public.platebni_ucty disable trigger trg_firma_platebniho_uctu;
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_b', :'pa', 'Krok113 cizí účet na Alfě', 'banka') returning id as u_cizi_na_alfe \gset
alter table public.platebni_ucty enable trigger trg_firma_platebniho_uctu;
select pg_temp.check('spoušť firmy účtu je zase zapnutá',
  (select tgenabled from pg_trigger
    where tgname = 'trg_firma_platebniho_uctu' and tgrelid = 'public.platebni_ucty'::regclass) = 'O');

-- Konkrétní kontroly před souhrnnou: rozbití jednoho filtru má shodit
-- tu svou, ne souhrn.
select pg_temp.check('bez RLS: účet cizí firmy na naší pobočce Alfa se jí nepočítá',
  pg_temp.bez_uctu(:'firma') like '%Krok113 Alfa%'
  and pg_temp.bez_uctu(:'firma', :'pa') = 'Krok113 Alfa');
select pg_temp.check('bez RLS: pobočky cizí firmy v seznamu nejsou',
  pg_temp.bez_uctu(:'firma') not like '%Gama%');
select pg_temp.check('bez RLS: smazaná pobočka v seznamu není, ani dotazem na ni',
  pg_temp.bez_uctu(:'firma') not like '%Emil%'
  and pg_temp.bez_uctu(:'firma', :'pe') = '(nic)');
select pg_temp.check('bez RLS: vypnutý účet = žádný účet, Cyril v seznamu je',
  pg_temp.bez_uctu(:'firma') like '%Krok113 Cyril%');
select pg_temp.check('bez RLS: vypnutá pobočka Dora za celou firmu v seznamu není',
  pg_temp.bez_uctu(:'firma') not like '%Dora%');
select pg_temp.check('bez RLS: celá firma — bez aktivního účtu jen Alfa a Cyril',
  pg_temp.bez_uctu(:'firma') = 'Krok113 Alfa, Krok113 Cyril');

delete from public.platebni_ucty where id = :'u_cizi_na_alfe';
select set_config('test.user_id', '', false);

-- Totéž skutečnou cestou: přihlášená majitelka.
set role authenticated;
select set_config('test.user_id', :'maj', false);

select pg_temp.check('majitelka: celá firma — bez aktivního účtu jen Alfa a Cyril',
  pg_temp.bez_uctu(:'firma') = 'Krok113 Alfa, Krok113 Cyril');
select pg_temp.check('vypnutý účet = žádný účet: Cyril s jediným vypnutým účtem v seznamu je',
  pg_temp.bez_uctu(:'firma') like '%Krok113 Cyril%'
  and pg_temp.bez_uctu(:'firma', :'pc') = 'Krok113 Cyril');
select pg_temp.check('pobočka s aktivním účtem v seznamu není: Beta',
  pg_temp.bez_uctu(:'firma') not like '%Beta%'
  and pg_temp.bez_uctu(:'firma', :'pb') = '(nic)');
select pg_temp.check('vypnutá pobočka Dora v seznamu celé firmy není',
  pg_temp.bez_uctu(:'firma') not like '%Dora%');
select pg_temp.check('dotaz na jednu pobočku vrací jen ji, i vypnutou: Dora',
  pg_temp.bez_uctu(:'firma', :'pd') = 'Krok113 Dora');
select pg_temp.check('smazaná pobočka Emil v seznamu celé firmy není',
  pg_temp.bez_uctu(:'firma') not like '%Emil%');
select pg_temp.check('výstup funkce: id pobočky a její název',
  coalesce((select array_agg(f.pobocka_id::text || '=' || f.nazev order by f.nazev collate "C")
              from public.pobocky_bez_aktivniho_uctu(:'firma', null) f)
           = array[:'pa' || '=Krok113 Alfa', :'pc' || '=Krok113 Cyril'], false));

-- Zapnutí a vypnutí účtu se projeví hned (majitelka smí).
select pg_temp.check('majitelka zapne účet Cyrila: Cyril ze seznamu zmizí',
  pg_temp.zmeneno(format('update public.platebni_ucty set aktivni = true where id = %L', :'u_cyril')) = 1
  and pg_temp.bez_uctu(:'firma') = 'Krok113 Alfa');
select pg_temp.check('majitelka účet Cyrila zase vypne: Cyril je v seznamu zpátky',
  pg_temp.zmeneno(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_cyril')) = 1
  and pg_temp.bez_uctu(:'firma') = 'Krok113 Alfa, Krok113 Cyril');

-- Bez práva 42501, ne prázdný seznam („všechny pobočky mají účet").
select set_config('test.user_id', :'cte_pob', false);
select pg_temp.check('čtenář pobočky Beta za celou firmu: 42501',
  pg_temp.spadne_hlaskou(format('select * from public.pobocky_bez_aktivniho_uctu(%L, null)', :'firma'),
    '42501', 'Nemáte oprávnění'));
select pg_temp.check('čtenář pobočky Beta na cizí pobočce Alfa: 42501',
  pg_temp.spadne_hlaskou(format('select * from public.pobocky_bez_aktivniho_uctu(%L, %L)', :'firma', :'pa'),
    '42501', 'Nemáte oprávnění'));
select pg_temp.check('čtenář pobočky Beta na své pobočce: projde, Beta účet má',
  pg_temp.bez_uctu(:'firma', :'pb') = '(nic)');

select set_config('test.user_id', :'cte_firma', false);
select pg_temp.check('čtenář celé firmy dostane týž seznam jako majitelka',
  pg_temp.bez_uctu(:'firma') = 'Krok113 Alfa, Krok113 Cyril');

select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: 42501',
  pg_temp.spadne_hlaskou(format('select * from public.pobocky_bez_aktivniho_uctu(%L, null)', :'firma'),
    '42501', 'Nemáte oprávnění')
  and pg_temp.spadne_hlaskou(format('select * from public.pobocky_bez_aktivniho_uctu(%L, %L)', :'firma', :'pa'),
    '42501', 'Nemáte oprávnění'));

select set_config('test.user_id', :'maj', false);
select pg_temp.check('prázdná firma: 42501',
  pg_temp.spadne_hlaskou('select * from public.pobocky_bez_aktivniho_uctu(null, null)', '42501', 'Nemáte oprávnění'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('funkce běží s právy volajícího, anonym ji nespustí, přihlášený ano',
  not (select prosecdef from pg_proc where oid = 'public.pobocky_bez_aktivniho_uctu(uuid, uuid)'::regprocedure)
  and not has_function_privilege('anon', 'public.pobocky_bez_aktivniho_uctu(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.pobocky_bez_aktivniho_uctu(uuid, uuid)', 'execute'));


\echo ''
\echo '== 2. Úprava účtu jen se Správou financí za celou firmu =================='

set role authenticated;

-- Petr: správa i čtení jen na Betě.
select set_config('test.user_id', :'spr_pob', false);
select pg_temp.check('správce pobočky vidí účty Bety, firemní účet ani smazanou pobočku ne — ověří CI',
  coalesce((select array_agg(id order by id) from public.platebni_ucty
              where id in (:'u_firma', :'u_beta', :'u_spoj', :'u_fany', :'u_cyril'))
           = (select array_agg(x order by x) from unnest(array[:'u_beta'::uuid, :'u_spoj'::uuid]) x), false));
select pg_temp.check('správce pobočky účet své pobočky nepřejmenuje: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set nazev = %L where id = %L', 'Krok113 přepsáno', :'u_beta')) = 0);
select pg_temp.check('správce pobočky účet své pobočky nepřesune na firemní: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set branch_id = null where id = %L', :'u_beta')) = 0);
select pg_temp.check('správce pobočky účet své pobočky nevypne ani mu nepřepíše číslo: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_beta')) = 0
  and pg_temp.zmeneno(format('update public.platebni_ucty set cislo_uctu = %L where id = %L',
    'CZ5508000000001234567899', :'u_beta')) = 0);
select pg_temp.check('správce pobočky firemní účet neupraví: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set branch_id = %L where id = %L', :'pb', :'u_firma')) = 0);
select pg_temp.check('správce pobočky dál založí účet své pobočky',
  pg_temp.projde(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (%L, %L, %L, %L)',
    :'firma', :'pb', 'Krok113 nový účet Bety', 'banka')));
select pg_temp.check('správce pobočky nezaloží firemní účet: 42501 — ověří CI',
  pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ) values (%L, null, %L, %L)',
    :'firma', 'Krok113 firemní od pobočky', 'banka'), '42501', ''));
-- Založení jen se sloupci formuláře: přímým zápisem přes REST by si
-- správce pobočky jinak „nadělil" zůstatek, který se přičte do čísel
-- pobočky i celé firmy (app.aktualni_zustatky_uctu).
select pg_temp.check('správce pobočky nezaloží účet své pobočky s počátečním zůstatkem: grant, 42501 — ověří CI',
  pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, pocatecni_zustatek_haleru) values (%L, %L, %L, %L, %s)',
    :'firma', :'pb', 'Krok113 zakázaný zůstatek Bety', 'pokladna', 2000000000), '42501', 'permission denied'));

-- Pavla: jen čtení na Betě.
select set_config('test.user_id', :'cte_pob', false);
select pg_temp.check('čtenář pobočky nevidí firemní účet, svůj ano — ověří CI',
  not exists (select 1 from public.platebni_ucty where id = :'u_firma')
  and exists (select 1 from public.platebni_ucty where id = :'u_beta'));
select pg_temp.check('čtenář pobočky účet neupraví: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set nazev = %L where id = %L', 'Krok113 přepsáno', :'u_beta')) = 0);

-- Jan: jen správa na Betě, bez čtení — čtení mu dává politika správce
-- (dřív stará politika pro všechno).
select set_config('test.user_id', :'jen_sprava', false);
select pg_temp.check('jen správa na Betě: vidí účty Bety, firemní ne — ověří CI',
  exists (select 1 from public.platebni_ucty where id = :'u_beta')
  and not exists (select 1 from public.platebni_ucty where id = :'u_firma'));
select pg_temp.check('jen správa na Betě: účet neupraví: 0 řádků — ověří CI',
  pg_temp.zmeneno(format('update public.platebni_ucty set nazev = %L where id = %L', 'Krok113 přepsáno', :'u_beta')) = 0);

-- Filip: čtení za celou firmu, bez správy.
select set_config('test.user_id', :'cte_firma', false);
select pg_temp.check('čtenář celé firmy vidí firemní účet, upravit ho nesmí: 0 řádků — ověří CI',
  exists (select 1 from public.platebni_ucty where id = :'u_firma')
  and pg_temp.zmeneno(format('update public.platebni_ucty set nazev = %L where id = %L', 'Krok113 přepsáno', :'u_firma')) = 0);

-- Marie: účet na smazané pobočce najde.
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitelka vidí účet na smazané pobočce Fany',
  exists (select 1 from public.platebni_ucty where id = :'u_fany' and branch_id = :'pf'));

-- Simona: správa za celou firmu, ne majitelka — oprava účtu ze smazané
-- pobočky jde, sám se nepřesunul.
select set_config('test.user_id', :'spr_firma', false);
select pg_temp.check('správce celé firmy přesune účet ze smazané pobočky Fany na Betu: 1 řádek',
  pg_temp.zmeneno(format('update public.platebni_ucty set branch_id = %L where id = %L', :'pb', :'u_fany')) = 1);
select pg_temp.check('správce celé firmy: měnu účtu nezmění, 42501 — ověří CI',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set mena = %L where id = %L', 'EUR', :'u_beta'), '42501', ''));
select pg_temp.check('správce celé firmy: typ účtu ani firmu nezmění, 42501 — ověří CI',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set typ = %L where id = %L', 'pokladna', :'u_beta'), '42501', '')
  and pg_temp.spadne_hlaskou(format('update public.platebni_ucty set tenant_id = %L where id = %L', :'firma_b', :'u_beta'), '42501', ''));
-- Založení: přesně sloupce, které posílá zalozitPlatebniUcet, projdou.
select pg_temp.check('správce celé firmy založí firemní účet sloupci formuláře: firma, pobočka, název, typ, číslo',
  pg_temp.projde(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, cislo_uctu) values (%L, null, %L, %L, %L)',
    :'firma', 'Krok113 firemní z formuláře', 'banka', 'CZ6508000000192000145399')));
select pg_temp.check('správce celé firmy nezaloží účet s počátečním zůstatkem, měnou ani vypnutý: grant, 42501 — ověří CI',
  pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, pocatecni_zustatek_haleru) values (%L, null, %L, %L, %s)',
    :'firma', 'Krok113 zakázaný zůstatek', 'banka', 100), '42501', 'permission denied')
  and pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, mena) values (%L, null, %L, %L, %L)',
    :'firma', 'Krok113 zakázaná měna', 'banka', 'EUR'), '42501', 'permission denied')
  and pg_temp.spadne_hlaskou(format('insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, aktivni) values (%L, null, %L, %L, false)',
    :'firma', 'Krok113 zakázaně vypnutý', 'banka'), '42501', 'permission denied'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po zkouškách: účet Fany je na Betě, nový účet Bety je pod Betou, firemní od pobočky ani zakázané nevznikly',
  exists (select 1 from public.platebni_ucty where id = :'u_fany' and branch_id = :'pb')
  and exists (select 1 from public.platebni_ucty
               where tenant_id = :'firma' and branch_id = :'pb' and nazev = 'Krok113 nový účet Bety')
  and exists (select 1 from public.platebni_ucty
               where tenant_id = :'firma' and branch_id is null and nazev = 'Krok113 firemní z formuláře'
                 and pocatecni_zustatek_haleru = 0 and mena = 'CZK' and aktivni)
  and not exists (select 1 from public.platebni_ucty
                   where tenant_id = :'firma' and nazev = 'Krok113 firemní od pobočky')
  and not exists (select 1 from public.platebni_ucty
                   where tenant_id = :'firma' and nazev like 'Krok113 zakázan%'));

-- Katalog až za chováním: rozbitá politika nebo grant má shodit kontrolu
-- chování (přes RLS), ne jen tuhle o textu politiky.
select pg_temp.check('politiky účtů: čtení, čtení správce, založení, úprava — žádná pro všechno',
  coalesce((select array_agg(policyname || ':' || cmd order by policyname)
              from pg_policies where schemaname = 'public' and tablename = 'platebni_ucty')
           = array['platebni_ucty_insert:INSERT', 'platebni_ucty_read:SELECT',
                   'platebni_ucty_spravce_cte:SELECT', 'platebni_ucty_update:UPDATE'], false));
select pg_temp.check('politika úpravy: Správa financí za celou firmu, pobočka NULL — před i po změně',
  (select qual ~ 'finance\.manage''::text, NULL' and with_check ~ 'finance\.manage''::text, NULL'
     from pg_policies where schemaname = 'public' and tablename = 'platebni_ucty'
      and policyname = 'platebni_ucty_update'));
select pg_temp.check('sloupcový grant: přihlášený mění jen název, pobočku, číslo a aktivní',
  has_column_privilege('authenticated', 'public.platebni_ucty', 'nazev', 'UPDATE')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'branch_id', 'UPDATE')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'cislo_uctu', 'UPDATE')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'aktivni', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.platebni_ucty', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'tenant_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'typ', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'mena', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'pocatecni_zustatek_haleru', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'created_at', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.platebni_ucty', 'DELETE')
  and not has_table_privilege('anon', 'public.platebni_ucty', 'UPDATE'));
select pg_temp.check('sloupcový grant založení: přihlášený zakládá jen firmu, pobočku, název, typ a číslo',
  not has_table_privilege('authenticated', 'public.platebni_ucty', 'INSERT')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'tenant_id', 'INSERT')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'branch_id', 'INSERT')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'nazev', 'INSERT')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'typ', 'INSERT')
  and has_column_privilege('authenticated', 'public.platebni_ucty', 'cislo_uctu', 'INSERT')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'pocatecni_zustatek_haleru', 'INSERT')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'mena', 'INSERT')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'aktivni', 'INSERT')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.platebni_ucty', 'created_at', 'INSERT')
  and not has_table_privilege('anon', 'public.platebni_ucty', 'INSERT'));


\echo ''
\echo '== 3. Účet se živým připojením banky nejde vypnout ======================'

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id)
values (:'firma', 'banka', 'krok113-banka', 'zakaznicky', 'Krok113 banka', 'pripojeno', :'u_spoj')
returning id as pr_banka \gset

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('účet se živým připojením nejde vypnout: 23514',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_spoj'),
    '23514', 'nejdřív ho v Integracích odpojte'));
select pg_temp.check('… přejmenovat ho jde, spoušť hlídá jen vypnutí',
  pg_temp.zmeneno(format('update public.platebni_ucty set nazev = %L where id = %L', 'Krok113 účet s připojením 2', :'u_spoj')) = 1);
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… ani vlastník databáze ho nevypne, je to spoušť, ne politika',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_spoj'),
    '23514', 'nejdřív ho v Integracích odpojte'));

update public.integrace_pripojeni set stav = 'odpojeno' where id = :'pr_banka';
select pg_temp.check('… ani když má připojení jen stav odpojeno, bez času odpojení',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_spoj'),
    '23514', 'nejdřív ho v Integracích odpojte'));
update public.integrace_pripojeni set stav = 'pripojeno', odpojeno_kdy = now() where id = :'pr_banka';
select pg_temp.check('… ani když má jen čas odpojení, stav ne',
  pg_temp.spadne_hlaskou(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_spoj'),
    '23514', 'nejdřív ho v Integracích odpojte'));
update public.integrace_pripojeni set stav = 'odpojeno' where id = :'pr_banka';

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('po úplném odpojení účet vypnout jde a znovu zapnout taky',
  pg_temp.zmeneno(format('update public.platebni_ucty set aktivni = false where id = %L', :'u_spoj')) = 1
  and pg_temp.zmeneno(format('update public.platebni_ucty set aktivni = true where id = %L', :'u_spoj')) = 1);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 3b. K vypnutému účtu nejde živé připojení banky ======================'

-- Druhá strana téhož pravidla: k vypnutému účtu Cyrila nejde připojení
-- založit, přesměrovat ho na něj ani vrátit odpojené do živého stavu.
-- Jako vlastník databáze (spoušť platí všem), jedno i pod přihlášenou
-- majitelkou. Každé připojení má vlastního poskytovatele — živé smí být
-- jen jedno na firmu a poskytovatele (index integrace_pripojeni_zive).
select pg_temp.check('příprava 3b: účet Cyrila je vypnutý, účet Bety zapnutý',
  (select not aktivni from public.platebni_ucty where id = :'u_cyril')
  and (select aktivni from public.platebni_ucty where id = :'u_beta'));

select pg_temp.check('k vypnutému účtu nejde založit živé připojení: 23514',
  pg_temp.spadne_hlaskou(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma', 'banka', 'krok113-k-vypnutemu', 'zakaznicky', 'Krok113 k vypnutému', 'pripojuje_se', :'u_cyril'),
    '23514', 'Platební účet je vypnutý'));

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('… ani přihlášená majitelka, s větou, co udělat',
  pg_temp.spadne_hlaskou(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma', 'banka', 'krok113-k-vypnutemu-appka', 'zakaznicky', 'Krok113 k vypnutému z appky', 'pripojeno', :'u_cyril'),
    '23514', 'nejdřív ho v Platbách zapněte'));
reset role;
select set_config('test.user_id', '', false);

-- Odpojené připojení (historie) k vypnutému účtu nevadí.
select pg_temp.check('odpojené připojení k vypnutému účtu spoušť pustí: historie',
  pg_temp.projde(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id, odpojeno_kdy) values (%L, %L, %L, %L, %L, %L, %L, now())',
    :'firma', 'banka', 'krok113-odpojene', 'zakaznicky', 'Krok113 odpojené', 'odpojeno', :'u_cyril')));
select id as pr_odpojene from public.integrace_pripojeni
 where tenant_id = :'firma' and poskytovatel = 'krok113-odpojene' \gset
select pg_temp.check('odpojené připojení na vypnutém účtu nejde vrátit stavem do živého: 23514',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set stav = %L where id = %L', 'pripojeno', :'pr_odpojene'),
    '23514', 'Platební účet je vypnutý'));
select pg_temp.check('… ani smazáním času odpojení: 23514',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set odpojeno_kdy = null where id = %L', :'pr_odpojene'),
    '23514', 'Platební účet je vypnutý'));

-- Živé připojení na zapnutém účtu Bety (dnešní tvar: připojeno, bez času
-- odpojení) spoušť přijme a nezmění; přesměrovat na vypnutý účet nejde.
select pg_temp.check('živé připojení k zapnutému účtu Bety spoušť pustí',
  pg_temp.projde(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma', 'banka', 'krok113-beta', 'zakaznicky', 'Krok113 Beta', 'pripojeno', :'u_beta')));
select id as pr_beta from public.integrace_pripojeni
 where tenant_id = :'firma' and poskytovatel = 'krok113-beta' \gset
select pg_temp.check('… a nezměnila ho: připojeno, bez času odpojení, na účtu Bety',
  exists (select 1 from public.integrace_pripojeni
           where id = :'pr_beta' and stav = 'pripojeno' and odpojeno_kdy is null and platebni_ucet_id = :'u_beta'));
select pg_temp.check('živé připojení nejde přesměrovat na vypnutý účet: 23514',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set platebni_ucet_id = %L where id = %L', :'u_cyril', :'pr_beta'),
    '23514', 'Platební účet je vypnutý'));
select pg_temp.check('… synchronizace mu na zapnutém účtu stav mění dál: 1 řádek',
  pg_temp.zmeneno(format('update public.integrace_pripojeni set stav = %L where id = %L', 'chyba', :'pr_beta')) = 1);

-- Staré živé připojení na vypnutém účtu (z doby před spouští — vloží se
-- s vypnutou spouští): synchronizace mu dál mění stav a odpojit ho jde.
alter table public.integrace_pripojeni disable trigger trg_pripojeni_vypnuteho_uctu;
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id)
values (:'firma', 'banka', 'krok113-stare', 'zakaznicky', 'Krok113 staré', 'pripojeno', :'u_cyril')
returning id as pr_stare \gset
alter table public.integrace_pripojeni enable trigger trg_pripojeni_vypnuteho_uctu;
select pg_temp.check('staré živé připojení na vypnutém účtu: synchronizace mu mění stav — 1 řádek, dvakrát',
  pg_temp.zmeneno(format('update public.integrace_pripojeni set stav = %L, posledni_chyba = %L where id = %L', 'chyba', 'Krok113 výpadek', :'pr_stare')) = 1
  and pg_temp.zmeneno(format('update public.integrace_pripojeni set stav = %L, posledni_chyba = null where id = %L', 'pripojeno', :'pr_stare')) = 1);
select pg_temp.check('… a odpojit ho jde: 1 řádek',
  pg_temp.zmeneno(format('update public.integrace_pripojeni set stav = %L, odpojeno_kdy = now() where id = %L', 'odpojeno', :'pr_stare')) = 1);

-- Vlastní filtr firmy ve spoušti (definer, RLS tu neplatí): bez spouště
-- z kroku 1 se vypnutý účet CIZÍ firmy spoušti nepočítá — kdyby ho četla,
-- odmítla by připojení svou větou.
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, aktivni)
values (:'firma_b', null, 'Krok113 vypnutý účet cizí firmy', 'banka', false) returning id as u_cizi_vypnuty \gset
alter table public.integrace_pripojeni disable trigger trg_firma_integrace_pripojeni;
select pg_temp.check('bez spouště kroku 1: vypnutý účet cizí firmy spoušť připojení nečte, firmu filtruje sama',
  pg_temp.projde(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L, %L)',
    :'firma', 'banka', 'krok113-cizi-ucet', 'zakaznicky', 'Krok113 cizí účet', 'pripojeno', :'u_cizi_vypnuty')));
delete from public.integrace_pripojeni where tenant_id = :'firma' and poskytovatel = 'krok113-cizi-ucet';
alter table public.integrace_pripojeni enable trigger trg_firma_integrace_pripojeni;

select pg_temp.check('spouště připojení jsou zase zapnuté',
  (select count(*) from pg_trigger
    where tgrelid = 'public.integrace_pripojeni'::regclass
      and tgname in ('trg_firma_integrace_pripojeni', 'trg_pripojeni_vypnuteho_uctu')
      and tgenabled = 'O') = 2);
select pg_temp.check('spoušť připojení zamyká řádek účtu proti souběžnému vypnutí: for share',
  (select prosrc ilike '%for share%' from pg_proc where oid = 'app.hlida_pripojeni_vypnuteho_uctu()'::regprocedure));
select pg_temp.check('funkce spouští vypnutého účtu přihlášený ani anonym přímo nespustí',
  not has_function_privilege('authenticated', 'app.hlida_pripojeni_vypnuteho_uctu()', 'execute')
  and not has_function_privilege('authenticated', 'app.hlida_vypnuti_platebniho_uctu()', 'execute')
  and not has_function_privilege('anon', 'app.hlida_pripojeni_vypnuteho_uctu()', 'execute')
  and not has_function_privilege('authenticated', 'app.pripojeni_je_zive(text, timestamptz)', 'execute'));


\echo ''
\echo '== 3c. Na vypnutý účet přihlášený platbu nezapíše ======================='

-- Pravidlo „na vypnutý účet nic" drží databáze, ne jen appka: přímý zápis
-- přes REST i import výpisu (importovat_vypis, importovat_transakce) pod
-- přihlášeným skončí 23514. Služba zapisuje dál — tady jako vlastník
-- databáze, stejně jako v krok111 (čistý harness nedává service_role
-- zápis do transakce): staré živé připojení na vypnutém účtu stahuje dál.
insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, stav)
values (:'firma', 'pokladna_csv', 'krok113-3c-pokladna.csv', 'krok113-3c-davka', 'zpracovano') returning id as d_3c \gset

select pg_temp.check('příprava 3c: účet Cyrila je vypnutý a nemá žádnou platbu, účet Bety je zapnutý',
  (select not aktivni from public.platebni_ucty where id = :'u_cyril')
  and not exists (select 1 from public.transakce where ucet_id = :'u_cyril')
  and (select aktivni from public.platebni_ucty where id = :'u_beta'));

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitelka přímým zápisem nezapíše platbu na vypnutý účet: 23514',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj) values (%L, %L, %L, 12345, %L, %L)',
    :'firma', :'u_cyril', 'prijem', '2033-03-01', 'rucni'),
    '23514', 'platbu na něj zapsat nejde'));
select pg_temp.check('… ani importem výpisu přes importovat_vypis: 23514',
  pg_temp.spadne_hlaskou(format('select * from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma', :'u_cyril', 'csv_banka', 'krok113-3c.csv', 'krok113-3c-vypis',
    '[{"datum":"2033-03-02","smer":"prijem","castka_haleru":500,"mena":"CZK","protistrana":"Krok113 3c","protiucet":"","vs":"","poznamka":""}]'),
    '23514', 'platbu na něj zapsat nejde'));

select set_config('test.user_id', :'spr_firma', false);
-- Uzávěrka pokladny (csv_pokladna) jde jen přes importovat_transakce —
-- druhý zdroj importu, ať pravidlo nehlídá jen výpis z banky.
select pg_temp.check('správce celé firmy, ne majitelka, nezapíše na vypnutý účet ani uzávěrku pokladny přes importovat_transakce: 23514',
  pg_temp.spadne_hlaskou(format('select public.importovat_transakce(%L, %L, %L, %L, %L::jsonb)',
    :'firma', :'u_cyril', :'d_3c', 'csv_pokladna',
    '[{"datum":"2033-03-03","smer":"vydaj","castka_haleru":700,"mena":"CZK","protistrana":"Krok113 3c","protiucet":"","vs":"","poznamka":""}]'),
    '23514', 'platbu na něj zapsat nejde'));

-- Zkouška 11: ruční platba v tvaru, v jakém ji zapisuje appka
-- (zapsatTransakci: prázdná protistrana a VS, bez dávky a id od banky),
-- na zapnutý účet projde a spoušť ji nezmění.
select set_config('test.user_id', :'maj', false);
select pg_temp.check('na zapnutý účet Bety zapíše majitelka ruční platbu v dnešním tvaru appky',
  pg_temp.projde(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, poznamka, zdroj) values (%L, %L, %L, 4321, %L, %L, %L, %L, %L)',
    :'firma', :'u_beta', 'vydaj', '2033-03-04', '', '', 'Krok113 3c živý tvar', 'rucni')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… a spoušť ji nezměnila: částka, měna CZK, prázdná protistrana a VS, bez dávky, id od banky a storna',
  exists (select 1 from public.transakce
           where ucet_id = :'u_beta' and poznamka = 'Krok113 3c živý tvar'
             and tenant_id = :'firma' and smer = 'vydaj' and castka_haleru = 4321 and mena = 'CZK'
             and datum = '2033-03-04' and protistrana = '' and vs = '' and protiucet = '' and zdroj = 'rucni'
             and externi_id is null and import_davka_id is null and storno_of is null));

-- Import a kontrola ve DVOU příkazech: dotaz `exists` ve stejném příkazu
-- jako volání importu by řádek, který import teprve zapisuje, neviděl
-- (snímek dat je ze začátku příkazu).
select pg_temp.novych(format('select pocet_novych from public.importovat_vypis(%L, %L, %L, %L, %L, %L::jsonb)',
    :'firma', :'u_cyril', 'banka_api', 'krok113-3c-api', 'krok113-3c-api',
    '[{"datum":"2033-03-05","smer":"prijem","castka_haleru":900,"mena":"CZK","protistrana":"Krok113 banka","protiucet":"","vs":"","poznamka":"","externi_id":"krok113-3c-x1"}]'))
  as n_3c_sluzba \gset
select pg_temp.check('služba zapisuje na vypnutý účet dál: stažení z banky přes importovat_vypis, 1 nový pohyb — naměřeno: ' || :'n_3c_sluzba',
  :'n_3c_sluzba'::integer = 1
  and exists (select 1 from public.transakce
               where ucet_id = :'u_cyril' and externi_id = 'krok113-3c-x1' and zdroj = 'banka_api' and castka_haleru = 900));
select pg_temp.check('po odmítnutých zápisech na vypnutém účtu nezůstalo nic: jen pohyb služby, dávka importovat_vypis se nezaložila',
  (select count(*) from public.transakce where ucet_id = :'u_cyril') = 1
  and not exists (select 1 from public.import_davky where tenant_id = :'firma' and soubor_hash = 'krok113-3c-vypis')
  and (select pocet_novych from public.import_davky where id = :'d_3c') = 0);

-- tgtype: 1 = pro každý řádek, 2 = před zápisem, 4 = při založení.
select pg_temp.check('spoušť zápisu na vypnutý účet: před založením platby, s právy volajícího, přihlášený ani anonym ji přímo nespustí',
  exists (select 1 from pg_trigger t
           where t.tgrelid = 'public.transakce'::regclass and t.tgname = 'trg_zapis_na_vypnuty_ucet'
             and t.tgenabled = 'O' and t.tgfoid = 'app.hlida_zapis_na_vypnuty_ucet()'::regprocedure
             and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4)
  and not (select prosecdef from pg_proc where oid = 'app.hlida_zapis_na_vypnuty_ucet()'::regprocedure)
  and not has_function_privilege('authenticated', 'app.hlida_zapis_na_vypnuty_ucet()', 'execute')
  and not has_function_privilege('anon', 'app.hlida_zapis_na_vypnuty_ucet()', 'execute'));


\echo ''
\echo '== 3d. Společný firemní účet: jen ano, nebo ne =========================='

-- Rozhodnutí Šéfíka 25. 11. (otázky 98 a 114): pobočky platí přes jeden
-- firemní účet bez pobočky. Appka potřebuje jen ANO/NE „firma má aktivní
-- firemní účet" — i na pobočce, kde firemní účet přes RLS vidět není.
-- Funkce je SECURITY DEFINER: RLS v ní neplatí, firmu, firemní účet
-- a aktivní si filtruje sama. Každý filtr proto má vlastní kontrolu.
--
-- Firma A má aktivní firemní účet (firemní účet z přípravy a firemní
-- z formuláře). Firma B se tu staví krok za krokem: bez jediného účtu,
-- jen vypnutý firemní, jen pobočkový, pak aktivní firemní a jeho vypnutí.
-- Účty firmy B zakládá vlastník databáze (Bohdan by vypnutý účet ani
-- přímým zápisem nezaložil — sloupcový grant), ptá se přihlášený Bohdan.
reset role;
select set_config('test.user_id', '', false);
delete from public.platebni_ucty where tenant_id = :'firma_b';
select pg_temp.check('příprava 3d: firma A má aktivní firemní účet, firma B žádný účet',
  exists (select 1 from public.platebni_ucty where tenant_id = :'firma' and branch_id is null and aktivni)
  and not exists (select 1 from public.platebni_ucty where tenant_id = :'firma_b'));

set role authenticated;
select set_config('test.user_id', :'maj', false);
select pg_temp.check('majitelka A: firma má aktivní firemní účet, ano — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.firemni(:'firma') = 'ano');
select set_config('test.user_id', :'cte_firma', false);
select pg_temp.check('čtenář celé firmy: ano — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.firemni(:'firma') = 'ano');

-- Pavla má finance.read jen na Betě: odpověď dostane, řádek účtu ne.
select set_config('test.user_id', :'cte_pob', false);
select pg_temp.check('čtenář pobočky dostane odpověď, ano — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.firemni(:'firma') = 'ano');
select pg_temp.check('… ale řádek firemního účtu, jeho název ani číslo dál nevidí — ověří CI',
  not exists (select 1 from public.platebni_ucty where tenant_id = :'firma' and branch_id is null));
select set_config('test.user_id', :'spr_pob', false);
select pg_temp.check('správce pobočky: ano — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.firemni(:'firma') = 'ano');

-- Bez finance.read v té firmě 42501 — ne „ne", které by se tvářilo jako
-- odpověď.
select set_config('test.user_id', :'jen_sprava', false);
select pg_temp.check('jen správa na Betě, bez finance.read: 42501 — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.spadne_hlaskou(format('select public.firma_ma_firemni_ucet(%L)', :'firma'), '42501', 'Nemáte oprávnění'));
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma: 42501 — naměřeno: ' || pg_temp.firemni(:'firma'),
  pg_temp.spadne_hlaskou(format('select public.firma_ma_firemni_ucet(%L)', :'firma'), '42501', 'Nemáte oprávnění'));
select set_config('test.user_id', :'maj', false);
select pg_temp.check('prázdná firma: 42501 — naměřeno: ' || pg_temp.firemni(null),
  pg_temp.spadne_hlaskou('select public.firma_ma_firemni_ucet(null)', '42501', 'Nemáte oprávnění'));

-- Firma B bez jediného účtu: aktivní firemní účet firmy A se jí nesmí
-- započítat — filtr firmy ve funkci, RLS ho uvnitř definer neudělá.
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('firma B bez jediného účtu: ne, firemní účet firmy A se nepočítá — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');
-- Pobočkový čtenář dostane i „ne" — odpověď se pro něj nezjednodušuje
-- na „ano" (revize 3d). Gabriela má finance.read jen na Gamě.
select set_config('test.user_id', :'cte_pob_b', false);
select pg_temp.check('čtenářka pobočky Gama, firma B bez jediného účtu: ne — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');

reset role;
select set_config('test.user_id', '', false);
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ, aktivni)
values (:'firma_b', null, 'Krok113 3d vypnutý firemní B', 'banka', false) returning id as u_b_vypnuty \gset
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('jen vypnutý firemní účet: ne, vypnutý je jako žádný — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');
select set_config('test.user_id', :'cte_pob_b', false);
select pg_temp.check('čtenářka pobočky Gama, jen vypnutý firemní účet: ne — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');

reset role;
select set_config('test.user_id', '', false);
delete from public.platebni_ucty where id = :'u_b_vypnuty';
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_b', :'pg', 'Krok113 3d účet Gamy', 'banka') returning id as u_b_gama \gset
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('jen aktivní účet pobočky: ne, účet pobočky není firemní — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');
-- Účet Gamy Gabriela vidí (je její pobočky) — firemní z něj být nesmí.
select set_config('test.user_id', :'cte_pob_b', false);
select pg_temp.check('čtenářka pobočky Gama, jen aktivní účet její pobočky: ne, účet pobočky není firemní — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');

reset role;
select set_config('test.user_id', '', false);
insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'firma_b', null, 'Krok113 3d firemní B', 'banka') returning id as u_b_firemni \gset
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('aktivní firemní účet přibude: ano hned — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ano');
select set_config('test.user_id', :'cte_pob_b', false);
select pg_temp.check('čtenářka pobočky Gama, aktivní firemní účet přibude: ano — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ano');

reset role;
select set_config('test.user_id', '', false);
update public.platebni_ucty set aktivni = false where id = :'u_b_firemni';
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('firemní účet se vypne: ne hned — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');
select set_config('test.user_id', :'cte_pob_b', false);
select pg_temp.check('čtenářka pobočky Gama, firemní účet se vypne: ne — naměřeno: ' || pg_temp.firemni(:'firma_b'),
  pg_temp.firemni(:'firma_b') = 'ne');

set role anon;
select pg_temp.check('anonym funkci nespustí: permission denied — ověří CI',
  pg_temp.spadne_hlaskou(format('select public.firma_ma_firemni_ucet(%L)', :'firma'), '42501', 'permission denied'));

reset role;
select set_config('test.user_id', '', false);

-- Katalog až za chováním.
select pg_temp.check('funkce vrací jen boolean, ne řádky — nic o čísle, názvu ani zůstatku účtu',
  (select prorettype = 'boolean'::regtype and not proretset
     from pg_proc where oid = 'public.firma_ma_firemni_ucet(uuid)'::regprocedure));
select pg_temp.check('funkce běží s právy vlastníka a prázdnou search_path, přihlášený ji spustí, anonym ani public ne',
  (select coalesce(prosecdef and proconfig = array['search_path=""'], false)
     from pg_proc where oid = 'public.firma_ma_firemni_ucet(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.firma_ma_firemni_ucet(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.firma_ma_firemni_ucet(uuid)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.firma_ma_firemni_ucet(uuid)'::regprocedure
                     and a.grantee = 0 and a.privilege_type = 'EXECUTE'));


\echo ''
\echo '== 4. Zkouška 11: živé tvary účtů beze změny ============================'

select md5(string_agg(u::text, '|' order by u.id)) as otisk_po
  from public.platebni_ucty u where u.id in (:'u_firma', :'u_beta') \gset
select pg_temp.check('firemní účet a účet Bety po všech zkouškách beze změny',
  :'otisk_pred' = :'otisk_po');


\echo ''
\echo '== Úklid ================================================================'

delete from public.integrace_pripojeni where tenant_id in (:'firma', :'firma_b');
delete from public.transakce where tenant_id in (:'firma', :'firma_b');
delete from public.import_davky where tenant_id in (:'firma', :'firma_b');
delete from public.platebni_ucty where tenant_id in (:'firma', :'firma_b');
-- Majitelé, jejich firmy a pobočky zůstávají (jako v krocích 103 až 112):
-- posledního majitele firmy pojistka smazat nedovolí. Ostatní lidé pryč.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'firma'
                            and user_id in (:'spr_pob', :'cte_pob', :'cte_firma', :'spr_firma', :'jen_sprava'));
delete from public.memberships
 where tenant_id = :'firma' and user_id in (:'spr_pob', :'cte_pob', :'cte_firma', :'spr_firma', :'jen_sprava');
delete from public.employees where id in (:'e_spr_pob', :'e_cte_pob', :'e_cte_firma', :'e_spr_firma', :'e_jen_sprava');
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'firma_b' and user_id = :'cte_pob_b');
delete from public.memberships where tenant_id = :'firma_b' and user_id = :'cte_pob_b';
delete from public.employees where id = :'e_cte_pob_b';
delete from public.position_permissions where position_id in (:'z_sprava', :'z_cteni', :'z_jen_sprava', :'z_cteni_b');
delete from public.positions where id in (:'z_sprava', :'z_cteni', :'z_jen_sprava', :'z_cteni_b');

select pg_temp.check('úklid: účty, platby, dávky a připojení kroku 113 pryč, spouště účtu zapnuté',
  not exists (select 1 from public.platebni_ucty where tenant_id in (:'firma', :'firma_b'))
  and not exists (select 1 from public.transakce where tenant_id in (:'firma', :'firma_b'))
  and not exists (select 1 from public.import_davky where tenant_id in (:'firma', :'firma_b'))
  and not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'firma', :'firma_b'))
  and (select count(*) from pg_trigger
        where tgrelid = 'public.platebni_ucty'::regclass
          and tgname in ('trg_firma_platebniho_uctu', 'trg_vypnuti_platebniho_uctu')
          and tgenabled = 'O') = 2
  and (select count(*) from pg_trigger
        where tgrelid = 'public.integrace_pripojeni'::regclass
          and tgname in ('trg_firma_integrace_pripojeni', 'trg_pripojeni_vypnuteho_uctu')
          and tgenabled = 'O') = 2);

\echo ''
\echo '== KROK 113 HOTOV ========================================'
