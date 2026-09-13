-- =====================================================================
-- Foodtab — B1: sjednocený adresát nástěnky
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 4 B1
--         docs/nastenka-dokumenty-a-strediska.md, oddíl 1
--
-- Úkoly mají od 20260906040000 usek_id a position_id. Nástěnka dnes
-- zvládá jen firmu, pobočku a jednoho člověka. Sjednotit.
--
-- LOGIKA ADRESÁTA (jeden cíl, ne kombinace):
--   employee_id nastaven  → konkrétní zaměstnanec
--   usek_id nastaven      → zaměstnanci toho úseku (via employees.usek_id)
--   position_id nastaven  → zaměstnanci té pozice (via employees.position_id)
--   branch_id nastaven    → pobočka (všichni s právy)
--   vše null              → celá firma
--
-- VIDITELNOST — kontroluje RLS:
--   Úsekové oznámení vidí jen kdo má employees.usek_id = announcement.usek_id.
--   Poziční vidí kdo má employees.position_id = announcement.position_id.
--   Vedoucí s communication.manage vidí vše ve svém dosahu.
--
-- CO SE MĚNÍ:
--   1. employees dostane usek_id (FK na useky), abychom věděli, kdo
--      do jakého úseku patří — bez toho by RLS nemohl filtrovat.
--   2. announcements dostane usek_id + position_id.
--   3. announcements_read RLS se rozšíří o tyto filtry.
--   4. Trigger upozornit_na_oznameni_trg se rozšíří o nové větve.
--   5. kdo_nepotvrdil se rozšíří o nové větve.
--
-- PRAVIDLO 7b: trigger i kdo_nepotvrdil jsou SECURITY DEFINER —
--   žádné RLS uvnitř, filtry si píší samy.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PŘIŘAZENÍ ZAMĚSTNANCE K ÚSEKU
--
-- Bez tohohle sloupce se nedá zjistit, kdo patří do jakého úseku,
-- a RLS pro úsekové oznámení by nemělo s čím filtrovat.
--
-- Sloupcový grant je povinný: employees.phone/email má revoke all
-- a grant po sloupcích (20260901120000_osobni_udaje.sql, ř. 78–83).
-- Nový sloupec bez grantu hodí 42501 na celé stránce, kde se čtou
-- zaměstnanci — viz CLAUDE.md.
-- ---------------------------------------------------------------------

alter table public.employees
  add column if not exists usek_id uuid
    references public.useky(id) on delete set null;

comment on column public.employees.usek_id is
  'Úsek, do kterého zaměstnanec patří. NULL = žádné přiřazení / firma '
  'úseky nemá. Nástěnka a oznámení tenhle sloupec čtou v RLS politice; '
  'bez grantu níž by jim hlas šel celý pryč.';

grant select (usek_id) on public.employees to authenticated;
grant update (usek_id) on public.employees to authenticated;


-- ---------------------------------------------------------------------
-- 2. SLOUPCE NA ANNOUNCEMENTS
-- ---------------------------------------------------------------------

alter table public.announcements
  add column if not exists usek_id     uuid
    references public.useky(id)     on delete set null,
  add column if not exists position_id uuid
    references public.positions(id) on delete set null;

comment on column public.announcements.usek_id is
  'Oznámení jen pro zaměstnance toho úseku. NULL = úsek nevybírá.';
comment on column public.announcements.position_id is
  'Oznámení jen pro zaměstnance té pozice. NULL = pozice nevybírá.';

-- Nejvýš jeden z employee_id / usek_id / position_id — jinak by
-- se adresát musel skládat z průniku a chybové hlášce by nikdo
-- nerozuměl. branch_id smí stát vedle každého z nich.
alter table public.announcements
  drop constraint if exists announcements_jeden_cil;
alter table public.announcements
  add constraint announcements_jeden_cil
  check (num_nonnulls(employee_id, usek_id, position_id) <= 1);


-- ---------------------------------------------------------------------
-- 3. announcements_read — rozšíření o úsek a pozici
--
-- Původní politika (20260823130000_provoz.sql, ř. 522–531) povoluje
-- čtení, pokud má uživatel can_read_scoped a (employee_id je null
-- NEBO je to jeho employee_id). Rozšiřuje se o dva analogické bloky.
--
-- Každý blok zvlášť, ne jeden kombinovaný AND — pravidlo z CLAUDE.md:
-- „na každý z těch tří filtrů vlastní kontrola s cizí firmou, rozbíjená
-- po jednom".
-- ---------------------------------------------------------------------

drop policy if exists announcements_read on public.announcements;

create policy announcements_read on public.announcements for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'communication.read', branch_id)

    -- (a) Osobní oznámení: jen pro mě, nebo kdo spravuje komunikaci.
    and (
      employee_id is null
      or employee_id in (
        select e.id from public.employees e
         where e.user_id = (select auth.uid())
      )
      or app.has_access(tenant_id, 'communication.manage', branch_id)
    )

    -- (b) Úsekové oznámení: jen pro lidi toho úseku, nebo manager.
    and (
      usek_id is null
      or usek_id in (
        select e.usek_id from public.employees e
         where e.user_id = (select auth.uid())
           and e.deleted_at  is null
           and e.usek_id     is not null
      )
      or app.has_access(tenant_id, 'communication.manage', branch_id)
    )

    -- (c) Poziční oznámení: jen pro lidi té pozice, nebo manager.
    and (
      position_id is null
      or position_id in (
        select e.position_id from public.employees e
         where e.user_id     = (select auth.uid())
           and e.deleted_at  is null
           and e.position_id is not null
      )
      or app.has_access(tenant_id, 'communication.manage', branch_id)
    )
  );

comment on policy announcements_read on public.announcements is
  'Čtení: can_read_scoped + filtr dle cíle (osobní / úsek / pozice). '
  'Vedoucí s communication.manage vidí vše ve svém dosahu.';


-- ---------------------------------------------------------------------
-- 4. Trigger upozornění — rozšíření o usek_id a position_id
--
-- Původní trigger (20260913110000_upozorneni_oznameni_vzkazy.sql)
-- filtruje zaměstnance takto:
--   employee_id nastaven → jen ten člověk
--   branch_id nastaven   → zaměstnanci pobočky
--   oboje null           → všichni zaměstnanci firmy
--
-- Přidávají se dvě větve: usek_id a position_id.
-- Pořadí priorit: employee_id > usek_id > position_id > branch_id > firma.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_oznameni_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.created_at at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       -- Vlastní oznámení neupozorňuje (C3/2): author_id = profiles.user_id.
       and (NEW.author_id is null or e.user_id <> NEW.author_id)
       -- Adresování: employee_id má nejvyšší prioritu, pak úsek, pozice,
       -- pobočka; null ve všech = celá firma.
       and (
         (NEW.employee_id  is not null and e.id          = NEW.employee_id)
         or (NEW.usek_id   is not null and e.usek_id     = NEW.usek_id
               and NEW.employee_id is null)
         or (NEW.position_id is not null and e.position_id = NEW.position_id
               and NEW.employee_id is null and NEW.usek_id is null)
         or (NEW.branch_id is not null
               and NEW.employee_id is null and NEW.usek_id is null and NEW.position_id is null
               and e.branch_id = NEW.branch_id)
         or (NEW.employee_id is null and NEW.usek_id is null
               and NEW.position_id is null and NEW.branch_id is null)
       )
  loop
    -- Sloučení (C4): smazat nepřečtené téhož druhu a dne.
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'oznameni.nova'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      NEW.branch_id,
      'oznameni.nova',
      jsonb_build_object('den', v_den)
    );
  end loop;

  return NEW;
end $$;

drop trigger if exists upozornit_na_oznameni on public.announcements;

create trigger upozornit_na_oznameni
  after insert on public.announcements
  for each row execute function app.upozornit_na_oznameni_trg();

comment on function app.upozornit_na_oznameni_trg() is
  'Po vložení oznámení zapíše oznameni.nova adresátům. Pořadí priorit: '
  'employee_id > usek_id > position_id > branch_id > celá firma. '
  'Mergeuje (user_id, druh, den). Vlastní oznámení neupozorňuje.';


-- ---------------------------------------------------------------------
-- 5. kdo_nepotvrdil — rozšíření o usek_id a position_id
-- ---------------------------------------------------------------------

create or replace function public.kdo_nepotvrdil(p_tenant uuid, p_announcement uuid)
returns table(jmeno text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_branch_id   uuid;
  v_usek_id     uuid;
  v_position_id uuid;
  v_author_id   uuid;
begin
  -- Pravidlo 7b: tenant_id i requires_acknowledgment filtrujeme sami.
  select a.employee_id, a.branch_id, a.usek_id, a.position_id, a.author_id
    into v_employee_id, v_branch_id, v_usek_id, v_position_id, v_author_id
    from public.announcements a
   where a.id = p_announcement
     and a.tenant_id = p_tenant
     and a.requires_acknowledgment = true;

  if not found then return; end if;

  return query
    select coalesce(nullif(trim(p.full_name::text), ''), 'Neznámý') as jmeno
      from public.employees e
      left join public.profiles p on p.user_id = e.user_id
     where e.tenant_id  = p_tenant
       and e.deleted_at is null
       and e.user_id    is not null
       -- Autor nemusí potvrzovat.
       and (v_author_id is null or e.user_id <> v_author_id)
       -- Stejné pořadí priorit jako trigger:
       -- employee_id > usek_id > position_id > branch_id > firma.
       and (
         (v_employee_id  is not null and e.id          = v_employee_id)
         or (v_usek_id   is not null and e.usek_id     = v_usek_id
               and v_employee_id is null)
         or (v_position_id is not null and e.position_id = v_position_id
               and v_employee_id is null and v_usek_id is null)
         or (v_branch_id is not null
               and v_employee_id is null and v_usek_id is null and v_position_id is null
               and e.branch_id = v_branch_id)
         or (v_employee_id is null and v_usek_id is null
               and v_position_id is null and v_branch_id is null)
       )
       and not exists (
         select 1 from public.announcement_reads ar
          where ar.announcement_id = p_announcement
            and ar.user_id         = e.user_id
       )
     order by jmeno;
end $$;

comment on function public.kdo_nepotvrdil(uuid, uuid) is
  'Jména zaměstnanců, kteří ještě nepotvrdili oznámení s povinným '
  'potvrzením. SECURITY DEFINER — žádné RLS uvnitř.';

revoke all on function public.kdo_nepotvrdil(uuid, uuid) from public, anon;
grant execute on function public.kdo_nepotvrdil(uuid, uuid) to authenticated;
