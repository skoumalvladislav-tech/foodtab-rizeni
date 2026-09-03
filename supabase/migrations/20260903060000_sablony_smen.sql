-- =====================================================================
-- Foodtab — šablony směn (D, N, R…) s časy podle pozice
--
-- Zadání: docs/sablony-smen-zadani.md.
--
-- Pojmenovaná směna s časem. V rozpisu se nezadává „7:30–22:00“, ale
-- `D` — a čas se doplní podle toho, KDO tu směnu má. Kuchař a číšník
-- mají oba `D`, ale kuchař od 7:30 a číšník od 9:00. To je celý smysl.
--
-- ---------------------------------------------------------------------
-- ŠABLONA JE PŘEDVYPLNĚNÍ, NE VAZBA
--
-- Tohle je nejdůležitější věta celého zadání a stojí za ní celý návrh:
--
--     SMĚNA SI PŘI ZALOŽENÍ OPÍŠE ČASY. Nedrží si odkaz na šablonu
--     jako zdroj pravdy.
--
-- Kdyby si ho držela, stačilo by opravit `D` z 9:00 na 9:30 a TIŠE by
-- se posunuly všechny už vydané směny, které lidé mají naplánované.
-- V rozpisu, podle kterého si lidé zařizují život, je to nepřijatelné.
--
-- Proto v `shifts` NENÍ cizí klíč na `shift_templates`. Přibývá jediný
-- sloupec `sablona_key` — a je to TEXT, opsaný při založení, čistě aby
-- se v kalendáři dalo ukázat „D“ místo časů. Nikdy se přes něj nic
-- nedohledává. Kdyby se z toho někdy stal join na šablonu, je celá
-- tahle úvaha pryč.
--
-- ---------------------------------------------------------------------
-- PŮLNOC SE ŘEŠÍ NA JEDNOM MÍSTĚ
--
-- `N` je 22:00–06:00, tedy `ends_at < starts_at`. Délku počítá
-- `app.delka_smeny_minut` z migrace 20260903030000 — táž funkce jako
-- u ručního zadávání. Druhá kopie by se rozešla.
-- =====================================================================


-- ---------------------------------------------------------------------
-- TABULKA — A PROČ SE NEJMENUJE shift_templates
--
-- Zadání mluví o nové tabulce `public.shift_templates`. To jméno je
-- ale od základní migrace 20260823130000 ZABRANÉ, a něčím úplně jiným:
-- týdenní vzor obsazení (`weekday`, `headcount`) — kolik lidí má
-- v úterý stát na baru. Se zkratkami D/N/R to nemá společného nic než
-- slovo „šablona“.
--
-- Našlo se to tím, že `create table if not exists` tiše neudělal nic
-- a index pak hlásil, že sloupec `key` neexistuje.
--
-- Ta stará tabulka je PRÁZDNÁ ROLE: v aplikaci, v knihovnách ani ve
-- scénářích ji nepoužívá nikdo. Nesahám na ni — zrušit tabulku je
-- nevratné a nepatří to do migrace, která má jinou práci. Ohlášeno.
-- ---------------------------------------------------------------------

/*
  Bez `if not exists` — pravidlo z CLAUDE.md, oddílu „Dvě relace
  v jednom repozitáři“. Srážka jmen má spadnout nahlas a hned;
  přesně tohle mě dnes stálo půl hodiny, protože `if not exists`
  tiše neudělal nic a chyba vylezla až o krok dál.
*/
create table public.sablony_smen (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- Prázdné = platí pro celou firmu, resp. pro všechny pozice.
  branch_id   uuid references public.branches(id) on delete cascade,
  position_id uuid references public.positions(id) on delete cascade,
  key         text not null check (btrim(key) <> '' and length(btrim(key)) <= 4),
  label       text not null check (btrim(label) <> ''),
  starts_at   time not null,
  ends_at     time not null,
  poradi      integer not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- „Od osmi do osmi“ je překlep, ne čtyřiadvacetihodinová služba.
  constraint sablony_smen_delka check (starts_at <> ends_at)
);

comment on table public.sablony_smen is
  'Pojmenované směny s časy. PŘEDVYPLNĚNÍ, ne vazba — směna si časy '
  'opíše a pozdější změna šablony s ní nehne.';
comment on column public.sablony_smen.branch_id is
  'Prázdné = platí pro celou firmu.';
comment on column public.sablony_smen.position_id is
  'Prázdné = platí pro všechny pozice.';

/*
  Jedinečnost na (firma, pobočka, pozice, klíč). `nulls not distinct`
  je tu podstatné: bez něj by šlo založit dvě firemní `D` bez pozice,
  protože dva NULLy se běžně považují za různé.

  Klíč se porovnává přes `lower(btrim(…))` — stejně jako ostatní
  rozpoznávací klíče. Až se bude nahrávat rozpis z Excelu, budou
  v tabulce od zákazníka právě tyhle zkratky a „ d “ musí být totéž
  co „D“.
*/
create unique index if not exists sablony_smen_klic
  on public.sablony_smen (tenant_id, branch_id, position_id, lower(btrim(key)))
  nulls not distinct;

create index if not exists sablony_smen_firma
  on public.sablony_smen (tenant_id) where active;

alter table public.sablony_smen enable row level security;

/*
  Čte, kdo plánuje směny — a taky kdo spravuje nastavení.

  Ta druhá půlka není navíc: obrazovku Nastavení → Šablony otevírá
  `settings.manage`, a kdyby řádky pouštělo jen `shifts.read`, viděl by
  účetní se správou nastavení a bez rozpisu prázdný seznam. Prázdný
  seznam vypadá jako „firma nemá šablony“, ne jako „na tyhle nevidíš“ —
  a takovou chybu nikdo nenahlásí, jen podle ní jedná.
*/
drop policy if exists sablony_smen_read on public.sablony_smen;
create policy sablony_smen_read on public.sablony_smen for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'shifts.read', branch_id)
    or app.has_access(tenant_id, 'settings.manage', branch_id)
  );

drop policy if exists sablony_smen_write on public.sablony_smen;
create policy sablony_smen_write on public.sablony_smen for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage', branch_id))
  with check (app.has_access(tenant_id, 'settings.manage', branch_id));

/*
  RLS SAMA O SOBĚ NESTAČÍ.

  Politika říká, KTERÉ řádky člověk uvidí. Jestli se na tabulku vůbec
  smí podívat, říká grant — a bez něj dostane „permission denied for
  table“ dřív, než se politika stihne zeptat. Zjistilo se to tím, že
  scénář sáhl na tabulku pod rolí `authenticated` a spadl; obrazovka
  Nastavení → Šablony na ni sahá přesně tak.

  Čte se přímo (správa potřebuje i vyřazené šablony, které nabídková
  funkce nevrací), ale PÍŠE se jen přes `ulozit_sablonu`
  a `prepnout_sablonu`. Ty jsou `security definer` a grant na zápis
  nepotřebují — proto ho tabulka nedostane. Zápisová politika výš
  zůstává jako druhá pojistka pro případ, že by grant někdy přibyl.
*/
grant select on public.sablony_smen to authenticated;


-- ---------------------------------------------------------------------
-- SMĚNA SI OPÍŠE KLÍČ, NE ODKAZ
--
-- Text, ne cizí klíč. Viz hlavička: kdyby to byl odkaz, změna šablony
-- by posunula už vydané směny.
-- ---------------------------------------------------------------------

alter table public.shifts
  add column if not exists sablona_key text;

comment on column public.shifts.sablona_key is
  'Opsaná zkratka šablony (D, N, R) — jen na ukázání v kalendáři. '
  'NENÍ to odkaz: časy si směna drží vlastní a změna šablony s nimi '
  'nehne.';


-- ---------------------------------------------------------------------
-- KTERÉ PRAVIDLO VYHRAJE
--
-- Od nejužšího k nejširšímu, PRVNÍ NALEZENÉ PLATÍ:
--
--   1. tahle pobočka + tahle pozice
--   2. tahle pobočka, bez pozice
--   3. celá firma + tahle pozice
--   4. celá firma, bez pozice
--
-- Když nesedí nic, nevrátí se nic — šablona se prostě nenabídne
-- a časy se napíšou ručně. Dnes má pozici jediný člověk z dvanácti,
-- takže většina spadne na pravidlo 2 nebo 4; když ani to není, nesmí
-- se stát nic záhadného.
-- ---------------------------------------------------------------------

create or replace function app.sablona_poradi(
  p_branch     uuid,
  p_position   uuid,
  t_branch     uuid,
  t_position   uuid
)
returns integer
language sql immutable
as $$
  select case
    when t_branch is not distinct from p_branch
     and t_position is not distinct from p_position
     and t_branch is not null and t_position is not null then 1
    when t_branch is not distinct from p_branch and t_branch is not null
     and t_position is null then 2
    when t_branch is null
     and t_position is not distinct from p_position and t_position is not null then 3
    when t_branch is null and t_position is null then 4
    else null
  end;
$$;

comment on function app.sablona_poradi(uuid, uuid, uuid, uuid) is
  'Jak úzce šablona sedí: 1 pobočka+pozice, 2 pobočka, 3 firma+pozice, '
  '4 firma. NULL = nesedí vůbec.';

grant execute on function app.sablona_poradi(uuid, uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ŠABLONY PRO KONKRÉTNÍ SMĚNU
--
-- Vrátí, co se má nabídnout pro danou pobočku a pozici — z každého
-- klíče tu nejužší. Formulář z toho udělá nabídku „D · N · R“.
-- ---------------------------------------------------------------------

create or replace function public.sablony_pro_smenu(
  p_tenant   uuid,
  p_branch   uuid,
  p_position uuid default null
)
returns table (
  id        uuid,
  klic      text,
  label     text,
  starts_at time,
  ends_at   time,
  minut     integer,
  poradi    integer
)
language sql stable security definer set search_path = ''
as $$
  /*
    Dvě seřazení, každé o něčem jiném.

    To vnitřní vybírá: `distinct on` bere z každého klíče první řádek,
    a aby to bral podle nejužšího pravidla, musí ORDER BY začínat tímtéž
    klíčem. Jinak to Postgres nevezme.

    To vnější řadí obrazovku. Nabídka má stát v pořadí, které si firma
    nastavila — D, N, R —, ne podle abecedy: kdyby se nabízelo D, N, R
    jako "D, N, R" jen náhodou, stačilo by přejmenovat na "V" a ranní
    směna by skočila na konec.
  */
  select s.id, s.klic, s.label, s.starts_at, s.ends_at, s.minut, s.poradi
  from (
    select distinct on (lower(btrim(t.key)))
      t.id,
      btrim(t.key)                                   as klic,
      t.label,
      t.starts_at,
      t.ends_at,
      app.delka_smeny_minut(t.starts_at, t.ends_at)  as minut,
      t.poradi
    from public.sablony_smen t
    where t.tenant_id = p_tenant
      and t.active
      and app.sablona_poradi(p_branch, p_position, t.branch_id, t.position_id) is not null
      and app.can_read_scoped(p_tenant, 'shifts.read', t.branch_id)
    order by
      lower(btrim(t.key)),
      app.sablona_poradi(p_branch, p_position, t.branch_id, t.position_id)
  ) s
  order by s.poradi, lower(s.klic);
$$;

comment on function public.sablony_pro_smenu(uuid, uuid, uuid) is
  'Šablony, které pro tuhle pobočku a pozici platí — z každého klíče '
  'ta nejužší. Pořadí pravidel viz app.sablona_poradi.';

revoke all on function public.sablony_pro_smenu(uuid, uuid, uuid) from public, anon;
grant execute on function public.sablony_pro_smenu(uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- SPRÁVA ŠABLON
-- ---------------------------------------------------------------------

create or replace function public.ulozit_sablonu(
  p_tenant   uuid,
  p_sablona  uuid,
  p_branch   uuid,
  p_position uuid,
  p_key      text,
  p_label    text,
  p_od       time,
  p_do       time,
  p_poradi   integer default 100
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not app.has_access(p_tenant, 'settings.manage', p_branch) then
    raise exception 'Šablony směn mění jen ten, kdo spravuje nastavení.'
      using errcode = 'insufficient_privilege';
  end if;

  if btrim(coalesce(p_key, '')) = '' then
    raise exception 'Vyplňte zkratku, třeba D.' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'Vyplňte název, třeba Denní.' using errcode = 'check_violation';
  end if;
  if p_od is null or p_do is null then
    raise exception 'Vyplňte čas od–do.' using errcode = 'check_violation';
  end if;
  if p_od = p_do then
    raise exception 'Začátek a konec jsou stejné. Šablona by neměla žádnou délku.'
      using errcode = 'check_violation';
  end if;

  if p_branch is not null and not exists (
    select 1 from public.branches b where b.id = p_branch and b.tenant_id = p_tenant
  ) then
    raise exception 'Takovou pobočku v téhle firmě nemám.' using errcode = 'no_data_found';
  end if;
  if p_position is not null and not exists (
    select 1 from public.positions po where po.id = p_position and po.tenant_id = p_tenant
  ) then
    raise exception 'Takovou pozici v téhle firmě nemám.' using errcode = 'no_data_found';
  end if;

  if p_sablona is null then
    insert into public.sablony_smen
      (tenant_id, branch_id, position_id, key, label, starts_at, ends_at, poradi)
    values
      (p_tenant, p_branch, p_position, btrim(p_key), btrim(p_label), p_od, p_do,
       coalesce(p_poradi, 100))
    returning id into v_id;
  else
    update public.sablony_smen
       set branch_id = p_branch, position_id = p_position,
           key = btrim(p_key), label = btrim(p_label),
           starts_at = p_od, ends_at = p_do,
           poradi = coalesce(p_poradi, 100),
           updated_at = now()
     where id = p_sablona and tenant_id = p_tenant
    returning id into v_id;

    if v_id is null then
      raise exception 'Takovou šablonu neznám.' using errcode = 'no_data_found';
    end if;
  end if;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => case when p_sablona is null then 'sablona.zalozena' else 'sablona.upravena' end,
    p_entity_type => 'sablona_smeny',
    p_entity_id   => v_id::text,
    p_branch      => p_branch,
    p_after       => jsonb_build_object('key', btrim(p_key), 'od', p_od, 'do', p_do)
  );

  return v_id;
exception when unique_violation then
  raise exception 'Šablona s touhle zkratkou už pro stejnou pobočku a pozici existuje.'
    using errcode = 'unique_violation';
end;
$$;

comment on function public.ulozit_sablonu(uuid, uuid, uuid, uuid, text, text, time, time, integer) is
  'Založí nebo upraví šablonu. Změna se projeví jen na NOVĚ zadaných '
  'směnách — už zadané si své časy drží.';

revoke all on function public.ulozit_sablonu(uuid, uuid, uuid, uuid, text, text, time, time, integer)
  from public, anon;
grant execute on function public.ulozit_sablonu(uuid, uuid, uuid, uuid, text, text, time, time, integer)
  to authenticated;


/*
  Vyřadit z nabídky, ne smazat: visí na tom historie a lidé tu zkratku
  znají. Smazaná šablona by navíc uvolnila zkratku a někdo by pod
  stejným "D" založil jiné časy.

  Přepínač, ne jednosměrka. Vyřazení je běžný překlep — obrazovka
  Pozice to má taky obousměrné a chovat se to má stejně.
*/
create or replace function public.prepnout_sablonu(
  p_tenant  uuid,
  p_sablona uuid,
  p_active  boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.sablony_smen
  where id = p_sablona and tenant_id = p_tenant;

  if not found then
    raise exception 'Takovou šablonu neznám.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'settings.manage', v_branch) then
    raise exception 'Šablony směn mění jen ten, kdo spravuje nastavení.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.sablony_smen
     set active = coalesce(p_active, false), updated_at = now()
   where id = p_sablona;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => case when coalesce(p_active, false)
                       then 'sablona.vracena' else 'sablona.vyrazena' end,
    p_entity_type => 'sablona_smeny',
    p_entity_id   => p_sablona::text,
    p_branch      => v_branch
  );
end;
$$;

comment on function public.prepnout_sablonu(uuid, uuid, boolean) is
  'Vyřadí šablonu z nabídky nebo ji vrátí. Na už zadané směny to '
  'nemá vliv — ty si své časy drží.';

revoke all on function public.prepnout_sablonu(uuid, uuid, boolean) from public, anon;
grant execute on function public.prepnout_sablonu(uuid, uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- SMĚNA SI OPÍŠE ZKRATKU
--
-- `ulozit_smenu` dostává navíc `p_sablona_key`. Je to TEXT, který se
-- opíše do řádku — ne odkaz. Časy chodí zvlášť, tak jak jsou ve
-- formuláři: šablona je jen předvyplnila a člověk je mohl přepsat.
--
-- Stará devítiparametrová podoba se ruší, ne přetěžuje. Dvě funkce
-- téhož jména, kde jedna má výchozí hodnotu, dělají volání
-- nejednoznačným.
-- ---------------------------------------------------------------------

drop function if exists public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text);

create or replace function public.ulozit_smenu(
  p_tenant    uuid,
  p_smena     uuid,
  p_branch    uuid,
  p_employee  uuid,
  p_position  uuid,
  p_den       date,
  p_od        time,
  p_do        time,
  p_poznamka  text default '',
  p_sablona_key text default null
)
returns table (smena uuid, varovani text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni  public.shifts;
  v_id       uuid;
  v_varovani text[] := '{}';
  v_zacatek  date;
  v_kolize   record;
  v_jmeno    text;
begin
  if not app.has_access(p_tenant, 'shifts.manage', p_branch) then
    raise exception 'Plánovat směny na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_smena is not null then
    select * into v_puvodni from public.shifts
    where id = p_smena and tenant_id = p_tenant;

    if not found then
      raise exception 'Takovou směnu neznám.' using errcode = 'no_data_found';
    end if;

    -- Viz hlavička: i původní pobočka.
    if not app.has_access(p_tenant, 'shifts.manage', v_puvodni.branch_id) then
      raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_den is null or p_od is null or p_do is null then
    raise exception 'Vyplňte datum a čas od–do.' using errcode = 'check_violation';
  end if;

  if p_od = p_do then
    raise exception 'Začátek a konec jsou stejné. Směna by neměla žádnou délku.'
      using errcode = 'check_violation';
  end if;

  -- Zaměstnanec smí být prázdný (volná směna), ale ne cizí.
  if p_employee is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null
  ) then
    raise exception 'Takového zaměstnance v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  if p_position is not null and not exists (
    select 1 from public.positions po
    where po.id = p_position and po.tenant_id = p_tenant
  ) then
    raise exception 'Takovou pozici v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  /*
    Provozní den (pravidlo 10). Směna, která začíná před začátkem
    provozního dne pobočky, patří ve skutečnosti do dne PŘEDCHOZÍHO —
    a kiosek i docházka ji podle `shift_date` hledají jinde.

    Datum se schválně nepřepisuje: člověk napsal, co napsal, a tiše mu
    to posunout o den je horší než mu to říct.
  */
  v_zacatek := app.business_date(
    p_branch,
    (p_den + p_od) at time zone app.zona_pobocky(p_branch)
  );
  if v_zacatek is distinct from p_den then
    v_varovani := v_varovani || format(
      'Směna začíná před začátkem provozního dne, takže patří do %s, ne do %s. Docházka i kiosek ji budou hledat tam.',
      to_char(v_zacatek, 'DD.MM.YYYY'), to_char(p_den, 'DD.MM.YYYY'));
  end if;

  if p_do < p_od then
    v_varovani := v_varovani || format(
      'Směna končí druhý den v %s. Délka je %s h %s min.',
      to_char(p_do, 'HH24:MI'),
      app.delka_smeny_minut(p_od, p_do) / 60,
      lpad((app.delka_smeny_minut(p_od, p_do) % 60)::text, 2, '0'));
  end if;

  /* --- zápis ------------------------------------------------------ */

  if p_smena is null then
    insert into public.shifts
      (tenant_id, branch_id, employee_id, position_id, shift_date,
       starts_at, ends_at, note, sablona_key, created_by)
    values
      (p_tenant, p_branch, p_employee, p_position, p_den,
       p_od, p_do, coalesce(btrim(p_poznamka), ''),
       nullif(btrim(coalesce(p_sablona_key, '')), ''), (select auth.uid()))
    returning id into v_id;
  else
    update public.shifts
       set branch_id   = p_branch,
           employee_id = p_employee,
           position_id = p_position,
           shift_date  = p_den,
           starts_at   = p_od,
           ends_at     = p_do,
           note        = coalesce(btrim(p_poznamka), ''),
           sablona_key = nullif(btrim(coalesce(p_sablona_key, '')), ''),
           updated_at  = now()
     where id = p_smena
    returning id into v_id;
  end if;

  /*
    Překryv AŽ PO ZÁPISU a jen jako varování. Počítá se v minutách od
    začátku dne, aby směna přes půlnoc nevypadala jako zápor.
  */
  if p_employee is not null then
    for v_kolize in
      select s.shift_date, s.starts_at, s.ends_at, b.name as pobocka
      from public.shifts s
      join public.branches b on b.id = s.branch_id
      where s.tenant_id = p_tenant
        and s.employee_id = p_employee
        and s.id <> v_id
        and s.status <> 'cancelled'
        and s.shift_date between p_den - 1 and p_den + 1
        -- Dvě úsečky na časové ose se překrývají, když každá začíná
        -- dřív, než ta druhá končí.
        and (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
            < extract(epoch from p_od)::integer / 60 + app.delka_smeny_minut(p_od, p_do)
        and extract(epoch from p_od)::integer / 60
            < (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
              + app.delka_smeny_minut(s.starts_at, s.ends_at)
      order by s.shift_date, s.starts_at
    loop
      v_varovani := v_varovani || format(
        'Překrývá se s jinou směnou téhož člověka: %s %s–%s, %s.',
        to_char(v_kolize.shift_date, 'DD.MM.'),
        to_char(v_kolize.starts_at, 'HH24:MI'),
        to_char(v_kolize.ends_at, 'HH24:MI'),
        v_kolize.pobocka);
    end loop;
  end if;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => case when p_smena is null then 'smena.zalozena' else 'smena.upravena' end,
    p_entity_type => 'shift',
    p_entity_id   => v_id::text,
    p_branch      => p_branch,
    p_before      => case when p_smena is null then null else jsonb_build_object(
                       'den', v_puvodni.shift_date,
                       'od', v_puvodni.starts_at,
                       'do', v_puvodni.ends_at,
                       'zamestnanec', v_puvodni.employee_id,
                       'pobocka', v_puvodni.branch_id
                     ) end,
    p_after       => jsonb_build_object(
                       'den', p_den, 'od', p_od, 'do', p_do,
                       'zamestnanec', p_employee, 'pobocka', p_branch
                     )
  );

  smena := v_id;
  varovani := v_varovani;
  return next;
end;
$$;


revoke all on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text)
  from public, anon;
grant execute on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text)
  to authenticated;
