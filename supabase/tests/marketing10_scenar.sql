-- Scénář marketing 10 — klíče přes veřejné obálky.
--
-- Pokrývá 20260914100000_marketing_klice_verejne.sql.
-- Zadání: master prompt v2.2, oddíl 3.1 a 6 (obrazovka „Integrace
-- a nástroje").
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE A PROČ TO NENÍ OPIS MARKETING 4
--
-- marketing4 ověřuje funkce ve schématu `app`. Jenže z aplikace se na
-- ně nikdo nedostal: PostgREST vystavuje jen `public`, takže
-- `supabase.rpc('marketing_precti_tajemstvi')` končilo chybou a
-- obrazovka to brala jako „zákazník nemá připojenou vlastní AI".
-- Vlastní klíč zákazníka tedy tiše nedělal nic.
--
-- Tenhle scénář hlídá dvě věci, které se u takové opravy kazí:
--
--   1. ŽE OBÁLKY JSOU V `public`. Kdyby je někdo „uklidil" zpátky do
--      `app`, přestane to fungovat přesně tak tiše jako předtím.
--   2. ŽE OBÁLKA NEPŘIDALA PRÁVA. Je to pár řádků a je lákavé napsat
--      je jako `security definer` — a tím obejít kontrolu, kvůli které
--      ty funkce vznikly.
--
-- ---------------------------------------------------------------------
-- POZNÁMKA K PGLITE
--
-- `set role authenticated` tu roli opravdu přepne, takže kontroly na
-- `insufficient_privilege` uvnitř funkcí kousnou. RLS ne — pod
-- superuživatelem se neuplatní (CLAUDE.md, past u krok9).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cisnik  from public.profiles where email = 'cisnik@foodtab.cz'  \gset
select id as e_majitel from public.employees where user_id = :'majitel' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

insert into public.marketing_pripojeni
  (tenant_id, branch_id, poskytovatel, kategorie, rezim, stav, nazev, pripojil)
values (:'tenant', :'perla', 'anthropic', 'ai_text', 'zakaznicky',
        'pripojuje_se', 'Claude (Anthropic)', :'e_majitel')
returning id as pripojeni \gset

select set_config('test.pripojeni', :'pripojeni', false);


\echo ''
\echo '== Obálky jsou tam, kam na ně aplikace dosáhne =============='

-- Tohle je celá oprava. `app` schéma PostgREST nevystavuje
-- (supabase/config.toml: schemas = ["public", "graphql_public"]),
-- takže funkce mimo `public` jsou z aplikace nedosažitelné.
select pg_temp.check('všechny tři funkce na klíče jsou ve schématu public',
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('marketing_uloz_tajemstvi',
                        'marketing_precti_tajemstvi',
                        'marketing_smaz_tajemstvi')) = 3);

-- A nejsou `security definer`. Kdyby byly, běžely by pod vlastníkem
-- a `app.has_access` uvnitř by se ptalo na jeho práva — tedy na nic.
select pg_temp.check('a ani jedna z nich není security definer',
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('marketing_uloz_tajemstvi',
                        'marketing_precti_tajemstvi',
                        'marketing_smaz_tajemstvi')
      and p.prosecdef) = 0);

select pg_temp.check('nepřihlášený je spustit nesmí',
  not has_function_privilege('anon', 'public.marketing_precti_tajemstvi(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.marketing_uloz_tajemstvi(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.marketing_smaz_tajemstvi(uuid)', 'execute'));

select pg_temp.check('přihlášený je spustit smí — jinak by obrazovka byla k ničemu',
  has_function_privilege('authenticated', 'public.marketing_precti_tajemstvi(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.marketing_uloz_tajemstvi(uuid, text, text)', 'execute'));


\echo ''
\echo '== Obálka nepřidala práva ==================================='

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.marketing_uloz_tajemstvi(
      current_setting('test.pripojeni')::uuid, 'v1.sifra-cisnika', 'otisk-cisnika');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník uložil klíč veřejnou obálkou'; end if;
  raise notice '  OK    kdo nesmí publikovat, klíč veřejnou obálkou neuloží';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.marketing_precti_tajemstvi(current_setting('test.pripojeni')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník přečetl klíč veřejnou obálkou'; end if;
  raise notice '  OK    a nepřečte ho ani';
end $$;


\echo ''
\echo '== Kdo smí publikovat, projde celou cestou =================='

select set_config('test.user_id', :'majitel', false);

select public.marketing_uloz_tajemstvi(:'pripojeni', 'v1.sifra-majitele', 'otisk-majitele');

select pg_temp.check('uložený klíč se přečte zpátky týmiž obálkami',
  public.marketing_precti_tajemstvi(:'pripojeni') = 'v1.sifra-majitele');

-- Uhodnuté id nepomůže: funkce si připojení nejdřív dohledá a bez
-- něj se na práva ani nedostane.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.marketing_precti_tajemstvi('00000000-0000-0000-0000-0000000000ff'::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neexistující připojení vrátilo klíč místo odmítnutí'; end if;
  raise notice '  OK    uhodnuté id připojení skončí odmítnutím, ne prázdnem';
end $$;


\echo ''
\echo '== Odpojení klíč smaže a v auditu nechá jen otisk ==========='

select public.marketing_smaz_tajemstvi(:'pripojeni');

reset role;

select pg_temp.check('klíč po odpojení v databázi není',
  (select count(*) from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') = 0);

/*
  Nejtišší únik by nebyl z tabulky s klíči, ale z auditu: kdyby se
  na ni pověsila `app.audit_zmenu`, rozkopírovala by šifru do
  `audit_log`, kterou čte kdekdo. Proto se hledá ŘETĚZEC, ne sloupec.
*/
select pg_temp.check('a šifra se nikde v auditu neobjevila',
  (select count(*) from public.audit_log
    where entity_id = :'pripojeni'
      and (before::text like '%sifra-majitele%' or after::text like '%sifra-majitele%')) = 0);

select pg_temp.check('zato otisk v auditu je — aby šlo poznat, že se klíč měnil',
  (select count(*) from public.audit_log
    where entity_id = :'pripojeni'
      and action in ('marketing.klic_ulozen', 'marketing.klic_smazan')) = 2);


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_tajemstvi where tenant_id = :'tenant';
delete from public.marketing_pripojeni where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_pripojeni where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 10 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
