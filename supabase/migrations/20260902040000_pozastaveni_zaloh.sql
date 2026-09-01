-- =====================================================================
-- Foodtab — pozastavení výplaty záloh
--
-- Zadání: docs/pozastaveni-zaloh-zadani.md.
--
-- Záloha je dobrovolnost zaměstnavatele, ne nárok. Když si někdo bere
-- zálohy tak často, že z výplaty nezbývá, musí to jít zastavit — a musí
-- to jít zastavit U TOHO ČLOVĚKA, ne u všech.
--
-- ---------------------------------------------------------------------
-- POZASTAVENÍ ODMÍTÁ, NEVARUJE
--
-- U horní meze stačí varování, protože je to odhad. Tohle je vědomé
-- rozhodnutí o konkrétním člověku a má platit. Kdyby šlo jen o hlášku,
-- kterou lze odkliknout, přestane pozastavení znamenat cokoli a nikdo
-- nebude vědět, kdy platí.
--
-- ---------------------------------------------------------------------
-- KDO SMÍ PŘEPNOUT: JEN `payroll.manage`
--
-- Schválně NE `advances.manage`. Kdo zálohy vyplácí u okénka, si
-- pozastavení sám nezruší; jinak by stačilo dvakrát kliknout a celé
-- opatření je k ničemu. Je to stejná úvaha jako u oddělení „vydávat
-- peníze“ od „vidět mzdy“: kdo vykonává, nerozhoduje.
--
-- ---------------------------------------------------------------------
-- CO SE NESMÍ POKAZIT
--
--   * historie zůstává — dřív vyplacené zálohy se nemění ani nemizí
--     ze součtů;
--   * výdělek se počítá dál stejně, pozastavené jsou jen NOVÉ výplaty;
--   * storno projde i u pozastaveného člověka, jinak by se špatně
--     zadaná záloha nedala opravit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- DVĚ ÚROVNĚ
--
-- Platí PŘÍSNĚJŠÍ z obou: když je vypnuto za firmu, neprojde nikomu
-- nic, i kdyby jednotlivec pozastavené neměl.
-- ---------------------------------------------------------------------

alter table public.employees
  add column if not exists zalohy_pozastaveny boolean not null default false;

comment on column public.employees.zalohy_pozastaveny is
  'Pozastavené zálohy u tohohle člověka. Odmítá, nevaruje. Přepíná jen '
  'payroll.manage — kdo zálohy vyplácí, si to sám nezruší.';

alter table public.tenant_settings
  add column if not exists zalohy_pozastaveny boolean not null default false;

comment on column public.tenant_settings.zalohy_pozastaveny is
  'Pozastavené zálohy za celou firmu. Platí přísnější z obou úrovní.';

grant select (
  tenant_id, zalohy_zobrazeni, zaloha_max_haleru, zalohy_pozastaveny,
  ranni_email_kdy, updated_at, updated_by
) on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- JSOU POZASTAVENÉ?
--
-- Jedno místo, kde se skládá přísnější ze dvou úrovní. Kdyby se to
-- počítalo na dvou místech (při výplatě a na obrazovce zaměstnance),
-- dřív nebo později by jedno z nich zapomnělo na firemní vypínač.
-- ---------------------------------------------------------------------

create or replace function app.zalohy_pozastavene(p_tenant uuid, p_employee uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select s.zalohy_pozastaveny from app.nastaveni(p_tenant) s), false)
    or coalesce((
      select e.zalohy_pozastaveny from public.employees e
      where e.id = p_employee and e.tenant_id = p_tenant
    ), false);
$$;

revoke all on function app.zalohy_pozastavene(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- PŘEPNUTÍ
--
-- `p_employee = null` znamená celou firmu. Do auditu jde OBĚMA SMĚRY:
-- u peněz musí být dohledatelné i to, že se něco povolilo zpátky.
-- ---------------------------------------------------------------------

create or replace function public.pozastavit_zalohy(
  p_tenant    uuid,
  p_employee  uuid,
  p_pozastavit boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni boolean;
  v_branch  uuid;
begin
  if not app.has_access(p_tenant, 'payroll.manage') then
    raise exception
      'Pozastavit zálohy smí jen ten, kdo spravuje mzdy. Kdo je vyplácí, si to sám nezruší.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_employee is null then
    select s.zalohy_pozastaveny into v_puvodni from app.nastaveni(p_tenant) s;

    insert into public.tenant_settings (tenant_id, zalohy_pozastaveny, updated_at, updated_by)
    values (p_tenant, coalesce(p_pozastavit, false), now(), (select auth.uid()))
    on conflict (tenant_id) do update
      set zalohy_pozastaveny = excluded.zalohy_pozastaveny,
          updated_at = now(),
          updated_by = excluded.updated_by;

    perform app.audit(p_tenant, 'advance.pozastaveni', 'tenant', p_tenant::text, null,
                      jsonb_build_object('pozastaveno', v_puvodni),
                      jsonb_build_object('pozastaveno', coalesce(p_pozastavit, false)));
    return;
  end if;

  select e.zalohy_pozastaveny, e.branch_id into v_puvodni, v_branch
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  update public.employees
     set zalohy_pozastaveny = coalesce(p_pozastavit, false)
   where id = p_employee;

  perform app.audit(p_tenant, 'advance.pozastaveni', 'employee', p_employee::text, v_branch,
                    jsonb_build_object('pozastaveno', v_puvodni),
                    jsonb_build_object('pozastaveno', coalesce(p_pozastavit, false)));
end;
$$;

revoke all on function public.pozastavit_zalohy(uuid, uuid, boolean) from public, anon;
grant execute on function public.pozastavit_zalohy(uuid, uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- VÝPLATA POZASTAVENÉMU NEPROJDE
--
-- Přepisuje se celá funkce, protože Postgres neumí do těla přidat
-- řádek jinak. Zbytek se nemění — jen přibyla kontrola hned za tou
-- na oprávnění.
--
-- Hláška musí říct, CO SE STALO A CO S TÍM. Ne „chyba“ a ne mlčení:
-- u okénka stojí člověk, kterému se nedostane na peníze, a obsluha
-- musí vědět, na koho ho poslat.
-- ---------------------------------------------------------------------

create or replace function public.vyplatit_zalohu(
  p_tenant   uuid,
  p_employee uuid,
  p_castka   integer,
  p_poznamka text default ''
)
returns table (
  zaloha         uuid,
  varovani       text,
  vydelano_haleru integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch  uuid;
  v_jmeno   text;
  v_uziv    uuid;
  v_id      uuid;
  v_vydelano integer;
  v_zalohy  integer;
  v_max     integer;
  v_den     date;
  v_varovani text := null;
begin
  select e.branch_id, e.full_name, e.user_id into v_branch, v_jmeno, v_uziv
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  if v_branch is null then
    raise exception 'Záloha se vydává na pobočce a tenhle člověk žádnou nemá.'
      using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'advances.manage', v_branch) then
    raise exception 'Vyplácet zálohy smí jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ODMÍTÁ, NEVARUJE. Viz hlavička.
  if app.zalohy_pozastavene(p_tenant, p_employee) then
    raise exception
      'Tomuhle zaměstnanci jsou zálohy pozastavené. Povolit je může jen ten, kdo spravuje mzdy.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_castka is null or p_castka <= 0 then
    raise exception 'Částka musí být kladná.' using errcode = 'check_violation';
  end if;

  v_den := app.business_date(v_branch, now());

  -- Kolik má za tenhle měsíc odpracováno a kolik už dostal. Slouží
  -- JEN k varování.
  select v.vydelano_haleru into v_vydelano
  from app.earnings(p_employee, date_trunc('month', v_den)::date) v;

  select coalesce(sum(a.castka_haleru), 0)::integer into v_zalohy
  from public.advances a
  where a.employee_id = p_employee
    and a.stav <> 'stornovana'
    and a.business_date >= date_trunc('month', v_den)::date;

  select s.zaloha_max_haleru into v_max from app.nastaveni(p_tenant) s;

  if v_max is not null and p_castka > v_max then
    v_varovani := 'Firma má nastavenou horní mez ' || app.koruny(v_max)
      || ' a vyplácíte ' || app.koruny(p_castka) || '.';
  elsif coalesce(v_vydelano, 0) < v_zalohy + p_castka then
    v_varovani := 'Odpracováno zatím ' || app.koruny(coalesce(v_vydelano, 0))
      || ', po téhle záloze bude vyplaceno ' || app.koruny(v_zalohy + p_castka) || '.';
  end if;

  insert into public.advances
    (tenant_id, branch_id, employee_id, castka_haleru, business_date,
     vyplatil, poznamka)
  values (p_tenant, v_branch, p_employee, p_castka, v_den,
          (select auth.uid()), coalesce(btrim(p_poznamka), ''))
  returning id into v_id;

  perform app.audit(p_tenant, 'advance.vyplaceno', 'advance', v_id::text, v_branch,
                    null, jsonb_build_object('castka_haleru', p_castka,
                                             'varovani', v_varovani));

  if v_uziv is not null then
    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (p_tenant, v_uziv, v_branch, 'zaloha.vyplacena',
            jsonb_build_object('castka_haleru', p_castka, 'zaloha', v_id,
                               'den', v_den));
  end if;

  return query select v_id, v_varovani, coalesce(v_vydelano, 0);
end;
$$;

revoke all on function public.vyplatit_zalohu(uuid, uuid, integer, text) from public, anon;
grant execute on function public.vyplatit_zalohu(uuid, uuid, integer, text) to authenticated;


-- ---------------------------------------------------------------------
-- ZAMĚSTNANEC TO VIDÍ U SEBE
--
-- Proč to vůbec ukazovat: kdo to neví, přijde si k okénku a odmítnutí
-- zjistí před kolegy. Takhle se to dozví sám a jde se zeptat toho, kdo
-- o tom rozhodl.
--
-- Důvod se neuvádí — ten patří do rozhovoru, ne na obrazovku.
-- ---------------------------------------------------------------------

/*
  DROP, ne jen CREATE OR REPLACE.

  Přehledu přibývá sloupec `zalohy_pozastavene`, a tím se mění návratový
  typ. `create or replace` to u funkce vracející tabulku odmítne
  s „cannot change return type of existing function“ — a migrace by
  spadla až při nasazení. Našlo se to zkouškou, ne úvahou.

  Práva se po dropnutí nastavují znovu, hned pod definicí.
*/
drop function if exists public.muj_vyplatni_prehled(uuid, date);

create or replace function public.muj_vyplatni_prehled(p_tenant uuid, p_mesic date)
returns table (
  odpracovano_minut   integer,
  vydelano_haleru     integer,
  zalohy_haleru       integer,
  zbyva_haleru        integer,
  zaloh_nepotvrzenych integer,
  zalohy_pozastavene  boolean,
  zobrazeni           text,
  sazba_chybi         boolean,
  hodinova_haleru     integer,
  dnu_bez_dochazky    integer
)
language sql stable security definer set search_path = ''
as $$
  select
    v.odpracovano_minut,
    v.vydelano_haleru,
    z.soucet,
    v.vydelano_haleru - z.soucet,
    z.nepotvrzenych,
    app.zalohy_pozastavene(p_tenant, e.id),
    (select s.zalohy_zobrazeni from app.nastaveni(p_tenant) s),
    v.sazba_chybi,
    app.rate_at(e.id, app.konec_mesice(p_mesic)),
    v.dnu_bez_dochazky
  from public.employees e
  cross join lateral app.earnings(e.id, p_mesic) v
  cross join lateral (
    select
      coalesce(sum(a.castka_haleru), 0)::integer as soucet,
      coalesce(count(*) filter (where a.stav = 'nepotvrzena'), 0)::integer as nepotvrzenych
    from public.advances a
    where a.employee_id = e.id
      and a.stav <> 'stornovana'
      and a.business_date >= p_mesic
      and a.business_date <= app.konec_mesice(p_mesic)
  ) z
  where e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
    and app.is_member(p_tenant)
  limit 1;
$$;

revoke all on function public.muj_vyplatni_prehled(uuid, date) from public, anon;
grant execute on function public.muj_vyplatni_prehled(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- SEZNAM PRO OBRAZOVKU ZÁLOH
--
-- Aby šlo u člověka přepnout, musí obrazovka vědět, kdo pozastavený je.
-- Vidí to jen ten, kdo zálohy vyplácí nebo dělá mzdy — stejně jako
-- samotné zálohy.
-- ---------------------------------------------------------------------

create or replace function public.stav_pozastaveni(p_tenant uuid)
returns table (employee_id uuid, jmeno text, branch_id uuid, pozastaveno boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.full_name, e.branch_id, e.zalohy_pozastaveny
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and e.branch_id is not null
    and (
      app.can_read_scoped(p_tenant, 'advances.manage', e.branch_id)
      or app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
    )
  order by e.full_name;
$$;

revoke all on function public.stav_pozastaveni(uuid) from public, anon;
grant execute on function public.stav_pozastaveni(uuid) to authenticated;
