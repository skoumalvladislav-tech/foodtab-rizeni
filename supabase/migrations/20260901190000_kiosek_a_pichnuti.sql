-- =====================================================================
-- Foodtab — kiosek s měnícím se kódem a konec přímého zápisu docházky
--
-- Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíly 3 a 5, body 3 a 4
-- pořadí. Jsou v JEDNÉ migraci schválně: kdyby se zákaz přímého zápisu
-- nasadil později, zůstala by otevřená cesta, kterou kiosek obchází,
-- a celý kiosek by byl na nic.
--
-- Píchnutí smí od téhle chvíle vzniknout jen třemi cestami:
--
--   měnící se kód   platný kód pobočky, ne starší než doba platnosti
--   PIN na kiosku   registrované zařízení pobočky + PIN
--   ruční zadání    attendance.manage, důvod a audit (už hotové)
--
-- Do té doby si zaměstnanec mohl sám zapsat příchod s LIBOVOLNÝM ČASEM
-- a nebyl nijak označený, protože formálně šlo o řádné píchnutí.
-- Dokud byla docházka evidence, byla to drobnost. Teď se z ní počítá
-- mzda a zálohy.
-- =====================================================================


-- ---------------------------------------------------------------------
-- ODKUD PÍCHNUTÍ PŘIŠLO
--
-- `mimo_rozpis` je rozhodnutí ze zadání (oddíl 11 bod 2): píchnout smí
-- i ten, kdo dnes v rozpisu není — záskok se stává běžně a odmítnuté
-- píchnutí by znamenalo neplacenou práci. Ale vedoucí to má v přehledu
-- poznat.
-- ---------------------------------------------------------------------

alter table public.attendance_events
  add column if not exists device_id   uuid references public.branch_devices(id) on delete set null,
  add column if not exists mimo_rozpis boolean not null default false;

comment on column public.attendance_events.mimo_rozpis is
  'Píchnutí bez směny v rozpisu. Nezakazuje se — záskok je běžný — ale '
  'musí být vidět.';


-- ---------------------------------------------------------------------
-- MĚNÍCÍ SE KÓD
--
-- Odvozuje se z tajemství pobočky a z časového okna. Vyfocený kód je za
-- minutu neplatný a to je celý smysl. Tajemství neopustí server: ven jde
-- hotový kód.
--
-- Přijímá se okno současné i předchozí. Kdo načte kód ve chvíli, kdy se
-- přepíná, by jinak neuspěl a nechápal proč.
-- ---------------------------------------------------------------------

create or replace function app.kiosk_kod(p_branch uuid, p_okno bigint)
returns text
language sql stable security definer set search_path = ''
as $$
  select upper(substr(
    encode(sha256(convert_to(b.kiosk_secret || ':' || p_okno::text, 'UTF8')), 'hex'), 1, 8))
  from public.branches b
  where b.id = p_branch;
$$;

revoke all on function app.kiosk_kod(uuid, bigint) from public, anon, authenticated;

create or replace function app.kiosk_okno(p_branch uuid, p_at timestamptz default now())
returns bigint
language sql stable security definer set search_path = ''
as $$
  select floor(extract(epoch from p_at) / greatest(b.kiosk_kod_vterin, 1))::bigint
  from public.branches b where b.id = p_branch;
$$;

revoke all on function app.kiosk_okno(uuid, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SPOLEČNÝ ZÁPIS PÍCHNUTÍ
--
-- Jedno místo pro obě cesty. Dvojí načtení nezaloží dva příchody:
-- stejný druh od téhož člověka na téže pobočce do dvou minut se bere
-- jako totéž píchnutí a vrátí se ten původní.
-- ---------------------------------------------------------------------

create or replace function app.pichnout(
  p_tenant uuid,
  p_branch uuid,
  p_employee uuid,
  p_druh text,
  p_device uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_den    date := app.business_date(p_branch, now());
  v_mimo   boolean;
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
  order by a.occurred_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select not exists (
    select 1 from public.shifts s
    where s.employee_id = p_employee
      and s.branch_id = p_branch
      and s.shift_date = v_den
      and s.status <> 'cancelled'
  ) into v_mimo;

  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, source, device_id, mimo_rozpis)
  values (p_tenant, p_branch, p_employee, p_druh, 'app', p_device, v_mimo)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app.pichnout(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- PÍCHNUTÍ KÓDEM — vlastním telefonem
--
-- Kód se ověřuje proti pobočce, ke které patří. Kód jedné pobočky
-- nepíchne na druhé: hledá se jen mezi pobočkami té firmy a porovnává
-- se s kódem TÉ pobočky.
-- ---------------------------------------------------------------------

create or replace function public.pichnout_kodem(
  p_tenant uuid,
  p_kod    text,
  p_druh   text default 'in'
)
returns table (udalost uuid, pobocka text, mimo_rozpis boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_kod   text := upper(btrim(coalesce(p_kod, '')));
  v_emp   uuid;
  v_bran  uuid;
  v_id    uuid;
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

  v_id := app.pichnout(p_tenant, v_bran, v_emp, p_druh, null);

  return query
    select v_id, b2.name, a.mimo_rozpis
    from public.attendance_events a
    join public.branches b2 on b2.id = a.branch_id
    where a.id = v_id;
end;
$$;

revoke all on function public.pichnout_kodem(uuid, text, text) from public, anon;
grant execute on function public.pichnout_kodem(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- CO VIDÍ KIOSEK
--
-- Krátký seznam ze zadání, oddíl 2: měnící se kód, kdo má dnes na téhle
-- pobočce směnu, a nic dalšího. Žádné mzdy, žádné kontakty, žádný rozpis
-- jiné pobočky — a to ani přímým voláním, protože tahle funkce je
-- jediné, co zařízení s klíčem vůbec zavolá.
--
-- Seznam jmen je rozhodnutí ze zadání (oddíl 11 bod 1): jen lidé, kteří
-- tam dnes mají směnu. Tablet často stojí tak, že na něj vidí i host,
-- a seznam všech zaměstnanců pobočky na pult nepatří. Kdo zaskakuje,
-- zadá PIN bez jména a projde stejně.
-- ---------------------------------------------------------------------

create or replace function public.kiosk_stav(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d       public.branch_devices;
  v_okno  bigint;
  v_den   date;
  v_jmena jsonb;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_okno := app.kiosk_okno(d.branch_id);
  v_den  := app.business_date(d.branch_id, now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'jmeno', e.full_name,
           'od', s.starts_at,
           'do', s.ends_at
         ) order by s.starts_at), '[]'::jsonb)
    into v_jmena
  from public.shifts s
  join public.employees e on e.id = s.employee_id
  where s.branch_id = d.branch_id
    and s.shift_date = v_den
    and s.status <> 'cancelled'
    and e.deleted_at is null;

  return jsonb_build_object(
    'pobocka',  (select b.name from public.branches b where b.id = d.branch_id),
    'zarizeni', d.nazev,
    'kod',      app.kiosk_kod(d.branch_id, v_okno),
    'platnost', (select b.kiosk_kod_vterin from public.branches b where b.id = d.branch_id),
    'den',      v_den,
    'smeny',    v_jmena
  );
end;
$$;

revoke all on function public.kiosk_stav(text) from public;
grant execute on function public.kiosk_stav(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- PÍCHNUTÍ PINEM NA KIOSKU
--
-- Autorizací je DVOJICE: registrované zařízení a PIN. Samotný PIN
-- nestačí — čtyři číslice vidí kolega přes rameno.
-- ---------------------------------------------------------------------

create or replace function public.pichnout_pinem(
  p_klic text,
  p_pin  text,
  p_druh text default 'in'
)
returns table (ok boolean, udalost uuid, jmeno text, mimo_rozpis boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_emp uuid;
  v_id  uuid;
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
    return query select false, null::uuid, null::text, null::boolean;
    return;
  end if;

  v_id := app.pichnout(d.tenant_id, d.branch_id, v_emp, p_druh, d.id);

  update public.branch_devices set posledni_kdy = now() where id = d.id;

  return query
    select true, v_id, e.full_name, a.mimo_rozpis
    from public.attendance_events a
    join public.employees e on e.id = a.employee_id
    where a.id = v_id;
end;
$$;

revoke all on function public.pichnout_pinem(text, text, text) from public;
grant execute on function public.pichnout_pinem(text, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- KONEC PŘÍMÉHO ZÁPISU DOCHÁZKY ZA SEBE
--
-- Tohle je bod 4 a je tady schválně ve stejné migraci jako kiosek.
--
-- Původní politika měla druhou větev: `source = 'app'` a vlastní
-- employee_id. Znamenalo to, že si člověk mohl přímým voláním rozhraní
-- založit příchod k 1. červenci ve 3:00 — a nebyl nijak označený.
--
-- Zůstává jediná větev: attendance.manage. Píchnutí kódem i PINem chodí
-- přes security definer funkce výš, na které se RLS nevztahuje, takže
-- jim to nevadí.
-- ---------------------------------------------------------------------

drop policy if exists attendance_insert on public.attendance_events;

create policy attendance_insert on public.attendance_events for insert to authenticated
  with check (app.has_access(tenant_id, 'attendance.manage', branch_id));

comment on policy attendance_insert on public.attendance_events is
  'Přímý zápis smí jen správce docházky, a to jako ruční záznam. '
  'Vlastní píchnutí chodí přes kód nebo PIN — jinak si každý zapíše '
  'libovolný čas a z toho se počítá mzda.';
