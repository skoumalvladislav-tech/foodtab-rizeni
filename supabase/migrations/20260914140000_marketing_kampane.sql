-- =====================================================================
-- Foodtab — modul Marketing: kampaně a automatizace
--
-- Zadání: master prompt, oddíl 15 („Kalendář, kampaně a automatizace")
-- a obrazovka 11 z oddílu 22.
--
-- ---------------------------------------------------------------------
-- PROČ KAMPAŇ, KDYŽ UŽ JE KALENDÁŘ
--
-- Kalendář od 14. 9. ukazuje, co kdy půjde ven. Obsah se ale pořád
-- zakládá po jednom příspěvku — a restaurace nedělá jeden příspěvek.
-- Dělá AKCI a k ní patří série: pozvánka týden předem, připomínka den
-- předem, poslední výzva ráno, po akci poděkování s fotkami.
--
-- Bez kampaně jsou to čtyři nesouvisející příspěvky. Když se akce
-- posune, musí se hledat všechny čtyři; když se zruší, zůstane
-- poslední výzva na něco, co nebude.
--
-- ---------------------------------------------------------------------
-- AUTOMATIZACE NIC NEZVEŘEJNÍ. VYROBÍ KONCEPTY.
--
-- Tohle je na celé migraci to nejdůležitější a je to schválně zapsané
-- i v datech: `marketing_automatizace` nemá sloupec, kterým by šlo
-- říct „a rovnou to pošli ven".
--
-- Důvod není opatrnost, ale pravidlo, na kterém stojí celý modul:
-- ven jde jen to, co někdo odklepl (`app.marketing_strez_publikaci`).
-- Kdyby automatizace uměla naplánovat publikaci, byla by to druhá
-- cesta ven — a ta by ty čtyři spouště obešla. Vyrobí koncepty
-- a člověk je schválí; jinak by stačilo jednou špatně nastavit
-- opakování a restaurace by měsíc zveřejňovala nesmysly.
--
-- ---------------------------------------------------------------------
-- VYPÍNAČ, VLASTNÍK A HISTORIE JSOU POVINNÉ, NE HEZKÉ
--
-- Zadání, oddíl 15: „Každá automatizace má mít vypínač, vlastníka,
-- provozovnu, poslední a příští spuštění, historii výsledků a možnost
-- bezpečně ji pozastavit."
--
-- Proto je tu `marketing_automatizace_behy` jako vlastní tabulka a ne
-- jen sloupec `posledni_vysledek`. Automatizace, u které se nedá
-- zjistit, co udělala minulý týden, je horší než ruční práce: ruční
-- práci je aspoň vidět.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Kampaň NENÍ nadřazená pobočce. Patří jedné pobočce, stejně jako
--   příspěvek. „Kampaň za celou firmu" by znamenala, že Bernard Bar
--   zve na akci, která je na Černé Perle.
-- * `marketing_prispevky.kampan_id` je `on delete set null`, ne
--   `cascade`. Smazání kampaně nesmí smazat zveřejněné příspěvky —
--   ty už jsou venku a v historii mají zůstat.
-- * Žádné spouštění v databázi. Kdy se automatizace pustí, rozhoduje
--   úloha v aplikaci (jako `marketing-fronta`), ne `pg_cron`. Jedno
--   místo, které rozhoduje o čase, je lepší než dvě.
-- * Žádný sloupec na „počet vygenerovaných příspěvků" na automatizaci.
--   Spočítá se z běhů. Dvě místa s týmž číslem se rozejdou.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KAMPAŇ
--
-- Jedna akce a všechno, co se k ní zveřejní.
-- ---------------------------------------------------------------------

create table public.marketing_kampane (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- Kampaň patří pobočce. Viz „co se schválně nedělá" v hlavičce.
  branch_id     uuid not null references public.branches(id) on delete cascade,

  nazev         text not null check (btrim(nazev) <> ''),
  cil           text not null default '',

  /*
    KDY SE TO KONÁ.

    `null` je legitimní: průběžná kampaň (třeba „obědové menu") žádný
    jeden termín nemá. Série se z ní pak generovat nedá a obrazovka to
    musí říct — proto se to nedoplňuje dneškem.
  */
  kona_se_kdy   timestamptz,

  -- Pilíř ze šesti (`lib/marketing-kalendar.ts`). Kvůli barvě
  -- v kalendáři a filtru; volný text schválně, stejně jako
  -- u `marketing_prispevky.pilir` — číselník je v kódu, ne v omezení,
  -- aby přidání pilíře nebyla migrace.
  pilir         text not null default 'akce',

  stav          text not null default 'pripravuje_se' check (stav in
                  ('pripravuje_se', 'bezi', 'hotova', 'zrusena')),

  zalozil       uuid references public.employees(id) on delete set null,
  vytvoreno_kdy timestamptz not null default now(),
  zmeneno_kdy   timestamptz not null default now()
);

create index marketing_kampane_pobocka
  on public.marketing_kampane (tenant_id, branch_id, kona_se_kdy desc);

alter table public.marketing_kampane enable row level security;

create policy marketing_kampane_select on public.marketing_kampane for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_kampane_write on public.marketing_kampane for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_kampane to authenticated;

drop trigger if exists trg_audit_marketing_kampane on public.marketing_kampane;
create trigger trg_audit_marketing_kampane
  after insert or update or delete on public.marketing_kampane
  for each row execute function app.audit_zmenu('marketing_kampan');


-- ---------------------------------------------------------------------
-- PŘÍSPĚVEK PATŘÍ KE KAMPANI
--
-- `marketing_prispevky` má celotabulkový grant (viz
-- 20260909200000_marketing_obsah.sql, ř. 114), takže nový sloupec
-- žádný `grant select (…)` nepotřebuje. U `employees` a `branches` by
-- to bylo jinak — tam jsou granty po sloupcích a zapomenutý grant
-- položí celou obrazovku chybou 42501.
-- ---------------------------------------------------------------------

alter table public.marketing_prispevky
  add column kampan_id uuid references public.marketing_kampane(id) on delete set null;

create index marketing_prispevky_kampan
  on public.marketing_prispevky (kampan_id) where kampan_id is not null;

comment on column public.marketing_prispevky.kampan_id is
  'Ke které kampani příspěvek patří. `on delete set null` schválně: '
  'smazání kampaně nesmí smazat zveřejněné příspěvky — ty už jsou venku.';


-- ---------------------------------------------------------------------
-- AUTOMATIZACE
--
-- Opakovaná výroba KONCEPTŮ. Ne zveřejňování — viz hlavička.
-- ---------------------------------------------------------------------

create table public.marketing_automatizace (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,

  nazev         text not null check (btrim(nazev) <> ''),
  druh          text not null check (druh in
                  ('denni_menu', 'vikendove_menu', 'evergreen')),

  /*
    KDY SE PUŠTÍ.

    Hodina na zdi (`08:30`), ne okamžik — pravidlo 11 z CLAUDE.md.
    Pásmo dodá pobočka a převod dělá `app.marketing_okamzik`, protože
    jen databáze zná pravidla letního času pro to konkrétní datum.

    `dny_v_tydnu` je pole 1–7 (pondělí = 1, jako `isodow`). Prázdné
    znamená „každý den" — ne „nikdy". Kdyby prázdné znamenalo nikdy,
    vypadala by zapnutá automatizace, která nic nedělá, jako porucha.
  */
  cas_spusteni  time not null default '08:00',
  dny_v_tydnu   smallint[] not null default array[]::smallint[]
                  check (dny_v_tydnu <@ array[1,2,3,4,5,6,7]::smallint[]),

  /*
    O KOLIK DNÍ DOPŘEDU se koncept vyrobí. Denní menu se připravuje
    ráno na týž den (0), víkendová propagace ve čtvrtek na sobotu (2).
  */
  predstih_dnu  smallint not null default 0 check (predstih_dnu between 0 and 30),

  kanaly        text[] not null default array[]::text[],
  sablona_id    uuid references public.marketing_sablony(id) on delete set null,

  /*
    VYPÍNAČ. Zadání, oddíl 15. `false` znamená, že se nespustí —
    a řádek zůstane, včetně historie. Smazání by historii vzalo
    s sebou a nedalo by se zjistit, co ta automatizace kdy udělala.
  */
  zapnuta       boolean not null default false,

  -- Vlastník. Kdo ji zapnul, ten za ni odpovídá.
  vlastnik      uuid references public.employees(id) on delete set null,

  posledni_beh_kdy timestamptz,
  pristi_beh_kdy   timestamptz,

  vytvoreno_kdy timestamptz not null default now(),
  zmeneno_kdy   timestamptz not null default now()
);

create index marketing_automatizace_pobocka
  on public.marketing_automatizace (tenant_id, branch_id);

/*
  Index na to, co se vybírá při každém běhu úlohy: zapnuté, kterým
  nastal čas. Částečný, aby vypnuté nezabíraly místo.
*/
create index marketing_automatizace_na_rade
  on public.marketing_automatizace (pristi_beh_kdy)
  where zapnuta;

alter table public.marketing_automatizace enable row level security;

create policy marketing_automatizace_select on public.marketing_automatizace for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

/*
  ZAPÍNÁ JEN `marketing.publish`, NE `manage`.

  Připravit příspěvek smí `manage`. Zapnout něco, co bude samo od sebe
  každý den vyrábět obsah, je rozhodnutí toho druhu jako poslat
  příspěvek ven — proto totéž právo.
*/
create policy marketing_automatizace_write on public.marketing_automatizace for all to authenticated
  using (app.has_access(tenant_id, 'marketing.publish', branch_id))
  with check (app.has_access(tenant_id, 'marketing.publish', branch_id));

grant select, insert, update, delete on public.marketing_automatizace to authenticated;

drop trigger if exists trg_audit_marketing_automatizace on public.marketing_automatizace;
create trigger trg_audit_marketing_automatizace
  after insert or update or delete on public.marketing_automatizace
  for each row execute function app.audit_zmenu('marketing_automatizace');


-- ---------------------------------------------------------------------
-- HISTORIE BĚHŮ
--
-- Zadání, oddíl 15: „historie výsledků". Vlastní tabulka, ne sloupec
-- `posledni_vysledek` — jinak by se nedalo zjistit, co automatizace
-- dělala minulý týden.
-- ---------------------------------------------------------------------

create table public.marketing_automatizace_behy (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  automatizace_id uuid not null references public.marketing_automatizace(id) on delete cascade,

  bezelo_kdy      timestamptz not null default now(),
  vysledek        text not null check (vysledek in ('hotovo', 'preskoceno', 'chyba')),

  /*
    `preskoceno` je třetí možnost vedle `hotovo` a `chyba` ze stejného
    důvodu jako `rucne` u publikace: „dneska nebylo z čeho vyrobit
    koncept" není porucha. Kdyby spadlo pod chybu, svítilo by to
    červeně a někdo by to šel opravovat.
  */
  zalozeno_konceptu smallint not null default 0,
  duvod           text not null default '',

  -- Co vzniklo. Pole schválně: jeden běh může založit víc konceptů.
  prispevky       uuid[] not null default array[]::uuid[]
);

create index marketing_automatizace_behy_historie
  on public.marketing_automatizace_behy (automatizace_id, bezelo_kdy desc);

alter table public.marketing_automatizace_behy enable row level security;

/*
  ROZSAH SE BERE Z RODIČE, NE Z KOPIE SLOUPCE.

  `branch_id` se sem schválně nekopíruje: dvě kopie téhož údaje se
  rozejdou. Politika se ptá rodiče — a `security definer` funkci na to
  psát netřeba, protože `marketing_automatizace` je běžná tabulka
  a `exists` nad ní projde přes její vlastní politiku.
*/
create policy marketing_automatizace_behy_select on public.marketing_automatizace_behy for select to authenticated
  using (exists (
    select 1 from public.marketing_automatizace a
     where a.id = marketing_automatizace_behy.automatizace_id
       and a.tenant_id = marketing_automatizace_behy.tenant_id));

/*
  ZÁPIS JEN SERVISNÍM KLÍČEM.

  Běhy zapisuje úloha na serveru, ne člověk v prohlížeči. Kdyby je směl
  psát `authenticated`, dala by se historie dopsat zpětně — a historie,
  do které může kdokoli psát, není doklad o ničem.

  `service_role` obchází RLS, takže mu žádná politika netřeba; tady se
  zápis prostě nepovoluje nikomu jinému.
*/
grant select on public.marketing_automatizace_behy to authenticated;

drop trigger if exists trg_audit_marketing_automatizace_behy on public.marketing_automatizace_behy;
create trigger trg_audit_marketing_automatizace_behy
  after insert or update or delete on public.marketing_automatizace_behy
  for each row execute function app.audit_zmenu('marketing_automatizace_beh');


-- ---------------------------------------------------------------------
-- JEDEN BĚH NA DEN
--
-- Ochrana před duplicitní výrobou (zadání, oddíl 15). Když se úloha
-- pustí dvakrát — protože se restartoval server nebo někdo klikl na
-- „spustit teď" —, nesmí vzniknout dvojí koncepty.
--
-- Hlídá se to na PROVOZNÍM dni pobočky, ne na kalendářním: automatizace
-- puštěná v 00:30 patří ještě k předchozímu dni (CLAUDE.md, pravidlo 10).
--
-- ---------------------------------------------------------------------
-- PROVOZNÍ DEN JE SLOUPEC, NE VÝRAZ V INDEXU
--
-- Napsal jsem to nejdřív jako výraz nad `app.business_date(…)` a uvnitř
-- poddotaz na pobočku automatizace. NEJDE TO: index nesmí obsahovat
-- poddotaz a jeho výraz musí být `immutable`. `app.business_date` je
-- `stable` — čte pásmo pobočky z tabulky —, takže by to Postgres
-- odmítl i bez toho poddotazu.
--
-- Den se proto ukládá jako sloupec a doplňuje ho spoušť, ne aplikace.
-- Kdyby ho posílal volající, dal by se poslat jiný a jedinečnost by
-- se dala obejít jednou hodnotou navíc v požadavku.
-- ---------------------------------------------------------------------

alter table public.marketing_automatizace_behy
  add column provozni_den date;

create or replace function app.marketing_beh_provozni_den()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch uuid;
begin
  /*
    Pobočka se bere Z AUTOMATIZACE, ne z řádku. Uvnitř `security
    definer` se RLS neuplatní (skill `migrace`, oddíl 5), takže se
    firma porovnává ručně — jinak by se dal podstrčit cizí rodič
    a provozní den by se počítal podle pásma jiné firmy.
  */
  select a.branch_id into v_branch
    from public.marketing_automatizace a
   where a.id = new.automatizace_id
     and a.tenant_id = new.tenant_id;

  if v_branch is null then
    raise exception 'Běh ukazuje na automatizaci, která k té firmě nepatří.'
      using errcode = 'foreign_key_violation';
  end if;

  new.provozni_den := app.business_date(v_branch, new.bezelo_kdy);
  return new;
end $$;

revoke all on function app.marketing_beh_provozni_den() from public, anon, authenticated;

drop trigger if exists trg_marketing_beh_provozni_den on public.marketing_automatizace_behy;
create trigger trg_marketing_beh_provozni_den
  before insert or update of bezelo_kdy, automatizace_id
  on public.marketing_automatizace_behy
  for each row execute function app.marketing_beh_provozni_den();

/*
  JEN ÚSPĚŠNÉ BĚHY. Přeskočený běh („dneska nebylo z čeho") ani
  neúspěšný jedinečnost nedrží — po chybě se to MÁ dát zkusit znovu.
*/
create unique index marketing_automatizace_jeden_denne
  on public.marketing_automatizace_behy (automatizace_id, provozni_den)
  where vysledek = 'hotovo';


-- ---------------------------------------------------------------------
-- KOLIK JE V PÁSMU POBOČKY
--
-- Potřebuje to výpočet příštího běhu: „dnes je pondělí a je 6:00, běh
-- má být v 8:00" se musí ptát pobočky, ne serveru. Server je na
-- Vercelu v UTC, takže `new Date()` by v létě po 22:00 tvrdil, že je
-- zítra — a automatizace by se naplánovala o den vedle.
--
-- Vrací DEN a HODINU NA ZDI zvlášť, ne okamžik. Aplikace z nich
-- spočítá, který den je na řadě, a výsledek pošle zpátky přes
-- `public.marketing_okamzik`, kde se převede na okamžik. Rozdělení je
-- schválně: kdyby funkce vracela okamžik, musela by v sobě mít
-- i pravidlo „který den je na řadě" — a to pravidlo se dá ověřit
-- Nodem (`scripts/marketing-kampane.test.mjs`), zatímco v SQL by se
-- na ně sahalo hůř.
--
-- `security definer` ze stejného důvodu jako u `marketing_okamzik`:
-- čte pásmo pobočky, na které volající nemusí mít přímo vidět. Proto
-- si členství ověřuje sama — uvnitř se RLS neuplatní (skill `migrace`,
-- oddíl 5).
-- ---------------------------------------------------------------------

create or replace function public.marketing_ted_v_pasmu(p_branch uuid)
returns table (den date, cas text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_zona   text;
  v_tenant uuid;
begin
  select b.tenant_id,
         coalesce(b.timezone, t.timezone, 'Europe/Prague')
    into v_tenant, v_zona
    from public.branches b
    join public.tenants t on t.id = b.tenant_id
   where b.id = p_branch;

  if v_tenant is null or not app.is_member(v_tenant) then
    return;
  end if;

  return query
    select (now() at time zone v_zona)::date,
           to_char(now() at time zone v_zona, 'HH24:MI');
end $$;

comment on function public.marketing_ted_v_pasmu(uuid) is
  'Dnešní datum a hodina na zdi v pásmu pobočky. Nikdy nepočítat '
  'dnešek v kódu aplikace — server běží v UTC (CLAUDE.md, pravidlo 11).';

revoke all on function public.marketing_ted_v_pasmu(uuid) from public, anon;
grant execute on function public.marketing_ted_v_pasmu(uuid) to authenticated;
