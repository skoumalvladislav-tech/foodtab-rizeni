-- =====================================================================
-- Foodtab — záloha se vyplácí NA POBOČCE VÝDEJE
--
-- Hlásil Šéfík 24. 9. 2026: „u zaměstnanců, kteří na to mají práva,
-- mi nejdou vyplácet zálohy."
--
-- ---------------------------------------------------------------------
-- PŘÍČINA — DVĚ, NEZÁVISLÉ NA SOBĚ
--
-- 1. NABÍDKA „KOMU" BYLA ZE ŠPATNÉHO PRŮZORU.
--    Obrazovka Záloh brala lidi z `public.lide_pro_pobocku`
--    (20260901150000). Ten je napsaný pro RUČNÍ ZÁPIS DOCHÁZKY a vrací
--    lidi jen tomu, kdo má `attendance.manage`. Kdo měl jen právo
--    vyplácet (`advances.manage` — v ostré databázi třeba zařazení
--    Číšník/servírka, členství jen na Černé Perle), dostal prázdnou
--    nabídku a nevyplatil nikomu. Právo měl, obrazovka se ho ale ptala
--    na jiné.
--
-- 2. VÝPLATA BRALA POBOČKU Z DOMOVSKÉ POBOČKY ZAMĚSTNANCE.
--    `public.vyplatit_zalohu` (poslední definice 20260902040000) si
--    pobočku četla z `employees.branch_id`. Z toho plynuly tři chyby:
--      * kdo domovskou pobočku nemá (brigádníci, výpomoc — v ostré
--        databázi dva lidé), tomu nešlo vyplatit vůbec: „Záloha se
--        vydává na pobočce a tenhle člověk žádnou nemá.";
--      * zaskakujícímu z jiné pobočky se ptalo na právo na JEHO
--        domovské pobočce, takže vedoucí s právem jen na téhle pobočce
--        mu nevyplatil, přestože mu peníze podává z ruky do ruky tady;
--      * a když to prošlo (vedoucí s právem na obou), záloha se
--        zaúčtovala na domovskou pobočku. Kiosek pobočky, kde peníze
--        opravdu přešly z ruky do ruky, ji pak neukázal k potvrzení —
--        `kiosk_zalohy` filtruje podle pobočky zařízení.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
--   * NOVÝ průzor `public.lide_pro_zalohy` — nabídka „Komu" pro
--     obrazovku Záloh, s vlastní bránou `advances.manage` na té pobočce.
--   * NOVÁ pomocná `app.patri_k_zaloze` — JEDINÉ místo, kde je napsané,
--     kdo na pobočce „patří" k výplatě zálohy. Volá ji nabídka i výplata,
--     aby se nemohly rozejít (stejná úvaha jako `app.pin_lide_pobocky`
--     v 20260903050000: dvě kopie téhož pravidla se vždycky rozejdou).
--   * `public.vyplatit_zalohu` dostává pátý parametr `p_branch` —
--     pobočku VÝDEJE. Na ní se ptá na právo a na ni se záloha
--     zaúčtuje (i provozní den, audit a upozornění).
--
-- KDO NA POBOČCE „PATŘÍ" K ZÁLOZE:
--   * má ji jako domovskou, NEBO
--   * má na ní směnu v okně (nezrušenou) — zaskakující, NEBO
--   * nemá domovskou pobočku vůbec a NENÍ majitel.
-- Majitel bez pobočky se nenabízí: zálohu si nebere a v nabídce každé
-- pobočky by jen překážel. Kdyby si ji brát měl, stačí mu dát směnu
-- nebo domovskou pobočku.
--
-- Okno u výplaty je ±7 dní kolem provozního dne pobočky výdeje — totéž
-- okno, se kterým nabídku volá obrazovka. Výplata si ho počítá SAMA
-- a od aplikace ho nebere: jinak by si ho volající roztáhl, jak chtěl.
--
-- OKNO ±7 JE NAPSANÉ NA DVOU MÍSTECH A MUSÍ ZŮSTAT SHODNÉ: tady ve
-- výplatě a jako výchozí `okno = 7` v `lib/lide-pobocky.ts`
-- (`lideProZalohy`), se kterým obrazovka volá nabídku. Kdo změní jedno
-- a druhé ne, rozejde nabídku s výplatou: buď se nabídne člověk, kterému
-- výplata pak řekne „na téhle pobočce nepracuje", nebo výplata pustí
-- někoho, koho nabídka neukáže. Scénář krok57 pozná jen to, když se
-- okno výplaty zúží pod pět dní (Hugo se směnou za pět dní). Že obě
-- čísla sedí na sebe, nehlídá automaticky nic — proto tahle poznámka
-- a stejná u okna ve výplatě níž.
--
-- ---------------------------------------------------------------------
-- PROČ `p_branch` MÁ VÝCHOZÍ HODNOTU NULL
--
-- Nasazení není atomické: migrace a aplikace jdou každá jindy. Stará
-- aplikace volá výplatu se ČTYŘMI pojmenovanými parametry a musí
-- fungovat dál, dokud se nová nenasadí. Bez `p_branch` se proto chová
-- jako dřív — pobočka je domovská. Jediný rozdíl: kdo domovskou nemá,
-- dostane „Vyberte pobočku, na které zálohu vydáváte." místo staré
-- věty; výsledek (odmítnutí) je stejný.
--
-- Stará čtyřparametrová funkce se DROPUJE, ne nechává vedle. Dvě funkce
-- téhož jména, z nichž jedna bere čtyři parametry a druhá pět s výchozí
-- hodnotou, by PostgREST u volání se čtyřmi parametry neuměl rozlišit
-- (dva kandidáti) a stará aplikace by spadla hned po migraci.
--
-- ---------------------------------------------------------------------
-- BEZPEČNOST (nálezy, oddíl 7b — v definer funkci druhá linie NENÍ)
--
--   * Všechny tři funkce jsou `security definer` s vlastníkem
--     s `rolbypassrls`: RLS se uvnitř neuplatní vůbec. Firmu si proto
--     filtrují samy — `tenant_id = p_tenant` na zaměstnancích i na
--     pobočce.
--   * Právo se ptá NA POBOČCE VÝDEJE (`advances.manage` na `v_branch`),
--     ne na domovské pobočce zaměstnance — a ptá se PRVNÍ, před firmou
--     pobočky i před tím, jestli tam člověk „patří". Kdo na pobočce
--     výdeje právo nemá, dostane „kdo na to má oprávnění" a z hlášky se
--     nedozví, jestli taková pobočka existuje, ani kdo kde pracuje.
--   * Pobočka výdeje musí patřit TÉŽE firmě (hned za právem). Není to
--     formalita: `app.has_access` u členství s rozsahem 'tenant' vrací
--     pravdu pro JAKOUKOLI pobočku, i cizí firmy (zjištěno v krok54).
--     Bez téhle kontroly by celofiremní vedoucí zapsal zálohu svého
--     člověka na pobočku cizí firmy — a kiosek té firmy by ukázal jeho
--     jméno a částku. Že je až za právem, jí neubírá: celofiremnímu
--     právo projde a zastaví ho tahle; komu právo neprojde, ten se
--     k zápisu nedostane tak jako tak.
--   * Člověk na pobočce výdeje musí „patřit" (pravidlo výš). Jinak by
--     vedoucí s právem na jedné pobočce vyplácel komukoli z celé firmy.
--
-- Každý filtr je napsaný JEN JEDNOU v každé cestě, ve které něco drží
-- (pravidlo „nadbytečná podmínka nejde rozbít"):
--   * nabídka nemá vlastní `e.tenant_id` — firmu, smazané lidi a firmu
--     pobočky jí drží `app.patri_k_zaloze`;
--   * výplata si firmu drží sama v dohledání zaměstnance (kvůli větě
--     „Zaměstnanec nepatří téhle firmě.") a v kontrole pobočky (kvůli
--     „Taková pobočka tu není."). Že tytéž podmínky jsou i v pomocné
--     funkci, u výplaty nevadí: scénář krok57 kontroluje KONKRÉTNÍ
--     hlášku, takže vyndání kterékoli z nich pozná.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * `public.lide_pro_pobocku` zůstává, jak je. Je to průzor pro ruční
--     zápis docházky a brána `attendance.manage` je u něj správně.
--   * `app.pin_lide_pobocky` (koho kiosek pozná podle PINu) se nemění.
--     Zálohu vyplacenou člověku BEZ domovské pobočky, který na pobočce
--     výdeje nemá směnu kolem dneška, proto kiosek ukáže, ale PINem ji
--     nepotvrdí — zůstane „nepotvrzená". Nezahazuje se, počítá se do
--     součtů a je vidět zvlášť (20260901220000, bod 4). Rozšířit, koho
--     kiosek pozná, je rozhodnutí o identifikaci u tabletu, ne o zálohách
--     — patří k Šéfíkovi, ne do opravy téhle chyby.
--   * Zrušená nebo neaktivní pobočka se u výdeje nehlídá — nehlídala se
--     ani dřív u domovské.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KDO NA POBOČCE PATŘÍ K ZÁLOZE
--
-- Vrací MNOŽINU lidí, ne ano/ne u jednoho. Kdyby to byla funkce „patří
-- tenhle člověk?", musela by si nabídka firmu filtrovat ještě jednou
-- sama (jinak by procházela zaměstnance všech firem) — a tentýž filtr
-- napsaný dvakrát se nedá shodit, takže by kontrola nad ním nic
-- neměřila. Takhle je `tenant_id` pro nabídku napsaný jednou, tady.
--
-- Okno (`p_od`..`p_do`) dostává zvenku: nabídka ho má od obrazovky,
-- výplata si ho počítá sama kolem provozního dne pobočky výdeje.
--
-- Pobočka cizí firmy vrátí prázdnou množinu (join na `branches`) —
-- viz hlavička, „Bezpečnost".
-- ---------------------------------------------------------------------

create function app.patri_k_zaloze(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (employee_id uuid)
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.employees e
  join public.branches b on b.id = p_branch and b.tenant_id = p_tenant
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (
      e.branch_id = p_branch
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id
          and s.branch_id = p_branch
          and s.shift_date between p_od and p_do
          and s.status <> 'cancelled'
      )
      or (e.branch_id is null and not e.je_majitel)
    );
$$;

comment on function app.patri_k_zaloze(uuid, uuid, date, date) is
  'Komu jde na pobočce vyplatit zálohu: domovská pobočka, nezrušená směna '
  'tady v okně, nebo bez pobočky (ne majitel). Jediné místo s tímhle '
  'pravidlem — volá ho nabídka (lide_pro_zalohy) i výplata (vyplatit_zalohu).';

revoke all on function app.patri_k_zaloze(uuid, uuid, date, date)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- NABÍDKA „KOMU" NA OBRAZOVCE ZÁLOH
--
-- Brána je `advances.manage` NA TÉHLE POBOČCE — totéž právo, na které
-- se pak ptá výplata. Kdo nemá právo, dostane prázdno, ne chybu:
-- obrazovka ho do formuláře stejně nepustí.
--
-- `bez_pobocky` je zvlášť od `domovska`, aby obrazovka uměla napsat,
-- proč tu ten člověk je („zaskakuje" není totéž co „bez pobočky").
-- ---------------------------------------------------------------------

create function public.lide_pro_zalohy(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (employee_id uuid, jmeno text, domovska boolean, bez_pobocky boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id,
         e.full_name,
         e.branch_id is not distinct from p_branch,
         e.branch_id is null
  from app.patri_k_zaloze(p_tenant, p_branch, p_od, p_do) k
  join public.employees e on e.id = k.employee_id
  where app.has_access(p_tenant, 'advances.manage', p_branch)
  order by e.full_name;
$$;

comment on function public.lide_pro_zalohy(uuid, uuid, date, date) is
  'Komu jde na pobočce vyplatit zálohu — nabídka „Komu" na obrazovce '
  'Záloh. Brána advances.manage na té pobočce (ne attendance.manage jako '
  'u lide_pro_pobocku). Pravidlo „kdo sem patří" sdílí s vyplatit_zalohu.';

revoke all on function public.lide_pro_zalohy(uuid, uuid, date, date) from public, anon;
grant execute on function public.lide_pro_zalohy(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- VÝPLATA NA POBOČCE VÝDEJE
--
-- Tělo je opsané z 20260902040000 a mění se jen to, co musí:
--   * pobočka = `coalesce(p_branch, domovská)` a prázdná se odmítne;
--   * právo se ptá na pobočce výdeje;
--   * pobočka musí patřit téže firmě;
--   * člověk na pobočce výdeje musí „patřit".
-- Pozastavení, částka, výdělek, varování, zápis, provozní den, audit
-- a upozornění jsou beze změny — jen všude, kde stálo `v_branch`, je
-- teď pobočka výdeje místo domovské. I provozní den se počítá z pobočky
-- VÝDEJE: kiosek ukazuje zálohy jen s provozním dnem své pobočky, a kdyby
-- se den bral z domovské pobočky v jiném časovém pásmu, kiosek by zálohu
-- zaskakujícího neukázal.
--
-- Pořadí kontrol: PRÁVO PRVNÍ, pak firma pobočky, pak „patří". Kdo právo
-- na pobočce výdeje nemá, se z hlášky nesmí dozvědět, jestli taková
-- pobočka existuje, ani kdo kde pracuje. Kontrola firmy pobočky je
-- potřeba i tak, protože právo ji u celofiremního členství nezastaví
-- (scénář krok57, celofiremní Ivan).
-- ---------------------------------------------------------------------

drop function if exists public.vyplatit_zalohu(uuid, uuid, integer, text);

create function public.vyplatit_zalohu(
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
  -- nezastaví — viz hlavička.
  if not exists (
    select 1 from public.branches b
    where b.id = v_branch and b.tenant_id = p_tenant
  ) then
    raise exception 'Taková pobočka tu není.' using errcode = 'no_data_found';
  end if;

  -- Provozní den POBOČKY VÝDEJE, ne domovské (kiosek, viz výš).
  v_den := app.business_date(v_branch, now());

  -- Na pobočce výdeje musí „patřit" — stejné pravidlo jako nabídka.
  --
  -- Okno ±7 dní MUSÍ zůstat shodné s výchozím `okno = 7`
  -- v lib/lide-pobocky.ts (`lideProZalohy`) — s tím obrazovka volá
  -- nabídku „Komu". Viz hlavička.
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

  if v_uziv is not null then
    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (p_tenant, v_uziv, v_branch, 'zaloha.vyplacena',
            jsonb_build_object('castka_haleru', p_castka, 'zaloha', v_id,
                               'den', v_den));
  end if;

  return query select v_id, v_varovani, coalesce(v_vydelano, 0);
end;
$$;

comment on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid) is
  'Vyplatit zálohu na pobočce VÝDEJE (p_branch). Bez p_branch domovská '
  'pobočka jako dřív — kvůli staré aplikaci do nasazení nové. Právo '
  'advances.manage se ptá na pobočce výdeje; člověk tam musí patřit '
  '(app.patri_k_zaloze).';

revoke all on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid) to authenticated;
