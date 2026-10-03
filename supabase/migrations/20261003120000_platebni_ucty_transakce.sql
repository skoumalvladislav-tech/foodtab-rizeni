-- =====================================================================
-- Foodtab — Finance: platební účty a immutabilní transakční ledger
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5 ("Cashflow:
-- skutečné pohyby... bankovní import CSV, validaci a náhled importu...
-- párování podle VS, částky, data..."). Plán: proud-scribbling-glade.md,
-- migrace 3.
--
-- ZÁVAZNÉ ROZHODNUTÍ (CLAUDE.md, přes skill foodtab-finance): banka je
-- VÝHRADNĚ PRO ČTENÍ, nikdy platební příkazy. Tahle migrace to vynucuje
-- STRUKTUROU, ne jen dokumentací: `transakce` je append-only ledger
-- (žádný update, žádný delete) zapisovaný ručně nebo importem — nic
-- v appce neodesílá platbu nikam ven, protože tu k tomu není žádná
-- tabulka ani RPC.
--
-- Immutabilita a druhá linie obrany kopírují přesně vzor
-- ingredient_purchase_prices/app.hlida_firmu_suroviny
-- (20261002100000_sklad_suroviny_zaklad.sql) — storno je nový řádek, ne
-- oprava starého; DELETE je odepřený chybějícím grantem, ne jen RLS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PLATEBNÍ ÚČTY
-- ---------------------------------------------------------------------

create table public.platebni_ucty (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- null = účet platí za celou firmu (typicky hlavní bankovní účet)
  branch_id  uuid references public.branches(id) on delete cascade,
  nazev      text not null check (length(btrim(nazev)) > 0),
  typ        text not null check (typ in ('banka', 'pokladna', 'karta')),
  cislo_uctu text not null default '',
  mena       text not null default 'CZK',
  aktivni    boolean not null default true,
  created_at timestamptz not null default now()
);

create index platebni_ucty_tenant on public.platebni_ucty (tenant_id) where aktivni;

alter table public.platebni_ucty enable row level security;

revoke all on public.platebni_ucty from anon;
revoke truncate, references, trigger on public.platebni_ucty from authenticated;
grant select, insert, update, delete on public.platebni_ucty to authenticated;

create policy platebni_ucty_read on public.platebni_ucty for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy platebni_ucty_write on public.platebni_ucty for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

drop trigger if exists trg_audit_platebni_ucty on public.platebni_ucty;
create trigger trg_audit_platebni_ucty
  after insert or update or delete on public.platebni_ucty
  for each row execute function app.audit_zmenu('platebni_ucet');


-- ---------------------------------------------------------------------
-- IMPORTNÍ DÁVKY — jeden řádek na jeden nahraný CSV soubor. Opakovaný
-- upload STEJNÉHO souboru se pozná (unikátní hash), nezpracuje se tiše
-- znovu. Vzniká PŘED `transakce`, která na ni odkazuje (import_davka_id).
-- ---------------------------------------------------------------------

create table public.import_davky (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  typ           text not null check (typ in ('banka_csv', 'pokladna_csv')),
  soubor_nazev  text not null default '',
  soubor_hash   text not null,
  pocet_radku   integer not null default 0,
  pocet_novych  integer not null default 0,
  stav          text not null check (stav in ('zpracovano', 'castecne', 'chyba')),
  nahral        uuid references public.profiles(user_id) on delete set null,
  nahrano_kdy   timestamptz not null default now()
);

create unique index import_davky_tenant_hash on public.import_davky (tenant_id, soubor_hash);

alter table public.import_davky enable row level security;

revoke all on public.import_davky from anon;
revoke truncate, references, trigger on public.import_davky from authenticated;
grant select, insert on public.import_davky to authenticated;

create policy import_davky_read on public.import_davky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy import_davky_insert on public.import_davky for insert to authenticated
  with check (app.has_access(tenant_id, 'finance.manage', null));


-- ---------------------------------------------------------------------
-- TRANSAKCE — append-only ledger. Nikdy UPDATE, nikdy DELETE.
-- ---------------------------------------------------------------------

create table public.transakce (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  ucet_id         uuid not null references public.platebni_ucty(id) on delete cascade,
  smer            text not null check (smer in
                    ('prijem', 'vydaj', 'prevod_dovnitr', 'prevod_ven')),
  castka_haleru   integer not null check (castka_haleru > 0),
  mena            text not null default 'CZK',
  datum           date not null,
  protistrana     text not null default '',
  vs              text not null default '',
  poznamka        text not null default '',
  zdroj           text not null check (zdroj in
                    ('rucni', 'csv_banka', 'csv_pokladna', 'pos_adapter')),
  -- Id řádku u poskytovatele/v CSV souboru — umožňuje idempotentní
  -- re-import (viz unikátní index níž). NULL u ručně zapsaných řádků.
  externi_id      text,
  -- NE `on delete set null`: ta akce by při mazání `import_davky`
  -- potřebovala interní UPDATE na `transakce`, a ten dole beze zbytku
  -- blokuje `transakce_no_update` (nález při psaní krok74_scenar.sql —
  -- „referential integrity query ... gave unexpected result"). `restrict`
  -- se navíc kryje s tím, že dávka je provenience importu: dokud na ni
  -- transakce odkazuje, nemá zmizet ani přes service_role.
  import_davka_id uuid references public.import_davky(id) on delete restrict,
  -- Oprava historického řádku je VŽDY nový řádek odkazující na ten
  -- původní, nikdy editace (zadání §4: "faktura není bankovní pohyb...",
  -- a historie se nesmí tiše přepsat).
  storno_of       uuid references public.transakce(id),
  created_by      uuid references public.profiles(user_id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.transakce is
  'Immutabilní ledger peněžních pohybů. Žádný UPDATE (rule níže), žádný '
  'DELETE (chybějící grant, ne jen RLS) — oprava je nový řádek se '
  'storno_of. Banka je výhradně pro čtení: tahle tabulka nikdy nikam '
  'neodesílá platbu, jen zaznamenává pohyby, které už nastaly.';

-- Idempotentní import: stejný externí řádek (bankovní transakce, denní
-- uzávěrka pokladny) se znovu importovaným souborem NEZDVOJÍ (zadání
-- §13, scénář 5: "import téhož bankovního souboru znovu nezdvojí
-- cashflow"). `on conflict (ucet_id, externi_id) do nothing` v importu.
create unique index transakce_externi_id
  on public.transakce (ucet_id, externi_id)
  where externi_id is not null;

create index transakce_ucet_datum on public.transakce (ucet_id, datum desc);
create index transakce_nesparovane on public.transakce (tenant_id, datum)
  where storno_of is null;

-- DRUHÁ LINIE OBRANY (stejná třída jako app.hlida_firmu_suroviny/
-- app.hlida_firmu_kontaktu): RLS hlídá jen tenant_id ŘÁDKU, ne že ucet_id
-- (a je-li vyplněné, import_davka_id) patří téže firmě.
create function app.hlida_firmu_transakce()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.platebni_ucty u
    where u.id = new.ucet_id
      and u.tenant_id = new.tenant_id
  ) then
    raise exception 'Platební účet nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  if new.import_davka_id is not null and not exists (
    select 1 from public.import_davky d
    where d.id = new.import_davka_id
      and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Importní dávka nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_transakce() is
  'Spoušť: tenant_id řádku musí být firma účtu (ucet_id) i firma dávky '
  '(import_davka_id, je-li vyplněná). Stejná třída opravy jako '
  'app.hlida_firmu_suroviny.';

revoke all on function app.hlida_firmu_transakce() from public, anon, authenticated;

create trigger trg_firma_transakce
  before insert or update of tenant_id, ucet_id, import_davka_id on public.transakce
  for each row execute function app.hlida_firmu_transakce();

-- Žádná úprava historického pohybu — stejný vzor jako
-- ingredient_purchase_prices_no_update. Žádné pravidlo na DELETE (by
-- rozbilo `on delete cascade` z platebni_ucty) — DELETE je odepřený
-- chybějícím grantem níž, ne rulem.
create rule transakce_no_update as
  on update to public.transakce do instead nothing;

alter table public.transakce enable row level security;

-- Chybějící grant DELETE je záměrný — stejná dvojí linie (chybějící
-- grant + RLS) jako u employee_rates/ingredient_purchase_prices. Nejdřív
-- se odebere VŠE (výchozí práva Supabase by authenticated/anon jinak
-- daly samy), teprve potom se vypíše, co authenticated doopravdy smí.
revoke all on public.transakce from anon, authenticated;
grant select, insert on public.transakce to authenticated;

create policy transakce_read on public.transakce for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy transakce_insert on public.transakce for insert to authenticated
  with check (app.has_access(tenant_id, 'finance.manage', null));

drop trigger if exists trg_audit_transakce on public.transakce;
create trigger trg_audit_transakce
  after insert on public.transakce
  for each row execute function app.audit_zmenu('transakce');
