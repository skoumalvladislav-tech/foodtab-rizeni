-- Scénář pro krok 78 — Nákup: objednávky dodavatelům a příjem zboží.
--
-- Migrace: 20261003200000_nakup_objednavky.sql. Plán:
-- proud-scribbling-glade.md, oddíl "Finance a účetnictví — PLNÁ ŠÍŘE
-- zadání". Přímo akceptační scénář 17 (zadání, oddíl 13): „Objednávka
-- 20 kg, první příjem 12 kg a druhý 8 kg vytvoří správnou zásobu a
-- zbývající množství objednávky. Faktura s jiným množstvím/cenou
-- upozorní na rozdíl."
--
-- POZOR: purchasing.read/purchasing.manage patří modulu `objednavky`
-- v katalogu (ne `finance`) — app.has_access to vyžaduje přes JOIN na
-- tenant_modules.module_key. Aktivuje se tu modul `objednavky`.
--
-- Pokrývá:
--   0. příprava (modul objednavky aktivní, kontakt-dodavatel);
--   1. číslování: dvě objednávky mají různá čísla, tvar OBJ-RRRR-NNNN;
--   2. scénář 17: objednávka 20 kg, příjem 12+8 → mnozstvi_prijato=20,
--      bez upozornění (přesně sedí);
--   3. příjem s jiným množstvím/cenou upozorní (prekrocene_mnozstvi/
--      jina_cena), ale ZÁPIS PROBĖHNE (neblokuje);
--   4. druhá linie: kontakt_id/objednavka_id cizí firmy spadne;
--   5. cizí firma bez purchasing.manage neuspěje přes
--      public.zapsat_prijem_zbozi (SECURITY DEFINER si to ověří sama).

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
values (:'tenant', 'objednavky'), (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('78780000-0000-0000-0000-000000000001', 'xaver78@jinafirma.cz', '{"full_name":"Xaver Sedmdesátosm"}');

set role authenticated;
select set_config('test.user_id', '78780000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok78 Cizí s.r.o.', 'Xaver Sedmdesátosm') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'objednavky'), (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava ================================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.kontakty (tenant_id, nazev, je_dodavatel)
values (:'tenant', 'Krok78 Velkoobchod s.r.o.', true)
returning id as dodavatel \gset

select pg_temp.check('příprava: dodavatel se zapsal', :'dodavatel' is not null);


\echo ''
\echo '== 1. Číslování ================================================'

select public.zalozit_objednavku(:'tenant', :'perla', :'dodavatel', null, 'první objednávka', '[]'::jsonb) as objednavka1 \gset
select public.zalozit_objednavku(:'tenant', :'perla', :'dodavatel', null, 'druhá objednávka', '[]'::jsonb) as objednavka2 \gset

select cislo as cislo1 from public.objednavky_dodavatelum where id = :'objednavka1' \gset
select cislo as cislo2 from public.objednavky_dodavatelum where id = :'objednavka2' \gset

select pg_temp.check('dvě objednávky mají RŮZNÁ čísla', :'cislo1' <> :'cislo2');
select pg_temp.check('číslo má tvar OBJ-RRRR-NNNN', :'cislo1' ~ '^OBJ-\d{4}-\d{4}$');


\echo ''
\echo '== 2. Scénář 17: objednávka 20 kg, příjem 12+8 kg =============='

insert into public.objednavky_polozky (tenant_id, objednavka_id, nazev, jednotka, mnozstvi_objednano, cena_za_jednotku_haleru)
values (:'tenant', :'objednavka1', 'Krok78 mouka', 'kg', 20, 5000)
returning id as polozka \gset

select prekrocene_mnozstvi as prvni_prekrocene, jina_cena as prvni_jina_cena
  from public.zapsat_prijem_zbozi(
    :'tenant', :'perla', :'objednavka1', null, null, 'první dodávka',
    format('[{"objednavky_polozka_id":"%s","nazev":"Krok78 mouka","jednotka":"kg","mnozstvi_prijato":12,"cena_za_jednotku_haleru":5000}]', :'polozka')::jsonb
  ) \gset

select pg_temp.check('první příjem (12 kg) nehlásí překročení ani jinou cenu',
  not :'prvni_prekrocene'::boolean and not :'prvni_jina_cena'::boolean);

select mnozstvi_prijato as mnozstvi_po_prvnim
  from public.objednavky_polozky where id = :'polozka' \gset

select pg_temp.check('po prvním příjmu je mnozstvi_prijato = 12', :'mnozstvi_po_prvnim'::numeric = 12);

select prekrocene_mnozstvi as druhy_prekrocene
  from public.zapsat_prijem_zbozi(
    :'tenant', :'perla', :'objednavka1', null, null, 'druhá dodávka',
    format('[{"objednavky_polozka_id":"%s","nazev":"Krok78 mouka","jednotka":"kg","mnozstvi_prijato":8,"cena_za_jednotku_haleru":5000}]', :'polozka')::jsonb
  ) \gset

select pg_temp.check('druhý příjem (8 kg, 12+8=20=objednáno) NEhlásí překročení',
  not :'druhy_prekrocene'::boolean);

select mnozstvi_prijato as mnozstvi_po_druhem
  from public.objednavky_polozky where id = :'polozka' \gset

select pg_temp.check('po obou příjmech je mnozstvi_prijato přesně 20 (scénář 17)', :'mnozstvi_po_druhem'::numeric = 20);

select pg_temp.check('existují dvě příjemky s touto objednávkou',
  (select count(*) from public.prijemky where objednavka_id = :'objednavka1') = 2);


\echo ''
\echo '== 3. Jiné množství/cena upozorní, ale zápis PROBĖHNE =========='

insert into public.objednavky_polozky (tenant_id, objednavka_id, nazev, jednotka, mnozstvi_objednano, cena_za_jednotku_haleru)
values (:'tenant', :'objednavka2', 'Krok78 cukr', 'kg', 10, 3000)
returning id as polozka2 \gset

select prekrocene_mnozstvi as neshoda_prekrocene, jina_cena as neshoda_jina_cena
  from public.zapsat_prijem_zbozi(
    :'tenant', :'perla', :'objednavka2', null, null, 'přišlo víc a dráž',
    format('[{"objednavky_polozka_id":"%s","nazev":"Krok78 cukr","jednotka":"kg","mnozstvi_prijato":15,"cena_za_jednotku_haleru":3500}]', :'polozka2')::jsonb
  ) \gset

select pg_temp.check('příjem 15 kg na objednaných 10 kg HLÁSÍ překročení',
  :'neshoda_prekrocene'::boolean);
select pg_temp.check('cena 3500 vs. objednaných 3000 HLÁSÍ jinou cenu',
  :'neshoda_jina_cena'::boolean);
select pg_temp.check('ale zápis PROBĖHL (žádná blokace) — mnozstvi_prijato=15',
  (select mnozstvi_prijato from public.objednavky_polozky where id = :'polozka2') = 15);


\echo ''
\echo '== 4. Druhá linie: kontakt/objednávka cizí firmy ==============='

select set_config('test.user_id', '78780000-0000-0000-0000-000000000001', false);
insert into public.kontakty (tenant_id, nazev, je_dodavatel)
values (:'tenant_b', 'Krok78 cizí dodavatel', true)
returning id as dodavatel_cizi \gset
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('objednávka s kontakt_id cizí firmy spadne (druhá linie)',
  pg_temp.spadne_hlaskou(
    format('insert into public.objednavky_dodavatelum (tenant_id, kontakt_id, cislo) values (%L, %L, %L)',
      :'tenant', :'dodavatel_cizi', 'OBJ-UTOK-0001'),
    '23514', ''));


\echo ''
\echo '== 5. Cizí firma bez purchasing.manage neuspěje přes RPC ========'

select set_config('test.user_id', '78780000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma nemá na náš tenant purchasing.manage — RPC odmítne',
  pg_temp.spadne_hlaskou(
    format('select public.zapsat_prijem_zbozi(%L, %L, null, null, null, %L, %L::jsonb)',
      :'tenant', :'perla', 'útok', '[]'),
    '42501', 'oprávnění'));

select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.prijemky_polozky where tenant_id in (:'tenant', :'tenant_b');
delete from public.prijemky where tenant_id in (:'tenant', :'tenant_b');
delete from public.objednavky_polozky where tenant_id in (:'tenant', :'tenant_b');
delete from public.objednavky_dodavatelum where tenant_id in (:'tenant', :'tenant_b');
delete from public.kontakty where tenant_id in (:'tenant', :'tenant_b');
delete from public.cislovani_rad where tenant_id in (:'tenant', :'tenant_b');

select pg_temp.check('úklid: po scénáři nezůstala žádná objednávka kroku 78',
  not exists (select 1 from public.objednavky_dodavatelum where tenant_id in (:'tenant', :'tenant_b')));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 78 HOTOV =============================================='
