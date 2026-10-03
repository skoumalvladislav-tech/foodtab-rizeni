-- =====================================================================
-- Foodtab — Finance: párování plateb s fakturami
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5 ("Nabídka/
-- zakázka → faktura → pohledávka → platba"), scénář 5 (oddíl 13):
-- "Faktura na 10 000 Kč, úhrada 4 000 Kč → zbývající závazek 6 000 Kč;
-- další úhrada závazek uzavře." Plán: proud-scribbling-glade.md,
-- migrace 4.
--
-- `faktura_id` je PROSTÝ TEXT, nikdy FK: Faktury žijí v oddělené
-- Supabase databázi (ctqtwahlzhyjerqulqyn) — cizí databáze, FK/join
-- nejde postavit nikdy (viz docs/hlaseni/faktury-tenant-izolace-2026-10-02.md).
-- Vlastní párovací logika (jistota skóre) je v TS
-- (lib/finance-parovani.ts), ne tady — tahle migrace jen ukládá
-- VÝSLEDEK (navrženo/potvrzeno/zamítnuto), nikdy ho sama nevypočítá.
-- =====================================================================


create table public.platby_faktury (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  transakce_id  uuid not null references public.transakce(id) on delete cascade,
  faktura_id    text not null,
  castka_haleru integer not null check (castka_haleru > 0),
  -- Jistota párovacího algoritmu (VS/částka/protistrana/datum). NULL u
  -- ručně založeného párování (člověk si je jistý sám, skóre nedává smysl).
  jistota       numeric(4,3) check (jistota is null or jistota between 0 and 1),
  stav          text not null default 'navrzeno' check (stav in
                  ('navrzeno', 'potvrzeno', 'zamitnuto')),
  potvrdil      uuid references public.profiles(user_id) on delete set null,
  potvrzeno_kdy timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.platby_faktury is
  'Párování transakce (hlavní DB) s fakturou (oddělená DB Faktur, '
  'faktura_id je volný text — FK mezi databázemi nejde postavit). '
  'Jistota >= 0.9 se navrhne automaticky, potvrzení je VŽDY lidský klik '
  '(nikdy se nepotvrzuje samo, ani při jistotě 1.0).';

create index platby_faktury_transakce on public.platby_faktury (transakce_id);
create index platby_faktury_faktura on public.platby_faktury (tenant_id, faktura_id);
create index platby_faktury_navrzeno on public.platby_faktury (tenant_id) where stav = 'navrzeno';

-- DRUHÁ LINIE OBRANY — transakce_id musí patřit téže firmě (faktura_id
-- je text bez FK, takže pro něj tahle kontrola nejde postavit — to je
-- přesně důvod, proč párování v DB Faktur vyžaduje zvlášť `tenant_id`
-- filtr na aplikační straně, viz faktury-tenant-izolace).
create function app.hlida_firmu_platby_faktury()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transakce t
    where t.id = new.transakce_id
      and t.tenant_id = new.tenant_id
  ) then
    raise exception 'Transakce nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_platby_faktury() is
  'Spoušť: tenant_id řádku musí být firma transakce (transakce_id). '
  'Stejná třída opravy jako app.hlida_firmu_suroviny.';

revoke all on function app.hlida_firmu_platby_faktury() from public, anon, authenticated;

create trigger trg_firma_platby_faktury
  before insert or update of tenant_id, transakce_id on public.platby_faktury
  for each row execute function app.hlida_firmu_platby_faktury();

alter table public.platby_faktury enable row level security;

revoke all on public.platby_faktury from anon;
revoke truncate, references, trigger on public.platby_faktury from authenticated;
grant select, insert, update on public.platby_faktury to authenticated;

create policy platby_faktury_read on public.platby_faktury for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy platby_faktury_write on public.platby_faktury for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

drop trigger if exists trg_audit_platby_faktury on public.platby_faktury;
create trigger trg_audit_platby_faktury
  after insert or update or delete on public.platby_faktury
  for each row execute function app.audit_zmenu('platba_faktury');
