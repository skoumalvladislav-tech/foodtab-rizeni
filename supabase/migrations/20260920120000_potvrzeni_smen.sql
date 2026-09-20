-- =====================================================================
-- Foodtab — potvrzení směny zaměstnancem (puntík u času směny)
--
-- Zadání: Šéfík 20. 9. 2026 — puntík u času směny je červený (nevydáno),
-- žlutý (vydáno, nepotvrzeno) nebo zelený (vydáno a potvrzeno). A
-- „potvrzeno“ má být skutečné potvrzení, ne odvozenina: zaměstnanec
-- směnu potvrdí tlačítkem a má o tom vlastní záznam.
--
-- ---------------------------------------------------------------------
-- 1. PROČ VLASTNÍ TABULKA A NE `notifications`
--
-- První návrh četl potvrzení z upozornění (`acknowledged_at`, `read_at`).
-- Nedrží se to pohromadě, a kontrola to ukázala na skutečných datech:
--
--  * nová směna žádné tlačítko k potvrzení nemá, takže se bralo její
--    „přečtení“ — a to nastaví i tlačítko „Označit všech N za přečtené“,
--    aniž člověk směnu viděl;
--  * upozornění vzniká už při uložení konceptu, ne při vydání;
--  * po přeřazení směny zůstane upozornění původního člověka a puntík by
--    zezelenal u nového, který o ničem neví;
--  * import z Excelu mění čas vydané směny bez upozornění;
--  * slučování upozornění (`app.upozornit_smenu`) maže upozornění jiné
--    směny téhož dne.
--
-- Potvrzení směny je proto samostatná věc s vlastním záznamem.
--
-- ---------------------------------------------------------------------
-- 2. CO POTVRZENÍ JE
--
-- Řádek `smeny_potvrzeni`: kdo (zaměstnanec), kterou směnu a KDY — a
-- OPIS SMĚNY, kterou potvrdil (den, časy, pauza). Potvrzení platí, jen
-- dokud se směna s opisem shoduje. Změní-li se čas, den, pauza nebo
-- člověk, potvrzení tiše zneplatní a směna je zase „vydáno, nepotvrzeno“
-- — bez příznaku, který by někdo zapomněl shodit, a bez upozornění, které
-- by se muselo napsat. Vrátí-li se změna zpátky, potvrzení platí zas.
--
-- Vydání rozpisu beze změn potvrzení NEruší (nemění se opis) — kdyby se
-- rušilo při každém vydání, byla by po každém vydání celá mřížka žlutá.
--
-- ---------------------------------------------------------------------
-- 3. KDO CO SMÍ (dvě obranné linie)
--
--  * PSÁT jde jen přes `potvrdit_smenu` (security definer, tabulka nemá
--    žádný grant na zápis ani zápisovou politiku). Funkce si sama ověří:
--    firmu a její modul, že volající je zaměstnanec téhle firmy, že je to
--    JEHO směna, a že je vydaná a od vydání se nezměnila (potvrdit jde jen
--    znění, které člověk opravdu dostal).
--  * ČÍST smí člověk své vlastní potvrzení a vedoucí potvrzení na pobočkách,
--    kde plánuje (`shifts.manage`). Politika, ne funkce — čtou se přímo
--    dotazem na tabulku, takže RLS platí.
--
-- Zaměstnanec bez účtu (kuchyň přes kiosek) potvrdit nemůže; aplikace mu
-- puntík vydané směny nekreslí, není komu ji potvrdit.
--
-- Nasazuje Šéfík. Přidává tabulku a funkci, na data nesahá.
-- =====================================================================


-- ---------------------------------------------------------------------
-- TABULKA
-- ---------------------------------------------------------------------

/*
  Bez `if not exists` — pravidlo z CLAUDE.md: srážka jmen má spadnout
  nahlas a hned.
*/
create table public.smeny_potvrzeni (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- Pobočka směny, opsaná při potvrzení: politika na ni čte bez joinu.
  branch_id   uuid not null references public.branches(id) on delete cascade,
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- Opis potvrzené směny. Potvrzení platí, jen dokud se s ním směna shoduje.
  shift_date  date not null,
  starts_at   time not null,
  ends_at     time not null,
  pauza_od    time,
  pauza_do    time,
  confirmed_at timestamptz not null default now(),
  constraint smeny_potvrzeni_jedno unique (shift_id, employee_id)
);

comment on table public.smeny_potvrzeni is
  'Zaměstnanec potvrdil směnu. Nese opis potvrzené směny (den, časy, pauza); '
  'potvrzení platí, jen dokud se směna s opisem shoduje. Zapisuje se jen '
  'funkcí potvrdit_smenu.';

create index smeny_potvrzeni_okno
  on public.smeny_potvrzeni (tenant_id, branch_id, shift_date);

alter table public.smeny_potvrzeni enable row level security;

/*
  Čte člověk své vlastní potvrzení a ten, kdo na pobočce směny plánuje.
  Zápisová politika záměrně chybí: zapisuje jen `potvrdit_smenu`.
*/
drop policy if exists smeny_potvrzeni_read on public.smeny_potvrzeni;
create policy smeny_potvrzeni_read on public.smeny_potvrzeni for select to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = smeny_potvrzeni.employee_id
        and e.user_id = (select auth.uid())
    )
    or app.has_access(tenant_id, 'shifts.manage', branch_id)
  );

/*
  Grant je JEN na čtení. Politika říká, které řádky člověk uvidí; bez
  grantu by dostal „permission denied“ dřív, než se politika zeptá.
  Zápis nemá grant vůbec — chodí se přes `potvrdit_smenu`.
*/
revoke all on public.smeny_potvrzeni from public, anon, authenticated;
grant select on public.smeny_potvrzeni to authenticated;


-- ---------------------------------------------------------------------
-- POTVRDIT SMĚNU
-- ---------------------------------------------------------------------

create or replace function public.potvrdit_smenu(
  p_tenant uuid,
  p_smena  uuid
)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
  v_s   public.shifts%rowtype;
  v_kdy timestamptz;
begin
  -- Modul a členství: stejné pravidlo jako u obrazovky Dnes (muj_den).
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Směny v téhle firmě nemůžete potvrzovat.'
      using errcode = 'insufficient_privilege';
  end if;

  select e.id into v_emp
    from public.employees e
   where e.tenant_id = p_tenant
     and e.user_id = (select auth.uid())
     and e.deleted_at is null
   limit 1;

  if v_emp is null then
    raise exception 'Nemáte v téhle firmě zaměstnanecký záznam.'
      using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_s
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant
     for share;

  -- Cizí směna a neexistující směna dávají tutéž odpověď: nedá se zkoušet,
  -- jaká id existují.
  if not found or v_s.employee_id is distinct from v_emp then
    raise exception 'Tuhle směnu nemůžete potvrdit.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Jen vydané znění: směna vydaná a od vydání beze změny (totéž, co
  -- v aplikaci znamená „vydaná“ — viz app.rozdil_rozpisu).
  if v_s.status = 'cancelled'
     or v_s.published_at is null
     or coalesce(v_s.published_status, '') = 'cancelled'
     or v_s.published_employee_id is distinct from v_s.employee_id
     or v_s.published_starts_at is distinct from v_s.starts_at
     or v_s.published_ends_at is distinct from v_s.ends_at then
    raise exception 'Směna ještě není vydaná, nebo se od vydání změnila. Potvrdit jde jen vydané znění.'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into public.smeny_potvrzeni as p (
    tenant_id, branch_id, shift_id, employee_id,
    shift_date, starts_at, ends_at, pauza_od, pauza_do
  ) values (
    p_tenant, v_s.branch_id, v_s.id, v_emp,
    v_s.shift_date, v_s.starts_at, v_s.ends_at, v_s.pauza_od, v_s.pauza_do
  )
  on conflict (shift_id, employee_id) do update set
    branch_id  = excluded.branch_id,
    shift_date = excluded.shift_date,
    starts_at  = excluded.starts_at,
    ends_at    = excluded.ends_at,
    pauza_od   = excluded.pauza_od,
    pauza_do   = excluded.pauza_do,
    -- Potvrdil-li totéž znovu, čas potvrzení se nemění.
    confirmed_at = case
      when row(p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
           is not distinct from
           row(excluded.shift_date, excluded.starts_at, excluded.ends_at, excluded.pauza_od, excluded.pauza_do)
      then p.confirmed_at
      else now()
    end
  returning confirmed_at into v_kdy;

  return v_kdy;
end;
$$;

comment on function public.potvrdit_smenu(uuid, uuid) is
  'Zaměstnanec potvrdí SVOU vydanou směnu. Zapíše opis směny; potvrzení platí, '
  'dokud se směna s opisem shoduje. Jediná cesta, jak do smeny_potvrzeni zapsat.';

revoke all on function public.potvrdit_smenu(uuid, uuid) from public, anon;
grant execute on function public.potvrdit_smenu(uuid, uuid) to authenticated;
