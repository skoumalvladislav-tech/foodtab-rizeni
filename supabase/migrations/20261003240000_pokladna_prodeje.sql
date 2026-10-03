-- =====================================================================
-- Foodtab — Finance: denní pokladní prodeje (Dotykačka adaptér, P1)
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 8): „Dotykačku
-- implementuj jako první volitelný adapter... Nepředpokládej existenci
-- webhooků, dokud ji neověříš." + oddíl 1A: „CSV/ruční import je
-- plnohodnotný základní provider; produkt musí být použitelný bez
-- placených externích integrací."
--
-- V TOMHLE PROSTŘEDÍ NEJSOU ŽÁDNÉ ŽIVÉ PŘÍSTUPY K DOTYKAČCE — appka
-- proto staví PROVIDER-NEUTRÁLNÍ tvar (denní souhrn prodeje po
-- produktu) a CSV fallback, registr přes existující
-- `integrace_pripojeni` (oblast='pokladna'). Živé API volání by přibylo
-- jako DALŠÍ zdroj dat do STEJNÉ tabulky (zdroj='dotykacka_api'), ne
-- jako přepis — to je celý smysl provider-neutral kontraktu (zadání
-- §1A: „Přidání nového poskytovatele má vyžadovat nový adapter...
-- nikoli přepis finančních výpočtů").
--
-- JEN SOUHRN PRODEJE, ŽÁDNÝ SKLAD: produkt/množství/tržba za den —
-- ne skladové pohyby. Používá se jako VSTUP pro budoucí porovnání
-- teoretické vs. reálné spotřeby (recipe_cost_per_portion × mnozstvi),
-- samo o sobě nic neodečítá ze skladu, protože sklad appka nestaví.
-- =====================================================================

-- `import_davky.typ` byl omezen na 'banka_csv'/'pokladna_csv' (účetní
-- pohyb) — denní souhrn prodeje po produktu je jiný typ dávky.
alter table public.import_davky drop constraint import_davky_typ_check;
alter table public.import_davky add constraint import_davky_typ_check
  check (typ in ('banka_csv', 'pokladna_csv', 'pokladna_prodeje_csv'));

create table public.pokladna_prodeje_denni (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  datum           date not null,
  produkt_nazev   text not null check (length(btrim(produkt_nazev)) > 0),
  -- Volné propojení na katalog receptur — appka ho zkusí dohledat podle
  -- názvu při importu, ale nevynucuje ho (produkt v pokladně nemusí mít
  -- recepturu vůbec, nebo se jmenuje jinak).
  recipe_id       uuid references public.recipes(id) on delete set null,
  mnozstvi        numeric not null default 0 check (mnozstvi >= 0),
  trzba_haleru    integer not null default 0 check (trzba_haleru >= 0),
  zdroj           text not null check (zdroj in ('dotykacka_api', 'csv')),
  import_davka_id uuid references public.import_davky(id) on delete restrict,
  created_at      timestamptz not null default now()
);

-- Idempotentní import: stejný den/produkt/zdroj se znovu importovaným
-- souborem NEZDVOJÍ — žádné pravidlo na UPDATE na týhle tabulce (na
-- rozdíl od transakce), ON CONFLICT DO UPDATE je proto bez omezení.
create unique index pokladna_prodeje_den_produkt on public.pokladna_prodeje_denni
  (tenant_id, branch_id, datum, produkt_nazev, zdroj);

create index pokladna_prodeje_tenant_datum on public.pokladna_prodeje_denni (tenant_id, datum);

alter table public.pokladna_prodeje_denni enable row level security;

revoke all on public.pokladna_prodeje_denni from anon;
revoke truncate, references, trigger on public.pokladna_prodeje_denni from authenticated;
grant select, insert, update, delete on public.pokladna_prodeje_denni to authenticated;

create policy pokladna_prodeje_read on public.pokladna_prodeje_denni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy pokladna_prodeje_write on public.pokladna_prodeje_denni for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

create function app.hlida_firmu_pokladna_prodeje()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.tenant_id = new.tenant_id
  ) then
    raise exception 'Pobočka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.import_davka_id is not null and not exists (
    select 1 from public.import_davky d
    where d.id = new.import_davka_id and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Importní dávka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_pokladna_prodeje() from public, anon, authenticated;

create trigger trg_firma_pokladna_prodeje
  before insert or update of tenant_id, branch_id, import_davka_id on public.pokladna_prodeje_denni
  for each row execute function app.hlida_firmu_pokladna_prodeje();


-- ---------------------------------------------------------------------
-- HROMADNÝ IMPORT — stejný důvod jako u Nákupu: bez tohohle by appka
-- musela dělat jednotlivé upserty z klienta (pomalé, bez atomicity
-- importní dávky). Žádné pravidlo na UPDATE tabulky, takže ON CONFLICT
-- funguje přímo — na rozdíl od public.importovat_transakce.
-- ---------------------------------------------------------------------

create or replace function public.importovat_pokladna_prodeje(
  p_tenant uuid,
  p_branch uuid,
  p_davka  uuid,
  p_zdroj  text,
  p_radky  jsonb -- [{datum, produkt_nazev, mnozstvi, trzba_haleru}]
)
returns integer
language sql security invoker set search_path = ''
as $$
  with vlozene as (
    insert into public.pokladna_prodeje_denni (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, import_davka_id)
    select p_tenant, p_branch, r.datum::date, r.produkt_nazev, r.mnozstvi, r.trzba_haleru, p_zdroj, p_davka
    from jsonb_to_recordset(p_radky) as r(datum text, produkt_nazev text, mnozstvi numeric, trzba_haleru integer)
    on conflict (tenant_id, branch_id, datum, produkt_nazev, zdroj) do update
      set mnozstvi = excluded.mnozstvi,
          trzba_haleru = excluded.trzba_haleru,
          import_davka_id = excluded.import_davka_id
    returning 1
  )
  select count(*)::integer from vlozene;
$$;

comment on function public.importovat_pokladna_prodeje(uuid, uuid, uuid, text, jsonb) is
  'Hromadný import denních pokladních prodejů — opakovaný import téhož '
  'dne/produktu PŘEPÍŠE (ne zdvojí), na rozdíl od transakce, kde se '
  'duplicita jen zahazuje. Pokladní uzávěrka se smí opravit novým CSV '
  'za stejný den, platba v ledgeru ne.';

revoke all on function public.importovat_pokladna_prodeje(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.importovat_pokladna_prodeje(uuid, uuid, uuid, text, jsonb) to authenticated;
