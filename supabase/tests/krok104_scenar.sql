-- Scénář pro krok 104 — Rezervace: univerzální příjmové API.
--
-- Pokrývá migraci 20261030100000_rezervace_prijem.sql
-- (`rezervace_prijmout`, rozšířené `rezervace_napojeni`).
--
-- Navazuje na etapa0_scenar.sql až krok103_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. první úspěšná dávka zapíše rezervace A TEPRVE PAK přepne připojení
--      na „připojeno“ (s posledni_test_ok) — v jedné transakci;
--   2. dávka, která spadne, nepřepne nic (připojení zůstane „čeká“);
--   3. zápis jde jen přes připojení příjmového API (`obecne`, oblast
--      rezervace, nepojené) — adaptér ani pokladna to nejsou;
--   4. jméno systému z dávky páruje s CSV téhož systému — nic se nezdvojí;
--   5. jméno systému musí být krátké;
--   6. granty: jen service_role;
--   7. poslední chybu ve stavu napojení vidí jen správce napojení.

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

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

\set ctenar 10410000-0000-0000-0000-000000000001
\set zapis 10410000-0000-0000-0000-000000000002

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ctenar', 'ctenar104@foodtab.cz', '{"full_name":"Cecílie Stoctyri"}'),
  (:'zapis',  'zapis104@foodtab.cz',  '{"full_name":"Zdeněk Stoctyri"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska104_cteni', 'Zkouška 104 — čtení', 'servis', true) returning id as z_cteni \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska104_zapis', 'Zkouška 104 — zápis', 'provoz', true) returning id as z_zapis \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_cteni', 'rezervace.read'),
  (:'tenant', :'z_zapis', 'rezervace.manage');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'ctenar', :'z_cteni', 'Cecílie Stoctyri', 'hpp') returning id as e_ctenar \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'zapis', :'z_zapis', 'Zdeněk Stoctyri', 'hpp') returning id as e_zapis \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', :'ctenar', null, 'branch', 'active'),
  (:'tenant', :'zapis',  null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid from public.memberships m
 where m.tenant_id = :'tenant' and m.user_id in (:'ctenar', :'zapis');

insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'obecne', 'zakaznicky', 'Příjmové API Krok104') returning id as prijem \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'obecne', 'zakaznicky', 'Příjmové API Krok104 druhé') returning id as prijem2 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'thefork', 'zakaznicky', 'TheFork Krok104') returning id as adapter \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'pokladna', 'obecne', 'zakaznicky', 'Pokladna Krok104') returning id as pokladna \gset

select '[{"externi_id":"CH-1","stav":"potvrzeno","stav_zdroje":"confirmed","zacatek":"2026-11-25T19:00:00+01:00","konec":"","zmeneno_kdy":"2026-11-02T10:00:00Z","jmeno_hosta":"Choice Krok104","pocet_osob":"4","telefon":"","email":"","poznamka":"","prostor":""},{"externi_id":"CH-2","stav":"ceka","stav_zdroje":"usazeno u baru","datum":"2026-11-25","od":"20:00","do":"","jmeno_hosta":"Choice2 Krok104","pocet_osob":"","telefon":"","email":"","poznamka":"","prostor":""}]' as davka \gset
select '[{"externi_id":"CH-9","stav":"potvrzeno","zacatek":"2026-11-25T19:00:00","jmeno_hosta":"Bez pásma Krok104"}]' as spatna \gset


\echo ''
\echo '== 0. Příprava ==========================================='

select pg_temp.check('příprava: obě připojení příjmového API čekají (nepripojeno, bez testu)',
  (select bool_and(stav = 'nepripojeno' and posledni_test_ok is not true)
     from public.integrace_pripojeni where id in (:'prijem', :'prijem2')));
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('příprava: majitel spravuje napojení na Perle (integrace.manage)',
  app.has_access(:'tenant', 'integrace.manage', :'perla'));
select set_config('test.user_id', :'ctenar', false);
select pg_temp.check('příprava: čtenář rezervace vidí, napojení nespravuje',
  app.has_access(:'tenant', 'rezervace.read', :'perla') and not app.has_access(:'tenant', 'integrace.manage', :'perla'));
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Dávka, která spadne, nepřepne nic =================='

set role service_role;
select pg_temp.check('dávka s časem bez pásma spadne',
  pg_temp.spadne_hlaskou(format('select public.rezervace_prijmout(%L, %L, %L::jsonb)', :'prijem2', 'choice', :'spatna'),
    '23514', 'nemá časové pásmo'));
reset role;
select pg_temp.check('… a připojení zůstalo „čeká“ (přepnutí je v téže transakci jako zápis)',
  (select stav = 'nepripojeno' and posledni_test_ok is not true and posledni_sync_kdy is null
     from public.integrace_pripojeni where id = :'prijem2'));
select pg_temp.check('… a nezapsalo se nic',
  not exists (select 1 from public.rezervace where jmeno_hosta = 'Bez pásma Krok104'));


\echo ''
\echo '== 2. První úspěšná dávka ================================'

set role service_role;
select public.rezervace_prijmout(:'prijem', 'choice', :'davka'::jsonb)::text as vysledek1 \gset
select public.rezervace_prijmout(:'prijem', 'choice', :'davka'::jsonb)::text as vysledek2 \gset
reset role;

select pg_temp.check('první dávka: dvě nové rezervace',
  (:'vysledek1'::jsonb ->> 'nove')::int = 2);
select pg_temp.check('tatáž dávka podruhé nic nezdvojí',
  (:'vysledek2'::jsonb ->> 'nove')::int = 0 and (:'vysledek2'::jsonb ->> 'beze_zmeny')::int = 2
  and (select count(*) from public.rezervace where jmeno_hosta like 'Choice%Krok104') = 2);
select pg_temp.check('po úspěšné dávce je připojení „připojeno“ s ověřením, časem a počtem',
  (select stav = 'pripojeno' and posledni_test_ok and posledni_sync_kdy is not null and posledni_sync_pocet_radku = 2
          and posledni_chyba is null
     from public.integrace_pripojeni where id = :'prijem'));
select pg_temp.check('rezervace mají systém z dávky (choice), zdroj „externí“ a odkaz na připojení',
  (select bool_and(poskytovatel = 'choice' and zdroj = 'externi' and pripojeni_id = :'prijem'::uuid)
     from public.rezervace where jmeno_hosta like 'Choice%Krok104'));
select pg_temp.check('neznámý stav přišel jako předběžná a původní slovo zůstalo',
  (select stav = 'ceka' and stav_zdroje = 'usazeno u baru' from public.rezervace where externi_id = 'CH-2' and poskytovatel = 'choice'));
select pg_temp.check('datum + od jako čas na pobočce (zima, UTC+1)',
  (select zacatek = timestamptz '2026-11-25 20:00:00+01' from public.rezervace where externi_id = 'CH-2' and poskytovatel = 'choice'));


\echo ''
\echo '== 3. Systém z dávky páruje s CSV téhož systému =========='

set role authenticated;
select set_config('test.user_id', :'zapis', false);
select public.rezervace_importovat_csv(:'tenant', :'perla', 'choice',
  '[{"externi_id":"CH-1","stav":"potvrzeno","stav_zdroje":"confirmed","datum":"2026-11-25","od":"19:00","do":"","jmeno_hosta":"Choice Krok104","pocet_osob":"4","telefon":"","email":"","poznamka":"","prostor":""}]'::jsonb)::text as csv1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('CSV z Choice s týmž číslem nezaložilo druhou rezervaci',
  (:'csv1'::jsonb ->> 'nove')::int = 0
  and (select count(*) from public.rezervace where externi_id = 'CH-1' and poskytovatel = 'choice') = 1);


\echo ''
\echo '== 4. Jen připojení příjmového API ======================='

set role service_role;
select pg_temp.check('připojení adaptéru (thefork) přes příjem nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_prijmout(%L, %L, %L::jsonb)', :'adapter', 'choice', :'davka'),
    'P0002', 'neexistuje nebo je odpojené'));
select pg_temp.check('připojení pokladny (obecne) přes příjem rezervací nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_prijmout(%L, %L, %L::jsonb)', :'pokladna', 'choice', :'davka'),
    'P0002', 'neexistuje nebo je odpojené'));
select pg_temp.check('jméno systému musí být krátké',
  pg_temp.spadne_hlaskou(format('select public.rezervace_prijmout(%L, %L, %L::jsonb)', :'prijem', 'Choice!', :'davka'),
    '23514', 'Jméno systému'));
reset role;

update public.integrace_pripojeni set odpojeno_kdy = now(), stav = 'odpojeno' where id = :'prijem2';
set role service_role;
select pg_temp.check('odpojené připojení příjmu už nic nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_prijmout(%L, %L, %L::jsonb)', :'prijem2', 'choice', :'davka'),
    'P0002', 'neexistuje nebo je odpojené'));
reset role;


\echo ''
\echo '== 5. Poslední chyba jen pro správce napojení ============'

update public.integrace_pripojeni set posledni_chyba = 'Poslední dávka odmítnuta: zkouška Krok104' where id = :'prijem';

set role authenticated;
select set_config('test.user_id', :'ctenar', false);
select pg_temp.check('čtenář napojení vidí, ale chybu ne',
  (select count(*) from public.rezervace_napojeni(:'tenant') where id = :'prijem' and posledni_chyba is null) = 1);
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('správce napojení chybu vidí, i počet posledních rezervací',
  (select count(*) from public.rezervace_napojeni(:'tenant')
    where id = :'prijem' and posledni_chyba like '%Krok104%' and posledni_sync_pocet_radku = 2) = 1);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 6. Granty ============================================='

select pg_temp.check('příjem volá jen server (service_role), přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_prijmout(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_prijmout(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_prijmout(uuid, text, jsonb)', 'execute'));
select pg_temp.check('stav napojení smí přihlášený, anonym ne',
  has_function_privilege('authenticated', 'public.rezervace_napojeni(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_napojeni(uuid)', 'execute'));


\echo ''
\echo '== Úklid ================================================='

delete from public.rezervace_kontakty
 where rezervace_id in (select id from public.rezervace where jmeno_hosta like '%Krok104');
delete from public.rezervace where jmeno_hosta like '%Krok104';
delete from public.integrace_pripojeni where id in (:'prijem', :'prijem2', :'adapter', :'pokladna');
delete from public.membership_branches
 where membership_id in (select id from public.memberships where user_id in (:'ctenar', :'zapis'));
delete from public.memberships where user_id in (:'ctenar', :'zapis');
delete from public.employees where id in (:'e_ctenar', :'e_zapis');
delete from public.position_permissions where position_id in (:'z_cteni', :'z_zapis');
delete from public.positions where id in (:'z_cteni', :'z_zapis');

select pg_temp.check('úklid: po scénáři nezůstalo nic z kroku 104',
  not exists (select 1 from public.rezervace where jmeno_hosta like '%Krok104')
  and not exists (select 1 from public.integrace_pripojeni where nazev like '%Krok104%')
  and not exists (select 1 from public.employees where full_name like '%Stoctyri'));

\echo ''
\echo '== KROK 104 HOTOV ========================================'
