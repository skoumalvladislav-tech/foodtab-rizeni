-- =====================================================================
-- Foodtab — modul Komunikace, krok A: doručení podle píchnutí
--
-- Zadání docs/nocni-prace-komunikace-2026-09-05.md, krok A. Bez
-- obrazovek — ty jsou krok B. Tenhle krok jde nasadit sám.
--
-- Staví na 20260903100000_komunikace_zaklad.sql (tabulky, RLS, práva).
-- Tam se zakládat nic nebude; tady přibývají PRAVIDLA a průzory, kterými
-- se do těch tabulek vůbec dá psát — přímý zápis je tam odepřený.
--
-- ---------------------------------------------------------------------
-- PROČ TO PRAVIDLO EXISTUJE — NEZJEDNODUŠOVAT
--
-- Šéfíkovo pravidlo: vzkazy pracovníkům přijdou až po píchnutí na směnu.
-- Není to zdvořilost, je to ochrana zaměstnavatele před mzdovým
-- závazkem. Výslovné „právo být offline“ v ČR neexistuje; ochrana plyne
-- z § 78 ZP, který dělí čas na pracovní dobu a odpočinek. Rozhodující je
-- test z judikatury SDEU: MUSÍ-LI ZAMĚSTNANEC REAGOVAT VE VELMI KRÁTKÉ
-- LHŮTĚ, JDE UŽ O PRACOVNÍ DOBU, ne o pohotovost.
--
-- Aplikace, která zvoní mimo směnu a čeká rychlou reakci, tedy vyrábí
-- nárok na mzdu. Kdo sem někdy přijde s tím, že „stačí posílat všechno
-- hned, je to jednodušší“, mění tím právní postavení firmy, ne jen kód.
--
-- Rešerše k tomu zjistila druhou věc: NIKDO TO TAK NEDĚLÁ. Ze 7shifts,
-- Deputy, Connecteam, Homebase, Crunchtime ani Jolt nemá doručení
-- vázané na směnu žádný. Deputy umí cílit na „members currently on
-- shift“, ale to je omezení odesílatele, ne ochrana příjemce. Není to
-- tedy nedodělek, který ostatní mají hotový — je to rozdíl.
--
-- ---------------------------------------------------------------------
-- CO PRAVIDLO NEDĚLÁ
--
-- NESCHOVÁVÁ OBSAH. Kdo si sám otevře aplikaci mimo směnu, zprávy si
-- přečte — pravidlo chrání před vyrušením, ne před informací
-- (docs/komunikace-zadani.md, oddíl 1). Kdybychom obsah zamkli,
-- napíše si člověk kolegovi na WhatsApp a modul se obejde celý.
-- Proto se tady nic nezamyká; jen se rozlišuje, co se smí OZNÁMIT.
-- =====================================================================


-- ---------------------------------------------------------------------
-- NEJDŘÍV DÍRA, KTERÁ SE NAŠLA PŘI PSANÍ ZÁPORNÉ KONTROLY
--
-- `20260903100000` pověsila na `konverzace_zpravy` obecnou spoušť
-- `app.audit_zmenu('konverzace_zprava')`. Ta zapisuje do auditu CELÝ
-- řádek přes `to_jsonb(new)` — a v tom řádku je sloupec `text`.
--
-- Audit se přitom čte úplně jinak než konverzace:
--
--     create policy audit_select on public.audit_log for select
--       using (app.has_access(tenant_id, 'settings.manage')
--           or app.has_access(tenant_id, 'agents.manage'));
--
-- Takže: RLS na konverzacích poctivě brání tomu, aby si majitel přečetl
-- stížnost, která byla napsaná na něj — a o dvě tabulky vedle mu ji
-- audit vydá celou, protože majitel má `settings.manage`. Druhá obranná
-- linie tady nechránila nic; jen to tak vypadalo.
--
-- Našlo se to tím, že kontrola „text zprávy v auditu není“ napsaná na
-- MOJI naléhavou hlášku prošla — a při pohledu do tabulky vedle ní
-- ležel tentýž text kompletní. Přesně ten druh kontroly, který se tváří
-- jako důkaz.
--
-- Náprava: vlastní spoušť, která zapisuje všechno kromě textu. Že
-- zpráva vznikla, kdo ji napsal, jestli byla naléhavá a kdo ji stáhl,
-- v auditu zůstává — obsah ne. Audit má být důkaz o JEDNÁNÍ, ne kopie
-- toho nejcitlivějšího, co v aplikaci je.
-- ---------------------------------------------------------------------

create or replace function app.audit_zpravy()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- `- 'text'` je celý ten rozdíl. Odebírá se z OBOU stran, jinak by
  -- obsah unikl přes `before` u opravy nebo u storna.
  v_radek jsonb := to_jsonb(coalesce(new, old)) - 'text';
  v_stary jsonb := case when old is null then null else to_jsonb(old) - 'text' end;
  v_novy  jsonb := case when new is null then null else to_jsonb(new) - 'text' end;
begin
  if not exists (
    select 1 from public.tenants t where t.id = (v_radek ->> 'tenant_id')::uuid
  ) then
    -- Kaskádové mazání firmy: audit k firmě, která už neexistuje,
    -- by spadl na cizím klíči a shodil by celé rušení.
    return null;
  end if;

  perform app.audit(
    p_tenant      => (v_radek ->> 'tenant_id')::uuid,
    p_action      => 'konverzace_zprava.' || lower(tg_op),
    p_entity_type => 'konverzace_zprava',
    p_entity_id   => v_radek ->> 'id',
    p_before      => v_stary,
    p_after       => v_novy
  );
  return null;
end;
$$;

comment on function app.audit_zpravy() is
  'Audit zpráv BEZ jejich textu. Obecná app.audit_zmenu zapisovala celý '
  'řádek, takže si obsah cizí konverzace přečetl každý se settings.manage '
  '— a to je přesně to, čemu má RLS na konverzacích bránit.';

drop trigger if exists trg_audit_zprav on public.konverzace_zpravy;
create trigger trg_audit_zprav
  after insert or update or delete on public.konverzace_zpravy
  for each row execute function app.audit_zpravy();


-- ---------------------------------------------------------------------
-- JSEM TEĎ NA SMĚNĚ? A KDE?
--
-- Nepočítá se to znovu. Otevřená směna = otevřený příchod z
-- app.otevreny_prichod (20260905010000): poslední `in`, po kterém
-- v témže provozním dni nepřišel `out`. Dvě různá „otevřeno“ by se
-- časem rozešla a rozdíl by se hledal v mzdách.
--
-- Vrací POBOČKU, ne ano/ne. Kdo dělá na víc pobočkách, dostane při
-- píchnutí zprávy té pobočky, kde píchl — ne ze všech.
-- ---------------------------------------------------------------------

create or replace function app.smena_ted(p_tenant uuid, p_employee uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.branch_id from app.otevreny_prichod(p_tenant, p_employee) o;
$$;

comment on function app.smena_ted(uuid, uuid) is
  'Pobočka, na které má člověk otevřený příchod. NULL = není na směně. '
  'Otevřený příchod se bere z app.otevreny_prichod, nepočítá se znovu.';

revoke all on function app.smena_ted(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SAMO PRAVIDLO O DORUČENÍ
--
-- Schválně samostatná funkce, ne podmínka rozepsaná na třech místech.
-- Až přibude kiosek (krok E) a obrazovka (krok B), budou se ptát TÉHLE
-- funkce. Pravidlo, které je opsané třikrát, se třikrát rozejde.
--
-- `immutable`: rozhoduje jen ze svých argumentů, žádné čtení tabulek.
-- Díky tomu se dá vyzkoušet přímo, bez zakládání docházky — a záporná
-- větev („mimo směnu se nedoručí“) se dá ověřit jedním selectem.
-- ---------------------------------------------------------------------

create or replace function app.doruci_se(
  p_na_smene    uuid,   -- pobočka otevřeného příchodu, NULL = mimo směnu
  p_konv_branch uuid,   -- pobočka konverzace, NULL = není pobočková
  p_nalehava    boolean
)
returns boolean
language sql immutable
as $$
  select
    -- Naléhavá pravidlo obchází. „Zítra máme zavřeno, nechoďte“ musí
    -- dorazit hned; kdyby čekalo na píchnutí, dorazí ve chvíli, kdy už
    -- je pozdě. Cenu za tu výjimku platí odesílatel: právo
    -- communication.urgent, viditelné označení a zápis do auditu se
    -- jménem. Bez toho by se naléhavé stalo výchozím a přestalo by
    -- cokoli znamenat.
    coalesce(p_nalehava, false)
    or (
      p_na_smene is not null
      and (
        -- Nepobočková konverzace (osobní, vedení, mezi pobočkami) se
        -- doručí, ať člověk píchl kdekoli.
        p_konv_branch is null
        -- Pobočková jen tam, kde píchl.
        or p_konv_branch = p_na_smene
      )
    );
$$;

comment on function app.doruci_se(uuid, uuid, boolean) is
  'Smí se ta zpráva TEĎ oznámit? Jediné místo, kde je Šéfíkovo pravidlo '
  'o doručení po píchnutí zapsané. Nepřepisovat jinde — viz hlavičku '
  'migrace, důvod je v § 78 ZP, ne v pohodlí.';

grant execute on function app.doruci_se(uuid, uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- MOJE ZAMĚSTNANECKÉ ID V TÉ FIRMĚ
--
-- Opakuje se v každém průzoru níž. Vlastní funkce proto, aby se
-- podmínka `deleted_at is null` nedala někde zapomenout.
-- ---------------------------------------------------------------------

create or replace function app.muj_employee(p_tenant uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
  limit 1;
$$;

comment on function app.muj_employee(uuid) is
  'Zaměstnanecký záznam přihlášeného uživatele v té firmě. NULL, když '
  'žádný nemá (brigádník bez účtu ho má, ale bez user_id).';

revoke all on function app.muj_employee(uuid) from public, anon;
grant execute on function app.muj_employee(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- CO MI CHODÍ A CO ČEKÁ
--
-- `security definer` je tu nutnost, ne pohodlí: `precteno_do` se
-- schválně NEUDĚLUJE ani vlastníkovi řádku (20260903100000), takže si
-- nepřečtené nikdo spočítat sám nemůže. Funkce proto počítá za něj —
-- a vrací jen čísla, nikdy cizí čas přečtení.
--
-- POZOR NA SECURITY DEFINER: obchází RLS. Proto se tady nikdy nebere
-- konverzace z parametru. Vrací se výhradně to, čeho je přihlášený
-- člověk účastníkem; cizí id se sem nedá podstrčit, protože se žádné
-- nepřijímá.
--
-- Pořadí: NEPŘEČTENÉ NAHOŘE, OD NEJSTARŠÍHO. Převzato z Deputy
-- (*„Posts that have not been confirmed will always be shown at the
-- top of the News Feed, sorted by oldest to newest“*). Číšník má na
-- aplikaci třicet vteřin před směnou; hledat nemá kdy. Řadí se tady
-- v databázi schválně — obrazovka to pak nemůže splést.
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
  -- Kolik z nepřečtených JEŠTĚ ČEKÁ na píchnutí. Rozdíl proti
  -- `neprectenych` je to, co se smí oznámit.
  ceka          integer,
  uzavreno_kdy  timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with ja as (
    select app.muj_employee(p_tenant) as emp
  ),
  smena as (
    select app.smena_ted(p_tenant, (select emp from ja)) as pobocka
  ),
  moje as (
    select k.*, u.precteno_do
    from public.konverzace k
    join public.konverzace_ucastnici u
      on u.konverzace_id = k.id
     and u.employee_id = (select emp from ja)
     and u.odesel_kdy is null
    where k.tenant_id = p_tenant
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
    -- Vypnutý modul odmítne i přímé volání (pravidlo 5). Nestačí, že
    -- obrazovka nebude v nabídce.
    app.modul_zapnuty(p_tenant, 'provoz')
    -- A bez zaměstnaneckého záznamu není co vracet. Bez téhle podmínky
    -- by `emp` bylo NULL, spojení by nedalo nic — ale spoléhat na to,
    -- že prázdno vznikne samo, je přesně ten druh mlčení, po kterém
    -- se díra hledá půl roku.
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
  'Moje rozhovory s počtem nepřečtených a s tím, kolik z nich ještě '
  'čeká na píchnutí. Nepřečtené nahoře, od nejstaršího (Deputy). '
  'Konverzaci z parametru schválně nepřijímá — security definer obchází '
  'RLS a cizí id by tudy prošlo.';

revoke all on function public.moje_rozhovory(uuid) from public, anon;
grant execute on function public.moje_rozhovory(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- KOLIK MI TOHO ČEKÁ — JEDNO ČÍSLO
--
-- Pro odznak v nabídce a pro kiosek (krok E), kde se smí ukázat JEN
-- tohle číslo a ne obsah.
-- ---------------------------------------------------------------------

create or replace function public.ceka_na_me(p_tenant uuid)
returns table (doruceno integer, ceka integer)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(sum(r.neprectenych - r.ceka), 0)::integer,
    coalesce(sum(r.ceka), 0)::integer
  from public.moje_rozhovory(p_tenant) r;
$$;

comment on function public.ceka_na_me(uuid) is
  'Dvě čísla do odznaku: co se doručilo a co čeká na píchnutí. '
  'Číslo se smí ukázat i na sdíleném tabletu, obsah ne.';

revoke all on function public.ceka_na_me(uuid) from public, anon;
grant execute on function public.ceka_na_me(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ZALOŽENÍ ROZHOVORU
--
-- Přímý insert je na tabulkách odepřený, takže tudy vede jediná cesta.
--
-- ROZSAH Z PROHLÍŽEČE JE NÁVRH (pravidlo 4). Účastníci se ověřují proti
-- firmě: kdo do ní nepatří nebo je smazaný, konverzaci shodí. U
-- `mezi_pobockami` to platí dvojnásob — je to jediné místo, kde se
-- hranice poboček schválně překračuje, takže tam nic jiného nehlídá.
--
-- U `vedeni` se účastníci NEPŘEDÁVAJÍ, odvozují se z adresáta. Kdyby je
-- posílala obrazovka, dala by se stížnost na vedoucího adresovat právě
-- tomu vedoucímu — a to je horší než žádná cesta: člověk si myslí, že
-- si postěžoval, a jediné, čeho dosáhl, je že si na sebe řekl.
-- ---------------------------------------------------------------------

create or replace function public.zalozit_rozhovor(
  p_tenant    uuid,
  p_druh      text,
  p_branch    uuid default null,
  p_nazev     text default null,
  p_adresat   text default null,
  p_ucastnici uuid[] default '{}'
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ja    uuid;
  v_id    uuid;
  v_pocet integer;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  v_ja := app.muj_employee(p_tenant);
  if v_ja is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
  end if;

  -- Pobočka z prohlížeče se ověřuje proti členství, ne proti tomu, že
  -- přišla v požadavku. Jinak stačí přepsat jedno číslo.
  if p_druh = 'pobocka' and p_branch not in (select app.visible_branch_ids(p_tenant)) then
    raise exception 'Na tuhle pobočku nemáte dosah.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.konverzace (tenant_id, druh, branch_id, nazev, adresat, zalozil)
  values (p_tenant, p_druh, p_branch, nullif(btrim(coalesce(p_nazev, '')), ''),
          p_adresat, v_ja)
  returning id into v_id;

  -- Zakladatel je vždycky uvnitř.
  insert into public.konverzace_ucastnici (konverzace_id, employee_id)
  values (v_id, v_ja);

  if p_druh = 'vedeni' then
    /*
      Adresáti se odvozují, nepředávají.

      `majitel` = kdo má roli s is_owner. Tu konverzaci pak nevidí
      nikdo jiný — ani provozní, ani nikdo s people.manage.

      `vedouci` = kdo má people.manage na DOMOVSKÉ pobočce odesílatele.
      Rozhoduje právo, ne název role (pravidlo 2).

      OTÁZKA PRO ŠÉFÍKA: `vedeni` nemá podle omezení
      `konverzace_pobocka_dava_smysl` žádnou pobočku, takže se
      „vedoucí pobočky“ odvozuje z employees.branch_id odesílatele.
      U člověka, který dělá na dvou pobočkách, to je domovská, ne ta,
      kde zrovna je. Nechávám tak; změna je rozhodnutí o provozu.
    */
    insert into public.konverzace_ucastnici (konverzace_id, employee_id)
    select distinct v_id, e.id
    from public.employees e
    join public.memberships m on m.user_id = e.user_id and m.tenant_id = e.tenant_id
    join public.roles r on r.id = m.role_id
    where e.tenant_id = p_tenant
      and e.deleted_at is null
      and e.id <> v_ja
      and m.status = 'active'
      and (
        (p_adresat = 'majitel' and r.is_owner)
        or (
          p_adresat = 'vedouci'
          and exists (
            select 1 from public.role_permissions rp
            where rp.role_id = r.id and rp.permission_key = 'people.manage'
          )
          and (
            m.scope = 'tenant'
            or exists (
              select 1 from public.membership_branches mb
              where mb.membership_id = m.id
                and mb.branch_id = (select e2.branch_id from public.employees e2 where e2.id = v_ja)
            )
          )
        )
      )
    on conflict do nothing;

    get diagnostics v_pocet = row_count;
    if v_pocet = 0 then
      raise exception 'Ve firmě není nikdo, komu by tenhle vzkaz mohl dojít.'
        using errcode = 'no_data_found';
    end if;

  else
    -- Ostatní druhy: účastníci z parametru, ale ověření proti firmě.
    if array_length(p_ucastnici, 1) is not null then
      select count(*) into v_pocet
      from unnest(p_ucastnici) as x(emp)
      where not exists (
        select 1 from public.employees e
        where e.id = x.emp and e.tenant_id = p_tenant and e.deleted_at is null
      );

      if v_pocet > 0 then
        raise exception 'Někdo z účastníků do téhle firmy nepatří.'
          using errcode = 'insufficient_privilege';
      end if;

      insert into public.konverzace_ucastnici (konverzace_id, employee_id)
      select distinct v_id, x.emp from unnest(p_ucastnici) as x(emp)
      where x.emp <> v_ja
      on conflict do nothing;
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[]) is
  'Jediná cesta, kterou vznikne konverzace. Účastníky ověřuje proti '
  'firmě (pravidlo 4); u druhu vedeni je neposlouchá vůbec a odvodí si '
  'je z adresáta.';

revoke all on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[])
  from public, anon;
grant execute on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- ODESLÁNÍ ZPRÁVY
--
-- Tady se hlídá právo na naléhavost. Kdyby se psalo do tabulky přímo,
-- obešlo by se to jedním requestem — proto je přímý insert odepřený.
-- ---------------------------------------------------------------------

create or replace function public.poslat_zpravu(
  p_konverzace uuid,
  p_text       text,
  p_nalehava   boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ja     uuid;
  v_id     uuid;
begin
  select k.tenant_id into v_tenant from public.konverzace k where k.id = p_konverzace;

  /*
    ÚČASTNICTVÍ JE AUTORIZACE — a záporná větev je tu důležitější než
    kladná. Kdo uvnitř není, nedostane jinou odpověď než ten, kdo si
    vymyslel neexistující id: obě vedou na tutéž hlášku. Rozdíl v textu
    by prozradil, které konverzace existují.
  */
  if v_tenant is null or not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.konverzace k
             where k.id = p_konverzace and k.uzavreno_kdy is not null) then
    raise exception 'Tenhle rozhovor je uzavřený.' using errcode = 'check_violation';
  end if;

  v_ja := app.muj_employee(v_tenant);

  /*
    NALÉHAVÁ JE ZVLÁŠTNÍ PRÁVO, ne communication.manage.

    Spravovat nástěnku a rozsvítit ve dvě ráno telefon dvanácti lidem
    jsou dvě různé pravomoci a `manage` má dnes kdekdo. Právo není
    vázané na pobočku: naléhavá zpráva se posílá i do konverzace, která
    žádnou pobočku nemá.
  */
  if coalesce(p_nalehava, false)
     and not app.has_permission(v_tenant, 'communication.urgent') then
    raise exception 'Naléhavou zprávu poslat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text, nalehava)
  values (p_konverzace, v_tenant, v_ja, p_text, coalesce(p_nalehava, false))
  returning id into v_id;

  /*
    NALÉHAVÁ NAVÍC DO AUDITU SE JMÉNEM.

    Řádek v `konverzace_zpravy` audituje spoušť trg_audit_zprav, ale
    ta zapíše id, ne jméno — a odstrašuje jméno. Tohle je to jediné,
    co brání tomu, aby se naléhavé stalo výchozím: když je naléhavé
    všechno, není naléhavé nic.

    Text zprávy se do auditu NEDÁVÁ. Audit čte víc lidí než konverzaci
    a obsah je to nejcitlivější, co v aplikaci je.
  */
  if coalesce(p_nalehava, false) then
    perform app.audit(
      p_tenant      => v_tenant,
      p_action      => 'komunikace.nalehava_zprava',
      p_entity_type => 'konverzace_zprava',
      p_entity_id   => v_id::text,
      p_after       => jsonb_build_object(
        'konverzace', p_konverzace,
        'odesilatel', (select e.full_name from public.employees e where e.id = v_ja),
        'znaku', length(p_text)
      )
    );
  end if;

  return v_id;
end;
$$;

comment on function public.poslat_zpravu(uuid, text, boolean) is
  'Jediná cesta, kterou vznikne zpráva. Hlídá účastnictví, zapnutý '
  'modul a právo communication.urgent. Naléhavou zapisuje do auditu '
  'se jménem odesílatele, ale bez textu.';

revoke all on function public.poslat_zpravu(uuid, text, boolean) from public, anon;
grant execute on function public.poslat_zpravu(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- OZNAČENÍ PŘEČTENÉHO
--
-- Posouvá se jen dopředu. Kdyby šlo posunout zpět, dal by se odznak
-- „nepřečteno“ vyrobit zpětně a přestal by o čemkoli vypovídat.
-- ---------------------------------------------------------------------

create or replace function public.oznacit_precteno(p_konverzace uuid)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_kdy timestamptz;
begin
  if not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.konverzace_ucastnici u
     set precteno_do = now()
   from public.employees e
  where u.konverzace_id = p_konverzace
    and e.id = u.employee_id
    and e.user_id = (select auth.uid())
    and (u.precteno_do is null or u.precteno_do < now())
  returning u.precteno_do into v_kdy;

  return v_kdy;
end;
$$;

comment on function public.oznacit_precteno(uuid) is
  'Posune můj čas přečtení na teď. Cizí řádek nesáhne — ani majitel.';

revoke all on function public.oznacit_precteno(uuid) from public, anon;
grant execute on function public.oznacit_precteno(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- STORNO ZPRÁVY
--
-- Mazání je označení, ne výmaz (pravidlo 9). Stornovat smí autor.
-- ---------------------------------------------------------------------

create or replace function public.stornovat_zpravu(p_zprava uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_konv uuid;
  v_ja   uuid;
begin
  select z.konverzace_id into v_konv
  from public.konverzace_zpravy z where z.id = p_zprava;

  if v_konv is null or not app.je_ucastnik(v_konv) then
    raise exception 'K téhle zprávě nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  v_ja := (select e.id from public.employees e
           join public.konverzace_zpravy z on z.autor = e.id
           where z.id = p_zprava and e.user_id = (select auth.uid()));

  if v_ja is null then
    raise exception 'Stáhnout jde jen vlastní zpráva.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.konverzace_zpravy
     set stornovano_kdy = now(), stornoval = v_ja
   where id = p_zprava and stornovano_kdy is null;
end;
$$;

comment on function public.stornovat_zpravu(uuid) is
  'Stáhne vlastní zprávu. Řádek zůstává — mazání je označení, ne '
  'výmaz. Stopa v auditu zůstává taky.';

revoke all on function public.stornovat_zpravu(uuid) from public, anon;
grant execute on function public.stornovat_zpravu(uuid) to authenticated;
