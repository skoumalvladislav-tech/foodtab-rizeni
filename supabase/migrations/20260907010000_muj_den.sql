-- =====================================================================
-- Foodtab — „Dnes": jeden dotaz na to, co člověk potřebuje vědět
--
-- Zadání docs/dnes-obrazovka-zadani.md. Obrazovka je vedle,
-- v app/[rozsah]/dnes. Tenhle krok jde nasadit sám — dokud ho nikdo
-- nevolá, jen leží.
--
-- ---------------------------------------------------------------------
-- PROČ TO NEJDE PŘEČÍST PŘÍMO Z TABULKY
--
-- Docházka si dnes „jsem v práci" zjišťuje sama, přímým dotazem na
-- poslední událost:
--
--     select ... from attendance_events
--     where employee_id = ja.id
--     order by occurred_at desc limit 1
--     → jsemVPraci = kind in ('in', 'break_end')
--
-- To je ale JINÁ DEFINICE než ta, kterou má databáze. Ten dotaz
-- nefiltruje `stornovano_kdy`, nefiltruje `uzavreno_systemem` ani
-- pobočku — takže stornovaný příchod nebo příchod uzavřený systémem
-- pořád tvrdí „jste v práci".
--
-- Kdyby si to Dnes počítalo potřetí po svém, máme tři různé odpovědi
-- na jednu otázku a rozejdou se. Bere se proto `app.otevreny_prichod`
-- (20260905010000) — tatáž funkce, na které stojí panel nedokončených
-- i pravidlo o dvojím příchodu.
--
-- `app.otevreny_prichod` nemá `authenticated` udělené schválně: je to
-- vnitřní funkce. Tohle je průzor k ní.
--
-- ---------------------------------------------------------------------
-- NOČNÍ SMĚNA SE MUSÍ UKÁZAT
--
-- Zadání, bod 3: „Když je otevřený příchod z včerejška (noční), karta
-- ukáže jeho, ne dnešek."
--
-- Proto se tu NEPOUŽÍVÁ `app.smena_ted`, i když je po ruce. Ta je od
-- doručování zpráv a od 6. 9. schválně končí s provozním dnem, ve
-- kterém se píchlo (rozhodnutí Šéfíka: zapomenutý odchod nesmí držet
-- člověka „ve službě" a zvonit mu ve tři ráno).
--
-- Na kartě je to ale obráceně: člověk, který má otevřený příchod
-- z včerejška, se na to potřebuje podívat PRÁVĚ PROTO, že je něco
-- špatně — buď dělá noční, nebo zapomněl odejít. Schovat mu to
-- znamená, že se to nedozví.
-- =====================================================================

create or replace function public.muj_den(p_tenant uuid)
returns table (
  employee_id   uuid,
  v_praci       boolean,
  -- Od kdy je v práci. NULL, když není.
  od_kdy        timestamptz,
  -- Kolik minut už je v práci. Počítá to DATABÁZE, ne obrazovka:
  -- `Date.now()` uvnitř vykreslení je nečistá funkce (eslint na to má
  -- pravidlo `react-hooks/purity`) a hlavně by se počítalo z jiného
  -- času než `od_kdy`, které přišlo odsud — ty dva údaje by se pak
  -- mohly rozejít.
  minut_v_praci integer,
  -- Provozní den toho otevřeného příchodu. Když je starší než dnešek,
  -- obrazovka to má říct nahlas — je to buď noční, nebo zapomenutý
  -- odchod.
  den_prichodu  date,
  -- Pobočka, kde má otevřený příchod; jinak domovská.
  pobocka       uuid,
  pobocka_nazev text,
  -- Dnešní provozní den té pobočky. Ne `current_date`: provozní den
  -- začíná v 05:00 (pravidlo 10).
  provozni_den  date
)
language sql stable security definer set search_path = ''
as $$
  with ja as (
    select e.id, e.branch_id
    from public.employees e
    where e.tenant_id = p_tenant
      and e.user_id = (select auth.uid())
      and e.deleted_at is null
    limit 1
  ),
  otevreny as (
    select o.branch_id, o.business_date, o.occurred_at
    from ja, app.otevreny_prichod(p_tenant, ja.id) o
  )
  select
    ja.id,
    (select true from otevreny limit 1) is not null,
    (select o.occurred_at from otevreny o),
    (select greatest(0, floor(extract(epoch from (now() - o.occurred_at)) / 60))::int
       from otevreny o),
    (select o.business_date from otevreny o),
    coalesce((select o.branch_id from otevreny o), ja.branch_id),
    (select b.name from public.branches b
      where b.id = coalesce((select o.branch_id from otevreny o), ja.branch_id)),
    app.business_date(
      coalesce((select o.branch_id from otevreny o), ja.branch_id), now())
  from ja
  -- Vypnutý modul odmítne i přímé volání (pravidlo 5). Bez zaměstnaneckého
  -- záznamu se nevrací nic — brigádník bez účtu se sem nepřihlásí.
  where app.modul_zapnuty(p_tenant, 'provoz');
$$;

comment on function public.muj_den(uuid) is
  'Co potřebuje karta na obrazovce Dnes: jestli je člověk v práci, od '
  'kdy, na které pobočce a jaký je tam provozní den. „V práci" se bere '
  'z app.otevreny_prichod — tatáž definice jako u panelu nedokončených, '
  'ne čtvrtá vlastní.';

revoke all on function public.muj_den(uuid) from public, anon;
grant execute on function public.muj_den(uuid) to authenticated;
