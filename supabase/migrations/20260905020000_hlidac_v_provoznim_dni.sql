-- =====================================================================
-- Foodtab — hlídač páruje odchod v provozním dni, stejně jako obrazovka
--
-- Nález docs/nalezy-vecer-2026-09-05.md, bod 2. Rozhodl Šéfík 5. 9.:
-- platí PROVOZNÍ DEN.
--
-- ---------------------------------------------------------------------
-- CO BYLO ŠPATNĚ
--
-- Dva pohledy na tutéž věc se rozcházely:
--
--   public.nedokoncena_dochazka (20260903010000)
--     páruje UVNITŘ provozního dne — `o.business_date = a.business_date`
--
--   public.ohlasit_zapomenute_odchody (20260902100000)
--     párovala NAPŘÍČ dny — jen `o.occurred_at > a.occurred_at`
--
-- Jakýkoli pozdější odchod, třeba o tři dny, tak v očích hlídače
-- uzavřel i starý příchod, kdežto obrazovka ho dál hlásila jako
-- otevřený. Pro Šéfíka to znamenalo, že aplikace na obrazovce něco
-- vytýká, ale nikdy to neohlásí: na Černé Perle visely dva nedokončené
-- příchody a hlídač ohlásil jeden.
--
-- ---------------------------------------------------------------------
-- PROČ PROVOZNÍ DEN
--
-- Noční směna přes půlnoc je JEDEN provozní den (`day_starts_at` 05:00),
-- takže odchod ve 2:15 patří k příchodu ve 22:00 a uzavírá ho. Odchod
-- o tři dny později ale není odchod z té směny — je to nový nepořádek
-- a starý příchod má zůstat otevřený, aby ho někdo doplnil.
--
-- Souvisí to s 20260905010000 (dvojitý příchod): `app.otevreny_prichod`
-- páruje takhle už od začátku. Tohle je ta samá díra z druhé strany
-- a od téhle migrace na ni obojí kouká stejně.
--
-- ---------------------------------------------------------------------
-- CO SE TÍM ZMĚNÍ V DATECH
--
-- Hlídač začne hlásit i příchody, u kterých je odchod z JINÉHO dne —
-- například ten z 31. 8. na Černé Perle. Je to záměr, ne vedlejší
-- účinek: dosud se tiše přeskakovaly. Každý se ohlásí právě jednou,
-- drží to primární klíč v `zapomenute_odchody`.
--
-- Tělo je opsané z NEJNOVĚJŠÍ podoby funkce (20260902100000) a mění se
-- v něm jediná podmínka. Opisovat ze starší verze mě dnes už jednou
-- stálo dvě funkce (viz 20260905010000).
-- =====================================================================


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
          -- Odchod uzavírá příchod jen v TÉMŽE provozním dni.
          and o.business_date = a.business_date
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