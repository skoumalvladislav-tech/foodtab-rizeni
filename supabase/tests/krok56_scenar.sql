-- Scénář pro krok 56 — pozvánku si nikdo nepřivlastní přepsáním profilu.
--
-- Pokrývá 20260924130000_pozvanka_podle_uctu.sql.
--
-- Navazuje na etapa0_scenar.sql až krok54_scenar.sql (firma Foodtab
-- s.r.o., pobočka Černá perla, majitel@foodtab.cz). Krok 55 si bere
-- jiná větev.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Přihlášený si v profilu nepřepíše e-mail ani telefon — a volbu
--   e-mailů změnit smí (jediný sloupec, který aplikace mění z klienta).
-- * Profil přihlášený nezaloží ani nesmaže.
-- * Útočník, kterému se profil podaří přepsat na cizí adresu (tady
--   přímým zápisem jako vlastník — přesně to, co šlo před opravou
--   veřejným klíčem), cizí pozvánku NEVIDÍ a nepřijme ji ani podle id,
--   ani tokenem přes `public.accept_invitation` — obal, který volá
--   aplikace (`supabase.rpc('accept_invitation')`).
-- * Pozvaný s ověřenou adresou ji vidí a přijme týmž obalem — šťastná
--   cesta beze změny.
-- * Neověřená adresa pozvánku nevidí a nepřijme, i když v profilu
--   sedí. Po ověření ji uvidí — jinak by ta kontrola nic nedokazovala.
-- * Totéž pro telefon, včetně tvaru, v jakém ho ukládá Supabase (bez +):
--   neověřené číslo SMS pozvánku nevidí ani nepřijme.
-- * Adresa v účtu s velkými písmeny (`Velka56@Foodtab.cz`) sedí na
--   pozvánku, která je vždycky malými (`create_invitation`).
--
-- „Spadne na právech“ znamená chybu GRANTU (`permission denied…`), ne
-- jakoukoli 42501: stejný kód hlásí i RLS („new row violates row-level
-- security policy“). Kdyby se vrátil grant insert, zastavila by zápis
-- jen politika — a kontrola, která bere každou 42501, by to nepoznala.
--
-- ---------------------------------------------------------------------
-- CO KDE PLATÍ
--
-- Proti PostgreSQL 16 (workflow Databáze) se pod `set role
-- authenticated` vynucují tabulkové i sloupcové granty a RLS.
--
-- PGlite: scripts/scenare-pglite.mjs i skill `scenar` píšou, že
-- sloupcové granty se tam neprojeví. Pro PGlite 0.5.8 to NEPLATÍ —
-- změřeno 24. 9. 2026: po `set role authenticated` spadl update sloupce
-- bez grantu na 42501 a RLS vrátila nula řádků. Kdyby to příští verze
-- přestala dělat, drží sloupce oddíl 1: katalog (`has_column_privilege`)
-- odpovídá stejně, ať dotaz pouští kdokoli.

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

-- Jen chyba grantu. RLS vrací tentýž 42501 s jinou větou (hlavička).
-- Věta je anglicky — PGlite i postgres:16 ve workflow hlásí bez
-- překladu. Na serveru s českými hláškami by to spadlo nahlas, ne tiše.
create or replace function pg_temp.spadne_pravem(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return sqlerrm like 'permission denied%';
end $$;

-- PGlite pouští všechny scénáře v jednom sezení a `reset role`
-- nevyprázdní `test.user_id` — bez tohohle by se příprava dělala pod
-- cizím `auth.uid()`.
reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Útočník nemá členství v žádné firmě — stačí mu účet. Pozvaný zatím
-- účet NEMÁ: přesně na tohle okno díra mířila (pozvánka odešla, člověk
-- se ještě nepřihlásil).
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('56560000-0000-4000-8000-000000000001', 'utocnik56@foodtab.cz', now(),
   '{"full_name":"Útočník Padesátšest"}');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select invitation_id as inv, token as tok from app.create_invitation(
  :'tenant', null, 'email', 'pozvany56@foodtab.cz', 'branch', array[:'perla']::uuid[]) \gset

select invitation_id as inv_neovereny, token as tok_neovereny from app.create_invitation(
  :'tenant', null, 'email', 'neovereny56@foodtab.cz', 'branch', array[:'perla']::uuid[]) \gset

select invitation_id as inv_velka, token as tok_velka from app.create_invitation(
  :'tenant', null, 'email', 'velka56@foodtab.cz', 'branch', array[:'perla']::uuid[]) \gset

-- Bez zaměstnance: přes SMS jde jen pozvánka, která nic citlivého neotevře.
select invitation_id as inv_sms from app.create_invitation(
  :'tenant', null, 'sms', '+420601565656', 'branch', array[:'perla']::uuid[]) \gset

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Katalog — co smí přihlášený na profilu měnit =========='

select pg_temp.check('přihlášený smí na profilu měnit JEN upozorneni_emailem',
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE'))
  = array['upozorneni_emailem']);

select pg_temp.check('e-mail ani telefon v profilu přihlášený nezmění',
  not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE'));

select pg_temp.check('profil přihlášený nezaloží ani nesmaže',
  not has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE'));

-- Čtení se nemění — jména kolegů u směn a zpráv na něm stojí.
select pg_temp.check('číst profil přihlášený dál smí',
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'));

select pg_temp.check('ověřené kontakty účtu nevolá přihlášený ani anon napřímo',
  not has_function_privilege('authenticated', 'app.moje_overene_kontakty()', 'execute')
  and not has_function_privilege('anon', 'app.moje_overene_kontakty()', 'execute'));


\echo ''
\echo '== 2. Vlastní profil pod rolí authenticated ================='

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000001', false);

-- Řádek útočník vidí a politika ho k němu pustí — zastavit ho musí
-- grant, ne to, že by na řádek nedosáhl.
select pg_temp.check('útočník svůj profil vidí (jinak by další kontroly nic nedokazovaly)',
  (select count(*) from public.profiles where user_id = auth.uid()) = 1);

select pg_temp.check('přepsat si e-mail v profilu spadne na právech (42501)',
  pg_temp.spadne_pravem(
    $q$update public.profiles set email = 'pozvany56@foodtab.cz' where user_id = auth.uid()$q$));

select pg_temp.check('přepsat si telefon v profilu spadne na právech (42501)',
  pg_temp.spadne_pravem(
    $q$update public.profiles set phone = '+420601565656' where user_id = auth.uid()$q$));

select pg_temp.check('založit si druhý profil spadne na právech',
  pg_temp.spadne_pravem(
    $q$insert into public.profiles (user_id, email) values (gen_random_uuid(), 'pozvany56@foodtab.cz')$q$));

select pg_temp.check('smazat si profil spadne na právech',
  pg_temp.spadne_pravem(
    $q$delete from public.profiles where user_id = auth.uid()$q$));

-- Tohle aplikace dělá (Moje údaje → e-maily s upozorněním) a musí to jít dál.
update public.profiles set upozorneni_emailem = false where user_id = auth.uid();

reset role;
select pg_temp.check('volba e-mailů se uložila a e-mail v profilu zůstal',
  (select not upozorneni_emailem and email = 'utocnik56@foodtab.cz'
     from public.profiles where user_id = '56560000-0000-4000-8000-000000000001'));


\echo ''
\echo '== 3. Přepsaný profil cizí pozvánku neotevře ================'

/*
  Stav, který šel před opravou vyrobit jedním `update` z prohlížeče.
  Tady ho vyrábí vlastník přímo — hlídá se, že ani když se profil
  přepsat podaří, pozvánku to nedá.
*/
update public.profiles
   set email = 'pozvany56@foodtab.cz', phone = '+420601565656'
 where user_id = '56560000-0000-4000-8000-000000000001';

select pg_temp.check('profil útočníka nese adresu i číslo z pozvánek (jinak by oddíl nic neměřil)',
  (select email = 'pozvany56@foodtab.cz' and phone = '+420601565656'
     from public.profiles where user_id = '56560000-0000-4000-8000-000000000001'));

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000001', false);

select pg_temp.check('útočník s přepsaným profilem cizí pozvánku v „čeká na mě“ nevidí',
  not exists (select 1 from public.moje_cekajici_pozvanky() where invitation_id = :'inv'));

select pg_temp.check('ani tu na telefon',
  not exists (select 1 from public.moje_cekajici_pozvanky() where invitation_id = :'inv_sms'));

select pg_temp.check('přijmout ji podle id nejde — „na jinou adresu“',
  pg_temp.spadne_hlaskou(format(
    $q$select public.prijmout_moji_pozvanku(%L)$q$, :'inv'),
    '42501', 'jinou e-mailovou adresu'));

-- `public.accept_invitation` volá aplikace (app/pozvanka/[token]/akce.ts);
-- `app.accept_invitation` pod ním pouští přihlášený taky napřímo, ale
-- rozhoduje v obou případech totéž `app.prijmout_pozvanku`.
select pg_temp.check('ani tokenem přes public.accept_invitation, kdyby se k němu dostal',
  pg_temp.spadne_hlaskou(format(
    $q$select public.accept_invitation(%L)$q$, :'tok'),
    '42501', 'jinou e-mailovou adresu'));

select pg_temp.check('ani tu na telefon — „jiné telefonní číslo“',
  pg_temp.spadne_hlaskou(format(
    $q$select public.prijmout_moji_pozvanku(%L)$q$, :'inv_sms'),
    '42501', 'jiné telefonní číslo'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('útočník se do firmy nedostal a pozvánky zůstaly nepoužité',
  not exists (select 1 from public.memberships
              where tenant_id = :'tenant'
                and user_id = '56560000-0000-4000-8000-000000000001')
  and (select count(*) from public.invitations
        where id in (:'inv', :'inv_sms') and accepted_at is null) = 2);

-- Adresa i číslo se vrací, jinak by na unikátu spadl pozvaný.
update public.profiles
   set email = 'utocnik56@foodtab.cz', phone = null
 where user_id = '56560000-0000-4000-8000-000000000001';


\echo ''
\echo '== 4. Pozvaný s ověřenou adresou — beze změny ==============='

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('56560000-0000-4000-8000-000000000002', 'pozvany56@foodtab.cz', now(),
   '{"full_name":"Pozvaný Padesátšest"}');

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000002', false);

select pg_temp.check('pozvaný svou pozvánku vidí, i s názvem firmy',
  exists (select 1 from public.moje_cekajici_pozvanky()
          where invitation_id = :'inv' and firma = 'Foodtab s.r.o.'));

-- Odkazem, tedy tím, co volá aplikace. Přijetí podle id jde oddíl 6.
select public.accept_invitation(:'tok') as prijal \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('pozvaný pozvánku přijal a je ve firmě',
  :'prijal' = :'tenant'
  and exists (select 1 from public.memberships
              where tenant_id = :'tenant'
                and user_id = '56560000-0000-4000-8000-000000000002'
                and status = 'active')
  and (select accepted_by = '56560000-0000-4000-8000-000000000002'
         from public.invitations where id = :'inv'));


\echo ''
\echo '== 5. Neověřená adresa pozvánku nedostane =================='

/*
  Účet vznikl (třeba odkazem, na který nikdo neklikl), profil má
  správnou adresu — a přesto nic. Podle profilu by pozvánku dostal.
*/
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('56560000-0000-4000-8000-000000000003', 'neovereny56@foodtab.cz', null,
   '{"full_name":"Neověřený Padesátšest"}');

select pg_temp.check('profil neověřeného nese adresu z pozvánky (jinak by oddíl nic neměřil)',
  (select email from public.profiles
    where user_id = '56560000-0000-4000-8000-000000000003') = 'neovereny56@foodtab.cz');

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000003', false);

select pg_temp.check('neověřená adresa pozvánku v „čeká na mě“ nevidí',
  not exists (select 1 from public.moje_cekajici_pozvanky()
              where invitation_id = :'inv_neovereny'));

select pg_temp.check('a tokenem ji nepřijme',
  pg_temp.spadne_hlaskou(format(
    $q$select public.accept_invitation(%L)$q$, :'tok_neovereny'),
    '42501', 'jinou e-mailovou adresu'));

reset role;
update auth.users set email_confirmed_at = now()
 where id = '56560000-0000-4000-8000-000000000003';

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000003', false);

select pg_temp.check('po ověření adresy ji vidí — rozhodlo ověření, nic jiného',
  exists (select 1 from public.moje_cekajici_pozvanky()
          where invitation_id = :'inv_neovereny'));

reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 6. Telefon z účtu, i v tvaru bez + ======================='

/*
  Účet s e-mailem, telefon přibude až potom — spoušť `handle_new_user`
  běží jen při založení, takže profil zůstane bez telefonu. Podle
  profilu by se SMS pozvánka nespárovala nikdy; podle účtu ano.

  Supabase Auth ukládá číslo bez „+“. Nejdřív neověřené, pak ověřené.
*/
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('56560000-0000-4000-8000-000000000004', 'telefon56@foodtab.cz', now(),
   '{"full_name":"Telefon Padesátšest"}');

update auth.users set phone = '420601565656', phone_confirmed_at = null
 where id = '56560000-0000-4000-8000-000000000004';

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000004', false);

select pg_temp.check('neověřené číslo SMS pozvánku nevidí',
  not exists (select 1 from public.moje_cekajici_pozvanky() where invitation_id = :'inv_sms'));

-- Nevidět nestačí — id se dá získat i jinudy (třeba z odkazu v SMS).
select pg_temp.check('a podle id ji nepřijme — „jiné telefonní číslo“',
  pg_temp.spadne_hlaskou(format(
    $q$select public.prijmout_moji_pozvanku(%L)$q$, :'inv_sms'),
    '42501', 'jiné telefonní číslo'));

reset role;
select pg_temp.check('neověřené číslo pozvánku nepoužilo',
  (select accepted_at is null from public.invitations where id = :'inv_sms'));
update auth.users set phone_confirmed_at = now()
 where id = '56560000-0000-4000-8000-000000000004';

select pg_temp.check('profil telefon nemá — spárovat to jde jen podle účtu',
  (select phone is null from public.profiles
    where user_id = '56560000-0000-4000-8000-000000000004'));

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000004', false);

select pg_temp.check('ověřené číslo bez + SMS pozvánku vidí',
  exists (select 1 from public.moje_cekajici_pozvanky() where invitation_id = :'inv_sms'));

select public.prijmout_moji_pozvanku(:'inv_sms') as prijal_sms \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('a přijal ji',
  :'prijal_sms' = :'tenant'
  and exists (select 1 from public.memberships
              where tenant_id = :'tenant'
                and user_id = '56560000-0000-4000-8000-000000000004'
                and status = 'active'));


\echo ''
\echo '== 7. Adresa v účtu s velkými písmeny ======================'

/*
  Pozvánka je vždycky malými (`create_invitation` dělá `lower`). Účet
  v Supabase může mít adresu tak, jak ji kdo napsal. Bez `lower`
  v `app.moje_overene_kontakty` by se takový člověk ke své pozvánce
  nedostal — a ostatní oddíly by to nepoznaly, všechny adresy v nich
  jsou malými.
*/
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('56560000-0000-4000-8000-000000000005', 'Velka56@Foodtab.cz', now(),
   '{"full_name":"Velká Padesátšest"}');

select pg_temp.check('účet má adresu velkými a pozvánka malými (jinak by oddíl nic neměřil)',
  (select email = 'Velka56@Foodtab.cz' from auth.users
    where id = '56560000-0000-4000-8000-000000000005')
  and (select email = 'velka56@foodtab.cz' from public.invitations where id = :'inv_velka'));

set role authenticated;
select set_config('test.user_id', '56560000-0000-4000-8000-000000000005', false);

select pg_temp.check('ověřený účet s adresou velkými svou pozvánku vidí',
  exists (select 1 from public.moje_cekajici_pozvanky() where invitation_id = :'inv_velka'));

select public.accept_invitation(:'tok_velka') as prijal_velka \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('a odkazem ji přijal',
  :'prijal_velka' = :'tenant'
  and exists (select 1 from public.memberships
              where tenant_id = :'tenant'
                and user_id = '56560000-0000-4000-8000-000000000005'
                and status = 'active'));

\echo ''
\echo '== KROK 56 HOTOV ========================================'
