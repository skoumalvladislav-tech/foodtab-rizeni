-- =====================================================================
-- Foodtab — výdělky všech lidí za měsíc: odpracováno, podle rozpisu,
-- zálohy
--
-- Zadání majitele 24. 9. 2026: „ukazovat majitelům aktuální výdělek
-- zaměstnanců, dále předběžný výdělek dle rozpisu směn." Obrazovka je
-- záložka Výdělky v Docházce (/[rozsah]/dochazka/vydelky); tohle je
-- její jediný zdroj dat, jedno volání na celou tabulku.
--
-- Dva oddíly:
--   1. public.vydelky_prehled — nová funkce pro tu záložku
--   2. public.employee_earnings — oprava starší díry v právech (řádky
--      bez pobočky), nalezená při kontrole oddílu 1
--
-- PROČ NOVÁ FUNKCE, A NE employee_earnings + zalohy_pobocky
-- employee_earnings nemá zálohy ani plán a řádky bez pobočky pouští
-- každému, kdo má payroll.read kdekoli (bod 8 níž). Předběžný výdělek
-- aplikace spočítat nemůže vůbec: sazby jsou pro authenticated zavřené
-- (20260831010000_mzdy_sazby.sql, revoke all) a ven smí jen hotové
-- číslo. Jména a typy sloupců jsou kontrakt s aplikací — neměnit je
-- bez tabulka-vydelku.tsx.
--
-- ---------------------------------------------------------------------
-- ROZHODNUTÍ (návrh ze 24. 9., body 4–8; nejopatrnější varianty,
-- otázky pro Šéfíka)
--
-- 4. „Vyděláno" = app.earnings beze změny: uzavřené páry příchod→odchod,
--    sazba ke dni, paušál přestávky. Běžící směna se NEPOČÍTÁ, přičte
--    se po odchodu — obrazovka to řekne jednou větou. Nedomýšlí se.
--
-- 5. „Podle rozpisu" = zbývající směny člověka do konce měsíce:
--    * pracovní kopie rozpisu (starts_at/ends_at/pauza_*), i koncepty —
--      totéž, co vidí vedoucí v Rozpisu (sestavitMesicOsoby);
--    * status <> 'cancelled';
--    * PROVOZNÍ DEN SMĚNY, ne shift_date: směna, která začíná před
--      day_starts_at pobočky (noční 2:00–6:00 při dni od 5:00), patří
--      do provozního dne PŘEDCHOZÍHO. Tam ji zapíše docházka (spoušť
--      na attendance_events, odchod zdědí den příchodu) a tam ji hledá
--      kiosek; ulozit_smenu to při zápisu jen varuje, datum nepřepisuje
--      (20260916200000_trhana_smena.sql). Počítá se stejně jako tam:
--      app.business_date(pobočka, (shift_date + starts_at) v pásmu
--      pobočky). Podle něj se řídí všechno níž — hranice dneška, den
--      s docházkou, platnost paušálu i sazba;
--    * provozní den směny >= dnešní provozní den POBOČKY SMĚNY
--      (pravidlo 11) — ne current_date a ne domovská pobočka člověka;
--    * jen dny, ke kterým člověk ještě nemá odpracované minuty
--      (app.worked_minutes pro ten provozní den nevrátí KLADNÉ minuty).
--      Jinak by se den započetl dvakrát, ve výdělku i v plánu. Nulový
--      řádek (příchod a odchod omylem v téže minutě) den nevyřadí —
--      směna by jinak z plánu vypadla a ve výdělku se neobjevila;
--    * minuty = hrubá délka − trhaná pauza (jako minutSmeny v Rozpisu);
--      paušál přestávky se uplatní PO ČÁSTECH (dopoledne a odpoledne
--      trhané směny zvlášť), stejně jako ho worked_minutes uplatní na
--      jeden pár příchod→odchod;
--    * sazba k provoznímu dni směny (app.rate_at — earnings ji bere
--      k provoznímu dni docházky, tedy ke stejnému dni), zaokrouhluje
--      se až na konci (jako earnings). Den bez sazby se do částky
--      nepočítá a zvedne plan_sazba_chybi — nula by vypadala jako
--      výsledek.
--    Minulý měsíc má plán 0 sám od sebe, budoucí bere všechny směny.
--    Do měsíce se směna počítá podle shift_date (jako v Rozpisu), viz
--    ZNÁMÉ ROZDÍLY níž.
--
-- 6. Zálohy = nestornované zálohy člověka v měsíci na VŠECH pobočkách,
--    i nepotvrzené (jako muj_vyplatni_prehled — jinak by se majitelovo
--    „zbývá" nesešlo s dlaždicí, kterou vidí zaměstnanec). Měsíc se
--    ořízne date_trunc UVNITŘ: muj_vyplatni_prehled filtruje
--    `>= p_mesic` a se dnem uprostřed měsíce by půlku záloh minul.
--    Volba zalohy_zobrazeni se tu neuplatní — je to „co uvidí
--    zaměstnanci", ne vedení.
--
-- 7. Řádky: zaměstnanci firmy (deleted_at is null); s p_branch jen ti
--    s tou DOMOVSKOU pobočkou (jako employee_earnings). Řádek bez
--    odpracovaných minut, bez plánu a bez záloh se nevrací — majitel na
--    IČO bez sazby by jinak vyskočil jako „0 Kč" (zadání mezd, oddíl 6).
--
-- 8. Řádky BEZ POBOČKY (typicky majitel, app.create_tenant mu ji
--    nevyplní) vidí JEN ten, kdo má payroll.read na firemní úrovni:
--    app.has_access(p_tenant, 'payroll.read', null). can_read_scoped by
--    je pustil každému s payroll.read kdekoli — i vedoucímu jedné
--    pobočky, a ten by viděl výdělek majitele. Ostatní řádky jako
--    employee_earnings: can_read_scoped podle domovské pobočky.
--    Tutéž díru měla employee_earnings sama — opravená je v oddílu 2
--    dole, stejnou podmínkou.
--
-- hodinova_haleru je sazba ke dni měsíce nejbližšímu dnešku: u běžícího
-- měsíce dnešní provozní den (domovské pobočky; bez ní nejstarší
-- provozní den poboček firmy), u minulého jeho poslední den, u budoucího
-- první. employee_earnings bere vždy konec měsíce — u běžícího měsíce
-- by tak ukázala sazbu, která ještě neplatí.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * app.earnings ani app.worked_minutes se nemění. employee_earnings
--   jen v podmínce práv (oddíl 2), výpočet a sloupce zůstávají.
--   dnu_bez_dochazky v earnings počítá i budoucí směny — starší nález,
--   tahle obrazovka to číslo nepotřebuje, a proto ho ani nevrací.
-- * Plán počítá i směny na pobočkách, na které volající nevidí, stejně
--   jako výdělek počítá hodiny odtamtud. Kdo má payroll.read, dozví se
--   jen součet, ne rozpis — shifts.read tu nerozhoduje, vědomě.
-- * Den se z plánu vyřadí CELÝ, jakmile má uzavřený pár. U trhané
--   směny tak odpoledne po dopoledním odchodu „předběžně" klesne a
--   dorovná se až večerním odchodem. Párovat plán se skutečností po
--   částech by bylo odhadování, a to se u mezd nedělá.
-- * Pobočka směny existuje vždy (not null + cizí klíč), proto obyčejný
--   join. Firma směny se naopak hlídá zvlášť: směnu může vedoucí zapsat
--   i napřímo (politika shifts_write) a cizí klíč employee_id firmu
--   nekontroluje — cizí firma by jinak mohla podstrčit směnu našemu
--   člověku. Zálohy se zapisují jen přes RPC, firma se u nich přesto
--   hlídá taky (a.tenant_id = e.tenant_id): dnešní RPC je jen jedna
--   cesta dovnitř a filtr v definer funkci nesmí stát na tom, že jiná
--   zatím není.
--
-- ---------------------------------------------------------------------
-- ZNÁMÉ ROZDÍLY PLÁNU A MZDY (vědomě neopravené)
--
-- * PŘECHOD LETNÍHO ČASU. Plán měří délku směny hodinami na zdi
--   (app.delka_smeny_minut, stejně jako Rozpis), mzda skutečně
--   uplynulým časem mezi příchodem a odchodem. Noční směna 20:00–4:00
--   v noci přechodu má doopravdy 7 h (březen) nebo 9 h (říjen), plán
--   ukáže 8 h — a paušál se pak může rozejít i na prahu. Po
--   odpracování se den z plánu vyřadí a výdělek je správně; rozdíl
--   drží jen „předběžně" do té doby, dvakrát do roka a jen u směn přes
--   přechod. Opravit to znamená počítat délku z okamžiků v pásmu
--   pobočky i v Rozpisu, ne jen tady. Kontrola shody v krok55 takovou
--   noc schválně nemá (M2 + 19 na přechod nepadne nikdy).
--
-- * HRANICE MĚSÍCE. Do měsíce patří směna podle shift_date (jako
--   v Rozpisu a v sestavitMesicOsoby), mzda podle provozního dne
--   docházky. Noční směna 1. dne před day_starts_at je proto v plánu
--   měsíce M, ale po odpracování ji výdělek přičte k měsíci M − 1;
--   noční směna 1. dne měsíce M + 1 v „předběžně" za M chybí, i když
--   se k M nakonec přičte. Dvakrát se nezapočte nikdy: den s docházkou
--   se hledá i den před začátkem měsíce (worked_minutes od m.od − 1).
--
-- ---------------------------------------------------------------------
-- POZOR: PAUŠÁL PŘESTÁVKY JE TEĎ NA DVOU MÍSTECH
--
-- V app.worked_minutes (20260913150000_prestavky_pausalem.sql) a tady.
-- Podmínka je opsaná věcně přesně: pobočka přebíjí firmu (coalesce),
-- práh se porovnává s HRUBOU délkou části (>=), jen prestavka_minut > 0,
-- jen provozní dny od prestavka_platna_od — a NULL v platna_od (i
-- chybějící řádek tenant_settings) znamená „paušál neplatí", ne „platí
-- odjakživa". Provozní den je v obou ten den, kdy se přišlo:
-- worked_minutes bere business_date odchodu, a ten spoušť zdědí od
-- příchodu; tady provozní den směny (bod 5).
--
-- Kdo změní jedno místo, musí změnit i druhé. Jinak se „předběžně"
-- tiše rozejde se mzdou, kterou člověk nakonec dostane. Hlídá to
-- krok55_scenar.sql, oddíl KONTROLA SHODY: směna odpracovaná přesně
-- podle plánu musí dát worked_minutes == plán minut téže směny, a to
-- u 8 h, přesně na prahu, těsně pod ním, u trhané pod i nad prahem,
-- přes půlnoc, před platností, v den platnosti, s přebitím pobočkou,
-- u firmy bez data platnosti, u noční směny před začátkem provozního
-- dne a u noční směny v kalendářní den platnosti, jejíž provozní den
-- je ještě před ní. Ověřeno i obráceně: práh ve worked_minutes
-- změněný na `>` a plán nechaný být tam spadne.
--
-- Vytáhnout paušál do společné funkce by znamenalo sáhnout do
-- worked_minutes, tedy do výpočtu mezd (pravidlo 12, ověřit nad kopií
-- dat). To je samostatná práce, ne vedlejší účinek téhle.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. public.vydelky_prehled
-- ---------------------------------------------------------------------

create or replace function public.vydelky_prehled(
  p_tenant uuid,
  p_branch uuid,
  p_mesic  date
)
returns table (
  employee_id        uuid,
  full_name          text,
  branch_id          uuid,
  odpracovano_minut  integer,
  vydelano_haleru    bigint,
  sazba_chybi        boolean,
  hodinova_haleru    integer,
  plan_minut         integer,
  plan_haleru        bigint,
  plan_sazba_chybi   boolean,
  plan_smen          integer,
  zalohy_haleru      bigint,
  predbezne_haleru   bigint
)
language sql stable security definer set search_path = ''
as $$
  select e.id,
         e.full_name,
         e.branch_id,
         v.odpracovano_minut,
         v.vydelano_haleru::bigint,
         v.sazba_chybi,
         app.rate_at(e.id, least(greatest(d.dnes, m.od), m.do_)),
         p.minut,
         p.haleru,
         p.sazba_chybi,
         p.smen,
         z.soucet,
         v.vydelano_haleru + p.haleru
  -- p_mesic může být kterýkoli den měsíce (bod 6).
  from (select date_trunc('month', p_mesic)::date as od,
               app.konec_mesice(p_mesic)          as do_) m
  cross join public.employees e
  cross join lateral app.earnings(e.id, m.od) v

  -- Dnešní provozní den pro sazbu vedle částky. greatest/least NULL
  -- přeskočí, takže firma bez poboček dostane první den měsíce.
  cross join lateral (
    select coalesce(
             app.business_date(e.branch_id, now()),
             (select min(app.business_date(b.id, now()))
                from public.branches b
               where b.tenant_id = e.tenant_id
                 and b.deleted_at is null)
           ) as dnes
  ) d

  -- PLÁN PODLE ROZPISU (bod 5). Po směnách; částka se zaokrouhlí až ze
  -- součtu. sum(minut × sazba) den bez sazby přeskočí (NULL).
  cross join lateral (
    select coalesce(sum(s.minut), 0)::integer                               as minut,
           coalesce(round(sum(s.minut::numeric * s.sazba) / 60), 0)::bigint as haleru,
           coalesce(bool_or(s.sazba is null), false)                        as sazba_chybi,
           count(*)::integer                                                as smen
    from (
      select app.rate_at(e.id, pd.den) as sazba,
             /*
               Paušál na každou část zvlášť — opis podmínky z
               app.worked_minutes, viz POZOR v hlavičce. Chybějící řádek
               tenant_settings i NULL v prestavka_platna_od dají ve
               srovnání NULL, takže se odečte 0. Stejně jako tam.
             */
             (select sum(greatest(0, c.hruba - case
                       when pd.den >= ts.prestavka_platna_od
                        and coalesce(b.prestavka_minut, ts.prestavka_minut) > 0
                        and c.hruba >= coalesce(b.prestavka_od_minut, ts.prestavka_od_minut)
                       then coalesce(b.prestavka_minut, ts.prestavka_minut)
                       else 0
                     end))
                from unnest(case
                       /*
                         Trhaná směna, pauza celá uvnitř: dvě části, jako
                         dva páry příchod→odchod. Pauza mimo směnu (ulozit_smenu
                         to jen varuje) se nedá rozdělit — odečte se jako
                         v Rozpisu a zbytek je jedna část.
                       */
                       when h.do_pauzy + h.pauza <= h.hruba
                         then array[h.do_pauzy, h.hruba - h.do_pauzy - h.pauza]
                       else array[greatest(0, h.hruba - coalesce(h.pauza, 0))]
                     end) c(hruba)) as minut
      from public.shifts sm
      join public.branches b on b.id = sm.branch_id
      left join public.tenant_settings ts on ts.tenant_id = e.tenant_id
      -- Provozní den směny (bod 5): začátek směny jako okamžik v pásmu
      -- pobočky, z něj provozní den — totéž, co spočítá spoušť docházky
      -- z příchodu podle plánu.
      cross join lateral (
        select app.business_date(
                 sm.branch_id,
                 (sm.shift_date + sm.starts_at) at time zone app.zona_pobocky(sm.branch_id)
               ) as den
      ) pd
      -- Délky v minutách. Konec dřív než začátek je druhý den, ne zápor
      -- (app.delka_smeny_minut). Pauza jen s oběma časy, jako v Rozpisu.
      cross join lateral (
        select app.delka_smeny_minut(sm.starts_at, sm.ends_at) as hruba,
               app.delka_smeny_minut(sm.pauza_od, sm.pauza_do)  as pauza,
               (extract(epoch from sm.pauza_od)::integer
                  - extract(epoch from sm.starts_at)::integer + 86400) % 86400 / 60
                                                                as do_pauzy
      ) h
      where sm.employee_id = e.id
        and sm.tenant_id = e.tenant_id
        and sm.status <> 'cancelled'
        and sm.shift_date between m.od and m.do_
        and pd.den >= app.business_date(sm.branch_id, now())
        -- Den s docházkou se nepočítá dvakrát. Od m.od − 1: noční směna
        -- 1. dne patří provozně ještě do minulého měsíce. Jen kladné
        -- minuty — nulový pár (bod 5) den nevyřadí.
        and not exists (
          select 1 from app.worked_minutes(e.id, m.od - 1, m.do_) w
          where w.den = pd.den
            and w.minut > 0
        )
    ) s
  ) p

  -- ZÁLOHY (bod 6): všechny pobočky, i nepotvrzené, bez stornovaných.
  -- Firma zálohy se hlídá zvlášť, jako u směn: definer funkce nemá RLS
  -- a cizí klíč employee_id firmu nekontroluje.
  cross join lateral (
    select coalesce(sum(a.castka_haleru), 0)::bigint as soucet
    from public.advances a
    where a.employee_id = e.id
      and a.tenant_id = e.tenant_id
      and a.stav <> 'stornovana'
      and a.business_date between m.od and m.do_
  ) z

  -- Pravidlo 7b: uvnitř definer funkce RLS neplatí, firmu i práva si
  -- filtrujeme sami. Každý filtr jednou.
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (p_branch is null or e.branch_id = p_branch)
    and case
          when e.branch_id is null
            then app.has_access(p_tenant, 'payroll.read', null)
          else app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
        end
    and (v.odpracovano_minut > 0 or p.smen > 0 or z.soucet > 0)
  order by e.full_name;
$$;

comment on function public.vydelky_prehled(uuid, uuid, date) is
  'Výdělky lidí za měsíc pro vedení: odpracováno (app.earnings), zbývající '
  'plán podle rozpisu a zálohy. Jen s payroll.read; řádky bez pobočky jen '
  's payroll.read na firemní úrovni. Paušál přestávky je opsaný z '
  'app.worked_minutes — shodu hlídá krok55_scenar.';

revoke all on function public.vydelky_prehled(uuid, uuid, date) from public, anon;
grant execute on function public.vydelky_prehled(uuid, uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 2. public.employee_earnings — řádky bez pobočky jen firemní úrovni
--
-- Starší díra, nalezená při kontrole oddílu 1: employee_earnings
-- (20260831011000_mzdy_vypocet.sql) pouští každý řádek přes
-- app.can_read_scoped(…, e.branch_id), a ten u branch_id NULL nezkoumá
-- rozsah vůbec — stačí payroll.read KDEKOLI. Majitel má zaměstnanecký
-- záznam typicky bez pobočky (app.create_tenant ji nevyplní), takže
-- vedoucí s payroll.read na jedné pobočce viděl v panelu člověka
-- (dochazka/prehled/detail-akce.ts) majitelův měsíc: hodiny i hrubou
-- mzdu.
--
-- Předefinováno z poslední (a jediné) definice v mzdy_vypocet beze
-- změny signatury, sloupců, výpočtu i řazení. Změněná je JEN podmínka
-- práv ve WHERE — tatáž jako ve vydelky_prehled (bod 8 v hlavičce):
-- řádek bez pobočky jen s payroll.read na firemní úrovni, ostatní
-- podle domovské pobočky jako dosud.
--
-- Dopad na aplikaci: žádný viditelný. Zavírá PŘÍMÉ volání RPC
-- s p_branch null pro člověka s pobočkovým payroll.read. Obrazovek se
-- to netýká: panel člověka v živém přehledu filtruje pobočkou (řádek
-- s branch_id NULL tam nevracela ani stará podoba) a Nastavení → Lidé
-- se ptá s firemním právem. Hlídá krok55_scenar, oddíl 9.
-- ---------------------------------------------------------------------

create or replace function public.employee_earnings(
  p_tenant uuid,
  p_mesic  date,
  p_branch uuid default null
)
returns table (
  employee_id       uuid,
  full_name         text,
  branch_id         uuid,
  odpracovano_minut integer,
  vydelano_haleru   integer,
  dnu_bez_dochazky  integer,
  sazba_chybi       boolean,
  hodinova_haleru   integer
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.full_name, e.branch_id,
         v.odpracovano_minut, v.vydelano_haleru, v.dnu_bez_dochazky, v.sazba_chybi,
         app.rate_at(e.id, app.konec_mesice(p_mesic))
  from public.employees e
  cross join lateral app.earnings(e.id, p_mesic) v
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (p_branch is null or e.branch_id = p_branch)
    and case
          when e.branch_id is null
            then app.has_access(p_tenant, 'payroll.read', null)
          else app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
        end
  order by e.full_name;
$$;

comment on function public.employee_earnings(uuid, date, uuid) is
  'Výdělky lidí, na které má volající payroll.read ve svém rozsahu. '
  'Řádky bez pobočky jen s payroll.read na firemní úrovni. '
  'Bez toho práva nevrátí nic.';

revoke all on function public.employee_earnings(uuid, date, uuid) from public, anon;
grant execute on function public.employee_earnings(uuid, date, uuid) to authenticated;
