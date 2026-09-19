-- Scénář pro krok 38 — čtení sloupců pobočky pod rolí authenticated
--
-- Pokrývá migraci 20260919100000_pobocky_grant_sloupce.
--
-- CO SE STALO. `branches` nemá celotabulkový `select`, jen granty po
-- sloupcích. Migrace 20260916160000 (fotka pozadí) a 20260916170000
-- (počasí) obě udělaly `revoke select … ; grant select (pevný výčet)`
-- a ve výčtu chyběly tři sloupce, které dostaly grant dřív:
-- ranni_email_komu, prestavka_minut a prestavka_od_minut. Nastavení →
-- Firma si o první z nich řekne a dostane `42501` dřív, než se dostane
-- na řádky — nespadl sloupec, spadla celá obrazovka.
--
-- PROČ TOHLE NEJDE ZKONTROLOVAT ČTENÍM POD ROLÍ. Lokální běh je
-- superuživatel a `set role authenticated` na něj nemá vliv, takže
-- `select ranni_email_komu from branches` projde i nad rozbitým grantem
-- (viz hlavička scripts/scenare-pglite.mjs). Proto se tu neptáme
-- dotazem na data, ale KATALOGU: `has_column_privilege` čte přímo ACL
-- sloupce a spadne, i když běžíme jako superuživatel.
--
-- PROČ SE PTÁ NA CELOU TABULKU, ne na tři jmenovité sloupce. Kdyby se
-- ptalo jen na ně, projde to i příště, až někdo přidá čtvrtý sloupec
-- a zapomene ho — přesně tak vznikly tyhle tři. Výjimka je jediná
-- a je zapsaná nahlas: `kiosk_secret`. Kdo přidá další tajný sloupec,
-- musí ho sem dopsat, a je to tak správně — o tajemství se rozhoduje
-- vědomě, ne omylem.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


\echo ''
\echo '== 1. Každý sloupec branches je čitelný, kromě tajemství =='

select coalesce(string_agg(a.attname, ', ' order by a.attname), '') as bez_cteni
from pg_attribute a
where a.attrelid = 'public.branches'::regclass
  and a.attnum > 0
  and not a.attisdropped
  and not has_column_privilege('authenticated', 'public.branches', a.attname, 'SELECT') \gset

-- Výpis je součást názvu kontroly: když spadne, hned je vidět, KTERÉ
-- sloupce grant nemají, a nemusí se to dohledávat.
select pg_temp.check(
  'jediný sloupec bez čtení je kiosk_secret (nyní bez čtení: ' || :'bez_cteni' || ')',
  :'bez_cteni' = 'kiosk_secret');


\echo ''
\echo '== 2. Tři sloupce, které přepsaly migrace z 16. 9. ========='

select pg_temp.check('ranni_email_komu — Nastavení → Firma, ranní přehled',
  has_column_privilege('authenticated', 'public.branches', 'ranni_email_komu', 'SELECT'));

select pg_temp.check('prestavka_minut — přestávka pobočky',
  has_column_privilege('authenticated', 'public.branches', 'prestavka_minut', 'SELECT'));

select pg_temp.check('prestavka_od_minut — přestávka pobočky',
  has_column_privilege('authenticated', 'public.branches', 'prestavka_od_minut', 'SELECT'));


\echo ''
\echo '== 3. Tajemství zůstává zavřené ========================='

/*
  Opačný směr, aby oprava nešla „vyřešit" plošným grantem. `kiosk_secret`
  je klíč, kterým se ověřuje tablet na provozovně; přihlášený ho číst
  nesmí ani na vlastní pobočce (20260901170000_zarizeni_pobocky.sql).
*/
select pg_temp.check('kiosk_secret nemá čtení pro authenticated',
  not has_column_privilege('authenticated', 'public.branches', 'kiosk_secret', 'SELECT'));

select pg_temp.check('a celá tabulka nemá plošný select (sloupcové granty zůstaly)',
  not has_table_privilege('authenticated', 'public.branches', 'SELECT'));

-- anon nemá sahat na pobočky vůbec (20260917000000_granty_provoz_uklid).
select pg_temp.check('anon nečte žádný sloupec branches',
  not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.branches'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', 'public.branches', a.attname, 'SELECT')));


\echo ''
\echo '== KROK 38 HOTOV ========================================'
