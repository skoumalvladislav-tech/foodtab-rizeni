-- =====================================================================
-- Foodtab — panel nedokončených ukazuje OTEVŘENÝ příchod
--
-- Nález: docs/nesedi-hodiny-po-rucnim-odchodu.md, bod A.
--
-- ---------------------------------------------------------------------
-- CO SE DĚLO
--
-- `nedokoncena_dochazka` brala jako `zacatek` NEJSTARŠÍ příchod dne:
--
--     min(a.occurred_at) filter (where a.kind = 'in')
--
-- 31. srpna to znamenalo tohle: člověk si píchl v 13:27 a o devatenáct
-- vteřin později se odpíchl; večer píchal ještě několikrát a poslední
-- příchod ve 21:42:59 zůstal otevřený. Panel ohlásil „příchod ve 13:27,
-- odchod chybí“ — a Šéfík podle toho dopsal odchod ve 22:00 v domnění,
-- že uzavírá desetihodinovou směnu. Uzavřel dvouhodinovou.
--
-- Obrazovka mu řekla nepravdivý údaj ve chvíli, kdy se podle něj
-- rozhodoval o mzdě. To je horší než chybějící údaj: chybějící se
-- dohledá, nepravdivý se použije.
--
-- ---------------------------------------------------------------------
-- CO JE OTEVŘENÝ PŘÍCHOD
--
-- Poslední `in`, po kterém už NEPŘIŠEL žádný `out`. Ne nejstarší, ne
-- poslední v pořadí — ten, který se doplněním odchodu opravdu uzavře.
--
-- ---------------------------------------------------------------------
-- ODCHYLKA, KTEROU JE POTŘEBA VIDĚT
--
-- Když otevřený příchod NEEXISTUJE, ale poslední událost dne přesto
-- není odchod (třeba `in`, `out`, `break_start`), řádek se nově
-- v panelu NEOBJEVÍ. Dřív se objevil a tvrdil „odchod chybí“, i když
-- odchod byl. Doplnit se tam nedá nic — a věta, která k tomu vyzývá,
-- je zase jen nepravdivý údaj.
-- =====================================================================

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
  with udalosti as (
    select
      a.employee_id,
      a.business_date,
      a.branch_id,
      a.kind,
      a.occurred_at,
      /*
        Kolik odchodů přišlo po téhle události. Příchod, u kterého je
        to nula, je ten otevřený — a jen o něj tady jde.
      */
      (
        select count(*)
        from public.attendance_events o
        where o.employee_id   = a.employee_id
          and o.business_date = a.business_date
          and o.kind          = 'out'
          and o.occurred_at   > a.occurred_at
          and o.stornovano_kdy is null
      ) as odchodu_po
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.business_date between p_od and p_do
      and a.stornovano_kdy is null
  ),
  dny as (
    select
      u.employee_id,
      u.business_date,
      array_agg(distinct u.branch_id)                          as pobocky,
      max(u.occurred_at) filter (
        where u.kind = 'in' and u.odchodu_po = 0
      )                                                        as zacatek,
      (array_agg(u.kind      order by u.occurred_at desc))[1]  as posledni_druh,
      (array_agg(u.branch_id order by u.occurred_at desc))[1]  as posledni_pobocka
    from udalosti u
    group by u.employee_id, u.business_date
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
    -- Bez otevřeného příchodu není co uzavřít. Viz odchylka v hlavičce.
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
  'Příchody bez odchodu. `zacatek` je OTEVŘENÝ příchod — poslední, po '
  'kterém nepřišel odchod —, ne nejstarší příchod dne. Seskupeno po '
  'člověku a provozním dni, ne po pobočkách.';

revoke all on function public.nedokoncena_dochazka(uuid, date, date, uuid) from public, anon;
grant execute on function public.nedokoncena_dochazka(uuid, date, date, uuid) to authenticated;
