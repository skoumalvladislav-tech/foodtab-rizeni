-- =====================================================================
-- Foodtab — vydání rozpisu a upozornění na změnu směn
--
-- Zadání: docs/upozorneni-smeny-zadani.md, rozsah na noc podle
-- docs/nocni-prace-2026-09-01.md (dnes jen kanál „v aplikaci“;
-- e-mail, push ani SMS ne).
--
-- Šéfíkovo rozhodnutí: upozornění odchází AŽ PŘI VYDÁNÍ rozpisu, ne při
-- každé úpravě. Vedoucí přehazuje směny půl hodiny a nikomu to nezvoní;
-- teprve „Vydat rozpis“ je závazek.
--
-- Jak se pozná změna: každá směna si nese STAV PŘI POSLEDNÍM VYDÁNÍ —
-- komu patřila a kdy začínala. Při dalším vydání se porovná dnešek
-- s tím záznamem a z rozdílu vznikne zpráva. Bez toho by se nedalo
-- odlišit „nová směna“ od „posunutý čas“.
--
-- Zrušená směna se NEMAŽE, jen dostane status 'cancelled'. Kdyby se
-- smazala, zmizel by s ní i záznam o tom, že byla vydaná, a člověk by
-- se nedozvěděl, že už nikam nemusí.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STAV PŘI POSLEDNÍM VYDÁNÍ
--
-- Prázdné `published_at` znamená „tahle směna ještě nebyla vydaná“ —
-- tedy rozpracovaná. Není to zvláštní sloupec se stavem rozpisu:
-- rozpis jako celek žádný řádek nemá a nemusí mít, stav se pozná
-- z jednotlivých směn.
-- ---------------------------------------------------------------------

alter table public.shifts
  add column if not exists published_at          timestamptz,
  add column if not exists published_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists published_starts_at   time,
  add column if not exists published_ends_at     time,
  add column if not exists published_status      text;

comment on column public.shifts.published_at is
  'Kdy byla směna naposled vydaná. Prázdné = rozpis se ještě připravuje.';


-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ
--
-- Osobní údaj (oddíl 6 zadání): každý vidí jen svoje, i majitel jen
-- svoje. Rozpis konkrétního člověka je stejně citlivý jako docházka.
--
-- Tělo se ukládá jako jsonb, ne jako hotová věta. Text se skloňuje
-- a formátuje až na obrazovce — kdyby se ukládal hotový, nešel by
-- později přeložit ani opravit u starých zpráv.
-- ---------------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete set null,
  druh       text not null,
  -- Co se stalo. U rozpisu: období a seznam změn po směnách.
  telo       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_uzivatel
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_neprectene
  on public.notifications (user_id) where read_at is null;

comment on table public.notifications is
  'Upozornění v aplikaci. Jediný kanál, který nemůže selhat — proto se '
  'nedá vypnout. Je to záznam, ne oznámení.';

grant select, update on public.notifications to authenticated;

alter table public.notifications enable row level security;

-- Každý jen svoje. Ani majitel nevidí cizí upozornění — dozvěděl by se
-- z nich, kdo kdy dělá, což je přesně to, co pravidlo 4 hlídá.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Měnit se dá jedině přečtenost, a to jen u vlastních.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Zapisuje jedině průzor při vydání rozpisu. Přímý zápis by znamenal,
-- že si kdokoli pošle komukoli cokoli.
revoke insert, delete on public.notifications from authenticated;


-- ---------------------------------------------------------------------
-- CO BY VYDÁNÍ UDĚLALO
--
-- Náhled i vlastní vydání počítají rozdíl TOUTOU JEDNOU funkcí. Jinak
-- by náhled mohl slíbit něco jiného, než co se pak rozešle — a rozeslané
-- zprávy se nedají vzít zpět.
--
-- Vrací jeden řádek na směnu, která se změnila, plus komu to patří.
-- Nezměněné směny se nevracejí vůbec: kdo nemá žádnou změnu, nedostane
-- žádnou zprávu.
-- ---------------------------------------------------------------------

create or replace function app.rozdil_rozpisu(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  shift_id    uuid,
  employee_id uuid,
  user_id     uuid,
  zmena       text,
  shift_date  date,
  starts_at   time,
  ends_at     time,
  drive_od    time,
  drive_do    time
)
language sql stable security definer set search_path = ''
as $$
  -- Nové a změněné: bere se dnešní stav a porovnává se s vydaným.
  select
    s.id,
    s.employee_id,
    e.user_id,
    case
      when s.status = 'cancelled'                                 then 'zrusena'
      when s.published_at is null                                 then 'nova'
      -- Byla zrušená a je zase zpátky. Pro člověka je to nová směna:
      -- naposled se dozvěděl, že nikam nemusí.
      when s.published_status = 'cancelled'                       then 'nova'
      when s.published_employee_id is distinct from s.employee_id then 'prevzata'
      when s.published_starts_at is distinct from s.starts_at
        or s.published_ends_at is distinct from s.ends_at         then 'cas'
      else null
    end,
    s.shift_date,
    s.starts_at,
    s.ends_at,
    s.published_starts_at,
    s.published_ends_at
  from public.shifts s
  join public.employees e on e.id = s.employee_id
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and e.user_id is not null
    and e.deleted_at is null
    -- Nevydaná zrušená směna nikoho nezajímá: nikdy o ní nevěděl.
    and not (s.published_at is null and s.status = 'cancelled')
    -- Zrušení se hlásí JEDNOU. Bez tohohle by každé další vydání
    -- ohlásilo tutéž zrušenou směnu znovu a „vydání beze změn nerozešle
    -- nic“ by přestalo platit u každé pobočky, kde se kdy něco zrušilo.
    and not (s.status = 'cancelled' and s.published_status = 'cancelled')
    and (
      s.published_at is null
      or s.status = 'cancelled'
      or s.published_status = 'cancelled'
      or s.published_employee_id is distinct from s.employee_id
      or s.published_starts_at is distinct from s.starts_at
      or s.published_ends_at is distinct from s.ends_at
    )

  union all

  -- Komu směnu vzali. Ten se to jinak nedozví: jeho jméno už na směně
  -- není, takže by v dotazu výš nikde nefiguroval.
  select
    s.id,
    s.published_employee_id,
    e.user_id,
    'odebrana',
    s.shift_date,
    s.starts_at,
    s.ends_at,
    s.published_starts_at,
    s.published_ends_at
  from public.shifts s
  join public.employees e on e.id = s.published_employee_id
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and s.published_at is not null
    and s.published_employee_id is not null
    and s.published_employee_id is distinct from s.employee_id
    and e.user_id is not null
    and e.deleted_at is null;
$$;

revoke all on function app.rozdil_rozpisu(uuid, uuid, date, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- NÁHLED
--
-- „Odejde 6 zpráv 4 lidem.“ Vydání rozešle zprávy a to se nedá vzít
-- zpět, takže se to napřed ukáže — stejně jako u nahrávání z tabulky.
--
-- Ten, kdo vydává, do počtu nepatří: o svých změnách ví.
-- ---------------------------------------------------------------------

create or replace function public.rozpis_nahled(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  user_id  uuid,
  jmeno    text,
  zmena    text,
  pocet    integer
)
language sql stable security definer set search_path = ''
as $$
  select r.user_id, e.full_name, r.zmena, count(*)::integer
  from app.rozdil_rozpisu(p_tenant, p_branch, p_od, p_do) r
  join public.employees e on e.id = r.employee_id
  where app.has_access(p_tenant, 'shifts.manage', p_branch)
    and r.zmena is not null
    and r.user_id <> (select auth.uid())
  group by r.user_id, e.full_name, r.zmena;
$$;

comment on function public.rozpis_nahled(uuid, uuid, date, date) is
  'Co by vydání rozeslalo. Počítá se týmž rozdílem jako vlastní vydání, '
  'aby náhled neslíbil něco jiného, než co se stane.';

revoke all on function public.rozpis_nahled(uuid, uuid, date, date) from public, anon;
grant execute on function public.rozpis_nahled(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- VYDÁNÍ
--
-- Jedna zpráva na člověka, ne jedna na směnu. Kdo má tři změny, dostane
-- jednu zprávu se třemi řádky — ne tři zprávy.
--
-- A jen jeho směny: v těle je výhradně to, co se týká příjemce. Nikdo se
-- z upozornění nedozví, kdy dělá kolega (pravidlo 4).
-- ---------------------------------------------------------------------

create or replace function public.vydat_rozpis(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zprav  integer := 0;
  v_radek  record;
begin
  if not app.has_access(p_tenant, 'shifts.manage', p_branch) then
    raise exception 'Vydat rozpis smí jen ten, kdo plánuje směny na téhle pobočce.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_do < p_od then
    raise exception 'Období je obráceně.' using errcode = 'check_violation';
  end if;

  -- Zprávy se skládají po lidech z rozdílu, který se ještě nezapsal.
  for v_radek in
    select
      r.user_id,
      jsonb_agg(jsonb_build_object(
        'den',    r.shift_date,
        'zmena',  r.zmena,
        'od',     r.starts_at,
        'do',     r.ends_at,
        'drive_od', r.drive_od,
        'drive_do', r.drive_do
      ) order by r.shift_date) as polozky
    from app.rozdil_rozpisu(p_tenant, p_branch, p_od, p_do) r
    where r.zmena is not null
      and r.user_id <> (select auth.uid())
    group by r.user_id
  loop
    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      p_tenant,
      v_radek.user_id,
      p_branch,
      'rozpis.vydan',
      jsonb_build_object('od', p_od, 'do', p_do, 'zmeny', v_radek.polozky)
    );
    v_zprav := v_zprav + 1;
  end loop;

  -- Teprve teď se dnešek stane „vydaným stavem“. Kdyby se to udělalo
  -- dřív, rozdíl by vyšel prázdný a nikomu by nic nepřišlo.
  update public.shifts s
     set published_at          = now(),
         published_employee_id = s.employee_id,
         published_starts_at   = s.starts_at,
         published_ends_at     = s.ends_at,
         published_status      = s.status
   where s.tenant_id = p_tenant
     and s.branch_id = p_branch
     and s.shift_date between p_od and p_do;

  perform app.audit(
    p_tenant, 'rozpis.vydan', 'shift_publication', null, p_branch,
    null,
    jsonb_build_object('od', p_od, 'do', p_do, 'zprav', v_zprav)
  );

  return v_zprav;
end;
$$;

comment on function public.vydat_rozpis(uuid, uuid, date, date) is
  'Vydá rozpis pobočky za období a rozešle upozornění. Jedna zpráva na '
  'člověka, jen jeho směny, a tomu, kdo vydává, nechodí nic.';

revoke all on function public.vydat_rozpis(uuid, uuid, date, date) from public, anon;
grant execute on function public.vydat_rozpis(uuid, uuid, date, date) to authenticated;
