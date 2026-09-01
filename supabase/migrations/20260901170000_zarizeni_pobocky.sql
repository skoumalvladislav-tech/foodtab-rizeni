-- =====================================================================
-- Foodtab — zařízení pobočky (kiosek má vlastní totožnost)
--
-- Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíly 2 a 3, bod 1 pořadí.
--
-- NEJDŮLEŽITĚJŠÍ ROZHODNUTÍ CELÉHO ZADÁNÍ: kiosek je ZAŘÍZENÍ POBOČKY,
-- ne přihlášený člověk. Kdyby byl tablet přihlášený jako vedoucí, ležel
-- by na baru účet, který vidí tržby, mzdy a osobní údaje — stačilo by
-- ho vzít do ruky a přepnout obrazovku. Tablet se navíc ztrácí,
-- půjčuje a zůstává zapnutý přes noc.
--
-- KLÍČ SE UKLÁDÁ JEN JAKO OTISK (pravidlo 7), stejně jako u pozvánek.
-- Do prohlížeče jde jednou, při registraci, a nikdy víc. Kdo přijde
-- o klíč, zaregistruje zařízení znovu — přečíst se nedá ani z databáze,
-- ani ze zálohy.
--
-- Bez rozšíření Postgresu (CLAUDE.md): otisk je vestavěná sha256,
-- náhoda dvě gen_random_uuid() bez pomlček. Žádné pgcrypto.
-- =====================================================================


-- ---------------------------------------------------------------------
-- TAJEMSTVÍ POBOČKY A DOBA PLATNOSTI KÓDU
--
-- Z tajemství a času se odvozuje měnící se kód. Tajemství NIKDY
-- neopustí server — do prohlížeče jde hotový kód, ne to, z čeho vznikl.
-- Proto se čtení sloupce odebírá i `authenticated`.
--
-- Doba platnosti je nastavení pobočky, ne konstanta (pravidlo 1).
-- ---------------------------------------------------------------------

alter table public.branches
  add column if not exists kiosk_secret text,
  add column if not exists kiosk_kod_vterin integer not null default 45;

alter table public.branches
  drop constraint if exists branches_kiosk_vterin;
alter table public.branches
  add constraint branches_kiosk_vterin
  check (kiosk_kod_vterin between 30 and 60);

comment on column public.branches.kiosk_secret is
  'Tajemství, ze kterého se odvozuje měnící se kód. Nikdy neopustí '
  'server — čtení sloupce je authenticated odebrané.';

-- Doplní se každé pobočce, která ho ještě nemá, i každé nové.
create or replace function app.kiosk_tajemstvi()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kiosk_secret is null then
    new.kiosk_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

revoke all on function app.kiosk_tajemstvi() from public, anon, authenticated;

drop trigger if exists trg_kiosk_tajemstvi on public.branches;
create trigger trg_kiosk_tajemstvi
  before insert or update on public.branches
  for each row execute function app.kiosk_tajemstvi();

update public.branches
   set kiosk_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where kiosk_secret is null;


-- ---------------------------------------------------------------------
-- PRÁVO NA SLOUPEC
--
-- Stejný postup jako u kontaktů a otisků pozvánek: sebrat čtení celé
-- tabulky a vrátit ho po sloupcích. Tajemství mezi nimi není.
--
-- POZOR: `grant select on all tables in schema public to authenticated`
-- v budoucí migraci tuhle výjimku zase smaže. Když takový řádek budete
-- psát, přidejte za něj znovu tenhle blok.
-- ---------------------------------------------------------------------

revoke select on public.branches from authenticated;

grant select (
  id, tenant_id, name, slug, address, timezone, opening_hours,
  day_starts_at, active, created_at, deleted_at, color, kiosk_kod_vterin
) on public.branches to authenticated;


-- ---------------------------------------------------------------------
-- ZAŘÍZENÍ
-- ---------------------------------------------------------------------

create table if not exists public.branch_devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  nazev        text not null check (length(btrim(nazev)) > 0),
  -- Otisk servisního klíče, nikdy klíč sám.
  key_hash     text not null unique,
  stav         text not null default 'active' check (stav in ('active', 'revoked')),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(user_id) on delete set null,
  posledni_kdy timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(user_id) on delete set null
);

create index if not exists branch_devices_pobocka
  on public.branch_devices (branch_id) where stav = 'active';

comment on table public.branch_devices is
  'Tablety a telefony na provozovně. Kiosek je zařízení pobočky, ne '
  'přihlášený člověk — na baru nemá ležet účet, který vidí mzdy.';

-- Klíč se nedá přečíst ani majiteli. Sloupec `key_hash` se proto
-- nevrací vůbec; seznam zařízení ho k ničemu nepotřebuje.
grant select (
  id, tenant_id, branch_id, nazev, stav, revoked_at, revoked_by,
  posledni_kdy, created_at, created_by
) on public.branch_devices to authenticated;

-- Odvolání je update sloupců stavu. Bez tohohle grantu by politika níž
-- byla k ničemu: právo na tabulku chybí dřív, než se na politiku dojde,
-- a tlačítko Odvolat by hlásilo „permission denied“.
grant update (stav, revoked_at, revoked_by, posledni_kdy)
  on public.branch_devices to authenticated;

alter table public.branch_devices enable row level security;

drop policy if exists branch_devices_select on public.branch_devices;
create policy branch_devices_select on public.branch_devices for select to authenticated
  using (app.can_read_scoped(tenant_id, 'settings.manage', branch_id));

-- Zakládá se jedině registrací (průzor). Odvolání je update a smí ho
-- ten, kdo spravuje nastavení pobočky.
drop policy if exists branch_devices_update on public.branch_devices;
create policy branch_devices_update on public.branch_devices for update to authenticated
  using (app.has_access(tenant_id, 'settings.manage', branch_id))
  with check (app.has_access(tenant_id, 'settings.manage', branch_id));

revoke insert, delete on public.branch_devices from authenticated;

drop trigger if exists trg_audit_zarizeni on public.branch_devices;
create trigger trg_audit_zarizeni
  after insert or update or delete on public.branch_devices
  for each row execute function app.audit_zmenu('device');


-- ---------------------------------------------------------------------
-- REGISTRAČNÍ KÓDY
--
-- Krátká platnost a jedno použití. Kód je jediné, co tablet při
-- registraci má — proto se ukládá zase jen otisk a proto se hned po
-- použití označí za spotřebovaný.
-- ---------------------------------------------------------------------

create table if not exists public.device_registrations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete cascade,
  nazev      text not null,
  code_hash  text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  device_id  uuid references public.branch_devices(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null
);

grant select (
  id, tenant_id, branch_id, nazev, expires_at, used_at, device_id,
  created_at, created_by
) on public.device_registrations to authenticated;

alter table public.device_registrations enable row level security;

drop policy if exists device_registrations_select on public.device_registrations;
create policy device_registrations_select on public.device_registrations for select to authenticated
  using (app.can_read_scoped(tenant_id, 'settings.manage', branch_id));

revoke insert, update, delete on public.device_registrations from authenticated;


-- ---------------------------------------------------------------------
-- VYSTAVENÍ REGISTRAČNÍHO KÓDU
--
-- Vrací kód JEDNOU. V databázi zůstane jen otisk — stejně jako
-- u pozvánek. Kdo si kód nezapíše, vystaví nový.
--
-- Kód je krátký schválně: opisuje se z obrazovky na tablet. Osm znaků
-- z hexadecimální abecedy je 4 miliardy možností a platí pár minut.
-- ---------------------------------------------------------------------

create or replace function public.vytvorit_registracni_kod(
  p_tenant uuid,
  p_branch uuid,
  p_nazev  text,
  p_minut  integer default 15
)
returns table (registration_id uuid, kod text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_kod text;
  v_id  uuid;
begin
  if not app.has_access(p_tenant, 'settings.manage', p_branch) then
    raise exception 'Registrovat zařízení smí jen správce nastavení pobočky.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.branches b
    where b.id = p_branch and b.tenant_id = p_tenant and b.deleted_at is null
  ) then
    raise exception 'Pobočka nepatří téhle firmě.' using errcode = 'foreign_key_violation';
  end if;

  if length(btrim(coalesce(p_nazev, ''))) = 0 then
    raise exception 'Pojmenujte zařízení, ať se pozná („tablet u baru“).'
      using errcode = 'check_violation';
  end if;

  v_kod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.device_registrations
    (tenant_id, branch_id, nazev, code_hash, expires_at, created_by)
  values (
    p_tenant, p_branch, btrim(p_nazev),
    encode(sha256(convert_to(v_kod, 'UTF8')), 'hex'),
    now() + make_interval(mins => greatest(coalesce(p_minut, 15), 1)),
    (select auth.uid())
  )
  returning id into v_id;

  perform app.audit(p_tenant, 'device.kod', 'device_registration', v_id::text,
                    p_branch, null, jsonb_build_object('nazev', btrim(p_nazev)));

  return query select v_id, v_kod;
end;
$$;

revoke all on function public.vytvorit_registracni_kod(uuid, uuid, text, integer) from public, anon;
grant execute on function public.vytvorit_registracni_kod(uuid, uuid, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- REGISTRACE ZAŘÍZENÍ
--
-- Tohle volá TABLET, který nikoho přihlášeného nemá — proto je funkce
-- otevřená i pro `anon`. Autorizací je samotný kód: platí pár minut
-- a jde použít jednou.
--
-- Vrací servisní klíč. Jedinkrát; v databázi zůstane jen jeho otisk.
-- ---------------------------------------------------------------------

create or replace function public.registrovat_zarizeni(p_kod text)
returns table (device_id uuid, klic text, pobocka text, nazev text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_reg  record;
  v_klic text;
  v_id   uuid;
begin
  select * into v_reg
  from public.device_registrations r
  where r.code_hash = encode(sha256(convert_to(upper(btrim(coalesce(p_kod, ''))), 'UTF8')), 'hex')
  limit 1;

  -- Jedna hláška pro „neexistuje“, „už použitý“ i „vypršel“. Kdo kód
  -- hádá, se z odpovědi nedozví, jestli trefil.
  if v_reg.id is null or v_reg.used_at is not null or v_reg.expires_at < now() then
    raise exception 'Registrační kód neplatí. Nechte si vystavit nový.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_klic := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.branch_devices
    (tenant_id, branch_id, nazev, key_hash, created_by)
  values (
    v_reg.tenant_id, v_reg.branch_id, v_reg.nazev,
    encode(sha256(convert_to(v_klic, 'UTF8')), 'hex'),
    v_reg.created_by
  )
  returning id into v_id;

  update public.device_registrations
     set used_at = now(), device_id = v_id
   where id = v_reg.id;

  perform app.audit(v_reg.tenant_id, 'device.registrace', 'device', v_id::text,
                    v_reg.branch_id, null, jsonb_build_object('nazev', v_reg.nazev));

  return query
    select v_id, v_klic, b.name, v_reg.nazev
    from public.branches b where b.id = v_reg.branch_id;
end;
$$;

revoke all on function public.registrovat_zarizeni(text) from public;
grant execute on function public.registrovat_zarizeni(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- ZAŘÍZENÍ PODLE KLÍČE
--
-- Používají to všechny kioskové funkce. Odvolané zařízení nevrátí nic —
-- ztracený tablet přestane platit z jednoho místa.
--
-- Je v `app`, ne v `public`: kdyby ji šlo zavolat zvenčí, dala by se
-- s ní zkoušet platnost klíčů.
-- ---------------------------------------------------------------------

create or replace function app.zarizeni_podle_klice(p_klic text)
returns public.branch_devices
language sql stable security definer set search_path = ''
as $$
  select d.*
  from public.branch_devices d
  where d.key_hash = encode(sha256(convert_to(coalesce(p_klic, ''), 'UTF8')), 'hex')
    and d.stav = 'active'
  limit 1;
$$;

revoke all on function app.zarizeni_podle_klice(text) from public, anon, authenticated;
