-- Scénář pro krok 12 — dozvědět se, že někdo přijal pozvánku.
--
-- Pokrývá migraci 20260902070000_upozorneni_na_prijeti a sedm kontrol
-- z oddílu 6 zadání docs/upozorneni-na-prijeti-zadani.md.
--
-- Navazuje na etapa0_scenar.sql až krok11_scenar.sql.
--
-- Kontroly míří na to, co NEMÁ jít: že se upozornění nedostane k tomu,
-- kdo lidi nespravuje, ani do cizí firmy, a že se přijetí pozvánky
-- nepokazí, ani když založení upozornění spadne.

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
-- Tři účty navíc: dva pozvaní (jeden s rolí, jeden bez) a jeden, který
-- ve firmě je, ale lidi nespravuje.
-- =====================================================================

-- Podle jména, ne `limit 1`. Od krok11 jsou v databázi dvě firmy
-- a bez řazení si Postgres vybere, kterou chce — scénář pak padal
-- na tom, že „majitel nespravuje lidi“ v cizí firmě.
select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

select id as role_kuchyne from public.roles
  where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1', 'sbezrole@foodtab.cz',
   '{"full_name":"Bez Role Zkouška"}'),
  ('a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2', 'srolí@foodtab.cz',
   '{"full_name":"S Rolí Zkouška"}'),
  ('a3a3a3a3-a3a3-4a3a-a3a3-a3a3a3a3a3a3', 'padavka@foodtab.cz',
   '{"full_name":"Padavka Zkouška"}')
on conflict (id) do nothing;

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== Kdo ve firmě spravuje lidi ============================'

select pg_temp.check('majitel lidi spravuje',
  exists (select 1 from app.kdo_ma_pravo(:'tenant', 'people.manage')
          where user_id = :'majitel'));

select pg_temp.check('vedoucí směny lidi NESPRAVUJE',
  not exists (select 1 from app.kdo_ma_pravo(:'tenant', 'people.manage')
              where user_id = :'vedouci'));


\echo ''
\echo '== 1.+2. Přijetí BEZ oprávnění ==========================='

-- Pozvánka bez role: člověk se do firmy dostane, ale nic neuvidí.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select token as tok_bez from app.create_invitation(
  :'tenant', null, 'email', 'sbezrole@foodtab.cz', 'branch', array[:'perla']::uuid[]) \gset

select set_config('test.user_id', 'a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1', false);
select app.accept_invitation(:'tok_bez') as prijal_bez \gset

select pg_temp.check('pozvánka bez role prošla', :'prijal_bez' = :'tenant');

reset role;

select pg_temp.check('majitel dostal upozornění',
  exists (select 1 from public.notifications
          where user_id = :'majitel' and druh = 'pozvanka.prijata'
            and telo ->> 'jmeno' = 'Bez Role Zkouška'));

select pg_temp.check('a je v něm, že ČEKÁ na oprávnění',
  (select telo ->> 'ceka' from public.notifications
   where user_id = :'majitel' and druh = 'pozvanka.prijata'
     and telo ->> 'jmeno' = 'Bez Role Zkouška') = 'true');

select pg_temp.check('a kdo přijal, ať vede tlačítko rovnou k němu',
  (select telo ->> 'kdo' from public.notifications
   where user_id = :'majitel' and druh = 'pozvanka.prijata'
     and telo ->> 'jmeno' = 'Bez Role Zkouška')
  = 'a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1');

-- A tohle je ta mez: kdo lidi nespravuje, upozornění nedostane.
select pg_temp.check('vedoucí směny upozornění NEDOSTAL',
  not exists (select 1 from public.notifications
              where user_id = :'vedouci' and druh = 'pozvanka.prijata'));


\echo ''
\echo '== 2. Přijetí S oprávněním má jiný text =================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select token as tok_s from app.create_invitation(
  :'tenant', :'role_kuchyne', 'email', 'srolí@foodtab.cz',
  'branch', array[:'perla']::uuid[]) \gset

select set_config('test.user_id', 'a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2', false);
select app.accept_invitation(:'tok_s') as prijal_s \gset
reset role;

select pg_temp.check('upozornění dorazilo',
  exists (select 1 from public.notifications
          where user_id = :'majitel' and druh = 'pozvanka.prijata'
            and telo ->> 'jmeno' = 'S Rolí Zkouška'));

select pg_temp.check('a NEČEKÁ na oprávnění — jiná situace, jiný text',
  (select telo ->> 'ceka' from public.notifications
   where user_id = :'majitel' and druh = 'pozvanka.prijata'
     and telo ->> 'jmeno' = 'S Rolí Zkouška') = 'false');

select pg_temp.check('a je v něm, co za oprávnění dostal',
  (select telo ->> 'role' from public.notifications
   where user_id = :'majitel' and druh = 'pozvanka.prijata'
     and telo ->> 'jmeno' = 'S Rolí Zkouška') is not null);


\echo ''
\echo '== 3. Cizí firma se o ničem nedozví ======================'

select id as tenant2 from public.tenants
  where id <> :'tenant' order by created_at limit 1 \gset

select pg_temp.check('v cizí firmě žádné upozornění o přijetí není',
  not exists (select 1 from public.notifications
              where tenant_id = :'tenant2' and druh = 'pozvanka.prijata'));

select pg_temp.check('a naše upozornění patří jen naší firmě',
  (select count(distinct tenant_id) from public.notifications
   where druh = 'pozvanka.prijata') = 1);


\echo ''
\echo '== 4.+5. Okno jen tehdy, když je co dělat ================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('bez role čeká přesně jeden člověk',
  (select count(*) from public.cekaji_na_opravneni(:'tenant')) = 1);

select pg_temp.check('a je to ten, kdo roli nedostal',
  (select user_id from public.cekaji_na_opravneni(:'tenant'))
  = 'a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1');

select pg_temp.check('kdo roli dostal, mezi čekajícími není',
  not exists (select 1 from public.cekaji_na_opravneni(:'tenant')
              where user_id = 'a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2'));

-- Kdo lidi nespravuje, nedostane ani seznam.
select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('vedoucí směny seznam čekajících nedostane',
  (select count(*) from public.cekaji_na_opravneni(:'tenant')) = 0);

-- Přidělení role: okno se přestane ukazovat samo, nic se neodškrtává.
reset role;
update public.memberships set role_id = :'role_kuchyne'
  where tenant_id = :'tenant'
    and user_id = 'a1a1a1a1-a1a1-4a1a-a1a1-a1a1a1a1a1a1';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('po přidělení oprávnění nečeká nikdo',
  (select count(*) from public.cekaji_na_opravneni(:'tenant')) = 0);

reset role;


\echo ''
\echo '== 6. Cizí upozornění se nepřečte ========================'

set role authenticated;
select set_config('test.user_id', 'a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2', false);

select pg_temp.check('pozvaný cizí upozornění nevidí',
  (select count(*) from public.notifications
   where user_id = :'majitel') = 0);

reset role;
select pg_temp.check('a přitom je majitel opravdu má — jinak by kontrola výš byla prázdná',
  (select count(*) from public.notifications where user_id = :'majitel') > 0);


\echo ''
\echo '== Volba e-mailů u člověka ==============================='

/*
  Zvoneček se vypnout nedá — je to záznam. E-mail ano, a je to
  nastavení U ČLOVĚKA, ne konstanta (zadání, oddíl 4).
*/
select pg_temp.check('výchozí je, že e-maily chodí',
  (select upozorneni_emailem from public.profiles where user_id = :'majitel'));

reset role;
update public.profiles set upozorneni_emailem = false where user_id = :'majitel';

set role authenticated;
select set_config('test.user_id', 'a2a2a2a2-a2a2-4a2a-a2a2-a2a2a2a2a2a2', false);

select pg_temp.check('kdo si e-maily vypnul, mezi příjemce nepatří',
  not exists (select 1 from public.komu_ohlasit_prijeti(:'tenant')
              where jmeno = 'Vladislav Skoumal'));

reset role;
select pg_temp.check('ale zvoneček mu zůstal — ten se vypnout nedá',
  exists (select 1 from public.notifications
          where user_id = :'majitel' and druh = 'pozvanka.prijata'));

update public.profiles set upozorneni_emailem = true where user_id = :'majitel';


\echo ''
\echo '== 7. Přijetí nespadne, ani když upozornění selže ========'

/*
  Nejtvrdší z těch sedmi. `app.upozorni_na_prijeti` se dočasně vymění
  za funkci, která vždycky spadne — a členství musí vzniknout přesto.
  Bez téhle výměny by se ta ochrana neověřila vůbec: za normálního
  běhu se ta větev nikdy nespustí.
*/
create or replace function app.upozorni_na_prijeti(p_tenant uuid, p_kdo uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  raise exception 'zkouška: pošta je rozbitá';
end;
$$;

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select token as tok_pad from app.create_invitation(
  :'tenant', :'role_kuchyne', 'email', 'padavka@foodtab.cz',
  'branch', array[:'perla']::uuid[]) \gset

select set_config('test.user_id', 'a3a3a3a3-a3a3-4a3a-a3a3-a3a3a3a3a3a3', false);
select app.accept_invitation(:'tok_pad') as prijal_pad \gset
reset role;

select pg_temp.check('přijetí prošlo, i když upozornění spadlo',
  :'prijal_pad' = :'tenant');

select pg_temp.check('a členství opravdu vzniklo',
  exists (select 1 from public.memberships
          where tenant_id = :'tenant'
            and user_id = 'a3a3a3a3-a3a3-4a3a-a3a3-a3a3a3a3a3a3'
            and status = 'active'));

select pg_temp.check('upozornění o něm ale nevzniklo — funkce spadla',
  not exists (select 1 from public.notifications
              where druh = 'pozvanka.prijata'
                and telo ->> 'jmeno' = 'Padavka Zkouška'));


\echo ''
\echo '== KROK 12 HOTOV ========================================='
