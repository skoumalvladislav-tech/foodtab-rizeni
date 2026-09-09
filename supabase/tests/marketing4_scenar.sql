-- Scénář marketing 4 — připojení, tajemství a sociální účty.
--
-- Pokrývá 20260909220000_marketing_integrace.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Že se zákaznický klíč k Instagramu nedostane tam, kam nemá. Token
-- firmy je horší ztráta než rozpis směn: kdo ho má, publikuje jejím
-- jménem.
--
-- Nejcennější kontrola je ta poslední — že se šifra neobjeví v auditu.
-- Přesně tak by totiž unikla nejtišeji: nikdo by nesahal na tabulku
-- s klíči, ale `app.audit_zmenu` by je rozkopírovala do `audit_log`,
-- kterou čte kdekdo.
--
-- ---------------------------------------------------------------------
-- POZNÁMKA K PGLITE
--
-- Tabulkový grant se tu proti očekávání UPLATNÍ: `set role
-- authenticated` opravdu přepne roli a ta na `marketing_tajemstvi`
-- žádné právo nemá. Přišlo se na to tak, že scénář spadl na
-- `permission denied` u kontroly, která si po uložení chtěla přečíst
-- řádek — kontrola měla pravdu, přímé čtení tam nepatří.
--
-- Nedá se tu ověřit RLS (superuživatel po `reset role`) ani sloupcové
-- granty. Kontroly na oprávnění uvnitř funkcí kousnou i tady — ptají
-- se `app.has_access`.

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
select id as e_majitel from public.employees where user_id = :'majitel' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

insert into public.marketing_pripojeni
  (tenant_id, branch_id, poskytovatel, kategorie, rezim, stav, nazev, pripojil)
values (:'tenant', :'perla', 'meta_graph', 'publikovani', 'zakaznicky',
        'pripojuje_se', 'Instagram Černé Perly', :'e_majitel')
returning id as pripojeni \gset
select set_config('test.pripojeni', :'pripojeni', false);
select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== Jedno živé připojení na nástroj a rozsah =================='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_pripojeni
      (tenant_id, branch_id, poskytovatel, kategorie, rezim)
    values (current_setting('test.tenant')::uuid,
            (select id from public.branches where slug = 'cerna-perla'),
            'meta_graph', 'publikovani', 'zakaznicky');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhé živé připojení na týž nástroj prošlo'; end if;
  raise notice '  OK    druhé živé připojení na týž nástroj a rozsah neprojde';
end $$;


\echo ''
\echo '== Klíč uloží jen ten, kdo smí publikovat ===================='

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_uloz_tajemstvi(
      current_setting('test.pripojeni')::uuid, 'sifra-cisnika', 'otisk-cisnika');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník uložil zákaznický klíč'; end if;
  raise notice '  OK    kdo nesmí publikovat, klíč neuloží';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_precti_tajemstvi(current_setting('test.pripojeni')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník přečetl zákaznický klíč'; end if;
  raise notice '  OK    a nepřečte ho ani';
end $$;

-- Ani se na tu tabulku nedostane: pro `authenticated` na ní není
-- žádný grant, takže dotaz skončí 42501 dřív, než se dojde na řádky.
do $$
declare v_ok boolean := false; v_n integer;
begin
  begin
    select count(*) into v_n from public.marketing_tajemstvi;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: authenticated si přečetl tabulku s klíči'; end if;
  raise notice '  OK    tabulku s klíči si authenticated nepřečte vůbec (žádný grant)';
end $$;

reset role;
select pg_temp.check('po pokusu číšníka žádný klíč uložený není',
  (select count(*) from public.marketing_tajemstvi
    where pripojeni_id = :'pripojeni') = 0);


\echo ''
\echo '== Neexistující připojení: klíč se nikam nezaloží ============'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_uloz_tajemstvi(
      '00000000-0000-0000-0000-000000000000'::uuid, 'sifra', 'otisk');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: klíč šel uložit k neexistujícímu připojení'; end if;
  raise notice '  OK    klíč k neexistujícímu připojení neprojde';
end $$;


\echo ''
\echo '== Uložení, rotace, přečtení ================================='

select app.marketing_uloz_tajemstvi(:'pripojeni', 'v1.zasifrovany-token', 'otisk-prvni');

-- Čte se FUNKCÍ, ne dotazem do tabulky — přesně jak to dělá aplikace.
select pg_temp.check('majitel klíč uložil a přečte z něj šifru, ne čitelný klíč',
  app.marketing_precti_tajemstvi(:'pripojeni') = 'v1.zasifrovany-token');

select app.marketing_uloz_tajemstvi(:'pripojeni', 'v1.novy-token', 'otisk-druhy');

reset role;
select pg_temp.check('rotace přepsala klíč, nezaložila druhý řádek',
  (select count(*) from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') = 1
  and (select sifra from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') = 'v1.novy-token');
select pg_temp.check('a zvedla verzi klíče',
  (select verze_klice from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') = 2
  and (select rotovano_kdy from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') is not null);


\echo ''
\echo '== ŠIFRA SE NESMÍ OBJEVIT V AUDITU =========================='

-- Tohle je ta nejtišší cesta, kterou by klíč unikl: nikdo by nesahal
-- na tabulku s klíči, ale spoušť by je rozkopírovala do audit_log,
-- kterou čte kdekdo. Proto na `marketing_tajemstvi` schválně žádná
-- spoušť `app.audit_zmenu` není.

select pg_temp.check('v auditu není ani jedna ze šifer',
  not exists (
    select 1 from public.audit_log
     where tenant_id = :'tenant'
       and (coalesce(before::text, '') || coalesce(after::text, ''))
           like '%zasifrovany-token%')
  and not exists (
    select 1 from public.audit_log
     where tenant_id = :'tenant'
       and (coalesce(before::text, '') || coalesce(after::text, ''))
           like '%novy-token%'));

select pg_temp.check('zato uložení klíče v auditu je — s otiskem',
  exists (select 1 from public.audit_log
           where tenant_id = :'tenant' and action = 'marketing.klic_ulozen'
             and after::text like '%otisk-druhy%'));


\echo ''
\echo '== Účty: jeden externí účet na připojení jednou =============='

insert into public.marketing_ucty
  (tenant_id, branch_id, pripojeni_id, sit, druh, externi_id, nazev, schopnosti)
values (:'tenant', :'perla', :'pripojeni', 'instagram', 'ig_firemni',
        '17841400000000000', 'cernaperla', array['prispevek', 'story']);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_ucty
      (tenant_id, branch_id, pripojeni_id, sit, druh, externi_id, nazev)
    values (current_setting('test.tenant')::uuid,
            (select id from public.branches where slug = 'cerna-perla'),
            current_setting('test.pripojeni')::uuid,
            'instagram', 'ig_firemni', '17841400000000000', 'kopie');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: týž účet šel připojit dvakrát'; end if;
  raise notice '  OK    týž externí účet nejde připojit dvakrát';
end $$;


\echo ''
\echo '== Odpojení klíč doopravdy smaže ============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select app.marketing_smaz_tajemstvi(:'pripojeni');

reset role;
select pg_temp.check('klíč je pryč, ne označený',
  (select count(*) from public.marketing_tajemstvi where pripojeni_id = :'pripojeni') = 0);
select pg_temp.check('a v auditu zůstalo, že tam byl',
  exists (select 1 from public.audit_log
           where tenant_id = :'tenant' and action = 'marketing.klic_smazan'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_ucty where tenant_id = :'tenant';
delete from public.marketing_tajemstvi where tenant_id = :'tenant';
delete from public.marketing_pripojeni where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_pripojeni where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_ucty where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 4 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
