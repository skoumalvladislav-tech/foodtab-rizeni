-- =====================================================================
-- Foodtab — Finance: předpisy opakovaných plateb (plán pro cashflow)
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5 ("Cashflow:
-- ... Plán příjmů z tržeb a pohledávek, plateb dodavatelům, mezd, nájmu,
-- energií, daní, splátek a dalších opakovaných plateb."). Plán:
-- proud-scribbling-glade.md, migrace 5.
--
-- Ruční vstup pro výhled (nájem, energie, splátky) — NE scénářový
-- motor s základní/konzervativní/optimistickou variantou (zadání o tom
-- mluví, ale tahle noc staví jen první, nejjednodušší vrstvu: plochý
-- seznam opakovaných položek, který si člověk sám udržuje).
-- =====================================================================


create table public.predpisy_plateb (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- null = platí za celou firmu
  branch_id       uuid references public.branches(id) on delete cascade,
  nazev           text not null check (length(btrim(nazev)) > 0),
  smer            text not null check (smer in ('prijem', 'vydaj')),
  castka_haleru   integer not null check (castka_haleru > 0),
  perioda         text not null check (perioda in ('jednorazove', 'mesicne', 'tydne')),
  dalsi_splatnost date not null,
  aktivni         boolean not null default true,
  poznamka        text not null default '',
  created_by      uuid references public.profiles(user_id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index predpisy_plateb_tenant on public.predpisy_plateb (tenant_id) where aktivni;

alter table public.predpisy_plateb enable row level security;

revoke all on public.predpisy_plateb from anon;
revoke truncate, references, trigger on public.predpisy_plateb from authenticated;
grant select, insert, update, delete on public.predpisy_plateb to authenticated;

create policy predpisy_plateb_read on public.predpisy_plateb for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy predpisy_plateb_write on public.predpisy_plateb for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

drop trigger if exists trg_audit_predpisy_plateb on public.predpisy_plateb;
create trigger trg_audit_predpisy_plateb
  after insert or update or delete on public.predpisy_plateb
  for each row execute function app.audit_zmenu('predpis_platby');
