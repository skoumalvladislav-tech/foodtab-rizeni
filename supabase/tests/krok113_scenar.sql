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
--      * správce celé firmy (ne majitel) přesune účet ze smazané pobočky;
--      * měnu, typ ani firmu účtu přihlášený nezmění (sloupcový grant)
--        — ověří CI; katalog grantů a politik ověří i PGlite;
--   3. účet, na který míří živé připojení banky, nejde vypnout
--      (spoušť platí i pro vlastníka databáze); po úplném odpojení ano;
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
-- Firma B (cizí): Bohdan — majitel; pobočka Gama bez účtu.
-- =====================================================================

\set maj       11130000-0000-0000-0000-000000000001
\set spr_pob   11130000-0000-0000-0000-000000000002
\set cte_pob   11130000-0000-0000-0000-000000000003
\set cte_firma 11130000-0000-0000-0000-000000000004
\set spr_firma 11130000-0000-0000-0000-000000000005
\set jen_sprava 11130000-0000-0000-0000-000000000006
\set cizi      11130000-0000-0000-0000-000000000007

insert into auth.users (id, email, raw_user_meta_data) values
  (:'maj',        'marie113@foodtab.cz',  '{"full_name":"Marie Stotřináctá"}'),
  (:'spr_pob',    'petr113@foodtab.cz',   '{"full_name":"Petr Stotřináctý"}'),
  (:'cte_pob',    'pavla113@foodtab.cz',  '{"full_name":"Pavla Stotřináctá"}'),
  (:'cte_firma',  'filip113@foodtab.cz',  '{"full_name":"Filip Stotřináctý"}'),
  (:'spr_firma',  'simona113@foodtab.cz', '{"full_name":"Simona Stotřináctá"}'),
  (:'jen_sprava', 'jan113@foodtab.cz',    '{"full_name":"Jan Stotřináctý"}'),
  (:'cizi',       'bohdan113@foodtab.cz', '{"full_name":"Bohdan Stotřináctý"}');

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

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po zkouškách: účet Fany je na Betě, nový účet Bety je pod Betou, firemní od pobočky nevznikl',
  exists (select 1 from public.platebni_ucty where id = :'u_fany' and branch_id = :'pb')
  and exists (select 1 from public.platebni_ucty
               where tenant_id = :'firma' and branch_id = :'pb' and nazev = 'Krok113 nový účet Bety')
  and not exists (select 1 from public.platebni_ucty
                   where tenant_id = :'firma' and nazev = 'Krok113 firemní od pobočky'));

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
  and has_table_privilege('authenticated', 'public.platebni_ucty', 'INSERT')
  and not has_table_privilege('authenticated', 'public.platebni_ucty', 'DELETE')
  and not has_table_privilege('anon', 'public.platebni_ucty', 'UPDATE'));


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
\echo '== 4. Zkouška 11: živé tvary účtů beze změny ============================'

select md5(string_agg(u::text, '|' order by u.id)) as otisk_po
  from public.platebni_ucty u where u.id in (:'u_firma', :'u_beta') \gset
select pg_temp.check('firemní účet a účet Bety po všech zkouškách beze změny',
  :'otisk_pred' = :'otisk_po');


\echo ''
\echo '== Úklid ================================================================'

delete from public.integrace_pripojeni where tenant_id = :'firma' and poskytovatel = 'krok113-banka';
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
delete from public.position_permissions where position_id in (:'z_sprava', :'z_cteni', :'z_jen_sprava');
delete from public.positions where id in (:'z_sprava', :'z_cteni', :'z_jen_sprava');

select pg_temp.check('úklid: účty a připojení kroku 113 pryč, spouště účtu zapnuté',
  not exists (select 1 from public.platebni_ucty where tenant_id in (:'firma', :'firma_b'))
  and not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'firma', :'firma_b'))
  and (select count(*) from pg_trigger
        where tgrelid = 'public.platebni_ucty'::regclass
          and tgname in ('trg_firma_platebniho_uctu', 'trg_vypnuti_platebniho_uctu')
          and tgenabled = 'O') = 2);

\echo ''
\echo '== KROK 113 HOTOV ========================================'
