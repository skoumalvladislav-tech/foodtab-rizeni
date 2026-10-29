-- =====================================================================
-- Foodtab — jedna záloha se nezapíše dvakrát
--
-- Hlásil Šéfík 25. 10. 2026: „odečítání záloh se zdvojovalo". Týž den
-- se ukázalo, že na provozovně nešel internet.
--
-- PROČ. Výpočty záloh (Můj účet, dlaždice na Docházce, Výdělky, Po
-- dnech) žádnou zálohu dvakrát nesčítají — prošlo se to celé. Zdvojení
-- vzniká dřív, při ZÁPISU: `vyplatit_zalohu` zapíše novou zálohu při
-- každém zavolání. Stačí, aby:
--   * se záloha zapsala, ale odpověď do telefonu nedošla (výpadek
--     signálu) — obsluha vidí chybu, vyplatí znovu a jsou dvě;
--   * se na pomalém telefonu ťuklo dvakrát dřív, než se tlačítko
--     zablokovalo — React druhé odeslání zařadí do fronty a pustí ho
--     po prvním.
--
-- CO SE MĚNÍ.
--   1. `advances.klic_odeslani` — číslo, které formulář vylosuje
--      JEDNOU na jedno vyplnění a pošle s každým pokusem o odeslání.
--      Jedinečné ve firmě.
--   2. `vyplatit_zalohu` dostane `p_klic`. Když záloha s tím číslem už
--      je, NEZAPÍŠE NOVOU — vrátí tu první a řekne `opakovane = true`.
--      Bez auditu a bez dalšího upozornění příjemci, ty už proběhly.
--      Dva souběžné požadavky se stejným číslem hlídá jedinečný index
--      (`on conflict do nothing`), ne jen dotaz předem — ten by
--      souběhem prošly oba.
--   3. Když číslo patří záloze s JINOU osobou, částkou, pobočkou nebo
--      ji vydal někdo jiný, výplata spadne. Opakování je jen přesná
--      kopie téhož odeslání; cokoli jiného je chyba formuláře (nebo
--      pokus vylákat cizí zálohu) a nesmí se z toho stát „hotovo".
--
-- CO SE SCHVÁLNĚ NEDĚLÁ.
--   * Nemažou se ani neslučují zálohy, které už zdvojené v databázi
--     jsou. Do zákaznických dat se tu nesahá; ty se stornují na
--     obrazovce Zálohy (storno s důvodem, zůstane v auditu).
--   * Neodmítá se „stejná částka stejnému člověku týž den". Dvě zálohy
--     po 500 Kč v jeden den jsou běžné a správné — rozhoduje číslo
--     odeslání, ne podobnost.
--   * Sloupec `klic_odeslani` nedostává vlastní grant pro čtení —
--     aplikace ho číst nepotřebuje. Tajemství to ale NENÍ a nemusí být:
--     na Supabase může `authenticated` mít na tabulce celotabulkový
--     select z výchozích práv (CLAUDE.md, „Nová tabulka dostane
--     granty…"), takže kdo zálohu vidí, uvidí i číslo. Nic tím nezíská:
--     opakování vrátí zálohu jen TOMU, kdo ji vydal (bod 3).
--   * Bez `p_klic` (stará aplikace do nasazení) se chová jako dřív.
--
-- Signatura se mění (šestý parametr, čtvrtý výstupní sloupec), proto
-- drop + create a granty znovu. Pětiparametrová podoba zmizí, aby
-- PostgREST neměl dva kandidáty (krok57, oddíl 7). Volání s pěti
-- pojmenovanými parametry dál projde — `p_klic` má výchozí NULL.
--
-- Tělo je opsané z 20260925140000_zalohy_potvrzeni.sql (poslední
-- definice); právo, pobočka výdeje, „patří", pozastavení, částka,
-- varování, audit i upozornění jsou beze změny. Hlídá krok101.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Číslo odeslání
-- ---------------------------------------------------------------------

alter table public.advances
  add column klic_odeslani uuid;

comment on column public.advances.klic_odeslani is
  'Číslo jednoho vyplnění formuláře „Vyplatit zálohu". Opakované odeslání '
  's týmž číslem novou zálohu nezapíše. NULL u záloh z doby před '
  '25. 10. 2026 a ze staré aplikace.';

-- Jedinečné ve FIRMĚ. Částečný index: staré zálohy bez čísla se
-- navzájem neblokují.
create unique index advances_klic_odeslani
  on public.advances (tenant_id, klic_odeslani)
  where klic_odeslani is not null;


-- ---------------------------------------------------------------------
-- 2. app.zaloha_podle_klice — najde zálohu téhož odeslání
--
-- NULL, když taková není. Když je, ale nesedí osoba, částka, pobočka
-- nebo kdo ji vydal, spadne — viz hlavička, bod 3. Hláška schválně
-- neříká, ČÍM se liší: číslo odeslání se nesmí dát použít k tomu, aby
-- se člověk dozvěděl něco o cizí záloze.
--
-- Volá ji jen vyplatit_zalohu (dvakrát: před zápisem a po souběhu).
-- Bez security definer: běží s právy volající definer funkce. Zvenku
-- zavřená.
-- ---------------------------------------------------------------------

create function app.zaloha_podle_klice(
  p_tenant   uuid,
  p_klic     uuid,
  p_employee uuid,
  p_castka   integer,
  p_branch   uuid
)
returns table (zaloha uuid, den date)
language plpgsql stable set search_path = ''
as $$
declare
  v_a record;
begin
  if p_klic is null then
    return;
  end if;

  select a.id, a.employee_id, a.castka_haleru, a.branch_id, a.vyplatil, a.business_date
    into v_a
    from public.advances a
   where a.tenant_id = p_tenant
     and a.klic_odeslani = p_klic;

  if not found then
    return;
  end if;

  -- `is distinct from`, ne `<>`: s NULL by `<>` vyšlo NULL a podmínka
  -- by tiše propustila neshodu.
  if v_a.employee_id is distinct from p_employee
     or v_a.castka_haleru is distinct from p_castka
     or v_a.branch_id is distinct from p_branch
     or v_a.vyplatil is distinct from (select auth.uid()) then
    raise exception
      'Tohle odeslání už patří jiné záloze. Načtěte stránku znovu a zálohu vyplňte znovu.'
      using errcode = 'check_violation';
  end if;

  zaloha := v_a.id;
  den := v_a.business_date;
  return next;
end;
$$;

comment on function app.zaloha_podle_klice(uuid, uuid, uuid, integer, uuid) is
  'Záloha zapsaná týmž odesláním formuláře (advances.klic_odeslani), nebo '
  'nic. Jiná osoba, částka, pobočka či vydávající = výjimka. Jen pro '
  'vyplatit_zalohu.';

revoke all on function app.zaloha_podle_klice(uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. public.vyplatit_zalohu s číslem odeslání
-- ---------------------------------------------------------------------

drop function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid);

create function public.vyplatit_zalohu(
  p_tenant   uuid,
  p_employee uuid,
  p_castka   integer,
  p_poznamka text default '',
  p_branch   uuid default null,
  p_klic     uuid default null
)
returns table (
  zaloha          uuid,
  varovani        text,
  vydelano_haleru integer,
  opakovane       boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch    uuid;
  v_domovska  uuid;
  v_jmeno     text;
  v_uziv      uuid;
  v_id        uuid;
  v_vydelano  integer;
  v_zalohy    integer;
  v_max       integer;
  v_den       date;
  v_varovani  text := null;
  v_opakovane boolean := false;
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
  -- A ani o tom, jestli číslo odeslání už někde je.
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

  -- TOTÉŽ ODESLÁNÍ PODRUHÉ (25. 10. 2026). První pokus už zálohu
  -- zapsal; „patří" ani pozastavení se znovu neptají — kdyby se mezitím
  -- změnily, obsluha by dostala chybu u zálohy, která zapsaná JE.
  select k.zaloha, k.den into v_id, v_den
  from app.zaloha_podle_klice(p_tenant, p_klic, p_employee, p_castka, v_branch) k;
  v_opakovane := v_id is not null;

  if not v_opakovane then
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
  end if;

  -- Kolik má za tenhle měsíc odpracováno a kolik už dostal. Slouží
  -- JEN k varování. Záloha tohoto odeslání se do „už dostal" nepočítá —
  -- u opakování by se jinak varování spočítalo s ní dvakrát.
  select v.vydelano_haleru into v_vydelano
  from app.earnings(p_employee, date_trunc('month', v_den)::date) v;

  select coalesce(sum(a.castka_haleru), 0)::integer into v_zalohy
  from public.advances a
  where a.employee_id = p_employee
    and a.stav <> 'stornovana'
    and a.business_date >= date_trunc('month', v_den)::date
    and (p_klic is null or a.klic_odeslani is distinct from p_klic);

  select s.zaloha_max_haleru into v_max from app.nastaveni(p_tenant) s;

  if v_max is not null and p_castka > v_max then
    v_varovani := 'Firma má nastavenou horní mez ' || app.koruny(v_max)
      || ' a vyplácíte ' || app.koruny(p_castka) || '.';
  elsif coalesce(v_vydelano, 0) < v_zalohy + p_castka then
    v_varovani := 'Odpracováno zatím ' || app.koruny(coalesce(v_vydelano, 0))
      || ', po téhle záloze bude vyplaceno ' || app.koruny(v_zalohy + p_castka) || '.';
  end if;

  if not v_opakovane then
    insert into public.advances
      (tenant_id, branch_id, employee_id, castka_haleru, business_date,
       vyplatil, poznamka, klic_odeslani)
    values (p_tenant, v_branch, p_employee, p_castka, v_den,
            (select auth.uid()), coalesce(btrim(p_poznamka), ''), p_klic)
    on conflict (tenant_id, klic_odeslani) where klic_odeslani is not null
    do nothing
    returning id into v_id;

    -- Souběh: totéž odeslání mezitím zapsal druhý požadavek (dvojí
    -- ťuknutí). Index počkal na jeho dokončení; teď je jeho záloha
    -- vidět a vrací se ona.
    if v_id is null then
      select k.zaloha, k.den into v_id, v_den
      from app.zaloha_podle_klice(p_tenant, p_klic, p_employee, p_castka, v_branch) k;
      v_opakovane := true;
    end if;
  end if;

  if not v_opakovane then
    perform app.audit(p_tenant, 'advance.vyplaceno', 'advance', v_id::text, v_branch,
                      null, jsonb_build_object('castka_haleru', p_castka,
                                               'varovani', v_varovani));

    -- 25. 9. 2026: přes Notification Service, ne přímým insertem — viz
    -- hlavička 20260925140000, bod 7.
    if v_uziv is not null then
      perform app.notifikovat(
        p_tenant, v_uziv, 'zaloha.vyplacena',
        jsonb_build_object('castka_haleru', p_castka, 'zaloha', v_id, 'den', v_den),
        'normal', v_branch, null, 'zaloha', v_id, null
      );
    end if;
  end if;

  return query select v_id, v_varovani, coalesce(v_vydelano, 0), v_opakovane;
end;
$$;

comment on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid, uuid) is
  'Zapíše vyplacenou zálohu na pobočce výdeje. Totéž odeslání (p_klic) '
  'podruhé novou zálohu nezapíše a vrátí první s opakovane = true. '
  'Vyšší zálohu neodmítá, jen varuje.';

revoke all on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid, uuid) from public, anon;
grant execute on function public.vyplatit_zalohu(uuid, uuid, integer, text, uuid, uuid) to authenticated;
