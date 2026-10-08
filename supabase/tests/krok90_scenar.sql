-- Scénář pro krok 90 — příjem faktur z e-mailu (evidence, kurzory, úložiště).
--
-- Migrace: 20261008100000_faktury_prijem_z_emailu.sql.
--
-- Pokrývá:
--   1. druhá linie: řádek evidence i kurzoru musí ukazovat na E-MAILOVOU
--      schránku TÉŽE firmy — cizí firma i jiná oblast spadnou;
--   2. klíč evidence: tatáž příloha téže zprávy = jeden řádek
--      (opakované načtení schránky nic nezdvojí);
--   3. kontroly hodnot (otisk, stav);
--   4. přihlášený uživatel jen ČTE, a jen s faktury.read ve SVÉ firmě;
--      zapsat, změnit, smazat ani sáhnout na kurzory nesmí nikdo kromě úlohy;
--   5. kbelík faktury-prilohy je soukromý a rozbor cesty nikdy nevyhodí
--      výjimku (politika se vyhodnocuje i nad cizími kbelíky).
--
-- Navazuje na etapa0_scenar.sql (firma "Foodtab s.r.o.").

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

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as role_jakakoli from public.roles where tenant_id = :'tenant' and key = 'bar' limit 1 \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava: druhá firma, schránky, dva uživatelé ======================'

insert into public.tenants (name) values ('Krok90 Cizí s.r.o.') returning id as cizi \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, externi_ucet)
values (:'tenant', 'email_dokladu', 'imap', 'zakaznicky', 'Krok90 faktury@', 'pripojeno',
        '{"host": "imap.krok90.cz", "port": 993, "zabezpeceni": "tls", "uzivatel": "faktury@krok90.cz"}')
returning id as schranka \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', 'pokladna', 'krok90-pokladna', 'demo', 'Krok90 pokladna')
returning id as pokladna \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav)
values (:'cizi', 'email_dokladu', 'imap', 'zakaznicky', 'Krok90 cizí schránka', 'pripojeno')
returning id as cizi_schranka \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok90_cte_faktury', 'Krok90 — čte faktury', 'provoz', true)
returning id as poz_cte \gset
insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'poz_cte', 'faktury.read');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok90_bez_faktur', 'Krok90 — bez faktur', 'provoz', true)
returning id as poz_bez \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok90_spravce', 'Krok90 — spravuje integrace i faktury', 'provoz', true)
returning id as poz_sprava \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'poz_sprava', 'integrace.manage'),
  (:'tenant', :'poz_sprava', 'faktury.manage'),
  (:'tenant', :'poz_sprava', 'faktury.read');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok90_jen_integrace', 'Krok90 — spravuje jen integrace', 'provoz', true)
returning id as poz_integrace \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'poz_integrace', 'integrace.manage');

insert into auth.users (id, email) values
  ('90900000-0000-0000-0000-000000000001', 'krok90.cte@foodtab.cz'),
  ('90900000-0000-0000-0000-000000000002', 'krok90.bez@foodtab.cz'),
  ('90900000-0000-0000-0000-000000000003', 'krok90.sprava@foodtab.cz'),
  ('90900000-0000-0000-0000-000000000004', 'krok90.integrace@foodtab.cz')
on conflict (id) do nothing;

insert into public.profiles (user_id, email, full_name) values
  ('90900000-0000-0000-0000-000000000001', 'krok90.cte@foodtab.cz', 'Krok90 ČteFaktury'),
  ('90900000-0000-0000-0000-000000000002', 'krok90.bez@foodtab.cz', 'Krok90 BezFaktur'),
  ('90900000-0000-0000-0000-000000000003', 'krok90.sprava@foodtab.cz', 'Krok90 Správce'),
  ('90900000-0000-0000-0000-000000000004', 'krok90.integrace@foodtab.cz', 'Krok90 JenIntegrace')
on conflict (user_id) do nothing;

insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '90900000-0000-0000-0000-000000000001', :'poz_cte', 'Krok90 ČteFaktury', 'hpp')
returning id as e_cte \gset
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '90900000-0000-0000-0000-000000000002', :'poz_bez', 'Krok90 BezFaktur', 'hpp')
returning id as e_bez \gset
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '90900000-0000-0000-0000-000000000003', :'poz_sprava', 'Krok90 Správce', 'hpp')
returning id as e_sprava \gset
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '90900000-0000-0000-0000-000000000004', :'poz_integrace', 'Krok90 JenIntegrace', 'hpp')
returning id as e_integrace \gset

insert into public.memberships (tenant_id, user_id, role_id, status, scope) values
  (:'tenant', '90900000-0000-0000-0000-000000000001', :'role_jakakoli', 'active', 'tenant'),
  (:'tenant', '90900000-0000-0000-0000-000000000002', :'role_jakakoli', 'active', 'tenant'),
  (:'tenant', '90900000-0000-0000-0000-000000000003', :'role_jakakoli', 'active', 'tenant'),
  (:'tenant', '90900000-0000-0000-0000-000000000004', :'role_jakakoli', 'active', 'tenant');

-- Šablona platného řádku: příloha 2 zprávy 101 ve složce INBOX.
create or replace function pg_temp.radek_sql(p_tenant uuid, p_pripojeni uuid, p_cast text, p_hash text, p_stav text)
returns text language sql as $$
  select format(
    'insert into public.faktury_prijem (tenant_id, pripojeni_id, slozka, uidvalidity, uid, priloha_cast, priloha_nazev, priloha_typ, priloha_velikost, priloha_hash, druh, stav) '
    || 'values (%L, %L, %L, %L, %s, %L, %L, %L, %s, %L, %L, %L)',
    p_tenant, p_pripojeni, 'INBOX', '1700000000', 101, p_cast, 'FV2026-001.pdf', 'application/pdf', 52000, p_hash, 'pdf', p_stav)
$$;

select repeat('a', 64) as otisk_a, repeat('b', 64) as otisk_b \gset


\echo ''
\echo '== 1. Druhá linie: schránka musí patřit firmě řádku a být e-mailová ======='

select pg_temp.check('řádek pro vlastní e-mailovou schránku projde',
  pg_temp.projde(pg_temp.radek_sql(:'tenant', :'schranka', '2', :'otisk_a', 'ceka')));

select pg_temp.check('řádek s cizí schránkou (jiná firma) spadne na 42501',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'cizi_schranka', '3', :'otisk_b', 'ceka'), '42501', 'nepatří'));

select pg_temp.check('řádek se schránkou cizí firmy pod CIZÍ firmou, ale s naší schránkou, spadne taky',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'cizi', :'schranka', '3', :'otisk_b', 'ceka'), '42501', 'nepatří'));

select pg_temp.check('řádek pro pokladnu (ne e-mailovou schránku) spadne',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'pokladna', '3', :'otisk_b', 'ceka'), '42501', 'nepatří'));

select pg_temp.check('dodatečné přepsání pripojeni_id na cizí schránku spadne (trigger i na UPDATE)',
  pg_temp.spadne_hlaskou(
    format('update public.faktury_prijem set pripojeni_id = %L where pripojeni_id = %L', :'cizi_schranka', :'schranka'),
    '42501', 'nepatří'));

select pg_temp.check('kurzor pro vlastní schránku projde',
  pg_temp.projde(format(
    'insert into public.faktury_prijem_kurzory (pripojeni_id, slozka, tenant_id, uidvalidity, posledni_uid, od) values (%L, %L, %L, %L, %s, %L)',
    :'schranka', 'INBOX', :'tenant', '1700000000', 101, '2026-01-01')));

select pg_temp.check('kurzor s cizí schránkou spadne',
  pg_temp.spadne_hlaskou(format(
    'insert into public.faktury_prijem_kurzory (pripojeni_id, slozka, tenant_id, uidvalidity, posledni_uid, od) values (%L, %L, %L, %L, %s, %L)',
    :'cizi_schranka', 'INBOX', :'tenant', '1700000000', 1, '2026-01-01'), '42501', 'nepatří'));


\echo ''
\echo '== 2. Klíč evidence: opakované načtení nic nezdvojí ======================='

select pg_temp.check('tatáž příloha téže zprávy podruhé spadne na unikátní klíč',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'schranka', '2', :'otisk_a', 'ceka'), '23505', 'faktury_prijem_jedinecna_priloha'));

select pg_temp.check('… a s "on conflict do nothing" (tak zapisuje úloha) projde bez chyby',
  pg_temp.projde(pg_temp.radek_sql(:'tenant', :'schranka', '2', :'otisk_a', 'ceka')
    || ' on conflict on constraint faktury_prijem_jedinecna_priloha do nothing'));

select pg_temp.check('… a řádek je pořád jen jeden',
  (select count(*) from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 101 and priloha_cast = '2') = 1);

select pg_temp.check('jiná příloha téže zprávy je samostatný řádek',
  pg_temp.projde(pg_temp.radek_sql(:'tenant', :'schranka', '3', :'otisk_b', 'vyzaduje_kontrolu')));


\echo ''
\echo '== 3. Kontroly hodnot ======================================================'

select pg_temp.check('otisk, který není sha256 hex, spadne',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'schranka', '4', 'neni-otisk', 'ceka'), '23514', ''));

select pg_temp.check('neznámý stav spadne',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'schranka', '4', :'otisk_b', 'smazano'), '23514', ''));

select pg_temp.check('příloha bez otisku (nestahovala se) projde',
  pg_temp.projde(replace(pg_temp.radek_sql(:'tenant', :'schranka', '5', :'otisk_b', 'existuje'), quote_literal(:'otisk_b'), 'null')));


\echo ''
\echo '== 4. Přihlášený jen čte, jen s faktury.read, jen svou firmu ==============='

-- Řádek cizí firmy (do cizí schránky) — ten nesmí být vidět nikdy.
select pg_temp.check('příprava: řádek cizí firmy',
  pg_temp.projde(pg_temp.radek_sql(:'cizi', :'cizi_schranka', '2', :'otisk_a', 'ceka')));

set role authenticated;
select set_config('test.user_id', '90900000-0000-0000-0000-000000000001', false);

select pg_temp.check('sanity: uživatel faktury.read má',
  app.has_access(:'tenant', 'faktury.read', null));

select pg_temp.check('s faktury.read vidí řádky své firmy',
  (select count(*) from public.faktury_prijem where tenant_id = :'tenant') >= 3);

select pg_temp.check('… a řádek cizí firmy NEVIDÍ',
  not exists (select 1 from public.faktury_prijem where tenant_id = :'cizi'));

select pg_temp.check('zapsat do evidence nesmí (jen úloha)',
  pg_temp.spadne_hlaskou(pg_temp.radek_sql(:'tenant', :'schranka', '9', :'otisk_b', 'ceka'), '42501', ''));

select pg_temp.check('změnit stav nesmí',
  pg_temp.spadne_hlaskou(format('update public.faktury_prijem set stav = %L where pripojeni_id = %L', 'zapsano', :'schranka'), '42501', ''));

select pg_temp.check('smazat nesmí',
  pg_temp.spadne_hlaskou(format('delete from public.faktury_prijem where pripojeni_id = %L', :'schranka'), '42501', ''));

select pg_temp.check('na kurzory nesáhne vůbec (ani číst)',
  pg_temp.spadne_hlaskou('select count(*) from public.faktury_prijem_kurzory', '42501', ''));

select set_config('test.user_id', '90900000-0000-0000-0000-000000000002', false);

select pg_temp.check('sanity: druhý uživatel faktury.read NEMÁ',
  not app.has_access(:'tenant', 'faktury.read', null));

select pg_temp.check('bez faktury.read neuvidí z evidence nic',
  not exists (select 1 from public.faktury_prijem));

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 5. Úložiště: soukromý kbelík, rozbor cesty bez výjimek ================='

select pg_temp.check('kbelík faktury-prilohy existuje a je soukromý',
  exists (select 1 from storage.buckets where id = 'faktury-prilohy' and public = false));

select pg_temp.check('platná cesta → firma',
  app.faktury_priloha_firma(:'tenant' || '/' || :'otisk_a' || '.pdf') = :'tenant'::uuid);

select pg_temp.check('cesta z cizího kbelíku (hlasovka) → null, ne výjimka',
  app.faktury_priloha_firma('ne-uuid/konverzace/zvuk.webm') is null);

select pg_temp.check('cesta s ../ → null',
  app.faktury_priloha_firma(:'tenant' || '/../' || :'otisk_a' || '.pdf') is null);

select pg_temp.check('nepovolená přípona → null',
  app.faktury_priloha_firma(:'tenant' || '/' || :'otisk_a' || '.exe') is null);

select pg_temp.check('null cesta → null',
  app.faktury_priloha_firma(null) is null);


\echo ''
\echo '== 6. Schránka: server neměnný, příjem jen přes funkci s oběma právy ======'

-- Bez téhle pojistky by kdokoli s integrace.manage přepsal server na svůj
-- a úloha by mu poslala uložené heslo schránky.
select pg_temp.check('server schránky nejde změnit (ani superuživatel)',
  pg_temp.spadne_hlaskou(format(
    'update public.integrace_pripojeni set externi_ucet = jsonb_set(externi_ucet, %L, %L) where id = %L',
    '{host}', '"imap.utocnik.example"', :'schranka'), '42501', 'nejde změnit'));

select pg_temp.check('jméno schránky nejde změnit',
  pg_temp.spadne_hlaskou(format(
    'update public.integrace_pripojeni set externi_ucet = jsonb_set(externi_ucet, %L, %L) where id = %L',
    '{uzivatel}', '"jiny@krok90.cz"', :'schranka'), '42501', 'nejde změnit'));

select pg_temp.check('e-mailová schránka nejde přepnout na jinou oblast (a pak server změnit)',
  pg_temp.spadne_hlaskou(format(
    'update public.integrace_pripojeni set oblast = %L where id = %L', 'pokladna', :'schranka'), '42501', 'Oblast'));

select pg_temp.check('ostatní údaje (počet složek, stav) se měnit dají',
  pg_temp.projde(format(
    'update public.integrace_pripojeni set stav = %L, externi_ucet = externi_ucet || %L where id = %L',
    'pripojeno', '{"pocet_slozek": 7}', :'schranka')));

set role authenticated;
select set_config('test.user_id', '90900000-0000-0000-0000-000000000003', false);

select pg_temp.check('sanity: správce má integrace.manage i faktury.manage',
  app.has_access(:'tenant', 'integrace.manage', null) and app.has_access(:'tenant', 'faktury.manage', null));

select pg_temp.check('ani správce nezapne příjem přímým zápisem (jen přes funkci)',
  pg_temp.spadne_hlaskou(format(
    'update public.integrace_pripojeni set externi_ucet = externi_ucet || %L where id = %L',
    '{"prijem_dokladu": {"zapnuto": true}}', :'schranka'), '42501', 'jen v appce'));

select pg_temp.check('ani novou schránku nezaloží rovnou se zapnutým příjmem',
  pg_temp.spadne_hlaskou(format(
    'insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, externi_ucet) values (%L, %L, %L, %L, %L, %L)',
    :'tenant', 'email_dokladu', 'imap', 'zakaznicky', 'Krok90 podvržená', '{"host": "imap.utocnik.example", "prijem_dokladu": {"zapnuto": true}}'), '42501', 'jen v appce'));

select pg_temp.check('funkce: správce zapne příjem s AI',
  (public.faktury_prijem_nastavit(:'schranka',
    '{"zapnuto": true, "od": "2026-01-01", "rezim": "automaticky", "ai": {"povoleno": true, "kdo": "podvrh", "kdy": "1999-01-01"}}'
  ) ->> 'zapnuto') = 'true');

select pg_temp.check('… souhlas s AI nese skutečného uživatele, ne podvržené „kdo"',
  (select externi_ucet -> 'prijem_dokladu' -> 'ai' ->> 'kdo' from public.integrace_pripojeni where id = :'schranka')
    = '90900000-0000-0000-0000-000000000003');

select pg_temp.check('… a server zůstal, jak byl',
  (select externi_ucet ->> 'host' from public.integrace_pripojeni where id = :'schranka') = 'imap.krok90.cz');

select pg_temp.check('funkce: nesmyslné datum („od" 30. 2.) spadne',
  not pg_temp.projde(format('select public.faktury_prijem_nastavit(%L, %L)', :'schranka',
    '{"zapnuto": true, "od": "2026-02-30", "rezim": "automaticky", "ai": {"povoleno": false}}')));

select pg_temp.check('funkce: neznámý režim spadne',
  pg_temp.spadne_hlaskou(format('select public.faktury_prijem_nastavit(%L, %L)', :'schranka',
    '{"zapnuto": true, "od": "2026-01-01", "rezim": "vse", "ai": {"povoleno": false}}'), '22023', ''));

select pg_temp.check('funkce: cizí firmu nenastaví',
  pg_temp.spadne_hlaskou(format('select public.faktury_prijem_nastavit(%L, %L)', :'cizi_schranka',
    '{"zapnuto": true, "od": "2026-01-01", "rezim": "automaticky", "ai": {"povoleno": false}}'), '42501', ''));

select set_config('test.user_id', '90900000-0000-0000-0000-000000000004', false);

select pg_temp.check('sanity: druhý správce má jen integrace.manage',
  app.has_access(:'tenant', 'integrace.manage', null) and not app.has_access(:'tenant', 'faktury.manage', null));

select pg_temp.check('jen s integrace.manage příjem nezapne (zapisuje do Faktur)',
  pg_temp.spadne_hlaskou(format('select public.faktury_prijem_nastavit(%L, %L)', :'schranka',
    '{"zapnuto": true, "od": "2026-01-01", "rezim": "automaticky", "ai": {"povoleno": true}}'), '42501', ''));

select set_config('test.user_id', '90900000-0000-0000-0000-000000000001', false);

select pg_temp.check('jen s faktury.read příjem nezapne',
  pg_temp.spadne_hlaskou(format('select public.faktury_prijem_nastavit(%L, %L)', :'schranka',
    '{"zapnuto": false, "od": "2026-01-01", "rezim": "automaticky", "ai": {"povoleno": false}}'), '42501', ''));

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== Úklid =================================================================='

reset role;
delete from public.faktury_prijem where pripojeni_id in (:'schranka', :'cizi_schranka');
delete from public.faktury_prijem_kurzory where pripojeni_id in (:'schranka', :'cizi_schranka');
delete from public.integrace_pripojeni where id in (:'schranka', :'pokladna', :'cizi_schranka');
delete from public.memberships where tenant_id = :'tenant' and user_id in
  ('90900000-0000-0000-0000-000000000001', '90900000-0000-0000-0000-000000000002',
   '90900000-0000-0000-0000-000000000003', '90900000-0000-0000-0000-000000000004');
delete from public.employees where id in (:'e_cte', :'e_bez', :'e_sprava', :'e_integrace');
delete from public.position_permissions where position_id in (:'poz_cte', :'poz_bez', :'poz_sprava', :'poz_integrace');
delete from public.positions where id in (:'poz_cte', :'poz_bez', :'poz_sprava', :'poz_integrace');
-- Cizí firma, auth.users a profiles zůstávají (konvence krok30/krok73/krok89).

select pg_temp.check('úklid: po scénáři nezůstala žádná evidence kroku 90',
  not exists (select 1 from public.faktury_prijem where pripojeni_id in (:'schranka', :'cizi_schranka')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 90 HOTOV =============================================='
