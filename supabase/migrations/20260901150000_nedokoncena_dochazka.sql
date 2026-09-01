-- =====================================================================
-- Foodtab — nedokončená docházka musí být vidět
--
-- Nález z kontroly 1. 9. 2026 (docs/opravy-po-kontrole-2026-09-01.md,
-- bod 2): obrazovka tvrdila „Jste v práci · od 21:42“ a hned pod tím
-- 0 h 0 min, 0 Kč. Příchod z minulého večera neměl odchod, takže se
-- nespároval a do výdělku se nepromítl.
--
-- Do součtu se nezapočítával správně — otevřený příchod propadá už ve
-- výpočtu mzdy. Chybělo, že to NENÍ VIDĚT. Tichá nula je horší než
-- chyba: součet vypadá věrohodně a nikdo se nedozví, že se něco
-- nezapočítalo.
--
-- ROZHODNUTÍ ŠÉFÍKA (1. 9.): aplikace záznam NIKDY nezavírá sama.
-- Žádné dopočítání do konce provozního dne ani po dvanácti hodinách —
-- z vymyšleného času odchodu by se počítala mzda. Zůstane otevřený
-- a hlásí se, dokud ho někdo s právem na docházku neopraví.
--
-- Tahle migrace proto nic neopravuje ani nedopočítává. Jen umí říct,
-- které záznamy jsou otevřené.
-- =====================================================================


-- ---------------------------------------------------------------------
-- OTEVŘENÉ ZÁZNAMY
--
-- „Otevřený“ = v tom provozním dni je poslední událost něco jiného než
-- odchod. Je to totéž pravidlo, podle kterého se na Docházce rozhoduje
-- „jste v práci“, takže se obrazovka a tenhle průzor nemůžou rozejít.
--
-- Rozsah: vlastní záznamy vidí každý (i bez attendance.read, stejně
-- jako vlastní docházku), cizí jen s attendance.read na té pobočce.
-- Je to táž úvaha jako v politice attendance_read.
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
  with posledni as (
    select distinct on (a.employee_id, a.business_date, a.branch_id)
      a.employee_id, a.business_date, a.branch_id, a.kind, a.occurred_at
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.business_date between p_od and p_do
      and (p_branch is null or a.branch_id = p_branch)
    order by a.employee_id, a.business_date, a.branch_id, a.occurred_at desc
  ),
  prichod as (
    select a.employee_id, a.business_date, a.branch_id, min(a.occurred_at) as zacatek
    from public.attendance_events a
    where a.tenant_id = p_tenant
      and a.business_date between p_od and p_do
      and a.kind = 'in'
      and (p_branch is null or a.branch_id = p_branch)
    group by a.employee_id, a.business_date, a.branch_id
  )
  select
    p.employee_id,
    e.full_name,
    p.branch_id,
    p.business_date,
    pr.zacatek,
    p.kind,
    e.user_id = (select auth.uid())
  from posledni p
  join prichod pr
    on pr.employee_id = p.employee_id
   and pr.business_date = p.business_date
   and pr.branch_id = p.branch_id
  join public.employees e on e.id = p.employee_id
  where p.kind <> 'out'
    and (
      e.user_id = (select auth.uid())
      or app.can_read_scoped(p_tenant, 'attendance.read', p.branch_id)
    )
  order by p.business_date desc, e.full_name;
$$;

comment on function public.nedokoncena_dochazka(uuid, date, date, uuid) is
  'Příchody bez odchodu. Aplikace je nikdy nezavírá sama — z vymyšleného '
  'času odchodu by se počítala mzda. Jen se musí vědět, že tam jsou.';

revoke all on function public.nedokoncena_dochazka(uuid, date, date, uuid) from public, anon;
grant execute on function public.nedokoncena_dochazka(uuid, date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- KDO MÁ NA POBOČCE SMĚNU
--
-- Nález bod 1: ruční zápis nabízel jen lidi s domovskou pobočkou, takže
-- ten, kdo na cizí pobočce zaskakuje a zapomene telefon — nejčastější
-- případ ze všech — v nabídce nebyl.
--
-- Nabídka se proto skládá ze dvou zdrojů: kdo tam patří a kdo tam má
-- směnu. Okno je týden zpátky a týden dopředu; ruční zápis se dělá
-- k něčemu, co se právě stalo nebo se stane.
--
-- Je to podruhé, co ta nabídka vznikla ze špatného zdroje (poprvé se
-- brala z dnešních událostí). Proto je to teď dotaz v databázi, ne
-- skládanka na obrazovce — ať se to dá zkontrolovat scénářem.
-- ---------------------------------------------------------------------

create or replace function public.lide_pro_pobocku(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (employee_id uuid, jmeno text, domovska boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.full_name, e.branch_id is not distinct from p_branch
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and app.has_access(p_tenant, 'attendance.manage', p_branch)
    and (
      e.branch_id = p_branch
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id
          and s.branch_id = p_branch
          and s.shift_date between p_od and p_do
          and s.status <> 'cancelled'
      )
    )
  order by e.full_name;
$$;

comment on function public.lide_pro_pobocku(uuid, uuid, date, date) is
  'Koho jde na pobočce ručně zapsat: kdo tam patří PLUS kdo tam má '
  'směnu. Zaskakující člověk je přesně ten, kvůli komu ruční zápis je.';

revoke all on function public.lide_pro_pobocku(uuid, uuid, date, date) from public, anon;
grant execute on function public.lide_pro_pobocku(uuid, uuid, date, date) to authenticated;
