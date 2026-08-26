-- =====================================================================
-- Foodtab — Etapa 0, krok 2: provozní tabulky (modul Provoz)
--
-- Směny, docházka, úkoly, checklisty, komunikace, receptury,
-- jídelní lístky a motivace.
--
-- Dvě pravidla platí všude:
--   • branch_id IS NULL znamená firemní úroveň
--   • lidé se odkazují přes employees, ne přes profiles — brigádník
--     bez účtu musí jít zařadit na směnu
-- =====================================================================


-- ---------------------------------------------------------------------
-- PROVOZNÍ DEN
-- Restaurace zavírá po půlnoci. Účet vystavený ve 2:15 patří do včerejší
-- uzávěrky. Odvozuje se z branches.day_starts_at, ne z kalendáře.
-- ---------------------------------------------------------------------

create or replace function app.business_date(p_branch uuid, p_at timestamptz)
returns date
language sql stable security definer set search_path = ''
as $$
  select (
    (p_at at time zone coalesce(b.timezone, t.timezone, 'Europe/Prague'))
    - make_interval(hours => extract(hour from b.day_starts_at)::int,
                    mins  => extract(minute from b.day_starts_at)::int)
  )::date
  from public.branches b
  join public.tenants t on t.id = b.tenant_id
  where b.id = p_branch;
$$;

comment on function app.business_date(uuid, timestamptz) is
  'Provozní den pobočky. Nikdy nepoužívat current_date napřímo.';

grant execute on function app.business_date(uuid, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- SMĚNY
-- ---------------------------------------------------------------------

create table public.shift_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  position_id uuid references public.positions(id) on delete set null,
  weekday     smallint not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  headcount   smallint not null default 1 check (headcount > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  -- Prázdné = neobsazená směna, tedy „sem někoho potřebujeme“.
  employee_id uuid references public.employees(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  shift_date  date not null,
  starts_at   time not null,
  ends_at     time not null,
  note        text not null default '',
  status      text not null default 'planned'
              check (status in ('planned', 'confirmed', 'cancelled')),
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index shifts_branch_date on public.shifts (branch_id, shift_date);
create index shifts_employee on public.shifts (employee_id, shift_date);


-- ---------------------------------------------------------------------
-- DOCHÁZKA
-- ---------------------------------------------------------------------

create table public.attendance_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete restrict,
  shift_id      uuid references public.shifts(id) on delete set null,
  kind          text not null check (kind in ('in', 'out', 'break_start', 'break_end')),
  occurred_at   timestamptz not null default now(),
  -- Doplní trigger podle otevírací doby pobočky.
  business_date date not null,
  source        text not null default 'app'
                check (source in ('app', 'terminal', 'manual')),
  note          text not null default '',
  -- Ruční oprava se zaznamenává, nepřepisuje se původní událost.
  corrected_by  uuid references public.profiles(user_id) on delete set null,
  corrected_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index attendance_employee_date
  on public.attendance_events (employee_id, business_date);
create index attendance_branch_date
  on public.attendance_events (branch_id, business_date);


create or replace function app.set_business_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.business_date is null then
    new.business_date := app.business_date(new.branch_id, new.occurred_at);
  end if;
  return new;
end;
$$;

create trigger trg_attendance_business_date
  before insert on public.attendance_events
  for each row execute function app.set_business_date();


-- ---------------------------------------------------------------------
-- ÚKOLY A CHECKLISTY
-- ---------------------------------------------------------------------

create table public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  note        text not null default '',
  -- 'daily' | 'weekly:1' (pondělí) | 'monthly:15' | 'shift'
  recurrence  text not null default 'daily',
  due_time    time,
  role_id     uuid references public.roles(id) on delete set null,
  priority    text not null default 'normal' check (priority in ('normal', 'high')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- NULL = úkol pro celou firmu
  branch_id     uuid references public.branches(id) on delete cascade,
  template_id   uuid references public.task_templates(id) on delete set null,
  title         text not null check (length(btrim(title)) > 0),
  note          text not null default '',
  -- Adresát: role, konkrétní člověk, nebo nikdo (= kdokoli na pobočce)
  role_id       uuid references public.roles(id) on delete set null,
  employee_id   uuid references public.employees(id) on delete set null,
  due_at        timestamptz,
  priority      text not null default 'normal' check (priority in ('normal', 'high')),
  status        text not null default 'open'
                check (status in ('open', 'done', 'cancelled')),
  done_at       timestamptz,
  done_by       uuid references public.employees(id) on delete set null,
  created_by    uuid references public.profiles(user_id) on delete set null,
  created_at    timestamptz not null default now()
);

create index tasks_branch_status on public.tasks (tenant_id, branch_id, status);
create index tasks_employee on public.tasks (employee_id) where status = 'open';


create table public.checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  department  text not null default 'provoz'
              check (department in ('kuchyne', 'bar', 'servis', 'provoz', 'vedeni')),
  -- 'opening' | 'closing' | 'haccp' | 'weekly'
  schedule    text not null default 'opening',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.checklist_items (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.checklist_templates(id) on delete cascade,
  position       smallint not null default 0,
  label          text not null check (length(btrim(label)) > 0),
  -- Kontrola teploty lednice není odškrtnutí, ale zapsané číslo. Bez toho
  -- z HACCP záznamů nikdy neuděláte data, se kterými by šlo pracovat.
  requires_value boolean not null default false,
  value_type     text check (value_type in ('number', 'text', 'photo')),
  value_unit     text,
  min_value      numeric,
  max_value      numeric,
  constraint checklist_items_value_type_needed
    check (not requires_value or value_type is not null)
);

create index checklist_items_template on public.checklist_items (template_id, position);


create table public.checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  template_id   uuid not null references public.checklist_templates(id) on delete restrict,
  business_date date not null,
  status        text not null default 'open' check (status in ('open', 'done')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (template_id, branch_id, business_date)
);

create table public.checklist_entries (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.checklist_runs(id) on delete cascade,
  item_id      uuid not null references public.checklist_items(id) on delete restrict,
  checked      boolean not null default false,
  value_number numeric,
  value_text   text,
  employee_id  uuid references public.employees(id) on delete set null,
  recorded_at  timestamptz not null default now(),
  unique (run_id, item_id)
);


-- ---------------------------------------------------------------------
-- KOMUNIKACE
-- branch_id IS NULL = zpráva celé firmě
-- ---------------------------------------------------------------------

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  -- Vyplněné = osobní zpráva jednomu člověku
  employee_id  uuid references public.employees(id) on delete cascade,
  body         text not null check (length(btrim(body)) > 0),
  pinned       boolean not null default false,
  author_id    uuid references public.profiles(user_id) on delete set null,
  created_at   timestamptz not null default now()
);

create index announcements_scope
  on public.announcements (tenant_id, branch_id, created_at desc);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);


-- ---------------------------------------------------------------------
-- RECEPTURY
-- branch_id IS NULL = sdílená firemní receptura
-- ---------------------------------------------------------------------

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  category     text not null default '',
  portions     smallint not null default 1 check (portions > 0),
  allergens    smallint[] not null default '{}',
  instructions text not null default '',
  active       boolean not null default true,
  created_by   uuid references public.profiles(user_id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.recipe_ingredients (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  position     smallint not null default 0,
  name         text not null,
  amount       numeric(12,3) not null default 0,
  unit         text not null default 'g',
  -- Peníze v celých haléřích. Naplní se z modulu Objednávky, až bude.
  cost_haleru  integer,
  note         text not null default ''
);

create index recipe_ingredients_recipe on public.recipe_ingredients (recipe_id, position);


-- ---------------------------------------------------------------------
-- JÍDELNÍ LÍSTKY
-- Lístek je vždy pobočkový — proto branch_id NOT NULL.
-- ---------------------------------------------------------------------

create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  recipe_id    uuid references public.recipes(id) on delete set null,
  menu_type    text not null check (menu_type in ('permanent', 'weekly')),
  name         text not null check (length(btrim(name)) > 0),
  description  text not null default '',
  category     text not null default '',
  price_haleru integer not null default 0 check (price_haleru >= 0),
  allergens    smallint[] not null default '{}',
  -- U týdenního menu: který den se vydává
  serve_date   date,
  position     smallint not null default 0,
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index menu_items_branch_type on public.menu_items (branch_id, menu_type, serve_date);

create table public.weekly_menu_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  week_start  date not null,
  file_name   text not null,
  storage_key text not null,
  file_size   integer not null default 0,
  source      text not null default 'dashboard'
              check (source in ('dashboard', 'agent')),
  status      text not null default 'ready'
              check (status in ('ready', 'processing', 'failed')),
  uploaded_by uuid references public.profiles(user_id) on delete set null,
  uploaded_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- MOTIVACE
-- ---------------------------------------------------------------------

create table public.praises (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  points       smallint not null default 0 check (points >= 0),
  reason       text not null default '',
  given_by     uuid references public.profiles(user_id) on delete set null,
  created_at   timestamptz not null default now()
);

create index praises_employee on public.praises (employee_id, created_at desc);

create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  description  text not null default '',
  starts_on    date not null,
  ends_on      date not null,
  target_value numeric,
  reward       text not null default '',
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.reward_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  label         text not null check (length(btrim(label)) > 0),
  points_cost   integer not null check (points_cost > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.reward_claims (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  reward_item_id uuid not null references public.reward_items(id) on delete restrict,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  points_spent   integer not null check (points_spent > 0),
  status         text not null default 'requested'
                 check (status in ('requested', 'approved', 'rejected', 'fulfilled')),
  decided_by     uuid references public.profiles(user_id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);


-- =====================================================================
-- ROW LEVEL SECURITY
--
-- Čtení:  app.can_read_scoped() — firemní úroveň vidí každý s oprávněním,
--         pobočkovou jen ten, kdo na tu pobočku vidí
-- Zápis:  app.has_access() — přísná kontrola rozsahu
-- =====================================================================

alter table public.shift_templates       enable row level security;
alter table public.shifts                enable row level security;
alter table public.attendance_events     enable row level security;
alter table public.task_templates        enable row level security;
alter table public.tasks                 enable row level security;
alter table public.checklist_templates   enable row level security;
alter table public.checklist_items       enable row level security;
alter table public.checklist_runs        enable row level security;
alter table public.checklist_entries     enable row level security;
alter table public.announcements         enable row level security;
alter table public.announcement_reads    enable row level security;
alter table public.recipes               enable row level security;
alter table public.recipe_ingredients    enable row level security;
alter table public.menu_items            enable row level security;
alter table public.weekly_menu_documents enable row level security;
alter table public.praises               enable row level security;
alter table public.challenges            enable row level security;
alter table public.reward_items          enable row level security;
alter table public.reward_claims         enable row level security;

grant select, insert, update, delete on all tables in schema public to authenticated;


-- --- Směny -----------------------------------------------------------

create policy shift_templates_read on public.shift_templates for select to authenticated
  using (app.can_read_scoped(tenant_id, 'shifts.read', branch_id));
create policy shift_templates_write on public.shift_templates for all to authenticated
  using (app.has_access(tenant_id, 'shifts.manage', branch_id))
  with check (app.has_access(tenant_id, 'shifts.manage', branch_id));

create policy shifts_read on public.shifts for select to authenticated
  using (app.can_read_scoped(tenant_id, 'shifts.read', branch_id));
create policy shifts_write on public.shifts for all to authenticated
  using (app.has_access(tenant_id, 'shifts.manage', branch_id))
  with check (app.has_access(tenant_id, 'shifts.manage', branch_id));


-- --- Docházka --------------------------------------------------------
-- Vlastní docházku vidí každý i bez oprávnění attendance.read.

create policy attendance_read on public.attendance_events for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'attendance.read', branch_id)
    or employee_id in (
      select e.id from public.employees e
      where e.user_id = (select auth.uid())
    )
  );

create policy attendance_insert on public.attendance_events for insert to authenticated
  with check (
    app.has_access(tenant_id, 'attendance.manage', branch_id)
    or (
      -- Vlastní příchod a odchod si zapíše každý zaměstnanec s účtem.
      source = 'app'
      and employee_id in (
        select e.id from public.employees e
        where e.user_id = (select auth.uid())
      )
    )
  );

-- Opravovat a mazat smí jen správce docházky. Zaměstnanec si vlastní
-- záznam po zapsání nepřepíše.
create policy attendance_update on public.attendance_events for update to authenticated
  using (app.has_access(tenant_id, 'attendance.manage', branch_id))
  with check (app.has_access(tenant_id, 'attendance.manage', branch_id));
create policy attendance_delete on public.attendance_events for delete to authenticated
  using (app.has_access(tenant_id, 'attendance.manage', branch_id));


-- --- Úkoly a checklisty ----------------------------------------------

create policy task_templates_read on public.task_templates for select to authenticated
  using (app.can_read_scoped(tenant_id, 'tasks.read', branch_id));
create policy task_templates_write on public.task_templates for all to authenticated
  using (app.has_access(tenant_id, 'tasks.manage', branch_id))
  with check (app.has_access(tenant_id, 'tasks.manage', branch_id));

create policy tasks_read on public.tasks for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'tasks.read', branch_id)
    or employee_id in (
      select e.id from public.employees e where e.user_id = (select auth.uid())
    )
  );
create policy tasks_write on public.tasks for all to authenticated
  using (app.has_access(tenant_id, 'tasks.manage', branch_id))
  with check (app.has_access(tenant_id, 'tasks.manage', branch_id));

create policy checklist_templates_read on public.checklist_templates for select to authenticated
  using (app.can_read_scoped(tenant_id, 'tasks.read', branch_id));
create policy checklist_templates_write on public.checklist_templates for all to authenticated
  using (app.has_access(tenant_id, 'tasks.manage', branch_id))
  with check (app.has_access(tenant_id, 'tasks.manage', branch_id));

create policy checklist_items_read on public.checklist_items for select to authenticated
  using (exists (select 1 from public.checklist_templates t
                 where t.id = template_id
                   and app.can_read_scoped(t.tenant_id, 'tasks.read', t.branch_id)));
create policy checklist_items_write on public.checklist_items for all to authenticated
  using (exists (select 1 from public.checklist_templates t
                 where t.id = template_id
                   and app.has_access(t.tenant_id, 'tasks.manage', t.branch_id)))
  with check (exists (select 1 from public.checklist_templates t
                      where t.id = template_id
                        and app.has_access(t.tenant_id, 'tasks.manage', t.branch_id)));

create policy checklist_runs_read on public.checklist_runs for select to authenticated
  using (app.can_read_scoped(tenant_id, 'tasks.read', branch_id));
create policy checklist_runs_write on public.checklist_runs for all to authenticated
  using (app.has_access(tenant_id, 'tasks.read', branch_id))
  with check (app.has_access(tenant_id, 'tasks.read', branch_id));

-- Odškrtnout položku smí každý, kdo na pobočku vidí — je to běžná
-- práce směny, ne správcovský úkon.
create policy checklist_entries_all on public.checklist_entries for all to authenticated
  using (exists (select 1 from public.checklist_runs r
                 where r.id = run_id
                   and app.has_access(r.tenant_id, 'tasks.read', r.branch_id)))
  with check (exists (select 1 from public.checklist_runs r
                      where r.id = run_id
                        and app.has_access(r.tenant_id, 'tasks.read', r.branch_id)));


-- --- Komunikace ------------------------------------------------------

create policy announcements_read on public.announcements for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'communication.read', branch_id)
    and (
      employee_id is null
      or employee_id in (select e.id from public.employees e
                         where e.user_id = (select auth.uid()))
      or app.has_access(tenant_id, 'communication.manage', branch_id)
    )
  );
create policy announcements_write on public.announcements for all to authenticated
  using (app.has_access(tenant_id, 'communication.manage', branch_id))
  with check (app.has_access(tenant_id, 'communication.manage', branch_id));

create policy announcement_reads_own on public.announcement_reads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- --- Receptury -------------------------------------------------------

create policy recipes_read on public.recipes for select to authenticated
  using (app.can_read_scoped(tenant_id, 'recipes.read', branch_id));
create policy recipes_write on public.recipes for all to authenticated
  using (app.has_access(tenant_id, 'recipes.manage', branch_id))
  with check (app.has_access(tenant_id, 'recipes.manage', branch_id));

create policy recipe_ingredients_read on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id
                   and app.can_read_scoped(r.tenant_id, 'recipes.read', r.branch_id)));
create policy recipe_ingredients_write on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r
                 where r.id = recipe_id
                   and app.has_access(r.tenant_id, 'recipes.manage', r.branch_id)))
  with check (exists (select 1 from public.recipes r
                      where r.id = recipe_id
                        and app.has_access(r.tenant_id, 'recipes.manage', r.branch_id)));


-- --- Jídelní lístky --------------------------------------------------

create policy menu_items_read on public.menu_items for select to authenticated
  using (app.can_read_scoped(tenant_id, 'menus.read', branch_id));
create policy menu_items_write on public.menu_items for all to authenticated
  using (app.has_access(tenant_id, 'menus.manage', branch_id))
  with check (app.has_access(tenant_id, 'menus.manage', branch_id));

create policy weekly_menu_read on public.weekly_menu_documents for select to authenticated
  using (app.can_read_scoped(tenant_id, 'menus.read', branch_id));
create policy weekly_menu_write on public.weekly_menu_documents for all to authenticated
  using (app.has_access(tenant_id, 'menus.manage', branch_id))
  with check (app.has_access(tenant_id, 'menus.manage', branch_id));


-- --- Motivace --------------------------------------------------------

create policy praises_read on public.praises for select to authenticated
  using (app.can_read_scoped(tenant_id, 'motivation.read', branch_id));
create policy praises_write on public.praises for all to authenticated
  using (app.has_access(tenant_id, 'motivation.manage', branch_id))
  with check (app.has_access(tenant_id, 'motivation.manage', branch_id));

create policy challenges_read on public.challenges for select to authenticated
  using (app.can_read_scoped(tenant_id, 'motivation.read', branch_id));
create policy challenges_write on public.challenges for all to authenticated
  using (app.has_access(tenant_id, 'motivation.manage', branch_id))
  with check (app.has_access(tenant_id, 'motivation.manage', branch_id));

create policy reward_items_read on public.reward_items for select to authenticated
  using (app.has_permission(tenant_id, 'motivation.read'));
create policy reward_items_write on public.reward_items for all to authenticated
  using (app.has_access(tenant_id, 'motivation.manage'))
  with check (app.has_access(tenant_id, 'motivation.manage'));

-- O odměnu si žádá zaměstnanec sám, schvaluje ji správce motivace.
create policy reward_claims_read on public.reward_claims for select to authenticated
  using (
    app.has_permission(tenant_id, 'motivation.manage')
    or employee_id in (select e.id from public.employees e
                       where e.user_id = (select auth.uid()))
  );
create policy reward_claims_insert on public.reward_claims for insert to authenticated
  with check (
    employee_id in (select e.id from public.employees e
                    where e.user_id = (select auth.uid()))
    or app.has_access(tenant_id, 'motivation.manage')
  );
create policy reward_claims_decide on public.reward_claims for update to authenticated
  using (app.has_access(tenant_id, 'motivation.manage'))
  with check (app.has_access(tenant_id, 'motivation.manage'));


-- ---------------------------------------------------------------------
-- BODOVÝ STAV
-- Součet pochval minus schválené odměny. Počítá se, neukládá — jinak
-- se dřív nebo později rozejde se skutečností.
-- ---------------------------------------------------------------------

create or replace view public.employee_points
with (security_invoker = true) as
select
  e.id   as employee_id,
  e.tenant_id,
  e.branch_id,
  coalesce((select sum(p.points) from public.praises p
            where p.employee_id = e.id), 0)
  - coalesce((select sum(c.points_spent) from public.reward_claims c
              where c.employee_id = e.id
                and c.status in ('approved', 'fulfilled')), 0) as points
from public.employees e
where e.deleted_at is null;

grant select on public.employee_points to authenticated;
