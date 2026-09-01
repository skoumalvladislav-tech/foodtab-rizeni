-- =====================================================================
-- Foodtab — poslední majitel se nesmí dát odebrat
--
-- Zadání: docs/vlastniku-muze-byt-vic.md.
--
-- Majitelů může být víc: firma má jednu roli Majitel, ale členství k ní
-- může mít libovolně mnoho lidí. Schéma to unese bez změny.
--
-- Co chybí, je zábrana proti tomu, aby firma zůstala BEZ majitele. Když
-- jsou majitelé dva, jeden druhého odebere; zůstane poslední a toho nic
-- nechrání. Firma pak nemá majitele a nikdo zevnitř to nespraví —
-- přidělovat oprávnění smí jen ten, kdo je má sám. Jediná cesta ven
-- vede přes zásah do databáze.
--
-- ---------------------------------------------------------------------
-- PROČ SPOUŠŤ, A NE POLITIKA
--
-- Politika na DELETE se chová tak, že řádek prostě není vidět: příkaz
-- smaže NULA řádků a neohlásí nic. Vypadá to jako úspěch a člověk si
-- myslí, že majitele odebral.
--
-- Zadání je na tomhle výslovné: „Ne tiché neprovedení.“ Spoušť umí
-- vyhodit chybu s větou, která říká proč — politika ne.
--
-- ---------------------------------------------------------------------
-- CO SE HLÍDÁ
--
--   memberships  smazání i změna (role pryč od majitele, nebo status
--                jiný než active)
--   employees    označení za smazaného, když na tom zaměstnanci visí
--                účet posledního majitele
--
-- Nehlídá se přidání majitele: těch může být kolik chce.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KOLIK MÁ FIRMA AKTIVNÍCH MAJITELŮ
--
-- Kromě jednoho členství, které se zrovna ruší nebo mění. Volající
-- pošle jeho id — jinak by se počítalo i to, co za chvíli nebude.
--
-- `security definer` je tu nutné: spoušť běží právům volajícího
-- napospas a ten na cizí členství nevidí. Bez toho by kontrola u někoho
-- napočítala nulu majitelů i tam, kde jsou dva.
-- ---------------------------------------------------------------------

create or replace function app.pocet_majitelu(p_tenant uuid, p_krome uuid default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
  from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and r.is_owner
    and (p_krome is null or m.id <> p_krome)
    /*
      Zaměstnanecký záznam je VOLITELNÝ (§5.2 specifikace) a zadání to
      říká taky: hlídá se označení za smazaného, „pokud je na něj
      navázaný“. Majitel bez zaměstnance je tedy pořád majitel.

      Prostý `join employees` by ho nezapočítal a firma s jediným takovým
      majitelem by hlásila nula majitelů — každé odebrání by se odmítlo
      a nikdo by nechápal proč.
    */
    and (
      not exists (
        select 1 from public.employees e
        where e.tenant_id = m.tenant_id and e.user_id = m.user_id
      )
      or exists (
        select 1 from public.employees e
        where e.tenant_id = m.tenant_id and e.user_id = m.user_id
          and e.deleted_at is null
      )
    );
$$;

comment on function app.pocet_majitelu(uuid, uuid) is
  'Kolik má firma aktivních majitelů. Kdo má zaměstnanecký záznam, musí '
  'ho mít živý; kdo žádný nemá, počítá se stejně. Volitelně bez jednoho '
  'členství — toho, které se zrovna ruší.';

revoke all on function app.pocet_majitelu(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- HLÍDAČ NA ČLENSTVÍ
--
-- Chytá tři cesty ven ze zadání: smazání členství, přeřazení na jinou
-- roli a pozastavení (status). Poslední bod není v zadání vyjmenovaný,
-- ale je to tatáž díra: pozastavený majitel není aktivní majitel.
-- ---------------------------------------------------------------------

create or replace function app.hlida_posledniho_majitele()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_byl_majitel boolean;
  v_je_majitel  boolean;
begin
  select r.is_owner into v_byl_majitel
  from public.roles r where r.id = old.role_id;

  -- Členství bez role nebo neaktivní majitelem nebylo; jeho zánik firmu
  -- o majitele nepřipraví.
  if not coalesce(v_byl_majitel, false) or old.status <> 'active' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select r.is_owner into v_je_majitel
    from public.roles r where r.id = new.role_id;

    -- Zůstává majitelem a aktivní? Pak se nic neubírá.
    if coalesce(v_je_majitel, false) and new.status = 'active' then
      return new;
    end if;
  end if;

  if app.pocet_majitelu(old.tenant_id, old.id) = 0 then
    raise exception
      'Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_posledni_majitel on public.memberships;
create trigger trg_posledni_majitel
  before delete or update on public.memberships
  for each row execute function app.hlida_posledniho_majitele();


-- ---------------------------------------------------------------------
-- HLÍDAČ NA ZAMĚSTNANCI
--
-- Mazání lidí je označení, ne výmaz (pravidlo 9). Označit posledního
-- majitele za smazaného je ale třetí cesta, jak firmu o majitele
-- připravit — jeho členství zůstane, ale člověk je pryč.
--
-- Hlídá se jen přechod „živý → smazaný“. Úprava jména smazaného
-- zaměstnance ani jeho vzkříšení nikomu nevadí.
-- ---------------------------------------------------------------------

create or replace function app.hlida_majitele_u_zamestnance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_clenstvi uuid;
begin
  if old.deleted_at is not null or new.deleted_at is null then
    return new;
  end if;

  if new.user_id is null then
    return new;
  end if;

  select m.id into v_clenstvi
  from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.tenant_id = new.tenant_id
    and m.user_id = new.user_id
    and m.status = 'active'
    and r.is_owner;

  if v_clenstvi is null then
    return new;
  end if;

  if app.pocet_majitelu(new.tenant_id, v_clenstvi) = 0 then
    raise exception
      'Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posledni_majitel_zamestnanec on public.employees;
create trigger trg_posledni_majitel_zamestnanec
  before update on public.employees
  for each row execute function app.hlida_majitele_u_zamestnance();


-- ---------------------------------------------------------------------
-- PRŮZOR PRO OBRAZOVKU
--
-- Druhá obranná linie je jen pohodlí (pravidlo 3): tlačítko Odebrat se
-- u posledního majitele nenabídne a je u toho vysvětlení. Rozhodnutí
-- padá ve spoušti výš.
--
-- Vrací počet, ne ano/ne: obrazovka podle něj píše „jste jediný
-- majitel“ i „majitelé jsou dva“, a kdyby vracel jen pravdivostní
-- hodnotu, musela by se ptát dvakrát.
-- ---------------------------------------------------------------------

create or replace function public.pocet_majitelu(p_tenant uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when app.is_member(p_tenant) then app.pocet_majitelu(p_tenant, null)
    else 0
  end;
$$;

comment on function public.pocet_majitelu(uuid) is
  'Kolik má firma aktivních majitelů. Pro vykreslení — rozhodnutí padá '
  've spoušti na memberships.';

revoke all on function public.pocet_majitelu(uuid) from public, anon;
grant execute on function public.pocet_majitelu(uuid) to authenticated;
