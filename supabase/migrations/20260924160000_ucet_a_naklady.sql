-- =====================================================================
-- Foodtab — pracovní účet zaměstnance a denní náklady na mzdy
--
-- Zadání majitele 24. 9. 2026 večer: „pro majitele potřebuji vidět
-- kolik kdo má zůstatek a dále denní přehled nákladů na mzdy a odečtené
-- zálohy. zaměstnanec ať má možnost vidět svůj výdělek a odebrané
-- zálohy, to bych zahrnul do sekce docházka. dal bych tam přehled
-- pracovního účtu."
--
-- Zůstatek po lidech už Výdělky mají (sloupec Zbývá z vydelky_prehled,
-- 20260924140000). Tady přibývají zdroje pro dvě nové části obrazovky:
--   1. app.vydelek_po_dnech   — app.earnings rozložená po provozních dnech
--   2. public.vydelky_po_dnech — Výdělky → oddíl „Po dnech" (vedení)
--   3. public.muj_pracovni_ucet — Docházka → záložka „Můj účet" (každý sám)
--   4. public.muj_vyplatni_prehled — dvě pojistky navíc (oprava starší
--      díry, nalezená kontrolou shody v krok59; beze změny sloupců)
--
-- ---------------------------------------------------------------------
-- ROZHODNUTÍ (nejopatrnější varianty; otázky pro Šéfíka v hlášení)
--
-- A. MZDA PO DNECH NENÍ NOVÝ VÝPOČET. Je to app.earnings rozložená na
--    dny: tytéž minuty (app.worked_minutes), táž sazba ke dni
--    (app.rate_at). earnings ale zaokrouhluje až SOUČET za měsíc —
--    round(Σ minut × sazba / 60). Kdyby se zaokrouhlil každý den zvlášť,
--    vyšel by jiný součet (až o haléř na den a člověka) a „Po dnech" by
--    se nesešlo s „Po lidech" ani s tím, co vidí zaměstnanec. Haléře se
--    proto dělí METODOU NEJVĚTŠÍHO ZBYTKU: každý den dolů, a chybějící
--    haléře (0 až počet dnů) dostanou dny s největším zbytkem, při shodě
--    ten dřívější. Součet dnů je přesně earnings; každý den se od přesné
--    hodnoty liší o méně než haléř. Hlídá krok59, oddíl 2.
--
-- B. POČÍTÁ SE V CELÝCH ČÍSLECH: minut × sazba jako bigint, den dolů
--    celočíselným dělením, zbytek po dělení 60. Ne dělením po dnech —
--    numeric 1/3 se uřízne na pevný počet míst a součet uříznutých
--    by přesné x,5 zaokrouhlil jinam než earnings.
--
-- C. KDO JE V PŘEHLEDU PO DNECH = přesně vydelky_prehled: s p_branch
--    lidé s tou DOMOVSKOU pobočkou, a jejich hodiny i zálohy ze všech
--    poboček. „Náklady pobočky" tu tedy NEJSOU náklady podle místa
--    práce — kdo z pobočky A vypomůže na B, započte se na A. Jinak by se
--    součet po dnech nesešel s tabulkou po lidech nad ním; rozdělit mzdu
--    podle místa práce by znamenalo počítat worked_minutes po pobočkách,
--    tedy jinak než mzda. Otázka pro Šéfíka.
--
-- D. PRÁVA po dnech = vydelky_prehled, bod 8: payroll.read s rozsahem,
--    řádky lidí BEZ POBOČKY (majitel) jen s payroll.read na firemní
--    úrovni. Vedoucí jedné pobočky v denním součtu majitelovy hodiny
--    nemá — ze součtu se dá odečíst, co by nesměl vidět po lidech.
--
-- E. ZÁLOHY: nestornované, i nepotvrzené (jako vydelky_prehled
--    a muj_vyplatni_prehled — jinak by se součty nesešly), podle
--    business_date = provozní den výdeje, ze všech poboček. Nepotvrzené
--    se počítají zvlášť, ať je vidět, co ještě čeká na potvrzení (PINem
--    na tabletu, v telefonu, nebo za zaměstnance majitelem — jak, to
--    tu není; sloupec potvrzeno_jak přidává až 20260925100000).
--
-- F. DEN BEZ SAZBY: odpracované minuty jsou vidět, peníze za ně
--    v částce chybí (jako v earnings) a řádek to nese příznakem. Nikdy
--    nula, která by vypadala jako výsledek (zadání mezd, oddíl 6).
--
-- G. ŘÁDKY JSOU JEN DNY, KDY SE NĚCO STALO: uzavřená docházka (i nulový
--    pár — je to záznam a earnings ho počítá taky) nebo záloha. Den bez
--    obojího se nevrací.
--
-- H. MŮJ ÚČET je jen pro SEBE a nemá parametr zaměstnance — kdo je
--    „já", říká auth.uid(). Filtry jako muj_vyplatni_prehled: firma,
--    účet, nesmazaný záznam, živé členství. Bez `limit 1`: employees má
--    unique (tenant_id, user_id), a kdyby se některý filtr ztratil,
--    má se to projevit cizími řádky, ne tiše vybraným jedním člověkem.
--
-- I. ZALOHY_ZOBRAZENI SE UPLATNÍ UVNITŘ FUNKCE (muj_vyplatni_prehled
--    vrací všechno a skrývá aplikace): neukazovat → sloupce záloh NULL
--    a dny jen se zálohou se nevracejí; jen_ukazat → zůstatek NULL;
--    odecitat → všechno. Zámek to NENÍ — svoje zálohy si zaměstnanec
--    přečte i z public.advances (politika advances_select). Je to
--    pojistka, aby obrazovka nemohla omylem ukázat, co si firma nepřeje.
--    Volba chodí v každém řádku, ať obrazovka ví, proč sloupec chybí.
--
-- J. PRŮBĚŽNÝ ZŮSTATEK = vyděláno do toho dne včetně − zálohy do toho
--    dne včetně. Den bez sazby se počítá nulou a od něj dál nese
--    zustatek_neuplny. Zůstatek smí být záporný (záloha předběhla
--    výdělek) — obrazovka to řekne slovy, databáze nic neořezává.
--
-- K. MĚSÍC: p_mesic smí být kterýkoli den, ořízne se date_trunc uvnitř
--    (muj_vyplatni_prehled filtruje `>= p_mesic`, viz 20260924140000).
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * app.earnings, app.worked_minutes ani app.rate_at se nemění.
-- * Běžící směna (příchod bez odchodu) se nepočítá — přičte se po
--   odchodu, stejně jako všude jinde.
-- * Plán podle rozpisu po dnech se nepočítá. Zadání chce náklady a účet,
--   ne předpověď; předběžný výdělek je po lidech ve vydelky_prehled.
-- * dnu_bez_dochazky se nevrací — earnings ho počítá i s budoucími
--   směnami (starší nález v 20260924140000).
-- * Nic z toho nejde do jazykového modelu (pravidlo 8).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. app.vydelek_po_dnech — rozklad app.earnings po provozních dnech
--
-- Jeden řádek na každý řádek app.worked_minutes v měsíci. Součet
-- `haleru` = earnings.vydelano_haleru, součet `minut` =
-- earnings.odpracovano_minut, „některá sazba NULL" = earnings.sazba_chybi.
--
-- Chybějící haléře (round součtu − součet dnů dolů) se rozdají dnům
-- s největším zbytkem. Jich je vždycky dost: zbytek je nejvýš 59/60
-- haléře, takže r chybějících haléřů znamená aspoň r dnů s nenulovým
-- zbytkem. Dny bez sazby (NULL) stojí v pořadí až za nimi a haléř
-- nedostanou nikdy.
--
-- Bez security definer a bez práva pro kohokoli: volají ji jen definer
-- funkce níž, které si firmu a práva ohlídaly samy. Pro přímé volání
-- je zavřená (revoke pod definicí).
-- ---------------------------------------------------------------------

create or replace function app.vydelek_po_dnech(p_employee uuid, p_mesic date)
returns table (
  den    date,
  minut  integer,
  sazba  integer,
  haleru bigint
)
language sql stable set search_path = ''
as $$
  select d.den,
         d.minut,
         d.sazba,
         d.soucin / 60
           + case
               when row_number() over (order by d.soucin % 60 desc nulls last, d.den)
                    <= round(sum(d.soucin) over () / 60) - sum(d.soucin / 60) over ()
               then 1 else 0
             end
  from (
    -- Haléřominuty: minut × sazba za hodinu. NULL, když sazba chybí.
    select w.den, w.minut, s.sazba, w.minut::bigint * s.sazba as soucin
    from app.worked_minutes(p_employee,
                            date_trunc('month', p_mesic)::date,
                            app.konec_mesice(p_mesic)) w
    cross join lateral (select app.rate_at(p_employee, w.den) as sazba) s
  ) d
  order by d.den;
$$;

comment on function app.vydelek_po_dnech(uuid, date) is
  'app.earnings po provozních dnech. Haléře rozdělené metodou největšího '
  'zbytku, aby součet dnů byl přesně earnings. Jen pro definer funkce.';

revoke all on function app.vydelek_po_dnech(uuid, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. public.vydelky_po_dnech — náklady na mzdy a zálohy po dnech
--
-- Pro vedení, záložka Výdělky → „Po dnech". Lidé a práva jako
-- vydelky_prehled (body C a D v hlavičce); součet mzdy za měsíc se
-- rovná součtu jejího vydelano_haleru — hlídá krok59, oddíl 3.
-- ---------------------------------------------------------------------

create or replace function public.vydelky_po_dnech(
  p_tenant uuid,
  p_branch uuid,
  p_mesic  date
)
returns table (
  den                 date,
  lidi                integer,
  odpracovano_minut   integer,
  mzdy_haleru         bigint,
  bez_sazby_lidi      integer,
  zalohy_haleru       bigint,
  zaloh               integer,
  zaloh_nepotvrzenych integer
)
language sql stable security definer set search_path = ''
as $$
  with lide as (
    -- Pravidlo 7b: uvnitř definer funkce RLS neplatí, firmu i práva si
    -- filtrujeme sami. Každý filtr jednou. Podmínka práv je opsaná
    -- z vydelky_prehled — kdo mění jednu, mění obě.
    select e.id, e.tenant_id
    from public.employees e
    where e.tenant_id = p_tenant
      and e.deleted_at is null
      and (p_branch is null or e.branch_id = p_branch)
      and case
            when e.branch_id is null
              then app.has_access(p_tenant, 'payroll.read', null)
            else app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
          end
  ),
  prace as (
    -- mzdy: sum() den bez sazby přeskočí; když ten den pracovali jen
    -- lidé bez sazby, zůstane NULL — ne nula (bod F).
    select v.den,
           count(*)::integer                                 as lidi,
           sum(v.minut)::integer                             as minut,
           sum(v.haleru)::bigint                             as mzdy,
           count(*) filter (where v.sazba is null)::integer  as bez_sazby
    from lide l
    cross join lateral app.vydelek_po_dnech(l.id, p_mesic) v
    group by v.den
  ),
  zalohy as (
    -- Firma zálohy se hlídá zvlášť (a.tenant_id = l.tenant_id): cizí
    -- klíč employee_id firmu nekontroluje a filtr v definer funkci nesmí
    -- stát na tom, že dnešní RPC je jediná cesta dovnitř.
    select a.business_date                                         as den,
           sum(a.castka_haleru)::bigint                            as haleru,
           count(*)::integer                                       as pocet,
           count(*) filter (where a.stav = 'nepotvrzena')::integer as nepotvrzenych
    from lide l
    join public.advances a on a.employee_id = l.id
                          and a.tenant_id = l.tenant_id
    where a.stav <> 'stornovana'
      and a.business_date between date_trunc('month', p_mesic)::date
                              and app.konec_mesice(p_mesic)
    group by a.business_date
  )
  select coalesce(p.den, z.den),
         coalesce(p.lidi, 0),
         coalesce(p.minut, 0),
         p.mzdy,
         coalesce(p.bez_sazby, 0),
         coalesce(z.haleru, 0),
         coalesce(z.pocet, 0),
         coalesce(z.nepotvrzenych, 0)
  from prace p
  full join zalohy z on z.den = p.den
  order by 1;
$$;

comment on function public.vydelky_po_dnech(uuid, uuid, date) is
  'Náklady na mzdy (hrubá mzda, rozklad app.earnings) a zálohy po '
  'provozních dnech měsíce. Lidé a práva jako vydelky_prehled; součet '
  'mzdy = součet jejího vydelano_haleru (krok59).';

revoke all on function public.vydelky_po_dnech(uuid, uuid, date) from public, anon;
grant execute on function public.vydelky_po_dnech(uuid, uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. public.muj_pracovni_ucet — pracovní účet zaměstnance za měsíc
--
-- Docházka → „Můj účet". Po dnech: odpracováno, sazba, výdělek (hrubý),
-- zálohy a průběžný zůstatek. Součty sedí s muj_vyplatni_prehled
-- (dlaždice na Docházce) — hlídá krok59, oddíl 5.
-- ---------------------------------------------------------------------

create or replace function public.muj_pracovni_ucet(p_tenant uuid, p_mesic date)
returns table (
  den                 date,
  odpracovano_minut   integer,
  hodinova_haleru     integer,
  vydelano_haleru     bigint,
  sazba_chybi         boolean,
  zalohy_haleru       bigint,
  zaloh               integer,
  zaloh_nepotvrzenych integer,
  zustatek_haleru     bigint,
  zustatek_neuplny    boolean,
  zobrazeni           text
)
language sql stable security definer set search_path = ''
as $$
  with ja as (
    -- Jen já (bod H). Pravidlo 7b: každý filtr jednou.
    select e.id, e.tenant_id
    from public.employees e
    where e.tenant_id = p_tenant
      and e.user_id = (select auth.uid())
      and e.deleted_at is null
      and app.is_member(p_tenant)
  ),
  volba as (
    select s.zalohy_zobrazeni as zobrazeni from app.nastaveni(p_tenant) s
  ),
  prace as (
    select v.den, v.minut, v.sazba, v.haleru
    from ja
    cross join lateral app.vydelek_po_dnech(ja.id, p_mesic) v
  ),
  zalohy as (
    -- Při „neukazovat" se zálohy vůbec nenačtou — den, kdy byla jen
    -- záloha, pak v účtu není (bod I). Firma zálohy zvlášť, jako výš.
    select a.business_date                                         as den,
           sum(a.castka_haleru)::bigint                            as haleru,
           count(*)::integer                                       as pocet,
           count(*) filter (where a.stav = 'nepotvrzena')::integer as nepotvrzenych
    from ja
    join public.advances a on a.employee_id = ja.id
                          and a.tenant_id = ja.tenant_id
    cross join volba
    where a.stav <> 'stornovana'
      and a.business_date between date_trunc('month', p_mesic)::date
                              and app.konec_mesice(p_mesic)
      and volba.zobrazeni <> 'neukazovat'
    group by a.business_date
  ),
  dny as (
    select coalesce(p.den, z.den)                  as den,
           coalesce(p.minut, 0)                    as minut,
           p.sazba,
           p.haleru,
           (p.den is not null and p.sazba is null) as bez_sazby,
           coalesce(z.haleru, 0)                   as zal,
           coalesce(z.pocet, 0)                    as zal_pocet,
           coalesce(z.nepotvrzenych, 0)            as zal_nepotvrzenych
    from prace p
    full join zalohy z on z.den = p.den
  )
  select d.den,
         d.minut,
         d.sazba,
         d.haleru,
         d.bez_sazby,
         case when v.zobrazeni <> 'neukazovat' then d.zal end,
         case when v.zobrazeni <> 'neukazovat' then d.zal_pocet end,
         case when v.zobrazeni <> 'neukazovat' then d.zal_nepotvrzenych end,
         -- Bod J: den bez sazby se počítá nulou, příznak nese sloupec vedle.
         case when v.zobrazeni = 'odecitat'
              then (sum(coalesce(d.haleru, 0)) over w - sum(d.zal) over w)::bigint
         end,
         bool_or(d.bez_sazby) over w,
         v.zobrazeni
  from dny d
  cross join volba v
  window w as (order by d.den)
  order by d.den;
$$;

comment on function public.muj_pracovni_ucet(uuid, date) is
  'Vlastní pracovní účet za měsíc po provozních dnech: odpracováno, '
  'hrubý výdělek (rozklad app.earnings), zálohy a průběžný zůstatek. '
  'Jen pro sebe, bez oprávnění; volba firmy zalohy_zobrazeni se uplatní '
  'uvnitř.';

revoke all on function public.muj_pracovni_ucet(uuid, date) from public, anon;
grant execute on function public.muj_pracovni_ucet(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 4. public.muj_vyplatni_prehled — firma zálohy a celý měsíc
--
-- Nalezeno kontrolou shody v krok59 (účet × dlaždice): dlaždice na
-- Docházce sčítala zálohy člověka BEZ filtru firmy zálohy. Definer
-- funkce nemá RLS a cizí klíč employee_id firmu nekontroluje — záloha
-- zapsaná pod cizí firmou našemu člověku by se mu přičetla a snížila
-- „zbývá k výplatě". Stejnou pojistku má vydelky_prehled
-- (20260924140000) i účet výš. A měsíc: `business_date >= p_mesic`
-- se dnem uprostřed měsíce minul zálohy z jeho začátku (bod K).
--
-- Dopad na data: ŽÁDNÝ. vyplatit_zalohu zálohu cizímu člověku nezapíše
-- (e.tenant_id = p_tenant) a přímý zápis do advances je authenticated
-- odebraný; aplikace posílá vždy 1. den měsíce. Obojí je pojistka pro
-- cestu dovnitř, která dnes není — filtr v definer funkci na tom stát
-- nesmí.
--
-- Předefinováno z 20260902040000_pozastaveni_zaloh.sql beze změny
-- signatury, sloupců, pořadí i `limit 1`. Změněné jsou jen dvě podmínky
-- v poddotazu záloh. `create or replace` stačí — návratový typ je týž.
-- Hlídá krok59, oddíl 5.
-- ---------------------------------------------------------------------

create or replace function public.muj_vyplatni_prehled(p_tenant uuid, p_mesic date)
returns table (
  odpracovano_minut   integer,
  vydelano_haleru     integer,
  zalohy_haleru       integer,
  zbyva_haleru        integer,
  zaloh_nepotvrzenych integer,
  zalohy_pozastavene  boolean,
  zobrazeni           text,
  sazba_chybi         boolean,
  hodinova_haleru     integer,
  dnu_bez_dochazky    integer
)
language sql stable security definer set search_path = ''
as $$
  select
    v.odpracovano_minut,
    v.vydelano_haleru,
    z.soucet,
    v.vydelano_haleru - z.soucet,
    z.nepotvrzenych,
    app.zalohy_pozastavene(p_tenant, e.id),
    (select s.zalohy_zobrazeni from app.nastaveni(p_tenant) s),
    v.sazba_chybi,
    app.rate_at(e.id, app.konec_mesice(p_mesic)),
    v.dnu_bez_dochazky
  from public.employees e
  cross join lateral app.earnings(e.id, p_mesic) v
  cross join lateral (
    select
      coalesce(sum(a.castka_haleru), 0)::integer as soucet,
      coalesce(count(*) filter (where a.stav = 'nepotvrzena'), 0)::integer as nepotvrzenych
    from public.advances a
    where a.employee_id = e.id
      and a.tenant_id = e.tenant_id
      and a.stav <> 'stornovana'
      and a.business_date between date_trunc('month', p_mesic)::date
                              and app.konec_mesice(p_mesic)
  ) z
  where e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
    and app.is_member(p_tenant)
  limit 1;
$$;

comment on function public.muj_vyplatni_prehled(uuid, date) is
  'Vlastní výplatní přehled za měsíc: hrubá mzda, zálohy (jen vlastní '
  'firmy, celý měsíc) a zbývá. Volba zalohy_zobrazeni chodí s čísly, '
  'skrývá aplikace.';

revoke all on function public.muj_vyplatni_prehled(uuid, date) from public, anon;
grant execute on function public.muj_vyplatni_prehled(uuid, date) to authenticated;
