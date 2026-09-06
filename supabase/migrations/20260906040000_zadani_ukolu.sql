-- =====================================================================
-- Foodtab — zadání úkolu na pracoviště a člověku
--
-- Zadání docs/nocni-prace-komunikace-2026-09-05.md, krok C.
-- Obrazovka je vedle, v app/[rozsah]/ukoly. Tenhle krok jde nasadit sám.
-- Staví na 20260906030000_useky (krok D).
--
-- ---------------------------------------------------------------------
-- OPRAVA PŘEDPOKLADU ZE ZADÁNÍ
--
-- Zadání říká, že `public.tasks` už tvar adresáta má:
--
--     branch_id   uuid,  -- NULL = celá firma
--     role_id     uuid,  -- pozice
--     employee_id uuid   -- konkrétní člověk
--
-- Ta prostřední řádka proti schématu NEPLATÍ. `tasks.role_id` odkazuje
-- na `public.roles` (20260823130000_provoz.sql, ř. 153) — a `roles` jsou
-- v tomhle repozitáři OPRÁVNĚNÍ (Majitel, Provozní, Servis), ne pozice.
-- Pozice jsou `public.positions` a váže se na ně `employees.position_id`.
-- Je to napsané i v CLAUDE.md („V rozhraní se `roles` jmenují Oprávnění
-- a `positions` Pozice") a v komentáři u obrazovky Oprávnění:
-- „Brigádník má pozici a žádné oprávnění."
--
-- Volba „KOMU: pozice" tedy dnes NEMÁ KAM ZAPSAT. A „KOMU: úsek"
-- taky ne, protože `useky` vznikly teprve v kroku D.
--
-- Přidávají se proto dva sloupce. Není to zakládání tabulky znovu —
-- tabulka zůstává; doplňuje se adresát, který v ní chyběl.
--
-- `role_id` se NERUŠÍ: pracuje s ním `complete_task` od 25. 8. a jsou
-- na něm data. Do nového formuláře se ale nedostane — cílit na
-- oprávnění („všichni Provozní") je něco jiného než cílit na pozici
-- („všichni kuchaři") a plete se to.
-- =====================================================================


-- ---------------------------------------------------------------------
-- DVA CHYBĚJÍCÍ ADRESÁTI
-- ---------------------------------------------------------------------

alter table public.tasks
  add column usek_id     uuid references public.useky(id) on delete set null,
  add column position_id uuid references public.positions(id) on delete set null;

comment on column public.tasks.usek_id is
  'Úkol pro pracoviště — kuchyň, bar, zahrádka. Co si firma pojmenovala '
  'v public.useky.';
comment on column public.tasks.position_id is
  'Úkol pro pozici — číšníci, kuchaři. POZOR: to je public.positions, '
  'ne public.roles. `role_id` vedle je odkaz na OPRÁVNĚNÍ a znamená '
  'něco jiného.';

create index tasks_usek     on public.tasks (usek_id)     where status = 'open';
create index tasks_position on public.tasks (position_id) where status = 'open';


/*
  JEDEN CÍL NA ÚKOL.

  7shifts to má stejně: *„a specific Location, Department, Role, or
  Employee"*. Víc adresátů = víc úkolů; pole na seznam příjemců se
  nevymýšlí.

  Hlídá to databáze, ne formulář. Formulář je přepínač, takže víc cílů
  poslat „nejde" — jenže rozhraní se dá obejít jedním requestem a druhá
  obranná linie je od toho, aby na to nespoléhala.

  `role_id` je uvnitř počítání schválně: kdyby zůstal venku, dal by se
  starým sloupcem přidat druhý cíl a omezení by nehlídalo nic.
*/
alter table public.tasks
  add constraint tasks_jeden_cil
  check (num_nonnulls(usek_id, position_id, employee_id, role_id) <= 1);


-- ---------------------------------------------------------------------
-- ZADÁNÍ ÚKOLU
--
-- Průzor, ne přímý insert — a to kvůli TERMÍNU.
--
-- Co člověk napíše do políčka (`2026-09-07T22:00`), nemá časové pásmo
-- (pravidlo 11). Kdyby si z toho okamžik vyráběla aplikace přes
-- `new Date('2026-09-07T22:00')`, přečte se ten řetězec v pásmu
-- serveru — a ten je na Vercelu v UTC. Termín by seděl na obrazovce
-- a v databázi byl o dvě hodiny vedle.
--
-- Pásmo dodává POBOČKA a převod dělá databáze přes `at time zone`,
-- protože jen ta zná pravidla letního času pro to konkrétní datum.
-- Proto sem termín chodí jako `timestamp` BEZ pásma a okamžik z něj
-- vzniká až tady.
--
-- Zároveň se tu hlídá „jeden cíl na úkol" podruhé. Omezení na tabulce
-- by to uhlídalo taky, jenže hláškou o porušení `check`, které člověk
-- nerozumí. Tady dostane větu.
-- ---------------------------------------------------------------------

create or replace function public.zadat_ukol(
  p_tenant    uuid,
  p_branch    uuid,
  p_nazev     text,
  p_poznamka  text default '',
  -- Hodina na zdi, bez pásma. Pásmo dodá pobočka.
  p_termin    timestamp default null,
  p_priorita  text default 'normal',
  p_usek      uuid default null,
  p_pozice    uuid default null,
  p_clovek    uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id  uuid;
  v_kdy timestamptz;
begin
  if not app.has_access(p_tenant, 'tasks.manage', p_branch) then
    raise exception 'Zadávat úkoly na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_nazev, ''))) = 0 then
    raise exception 'Název úkolu je povinný.' using errcode = 'check_violation';
  end if;

  if num_nonnulls(p_usek, p_pozice, p_clovek) > 1 then
    raise exception 'Úkol má jednoho adresáta. Víc adresátů znamená víc úkolů.'
      using errcode = 'check_violation';
  end if;

  -- Rozsah z prohlížeče je návrh (pravidlo 4). Platí i pro adresáty:
  -- úsek, pozice i člověk musí patřit téže firmě.
  if p_usek is not null and not exists (
       select 1 from public.useky u where u.id = p_usek and u.tenant_id = p_tenant) then
    raise exception 'Ten úsek do téhle firmy nepatří.' using errcode = 'insufficient_privilege';
  end if;
  if p_pozice is not null and not exists (
       select 1 from public.positions x where x.id = p_pozice and x.tenant_id = p_tenant) then
    raise exception 'Ta pozice do téhle firmy nepatří.' using errcode = 'insufficient_privilege';
  end if;
  if p_clovek is not null and not exists (
       select 1 from public.employees e
       where e.id = p_clovek and e.tenant_id = p_tenant and e.deleted_at is null) then
    raise exception 'Ten člověk do téhle firmy nepatří.' using errcode = 'insufficient_privilege';
  end if;

  /*
    Tady se z hodiny na zdi stává okamžik. `at time zone` bere pravidla
    letního času pro TO KONKRÉTNÍ datum — proto to nedělá aplikace.
    U firemního úkolu (bez pobočky) padá `zona_pobocky` na pásmo firmy.
  */
  if p_termin is not null then
    v_kdy := p_termin at time zone app.zona_pobocky(p_branch);
  end if;

  insert into public.tasks
    (tenant_id, branch_id, title, note, due_at, priority,
     usek_id, position_id, employee_id, created_by)
  values
    (p_tenant, p_branch, btrim(p_nazev), coalesce(btrim(p_poznamka), ''),
     v_kdy, case when p_priorita = 'high' then 'high' else 'normal' end,
     p_usek, p_pozice, p_clovek, (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.zadat_ukol(uuid, uuid, text, text, timestamp, text, uuid, uuid, uuid) is
  'Zadá úkol jednomu adresátovi. Termín přijímá jako hodinu NA ZDI '
  'a okamžik z něj dělá databáze podle pásma pobočky — v aplikaci by '
  'se přečetl v pásmu serveru, a ten je na Vercelu v UTC.';

revoke all on function public.zadat_ukol(uuid, uuid, text, text, timestamp, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.zadat_ukol(uuid, uuid, text, text, timestamp, text, uuid, uuid, uuid)
  to authenticated;


-- ---------------------------------------------------------------------
-- „ŠTÍTEK, NE ZÁMEK" SE DNES V NOCI NEUDĚLAL — A PROČ
--
-- Zadání říká: *„Jmenovité přiřazení je štítek, ne zámek. V provozu
-- zaskakuje kdekdo; úkol, který smí splnit jen jeden člověk, zůstane
-- nesplněný, až bude marodit."* Souhlasím a 7shifts to má výslovně
-- takhle: *„Other employees who can view this list can also see or
-- complete tasks that are tagged to someone else."*
--
-- Dnešní `complete_task` je ale ZÁMEK:
--
--     or (v_emp is not null and v_task.employee_id = v_emp)
--     or (v_role is not null and v_task.role_id = v_role)
--     or (v_task.employee_id is null and v_task.role_id is null and …)
--
-- A na tom zámku stojí kontrola v CIZÍM scénáři:
--
--     supabase/tests/krok3_scenar.sql — „číšník zavřel cizí úkol"
--
-- Napsal jsem to uvolnění, pustil zkoušku a ta kontrola spadla. Je to
-- správně: hlídá přesně to pravidlo, které zadání mění. Změnit ji ale
-- nemůžu — dnešní zadání říká nesahat na `krok*_scenar.sql` mimo ty,
-- které sám přidávám.
--
-- ZŮSTÁVÁ TEDY ZÁMEK. Uvolnění je jednořádková změna tady plus úprava
-- jedné kontroly v krok3; obojí je popsané v hlášení
-- docs/hlaseni/stav-2026-09-06.md. Radši nechám pravidlo staré a nahlas
-- řečené než nové a s červenou zkouškou, které si nikdo nevšimne.
--
-- Co se udělat DALO a udělalo se: pozdní splnění se zapisuje, a do
-- auditu jde i to, kdo úkol splnil proti tomu, na koho zněl štítek.
-- Až se zámek uvolní, je ten údaj to jediné, co drží odpovědnost.
-- ---------------------------------------------------------------------

create or replace function public.complete_task(p_task uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_emp  uuid;
  v_role uuid;
  v_smi  boolean;
  v_pozde boolean;
begin
  select * into v_task from public.tasks t where t.id = p_task;

  -- Neexistuje a nepatří vám splývá schválně: jinak by šlo zkoušením
  -- adres zjistit, jaké úkoly má cizí firma.
  if not found or not app.is_member(v_task.tenant_id) then
    raise exception 'Úkol nenalezen.' using errcode = 'no_data_found';
  end if;

  select e.id into v_emp
  from public.employees e
  where e.tenant_id = v_task.tenant_id
    and e.user_id = (select auth.uid())
    and e.deleted_at is null;

  select m.role_id into v_role
  from public.memberships m
  where m.tenant_id = v_task.tenant_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';

  /*
    Beze změny proti 20260825160000 — viz hlavičku, proč se zámek
    neuvolnil. `coalesce` tu není kosmetika: úkol bez adresáta má
    `role_id` prázdné, porovnání vrátí NULL a `if not NULL` se
    neprovede, takže by se povolení propadlo místo odmítnutí.

    Nové sloupce `usek_id` a `position_id` se sem SCHVÁLNĚ nepřidávají.
    Přidat je znamená rozhodnout, jestli úkol na úsek smí splnit každý
    na tom úseku — a to je rozhodnutí o provozu, ne o kódu. Do hlášení
    jako otázka pro Šéfíka. Do té doby platí, co platí u úkolu bez
    adresáta: splní ho, kdo má tasks.read na té pobočce.
  */
  v_smi := coalesce(
       app.has_access(v_task.tenant_id, 'tasks.manage', v_task.branch_id)
    or (v_emp is not null and v_task.employee_id = v_emp)
    or (v_role is not null and v_task.role_id = v_role)
    or (v_task.employee_id is null and v_task.role_id is null
        and app.has_access(v_task.tenant_id, 'tasks.read', v_task.branch_id)),
    false);

  if not v_smi then
    raise exception 'Tenhle úkol není váš.' using errcode = 'insufficient_privilege';
  end if;

  -- Druhé kliknutí nic nepokazí a nic nepřepíše. Kdo úkol zavřel jako
  -- první, tím zůstane.
  if v_task.status <> 'open' then
    return;
  end if;

  /*
    ÚKOL PO TERMÍNU NEZMIZÍ A JDE SPLNIT.

    7shifts úkol dvě hodiny po termínu skryje. Nepřebíráme to: úkol,
    který se ztratí z očí, nikdo nedodělá — a v kuchyni je pozdě
    splněná kontrola teplot pořád lepší než žádná.

    Pozdní splnění se ale ZAPÍŠE. Samostatný sloupec na to není
    schválně: `done_at > due_at` je odvoditelné z toho, co v tabulce už
    je, a druhý údaj o téže věci se dřív nebo později rozejde.
    Do auditu jde proto, kolik minut po termínu to bylo — tam je to
    záznam o jednání, ne odvozený stav.
  */
  v_pozde := v_task.due_at is not null and now() > v_task.due_at;

  update public.tasks
     set status  = 'done',
         done_at = now(),
         done_by = v_emp
   where id = p_task;

  perform app.audit(
    p_tenant      => v_task.tenant_id,
    p_action      => case when v_pozde then 'task.done_pozde' else 'task.done' end,
    p_entity_type => 'task',
    p_entity_id   => p_task::text,
    p_branch      => v_task.branch_id,
    p_after       => jsonb_build_object(
      'pozde', v_pozde,
      'po_termine_minut',
        case when v_pozde
          then floor(extract(epoch from (now() - v_task.due_at)) / 60)::int
        end,
      -- Kdo to splnil, i když štítek zněl na někoho jiného. Tohle je ta
      -- polovina, která se uvolněním zámku NESMÍ ztratit.
      'splnil', v_emp,
      'stitek_na', v_task.employee_id
    )
  );
end;
$$;

comment on function public.complete_task(uuid) is
  'Zavře úkol. Kdo smí, se proti 20260825160000 NEMĚNÍ — uvolnění '
  'zámku by shodilo kontrolu v krok3_scenar, viz hlavičku migrace. '
  'Nově se zapisuje pozdní splnění a to, kdo úkol splnil proti štítku.';

revoke all on function public.complete_task(uuid) from public, anon;
grant execute on function public.complete_task(uuid) to authenticated;
