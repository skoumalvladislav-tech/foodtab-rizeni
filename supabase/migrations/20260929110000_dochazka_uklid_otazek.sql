-- =====================================================================
-- Foodtab — úklid tří otevřených otázek k docházce (25, 31, 33)
--
-- Šéfík 29. 9. 2026: „projdi staré otevřené otázky v
-- docs/hlaseni/otazky.md a dotáhni ty, které jsou čistě technický
-- nedodělek, ne obchodní rozhodnutí." Otázky 25, 31 a 33 mají svoje
-- vlastní jasné technické doporučení od autora (dřívější relace), jen
-- nebyly implementované — nejsou to obchodní rozhodnutí, jsou to
-- bezpečnostní/konzistenční díry, které autor sám identifikoval.
--
-- ---------------------------------------------------------------------
-- CO PŘIBÝVÁ (tři nesouvisející opravy, každá ve své sekci)
--
--   1. public.zapsat_rucni_dochazku — vlastní docházku ručně zapíše
--      jen majitel (otázka 25). Stejné pravidlo jako
--      upravit_usek_dochazky / stornovat_usek_dochazky.
--   2. attendance_events — INSERT pro authenticated zavřený úplně,
--      žádné sloupce (otázka 31). Aplikace do tabulky přímo nezapisuje
--      nikde (ověřeno).
--   3. app.otevreny_prichod — čte řádek `otevreny` z
--      app.useky_dochazky místo vlastní (rozjeté) definice „otevřeno"
--      (otázka 33). Totéž sjednoceno v lib/dochazka-dnes.ts.
--
-- Žádná ze tří sekcí nesahá do těla jiné funkce, než na kterou míří —
-- bezpečné pustit v jednom souboru i každou zvlášť.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. public.zapsat_rucni_dochazku — vlastní docházku jen majitel
--    (otázka 25, docs/hlaseni/otazky.md)
--
-- „Smí vedoucí upravit nebo stornovat SVOU vlastní docházku?" —
-- upravit_usek_dochazky a stornovat_usek_dochazky (obě 20260927110000)
-- tohle pravidlo už mají: vedoucí s attendance.manage si vlastní úsek
-- upravit ani stornovat nemůže, jen majitel („Vlastní docházku si
-- upravit/stornovat nemůžete — udělá to majitel nebo jiný vedoucí.").
-- Starší public.zapsat_rucni_dochazku (naposledy
-- 20260903020000_rucni_odchod_bez_otevrene_smeny.sql) tohle pravidlo
-- NEMĚLA — vedoucí si přes ni pořád mohl zapsat vlastní ruční příchod
-- i odchod. Stejná kontrola, stejný styl hlášky jako u úpravy úseku
-- (i stejný errcode insufficient_privilege).
--
-- Umístění: hned za kontrolu attendance.manage na pobočce — ta je
-- v týhle funkci (na rozdíl od upravit/stornovat) úplně první, takže
-- kontrola vlastní docházky navazuje na ni stejným způsobem.
--
-- Tělo je jinak BEZE ZMĚNY oproti 20260903020000 — vkládá se jeden
-- nový blok a proměnná v_user pro auth.uid().
-- ---------------------------------------------------------------------

create or replace function public.zapsat_rucni_dochazku(
  p_tenant   uuid,
  p_branch   uuid,
  p_employee uuid,
  p_druh     text,
  p_kdy      timestamp,
  p_duvod    text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id       uuid;
  v_zona     text;
  v_kdy      timestamptz;
  v_posledni record;
  v_user     uuid := (select auth.uid());
begin
  if not app.has_access(p_tenant, 'attendance.manage', p_branch) then
    raise exception 'Zapisovat docházku ručně smí jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Vlastní docházku ručně nezapíše ani vedoucí s attendance.manage,
  -- jen majitel (otázka 25) — tentýž filtr a tatáž hláška jako
  -- upravit_usek_dochazky / stornovat_usek_dochazky (v_clovek.user_id
  -- = v_user and not app.is_owner(p_tenant)).
  if exists (
       select 1 from public.employees e
        where e.id = p_employee
          and e.tenant_id = p_tenant
          and e.user_id = v_user)
     and not app.is_owner(p_tenant)
  then
    raise exception 'Vlastní docházku si zapsat nemůžete — udělá to majitel nebo jiný vedoucí.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_druh not in ('in', 'out', 'break_start', 'break_end') then
    raise exception 'Neznámý druh záznamu: %', p_druh using errcode = 'check_violation';
  end if;

  if p_kdy is null then
    raise exception 'Vyplňte, kdy se to stalo.' using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) < 3 then
    raise exception 'Napište prosím, proč se záznam zadává ručně. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  v_zona := app.zona_pobocky(p_branch);
  if v_zona is null then
    raise exception 'Pobočka neexistuje.' using errcode = 'no_data_found';
  end if;

  v_kdy := p_kdy at time zone v_zona;

  /*
    Je k tomu čemu zavřít? Poslední platná událost člověka PŘED zadaným
    časem — pobočka se neřeší, protože příchod na jedné a odchod na
    druhé je normální stav (migrace 20260902060000).
  */
  if p_druh in ('out', 'break_end') then
    select a.kind, a.occurred_at, b.name as pobocka
      into v_posledni
    from public.attendance_events a
    join public.branches b on b.id = a.branch_id
    where a.tenant_id   = p_tenant
      and a.employee_id = p_employee
      and a.occurred_at <= v_kdy
      and a.stornovano_kdy is null
    order by a.occurred_at desc, a.created_at desc
    limit 1;

    if p_druh = 'out' and (v_posledni.kind is null or v_posledni.kind = 'out') then
      /*
        Věta říká, CO se stalo a CO S TÍM — ne „nepovedlo se". Když
        poslední záznam existuje, je v hlášce i s časem: nejčastější
        příčina je, že chybí spíš příchod.
      */
      if v_posledni.kind is null then
        raise exception
          'K tomuhle času není co uzavřít — před ním nemá tenhle člověk žádný záznam. Chybí nejspíš příchod, ne odchod.'
          using errcode = 'invalid_parameter_value';
      else
        raise exception
          'K tomuhle času není co uzavřít — poslední záznam je taky odchod (% v %). Zkontrolujte, jestli nechybí spíš příchod.',
          to_char(v_posledni.occurred_at at time zone v_zona, 'DD.MM.'),
          to_char(v_posledni.occurred_at at time zone v_zona, 'HH24:MI')
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    if p_druh = 'break_end' and (v_posledni.kind is null or v_posledni.kind <> 'break_start') then
      raise exception
        'K tomuhle času není co uzavřít — před ním nezačala žádná přestávka.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, source, occurred_at, note)
  values (p_tenant, p_branch, p_employee, p_druh, 'manual', v_kdy, btrim(p_duvod))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text) is
  'Ruční záznam docházky. `p_kdy` je hodina na zdi; pásmo dodá pobočka. '
  'Odchod bez otevřené směny se ODMÍTNE. Vlastní docházku si zapíše jen '
  'majitel (otázka 25) — stejné pravidlo a hláška jako '
  'upravit_usek_dochazky / stornovat_usek_dochazky.';

-- Grant (authenticated execute, anon/public ne) se nemění —
-- create or replace privilegia nepřepisuje.


-- ---------------------------------------------------------------------
-- 2. attendance_events — INSERT pro authenticated zavřený úplně
--    (otázka 31, docs/hlaseni/otazky.md)
--
-- Migrace 20260927110000 zúžila INSERT na sedm neutrálních sloupců
-- (tenant_id, branch_id, employee_id, kind, occurred_at, source,
-- note) — přesně těch, na kterých stály scénáře krok2 a krok6. Autor
-- sám tehdy doporučil zavřít INSERT úplně v dalším kroku, protože
-- aplikace do tabulky přímo nezapisuje nikde — jen čte
-- (`.select(...)`), zápis vždy jde přes app.pichnout /
-- zapsat_rucni_dochazku / upravit_usek_dochazky /
-- stornovat_usek_dochazky.
--
-- OVĚŘENO PŘED touhle migrací (bod 31.1 zadání): grep přes celé app/
-- a lib/ na `.from("attendance_events")` / `.from('attendance_events')`
-- — všech devět výskytů je `.select(...)`, žádný `.insert()`,
-- `.update()`, `.delete()` ani `.upsert()`. Kdyby se to jednou
-- rozešlo (nový kód začal zapisovat přímo), spadne na 42501 hned při
-- prvním pokusu — nahlas, ne tiše.
--
-- Vedoucí přes rozhraní databáze dřív pořád uměl vložit obyčejný
-- záznam, který vypadá jako píchnutí (source = 'app'), a audit o něm
-- nevěděl (otazky.md, „Co zůstává otevřené"). Tahle mezera teď mizí.
--
-- Scénáře krok2 a krok6, které dřív INSERT na těch sedmi sloupcích
-- testovaly jako POZITIVNÍ případ, jsou přepsané na negativní (viz
-- jejich hlavičky); krok63 (oddíl 8) má přepsané tři kontroly, co dřív
-- čekaly úspěch/sedm sloupců v katalogu, teď čekají nic.
-- ---------------------------------------------------------------------

revoke insert on public.attendance_events from authenticated;

comment on policy attendance_insert on public.attendance_events is
  'Od 20260929110000 bez INSERT grantu pro authenticated nepustí nic —'
  ' zavřeno úplně (otázka 31). Ruční zápis jde jen přes '
  'zapsat_rucni_dochazku / app.pichnout; ty běží jako security definer '
  'a grant tedy nepotřebují. Vrátit grant = vrátit „píchnutí" bez '
  'auditu z rozhraní databáze.';


-- ---------------------------------------------------------------------
-- 3. app.otevreny_prichod — jeden zdroj pravdy s mzdou (otázka 33,
--    docs/hlaseni/otazky.md)
--
-- „app.otevreny_prichod se rozchází s app.useky_dochazky": přehled
-- (Dnes, kiosek, píchání) chtěl odchod OSTŘE POZDĚJI než příchod
-- a o pořadí shod nerozhodoval; mzdový automat (app.useky_dochazky,
-- opis app.worked_minutes) spároval i odchod VE STEJNOU CHVÍLI (úsek
-- 0 min) a shody řadil podle created_at. V ostré DB 27. 9. to dalo
-- reálný nesoulad: ruční příchod i odchod v 09:00:00 — přehled tvrdil
-- „v práci od 27. 9.", mzda měla úsek 0 min a storno příchodu databáze
-- odmítla („Mezitím to někdo změnil"), protože v automatu ten příchod
-- otevřený nebyl.
--
-- AUTOROVO DOPORUČENÍ (otázka 33): přepsat app.otevreny_prichod na
-- řádek `otevreny` z app.useky_dochazky — TENTÝŽ zdroj pravdy jako
-- mzda, žádná druhá (rozjetá) definice „otevřeno" vedle. Totéž
-- sjednoceno v lib/dochazka-dnes.ts (otevrenePrichody).
--
-- uzavreno_systemem (20260905010000) se filtruje NAVÍC, ne uvnitř
-- app.useky_dochazky — ten sloupec nezná: nový příchod starý jen
-- odsune z cesty dalšímu příchodu, úsek ale zůstává neuzavřený, ať ho
-- pořád vidí hlídač zapomenutých odchodů (proto se do jeho podmínky
-- nikdy nesmělo přidat). „Jsem právě v práci" ho ale brát nesmí — to
-- je kontrakt krok29, oddíl 4 (Karel Dnešní), který se touhle změnou
-- nemění.
--
-- e.tenant_id a e.deleted_at si funkce hlídá sama (pravidlo 7b):
-- app.useky_dochazky bere jen p_employee, tenant si sama neověřuje
-- (volají ji jen definer funkce, které si to ohlídají — přesně jako
-- tady).
--
-- CO SE TÍM VĚDOMĚ MĚNÍ oproti staré definici (žádné z toho nechytá
-- existující scénář, ale ať to čtenář nebere jako nedopatření):
--
--   * Dva příchody BEZ odchodu TÉHOŽ provozního dne (možné jen ručním
--     zápisem — app.pichnout druhý příchod téhož dne vždy odmítne):
--     dřív se „otevřený" bral ten POZDĚJŠÍ, teď (jako mzda) zůstává
--     otevřený jen ten PRVNÍ a druhý je navíc-příchod
--     (`navic_prichod`) — mzda i přehled se teď na tom shodnou, dřív
--     se mohly rozejít stejně jako v otázce 33.
--   * Smazaný zaměstnanec (`deleted_at`) už nemá otevřený příchod
--     vůbec, i kdyby v datech nějaký zůstal — stejné pravidlo jako
--     app.worked_minutes a app.useky_dochazky mají odjakživa.
--
-- Párování samo (kdo s kým, kdy je úsek 0 min) se NEMĚNÍ — žádná nová
-- logika tady, jen čtení výstupu app.useky_dochazky. Boční panel
-- přehledu (dva otevřené příchody, storno omylem) i mzda dál fungují
-- stejně, jen teď vidí stejné „otevřeno".
-- ---------------------------------------------------------------------

create or replace function app.otevreny_prichod(p_tenant uuid, p_employee uuid)
returns table (id uuid, branch_id uuid, business_date date, occurred_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select u.prichod_id, u.prichod_pobocka, u.den, u.prichod
  from public.employees e
  cross join lateral app.useky_dochazky(e.id, '-infinity'::date, 'infinity'::date) u
  join public.attendance_events a on a.id = u.prichod_id
  where e.id = p_employee
    and e.tenant_id = p_tenant
    and e.deleted_at is null
    and u.druh = 'otevreny'
    and a.uzavreno_systemem is null
  order by u.prichod desc
  limit 1;
$$;

comment on function app.otevreny_prichod(uuid, uuid) is
  'Nejnovější příchod bez odchodu, napříč pobočkami firmy — čte řádek '
  'druh=''otevreny'' z app.useky_dochazky, JEDEN zdroj pravdy s mzdou '
  '(otázka 33, docs/hlaseni/otazky.md). Navíc filtruje '
  'uzavreno_systemem, který useky_dochazky nezná (20260905010000).';

-- revoke/grant beze změny (public, anon, authenticated bez EXECUTE) —
-- create or replace privilegia nepřepisuje.
