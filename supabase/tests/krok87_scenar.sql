-- Scénář pro krok 87 — druhý nález z auditu bankovního modulu
-- (6. 10. 2026), objevený při ověřování krok86: šest tabulek měla
-- DELETE grant pro `authenticated`, ale NIKDE v appce se nevolá
-- přímý `.delete()`. Nejzávažnější: `platebni_ucty` má `on delete
-- cascade` z `transakce`/`bankovni_zustatky` — DELETE řádku účtu by
-- smazal CELÝ žurnál transakcí té firmy. Oprava: migrace
-- 20261006120000_delete_granty_financni_tabulky.sql.
--
-- Pokrývá:
--   1. přímý DELETE na `platebni_ucty` SPADNE, a KRITICKY: navázaná
--      transakce přežije (cascade se nikdy nespustí, protože appka
--      se k mazání rodiče vůbec nedostane);
--   2. přímý DELETE na `integrace_pripojeni` SPADNE, navázaný
--      synchronizace_behy přežije;
--   3. přímý DELETE na zbylých čtyřech (kontakty, kontakty_osoby,
--      predpisy_plateb, import_davky) SPADNE.

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

set role authenticated;
select set_config('test.user_id', :'majitel', false);


\echo ''
\echo '== 1. DELETE na platebni_ucty SPADNE — navázaná transakce PŘEŽIJE (cascade se nespustí) =='

insert into public.platebni_ucty (tenant_id, branch_id, nazev, typ)
values (:'tenant', :'perla', 'Krok87 bankovní účet', 'banka')
returning id as ucet \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, zdroj)
values (:'tenant', :'ucet', 'prijem', 12300, current_date, 'rucni')
returning id as transakce \gset

select pg_temp.check('přímý DELETE na platebni_ucty je odepřený',
  pg_temp.spadne_hlaskou(
    format('delete from public.platebni_ucty where id = %L', :'ucet'),
    '42501', 'permission denied'));

select pg_temp.check('po pokusu účet STÁLE existuje',
  exists (select 1 from public.platebni_ucty where id = :'ucet'));

select pg_temp.check('po pokusu transakce STÁLE existuje (cascade se nikdy nespustil)',
  exists (select 1 from public.transakce where id = :'transakce'));


\echo ''
\echo '== 2. DELETE na integrace_pripojeni SPADNE — navázaný sync běh PŘEŽIJE =='

insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, platebni_ucet_id)
values (:'tenant', 'banka', 'fio-krok87', 'zakaznicky', 'Krok87 Fio', :'ucet')
returning id as pripojeni \gset

reset role;
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, stav)
values (:'tenant', :'pripojeni', 'hotovo')
returning id as beh \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('přímý DELETE na integrace_pripojeni je odepřený',
  pg_temp.spadne_hlaskou(
    format('delete from public.integrace_pripojeni where id = %L', :'pripojeni'),
    '42501', 'permission denied'));

select pg_temp.check('po pokusu připojení STÁLE existuje',
  exists (select 1 from public.integrace_pripojeni where id = :'pripojeni'));

select pg_temp.check('po pokusu sync běh STÁLE existuje (cascade se nikdy nespustil)',
  exists (select 1 from public.synchronizace_behy where id = :'beh'));


\echo ''
\echo '== 3. DELETE na zbylých čtyřech tabulkách SPADNE =='

insert into public.kontakty (tenant_id, nazev)
values (:'tenant', 'Krok87 dodavatel')
returning id as kontakt \gset

insert into public.kontakty_osoby (tenant_id, kontakt_id, jmeno)
values (:'tenant', :'kontakt', 'Krok87 osoba')
returning id as osoba \gset

insert into public.predpisy_plateb (tenant_id, nazev, smer, castka_haleru, perioda, dalsi_splatnost)
values (:'tenant', 'Krok87 nájem', 'vydaj', 2000000, 'mesicne', current_date + 30)
returning id as predpis \gset

reset role;
insert into public.import_davky (tenant_id, typ, soubor_hash, stav)
values (:'tenant', 'banka_csv', 'krok87-hash', 'zpracovano')
returning id as davka \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('DELETE na kontakty je odepřený',
  pg_temp.spadne_hlaskou(format('delete from public.kontakty where id = %L', :'kontakt'), '42501', 'permission denied'));

select pg_temp.check('DELETE na kontakty_osoby je odepřený',
  pg_temp.spadne_hlaskou(format('delete from public.kontakty_osoby where id = %L', :'osoba'), '42501', 'permission denied'));

select pg_temp.check('DELETE na predpisy_plateb je odepřený',
  pg_temp.spadne_hlaskou(format('delete from public.predpisy_plateb where id = %L', :'predpis'), '42501', 'permission denied'));

select pg_temp.check('DELETE na import_davky je odepřený',
  pg_temp.spadne_hlaskou(format('delete from public.import_davky where id = %L', :'davka'), '42501', 'permission denied'));


\echo ''
\echo '== Úklid ======================================================'

reset role;
delete from public.synchronizace_behy where id = :'beh';
delete from public.integrace_pripojeni where id = :'pripojeni';
delete from public.import_davky where id = :'davka';
delete from public.predpisy_plateb where id = :'predpis';
delete from public.kontakty_osoby where id = :'osoba';
delete from public.kontakty where id = :'kontakt';
delete from public.transakce where id = :'transakce';
delete from public.platebni_ucty where id = :'ucet';

select pg_temp.check('úklid: po scénáři nezůstal žádný účet kroku 87',
  not exists (select 1 from public.platebni_ucty where id = :'ucet'));

select set_config('test.user_id', '', false);

\echo ''
\echo '== KROK 87 HOTOV =============================================='
