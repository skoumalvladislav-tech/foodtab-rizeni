-- Scénář pro krok 97 — hlídač plánovače úloh: `public.planovac_zdravi()`.
--
-- Migrace: 20261017100000_planovac_hlidac.sql (navazuje na krok96).
-- Rozhodování hlídače (co je problém) a adresu `/api/planovac/hlidac`
-- hlídá scripts/planovac.test.mjs.
--
-- Pokrývá:
--   1. bez pg_cronu vrátí tentýž stav jako app.planovac_stav() — 9 úloh,
--      nic v cronu;
--   2. s napodobeninami `cron` a `net`: stále PŘESNĚ app.planovac_stav()
--      (žádná vlastní logika, která by se rozešla) — úloha v cronu,
--      poslední volání a kód odpovědi; volání bez odpovědi (zaseknutý
--      pg_net) databáze vykáže jako „zatím bez odpovědi" s chyb_6h 0;
--   3. service_role stav přečte JEN přes planovac_zdravi, app.planovac_stav
--      napřímo ne;
--   4. práva: anon ani authenticated planovac_zdravi nespustí.

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

\echo '-- 1. bez pg_cronu'

select pg_temp.check('planovac_zdravi bez pg_cronu: 9 úloh, nic v cronu',
  (select count(*) = 9 and bool_and(not v_cronu) from public.planovac_zdravi()));
select pg_temp.check('… a je to přesně app.planovac_stav()',
  (select jsonb_agg(to_jsonb(t) order by t.uloha) from public.planovac_zdravi() t)
  = (select jsonb_agg(to_jsonb(t) order by t.uloha) from app.planovac_stav() t));

\echo '-- 2. s napodobeninami cron a net'

create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean not null default true
);
create schema net;
create table net._http_response (
  id          bigint,
  status_code integer,
  timed_out   boolean,
  error_msg   text,
  created     timestamptz not null default now()
);

insert into cron.job (jobname, schedule, command)
values ('foodtab-uloha-pokladna-synchronizace', '40 * * * *', $c$select app.spustit_ulohu('pokladna-synchronizace')$c$);
insert into app.planovac_volani (request_id, uloha, zavolano_kdy)
values (970001, 'pokladna-synchronizace', now() - interval '5 minutes');
insert into net._http_response (id, status_code, created) values (970001, 401, now() - interval '4 minutes');

select pg_temp.check('pokladna: v cronu, poslední kód 401, 1 chyba za 6 h',
  (select v_cronu and posledni_kod = 401 and chyb_6h = 1 and posledni_volani is not null
     from public.planovac_zdravi() where uloha = 'pokladna-synchronizace'));
-- Zaseknutý pg_net: volání před 20 min, odpověď žádná. Databáze to
-- vykáže jako „zatím bez odpovědi" a do chyb_6h to NEPOČÍTÁ — rozpoznat
-- to musí hlídač podle stáří volání (lib/planovac-hlidac.ts, bod 4).
insert into cron.job (jobname, schedule, command)
values ('foodtab-uloha-zapomenuty-odchod', '5 * * * *', $c$select app.spustit_ulohu('zapomenuty-odchod')$c$);
insert into app.planovac_volani (request_id, uloha, zavolano_kdy)
values (970002, 'zapomenuty-odchod', now() - interval '20 minutes');

select pg_temp.check('volání před 20 min bez odpovědi → „zatím bez odpovědi", kód NULL, chyb_6h 0',
  (select posledni_chyba = 'zatím bez odpovědi' and posledni_kod is null and chyb_6h = 0 and volani_6h = 1
          and posledni_volani < now() - interval '19 minutes'
     from public.planovac_zdravi() where uloha = 'zapomenuty-odchod'));

select pg_temp.check('ostatní úlohy v cronu nejsou',
  (select count(*) = 7 from public.planovac_zdravi() where not v_cronu));
select pg_temp.check('pořád přesně app.planovac_stav()',
  (select jsonb_agg(to_jsonb(t) order by t.uloha) from public.planovac_zdravi() t)
  = (select jsonb_agg(to_jsonb(t) order by t.uloha) from app.planovac_stav() t));

\echo '-- 3. service_role'

set role service_role;
select pg_temp.check('service_role stav přečte přes planovac_zdravi',
  (select count(*) = 9 from public.planovac_zdravi()));
select pg_temp.check('… ale app.planovac_stav napřímo ne',
  pg_temp.spadne_hlaskou('select * from app.planovac_stav()', '42501', 'permission denied'));
reset role;

\echo '-- 4. práva'

select pg_temp.check('planovac_zdravi smí service_role',
  has_function_privilege('service_role', 'public.planovac_zdravi()', 'execute'));
select pg_temp.check('planovac_zdravi nesmí anon ani authenticated',
  not has_function_privilege('anon', 'public.planovac_zdravi()', 'execute')
  and not has_function_privilege('authenticated', 'public.planovac_zdravi()', 'execute'));

-- Úklid po scénáři.
drop schema cron cascade;
drop schema net cascade;
delete from app.planovac_volani;

\echo '== KROK 97 HOTOV =============================================='
