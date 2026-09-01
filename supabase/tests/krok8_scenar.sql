-- Scénář pro krok 8 — zálohy.
--
-- Pokrývá migrace 20260901210000_ma_pobocka_kiosek a 20260901220000_zalohy,
-- tedy oddíly 6 a 7 zadání docs/kiosek-pin-zalohy-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok7_scenar.sql.
--
-- V PGlite je tahle migrace ověřená (47 kontrol), ale běží se tam jako
-- superuživatel a role `authenticated` neexistuje — takže se RLS ani
-- práva ke sloupcům neuplatní. Kontrola „Boris z jiné pobočky nevidí
-- nic“ tam projde i tehdy, když vidí všechno. Tady je to doopravdy.
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
-- =====================================================================

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as marek    from public.profiles where email = 'cisnik@foodtab.cz' \gset
select user_id as barman   from public.profiles where email = 'barman@foodtab.cz' \gset
select user_id as cizi     from public.profiles where email = 'cizi@jinafirma.cz' \gset

select id as marek_e  from public.employees where user_id = :'marek' \gset
select id as barman_e from public.employees where user_id = :'barman' \gset

select set_config('test.tenant',   :'tenant',   false);
select set_config('test.perla',    :'perla',    false);
select set_config('test.marek_e',  :'marek_e',  false);
select set_config('test.barman_e', :'barman_e', false);

-- Klíč zařízení, které si krok 6 zaregistroval, tenhle scénář nezná:
-- běží v jiném sezení a klíč se nikam neukládá. Registruje se proto
-- vlastní tablet — a protože se to dělá pod superuživatelem, obchází
-- se tím i to, kdo smí kód vystavit; na to je kontrola v kroku 6.
select kod as kod8 from public.vytvorit_registracni_kod(
  :'tenant', :'perla', 'tablet ke zkoušce záloh') \gset

select klic as klic8 from public.registrovat_zarizeni(:'kod8') \gset
select set_config('test.klic8', :'klic8', false);

-- PIN si každý nastaví sám; průzor jiný způsob nemá.
set role authenticated;
select set_config('test.user_id', :'marek', false);
select public.nastavit_pin(:'tenant', '4726');
reset role;

set role authenticated;
select set_config('test.user_id', :'barman', false);
select public.nastavit_pin(:'tenant', '8064');
reset role;


\echo ''
\echo '== Kdo smí vyplácet ======================================'

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select pg_temp.check('provozní zálohy vyplácet smí',
  app.has_access(:'tenant', 'advances.manage', :'perla'));

select pg_temp.check('a je to citlivé právo — přes SMS se nepozve',
  (select sensitive from public.permissions where key = 'advances.manage'));

reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.vyplatit_zalohu(current_setting('test.tenant')::uuid,
                                   current_setting('test.marek_e')::uuid, 100000);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník si zálohu sám nevyplatí', v_ok);
end $$;

reset role;


\echo ''
\echo '== Vyplacení ============================================='

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.vyplatit_zalohu(current_setting('test.tenant')::uuid,
                                   current_setting('test.marek_e')::uuid, 0);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('nulová záloha neprojde', v_ok);

  begin
    perform public.vyplatit_zalohu(current_setting('test.tenant')::uuid,
                                   current_setting('test.marek_e')::uuid, -500);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('záporná taky ne', v_ok);
end $$;

select zaloha as zal1 from public.vyplatit_zalohu(
  :'tenant', :'marek_e', 400000, 'hotově u baru') \gset

select set_config('test.zal1', :'zal1', false);

reset role;

select pg_temp.check('záloha je zapsaná jako nepotvrzená',
  (select stav from public.advances where id = :'zal1') = 'nepotvrzena');

select pg_temp.check('a v haléřích, ne v korunách',
  (select castka_haleru from public.advances where id = :'zal1') = 400000);

select pg_temp.check('číšníkovi přišlo upozornění',
  exists (select 1 from public.notifications
          where druh = 'zaloha.vyplacena' and user_id = :'marek'));

select pg_temp.check('vyplacení je v auditu',
  exists (select 1 from public.audit_log where action = 'advance.vyplaceno'));

-- Vyšší než odpracováno se JEN OHLÁSÍ (rozhodnutí 1. 9., oddíl 11 bod 3).
set role authenticated;
select set_config('test.user_id', :'provozni', false);

select zaloha as zal2, varovani as var2
from public.vyplatit_zalohu(:'tenant', :'marek_e', 90000000) \gset

select set_config('test.zal2', :'zal2', false);

reset role;

select pg_temp.check('nepřiměřeně vysoká záloha PROJDE',
  (select count(*) from public.advances where id = :'zal2') = 1);

select pg_temp.check('ale ohlásí se', :'var2' like 'Odpracováno zatím%');

select pg_temp.check('a oddělovač tisíců není čárka',
  :'var2' not like '%,%');


\echo ''
\echo '== Kdo zálohy vidí ======================================='

set role authenticated;
select set_config('test.user_id', :'marek', false);
select pg_temp.check('číšník vidí své zálohy',
  (select count(*) from public.advances) = 2);
reset role;

set role authenticated;
select set_config('test.user_id', :'barman', false);
select pg_temp.check('barman z druhé pobočky nevidí nic',
  (select count(*) from public.advances) = 0);
reset role;

set role authenticated;
select set_config('test.user_id', :'provozni', false);
select pg_temp.check('provozní vidí zálohy pobočky',
  (select count(*) from public.advances) = 2);

select pg_temp.check('a v seznamu taky',
  (select count(*) from public.zalohy_pobocky(
     :'tenant', current_date - 40, current_date + 1)) = 2);
reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);
select pg_temp.check('do seznamu pobočky se číšník nedostane',
  (select count(*) from public.zalohy_pobocky(
     :'tenant', current_date - 40, current_date + 1)) = 0);

-- Přímý zápis. Tabulka nemá `authenticated` přidělený insert, takže se
-- to nezastaví až na politice, ale o krok dřív — a to je lepší: tiché
-- neprovedení by vypadalo jako úspěch.
do $$
declare v_ok boolean;
begin
  begin
    insert into public.advances
      (tenant_id, branch_id, employee_id, castka_haleru, business_date)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.perla')::uuid,
            current_setting('test.marek_e')::uuid, 100, current_date);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('přímý zápis zálohy neprojde', v_ok);

  begin
    update public.advances set stav = 'potvrzena'
     where id = current_setting('test.zal1')::uuid;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('a nikdo si zálohu sám nepotvrdí', v_ok);
end $$;

reset role;

select pg_temp.check('stav zůstal nepotvrzený',
  (select stav from public.advances where id = :'zal1') = 'nepotvrzena');


\echo ''
\echo '== Potvrzení PINem na kiosku ============================='

select set_config('test.user_id', '', false);
set role anon;

do $$
declare v_ok boolean;
begin
  select p.ok into v_ok
  from public.potvrdit_zalohu_pinem(
    current_setting('test.klic8'), '9999', current_setting('test.zal1')::uuid) p;
  perform pg_temp.check('vymyšlený PIN nepotvrdí', v_ok = false);

  -- PIN kolegy z druhé pobočky. Nepotvrdí, a nedozví se ani proč.
  select p.ok into v_ok
  from public.potvrdit_zalohu_pinem(
    current_setting('test.klic8'), '8064', current_setting('test.zal1')::uuid) p;
  perform pg_temp.check('cizí PIN cizí zálohu nepotvrdí', v_ok = false);
end $$;

reset role;

select pg_temp.check('a pořád je nepotvrzená',
  (select stav from public.advances where id = :'zal1') = 'nepotvrzena');

-- Vlastní PIN. Nastavuje se znovu: pokusy výš zvedly počítadlo nezdarů
-- a po pěti by byl zámek — nastavením PINu se počítadlo nuluje.
set role authenticated;
select set_config('test.user_id', :'marek', false);
select public.nastavit_pin(:'tenant', '4726');
reset role;

select set_config('test.user_id', '', false);
set role anon;

do $$
declare v_ok boolean; v_jmeno text;
begin
  select p.ok, p.jmeno into v_ok, v_jmeno
  from public.potvrdit_zalohu_pinem(
    current_setting('test.klic8'), '4726', current_setting('test.zal1')::uuid) p;
  perform pg_temp.check('vlastní PIN zálohu potvrdí', v_ok);
  perform pg_temp.check('a připíše se tomu, komu patří', v_jmeno = 'Marek Číšník');
end $$;

reset role;

select pg_temp.check('stav je potvrzena',
  (select stav from public.advances where id = :'zal1') = 'potvrzena');

select pg_temp.check('potvrzení je v auditu',
  exists (select 1 from public.audit_log where action = 'advance.potvrzeno'));

select pg_temp.check('a ví se, na kterém tabletu',
  (select potvrzeno_zarizenim from public.advances where id = :'zal1') is not null);


\echo ''
\echo '== Storno místo mazání ==================================='

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.stornovat_zalohu(current_setting('test.tenant')::uuid,
                                    current_setting('test.zal2')::uuid, '   ');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('storno bez důvodu neprojde', v_ok);
end $$;

select public.stornovat_zalohu(:'tenant', :'zal2', 'překlep v částce');

reset role;

select pg_temp.check('stornovaná záloha v databázi ZŮSTÁVÁ',
  (select stav from public.advances where id = :'zal2') = 'stornovana');

select pg_temp.check('i s důvodem',
  (select storno_duvod from public.advances where id = :'zal2') = 'překlep v částce');

select pg_temp.check('storno je v auditu',
  exists (select 1 from public.audit_log where action = 'advance.storno'));

-- Mazání není povolené nikomu. Kdyby šlo, byla by to díra v evidenci.
set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    delete from public.advances where id = current_setting('test.zal2')::uuid;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('smazat zálohu nejde ani tomu, kdo je vyplácí', v_ok);
end $$;

reset role;

select pg_temp.check('záloha je pořád na svém místě',
  (select count(*) from public.advances where id = :'zal2') = 1);


\echo ''
\echo '== Můj výplatní přehled =================================='

set role authenticated;
select set_config('test.user_id', :'marek', false);

select pg_temp.check('stornovaná se do součtu nepočítá',
  (select zalohy_haleru from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)) = 400000);

select pg_temp.check('výchozí volba firmy je odečítat',
  (select zobrazeni from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)) = 'odecitat');

select pg_temp.check('zbývá k výplatě je hrubá mzda minus zálohy',
  (select zbyva_haleru = vydelano_haleru - zalohy_haleru
   from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)));

reset role;

-- Přepnutí volby mění JEN zobrazení, nikdy uložená čísla.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.nastavit_zalohy_zobrazeni(:'tenant', 'neukazovat');
reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);

select pg_temp.check('po přepnutí zůstal součet stejný',
  (select zalohy_haleru from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)) = 400000);

select pg_temp.check('mění se jen volba',
  (select zobrazeni from public.muj_vyplatni_prehled(
     :'tenant', date_trunc('month', current_date)::date)) = 'neukazovat');

reset role;

select pg_temp.check('a uložené zálohy se nezměnily',
  (select count(*) from public.advances where stav = 'potvrzena') = 1);

select pg_temp.check('změna nastavení je v auditu',
  exists (select 1 from public.audit_log where action = 'settings.zalohy'));

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.nastavit_zalohy_zobrazeni(
      current_setting('test.tenant')::uuid, 'odecitat');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('nastavení firmy nemění, kdo nemá settings.manage', v_ok);
end $$;

reset role;

-- Zpátky na výchozí, ať další scénáře nekoukají na cizí nastavení.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.nastavit_zalohy_zobrazeni(:'tenant', 'odecitat');
reset role;


\echo ''
\echo '== Má pobočka kiosek? ===================================='

set role authenticated;
select set_config('test.user_id', :'marek', false);

select pg_temp.check('na Perle tablet je',
  public.pobocka_ma_kiosek(:'tenant', :'perla'));

select pg_temp.check('a číšník se to dozví, i když seznam zařízení nevidí',
  (select count(*) from public.branch_devices) = 0);

reset role;

set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma se nedozví nic',
  not public.pobocka_ma_kiosek(:'tenant', :'perla'));
reset role;


\echo ''
\echo '== Ranní přehled ========================================='

/*
  Souhrn za provozní den. Kontroluje se hlavně to, CO V NĚM NENÍ:
  funkce vrací samá čísla a adresáty, žádná jména zaměstnanců. E-mail
  leží v cizí schránce a osobní údaj, který se do něj dostane,
  z aplikace odejde nadobro.

  Že text e-mailu sahá jen na dohodnutá pole, hlídá
  scripts/ranni-prehled.test.mjs. Tady jde o podklad a o to, kdo ho
  vůbec dostane.
*/

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('přehled vrací řádek na pobočku',
  (select count(*) from public.ranni_prehled(:'tenant', current_date)) >= 1);

select pg_temp.check('a vrací JEN čísla a adresáty — žádné jméno',
  (select array_agg(a.attname::text order by a.attname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   cross join lateral unnest(p.proargnames) with ordinality as a(attname, poradi)
   where n.nspname = 'public' and p.proname = 'ranni_prehled'
     and a.poradi > p.pronargs)
  = array['branch_id', 'komu', 'lidi', 'nedokoncenych', 'odpracovano_minut',
          'pobocka', 'rucnich_zapisu', 'zaloh', 'zaloh_haleru',
          'zaloh_nepotvrzenych']);

select pg_temp.check('adresáti jsou zatím prázdní — nic se nevymýšlí',
  (select komu from public.ranni_prehled(:'tenant', current_date)
   where branch_id = :'perla') = '{}');

reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.ranni_prehled(current_setting('test.tenant')::uuid, current_date);
    -- Funkce nespadne, jen nevrátí nic: podmínka je uvnitř dotazu.
    v_ok := not exists (
      select 1 from public.ranni_prehled(
        current_setting('test.tenant')::uuid, current_date));
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník ranní přehled nedostane', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.nastavit_ranni_email(:'tenant', '06:30'::time, :'perla',
                                   array['sefik@foodtab.cz']);

do $$
declare v_ok boolean;
begin
  begin
    perform public.nastavit_ranni_email(
      current_setting('test.tenant')::uuid, '06:30'::time,
      current_setting('test.perla')::uuid, array['tohle není adresa']);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('nesmyslná adresa neprojde', v_ok);
end $$;

reset role;

select pg_temp.check('adresát se uložil',
  (select ranni_email_komu from public.branches where id = :'perla')
  = array['sefik@foodtab.cz']);

select pg_temp.check('a překlep ho nepřepsal',
  (select ranni_email_komu from public.branches where id = :'perla')
  = array['sefik@foodtab.cz']);

select pg_temp.check('změna nastavení je v auditu',
  exists (select 1 from public.audit_log where action = 'settings.ranni_email'));

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    perform public.nastavit_ranni_email(
      current_setting('test.tenant')::uuid, '07:00'::time,
      current_setting('test.perla')::uuid, array['jinam@foodtab.cz']);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('bez settings.manage adresáta nikdo nezmění', v_ok);
end $$;

reset role;


\echo ''
\echo '=========================================================='
\echo ' KROK 8 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
