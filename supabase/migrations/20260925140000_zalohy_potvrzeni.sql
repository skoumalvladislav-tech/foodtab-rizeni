-- =====================================================================
-- Foodtab — potvrzení zálohy v telefonu, za zaměstnance majitelem,
-- a zpráva tomu, kdo zálohu vydal
--
-- Zadání majitele 25. 9. 2026 ráno (doslovně):
--   „když se vydá záloha tak zaměstnanec který vydává zálohu na svém
--   telefonu namačká a nebo na tabletu, pracovníkovi který si zálohu
--   bere přijde notifikace a potvrdí ve svém telefonu že si ji vzal.
--   zároveň pracovník který zálohu předal dostane info že je potvrzeno."
--   „já jako majitel potřebuji umět potvrdit zálohu každému zaměstnanci"
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace.
--
-- Razítko 20260925140000, ne původní 20260925100000: v main už leží
-- 20260925120000 (#84) a 20260925130000 (#82). Se starším razítkem by
-- db push tuhle migraci odmítl, kdyby se main nasadil dřív. Na žádné
-- z těch dvou nezávisí a ony nezávisí na ní (jiné funkce).
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
--   1. `advances` dostává dva sloupce: JAK se potvrdilo (`potvrzeno_jak`:
--      pin / telefon / majitel) a KDO to zapsal (`potvrdil`, účet).
--      U PINu zůstává `potvrzeno_zarizenim` (který tablet) a `potvrdil`
--      je prázdný — kdo potvrdil, řekl PIN, ne přihlášený účet.
--
--   2. NOVÁ pomocná `app.zapsat_potvrzeni_zalohy` — JEDINÉ místo, které
--      zálohu potvrzuje: zápis, audit, zpráva vydávajícímu a zrušení
--      čekajícího push k výplatě. Volají ji všechny tři cesty, aby se
--      nemohly rozejít (stejná úvaha jako `app.patri_k_zaloze`
--      v 20260924120000: dvě kopie téhož pravidla se vždycky rozejdou).
--      Samotné zrušení push je ještě o patro níž, v `app.zrusit_vyzvu_
--      k_zaloze` — volá ho i storno (bod 9).
--
--   3. NOVÁ `public.potvrdit_moji_zalohu` — příjemce potvrdí ve svém
--      telefonu. Jen svou, jen nepotvrzenou a nestornovanou.
--
--   4. NOVÁ `public.potvrdit_zalohu_za_zamestnance` — majitel potvrdí za
--      kohokoli ze své firmy. Brána `app.is_owner`, ne `advances.manage`:
--      kdo zálohy vydává, si je nesmí sám potvrzovat — potvrzení je
--      doklad právě proto, že ho nedělá ten, kdo peníze vydal.
--
--   5. NOVÁ `public.moje_nepotvrzene_zalohy` — co ukazuje karta na
--      Docházce („Máte nepotvrzenou zálohu … od …").
--
--   6. `public.potvrdit_zalohu_pinem` (kiosek) — tělo z 20260901220000
--      beze změny v tom, KDO smí; jen zápis jde přes pomocnou funkci,
--      takže i potvrzení PINem pošle zprávu vydávajícímu. Přibyl zámek
--      řádku (`for update`) — viz „Souběh".
--
--   7. `public.vyplatit_zalohu` — tělo z POSLEDNÍ definice
--      (20260924120000), změněné JEN v upozornění příjemci: místo
--      přímého insertu do `notifications` jde přes `app.notifikovat`.
--      Tím se dostane do fronty doručení a na telefon (push); dřív
--      zůstalo jen ve zvonečku aplikace.
--
--   8. `public.zalohy_pobocky` vrací navíc `potvrzeno_jak` — obrazovka
--      Záloh ukazuje, jestli zálohu potvrdil zaměstnanec, nebo za něj
--      majitel. Mění se tvar výsledku, proto drop + create (create or
--      replace změnu výstupních sloupců neumí). Stará aplikace sloupec
--      navíc ignoruje.
--
--   9. `public.stornovat_zalohu` — tělo z 20260901220000 (jiná definice
--      od té doby není), změněné JEN v tom, že po stornu zruší čekající
--      push „Máte zálohu k potvrzení". Dřív tahle situace nastat
--      nemohla: push k výplatě vůbec nebyl (bod 7). Bez toho by příjemci,
--      který není v práci, druhý den po příchodu pípla výzva k záloze,
--      kterou mezitím někdo stornoval — a karta v Docházce by byla
--      prázdná, protože stornovaná se nepotvrzuje.
--
-- ---------------------------------------------------------------------
-- ROZHODNUTÍ (nejopatrnější varianta; zapsané, ať je jde změnit)
--
--   * Zprávu `zaloha.potvrzena` dostane VYDÁVAJÍCÍ (`advances.vyplatil`)
--     po potvrzení kteroukoli cestou — i PINem na kiosku. Nedostane ji,
--     když potvrdil sám sebe (majitel vyplatil a sám potvrdil; ví to).
--   * Když potvrdí MAJITEL ZA ZAMĚSTNANCE, dostane zprávu i ten
--     zaměstnanec (`zaloha.potvrzena_za_vas`), pokud má účet. Potvrzení
--     za někoho je tvrzení o jeho penězích; musí se o něm dozvědět, aby
--     se mohl ozvat, kdyby hotovost nedostal.
--   * Po potvrzení i po stornu se ZRUŠÍ čekající push k výplatě příjemci
--     (`zaloha.vyplacena`, stav ceka_na_smenu / k_odeslani). Jinak by
--     mu po příchodu na směnu pípla výzva k potvrzení zálohy, kterou už
--     potvrdil na tabletu, nebo kterou někdo stornoval. Záznam
--     v aplikaci zůstává.
--   * Upozornění jdou s prioritou `normal`. Mimo směnu tedy push čeká
--     na příchod (app.doruci_se); majiteli chodí hned
--     (20260922120000). V aplikaci je upozornění vidět hned vždycky.
--     Jestli má výzva k potvrzení obcházet čekání na směnu, je otázka
--     pro Šéfíka (17 v docs/hlaseni/otazky.md) — `urgent` znamená na
--     obrazovce „NALÉHAVÉ", a to záloha není.
--   * Přímá výplata z kiosku (karta Zálohy s PINem vydávajícího) se
--     NEDĚLÁ — otázka 16 v docs/hlaseni/otazky.md.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Stará potvrzení (před touhle migrací) se NEDOPLŇUJÍ. `potvrzeno_jak`
--     u nich zůstává prázdné — tehdy jiná cesta než PIN nebyla, takže
--     prázdné u potvrzené zálohy znamená „PINem před 25. 9. 2026".
--     Doplnění by byl zásah do zákaznických dat a každý řádek by navíc
--     prošel spouští auditu jako změna, kterou nikdo neudělal.
--   * Podmínka „potvrzená MUSÍ mít způsob" na tabulce NENÍ. Zkoušel jsem
--     ji jako `not valid` (nová data ano, stará ne) a hned spadl scénář
--     krok55, který si potvrzenou zálohu zakládá přímým zápisem — stejně
--     by spadl každý budoucí import nebo ruční oprava. Všechny tři cesty
--     potvrzení jdou přes app.zapsat_potvrzeni_zalohy, která způsob píše
--     vždycky, a krok60 to u každé cesty kontroluje. Obrazovka prázdný
--     způsob stejně umět musí (stará data).
--   * Potvrzení se NEDÁ vrátit. Omylem potvrzenou zálohu nejde
--     „odpotvrdit" ani storno nemaže potvrzení — storno jde dál jako
--     dřív; mění se na něm jen zrušení čekající výzvy (bod 9). Zprávu
--     „záloha byla stornovaná" příjemci storno NEPOSÍLÁ — to by byla
--     nová věc mimo zadání.
--   * Kiosek (anon) push hned neposílá — dojde frontou s plánovačem.
--     Hned posílá jen aplikace: po výplatě, po potvrzení v telefonu
--     a po potvrzení za zaměstnance (lib/komunikace/push-hned.ts).
--   * `kiosk_zalohy` se nemění: tablet dál ukazuje dnešní nepotvrzené.
--
-- ---------------------------------------------------------------------
-- BEZPEČNOST (nálezy, oddíl 7b — v definer funkci druhá linie NENÍ)
--
-- Všechny funkce jsou `security definer` s vlastníkem s `rolbypassrls`;
-- RLS se uvnitř neuplatní. Každá si proto filtruje sama a každý filtr
-- je v každé cestě napsaný JEN JEDNOU (scénář krok60 má na každý vlastní
-- kontrolu, která spadne, když se vyndá):
--
--   potvrdit_moji_zalohu
--     app.is_member(p_tenant)   aktivní členství (ne pozastavené)
--     a.tenant_id = p_tenant    záloha téže firmy — člověk ve dvou
--                               firmách nesmí volat jednou a zapsat
--                               do druhé
--     e.user_id = auth.uid()    jen vlastní záloha
--     e.deleted_at is null      označený smazaný nic nepotvrzuje
--
--   potvrdit_zalohu_za_zamestnance
--     app.is_owner(p_tenant)    jen majitel TÉHLE firmy (členství
--                               aktivní, majitel nesmazaný — drží
--                               is_owner sama)
--     a.tenant_id = p_tenant    majitel jedné firmy nepotvrdí zálohu
--                               druhé
--
--   moje_nepotvrzene_zalohy — tytéž čtyři filtry jako „moje" výš plus
--     stav 'nepotvrzena'.
--
-- Stav (nepotvrzená / stornovaná / potvrzená) hlídá každá cesta sama,
-- protože každá říká jinou větu; pomocná funkce ho už nekontroluje
-- (druhá kopie téže podmínky by nešla shodit).
--
-- Granty: pomocné funkce nikomu zvenku; nové public funkce jen
-- `authenticated` (Supabase dává nové funkci výchozí právo i `anon`,
-- proto výslovné revoke).
--
-- Nové sloupce dostávají sloupcový `grant select`. Je to POJISTKA, ne
-- podmínka: ostrá databáze (katalog čtený 25. 9. 2026) má na `advances`
-- pro `authenticated` SELECT na CELOU tabulku z výchozích práv Supabase
-- (vedle sloupcových grantů na každý starý sloupec), takže tam nové
-- sloupce jde číst i bez něj. Platí v prostředí, kde celotabulkový
-- grant není (PGlite, čistý PostgreSQL, a až se výchozí práva jednou
-- uklidí) — tam by `select` na nové sloupce spadl 42501 a s ním celá
-- obrazovka.
--
-- SOUBĚH. Příjemce na tabletu a v telefonu, nebo příjemce a majitel,
-- můžou potvrdit tutéž zálohu ve stejnou chvíli. Každá cesta si proto
-- řádek zálohy zamkne (`for update`) dřív, než se podívá na stav. Druhá
-- počká, uvidí „potvrzená" a nic nezapíše — vydávající nedostane dvě
-- zprávy a způsob potvrzení se nepřepíše.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SLOUPCE
-- ---------------------------------------------------------------------

alter table public.advances
  add column potvrzeno_jak text
    constraint advances_potvrzeno_jak_hodnoty
    check (potvrzeno_jak is null or potvrzeno_jak in ('pin', 'telefon', 'majitel')),
  add column potvrdil uuid references public.profiles(user_id) on delete set null;

comment on column public.advances.potvrzeno_jak is
  'Jak se záloha potvrdila: pin (tablet, potvrzeno_zarizenim), telefon '
  '(příjemce ve své aplikaci), majitel (za zaměstnance). Prázdné u potvrzené '
  '= PINem před 25. 9. 2026, kdy jiná cesta nebyla.';
comment on column public.advances.potvrdil is
  'Účet, který potvrzení zapsal: u telefonu příjemce, u majitele majitel. '
  'U PINu prázdné — potvrdil držitel PINu na tabletu potvrzeno_zarizenim.';

-- Pojistka pro prostředí bez celotabulkového SELECT — viz hlavička,
-- „Granty".
grant select (potvrzeno_jak, potvrdil) on public.advances to authenticated;


-- ---------------------------------------------------------------------
-- 2a. VÝZVA K POTVRZENÍ UŽ NEPLATÍ — zrušit čekající push
--
-- Příjemci, který není v práci, čeká push „Máte zálohu k potvrzení"
-- na příchod (ceka_na_smenu); kdo v práci je, tomu čeká na odesílač
-- (k_odeslani — třeba když push hned selhal nebo chybí klíče). Po
-- potvrzení (kteroukoli cestou) ani po stornu už výzva nemá k čemu
-- vyzývat. Volá se z obou míst TOUHLE funkcí: seznam stavů a druh
-- upozornění napsané dvakrát by se rozešly.
--
-- Záznam v aplikaci (`notifications`) zůstává — je to záznam, ne
-- oznámení. Nic nekontroluje; volá se až z definer funkcí po jejich
-- kontrolách.
-- ---------------------------------------------------------------------

create function app.zrusit_vyzvu_k_zaloze(p_zaloha uuid, p_proc text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.notifikace_doruceni d
     set stav  = 'zruseno',
         chyba = p_proc
   where d.stav in ('ceka_na_smenu', 'k_odeslani')
     and d.notification_id in (
       select n.id from public.notifications n
        where n.druh      = 'zaloha.vyplacena'
          and n.zdroj_typ = 'zaloha'
          and n.zdroj_id  = p_zaloha
     );
end $$;

comment on function app.zrusit_vyzvu_k_zaloze(uuid, text) is
  'Zruší čekající push „Máte zálohu k potvrzení" (ceka_na_smenu, k_odeslani) '
  'po potvrzení nebo stornu zálohy. Záznam v aplikaci zůstává.';

revoke all on function app.zrusit_vyzvu_k_zaloze(uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. JEDINÉ MÍSTO, KTERÉ ZÁLOHU POTVRZUJE
--
-- Volá se jen z definer funkcí níž, a to AŽ PO jejich kontrolách
-- (kdo, čí, stav) a se zamčeným řádkem. Sama nic nekontroluje — viz
-- hlavička, „každý filtr jen jednou".
--
-- `p_potvrdil` je účet, který potvrzení zapsal (u PINu NULL).
-- Kdo potvrdil „ve skutečnosti" (pro to, jestli psát vydávajícímu), je
-- u PINu příjemce: jeho PIN to byl.
-- ---------------------------------------------------------------------

create function app.zapsat_potvrzeni_zalohy(
  p_zaloha   uuid,
  p_jak      text,
  p_potvrdil uuid,
  p_zarizeni uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zal   public.advances;
  v_jmeno text;
  v_uziv  uuid;
  v_telo  jsonb;
begin
  update public.advances
     set stav                = 'potvrzena',
         potvrzeno_kdy       = now(),
         potvrzeno_jak       = p_jak,
         potvrdil            = p_potvrdil,
         potvrzeno_zarizenim = p_zarizeni
   where id = p_zaloha
  returning * into v_zal;

  select e.full_name, e.user_id into v_jmeno, v_uziv
    from public.employees e
   where e.id = v_zal.employee_id;

  perform app.audit(v_zal.tenant_id, 'advance.potvrzeno', 'advance', v_zal.id::text,
                    v_zal.branch_id, null,
                    jsonb_build_object('jak', p_jak, 'castka_haleru', v_zal.castka_haleru));

  -- Výzva k potvrzení už nemá co hlásit (bod 2a).
  perform app.zrusit_vyzvu_k_zaloze(v_zal.id, 'Záloha je mezitím potvrzená.');

  v_telo := jsonb_build_object(
    'castka_haleru', v_zal.castka_haleru,
    'zaloha',        v_zal.id,
    'den',           v_zal.business_date,
    'jmeno',         v_jmeno,
    'jak',           p_jak
  );

  -- Vydávajícímu — kromě případu, kdy potvrdil sám (majitel vyplatil
  -- a sám potvrdil, nebo si příjemce zálohu vydal sám).
  if v_zal.vyplatil is not null
     and v_zal.vyplatil is distinct from coalesce(p_potvrdil, v_uziv) then
    perform app.notifikovat(
      v_zal.tenant_id, v_zal.vyplatil, 'zaloha.potvrzena', v_telo,
      'normal', v_zal.branch_id, null, 'zaloha', v_zal.id, null
    );
  end if;

  -- Potvrdil-li majitel ZA NĚKOHO, dozví se to ten, za koho.
  if p_jak = 'majitel'
     and v_uziv is not null
     and v_uziv is distinct from p_potvrdil then
    perform app.notifikovat(
      v_zal.tenant_id, v_uziv, 'zaloha.potvrzena_za_vas', v_telo,
      'normal', v_zal.branch_id, null, 'zaloha', v_zal.id, null
    );
  end if;
end $$;

comment on function app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid) is
  'Jediné místo, které zálohu potvrzuje: zápis, audit, zrušení čekajícího '
  'push k výplatě, zpráva vydávajícímu (a příjemci, když potvrdil majitel). '
  'Nic nekontroluje — volá se až po kontrolách volající funkce se zamčeným řádkem.';

revoke all on function app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. PŘÍJEMCE POTVRDÍ VE SVÉM TELEFONU
--
-- Vrací id zálohy — aplikace podle něj pošle push hned (zdroj
-- upozornění), stejně jako u zprávy vrací id `poslat_zpravu`.
--
-- Cizí, neexistující, smazanému nebo z jiné firmy: VŠECHNO JEDNA VĚTA.
-- Kdo zkouší cizí id, se z odpovědi nesmí dozvědět, že záloha existuje.
-- ---------------------------------------------------------------------

create function public.potvrdit_moji_zalohu(p_tenant uuid, p_zaloha uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zal public.advances;
begin
  if not app.is_member(p_tenant) then
    raise exception 'Do téhle firmy nepatříte.' using errcode = 'insufficient_privilege';
  end if;

  select a.* into v_zal
    from public.advances a
    join public.employees e on e.id = a.employee_id
   where a.id = p_zaloha
     and a.tenant_id = p_tenant
     and e.user_id = (select auth.uid())
     and e.deleted_at is null
     for update of a;

  if not found then
    raise exception 'Takovou zálohu tu nemáte. Potvrdit ji může jen ten, kdo ji dostal.'
      using errcode = 'no_data_found';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Stornovaná záloha se nepotvrzuje.' using errcode = 'check_violation';
  end if;

  if v_zal.stav = 'potvrzena' then
    raise exception 'Tahle záloha je už potvrzená.' using errcode = 'check_violation';
  end if;

  perform app.zapsat_potvrzeni_zalohy(v_zal.id, 'telefon', (select auth.uid()), null);

  return v_zal.id;
end $$;

comment on function public.potvrdit_moji_zalohu(uuid, uuid) is
  'Příjemce potvrdí ve své aplikaci, že zálohu dostal. Jen vlastní, '
  'nepotvrzenou a nestornovanou. Vrací id zálohy (pro push hned).';

revoke all on function public.potvrdit_moji_zalohu(uuid, uuid) from public, anon;
grant execute on function public.potvrdit_moji_zalohu(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. MAJITEL POTVRDÍ ZA ZAMĚSTNANCE
--
-- Majitel, ne `advances.manage`: viz hlavička, bod 4. Na pobočce
-- nezáleží — majitel má `employees.branch_id` NULL a potvrzuje v celé
-- firmě.
--
-- Majitelství se ptá PRVNÍ: kdo majitel není, dostane „jen majitel"
-- i u cizího nebo neexistujícího id a nedozví se nic o zálohách.
-- ---------------------------------------------------------------------

create function public.potvrdit_zalohu_za_zamestnance(p_tenant uuid, p_zaloha uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zal public.advances;
begin
  if not app.is_owner(p_tenant) then
    raise exception 'Potvrdit zálohu za zaměstnance smí jen majitel.'
      using errcode = 'insufficient_privilege';
  end if;

  select a.* into v_zal
    from public.advances a
   where a.id = p_zaloha
     and a.tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'Taková záloha tu není.' using errcode = 'no_data_found';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Stornovaná záloha se nepotvrzuje.' using errcode = 'check_violation';
  end if;

  if v_zal.stav = 'potvrzena' then
    raise exception 'Tahle záloha je už potvrzená.' using errcode = 'check_violation';
  end if;

  perform app.zapsat_potvrzeni_zalohy(v_zal.id, 'majitel', (select auth.uid()), null);

  return v_zal.id;
end $$;

comment on function public.potvrdit_zalohu_za_zamestnance(uuid, uuid) is
  'Majitel potvrdí zálohu za zaměstnance (app.is_owner). Zapíše se, že '
  'potvrdil majitel; zprávu dostane vydávající i zaměstnanec. Vrací id zálohy.';

revoke all on function public.potvrdit_zalohu_za_zamestnance(uuid, uuid) from public, anon;
grant execute on function public.potvrdit_zalohu_za_zamestnance(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. MOJE NEPOTVRZENÉ ZÁLOHY — karta na Docházce
--
-- „Od koho": jméno vydávajícího ve TÉHLE firmě (zaměstnanecký záznam
-- jeho účtu, i kdyby už byl označený smazaný — je to minulost), jinak
-- jméno z profilu. Víc o něm se nevrací.
-- ---------------------------------------------------------------------

create function public.moje_nepotvrzene_zalohy(p_tenant uuid)
returns table (
  id            uuid,
  castka_haleru integer,
  business_date date,
  vyplaceno_kdy timestamptz,
  vydal         text,
  pobocka       text
)
language sql stable security definer set search_path = ''
as $$
  select a.id,
         a.castka_haleru,
         a.business_date,
         a.vyplaceno_kdy,
         coalesce(
           (select v.full_name
              from public.employees v
             where v.tenant_id = a.tenant_id
               and v.user_id   = a.vyplatil
             order by v.deleted_at nulls first
             limit 1),
           (select nullif(btrim(p.full_name), '')
              from public.profiles p
             where p.user_id = a.vyplatil)
         ),
         b.name
  from public.advances a
  join public.employees e on e.id = a.employee_id
  join public.branches b on b.id = a.branch_id
  where a.tenant_id = p_tenant
    and a.stav = 'nepotvrzena'
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
    and app.is_member(p_tenant)
  order by a.vyplaceno_kdy;
$$;

comment on function public.moje_nepotvrzene_zalohy(uuid) is
  'Vlastní nepotvrzené zálohy přihlášeného (karta na Docházce) — částka, '
  'den, kdo vydal, pobočka. Stejné filtry jako potvrdit_moji_zalohu.';

revoke all on function public.moje_nepotvrzene_zalohy(uuid) from public, anon;
grant execute on function public.moje_nepotvrzene_zalohy(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. POTVRZENÍ PINEM NA KIOSKU
--
-- Tělo z 20260901220000 (jiná definice od té doby není). Mění se jen:
--   * řádek se zamyká (`for update`) — viz „Souběh" v hlavičce;
--   * zápis a audit dělá app.zapsat_potvrzeni_zalohy — tím jde zpráva
--     vydávajícímu i z kiosku.
-- Kdo smí (zařízení + PIN toho, komu záloha patří), odpověď na špatný
-- PIN i tiché „druhé potvrzení nic nemění" zůstávají.
-- ---------------------------------------------------------------------

create or replace function public.potvrdit_zalohu_pinem(
  p_klic   text,
  p_pin    text,
  p_zaloha uuid
)
returns table (ok boolean, jmeno text, castka_haleru integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_emp uuid;
  v_zal public.advances;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_zal from public.advances a
  where a.id = p_zaloha and a.tenant_id = d.tenant_id and a.branch_id = d.branch_id
  for update;

  if not found then
    raise exception 'Taková záloha na téhle pobočce není.'
      using errcode = 'no_data_found';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Stornovaná záloha se nepotvrzuje.'
      using errcode = 'check_violation';
  end if;

  v_emp := app.pin_overit(d.tenant_id, d.branch_id, coalesce(p_pin, ''));

  -- PIN nesedl, nebo sedl někomu jinému. Obojí je totéž „ne“: kdo
  -- hádá, se z odpovědi nesmí dozvědět, jestli se trefil.
  if v_emp is null or v_emp <> v_zal.employee_id then
    return query select false, null::text, null::integer;
    return;
  end if;

  -- Druhé potvrzení téže zálohy není chyba — jen se nic nemění.
  if v_zal.stav = 'nepotvrzena' then
    perform app.zapsat_potvrzeni_zalohy(v_zal.id, 'pin', null, d.id);
  end if;

  return query
    select true, e.full_name, v_zal.castka_haleru
    from public.employees e where e.id = v_zal.employee_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. VÝPLATA — upozornění příjemci přes Notification Service
--
-- Tělo opsané z 20260924120000 (poslední definice). JEDINÁ změna je na
-- konci: `app.notifikovat` místo přímého insertu do `notifications`.
-- Tím upozornění:
--   * dostane zdroj (`zaloha`, id zálohy) — podle něj aplikace pošle
--     push hned a potvrzení zruší čekající push;
--   * jde do fronty doručení (push na telefon);
--   * nepřijde člověku BEZ AKTIVNÍHO ČLENSTVÍ (pozastavený, nikdy
--     nepřijatá pozvánka) — pravidlo app.notifikovat. Dřív se zapsalo
--     každému s účtem; do aplikace té firmy se takový člověk stejně
--     nedostane, takže mu nechybí nic, co by mohl otevřít.
-- Všechno ostatní (právo, pobočka výdeje, „patří", pozastavení, částka,
-- varování, zápis, audit) je beze změny.
-- ---------------------------------------------------------------------

create or replace function public.vyplatit_zalohu(
  p_tenant   uuid,
  p_employee uuid,
  p_castka   integer,
  p_poznamka text default '',
  p_branch   uuid default null
)
returns table (
  zaloha         uuid,
  varovani       text,
  vydelano_haleru integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch  uuid;
  v_domovska uuid;
  v_jmeno   text;
  v_uziv    uuid;
  v_id      uuid;
  v_vydelano integer;
  v_zalohy  integer;
  v_max     integer;
  v_den     date;
  v_varovani text := null;
begin
  select e.branch_id, e.full_name, e.user_id into v_domovska, v_jmeno, v_uziv
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  -- Pobočka VÝDEJE. Bez ní (stará aplikace) domovská, jako dřív.
  v_branch := coalesce(p_branch, v_domovska);

  if v_branch is null then
    raise exception 'Vyberte pobočku, na které zálohu vydáváte.'
      using errcode = 'check_violation';
  end if;

  -- Právo PRVNÍ — před firmou pobočky i před „patří". Kdo ho na pobočce
  -- výdeje nemá, nedozví se z hlášky nic o pobočce ani o lidech.
  if not app.has_access(p_tenant, 'advances.manage', v_branch) then
    raise exception 'Vyplácet zálohy smí jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Pobočka téže firmy. `has_access` to u celofiremního členství
  -- nezastaví — viz hlavička 20260924120000.
  if not exists (
    select 1 from public.branches b
    where b.id = v_branch and b.tenant_id = p_tenant
  ) then
    raise exception 'Taková pobočka tu není.' using errcode = 'no_data_found';
  end if;

  -- Provozní den POBOČKY VÝDEJE, ne domovské (kiosek, viz 20260924120000).
  v_den := app.business_date(v_branch, now());

  -- Na pobočce výdeje musí „patřit" — stejné pravidlo jako nabídka.
  --
  -- Okno ±7 dní MUSÍ zůstat shodné s výchozím `okno = 7`
  -- v lib/lide-pobocky.ts (`lideProZalohy`) — s tím obrazovka volá
  -- nabídku „Komu". Viz hlavička 20260924120000.
  if not exists (
    select 1 from app.patri_k_zaloze(p_tenant, v_branch, v_den - 7, v_den + 7) k
    where k.employee_id = p_employee
  ) then
    raise exception 'Tenhle člověk na téhle pobočce nepracuje.'
      using errcode = 'check_violation';
  end if;

  -- ODMÍTÁ, NEVARUJE. Viz hlavička 20260902040000.
  if app.zalohy_pozastavene(p_tenant, p_employee) then
    raise exception
      'Tomuhle zaměstnanci jsou zálohy pozastavené. Povolit je může jen ten, kdo spravuje mzdy.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_castka is null or p_castka <= 0 then
    raise exception 'Částka musí být kladná.' using errcode = 'check_violation';
  end if;

  -- Kolik má za tenhle měsíc odpracováno a kolik už dostal. Slouží
  -- JEN k varování.
  select v.vydelano_haleru into v_vydelano
  from app.earnings(p_employee, date_trunc('month', v_den)::date) v;

  select coalesce(sum(a.castka_haleru), 0)::integer into v_zalohy
  from public.advances a
  where a.employee_id = p_employee
    and a.stav <> 'stornovana'
    and a.business_date >= date_trunc('month', v_den)::date;

  select s.zaloha_max_haleru into v_max from app.nastaveni(p_tenant) s;

  if v_max is not null and p_castka > v_max then
    v_varovani := 'Firma má nastavenou horní mez ' || app.koruny(v_max)
      || ' a vyplácíte ' || app.koruny(p_castka) || '.';
  elsif coalesce(v_vydelano, 0) < v_zalohy + p_castka then
    v_varovani := 'Odpracováno zatím ' || app.koruny(coalesce(v_vydelano, 0))
      || ', po téhle záloze bude vyplaceno ' || app.koruny(v_zalohy + p_castka) || '.';
  end if;

  insert into public.advances
    (tenant_id, branch_id, employee_id, castka_haleru, business_date,
     vyplatil, poznamka)
  values (p_tenant, v_branch, p_employee, p_castka, v_den,
          (select auth.uid()), coalesce(btrim(p_poznamka), ''))
  returning id into v_id;

  perform app.audit(p_tenant, 'advance.vyplaceno', 'advance', v_id::text, v_branch,
                    null, jsonb_build_object('castka_haleru', p_castka,
                                             'varovani', v_varovani));

  -- 25. 9. 2026: přes Notification Service, ne přímým insertem — viz
  -- hlavička, bod 7. Tělo upozornění je stejné jako dřív.
  if v_uziv is not null then
    perform app.notifikovat(
      p_tenant, v_uziv, 'zaloha.vyplacena',
      jsonb_build_object('castka_haleru', p_castka, 'zaloha', v_id, 'den', v_den),
      'normal', v_branch, null, 'zaloha', v_id, null
    );
  end if;

  return query select v_id, v_varovani, coalesce(v_vydelano, 0);
end;
$$;


-- ---------------------------------------------------------------------
-- 8. ZÁLOHY POBOČKY — navíc JAK se potvrdilo
--
-- Tělo z 20260901220000 beze změny, na konci jeden sloupec navíc.
-- Drop + create, protože se mění výstupní sloupce (viz hlavička).
-- Granty se proto zakládají znovu, stejně jako tehdy.
-- ---------------------------------------------------------------------

drop function public.zalohy_pobocky(uuid, date, date, uuid);

create function public.zalohy_pobocky(
  p_tenant uuid,
  p_od     date,
  p_do     date,
  p_branch uuid default null
)
returns table (
  id            uuid,
  employee_id   uuid,
  jmeno         text,
  branch_id     uuid,
  castka_haleru integer,
  business_date date,
  stav          text,
  poznamka      text,
  storno_duvod  text,
  vyplaceno_kdy timestamptz,
  potvrzeno_kdy timestamptz,
  potvrzeno_jak text
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.employee_id, e.full_name, a.branch_id, a.castka_haleru,
         a.business_date, a.stav, a.poznamka, a.storno_duvod,
         a.vyplaceno_kdy, a.potvrzeno_kdy, a.potvrzeno_jak
  from public.advances a
  join public.employees e on e.id = a.employee_id
  where a.tenant_id = p_tenant
    and a.business_date between p_od and p_do
    and (p_branch is null or a.branch_id = p_branch)
    and (
      app.can_read_scoped(p_tenant, 'advances.manage', a.branch_id)
      or app.can_read_scoped(p_tenant, 'payroll.read', a.branch_id)
    )
  order by a.business_date desc, a.vyplaceno_kdy desc;
$$;

revoke all on function public.zalohy_pobocky(uuid, date, date, uuid) from public, anon;
grant execute on function public.zalohy_pobocky(uuid, date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 9. STORNO — zruší i čekající výzvu k potvrzení
--
-- Tělo z 20260901220000 (jiná definice od té doby není). JEDINÁ změna
-- je poslední `perform` — viz hlavička, bod 9. Kdo smí, důvod, hlášky,
-- zápis i audit jsou beze změny. Granty zůstávají z 20260901220000
-- (create or replace je nemění).
-- ---------------------------------------------------------------------

create or replace function public.stornovat_zalohu(
  p_tenant uuid,
  p_zaloha uuid,
  p_duvod  text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_zal public.advances;
begin
  select * into v_zal from public.advances a
  where a.id = p_zaloha and a.tenant_id = p_tenant;

  if not found then
    raise exception 'Taková záloha tu není.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'advances.manage', v_zal.branch_id) then
    raise exception 'Stornovat zálohu smí jen ten, kdo je vyplácí.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) = 0 then
    raise exception 'Napište důvod storna — bez něj se za měsíc nedá zjistit, co se stalo.'
      using errcode = 'check_violation';
  end if;

  if v_zal.stav = 'stornovana' then
    raise exception 'Tahle záloha je stornovaná už teď.' using errcode = 'check_violation';
  end if;

  update public.advances
     set stav = 'stornovana',
         storno_duvod = btrim(p_duvod),
         storno_kdy = now(),
         stornoval = (select auth.uid())
   where id = p_zaloha;

  perform app.audit(p_tenant, 'advance.storno', 'advance', p_zaloha::text,
                    v_zal.branch_id, jsonb_build_object('castka_haleru', v_zal.castka_haleru),
                    jsonb_build_object('duvod', btrim(p_duvod)));

  -- 25. 9. 2026: stornovanou nejde potvrdit, výzva k tomu nesmí pípnout.
  perform app.zrusit_vyzvu_k_zaloze(p_zaloha, 'Záloha je mezitím stornovaná.');
end;
$$;
