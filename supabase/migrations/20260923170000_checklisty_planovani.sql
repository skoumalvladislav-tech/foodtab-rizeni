-- Checklisty 2.0, vrstva B krok 6 — plánování běhů a termínů.
--
-- Zadání bod 15 řekl to přímo: „Nevytvářej ručně stejný checklist
-- každý den." Dosud se každý běh (i denní otevírací/zavírací) zakládal
-- jen ručně tlačítkem „Spustit". Tahle migrace přidává dvě volané z
-- cronu (GitHub Actions, vzor zapomenuty-odchod.yml — Vercel Cron na
-- Hobby tarifu hodinový běh odmítá):
--
--   * vytvorit_naplanovane_checklisty — založí chybějící běhy pro
--     schedule in (daily, opening, closing, haccp, weekly,
--     selected_days), idempotentně (stejný upsert jako spustitChecklist).
--   * ohlasit_checklisty_terminy — DUE_SOON/OVERDUE, přes app.notifikovat.
--
-- `every_shift`/`manual` se PŘESKAKUJÍ — rozhodnutí Šéfíka 23. 9., viz
-- hlavičku 20260923120000_checklisty_schema_zaklad.sql. Schéma je
-- připravené, automatika ne.
-- ROZHODNOUT: odkud brát úsek směny (docs/hlaseni/otazky.md, otázka 11).
--
-- `weekly`/`selected_days` bez vyplněných dny_v_tydnu se taky
-- přeskakují — prázdné pole není „každý den", je to „ještě nenastaveno".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. VYTVORIT_NAPLANOVANE_CHECKLISTY
--
-- Žádný p_tenant — cron prochází všechny firmy najednou, stejně jako
-- ohlasit_zapomenute_odchody. branch_id is null u šablony (firemní) se
-- rozvětví na všechny aktivní pobočky té firmy.
-- ---------------------------------------------------------------------

create or replace function public.vytvorit_naplanovane_checklisty()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pocet integer := 0;
  v_rec   record;
  v_den   date;
  v_dow   smallint;
begin
  for v_rec in
    select t.id as sablona_id, t.tenant_id, t.schedule, t.dny_v_tydnu,
           b.id as branch_id
      from public.checklist_templates t
      join public.branches b
        on b.tenant_id = t.tenant_id
       and b.active
       and (t.branch_id is null or t.branch_id = b.id)
     where t.active
       and t.schedule in ('daily', 'opening', 'closing', 'haccp', 'weekly', 'selected_days')
  loop
    v_den := app.business_date(v_rec.branch_id, now());
    if v_den is null then
      continue;
    end if;

    if v_rec.schedule in ('weekly', 'selected_days') then
      v_dow := extract(dow from v_den)::smallint;
      if v_rec.dny_v_tydnu = '{}' or not (v_dow = any (v_rec.dny_v_tydnu)) then
        continue;
      end if;
    end if;

    insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
    values (v_rec.tenant_id, v_rec.branch_id, v_rec.sablona_id, v_den)
    on conflict (template_id, branch_id, business_date) do nothing;

    if found then
      v_pocet := v_pocet + 1;
    end if;
  end loop;

  return v_pocet;
end;
$$;

comment on function public.vytvorit_naplanovane_checklisty() is
  'Založí chybějící běhy podle rozvrhu šablony pro aktuální provozní '
  'den každé pobočky. Idempotentní (on conflict do nothing). '
  'every_shift/manual a weekly/selected_days bez dny_v_tydnu se přeskakují.';

revoke all on function public.vytvorit_naplanovane_checklisty() from public, anon, authenticated;
grant execute on function public.vytvorit_naplanovane_checklisty() to service_role;


-- ---------------------------------------------------------------------
-- 2. TERMÍNY — idempotence a hlídač
-- ---------------------------------------------------------------------

create table public.checklist_terminy_ohlaseno (
  run_id uuid not null references public.checklist_runs(id) on delete cascade,
  druh   text not null check (druh in ('blizi', 'po')),
  primary key (run_id, druh)
);

comment on table public.checklist_terminy_ohlaseno is
  'Idempotence pro ohlasit_checklisty_terminy — každý termín (blízko/po) '
  'se ohlásí jen jednou za běh, stejná disciplína jako zapomenute_odchody.';

alter table public.checklist_terminy_ohlaseno enable row level security;
-- Žádná politika: čte/píše jen service_role přes definer funkci níž.

revoke all on public.checklist_terminy_ohlaseno from anon, authenticated;
grant select, insert on public.checklist_terminy_ohlaseno to service_role;

create or replace function public.ohlasit_checklisty_terminy()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pocet integer := 0;
  v_rec   record;
  v_user  uuid;
begin
  for v_rec in
    select r.id, r.tenant_id, r.branch_id, r.assigned_employee_id
      from public.checklist_runs r
     where r.status = 'open'
       and r.due_at is not null
       and r.due_at > now()
       and r.due_at <= now() + interval '1 hour'
       and not exists (
         select 1 from public.checklist_terminy_ohlaseno o
          where o.run_id = r.id and o.druh = 'blizi')
  loop
    insert into public.checklist_terminy_ohlaseno (run_id, druh) values (v_rec.id, 'blizi');

    if v_rec.assigned_employee_id is not null then
      select e.user_id into v_user from public.employees e where e.id = v_rec.assigned_employee_id;
      if v_user is not null then
        perform app.notifikovat(
          v_rec.tenant_id, v_user, 'checklist.blizi_se_termin',
          app.checklist_telo(v_rec.id), 'normal', v_rec.branch_id, null,
          'checklist_run', v_rec.id, 'checklist.blizi_se_termin:' || v_rec.id::text
        );
      end if;
    end if;
    v_pocet := v_pocet + 1;
  end loop;

  for v_rec in
    select r.id, r.tenant_id, r.branch_id, r.assigned_employee_id
      from public.checklist_runs r
     where r.status = 'open'
       and r.due_at is not null
       and r.due_at <= now()
       and not exists (
         select 1 from public.checklist_terminy_ohlaseno o
          where o.run_id = r.id and o.druh = 'po')
  loop
    insert into public.checklist_terminy_ohlaseno (run_id, druh) values (v_rec.id, 'po');

    if v_rec.assigned_employee_id is not null then
      select e.user_id into v_user from public.employees e where e.id = v_rec.assigned_employee_id;
      if v_user is not null then
        perform app.notifikovat(
          v_rec.tenant_id, v_user, 'checklist.po_terminu',
          app.checklist_telo(v_rec.id), 'important', v_rec.branch_id, null,
          'checklist_run', v_rec.id, 'checklist.po_terminu:' || v_rec.id::text
        );
      end if;
    end if;
    v_pocet := v_pocet + 1;
  end loop;

  return v_pocet;
end;
$$;

comment on function public.ohlasit_checklisty_terminy() is
  'DUE_SOON (do hodiny) a OVERDUE (po termínu) pro otevřené běhy s '
  'přiřazenou osobou. Jednou za běh a druh (checklist_terminy_ohlaseno). '
  'Volá app.notifikovat, ne přímý insert — jde o nový kód, ne o starší '
  'vzor předcházející centralizaci.';

revoke all on function public.ohlasit_checklisty_terminy() from public, anon, authenticated;
grant execute on function public.ohlasit_checklisty_terminy() to service_role;
