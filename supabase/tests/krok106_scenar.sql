-- Scénář pro krok 106 — Rezervace: ranní souhrn dne do upozornění.
--
-- Pokrývá migraci 20261103100000_rezervace_souhrn_dne.sql
-- (`app.rezervace_souhrn_dne`, `rezervace_souhrn_dne`, kategorie
-- `rezervace_souhrn` v app.notifikovat, úloha v plánovači).
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab, Perla, Bar, majitel).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. okno 8:00–16:00 v hodině na zdi pobočky; ve 2:00 po půlnoci je
--      provozní den ještě včerejší;
--   2. čísla: rezervace a hosté bez zrušených, akce s časem, názvem,
--      počtem a prostorem, zrušená akce ne; jména hostů v těle nejsou;
--   3. provozní den kolem půlnoci: rezervace v 1:30 patří k večeru
--      předtím, rezervace ve 3:00 ráno k dni předtím;
--   4. komu: majitel obě pobočky v JEDNOM upozornění, čtenář jen svou
--      pobočku, člověk bez práva nic, kdo si souhrn vypnul nic;
--   5. cizí firma: člověk ve dvou firmách dostane dvě upozornění, každé
--      jen s pobočkami své firmy;
--   6. jednou za den a pobočku: druhý běh nepošle nic;
--   7. další den nahradí včerejší nepřečtený a zruší jeho čekající push;
--      prázdná pobočka sama nic nepošle, v souhrnu víc poboček je;
--   8. doručení: majitel obchází frontu, ostatní čekají na příchod;
--   9. granty, vypínač, úloha v plánovači, obálka pro úlohu.
--
-- POZOR, SDÍLENÁ DATABÁZE: run.sh pouští všechny kroky v jedné databázi
-- a funkce bez `p_tenant` projde VŠECHNY firmy. Kontroly se proto ptají
-- jen na lidi a pobočky tohohle scénáře, nikdy na celkové počty.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Poslední ranní souhrn člověka v dané firmě (nebo NULL).
create or replace function pg_temp.souhrn(p_tenant uuid, p_user uuid)
returns jsonb language sql as $$
  select n.telo from public.notifications n
   where n.tenant_id = p_tenant and n.user_id = p_user and n.druh = 'rezervace.souhrn_dne'
   order by n.created_at desc, n.id
   limit 1
$$;

create or replace function pg_temp.pocet(p_tenant uuid, p_user uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.tenant_id = p_tenant and n.user_id = p_user and n.druh = 'rezervace.souhrn_dne'
$$;

-- Pobočka z těla souhrnu podle názvu (nebo NULL).
create or replace function pg_temp.pobocka(p_telo jsonb, p_nazev text)
returns jsonb language sql as $$
  select e from jsonb_array_elements(coalesce(p_telo -> 'souhrn', '[]'::jsonb)) e
   where e ->> 'pobocka' = p_nazev
$$;

reset role;
-- Přímé zápisy (majitel cizí firmy) jako superuživatel: bez zděděného
-- auth.uid() z předchozího scénáře (spoušť „Majitele jmenuje jenom majitel").
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

\set petra  10610000-0000-0000-0000-000000000001
\set bruno  10610000-0000-0000-0000-000000000002
\set nikdo  10610000-0000-0000-0000-000000000003
\set vypnul 10610000-0000-0000-0000-000000000004
\set dvojf  10610000-0000-0000-0000-000000000005

insert into auth.users (id, email, raw_user_meta_data) values
  (:'petra',  'petra106@foodtab.cz',  '{"full_name":"Petra Stošestka"}'),
  (:'bruno',  'bruno106@foodtab.cz',  '{"full_name":"Bruno Stošestka"}'),
  (:'nikdo',  'nikdo106@foodtab.cz',  '{"full_name":"Nikola Stošestka"}'),
  (:'vypnul', 'vypnul106@foodtab.cz', '{"full_name":"Vojtěch Stošestka"}'),
  (:'dvojf',  'dvojf106@foodtab.cz',  '{"full_name":"Dana Stošestka"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska106_cteni', 'Zkouška 106 — čtení', 'servis', true) returning id as z_cteni \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska106_zapis', 'Zkouška 106 — zápis', 'provoz', true) returning id as z_zapis \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_cteni', 'rezervace.read'),
  (:'tenant', :'z_zapis', 'rezervace.manage');

-- Petra čte na Perle, Bruno zapisuje v Baru, Nikola je na Perle bez
-- práva, Vojtěch čte na Perle a souhrn si vypnul, Dana čte na Perle
-- a v cizí firmě je majitelka.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'petra', :'z_cteni', 'Petra Stošestka', 'hpp') returning id as e_petra \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'bar', :'bruno', :'z_zapis', 'Bruno Stošestka', 'hpp') returning id as e_bruno \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', :'nikdo', 'Nikola Stošestka', 'hpp') returning id as e_nikdo \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'vypnul', :'z_cteni', 'Vojtěch Stošestka', 'hpp') returning id as e_vypnul \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'dvojf', :'z_cteni', 'Dana Stošestka', 'hpp') returning id as e_dvojf \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', :'petra',  null, 'branch', 'active'),
  (:'tenant', :'bruno',  null, 'branch', 'active'),
  (:'tenant', :'nikdo',  null, 'branch', 'active'),
  (:'tenant', :'vypnul', null, 'branch', 'active'),
  (:'tenant', :'dvojf',  null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'bruno' then :'bar'::uuid else :'perla'::uuid end
  from public.memberships m
 where m.tenant_id = :'tenant' and m.user_id in (:'petra', :'bruno', :'nikdo', :'vypnul', :'dvojf');

insert into public.notification_preferences (tenant_id, user_id, kategorie, povoleno)
values (:'tenant', :'vypnul', 'rezervace_souhrn', false);

-- Cizí firma, kde je Dana majitelka.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok106 Cizí s.r.o.', 'Krok106 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'cizi_firma', 'provoz')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 106 Krok106', 'krok106-cizi') returning id as cizi_pobocka \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'cizi_firma', :'cizi_pobocka', :'dvojf', 'Dana Stošestka', 'hpp', true) returning id as e_dvojf_cizi \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'cizi_firma', :'dvojf', null, 'tenant', 'active');

-- Zařízení pro push: majitel a Petra. Bez nich by se o frontě nic nevědělo.
insert into public.push_odbery (user_id, endpoint, p256dh, auth_secret) values
  (:'majitel', 'https://fcm.googleapis.com/fcm/send/krok106-majitel', 'p256dh-krok106-majitel', 'auth-krok106'),
  (:'petra',   'https://fcm.googleapis.com/fcm/send/krok106-petra',   'p256dh-krok106-petra',   'auth-krok106');

/*
  Rezervace. Čísla osob jsou schválně různá, ať každá chyba vyjde jinak:
    Perla, provozní den 12. 3. 2031 (den začíná v 5:00, Praha, zima +01):
      R1  19:00            4 os.            počítá se
      R2  13. 3. 1:30      2 os.            PO PŮLNOCI → patří ke 12. 3.
      R3  20:00           10 os. ZRUŠENÁ    nepočítá se
      R4  12. 3. 3:00     20 os.            PŘED 5:00 → patří k 11. 3.
      R5  12:00            bez počtu        počítá se, hosté ne
      A1  18:00 akce      30 os. Salonek    v seznamu
      A2  17:00 akce      50 os. ZRUŠENÁ    v seznamu není
    Perla 13. 3.: R6 19:00 3 os.  ·  Bar 12. 3.: B1 20:00 5 os.  ·  Bar 13. 3.: nic
    Cizí firma 12. 3.: X1 19:00 7 os.
*/
insert into public.rezervace (tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, pocet_osob, prostor) values
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'R1 Krok106', '2031-03-12 19:00+01', 4,    ''),
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'R2 Krok106', '2031-03-13 01:30+01', 2,    ''),
  (:'tenant', :'perla', 'rezervace', 'zrusena',   '', 'R3 Krok106', '2031-03-12 20:00+01', 10,   ''),
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'R4 Krok106', '2031-03-12 03:00+01', 20,   ''),
  (:'tenant', :'perla', 'rezervace', 'ceka',      '', 'R5 Krok106', '2031-03-12 12:00+01', null, ''),
  (:'tenant', :'perla', 'akce',      'potvrzeno', 'Firemní večírek Krok106', 'A1 Krok106', '2031-03-12 18:00+01', 30, 'Salonek'),
  (:'tenant', :'perla', 'akce',      'zrusena',   'Zrušená akce Krok106',    'A2 Krok106', '2031-03-12 17:00+01', 50, 'Sál'),
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'R6 Krok106', '2031-03-13 19:00+01', 3,    ''),
  (:'tenant', :'bar',   'rezervace', 'potvrzeno', '', 'B1 Krok106', '2031-03-12 20:00+01', 5,    ''),
  (:'cizi_firma', :'cizi_pobocka', 'rezervace', 'potvrzeno', '', 'X1 Krok106', '2031-03-12 19:00+01', 7, '');


\echo ''
\echo '== 0. Příprava ==========================================='

select pg_temp.check('příprava: spoušť dala R2 (1:30) ke 12. 3. a R4 (3:00) k 11. 3.',
  (select den from public.rezervace where jmeno_hosta = 'R2 Krok106') = date '2031-03-12'
  and (select den from public.rezervace where jmeno_hosta = 'R4 Krok106') = date '2031-03-11');
select pg_temp.check('příprava: majitel je majitel a vidí rezervace obou poboček',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla') where user_id = :'majitel')
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'bar') where user_id = :'majitel'));
select pg_temp.check('příprava: Petra čte jen na Perle, Nikola nikde',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla') where user_id = :'petra')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'bar') where user_id = :'petra')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla') where user_id = :'nikdo')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'perla') where user_id = :'nikdo'));
select pg_temp.check('příprava: nikdo z kroku 106 zatím souhrn nemá',
  (select count(*) from public.notifications
    where druh = 'rezervace.souhrn_dne' and user_id in (:'majitel', :'petra', :'bruno', :'nikdo', :'vypnul', :'dvojf')) = 0);


\echo ''
\echo '== 1. Okno 8:00–16:00 v hodině na zdi pobočky ============'

select app.rezervace_souhrn_dne('2031-03-12 07:59+01', :'tenant')::text as pred_osmou \gset
select pg_temp.check('v 7:59 se nic nevyhodnotí ani nepošle',
  (:'pred_osmou'::jsonb ->> 'pobocek')::int = 0 and (:'pred_osmou'::jsonb ->> 'chyb')::int = 0
  and not exists (select 1 from public.rezervace_souhrn_dne where branch_id in (:'perla', :'bar') and den = date '2031-03-12'));

select app.rezervace_souhrn_dne('2031-03-12 16:00+01', :'tenant')::text as v_ctyri \gset
select pg_temp.check('v 16:00 už ne — „Dnes …“ uprostřed večera nepomůže',
  (:'v_ctyri'::jsonb ->> 'pobocek')::int = 0
  and not exists (select 1 from public.rezervace_souhrn_dne where branch_id in (:'perla', :'bar') and den = date '2031-03-12'));

select pg_temp.check('… a nikomu nic nepřišlo',
  pg_temp.pocet(:'tenant', :'majitel') = 0 and pg_temp.pocet(:'tenant', :'petra') = 0);


\echo ''
\echo '== 2. První běh v 8:00 (všechny firmy, jako úloha) ======='

select app.rezervace_souhrn_dne('2031-03-12 08:00+01', null)::text as beh1 \gset
select pg_temp.check('běh doběhl bez chyby firmy',
  (:'beh1'::jsonb ->> 'chyb')::int = 0);

-- NULL by \gset nezaložil — prázdný objekt místo něj.
select coalesce(pg_temp.souhrn(:'tenant', :'majitel')::text, '{}') as m1 \gset
select coalesce(pg_temp.pobocka(:'m1'::jsonb, 'Restaurace Černá Perla')::text, '{}') as m1_perla \gset
select coalesce(pg_temp.pobocka(:'m1'::jsonb, 'Bernard Bar Tábor')::text, '{}') as m1_bar \gset

select pg_temp.check('majitel: JEDNO upozornění s oběma pobočkami, den 12. 3.',
  pg_temp.pocet(:'tenant', :'majitel') = 1
  and :'m1'::jsonb ->> 'den' = '2031-03-12'
  and :'m1_perla' <> '{}' and :'m1_bar' <> '{}');
-- Konkrétní kontroly napřed, souhrnná až za nimi: první SELHALO zastaví
-- scénář, a má jmenovat příčinu, ne jen „čísla nesedí“.
select pg_temp.check('zrušená rezervace (10 os.) se nepočítá',
  (:'m1_perla'::jsonb ->> 'hostu')::int <> 16 and (:'m1_perla'::jsonb ->> 'rezervaci')::int <> 4);
select pg_temp.check('provozní den: rezervace v 1:30 po půlnoci patří k večeru 12. 3.',
  (:'m1_perla'::jsonb ->> 'hostu')::int not in (4, 24));
select pg_temp.check('provozní den: rezervace ve 3:00 ráno 12. 3. patří k 11. 3. (20 os. tu nejsou)',
  (:'m1_perla'::jsonb ->> 'hostu')::int not in (24, 26));
select pg_temp.check('Perla: 3 rezervace (R1, R2, R5) a 6 hostů (4 + 2), u jedné počet chybí',
  (:'m1_perla'::jsonb ->> 'rezervaci')::int = 3
  and (:'m1_perla'::jsonb ->> 'hostu')::int = 6
  and (:'m1_perla'::jsonb ->> 'bez_poctu')::int = 1);
select pg_temp.check('akce: jedna (zrušená ne) — 18:00, název, 30 os., Salonek',
  (:'m1_perla'::jsonb ->> 'akci')::int = 1
  and jsonb_array_length(:'m1_perla'::jsonb -> 'akce') = 1
  and :'m1_perla'::jsonb -> 'akce' -> 0 = '{"cas":"18:00","nazev":"Firemní večírek Krok106","osob":30,"prostor":"Salonek"}'::jsonb);
select pg_temp.check('Bar: 1 rezervace, 5 hostů, žádná akce',
  (:'m1_bar'::jsonb ->> 'rezervaci')::int = 1 and (:'m1_bar'::jsonb ->> 'hostu')::int = 5
  and (:'m1_bar'::jsonb ->> 'akci')::int = 0 and :'m1_bar'::jsonb -> 'akce' = '[]'::jsonb);
select pg_temp.check('pobočky nesou slug (odkaz do kalendáře) a den',
  :'m1_perla'::jsonb ->> 'slug' = 'cerna-perla' and :'m1_bar'::jsonb ->> 'den' = '2031-03-12');
select pg_temp.check('jména hostů v upozornění nejsou (ani zrušené akce)',
  :'m1' not like '%R1 Krok106%' and :'m1' not like '%A1 Krok106%' and :'m1' not like '%Zrušená akce%');
select pg_temp.check('majitel Foodtabu nedostal pobočku cizí firmy',
  pg_temp.pobocka(:'m1'::jsonb, 'Cizí 106 Krok106') is null and :'m1' not like '%Krok106 Cizí%');

select pg_temp.check('Petra (čte jen Perlu): jedno upozornění jen s Perlou, pobočka na řádku upozornění',
  pg_temp.pocet(:'tenant', :'petra') = 1
  and jsonb_array_length(pg_temp.souhrn(:'tenant', :'petra') -> 'souhrn') = 1
  and pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'petra'), 'Restaurace Černá Perla') is not null
  and (select branch_id from public.notifications
        where tenant_id = :'tenant' and user_id = :'petra' and druh = 'rezervace.souhrn_dne') = :'perla');
select pg_temp.check('Bruno (zapisuje jen v Baru, rezervace.manage): jen Bar',
  pg_temp.pocet(:'tenant', :'bruno') = 1
  and jsonb_array_length(pg_temp.souhrn(:'tenant', :'bruno') -> 'souhrn') = 1
  and pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'bruno'), 'Bernard Bar Tábor') is not null);
select pg_temp.check('Nikola bez práva na rezervace nedostal nic',
  pg_temp.pocet(:'tenant', :'nikdo') = 0);
select pg_temp.check('Vojtěch si souhrn vypnul — nedostal nic',
  pg_temp.pocet(:'tenant', :'vypnul') = 0);

select pg_temp.check('Dana ve dvou firmách: ve Foodtabu jen Perla',
  pg_temp.pocet(:'tenant', :'dvojf') = 1
  and jsonb_array_length(pg_temp.souhrn(:'tenant', :'dvojf') -> 'souhrn') = 1
  and pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'dvojf'), 'Restaurace Černá Perla') is not null);
select pg_temp.check('Dana v cizí firmě: jen cizí pobočka (1 rezervace, 7 hostů), nic z Foodtabu',
  pg_temp.pocet(:'cizi_firma', :'dvojf') = 1
  and jsonb_array_length(pg_temp.souhrn(:'cizi_firma', :'dvojf') -> 'souhrn') = 1
  and (pg_temp.pobocka(pg_temp.souhrn(:'cizi_firma', :'dvojf'), 'Cizí 106 Krok106') ->> 'hostu')::int = 7
  and pg_temp.souhrn(:'cizi_firma', :'dvojf')::text not like '%Perla%'
  and pg_temp.souhrn(:'cizi_firma', :'dvojf')::text not like '%Bernard%');

select pg_temp.check('záznam „vyhodnoceno“: Perla 3/6/1, Bar 1/5/0, cizí 1/7/0',
  (select rezervaci = 3 and hostu = 6 and akci = 1 and tenant_id = :'tenant'
     from public.rezervace_souhrn_dne where branch_id = :'perla' and den = date '2031-03-12')
  and (select rezervaci = 1 and hostu = 5 and akci = 0
     from public.rezervace_souhrn_dne where branch_id = :'bar' and den = date '2031-03-12')
  and (select rezervaci = 1 and hostu = 7 and tenant_id = :'cizi_firma'
     from public.rezervace_souhrn_dne where branch_id = :'cizi_pobocka' and den = date '2031-03-12'));
select pg_temp.check('Vojtěchova pobočka se přesto vyhodnotila (vypnul si jen on)',
  exists (select 1 from public.rezervace_souhrn_dne where branch_id = :'perla' and den = date '2031-03-12'));

select pg_temp.check('doručení: majitel obchází frontu (push hned), Petra čeká na příchod',
  (select d.stav from public.notifikace_doruceni d
     join public.notifications n on n.id = d.notification_id
    where n.tenant_id = :'tenant' and n.user_id = :'majitel' and n.druh = 'rezervace.souhrn_dne') = 'k_odeslani'
  and (select d.stav from public.notifikace_doruceni d
     join public.notifications n on n.id = d.notification_id
    where n.tenant_id = :'tenant' and n.user_id = :'petra' and n.druh = 'rezervace.souhrn_dne') = 'ceka_na_smenu');


\echo ''
\echo '== 3. Jednou za den a pobočku ============================'

select app.rezervace_souhrn_dne('2031-03-12 08:30+01', null)::text as beh2 \gset
select app.rezervace_souhrn_dne('2031-03-12 15:59+01', :'tenant')::text as beh3 \gset
select pg_temp.check('druhý a třetí běh téhož dne nevyhodnotí Foodtab znovu',
  (:'beh3'::jsonb ->> 'pobocek')::int = 0 and (:'beh2'::jsonb ->> 'chyb')::int = 0);
select pg_temp.check('… a nikdo nedostal druhé upozornění ani druhý push',
  pg_temp.pocet(:'tenant', :'majitel') = 1 and pg_temp.pocet(:'tenant', :'petra') = 1
  and pg_temp.pocet(:'tenant', :'bruno') = 1 and pg_temp.pocet(:'cizi_firma', :'dvojf') = 1
  and (select count(*) from public.notifikace_doruceni d
         join public.notifications n on n.id = d.notification_id
        where n.user_id in (:'majitel', :'petra') and n.druh = 'rezervace.souhrn_dne') = 2);
select pg_temp.check('záznam pobočky a dne je pořád jeden',
  (select count(*) from public.rezervace_souhrn_dne where branch_id = :'perla' and den = date '2031-03-12') = 1);

select app.rezervace_souhrn_dne('2031-03-13 02:00+01', :'tenant')::text as po_pulnoci \gset
select pg_temp.check('ve 2:00 po půlnoci je provozní den ještě 12. 3. — souhrn na 13. 3. neodešel',
  (:'po_pulnoci'::jsonb ->> 'pobocek')::int = 0
  and not exists (select 1 from public.rezervace_souhrn_dne where branch_id in (:'perla', :'bar') and den = date '2031-03-13'));

select app.rezervace_souhrn_dne('2031-03-13 05:30+01', :'tenant')::text as pet_tricet \gset
select pg_temp.check('v 5:30 už je provozní den 13. 3., ale ještě není osm — nic',
  (:'pet_tricet'::jsonb ->> 'pobocek')::int = 0
  and not exists (select 1 from public.rezervace_souhrn_dne where branch_id in (:'perla', :'bar') and den = date '2031-03-13'));


\echo ''
\echo '== 4. Další den: nahradí včerejší, prázdná pobočka ======='

select d.id as dor_petra_vcera from public.notifikace_doruceni d
  join public.notifications n on n.id = d.notification_id
 where n.tenant_id = :'tenant' and n.user_id = :'petra' and n.druh = 'rezervace.souhrn_dne' \gset

select app.rezervace_souhrn_dne('2031-03-13 09:00+01', :'tenant')::text as beh_zitra \gset
select pg_temp.check('13. 3. v 9:00 se vyhodnotí Perla i Bar',
  (:'beh_zitra'::jsonb ->> 'chyb')::int = 0
  and (select count(*) from public.rezervace_souhrn_dne
        where branch_id in (:'perla', :'bar') and den = date '2031-03-13') = 2);
select pg_temp.check('Petra: včerejší nepřečtený souhrn nahradil dnešní (1 rezervace, 3 hosté)',
  pg_temp.pocet(:'tenant', :'petra') = 1
  and pg_temp.souhrn(:'tenant', :'petra') ->> 'den' = '2031-03-13'
  and (pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'petra'), 'Restaurace Černá Perla') ->> 'hostu')::int = 3);
select pg_temp.check('… a jeho čekající push se zrušil (nepípne po příchodu včerejšek)',
  (select stav from public.notifikace_doruceni where id = :'dor_petra_vcera') = 'zruseno');
select pg_temp.check('Bruno: v Baru 13. 3. nic — nic nepřišlo, včerejší zůstal',
  pg_temp.pocet(:'tenant', :'bruno') = 1
  and pg_temp.souhrn(:'tenant', :'bruno') ->> 'den' = '2031-03-12');
select pg_temp.check('majitel: souhrn 13. 3. uvádí i prázdný Bar (0 rezervací, 0 akcí)',
  pg_temp.pocet(:'tenant', :'majitel') = 1
  and pg_temp.souhrn(:'tenant', :'majitel') ->> 'den' = '2031-03-13'
  and (pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'majitel'), 'Bernard Bar Tábor') ->> 'rezervaci')::int = 0
  and (pg_temp.pobocka(pg_temp.souhrn(:'tenant', :'majitel'), 'Bernard Bar Tábor') ->> 'akci')::int = 0);
select pg_temp.check('prázdný Bar se zapsal jako vyhodnocený (pozdní rezervace nespustí pozdní souhrn)',
  (select rezervaci = 0 and hostu = 0 and akci = 0
     from public.rezervace_souhrn_dne where branch_id = :'bar' and den = date '2031-03-13'));

select app.rezervace_souhrn_dne('2031-03-14 08:00+01', :'tenant')::text as beh_prazdny \gset
select pg_temp.check('14. 3. nikde nic: vyhodnoceno, ale nikomu nic nepřišlo',
  (:'beh_prazdny'::jsonb ->> 'chyb')::int = 0
  and (select count(*) from public.rezervace_souhrn_dne
        where branch_id in (:'perla', :'bar') and den = date '2031-03-14') = 2
  and pg_temp.souhrn(:'tenant', :'majitel') ->> 'den' = '2031-03-13'
  and pg_temp.souhrn(:'tenant', :'petra') ->> 'den' = '2031-03-13');


\echo ''
\echo '== 5. Granty, vypínač, úloha ============================='

select pg_temp.check('souhrn sám nevolá nikdo zvenku (ani service_role) — jen obálka',
  not has_function_privilege('authenticated', 'app.rezervace_souhrn_dne(timestamptz, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.rezervace_souhrn_dne(timestamptz, uuid)', 'execute')
  and not has_function_privilege('service_role', 'app.rezervace_souhrn_dne(timestamptz, uuid)', 'execute'));
select pg_temp.check('obálku pro úlohu volá jen service_role',
  has_function_privilege('service_role', 'public.rezervace_souhrn_dne_poslat()', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_souhrn_dne_poslat()', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_souhrn_dne_poslat()', 'execute'));
select pg_temp.check('tabulku „vyhodnoceno“ klient nečte ani nevysype',
  not has_table_privilege('authenticated', 'public.rezervace_souhrn_dne', 'select')
  and not has_table_privilege('authenticated', 'public.rezervace_souhrn_dne', 'truncate')
  and not has_table_privilege('anon', 'public.rezervace_souhrn_dne', 'select'));
select pg_temp.check('vypínač: kategorii rezervace_souhrn databáze bere (zápis z přípravy)',
  exists (select 1 from public.notification_preferences where user_id = :'vypnul' and kategorie = 'rezervace_souhrn')
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.notification_preferences'::regclass
       and conname = 'notification_preferences_kategorie_check'
       and pg_get_constraintdef(oid) like '%vzkazy%nastenka%rezervace_souhrn%'));
select pg_temp.check('úloha rezervace-souhrn-dne je v plánovači: každou hodinu v :01, limit 300 s',
  exists (select 1 from app.planovac_ulohy
           where uloha = 'rezervace-souhrn-dne' and plan_utc = '1 * * * *' and limit_sekund = 300));

-- Obálka, jak ji volá úloha (teď, všechny firmy) — v transakci, která se
-- vrátí: ve sdílené databázi nesmí zůstat souhrn za skutečný dnešek.
begin;
set local role service_role;
select public.rezervace_souhrn_dne_poslat()::text as obalka \gset
rollback;
select pg_temp.check('obálka pro úlohu běží pod service_role a vrací počty bez chyby',
  :'obalka'::jsonb ? 'pobocek' and :'obalka'::jsonb ? 'upozorneni' and (:'obalka'::jsonb ->> 'chyb')::int = 0);


\echo ''
\echo '== Úklid ================================================='

reset role;
select set_config('test.user_id', '', false);

-- Běh v 8:00 šel přes všechny firmy: souhrny za 12.–14. 3. 2031 mohli
-- dostat i lidé z jiných scénářů. Uklízí se podle druhu a dne, ne podle lidí.
delete from public.notifikace_doruceni
 where notification_id in (
   select id from public.notifications
    where druh = 'rezervace.souhrn_dne' and telo ->> 'den' between '2031-03-11' and '2031-03-14');
delete from public.notifications
 where druh = 'rezervace.souhrn_dne' and telo ->> 'den' between '2031-03-11' and '2031-03-14';
delete from public.rezervace_souhrn_dne where den between date '2031-03-11' and date '2031-03-14';

delete from public.rezervace where jmeno_hosta like '%Krok106';
delete from public.push_odbery where endpoint like 'https://fcm.googleapis.com/fcm/send/krok106-%';
delete from public.notification_preferences where user_id = :'vypnul';
-- Cizí firma s Danou jako majitelkou zůstává (jako v kroku 103): poslední
-- majitelku firmy pojistka smazat nedovolí. Z Foodtabu pryč všechno.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'tenant'
                            and user_id in (:'petra', :'bruno', :'nikdo', :'vypnul', :'dvojf'));
delete from public.memberships
 where tenant_id = :'tenant' and user_id in (:'petra', :'bruno', :'nikdo', :'vypnul', :'dvojf');
delete from public.employees where id in (:'e_petra', :'e_bruno', :'e_nikdo', :'e_vypnul', :'e_dvojf');
delete from public.position_permissions where position_id in (:'z_cteni', :'z_zapis');
delete from public.positions where id in (:'z_cteni', :'z_zapis');

select pg_temp.check('úklid: po scénáři nezůstal souhrn, rezervace ani člověk z kroku 106 ve Foodtabu',
  not exists (select 1 from public.notifications
               where druh = 'rezervace.souhrn_dne' and telo ->> 'den' between '2031-03-11' and '2031-03-14')
  and not exists (select 1 from public.rezervace_souhrn_dne where den between date '2031-03-11' and date '2031-03-14')
  and not exists (select 1 from public.rezervace where jmeno_hosta like '%Krok106')
  and not exists (select 1 from public.employees where tenant_id = :'tenant' and full_name like '%Stošestka')
  and not exists (select 1 from public.push_odbery where endpoint like '%krok106-%'));

\echo ''
\echo '== KROK 106 HOTOV ========================================'
