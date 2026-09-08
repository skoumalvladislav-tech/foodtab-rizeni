-- Scénář pro krok 30 — oprávnění na zařazení: převod dat
--
-- Pokrývá migraci 20260908090000_zarazeni_prava a zadání
-- docs/zarazeni-cisla-z-ostre-databaze.md, oddíl 3.
--
-- Navazuje na etapa0_scenar.sql až krok29_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Závazné pravidlo převodu (zadání 5.4): PO PŘEVODU MÁ KAŽDÝ PŘESNĚ TA
-- PRÁVA, KTERÁ MÁ DNES. Nikdo nesmí získat právo navíc a nikdo o žádné
-- přijít.
--
-- Nejdůležitější kontrola v tomhle souboru je ta poslední: porovná sadu
-- práv každého člověka ze starého a nového modelu a musí vyjít stejná.
-- Všechno ostatní je jen příprava, aby měla co porovnávat.
--
-- PROČ SE PŘEVOD POUŠTÍ ZNOVU. Scénáře běží nad prázdnou databází:
-- migrace projdou dřív, než vůbec nějaká firma vznikne, takže převod
-- v nich nemá co převádět. Kontrola „sedí to" by prošla i nad úplně
-- rozbitým převodem — a to je přesně ta kontrola, co projde nad
-- rozbitým kódem. Převod je proto funkce `app.prevod_zarazeni()`,
-- idempotentní, a volá se tu podruhé nad opravdovými daty.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

-- Auditní řádky, které převod vyrobí, ať nejsou připsané cizímu
-- člověku z předchozího scénáře.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select id as role_bar from public.roles
 where tenant_id = :'tenant' and key = 'bar' \gset

/*
  PAST, KVŮLI KTERÉ SE PRAVIDLO PRŮNIKU MĚNILO.

  Zařazení, které má DVA lidi: jednoho s aktivní rolí a jednoho BEZ
  ÚČTU. Přesně tak vypadá v ostrých datech Barman
  (docs/zarazeni-cisla-z-ostre-databaze.md, 2.3).

  Kdyby průnik počítal přes oba, vyjde prázdná množina a člověku s rolí
  se tiše sebere všech deset práv. Proto do průniku vstupují jen lidé
  s aktivní rolí.

  Zařazení je schválně NEAKTIVNÍ (`active = false`) — Barman takový
  v ostrých datech je, a převod ho přeskočit nesmí (2.4).
*/
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'barman_zk', 'Krok30 — barman', 'bar', false)
on conflict (tenant_id, key) do update set active = false
returning id as poz_barman \gset

insert into auth.users (id, email)
values ('30300000-0000-0000-0000-000000000030', 'barman.zk@foodtab.cz')
on conflict (id) do nothing;

insert into public.profiles (user_id, email, full_name)
values ('30300000-0000-0000-0000-000000000030', 'barman.zk@foodtab.cz', 'Krok30 Barman')
on conflict (user_id) do nothing;

-- Ten s účtem a rolí Bar.
insert into public.employees
  (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '30300000-0000-0000-0000-000000000030',
        :'poz_barman', 'Krok30 Barman', 'hpp')
returning id as e_sucetem \gset

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', '30300000-0000-0000-0000-000000000030', :'role_bar', 'active', 'branch')
returning id as clenstvi \gset

-- `membership_branches` se váže na členství, ne na dvojici firma+člověk.
insert into public.membership_branches (membership_id, branch_id)
values (:'clenstvi', :'perla')
on conflict do nothing;

-- A ten BEZ účtu, na témže zařazení. Tenhle průnik srazit nesmí.
insert into public.employees
  (tenant_id, branch_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'poz_barman', 'Krok30 Brigadnik', 'dpp')
returning id as e_bezuctu \gset

select pg_temp.check('příprava: zařazení má dva lidi, jeden bez účtu',
  (select count(*) from public.employees
    where position_id = :'poz_barman' and deleted_at is null) = 2
  and (select count(*) from public.employees
        where position_id = :'poz_barman' and user_id is null) = 1);

select count(*) as prav_bar from public.role_permissions
 where role_id = :'role_bar' \gset

select pg_temp.check('příprava: role Bar nějaká práva má',
  :'prav_bar'::int > 0);


-- =====================================================================
-- 1. SNÍMEK STARÉHO STAVU
--
-- Papírová práva každého nesmazaného člověka podle DNEŠNÍHO modelu:
-- členství -> role -> role_permissions. Majitelé se neberou — nemají
-- v role_permissions ani řádek a všechno dostávají zkratkou is_owner.
-- =====================================================================

create temporary table t_pred as
select e.id as employee_id, rp.permission_key
from public.employees e
join public.memberships m
  on  m.tenant_id = e.tenant_id
  and m.user_id   = e.user_id
  and m.status    = 'active'
join public.roles r on r.id = m.role_id and not r.is_owner
join public.role_permissions rp on rp.role_id = r.id
where e.tenant_id = :'tenant' and e.deleted_at is null;

select count(*) as pred_radku from t_pred \gset

select pg_temp.check('snímek starého stavu není prázdný',
  :'pred_radku'::int > 0);


\echo ''
\echo '== 2. Převod ============================================'

select app.prevod_zarazeni();


-- =====================================================================
-- 3. CO PŘEVOD UDĚLAL
-- =====================================================================

select pg_temp.check('neaktivní zařazení dostalo práva role, ne prázdno',
  (select count(*) from public.position_permissions
    where position_id = :'poz_barman') = :'prav_bar'::int);

select pg_temp.check('člověk bez účtu průnik nesrazil',
  not exists (
    select 1 from public.employee_permissions
    where employee_id = :'e_sucetem'));

select pg_temp.check('a sám žádná práva nedostal',
  not exists (
    select 1 from public.employee_permissions
    where employee_id = :'e_bezuctu'));

select pg_temp.check('majitel má je_majitel',
  exists (
    select 1 from public.employees e
    join public.memberships m
      on m.tenant_id = e.tenant_id and m.user_id = e.user_id and m.status = 'active'
    join public.roles r on r.id = m.role_id and r.is_owner
    where e.tenant_id = :'tenant' and e.je_majitel));

/*
  Role bez členů se nesmí zahodit — jsou to připravené sady pro lidi,
  které Šéfík právě zve. Účetní má v katalogu dvě práva a nikoho.
*/
select pg_temp.check('z role bez členů vzniklo zařazení i s právy',
  exists (
    select 1
    from public.roles r
    join public.positions p on p.tenant_id = r.tenant_id and p.key = r.key
    join public.position_permissions pp on pp.position_id = p.id
    where r.tenant_id = :'tenant' and r.key = 'ucetni'));

select pg_temp.check('a nikdo na ně přiřazený není',
  not exists (
    select 1 from public.employees e
    join public.positions p on p.id = e.position_id
    where p.tenant_id = :'tenant' and p.key = 'ucetni'
      and e.deleted_at is null));


-- =====================================================================
-- 4. TO PODSTATNÉ: PŘED A PO SE MUSÍ ROVNAT
--
-- Pro každého člověka se porovná sada práv ze starého modelu se sadou
-- z nového (zařazení + výjimky, s výjimkou přebíjející zařazení oběma
-- směry). Rozdíl v kterémkoli směru je chyba.
--
-- POROVNÁVÁ SE JEN NAD LIDMI S ÚČTEM A ŽIVÝM ČLENSTVÍM, a je to
-- podstatné rozhodnutí, ne zúžení pro pohodlí.
--
-- Člověk bez účtu dnes nemá žádná práva — nemá komu je dát. Po převodu
-- ale „má" práva svého zařazení, protože ta visí na zařazení a on ho
-- má taky. Není to chyba převodu, je to přesně to, co zadání chce
-- (oddíl 3: „zadané dřív, účinné později") — brigádníkovi se dá
-- oprávnění nastavit a začne platit, jakmile se přihlásí.
--
-- Kdyby se do porovnání zahrnul, spadlo by to nad SPRÁVNÝM chováním.
-- A kdyby se naopak porovnávalo přes všechny bez rozmyslu, kontrola by
-- říkala něco jiného, než se tváří.
--
-- Ta kontrola to sama chytila: napoprvé spadla právě na brigádníkovi
-- z přípravy výš.
-- =====================================================================

create temporary table t_po as
select e.id as employee_id, x.permission_key
from public.employees e
join lateral (
  select pp.permission_key
    from public.position_permissions pp where pp.position_id = e.position_id
  union
  select ep.permission_key
    from public.employee_permissions ep where ep.employee_id = e.id and ep.granted
  except
  select ep.permission_key
    from public.employee_permissions ep where ep.employee_id = e.id and not ep.granted
) x on true
where e.tenant_id = :'tenant'
  and e.deleted_at is null
  and not e.je_majitel
  and e.user_id is not null
  and exists (
    select 1 from public.memberships m
    where m.tenant_id = e.tenant_id and m.user_id = e.user_id
      and m.status = 'active'
  );

select pg_temp.check('nikdo o žádné právo nepřišel',
  not exists (
    select employee_id, permission_key from t_pred
    except
    select employee_id, permission_key from t_po));

select pg_temp.check('a nikdo žádné nezískal navíc',
  not exists (
    select employee_id, permission_key from t_po
    except
    select employee_id, permission_key from t_pred));


-- =====================================================================
-- 5. NOVÉ TABULKY ZATÍM NIKDO NEČTE — a je to schválně
-- =====================================================================

/*
  Migrace nesahá na `app.has_permission` ani `app.has_access`, takže
  o přístupu pořád rozhodují role. Kdyby to někdo příště přepnul a
  zapomněl na zbytek, tahle kontrola spadne a přinutí ho podívat se do
  docs/zarazeni-misto-roli-nalezy.md — je tam devět dalších míst mimo
  has_access, která se musí přepsat naráz.
*/
select pg_temp.check('o přístupu zatím pořád rozhodují role',
  (select pg_get_functiondef(p.oid) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'has_permission')
  like '%role_permissions%');

/*
  RLS a granty. Pod superuživatelem se neprojeví ani jedno, takže se to
  musí zkusit pod rolí `authenticated` — jinak by kontrola prošla i nad
  tabulkou bez grantu. Vzor je krok26_scenar.
*/
select pg_temp.check('obě nové tabulky mají zapnuté RLS',
  (select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('position_permissions', 'employee_permissions')
      and c.relrowsecurity) = 2);

select pg_temp.check('a mají pro authenticated grant',
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('position_permissions', 'employee_permissions')
      and grantee = 'authenticated'
      and privilege_type = 'SELECT') = 2);

select pg_temp.check('nový sloupec je_majitel jde číst pod authenticated',
  exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'je_majitel' and grantee = 'authenticated'
      and privilege_type = 'SELECT'));


\echo ''
\echo '== KROK 30 HOTOV ========================================'
