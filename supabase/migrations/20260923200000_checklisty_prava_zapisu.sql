-- =====================================================================
-- Checklisty 2.0 — přímý zápis do běhů a záznamů jen tam, kde ho
-- aplikace opravdu potřebuje
-- =====================================================================
--
-- PROČ: ověření ostré databáze po nasazení 23. 9. ukázalo, že pravidla
-- z 20260923160000 (neměnnost uzavřeného běhu, meze a položky z verze
-- běhu, důvod u „nelze splnit", povinné položky, dvojí kontrola, zákaz
-- sebepotvrzení) drží jen RPC s právy vlastníka. Tabulkové granty
-- z 23. 8. přitom dál pouštěly každého přihlášeného s tasks.read psát
-- do checklist_runs a checklist_entries napřímo (PostgREST POST/PATCH/
-- DELETE) — a tím RPC obejít: přepsat HACCP záznam uzavřeného běhu,
-- zapsat teplotu mimo meze, označit běh jako potvrzený, podvrhnout
-- „kdo dokončil / kdo zahájil". Zadání bod 41: „UI hiding nestačí."
--
-- CO KLIENTOVI ZŮSTÁVÁ — jediné přímé zápisy aplikace:
--   * založení běhu (spustitChecklist, upsert s on conflict do nothing):
--     tenant_id, branch_id, template_id, business_date,
--     assigned_employee_id, due_at, shift_label, started_by
--   * odpovědnost (nastavitOdpovednost): assigned_employee_id, due_at,
--     shift_label — jen vedoucí a jen u otevřeného běhu (spoušť níž).
-- Všechno ostatní jde přes funkce s právy vlastníka:
-- zapsat_polozku_checklistu, uzavrit_checklist, potvrdit_checklist,
-- vytvorit_naplanovane_checklisty. Ty grant nepotřebují.
--
-- DELETE se odebírá úplně. Aplikace nic nemaže a smazaný řádek by přes
-- Realtime odešel všem odběratelům tabulky (DELETE Realtime přes RLS
-- nefiltruje). Invariant z 20260923150000 tím drží databáze, ne dohoda.
--
-- Sloupcové granty PGlite neověří — rozhoduje workflow Databáze
-- (krok54_scenar kontroluje katalog i skutečné zápisy).

-- ---------------------------------------------------------------------
-- 1. checklist_entries — zápis jen přes zapsat_polozku_checklistu
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.checklist_entries from authenticated;


-- ---------------------------------------------------------------------
-- 2. checklist_runs — jen založení a odpovědnost
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.checklist_runs from authenticated;

grant insert (tenant_id, branch_id, template_id, business_date,
              assigned_employee_id, due_at, shift_label, started_by)
  on public.checklist_runs to authenticated;

grant update (assigned_employee_id, due_at, shift_label)
  on public.checklist_runs to authenticated;


-- ---------------------------------------------------------------------
-- 3. Spoušť pro přímý zápis klienta
-- ---------------------------------------------------------------------
--
-- Security INVOKER schválně: current_user je tu 'authenticated' jen při
-- přímém zápisu přes PostgREST. Uvnitř RPC s právy vlastníka je
-- current_user vlastník funkce a spoušť nic nedělá — uzavření, potvrzení
-- i plánovač tak jdou dál po svých pravidlech.
--
-- Co granty samy neumí:
--   * started_by — kdo běh zahájil, se bere ze session, ne z těla
--     požadavku (jinak by šlo „zahájit" za kolegu),
--   * šablona musí patřit ke stejné firmě a pobočce a být aktivní,
--   * odpovědnost u uzavřeného běhu se nemění — je to záznam,
--   * odpovědnost mění jen vedoucí (tasks.manage) — politika
--     checklist_runs_write pouští zápis už s tasks.read.

create or replace function app.checklist_run_zapis_klienta_trg()
returns trigger
language plpgsql volatile security invoker set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.checklist_templates t
       where t.id = new.template_id
         and t.tenant_id = new.tenant_id
         and (t.branch_id is null or t.branch_id = new.branch_id)
         and t.active
    ) then
      raise exception 'Tahle šablona na téhle pobočce neběží.'
        using errcode = 'check_violation';
    end if;

    new.started_by := app.muj_employee(new.tenant_id);
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'Uzavřený checklist už nejde měnit.'
      using errcode = 'check_violation';
  end if;

  -- Přidělit / přeplánovat je úkon vedoucího. Obrazovka tlačítko jinému
  -- neukáže, ale to nestačí (bod 41) — serverová akce jde zavolat i bez něj.
  if not app.has_access(new.tenant_id, 'tasks.manage', new.branch_id) then
    raise exception 'Odpovědnost u checklistu mění jen vedoucí.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function app.checklist_run_zapis_klienta_trg() is
  'Přímý zápis přihlášeného do checklist_runs: started_by ze session, '
  'šablona z téže firmy/pobočky a aktivní, uzavřený běh se nemění, '
  'odpovědnost mění jen tasks.manage. '
  'RPC s právy vlastníka (current_user <> authenticated) propouští.';

revoke all on function app.checklist_run_zapis_klienta_trg() from public, anon, authenticated;

drop trigger if exists trg_checklist_run_zapis_klienta on public.checklist_runs;
create trigger trg_checklist_run_zapis_klienta
  before insert or update on public.checklist_runs
  for each row execute function app.checklist_run_zapis_klienta_trg();


-- ---------------------------------------------------------------------
-- 4. Triggerové funkce bez revoke (nález ověření, drobné)
-- ---------------------------------------------------------------------
-- Přímo zavolat nejdou (vrací trigger), ale ať katalog neříká, že je
-- smí spouštět kdokoli.

revoke all on function app.checklist_run_prirazeny_trg() from public, anon, authenticated;
revoke all on function app.checklist_sablona_verze_je_nemenna() from public, anon, authenticated;
