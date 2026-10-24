-- =====================================================================
-- Krok 101 — Kiosek Jiných plateb: drobnosti po nasazení
-- (migrace 20261024100000_jine_platby_kiosek_drobnosti)
--
-- Kontroluje se:
--   1. jedinečný název aktivního telefonu na doklady na pobočce hlídá
--      DATABÁZE (index) — i mimo registraci (souběh, přejmenování);
--      tablety Docházky a odvolané telefony se nehlídají;
--   2. přehled telefonu: zrušený doklad ukazuje fotky, které telefon
--      poslal (zrušení je deaktivuje), ne „0 fotek“;
--   3. úklid nepřipojených souborů: výběr sirotků jen bez vlastníka,
--      pod záznamem z kiosku, starší než 3 h (soubor i záznam), bez řádku
--      v jine_platby_soubory; strop dávky; úklid starých náhrobků;
--      granty jen service_role; úloha v plánu.
-- Běží proti PostgreSQL (supabase/tests/run.sh) i v PGlite.
-- =====================================================================
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

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end $$;

reset role;
select set_config('test.user_id', '', false);
\echo ''
\echo '== KROK 101: kiosek Jiných plateb — drobnosti ======================'

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

insert into public.branches (tenant_id, name, slug, active) values (:'tenant', 'Krok101 Kiosek', 'krok101-kiosek', true)
returning id as pob \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select kod as kod_p from public.vytvorit_registracni_kod(:'tenant', :'pob', 'Krok101 telefon bar') \gset
select kod as kod_q from public.vytvorit_registracni_kod(:'tenant', :'pob', 'Krok101 telefon terasa') \gset
reset role;
select set_config('test.user_id', '', false);
set role anon;
select device_id as zar_p, klic as klic_p from public.registrovat_zarizeni_doklady(:'kod_p') \gset
select device_id as zar_q, klic as klic_q from public.registrovat_zarizeni_doklady(:'kod_q') \gset
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_p', true);
reset role;

\echo ''
\echo '-- 1. Jedinečný název telefonu hlídá databáze --'
select pg_temp.check('index: aktivní telefony na doklady, jedinečně podle firmy, pobočky a názvu bez ohledu na velikost a mezery',
  exists (select 1 from pg_indexes
           where schemaname = 'public' and indexname = 'branch_devices_telefon_nazev'
             and indexdef ilike '%unique%' and indexdef ilike '%lower(btrim(nazev))%'
             and indexdef ilike '%stav = ''active''%' and indexdef ilike '%ucel = ''doklady''%'));
-- Mimo registraci (souběh dvou spárování, zápis bokem): databáze odmítne.
select pg_temp.check('druhý aktivní telefon téže pobočky se stejným názvem neprojde ani přímým zápisem (jiná velikost písmen a mezery)',
  pg_temp.spadne_hlaskou(format('insert into public.branch_devices (tenant_id, branch_id, nazev, key_hash, ucel) values (%L, %L, %L, %L, %L)',
    :'tenant', :'pob', '  KROK101 telefon BAR ', encode(sha256('krok101-dup'::bytea), 'hex'), 'doklady'), '23505', 'branch_devices_telefon_nazev'));
select pg_temp.check('… ani přejmenováním jiného telefonu na stejný název',
  pg_temp.spadne_hlaskou(format('update public.branch_devices set nazev = %L where id = %L', 'krok101 telefon bar', :'zar_q'), '23505', 'branch_devices_telefon_nazev'));
select pg_temp.check('tablet Docházky se stejným názvem projde (tablety se nehlídají — opětovné spárování bez odvolání)',
  pg_temp.projde(format('insert into public.branch_devices (tenant_id, branch_id, nazev, key_hash, ucel) values (%L, %L, %L, %L, %L)',
    :'tenant', :'pob', 'Krok101 telefon bar', encode(sha256('krok101-tablet'::bytea), 'hex'), 'dochazka')));
select pg_temp.check('odvolaný telefon se stejným názvem projde (index jen pro aktivní)',
  pg_temp.projde(format('insert into public.branch_devices (tenant_id, branch_id, nazev, key_hash, ucel, stav, revoked_at) values (%L, %L, %L, %L, %L, %L, now())',
    :'tenant', :'pob', 'Krok101 telefon bar', encode(sha256('krok101-odvolany'::bytea), 'hex'), 'doklady', 'revoked')));

\echo ''
\echo '-- 2. Přehled: zrušený doklad nemá „0 fotek“ --'
set role service_role;
select public.jine_platby_kiosek_zalozit(:'klic_p', 'stůl 3', '10110000-aaaa-0000-0000-000000000001', 1) ->> 'zaznam' as z_zrus \gset
select public.jine_platby_kiosek_zalozit(:'klic_p', 'výpadek', '10110000-aaaa-0000-0000-000000000002', 1) ->> 'zaznam' as z_prazdny \gset
reset role;
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_zrus', '10110000-bbbb-0000-0000-000000000001') as cesta_zrus \gset
insert into storage.objects (bucket_id, name, owner, metadata) values ('jine-platby', :'cesta_zrus', null, '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select public.jine_platby_kiosek_pripojit_soubor(:'klic_p', :'z_zrus', :'cesta_zrus', repeat('d1', 32));
reset role;
-- Zrušení ve Financích (jako jine_platby_zrusit): fotky se deaktivují.
update public.jine_platby_soubory set aktivni = false where zaznam_id = :'z_zrus';
update public.jine_platby set stav_kontroly = 'zruseno', zruseni_duvod = 'omyl' where id = :'z_zrus';
set role service_role;
select public.jine_platby_kiosek_dnes(:'klic_p')::text as dnes \gset
reset role;
select pg_temp.check('zrušený doklad: stav „zruseno“ a fotky, které telefon poslal (1) — ne 0',
  exists (select 1 from jsonb_array_elements((:'dnes')::jsonb) e
           where e ->> 'oznaceni' = 'stůl 3' and e ->> 'stav' = 'zruseno' and (e ->> 'fotek')::int = 1));
select pg_temp.check('… doklad, ke kterému nic nedošlo, má 0 fotek a stav „bez_fotky“ (telefon napíše, že fotka neodešla)',
  exists (select 1 from jsonb_array_elements((:'dnes')::jsonb) e
           where e ->> 'oznaceni' = 'výpadek' and e ->> 'stav' = 'bez_fotky' and (e ->> 'fotek')::int = 0));
update public.jine_platby set stav_kontroly = 'rozpracovano', zruseni_duvod = null where id = :'z_zrus';
set role service_role;
select pg_temp.check('… nezrušený doklad s odebranou (neaktivní) fotkou ji dál nepočítá',
  exists (select 1 from jsonb_array_elements(public.jine_platby_kiosek_dnes(:'klic_p')) e
           where e ->> 'oznaceni' = 'stůl 3' and (e ->> 'fotek')::int = 0));
reset role;

\echo ''
\echo '-- 3. Úklid nepřipojených souborů z kiosku --'
select pg_temp.check('výběr sirotků smí jen service_role (anon ani přihlášený ne), SECURITY DEFINER se search_path=""',
  (select has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'jine_platby_kiosek_sirotci'));
select pg_temp.check('úloha kiosek-uklid je v plánu úloh (jednou denně, limit 90 s)',
  exists (select 1 from app.planovac_ulohy where uloha = 'kiosek-uklid' and plan_utc = '35 3 * * *' and limit_sekund = 90));

set role service_role;
select public.jine_platby_kiosek_zalozit(:'klic_p', 'starý', '10110000-aaaa-0000-0000-000000000003', 1) ->> 'zaznam' as z_stary \gset
select public.jine_platby_kiosek_zalozit(:'klic_p', 'čerstvý', '10110000-aaaa-0000-0000-000000000004', 1) ->> 'zaznam' as z_novy \gset
select public.jine_platby_kiosek_zalozit(:'klic_p', 'z Financí', '10110000-aaaa-0000-0000-000000000005', 1) ->> 'zaznam' as z_finance \gset
reset role;
update public.jine_platby set vytvoreno = now() - interval '4 hours' where id in (:'z_stary', :'z_finance');
update public.jine_platby set zdroj = 'aplikace' where id = :'z_finance';

select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-cccc-0000-0000-000000000001') as s_sirotek \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-cccc-0000-0000-000000000002') as s_sirotek2 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-cccc-0000-0000-000000000003') as s_mlady \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-cccc-0000-0000-000000000004') as s_vlastnik \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-cccc-0000-0000-000000000005') as s_pripojeny \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_finance', '10110000-cccc-0000-0000-000000000006') as s_finance \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_novy', '10110000-cccc-0000-0000-000000000007') as s_novy_zaznam \gset
select format('%s/%s/%s.jpg', :'tenant', :'pob', '10110000-cccc-0000-0000-000000000008') as s_divna_cesta \gset
insert into storage.objects (bucket_id, name, owner, metadata, created_at) values
  ('jine-platby', :'s_sirotek', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours'),
  ('jine-platby', :'s_sirotek2', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '3 hours 30 minutes'),
  ('jine-platby', :'s_mlady', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '1 hour'),
  ('jine-platby', :'s_vlastnik', :'majitel', '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours'),
  ('jine-platby', :'s_pripojeny', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours'),
  ('jine-platby', :'s_finance', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours'),
  ('jine-platby', :'s_novy_zaznam', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours'),
  ('jine-platby', :'s_divna_cesta', null, '{"mimetype":"image/jpeg","size":2000}', now() - interval '4 hours');
insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk, nahral, zarizeni_id)
values (:'tenant', :'pob', :'z_stary', 1, :'s_pripojeny', 'image/jpeg', 2000, repeat('d2', 32), null, :'zar_p');

-- Náhrobky: starý bez souboru zmizí, starý se souborem a čerstvý bez souboru zůstanou.
insert into public.jine_platby_kiosek_uklid (cesta, tenant_id, zaznam_id, vytvoreno) values
  (format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-dddd-0000-0000-000000000001'), :'tenant', :'z_stary', now() - interval '2 days'),
  (:'s_sirotek2', :'tenant', :'z_stary', now() - interval '2 days'),
  (format('%s/%s/%s/%s.jpg', :'tenant', :'pob', :'z_stary', '10110000-dddd-0000-0000-000000000002'), :'tenant', :'z_stary', now() - interval '1 hour');

set role service_role;
select coalesce(string_agg(c, ',' order by c), '') as sirotci from public.jine_platby_kiosek_sirotci(500) c \gset
select count(*) as jeden from public.jine_platby_kiosek_sirotci(1) \gset
reset role;
select pg_temp.check('sirotek = soubor bez vlastníka pod záznamem z kiosku, soubor i záznam starší než 3 h a bez řádku v jine_platby_soubory',
  position(:'s_sirotek' in :'sirotci') > 0 and position(:'s_sirotek2' in :'sirotci') > 0);
select pg_temp.check('… a NIC jiného: mladý soubor, soubor s vlastníkem, připojený soubor, soubor pod záznamem Financí, pod čerstvým záznamem ani nesmyslná cesta',
  :'sirotci' = (select string_agg(c, ',' order by c) from unnest(array[:'s_sirotek', :'s_sirotek2']) c));
select pg_temp.check('strop dávky platí (p_limit 1 → 1)', :'jeden'::int = 1);
select pg_temp.check('starý náhrobek bez souboru zmizel, starý se souborem a čerstvý zůstaly',
  not exists (select 1 from public.jine_platby_kiosek_uklid where cesta like '%10110000-dddd-0000-0000-000000000001%')
  and exists (select 1 from public.jine_platby_kiosek_uklid where cesta = :'s_sirotek2')
  and exists (select 1 from public.jine_platby_kiosek_uklid where cesta like '%10110000-dddd-0000-0000-000000000002%'));
set role anon;
select pg_temp.check('anon výběr sirotků nezavolá',
  not pg_temp.projde('select * from public.jine_platby_kiosek_sirotci(10)'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('… ani přihlášený (ani majitel)',
  not pg_temp.projde('select * from public.jine_platby_kiosek_sirotci(10)'));
reset role;

-- Úklid.
delete from public.jine_platby_kiosek_uklid where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_p', :'zar_q'));
delete from public.jine_platby_historie where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_p', :'zar_q'));
delete from public.jine_platby_soubory where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_p', :'zar_q'));
delete from public.jine_platby where zarizeni_id in (:'zar_p', :'zar_q');
delete from storage.objects where bucket_id = 'jine-platby' and name like :'tenant' || '/' || :'pob' || '/%';
delete from public.jine_platby_kiosky where zarizeni_id in (:'zar_p', :'zar_q');
delete from public.device_registrations where device_id in (select id from public.branch_devices where branch_id = :'pob');
delete from public.branch_devices where branch_id = :'pob';
update public.branches set deleted_at = now(), active = false where id = :'pob';

\echo ''
\echo '== KROK 101 HOTOV =============================================='
