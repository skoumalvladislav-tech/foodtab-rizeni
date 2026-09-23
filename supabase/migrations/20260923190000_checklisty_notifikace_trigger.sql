-- Checklisty 2.0, vrstva B krok 8 — notifikace „checklist přidělen".
--
-- Trigger na checklist_runs (ne volání z akce.ts) pokrývá OBĚ cesty,
-- kterými assigned_employee_id vzniká/mění se — spustitChecklist
-- (upsert) i nastavitOdpovednost (update) — jedním místem, stejná
-- úvaha jako upozornit_na_ukol_trg na tasks.
--
-- checklist.dokonceno a checklist.vyzaduje_kontrolu vznikají přímo v
-- RPC uzavrit_checklist (20260923160000_checklisty_rpc.sql) — ta má
-- kontext (výsledný stav, kdo zavřel), který by trigger musel znovu
-- dopočítávat. checklist.problem_nahlasen se neřeší vůbec — jde přes
-- existující upozornit_na_ukol_trg na tasks (checklist_run_id vyplněné
-- při vzniku úkolu z checklistu), viz 20260923130000, oddíl 3.
-- =====================================================================

create or replace function app.upozornit_na_checklist_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  select e.user_id into v_user
    from public.employees e
   where e.id = new.assigned_employee_id;

  -- Kdo si checklist přidělil sám, upozornění sám sobě nedostane (stejně
  -- jako zadavatel úkolu v upozornit_na_ukol_trg). Z cronu (bez
  -- přihlášeného) je auth.uid() prázdné a upozornění jde.
  if v_user is null or v_user is not distinct from (select auth.uid()) then
    return new;
  end if;

  perform app.notifikovat(
    new.tenant_id,
    v_user,
    'checklist.prideleno',
    app.checklist_telo(new.id),
    'normal',
    new.branch_id,
    null,
    'checklist_run',
    new.id,
    'checklist.prideleno:' || new.id::text
  );

  return new;
end $$;

comment on function app.upozornit_na_checklist_trg() is
  'Pokrývá obě cesty vzniku přiřazení (spustitChecklist upsert i '
  'nastavitOdpovednost update) jedním triggerem — nemusí se to '
  'pamatovat u každé zvlášť.';

revoke all on function app.upozornit_na_checklist_trg() from public, anon, authenticated;

drop trigger if exists trg_upozornit_na_checklist on public.checklist_runs;
create trigger trg_upozornit_na_checklist
  after insert or update of assigned_employee_id on public.checklist_runs
  for each row execute function app.upozornit_na_checklist_trg();
