-- Checklisty 2.0, krok 1 — lehká odpovědnost na běhu checklistu.
--
-- Zadání Šéfíka 23. 9. (52 bodů, mockup). Tahle migrace řeší jen tu
-- jednu věc z celého zadání, která si vynucuje databázovou změnu:
-- karta „Odpovědný … do HH:MM" v mockupu nejde vyplnit poctivě, protože
-- dnes se nikde neeviduje, KDO checklist dělá a DO KDY. Zbytek zadání
-- (vzhled, filtry, historie, záložka „Moje") jsou jen čtecí dotazy nad
-- existujícím modelem a novou migraci nepotřebují — viz
-- docs/checklisty-2-0-audit-a-plan.md.
--
-- ---------------------------------------------------------------------
-- NEPOVINNÉ, NE POŽADOVANÉ
--
-- `assigned_employee_id` a `due_at` jsou `null`-em. Checklist se dal
-- spustit a vyplnit bez odpovědné osoby už rok — vynutit to teď by
-- rozbilo existující tok (spustitChecklist) a přidalo krok, který
-- zadání nežádá jako povinný. „Bez přiřazení" je platný stav, ne chyba.
--
-- ---------------------------------------------------------------------
-- DRUHÁ LINIE PRO assigned_employee_id
--
-- Sloupec se plní ze serverové akce (spustitChecklist / budoucí úprava
-- odpovědnosti), ale je to obyčejný update přes klienta Supabase, ne
-- RPC s vlastním ověřením — RLS na checklist_runs (tasks.read na
-- pobočce běhu) dovolí zapsat JAKÉKOLI uuid do assigned_employee_id,
-- klidně zaměstnance jiné firmy. To by nebyl únik dat (řádek zůstává
-- vidět jen v rámci vlastního tenantu), ale bylo by to ticho rozbité
-- propojení — karta by ukazovala "kdosi" nebo prázdno u cizího uuid.
-- Trigger dole to hlídá stejně, jako to dělá tasks_vazba_checklistu_trg
-- u vazby úkol→checklist.

alter table public.checklist_runs
  add column assigned_employee_id uuid references public.employees(id) on delete set null,
  add column due_at timestamptz,
  -- „Kdo dokončil" chybělo úplně (jen `finished_at` = kdy). Bez tohohle
  -- by historie musela hádat z posledního zápisu v checklist_entries —
  -- skoro vždycky ta samá osoba, ale „skoro" není důvod tvářit se, že
  -- je to totéž. Nastavuje ho uzavritChecklist ze serverové session,
  -- stejně jako checklist_entries.employee_id u jednotlivé položky.
  add column completed_by uuid references public.employees(id) on delete set null;

comment on column public.checklist_runs.assigned_employee_id is
  'Kdo checklist dělá — nepovinné, nastavuje se při spuštění nebo později. '
  'NULL je platný stav ("nikomu konkrétnímu").';
comment on column public.checklist_runs.due_at is
  'Do kdy má být běh hotový — nepovinné. Řídí stav „po termínu" v UI, '
  'databáze samotná termín nijak nevynucuje.';
comment on column public.checklist_runs.completed_by is
  'Kdo běh uzavřel (uzavritChecklist) — server-side, ne z formuláře. '
  'NULL u běhů uzavřených před touhle migrací i u nedokončených.';

create or replace function app.checklist_run_prirazeny_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ok boolean;
begin
  -- Obě pole hlídá stejná kontrola (musí patřit stejné firmě jako běh),
  -- takže jeden trigger stačí na obě — zvlášť se řeší jen KTERÉ z nich
  -- se touhle operací vůbec mění.
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

  return new;
end $$;

comment on function app.checklist_run_prirazeny_trg() is
  'Druhá linie k RLS na checklist_runs (ta hlídá jen pobočku běhu, ne '
  'firmu přiřazeného ani dokončivšího člověka). Bez tohohle by šlo '
  'zapsat cizího zaměstnance — žádný únik dat, ale ticho rozbité propojení.';

drop trigger if exists trg_checklist_run_prirazeny on public.checklist_runs;
create trigger trg_checklist_run_prirazeny
  before insert or update of assigned_employee_id, completed_by on public.checklist_runs
  for each row execute function app.checklist_run_prirazeny_trg();
