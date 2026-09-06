-- =====================================================================
-- Foodtab — úseky místo napevno psaných oddělení
--
-- Zadání docs/nocni-prace-komunikace-2026-09-05.md, krok D.
-- Tenhle krok jde nasadit sám a odemyká „úkol na pracoviště" v kroku C.
--
-- ---------------------------------------------------------------------
-- CO SE OPRAVUJE
--
-- `checklist_templates.department` má dnes v KÓDU:
--
--     check (department in ('kuchyne','bar','servis','provoz','vedeni'))
--
-- To je porušení pravidla 1: pracoviště jsou věc zákazníka, ne kódu.
-- Bistro s jedním pultem nemá „kuchyni" a „servis"; hotelová restaurace
-- má tři bary a žádný z nich se nejmenuje „bar". Dnes takové firmě
-- nezbývá než si vybrat z naší pětice něco, co se aspoň trochu blíží —
-- a od té chvíle je v datech nepravda.
--
-- ---------------------------------------------------------------------
-- STARÁ MIGRACE SE NEUPRAVUJE
--
-- `20260823130000_provoz.sql` zůstává, jak je (konvence: nasazená
-- migrace se nemění, přidá se nová). Sloupec `department` proto
-- NEMIZÍ — mizí jen ten `check`, který do kódu zapisoval cizí provoz.
--
-- ---------------------------------------------------------------------
-- PROČ SLOUPEC ZŮSTÁVÁ, KDYŽ HO NAHRAZUJE ODKAZ
--
-- Zapisují do něj `supabase/seed/test-provoz.sql` a
-- `supabase/tests/krok2_scenar.sql`. Kdybych ho zahodil, oba spadnou —
-- a upravovat cizí scénáře v noci není práce, kterou by po mně někdo
-- mohl ráno zkontrolovat.
--
-- Zůstává tedy jako PŘECHODNÝ SLOUPEC: bez omezení na pětici, a spoušť
-- z něj dopočítá `usek_id`, aby starý zápis skončil ve správném úseku
-- místo v prázdnu. Až se seed a krok2 přepíšou na `usek_id`, dá se
-- sloupec zahodit jednou další migrací. Do hlášení.
--
-- ---------------------------------------------------------------------
-- DVĚ VĚCI, KTERÉ TENHLE KROK SCHVÁLNĚ NEDĚLÁ
--
-- 1. `public.positions` má TENTÝŽ sloupec `department` s TÝMŽ omezením
--    (20260823120000_foundation.sql, ř. 73–74). Aplikace ho nikdy
--    nečte — je jen v seedu a ve scénářích krok17 a krok20. Nesahám na
--    něj: převod by ty scénáře shodil a jsou cizí. Je to ale druhá
--    kopie téže napevno psané pětice a patří pryč. Do hlášení.
--
-- 2. `docs/nocni-prace-2026-09-03.md` plánuje na tentýž problém tabulku
--    `sections`, dnešní zadání `useky`. Dva dokumenty, dvě jména, jeden
--    problém. Držím se dnešního zadání; ani jedna tabulka zatím
--    neexistuje, takže se nic nepřepisuje. Do hlášení jako otázka.
-- =====================================================================


-- ---------------------------------------------------------------------
-- ÚSEKY
--
-- `branch_id` prázdné = úsek platí pro celou firmu. Firma s jednou
-- kuchyní ho tak zadá jednou; řetězec, kde má každá pobočka jiné
-- rozdělení, ho zadá u pobočky.
--
-- `create table` bez `if not exists` schválně (CLAUDE.md, „Dvě relace
-- v jednom repozitáři", pravidlo 2): srážka jmen má spadnout nahlas.
-- Jméno `useky` bylo před psaním ověřené jako volné.
-- ---------------------------------------------------------------------

create table public.useky (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- Prázdné = celá firma. Vyplněné = jen ta pobočka.
  branch_id  uuid references public.branches(id) on delete cascade,
  nazev      text not null check (length(btrim(nazev)) > 0),
  poradi     integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.useky is
  'Pracoviště uvnitř provozovny — kuchyně, bar, servis, cokoli si firma '
  'pojmenuje. Nahrazuje napevno psané `department`. Je to DATA firmy, '
  'ne výčet v kódu (pravidlo 1).';
comment on column public.useky.branch_id is
  'Prázdné = úsek platí pro celou firmu. Bistro si vystačí s firemními, '
  'řetězec s odlišnými provozy je zadá u pobočky.';
comment on column public.useky.poradi is
  'V jakém pořadí se nabízejí. Ne abecedně: kuchyně je v provozu '
  'důležitější než sklad, i když je v abecedě později.';

/*
  Dva úseky téhož jména v jedné firmě jsou překlep, ne záměr.

  `nulls not distinct` je tu podstatné: bez něj se dva firemní úseky
  (`branch_id is null`) považují za různé, protože dva NULLy si v SQL
  nejsou rovny — a jedinečnost by u firemních úseků, tedy u těch
  nejčastějších, nehlídala vůbec nic.
*/
create unique index useky_jmeno
  on public.useky (tenant_id, branch_id, lower(btrim(nazev)))
  nulls not distinct;

create index useky_firma on public.useky (tenant_id, poradi) where active;

alter table public.useky enable row level security;

/*
  ČTE KAŽDÝ ČLEN FIRMY, jako u `positions`.

  Úsek je jen název pracoviště — není na něm nic citlivého a číšník
  musí vidět, že úkol patří „na bar", i když nemá právo na nastavení.
  Kdyby čtení viselo na `settings.manage`, ukázal by se mu úkol bez
  toho, komu patří.
*/
create policy useky_select on public.useky for select to authenticated
  using (app.is_member(tenant_id));

create policy useky_write on public.useky for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage', branch_id))
  with check (app.has_access(tenant_id, 'settings.manage', branch_id));

/*
  RLS SAMA O SOBĚ NESTAČÍ.

  Poslední plošný `grant … on all tables in schema public` je
  v 20260823130000_provoz.sql. Tabulka založená dnes tedy nemá pro
  `authenticated` právo ŽÁDNÉ a dotaz by dostal 42501 permission denied
  dřív, než se politika vůbec zeptá na řádky — takže by nespadl jen
  seznam úseků, ale celá obrazovka. Přesně takhle položil `employees.color`
  Lidi i Rozpis směn 3. 9. večer.
*/
grant select, insert, update, delete on public.useky to authenticated;

drop trigger if exists trg_audit_useky on public.useky;
create trigger trg_audit_useky
  after insert or update or delete on public.useky
  for each row execute function app.audit_zmenu('usek');


-- ---------------------------------------------------------------------
-- ODKAZ MÍSTO ŘETĚZCE
-- ---------------------------------------------------------------------

alter table public.checklist_templates
  add column usek_id uuid references public.useky(id) on delete set null;

comment on column public.checklist_templates.usek_id is
  'Úsek, kterému checklist patří. Nahrazuje `department`.';

create index checklist_templates_usek on public.checklist_templates (usek_id);

/*
  Omezení na pětici pryč. TOHLE je ta oprava — ne nový sloupec, ale
  zmizení výčtu provozu z kódu. Sloupec zůstává jako přechodný, viz
  hlavičku.
*/
alter table public.checklist_templates
  drop constraint if exists checklist_templates_department_check;

comment on column public.checklist_templates.department is
  'PŘECHODNÝ SLOUPEC, nepoužívat v novém kódu. Zůstává jen proto, že '
  'do něj zapisuje seed a krok2_scenar; spoušť z něj dopočítá usek_id. '
  'Až se obojí přepíše, dá se zahodit.';


-- ---------------------------------------------------------------------
-- PŘEVOD STÁVAJÍCÍCH DAT
--
-- Zakládají se úseky JEN pro hodnoty, které v datech opravdu jsou —
-- ne celá pětice. Kdyby se zakládala celá, byl by ten výčet zpátky
-- v kódu, jen o patro níž. Firma, která má jen „provoz", dostane jeden
-- úsek, ne pět.
--
-- Pojmenování s diakritikou je JEDNORÁZOVÝ převod starých strojových
-- hodnot na čitelné názvy, ne seznam, na kterém by kód stál. Co v tabulce
-- nesedí na známou pětici, se přenese, jak je.
-- ---------------------------------------------------------------------

insert into public.useky (tenant_id, branch_id, nazev, poradi)
select distinct
  t.tenant_id,
  null::uuid,
  case t.department
    when 'kuchyne' then 'Kuchyně'
    when 'bar'     then 'Bar'
    when 'servis'  then 'Servis'
    when 'provoz'  then 'Provoz'
    when 'vedeni'  then 'Vedení'
    else t.department
  end,
  case t.department
    when 'kuchyne' then 10
    when 'bar'     then 20
    when 'servis'  then 30
    when 'provoz'  then 40
    when 'vedeni'  then 50
    else 100
  end
from public.checklist_templates t
where t.department is not null and btrim(t.department) <> ''
on conflict do nothing;

update public.checklist_templates t
   set usek_id = u.id
  from public.useky u
 where u.tenant_id = t.tenant_id
   and u.branch_id is null
   and lower(btrim(u.nazev)) = lower(btrim(
         case t.department
           when 'kuchyne' then 'Kuchyně'
           when 'bar'     then 'Bar'
           when 'servis'  then 'Servis'
           when 'provoz'  then 'Provoz'
           when 'vedeni'  then 'Vedení'
           else t.department
         end))
   and t.usek_id is null;


-- ---------------------------------------------------------------------
-- MOST PRO STARÝ ZÁPIS
--
-- Seed a krok2_scenar pořád zapisují `department` a `usek_id` neznají.
-- Bez tohohle by jim šablona vznikla bez úseku a obrazovka by u ní
-- ukázala prázdno — chyba, která nespadne a jen tiše chybí.
--
-- Zakládá se tu úsek, když ještě není. Je to zápis provozních dat ze
-- spouště, což se obecně nedělá — tady je to ale převod cizího vstupu,
-- ne výčet v kódu: název přichází z dat, ne odsud.
-- ---------------------------------------------------------------------

create or replace function app.checklist_usek_z_department()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nazev text;
  v_id    uuid;
begin
  if new.usek_id is not null then
    return new;
  end if;
  if new.department is null or btrim(new.department) = '' then
    return new;
  end if;

  v_nazev := case new.department
    when 'kuchyne' then 'Kuchyně'
    when 'bar'     then 'Bar'
    when 'servis'  then 'Servis'
    when 'provoz'  then 'Provoz'
    when 'vedeni'  then 'Vedení'
    else new.department
  end;

  select u.id into v_id
  from public.useky u
  where u.tenant_id = new.tenant_id
    and u.branch_id is null
    and lower(btrim(u.nazev)) = lower(btrim(v_nazev));

  if v_id is null then
    insert into public.useky (tenant_id, branch_id, nazev)
    values (new.tenant_id, null, v_nazev)
    returning id into v_id;
  end if;

  new.usek_id := v_id;
  return new;
end;
$$;

comment on function app.checklist_usek_z_department() is
  'Most pro starý zápis: kdo zapisuje `department` a `usek_id` neplní, '
  'dostane úsek dopočítaný. Až se seed a krok2_scenar přepíšou, může '
  'spoušť i sloupec zmizet.';

drop trigger if exists trg_checklist_usek on public.checklist_templates;
create trigger trg_checklist_usek
  before insert or update of department on public.checklist_templates
  for each row execute function app.checklist_usek_z_department();
