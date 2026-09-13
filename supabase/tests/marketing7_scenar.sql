-- Scénář marketing 7 — fronta publikací.
--
-- Pokrývá 20260910040000_marketing_fronta.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Marketing 5 dokázal, že publikační úloha bez platného schválení
-- NEVZNIKNE. Tenhle scénář dokazuje to druhé, co je stejně důležité
-- a co se dřív nedalo: **úloha, která mezitím přestala být krytá
-- schválením, se NEODEŠLE.**
--
-- Mezi naplánováním a odesláním uplyne i týden. Kontrola při vzniku
-- o tom týdnu neví nic.
--
-- Druhá věc je dvojí odeslání. Firma s dvěma stejnými příspěvky na
-- Instagramu je viditelná chyba, kterou nejde vzít zpátky — a vzniká
-- tak, že se naplánovaná úloha spustí podruhé dřív, než první doběhne.
--
-- ---------------------------------------------------------------------
-- NEZÁVISÍ NA KALENDÁŘI
--
-- Všechny časy jsou posuny od `now()`, ne pevná data. Scénář platí
-- stejně ve 23:50 jako v poledne (past ze skillu `scenar`, oddíl 5).
-- Kde se posouvá „do minulosti" nebo „do budoucnosti", je to o hodiny,
-- ne o minuty — pár vteřin běhu scénáře to nesmí přehodit.
--
-- ---------------------------------------------------------------------
-- POUČENÍ Z ROZBÍJENÍ
--
-- Devět záměrných sabotáží migrace, každá spadla na pojmenované
-- kontrole. Dvě věci z toho stojí za zapsání:
--
--   * PRVNÍ KOLO SABOTÁŽÍ NEDOKÁZALO NIC. Pouštěl jsem scénář
--     samostatně (`scenare-pglite.mjs marketing7_scenar`) a on padal
--     hned na prvním `\gset` — firma z etapy 0 v té databázi nebyla.
--     Devět různých sabotáží tedy vyrobilo devětkrát TUTÉŽ chybu, která
--     s nimi neměla nic společného, a vypadalo to jako důkaz. Scénář
--     nemá vlastní data schválně, ale ověřovat se musí aspoň proti
--     `etapa0_scenar marketing7_scenar`.
--   * DVĚ SABOTÁŽE PADAJÍ NA TÉŽE KONTROLE („úloha se zamítnutým
--     schválením se nevyzvedne"): vyndání kontroly platnosti i vyndání
--     filtru na `odesila_se` z návratu. Je to dvojitá pojistka — zrušit
--     a nevrátit — a ta kontrola měří obě. Píšu to sem, aby si nikdo
--     nemyslel, že měří jen jednu.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

select set_config('test.tenant', :'tenant', false);
select set_config('test.majitel', :'majitel', false);


-- ---------------------------------------------------------------------
-- Pomocník: schválený příspěvek s jednou naplánovanou úlohou.
--
-- Skládá se to na čtyři kroky pokaždé stejně, takže je to ve funkci —
-- jinak by scénář byl z devíti desetin příprava a chyba v ní by se
-- schovala mezi kontroly.
-- ---------------------------------------------------------------------

create or replace function pg_temp.pripravit(
  p_nazev text,
  p_kanal text,
  p_klic  text,
  p_kdy   timestamptz,
  -- Fotky se dávají rovnou při zakládání verze. Doplnit je později
  -- nejde: verze je neměnná (spoušť 1 z marketing 3).
  p_media uuid[] default array[]::uuid[]
) returns table (prispevek uuid, verze uuid, schvaleni uuid, uloha uuid)
language plpgsql as $$
declare
  v_tenant uuid := current_setting('test.tenant')::uuid;
  v_perla  uuid := (select id from public.branches where slug = 'cerna-perla');
  v_otisk  text := 'otisk-' || p_klic;
begin
  insert into public.marketing_prispevky (tenant_id, branch_id, nazev)
  values (v_tenant, v_perla, p_nazev) returning id into prispevek;

  insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, texty, media_ids)
  values (v_tenant, prispevek, 1, v_otisk,
          jsonb_build_object(p_kanal, jsonb_build_object('popisek', 'Dnes vaříme.')),
          coalesce(p_media, array[]::uuid[]))
  returning id into verze;

  insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze)
  values (v_tenant, prispevek, verze, v_otisk) returning id into schvaleni;

  -- Přes `authenticated`, aby rozhodnutí zapsala spoušť — ta zároveň
  -- nastaví `schvalena_verze_id` na příspěvku.
  set local role authenticated;
  perform set_config('test.user_id', current_setting('test.majitel'), true);
  update public.marketing_schvaleni set stav = 'schvaleno' where id = schvaleni;
  reset role;

  insert into public.marketing_publikace_ulohy
    (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
     kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
  values (v_tenant, prispevek, verze, v_otisk, schvaleni,
          p_kanal, 'prispevek', 'mock', 'demo', p_kdy, p_klic)
  returning id into uloha;

  return next;
end $$;


\echo ''
\echo '== Funkce fronty patří jen naplánované úloze ================='

/*
  Kdyby je směl volat `authenticated`, obešel by kdokoli s přihlášením
  celé schvalování: vyzvednutí přepne úlohu do `odesila_se` a zápis
  „hotovo" pak založí publikaci. Grant je tu jediná pojistka — uvnitř
  `security definer` se RLS neuplatní.
*/

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_vyzvednout_publikace(10);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přihlášený uživatel si vyzvedl úlohy fronty'; end if;
  raise notice '  OK    vyzvednutí úloh nesmí volat ani majitel';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_publikace_hotova(
      '00000000-0000-0000-0000-000000000000'::uuid, 'x', 'y');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přihlášený uživatel zapsal zveřejnění'; end if;
  raise notice '  OK    zápis zveřejnění nesmí volat ani majitel';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.marketing_publikace_selhala(
      '00000000-0000-0000-0000-000000000000'::uuid, 'x');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přihlášený uživatel zapsal neúspěch'; end if;
  raise notice '  OK    zápis neúspěchu nesmí volat ani majitel';
end $$;

reset role;


\echo ''
\echo '== Vyzvedne se jen to, na co je čas ========================='

select prispevek as p_ted, verze as v_ted, uloha as u_ted
  from pg_temp.pripravit('Dnešní menu', 'instagram', 'ted', now() - interval '1 hour') \gset

select uloha as u_zitra
  from pg_temp.pripravit('Zítřejší menu', 'instagram', 'zitra', now() + interval '26 hours') \gset

select set_config('test.u_ted', :'u_ted', false);
select set_config('test.u_zitra', :'u_zitra', false);
select set_config('test.p_ted', :'p_ted', false);
select set_config('test.v_ted', :'v_ted', false);

create temporary table vyzvednuto as
  select * from app.marketing_vyzvednout_publikace(10);

select pg_temp.check('vyzvedla se úloha, které nastal čas',
  exists (select 1 from vyzvednuto where id = :'u_ted'));

select pg_temp.check('úloha naplánovaná na zítra se nevyzvedla',
  not exists (select 1 from vyzvednuto where id = :'u_zitra'));

select pg_temp.check('vyzvednutá úloha je ve stavu odesila_se',
  (select stav from public.marketing_publikace_ulohy where id = :'u_ted') = 'odesila_se');

select pg_temp.check('a má započítaný první pokus',
  (select pokusy from public.marketing_publikace_ulohy where id = :'u_ted') = 1);

select pg_temp.check('příspěvek se přepnul na zverejnuje_se',
  (select stav from public.marketing_prispevky where id = :'p_ted') = 'zverejnuje_se');

-- Text jde s úlohou, aby si ho odesílající nemusel dohledávat přes
-- příspěvek — ten už může ukazovat na jinou, neschválenou verzi.
select pg_temp.check('s úlohou přišel i text schválené verze',
  (select texty -> 'instagram' ->> 'popisek' from vyzvednuto where id = :'u_ted')
    = 'Dnes vaříme.');

select pg_temp.check('a pobočka příspěvku',
  (select branch_id from vyzvednuto where id = :'u_ted') = :'perla');


\echo ''
\echo '== DRUHÝ BĚH TUTÉŽ ÚLOHU NEDOSTANE =========================='

/*
  Tohle je kontrola, kvůli které scénář existuje. Vercel umí spustit
  naplánovanou úlohu podruhé dřív, než první doběhne — bez zabrání by
  oba běhy dostaly tentýž řádek a firma by měla na Instagramu dva
  stejné příspěvky.

  Sekvenčně se to dá ověřit poctivě: první běh úlohu přepnul na
  `odesila_se`, druhý ji tedy vůbec nesmí vidět. Souběh dvou spojení
  hlídá navíc `skip locked`, na to tenhle scénář nedosáhne — hlídá
  aspoň to, že se zabraná úloha nevrací.
*/

select pg_temp.check('druhé vyzvednutí tutéž úlohu nevrátí',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_ted'));


\echo ''
\echo '== Zveřejnění se zapíše, a jen jednou ======================='

select app.marketing_publikace_hotova(:'u_ted', 'ig-999', 'https://instagram.com/p/999',
                                      '{"ok":true}'::jsonb, false) as pub1 \gset

select pg_temp.check('vznikl záznam o zveřejnění',
  (select count(*) from public.marketing_publikace where uloha_id = :'u_ted') = 1);

select pg_temp.check('úloha je zveřejněná',
  (select stav from public.marketing_publikace_ulohy where id = :'u_ted') = 'zverejneno');

select pg_temp.check('a příspěvek taky',
  (select stav from public.marketing_prispevky where id = :'p_ted') = 'zverejneno');

-- Opakovaný běh fronty. Bez `on conflict` by tady vznikl druhý řádek
-- a v číslech by to vypadalo na dva zveřejněné příspěvky.
select app.marketing_publikace_hotova(:'u_ted', 'ig-999', 'https://instagram.com/p/999',
                                      '{"ok":true}'::jsonb, false) as pub2 \gset

select pg_temp.check('druhé volání nezaložilo druhý záznam',
  (select count(*) from public.marketing_publikace where uloha_id = :'u_ted') = 1);

select pg_temp.check('a vrátilo tentýž záznam, ne nový', :'pub1' = :'pub2');


\echo ''
\echo '== Demo se nedá splést se skutečností ======================='

select uloha as u_demo, prispevek as p_demo
  from pg_temp.pripravit('Zkouška nanečisto', 'facebook', 'demo1', now() - interval '1 hour') \gset

do $$ begin perform app.marketing_vyzvednout_publikace(10); end $$;
select app.marketing_publikace_hotova(:'u_demo', 'demo-1', null, null, true);

select pg_temp.check('demo publikace je označená jako nanečisto',
  (select je_nanecisto from public.marketing_publikace where uloha_id = :'u_demo'));

select pg_temp.check('a úloha má vlastní stav, ne "zverejneno"',
  (select stav from public.marketing_publikace_ulohy where id = :'u_demo')
    = 'zverejneno_nanecisto');


\echo ''
\echo '== ZRUŠENÉ SCHVÁLENÍ ÚLOHU ZASTAVÍ TĚSNĚ PŘED ODESLÁNÍM ====='

/*
  Nejdůležitější kontrola scénáře.

  Úloha vznikla platně — spoušť z marketing 5 ji pustila. Teprve POTOM
  se schválení stalo neplatným. Kdyby fronta věřila tomu, že „při
  vzniku to bylo v pořádku", odešlo by ven něco, co v tu chvíli nikdo
  neschvaluje.

  Schválení se ruší zamítnutím, ne novou verzí. Nová verze úlohu ruší
  už spouští z marketing 5 — a kdyby se použila, kontrola by procházela
  díky JINÉ pojistce, než kterou má měřit.
*/

select uloha as u_zrus, schvaleni as s_zrus, prispevek as p_zrus, verze as v_zrus
  from pg_temp.pripravit('Zrušená akce', 'instagram', 'zrus', now() - interval '1 hour') \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni
   set stav = 'zamitnuto', pripominka = 'Akce se ruší, nezveřejňujte to.'
 where id = :'s_zrus';
reset role;

/*
  IZOLACE, stejně jako v marketing 5.

  Zamítnutí spouští vynuluje `schvalena_verze_id`, takže by úlohu
  zastavila podmínka o ukazateli a podmínka na STAV schválení by se
  nikdy nespustila — vyndání stavu z funkce by pak tuhle kontrolu
  neshodilo. Ukazatel proto vracíme zpátky, jako by ho někdo přepsal
  mimo schvalovací cestu. Samotný ukazatel má vlastní kontrolu níž.
*/
update public.marketing_prispevky
   set schvalena_verze_id = :'v_zrus' where id = :'p_zrus';

select pg_temp.check('úloha se zamítnutým schválením se nevyzvedne',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_zrus'));

select pg_temp.check('a rovnou se zrušila',
  (select stav from public.marketing_publikace_ulohy where id = :'u_zrus') = 'zruseno');

select pg_temp.check('s důvodem, který se dá přečíst na obrazovce',
  (select posledni_chyba from public.marketing_publikace_ulohy where id = :'u_zrus')
    like '%schválení už neplatí%');


\echo ''
\echo '== Přepsaný ukazatel na schválenou verzi taky zastaví ======='

-- Druhá cesta k témuž: schválení je platné, ale příspěvek na tu verzi
-- už neukazuje. Je to ta nejtišší varianta — v tabulce schválení
-- vypadá všechno v pořádku.

select uloha as u_ukaz, prispevek as p_ukaz
  from pg_temp.pripravit('Přepsaný ukazatel', 'instagram', 'ukaz', now() - interval '1 hour') \gset

update public.marketing_prispevky set schvalena_verze_id = null where id = :'p_ukaz';

select pg_temp.check('úloha bez ukazatele na schválenou verzi se nevyzvedne',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_ukaz'));

select pg_temp.check('a je zrušená',
  (select stav from public.marketing_publikace_ulohy where id = :'u_ukaz') = 'zruseno');


\echo ''
\echo '== Fotce vypršela práva — ven to nejde ======================'

/*
  `marketing_media.pouzitelne_do` je datum, do kdy se smí fotka použít:
  svolení hosta, licence od fotografa. Příspěvek se schvaluje týden
  dopředu, takže kontrola při schvalování o vypršení neví nic.

  Zveřejnit tvář hosta den po vypršení souhlasu je právní problém, ne
  kosmetická chyba — proto se to hlídá až tady, těsně před odesláním.
*/

/*
  DATA SE POČÍTAJÍ Z PROVOZNÍHO DNE, NE Z `current_date`.

  Provozní den začíná v 05:00, takže se s kalendářním každý den pět
  hodin rozchází (CLAUDE.md, oddíl Testy). „Včera" psané jako
  `current_date - 1` by mezi půlnocí a pátou vyšlo na TÝŽ provozní den
  a kontrola by od 00:00 do 05:00 padala na kódu, na kterém nic není.
*/
select app.business_date(:'perla', now()) as dnes \gset

insert into public.marketing_media
  (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu,
   otisk, pouzitelne_do)
values (:'tenant', :'perla', 'foto', 'host.jpg', 'marketing/host.jpg',
        'image/jpeg', 120000, 'otisk-host', :'dnes'::date - 1)
returning id as m_stara \gset

insert into public.marketing_media
  (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu,
   otisk, pouzitelne_do)
values (:'tenant', :'perla', 'foto', 'dnes.jpg', 'marketing/dnes.jpg',
        'image/jpeg', 120000, 'otisk-dnes', :'dnes'::date)
returning id as m_dnes \gset

insert into public.marketing_media
  (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
values (:'tenant', :'perla', 'foto', 'talir.jpg', 'marketing/talir.jpg',
        'image/jpeg', 120000, 'otisk-talir')
returning id as m_bez_omezeni \gset

-- Příspěvek s fotkou BEZ omezení projde. Kdyby se kontrola napsala
-- obráceně (zruš, když má fotku), spadne tahle.
select uloha as u_foto_ok
  from pg_temp.pripravit('S fotkou', 'instagram', 'foto-ok',
                         now() - interval '1 hour', array[:'m_bez_omezeni'::uuid]) \gset

select pg_temp.check('fotka bez omezení odeslání nebrání',
  exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_foto_ok'));

-- Poslední den platnosti JEŠTĚ platí. Tady se pozná chyba o jedničku,
-- kvůli které by se den předem přestalo publikovat.
select uloha as u_foto_dnes
  from pg_temp.pripravit('Poslední den', 'instagram', 'foto-dnes',
                         now() - interval '1 hour', array[:'m_dnes'::uuid]) \gset

select pg_temp.check('fotka platná do dneška ještě projde',
  exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_foto_dnes'));

select uloha as u_foto_stara
  from pg_temp.pripravit('S prošlou fotkou', 'instagram', 'foto-stara',
                         now() - interval '1 hour', array[:'m_stara'::uuid]) \gset

select pg_temp.check('úloha s prošlou fotkou se nevyzvedne',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_foto_stara'));

select pg_temp.check('a je zrušená s důvodem o právech',
  (select posledni_chyba from public.marketing_publikace_ulohy where id = :'u_foto_stara')
    like '%práva k použití%');


\echo ''
\echo '== Neúspěch: odklad roste, pak se to vzdá ==================='

select uloha as u_chyba, prispevek as p_chyba
  from pg_temp.pripravit('Padá to', 'instagram', 'chyba', now() - interval '1 hour') \gset

update public.marketing_publikace_ulohy set max_pokusu = 2 where id = :'u_chyba';

do $$ begin perform app.marketing_vyzvednout_publikace(10); end $$;
select app.marketing_publikace_selhala(:'u_chyba', 'Meta vrátila 500.') as stav1 \gset

select pg_temp.check('po prvním neúspěchu je stav selhalo', :'stav1' = 'selhalo');

select pg_temp.check('a je nastavený odklad do budoucna',
  (select dalsi_pokus_kdy > now() from public.marketing_publikace_ulohy where id = :'u_chyba'));

select pg_temp.check('hláška od poskytovatele se uložila',
  (select posledni_chyba from public.marketing_publikace_ulohy where id = :'u_chyba')
    = 'Meta vrátila 500.');

select pg_temp.check('a příspěvek se ještě NEvzdal',
  (select stav from public.marketing_prispevky where id = :'p_chyba') <> 'publikace_selhala');

-- Odklad posuneme do minulosti, jinak by se úloha nevyzvedla — a to je
-- právě to, co má odklad dělat.
select pg_temp.check('během odkladu se úloha nevyzvedne',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_chyba'));

update public.marketing_publikace_ulohy
   set dalsi_pokus_kdy = now() - interval '1 hour' where id = :'u_chyba';

select pg_temp.check('po uplynutí odkladu se vyzvedne',
  exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_chyba'));

select app.marketing_publikace_selhala(:'u_chyba', 'Meta vrátila 500 podruhé.') as stav2 \gset

select pg_temp.check('po vyčerpání pokusů se to vzdá', :'stav2' = 'vzdano');

select pg_temp.check('vzdaná úloha už nemá naplánovaný další pokus',
  (select dalsi_pokus_kdy is null from public.marketing_publikace_ulohy where id = :'u_chyba'));

select pg_temp.check('a příspěvek to řekne nahlas',
  (select stav from public.marketing_prispevky where id = :'p_chyba') = 'publikace_selhala');

select pg_temp.check('vzdaná úloha se už nevyzvedává',
  not exists (select 1 from app.marketing_vyzvednout_publikace(10) where id = :'u_chyba'));


\echo ''
\echo '== Dva kanály: hotovo je až když je hotovo obojí ============'

/*
  Jeden příspěvek jde na Instagram i na Facebook zvlášť. Kdyby se
  příspěvek přepnul na „zveřejněno" po prvním kanálu, druhý by na
  obrazovce vypadal jako hotový, i kdyby ještě neodešel — a nikdo by
  nehlídal, že se zasekl.
*/

select prispevek as p_dva, verze as v_dva, schvaleni as s_dva, uloha as u_ig
  from pg_temp.pripravit('Dva kanály', 'instagram', 'dva-ig', now() - interval '1 hour') \gset

insert into public.marketing_publikace_ulohy
  (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
   kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
values (:'tenant', :'p_dva', :'v_dva', 'otisk-dva-ig', :'s_dva',
        'facebook', 'prispevek', 'mock', 'demo', now() - interval '1 hour', 'dva-fb')
returning id as u_fb \gset

select count(*) as vyzvednuto_dva
  from app.marketing_vyzvednout_publikace(10)
 where prispevek_id = :'p_dva' \gset

select pg_temp.check('vyzvedly se obě úlohy jednoho příspěvku', :vyzvednuto_dva = 2);

select app.marketing_publikace_hotova(:'u_ig', 'ig-1', null, null, false);

select pg_temp.check('po prvním kanálu příspěvek JEŠTĚ NENÍ zveřejněný',
  (select stav from public.marketing_prispevky where id = :'p_dva') <> 'zverejneno');

select app.marketing_publikace_hotova(:'u_fb', 'fb-1', null, null, false);

select pg_temp.check('po druhém kanálu už zveřejněný je',
  (select stav from public.marketing_prispevky where id = :'p_dva') = 'zverejneno');


\echo ''
\echo '== Kolik se toho vyzvedne najednou =========================='

-- Bez stropu by fronta při výpadku poskytovatele vytáhla tisíc úloh
-- a naplánovaná úloha by se utnula na časovém limitu uprostřed
-- odesílání — s částí úloh v `odesila_se`, o kterých by nikdo nevěděl.

do $$
begin
  perform pg_temp.pripravit('Dávka 1', 'instagram', 'davka1', now() - interval '1 hour');
  perform pg_temp.pripravit('Dávka 2', 'instagram', 'davka2', now() - interval '1 hour');
  perform pg_temp.pripravit('Dávka 3', 'instagram', 'davka3', now() - interval '1 hour');
end $$;

select count(*) as davka from app.marketing_vyzvednout_publikace(2) \gset
select pg_temp.check('strop se dodržuje', :davka = 2);

select count(*) as zbytek from app.marketing_vyzvednout_publikace(10) \gset
select pg_temp.check('zbytek přijde na řadu příště', :zbytek = 1);


\echo ''
\echo '== Audit ===================================================='

select pg_temp.check('práce fronty je v auditu',
  exists (select 1 from public.audit_log
           where entity_type = 'marketing_publikace' and tenant_id = :'tenant'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
drop table if exists vyzvednuto;
delete from public.marketing_publikace where tenant_id = :'tenant';
delete from public.marketing_publikace_ulohy where tenant_id = :'tenant';
delete from public.marketing_schvaleni where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.marketing_media where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_publikace_ulohy where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 7 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
