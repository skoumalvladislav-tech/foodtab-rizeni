-- Checklisty 2.0, vrstva B krok 3 — verzování šablon.
--
-- Vzor public.marketing_verze (20260909200000_marketing_obsah.sql):
-- číslované, neměnné verze; rodič drží odkaz na aktuální. Důvod je
-- stejný jako u marketingu — úprava šablony po existujícím běhu nesmí
-- tiše přepsat, co ten běh kontroloval (zadání body 24 a 47).
--
-- ---------------------------------------------------------------------
-- VERZE VZNIKÁ SAMA, NE JEN Z EDITORU
--
-- Kdyby verzi zakládal jen editor šablon, běh šablony, kterou nikdo
-- editorem neuložil (všechny dnešní — zakládají se formulářem „Nová
-- šablona" přímým insertem položek), by verzi neměl a jeho historie by
-- se měnila s každou úpravou položek. Proto:
--
--   * app.zajistit_verzi_sablony(šablona) — vezme AKTIVNÍ položky, spočítá
--     otisk; když se liší od poslední verze (nebo žádná není), založí
--     novou. Vrací id verze, která odpovídá dnešnímu obsahu.
--   * spoušť na checklist_runs PŘED INSERTEM doplní sablona_verze_id,
--     když ho nikdo neposlal — pokrývá každou cestu vzniku běhu (tlačítko
--     „Spustit", plánovač, import).
--
-- `polozky` je DENORMALIZOVANÁ kopie (i s id položky, ať se na ni dají
-- navázat záznamy běhu) — ne odkaz na živé řádky.
--
-- ---------------------------------------------------------------------
-- KLIENT VERZE JEN ČTE
--
-- Verze zakládají jen definer funkce (tahle a upravit_sablonu_checklistu).
-- Přihlášený má na tabulce jen SELECT — přímý insert by šel podvrhnout
-- (verze s obsahem, který šablona nikdy neměla), přímý delete by mazal
-- historii. Stejný vzor jako konverzace_prilohy.
-- =====================================================================


create table public.checklist_sablona_verze (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  template_id   uuid not null references public.checklist_templates(id) on delete cascade,
  cislo         integer not null check (cislo > 0),
  -- Pole objektů: id, position, label, section, instructions,
  -- requires_value, value_type, value_unit, min_value, max_value, povinna.
  polozky       jsonb not null default '[]'::jsonb,
  otisk         text not null,
  vytvoril      uuid references public.employees(id) on delete set null,
  vytvoreno_kdy timestamptz not null default now()
);

create unique index checklist_sablona_verze_cislo
  on public.checklist_sablona_verze (template_id, cislo);

comment on table public.checklist_sablona_verze is
  'Neměnná, číslovaná verze obsahu šablony. Běh se váže na verzi platnou '
  'při svém vzniku (checklist_runs.sablona_verze_id), aby pozdější úprava '
  'šablony nezměnila, co historický běh kontroloval. Zakládají ji jen '
  'definer funkce (app.zajistit_verzi_sablony).';
comment on column public.checklist_sablona_verze.polozky is
  'Denormalizovaná kopie aktivních položek v okamžiku verze (i s id) — '
  'ne odkaz na živé checklist_items.';
comment on column public.checklist_sablona_verze.otisk is
  'md5 obsahu položek. Nová verze vzniká, jen když se otisk liší od '
  'poslední — přejmenování šablony novou verzi nezakládá.';

alter table public.checklist_sablona_verze enable row level security;

create policy checklist_sablona_verze_select on public.checklist_sablona_verze
  for select to authenticated
  using (exists (
    select 1 from public.checklist_templates t
     where t.id = template_id
       and app.can_read_scoped(t.tenant_id, 'tasks.read', t.branch_id)));

revoke all on public.checklist_sablona_verze from public, anon, authenticated;
grant select on public.checklist_sablona_verze to authenticated;
grant all on public.checklist_sablona_verze to service_role;

-- Neměnnost i pro definer funkce a servis: oprava je nová verze, ne
-- update staré (stejná úvaha jako u marketing_verze). DELETE se tu
-- neblokuje — zrušení celé firmy maže kaskádou i verze; přihlášený
-- mazat nemůže (nemá grant).
create or replace function app.checklist_sablona_verze_je_nemenna()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Verze šablony se neupravuje. Vytvořte novou verzi — dokončené běhy se váží na přesný obsah.'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_checklist_sablona_verze_nemenna on public.checklist_sablona_verze;
create trigger trg_checklist_sablona_verze_nemenna
  before update on public.checklist_sablona_verze
  for each row execute function app.checklist_sablona_verze_je_nemenna();


-- ---------------------------------------------------------------------
-- Odkazy z rodiče a z běhu
-- ---------------------------------------------------------------------

alter table public.checklist_templates
  add column aktualni_verze_id uuid references public.checklist_sablona_verze(id) on delete set null;

comment on column public.checklist_templates.aktualni_verze_id is
  'Nejnovější verze obsahu šablony (udržuje app.zajistit_verzi_sablony). '
  'Jen informativní — o obsahu běhu rozhoduje checklist_runs.sablona_verze_id.';

alter table public.checklist_runs
  add column sablona_verze_id uuid references public.checklist_sablona_verze(id) on delete set null;

comment on column public.checklist_runs.sablona_verze_id is
  'Verze šablony platná při vzniku běhu — doplní ji spoušť. NULL jen '
  'u běhů založených před touhle migrací (čtou živé položky).';


-- ---------------------------------------------------------------------
-- APP.ZAJISTIT_VERZI_SABLONY
--
-- Zámek na řádku šablony: dva souběžné vzniky běhu téže šablony (plánovač
-- a tlačítko ve stejnou chvíli) by jinak spočítaly stejné číslo verze
-- a jeden by spadl na jedinečnosti — a s ním celý vznik běhu.
-- ---------------------------------------------------------------------

create or replace function app.zajistit_verzi_sablony(p_sablona uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_polozky   jsonb;
  v_otisk     text;
  v_posl_id   uuid;
  v_posl_otisk text;
  v_cislo     integer;
  v_id        uuid;
begin
  select t.tenant_id into v_tenant
    from public.checklist_templates t
   where t.id = p_sablona
     for update;

  if v_tenant is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'position', i.position, 'label', i.label,
           'section', i.section, 'instructions', i.instructions,
           'requires_value', i.requires_value, 'value_type', i.value_type,
           'value_unit', i.value_unit, 'min_value', i.min_value,
           'max_value', i.max_value, 'povinna', i.povinna)
           order by i.position, i.id), '[]'::jsonb)
    into v_polozky
    from public.checklist_items i
   where i.template_id = p_sablona and i.active;

  v_otisk := md5(v_polozky::text);

  select v.id, v.otisk into v_posl_id, v_posl_otisk
    from public.checklist_sablona_verze v
   where v.template_id = p_sablona
   order by v.cislo desc
   limit 1;

  if v_posl_id is not null and v_posl_otisk = v_otisk then
    v_id := v_posl_id;
  else
    select coalesce(max(v.cislo), 0) + 1 into v_cislo
      from public.checklist_sablona_verze v where v.template_id = p_sablona;

    insert into public.checklist_sablona_verze
      (tenant_id, template_id, cislo, polozky, otisk, vytvoril)
    values
      (v_tenant, p_sablona, v_cislo, v_polozky, v_otisk, app.muj_employee(v_tenant))
    returning id into v_id;
  end if;

  update public.checklist_templates
     set aktualni_verze_id = v_id
   where id = p_sablona and aktualni_verze_id is distinct from v_id;

  return v_id;
end;
$$;

comment on function app.zajistit_verzi_sablony(uuid) is
  'Verze odpovídající dnešnímu obsahu aktivních položek šablony — '
  'existující, když se obsah nezměnil, jinak nová. Zamyká řádek šablony.';

revoke all on function app.zajistit_verzi_sablony(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SPOUŠŤ NA BĚHU
--
-- INSERT: chybí-li verze, doplní se ta dnešní. Poslaná verze musí patřit
-- TÉŽE šabloně — RLS na checklist_runs (tasks.read na pobočce) by jinak
-- pustila běh s verzí cizí šablony, klidně cizí firmy, a detail běhu by
-- ukázal její položky.
--
-- UPDATE: verze běhu se nemění. Jediná výjimka je vynulování cizím
-- klíčem (on delete set null), když verze sama zmizela — to se pozná
-- tak, že starou verzi už nejde najít.
-- ---------------------------------------------------------------------

create or replace function app.checklist_run_verze_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.sablona_verze_id is null then
      new.sablona_verze_id := app.zajistit_verzi_sablony(new.template_id);
    elsif not exists (
      select 1 from public.checklist_sablona_verze v
       where v.id = new.sablona_verze_id and v.template_id = new.template_id
    ) then
      raise exception 'Verze nepatří k šabloně toho běhu.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.sablona_verze_id is distinct from old.sablona_verze_id
     and not (new.sablona_verze_id is null and not exists (
               select 1 from public.checklist_sablona_verze v
                where v.id = old.sablona_verze_id)) then
    raise exception 'Verze běhu se nemění — běh drží obsah, se kterým vznikl.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke all on function app.checklist_run_verze_trg() from public, anon, authenticated;

drop trigger if exists trg_checklist_run_verze on public.checklist_runs;
create trigger trg_checklist_run_verze
  before insert or update of sablona_verze_id on public.checklist_runs
  for each row execute function app.checklist_run_verze_trg();
