-- Scénář pro krok 31 — drobnosti, které nesmí zmizet
--
-- Pokrývá migraci 20260908210000_search_path_a_komentar
-- (zadání docs/dodelat-vse-2026-09-08.md, bod 8).
--
-- Obě kontrolované věci jsou takové, že se dají „opravit" k horšímu:
-- prázdný `search_path` někdo při přepisu funkce vypustí, a u tabulky
-- bez politiky někdo politiku dopíše v dobré víře. Proto to hlídá
-- scénář, ne jen komentář.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


\echo ''
\echo '== 1. search_path je nastavený u všech funkcí v app ======'

/*
  Ptá se to na CELÉ schéma, ne na ty tři jmenovitě. Kdyby se ptalo
  jmenovitě, projde to nad čtvrtou funkcí, která ho zapomene mít —
  a přesně tak ty tři vznikly.

  `proconfig` je pole nastavení funkce; hledá se v něm `search_path=`.
*/
select count(*) as bez_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app'
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) as k(v)
    where v like 'search_path=%'
  ) \gset

select pg_temp.check('žádná funkce v app nezůstala bez search_path',
  :'bez_search_path'::int = 0);

-- A jmenovitě ty tři, ať je z výpisu poznat, čeho se to týkalo.
select pg_temp.check('doruci_se, delka_smeny_minut i sablona_poradi ho mají',
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('doruci_se', 'delka_smeny_minut', 'sablona_poradi')
     and exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) as k(v)
       where v like 'search_path=%'
     )) = 3);

/*
  A že se tím nerozbil výpočet. Prázdný `search_path` je u nich
  bezpečný jen proto, že nesahají na tabulky a volají výhradně
  `pg_catalog` — kdyby některá volala něco z `public`, spadne to tady,
  ne až v provozu.
*/
select pg_temp.check('delka_smeny_minut počítá dál, i přes půlnoc',
  app.delka_smeny_minut('08:00', '16:00') = 480
  and app.delka_smeny_minut('22:00', '06:00') = 480);

select pg_temp.check('sablona_poradi rozlišuje dál',
  app.sablona_poradi(null, null, null, null) = 4);


\echo ''
\echo '== 2. zapomenute_odchody zůstává zavřená ================='

/*
  Zapnuté RLS BEZ politiky znamená, že přes `authenticated` neprojde
  ani řádek. Je to žádaný stav — a tahle kontrola tu je proto, aby ho
  někdo v dobré víře „nedodělal".
*/
select pg_temp.check('má zapnuté RLS',
  (select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'zapomenute_odchody'));

select pg_temp.check('a ŽÁDNOU politiku — to je záměr, ne nedodělek',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'zapomenute_odchody') = 0);

-- Zavřená dvakrát: nemá ani grant pro přihlášeného.
select pg_temp.check('ani grant pro authenticated',
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'zapomenute_odchody'
      and grantee = 'authenticated') = 0);

-- A důvod je zapsaný u tabulky, ne jen v migraci.
select pg_temp.check('důvod je v komentáři u tabulky',
  coalesce(obj_description('public.zapomenute_odchody'::regclass, 'pg_class'), '')
    like '%SCHVÁLNĚ ŽÁDNÁ NENÍ%');


\echo ''
\echo '== KROK 31 HOTOV ========================================'
