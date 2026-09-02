-- Scénář pro krok 6 — kiosek, PIN, konec přímého zápisu docházky.
--
-- Pokrývá migrace 20260901170000_zarizeni_pobocky, 20260901180000_pin
-- a 20260901190000_kiosek_a_pichnuti, tedy body 1 až 4 zadání
-- docs/kiosek-pin-zalohy-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok5_scenar.sql: firma, dvě pobočky
-- (cerna-perla, bernard-bar) a lidé už existují.
--
-- PROČ TADY A NE V PGlite: v PGlite se běží jako superuživatel a role
-- `authenticated` tam není, takže se RLS ani práva ke sloupcům
-- neuplatní. Kontrola „klíč zařízení se nepřečte“ tam projde i tehdy,
-- když ho přečte každý. Všechno, co stojí na oprávněních, je proto
-- tady, proti opravdovému PostgreSQL, a pod rolí `authenticated` —
-- a kioskové věci pod rolí `anon`, protože na tabletu není přihlášený
-- nikdo.
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
-- Ids se načítají TEĎ, pod superuživatelem. Kdyby se četla až pod rolí
-- `authenticated`, vrátí politika cizí řádek prázdný a scénář by pak
-- tiše zkoušel neexistujícího člověka.
-- =====================================================================

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as marek   from public.profiles where email = 'cisnik@foodtab.cz' \gset
select user_id as cizi    from public.profiles where email = 'cizi@jinafirma.cz' \gset

select id as marek_e from public.employees where user_id = :'marek' \gset

-- Záskok: patří na Perlu, ale dnes tam směnu NEMÁ. Na něm se ověří,
-- že píchnout smí i ten, kdo v rozpisu není, a že se to označí.
insert into auth.users (id, email, raw_user_meta_data) values
  ('88888888-8888-8888-8888-888888888888', 'zaskok@foodtab.cz',
   '{"full_name":"Záskok Kioskový"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
select :'tenant', '88888888-8888-8888-8888-888888888888', r.id, 'active', 'tenant'
from public.roles r where r.tenant_id = :'tenant' and r.key = 'servis'
on conflict do nothing;

insert into public.employees (tenant_id, branch_id, user_id, full_name)
values (:'tenant', :'perla', '88888888-8888-8888-8888-888888888888', 'Záskok Kioskový')
returning id as zaskok_e \gset

-- Do bloků `do $$` se proměnná psql nedostane, musí přes set_config.
-- Nastavuje se hned tady, ne až za blokem, který ji čte.
select set_config('test.zaskok_e', :'zaskok_e', false);

-- Barman patří na druhou pobočku. Jeho PIN nesmí projít na Perle.
insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999999', 'barman@foodtab.cz',
   '{"full_name":"Barman Zkouška"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
select :'tenant', '99999999-9999-9999-9999-999999999999', r.id, 'active', 'tenant'
from public.roles r where r.tenant_id = :'tenant' and r.key = 'servis'
on conflict do nothing;

insert into public.employees (tenant_id, branch_id, user_id, full_name)
values (:'tenant', :'bar', '99999999-9999-9999-9999-999999999999', 'Barman Zkouška')
returning id as barman_e \gset

-- Marek dnes na Perle směnu má. Provozní den, ne kalendářní: kdyby se
-- testovalo po půlnoci, kalendářní datum by sedělo jinam než píchnutí.
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'marek_e', app.business_date(:'perla', now()), '08:00', '16:00');


\echo ''
\echo '== Vystavení registračního kódu =========================='

-- Kód vystavuje jen správce nastavení pobočky ----------------------
do $$
declare
  v_tenant uuid;
  v_perla  uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches where slug = 'cerna-perla';

  perform set_config('test.user_id', (select user_id from public.profiles
                                      where email = 'cisnik@foodtab.cz')::text, false);
  set local role authenticated;

  begin
    perform public.vytvorit_registracni_kod(v_tenant, v_perla, 'tablet číšníkův');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník si zařízení nezaregistruje', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select kod as kod1 from public.vytvorit_registracni_kod(:'tenant', :'perla', 'tablet u baru') \gset
select kod as kod2 from public.vytvorit_registracni_kod(:'tenant', :'perla', 'tablet ztracený') \gset

select set_config('test.kod1', :'kod1', false);

select pg_temp.check('kód je osm znaků k opsání', length(:'kod1') = 8);

-- Zařízení do cizí pobočky nejde ------------------------------------
do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  begin
    perform public.vytvorit_registracni_kod(
      v_tenant, '00000000-0000-0000-0000-000000000000'::uuid, 'tablet nikde');
    v_ok := false;
  exception
    when foreign_key_violation then v_ok := true;
    when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('kód pro cizí pobočku se nevystaví', v_ok);

  begin
    perform public.vytvorit_registracni_kod(v_tenant,
      (select id from public.branches where slug = 'cerna-perla'), '   ');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('nepojmenované zařízení se nevystaví', v_ok);
end $$;

-- Kód se v databázi neuloží čitelně ---------------------------------
do $$
declare v_ok boolean;
begin
  begin
    perform code_hash from public.device_registrations limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('otisk kódu se nepřečte ani majiteli', v_ok);
end $$;

reset role;

select pg_temp.check('kód sám v databázi nikde neleží',
  not exists (select 1 from public.device_registrations where code_hash = :'kod1'));


\echo ''
\echo '== Registrace tabletu ===================================='

-- Registruje TABLET, na kterém není přihlášený nikdo — proto `anon`.
select set_config('test.user_id', '', false);
set role anon;

select device_id as zar1, klic as klic1
from public.registrovat_zarizeni(:'kod1') \gset

select device_id as zar2, klic as klic2
from public.registrovat_zarizeni(:'kod2') \gset

select set_config('test.klic1', :'klic1', false);
select set_config('test.klic2', :'klic2', false);

select pg_temp.check('klíč zařízení je dost dlouhý na to, aby se nedal hádat',
  length(:'klic1') = 64);

-- Týž kód podruhé, vymyšlený kód, vypršelý kód ----------------------
do $$
declare v_ok boolean;
begin
  begin
    perform public.registrovat_zarizeni(current_setting('test.kod1'));
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.check('týž kód podruhé neprojde', v_ok);

  begin
    perform public.registrovat_zarizeni('ZZZZZZZZ');
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.check('vymyšlený kód neprojde', v_ok);
end $$;

reset role;

-- Vypršelý kód. Posouvá se čas platnosti, ne hodiny.
insert into public.device_registrations
  (tenant_id, branch_id, nazev, code_hash, expires_at)
values (:'tenant', :'perla', 'tablet pozdní',
        encode(sha256(convert_to('STARYKOD', 'UTF8')), 'hex'),
        now() - interval '1 minute');

set role anon;
do $$
declare v_ok boolean;
begin
  begin
    perform public.registrovat_zarizeni('STARYKOD');
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.check('vypršelý kód neprojde', v_ok);
end $$;

reset role;

select pg_temp.check('klíč zařízení v databázi neleží',
  not exists (select 1 from public.branch_devices where key_hash = :'klic1'));


\echo ''
\echo '== Co se o zařízení nedá přečíst ========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean;
begin
  begin
    perform key_hash from public.branch_devices limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('klíč zařízení nepřečte ani majitel', v_ok);

  begin
    perform kiosk_secret from public.branches limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('tajemství pobočky nepřečte ani majitel', v_ok);
end $$;

select pg_temp.check('majitel zařízení v seznamu vidí',
  (select count(*) from public.branch_devices) = 2);

reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);
select pg_temp.check('číšník bez settings.manage seznam zařízení nevidí',
  (select count(*) from public.branch_devices) = 0);
reset role;

set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('cizí firma zařízení nevidí',
  (select count(*) from public.branch_devices) = 0);
reset role;


\echo ''
\echo '== Co vidí kiosek ========================================'

select set_config('test.user_id', '', false);
set role anon;

select pg_temp.check('kiosek vrací jen dohodnuté údaje',
  (select array_agg(k order by k)
     from jsonb_object_keys(public.kiosk_stav(:'klic1')) k)
  -- 'slug' přibyl migrací 20260902050000: QR na kiosku nese adresu,
  -- a do adresy patří slug pobočky, ne její název.
  = array['den', 'kod', 'platnost', 'pobocka', 'slug', 'smeny', 'zarizeni']);

select pg_temp.check('u směny na kiosku není nic než jméno a čas',
  (select array_agg(distinct k order by k)
     from jsonb_array_elements(public.kiosk_stav(:'klic1') -> 'smeny') s,
          jsonb_object_keys(s) k)
  = array['do', 'jmeno', 'od']);

select pg_temp.check('kiosek ukazuje jen dnešní směny své pobočky',
  jsonb_array_length(public.kiosk_stav(:'klic1') -> 'smeny') = 1
  and public.kiosk_stav(:'klic1') -> 'smeny' -> 0 ->> 'jmeno' = 'Marek Číšník');

select pg_temp.check('kód na kiosku je osm znaků',
  length(public.kiosk_stav(:'klic1') ->> 'kod') = 8);

do $$
declare v_ok boolean;
begin
  begin
    perform public.kiosk_stav('nesmysl');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('vymyšlený klíč zařízení stav nedostane', v_ok);

  -- Kiosek nemá vlastní přístup k datům. Jediné, co smí, je zavolat
  -- své tři funkce; kdyby si mohl číst tabulky sám, ležel by na baru
  -- účet, který vidí lidi.
  begin
    perform 1 from public.employees limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('zařízení si samo do lidí nesáhne', v_ok);

  begin
    perform 1 from public.shifts limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('zařízení si samo do rozpisu nesáhne', v_ok);
end $$;

reset role;


\echo ''
\echo '== Odvolané zařízení ====================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

update public.branch_devices
   set stav = 'revoked', revoked_at = now(), revoked_by = :'majitel'
 where id = :'zar2';

select pg_temp.check('odvolání zařízení projde majiteli',
  (select stav from public.branch_devices where id = :'zar2') = 'revoked');

reset role;

select set_config('test.user_id', '', false);
set role anon;

do $$
declare v_ok boolean;
begin
  begin
    perform public.kiosk_stav(current_setting('test.klic2'));
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('odvolaný tablet už kód neukáže', v_ok);

  begin
    perform public.pichnout_pinem(current_setting('test.klic2'), '4726', 'in');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('odvolaný tablet už nepíchne', v_ok);
end $$;

reset role;


\echo ''
\echo '== PIN ==================================================='

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  begin
    perform public.nastavit_pin(v_tenant, '123');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('tříčíselný PIN se nepřijme', v_ok);

  begin
    perform public.nastavit_pin(v_tenant, 'abcd');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('PIN z písmen se nepřijme', v_ok);

  begin
    perform public.nastavit_pin(v_tenant, '1111');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('samé stejné číslice se nepřijmou', v_ok);

  begin
    perform public.nastavit_pin(v_tenant, '1234');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('řada 1234 se nepřijme', v_ok);

  perform public.nastavit_pin(v_tenant, '4726');
  perform pg_temp.check('vlastní PIN si člověk nastaví',
    exists (select 1 from public.employee_pins p
            join public.employees e on e.id = p.employee_id
            where e.user_id = (select auth.uid())));
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', '88888888-8888-8888-8888-888888888888', false);
select public.nastavit_pin(:'tenant', '5391');
reset role;

set role authenticated;
select set_config('test.user_id', '99999999-9999-9999-9999-999999999999', false);
select public.nastavit_pin(:'tenant', '8064');
reset role;

select pg_temp.check('PIN v databázi čitelný není',
  not exists (select 1 from public.employee_pins where otisk in ('4726', '5391', '8064')));

select pg_temp.check('nastavit_pin nebere id člověka — cizí PIN nastavit nejde',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nastavit_pin' and p.pronargs = 2) = 1);

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean;
begin
  begin
    perform otisk from public.employee_pins limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('otisk PINu nepřečte ani majitel', v_ok);

  begin
    perform sul from public.employee_pins limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('sůl PINu nepřečte ani majitel', v_ok);
end $$;

reset role;

-- Číšník vidí, že PIN má — a nic víc -------------------------------
set role authenticated;
select set_config('test.user_id', :'marek', false);
select pg_temp.check('číšník vidí jen svůj řádek s PINem',
  (select count(*) from public.employee_pins) = 1);

do $$
declare v_ok boolean;
begin
  begin
    perform public.zrusit_pin(
      (select id from public.tenants limit 1),
      current_setting('test.zaskok_e')::uuid);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník cizí PIN nezruší', v_ok);
end $$;

reset role;



\echo ''
\echo '== Píchnutí kódem (vlastní telefon) ======================'

-- Kódy se počítají pod superuživatelem: app.kiosk_kod je schválně
-- nikomu nepřidělená, aby se s ní nedala zkoušet platnost kódů.
select app.kiosk_kod(:'perla', app.kiosk_okno(:'perla')) as kod_perla \gset
select app.kiosk_kod(:'perla', app.kiosk_okno(:'perla') - 20) as kod_stary \gset
select app.kiosk_kod(:'bar', app.kiosk_okno(:'bar')) as kod_bar \gset

select set_config('test.kod_stary', :'kod_stary', false);
select set_config('test.kod_perla', :'kod_perla', false);
select set_config('test.kod_bar', :'kod_bar', false);

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  begin
    perform public.pichnout_kodem(v_tenant, 'ABCD1234', 'in');
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.check('vymyšlený kód nepíchne', v_ok);

  begin
    perform public.pichnout_kodem(v_tenant, current_setting('test.kod_stary'), 'in');
    v_ok := false;
  exception when invalid_parameter_value then v_ok := true;
  end;
  perform pg_temp.check('vyfocený starý kód už nepíchne', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);

select udalost as ud1, pobocka as pob1, mimo_rozpis as mimo1
from public.pichnout_kodem(:'tenant', :'kod_perla', 'in') \gset

select pg_temp.check('kód Perly píchne na Perle', :'pob1' = 'Restaurace Černá Perla');
select pg_temp.check('kdo má směnu, není mimo rozpis', :'mimo1' = 'f');

-- Dvojí načtení téhož kódu ------------------------------------------
select udalost as ud2 from public.pichnout_kodem(:'tenant', :'kod_perla', 'in') \gset
select pg_temp.check('dvojí načtení nezaloží dva příchody', :'ud1' = :'ud2');

-- Kód druhé pobočky píchne tam, kde patří — ne na Perle.
select pobocka as pob2 from public.pichnout_kodem(:'tenant', :'kod_bar', 'in') \gset
select pg_temp.check('kód Bernardu píchne na Bernardu', :'pob2' = 'Bernard Bar Tábor');

reset role;

select pg_temp.check('píchnutí telefonem nemá zařízení',
  (select device_id from public.attendance_events where id = :'ud1') is null);

set role authenticated;
select set_config('test.user_id', :'cizi', false);
do $$
declare v_ok boolean;
begin
  begin
    perform public.pichnout_kodem(
      (select id from public.tenants limit 1),
      current_setting('test.kod_perla'), 'in');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('cizí firma kódem nepíchne', v_ok);
end $$;
reset role;


\echo ''
\echo '== Píchnutí PINem na kiosku =============================='

select set_config('test.user_id', '', false);
set role anon;

select ok as ok1, jmeno as jm1, mimo_rozpis as mimo2, udalost as ud3
from public.pichnout_pinem(:'klic1', '5391', 'in') \gset

select pg_temp.check('PIN na registrovaném tabletu píchne', :'ok1' = 't');
select pg_temp.check('píchnutí se připíše tomu, komu PIN patří', :'jm1' = 'Záskok Kioskový');
select pg_temp.check('kdo dnes v rozpisu není, je označený jako mimo rozpis', :'mimo2' = 't');

do $$
declare v_ok boolean;
begin
  -- PIN barmana z druhé pobočky. Neprojde, a nedozví se ani proč.
  select p.ok into v_ok
  from public.pichnout_pinem(current_setting('test.klic1'), '8064', 'in') p;
  perform pg_temp.check('PIN z druhé pobočky na Perle nepíchne', v_ok = false);
end $$;

reset role;

select pg_temp.check('píchnutí PINem má zařízení',
  (select device_id from public.attendance_events where id = :'ud3') = :'zar1');

select pg_temp.check('tablet si zapsal, kdy naposled sloužil',
  (select posledni_kdy from public.branch_devices where id = :'zar1') is not null);


\echo ''
\echo '== Zámek po pěti nezdarech =============================='

-- Marek si PIN nastaví znovu: tím se počítadlo nezdarů vynuluje
-- a zámek se zkouší z čistého stavu.
set role authenticated;
select set_config('test.user_id', :'marek', false);
select public.nastavit_pin(:'tenant', '4726');
reset role;

select set_config('test.user_id', '', false);
set role anon;

do $$
declare
  v_ok    boolean;
  v_i     integer;
begin
  for v_i in 1..5 loop
    select p.ok into v_ok
    from public.pichnout_pinem(current_setting('test.klic1'), '9999', 'in') p;
    if v_ok then
      raise exception 'SELHALO: vymyšlený PIN 9999 někomu sedl';
    end if;
  end loop;
  perform pg_temp.check('pětkrát špatný PIN neprojde ani jednou', true);

  -- A teď SPRÁVNÝ PIN. Nesmí projít — jinak je zámek k ničemu.
  select p.ok into v_ok
  from public.pichnout_pinem(current_setting('test.klic1'), '4726', 'in') p;
  perform pg_temp.check('po pěti nezdarech neprojde ani správný PIN', v_ok = false);
end $$;

reset role;

select pg_temp.check('počítadlo nezdarů se opravdu zapsalo',
  (select chyb from public.employee_pins where employee_id = :'marek_e') >= 5);

select pg_temp.check('zámek je nastavený do budoucna',
  (select zamceno_do from public.employee_pins where employee_id = :'marek_e') > now());

select pg_temp.check('nezdařené pokusy jsou v auditu',
  (select count(*) from public.audit_log where action = 'pin.nezdar') >= 5);

-- Zamčeno je, dokud se PIN nenastaví znovu. Zapomenutý PIN se neposílá.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.zrusit_pin(:'tenant', :'marek_e');
reset role;

select pg_temp.check('správce docházky PIN zruší',
  not exists (select 1 from public.employee_pins where employee_id = :'marek_e'));

select pg_temp.check('zrušení PINu je v auditu',
  exists (select 1 from public.audit_log where action = 'pin.zruseno'));


\echo ''
\echo '== Konec přímého zápisu docházky za sebe ================='

-- Tohle je bod 4. Do téhle migrace si člověk mohl přímým voláním
-- rozhraní založit příchod k 1. červenci ve 3:00 — politika ho pustila,
-- když měl `source = 'app'` a vlastní employee_id.

select pg_temp.check('politika už nestojí na source = app',
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy
   where polname = 'attendance_insert') not like '%source%');

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare
  v_tenant uuid;
  v_perla  uuid;
  v_emp    uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches where slug = 'cerna-perla';
  select e.id into v_emp from public.employees e where e.user_id = (select auth.uid());

  begin
    insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, source, occurred_at)
    values (v_tenant, v_perla, v_emp, 'in', 'app', now() - interval '9 hours');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník si příchod zpětně sám nezapíše', v_ok);

  begin
    insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, source)
    values (v_tenant, v_perla, v_emp, 'out', 'manual');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('ani jako ruční záznam', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare
  v_tenant uuid;
  v_perla  uuid;
  v_pocet  integer;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches where slug = 'cerna-perla';

  insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, source, note)
  values (v_tenant, v_perla, current_setting('test.zaskok_e')::uuid, 'out', 'manual',
          'zapsal vedoucí — zaskakuje');

  select count(*) into v_pocet from public.attendance_events
  where source = 'manual' and note <> '';
  perform pg_temp.check('vedoucí s attendance.manage ruční záznam zapíše', v_pocet >= 1);
end $$;

reset role;


\echo ''
\echo '=========================================================='
\echo ' KROK 6 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
