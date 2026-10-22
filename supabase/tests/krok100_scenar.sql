-- =====================================================================
-- Krok 100 — Kiosek Jiných plateb na telefonu pobočky
-- (zadání Šéfíka 22. 10. 2026; migrace 20261022100000_jine_platby_kiosek)
--
-- Telefon je zařízení pobočky (branch_devices, spárované kódem jako
-- tablet Docházky), bez přihlášeného člověka a bez PINu. Kontroluje se:
--   1. granty: funkce kiosku jen pro service_role, zapínání jen pro
--      přihlášené, tabulka kiosků bez zápisu;
--   2. zapnutí kiosku: jen správce nastavení pobočky, ne cizí firma,
--      ne odvolané zařízení, ne firma bez Financí;
--   3. stav: jen pobočka a název; zařízení bez zapnutého kiosku
--      a vymyšlený klíč nic nedostanou;
--   4. založení: na pobočce zařízení, autorem zařízení (vytvoril
--      prázdné), opakované odeslání = týž záznam, pokladna jen když je
--      jediná;
--   5. strop odeslání za hodinu a za 24 hodin;
--   6. připojení fotky: jen záznam téhož zařízení, do dvou hodin,
--      rozpracovaný, soubor bez vlastníka, stejná fotka podruhé ne;
--   7. odvolání zařízení a vypnutí kiosku platí hned; neaktivní pobočka
--      a firma bez Financí nic nepošlou.
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
\echo '== KROK 100: kiosek Jiných plateb ================================'

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;

-- Vlastní pobočky scénáře: A s jedinou pokladnou, B bez pokladny (na CI
-- ostatní kroky nechávají pokladny Perly — počet tam nejde předpovědět).
insert into public.branches (tenant_id, name, slug, active) values (:'tenant', 'Krok100 Kiosek A', 'krok100-kiosek-a', true)
returning id as pob_a \gset
insert into public.branches (tenant_id, name, slug, active) values (:'tenant', 'Krok100 Kiosek B', 'krok100-kiosek-b', true)
returning id as pob_b \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, stav, externi_ucet)
values (:'tenant', :'pob_a', 'pokladna', 'krok100pos', 'zakaznicky', 'pripojeno', '{}'::jsonb)
returning id as pos_a \gset

-- Cizí firma bez Financí.
insert into auth.users (id, email, raw_user_meta_data) values
  ('10010000-0000-0000-0000-000000000005', 'yvona100@jinafirma.cz', '{"full_name":"Yvona Stá"}');
set role authenticated;
select set_config('test.user_id', '10010000-0000-0000-0000-000000000005', false);
select app.create_tenant('Krok100 Cizí s.r.o.', 'Yvona Stá') as tenant_b \gset
reset role;
insert into public.branches (tenant_id, name, slug, active) values (:'tenant_b', 'Krok100 cizí pobočka', 'krok100-cizi', true)
returning id as pob_cizi \gset

-- Zařízení: majitel vystaví kódy, telefon (anon) se spáruje.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select kod as kod_a  from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 telefon A') \gset
select kod as kod_a2 from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 telefon strop') \gset
select kod as kod_b  from public.vytvorit_registracni_kod(:'tenant', :'pob_b', 'Krok100 telefon B') \gset
select kod as kod_t  from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 tablet Docházky') \gset
select set_config('test.user_id', '10010000-0000-0000-0000-000000000005', false);
select kod as kod_c  from public.vytvorit_registracni_kod(:'tenant_b', :'pob_cizi', 'Krok100 cizí telefon') \gset
reset role;
select set_config('test.user_id', '', false);
set role anon;
select device_id as zar_a,  klic as klic_a  from public.registrovat_zarizeni(:'kod_a') \gset
select device_id as zar_a2, klic as klic_a2 from public.registrovat_zarizeni(:'kod_a2') \gset
select device_id as zar_b,  klic as klic_b  from public.registrovat_zarizeni(:'kod_b') \gset
select device_id as zar_t,  klic as klic_t  from public.registrovat_zarizeni(:'kod_t') \gset
select device_id as zar_c,  klic as klic_c  from public.registrovat_zarizeni(:'kod_c') \gset
reset role;

\echo ''
\echo '-- 1. Granty --'
select pg_temp.check('funkce kiosku (stav, založení, připojení fotky) jen service_role: anon ani přihlášený ne',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('jine_platby_kiosek_stav', 'jine_platby_kiosek_zalozit', 'jine_platby_kiosek_pripojit_soubor')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and p.proconfig @> array['search_path=""']) = 3);
select pg_temp.check('zapnutí kiosku jen pro přihlášené (anon ne), SECURITY DEFINER se search_path=""',
  (select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
          and p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'jine_platby_kiosek_zapnout'));
select pg_temp.check('pomocné funkce kiosku (zařízení podle klíče, strop) nezavolá anon ani přihlášený',
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in ('jp_kiosek_zarizeni', 'jp_kiosek_strop_hodina', 'jp_kiosek_strop_den')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 3);
select pg_temp.check('tabulka kiosků: přihlášený jen čte (RLS), zapisuje jen funkce; anon nic',
  has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'select')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'insert')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'update')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'delete')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'truncate')
  and not has_table_privilege('anon', 'public.jine_platby_kiosky', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.jine_platby_kiosky'::regclass));

\echo ''
\echo '-- 2. Zapnutí kiosku --'
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_a', true);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_a2', true);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_b', true);
select pg_temp.check('správce nastavení zapne kiosek (opakované zapnutí nevadí)',
  pg_temp.projde(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant', :'zar_a')));
select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('člověk bez správy nastavení kiosek nezapne',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant', :'zar_t'),
    '42501', 'jen správce nastavení pobočky'));
select set_config('test.user_id', '10010000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma zařízení jiné firmy nezapne (zařízení nenajde)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant_b', :'zar_a'),
    'P0002', 'Zařízení nenalezeno'));
select pg_temp.check('firma bez Financí kiosek nezapne',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant_b', :'zar_c'),
    '23514', 'Firma nemá zapnuté Finance'));
reset role;
select pg_temp.check('zapnutí kiosku je v auditu',
  exists (select 1 from public.audit_log where tenant_id = :'tenant' and action = 'jine_platby.kiosek_zapnut' and entity_id = :'zar_a'));

\echo ''
\echo '-- 3. Stav: jen pobočka a název --'
set role service_role;
select public.jine_platby_kiosek_stav(:'klic_a')::text as stav_a \gset
reset role;
select pg_temp.check('stav zapnutého telefonu: pobočka a název zařízení, nic víc',
  (:'stav_a')::jsonb ->> 'pobocka' = 'Krok100 Kiosek A' and (:'stav_a')::jsonb ->> 'zarizeni' = 'Krok100 telefon A'
  and (select count(*) from jsonb_object_keys((:'stav_a')::jsonb)) = 2);
set role service_role;
select pg_temp.check('tablet Docházky bez zapnutého kiosku Jiných plateb nedostane nic',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_stav(%L)', :'klic_t'), '42501', 'není zapnutý kiosek Jiných plateb'));
select pg_temp.check('vymyšlený klíč nedostane nic (stejná hláška jako kiosek Docházky)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_stav(%L)', repeat('ab', 32)), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
reset role;

\echo ''
\echo '-- 4. Založení záznamu --'
set role service_role;
select public.jine_platby_kiosek_zalozit(:'klic_a', '  Stůl 4 — firma Novák  ', '10010000-aaaa-0000-0000-000000000001')::text as zal_a \gset
select public.jine_platby_kiosek_zalozit(:'klic_b', null, '10010000-aaaa-0000-0000-000000000002')::text as zal_b \gset
reset role;
select (:'zal_a')::jsonb ->> 'zaznam' as z_a \gset
select (:'zal_b')::jsonb ->> 'zaznam' as z_b \gset
select pg_temp.check('založení vrátí jen záznam, firmu a pobočku zařízení',
  (select count(*) from jsonb_object_keys((:'zal_a')::jsonb)) = 3
  and (:'zal_a')::jsonb ->> 'tenant' = :'tenant' and (:'zal_a')::jsonb ->> 'branch' = :'pob_a');
select pg_temp.check('záznam z kiosku: pobočka zařízení, autorem zařízení (vytvoril prázdné), označení oříznuté',
  (select branch_id = :'pob_a' and vytvoril is null and zdroj = 'kiosek' and zarizeni_id = :'zar_a'
          and zarizeni_nazev = 'Krok100 telefon A' and oznaceni = 'Stůl 4 — firma Novák' and stav_kontroly = 'rozpracovano'
     from public.jine_platby where id = :'z_a'));
select pg_temp.check('pokladna pobočky se vezme sama, když je jediná; bez pokladny zůstane prázdná',
  (select pripojeni_id = :'pos_a' from public.jine_platby where id = :'z_a')
  and (select pripojeni_id is null from public.jine_platby where id = :'z_b'));
select pg_temp.check('historie: založeno kioskem (bez člověka, s názvem zařízení)',
  exists (select 1 from public.jine_platby_historie
           where zaznam_id = :'z_a' and udalost = 'zalozeno' and kdo is null
             and detail ->> 'zdroj' = 'kiosek' and detail ->> 'zarizeni' = :'zar_a' and detail ->> 'zarizeni_nazev' = 'Krok100 telefon A'));
set role service_role;
select pg_temp.check('opakované odeslání se stejným klíčem = týž záznam',
  (select public.jine_platby_kiosek_zalozit(:'klic_a', 'jinak', '10010000-aaaa-0000-0000-000000000001') ->> 'zaznam') = :'z_a');
select pg_temp.check('klíč odeslání jiného zařízení nový záznam nezaloží ani ten cizí nevrátí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_a2', null, '10010000-aaaa-0000-0000-000000000001'),
    '23514', 'Klíč odeslání už patří jinému záznamu'));
reset role;
select pg_temp.check('poslední použití zařízení se zapsalo',
  (select posledni_kdy is not null from public.branch_devices where id = :'zar_a'));

\echo ''
\echo '-- 5. Strop odeslání --'
select set_config('test.klic_strop', :'klic_a2', false);
set role service_role;
do $$
begin
  for i in 1..20 loop
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid());
  end loop;
end $$;
reset role;
\echo 'strop: 20 odeslání prošlo'
set role service_role;
select pg_temp.check('21. doklad za hodinu z jednoho zařízení neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_a2', null, gen_random_uuid()),
    '23514', 'za poslední hodinu'));
reset role;
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
do $$
begin
  for i in 1..20 loop
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid());
  end loop;
end $$;
reset role;
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
do $$
begin
  for i in 1..20 loop
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid());
  end loop;
end $$;
reset role;
-- Všech 60 posunout mimo poslední hodinu: hodinový strop je volný, denní ne.
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
select pg_temp.check('61. doklad za 24 hodin z jednoho zařízení neprojde (ani mimo hodinový strop)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_a2', null, gen_random_uuid()),
    '23514', 'za posledních 24 hodin'));
select pg_temp.check('strop jednoho zařízení nebrání jinému zařízení (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_b', null, gen_random_uuid())));
reset role;

\echo ''
\echo '-- 6. Připojení fotky --'
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000001') as cesta1 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000002') as cesta_vlastnik \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000003') as cesta_dupl \gset
select format('%s/%s/%s/%s.png', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000004') as cesta_typ \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_b', :'z_b', '10010000-bbbb-0000-0000-000000000005') as cesta_b \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta1', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_vlastnik', :'majitel', '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_dupl', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_typ', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_b', null, '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select pg_temp.check('fotku k záznamu téhož zařízení server připojí',
  pg_temp.projde(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta1', repeat('c1', 32))));
reset role;
select pg_temp.check('soubor z kiosku: nahrál ho kiosek (nahral prázdné), historie bez člověka',
  (select nahral is null and zarizeni_id = :'zar_a' and poradi = 1 from public.jine_platby_soubory where cesta = :'cesta1')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z_a' and udalost = 'soubor_pripojen' and kdo is null and detail ->> 'zdroj' = 'kiosek'));
set role service_role;
select pg_temp.check('soubor nahraný přihlášeným (s vlastníkem) kiosek nepřipojí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_vlastnik', repeat('c2', 32)),
    '23514', 'Soubor nahrál někdo jiný'));
select pg_temp.check('stejná fotka podruhé neprojde a hláška nic neprozradí o cizím záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl', repeat('c1', 32)),
    '23505', 'Tahle fotka už v Jiných platbách je.'));
select pg_temp.check('typ souboru musí sedět s příponou',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_typ', repeat('c4', 32)),
    '23514', 'Nepovolený typ souboru'));
select pg_temp.check('k záznamu jiného zařízení fotku nepřipojí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_b', :'cesta_b', repeat('c5', 32)),
    '42501', 'Záznam z tohohle zařízení není'));
select pg_temp.check('cesta jiného záznamu k tomuhle záznamu nesedí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta1', repeat('c6', 32)),
    '23514', 'Cesta k souboru nesedí'));
reset role;
update public.jine_platby set stav_kontroly = 'zkontrolovano' where id = :'z_b';
set role service_role;
select pg_temp.check('ke zkontrolovanému záznamu kiosek fotku nepřidá',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32)),
    '23514', 'už fotky přidat nejde'));
reset role;
update public.jine_platby set stav_kontroly = 'rozpracovano', vytvoreno = now() - interval '3 hours' where id = :'z_b';
set role service_role;
select pg_temp.check('k záznamu staršímu než dvě hodiny kiosek fotku nepřidá',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32)),
    '23514', 'už fotky přidat nejde'));
reset role;
update public.jine_platby set vytvoreno = now() where id = :'z_b';
set role service_role;
select pg_temp.check('… čerstvý rozpracovaný záznam téhož zařízení fotku přijme (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32))));
reset role;

\echo ''
\echo '-- 7. Odvolání, vypnutí, neaktivní pobočka, firma bez Financí --'
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_b', false);
reset role;
set role service_role;
select pg_temp.check('vypnutý kiosek hned nic nepošle (klíč přitom platí dál)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_b', null, gen_random_uuid()),
    '42501', 'není zapnutý kiosek Jiných plateb'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.branch_devices set stav = 'revoked', revoked_at = now() where id = :'zar_a';
reset role;
set role service_role;
select pg_temp.check('odvolané zařízení hned nic nezaloží',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_a', null, gen_random_uuid()),
    '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani nepřipojí fotku k záznamu, který samo založilo',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl', repeat('c8', 32)),
    '42501', 'Zařízení není registrované nebo bylo odvolané.'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('odvolané zařízení nejde znovu zapnout',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant', :'zar_a'), '23514', 'Odvolané zařízení'));
reset role;
update public.branches set active = false where id = :'pob_a';
set role service_role;
select pg_temp.check('zařízení neaktivní pobočky nic nepošle',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_stav(%L)', :'klic_a2'), '42501', 'Pobočka zařízení není aktivní'));
reset role;
update public.branches set active = true where id = :'pob_a';
-- Kiosek u firmy bez Financí (řádek přímo — zapnout ho funkce nedovolí, viz oddíl 2).
insert into public.jine_platby_kiosky (zarizeni_id, tenant_id, branch_id) values (:'zar_c', :'tenant_b', :'pob_cizi');
set role service_role;
select pg_temp.check('firma bez Financí z kiosku nic nepošle',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L)', :'klic_c', null, gen_random_uuid()),
    '42501', 'Firma nemá zapnuté Finance'));
reset role;
set role anon;
select pg_temp.check('anon záznamy Jiných plateb nečte ani funkci kiosku nezavolá',
  not pg_temp.projde('select 1 from public.jine_platby limit 1')
  and not pg_temp.projde(format('select public.jine_platby_kiosek_stav(%L)', :'klic_a2')));
reset role;

-- Úklid: vlastní řádky pryč (cizí firma zůstává jako v krok98).
delete from public.jine_platby_historie where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c'));
delete from public.jine_platby_soubory where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c');
delete from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c');
delete from storage.objects where bucket_id = 'jine-platby' and name in (:'cesta1', :'cesta_vlastnik', :'cesta_dupl', :'cesta_typ', :'cesta_b');
delete from public.jine_platby_kiosky where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c');
delete from public.device_registrations where device_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c');
delete from public.branch_devices where id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c');
delete from public.integrace_pripojeni where id = :'pos_a';
-- Pobočky se uklízí OZNAČENÍM jako v krok24 (audit na ně ukazuje a mazat se nemá).
update public.branches set deleted_at = now(), active = false where id in (:'pob_a', :'pob_b', :'pob_cizi');

\echo ''
\echo '== KROK 100 HOTOV =============================================='
