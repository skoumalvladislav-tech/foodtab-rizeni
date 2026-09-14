-- =====================================================================
-- Foodtab — modul Marketing: menu a jeho import
--
-- Zadání: master prompt, oddíl 10 („Import denního, týdenního
-- a víkendového menu").
--
-- ---------------------------------------------------------------------
-- PROČ MÁ MARKETING VLASTNÍ MENU, KDYŽ FOODTAB BUDE MÍT `menus.*`
--
-- Protože to, co se zveřejní, není totéž co jídelní lístek. Marketing
-- pracuje s NABÍDKOU NA KONKRÉTNÍ DEN, kterou někdo nafotil, opsal
-- z tabule nebo nahrál jako PDF — a ta se od receptur v provozu liší
-- pokaždé, když kuchař něco změní.
--
-- Až vznikne `menus.*` v provozu, bude z něj tohle brát podklad
-- (`zdroj = 'foodtab'`). Do té doby je to samostatný záznam, ne kopie
-- něčeho, co ještě neexistuje.
--
-- ---------------------------------------------------------------------
-- CENA V HALÉŘÍCH, A NULL ZNAMENÁ „NEVÍME"
--
-- CLAUDE.md, Konvence: peníze jako `integer` v haléřích. NULL je tu
-- ale důležitější než typ: znamená, že se cena NEROZPOZNALA.
--
-- Nula by byla „zdarma" a to je něco úplně jiného. Kdyby import psal
-- do neznámé ceny nulu, vyšel by příspěvek s „Svíčková 0 Kč" — a nikdo
-- by nepoznal, že to je chyba čtení, ne nabídka.
--
-- Zadání to říká výslovně: „AI nesmí domýšlet cenu, datum, alergen ani
-- složení. Nejasný údaj označí jako ,vyžaduje kontrolu'."
--
-- ---------------------------------------------------------------------
-- PŮVODNÍ PODKLAD SE ZACHOVÁVÁ
--
-- `puvodni_import` drží, co přišlo — vložený text nebo výsledek čtení
-- z fotky. Opravená verze je v položkách. Obojí vedle sebe schválně:
-- když se za měsíc ukáže, že se špatně přečetla cena, musí jít
-- dohledat, jestli chybu udělalo čtení, nebo člověk při opravě.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Žádná vazba na `marketing_prispevky`. Z jednoho menu vzniká víc
--   příspěvků (souhrn, carousel, Story na každý den) a cizí klíč
--   jedním směrem by je svazoval do jednoho. Příspěvek si menu zapíše
--   do `vstupy` své verze, kde je i otisk — takže je vidět, z čeho
--   přesně vznikl.
-- * Žádné `alter table ... add column` na cizí tabulce. Menu je nové,
--   ne rozšíření něčeho hotového.
-- =====================================================================


-- ---------------------------------------------------------------------
-- MENU
-- ---------------------------------------------------------------------

create table public.marketing_menu (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- Menu vždycky patří pobočce: Černá Perla a Bernard Bar vaří jinak.
  branch_id        uuid not null references public.branches(id) on delete cascade,

  druh             text not null default 'denni' check (druh in
                     ('denni', 'tydenni', 'vikendove', 'poledni', 'sezonni',
                      'napoje', 'dezerty', 'special')),
  nazev            text not null default '',
  plati_od         date,
  plati_do         date,

  -- Odkud to přišlo. `foodtab` je připravené na dobu, kdy bude menu
  -- v provozu; dnes se nepoužívá.
  zdroj            text not null default 'rucne' check (zdroj in
                     ('rucne', 'text', 'fotka', 'pdf', 'foodtab')),
  zdroj_media_id   uuid references public.marketing_media(id) on delete set null,
  -- Co přišlo, než to člověk opravil. Viz hlavička.
  puvodni_import   jsonb,

  stav             text not null default 'koncept' check (stav in
                     ('koncept', 'potvrzeno', 'archivovano')),
  mena             text not null default 'CZK',

  vytvoril         uuid references public.employees(id) on delete set null,
  potvrdil         uuid references public.employees(id) on delete set null,
  potvrzeno_kdy    timestamptz,
  vytvoreno_kdy    timestamptz not null default now(),
  zmeneno_kdy      timestamptz not null default now()
);

create index marketing_menu_pobocka
  on public.marketing_menu (tenant_id, branch_id, plati_od desc);

alter table public.marketing_menu enable row level security;

create policy marketing_menu_select on public.marketing_menu for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_menu_write on public.marketing_menu for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_menu to authenticated;
revoke all on public.marketing_menu from anon;

drop trigger if exists trg_audit_marketing_menu on public.marketing_menu;
create trigger trg_audit_marketing_menu
  after insert or update or delete on public.marketing_menu
  for each row execute function app.audit_zmenu('marketing_menu');


-- ---------------------------------------------------------------------
-- DNY
--
-- Týdenní menu má dny, denní ne. Prázdná tabulka u denního menu je
-- v pořádku — položky pak visí přímo na menu.
-- ---------------------------------------------------------------------

create table public.marketing_menu_dny (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  menu_id       uuid not null references public.marketing_menu(id) on delete cascade,

  den           date,
  nazev         text not null default '',
  poradi        integer not null default 0,

  vytvoreno_kdy timestamptz not null default now()
);

create index marketing_menu_dny_menu
  on public.marketing_menu_dny (menu_id, poradi);

alter table public.marketing_menu_dny enable row level security;

/*
  ROZSAH SE BERE Z RODIČE, NEKOPÍRUJE SE.

  Stejně jako u verzí příspěvku: pobočka je vlastnost menu a dvě kopie
  téhož údaje se rozejdou. `tenant_id` tu je jen kvůli auditu — bez něj
  `app.audit_zmenu` tiše mlčí (skill `migrace`, oddíl 4).
*/
create policy marketing_menu_dny_select on public.marketing_menu_dny for select to authenticated
  using (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_dny.menu_id
       and m.tenant_id = marketing_menu_dny.tenant_id
       and app.can_read_scoped(m.tenant_id, 'marketing.read', m.branch_id)));

create policy marketing_menu_dny_write on public.marketing_menu_dny for all to authenticated
  using (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_dny.menu_id
       and m.tenant_id = marketing_menu_dny.tenant_id
       and app.has_access(m.tenant_id, 'marketing.manage', m.branch_id)))
  with check (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_dny.menu_id
       and m.tenant_id = marketing_menu_dny.tenant_id
       and app.has_access(m.tenant_id, 'marketing.manage', m.branch_id)));

grant select, insert, update, delete on public.marketing_menu_dny to authenticated;
revoke all on public.marketing_menu_dny from anon;

drop trigger if exists trg_audit_marketing_menu_dny on public.marketing_menu_dny;
create trigger trg_audit_marketing_menu_dny
  after insert or update or delete on public.marketing_menu_dny
  for each row execute function app.audit_zmenu('marketing_menu_den');


-- ---------------------------------------------------------------------
-- POLOŽKY
-- ---------------------------------------------------------------------

create table public.marketing_menu_polozky (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  menu_id        uuid not null references public.marketing_menu(id) on delete cascade,
  -- NULL = položka visí přímo na menu (denní nabídka bez dnů).
  den_id         uuid references public.marketing_menu_dny(id) on delete cascade,

  kategorie      text not null default 'hlavni' check (kategorie in
                   ('polevka', 'predkrm', 'hlavni', 'dezert', 'napoj', 'ostatni')),
  nazev          text not null check (btrim(nazev) <> ''),
  popis          text not null default '',

  -- Haléře. NULL = NEROZPOZNÁNO, ne zdarma. Viz hlavička.
  cena_haleru    integer check (cena_haleru is null or cena_haleru >= 0),
  alergeny       text[] not null default array[]::text[],
  poznamka       text not null default '',

  dostupnost     text not null default 'k_dispozici' check (dostupnost in
                   ('k_dispozici', 'omezeno', 'vyprodano')),

  /*
    VYŽADUJE KONTROLU.

    Zadání, oddíl 10: „Nejasný údaj označí jako ,vyžaduje kontrolu'."
    Bez tohohle příznaku by se nepoznalo, co import uhádl a co přečetl
    — a obrazovka by nemohla poctivě říct, co si má člověk ověřit.
  */
  vyzaduje_kontrolu boolean not null default false,
  duvod_kontroly    text,

  poradi         integer not null default 0,
  vytvoreno_kdy  timestamptz not null default now()
);

create index marketing_menu_polozky_menu
  on public.marketing_menu_polozky (menu_id, poradi);

alter table public.marketing_menu_polozky enable row level security;

create policy marketing_menu_polozky_select on public.marketing_menu_polozky for select to authenticated
  using (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_polozky.menu_id
       and m.tenant_id = marketing_menu_polozky.tenant_id
       and app.can_read_scoped(m.tenant_id, 'marketing.read', m.branch_id)));

create policy marketing_menu_polozky_write on public.marketing_menu_polozky for all to authenticated
  using (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_polozky.menu_id
       and m.tenant_id = marketing_menu_polozky.tenant_id
       and app.has_access(m.tenant_id, 'marketing.manage', m.branch_id)))
  with check (exists (
    select 1 from public.marketing_menu m
     where m.id = marketing_menu_polozky.menu_id
       and m.tenant_id = marketing_menu_polozky.tenant_id
       and app.has_access(m.tenant_id, 'marketing.manage', m.branch_id)));

grant select, insert, update, delete on public.marketing_menu_polozky to authenticated;
revoke all on public.marketing_menu_polozky from anon;

drop trigger if exists trg_audit_marketing_menu_polozky on public.marketing_menu_polozky;
create trigger trg_audit_marketing_menu_polozky
  after insert or update or delete on public.marketing_menu_polozky
  for each row execute function app.audit_zmenu('marketing_menu_polozka');


-- ---------------------------------------------------------------------
-- POTVRZENÍ MENU
--
-- Zadání, oddíl 10: „Před uložením musí uživatel rozpoznaná data
-- potvrdit."
--
-- Je to funkce, ne prostý `update`, protože potvrzení musí jít ruku
-- v ruce s kontrolou, že nezůstala položka, která si o kontrolu říká.
-- Kdyby to dělala jen obrazovka, stačilo by jedno volání mimo ni.
-- ---------------------------------------------------------------------

create or replace function public.marketing_menu_potvrdit(p_menu uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_ja     uuid;
  v_sporne integer;
begin
  -- Uvnitř `security definer` se RLS neuplatní, filtr si děláme sami.
  select m.tenant_id, m.branch_id into v_tenant, v_branch
    from public.marketing_menu m where m.id = p_menu;

  if v_tenant is null then
    raise exception 'Menu neexistuje.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(v_tenant, 'marketing.manage', v_branch) then
    raise exception 'Nemáte oprávnění potvrzovat menu téhle provozovny.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_sporne
    from public.marketing_menu_polozky p
   where p.menu_id = p_menu and p.vyzaduje_kontrolu;

  if v_sporne > 0 then
    raise exception 'Zbývá % položek ke kontrole. Projděte je a teprve pak menu potvrďte.', v_sporne
      using errcode = 'check_violation';
  end if;

  select e.id into v_ja
    from public.employees e
   where e.user_id = (select auth.uid())
     and e.tenant_id = v_tenant
     and e.deleted_at is null;

  update public.marketing_menu
     set stav = 'potvrzeno',
         potvrdil = coalesce(v_ja, potvrdil),
         potvrzeno_kdy = now(),
         zmeneno_kdy = now()
   where id = p_menu;
end $$;

comment on function public.marketing_menu_potvrdit(uuid) is
  'Potvrdí menu po kontrole člověkem. Odmítne to, dokud zbývá položka '
  's příznakem „vyžaduje kontrolu" — import nic nedomýšlí a nepotvrzené '
  'menu se nemá dostat do příspěvku.';

revoke all on function public.marketing_menu_potvrdit(uuid) from public, anon;
grant execute on function public.marketing_menu_potvrdit(uuid) to authenticated;
