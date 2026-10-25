-- Scénář pro krok 103 — Rezervace a kalendář akcí.
--
-- Pokrývá migraci 20261027100000_rezervace_akce.sql.
--
-- Navazuje na etapa0_scenar.sql až krok101_scenar.sql (seed firmy,
-- poboček Černá Perla / Bernard Bar a majitele). Číslo 102 je volné
-- schválně — souběžná relace (výdej ze skladu) si ho může vzít.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. ruční rezervace: čas podle pásma POBOČKY (zima i léto), přes
--      půlnoc, provozní den u rezervace po půlnoci, kontakt zvlášť;
--   2. kdo nesmí zapisovat: jen čtenář, člověk bez práva, jiná pobočka,
--      cizí firma;
--   3. kontrola údajů česky (datum, čas, číslo, stav);
--   4. úprava, změna stavu, rezervace se nestěhuje na jinou pobočku;
--   5. čtení po právech: čtenář vidí rezervaci, NE kontakt hosta;
--   6. zápis mimo funkce neprojde (granty);
--   7. poznámky ke dni i k rezervaci, spoušť hlídá firmu a pobočku;
--   8. přílohy: úložiště po pobočkách, připojení jen existujícího souboru
--      s typem z úložiště, připojený soubor nejde smazat, odebraný ano;
--   9. import ze souboru: nic se nezdvojí, údaje Foodtabu import
--      nepřepíše, údaje zdroje Foodtab nezmění, dávka je celá nebo nic;
--  10. import ze zdroje: jen ověřené připojení, „připojeno" jen s testem,
--      čas bez pásma neprojde, starší data nepřebijí novější;
--  11. stav napojení vidí, kdo vidí rezervace;
--  12. granty funkcí a tabulek;
--  13. audit ano, kontakt v auditu ne.
--
-- POZOR NA PGLITE: běží jako superuživatel, takže RLS a granty tam
-- neplatí všude. Kontroly čtení po právech mají proto vedle sebe
-- i kontrolu TEXTU politiky (pg_policies) — ta spadne i v PGlite.

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

-- Projde příkaz BEZ výjimky? Když ne, ať to spadne pojmenovanou
-- kontrolou s důvodem, ne holou výjimkou uprostřed scénáře.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

\set radka 10310000-0000-0000-0000-000000000001
\set cyril 10310000-0000-0000-0000-000000000002
\set nora 10310000-0000-0000-0000-000000000003
\set bara 10310000-0000-0000-0000-000000000004
\set xaver 10310000-0000-0000-0000-000000000005

insert into auth.users (id, email, raw_user_meta_data) values
  (:'radka', 'radka103@foodtab.cz', '{"full_name":"Radka Stopetrojka"}'),
  (:'cyril', 'cyril103@foodtab.cz', '{"full_name":"Cyril Stopetrojka"}'),
  (:'nora',  'nora103@foodtab.cz',  '{"full_name":"Nora Stopetrojka"}'),
  (:'bara',  'bara103@foodtab.cz',  '{"full_name":"Bára Stopetrojka"}'),
  (:'xaver', 'xaver103@foodtab.cz', '{"full_name":"Xaver Stopetrojka"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska103_rezervace', 'Zkouška 103 — rezervace', 'provoz', true)
returning id as z_zapis \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska103_cteni', 'Zkouška 103 — jen čtení', 'servis', true)
returning id as z_cteni \gset

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_zapis', 'rezervace.manage'),
  (:'tenant', :'z_cteni', 'rezervace.read');

-- Radka zapisuje na Perle, Cyril tam jen čte, Nora tam nemá nic,
-- Bára zapisuje v Baru.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'radka', :'z_zapis', 'Radka Stopetrojka', 'hpp') returning id as e_radka \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'cyril', :'z_cteni', 'Cyril Stopetrojka', 'hpp') returning id as e_cyril \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', :'nora', 'Nora Stopetrojka', 'hpp') returning id as e_nora \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'bar', :'bara', :'z_zapis', 'Bára Stopetrojka', 'hpp') returning id as e_bara \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', :'radka', null, 'branch', 'active'),
  (:'tenant', :'cyril', null, 'branch', 'active'),
  (:'tenant', :'nora',  null, 'branch', 'active'),
  (:'tenant', :'bara',  null, 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'bara' then :'bar'::uuid else :'perla'::uuid end
  from public.memberships m
 where m.tenant_id = :'tenant' and m.user_id in (:'radka', :'cyril', :'nora', :'bara');

-- Cizí firma s vlastním členem.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok103 Cizí s.r.o.', 'Krok103 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 103', 'krok103-cizi') returning id as cizi_pobocka \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'cizi_firma', :'cizi_pobocka', :'xaver', 'Xaver Stopetrojka', 'hpp') returning id as e_xaver \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'cizi_firma', :'xaver', null, 'tenant', 'active');


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

select pg_temp.check('příprava: provozní den Perly začíná v 5:00 (na tom stojí kontrola rezervace po půlnoci)',
  (select day_starts_at from public.branches where id = :'perla') = time '05:00');
select pg_temp.check('příprava: Perla je v pásmu Europe/Prague',
  app.zona_pobocky(:'perla') = 'Europe/Prague');

select set_config('test.user_id', :'radka', false);
select pg_temp.check('příprava: Radka zapisuje rezervace na Perle',
  app.has_access(:'tenant', 'rezervace.manage', :'perla'));
select pg_temp.check('příprava: Radka v Baru ne',
  not app.has_access(:'tenant', 'rezervace.manage', :'bar'));
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('příprava: Cyril na Perle čte, nezapisuje',
  app.has_access(:'tenant', 'rezervace.read', :'perla')
  and not app.has_access(:'tenant', 'rezervace.manage', :'perla'));
select set_config('test.user_id', :'nora', false);
select pg_temp.check('příprava: Nora nemá ani čtení',
  not app.has_access(:'tenant', 'rezervace.read', :'perla')
  and not app.has_access(:'tenant', 'rezervace.manage', :'perla'));
select set_config('test.user_id', :'bara', false);
select pg_temp.check('příprava: Bára zapisuje v Baru, na Perle ne',
  app.has_access(:'tenant', 'rezervace.manage', :'bar')
  and not app.has_access(:'tenant', 'rezervace.manage', :'perla'));
select set_config('test.user_id', '', false);

select pg_temp.check('oprávnění jsou v katalogu modulu provoz, zápis je citlivý',
  (select count(*) from public.permissions
    where key in ('rezervace.read', 'rezervace.manage') and module_key = 'provoz') = 2
  and (select sensitive from public.permissions where key = 'rezervace.manage')
  and not (select sensitive from public.permissions where key = 'rezervace.read'));

select pg_temp.check('šablony pro nové firmy: provozní obě práva, vedoucí směny čtení',
  (select count(*) from app.role_template_permissions
    where (template_key, permission_key) in (('provozni', 'rezervace.read'), ('provozni', 'rezervace.manage'),
                                             ('vedouci_smeny', 'rezervace.read'))) = 3
  and not exists (select 1 from app.role_template_permissions
                   where template_key = 'vedouci_smeny' and permission_key = 'rezervace.manage'));


\echo ''
\echo '== 1. Ruční rezervace a čas podle pásma pobočky ========='

set role authenticated;
select set_config('test.user_id', :'radka', false);

select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"rezervace","jmeno_hosta":"Novák Krok103","datum":"2026-11-20","od":"19:00","do":"22:00","pocet_osob":"4","telefon":"+420 777 111 222","email":"Novak@Example.cz"}'::jsonb) as r1 \gset

select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Léto Krok103","datum":"2026-07-10","od":"19:00","pocet_osob":"2"}'::jsonb) as r_leto \gset

select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Firemní večírek Krok103","typ_akce":"Firemní večírek","datum":"2026-11-27","od":"20:00","do":"01:00","pocet_osob":"40","menu":"Raut","zaloha_hosta_haleru":"500000","zaloha_hosta_stav":"pozadovana"}'::jsonb) as r_akce \gset

select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Noc Krok103","datum":"2026-11-21","od":"01:30","pocet_osob":"2"}'::jsonb) as r_noc \gset

-- Dvojí ťuknutí / opakování po výpadku: totéž číslo odeslání.
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Klíč Krok103","datum":"2026-11-23","od":"18:00","pocet_osob":"2","klic":"10310000-aaaa-0000-0000-000000000001"}'::jsonb) as r_klic \gset
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Klíč Krok103","datum":"2026-11-23","od":"18:00","pocet_osob":"2","klic":"10310000-aaaa-0000-0000-000000000001"}'::jsonb) as r_klic2 \gset

select set_config('test.user_id', :'majitel', false);
select pg_temp.check('číslo odeslání jedné pobočky nejde použít pro druhou',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'bar',
    '{"jmeno_hosta":"Klíč Krok103","datum":"2026-11-23","od":"18:00","klic":"10310000-aaaa-0000-0000-000000000001"}'),
    '23514', 'patří jiné rezervaci'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('totéž odeslání podruhé = tatáž rezervace, jen jedna',
  :'r_klic' = :'r_klic2'
  and (select count(*) from public.rezervace where jmeno_hosta = 'Klíč Krok103') = 1);

select pg_temp.check('zimní rezervace v 19:00 je 19:00 pražského času (UTC+1)',
  (select zacatek from public.rezervace where id = :'r1') = timestamptz '2026-11-20 19:00:00+01'
  and (select konec from public.rezervace where id = :'r1') = timestamptz '2026-11-20 22:00:00+01');
select pg_temp.check('letní rezervace v 19:00 je 19:00 letního času (UTC+2), ne posunutá o hodinu',
  (select zacatek from public.rezervace where id = :'r_leto') = timestamptz '2026-07-10 19:00:00+02');
select pg_temp.check('akce 20:00–01:00 končí až další den',
  (select konec from public.rezervace where id = :'r_akce') = timestamptz '2026-11-28 01:00:00+01');
select pg_temp.check('rezervace v 1:30 patří k provoznímu dni předtím (20. 11.)',
  (select den from public.rezervace where id = :'r_noc') = date '2026-11-20');
select pg_temp.check('rezervace v 19:00 má provozní den svého data',
  (select den from public.rezervace where id = :'r1') = date '2026-11-20');
select pg_temp.check('ruční rezervace: zdroj Foodtab, bez čísla zdroje, zapsala ji Radka',
  (select zdroj = 'rucne' and externi_id is null and poskytovatel is null and vytvoril = :'e_radka'::uuid
     from public.rezervace where id = :'r1'));
select pg_temp.check('výchozí druh a stav: rezervace, potvrzená',
  (select druh = 'rezervace' and stav = 'potvrzeno' from public.rezervace where id = :'r_leto'));
select pg_temp.check('akce si nese typ, menu a zálohu od hosta',
  (select druh = 'akce' and typ_akce = 'Firemní večírek' and menu = 'Raut'
          and zaloha_hosta_haleru = 500000 and zaloha_hosta_stav = 'pozadovana'
     from public.rezervace where id = :'r_akce'));
select pg_temp.check('kontakt je ve vlastní tabulce, e-mail malými písmeny',
  (select telefon = '+420 777 111 222' and email = 'novak@example.cz'
     from public.rezervace_kontakty where rezervace_id = :'r1'));
select pg_temp.check('rezervace bez telefonu a e-mailu kontakt nezaloží',
  not exists (select 1 from public.rezervace_kontakty where rezervace_id = :'r_leto'));


\echo ''
\echo '== 2. Kdo nesmí zapisovat ================================'

set role authenticated;
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril (jen čtení) rezervaci nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"2"}'), '42501', 'zapisovat nemůžete'));
select pg_temp.check('Cyril ani neupraví existující',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'tenant', :'r1',
    '{"prostor":"Stůl 1"}'), '42501', 'upravit nemůžete'));
select set_config('test.user_id', :'nora', false);
select pg_temp.check('Nora (bez práva) nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"2"}'), '42501', 'zapisovat nemůžete'));
select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára (právo v Baru) na Perle nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"2"}'), '42501', 'zapisovat nemůžete'));
select pg_temp.check('Bára neupraví rezervaci Perly',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'tenant', :'r1',
    '{"prostor":"Stůl 1"}'), '42501', 'upravit nemůžete'));
select set_config('test.user_id', :'radka', false);
select pg_temp.check('Radka nezapíše do Baru',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'bar',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"2"}'), '42501', 'zapisovat nemůžete'));
select pg_temp.check('Radka nezapíše do cizí firmy (ani s pobočkou své firmy)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'cizi_firma', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"2"}'), '42501', 'zapisovat nemůžete'));
select pg_temp.check('rezervaci Perly nejde upravit pod cizí firmou',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'cizi_firma', :'r1',
    '{"prostor":"Stůl 1"}'), '42501', 'upravit nemůžete'));
select set_config('test.user_id', :'xaver', false);
select pg_temp.check('člen cizí firmy nezmění stav rezervace Perly',
  pg_temp.spadne_hlaskou(format('select public.rezervace_zmenit_stav(%L, %L)', :'r1', 'zrusena'), '42501', 'upravit nemůžete'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('druhá linie: rezervace do pobočky cizí firmy neprojde ani přímým zápisem',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace (tenant_id, branch_id, zacatek, den) values (%L, %L, now(), current_date)',
    :'cizi_firma', :'perla'), '23514', 'Pobočka nepatří'));


\echo ''
\echo '== 3. Kontrola údajů ====================================='

set role authenticated;
select set_config('test.user_id', :'radka', false);
select pg_temp.check('bez data a času neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","pocet_osob":"2"}'), '23514', 'Vyplňte datum a čas začátku'));
select pg_temp.check('čas 25:00 neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"25:00"}'), '23514', 'nemá tvar HH:MM'));
select pg_temp.check('31. 11. neexistuje',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-31","od":"18:00"}'), '23514', 'neexistuje'));
select pg_temp.check('počet osob „čtyři" neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","pocet_osob":"čtyři"}'), '23514', 'celé číslo'));
select pg_temp.check('neznámý stav neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, null, %L, %L::jsonb)', :'tenant', :'perla',
    '{"jmeno_hosta":"X","datum":"2026-11-20","od":"18:00","stav":"usazeno"}'), '23514', 'rezervace_stav_check'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 4. Úprava a stav ======================================'

set role authenticated;
select set_config('test.user_id', :'radka', false);
select public.rezervace_ulozit(:'tenant', :'r1', null,
  '{"pocet_osob":"6","prostor":"Salonek","email":""}'::jsonb) as r1_znovu \gset
reset role;
select pg_temp.check('úprava vrací tutéž rezervaci',
  :'r1_znovu' = :'r1');
select pg_temp.check('úprava změnila jen poslané údaje (počet, prostor), čas zůstal',
  (select pocet_osob = 6 and prostor = 'Salonek' and jmeno_hosta = 'Novák Krok103'
          and zacatek = timestamptz '2026-11-20 19:00:00+01'
     from public.rezervace where id = :'r1'));
select pg_temp.check('prázdný e-mail kontakt vymazal, telefon zůstal',
  (select telefon = '+420 777 111 222' and email = '' from public.rezervace_kontakty where rezervace_id = :'r1'));

set role authenticated;
select set_config('test.user_id', :'radka', false);
select pg_temp.check('rezervace se nestěhuje na jinou pobočku',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, %L, %L::jsonb)', :'tenant', :'r1', :'bar',
    '{"prostor":"Bar"}'), '23514', 'přestěhovat'));
select pg_temp.check('stav jde změnit (proběhla)',
  pg_temp.projde(format('select public.rezervace_zmenit_stav(%L, %L)', :'r_leto', 'dokonceno')));
select pg_temp.check('neznámý stav změnou neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_zmenit_stav(%L, %L)', :'r_leto', 'usazeno'), '23514', 'rezervace_stav_check'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('stav se zapsal',
  (select stav from public.rezervace where id = :'r_leto') = 'dokonceno');


\echo ''
\echo '== 5. Čtení po právech ==================================='

select pg_temp.check('politika kontaktů se ptá na rezervace.manage, ne na čtení',
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'rezervace_kontakty' and cmd = 'SELECT'
             and qual like '%rezervace.manage%' and qual not like '%rezervace.read%'));
select pg_temp.check('politika rezervací pustí čtení i zápis',
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'rezervace' and cmd = 'SELECT'
             and qual like '%rezervace.read%' and qual like '%rezervace.manage%'));
select pg_temp.check('žádná z tabulek nemá zápisovou politiku (zápis jen funkcemi)',
  not exists (select 1 from pg_policies
               where schemaname = 'public'
                 and tablename in ('rezervace', 'rezervace_kontakty', 'rezervace_poznamky', 'rezervace_prilohy')
                 and cmd <> 'SELECT'));

set role authenticated;
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril rezervaci Perly vidí',
  (select count(*) from public.rezervace where id = :'r1') = 1);
select pg_temp.check('Cyril telefon hosta NEVIDÍ',
  (select count(*) from public.rezervace_kontakty where rezervace_id = :'r1') = 0);
select set_config('test.user_id', :'radka', false);
select pg_temp.check('Radka telefon hosta vidí',
  (select count(*) from public.rezervace_kontakty where rezervace_id = :'r1') = 1);
select set_config('test.user_id', :'nora', false);
select pg_temp.check('Nora (bez práva) rezervace nevidí',
  (select count(*) from public.rezervace where id in (:'r1', :'r_akce')) = 0);
select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára (Bar) rezervace Perly nevidí',
  (select count(*) from public.rezervace where id = :'r1') = 0);
select set_config('test.user_id', :'xaver', false);
select pg_temp.check('cizí firma rezervace nevidí',
  (select count(*) from public.rezervace where tenant_id = :'tenant') = 0);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 6. Zápis mimo funkce neprojde ========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ani majitel nevloží rezervaci přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace (tenant_id, branch_id, zacatek, den) values (%L, %L, now(), current_date)',
    :'tenant', :'perla'), '42501', 'permission denied'));
select pg_temp.check('ani majitel nezmění rezervaci přímo',
  pg_temp.spadne_hlaskou(format('update public.rezervace set pocet_osob = 99 where id = %L', :'r1'),
    '42501', 'permission denied'));
select pg_temp.check('ani majitel nesmaže rezervaci',
  pg_temp.spadne_hlaskou(format('delete from public.rezervace where id = %L', :'r1'), '42501', 'permission denied'));
select pg_temp.check('ani majitel nezapíše kontakt přímo',
  pg_temp.spadne_hlaskou(format('update public.rezervace_kontakty set telefon = %L where rezervace_id = %L', '1', :'r1'),
    '42501', 'permission denied'));
select pg_temp.check('ani majitel nevloží poznámku přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_poznamky (tenant_id, branch_id, den, obsah) values (%L, %L, current_date, %L)',
    :'tenant', :'perla', 'x'), '42501', 'permission denied'));
select pg_temp.check('ani majitel nevloží přílohu přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_prilohy (tenant_id, branch_id, den, cesta, nazev, mime, velikost) values (%L, %L, current_date, %L, %L, %L, 1)',
    :'tenant', :'perla', 'x/y/z.pdf', 'z.pdf', 'application/pdf'), '42501', 'permission denied'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 7. Poznámky ke dni a k rezervaci ======================'

set role authenticated;
select set_config('test.user_id', :'radka', false);
select public.rezervace_pridat_poznamku(:'tenant', :'perla', null, '2026-11-20', 'Kapela', 'Hraje od 20:00, sál zavřený od 18:00') as p_den \gset
select public.rezervace_pridat_poznamku(:'tenant', null, :'r1', null, 'Alergie', 'Lepek — 1 osoba') as p_rez \gset
select pg_temp.check('poznámka musí patřit k jednomu: rezervace NEBO den',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pridat_poznamku(%L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'r1', '2026-11-20', '', 'obojí'), '23514', 'vyberte jedno'));
select pg_temp.check('prázdná poznámka neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pridat_poznamku(%L, %L, null, %L, %L, %L)',
    :'tenant', :'perla', '2026-11-20', '', '   '), '23514', 'rezervace_poznamky_obsah_check'));
select pg_temp.check('Radka poznámku ke dni Baru nepřidá',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pridat_poznamku(%L, %L, null, %L, %L, %L)',
    :'tenant', :'bar', '2026-11-20', '', 'x'), '42501', 'přidat nemůžete'));
select pg_temp.check('Radka poznámku ke dni cizí firmy nepřidá',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pridat_poznamku(%L, %L, null, %L, %L, %L)',
    :'cizi_firma', :'cizi_pobocka', '2026-11-20', '', 'x'), '42501', 'přidat nemůžete'));
select pg_temp.check('úprava poznámky projde',
  pg_temp.projde(format('select public.rezervace_upravit_poznamku(%L, %L, %L)', :'p_den', 'Kapela', 'Hraje od 21:00')));
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril poznámku nepřidá',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pridat_poznamku(%L, null, %L, null, %L, %L)',
    :'tenant', :'r1', '', 'x'), '42501', 'přidat nemůžete'));
select pg_temp.check('Cyril poznámku nesmaže',
  pg_temp.spadne_hlaskou(format('select public.rezervace_smazat_poznamku(%L)', :'p_rez'), '42501', 'smazat nemůžete'));
select pg_temp.check('Cyril poznámky ke dni i k rezervaci čte',
  (select count(*) from public.rezervace_poznamky where id in (:'p_den', :'p_rez')) = 2);
select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára poznámky Perly nečte',
  (select count(*) from public.rezervace_poznamky where id in (:'p_den', :'p_rez')) = 0);
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('poznámka k rezervaci si vzala firmu a pobočku z rezervace, autora z přihlášeného',
  (select tenant_id = :'tenant'::uuid and branch_id = :'perla'::uuid and den is null and autor = :'e_radka'::uuid
     from public.rezervace_poznamky where id = :'p_rez'));
select pg_temp.check('úprava se zapsala',
  (select obsah from public.rezervace_poznamky where id = :'p_den') = 'Hraje od 21:00');
select pg_temp.check('druhá linie: poznámka s pobočkou jinou než její rezervace neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_poznamky (tenant_id, branch_id, rezervace_id, obsah) values (%L, %L, %L, %L)',
    :'tenant', :'bar', :'r1', 'x'), '23514', 'nesedí'));
select pg_temp.check('druhá linie: poznámka ke dni s pobočkou cizí firmy neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_poznamky (tenant_id, branch_id, den, obsah) values (%L, %L, current_date, %L)',
    :'tenant', :'cizi_pobocka', 'x'), '23514', 'Pobočka nepatří'));
select pg_temp.check('druhá linie: kontakt s jinou pobočkou než rezervace neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon) values (%L, %L, %L, %L)',
    :'r_leto', :'tenant', :'bar', '1'), '23514', 'nesedí'));


\echo ''
\echo '== 8. Přílohy ============================================'

select format('%s/%s/%s.pdf', :'tenant', :'perla', '10310000-cccc-0000-0000-000000000001') as cesta1 \gset
select format('%s/%s/%s.jpg', :'tenant', :'perla', '10310000-cccc-0000-0000-000000000002') as cesta2 \gset
select format('%s/%s/%s.pdf', :'tenant', :'perla', '10310000-cccc-0000-0000-000000000003') as cesta3 \gset
select format('%s/%s/%s.pdf', :'tenant', :'bar',   '10310000-cccc-0000-0000-000000000004') as cesta_bar \gset

set role authenticated;
select set_config('test.user_id', :'radka', false);
select pg_temp.check('Radka nahraje soubor do cesty Perly',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'cesta1', :'radka', '{"mimetype":"application/pdf","size":1234}')));
select pg_temp.check('… a druhý (fotka)',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'cesta2', :'radka', '{"mimetype":"image/jpeg","size":2000}')));
select pg_temp.check('… a třetí (PDF, na zkoušku typu)',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'cesta3', :'radka', '{"mimetype":"application/pdf","size":10}')));
select pg_temp.check('Radka nenahraje soubor do cesty Baru',
  not pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'cesta_bar', :'radka', '{"mimetype":"application/pdf","size":10}')));
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril (jen čtení) nenahraje nic',
  not pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', format('%s/%s/%s.pdf', :'tenant', :'perla', '10310000-cccc-0000-0000-000000000009'), :'cyril',
    '{"mimetype":"application/pdf","size":10}')));
select set_config('test.user_id', :'radka', false);

select public.rezervace_pripojit_prilohu(:'tenant', null, :'r1', null, :'cesta1', 'Smlouva/akce.pdf', 'application/pdf', 1234) as pr1 \gset
select public.rezervace_pripojit_prilohu(:'tenant', :'perla', null, '2026-11-20', :'cesta2', 'Plán sálu.jpg', 'image/jpeg', 2000) as pr2 \gset

select pg_temp.check('soubor, který v úložišti není, nejde připojit',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, null, %L, null, %L, %L, %L, %L)',
    :'tenant', :'r1', format('%s/%s/%s.pdf', :'tenant', :'perla', '10310000-cccc-0000-0000-00000000ffff'),
    'x.pdf', 'application/pdf', 10), '23514', 'v úložišti není'));
select pg_temp.check('typ rozhoduje úložiště: PDF vydávané za fotku neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, null, %L, null, %L, %L, %L, %L)',
    :'tenant', :'r1', :'cesta3', 'x.jpg', 'image/jpeg', 10), '23514', 'je jiný'));
select pg_temp.check('velikost rozhoduje úložiště',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, null, %L, null, %L, %L, %L, %L)',
    :'tenant', :'r1', :'cesta3', 'x.pdf', 'application/pdf', 99), '23514', 'je jiný'));
select pg_temp.check('cesta jiné pobočky k rezervaci Perly nesedí',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, null, %L, null, %L, %L, %L, %L)',
    :'tenant', :'r1', :'cesta_bar', 'x.pdf', 'application/pdf', 10), '23514', 'nesedí'));
select pg_temp.check('příloha k rezervaci i ke dni zároveň neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, %L, %L, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', :'r1', '2026-11-20', :'cesta3', 'x.pdf', 'application/pdf', 10), '23514', 'vyberte jedno'));

select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril soubor připojit nesmí',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, null, %L, null, %L, %L, %L, %L)',
    :'tenant', :'r1', :'cesta3', 'x.pdf', 'application/pdf', 10), '42501', 'přidat nemůžete'));
select pg_temp.check('Cyril připojený soubor čte (politika úložiště)',
  (select count(*) from storage.objects where bucket_id = 'rezervace' and name = :'cesta1') = 1);
select pg_temp.check('Cyril vidí přílohy k rezervaci i ke dni',
  (select count(*) from public.rezervace_prilohy where id in (:'pr1', :'pr2')) = 2);
select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára soubor Perly NEČTE',
  (select count(*) from storage.objects where bucket_id = 'rezervace' and name = :'cesta1') = 0);
select set_config('test.user_id', :'xaver', false);
select pg_temp.check('cizí firma soubor NEČTE',
  (select count(*) from storage.objects where bucket_id = 'rezervace' and name = :'cesta1') = 0);

select set_config('test.user_id', :'radka', false);
delete from storage.objects where bucket_id = 'rezervace' and name = :'cesta1';
reset role;
select pg_temp.check('připojený soubor smazat nejde (politika ho nepustí)',
  exists (select 1 from storage.objects where bucket_id = 'rezervace' and name = :'cesta1'));
set role authenticated;
select set_config('test.user_id', :'radka', false);
select public.rezervace_odebrat_prilohu(:'pr1') as odebrana_cesta \gset
delete from storage.objects where bucket_id = 'rezervace' and name = :'cesta1';
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('odebraná příloha vrátí cestu svého souboru',
  :'odebrana_cesta' = :'cesta1');
select pg_temp.check('odebraný soubor už smazat jde',
  not exists (select 1 from storage.objects where bucket_id = 'rezervace' and name = :'cesta1'));
select pg_temp.check('název přílohy je bez lomítek, typ a velikost z úložiště',
  (select nazev = 'Plán sálu.jpg' and mime = 'image/jpeg' and velikost = 2000 and den = date '2026-11-20'
     from public.rezervace_prilohy where id = :'pr2'));
select pg_temp.check('politiky kbelíku: čtení i zápis jen přes pobočku z cesty',
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'rezervace_soubory_%') = 3
  and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname like 'rezervace_%' and cmd = 'UPDATE'));
select pg_temp.check('kbelík je soukromý, 10 MB, jen fotky a PDF',
  (select not public and file_size_limit = 10485760
          and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
     from storage.buckets where id = 'rezervace'));


\echo ''
\echo '== 9. Import ze souboru ==================================='

select '[{"externi_id":"T-1","stav":"potvrzeno","stav_zdroje":"Confirmed","datum":"2026-11-21","od":"18:30","do":"","jmeno_hosta":"Dvořák Krok103","pocet_osob":"2","telefon":"","email":"dvorak@example.cz","poznamka":"u okna","prostor":"Stůl 5"},{"externi_id":"T-2","stav":"ceka","stav_zdroje":"Pending","datum":"2026-11-21","od":"20:00","do":"23:00","jmeno_hosta":"Malá Krok103","pocet_osob":"8","telefon":"+420 600 000 000","email":"","poznamka":"","prostor":""}]' as davka1 \gset

set role authenticated;
select set_config('test.user_id', :'radka', false);
select public.rezervace_importovat_csv(:'tenant', :'perla', 'tablein', :'davka1'::jsonb)::text as imp1 \gset
select public.rezervace_importovat_csv(:'tenant', :'perla', 'tablein', :'davka1'::jsonb)::text as imp2 \gset
reset role;
select id as t2 from public.rezervace where branch_id = :'perla' and poskytovatel = 'tablein' and externi_id = 'T-2' \gset

select pg_temp.check('první import: dvě nové rezervace',
  (:'imp1'::jsonb ->> 'nove')::int = 2 and (:'imp1'::jsonb ->> 'zmenene')::int = 0);
select pg_temp.check('tentýž soubor podruhé nic nezdvojí (2 beze změny)',
  (:'imp2'::jsonb ->> 'nove')::int = 0 and (:'imp2'::jsonb ->> 'beze_zmeny')::int = 2
  and (select count(*) from public.rezervace where poskytovatel = 'tablein' and externi_id in ('T-1', 'T-2')) = 2);
select pg_temp.check('importovaná rezervace: zdroj soubor, původní stav ze zdroje, čas podle pásma pobočky',
  (select zdroj = 'csv' and stav = 'ceka' and stav_zdroje = 'Pending'
          and zacatek = timestamptz '2026-11-21 20:00:00+01' and konec = timestamptz '2026-11-21 23:00:00+01'
     from public.rezervace where id = :'t2'));
select pg_temp.check('kontakt z importu je v tabulce kontaktů',
  (select telefon from public.rezervace_kontakty where rezervace_id = :'t2') = '+420 600 000 000');

set role authenticated;
select set_config('test.user_id', :'radka', false);
select pg_temp.check('u importované jde změnit, co patří Foodtabu (druh, typ akce, menu, prostor)',
  pg_temp.projde(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'tenant', :'t2',
    '{"druh":"akce","typ_akce":"Narozeniny","menu":"Raut","prostor":"Salonek"}')));
select pg_temp.check('u importované NEJDE změnit počet osob (patří zdroji)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'tenant', :'t2',
    '{"pocet_osob":"9"}'), '23514', 'mění tam'));
select pg_temp.check('u importované NEJDE změnit telefon',
  pg_temp.spadne_hlaskou(format('select public.rezervace_ulozit(%L, %L, null, %L::jsonb)', :'tenant', :'t2',
    '{"telefon":"1"}'), '23514', 'mění tam'));
select pg_temp.check('u importované NEJDE změnit stav',
  pg_temp.spadne_hlaskou(format('select public.rezervace_zmenit_stav(%L, %L)', :'t2', 'potvrzeno'), '23514', 'mění tam'));

select '[{"externi_id":"T-1","stav":"potvrzeno","stav_zdroje":"Confirmed","datum":"2026-11-21","od":"18:30","do":"","jmeno_hosta":"Dvořák Krok103","pocet_osob":"2","telefon":"","email":"dvorak@example.cz","poznamka":"u okna","prostor":"Stůl 5"},{"externi_id":"T-2","stav":"zrusena","stav_zdroje":"Cancelled","datum":"2026-11-21","od":"20:00","do":"23:00","jmeno_hosta":"Malá Krok103","pocet_osob":"10","telefon":"+420 600 000 001","email":"","poznamka":"zrušeno hostem","prostor":"Terasa"}]' as davka2 \gset
select public.rezervace_importovat_csv(:'tenant', :'perla', 'tablein', :'davka2'::jsonb)::text as imp3 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('změněný soubor: jedna změněná, jedna beze změny',
  (:'imp3'::jsonb ->> 'zmenene')::int = 1 and (:'imp3'::jsonb ->> 'beze_zmeny')::int = 1);
select pg_temp.check('údaje zdroje se přepsaly (stav, počet, poznámka hosta, telefon)',
  (select stav = 'zrusena' and stav_zdroje = 'Cancelled' and pocet_osob = 10 and poznamka_zdroje = 'zrušeno hostem'
     from public.rezervace where id = :'t2')
  and (select telefon from public.rezervace_kontakty where rezervace_id = :'t2') = '+420 600 000 001');
select pg_temp.check('údaje Foodtabu import NEPŘEPSAL (druh, typ akce, menu, vyplněný prostor)',
  (select druh = 'akce' and typ_akce = 'Narozeniny' and menu = 'Raut' and prostor = 'Salonek'
     from public.rezervace where id = :'t2'));
select pg_temp.check('zrušená rezervace zůstala i se svým řádkem (nic se nemaže)',
  (select count(*) from public.rezervace where id = :'t2') = 1);
select pg_temp.check('prostor ze zdroje se při založení převzal',
  (select prostor from public.rezervace where poskytovatel = 'tablein' and externi_id = 'T-1') = 'Stůl 5');

set role authenticated;
select set_config('test.user_id', :'radka', false);
select pg_temp.check('dávka je celá nebo nic: chybný řádek shodí i ten dobrý',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_csv(%L, %L, %L, %L::jsonb)', :'tenant', :'perla', 'tablein',
    '[{"externi_id":"T-3","datum":"2026-11-22","od":"18:00","jmeno_hosta":"Dobrý"},{"externi_id":"","datum":"2026-11-22","od":"18:00"}]'),
    '23514', 'bez čísla'));
select pg_temp.check('… a dobrý řádek se opravdu nezapsal',
  not exists (select 1 from public.rezervace where poskytovatel = 'tablein' and externi_id = 'T-3'));
select pg_temp.check('zdroj souboru musí být krátké jméno',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_csv(%L, %L, %L, %L::jsonb)', :'tenant', :'perla', 'Můj Systém',
    '[]'), '23514', 'krátké jméno'));
select pg_temp.check('Radka do Baru neimportuje',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_csv(%L, %L, %L, %L::jsonb)', :'tenant', :'bar', 'tablein',
    :'davka1'), '42501', 'importovat nemůžete'));
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril (jen čtení) neimportuje',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_csv(%L, %L, %L, %L::jsonb)', :'tenant', :'perla', 'tablein',
    :'davka1'), '42501', 'importovat nemůžete'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 10. Import ze zdroje (synchronizace) ================='

select pg_temp.check('připojení rezervací bez pobočky neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim) values (%L, null, %L, %L, %L)',
    :'tenant', 'rezervace', 'thefork', 'zakaznicky'), '23514', 'integrace_pripojeni_rezervace_pobocka'));

insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'thefork', 'zakaznicky', 'TheFork Krok103')
returning id as spoj \gset

select pg_temp.check('nové připojení čeká na připojení (nepripojeno), ne připojeno',
  (select stav from public.integrace_pripojeni where id = :'spoj') = 'nepripojeno');
select pg_temp.check('„připojeno" bez úspěšného testu nastavit nejde',
  pg_temp.spadne_hlaskou(format('update public.integrace_pripojeni set stav = %L where id = %L', 'pripojeno', :'spoj'),
    '23514', 'integrace_pripojeni_rezervace_overeno'));

select '[{"externi_id":"TF-1","stav":"potvrzeno","stav_zdroje":"RECORDED","zacatek":"2026-11-22T19:00:00+01:00","konec":"","zmeneno_kdy":"2026-11-01T10:00:00Z","jmeno_hosta":"Svoboda Krok103","pocet_osob":"3","telefon":"","email":"","poznamka":"","prostor":""}]' as api1 \gset

set role service_role;
select pg_temp.check('neověřené připojení data nepřijme',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'spoj', :'api1'),
    '23514', 'není ověřené'));
reset role;

update public.integrace_pripojeni
   set stav = 'pripojeno', posledni_test_ok = true, posledni_test_kdy = now()
 where id = :'spoj';

set role service_role;
select public.rezervace_importovat_zdroj(:'spoj', :'api1'::jsonb)::text as api_imp1 \gset
reset role;

select pg_temp.check('ověřené připojení zapíše novou rezervaci se zdrojem a připojením',
  (:'api_imp1'::jsonb ->> 'nove')::int = 1
  and (select zdroj = 'externi' and poskytovatel = 'thefork' and pripojeni_id = :'spoj'::uuid
              and zacatek = timestamptz '2026-11-22 19:00:00+01' and pocet_osob = 3 and prostor = ''
         from public.rezervace where poskytovatel = 'thefork' and externi_id = 'TF-1'));

set role service_role;
select pg_temp.check('čas ze zdroje bez pásma neprojde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'spoj',
    '[{"externi_id":"TF-2","zacatek":"2026-11-22T19:00:00","jmeno_hosta":"Bez pásma"}]'), '23514', 'nemá časové pásmo'));
select public.rezervace_importovat_zdroj(:'spoj',
  '[{"externi_id":"TF-1","stav":"potvrzeno","stav_zdroje":"RECORDED","zacatek":"2026-11-22T19:00:00+01:00","zmeneno_kdy":"2026-10-31T10:00:00Z","jmeno_hosta":"Svoboda Krok103","pocet_osob":"5"}]'::jsonb)::text as api_stare \gset
select public.rezervace_importovat_zdroj(:'spoj',
  '[{"externi_id":"TF-1","stav":"potvrzeno","stav_zdroje":"SEATED","zacatek":"2026-11-22T19:30:00+01:00","zmeneno_kdy":"2026-11-02T10:00:00Z","jmeno_hosta":"Svoboda Krok103","pocet_osob":"5","prostor":"Stůl 9"}]'::jsonb)::text as api_nove \gset
reset role;

select pg_temp.check('starší data (pozdě doručený webhook) novější nepřebijí',
  (:'api_stare'::jsonb ->> 'zastarale')::int = 1);
select pg_temp.check('novější data se zapíšou (čas, počet, původní stav)',
  (:'api_nove'::jsonb ->> 'zmenene')::int = 1
  and (select pocet_osob = 5 and stav_zdroje = 'SEATED' and zacatek = timestamptz '2026-11-22 19:30:00+01'
              and externi_zmeneno_kdy = timestamptz '2026-11-02 10:00:00Z' and prostor = 'Stůl 9'
         from public.rezervace where poskytovatel = 'thefork' and externi_id = 'TF-1'));


\echo ''
\echo '== 11. Stav napojení na obrazovce rezervací =============='

set role authenticated;
select set_config('test.user_id', :'cyril', false);
select pg_temp.check('Cyril (čte rezervace) vidí stav napojení Perly, i bez Financí',
  (select count(*) from public.rezervace_napojeni(:'tenant') where id = :'spoj' and stav = 'pripojeno') = 1);
select set_config('test.user_id', :'nora', false);
select pg_temp.check('Nora stav napojení nevidí',
  (select count(*) from public.rezervace_napojeni(:'tenant')) = 0);
select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára napojení Perly nevidí',
  (select count(*) from public.rezervace_napojeni(:'tenant') where id = :'spoj') = 0);
reset role;
select set_config('test.user_id', '', false);

update public.integrace_pripojeni set odpojeno_kdy = now(), stav = 'odpojeno' where id = :'spoj';
set role service_role;
select pg_temp.check('odpojené připojení už nic nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'spoj', :'api1'),
    'P0002', 'odpojené'));
reset role;


\echo ''
\echo '== 12. Granty ============================================'

select pg_temp.check('tabulky: přihlášený jen čte, anonym nic',
  (select bool_and(has_table_privilege('authenticated', 'public.' || t, 'select')
                   and not has_table_privilege('authenticated', 'public.' || t, 'insert')
                   and not has_table_privilege('authenticated', 'public.' || t, 'update')
                   and not has_table_privilege('authenticated', 'public.' || t, 'delete')
                   and not has_table_privilege('authenticated', 'public.' || t, 'truncate')
                   and not has_table_privilege('anon', 'public.' || t, 'select'))
     from unnest(array['rezervace', 'rezervace_kontakty', 'rezervace_poznamky', 'rezervace_prilohy']) t));

select pg_temp.check('funkce pro obrazovku smí přihlášený, anonym ne (9 funkcí)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('rezervace_ulozit', 'rezervace_zmenit_stav', 'rezervace_pridat_poznamku',
                        'rezervace_upravit_poznamku', 'rezervace_smazat_poznamku', 'rezervace_pripojit_prilohu',
                        'rezervace_odebrat_prilohu', 'rezervace_importovat_csv', 'rezervace_napojeni')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 9);

select pg_temp.check('zápis ze zdroje jen server (service_role), přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_importovat_zdroj(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_importovat_zdroj(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_importovat_zdroj(uuid, jsonb)', 'execute'));

select pg_temp.check('vnitřní funkce (zápis řádků, převod času, cíl) zvenku nevolá nikdo',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('rezervace_zapsat_radky', 'rezervace_okamzik', 'rezervace_okamzik_zdroje',
                        'rezervace_cil', 'rezervace_datum', 'rezervace_hodina', 'rezervace_cele_cislo')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')) = 7);


\echo ''
\echo '== 13. Audit ============================================='

select pg_temp.check('založení rezervace je v auditu',
  exists (select 1 from public.audit_log where entity_type = 'rezervace' and entity_id = :'r1'));
select pg_temp.check('poznámka je v auditu',
  exists (select 1 from public.audit_log where entity_type = 'rezervace_poznamka' and entity_id = :'p_rez'));
select pg_temp.check('kontakt hosta se do auditu NEROZKOPÍROVAL',
  not exists (select 1 from public.audit_log
               where entity_type = 'rezervace_kontakty'
                  or after::text like '%777 111 222%' or before::text like '%777 111 222%'));


\echo ''
\echo '== Úklid ================================================='

select set_config('test.user_id', '', false);

delete from public.rezervace_prilohy where tenant_id = :'tenant'
   and (rezervace_id in (select id from public.rezervace where jmeno_hosta like '%Krok103' or nazev like '%Krok103')
        or (den = date '2026-11-20' and branch_id = :'perla'));
delete from storage.objects where bucket_id = 'rezervace' and name in (:'cesta1', :'cesta2', :'cesta3', :'cesta_bar');
delete from public.rezervace_poznamky where id in (:'p_den', :'p_rez');
delete from public.rezervace_kontakty
 where rezervace_id in (select id from public.rezervace where jmeno_hosta like '%Krok103' or nazev like '%Krok103');
delete from public.rezervace where jmeno_hosta like '%Krok103' or nazev like '%Krok103';
delete from public.integrace_pripojeni where id = :'spoj';
delete from public.membership_branches
 where membership_id in (select id from public.memberships where user_id in (:'radka', :'cyril', :'nora', :'bara', :'xaver'));
delete from public.memberships where user_id in (:'radka', :'cyril', :'nora', :'bara', :'xaver');
delete from public.employees where id in (:'e_radka', :'e_cyril', :'e_nora', :'e_bara', :'e_xaver');
delete from public.position_permissions where position_id in (:'z_zapis', :'z_cteni');
delete from public.positions where id in (:'z_zapis', :'z_cteni');

select pg_temp.check('úklid: po scénáři nezůstala žádná rezervace ani člověk z kroku 103',
  not exists (select 1 from public.rezervace where jmeno_hosta like '%Krok103' or nazev like '%Krok103')
  and not exists (select 1 from public.employees where full_name like '%Stopetrojka')
  and not exists (select 1 from storage.objects where bucket_id = 'rezervace'));

\echo ''
\echo '== KROK 103 HOTOV ========================================'
