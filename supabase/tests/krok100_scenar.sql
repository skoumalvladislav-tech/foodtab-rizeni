-- =====================================================================
-- Krok 100 — Kiosek Jiných plateb na telefonu pobočky
-- (zadání Šéfíka 22. 10. 2026; migrace 20261022100000_jine_platby_kiosek)
--
-- Telefon je zařízení pobočky (branch_devices, spárované kódem jako
-- tablet Docházky), bez přihlášeného člověka a bez PINu. Kontroluje se:
--   0. účel zařízení (kontrola 24. 10.): telefon na doklady neotevře
--      funkce kiosku Docházky a nepočítá se jako tablet; tablet Docházky
--      zase nepošle doklad;
--   1. granty: funkce kiosku jen pro service_role, zapínání jen pro
--      přihlášené, tabulka kiosků bez zápisu;
--   2. zapnutí kiosku: jen správce nastavení pobočky, ne cizí firma,
--      ne odvolané zařízení, ne firma bez Financí, ne tablet Docházky;
--      čtení tabulky kiosků přes RLS;
--   3. stav: jen pobočka a název; zařízení bez zapnutého kiosku
--      a vymyšlený klíč nic nedostanou;
--   4. založení: na pobočce zařízení, autorem zařízení (vytvoril
--      prázdné), opakované odeslání = týž záznam jen otevřený a pod
--      stropem adres, pokladna jen když je jediná;
--   5. strop odeslání za hodinu a za 24 hodin;
--   6. připojení fotky: jen záznam téhož zařízení, do dvou hodin,
--      rozpracovaný, soubor bez vlastníka, stejná fotka podruhé ne (u
--      téhož záznamu vrátí tutéž); ověření záznamu před stažením a úklid
--      jen vlastního nepřipojeného souboru;
--   7. odvolání zařízení a vypnutí kiosku platí hned; neaktivní pobočka
--      a firma bez Financí nic nepošlou;
--   8. rozhodnutí Šéfíka 24. 10.: přehled dokladů odeslaných z TOHOTO
--      zařízení za dnešní provozní den (otázka 69) a víc zařízení na
--      jedné pobočce (strop i autor na zařízení).
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

-- Výsledek funkce jako jsonb; chyba se vrátí jako {"chyba": …}, ať
-- kontrola spadne svým popisem, ne holou výjimkou.
create or replace function pg_temp.vysledek_json(p_sql text)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  execute p_sql into v;
  return v;
exception when others then
  return jsonb_build_object('chyba', sqlerrm);
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

-- Zařízení: majitel vystaví kódy; telefony (anon) se spárují na
-- /kiosek/doklady (registrovat_zarizeni_doklady), tablet na /kiosek.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select kod as kod_a  from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 telefon A') \gset
select kod as kod_a2 from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 telefon strop') \gset
select kod as kod_b  from public.vytvorit_registracni_kod(:'tenant', :'pob_b', 'Krok100 telefon B') \gset
select kod as kod_t  from public.vytvorit_registracni_kod(:'tenant', :'pob_a', 'Krok100 tablet Docházky') \gset
select kod as kod_dup   from public.vytvorit_registracni_kod(:'tenant', :'pob_a', ' krok100 TELEFON a ') \gset
select kod as kod_dup_b from public.vytvorit_registracni_kod(:'tenant', :'pob_b', 'Krok100 telefon A') \gset
select set_config('test.user_id', '10010000-0000-0000-0000-000000000005', false);
select kod as kod_c  from public.vytvorit_registracni_kod(:'tenant_b', :'pob_cizi', 'Krok100 cizí telefon') \gset
reset role;
select set_config('test.user_id', '', false);
set role anon;
select device_id as zar_a,  klic as klic_a  from public.registrovat_zarizeni_doklady(:'kod_a') \gset
select device_id as zar_a2, klic as klic_a2 from public.registrovat_zarizeni_doklady(:'kod_a2') \gset
select device_id as zar_b,  klic as klic_b  from public.registrovat_zarizeni_doklady(:'kod_b') \gset
select device_id as zar_t,  klic as klic_t  from public.registrovat_zarizeni(:'kod_t') \gset
select device_id as zar_c,  klic as klic_c  from public.registrovat_zarizeni_doklady(:'kod_c') \gset
reset role;

\echo ''
\echo '-- 0. Účel zařízení: telefon na doklady není kiosek Docházky --'
select pg_temp.check('spárování na /kiosek/doklady dá účel „doklady“, tablet na /kiosek zůstane Docházkou',
  (select count(*) from public.branch_devices where id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c') and ucel = 'doklady') = 4
  and (select ucel = 'dochazka' from public.branch_devices where id = :'zar_t'));
set role anon;
select pg_temp.check('telefon na doklady neotevře kiosek Docházky: kód k píchnutí a rozpis směn (kiosk_stav)',
  pg_temp.spadne_hlaskou(format('select public.kiosk_stav(%L)', :'klic_a'), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani dnešní zálohy se jmény a částkami (kiosk_zalohy)',
  pg_temp.spadne_hlaskou(format('select public.kiosk_zalohy(%L)', :'klic_a'), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani píchnutí PINem, potvrzení zálohy a zprávy',
  pg_temp.spadne_hlaskou(format('select * from public.pichnout_pinem(%L, %L, %L)', :'klic_a', '1234', 'in'), '42501', 'Zařízení není registrované')
  and pg_temp.spadne_hlaskou(format('select * from public.potvrdit_zalohu_pinem(%L, %L, %L)', :'klic_a', '1234', gen_random_uuid()), '42501', 'Zařízení není registrované')
  and pg_temp.spadne_hlaskou(format('select public.kiosk_zpravy_pocet(%L)', :'klic_a'), '42501', 'Zařízení není registrované')
  and pg_temp.spadne_hlaskou(format('select * from public.kiosk_zpravy_pinem(%L, %L)', :'klic_a', '1234'), '42501', 'Zařízení není registrované'));
select pg_temp.check('tablet Docházky kiosk Docházky dál otevře (kontrola rozezná oba stavy)',
  (select public.kiosk_stav(:'klic_t') ? 'kod'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('pobočka jen s telefonem na doklady „tablet nemá“ (Docházka poradí ruční zápis); s tabletem ano',
  public.pobocka_ma_kiosek(:'tenant', :'pob_b') = false and public.pobocka_ma_kiosek(:'tenant', :'pob_a') = true);
select pg_temp.check('účel zařízení nejde přímým zápisem změnit ani správci nastavení — ani rozšířit (telefon → Docházka), ani zúžit (tablet → doklady)',
  not pg_temp.projde(format('update public.branch_devices set ucel = %L where id = %L', 'dochazka', :'zar_a'))
  and not pg_temp.projde(format('update public.branch_devices set ucel = %L where id = %L', 'doklady', :'zar_t')));
reset role;
-- V produkci mají přihlášení na tabulku zařízení UPDATE z výchozích práv
-- Supabase — proto rozhoduje spoušť; tady ji zkouší vlastník databáze.
select pg_temp.check('… ani vlastníkovi databáze: účel se nastaví jen při spárování a pak se nemění (spoušť, ne grant)',
  pg_temp.spadne_hlaskou(format('update public.branch_devices set ucel = %L where id = %L', 'dochazka', :'zar_a'), '23514', 'Účel zařízení nejde změnit')
  and pg_temp.spadne_hlaskou(format('update public.branch_devices set ucel = %L where id = %L', 'doklady', :'zar_t'), '23514', 'Účel zařízení nejde změnit')
  and (select ucel = 'doklady' from public.branch_devices where id = :'zar_a')
  and (select ucel = 'dochazka' from public.branch_devices where id = :'zar_t'));
set role anon;
select pg_temp.check('telefon na doklady má na pobočce jedinečný název (Finance autora pozná jen podle něj; velikost písmen a mezery nerozhodují)',
  pg_temp.spadne_hlaskou(format('select * from public.registrovat_zarizeni_doklady(%L)', :'kod_dup'), '23505', 'už je aktivní telefon'));
reset role;
select pg_temp.check('… nepovedené spárování kód nespotřebuje',
  (select used_at is null from public.device_registrations where code_hash = encode(sha256(convert_to(upper(btrim(:'kod_dup')), 'UTF8')), 'hex')));
set role anon;
select device_id as zar_dup_b from public.registrovat_zarizeni_doklady(:'kod_dup_b') \gset
reset role;
select pg_temp.check('… stejný název na jiné pobočce projde (kontrola rozezná oba stavy)',
  (select ucel = 'doklady' and branch_id = :'pob_b' from public.branch_devices where id = :'zar_dup_b'));

\echo ''
\echo '-- 1. Granty --'
select pg_temp.check('funkce kiosku (stav, přehled, založení, ověření záznamu, úklid, připojení fotky) jen service_role: anon ani přihlášený ne',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('jine_platby_kiosek_stav', 'jine_platby_kiosek_zalozit', 'jine_platby_kiosek_pripojit_soubor', 'jine_platby_kiosek_dnes',
                        'jine_platby_kiosek_overit_zaznam', 'jine_platby_kiosek_muze_uklidit')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and p.proconfig @> array['search_path=""']) = 6);
select pg_temp.check('zapnutí kiosku jen pro přihlášené (anon ne), SECURITY DEFINER se search_path=""',
  (select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
          and p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'jine_platby_kiosek_zapnout'));
select pg_temp.check('spárování telefonu na doklady smí anon (jako registrace tabletu), SECURITY DEFINER se search_path=""',
  (select has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrovat_zarizeni_doklady'));
select pg_temp.check('pomocné funkce kiosku (zařízení podle klíče, stropy, spoušť účelu) nezavolá anon ani přihlášený',
  (select count(*) from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in ('jp_kiosek_zarizeni', 'jp_kiosek_strop_hodina', 'jp_kiosek_strop_den', 'jp_kiosek_strop_adres', 'zarizeni_ucel_nemenny',
                        'registrovat_zarizeni_s_ucelem')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 6);
select pg_temp.check('tabulka kiosků: přihlášený jen čte (RLS), zapisuje jen funkce; anon nic',
  has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'select')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'insert')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'update')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'delete')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosky', 'truncate')
  and not has_table_privilege('anon', 'public.jine_platby_kiosky', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.jine_platby_kiosky'::regclass));
select pg_temp.check('účel zařízení přihlášený čte (seznam v Nastavení); že ho nezmění, hlídá spoušť (oddíl 0)',
  has_column_privilege('authenticated', 'public.branch_devices', 'ucel', 'select'));
select pg_temp.check('náhrobky úklidu: anon ani přihlášený nic, RLS zapnuté (píše a čte jen funkce kiosku)',
  not has_table_privilege('authenticated', 'public.jine_platby_kiosek_uklid', 'select')
  and not has_table_privilege('authenticated', 'public.jine_platby_kiosek_uklid', 'insert')
  and not has_table_privilege('anon', 'public.jine_platby_kiosek_uklid', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.jine_platby_kiosek_uklid'::regclass));

\echo ''
\echo '-- 2. Zapnutí kiosku --'
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_a', true);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_a2', true);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_b', true);
select pg_temp.check('správce nastavení zapne kiosek (opakované zapnutí nevadí)',
  pg_temp.projde(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant', :'zar_a')));
select pg_temp.check('tablet Docházky kiosek Jiných plateb nedostane (jen telefon spárovaný na doklady)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zapnout(%L, %L, true)', :'tenant', :'zar_t'),
    '23514', 'jen na telefonu spárovaném na /kiosek/doklady'));
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
\echo '-- 2b. Čtení tabulky kiosků přes RLS --'
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel vidí zapnuté kiosky svých tří telefonů',
  (select count(*) from public.jine_platby_kiosky where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b')) = 3);
select set_config('test.user_id', '10010000-0000-0000-0000-000000000005', false);
select pg_temp.check('cizí firma kiosky Foodtabu nevidí',
  (select count(*) from public.jine_platby_kiosky where tenant_id = :'tenant') = 0);
reset role;
-- Vedoucí Perly dostane settings.manage (právo je firemní), vidí ale jen
-- Perlu. Původní stav výjimky se po kontrole vrátí (sdílená DB na CI).
select coalesce((select p.granted::text from public.employee_permissions p join public.employees e on e.id = p.employee_id
                  where e.user_id = :'vedouci' and e.tenant_id = :'tenant' and p.permission_key = 'settings.manage'), 'zadny') as puvodni_pravo \gset
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
select :'tenant', e.id, 'settings.manage', true from public.employees e
 where e.user_id = :'vedouci' and e.tenant_id = :'tenant'
on conflict (employee_id, permission_key) do update set granted = true;
set role authenticated;
select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('správce nastavení jen Perly nevidí kiosky poboček A a B',
  (select count(*) from public.jine_platby_kiosky where tenant_id = :'tenant') = 0);
reset role;
delete from public.employee_permissions
 where :'puvodni_pravo' = 'zadny' and tenant_id = :'tenant' and permission_key = 'settings.manage'
   and employee_id in (select id from public.employees where user_id = :'vedouci' and tenant_id = :'tenant');
update public.employee_permissions set granted = (:'puvodni_pravo' = 'true')
 where :'puvodni_pravo' <> 'zadny' and tenant_id = :'tenant' and permission_key = 'settings.manage'
   and employee_id in (select id from public.employees where user_id = :'vedouci' and tenant_id = :'tenant');

\echo ''
\echo '-- 3. Stav: jen pobočka a název --'
set role service_role;
select public.jine_platby_kiosek_stav(:'klic_a')::text as stav_a \gset
reset role;
select pg_temp.check('stav zapnutého telefonu: pobočka a název zařízení, nic víc',
  (:'stav_a')::jsonb ->> 'pobocka' = 'Krok100 Kiosek A' and (:'stav_a')::jsonb ->> 'zarizeni' = 'Krok100 telefon A'
  and (select count(*) from jsonb_object_keys((:'stav_a')::jsonb)) = 2);
set role service_role;
select pg_temp.check('tablet Docházky nedostane nic ani tady (klíč tabletu kiosek dokladů nezná)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_stav(%L)', :'klic_t'), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('vymyšlený klíč nedostane nic (stejná hláška jako kiosek Docházky)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_stav(%L)', repeat('ab', 32)), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
reset role;

\echo ''
\echo '-- 4. Založení záznamu --'
set role service_role;
select public.jine_platby_kiosek_zalozit(:'klic_a', '  Stůl 4 — firma Novák  ', '10010000-aaaa-0000-0000-000000000001', 1)::text as zal_a \gset
select public.jine_platby_kiosek_zalozit(:'klic_b', null, '10010000-aaaa-0000-0000-000000000002', 1)::text as zal_b \gset
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
  (select public.jine_platby_kiosek_zalozit(:'klic_a', 'jinak', '10010000-aaaa-0000-0000-000000000001', 1) ->> 'zaznam') = :'z_a');
select pg_temp.check('klíč odeslání jiného zařízení nový záznam nezaloží ani ten cizí nevrátí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_a2', null, '10010000-aaaa-0000-0000-000000000001'),
    '23514', 'Klíč odeslání už patří jinému záznamu'));
select pg_temp.check('počet fotek musí být 1 až 10',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 0)', :'klic_b', null, gen_random_uuid()), '23514', '1 až 10 fotek')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 11)', :'klic_b', null, gen_random_uuid()), '23514', '1 až 10 fotek')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, null)', :'klic_b', null, gen_random_uuid()), '23514', '1 až 10 fotek'));
-- Strop adres: deset fotek a jedno celé opakování; třetí pokus je uzavřený.
select pg_temp.check('opakování se stejným klíčem vydá adresy jen do stropu (10 + 10 projde, další ne)',
  pg_temp.projde(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 10)', :'klic_b', 'adresy', '10010000-aaaa-0000-0000-000000000010'))
  and pg_temp.projde(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 10)', :'klic_b', 'adresy', '10010000-aaaa-0000-0000-000000000010'))
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_b', 'adresy', '10010000-aaaa-0000-0000-000000000010'),
    '23514', 'odeslání už je uzavřené'));
reset role;
select pg_temp.check('… databáze vydané adresy počítá a záznam je pořád jeden',
  (select count(*) = 1 and min(kiosek_vydano) = 20 from public.jine_platby where klient_id = '10010000-aaaa-0000-0000-000000000010'));
set role service_role;
select public.jine_platby_kiosek_zalozit(:'klic_b', 'uzavření', '10010000-aaaa-0000-0000-000000000011', 1) ->> 'zaznam' as z_uz \gset
reset role;
update public.jine_platby set stav_kontroly = 'zkontrolovano' where id = :'z_uz';
set role service_role;
select pg_temp.check('opakování ke zkontrolovanému záznamu nevrátí nic — odeslání je uzavřené',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_b', null, '10010000-aaaa-0000-0000-000000000011'),
    '23514', 'odeslání už je uzavřené'));
reset role;
update public.jine_platby set stav_kontroly = 'rozpracovano', vytvoreno = now() - interval '3 hours' where id = :'z_uz';
set role service_role;
select pg_temp.check('… ani k záznamu staršímu než dvě hodiny',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_b', null, '10010000-aaaa-0000-0000-000000000011'),
    '23514', 'odeslání už je uzavřené'));
reset role;
update public.jine_platby set vytvoreno = now() where id = :'z_uz';
set role service_role;
select pg_temp.check('… čerstvý rozpracovaný záznam opakování přijme (kontrola rozezná oba stavy)',
  (select public.jine_platby_kiosek_zalozit(:'klic_b', null, '10010000-aaaa-0000-0000-000000000011', 1) ->> 'zaznam') = :'z_uz');
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
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid(), 1);
  end loop;
exception when others then
  raise exception 'SELHALO: víc zařízení na jedné pobočce — telefon „strop“ narazil dřív, než sám poslal 60 dokladů (strop se počítá jinak než na zařízení): %', sqlerrm;
end $$;
reset role;
\echo 'strop: 20 odeslání prošlo'
set role service_role;
select pg_temp.check('21. doklad za hodinu z jednoho zařízení neprojde',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_a2', null, gen_random_uuid()),
    '23514', 'za poslední hodinu'));
reset role;
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
do $$
begin
  for i in 1..20 loop
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid(), 1);
  end loop;
exception when others then
  raise exception 'SELHALO: víc zařízení na jedné pobočce — telefon „strop“ narazil dřív, než sám poslal 60 dokladů (strop se počítá jinak než na zařízení): %', sqlerrm;
end $$;
reset role;
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
do $$
begin
  for i in 1..20 loop
    perform public.jine_platby_kiosek_zalozit(current_setting('test.klic_strop'), null, gen_random_uuid(), 1);
  end loop;
exception when others then
  raise exception 'SELHALO: víc zařízení na jedné pobočce — telefon „strop“ narazil dřív, než sám poslal 60 dokladů (strop se počítá jinak než na zařízení): %', sqlerrm;
end $$;
reset role;
-- Všech 60 posunout mimo poslední hodinu: hodinový strop je volný, denní ne.
update public.jine_platby set vytvoreno = now() - interval '2 hours' where zarizeni_id = :'zar_a2';
set role service_role;
select pg_temp.check('61. doklad za 24 hodin z jednoho zařízení neprojde (ani mimo hodinový strop)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_a2', null, gen_random_uuid()),
    '23514', 'za posledních 24 hodin'));
select pg_temp.check('víc zařízení na jedné pobočce: strop telefonu „strop“ nebrání druhému telefonu TÉŽE pobočky',
  pg_temp.projde(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_a', 'druhý doklad A', '10010000-aaaa-0000-0000-000000000003')));
reset role;
select pg_temp.check('… a každý doklad nese SVOJE zařízení (dva telefony téže pobočky se nepletou)',
  (select count(distinct zarizeni_nazev) = 2 and bool_and(branch_id = :'pob_a')
     from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2'))
  and not exists (select 1 from public.jine_platby where zarizeni_id = :'zar_a2' and zarizeni_nazev <> 'Krok100 telefon strop')
  and not exists (select 1 from public.jine_platby where zarizeni_id = :'zar_a' and zarizeni_nazev <> 'Krok100 telefon A'));
set role service_role;
select pg_temp.check('strop jednoho zařízení nebrání jinému zařízení (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_b', null, gen_random_uuid())));
reset role;

\echo ''
\echo '-- 6. Připojení fotky --'
select id as z_a2 from public.jine_platby where zarizeni_id = :'zar_a2' order by vytvoreno desc limit 1 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000001') as cesta1 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000002') as cesta_vlastnik \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000003') as cesta_dupl \gset
select format('%s/%s/%s/%s.png', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000004') as cesta_typ \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_b', :'z_b', '10010000-bbbb-0000-0000-000000000005') as cesta_b \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a2', '10010000-bbbb-0000-0000-000000000006') as cesta_a2 \gset
select format('%s/%s/%s/%s.jpg', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-000000000007') as cesta_neni \gset
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('jine-platby', :'cesta1', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_vlastnik', :'majitel', '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_dupl', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_typ', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_b', null, '{"mimetype":"image/jpeg","size":2000}'),
  ('jine-platby', :'cesta_a2', null, '{"mimetype":"image/jpeg","size":2000}');
set role service_role;
select pg_temp.check('než server cokoli stáhne, databáze ověří záznam: vrátí jen záznam, firmu a pobočku zařízení',
  (select (select count(*) from jsonb_object_keys(o)) = 3 and o ->> 'zaznam' = :'z_a' and o ->> 'tenant' = :'tenant' and o ->> 'branch' = :'pob_a'
     from (select public.jine_platby_kiosek_overit_zaznam(:'klic_a', :'z_a') as o) x));
select pg_temp.check('… záznam jiného zařízení (i téže pobočky) neověří',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_a', :'z_a2'), '42501', 'Záznam z tohohle zařízení není')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_a', :'z_b'), '42501', 'Záznam z tohohle zařízení není'));
select pg_temp.check('… vymyšlený klíč (třeba samé nuly) neověří nic',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', repeat('0', 64), :'z_a'), '42501', 'Zařízení není registrované'));
select pg_temp.check('fotku k záznamu téhož zařízení server připojí',
  (select public.jine_platby_kiosek_pripojit_soubor(:'klic_a', :'z_a', :'cesta1', repeat('c1', 32)) ->> 'uz_pripojen') = 'false');
reset role;
select pg_temp.check('soubor z kiosku: nahrál ho kiosek (nahral prázdné), historie bez člověka',
  (select nahral is null and zarizeni_id = :'zar_a' and poradi = 1 from public.jine_platby_soubory where cesta = :'cesta1')
  and exists (select 1 from public.jine_platby_historie
               where zaznam_id = :'z_a' and udalost = 'soubor_pripojen' and kdo is null and detail ->> 'zdroj' = 'kiosek'));
set role service_role;
select pg_temp.vysledek_json(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl', repeat('c1', 32)))::text as znovu \gset
reset role;
select pg_temp.check('tatáž fotka u téhož záznamu (ztracená odpověď) vrátí tentýž soubor, nic nepřibude',
  (:'znovu')::jsonb ->> 'uz_pripojen' = 'true'
  and (:'znovu')::jsonb ->> 'soubor' = (select id::text from public.jine_platby_soubory where cesta = :'cesta1')
  and (select count(*) from public.jine_platby_soubory where zaznam_id = :'z_a') = 1);
set role service_role;
select pg_temp.check('soubor nahraný přihlášeným (s vlastníkem) kiosek nepřipojí',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_vlastnik', repeat('c2', 32)),
    '23514', 'Soubor nahrál někdo jiný'));
select pg_temp.check('stejná fotka k jinému záznamu neprojde a hláška nic neprozradí o cizím záznamu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c1', 32)),
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
-- Úklid: server smí smazat jen to, co databáze potvrdí.
select pg_temp.check('úklid: vlastní nepřipojený soubor bez vlastníka smazat smí',
  public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a', :'cesta_dupl') = true);
select pg_temp.check('… a od té chvíle ho připojit nejde (náhrobek — souběžné dokončení nepřipojí soubor, který se maže)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl', repeat('c9', 32)),
    '23514', 'mezitím uklidila'));
select pg_temp.check('úklid: připojený soubor (originál dokladu) ne',
  public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a', :'cesta1') = false);
select pg_temp.check('úklid: soubor s vlastníkem (nahrál přihlášený) ne',
  public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a', :'cesta_vlastnik') = false);
select pg_temp.check('úklid: soubor záznamu jiného zařízení téže pobočky ne',
  public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a2', :'cesta_a2') = false);
select pg_temp.check('úklid: cesta jiného záznamu pod vlastním záznamem ne; neexistující soubor ne',
  public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a', :'cesta_b') = false
  and public.jine_platby_kiosek_muze_uklidit(:'klic_a', :'z_a', :'cesta_neni') = false);
select pg_temp.check('úklid: vymyšlený klíč dostane chybu (nic se nesmaže)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_muze_uklidit(%L, %L, %L)', repeat('0', 64), :'z_a', :'cesta_dupl'), '42501', 'Zařízení není registrované'));
reset role;
update public.jine_platby set stav_kontroly = 'zkontrolovano' where id = :'z_b';
set role service_role;
select pg_temp.check('ke zkontrolovanému záznamu kiosek fotku nepřidá (ani ověření záznamu neprojde)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32)),
    '23514', 'už fotky přidat nejde')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_b', :'z_b'), '23514', 'už fotky přidat nejde'));
reset role;
update public.jine_platby set stav_kontroly = 'rozpracovano', vytvoreno = now() - interval '3 hours' where id = :'z_b';
set role service_role;
select pg_temp.check('k záznamu staršímu než dvě hodiny kiosek fotku nepřidá',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32)),
    '23514', 'už fotky přidat nejde')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_b', :'z_b'), '23514', 'už fotky přidat nejde'));
reset role;
update public.jine_platby set vytvoreno = now() where id = :'z_b';
set role service_role;
select pg_temp.check('… čerstvý rozpracovaný záznam téhož zařízení fotku přijme (kontrola rozezná oba stavy)',
  pg_temp.projde(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_b', :'z_b'))
  and pg_temp.projde(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_b', :'z_b', :'cesta_b', repeat('c7', 32))));
reset role;

\echo ''
\echo '-- 6b. Dnes odesláno z tohoto zařízení (rozhodnutí 24. 10.) --'
set role service_role;
select public.jine_platby_kiosek_dnes(:'klic_a')::text as dnes_a \gset
select public.jine_platby_kiosek_dnes(:'klic_b')::text as dnes_b \gset
reset role;
select pg_temp.check('přehled telefonu A: jen jeho dva dnešní doklady, od nejnovějšího',
  jsonb_array_length((:'dnes_a')::jsonb) = 2
  and (:'dnes_a')::jsonb -> 0 ->> 'oznaceni' = 'druhý doklad A' and (:'dnes_a')::jsonb -> 1 ->> 'oznaceni' = 'Stůl 4 — firma Novák');
select pg_temp.check('každý řádek přehledu jen čas, počet fotek, poznámka a stav — žádné částky ani nic z Financí',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['cas', 'fotek', 'oznaceni', 'stav'])
     from jsonb_array_elements((:'dnes_a')::jsonb) e));
select pg_temp.check('stav: s fotkou „přijato“, bez fotky „bez_fotky“; počet fotek sedí',
  (:'dnes_a')::jsonb -> 1 ->> 'stav' = 'prijato' and ((:'dnes_a')::jsonb -> 1 ->> 'fotek')::int = 1
  and (:'dnes_a')::jsonb -> 0 ->> 'stav' = 'bez_fotky' and ((:'dnes_a')::jsonb -> 0 ->> 'fotek')::int = 0);
-- Finance přepíšou označení (návrh) a připojí vlastní soubor: telefon
-- nesmí vidět ani jedno. Zařízení soubor deaktivovaný se nepočítá.
update public.jine_platby set oznaceni = 'Novák — dluží 14 000 Kč, vymáhat přes právníka' where id = :'z_a';
insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk, nahral)
values (:'tenant', :'pob_a', :'z_a', 2, format('%s/%s/%s/%s.pdf', :'tenant', :'pob_a', :'z_a', '10010000-bbbb-0000-0000-0000000000f1'),
        'application/pdf', 3000, repeat('f1', 32), :'majitel');
set role service_role;
select public.jine_platby_kiosek_dnes(:'klic_a')::text as dnes_a2 \gset
reset role;
select pg_temp.check('přehled ukazuje poznámku, kterou napsala obsluha — ne označení přepsané ve Financích (i s částkou)',
  (:'dnes_a2')::jsonb -> 1 ->> 'oznaceni' = 'Stůl 4 — firma Novák' and (:'dnes_a2')::text not like '%14 000%');
select pg_temp.check('… a počítá jen fotky z tohoto telefonu: soubor připojený ve Financích ne',
  ((:'dnes_a2')::jsonb -> 1 ->> 'fotek')::int = 1);
update public.jine_platby_soubory set aktivni = false where cesta = :'cesta1';
set role service_role;
select pg_temp.check('… ani odebranou (neaktivní) fotku',
  ((public.jine_platby_kiosek_dnes(:'klic_a')) -> 1 ->> 'fotek')::int = 0);
reset role;
update public.jine_platby_soubory set aktivni = true where cesta = :'cesta1';
select pg_temp.check('přehled telefonu B neobsahuje nic z telefonu A (ani ze stejné firmy)',
  jsonb_array_length((:'dnes_b')::jsonb) >= 1
  and not exists (select 1 from jsonb_array_elements((:'dnes_b')::jsonb) e where e ->> 'oznaceni' in ('Stůl 4 — firma Novák', 'druhý doklad A')));
update public.jine_platby set stav_kontroly = 'zkontrolovano' where id = :'z_b';
set role service_role;
select pg_temp.check('stav „zkontrolováno“ po kontrole ve Financích',
  exists (select 1 from jsonb_array_elements(public.jine_platby_kiosek_dnes(:'klic_b')) e where e ->> 'stav' = 'zkontrolovano'));
reset role;
update public.jine_platby set stav_trzby = 'zapsano' where id = :'z_b';
set role service_role;
select pg_temp.check('stav „zpracováno“ po zápisu tržby',
  exists (select 1 from jsonb_array_elements(public.jine_platby_kiosek_dnes(:'klic_b')) e where e ->> 'stav' = 'zpracovano'));
reset role;
update public.jine_platby set stav_trzby = 'nezapsano', stav_kontroly = 'zruseno' where id = :'z_b';
set role service_role;
select pg_temp.check('stav „zrušeno“ (bez důvodu — ten píše Finance)',
  exists (select 1 from jsonb_array_elements(public.jine_platby_kiosek_dnes(:'klic_b')) e where e ->> 'stav' = 'zruseno'));
reset role;
update public.jine_platby set stav_kontroly = 'rozpracovano', vytvoreno = now() - interval '1 day' - interval '1 hour' where id = :'z_b';
set role service_role;
select pg_temp.check('doklad z minulého provozního dne v přehledu není',
  not exists (select 1 from jsonb_array_elements(public.jine_platby_kiosek_dnes(:'klic_b')) e where (e ->> 'fotek')::int = 1));
reset role;
update public.jine_platby set vytvoreno = now() where id = :'z_b';

\echo ''
\echo '-- 7. Odvolání, vypnutí, neaktivní pobočka, firma bez Financí --'
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.jine_platby_kiosek_zapnout(:'tenant', :'zar_b', false);
reset role;
set role service_role;
select pg_temp.check('vypnutý kiosek hned nic neukáže ani v přehledu',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_dnes(%L)', :'klic_b'), '42501', 'není zapnutý kiosek Jiných plateb'));
select pg_temp.check('vypnutý kiosek hned nic nepošle (klíč přitom platí dál)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_b', null, gen_random_uuid()),
    '42501', 'není zapnutý kiosek Jiných plateb'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.branch_devices set stav = 'revoked', revoked_at = now() where id = :'zar_a';
reset role;
set role service_role;
select pg_temp.check('odvolané zařízení hned nic nezaloží',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_a', null, gen_random_uuid()),
    '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani neukáže přehled svých dnešních dokladů',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_dnes(%L)', :'klic_a'), '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani nepřipojí fotku k záznamu, který samo založilo',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_pripojit_soubor(%L, %L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl', repeat('c8', 32)),
    '42501', 'Zařízení není registrované nebo bylo odvolané.'));
select pg_temp.check('… ani neověří záznam a nic neuklidí (server pak nic nestáhne ani nesmaže)',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_overit_zaznam(%L, %L)', :'klic_a', :'z_a'), '42501', 'Zařízení není registrované')
  and pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_muze_uklidit(%L, %L, %L)', :'klic_a', :'z_a', :'cesta_dupl'), '42501', 'Zařízení není registrované'));
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
  pg_temp.spadne_hlaskou(format('select public.jine_platby_kiosek_zalozit(%L, %L, %L, 1)', :'klic_c', null, gen_random_uuid()),
    '42501', 'Firma nemá zapnuté Finance'));
reset role;
set role anon;
select pg_temp.check('anon záznamy Jiných plateb nečte ani funkci kiosku nezavolá',
  not pg_temp.projde('select 1 from public.jine_platby limit 1')
  and not pg_temp.projde(format('select public.jine_platby_kiosek_stav(%L)', :'klic_a2'))
  and not pg_temp.projde(format('select public.jine_platby_kiosek_muze_uklidit(%L, %L, %L)', :'klic_a2', :'z_a2', :'cesta_a2')));
reset role;

-- Úklid: vlastní řádky pryč (cizí firma zůstává jako v krok98).
delete from public.jine_platby_historie where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c'));
delete from public.jine_platby_soubory where zaznam_id in (select id from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c'));
delete from public.jine_platby where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_c');
delete from storage.objects where bucket_id = 'jine-platby' and name in (:'cesta1', :'cesta_vlastnik', :'cesta_dupl', :'cesta_typ', :'cesta_b', :'cesta_a2');
delete from public.jine_platby_kiosky where zarizeni_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c', :'zar_dup_b');
delete from public.device_registrations where device_id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c', :'zar_dup_b')
   or code_hash = encode(sha256(convert_to(upper(btrim(:'kod_dup')), 'UTF8')), 'hex');
delete from public.branch_devices where id in (:'zar_a', :'zar_a2', :'zar_b', :'zar_t', :'zar_c', :'zar_dup_b');
delete from public.integrace_pripojeni where id = :'pos_a';
-- Pobočky se uklízí OZNAČENÍM jako v krok24 (audit na ně ukazuje a mazat se nemá).
update public.branches set deleted_at = now(), active = false where id in (:'pob_a', :'pob_b', :'pob_cizi');

\echo ''
\echo '== KROK 100 HOTOV =============================================='
