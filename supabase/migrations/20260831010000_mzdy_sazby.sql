-- =====================================================================
-- Foodtab — hodinová sazba
--
-- Zadání: docs/mzdy-zadani.md. Je to nejcitlivější data, jaká zatím
-- v aplikaci jsou — čtěte oddíly 5 a 6 zadání a pravidlo 8 z CLAUDE.md.
--
-- POZNÁMKA K NÁZVŮM OPRÁVNĚNÍ: zadání mluví o `wages.read`
-- a `wages.manage`. Šéfík to při zadávání upřesnil jinak: `payroll.manage`
-- už v katalogu je („Spravovat mzdové sazby“) a druhé oprávnění se má
-- jmenovat `payroll.read`. Žádná `wages.*` se nezakládají. Kdo bude
-- zadání číst po nás, ať ví, proč se rozchází s kódem.
--
-- Tahle migrace dělá první bod z oddílu 8: tabulku, oprávnění, RLS
-- a politiky. Výpočet a průzory jsou v migraci vedle.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SAZBA JE HISTORIE, NE ÚDAJ U ZAMĚSTNANCE
--
-- Sloupec v `employees` by při přidání od 1. října přepsal i září
-- a nikdo by si toho nevšiml, dokud by se nepřišlo hádat o výplatu.
--
-- Zvýšení sazby = nový řádek. Řádky se nemažou; oprava překlepu je taky
-- nový řádek se stejným `valid_from` a platí ten později založený.
-- Pro daný den platí řádek s nejvyšším `valid_from`, který není
-- v budoucnu.
--
-- Příplatky (noční, víkend, svátek) se teď nedělají. Až budou, přibude
-- sloupec — proto se tu nic nedopisuje dopředu a už zadaná data se
-- přepisovat nebudou.
-- ---------------------------------------------------------------------

create table if not exists public.employee_rates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- V haléřích jako celé číslo. Peníze nikdy ve float. (CLAUDE.md)
  hourly_haleru integer not null check (hourly_haleru >= 0),
  -- Od kterého PROVOZNÍHO dne sazba platí.
  valid_from    date not null,
  note          text not null default '',
  created_by    uuid references public.profiles(user_id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.employee_rates is
  'Historie hodinových sazeb. Nikdy se needituje ani nemaže — změna je '
  'nový řádek. Čte se výhradně přes funkce v public, ne přímo.';

-- Vyhledávání sazby ke dni: nejvyšší valid_from, který není v budoucnu,
-- a při shodě ten později založený.
create index if not exists employee_rates_ke_dni
  on public.employee_rates (employee_id, valid_from desc, created_at desc);

-- Historie se nepřepisuje. Pravidlo je silnější než politika, protože
-- platí i na majitele: změna sazby má být nový řádek, ne přepsaný starý.
create rule employee_rates_no_update as
  on update to public.employee_rates do instead nothing;

-- Na mazání tu ŽÁDNÉ pravidlo není, a je to schválně.
--
-- „do instead nothing“ na delete rozbíjí kaskádu cizího klíče: když se
-- maže zaměstnanec, Postgres chce smazat i jeho sazby, pravidlo to
-- zruší a celé mazání spadne na „referential integrity query gave
-- unexpected result“. Prvně napsané to tak bylo a nešlo pak smazat
-- zaměstnance vůbec.
--
-- Že se sazby nemažou, drží dvě věci níž: `authenticated` na tabulce
-- nemá žádná práva a RLS nemá politiku pro delete. Kdo sazbu smazat
-- nemá, ji nesmaže. Zmizí jen s tím, komu patřila.


-- ---------------------------------------------------------------------
-- OPRÁVNĚNÍ
--
-- payroll.manage v katalogu už je. Přibývá jen čtení cizích sazeb.
-- sensitive = true není ozdoba: role s citlivým oprávněním nejde pozvat
-- přes SMS, jen e-mailem (app.create_invitation). U mezd to platit má.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('payroll.read', 'provoz', 'Vidět sazby a výdělky ostatních', true, 93)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;

do $$
begin
  if not exists (
    select 1 from public.permissions
    where key = 'payroll.manage' and sensitive
  ) then
    raise exception
      'payroll.manage má být citlivé oprávnění — mzdy nesmí chodit přes SMS pozvánku';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- PAST V ŠABLONĚ ROLE PROVOZNÍ
--
-- V 20260823120100_catalog.sql stojí:
--
--   select 'provozni', key from public.permissions
--   where key not in ('agents.manage', 'settings.manage');
--
-- Provozní tedy dostává VŠECHNO KROMĚ dvou vyjmenovaných věcí. Každé
-- nové citlivé oprávnění mu spadne do role samo od sebe a nikdo si toho
-- nevšimne, protože ten řádek psal někdo jiný před měsíci — přesně tak
-- se do jeho role dostalo payroll.manage.
--
-- Nasazená migrace se neupravuje, takže se to napravuje tady: obě
-- mzdová oprávnění se šabloně Provozního odebírají.
--
-- KDO BUDE PŘÍŠTĚ PŘIDÁVAT CITLIVÉ OPRÁVNĚNÍ, MUSÍ HO ODEBRAT TAKY —
-- jinak ho Provozní dostane mlčky. Stejná past jako u zákazu SMS
-- u citlivých rolí: příznak sám nestačí, musí se na něj někdo podívat.
--
-- Šablony platí pro NOVĚ zakládané firmy. Do rolí, které u zákazníků
-- existují, se nesahá: přidělení role je podle pravidla 1 jeho data,
-- ne kód, a migrace, která někomu mlčky rozšíří nebo ubere oprávnění,
-- je přesně to, co se u mezd stát nesmí.
-- ---------------------------------------------------------------------

delete from app.role_template_permissions
where template_key = 'provozni'
  and permission_key in ('payroll.read', 'payroll.manage');

-- Účetní mzdy vyplácí, nestanovuje je: čtení ano, správu ne.
-- payroll.export už má z katalogu, takže podklady vidí tak jako tak.
insert into app.role_template_permissions (template_key, permission_key) values
  ('ucetni', 'payroll.read')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- DVĚ OBRANNÉ LINIE
--
-- 1. Práva na tabulce: `authenticated` na sazby nedosáhne vůbec.
--    `select * from employee_rates` skončí chybou, ne prázdným výpisem.
--    Aplikace má úzké funkce v public, stejně jako u pozvánek.
-- 2. RLS i tak zapnutá a s politikami. Kdyby někdo v budoucnu práva
--    vrátil, nesmí tím tabulku otevřít dokořán. (Pravidlo 3)
-- ---------------------------------------------------------------------

alter table public.employee_rates enable row level security;

revoke all on public.employee_rates from anon, authenticated;

-- Svou sazbu vidí každý, kdo je propojený se zaměstnancem — na vlastní
-- mzdu není potřeba právo. Cizí jen s payroll.read, a jen v rozsahu,
-- na který má (pravidlo 4).
create policy employee_rates_read on public.employee_rates for select to authenticated
  using (
    employee_id in (
      select e.id from public.employees e
      where e.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.employees e
      where e.id = employee_rates.employee_id
        and app.can_read_scoped(employee_rates.tenant_id, 'payroll.read', e.branch_id)
    )
  );

-- Zadávat sazby smí jen payroll.manage, a jen lidem ve svém rozsahu.
-- Sám sobě sazbu nikdo nenastaví bez toho práva — proto tu není žádná
-- výjimka „na sebe“ jako u čtení.
create policy employee_rates_write on public.employee_rates for insert to authenticated
  with check (
    exists (
      select 1 from public.employees e
      where e.id = employee_rates.employee_id
        and e.tenant_id = employee_rates.tenant_id
        and app.has_access(employee_rates.tenant_id, 'payroll.manage', e.branch_id)
    )
  );
