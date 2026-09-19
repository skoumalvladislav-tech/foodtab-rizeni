-- =====================================================================
-- Foodtab — upozornění na směny: obnova, „původně → nově“, odkaz na
-- směnu, důležitost a přehled potvrzení pro vedoucího
--
-- Zadání: Směny 2.0 (19. 9. 2026), oddíly 20–25.
--
-- ---------------------------------------------------------------------
-- 1. CO SE ROZBILO (a proč se to dvě noci nepoznalo)
--
-- `app.upozornit_smenu` volala jen `ulozit_smenu` z migrace
-- 20260913100000. Migrace 20260916200000 (trhaná směna) tu funkci
-- zrušila (`drop function … 10 parametrů`) a napsala novou dvanáctiparame-
-- trovou — jenže podle STARŠÍ podoby z 20260903060000, ještě bez
-- upozornění. Od 16. 9. večer proto uložení směny NIKOMU nezaložilo
-- upozornění: ani `smena.nova`, ani `smena.zmenena`, ani `smena.odebrana`.
-- Zrušení přes `smazat_smenu` (20260913100000) fungovalo dál, proto
-- zvoneček nebyl úplně němý a nikdo nic nehlásil.
--
-- Je to týž druh chyby jako s grantem na `branches` (19. 9.): novější
-- migrace přepsala celý objekt podle staršího výchozího stavu. Tahle
-- migrace `ulozit_smenu` vrací upozornění A ZÁROVEŇ scénář
-- `krok39_scenar.sql` teď kontroluje, že uložení směny opravdu založí
-- upozornění — dřív ho nehlídalo nic.
--
-- ---------------------------------------------------------------------
-- 2. CO SE PŘIDÁVÁ
--
--  * `notifications.shift_id` — odkaz na směnu. Bez něj nejde otevřít
--    detail směny z upozornění ani spočítat, kdo změnu potvrdil.
--  * `telo.puvodni_den/od/do` — stav PŘED změnou, aby upozornění mohlo
--    říct „08:00–16:00 → 10:00–18:00“. Při slučování (osm úprav téhož
--    dne = jedno upozornění) se ponechává NEJSTARŠÍ původní stav, takže
--    08–16 → 09–17 → 10–18 dá „08–16 → 10–18“, ne „09–17 → 10–18“.
--  * Vrácení do původního stavu neupozorní: kdo změnu vzal zpátky,
--    nemá zaměstnance rušit hláškou „08–16 → 08–16“. Původní upozornění
--    se zruší.
--  * `notifications.priorita` — u změn směn důležitost podle nastavení
--    firmy `smeny_dulezita_hodin`: začíná-li směna do tolika hodin,
--    změna je `important`. Prázdné = nikdy (výchozí). Pravidlo NENÍ
--    zapsané v kódu; firma si ho zapne, jak potřebuje.
--  * `stav_potvrzeni_smeny` — pro vedoucího: kdy člověk upozornění
--    dostal, přečetl a potvrdil. JEN časy, nikdy obsah upozornění.
--
-- ---------------------------------------------------------------------
-- 3. CO SE SCHVÁLNĚ NEDĚLÁ
--
--  * Neposílá se e-mail ani push. `notifications` je zdroj pravdy a
--    jediný kanál, který nemůže selhat; ostatní kanály přijdou zvlášť
--    a o zapnutí rozhoduje Šéfík.
--  * `notifications` zůstává soukromá (každý čte jen svoje). Vedoucí
--    nedostává přístup k upozornění druhých — dostává průzor, který
--    vrací tři časy a jméno, a jen na pobočce, kterou spravuje.
--  * Grant na nový sloupec `tenant_settings` je jen PŘIDÁNÍ. Žádný
--    `revoke` ani přepsání celého výčtu — právě to shodilo Nastavení →
--    Firma 19. 9.
--
-- Nasazuje Šéfík. Migrace na data nesahá (jen přidává sloupce).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SLOUPCE
-- ---------------------------------------------------------------------

alter table public.notifications
  add column if not exists shift_id uuid references public.shifts(id) on delete set null;

create index if not exists notifications_smena
  on public.notifications (shift_id)
  where shift_id is not null;

comment on column public.notifications.shift_id is
  'Směna, které se upozornění týká (smena.nova, smena.zmenena). Slouží '
  'k otevření detailu z upozornění a k přehledu potvrzení pro vedoucího. '
  'Prázdné u druhů, které se směny netýkají, i u smena.odebrana '
  '(člověk už se ke směně nemá dostávat).';

alter table public.tenant_settings
  add column if not exists smeny_dulezita_hodin integer
    check (smeny_dulezita_hodin is null or smeny_dulezita_hodin between 1 and 720);

comment on column public.tenant_settings.smeny_dulezita_hodin is
  'Změna směny, která začíná do tolika hodin, je „důležitá“ '
  '(notifications.priorita = important) — má se dostat k člověku i mimo '
  'pracovní dobu. Prázdné = žádná změna se za důležitou nepovažuje. '
  'Není to zákon přírody, proto nastavení, ne konstanta v kódu.';

-- Jen PŘIDÁNÍ grantu (viz hlavička, oddíl 3).
grant select (smeny_dulezita_hodin) on public.tenant_settings to authenticated;
grant update (smeny_dulezita_hodin) on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- 2. APP.UPOZORNIT_SMENU — s původním stavem, odkazem a důležitostí
--
-- Přidání parametrů mění signaturu, takže `create or replace` by vedle
-- staré sedmiparametrové vytvořilo DRUHOU funkci téhož jména a volání
-- `smazat_smenu` by bylo nejednoznačné (stejná úvaha jako u ulozit_smenu
-- v 20260916200000). Stará se proto ruší; volání se sedmi argumenty
-- dál sedí, nové parametry mají výchozí hodnotu.
--
-- Volající odpovídá za kontrolu auth.uid() <> příjemce (jako dřív).
-- Každá podmínka je v dotazech JEN JEDNOU (pravidlo 7b), aby šla rozbít
-- jedna po druhé: tenant_id i user_id.
-- ---------------------------------------------------------------------

drop function if exists app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time);

create function app.upozornit_smenu(
  p_tenant            uuid,
  p_user_id           uuid,
  p_branch_id         uuid,
  p_druh              text,
  p_den               date,
  p_od                time,
  p_do                time,
  p_smena             uuid default null,
  p_puvodni_den       date default null,
  p_puvodni_od        time default null,
  p_puvodni_do        time default null,
  p_puvodni_pobocka   uuid default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni_den     date := p_puvodni_den;
  v_puvodni_od      time := p_puvodni_od;
  v_puvodni_do      time := p_puvodni_do;
  v_puvodni_pobocka uuid := p_puvodni_pobocka;
  v_nejstarsi       record;
  v_hodin           integer;
  v_zacatek         timestamptz;
  v_priorita        text := 'normal';
begin
  /*
    Slučování (C4): nepřečtená upozornění téhož druhu na tentýž den se
    nahradí novým. U ZMĚNY se před smazáním přečte jejich NEJSTARŠÍ
    „původně“ — je to stav před celou sérií úprav. Bez toho by výsledek
    ukazoval jen poslední krok („09–17 → 10–18“) a zaměstnanec by nevěděl,
    co mu vlastně změnili oproti tomu, co si pamatuje.
  */
  if p_druh = 'smena.zmenena' and p_smena is not null then
    select (n.telo->>'puvodni_den')::date        as den,
           (n.telo->>'puvodni_od')::time         as od,
           (n.telo->>'puvodni_do')::time         as doo,
           (n.telo->>'puvodni_pobocka')::uuid    as pobocka
      into v_nejstarsi
      from public.notifications n
     where n.tenant_id      = p_tenant
       and n.user_id        = p_user_id
       and n.shift_id       = p_smena
       and n.druh           = p_druh
       and n.telo->>'den'   = p_den::text
       and n.read_at is null
       and n.telo ? 'puvodni_od'
     order by n.created_at asc
     limit 1;

    if found then
      v_puvodni_den     := v_nejstarsi.den;
      v_puvodni_od      := v_nejstarsi.od;
      v_puvodni_do      := v_nejstarsi.doo;
      v_puvodni_pobocka := v_nejstarsi.pobocka;
    end if;
  end if;

  delete from public.notifications
   where tenant_id      = p_tenant
     and user_id        = p_user_id
     and druh           = p_druh
     and telo->>'den'   = p_den::text
     and read_at is null;

  /*
    Vrácení do původního stavu: den, čas i pobočka se rovnají tomu, co
    bylo před sérií úprav. Není o čem informovat — a smazané upozornění
    o mezikroku by zůstalo viset, kdyby se tu nevrátilo dřív.
  */
  if p_druh = 'smena.zmenena'
     and v_puvodni_od is not null
     and v_puvodni_den   is not distinct from p_den
     and v_puvodni_od    = p_od
     and v_puvodni_do    = p_do
     and v_puvodni_pobocka is not distinct from p_branch_id then
    return;
  end if;

  /*
    Důležitost. Jen pro druhy, které mění, na co člověk spoléhá, a jen
    když firma pravidlo zapnula. Začátek se počítá v pásmu pobočky —
    „za tři hodiny“ nesmí záviset na tom, kde běží server.
  */
  if p_druh in ('smena.zmenena', 'smena.nova', 'smena.odebrana') then
    select s.smeny_dulezita_hodin into v_hodin
      from public.tenant_settings s
     where s.tenant_id = p_tenant;

    if v_hodin is not null then
      v_zacatek := (p_den + p_od) at time zone app.zona_pobocky(p_branch_id);
      if v_zacatek > now() and v_zacatek <= now() + make_interval(hours => v_hodin) then
        v_priorita := 'important';
      end if;
    end if;
  end if;

  insert into public.notifications
    (tenant_id, user_id, branch_id, druh, telo, priorita, shift_id)
  values (
    p_tenant,
    p_user_id,
    p_branch_id,
    p_druh,
    jsonb_strip_nulls(jsonb_build_object(
      'den', p_den,
      'od',  to_char(p_od, 'HH24:MI'),
      'do',  to_char(p_do, 'HH24:MI'),
      'puvodni_den',     v_puvodni_den,
      'puvodni_od',      to_char(v_puvodni_od, 'HH24:MI'),
      'puvodni_do',      to_char(v_puvodni_do, 'HH24:MI'),
      'puvodni_pobocka', v_puvodni_pobocka
    )),
    v_priorita,
    p_smena
  );
end $$;

revoke all on function app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time, uuid, date, time, time, uuid)
  from public, anon, authenticated;

comment on function app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time, uuid, date, time, time, uuid) is
  'Zapíše upozornění na změnu směny se slučováním. U změny drží nejstarší '
  '„původně“ celé série úprav a při návratu do původního stavu neupozorní. '
  'Vlastní změnu (auth.uid() = p_user_id) musí vyloučit volající.';


-- ---------------------------------------------------------------------
-- 3. ULOZIT_SMENU — upozornění zpátky (viz hlavička, oddíl 1)
--
-- Stejná signatura jako v 20260916200000 → `create or replace` ji
-- nahradí, nevznikne druhá. Tělo je TOTÉŽ jako tam (včetně pauzy a
-- šablony); přibyla jen část „upozornění“ na konci a dvě proměnné.
-- ---------------------------------------------------------------------

create or replace function public.ulozit_smenu(
  p_tenant    uuid,
  p_smena     uuid,
  p_branch    uuid,
  p_employee  uuid,
  p_position  uuid,
  p_den       date,
  p_od        time,
  p_do        time,
  p_poznamka  text default '',
  p_sablona_key text default null,
  p_pauza_od  time default null,
  p_pauza_do  time default null
)
returns table (smena uuid, varovani text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni       public.shifts;
  v_id            uuid;
  v_varovani      text[] := '{}';
  v_zacatek       date;
  v_kolize        record;
  v_jmeno         text;
  v_user_id       uuid;
  v_stary_user_id uuid;
begin
  if not app.has_access(p_tenant, 'shifts.manage', p_branch) then
    raise exception 'Plánovat směny na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_smena is not null then
    select * into v_puvodni from public.shifts
    where id = p_smena and tenant_id = p_tenant;

    if not found then
      raise exception 'Takovou směnu neznám.' using errcode = 'no_data_found';
    end if;

    -- Viz hlavička: i původní pobočka.
    if not app.has_access(p_tenant, 'shifts.manage', v_puvodni.branch_id) then
      raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_den is null or p_od is null or p_do is null then
    raise exception 'Vyplňte datum a čas od–do.' using errcode = 'check_violation';
  end if;

  if p_od = p_do then
    raise exception 'Začátek a konec jsou stejné. Směna by neměla žádnou délku.'
      using errcode = 'check_violation';
  end if;

  /*
    Pauza je buď obě pole, nebo žádné — "od bez do" by appka nemohla
    ukázat ani spočítat. Nulová délka je stejná chyba jako u směny
    samotné (od = do).
  */
  if (p_pauza_od is null) <> (p_pauza_do is null) then
    raise exception 'Pauza potřebuje čas od i do — nebo žádný z nich.'
      using errcode = 'check_violation';
  end if;
  if p_pauza_od is not null and p_pauza_od = p_pauza_do then
    raise exception 'Pauza od a do jsou stejné. Pauza by neměla žádnou délku.'
      using errcode = 'check_violation';
  end if;

  -- Zaměstnanec smí být prázdný (volná směna), ale ne cizí.
  if p_employee is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null
  ) then
    raise exception 'Takového zaměstnance v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  if p_position is not null and not exists (
    select 1 from public.positions po
    where po.id = p_position and po.tenant_id = p_tenant
  ) then
    raise exception 'Takovou pozici v téhle firmě nemám.'
      using errcode = 'no_data_found';
  end if;

  /*
    Provozní den (pravidlo 10). Směna, která začíná před začátkem
    provozního dne pobočky, patří ve skutečnosti do dne PŘEDCHOZÍHO —
    a kiosek i docházka ji podle `shift_date` hledají jinde.

    Datum se schválně nepřepisuje: člověk napsal, co napsal, a tiše mu
    to posunout o den je horší než mu to říct.
  */
  v_zacatek := app.business_date(
    p_branch,
    (p_den + p_od) at time zone app.zona_pobocky(p_branch)
  );
  if v_zacatek is distinct from p_den then
    v_varovani := v_varovani || format(
      'Směna začíná před začátkem provozního dne, takže patří do %s, ne do %s. Docházka i kiosek ji budou hledat tam.',
      to_char(v_zacatek, 'DD.MM.YYYY'), to_char(p_den, 'DD.MM.YYYY'));
  end if;

  if p_do < p_od then
    v_varovani := v_varovani || format(
      'Směna končí druhý den v %s. Délka je %s h %s min.',
      to_char(p_do, 'HH24:MI'),
      app.delka_smeny_minut(p_od, p_do) / 60,
      lpad((app.delka_smeny_minut(p_od, p_do) % 60)::text, 2, '0'));
  end if;

  /*
    Pauza mimo směnu je jen varování, ne chyba — appka nemá dost
    znalostí ani u obyčejného od–do přes půlnoc (viz výš), takže totéž
    u pauzy uvnitř přes půlnoc jdoucí směny by šlo jen domýšlet.
    Kontrola proto platí jen u směny, která přes půlnoc NEJDE — tam je
    "uvnitř" jednoznačné.
  */
  if p_pauza_od is not null and p_do > p_od and (p_pauza_od < p_od or p_pauza_do > p_do) then
    v_varovani := v_varovani || 'Pauza zasahuje mimo dobu směny — zkontrolujte časy.';
  end if;

  /* --- zápis ------------------------------------------------------ */

  if p_smena is null then
    insert into public.shifts
      (tenant_id, branch_id, employee_id, position_id, shift_date,
       starts_at, ends_at, note, sablona_key, pauza_od, pauza_do, created_by)
    values
      (p_tenant, p_branch, p_employee, p_position, p_den,
       p_od, p_do, coalesce(btrim(p_poznamka), ''),
       nullif(btrim(coalesce(p_sablona_key, '')), ''), p_pauza_od, p_pauza_do,
       (select auth.uid()))
    returning id into v_id;
  else
    update public.shifts
       set branch_id   = p_branch,
           employee_id = p_employee,
           position_id = p_position,
           shift_date  = p_den,
           starts_at   = p_od,
           ends_at     = p_do,
           note        = coalesce(btrim(p_poznamka), ''),
           sablona_key = nullif(btrim(coalesce(p_sablona_key, '')), ''),
           pauza_od    = p_pauza_od,
           pauza_do    = p_pauza_do,
           updated_at  = now()
     where id = p_smena
    returning id into v_id;
  end if;

  /*
    Překryv AŽ PO ZÁPISU a jen jako varování. Počítá se v minutách od
    začátku dne, aby směna přes půlnoc nevypadala jako zápor.
  */
  if p_employee is not null then
    for v_kolize in
      select s.shift_date, s.starts_at, s.ends_at, b.name as pobocka
      from public.shifts s
      join public.branches b on b.id = s.branch_id
      where s.tenant_id = p_tenant
        and s.employee_id = p_employee
        and s.id <> v_id
        and s.status <> 'cancelled'
        and s.shift_date between p_den - 1 and p_den + 1
        -- Dvě úsečky na časové ose se překrývají, když každá začíná
        -- dřív, než ta druhá končí.
        and (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
            < extract(epoch from p_od)::integer / 60 + app.delka_smeny_minut(p_od, p_do)
        and extract(epoch from p_od)::integer / 60
            < (s.shift_date - p_den) * 1440 + extract(epoch from s.starts_at)::integer / 60
              + app.delka_smeny_minut(s.starts_at, s.ends_at)
      order by s.shift_date, s.starts_at
    loop
      v_varovani := v_varovani || format(
        'Překrývá se s jinou směnou téhož člověka: %s %s–%s, %s.',
        to_char(v_kolize.shift_date, 'DD.MM.'),
        to_char(v_kolize.starts_at, 'HH24:MI'),
        to_char(v_kolize.ends_at, 'HH24:MI'),
        v_kolize.pobocka);
    end loop;
  end if;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => case when p_smena is null then 'smena.zalozena' else 'smena.upravena' end,
    p_entity_type => 'shift',
    p_entity_id   => v_id::text,
    p_branch      => p_branch,
    p_before      => case when p_smena is null then null else jsonb_build_object(
                       'den', v_puvodni.shift_date,
                       'od', v_puvodni.starts_at,
                       'do', v_puvodni.ends_at,
                       'zamestnanec', v_puvodni.employee_id,
                       'pobocka', v_puvodni.branch_id
                     ) end,
    p_after       => jsonb_build_object(
                       'den', p_den, 'od', p_od, 'do', p_do,
                       'zamestnanec', p_employee, 'pobocka', p_branch,
                       'pauza_od', p_pauza_od, 'pauza_do', p_pauza_do
                     )
  );

  /* --- upozornění (obnoveno, viz hlavička souboru, oddíl 1) --------- */

  -- user_id přiřazeného zaměstnance po změně.
  if p_employee is not null then
    select e.user_id into v_user_id
      from public.employees e
     where e.id = p_employee
       and e.tenant_id = p_tenant
       and e.deleted_at is null;
  end if;

  if p_smena is null then
    -- Nová směna: upozornit přiřazeného (jen pokud není sám autor).
    if v_user_id is not null and v_user_id <> (select auth.uid()) then
      perform app.upozornit_smenu(p_tenant, v_user_id, p_branch, 'smena.nova', p_den, p_od, p_do, v_id);
    end if;
  else
    if v_puvodni.employee_id is distinct from p_employee then
      -- Zaměstnanec se změnil.

      -- Starý zaměstnanec dostane „odebrana“ (bez odkazu na směnu —
      -- ke směně, která už není jeho, se dostávat nemá).
      if v_puvodni.employee_id is not null then
        select e.user_id into v_stary_user_id
          from public.employees e
         where e.id = v_puvodni.employee_id
           and e.tenant_id = p_tenant;
        if v_stary_user_id is not null and v_stary_user_id <> (select auth.uid()) then
          perform app.upozornit_smenu(
            p_tenant, v_stary_user_id,
            coalesce(v_puvodni.branch_id, p_branch),
            'smena.odebrana',
            v_puvodni.shift_date, v_puvodni.starts_at, v_puvodni.ends_at
          );
        end if;
      end if;

      -- Nový zaměstnanec dostane „nova“.
      if v_user_id is not null and v_user_id <> (select auth.uid()) then
        perform app.upozornit_smenu(p_tenant, v_user_id, p_branch, 'smena.nova', p_den, p_od, p_do, v_id);
      end if;

    elsif v_user_id is not null
      and v_user_id <> (select auth.uid())
      and (
        v_puvodni.shift_date is distinct from p_den
        or v_puvodni.starts_at is distinct from p_od
        or v_puvodni.ends_at   is distinct from p_do
        or v_puvodni.branch_id is distinct from p_branch
      ) then
      -- Stejný zaměstnanec, změnilo se datum/čas/pobočka. „Původně“ jde
      -- s sebou, aby upozornění mohlo říct „08:00–16:00 → 10:00–18:00“.
      perform app.upozornit_smenu(
        p_tenant, v_user_id, p_branch, 'smena.zmenena', p_den, p_od, p_do, v_id,
        v_puvodni.shift_date, v_puvodni.starts_at, v_puvodni.ends_at, v_puvodni.branch_id
      );
    end if;
  end if;

  smena := v_id;
  varovani := v_varovani;
  return next;
end;
$$;

comment on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time) is
  'Založí nebo upraví směnu, volitelně s pauzou uvnitř (trhaná směna), '
  'a upozorní dotčeného zaměstnance (nová / změněná / odebraná). '
  'Pauza je jen plán — do mzdy nezasahuje.';

revoke all on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time)
  from public, anon;
grant execute on function public.ulozit_smenu(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text, time, time)
  to authenticated;


-- ---------------------------------------------------------------------
-- 4. STAV_POTVRZENI_SMENY — pro vedoucího
--
-- Vrací JEN časy a jméno: kdy upozornění vzniklo, kdy ho člověk přečetl
-- a kdy potvrdil. Obsah upozornění se nevrací, `notifications` zůstává
-- soukromá. Právo se ověřuje na pobočce TÉ SMĚNY (ne té z adresy), a
-- směna, která v téhle firmě není, vrátí prázdno — ne chybu, ať se nedá
-- zkoušet, jaká id existují.
--
-- Bere se NEJNOVĚJŠÍ upozornění na tuhle směnu (nova / zmenena). Po
-- přeřazení na jiného člověka je to tedy jeho upozornění, ne to staré.
-- ---------------------------------------------------------------------

create or replace function public.stav_potvrzeni_smeny(
  p_tenant uuid,
  p_smena  uuid
)
returns table (
  jmeno        text,
  druh         text,
  prijato_at   timestamptz,
  precteno_at  timestamptz,
  potvrzeno_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_branch uuid;
begin
  select s.branch_id into v_branch
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  if not found then
    return;
  end if;

  if not app.has_access(p_tenant, 'shifts.manage', v_branch) then
    raise exception 'Potvrzení směn na téhle pobočce nevidíte.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select e.full_name, n.druh, n.created_at, n.read_at, n.acknowledged_at
      from public.notifications n
      join public.employees e
        on e.user_id = n.user_id
       and e.tenant_id = p_tenant
     where n.tenant_id = p_tenant
       and n.shift_id  = p_smena
       and n.druh in ('smena.nova', 'smena.zmenena')
     order by n.created_at desc
     limit 1;
end;
$$;

comment on function public.stav_potvrzeni_smeny(uuid, uuid) is
  'Pro vedoucího: kdy dotčený člověk dostal, přečetl a potvrdil poslední '
  'upozornění na směnu. Jen časy a jméno, nikdy obsah upozornění.';

revoke all on function public.stav_potvrzeni_smeny(uuid, uuid) from public, anon;
grant execute on function public.stav_potvrzeni_smeny(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. NASTAVENÍ „DŮLEŽITÁ ZMĚNA SMĚNY“ — průzor jako u zapomenutého odchodu
-- ---------------------------------------------------------------------

create or replace function public.nastavit_dulezitou_zmenu_smeny(
  p_tenant uuid,
  p_hodin  integer
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_drive integer;
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení firmy mění jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Prázdné = vypnuto. Jinak celé hodiny v rozumném rozmezí.
  if p_hodin is not null and (p_hodin < 1 or p_hodin > 720) then
    raise exception 'Hranice musí být mezi 1 a 720 hodinami, nebo prázdná.'
      using errcode = 'check_violation';
  end if;

  select s.smeny_dulezita_hodin into v_drive
    from public.tenant_settings s
   where s.tenant_id = p_tenant;

  insert into public.tenant_settings (tenant_id, smeny_dulezita_hodin)
  values (p_tenant, p_hodin)
  on conflict (tenant_id) do update
    set smeny_dulezita_hodin = excluded.smeny_dulezita_hodin;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'settings.smeny_dulezita_hodin',
    p_entity_type => 'tenant_settings',
    p_entity_id   => p_tenant::text,
    p_before      => jsonb_build_object('hodin', v_drive),
    p_after       => jsonb_build_object('hodin', p_hodin)
  );
end;
$$;

comment on function public.nastavit_dulezitou_zmenu_smeny(uuid, integer) is
  'Do kolika hodin před začátkem je změna směny „důležitá“. Prázdné = '
  'žádná. Patří do nastavení firmy, ne do kódu.';

revoke all on function public.nastavit_dulezitou_zmenu_smeny(uuid, integer) from public, anon;
grant execute on function public.nastavit_dulezitou_zmenu_smeny(uuid, integer) to authenticated;
