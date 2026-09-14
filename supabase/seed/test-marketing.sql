-- =====================================================================
-- Foodtab — ukázková data pro modul Marketing
--
-- Zadání: master prompt, oddíl 24 („Seed data a ukázková cesta").
--
-- ---------------------------------------------------------------------
-- TOHLE SE V OSTRÉM PROVOZU NIKDY NEPOUŠTÍ
--
-- Je to ukázková cesta pro někoho, kdo modul vidí poprvé: značka,
-- menu, příspěvek, schválení a zkouška nanečisto. Nic z toho nejsou
-- data zákazníka.
--
-- CLAUDE.md, pravidlo 1: „Ukázková data patří nanejvýš do seed skriptu
-- pro testovací prostředí." Proto sem, a ne do migrace.
--
-- ---------------------------------------------------------------------
-- PUSTÍ SE VÍCKRÁT A NIC NEZDVOJÍ
--
-- Seed se spouští opakovaně — po každém přestavění testovací databáze.
-- Každý insert proto kontroluje, jestli už tam ten řádek není.
-- `on conflict do nothing` by nestačilo: většina těch tabulek nemá
-- jedinečný index na to, podle čeho se to pozná (název).
--
-- ---------------------------------------------------------------------
-- NIC SE NEZVEŘEJNÍ, ANI NANEČISTO
--
-- Ukázkový příspěvek se zastaví u SCHVÁLENÉ VERZE. Publikační úloha
-- se nezakládá — ani v demo režimu.
--
-- Důvod: seed se pouští proti testovací databázi, která sdílí n8n
-- s ostrou. Kdyby vznikla úloha, vyzvedla by si ji fronta a zkusila
-- něco poslat. „Je to jen demo" není pojistka, to je shoda okolností.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_tenant   uuid;
  v_perla    uuid;
  v_provozni uuid;
  v_majitel  uuid;
  v_menu     uuid;
  v_prispevek uuid;
  v_verze    uuid;
  v_zadost   uuid;
  v_kampan   uuid;
  v_zalozeno int := 0;
begin
  select t.id into v_tenant from public.tenants t order by t.created_at limit 1;
  if v_tenant is null then
    raise notice '  Seed marketingu: žádná firma, nic se nezakládá.';
    return;
  end if;

  select b.id into v_perla from public.branches b
   where b.tenant_id = v_tenant and b.slug = 'cerna-perla';
  if v_perla is null then
    select b.id into v_perla from public.branches b where b.tenant_id = v_tenant limit 1;
  end if;
  if v_perla is null then
    raise notice '  Seed marketingu: firma nemá pobočku, nic se nezakládá.';
    return;
  end if;

  select e.id into v_provozni from public.employees e
    join public.profiles p on p.user_id = e.user_id
   where e.tenant_id = v_tenant and p.email = 'provozni@foodtab.cz' and e.deleted_at is null;

  select e.id into v_majitel from public.employees e
    join public.profiles p on p.user_id = e.user_id
   where e.tenant_id = v_tenant and p.email = 'majitel@foodtab.cz' and e.deleted_at is null;

  -- Modul musí být zapnutý, jinak by se k ničemu z toho nedalo dostat.
  insert into public.tenant_modules (tenant_id, module_key)
  values (v_tenant, 'marketing')
  on conflict do nothing;

  /* --- ZNAČKA -------------------------------------------------------
     Bez ní obrazovka Marketing vyzývá „nejdřív značka" — a ukázková
     cesta by začínala výtkou.                                        */

  if not exists (select 1 from public.marketing_nastaveni
                  where tenant_id = v_tenant and branch_id = v_perla) then
    insert into public.marketing_nastaveni
      (tenant_id, branch_id, ton_hlasu, podpis, kontakt, vyrazy_ano, vyrazy_ne)
    values (v_tenant, v_perla,
            'neformalni',
            'Černá Perla — kuchyně po našem',
            'cernaperla.cz · 555 123 456',
            array['poctivé', 'domácí', 'od nás'],
            array['unikátní', 'jedinečný', 'luxusní']);
    v_zalozeno := v_zalozeno + 1;
  end if;

  /* --- MENU ---------------------------------------------------------
     Potvrzené, aby se dalo použít automatizací. Ceny v haléřích
     (CLAUDE.md, Konvence).                                           */

  select m.id into v_menu from public.marketing_menu m
   where m.tenant_id = v_tenant and m.nazev = 'Ukázkové denní menu';

  if v_menu is null then
    insert into public.marketing_menu
      (tenant_id, branch_id, druh, nazev, plati_od, stav, zdroj, vytvoril, potvrdil, potvrzeno_kdy)
    values (v_tenant, v_perla, 'denni', 'Ukázkové denní menu',
            current_date, 'potvrzeno', 'rucne', v_provozni, v_majitel, now())
    returning id into v_menu;

    insert into public.marketing_menu_polozky
      (tenant_id, menu_id, kategorie, nazev, cena_haleru, alergeny)
    values
      (v_tenant, v_menu, 'polevka', 'Hovězí vývar s játrovými knedlíčky', 4500, array['1','3','9']),
      (v_tenant, v_menu, 'hlavni',  'Svíčková na smetaně s houskovým knedlíkem', 18900, array['1','3','7']),
      (v_tenant, v_menu, 'hlavni',  'Smažený sýr s vařeným bramborem', 15900, array['1','3','7']),
      (v_tenant, v_menu, 'dezert',  'Jablečný závin se šlehačkou', 6900, array['1','3','7']);

    v_zalozeno := v_zalozeno + 1;
  end if;

  /* --- KAMPAŇ A PŘÍSPĚVEK ------------------------------------------ */

  select k.id into v_kampan from public.marketing_kampane k
   where tenant_id = v_tenant and nazev = 'Ukázková zabijačka';

  if v_kampan is null then
    insert into public.marketing_kampane
      (tenant_id, branch_id, nazev, cil, kona_se_kdy, pilir, zalozil)
    values (v_tenant, v_perla, 'Ukázková zabijačka',
            'Naplnit sobotní oběd', now() + interval '10 days', 'akce', v_provozni)
    returning id into v_kampan;
    v_zalozeno := v_zalozeno + 1;
  end if;

  select p.id into v_prispevek from public.marketing_prispevky p
   where p.tenant_id = v_tenant and p.nazev = 'Ukázka — dnešní menu';

  if v_prispevek is null then
    insert into public.marketing_prispevky
      (tenant_id, branch_id, nazev, pilir, kanaly, vytvoril)
    values (v_tenant, v_perla, 'Ukázka — dnešní menu', 'menu',
            array['instagram', 'facebook'], v_provozni)
    returning id into v_prispevek;

    /*
      TEXT JE NAPSANÝ RUČNĚ, NE OD MODELU.

      Seed nemá volat AI: běží i tam, kde klíč není, a hlavně by se
      ukázková data pokaždé lišila. Text je proto obyčejný a je na něm
      vidět, jak takový příspěvek vypadá.
    */
    insert into public.marketing_verze
      (tenant_id, prispevek_id, cislo, zadani, vstupy, texty, media_ids, otisk, poznamka, vytvoril)
    values (v_tenant, v_prispevek, 1,
            'Dnešní menu — co vaříme a proč se na to těšíme.',
            jsonb_build_object('menu_id', v_menu),
            jsonb_build_object(
              'instagram', jsonb_build_object('popisek',
                E'Dneska u nás voní svíčková. Vývar s játrovými knedlíčky, '
                'svíčková na smetaně a jablečný závin — poctivě, jak to umíme.\n\n'
                '#cernaperla #dennimenu #svickova'),
              'facebook', jsonb_build_object('popisek',
                E'Dnešní menu: hovězí vývar s játrovými knedlíčky, svíčková na '
                'smetaně s houskovým knedlíkem, smažený sýr a jablečný závin '
                'se šlehačkou. Vaříme do vyprodání.')),
            array[]::uuid[],
            'ukazka-otisk-1',
            'Ukázková data',
            v_provozni)
    returning id into v_verze;

    update public.marketing_prispevky
       set aktualni_verze_id = v_verze, stav = 'navrh_hotovy'
     where id = v_prispevek;

    /* --- SCHVÁLENÍ --------------------------------------------------
       Žádá provozní, schvaluje majitel: o vlastní žádosti se
       nerozhoduje (pravidlo čtyř očí).                              */

    insert into public.marketing_schvaleni
      (tenant_id, prispevek_id, verze_id, otisk_verze, zadal, shrnuti)
    values (v_tenant, v_prispevek, v_verze, 'ukazka-otisk-1', v_provozni,
            'Ukázková žádost — takhle vypadá fronta ke schválení.')
    returning id into v_zadost;

    /*
      SCHVÁLENÍ SE TU NECHÁ ČEKAT.

      Aby bylo na obrazovce Ke schválení co ukázat. Kdyby se rovnou
      odklepla, byla by fronta prázdná a ukázková cesta by přeskočila
      to nejdůležitější, co modul dělá.
    */

    v_zalozeno := v_zalozeno + 1;
  end if;

  /* --- MĚŘITELNÝ ODKAZ ---------------------------------------------- */

  if not exists (select 1 from public.marketing_odkazy where klic = 'ukazka01') then
    insert into public.marketing_odkazy
      (tenant_id, branch_id, kampan_id, klic, cil, popis,
       utm_source, utm_medium, utm_campaign, vytvoril)
    values (v_tenant, v_perla, v_kampan, 'ukazka01',
            'https://example.com/rezervace', 'Ukázkový odkaz na rezervaci',
            'instagram', 'social', 'ukazkova-zabijacka', v_provozni);
    v_zalozeno := v_zalozeno + 1;
  end if;

  raise notice '  Seed marketingu: % nových kusů (značka, menu, kampaň, příspěvek, odkaz).', v_zalozeno;
end $$;
