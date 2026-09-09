-- Scénář marketing 3 — obsah, verze a schvalování.
--
-- Pokrývá 20260909200000_marketing_obsah.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
--
-- ---------------------------------------------------------------------
-- CO SE TU VLASTNĚ DOKAZUJE
--
-- Že se **bez schválení přesné verze nedá nic vydat**, a to i tehdy,
-- když aplikace udělá chybu. Všechny kontroly níž míří na spouště
-- a omezení v databázi, ne na to, co dělá obrazovka.
--
-- Tyhle kontroly kousnou i v PGlite — jsou to spouště a omezení, ne
-- RLS. To je schválně: právě u schvalování by se zelený běh nad
-- neúčinnou politikou vymstil nejvíc.
--
-- Vlastní číselná řada (marketingN_scenar.sql) — CLAUDE.md,
-- „Dvě relace v jednom repozitáři".

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

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz'  \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as cisnik   from public.profiles where email = 'cisnik@foodtab.cz'   \gset

select id as e_majitel  from public.employees where user_id = :'majitel'  and deleted_at is null \gset
select id as e_provozni from public.employees where user_id = :'provozni' and deleted_at is null \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);
select set_config('test.e_majitel', :'e_majitel', false);
select set_config('test.e_provozni', :'e_provozni', false);

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');


\echo ''
\echo '== Kdo ve firmě smí co ======================================'

-- Bez tohohle by čtyři oči níž nešly přečíst: kontrola „nerozhoduj
-- o své žádosti" totiž platí jen tehdy, když ve firmě je ještě někdo
-- další, kdo smí schvalovat.
select count(*) as publishu from app.kdo_ma_pravo_na_pobocce(:'tenant', 'marketing.publish', :'perla') \gset
\echo 'schvalovatelů ve firmě:' :publishu
select pg_temp.check('ve firmě je víc než jeden schvalovatel (jinak by čtyři oči neplatily)',
  :publishu >= 2);


\echo ''
\echo '== Příspěvek a první verze =================================='

insert into public.marketing_prispevky (tenant_id, branch_id, nazev, ucel, vytvoril)
values (:'tenant', :'perla', 'Denní menu na čtvrtek', 'denni_menu', :'e_provozni')
returning id as prispevek \gset
select set_config('test.prispevek', :'prispevek', false);

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, zadani, texty, otisk, vytvoril)
values (:'tenant', :'prispevek', 1, 'Dnešní menu, přátelsky.',
        '{"instagram":{"popisek":"Svíčková 189 Kč"}}'::jsonb, 'otisk-verze-1', :'e_provozni')
returning id as verze1 \gset
select set_config('test.verze1', :'verze1', false);

select pg_temp.check('spoušť nastavila příspěvku aktuální verzi',
  (select aktualni_verze_id from public.marketing_prispevky where id = :'prispevek') = :'verze1');
select pg_temp.check('nová věc je koncept, ne schválená',
  (select stav from public.marketing_prispevky where id = :'prispevek') = 'koncept'
  and (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') is null);


\echo ''
\echo '== Verze je neměnná ========================================='

do $$
declare v_ok boolean := false;
begin
  begin
    update public.marketing_verze set zadani = 'podstrčeno'
     where id = current_setting('test.verze1')::uuid;
  exception when restrict_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: verze šla přepsat'; end if;
  raise notice '  OK    verzi nejde přepsat (schválení by přestalo něco znamenat)';
end $$;

select pg_temp.check('a text verze opravdu zůstal původní',
  (select zadani from public.marketing_verze where id = :'verze1') = 'Dnešní menu, přátelsky.');


\echo ''
\echo '== Žádost o schválení ======================================='

insert into public.marketing_schvaleni
  (tenant_id, prispevek_id, verze_id, otisk_verze, zadal, shrnuti)
values (:'tenant', :'prispevek', :'verze1', 'otisk-verze-1', :'e_provozni', 'Menu na čtvrtek')
returning id as zadost1 \gset
select set_config('test.zadost1', :'zadost1', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_schvaleni
      (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze1')::uuid, 'otisk-verze-1',
            current_setting('test.e_provozni')::uuid);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhá čekající žádost prošla'; end if;
  raise notice '  OK    druhá čekající žádost na týž příspěvek neprojde';
end $$;


\echo ''
\echo '== Rozhodovat smí jen marketing.publish ====================='

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

select pg_temp.check('číšník marketing.publish nemá',
  not app.has_access(:'tenant', 'marketing.publish', :'perla'));

/*
  POZOR NA TVAR TÉHLE KONTROLY.

  Napsal jsem ji nejdřív jako „musí spadnout výjimkou" — a spadla sama,
  protože číšníkovi ten řádek schová RLS dřív, než se ke spoušti vůbec
  dojde. `update` tedy nezmění nic a NEVYHODÍ nic.

  Obojí je správně a obojí je bezpečné, jen se to nedá napsat jako
  jedna očekávaná výjimka. Kontrola proto míří na VÝSLEDEK: po pokusu
  musí žádost pořád čekat. To platí, ať ho zastavila politika nebo
  spoušť — a spadne, kdyby ho nezastavilo nic.
*/
update public.marketing_schvaleni set stav = 'schvaleno'
 where id = :'zadost1';

reset role;
select pg_temp.check('po pokusu číšníka žádost pořád čeká',
  (select stav from public.marketing_schvaleni where id = :'zadost1') = 'ceka');
select pg_temp.check('a příspěvek zůstal bez schválené verze',
  (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') is null);


\echo ''
\echo '== O své vlastní žádosti se nerozhoduje ====================='

-- Žádost převedeme na majitele a necháme ho rozhodnout o vlastní věci.
reset role;
update public.marketing_schvaleni set zadal = :'e_majitel' where id = :'zadost1';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.marketing_schvaleni set stav = 'schvaleno'
     where id = current_setting('test.zadost1')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: majitel odklepl vlastní žádost'; end if;
  raise notice '  OK    žadatel si vlastní žádost neodklepne, když je kdo jiný';
end $$;


\echo ''
\echo '== Schválení se zapíše na příspěvek spouští ================='

reset role;
update public.marketing_schvaleni set zadal = :'e_provozni' where id = :'zadost1';

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost1';

reset role;
select pg_temp.check('příspěvek ukazuje na schválenou verzi',
  (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') = :'verze1');
select pg_temp.check('a je ve stavu schvaleno',
  (select stav from public.marketing_prispevky where id = :'prispevek') = 'schvaleno');
select pg_temp.check('spoušť doplnila kdo a kdy rozhodl',
  (select rozhodl from public.marketing_schvaleni where id = :'zadost1') = :'e_majitel'
  and (select rozhodnuto_kdy from public.marketing_schvaleni where id = :'zadost1') is not null);


\echo ''
\echo '== NOVÁ VERZE RUŠÍ SCHVÁLENÍ ================================'

-- Tohle je jádro celého modulu. Bez toho by šlo příspěvek schválit,
-- podstrčit mu jinou verzi a zveřejnit něco, co nikdo neviděl.

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, zadani, texty, otisk, vytvoril)
values (:'tenant', :'prispevek', 2, 'Dnešní menu, přátelsky.',
        '{"instagram":{"popisek":"Svíčková 199 Kč"}}'::jsonb, 'otisk-verze-2', :'e_provozni')
returning id as verze2 \gset

select pg_temp.check('po nové verzi příspěvek NENÍ schválený',
  (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') is null);
select pg_temp.check('a spadl zpátky na koncept',
  (select stav from public.marketing_prispevky where id = :'prispevek') = 'koncept');
select pg_temp.check('aktuální verze je ta nová',
  (select aktualni_verze_id from public.marketing_prispevky where id = :'prispevek') = :'verze2');

-- Rozhodnutí zůstává v historii — smazat ho by znamenalo ztratit,
-- že to někdo kdysi schválil.
select pg_temp.check('původní rozhodnutí zůstalo v historii',
  (select stav from public.marketing_schvaleni where id = :'zadost1') = 'schvaleno');


\echo ''
\echo '== Čekající žádost nová verze zneplatní ====================='

insert into public.marketing_schvaleni
  (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze2', 'otisk-verze-2', :'e_provozni')
returning id as zadost2 \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, zadani, texty, otisk, vytvoril)
values (:'tenant', :'prispevek', 3, 'Ještě jinak.', '{}'::jsonb, 'otisk-verze-3', :'e_provozni');

select pg_temp.check('čekající žádost je po nové verzi neplatná',
  (select stav from public.marketing_schvaleni where id = :'zadost2') = 'neplatne');


\echo ''
\echo '== Zamítnutí bez důvodu neprojde ============================'

insert into public.marketing_schvaleni
  (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze2', 'otisk-verze-2', :'e_provozni')
returning id as zadost3 \gset
select set_config('test.zadost3', :'zadost3', false);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.marketing_schvaleni set stav = 'zamitnuto'
     where id = current_setting('test.zadost3')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: zamítnutí bez připomínky prošlo'; end if;
  raise notice '  OK    zamítnutí bez připomínky databáze odmítne';
end $$;

update public.marketing_schvaleni
   set stav = 'zamitnuto', pripominka = 'Chci jinou fotku, tahle je tmavá.'
 where id = :'zadost3';

reset role;
select pg_temp.check('se skutečnou připomínkou zamítnutí projde',
  (select stav from public.marketing_schvaleni where id = :'zadost3') = 'zamitnuto');
select pg_temp.check('a příspěvek je zamítnutý, bez schválené verze',
  (select stav from public.marketing_prispevky where id = :'prispevek') = 'zamitnuto'
  and (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') is null);


\echo ''
\echo '== Audit ===================================================='

select pg_temp.check('příspěvek, verze i schválení jsou v auditu',
  exists (select 1 from public.audit_log where entity_type = 'marketing_prispevek' and tenant_id = :'tenant')
  and exists (select 1 from public.audit_log where entity_type = 'marketing_verze' and tenant_id = :'tenant')
  and exists (select 1 from public.audit_log where entity_type = 'marketing_schvaleni' and tenant_id = :'tenant'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_schvaleni where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_verze where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_schvaleni where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 3 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
