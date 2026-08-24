-- =====================================================================
-- Foodtab — Etapa 0, krok 1: katalog modulů, oprávnění a šablon rolí
--
-- Systémová data. Zákazník je needituje — ale při založení firmy se
-- z šablon vytvoří JEJÍ vlastní role, které už měnit může.
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODULY
-- ---------------------------------------------------------------------

insert into public.modules (key, label, is_base, sort_order) values
  ('provoz',     'Provoz',               true,  10),
  ('finance',    'Finance a účetnictví', false, 20),
  ('marketing',  'Marketing',            false, 30),
  ('objednavky', 'Objednávky',           false, 40)
on conflict (key) do update
  set label = excluded.label,
      is_base = excluded.is_base,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- OPRÁVNĚNÍ
--
-- Tvar modul.akce. Čtení a správa se rozlišují záměrně — „vidět tržby“
-- a „měnit tržby“ jsou zásadně různá práva.
--
-- Mzdy (payroll.*) patří do základu, ne do Financí: hodiny pocházejí
-- z docházky, která je v základu, a i zákazník bez modulu Finance
-- potřebuje poslat podklady své účetní.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  -- Provoz
  ('shifts.read',          'provoz', 'Vidět rozpis směn',                false,  10),
  ('shifts.manage',        'provoz', 'Plánovat směny',                   false,  11),
  ('attendance.read',      'provoz', 'Vidět docházku',                   true,   20),
  ('attendance.manage',    'provoz', 'Upravovat docházku a přesčasy',    true,   21),
  ('tasks.read',           'provoz', 'Vidět úkoly a checklisty',         false,  30),
  ('tasks.manage',         'provoz', 'Zadávat úkoly a spravovat šablony',false,  31),
  ('communication.read',   'provoz', 'Číst zprávy',                      false,  40),
  ('communication.manage', 'provoz', 'Rozesílat zprávy',                 false,  41),
  ('recipes.read',         'provoz', 'Vidět receptury',                  false,  50),
  ('recipes.manage',       'provoz', 'Upravovat receptury',              false,  51),
  ('menus.read',           'provoz', 'Vidět jídelní lístky',             false,  60),
  ('menus.manage',         'provoz', 'Upravovat jídelní lístky',         false,  61),
  ('ai.use',               'provoz', 'Používat Gastro AI',               false,  70),
  ('motivation.read',      'provoz', 'Vidět žebříčky a odměny',          false,  80),
  ('motivation.manage',    'provoz', 'Udělovat body a spravovat odměny', false,  81),
  ('people.manage',        'provoz', 'Spravovat zaměstnance a pozvánky', true,   90),
  ('payroll.manage',       'provoz', 'Spravovat mzdové sazby',           true,   91),
  ('payroll.export',       'provoz', 'Exportovat podklady pro mzdy',     true,   92),
  ('approvals.decide',     'provoz', 'Schvalovat návrhy agentů',         true,  100),
  ('agents.manage',        'provoz', 'Spravovat agenty a jejich klíče',  true,  101),
  ('settings.manage',      'provoz', 'Nastavení firmy, poboček a modulů',true,  110),

  -- Finance
  ('finance.read',         'finance', 'Vidět tržby, náklady a faktury',  true,  200),
  ('finance.manage',       'finance', 'Zadávat faktury a náklady',       true,  201),
  ('banking.read',         'finance', 'Vidět pohyby na bankovním účtu',  true,  210),

  -- Marketing
  ('marketing.read',       'marketing', 'Vidět marketingový plán',       false, 300),
  ('marketing.manage',     'marketing', 'Připravovat příspěvky',         false, 301),
  ('marketing.publish',    'marketing', 'Publikovat na sociální sítě',   true,  302),

  -- Objednávky
  ('purchasing.read',      'objednavky', 'Vidět objednávky a sklad',     false, 400),
  ('purchasing.manage',    'objednavky', 'Objednávat a přijímat zboží',  false, 401)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- ŠABLONY ROLÍ
-- Slouží jen jako výchozí bod při založení firmy. Od té chvíle jsou
-- role firmy jejími daty a majitel je může měnit, přejmenovat i mazat.
-- ---------------------------------------------------------------------

create table if not exists app.role_templates (
  key          text primary key,
  label        text not null,
  is_owner     boolean not null default false,
  default_scope text not null default 'branch'
                check (default_scope in ('tenant', 'branch')),
  sort_order   int not null default 100
);

create table if not exists app.role_template_permissions (
  template_key   text not null references app.role_templates(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (template_key, permission_key)
);

insert into app.role_templates (key, label, is_owner, default_scope, sort_order) values
  ('majitel',       'Majitel',          true,  'tenant', 10),
  ('provozni',      'Provozní',         false, 'tenant', 20),
  ('vedouci_smeny', 'Vedoucí směny',    false, 'branch', 30),
  ('kuchyne',       'Kuchyně',          false, 'branch', 40),
  ('servis',        'Servis',           false, 'branch', 50),
  ('bar',           'Bar',              false, 'branch', 60),
  ('ucetni',        'Účetní',           false, 'tenant', 70)
on conflict (key) do update
  set label = excluded.label,
      is_owner = excluded.is_owner,
      default_scope = excluded.default_scope,
      sort_order = excluded.sort_order;


-- Majitel se needituje po jednom oprávnění: dostává vše, co spadá do
-- aktivních modulů. Řeší to app.has_access(), aby ho nešlo zamknout ven
-- ani po přidání nového oprávnění v budoucí verzi.

insert into app.role_template_permissions (template_key, permission_key)
select 'provozni', key from public.permissions
where key not in ('agents.manage', 'settings.manage')
on conflict do nothing;

insert into app.role_template_permissions (template_key, permission_key) values
  ('vedouci_smeny', 'shifts.read'),
  ('vedouci_smeny', 'shifts.manage'),
  ('vedouci_smeny', 'attendance.read'),
  ('vedouci_smeny', 'attendance.manage'),
  ('vedouci_smeny', 'tasks.read'),
  ('vedouci_smeny', 'tasks.manage'),
  ('vedouci_smeny', 'communication.read'),
  ('vedouci_smeny', 'communication.manage'),
  ('vedouci_smeny', 'recipes.read'),
  ('vedouci_smeny', 'menus.read'),
  ('vedouci_smeny', 'ai.use'),
  ('vedouci_smeny', 'motivation.read'),
  ('vedouci_smeny', 'motivation.manage'),

  ('kuchyne', 'shifts.read'),
  ('kuchyne', 'tasks.read'),
  ('kuchyne', 'tasks.manage'),
  ('kuchyne', 'communication.read'),
  ('kuchyne', 'recipes.read'),
  ('kuchyne', 'recipes.manage'),
  ('kuchyne', 'menus.read'),
  ('kuchyne', 'ai.use'),
  ('kuchyne', 'motivation.read'),

  ('servis', 'shifts.read'),
  ('servis', 'tasks.read'),
  ('servis', 'communication.read'),
  ('servis', 'menus.read'),
  ('servis', 'ai.use'),
  ('servis', 'motivation.read'),

  ('bar', 'shifts.read'),
  ('bar', 'tasks.read'),
  ('bar', 'communication.read'),
  ('bar', 'recipes.read'),
  ('bar', 'menus.read'),
  ('bar', 'ai.use'),
  ('bar', 'motivation.read'),

  -- Účetní vidí finance a stáhne si podklady pro mzdy. Nic víc:
  -- žádné směny, žádnou komunikaci, žádnou docházku jednotlivců.
  ('ucetni', 'finance.read'),
  ('ucetni', 'payroll.export')
on conflict do nothing;
