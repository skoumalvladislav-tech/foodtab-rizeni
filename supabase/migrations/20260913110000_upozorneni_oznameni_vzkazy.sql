-- =====================================================================
-- Foodtab — upozornění na nová oznámení a nové vzkazy
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 5 C2:
--   „nový vzkaz → adresátům"
--   „nové oznámení na nástěnce → adresátům"
--
-- PROČ TRIGGERY
--
-- Zápisy přicházejí jak přes aplikaci (server actions), tak
-- potenciálně přes joby nebo admin panel. Trigger zaručuje, že
-- upozornění odejde vždy, bez ohledu na cestu vložení.
--
-- PRAVIDLA (C3, docs/velka-prace-2026-09-08.md)
--
-- 1. V telu není obsah zprávy ani oznámení — jen datum. Čtení
--    zprávy přes rameno na baru by odhalilo, co si posílají kolegové.
-- 2. Vlastní zpráva neupozorňuje: autor != příjemce.
-- 3. Slučování (C4): delete nepřečtené + insert nové pro
--    (user_id, druh, den).
--
-- SCHÉMA
--
-- public.announcements: tenant_id, branch_id, employee_id (null=broadcast),
--   author_id (profiles.user_id)
-- public.konverzace_zpravy: konverzace_id, tenant_id, autor (employees.id),
--   vytvoreno_kdy
-- public.konverzace_ucastnici: konverzace_id, employee_id
-- public.employees: id, tenant_id, user_id (profiles.user_id), deleted_at
--
-- FILTRUJE SI TO SAMO (pravidlo 7b)
--
-- Obě funkce jsou SECURITY DEFINER s rolbypassrls. Každý dotaz
-- filtruje tenant_id a každá podmínka je napsaná jen jednou.
-- =====================================================================


-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ NA NOVÉ OZNÁMENÍ (trigger na public.announcements)
--
-- Komu:
--   employee_id vyplněno → jen tomu zaměstnanci (osobní zpráva)
--   branch_id vyplněno   → zaměstnancům té pobočky
--   oboje null           → všem zaměstnancům firmy
--
-- Druh: oznameni.nova
-- Telo: { "den": "2026-09-13" }  — bez obsahu (pravidlo 1)
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_oznameni_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.created_at at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       -- Vlastní oznámení neupozorňuje (C3/2): author_id = profiles.user_id.
       and (NEW.author_id is null or e.user_id <> NEW.author_id)
       -- Osobní → jen ten zaměstnanec; pobočkové → ta pobočka; firma → všichni.
       and (
         (NEW.employee_id is not null and e.id = NEW.employee_id)
         or (NEW.employee_id is null and NEW.branch_id is not null and e.branch_id = NEW.branch_id)
         or (NEW.employee_id is null and NEW.branch_id is null)
       )
  loop
    -- Sloučení (C4): smazat nepřečtené téhož druhu a dne.
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'oznameni.nova'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      NEW.branch_id,
      'oznameni.nova',
      jsonb_build_object('den', v_den)
    );
  end loop;

  return NEW;
end $$;

drop trigger if exists upozornit_na_oznameni on public.announcements;

create trigger upozornit_na_oznameni
  after insert on public.announcements
  for each row execute function app.upozornit_na_oznameni_trg();

comment on function app.upozornit_na_oznameni_trg() is
  'Po vložení oznámení na nástěnku zapíše oznameni.nova adresátům. '
  'Osobní zpráva (employee_id) → jen tomu zaměstnanci; pobočkové → '
  'zaměstnanci pobočky; firemní → všem. Mergeuje (user_id, druh, den). '
  'Vlastní oznámení se neupozorňuje (author_id).';


-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ NA NOVÝ VZKAZ (trigger na public.konverzace_zpravy)
--
-- Upozorní ostatní účastníky konverzace.
-- Druh: vzkaz.novy
-- Telo: { "den": "2026-09-13" }
--
-- Účastníci jsou v public.konverzace_ucastnici (employee_id).
-- Přes employees.user_id se dostaneme na příjemce notifikace.
-- Kdo z konverzace odešel (odesel_kdy not null), upozornění nedostane.
-- Stornované zprávy: trigger na INSERT — stornovano_kdy je vždy null.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.konverzace_ucastnici ku
      join public.employees e on e.id = ku.employee_id
     where ku.konverzace_id = NEW.konverzace_id
       and ku.odesel_kdy    is null
       and e.user_id        is not null
       and e.deleted_at     is null
       and e.tenant_id      = NEW.tenant_id
       -- Vlastní zpráva neupozorňuje (C3/2): autor = employees.id.
       and (NEW.autor is null or ku.employee_id <> NEW.autor)
  loop
    -- Sloučení (C4): smazat nepřečtené téhož druhu a dne.
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'vzkaz.novy'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      null,
      'vzkaz.novy',
      jsonb_build_object('den', v_den)
    );
  end loop;

  return NEW;
end $$;

drop trigger if exists upozornit_na_vzkaz on public.konverzace_zpravy;

create trigger upozornit_na_vzkaz
  after insert on public.konverzace_zpravy
  for each row execute function app.upozornit_na_vzkaz_trg();

comment on function app.upozornit_na_vzkaz_trg() is
  'Po vložení zprávy zapíše vzkaz.novy ostatním účastníkům konverzace. '
  'Mergeuje (user_id, druh, den). Vlastní zpráva se neupozorňuje (autor). '
  'Kdo z konverzace odešel (odesel_kdy), upozornění nedostane.';
