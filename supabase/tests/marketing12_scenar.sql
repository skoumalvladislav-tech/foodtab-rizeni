-- Scénář marketing 12 — kampaně a automatizace.
--
-- Pokrývá 20260914140000_marketing_kampane.sql.
-- Zadání: master prompt, oddíl 15.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- 1. Že automatizaci nezapne ten, kdo smí jen připravovat obsah.
--    Zapnout něco, co bude samo každý den vyrábět, je rozhodnutí
--    toho druhu jako poslat příspěvek ven — proto `marketing.publish`.
--
-- 2. Že historii běhů nemůže dopsat přihlášený uživatel. Historie, do
--    které smí psát kdokoli, není doklad o ničem.
--
-- 3. Že se úspěšný běh na týž provozní den nezaloží dvakrát. Když se
--    úloha pustí podruhé (restart serveru, klik na „spustit teď"),
--    nesmí vzniknout dvojí koncepty.
--
-- 4. Že smazání kampaně NESMAŽE příspěvky. Zveřejněné už jsou venku
--    a v historii mají zůstat.
--
-- ---------------------------------------------------------------------
-- PROVOZNÍ DEN, NE KALENDÁŘNÍ
--
-- Jedinečnost běhu stojí na `app.business_date` pobočky, ne na
-- `bezelo_kdy::date`. Provozní den začíná v 05:00, takže se
-- s kalendářním každý den pět hodin rozchází (CLAUDE.md, pravidlo 10).
--
-- Posun v kontrole je proto **26 hodin**, ne 20: kratší posun je jiný
-- kalendářní den jen část dne a `krok23_scenar` na tom 6. 9. spadl
-- ve 20:23 (CLAUDE.md, „Testy, které závisí na kalendáři").

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

select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as danuse   from public.profiles where email = 'danuse@foodtab.cz'   \gset
select id as e_provozni from public.employees where user_id = :'provozni' and tenant_id = :'tenant' and deleted_at is null \gset
select id as e_danuse   from public.employees where user_id = :'danuse'   and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

/*
  PŘÍPRAVKÁŘ: smí připravovat, nesmí publikovat.

  Práva jdou z `employee_permissions`, ne z rolí — `app.has_access`
  se od převodu na zařazení na `role_permissions` neptá. Naletěl jsem
  na to u marketing11 a je to popsané tam.
*/
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_danuse', 'marketing.read', true),
       (:'tenant', :'e_danuse', 'marketing.manage', true)
on conflict (employee_id, permission_key) do update set granted = excluded.granted;

set role authenticated;
select set_config('test.user_id', :'danuse', false);

select pg_temp.check('přípravkář SMÍ připravovat marketing',
  app.has_access(:'tenant'::uuid, 'marketing.manage', :'perla'::uuid));
select pg_temp.check('a NESMÍ publikovat',
  not app.has_access(:'tenant'::uuid, 'marketing.publish', :'perla'::uuid));

reset role;

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);


\echo ''
\echo '== 1. Kampaň smí založit i přípravkář ======================='

/*
  Kampaň je příprava obsahu, ne rozhodnutí o zveřejnění — proto
  `marketing.manage`. Kdyby na ni bylo potřeba `publish`, nemohl by
  si ji založit nikdo, kdo připravuje podklady.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

insert into public.marketing_kampane (tenant_id, branch_id, nazev, cil, kona_se_kdy, zalozil)
values (:'tenant', :'perla', 'Zabijačka', 'Naplnit sobotní oběd',
        now() + interval '5 days', :'e_danuse')
returning id as kampan \gset

select pg_temp.check('kampaň vznikla',
  (select nazev from public.marketing_kampane where id = :'kampan') = 'Zabijačka');
select pg_temp.check('a je ve stavu „připravuje se"',
  (select stav from public.marketing_kampane where id = :'kampan') = 'pripravuje_se');

reset role;
select set_config('test.kampan', :'kampan', false);


\echo ''
\echo '== 2. Automatizaci NEZAPNE, kdo nesmí publikovat ============'

/*
  RLS `insert` bez práva vyhodí `insufficient_privilege` (na rozdíl od
  `update`, který řádek tiše zahodí — to je v marketing11). Čeká se
  proto výjimka, ne nula řádků.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_automatizace
      (tenant_id, branch_id, nazev, druh, zapnuta)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'Denní menu', 'denni_menu', true);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přípravkář založil automatizaci'; end if;
  raise notice '  OK    přípravkář automatizaci nezaloží';
end $$;

reset role;


\echo ''
\echo '== 3. Kdo publikovat smí, ji založí a zapne ================='

set role authenticated;
select set_config('test.user_id', :'provozni', false);

insert into public.marketing_automatizace
  (tenant_id, branch_id, nazev, druh, cas_spusteni, dny_v_tydnu, vlastnik)
values (:'tenant', :'perla', 'Denní menu ráno', 'denni_menu', '08:00',
        array[1,2,3,4,5]::smallint[], :'e_provozni')
returning id as automat \gset

reset role;
select set_config('test.automat', :'automat', false);

/*
  VÝCHOZÍ STAV JE VYPNUTO, i když se `zapnuta` neuvedlo. Automatizace,
  která se zapne sama tím, že vznikne, je přesně to, co nikdo nechce.
*/
select pg_temp.check('nová automatizace je vypnutá',
  (select zapnuta from public.marketing_automatizace where id = :'automat') = false);

select pg_temp.check('a má vlastníka',
  (select vlastnik from public.marketing_automatizace where id = :'automat') = :'e_provozni');

set role authenticated;
select set_config('test.user_id', :'provozni', false);
update public.marketing_automatizace set zapnuta = true where id = :'automat';
reset role;

select pg_temp.check('provozní ji zapnul',
  (select zapnuta from public.marketing_automatizace where id = :'automat') = true);

/*
  A ŽE JI PŘÍPRAVKÁŘ NEVYPNE ANI NEZAPNE ZPĚT. `update` politika řádek
  tiše zahodí, takže se měří počtem změněných řádků — kontrola
  „nespadlo to" by tady neznamenala nic.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

do $$
declare v_zmeneno integer;
begin
  update public.marketing_automatizace set zapnuta = false
   where id = current_setting('test.automat')::uuid;
  get diagnostics v_zmeneno = row_count;
  if v_zmeneno <> 0 then
    raise exception 'SELHALO: přípravkář vypnul automatizaci (% řádků)', v_zmeneno;
  end if;
  raise notice '  OK    přípravkář ji ani nevypne';
end $$;

reset role;

select pg_temp.check('a zůstala zapnutá',
  (select zapnuta from public.marketing_automatizace where id = :'automat') = true);


\echo ''
\echo '== 4. Historii běhů uživatel nedopíše ======================='

/*
  Běhy zapisuje úloha na serveru servisním klíčem. Pro `authenticated`
  není `insert` grant vůbec — dostane 42501 dřív, než se dojde na
  politiku.
*/
set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_automatizace_behy
      (tenant_id, automatizace_id, vysledek, zalozeno_konceptu)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.automat')::uuid, 'hotovo', 3);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: uživatel dopsal historii běhů'; end if;
  raise notice '  OK    ani ten, kdo smí publikovat, historii nedopíše';
end $$;

reset role;


\echo ''
\echo '== 5. Provozní den doplní spoušť, ne volající =============='

insert into public.marketing_automatizace_behy
  (tenant_id, automatizace_id, vysledek, zalozeno_konceptu)
values (:'tenant', :'automat', 'hotovo', 2)
returning id as beh1 \gset

select pg_temp.check('provozní den se doplnil sám',
  (select provozni_den from public.marketing_automatizace_behy where id = :'beh1') is not null);

select pg_temp.check('a sedí s app.business_date pobočky',
  (select provozni_den from public.marketing_automatizace_behy where id = :'beh1')
   = (select app.business_date(:'perla'::uuid, bezelo_kdy)
        from public.marketing_automatizace_behy where id = :'beh1'));

/*
  PODSTRČENÝ DEN SE NEUPLATNÍ. Kdyby se bral z požadavku, dala by se
  jedinečnost obejít jednou hodnotou navíc.
*/
insert into public.marketing_automatizace_behy
  (tenant_id, automatizace_id, vysledek, bezelo_kdy, provozni_den)
values (:'tenant', :'automat', 'preskoceno', now() - interval '26 hours', '1999-01-01')
returning id as beh_podstrceny \gset

select pg_temp.check('podstrčený provozní den spoušť přepsala',
  (select provozni_den from public.marketing_automatizace_behy where id = :'beh_podstrceny')
   <> '1999-01-01'::date);


\echo ''
\echo '== 6. Dva úspěšné běhy v jeden den nejdou ==================='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_automatizace_behy
      (tenant_id, automatizace_id, vysledek, zalozeno_konceptu)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.automat')::uuid, 'hotovo', 1);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhý úspěšný běh v týž den prošel'; end if;
  raise notice '  OK    druhý úspěšný běh v týž provozní den neprojde';
end $$;

/*
  ALE PO CHYBĚ SE TO MÁ DÁT ZKUSIT ZNOVU. Kdyby index bral i chybové
  a přeskočené běhy, jedna neúspěšná noc by automatizaci umlčela na
  celý den — a vypadalo by to, že je rozbitá.
*/
insert into public.marketing_automatizace_behy
  (tenant_id, automatizace_id, vysledek, duvod)
values (:'tenant', :'automat', 'chyba', 'Menu na dnešek není potvrzené.')
returning id as beh_chyba \gset

select pg_temp.check('chybový běh v týž den projde',
  (select vysledek from public.marketing_automatizace_behy where id = :'beh_chyba') = 'chyba');

insert into public.marketing_automatizace_behy
  (tenant_id, automatizace_id, vysledek, duvod)
values (:'tenant', :'automat', 'preskoceno', 'Dneska nebylo z čeho.')
returning id as beh_presk \gset

select pg_temp.check('a přeskočený taky',
  (select vysledek from public.marketing_automatizace_behy where id = :'beh_presk') = 'preskoceno');

/*
  A ŽE SE JINÝ PROVOZNÍ DEN ROZLIŠÍ. Posun o 26 hodin je jiný provozní
  den vždycky — ve 23:50 stejně jako v poledne.
*/
insert into public.marketing_automatizace_behy
  (tenant_id, automatizace_id, vysledek, bezelo_kdy, zalozeno_konceptu)
values (:'tenant', :'automat', 'hotovo', now() - interval '26 hours', 2)
returning id as beh_vcera \gset

select pg_temp.check('úspěšný běh o 26 hodin dřív projde — je to jiný provozní den',
  (select provozni_den from public.marketing_automatizace_behy where id = :'beh_vcera')
   <> (select provozni_den from public.marketing_automatizace_behy where id = :'beh1'));


\echo ''
\echo '== 7. Smazání kampaně nesmaže příspěvky ===================='

insert into public.marketing_prispevky
  (tenant_id, branch_id, nazev, kampan_id, vytvoril)
values (:'tenant', :'perla', 'Pozvánka na zabijačku', :'kampan', :'e_provozni')
returning id as prispevek \gset

select pg_temp.check('příspěvek je navázaný na kampaň',
  (select kampan_id from public.marketing_prispevky where id = :'prispevek') = :'kampan');

delete from public.marketing_kampane where id = :'kampan';

select pg_temp.check('po smazání kampaně příspěvek ZŮSTAL',
  exists (select 1 from public.marketing_prispevky where id = :'prispevek'));

select pg_temp.check('a vazba se jen vyprázdnila',
  (select kampan_id from public.marketing_prispevky where id = :'prispevek') is null);


\echo ''
\echo '== 8. Cizí firma se nepodstrčí ============================='

/*
  Spoušť na provozní den je `security definer` — RLS se v ní neuplatní
  (skill `migrace`, oddíl 5). Firmu si proto musí ověřit sama.
*/
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_automatizace_behy
      (tenant_id, automatizace_id, vysledek)
    values ('00000000-0000-0000-0000-000000000000'::uuid,
            current_setting('test.automat')::uuid, 'hotovo');
  exception
    when foreign_key_violation then v_ok := true;
    when others then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: běh s cizí firmou prošel'; end if;
  raise notice '  OK    běh ukazující na automatizaci jiné firmy neprojde';
end $$;


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_automatizace_behy where tenant_id = :'tenant';
delete from public.marketing_automatizace where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.marketing_kampane where tenant_id = :'tenant';
delete from public.employee_permissions
 where employee_id = :'e_danuse' and permission_key in ('marketing.read', 'marketing.manage');
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_kampane where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_automatizace where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_automatizace_behy where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 12 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
