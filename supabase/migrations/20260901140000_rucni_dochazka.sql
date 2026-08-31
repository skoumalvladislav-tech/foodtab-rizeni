-- =====================================================================
-- Foodtab — ruční zadání docházky
--
-- Zadání: docs/dochazka-qr-zadani.md, oddíl 4. Z celého toho zadání
-- dnes JEN ruční zadání; QR kiosk ne (docs/nocni-prace-2026-09-01.md).
--
-- Ruční zadání musí existovat — někdo zapomene telefon a odpracovaná
-- směna se nesmí ztratit. Ale NESMÍ VYPADAT STEJNĚ jako píchnutí.
-- Vedoucí má poznat pobočku, kde se „ručně“ zadává polovina docházky.
--
-- Tabulka `attendance_events` už `source = 'manual'` i `note` má, a
-- politika už ruční zápis drží na attendance.manage. Chybí trojí:
--
--   1. KDO ho zadal. Dosud se ukládal jen `corrected_by` u oprav.
--   2. PROČ. Poznámka je dnes nepovinná, u ručního zápisu být musí.
--   3. Audit. Píchnutí se neaudituje (byl by to log o statisících
--      řádcích), ruční zápis ano — je to výjimka a ta má být dohledatelná.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KDO TO ZADAL
--
-- Samostatný sloupec, ne `corrected_by`. Oprava a ruční zadání jsou dvě
-- různé věci: oprava mění existující událost, ruční zadání vyrábí
-- událost, která se nikdy nestala tak, jak se stát měla.
-- ---------------------------------------------------------------------

alter table public.attendance_events
  add column if not exists entered_by uuid references public.profiles(user_id) on delete set null;

comment on column public.attendance_events.entered_by is
  'Kdo zapsal ruční záznam. U píchnutí prázdné — tam je to ten člověk sám.';


-- ---------------------------------------------------------------------
-- PROČ
--
-- U ručního zápisu je poznámka povinná. „Zapomněl telefon“ je málo
-- slov, ale je to víc než nic — a hlavně to někoho donutí si to
-- uvědomit. Prázdná poznámka u ruční docházky znamená, že se to dělá
-- ze zvyku.
-- ---------------------------------------------------------------------

alter table public.attendance_events
  drop constraint if exists attendance_rucni_ma_duvod;
alter table public.attendance_events
  add constraint attendance_rucni_ma_duvod
  check (source <> 'manual' or length(btrim(note)) >= 3);


-- ---------------------------------------------------------------------
-- KDO ZADAL SE NEDÁ PODVRHNOUT
--
-- Doplňuje se spouští, ne z aplikace. Kdyby to posílal prohlížeč, dalo
-- by se do `entered_by` napsat jméno kolegy — a ruční docházka je přesně
-- ten záznam, u kterého se jednou někdo bude ptát, kdo ho pořídil.
--
-- U píchnutí se sloupec naopak vynuluje: tam žádný „zadavatel“ není.
-- ---------------------------------------------------------------------

create or replace function app.rucni_dochazka_kdo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.source = 'manual' then
    new.entered_by := (select auth.uid());
  else
    new.entered_by := null;
  end if;
  return new;
end;
$$;

revoke all on function app.rucni_dochazka_kdo() from public, anon, authenticated;

drop trigger if exists trg_rucni_dochazka_kdo on public.attendance_events;
create trigger trg_rucni_dochazka_kdo
  before insert or update on public.attendance_events
  for each row execute function app.rucni_dochazka_kdo();


-- ---------------------------------------------------------------------
-- AUDIT JEN NA VÝJIMKY
--
-- Píchnutí se neaudituje — u dvou provozoven by to znamenalo statisíce
-- řádků o tom, že všechno proběhlo normálně. Ruční zápis, oprava
-- i smazání docházky ano: to jsou zásahy člověka do cizí evidence
-- a ty musí být dohledatelné.
-- ---------------------------------------------------------------------

create or replace function app.audit_rucni_dochazky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_radek jsonb := to_jsonb(coalesce(new, old));
  v_akce  text;
begin
  -- Zajímá nás jen to, co nevzniklo píchnutím.
  if tg_op = 'INSERT' and new.source <> 'manual' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.source <> 'manual' and old.source <> 'manual'
     and new.occurred_at = old.occurred_at and new.kind = old.kind then
    return null;
  end if;

  v_akce := case tg_op
    when 'INSERT' then 'attendance.manual'
    when 'UPDATE' then 'attendance.oprava'
    else 'attendance.smazano'
  end;

  perform app.audit(
    (v_radek ->> 'tenant_id')::uuid,
    v_akce,
    'attendance',
    v_radek ->> 'id',
    (v_radek ->> 'branch_id')::uuid,
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end
  );

  return null;
end;
$$;

revoke all on function app.audit_rucni_dochazky() from public, anon, authenticated;

drop trigger if exists trg_audit_rucni_dochazky on public.attendance_events;
create trigger trg_audit_rucni_dochazky
  after insert or update or delete on public.attendance_events
  for each row execute function app.audit_rucni_dochazky();


-- ---------------------------------------------------------------------
-- ZAMĚSTNANEC SI RUČNÍ ZÁZNAM SÁM NEZADÁ
--
-- Politika `attendance_insert` to už drží: druhá větev pouští jen
-- `source = 'app'`. Tenhle komentář tu je proto, aby to při příští
-- úpravě politiky nikdo nerozvolnil — ruční zadání, které si člověk
-- udělá sám, obchází celý smysl píchání.
--
-- Politika se schválně NEMĚNÍ. Jen se ověřuje v testech.
-- ---------------------------------------------------------------------
