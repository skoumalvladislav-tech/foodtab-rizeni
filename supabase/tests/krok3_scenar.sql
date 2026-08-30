-- Scénář pro krok 3 — rozhraní autorizace pro aplikaci.
-- Navazuje na etapa0_scenar.sql a krok2_scenar.sql: firma, dvě pobočky,
-- majitel (1111…), vedoucí Perly (2222…) a cizí uživatel (3333…) už
-- existují.
--
-- Kontroly jsou psané tak, aby ověřovaly, že se někdo NEDOSTANE tam,
-- kam nemá — ne že šťastná cesta funguje.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla',  :'perla',  false);

\echo ''
\echo '== Katalog sedí s aplikací ================================'
-- Když tahle kontrola spadne, přibylo (nebo zmizelo) oprávnění
-- v migraci a nedoplnilo se do seznamu PERMISSIONS v lib/authz.ts.
-- Neznámý klíč by pak jen tiše odmítal přístup a hledalo by se to dlouho.
select pg_temp.check('seznam oprávnění odpovídá lib/authz.ts',
  (select array_agg(key order by key) from public.permissions) = array[
    'agents.manage','ai.use','approvals.decide','attendance.manage',
    'attendance.read','banking.read','communication.manage',
    'communication.read','finance.manage','finance.read',
    'marketing.manage','marketing.publish','marketing.read',
    'menu_ai.manage','menu_ai.use','menus.manage','menus.read',
    'motivation.manage','motivation.read',
    'payroll.export','payroll.manage','people.manage','purchasing.manage',
    'purchasing.read','recipes.manage','recipes.read','settings.manage',
    'shifts.manage','shifts.read','tasks.manage','tasks.read'
  ]::text[]);

select pg_temp.check('seznam modulů odpovídá lib/authz.ts',
  (select array_agg(key order by key) from public.modules)
    = array['finance','marketing','menu','objednavky','provoz']::text[]);

-- Receptury a jídelní lístky zůstávají v provozu. Tvorba menu je dílna
-- na návrhy, ne místo, kde lístky bydlí — kdyby se ta čtyři oprávnění
-- přestěhovala, vzalo by se právo lidem, kteří ho dnes mají, a lístky by
-- zhasly každé firmě bez nového modulu. Viz docs/modul-menu-zadani.md.
select pg_temp.check('recipes.* a menus.* zůstaly v provozu',
  (select array_agg(module_key order by key) from public.permissions
   where key in ('recipes.read','recipes.manage','menus.read','menus.manage'))
    = array['provoz','provoz','provoz','provoz']::text[]);

\echo ''
\echo '== Průzor přeposílá stejné rozhodnutí ====================='
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

select pg_temp.check('majitel: public.has_access = app.has_access',
  public.has_access(:'tenant', 'settings.manage', null)
    = app.has_access(:'tenant', 'settings.manage', null)
  and public.has_access(:'tenant', 'settings.manage', null));

select pg_temp.check('neznámé oprávnění neprojde',
  public.has_access(:'tenant', 'neexistujici.pravo', null) = false);

\echo ''
\echo '== Rozsah vedoucího ======================================='
select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);

select pg_temp.check('vedoucí smí plánovat na Perle',
  public.has_access(:'tenant', 'shifts.manage', :'perla'));
select pg_temp.check('vedoucí NESMÍ plánovat na Baru',
  public.has_access(:'tenant', 'shifts.manage', :'bar') = false);
select pg_temp.check('vedoucí NESMÍ na firemní úroveň',
  public.has_access(:'tenant', 'shifts.manage', null) = false);
select pg_temp.check('vedoucí nemá nastavení firmy ani na své pobočce',
  public.has_access(:'tenant', 'settings.manage', :'perla') = false);

\echo ''
\echo '== Kontext pro vykreslení ================================='
select pg_temp.check('vedoucí vidí jednu pobočku, a to svou',
  jsonb_array_length(public.my_context(:'tenant') -> 'branches') = 1
  and public.my_context(:'tenant') -> 'branches' -> 0 ->> 'slug' = 'cerna-perla');

select pg_temp.check('vedoucí má rozsah branch',
  public.my_context(:'tenant') -> 'membership' ->> 'scope' = 'branch');

select pg_temp.check('vedoucí nemá v kontextu nastavení firmy',
  not (public.my_context(:'tenant') -> 'permissions' ? 'settings.manage'));

select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('majitel vidí obě pobočky a má rozsah tenant',
  jsonb_array_length(public.my_context(:'tenant') -> 'branches') = 2
  and public.my_context(:'tenant') -> 'membership' ->> 'scope' = 'tenant');

-- Barva odlišuje pobočky v hlavičce. Dvě pobočky nesmí začínat stejně,
-- jinak by přepínač nepomohl proti tomu, kvůli čemu vznikl.
select pg_temp.check('každá pobočka má barvu z palety',
  not exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'branches') b
    where coalesce(b ->> 'color', '') not in
          ('slate','indigo','violet','sky','teal','emerald','amber','rose')));

select pg_temp.check('pobočky nemají stejnou barvu',
  (select count(distinct b ->> 'color')
   from jsonb_array_elements(public.my_context(:'tenant') -> 'branches') b) = 2);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.branches set color = '#ff00ff'
    where id = current_setting('test.perla')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prošla barva mimo paletu'; end if;
  raise notice '  OK    barva mimo paletu neprojde';
end $$;

select pg_temp.check('majitel je v kontextu označený jako vlastník',
  (public.my_context(:'tenant') -> 'role' ->> 'isOwner')::boolean);

select pg_temp.check('majitel má v seznamu tenantů právě tuhle firmu',
  (select count(*) from public.my_tenants()) = 1
  and (select tenant_id from public.my_tenants()) = :'tenant');

\echo ''
\echo '== Stav modulu se propisuje do kontextu ==================='
-- Modul Finance je od scénáře etapy 0 zapnutý. Kontrolujeme, že se to
-- projeví v kontextu — a hlavně že se vypnutí projeví taky. Schovaná
-- položka v menu není zámek, ale nesmí zůstat svítit, když modul zhasne.
select pg_temp.check('kontext nabízí všech pět modulů',
  jsonb_array_length(public.my_context(:'tenant') -> 'modules') = 5);

select pg_temp.check('zapnutý modul je označený jako aktivní i s oprávněními',
  exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'modules') m
    where m ->> 'key' = 'finance' and (m ->> 'active')::boolean)
  and public.my_context(:'tenant') -> 'permissions' ? 'finance.read');

reset role;
update public.tenant_modules set status = 'suspended'
where tenant_id = :'tenant' and module_key = 'finance';

set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

-- Majitel má jinak všechno. Přes vypnutý modul se ale nedostane taky.
select pg_temp.check('pozastavený modul zavírá i majiteli',
  public.has_access(:'tenant', 'finance.read', null) = false);
-- Zůstane v seznamu, ale zašedlý. Rozcestník má ukázat, co si lze
-- přikoupit; dovnitř se tím nikdo nedostane.
select pg_temp.check('pozastavený modul je v kontextu jako neaktivní',
  exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'modules') m
    where m ->> 'key' = 'finance' and not (m ->> 'active')::boolean));
select pg_temp.check('oprávnění vypnutého modulu zmizí z kontextu',
  not (public.my_context(:'tenant') -> 'permissions' ? 'finance.read'));

-- Vracíme stav, ve kterém jsme ho našli.
reset role;
update public.tenant_modules set status = 'active'
where tenant_id = :'tenant' and module_key = 'finance';

\echo ''
\echo '== Nezapnutý modul odmítá i přímé volání =================='
-- Pravidlo 5. Finance výš se testovaly jako POZASTAVENÉ — řádek
-- v tenant_modules existuje a má status 'suspended'. Tvorba menu je
-- druhý případ: firma pro něj nemá řádek vůbec, protože ho migrace
-- stávajícím firmám schválně nezaložila. Ten případ chodí databází
-- jinudy (vnitřní spojení nenajde nic, místo aby našlo a zahodilo),
-- takže se musí ověřit zvlášť.
--
-- „Přímé volání adresy“ v aplikaci znamená /<rozsah>/menu s vynechanou
-- navigací. Ta obrazovka se ptá na menu_ai.use přes tenhle průzor, takže
-- kontrola měří přesně to, co ji zavře.

set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

select pg_temp.check('modul menu je v katalogu',
  exists (select 1 from public.modules
          where key = 'menu' and not is_base and sort_order = 15));
select pg_temp.check('stávající firma modul menu zapnutý nemá',
  not exists (select 1 from public.tenant_modules
              where tenant_id = :'tenant' and module_key = 'menu'));

-- Tohle je jádro pravidla 5: majitel má jinak všechno, a přesto ho
-- nezapnutý modul nepustí dál. Kdyby to prošlo, stačilo by opsat adresu.
select pg_temp.check('nezapnutý modul zavírá menu_ai.use i majiteli',
  public.has_access(:'tenant', 'menu_ai.use', null) = false);
select pg_temp.check('nezapnutý modul zavírá i menu_ai.manage',
  public.has_access(:'tenant', 'menu_ai.manage', null) = false);
select pg_temp.check('nezapnutý modul zavírá i na pobočce',
  public.has_access(:'tenant', 'menu_ai.use', :'perla') = false);
select pg_temp.check('oprávnění nezapnutého modulu nejsou v kontextu',
  not (public.my_context(:'tenant') -> 'permissions' ? 'menu_ai.use')
  and not (public.my_context(:'tenant') -> 'permissions' ? 'menu_ai.manage'));
select pg_temp.check('modul menu je v kontextu, ale zašedlý',
  exists (
    select 1 from jsonb_array_elements(public.my_context(:'tenant') -> 'modules') m
    where m ->> 'key' = 'menu' and not (m ->> 'active')::boolean));

-- A po zapnutí se otevře. Bez tohohle by kontrola výš prošla i tehdy,
-- kdyby oprávnění nefungovalo vůbec.
reset role;
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'menu');

set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('po zapnutí modulu majitel na menu_ai.use dosáhne',
  public.has_access(:'tenant', 'menu_ai.use', null));

-- Vracíme stav, ve kterém jsme ho našli: u stávajících firem vypnutý.
reset role;
delete from public.tenant_modules
where tenant_id = :'tenant' and module_key = 'menu';

\echo ''
\echo '== Provozní den z aplikace ================================'
-- Obrazovka se nesmí ptát kalendáře serveru. Hodina začátku dne i časové
-- pásmo patří pobočce, ne tomu, kde zrovna běží aplikace.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('účet ve 2:15 patří do včerejší uzávěrky i přes průzor',
  public.business_date(:'perla', '2026-08-24 02:15+02'::timestamptz) = date '2026-08-23');
select pg_temp.check('průzor vrací totéž co app.business_date',
  public.business_date(:'bar', '2026-08-24 10:00+02'::timestamptz)
    = app.business_date(:'bar', '2026-08-24 10:00+02'::timestamptz));

\echo ''
\echo '== Cizí uživatel =========================================='
set role authenticated;
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);

select pg_temp.check('cizí se nedozví ani provozní den pobočky',
  public.business_date(:'perla', now()) is null);
select pg_temp.check('cizí nemá přístup nikam',
  public.has_access(:'tenant', 'shifts.read', :'perla') = false
  and public.has_access(:'tenant', 'shifts.read', null) = false);
select pg_temp.check('cizí nedostane kontext firmy',
  public.my_context(:'tenant') is null);
select pg_temp.check('cizí nemá žádnou firmu',
  (select count(*) from public.my_tenants()) = 0);

\echo ''
\echo '== Odškrtnutí úkolu adresátem ============================='
-- Kuchař ani číšník nemají tasks.manage. Přesto si musí odškrtnout úkol,
-- který je zadaný jim — jinak by u nich musel stát vedoucí a klikat za ně.
reset role;

select id as jana from public.employees where full_name = 'Jana Kuchařka' \gset

insert into auth.users (id, email, raw_user_meta_data)
values ('55555555-5555-5555-5555-555555555555', 'cisnik@foodtab.cz',
        '{"full_name":"Marek Číšník"}');

insert into public.memberships (tenant_id, user_id, role_id, scope)
select :'tenant', '55555555-5555-5555-5555-555555555555', r.id, 'branch'
from public.roles r where r.tenant_id = :'tenant' and r.key = 'servis'
returning id as clenstvi \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'clenstvi', :'perla');

insert into public.employees (tenant_id, branch_id, user_id, full_name)
values (:'tenant', :'perla', '55555555-5555-5555-5555-555555555555', 'Marek Číšník')
returning id as marek \gset

insert into public.tasks (tenant_id, branch_id, employee_id, title)
values (:'tenant', :'perla', :'marek', 'Doplnit ubrousky')
returning id as ukol_marka \gset

insert into public.tasks (tenant_id, branch_id, employee_id, title)
values (:'tenant', :'perla', :'jana', 'Objednat maso')
returning id as ukol_cizi \gset

insert into public.tasks (tenant_id, branch_id, title)
values (:'tenant', :'perla', 'Vynést sklo')
returning id as ukol_nicii \gset

select set_config('test.ukol_cizi',  :'ukol_cizi',  false);
select set_config('test.ukol_marka', :'ukol_marka', false);

set role authenticated;
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);

select pg_temp.check('číšník nemá tasks.manage',
  public.has_access(:'tenant', 'tasks.manage', :'perla') = false);
select pg_temp.check('číšník na svůj úkol vidí',
  exists (select 1 from public.tasks where id = :'ukol_marka'));

-- Politika zůstává přísná: přímý zápis do tabulky neprojde ani teď.
update public.tasks set title = 'Přepsáno' where id = :'ukol_marka';
select pg_temp.check('přímá změna úkolu číšníkovi neprojde',
  (select title from public.tasks where id = :'ukol_marka') = 'Doplnit ubrousky');

select public.complete_task(:'ukol_marka');
select pg_temp.check('svůj úkol si číšník odškrtne',
  (select status from public.tasks where id = :'ukol_marka') = 'done'
  and (select done_by from public.tasks where id = :'ukol_marka') = :'marek'
  and (select done_at from public.tasks where id = :'ukol_marka') is not null);

select public.complete_task(:'ukol_marka');
select pg_temp.check('druhé kliknutí nic nepokazí',
  (select done_by from public.tasks where id = :'ukol_marka') = :'marek');

select public.complete_task(:'ukol_nicii');
select pg_temp.check('nezadaný úkol na jeho pobočce zavřít smí',
  (select status from public.tasks where id = :'ukol_nicii') = 'done');

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.complete_task(current_setting('test.ukol_cizi')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník zavřel cizí úkol'; end if;
  raise notice '  OK    cizí úkol číšník nezavře';
end $$;

select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.complete_task(current_setting('test.ukol_marka')::uuid);
  exception when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí uživatel sáhl na úkol'; end if;
  raise notice '  OK    cizímu uživateli úkol neexistuje';
end $$;

\echo ''
\echo '== Pozvánky přes průzor ==================================='
-- Zvát lidi umí jen správce lidí. Číšník s rolí Servis ho nemá.
set role authenticated;
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);
select id as role_kuchyne from public.roles
 where tenant_id = :'tenant' and key = 'kuchyne' \gset
select set_config('test.role_kuchyne', :'role_kuchyne', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.create_invitation(
      current_setting('test.tenant')::uuid,
      current_setting('test.role_kuchyne')::uuid,
      'email', 'kuchar@foodtab.cz');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník vystavil pozvánku'; end if;
  raise notice '  OK    kdo nespravuje lidi, pozvánku nevystaví';
end $$;

-- Majitel ano. Token dostane právě jednou.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select token as pozvanka from public.create_invitation(
  :'tenant', :'role_kuchyne', 'email', 'kuchar@foodtab.cz') \gset

select pg_temp.check('token má rozumnou délku',
  length(:'pozvanka') = 64);

-- Otisk čteme mimo roli authenticated — ta na ten sloupec od téhle
-- migrace právo nemá, což je celý smysl kontroly o dva odstavce níž.
reset role;
select pg_temp.check('v databázi je jen otisk, ne token',
  exists (select 1 from public.invitations i
          where i.email = 'kuchar@foodtab.cz'
            and i.token_hash = encode(sha256(convert_to(:'pozvanka', 'UTF8')), 'hex')));
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);

-- Otisk se přes API nečte ani správci lidí.
do $$
declare v_ok boolean := false;
begin
  begin
    perform token_hash from public.invitations limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: otisk tokenu šel přečíst'; end if;
  raise notice '  OK    otisk tokenu se přes API nečte';
end $$;

-- Role s citlivým oprávněním nejde pozvat přes SMS.
select id as role_provozni from public.roles
 where tenant_id = :'tenant' and key = 'provozni' \gset
select set_config('test.role_provozni', :'role_provozni', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.create_invitation(
      current_setting('test.tenant')::uuid,
      current_setting('test.role_provozni')::uuid,
      'sms', '+420601234567');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: citlivá role prošla přes SMS'; end if;
  raise notice '  OK    citlivou roli nejde pozvat přes SMS';
end $$;

-- Přijetí pozvánky cizím uživatelem: vznikne členství.
reset role;
insert into auth.users (id, email, raw_user_meta_data)
values ('66666666-6666-6666-6666-666666666666', 'kuchar@foodtab.cz',
        '{"full_name":"Nový Kuchař"}');

set role authenticated;
select set_config('test.user_id', '66666666-6666-6666-6666-666666666666', false);
select public.accept_invitation(:'pozvanka');

select pg_temp.check('pozvaný se stal členem firmy',
  public.my_context(:'tenant') is not null
  and public.my_context(:'tenant') -> 'role' ->> 'key' = 'kuchyne');

-- Spotřebovaná pozvánka je spotřebovaná. Kdyby token šel použít
-- podruhé, stačilo by ho jednou zahlédnout přes rameno.
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
select set_config('test.pozvanka', :'pozvanka', false);
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.accept_invitation(current_setting('test.pozvanka'));
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: token prošel podruhé'; end if;
  raise notice '  OK    tentýž token podruhé neprojde';
end $$;

\echo ''
\echo '== Nepřihlášený se nedostane k ničemu ====================='
reset role;
set role anon;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.has_access(current_setting('test.tenant')::uuid, 'shifts.read', null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal has_access'; end if;
  raise notice '  OK    nepřihlášený nezavolá has_access';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.my_context(current_setting('test.tenant')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal my_context'; end if;
  raise notice '  OK    nepřihlášený nezavolá my_context';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.my_tenants();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nepřihlášený zavolal my_tenants'; end if;
  raise notice '  OK    nepřihlášený nezavolá my_tenants';
end $$;

reset role;
select set_config('test.user_id', '', false);

\echo ''
\echo '=========================================================='
\echo ' KROK 3 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
