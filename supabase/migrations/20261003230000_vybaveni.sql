-- =====================================================================
-- Foodtab — Finance: evidence vybavení
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5): „Evidence
-- vybavení a servisů: zařízení, přiřazení k provozovně, pořizovací
-- doklad, záruční a servisní termíny, provozní náklady. Případné
-- účetní/daňové odpisy přebírej z účetního systému nebo implementuj
-- pouze s ověřenými pravidly a samostatně vymezeným rozsahem."
--
-- ODPISY SE NESTAVÍ — žádná ověřená CZ daňová pravidla k dispozici
-- v tomhle prostředí. Jen evidence (co firma má, kdy to koupila, kdy
-- končí záruka/servis) — přesně to, co zadání dovoluje bez výhrad.
-- =====================================================================

create table public.vybaveni (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  nazev           text not null check (length(btrim(nazev)) > 0),
  kategorie       text not null default '',
  datum_porizeni  date,
  cena_haleru     integer check (cena_haleru is null or cena_haleru >= 0),
  -- Doklad žije v oddělené DB Faktur — prostý text, žádný FK.
  faktura_id      text,
  zaruka_do       date,
  servis_dalsi_kdy date,
  poznamka        text not null default '',
  aktivni         boolean not null default true,
  created_by      uuid references public.profiles(user_id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index vybaveni_tenant on public.vybaveni (tenant_id) where deleted_at is null;
create index vybaveni_servis on public.vybaveni (tenant_id, servis_dalsi_kdy) where deleted_at is null and servis_dalsi_kdy is not null;

alter table public.vybaveni enable row level security;

revoke all on public.vybaveni from anon;
revoke truncate, references, trigger on public.vybaveni from authenticated;
grant select, insert, update, delete on public.vybaveni to authenticated;

create policy vybaveni_read on public.vybaveni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy vybaveni_write on public.vybaveni for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

drop trigger if exists trg_audit_vybaveni on public.vybaveni;
create trigger trg_audit_vybaveni
  after insert or update or delete on public.vybaveni
  for each row execute function app.audit_zmenu('vybaveni');
