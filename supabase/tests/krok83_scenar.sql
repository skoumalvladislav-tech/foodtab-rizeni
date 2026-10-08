-- Scénář pro krok 83 — napojení bankovního účtu: platebni_ucet_id na
-- integrace_pripojeni, bankovni_zustatky (snapshoty), synchronizace_behy
-- (zámek souběhu), bezpečná alokace (druhá sada — souběh/pevné pořadí
-- zámků), možné duplicity mezi zdroji.
--
-- Migrace: 20261004100000_banka_napojeni.sql. Zadání:
-- docs/bankovni-modul-zadani-2026-10-04.md.
--
-- Pokrývá akceptační scénáře (oddíl 7): #5 (API a CSV stejné pohyby —
-- detekce duplicity), #6 (dva souběžné joby nepřiřadí dvakrát — zámek
-- synchronizace_behy), #8 (zůstatek jako snapshot, ne odvozený;
-- historický import nevytvoří falešný aktuální zůstatek).

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
select id as perla  from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('83830000-0000-0000-0000-000000000001', 'xaver83@jinafirma.cz', '{"full_name":"Xaver Osmdesáttři"}');
set role authenticated;
select set_config('test.user_id', '83830000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok83 Cizí s.r.o.', 'Xaver Osmdesáttři') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant_b', 'Krok83 cizí účet', 'banka')
returning id as ucet_cizi \gset


\echo ''
\echo '== 1. Platebni_ucet_id — druhá linie obrany ===================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok83 pokladna', 'pokladna')
returning id as ucet \gset

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id)
values (:'tenant', 'banka', 'fio-test83', 'zakaznicky', 'Krok83 Fio', :'ucet')
returning id as pripojeni \gset

select pg_temp.check('připojení s vlastním účtem se zapsalo', exists (select 1 from public.integrace_pripojeni where id = :'pripojeni'));

select pg_temp.check('platebni_ucet_id cizí firmy spadne (druhá linie, integrace_pripojeni)',
  pg_temp.spadne_hlaskou(
    format('insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id) values (%L, %L, %L, %L, %L, %L)',
      :'tenant', 'banka', 'fio-test83b', 'zakaznicky', 'Krok83 Útok', :'ucet_cizi'),
    '23514', 'nepatří'));


\echo ''
\echo '== 2. Bankovní zůstatky — append-only snapshoty, NE odvozené ===='

insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj, integrace_pripojeni_id)
values (:'tenant', :'ucet', 'knihovni', 50000, now() - interval '1 hour', 'fio_api', :'pripojeni')
returning id as zustatek_1 \gset

insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj, integrace_pripojeni_id)
values (:'tenant', :'ucet', 'disponibilni', 45000, now() - interval '1 hour', 'fio_api', :'pripojeni')
returning id as zustatek_2 \gset

select pg_temp.check('oba typy (knihovní i disponibilní) se zapsaly jako SAMOSTATNÉ řádky',
  (select count(*) from public.bankovni_zustatky where platebni_ucet_id = :'ucet') = 2);

select pg_temp.check('zůstatek SMÍ být záporný (kontokorent) — na rozdíl od transakce',
  pg_temp.projde(format('insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values (%L, %L, %L, %L, now(), %L)',
    :'tenant', :'ucet', 'knihovni', -500, 'rucni')));

select pg_temp.check('UPDATE na bankovni_zustatky je no-op (rule) — snapshot se nepřepisuje',
  pg_temp.projde(format('update public.bankovni_zustatky set castka_haleru = 999999 where id = %L', :'zustatek_1'))
  and (select castka_haleru from public.bankovni_zustatky where id = :'zustatek_1') = 50000);

select pg_temp.check('DELETE na bankovni_zustatky spadne na chybějící grant',
  pg_temp.spadne_hlaskou(format('delete from public.bankovni_zustatky where id = %L', :'zustatek_1'), '42501', 'permission denied'));

select pg_temp.check('platebni_ucet_id cizí firmy spadne (druhá linie, bankovni_zustatky)',
  pg_temp.spadne_hlaskou(
    format('insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj) values (%L, %L, %L, %L, now(), %L)',
      :'tenant', :'ucet_cizi', 'knihovni', 1000, 'rucni'),
    '23514', 'nepatří'));

-- Nejnovější snapshot podle `platny_k`, ne podle vložení — appka
-- NEPŘEDPOKLÁDÁ, že poslední vložený řádek je nejnovější platný.
insert into public.bankovni_zustatky (tenant_id, platebni_ucet_id, typ, castka_haleru, platny_k, zdroj, integrace_pripojeni_id)
values (:'tenant', :'ucet', 'knihovni', 70000, now(), 'fio_api', :'pripojeni')
returning id as zustatek_novejsi \gset

select id as nejnovejsi_id from public.bankovni_zustatky
  where platebni_ucet_id = :'ucet' and typ = 'knihovni'
  order by platny_k desc limit 1 \gset

select pg_temp.check('nejnovější knihovní zůstatek je ten s nejnovějším platny_k (70000), ne poslední vložený řádek podle pořadí',
  :'nejnovejsi_id' = :'zustatek_novejsi');


\echo ''
\echo '== 3. Synchronizace_behy — zámek souběhu ========================'

reset role;
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, stav)
values (:'tenant', :'pripojeni', 'bezi')
returning id as beh_1 \gset

select pg_temp.check('druhý souběžný "bezi" běh na STEJNÉ připojení spadne na unikátní index',
  pg_temp.spadne_hlaskou(
    format('insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, stav) values (%L, %L, %L)',
      :'tenant', :'pripojeni', 'bezi'),
    '23505', ''));

update public.synchronizace_behy set stav = 'hotovo', dokonceno_kdy = now(), pocet_novych_radku = 3 where id = :'beh_1';

select pg_temp.check('po dokončení prvního běhu lze založit nový "bezi" běh na stejné připojení',
  pg_temp.projde(format('insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, stav) values (%L, %L, %L)',
    :'tenant', :'pripojeni', 'bezi')));

set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 4. Možné duplicity mezi zdroji (detekce, NE automatické sloučení)'

-- Řádek „z Fio" zapisuje jen synchronizace (service_role) — od migrace
-- 20261008120000 ho přihlášený uživatel založit nesmí (trigger
-- hlida_zdroj_transakce). Proto mimo roli authenticated.
reset role;
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj, externi_id)
values (:'tenant', :'ucet', 'vydaj', 15000, current_date, 'ABC s.r.o.', '20260099', 'fio_api', 'fio-83-001')
returning id as transakce_api \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj, externi_id)
values (:'tenant', :'ucet', 'vydaj', 15000, current_date, 'ABC s.r.o.', '20260099', 'csv_banka', 'csv-radek-83-001')
returning id as transakce_csv \gset

select transakce_a, transakce_b from public.mozne_duplicity_transakci(:'tenant')
  where transakce_a in (:'transakce_api', :'transakce_csv') or transakce_b in (:'transakce_api', :'transakce_csv') \gset

select pg_temp.check('stejné datum/částka/směr/VS z JINÉHO zdroje se označí jako možná duplicita',
  :'transakce_a' is not null and :'transakce_b' is not null);

-- Jiný VS (nebo prázdný VS) u shodné částky/dne NESMÍ appka automaticky
-- slučovat — zadání: „shodná částka, den a VS samy nesmí smazat dvě
-- skutečně různé platby" — a obráceně, bez VS appka nemá signál dost
-- silný, aby to vůbec zkoušela.
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj, externi_id)
values (:'tenant', :'ucet', 'vydaj', 15000, current_date, 'Jiná firma', '', 'csv_banka', 'csv-radek-83-002')
returning id as transakce_jina \gset

select pg_temp.check('transakce bez VS se do detekce duplicit NEpromítne (slabý signál, appka ho nepoužije)',
  not exists (
    select 1 from public.mozne_duplicity_transakci(:'tenant')
    where transakce_a = :'transakce_jina' or transakce_b = :'transakce_jina'
  ));


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.bankovni_zustatky where tenant_id = :'tenant';
delete from public.synchronizace_behy where tenant_id = :'tenant';
delete from public.transakce where id in (:'transakce_api', :'transakce_csv', :'transakce_jina');
delete from public.integrace_pripojeni where id = :'pripojeni';
delete from public.platebni_ucty where id in (:'ucet', :'ucet_cizi');

select pg_temp.check('úklid: po scénáři nezůstal žádný zůstatek kroku 83',
  not exists (select 1 from public.bankovni_zustatky where tenant_id = :'tenant'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 83 HOTOV =============================================='
