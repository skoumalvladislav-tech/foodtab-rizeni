-- Scénář pro krok 7 — pozvánka bez oprávnění.
--
-- Pokrývá migraci 20260901200000_pozvanka_bez_role a oddíl 5 zadání
-- docs/pozvanky-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok6_scenar.sql: firma, dvě pobočky
-- a lidé už existují (majitel@foodtab.cz, provozni@, cisnik@, kuchar@,
-- cizi@jinafirma.cz).
--
-- Vzniká tu nový stav: člen firmy BEZ role. Zadání je na to úzkostlivé
-- schválně — „ověřit, ne předpokládat“ — a v PGlite se to ověřit nedá:
-- běží se tam jako superuživatel, role `authenticated` neexistuje
-- a RLS se neuplatní, takže by kontrola „nevidí cizí směny“ prošla
-- i tehdy, kdyby je viděl všechny.
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

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as marek    from public.profiles where email = 'cisnik@foodtab.cz' \gset

select id as r_servis from public.roles
  where tenant_id = :'tenant' and key = 'servis' \gset
select id as r_majitel from public.roles
  where tenant_id = :'tenant' and is_owner \gset

/*
  Dvě role se zakládají tady, ne hledají mezi šablonami.

  Zkoušelo se to napřed hledáním („najdi roli, kterou provozní nesmí
  přidělit“) a bylo to křehké hned dvakrát. Provozní má podle šablony
  všechno kromě agents.manage a settings.manage, takže takovou roli
  mezi šablonami vůbec nemusí být — a `\gset` nad prázdným výsledkem
  celý scénář utne. Druhá past: až někdo šablonu upraví, přestal by
  scénář zkoušet to, co má, a nikdo by si toho nevšiml. Test, který
  tiše zkouší něco jiného, je horší než žádný.
*/
insert into public.roles (tenant_id, key, label, is_owner)
values (:'tenant', 'zkouska_strop', 'Zkouška — strop', false)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as r_nesmi \gset

insert into public.role_permissions (role_id, permission_key)
values (:'r_nesmi', 'settings.manage') on conflict do nothing;

insert into public.roles (tenant_id, key, label, is_owner)
values (:'tenant', 'zkouska_citliva', 'Zkouška — citlivé', false)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as r_citliva \gset

insert into public.role_permissions (role_id, permission_key)
values (:'r_citliva', 'payroll.read') on conflict do nothing;

select pg_temp.check('payroll.read je opravdu vedené jako citlivé',
  (select sensitive from public.permissions where key = 'payroll.read'));

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cekajici@foodtab.cz',
   '{"full_name":"Čekající Zkouška"}')
on conflict (id) do nothing;

-- Do `do $$` bloků se proměnné psql nedostanou, musí přes set_config.
-- VŠECHNY se nastavují tady, dřív než je někdo čte.
select set_config('test.r_nesmi',   :'r_nesmi',   false);
select set_config('test.r_majitel', :'r_majitel', false);
select set_config('test.r_citliva', :'r_citliva', false);
select set_config('test.r_servis',  :'r_servis',  false);


\echo ''
\echo '== Vystavení pozvánky bez oprávnění ======================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select token as tok1 from app.create_invitation(
  :'tenant', null, 'email', 'cekajici@foodtab.cz') \gset

select pg_temp.check('pozvánka bez oprávnění projde', length(:'tok1') = 64);

reset role;

select pg_temp.check('a role v ní opravdu prázdná je',
  (select role_id from public.invitations where email = 'cekajici@foodtab.cz') is null);

select pg_temp.check('token v databázi čitelný není',
  not exists (select 1 from public.invitations where token_hash = :'tok1'));


\echo ''
\echo '== Strop platí dál, když role zadaná je =================='

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select pg_temp.check('provozní nemá settings.manage',
  not app.has_access(:'tenant', 'settings.manage', null));

do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  begin
    perform app.create_invitation(v_tenant, current_setting('test.r_nesmi')::uuid,
                                  'email', 'nekdo@foodtab.cz');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('provozní nepozve na roli, kterou sám nemá', v_ok);

  begin
    perform app.create_invitation(v_tenant, current_setting('test.r_majitel')::uuid,
                                  'email', 'sef@foodtab.cz');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('a už vůbec ne na majitele', v_ok);
end $$;

reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  begin
    perform app.create_invitation(v_tenant, current_setting('test.r_citliva')::uuid,
                                  'sms', '+420601234567');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('role s citlivým právem nejde poslat přes SMS', v_ok);

  -- Pozvánka bez role přes SMS naopak projít MUSÍ: neveze žádné
  -- oprávnění, takže SMS nedoručí nic citlivého. Citlivé právo se
  -- přidělí až potom, a to už přes memberships, kde platí strop.
  perform app.create_invitation(v_tenant, null, 'sms', '+420601999888');
  perform pg_temp.check('pozvánka bez role přes SMS projde', true);
end $$;

reset role;


\echo ''
\echo '== Přijetí ==============================================='

set role authenticated;
select set_config('test.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select app.accept_invitation(:'tok1');
reset role;

select pg_temp.check('členství vzniklo i bez role',
  (select status from public.memberships
   where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 'active');

select pg_temp.check('a role je prázdná',
  (select role_id from public.memberships
   where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') is null);


\echo ''
\echo '== Člen bez oprávnění neprojde nikam ====================='

set role authenticated;
select set_config('test.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- Ptáme se na KAŽDÉ právo z katalogu, ne na jedno vybrané. Jedno
-- zapomenuté právo je přesně ta díra, kterou by vybraná trojice
-- nenašla.
select pg_temp.check('ani jedno právo z katalogu neprojde na firemní úrovni',
  not exists (select 1 from public.permissions p
              where app.has_access(:'tenant', p.key, null)));

select pg_temp.check('ani na pobočce',
  not exists (select 1 from public.permissions p
              where app.has_access(:'tenant', p.key, :'perla')));

select pg_temp.check('ani „kdekoli ve firmě“',
  not exists (select 1 from public.permissions p
              where app.has_permission(:'tenant', p.key)));

select pg_temp.check('není vlastník', not app.is_owner(:'tenant'));
select pg_temp.check('ale členem firmy je', app.is_member(:'tenant'));

select pg_temp.check('nevidí žádnou pobočku',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 0);

-- Přímé volání rozhraní, ne jen nabídka: politiky to musí zavřít samy.
select pg_temp.check('rozpis směn nevidí',
  (select count(*) from public.shifts) = 0);

select pg_temp.check('docházku nevidí',
  (select count(*) from public.attendance_events) = 0);

select pg_temp.check('seznam poboček nevidí',
  (select count(*) from public.branches) = 0);

select pg_temp.check('cizí lidi nevidí',
  (select count(*) from public.employees where user_id is distinct from
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) = 0);

-- Co naopak MÁ mít: jméno firmy a vlastní údaje. Bez toho by po
-- přihlášení nebylo co ukázat.
select pg_temp.check('jméno firmy zná',
  (select count(*) from public.tenants where id = :'tenant') = 1);

select pg_temp.check('kontext se vrátí, ne prázdno',
  public.my_context(:'tenant') is not null);

select pg_temp.check('role v kontextu je prázdná',
  public.my_context(:'tenant') -> 'role' = 'null'::jsonb);

select pg_temp.check('a oprávnění taky',
  public.my_context(:'tenant') -> 'permissions' = '[]'::jsonb);

select pg_temp.check('i seznam poboček v kontextu',
  public.my_context(:'tenant') -> 'branches' = '[]'::jsonb);

select pg_temp.check('firma je v rozcestníku, ať je kam se přihlásit',
  (select count(*) from public.my_tenants()) = 1);

reset role;


\echo ''
\echo '== Po přidělení oprávnění ================================'

-- Pozor na pořadí: pozvánka bez role jde s výchozím rozsahem 'branch'
-- a prázdným seznamem poboček. Samotná role tedy nic neotevře, dokud
-- se nedoplní rozsah. Není to chyba, ale obrazovka na to nesmí
-- zapomenout — „přidělit oprávnění“ znamená roli I rozsah.

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.memberships set role_id = :'r_servis'
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
reset role;

set role authenticated;
select set_config('test.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select pg_temp.check('samotná role bez rozsahu pořád nic neotevře',
  not app.has_access(:'tenant', 'shifts.read', :'perla'));
reset role;

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla' from public.memberships m
where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

select pg_temp.check('s rozsahem už na Perle vidí rozpis',
  app.has_access(:'tenant', 'shifts.read', :'perla'));

select pg_temp.check('a víc pořád ne',
  not app.has_access(:'tenant', 'people.manage', :'perla'));

select pg_temp.check('vidí právě tu jednu pobočku',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 1);

select pg_temp.check('role je v kontextu vidět',
  public.my_context(:'tenant') -> 'role' ->> 'key' = 'servis');

reset role;


\echo ''
\echo '== Druhá pozvánka nesmí sebrat, co člověk má ============='

-- `on conflict do update set role_id = excluded.role_id` by prázdnou
-- rolí SMAZALO tu, kterou člověk už má. Vedoucí, který omylem pošle
-- druhou pozvánku kolegovi, který už uvnitř je, by ho tím vyřadil
-- z aplikace — a nikde by nestálo proč.

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select token as tok2 from app.create_invitation(
  :'tenant', null, 'email', 'cisnik@foodtab.cz') \gset
reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);
select app.accept_invitation(:'tok2');
reset role;

select pg_temp.check('číšníkovi jeho role zůstala',
  (select role_id from public.memberships where user_id = :'marek') = :'r_servis');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select token as tok3 from app.create_invitation(
  :'tenant', :'r_citliva', 'email', 'cisnik@foodtab.cz') \gset
reset role;

set role authenticated;
select set_config('test.user_id', :'marek', false);
select app.accept_invitation(:'tok3');
reset role;

select pg_temp.check('pozvánka S rolí ji pořád přepíše',
  (select role_id from public.memberships where user_id = :'marek') = :'r_citliva');

-- Vrátit číšníka tam, kde ho další scénáře čekají.
update public.memberships set role_id = :'r_servis' where user_id = :'marek';


\echo ''
\echo '== Přidělení oprávnění a rozsahu ========================='

/*
  Obrazovka přidělení nastavuje roli I rozsah
  (docs/odpovedi-pozvanky-2026-09-01.md, oddíl 1).

  POZOR NA JEDNU VĚC, která se ukázala až tady: rozsah smí přidělit
  jedině člen s FIREMNÍM rozsahem. Politika `membership_branches_write`
  se ptá `app.has_access(m.tenant_id, 'people.manage')` bez pobočky
  a has_access bez pobočky vyžaduje `scope = 'tenant'`.

  Vedoucí jedné pobočky proto nepřidá pobočku nikomu — ani tu svoji.
  Tím pádem se ale nikdy neuplatní ani strop na pobočku (pravidlo 4
  z docs/pravidlo-neprideluj-vic.md): ten, na koho míří, se k tabulce
  nedostane už o krok dřív. Není to díra — je to zavřeno víc, než
  pravidlo žádá — ale je to dobré vědět a je to tady napsané, aby to
  příští čtenář nemusel hledat znovu.
*/

reset role;

select id as bar from public.branches where slug = 'bernard-bar' \gset

insert into public.roles (tenant_id, key, label, is_owner)
values (:'tenant', 'zkouska_vedouci_lidi', 'Zkouška — vedoucí lidí', false)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as r_vedouci \gset

insert into public.role_permissions (role_id, permission_key)
values (:'r_vedouci', 'people.manage'), (:'r_vedouci', 'shifts.read')
on conflict do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'vedouci-perly@foodtab.cz',
   '{"full_name":"Vedoucí Perly"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', :'r_vedouci', 'active', 'branch')
on conflict (tenant_id, user_id) do update
  set role_id = excluded.role_id, scope = excluded.scope
returning id as clen_vedouci \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'clen_vedouci', :'perla') on conflict do nothing;

select id as clen_cekajici from public.memberships
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' \gset

select set_config('test.clen_cekajici', :'clen_cekajici', false);
select set_config('test.bar', :'bar', false);
select set_config('test.perla', :'perla', false);

set role authenticated;
select set_config('test.user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

select pg_temp.check('vedoucí Perly spravuje lidi na Perle',
  app.has_access(:'tenant', 'people.manage', :'perla'));
select pg_temp.check('a na Bernardu ne',
  not app.has_access(:'tenant', 'people.manage', :'bar'));

do $$
declare v_ok boolean;
begin
  begin
    insert into public.membership_branches (membership_id, branch_id)
    values (current_setting('test.clen_cekajici')::uuid,
            current_setting('test.bar')::uuid);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('vedoucí pobočky nepřidělí rozsah na cizí pobočku', v_ok);

  -- A ani na tu vlastní. Viz komentář nad oddílem.
  begin
    insert into public.membership_branches (membership_id, branch_id)
    values (current_setting('test.clen_cekajici')::uuid,
            current_setting('test.perla')::uuid);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('vedoucí pobočky nepřidělí rozsah ani na vlastní', v_ok);
end $$;

reset role;

select pg_temp.check('Bernard tam opravdu nepřibyl',
  not exists (select 1 from public.membership_branches
              where membership_id = :'clen_cekajici' and branch_id = :'bar'));

-- Provozní má firemní rozsah, takže rozsah přidělit smí. Bez téhle
-- kontroly by odmítnutí výš mohlo stejně dobře znamenat „authenticated
-- nemá na tabulku právo vůbec“ — chybový kód by byl týž.
set role authenticated;
select set_config('test.user_id', :'provozni', false);

insert into public.membership_branches (membership_id, branch_id)
values (:'clen_cekajici', :'bar') on conflict do nothing;

reset role;

select pg_temp.check('provozní s firemním rozsahem pobočku přidělí',
  exists (select 1 from public.membership_branches
          where membership_id = :'clen_cekajici' and branch_id = :'bar'));

-- Strop na roli platí i tady, ne jen u pozvánky.
set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean;
begin
  begin
    update public.memberships
       set role_id = current_setting('test.r_majitel')::uuid
     where id = current_setting('test.clen_cekajici')::uuid;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('provozní nepřidělí roli majitele ani přes členství', v_ok);
end $$;

reset role;


\echo ''
\echo '== Vlastní členství: tiché neprovedení ==================='

/*
  Tohle je důvod, proč akce na obrazovce po zápisu ČTE, co v databázi
  zůstalo, místo aby se spolehla na to, že nepřišla chyba.

  Politika `memberships_update` má `user_id <> auth.uid()` v části
  `using`. Řádek, který jí neprojde, není pro update vůbec vidět —
  příkaz tedy změní NULA řádků a neohlásí nic. Vypadá to jako úspěch.

  Nekontrolovat to znamená napsat vedoucímu „uloženo“ nad hodnotou,
  která se neuložila.
*/

set role authenticated;
select set_config('test.user_id', :'majitel', false);

update public.memberships set scope = 'branch'
 where user_id = :'majitel' and tenant_id = :'tenant';

reset role;

select pg_temp.check('majitel si vlastní členství nezměnil',
  (select scope from public.memberships
   where user_id = :'majitel' and tenant_id = :'tenant') = 'tenant');


\echo ''
\echo '== Zvát pořád smí jen správce lidí ======================='

set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare
  v_tenant uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  begin
    perform app.create_invitation(v_tenant, null, 'email', 'kdokoli@foodtab.cz');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('číšník nepozve nikoho ani bez role v pozvánce', v_ok);
end $$;

reset role;


\echo ''
\echo '=========================================================='
\echo ' KROK 7 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
