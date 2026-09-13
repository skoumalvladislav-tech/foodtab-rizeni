-- =====================================================================
-- Foodtab — modul Marketing: fronta publikací
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4 (rozhraní ven).
-- Navazuje na 20260910000000_marketing_vystup.sql.
--
-- ---------------------------------------------------------------------
-- CO TU JE A CO NE
--
-- Tři funkce pro naplánovanou úlohu: vyzvedni, co je na řadě; zapiš,
-- že to odešlo; zapiš, že to selhalo. Volat je smí JEN `service_role`,
-- protože je volá běh bez přihlášeného člověka — stejně jako
-- `public.ohlasit_zapomenute_odchody`.
--
-- Samotné odeslání k poskytovateli tady není a ani být nemůže:
-- databáze ven nevolá. Dělá to `app/api/uloha/marketing-fronta`, ale
-- ROZHODOVÁNÍ, co se smí poslat, zůstává tady.
--
-- ---------------------------------------------------------------------
-- PROČ JSOU TY FUNKCE V `public`, KDYŽ JSOU VNITŘNÍ
--
-- Protože je volá aplikace přes PostgREST, a ten vidí jen `public`
-- (a `graphql_public`). Funkce ve schématu `app` by se z Node zavolat
-- nedaly — dostaly by 404 na neexistující cestu, ne chybu o právech,
-- takže by to vypadalo na překlep v názvu.
--
-- Že jsou v `public`, neznamená, že jsou veřejné: `revoke all … from
-- public, anon, authenticated` plus `grant … to service_role`. Je to
-- stejné jako u `public.ohlasit_zapomenute_odchody`.
--
-- ---------------------------------------------------------------------
-- PROČ SE PLATNOST SCHVÁLENÍ OVĚŘUJE ZNOVU AŽ TADY
--
-- Spoušť `trg_marketing_strez_publikaci` hlídá VZNIK úlohy. Mezi
-- naplánováním a odesláním ale uplyne klidně týden — a za tu dobu se
-- schválení může stát neplatným:
--
--   * příspěvek dostal novou verzi (to sice úlohu ruší spouští, ale
--     spoléhat na jedinou pojistku u věci, která posílá ven jménem
--     firmy, nechceme),
--   * někdo schválení zamítl,
--   * příspěvek přestal na tu verzi ukazovat jako na schválenou.
--
-- Poslední slovo má proto kontrola TĚSNĚ PŘED ODESLÁNÍM, ne ta při
-- plánování. Co neprojde, se nevrátí volajícímu a rovnou se zruší —
-- s důvodem, aby se na obrazovce dalo přečíst, proč to neodešlo.
--
-- ---------------------------------------------------------------------
-- DVA BĚHY NAJEDNOU NESMÍ POSLAT DVAKRÁT
--
-- Vercel umí spustit naplánovanou úlohu podruhé dřív, než první
-- doběhne. Bez zámku by oba běhy přečetly tutéž úlohu a firma by měla
-- na Instagramu dva stejné příspěvky.
--
-- Řeší to `for update skip locked`: kdo řádek nedostane, o něj
-- nezakopne a jde dál. Samotné `for update` by druhý běh na zámku
-- ZASTAVILO — a naplánovaná úloha, která čeká, se utne na časovém
-- limitu.
--
-- Druhá pojistka je v tabulce: `marketing_publikace.uloha_id` je
-- unikátní, takže dva záznamy o jednom odeslání nevzniknou ani kdyby
-- se zámek obešel.
-- =====================================================================


-- ---------------------------------------------------------------------
-- VYZVEDNUTÍ ÚLOH
--
-- Vrátí, co je na řadě, a rovnou si to zabere. Kdo tuhle funkci
-- zavolal, je za odeslání zodpovědný — úlohy jsou od té chvíle
-- `odesila_se` a nikdo jiný je nedostane.
-- ---------------------------------------------------------------------

create or replace function public.marketing_vyzvednout_publikace(p_kolik integer default 20)
returns table (
  id                uuid,
  tenant_id         uuid,
  branch_id         uuid,
  prispevek_id      uuid,
  verze_id          uuid,
  kanal             text,
  format            text,
  poskytovatel      text,
  rezim             text,
  pripojeni_id      uuid,
  ucet_id           uuid,
  idempotencni_klic text,
  pokusy            integer,
  max_pokusu        integer,
  texty             jsonb,
  media_ids         uuid[]
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zabrane uuid[];
begin
  if p_kolik is null or p_kolik < 1 then
    p_kolik := 1;
  end if;

  /*
    Krok 1: zabrat řádky, na které je čas.

    `dalsi_pokus_kdy` drží odklad po neúspěchu. `null` znamená „hned",
    tedy první pokus.
  */
  with na_rade as (
    select u.id
      from public.marketing_publikace_ulohy u
     where u.stav in ('naplanovano', 've_fronte', 'selhalo')
       and u.planovano_na <= now()
       and (u.dalsi_pokus_kdy is null or u.dalsi_pokus_kdy <= now())
     order by u.planovano_na
     limit p_kolik
       for update skip locked
  ), zabrane as (
    update public.marketing_publikace_ulohy u
       set stav = 'odesila_se',
           pokusy = u.pokusy + 1,
           zmeneno_kdy = now()
      from na_rade
     where u.id = na_rade.id
    returning u.id
  )
  /*
    Seznam id se bere Z TOHOTO `update`, ne dodatečným dotazem „co se
    před chvílí změnilo". Takový dotaz by sebral i řádky, které si
    zabral druhý běh — tedy přesně to dvojí odeslání, kvůli kterému
    je tu `skip locked`.
  */
  select array_agg(zabrane.id) into v_zabrane from zabrane;

  if v_zabrane is null then
    return;
  end if;

  /*
    Krok 2: z nich zrušit ty, které mezitím přestaly být kryté
    schválením. Viz hlavička — poslední slovo má kontrola těsně před
    odesláním.
  */
  update public.marketing_publikace_ulohy u
     set stav = 'zruseno',
         posledni_chyba = 'Zrušeno před odesláním: schválení už neplatí pro tenhle obsah.',
         zmeneno_kdy = now()
   where u.id = any(v_zabrane)
     and not exists (
       select 1
         from public.marketing_schvaleni s
         join public.marketing_verze v on v.id = u.verze_id
         join public.marketing_prispevky p on p.id = u.prispevek_id
        where s.id = u.schvaleni_id
          and s.tenant_id = u.tenant_id
          and s.stav = 'schvaleno'
          and s.prispevek_id = u.prispevek_id
          and s.verze_id = u.verze_id
          and s.otisk_verze = v.otisk
          and u.otisk_verze = v.otisk
          and p.schvalena_verze_id = u.verze_id);

  /*
    Krok 2b: zrušit i to, čemu mezitím vypršela práva k fotce.

    `marketing_media.pouzitelne_do` je datum, do kdy se smí fotka
    použít — typicky svolení hosta nebo licence od fotografa. Příspěvek
    se schvaluje týden dopředu, takže tohle je přesně případ, kdy
    kontrola při schvalování nestačí. Zveřejnit tvář hosta den po
    vypršení souhlasu je právní problém, ne kosmetická chyba.

    Provozní datum, ne `current_date`: den se láme podle pobočky
    (CLAUDE.md, pravidlo 10). Fotka použitelná „do 10. 9." patří ještě
    do provozního dne 10. 9., i když je na hodinách 1:30 jedenáctého.
  */
  update public.marketing_publikace_ulohy u
     set stav = 'zruseno',
         posledni_chyba = 'Zrušeno před odesláním: fotce vypršela práva k použití.',
         zmeneno_kdy = now()
   where u.id = any(v_zabrane)
     and u.stav = 'odesila_se'
     and exists (
       select 1
         from public.marketing_verze v
         join public.marketing_prispevky p on p.id = u.prispevek_id
         join public.marketing_media m on m.id = any(v.media_ids)
        where v.id = u.verze_id
          and m.pouzitelne_do is not null
          and m.pouzitelne_do < app.business_date(p.branch_id, now()));

  -- Krok 3: co zbylo, jde ven. Text a fotky se berou z verze, ne
  -- z příspěvku — příspěvek ukazuje na aktuální verzi, a ta už může
  -- být jiná než ta schválená.
  update public.marketing_prispevky p
     set stav = 'zverejnuje_se', zmeneno_kdy = now()
   where p.id in (select u.prispevek_id from public.marketing_publikace_ulohy u
                   where u.id = any(v_zabrane) and u.stav = 'odesila_se')
     and p.stav not in ('zverejneno', 'archivovano');

  return query
    select u.id, u.tenant_id, p.branch_id, u.prispevek_id, u.verze_id,
           u.kanal, u.format, u.poskytovatel, u.rezim,
           u.pripojeni_id, u.ucet_id, u.idempotencni_klic,
           u.pokusy, u.max_pokusu,
           v.texty, v.media_ids
      from public.marketing_publikace_ulohy u
      join public.marketing_prispevky p on p.id = u.prispevek_id
      join public.marketing_verze v on v.id = u.verze_id
     where u.id = any(v_zabrane)
       and u.stav = 'odesila_se'
     order by u.planovano_na;
end $$;

comment on function public.marketing_vyzvednout_publikace(integer) is
  'Vyzvedne a zabere publikační úlohy, na které je čas. Znovu ověří '
  'platnost schválení — mezi naplánováním a odesláním uplyne i týden. '
  'Volá jen naplánovaná úloha pod service_role.';

revoke all on function public.marketing_vyzvednout_publikace(integer)
  from public, anon, authenticated;
grant execute on function public.marketing_vyzvednout_publikace(integer) to service_role;


-- ---------------------------------------------------------------------
-- ODESLÁNO
--
-- Idempotentní: druhé volání pro tutéž úlohu nezaloží druhý záznam.
-- Fronta se opakuje, ale příspěvek na Instagramu je jen jeden.
-- ---------------------------------------------------------------------

create or replace function public.marketing_publikace_hotova(
  p_uloha      uuid,
  p_externi_id text,
  p_odkaz      text,
  p_odpoved    jsonb default null,
  p_nanecisto  boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uloha  public.marketing_publikace_ulohy;
  v_branch uuid;
  v_id     uuid;
begin
  select * into v_uloha
    from public.marketing_publikace_ulohy where id = p_uloha;

  if v_uloha.id is null then
    raise exception 'Publikační úloha neexistuje.' using errcode = 'no_data_found';
  end if;

  select p.branch_id into v_branch
    from public.marketing_prispevky p where p.id = v_uloha.prispevek_id;

  insert into public.marketing_publikace
    (tenant_id, branch_id, prispevek_id, verze_id, uloha_id, ucet_id,
     kanal, format, externi_id, trvaly_odkaz, je_nanecisto, odpoved)
  values
    (v_uloha.tenant_id, v_branch, v_uloha.prispevek_id, v_uloha.verze_id,
     v_uloha.id, v_uloha.ucet_id, v_uloha.kanal, v_uloha.format,
     p_externi_id, p_odkaz, p_nanecisto, p_odpoved)
  -- Tady je ta idempotence. `uloha_id` je unikátní, takže opakovaný
  -- běh narazí na tentýž řádek a vrátí jeho id, ne nové.
  on conflict (uloha_id) do nothing
  returning id into v_id;

  if v_id is null then
    select mp.id into v_id
      from public.marketing_publikace mp where mp.uloha_id = p_uloha;
  end if;

  update public.marketing_publikace_ulohy
     set stav = case when p_nanecisto then 'zverejneno_nanecisto' else 'zverejneno' end,
         externi_id = p_externi_id,
         odpoved = p_odpoved,
         posledni_chyba = null,
         zverejneno_kdy = coalesce(zverejneno_kdy, now()),
         zmeneno_kdy = now()
   where id = p_uloha;

  /*
    Příspěvek je „zveřejněný", až když nezbývá nic rozdělaného. Jeden
    příspěvek jde na Instagram i na Facebook zvlášť — kdyby se stav
    přepnul po prvním, druhý kanál by na obrazovce vypadal jako hotový,
    i kdyby ještě neodešel.
  */
  update public.marketing_prispevky p
     set stav = 'zverejneno', zmeneno_kdy = now()
   where p.id = v_uloha.prispevek_id
     and not exists (
       select 1 from public.marketing_publikace_ulohy u
        where u.prispevek_id = p.id
          and u.stav in ('naplanovano', 've_fronte', 'odesila_se', 'selhalo'));

  return v_id;
end $$;

comment on function public.marketing_publikace_hotova(uuid, text, text, jsonb, boolean) is
  'Zapíše, že úloha odešla. Idempotentní přes unikátní uloha_id — '
  'opakovaný běh fronty nesmí založit druhý příspěvek.';

revoke all on function public.marketing_publikace_hotova(uuid, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.marketing_publikace_hotova(uuid, text, text, jsonb, boolean)
  to service_role;


-- ---------------------------------------------------------------------
-- K RUKÁM ČLOVĚKA
--
-- Ruční režim znamená, že se nikam nic neposílá — příspěvek je hotový
-- a zveřejní ho někdo sám. Není to úspěch (nic neodešlo) ani neúspěch
-- (nic se nepokazilo), a proto to má vlastní stav.
--
-- Kdyby to spadlo pod „selhalo", tlouklo by se to do fronty pořád
-- dokola a v přehledu by to vypadalo jako porucha, kterou někdo půjde
-- opravovat.
-- ---------------------------------------------------------------------

create or replace function public.marketing_publikace_k_rukam(
  p_uloha uuid,
  p_duvod text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.marketing_publikace_ulohy
     set stav = 'k_rucnimu_zverejneni',
         posledni_chyba = p_duvod,
         -- Odklad se maže: fronta se k téhle úloze už nemá vracet.
         dalsi_pokus_kdy = null,
         zmeneno_kdy = now()
   where id = p_uloha;

  if not found then
    raise exception 'Publikační úloha neexistuje.' using errcode = 'no_data_found';
  end if;
end $$;

comment on function public.marketing_publikace_k_rukam(uuid, text) is
  'Odloží úlohu k ručnímu zveřejnění. Není to úspěch ani neúspěch — '
  'proto vlastní stav a zrušený odklad, ať se fronta nevrací.';

revoke all on function public.marketing_publikace_k_rukam(uuid, text)
  from public, anon, authenticated;
grant execute on function public.marketing_publikace_k_rukam(uuid, text) to service_role;


-- ---------------------------------------------------------------------
-- SELHALO
--
-- Odklad roste, aby se u vypadlého poskytovatele netlouklo do zdi
-- každou minutu. Po vyčerpání pokusů se to vzdá — a příspěvek to řekne
-- nahlas, protože jinak by čekání na publikaci vypadalo stejně jako
-- publikace, která se nikdy nestane.
-- ---------------------------------------------------------------------

create or replace function public.marketing_publikace_selhala(
  p_uloha uuid,
  p_chyba text
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uloha public.marketing_publikace_ulohy;
  v_stav  text;
begin
  select * into v_uloha
    from public.marketing_publikace_ulohy where id = p_uloha;

  if v_uloha.id is null then
    raise exception 'Publikační úloha neexistuje.' using errcode = 'no_data_found';
  end if;

  -- `pokusy` už zvedlo vyzvednutí, takže se tu jen porovnává.
  v_stav := case when v_uloha.pokusy >= v_uloha.max_pokusu then 'vzdano' else 'selhalo' end;

  update public.marketing_publikace_ulohy
     set stav = v_stav,
         posledni_chyba = p_chyba,
         -- 5, 15, 45, 135 minut. U vzdané úlohy nemá odklad smysl.
         dalsi_pokus_kdy = case
           when v_stav = 'selhalo'
             then now() + (interval '5 minutes' * power(3, greatest(v_uloha.pokusy - 1, 0)))
           else null
         end,
         zmeneno_kdy = now()
   where id = p_uloha;

  if v_stav = 'vzdano' then
    update public.marketing_prispevky
       set stav = 'publikace_selhala', zmeneno_kdy = now()
     where id = v_uloha.prispevek_id
       and stav not in ('zverejneno', 'archivovano');
  end if;

  return v_stav;
end $$;

comment on function public.marketing_publikace_selhala(uuid, text) is
  'Zapíše neúspěch a odloží další pokus (5, 15, 45, 135 minut). Po '
  'vyčerpání pokusů vrací "vzdano" a příspěvek to řekne nahlas.';

revoke all on function public.marketing_publikace_selhala(uuid, text)
  from public, anon, authenticated;
grant execute on function public.marketing_publikace_selhala(uuid, text) to service_role;
