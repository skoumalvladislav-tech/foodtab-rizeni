-- Scénář pro krok 92 — rozbor cesty přílohy faktury nesmí volat nepřihlášený.
--
-- Migrace: 20261009100000_faktury_priloha_firma_revoke_anon.sql
-- (dopravek k 20261008100000_faktury_prijem_z_emailu.sql).
--
-- Pokrývá:
--   1. výchozí stav, kvůli kterému revoke nesmí chybět: nová funkce má
--      EXECUTE pro PUBLIC, a tedy i pro anon — a zároveň to, že
--      has_function_privilege tu true vrátit umí (jinak by bod 2 nic
--      neměřil);
--   2. app.faktury_priloha_firma(text): anon ji volat nesmí;
--   3. authenticated a service_role ano — politika faktury_prilohy_select
--      na storage.objects ji volá jako přihlášený.
--
-- Co tu NEJDE ověřit: že revoke jmenuje i `anon`. Čistá databáze nemá
-- výchozí práva Supabase, anon tu EXECUTE dostává jen přes PUBLIC a samotné
-- `revoke … from public` by stačilo. To hlídá text migrací
-- (scripts/provoz-granty.test.mjs). Skutečné zavolání pod rolí anon taky
-- ne: anon nemá USAGE na schéma app, spadlo by i bez revoke.
--
-- Nic nezakládá v tabulkách; stojí jen na migracích.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Výchozí stav: nová funkce má EXECUTE pro PUBLIC, tedy i pro anon ===='

create function pg_temp.krok92_nova(p text) returns text
language sql immutable as $$ select p $$;

select pg_temp.check('nová funkce bez revoke: anon ji volat smí (proto revoke nesmí chybět)',
  has_function_privilege('anon', 'pg_temp.krok92_nova(text)', 'execute'));


\echo ''
\echo '== 2. app.faktury_priloha_firma: nepřihlášený ne ========================'

select pg_temp.check('anon nemá EXECUTE na app.faktury_priloha_firma(text)',
  not has_function_privilege('anon', 'app.faktury_priloha_firma(text)', 'execute'));


\echo ''
\echo '== 3. Přihlášený a úloha ji volat musí ==================================='

select pg_temp.check('authenticated EXECUTE má (volá ji politika faktury_prilohy_select)',
  has_function_privilege('authenticated', 'app.faktury_priloha_firma(text)', 'execute'));

select pg_temp.check('service_role EXECUTE má',
  has_function_privilege('service_role', 'app.faktury_priloha_firma(text)', 'execute'));

set role authenticated;

select pg_temp.check('přihlášený ji opravdu zavolá a dostane firmu z cesty',
  app.faktury_priloha_firma('00000000-0000-0000-0000-000000000092/' || repeat('a', 64) || '.pdf')
    = '00000000-0000-0000-0000-000000000092'::uuid);

reset role;


\echo ''
\echo '== Úklid =================================================================='

drop function pg_temp.krok92_nova(text);

select pg_temp.check('úklid: pomocná funkce je pryč',
  not exists (select 1 from pg_proc where proname = 'krok92_nova'));

\echo ''
\echo '== KROK 92 HOTOV =============================================='
