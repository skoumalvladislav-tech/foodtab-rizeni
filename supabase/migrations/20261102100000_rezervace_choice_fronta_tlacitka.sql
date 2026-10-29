-- =====================================================================
-- Foodtab — Rezervace / Choice: fronta dotazů pustí tlačítko i vedle
-- běžícího načítání a úlohu tlačítko nezastaví
--
-- Navazuje na 20261031100000_rezervace_choice.sql (PR #162, nasazená
-- 26. 10. 2026 — ta se už NEMĚNÍ, proto nová migrace). Nezávislé
-- ověření po sloučení #162 našlo, že fronta dotazů na Choice drží limit
-- (1 dotaz za 5 s), ale tlačítka vedle běžícího načítání skoro nikdy
-- neprojdou — a když projdou, umí načítání useknout. Měřeno skutečným
-- lib/rezervace-choice-sync.ts v plánovači virtuálního času.
--
-- ---------------------------------------------------------------------
-- CO BYLO ŠPATNĚ
--
--   A. TLAČÍTKO TÉŽE FIRMY BĚHEM JEJÍHO NAČÍTÁNÍ. Pravidlo „firma nejvýš
--      jeden zabraný dotaz" platilo i pro úlohu a pro první načtení po
--      připojení. Běh si další dotaz zabírá hned po odpovědi, takže
--      firma měla zabraný dotaz skoro pořád a funkce jejímu tlačítku
--      vracela NULL. Majitel připojí pobočku 2, zatímco se načítá
--      pobočka 1 — test tokenu skončil „ověřit později" (prošel ve 4 až
--      52 % okamžiků podle doby odpovědi Choice), „Ověřit znovu" a
--      „Načíst teď" taky. A když tlačítko výjimečně prošlo (v okně mezi
--      odchodem dotazu běhu a jeho odpovědí), zabralo firmě dotaz a běh
--      pak další nedostal: úloha místo 15 dotazů udělala 5–6, první
--      načtení pobočky 1 místo 5 jeden. Věty „běh firmy jde dotaz po
--      dotazu, takže ho to nebrzdí" a „úloha má přednost" neplatily.
--
--   B. TŘETÍ TLAČÍTKO VEDLE DVOU BĚHŮ. Dva běhy jiných firem naráz
--      (úloha a první načtení) drží frontu dva rozestupy dopředu.
--      Tlačítko smí čekat nejvýš dva rozestupy, takže se vešlo jen
--      v okně mezi odchodem dotazu některého běhu a jeho odpovědí —
--      stejně špatně jako před opravou A z #162.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
--   1. ÚLOHA MÁ VLASTNÍ VSTUP DO FRONTY —
--      `public.rezervace_choice_zabrat_dotaz_ulohy` (nová). Zabírá čas
--      ve SPOLEČNÉ frontě (rozestup 5,5 s platí dál pro všechny), ale
--      pravidlo firmy se jí netýká: nečte ho ani nezapisuje. Pravidlo
--      vzniklo proti souběžným klikům (osm „Ověřit znovu" naráz zabralo
--      frontu na 30 s, prověrka 25. 10.). Úloha klikat nemůže: běží
--      jedna na celou instalaci (`uloha_zabrat`, zámek plánovače) a jde
--      dotaz po dotazu, takže nikdy nemá zabraný víc než jeden dotaz.
--      Tlačítko proto úloze NIKDY nevezme „její" dotaz — stojí ji
--      nejvýš místo ve frontě, které samo zabralo (úloha pak čeká
--      o rozestup déle, smí čekat celý svůj díl). A úloha tlačítku
--      nezabírá firmu: vedle úlohy vlastní firmy projde tlačítko stejně
--      jako vedle úlohy cizí.
--      To „nejvýš místo, které samo zabralo" drží i u úlohy s víc
--      připojeními díky tomu, jak úloha dělí čas (app/api/uloha/
--      rezervace-choice, lib/rezervace-choice-sync.ts `konecDiluUlohy`):
--      díl připojení se počítá od odchodu jeho PRVNÍHO dotazu, ne od
--      konce předchozího připojení; připojení, po jehož dílu by na další
--      nezbyl celý nejmenší díl, dočte zbytek úlohy; a čas pro další
--      připojení se počítá od konce dílu předchozího, ne od chvíle, kdy
--      doběhla jeho poslední odpověď (jinak by čas mezi tím propadl).
--      Nezávislé ověření PR #163: dřív se třemi a víc připojeními úloha
--      v ~15 % okamžiků přišla o dotaz víc, než kolik jich tlačítko
--      udělalo (tlačítko vzalo poslední místo dílu 1. připojení
--      a 2. připojení pak ~11 s svého dílu čekalo na frontu). Hlídá to
--      scripts/rezervace-choice.test.mjs (oddíl 6b: skutečná úloha se
--      2–4 připojeními a tlačítko v každém okamžiku, fronta obsazená
--      do 0,25–22 s po 250 ms a dávka kliků).
--
--   2. TLAČÍTKO JEDNOU POČKÁ A ZKUSÍ TO ZNOVU —
--      `public.rezervace_choice_zabrat_dotaz` (tlačítka, první načtení,
--      „Načíst teď") a přes ni `public.rezervace_choice_zabrat_overeni`.
--      Když nic nezabere, místo NULL vrátí ZÁPORNÉ ČÍSLO: za kolik ms má
--      smysl to zkusit znovu. To je chvíle, kdy odejde dotaz, který má
--      firma zabraný, a kdy se fronta posune tak, aby se dotaz vešel do
--      `p_nejdele_cekat_ms` (to pozdější z obojího). Server
--      (lib/rezervace-choice-sync.ts) pak JEDNOU počká — nejvýš jeden
--      rozestup — a zavolá znovu. Ta chvíle padne přesně do okna, kdy
--      dotaz jiného běhu právě odešel a ten běh ještě čeká na odpověď,
--      takže se tlačítko vejde. Běh, kterému tlačítko vzalo další místo,
--      dostane totéž: počká na odchod dotazu tlačítka a pokračuje, místo
--      aby skončil. Řeší A (tlačítko vedle běhu téže firmy, i dva běhy
--      téže firmy — první načtení dvou poboček — se střídají) i B
--      (fronta moc dopředu).
--
--   PROČ TAHLE KOMBINACE (zadání nabízelo „vrátit čas do zabrano_do
--   a tlačítko jednou počká" nebo „firmě dva zabrané dotazy, z nichž
--   jeden jen pro tlačítko"):
--     * Jen opakování (bez vlastního vstupu úlohy) přednost úlohy
--       nedrží. Úloha by sama musela čekat na dotaz tlačítka své firmy
--       a druhý klik v téže chvíli by ji useknul. A úloze opakování
--       nepomůže, když je fronta moc dopředu: smí čekat do konce svého
--       dílu, a ten se s časem zkracuje stejně rychle, jak se fronta
--       blíží — počkat a zkusit znovu by jen promrhalo její čas. Databáze
--       přitom z jednoho čísla nepozná, kterou z těch dvou věcí čeká.
--     * „Dva zabrané dotazy na firmu" by vyřešily jen A. B je o společné
--       frontě (třetí tlačítko jiné firmy), tam druhý dotaz firmy nic
--       nezmění. A jedna firma by souběžnými kliky zabrala dva ze tří
--       dotazů, které se tlačítkům do dvou rozestupů vejdou.
--     * Tohle je ta druhá možnost v podobě, která drží: „druhý zabraný
--       dotaz" firmy patří úloze, a úloha je v instalaci jediná.
--       Tlačítkům zůstává jeden na firmu a opakování.
--
--   STROPY ZŮSTÁVAJÍ: tlačítko čeká ve frontě nejvýš dva rozestupy
--   (11 s) — opakování nic nezabírá, takže tlačítka dohromady pořád
--   posunou frontu nejvýš o tři rozestupy (~16,5 s) před „teď", ať je
--   firem kolik chce (prověrka 26. 10.). Na opakování server čeká nejvýš
--   jeden rozestup a jen jednou; víc souběžných věcí jedné firmy (úloha,
--   dvě první načtení a k tomu klik) dostane „zkuste za chvíli".
--
-- ---------------------------------------------------------------------
-- TVAR ODPOVĚDI (obě tlačítkové funkce)
--
--   >= 0   zabráno: za kolik ms smí dotaz odejít,
--   <= -2  nic se nezabralo, zkusit znovu za |n| ms (nejméně 2 ms),
--   -1     jen `rezervace_choice_zabrat_overeni`: ověřovalo se před
--          chvílí (odstup). Proto „zkusit znovu" nikdy není -1.
--   NULL   už se nevrací. Kód ho bere jako „nic se nezabralo, nezkoušet"
--          — tak odpovídá databáze PŘED touhle migrací.
--
-- POŘADÍ NASAZENÍ: `db push` AŽ PO nasazení kódu z main (Vercel), a pak
-- HNED. Starý kód (do PR s touto migrací) záporné číslo bere jako chybu
-- fronty („Fronta dotazů na Choice selhala"), proto ne dřív. Nový kód
-- se starou databází jede, ale NE úplně jako dřív:
--   * tlačítka neopakují (NULL = nic, bez opakování) a když chybí
--     funkce úlohy (PGRST202), čeká úloha přes
--     `rezervace_choice_zabrat_dotaz` za firmu — to je jako dřív;
--   * „Načíst teď" má ale na běh 55 s místo 50 s (`KONEC_NACIST_TED_MS`,
--     s opakováním z téhle migrace díky tomu načte celé). Bez opakování
--     drží frontu vedle běžícího načítání o 5 s déle, takže TŘETÍ
--     tlačítko vedle úlohy a „Načíst teď" jiné firmy projde méně často
--     než dnes: nezávislé ověření PR #163 naměřilo 13–21 z 37 okamžiků
--     proti 30 z 37 (po db push 110 ze 110).
-- Mezi nasazením kódu a db push je tedy tlačítko vedle dvou běhů horší
-- než dnes. Nic se nerozbije a nic se nezapíše špatně, ale okno má být
-- krátké.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Žádná nová tabulka ani sloupec. `app.rezervace_choice_fronta_firmy`
--     teď drží zabraný dotaz TLAČÍTEK firmy (úloha do ní nepíše).
--   * Podpisy obou stávajících funkcí zůstávají (create or replace) —
--     PostgREST je volá stejnými parametry, granty zůstávají.
--   * Úloha opakování nedostane (viz výš: nic by jí nedalo) a dál
--     dostane NULL, když se do svého dílu nevejde.
--   * Odstup „Ověřit znovu" se nemění. Jeho zámek řádku (`select … for
--     update`) je jediná ochrana proti dvěma souběžným „Ověřit znovu"
--     na tomtéž připojení; krok105 ho nově zkouší dvěma spojeními
--     (oddíl 2d) i s kopií bez zámku, která musí spadnout.
--   * Žádné `set vlastni.parametr` v definici funkcí (na Supabase by
--     migrace nebyla superuživatel a spadla by na 42501). Všechny tři
--     funkce jsou `security definer set search_path = ''` — krok105
--     (oddíl 3) to u nich hlídá jmenovitě; krok31 kontroluje jen
--     schéma app a tyhle jsou v public.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ÚLOHA: vlastní vstup do společné fronty, bez pravidla firmy
-- ---------------------------------------------------------------------

-- Zabere čas na jeden dotaz NAPLÁNOVANÉ ÚLOHY. Vrací, za kolik ms smí
-- dotaz odejít (0 = hned), NULL = do `p_nejdele_cekat_ms` se nevejde
-- a nic se nezabralo. Firmu nebere: pravidlo „firma nejvýš jeden
-- zabraný dotaz" je proti souběžným klikům a úloha je v instalaci
-- jediná a jde dotaz po dotazu (hlavička). Volá ji JEN úloha
-- (app/api/uloha/rezervace-choice, za CRON_SECRET) — rozhoduje server,
-- jediný, kdo frontu volá (service_role).
--
-- Zamyká jen řádek fronty (tlačítka zamykají firmu, pak frontu — pořadí
-- se nekříží). `clock_timestamp()` až po zámku, jako u tlačítek.
-- Firmu úloha nebere, takže `for update` u řádku fronty je JEDINÉ, co ji
-- řadí za souběžné tlačítko: bez něj by přečetla `dalsi_volny` dřív, než
-- tlačítko zapíše, a obě by dostaly TENTÝŽ čas (na Choice dva dotazy
-- naráz, 429). krok105 oddíl 2b to zkouší dvěma spojeními i s kopií
-- funkce bez zámku, která musí spadnout (nezávislé ověření PR #163).
create function public.rezervace_choice_zabrat_dotaz_ulohy(p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ted    timestamptz;
  v_volny  timestamptz;
  v_slot   timestamptz;
begin
  if p_rozestup_ms is null or p_rozestup_ms < 5000 or p_rozestup_ms > 60000 then
    raise exception 'Rozestup dotazů na Choice musí být 5 až 60 sekund (Choice: 1 dotaz za 5 s).'
      using errcode = '22023';
  end if;
  if p_nejdele_cekat_ms is null or p_nejdele_cekat_ms < 0 or p_nejdele_cekat_ms > 120000 then
    raise exception 'Na dotaz na Choice se čeká nejvýš 120 sekund.'
      using errcode = '22023';
  end if;

  select q.dalsi_volny into v_volny
    from app.rezervace_choice_fronta q
   where q.jediny
     for update;
  if not found then
    raise exception 'Fronta dotazů na Choice nemá svůj řádek (migrace 20261031100000).'
      using errcode = 'P0002';
  end if;

  v_ted := clock_timestamp();
  v_slot := greatest(v_ted, v_volny);
  if v_slot > v_ted + p_nejdele_cekat_ms * interval '1 millisecond' then
    return null;
  end if;

  update app.rezervace_choice_fronta
     set dalsi_volny = v_slot + p_rozestup_ms * interval '1 millisecond'
   where jediny;

  return greatest(0, ceil(extract(epoch from (v_slot - v_ted)) * 1000))::integer;
end $$;

comment on function public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer) is
  'Fronta dotazů na Choice pro naplánovanou úlohu: zabere čas ve společné frontě bez pravidla firmy '
  '(úloha je v instalaci jediná). ms do odchodu, NULL = nevejde se; nic se nezabralo. Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer) to service_role;


-- ---------------------------------------------------------------------
-- 2. TLAČÍTKA: jeden zabraný dotaz na firmu, a když nic, kdy znovu
-- ---------------------------------------------------------------------

-- Zabere firmě čas na jeden dotaz tlačítka („Ověřit znovu", „Načíst
-- teď", test a první načtení v callbacku). Vrací (hlavička, TVAR
-- ODPOVĚDI): >= 0 ms do odchodu dotazu, <= -2 nic se nezabralo a za |n|
-- ms to má smysl zkusit znovu. Nic se nezabere, když
--   * firma už má zabraný dotaz, který ještě neodešel (znovu: až odejde),
--   * nebo se dotaz do `p_nejdele_cekat_ms` nevejde (znovu: až se fronta
--     posune o tolik, aby se vešel — kdyby mezitím nikdo nic nezabral).
-- Platí-li obojí, rozhoduje pozdější chvíle. NULL už nevrací.
--
-- Chybějící řádek fronty NENÍ „nevejde se": funkce spadne (P0002).
-- Zámky vždy ve stejném pořadí (firma, pak fronta); souběh dvou volání
-- téže firmy rozhoduje zámek řádku firmy (`for update` hned ve čtení
-- `zabrano_do`, krok105 oddíl 2b). `clock_timestamp()` až po zámcích.
create or replace function public.rezervace_choice_zabrat_dotaz(p_tenant uuid, p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ted      timestamptz;
  v_volny    timestamptz;
  v_firma    timestamptz;
  v_slot     timestamptz;
  v_nejdele  interval;
  v_znovu    timestamptz;
begin
  if p_tenant is null then
    raise exception 'Dotaz na Choice musí patřit firmě.' using errcode = '22023';
  end if;
  if p_rozestup_ms is null or p_rozestup_ms < 5000 or p_rozestup_ms > 60000 then
    raise exception 'Rozestup dotazů na Choice musí být 5 až 60 sekund (Choice: 1 dotaz za 5 s).'
      using errcode = '22023';
  end if;
  if p_nejdele_cekat_ms is null or p_nejdele_cekat_ms < 0 or p_nejdele_cekat_ms > 120000 then
    raise exception 'Na dotaz na Choice se čeká nejvýš 120 sekund.'
      using errcode = '22023';
  end if;

  insert into app.rezervace_choice_fronta_firmy (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;

  select f.zabrano_do into v_firma
    from app.rezervace_choice_fronta_firmy f
   where f.tenant_id = p_tenant
     for update;

  select q.dalsi_volny into v_volny
    from app.rezervace_choice_fronta q
   where q.jediny
     for update;
  if not found then
    raise exception 'Fronta dotazů na Choice nemá svůj řádek (migrace 20261031100000).'
      using errcode = 'P0002';
  end if;

  v_ted := clock_timestamp();
  v_nejdele := p_nejdele_cekat_ms * interval '1 millisecond';
  v_slot := greatest(v_ted, v_volny);

  if v_firma > v_ted or v_slot > v_ted + v_nejdele then
    -- `greatest` vynechá NULL: platí-li jen jedna z podmínek, rozhoduje ta.
    v_znovu := greatest(
      case when v_firma > v_ted then v_firma end,
      case when v_slot > v_ted + v_nejdele then v_volny - v_nejdele end);
    return -greatest(2, ceil(extract(epoch from (v_znovu - v_ted)) * 1000))::integer;
  end if;

  update app.rezervace_choice_fronta
     set dalsi_volny = v_slot + p_rozestup_ms * interval '1 millisecond'
   where jediny;
  update app.rezervace_choice_fronta_firmy
     set zabrano_do = v_slot
   where tenant_id = p_tenant;

  return greatest(0, ceil(extract(epoch from (v_slot - v_ted)) * 1000))::integer;
end $$;

comment on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) is
  'Fronta dotazů na Choice pro tlačítka: zabere firmě čas na jeden dotaz. >= 0 = ms do odchodu, '
  '<= -2 = nic se nezabralo (firma má zabraný dotaz nebo se nevejde), zkusit znovu za |n| ms. Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) to service_role;


-- „Ověřit znovu": odstup na připojení a dotaz ve frontě NARÁZ, jako
-- dosud (20261031100000). Mění se jen odpověď, když se dotaz nevejde:
-- místo NULL se předá záporné číslo z fronty („zkusit znovu za |n|
-- ms") — odstup se ani tak NESPOTŘEBUJE, takže opakování po chvíli
-- projde odstupem znovu.
--
-- Vrací >= 0 ms do odchodu testu (odstup i dotaz zabrané), -1 = ověřovalo
-- se před méně než `p_odstup_ms` (fronty se nedotkne), <= -2 = nic
-- (viz výš). `rezervace_choice_zabrat_dotaz` vrací vždy číslo.
--
-- Souběh dvou volání téhož připojení rozhoduje zámek řádku odstupu
-- (`select … for update`): druhé počká, až první skončí, a odstup
-- přečte nad jeho výsledkem. Bez něj by přečetlo starý čas, na zámku
-- firmy počkalo a pravidlo firmy by ho nezastavilo (zabraný dotaz
-- prvního je při volné frontě už minulost) — na Choice by šly do minuty
-- dva testy. krok105, oddíl 2d.
create or replace function public.rezervace_choice_zabrat_overeni(
  p_pripojeni uuid, p_tenant uuid, p_odstup_ms integer, p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_naposledy  timestamptz;
  v_cekat      integer;
begin
  if p_pripojeni is null then
    raise exception 'Ověření Choice musí patřit připojení.' using errcode = '22023';
  end if;
  if p_tenant is null then
    raise exception 'Dotaz na Choice musí patřit firmě.' using errcode = '22023';
  end if;
  if p_odstup_ms is null or p_odstup_ms < 30000 or p_odstup_ms > 3600000 then
    raise exception 'Odstup ověření Choice musí být 30 sekund až 1 hodina.' using errcode = '22023';
  end if;

  -- Řádek odstupu (neexistující připojení spadne na cizím klíči) a jeho zámek.
  insert into app.rezervace_choice_overeni (pripojeni_id, naposledy)
  values (p_pripojeni, '-infinity')
  on conflict (pripojeni_id) do nothing;

  select o.naposledy into v_naposledy
    from app.rezervace_choice_overeni o
   where o.pripojeni_id = p_pripojeni
     for update;

  if v_naposledy > clock_timestamp() - p_odstup_ms * interval '1 millisecond' then
    return -1;
  end if;

  v_cekat := public.rezervace_choice_zabrat_dotaz(p_tenant, p_rozestup_ms, p_nejdele_cekat_ms);
  if v_cekat < 0 then
    return v_cekat;
  end if;

  update app.rezervace_choice_overeni
     set naposledy = clock_timestamp()
   where pripojeni_id = p_pripojeni;
  return v_cekat;
end $$;

comment on function public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer) is
  'Odstup „Ověřit znovu" u připojení Choice a dotaz ve frontě naráz: ms do odchodu testu, -1 = ověřovalo se před chvílí, '
  '<= -2 = do fronty se nevešel, zkusit znovu za |n| ms (odstup se nespotřeboval). Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer) to service_role;
