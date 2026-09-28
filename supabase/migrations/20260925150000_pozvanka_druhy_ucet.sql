-- =====================================================================
-- Foodtab — pozvánka nesmí potichu vyrobit člena bez záznamu v Lidech
--
-- Hlášení majitele 25. 9. 2026 14:38: „u zaměstnance Kateřina Jirášková
-- nelze přiřadit oprávnění, když přijme pozvánku … otevře se jen Moje
-- údaje … po kliknutí na profil se otevře jen nabídka Lidé … zobrazení
-- Nový člověk je špatně, mělo by tam být jméno nebo e-mail."
--
-- ---------------------------------------------------------------------
-- CO SE STALO (ověřeno čtením ostré databáze, jen SELECT)
--
-- Kateřina má DVA účty. První pozvánku (kat.jiraskova@email.cz) přijala
-- a její záznam v Lidech se s tím účtem propojil. Pak majitel poslal
-- čtyři pozvánky na druhou adresu (gmail) pro TENTÝŽ záznam. Přijetí
-- dělalo
--
--   update employees set user_id = <gmail> where … and user_id is null
--
-- — záznam už účet měl, takže se POTICHU nestalo nic. Členství ale
-- vzniklo. Gmailový účet byl člen firmy bez záznamu v Lidech, tedy bez
-- jediného práva: aplikace mu ukázala jen Moje údaje, a majiteli okno
-- „čeká na oprávnění" s odkazem, který obrazovka Lidé neuměla přečíst
-- (`?clovek=<id účtu>`, Lidé znají jen `?opravneni=<id zaměstnance>`).
--
-- Majitel tím evidentně chtěl PŘESUNOUT Kateřinin přístup na novou
-- adresu. To dnes nejde vůbec — a nejde to ani říct.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
-- A. Přijetí pozvánky pro konkrétního člověka se rozhodne DŘÍV, než
--    vznikne členství:
--      * záznam smazaný nebo z jiné firmy → chyba, nic se nezapíše;
--      * záznam bez účtu, nebo s mým účtem → jako dosud;
--      * záznam s JINÝM účtem → chyba „V téhle firmě už máte jiný účet
--        (k***@email.cz) …" a žádné členství — pokud pozvánka výslovně
--        nenese přesun (B);
--    A pro každou pozvánku, i BEZ člověka:
--      * můj účet už v téhle firmě patří jinému záznamu (živému i
--        smazanému) → chyba. Dřív to u pozvánky pro člověka spadlo
--        anglicky na jedinečnosti employees(tenant_id, user_id) — a u
--        pozvánky BEZ člověka to prošlo a přepsalo rozsah, pobočky
--        i stav členství toho, kdo v Lidech je. Bez stropu: vedoucí tak
--        rozšířil kolegovi rozsah nad svůj, vrátil pozastavené členství,
--        nebo majiteli zúžil rozsah na jednu pobočku (nezávislá kontrola
--        28. 9. 2026, staré od 1. 9.). U smazaného záznamu by vznikl
--        člen bez živého záznamu — přesně stav z hlášení.
--
-- B. PŘESUN ÚČTU NA NOVOU ADRESU. Pozvánka pro člověka, který už účet
--    má, na JINOU adresu, než má ten účet, je přesun. Vystaví ji JEN
--    MAJITEL (`app.is_owner`), nikdy pro záznam majitele (přesunout jeho
--    záznam na jiný účet by znamenalo předat firmu; přihlašovací adresu
--    aplikace měnit neumí — viz CO SE SCHVÁLNĚ NEDĚLÁ) a pozvánka si
--    pamatuje, který účet nahrazuje
--    (`invitations.nahrazuje_ucet`). Při přijetí se přepojí jen tehdy,
--    když má záznam POŘÁD TENTÝŽ starý účet; členství starého účtu se
--    POZASTAVÍ (ne smaže) a jde to do auditu. Docházka a směny visí na
--    zaměstnanci, ne na účtu, takže zůstávají.
--
--    Proč jen majitel, ne `people.manage`: vedoucí by si jinak pozvánkou
--    na svůj druhý účet převzal cizí záznam, i majitelův.
--
--    Pozvánka na TUTÉŽ adresu, jakou má propojený účet, přesun není
--    a vystaví ji dál každý se správou lidí (třeba po pozastaveném
--    členství).
--
-- C. Dvě díry na téže cestě, obě staré (od 23. 8.), a bez jejich zavření
--    by B bylo jen divadlo:
--      * `invitations` měla pro `authenticated` INSERT/UPDATE/DELETE
--        (plošný grant + politika pro `people.manage`, ověřeno i v ostré
--        databázi). Vedoucí by si pozvánku s `nahrazuje_ucet` na
--        majitelův záznam zapsal sám. Aplikace do tabulky nepíše —
--        pozvánky jdou jen přes `create_invitation` — takže se zápis
--        odebírá celý. Čtení zůstává po sloupcích jako dosud.
--      * `employees.user_id` šel přepsat přímým `update` každým, kdo má
--        `people.manage` (politika `employees_write` pouští celý řádek).
--        Vedoucí tak mohl odpojit majitele od jeho záznamu, nebo si na
--        cizí záznam připojit druhý účet — a strop to nehlídal, ten se
--        ptá jen na zařazení a majitelství. Od teď účet u existujícího
--        záznamu mění jen funkce s právy vlastníka (přijetí pozvánky).
--        Spoušť, ne sloupcový grant: aplikace do `employees` zapisuje
--        z pěti míst a vyjmenovat všechny ostatní sloupce je past na
--        příští nový sloupec. ZALOŽENÍ záznamu s účtem se nechává —
--        práva nového záznamu drží strop (zařazení i majitelství).
--
--    Protože pozvánky jdou od teď jen přes funkce, přibývá i jejich
--    ZRUŠENÍ (`public.zrusit_pozvanku`, oddíl 11). Dřív šlo jen přímým
--    zápisem `revoked_at` přes API — aplikace tlačítko neměla, a po
--    odebrání zápisu by vystavenou pozvánku nešlo stáhnout vůbec. To je
--    u přesunu nebezpečné: překlep v adrese platí sedm dní.
--
-- D. Okno „čeká na oprávnění" (`public.cekaji_na_opravneni`) vrací
--    i zaměstnance (živý záznam), jméno z Lidí (jinak ze smazaného
--    záznamu, profilu, e-mail účtu), kontakt účtu a DŮVOD:
--      bez_zaznamu | zaznam_smazany | bez_zarazeni | zarazeni_bez_prav
--    Kdo čeká, se počítá STEJNĚ jako dosud (20260925120000) — mění se
--    jen to, co se o něm vrací. Mění se návratový typ, proto drop.
--
--    Zkouška nanečisto 25. 9. 2026 (tělo funkce jako SELECT nad ostrou
--    databází, nic se nezapsalo): okno by ukázalo tři lidi — Vendy
--    (zařazení Obsluha brig. bez práv), Andrea Mikulová (Pom. kuch. bez
--    práv) a katarinajiraskova4@gmail.com (bez záznamu). Dva smazaní
--    (lucka, Láďa) mají členství pozastavené už ručně (audit 676, 677).
--
--    `public.odebrat_z_firmy` pozastaví členství účtu, který ve firmě
--    NEMÁ živý záznam (bez záznamu, nebo smazaný). Smí `people.manage`
--    za celou firmu. Majitele ani sebe odebrat nejde — obojí má živý
--    záznam (majitelství je `employees.je_majitel` na živém záznamu,
--    a kdo má `people.manage`, má živý záznam taky), takže to drží
--    táž jedna podmínka. Dvakrát napsaná by nešla shodit (skill scenar,
--    3b); krok61 obojí zkouší zvlášť.
--
--    `public.ucty_lidi` vrací ke každému živému záznamu zamaskovaný
--    kontakt jeho účtu (k***@email.cz) — obrazovka pozvánky podle toho
--    předem řekne, že jde o přesun.
--
-- E. Smazání člověka v Lidech (`deleted_at`) pozastaví i členství jeho
--    účtu; obnovení (`deleted_at` zpět na NULL) ho vrátí. Dřív zůstával
--    smazaný člověk členem firmy napořád (lucka 16. 9., Láďa 19. 9.).
--    Spoušť, ne akce v aplikaci: maže se i mimo tuhle obrazovku (import,
--    ruční oprava) a musí to být v téže transakci. Pojistka posledního
--    majitele (`trg_posledni_majitel_zamestnanec`) běží PŘED touhle
--    spouští, takže posledního majitele nesmaže ani tahle cesta.
--
--    Tím, že smazání bere přístup, přibyly tři zábrany (nezávislá
--    kontrola 28. 9. 2026):
--      * OBNOVENÍ vrací práva, a tak má strop: obnovit smí jen ten, kdo
--        by tomu člověku jeho práva směl přidělit (`smi_pridelit_
--        zamestnance`, za celou firmu — stejně opatrně jako přeřazení).
--        Jinak by vedoucí smazáním a obnovením vrátil přístup člověku,
--        kterému ho majitel pozastavil, i s právy, která sám nemá.
--      * Majitele v Lidech smaže jen majitel. Strop `deleted_at` nehlídá
--        a pojistka drží jen posledního majitele — vedoucí by druhého
--        majitele smazáním vyřadil z firmy úplně.
--      * Tvrdé smazání (`delete`) záznamu přes API se odebírá. Členství
--        by nepozastavilo (spoušť hlídá `deleted_at`) a s řádkem by
--        zmizelo nebo osiřelo, co na něm visí. Aplikace záznamy tvrdě
--        nemaže.
--
--    Důsledek, který je vidět: profil člověka s pozastaveným členstvím
--    kolegové nevidí (`profiles_select_colleagues` chce aktivní členství
--    na obou stranách). Autor starého oznámení na nástěnce, kterého
--    mezitím smazali, zůstane bez jména. Lidé, rozpis a docházka berou
--    jména ze záznamu zaměstnance a toho se to netýká. Na tomhle se
--    zasekl krok9 (obnovoval číšníka podle profilu) — upraven.
--
-- ---------------------------------------------------------------------
-- JEDEN ÚČET = NEJVÝŠ JEDEN ZÁZNAM VE FIRMĚ
--
-- `employees` má `unique (tenant_id, user_id)` na CELÉ tabulce, i přes
-- smazané řádky. Účet má tedy ve firmě nejvýš jeden záznam. Proto se
-- u přesunu (B) ani u smazání (E) nepíše podmínka „jen když nemá jiný
-- živý záznam" — nemá ho nikdy, a podmínka, která nemůže být nepravdivá,
-- nejde kontrolou shodit. krok61 místo toho hlídá, že ta jedinečnost
-- pořád platí. Kdyby se zúžila (`where deleted_at is null`), musí sem
-- ta podmínka přibýt.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Propojit účet „bez záznamu" s existujícím člověkem přímo z okna.
--   Šlo by to jednou funkcí, ale byla by to druhá cesta k témuž, co
--   dělá pozvánka — bez souhlasu toho účtu a bez kontroly adresy. Okno
--   místo toho odkáže na formulář pozvánky v Lidech a řekne, že
--   u člověka, který účet už má, je to přesun a vystaví ho majitel.
--   Otázka 18 v docs/hlaseni/otazky.md.
-- * Měnit PŘIHLAŠOVACÍ adresu účtu. Moje údaje mění kontakt v Lidech
--   (`employees.email`), ne účet, a nic v aplikaci účet nepřejmenuje.
--   Majiteli ji dnes změní jen správce Foodtabu. Otázka 18.
-- * Propojit účet, jehož záznam v Lidech je SMAZANÝ, s novým záznamem.
--   Přijetí to odmítne a řekne, že to vyřeší správce Foodtabu — obnova
--   smazaného v aplikaci není a přepojení by znamenalo sáhnout na
--   smazaný záznam. Otázka 18.
-- * Ostrá data se neopravují. Kateřina má dál dva účty. Majitel po
--   nasazení buď pošle novou pozvánku na gmail (přesun, B), nebo
--   gmailový účet v okně „Odebrat z firmy" (D) — obojí aplikací, žádné
--   ruční SQL.
-- * Zavřít přímý zápis do `memberships`. `people.manage` dál smí
--   členství jiných upravit i smazat přímo (politiky z 20260909100000),
--   takže `odebrat_z_firmy` je pohodlí s kontrolami, ne jediná cesta.
--   Otázka 18.
-- * `public.komu_ohlasit_prijeti` se neopravuje, i když `ceka` v něm
--   pořád čte `role_id` (od 9. 9. o ničem nerozhoduje). Je to e-mail
--   majiteli, ne okno; otázka 18.
-- * Hlášky „vystavena na jin…" v přijetí zůstávají slovo od slova —
--   obrazovka pozvánky podle nich nabízí přihlášení správnou adresou.
--   Nová hláška „už máte jiný účet" má na obrazovce vlastní větev podle
--   téhle věty (lib/prihlaseni.ts, `jeJinyUcet`) — neměnit bez ní.
--
-- Scénář: supabase/tests/krok61_scenar.sql.
-- =====================================================================


-- =====================================================================
-- 1. POZVÁNKA SI PAMATUJE, KTERÝ ÚČET NAHRAZUJE
--
-- `on delete set null`: kdyby se starý účet mezitím smazal, záznam
-- v Lidech ztratí účet taky (`employees.user_id` má totéž) a přijetí
-- ho prostě propojí — pozvánka k tomu byla vystavená.
-- =====================================================================

alter table public.invitations
  add column nahrazuje_ucet uuid references public.profiles(user_id) on delete set null;

comment on column public.invitations.nahrazuje_ucet is
  'Pozvánka k PŘESUNU: účet, který měl zaměstnanec při vystavení. Přijetí '
  'přepojí záznam jen tehdy, když ho má pořád. Vystavuje jen majitel.';

-- Čtení je po sloupcích (20260826180000). Bez tohohle by každý dotaz,
-- který sloupec vyjmenuje, spadl na 42501 celý.
grant select (nahrazuje_ucet) on public.invitations to authenticated;

-- Zápis jen přes `create_invitation` a přijetí (obě s právy vlastníka).
-- Hlavička, C.
revoke insert, update, delete on public.invitations from authenticated;


-- =====================================================================
-- 2. ZAMASKOVANÝ KONTAKT ÚČTU
--
-- „k***@email.cz" — dost na to, aby Kateřina poznala svou druhou
-- adresu, a málo na to, aby ji z hlášky vyčetl kdokoli, kdo drží cizí
-- odkaz. Bere se z `auth.users` (tím se člověk přihlašuje), ne
-- z profilu, který se od účtu může rozejít.
-- =====================================================================

create function app.zamaskuj_ucet(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when position('@' in coalesce(btrim(u.email), '')) > 1 then
      left(lower(btrim(u.email)), 1) || '***'
        || substr(lower(btrim(u.email)), position('@' in btrim(u.email)))
    when nullif(btrim(u.phone), '') is not null then
      '+' || left(ltrim(btrim(u.phone), '+'), 3) || ' *** *** ' || right(btrim(u.phone), 3)
  end
  from auth.users u
  where u.id = p_user;
$$;

comment on function app.zamaskuj_ucet(uuid) is
  'Kontakt účtu zkrácený na první znak a doménu (k***@email.cz), '
  'telefon na předvolbu a konec. Do hlášek a na obrazovku pozvánky.';

revoke all on function app.zamaskuj_ucet(uuid) from public, anon, authenticated;


-- =====================================================================
-- 3. JE TENHLE ÚČET MAJITELEM FIRMY?
--
-- Totéž jako `app.is_owner`, jen pro zadaný účet místo přihlášeného.
-- Ptá se ho přijetí pozvánky k přesunu: vystavil ji majitel, a je
-- majitelem pořád? (Druhá linie za `create_invitation` — viz oddíl 6.)
-- =====================================================================

create function app.je_majitel_uctu(p_tenant uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.employees e on e.user_id   = m.user_id
                           and e.tenant_id = p_tenant
                           and e.deleted_at is null
    where m.user_id = p_user
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and e.je_majitel
  );
$$;

comment on function app.je_majitel_uctu(uuid, uuid) is
  'Je účet majitelem téhle firmy? Jako app.is_owner, jen pro zadaný účet.';

revoke all on function app.je_majitel_uctu(uuid, uuid) from public, anon, authenticated;


-- =====================================================================
-- 4. ÚČET U EXISTUJÍCÍHO ZÁZNAMU MĚNÍ JEN PŘIJETÍ POZVÁNKY
--
-- `security invoker` schválně: `current_user` je tu role, pod kterou
-- příkaz běží. Z aplikace (PostgREST) je to `authenticated`; uvnitř
-- funkce s právy vlastníka (přijetí pozvánky, založení firmy) je to
-- vlastník a projde. Servisní klíč (`service_role`) projde taky — ten
-- obchází všechno a na server patří (pravidlo 6).
--
-- Jen UPDATE. Nový záznam s účtem jde dál založit: jeho práva hlídá
-- strop (`trg_strop_zarazeni`), kdežto přepojení existujícího záznamu
-- by vzalo práva, která mu dal někdo jiný — i majitelská.
-- =====================================================================

create function app.hlida_ucet_zamestnance()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     and current_user::text in ('authenticated', 'anon') then
    raise exception
      'Účet u člověka v Lidech se mění jen přijetím pozvánky. Na novou adresu ho přesune majitel novou pozvánkou.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function app.hlida_ucet_zamestnance() is
  'Spoušť: přímým zápisem z aplikace se účet u existujícího zaměstnance '
  'nepřepojí ani neodpojí. Dělá to jen přijetí pozvánky.';

revoke all on function app.hlida_ucet_zamestnance() from public, anon, authenticated;

create trigger trg_ucet_zamestnance
  before update of user_id on public.employees
  for each row execute function app.hlida_ucet_zamestnance();


-- =====================================================================
-- 5. VYSTAVENÍ POZVÁNKY
--
-- Z poslední definice (20260909100000_zarazeni_jadro.sql, oddíl 8),
-- porovnáno diffem. Mění se jen:
--   * u zaměstnance se čte i jeho účet a majitelství,
--   * za kontrolou adresy nový blok PŘESUN,
--   * `nahrazuje_ucet` do pozvánky i do auditu.
-- =====================================================================

create or replace function app.create_invitation(
  p_tenant     uuid,
  p_role       uuid,
  p_channel    text,
  p_contact    text,
  p_scope      text default 'branch',
  p_branches   uuid[] default '{}',
  p_employee   uuid default null,
  p_valid_days int default 7
)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_token     text;
  v_id        uuid;
  v_email     text;
  v_phone     text;
  v_sensitive boolean;
  v_ucet      uuid;
  v_majitel   boolean;
  v_nahrazuje uuid;
begin
  if not app.has_access(p_tenant, 'people.manage') then
    raise exception 'Zvát zaměstnance může jen správce lidí.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
    Role se pořád ukládá, ale nic neotevírá. Kontrola, že patří téhle
    firmě, zůstává: cizí `role_id` v tabulce je nepořádek, i když
    o ničem nerozhoduje.
  */
  if p_role is not null then
    if not exists (select 1 from public.roles where id = p_role and tenant_id = p_tenant) then
      raise exception 'Role nepatří této firmě.' using errcode = 'foreign_key_violation';
    end if;
  end if;

  if p_employee is not null then
    select e.user_id, e.je_majitel into v_ucet, v_majitel
    from public.employees e
    where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

    if not found then
      raise exception 'Zaměstnanec nepatří této firmě.'
        using errcode = 'foreign_key_violation';
    end if;

    -- Strop podle docs/pravidlo-neprideluj-vic.md. Bez tohohle by se
    -- politika na memberships obešla jednou pozvánkou.
    if not app.smi_pridelit_zamestnance(p_tenant, p_employee, p_scope, p_branches) then
      raise exception
        'Tohohle člověka nemůžete pozvat — jeho zařazení nese oprávnění, která sami nemáte.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_channel = 'email' then
    v_email := nullif(btrim(lower(p_contact)), '');
    if v_email is null or position('@' in v_email) = 0 then
      raise exception 'Neplatná e-mailová adresa.' using errcode = 'check_violation';
    end if;
  elsif p_channel = 'sms' then
    v_phone := nullif(btrim(p_contact), '');
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Telefon zadejte v mezinárodním tvaru, například +420601234567.'
        using errcode = 'check_violation';
    end if;

    /*
      Citlivé oprávnění nesmí být přístupné jen přes SMS. Přenesení čísla
      na cizí SIM je reálný útok a telefon navíc koluje po provozovně.
      Viz §7.1 specifikace.

      Ptá se to zaměstnance, protože od téhle chvíle práva nese on.
      Pozvánka BEZ zaměstnance neotevře nic — členství vznikne, ale
      `has_permission` mu nemá odkud práva vzít.

      Neptá se to `pravo_zive`: citlivé právo z vypnutého modulu dnes
      neotevírá nic, ale modul se zapíná jedním kliknutím a pozvánka
      platí sedm dní.
    */
    select p_employee is not null and (
      exists (select 1 from public.employees e
              where e.id = p_employee and e.je_majitel)
      or exists (
        select 1 from public.permissions p
        where p.sensitive
          and app.ma_pravo_clovek(p_tenant, p_employee, p.key)
      )
    ) into v_sensitive;

    if v_sensitive then
      raise exception
        'Člověka s citlivým oprávněním nejde pozvat přes SMS. Použijte e-mail.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'Neznámý způsob pozvánky: %', p_channel using errcode = 'check_violation';
  end if;

  /*
    PŘESUN ÚČTU (20260925150000, hlavička B).

    Člověk už účet má a pozvánka jde na JINOU adresu, než má ten účet
    — po přijetí by se přístup přestěhoval. Tutéž adresu (nové pozvání
    po pozastaveném členství) nic nepřesouvá a projde jako dosud.

    Majitele nikdy: přesunout jeho záznam na jiný účet by znamenalo
    předat firmu. Přihlašovací adresu aplikace měnit neumí (Moje údaje
    mění kontakt v Lidech, ne účet) — hláška proto posílá za správcem.
    A jen majitel: kdo má jen správu lidí, by si jinak pozvánkou na
    druhý účet převzal cizí záznam.
  */
  if v_ucet is not null and not exists (
    select 1 from auth.users u
    where u.id = v_ucet
      and (   (p_channel = 'email' and lower(btrim(u.email)) = v_email)
           or (p_channel = 'sms'   and '+' || ltrim(btrim(u.phone), '+') = v_phone))
  ) then
    if v_majitel then
      raise exception
        'Účet majitele se pozvánkou nepřesouvá. Přihlašovací adresu majitele zatím změní jen správce Foodtabu.'
        using errcode = 'insufficient_privilege';
    end if;

    if not app.is_owner(p_tenant) then
      raise exception
        'Tenhle člověk už ve Foodtabu má účet (%). Přesunout jeho přístup na jinou adresu může jen majitel.',
        coalesce(app.zamaskuj_ucet(v_ucet), 'bez adresy')
        using errcode = 'insufficient_privilege';
    end if;

    v_nahrazuje := v_ucet;
  end if;

  -- Pobočky musí patřit této firmě, jinak by šlo pozvánkou obejít rozsah.
  if array_length(p_branches, 1) is not null and exists (
    select 1 from unnest(p_branches) bid
    where not exists (select 1 from public.branches b
                      where b.id = bid and b.tenant_id = p_tenant)
  ) then
    raise exception 'Některá z poboček nepatří této firmě.'
      using errcode = 'foreign_key_violation';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations (
    tenant_id, role_id, employee_id, channel, email, phone,
    scope, branch_ids, token_hash, expires_at, invited_by, nahrazuje_ucet
  ) values (
    p_tenant, p_role, p_employee, p_channel, v_email, v_phone,
    p_scope, coalesce(p_branches, '{}'),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    now() + make_interval(days => greatest(p_valid_days, 1)),
    (select auth.uid()), v_nahrazuje
  ) returning id into v_id;

  perform app.audit(p_tenant, 'invitation.create', 'invitation', v_id::text, null, null,
                    jsonb_build_object('channel', p_channel, 'employee_id', p_employee,
                                       'nahrazuje_ucet', v_nahrazuje));

  return query select v_id, v_token;
end;
$$;


-- =====================================================================
-- 6. PŘIJETÍ POZVÁNKY
--
-- Z poslední definice (20260924130000_pozvanka_podle_uctu.sql),
-- porovnáno diffem. Mění se jen:
--   * nový blok ZÁZNAM V LIDECH mezi kontrolou kontaktu a členstvím —
--     rozhodne se v něm, jestli se smí pokračovat, dřív než se cokoli
--     zapíše (i u pozvánky bez člověka: účet, který v Lidech je);
--   * propojení záznamu na konci podle toho, co blok rozhodl, místo
--     tichého `… and user_id is null`.
-- =====================================================================

create or replace function app.prijmout_pozvanku(p_inv public.invitations)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_email    text;
  v_phone    text;
  v_member   uuid;
  v_bid      uuid;
  v_zaznam   uuid;
  v_puvodni  uuid;
  v_majitel  boolean;
  v_jiny     text;
  v_jiny_smazany boolean;
  v_presun   boolean := false;
begin
  if v_user is null then
    raise exception 'Nejdřív se přihlaste.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Účet nemá profil.' using errcode = 'insufficient_privilege';
  end if;

  if p_inv.id is null then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.revoked_at is not null then
    raise exception 'Pozvánka byla zrušena.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.accepted_at is not null then
    raise exception 'Pozvánka už byla použita.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.expires_at <= now() then
    raise exception 'Pozvánce vypršela platnost. Požádejte o novou.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Pozvánku nelze použít pod jiným kontaktem, než na jaký byla
  -- vystavena. Tohle je jediné, čím se ověří, že odkaz použil ten, komu
  -- byl poslaný — přeposlaný e-mail by jinak pustil do firmy kohokoli.
  --
  -- Kontakt je ten OVĚŘENÝ z účtu, ne z profilu. Profil si člověk dřív
  -- mohl přepsat sám (20260924130000, hlavička).
  select k.email, k.phone into v_email, v_phone from app.moje_overene_kontakty() k;

  if p_inv.channel = 'email' and v_email is distinct from p_inv.email then
    raise exception 'Pozvánka byla vystavena na jinou e-mailovou adresu.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_inv.channel = 'sms' and v_phone is distinct from p_inv.phone then
    raise exception 'Pozvánka byla vystavena na jiné telefonní číslo.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
    ZÁZNAM V LIDECH (20260925150000, hlavička A a B).

    Rozhoduje se tady, PŘED členstvím. Dřív se záznam propojoval až na
    konci podmínkou `user_id is null` — a když účet už měl, nestalo se
    nic a člověk zůstal členem bez jediného práva. Každá chyba níž
    zastaví přijetí celé: nevznikne členství a pozvánka zůstane
    nepoužitá.

    `for update`: mezi rozhodnutím a zápisem nesmí záznam přepojit nikdo
    jiný (druhé přijetí téže pozvánky ze dvou oken).
  */
  if p_inv.employee_id is not null then
    select e.id, e.user_id, e.je_majitel into v_zaznam, v_puvodni, v_majitel
    from public.employees e
    where e.id = p_inv.employee_id
      and e.tenant_id = p_inv.tenant_id
      and e.deleted_at is null
    for update;

    if v_zaznam is null then
      raise exception
        'Člověk, pro kterého byla pozvánka vystavená, už ve firmě v Lidech není. Požádejte o novou pozvánku.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  /*
    Přihlášený účet už v téhle firmě patří JINÉMU záznamu, než pro který
    je pozvánka — u pozvánky BEZ člověka jakémukoli (živému i smazanému;
    jedinečnost employees(tenant_id, user_id) platí přes celou tabulku,
    takže je nejvýš jeden).

    Dřív to u pozvánky pro člověka spadlo anglicky na té jedinečnosti.
    U pozvánky bez člověka to prošlo a upsert níž přepsal rozsah,
    pobočky i stav členství člověka, který v Lidech je — bez stropu
    (hlavička A). Tutéž pozvánku pro JEHO záznam (`e.id = v_zaznam`)
    se tu nezastavuje: to je obyčejné nové pozvání téhož účtu.
  */
  select e.full_name, e.deleted_at is not null into v_jiny, v_jiny_smazany
  from public.employees e
  where e.tenant_id = p_inv.tenant_id
    and e.user_id = v_user
    and e.id is distinct from v_zaznam;

  if found then
    if v_jiny_smazany then
      raise exception
        'Váš účet ve firmě patří k člověku, který je v Lidech smazaný (%). Tuhle pozvánku jím přijmout nejde — majitel to musí vyřešit se správcem Foodtabu.',
        v_jiny
        using errcode = 'check_violation';
    end if;

    raise exception
      'Váš účet už ve firmě patří k člověku v Lidech (%). Tuhle pozvánku jím přijmout nejde. Když vám v aplikaci něco chybí, ozvěte se majiteli.',
      v_jiny
      using errcode = 'check_violation';
  end if;

  if v_puvodni is not null and v_puvodni <> v_user then
    if p_inv.nahrazuje_ucet is null then
      -- Tuhle větu pozná obrazovka pozvánky (lib/prihlaseni.ts,
      -- `jeJinyUcet`) — neměnit bez ní.
      raise exception
        'V téhle firmě už máte jiný účet (%). Přihlaste se jím, nebo požádejte majitele o novou pozvánku.',
        coalesce(app.zamaskuj_ucet(v_puvodni), 'bez adresy')
        using errcode = 'check_violation';
    end if;

    if p_inv.nahrazuje_ucet is distinct from v_puvodni then
      raise exception
        'U tohohle člověka se mezitím změnil účet, takže pozvánka už neplatí. Požádejte majitele o novou.'
        using errcode = 'check_violation';
    end if;

    /*
      Druhá linie za `create_invitation`. Pozvánky jdou od téhle
      migrace zapsat jen přes ni — kdyby se ale zápis do tabulky
      jednou vrátil (plošný grant), nesmí z toho být převzetí
      cizího záznamu. A kdo mezitím přestal být majitelem, přesun
      nepotvrdí.
    */
    if v_majitel then
      raise exception 'Účet majitele se pozvánkou nepřesouvá.'
        using errcode = 'insufficient_privilege';
    end if;

    if not app.je_majitel_uctu(p_inv.tenant_id, p_inv.invited_by) then
      raise exception
        'Přesun účtu na novou adresu potvrzuje majitel firmy. Požádejte ho o novou pozvánku.'
        using errcode = 'insufficient_privilege';
    end if;

    v_presun := true;
  end if;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (p_inv.tenant_id, v_user, p_inv.role_id, 'active', p_inv.scope)
  on conflict (tenant_id, user_id) do update
    set role_id = coalesce(excluded.role_id, public.memberships.role_id),
        status  = 'active',
        scope   = excluded.scope
  returning id into v_member;

  delete from public.membership_branches where membership_id = v_member;
  foreach v_bid in array coalesce(p_inv.branch_ids, '{}') loop
    insert into public.membership_branches (membership_id, branch_id)
    values (v_member, v_bid) on conflict do nothing;
  end loop;

  /*
    Zaměstnanecký záznam už mohl existovat bez účtu (brigádník, kterého
    se nakonec rozhodli pustit do aplikace). Teď se propojí.

    Přesun: záznam dostane nový účet a starý účet ve firmě končí.
    Členství se POZASTAVÍ, nesmaže — v auditu i v datech zůstane, že
    tu byl, a novou pozvánkou se dá vrátit. Jiný živý záznam ve firmě
    starý účet mít nemůže (jedinečnost, hlavička).
  */
  if v_zaznam is not null and v_puvodni is distinct from v_user then
    update public.employees
      set user_id = v_user
      where id = v_zaznam;

    if v_presun then
      update public.memberships
        set status = 'suspended'
        where tenant_id = p_inv.tenant_id
          and user_id = v_puvodni;

      perform app.audit(p_inv.tenant_id, 'employee.ucet_presunut', 'employee', v_zaznam::text,
                        null,
                        jsonb_build_object('user_id', v_puvodni),
                        jsonb_build_object('user_id', v_user, 'invitation_id', p_inv.id));
    end if;
  end if;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
    where id = p_inv.id;

  perform app.audit(p_inv.tenant_id, 'invitation.accept', 'membership', v_member::text);

  /*
    Upozornění až úplně nakonec a ve vlastním bloku. Kdyby spadlo,
    členství už je zapsané a přijetí projde — o tom, jestli se člověk
    dostane do firmy, nesmí rozhodovat zvoneček.
  */
  begin
    perform app.upozorni_na_prijeti(p_inv.tenant_id, v_user);
  exception when others then
    null;
  end;

  return p_inv.tenant_id;
end;
$$;

revoke all on function app.prijmout_pozvanku(public.invitations) from public, anon, authenticated;


-- =====================================================================
-- 7. SMAZÁNÍ ČLOVĚKA POZASTAVÍ JEHO ČLENSTVÍ, OBNOVENÍ HO VRÁTÍ
--
-- `security definer`: maže ten, kdo spravuje lidi, a politika
-- `memberships_update` by mu cizí členství pustila jen pod stropem —
-- smazání by pak u bohatšího člověka tiše nezastavilo nic.
--
-- Stav členství se schválně nefiltruje: zápis téže hodnoty nic
-- nezmění a audit (`app.audit_zmenu`) ho vynechá. Podmínka navíc by
-- nešla kontrolou shodit (skill scenar, 3b).
--
-- OBNOVENÍ MÁ STROP. Vrací práva — ze zařazení, výjimek i majitelství
-- — a vrací i členství pozastavené jinak (majitelem, „Odebrat z firmy").
-- Obnovit proto smí jen ten, kdo by tomu člověku jeho práva směl
-- přidělit: `app.smi_pridelit_zamestnance` za CELOU firmu, stejně
-- opatrně jako strop na přeřazení (`app.hlida_strop_zarazeni`). Bez
-- toho by vedoucí smazáním a obnovením vrátil přístup člověku, kterému
-- ho majitel pozastavil — i s právy, která sám nemá (nezávislá kontrola
-- 28. 9. 2026: PATCH přes API to pustil každému se správou lidí).
--
-- Proto AFTER, ne BEFORE: strop se ptá na živá práva obnovovaného
-- člověka a ta vidí až obnovený řádek. Chyba vrátí celé obnovení.
--
-- Bez přihlášeného (migrace, servisní klíč, test pod `reset role`) není
-- proti komu strop měřit — jako u `hlida_strop_zarazeni`.
--
-- Obnovit v aplikaci dnes nejde vůbec (otázka 18 e); tahle cesta je
-- přímý zápis přes API nebo ruční oprava v databázi.
-- =====================================================================

create function app.clenstvi_podle_zaznamu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.memberships
      set status = 'suspended'
      where tenant_id = new.tenant_id
        and user_id = new.user_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if (select auth.uid()) is not null
       and not app.smi_pridelit_zamestnance(new.tenant_id, new.id, 'tenant') then
      raise exception
        'Obnovit člověka s oprávněními, která sami nemáte, nemůžete. Požádejte majitele.'
        using errcode = 'insufficient_privilege';
    end if;

    update public.memberships
      set status = 'active'
      where tenant_id = new.tenant_id
        and user_id = new.user_id;
  end if;

  return null;
end $$;

comment on function app.clenstvi_podle_zaznamu() is
  'Spoušť: smazaný člověk v Lidech přestane být členem firmy '
  '(pozastavené členství), obnovený se jím zase stane. Obnovit smí jen '
  'ten, kdo by mu jeho práva směl přidělit.';

revoke all on function app.clenstvi_podle_zaznamu() from public, anon, authenticated;

create trigger trg_clenstvi_podle_zaznamu
  after update of deleted_at on public.employees
  for each row execute function app.clenstvi_podle_zaznamu();


/*
  MAJITELE V LIDECH SMAŽE JEN MAJITEL.

  Strop (`hlida_strop_zarazeni`) se na `deleted_at` neptá a pojistka
  (`trg_posledni_majitel_zamestnanec`) drží jen POSLEDNÍHO majitele.
  Dokud smazání bralo jen majitelství, byla to díra na papíře; od téhle
  migrace smazání pozastaví i členství — vedoucí by druhého majitele
  z firmy vyřadil úplně.

  BEFORE, ne AFTER: majitel, který maže sám sebe (a není poslední), je
  majitelem jen do té chvíle — po změně by `app.is_owner` neprošel.
*/
create function app.hlida_smazani_majitele()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and old.je_majitel
     and (select auth.uid()) is not null
     and not app.is_owner(new.tenant_id) then
    raise exception 'Majitele v Lidech smaže jen majitel.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function app.hlida_smazani_majitele() is
  'Spoušť: smazat v Lidech majitele smí jen majitel.';

revoke all on function app.hlida_smazani_majitele() from public, anon, authenticated;

create trigger trg_smazani_majitele
  before update of deleted_at on public.employees
  for each row execute function app.hlida_smazani_majitele();


/*
  TVRDÉ SMAZÁNÍ ZÁZNAMU PŘES API SE ODEBÍRÁ.

  Aplikace maže jen `deleted_at` (smazatZamestnance). `delete` by
  členství nepozastavil (spoušť výš hlídá `deleted_at`), účet by zůstal
  členem bez záznamu — stav z hlášení — a s řádkem by zmizelo nebo
  osiřelo, co na něm visí (část cizích klíčů maže kaskádou, jinde se
  odkaz vynuluje). Grant měl `authenticated` z plošného
  `grant all` (20260823120200) a politika `employees_write` platí pro
  všechny operace.
*/
revoke delete on public.employees from authenticated;


-- =====================================================================
-- 8. KDO ČEKÁ NA OPRÁVNĚNÍ — i s tím, PROČ
--
-- Kdo čeká, se počítá stejně jako v 20260925120000: je ve firmě
-- (aktivní členství) a nemá odkud vzít ani jedno právo. Nové je, co se
-- o něm vrací:
--
--   jmeno        z Lidí (i ze smazaného záznamu) → z profilu → kontakt
--                účtu. „Nový člověk" jen tam, kde není vůbec nic.
--   employee_id  jen ŽIVÝ záznam — na smazaný se oprávnění nepřidělují.
--   kontakt      e-mail účtu (telefon, když e-mail nemá). Vidí ho jen
--                správce lidí za celou firmu — na tom stojí celá funkce.
--   duvod        bez_zaznamu | zaznam_smazany | bez_zarazeni
--                | zarazeni_bez_prav
--
-- Záznam je nejvýš jeden (jedinečnost, hlavička), takže `left join`
-- řádky nezdvojí.
--
-- `security definer` bez druhé linie: firma se filtruje u členství,
-- záznamu, zařazení i práv zvlášť (docs/zarazeni-misto-roli-nalezy.md,
-- 7b). Každý ten filtr má v krok61 vlastní kontrolu s cizí firmou.
-- =====================================================================

drop function public.cekaji_na_opravneni(uuid);

create function public.cekaji_na_opravneni(p_tenant uuid)
returns table (
  user_id     uuid,
  jmeno       text,
  od          timestamptz,
  employee_id uuid,
  kontakt     text,
  duvod       text,
  zarazeni    text,
  zarazeni_id uuid
)
language sql stable security definer set search_path = ''
as $$
  select
    m.user_id,
    coalesce(nullif(btrim(e.full_name), ''),
             nullif(btrim(p.full_name), ''),
             nullif(btrim(u.email), ''),
             nullif(btrim(u.phone), ''),
             'Nový člověk'),
    m.created_at,
    case when e.deleted_at is null then e.id end,
    coalesce(nullif(btrim(u.email), ''), nullif(btrim(u.phone), '')),
    case
      when e.id is null             then 'bez_zaznamu'
      when e.deleted_at is not null then 'zaznam_smazany'
      when e.position_id is null    then 'bez_zarazeni'
      else                               'zarazeni_bez_prav'
    end,
    po.label,
    po.id
  from public.memberships m
  join public.profiles p        on p.user_id = m.user_id
  left join auth.users u        on u.id = m.user_id
  left join public.employees e  on e.user_id = m.user_id
                               and e.tenant_id = p_tenant
  left join public.positions po on po.id = e.position_id
                               and po.tenant_id = p_tenant
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and not (
      e.id is not null
      and e.deleted_at is null
      and (
        e.je_majitel
        or exists (select 1 from public.position_permissions pp
                    where pp.position_id = e.position_id
                      and pp.tenant_id = p_tenant)
        or exists (select 1 from public.employee_permissions ep
                    where ep.employee_id = e.id and ep.granted
                      and ep.tenant_id = p_tenant)
      )
    )
    and app.has_access(p_tenant, 'people.manage')
  order by m.created_at;
$$;

comment on function public.cekaji_na_opravneni(uuid) is
  'Kdo je ve firmě, ale nemá odkud vzít ani jedno právo — a proč: bez '
  'záznamu v Lidech, se smazaným záznamem, bez zařazení, nebo se '
  'zařazením bez práv. Pro okno při přihlášení a Lidi.';

revoke all on function public.cekaji_na_opravneni(uuid) from public, anon;
grant execute on function public.cekaji_na_opravneni(uuid) to authenticated;


-- =====================================================================
-- 9. ODEBRAT Z FIRMY
--
-- Pro účet, se kterým se v Lidech nedá nic udělat: nepatří k nikomu
-- (bez záznamu), nebo jeho člověk je smazaný. Pozastaví členství —
-- nemaže ho, novou pozvánkou se vrací.
--
-- Kdo má ve firmě živý záznam, se tudy neodebírá: smaže se v Lidech
-- (a spoušť z oddílu 7 členství pozastaví). Tím jsou venku i majitel
-- a volající sám — viz hlavička, D.
-- =====================================================================

create function public.odebrat_z_firmy(p_tenant uuid, p_user uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member uuid;
begin
  if not app.has_access(p_tenant, 'people.manage') then
    raise exception 'Odebírat lidi z firmy může jen ten, kdo spravuje lidi za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.employees e
    where e.tenant_id = p_tenant
      and e.user_id = p_user
      and e.deleted_at is null
  ) then
    raise exception
      'Tenhle účet patří k člověku v Lidech. Z firmy ho odeberete tak, že ho v Lidech smažete.'
      using errcode = 'check_violation';
  end if;

  update public.memberships
    set status = 'suspended'
    where tenant_id = p_tenant
      and user_id = p_user
      and status = 'active'
    returning id into v_member;

  if v_member is null then
    raise exception 'Tenhle účet už ve firmě aktivní není.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform app.audit(p_tenant, 'membership.odebrano', 'membership', v_member::text,
                    null,
                    jsonb_build_object('user_id', p_user, 'status', 'active'),
                    jsonb_build_object('user_id', p_user, 'status', 'suspended'));
end;
$$;

comment on function public.odebrat_z_firmy(uuid, uuid) is
  'Pozastaví členství účtu, který ve firmě nemá živý záznam v Lidech. '
  'Pro okno „čeká na oprávnění". Smí správce lidí za celou firmu.';

revoke all on function public.odebrat_z_firmy(uuid, uuid) from public, anon;
grant execute on function public.odebrat_z_firmy(uuid, uuid) to authenticated;


-- =====================================================================
-- 10. ÚČTY LIDÍ, ZAMASKOVANĚ
--
-- Pro formulář pozvánky v Lidech: u člověka, který účet už má, se
-- předem řekne, jaký (k***@email.cz) a že nová adresa znamená přesun.
-- Jen živé záznamy a jen správci lidí za celou firmu — stejné právo,
-- jaké chce `create_invitation`.
-- =====================================================================

create function public.ucty_lidi(p_tenant uuid)
returns table (employee_id uuid, ucet text)
language sql stable security definer set search_path = ''
as $$
  select e.id, app.zamaskuj_ucet(e.user_id)
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and e.user_id is not null
    and app.has_access(p_tenant, 'people.manage');
$$;

comment on function public.ucty_lidi(uuid) is
  'Zamaskovaný kontakt účtu u každého živého člověka s účtem. Pro '
  'formulář pozvánky; jen pro správce lidí za celou firmu.';

revoke all on function public.ucty_lidi(uuid) from public, anon;
grant execute on function public.ucty_lidi(uuid) to authenticated;


-- =====================================================================
-- 11. ZRUŠIT POZVÁNKU
--
-- Zápis do `invitations` se v oddílu 1 odebral celý, tak i zrušení jde
-- přes funkci. Pozvánka se nemaže — dostane `revoked_at` a přijetí ji
-- odmítne („Pozvánka byla zrušena."), jako dosud.
--
-- Kdo smí: správce lidí za celou firmu (stejné právo, jaké chce
-- `create_invitation`). Pozvánku k PŘESUNU (`nahrazuje_ucet`) jen
-- majitel — přesun je jeho rozhodnutí a vedoucí by mu ho jinak potichu
-- stáhl. Obyčejnou pozvánku zruší i vedoucí: zrušením nikomu nic nedá.
--
-- `security definer` bez druhé linie: firma se filtruje u pozvánky
-- (`i.tenant_id = p_tenant`) — jinak by správce jedné firmy rušil
-- pozvánky druhé. krok61 to zkouší s majitelem cizí firmy.
-- =====================================================================

create function public.zrusit_pozvanku(p_tenant uuid, p_pozvanka uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if not app.has_access(p_tenant, 'people.manage') then
    raise exception 'Rušit pozvánky může jen ten, kdo spravuje lidi za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv
  from public.invitations i
  where i.id = p_pozvanka
    and i.tenant_id = p_tenant
  for update;

  if v_inv.id is null then
    raise exception 'Takovou pozvánku ve firmě nemáte.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'Pozvánka už byla přijatá — zrušit ji nejde.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'Pozvánka už je zrušená.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_inv.nahrazuje_ucet is not null and not app.is_owner(p_tenant) then
    raise exception 'Pozvánku, která přesouvá účet na jinou adresu, zruší jen majitel.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.invitations
    set revoked_at = now()
    where id = v_inv.id;

  perform app.audit(p_tenant, 'invitation.revoke', 'invitation', v_inv.id::text, null, null,
                    jsonb_build_object('employee_id', v_inv.employee_id,
                                       'nahrazuje_ucet', v_inv.nahrazuje_ucet));
end;
$$;

comment on function public.zrusit_pozvanku(uuid, uuid) is
  'Zruší čekající pozvánku (revoked_at). Správce lidí za celou firmu; '
  'pozvánku k přesunu účtu jen majitel.';

revoke all on function public.zrusit_pozvanku(uuid, uuid) from public, anon;
grant execute on function public.zrusit_pozvanku(uuid, uuid) to authenticated;
