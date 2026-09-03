-- Scénář pro krok 19 — přidělení PINu a shoda PINů na pobočce.
--
-- Pokrývá migraci 20260903050000_prideleni_pinu a zadání
-- docs/pin-prideleni-zadani.md, oddíl 4.
--
-- Navazuje na etapa0_scenar.sql až krok18_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NEJDŘÍV TA CHYBA, KTERÁ TU BYLA UŽ PŘEDTÍM
--
-- Na kiosku se zadává jen PIN, žádné jméno — PIN člověka IDENTIFIKUJE.
-- Dvěma lidem na jedné pobočce šlo dosud nastavit týž PIN a druhý se
-- pak nepíchl nikdy: jeho docházka padala na cizí jméno.

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
select user_id as marek   from public.profiles where email = 'cisnik@foodtab.cz' \gset

-- Brigádník BEZ ÚČTU. Těch je v aplikaci většina a přidělení majitelem
-- je jediná cesta, jak jim PIN dát.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Brigádník Bez Účtu PIN', 'dpp')
returning id as e_briga \gset

-- Druhý člověk na téže pobočce — na něm se zkouší shoda.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Druhý Na Perle', 'dpp')
returning id as e_druhy \gset

-- A jeden na Bernard Baru: tam smí mít týž PIN, pobočky jsou oddělené.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Barový PIN', 'dpp')
returning id as e_barovy \gset

select id as e_marek from public.employees where user_id = :'marek' \gset

select set_config('test.tenant',  :'tenant',  false);
select set_config('test.e_briga', :'e_briga', false);
select set_config('test.e_druhy', :'e_druhy', false);
select set_config('test.e_marek', :'e_marek', false);


\echo ''
\echo '== 1. Majitel přidělí a PIN se ukáže jednou =============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.pridelit_pin(:'tenant', :'e_briga', '4713') as pin1 \gset

select pg_temp.check('funkce vrátila ten PIN, který se má ukázat', :'pin1' = '4713');

reset role;

select pg_temp.check('v databázi je jen otisk, ne PIN',
  not exists (select 1 from public.employee_pins
              where employee_id = :'e_briga' and otisk = '4713'));

select pg_temp.check('a otisk sedí na solený PIN',
  (select otisk from public.employee_pins where employee_id = :'e_briga')
  = (select app.pin_otisk(sul, '4713') from public.employee_pins where employee_id = :'e_briga'));

/*
  Podruhé už ho nikdo nepřečte. Není žádná funkce, která by PIN vrátila
  — jediná, která ho vrací, ho v tu chvíli sama nastavuje.
*/
/*
  Seznam je vyjmenovaný schválně: kdyby někdo přidal další veřejnou
  funkci kolem PINů, tahle kontrola spadne a bude se muset podívat,
  jestli náhodou nevrací PIN ven.

  `pichnout_pinem` a `potvrdit_zalohu_pinem` PIN BEROU, nevracejí —
  proto smí existovat. `pridelit_pin` ho vrací, ale jen v okamžiku,
  kdy ho sama nastavuje; přečíst existující PIN neumí nikdo.
*/
select pg_temp.check('žádný nový průzor kolem PINů nepřibyl',
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%pin%')
  = array['nastavit_pin', 'navrh_pinu', 'pichnout_pinem',
          'potvrdit_zalohu_pinem', 'pridelit_pin', 'zrusit_pin']);


\echo ''
\echo '== 2. Přidělený PIN funguje na kiosku ===================='

select pg_temp.check('kiosek pozná právě toho člověka',
  app.pin_overit(:'tenant', :'perla', '4713') = :'e_briga');


\echo ''
\echo '== 5. Dva stejné PINy na jedné pobočce nejdou ============'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false; v_text text;
begin
  begin
    perform public.pridelit_pin(
      current_setting('test.tenant')::uuid,
      current_setting('test.e_druhy')::uuid, '4713');
  exception when unique_violation then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then raise exception 'SELHALO: dva stejné PINy na pobočce prošly'; end if;
  -- Hláška nesmí prozradit ČÍ.
  if v_text like '%Brigádník%' then
    raise exception 'SELHALO: hláška prozradila, komu PIN patří: %', v_text;
  end if;
  raise notice '  OK    druhý týž PIN na pobočce neprojde a hláška neřekne čí';
end $$;

reset role;

select pg_temp.check('a druhý člověk PIN opravdu nemá',
  not exists (select 1 from public.employee_pins where employee_id = :'e_druhy'));


\echo ''
\echo '== 6. Na JINÉ pobočce týž PIN jde ========================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.pridelit_pin(:'tenant', :'e_barovy', '4713') as pin_bar \gset
reset role;

select pg_temp.check('Bernard Bar smí mít týž PIN', :'pin_bar' = '4713');
select pg_temp.check('a na Baru pozná svého člověka',
  app.pin_overit(:'tenant', :'bar', '4713') = :'e_barovy');
select pg_temp.check('na Perle pořád svého',
  app.pin_overit(:'tenant', :'perla', '4713') = :'e_briga');


\echo ''
\echo '== 7. Slabý PIN se odmítne =============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_kod text; v_spadlo integer := 0;
begin
  foreach v_kod in array array['0000', '1111', '1234', '4321'] loop
    begin
      perform public.pridelit_pin(
        current_setting('test.tenant')::uuid,
        current_setting('test.e_druhy')::uuid, v_kod);
      raise exception 'SELHALO: slabý PIN % prošel', v_kod;
    exception when check_violation then v_spadlo := v_spadlo + 1;
    end;
  end loop;
  if v_spadlo <> 4 then raise exception 'SELHALO: neodmítly se všechny slabé PINy'; end if;
  raise notice '  OK    0000, 1111, 1234 i 4321 se odmítnou';
end $$;

reset role;


\echo ''
\echo '== Vygenerovaný PIN je volný a netriviální ==============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.pridelit_pin(:'tenant', :'e_druhy', null) as pin_gen \gset
reset role;

select pg_temp.check('vygeneroval se čtyřmístný PIN', :'pin_gen' ~ '^[0-9]{4}$');
select pg_temp.check('a není to ten obsazený', :'pin_gen' <> '4713');
select pg_temp.check('není triviální', not app.pin_je_trivialni(:'pin_gen'));
select pg_temp.check('a poznají se oba lidé zvlášť',
  app.pin_overit(:'tenant', :'perla', :'pin_gen') = :'e_druhy'
  and app.pin_overit(:'tenant', :'perla', '4713') = :'e_briga');


\echo ''
\echo '== 4. Přenastavení: starý neplatí, zaměstnanec se to dozví ='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Marek má účet, takže mu má přijít zvoneček.
select public.pridelit_pin(:'tenant', :'e_marek', '8642') as pin_marek \gset
select public.pridelit_pin(:'tenant', :'e_marek', '9753') as pin_marek2 \gset

reset role;

select pg_temp.check('starý PIN už neplatí',
  app.pin_overit(:'tenant', :'perla', '8642') is null);
select pg_temp.check('nový platí',
  app.pin_overit(:'tenant', :'perla', '9753') = :'e_marek');

select pg_temp.check('a Markovi o tom přišlo upozornění',
  (select count(*) from public.notifications
   where user_id = :'marek' and druh = 'pin.prenastaven') = 2);

/*
  V upozornění NENÍ PIN. Kdyby tam byl, ležel by čitelně v databázi
  a celé pravidlo 7 by bylo k ničemu.
*/
select pg_temp.check('a v upozornění není žádný PIN',
  not exists (select 1 from public.notifications
              where druh = 'pin.prenastaven'
                and (telo::text like '%9753%' or telo::text like '%8642%')));


\echo ''
\echo '== 3. Zaměstnanec si ho změní, majitel nový nevidí ======='

set role authenticated;
select set_config('test.user_id', :'marek', false);

select public.nastavit_pin(:'tenant', '5296');

reset role;
select pg_temp.check('vlastní PIN se změnil',
  app.pin_overit(:'tenant', :'perla', '5296') = :'e_marek');
select pg_temp.check('a ten od majitele už neplatí',
  app.pin_overit(:'tenant', :'perla', '9753') is null);

-- Když si ho mění sám, zvoneček mu nechodí — o svém PINu ví.
select pg_temp.check('sám sobě si upozornění neposílá',
  (select count(*) from public.notifications
   where user_id = :'marek' and druh = 'pin.prenastaven') = 2);

-- A shoda platí i pro tuhle cestu.
set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.nastavit_pin(current_setting('test.tenant')::uuid, '4713');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: zaměstnanec si nastavil obsazený PIN'; end if;
  raise notice '  OK    ani zaměstnanec si obsazený PIN nenastaví';
end $$;

reset role;


\echo ''
\echo '== 8.+9. Co nejde přečíst a kdo nesmí nastavovat ========='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('ani majitel nepřečte otisk ani sůl',
  (select count(*) from information_schema.column_privileges
   where table_name = 'employee_pins'
     and column_name in ('otisk', 'sul')
     and grantee = 'authenticated') = 0);

-- Číšník docházku nespravuje, cizí PIN nenastaví.
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.pridelit_pin(
      current_setting('test.tenant')::uuid,
      current_setting('test.e_briga')::uuid, '2468');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: bez attendance.manage šlo přidělit cizí PIN'; end if;
  raise notice '  OK    bez attendance.manage cizí PIN nikdo nepřidělí';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.navrh_pinu(
      current_setting('test.tenant')::uuid,
      current_setting('test.e_briga')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: bez oprávnění šlo dostat návrh PINu'; end if;
  raise notice '  OK    ani návrh PINu bez oprávnění nechodí';
end $$;

reset role;


\echo ''
\echo '== KROK 19 HOTOV ========================================='
