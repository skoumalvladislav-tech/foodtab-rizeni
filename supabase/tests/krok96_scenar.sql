-- Scénář pro krok 96 — plánovač úloh v databázi (pg_cron + pg_net + Vault)
-- a zámek proti dvojímu spuštění.
--
-- Migrace: 20261014120000_planovac_pg_cron.sql. Návod: docs/planovac-pg-cron.md.
-- Aplikační půlku (401 za neplatné tajemství, zámek v každé adrese,
-- shoda jmen a plánů) hlídá scripts/planovac.test.mjs.
--
-- Pokrývá:
--   1. bez rozšíření a bez Vaultu nic nejde naplánovat ani zavolat —
--      a hláška řekne, co chybí;
--   2. Vault bez adresy / bez tajemství / http:// / tajemství s novým
--      řádkem → odmítnuto, NIC se neodeslalo a hláška tajemství
--      neobsahuje;
--   3. zavolání: přesně jeden požadavek na https://…/api/uloha/<úloha>
--      s Bearer tajemstvím a timeoutem = limit; neznámá úloha a jméno
--      s lomítkem odmítnuty bez požadavku;
--   4. naplánování: 9 úloh + úklid, plán z tabulky, text úlohy v cronu
--      tajemství NEOBSAHUJE, opakované naplánování nic nezdvojí,
--      úloha vyřazená z tabulky z cronu zmizí, zrušení smaže vše;
--   5. zámek `uloha_zabrat`: první true, druhý false, po vypršení zase
--      true; neznámá úloha odmítnuta; `uloha_uvolnit` pustí další kolo
--      hned a vypršený zámek nepřepíše;
--   6. stav: poslední kód odpovědi podle čísla požadavku;
--   7. úklid maže staré záznamy;
--   8. práva: anon/authenticated/service_role na plánovač nedosáhnou,
--      `uloha_zabrat` smí jen service_role.
--
-- `cron`, `net` a `vault` jsou tu NAPODOBENINY se stejnými jmény
-- a podpisy jako na Supabase (cron.schedule upsertuje podle jména jako
-- pg_cron ≥ 1.4). Po scénáři se smažou.

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

-- Hláška chyby (nebo NULL, když chyba nebyla) — na kontrolu, co v ní NENÍ.
create or replace function pg_temp.hlaska(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

reset role;
select set_config('test.user_id', '', false);

\echo '-- 1. bez rozšíření a bez Vaultu'

select pg_temp.check('naplanovat_ulohy bez pg_cron → „Chybí rozšíření pg_cron"',
  pg_temp.spadne_hlaskou('select * from app.naplanovat_ulohy()', '55000', 'pg_cron'));

select pg_temp.check('spustit_ulohu bez pg_net → „Chybí rozšíření pg_net"',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '55000', 'pg_net'));

select pg_temp.check('planovac_cil bez Vaultu → „Chybí Supabase Vault"',
  pg_temp.spadne_hlaskou($$select * from app.planovac_cil('pokladna-synchronizace')$$, '55000', 'Vault'));

select pg_temp.check('zrusit_planovac bez pg_cron nic nedělá (0)',
  app.zrusit_planovac() = 0);

select pg_temp.check('stav bez pg_cron: 9 úloh, nic v cronu, hláška „není zapnutý"',
  (select count(*) = 9 and bool_and(not v_cronu) and bool_and(posledni_chyba like '%není zapnutý%')
     from app.planovac_stav()));

-- ---------------------------------------------------------------------
-- Napodobeniny `cron`, `net`, `vault`.
-- ---------------------------------------------------------------------

create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean not null default true,
  username text not null default current_user
);
create table cron.job_run_details (
  runid    bigserial primary key,
  jobid    bigint,
  end_time timestamptz
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d)
$$;

create schema net;
create table net.odeslane (
  id                   bigserial primary key,
  url                  text,
  params               jsonb,
  headers              jsonb,
  timeout_milliseconds integer
);
create table net._http_response (
  id           bigint,
  status_code  integer,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz not null default now()
);
create function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 2000
) returns bigint
language sql as $$
  insert into net.odeslane (url, params, headers, timeout_milliseconds)
  values (url, params, headers, timeout_milliseconds)
  returning id
$$;

create schema vault;
create table vault.secrets (name text primary key, secret text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;

\echo '-- 2. Vault: chybějící a špatné hodnoty'

select pg_temp.check('bez adresy ve Vaultu → „chybí foodtab_app_url"',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '55000', 'foodtab_app_url'));

insert into vault.secrets values ('foodtab_app_url', 'https://foodtab.example.cz/');

select pg_temp.check('bez tajemství ve Vaultu → „chybí foodtab_cron_secret"',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '55000', 'foodtab_cron_secret'));

insert into vault.secrets values ('foodtab_cron_secret', '');
select pg_temp.check('prázdné tajemství → odmítnuto',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '55000', 'foodtab_cron_secret'));

update vault.secrets set secret = E'tajne-ABC-123\n' where name = 'foodtab_cron_secret';
select pg_temp.check('tajemství s novým řádkem na konci → odmítnuto',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '22023', 'novým řádkem'));
select pg_temp.check('… a hláška tajemství neobsahuje',
  pg_temp.hlaska($$select app.spustit_ulohu('pokladna-synchronizace')$$) not like '%tajne-ABC%');

update vault.secrets set secret = 'tajne-ABC-123' where name = 'foodtab_cron_secret';

update vault.secrets set secret = 'http://foodtab.example.cz' where name = 'foodtab_app_url';
select pg_temp.check('http:// → odmítnuto (tajemství se po http neposílá)',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '22023', 'https'));

update vault.secrets set secret = 'https://zlo.example@foodtab.example.cz' where name = 'foodtab_app_url';
select pg_temp.check('adresa se jménem@ → odmítnuto',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '22023', 'https'));

update vault.secrets set secret = 'https://foodtab.example.cz/jina/cesta' where name = 'foodtab_app_url';
select pg_temp.check('adresa s cestou → odmítnuto',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('pokladna-synchronizace')$$, '22023', 'https'));

select pg_temp.check('nic z toho neodeslalo požadavek',
  (select count(*) = 0 from net.odeslane));

update vault.secrets set secret = ' https://foodtab.example.cz/ ' where name = 'foodtab_app_url';

\echo '-- 3. zavolání úlohy'

select app.spustit_ulohu('pokladna-synchronizace') as pozadavek \gset

select pg_temp.check('jeden požadavek, adresa bez dvojitého lomítka',
  (select count(*) = 1 and bool_and(url = 'https://foodtab.example.cz/api/uloha/pokladna-synchronizace')
     from net.odeslane));
select pg_temp.check('hlavička Authorization: Bearer <tajemství> a nic víc',
  (select headers = '{"Authorization": "Bearer tajne-ABC-123"}'::jsonb from net.odeslane));
select pg_temp.check('timeout = limit úlohy (90 s)',
  (select timeout_milliseconds = 90000 from net.odeslane));
select pg_temp.check('volání zapsané pod číslem požadavku',
  (select count(*) = 1 from app.planovac_volani
    where request_id = :pozadavek and uloha = 'pokladna-synchronizace'));

select pg_temp.check('neznámá úloha → 22023',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('neexistuje')$$, '22023', 'nezná'));
select pg_temp.check('jméno s lomítkem → 22023',
  pg_temp.spadne_hlaskou($$select app.spustit_ulohu('../admin')$$, '22023', 'nezná'));
select pg_temp.check('… a ani jedno nic neodeslalo',
  (select count(*) = 1 from net.odeslane));

select pg_temp.check('tabulka nepřijme jméno, které by rozbilo adresu',
  pg_temp.spadne_hlaskou($$insert into app.planovac_ulohy values ('../x', '* * * * *', 60)$$, '23514', 'planovac_ulohy'));

\echo '-- 4. naplánování'

select count(*) as pred from net.odeslane \gset

select pg_temp.check('naplanovat_ulohy vrátí 9 úloh',
  (select count(*) = 9 from app.naplanovat_ulohy()));
select pg_temp.check('v cronu 9 úloh + úklid',
  (select count(*) = 10 from cron.job where jobname like 'foodtab-%'));
select pg_temp.check('plán každé úlohy = tabulka',
  not exists (select 1 from app.planovac_ulohy u
               where not exists (select 1 from cron.job j
                                  where j.jobname = 'foodtab-uloha-' || u.uloha and j.schedule = u.plan_utc)));
select pg_temp.check('text úlohy volá app.spustit_ulohu jménem',
  (select command = $c$select app.spustit_ulohu('zapomenuty-odchod')$c$
     from cron.job where jobname = 'foodtab-uloha-zapomenuty-odchod'));
select pg_temp.check('ŽÁDNÁ úloha v cronu neobsahuje tajemství ani adresu',
  not exists (select 1 from cron.job where command like '%tajne-ABC%' or command like '%example.cz%'));

select pg_temp.check('naplánování samo nic neodeslalo',
  (select count(*) = :pred from net.odeslane));

select count(*) from app.naplanovat_ulohy();
select pg_temp.check('opakované naplánování nic nezdvojí',
  (select count(*) = 10 from cron.job where jobname like 'foodtab-%'));

insert into app.planovac_ulohy (uloha, plan_utc, limit_sekund) values ('zkusebni-uloha', '1 * * * *', 60);
select count(*) from app.naplanovat_ulohy();
select pg_temp.check('nová úloha v tabulce → v cronu',
  exists (select 1 from cron.job where jobname = 'foodtab-uloha-zkusebni-uloha'));
delete from app.planovac_ulohy where uloha = 'zkusebni-uloha';
select count(*) from app.naplanovat_ulohy();
select pg_temp.check('úloha vyřazená z tabulky z cronu zmizí',
  not exists (select 1 from cron.job where jobname = 'foodtab-uloha-zkusebni-uloha')
  and (select count(*) = 10 from cron.job where jobname like 'foodtab-%'));

-- Cizí úloha v cronu (jiný prefix) zůstane netknutá.
select cron.schedule('jina-uloha', '0 0 * * *', 'select 1');

delete from vault.secrets where name = 'foodtab_cron_secret';
select pg_temp.check('naplánování bez tajemství → odmítnuto…',
  pg_temp.spadne_hlaskou('select * from app.naplanovat_ulohy()', '55000', 'foodtab_cron_secret'));
select pg_temp.check('… a cron zůstal, jak byl',
  (select count(*) = 10 from cron.job where jobname like 'foodtab-%'));
insert into vault.secrets values ('foodtab_cron_secret', 'tajne-ABC-123');

\echo '-- 5. zámek uloha_zabrat'

select pg_temp.check('první zabrání → true',
  public.uloha_zabrat('notifikace-push'));
select pg_temp.check('… zapíše začátek a zámek na limit (300 s)',
  (select posledni_zacatek > now() - interval '1 minute'
          and zamceno_do - posledni_zacatek = interval '300 seconds'
     from app.planovac_ulohy where uloha = 'notifikace-push'));
select pg_temp.check('druhé zabrání téže úlohy → false',
  not public.uloha_zabrat('notifikace-push'));
select pg_temp.check('jiná úloha je volná',
  public.uloha_zabrat('marketing-fronta'));

update app.planovac_ulohy set zamceno_do = now() - interval '1 second' where uloha = 'notifikace-push';
select pg_temp.check('po vypršení zámku → zase true',
  public.uloha_zabrat('notifikace-push'));

select pg_temp.check('neznámá úloha → 22023',
  pg_temp.spadne_hlaskou($$select public.uloha_zabrat('neexistuje')$$, '22023', 'Neznámá'));

-- Uvolnění (úloha volaná ve smyčce): další kolo hned zabere znovu.
select pg_temp.check('faktury: zabráno, druhé kolo bez uvolnění → false',
  public.uloha_zabrat('faktury-z-emailu') and not public.uloha_zabrat('faktury-z-emailu'));
select public.uloha_uvolnit('faktury-z-emailu');
select pg_temp.check('po uloha_uvolnit → další kolo zabere hned',
  public.uloha_zabrat('faktury-z-emailu'));

-- Vypršený zámek uvolnění nepřepíše (podmínka `zamceno_do > now()`).
update app.planovac_ulohy set zamceno_do = now() - interval '1 minute' where uloha = 'faktury-z-emailu';
select public.uloha_uvolnit('faktury-z-emailu');
select pg_temp.check('uvolnění sáhne jen na platný zámek',
  (select zamceno_do < now() from app.planovac_ulohy where uloha = 'faktury-z-emailu'));

\echo '-- 6. stav'

insert into net._http_response (id, status_code, created) values (:pozadavek, 401, now() + interval '1 second');

select pg_temp.check('stav: pokladna v cronu, poslední kód 401, chyba „HTTP 401", 1 chyba za 6 h',
  (select v_cronu and posledni_kod = 401 and posledni_chyba = 'HTTP 401' and volani_6h = 1 and chyb_6h = 1
     from app.planovac_stav() where uloha = 'pokladna-synchronizace'));
select pg_temp.check('stav: notifikace-push má začátek z aplikace, žádné volání z cronu',
  (select posledni_zacatek is not null and posledni_volani is null and volani_6h = 0
     from app.planovac_stav() where uloha = 'notifikace-push'));

\echo '-- 7. úklid'

insert into app.planovac_volani (request_id, uloha, zavolano_kdy)
values (999999, 'banka-synchronizace', now() - interval '15 days');
insert into cron.job_run_details (jobid, end_time)
select jobid, now() - interval '15 days' from cron.job where jobname = 'foodtab-uloha-banka-synchronizace';
insert into cron.job_run_details (jobid, end_time)
select jobid, now() - interval '15 days' from cron.job where jobname = 'jina-uloha';

select app.planovac_uklid();

select pg_temp.check('úklid smazal volání starší 14 dnů, čerstvé nechal',
  not exists (select 1 from app.planovac_volani where request_id = 999999)
  and exists (select 1 from app.planovac_volani where request_id = :pozadavek));
select pg_temp.check('úklid smazal starou historii našich úloh, cizí nechal',
  (select count(*) = 1 from cron.job_run_details));

\echo '-- 4b. zrušení'

select pg_temp.check('zrusit_planovac odebere 10 úloh',
  app.zrusit_planovac() = 10);
select pg_temp.check('… a cizí úlohu v cronu nechá',
  (select count(*) = 1 from cron.job) and exists (select 1 from cron.job where jobname = 'jina-uloha'));

\echo '-- 8. práva'

select pg_temp.check('anon, authenticated ani service_role nespustí nic z plánovače',
  not exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role']) r(role),
           unnest(array['app.planovac_cil(text)', 'app.spustit_ulohu(text)', 'app.naplanovat_ulohy()',
                        'app.zrusit_planovac()', 'app.planovac_uklid()', 'app.planovac_stav()']) f(fn)
     where has_function_privilege(r.role, f.fn, 'execute')));

select pg_temp.check('… ani tabulky plánovače nepřečtou',
  not exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role']) r(role),
           unnest(array['app.planovac_ulohy', 'app.planovac_volani']) t(tab)
     where has_table_privilege(r.role, t.tab, 'select, insert, update, delete')));

select pg_temp.check('uloha_zabrat smí service_role',
  has_function_privilege('service_role', 'public.uloha_zabrat(text)', 'execute'));
select pg_temp.check('uloha_zabrat nesmí anon ani authenticated',
  not has_function_privilege('anon', 'public.uloha_zabrat(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.uloha_zabrat(text)', 'execute'));

select pg_temp.check('uloha_uvolnit smí service_role',
  has_function_privilege('service_role', 'public.uloha_uvolnit(text)', 'execute'));
select pg_temp.check('uloha_uvolnit nesmí anon ani authenticated',
  not has_function_privilege('anon', 'public.uloha_uvolnit(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.uloha_uvolnit(text)', 'execute'));

-- Úklid po scénáři: napodobeniny pryč, zámky a volání zpět.
drop schema cron cascade;
drop schema net cascade;
drop schema vault cascade;
delete from app.planovac_volani;
update app.planovac_ulohy set zamceno_do = null, posledni_zacatek = null;

\echo '== KROK 96 HOTOV =============================================='
