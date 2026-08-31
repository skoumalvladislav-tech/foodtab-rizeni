-- =====================================================================
-- Foodtab — výpočet odpracovaných hodin a výdělku
--
-- Druhý bod oddílu 8 zadání (docs/mzdy-zadani.md): výpočet v `app`,
-- úzké průzory v `public`. Počítá databáze, ne prohlížeč — do prohlížeče
-- jde hotové číslo.
--
-- Čtyři pravidla, na kterých se to láme:
--   * hodiny jen z UZAVŘENÉ docházky (příchod i odchod)
--   * zapsaná přestávka se ODEČÍTÁ, nezapsaná se neodhaduje
--   * den se zařazuje podle PROVOZNÍHO dne, ne kalendářního
--   * sazba se bere KE DNI směny, ne k dnešku
-- =====================================================================


-- ---------------------------------------------------------------------
-- SAZBA KE DNI
--
-- Platí řádek s nejvyšším valid_from, který není v budoucnu. Když jich
-- má jeden den víc (oprava překlepu), platí ten později založený.
-- Vrací null, když sazba není zadaná — to není chyba, jen se nepočítá.
-- ---------------------------------------------------------------------

-- Poslední den měsíce. Sazba, kterou obrazovka ukazuje vedle částky, se
-- bere k němu, ne k dnešku: u uzavřeného měsíce by dnešní sazba byla
-- údaj z jiné doby než částka pod ní.
create or replace function app.konec_mesice(p_mesic date)
returns date
language sql immutable set search_path = ''
as $$
  select (date_trunc('month', p_mesic) + interval '1 month - 1 day')::date;
$$;


create or replace function app.rate_at(p_employee uuid, p_den date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select r.hourly_haleru
  from public.employee_rates r
  where r.employee_id = p_employee
    and r.valid_from <= p_den
  order by r.valid_from desc, r.created_at desc
  limit 1;
$$;


-- ---------------------------------------------------------------------
-- ODPRACOVANÉ MINUTY PO PROVOZNÍCH DNECH
--
-- Páruje se příchod s nejbližším následujícím odchodem v témže provozním
-- dni. Příchod bez odchodu se nezapočítá — dokud se docházka neuzavře,
-- není co počítat.
--
-- PŘESTÁVKY SE ODEČÍTAJÍ (rozhodl Šéfík). Odečte se jen zapsaná dvojice
-- break_start–break_end uvnitř otevřené směny. Nezapsaná přestávka se
-- neodhaduje ani nedopočítává: kdo si ji nepíchl, má ji ve mzdě.
--
-- Nedokončená přestávka (začátek bez konce) neodečte nic. Odečíst ji
-- „do odchodu“ by byl odhad, a odhadovat se u mezd nemá — člověk, který
-- se zapomněl vrátit z pauzy, by tak přišel o hodiny, které odpracoval.
--
-- Odečítá se v sekundách a na minuty se zaokrouhluje až nakonec, aby
-- se osmihodinová směna s půlhodinovou pauzou netrefila o minutu vedle.
--
-- Seskupuje se podle business_date, který dopočítal trigger z otevírací
-- doby pobočky. Odchod ve 2:15 tak sedí ve včerejšku sám od sebe.
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
  v_udalost  record;
  v_den      date := null;
  v_otevreno timestamptz := null;   -- začátek otevřené směny
  v_pauza    timestamptz := null;   -- začátek rozdělané přestávky
  v_pauzy    numeric := 0;          -- sekundy přestávek v téhle směně
  v_sekund   numeric := 0;          -- odpracované sekundy za den
begin
  for v_udalost in
    select a.business_date, a.kind, a.occurred_at
    from public.attendance_events a
    where a.employee_id = p_employee
      and a.business_date between p_od and p_do
    order by a.business_date, a.occurred_at
  loop
    -- Nový provozní den: co zbylo otevřené, propadá (chybí odchod).
    if v_den is distinct from v_udalost.business_date then
      if v_den is not null and v_sekund > 0 then
        den := v_den; minut := floor(v_sekund / 60)::integer; return next;
      end if;
      v_den      := v_udalost.business_date;
      v_sekund   := 0;
      v_otevreno := null;
      v_pauza    := null;
      v_pauzy    := 0;
    end if;

    if v_udalost.kind = 'in' and v_otevreno is null then
      v_otevreno := v_udalost.occurred_at;
      v_pauza    := null;
      v_pauzy    := 0;

    -- Přestávka se počítá jen uvnitř otevřené směny. Druhý break_start
    -- bez konce ten první nepřepisuje.
    elsif v_udalost.kind = 'break_start'
          and v_otevreno is not null and v_pauza is null then
      v_pauza := v_udalost.occurred_at;

    elsif v_udalost.kind = 'break_end' and v_pauza is not null then
      v_pauzy := v_pauzy + extract(epoch from (v_udalost.occurred_at - v_pauza));
      v_pauza := null;

    elsif v_udalost.kind = 'out' and v_otevreno is not null then
      -- greatest(0, …): kdyby zapsané přestávky přesáhly celou směnu,
      -- je to nesmysl v datech, ne záporně odpracovaný čas.
      v_sekund := v_sekund + greatest(
        0,
        extract(epoch from (v_udalost.occurred_at - v_otevreno)) - v_pauzy
      );
      v_otevreno := null;
      v_pauza    := null;
      v_pauzy    := 0;
    end if;
  end loop;

  if v_den is not null and v_sekund > 0 then
    den := v_den; minut := floor(v_sekund / 60)::integer; return next;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- VÝDĚLEK ZA MĚSÍC
--
-- „Tenhle měsíc“ = provozní dny od prvního do posledního dne měsíce.
--
-- Zaokrouhluje se až na konci ze součtu minut × sazba. Kdyby se
-- zaokrouhlovalo po dnech, sešlo by se za měsíc až třicet chyb.
--
-- dnu_bez_dochazky je Šéfíkův požadavek: den s plánovanou směnou, ke
-- kterému není uzavřená docházka, se nezapočítá — ale je vidět, že se
-- něco nedopočítalo.
-- ---------------------------------------------------------------------

create or replace function app.earnings(
  p_employee uuid,
  p_mesic    date
)
returns table (
  odpracovano_minut integer,
  vydelano_haleru   integer,
  dnu_bez_dochazky  integer,
  sazba_chybi       boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_od date := date_trunc('month', p_mesic)::date;
  v_do date := (date_trunc('month', p_mesic) + interval '1 month - 1 day')::date;
  v_haleru numeric := 0;
  v_radek  record;
  v_sazba  integer;
begin
  odpracovano_minut := 0;
  dnu_bez_dochazky  := 0;
  sazba_chybi       := false;

  for v_radek in select w.den, w.minut from app.worked_minutes(p_employee, v_od, v_do) w
  loop
    odpracovano_minut := odpracovano_minut + v_radek.minut;
    v_sazba := app.rate_at(p_employee, v_radek.den);
    if v_sazba is null then
      -- Odpracováno je, ale není čím násobit. Nula by vypadala jako
      -- výsledek, ne jako chybějící údaj.
      sazba_chybi := true;
    else
      v_haleru := v_haleru + v_radek.minut::numeric * v_sazba;
    end if;
  end loop;

  vydelano_haleru := round(v_haleru / 60);

  select count(*)::integer into dnu_bez_dochazky
  from (
    select distinct s.shift_date
    from public.shifts s
    where s.employee_id = p_employee
      and s.shift_date between v_od and v_do
      and s.status <> 'cancelled'
  ) planovane
  where not exists (
    select 1 from app.worked_minutes(p_employee, planovane.shift_date, planovane.shift_date)
  );

  return next;
end;
$$;


-- ---------------------------------------------------------------------
-- PRŮZORY PRO APLIKACI
--
-- Sazby se přes API nečtou po řádcích — na tabulce nemá `authenticated`
-- žádná práva. Ven jde jen hotové číslo, a jen tomu, kdo na něj má.
-- ---------------------------------------------------------------------

-- Vlastní výdělek. Bez jakéhokoli oprávnění: na svou mzdu má právo
-- každý, kdo je propojený se zaměstnancem.
create or replace function public.my_earnings(p_tenant uuid, p_mesic date)
returns table (
  odpracovano_minut integer,
  vydelano_haleru   integer,
  dnu_bez_dochazky  integer,
  sazba_chybi       boolean,
  hodinova_haleru   integer
)
language sql stable security definer set search_path = ''
as $$
  select e2.*, app.rate_at(e.id, app.konec_mesice(p_mesic))
  from public.employees e
  cross join lateral app.earnings(e.id, p_mesic) e2
  where e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
    and app.is_member(p_tenant)
  limit 1;
$$;

comment on function public.my_earnings(uuid, date) is
  'Vlastní odpracované hodiny a hrubý výdělek za měsíc. Na svou mzdu '
  'není potřeba oprávnění.';

revoke all on function public.my_earnings(uuid, date) from public, anon;
grant execute on function public.my_earnings(uuid, date) to authenticated;


-- Výdělky ostatních. Jen s payroll.read, a jen v rozsahu, na který
-- volající dosáhne — can_read_scoped ověří branch_id proti členství
-- (pravidlo 4). Bez toho práva nevrátí ani řádek; people.manage nestačí.
create or replace function public.employee_earnings(
  p_tenant uuid,
  p_mesic  date,
  p_branch uuid default null
)
returns table (
  employee_id       uuid,
  full_name         text,
  branch_id         uuid,
  odpracovano_minut integer,
  vydelano_haleru   integer,
  dnu_bez_dochazky  integer,
  sazba_chybi       boolean,
  hodinova_haleru   integer
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.full_name, e.branch_id,
         v.odpracovano_minut, v.vydelano_haleru, v.dnu_bez_dochazky, v.sazba_chybi,
         app.rate_at(e.id, app.konec_mesice(p_mesic))
  from public.employees e
  cross join lateral app.earnings(e.id, p_mesic) v
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (p_branch is null or e.branch_id = p_branch)
    and app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
  order by e.full_name;
$$;

comment on function public.employee_earnings(uuid, date, uuid) is
  'Výdělky lidí, na které má volající payroll.read ve svém rozsahu. '
  'Bez toho práva nevrátí nic.';

revoke all on function public.employee_earnings(uuid, date, uuid) from public, anon;
grant execute on function public.employee_earnings(uuid, date, uuid) to authenticated;


-- Zadání sazby. Nový řádek, nikdy úprava starého — o tom rozhodují
-- pravidla na tabulce, tady se jen kontroluje právo a zapisuje audit.
create or replace function public.set_rate(
  p_tenant     uuid,
  p_employee   uuid,
  p_haleru     integer,
  p_valid_from date,
  p_note       text default ''
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_pred   integer;
  v_id     uuid;
begin
  select e.branch_id into v_branch
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if v_branch is null and not exists (
    select 1 from public.employees e
    where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null
  ) then
    raise exception 'Zaměstnanec nepatří do téhle firmy' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'payroll.manage', v_branch) then
    raise exception 'Na zadávání sazeb nemáte právo' using errcode = 'insufficient_privilege';
  end if;

  if p_haleru < 0 then
    raise exception 'Sazba nemůže být záporná' using errcode = 'check_violation';
  end if;

  v_pred := app.rate_at(p_employee, p_valid_from);

  insert into public.employee_rates
    (tenant_id, employee_id, hourly_haleru, valid_from, note, created_by)
  values
    (p_tenant, p_employee, p_haleru, p_valid_from, coalesce(p_note, ''), (select auth.uid()))
  returning id into v_id;

  -- U mezd se dřív nebo později někdo zeptá „kdo to změnil“.
  perform app.audit(
    p_tenant, 'rate.set', 'employee', p_employee::text, v_branch,
    jsonb_build_object('hourly_haleru', v_pred),
    jsonb_build_object('hourly_haleru', p_haleru, 'valid_from', p_valid_from)
  );

  return v_id;
end;
$$;

comment on function public.set_rate(uuid, uuid, integer, date, text) is
  'Založí nový řádek sazby. Starý se nepřepisuje — sazba je historie.';

revoke all on function public.set_rate(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.set_rate(uuid, uuid, integer, date, text) to authenticated;
