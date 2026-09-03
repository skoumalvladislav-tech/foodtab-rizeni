-- =====================================================================
-- Foodtab — modul Komunikace, krok 1: tabulky, RLS a práva
--
-- Zadání docs/komunikace-zadani.md, oddíl 5, krok 1. Bez obrazovek —
-- ty jsou krok 3. Tenhle krok jde nasadit sám.
--
-- ---------------------------------------------------------------------
-- NESTAVÍ SE NA ZELENÉ LOUCE
--
-- Nástěnka (`announcements`, `announcement_reads` z 20260823130000) je
-- jednosměrné sdělení „všichni tohle vědí“ a je na to dobrá. NESAHÁ SE
-- NA NI. Chybí k ní rozhovor: dva a víc lidí, odpovědi, vlákno. To je
-- tohle.
--
-- Jména `konverzace`, `konverzace_ucastnici` i `konverzace_zpravy`
-- jsou v databázi volná — ověřeno před psaním. `create table` bez
-- `if not exists` schválně (CLAUDE.md, pravidlo 2): srážka jmen má
-- spadnout nahlas. Tabulka se schválně nejmenuje `zpravy`: obrazovka
-- Nástěnky bydlí na /[rozsah]/zpravy a dvě různé věci téhož jména jsou
-- past, na kterou už jednou došlo (`shift_templates`).
--
-- ---------------------------------------------------------------------
-- CO TENHLE SOUBOR HLÍDÁ NEJVÍC
--
-- Kdo není účastník, nepřečte nic. Ne „nezobrazí se mu to“ — nesmí se
-- k tomu dostat ani přímým voláním, a to ani majitel firmy. Je to po
-- mzdách nejcitlivější tabulka v aplikaci: jsou v ní stížnosti, zdraví
-- a řeči o penězích. Tichá díra tady znamená, že si lidé čtou navzájem
-- stížnosti.
--
-- A `precteno_do` nepřečte nikdo kromě vlastníka řádku — ani ostatní
-- účastníci. Kdyby odesílatel viděl ČAS přečtení, vrátí se tlak
-- zadními vrátky: „psal jsem ti to včera v jedenáct, tys to četl“.
-- Technicky se nic nedoručilo, sociálně se doručilo všechno. Ostatním
-- vrací průzor jen ano/ne.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PRÁVO NA NALÉHAVOU ZPRÁVU
--
-- Samostatné, ne `communication.manage`. Spravovat nástěnku a rozsvítit
-- ve dvě ráno telefon dvanácti lidem jsou dvě různé pravomoci a `manage`
-- má dnes kdekdo. Podle práva, ne podle názvu role (pravidlo 2).
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('communication.urgent', 'provoz', 'Posílat naléhavé zprávy mimo směnu', true, 42)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;

-- Do šablony Provozní — ta je „všechno kromě agents.manage
-- a settings.manage“, takže by nové právo mělo být uvnitř.
insert into app.role_template_permissions (template_key, permission_key)
values ('provozni', 'communication.urgent')
on conflict do nothing;

-- A do rolí, které z ní vznikly. Nové právo se do existujících firem
-- samo nedostane. Majitel se neřeší — `app.has_access` mu dává všechno
-- z aktivních modulů.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'communication.urgent'
from public.roles r
where r.key = 'provozni' and not r.is_owner
on conflict do nothing;


-- ---------------------------------------------------------------------
-- KONVERZACE
-- ---------------------------------------------------------------------

create table public.konverzace (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  druh         text not null check (druh in ('osobni', 'pobocka', 'mezi_pobockami', 'vedeni')),
  -- Prázdný u osobní; u pobočkové povinný. Viz kontrolu níž.
  branch_id    uuid references public.branches(id) on delete set null,
  nazev        text,
  /*
    Jen u `vedeni`: komu to jde. Stížnost na vedoucího, která přistane
    vedoucímu, je horší než žádná cesta — člověk si myslí, že si
    postěžoval, a jediné, čeho dosáhl, je že si na sebe řekl.
  */
  adresat      text check (adresat in ('vedouci', 'majitel')),
  zalozil      uuid references public.employees(id) on delete set null,
  zalozeno_kdy timestamptz not null default now(),
  uzavreno_kdy timestamptz,

  -- Pobočková konverzace bez pobočky nedává smysl a osobní s pobočkou
  -- taky ne. `mezi_pobockami` je schválně bez: je to jediné místo, kde
  -- se hranice poboček překračuje.
  constraint konverzace_pobocka_dava_smysl check (
    (druh = 'pobocka' and branch_id is not null)
    or (druh <> 'pobocka' and branch_id is null)
  ),
  constraint konverzace_adresat_jen_u_vedeni check (
    (druh = 'vedeni' and adresat is not null)
    or (druh <> 'vedeni' and adresat is null)
  )
);

comment on table public.konverzace is
  'Rozhovor: dva a víc lidí, odpovědi, vlákno. NENÍ to nástěnka — ta '
  'zůstává v announcements a je jednosměrná.';
comment on column public.konverzace.adresat is
  'Jen u druhu vedeni. „majitel“ znamená, že to nevidí nikdo kromě '
  'majitelů — ani provozní, ani nikdo s people.manage.';

create index konverzace_firma on public.konverzace (tenant_id, zalozeno_kdy desc);


-- ---------------------------------------------------------------------
-- ÚČASTNÍCI
--
-- `precteno_do` je JEDEN řádek na účastníka, ne řádek na zprávu
-- a člověka. U dvanácti lidí by to bylo jedno; u dvou set poboček ne.
-- ---------------------------------------------------------------------

create table public.konverzace_ucastnici (
  konverzace_id uuid not null references public.konverzace(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  pridan_kdy    timestamptz not null default now(),
  odesel_kdy    timestamptz,
  precteno_do   timestamptz,
  primary key (konverzace_id, employee_id)
);

comment on column public.konverzace_ucastnici.precteno_do is
  'ČAS přečtení. Nečte ho nikdo kromě vlastníka řádku — ostatním vrací '
  'app.precetl_si jen ano/ne. Viditelný čas by vrátil tlak zadními '
  'vrátky: „psal jsem ti to v jedenáct večer, tys to četl.“';

create index konverzace_ucastnici_clovek
  on public.konverzace_ucastnici (employee_id) where odesel_kdy is null;


-- ---------------------------------------------------------------------
-- ZPRÁVY
-- ---------------------------------------------------------------------

create table public.konverzace_zpravy (
  id             uuid primary key default gen_random_uuid(),
  konverzace_id  uuid not null references public.konverzace(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  autor          uuid references public.employees(id) on delete set null,
  text           text not null check (btrim(text) <> ''),
  nalehava       boolean not null default false,
  vytvoreno_kdy  timestamptz not null default now(),
  -- Mazání je STORNO, ne výmaz (pravidlo 9). Zpráva, která zmizí beze
  -- stopy, je v pracovním nástroji horší než zpráva, u které je vidět,
  -- že ji někdo stáhl.
  stornovano_kdy timestamptz,
  stornoval      uuid references public.employees(id) on delete set null
);

comment on column public.konverzace_zpravy.nalehava is
  'Obchází pravidlo o doručení mimo směnu. Smí ji poslat jen '
  'communication.urgent, je viditelně označená a jde do auditu se '
  'jménem — to je to jediné, co brání tomu, aby se naléhavé stalo '
  'výchozím.';

create index konverzace_zpravy_vlakno
  on public.konverzace_zpravy (konverzace_id, vytvoreno_kdy);


-- ---------------------------------------------------------------------
-- JSEM ÚČASTNÍK?
--
-- `security definer` schválně: politika na `konverzace_ucastnici` se
-- na tuhle funkci odkazuje, a kdyby funkce četla tabulku pod RLS,
-- zacyklilo by se to.
-- ---------------------------------------------------------------------

create or replace function app.je_ucastnik(p_konverzace uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.konverzace_ucastnici u
    join public.employees e on e.id = u.employee_id
    where u.konverzace_id = p_konverzace
      and e.user_id = (select auth.uid())
      and e.deleted_at is null
      -- Kdo z konverzace odešel, do ní zpětně nevidí.
      and u.odesel_kdy is null
  );
$$;

comment on function app.je_ucastnik(uuid) is
  'Je přihlášený člověk účastníkem té konverzace? Jediné kritérium '
  'pro čtení — ani majitel firmy cizí rozhovor nepřečte.';

revoke all on function app.je_ucastnik(uuid) from public, anon;
grant execute on function app.je_ucastnik(uuid) to authenticated;


/*
  MODUL ANO, PRÁVO NE.

  Čtení konverzace neviselo původně jen na účastnictví, ale i na
  `communication.read` — a to bylo špatně. Číšník to právo v roli nemá
  a svůj vlastní rozhovor by si nepřečetl; brigádník, kvůli kterému se
  celé zadržené doručení dělá, taky ne. `communication.read` je navíc
  o nástěnce („Číst zprávy“), ne o soukromém vlákně.

  ÚČASTNICTVÍ JE AUTORIZACE. Kdo je uvnitř, čte; kdo není, nečte —
  a to i kdyby měl všechna práva světa.

  Modul se ale hlídat musí (pravidlo 5): vypnutý Provoz odmítne
  i přímé volání. Na to `app.has_access` sloužila; tohle je táž
  kontrola bez toho práva.
*/
create or replace function app.modul_zapnuty(p_tenant uuid, p_modul text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenant_modules tm on tm.tenant_id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and tm.module_key = p_modul
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
  );
$$;

comment on function app.modul_zapnuty(uuid, text) is
  'Je pro tuhle firmu modul zapnutý a jsem její člen? Bez ohledu na '
  'jednotlivá práva — používá se tam, kde autorizuje něco jiného '
  'než oprávnění (účastnictví v konverzaci).';

revoke all on function app.modul_zapnuty(uuid, text) from public, anon;
grant execute on function app.modul_zapnuty(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- RLS
--
-- Účastnictví, ne oprávnění. Majitel firmy má přes `app.has_access`
-- všechna práva aktivních modulů — kdyby čtení viselo na právu, četl
-- by každou stížnost, která na něj byla napsaná.
--
-- `has_access` je tu navíc kvůli modulu: vypnutý Provoz musí odmítnout
-- i přímé volání (pravidlo 5).
-- ---------------------------------------------------------------------

alter table public.konverzace enable row level security;
alter table public.konverzace_ucastnici enable row level security;
alter table public.konverzace_zpravy enable row level security;

drop policy if exists konverzace_select on public.konverzace;
create policy konverzace_select on public.konverzace for select to authenticated
  using (
    app.modul_zapnuty(tenant_id, 'provoz')
    and app.je_ucastnik(id)
  );

drop policy if exists konverzace_ucastnici_select on public.konverzace_ucastnici;
create policy konverzace_ucastnici_select on public.konverzace_ucastnici
  for select to authenticated
  using (app.je_ucastnik(konverzace_id));

drop policy if exists konverzace_zpravy_select on public.konverzace_zpravy;
create policy konverzace_zpravy_select on public.konverzace_zpravy
  for select to authenticated
  using (
    app.modul_zapnuty(tenant_id, 'provoz')
    and app.je_ucastnik(konverzace_id)
  );

/*
  Zapisuje se JEDINĚ průzory (krok 2). Přímý zápis by znamenal, že si
  kdokoli dopíše zprávu cizím jménem nebo si označí cizí konverzaci za
  přečtenou — a hlavně by obešel kontrolu práva na naléhavost.

  Nová tabulka nemá pro `authenticated` implicitně žádné právo; tohle
  `revoke` je pojistka pro případ, že by někdo příště napsal
  `grant all on all tables in schema public`.
*/
revoke insert, update, delete on public.konverzace from authenticated;
revoke insert, update, delete on public.konverzace_ucastnici from authenticated;
revoke insert, update, delete on public.konverzace_zpravy from authenticated;


-- ---------------------------------------------------------------------
-- PRÁVO NA SLOUPEC
--
-- Dnešní lekce z barvy u člověka: RLS říká, KTERÉ řádky; grant říká,
-- jestli se na tabulku vůbec smí podívat. Nová tabulka nemá pro
-- `authenticated` právo žádné, takže se musí udělit — a `precteno_do`
-- se schválně NEUDĚLUJE ani vlastníkovi. Ten si ho přečte průzorem.
--
-- Jedna kontrola hlídá dnešní obrazovku; grant hlídá i tu, kterou
-- někdo přidá za rok.
-- ---------------------------------------------------------------------

grant select on public.konverzace to authenticated;
grant select on public.konverzace_zpravy to authenticated;

grant select (konverzace_id, employee_id, pridan_kdy, odesel_kdy)
  on public.konverzace_ucastnici to authenticated;


-- ---------------------------------------------------------------------
-- PRŮZORY NA PŘEČTENÍ
-- ---------------------------------------------------------------------

/* Svůj vlastní čas přečtení — a jen ten. */
create or replace function public.moje_precteno_do(p_konverzace uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select u.precteno_do
  from public.konverzace_ucastnici u
  join public.employees e on e.id = u.employee_id
  where u.konverzace_id = p_konverzace
    and e.user_id = (select auth.uid())
  limit 1;
$$;

comment on function public.moje_precteno_do(uuid) is
  'Kam jsem si tuhle konverzaci přečetl. Cizí řádek nevrací.';

revoke all on function public.moje_precteno_do(uuid) from public, anon;
grant execute on function public.moje_precteno_do(uuid) to authenticated;


/*
  Přečetl si to ten druhý? ANO/NE, nikdy KDY.

  Tohle je celý rozdíl mezi „vidím, že to dorazilo“ a „vidím, že jsi
  v jedenáct večer pracoval“. Ptát se smí jen ten, kdo je v téže
  konverzaci — jinak by šlo přes cizí id zjistit, kdo si co přečetl.
*/
create or replace function public.precetl_si(p_konverzace uuid, p_employee uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when not app.je_ucastnik(p_konverzace) then null
    else exists (
      select 1
      from public.konverzace_ucastnici u
      join public.konverzace_zpravy z on z.konverzace_id = u.konverzace_id
      where u.konverzace_id = p_konverzace
        and u.employee_id = p_employee
        and u.precteno_do is not null
        and z.vytvoreno_kdy <= u.precteno_do
      limit 1
    )
  end;
$$;

comment on function public.precetl_si(uuid, uuid) is
  'Přečetl si ten člověk konverzaci? Ano/ne, nikdy kdy — viditelný čas '
  'by z pomůcky udělal důkaz o práci mimo směnu.';

revoke all on function public.precetl_si(uuid, uuid) from public, anon;
grant execute on function public.precetl_si(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- AUDIT
--
-- Storno i naléhavá zpráva musí zůstat dohledatelné se jménem.
-- ---------------------------------------------------------------------

drop trigger if exists trg_audit_zprav on public.konverzace_zpravy;
create trigger trg_audit_zprav
  after insert or update or delete on public.konverzace_zpravy
  for each row execute function app.audit_zmenu('konverzace_zprava');
