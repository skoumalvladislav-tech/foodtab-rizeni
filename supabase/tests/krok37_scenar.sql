-- Scénář pro krok 37 — hlasové zprávy (nahrát, uložit, poslat, přehrát).
--
-- Pokrývá migraci 20260917060000_hlasove_zpravy a noční zadání
-- "KOMUNIKACE / VZKAZY 2.0", bod 5 z doporučeného pořadí v
-- docs/hlaseni/komunikace-current-state-map-2026-09-17.md.
--
-- Navazuje na etapa0_scenar.sql až krok36_scenar.sql.
--
-- ŽÁDNÝ AI PŘEPIS — rozhodnutí Šéfíka 17.9.2026 v noci (viz hlavička
-- migrace). Tenhle scénář ověřuje jen nahrání, uložení, odeslání
-- a přístup — ne přepis, protože žádný není.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Past je stejná jako u marketingového kbelíku: politika úložiště
-- hlídá, KDO smí nahrát KAM, ale ne to, jestli se nahraná cesta potom
-- přiřadí ke správné zprávě. Kdyby poslat_zpravu nekontrolovala, že
-- cesta patří TÉTO konverzaci, šlo by nahrát hlasovku do vlastní
-- konverzace (kde je člověk účastník) a připojit ji ke zprávě v JINÉ
-- konverzaci — politika úložiště sama tenhle křížový případ nepokryje.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as sef_emp from public.employees
 where tenant_id = :'tenant' and user_id = :'sef' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('37370001-0000-0000-0000-000000000001', 'petr37@foodtab.cz', '{"full_name":"Petr Hlasoun"}'),
  ('37370002-0000-0000-0000-000000000002', 'iva37@foodtab.cz',  '{"full_name":"Iva Mimo"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '37370001-0000-0000-0000-000000000001', 'Petr Hlasoun', 'hpp'),
  (:'tenant', :'perla', '37370002-0000-0000-0000-000000000002', 'Iva Mimo', 'hpp');

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '37370001-0000-0000-0000-000000000001', :'role_kuchyne', 'branch', 'active'),
  (:'tenant', '37370002-0000-0000-0000-000000000002', :'role_kuchyne', 'branch', 'active');

select id as clen_petr from public.memberships
 where user_id = '37370001-0000-0000-0000-000000000001' \gset
select id as clen_iva from public.memberships
 where user_id = '37370002-0000-0000-0000-000000000002' \gset

insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_petr', :'perla'),
  (:'clen_iva',  :'perla');

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Kbelík existuje, soukromý, s limitem a MIME typy ======'

select pg_temp.check('kbelík hlasovky existuje',
  exists (select 1 from storage.buckets where id = 'hlasovky'));
select pg_temp.check('a je soukromý',
  (select not public from storage.buckets where id = 'hlasovky'));
select pg_temp.check('má rozumný strop velikosti',
  (select file_size_limit from storage.buckets where id = 'hlasovky') > 0
  and (select file_size_limit from storage.buckets where id = 'hlasovky') <= 10485760);
select pg_temp.check('a omezené typy zvuku',
  (select array_length(allowed_mime_types, 1) from storage.buckets where id = 'hlasovky') > 0);


\echo ''
\echo '== 2. Cesta se parsuje, nesmyslná vrátí prázdno ============='

select pg_temp.check('soubor v kořeni kbelíku nepatří nikomu',
  not exists (select 1 from app.hlasovka_cesta_rozsah('a.webm')));
select pg_temp.check('příliš hluboká cesta taky ne',
  not exists (select 1 from app.hlasovka_cesta_rozsah(:'tenant' || '/x/dal/a.webm')));
select pg_temp.check('a cesta s nesmyslným id taky ne',
  not exists (select 1 from app.hlasovka_cesta_rozsah('tohle-neni-uuid/x/a.webm')));


\echo ''
\echo '== 3. Účastník nahraje do vlastní konverzace ================'

select set_config('test.user_id', '37370001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Hlasovky', null,
  array[:'sef_emp']::uuid[]) as osobni \gset

insert into storage.objects (bucket_id, name)
values ('hlasovky', :'tenant' || '/' || :'osobni' || '/nahravka.webm');

select pg_temp.check('soubor je v úložišti',
  exists (select 1 from storage.objects
           where name = :'tenant' || '/' || :'osobni' || '/nahravka.webm'));

reset role;
select set_config('test.osobni', :'osobni', false);


\echo ''
\echo '== 4. Kdo není účastník, nenahraje ani nevidí ================'

select set_config('test.user_id', '37370002-0000-0000-0000-000000000002', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('hlasovky', current_setting('test.tenant') || '/' || current_setting('test.osobni') || '/podvrh.webm');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: Iva nahrála hlasovku do cizí konverzace'; end if;
  raise notice '  OK    kdo není účastník, nenahraje';
end $$;

select pg_temp.check('a hlasovku ani nevidí',
  (select count(*) from storage.objects where bucket_id = 'hlasovky') = 0);

reset role;


\echo ''
\echo '== 5. poslat_zpravu s hlasovkou =============================='

select set_config('test.user_id', '37370001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.poslat_zpravu(
  :'osobni', '', false, null,
  :'tenant' || '/' || :'osobni' || '/nahravka.webm',
  42
) as z_hlas \gset

select pg_temp.check('priorita je normal (výchozí)',
  (select priorita from public.konverzace_zpravy where id = :'z_hlas') = 'normal');
select pg_temp.check('zvuk_cesta sedí',
  (select zvuk_cesta from public.konverzace_zpravy where id = :'z_hlas')
    = :'tenant' || '/' || :'osobni' || '/nahravka.webm');
select pg_temp.check('zvuk_delka_s sedí',
  (select zvuk_delka_s from public.konverzace_zpravy where id = :'z_hlas') = 42);

reset role;


\echo ''
\echo '== 6. Cesta hlasovky musí sedět s konverzací ================='

-- Vedení je JINÁ konverzace, do které je Petr taky účastník (založí ji
-- sám sobě) — a přesto se do ní nesmí připojit hlasovka nahraná pro
-- konverzaci :'osobni'. Politika úložiště tenhle křížový případ sama
-- nepokryje (kontrolovala jen nahrání, ne pozdější přiřazení).
select set_config('test.user_id', '37370001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.zalozit_rozhovor(:'tenant', 'vedeni', null, 'Dotaz', 'majitel') as jina \gset

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(
      current_setting('test.jina')::uuid, '', false, null,
      current_setting('test.tenant') || '/' || current_setting('test.osobni') || '/nahravka.webm',
      10
    );
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: hlasovka z jiné konverzace se připojila'; end if;
  raise notice '  OK    cesta z jiné konverzace se odmítne';
end $$;

reset role;
select set_config('test.jina', :'jina', false);


\echo ''
\echo '== 7. Ani text, ani zvuk se neodešle =========================='

select set_config('test.user_id', '37370001-0000-0000-0000-000000000001', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.osobni')::uuid, '', false, null, null, null);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prázdná zpráva bez hlasovky prošla'; end if;
  raise notice '  OK    ani text, ani zvuk se neodešle';
end $$;

reset role;


\echo ''
\echo '== 8. Staré volání (jen text, bez hlasovky) funguje dál ======'

select set_config('test.user_id', '37370001-0000-0000-0000-000000000001', false);
set role authenticated;

select public.poslat_zpravu(:'osobni', 'Obyčejná textovka.') as z_text \gset

select pg_temp.check('textovka nemá zvuk',
  (select zvuk_cesta from public.konverzace_zpravy where id = :'z_text') is null);
select pg_temp.check('a priorita je normal',
  (select priorita from public.konverzace_zpravy where id = :'z_text') = 'normal');

reset role;


\echo ''
\echo '== KROK 37 HOTOV ========================================'
