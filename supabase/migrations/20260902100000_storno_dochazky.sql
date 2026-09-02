-- =====================================================================
-- Foodtab — storno záznamu docházky
--
-- Rozhodnutí: docs/rozhodnuti-stara-data-pasmo.md.
--
-- Deset ručních záznamů vzniklo před opravou časového pásma
-- (20260902090000), takže leží o dvě hodiny jinde, než se zadávalo.
-- Posouvat se nebudou — jsou to zkoušky aplikace, nikomu se z nich nic
-- neplatí, a posun není bezpečná operace (u září by přeskládal pořadí
-- událostí a z pěti hodin udělal hodinu a čtvrt).
--
-- Místo toho se stornují. STORNO, NE `delete` — pravidlo 9. Smazaný
-- pohyb je díra v evidenci; stornovaný je vidět i s důvodem.
--
-- ---------------------------------------------------------------------
-- PROČ SE PŘEPISUJE SEDM FUNKCÍ
--
-- Storno, které někde nezabere, je horší než žádné: záznam se tváří
-- jako zrušený a přitom se pořád počítá. Proto se filtr přidává
-- KAŽDÉMU čtenáři docházky najednou, ne postupně:
--
--   app.worked_minutes                  mzda
--   public.ranni_prehled                čísla v e-mailu
--   public.nedokoncena_dochazka         panel na Docházce
--   app.set_business_date               dědění provozního dne
--   app.pichnout                        dvojí píchnutí a „mimo rozpis“
--   public.prechody_mezi_pobockami      věta u záznamu
--   public.ohlasit_zapomenute_odchody   naplánovaná úloha
--
-- Zbytek těla je u všech beze změny oproti předchozí migraci; přibyla
-- jen podmínka `stornovano_kdy is null`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SLOUPCE
-- ---------------------------------------------------------------------

alter table public.attendance_events
  add column if not exists stornovano_kdy timestamptz,
  add column if not exists stornoval      uuid references public.profiles(user_id) on delete set null,
  add column if not exists duvod_storna   text;

comment on column public.attendance_events.stornovano_kdy is
  'Kdy byl záznam stornovaný. Nemaže se — smazaný pohyb je díra '
  'v evidenci, stornovaný je vidět i s důvodem.';

create index if not exists attendance_platne
  on public.attendance_events (employee_id, business_date)
  where stornovano_kdy is null;


-- ---------------------------------------------------------------------
-- STORNO
--
-- Smí jen ten, kdo spravuje docházku té pobočky. Důvod je povinný:
-- storno bez důvodu je za půl roku k nerozeznání od chyby.
-- ---------------------------------------------------------------------

create or replace function public.stornovat_dochazku(
  p_tenant  uuid,
  p_udalost uuid,
  p_duvod   text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.attendance_events;
begin
  select * into a from public.attendance_events
  where id = p_udalost and tenant_id = p_tenant;

  if not found then
    raise exception 'Takový záznam docházky neexistuje.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'attendance.manage', a.branch_id) then
    raise exception 'Stornovat docházku smí jen ten, kdo ji spravuje.'
      using errcode = 'insufficient_privilege';
  end if;

  if a.stornovano_kdy is not null then
    raise exception 'Záznam už je stornovaný.' using errcode = 'invalid_parameter_value';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) < 3 then
    raise exception 'Napište prosím, proč se záznam stornuje. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  update public.attendance_events
     set stornovano_kdy = now(),
         stornoval      = (select auth.uid()),
         duvod_storna   = btrim(p_duvod)
   where id = p_udalost;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'attendance.storno',
    p_entity_type => 'attendance_event',
    p_entity_id   => p_udalost::text,
    p_branch      => a.branch_id,
    p_before      => jsonb_build_object(
                       'kind', a.kind,
                       'occurred_at', a.occurred_at,
                       'business_date', a.business_date,
                       'source', a.source
                     ),
    p_after       => jsonb_build_object('stornovano', true, 'duvod', btrim(p_duvod))
  );
end;
$$;

comment on function public.stornovat_dochazku(uuid, uuid, text) is
  'Zruší záznam docházky bez mazání. Jde do auditu i s tím, co se ruší.';

revoke all on function public.stornovat_dochazku(uuid, uuid, text) from public, anon;
grant execute on function public.stornovat_dochazku(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- MZDA
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
      and a.stornovano_kdy is null
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

    elsif v_udalost.kind = 'break_start'
          and v_otevreno is not null and v_pauza is null then
      v_pauza := v_udalost.occurred_at;

    elsif v_udalost.kind = 'break_end' and v_pauza is not null then
      v_pauzy := v_pauzy + extract(epoch from (v_udalost.occurred_at - v_pauza));
      v_pauza := null;

    elsif v_udalost.kind = 'out' and v_otevreno is not null then
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
-- PROVOZNÍ DEN SE DĚDÍ JEN Z PLATNÉHO ZÁZNAMU
-- ---------------------------------------------------------------------

create or replace function app.set_business_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_posledni record;
begin
  if new.business_date is not null then
    return new;
  end if;

  if new.kind <> 'in' then
    select a.kind, a.business_date into v_posledni
    from public.attendance_events a
    where a.tenant_id = new.tenant_id
      and a.employee_id = new.employee_id
      and a.occurred_at <= new.occurred_at
      and a.stornovano_kdy is null
    order by a.occurred_at desc, a.created_at desc
    limit 1;

    if v_posledni.kind is not null and v_posledni.kind <> 'out' then
      new.business_date := v_posledni.business_date;
      return new;
    end if;
  end if;

  new.business_date := app.business_date(new.branch_id, new.occurred_at);
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- PÍCHNUTÍ
--
-- Stornovaný záznam nesmí ani blokovat druhé pípnutí, ani rozhodovat
-- o „mimo rozpis“.
-- ---------------------------------------------------------------------

create or replace function app.pichnout(
  p_tenant   uuid,
  p_branch   uuid,
  p_employee uuid,
  p_druh     text,
  p_device   uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_den    date := app.business_date(p_branch, now());
  v_mimo   boolean;
  v_navazu record;
begin
  if p_druh not in ('in', 'out', 'break_start', 'break_end') then
    raise exception 'Neznámý druh píchnutí: %', p_druh using errcode = 'check_violation';
  end if;

  select a.id into v_id
  from public.attendance_events a
  where a.employee_id = p_employee
    and a.branch_id = p_branch
    and a.kind = p_druh
    and a.occurred_at > now() - interval '2 minutes'
    and a.stornovano_kdy is null
  order by a.occurred_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select not exists (
    select 1 from public.shifts s
    where s.employee_id = p_employee
      and s.branch_id = p_branch
      and s.shift_date = v_den
      and s.status <> 'cancelled'
  ) into v_mimo;

  if v_mimo and p_druh <> 'in' then
    select a.kind, a.mimo_rozpis into v_navazu
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.employee_id = p_employee
      and a.stornovano_kdy is null
    order by a.occurred_at desc, a.created_at desc
    limit 1;

    if v_navazu.kind is not null and v_navazu.kind <> 'out' and not v_navazu.mimo_rozpis then
      v_mimo := false;
    end if;
  end if;

  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, source, device_id, mimo_rozpis)
  values (p_tenant, p_branch, p_employee, p_druh, 'app', p_device, v_mimo)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app.pichnout(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- NEDOKONČENÁ DOCHÁZKA
-- ---------------------------------------------------------------------

create or replace function public.nedokoncena_dochazka(
  p_tenant uuid,
  p_od     date,
  p_do     date,
  p_branch uuid default null
)
returns table (
  employee_id   uuid,
  jmeno         text,
  branch_id     uuid,
  business_date date,
  zacatek       timestamptz,
  posledni_druh text,
  moje          boolean
)
language sql stable security definer set search_path = ''
as $$
  with dny as (
    select
      a.employee_id,
      a.business_date,
      array_agg(distinct a.branch_id)                              as pobocky,
      min(a.occurred_at) filter (where a.kind = 'in')              as zacatek,
      (array_agg(a.kind      order by a.occurred_at desc))[1]      as posledni_druh,
      (array_agg(a.branch_id order by a.occurred_at desc))[1]      as posledni_pobocka
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.business_date between p_od and p_do
      and a.stornovano_kdy is null
    group by a.employee_id, a.business_date
  )
  select
    d.employee_id,
    e.full_name,
    d.posledni_pobocka,
    d.business_date,
    d.zacatek,
    d.posledni_druh,
    e.user_id = (select auth.uid())
  from dny d
  join public.employees e on e.id = d.employee_id
  where d.posledni_druh <> 'out'
    and d.zacatek is not null
    and (p_branch is null or p_branch = any (d.pobocky))
    and (
      e.user_id = (select auth.uid())
      or exists (
        select 1 from unnest(d.pobocky) as x(pobocka)
        where app.can_read_scoped(p_tenant, 'attendance.read', x.pobocka)
      )
    )
  order by d.business_date desc, e.full_name;
$$;

revoke all on function public.nedokoncena_dochazka(uuid, date, date, uuid) from public, anon;
grant execute on function public.nedokoncena_dochazka(uuid, date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- PŘECHOD MEZI POBOČKAMI
-- ---------------------------------------------------------------------

create or replace function public.prechody_mezi_pobockami(
  p_tenant uuid,
  p_den    date
)
returns table (
  employee_id    uuid,
  business_date  date,
  prichod_branch uuid,
  prichod_nazev  text,
  odchod_branch  uuid,
  odchod_nazev   text,
  uzavreno       boolean
)
language sql stable security definer set search_path = ''
as $$
  with dny as (
    select
      a.employee_id,
      a.business_date,
      array_agg(a.branch_id order by a.occurred_at asc) filter (where a.kind = 'in')   as prichody,
      array_agg(a.branch_id order by a.occurred_at desc) filter (where a.kind = 'out') as odchody,
      array_agg(distinct a.branch_id) as pobocky
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.business_date = p_den
      and a.stornovano_kdy is null
    group by a.employee_id, a.business_date
  )
  select
    d.employee_id,
    d.business_date,
    d.prichody[1],
    bp.name,
    d.odchody[1],
    bo.name,
    d.odchody[1] is not null
  from dny d
  join public.branches bp on bp.id = d.prichody[1]
  left join public.branches bo on bo.id = d.odchody[1]
  where d.prichody[1] is not null
    and d.odchody[1] is not null
    and d.odchody[1] <> d.prichody[1]
    and exists (
      select 1 from unnest(d.pobocky) as x(pobocka)
      where app.can_read_scoped(p_tenant, 'attendance.read', x.pobocka)
    );
$$;

revoke all on function public.prechody_mezi_pobockami(uuid, date) from public, anon;
grant execute on function public.prechody_mezi_pobockami(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- RANNÍ PŘEHLED
-- ---------------------------------------------------------------------

create or replace function public.ranni_prehled(p_tenant uuid, p_den date)
returns table (
  branch_id           uuid,
  pobocka             text,
  komu                text[],
  lidi                integer,
  odpracovano_minut   integer,
  rucnich_zapisu      integer,
  nedokoncenych       integer,
  zaloh               integer,
  zaloh_haleru        integer,
  zaloh_nepotvrzenych integer
)
language sql stable security definer set search_path = ''
as $$
  select
    b.id,
    b.name,
    b.ranni_email_komu,
    coalesce(d.lidi, 0),
    coalesce(d.minut, 0),
    coalesce(d.rucnich, 0),
    coalesce(d.nedokoncenych, 0),
    coalesce(z.pocet, 0),
    coalesce(z.haleru, 0),
    coalesce(z.nepotvrzenych, 0)
  from public.branches b
  left join lateral (
    select
      count(distinct a.employee_id)::integer as lidi,
      coalesce(sum(
        case when a.kind = 'out' then
          extract(epoch from a.occurred_at - (
            select max(v.occurred_at) from public.attendance_events v
            where v.employee_id = a.employee_id
              and v.business_date = a.business_date
              and v.kind = 'in'
              and v.occurred_at < a.occurred_at
              and v.stornovano_kdy is null
          )) / 60
        end
      ), 0)::integer as minut,
      count(*) filter (where a.source = 'manual')::integer as rucnich,
      count(*) filter (
        where a.kind = 'in' and not exists (
          select 1 from public.attendance_events o
          where o.employee_id = a.employee_id
            and o.business_date = a.business_date
            and o.kind = 'out'
            and o.occurred_at > a.occurred_at
            and o.stornovano_kdy is null
        )
      )::integer as nedokoncenych
    from public.attendance_events a
    where a.branch_id = b.id and a.business_date = p_den
      and a.stornovano_kdy is null
  ) d on true
  left join lateral (
    select
      count(*)::integer as pocet,
      coalesce(sum(x.castka_haleru), 0)::integer as haleru,
      count(*) filter (where x.stav = 'nepotvrzena')::integer as nepotvrzenych
    from public.advances x
    where x.branch_id = b.id and x.business_date = p_den
      and x.stav <> 'stornovana'
  ) z on true
  where b.tenant_id = p_tenant
    and b.deleted_at is null
    and b.active
    and app.has_access(p_tenant, 'settings.manage')
  order by b.name;
$$;

revoke all on function public.ranni_prehled(uuid, date) from public, anon;
grant execute on function public.ranni_prehled(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- ZAPOMENUTÝ ODCHOD
-- ---------------------------------------------------------------------

create or replace function public.ohlasit_zapomenute_odchody()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zaznam record;
  v_pocet  integer := 0;
begin
  for v_zaznam in
    select
      a.id, a.tenant_id, a.branch_id, a.employee_id, a.business_date, a.occurred_at,
      e.full_name as jmeno, e.user_id as ucet, b.name as pobocka, b.slug as pobocka_slug
    from public.attendance_events a
    join public.employees e on e.id = a.employee_id
    join public.branches  b on b.id = a.branch_id
    left join public.tenant_settings s on s.tenant_id = a.tenant_id
    where a.kind = 'in'
      and e.deleted_at is null
      and a.stornovano_kdy is null
      and a.occurred_at < now()
          - make_interval(hours => coalesce(s.zapomenuty_odchod_hodin, 20))
      and (now() at time zone 'Europe/Prague')::time
          >= coalesce(s.zapomenuty_odchod_kdy, time '09:00')
      and not exists (
        select 1 from public.attendance_events o
        where o.employee_id = a.employee_id
          and o.kind = 'out'
          and o.occurred_at > a.occurred_at
          and o.stornovano_kdy is null
      )
      and not exists (
        select 1 from public.zapomenute_odchody z where z.attendance_id = a.id
      )
  loop
    insert into public.zapomenute_odchody (attendance_id, tenant_id)
    values (v_zaznam.id, v_zaznam.tenant_id)
    on conflict (attendance_id) do nothing;

    if not found then
      continue;
    end if;

    if v_zaznam.ucet is not null then
      insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
      values (
        v_zaznam.tenant_id, v_zaznam.ucet, v_zaznam.branch_id,
        'dochazka.zapomenuty_odchod',
        jsonb_build_object(
          'moje', true, 'jmeno', v_zaznam.jmeno, 'zamestnanec', v_zaznam.employee_id,
          'den', v_zaznam.business_date,
          'prichod', to_char(v_zaznam.occurred_at at time zone 'Europe/Prague', 'HH24:MI'),
          'pobocka', v_zaznam.pobocka, 'pobocka_slug', v_zaznam.pobocka_slug
        )
      );
    end if;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    select
      v_zaznam.tenant_id, k.user_id, v_zaznam.branch_id,
      'dochazka.zapomenuty_odchod',
      jsonb_build_object(
        'moje', false, 'jmeno', v_zaznam.jmeno, 'zamestnanec', v_zaznam.employee_id,
        'den', v_zaznam.business_date,
        'prichod', to_char(v_zaznam.occurred_at at time zone 'Europe/Prague', 'HH24:MI'),
        'pobocka', v_zaznam.pobocka, 'pobocka_slug', v_zaznam.pobocka_slug
      )
    from app.kdo_ma_pravo_na_pobocce(
      v_zaznam.tenant_id, 'attendance.manage', v_zaznam.branch_id
    ) k
    where k.user_id is distinct from v_zaznam.ucet;

    v_pocet := v_pocet + 1;
  end loop;

  return v_pocet;
end;
$$;

revoke all on function public.ohlasit_zapomenute_odchody() from public, anon, authenticated;
grant execute on function public.ohlasit_zapomenute_odchody() to service_role;


-- ---------------------------------------------------------------------
-- A TEĎ TĚCH DESET ZÁZNAMŮ
--
-- Vyjmenované po id, ne podmínkou `source = 'manual'`. Kdyby mezitím
-- vznikl nový ruční záznam — už opravený —, podmínka by ho sebrala
-- s sebou. Seznam se nemůže splést a na čisté databázi neudělá nic.
--
-- Kdo storno provedl, se sem nedá: migrace neběží pod žádným účtem.
-- `stornoval` proto zůstává prázdný a v auditu je vidět, že to udělala
-- migrace.
-- ---------------------------------------------------------------------

do $$
declare
  /*
    Id jsou vypsaná z ostré databáze, ne odvozená ze zkráceného výpisu.
    Napoprvé jsem osm z deseti napsal podle prvních osmi znaků a zbytek
    domyslel — migrace by tiše stornovala dva záznamy místo deseti
    a vypadalo by to, že proběhla.
  */
  v_ids uuid[] := array[
    'b67d0651-7e76-436b-8b48-84bcacf28208',  -- 27. 8. out 18:00
    'd2870a63-b848-4861-b7b7-a0e2e16d9e7f',  -- 31. 8. out 18:00
    'ac170a23-4162-44b3-934c-62221a4cc5be',  -- 31. 8. out 18:00
    '47fa3429-bb60-457c-9baf-4a3ac8ab99ad',  -- 31. 8. out 18:00
    '051ac1db-7304-44b4-b8c9-4d6f55e879c8',  -- 31. 8. out 18:00
    '52e7baaf-9610-49bd-91a8-7047e41f7092',  -- 31. 8. out 18:04
    'd7273f12-57b8-4377-8dd4-8f26b687efd7',  -- 31. 8. out 22:00
    'c637ce71-8b14-4249-bf07-1d42dbd9c7b5',  -- 1. 9.  in  13:39
    'a4dc31cb-8182-4f8f-8ee9-029d10e2ca20',  -- 1. 9.  out 18:39
    'bec96c75-df45-4d78-bd88-2f989aafb4fb'   -- 1. 9.  out 18:39
  ]::uuid[];
  v_id     uuid;
  v_pocet  integer := 0;
  v_zaznam public.attendance_events;
begin
  foreach v_id in array v_ids loop
    select * into v_zaznam from public.attendance_events
    where id = v_id and stornovano_kdy is null;

    if not found then
      continue;
    end if;

    update public.attendance_events
       set stornovano_kdy = now(),
           duvod_storna   = 'Zkušební záznam z doby před opravou časového pásma.'
     where id = v_id;

    perform app.audit(
      p_tenant      => v_zaznam.tenant_id,
      p_action      => 'attendance.storno',
      p_entity_type => 'attendance_event',
      p_entity_id   => v_id::text,
      p_branch      => v_zaznam.branch_id,
      p_before      => jsonb_build_object(
                         'kind', v_zaznam.kind,
                         'occurred_at', v_zaznam.occurred_at,
                         'business_date', v_zaznam.business_date,
                         'source', v_zaznam.source
                       ),
      p_after       => jsonb_build_object(
                         'stornovano', true,
                         'duvod', 'Zkušební záznam z doby před opravou časového pásma.',
                         'kdo', 'migrace 20260902100000'
                       )
    );

    v_pocet := v_pocet + 1;
  end loop;

  raise notice 'Stornováno zkušebních záznamů: %', v_pocet;
end $$;
