-- Scénář pro krok 82 — denní pokladní prodeje (Dotykačka adaptér, P1).
--
-- Migrace: 20261003240000_pokladna_prodeje.sql. Plán: proud-scribbling-glade.md,
-- oddíl "Finance a účetnictví — PLNÁ ŠÍŘE zadání", bod 6.
--
-- Pokrývá: RLS čtení/zápis (finance.read vs. finance.manage), idempotentní
-- import přes RPC (opakovaný den/produkt PŘEPÍŠE, ne zdvojí — na rozdíl
-- od transakce, kde se duplicita jen zahazuje), druhá linie obrany
-- (cizí branch_id/import_davka_id), izolace cizí firmy.

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

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('82820000-0000-0000-0000-000000000001', 'xaver82@jinafirma.cz', '{"full_name":"Xaver Osmdesátdva"}');
set role authenticated;
select set_config('test.user_id', '82820000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok82 Cizí s.r.o.', 'Xaver Osmdesátdva') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

-- Fixtury cizí firmy se zakládají bez role authenticated (RLS bypass) —
-- stejný vzor jako krok71_scenar.sql: branch/dávka cizí firmy nejsou
-- účelem tohoto testu, jen podklad pro druhou linii obrany.
insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok82 cizí pobočka', 'krok82-cizi', true)
returning id as perla_b \gset
insert into public.import_davky (tenant_id, typ, soubor_hash, stav)
values (:'tenant_b', 'pokladna_prodeje_csv', 'krok82-cizi-hash', 'zpracovano')
returning id as davka_cizi \gset


\echo ''
\echo '== 1. Majitel smí zapsat a vidí ================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj)
values (:'tenant', :'perla', '2026-10-01', 'Krok82 Guláš', 10, 150000, 'csv')
returning id as prodej \gset

select pg_temp.check('prodej se zapsal', exists (select 1 from public.pokladna_prodeje_denni where id = :'prodej'));


\echo ''
\echo '== 2. Druhá linie obrany: cizí branch_id / import_davka_id ======'

select pg_temp.check('branch_id cizí firmy spadne (druhá linie)',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj) values (%L, %L, %L, %L, %L, %L, %L)',
      :'tenant', :'perla_b', '2026-10-01', 'X', 1, 100, 'csv'),
    '23514', ''));

select pg_temp.check('import_davka_id cizí firmy spadne (druhá linie)',
  pg_temp.spadne_hlaskou(
    format('insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, import_davka_id) values (%L, %L, %L, %L, %L, %L, %L, %L)',
      :'tenant', :'perla', '2026-10-01', 'X', 1, 100, 'csv', :'davka_cizi'),
    '23514', ''));


\echo ''
\echo '== 3. Idempotentní hromadný import (RPC) ========================'

insert into public.import_davky (tenant_id, typ, soubor_hash, stav)
values (:'tenant', 'pokladna_prodeje_csv', 'krok82-hash-abc', 'zpracovano')
returning id as davka \gset

select public.importovat_pokladna_prodeje(:'tenant', :'perla', :'davka', 'csv',
  '[{"datum":"2026-10-02","produkt_nazev":"Krok82 Svíčková","mnozstvi":5,"trzba_haleru":120000}]'::jsonb
) as pocet_1 \gset

select pg_temp.check('první import vložil 1 řádek', :'pocet_1' = 1);

select trzba_haleru as trzba_pred from public.pokladna_prodeje_denni
  where tenant_id = :'tenant' and branch_id = :'perla' and datum = '2026-10-02' and produkt_nazev = 'Krok82 Svíčková' \gset

select public.importovat_pokladna_prodeje(:'tenant', :'perla', :'davka', 'csv',
  '[{"datum":"2026-10-02","produkt_nazev":"Krok82 Svíčková","mnozstvi":5,"trzba_haleru":130000}]'::jsonb
) as pocet_2 \gset

select pg_temp.check('druhý import téhož dne/produktu/zdroje se stejně počítá jako 1 (upsert, ne druhý řádek)', :'pocet_2' = 1);

select pg_temp.check('řádků se stejným dnem/produktem/zdrojem je stále jen jeden',
  (select count(*) from public.pokladna_prodeje_denni
     where tenant_id = :'tenant' and branch_id = :'perla' and datum = '2026-10-02' and produkt_nazev = 'Krok82 Svíčková') = 1);

select pg_temp.check('ale hodnota se PŘEPSALA na novou tržbu (130000), ne zůstala na staré',
  (select trzba_haleru from public.pokladna_prodeje_denni
     where tenant_id = :'tenant' and branch_id = :'perla' and datum = '2026-10-02' and produkt_nazev = 'Krok82 Svíčková') = 130000);

select pg_temp.check('první tržba (120000) se skutečně zapsala, než ji druhý import přepsal',
  :'trzba_pred'::integer = 120000);


\echo ''
\echo '== 4. Jiný produkt / jiný den stejného importu je samostatný řádek'

select public.importovat_pokladna_prodeje(:'tenant', :'perla', :'davka', 'csv',
  '[{"datum":"2026-10-02","produkt_nazev":"Krok82 Guláš","mnozstvi":3,"trzba_haleru":45000}]'::jsonb
) as pocet_3 \gset

select pg_temp.check('jiný produkt stejného dne je nový řádek, ne přepis', :'pocet_3' = 1);

select pg_temp.check('oba produkty dne 2026-10-02 existují zároveň',
  (select count(*) from public.pokladna_prodeje_denni
     where tenant_id = :'tenant' and branch_id = :'perla' and datum = '2026-10-02') = 2);


\echo ''
\echo '== 5. RPC bez finance.manage spadne na RLS ======================'

select set_config('test.user_id', '82820000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma náš prodej nevidí',
  not exists (select 1 from public.pokladna_prodeje_denni where id = :'prodej'));

select pg_temp.check('cizí firma přes RPC s naším tenant_id nic nezapíše (RLS WITH CHECK odepře insert)',
  pg_temp.spadne_hlaskou(
    format('select public.importovat_pokladna_prodeje(%L, %L, %L, %L, %L::jsonb)',
      :'tenant', :'perla', :'davka', 'csv', '[{"datum":"2026-10-03","produkt_nazev":"Útok","mnozstvi":1,"trzba_haleru":100}]'),
    '42501', ''));

select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.pokladna_prodeje_denni where tenant_id in (:'tenant', :'tenant_b');
delete from public.import_davky where tenant_id in (:'tenant', :'tenant_b');
-- Cizí pobočka/firma (tenant_b) se neuklízí — throwaway fixtura, stejný
-- vzor jako krok71_scenar.sql (tenant_b tam taky zůstává po scénáři).

select pg_temp.check('úklid: po scénáři nezůstal žádný prodej kroku 82',
  not exists (select 1 from public.pokladna_prodeje_denni where tenant_id in (:'tenant', :'tenant_b')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 82 HOTOV =============================================='
