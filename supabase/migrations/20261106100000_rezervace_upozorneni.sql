-- =====================================================================
-- Foodtab — Rezervace a akce: komu chodí upozornění
--
-- Zadání Šéfíka 2. 11. 2026: „přidej tlačítko notifikace a vybrání osob,
-- které by měly být upozorněné k akcím a rezervacím v kalendáři akcí“.
--
-- Scénář: krok107. Obrazovka: Provoz → Rezervace a akce → Upozornění
-- (app/[rozsah]/rezervace/upozorneni).
--
-- ---------------------------------------------------------------------
-- CO TO DĚLÁ
--
-- Kdo smí rezervace zapisovat (`rezervace.manage` na pobočce), vybere
-- u každé pobočky lidi a u každého zaškrtne, co mu má chodit:
--
--   * AKCE      — nová akce, změna akce (den, čas, počet osob, prostor,
--                 menu, název, potvrzení, z akce rezervace) a zrušená akce,
--   * REZERVACE — nová rezervace (ručně zapsaná i z rezervačního systému,
--                 i obnovená zrušená), zrušená rezervace a to, že se
--                 z rezervace stala akce,
--   * SOUHRN    — ranní souhrn dne (20261103100000). Když u pobočky nikoho
--                 nevyberou, dostanou ho jako dosud všichni, kdo rezervace
--                 té pobočky vidí — souhrn nesmí potichu přestat chodit.
--
-- U akcí a rezervací je to obráceně: nikdo vybraný = nikomu nic. Upozornění
-- na každou rezervaci všem by naučilo lidi zvoneček přeskakovat.
--
-- ---------------------------------------------------------------------
-- KOMU SMÍ PŘIJÍT
--
-- Vybrat jde jen člověka, který rezervace té pobočky VIDÍ (rezervace.read
-- nebo .manage — totéž co ranní souhrn a politika rezervace_cist). Kdo
-- by dostal upozornění na akci, kterou si nemůže otevřít, má zbytečné
-- pípnutí a k tomu název akce, který vidět nemá. Pravidlo se ptá ZNOVU při
-- odeslání (app.rezervace_prijemci): komu mezitím vzali práva nebo
-- pozastavili členství, tomu nic nepřijde, i když v seznamu zůstal.
--
-- V nabídce ani mezi příjemci není: kdo nemá účet (upozornění chodí jen do
-- aplikace a na telefon), ukončený nebo smazaný zaměstnanec a člověk
-- s pozastaveným členstvím.
--
-- Kdo změnu udělal, tomu se nic nepošle (sám sobě se nepíše). Zápis ze
-- synchronizace nebo příjmového API nemá autora (běží bez přihlášeného)
-- — ten dostanou všichni vybraní.
--
-- ---------------------------------------------------------------------
-- KDY SE NEPOSÍLÁ
--
--   * Import ze souboru (CSV): hromadné načtení stovek řádků není „nová
--     rezervace“. Spoušť na takových řádcích vůbec neběží (WHEN).
--   * Rezervační systém v prvních 24 hodinách připojení: první načtení
--     projde půl roku dopředu a všechno by bylo „nové“ (nebo „zrušené“).
--     Počítá se od prvního načítání připojení, které kalendář opravdu
--     prošlo (Choice; nepovedený pokus se nepočítá), u příjmového API od
--     založení připojení — NE od první rezervace, ta může přijít až za
--     týden. Kdyby v tu dobu přišla skutečně nová rezervace, ukáže ji
--     kalendář a ranní souhrn; upozornění se nedožene.
--   * Proběhlá akce či rezervace a „nedorazili“: o hotové věci ani o její
--     pozdější úpravě (doplněný počet hostů) nikdo upozornění nepotřebuje.
--   * Minulé dny (provozní den pobočky): dopisování historie nikoho
--     nezajímá. Rezervace přesunutá z minulého dne na dnešek či dál
--     (opravený překlep v datu) se ohlásí jako nová.
--   * Změny rezervací (ne akcí) kromě zrušení: posun o půl hodiny nebo
--     host navíc u stolu pro dva by chodily desetkrát denně. U akcí se
--     každá změna hlásí — kuchyně podle nich plánuje. Změna druhu jde
--     oběma stranám: z akce rezervace = kuchyni „z akce je rezervace“,
--     vybraným na rezervace nová rezervace; z rezervace akce = vybraným
--     na rezervace „z rezervace je akce“, kuchyni nová akce. Další změny
--     a zrušení pak jdou už jen podle nového druhu. Zrušení zároveň se
--     změnou druhu jde těm, kdo o řádku věděli: podle druhu před uložením.
--
-- Nové rezervace z rezervačního systému se slučují: jedna dávka = jedno
-- upozornění s počtem (oddíl 4b), a dokud ho člověk nepřečte, další
-- dávka téže pobočky počet přičte („3 nové rezervace“) — app.notifikovat,
-- telo.pocet. Ruční rezervace a všechny akce chodí každá zvlášť.
--
-- ---------------------------------------------------------------------
-- PROČ SPOUŠŤ, NE VOLÁNÍ Z FUNKCÍ
--
-- Do public.rezervace se zapisuje pěti cestami (rezervace_ulozit,
-- rezervace_zmenit_stav, a smyčka importu přes CSV, Choice a příjmové
-- API). Spoušť je jediné místo, které vidí všechny — volání ve funkcích
-- by se při další cestě zapomnělo. Spoušť běží jen na řádcích, kde se
-- změnilo něco, o čem se upozorňuje (WHEN), takže uložení zálohy nebo
-- opakované načtení beze změny nic nestojí.
--
-- Chyba v upozorňování NESMÍ shodit zápis rezervace (třeba celou dávku
-- z Choice): blok upozornění chytá výjimku a jen ji zaloguje.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Vlastní vypínač v Nastavení upozornění pro nové druhy: o tom, komu
--     to chodí, rozhoduje vedoucí výběrem. Ranní souhrn si každý vypnout
--     může dál (kategorie rezervace_souhrn, beze změny).
--   * Do nadpisu (= text push na zamčené obrazovce přes cizí službu) nejde
--     jméno hosta ani název akce, jen den, čas a počet osob. Název akce je
--     v těle a ukáže ho jen aplikace. Jméno hosta a kontakt nejdou nikam.
--   * Připomínka den před akcí — nikdo nežádal; ranní souhrn ji v den akce
--     ukáže.
--   * Při sloučení změn akce zůstane v upozornění jen poslední změna
--     (seznam „co se změnilo“ se nesčítá); odkaz vede na akci, kde je
--     vidět aktuální stav.
--
-- PŘEPISUJE app.rezervace_souhrn_dne (20261103100000) — mění se jen
-- výběr příjemců (bod 6). Tělo je jinak opsané beze změny.
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. KOHO UPOZORNIT — výběr po pobočkách
--
-- Řádek jen pro člověka, kterému aspoň něco chodí (check). Zapisuje jen
-- public.rezervace_upozorneni_ulozit; klient smí číst (RLS jako zápis
-- rezervací), i když obrazovka bere seznam z rezervace_upozorneni_lide.
-- ---------------------------------------------------------------------

create table public.rezervace_upozorneni (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  akce         boolean not null default false,
  rezervace    boolean not null default false,
  souhrn       boolean not null default false,
  zmenil       uuid references public.employees(id) on delete set null,
  zmeneno_kdy  timestamptz not null default now(),
  unique (branch_id, employee_id),
  check (akce or rezervace or souhrn)
);

comment on table public.rezervace_upozorneni is
  'Komu na pobočce chodí upozornění k rezervacím a akcím (akce, rezervace, '
  'ranní souhrn). Zapisuje jen rezervace_upozorneni_ulozit. Při odeslání se '
  'znovu ověřuje, že člověk rezervace pobočky vidí (app.rezervace_prijemci).';

-- Druhá linie: pobočka i člověk patří firmě řádku.
create function app.rezervace_upozorneni_hlida()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.branches b
     where b.id = new.branch_id and b.tenant_id = new.tenant_id
  ) then
    raise exception 'Pobočka nepatří téhle firmě.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.employees e
     where e.id = new.employee_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Člověk nepatří téhle firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.rezervace_upozorneni_hlida() from public, anon, authenticated;

create trigger trg_rezervace_upozorneni_hlida
  before insert or update on public.rezervace_upozorneni
  for each row execute function app.rezervace_upozorneni_hlida();

create trigger trg_audit_rezervace_upozorneni
  after insert or update or delete on public.rezervace_upozorneni
  for each row execute function app.audit_zmenu('rezervace_upozorneni');

alter table public.rezervace_upozorneni enable row level security;

revoke all on public.rezervace_upozorneni from public, anon, authenticated;
grant select on public.rezervace_upozorneni to authenticated;

create policy rezervace_upozorneni_cist on public.rezervace_upozorneni
  for select to authenticated
  using (app.has_access(tenant_id, 'rezervace.manage', branch_id));


-- ---------------------------------------------------------------------
-- 2. KDO REZERVACE POBOČKY VIDÍ — jediné pravidlo pro výběr i odeslání
--
-- Stejné jako příjemci ranního souhrnu dosud: rezervace.read NEBO
-- rezervace.manage na pobočce, přes app.kdo_ma_pravo_na_pobocce (aktivní
-- členství, rozsah, zapnutý modul, majitel). Nabídka na obrazovce i odeslání
-- se ptají TÉHLE funkce — kdo je v nabídce, tomu upozornění opravdu přijde.
-- ---------------------------------------------------------------------

create function app.rezervace_kdo_vidi(p_tenant uuid, p_branch uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select x.user_id from app.kdo_ma_pravo_na_pobocce(p_tenant, 'rezervace.read', p_branch) x
  union
  select x.user_id from app.kdo_ma_pravo_na_pobocce(p_tenant, 'rezervace.manage', p_branch) x
$$;

revoke all on function app.rezervace_kdo_vidi(uuid, uuid) from public, anon, authenticated;

comment on function app.rezervace_kdo_vidi(uuid, uuid) is
  'Účty, které rezervace pobočky vidí (rezervace.read nebo .manage).';


-- `p_co`: 'akce' | 'rezervace' | 'souhrn'. Vybraní ∩ ti, kdo vidí.
-- Souhrn bez jediného (platného) vybraného jde všem, kdo vidí — jako dřív.
create function app.rezervace_prijemci(p_tenant uuid, p_branch uuid, p_co text)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  -- Kdo vidí a je aktivní zaměstnanec firmy — jediné místo té podmínky,
  -- platí pro vybrané i pro souhrn bez výběru (ukončený nedostane nic).
  with vidi as (
    select e.id as employee_id, e.user_id
      from app.rezervace_kdo_vidi(p_tenant, p_branch) k
      join public.employees e
        on e.user_id = k.user_id
       and e.tenant_id = p_tenant
       and e.deleted_at is null
       and e.active
  ),
  vybrani as (
    select v.user_id
      from vidi v
     where exists (
       select 1
         from public.rezervace_upozorneni u
        where u.branch_id   = p_branch
          and u.employee_id = v.employee_id
          and case p_co
                when 'akce'      then u.akce
                when 'rezervace' then u.rezervace
                when 'souhrn'    then u.souhrn
                else false
              end
     )
  )
  select b.user_id from vybrani b
  union
  select v.user_id from vidi v
   where p_co = 'souhrn'
     and not exists (select 1 from vybrani)
$$;

revoke all on function app.rezervace_prijemci(uuid, uuid, text) from public, anon, authenticated;

comment on function app.rezervace_prijemci(uuid, uuid, text) is
  'Komu poslat upozornění k rezervacím pobočky (akce / rezervace / souhrn): '
  'vybraní v rezervace_upozorneni, kteří rezervace pobočky vidí. Souhrn bez '
  'vybraných všem, kdo vidí.';


-- ---------------------------------------------------------------------
-- 3. OBRAZOVKA — seznam lidí k výběru a uložení výběru
--
-- Obě jen pro rezervace.manage NA TÉ POBOČCE. Definer bez druhé linie:
-- pobočka se ověřuje proti firmě (has_access s firemním členstvím pustí
-- i cizí pobočku), lidé se berou jen z rezervace_kdo_vidi té firmy.
-- ---------------------------------------------------------------------

create function public.rezervace_upozorneni_lide(p_tenant uuid, p_branch uuid)
returns table (
  employee_id uuid,
  jmeno       text,
  zarazeni    text,
  akce        boolean,
  rezervace   boolean,
  souhrn      boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_tenant is null or p_branch is null
     or not exists (
       select 1 from public.branches b
        where b.id = p_branch and b.tenant_id = p_tenant and b.deleted_at is null and b.active
     )
     or not app.has_access(p_tenant, 'rezervace.manage', p_branch) then
    raise exception 'Upozornění k rezervacím na téhle pobočce nastavovat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select e.id,
           e.full_name,
           coalesce(po.label, ''),
           coalesce(u.akce, false),
           coalesce(u.rezervace, false),
           coalesce(u.souhrn, false)
      from app.rezervace_kdo_vidi(p_tenant, p_branch) k
      join public.employees e
        on e.user_id = k.user_id
       and e.tenant_id = p_tenant
       and e.deleted_at is null
       and e.active
      left join public.positions po on po.id = e.position_id
      left join public.rezervace_upozorneni u
        on u.branch_id = p_branch
       and u.employee_id = e.id
     order by e.full_name, e.id;
end $$;

revoke all on function public.rezervace_upozorneni_lide(uuid, uuid) from public, anon;
grant execute on function public.rezervace_upozorneni_lide(uuid, uuid) to authenticated;

comment on function public.rezervace_upozorneni_lide(uuid, uuid) is
  'Lidé, kteří rezervace pobočky vidí, a co jim chodí. Pro obrazovku '
  'Upozornění v Rezervacích; jen rezervace.manage na pobočce.';


-- Uloží CELÝ výběr pobočky: kdo v žádném poli není, tomu nechodí nic.
-- Vrací počet lidí, kterým něco chodí.
create function public.rezervace_upozorneni_ulozit(
  p_tenant    uuid,
  p_branch    uuid,
  p_akce      uuid[],
  p_rezervace uuid[],
  p_souhrn    uuid[]
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_akce      uuid[] := coalesce(p_akce, '{}');
  v_rezervace uuid[] := coalesce(p_rezervace, '{}');
  v_souhrn    uuid[] := coalesce(p_souhrn, '{}');
  v_vsichni   uuid[];
begin
  if p_tenant is null or p_branch is null
     or not exists (
       select 1 from public.branches b
        where b.id = p_branch and b.tenant_id = p_tenant and b.deleted_at is null and b.active
     )
     or not app.has_access(p_tenant, 'rezervace.manage', p_branch) then
    raise exception 'Upozornění k rezervacím na téhle pobočce nastavovat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  v_vsichni := array(
    select distinct x from unnest(v_akce || v_rezervace || v_souhrn) x where x is not null
  );

  if cardinality(v_vsichni) > 500 then
    raise exception 'Vybraných lidí je moc (nejvýš 500).' using errcode = 'check_violation';
  end if;

  -- Každý vybraný musí rezervace téhle pobočky vidět — totéž pravidlo,
  -- podle kterého se pak posílá.
  if exists (
    select 1 from unnest(v_vsichni) x
     where not exists (
       select 1
         from public.employees e
         join app.rezervace_kdo_vidi(p_tenant, p_branch) k on k.user_id = e.user_id
        where e.id = x
          and e.tenant_id = p_tenant
          and e.deleted_at is null
          and e.active
     )
  ) then
    raise exception 'Někdo z vybraných rezervace na téhle pobočce nevidí.'
      using errcode = 'check_violation';
  end if;

  delete from public.rezervace_upozorneni u
   where u.tenant_id = p_tenant
     and u.branch_id = p_branch
     and not (u.employee_id = any (v_vsichni));

  insert into public.rezervace_upozorneni as u
    (tenant_id, branch_id, employee_id, akce, rezervace, souhrn, zmenil)
  select p_tenant, p_branch, x,
         x = any (v_akce), x = any (v_rezervace), x = any (v_souhrn),
         app.muj_employee(p_tenant)
    from unnest(v_vsichni) x
  on conflict (branch_id, employee_id) do update
    set akce        = excluded.akce,
        rezervace   = excluded.rezervace,
        souhrn      = excluded.souhrn,
        zmenil      = excluded.zmenil,
        zmeneno_kdy = now()
    -- Beze změny se řádek nepřepisuje (audit by se plnil prázdnými úpravami).
    where (u.akce, u.rezervace, u.souhrn)
          is distinct from (excluded.akce, excluded.rezervace, excluded.souhrn);

  return cardinality(v_vsichni);
end $$;

revoke all on function public.rezervace_upozorneni_ulozit(uuid, uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.rezervace_upozorneni_ulozit(uuid, uuid, uuid[], uuid[], uuid[]) to authenticated;

comment on function public.rezervace_upozorneni_ulozit(uuid, uuid, uuid[], uuid[], uuid[]) is
  'Uloží, komu na pobočce chodí upozornění k akcím, rezervacím a ranní '
  'souhrn (celý výběr naráz). Jen rezervace.manage na pobočce; vybrat jde '
  'jen toho, kdo rezervace pobočky vidí.';


-- ---------------------------------------------------------------------
-- 4. UPOZORNĚNÍ PŘI ZÁPISU REZERVACE NEBO AKCE
--
-- Druhy (věty skládá lib/upozorneni-text.ts):
--   akce.nova, akce.zmenena, akce.zrusena, rezervace.nova,
--   rezervace.zmenena (jen „z rezervace je akce“), rezervace.zrusena
-- Tělo: rezervace_id, den, cas (hodina na zdi pobočky), osob, nazev (jen
-- akce), pobocka, pobocka_slug, co_se_zmenilo (jen *.zmenena), pocet (jen
-- sloučené nové rezervace z rezervačního systému).
-- ---------------------------------------------------------------------

-- Tělo upozornění z řádku rezervace. Pro obě spouště níž (po řádcích
-- i za dávku), ať se nerozejdou.
create function app.rezervace_upozorneni_telo(
  p_r     public.rezervace,
  p_nazev text,
  p_zmeny text[]
)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'rezervace_id',  p_r.id,
    'den',           p_r.den,
    'cas',           to_char(p_r.zacatek at time zone app.zona_pobocky(p_r.branch_id), 'HH24:MI'),
    'osob',          p_r.pocet_osob,
    'nazev',         nullif(btrim(p_nazev), ''),
    'pobocka',       b.name,
    'pobocka_slug',  b.slug,
    'co_se_zmenilo', case when cardinality(p_zmeny) > 0 then to_jsonb(p_zmeny) end
  ))
    from public.branches b
   where b.id = p_r.branch_id
$$;

revoke all on function app.rezervace_upozorneni_telo(public.rezervace, text, text[]) from public, anon, authenticated;

create function app.rezervace_upozornit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_import boolean;
  v_dnes   date;
  v_druh   text;
  v_komu   text;
  v_zmeny  text[] := '{}';
  v_nazev  text;
  v_klic   text;
  v_telo   jsonb;
  v_ja     uuid := auth.uid();
  v_u      record;
  -- Změna druhu: druhé upozornění vybraným na rezervace.
  v_druh2  text;
  v_zmeny2 text[] := '{}';
begin
  -- Zápis ze synchronizace nebo importu: nový importovaný řádek, nebo
  -- úprava, při které import přepsal razítko `importovano_kdy`.
  v_import := case when tg_op = 'INSERT' then new.zdroj <> 'rucne'
                   else new.importovano_kdy is distinct from old.importovano_kdy end;

  -- Minulé provozní dny se nehlásí (dopisování historie).
  v_dnes := app.business_date(new.branch_id, now());
  if new.den < v_dnes and (tg_op = 'INSERT' or old.den < v_dnes) then
    return null;
  end if;

  -- Proběhlá a „nedorazili“: o hotové věci se nic nehlásí — ani to, že
  -- proběhla, ani pozdější úprava (doplněný počet hostů), ani změna druhu.
  if new.stav in ('dokonceno', 'nedostavil_se') then
    return null;
  end if;

  -- První den připojení rezervačního systému: první načtení projde celé
  -- okno dopředu a nic z toho není novinka — nová, zrušená ani změněná.
  -- Počítá se od prvního načítání připojení (Choice zapisuje každé do
  -- synchronizace_behy), a kde se nenačítá, protože data posílá systém
  -- sám (příjmové API), od založení připojení. NE od první rezervace
  -- připojení: ta může přijít až za týden a byla by skutečně nová.
  --
  -- Načítání se počítá, jen když právě běží, nebo když doběhlo a na zdroj
  -- se opravdu zeptalo (vyplněný počet nových — lib/rezervace-choice-sync.ts,
  -- `dokoncit`). Nepovedený pokus (neplatný klíč, plná fronta) kalendář
  -- neprošel: kdyby první den posunul, první skutečné načtení po opravě
  -- by ohlásilo celý kalendář jako nový.
  if v_import and new.pripojeni_id is not null and coalesce(
       (select min(s.zahajeno_kdy) from public.synchronizace_behy s
         where s.integrace_pripojeni_id = new.pripojeni_id
           and (s.stav = 'bezi' or (s.stav = 'hotovo' and s.pocet_novych_radku is not null))),
       (select p.vytvoreno_kdy from public.integrace_pripojeni p
         where p.id = new.pripojeni_id)
     ) > now() - interval '24 hours' then
    return null;
  end if;

  -- Nová = zapsaná teď, nebo posunutá z minulého dne na dnešek či dál
  -- (překlep v datu opravený na skutečný den o ní nikomu neřekl).
  if tg_op = 'INSERT' or old.den < v_dnes then
    if new.stav = 'zrusena' then
      return null;
    end if;
    v_druh := case when new.druh = 'akce' then 'akce.nova' else 'rezervace.nova' end;
    v_komu := case when new.druh = 'akce' then 'akce' else 'rezervace' end;
  elsif new.stav = 'zrusena' then
    -- Změny už zrušené nikoho nezajímají.
    if old.stav = 'zrusena' then
      return null;
    end if;
    -- Zrušení jde těm, kdo o ní věděli — podle druhu PŘED uložením, i když
    -- se druh změnil zároveň.
    v_druh := case when old.druh = 'akce' then 'akce.zrusena' else 'rezervace.zrusena' end;
    v_komu := case when old.druh = 'akce' then 'akce' else 'rezervace' end;
  elsif new.druh = 'akce' and old.druh <> 'akce' then
    -- Z rezervace je akce: kuchyni nová akce. Vybraní na rezervace s ní
    -- počítali jako s rezervací — dostanou „z rezervace je akce“ (níž);
    -- další změny a zrušení už jdou jen kuchyni.
    v_druh := 'akce.nova';
    v_komu := 'akce';
    v_druh2 := 'rezervace.zmenena';
    v_zmeny2 := array['druh'];
  elsif old.druh = 'akce' and new.druh <> 'akce' then
    -- Z akce je rezervace: kuchyně s akcí počítala, musí to vědět. Pod
    -- názvem, který měla jako akce. Vybraným na rezervace přijde jako
    -- nová rezervace (níž) — o akci nevěděli a zrušení pak dostanou oni.
    v_druh2 := 'rezervace.nova';
    v_zmeny := array['druh'];
    v_nazev := coalesce(nullif(btrim(old.nazev), ''), nullif(btrim(old.typ_akce), ''));
    v_druh := 'akce.zmenena';
    v_komu := 'akce';
  elsif new.druh = 'akce' then
    if new.den <> old.den then
      v_zmeny := v_zmeny || 'den'::text;
    elsif new.zacatek <> old.zacatek or new.konec is distinct from old.konec then
      v_zmeny := v_zmeny || 'cas'::text;
    end if;
    if new.pocet_osob is distinct from old.pocet_osob then
      v_zmeny := v_zmeny || 'osob'::text;
    end if;
    if new.prostor <> old.prostor then
      v_zmeny := v_zmeny || 'prostor'::text;
    end if;
    if new.menu <> old.menu then
      v_zmeny := v_zmeny || 'menu'::text;
    end if;
    if new.nazev <> old.nazev or new.typ_akce <> old.typ_akce then
      v_zmeny := v_zmeny || 'nazev'::text;
    end if;
    -- Potvrzení předběžné nebo obnovení zrušené. (Zrušení má větev výš,
    -- „proběhla“ a „nedorazili“ zastavila podmínka nahoře.)
    if new.stav <> old.stav then
      v_zmeny := v_zmeny || 'stav'::text;
    end if;
    if cardinality(v_zmeny) = 0 then
      return null;
    end if;
    v_druh := 'akce.zmenena';
    v_komu := 'akce';
  elsif old.stav = 'zrusena' then
    -- Obnovená zrušená rezervace (teď čeká nebo potvrzená — zrušení
    -- i hotové zastavily větve výš): vybraní dostali „zrušená“ a bez
    -- upozornění by s ní nepočítali.
    v_druh := 'rezervace.nova';
    v_komu := 'rezervace';
  else
    return null;
  end if;

  -- Nová z rezervačního systému se jen započítá; upozornění pošle jednou
  -- za pobočku a dávku odložená spoušť níž (app.rezervace_upozornit_davku).
  -- Jen `externi`: nový řádek ze souboru (csv) sem nedojde, zastaví ho
  -- jediná podmínka u spouště při vložení (`when (new.zdroj <> 'csv')`).
  -- Kdyby ho tu jistil i tenhle řádek, kontrola „import ze souboru nic“
  -- by nešla shodit. Data zdroje ručně měnit nejde, takže `externi` tu
  -- znamená načtení ze zdroje.
  if v_druh = 'rezervace.nova' and new.zdroj = 'externi' then
    v_klic := 'foodtab_rezervace.nove_' || replace(new.branch_id::text, '-', '');
    perform set_config(v_klic, jsonb_build_object(
      'pocet', coalesce((nullif(current_setting(v_klic, true), '')::jsonb ->> 'pocet')::integer, 0) + 1,
      'id',    new.id
    )::text, true);
    return null;
  end if;

  if v_komu = 'akce' and v_nazev is null then
    v_nazev := coalesce(nullif(btrim(new.nazev), ''), nullif(btrim(new.typ_akce), ''));
  end if;

  begin
    v_telo := app.rezervace_upozorneni_telo(new, v_nazev, v_zmeny);

    for v_u in
      select p.user_id
        from app.rezervace_prijemci(new.tenant_id, new.branch_id, v_komu) p
       where p.user_id is distinct from v_ja
    loop
      perform app.notifikovat(
        new.tenant_id, v_u.user_id, v_druh, v_telo, 'normal',
        new.branch_id, null, 'rezervace', new.id, v_druh || ':' || new.id
      );
    end loop;

    if v_druh2 is not null then
      v_telo := app.rezervace_upozorneni_telo(new, null, v_zmeny2);
      for v_u in
        select p.user_id
          from app.rezervace_prijemci(new.tenant_id, new.branch_id, 'rezervace') p
         where p.user_id is distinct from v_ja
      loop
        perform app.notifikovat(
          new.tenant_id, v_u.user_id, v_druh2, v_telo, 'normal',
          new.branch_id, null, 'rezervace', new.id, v_druh2 || ':' || new.id
        );
      end loop;
    end if;
  exception when others then
    raise warning 'Upozornění k rezervaci % se nepodařilo poslat: % %', new.id, sqlstate, sqlerrm;
  end;

  return null;
end $$;

revoke all on function app.rezervace_upozornit() from public, anon, authenticated;

comment on function app.rezervace_upozornit() is
  'Spoušť: upozornění vybraným lidem při nové, změněné a zrušené akci a při '
  'nové a zrušené rezervaci. Viz hlavička 20261106100000.';

create trigger trg_rezervace_upozornit_vlozeni
  after insert on public.rezervace
  for each row
  when (new.zdroj <> 'csv')
  execute function app.rezervace_upozornit();

create trigger trg_rezervace_upozornit_zmena
  after update on public.rezervace
  for each row
  when (
    (new.stav, new.druh, new.zacatek, new.konec, new.pocet_osob,
     new.prostor, new.menu, new.nazev, new.typ_akce)
      is distinct from
    (old.stav, old.druh, old.zacatek, old.konec, old.pocet_osob,
     old.prostor, old.menu, old.nazev, old.typ_akce)
    -- Import ze souboru nic nehlásí ani při změně; ruční úprava řádku
    -- z CSV (třeba „udělat z ní akci“) ano.
    and not (new.zdroj = 'csv' and new.importovano_kdy is distinct from old.importovano_kdy)
  )
  execute function app.rezervace_upozornit();


-- ---------------------------------------------------------------------
-- 4b. NOVÉ REZERVACE Z REZERVAČNÍHO SYSTÉMU — JEDNO UPOZORNĚNÍ ZA DÁVKU
--
-- Dávka ze synchronizace má až 2000 řádků v jedné transakci. Upozorňovat
-- po řádcích by znamenalo u každého nového řádku znovu spočítat příjemce,
-- každému přepsat sloučené upozornění (smazat, vložit, zařadit do fronty)
-- a otevřít podtransakci bloku s výjimkou — dávka by se protáhla, mohla
-- narazit na časový limit a spadnout celá, i s rezervacemi.
--
-- Spoušť výš proto nové řádky dávky jen počítá (nastavení platné do konce
-- transakce, po pobočkách: počet a poslední řádek). Tahle spoušť je
-- odložená na potvrzení transakce: první řádek pobočky počet vybere,
-- vynuluje a pošle jedno upozornění s počtem; ostatní řádky nenajdou nic.
-- app.notifikovat počet přičte k nepřečtenému z minulých dávek.
-- ---------------------------------------------------------------------

create function app.rezervace_upozornit_davku()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_klic  text := 'foodtab_rezervace.nove_' || replace(new.branch_id::text, '-', '');
  v_davka jsonb;
  v_r     public.rezervace;
  v_telo  jsonb;
  v_ja    uuid := auth.uid();
  v_u     record;
begin
  v_davka := nullif(current_setting(v_klic, true), '')::jsonb;
  if v_davka is null then
    return null;
  end if;
  perform set_config(v_klic, '', true);

  begin
    select r.* into v_r from public.rezervace r where r.id = (v_davka ->> 'id')::uuid;
    v_telo := app.rezervace_upozorneni_telo(v_r, null, '{}')
           || jsonb_build_object('pocet', (v_davka ->> 'pocet')::integer);

    for v_u in
      select p.user_id
        from app.rezervace_prijemci(v_r.tenant_id, v_r.branch_id, 'rezervace') p
       where p.user_id is distinct from v_ja
    loop
      perform app.notifikovat(
        v_r.tenant_id, v_u.user_id, 'rezervace.nova', v_telo, 'normal',
        v_r.branch_id, null, 'rezervace', v_r.id, 'rezervace.nova:pobocka:' || v_r.branch_id
      );
    end loop;
  exception when others then
    raise warning 'Upozornění na nové rezervace pobočky % se nepodařilo poslat: % %', new.branch_id, sqlstate, sqlerrm;
  end;

  return null;
end $$;

revoke all on function app.rezervace_upozornit_davku() from public, anon, authenticated;

comment on function app.rezervace_upozornit_davku() is
  'Odložená spoušť: jedno upozornění na nové rezervace z rezervačního '
  'systému za pobočku a dávku. Viz 20261106100000, oddíl 4b.';

-- Jen řádky z připojení (zdroj externi): jen ty spoušť výš počítá.
-- Podmínka jen šetří práci (ruční a CSV řádky nic nezapočítaly, tak by
-- funkce nic nenašla) — nehlídá nic, proto na ni nemíří žádné rozbití.
create constraint trigger trg_rezervace_upozornit_davka
  after insert or update on public.rezervace
  deferrable initially deferred
  for each row
  when (new.zdroj = 'externi')
  execute function app.rezervace_upozornit_davku();


-- ---------------------------------------------------------------------
-- 5. ZDROJ UPOZORNĚNÍ PRO „PUSH HNED“
--
-- Ruční zápis pošle push vybraným hned po uložení (lib/komunikace/
-- push-hned.ts, zdroj {typ:'rezervace', id}). zdroj_typ nemá výčet
-- (jen délku), nic se tu nemění — poznámka, ať se nehledá.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 6. RANNÍ SOUHRN — příjemci podle výběru
--
-- Opsané z 20261103100000 beze změny až na výběr příjemců: místo
-- „všichni, kdo vidí“ app.rezervace_prijemci(…, 'souhrn') — vybraní,
-- a když u pobočky nikdo vybraný není, všichni, kdo vidí (jako dosud).
-- ---------------------------------------------------------------------

create or replace function app.rezervace_souhrn_dne(
  p_ted    timestamptz default now(),
  p_tenant uuid        default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_od         constant time := time '08:00';
  c_do         constant time := time '16:00';
  -- Kolik akcí jedné pobočky jde do těla upozornění (počet `akci` je vždy celý).
  c_akci_max   constant integer := 20;
  v_t          record;
  v_b          record;
  v_u          record;
  v_zona       text;
  v_den        date;
  v_pobocka    jsonb;
  v_pobocky    jsonb;
  v_souhrn     jsonb;
  v_id         uuid;
  v_pob_firmy  integer;
  v_upo_firmy  integer;
  v_pobocek    integer := 0;
  v_upozorneni integer := 0;
  v_chyb       integer := 0;
begin
  delete from public.rezervace_souhrn_dne s
   where s.den < (p_ted at time zone 'UTC')::date - 90;

  for v_t in
    select t.id from public.tenants t
     where t.deleted_at is null
       and (p_tenant is null or t.id = p_tenant)
     order by t.id
  loop
    begin
      -- Pobočky téhle firmy, kterým právě začal čas souhrnu, a jejich čísla:
      -- { "<branch_id>": { pobocka, slug, den, rezervaci, hostu, bez_poctu, akci, akce[] } }
      v_pobocky := '{}'::jsonb;
      v_pob_firmy := 0;
      v_upo_firmy := 0;

      for v_b in
        select b.id, b.name, b.slug
          from public.branches b
         where b.tenant_id = v_t.id
           and b.active
           and b.deleted_at is null
         order by b.name, b.id
      loop
        v_zona := app.zona_pobocky(v_b.id);
        v_den  := app.business_date(v_b.id, p_ted);

        -- Hodina na zdi pobočky v JEJÍM provozním dni (CLAUDE.md, pravidla
        -- 10–11). Ve 2:00 po půlnoci je provozní den ještě včerejší a jeho
        -- okno skončilo v 16:00 — nic. Den, který začíná později než v osm,
        -- se pošle od svého začátku: do té doby je provozní den včerejší.
        if p_ted <  (v_den + c_od) at time zone v_zona
           or p_ted >= (v_den + c_do) at time zone v_zona then
          continue;
        end if;

        select jsonb_build_object(
                 'pobocka',   v_b.name,
                 'slug',      v_b.slug,
                 'den',       v_den,
                 -- Stejně jako souhrnDne (lib/rezervace-kalendar.ts) v kalendáři
                 -- a okénko hostů v Rozpisu: hosté rezervací I akcí.
                 'rezervaci', count(*) filter (where r.druh = 'rezervace'),
                 'akci',      count(*) filter (where r.druh = 'akce'),
                 'hostu',     coalesce(sum(r.pocet_osob), 0),
                 'bez_poctu', count(*) filter (where r.pocet_osob is null),
                 'akce',      coalesce((
                    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'cas',     to_char(a.zacatek at time zone v_zona, 'HH24:MI'),
                             'nazev',   coalesce(nullif(btrim(a.nazev), ''), nullif(btrim(a.typ_akce), ''), 'Akce'),
                             'osob',    a.pocet_osob,
                             'prostor', nullif(btrim(a.prostor), '')
                           )) order by a.zacatek, a.id)
                      from (
                        select x.zacatek, x.id, x.nazev, x.typ_akce, x.pocet_osob, x.prostor
                          from public.rezervace x
                         where x.branch_id = v_b.id
                           and x.den       = v_den
                           and x.druh      = 'akce'
                           and x.stav not in ('zrusena', 'nedostavil_se')
                         order by x.zacatek, x.id
                         limit c_akci_max
                      ) a
                  ), '[]'::jsonb)
               )
          into v_pobocka
          from public.rezervace r
         where r.branch_id = v_b.id
           and r.den       = v_den
           -- pocitaSeDoHostu (lib/rezervace-typy.ts): zrušení a nedorazivší
           -- nepřijdou. Shodu hlídá scripts/upozorneni.test.mjs.
           and r.stav not in ('zrusena', 'nedostavil_se');

        insert into public.rezervace_souhrn_dne (tenant_id, branch_id, den, rezervaci, hostu, akci)
        values (v_t.id, v_b.id, v_den,
                (v_pobocka->>'rezervaci')::integer,
                (v_pobocka->>'hostu')::integer,
                (v_pobocka->>'akci')::integer)
        on conflict (branch_id, den) do nothing;

        -- Už vyhodnoceno dřívějším (nebo souběžným) během.
        if not found then
          continue;
        end if;

        v_pobocky := v_pobocky || jsonb_build_object(v_b.id::text, v_pobocka);
        v_pob_firmy := v_pob_firmy + 1;
      end loop;

      if v_pob_firmy > 0 then
        -- Komu z těch poboček souhrn chodí: vybraní (Rezervace → Upozornění),
        -- a kde nikdo vybraný není, všichni, kdo rezervace pobočky vidí.
        for v_u in
          select k.user_id, array_agg(distinct p.key order by p.key) as pobocky
            from jsonb_each(v_pobocky) p
           cross join lateral app.rezervace_prijemci(v_t.id, p.key::uuid, 'souhrn') k
           group by k.user_id
        loop
          select jsonb_agg(v_pobocky -> s.klic order by v_pobocky -> s.klic ->> 'pobocka', s.klic)
            into v_souhrn
            from unnest(v_u.pobocky) as s(klic);

          -- Na žádné z jeho poboček nic není → nic se neposílá (hlavička).
          if not exists (
            select 1 from jsonb_array_elements(v_souhrn) e
             where (e->>'rezervaci')::integer > 0 or (e->>'akci')::integer > 0
          ) then
            continue;
          end if;

          v_id := app.notifikovat(
            v_t.id,
            v_u.user_id,
            'rezervace.souhrn_dne',
            jsonb_build_object('den', v_souhrn -> 0 ->> 'den', 'souhrn', v_souhrn),
            'normal',
            case when cardinality(v_u.pobocky) = 1 then v_u.pobocky[1]::uuid end,
            null,
            'rezervace_souhrn',
            null,
            -- Klíč podle SADY poboček, bez dne: dnešní souhrn nahradí
            -- včerejší nepřečtený (a zruší jeho čekající push), ale souhrn
            -- pobočky v jiném pásmu, který přijde o hodinu později, ten
            -- první nesmaže.
            'rezervace.souhrn_dne:' || md5(array_to_string(v_u.pobocky, ','))
          );

          if v_id is not null then
            v_upo_firmy := v_upo_firmy + 1;
          end if;
        end loop;
      end if;

      v_pobocek := v_pobocek + v_pob_firmy;
      v_upozorneni := v_upozorneni + v_upo_firmy;
    exception when others then
      v_chyb := v_chyb + 1;
      raise warning 'Ranní souhrn rezervací firmy % selhal: % %', v_t.id, sqlstate, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('pobocek', v_pobocek, 'upozorneni', v_upozorneni, 'chyb', v_chyb);
end $$;

revoke all on function app.rezervace_souhrn_dne(timestamptz, uuid) from public, anon, authenticated, service_role;
