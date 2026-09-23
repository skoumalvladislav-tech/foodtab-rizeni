-- Checklisty 2.0, vrstva B krok 1 — aditivní sloupce pro provozní hloubku.
--
-- Navazuje na 20260923110000_checklisty_mockup.sql. Tahle migrace jen
-- PŘIDÁVÁ sloupce a rozšiřuje CHECK omezení — žádné RPC, žádná logika.
-- Ta jde do 20260923160000_checklisty_rpc.sql, protože potřebuje
-- i tabulku verzí z 20260923140000_checklisty_verzovani.sql.
--
-- ---------------------------------------------------------------------
-- SCHEDULE DOSTÁVÁ SKUTEČNÝ CHECK
--
-- `checklist_templates.schedule` byl od 23. 8. `text not null default
-- 'opening'` BEZ databázového omezení — validoval jen whitelist v
-- app/[rozsah]/ukoly/akce.ts (ROZVRHY). Zadání teď přidává `daily`,
-- `selected_days`, `every_shift`, `manual` — je to vhodná chvíle přidat
-- omezení rovnou v databázi, ne zase jen v kódu.
--
-- `every_shift` je PLATNÁ HODNOTA (jde vybrat v editoru šablon), ale
-- plánovací RPC (krok 20260923170000) ji schválně přeskakuje — žádná
-- tabulka směn dnes nemá vazbu na úsek/tým, takže automatické
-- zakládání/přiřazení by bylo hádání. Rozhodnutí Šéfíka 23. 9.: zatím
-- bez automatiky, schéma připravené.
--
-- ---------------------------------------------------------------------
-- COMPLETED_WITH_ISSUES A NELZE_SPLNIT
--
-- `checked` zůstává (na něm stojí dnešní progress bar a filtry), přidává
-- se k němu `nelze_splnit` jako VZÁJEMNĚ VYLUČUJÍCÍ stav — položka je
-- buď splněná, nebo označená jako nesplnitelná, nikdy obojí. Běh, který
-- obsahuje nesplnitelnou položku nebo hodnotu mimo meze, uzavírá nová
-- RPC uzavrit_checklist (krok rpc) jako 'completed_with_issues', ne
-- 'done' — odlišuje se to viditelně, ne jen v poznámce.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. checklist_templates
-- ---------------------------------------------------------------------

alter table public.checklist_templates
  add constraint checklist_templates_schedule_check
  check (schedule in ('opening', 'closing', 'haccp', 'weekly',
                       'daily', 'selected_days', 'every_shift', 'manual'));

alter table public.checklist_templates
  add column dny_v_tydnu smallint[] not null default '{}',
  add column vyzaduje_potvrzeni boolean not null default false;

alter table public.checklist_templates
  add constraint checklist_templates_dny_v_tydnu_check
  check (dny_v_tydnu <@ array[0,1,2,3,4,5,6]::smallint[]);

comment on column public.checklist_templates.dny_v_tydnu is
  'Dny v týdnu (0=neděle..6=sobota), kdy se šablona zakládá — jen u '
  'schedule=weekly/selected_days. Prázdné pole u ostatních rozvrhů.';
comment on column public.checklist_templates.vyzaduje_potvrzeni is
  'Dokončený běh čeká na manažerské potvrzení (public.potvrdit_checklist), '
  'než zmizí z „vyžaduje pozornost".';


-- ---------------------------------------------------------------------
-- 2. checklist_items
-- ---------------------------------------------------------------------

alter table public.checklist_items
  add column section text,
  add column active  boolean not null default true,
  add column povinna boolean not null default true;

comment on column public.checklist_items.povinna is
  'Povinná položka (výchozí): běh nejde uzavřít, dokud není splněná, nebo '
  'označená „nelze splnit" s důvodem (uzavrit_checklist). Nepovinná '
  'uzavření neblokuje. NENÍ to requires_value — ten říká, jestli položka '
  'chce hodnotu (číslo/text/fotku), ne jestli je povinná.';

comment on column public.checklist_items.section is
  'Volitelné textové seskupení pro zobrazení ("Chladicí zařízení"). '
  'NULL/prázdné = bez sekce. Žádná vlastní tabulka — je to jen štítek.';
comment on column public.checklist_items.active is
  'Vyřazená položka (ne smazaná — checklist_entries na ni odkazuje '
  'on delete restrict) se nenabízí v nových bězích, historie ji drží.';


-- ---------------------------------------------------------------------
-- 3. checklist_entries
-- ---------------------------------------------------------------------

alter table public.checklist_entries
  add column nelze_splnit       boolean not null default false,
  add column nelze_splnit_duvod text    not null default '',
  add column verze              integer not null default 1;

alter table public.checklist_entries
  add constraint checklist_entries_stav_check
  check (not (checked and nelze_splnit));

comment on column public.checklist_entries.nelze_splnit is
  'Položka označená jako nesplnitelná ("Zámek je poškozený.") místo '
  'prostě nezaškrtnutá — vzájemně se vylučuje s checked.';
comment on column public.checklist_entries.verze is
  'Optimistická zámek proti přepsání: zapsat_polozku_checklistu (krok '
  'rpc) porovná očekávanou verzi, než zapíše. Souběžný druhý zápis '
  'dostane čitelnou chybu místo tichého přepsání.';


-- ---------------------------------------------------------------------
-- 4. checklist_runs
-- ---------------------------------------------------------------------

alter table public.checklist_runs
  drop constraint checklist_runs_status_check;

alter table public.checklist_runs
  add constraint checklist_runs_status_check
  check (status in ('open', 'done', 'completed_with_issues'));

alter table public.checklist_runs
  add column potvrdil_kym  uuid references public.employees(id) on delete set null,
  add column potvrzeno_kdy timestamptz;

comment on column public.checklist_runs.potvrdil_kym is
  'Kdo běh manažersky potvrdil (public.potvrdit_checklist) — NIKDY '
  'stejná osoba jako completed_by (viz ta funkce). NULL = nepotvrzeno.';

-- Stejná druhá linie jako u assigned_employee_id/completed_by/started_by.
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

  if new.potvrdil_kym is not null
     and (tg_op = 'INSERT'
          or new.potvrdil_kym is distinct from old.potvrdil_kym) then
    select exists (
      select 1 from public.employees e
       where e.id = new.potvrdil_kym
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
  'firmu přiřazeného/dokončivšího/spustivšího/potvrdivšího). Bez tohohle '
  'by šlo zapsat cizího zaměstnance.';

drop trigger if exists trg_checklist_run_prirazeny on public.checklist_runs;
create trigger trg_checklist_run_prirazeny
  before insert or update of assigned_employee_id, completed_by, started_by, potvrdil_kym
  on public.checklist_runs
  for each row execute function app.checklist_run_prirazeny_trg();
