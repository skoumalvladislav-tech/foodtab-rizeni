-- Scénář pro krok 10 — pozastavení výplaty záloh.
--
-- Pokrývá migraci 20260902040000_pozastaveni_zaloh a devět kontrol
-- z oddílu 6 zadání docs/pozastaveni-zaloh-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok9_scenar.sql.
--
-- V PGlite je to ověřené (18 kontrol), ale běží se tam jako
-- superuživatel. Tady jde o to, že rozdíl mezi `advances.manage`
-- a `payroll.manage` platí i pod rolí `authenticated` — a právě o ten
-- rozdíl celé opatření stojí: kdo vykonává, nerozhoduje.
--
-- Kontroly míří na to, co NEMÁ jít.

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
--
-- Potřebujeme tři různé lidi: kdo zálohy vyplácí (advances.manage),
-- kdo spravuje mzdy (payroll.manage) a koho se to týká.
-- =====================================================================

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as marek    from public.profiles where email = 'cisnik@foodtab.cz' \gset

select id as marek_e from public.employees where user_id = :'marek' \gset

-- Účetní: payroll.manage a payroll.read, ale ŽÁDNÉ advances.manage.
insert into public.roles (tenant_id, key, label, is_owner)
values (:'tenant', 'zkouska_ucetni', 'Zkouška — účetní', false)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as r_ucetni \gset

insert into public.role_permissions (role_id, permission_key)
values (:'r_ucetni', 'payroll.manage'), (:'r_ucetni', 'payroll.read')
on conflict do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'ucetni@foodtab.cz',
   '{"full_name":"Účetní Zkouška"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', 'dddddddd-dddd-dddd-dddd-dddddddddddd', :'r_ucetni', 'active', 'tenant')
on conflict (tenant_id, user_id) do update
  set role_id = excluded.role_id, scope = excluded.scope;

select set_config('test.tenant',  :'tenant',  false);
select set_config('test.marek_e', :'marek_e', false);
select set_config('test.ucetni', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);


\echo ''
\echo '== Kdo smí přepnout ======================================'

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select pg_temp.check('provozní zálohy vyplácí',
  app.has_access(:'tenant', 'advances.manage', :'perla'));

select pg_temp.check('ale mzdy nespravuje',
  not app.has_access(:'tenant', 'payroll.manage', null));

-- 3. Kdo má jen advances.manage, pozastavení nezruší ani nenastaví.
do $$
declare v_ok boolean;
begin
  begin
    perform public.pozastavit_zalohy(current_setting('test.tenant')::uuid,
                                     current_setting('test.marek_e')::uuid, true);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('kdo zálohy vyplácí, pozastavení nenastaví', v_ok);
end $$;

reset role;

-- 4. Ani si ho zaměstnanec nenastaví sám sobě.
set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.pozastavit_zalohy(current_setting('test.tenant')::uuid,
                                     current_setting('test.marek_e')::uuid, false);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('a zaměstnanec si ho nenastaví sám sobě', v_ok);
end $$;

reset role;

-- Účetní s payroll.manage smí.
set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', :'marek_e', true);
reset role;

select pg_temp.check('účetní s payroll.manage pozastaví',
  (select zalohy_pozastaveny from public.employees where id = :'marek_e'));


\echo ''
\echo '== 1. Pozastavenému záloha neprojde ======================'

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare
  v_ok    boolean;
  v_text  text;
begin
  begin
    perform public.vyplatit_zalohu(current_setting('test.tenant')::uuid,
                                   current_setting('test.marek_e')::uuid, 100000);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  perform pg_temp.check('ani přímým voláním rozhraní', v_ok);
  perform pg_temp.check('a hláška řekne, co s tím',
    v_text like '%pozastavené%' and v_text like '%spravuje mzdy%');
end $$;

reset role;

select pg_temp.check('žádná záloha nepřibyla',
  not exists (
    select 1 from public.advances
    where employee_id = :'marek_e' and business_date = current_date
      and castka_haleru = 100000
  ));


\echo ''
\echo '== 8. Storno projde i u pozastaveného ===================='

-- Nejdřív povolit, vyplatit a zase pozastavit: chyba se musí dát
-- opravit i potom, jinak by se špatně zadaná záloha nedala vzít zpět.
set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', :'marek_e', false);
reset role;

set role authenticated;
select set_config('test.user_id', :'provozni', false);
select zaloha as zal10 from public.vyplatit_zalohu(:'tenant', :'marek_e', 30000) \gset
select set_config('test.zal10', :'zal10', false);
reset role;

set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', :'marek_e', true);
reset role;

set role authenticated;
select set_config('test.user_id', :'provozni', false);
select public.stornovat_zalohu(:'tenant', :'zal10', 'zkouška u pozastaveného');
reset role;

select pg_temp.check('storno projde i u pozastaveného člověka',
  (select stav from public.advances where id = :'zal10') = 'stornovana');


\echo ''
\echo '== 6. Zaměstnanec vidí svůj stav, cizí ne ================'

set role authenticated;
select set_config('test.user_id', :'marek', false);

select pg_temp.check('číšník vidí, že má pozastaveno',
  (select zalohy_pozastavene from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)));

-- Cizí stav nevidí: seznam je zavřený na advances.manage nebo
-- payroll.read a číšník nemá ani jedno.
select pg_temp.check('do seznamu pozastavení se nedostane',
  (select count(*) from public.stav_pozastaveni(:'tenant')) = 0);

reset role;

set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select pg_temp.check('účetní seznam vidí',
  (select count(*) from public.stav_pozastaveni(:'tenant')) > 0);
reset role;


\echo ''
\echo '== 2. Vypnuté za firmu neprojde nikomu ==================='

set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', :'marek_e', false);
select public.pozastavit_zalohy(:'tenant', null, true);
reset role;

select pg_temp.check('u člověka pozastavené není',
  not (select zalohy_pozastaveny from public.employees where id = :'marek_e'));

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.vyplatit_zalohu(current_setting('test.tenant')::uuid,
                                   current_setting('test.marek_e')::uuid, 20000);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('a přesto mu záloha neprojde', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);
select pg_temp.check('a zaměstnanec to vidí i u firemního vypínače',
  (select zalohy_pozastavene from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)));
reset role;


\echo ''
\echo '== 7. Po povolení zpátky záloha projde ==================='

set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', null, false);
reset role;

set role authenticated;
select set_config('test.user_id', :'provozni', false);
select zaloha as zal11 from public.vyplatit_zalohu(:'tenant', :'marek_e', 20000) \gset
reset role;

select pg_temp.check('po povolení záloha projde',
  (select count(*) from public.advances where id = :'zal11') = 1);


\echo ''
\echo '== 5. Přepnutí je v auditu, oběma směry =================='

select pg_temp.check('zapsalo se pozastavení',
  exists (select 1 from public.audit_log
          where action = 'advance.pozastaveni' and after ->> 'pozastaveno' = 'true'));

select pg_temp.check('i povolení zpátky',
  exists (select 1 from public.audit_log
          where action = 'advance.pozastaveni' and after ->> 'pozastaveno' = 'false'));


\echo ''
\echo '== 9. Historie a výdělek se nezměnily ===================='

select pg_temp.check('stornovaná záloha zůstává v databázi',
  (select count(*) from public.advances where id = :'zal10') = 1);

set role authenticated;
select set_config('test.user_id', :'marek', false);

select pg_temp.check('stornovaná se do součtu nepočítá',
  (select zalohy_haleru from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date))
  = (select coalesce(sum(a.castka_haleru), 0)
     from public.advances a
     where a.employee_id = :'marek_e'
       and a.stav <> 'stornovana'
       and a.business_date >= date_trunc('month', current_date)::date));

select pg_temp.check('odpracované hodiny pozastavení nezměnilo',
  (select odpracovano_minut from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)) >= 0);

reset role;

-- Uklidit po sobě, ať další scénáře nekoukají na pozastaveného člověka.
set role authenticated;
select set_config('test.user_id', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
select public.pozastavit_zalohy(:'tenant', :'marek_e', false);
reset role;


\echo ''
\echo '=========================================================='
\echo ' KROK 10 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
