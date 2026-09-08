-- =====================================================================
-- Foodtab — přepnutí jádra oprávnění z rolí na zařazení
--
-- Zadání: docs/zarazeni-misto-roli.md, oddíl 5.3.
-- Nálezy a povinnosti: docs/zarazeni-misto-roli-nalezy.md, ODDÍL 7b.
-- Měření: docs/prepnuti-mereni-2026-09-08.md.
--
-- Navazuje na 20260908090000, která založila tabulky a převedla data.
-- Ta migrace schválně nic nepřepínala — od téhle chvíle nové tabulky
-- opravdu rozhodují.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ A CO ZŮSTÁVÁ DOSLOVA
--
-- Mění se JEN ten prostřední kus, odkud se berou práva:
--
--   dřív:  memberships → roles → role_permissions  (+ r.is_owner)
--   teď:   memberships → employees → position_permissions
--                                  + employee_permissions (výjimka)
--                                  + employees.je_majitel
--
-- ZŮSTÁVÁ BEZE ZMĚNY, a je to schválně:
--   * signatura `(uuid, text, uuid)` — stojí na ní `public.has_access`
--     (20260825080000), granty i `supabase.rpc('has_access')`
--     z lib/authz.ts,
--   * `security definer` — bez něj se politika `employees_select`
--     zacyklí přes `can_read_scoped`,
--   * join `permissions → tenant_modules` se stavem `active/trial`
--     a `valid_until` — a je AŽ ZA NÍM větev majitele, aby majitel na
--     vypnutém modulu nedostal nic,
--   * celý blok rozsahu v `has_access` (`m.scope`, `membership_branches`)
--     — rozsah se touhle změnou nedotýká vůbec.
--
-- ČLENSTVÍ ZŮSTÁVÁ, ale už nerozdává práva. Drží dvě věci: že člověk
-- do firmy pořád patří (`status = 'active'`) a ROZSAH.
--
-- ---------------------------------------------------------------------
-- PRAVIDLO SKLÁDÁNÍ
--
--   Výjimka u člověka rozhoduje. Když u něj záznam není, rozhoduje
--   zařazení. Majitel dostává vše.
--
-- Výjimka přebíjí OBĚMA směry: `granted = true` právo přidá,
-- `granted = false` ho sebere navzdory zařazení. Proto `coalesce`
-- s poddotazem na `granted`, ne `exists` — `exists` by uměl jen
-- přidávat a odebrání by tiše zahodil.
--
-- ---------------------------------------------------------------------
-- FILTRY SI DĚLÁ FUNKCE SAMA — ODDÍL 7b, NENÍ TO DOPORUČENÍ
--
-- Tyhle funkce jsou `security definer` a vlastní je role
-- s `rolbypassrls`. Uvnitř nich se RLS NEUPLATNÍ VŮBEC. Pravidlo 3
-- z CLAUDE.md mluví o dvou obranných liniích — tady ta druhá
-- NEEXISTUJE. Není zeslabená, není tam.
--
-- Proto jsou tři filtry napsané PŘÍMO, i když by dva z nich šlo
-- odvodit z joinu:
--
--   e.tenant_id = p_tenant     jinak se právo najde u člověka z cizí firmy
--   e.deleted_at is null       jinak práva označeného smazaného
--   m.status = 'active'        jinak práva zrušeného členství
--
-- `e.tenant_id = p_tenant` NENÍ nadbytečné, a je to schválně.
--
-- Návrh z měření vázal zaměstnance na firmu dvakrát: joinem
-- `e.tenant_id = m.tenant_id` A rovnou podmínkou na `p_tenant`.
-- Znělo to opatrněji, jenže z toho filtru se tím stala podmínka,
-- KTERÁ NEJDE ROZBÍT: vyndá se a nic se nezmění, protože ho drží
-- ta druhá. Kontrola s cizí firmou by pak zůstala zelená, ať je
-- v těle napsané cokoli — a to je horší než žádná kontrola.
--
-- Zaměstnanec se proto na firmu váže jednou, přímo přes `p_tenant`.
-- Členství se váže taky jednou, přes `m.tenant_id = p_tenant`.
-- Obě podmínky teď něco drží a obě jdou shodit zvlášť —
-- `krok33_scenar` na ně míří kontrolou 7b/1.
--
-- Na každý z těch tří filtrů míří vlastní kontrola s cizí firmou
-- v `krok33_scenar` a každá se dá shodit vyndáním právě toho jednoho.
--
-- ---------------------------------------------------------------------
-- CO SE TÍM ZMĚNÍ LIDEM
--
-- Podle měření z 8. 9.: ztraceno 0 práv, přibylo 0, 65 povolení před
-- i po. Jedna výjimka ale je a musí zaznít nahlas:
--
-- KDO MÁ ČLENSTVÍ BEZ ROLE, dnes nemá ŽÁDNÉ právo — vnitřní join na
-- `roles` mu nevrátí nic. Po téhle migraci dostane to, co mu dává
-- zařazení. Je to ZÁMĚR, je to celý smysl pozvánky bez role
-- (20260901200000) — ale při ostrém testu to vypadá jako chyba, takže
-- ať to nikoho nepřekvapí.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SKLÁDACÍ PRAVIDLO NA JEDNOM MÍSTĚ
--
-- Opakuje se doslova ve třech z devíti funkcí, které si na model
-- sahají mimo `has_access`. Opsané počtvrté by se dřív nebo později
-- rozešlo — a rozešlo by se tiše.
--
-- Bere `p_tenant` schválně, i když by `p_employee` stačilo k nalezení
-- řádku: viz 7b. Funkce, která si tenant neověří sama, je uvnitř
-- definer řetězu díra.
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
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
                 and pp.permission_key = p_permission
             )
           )
      )
  );
$$;

comment on function app.ma_pravo_clovek(uuid, uuid, text) is
  'Skládací pravidlo: výjimka u člověka rozhoduje, jinak zařazení, '
  'majitel dostává vše. NEŘEŠÍ moduly ani rozsah — na to je has_access.';

revoke all on function app.ma_pravo_clovek(uuid, uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- JÁDRO: má člověk právo ve firmě?
-- ---------------------------------------------------------------------

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
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
                 and pp.permission_key = p_permission
             )
           )
      )
  );
$$;

comment on function app.has_permission(uuid, text) is
  'Má přihlášený tohle právo ve firmě? Práva dává ZAŘAZENÍ, přebíjí je '
  'výjimka u člověka, majitel dostává vše z aktivních modulů.';


-- ---------------------------------------------------------------------
-- JÁDRO: plná kontrola včetně rozsahu
--   p_branch = konkrétní pobočka → musí být v rozsahu členství
--   p_branch = NULL (firemní úroveň) → vyžaduje rozsah 'tenant'
--
-- Blok rozsahu je opsaný ZNAK PO ZNAKU z dnešní verze. Rozsah se touhle
-- změnou nemění a přepisovat ho „při té příležitosti" je přesně to,
-- čím se do bezpečnostní funkce dostane chyba.
-- ---------------------------------------------------------------------

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
                 and ep.permission_key = p_permission),
             exists (
               select 1
               from public.position_permissions pp
               where pp.position_id = e.position_id
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

comment on function app.has_access(uuid, text, uuid) is
  'Jediné místo, kde se rozhoduje o přístupu. Volá ji aplikace i RLS. '
  'Práva dává zařazení, přebíjí výjimka u člověka, majitel dostává vše '
  'z aktivních modulů. Rozsah zůstává na členství.';


-- =====================================================================
-- JEDENÁCT OPSANÝCH KOPIÍ MIMO `has_access`
--
-- Nálezy (oddíl 3) jich vyjmenovaly devět. Desátá se našla až při psaní:
-- `app.is_owner` v `20260823120200_authz.sql:33`. Neptá se jí žádná
-- politika, ptá se jí `krok7_scenar` — a hlavně by po přepnutí tvrdila,
-- že majitel není majitel.
--
-- Všechny mají společné to, že by po přepnutí `has_access` běžely dál
-- nad tabulkou, která už o ničem nerozhoduje. NIC BY NESPADLO. Build
-- by zůstal zelený a ony by se chovaly podle mrtvého modelu.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Zaměstnanec uživatele ve firmě.
--
-- Vzniká proto, že "najdi si k uživateli zaměstnance" se od téhle chvíle
-- opakuje v osmi funkcích. Filtr na firmu a na `deleted_at` je uvnitř —
-- oddíl 7b: uvnitř definer řetězu není druhá linie, která by ho doplnila.
-- ---------------------------------------------------------------------

create or replace function app.zamestnanec(p_tenant uuid, p_user uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.tenant_id = p_tenant
    and e.user_id = p_user
    and e.deleted_at is null
  order by e.created_at
  limit 1;
$$;

comment on function app.zamestnanec(uuid, uuid) is
  'Zaměstnanecký záznam uživatele v téhle firmě. Živý, jen jeden — '
  'kdyby jich bylo víc, rozhoduje ten starší.';

revoke all on function app.zamestnanec(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. app.is_owner — DESÁTÁ KOPIE, v nálezech chybí
--
-- Majitelství je od téhle chvíle vlastnost ČLOVĚKA (`employees.je_majitel`),
-- ne role u členství. Členství se pořád ptáme na to, jestli člověk do
-- firmy patří a je aktivní — bez toho by majitelem zůstal i ten, komu
-- se přístup zrušil.
-- ---------------------------------------------------------------------

create or replace function app.is_owner(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.employees e on e.user_id   = m.user_id
                           and e.tenant_id = p_tenant
                           and e.deleted_at is null
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and e.je_majitel
  );
$$;

comment on function app.is_owner(uuid) is
  'Je přihlášený majitel téhle firmy? Majitelství drží employees.je_majitel, '
  'členství jen dokládá, že do firmy pořád patří.';


-- ---------------------------------------------------------------------
-- 2. app.kdo_ma_pravo — komu poslat upozornění
-- ---------------------------------------------------------------------

create or replace function app.kdo_ma_pravo(p_tenant uuid, p_permission text)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id
  from public.memberships m
  join public.employees e        on e.user_id   = m.user_id
                                and e.tenant_id = p_tenant
                                and e.deleted_at is null
  join public.permissions p      on p.key = p_permission
  join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                and tm.module_key = p.module_key
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now())
    and app.ma_pravo_clovek(p_tenant, e.id, p_permission);
$$;

comment on function app.kdo_ma_pravo(uuid, text) is
  'Kdo ve firmě má dané právo. Podle práva, ne podle názvu zařazení.';

revoke all on function app.kdo_ma_pravo(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. app.kdo_ma_pravo_na_pobocce — hlášení o zapomenutých odchodech
--
-- Blok rozsahu je opsaný znak po znaku z dnešní verze.
-- ---------------------------------------------------------------------

create or replace function app.kdo_ma_pravo_na_pobocce(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid
)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id
  from public.memberships m
  join public.employees e        on e.user_id   = m.user_id
                                and e.tenant_id = p_tenant
                                and e.deleted_at is null
  join public.permissions p      on p.key = p_permission
  join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                and tm.module_key = p.module_key
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now())
    and app.ma_pravo_clovek(p_tenant, e.id, p_permission)
    and (
      m.scope = 'tenant'
      or exists (
        select 1 from public.membership_branches mb
        where mb.membership_id = m.id and mb.branch_id = p_branch
      )
    );
$$;

comment on function app.kdo_ma_pravo_na_pobocce(uuid, text, uuid) is
  'Kdo má dané právo na téhle pobočce. Podle práva, ne podle názvu zařazení.';

revoke all on function app.kdo_ma_pravo_na_pobocce(uuid, text, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. app.adresati_vzkazu — komu dojde vzkaz vedení
--
-- "Majitel" byl `roles.is_owner`, teď je to `employees.je_majitel`.
-- "Vedoucí" byl řádek v `role_permissions`, teď je to skládací pravidlo.
--
-- Zůstává, že se majitel u volby `vedouci` mezi adresáty NEOBJEVÍ, i když
-- má právo na všechno: kdo si vybral vedoucího, vybral si vedoucího.
-- ---------------------------------------------------------------------

create or replace function app.adresati_vzkazu(
  p_tenant  uuid,
  p_adresat text,
  p_branch  uuid
)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct e.id
  from public.employees e
  join public.memberships m on m.user_id = e.user_id and m.tenant_id = e.tenant_id
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and e.user_id is not null
    and m.status = 'active'
    and (
      (p_adresat = 'majitel' and e.je_majitel)
      or (
        p_adresat = 'vedouci'
        and not e.je_majitel
        and app.ma_pravo_clovek(p_tenant, e.id, 'people.manage')
        and (
          m.scope = 'tenant'
          or exists (
            select 1 from public.membership_branches mb
            where mb.membership_id = m.id and mb.branch_id = p_branch
          )
        )
      )
    );
$$;

revoke all on function app.adresati_vzkazu(uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. app.visible_branch_ids — dvakrát `m.role_id is not null`
--
-- Ta podmínka znamenala "kdo nemá oprávnění, nemá ani rozsah". Po
-- přepnutí by znamenala něco jiného: člověk s právy ze zařazení a
-- prázdným `role_id` by neviděl ANI JEDNU pobočku a `resolveScope` by
-- ho vyhodil — bez jediného slova o oprávněních (nálezy, oddíl 2).
--
-- Nahrazuje ji zaměstnanecký záznam: od téhle chvíle na něm práva visí,
-- takže kdo ho nemá, nemá odkud je vzít.
-- ---------------------------------------------------------------------

create or replace function app.visible_branch_ids(p_tenant uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select b.id
  from public.memberships m
  join public.branches b on b.tenant_id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and exists (
      select 1 from public.employees e
      where e.tenant_id = p_tenant
        and e.user_id = m.user_id
        and e.deleted_at is null
    )
    and m.scope = 'tenant'
    and b.deleted_at is null
  union
  select mb.branch_id
  from public.memberships m
  join public.membership_branches mb on mb.membership_id = m.id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and exists (
      select 1 from public.employees e
      where e.tenant_id = p_tenant
        and e.user_id = m.user_id
        and e.deleted_at is null
    );
$$;

comment on function app.visible_branch_ids(uuid) is
  'Pobočky, na které přihlášený vidí. Členství bez zaměstnaneckého '
  'záznamu nevrací nic — práva visí na něm, takže bez něj není co dát.';


-- =====================================================================
-- 6. STROP: NIKDO NEPŘIDĚLÍ VÍC, NEŽ MÁ SÁM
--
-- Tohle je z celého přepnutí to nejtišší místo. `app.smi_pridelit`
-- dostávala `role_id`; po přepnutí by jí do něj chodilo prázdno,
-- `ziva_prava_role` by nevrátila nic, `not exists (…)` by bylo pravda
-- a PROŠLO BY VŠECHNO. Pět politik
-- (20260901110000: 153, 160, 165, 192, 200) by přestalo chránit a nic
-- by nespadlo. Pravidlo z docs/pravidlo-neprideluj-vic.md by zůstalo
-- napsané a přestalo platit.
--
-- Zadání 5.5 chce, aby strop platil na OBOJÍ — na práva zařazení
-- i na osobní výjimky. Proto tu strop dostávají čtyři místa, ne dvě:
--
--   position_permissions   co dává zařazení
--   employee_permissions   výjimka u člověka (jen `granted = true`)
--   employees.position_id  přeřazení člověka pod jiné zařazení
--   memberships.scope      rozšíření rozsahu (kde ta práva platí)
--
-- ODEBRÁNÍ SE NEHLÍDÁ NIKDE. Kdo právo bere, nikoho nepovyšuje. Je to
-- stejné rozdělení, jaké má dnes `memberships_delete`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Je to právo dneska živé?
--
-- Právo z modulu, který firma nemá, neotevírá nikomu nic — `has_access`
-- ho odmítne úplně všem, majitele nevyjímaje. Kdyby se do stropu
-- počítalo, nešlo by přidělit zařazení s `finance.read` ani vlastníkovi
-- firmy. Je to tentýž důvod, pro který vznikla `app.ziva_prava_role`.
-- ---------------------------------------------------------------------

create or replace function app.pravo_zive(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.permissions p
    join public.tenant_modules tm on tm.tenant_id = p_tenant
                                 and tm.module_key = p.module_key
    where p.key = p_permission
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
  );
$$;

revoke all on function app.pravo_zive(uuid, text) from public, anon;
grant execute on function app.pravo_zive(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Živá práva zařazení. Nástupce `app.ziva_prava_role`.
-- ---------------------------------------------------------------------

create or replace function app.ziva_prava_zarazeni(p_tenant uuid, p_position uuid)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select pp.permission_key
  from public.position_permissions pp
  join public.permissions p     on p.key = pp.permission_key
  join public.tenant_modules tm on tm.tenant_id = p_tenant
                               and tm.module_key = p.module_key
  where pp.position_id = p_position
    -- Oddíl 7b: filtr na firmu napsaný přímo, i když plyne z `position_id`.
    and pp.tenant_id = p_tenant
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now());
$$;

comment on function app.ziva_prava_zarazeni(uuid, uuid) is
  'Práva zařazení, která ve firmě opravdu něco otevírají. Práva '
  'z modulů, které firma nemá, se nepočítají — nedávají nikomu nic.';

revoke all on function app.ziva_prava_zarazeni(uuid, uuid) from public, anon;
grant execute on function app.ziva_prava_zarazeni(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Živá práva ČLOVĚKA — zařazení, výjimky i majitelská zkratka dohromady.
--
-- Skládací pravidlo se sem neopisuje počtvrté: ptá se `ma_pravo_clovek`.
-- ---------------------------------------------------------------------

create or replace function app.ziva_prava_cloveka(p_tenant uuid, p_employee uuid)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select p.key
  from public.permissions p
  join public.tenant_modules tm on tm.tenant_id = p_tenant
                               and tm.module_key = p.module_key
  where tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now())
    and app.ma_pravo_clovek(p_tenant, p_employee, p.key);
$$;

comment on function app.ziva_prava_cloveka(uuid, uuid) is
  'Co ten člověk ve firmě opravdu má — zařazení, výjimky i majitelská '
  'zkratka. Bez rozsahu: ten drží členství.';

revoke all on function app.ziva_prava_cloveka(uuid, uuid) from public, anon;
grant execute on function app.ziva_prava_cloveka(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- STROP NA ZAŘAZENÍ
--
-- Podpis zůstává `(uuid, uuid, text, uuid[])`, ale druhý parametr už
-- není role, je to ZAŘAZENÍ. Proto `drop` a ne `create or replace`:
-- Postgres neumí u nahrazované funkce přejmenovat parametr, a nechat
-- tam `p_role` by byla lež v podpisu.
--
-- Majitelská větev mizí. Majitel není zařazení, je to vlastnost člověka;
-- kdo ho jmenuje, se ptá `app.is_owner` — a to hlídá spoušť na
-- `employees` níž, ne tahle funkce.
-- ---------------------------------------------------------------------

drop policy if exists memberships_insert        on public.memberships;
drop policy if exists memberships_update        on public.memberships;
drop policy if exists membership_branches_write on public.membership_branches;

drop function if exists app.smi_pridelit(uuid, uuid, text, uuid[]);

create function app.smi_pridelit(
  p_tenant   uuid,
  p_position uuid,
  p_scope    text,
  p_branches uuid[] default '{}'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    -- Firemní rozsah — a taky rozsah bez vyjmenovaných poboček. Kdo
    -- neřekne kam, žádá o všude: ptáme se proto na firemní úroveň.
    -- Beze změny oproti 20260901110000, včetně důvodu.
    when p_scope = 'tenant' or coalesce(array_length(p_branches, 1), 0) = 0
    then not exists (
      select 1 from app.ziva_prava_zarazeni(p_tenant, p_position) k
      where not app.has_access(p_tenant, k, null)
    )
    else not exists (
      select 1
      from app.ziva_prava_zarazeni(p_tenant, p_position) k
      cross join unnest(p_branches) as b(id)
      where not app.has_access(p_tenant, k, b.id)
    )
  end;
$$;

comment on function app.smi_pridelit(uuid, uuid, text, uuid[]) is
  'Smí přihlášený přidělit tohle ZAŘAZENÍ v tomhle rozsahu? Strop podle '
  'docs/pravidlo-neprideluj-vic.md: nikdo nepřidělí víc, než má sám.';

revoke all on function app.smi_pridelit(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function app.smi_pridelit(uuid, uuid, text, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- STROP NA ČLOVĚKA
--
-- Členství přestalo rozdávat práva, ale pořád rozdává ROZSAH — a rozsah
-- je půlka přístupu. Kdo má `people.manage` jen na pobočce A a nastaví
-- číšníkovi s právem `finance.read` rozsah "celá firma", rozdal právo,
-- které sám nikde nemá. Proto strop na členství zůstává; jen se neptá
-- role, ptá se toho člověka.
-- ---------------------------------------------------------------------

create or replace function app.smi_pridelit_zamestnance(
  p_tenant   uuid,
  p_employee uuid,
  p_scope    text,
  p_branches uuid[] default '{}'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    -- Majitele jmenuje jen majitel. Po položkách to porovnat nejde:
    -- majitel katalog práv obchází.
    when exists (
      select 1 from public.employees e
      where e.id = p_employee and e.tenant_id = p_tenant
        and e.deleted_at is null and e.je_majitel
    )
    then app.is_owner(p_tenant)
    when p_scope = 'tenant' or coalesce(array_length(p_branches, 1), 0) = 0
    then not exists (
      select 1 from app.ziva_prava_cloveka(p_tenant, p_employee) k
      where not app.has_access(p_tenant, k, null)
    )
    else not exists (
      select 1
      from app.ziva_prava_cloveka(p_tenant, p_employee) k
      cross join unnest(p_branches) as b(id)
      where not app.has_access(p_tenant, k, b.id)
    )
  end;
$$;

revoke all on function app.smi_pridelit_zamestnance(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function app.smi_pridelit_zamestnance(uuid, uuid, text, uuid[]) to authenticated;


create or replace function app.smi_pridelit_cloveku(
  p_tenant   uuid,
  p_user     uuid,
  p_scope    text,
  p_branches uuid[] default '{}'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.smi_pridelit_zamestnance(
           p_tenant, app.zamestnanec(p_tenant, p_user), p_scope, p_branches);
$$;

comment on function app.smi_pridelit_cloveku(uuid, uuid, text, uuid[]) is
  'Smí přihlášený dát tomuhle člověku tenhle rozsah? Bez zaměstnaneckého '
  'záznamu nemá co rozdávat, takže projde — práva bez něj nejsou.';

revoke all on function app.smi_pridelit_cloveku(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function app.smi_pridelit_cloveku(uuid, uuid, text, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- POLITIKY NA ČLENSTVÍ — beze změny až na to, čeho se strop ptá.
-- ---------------------------------------------------------------------

create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    app.has_access(tenant_id, 'people.manage')
    and app.smi_pridelit_cloveku(tenant_id, user_id, scope)
  );

create policy memberships_update on public.memberships for update to authenticated
  using (
    app.has_access(tenant_id, 'people.manage')
    and user_id <> (select auth.uid())
    and app.smi_pridelit_cloveku(tenant_id, user_id, scope)
  )
  with check (
    app.has_access(tenant_id, 'people.manage')
    and user_id <> (select auth.uid())
    and app.smi_pridelit_cloveku(tenant_id, user_id, scope)
  );

create policy membership_branches_write on public.membership_branches for all to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and app.has_access(m.tenant_id, 'people.manage')
        and app.smi_pridelit_cloveku(m.tenant_id, m.user_id, 'branch', array[branch_id])
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and app.has_access(m.tenant_id, 'people.manage')
        and app.smi_pridelit_cloveku(m.tenant_id, m.user_id, 'branch', array[branch_id])
    )
  );


-- ---------------------------------------------------------------------
-- POLITIKY NA NOVÝCH TABULKÁCH
--
-- 20260908090000 je založila jen se `settings.manage`. Bylo to tehdy
-- správně: nikdo je nečetl, takže nemohly nic přidělit. Od téhle chvíle
-- přidělují všechno, takže na ně patří strop.
--
-- `for all` se rozpadá na tři, aby MAZÁNÍ zůstalo bez stropu. Kdo právo
-- odebírá, nikoho nepovyšuje — a kdyby na mazání strop byl, nešlo by
-- uklidit právo z modulu, který firma mezitím vypnula.
-- ---------------------------------------------------------------------

drop policy if exists position_permissions_write on public.position_permissions;

create policy position_permissions_insert on public.position_permissions
  for insert to authenticated
  with check (
    app.has_access(tenant_id, 'settings.manage', null)
    and (app.has_access(tenant_id, permission_key, null)
         or not app.pravo_zive(tenant_id, permission_key))
  );

create policy position_permissions_update on public.position_permissions
  for update to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null))
  with check (
    app.has_access(tenant_id, 'settings.manage', null)
    and (app.has_access(tenant_id, permission_key, null)
         or not app.pravo_zive(tenant_id, permission_key))
  );

create policy position_permissions_delete on public.position_permissions
  for delete to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null));


drop policy if exists employee_permissions_write on public.employee_permissions;

create policy employee_permissions_insert on public.employee_permissions
  for insert to authenticated
  with check (
    app.has_access(tenant_id, 'settings.manage', null)
    -- `granted = false` právo BERE. Strop se na něj neptá.
    and (not granted
         or app.has_access(tenant_id, permission_key, null)
         or not app.pravo_zive(tenant_id, permission_key))
  );

create policy employee_permissions_update on public.employee_permissions
  for update to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null))
  with check (
    app.has_access(tenant_id, 'settings.manage', null)
    and (not granted
         or app.has_access(tenant_id, permission_key, null)
         or not app.pravo_zive(tenant_id, permission_key))
  );

create policy employee_permissions_delete on public.employee_permissions
  for delete to authenticated
  using (app.has_access(tenant_id, 'settings.manage', null));


-- ---------------------------------------------------------------------
-- STROP NA PŘEŘAZENÍ A NA JMENOVÁNÍ MAJITELE
--
-- Tohle je díra, kterou přepnutí SAMO OTEVÍRÁ, a proto se musí zavřít
-- v téže migraci:
--
--   * `employees_write` (20260823120200:372) pouští celý řádek každému,
--     kdo má `people.manage`. Dokud práva visela na roli, byl `position_id`
--     jen popiska. Od téhle chvíle NESE OPRÁVNĚNÍ — a bez zábrany by si
--     vedoucí směny přeřadil sám sebe pod zařazení Provozní.
--   * `je_majitel` je nový sloupec téže tabulky. Bez zábrany by si ho
--     kdokoli se správou lidí nastavil na `true` a obešel tím všechno.
--     Dneska majitelství přiděluje `app.smi_pridelit` a dá ho jen majitel.
--
-- Proč spoušť a ne politika: politika u UPDATE nevidí starou hodnotu,
-- takže by strop platil i na řádek, kde se `position_id` vůbec nemění —
-- a úprava telefonu by spadla na oprávnění. A hlavně by mlčela: politika
-- neprovede nic a netváří se to jako chyba.
-- ---------------------------------------------------------------------

create or replace function app.hlida_strop_zarazeni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  /*
    Bez přihlášeného člověka není proti komu strop měřit: migrace,
    servisní klíč a definer funkce jako `app.create_tenant` nebo
    `app.accept_invitation`. Ty nejdou přes politiky ani přes tohle —
    rozhoduje o nich to, kdo je smí zavolat.
  */
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' or new.position_id is distinct from old.position_id then
    /*
      ROZHODNOUT: ptá se to na FIREMNÍ úroveň, takže vedoucí pobočky
      se `people.manage` jen na své pobočce nepřeřadí nikoho — ani tam.

      Je to opatrnější strana, ne díra: zařazení nemá pobočku a rozsah
      se dá později rozšířit, takže by se ta práva jednou mohla
      rozprostřít po celé firmě, aniž by o tom kdokoli s firemním
      rozsahem rozhodl. Dnes to nikoho neblokuje — správu lidí po
      pobočkách firma nikomu nedala. Otázka 10 v docs/hlaseni/otazky.md.
    */
    if new.position_id is not null
       and not app.smi_pridelit(new.tenant_id, new.position_id, 'tenant') then
      raise exception
        'Tohle zařazení nemůžete přidělit — nese oprávnění, která sami nemáte.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.je_majitel and (tg_op = 'INSERT' or not old.je_majitel) then
    /*
      Výjimka pro firmu, která majitele zatím nemá: první se jmenuje sám.
      Tudy chodí `app.create_tenant` — zakladatel v tu chvíli majitel
      ještě není a jinou cestou, jak se jím stát, by neměl.

      Firma bez majitele je jinak stav, který hlídá spoušť
      `trg_posledni_majitel`; tohle ji nezeslabuje, jen z ní neudělá
      slepou uličku.
    */
    if app.pocet_majitelu(new.tenant_id, null) > 0
       and not app.is_owner(new.tenant_id) then
      raise exception 'Majitele jmenuje jenom majitel.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $$;

comment on function app.hlida_strop_zarazeni() is
  'Strop u přeřazení a u jmenování majitele. Zařazení nese oprávnění, '
  'takže přeřadit člověka znamená přidělit mu práva.';

drop trigger if exists trg_strop_zarazeni on public.employees;
create trigger trg_strop_zarazeni
  before insert or update on public.employees
  for each row execute function app.hlida_strop_zarazeni();


-- =====================================================================
-- 7. HLÍDAČ POSLEDNÍHO MAJITELE
--
-- Majitelství se přestěhovalo z členství na zaměstnance, takže se
-- přestěhovaly i cesty, kterými o něj firma může přijít. Dnes byly tři
-- (smazání členství, přeřazení na jinou roli, pozastavení členství),
-- nově jsou čtyři a jedna z nich je nová:
--
--   employees.je_majitel  true → false      NOVÁ, tuhle dřív nešlo udělat
--   employees.deleted_at  označení smazaného
--   memberships           smazání i pozastavení
--
-- "Přeřazení na jinou roli" zaniklo: role o majitelství nerozhoduje.
--
-- Počítají se jen majitelé, kteří se DOKÁŽOU PŘIHLÁSIT — tedy ti
-- s aktivním členstvím. Bez něj `has_permission` nepustí ani majitele,
-- takže by "firma má majitele" byla nepravda: měla by ho v tabulce
-- a nikoho, kdo se dostane dovnitř. Je to opatrnější strana: odebrání
-- se spíš odmítne, než aby firma zůstala zamčená.
-- =====================================================================

/*
  Druhý parametr už není členství, je to ZAMĚSTNANEC. Proto `drop`:
  Postgres neumí u nahrazované funkce přejmenovat parametr a `p_krome`
  s jiným významem by byla past pro toho, kdo to po nás převezme.
*/
drop function if exists app.pocet_majitelu(uuid, uuid);

create function app.pocet_majitelu(p_tenant uuid, p_krome_zamestnanec uuid default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and e.je_majitel
    and (p_krome_zamestnanec is null or e.id <> p_krome_zamestnanec)
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = e.tenant_id
        and m.user_id = e.user_id
        and m.status = 'active'
    );
$$;

comment on function app.pocet_majitelu(uuid, uuid) is
  'Kolik má firma majitelů, kteří se dokážou přihlásit: živý zaměstnanec '
  's je_majitel a aktivním členstvím. Volitelně bez jednoho — toho, '
  'kterému se majitelství zrovna bere.';

revoke all on function app.pocet_majitelu(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- HLÍDAČ NA ČLENSTVÍ
--
-- Chytá smazání členství a jeho pozastavení. Změna `role_id` sem už
-- nepatří — role o majitelství nerozhoduje.
-- ---------------------------------------------------------------------

create or replace function app.hlida_posledniho_majitele()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_zamestnanec uuid;
begin
  /*
    KDYŽ MIZÍ CELÁ FIRMA, nemá smysl hlídat, že v ní zůstal majitel.
    `delete from tenants` sem přiteče kaskádou a hlídač by ji odmítl —
    firma by nešla smazat vůbec.

    Dosud to procházelo NÁHODOU: stará podoba hledala `roles.is_owner`
    a při kaskádě už role smazané byly, takže vyšla NULL a hlídač se
    vrátil dřív. Nová podoba se ptá zaměstnance, a ten při mazání firmy
    ještě existovat může. Proto je ta podmínka napsaná nahlas.
  */
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return coalesce(new, old);
  end if;

  -- Neaktivní členství majitelem nedrželo; jeho zánik firmu o majitele
  -- nepřipraví.
  if old.status <> 'active' then
    return coalesce(new, old);
  end if;

  select e.id into v_zamestnanec
  from public.employees e
  where e.tenant_id = old.tenant_id
    and e.user_id = old.user_id
    and e.deleted_at is null
    and e.je_majitel;

  if v_zamestnanec is null then
    return coalesce(new, old);
  end if;

  -- Zůstává aktivní? Pak se nic neubírá.
  if tg_op = 'UPDATE' and new.status = 'active' then
    return new;
  end if;

  if app.pocet_majitelu(old.tenant_id, v_zamestnanec) = 0 then
    raise exception
      'Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;


-- ---------------------------------------------------------------------
-- HLÍDAČ NA ZAMĚSTNANCI
--
-- Dvě cesty: označení za smazaného (pravidlo 9 — mazání je označení)
-- a odebrání majitelství. Ta druhá dnes neexistovala, protože majitelství
-- nebylo sloupec.
-- ---------------------------------------------------------------------

create or replace function app.hlida_majitele_u_zamestnance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Kdo majitel nebyl, o majitelství nepřipraví nikoho.
  if not old.je_majitel or old.deleted_at is not null then
    return new;
  end if;

  -- Zůstává majitelem a živý? Pak se nic neubírá. Úprava jména projde.
  if new.je_majitel and new.deleted_at is null then
    return new;
  end if;

  if app.pocet_majitelu(new.tenant_id, new.id) = 0 then
    raise exception
      'Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;


-- =====================================================================
-- 8. POZVÁNKA
--
-- Zadání 6.5: pozvánka přestává nést roli a bere práva ZE ZAMĚSTNANCE,
-- kterému se posílá. Podpis se nemění (volá ho `lib/` i staré scénáře),
-- ale `p_role` už o ničem nerozhoduje — ukládá se jen jako údaj.
--
-- Dvě kontroly se proto musí ptát jinak, a jedna z nich je díra, kterou
-- nálezy vytkly jmenovitě:
--
--   STROP  se ptal role. Prázdná role = žádná práva = projde všechno.
--          Teď se ptá zaměstnance: co mu dá jeho zařazení a výjimky.
--
--   SMS    zakazovala citlivé právo v ROLI. Po přepnutí by role žádné
--          citlivé právo nenesla a citlivé právo by SMS pozvánkou prošlo
--          — a NIC by to neohlásilo. Teď se ptá zaměstnance.
--
-- Ta SMS je jediná věc z celého oddílu "co jde odložit", která se
-- odložit nesmí (nálezy, oddíl 7).
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
    if not exists (
      select 1 from public.employees e
      where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null
    ) then
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
    scope, branch_ids, token_hash, expires_at, invited_by
  ) values (
    p_tenant, p_role, p_employee, p_channel, v_email, v_phone,
    p_scope, coalesce(p_branches, '{}'),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    now() + make_interval(days => greatest(p_valid_days, 1)),
    (select auth.uid())
  ) returning id into v_id;

  perform app.audit(p_tenant, 'invitation.create', 'invitation', v_id::text, null, null,
                    jsonb_build_object('channel', p_channel, 'employee_id', p_employee));

  return query select v_id, v_token;
end;
$$;


-- =====================================================================
-- 9. CO VIDÍ VYKRESLENÍ
--
-- Tohle je ta část, kvůli které nešlo přepnout jen databázi. Kdyby
-- `my_context` přestala plnit `role` a aplikace zůstala, jak je,
-- skončil by KAŽDÝ VČETNĚ MAJITELE natrvalo na stránce "nikdo vám
-- nepřidělil oprávnění" (nálezy, oddíl 2). Není to smyčka, je to slepá
-- ulice.
--
-- Klíč `role` se proto nepřejmenovává potichu — mizí a na jeho místo
-- přicházejí DVA: `zarazeni` a `jeMajitel`. Jsou to dvě různé věci
-- a slepené do jedné by lhaly: majitel nemusí mít žádné zařazení
-- a zařazení Majitel/ka nedělá z člověka majitele.
--
-- `lib/authz.ts` se mění ve stejném commitu. Kdyby se nezměnil,
-- `raw.role` vyjde `undefined` a je to zase ta slepá ulice — jen bez
-- jediné chybové hlášky. Proto se to nedá odevzdat po polovinách.
-- =====================================================================

create or replace function public.my_tenants()
returns table (
  tenant_id uuid,
  name      text,
  role_key  text,
  role_label text,
  is_owner  boolean,
  scope     text
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name,
         coalesce(po.key, ''), coalesce(po.label, ''),
         coalesce(e.je_majitel, false), m.scope
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  left join public.employees e on e.tenant_id = m.tenant_id
                              and e.user_id   = m.user_id
                              and e.deleted_at is null
  left join public.positions po on po.id = e.position_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.deleted_at is null
  order by t.name;
$$;

comment on function public.my_tenants() is
  'Firmy přihlášeného. `is_owner` chodí z employees.je_majitel, '
  'název z jeho zařazení — role už o ničem nerozhodují.';

revoke all on function public.my_tenants() from public, anon;
grant execute on function public.my_tenants() to authenticated;


create or replace function public.my_context(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id',       t.id,
      'name',     t.name,
      'currency', t.currency,
      'timezone', t.timezone
    ),
    'membership', jsonb_build_object(
      'scope',  m.scope,
      'status', m.status
    ),
    /*
      Zařazení. `null` znamená "nemá žádné" — a to je něco jiného než
      "nemá oprávnění": majitel bez zařazení má práva na všechno
      a člověk se zařazením bez práv nemá nic. Vykreslení se proto
      neptá tohohle klíče, ptá se `permissions` a `jeMajitel`.
    */
    'zarazeni', case when po.id is null then null::jsonb else jsonb_build_object(
      'id',    po.id,
      'key',   po.key,
      'label', po.label
    ) end,
    'jeMajitel', coalesce(e.je_majitel, false),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',    mo.key,
               'label',  mo.label,
               'isBase', mo.is_base,
               'active', tm.tenant_id is not null
             ) order by mo.sort_order)
      from public.modules mo
      left join public.tenant_modules tm
             on tm.module_key = mo.key
            and tm.tenant_id  = t.id
            and tm.status in ('active', 'trial')
            and (tm.valid_until is null or tm.valid_until > now())
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',    b.id,
               'name',  b.name,
               'slug',  b.slug,
               'color', b.color
             ) order by b.name)
      from public.branches b
      where b.tenant_id = t.id
        and b.deleted_at is null
        and b.active
        and b.id in (select app.visible_branch_ids(t.id))
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(p.key order by p.sort_order)
      from public.permissions p
      where app.has_permission(t.id, p.key)
    ), '[]'::jsonb)
  )
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  left join public.employees e on e.tenant_id = m.tenant_id
                              and e.user_id   = m.user_id
                              and e.deleted_at is null
  left join public.positions po on po.id = e.position_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and t.deleted_at is null;
$$;

revoke all on function public.my_context(uuid) from public, anon;
grant execute on function public.my_context(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- KDO ČEKÁ NA OPRÁVNĚNÍ
--
-- Mělo natvrdo `and m.role_id is null`. Po přepnutí by okno hlásilo
-- KAŽDÉHO SPRÁVNĚ NASTAVENÉHO ČLOVĚKA, napořád (nálezy, oddíl 2).
--
-- Nová podmínka se ptá na to, co ta stará znamenala: nemá odkud vzít
-- ani jedno právo. Neptá se `has_permission` — ta se ptá `auth.uid()`,
-- takže by odpovídala za přihlášeného, ne za toho, koho počítáme.
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
                      where pp.position_id = e.position_id)
          or exists (select 1 from public.employee_permissions ep
                      where ep.employee_id = e.id and ep.granted)
        )
    )
    and app.has_access(p_tenant, 'people.manage')
  order by m.created_at;
$$;

comment on function public.cekaji_na_opravneni(uuid) is
  'Kdo je ve firmě, ale nemá odkud vzít ani jedno právo — bez '
  'zaměstnance, bez zařazení s právy a bez výjimky. Pro okno při '
  'přihlášení: ukazuje se jen tehdy, když je co dělat.';

revoke all on function public.cekaji_na_opravneni(uuid) from public, anon;
grant execute on function public.cekaji_na_opravneni(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- "BYLO VÁM PŘIDĚLENO OPRÁVNĚNÍ"
--
-- Spoušť na členství. Podmínka `new.role_id is null` by po přepnutí
-- byla pravda vždycky a zpráva by PŘESTALA CHODIT — tiše.
--
-- ROZHODNOUT: zpráva pořád visí na členství, ne na zařazení. Kdo dostane
-- zařazení až týden po přijetí pozvánky, se to tímhle kanálem nedozví.
-- Spoušť na `employees` by to spravila, ale je to nové chování, ne
-- přepnutí — otázka 9 v docs/hlaseni/otazky.md.
--
-- Klíč `role` v těle zprávy ZŮSTÁVÁ, i když se do něj plní zařazení:
-- čte ho `lib/upozorneni-text.ts:124` a hlavně už jsou s ním v databázi
-- staré zprávy. Přejmenovat ho znamená, že staré zprávy zůstanou bez
-- textu.
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
                    where pp.position_id = e.position_id)
        or exists (select 1 from public.employee_permissions ep
                    where ep.employee_id = e.id and ep.granted)
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


-- =====================================================================
-- 10. ZALOŽENÍ FIRMY
--
-- Bez tohohle by NOVÁ FIRMA VZNIKLA BEZ MAJITELE a bez jediného
-- zařazení: zakladatel by dostal členství s majitelskou rolí, která
-- už o ničem nerozhoduje, a `has_permission` by mu nevrátila nic.
-- Vlastní firma by ho nepustila dovnitř.
--
-- Mění se dvě věci a obě jsou nutné:
--
--   1. zakladatel dostane `je_majitel = true`,
--   2. ze šablon rolí vzniknou i ZAŘAZENÍ s týmiž právy.
--
-- Ta druhá kopíruje to, co pro existující firmy udělal převod
-- (20260908090000, krok 4): připravené sady pro lidi, které bude
-- majitel zvát. Bez nich by nová firma měla sedm rolí, které nic
-- nedělají, a nula zařazení, která něco dělají.
--
-- Role se pořád zakládají. Nemažou se (pravidlo o nasazených
-- migracích) a `tasks.role_id` se jich pořád drží.
--
-- ROZHODNOUT: úkol zadaný ROLI (`tasks.role_id`) se doručuje podle
-- `memberships.role_id`, a to se novým lidem přestalo vyplňovat.
-- Dnes to nikoho netrápí — takový úkol neumí zadat žádná obrazovka —,
-- ale kdyby ho někdo zadal ručně, došel by jen lidem z doby před
-- přepnutím. Otázka 8 v docs/hlaseni/otazky.md.
-- =====================================================================

create or replace function app.create_tenant(
  p_name      text,
  p_full_name text,
  p_ico       text default null,
  p_dic       text default null,
  p_currency  char(3) default 'CZK',
  p_timezone  text default 'Europe/Prague'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_tenant   uuid;
  v_owner    uuid;
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  t          record;
begin
  if v_user is null then
    raise exception 'Založit firmu může jen přihlášený uživatel.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Účet nemá profil. Dokončete prosím registraci.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Název firmy je povinný.' using errcode = 'check_violation';
  end if;

  -- Bez jména se firma nezaloží. Radši se zeptat než vyrobit
  -- zaměstnance, který se jmenuje jako začátek e-mailové adresy.
  if v_name is null then
    raise exception 'Zadejte prosím své jméno a příjmení.'
      using errcode = 'check_violation';
  end if;

  insert into public.tenants (name, legal_name, ico, dic, currency, timezone, created_by)
  values (btrim(p_name), btrim(p_name), nullif(btrim(p_ico), ''),
          nullif(btrim(p_dic), ''), p_currency, p_timezone, v_user)
  returning id into v_tenant;

  -- Základní modul. Ostatní si firma zapne sama.
  insert into public.tenant_modules (tenant_id, module_key, status)
  select v_tenant, m.key, 'active' from public.modules m where m.is_base;

  -- Role vznikají jako kopie šablon. O přístupu už nerozhodují, ale
  -- nemažou se — visí na nich `tasks.role_id` a nasazené migrace.
  for t in
    select rt.key, rt.label, rt.is_owner from app.role_templates rt order by rt.sort_order
  loop
    insert into public.roles (tenant_id, key, label, is_owner, system_template)
    values (v_tenant, t.key, t.label, t.is_owner, t.key);
  end loop;

  insert into public.role_permissions (role_id, permission_key)
  select r.id, rtp.permission_key
  from public.roles r
  join app.role_template_permissions rtp on rtp.template_key = r.system_template
  where r.tenant_id = v_tenant;

  /*
    A TEĎ ZAŘAZENÍ — to, co od téhle chvíle opravdu rozdává práva.

    Majitelská šablona se vynechává schválně: majitel je vlastnost
    člověka (`je_majitel`), ne pracovní zařazení. Zařazení "Majitel/ka"
    si firma může založit, ale majitelem nikoho neudělá.

    `department` se odvozuje jen tam, kde se klíč trefí do dnešního
    pevného výčtu; jinak `provoz`. Je to totéž, co dělá převod
    v 20260908090000, a ze stejného důvodu: `department` stejně končí,
    nahradí ho `useky`.
  */
  insert into public.positions (tenant_id, key, label, department, active)
  select v_tenant, rt.key, rt.label,
         case when rt.key in ('kuchyne', 'bar', 'servis') then rt.key else 'provoz' end,
         true
  from app.role_templates rt
  where not rt.is_owner;

  insert into public.position_permissions (tenant_id, position_id, permission_key)
  select v_tenant, po.id, rtp.permission_key
  from public.positions po
  join app.role_template_permissions rtp on rtp.template_key = po.key
  where po.tenant_id = v_tenant;

  select id into v_owner from public.roles
  where tenant_id = v_tenant and is_owner;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (v_tenant, v_user, v_owner, 'active', 'tenant');

  -- Zakladatel dostane jméno, které sám zadal, a doplní se i do profilu,
  -- pokud tam žádné nebylo.
  update public.profiles
     set full_name = v_name
   where user_id = v_user and btrim(coalesce(full_name, '')) = '';

  /*
    Zakladatel je majitel. Bez tohohle řádku by mu nová firma nedala
    ani jedno právo — `has_permission` se od téhle migrace ptá
    `je_majitel`, ne role.

    Spoušť `trg_strop_zarazeni` tohle propustí: `auth.uid()` uvnitř
    definer funkce přihlášeného vrací, takže se strop uplatní — jenže
    firma v tu chvíli žádného majitele nemá a spoušť má pro ten případ
    výslovnou výjimku (první se jmenuje sám). Členství se zakládá o pár
    řádků výš než tenhle insert, takže `app.pocet_majitelu` v tu chvíli
    vrací nulu.
  */
  insert into public.employees (tenant_id, user_id, full_name, employment_type, je_majitel)
  values (v_tenant, v_user, v_name, 'ico', true);

  perform app.audit(v_tenant, 'tenant.create', 'tenant', v_tenant::text,
                    null, null, jsonb_build_object('name', btrim(p_name)));

  return v_tenant;
end;
$$;

grant execute on function app.create_tenant(text, text, text, text, char, text) to authenticated;


-- =====================================================================
-- 11. JEDENÁCTÁ KOPIE — „přijal pozvánku a čeká na oprávnění"
--
-- `app.upozorni_na_prijeti` (20260902070000:135) rozhoduje podle
-- `v_member.role_id is null`, jestli je nový člověk ÚKOL, nebo jen
-- INFORMACE. Po přepnutí by `role_id` bylo prázdné vždycky, takže by
-- se každý nový člověk hlásil jako čekající — i ten, komu zařazení
-- dává všechno.
--
-- Nálezy ani měření tuhle funkci nevyjmenovaly. Našla se až tím, že
-- na ni míří `krok12_scenar` — a to je přesně ten důvod, proč se
-- scénáře pouští, místo aby se výčet odškrtal.
-- =====================================================================

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
                       where pp.position_id = e.position_id)
           or exists (select 1 from public.employee_permissions ep
                       where ep.employee_id = e.id and ep.granted)
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

comment on function app.upozorni_na_prijeti(uuid, uuid) is
  'Zvoneček všem, kdo ve firmě spravují lidi. Dva různé texty: kdo nemá '
  'odkud vzít žádné právo, je úkol; kdo je má, je informace.';

revoke all on function app.upozorni_na_prijeti(uuid, uuid) from public, anon, authenticated;
