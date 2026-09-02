-- =====================================================================
-- Foodtab — příchod na jedné pobočce, odchod na druhé
--
-- Zadání: docs/prechod-mezi-pobockami-zadani.md.
--
-- Rozhodnutí, ze kterých se tu vychází:
--
--   * Píchá se JEDNOU. Jeden příchod, jeden odchod, přechod se nepíchá.
--   * Hodiny se napočítají POBOČCE, KDE ČLOVĚK SKONČIL.
--   * Když odchod chybí, počítají se tam, kde začal — jiná pobočka
--     není známá.
--
-- Model událostí to unese sám: každá událost nese svou pobočku a nic
-- je nesvazuje do dvojice. Opravují se tedy jen místa, která si to
-- spárování domýšlela po pobočkách.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 2.2 PROVOZNÍ DEN SE DĚDÍ Z OTEVŘENÉHO PŘÍCHODU
--
-- Dosud se `business_date` počítal z `day_starts_at` TÉ POBOČKY, na
-- které událost vznikla. Dnes to nevadí — obě pobočky mají 05:00 —,
-- ale je to jedna změna nastavení od tiché ztráty hodin:
--
--   Bernard Bar přepne na 04:00. Někdo přijde ve 4:30 do Černé Perly
--   (provozní den včerejší) a odejde v 5:30 v Bernard Baru (provozní
--   den dnešní). `app.worked_minutes` jde po provozních dnech a na
--   hranici dne to, co zbylo otevřené, ZAHODÍ. Nikdo se nic nedozví,
--   jen budou chybět hodiny.
--
-- Odchod a přestávky proto dědí provozní den otevřeného příchodu.
-- Vlastní se použije jen tehdy, když žádný otevřený příchod není.
--
-- Bez horní meze na stáří toho příchodu. Zapomenutý odchod je tím
-- pádem započítaný ke dni, kdy se začalo, což je správně: mzda se
-- párovala podle času už dnes a pobočku nikdy neřešila. Že takový
-- záznam vůbec existuje, řeší upozornění na zapomenutý odchod, ne
-- tenhle spoušť.
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
    /*
      Poslední událost téhož člověka před touto. Když to není odchod,
      směna je otevřená a tahle událost do ní patří — ať už vznikla
      kdekoli.
    */
    select a.kind, a.business_date into v_posledni
    from public.attendance_events a
    where a.tenant_id = new.tenant_id
      and a.employee_id = new.employee_id
      and a.occurred_at <= new.occurred_at
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

comment on function app.set_business_date() is
  'Provozní den události. Odchod a přestávky dědí den otevřeného '
  'příchodu, ať směna přes půlnoc nebo přes pobočku nepřijde o hodiny.';


-- ---------------------------------------------------------------------
-- 2.4 „MIMO ROZPIS“ NESMÍ LHÁT
--
-- Kdo je v rozpisu na Černé Perle a odpíchne se v Bernard Baru, dostal
-- dosud příznak `mimo_rozpis`. Formálně pravda, prakticky nesmysl —
-- udělal přesně to, co měl.
--
-- Nově: když k odchodu (nebo přestávce) existuje otevřený příchod,
-- který V ROZPISU BYL, příznak se neuplatní. Příchod sám se posuzuje
-- jako dosud: kdo přijde tam, kde nemá směnu, to má vidět.
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

  -- Dvojí načtení téhož kódu. Vrací se původní záznam, ne chyba:
  -- člověk udělal, co měl, a druhé pípnutí není jeho vina.
  select a.id into v_id
  from public.attendance_events a
  where a.employee_id = p_employee
    and a.branch_id = p_branch
    and a.kind = p_druh
    and a.occurred_at > now() - interval '2 minutes'
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

  /*
    Navazuje tohle na otevřenou směnu? Pak o „mimo rozpis“ rozhodl už
    příchod. Kdo přišel podle rozpisu a odešel jinde, udělal, co měl.
  */
  if v_mimo and p_druh <> 'in' then
    select a.kind, a.mimo_rozpis into v_navazu
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.employee_id = p_employee
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
-- 2.3 VEDOUCÍ MUSÍ VIDĚT PROTĚJŠEK DVOJICE
--
-- Politika `attendance_read` pouštěla čtení podle pobočky události.
-- Vedoucí Černé Perly tedy viděl příchod, ale odchod v Bernard Baru
-- nepřečetl — a díval se na směnu, která vypadala neuzavřeně.
--
-- Nově přečte i události TÉHOŽ ČLOVĚKA a TÉHOŽ PROVOZNÍHO DNE z jiné
-- pobočky, když k nim patří příchod na pobočce, kterou číst smí.
--
-- NE celou docházku cizí pobočky. Rozsah je úzký schválně a je na to
-- kontrola: jiný člověk ani jiný den se tím neotevřou.
--
-- Funkce je `security definer`, aby vnitřní dotaz nespadl zpátky do
-- téže politiky — jinak by se politika volala sama.
-- ---------------------------------------------------------------------

create or replace function app.dochazka_protejsek(
  p_tenant   uuid,
  p_employee uuid,
  p_den      date
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.employee_id = p_employee
      and a.business_date = p_den
      and a.kind = 'in'
      and app.can_read_scoped(p_tenant, 'attendance.read', a.branch_id)
  );
$$;

comment on function app.dochazka_protejsek(uuid, uuid, date) is
  'Patří k téhle události příchod na pobočce, kterou čtenář smí číst? '
  'Otevírá jen protějšek dvojice, ne docházku cizí pobočky.';

/*
  EXECUTE pro `authenticated` je nutnost, ne nedopatření: funkce se
  volá ZEVNITŘ POLITIKY, a výraz politiky se vyhodnocuje právem toho,
  kdo se ptá. Bez tohohle grantu spadne každé čtení docházky na
  „permission denied for function dochazka_protejsek“ — což se taky
  stalo, hned při prvním spuštění scénáře.

  Prozradit se tím nedá nic navíc: vrací jen ano/ne o příchodu na
  pobočce, kterou se ten člověk stejně smí číst.
*/
revoke all on function app.dochazka_protejsek(uuid, uuid, date) from public, anon;
grant execute on function app.dochazka_protejsek(uuid, uuid, date) to authenticated;

drop policy if exists attendance_read on public.attendance_events;

create policy attendance_read on public.attendance_events for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'attendance.read', branch_id)
    or employee_id in (
      select e.id from public.employees e
      where e.user_id = (select auth.uid())
    )
    -- Protějšek dvojice z jiné pobočky. Viz hlavička.
    or app.dochazka_protejsek(tenant_id, employee_id, business_date)
  );


-- ---------------------------------------------------------------------
-- 2.1 NEDOKONČENÁ DOCHÁZKA SE NESMÍ SESKUPOVAT PO POBOČKÁCH
--
-- Dosud klíč obsahoval `branch_id`, takže příchod v Černé Perle
-- a odchod v Bernard Baru vyrobil DVA PŮLPÁRY: Černá Perla napořád
-- hlásila nedokončenou směnu a Bernard Bar odchod bez příchodu.
--
-- Nově se seskupuje podle člověka a provozního dne. Pobočka se vrací
-- podle POSLEDNÍ události, ať je vidět, kde člověk skončil.
--
-- Kdo to smí číst: vlastní záznam každý; cizí ten, kdo má
-- attendance.read na KTERÉKOLI z poboček, kterých se ten den týká.
-- Kdyby se ptalo jen na poslední pobočku, vedoucí Černé Perly by
-- o rozdělané směně svého člověka nevěděl, jakmile by odešel jinam.
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
    -- Bez příchodu to není rozdělaná směna, ale osamocený záznam.
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

comment on function public.nedokoncena_dochazka(uuid, date, date, uuid) is
  'Příchody bez odchodu. Seskupeno po člověku a provozním dni, ne po '
  'pobočkách — jinak přechod mezi pobočkami vyrobí dva půlpáry. '
  'Aplikace je nikdy nezavírá sama: z vymyšleného času odchodu by se '
  'počítala mzda.';

revoke all on function public.nedokoncena_dochazka(uuid, date, date, uuid) from public, anon;
grant execute on function public.nedokoncena_dochazka(uuid, date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. KAM SE HODINY NAPOČÍTAJÍ
--
-- Pobočce, kde člověk SKONČIL (rozhodl Šéfík). Ranní přehled to dosud
-- párovat neuměl: hledal příchod na TÉŽE pobočce, takže odchod
-- v Bernard Baru nenašel k čemu patří a hodiny zmizely úplně —
-- v Černé Perle zůstal jen „nedokončený“ příchod.
--
-- Nově:
--   * odchod se páruje s posledním příchodem BEZ OHLEDU NA POBOČKU
--     a celá směna se napočítá pobočce, kde se odcházelo;
--   * za nedokončený se považuje příchod, po kterém nepřišel odchod
--     NIKDE — otevřená směna se počítá tam, kde začala.
--
-- Že se číslo během dne ještě může změnit, je vlastnost, ne chyba:
-- dokud je směna otevřená, není jisté, kde skončí.
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
      /*
        Odpracované minuty z dvojic příchod–odchod. Příchod se hledá
        BEZ OHLEDU NA POBOČKU — jinak by odchod na druhé pobočce neměl
        k čemu patřit a hodiny by zmizely. Celá směna připadne pobočce,
        kde se odcházelo.

        Otevřený příchod se do součtu nedostane (dvojice není úplná)
        a připočte se do `nedokoncenych`: z vymyšleného času odchodu se
        mzda počítat nesmí.
      */
      coalesce(sum(
        case when a.kind = 'out' then
          extract(epoch from a.occurred_at - (
            select max(v.occurred_at) from public.attendance_events v
            where v.employee_id = a.employee_id
              and v.business_date = a.business_date
              and v.kind = 'in'
              and v.occurred_at < a.occurred_at
          )) / 60
        end
      ), 0)::integer as minut,
      count(*) filter (where a.source = 'manual')::integer as rucnich,
      /*
        Nedokončený je příchod, po kterém nepřišel odchod NIKDE.
        Otevřená směna se počítá tam, kde začala — jiná pobočka není
        známá.
      */
      count(*) filter (
        where a.kind = 'in' and not exists (
          select 1 from public.attendance_events o
          where o.employee_id = a.employee_id
            and o.business_date = a.business_date
            and o.kind = 'out'
            and o.occurred_at > a.occurred_at
        )
      )::integer as nedokoncenych
    from public.attendance_events a
    where a.branch_id = b.id and a.business_date = p_den
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

comment on function public.ranni_prehled(uuid, date) is
  'Souhrn provozního dne po pobočkách. Hodiny připadnou pobočce, kde '
  'se odcházelo; otevřená směna té, kde se začalo. JEN ČÍSLA — jména '
  'a částky po lidech patří do aplikace, ne do e-mailu.';

revoke all on function public.ranni_prehled(uuid, date) from public, anon;
grant execute on function public.ranni_prehled(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- PROTĚJŠEK PRO OBRAZOVKU
--
-- Aby šlo u záznamu napsat „příchod Černá Perla · odchod Bernard Bar“,
-- musí obrazovka vědět, že se ta dvojice rozešla. Počítat to
-- v prohlížeči by znamenalo mít pravidlo párování na druhém místě —
-- a takové dvě kopie se vždycky rozejdou.
--
-- Vrací jen dny, kdy se pobočka opravdu změnila. Kdo nesmí číst, nic
-- nedostane: rozhoduje táž `attendance.read` jako všude jinde.
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

comment on function public.prechody_mezi_pobockami(uuid, date) is
  'Dny, kdy člověk přišel na jedné pobočce a odešel na druhé. Pro větu '
  'u záznamu — párování patří na jedno místo, ne do prohlížeče.';

revoke all on function public.prechody_mezi_pobockami(uuid, date) from public, anon;
grant execute on function public.prechody_mezi_pobockami(uuid, date) to authenticated;
