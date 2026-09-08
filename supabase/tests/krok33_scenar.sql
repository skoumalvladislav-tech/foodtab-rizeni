-- Scénář pro krok 33 — jádro oprávnění na zařazení.
--
-- Pokrývá migraci 20260909100000_zarazeni_jadro a oddíl 8 zadání
-- docs/zarazeni-misto-roli.md (čtrnáct kontrol), plus ODDÍL 7b
-- z docs/zarazeni-misto-roli-nalezy.md.
--
-- Navazuje na etapa0_scenar.sql až krok32_scenar.sql.
--
-- ---------------------------------------------------------------------
-- PROČ TENHLE SCÉNÁŘ EXISTUJE
--
-- `app.has_permission` a `app.has_access` jsou `security definer`
-- a vlastní je role s `rolbypassrls`. UVNITŘ NICH SE RLS NEUPLATNÍ
-- VŮBEC — ne zeslabeně, vůbec. Pravidlo 3 z CLAUDE.md mluví o dvou
-- obranných liniích; tady ta druhá neexistuje.
--
-- Z toho plyne, že si nové tělo musí všechno odfiltrovat samo:
--
--   e.tenant_id = p_tenant     jinak právo z CIZÍ FIRMY
--   e.deleted_at is null       jinak práva označeného smazaného
--   m.status = 'active'        jinak práva zrušeného členství
--
-- Na KAŽDÝ z těch tří filtrů míří v oddíle 9 VLASTNÍ kontrola. Jedna
-- společná („cizí firma nevidí nic") nestačí: shodí ji první chybějící
-- filtr a o zbylých dvou neřekne nic.
--
-- KAŽDÁ Z NICH BYLA SCHVÁLNĚ ROZBITÁ. Postup i výsledek jsou
-- v docs/hlaseni/stav-2026-09-09-prepnuti.md — vyndal se vždycky jeden
-- filtr a ověřilo se, že spadne právě ta jedna kontrola, která na něj
-- míří, a žádná jiná.
--
-- ---------------------------------------------------------------------
-- CO TENHLE SCÉNÁŘ NAD PGlite NEOVĚŘÍ
--
-- PGlite běží jako superuživatel, takže `set role authenticated`
-- neuplatní RLS ani sloupcové granty. Kontroly, které stojí na
-- POLITICE (oddíl 12), tam projdou i nad rozbitou politikou — je to
-- u nich napsané. Kontroly, které stojí na SPOUŠTI nebo na těle
-- funkce, platí i tam: spoušť ani `security definer` funkce se
-- superuživatelem nevypnou.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

-- Příprava scény, ne krok uživatele: bez přihlášeného, jako migrace.
-- Jinak by spoušť `trg_strop_zarazeni` odmítala přidělovat zařazení
-- podle toho, kdo zrovna zůstal v `test.user_id` po krok32.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla',  :'perla',  false);
select set_config('test.bar',    :'bar',    false);

/*
  Zařazení Číšník, na kterém stojí většina kontrol. Zakládá se tady
  vlastní, ne hledá mezi šablonami: až někdo šablonu upraví, přestal by
  scénář zkoušet to, co má, a nikdo by si toho nevšiml.
*/
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'k33_cisnik', 'Krok33 — číšník', 'servis', true)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as z_cisnik \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_cisnik', 'shifts.read'),
       (:'tenant', :'z_cisnik', 'tasks.read')
on conflict do nothing;

/*
  A zařazení správce: `settings.manage` má, `attendance.read` NE.
  Na něm stojí oddíl 12 — kdo právo sám nemá, nesmí ho přidělit.
*/
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'k33_spravce', 'Krok33 — správce', 'vedeni', true)
on conflict (tenant_id, key) do update set label = excluded.label
returning id as z_spravce \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_spravce', 'settings.manage'),
       (:'tenant', :'z_spravce', 'people.manage'),
       (:'tenant', :'z_spravce', 'shifts.read')
on conflict do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('33330001-0000-0000-0000-000000000001', 'k33-cisnik@foodtab.cz',   '{"full_name":"K33 Číšník"}'),
  ('33330002-0000-0000-0000-000000000002', 'k33-vyjimka@foodtab.cz',  '{"full_name":"K33 Výjimka"}'),
  ('33330003-0000-0000-0000-000000000003', 'k33-bezniceho@foodtab.cz','{"full_name":"K33 Bez Ničeho"}'),
  ('33330004-0000-0000-0000-000000000004', 'k33-smazany@foodtab.cz',  '{"full_name":"K33 Smazaný"}'),
  ('33330005-0000-0000-0000-000000000005', 'k33-pozastaveny@foodtab.cz','{"full_name":"K33 Pozastavený"}'),
  ('33330006-0000-0000-0000-000000000006', 'k33-dvefirmy@foodtab.cz', '{"full_name":"K33 Dvě Firmy"}'),
  ('33330007-0000-0000-0000-000000000007', 'k33-pobocka@foodtab.cz',  '{"full_name":"K33 Pobočka"}'),
  ('33330008-0000-0000-0000-000000000008', 'k33-spravce@foodtab.cz',  '{"full_name":"K33 Správce"}')
on conflict (id) do nothing;

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', '33330001-0000-0000-0000-000000000001', :'z_cisnik',  'K33 Číšník', 'hpp'),
  (:'tenant', :'perla', '33330002-0000-0000-0000-000000000002', :'z_cisnik',  'K33 Výjimka', 'hpp'),
  (:'tenant', :'perla', '33330003-0000-0000-0000-000000000003', null,         'K33 Bez Ničeho', 'hpp'),
  (:'tenant', :'perla', '33330004-0000-0000-0000-000000000004', :'z_cisnik',  'K33 Smazaný', 'hpp'),
  (:'tenant', :'perla', '33330005-0000-0000-0000-000000000005', :'z_cisnik',  'K33 Pozastavený', 'hpp'),
  (:'tenant', :'perla', '33330006-0000-0000-0000-000000000006', null,         'K33 Dvě Firmy', 'hpp'),
  (:'tenant', :'perla', '33330007-0000-0000-0000-000000000007', :'z_cisnik',  'K33 Pobočka', 'hpp'),
  (:'tenant', :'perla', '33330008-0000-0000-0000-000000000008', :'z_spravce', 'K33 Správce', 'hpp');

-- Brigádník bez účtu, se zařazením. Oddíl 13.
insert into public.employees (tenant_id, branch_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'z_cisnik', 'K33 Brigádník', 'dpp')
returning id as e_brigadnik \gset

select id as e_cisnik   from public.employees where user_id = '33330001-0000-0000-0000-000000000001' \gset
select id as e_vyjimka  from public.employees where user_id = '33330002-0000-0000-0000-000000000002' \gset
select id as e_smazany  from public.employees where user_id = '33330004-0000-0000-0000-000000000004' \gset
select id as e_pobocka  from public.employees where user_id = '33330007-0000-0000-0000-000000000007' \gset

insert into public.memberships (tenant_id, user_id, role_id, status, scope) values
  (:'tenant', '33330001-0000-0000-0000-000000000001', null, 'active',    'tenant'),
  (:'tenant', '33330002-0000-0000-0000-000000000002', null, 'active',    'tenant'),
  (:'tenant', '33330003-0000-0000-0000-000000000003', null, 'active',    'tenant'),
  (:'tenant', '33330004-0000-0000-0000-000000000004', null, 'active',    'tenant'),
  (:'tenant', '33330005-0000-0000-0000-000000000005', null, 'suspended', 'tenant'),
  (:'tenant', '33330006-0000-0000-0000-000000000006', null, 'active',    'tenant'),
  (:'tenant', '33330007-0000-0000-0000-000000000007', null, 'active',    'branch'),
  (:'tenant', '33330008-0000-0000-0000-000000000008', null, 'active',    'tenant');

select id as clen_pobocka from public.memberships
 where tenant_id = :'tenant' and user_id = '33330007-0000-0000-0000-000000000007' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_pobocka', :'perla');

-- Označení smazaného až teď: dřív by spoušť nedovolila založit směny
-- ani nic jiného, a hlavně je to jasnější tady, u ostatní přípravy.
update public.employees set deleted_at = now() where id = :'e_smazany';

select set_config('test.z_cisnik',   :'z_cisnik',   false);
select set_config('test.e_cisnik',   :'e_cisnik',   false);
select set_config('test.e_vyjimka',  :'e_vyjimka',  false);
select set_config('test.e_brigadnik',:'e_brigadnik',false);


/*
  CIZÍ FIRMA. Zakládá se přímými zápisy pod superuživatelem, ne přes
  `app.create_tenant`: potřebujeme jen jedno zařazení s jedním právem
  a přesnou kontrolu nad tím, kdo v ní je.

  Firma se na konci scénáře zase MAŽE. Data, která scénář založí
  a neuklidí, nejsou jeho vlastní věc — běží nad touž databází jako
  všechno za ním (krok24 na tom už jednou spadl).
*/
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok33 Cizí s.r.o.', 'Krok33 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi \gset

insert into public.tenant_modules (tenant_id, module_key, status)
select :'cizi', m.key, 'active' from public.modules m where m.is_base;

insert into public.positions (tenant_id, key, label, department, active)
values (:'cizi', 'k33_cizi', 'Krok33 — cizí zařazení', 'provoz', true)
returning id as z_cizi \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'cizi', :'z_cizi', 'shifts.read'),
       (:'cizi', :'z_cizi', 'attendance.read');

-- Tentýž člověk pracuje v obou firmách. V cizí má práva, u nás nemá
-- zařazení žádné — a přesně na tom se pozná, jestli si tělo funkce
-- odfiltruje firmu samo.
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'cizi', '33330006-0000-0000-0000-000000000006', :'z_cizi', 'K33 Dvě Firmy', 'hpp')
returning id as e_cizi \gset

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'cizi', '33330006-0000-0000-0000-000000000006', null, 'active', 'tenant');

select set_config('test.cizi',   :'cizi',   false);
select set_config('test.e_cizi', :'e_cizi', false);

select pg_temp.check('příprava: obě firmy stojí a člověk je v obou',
  (select count(*) from public.memberships
    where user_id = '33330006-0000-0000-0000-000000000006'
      and status = 'active') = 2);


\echo ''
\echo '== 1. Zařazení dává svá práva ==========================='

set role authenticated;
select set_config('test.user_id', '33330001-0000-0000-0000-000000000001', false);

select pg_temp.check('číšník má práva svého zařazení',
  app.has_access(:'tenant', 'shifts.read', :'perla')
  and app.has_access(:'tenant', 'tasks.read', :'perla'));

select pg_temp.check('a nic navíc',
  not app.has_access(:'tenant', 'shifts.manage', :'perla')
  and not app.has_access(:'tenant', 'people.manage', null));


\echo ''
\echo '== 2.+3. Výjimka u člověka rozhoduje ===================='

reset role;
select set_config('test.user_id', '', false);

-- `granted = true` přidá právo, které zařazení nedává.
-- `granted = false` sebere právo, které zařazení dává.
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_vyjimka', 'shifts.manage', true),
       (:'tenant', :'e_vyjimka', 'shifts.read',   false);

set role authenticated;
select set_config('test.user_id', '33330002-0000-0000-0000-000000000002', false);

select pg_temp.check('výjimka granted = true dá právo, které zařazení nedává',
  app.has_access(:'tenant', 'shifts.manage', :'perla'));

/*
  Tohle je ta polovina, kterou by `exists` tiše zahodil. Kdyby se
  skládací pravidlo psalo přes `exists (…granted…)` místo `coalesce`,
  uměla by výjimka jen PŘIDÁVAT — odebrání by se ztratilo a nikde by
  to nespadlo.
*/
select pg_temp.check('výjimka granted = false sebere právo, které zařazení dává',
  not app.has_access(:'tenant', 'shifts.read', :'perla'));

-- Zpod superuživatele: `ma_pravo_clovek` je pro `authenticated`
-- odebraná schválně (syrové pravidlo bez modulu a bez rozsahu).
-- Na `auth.uid()` se neptá, takže odpověď je táž.
reset role;
select pg_temp.check('a kolegovi na témže zařazení to nesebere nic',
  app.ma_pravo_clovek(:'tenant', :'e_cisnik', 'shifts.read'));
set role authenticated;


\echo ''
\echo '== 4.+5. Změna zařazení platí hned — a výjimky nechá ====='

reset role;
select set_config('test.user_id', '', false);

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_cisnik', 'menus.read')
on conflict do nothing;

set role authenticated;

select set_config('test.user_id', '33330001-0000-0000-0000-000000000001', false);
select pg_temp.check('změna práv zařazení platí hned prvnímu',
  app.has_access(:'tenant', 'menus.read', :'perla'));

select set_config('test.user_id', '33330002-0000-0000-0000-000000000002', false);
select pg_temp.check('a hned i druhému — nic se nikomu nekopíruje',
  app.has_access(:'tenant', 'menus.read', :'perla'));

select pg_temp.check('a osobní výjimky to nepřepsalo',
  app.has_access(:'tenant', 'shifts.manage', :'perla')
  and not app.has_access(:'tenant', 'shifts.read', :'perla'));


\echo ''
\echo '== 6. Majitel dostává vše, i bez zařazení ================'

select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);

select pg_temp.check('majitel nemá žádné zařazení',
  (select position_id from public.employees
    where tenant_id = :'tenant'
      and user_id = (select user_id from public.profiles where email = 'majitel@foodtab.cz')
      and deleted_at is null) is null);

select pg_temp.check('a přesto má všechna práva zapnutých modulů',
  not exists (
    select 1 from public.permissions p
    join public.tenant_modules tm on tm.tenant_id = :'tenant'
                                 and tm.module_key = p.module_key
    where tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
      and not app.has_access(:'tenant', p.key, null)));


\echo ''
\echo '== 8. Bez zařazení a bez výjimek nemá nikdo nic =========='

select set_config('test.user_id', '33330003-0000-0000-0000-000000000003', false);

-- Ptáme se na KAŽDÉ právo z katalogu, ne na vybranou trojici. Jedno
-- zapomenuté právo je přesně ta díra, kterou by trojice nenašla.
select pg_temp.check('kdo nemá zařazení ani výjimku, nemá ani čtení',
  not exists (select 1 from public.permissions p
              where app.has_permission(:'tenant', p.key)));

select pg_temp.check('ani na pobočce',
  not exists (select 1 from public.permissions p
              where app.has_access(:'tenant', p.key, :'perla')));


\echo ''
\echo '== 9. ODDÍL 7b: tři filtry, tři kontroly ================='

/*
  Tři samostatné kontroly, a je to schválně. Jedna společná „cizí firma
  nevidí nic" by prošla i tehdy, kdyby v těle chyběly dva filtry ze tří:
  shodil by ji ten první a o zbylých by neřekla nic.

  Uvnitř `security definer` funkce vlastněné rolí s `rolbypassrls` se
  RLS neuplatní, takže tyhle tři podmínky jsou JEDINÉ, co ta data drží
  na místě.
*/

-- 9a) `e.tenant_id = p_tenant`
--
-- Ten člověk má v CIZÍ firmě zařazení s `shifts.read`. U nás je členem
-- taky, ale zařazení tu nemá žádné. Kdyby si tělo funkce nefiltrovalo
-- firmu samo, našlo by mu právo v cizí firmě a otevřelo ho v téhle.
select set_config('test.user_id', '33330006-0000-0000-0000-000000000006', false);

select pg_temp.check('příprava 9a: v cizí firmě to právo opravdu má',
  app.has_access(:'cizi', 'shifts.read', null));

select pg_temp.check('7b/1 — právo z cizí firmy se do téhle nepřenese',
  not app.has_permission(:'tenant', 'shifts.read')
  and not app.has_access(:'tenant', 'shifts.read', :'perla')
  and not app.has_access(:'tenant', 'shifts.read', null));

-- A totéž pro pomocnou funkci, ve které ten filtr NENÍ nadbytečný:
-- `app.ma_pravo_clovek` dostává rovnou `employee_id`, takže je to
-- jediné, co jí brání sáhnout do cizí firmy. Ptají se jí
-- `kdo_ma_pravo`, `adresati_vzkazu`, `ziva_prava_cloveka` i kontrola
-- citlivého práva v pozvánce.
reset role;
select pg_temp.check('7b/1 — a ani pomocná funkce na cizího zaměstnance nedosáhne',
  not app.ma_pravo_clovek(:'tenant', :'e_cizi', 'shifts.read'));
set role authenticated;
select set_config('test.user_id', '33330006-0000-0000-0000-000000000006', false);

-- 9b) `e.deleted_at is null`
--
-- Mazání lidí je označení, ne výmaz (pravidlo 9) — řádek tedy zůstává
-- i s zařazením a jeho právy. Drží ho jedině tenhle filtr.
-- (Je to zároveň kontrola 14 ze zadání.)
select set_config('test.user_id', '33330004-0000-0000-0000-000000000004', false);

select pg_temp.check('příprava 9b: ten člověk je označený smazaný a zařazení má',
  (select deleted_at is not null and position_id is not null
     from public.employees where id = :'e_smazany'));

select pg_temp.check('7b/2 — označený smazaný nemá nic',
  not app.has_permission(:'tenant', 'shifts.read')
  and not app.has_access(:'tenant', 'shifts.read', :'perla')
  and not exists (select 1 from public.permissions p
                  where app.has_permission(:'tenant', p.key)));

-- 9c) `m.status = 'active'`
--
-- Pozastavené členství není členství. Zaměstnanec je živý a zařazení
-- má — jediné, co ho drží venku, je tahle podmínka.
select set_config('test.user_id', '33330005-0000-0000-0000-000000000005', false);

select pg_temp.check('příprava 9c: členství je pozastavené, zaměstnanec živý',
  (select status from public.memberships
    where tenant_id = :'tenant'
      and user_id = '33330005-0000-0000-0000-000000000005') = 'suspended');

select pg_temp.check('7b/3 — zrušené členství práva nedává',
  not app.has_permission(:'tenant', 'shifts.read')
  and not app.has_access(:'tenant', 'shifts.read', :'perla')
  and not exists (select 1 from public.permissions p
                  where app.has_permission(:'tenant', p.key)));


\echo ''
\echo '== 10. Vypnutý modul zneúčinní i právo ze zařazení ======='

reset role;
select set_config('test.user_id', '', false);

/*
  Modul Finance je od etapy 0 zapnutý. Pro tuhle jednu kontrolu se
  pozastaví a hned zase vrátí; původní stav se schová do proměnné —
  natvrdo psané 'active' by přepsalo případné zkušební období.
*/
select coalesce((select status from public.tenant_modules
                 where tenant_id = :'tenant' and module_key = 'finance'),
                'chybi') as fin_stav \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_cisnik', 'finance.read')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', '33330001-0000-0000-0000-000000000001', false);

select pg_temp.check('se zapnutým modulem to zařazení právo dává',
  app.has_access(:'tenant', 'finance.read', null));

reset role;
select set_config('test.user_id', '', false);
update public.tenant_modules set status = 'suspended'
 where tenant_id = :'tenant' and module_key = 'finance';

set role authenticated;
select set_config('test.user_id', '33330001-0000-0000-0000-000000000001', false);

select pg_temp.check('vypnutý modul ho zneúčinní, i když ho zařazení dává',
  not app.has_access(:'tenant', 'finance.read', null));

-- A ani majiteli. Modulová brána je v těle PŘED větví majitele
-- schválně: majitel dostává vše z AKTIVNÍCH modulů, ne vše vůbec.
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);
select pg_temp.check('a ani majiteli',
  not app.has_access(:'tenant', 'finance.read', null));

reset role;
select set_config('test.user_id', '', false);
update public.tenant_modules set status = :'fin_stav'
 where tenant_id = :'tenant' and module_key = 'finance'
   and :'fin_stav' <> 'chybi';

delete from public.position_permissions
 where position_id = :'z_cisnik' and permission_key = 'finance.read';


\echo ''
\echo '== 11. Rozsah pobočky platí dál ========================='

set role authenticated;
select set_config('test.user_id', '33330007-0000-0000-0000-000000000007', false);

select pg_temp.check('na své pobočce právo ze zařazení platí',
  app.has_access(:'tenant', 'shifts.read', :'perla'));

select pg_temp.check('na cizí pobočce ne',
  not app.has_access(:'tenant', 'shifts.read', :'bar'));

select pg_temp.check('a na firemní úrovni taky ne',
  not app.has_access(:'tenant', 'shifts.read', null));

reset role;
select set_config('test.user_id', '', false);
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_pobocka', 'attendance.read', true);

set role authenticated;
select set_config('test.user_id', '33330007-0000-0000-0000-000000000007', false);

/*
  Výjimka je „CO", ne „KDE". Rozsah zůstal na členství a tahle kontrola
  je tu proto, že je to nejlákavější místo, kde se dá pravidlo 4
  z CLAUDE.md omylem obejít.
*/
select pg_temp.check('ani výjimka rozsah nepřebije',
  app.has_access(:'tenant', 'attendance.read', :'perla')
  and not app.has_access(:'tenant', 'attendance.read', :'bar')
  and not app.has_access(:'tenant', 'attendance.read', null));


\echo ''
\echo '== 12. Nikdo nepřidělí víc, než má sám =================='

set role authenticated;
select set_config('test.user_id', '33330008-0000-0000-0000-000000000008', false);

select pg_temp.check('správce attendance.read opravdu nemá',
  not app.has_access(:'tenant', 'attendance.read', null));

/*
  Přeřazení pod zařazení, které nese právo navíc, hlídá SPOUŠŤ
  `trg_strop_zarazeni` — a spoušť platí i v PGlite, kde se běží jako
  superuživatel a RLS se neuplatní.

  Politika by to neuhlídala: u UPDATE nevidí starou hodnotu, takže by
  strop platil i na řádek, kde se `position_id` vůbec nemění, a úprava
  telefonu by spadla na oprávnění. A hlavně by MLČELA — politika nic
  neprovede a netváří se to jako chyba.
*/
do $$
declare v_ok boolean := false; v_citlive uuid;
begin
  -- Zařazení s `payroll.read` zakládá krok7. Kdyby zmizelo, tahle
  -- kontrola by přeřadila pod NULL, nic by nespadlo a tvářila by se
  -- jako splněná — proto se jeho existence ověřuje nahlas.
  select id into v_citlive from public.positions
   where tenant_id = current_setting('test.tenant')::uuid and key = 'zkouska_citliva';
  if v_citlive is null then
    raise exception 'SELHALO: příprava — zařazení zkouska_citliva chybí';
  end if;

  begin
    update public.employees set position_id = v_citlive
     where id = current_setting('test.e_brigadnik')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('kdo právo nemá, nepřeřadí pod zařazení, které ho nese', v_ok);
end $$;

select pg_temp.check('a to zařazení se opravdu nezměnilo',
  (select position_id from public.employees where id = :'e_brigadnik') = :'z_cisnik');

/*
  Druhá polovina téhož pravidla — zápis práva do `position_permissions`
  a výjimky do `employee_permissions` — visí na POLITICE.

  Sám zápis se tu ale zkoušet NEDÁ: v PGlite se běží jako superuživatel,
  politika se neuplatní a insert prostě projde. Kontrola, která by ho
  zkusila a čekala chybu, by tady byla červená nad správným kódem —
  a to je horší než žádná.

  Ověřuje se proto ROZHODNUTÍ, ne jeho vynucení: tentýž výraz, na který
  se ptá politika. Když vyjde „ne", politika zápis odmítne — a že ho
  opravdu odmítne, rozhodne až běh proti PostgreSQL (zadání, oddíl 10).
*/
select pg_temp.check('a stropu na zápis práva by ten člověk neprošel',
  not (
    app.has_access(:'tenant', 'attendance.read', null)
    or not app.pravo_zive(:'tenant', 'attendance.read')
  ));

select pg_temp.check('zatímco na právo, které sám má, projde',
  app.has_access(:'tenant', 'shifts.read', null)
  or not app.pravo_zive(:'tenant', 'shifts.read'));


\echo ''
\echo '== 13. Člověk bez účtu: uloží se, ale neotevře nic ======='

select pg_temp.check('brigádník bez účtu zařazení s právy má',
  (select user_id is null and position_id is not null
     from public.employees where id = :'e_brigadnik'));

select pg_temp.check('a to zařazení opravdu nějaká práva nese',
  (select count(*) from public.position_permissions
    where position_id = :'z_cisnik') > 0);

/*
  A přesto to nikomu nic neotevře: `has_permission` se ptá `auth.uid()`,
  takže bez účtu není komu ta práva dát. Je to zadání, oddíl 3 —
  „zadané dřív, účinné později".
*/
reset role;
select pg_temp.check('na papíře ta práva má',
  app.ma_pravo_clovek(:'tenant', :'e_brigadnik', 'shifts.read'));

select pg_temp.check('a přesto se přes něj nikdo nikam nedostane',
  (select user_id from public.employees where id = :'e_brigadnik') is null
  and not exists (
    select 1 from public.memberships m
    join public.employees e on e.tenant_id = m.tenant_id and e.user_id = m.user_id
    where e.id = :'e_brigadnik'));


\echo ''
\echo '== 14. Podle rolí už nerozhoduje nic ====================='

reset role;

/*
  KONTROLA PROTI NÁVRATU, ne proti dnešnímu stavu.

  `krok30` hlídá jádro jmenovitě. Tahle se ptá CELÉHO schématu `app`,
  protože přesně tam byla ta past: nálezy vyjmenovaly devět opsaných
  kopií, při práci se našly ještě dvě a ani jedna z nich by nespadla —
  běžely by dál nad tabulkou, která už nikoho neřídí, a build by
  zůstal zelený.

  Výjimka je `app.prevod_zarazeni`: ta z rolí čte SCHVÁLNĚ, je to
  převod dat. Je vyjmenovaná, aby se nedalo přidat dvanácté místo
  a schovat ho za „to je jako ten převod".
*/
select pg_temp.check('žádná funkce v app už práva z rolí nečte',
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      -- Jen obyčejné funkce: 'pg_get_functiondef' nad agregátem spadne.
      and p.prokind = 'f'
      and p.proname <> 'prevod_zarazeni'
      and pg_get_functiondef(p.oid) like '%from public.role_permissions%'));

select pg_temp.check('a ani se neptá, kdo je majitel, podle roles.is_owner',
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      -- Jen obyčejné funkce: 'pg_get_functiondef' nad agregátem spadne.
      and p.prokind = 'f'
      and p.proname <> 'prevod_zarazeni'
      and pg_get_functiondef(p.oid) like '%r.is_owner%'));

/*
  A mrtvá funkce se nenechává stát. `app.ziva_prava_role` se tvářila
  jako autorita nad oprávněními, měla grant pro `authenticated`
  a počítala z tabulky, kterou už nikdo neudržuje. Kdo ji za rok
  najde, nemá jak poznat, že neplatí: vrátí vždycky nějakou odpověď
  a ta bude vypadat správně.
*/
select pg_temp.check('a mrtvá app.ziva_prava_role je pryč',
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'ziva_prava_role'));


\echo ''
\echo '== 15. Úklid ============================================'

reset role;
select set_config('test.user_id', '', false);

/*
  Cizí firma se maže. Kdyby zůstala, počítaly by ji scénáře za tímhle
  (marketing1 si bere `tenants limit 1`) — a data, která scénář založí
  a neuklidí, nejsou jeho vlastní věc.
*/
delete from public.tenants where id = :'cizi';

select pg_temp.check('cizí firma je uklizená',
  not exists (select 1 from public.tenants where id = :'cizi'));

select pg_temp.check('a naše firma zůstala nedotčená',
  exists (select 1 from public.tenants where id = :'tenant'));


\echo ''
\echo '== KROK 33 HOTOV ========================================'
