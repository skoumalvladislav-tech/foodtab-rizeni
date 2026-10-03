-- Scénář pro krok 73 — registr připojení k poskytovatelům (Finance ERP).
--
-- Migrace: 20261003100000_integrace_registr.sql. Plán:
-- C:\Users\vladi\.claude\plans\proud-scribbling-glade.md, oddíl "Finance
-- a účetnictví — gastro ERP modul".
--
-- Pokrývá:
--   0. příprava (modul finance aktivní, skutečná druhá firma — krok58/70 styl);
--   1. integrace_pripojeni: RLS čtení/zápis podle finance.read/finance.manage;
--   2. integrace_tajemstvi: `authenticated` na ni NEMÁ ŽÁDNÝ grant — přímý
--      SELECT/INSERT spadne na 42501 dřív, než se RLS vůbec zeptá;
--   3. tajemství jde jen přes tři RPC (uloz/precti/smaz), a ty si tenant
--      dohledají SAMY z pripojeni_id — cizí firma (platná pripojeni_id,
--      cizí tenant) neuspěje, ani by nezkoušela podstrčit vlastní p_tenant
--      (funkce žádný p_tenant parametr nemá);
--   4. jedno živé připojení na poskytovatele a rozsah (unikátní index).
--
-- Navazuje na etapa0_scenar.sql (firma "Foodtab s.r.o.", pobočka Černá
-- Perla, majitel@foodtab.cz). Modul `finance` se aktivuje tady — etapa0
-- ho nezapíná.

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
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;


-- =====================================================================
-- PŘÍPRAVA: skutečná druhá firma (krok58/70 styl) — potřebná pro
-- testy izolace níž.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('73730000-0000-0000-0000-000000000001', 'xaver73@jinafirma.cz', '{"full_name":"Xaver Třisedmdesát"}');

set role authenticated;
select set_config('test.user_id', '73730000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok73 Cizí s.r.o.', 'Xaver Třisedmdesát') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava měří to, co má =============================='

select pg_temp.check('příprava: modul finance je u testovací firmy aktivní',
  exists (select 1 from public.tenant_modules
           where tenant_id = :'tenant' and module_key = 'finance'
             and status in ('active', 'trial')));

select pg_temp.check('příprava: oprávnění finance.read/finance.manage existují v katalogu',
  (select count(*) from public.permissions
    where key in ('finance.read', 'finance.manage')) = 2);


\echo ''
\echo '== 1. Majitel smí založit připojení a vidí ho =============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', 'banka', 'csv_import', 'csv', 'Krok73 testovací banka')
returning id as pripojeni \gset

select pg_temp.check('majitel vidí vlastní připojení',
  exists (select 1 from public.integrace_pripojeni where id = :'pripojeni'));

select pg_temp.check('nové připojení má výchozí stav nepripojeno',
  (select stav from public.integrace_pripojeni where id = :'pripojeni') = 'nepripojeno');


\echo ''
\echo '== 2. integrace_tajemstvi — authenticated nic nepřečte, nic nezapíše ==='
-- SELECT má (nález při ověřování, viz komentář v migraci) grant, ale
-- restriktivní politiku `using (false)` — vrátí prázdno, NE chybu.
-- INSERT/UPDATE grant nemá vůbec — spadne na 42501 dřív, než se RLS
-- vůbec zeptá na řádky.

select pg_temp.check('přímý SELECT na integrace_tajemstvi vrátí prázdno (politika, ne grant)',
  not exists (select 1 from public.integrace_tajemstvi where pripojeni_id = :'pripojeni'));

select pg_temp.check('přímý INSERT do integrace_tajemstvi spadne na chybějící grant',
  pg_temp.spadne_hlaskou(
    format('insert into public.integrace_tajemstvi (pripojeni_id, tenant_id, sifra, otisk) values (%L, %L, %L, %L)',
      :'pripojeni', :'tenant', 'x', 'y'),
    '42501', 'permission denied'));

select pg_temp.check('přímý UPDATE na integrace_tajemstvi spadne na chybějící grant',
  pg_temp.spadne_hlaskou(
    format('update public.integrace_tajemstvi set sifra = %L where pripojeni_id = %L', 'x', :'pripojeni'),
    '42501', 'permission denied'));


\echo ''
\echo '== 3. Tajemství jde jen přes RPC ============================'

select app.integrace_uloz_tajemstvi(:'pripojeni', 'sifrovany-text-v1', 'otisk-abc') as ulozeno \gset

select pg_temp.check('po uložení RPC vrátí stejnou šifru',
  app.integrace_precti_tajemstvi(:'pripojeni') = 'sifrovany-text-v1');

-- Druhé uložení (rotace) zvýší verzi a přepíše šifru/otisk, ne vloží
-- druhý řádek (on conflict do update, stejný vzor jako marketing).
select app.integrace_uloz_tajemstvi(:'pripojeni', 'sifrovany-text-v2', 'otisk-xyz') as ulozeno2 \gset

select pg_temp.check('rotace tajemství: nový obsah se čte, ne starý',
  app.integrace_precti_tajemstvi(:'pripojeni') = 'sifrovany-text-v2');

-- `integrace_tajemstvi` má pro `authenticated` politiku `using (false)`
-- (vidí nulu řádků vždy, viz oddíl 2) — na ověření SKUTEČNÉHO stavu
-- řádku (ne skrz RPC, co vrací jen šifru) je nutné dočasně `reset role`,
-- stejný vzor jako jinde v projektu u tabulek bez SELECT pro authenticated.
reset role;
select pg_temp.check('rotace tajemství: jen jeden řádek na pripojeni_id (žádná duplicita)',
  (select count(*) from public.integrace_tajemstvi where pripojeni_id = :'pripojeni') = 1);

select pg_temp.check('rotace tajemství: verze_klice se zvýšila',
  (select verze_klice from public.integrace_tajemstvi where pripojeni_id = :'pripojeni') = 2);
set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 4. Cizí firma nevidí, nezapíše, ani přes RPC neuspěje ===='

set role authenticated;
select set_config('test.user_id', '73730000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma nevidí naše připojení (RLS select)',
  not exists (select 1 from public.integrace_pripojeni where id = :'pripojeni'));

-- Cizí firma zkusí přečíst NAŠE tajemství přes RPC, s NAŠÍM pripojeni_id.
-- Funkce si tenant dohledá sama z integrace_pripojeni a najde NÁS, ne
-- volajícího — has_access(nas_tenant, 'finance.manage', ...) pro Xavera
-- vrátí false, takže musí spadnout, ne vrátit prázdno ani naši šifru.
select pg_temp.check('cizí firma přes RPC naše tajemství NEPŘEČTE (spadne, ne ticho)',
  pg_temp.spadne_hlaskou(
    format('select app.integrace_precti_tajemstvi(%L)', :'pripojeni'),
    '42501', 'oprávnění'));

select pg_temp.check('cizí firma přes RPC naše tajemství NEPŘEPÍŠE',
  pg_temp.spadne_hlaskou(
    format('select app.integrace_uloz_tajemstvi(%L, %L, %L)', :'pripojeni', 'podvrzeno', 'podvrzeno'),
    '42501', 'oprávnění'));

select pg_temp.check('cizí firma naše připojení NEODPOJÍ (RPC smaz)',
  pg_temp.spadne_hlaskou(
    format('select app.integrace_smaz_tajemstvi(%L)', :'pripojeni'),
    '42501', 'oprávnění'));

-- A pro úplnost: naše tajemství PO útoku pořád existuje a je nezměněné.
reset role;
select set_config('test.user_id', '', false);
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('po útoku cizí firmy je naše tajemství beze změny',
  app.integrace_precti_tajemstvi(:'pripojeni') = 'sifrovany-text-v2');


\echo ''
\echo '== 5. Jedno živé připojení na poskytovatele a rozsah ========'

select pg_temp.check('druhé připojení se STEJNÝM poskytovatelem a rozsahem spadne na unikátní index',
  pg_temp.spadne_hlaskou(
    format('insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim) values (%L, %L, %L, %L)',
      :'tenant', 'banka', 'csv_import', 'csv'),
    '23505', ''));

-- Po odpojení (odpojeno_kdy vyplněné) smí vzniknout nové se stejným
-- poskytovatelem — unikátní index je `where odpojeno_kdy is null`.
update public.integrace_pripojeni set odpojeno_kdy = now() where id = :'pripojeni';

select pg_temp.check('po odpojení smí vzniknout nové se stejným poskytovatelem',
  pg_temp.projde(
    format('insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim) values (%L, %L, %L, %L)',
      :'tenant', 'banka', 'csv_import', 'csv')));


\echo ''
\echo '== Úklid ===================================================='

reset role;
delete from public.integrace_tajemstvi where pripojeni_id in
  (select id from public.integrace_pripojeni where tenant_id in (:'tenant', :'tenant_b'));
delete from public.integrace_pripojeni where tenant_id in (:'tenant', :'tenant_b');

select pg_temp.check('úklid: po scénáři nezůstalo žádné připojení kroku 73',
  not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'tenant', :'tenant_b')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 73 HOTOV ============================================'
