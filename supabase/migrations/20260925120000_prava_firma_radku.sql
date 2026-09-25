-- =====================================================================
-- Foodtab — oprávnění nejde přidělit napříč firmami
--
-- Nález nezávislé kontroly 25. 9. 2026 u opravy „nefunguje přiřazování
-- práv k osobám" (krok 58). Chyba je starší, od 20260908090000
-- a 20260909100000, a leží na téže cestě.
--
-- ---------------------------------------------------------------------
-- CO BYLO ŠPATNĚ
--
-- `employee_permissions` i `position_permissions` nesou vlastní
-- `tenant_id`, ale nic nehlídalo, že je to firma TOHO ZAMĚSTNANCE nebo
-- TOHO ZAŘAZENÍ. `employee_id` a `position_id` mají jen obyčejnou FK.
--
-- Politiky se ptají `has_access(tenant_id řádku, 'settings.manage')`,
-- tedy firmy, kterou do řádku napíše VOLAJÍCÍ. A jádro
-- (`has_access`, `has_permission`, `ma_pravo_clovek`) výjimku i právo
-- zařazení hledalo jen podle `employee_id` / `position_id`.
--
-- Majitel firmy B, který je ve firmě A číšníkem, si tak zapsal
-- (tenant_id = B, employee_id = <já ve firmě A>, 'settings.manage', true)
-- a politika ho pustila, protože ve firmě B nastavení spravuje. Ve
-- firmě A pak `has_access` vrátil pravdu. Přes `position_permissions`
-- totéž dopadlo na VŠECHNY lidi s tím zařazením ve firmě A. Záznam
-- v auditu šel pod firmu B, takže ho majitel A neviděl. Ověřeno
-- v PGlite pod rolí `authenticated`, dnes to hlídá krok58, oddíl 7.
--
-- Dnes se to zneužít nedalo jen proto, že ostrá databáze má JEDNU firmu.
-- Pojistka nesmí stát na tom, že druhý zákazník ještě nepřišel.
--
-- ---------------------------------------------------------------------
-- DVĚ LINIE, KAŽDÁ S VLASTNÍ KONTROLOU
--
-- 1. SPOUŠTĚ (první linie v databázi). Řádek se do tabulky nedostane,
--    když jeho `tenant_id` není firma zaměstnance nebo zařazení:
--
--      employee_permissions  employee_id → employees.tenant_id
--      position_permissions  position_id → positions.tenant_id
--      employees             position_id → positions.tenant_id
--
--    Třetí řádek není v nálezu, ale je na téže cestě. Vedoucí firmy B
--    se správou lidí si mohl dát svého člověka pod bohaté zařazení firmy
--    A a strop by to nezastavil: `ziva_prava_zarazeni(B, …)` práva cizího
--    zařazení správně nevidí, takže prošlo „nic navíc", a `has_access`
--    je pak přes `pp.position_id` započítal.
--
-- 2. FILTR V TĚLE FUNKCÍ (druhá linie). `ep.tenant_id = p_tenant`
--    a `pp.tenant_id = p_tenant` v šesti funkcích, které tabulky čtou
--    přímo. Jsou `security definer` s `rolbypassrls` a RLS se v nich
--    neuplatní (docs/zarazeni-misto-roli-nalezy.md, 7b). Bez filtru by
--    rozhodl i řádek, který se dovnitř dostal dřív, než spoušť existovala,
--    nebo obešel spoušť (servisní klíč, ruční oprava v SQL editoru).
--
-- Na datech se ty dvě linie kryjí: se spouštěmi je `pp.tenant_id`
-- vždycky firma člověka. Kontrola na filtr by proto nešla shodit
-- (skill scenar, 3b). krok58 proto na filtr míří s VYPNUTÝMI spouštěmi,
-- přes řádek, jaký by zůstal ze staré doby, a na spouště zvlášť
-- pokusem o zápis. Každou linii jde shodit samostatně.
--
-- Šest funkcí se opisuje celé, protože `create or replace` jinak nejde.
-- Mění se v nich JEN ty dva filtry. Všechno ostatní je znak po znaku
-- z 20260909100000, včetně bloku rozsahu v `has_access`. Je to jejich
-- POSLEDNÍ definice: žádná pozdější migrace je nepřepsala a ostrá
-- databáze má k 25. 9. 2026 tatáž těla (md5 `prosrc` sedí na všech
-- šesti). Porovnáno diffem, přibyly jen řádky s `tenant_id`.
--
-- Ostatní funkce, které se na tyhle dvě tabulky ptají, filtr mají nebo
-- se ptají přes `ma_pravo_clovek`: `ziva_prava_zarazeni` ho má od
-- 20260909100000, `kdo_ma_pravo`, `kdo_ma_pravo_na_pobocce`,
-- `adresati_vzkazu`, `ziva_prava_cloveka` a strop jdou přes
-- `ma_pravo_clovek`. `app.prevod_zarazeni` a `app.create_tenant` tabulky
-- jen plní, a to řádky jedné firmy.
--
-- ---------------------------------------------------------------------
-- PROČ SPOUŠŤ, A NE SLOŽENÁ FK
--
-- Složená FK (`unique (id, tenant_id)` na `employees` a `positions`
-- a `foreign key (employee_id, tenant_id) references employees (id,
-- tenant_id)`) by byla deklarativní a hlídala by i opačnou stranu,
-- přesun zaměstnance do jiné firmy. Rozbila by ale víc:
--
-- * `employees.position_id` je `on delete set null`. Složená FK by při
--   smazání zařazení vynulovala i `tenant_id`, který je `not null`,
--   takže by smazání zařazení s lidmi spadlo. Spravit to jde výčtem
--   sloupců (`on delete set null (position_id)`), jenže na to si musí
--   vzpomenout každý, kdo FK příště sáhne.
-- * Druhá FK mezi týmiž tabulkami udělá PostgRESTu z vnořeného selectu
--   (`employees(…, positions(…))`) dvě cesty a dotaz spadne na PGRST201.
--   Dnes takový select v aplikaci není, ale past by zůstala nachystaná.
--   Starou FK zrušit a nechat jen složenou je zásah do schématu, který
--   tahle oprava nepotřebuje.
-- * Chyba by přišla anglicky jako porušení FK. Spoušť řekne česky, co
--   je špatně, a aplikace ji ukáže tak, jak přijde.
--
-- Obejít jde obojí stejně: `session_replication_role = replica` vypne
-- spouště i kontrolu FK. Proto druhá linie.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Zákaz měnit `tenant_id` u zaměstnance nebo zařazení. Nikdo to nedělá
--   a přesunout řádek může jen správce OBOU firem. Škodu by stejně
--   zastavil filtr v jádru: cizí řádky se ve firmě nezapočítají, ať
--   vznikly jakkoli.
-- * `membership_branches` s pobočkou cizí firmy a `employees.branch_id`
--   / `usek_id` z cizí firmy. Zapíše je jen správce téže firmy
--   a v cizí firmě nic neotevřou: `has_access(B, …)` chce členství
--   ve firmě B. Otázka pro Šéfíka v hlášení.
-- * Chyby jsou `23514` (`check_violation`), ne `foreign_key_violation`
--   jako „Role nepatří této firmě." v `create_invitation`. Aplikace bere
--   23514 jako porušené pravidlo s hláškou pro člověka (vzkazy,
--   checklisty). 23503 znamená „odkazovaný řádek neexistuje" — a on
--   existuje, jen patří jiné firmě.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. NEJDŘÍV SE PODÍVAT, JESTLI UŽ TAKOVÉ ŘÁDKY NEJSOU
--
-- Spoušť hlídá jen nové zápisy. Kdyby v databázi už ležel nesouhlasný
-- řádek, zůstal by tam. Filtr v jádru by ho sice přestal počítat, ale
-- nikdo by se nedozvěděl, že tam je a kdo ho zapsal.
--
-- Nic se NEMAŽE: jsou to zákaznická data a o tom, co s nimi, rozhoduje
-- člověk. Migrace radši spadne nahlas. K 25. 9. 2026 má ostrá databáze
-- jednu firmu a nesouhlasných řádků nula.
--
-- Stejný dotaz poslouží ke kontrole před nasazením, jen čtením.
--
-- Zámek napřed: mezi kontrolou a vznikem spouští nesmí nikdo zapsat
-- řádek, který by kontrola už neviděla a spoušť ještě ne. Je to týž
-- zámek, který si `create trigger` vezme stejně, jen o pár řádků dřív.
-- `db push` pouští soubor v jedné transakci, takže zámek drží do konce
-- migrace a zápisy do tří malých tabulek počkají. Je uvnitř bloku,
-- protože `run.sh` a PGlite běží bez transakce a holý `lock table` tam
-- spadne; souběžně tam nikdo nezapisuje.
-- ---------------------------------------------------------------------

do $$
declare
  v_ep   integer;
  v_pp   integer;
  v_emp  integer;
begin
  lock table public.employee_permissions, public.position_permissions, public.employees
    in share row exclusive mode;

  select count(*) into v_ep
  from public.employee_permissions ep
  join public.employees e on e.id = ep.employee_id
  where e.tenant_id <> ep.tenant_id;

  select count(*) into v_pp
  from public.position_permissions pp
  join public.positions po on po.id = pp.position_id
  where po.tenant_id <> pp.tenant_id;

  select count(*) into v_emp
  from public.employees e
  join public.positions po on po.id = e.position_id
  where po.tenant_id <> e.tenant_id;

  if v_ep + v_pp + v_emp > 0 then
    raise exception
      'V databázi jsou oprávnění z cizí firmy: výjimky %, práva zařazení %, zaměstnanci s cizím zařazením %. Nejdřív je projděte ručně.',
      v_ep, v_pp, v_emp
      using errcode = 'check_violation';
  end if;
end $$;


-- =====================================================================
-- 1. PRVNÍ LINIE: SPOUŠTĚ
-- =====================================================================

-- ---------------------------------------------------------------------
-- Zaměstnanec musí být z firmy, pod kterou se řádek zapisuje.
--
-- `security definer`: kdo má `settings.manage`, nemusí zaměstnance
-- vidět (`employees_select` pouští podle `shifts.read` na pobočce).
-- Pod jeho právy by spoušť zaměstnance nenašla a odmítla by i správný
-- zápis. Filtry jsou proto napsané přímo, oddíl 7b.
--
-- `deleted_at` se tu schválně neřeší. Hlídá se firma, ne to, jestli
-- člověk ještě pracuje.
-- ---------------------------------------------------------------------

create function app.hlida_firmu_zamestnance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id
      and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Zaměstnanec nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_zamestnance() is
  'Spoušť: tenant_id řádku musí být firma zaměstnance (employee_id). '
  'Bez toho si správce jedné firmy zapsal výjimku člověku z jiné.';

revoke all on function app.hlida_firmu_zamestnance() from public, anon, authenticated;

create trigger trg_firma_opravneni_cloveka
  before insert or update of tenant_id, employee_id on public.employee_permissions
  for each row execute function app.hlida_firmu_zamestnance();


-- ---------------------------------------------------------------------
-- Zařazení musí být z firmy, pod kterou se řádek zapisuje.
--
-- Jedna funkce pro dvě tabulky: `position_permissions` i `employees`
-- mají `position_id` a `tenant_id` stejného významu. U zaměstnance smí
-- být zařazení prázdné.
--
-- Na `employees` se jmenuje tak, aby běžela PŘED `trg_strop_zarazeni`
-- (spouště téže události běží podle abecedy). Kdo sáhne po cizím
-- zařazení, dozví se to, a ne že „nese oprávnění, která sami nemáte".
--
-- `security definer` tu dnes nic nedrží: zařazení vidí každý člen
-- firmy (`positions_select`). Je tu kvůli tomu, aby se spoušť nezačala
-- plést, až se čtení zařazení zpřísní. Kontrola na to v krok58 není,
-- na rozdíl od spouště u zaměstnance výš.
-- ---------------------------------------------------------------------

create function app.hlida_firmu_zarazeni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.position_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.positions po
    where po.id = new.position_id
      and po.tenant_id = new.tenant_id
  ) then
    raise exception 'Zařazení nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_zarazeni() is
  'Spoušť: tenant_id řádku musí být firma zařazení (position_id). '
  'Na position_permissions i employees.';

revoke all on function app.hlida_firmu_zarazeni() from public, anon, authenticated;

create trigger trg_firma_opravneni_zarazeni
  before insert or update of tenant_id, position_id on public.position_permissions
  for each row execute function app.hlida_firmu_zarazeni();

create trigger trg_firma_zarazeni
  before insert or update of tenant_id, position_id on public.employees
  for each row execute function app.hlida_firmu_zarazeni();


-- =====================================================================
-- 2. DRUHÁ LINIE: FILTR NA FIRMU V TĚLE FUNKCÍ
--
-- Každá funkce níž je opsaná z 20260909100000. Přibyly jen řádky
-- `and ep.tenant_id = …` a `and pp.tenant_id = …`, v každém poddotazu
-- jednou.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Skládací pravidlo. Ptají se ho `kdo_ma_pravo`, `kdo_ma_pravo_na_pobocce`,
-- `adresati_vzkazu`, `ziva_prava_cloveka` i kontrola citlivého práva
-- v pozvánce, takže filtr tady platí za všechny.
-- ---------------------------------------------------------------------

create or replace function app.ma_pravo_clovek(
  p_tenant     uuid,
  p_employee   uuid,
  p_permission text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee
      and e.tenant_id = p_tenant
      and e.deleted_at is null
      and (
        e.je_majitel
        or coalesce(
             (select ep.granted
                from public.employee_permissions ep
               where ep.employee_id = e.id
                 and ep.tenant_id = p_tenant
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
                 and pp.tenant_id = p_tenant
                 and pp.permission_key = p_permission
             )
           )
      )
  );
$$;


create or replace function app.has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    /*
      Členství drží ROZSAH a to, že člověk do firmy patří. Práva už
      nerozdává — proto tu není `roles` ani `role_permissions`.
    */
    join public.employees e        on e.user_id   = m.user_id
                                  and e.tenant_id = p_tenant
                                  and e.deleted_at is null
    join public.permissions p      on p.key = p_permission
    join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                  and tm.module_key = p.module_key
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      -- Modulová brána je PŘED větví majitele schválně: majitel dostává
      -- vše z AKTIVNÍCH modulů, ne vše vůbec.
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
      and (
        e.je_majitel
        or coalesce(
             (select ep.granted
                from public.employee_permissions ep
               where ep.employee_id = e.id
                 and ep.tenant_id = p_tenant
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
                 and pp.tenant_id = p_tenant
                 and pp.permission_key = p_permission
             )
           )
      )
  );
$$;


create or replace function app.has_access(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.employees e        on e.user_id   = m.user_id
                                  and e.tenant_id = p_tenant
                                  and e.deleted_at is null
    join public.permissions p      on p.key = p_permission
    join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                  and tm.module_key = p.module_key
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
      and (
        e.je_majitel
        or coalesce(
             (select ep.granted
                from public.employee_permissions ep
               where ep.employee_id = e.id
                 and ep.tenant_id = p_tenant
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
                 and pp.tenant_id = p_tenant
                 and pp.permission_key = p_permission
             )
           )
      )
      and (
        m.scope = 'tenant'
        or (
          p_branch is not null
          and exists (
            select 1 from public.membership_branches mb
            where mb.membership_id = m.id and mb.branch_id = p_branch
          )
        )
      )
  );
$$;


-- ---------------------------------------------------------------------
-- „Kdo čeká na oprávnění". Bez filtru by člověk, kterému cizí firma
-- zapsala výjimku, z okna zmizel, i když tady nemá nic.
-- ---------------------------------------------------------------------

create or replace function public.cekaji_na_opravneni(p_tenant uuid)
returns table (user_id uuid, jmeno text, od timestamptz)
language sql stable security definer set search_path = ''
as $$
  select
    m.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Nový člověk'),
    m.created_at
  from public.memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and not exists (
      select 1
      from public.employees e
      where e.tenant_id = p_tenant
        and e.user_id = m.user_id
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


-- ---------------------------------------------------------------------
-- „Bylo vám přiděleno oprávnění". Spoušť na členství, firma je
-- `new.tenant_id`.
-- ---------------------------------------------------------------------

create or replace function app.upozorni_na_clenstvi()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_zarazeni text;
  v_firma    text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- Bez práv není co oznamovat: "jste ve firmě, ale nic nevidíte" není
  -- zpráva, na kterou se čeká.
  if not exists (
    select 1 from public.employees e
    where e.tenant_id = new.tenant_id
      and e.user_id = new.user_id
      and e.deleted_at is null
      and (
        e.je_majitel
        or exists (select 1 from public.position_permissions pp
                    where pp.position_id = e.position_id
                      and pp.tenant_id = new.tenant_id)
        or exists (select 1 from public.employee_permissions ep
                    where ep.employee_id = e.id and ep.granted
                      and ep.tenant_id = new.tenant_id)
      )
  ) then
    return new;
  end if;

  -- Při úpravě jen tehdy, když se něco opravdu změnilo.
  if tg_op = 'UPDATE'
     and old.role_id is not distinct from new.role_id
     and old.scope is not distinct from new.scope
     and old.status = new.status then
    return new;
  end if;

  select po.label into v_zarazeni
  from public.employees e
  left join public.positions po on po.id = e.position_id
  where e.tenant_id = new.tenant_id
    and e.user_id = new.user_id
    and e.deleted_at is null
  limit 1;

  select t.name into v_firma from public.tenants t where t.id = new.tenant_id;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  values (
    new.tenant_id, new.user_id, null, 'opravneni.prideleno',
    jsonb_build_object(
      'firma', v_firma,
      'role', v_zarazeni,
      'rozsah', new.scope
    )
  );

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- Zvoneček „přijal pozvánku". Musí říkat totéž co `cekaji_na_opravneni`,
-- proto tentýž filtr.
-- ---------------------------------------------------------------------

create or replace function app.upozorni_na_prijeti(p_tenant uuid, p_kdo uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_jmeno    text;
  v_zarazeni text;
  v_scope    text;
  v_pobocky  text[];
  v_ceka     boolean;
  v_member   public.memberships%rowtype;
begin
  select coalesce(nullif(btrim(p.full_name), ''), p.email, 'Nový člověk')
    into v_jmeno
  from public.profiles p where p.user_id = p_kdo;

  select * into v_member
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = p_kdo;

  /*
    Čeká ten, kdo nemá odkud vzít ani jedno právo. Je to tatáž otázka,
    na kterou odpovídá `public.cekaji_na_opravneni` — a je to schválně
    napsané stejně, protože okno při přihlášení a tenhle zvoneček musí
    říkat totéž. Kdyby se rozešly, jeden by hlásil úkol a druhý ho
    v seznamu neměl.
  */
  select po.label,
         not (
           e.je_majitel
           or exists (select 1 from public.position_permissions pp
                       where pp.position_id = e.position_id
                         and pp.tenant_id = p_tenant)
           or exists (select 1 from public.employee_permissions ep
                       where ep.employee_id = e.id and ep.granted
                         and ep.tenant_id = p_tenant)
         )
    into v_zarazeni, v_ceka
  from public.employees e
  left join public.positions po on po.id = e.position_id
  where e.tenant_id = p_tenant
    and e.user_id = p_kdo
    and e.deleted_at is null
  limit 1;

  -- Bez zaměstnaneckého záznamu nemá práva odkud vzít vůbec.
  v_ceka := coalesce(v_ceka, true);

  v_scope := v_member.scope;

  select array_agg(b.name order by b.name) into v_pobocky
  from public.membership_branches mb
  join public.branches b on b.id = mb.branch_id
  where mb.membership_id = v_member.id;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  select
    p_tenant,
    k.user_id,
    null,
    'pozvanka.prijata',
    jsonb_build_object(
      'jmeno',   v_jmeno,
      -- Kdo přijal. Tlačítko v okně z toho udělá odkaz rovnou na
      -- přidělení oprávnění, ne na seznam lidí.
      'kdo',     p_kdo,
      'ceka',    v_ceka,
      -- Klíč `role` zůstává, i když se do něj plní zařazení: čte ho
      -- `lib/upozorneni-text.ts` a v databázi už s ním leží staré
      -- zprávy. Přejmenovat ho znamená nechat je bez textu.
      'role',    v_zarazeni,
      'rozsah',  v_scope,
      'pobocky', coalesce(v_pobocky, '{}'::text[])
    )
  from app.kdo_ma_pravo(p_tenant, 'people.manage') k;
end;
$$;
