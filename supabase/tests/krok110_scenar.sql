-- Scénář pro krok 110 — Choice: upozornění na výpadek napojení
-- a opakovaný test, když Choice jednou odmítne přístup.
--
-- Pokrývá migraci 20261108100000_rezervace_choice_vypadek.sql (spoušť
-- app.integrace_vypadek_upozornit na integrace_pripojeni a funkce
-- public.rezervace_choice_zabrat_opakovany_test). Kód, který funkci
-- volá, zkouší scripts/rezervace-choice.test.mjs (oddíl 12), texty
-- a odkaz scripts/upozorneni.test.mjs („Výpadek napojení“).
--
-- Proč: 3. 11. 2026 v 19:41 vrátil Choice u obou podniků jedinkrát 403,
-- napojení přešla na „vyžaduje pozornost“ a čtyři dny se nenačetla
-- žádná rezervace, aniž by o tom kdo věděl.
--
-- Běží po etapa0_scenar.sql, ale firmy, lidi i napojení si zakládá sám
-- (tři vlastní firmy); Foodtab s.r.o. nemění.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   0. příprava: kdo má kde integrace.manage (a že ve firmě bez Financí
--      nikdo — ani majitel);
--   1. granty: spoušť nezavolá nikdo, opakovaný test jen service_role;
--   2. výpadek (pripojeno → vyzaduje_pozornost): majitel a kdo má
--      integrace.manage NA TÉ pobočce (i za celou firmu) jedno upozornění
--      „important“; správkyně jiné pobočky, čtenář rezervací, pozastavený
--      správce, pozastavená spolumajitelka a cizí firma nic; tělo bez
--      externího účtu; push majiteli hned, ostatním až na směnu;
--   3. jen jednou: další zápis téhož stavu, změna důvodu, přechod na
--      „chyba“ a zpátky na „vyžaduje pozornost“ nic nového;
--   4. obnovení (→ pripojeno): nepřečtený výpadek nahradí tiché „zase
--      načítá“ (low, bez push), nevyřízený push výpadku se zruší;
--      přečtenému nic; druhé obnovení bez výpadku nic;
--   5. sám sobě ne: kdo stav přepnul (auth.uid()), upozornění nedostane;
--      kdo napojení obnovil, tomu se výpadek stáhne bez náhrady; dlouhý
--      důvod se zkrátí;
--   6. jen Choice a jen rezervace: pokladna (i od „choice“), jiný
--      poskytovatel rezervací a odpojené napojení nic;
--   7. firma bez Financí: majitel upozornění dostane i tak, správce se
--      zařazením integrace.manage ne;
--   8. selhání upozornění zápis stavu nezastaví;
--   9. opakovaný test v databázi: meze odstupu; odstup od posledního
--      běhu načítání i od ručního „Ověřit znovu“; kdo není na řadě,
--      frontu nezabere; kdo se do fronty nevejde, odstup nespotřebuje.
--
-- POZOR, SDÍLENÁ DATABÁZE: kontroly se ptají jen na lidi, firmy
-- a napojení tohohle scénáře, nikdy na celkové počty. Frontu dotazů
-- Choice si scénář uloží a na konci vrátí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

-- Kolik upozornění daného druhu má člověk k napojení.
create or replace function pg_temp.ma(p_user uuid, p_druh text, p_pripojeni uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.user_id = p_user and n.druh = p_druh
     and n.zdroj_typ = 'integrace_pripojeni' and n.zdroj_id = p_pripojeni
$$;

-- Kolik upozornění (jakéhokoli druhu) má člověk k napojení.
create or replace function pg_temp.k_napojeni(p_user uuid, p_pripojeni uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.user_id = p_user and n.zdroj_typ = 'integrace_pripojeni' and n.zdroj_id = p_pripojeni
$$;

-- Kolik upozornění k napojení dostal kdokoli.
create or replace function pg_temp.komukoli(p_pripojeni uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.zdroj_typ = 'integrace_pripojeni' and n.zdroj_id = p_pripojeni
$$;

-- Id posledního upozornění (jako text, '' když žádné). Na ně se ptají
-- kontroly „nic nového“ — počet by prošel i s náhradou za stejné.
create or replace function pg_temp.posledni(p_user uuid, p_druh text, p_pripojeni uuid)
returns text language sql as $$
  select coalesce((select n.id::text from public.notifications n
    where n.user_id = p_user and n.druh = p_druh
      and n.zdroj_typ = 'integrace_pripojeni' and n.zdroj_id = p_pripojeni
    order by n.created_at desc, n.id
    limit 1), '')
$$;

-- Stav doručení push k upozornění ('' když žádné).
create or replace function pg_temp.push(p_notification text)
returns text language sql as $$
  select coalesce((select d.stav from public.notifikace_doruceni d
    where p_notification <> '' and d.notification_id = p_notification::uuid
    order by d.id limit 1), '')
$$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Firma A (Provoz + Finance), pobočky A1 a A2:
--   Marta  — majitelka;
--   Olga   — spolumajitelka s POZASTAVENÝM členstvím;
--   Sára   — integrace.manage na A1;
--   Sabina — integrace.manage jen na A2;
--   Filip  — integrace.manage za celou firmu;
--   Čeněk  — na A1 jen čte rezervace;
--   Pavel  — integrace.manage na A1, členství pozastavené.
-- Firma B (cizí): Bořek — majitel.
-- Firma C (jen Provoz, BEZ Financí): Cyril — majitel, Cecílie má
--   v zařazení integrace.manage na C1 (bez modulu neplatí).
-- =====================================================================

\set maj_a   11010000-0000-0000-0000-000000000001
\set spol_a  11010000-0000-0000-0000-000000000002
\set spr1    11010000-0000-0000-0000-000000000003
\set spr2    11010000-0000-0000-0000-000000000004
\set firemni 11010000-0000-0000-0000-000000000005
\set ctenar  11010000-0000-0000-0000-000000000006
\set pozast  11010000-0000-0000-0000-000000000007
\set maj_b   11010000-0000-0000-0000-000000000008
\set maj_c   11010000-0000-0000-0000-000000000009
\set spr_c   11010000-0000-0000-0000-00000000000a

insert into auth.users (id, email, raw_user_meta_data) values
  (:'maj_a',   'marta110@foodtab.cz',  '{"full_name":"Marta Stodesítka"}'),
  (:'spol_a',  'olga110@foodtab.cz',   '{"full_name":"Olga Stodesítka"}'),
  (:'spr1',    'sara110@foodtab.cz',   '{"full_name":"Sára Stodesítka"}'),
  (:'spr2',    'sabina110@foodtab.cz', '{"full_name":"Sabina Stodesítka"}'),
  (:'firemni', 'filip110@foodtab.cz',  '{"full_name":"Filip Stodesítka"}'),
  (:'ctenar',  'cenek110@foodtab.cz',  '{"full_name":"Čeněk Stodesítka"}'),
  (:'pozast',  'pavel110@foodtab.cz',  '{"full_name":"Pavel Stodesítka"}'),
  (:'maj_b',   'borek110@foodtab.cz',  '{"full_name":"Bořek Stodesítka"}'),
  (:'maj_c',   'cyril110@foodtab.cz',  '{"full_name":"Cyril Stodesítka"}'),
  (:'spr_c',   'cecilie110@foodtab.cz','{"full_name":"Cecílie Stodesítka"}');

-- Firma A
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok110 Alfa s.r.o.', 'Krok110 Alfa s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_a \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_a', 'provoz'), (:'firma_a', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_a', 'Alfa Náměstí Krok110', 'krok110-a1') returning id as a1 \gset
insert into public.branches (tenant_id, name, slug)
values (:'firma_a', 'Alfa Nádraží Krok110', 'krok110-a2') returning id as a2 \gset

insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_a', 'krok110_napojeni', 'Krok110 — napojení', 'provoz', true) returning id as z_napojeni_a \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_a', 'krok110_rezervace', 'Krok110 — rezervace', 'provoz', true) returning id as z_cteni_a \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'firma_a', :'z_napojeni_a', 'integrace.manage'),
  (:'firma_a', :'z_cteni_a', 'rezervace.read');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_a', :'a1', :'maj_a', 'Marta Stodesítka', 'hpp', true) returning id as e_maj_a \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_a', :'a1', :'spol_a', 'Olga Stodesítka', 'hpp', true) returning id as e_spol_a \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'a1', :'spr1', :'z_napojeni_a', 'Sára Stodesítka', 'hpp') returning id as e_spr1 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'a2', :'spr2', :'z_napojeni_a', 'Sabina Stodesítka', 'hpp') returning id as e_spr2 \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'a1', :'firemni', :'z_napojeni_a', 'Filip Stodesítka', 'hpp') returning id as e_firemni \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'a1', :'ctenar', :'z_cteni_a', 'Čeněk Stodesítka', 'hpp') returning id as e_ctenar \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_a', :'a1', :'pozast', :'z_napojeni_a', 'Pavel Stodesítka', 'hpp') returning id as e_pozast \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma_a', :'maj_a',   null, 'tenant', 'active'),
  (:'firma_a', :'spol_a',  null, 'tenant', 'suspended'),
  (:'firma_a', :'firemni', null, 'tenant', 'active'),
  (:'firma_a', :'spr1',    null, 'branch', 'active'),
  (:'firma_a', :'spr2',    null, 'branch', 'active'),
  (:'firma_a', :'ctenar',  null, 'branch', 'active'),
  (:'firma_a', :'pozast',  null, 'branch', 'suspended');
insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'spr2' then :'a2'::uuid else :'a1'::uuid end
  from public.memberships m
 where m.tenant_id = :'firma_a'
   and m.user_id in (:'spr1', :'spr2', :'ctenar', :'pozast');

-- Firma B (cizí)
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok110 Beta s.r.o.', 'Krok110 Beta s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_b \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_b', 'provoz'), (:'firma_b', 'finance')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_b', 'Beta Krok110', 'krok110-b1') returning id as b1 \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_b', :'b1', :'maj_b', 'Bořek Stodesítka', 'hpp', true) returning id as e_maj_b \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'firma_b', :'maj_b', null, 'tenant', 'active');

-- Firma C (bez Financí)
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok110 Gama s.r.o.', 'Krok110 Gama s.r.o.', 'CZK', 'Europe/Prague') returning id as firma_c \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'firma_c', 'provoz')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'firma_c', 'Gama Krok110', 'krok110-c1') returning id as c1 \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'firma_c', 'krok110_napojeni', 'Krok110 — napojení', 'provoz', true) returning id as z_napojeni_c \gset
insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'firma_c', :'z_napojeni_c', 'integrace.manage');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'firma_c', :'c1', :'maj_c', 'Cyril Stodesítka', 'hpp', true) returning id as e_maj_c \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'firma_c', :'c1', :'spr_c', :'z_napojeni_c', 'Cecílie Stodesítka', 'hpp') returning id as e_spr_c \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma_c', :'maj_c', null, 'tenant', 'active'),
  (:'firma_c', :'spr_c', null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'c1'::uuid from public.memberships m where m.tenant_id = :'firma_c' and m.user_id = :'spr_c';

-- Telefony: Marta (majitelka) a Sára (na směně není).
insert into public.push_odbery (user_id, endpoint, p256dh, auth_secret) values
  (:'maj_a', 'https://fcm.googleapis.com/fcm/send/krok110-marta', 'p256dh-krok110-marta', 'auth-krok110'),
  (:'spr1',  'https://fcm.googleapis.com/fcm/send/krok110-sara',  'p256dh-krok110-sara',  'auth-krok110');

-- Napojení. „pripojeno“ jen s úspěšným testem (integrace_pripojeni_rezervace_overeno).
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy, externi_ucet)
values (:'firma_a', :'a1', 'rezervace', 'choice', 'zakaznicky', 'Choice — Krok110 A1', 'pripojeno', true, now(),
        '{"domena":"krok110-a1.choiceqr.com","var_symbol":"11001"}') returning id as ch_a1 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy, externi_ucet)
values (:'firma_a', :'a2', 'rezervace', 'choice', 'zakaznicky', 'Choice — Krok110 A2', 'pripojeno', true, now(),
        '{"domena":"krok110-a2.choiceqr.com","var_symbol":"11002"}') returning id as ch_a2 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy)
values (:'firma_a', :'a1', 'pokladna', 'dotykacka', 'zakaznicky', 'Pokladna — Krok110 A1', 'pripojeno', true, now()) returning id as pok_a1 \gset
-- Pokladna od „choice“: jen ať jde rozbít podmínka na oblast — bez ní by
-- ji podmínka na poskytovatele zakryla.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy)
values (:'firma_a', :'a1', 'pokladna', 'choice', 'zakaznicky', 'Pokladna Choice — Krok110 A1', 'pripojeno', true, now()) returning id as pokch_a1 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy)
values (:'firma_a', :'a1', 'rezervace', 'krok110-jiny', 'zakaznicky', 'Jiné rezervace — Krok110 A1', 'pripojeno', true, now()) returning id as jiny_a1 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy, odpojeno_kdy, externi_ucet)
values (:'firma_a', :'a1', 'rezervace', 'choice', 'zakaznicky', 'Choice odpojené — Krok110 A1', 'pripojeno', true, now(), now() - interval '1 day',
        '{"var_symbol":"11000"}') returning id as odp_a1 \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy, externi_ucet)
values (:'firma_b', :'b1', 'rezervace', 'choice', 'zakaznicky', 'Choice — Krok110 B1', 'pripojeno', true, now(),
        '{"var_symbol":"11003"}') returning id as ch_b \gset
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, stav, posledni_test_ok, posledni_test_kdy, externi_ucet)
values (:'firma_c', :'c1', 'rezervace', 'choice', 'zakaznicky', 'Choice — Krok110 C1', 'pripojeno', true, now(),
        '{"var_symbol":"11004"}') returning id as ch_c \gset


\echo ''
\echo '== 0. Příprava ==========================================='

select pg_temp.check('příprava: na A1 má integrace.manage Sára i Filip (celá firma), Sabina jen na A2',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a1') where user_id = :'spr1')
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a1') where user_id = :'firemni')
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a2') where user_id = :'firemni')
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a2') where user_id = :'spr2')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a1') where user_id = :'spr2'));
select pg_temp.check('příprava: čtenář rezervací, pozastavený Pavel ani pozastavená spolumajitelka integrace.manage na A1 nemají',
  not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'integrace.manage', :'a1')
               where user_id in (:'ctenar', :'pozast', :'spol_a'))
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_a', 'rezervace.read', :'a1') where user_id = :'ctenar'));
select pg_temp.check('příprava: ve firmě C (bez Financí) nemá integrace.manage nikdo — ani majitel',
  not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'firma_c', 'integrace.manage', :'c1')));
select pg_temp.check('příprava: napojení zatím bez upozornění',
  pg_temp.komukoli(:'ch_a1') + pg_temp.komukoli(:'ch_a2') + pg_temp.komukoli(:'ch_b') + pg_temp.komukoli(:'ch_c') = 0);


\echo ''
\echo '== 1. Granty ============================================='

select pg_temp.check('spoušť nezavolá nikdo (přihlášený, anon, úloha) — běží jen jako spoušť',
  not has_function_privilege('authenticated', 'app.integrace_vypadek_upozornit()', 'execute')
  and not has_function_privilege('anon', 'app.integrace_vypadek_upozornit()', 'execute')
  and not has_function_privilege('service_role', 'app.integrace_vypadek_upozornit()', 'execute'));
select pg_temp.check('spoušť visí na integrace_pripojeni a je zapnutá',
  exists (select 1 from pg_trigger
           where tgname = 'trg_integrace_vypadek_upozornit'
             and tgrelid = 'public.integrace_pripojeni'::regclass
             and tgenabled <> 'D'));
select pg_temp.check('opakovaný test zabírá jen úloha (service_role); přihlášený ani anon ne',
  has_function_privilege('service_role', 'public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer)', 'execute'));


\echo ''
\echo '== 2. Výpadek: komu ======================================'

-- Jako běh úlohy (service_role, nikdo přihlášený): Choice odmítl přístup.
update public.integrace_pripojeni
   set stav = 'vyzaduje_pozornost', posledni_test_ok = false, posledni_test_kdy = now(),
       posledni_chyba = 'Choice odmítl přístup (403). Načítání stojí, dokud přístup neprojde testem.'
 where id = :'ch_a1';

select pg_temp.posledni(:'maj_a', 'integrace.vypadek', :'ch_a1') as alarm_maj \gset
select pg_temp.posledni(:'spr1', 'integrace.vypadek', :'ch_a1') as alarm_spr1 \gset
select pg_temp.posledni(:'firemni', 'integrace.vypadek', :'ch_a1') as alarm_firemni \gset

select pg_temp.check('výpadek: majitelka jedno upozornění',
  pg_temp.ma(:'maj_a', 'integrace.vypadek', :'ch_a1') = 1);
select pg_temp.check('výpadek: Sára (integrace.manage na A1) jedno',
  pg_temp.ma(:'spr1', 'integrace.vypadek', :'ch_a1') = 1);
select pg_temp.check('výpadek: Filip (integrace.manage za celou firmu) jedno',
  pg_temp.ma(:'firemni', 'integrace.vypadek', :'ch_a1') = 1);
select pg_temp.check('výpadek: Sabina (správkyně jen A2) nic',
  pg_temp.k_napojeni(:'spr2', :'ch_a1') = 0);
select pg_temp.check('výpadek: Čeněk (jen čte rezervace) nic',
  pg_temp.k_napojeni(:'ctenar', :'ch_a1') = 0);
select pg_temp.check('výpadek: pozastavený Pavel nic',
  pg_temp.k_napojeni(:'pozast', :'ch_a1') = 0);
select pg_temp.check('výpadek: pozastavená spolumajitelka nic (platného příjemce hlídá app.notifikovat)',
  pg_temp.k_napojeni(:'spol_a', :'ch_a1') = 0);
select pg_temp.check('výpadek: cizí firma nic',
  pg_temp.k_napojeni(:'maj_b', :'ch_a1') = 0 and pg_temp.k_napojeni(:'maj_c', :'ch_a1') = 0);
select pg_temp.check('výpadek: nikdo další (jen majitelka, Sára a Filip)',
  pg_temp.komukoli(:'ch_a1') = 3);

select pg_temp.check('výpadek: priorita important, firma a pobočka napojení, zdroj napojení, klíč integrace.vypadek:<id>',
  (select n.priorita = 'important' and n.tenant_id = :'firma_a' and n.branch_id = :'a1'
          and n.dedupe_key = 'integrace.vypadek:' || :'ch_a1' and n.read_at is null
     from public.notifications n where n.id = :'alarm_maj'::uuid));
select pg_temp.check('tělo: id napojení, oblast, poskytovatel, pobočka, slug a důvod z napojení',
  (select n.telo ->> 'pripojeni' = :'ch_a1' and n.telo ->> 'oblast' = 'rezervace' and n.telo ->> 'poskytovatel' = 'choice'
          and n.telo ->> 'pobocka' = 'Alfa Náměstí Krok110' and n.telo ->> 'pobocka_slug' = 'krok110-a1'
          and n.telo ->> 'duvod' = 'Choice odmítl přístup (403). Načítání stojí, dokud přístup neprojde testem.'
     from public.notifications n where n.id = :'alarm_maj'::uuid));
select pg_temp.check('tělo nenese externí účet (doména, var_symbol)',
  (select not (n.telo ? 'externi_ucet') and n.telo::text not like '%11001%' and n.telo::text not like '%choiceqr%'
     from public.notifications n where n.id = :'alarm_maj'::uuid));
select pg_temp.check('push: majitelce hned (k_odeslani), Sáře až na směnu (ceka_na_smenu)',
  pg_temp.push(:'alarm_maj') = 'k_odeslani' and pg_temp.push(:'alarm_spr1') = 'ceka_na_smenu');


\echo ''
\echo '== 3. Výpadek: jen jednou ================================'

update public.integrace_pripojeni
   set posledni_chyba = 'Choice odmítl přístup (403). Další běh.'
 where id = :'ch_a1';
update public.integrace_pripojeni set stav = 'vyzaduje_pozornost' where id = :'ch_a1';
select pg_temp.check('změna důvodu ani zápis téhož stavu nic nového',
  pg_temp.posledni(:'maj_a', 'integrace.vypadek', :'ch_a1') = :'alarm_maj'
  and pg_temp.komukoli(:'ch_a1') = 3);

update public.integrace_pripojeni set stav = 'chyba' where id = :'ch_a1';
select pg_temp.check('„vyžaduje pozornost“ → „chyba“ (neprošlo „Ověřit znovu“) nic',
  pg_temp.posledni(:'maj_a', 'integrace.vypadek', :'ch_a1') = :'alarm_maj'
  and pg_temp.komukoli(:'ch_a1') = 3);

update public.integrace_pripojeni set stav = 'vyzaduje_pozornost' where id = :'ch_a1';
select pg_temp.check('„chyba“ → „vyžaduje pozornost“ nic (výpadek je jen z „pripojeno“)',
  pg_temp.posledni(:'maj_a', 'integrace.vypadek', :'ch_a1') = :'alarm_maj'
  and pg_temp.komukoli(:'ch_a1') = 3);


\echo ''
\echo '== 4. Obnovení ==========================================='

-- Filip si výpadek přečetl, Marta a Sára ne.
update public.notifications set read_at = now() where id = :'alarm_firemni'::uuid;

update public.integrace_pripojeni
   set stav = 'pripojeno', posledni_test_ok = true, posledni_test_kdy = now(), posledni_chyba = null
 where id = :'ch_a1';

select pg_temp.posledni(:'maj_a', 'integrace.obnoveno', :'ch_a1') as obnoveno_maj \gset
select pg_temp.posledni(:'spr1', 'integrace.obnoveno', :'ch_a1') as obnoveno_spr1 \gset

select pg_temp.check('obnovení: majitelčin nepřečtený výpadek je pryč, místo něj „zase načítá“',
  pg_temp.ma(:'maj_a', 'integrace.vypadek', :'ch_a1') = 0
  and pg_temp.ma(:'maj_a', 'integrace.obnoveno', :'ch_a1') = 1);
select pg_temp.check('obnovení: Sáře totéž',
  pg_temp.ma(:'spr1', 'integrace.vypadek', :'ch_a1') = 0
  and pg_temp.ma(:'spr1', 'integrace.obnoveno', :'ch_a1') = 1);
select pg_temp.check('obnovení: „zase načítá“ je tiché (low) a bez push',
  (select bool_and(n.priorita = 'low') from public.notifications n where n.id in (:'obnoveno_maj'::uuid, :'obnoveno_spr1'::uuid))
  and pg_temp.push(:'obnoveno_maj') = '' and pg_temp.push(:'obnoveno_spr1') = '');
select pg_temp.check('obnovení: push výpadku, který ještě neodešel, se zrušil',
  not exists (select 1 from public.notifikace_doruceni d
               where d.tenant_id = :'firma_a' and d.user_id in (:'maj_a', :'spr1')
                 and d.stav in ('k_odeslani', 'ceka_na_smenu')));
select pg_temp.check('obnovení: Filip si výpadek přečetl — „zase načítá“ nedostane, přečtený zůstane',
  pg_temp.ma(:'firemni', 'integrace.obnoveno', :'ch_a1') = 0
  and pg_temp.ma(:'firemni', 'integrace.vypadek', :'ch_a1') = 1);
select pg_temp.check('obnovení: nikomu dalšímu nic',
  pg_temp.komukoli(:'ch_a1') = 3);

-- Ruční „Ověřit znovu“ neprošlo a pak prošlo — bez výpadku mezi tím.
update public.integrace_pripojeni set stav = 'chyba', posledni_test_ok = false where id = :'ch_a1';
update public.integrace_pripojeni set stav = 'pripojeno', posledni_test_ok = true where id = :'ch_a1';
select pg_temp.check('druhé obnovení bez výpadku nic nového (tiché „zase načítá“ se neopakuje)',
  pg_temp.posledni(:'maj_a', 'integrace.obnoveno', :'ch_a1') = :'obnoveno_maj'
  and pg_temp.posledni(:'spr1', 'integrace.obnoveno', :'ch_a1') = :'obnoveno_spr1'
  and pg_temp.komukoli(:'ch_a1') = 3);


\echo ''
\echo '== 5. Sám sobě ne ========================================'

-- Sabina (integrace.manage na A2) přepne stav sama.
select set_config('test.user_id', :'spr2', false);
update public.integrace_pripojeni
   set stav = 'vyzaduje_pozornost', posledni_test_ok = false, posledni_chyba = repeat('x', 400)
 where id = :'ch_a2';
select set_config('test.user_id', '', false);

select pg_temp.check('kdo stav přepnul sám (Sabina), upozornění nedostane',
  pg_temp.k_napojeni(:'spr2', :'ch_a2') = 0);
select pg_temp.check('… majitelka a Filip ano',
  pg_temp.ma(:'maj_a', 'integrace.vypadek', :'ch_a2') = 1
  and pg_temp.ma(:'firemni', 'integrace.vypadek', :'ch_a2') = 1
  and pg_temp.komukoli(:'ch_a2') = 2);
select pg_temp.check('dlouhý důvod se do těla zkrátí na 300 znaků',
  (select length(n.telo ->> 'duvod') = 300 from public.notifications n
    where n.id = pg_temp.posledni(:'maj_a', 'integrace.vypadek', :'ch_a2')::uuid));

-- Majitelka napojení obnoví sama („Ověřit znovu“ prošlo).
select set_config('test.user_id', :'maj_a', false);
update public.integrace_pripojeni
   set stav = 'pripojeno', posledni_test_ok = true, posledni_chyba = null
 where id = :'ch_a2';
select set_config('test.user_id', '', false);

select pg_temp.check('kdo napojení obnovil (majitelka), tomu výpadek zmizí bez „zase načítá“',
  pg_temp.k_napojeni(:'maj_a', :'ch_a2') = 0);
select pg_temp.check('… Filip dostane „zase načítá“ místo výpadku',
  pg_temp.ma(:'firemni', 'integrace.obnoveno', :'ch_a2') = 1
  and pg_temp.ma(:'firemni', 'integrace.vypadek', :'ch_a2') = 0);


\echo ''
\echo '== 6. Jen Choice a jen rezervace ========================='

update public.integrace_pripojeni set stav = 'vyzaduje_pozornost', posledni_chyba = 'Pokladna odmítla přístup.'
 where id = :'pok_a1';
select pg_temp.check('pokladna ve „vyžaduje pozornost“ nic (banka a pokladna: otázka 90)',
  pg_temp.komukoli(:'pok_a1') = 0);

update public.integrace_pripojeni set stav = 'vyzaduje_pozornost' where id = :'pokch_a1';
select pg_temp.check('pokladna od téhož poskytovatele („choice“) nic — upozornění jen u rezervací',
  pg_temp.komukoli(:'pokch_a1') = 0);

update public.integrace_pripojeni set stav = 'vyzaduje_pozornost', posledni_test_ok = false where id = :'jiny_a1';
select pg_temp.check('jiný poskytovatel rezervací nic',
  pg_temp.komukoli(:'jiny_a1') = 0);

update public.integrace_pripojeni set stav = 'vyzaduje_pozornost', posledni_test_ok = false where id = :'odp_a1';
select pg_temp.check('odpojené napojení Choice nic, ani kdyby stav přeskočil',
  pg_temp.komukoli(:'odp_a1') = 0);


\echo ''
\echo '== 7. Firma bez Financí ==================================='

update public.integrace_pripojeni
   set stav = 'vyzaduje_pozornost', posledni_test_ok = false, posledni_chyba = 'Choice odmítl přístup (403).'
 where id = :'ch_c';
select pg_temp.check('firma bez Financí: majitel upozornění dostane (integrace.manage tam nemá nikdo)',
  pg_temp.ma(:'maj_c', 'integrace.vypadek', :'ch_c') = 1);
select pg_temp.check('… správkyně se zařazením integrace.manage ne (modul Finance vypnutý)',
  pg_temp.k_napojeni(:'spr_c', :'ch_c') = 0
  and pg_temp.komukoli(:'ch_c') = 1);


\echo ''
\echo '== 8. Selhání upozornění zápis nezastaví =================='

-- Upozornění k napojení schválně spadne (dočasná spoušť na notifications,
-- hned zase pryč — databáze je sdílená).
create function public.krok110_upozorneni_spadne() returns trigger language plpgsql as $$
begin
  if new.druh like 'integrace.%' then
    raise exception 'krok110: upozornění schválně spadlo';
  end if;
  return new;
end $$;
create trigger krok110_upozorneni_spadne before insert on public.notifications
  for each row execute function public.krok110_upozorneni_spadne();

select pg_temp.projde(format(
  'update public.integrace_pripojeni set stav = %L, posledni_test_ok = false, posledni_chyba = %L where id = %L',
  'vyzaduje_pozornost', 'Choice odmítl přístup (403).', :'ch_b')) as zapis_prosel \gset

drop trigger krok110_upozorneni_spadne on public.notifications;
drop function public.krok110_upozorneni_spadne();

select pg_temp.check('když upozornění selže, zápis stavu stejně projde',
  :'zapis_prosel'::boolean
  and (select stav = 'vyzaduje_pozornost' from public.integrace_pripojeni where id = :'ch_b'));
select pg_temp.check('… a upozornění nevzniklo (spadlo celé, ne napůl)',
  pg_temp.komukoli(:'ch_b') = 0);


\echo ''
\echo '== 9. Opakovaný test v databázi ==========================='

select dalsi_volny::text as fronta_puvodne from app.rezervace_choice_fronta where jediny \gset
update app.rezervace_choice_fronta set dalsi_volny = '-infinity' where jediny;

select pg_temp.check('bez připojení → 22023',
  pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_opakovany_test(null, 7200000, 5500, 11000)',
    '22023', 'musí patřit připojení'));
select pg_temp.check('odstup pod 30 minut → 22023',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_opakovany_test(%L, 1799999, 5500, 11000)', :'ch_c'),
    '22023', 'nejčastěji po 30 minutách'));
select pg_temp.check('odstup nad 24 hodin → 22023',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_opakovany_test(%L, 86400001, 5500, 11000)', :'ch_c'),
    '22023', 'nejčastěji po 30 minutách'));
select pg_temp.check('odstup NULL → 22023',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_opakovany_test(%L, null, 5500, 11000)', :'ch_c'),
    '22023', 'nejčastěji po 30 minutách'));

-- Běh načítání, kterému Choice před hodinou odmítl.
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, zahajeno_kdy, dokonceno_kdy, stav)
values (:'firma_c', :'ch_c', now() - interval '1 hour', now() - interval '1 hour', 'chyba')
returning id as beh_c \gset

-- NULL z funkce = -999 (\gset by z NULL udělal prázdno).
select coalesce(public.rezervace_choice_zabrat_opakovany_test(:'ch_c', 7200000, 5500, 11000), -999) as z1 \gset
select pg_temp.check('běh načítání před hodinou → -1 (ještě ne) a fronty se nedotkne',
  :'z1'::integer = -1
  and (select dalsi_volny = '-infinity' from app.rezervace_choice_fronta where jediny));

update public.synchronizace_behy set zahajeno_kdy = now() - interval '3 hours', dokonceno_kdy = now() - interval '3 hours'
 where id = :'beh_c';
select coalesce(public.rezervace_choice_zabrat_opakovany_test(:'ch_c', 7200000, 5500, 11000), -999) as z2 \gset
select pg_temp.check('běh před 3 h → test smí (≥ 0 ms), odstup se zapsal teď',
  :'z2'::integer >= 0
  and (select o.naposledy > now() - interval '1 minute' from app.rezervace_choice_overeni o where o.pripojeni_id = :'ch_c'));
select pg_temp.check('… a vzal místo ve frontě (další volné za ~5,5 s)',
  (select dalsi_volny > clock_timestamp() + interval '3 seconds'
      and dalsi_volny < clock_timestamp() + interval '6 seconds'
     from app.rezervace_choice_fronta where jediny));

select dalsi_volny::text as fronta_po_testu from app.rezervace_choice_fronta where jediny \gset
select coalesce(public.rezervace_choice_zabrat_opakovany_test(:'ch_c', 7200000, 5500, 11000), -999) as z3 \gset
select pg_temp.check('hned znovu → -1 a fronta beze změny',
  :'z3'::integer = -1
  and (select dalsi_volny = :'fronta_po_testu'::timestamptz from app.rezervace_choice_fronta where jediny));

-- Fronta plná: místo až za minutu, čekat smí 11 s.
update app.rezervace_choice_overeni set naposledy = now() - interval '3 hours' where pripojeni_id = :'ch_c';
update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval '1 minute' where jediny;
select coalesce(public.rezervace_choice_zabrat_opakovany_test(:'ch_c', 7200000, 5500, 11000), -999) as z4 \gset
select pg_temp.check('fronta plná → NULL a odstup se nespotřeboval',
  :'z4'::integer = -999
  and (select o.naposledy < now() - interval '2 hours' from app.rezervace_choice_overeni o where o.pripojeni_id = :'ch_c'));

-- Ruční „Ověřit znovu“ před hodinou: odstup je společný.
update app.rezervace_choice_fronta set dalsi_volny = '-infinity' where jediny;
update app.rezervace_choice_overeni set naposledy = now() - interval '1 hour' where pripojeni_id = :'ch_c';
select coalesce(public.rezervace_choice_zabrat_opakovany_test(:'ch_c', 7200000, 5500, 11000), -999) as z5 \gset
select pg_temp.check('ruční „Ověřit znovu“ před hodinou → -1 (společný odstup)',
  :'z5'::integer = -1);

update app.rezervace_choice_fronta set dalsi_volny = :'fronta_puvodne'::timestamptz where jediny;


\echo ''
\echo '== Úklid ================================================='

reset role;
select set_config('test.user_id', '', false);

delete from public.notifikace_doruceni where tenant_id in (:'firma_a', :'firma_b', :'firma_c');
delete from public.notifications where tenant_id in (:'firma_a', :'firma_b', :'firma_c');
delete from public.push_odbery where user_id in (:'maj_a', :'spr1');
-- Běhy a odstupy jdou s napojením (on delete cascade).
delete from public.integrace_pripojeni where tenant_id in (:'firma_a', :'firma_b', :'firma_c');
-- Majitelé a jejich firmy zůstávají (jako v krocích 103, 106 a 107):
-- posledního majitele firmy pojistka smazat nedovolí. Ostatní lidé pryč.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id in (:'firma_a', :'firma_c')
                            and user_id in (:'spr1', :'spr2', :'firemni', :'ctenar', :'pozast', :'spr_c'));
delete from public.memberships
 where tenant_id in (:'firma_a', :'firma_c')
   and user_id in (:'spr1', :'spr2', :'firemni', :'ctenar', :'pozast', :'spr_c');
delete from public.employees where id in (:'e_spr1', :'e_spr2', :'e_firemni', :'e_ctenar', :'e_pozast', :'e_spr_c');
delete from public.position_permissions where position_id in (:'z_napojeni_a', :'z_cteni_a', :'z_napojeni_c');
delete from public.positions where id in (:'z_napojeni_a', :'z_cteni_a', :'z_napojeni_c');

select pg_temp.check('úklid: upozornění, push a napojení kroku 110 pryč',
  not exists (select 1 from public.notifications where tenant_id in (:'firma_a', :'firma_b', :'firma_c'))
  and not exists (select 1 from public.integrace_pripojeni where tenant_id in (:'firma_a', :'firma_b', :'firma_c'))
  and not exists (select 1 from public.push_odbery where user_id in (:'maj_a', :'spr1')));
select pg_temp.check('úklid: fronta dotazů Choice vrácená, jak byla',
  (select dalsi_volny = :'fronta_puvodne'::timestamptz from app.rezervace_choice_fronta where jediny));
select pg_temp.check('úklid: spoušť ze scénáře na notifications nezůstala',
  not exists (select 1 from pg_trigger where tgname = 'krok110_upozorneni_spadne'));

\echo ''
\echo '== KROK 110 HOTOV ========================================'
