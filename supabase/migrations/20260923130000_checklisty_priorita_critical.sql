-- Checklisty 2.0, vrstva B krok 2 — 3. úroveň priority, jen pro checklist.
--
-- Rozhodnutí Šéfíka 23. 9.: mockup u „Nahlásit problém" ukazuje tři
-- úrovně (Běžná/Důležitá/Kritická), ale zbytek appky má zůstat na dvou
-- (normal/high) — critical je vyhrazená pro problém nahlášený z
-- checklistu, ne obecné zadání úkolu.
--
-- ---------------------------------------------------------------------
-- KDE VZNIKÁ critical A KDE NE
--
-- `public.zadat_ukol` (20260906040000_zadani_ukolu.sql) se NEMĚNÍ —
-- zůstává navždy stropovaná na 'high' jako dřív. Jediné místo, kde
-- `critical` vznikne, je `public.zalozit_ukol_z_checklistu`
-- (20260922100000_checklist_ukol.sql): zavolá zadat_ukol s prioritou
-- capnutou na 'high' (aby insert prošel dřív, než je checklist_run_id
-- vyplněné — nový CHECK dole to vyžaduje), a teprve v témže UPDATEu, co
-- nastavuje checklist_run_id/checklist_item_id/zdroj, nastaví i finální
-- prioritu — atomicky, ne v mezikroku, kdy by 'critical' bez
-- checklist_run_id spadlo na CHECK.
--
-- Druhá linie na DB úrovni (ne jen ve funkci): CHECK
-- tasks_critical_jen_checklist váže 'critical' striktně na existenci
-- checklist_run_id, ne na sloupec zdroj (ten je jen text bez FK).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tasks.priority — třetí hodnota
--
-- task_templates.priority se NEMĚNÍ (zůstává 2 úrovně — recurring úkoly
-- nejsou z checklistu).
-- ---------------------------------------------------------------------

alter table public.tasks
  drop constraint tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
  check (priority in ('normal', 'high', 'critical'));

alter table public.tasks
  add constraint tasks_critical_jen_checklist
  check (priority <> 'critical' or checklist_run_id is not null);

comment on column public.tasks.priority is
  'normal/high všude. critical JEN u úkolů z checklistu (viz '
  'tasks_critical_jen_checklist) — nahlášení problému s prioritou '
  'Kritická. Obecné zadání úkolu (zadat_ukol) na critical nikdy nesahá.';


-- ---------------------------------------------------------------------
-- 2. zalozit_ukol_z_checklistu — jediné místo, kde critical vznikne
-- ---------------------------------------------------------------------

create or replace function public.zalozit_ukol_z_checklistu(
  p_tenant   uuid,
  p_run      uuid,
  p_polozka  uuid,
  p_nazev    text,
  p_poznamka text                        default '',
  p_termin   timestamp without time zone default null,
  p_priorita text                        default 'normal',
  p_usek     uuid                        default null,
  p_pozice   uuid                        default null,
  p_clovek   uuid                        default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch   uuid;
  v_sablona  uuid;
  v_priorita text := case when p_priorita in ('normal', 'high', 'critical')
                       then p_priorita else 'normal' end;
  v_ukol     uuid;
begin
  select r.branch_id, r.template_id
    into v_branch, v_sablona
    from public.checklist_runs r
   where r.id = p_run
     and r.tenant_id = p_tenant;

  if v_branch is null then
    raise exception 'K tomuhle checklistu nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_polozka is not null and not exists (
       select 1 from public.checklist_items i
        where i.id = p_polozka and i.template_id = v_sablona
     ) then
    raise exception 'Ta položka k tomuhle checklistu nepatří.'
      using errcode = 'check_violation';
  end if;

  -- Insert v zadat_ukol dostane nejvýš 'high' — v tomhle okamžiku ještě
  -- není checklist_run_id vyplněné a tasks_critical_jen_checklist by
  -- 'critical' bez něj odmítl. Finální priorita se zapíše až dole,
  -- ATOMICKY spolu s vazbou na checklist.
  v_ukol := public.zadat_ukol(
    p_tenant, v_branch, p_nazev, p_poznamka, p_termin,
    case when v_priorita = 'critical' then 'high' else v_priorita end,
    p_usek, p_pozice, p_clovek
  );

  update public.tasks t
     set checklist_run_id  = p_run,
         checklist_item_id = p_polozka,
         zdroj             = 'checklist',
         priority           = v_priorita
   where t.id = v_ukol
     and t.tenant_id = p_tenant;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'ukol.z_checklistu',
    p_entity_type => 'task',
    p_entity_id   => v_ukol::text,
    p_branch      => v_branch,
    p_after       => jsonb_build_object(
      'checklist_run', p_run, 'checklist_polozka', p_polozka, 'priorita', v_priorita)
  );

  return v_ukol;
end;
$$;

comment on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid) is
  'Založí úkol z položky checklistu (nebo z celého běhu, když p_polozka je '
  'null). Jediné místo, kde priorita smí být "critical" — nastaví se '
  'atomicky spolu s checklist_run_id, aby CHECK vždycky viděl oboje.';

revoke all on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  to authenticated;


-- ---------------------------------------------------------------------
-- 3. upozornit_na_ukol_trg — critical obchází ztlumení jako urgent
--
-- POZOR NA POŘADÍ: úkol z checklistu vzniká INSERTEM s prioritou nejvýš
-- 'high' (viz oddíl 2) a na 'critical' se povýší až následným UPDATEm.
-- Trigger jen na INSERT by kritický problém ohlásil jako 'important' a
-- naléhavost by se ztratila. Proto trigger poslouchá i UPDATE priority
-- — ale ozve se JEN při povýšení na 'critical'. Klíč slučování
-- ('ukol.pridelen:<id>') nepřečtené 'important' upozornění nahradí
-- 'urgent' (app.zrusit_neprectene zruší i jeho čekající push), takže
-- adresát má dál právě jedno upozornění, jen naléhavé.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_ukol_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_rec record;
begin
  if NEW.status <> 'open' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and not (NEW.priority = 'critical' and OLD.priority is distinct from 'critical') then
    return NEW;
  end if;

  for v_rec in
    select distinct e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       and e.user_id is distinct from NEW.created_by
       and (
         (NEW.employee_id is not null and e.id = NEW.employee_id)
         or (NEW.usek_id is not null and e.usek_id = NEW.usek_id
             and (NEW.branch_id is null or e.branch_id = NEW.branch_id))
         or (NEW.position_id is not null and e.position_id = NEW.position_id
             and (NEW.branch_id is null or e.branch_id = NEW.branch_id))
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'ukol.pridelen',
      jsonb_strip_nulls(jsonb_build_object(
        'nazev', left(NEW.title, 120),
        'ukol',  NEW.id,
        'termin', case when NEW.due_at is not null
                    then to_char(NEW.due_at at time zone app.zona_pobocky(NEW.branch_id),
                                 'YYYY-MM-DD"T"HH24:MI')
                  end
      )),
      case
        when NEW.priority = 'critical' then 'urgent'
        when NEW.priority = 'high'     then 'important'
        else 'normal'
      end,
      NEW.branch_id,
      null,
      'ukol',
      NEW.id,
      'ukol.pridelen:' || NEW.id::text
    );
  end loop;

  return NEW;
end $$;

drop trigger if exists upozornit_na_ukol on public.tasks;
create trigger upozornit_na_ukol
  after insert or update of priority on public.tasks
  for each row execute function app.upozornit_na_ukol_trg();
