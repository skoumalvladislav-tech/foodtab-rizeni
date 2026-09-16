-- =====================================================================
-- Foodtab — trhaná směna (pauza uprostřed, nastavitelná v samotné směně)
--
-- Zadání Šéfíka 16.9.2026 (chat): rozpis potřebuje jít zapsat jako
-- jedna směna s pauzou uvnitř (např. 10:00–22:00 s pauzou 14:00–18:00
-- — oběd, pak večer), ne jako dvě oddělené směny. Dřív šlo dvě
-- oddělené směny stejně tak jen zadat, tenhle sloupcový pár dovoluje
-- appce vědět, že jde o JEDNU směnu s přestávkou, a ukázat to tak.
--
-- ---------------------------------------------------------------------
-- ROZSAH: JEN PLÁN, NE MZDA
--
-- `pauza_od`/`pauza_do` jsou informace o ROZPISU — kdy má člověk podle
-- plánu volno uprostřed směny. Výpočet mzdy s nimi NEHÝBE: odpočet
-- přestávky ve mzdě už řeší `prestavky_pausalem` (20260913150000,
-- paušální odpočet), samostatný a starší mechanismus. Tahle migrace
-- ho nemění ani nenahrazuje — kdyby oba počítaly totéž jinak, mzda by
-- se rozešla se dvěma různými čísly na dvou místech obrazovky.
--
-- `app.delka_smeny_minut` (šablony, `sablony_pro_smenu`) se schválně
-- NEMĚNÍ — pořád počítá celou směnu od–do. Šablona je "D je od osmi do
-- čtyř", ne "D je šest hodin práce"; kdo šablonu s pauzou použije,
-- pauzu si dopíše ručně stejně jako u vlastních časů.
-- =====================================================================

alter table public.shifts
  add column if not exists pauza_od time,
  add column if not exists pauza_do time;

comment on column public.shifts.pauza_od is
  'Trhaná směna: kdy pauza uvnitř směny začíná. NULL = směna není trhaná. '
  'Jen plán — do výpočtu mzdy nezasahuje (ten řeší prestavky_pausalem).';
comment on column public.shifts.pauza_do is
  'Trhaná směna: kdy pauza uvnitř směny končí. Vždycky vyplněná spolu '
  's pauza_od, nikdy samotná — hlídá to ulozit_smenu.';

-- ---------------------------------------------------------------------
-- ULOZIT_SMENU — DVA NOVÉ NEPOVINNÉ PARAMETRY NA KONCI
--
-- STARÁ DESETIPARAMETROVÁ PODOBA SE RUŠÍ, NE PŘETĚŽUJE — stejná úvaha
-- jako u migrace 20260903060000: přidání parametrů mění signaturu, takže
-- `create or replace` by vedle staré vytvořil DRUHOU, desetiparametrovou
-- funkci. Dvě funkce téhož jména, kde jedna má výchozí hodnoty, dělají
-- volání nejednoznačným. Appka volá pojmenovanými argumenty (Supabase
-- JS `.rpc(name, {...})`), takže existující volání beze změny fungují
-- dál i po zrušení staré podoby — jen dostanou p_pauza_od/do jako NULL.
-- ---------------------------------------------------------------------

drop function if exists public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text);

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
  p_sablona_key text default null,
  p_pauza_od  time default null,
  p_pauza_do  time default null
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

  /*
    Pauza je buď obě pole, nebo žádné — "od bez do" by appka nemohla
    ukázat ani spočítat. Nulová délka je stejná chyba jako u směny
    samotné (od = do).
  */
  if (p_pauza_od is null) <> (p_pauza_do is null) then
    raise exception 'Pauza potřebuje čas od i do — nebo žádný z nich.'
      using errcode = 'check_violation';
  end if;
  if p_pauza_od is not null and p_pauza_od = p_pauza_do then
    raise exception 'Pauza od a do jsou stejné. Pauza by neměla žádnou délku.'
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

  /*
    Pauza mimo směnu je jen varování, ne chyba — appka nemá dost
    znalostí ani u obyčejného od–do přes půlnoc (viz výš), takže totéž
    u pauzy uvnitř přes půlnoc jdoucí směny by šlo jen domýšlet.
    Kontrola proto platí jen u směny, která přes půlnoc NEJDE — tam je
    "uvnitř" jednoznačné.
  */
  if p_pauza_od is not null and p_do > p_od and (p_pauza_od < p_od or p_pauza_do > p_do) then
    v_varovani := v_varovani || 'Pauza zasahuje mimo dobu směny — zkontrolujte časy.';
  end if;

  /* --- zápis ------------------------------------------------------ */

  if p_smena is null then
    insert into public.shifts
      (tenant_id, branch_id, employee_id, position_id, shift_date,
       starts_at, ends_at, note, sablona_key, pauza_od, pauza_do, created_by)
    values
      (p_tenant, p_branch, p_employee, p_position, p_den,
       p_od, p_do, coalesce(btrim(p_poznamka), ''),
       nullif(btrim(coalesce(p_sablona_key, '')), ''), p_pauza_od, p_pauza_do,
       (select auth.uid()))
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
           pauza_od    = p_pauza_od,
           pauza_do    = p_pauza_do,
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
                       'zamestnanec', p_employee, 'pobocka', p_branch,
                       'pauza_od', p_pauza_od, 'pauza_do', p_pauza_do
                     )
  );

  smena := v_id;
  varovani := v_varovani;
  return next;
end;
$$;

comment on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time) is
  'Založí nebo upraví směnu, volitelně s pauzou uvnitř (trhaná směna). '
  'Pauza je jen plán — do mzdy nezasahuje.';

revoke all on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time)
  from public, anon;
grant execute on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time)
  to authenticated;
