-- Scénář marketing 6 — hodina na zdi → okamžik.
--
-- Pokrývá 20260910020000_marketing_okamzik.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 3.
--
-- ---------------------------------------------------------------------
-- PROČ TOHLE MÁ VLASTNÍ SCÉNÁŘ
--
-- CLAUDE.md, pravidlo 11: „Ty dvě chyby se na obrazovce vyruší." Co se
-- zadá jako 18:00, se jako 18:00 i ukáže — a přitom se příspěvek
-- zveřejní o dvě hodiny jinde. Poznat to jde jen tak, že se ULOŽENÝ
-- OKAMŽIK ověří zvlášť, ne přes zpětné zobrazení.
--
-- Klíčová kontrola je poslední: LÉTO A ZIMA MUSÍ VYJÍT JINAK. Paušální
-- posun o dvě hodiny (nebo o jednu) projde všemi ostatními kontrolami
-- a spadne až na téhle — proto tu je, i když vypadá jako opakování.
--
-- ---------------------------------------------------------------------
-- NEZÁVISÍ NA KALENDÁŘI
--
-- Data jsou pevná (leden a červenec 2026) a převádí se VÝSLOVNĚ ZADANÝ
-- den, ne `now()`. Scénář proto platí stejně ve 23:50 jako v poledne
-- a stejně za rok — past ze `scenar`, oddíl 5, se tu nemůže stát.

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

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);


\echo ''
\echo '== Pobočka opravdu stojí v Praze ============================'

-- Bez tohohle by kontroly níž měřily něco jiného, než si myslíme:
-- kdyby pobočka byla v UTC, „leto ≠ zima" by neplatilo a nikdo by
-- nepoznal, že je to proto, a ne kvůli rozbitému převodu.
select pg_temp.check('Černá Perla má pásmo Europe/Prague',
  app.zona_pobocky(:'perla') = 'Europe/Prague');


\echo ''
\echo '== Letní čas: 18:00 v Praze je 16:00 UTC ===================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('červencová osmnáctá je 16:00 UTC',
  public.marketing_okamzik(:'perla', '2026-07-15 18:00'::timestamp)
    = '2026-07-15 16:00:00+00'::timestamptz);


\echo ''
\echo '== Zimní čas: 18:00 v Praze je 17:00 UTC ===================='

select pg_temp.check('lednová osmnáctá je 17:00 UTC',
  public.marketing_okamzik(:'perla', '2026-01-15 18:00'::timestamp)
    = '2026-01-15 17:00:00+00'::timestamptz);


\echo ''
\echo '== LÉTO A ZIMA VYJDOU JINAK ================================='

/*
  Tohle je ta kontrola, kvůli které scénář existuje.

  Paušální posun („prostě přičti dvě hodiny") projde obě kontroly výš,
  pokud se napíše se správnou konstantou pro jedno z ročních období —
  a spadne teprve tady. Porovnává se ROZDÍL posunů: v létě +2, v zimě
  +1, tedy o hodinu jinak.
*/
select pg_temp.check('posun se mezi lednem a červencem liší o hodinu',
  extract(epoch from (
    public.marketing_okamzik(:'perla', '2026-01-15 18:00'::timestamp)
    - '2026-01-15 18:00:00+00'::timestamptz
  )) -
  extract(epoch from (
    public.marketing_okamzik(:'perla', '2026-07-15 18:00'::timestamp)
    - '2026-07-15 18:00:00+00'::timestamptz
  )) = 3600);


\echo ''
\echo '== Kdo na pobočku nemá, pásmo nezjistí ======================'

-- Funkce je `security definer`, takže si RLS neuplatní sama. Bez
-- vlastní kontroly by z ní kdokoli vytáhl, v jakém pásmu stojí cizí
-- provozovna — drobnost, ale je to únik přes funkci, která se tváří
-- jako počítadlo.

select set_config('test.user_id', :'cisnik', false);

do $$
declare v_ok boolean := false; v_kdy timestamptz;
begin
  begin
    v_kdy := public.marketing_okamzik(
      current_setting('test.perla')::uuid, '2026-07-15 18:00'::timestamp);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník bez marketing.read převedl čas'; end if;
  raise notice '  OK    kdo nemá marketing.read, čas nepřevede';
end $$;


\echo ''
\echo '== Neexistující pobočka ====================================='

select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false; v_kdy timestamptz;
begin
  begin
    v_kdy := public.marketing_okamzik(
      '00000000-0000-0000-0000-000000000000'::uuid, '2026-07-15 18:00'::timestamp);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neexistující pobočka prošla'; end if;
  raise notice '  OK    neexistující pobočka neprojde';
end $$;


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  not exists (select 1 from public.tenant_modules
               where tenant_id = :'tenant' and module_key = 'marketing'));


\echo ''
\echo '=========================================================='
\echo ' MARKETING 6 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
