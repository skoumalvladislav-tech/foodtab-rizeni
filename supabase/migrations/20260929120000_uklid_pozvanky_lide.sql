-- =====================================================================
-- Foodtab — úklid otázky 18 (body d, f): stará role v e-mailu o přijetí,
--          jméno smazaného autora na Nástěnce
--
-- Zadání Šéfíka 29. 9. 2026: „projdi staré otevřené otázky v
-- docs/hlaseni/otazky.md a dotáhni ty, které jsou čistě technický
-- nedodělek, ne obchodní rozhodnutí." Body d a f otázky 18
-- (docs/hlaseni/otazky.md) mají jasné doporučení a nejsou obchodní
-- rozhodnutí — body a/b/c/h/i/j zůstávají nedotčené (ty na majiteli).
--
-- ---------------------------------------------------------------------
-- D) public.komu_ohlasit_prijeti — „čeká" počítané podle staré role
--
-- Firma přešla 9. 9. 2026 (20260909100000_zarazeni_jadro.sql) na
-- zařazení (`employees.position_id`, `position_permissions`,
-- `employee_permissions`, `je_majitel`) jako zdroj pravdy o právech.
-- `memberships.role_id` od té doby o ničem nerozhoduje — migrace
-- 20260925150000 to výslovně zapsala do „CO SE SCHVÁLNĚ NEDĚLÁ" jako
-- dluh pro otázku 18.
--
-- `komu_ohlasit_prijeti` PŘÍJEMCE (`app.kdo_ma_pravo`) už počítala
-- správně — ta funkce se přepsala už v 20260909100000. Zůstal jen
-- sloupec `ceka` (jde ten, kdo právě přijal pozvánku, čekat na
-- oprávnění, nebo už nějaké má?), který se pořád ptal
-- `m.role_id is null`. Nová podmínka je STEJNÝ vzor, jaký používá
-- `public.cekaji_na_opravneni` (20260925150000, oddíl 8): živý záznam
-- v Lidech, který má buď majitelství, nebo aspoň jedno právo ze svého
-- zařazení nebo z výjimky.
--
-- ---------------------------------------------------------------------
-- F) Autor smazaného oznámení na Nástěnce zůstane bez jména
--
-- Nástěnka (app/[rozsah]/vzkazy/nastenka.tsx) čte jména autorů přímo
-- z `public.profiles` (`user_id in (…)`). Politika
-- `profiles_select_colleagues` pustí cizí profil jen mezi dvěma
-- AKTIVNÍMI členstvími — a smazání člověka v Lidech pozastaví jeho
-- členství (20260925150000, oddíl 7, `trg_clenstvi_podle_zaznamu`).
-- Autor starého oznámení, kterého mezitím smazali, tak ze čtení
-- profilů tiše vypadne a jméno v `autori` chybí (seznam-oznameni.tsx
-- ho pak jednoduše přeskočí, `.filter(Boolean)`).
--
-- Historie autorství se ztrácet nemá — appka jinde ukazuje „kdo
-- zapsal" i u smazaných lidí (např. `public.lide_v_rozhovoru`,
-- 20260927100000, které jméno z `employees` bere BEZ ohledu na
-- `deleted_at`). `public.jmena_autoru_oznameni` dělá totéž pro autory
-- oznámení: SECURITY DEFINER obchází `profiles_select_colleagues`
-- a jméno bere z živého i smazaného záznamu v Lidech (a jen když
-- v Lidech není vůbec, z profilu). Filtr živý/smazaný zůstává tam, kde
-- pořád patří — u DOSAHU, ne u zobrazení jména.
--
-- DOSAH ALE NENÍ jen „má volající communication.read" (to je nutná
-- podmínka, ne dostatečná) — funkce navíc SAMA korelačně ověří, že
-- požadované user_id je opravdu autorem oznámení, které volající smí
-- vidět (stejná tři pravidla jako politika `announcements_read`,
-- 20260913160000: osobní/úsekové/poziční cíl). SECURITY DEFINER uvnitř
-- žádné RLS na `announcements` neuplatní a `p_user_ids` je pole od
-- volajícího přes `supabase.rpc()`, ne odvozené ze skutečně viditelných
-- řádků (na rozdíl od `public.lide_v_rozhovoru`, který si účastníky
-- odvozuje sám z `p_konverzace`) — bez týhle korelace by funkce vrátila
-- jméno KOHOKOLI v tenantu (i z jiné pobočky/úseku nebo bez jakéhokoli
-- oznámení) komukoli s pouhým `communication.read` na jedné pobočce.
-- =====================================================================


-- ---------------------------------------------------------------------
-- D) Přepis `ceka` v komu_ohlasit_prijeti — příjemci beze změny
-- ---------------------------------------------------------------------

create or replace function public.komu_ohlasit_prijeti(p_tenant uuid)
returns table (adresa text, jmeno text, firma text, kdo_prijal text, ceka boolean)
language sql stable security definer set search_path = ''
as $$
  select
    p.email,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    t.name,
    coalesce(nullif(btrim(ja.full_name), ''), ja.email, 'Nový člověk'),
    -- Stejný vzor jako cekaji_na_opravneni (20260925150000, oddíl 8):
    -- žádný živý záznam v Lidech, nebo záznam bez majitelství, bez
    -- práva ze zařazení a bez vlastní výjimky → pořád čeká.
    coalesce(
      (
        select not (
          e.je_majitel
          or exists (
               select 1 from public.position_permissions pp
                where pp.position_id = e.position_id
                  and pp.tenant_id = p_tenant
             )
          or exists (
               select 1 from public.employee_permissions ep
                where ep.employee_id = e.id and ep.granted
                  and ep.tenant_id = p_tenant
             )
        )
        from public.employees e
        where e.tenant_id = p_tenant
          and e.user_id = (select auth.uid())
          and e.deleted_at is null
      ),
      true
    )
  from app.kdo_ma_pravo(p_tenant, 'people.manage') k
  join public.profiles p on p.user_id = k.user_id
  cross join public.tenants t
  join public.profiles ja on ja.user_id = (select auth.uid())
  where t.id = p_tenant
    and p.email is not null
    -- Kdo si e-maily vypnul, dostane jen zvoneček.
    and p.upozorneni_emailem
    -- Jen ten, kdo do téhle firmy právě vstoupil.
    and exists (
      select 1 from public.invitations i
      where i.tenant_id = p_tenant
        and i.accepted_by = (select auth.uid())
        and i.accepted_at > now() - interval '5 minutes'
    );
$$;

comment on function public.komu_ohlasit_prijeti(uuid) is
  'Adresy lidí, kteří ve firmě spravují lidi — jen pro toho, kdo do ní '
  'právě vstoupil, a jen pět minut po přijetí pozvánky. „ceka" počítá '
  'podle AKTUÁLNÍHO systému práv (zařazení, výjimky, majitelství) — '
  'ne podle memberships.role_id (otázka 18 d, 29. 9. 2026).';

revoke all on function public.komu_ohlasit_prijeti(uuid) from public, anon;
grant execute on function public.komu_ohlasit_prijeti(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- F) public.jmena_autoru_oznameni — jméno autora i po smazání záznamu
-- ---------------------------------------------------------------------

create function public.jmena_autoru_oznameni(
  p_tenant    uuid,
  p_branch    uuid,
  p_user_ids  uuid[]
)
returns table (user_id uuid, jmeno text)
language sql stable security definer set search_path = ''
as $$
  select
    uid.user_id,
    coalesce(
      nullif(btrim(e.full_name), ''),
      nullif(btrim(p.full_name), ''),
      'Neznámý'
    )
  from unnest(p_user_ids) as uid(user_id)
  -- Žádné `and e.deleted_at is null` — jméno se bere i ze smazaného
  -- záznamu. Dosah hlídá WHERE níž, ne tenhle JOIN.
  left join public.employees e on e.user_id = uid.user_id and e.tenant_id = p_tenant
  left join public.profiles p  on p.user_id = uid.user_id
  where exists (
    -- Požadované user_id smí projít, jen když je opravdu autorem
    -- oznámení, které by volající uměl přečíst i přímo (stejná tři
    -- pravidla jako politika `announcements_read`,
    -- 20260913160000_nastenka_adresat.sql). SECURITY DEFINER výš
    -- žádné RLS na `announcements` neuplatní a `p_user_ids` je pole od
    -- volajícího — bez týhle korelace by prošlo libovolné id v tenantu
    -- (review otázky 18 f, 29. 9. 2026).
    select 1
      from public.announcements a
     where a.tenant_id = p_tenant
       and a.author_id = uid.user_id
       and (a.branch_id is null or a.branch_id = p_branch)
       and app.can_read_scoped(a.tenant_id, 'communication.read', a.branch_id)
       and (
         a.employee_id is null
         or a.employee_id in (
              select e2.id from public.employees e2
               where e2.user_id = (select auth.uid())
            )
         or app.has_access(a.tenant_id, 'communication.manage', a.branch_id)
       )
       and (
         a.usek_id is null
         or a.usek_id in (
              select e2.usek_id from public.employees e2
               where e2.user_id    = (select auth.uid())
                 and e2.deleted_at is null
                 and e2.usek_id    is not null
            )
         or app.has_access(a.tenant_id, 'communication.manage', a.branch_id)
       )
       and (
         a.position_id is null
         or a.position_id in (
              select e2.position_id from public.employees e2
               where e2.user_id    = (select auth.uid())
                 and e2.deleted_at is null
                 and e2.position_id is not null
            )
         or app.has_access(a.tenant_id, 'communication.manage', a.branch_id)
       )
  );
$$;

comment on function public.jmena_autoru_oznameni(uuid, uuid, uuid[]) is
  'Jméno autora oznámení na Nástěnce, i když je jeho záznam v Lidech '
  'smazaný — filtr live/smazaný zůstává jen pro dosah, ne pro zobrazení '
  'jména (otázka 18 f, 29. 9. 2026). security definer obchází '
  '`profiles_select_colleagues`, která pustí jen aktivní členství na '
  'obou stranách — smazání autora ho pozastaví (20260925150000, '
  'oddíl 7) a čtení jeho profilu by jinak tiše nevrátilo nic. Dosah si '
  'funkce ověřuje sama (WHERE exists proti announcements se stejnými '
  'třemi pravidly jako `announcements_read`), ne jen podle '
  '`communication.read` na volajícím — jinak by vrátila jméno kohokoli '
  'v tenantu pro libovolné cizí user_id (review otázky 18 f).';

revoke all on function public.jmena_autoru_oznameni(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.jmena_autoru_oznameni(uuid, uuid, uuid[]) to authenticated;
