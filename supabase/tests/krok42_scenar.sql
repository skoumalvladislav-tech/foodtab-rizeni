-- Scénář pro krok 42 — Notification Service (Provozní centrum, etapa 1).
--
-- Pokrývá migraci 20260921100000_notifikacni_sluzba.
--
-- Navazuje na etapa0_scenar.sql až krok41_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Hlavní past téhle změny je dvojí upozornění: kdyby stará cesta
-- (přímý insert v triggeru) zůstala vedle nové (app.notifikovat), člověk
-- by na jednu událost dostal dvě. Proto se u každého producenta ověřuje
-- PŘESNÝ POČET (jedno, ne „aspoň jedno“) a scénář se schválně rozbíjí
-- druhým insertem — viz docs/COMMUNICATION_ARCHITECTURE.md, oddíl 6.
--
-- Druhá past: kontrola oprávnění nad definer funkcí. Uvnitř
-- app.notifikovat neplatí RLS, takže cizí firmu a smazaného zaměstnance
-- musí vyřadit funkce sama — oddíl 1 to zkouší SKUTEČNÝM uživatelem cizí
-- firmy, ne jen neexistujícím id.
--
-- Kontroly nejsou postavené na čtení pod rolí (`set role authenticated`
-- na superuživateli PGlite nic nedělá), ale na výsledku v tabulkách a na
-- katalogu práv (has_column_privilege), který funguje v PGlite i v ostré
-- databázi stejně.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Zavolá SQL a vrátí, jestli spadlo s daným SQLSTATE A hláškou obsahující text:
-- spadnout musí TA větev, kterou zkoušíme, ne jiná kontrola se stejným kódem.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

-- Kolik nepřečtených upozornění daného druhu člověk má.
create or replace function pg_temp.pocet(p_user uuid, p_druh text)
returns integer language sql as $$
  select count(*)::integer from public.notifications
   where user_id = p_user and druh = p_druh and read_at is null
$$;

-- Počet zpráv, který upozornění nese (telo.pocet); bez počtu 1.
create or replace function pg_temp.zprav(p_user uuid, p_druh text)
returns integer language sql as $$
  select coalesce(sum(coalesce((telo->>'pocet')::integer, 1)), 0)::integer
    from public.notifications
   where user_id = p_user and druh = p_druh and read_at is null
$$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

insert into auth.users (id, email, raw_user_meta_data) values
  ('42420000-0000-0000-0000-00000000000a', 'anna42@foodtab.cz',  '{"full_name":"Anna Čtyřicet"}'),
  ('42420000-0000-0000-0000-00000000000b', 'borek42@foodtab.cz', '{"full_name":"Bořek Čtyřicet"}'),
  ('42420000-0000-0000-0000-00000000000c', 'cyril42@foodtab.cz', '{"full_name":"Cyril Čtyřicet"}'),
  ('42420000-0000-0000-0000-00000000000d', 'dana42@foodtab.cz',  '{"full_name":"Dana Čtyřicet"}'),
  ('42420000-0000-0000-0000-00000000000e', 'emil42@foodtab.cz',  '{"full_name":"Emil Čtyřicet"}'),
  ('42420000-0000-0000-0000-00000000000f', 'fero42@foodtab.cz',  '{"full_name":"Fero Čtyřicet"}'),
  ('42420000-0000-0000-0000-000000000010', 'gita42@foodtab.cz',  '{"full_name":"Gita Čtyřicet"}'),
  ('42420000-0000-0000-0000-000000000011', 'hugo42@foodtab.cz',  '{"full_name":"Hugo Smazaný"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

-- Úseky firemní (branch_id null): kanál úseku spojuje lidi napříč pobočkami.
insert into public.useky (tenant_id, branch_id, nazev, poradi) values
  (:'tenant', null, 'Kuchyně — krok42', 920),
  (:'tenant', null, 'Bar — krok42', 921);

select id as usek_kuchyne from public.useky
 where tenant_id = :'tenant' and nazev = 'Kuchyně — krok42' \gset
select id as usek_bar from public.useky
 where tenant_id = :'tenant' and nazev = 'Bar — krok42' \gset

-- Anna, Bořek, Emil: Perla + Kuchyně. Cyril: Bar + Bar. Dana: Perla bez úseku.
-- Fero a Gita: Perla, slouží jen k pokusům s push. Hugo: smazaný zaměstnanec.
insert into public.employees (tenant_id, branch_id, usek_id, user_id, full_name, employment_type, deleted_at) values
  (:'tenant', :'perla', :'usek_kuchyne', '42420000-0000-0000-0000-00000000000a', 'Anna Čtyřicet',  'hpp', null),
  (:'tenant', :'perla', :'usek_kuchyne', '42420000-0000-0000-0000-00000000000b', 'Bořek Čtyřicet', 'hpp', null),
  (:'tenant', :'bar',   :'usek_bar',     '42420000-0000-0000-0000-00000000000c', 'Cyril Čtyřicet', 'hpp', null),
  (:'tenant', :'perla', null,            '42420000-0000-0000-0000-00000000000d', 'Dana Čtyřicet',  'hpp', null),
  (:'tenant', :'perla', :'usek_kuchyne', '42420000-0000-0000-0000-00000000000e', 'Emil Čtyřicet',  'hpp', null),
  (:'tenant', :'perla', null,            '42420000-0000-0000-0000-00000000000f', 'Fero Čtyřicet',  'hpp', null),
  (:'tenant', :'perla', null,            '42420000-0000-0000-0000-000000000010', 'Gita Čtyřicet',  'hpp', null),
  (:'tenant', :'perla', null,            '42420000-0000-0000-0000-000000000011', 'Hugo Smazaný',   'hpp', now());

select id as anna  from public.employees where user_id = '42420000-0000-0000-0000-00000000000a' \gset
select id as borek from public.employees where user_id = '42420000-0000-0000-0000-00000000000b' \gset
select id as cyril from public.employees where user_id = '42420000-0000-0000-0000-00000000000c' \gset
select id as dana  from public.employees where user_id = '42420000-0000-0000-0000-00000000000d' \gset
select id as emil  from public.employees where user_id = '42420000-0000-0000-0000-00000000000e' \gset
select id as fero  from public.employees where user_id = '42420000-0000-0000-0000-00000000000f' \gset
select id as gita  from public.employees where user_id = '42420000-0000-0000-0000-000000000010' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
select :'tenant', u, :'role_kuchyne', 'branch', 'active'
from (values
  ('42420000-0000-0000-0000-00000000000a'::uuid),
  ('42420000-0000-0000-0000-00000000000b'::uuid),
  ('42420000-0000-0000-0000-00000000000c'::uuid),
  ('42420000-0000-0000-0000-00000000000d'::uuid),
  ('42420000-0000-0000-0000-00000000000e'::uuid),
  ('42420000-0000-0000-0000-00000000000f'::uuid),
  ('42420000-0000-0000-0000-000000000010'::uuid)
) t(u);

insert into public.membership_branches (membership_id, branch_id)
select m.id,
       case when m.user_id = '42420000-0000-0000-0000-00000000000c'::uuid then :'bar'::uuid
            else :'perla'::uuid end
  from public.memberships m
 where m.user_id::text like '42420000-%' and m.tenant_id = :'tenant';

-- Anna a Bořek střídají směny i na baru (oddíl 8: dvě směny jednoho dne).
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'bar'::uuid
  from public.memberships m
 where m.user_id in ('42420000-0000-0000-0000-00000000000a', '42420000-0000-0000-0000-00000000000b')
   and m.tenant_id = :'tenant';

-- Cizí firma: člověk z etapa0 (cizi@jinafirma.cz) je v ní zaměstnanec. Bez
-- toho by ho z naší firmy vyřadil už neexistující zaměstnanecký záznam,
-- ne kontrola firmy, a test by prošel i nad funkcí bez filtru firmy
-- (schválné rozbití to prozradilo).
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok42 Cizí s.r.o.', 'Krok42 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset

insert into public.employees (tenant_id, user_id, full_name, employment_type)
values (:'cizi_firma', :'cizi', 'Krok42 Cizí zaměstnanec', 'hpp');

-- ... a v cizí firmě je AKTIVNÍM členem (upozornění dostává jen aktivní člen).
insert into public.roles (tenant_id, key, label)
values (:'cizi_firma', 'krok42cizi', 'Krok42 cizí role')
returning id as cizi_role \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'cizi_firma', :'cizi', :'cizi_role', 'branch', 'active');

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 0. Práva: co smí klient a co ne ======================='

-- Katalog práv platí i v PGlite (superuživatel to neobejde, protože se
-- ptáme na roli authenticated, ne na sebe).
select pg_temp.check('authenticated nemá UPDATE na celé tabulce notifications',
  not has_table_privilege('authenticated', 'public.notifications', 'update'));
select pg_temp.check('authenticated smí měnit read_at',
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'));
select pg_temp.check('authenticated smí měnit acknowledged_at',
  has_column_privilege('authenticated', 'public.notifications', 'acknowledged_at', 'update'));
select pg_temp.check('authenticated NESMÍ měnit telo',
  not has_column_privilege('authenticated', 'public.notifications', 'telo', 'update'));
select pg_temp.check('authenticated NESMÍ měnit druh',
  not has_column_privilege('authenticated', 'public.notifications', 'druh', 'update'));
select pg_temp.check('authenticated NESMÍ měnit prioritu',
  not has_column_privilege('authenticated', 'public.notifications', 'priorita', 'update'));
select pg_temp.check('authenticated NESMÍ měnit dedupe_key',
  not has_column_privilege('authenticated', 'public.notifications', 'dedupe_key', 'update'));
select pg_temp.check('authenticated NESMÍ měnit user_id ani tenant_id',
  not has_column_privilege('authenticated', 'public.notifications', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'tenant_id', 'update'));

select pg_temp.check('push_odbery: klient nemá žádné právo (klíče zařízení)',
  not has_any_column_privilege('authenticated', 'public.push_odbery', 'select')
  and not has_any_column_privilege('anon', 'public.push_odbery', 'select')
  and not has_table_privilege('authenticated', 'public.push_odbery', 'insert'));
select pg_temp.check('notifikace_doruceni: klient nemá žádné právo',
  not has_any_column_privilege('authenticated', 'public.notifikace_doruceni', 'select')
  and not has_any_column_privilege('anon', 'public.notifikace_doruceni', 'select'));
select pg_temp.check('service_role na obě tabulky smí',
  has_table_privilege('service_role', 'public.push_odbery', 'select')
  and has_table_privilege('service_role', 'public.notifikace_doruceni', 'update'));

select pg_temp.check('app.notifikovat nesmí volat klient',
  not has_function_privilege('authenticated',
    'app.notifikovat(uuid, uuid, text, jsonb, text, uuid, uuid, text, uuid, text)', 'execute')
  and not has_function_privilege('anon',
    'app.notifikovat(uuid, uuid, text, jsonb, text, uuid, uuid, text, uuid, text)', 'execute'));
select pg_temp.check('app.uvolnit_cekajici smí jen service_role',
  not has_function_privilege('authenticated', 'app.uvolnit_cekajici(uuid)', 'execute')
  and has_function_privilege('service_role', 'app.uvolnit_cekajici(uuid)', 'execute'));
select pg_temp.check('push_odber_ulozit smí přihlášený, ne anon',
  has_function_privilege('authenticated', 'public.push_odber_ulozit(text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.push_odber_ulozit(text, text, text, text)', 'execute'));

select pg_temp.check('priorita low se do tabulky vejde',
  (select count(*) from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_priorita_check'
      and pg_get_constraintdef(oid) like '%low%') = 1);


\echo ''
\echo '== 1. app.notifikovat: příjemce ========================='

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000a', 'test.zaklad',
  '{"x":1}'::jsonb, 'normal', null, null, 'zprava', gen_random_uuid(), null) as n1 \gset

select pg_temp.check('aktivní člen firmy dostane upozornění (vrací id)', :'n1' <> '');
select pg_temp.check('upozornění nese druh, telo, zdroj',
  (select druh = 'test.zaklad' and telo = '{"x":1}'::jsonb and zdroj_typ = 'zprava'
          and zdroj_id is not null and priorita = 'normal'
     from public.notifications where id = :'n1'));

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000a', 'test.zaklad', '{}'::jsonb,
  'ultra-hyper') as n_spatna \gset
select pg_temp.check('neznámá priorita se bere jako normal (upozornění nezmizí)',
  (select priorita from public.notifications where id = :'n_spatna') = 'normal');

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000a', 'test.zaklad', '{}'::jsonb,
  'low') as n_low \gset
select pg_temp.check('priorita low je přijatá',
  (select priorita from public.notifications where id = :'n_low') = 'low');

select pg_temp.check('příprava: cizi je zaměstnanec JINÉ firmy (jinak by test nic neměřil)',
  exists (select 1 from public.employees where user_id = :'cizi' and tenant_id = :'cizi_firma')
  and not exists (select 1 from public.employees where user_id = :'cizi' and tenant_id = :'tenant'));
select pg_temp.check('zaměstnanec JINÉ firmy upozornění v naší firmě nedostane (definer nemá RLS)',
  app.notifikovat(:'tenant', :'cizi', 'test.cizi', '{}'::jsonb) is null
  and not exists (select 1 from public.notifications where druh = 'test.cizi'));
select pg_temp.check('a ve své vlastní firmě upozornění dostane (filtr firmy není příliš přísný)',
  app.notifikovat(:'cizi_firma', :'cizi', 'test.cizi.vlastni', '{}'::jsonb) is not null);

-- Pozastavené členství: přístup do aplikace je zavřený (has_access, modul_zapnuty),
-- zaměstnanecký řádek ale zůstává. Upozornění — a hlavně push na zamčenou
-- obrazovku telefonu — mu chodit nemá.
update public.memberships set status = 'suspended'
 where user_id = :'cizi' and tenant_id = :'cizi_firma';
select app.notifikovat(:'cizi_firma', :'cizi', 'test.cizi.pozastaveny', '{}'::jsonb);
select pg_temp.check('pozastavené členství upozornění nedostane',
  not exists (select 1 from public.notifications where druh = 'test.cizi.pozastaveny'));
update public.memberships set status = 'active'
 where user_id = :'cizi' and tenant_id = :'cizi_firma';
select app.notifikovat(:'cizi_firma', :'cizi', 'test.cizi.obnoveny', '{}'::jsonb);
select pg_temp.check('po obnovení členství upozornění zase dostane',
  exists (select 1 from public.notifications where druh = 'test.cizi.obnoveny'));

select pg_temp.check('smazaný zaměstnanec upozornění nedostane',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000011', 'test.smazany', '{}'::jsonb) is null
  and not exists (select 1 from public.notifications where druh = 'test.smazany'));

select pg_temp.check('neexistující člověk upozornění nedostane',
  app.notifikovat(:'tenant', gen_random_uuid(), 'test.nikdo', '{}'::jsonb) is null);

select pg_temp.check('prázdný druh se nezaloží',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000a', '', '{}'::jsonb) is null);


\echo ''
\echo '== 2. Přepínače kategorií ================================'

insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', '42420000-0000-0000-0000-00000000000b', 'vzkazy', false),
       (:'tenant', '42420000-0000-0000-0000-00000000000b', 'nastenka', false);

select pg_temp.check('vypnutá kategorie vzkazy: běžný vzkaz se nezaloží',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000b', 'vzkaz.novy', '{}'::jsonb) is null);
select pg_temp.check('vypnutá kategorie nástěnka: oznámení se nezaloží',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000b', 'oznameni.nova', '{}'::jsonb) is null);
select pg_temp.check('URGENTNÍ vzkaz se vypnutím nepotlačí',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000b', 'vzkaz.novy', '{}'::jsonb, 'urgent') is not null);
select pg_temp.check('směny se vypnout nedají (žádná kategorie)',
  app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000b', 'smena.nova', '{}'::jsonb) is not null);

delete from public.notifications where user_id = '42420000-0000-0000-0000-00000000000b';
delete from public.notification_preferences where user_id = '42420000-0000-0000-0000-00000000000b';


\echo ''
\echo '== 3. Slučování ========================================='

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.sluc',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:sluc') \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.sluc',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:sluc') \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.sluc',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:sluc') \gset

select pg_temp.check('tři upozornění se stejným klíčem = jedno nepřečtené',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000e', 'test.sluc') = 1);
select pg_temp.check('a nese počet 3',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000e', 'test.sluc') = 3);

update public.notifications set read_at = now()
 where user_id = '42420000-0000-0000-0000-00000000000e' and druh = 'test.sluc';
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.sluc',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:sluc') \gset

select pg_temp.check('přečtené se nenahrazuje — po přečtení vzniká nové',
  (select count(*) from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000e' and druh = 'test.sluc') = 2
  and pg_temp.zprav('42420000-0000-0000-0000-00000000000e', 'test.sluc') = 1);

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.sluc',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:jiny') \gset
select pg_temp.check('jiný klíč se neslučuje',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000e', 'test.sluc') = 2);

-- Priorita při slučování: nahrazující upozornění nese AKTUÁLNÍ prioritu
-- (rozhodnutí z kroku 35, oddíl 5 — odznak nesmí zůstat trvale poplašný
-- po jediné naléhavé zprávě). Naléhavá zpráva samotná zůstává v rozhovoru
-- označená a její push odešel hned při vzniku.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.prio',
  '{}'::jsonb, 'urgent', null, null, null, null, 'k:prio') \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.prio',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:prio') \gset
select pg_temp.check('po sloučení nese upozornění poslední prioritu (normal), ne starou urgentní',
  (select priorita from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000e' and druh = 'test.prio' and read_at is null) = 'normal');

select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.prio2',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:prio2') \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000e', 'test.prio2',
  '{}'::jsonb, 'important', null, null, null, null, 'k:prio2') \gset
select pg_temp.check('a naopak: důležitá po běžné je důležitá (jde vždy o poslední)',
  (select priorita from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000e' and druh = 'test.prio2' and read_at is null) = 'important');


\echo ''
\echo '== 4. Kanál: kdy se externí oznámení odešle a kdy čeká ======'

-- Bez předplatného se do fronty nezakládá nic — není komu posílat.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.bezpush',
  '{}'::jsonb, 'normal') as n_bez \gset
select pg_temp.check('bez předplatného push se nezakládá nic',
  not exists (select 1 from public.notifikace_doruceni where notification_id = :'n_bez'));

insert into public.push_odbery (user_id, endpoint, p256dh, auth_secret)
values ('42420000-0000-0000-0000-00000000000f', 'https://push.example/fero', 'p256dh-fero-0123456789', 'auth-fero-0123'),
       ('42420000-0000-0000-0000-000000000010', 'https://push.example/gita', 'p256dh-gita-0123456789', 'auth-gita-0123');

-- Fero NENÍ v práci.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.push.normal',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:f1') as f_normal \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.push.urgent',
  '{}'::jsonb, 'urgent', null, null, null, null, 'k:f2') as f_urgent \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.push.low',
  '{}'::jsonb, 'low', null, null, null, null, 'k:f3') as f_low \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.push.important',
  '{"pocet":2}'::jsonb, 'important', null, null, null, null, 'k:f4') as f_important \gset

select pg_temp.check('mimo směnu: normální čeká na směnu',
  (select stav from public.notifikace_doruceni where notification_id = :'f_normal') = 'ceka_na_smenu');
select pg_temp.check('mimo směnu: důležitá taky čeká (jen naléhavá obchází)',
  (select stav from public.notifikace_doruceni where notification_id = :'f_important') = 'ceka_na_smenu');
select pg_temp.check('mimo směnu: NALÉHAVÁ jde hned',
  (select stav from public.notifikace_doruceni where notification_id = :'f_urgent') = 'k_odeslani');
select pg_temp.check('low nemá žádný externí kanál',
  not exists (select 1 from public.notifikace_doruceni where notification_id = :'f_low'));
select pg_temp.check('záznam v aplikaci vzniká i mimo směnu',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000f', 'test.push.normal') = 1
  and pg_temp.pocet('42420000-0000-0000-0000-00000000000f', 'test.push.low') = 1);
select pg_temp.check('fronta nese počet zpráv z upozornění',
  (select pocet from public.notifikace_doruceni where notification_id = :'f_important') = 2);

-- Vypnuté předplatné se nepočítá.
update public.push_odbery set vypnuto_kdy = now() where endpoint = 'https://push.example/gita';
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.vypnuto',
  '{}'::jsonb, 'normal') as g_vyp \gset
select pg_temp.check('vypnuté předplatné = žádná fronta',
  not exists (select 1 from public.notifikace_doruceni where notification_id = :'g_vyp'));
update public.push_odbery set vypnuto_kdy = null where endpoint = 'https://push.example/gita';

-- Gita píchne příchod: normální jde hned.
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'in') \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.na.smene',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:g1') as g_smena \gset
select pg_temp.check('NA směně: normální jde hned',
  (select stav from public.notifikace_doruceni where notification_id = :'g_smena') = 'k_odeslani');
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'out') \gset

-- Píchnutí téhož druhu do dvou minut se bere jako totéž (app.pichnout), takže
-- první Gitinu směnu posuneme o hodinu do minulosti — jinak by druhý příchod
-- v oddíle 5 nevznikl a kontrola by měřila něco jiného.
update public.attendance_events
   set occurred_at = occurred_at - interval '1 hour'
 where employee_id = :'gita';


\echo ''
\echo '== 5. Po příchodu na směnu ================================'

-- Fero: má 2 čekající (normal, important). Přidáme ještě jedno, ať je co
-- slučovat.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-00000000000f', 'test.push.dalsi',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:f5') \gset

select pg_temp.check('Fero má 3 čekající, pořád mimo směnu',
  (select count(*) from public.notifikace_doruceni d
    where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.stav = 'ceka_na_smenu') = 3);

select pg_temp.check('mimo směnu uvolnění nic neudělá (vrací 0 lidí kromě těch v práci)',
  app.uvolnit_cekajici(:'tenant') = 0
  and (select count(*) from public.notifikace_doruceni d
        where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.stav = 'ceka_na_smenu') = 3);

select udalost from app.pichnout(:'tenant', :'perla', :'fero', 'in') \gset

select pg_temp.check('po příchodu se uvolní jeden člověk',
  app.uvolnit_cekajici(:'tenant') = 1);

select pg_temp.check('tři čekající se sloučily (nepípne třikrát)',
  (select count(*) from public.notifikace_doruceni d
    where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.stav = 'sloucene') = 3
  and (select count(*) from public.notifikace_doruceni d
        where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.stav = 'ceka_na_smenu') = 0);

select pg_temp.check('vznikl jeden souhrn „Čekají na vás N zpráv“, N = 1 + 2 + 1 = 4',
  (select count(*) from public.notifikace_doruceni d
    where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.typ = 'souhrn'
      and d.stav = 'k_odeslani' and d.pocet = 4 and d.notification_id is null) = 1);

select pg_temp.check('opakované uvolnění nic nezdvojí',
  app.uvolnit_cekajici(:'tenant') = 0
  and (select count(*) from public.notifikace_doruceni d
        where d.user_id = '42420000-0000-0000-0000-00000000000f' and d.typ = 'souhrn') = 1);

select udalost from app.pichnout(:'tenant', :'perla', :'fero', 'out') \gset

-- Jediné čekající se nesluje do souhrnu, posílá se samo.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.jedina',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:g2') as g_jedina \gset
select pg_temp.check('Gita mimo směnu: jediná čeká',
  (select stav from public.notifikace_doruceni where notification_id = :'g_jedina') = 'ceka_na_smenu');
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'in') \gset
select app.uvolnit_cekajici(:'tenant') \gset
select pg_temp.check('jediné čekající se po příchodu uvolní samo, bez souhrnu',
  (select stav from public.notifikace_doruceni where notification_id = :'g_jedina') = 'k_odeslani'
  and not exists (select 1 from public.notifikace_doruceni
                   where user_id = '42420000-0000-0000-0000-000000000010' and typ = 'souhrn'));
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'out') \gset

-- Propadlé čekání (starší než 48 h) se neposílá jako novinka.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.stare',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:g3') as g_stare \gset
update public.notifikace_doruceni set created_at = now() - interval '3 days'
 where notification_id = :'g_stare';
select app.uvolnit_cekajici(:'tenant') \gset
select pg_temp.check('čekání starší než 48 h propadne (v aplikaci zůstává)',
  (select stav from public.notifikace_doruceni where notification_id = :'g_stare') = 'zruseno'
  and pg_temp.pocet('42420000-0000-0000-0000-000000000010', 'test.stare') = 1);

-- Nahrazení upozornění ruší čekající doručení toho původního.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.nahrada',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g4') as g_puv \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.nahrada',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g4') as g_nove \gset
select pg_temp.check('nahrazené upozornění nenechá viset čekající push',
  (select count(*) from public.notifikace_doruceni d
    where d.user_id = '42420000-0000-0000-0000-000000000010' and d.stav = 'ceka_na_smenu'
      and d.notification_id = :'g_nove') = 1
  and not exists (select 1 from public.notifikace_doruceni d
                   where d.notification_id = :'g_puv' and d.stav in ('ceka_na_smenu', 'k_odeslani')));
select pg_temp.check('nové čekající nese součet zpráv (2)',
  (select pocet from public.notifikace_doruceni where notification_id = :'g_nove') = 2);

-- NALÉHAVÝ push, který ještě neodešel, nesmí zmizet kvůli další běžné zprávě
-- téhož klíče (sloučení by ho nahradilo čekáním na příchod).
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.uslah',
  '{"pocet":1}'::jsonb, 'urgent', null, null, null, null, 'k:g5') as g_urg \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.uslah',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g5') as g_pot \gset
select pg_temp.check('naléhavé upozornění s neodeslaným pushem se sloučením nezrušilo',
  exists (select 1 from public.notifications where id = :'g_urg')
  and (select stav from public.notifikace_doruceni where notification_id = :'g_urg') = 'k_odeslani');
select pg_temp.check('běžná zpráva čeká na příchod vedle něj a nese počet jen sama sebe',
  (select stav from public.notifikace_doruceni where notification_id = :'g_pot') = 'ceka_na_smenu'
  and (select pocet from public.notifikace_doruceni where notification_id = :'g_pot') = 1);

-- Až naléhavý push odejde (worker), sloučení ho už smí nahradit jako každé jiné.
update public.notifikace_doruceni set stav = 'odeslano' where notification_id = :'g_urg';
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.uslah',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g5') as g_pot2 \gset
select pg_temp.check('odeslané naléhavé upozornění se slučuje jako každé jiné',
  not exists (select 1 from public.notifications where id = :'g_urg')
  and (select pocet from public.notifikace_doruceni where notification_id = :'g_pot2') = 3);
update public.notifikace_doruceni set stav = 'zruseno'
 where user_id = '42420000-0000-0000-0000-000000000010' and stav = 'ceka_na_smenu'
   and notification_id in (select id from public.notifications where druh = 'test.uslah');

-- Přečtené upozornění se po příchodu nepřipomíná.
-- (Zbytek čekajících z předchozích kontrol se zruší, ať se počítá jen s těmi dvěma.)
update public.notifikace_doruceni set stav = 'zruseno'
 where user_id = '42420000-0000-0000-0000-000000000010' and stav = 'ceka_na_smenu';
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.prectene',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:g6') as g_prec \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.nepr',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:g7') as g_nepr \gset
update public.notifications set read_at = now() where id = :'g_prec';
-- Píchnutí téhož druhu do dvou minut se bere jako totéž (app.pichnout): dřívější
-- Gitiny příchody se posunou o hodinu zpět, ať tenhle příchod opravdu vznikne.
update public.attendance_events
   set occurred_at = occurred_at - interval '1 hour'
 where employee_id = :'gita';
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'in') \gset
select app.uvolnit_cekajici(:'tenant') \gset
select pg_temp.check('po příchodu se nepřipomene, co si Gita už přečetla',
  (select stav from public.notifikace_doruceni where notification_id = :'g_prec') = 'zruseno');
select pg_temp.check('nepřečtené čekající se po příchodu uvolní samo',
  (select stav from public.notifikace_doruceni where notification_id = :'g_nepr') = 'k_odeslani');
select pg_temp.check('… a nevznikl kvůli tomu žádný souhrn (přečtené se do něj nezapočítá)',
  not exists (select 1 from public.notifikace_doruceni
               where user_id = '42420000-0000-0000-0000-000000000010' and typ = 'souhrn'));

-- Gita je teď na směně: běžná zpráva čeká na odeslání (k_odeslani) a další téhož
-- klíče ji nahradí. Chrání se JEN naléhavé — jinak by se u každého pípnutí
-- hromadila stará upozornění vedle nových.
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.nasmene',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g8') as g_a \gset
select app.notifikovat(:'tenant', '42420000-0000-0000-0000-000000000010', 'test.nasmene',
  '{"pocet":1}'::jsonb, 'normal', null, null, null, null, 'k:g8') as g_b \gset
select pg_temp.check('na směně: nahrazená běžná zpráva se nezachovává (chrání se jen naléhavé)',
  not exists (select 1 from public.notifications where id = :'g_a')
  and (select stav from public.notifikace_doruceni where notification_id = :'g_b') = 'k_odeslani'
  and (select count(*) from public.notifikace_doruceni d
        where d.user_id = '42420000-0000-0000-0000-000000000010' and d.stav = 'k_odeslani'
          and d.notification_id in (select id from public.notifications where druh = 'test.nasmene')) = 1);
select udalost from app.pichnout(:'tenant', :'perla', :'gita', 'out') \gset


\echo ''
\echo '== 6. Producent: nový vzkaz — přesně jedno upozornění ======='

-- Osobní rozhovor: Bořek píše Anně.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000b', false);
set role authenticated;

select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Krok42 osobní', null,
  array[:'anna']::uuid[]) as osobni \gset
select public.poslat_zpravu(:'osobni', 'Krok42: přines nože.') as z1 \gset

reset role;

select pg_temp.check('osobní: Anna dostala právě JEDNO upozornění',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'vzkaz.novy') = 1);
select pg_temp.check('osobní: autor sám sobě nic',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 0);
select pg_temp.check('osobní: nezúčastněná Dana nic',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000d', 'vzkaz.novy') = 0);
select pg_temp.check('upozornění nese zdroj = zpráva, ale ne její text',
  (select zdroj_typ = 'zprava' and zdroj_id = :'z1'
          and telo::text not like '%nože%'
     from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000a' and druh = 'vzkaz.novy'));

-- Kanál POBOČKY: Anna píše všem na Perle. Emil z něj odešel, Cyril je na baru.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;

select public.kanal_pobocky(:'tenant', :'perla') as kanal_p \gset

reset role;

insert into public.konverzace_ucastnici (konverzace_id, employee_id, odesel_kdy)
values (:'kanal_p', :'emil', now());

select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.poslat_zpravu(:'kanal_p', 'Krok42: porada v 15:00.') as z2 \gset
reset role;

select pg_temp.check('kanál pobočky: Bořek (Perla) upozornění dostal, ač kanál nikdy neotevřel',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 1);
select pg_temp.check('kanál pobočky: Dana (Perla) taky',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000d', 'vzkaz.novy') = 1);
select pg_temp.check('kanál pobočky: Emil, který kanál OPUSTIL, ne',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000e', 'vzkaz.novy') = 0);
select pg_temp.check('kanál pobočky: Cyril z Baru ne',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000c', 'vzkaz.novy') = 0);
select pg_temp.check('kanál pobočky: autorka sama sobě nic navíc (má jen osobní od Bořka)',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'vzkaz.novy') = 1
  and pg_temp.zprav('42420000-0000-0000-0000-00000000000a', 'vzkaz.novy') = 1);

-- Kanál ÚSEKU Kuchyně: spojuje Perlu i Bar; Anna píše.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.kanal_useku(:'tenant', :'usek_kuchyne') as kanal_u \gset
select public.poslat_zpravu(:'kanal_u', 'Krok42: přijede zboží.') as z3 \gset
reset role;

select pg_temp.check('kanál úseku: Bořek (Kuchyně) dostal druhou zprávu téhož dne → jedno upozornění se 2 zprávami',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 1
  and pg_temp.zprav('42420000-0000-0000-0000-00000000000b', 'vzkaz.novy') = 2);
select pg_temp.check('kanál úseku: Emil (Kuchyně) ho dostal — z KANÁLU POBOČKY odešel, z úseku ne',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000e', 'vzkaz.novy') = 1);
select pg_temp.check('kanál úseku: Dana bez úseku ne (jen z pobočky, ta má 1 zprávu)',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000d', 'vzkaz.novy') = 1);
select pg_temp.check('kanál úseku: Cyril z jiného úseku ne',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000c', 'vzkaz.novy') = 0);

-- Naléhavá a pak normální: nese aktuální (normální) prioritu, počet zpráv se sčítá.
select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Krok42 zavřeno', null,
  array[:'anna']::uuid[]) as nalehavy \gset
select public.poslat_zpravu(:'nalehavy', 'Krok42: zítra zavřeno.', true) as z4 \gset
select public.poslat_zpravu(:'nalehavy', 'Krok42: díky za pochopení.') as z5 \gset
reset role;

select pg_temp.check('naléhavá zpráva samotná zůstává v rozhovoru označená (nalehava)',
  (select nalehava from public.konverzace_zpravy where id = :'z4') = true);
select pg_temp.check('upozornění po naléhavé a běžné zprávě nese aktuální prioritu (krok 35, oddíl 5)',
  (select priorita from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000a' and druh = 'vzkaz.novy' and read_at is null) = 'normal');
select pg_temp.check('a pořád je to jedno upozornění s počtem zpráv',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'vzkaz.novy') = 1
  and pg_temp.zprav('42420000-0000-0000-0000-00000000000a', 'vzkaz.novy') = 3);

-- Vypnutá kategorie: zpráva se pošle, upozornění nevznikne.
insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', '42420000-0000-0000-0000-00000000000d', 'vzkazy', false);

select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.poslat_zpravu(:'kanal_p', 'Krok42: dnes končíme dřív.') as z6 \gset
reset role;

select pg_temp.check('vypnuté „vzkazy“: Dana novou zprávu v upozorněních nemá (starý počet 1 zůstal)',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000d', 'vzkaz.novy') = 1);
select pg_temp.check('ale zpráva v kanálu existuje',
  exists (select 1 from public.konverzace_zpravy where id = :'z6'));
delete from public.notification_preferences where user_id = '42420000-0000-0000-0000-00000000000d';


\echo ''
\echo '== 7. Producent: oznámení na nástěnce ======================'

insert into public.announcements (tenant_id, branch_id, body, author_id, requires_acknowledgment)
values (:'tenant', :'perla', 'Krok42: nová hygienická pravidla.', :'sef', true);

select pg_temp.check('oznámení pobočky: Anna dostala právě jedno upozornění',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'oznameni.nova') = 1);
select pg_temp.check('oznámení pobočky: Dana a Bořek taky',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000d', 'oznameni.nova') = 1
  and pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'oznameni.nova') = 1);
select pg_temp.check('oznámení pobočky: Cyril z Baru ne',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000c', 'oznameni.nova') = 0);
select pg_temp.check('oznámení s povinným potvrzením je DŮLEŽITÉ',
  (select priorita from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000a' and druh = 'oznameni.nova') = 'important');
select pg_temp.check('oznámení nese zdroj = oznámení',
  (select zdroj_typ = 'oznameni' and zdroj_id is not null from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000a' and druh = 'oznameni.nova'));

-- Druhé oznámení jen Bořkovi, bez povinného potvrzení: slučuje se a důležitost drží.
insert into public.announcements (tenant_id, employee_id, body, author_id)
values (:'tenant', :'borek', 'Krok42: osobní vzkaz na nástěnce.', :'sef');

select pg_temp.check('druhé oznámení Bořkovi: pořád jedno upozornění, dvě zprávy',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'oznameni.nova') = 1
  and pg_temp.zprav('42420000-0000-0000-0000-00000000000b', 'oznameni.nova') = 2);
select pg_temp.check('… a nese aktuální prioritu (druhé oznámení bylo běžné)',
  (select priorita from public.notifications
    where user_id = '42420000-0000-0000-0000-00000000000b' and druh = 'oznameni.nova') = 'normal');
select pg_temp.check('… a ostatním se nic nepřidalo (Anna má pořád jedno oznámení)',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000a', 'oznameni.nova') = 1);

-- Vypnutá nástěnka
insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', '42420000-0000-0000-0000-00000000000e', 'nastenka', false);
insert into public.announcements (tenant_id, branch_id, body, author_id)
values (:'tenant', :'perla', 'Krok42: třetí oznámení.', :'sef');

select pg_temp.check('vypnutá „nástěnka“: Emil nové oznámení nedostal (starý počet 1 z prvního oznámení zůstal)',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000e', 'oznameni.nova') = 1);
select pg_temp.check('ostatní ano (Dana: 2 zprávy)',
  pg_temp.zprav('42420000-0000-0000-0000-00000000000d', 'oznameni.nova') = 2);
delete from public.notification_preferences where user_id = '42420000-0000-0000-0000-00000000000e';


\echo ''
\echo '== 8. Producent: směny — klíč je směna, ne den ==============='

-- Dvě směny jednoho člověka v jeden den (jiné pobočky) — dřív se druhá
-- ztratila, protože se slučovalo podle dne.
select set_config('test.user_id', :'sef', false);
set role authenticated;

select smena as s1 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'anna', null,
  date '2026-11-09', time '08:00', time '12:00', 'první') \gset
select smena as s2 from public.ulozit_smenu(
  :'tenant', null, :'bar', :'anna', null,
  date '2026-11-09', time '16:00', time '20:00', 'druhá') \gset

reset role;

select pg_temp.check('dvě směny téhož dne = DVĚ upozornění (druhá první nesmaže)',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'smena.nova') = 2
  and exists (select 1 from public.notifications where shift_id = :'s1' and druh = 'smena.nova')
  and exists (select 1 from public.notifications where shift_id = :'s2' and druh = 'smena.nova'));
select pg_temp.check('upozornění na směnu nese zdroj = směna',
  (select zdroj_typ = 'smena' and zdroj_id = :'s1' from public.notifications
    where shift_id = :'s1' and druh = 'smena.nova'));

select pg_temp.check('upozornění nese, kdo změnu provedl („Změnil: …“)',
  (select telo->>'zmenil' from public.notifications
    where shift_id = :'s1' and druh = 'smena.nova')
  = (select full_name from public.employees
      where tenant_id = :'tenant' and user_id = :'sef' and deleted_at is null limit 1));

select set_config('test.user_id', :'sef', false);
set role authenticated;
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'anna', null,
  date '2026-11-09', time '09:00', time '13:00', 'krok 2') \gset
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'anna', null,
  date '2026-11-09', time '10:00', time '14:00', 'krok 3') \gset
reset role;

select pg_temp.check('dvě úpravy jedné směny = jedno nepřečtené smena.zmenena na TU směnu',
  (select count(*) from public.notifications
    where shift_id = :'s1' and druh = 'smena.zmenena' and read_at is null) = 1);
select pg_temp.check('drží NEJSTARŠÍ původní čas (08:00–12:00) a poslední nový (10:00–14:00)',
  (select (telo->>'puvodni_od') || '-' || (telo->>'puvodni_do') || '>' || (telo->>'od') || '-' || (telo->>'do')
     from public.notifications where shift_id = :'s1' and druh = 'smena.zmenena' and read_at is null)
  = '08:00-12:00>10:00-14:00');
select pg_temp.check('úprava první směny se druhé směny vůbec nedotkla',
  exists (select 1 from public.notifications where shift_id = :'s2' and druh = 'smena.nova' and read_at is null)
  and not exists (select 1 from public.notifications where shift_id = :'s2' and druh = 'smena.zmenena'));

-- Přesun na jiný den: „původně“ zůstává den před celou sérií úprav.
select set_config('test.user_id', :'sef', false);
set role authenticated;
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'anna', null,
  date '2026-11-10', time '10:00', time '14:00', 'jiný den') \gset
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'anna', null,
  date '2026-11-11', time '10:00', time '14:00', 'ještě jiný den') \gset
reset role;

select pg_temp.check('po dvou přesunech na jiný den je původní den pořád 9. 11.',
  (select telo->>'puvodni_den' from public.notifications
    where shift_id = :'s1' and druh = 'smena.zmenena' and read_at is null) = '2026-11-09');
select pg_temp.check('a je jen jedno upozornění o změně té směny (přesun nezaložil druhé)',
  (select count(*) from public.notifications
    where shift_id = :'s1' and druh = 'smena.zmenena' and read_at is null) = 1);

-- Vrácení do původního stavu.
select set_config('test.user_id', :'sef', false);
set role authenticated;
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'anna', null,
  date '2026-11-09', time '08:00', time '12:00', 'zpět') \gset
reset role;

select pg_temp.check('vrácení do původního stavu = není o čem informovat, upozornění zmizelo',
  not exists (select 1 from public.notifications
               where shift_id = :'s1' and druh = 'smena.zmenena' and read_at is null));

-- Odebrání směny (přeřazení na Bořka): odebraná nemá id; jiná odebraná téhož dne se neruší.
select set_config('test.user_id', :'sef', false);
set role authenticated;
select smena from public.ulozit_smenu(:'tenant', :'s1', :'perla', :'borek', null,
  date '2026-11-09', time '08:00', time '12:00', 'převzal') \gset
select smena from public.ulozit_smenu(:'tenant', :'s2', :'bar', :'borek', null,
  date '2026-11-09', time '16:00', time '20:00', 'převzal druhou') \gset
reset role;

select pg_temp.check('přeřazení: Anna dostala dvě upozornění „odebrána“ (různé hodiny se neslučují)',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000a', 'smena.odebrana') = 2);
select pg_temp.check('přeřazení: Bořek dostal dvě „nová“ (po jedné na směnu)',
  pg_temp.pocet('42420000-0000-0000-0000-00000000000b', 'smena.nova') = 2);


\echo ''
\echo '== 9. Registrace zařízení (push_odber_ulozit / zrusit) ======'

select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/spolecny', 'p256dh-spolecny-0123456789', 'auth-spol-0123', 'Test');
reset role;

select pg_temp.check('zařízení se zapsalo pod přihlášeného',
  (select user_id from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/spolecny')
  = '42420000-0000-0000-0000-00000000000a');

-- Sdílený telefon: přihlásí se Bořek, zařízení přejde na něj.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/spolecny', 'p256dh-spolecny-0123456789', 'auth-spol-0123', 'Test');
reset role;

select pg_temp.check('sdílené zařízení přejde na posledního přihlášeného (jeden řádek, ne dva)',
  (select count(*) from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/spolecny') = 1
  and (select user_id from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/spolecny')
      = '42420000-0000-0000-0000-00000000000b');

-- Cizí člověk cizí zařízení nezruší.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.push_odber_zrusit('https://fcm.googleapis.com/fcm/send/spolecny');
reset role;
select pg_temp.check('zrušit smí jen vlastník zařízení (Anna cizí zařízení nevypne)',
  (select vypnuto_kdy from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/spolecny') is null);

select set_config('test.user_id', '42420000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.push_odber_zrusit('https://fcm.googleapis.com/fcm/send/spolecny');
reset role;
select pg_temp.check('vlastník zařízení ho vypnout může',
  (select vypnuto_kdy from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/spolecny') is not null);

-- Adresa musí patřit push službě prohlížeče: odesílač na ni z našeho serveru
-- posílá požadavek, takže libovolná adresa by byla SSRF.
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);

select pg_temp.check('http:// se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('http://fcm.googleapis.com/fcm/send/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));
select pg_temp.check('cizí (vnitřní) adresa se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('https://interni-host.local/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));
select pg_temp.check('adresa s uživatelským jménem (fcm.googleapis.com@evil) se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('https://fcm.googleapis.com@evil.example/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));
select pg_temp.check('adresa s portem se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('https://fcm.googleapis.com:8443/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));
select pg_temp.check('podřetězec hostitele (fcm.googleapis.com.evil.example) se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('https://fcm.googleapis.com.evil.example/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));
select pg_temp.check('cizí doména končící na push.apple.com.evil se nezapíše',
  pg_temp.spadne_hlaskou($q$select public.push_odber_ulozit('https://web.push.apple.com.evil.example/x', 'p256dh-xx-0123456789', 'auth-xx-0123')$q$, 'PT400', 'push službě'));

select public.push_odber_ulozit('https://updates.push.services.mozilla.com/wpush/v2/abc', 'p256dh-moz-0123456789', 'auth-moz-0123');
select public.push_odber_ulozit('https://wns2-par02p.notify.windows.com/w/?token=abc', 'p256dh-win-0123456789', 'auth-win-0123');
select pg_temp.check('skutečné adresy služeb (Firefox, Windows) projdou',
  (select count(*) from public.push_odbery
    where endpoint in ('https://updates.push.services.mozilla.com/wpush/v2/abc',
                       'https://wns2-par02p.notify.windows.com/w/?token=abc')) = 2);

-- Strop zařízení: nejvýš 10 zapnutých na člověka, nejstarší se vypnou.
-- Bořek má dvě zapnutá zařízení, starší než všechna Anina: kdyby strop nefiltroval
-- podle člověka, vypnul by je jako „nejstarší“ (bez nich by kontrola nic neměřila).
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000b', false);
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/borek1', 'p256dh-bor-0123456789', 'auth-bor-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/borek2', 'p256dh-bor-0123456789', 'auth-bor-0123');
select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
select count(*) as b_pred from public.push_odbery
 where user_id = '42420000-0000-0000-0000-00000000000b' and vypnuto_kdy is null \gset
-- (dvanáct samostatných příkazů: jeden příkaz je jedna transakce s jedním now(),
-- takže by se „nejstarší“ nedalo rozlišit)
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap01', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap02', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap03', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap04', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap05', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap06', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap07', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap08', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap09', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap10', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap11', 'p256dh-kap-0123456789', 'auth-kap-0123');
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/kap12', 'p256dh-kap-0123456789', 'auth-kap-0123');
select pg_temp.check('po dvanácti registracích má člověk zapnutých nejvýš 10 zařízení',
  (select count(*) from public.push_odbery
    where user_id = '42420000-0000-0000-0000-00000000000a' and vypnuto_kdy is null) = 10);
select pg_temp.check('nejnovější zařízení zůstalo zapnuté, nejstarší z dávky se vypnulo',
  (select vypnuto_kdy is null from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/kap12')
  and (select vypnuto_kdy is not null from public.push_odbery where endpoint = 'https://fcm.googleapis.com/fcm/send/kap01'));
select pg_temp.check('zařízení jiného člověka se tím nedotklo',
  (select count(*) from public.push_odbery
    where user_id = '42420000-0000-0000-0000-00000000000b' and vypnuto_kdy is null) = :b_pred);

-- Nepřihlášený.
select set_config('test.user_id', '', false);
do $$
begin
  perform public.push_odber_ulozit('https://web.push.apple.com/nikdo', 'p256dh-nikdo-0123456789', 'auth-nikdo-0123');
  raise exception 'SELHALO: nepřihlášený zapsal zařízení';
exception when sqlstate 'PT403' then
  raise notice '  OK    nepřihlášený zařízení nezapíše (PT403)';
end $$;


\echo ''
\echo '== 10. Potvrzení (acknowledged_at) nejde zpětně přepsat ======'

select id as n_potv from public.notifications
 where user_id = '42420000-0000-0000-0000-00000000000a' and druh = 'test.zaklad'
 order by created_at limit 1 \gset

select set_config('test.user_id', '42420000-0000-0000-0000-00000000000a', false);
set role authenticated;
update public.notifications set acknowledged_at = now() - interval '2 days' where id = :'n_potv';
reset role;
select pg_temp.check('první potvrzení dostane čas serveru, ne zpětně vymyšlený',
  (select acknowledged_at > now() - interval '1 minute' from public.notifications where id = :'n_potv'));

set role authenticated;
update public.notifications set acknowledged_at = null where id = :'n_potv';
reset role;
select pg_temp.check('zapsané potvrzení nejde vrátit na NULL',
  (select acknowledged_at is not null from public.notifications where id = :'n_potv'));

set role authenticated;
update public.notifications set acknowledged_at = now() - interval '5 days' where id = :'n_potv';
reset role;
select pg_temp.check('a nejde ani přepsat na jiný čas',
  (select acknowledged_at > now() - interval '1 minute' from public.notifications where id = :'n_potv'));

select pg_temp.check('read_at zůstává pod kontrolou člověka (přečteno/nepřečteno se dál nastavuje)',
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'));

-- Servisní role a definer funkce se tím neřídí (current_user není authenticated).
update public.notifications set acknowledged_at = now() - interval '3 days' where id = :'n_potv';
select pg_temp.check('server smí čas potvrzení opravit (guard platí jen pro role API)',
  (select acknowledged_at < now() - interval '2 days' from public.notifications where id = :'n_potv'));


-- Úklid: cizí firma se maže (kaskádou i její zaměstnanec a upozornění).
delete from public.tenants where id = :'cizi_firma';

\echo ''
\echo '== KROK 42 HOTOV ========================================'
