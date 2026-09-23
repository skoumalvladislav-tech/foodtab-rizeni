-- Checklisty 2.0, vrstva B krok 7 — audit log.
--
-- checklist_templates/items/runs/entries dosud nebyly mezi tabulkami s
-- auditní spouští — přímé odškrtnutí položky i přiřazení odpovědnosti
-- (dnešní .update()/.upsert() z akce.ts) nemělo žádnou stopu.
--
-- ---------------------------------------------------------------------
-- PROČ DVĚ SPOUŠTĚ, NE JEDNA
--
-- app.audit_zmenu (20260831020000_audit_lidi_a_roli.sql) bere firmu ze
-- sloupce `tenant_id` řádku (nebo přes `role_id`). checklist_items
-- a checklist_entries `tenant_id` NEMAJÍ — visí na šabloně / běhu. Na
-- nich by app.audit_zmenu firmu nenašla a TIŠE by skončila bez zápisu:
-- spoušť by existovala, kontrola „trigger je na tabulce" by prošla,
-- a audit by byl přesto prázdný.
--
-- Sdílená funkce se kvůli tomu NEMĚNÍ — visí na ní 40 tabulek a každá
-- větev navíc je riziko pro všechny. Pro dvě „potomkovské" tabulky je
-- tu vlastní app.audit_checklist_potomek: firmu a pobočku dohledá přes
-- rodiče (šablona / běh), zbytek (jen změněné sloupce, prázdná změna se
-- nepíše) dělá stejně jako app.audit_zmenu.
--
-- checklist_entries má vysokou frekvenci zápisu (každé zaškrtnutí);
-- update beze změny se nepíše vůbec, takže objem zůstává rozumný.
-- =====================================================================

drop trigger if exists trg_audit_checklist_templates on public.checklist_templates;
create trigger trg_audit_checklist_templates
  after insert or update or delete on public.checklist_templates
  for each row execute function app.audit_zmenu('checklist_template');

drop trigger if exists trg_audit_checklist_runs on public.checklist_runs;
create trigger trg_audit_checklist_runs
  after insert or update or delete on public.checklist_runs
  for each row execute function app.audit_zmenu('checklist_run');

drop trigger if exists trg_audit_checklist_sablona_verze on public.checklist_sablona_verze;
create trigger trg_audit_checklist_sablona_verze
  after insert or update or delete on public.checklist_sablona_verze
  for each row execute function app.audit_zmenu('checklist_sablona_verze');


create or replace function app.audit_checklist_potomek()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_radek  jsonb := to_jsonb(coalesce(new, old));
  v_stary  jsonb := case when old is null then null else to_jsonb(old) end;
  v_tenant uuid;
  v_branch uuid;
  v_entita text := tg_argv[0];
  v_pred   jsonb;
  v_po     jsonb;
begin
  -- Položka běhu (checklist_entries) visí na běhu, položka šablony
  -- (checklist_items) na šabloně.
  if v_radek ? 'run_id' then
    select r.tenant_id, r.branch_id into v_tenant, v_branch
      from public.checklist_runs r where r.id = (v_radek ->> 'run_id')::uuid;
  elsif v_radek ? 'template_id' then
    select t.tenant_id, t.branch_id into v_tenant, v_branch
      from public.checklist_templates t where t.id = (v_radek ->> 'template_id')::uuid;
  end if;

  -- Rodič už neexistuje (kaskádové mazání šablony/běhu/firmy): audit se
  -- píše u rodiče, tady by spadl na cizím klíči k firmě.
  if v_tenant is null or not exists (
    select 1 from public.tenants t where t.id = v_tenant
  ) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(s.key, s.value) into v_pred
      from jsonb_each(v_stary) s
     where to_jsonb(new) -> s.key is distinct from s.value;

    if v_pred is null then
      return null;
    end if;

    select jsonb_object_agg(n.key, n.value) into v_po
      from jsonb_each(to_jsonb(new)) n
     where v_stary -> n.key is distinct from n.value;
  elsif tg_op = 'INSERT' then
    v_po := v_radek;
  else
    v_pred := v_stary;
  end if;

  perform app.audit(
    v_tenant,
    v_entita || '.' || lower(tg_op),
    v_entita,
    v_radek ->> 'id',
    v_branch,
    v_pred,
    v_po
  );

  return null;
end;
$$;

comment on function app.audit_checklist_potomek() is
  'Auditní spoušť pro checklist_items a checklist_entries, které nemají '
  'tenant_id — firmu a pobočku bere z šablony/běhu. Jinak stejná jako '
  'app.audit_zmenu (jen změněné sloupce).';

revoke all on function app.audit_checklist_potomek() from public, anon, authenticated;

drop trigger if exists trg_audit_checklist_items on public.checklist_items;
create trigger trg_audit_checklist_items
  after insert or update or delete on public.checklist_items
  for each row execute function app.audit_checklist_potomek('checklist_item');

drop trigger if exists trg_audit_checklist_entries on public.checklist_entries;
create trigger trg_audit_checklist_entries
  after insert or update or delete on public.checklist_entries
  for each row execute function app.audit_checklist_potomek('checklist_entry');
