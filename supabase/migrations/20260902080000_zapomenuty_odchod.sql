-- =====================================================================
-- Foodtab — upozornění na zapomenutý odchod
--
-- Zadání: docs/zapomenuty-odchod-zadani.md.
--
--   Kdy se to pozná   příchod bez odchodu starší než 20 hodin
--   Kdy se to ozve    druhý den v 9:00, ne ve chvíli, kdy hranice padne
--   Komu              zaměstnanci a každému s attendance.manage té pobočky
--   Jak často         JEDNOU ZA ZÁZNAM, ne každé ráno
--
-- Dvacet hodin a devátá jsou Šéfíkovo dnešní rozhodnutí, ne zákon
-- přírody — patří do nastavení firmy, ne do kódu (pravidlo 1).
-- =====================================================================


-- ---------------------------------------------------------------------
-- NASTAVENÍ
-- ---------------------------------------------------------------------

alter table public.tenant_settings
  add column if not exists zapomenuty_odchod_hodin integer not null default 20,
  add column if not exists zapomenuty_odchod_kdy   time    not null default '09:00';

comment on column public.tenant_settings.zapomenuty_odchod_hodin is
  'Po kolika hodinách bez odchodu se o příchodu ozveme. Výchozí 20.';
comment on column public.tenant_settings.zapomenuty_odchod_kdy is
  'V kolik se to ozve, místního času. Výchozí 9:00.';

alter table public.tenant_settings
  drop constraint if exists tenant_settings_zapomenuty_hodin_rozsah;
alter table public.tenant_settings
  add constraint tenant_settings_zapomenuty_hodin_rozsah
  check (zapomenuty_odchod_hodin between 1 and 168);

grant select (
  tenant_id, zalohy_zobrazeni, zaloha_max_haleru, zalohy_pozastaveny,
  ranni_email_kdy, zapomenuty_odchod_hodin, zapomenuty_odchod_kdy,
  updated_at, updated_by
) on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- CO UŽ SE OHLÁSILO
--
-- Ozve se JEDNOU ZA ZÁZNAM. Kdyby to chodilo denně, za týden si toho
-- nikdo nevšimne — a to je horší než neposílat nic.
--
-- Klíčem je samotná událost, takže dvojí spuštění úlohy druhé
-- upozornění vyrobit NEMŮŽE. Není to příznak, na který se dá zapomenout
-- — je to primární klíč.
--
-- DOPLNĚNÝ ODCHOD TENHLE ZÁZNAM NEMAŽE. Kdyby ho mazal a člověk by si
-- odchod zase smazal, přišlo by upozornění znovu a vypadalo by to jako
-- chyba.
-- ---------------------------------------------------------------------

create table if not exists public.zapomenute_odchody (
  attendance_id uuid primary key
    references public.attendance_events(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ohlaseno_kdy  timestamptz not null default now()
);

comment on table public.zapomenute_odchody is
  'O kterých příchodech bez odchodu se už hlásilo. Primární klíč je '
  'samotná událost — dvojí spuštění úlohy druhé upozornění nevyrobí.';

alter table public.zapomenute_odchody enable row level security;

-- Nikdo to nečte ani nezapisuje přes aplikaci. Je to poznámka úlohy.
revoke all on public.zapomenute_odchody from authenticated, anon;


-- ---------------------------------------------------------------------
-- KDO MÁ PRÁVO NA TÉHLE POBOČCE
--
-- `app.kdo_ma_pravo` rozsah neřeší. U docházky ho řešit musíme: vedoucí
-- Černé Perly nemá dostávat zprávy o Bernard Baru.
-- ---------------------------------------------------------------------

create or replace function app.kdo_ma_pravo_na_pobocce(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid
)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id
  from public.memberships m
  join public.roles r           on r.id = m.role_id
  join public.permissions p     on p.key = p_permission
  join public.tenant_modules tm on tm.tenant_id = m.tenant_id
                               and tm.module_key = p.module_key
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now())
    and (
      r.is_owner
      or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = p_permission
      )
    )
    and (
      m.scope = 'tenant'
      or exists (
        select 1 from public.membership_branches mb
        where mb.membership_id = m.id and mb.branch_id = p_branch
      )
    );
$$;

comment on function app.kdo_ma_pravo_na_pobocce(uuid, text, uuid) is
  'Kdo má dané právo na téhle pobočce. Podle práva, ne podle názvu role.';

revoke all on function app.kdo_ma_pravo_na_pobocce(uuid, text, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SAMA ÚLOHA
--
-- Jedna funkce, která udělá všechnu práci. Kdo ji spouští, je věc
-- hostingu — až se přestěhujeme z Vercelu jinam, mění se jen to, kdo
-- tu adresu volá, ne co dělá.
--
-- ---------------------------------------------------------------------
-- HODINA SE ŘEŠÍ TADY, STÁŘÍ TAKY
--
-- Plánovač smí běžet klidně každou hodinu. Firma se ozve, až je
-- MÍSTNÍHO ČASU aspoň tolik, kolik má v nastavení — a protože se každý
-- záznam ohlásí jen jednou, opakované běhy nic nezkazí.
--
-- Z toho plyne i odpověď na zmeškané spuštění: když plánovač v 9:00
-- neběžel, běh v 11:00 doběhne normálně. Hledá se podle STÁŘÍ PŘÍCHODU,
-- ne podle toho, kolik je hodin.
--
-- Časové pásmo je napevno Europe/Prague. Kdyby se plánovač nastavil
-- v UTC, ozvalo by se v zimě v 10:00 a v létě v 9:00 — proto se
-- porovnává místní čas tady, ne venku.
--
-- ---------------------------------------------------------------------
-- CO SE NEPOSÍLÁ
--
-- Žádná mzda, sazba ani částka. Chybějící odchod je provozní věc, ne
-- mzdová — a v těle upozornění není nic, z čeho by šlo peníze odvodit.
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
      a.id,
      a.tenant_id,
      a.branch_id,
      a.employee_id,
      a.business_date,
      a.occurred_at,
      e.full_name  as jmeno,
      e.user_id    as ucet,
      b.name       as pobocka,
      b.slug       as pobocka_slug
    from public.attendance_events a
    join public.employees e on e.id = a.employee_id
    join public.branches  b on b.id = a.branch_id
    left join public.tenant_settings s on s.tenant_id = a.tenant_id
    where a.kind = 'in'
      and e.deleted_at is null
      -- Starší než hranice z nastavení firmy.
      and a.occurred_at < now()
          - make_interval(hours => coalesce(s.zapomenuty_odchod_hodin, 20))
      -- Místního času je aspoň tolik, kolik si firma nastavila.
      and (now() at time zone 'Europe/Prague')::time
          >= coalesce(s.zapomenuty_odchod_kdy, time '09:00')
      -- Odchod nepřišel NIKDE. Pobočka se neřeší: kdo přišel na jedné
      -- a odešel na druhé, odchod má (viz 20260902060000).
      and not exists (
        select 1 from public.attendance_events o
        where o.employee_id = a.employee_id
          and o.kind = 'out'
          and o.occurred_at > a.occurred_at
      )
      -- A ještě se o něm nehlásilo.
      and not exists (
        select 1 from public.zapomenute_odchody z where z.attendance_id = a.id
      )
  loop
    /*
      Poznámka NEJDŘÍV. Kdyby se zapisovala až po upozorněních a mezitím
      něco spadlo, druhý běh by je poslal znovu.

      `on conflict do nothing` je druhá pojistka pro dva běhy vedle
      sebe: kdo prohraje, ten nic neposílá.
    */
    insert into public.zapomenute_odchody (attendance_id, tenant_id)
    values (v_zaznam.id, v_zaznam.tenant_id)
    on conflict (attendance_id) do nothing;

    if not found then
      continue;
    end if;

    -- Zaměstnanci, POKUD MÁ ÚČET. Brigádník bez účtu upozornění dostat
    -- nemůže — tím spíš musí přijít vedoucímu, viz níž.
    if v_zaznam.ucet is not null then
      insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
      values (
        v_zaznam.tenant_id, v_zaznam.ucet, v_zaznam.branch_id,
        'dochazka.zapomenuty_odchod',
        jsonb_build_object(
          'moje',         true,
          'jmeno',        v_zaznam.jmeno,
          'zamestnanec',  v_zaznam.employee_id,
          'den',          v_zaznam.business_date,
          'prichod',      to_char(v_zaznam.occurred_at at time zone 'Europe/Prague', 'HH24:MI'),
          'pobocka',      v_zaznam.pobocka,
          'pobocka_slug', v_zaznam.pobocka_slug
        )
      );
    end if;

    -- A tomu, kdo docházku na té pobočce spravuje.
    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    select
      v_zaznam.tenant_id, k.user_id, v_zaznam.branch_id,
      'dochazka.zapomenuty_odchod',
      jsonb_build_object(
        'moje',         false,
        'jmeno',        v_zaznam.jmeno,
        'zamestnanec',  v_zaznam.employee_id,
        'den',          v_zaznam.business_date,
        'prichod',      to_char(v_zaznam.occurred_at at time zone 'Europe/Prague', 'HH24:MI'),
        'pobocka',      v_zaznam.pobocka,
        'pobocka_slug', v_zaznam.pobocka_slug
      )
    from app.kdo_ma_pravo_na_pobocce(
      v_zaznam.tenant_id, 'attendance.manage', v_zaznam.branch_id
    ) k
    -- Sám sobě dvakrát ne: vedoucí, který zapomněl odchod, dostane
    -- svoje upozornění výš.
    where k.user_id is distinct from v_zaznam.ucet;

    v_pocet := v_pocet + 1;
  end loop;

  return v_pocet;
end;
$$;

comment on function public.ohlasit_zapomenute_odchody() is
  'Naplánovaná úloha: příchody bez odchodu starší než hranice firmy. '
  'Jednou za záznam. Bez mzdy, sazby a částky — je to provozní věc.';

/*
  Spouští ji SERVER se service_role, ne prohlížeč. Klíč service_role se
  do prohlížeče nedostane nikdy (pravidlo 6), takže tuhle úlohu nikdo
  zvenčí nevyvolá.

  Kdyby přece — nic zlého by se nestalo: funkce se řídí hodinou
  z nastavení a každý záznam ohlásí jen jednou. Ale nemá se to dát
  vyzkoušet.
*/
revoke all on function public.ohlasit_zapomenute_odchody()
  from public, anon, authenticated;
grant execute on function public.ohlasit_zapomenute_odchody() to service_role;


-- ---------------------------------------------------------------------
-- NASTAVENÍ ZE STRÁNKY FIRMY
--
-- Průzor, ať se do `tenant_settings` nezapisuje přímo. Měnit smí jen
-- kdo spravuje nastavení, a jde do auditu jako všechno ostatní.
-- ---------------------------------------------------------------------

create or replace function public.nastavit_zapomenuty_odchod(
  p_tenant uuid,
  p_hodin  integer,
  p_kdy    time
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_drive jsonb;
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení firmy mění jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_hodin is null or p_hodin < 1 or p_hodin > 168 then
    raise exception 'Hranice musí být mezi 1 a 168 hodinami.'
      using errcode = 'check_violation';
  end if;
  if p_kdy is null then
    raise exception 'Vyplňte, v kolik se má ozvat.' using errcode = 'check_violation';
  end if;

  select jsonb_build_object(
           'hodin', s.zapomenuty_odchod_hodin,
           'kdy',   s.zapomenuty_odchod_kdy
         )
    into v_drive
  from public.tenant_settings s where s.tenant_id = p_tenant;

  insert into public.tenant_settings (tenant_id, zapomenuty_odchod_hodin, zapomenuty_odchod_kdy)
  values (p_tenant, p_hodin, p_kdy)
  on conflict (tenant_id) do update
    set zapomenuty_odchod_hodin = excluded.zapomenuty_odchod_hodin,
        zapomenuty_odchod_kdy   = excluded.zapomenuty_odchod_kdy;

  -- Pojmenované argumenty: mezi id a 'before' je v app.audit ještě
  -- pobočka. Poziční zápis se do ní strefil a spadl na typu.
  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'settings.zapomenuty_odchod',
    p_entity_type => 'tenant_settings',
    p_entity_id   => p_tenant::text,
    p_before      => v_drive,
    p_after       => jsonb_build_object('hodin', p_hodin, 'kdy', p_kdy)
  );
end;
$$;

comment on function public.nastavit_zapomenuty_odchod(uuid, integer, time) is
  'Hranice a hodina pro upozornění na zapomenutý odchod. Není to zákon '
  'přírody — patří do nastavení firmy, ne do kódu.';

revoke all on function public.nastavit_zapomenuty_odchod(uuid, integer, time)
  from public, anon;
grant execute on function public.nastavit_zapomenuty_odchod(uuid, integer, time)
  to authenticated;
