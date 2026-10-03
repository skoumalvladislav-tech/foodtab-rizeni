-- =====================================================================
-- Foodtab — Finance: kontakty (CRM) — dodavatelé, odběratelé, partneři
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5 ("CRM:
-- jednotný kontakt dodavatele, zákazníka, firemního odběratele a
-- partnera; více rolí jednoho kontaktu"). Plán: proud-scribbling-glade.md,
-- migrace 2.
--
-- Faktury (app/[rozsah]/finance/faktury) mají dodavatele jako PROSTÝ
-- TEXT (invoices.supplier/supplier_ico) — a zůstanou tak: data faktur
-- žijí v oddělené databázi (ctqtwahlzhyjerqulqyn), žádný FK/join odtud
-- nejde postavit. Tahle tabulka neslučuje historii faktur, slouží NOVÝM
-- tokům (objednávky dodavatelům v P1, párování plateb) jako skutečná
-- entita, na kterou se dá odkázat FK uvnitř hlavní databáze.
--
-- Firemní úroveň (bez branch_id) — stejné zdůvodnění jako u `recipes`/
-- `ingredients`: dodavatel/odběratel není vázaný na jednu pobočku.
-- Oprávnění: `finance.read`/`finance.manage` (nepoužité, viz migrace 1).
-- =====================================================================


create table public.kontakty (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  nazev                   text not null check (length(btrim(nazev)) > 0),
  ico                     text,
  dic                     text,
  je_dodavatel            boolean not null default false,
  je_odberatel            boolean not null default false,
  je_partner              boolean not null default false,
  adresa                  jsonb not null default '{}'::jsonb,
  platebni_podminky_dni   smallint check (platebni_podminky_dni is null or platebni_podminky_dni >= 0),
  poznamka                text not null default '',
  created_by              uuid references public.profiles(user_id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

comment on table public.kontakty is
  'CRM: dodavatelé/odběratelé/partneři firmy. Historická data Faktur '
  '(invoices.supplier, prostý text v oddělené databázi) se NEmigrují sem — '
  'tahle tabulka slouží novým tokům (objednávky, párování plateb), ne '
  'přepisu minulosti.';

-- Rozpoznávací klíč v rámci firmy, jen mezi nesmazanými — stejný vzor
-- jako ingredients_tenant_nazev (20261002100000_sklad_suroviny_zaklad.sql).
create unique index kontakty_tenant_nazev
  on public.kontakty (tenant_id, lower(btrim(nazev)))
  where deleted_at is null;

-- IČO NENÍ unikátní záměrně: různé pobočky téže firmy mohou mít
-- oddělené kontakty se stejným IČO (např. centrála vs. provozovna
-- dodavatele) — index jen pro vyhledávání, ne pro deduplikaci.
create index kontakty_tenant_ico
  on public.kontakty (tenant_id, ico) where deleted_at is null and ico is not null;

alter table public.kontakty enable row level security;

revoke all on public.kontakty from anon;
revoke truncate, references, trigger on public.kontakty from authenticated;
grant select, insert, update, delete on public.kontakty to authenticated;

create policy kontakty_read on public.kontakty for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy kontakty_write on public.kontakty for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

drop trigger if exists trg_audit_kontakty on public.kontakty;
create trigger trg_audit_kontakty
  after insert or update or delete on public.kontakty
  for each row execute function app.audit_zmenu('kontakt');


-- ---------------------------------------------------------------------
-- KONTAKTNÍ OSOBY — jeden kontakt může mít víc lidí (zadání §5:
-- "kontaktní osoby").
-- ---------------------------------------------------------------------

create table public.kontakty_osoby (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kontakt_id uuid not null references public.kontakty(id) on delete cascade,
  jmeno      text not null check (length(btrim(jmeno)) > 0),
  telefon    text not null default '',
  email      text not null default '',
  poznamka   text not null default '',
  created_at timestamptz not null default now()
);

create index kontakty_osoby_kontakt on public.kontakty_osoby (kontakt_id);

-- DRUHÁ LINIE OBRANY (vzor app.hlida_firmu_suroviny,
-- 20261002100000_sklad_suroviny_zaklad.sql:142-177; historický incident
-- 20260925120000_prava_firma_radku.sql): RLS níže hlídá jen tenant_id
-- ŘÁDKU, ne to, že kontakt_id patří TÉŽE firmě. Bez týhle spouště by
-- správce firmy B zapsal kontaktní osobu s tenant_id=B a kontakt_id
-- ukazujícím na kontakt firmy A.
create function app.hlida_firmu_kontaktu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.kontakty k
    where k.id = new.kontakt_id
      and k.tenant_id = new.tenant_id
  ) then
    raise exception 'Kontakt nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_kontaktu() is
  'Spoušť: tenant_id řádku musí být firma kontaktu (kontakt_id). '
  'Stejná třída opravy jako app.hlida_firmu_suroviny.';

revoke all on function app.hlida_firmu_kontaktu() from public, anon, authenticated;

create trigger trg_firma_kontaktni_osoba
  before insert or update of tenant_id, kontakt_id on public.kontakty_osoby
  for each row execute function app.hlida_firmu_kontaktu();

alter table public.kontakty_osoby enable row level security;

revoke all on public.kontakty_osoby from anon;
revoke truncate, references, trigger on public.kontakty_osoby from authenticated;
grant select, insert, update, delete on public.kontakty_osoby to authenticated;

create policy kontakty_osoby_read on public.kontakty_osoby for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy kontakty_osoby_write on public.kontakty_osoby for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

drop trigger if exists trg_audit_kontakty_osoby on public.kontakty_osoby;
create trigger trg_audit_kontakty_osoby
  after insert or update or delete on public.kontakty_osoby
  for each row execute function app.audit_zmenu('kontakt_osoba');
