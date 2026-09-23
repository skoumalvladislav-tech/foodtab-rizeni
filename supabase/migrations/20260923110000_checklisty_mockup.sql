-- Checklisty 2.0, vrstva A — vzhled podle mockupu (fotky, poznámka, směna).
--
-- Zadání Šéfíka 23. 9. (52 bodů, mockup, potvrzeno „úplně celé zadání
-- najednou"). Tahle migrace je první z devíti a řeší jen to, co si
-- vynucuje datový model pro vizuální vrstvu: skutečné nahrávání fotek
-- k položce, poznámku, instrukci a volitelný název směny. Provozní
-- hloubka (recurrence, dvojí kontrola, realtime, audit, verzování,
-- priorita „kritická") jde v dalších osmi migracích — viz
-- docs/hlaseni pro pořadí a odkaz na plán.
--
-- ---------------------------------------------------------------------
-- FOTKY JDOU PODLE VZORU PŘÍLOH, NE MARKETINGU
--
-- Checklist se vyplňuje za provozu na mobilu — fotka z telefonu je
-- větší než strop 1 MB na tělo Server Action. Kopíruje se proto vzor
-- 20260921130000_prilohy.sql (klient nahrává přímo do Storage, cesta se
-- ověří RPC až po uploadu), ne server-side upload z marketingu.
--
-- Cesta má navíc třetí úroveň oproti přílohám (`tenant/run/item/soubor`,
-- ne `tenant/konverzace/soubor`) — fotka patří ke KONKRÉTNÍ položce
-- KONKRÉTNÍHO běhu, ne jen ke konverzaci. Vlastní parser
-- (app.checklist_fotka_cesta_rozsah), stejná disciplína jako
-- app.hlasovka_cesta_rozsah: nesmyslná cesta vrací prázdno, ne výjimku.
--
-- ---------------------------------------------------------------------
-- STARTED_BY DOSTÁVÁ DRUHOU LINII JAKO assigned_employee_id/completed_by
--
-- checklist_runs.started_by je nový, třetí sloupec vedle assigned_employee_id
-- (kdo dělá) a completed_by (kdo dokončil) — kdo běh SPUSTIL. Trigger
-- z 20260923100000_checklist_odpovednost.sql se rozšiřuje o stejnou
-- kontrolu (firma přiřazeného člověka musí sedět s firmou běhu), ne
-- vytváří znovu.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SLOUPCE — checklist_items, checklist_runs, checklist_entries
-- ---------------------------------------------------------------------

alter table public.checklist_items
  add column instructions text not null default '';

comment on column public.checklist_items.instructions is
  'Krátká instrukce k položce ("Změř teplotu prostřední lednice."). '
  'Prázdné se v UI nezobrazuje vůbec.';

alter table public.checklist_runs
  add column shift_label text not null default '',
  add column started_by  uuid references public.employees(id) on delete set null;

comment on column public.checklist_runs.shift_label is
  'Volitelný název směny jako prostý text ("Večerní směna") — BEZ vazby '
  'na public.shifts. Jen popisek na kartě, nic nevynucuje.';
comment on column public.checklist_runs.started_by is
  'Kdo běh spustil (spustitChecklist) — server-side, ne z formuláře. '
  'NULL u běhů spuštěných před touhle migrací.';

alter table public.checklist_entries
  add column note text not null default '';

comment on column public.checklist_entries.note is
  'Volná poznámka k položce ("Lednice má vyšší teplotu než obvykle."), '
  'nezávislá na value_number/value_text.';

create or replace function app.checklist_run_prirazeny_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if new.assigned_employee_id is not null
     and (tg_op = 'INSERT'
          or new.assigned_employee_id is distinct from old.assigned_employee_id) then
    select exists (
      select 1 from public.employees e
       where e.id = new.assigned_employee_id
         and e.tenant_id = new.tenant_id
         and e.deleted_at is null
    ) into v_ok;
    if not v_ok then
      raise exception 'Tenhle člověk nepatří k vaší firmě.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.completed_by is not null
     and (tg_op = 'INSERT'
          or new.completed_by is distinct from old.completed_by) then
    select exists (
      select 1 from public.employees e
       where e.id = new.completed_by
         and e.tenant_id = new.tenant_id
         and e.deleted_at is null
    ) into v_ok;
    if not v_ok then
      raise exception 'Tenhle člověk nepatří k vaší firmě.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.started_by is not null
     and (tg_op = 'INSERT'
          or new.started_by is distinct from old.started_by) then
    select exists (
      select 1 from public.employees e
       where e.id = new.started_by
         and e.tenant_id = new.tenant_id
         and e.deleted_at is null
    ) into v_ok;
    if not v_ok then
      raise exception 'Tenhle člověk nepatří k vaší firmě.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $$;

comment on function app.checklist_run_prirazeny_trg() is
  'Druhá linie k RLS na checklist_runs (ta hlídá jen pobočku běhu, ne '
  'firmu přiřazeného/dokončivšího/spustivšího). Bez tohohle by šlo '
  'zapsat cizího zaměstnance — žádný únik dat, ale ticho rozbité propojení.';

drop trigger if exists trg_checklist_run_prirazeny on public.checklist_runs;
create trigger trg_checklist_run_prirazeny
  before insert or update of assigned_employee_id, completed_by, started_by
  on public.checklist_runs
  for each row execute function app.checklist_run_prirazeny_trg();


-- ---------------------------------------------------------------------
-- 2. KBELÍK "checklist-fotky"
--
-- Jen fotky (žádné PDF — checklist fotka je vždy snímek, ne doklad),
-- stejný limit velikosti jako u příloh.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checklist-fotky',
  'checklist-fotky',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
);


-- ---------------------------------------------------------------------
-- 3. TABULKA checklist_polozka_fotky
--
-- Stejný tvar jako konverzace_prilohy: žádný INSERT grant, řádek vzniká
-- jen přes pripojit_checklist_fotku.
-- ---------------------------------------------------------------------

create table public.checklist_polozka_fotky (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  run_id        uuid not null references public.checklist_runs(id) on delete cascade,
  item_id       uuid not null references public.checklist_items(id) on delete cascade,
  cesta         text not null unique,
  nazev         text not null check (char_length(nazev) between 1 and 120),
  mime          text not null
                check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  velikost      integer not null check (velikost > 0 and velikost <= 10485760),
  employee_id   uuid references public.employees(id) on delete set null,
  vytvoreno_kdy timestamptz not null default now()
);

create index checklist_polozka_fotky_run_idx  on public.checklist_polozka_fotky (run_id);
create index checklist_polozka_fotky_item_idx on public.checklist_polozka_fotky (item_id);

comment on table public.checklist_polozka_fotky is
  'Fotky připojené k položce checklistu. Vzniká jen přes '
  'pripojit_checklist_fotku; čte, kdo má tasks.read na pobočce běhu.';

alter table public.checklist_polozka_fotky enable row level security;

create policy checklist_polozka_fotky_select on public.checklist_polozka_fotky
  for select to authenticated
  using (exists (
    select 1 from public.checklist_runs r
     where r.id = run_id
       and app.can_read_scoped(r.tenant_id, 'tasks.read', r.branch_id)));

revoke all on public.checklist_polozka_fotky from public, anon, authenticated;
grant select on public.checklist_polozka_fotky to authenticated;
grant all on public.checklist_polozka_fotky to service_role;


-- ---------------------------------------------------------------------
-- 4. PARSER CESTY — tenant/run/item/soubor
-- ---------------------------------------------------------------------

create or replace function app.checklist_fotka_cesta_rozsah(p_name text)
returns table (tenant_id uuid, run_id uuid, item_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_slozky text[] := storage.foldername(p_name);
begin
  if array_length(v_slozky, 1) is distinct from 3 then
    return;
  end if;

  begin
    tenant_id := v_slozky[1]::uuid;
    run_id    := v_slozky[2]::uuid;
    item_id   := v_slozky[3]::uuid;
  exception when invalid_text_representation then
    return;
  end;

  return next;
end $$;

comment on function app.checklist_fotka_cesta_rozsah(text) is
  'Firma, běh a položka z cesty v úložišti checklist-fotky. Nesmyslná '
  'cesta vrací prázdno, ne výjimku.';

revoke all on function app.checklist_fotka_cesta_rozsah(text) from public, anon;
grant execute on function app.checklist_fotka_cesta_rozsah(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. POLITIKY ÚLOŽIŠTĚ
-- ---------------------------------------------------------------------

create policy checklist_fotky_select on storage.objects for select to authenticated
  using (
    bucket_id = 'checklist-fotky'
    and exists (
      select 1 from app.checklist_fotka_cesta_rozsah(storage.objects.name) c
       join public.checklist_runs r on r.id = c.run_id and r.tenant_id = c.tenant_id
       where app.can_read_scoped(r.tenant_id, 'tasks.read', r.branch_id)));

create policy checklist_fotky_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'checklist-fotky'
    and exists (
      select 1 from app.checklist_fotka_cesta_rozsah(storage.objects.name) c
       join public.checklist_runs r on r.id = c.run_id and r.tenant_id = c.tenant_id
       where app.can_read_scoped(r.tenant_id, 'tasks.read', r.branch_id)));

create policy checklist_fotky_delete_sirotka on storage.objects for delete to authenticated
  using (
    bucket_id = 'checklist-fotky'
    and exists (
      select 1 from app.checklist_fotka_cesta_rozsah(storage.objects.name) c
       join public.checklist_runs r on r.id = c.run_id and r.tenant_id = c.tenant_id
       where app.can_read_scoped(r.tenant_id, 'tasks.read', r.branch_id))
    and not exists (
      select 1 from public.checklist_polozka_fotky p
       where p.cesta = storage.objects.name));


-- ---------------------------------------------------------------------
-- 6. PRIPOJIT_CHECKLIST_FOTKU
--
-- Jediná cesta, kudy fotka vznikne — stejná disciplína jako
-- pripojit_prilohu: právo na běh, zapnutý modul, položka patří šabloně
-- toho běhu, cesta sedí s během/položkou/firmou, soubor v úložišti
-- opravdu je, rozumný počet fotek na položku.
-- ---------------------------------------------------------------------

create or replace function public.pripojit_checklist_fotku(
  p_run      uuid,
  p_item     uuid,
  p_cesta    text,
  p_nazev    text,
  p_mime     text,
  p_velikost integer
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_branch   uuid;
  v_sablona  uuid;
  v_status   text;
  v_cesta_t  uuid;
  v_cesta_r  uuid;
  v_cesta_i  uuid;
  v_nazev    text;
  v_id       uuid;
begin
  select r.tenant_id, r.branch_id, r.template_id, r.status
    into v_tenant, v_branch, v_sablona, v_status
    from public.checklist_runs r
   where r.id = p_run;

  if v_tenant is null or not app.has_access(v_tenant, 'tasks.read', v_branch) then
    raise exception 'K tomuhle checklistu nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Hotový běh je historie — fotka se do něj dodatečně nepřidává.
  if v_status <> 'open' then
    raise exception 'Uzavřený checklist už nejde měnit.'
      using errcode = 'check_violation';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
       select 1 from public.checklist_items i
        where i.id = p_item and i.template_id = v_sablona
     ) then
    raise exception 'Ta položka k tomuhle checklistu nepatří.'
      using errcode = 'check_violation';
  end if;

  select c.tenant_id, c.run_id, c.item_id
    into v_cesta_t, v_cesta_r, v_cesta_i
    from app.checklist_fotka_cesta_rozsah(p_cesta) c;

  if v_cesta_t is distinct from v_tenant
     or v_cesta_r is distinct from p_run
     or v_cesta_i is distinct from p_item then
    raise exception 'Cesta k fotce nesedí s touhle položkou.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'checklist-fotky' and o.name = p_cesta
  ) then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;

  -- Strop je na položku V TOMHLE BĚHU — ne napříč všemi běhy šablony
  -- (to by po šesti dnech fotit u položky znemožnilo úplně).
  if (select count(*) from public.checklist_polozka_fotky p
       where p.run_id = p_run and p.item_id = p_item) >= 6 then
    raise exception 'K téhle položce lze připojit nejvýš 6 fotek.'
      using errcode = 'check_violation';
  end if;

  v_nazev := btrim(translate(coalesce(p_nazev, ''), '/' || chr(92), '__'));
  if v_nazev = '' then
    v_nazev := 'fotka';
  end if;

  insert into public.checklist_polozka_fotky
    (tenant_id, run_id, item_id, cesta, nazev, mime, velikost, employee_id)
  values
    (v_tenant, p_run, p_item, p_cesta, left(v_nazev, 120), p_mime, p_velikost,
     app.muj_employee(v_tenant))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.pripojit_checklist_fotku(uuid, uuid, text, text, text, integer) is
  'Jediná cesta, kterou vznikne fotka položky checklistu: přístup k běhu, '
  'položka patří jeho šabloně, soubor je v úložišti, cesta patří tomu '
  'běhu a položce, nejvýš 6 fotek na položku.';

revoke all on function public.pripojit_checklist_fotku(uuid, uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.pripojit_checklist_fotku(uuid, uuid, text, text, text, integer)
  to authenticated;
