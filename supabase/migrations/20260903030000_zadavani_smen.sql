-- =====================================================================
-- Foodtab — zadávání směn z kalendáře
--
-- Zadání: docs/nocni-prace-2026-09-03.md, bod 2.
--
-- Dosud se rozpis jen prohlížel. Nová směna se nově založí kliknutím
-- do kalendáře — v denním a týdenním pohledu. V měsíčním ne, tam se
-- do dne netrefíš.
--
-- ---------------------------------------------------------------------
-- ČASY JSOU HODINA NA ZDI, A TO JE TADY V POŘÁDKU
--
-- `starts_at` a `ends_at` jsou `time`, tedy hodina bez pásma, a
-- `shift_date` je den. Rozpis je PLÁN: „ve dvě odpoledne“ znamená ve
-- dvě odpoledne na té pobočce, ať je zrovna letní čas nebo zimní.
--
-- Proto se tu nic nepřevádí na okamžik a nikde nevzniká `timestamptz`.
-- Ranní chyba (20260902090000) byla přesně opačná: tam se hodina na zdi
-- na okamžik převádět MUSELA a dělalo se to v pásmu serveru. Tady se
-- převádět nemá — až se z plánu stane odpracovaný čas, počítá se ze
-- skutečné docházky, ne odsud.
--
-- Jediné místo, kde pásmo potřebujeme, je kontrola provozního dne níž;
-- tam se používá `app.business_date`, ne vlastní počítání.
-- =====================================================================


-- ---------------------------------------------------------------------
-- DÉLKA SMĚNY PŘES PŮLNOC
--
-- `ends_at < starts_at` znamená, že směna končí DRUHÝ DEN. Odečtením
-- by vyšla záporná délka a 22:00–06:00 by se tvářilo jako −16 hodin.
--
-- Rovnost se sem schválně nepočítá jako čtyřiadvacet hodin: „od 8 do 8“
-- je překlep, ne celodenní služba. Odmítá se výš, v `ulozit_smenu`.
-- ---------------------------------------------------------------------

create or replace function app.delka_smeny_minut(p_od time, p_do time)
returns integer
language sql immutable
as $$
  select case
    when p_do > p_od
      then extract(epoch from (p_do - p_od))::integer / 60
    else
      (86400 - extract(epoch from p_od)::integer + extract(epoch from p_do)::integer) / 60
  end;
$$;

comment on function app.delka_smeny_minut(time, time) is
  'Délka směny v minutách. Konec dřív než začátek znamená druhý den, '
  'ne zápornou délku.';

grant execute on function app.delka_smeny_minut(time, time) to authenticated;


-- ---------------------------------------------------------------------
-- ULOŽENÍ SMĚNY
--
-- Zakládá i upravuje. `p_smena = null` je nová.
--
-- ---------------------------------------------------------------------
-- POBOČKA Z PROHLÍŽEČE JE NÁVRH (pravidlo 4)
--
-- `p_branch` se ověřuje proti členství, ne proti tomu, co přišlo. A při
-- ÚPRAVĚ se ověřuje i pobočka PŮVODNÍ: kdo smí plánovat na Bernard
-- Baru, nesmí si přetáhnout cizí směnu z Černé Perly k sobě jen tím, že
-- pošle její id.
--
-- ---------------------------------------------------------------------
-- VARUJE, NEODMÍTÁ
--
-- Překryv u jednoho člověka se vrací jako VAROVÁNÍ. Dělené směny
-- a záskoky existují a aplikace o nich neví dost na to, aby je zakázala.
-- Odmítá se jen to, co je vždycky chyba: nulová délka, cizí zaměstnanec,
-- cizí pozice.
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
  p_poznamka  text default ''
)
returns table (smena uuid, varovani text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni  public.shifts;
  v_id       uuid;
  v_varovani text[] := '{}';
  v_zacatek  date;
  v_kolize   record;
  v_jmeno    text;
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
       starts_at, ends_at, note, created_by)
    values
      (p_tenant, p_branch, p_employee, p_position, p_den,
       p_od, p_do, coalesce(btrim(p_poznamka), ''), (select auth.uid()))
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

  smena := v_id;
  varovani := v_varovani;
  return next;
end;
$$;

comment on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text) is
  'Založí nebo upraví směnu. Pobočku ověřuje proti členství, a při '
  'úpravě i tu původní. Překryv a provozní den VARUJÍ, neodmítají.';

revoke all on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text)
  from public, anon;
grant execute on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- STAV ROZPISU ZA OBDOBÍ
--
-- Obrazovka musí umět rozeznat tři situace, ne dvě:
--
--   nevydáno            rozpis se připravuje, nikomu nic nezvonilo
--   vydáno beze změn    lidé vědí, co mají
--   vydáno a ZMĚNĚNO    lidé vědí něco JINÉHO, než co je v rozpisu
--
-- Ta třetí je ta, kvůli které se to píše: kdo přidá směnu do vydaného
-- rozpisu, se dnes nedozví, že se o ní nikdo nedozvěděl.
--
-- Počítá se ze samotné tabulky, ne z `rozpis_nahled`: ten vynechává
-- směny bez přiřazeného člověka (není komu poslat zprávu), ale
-- neobsazená směna přidaná po vydání je pořád změna, kterou má vedoucí
-- vidět.
-- ---------------------------------------------------------------------

create or replace function public.rozpis_stav(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (vydano_kdy timestamptz, smen integer, zmen integer)
language sql stable security definer set search_path = ''
as $$
  select
    max(s.published_at),
    count(*)::integer,
    count(*) filter (
      where s.published_at is null
         or s.employee_id is distinct from s.published_employee_id
         or s.starts_at   is distinct from s.published_starts_at
         or s.ends_at     is distinct from s.published_ends_at
         or s.status      is distinct from s.published_status
    )::integer
  from public.shifts s
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and s.status <> 'cancelled'
    and app.can_read_scoped(p_tenant, 'shifts.read', p_branch);
$$;

comment on function public.rozpis_stav(uuid, uuid, date, date) is
  'Kolik směn období má a kolik se jich od vydání změnilo. Rozeznává '
  'i „vydáno, ale změněno“ — to je stav, o kterém vedoucí neví.';

revoke all on function public.rozpis_stav(uuid, uuid, date, date) from public, anon;
grant execute on function public.rozpis_stav(uuid, uuid, date, date) to authenticated;
