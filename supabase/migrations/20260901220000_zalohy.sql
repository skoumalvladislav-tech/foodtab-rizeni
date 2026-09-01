-- =====================================================================
-- Foodtab — zálohy
--
-- Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíly 6 a 7.
--
-- Záloha je ZÁZNAM O HOTOVOSTI, která přešla z ruky do ruky. Není to
-- platba: aplikace nikomu nic neposílá a bankovní napojení zůstává
-- výhradně pro čtení. Účetní dál dělá mzdy ve svém programu — Foodtab
-- jí jen řekne, co se během měsíce vyplatilo.
--
-- ---------------------------------------------------------------------
-- ČTYŘI VĚCI, KTERÉ SE TU DĚLAJÍ JINAK, NEŽ BY SE ČEKALO
--
-- 1. Vlastní právo `advances.manage`, oddělené od `payroll.*`. Vydávat
--    peníze a vidět mzdy jsou dvě různé věci: vedoucí směny u okénka
--    potřebuje vydat dva tisíce, ne vidět, kolik kdo bere.
--
-- 2. Vyšší záloha, než je odpracováno, se JEN OHLÁSÍ. Nikdy neodmítne
--    (rozhodnutí ze 1. 9., oddíl 11 bod 3) — aplikace nerozhoduje
--    o penězích za majitele. Varování se proto vrací jako údaj, ne jako
--    výjimka.
--
-- 3. Záloha se NEMAŽE. Špatně zadaná se stornuje s důvodem; obojí
--    zůstává a obojí je v auditu. Smazaný pohyb peněz je díra
--    v evidenci.
--
-- 4. Nepotvrzená se nezahazuje. Zůstane v seznamu, počítá se do součtů
--    a je vidět zvlášť. Pobočka, kde je polovina záloh nepotvrzená, je
--    informace sama o sobě.
--
-- Částky jsou v HALÉŘÍCH jako integer. Desetinné číslo v penězích je
-- chyba, která se projeví až u součtu za rok.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PRÁVO
--
-- `sensitive = true` není ozdoba: roli s citlivým oprávněním nejde
-- pozvat přes SMS (app.create_invitation). Kdo smí vydávat hotovost,
-- se nesmí dát pozvat na číslo, které koluje po provozovně.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('advances.manage', 'provoz', 'Vyplácet zálohy', true, 94)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;

-- Do šablony Provozní. Ta je definovaná jako „všechno kromě
-- agents.manage a settings.manage“, takže by nové právo mělo být uvnitř
-- — jinak by se šablona tiše rozešla se svým vlastním popisem.
insert into app.role_template_permissions (template_key, permission_key)
values ('provozni', 'advances.manage')
on conflict do nothing;

-- A do rolí, které z té šablony vznikly. Nové právo se do existujících
-- firem samo nedostane; bez tohohle by provozní ve stávající firmě
-- zálohy vyplácet nemohl a nikdo by nevěděl proč.
--
-- Majitel se neřeší: `app.has_access` mu dává všechno z aktivních
-- modulů, aby ho nešlo odebráním práva zamknout z vlastní firmy ven.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'advances.manage'
from public.roles r
where r.key = 'provozni' and not r.is_owner
on conflict do nothing;


-- ---------------------------------------------------------------------
-- NASTAVENÍ FIRMY
--
-- Způsob zobrazení záloh je rozhodnutí ZÁKAZNÍKA, ne kódu (pravidlo 1).
-- Někde se záloha bere jako splátka výplaty, jinde jako záležitost
-- účetní, do které aplikace nemá mluvit.
--
-- Volba mění JEN ZOBRAZENÍ, nikdy uložený záznam. Proto se dá přepnout
-- kdykoli, projeví se hned i zpětně, nic nepřepočítává a nejde pokazit.
--
-- Tabulka je zvlášť, ne sloupce v `tenants`: nastavení bude přibývat
-- (ranní e-mail, meze) a `tenants` je tabulka o identitě firmy.
-- ---------------------------------------------------------------------

create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- odecitat   = všechny čtyři řádky včetně „zbývá k výplatě“
  -- jen_ukazat = odpracováno, hrubá mzda, zálohy — bez odečtu
  -- neukazovat = odpracováno a hrubá mzda; zálohy vidí jen vedení
  zalohy_zobrazeni text not null default 'odecitat'
    check (zalohy_zobrazeni in ('odecitat', 'jen_ukazat', 'neukazovat')),
  -- Horní mez jedné zálohy. Prázdné = firma žádnou nestanovila.
  -- I když stanovená je, jen VARUJE (oddíl 11 bod 3).
  zaloha_max_haleru integer check (zaloha_max_haleru is null or zaloha_max_haleru > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null
);

comment on table public.tenant_settings is
  'Nastavení firmy, které mění chování aplikace. Volba u záloh mění jen '
  'zobrazení, nikdy uložené záznamy — přepnutí proto nic nepřepočítává.';

grant select (tenant_id, zalohy_zobrazeni, zaloha_max_haleru, updated_at, updated_by)
  on public.tenant_settings to authenticated;

alter table public.tenant_settings enable row level security;

-- Číst smí každý ve firmě: podle volby se kreslí obrazovka výdělku
-- a zaměstnanec musí vědět, proč vidí tři řádky místo čtyř.
drop policy if exists tenant_settings_select on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings for select to authenticated
  using (app.is_member(tenant_id));

-- Zapisuje se jedině průzorem — kvůli auditu. Přímý zápis by znamenal
-- změnu, o které se nikdo nedozví.
revoke insert, update, delete on public.tenant_settings from authenticated;

-- Nastavení jako takové existovat nemusí; nepřítomnost řádku znamená
-- výchozí hodnoty. Tahle funkce to sjednocuje, aby se `coalesce`
-- neopisoval na pěti místech.
create or replace function app.nastaveni(p_tenant uuid)
returns public.tenant_settings
language sql stable security definer set search_path = ''
as $$
  /*
    Náhradní řádek se skládá PODLE JMEN sloupců, ne podle pořadí.
    Zápis `(p_tenant, 'odecitat', null, now(), null)::tenant_settings`
    se rozbil ve chvíli, kdy další migrace přidala `ranni_email_kdy`:
    hodnot bylo pět, sloupců šest, a `vyplatit_zalohu` spadla u každé
    firmy, která si nastavení ještě neuložila. Tenhle tvar přežije
    i další sloupec.
  */
  select coalesce(
    (select s from public.tenant_settings s where s.tenant_id = p_tenant),
    jsonb_populate_record(
      null::public.tenant_settings,
      jsonb_build_object(
        'tenant_id',        p_tenant,
        'zalohy_zobrazeni', 'odecitat',
        'updated_at',       now()
      )
    )
  );
$$;

revoke all on function app.nastaveni(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- ZÁLOHY
-- ---------------------------------------------------------------------

create table if not exists public.advances (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete restrict,
  employee_id   uuid not null references public.employees(id) on delete restrict,

  -- Haléře, nikdy desetinné číslo. Kladná částka; nula není záloha.
  castka_haleru integer not null check (castka_haleru > 0),

  -- Provozní den, ne kalendářní (pravidlo 10). Záloha vydaná ve 2:15
  -- patří do včerejší uzávěrky stejně jako účet.
  business_date date not null,

  vyplaceno_kdy timestamptz not null default now(),
  vyplatil      uuid references public.profiles(user_id) on delete set null,
  poznamka      text not null default '',

  -- Potvrzení PINem. Tím se ze záznamu stává doklad, ne tvrzení jednoho
  -- člověka.
  potvrzeno_kdy timestamptz,
  potvrzeno_zarizenim uuid references public.branch_devices(id) on delete set null,

  -- Storno místo mazání. Důvod je povinný, když se stornuje.
  stav          text not null default 'nepotvrzena'
                check (stav in ('nepotvrzena', 'potvrzena', 'stornovana')),
  storno_duvod  text,
  storno_kdy    timestamptz,
  stornoval     uuid references public.profiles(user_id) on delete set null,

  created_at    timestamptz not null default now(),

  constraint advances_storno_ma_duvod check (
    stav <> 'stornovana'
    or (storno_duvod is not null and length(btrim(storno_duvod)) > 0)
  ),
  constraint advances_potvrzena_ma_cas check (
    stav <> 'potvrzena' or potvrzeno_kdy is not null
  )
);

create index if not exists advances_zamestnanec
  on public.advances (employee_id, business_date desc);
create index if not exists advances_pobocka
  on public.advances (branch_id, business_date desc);

comment on table public.advances is
  'Záznam o hotovosti, která přešla z ruky do ruky. Není to platba — '
  'aplikace nikomu nic neposílá. Nemaže se, stornuje.';

comment on column public.advances.stav is
  'nepotvrzena = zaměstnanec ji ještě nepotvrdil PINem. Nezahazuje se: '
  'počítá se do součtů a je vidět zvlášť.';

-- Po sloupcích, ne `on all tables`: kdyby sem někdo přidal sloupec
-- s citlivým obsahem, nedostane se ven sám od sebe.
grant select (
  id, tenant_id, branch_id, employee_id, castka_haleru, business_date,
  vyplaceno_kdy, vyplatil, poznamka, potvrzeno_kdy, potvrzeno_zarizenim,
  stav, storno_duvod, storno_kdy, stornoval, created_at
) on public.advances to authenticated;

alter table public.advances enable row level security;

/*
  Kdo zálohy vidí:
    * svoje každý, bez oprávnění — je to jeho hotovost;
    * cizí ten, kdo je vydává (advances.manage), nebo kdo dělá mzdy
      (payroll.read), a jen na pobočce, na kterou dosáhne (pravidlo 4).
*/
drop policy if exists advances_select on public.advances;
create policy advances_select on public.advances for select to authenticated
  using (
    employee_id in (
      select e.id from public.employees e where e.user_id = (select auth.uid())
    )
    or app.can_read_scoped(tenant_id, 'advances.manage', branch_id)
    or app.can_read_scoped(tenant_id, 'payroll.read', branch_id)
  );

-- Zapisuje se JEDINĚ průzory níž. Přímý zápis by znamenal, že si
-- kdokoli s právem na tabulku dopíše potvrzení cizí zálohy.
revoke insert, update, delete on public.advances from authenticated;

drop trigger if exists trg_audit_zaloh on public.advances;
create trigger trg_audit_zaloh
  after insert or update or delete on public.advances
  for each row execute function app.audit_zmenu('advance');


-- ---------------------------------------------------------------------
-- ČÁSTKA SLOVY DO HLÁŠKY
--
-- Jen do vět pro člověka. Formátování pro obrazovku dělá aplikace.
--
-- Oddělovač tisíců se skládá ručně, ne `to_char(…, 'FM999G999G999')`.
-- Značka `G` bere oddělovač z NASTAVENÍ DATABÁZE, takže by česká věta
-- záležela na tom, s jakým `lc_numeric` server běží — a v C locale
-- z toho vyjde „12,000 Kč“, což v češtině znamená dvanáct celých nula.
-- Našlo se to na zkoušce v PGlite; na Supabase by to vyšlo jinak
-- a nikdo by nevěděl proč.
-- ---------------------------------------------------------------------

create or replace function app.koruny(p_haleru integer)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(
           round(p_haleru / 100.0)::text,
           '(\d)(?=(\d{3})+$)', '\1 ', 'g'
         ) || ' Kč';
$$;

revoke all on function app.koruny(integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- VYPLACENÍ
--
-- Vrací i VAROVÁNÍ. Nezvedá kvůli němu výjimku: rozhodnutí ze 1. 9.
-- říká, že vyšší záloha než odpracováno se jen ohlásí a obsluha může
-- přesto vyplatit. Aplikace nerozhoduje o penězích za majitele.
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

  -- Upozornění zaměstnanci. Kdo účet nemá, se nedozví nic — a to je
  -- v pořádku, hotovost dostal do ruky.
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
-- POTVRZENÍ PINEM NA KIOSKU
--
-- Autorizací je DVOJICE: registrované zařízení a PIN — stejně jako
-- u píchnutí. Potvrzuje ZAMĚSTNANEC, ne obsluha: tím se ze záznamu
-- stává doklad.
--
-- Špatný PIN se nevyhazuje jako výjimka. Výjimka by vrátila zpět
-- i počítadlo nezdarů a záznam v auditu, které app.pin_overit zrovna
-- zapsalo — zámek po pěti pokusech by pak nikdy nezabral. Totéž se
-- našlo u píchnutí PINem; tady se to neopakuje.
-- ---------------------------------------------------------------------

create or replace function public.potvrdit_zalohu_pinem(
  p_klic   text,
  p_pin    text,
  p_zaloha uuid
)
returns table (ok boolean, jmeno text, castka_haleru integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_emp uuid;
  v_zal public.advances;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_zal from public.advances a
  where a.id = p_zaloha and a.tenant_id = d.tenant_id and a.branch_id = d.branch_id;

  if not found then
    raise exception 'Taková záloha na téhle pobočce není.'
      using errcode = 'no_data_found';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Stornovaná záloha se nepotvrzuje.'
      using errcode = 'check_violation';
  end if;

  v_emp := app.pin_overit(d.tenant_id, d.branch_id, coalesce(p_pin, ''));

  -- PIN nesedl, nebo sedl někomu jinému. Obojí je totéž „ne“: kdo
  -- hádá, se z odpovědi nesmí dozvědět, jestli se trefil.
  if v_emp is null or v_emp <> v_zal.employee_id then
    return query select false, null::text, null::integer;
    return;
  end if;

  -- Druhé potvrzení téže zálohy není chyba — jen se nic nemění.
  if v_zal.stav = 'nepotvrzena' then
    update public.advances
       set stav = 'potvrzena',
           potvrzeno_kdy = now(),
           potvrzeno_zarizenim = d.id
     where id = v_zal.id;

    perform app.audit(d.tenant_id, 'advance.potvrzeno', 'advance', v_zal.id::text,
                      d.branch_id, null, null);
  end if;

  return query
    select true, e.full_name, v_zal.castka_haleru
    from public.employees e where e.id = v_zal.employee_id;
end;
$$;

revoke all on function public.potvrdit_zalohu_pinem(text, text, uuid) from public;
grant execute on function public.potvrdit_zalohu_pinem(text, text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- STORNO
--
-- Nemaže. Záznam zůstane i s důvodem — smazaný pohyb peněz je díra
-- v evidenci.
-- ---------------------------------------------------------------------

create or replace function public.stornovat_zalohu(
  p_tenant uuid,
  p_zaloha uuid,
  p_duvod  text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_zal public.advances;
begin
  select * into v_zal from public.advances a
  where a.id = p_zaloha and a.tenant_id = p_tenant;

  if not found then
    raise exception 'Taková záloha tu není.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'advances.manage', v_zal.branch_id) then
    raise exception 'Stornovat zálohu smí jen ten, kdo je vyplácí.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) = 0 then
    raise exception 'Napište důvod storna — bez něj se za měsíc nedá zjistit, co se stalo.'
      using errcode = 'check_violation';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Tahle záloha je stornovaná už teď.' using errcode = 'check_violation';
  end if;

  update public.advances
     set stav = 'stornovana',
         storno_duvod = btrim(p_duvod),
         storno_kdy = now(),
         stornoval = (select auth.uid())
   where id = p_zaloha;

  perform app.audit(p_tenant, 'advance.storno', 'advance', p_zaloha::text,
                    v_zal.branch_id, jsonb_build_object('castka_haleru', v_zal.castka_haleru),
                    jsonb_build_object('duvod', btrim(p_duvod)));
end;
$$;

revoke all on function public.stornovat_zalohu(uuid, uuid, text) from public, anon;
grant execute on function public.stornovat_zalohu(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- ZMĚNA ZOBRAZENÍ
--
-- Do auditu. Když se lidem ze dne na den změní číslo na obrazovce, musí
-- být dohledatelné, kdo to přepnul a kdy.
-- ---------------------------------------------------------------------

create or replace function public.nastavit_zalohy_zobrazeni(
  p_tenant uuid,
  p_volba  text,
  p_max_haleru integer default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_puvodni text;
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení firmy mění jen správce nastavení.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_volba not in ('odecitat', 'jen_ukazat', 'neukazovat') then
    raise exception 'Neznámá volba zobrazení záloh: %', p_volba
      using errcode = 'check_violation';
  end if;

  if p_max_haleru is not null and p_max_haleru <= 0 then
    raise exception 'Horní mez musí být kladná, nebo prázdná.'
      using errcode = 'check_violation';
  end if;

  select s.zalohy_zobrazeni into v_puvodni from app.nastaveni(p_tenant) s;

  insert into public.tenant_settings
    (tenant_id, zalohy_zobrazeni, zaloha_max_haleru, updated_at, updated_by)
  values (p_tenant, p_volba, p_max_haleru, now(), (select auth.uid()))
  on conflict (tenant_id) do update
    set zalohy_zobrazeni = excluded.zalohy_zobrazeni,
        zaloha_max_haleru = excluded.zaloha_max_haleru,
        updated_at = now(),
        updated_by = excluded.updated_by;

  perform app.audit(p_tenant, 'settings.zalohy', 'tenant', p_tenant::text, null,
                    jsonb_build_object('zobrazeni', v_puvodni),
                    jsonb_build_object('zobrazeni', p_volba, 'max_haleru', p_max_haleru));
end;
$$;

revoke all on function public.nastavit_zalohy_zobrazeni(uuid, text, integer) from public, anon;
grant execute on function public.nastavit_zalohy_zobrazeni(uuid, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- MŮJ VÝPLATNÍ PŘEHLED
--
-- Čtyři řádky ze zadání, oddíl 7, a k nim volba firmy. Vrací se
-- pohromadě schválně: kdyby si obrazovka skládala součty sama ze dvou
-- dotazů, dřív nebo později by ukázala „zbývá k výplatě“ tam, kde si to
-- firma nepřeje.
--
-- `zbyva_haleru` je hrubá mzda po odečtení záloh, PŘED daněmi a odvody.
-- Zálohy se ve skutečnosti vyplácejí z čisté mzdy, takže na výplatní
-- pásce bude číslo nižší. Obrazovka to musí napsat — bez toho skončí
-- první výplata po zavedení záloh hádkou u baru, a bude oprávněná.
-- ---------------------------------------------------------------------

create or replace function public.muj_vyplatni_prehled(p_tenant uuid, p_mesic date)
returns table (
  odpracovano_minut   integer,
  vydelano_haleru     integer,
  zalohy_haleru       integer,
  zbyva_haleru        integer,
  zaloh_nepotvrzenych integer,
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

comment on function public.muj_vyplatni_prehled(uuid, date) is
  'Vlastní odpracované hodiny, hrubá mzda, zálohy a zbytek — plus volba '
  'firmy, jak se to má ukázat. Na svou mzdu není potřeba oprávnění.';

revoke all on function public.muj_vyplatni_prehled(uuid, date) from public, anon;
grant execute on function public.muj_vyplatni_prehled(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- ZÁLOHY POBOČKY
--
-- Pro toho, kdo je vydává, a pro toho, kdo dělá mzdy. Rozsah řeší
-- can_read_scoped u každého řádku zvlášť (pravidlo 4).
-- ---------------------------------------------------------------------

create or replace function public.zalohy_pobocky(
  p_tenant uuid,
  p_od     date,
  p_do     date,
  p_branch uuid default null
)
returns table (
  id            uuid,
  employee_id   uuid,
  jmeno         text,
  branch_id     uuid,
  castka_haleru integer,
  business_date date,
  stav          text,
  poznamka      text,
  storno_duvod  text,
  vyplaceno_kdy timestamptz,
  potvrzeno_kdy timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.employee_id, e.full_name, a.branch_id, a.castka_haleru,
         a.business_date, a.stav, a.poznamka, a.storno_duvod,
         a.vyplaceno_kdy, a.potvrzeno_kdy
  from public.advances a
  join public.employees e on e.id = a.employee_id
  where a.tenant_id = p_tenant
    and a.business_date between p_od and p_do
    and (p_branch is null or a.branch_id = p_branch)
    and (
      app.can_read_scoped(p_tenant, 'advances.manage', a.branch_id)
      or app.can_read_scoped(p_tenant, 'payroll.read', a.branch_id)
    )
  order by a.business_date desc, a.vyplaceno_kdy desc;
$$;

revoke all on function public.zalohy_pobocky(uuid, date, date, uuid) from public, anon;
grant execute on function public.zalohy_pobocky(uuid, date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- CO KIOSEK UKAZUJE K POTVRZENÍ
--
-- Nepotvrzené zálohy téhle pobočky. Jména jsou tu schválně: člověk musí
-- poznat svůj řádek dřív, než zadá PIN. Částka taky — potvrzuje se
-- konkrétní suma, ne „něco“.
--
-- Víc než dnešek se neukazuje: tablet stojí na pultě a starší seznam by
-- byl jen soupis toho, komu se kdy platilo.
-- ---------------------------------------------------------------------

create or replace function public.kiosk_zalohy(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d      public.branch_devices;
  v_den  date;
  v_out  jsonb;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_den := app.business_date(d.branch_id, now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'jmeno', e.full_name,
           'castka_haleru', a.castka_haleru
         ) order by a.vyplaceno_kdy), '[]'::jsonb)
    into v_out
  from public.advances a
  join public.employees e on e.id = a.employee_id
  where a.branch_id = d.branch_id
    and a.business_date = v_den
    and a.stav = 'nepotvrzena';

  return v_out;
end;
$$;

revoke all on function public.kiosk_zalohy(text) from public;
grant execute on function public.kiosk_zalohy(text) to anon, authenticated;
