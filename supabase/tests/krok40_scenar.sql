-- Scénář pro krok 40 — stav potvrzení směn pro celý rozpis.
--
-- Pokrývá migraci 20260920100000_stav_potvrzeni_smen (puntík u času směny:
-- červený nevydáno, žlutý vydáno a nepotvrzeno, zelený vydáno a potvrzeno).
--
-- Kontroly stojí na výsledku funkce; oprávnění pobočky se ověřuje přes
-- `app.has_access`, které čte `test.user_id` (harness), takže funguje i
-- nad PGlite. Co PGlite neověří — RLS a granty na roli — hlídá běh nad
-- PostgreSQL 16 (workflow Databáze).

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
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

-- Zaměstnanec s účtem — dostává upozornění.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'vedouci', 'Účet Vedoucí', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'vedouci');
select id as e_ucet from public.employees
 where tenant_id = :'tenant' and user_id = :'vedouci' limit 1 \gset


\echo ''
\echo '== 1. Poslední upozornění na směnu ======================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s1 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-03', time '08:00', time '16:00', 'první') \gset
select smena as s2 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-11-04', time '08:00', time '16:00', 'druhá') \gset

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (count(*) = 2)::text                                  as p_dve,
       (bool_and(druh = 'smena.nova'))::text                 as p_nova,
       (bool_and(precteno_at is null and potvrzeno_at is null))::text as p_nic
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30') \gset

reset role;

select pg_temp.check('okno vrátí obě směny, každou jednou', :'p_dve' = 'true');
select pg_temp.check('nové směny mají druh smena.nova', :'p_nova' = 'true');
select pg_temp.check('zatím je nikdo nepřečetl ani nepotvrdil', :'p_nic' = 'true');

-- Člověk první směnu přečetl.
update public.notifications set read_at = now()
 where shift_id = :'s1' and druh = 'smena.nova';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (precteno_at is not null and potvrzeno_at is null)::text as p_precteno
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30')
where smena_id = :'s1' \gset

reset role;

select pg_temp.check('přečtená, ale nepotvrzená: precteno_at je, potvrzeno_at ne', :'p_precteno' = 'true');

-- Změna času první směny = nové upozornění (druh smena.zmenena); to staré se
-- posune do minulosti, ať je jasné, které je poslední.
update public.notifications set created_at = created_at - interval '1 hour'
 where shift_id = :'s1' and druh = 'smena.nova';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-11-03', time '10:00', time '18:00', 'posun') \gset

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (druh = 'smena.zmenena' and precteno_at is null and potvrzeno_at is null)::text as p_zmena
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30')
where smena_id = :'s1' \gset

select (count(*) = 1)::text as p_jedna
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30')
where smena_id = :'s1' \gset

reset role;

select pg_temp.check('po změně platí poslední upozornění: smena.zmenena, zatím nepřečtené', :'p_zmena' = 'true');
select pg_temp.check('a směna je ve výsledku pořád jen jednou', :'p_jedna' = 'true');

-- Člověk změnu potvrdil.
update public.notifications set read_at = now(), acknowledged_at = now()
 where shift_id = :'s1' and druh = 'smena.zmenena';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (druh = 'smena.zmenena' and precteno_at is not null and potvrzeno_at is not null)::text as p_potvrzeno
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30')
where smena_id = :'s1' \gset

reset role;

select pg_temp.check('potvrzená změna: precteno_at i potvrzeno_at', :'p_potvrzeno' = 'true');


\echo ''
\echo '== 2. Okno, firma, zrušené směny =========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (count(*) = 0)::text as p_mimo
from public.stav_potvrzeni_smen(:'tenant', date '2026-12-01', date '2026-12-31') \gset

select (count(*) = 0)::text as p_obracene
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-30', date '2026-11-01') \gset

select (count(*) = 0)::text as p_cizi_firma
from public.stav_potvrzeni_smen(gen_random_uuid(), date '2026-11-01', date '2026-11-30') \gset

reset role;

select pg_temp.check('okno mimo směny vrátí prázdno', :'p_mimo' = 'true');
select pg_temp.check('obrácené okno (do před od) vrátí prázdno, ne chybu', :'p_obracene' = 'true');
select pg_temp.check('cizí firma (jiné tenant_id) nevrátí nic', :'p_cizi_firma' = 'true');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select set_config('test.tenant', :'tenant', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform * from public.stav_potvrzeni_smen(
      current_setting('test.tenant')::uuid, date '2026-01-01', date '2026-12-31');
  exception when invalid_parameter_value then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: okno na celý rok prošlo'; end if;
end $$;

reset role;

select pg_temp.check('okno delší než 93 dní se odmítne', true);

-- Zrušená směna se nekreslí, takže ji funkce nevrací.
update public.shifts set status = 'cancelled' where id = :'s2';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (count(*) = 0)::text as p_zrusena
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30')
where smena_id = :'s2' \gset

reset role;

select pg_temp.check('zrušená směna ve výsledku není', :'p_zrusena' = 'true');


\echo ''
\echo '== 3. Pobočky, kde volající neplánuje ====================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_bar from public.ulozit_smenu(
  :'tenant', null, :'bar', :'e_ucet', null,
  date '2026-11-05', time '08:00', time '16:00', 'na baru') \gset

reset role;

-- Majitel vidí obě pobočky.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (count(*) filter (where smena_id = :'s1') = 1
        and count(*) filter (where smena_id = :'s_bar') = 1)::text as p_majitel_obe
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30') \gset

reset role;

select pg_temp.check('majitel dostane potvrzení z Perly i z Baru', :'p_majitel_obe' = 'true');

-- Vedoucí Perly plánuje jen na Perle: Bar se vynechá, ne odmítne.
set role authenticated;
select set_config('test.user_id', :'vedouci', false);

select (count(*) filter (where smena_id = :'s1') = 1)::text as p_ved_perla
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30') \gset

select (count(*) filter (where smena_id = :'s_bar') = 0)::text as p_ved_bar
from public.stav_potvrzeni_smen(:'tenant', date '2026-11-01', date '2026-11-30') \gset

reset role;

select pg_temp.check('vedoucí Perly dostane směnu z Perly', :'p_ved_perla' = 'true');
select pg_temp.check('… ale směnu z Baru, který nespravuje, ne — a bez chyby', :'p_ved_bar' = 'true');


\echo ''
\echo '== 4. Co funkce nevrací a kdo ji smí volat ================'

select pg_temp.check('výsledek nemá sloupec s obsahem (telo)',
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stav_potvrzeni_smen'
      and pg_get_function_result(p.oid) ilike '%telo%'));

select pg_temp.check('anon funkci volat nesmí',
  not has_function_privilege('anon', 'public.stav_potvrzeni_smen(uuid, date, date)', 'execute'));

select pg_temp.check('přihlášený smí (právo se ověřuje uvnitř, na pobočce)',
  has_function_privilege('authenticated', 'public.stav_potvrzeni_smen(uuid, date, date)', 'execute'));


\echo ''
\echo ' VŠECHNY KONTROLY KROKU 40 PROŠLY'
