-- =====================================================================
-- Foodtab — Finance: Zakázky (order-to-cash, CRM cateringu)
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5):
-- „Order to cash: poptávka/objednávka/rezervace → zakázka → prodej či
-- realizace → doklad → pohledávka → úhrada." + (CRM) „Podpora
-- cateringu, firemních akcí, rautů, záloh a zakázek: poptávka →
-- nabídka → zakázka → realizace → faktura → úhrada." Akceptační
-- scénář 19: zakázka se zálohou propojí nákup/výrobu/plán práce/
-- fakturu/zúčtování zálohy/marži.
--
-- Záloha se NEUKLÁDÁ jako mutovatelné pole (desynchronizace) — je to
-- SOUČET transakcí propojených přes `transakce.zakazka_id` (aditivní
-- sloupec, stejný vzor jako import_davka_id). Marže = cena zakázky -
-- náklady (suroviny/práce se dnes evidují jinde — tahle migrace jen
-- propojuje doklad, peníze a pohledávku, ne teoretickou kalkulaci
-- marže; to je u konkrétní zakázky na appce, až bude potřeba).
-- =====================================================================


-- ---------------------------------------------------------------------
-- ZAKÁZKY — hlavička.
-- ---------------------------------------------------------------------

create table public.zakazky (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  branch_id               uuid references public.branches(id) on delete cascade,
  kontakt_id              uuid not null references public.kontakty(id),
  cislo                   text not null,
  nazev                   text not null check (length(btrim(nazev)) > 0),
  stav                    text not null default 'poptavka' check (stav in
                            ('poptavka', 'nabidka', 'potvrzeno', 'realizovano', 'vyfakturovano', 'uhrazeno', 'zrušeno')),
  datum_akce              date,
  pocet_hostu             integer check (pocet_hostu is null or pocet_hostu > 0),
  cena_celkem_haleru      integer not null default 0 check (cena_celkem_haleru >= 0),
  zaloha_pozadovana_haleru integer not null default 0 check (zaloha_pozadovana_haleru >= 0),
  -- Faktura žije v oddělené DB (ctqtwahlzhyjerqulqyn) — prostý text.
  faktura_id              text,
  poznamka                text not null default '',
  created_by              uuid references public.profiles(user_id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index zakazky_tenant_cislo on public.zakazky (tenant_id, cislo);
create index zakazky_tenant_stav on public.zakazky (tenant_id, stav);

alter table public.zakazky enable row level security;

revoke all on public.zakazky from anon;
revoke truncate, references, trigger on public.zakazky from authenticated;
grant select, insert, update, delete on public.zakazky to authenticated;

create policy zakazky_read on public.zakazky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy zakazky_write on public.zakazky for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

create function app.hlida_firmu_zakazky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.kontakty k
    where k.id = new.kontakt_id and k.tenant_id = new.tenant_id
  ) then
    raise exception 'Odběratel nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_zakazky() from public, anon, authenticated;

create trigger trg_firma_zakazky
  before insert or update of tenant_id, kontakt_id on public.zakazky
  for each row execute function app.hlida_firmu_zakazky();

drop trigger if exists trg_audit_zakazky on public.zakazky;
create trigger trg_audit_zakazky
  after insert or update or delete on public.zakazky
  for each row execute function app.audit_zmenu('zakazka');


-- ---------------------------------------------------------------------
-- POLOŽKY ZAKÁZKY — nabídka/rozpočet akce.
-- ---------------------------------------------------------------------

create table public.zakazky_polozky (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  zakazka_id              uuid not null references public.zakazky(id) on delete cascade,
  popis                   text not null check (length(btrim(popis)) > 0),
  mnozstvi                numeric not null default 1 check (mnozstvi > 0),
  cena_za_jednotku_haleru integer not null check (cena_za_jednotku_haleru >= 0)
);

create index zakazky_polozky_zakazka on public.zakazky_polozky (zakazka_id);

alter table public.zakazky_polozky enable row level security;

revoke all on public.zakazky_polozky from anon;
revoke truncate, references, trigger on public.zakazky_polozky from authenticated;
grant select, insert, update, delete on public.zakazky_polozky to authenticated;

create policy zakazky_polozky_read on public.zakazky_polozky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));
create policy zakazky_polozky_write on public.zakazky_polozky for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

create function app.hlida_firmu_zakazky_polozky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.zakazky z
    where z.id = new.zakazka_id and z.tenant_id = new.tenant_id
  ) then
    raise exception 'Zakázka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_zakazky_polozky() from public, anon, authenticated;

create trigger trg_firma_zakazky_polozky
  before insert or update of tenant_id, zakazka_id on public.zakazky_polozky
  for each row execute function app.hlida_firmu_zakazky_polozky();


-- ---------------------------------------------------------------------
-- PROPOJENÍ PLATEB SE ZAKÁZKOU — aditivní sloupec na `transakce`,
-- stejný vzor jako `import_davka_id`. Záloha/doplatek je pak SOUČET
-- transakcí s tímhle zakazka_id, ne mutovatelné pole — nejde
-- desynchronizovat s tím, co doopravdy došlo na účet.
-- ---------------------------------------------------------------------

-- NE `on delete set null` — stejný nález jako u import_davka_id
-- (20261003120000): SET NULL potřebuje interní UPDATE na `transakce`,
-- který `transakce_no_update` pravidlo vždy blokuje. RESTRICT navíc
-- dává smysl i věcně — platba propojená se zakázkou je provenience,
-- zakázka se smazáním transakce nepřetrhne tiše.
alter table public.transakce
  add column if not exists zakazka_id uuid references public.zakazky(id) on delete restrict;

-- `app.hlida_firmu_transakce` (20261003120000) kontroluje jen ucet_id
-- a import_davka_id — rozšíření o zakazka_id, stejný tvar.
create or replace function app.hlida_firmu_transakce()
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

  if new.zakazka_id is not null and not exists (
    select 1 from public.zakazky z
    where z.id = new.zakazka_id
      and z.tenant_id = new.tenant_id
  ) then
    raise exception 'Zakázka nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_firma_transakce on public.transakce;
create trigger trg_firma_transakce
  before insert or update of tenant_id, ucet_id, import_davka_id, zakazka_id on public.transakce
  for each row execute function app.hlida_firmu_transakce();


-- ---------------------------------------------------------------------
-- ZALOŽENÍ ZAKÁZKY — stejný důvod jako u Nákupu: volá app.dalsi_cislo.
-- ---------------------------------------------------------------------

create or replace function public.zalozit_zakazku(
  p_tenant     uuid,
  p_branch     uuid,
  p_kontakt    uuid,
  p_nazev      text,
  p_datum_akce date,
  p_pocet_hostu integer,
  p_zaloha_pozadovana_haleru integer,
  p_poznamka   text,
  p_polozky    jsonb -- [{popis, mnozstvi, cena_za_jednotku_haleru}]
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cislo text;
  v_zakazka uuid;
  v_celkem integer := 0;
  v_polozka record;
begin
  if not app.has_access(p_tenant, 'finance.manage', p_branch) then
    raise exception 'Nemáte oprávnění zakládat zakázky.'
      using errcode = 'insufficient_privilege';
  end if;

  v_cislo := app.dalsi_cislo(p_tenant, 'ZAK');

  insert into public.zakazky (
    tenant_id, branch_id, kontakt_id, cislo, nazev, datum_akce,
    pocet_hostu, zaloha_pozadovana_haleru, poznamka
  )
  values (
    p_tenant, p_branch, p_kontakt, v_cislo, p_nazev, p_datum_akce,
    p_pocet_hostu, coalesce(p_zaloha_pozadovana_haleru, 0), coalesce(p_poznamka, '')
  )
  returning id into v_zakazka;

  for v_polozka in
    select * from jsonb_to_recordset(p_polozky) as r(
      popis text, mnozstvi numeric, cena_za_jednotku_haleru integer
    )
  loop
    insert into public.zakazky_polozky (tenant_id, zakazka_id, popis, mnozstvi, cena_za_jednotku_haleru)
    values (p_tenant, v_zakazka, v_polozka.popis, coalesce(v_polozka.mnozstvi, 1), v_polozka.cena_za_jednotku_haleru);
    v_celkem := v_celkem + round(coalesce(v_polozka.mnozstvi, 1) * v_polozka.cena_za_jednotku_haleru);
  end loop;

  update public.zakazky set cena_celkem_haleru = v_celkem where id = v_zakazka;

  return v_zakazka;
end $$;

comment on function public.zalozit_zakazku(uuid, uuid, uuid, text, date, integer, integer, text, jsonb) is
  'Jediný vstupní bod pro založení zakázky s položkami. cena_celkem_haleru '
  'se spočítá ze součtu položek, ne zadává ručně — nejde se rozejít.';

revoke all on function public.zalozit_zakazku(uuid, uuid, uuid, text, date, integer, integer, text, jsonb) from public, anon;
grant execute on function public.zalozit_zakazku(uuid, uuid, uuid, text, date, integer, integer, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- UHRAZENO NA ZAKÁZKU — derived, nikdy uložené.
-- ---------------------------------------------------------------------

create or replace function app.zakazka_uhrazeno(p_tenant uuid, p_zakazka uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(
    case when x.smer = 'prijem' then x.castka_haleru
         when x.smer = 'vydaj' then -x.castka_haleru
         else 0 end
  ), 0)::bigint
  from public.transakce x
  join public.zakazky z on z.id = x.zakazka_id
  where x.zakazka_id = p_zakazka
    and z.tenant_id = p_tenant
    and app.has_access(p_tenant, 'finance.read', z.branch_id);
$$;

comment on function app.zakazka_uhrazeno(uuid, uuid) is
  'Součet transakcí propojených se zakázkou (záloha i doplatek) — '
  'derived z ledgeru, nikdy mutovatelné pole, nejde desynchronizovat.';

revoke all on function app.zakazka_uhrazeno(uuid, uuid) from public, anon;
grant execute on function app.zakazka_uhrazeno(uuid, uuid) to authenticated;

create or replace function public.zakazka_uhrazeno(p_tenant uuid, p_zakazka uuid)
returns bigint
language sql stable security invoker set search_path = ''
as $$
  select app.zakazka_uhrazeno(p_tenant, p_zakazka);
$$;

revoke all on function public.zakazka_uhrazeno(uuid, uuid) from public, anon;
grant execute on function public.zakazka_uhrazeno(uuid, uuid) to authenticated;
