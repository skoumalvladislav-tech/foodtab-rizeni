-- =====================================================================
-- Foodtab — barva u člověka
--
-- Zadání docs/barva-u-cloveka-zadani.md. Vytahuje dopředu půlku bodu 4
-- z docs/nocni-prace-2026-09-03.md.
--
-- ---------------------------------------------------------------------
-- ŘÁDEK V DATABÁZI, NE VÝPOČET ZE JMÉNA
--
-- Barva se NEPOČÍTÁ z jména ani z id. Pravidlo 1: co má zákazník moct
-- změnit, je řádek v databázi. Spočítaná barva se změnit nedá — a při
-- přejmenování by se tiše přehodila.
--
-- Ukládá se KLÍČ z palety, ne hodnota v hexu. Stejně jako u poboček:
-- odstíny pak drží pohromadě se zbytkem rozhraní a nikdo si nenastaví
-- svítivě žlutou na bílém pozadí.
--
-- ---------------------------------------------------------------------
-- DEVĚT BAREV, DVANÁCT LIDÍ
--
-- Paleta má devět odstínů a hranice odlišitelnosti je ΔE2000 15 na
-- světlém a 14 na tmavém (scripts/barvy.js). Lidí je dvanáct, takže na
-- první pohled to nevychází.
--
-- Vychází, když se ptáme správně: barvy se nemusí lišit napříč firmou,
-- jen v jednom kalendáři. A ten je vždycky za jednu pobočku — Černá
-- Perla má osm lidí, Bernard Bar čtyři. Obojí se do devíti vejde.
--
-- Proto se jedinečnost hlídá v rámci POBOČKY, ne firmy.
--
-- ---------------------------------------------------------------------
-- KDYŽ DOJDOU, ČLOVĚK ZŮSTANE BEZ BARVY
--
-- Nepřiděluje se potichu podruhé. Dvě různé Aničky v téže barvě jsou
-- horší než žádná barva: první je klam, druhá je jen chybějící pomůcka.
-- Jméno je v rozpisu napsané tak jako tak — barva je pomůcka pro rychlé
-- přehlédnutí, ne nositel informace.
-- =====================================================================


-- Bez NOT NULL a bez DEFAULT: prázdno je platný stav. Znamená „tenhle
-- člověk barvu nemá“ — buď ji někdo schválně smazal, nebo při jeho
-- založení už žádná volná nezbyla.
alter table public.employees
  add column if not exists color text
    check (color in ('firma', 'slate', 'indigo', 'violet', 'sky',
                     'teal', 'emerald', 'amber', 'rose'));

comment on column public.employees.color is
  'Klíč z palety rozhraní, ne hodnota barvy. Prázdné je platný stav: '
  'člověk barvu nemá. Jedinečnost platí v rámci pobočky, ne firmy — '
  'kalendář je vždycky za jednu pobočku.';


/*
  JEDINEČNOST V RÁMCI POBOČKY

  `nulls not distinct` je tu podstatné kvůli `branch_id`: lidé bez
  domovské pobočky („firemní“) tvoří vlastní skupinu a mezi sebou se
  taky lišit mají. Bez toho by dva NULLy platily za různé pobočky
  a firemní lidé by mohli mít barvu společnou.

  Smazaní se nepočítají — jejich barva se má uvolnit pro dalšího.
*/
create unique index if not exists employees_barva_pobocka
  on public.employees (tenant_id, branch_id, color)
  nulls not distinct
  where color is not null and deleted_at is null;


-- ---------------------------------------------------------------------
-- PŘIDĚLENÍ PŘI ZALOŽENÍ
--
-- Spouští, ne aplikace. Zaměstnanci vznikají na třech místech (obrazovka
-- Lidé, hromadné nahrání, přijatá pozvánka) a čtvrté přibude. Kdyby to
-- doplňovala aplikace, jedno z těch míst se zapomene — a pozná se to až
-- podle člověka, který v kalendáři nemá barvu a nikdo neví proč.
-- ---------------------------------------------------------------------

create or replace function app.prirad_barvu_cloveku()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  /*
    Pořadí je od nejodlišitelnějších k nejbližším: první čtyři se od
    sebe liší nejvíc, takže malá firma o třech lidech dostane barvy,
    které si nikdo neplete. `firma` je až poslední — je to přízvuk
    firemní úrovně rozhraní a u člověka má padnout jen tehdy, když
    ostatní došly.
  */
  c_paleta constant text[] := array['indigo', 'amber', 'emerald', 'rose',
                                    'sky', 'violet', 'teal', 'slate', 'firma'];
  v_volna text;
begin
  -- Zadanou barvu nepřepisujeme. Kdo ji vybral, ten ji chtěl; a prázdno
  -- při ÚPRAVĚ je taky volba — proto je spouštěč jen na insert.
  if new.color is not null then
    return new;
  end if;

  /*
    Nejdřív barva, kterou nemá nikdo v celé firmě.

    Jedinečnost se vynucuje jen v rámci pobočky, ale když je z čeho
    brát, ať se lidé liší i napříč pobočkami: v rozpisu za celou firmu
    je pak vidět totéž co v tom pobočkovém. Dokud je lidí méně než
    devět, vyjde to; pak se spadne o krok níž.
  */
  select b into v_volna
  from unnest(c_paleta) with ordinality as p(b, i)
  where not exists (
    select 1 from public.employees e
    where e.tenant_id = new.tenant_id
      and e.deleted_at is null
      and e.color = p.b
  )
  order by p.i
  limit 1;

  -- Když firma barvy vyčerpala, stačí volná na TÉHLE pobočce.
  if v_volna is null then
    select b into v_volna
    from unnest(c_paleta) with ordinality as p(b, i)
    where not exists (
      select 1 from public.employees e
      where e.tenant_id = new.tenant_id
        and e.branch_id is not distinct from new.branch_id
        and e.deleted_at is null
        and e.color = p.b
    )
    order by p.i
    limit 1;
  end if;

  /*
    A když ani tak, zůstane prázdná. ŽÁDNÉ TOČENÍ DOKOLA — u poboček se
    paleta točí, protože dvě pobočky téže barvy se pozná podle názvu
    v hlavičce, ale dva lidé téže barvy v jednom kalendáři vypadají jako
    jeden člověk. Prázdno je poctivější: je vidět, že barvy došly.
  */
  new.color := v_volna;
  return new;
end;
$$;

drop trigger if exists trg_barva_cloveka on public.employees;
create trigger trg_barva_cloveka
  before insert on public.employees
  for each row execute function app.prirad_barvu_cloveku();


-- ---------------------------------------------------------------------
-- DOPLNĚNÍ LIDEM, KTEŘÍ VZNIKLI DŘÍV NEŽ TENHLE SLOUPEC
--
-- Bez tohohle by barvu měl jen ten, koho někdo založí zítra, a dnešních
-- dvanáct lidí by zůstalo šedých — funkce by se nasadila a nebylo by po
-- ní nic vidět.
--
-- FUNKCE, NE JEN PŘÍKAZ V MIGRACI. Migrace běží při zakládání čisté
-- databáze nad prázdnou tabulkou, takže jako holý `update` by to byla
-- prázdná operace a žádný scénář by na ni nesáhl — ověřilo by se to
-- teprve na ostrých datech, tedy nikdy. Takhle si ji scénář zavolá sám.
-- ---------------------------------------------------------------------

create or replace function app.doplnit_barvy_lidem(p_tenant uuid default null)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_paleta constant text[] := array['indigo', 'amber', 'emerald', 'rose',
                                    'sky', 'violet', 'teal', 'slate', 'firma'];
  v_kolik integer;
begin
  /*
    Rozdává se po pobočkách, v pořadí založení, a barvy se berou z těch,
    které na dané pobočce ještě nikdo nemá — jinak by doplnění spadlo na
    jedinečnosti u firmy, kde barvu má půlka lidí a půlka ne.

    Když dojdou, zbytek zůstane prázdný: `poz <= počet volných`. Žádné
    modulo — to by začalo točit dokola a vyrobilo přesně ty dvě stejné
    Aničky, kvůli kterým se to celé dělá.
  */
  with volne as (
    select e.tenant_id,
           e.branch_id,
           p.b,
           row_number() over (
             partition by e.tenant_id, e.branch_id order by p.i
           ) as poradi_barvy
    from (
      select distinct tenant_id, branch_id
      from public.employees
      where deleted_at is null
        and (p_tenant is null or tenant_id = p_tenant)
    ) e
    cross join unnest(c_paleta) with ordinality as p(b, i)
    where not exists (
      select 1 from public.employees x
      where x.tenant_id = e.tenant_id
        and x.branch_id is not distinct from e.branch_id
        and x.deleted_at is null
        and x.color = p.b
    )
  ), bez_barvy as (
    select e.id,
           e.tenant_id,
           e.branch_id,
           row_number() over (
             partition by e.tenant_id, e.branch_id order by e.created_at, e.id
           ) as poz
    from public.employees e
    where e.color is null
      and e.deleted_at is null
      and (p_tenant is null or e.tenant_id = p_tenant)
  )
  update public.employees e
     set color = v.b
    from bez_barvy b
    join volne v
      on v.tenant_id = b.tenant_id
     and v.branch_id is not distinct from b.branch_id
     and v.poradi_barvy = b.poz
   where e.id = b.id;

  get diagnostics v_kolik = row_count;
  return v_kolik;
end;
$$;

comment on function app.doplnit_barvy_lidem(uuid) is
  'Doplní barvu lidem, kteří ji nemají. Když na pobočce barvy dojdou, '
  'zbytek zůstane prázdný — nikdy se nepřiděluje podruhé.';

-- Ostrá data: dvanáct lidí, kteří vznikli dřív než tenhle sloupec.
select app.doplnit_barvy_lidem();
