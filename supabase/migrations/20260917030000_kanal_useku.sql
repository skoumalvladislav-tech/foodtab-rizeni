-- =====================================================================
-- Foodtab — modul Komunikace: kanál úseku (department channel)
--
-- Noční zadání "KOMUNIKACE / VZKAZY 2.0", oddíl 2/3/9: komunikace má
-- jít cílit i na DEPARTMENT ("Kuchyně – Černá Perla"), ne jen na
-- osobu/pobočku/firmu/vedení.
--
-- ---------------------------------------------------------------------
-- PROČ TO PŘEDTÍM NEBYLO — A PROČ TEĎ JE
--
-- 20260906020000_odvozene_kanaly.sql to výslovně zvažovala a schválně
-- NEUDĚLALA, s tímhle zdůvodněním:
--
--   "Zadání zmiňuje i 'kanál pozice'. Nedělám ho a je to rozhodnutí,
--   ne zapomenutí: konverzace.druh má dnes omezení na čtyři hodnoty
--   a přidání páté je změna omezení na tabulce... Navíc je to otázka
--   o provozu, ne o kódu — jestli má mít vlastní kanál každá pozice
--   automaticky, nebo jen ty, které si firma vybere, je rozhodnutí
--   pro Šéfíka."
--
-- Tohle rozhodnutí teď padlo (noční zadání, explicitně DEPARTMENT
-- jako cíl komunikace) — a je to ÚSEK (employees.usek_id — Kuchyně/
-- Bar/Vedení, viz nastaveni/useky), NE pozice (positions/zařazení —
-- čím člověk je a co smí). Ta záměna už jednou způsobila skutečnou
-- chybu v Rozpisu směn (16.9.2026, "nefungují úseky u poboček") a
-- nesmí se zopakovat tady.
--
-- ---------------------------------------------------------------------
-- CO SE PŘESNĚ ODVOZUJE
--
-- Stejný vzor jako kanál_pobocky (odvozené členství, ne jmenovitý
-- seznam): kdo má employees.usek_id rovné usek_id té konverzace, je
-- účastník — bez ohledu na to, na které je zrovna pobočce. Úsek je
-- osobní vlastnost člověka (Nastavení → Lidé), ne vlastnost pobočky.
--
-- Rozsah se OMYLEM nekontroluje přes branch — úsek už firma zadala
-- (nastaveni/useky), takže app.modul_zapnuty(...,'provoz') + členství
-- ve firmě stačí. Kdo úsek nemá přiřazený vůbec, žádný kanál úseku
-- neotevře (nemá co).
--
-- ---------------------------------------------------------------------
-- CO TATO MIGRACE NEDĚLÁ
--
-- Zadání zmiňuje i "Kuchyně → Obsluze" (jeden úsek píše DRUHÉMU,
-- napříč) — to by znamenalo poslat zprávu do kanálu, jehož nejsi
-- účastník, jen na základě nějakého vyššího oprávnění. To je jiná,
-- složitější operace (kdo smí psát cizímu úseku a proč) a zadání ji
-- samo označuje jako pozdější krok ("později může vzniknout"). Tahle
-- migrace řeší jen "otevři/najdi kanál SVÉHO úseku" — stejně úzký
-- rozsah, jaký měl kanál_pobocky při svém prvním kroku.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SLOUPEC A OMEZENÍ — stejný tvar jako u branch_id/pobocka
-- ---------------------------------------------------------------------

alter table public.konverzace
  add column if not exists usek_id uuid references public.useky(id) on delete cascade;

alter table public.konverzace
  drop constraint if exists konverzace_druh_check;
alter table public.konverzace
  add constraint konverzace_druh_check
  check (druh in ('osobni', 'pobocka', 'mezi_pobockami', 'vedeni', 'usek'));

alter table public.konverzace
  add constraint konverzace_usek_dava_smysl check (
    (druh = 'usek' and usek_id is not null)
    or (druh <> 'usek' and usek_id is null)
  );

comment on column public.konverzace.usek_id is
  'Jen u druhu usek — kanál toho úseku (Kuchyně, Bar, Vedení). '
  'Členství se ODVOZUJE z employees.usek_id, nezapisuje se jmenovitě, '
  'stejně jako u branch_id/pobocka.';


-- ---------------------------------------------------------------------
-- JSEM ÚČASTNÍK? — TŘETÍ PODOBA
--
-- Přibývá třetí odvozená větev vedle jmenovité (osobni/mezi_pobockami/
-- vedeni) a pobočkové. Úsek je vlastnost ČLOVĚKA (employees.usek_id),
-- ne dosahu na pobočku — proto samostatná podmínka, ne rozšíření té
-- pobočkové.
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
        and u.odesel_kdy is null
    )
    or exists (
      select 1
      from public.konverzace k
      where k.id = p_konverzace
        and k.druh = 'pobocka'
        and k.branch_id in (select app.visible_branch_ids(k.tenant_id))
    )
    or exists (
      select 1
      from public.konverzace k
      join public.employees e on e.usek_id = k.usek_id and e.tenant_id = k.tenant_id
      where k.id = p_konverzace
        and k.druh = 'usek'
        and e.user_id = (select auth.uid())
        and e.deleted_at is null
    );
$$;

comment on function app.je_ucastnik(uuid) is
  'Je přihlášený člověk účastníkem té konverzace? U pobočkového kanálu '
  'se odvozuje z dosahu na pobočku, u kanálu úseku z employees.usek_id '
  '(osobní vlastnost, ne z pobočky). U osobní, mezi_pobockami a vedeni '
  'rozhoduje výhradně jmenovitý seznam — ani majitel tam nevleze.';


-- ---------------------------------------------------------------------
-- KANÁL ÚSEKU — NAJDI, A KDYŽ NENÍ, ZALOŽ
--
-- Zrcadlí kanal_pobocky do puntíku, jen dosah je "můj usek_id", ne
-- "viditelná pobočka".
-- ---------------------------------------------------------------------

create unique index if not exists konverzace_kanal_useku
  on public.konverzace (tenant_id, usek_id)
  where druh = 'usek';

comment on index public.konverzace_kanal_useku is
  'Jeden kanál na úsek. Bez toho by dvě současná otevření obrazovky '
  'založila dva kanály a zprávy by se rozdělily do dvou vláken.';

create or replace function public.kanal_useku(p_tenant uuid, p_usek uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_nazev  text;
  v_smim   boolean;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Dosah = mám tenhle usek_id sám u sebe. Úsek z formuláře je návrh,
  -- ne oprávnění (pravidlo 4) — ověřuje se proti vlastnímu záznamu,
  -- ne proti tomu, co přišlo v požadavku.
  select exists (
    select 1 from public.employees e
    where e.tenant_id = p_tenant
      and e.usek_id = p_usek
      and e.user_id = (select auth.uid())
      and e.deleted_at is null
  ) into v_smim;

  if not v_smim then
    raise exception 'Do tohohle úseku nepatříte.'
      using errcode = 'insufficient_privilege';
  end if;

  select k.id into v_id
  from public.konverzace k
  where k.tenant_id = p_tenant and k.usek_id = p_usek and k.druh = 'usek';

  if v_id is not null then
    return v_id;
  end if;

  select u.nazev into v_nazev from public.useky u where u.id = p_usek;

  insert into public.konverzace (tenant_id, druh, usek_id, nazev, zalozil)
  values (p_tenant, 'usek', p_usek, v_nazev, app.muj_employee(p_tenant))
  on conflict (tenant_id, usek_id) where druh = 'usek' do nothing
  returning id into v_id;

  if v_id is null then
    select k.id into v_id
    from public.konverzace k
    where k.tenant_id = p_tenant and k.usek_id = p_usek and k.druh = 'usek';
  end if;

  return v_id;
end;
$$;

comment on function public.kanal_useku(uuid, uuid) is
  'Kanál mého úseku; při prvním použití ho založí. Účastníci se '
  'NEZAPISUJÍ — členství je průmět employees.usek_id. Smí otevřít jen '
  'kdo v tom úseku sám je.';

revoke all on function public.kanal_useku(uuid, uuid) from public, anon;
grant execute on function public.kanal_useku(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- MOJE ROZHOVORY — S KANÁLEM ÚSEKU
--
-- Proti odvozene_kanaly se mění jediné: třetí větev v podmínce
-- "moje". Zbytek (počty, pořadí, pravidlo o doručení) beze změny.
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
  muj_usek as (
    select e.usek_id from public.employees e
    where e.id = (select emp from ja)
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
        (u.employee_id is not null and u.odesel_kdy is null)
        or (
          k.druh = 'pobocka'
          and k.branch_id in (select app.visible_branch_ids(p_tenant))
        )
        or (
          k.druh = 'usek'
          and k.usek_id is not null
          and k.usek_id = (select usek_id from muj_usek)
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
  'Moje rozhovory včetně odvozených kanálů poboček a úseků, s počtem '
  'nepřečtených a s tím, kolik z nich čeká na píchnutí. Nepřečtené '
  'nahoře, od nejstaršího (Deputy).';

revoke all on function public.moje_rozhovory(uuid) from public, anon;
grant execute on function public.moje_rozhovory(uuid) to authenticated;
