-- =====================================================================
-- Foodtab — modul Komunikace, krok B (databázová část):
-- kanál pobočky se ODVOZUJE, nezakládá
--
-- Zadání docs/nocni-prace-komunikace-2026-09-05.md, krok B a oddíl 1.
-- Obrazovka je vedle, v app/[rozsah]/rozhovory. Tenhle krok jde nasadit
-- sám: bez obrazovky se nic nerozbije, jen se odvozené kanály nikde
-- neukážou.
--
-- ---------------------------------------------------------------------
-- PROČ SE ČLENSTVÍ NEODVOZUJE RUČNĚ
--
-- Rešerše 7shifts to říká přesně: *„Employees must be removed from the
-- location, department, or role in order to be removed from those chat
-- channels."* Členství v kanálu NENÍ samostatná věc — je to průmět
-- přiřazení člověka. Connecteam má na totéž Smart Groups: pravidlo nad
-- poli profilu, změna pozice člověka okamžitě přeřadí.
--
-- U nás to sedí na pravidlo 1 (nic o provozu nepatří do kódu) i na
-- praktickou zkušenost: ruční seznam členů kanálu se rozejde s realitou
-- při prvním přeřazení. Číšník, který přešel z Perly do Bernardu, by
-- dál četl Perlu a Bernard by se k němu nedostal — a nikdo by nevěděl
-- proč, protože obojí by "fungovalo".
--
-- ---------------------------------------------------------------------
-- CO SE ODVOZUJE A CO NE
--
--   pobocka         → ODVOZENO z dosahu na pobočku. Nikdo se nepřidává
--                     ani neodebírá.
--   osobni          → výslovní účastníci. Dva lidé mezi sebou.
--   mezi_pobockami  → výslovní účastníci. Jediné místo, kde se hranice
--                     poboček schválně překračuje, takže tam nesmí
--                     hlídat nic jiného než jmenovitý seznam.
--   vedeni          → odvozeno z adresáta (krok A), ne z dosahu.
--
-- ŘÁDEK V `konverzace_ucastnici` TÍM NEZTRÁCÍ SMYSL — mění význam.
-- U odvozeného kanálu už není povolením, ale ZÁLOŽKOU: drží
-- `precteno_do`. Proto se u pobočkového kanálu zakládá až ve chvíli,
-- kdy si ho člověk poprvé přečte, a jeho smazání nikomu přístup
-- nevezme, jen posune nepřečtené na začátek.
--
-- ---------------------------------------------------------------------
-- CO TENHLE KROK SCHVÁLNĚ NEDĚLÁ: KANÁL POZICE
--
-- Zadání zmiňuje i "kanál pozice". Nedělám ho a je to rozhodnutí,
-- ne zapomenutí: `konverzace.druh` má dnes omezení na čtyři hodnoty
-- a přidání páté je změna omezení na tabulce, kterou už krok A
-- používá. Navíc je to otázka o provozu, ne o kódu — jestli má mít
-- vlastní kanál každá pozice (kuchař, číšník, barman) automaticky,
-- nebo jen ty, které si firma vybere, je rozhodnutí pro Šéfíka.
-- Zapsáno do hlášení.
-- =====================================================================


-- ---------------------------------------------------------------------
-- JSEM ÚČASTNÍK? — DRUHÁ PODOBA
--
-- Původní z 20260903100000 uměla jen výslovné účastníky. Přibývá druhá
-- větev, a jen pro `pobocka`.
--
-- POZOR, CO SE TÍM NEMĚNÍ: u `osobni`, `mezi_pobockami` a `vedeni`
-- zůstává jediným kritériem jmenovitý seznam. Kdyby se odvození
-- pustilo i na ně, četl by majitel s dosahem na všechny pobočky každou
-- stížnost, která na něj byla napsaná — přesně to, čemu celý modul
-- brání. Proto je `k.druh = 'pobocka'` uvnitř podmínky, ne vedle ní.
--
-- `app.visible_branch_ids` se schválně neopisuje: je to už zavedená
-- odpověď na otázku „na které pobočky dosáhnu". Druhá definice téhož
-- by se s ní časem rozešla.
-- ---------------------------------------------------------------------

create or replace function app.je_ucastnik(p_konverzace uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    exists (
      select 1
      from public.konverzace_ucastnici u
      join public.employees e on e.id = u.employee_id
      where u.konverzace_id = p_konverzace
        and e.user_id = (select auth.uid())
        and e.deleted_at is null
        -- Kdo z konverzace odešel, do ní zpětně nevidí.
        and u.odesel_kdy is null
    )
    or exists (
      select 1
      from public.konverzace k
      where k.id = p_konverzace
        and k.druh = 'pobocka'
        and k.branch_id in (select app.visible_branch_ids(k.tenant_id))
    );
$$;

comment on function app.je_ucastnik(uuid) is
  'Je přihlášený člověk účastníkem té konverzace? U pobočkového kanálu '
  'se to ODVOZUJE z dosahu na pobočku (7shifts: členství v kanálu je '
  'průmět přiřazení). U osobní, mezi_pobockami a vedeni rozhoduje '
  'výhradně jmenovitý seznam — ani majitel tam nevleze.';


-- ---------------------------------------------------------------------
-- KANÁL POBOČKY — NAJDI, A KDYŽ NENÍ, ZALOŽ
--
-- Jeden na pobočku. Zakládá se při prvním použití, ne dopředu: firma
-- s dvěma sty pobočkami by jinak měla dvě stě prázdných konverzací
-- dřív, než někdo něco napíše.
-- ---------------------------------------------------------------------

create unique index if not exists konverzace_kanal_pobocky
  on public.konverzace (tenant_id, branch_id)
  where druh = 'pobocka';

comment on index public.konverzace_kanal_pobocky is
  'Jeden pobočkový kanál na pobočku. Bez toho by dvě současná otevření '
  'obrazovky založila dva kanály a zprávy by se rozdělily do dvou vláken.';

create or replace function public.kanal_pobocky(p_tenant uuid, p_branch uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Pobočka z prohlížeče je návrh, ne oprávnění (pravidlo 4).
  if p_branch is null or p_branch not in (select app.visible_branch_ids(p_tenant)) then
    raise exception 'Na tuhle pobočku nemáte dosah.'
      using errcode = 'insufficient_privilege';
  end if;

  select k.id into v_id
  from public.konverzace k
  where k.tenant_id = p_tenant and k.branch_id = p_branch and k.druh = 'pobocka';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.konverzace (tenant_id, druh, branch_id, nazev, zalozil)
  values (p_tenant, 'pobocka', p_branch,
          (select b.name from public.branches b where b.id = p_branch),
          app.muj_employee(p_tenant))
  -- Dvě současná otevření obrazovky: druhé narazí na jedinečný index
  -- a místo pádu si přečte, co založilo první.
  on conflict (tenant_id, branch_id) where druh = 'pobocka' do nothing
  returning id into v_id;

  if v_id is null then
    select k.id into v_id
    from public.konverzace k
    where k.tenant_id = p_tenant and k.branch_id = p_branch and k.druh = 'pobocka';
  end if;

  return v_id;
end;
$$;

comment on function public.kanal_pobocky(uuid, uuid) is
  'Kanál té pobočky; při prvním použití ho založí. Účastníci se do něj '
  'NEZAPISUJÍ — členství je průmět dosahu na pobočku.';

revoke all on function public.kanal_pobocky(uuid, uuid) from public, anon;
grant execute on function public.kanal_pobocky(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- MOJE ROZHOVORY — S ODVOZENÝMI KANÁLY
--
-- Proti kroku A se mění jediné: spojení na `konverzace_ucastnici` je
-- LEVÉ a podmínka připouští i odvozený kanál. Zbytek (počty, pořadí,
-- pravidlo o doručení) je beze změny.
--
-- U odvozeného kanálu bez záložky je `precteno_do` prázdné, takže se
-- všechno počítá jako nepřečtené. Je to správně: člověk, který kanál
-- ještě neotevřel, ho opravdu nepřečetl.
-- ---------------------------------------------------------------------

create or replace function public.moje_rozhovory(p_tenant uuid)
returns table (
  konverzace_id uuid,
  druh          text,
  branch_id     uuid,
  nazev         text,
  adresat       text,
  posledni_kdy  timestamptz,
  neprectenych  integer,
  ceka          integer,
  uzavreno_kdy  timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with ja as (
    select app.muj_employee(p_tenant) as emp
  ),
  smena as (
    select app.smena_ted(p_tenant, (select emp from ja)) as pobocka
  ),
  moje as (
    select k.*, u.precteno_do
    from public.konverzace k
    left join public.konverzace_ucastnici u
      on u.konverzace_id = k.id
     and u.employee_id = (select emp from ja)
    where k.tenant_id = p_tenant
      and (
        -- výslovný účastník
        (u.employee_id is not null and u.odesel_kdy is null)
        -- nebo odvozený kanál pobočky
        or (
          k.druh = 'pobocka'
          and k.branch_id in (select app.visible_branch_ids(p_tenant))
        )
      )
  )
  select
    m.id,
    m.druh,
    m.branch_id,
    m.nazev,
    m.adresat,
    max(z.vytvoreno_kdy) filter (where z.stornovano_kdy is null),
    count(*) filter (
      where z.stornovano_kdy is null
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    )::integer,
    count(*) filter (
      where z.stornovano_kdy is null
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
        and not app.doruci_se((select pobocka from smena), m.branch_id, z.nalehava)
    )::integer,
    m.uzavreno_kdy
  from moje m
  left join public.konverzace_zpravy z on z.konverzace_id = m.id
  where
    app.modul_zapnuty(p_tenant, 'provoz')
    and (select emp from ja) is not null
  group by m.id, m.druh, m.branch_id, m.nazev, m.adresat, m.uzavreno_kdy, m.precteno_do
  order by
    (count(*) filter (
      where z.stornovano_kdy is null
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) > 0) desc,
    min(z.vytvoreno_kdy) filter (
      where z.stornovano_kdy is null
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) asc nulls last,
    max(z.vytvoreno_kdy) desc nulls last;
$$;

comment on function public.moje_rozhovory(uuid) is
  'Moje rozhovory včetně odvozených kanálů poboček, s počtem '
  'nepřečtených a s tím, kolik z nich čeká na píchnutí. Nepřečtené '
  'nahoře, od nejstaršího (Deputy).';

revoke all on function public.moje_rozhovory(uuid) from public, anon;
grant execute on function public.moje_rozhovory(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ZÁLOŽKA SE ZAKLÁDÁ AŽ PŘI ČTENÍ
--
-- U odvozeného kanálu žádný řádek účastníka není, takže `update` neměl
-- co posunout a nepřečtené by se u kanálu pobočky nikdy nevynulovaly.
-- ---------------------------------------------------------------------

create or replace function public.oznacit_precteno(p_konverzace uuid)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ja     uuid;
  v_tenant uuid;
  v_kdy    timestamptz;
begin
  if not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  select k.tenant_id into v_tenant from public.konverzace k where k.id = p_konverzace;
  v_ja := app.muj_employee(v_tenant);

  if v_ja is null then
    return null;
  end if;

  /*
    Vloží záložku, když ještě není. Přístup tím NEVZNIKÁ — ten už
    ověřila `app.je_ucastnik` výš. Kdyby se tenhle insert dostal před
    tu kontrolu, byla by to cesta, jak se do cizí konverzace zapsat.
    Proto je pořadí takhle a ne obráceně.
  */
  insert into public.konverzace_ucastnici (konverzace_id, employee_id, precteno_do)
  values (p_konverzace, v_ja, now())
  on conflict (konverzace_id, employee_id) do update
    set precteno_do = greatest(
          excluded.precteno_do,
          coalesce(public.konverzace_ucastnici.precteno_do, excluded.precteno_do))
  returning precteno_do into v_kdy;

  return v_kdy;
end;
$$;

comment on function public.oznacit_precteno(uuid) is
  'Posune moji záložku na teď; u odvozeného kanálu ji nejdřív založí. '
  'Přístup tím nevzniká — ověřuje se před zápisem. Posouvá se jen '
  'dopředu, aby nešlo vyrobit „nepřečteno" zpětně.';

revoke all on function public.oznacit_precteno(uuid) from public, anon;
grant execute on function public.oznacit_precteno(uuid) to authenticated;
