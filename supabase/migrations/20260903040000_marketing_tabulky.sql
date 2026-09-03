-- =====================================================================
-- Foodtab — nový modul Marketing, první krok
--
-- Zadání: docs/marketing-zadani.md, oddíly 4, 7 a 8 (schváleno Šéfíkem
-- 3. 9. 2026). Modul `marketing` a jeho tři oprávnění (marketing.read,
-- marketing.manage, marketing.publish) UŽ EXISTUJÍ od úplného začátku
-- v supabase/migrations/20260823120100_catalog.sql — tahle migrace jim
-- nezakládá nic nového, jen staví pět tabulek, do kterých budou psát.
--
-- Přesně jako u Tvorby menu (20260830220000_modul_menu.sql): tohle je
-- dílna, ne hotová funkce. Vzniká jen pevné místo, na které se dá
-- stavět dál — obrazovka i skutečné navrhování/publikování jsou
-- samostatné, pozdější kroky.
--
-- ---------------------------------------------------------------------
-- PĚT TABULEK, NE ŠEST
--
-- Zadání v oddíle 4 navrhovalo `marketing_photo_sources` jako vlastní
-- tabulku a v oddíle 8.3 k tomu navíc `marketing_integrations`. Obojí
-- ale řeší totéž (odkud firma bere fotky), jen jednou úžeji a podruhé
-- obecně pro všechny kategorie (zdroj menu, fotky, sociální síť).
-- Dvě tabulky o téže věci by se mohly časem rozejít — a přesně tomu
-- má `marketing_integrations` sloužit (oddíl 8.2: "kategorie integrace,
-- ne konkrétní nástroj"). `marketing_photo_sources` se proto NEZAKLÁDÁ;
-- `marketing_integrations` dělá její práci obecněji.
--
-- Vzhled/branding a vykreslení grafiky NEJSOU kategorie v
-- `marketing_integrations` — podle oddílu 8.2 jde buď o data firmy
-- zadaná přímo v appce (branding → marketing_settings), nebo o
-- Foodtabovu vlastní infrastrukturu, kterou zákazník nevidí a nevybírá
-- (vykreslení grafiky, AI text — zatím žádná tabulka, řeší to budoucí
-- API krok podle oddílu 5).
--
-- ---------------------------------------------------------------------
-- ROZSAH: FIRMA, NEBO POBOČKA?
--
-- Branding a šablony jsou firemní (jeden vzhled napříč pobočkami) —
-- marketing_settings a marketing_templates proto nemají branch_id.
-- Fotky, zdroje a příspěvky se ale liší pobočka od pobočky (jiný
-- interiér, jiný denní lístek, časem i jiný Instagram účet) — ty tři
-- branch_id mají a řídí se rozsahem členství stejně jako zálohy nebo
-- směny (app.can_read_scoped / app.has_access s p_branch).
--
-- ---------------------------------------------------------------------
-- ŽÁDNÉ TVRDÉ MAZÁNÍ
--
-- Integrace, fotky a šablony se vypínají příznakem `aktivni`, ne mažou —
-- stejný důvod jako pravidlo 9 u lidí: smazaný řádek je díra v tom, proč
-- byl kdysi vybraný právě tenhle konektor nebo tahle fotka. Příspěvky se
-- nemažou vůbec, ani měkce — jsou to hotové rozhodnutí (schváleno/
-- zamítnuto/publikováno) a jejich historie je přesně to, co bod 3
-- zadání Tvorby menu žádá dohledat i o měsíc později.
-- =====================================================================


-- ---------------------------------------------------------------------
-- MARKETING_SETTINGS — branding a tón hlasu firmy (bod 3 zadání)
--
-- Jeden řádek na firmu. Nepřítomnost řádku znamená "firma zatím nic
-- nezadala" — obrazovka i budoucí agent to tak musí číst (agent si
-- branding nedomýšlí, viz zadání bod 3, poslední odstavec).
-- ---------------------------------------------------------------------

create table public.marketing_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,

  ton_hlasu            text not null default 'neformalni'
                        check (ton_hlasu in ('formalni', 'neformalni')),
  pouzivat_emoji       boolean not null default true,

  -- Brand barvy/font/logo se dosazují do šablon za běhu (oddíl 1a) —
  -- šablony samotné jsou brand-agnostic.
  brand_barva_hlavni   text,
  brand_barva_vedlejsi text,
  brand_font           text,
  logo_url             text,

  -- Kdy se má denně zveřejňovat. Jen výchozí čas pro návrh; konkrétní
  -- den se dá vždy odložit či předsunout ručně při schvalování.
  vychozi_cas_zverejneni time,

  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(user_id) on delete set null
);

comment on table public.marketing_settings is
  'Branding a tón hlasu firmy pro modul Marketing. Chybějící řádek '
  'znamená, že firma zatím nic nezadala — agent si to nesmí domýšlet.';

grant select (
  tenant_id, ton_hlasu, pouzivat_emoji, brand_barva_hlavni,
  brand_barva_vedlejsi, brand_font, logo_url, vychozi_cas_zverejneni,
  updated_at, updated_by
) on public.marketing_settings to authenticated;
grant insert (
  tenant_id, ton_hlasu, pouzivat_emoji, brand_barva_hlavni,
  brand_barva_vedlejsi, brand_font, logo_url, vychozi_cas_zverejneni,
  updated_by
) on public.marketing_settings to authenticated;
grant update (
  ton_hlasu, pouzivat_emoji, brand_barva_hlavni, brand_barva_vedlejsi,
  brand_font, logo_url, vychozi_cas_zverejneni, updated_at, updated_by
) on public.marketing_settings to authenticated;

alter table public.marketing_settings enable row level security;

drop policy if exists marketing_settings_select on public.marketing_settings;
create policy marketing_settings_select on public.marketing_settings for select to authenticated
  using (
    app.has_access(tenant_id, 'marketing.read', null)
    or app.has_access(tenant_id, 'marketing.manage', null)
  );

drop policy if exists marketing_settings_write on public.marketing_settings;
create policy marketing_settings_write on public.marketing_settings for insert to authenticated
  with check (app.has_access(tenant_id, 'marketing.manage', null));

drop policy if exists marketing_settings_update on public.marketing_settings;
create policy marketing_settings_update on public.marketing_settings for update to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', null))
  with check (app.has_access(tenant_id, 'marketing.manage', null));

drop trigger if exists trg_audit_marketing_settings on public.marketing_settings;
create trigger trg_audit_marketing_settings
  after insert or update or delete on public.marketing_settings
  for each row execute function app.audit_zmenu('marketing_settings');


-- ---------------------------------------------------------------------
-- MARKETING_INTEGRATIONS — zaměnitelné konektory (oddíl 8.2, 8.3)
--
-- Řádek = firma (+ volitelně pobočka) + kategorie + zvolený konektor.
-- Kód se ptá přes jedno rozhraní ("dej mi fotku ze zdroje firmy X"),
-- nikdy natvrdo na "OneDrive" nebo "Canva" — přidání nového konektoru
-- znamená nový adaptér v kódu, ne novou tabulku ani novou migraci.
--
-- `pristupovy_otisk` je HASH, nikdy čitelný token (pravidlo 7). Skutečné
-- OAuth tokeny/klíče bydlí mimo tuhle tabulku (např. u dodavatele
-- integrace nebo v samostatném trezoru) — sem patří jen otisk pro
-- ověření, že se nic nezaměnilo.
-- ---------------------------------------------------------------------

create table public.marketing_integrations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- NULL = platí pro celou firmu. Vyplněné = jen tahle pobočka
  -- (např. každá pobočka má svůj vlastní Instagram účet).
  branch_id         uuid references public.branches(id) on delete cascade,

  kategorie         text not null
                     check (kategorie in ('zdroj_menu', 'fotky', 'socialni_site')),
  -- 'nativni' je vestavěný Foodtab výchozí způsob a funguje vždy bez
  -- nastavování (oddíl 8.2) — proto je to i výchozí hodnota sloupce.
  typ_konektoru     text not null default 'nativni',
  nazev             text not null default '',

  pristupovy_otisk  text,
  pripojeno_kdy     timestamptz,
  pripojil          uuid references public.profiles(user_id) on delete set null,

  aktivni           boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.marketing_integrations is
  'Který konektor firma zvolila pro danou kategorii (zdroj menu, fotky, '
  'sociální síť). "nativni" funguje pro každého bez nastavování; jiné '
  'hodnoty si zákazník zapíná sám, když už daný nástroj používá.';

comment on column public.marketing_integrations.pristupovy_otisk is
  'Otisk (hash), nikdy čitelný přístupový token — pravidlo 7.';

-- Nejvýš jedna AKTIVNÍ integrace na kategorii a rozsah. Prázdná pobočka
-- (NULL) se řeší přes pevnou náhradní hodnotu, protože NULL <> NULL by
-- jinak dovolil libovolně moc firemních řádků téže kategorie.
create unique index if not exists marketing_integrations_jedna_aktivni
  on public.marketing_integrations (
    tenant_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kategorie
  )
  where aktivni;

grant select (
  id, tenant_id, branch_id, kategorie, typ_konektoru, nazev,
  pripojeno_kdy, pripojil, aktivni, created_at
) on public.marketing_integrations to authenticated;
grant insert (
  tenant_id, branch_id, kategorie, typ_konektoru, nazev,
  pristupovy_otisk, pripojeno_kdy, pripojil, aktivni
) on public.marketing_integrations to authenticated;
grant update (
  typ_konektoru, nazev, pristupovy_otisk, pripojeno_kdy, pripojil, aktivni
) on public.marketing_integrations to authenticated;

alter table public.marketing_integrations enable row level security;

drop policy if exists marketing_integrations_select on public.marketing_integrations;
create policy marketing_integrations_select on public.marketing_integrations for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'marketing.read', branch_id)
    or app.can_read_scoped(tenant_id, 'marketing.manage', branch_id)
  );

drop policy if exists marketing_integrations_insert on public.marketing_integrations;
create policy marketing_integrations_insert on public.marketing_integrations for insert to authenticated
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

drop policy if exists marketing_integrations_update on public.marketing_integrations;
create policy marketing_integrations_update on public.marketing_integrations for update to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

drop trigger if exists trg_audit_marketing_integrations on public.marketing_integrations;
create trigger trg_audit_marketing_integrations
  after insert or update or delete on public.marketing_integrations
  for each row execute function app.audit_zmenu('marketing_integration');


-- ---------------------------------------------------------------------
-- MARKETING_PHOTOS — trvalá fotobanka pobočky
--
-- Poučení z Černé Perly (oddíl 2): dočasný odkaz z fotoschránky vypršel
-- dřív, než přišlo schválení. Proto se sem fotka zapisuje s trvalou URL
-- v okamžiku, kdy se přijme ze zdroje — ne s odkazem na cizí úložiště.
-- ---------------------------------------------------------------------

create table public.marketing_photos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  branch_id      uuid not null references public.branches(id) on delete cascade,

  url            text not null,
  -- Volitelný AI popisek (interiér/terasa/jídlo X…), aby korekční agent
  -- uměl vyhledat "jinou fotku interiéru" (poučení z Černé Perly).
  ai_popisek     text,

  zdroj_integrace uuid references public.marketing_integrations(id) on delete set null,
  nahrano_kdy    timestamptz not null default now(),
  nahral         uuid references public.profiles(user_id) on delete set null,

  aktivni        boolean not null default true
);

create index if not exists marketing_photos_pobocka
  on public.marketing_photos (branch_id, aktivni);

comment on table public.marketing_photos is
  'Trvalá fotobanka pobočky. Fotky se sem kopírují hned při příjmu ze '
  'zdroje — nikdy se nepracuje s dočasným odkazem cizí schránky.';

grant select (
  id, tenant_id, branch_id, url, ai_popisek, zdroj_integrace,
  nahrano_kdy, nahral, aktivni
) on public.marketing_photos to authenticated;
grant insert (
  tenant_id, branch_id, url, ai_popisek, zdroj_integrace, nahrano_kdy, nahral
) on public.marketing_photos to authenticated;
grant update (ai_popisek, aktivni) on public.marketing_photos to authenticated;

alter table public.marketing_photos enable row level security;

drop policy if exists marketing_photos_select on public.marketing_photos;
create policy marketing_photos_select on public.marketing_photos for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'marketing.read', branch_id)
    or app.can_read_scoped(tenant_id, 'marketing.manage', branch_id)
  );

drop policy if exists marketing_photos_insert on public.marketing_photos;
create policy marketing_photos_insert on public.marketing_photos for insert to authenticated
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

drop policy if exists marketing_photos_update on public.marketing_photos;
create policy marketing_photos_update on public.marketing_photos for update to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

drop trigger if exists trg_audit_marketing_photos on public.marketing_photos;
create trigger trg_audit_marketing_photos
  after insert or update or delete on public.marketing_photos
  for each row execute function app.audit_zmenu('marketing_photo');


-- ---------------------------------------------------------------------
-- MARKETING_TEMPLATES — grafické šablony firmy (oddíl 1a)
--
-- Firemní, ne pobočkové — branding je jeden napříč pobočkami. Šablony
-- jsou brand-agnostic (barva/font/logo se dosazují za běhu z
-- marketing_settings), takže nová pobočka nepotřebuje žádnou vlastní.
--
-- `externi_sablona_id` je referencí do vykreslovacího enginu (dnes
-- Bannerbear), který zůstává mimo appku (oddíl 5) — appka vlastní jen
-- to, KTERÁ šablona existuje a jak se jmenuje, ne jak vypadá uvnitř.
-- ---------------------------------------------------------------------

create table public.marketing_templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,

  nazev             text not null,
  popis             text not null default '',
  externi_sablona_id text,

  aktivni           boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.marketing_templates is
  'Sada grafických šablon firmy. Brand-agnostic — barvy/font/logo se '
  'dosazují za běhu z marketing_settings, šablona sama je nekreslí.';

grant select (
  id, tenant_id, nazev, popis, externi_sablona_id, aktivni, created_at
) on public.marketing_templates to authenticated;
grant insert (
  tenant_id, nazev, popis, externi_sablona_id, aktivni
) on public.marketing_templates to authenticated;
grant update (
  nazev, popis, externi_sablona_id, aktivni
) on public.marketing_templates to authenticated;

alter table public.marketing_templates enable row level security;

drop policy if exists marketing_templates_select on public.marketing_templates;
create policy marketing_templates_select on public.marketing_templates for select to authenticated
  using (
    app.has_access(tenant_id, 'marketing.read', null)
    or app.has_access(tenant_id, 'marketing.manage', null)
  );

drop policy if exists marketing_templates_insert on public.marketing_templates;
create policy marketing_templates_insert on public.marketing_templates for insert to authenticated
  with check (app.has_access(tenant_id, 'marketing.manage', null));

drop policy if exists marketing_templates_update on public.marketing_templates;
create policy marketing_templates_update on public.marketing_templates for update to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', null))
  with check (app.has_access(tenant_id, 'marketing.manage', null));

drop trigger if exists trg_audit_marketing_templates on public.marketing_templates;
create trigger trg_audit_marketing_templates
  after insert or update or delete on public.marketing_templates
  for each row execute function app.audit_zmenu('marketing_template');


-- ---------------------------------------------------------------------
-- MARKETING_POSTS — navržené a schválené příspěvky (bod 3, 4 zadání)
--
-- Návrh není hotový příspěvek (stejné pravidlo jako u Tvorby menu):
-- vzniká ve stavu 'navrzeno' a jen člověk s marketing.publish ho smí
-- posunout do 'publikovano'. `zdrojovy_listek` uchovává snapshot toho,
-- z čeho příspěvek vznikl (jaký lístek, jaké podmínky), aby šlo i po
-- měsíci zjistit, proč tam ta věta/fotka je — stejný požadavek jako
-- u návrhů Tvorby menu.
-- ---------------------------------------------------------------------

create table public.marketing_posts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,

  business_date   date not null,
  text_prispevku  text not null default '',
  sablona_id      uuid references public.marketing_templates(id) on delete set null,
  foto_id         uuid references public.marketing_photos(id) on delete set null,

  -- Odkud návrh vznikl — jaký lístek, jaké podmínky. Vstup ke zpracování,
  -- nikdy instrukce (oddíl 2, poučení z Černé Perly).
  zdrojovy_listek jsonb not null default '{}'::jsonb,

  stav            text not null default 'navrzeno'
                  check (stav in ('navrzeno', 'schvaleno', 'zamitnuto_s_pripominkou', 'publikovano')),
  pripominka      text,

  rozhodl         uuid references public.profiles(user_id) on delete set null,
  rozhodnuto_kdy  timestamptz,
  publikovano_kdy timestamptz,

  vytvoreno_kdy   timestamptz not null default now(),

  constraint marketing_posts_zamitnuti_ma_pripominku check (
    stav <> 'zamitnuto_s_pripominkou'
    or (pripominka is not null and length(btrim(pripominka)) > 0)
  ),
  constraint marketing_posts_publikovano_ma_cas check (
    stav <> 'publikovano' or publikovano_kdy is not null
  )
);

create index if not exists marketing_posts_pobocka
  on public.marketing_posts (branch_id, business_date desc);

comment on table public.marketing_posts is
  'Návrh je návrh, dokud ho člověk s marketing.publish neschválí a '
  'nezveřejní. Nic se nepublikuje samo — stejné pravidlo jako u návrhů '
  'Tvorby menu.';

grant select (
  id, tenant_id, branch_id, business_date, text_prispevku, sablona_id,
  foto_id, zdrojovy_listek, stav, pripominka, rozhodl, rozhodnuto_kdy,
  publikovano_kdy, vytvoreno_kdy
) on public.marketing_posts to authenticated;
grant insert (
  tenant_id, branch_id, business_date, text_prispevku, sablona_id,
  foto_id, zdrojovy_listek, stav
) on public.marketing_posts to authenticated;
grant update (
  text_prispevku, sablona_id, foto_id, stav, pripominka, rozhodl,
  rozhodnuto_kdy, publikovano_kdy
) on public.marketing_posts to authenticated;

alter table public.marketing_posts enable row level security;

drop policy if exists marketing_posts_select on public.marketing_posts;
create policy marketing_posts_select on public.marketing_posts for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'marketing.read', branch_id)
    or app.can_read_scoped(tenant_id, 'marketing.manage', branch_id)
  );

-- Založit návrh smí marketing.manage (dnes ručně, později i agent s
-- agents.manage klíčem přes API — oddíl 5, samostatný pozdější krok).
drop policy if exists marketing_posts_insert on public.marketing_posts;
create policy marketing_posts_insert on public.marketing_posts for insert to authenticated
  with check (
    app.has_access(tenant_id, 'marketing.manage', branch_id)
    and stav = 'navrzeno'
  );

drop policy if exists marketing_posts_update on public.marketing_posts;
create policy marketing_posts_update on public.marketing_posts for update to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

-- Přesně bod 4 zadání: marketing.publish je JEDINÉ oprávnění, které smí
-- posunout příspěvek do 'publikovano'. marketing.manage smí měnit text,
-- schvalovat/zamítat s připomínkou, ale ne sám zveřejnit — nevratná
-- veřejná akce potřebuje svoje vlastní, citlivé oprávnění.
create or replace function app.strez_prechod_marketing_postu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.stav = 'publikovano' and old.stav <> 'publikovano' then
    if not app.has_access(new.tenant_id, 'marketing.publish', new.branch_id) then
      raise exception 'Zveřejnit příspěvek smí jen ten, kdo má marketing.publish.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.strez_prechod_marketing_postu() is
  'Hlídá, že do stavu publikovano posune příspěvek jen marketing.publish '
  '— marketing.manage smí návrh měnit, ale ne sám zveřejnit.';

revoke all on function app.strez_prechod_marketing_postu() from public, anon, authenticated;

drop trigger if exists trg_strez_prechod_marketing_postu on public.marketing_posts;
create trigger trg_strez_prechod_marketing_postu
  before update on public.marketing_posts
  for each row execute function app.strez_prechod_marketing_postu();

drop trigger if exists trg_audit_marketing_posts on public.marketing_posts;
create trigger trg_audit_marketing_posts
  after insert or update or delete on public.marketing_posts
  for each row execute function app.audit_zmenu('marketing_post');
