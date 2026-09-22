-- Checklist → úkol — z položky (nebo celého běhu) checklistu vznikne úkol.
--
-- Etapa 5 Provozního centra (docs/COMMUNICATION_ARCHITECTURE.md,
-- NOCNI-REPORT-KOMUNIKACE.md, oddíl NEHOTOVO: „Checklist → problém/úkol“).
-- Zrcadlí 20260921110000_provozni_centrum.sql, oddíly 1 a 4 (zpráva → úkol):
-- stejný tvar vazby na tasks, stejný tvar triggeru, stejný tvar průzoru.
--
-- ---------------------------------------------------------------------
-- „PROBLÉM“ NENÍ NOVÝ STAV V DATABÁZI
--
-- Checklist nemá stav „problém“ — položka je odškrtnutá, nebo ne, s hodnotou
-- v mezích, nebo mimo ně (o to se stará krok2/krok26). Nahlášení problému je
-- akce ČLOVĚKA, ne odvozený stav: kdokoli s právem tasks.manage na té
-- pobočce založí z položky (nebo z celého běhu, když problém nejde přišpendlit
-- k jedné řádce) úkol — stejně jako ze zprávy. Databáze proto nepřidává
-- žádný nový sloupec na checklist_entries, jen vazbu na straně tasks.
--
-- ---------------------------------------------------------------------
-- PROČ BEZ p_branch
--
-- `zalozit_ukol_ze_zpravy` bere pobočku od volajícího, protože rozhovor
-- (kanál vedení, osobní) nemusí mít pobočku vůbec. Checklist ji má VŽDY
-- (`checklist_runs.branch_id` je `not null`) — brát ji od klienta by jen
-- otevíralo možnost poslat jinou pobočku, než odkud běh je, a funkce by tu
-- neshodu musela hlídat. Pobočka se proto čte z běhu samotného.
--
-- ---------------------------------------------------------------------
-- POLOŽKA MŮŽE CHYBĚT
--
-- Problém se často netýká jedné řádky („chladicí box je rozbitý“, ne
-- konkrétní teploty) — `p_polozka` je proto nepovinná. Když je vyplněná,
-- musí patřit ŠABLONĚ toho běhu (ne libovolné položce odjinud).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tasks: odkud úkol vzešel (checklist)
--
-- `zdroj` už hodnotu 'checklist' zná (20260921110000_provozni_centrum.sql,
-- řádek s `check (zdroj in ('rucne', 'zprava', 'checklist'))`) — sem se jen
-- doplňují sloupce, na které se ta hodnota odkazuje.
-- ---------------------------------------------------------------------

alter table public.tasks
  add column checklist_run_id  uuid references public.checklist_runs(id)  on delete set null,
  add column checklist_item_id uuid references public.checklist_items(id) on delete set null;

create index tasks_checklist_run
  on public.tasks (checklist_run_id)
  where checklist_run_id is not null;

comment on column public.tasks.checklist_run_id is
  'Běh checklistu, ze kterého úkol vznikl (public.zalozit_ukol_z_checklistu). '
  'Přímý zápis hlídá trigger tasks_vazba_checklistu (běh musí patřit téže '
  'firmě a POBOČCE jako úkol).';
comment on column public.tasks.checklist_item_id is
  'Položka checklistu, na kterou úkol reaguje — nepovinná (problém se může '
  'týkat celého běhu, ne jedné řádky). Musí patřit šabloně toho běhu.';


-- Přímý zápis vazby (tasks_write dovolí insert/update každému s tasks.manage
-- na pobočce úkolu) nesmí umožnit připnout úkol k CIZÍMU běhu — jinak by šlo
-- mít úkol na pobočce Bar s vazbou na checklist pobočky Perla a tvářit se,
-- že s ní souvisí. Definer proto, že čte checklist_runs/checklist_items.
create or replace function app.tasks_vazba_checklistu_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch  uuid;
  v_sablona uuid;
begin
  if NEW.checklist_run_id is null and NEW.checklist_item_id is null then
    return NEW;
  end if;

  -- Kontroluje se jen NOVĚ zapsaná vazba — stejná úvaha jako
  -- u tasks_vazba_zpravy_trg: cizí klíč `on delete set null` vazbu při
  -- smazání běhu nebo položky jen ruší a nesmí to trigger blokovat.
  if TG_OP = 'UPDATE'
     and (NEW.checklist_run_id  is null or NEW.checklist_run_id  = OLD.checklist_run_id)
     and (NEW.checklist_item_id is null or NEW.checklist_item_id = OLD.checklist_item_id) then
    return NEW;
  end if;

  if NEW.checklist_item_id is not null and NEW.checklist_run_id is null then
    raise exception 'Položka checklistu bez běhu nedává smysl.'
      using errcode = 'check_violation';
  end if;

  -- Bez filtru na tenant: branch_id je globálně jedinečné (gen_random_uuid),
  -- takže shoda s NEW.branch_id níž sama dokazuje i shodu firmy — druhá
  -- podmínka na tenant_id by byla nadbytečná (a nešla by rozbít mutací).
  select r.branch_id, r.template_id
    into v_branch, v_sablona
    from public.checklist_runs r
   where r.id = NEW.checklist_run_id;

  if v_branch is null or v_branch is distinct from NEW.branch_id then
    raise exception 'Checklist k tomuhle úkolu nepatří k té pobočce nebo firmě.'
      using errcode = 'insufficient_privilege';
  end if;

  if NEW.checklist_item_id is not null and not exists (
       select 1 from public.checklist_items i
        where i.id = NEW.checklist_item_id and i.template_id = v_sablona
     ) then
    raise exception 'Položka checklistu nepatří k tomu běhu.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

revoke all on function app.tasks_vazba_checklistu_trg() from public, anon, authenticated;

create trigger tasks_vazba_checklistu
  before insert or update on public.tasks
  for each row execute function app.tasks_vazba_checklistu_trg();


-- ---------------------------------------------------------------------
-- 2. ZALOZIT_UKOL_Z_CHECKLISTU
--
-- Stejný tvar jako zalozit_ukol_ze_zpravy: ověří přístup ke zdroji, zavolá
-- zadat_ukol (adresát, termín, právo tasks.manage — jedna cesta pro ruční
-- úkol i úkol odjinud), pak zapíše vazbu a zaloguje do auditu jen ID, ne
-- název ani poznámku (ty zadal člověk a nese je notifikace přidělenému,
-- stejně jako u úkolu ze zprávy).
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
  v_branch  uuid;
  v_sablona uuid;
  v_ukol    uuid;
begin
  select r.branch_id, r.template_id
    into v_branch, v_sablona
    from public.checklist_runs r
   where r.id = p_run
     and r.tenant_id = p_tenant;

  -- Neexistující i cizí běh se tváří stejně: nedá se zkoušet, jaká id
  -- existují. Právo na pobočku ověří hned potom zadat_ukol (tasks.manage) —
  -- schválně se tu neduplikuje slabší tasks.read: kdyby se přidalo, byla by
  -- to podmínka, kterou nejde rozbít (zadat_ukol ji stejně vyžaduje znovu,
  -- a přísněji).
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

  -- Právo tasks.manage NA POBOČCE BĚHU, adresát a jeden cíl — všechno
  -- ověří zadat_ukol. Pobočka jde od běhu, ne od volajícího (viz hlavička).
  v_ukol := public.zadat_ukol(
    p_tenant, v_branch, p_nazev, p_poznamka, p_termin, p_priorita,
    p_usek, p_pozice, p_clovek
  );

  update public.tasks t
     set checklist_run_id  = p_run,
         checklist_item_id = p_polozka,
         zdroj             = 'checklist'
   where t.id = v_ukol
     and t.tenant_id = p_tenant;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'ukol.z_checklistu',
    p_entity_type => 'task',
    p_entity_id   => v_ukol::text,
    p_branch      => v_branch,
    p_after       => jsonb_build_object('checklist_run', p_run, 'checklist_polozka', p_polozka)
  );

  return v_ukol;
end;
$$;

comment on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid) is
  'Založí úkol z položky checklistu (nebo z celého běhu, když p_polozka je '
  'null). Pobočka jde z běhu, ne od volajícího. Adresát, termín a právo '
  'tasks.manage ověří public.zadat_ukol.';

revoke all on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.zalozit_ukol_z_checklistu(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  to authenticated;
