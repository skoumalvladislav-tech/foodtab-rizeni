-- Scénář pro krok 80 — Zakázky (order-to-cash, CRM cateringu).
--
-- Migrace: 20261003220000_zakazky.sql. Plán: proud-scribbling-glade.md,
-- oddíl "Finance a účetnictví — PLNÁ ŠÍŘE zadání". Akceptační scénář
-- 19: zakázka se zálohou propojí nákup/plán/fakturu/zúčtování.
--
-- Pokrývá:
--   1. zalozit_zakazku: číslo ZAK-RRRR-NNNN, cena_celkem_haleru ze
--      součtu položek (ne zadáno ručně);
--   2. propojení platby: transakce.zakazka_id → app.zakazka_uhrazeno
--      součet, žádné dvojí započtení;
--   3. druhá linie: kontakt_id zakázky a zakazka_id transakce cizí
--      firmy spadnou;
--   4. cizí firma bez finance.manage neuspěje přes RPC.

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
  ('80800000-0000-0000-0000-000000000001', 'xaver80@jinafirma.cz', '{"full_name":"Xaver Osmdesát"}');
set role authenticated;
select set_config('test.user_id', '80800000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok80 Cizí s.r.o.', 'Xaver Osmdesát') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava ================================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.kontakty (tenant_id, nazev, je_odberatel)
values (:'tenant', 'Krok80 Firma s.r.o. (catering)', true)
returning id as odberatel \gset


\echo ''
\echo '== 1. Založení zakázky — číslo, cena ze součtu položek ========'

select public.zalozit_zakazku(
  :'tenant', :'perla', :'odberatel', 'Krok80 vánoční večírek', '2026-12-15', 50, 500000, 'firemní akce',
  '[{"popis":"Catering na osobu","mnozstvi":50,"cena_za_jednotku_haleru":80000},{"popis":"Pronájem prostoru","mnozstvi":1,"cena_za_jednotku_haleru":500000}]'::jsonb
) as zakazka \gset

select cislo, cena_celkem_haleru from public.zakazky where id = :'zakazka' \gset

select pg_temp.check('číslo má tvar ZAK-RRRR-NNNN', :'cislo' ~ '^ZAK-\d{4}-\d{4}$');
select pg_temp.check('cena_celkem_haleru = 50×80000 + 500000 = 4500000',
  :'cena_celkem_haleru'::bigint = 4500000);

select pg_temp.check('existují dvě položky zakázky',
  (select count(*) from public.zakazky_polozky where zakazka_id = :'zakazka') = 2);


\echo ''
\echo '== 2. Propojení platby — zaloha, doplatek, žádné dvojí počítání'

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok80 pokladna', 'pokladna')
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, zakazka_id)
values (:'tenant', :'ucet', 'prijem', 500000, current_date, 'rucni', :'zakazka');

select app.zakazka_uhrazeno(:'tenant', :'zakazka') as uhrazeno_po_zaloze \gset
select pg_temp.check('po záloze je uhrazeno 500000', :'uhrazeno_po_zaloze'::bigint = 500000);

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, zakazka_id)
values (:'tenant', :'ucet', 'prijem', 4000000, current_date, 'rucni', :'zakazka');

select app.zakazka_uhrazeno(:'tenant', :'zakazka') as uhrazeno_po_doplatku \gset
select pg_temp.check('po doplatku je uhrazeno 500000+4000000=4500000 (celá cena, žádné zdvojení)',
  :'uhrazeno_po_doplatku'::bigint = 4500000);

select pg_temp.check('veřejná public.zakazka_uhrazeno se shoduje s app.zakazka_uhrazeno',
  public.zakazka_uhrazeno(:'tenant', :'zakazka') = app.zakazka_uhrazeno(:'tenant', :'zakazka'));


\echo ''
\echo '== 3. Druhá linie obrany ========================================'

select set_config('test.user_id', '80800000-0000-0000-0000-000000000001', false);
insert into public.kontakty (tenant_id, nazev, je_odberatel)
values (:'tenant_b', 'Krok80 cizí odběratel', true)
returning id as odberatel_cizi \gset

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant_b', 'Krok80 cizí účet', 'banka')
returning id as ucet_cizi_firma \gset

select public.zalozit_zakazku(
  :'tenant_b', null, :'odberatel_cizi', 'Krok80 cizí zakázka', null, null, 0, '', '[]'::jsonb
) as zakazka_cizi \gset
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('zakázka s kontakt_id cizí firmy spadne',
  pg_temp.spadne_hlaskou(
    format('insert into public.zakazky (tenant_id, kontakt_id, cislo, nazev) values (%L, %L, %L, %L)',
      :'tenant', :'odberatel_cizi', 'ZAK-UTOK-0001', 'Útok'),
    '23514', ''));

select pg_temp.check('transakce s zakazka_id cizí firmy spadne (druhá linie na transakce)',
  pg_temp.spadne_hlaskou(
    format('insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj, zakazka_id) values (%L, %L, %L, %L, current_date, %L, %L)',
      :'tenant', :'ucet', 'prijem', 1000, 'rucni', :'zakazka_cizi'),
    '23514', ''));


\echo ''
\echo '== 4. Cizí firma bez finance.manage neuspěje přes RPC ==========='

select set_config('test.user_id', '80800000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma nemá na náš tenant finance.manage — RPC odmítne',
  pg_temp.spadne_hlaskou(
    format('select public.zalozit_zakazku(%L, %L, %L, %L, null, null, 0, %L, %L::jsonb)',
      :'tenant', :'perla', :'odberatel', 'Útok', '', '[]'),
    '42501', 'oprávnění'));

select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.transakce where tenant_id in (:'tenant', :'tenant_b') and (zakazka_id is not null or ucet_id in (:'ucet', :'ucet_cizi_firma'));
delete from public.platebni_ucty where id in (:'ucet', :'ucet_cizi_firma');
delete from public.zakazky_polozky where tenant_id in (:'tenant', :'tenant_b');
delete from public.zakazky where tenant_id in (:'tenant', :'tenant_b');
delete from public.kontakty where tenant_id in (:'tenant', :'tenant_b');
delete from public.cislovani_rad where tenant_id in (:'tenant', :'tenant_b');

select pg_temp.check('úklid: po scénáři nezůstala žádná zakázka kroku 80',
  not exists (select 1 from public.zakazky where tenant_id in (:'tenant', :'tenant_b')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 80 HOTOV =============================================='
