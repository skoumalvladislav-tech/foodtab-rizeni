-- =====================================================================
-- Foodtab — příchod, když je jeden ještě otevřený
--
-- Rozhodnutí Šéfíka z docs/rozhodnuti-dvojity-prichod.md, na nález
-- z docs/nalezy-dochazka-2026-09-05.md, bod 1: jeden člověk měl dva
-- otevřené příchody (31. 8. 21:42 a 3. 9. 13:14). Z takového stavu se
-- nedá spočítat nic — ani hodiny, ani mzda.
--
-- ---------------------------------------------------------------------
-- ROZHODUJE STÁŘÍ, NE PRINCIP
--
--   otevřený příchod z DNEŠNÍHO provozního dne  → nový se ODMÍTNE
--   otevřený příchod ze STARŠÍHO dne            → starý se UZAVŘE,
--                                                 nový projde
--
-- Odmítat vždycky vypadá čistě, ale kdo včera zapomněl odejít, by dnes
-- ráno v šest nepíchl vůbec — a vedoucí, který to smí spravit, v šest
-- v provozovně není. Uzavírat vždycky zase smaže rozdíl mezi „zapomněl
-- jsem včera odejít“ a „ťukl jsem omylem dvakrát“; ten druhý případ je
-- častější a odmítnout se má.
--
-- ---------------------------------------------------------------------
-- CO „UZAVŘÍT“ ZNAMENÁ — A CO NE
--
-- NEZNAMENÁ TO DOMYSLET ČAS ODCHODU. `out` zůstává prázdné. Uzavření
-- je poznámka „tenhle už neblokuje“, ne náhrada za odchod:
--
--   * do odpracovaných hodin ani do mzdy se nezapočítá, přesně jako dnes,
--   * ZŮSTÁVÁ v seznamu nedokončených a vedoucí ho doplní ručně,
--   * ZŮSTÁVÁ v dosahu hlídače zapomenutých odchodů — proto se
--     `uzavreno_systemem` NEPŘIDÁVÁ do jeho podmínky. Kdyby se přidalo,
--     aplikace by překážku odklidila a nikdo by se nedozvěděl, že tam
--     byla. To je nejtišší možná chyba.
--
-- ---------------------------------------------------------------------
-- PROVOZNÍ DEN, NE KALENDÁŘNÍ
--
-- `branches.day_starts_at` je 05:00, takže příchod ve 22:00 a pokus ve
-- 2:15 je TÝŽ provozní den — noční směna, ne nový den. Počítá se přes
-- `app.business_date`; znovu se to tu nepočítá (pravidlo 10).
-- =====================================================================


alter table public.attendance_events
  add column if not exists uzavreno_systemem timestamptz;

comment on column public.attendance_events.uzavreno_systemem is
  'Kdy systém přestal ten příchod považovat za otevřený, aby nebránil '
  'dalšímu. NENÍ to čas odchodu — ten nikdo neví a `out` zůstává '
  'prázdné. Do hodin se nezapočítá a ze seznamu nedokončených ani '
  'z dosahu hlídače zapomenutých odchodů to záznam nevyřazuje.';


-- ---------------------------------------------------------------------
-- OTEVŘENÝ PŘÍCHOD — NAPŘÍČ POBOČKAMI
--
-- Člověk může být fyzicky jen na jednom místě, takže otevřený příchod
-- v Černé Perle brání i příchodu v Bernardu. Proto se hledá po celé
-- firmě, ne po pobočce.
--
-- „Otevřený“ znamená totéž co v `nedokoncena_dochazka`: příchod, po
-- kterém v TÉMŽE provozním dni nepřišel odchod. Definice se schválně
-- neopisuje jinak — dvě různá „otevřeno“ by se rozešla.
-- ---------------------------------------------------------------------

create or replace function app.otevreny_prichod(p_tenant uuid, p_employee uuid)
returns table (id uuid, branch_id uuid, business_date date, occurred_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.branch_id, a.business_date, a.occurred_at
  from public.attendance_events a
  where a.tenant_id = p_tenant
    and a.employee_id = p_employee
    and a.kind = 'in'
    and a.stornovano_kdy is null
    and a.uzavreno_systemem is null
    and not exists (
      select 1
      from public.attendance_events o
      where o.employee_id = a.employee_id
        and o.business_date = a.business_date
        and o.kind = 'out'
        and o.occurred_at > a.occurred_at
        and o.stornovano_kdy is null
    )
  order by a.occurred_at desc
  limit 1;
$$;

comment on function app.otevreny_prichod(uuid, uuid) is
  'Nejnovější příchod bez odchodu, napříč pobočkami firmy. Otevřený '
  'příchod na jedné pobočce brání příchodu i na druhé.';

revoke all on function app.otevreny_prichod(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SPOLEČNÝ ZÁPIS PÍCHNUTÍ
--
-- Návratový typ se mění, takže se funkce ruší a zakládá znovu —
-- `create or replace` návratový typ změnit neumí.
--
-- Vrací navíc, jestli se něco uzavřelo a z kterého dne. Aby to nebylo
-- POTICHU: člověk má na obrazovce vidět, že jeho starý příchod zůstal
-- bez odchodu a že se o tom ví.
-- ---------------------------------------------------------------------

drop function if exists app.pichnout(uuid, uuid, uuid, text, uuid);

create or replace function app.pichnout(
  p_tenant uuid,
  p_branch uuid,
  p_employee uuid,
  p_druh text,
  p_device uuid default null
)
returns table (udalost uuid, uzavren_stary boolean, stary_den date)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_den    date := app.business_date(p_branch, now());
  v_mimo   boolean;
  v_stary  record;
  v_uzavren boolean := false;
  v_stary_den date;
  -- Z 20260902060000 (přechod mezi pobočkami). Tělo se sem opisuje
  -- z NEJNOVĚJŠÍ podoby, ne z té původní — poprvé jsem sáhl po té
  -- z 1. 9. a přišel tím o navazování odchodu na příchod jinde.
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
    and a.stornovano_kdy is null
  order by a.occurred_at desc
  limit 1;

  if v_id is not null then
    return query select v_id, false, null::date;
    return;
  end if;

  /*
    PŘÍCHOD, KDYŽ JE JEDEN JEŠTĚ OTEVŘENÝ.

    Rozhoduje stáří: dnešní provozní den odmítne, starší uzavře.
    Porovnávají se PROVOZNÍ dny, ne okamžiky — noční směna z 22:00
    pokračuje ve 2:15 v témže provozním dni a druhé píchnutí je omyl,
    ne nový nástup.
  */
  if p_druh = 'in' then
    select * into v_stary from app.otevreny_prichod(p_tenant, p_employee);

    if v_stary.id is not null then
      if v_stary.business_date = v_den then
        raise exception 'Už máte píchnutý příchod od %. Nejdřív píchněte odchod.',
          to_char(v_stary.occurred_at at time zone
                  coalesce((select b.timezone from public.branches b
                            where b.id = v_stary.branch_id), 'Europe/Prague'),
                  'HH24:MI')
          using errcode = 'check_violation';
      end if;

      -- Starší den: uzavřít. `out` zůstává prázdné — čas odchodu nikdo
      -- neví a domýšlet se nesmí.
      update public.attendance_events
         set uzavreno_systemem = now()
       where id = v_stary.id;

      v_uzavren := true;
      v_stary_den := v_stary.business_date;

      /*
        Do auditu. Je to jediná změna docházky, kterou neudělal člověk —
        ne proto, že by to někdo zneužil, ale protože se to jinak nedá
        dohledat.
      */
      perform app.audit(
        p_tenant      => p_tenant,
        p_action      => 'dochazka.uzavreno_systemem',
        p_entity_type => 'attendance_event',
        p_entity_id   => v_stary.id::text,
        p_branch      => v_stary.branch_id,
        p_after       => jsonb_build_object(
          'business_date', v_stary.business_date,
          'duvod', 'novy prichod v pozdejsim provoznim dni'
        )
      );
    end if;
  end if;

  select not exists (
    select 1 from public.shifts s
    where s.employee_id = p_employee
      and s.branch_id = p_branch
      and s.shift_date = v_den
      and s.status <> 'cancelled'
  ) into v_mimo;

  /*
    Odchod na jiné pobočce než příchod není „mimo rozpis“ — z
    20260902060000. Kdo přišel podle rozpisu v Perle a odchází
    v Bernardu, směnu podle rozpisu odpracoval.
  */
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

  return query select v_id, v_uzavren, v_stary_den;
end;
$$;

revoke all on function app.pichnout(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- OBĚ CESTY PÍCHNUTÍ VRACEJÍ NAVÍC, ŽE SE NĚCO UZAVŘELO
--
-- Aby to nebylo potichu. Člověk má na obrazovce vidět, že jeho starý
-- příchod zůstal bez odchodu a že se o tom ví — na kiosku i v telefonu.
--
-- Návratový typ se mění, takže obě funkce se ruší a zakládají znovu.
-- Těla jsou beze změny až na volání `app.pichnout` a přidané sloupce.
-- ---------------------------------------------------------------------

drop function if exists public.pichnout_kodem(uuid, text, text);

create or replace function public.pichnout_kodem(
  p_tenant uuid,
  p_kod    text,
  p_druh   text default 'in'
)
returns table (udalost uuid, pobocka text, mimo_rozpis boolean,
               uzavren_stary boolean, stary_den date)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_kod   text := upper(btrim(coalesce(p_kod, '')));
  v_emp   uuid;
  v_bran  uuid;
  v_p     record;
  v_okno  bigint;
  b       record;
begin
  if not app.is_member(p_tenant) then
    raise exception 'K téhle firmě nepatříte.' using errcode = 'insufficient_privilege';
  end if;

  select e.id into v_emp
  from public.employees e
  where e.tenant_id = p_tenant and e.user_id = (select auth.uid()) and e.deleted_at is null;

  if v_emp is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
  end if;

  for b in
    select id from public.branches
    where tenant_id = p_tenant and deleted_at is null and active
  loop
    v_okno := app.kiosk_okno(b.id);
    -- Současné okno i to předchozí: kdo načte kód ve chvíli přepnutí,
    -- by jinak neuspěl a nechápal proč.
    if v_kod = app.kiosk_kod(b.id, v_okno) or v_kod = app.kiosk_kod(b.id, v_okno - 1) then
      v_bran := b.id;
      exit;
    end if;
  end loop;

  if v_bran is null then
    raise exception 'Kód neplatí. Načtěte prosím ten, který je zrovna na tabletu.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_p from app.pichnout(p_tenant, v_bran, v_emp, p_druh, null);

  return query
    select v_p.udalost, b2.name, a.mimo_rozpis, v_p.uzavren_stary, v_p.stary_den
    from public.attendance_events a
    join public.branches b2 on b2.id = a.branch_id
    where a.id = v_p.udalost;
end;
$$;

revoke all on function public.pichnout_kodem(uuid, text, text) from public, anon;
grant execute on function public.pichnout_kodem(uuid, text, text) to authenticated;


drop function if exists public.pichnout_pinem(text, text, text);

create or replace function public.pichnout_pinem(
  p_klic text,
  p_pin  text,
  p_druh text default 'in'
)
returns table (ok boolean, udalost uuid, jmeno text, mimo_rozpis boolean,
               uzavren_stary boolean, stary_den date)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_emp uuid;
  v_p   record;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    -- Tady se výjimka hodit SMÍ: neregistrované zařízení není pokus
    -- o uhodnutí PINu a není co si pamatovat.
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_emp := app.pin_overit(d.tenant_id, d.branch_id, coalesce(p_pin, ''));

  /*
    ŠPATNÝ PIN SE NEVYHAZUJE JAKO VÝJIMKA. Vypadalo by to čistěji, ale
    výjimka vrátí zpět celou příkazovou dávku — a s ní i počítadlo
    nezdarů a záznam v auditu, které pin_overit zrovna zapsalo.

    Zámek po pěti pokusech by tak nikdy nezabral: každý nezdar by se
    sám smazal tou chybou, která ho hlásí. Našlo se to až testem, kde
    počítadlo po pěti pokusech pořád stálo na nule.

    Vrací se proto řádek s ok = false. Špatný PIN navíc není porucha,
    ale běžný výsledek — na to se výjimky nehodí.
  */
  if v_emp is null then
    return query select false, null::uuid, null::text, null::boolean,
                        null::boolean, null::date;
    return;
  end if;

  select * into v_p from app.pichnout(d.tenant_id, d.branch_id, v_emp, p_druh, d.id);

  update public.branch_devices set posledni_kdy = now() where id = d.id;

  return query
    select true, v_p.udalost, e.full_name, a.mimo_rozpis,
           v_p.uzavren_stary, v_p.stary_den
    from public.attendance_events a
    join public.employees e on e.id = a.employee_id
    where a.id = v_p.udalost;
end;
$$;

revoke all on function public.pichnout_pinem(text, text, text) from public;
grant execute on function public.pichnout_pinem(text, text, text) to anon, authenticated;
