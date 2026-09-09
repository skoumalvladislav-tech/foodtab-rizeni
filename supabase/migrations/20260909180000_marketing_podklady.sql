-- =====================================================================
-- Foodtab — modul Marketing, podklady: nastavení, média, šablony
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
--
-- Navazuje na 20260909160000_stary_marketing_pryc.sql, která zahodila
-- pět prázdných tabulek prvního pokusu. Tohle je první ze tří migrací
-- nového modulu:
--
--   1. podklady  — nastavení značky, média, šablony      ← tahle
--   2. obsah     — příspěvky, verze, varianty, schvalování
--   3. výstup    — render, publikační úlohy, publikace
--
-- Dělí se to schválně. Jedna migrace na celý modul by měla přes tisíc
-- řádků a nešla by přečíst ani vrátit po částech.
--
-- ---------------------------------------------------------------------
-- JMÉNA: PŘEDPONA `marketing_`, ZBYTEK ČESKY
--
-- CLAUDE.md, „Konvence": provozní moduly jsou česky a uvnitř modulu se
-- jazyky nemíchají. Předpona je tu proto, že bez ní by tabulky nesly
-- jména jako `media`, `sablony` nebo `verze` — obecná slova, o která
-- se dřív nebo později popere jiný modul.
--
-- ---------------------------------------------------------------------
-- ROZSAH: CO JE FIREMNÍ A CO POBOČKOVÉ
--
-- * Značka je FIREMNÍ s výjimkou pro pobočku. `branch_id is null`
--   znamená „platí pro celou firmu"; řádek s pobočkou ji přebíjí.
--   Důvod: Černá Perla a Bernard Bar mají jednu firmu, ale každý svůj
--   podpis a kontakt.
-- * Média jsou POBOČKOVÁ, protože interiér a talíře se liší.
--   `branch_id is null` je „sdílené firmou" (logo, ikony) a smí ho
--   založit jen ten, kdo má právo na firemní rozsah.
-- * Šablony jsou FIREMNÍ. Je to vzhled značky, ne majetek pobočky.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEZAKLÁDÁ
--
-- * Vlastní tabulka firem, poboček, lidí, rolí a oprávnění. Marketing
--   je modul Foodtabu — používá `tenants`, `branches`, `employees`
--   a `app.has_access`. (docs/marketing-je-modul.md, oddíl 5.)
-- * Sbírky médií jako vlastní tabulka. `sbirka` je text s omezením:
--   pět pevných hodnot pokrývá, co gastro potřebuje, a číselník navíc
--   by znamenal obrazovku na jeho správu, kterou nikdo nechce.
-- * Štítky médií jako vazební tabulka. `stitky text[]` stačí; hledá se
--   v nich přes GIN index.
-- =====================================================================


-- ---------------------------------------------------------------------
-- NASTAVENÍ ZNAČKY
--
-- Nepřítomnost řádku znamená „firma zatím nic nezadala". Agent si
-- značku nedomýšlí: co tu není, do návrhu nepatří.
-- ---------------------------------------------------------------------

create table public.marketing_nastaveni (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- null = firemní výchozí; vyplněné = přebíjí ho pro tu pobočku
  branch_id        uuid references public.branches(id) on delete cascade,

  ton_hlasu        text not null default 'neformalni'
                     check (ton_hlasu in ('formalni', 'neformalni', 'hrave')),
  pouzivat_emoji   boolean not null default true,

  barva_hlavni     text,
  barva_doplnkova  text,
  barva_pozadi     text,
  pismo_nadpisy    text,
  pismo_text       text,
  logo_media_id    uuid,

  -- Podpis pod příspěvkem a kontakt do patičky obrázku.
  podpis           text not null default '',
  kontakt          text not null default '',

  -- Slova, která značka používá a která ne. Jde to do zadání pro model
  -- jako pravidlo, ne jako nápověda.
  vyrazy_ano       text[] not null default array[]::text[],
  vyrazy_ne        text[] not null default array[]::text[],

  -- Výchozí délka videa v sekundách; storyboard se do ní musí vejít.
  video_sekundy    integer not null default 20 check (video_sekundy between 3 and 90),

  vytvoreno_kdy    timestamptz not null default now(),
  zmeneno_kdy      timestamptz not null default now()
);

/*
  JEDEN ŘÁDEK NA ROZSAH.

  `nulls not distinct` je tu ze stejného důvodu jako u `useky`: bez něj
  by dva firemní řádky (`branch_id is null`) prošly, protože dva NULLy
  si v SQL nejsou rovny — a jedinečnost by nehlídala právě ten
  nejčastější případ.
*/
create unique index marketing_nastaveni_rozsah
  on public.marketing_nastaveni (tenant_id, branch_id)
  nulls not distinct;

alter table public.marketing_nastaveni enable row level security;

/*
  ČTE KAŽDÝ, KDO VIDÍ MARKETING. Značka není citlivý údaj a obrazovka
  s návrhem ji potřebuje vykreslit i tomu, kdo smí jen číst.
*/
create policy marketing_nastaveni_select on public.marketing_nastaveni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_nastaveni_write on public.marketing_nastaveni for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_nastaveni to authenticated;

drop trigger if exists trg_audit_marketing_nastaveni on public.marketing_nastaveni;
create trigger trg_audit_marketing_nastaveni
  after insert or update or delete on public.marketing_nastaveni
  for each row execute function app.audit_zmenu('marketing_nastaveni');


-- ---------------------------------------------------------------------
-- MÉDIA
--
-- Knihovna fotek a videí, ze které se skládají příspěvky. Soubor sám
-- leží v Supabase Storage; tady je jen záznam o něm.
--
-- ARCHIVUJE SE, NEMAŽE (pravidlo 9 obdobně): u publikovaného příspěvku
-- musí jít i za rok dohledat, která fotka to byla.
-- ---------------------------------------------------------------------

create table public.marketing_media (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- null = sdílené celou firmou (logo, ikony)
  branch_id         uuid references public.branches(id) on delete cascade,

  druh              text not null check (druh in ('foto', 'video', 'render')),
  sbirka            text not null default 'ostatni'
                      check (sbirka in ('jidla', 'interier', 'lide', 'akce', 'ostatni')),

  nazev_souboru     text not null,
  cesta             text not null,
  mime              text not null,
  velikost_bajtu    bigint not null check (velikost_bajtu > 0),
  sirka             integer,
  vyska             integer,
  sekundy           numeric(6,2),

  -- Otisk obsahu. Podle něj se pozná, že se stejná fotka nahrává
  -- podruhé — jinak knihovna během měsíce zaroste kopiemi.
  otisk             text not null,

  popis             text not null default '',
  alt_text          text not null default '',
  stitky            text[] not null default array[]::text[],
  je_titulni        boolean not null default false,

  -- Odkud fotka je a do kdy se smí použít. Prázdné `pouzitelne_do`
  -- znamená „bez omezení"; vyplněné hlídá fronta před publikací.
  puvod             text not null default '',
  souhlas_poznamka  text not null default '',
  pouzitelne_do     date,

  nahral            uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  archivovano_kdy   timestamptz
);

/*
  STEJNÝ SOUBOR DVAKRÁT V TÉŽE POBOČCE UŽ NE.

  Znovu `nulls not distinct` — u firemně sdílených médií je `branch_id`
  NULL a bez toho by se logo dalo nahrát donekonečna.
*/
create unique index marketing_media_otisk
  on public.marketing_media (tenant_id, branch_id, otisk)
  nulls not distinct;

create index marketing_media_pobocka
  on public.marketing_media (tenant_id, branch_id, sbirka)
  where archivovano_kdy is null;

create index marketing_media_stitky
  on public.marketing_media using gin (stitky);

alter table public.marketing_media enable row level security;

create policy marketing_media_select on public.marketing_media for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_media_write on public.marketing_media for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_media to authenticated;

drop trigger if exists trg_audit_marketing_media on public.marketing_media;
create trigger trg_audit_marketing_media
  after insert or update or delete on public.marketing_media
  for each row execute function app.audit_zmenu('marketing_medium');

-- Logo v nastavení ukazuje do knihovny. Odkaz se přidává až tady,
-- protože v době vzniku `marketing_nastaveni` tabulka médií ještě
-- nebyla.
alter table public.marketing_nastaveni
  add constraint marketing_nastaveni_logo_fk
  foreign key (logo_media_id) references public.marketing_media(id) on delete set null;


-- ---------------------------------------------------------------------
-- ŠABLONY
--
-- Šablona je DATA, ne obrázek: rozvržení, pravidla pro text a osnova
-- storyboardu. Vykreslení z ní dělá aplikace, takže změna barvy značky
-- se projeví ve všech šablonách naráz a nikdo nepřekresluje grafiku.
--
-- Firemní rozsah: `branch_id` schválně není. Šablona je vzhled značky.
-- ---------------------------------------------------------------------

create table public.marketing_sablony (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,

  klic             text not null,
  nazev            text not null check (btrim(nazev) <> ''),
  popis            text not null default '',
  -- K čemu šablona je: denní menu, akce, jídlo dne, atmosféra…
  ucel             text not null,
  -- Kam patří v plánu obsahu: menu, akce, atmosféra, lidé.
  pilir            text not null default 'menu',

  rozvrzeni        jsonb not null default '{}'::jsonb,
  pravidla_textu   jsonb not null default '{}'::jsonb,
  osnova           jsonb not null default '[]'::jsonb,
  -- Výstupní formáty, které šablona umí (klíče z lib/formaty).
  formaty          text[] not null default array[]::text[],

  poradi           integer not null default 100,
  aktivni          boolean not null default true,

  vytvoreno_kdy    timestamptz not null default now(),
  zmeneno_kdy      timestamptz not null default now()
);

create unique index marketing_sablony_klic
  on public.marketing_sablony (tenant_id, klic);

create index marketing_sablony_firma
  on public.marketing_sablony (tenant_id, poradi) where aktivni;

alter table public.marketing_sablony enable row level security;

create policy marketing_sablony_select on public.marketing_sablony for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', null));

create policy marketing_sablony_write on public.marketing_sablony for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', null))
  with check (app.has_access(tenant_id, 'marketing.manage', null));

grant select, insert, update, delete on public.marketing_sablony to authenticated;

drop trigger if exists trg_audit_marketing_sablony on public.marketing_sablony;
create trigger trg_audit_marketing_sablony
  after insert or update or delete on public.marketing_sablony
  for each row execute function app.audit_zmenu('marketing_sablona');


-- ---------------------------------------------------------------------
-- ZNAČKA PRO ROZSAH
--
-- Pobočkový řádek přebíjí firemní. Funkce je tu proto, aby to pravidlo
-- bylo na JEDNOM místě — jinak si ho každá obrazovka napíše po svém
-- a jedna z nich to splete.
--
-- `security definer` schválně NENÍ: čtení má projít RLS jako každé
-- jiné. Kdo na `marketing.read` v tom rozsahu nemá, dostane prázdno.
-- ---------------------------------------------------------------------

/*
  `setof`, ne prostý složený typ.

  Funkce vracející `public.marketing_nastaveni` by u nenalezené značky
  vrátila JEDEN řádek plný NULL — a `select id from …` by dalo null,
  zatímco `count(*)` jedničku. Obrazovka by pak na „firma zatím nic
  nezadala" musela testovat sloupec, ne prázdnotu. Se `setof` je
  nepřítomnost prostě nula řádků, což je i to, co čeká `jeden()`
  v lib/supabase/dotaz.ts.
*/
create or replace function public.marketing_znacka(p_tenant uuid, p_branch uuid)
returns setof public.marketing_nastaveni
language sql stable set search_path = ''
as $$
  select n.* from public.marketing_nastaveni n
   where n.tenant_id = p_tenant
     and (n.branch_id = p_branch or n.branch_id is null)
   -- Pobočka první, firemní jako záloha.
   order by n.branch_id nulls last
   limit 1;
$$;

comment on function public.marketing_znacka(uuid, uuid) is
  'Nastavení značky pro rozsah: pobočkový řádek přebíjí firemní. '
  'Prázdný výsledek znamená „firma zatím nic nezadala" — agent si '
  'značku nedomýšlí.';

revoke all on function public.marketing_znacka(uuid, uuid) from public, anon;
grant execute on function public.marketing_znacka(uuid, uuid) to authenticated;
