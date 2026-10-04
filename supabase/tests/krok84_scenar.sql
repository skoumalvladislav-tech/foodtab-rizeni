-- Scénář pro krok 84 — dotažení akceptačních scénářů bankovního modulu
-- (docs/bankovni-modul-zadani-2026-10-04.md, oddíl 7), zapsaných v
-- krok83_scenar.sql jako „appka nepsala samostatný test" (viz
-- docs/hlaseni/banka-modul-stav-2026-10-04.md, „Co appka NESTIHLA").
--
-- Pokrývá:
--   1. akceptační scénář #1 (dva klienti, stejné VS a externí ID,
--      žádný únik) — konkrétně pro `bankovni_zustatky` a
--      `synchronizace_behy` (krok83 testoval jen `integrace_pripojeni`),
--      a explicitní RLS SELECT (ne jen druhá linie na INSERT);
--   2. stejný VS + stejné externí ID u DVOU různých firem na JEJICH
--      VLASTNÍCH účtech nekoliduje (unikátní index je per `ucet_id`,
--      ne globální) a appka mezi firmami ani nehledá možné duplicity;
--   3. akceptační scénář #7, část „jedna platba na dvě faktury" —
--      krok74_scenar.sql testoval jen opačný směr (jedna faktura, dvě
--      platby/doplatek); tenhle scénář rozdělí JEDNU transakci na DVĖ
--      různé faktury a ověří, že součet alokací nepřekročí částku
--      platby ani při druhém, nezávislém faktura_id.

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

-- Skutečná druhá firma, stejný vzor jako krok73/74/83 — vlastník
-- vzniklý přes `app.create_tenant` ji dostane automaticky s
-- `finance.manage`, takže se jí nemusí nic zvlášť dopřidávat.
insert into auth.users (id, email, raw_user_meta_data) values
  ('84840000-0000-0000-0000-000000000001', 'xaver84@jinafirma.cz', '{"full_name":"Xaver Osmdesátčtyři"}');

set role authenticated;
select set_config('test.user_id', '84840000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok84 Cizí s.r.o.', 'Xaver Osmdesátčtyři') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 1. bankovni_zustatky / synchronizace_behy — RLS SELECT (ne jen druhá linie) =='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok84 bankovní účet', 'banka')
returning id as ucet \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id)
values (:'tenant', 'banka', 'fio-krok84', 'zakaznicky', 'Krok84 Fio', :'ucet')
returning id as pripojeni \gset

insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj, integrace_pripojeni_id)
values (:'tenant', :'ucet', 'knihovni', 42000, now(), 'fio_api', :'pripojeni')
returning id as zustatek \gset

-- `authenticated` má na synchronizace_behy jen SELECT (zápis spouští
-- výhradně server-only cesta, ne klient) — zápis fixtury proto jde
-- přes `reset role` stejně jako v krok83_scenar.sql.
reset role;
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, stav)
values (:'tenant', :'pripojeni', 'hotovo')
returning id as beh \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel vidí vlastní zůstatek', exists (select 1 from public.bankovni_zustatky where id = :'zustatek'));
select pg_temp.check('majitel vidí vlastní sync běh', exists (select 1 from public.synchronizace_behy where id = :'beh'));

set role authenticated;
select set_config('test.user_id', '84840000-0000-0000-0000-000000000001', false);

select pg_temp.check('cizí firma NEVIDÍ náš zůstatek, i když zná ID (RLS select, ne jen druhá linie na insert)',
  not exists (select 1 from public.bankovni_zustatky where id = :'zustatek'));

select pg_temp.check('cizí firma NEVIDÍ náš sync běh, i když zná ID (RLS select)',
  not exists (select 1 from public.synchronizace_behy where id = :'beh'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 2. Akceptační scénář #1 — stejný VS a externí ID u DVOU firem nekoliduje =='

-- Unikátní index `transakce_externi_id` je na (ucet_id, externi_id), NE
-- na (tenant_id, externi_id) ani globálně — dvě různé firmy na SVÝCH
-- VLASTNÍCH účtech musí moct mít shodné VS i shodné externí ID ze svých
-- bank bez jakékoli kolize.
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj, externi_id)
values (:'tenant', :'ucet', 'prijem', 33300, current_date, 'Shodná protistrana', '999888', 'fio_api', 'SHODNE-EXTERNI-ID')
returning id as transakce_nase \gset

select pg_temp.check('naše transakce se zapsala', exists (select 1 from public.transakce where id = :'transakce_nase'));

set role authenticated;
select set_config('test.user_id', '84840000-0000-0000-0000-000000000001', false);

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant_b', 'Krok84 cizí účet', 'banka')
returning id as ucet_cizi \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj, externi_id)
values (:'tenant_b', :'ucet_cizi', 'prijem', 77700, current_date, 'Shodná protistrana', '999888', 'fio_api', 'SHODNE-EXTERNI-ID')
returning id as transakce_cizi \gset

select pg_temp.check('cizí firma se STEJNÝM VS a STEJNÝM externím ID na SVÉM VLASTNÍM účtu nekoliduje (unikátní index je per ucet_id, ne globální)',
  exists (select 1 from public.transakce where id = :'transakce_cizi'));

select pg_temp.check('cizí firma vidí jen svou transakci, ne naši (RLS select)',
  exists (select 1 from public.transakce where id = :'transakce_cizi')
  and not exists (select 1 from public.transakce where id = :'transakce_nase'));

select pg_temp.check('možné duplicity appka NEHLEDÁ mezi firmami — `mozne_duplicity_transakci(tenant_b)` o naší transakci nic neví',
  not exists (
    select 1 from public.mozne_duplicity_transakci(:'tenant_b')
    where transakce_a = :'transakce_nase' or transakce_b = :'transakce_nase'
  ));

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('ani naše strana nevidí cizí transakci mezi možnými duplicitami',
  not exists (
    select 1 from public.mozne_duplicity_transakci(:'tenant')
    where transakce_a = :'transakce_cizi' or transakce_b = :'transakce_cizi'
  ));


\echo ''
\echo '== 3. Akceptační scénář #7 — jedna platba rozdělená na DVĖ různé faktury =='

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'vydaj', 90000, current_date, 'rucni')
returning id as transakce_split \gset

select alokovano_celkem_haleru as alokovano_a, plne_uhrazeno as plne_a
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce_split', 'FAKTURA-SPLIT-A', 50000, 50000, null) \gset

select pg_temp.check('první alokace (50000) na fakturu A se zapsala a je plně uhrazená',
  :'alokovano_a'::integer = 50000 and :'plne_a'::boolean = true);

select alokovano_celkem_haleru as alokovano_b, plne_uhrazeno as plne_b
  from public.potvrdit_alokaci_platby(:'tenant', :'transakce_split', 'FAKTURA-SPLIT-B', 40000, 40000, null) \gset

select pg_temp.check('druhá alokace (40000) na JINOU fakturu B ze STEJNÉ platby se zapsala a je plně uhrazená',
  :'alokovano_b'::integer = 40000 and :'plne_b'::boolean = true);

select pg_temp.check('obě alokace jsou dva samostatné řádky na stejnou transakci, různé faktury',
  (select count(*) from public.platby_faktury where transakce_id = :'transakce_split' and stav = 'potvrzeno') = 2
  and (select count(distinct faktura_id) from public.platby_faktury where transakce_id = :'transakce_split' and stav = 'potvrzeno') = 2);

select pg_temp.check('součet alokací na transakci (90000) sedí přesně na částku platby',
  (select coalesce(sum(castka_haleru), 0) from public.platby_faktury where transakce_id = :'transakce_split' and stav = 'potvrzeno') = 90000);

select pg_temp.check('třetí alokace na TŘETÍ fakturu by přesáhla částku platby (90000 už alokováno) — spadne',
  pg_temp.spadne_hlaskou(
    format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, %L, %L, %L)',
      :'tenant', :'transakce_split', 'FAKTURA-SPLIT-C', 1, 1, null),
    '23514', 'přesahuje částku platby'));


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.platby_faktury where tenant_id = :'tenant' and transakce_id = :'transakce_split';
delete from public.transakce where id in (:'transakce_nase', :'transakce_cizi', :'transakce_split');
delete from public.bankovni_zustatky where id = :'zustatek';
delete from public.synchronizace_behy where id = :'beh';
delete from public.integrace_pripojeni where id = :'pripojeni';
delete from public.platebni_ucty where id in (:'ucet', :'ucet_cizi');

select pg_temp.check('úklid: po scénáři nezůstal žádný zůstatek kroku 84',
  not exists (select 1 from public.bankovni_zustatky where tenant_id = :'tenant' and id = :'zustatek'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 84 HOTOV =============================================='
