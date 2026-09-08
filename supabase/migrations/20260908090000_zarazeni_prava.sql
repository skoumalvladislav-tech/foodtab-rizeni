-- =====================================================================
-- Foodtab — oprávnění na zařazení: TABULKY A PŘEVOD DAT
--
-- Zadání: docs/zarazeni-misto-roli.md, oddíl 5.
-- Konečná podoba převodu: docs/zarazeni-cisla-z-ostre-databaze.md, oddíl 3
-- (měřeno na ostrých datech 8. 9. 2026, ne odhad).
--
-- ---------------------------------------------------------------------
-- CO TAHLE MIGRACE DĚLÁ — A CO SCHVÁLNĚ NEDĚLÁ
--
-- DĚLÁ: zakládá `position_permissions` a `employee_permissions`,
-- přidává `employees.je_majitel` a PŘEVÁDÍ do nich dnešní stav.
--
-- NEDĚLÁ: nesahá na `app.has_permission` ani `app.has_access`. Po téhle
-- migraci rozhodují o přístupu pořád role, přesně jako dnes. Nové
-- tabulky zatím nikdo nečte.
--
-- **A to je záměr, ne nedodělek.** Zadání v 7.2 zakazuje nechat
-- v repozitáři poloviční přepnutí oprávnění — jenže „poloviční" je
-- stav, kdy `has_access` už čte nové tabulky a zbytek aplikace ještě
-- počítá s rolemi. Tenhle krok takový není: nic se nechová jinak,
-- protože nic nové tabulky nečte. Je to příprava, kterou jde kdykoli
-- zahodit `drop table` a nikomu se nezmění ani jedno právo.
--
-- Proč se to dělí právě tady, je vypsané v
-- `docs/zarazeni-misto-roli-nalezy.md`: přepnutí samo znamená ještě
-- devět dalších míst mimo `has_access`, `visible_branch_ids`,
-- `my_context`, `cekaji_na_opravneni` a tři místa v aplikaci, kde by
-- se jinak zavřel vchod všem včetně majitele.
--
-- ---------------------------------------------------------------------
-- POŘADÍ MIGRACÍ JE TU SOUČÁST ZADÁNÍ
--
-- `ai.use` sedí v ostré databázi na pěti rolích a
-- `20260907020000_ai_use_pryc` v ní ještě není nasazená. Kdyby převod
-- proběhl DŘÍV než ona, zkopíroval by `ai.use` do
-- `position_permissions` — a `ai_use_pryc` už ho tam neuklidí, protože
-- míří na `role_permissions`. Zůstalo by přidělené právo k modulu,
-- který neexistuje.
--
-- Časové razítko to řeší samo: `20260908…` je až za `20260907020000`.
-- **Tuhle migraci proto nikdy nedatuj dozadu.**
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. MAJITEL JE OSOBA, NE PRACOVNÍ ZAŘAZENÍ
-- ---------------------------------------------------------------------

alter table public.employees
  add column je_majitel boolean not null default false;

comment on column public.employees.je_majitel is
  'Majitel firmy. Přesouvá se sem z roles.is_owner — Šéfík může být '
  'v rozpisu vedený jako provozní, majitelství je vlastnost člověka.';

/*
  BEZ TOHOHLE GRANTU SPADNE CELÁ OBRAZOVKA, NE SLOUPEC.

  `employees` nemá celotabulkový `select` — od
  20260901120000_osobni_udaje.sql se uděluje PO SLOUPCÍCH, aby se
  telefon a e-mail četly jen průzorem. Nový sloupec se do toho výčtu
  sám nepřidá a dotaz, který si o něj řekne, dostane 42501 dřív, než
  se dostane na řádky.

  Přesně takhle položil `employees.color` Lidi i Rozpis směn 3. 9.
  večer, uprostřed ostrého testu. CLAUDE.md to má zapsané.
*/
grant select (je_majitel) on public.employees to authenticated;

/*
  INDEX NA JEDINÉHO MAJITELE TU SCHVÁLNĚ NENÍ.

  Zadání (5.2) ho chtělo. Jenže `docs/vlastniku-muze-byt-vic.md` a
  hlavička 20260902010000_posledni_majitel.sql říkají opak — a měření
  z 8. 9. potvrdilo, že **ostrá firma má majitele dva**
  (docs/zarazeni-cisla-z-ostre-databaze.md, 2.1). Ten index by na
  ostrých datech spadl UPROSTŘED migrace a firma by zůstala s novými
  tabulkami a starými daty.

  Až se rozhodne, že má být majitel jeden, musí se nejdřív říct KTERÝ
  ze dvou — a teprve pak se index smí přidat. Otázka 6 v
  docs/hlaseni/otazky.md.
*/


-- ---------------------------------------------------------------------
-- 2. PRÁVA ZAŘAZENÍ
--
-- Živé pravidlo: změna práv zařazení platí hned pro všechny, kdo ho
-- mají. Proto se práva vážou na zařazení, ne na člověka.
-- ---------------------------------------------------------------------

create table public.position_permissions (
  -- Vlastní `id` je tu kvůli AUDITU, ne kvůli dotazům. `app.audit_zmenu`
  -- skládá jméno řádku z `id`, a když ho tabulka nemá, sáhne po
  -- `role_id || ':' || permission_key` — což tady není, takže by se
  -- do auditu zapsal prázdný klíč (20260831020000, ř. 70-74).
  id             uuid primary key default gen_random_uuid(),
  -- A `tenant_id` je tu ze stejného soudku: bez něj vyjde v auditu
  -- `v_tenant` NULL a funkce udělá `return null`. Audit by ZMLKL TIŠE,
  -- bez chyby — u tabulky, která rozdává oprávnění.
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  position_id    uuid not null references public.positions(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  unique (position_id, permission_key)
);

comment on table public.position_permissions is
  'Oprávnění, která dává zařazení. Změna platí hned všem, kdo ho mají.';

create index position_permissions_firma
  on public.position_permissions (tenant_id, position_id);

alter table public.position_permissions enable row level security;

/*
  ČTE KAŽDÝ ČLEN FIRMY, stejně jako `positions` samotné.

  Formulář zaměstnance předvyplňuje zaškrtávátka ze zařazení, takže se
  ta sada musí dát přečíst. Není na ní nic osobního — je to popis
  zařazení, ne konkrétního člověka.
*/
create policy position_permissions_select on public.position_permissions
  for select to authenticated
  using (app.is_member(tenant_id));

/*
  MĚNIT JEN SE `settings.manage`, a bez třetího parametru.

  `positions` nemá `branch_id` — zařazení platí za celou firmu —, takže
  se `app.has_access` volá s `null` a ne s pobočkou. Kdyby se sem dala
  pobočka, ptala by se politika na něco, co u téhle tabulky neexistuje.
*/
create policy position_permissions_write on public.position_permissions
  for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null))
  with check (app.has_access(tenant_id, 'settings.manage', null));

grant select, insert, update, delete
  on public.position_permissions to authenticated;

create trigger trg_audit_position_permissions
  after insert or update or delete on public.position_permissions
  for each row execute function app.audit_zmenu('opravneni_zarazeni');


-- ---------------------------------------------------------------------
-- 3. VÝJIMKA U JEDNOHO ČLOVĚKA
--
-- Přebíjí zařazení OBĚMA směry: `granted = true` právo přidá,
-- `granted = false` ho sebere navzdory zařazení.
-- ---------------------------------------------------------------------

create table public.employee_permissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted        boolean not null,
  unique (employee_id, permission_key)
);

comment on table public.employee_permissions is
  'Výjimka u jednoho člověka. granted = true přidává nad rámec '
  'zařazení, false odebírá navzdory zařazení. Změna zařazení výjimky '
  'nepřepisuje.';

create index employee_permissions_firma
  on public.employee_permissions (tenant_id, employee_id);

alter table public.employee_permissions enable row level security;

/*
  ČÍST SVOJE SMÍ KAŽDÝ, cizí jen kdo spravuje nastavení.

  Nedělá se to přes „co vidíš na `employees`" schválně: politika
  `employees_select` (20260823120200_authz.sql, ř. 365-370) pouští
  čtení zaměstnanců každému, kdo má na pobočce `shifts.read` — takový
  zápis by otevřel seznam práv kolegů každému číšníkovi. Zadání chce
  „číst svoje smí každý", a to je něco jiného.
*/
create policy employee_permissions_select on public.employee_permissions
  for select to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = employee_id
        and e.user_id = (select auth.uid())
    )
    or app.has_access(tenant_id, 'settings.manage', null)
  );

create policy employee_permissions_write on public.employee_permissions
  for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null))
  with check (app.has_access(tenant_id, 'settings.manage', null));

grant select, insert, update, delete
  on public.employee_permissions to authenticated;

create trigger trg_audit_employee_permissions
  after insert or update or delete on public.employee_permissions
  for each row execute function app.audit_zmenu('opravneni_cloveka');


-- ---------------------------------------------------------------------
-- 4. PŘEVOD DAT
--
-- Je to FUNKCE, ne holé příkazy, a to ze dvou důvodů:
--
--   1. scénář ji musí umět zavolat znovu, aby doložil „před a po".
--      Migrace běží nad prázdnou databází dřív, než vůbec nějaká firma
--      vznikne, takže by tam převod neměl co převádět — a kontrola by
--      prošla i nad rozbitým převodem.
--   2. je idempotentní (`on conflict do nothing`), takže druhé spuštění
--      nic nezdvojí.
--
-- ZÁVAZNÉ PRAVIDLO (zadání 5.4): po převodu má každý přesně ta práva,
-- která má dnes. Nikdo nesmí získat právo navíc a nikdo o žádné přijít.
-- Doložit to musí kontrola ve scénáři, ne tenhle komentář.
-- ---------------------------------------------------------------------

create or replace function app.prevod_zarazeni()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  /*
    1. MAJITELÉ. Práva se jim nepřevádějí — nemají v `role_permissions`
    ani jeden řádek a všechno dostávají zkratkou `is_owner`. Kdo by je
    převáděl řádek po řádku, převede je jako lidi bez práv.
  */
  update public.employees e
     set je_majitel = true
   where e.deleted_at is null
     and e.user_id is not null
     and exists (
       select 1 from public.memberships m
       join public.roles r on r.id = m.role_id
       where m.tenant_id = e.tenant_id
         and m.user_id   = e.user_id
         and m.status    = 'active'
         and r.is_owner
     );

  /*
    2. PRŮNIK NA ZAŘAZENÍ — a tady je ta oprava, na které to celé stálo.

    Původní pravidlo znělo „vezmi lidi, kteří to zařazení mají, a udělej
    průnik jejich práv". Na ostrých datech by to vyrobilo PRÁZDNO:
    zařazení Barman mají dva lidé, jeden s rolí Bar (10 práv) a druhý
    BEZ ÚČTU (žádná práva). Průnik přes oba je prázdná množina — Barman
    by nedostal nic, deset práv by spadlo do výjimek a živé pravidlo
    „změna zařazení platí hned všem" by bylo mrtvé v den nasazení.
    A tomu člověku s rolí Bar by se tím tiše sebralo deset práv.

    Do průniku proto vstupují JEN lidé s aktivní rolí. Kdo účet nemá,
    o právech zařazení nerozhoduje — dnes žádná nemá.
    (docs/zarazeni-cisla-z-ostre-databaze.md, 2.3)

    A bere se to bez ohledu na `positions.active`: Barman je NEAKTIVNÍ
    a přesto na něm visí člověk s rolí. Kdyby se neaktivní zařazení
    přeskočilo, přijde o deset práv a nikdo si toho nevšimne (2.4).
  */
  insert into public.position_permissions (tenant_id, position_id, permission_key)
  with dnes as (
    select e.id as employee_id, e.tenant_id, e.position_id, rp.permission_key
    from public.employees e
    join public.memberships m
      on  m.tenant_id = e.tenant_id
      and m.user_id   = e.user_id
      and m.status    = 'active'
    join public.roles r
      on  r.id = m.role_id
      and not r.is_owner
    join public.role_permissions rp on rp.role_id = r.id
    where e.deleted_at is null
  ),
  lide as (
    select distinct employee_id, tenant_id, position_id
    from dnes where position_id is not null
  ),
  pocty as (
    select position_id, count(*) as n from lide group by 1
  )
  select d.tenant_id, d.position_id, d.permission_key
  from dnes d
  join pocty c on c.position_id = d.position_id
  where d.position_id is not null
  group by d.tenant_id, d.position_id, d.permission_key, c.n
  having count(distinct d.employee_id) = c.n
  on conflict do nothing;

  /*
    3. CO MÁ ČLOVĚK NAVÍC oproti průniku, je jeho výjimka.

    Pokrývá to zároveň lidi BEZ zařazení: `position_id` je NULL, spojení
    nenajde nic a dostanou všechna svá práva jako výjimky.

    Na dnešních ostrých datech nevyjde ani jedna — po opravě průniku
    sedí Barman na práva role Bar a Kuchař/ka na práva role Kuchyně.
    Zapsané to je proto, že jednou vyjde.

    Převod nikdy nezapíše `granted = false`. Ta hodnota vzniká až rukou
    v aplikaci, když někomu právo odebereš navzdory zařazení.
  */
  insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
  with dnes as (
    select e.id as employee_id, e.tenant_id, e.position_id, rp.permission_key
    from public.employees e
    join public.memberships m
      on  m.tenant_id = e.tenant_id
      and m.user_id   = e.user_id
      and m.status    = 'active'
    join public.roles r
      on  r.id = m.role_id
      and not r.is_owner
    join public.role_permissions rp on rp.role_id = r.id
    where e.deleted_at is null
  )
  select d.tenant_id, d.employee_id, d.permission_key, true
  from dnes d
  left join public.position_permissions pp
    on  pp.position_id    = d.position_id
    and pp.permission_key = d.permission_key
  where pp.permission_key is null
  on conflict do nothing;

  /*
    4. ROLE BEZ ČLENŮ SE NESMÍ ZAHODIT.

    Provozní (29 práv), Vedoucí směny (13), Servis (6) a Účetní (2)
    dnes nemá nikdo. Kdyby se zařazení tvořila jen z rolí, které někdo
    má, těch padesát zaškrtnutých práv zmizí — a jsou to připravené
    sady pro lidi, které Šéfík právě zve (2.5).

    `department` se odvozuje jen tam, kde se klíč trefí do dnešního
    pevného výčtu; jinak `provoz`. Hádat ho za Šéfíka nemá smysl —
    `department` stejně končí, nahradí ho `useky` (zadání, oddíl 7).
  */
  insert into public.positions (tenant_id, key, label, department, active)
  select r.tenant_id, r.key, r.label,
         case when r.key in ('kuchyne', 'bar', 'servis') then r.key else 'provoz' end,
         true
  from public.roles r
  where not r.is_owner
    and not exists (
      select 1 from public.memberships m
      where m.role_id = r.id and m.status = 'active'
    )
  on conflict (tenant_id, key) do nothing;

  /*
    A jejich práva. Píše se jen na zařazení, které NIKDO nemá a které
    ještě žádná práva nemá — tedy na to, co se právě založilo o krok
    výš. Kdyby klíč role kolidoval s existujícím zařazením, `on conflict
    do nothing` výš ho nechá být a tahle podmínka mu nedopíše cizí
    práva. Bez ní by se z náhody ve jménech stalo přidělení oprávnění.
  */
  insert into public.position_permissions (tenant_id, position_id, permission_key)
  select p.tenant_id, p.id, rp.permission_key
  from public.roles r
  join public.positions p
    on p.tenant_id = r.tenant_id and p.key = r.key
  join public.role_permissions rp on rp.role_id = r.id
  where not r.is_owner
    and not exists (
      select 1 from public.memberships m
      where m.role_id = r.id and m.status = 'active'
    )
    and not exists (
      select 1 from public.employees e
      where e.position_id = p.id and e.deleted_at is null
    )
    and not exists (
      select 1 from public.position_permissions x where x.position_id = p.id
    )
  on conflict do nothing;

  /*
    5. `employees.position_id` SE NEMĚNÍ NIKOMU. Používá se v rozpisu
    směn a přepsat ho podle role by rozházelo plánování.
  */
end $$;

comment on function app.prevod_zarazeni() is
  'Převod oprávnění z rolí na zařazení. Idempotentní — druhé spuštění '
  'nic nezdvojí. Volá ji migrace 20260908090000 a scénář krok30.';

revoke all on function app.prevod_zarazeni() from public, anon, authenticated;

select app.prevod_zarazeni();
