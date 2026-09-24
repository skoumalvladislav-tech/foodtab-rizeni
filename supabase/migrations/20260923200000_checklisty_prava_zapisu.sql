-- =====================================================================
-- Checklisty 2.0 — přímý zápis do běhů a záznamů jen tam, kde ho
-- aplikace opravdu potřebuje; odpovědnost přes RPC s převodem času
-- =====================================================================
--
-- PROČ (ověření ostré databáze po nasazení 23. 9.):
--
-- 1) Pravidla z 20260923160000 (neměnnost uzavřeného běhu, meze a položky
--    z verze běhu, důvod u „nelze splnit", povinné položky, dvojí kontrola,
--    zákaz sebepotvrzení) drží jen RPC s právy vlastníka. Tabulkové granty
--    z 23. 8. přitom dál pouštěly každého přihlášeného s tasks.read psát
--    do checklist_runs a checklist_entries napřímo (PostgREST POST/PATCH/
--    DELETE) — a tím RPC obejít: přepsat HACCP záznam uzavřeného běhu,
--    zapsat teplotu mimo meze, označit běh jako potvrzený, podvrhnout
--    „kdo dokončil / kdo zahájil". Zadání bod 41: „UI hiding nestačí."
--
-- 2) Termín (due_at) se ukládal posunutý: formulář posílá hodinu na zdi
--    („2026-09-23T14:00", bez pásma) přímo do sloupce timestamptz, relace
--    PostgRESTu běží v UTC — uložilo se 14:00 UTC = 16:00 v Praze a každé
--    další uložení formuláře termín posunulo znovu. Pravidlo 11 (CLAUDE.md):
--    převod dělá databáze přes `at time zone` v pásmu pobočky — stejně
--    jako zadat_ukol.
--
-- CO KLIENTOVI ZŮSTÁVÁ NAPŘÍMO: jen založení běhu (spustitChecklist,
-- upsert s on conflict do nothing) — tenant_id, branch_id, template_id,
-- business_date. „Kdo zahájil" doplní spoušť ze session.
-- Odpovědnost (komu / do kdy / směna): public.nastavit_odpovednost_checklistu.
-- Záznamy, uzavření, potvrzení: RPC z 20260923160000. Plánovač: definer.
--
-- DELETE se odebírá úplně. Aplikace nic nemaže a smazaný řádek by přes
-- Realtime odešel všem odběratelům tabulky (DELETE Realtime přes RLS
-- nefiltruje). Invariant z 20260923150000 tím drží databáze, ne dohoda.
--
-- Pořadí nasazení: kód jde na Vercel se sloučením dřív než db push.
-- Nový kód posílá při založení jen čtyři sloupce (starým širokým grantům
-- to nevadí) a úprava odpovědnosti do nasazení řekne „bude dostupná po
-- nasazení databáze". Nic se nerozbije ani v mezičase.
--
-- Sloupcové granty PGlite neověří — rozhoduje workflow Databáze
-- (krok54_scenar kontroluje katalog i skutečné zápisy).

-- ---------------------------------------------------------------------
-- 1. Odpovědnost — RPC s převodem hodiny na zdi v pásmu pobočky
-- ---------------------------------------------------------------------

create or replace function public.nastavit_odpovednost_checklistu(
  p_tenant uuid,
  p_run    uuid,
  p_komu   uuid,
  p_do_kdy timestamp without time zone,
  p_smena  text default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_status text;
begin
  select r.branch_id, r.status
    into v_branch, v_status
    from public.checklist_runs r
   where r.id = p_run and r.tenant_id = p_tenant;

  -- Přidělit / přeplánovat je úkon vedoucího. Obrazovka tlačítko jinému
  -- neukáže, ale to nestačí (bod 41).
  if v_branch is null or not app.has_access(p_tenant, 'tasks.manage', v_branch) then
    raise exception 'Odpovědnost u checklistu mění jen vedoucí.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'open' then
    raise exception 'Uzavřený checklist už nejde měnit.'
      using errcode = 'check_violation';
  end if;

  -- Cizího člověka odmítne trg_checklist_run_prirazeny (42501).
  update public.checklist_runs
     set assigned_employee_id = p_komu,
         due_at = case when p_do_kdy is null then null
                       else p_do_kdy at time zone app.zona_pobocky(v_branch) end,
         shift_label = coalesce(left(btrim(p_smena), 120), shift_label)
   where id = p_run;
end;
$$;

comment on function public.nastavit_odpovednost_checklistu(uuid, uuid, uuid, timestamp, text) is
  'Komu / do kdy / směna u otevřeného běhu. Jen tasks.manage. p_do_kdy je '
  'hodina na zdi (bez pásma) — okamžik z ní dělá databáze v pásmu pobočky '
  '(pravidlo 11). p_smena NULL = beze změny, prázdná = smazat.';

revoke all on function public.nastavit_odpovednost_checklistu(uuid, uuid, uuid, timestamp, text) from public, anon;
grant execute on function public.nastavit_odpovednost_checklistu(uuid, uuid, uuid, timestamp, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. checklist_entries — zápis jen přes zapsat_polozku_checklistu
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.checklist_entries from authenticated;


-- ---------------------------------------------------------------------
-- 3. checklist_runs — napřímo jen založení
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.checklist_runs from authenticated;

grant insert (tenant_id, branch_id, template_id, business_date)
  on public.checklist_runs to authenticated;


-- ---------------------------------------------------------------------
-- 4. Spoušť pro založení běhu klientem
-- ---------------------------------------------------------------------
--
-- Security INVOKER schválně: šablona se čte s právy toho, kdo zakládá
-- (co nevidí, nespustí), a current_user je 'authenticated' jen při
-- přímém zápisu přes PostgREST. Plánovač (definer) a systémové zápisy
-- jdou dál po svém — plánovač šablony vybírá sám (firma, pobočka,
-- aktivní) a started_by nevyplňuje.

create or replace function app.checklist_run_zalozeni_klientem_trg()
returns trigger
language plpgsql volatile security invoker set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

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

  -- „Kdo zahájil" ze session, ne z těla požadavku.
  new.started_by := app.muj_employee(new.tenant_id);
  return new;
end $$;

comment on function app.checklist_run_zalozeni_klientem_trg() is
  'Založení běhu přihlášeným: šablona z téže firmy/pobočky a aktivní, '
  'started_by ze session. Zápisy mimo roli authenticated propouští.';

revoke all on function app.checklist_run_zalozeni_klientem_trg() from public, anon, authenticated;

drop trigger if exists trg_checklist_run_zalozeni_klientem on public.checklist_runs;
create trigger trg_checklist_run_zalozeni_klientem
  before insert on public.checklist_runs
  for each row execute function app.checklist_run_zalozeni_klientem_trg();


-- ---------------------------------------------------------------------
-- 5. Triggerové funkce bez revoke (nález ověření, drobné)
-- ---------------------------------------------------------------------
-- Přímo zavolat nejdou (vrací trigger), ale ať katalog neříká, že je
-- smí spouštět kdokoli.

revoke all on function app.checklist_run_prirazeny_trg() from public, anon, authenticated;
revoke all on function app.checklist_sablona_verze_je_nemenna() from public, anon, authenticated;
