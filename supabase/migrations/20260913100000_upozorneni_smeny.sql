-- =====================================================================
-- Foodtab — upozornění na změny směn
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 5 (Krok C).
--
-- PROČ V DATABÁZI, NE V APLIKACI
--
-- `ulozit_smenu` a `smazat_smenu` jsou SECURITY DEFINER — volají je
-- víc obrazovek a eventuelně i joby. Zápis upozornění uvnitř funkce
-- zaručuje, že se na žádné cestě nevynechá bez ohledu na to, odkud
-- se funkce volá.
--
-- TABULKA, ZVONEČEK A OBRAZOVKA UŽ EXISTUJÍ
--
-- Vše vytvořila migrace 20260901130000_vydani_rozpisu.sql. Tady se
-- jen doplňuje, co do nich zapisuje.
--
-- TŘI PRAVIDLA (docs/velka-prace-2026-09-08.md, C3)
--
-- 1. V telu není nic citlivého — jen datum a čas směny. Nikdy mzda,
--    sazba, záloha ani telefon.
-- 2. Vlastní změna neupozorňuje: auth.uid() != příjemce.
-- 3. Slučuj podle (user_id, druh, den): existující nepřečtené téhož
--    druhu na tentýž den se smaže a nahradí novým. Osm změn jednoho
--    dne → jedno upozornění, ne osm.
--
-- FILTRUJE SI TO SAMO (pravidlo 7b)
--
-- Všechny funkce jsou SECURITY DEFINER s rolbypassrls — uvnitř žádné
-- RLS. `tenant_id = p_tenant` i `user_id = p_user_id` jsou v každém
-- dotazu a DELETE, každá podmínka jen jednou (aby šlo rozbít).
-- =====================================================================


-- ---------------------------------------------------------------------
-- POMOCNÁ FUNKCE
--
-- Centrální místo pro zápis upozornění na směnu. Slučuje (C4):
-- smaže nepřečtené téhož druhu a dne a pak vloží nové.
--
-- Volající odpovídá za kontrolu auth.uid() != p_user_id (C3/3) —
-- tato funkce to nehlídá, aby šlo rozbít jednu podmínku najednou.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_smenu(
  p_tenant    uuid,
  p_user_id   uuid,
  p_branch_id uuid,
  p_druh      text,
  p_den       date,
  p_od        time,
  p_do        time
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  -- Sloučení (C4): smazat nepřečtené téhož druhu na tentýž den.
  -- tenant_id brání přepisu upozornění cizí firmy.
  delete from public.notifications
   where tenant_id      = p_tenant
     and user_id        = p_user_id
     and druh           = p_druh
     and telo->>'den'   = p_den::text
     and read_at is null;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  values (
    p_tenant,
    p_user_id,
    p_branch_id,
    p_druh,
    jsonb_build_object(
      'den', p_den,
      'od',  to_char(p_od, 'HH24:MI'),
      'do',  to_char(p_do, 'HH24:MI')
    )
  );
end $$;

revoke all on function app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time)
  from public, anon, authenticated;

comment on function app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time) is
  'Zapíše upozornění na změnu směny se slučováním: smaže nepřečtené '
  'téhož druhu a dne a vloží nové (C4). Vlastní změnu (auth.uid() = '
  'p_user_id) musí vyloučit volající.';


-- ---------------------------------------------------------------------
-- ULOZIT_SMENU — s upozorněními
--
-- CREATE OR REPLACE: signatura i návratový typ se nemění.
--
-- Přidána část „upozornění" za voláním app.audit:
--   - nová směna se zaměstnancem  → smena.nova
--   - změna zaměstnance           → starý dostane smena.odebrana,
--                                    nový smena.nova
--   - stejný zaměstnanec, změnil
--     se čas/datum/pobočka        → smena.zmenena
-- ---------------------------------------------------------------------

create or replace function public.ulozit_smenu(
  p_tenant    uuid,
  p_smena     uuid,
  p_branch    uuid,
  p_employee  uuid,
  p_position  uuid,
  p_den       date,
  p_od        time,
  p_do        time,
  p_poznamka  text default '',
  p_sablona_key text default null
)
returns table (smena uuid, varovani text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni       public.shifts;
  v_id            uuid;
  v_varovani      text[] := '{}';
  v_zacatek       date;
  v_kolize        record;
  v_jmeno         text;
  v_user_id       uuid;
  v_stary_user_id uuid;
begin
  if not app.has_access(p_tenant, 'shifts.manage', p_branch) then
    raise exception 'Plánovat směny na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_smena is not null then
    select * into v_puvodni from public.shifts
    where id = p_smena and tenant_id = p_tenant;

    if not found then
      raise exception 'Takovou směnu neznám.' using errcode = 'no_data_found';
    end if;

    -- Viz hlavička: i původní pobočka.
    if not app.has_access(p_tenant, 'shifts.manage', v_puvodni.branch_id) then
      raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_den is null or p_od is null or p_do is null then
    raise exception 'Vyplňte datum a čas od–do.' using errcode = 'check_violation';
  end if;

  if p_od = p_do then
    raise exception 'Začátek a konec jsou stejné. Směna by neměla žádnou délku.'
      using errcode = 'check_violation';
  end if;

  -- Zaměstnanec smí být prázdný (volná směna), ale ne cizí.
  if p_employee is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null
  ) then
    raise exception 'Takového zaměstnance v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  if p_position is not null and not exists (
    select 1 from public.positions po
    where po.id = p_position and po.tenant_id = p_tenant
  ) then
    raise exception 'Takovou pozici v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  /*
    Provozní den (pravidlo 10). Směna, která začíná před začátkem
    provozního dne pobočky, patří ve skutečnosti do dne PŘEDCHOZÍHO —
    a kiosek i docházka ji podle `shift_date` hledají jinde.

    Datum se schválně nepřepisuje: člověk napsal, co napsal, a tiše mu
    to posunout o den je horší než mu to říct.
  */
  v_zacatek := app.business_date(
    p_branch,
    (p_den + p_od) at time zone app.zona_pobocky(p_branch)
  );
  if v_zacatek is distinct from p_den then
    v_varovani := v_varovani || format(
      'Směna začíná před začátkem provozního dne, takže patří do %s, ne do %s. Docházka i kiosek ji budou hledat tam.',
      to_char(v_zacatek, 'DD.MM.YYYY'), to_char(p_den, 'DD.MM.YYYY'));
  end if;

  if p_do < p_od then
    v_varovani := v_varovani || format(
      'Směna končí druhý den v %s. Délka je %s h %s min.',
      to_char(p_do, 'HH24:MI'),
      app.delka_smeny_minut(p_od, p_do) / 60,
      lpad((app.delka_smeny_minut(p_od, p_do) % 60)::text, 2, '0'));
  end if;

  /* --- zápis ------------------------------------------------------ */

  if p_smena is null then
    insert into public.shifts
      (tenant_id, branch_id, employee_id, position_id, shift_date,
       starts_at, ends_at, note, sablona_key, created_by)
    values
      (p_tenant, p_branch, p_employee, p_position, p_den,
       p_od, p_do, coalesce(btrim(p_poznamka), ''),
       nullif(btrim(coalesce(p_sablona_key, '')), ''), (select auth.uid()))
    returning id into v_id;
  else
    update public.shifts
       set branch_id   = p_branch,
           employee_id = p_employee,
           position_id = p_position,
           shift_date  = p_den,
           starts_at   = p_od,
           ends_at     = p_do,
           note        = coalesce(btrim(p_poznamka), ''),
           sablona_key = nullif(btrim(coalesce(p_sablona_key, '')), ''),
           updated_at  = now()
     where id = p_smena
    returning id into v_id;
  end if;

  /*
    Překryv AŽ PO ZÁPISU a jen jako varování. Počítá se v minutách od
    začátku dne, aby směna přes půlnoc nevypadala jako zápor.
  */
  if p_employee is not null then
    for v_kolize in
      select s.shift_date, s.starts_at, s.ends_at, b.name as pobocka
      from public.shifts s
      join public.branches b on b.id = s.branch_id
      where s.tenant_id = p_tenant
        and s.employee_id = p_employee
        and s.id <> v_id
        and s.status <> 'cancelled'
        and s.shift_date between p_den - 1 and p_den + 1
        -- Dvě úsečky na časové ose se překrývají, když každá začíná
        -- dřív, než ta druhá končí.
        and (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
            < extract(epoch from p_od)::integer / 60 + app.delka_smeny_minut(p_od, p_do)
        and extract(epoch from p_od)::integer / 60
            < (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
              + app.delka_smeny_minut(s.starts_at, s.ends_at)
      order by s.shift_date, s.starts_at
    loop
      v_varovani := v_varovani || format(
        'Překrývá se s jinou směnou téhož člověka: %s %s–%s, %s.',
        to_char(v_kolize.shift_date, 'DD.MM.'),
        to_char(v_kolize.starts_at, 'HH24:MI'),
        to_char(v_kolize.ends_at, 'HH24:MI'),
        v_kolize.pobocka);
    end loop;
  end if;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => case when p_smena is null then 'smena.zalozena' else 'smena.upravena' end,
    p_entity_type => 'shift',
    p_entity_id   => v_id::text,
    p_branch      => p_branch,
    p_before      => case when p_smena is null then null else jsonb_build_object(
                       'den', v_puvodni.shift_date,
                       'od', v_puvodni.starts_at,
                       'do', v_puvodni.ends_at,
                       'zamestnanec', v_puvodni.employee_id,
                       'pobocka', v_puvodni.branch_id
                     ) end,
    p_after       => jsonb_build_object(
                       'den', p_den, 'od', p_od, 'do', p_do,
                       'zamestnanec', p_employee, 'pobocka', p_branch
                     )
  );

  /* --- upozornění (C3, docs/velka-prace-2026-09-08.md) ----------- */

  -- user_id přiřazeného zaměstnance po změně.
  if p_employee is not null then
    select e.user_id into v_user_id
      from public.employees e
     where e.id = p_employee
       and e.tenant_id = p_tenant
       and e.deleted_at is null;
  end if;

  if p_smena is null then
    -- Nová směna: upozornit přiřazeného (C3/2: jen pokud není sám autor).
    if v_user_id is not null and v_user_id <> (select auth.uid()) then
      perform app.upozornit_smenu(p_tenant, v_user_id, p_branch, 'smena.nova', p_den, p_od, p_do);
    end if;
  else
    if v_puvodni.employee_id is distinct from p_employee then
      -- Zaměstnanec se změnil.

      -- Starý zaměstnanec dostane „odebrana".
      if v_puvodni.employee_id is not null then
        select e.user_id into v_stary_user_id
          from public.employees e
         where e.id = v_puvodni.employee_id
           and e.tenant_id = p_tenant;
        if v_stary_user_id is not null and v_stary_user_id <> (select auth.uid()) then
          perform app.upozornit_smenu(
            p_tenant, v_stary_user_id,
            coalesce(v_puvodni.branch_id, p_branch),
            'smena.odebrana',
            v_puvodni.shift_date, v_puvodni.starts_at, v_puvodni.ends_at
          );
        end if;
      end if;

      -- Nový zaměstnanec dostane „nova".
      if v_user_id is not null and v_user_id <> (select auth.uid()) then
        perform app.upozornit_smenu(p_tenant, v_user_id, p_branch, 'smena.nova', p_den, p_od, p_do);
      end if;

    elsif v_user_id is not null
      and v_user_id <> (select auth.uid())
      and (
        v_puvodni.shift_date is distinct from p_den
        or v_puvodni.starts_at is distinct from p_od
        or v_puvodni.ends_at   is distinct from p_do
        or v_puvodni.branch_id is distinct from p_branch
      ) then
      -- Stejný zaměstnanec, změnilo se datum/čas/pobočka.
      perform app.upozornit_smenu(p_tenant, v_user_id, p_branch, 'smena.zmenena', p_den, p_od, p_do);
    end if;
  end if;

  smena := v_id;
  varovani := v_varovani;
  return next;
end;
$$;


revoke all on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text)
  from public, anon;
grant execute on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- SMAZAT_SMENU — s upozorněním na zrušení
--
-- DROP + CREATE: signatura se nemění, ale přidáváme kolonku do
-- v_smena recordu a novou proměnnou, takže celá funkce znovu.
--
-- Zrušení vydané směny (return 'zrusena') zakládá upozornění
-- smena.zrusena dotčenému zaměstnanci. Smazání nevydané (return
-- 'smazana') neupozorňuje: nikdo tu směnu neviděl.
-- ---------------------------------------------------------------------

drop function if exists public.smazat_smenu(uuid, uuid);

create function public.smazat_smenu(
  p_tenant uuid,
  p_smena  uuid
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_smena   record;
  v_user_id uuid;
begin
  select s.id, s.branch_id, s.employee_id,
         s.shift_date, s.starts_at, s.ends_at,
         s.published_at, s.status
    into v_smena
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  if not found then
    raise exception 'Takovou směnu neznám.'
      using errcode = 'no_data_found';
  end if;

  -- Právo se ptá na POBOČKU TÉ SMĚNY, ne na tu z adresy (pravidlo 4).
  if not app.has_access(p_tenant, 'shifts.manage', v_smena.branch_id) then
    raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
    NEVYDANÁ: řádek zmizí. Nikdo ji neviděl, není co ohlašovat.
  */
  if v_smena.published_at is null then
    delete from public.shifts s
     where s.id = p_smena
       and s.tenant_id = p_tenant;
    return 'smazana';
  end if;

  /*
    VYDANÁ: zůstává stát jako zrušená. Lidem se pořád ukazuje vydaná
    podoba, takže se o zrušení dozvědí až vydáním rozpisu — kde ho
    `app.rozdil_rozpisu` ukáže jako „zrusena".

    Druhé zrušení téže směny nic nerozbije: skončí u `already`
    a obrazovka se nemá čeho chytit.
  */
  if v_smena.status = 'cancelled' then
    return 'uz_zrusena';
  end if;

  update public.shifts s
     set status = 'cancelled'
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  -- Upozornit dotčeného zaměstnance (C3/2: jen pokud není sám autor).
  if v_smena.employee_id is not null then
    select e.user_id into v_user_id
      from public.employees e
     where e.id = v_smena.employee_id
       and e.tenant_id = p_tenant;
    if v_user_id is not null and v_user_id <> (select auth.uid()) then
      perform app.upozornit_smenu(
        p_tenant, v_user_id, v_smena.branch_id,
        'smena.zrusena',
        v_smena.shift_date, v_smena.starts_at, v_smena.ends_at
      );
    end if;
  end if;

  return 'zrusena';
end $$;

comment on function public.smazat_smenu(uuid, uuid) is
  'Nevydanou směnu smaže, vydanou označí jako zrušenou — ta lidem '
  'zmizí až vydáním rozpisu, kde se ohlásí. Vydaná zrušená směna '
  'zakládá upozornění smena.zrusena dotčenému zaměstnanci. '
  'Právo shifts.manage na pobočce té směny. '
  'Vrací smazana / zrusena / uz_zrusena.';

revoke all on function public.smazat_smenu(uuid, uuid)
  from public, anon;
grant execute on function public.smazat_smenu(uuid, uuid) to authenticated;
