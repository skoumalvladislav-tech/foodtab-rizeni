-- =====================================================================
-- Foodtab — Přestávky paušálem (Bod 3)
--
-- Zadání: docs/prestavky-pausalem.md, celé.
-- Rozhodl Šéfík 8. 9.: přestávky se nepíchají, odečítají se paušálem.
--
-- KDE LEŽÍ NASTAVENÍ
-- Firemní hodnota v tenant_settings (se zbytkem provozních nastavení),
-- pobočka ji může přebít — stejný řetěz jako timezone a zapomenuty_odchod.
--
-- PRAVIDLO VÝPOČTU (docs/prestavky-pausalem.md, oddíl 3):
-- 1. Hrubá délka směny = odchod − příchod.
-- 2. Sečti úplné dvojice break_start + break_end.
-- 3. Aspoň jedna úplná přestávka → počítá se ta, paušál se NEUPLATNÍ.
-- 4. Žádná úplná přestávka + hrubá > práh → odečti paušál.
-- 5. Práh se porovnává s HRUBOU délkou (ne po odečtení — jinak by se
--    směna kolem prahu chovala podivně: 6 h 10 min by sama sebe zrušila).
-- 6. Nikdy pod nulu (greatest(0, …)).
-- 7. Paušál platí jen na provozní dny od prestavka_platna_od dál.
--    Srpnové a zářijové směny zůstávají, jak jsou.
--
-- DVĚ VERZE, JEDEN COMMIT
-- app.worked_minutes(uuid, date, date) — bez storno filtru (mzdy_vypocet)
-- app.worked_minutes(uuid, date, date) → nahrazeno storno_dochazky.sql
-- Teď je jen jedna funkce (storno verze) a mění se tady.
-- Obě verze v docs měly stejné tělo — tentokrát se mění naráz.
--
-- SLOUPCOVÉ GRANTY (viz CLAUDE.md a prestavky-pausalem.md, oddíl 2)
-- Nový sloupec na tabulce s per-sloupcovými granty musí dostat vlastní
-- grant — jinak je celá stránka 42501 permission denied.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. NASTAVENÍ — tenant_settings
-- ---------------------------------------------------------------------

alter table public.tenant_settings
  add column if not exists prestavka_minut     integer not null default 30
    check (prestavka_minut between 0 and 240),
  add column if not exists prestavka_od_minut  integer not null default 360
    check (prestavka_od_minut between 0 and 1440),
  add column if not exists prestavka_platna_od date;

comment on column public.tenant_settings.prestavka_minut is
  'Minuty odečtené paušálem ze směny. 0 = paušál vypnutý pro tuto firmu.';
comment on column public.tenant_settings.prestavka_od_minut is
  'Minimální hrubá délka směny (minuty), od které se paušál uplatní. '
  'Výchozích 360 = 6 hodin — brigádník na 3 hodiny o nic nepřijde.';
comment on column public.tenant_settings.prestavka_platna_od is
  'Datum, od kterého paušál platí. Dřívější směny se NEMĚNÍ. '
  'Při prvním nastavení předvyplnit dneškem.';

-- Sloupcové granty — bez nich je při čtení stránky 42501 permission denied.
grant select (prestavka_minut, prestavka_od_minut, prestavka_platna_od)
  on public.tenant_settings to authenticated;
grant update (prestavka_minut, prestavka_od_minut, prestavka_platna_od)
  on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- 2. NASTAVENÍ — branches (pobočka přebíjí firmu)
-- ---------------------------------------------------------------------

alter table public.branches
  add column if not exists prestavka_minut    integer
    check (prestavka_minut between 0 and 240),
  add column if not exists prestavka_od_minut integer
    check (prestavka_od_minut between 0 and 1440);

comment on column public.branches.prestavka_minut is
  'Přepíše firemní prestavka_minut pro tuto pobočku. NULL = bere se od firmy.';
comment on column public.branches.prestavka_od_minut is
  'Přepíše firemní prestavka_od_minut pro tuto pobočku. NULL = bere se od firmy.';

grant select (prestavka_minut, prestavka_od_minut)
  on public.branches to authenticated;
grant update (prestavka_minut, prestavka_od_minut)
  on public.branches to authenticated;


-- ---------------------------------------------------------------------
-- 3. app.worked_minutes — přepsání se storno filtrem i paušálem
--
-- Zdroj: 20260902100000_storno_dochazky.sql (finální podoba funkce).
-- Přidané oproti té verzi:
-- - lookup tenant_settings pro paušální nastavení
-- - na každé uzavřené směně: je-li úplná přestávka → počítá se ta;
--   jinak se na splňující den uplatní paušál
-- Vrací tytéž sloupce (den, minut) — signatura se nemění, volající
-- kód se nemusí měnit. Paušál je obsažen v čísle.
-- ---------------------------------------------------------------------

create or replace function app.worked_minutes(
  p_employee uuid,
  p_od       date,
  p_do       date
)
returns table (den date, minut integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  -- Nastavení paušálu (jednou na začátku, šetří roundtrip v každé smyčce)
  v_tenant_id  uuid;
  v_platna_od  date;
  v_ts_minut   integer;  -- tenant_settings.prestavka_minut
  v_ts_od      integer;  -- tenant_settings.prestavka_od_minut

  -- Stavový automat
  v_udalost      record;
  v_den          date        := null;
  v_otevreno     timestamptz := null;
  v_branch_in    uuid        := null;
  v_pauza        timestamptz := null;
  v_pauzy        numeric     := 0;     -- sekundy úplných přestávek v té směně
  v_ma_prestavku boolean     := false; -- aspoň jedna úplná přestávka
  v_sekund       numeric     := 0;

  -- Na uzavření směny
  v_brutto         numeric := 0;
  v_odecist        numeric := 0;
  v_prestavka_min  integer;
  v_prestavka_od   integer;
begin
  -- Pravidlo 7b: tenant_id si filtrujeme sami.
  select e.tenant_id into v_tenant_id
    from public.employees e
   where e.id = p_employee and e.deleted_at is null;
  if not found then return; end if;

  -- Firemní paušální nastavení (NULL když tenant_settings neexistuje →
  -- paušál se neuplatní díky podmínce is not null níže).
  select ts.prestavka_minut, ts.prestavka_od_minut, ts.prestavka_platna_od
    into v_ts_minut, v_ts_od, v_platna_od
    from public.tenant_settings ts
   where ts.tenant_id = v_tenant_id;

  for v_udalost in
    select a.business_date, a.kind, a.occurred_at, a.branch_id
      from public.attendance_events a
     where a.employee_id    = p_employee
       and a.business_date  between p_od and p_do
       and a.stornovano_kdy is null
     order by a.business_date, a.occurred_at
  loop
    -- Nový provozní den: uzavři předchozí.
    if v_den is distinct from v_udalost.business_date then
      if v_den is not null and v_sekund > 0 then
        den := v_den; minut := floor(v_sekund / 60)::integer; return next;
      end if;
      v_den          := v_udalost.business_date;
      v_sekund       := 0;
      v_otevreno     := null;
      v_branch_in    := null;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;
    end if;

    if v_udalost.kind = 'in' and v_otevreno is null then
      v_otevreno     := v_udalost.occurred_at;
      v_branch_in    := v_udalost.branch_id;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;

    elsif v_udalost.kind = 'break_start'
          and v_otevreno is not null and v_pauza is null then
      v_pauza := v_udalost.occurred_at;

    elsif v_udalost.kind = 'break_end' and v_pauza is not null then
      v_pauzy        := v_pauzy + extract(epoch from (v_udalost.occurred_at - v_pauza));
      v_pauza        := null;
      v_ma_prestavku := true;

    elsif v_udalost.kind = 'out' and v_otevreno is not null then
      v_brutto  := extract(epoch from (v_udalost.occurred_at - v_otevreno));
      v_odecist := 0;

      if v_ma_prestavku then
        -- Zapsaná přestávka má vždy přednost — paušál se NEUPLATNÍ.
        -- Ani když je kratší než paušál: co je zapsané, to platí.
        v_odecist := v_pauzy;

      elsif v_platna_od is not null
            and v_udalost.business_date >= v_platna_od then
        -- Paušál: pobočka přebíjí firmu (coalesce).
        select coalesce(b.prestavka_minut, v_ts_minut),
               coalesce(b.prestavka_od_minut, v_ts_od)
          into v_prestavka_min, v_prestavka_od
          from public.branches b
         where b.id = v_branch_in;

        -- Práh se porovnává s hrubou délkou, ne po odečtení.
        if v_prestavka_min is not null
           and v_prestavka_od is not null
           and v_prestavka_min > 0
           and v_brutto >= v_prestavka_od * 60 then
          v_odecist := v_prestavka_min * 60;
        end if;
      end if;

      -- greatest(0, …): záporný čas není.
      v_sekund := v_sekund + greatest(0, v_brutto - v_odecist);

      v_otevreno     := null;
      v_branch_in    := null;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;
    end if;
  end loop;

  if v_den is not null and v_sekund > 0 then
    den := v_den; minut := floor(v_sekund / 60)::integer; return next;
  end if;
end;
$$;

comment on function app.worked_minutes(uuid, date, date) is
  'Odpracované minuty po odečtení přestávek. Vylučuje stornovane události. '
  'Zapsaná úplná přestávka má přednost před paušálem. Paušál se uplatní jen '
  'na provozní dny od tenant_settings.prestavka_platna_od dál.';


-- ---------------------------------------------------------------------
-- 5. nastavit_prestavku — průzor pro Nastavení → Firma
--
-- Stejný vzor jako nastavit_zapomenuty_odchod: kontrola práv,
-- audit, UPSERT. Přímý zápis do tenant_settings by obešel audit.
-- ---------------------------------------------------------------------

create or replace function public.nastavit_prestavku(
  p_tenant    uuid,
  p_minut     integer,  -- 0 = paušál vypnutý
  p_od_minut  integer,
  p_platna_od date
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_drive jsonb;
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení přestávek mění jen ten, kdo má settings.manage.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_minut is null or p_minut < 0 or p_minut > 240 then
    raise exception 'Počet minut musí být 0–240.'
      using errcode = 'check_violation';
  end if;
  if p_od_minut is null or p_od_minut < 0 or p_od_minut > 1440 then
    raise exception 'Práh musí být 0–1440 minut.'
      using errcode = 'check_violation';
  end if;

  -- Pravidlo 7b: tenant_id filtrujeme sami.
  select jsonb_build_object(
           'minut',     s.prestavka_minut,
           'od_minut',  s.prestavka_od_minut,
           'platna_od', s.prestavka_platna_od
         )
    into v_drive
    from public.tenant_settings s
   where s.tenant_id = p_tenant;

  insert into public.tenant_settings (tenant_id, prestavka_minut, prestavka_od_minut, prestavka_platna_od)
  values (p_tenant, p_minut, p_od_minut, p_platna_od)
  on conflict (tenant_id) do update
    set prestavka_minut     = excluded.prestavka_minut,
        prestavka_od_minut  = excluded.prestavka_od_minut,
        prestavka_platna_od = excluded.prestavka_platna_od;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'settings.prestavka',
    p_entity_type => 'tenant_settings',
    p_entity_id   => p_tenant::text,
    p_before      => v_drive,
    p_after       => jsonb_build_object(
                       'minut', p_minut, 'od_minut', p_od_minut, 'platna_od', p_platna_od
                     )
  );
end;
$$;

comment on function public.nastavit_prestavku(uuid, integer, integer, date) is
  'Paušální nastavení přestávky pro firmu. Jde do auditu — mění '
  'odpracovaný čas všech lidí, tedy peníze.';

revoke all on function public.nastavit_prestavku(uuid, integer, integer, date)
  from public, anon;
grant execute on function public.nastavit_prestavku(uuid, integer, integer, date)
  to authenticated;
