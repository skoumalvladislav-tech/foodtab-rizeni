-- =====================================================================
-- Foodtab — Faktury v hlavní databázi (sloučení s „apkou faktury")
--
-- Šéfík 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
-- Návrh, pořadí kroků přepnutí a návrat zpět: docs/faktury-slouceni-navrh.md.
-- Rozhodnutí, která zbývají na Šéfíkovi: docs/hlaseni/otazky.md, 59–65.
--
-- Faktury dosud žily v odděleném Supabase projektu (ctqtwahlzhyjerqulqyn)
-- bez tenant_id a s RLS „allow all" pro veřejný klíč. Foodtab na ně
-- odkazoval jen textem (platby_faktury.faktura_id, faktury_prijem.faktura_id),
-- protože cizí klíč mezi dvěma databázemi postavit nejde. Tahle migrace
-- staví jejich místo v hlavní databázi. Data do něj přenese úloha
-- /api/prevod-faktur — spouští ji jen Šéfík (GitHub Actions, ručně).
--
-- ---------------------------------------------------------------------
-- STAV PŘEVODU ŘÍDÍ, KDO SMÍ CO (faktury_prevod, za firmu)
--
--   (žádný řádek) → zahajit → probiha → dokoncit → dokonceno
--   dokonceno → vratit → vraceno → zahajit → probiha …
--
-- * Faktury v hlavní databázi se ZAPISUJÍ jen u firmy ve stavu
--   `dokonceno` — přihlášený, příjem z e-mailu i párování. Hlídá to
--   spoušť app.faktury_brana pro všechny role, ne jen RLS (service_role
--   RLS obchází). Firma bez řádku (každá kromě vlastníka staré databáze)
--   má Faktury ZAVŘENÉ — otevřít je ostatním je otázka 61.
-- * Úloha převodu (service_role) zapisuje jen ve stavu `probiha`.
-- * Párování plateb se ve stavu `probiha` nemění vůbec (ani starou cestou).
--
-- ---------------------------------------------------------------------
-- STARÉ SLOUPCE A FUNKCE ZŮSTÁVAJÍ (návrat zpět)
--
-- Textové `faktura_id` a staré funkce párování (potvrdit_alokaci_platby,
-- zrusit_alokaci_platby, automaticky_sparovat_platbu,
-- zrusit_automaticke_parovani) se NEMĚNÍ: kdyby se appka vrátila na
-- předchozí verzi, starý kód s nimi musí fungovat. Po dokončení převodu
-- je ale spoušť app.platby_faktury_brana zavře — jinak by šlo párovat
-- s částkou, kterou dodá volající, a bez změny stavu faktury. Ve stavu
-- `vraceno` (návrat) se otevřou znovu. Uklidí je samostatná migrace po
-- zkušební době (návrh: docs/faktury-slouceni-uklid.sql) — ta nesmí do
-- main dřív, než převod proběhne, jinak by ji `db push` pustil spolu
-- s touhle a cizí klíče by spadly na ještě nepřevedených fakturách.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Faktury nemají pobočku. Čtou je a mění jen lidé s právem za CELOU
--   firmu — jako dnešní appka (pripravit(…, TENANT_SCOPE_SEGMENT)) a Finance
--   po pobočkách (otázka 48, body 4 a 7). Pobočky: otázka 60.
-- * prijemky.faktura_id je volný text, který píše člověk (číslo z papírové
--   faktury), ne id — cizí klíč by byl hádání. vybaveni.faktura_id
--   a ingredient_purchase_prices.source_invoice_id nikdo nezapisuje.
--   Zůstávají, jak jsou (otázka 63).
-- * Stav faktury je text bez výčtu. Psal ho n8n i příjem z e-mailu
--   („Nutná ruční kontrola (…)", „Duplicitní - zkontrolovat (…)") a pevný
--   výčet by převod starých dat shodil.
-- * Textová pole převzatá ze staré databáze nemají limity délky — převod
--   nesmí nic oříznout ani odmítnout.
-- =====================================================================


-- =====================================================================
-- 1. STAV PŘEVODU A KOPIE STARÉ DATABÁZE
-- =====================================================================

create table public.faktury_prevod (
  tenant_id     uuid primary key references public.tenants(id) on delete cascade,
  stav          text not null check (stav in ('probiha', 'dokonceno', 'vraceno')),
  -- Adresa projektu, odkud se převádí (host, ne klíč).
  zdroj         text not null check (char_length(zdroj) between 1 and 200),
  zahajeno_kdy  timestamptz not null default now(),
  -- dokonceno_kdy je vyplněné jen u převodu, který doběhl (zahájení ho
  -- nuluje, zrušení ho nenastaví): kopie staré databáze je základ pro
  -- návrat zpět JEN tehdy. Po zrušení je stará databáze jediná pravda.
  dokonceno_kdy timestamptz,
  vraceno_kdy   timestamptz,
  -- Návrat zpět je hotový (stará databáze má všechno z appky, úloha to
  -- ověřila novým plánem s nulou). Potom jsou rozdíly staré databáze
  -- změny staré appky: nový převod je převezme (i smazání faktury, která
  -- kdysi vznikla v appce), „zpet" už nic nepřepíše. Nové zahájení značku
  -- NECHÁ (převod podle ní pozná, co smí smazat); vynuluje ji až další vrácení.
  zpet_hotovo_kdy timestamptz,
  -- Měření staré databáze v okamžiku zahájení (spočítala úloha)
  -- a obou databází v okamžiku dokončení (spočítala databáze sama).
  mereni_zahajeni jsonb,
  mereni_dokonceni jsonb,
  -- Kopírování PDF: které soubory se nepodařilo přenést a proč
  -- ({"chyby": {"<id faktury>": "<důvod>"}}). Píše úloha.
  prilohy       jsonb not null default '{}'::jsonb,
  -- Zámek úlohy: dva běhy převodu najednou by si přepisovaly kopii.
  zamek_kdy     timestamptz,
  zmeneno_kdy   timestamptz not null default now()
);

comment on table public.faktury_prevod is
  'Stav přestěhování faktur ze staré databáze, za firmu. Faktury se zapisují '
  'jen ve stavu dokonceno; úloha převodu jen ve stavu probiha. Zapisují jen '
  'funkce převodu a úloha (service_role).';

alter table public.faktury_prevod enable row level security;

-- Stav převodu vidí, kdo vidí Faktury (brána v appce se ptá jeho klientem).
-- Politika až pod app.firmy_s_pristupem (oddíl 2).

-- Jen firma a stav: měření (součty párování plateb), texty chyb úlohy
-- a zámek přihlášený nepotřebuje — a k párováním se bez finance.read
-- dostat nemá.
revoke all on public.faktury_prevod from anon, authenticated;
grant select (tenant_id, stav) on public.faktury_prevod to authenticated;
-- Úloha smí přímo měnit jen seznam nepovedených příloh. Stav (a s ním
-- to, kdo smí zapisovat) mění jen funkce převodu níž — chyba v úloze
-- tak stav převodu přepnout nemůže.
revoke all on public.faktury_prevod from service_role;
grant select on public.faktury_prevod to service_role;
grant update (prilohy) on public.faktury_prevod to service_role;


-- Doslovná kopie řádků staré databáze (select=* z PostgRESTu, jak přišel).
-- K čemu:
--   * dokončení porovná KAŽDOU fakturu pole po poli přímo v databázi
--     (app.faktury_prevod_porovnat) — nezávisle na převodu, který psala
--     úloha v TypeScriptu;
--   * návrat zpět (režim „zpet") podle ní pozná, co se od přepnutí změnilo
--     v hlavní a co ve staré (tam nesmí nic přepsat ani smazat);
--   * je to záloha staré databáze, kterou jinak udělat nejde (otázka 45:
--     do projektu se nikdo nepřihlásí).
-- Mění se jen ve stavu `probiha`; po dokončení je to zamčený základ.

create table public.faktury_prevod_zdroj (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  tabulka     text not null check (tabulka in ('invoices', 'rejection_examples')),
  klic        text not null check (char_length(klic) between 1 and 64),
  radek       jsonb not null check (jsonb_typeof(radek) = 'object'),
  nacteno_kdy timestamptz not null default now(),
  primary key (tenant_id, tabulka, klic)
);

comment on table public.faktury_prevod_zdroj is
  'Doslovná kopie řádků staré databáze Faktur (invoices, rejection_examples) '
  'z posledního převodu. Základ pro porovnání pole po poli a pro návrat zpět. '
  'Jen úloha převodu (service_role), jen ve stavu probiha.';

alter table public.faktury_prevod_zdroj enable row level security;
-- Žádná politika: přihlášený sem nesmí (obsahuje celé faktury). Data,
-- která má vidět, má v public.faktury.

revoke all on public.faktury_prevod_zdroj from anon, authenticated;
revoke all on public.faktury_prevod_zdroj from service_role;
grant select, insert, update, delete on public.faktury_prevod_zdroj to service_role;



-- Zrušení celé firmy (kaskáda z tenants): firma už neexistuje a brány
-- níž nemají co chránit — bez téhle výjimky by smazání firmy s fakturami
-- spadlo (kaskáda maže jako vlastník tabulky, tedy „převodním" mazáním
-- mimo stav probiha). Stejná zkratka jako app.audit_zmenu. Volá se jen
-- pro mazání mimo přihlášeného (vnořené if, ne `and` — pořadí
-- vyhodnocení podmínek Postgres nezaručuje).
create function app.faktury_firma_zanikla(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.tenants t where t.id = p_tenant);
$$;

revoke all on function app.faktury_firma_zanikla(uuid) from public, anon, authenticated;
grant execute on function app.faktury_firma_zanikla(uuid) to service_role;


-- NEW při mazání a OLD při vkládání se tu ani ve spouštích níž nečtou
-- (ani ve větvi, která se nevykoná) — jsou NULL a čtení jejich polí se
-- mezi verzemi PostgreSQL chová různě.
create function app.faktury_prevod_zdroj_brana()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    if current_user not in ('authenticated', 'anon') then
      if app.faktury_firma_zanikla(v_tenant) then
        return old;
      end if;
    end if;
  else
    v_tenant := new.tenant_id;
  end if;
  if app.faktury_stav_prevodu(v_tenant) is distinct from 'probiha' then
    raise exception 'Kopie staré databáze se mění jen během převodu (stav probiha).'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function app.faktury_prevod_zdroj_brana() from public, anon, authenticated;

create trigger trg_faktury_prevod_zdroj_brana
  before insert or update or delete on public.faktury_prevod_zdroj
  for each row execute function app.faktury_prevod_zdroj_brana();


-- =====================================================================
-- 2. FIRMY, KDE MÁ PŘIHLÁŠENÝ PRÁVO (rychlá RLS)
-- =====================================================================
--
-- Faktur jsou tisíce a obrazovky je čtou najednou (Přehled ~1 900,
-- počítadla přes všechny). Politika `app.has_access(tenant_id, …)` by se
-- volala pro KAŽDÝ řádek — u tržeb to 12. 10. 2026 dělalo 3,15 s místo
-- 33 ms (memory „měřit pod přihlášeným"). `tenant_id in (select …)` se
-- spočítá jednou za dotaz.
--
-- `m.user_id = auth.uid()` jen zužuje kandidáty (firmy, kde člověk má
-- členství) — o přístupu rozhoduje has_access, které členství, jeho stav
-- a rozsah (celá firma) ověřuje samo. Není to druhá kopie filtru.

create function app.firmy_s_pristupem(p_pravo text)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct m.tenant_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and app.has_access(m.tenant_id, p_pravo, null);
$$;

comment on function app.firmy_s_pristupem(text) is
  'Firmy, kde má přihlášený právo ZA CELOU FIRMU (has_access s pobočkou null). '
  'Pro politiky typu tenant_id in (select …) — spočítá se jednou za dotaz.';

revoke all on function app.firmy_s_pristupem(text) from public, anon;
grant execute on function app.firmy_s_pristupem(text) to authenticated;

-- Stav převodu firmy. Security definer: spouště a funkce párování se ptají
-- i za přihlášeného, který tabulku celou číst nesmí.
--
-- Přihlášený (role authenticated/anon) se stav dozví JEN u firmy, kde
-- Faktury smí vidět nebo spravovat — jinak by hláška brány nebo párování
-- prozradila, jestli a v jakém stavu cizí firma Faktury stěhuje (kontrola
-- 19. 10.). Pro cizí firmu je NULL, tedy „nezahájen", stejně jako pro
-- firmu bez převodu. Úlohy a převod (service_role, bez přihlášení) vidí
-- stav všech firem. Rozhoduje GUC `role`, ne current_user: uvnitř
-- security definer je current_user vlastník funkce.
create function app.faktury_stav_prevodu(p_tenant uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select pr.stav from public.faktury_prevod pr
   where pr.tenant_id = p_tenant
     and (coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
          or pr.tenant_id in (select app.firmy_s_pristupem('faktury.read'))
          or pr.tenant_id in (select app.firmy_s_pristupem('faktury.manage')));
$$;

revoke all on function app.faktury_stav_prevodu(uuid) from public, anon;
grant execute on function app.faktury_stav_prevodu(uuid) to authenticated, service_role;

-- Stav převodu BEZ ohledu na práva volajícího — jen pro brány, které
-- rozhodují o ZÁPISU a NULL berou jako „bez převodu, stará cesta platí"
-- (spoušť párování plateb). Filtrovaná verze výš by přihlášenému bez práva
-- na Faktury vrátila NULL a staré funkce párování (stačí jim finance.manage)
-- by mu znovu otevřela starou cestu i po dokončení a během převodu
-- (kontrola 19. 10., regrese opravy výš). Filtrovaná zůstává pro hlášky
-- a čtení. Přihlášený tuhle volat nesmí: do párování nepíše přímo, jen přes
-- funkce (security definer — spoušť pak běží za jejich vlastníka).
create function app.faktury_stav_prevodu_brana(p_tenant uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select pr.stav from public.faktury_prevod pr where pr.tenant_id = p_tenant;
$$;

revoke all on function app.faktury_stav_prevodu_brana(uuid) from public, anon, authenticated;
grant execute on function app.faktury_stav_prevodu_brana(uuid) to service_role;

create policy faktury_prevod_select on public.faktury_prevod for select to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.read')));


-- =====================================================================
-- 3. FAKTURY
-- =====================================================================
--
-- Sloupce odpovídají `invoices` ze staré databáze 1:1 (lib/faktury-prevod.ts,
-- MAPA_SLOUPCU), jen česky a částka v haléřích. `id` se při převodu
-- ZACHOVÁVÁ — párování plateb a evidence příjmu na něj už odkazují.

create table public.faktury (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  prijato_kdy           timestamptz not null default now(),
  email_odesilatel      text,
  email_predmet         text,
  dodavatel             text not null default '',
  dodavatel_ico         text,
  cislo_faktury         text,
  variabilni_symbol     text,
  -- Celá částka faktury v nejmenší jednotce její měny (u CZK haléře).
  -- Záporná je přípustná (dobropis), nula znamená „AI částku nepřečetla".
  castka_haleru         integer not null default 0,
  mena                  text not null default 'CZK',
  datum_vystaveni       date,
  duzp                  date,
  splatnost             date,
  ucet_dodavatele       text,
  stav                  text not null default 'Ke kontrole úhrady',
  ke_kontrole           boolean not null default false,
  duplicita             boolean not null default false,
  archivovano           boolean not null default false,
  poznamka_kontroly     text,
  upominka_odeslana_kdy timestamptz,
  -- Úryvek textu dokladu (pro „odmítnout a zapamatovat").
  vytah_textu           text,
  -- Odkaz, jak ho zapsal n8n nebo příjem z e-mailu: veřejná adresa ve
  -- staré databázi, nebo …/api/faktury/priloha/<id evidence>. Podle
  -- druhého tvaru příjem pozná fakturu, kterou už jednou zapsal.
  odkaz_pdf             text,
  odkaz_onedrive        text,
  -- Soubor v SOUKROMÉM kbelíku faktury-prilohy — kopie ze staré databáze
  -- (<firma>/<sha256>.<přípona>, zapisuje jen úloha) nebo ruční nahrání
  -- (<firma>/rucne/<uuid>.<přípona>). Má-li ho faktura, appka ukazuje
  -- tenhle, ne odkaz_pdf.
  priloha_cesta         text,
  -- Kdy řádek naposledy přišel ze staré databáze. NULL = vznikl tady.
  -- Zapisuje jen úloha převodu (hlídá app.faktury_brana).
  prevedeno_kdy         timestamptz,
  vytvoreno_kdy         timestamptz not null default now(),
  zmeneno_kdy           timestamptz not null default now(),

  -- Cíl složených cizích klíčů (tenant_id, faktura) z párování a evidence:
  -- odkaz tak nemůže ukázat na fakturu jiné firmy — hlídá to databáze.
  constraint faktury_firma_id unique (tenant_id, id)
);

comment on table public.faktury is
  'Přijaté faktury (od dodavatelů). Do 18. 10. 2026 v odděleném projektu '
  'Faktur (invoices); převod docs/faktury-slouceni-navrh.md. Čte faktury.read, '
  'mění faktury.manage — obojí jen za celou firmu, zapisovat jde jen u firmy '
  's dokončeným převodem (faktury_prevod.stav = dokonceno).';

create index faktury_seznam on public.faktury (tenant_id, archivovano, prijato_kdy desc);
create index faktury_duzp on public.faktury (tenant_id, duzp desc);
create index faktury_splatnost on public.faktury (tenant_id, splatnost) where not archivovano;
create index faktury_stav on public.faktury (tenant_id, stav);
create index faktury_dodavatel_cislo on public.faktury (tenant_id, dodavatel, cislo_faktury);
create index faktury_ico on public.faktury (tenant_id, dodavatel_ico) where dodavatel_ico is not null;


-- ---------------------------------------------------------------------
-- Cesta přílohy: dva tvary, oba s firmou v první složce
-- ---------------------------------------------------------------------
-- <firma>/<sha256>.<přípona> — obsah adresuje sám sebe (příjem z e-mailu,
--   kopie ze staré databáze). Zapisuje JEN service_role: kdyby sem směl
--   přihlášený, mohl by předem nahrát podvrženou fakturu pod otisk
--   skutečného souboru ze starého veřejného kbelíku (otisky si spočítá
--   každý, kdo má odkazy) a úloha by „existující soubor" vzala za svůj.
-- <firma>/rucne/<uuid>.<přípona> — ruční nahrání v appce (faktury.manage).
-- Bezpečný rozbor jako app.faktury_priloha_firma: nikdy nevyhodí výjimku.

create function app.faktury_rucni_priloha_firma(p_cesta text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when p_cesta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rucne/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
    then split_part(p_cesta, '/', 1)::uuid
    else null
  end
$$;

revoke all on function app.faktury_rucni_priloha_firma(text) from public, anon;
grant execute on function app.faktury_rucni_priloha_firma(text) to authenticated, service_role;

alter table public.faktury
  add constraint faktury_priloha_firmy
  -- `is not distinct from`, ne `=`: cesta, kterou nepozná ani jeden
  -- vzor, dá NULL — a kontrola s výsledkem NULL by prošla.
  check (priloha_cesta is null
         or coalesce(app.faktury_priloha_firma(priloha_cesta), app.faktury_rucni_priloha_firma(priloha_cesta))
            is not distinct from tenant_id);


-- ---------------------------------------------------------------------
-- Spoušť: brána podle stavu převodu, neměnné sloupce, převodní značka
-- ---------------------------------------------------------------------
-- NENÍ security definer: rozhoduje podle current_user (definer by tu
-- viděl vlastníka funkce, ne přihlášeného). Stav převodu čte přes
-- app.faktury_stav_prevodu.
--
-- Kdo smí zapisovat:
--   přihlášený (authenticated)   jen ve stavu dokonceno; převodní značku nikdy;
--                                 id si nevybírá (dostane náhodné — jinak by
--                                 mohl předem obsadit id faktury, která se
--                                 teprve převádí, a převod zablokovat);
--   úloha převodu (značka / mazání)   jen ve stavu probiha;
--   úloha a funkce párování (ostatní) jen ve stavu dokonceno — kromě
--                                 kopie přílohy (jen priloha_cesta) i v probiha.

create function app.faktury_brana()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_stav     text;
  v_prevodni boolean;
  v_zmena    boolean := false;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    if current_user not in ('authenticated', 'anon') then
      if app.faktury_firma_zanikla(v_tenant) then
        return old;
      end if;
    end if;
  else
    v_tenant := new.tenant_id;
  end if;
  v_stav := app.faktury_stav_prevodu(v_tenant);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Fakturu nejde přesunout do jiné firmy ani jí změnit id.'
        using errcode = 'insufficient_privilege';
    end if;
    v_zmena := (to_jsonb(new) - 'zmeneno_kdy') is distinct from (to_jsonb(old) - 'zmeneno_kdy');
  end if;

  -- Převodní zápis = vložení se značkou, změna značky, nebo mazání úlohou.
  if tg_op = 'DELETE' then
    v_prevodni := current_user not in ('authenticated', 'anon');
  elsif tg_op = 'INSERT' then
    v_prevodni := new.prevedeno_kdy is not null;
  else
    v_prevodni := new.prevedeno_kdy is distinct from old.prevedeno_kdy;
  end if;

  -- Čas založení mění jen převod (stará databáze ho mohla mezi běhy
  -- opravit — bez výjimky by se převod zasekl na každém dalším běhu).
  if tg_op = 'UPDATE' and new.vytvoreno_kdy is distinct from old.vytvoreno_kdy
     and not (v_prevodni and current_user not in ('authenticated', 'anon')) then
    raise exception 'Čas založení faktury nejde změnit.' using errcode = 'insufficient_privilege';
  end if;

  if current_user in ('authenticated', 'anon') then
    if v_prevodni then
      raise exception 'Převodní značku faktury zapisuje jen úloha převodu.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_stav is distinct from 'dokonceno' then
      raise exception 'Faktury pro tuto firmu nejsou otevřené (stav převodu: %).', coalesce(v_stav, 'nezahájen')
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'INSERT' then
      new.id := gen_random_uuid();
    end if;
  elsif v_prevodni then
    if v_stav is distinct from 'probiha' then
      raise exception 'Převod faktur pro tuto firmu neprobíhá (stav: %) — převodní zápis odmítnut.', coalesce(v_stav, 'nezahájen')
        using errcode = 'insufficient_privilege';
    end if;
  elsif v_stav is distinct from 'dokonceno' then
    -- Během převodu smí úloha jen doplnit kopii přílohy (priloha_cesta).
    if not (v_stav = 'probiha' and tg_op = 'UPDATE'
            and (to_jsonb(new) - 'priloha_cesta' - 'zmeneno_kdy') = (to_jsonb(old) - 'priloha_cesta' - 'zmeneno_kdy')) then
      raise exception 'Faktury pro tuto firmu nejsou otevřené (stav převodu: %).', coalesce(v_stav, 'nezahájen')
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    -- Čas změny jen při skutečné změně: uložení beze změny nemá v auditu
    -- vypadat jako úprava (app.audit_zmenu píše jen změněné sloupce).
    if v_zmena then
      new.zmeneno_kdy := now();
    else
      new.zmeneno_kdy := old.zmeneno_kdy;
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.faktury_brana() from public, anon, authenticated;

create trigger trg_faktury_brana
  before insert or update or delete on public.faktury
  for each row execute function app.faktury_brana();


-- ---------------------------------------------------------------------
-- Spoušť: možná duplicita (převzato ze staré databáze, flag_duplicate_invoice)
-- ---------------------------------------------------------------------
-- Stejný dodavatel + stejné číslo faktury ve stejné firmě → řádek se
-- zapíše (nic se neztratí), ale označí se a stav dostane předponu, ať si
-- ho člověk zkontroluje. Chování staré databáze (faktury-app/supabase/
-- schema.sql), jen za firmu.
--
-- PŘEVEDENÉ ŘÁDKY SE NEOZNAČUJÍ (podle převodní značky, ne podle role):
-- přišly se svým stavem a příznakem. Jinak by převod sám přepsal stav
-- u každé druhé kopie (216 duplicit k 8. 10.).
--
-- Security definer: musí vidět i řádky, které by přihlášenému RLS
-- schovala. Proto si firmu filtruje sama (tenant_id = new.tenant_id).

create function app.faktury_oznacit_duplicitu()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.prevedeno_kdy is null
     and coalesce(new.cislo_faktury, '') <> ''
     and exists (
       select 1 from public.faktury f
        where f.tenant_id = new.tenant_id
          and f.dodavatel = new.dodavatel
          and f.cislo_faktury = new.cislo_faktury
     ) then
    new.duplicita := true;
    if new.stav not ilike 'Duplicitní%' then
      new.stav := 'Duplicitní - zkontrolovat (' || new.stav || ')';
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.faktury_oznacit_duplicitu() from public, anon, authenticated;

-- Jméno řadí spoušť ZA trg_faktury_brana (spouště téže chvíle běží podle
-- abecedy): duplicita se hledá až po tom, co brána přidělila id.
create trigger trg_faktury_oznacit_duplicitu
  before insert on public.faktury
  for each row execute function app.faktury_oznacit_duplicitu();


-- ---------------------------------------------------------------------
-- Audit. Vložení převodem se nepíše po řádcích (3 000 kopií celého řádku
-- by audit zaplavily) — převod jako celek zapisují funkce převodu.
-- ---------------------------------------------------------------------
-- Vlastní funkce, ne app.audit_zmenu: audit_log čte i správce bez práva
-- na Faktury (settings.manage), a celý řádek by mu dal text dokladu,
-- e-mail odesílatele i účet dodavatele každé zapsané a smazané faktury
-- (stejná třída chyby jako text zpráv v auditu, 20260906010000).
-- Obsahové sloupce se vynechají; u změny zůstane jen JMÉNO změněného
-- (skryte_zmeny), ať úprava z auditu nezmizí. Částka, dodavatel a stav
-- zůstávají — audit má říct, kdo změnil částku.

create function app.audit_faktury()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- Odkazy na PDF taky: u převedených faktur vedou do VEŘEJNÉHO kbelíku
  -- staré databáze — čtenář auditu bez práva na Faktury by PDF otevřel.
  v_skryt  text[] := array['vytah_textu', 'email_odesilatel', 'email_predmet', 'ucet_dodavatele',
                           'odkaz_pdf', 'odkaz_onedrive', 'vytah', 'dodavatel_odhad'];
  v_entita text := tg_argv[0];
  v_novy   jsonb;
  v_stary  jsonb;
  v_tenant uuid;
  v_pred   jsonb;
  v_po     jsonb;
  v_skryte jsonb;
begin
  if tg_op = 'DELETE' then
    v_stary := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_novy := to_jsonb(new);
  else
    v_stary := to_jsonb(old);
    v_novy := to_jsonb(new);
  end if;

  -- Rušení celé firmy (kaskáda): firma už neexistuje, audit by spadl na
  -- cizím klíči a shodil by celé rušení (jako app.audit_zmenu).
  v_tenant := (coalesce(v_novy, v_stary) ->> 'tenant_id')::uuid;
  if v_tenant is null or not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(s.key, s.value) into v_pred
      from jsonb_each(v_stary) s
     where v_novy -> s.key is distinct from s.value and s.key <> all (v_skryt);
    select jsonb_object_agg(n.key, n.value) into v_po
      from jsonb_each(v_novy) n
     where v_stary -> n.key is distinct from n.value and n.key <> all (v_skryt);
    select jsonb_agg(s.key order by s.key) into v_skryte
      from jsonb_each(v_stary) s
     where v_novy -> s.key is distinct from s.value and s.key = any (v_skryt);
    if v_pred is null and v_skryte is null then
      return null;
    end if;
    if v_skryte is not null then
      v_po := coalesce(v_po, '{}'::jsonb) || jsonb_build_object('skryte_zmeny', v_skryte);
    end if;
  elsif tg_op = 'INSERT' then
    v_po := v_novy - v_skryt;
  else
    v_pred := v_stary - v_skryt;
  end if;

  perform app.audit(v_tenant, v_entita || '.' || lower(tg_op), v_entita,
                    coalesce(v_novy, v_stary) ->> 'id', null, v_pred, v_po);
  return null;
end
$$;

revoke all on function app.audit_faktury() from public, anon, authenticated;

create trigger trg_audit_faktury_vlozeni
  after insert on public.faktury
  for each row when (new.prevedeno_kdy is null)
  execute function app.audit_faktury('faktura');

create trigger trg_audit_faktury_zmena
  after update or delete on public.faktury
  for each row execute function app.audit_faktury('faktura');


-- ---------------------------------------------------------------------
-- RLS a granty
-- ---------------------------------------------------------------------
-- O stavu převodu rozhoduje spoušť výš (pro všechny role); politiky jen
-- o tom, kdo z lidí — jeden filtr na jednom místě.

alter table public.faktury enable row level security;

create policy faktury_select on public.faktury for select to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.read')));
create policy faktury_insert on public.faktury for insert to authenticated
  with check (tenant_id in (select app.firmy_s_pristupem('faktury.manage')));
create policy faktury_update on public.faktury for update to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.manage')))
  with check (tenant_id in (select app.firmy_s_pristupem('faktury.manage')));
create policy faktury_delete on public.faktury for delete to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.manage')));

-- Nejdřív VŠE pryč (výchozí práva Supabase by anon i authenticated dala
-- samy, včetně TRUNCATE, který RLS neřídí), pak jmenovitě.
revoke all on public.faktury from anon, authenticated;
grant select, insert, delete on public.faktury to authenticated;
-- Úprava jen sloupců, které appka opravdu mění (Faktury → akce). Částku,
-- měnu ani dodavatele po založení nemění nikdo z appky — stav faktury
-- drží párování plateb a podvržená částka přes REST by ho rozbila
-- (memory „RPC bez uzavření tabulky"). zmeneno_kdy píše spoušť.
grant update (stav, poznamka_kontroly, archivovano, upominka_odeslana_kdy) on public.faktury to authenticated;
-- Úlohy: příjem z e-mailu (zápis), automatické párování (stav), převod
-- (vložení, oprava, mazání řádků, které ve staré databázi už nejsou).
revoke all on public.faktury from service_role;
grant select, insert, update, delete on public.faktury to service_role;


-- =====================================================================
-- 4. VZORY ODMÍTNUTÝCH DOKUMENTŮ (dřív rejection_examples)
-- =====================================================================
--
-- „Není faktura — odmítnout a zapamatovat" sem ukládá úryvek textu.
-- Ve staré databázi byly bez firmy („sdílené"); úryvek je ale text
-- dokladu konkrétní firmy, takže tady firmu má.

create table public.faktury_vzory_odmitnuti (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  druh            text not null check (char_length(druh) between 1 and 50),
  vytah           text not null,
  dodavatel_odhad text,
  email_predmet   text,
  -- id řádku ve staré databázi (bigint) — převod podle něj nic nezdvojí.
  puvodni_id      bigint,
  vytvoreno_kdy   timestamptz not null default now(),
  constraint faktury_vzory_puvodni unique (tenant_id, puvodni_id)
);

comment on table public.faktury_vzory_odmitnuti is
  'Úryvky dokumentů, které člověk odmítl jako „není faktura" — příklady pro AI. '
  'Do 18. 10. 2026 rejection_examples v odděleném projektu Faktur.';

alter table public.faktury_vzory_odmitnuti enable row level security;

create policy faktury_vzory_select on public.faktury_vzory_odmitnuti for select to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.read')));
-- puvodni_id plní jen převod; zapisovat jde jen u otevřených Faktur.
create policy faktury_vzory_insert on public.faktury_vzory_odmitnuti for insert to authenticated
  with check (tenant_id in (select app.firmy_s_pristupem('faktury.manage'))
              and app.faktury_stav_prevodu(tenant_id) = 'dokonceno'
              and puvodni_id is null);

revoke all on public.faktury_vzory_odmitnuti from anon, authenticated;
grant select, insert on public.faktury_vzory_odmitnuti to authenticated;
revoke all on public.faktury_vzory_odmitnuti from service_role;
grant select, insert on public.faktury_vzory_odmitnuti to service_role;

create trigger trg_audit_faktury_vzory
  after insert on public.faktury_vzory_odmitnuti
  for each row when (new.puvodni_id is null)
  execute function app.audit_faktury('faktura_vzor_odmitnuti');


-- =====================================================================
-- 5. SKUTEČNÉ CIZÍ KLÍČE: párování plateb a evidence příjmu
-- =====================================================================
--
-- `faktura uuid` vedle dosavadního textového `faktura_id`. Složený klíč
-- (tenant_id, faktura) → faktury(tenant_id, id): odkaz na fakturu cizí
-- firmy databáze odmítne sama.
--
--   * párování: bez akce (NO ACTION) — fakturu s párováním (i zrušeným)
--     nejde smazat; dřív zůstal viset text. Ne RESTRICT: ten se kontroluje
--     hned, takže by shodil i zrušení celé firmy (kaskáda smaže faktury
--     dřív než její párování); NO ACTION až na konci příkazu.
--   * evidence příjmu: ON DELETE SET NULL (faktura) — jen sloupec faktura,
--     tenant_id zůstane (bez seznamu sloupců by se vynuloval i on a spadl
--     na NOT NULL). Text faktura_id zůstává: příjem podle něj pozná, že
--     doklad už jednou zpracoval, a nezapíše odmítnutou fakturu znovu.

alter table public.platby_faktury add column faktura uuid;
alter table public.platby_faktury
  add constraint platby_faktury_faktura_fk
  foreign key (tenant_id, faktura) references public.faktury (tenant_id, id);
create index platby_faktury_faktura_uuid on public.platby_faktury (faktura) where faktura is not null;

comment on column public.platby_faktury.faktura is
  'Faktura (cizí klíč, i s firmou). Nahrazuje textové faktura_id — to zůstává '
  'do úklidu kvůli návratu na starý kód; spoušť trg_platby_faktury_odkaz je drží v souladu.';

alter table public.faktury_prijem add column faktura uuid;
alter table public.faktury_prijem
  add constraint faktury_prijem_faktura_fk
  foreign key (tenant_id, faktura) references public.faktury (tenant_id, id) on delete set null (faktura);
create index faktury_prijem_faktura_uuid on public.faktury_prijem (faktura) where faktura is not null;

comment on column public.faktury_prijem.faktura is
  'Zapsaná faktura (cizí klíč, i s firmou). Text faktura_id zůstává jako '
  'záznam evidence — i po smazání faktury.';


-- ---------------------------------------------------------------------
-- Spoušť: text faktura_id a uuid faktura v souladu
-- ---------------------------------------------------------------------
-- Nový kód píše uuid → text se doplní (starý kód po návratu ho přečte).
-- Příjem z e-mailu (i nový) a starý kód píšou text → uuid se dohledá,
-- když taková faktura TÉŽE firmy existuje; jinak zůstane prázdné.
-- Smazání faktury (set null) text nechá — viz komentář u klíče.
--
-- Security definer: hledá ve fakturách bez ohledu na RLS volajícího,
-- proto filtr na firmu řádku (jednou).

create function app.faktura_odkaz_srovnat()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_text_zmenen boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_text_zmenen := new.faktura_id is distinct from old.faktura_id;
    if v_text_zmenen and new.faktura is not distinct from old.faktura then
      -- Text se změnil, uuid ne: uuid se odvodí znovu z textu.
      new.faktura := null;
    elsif not v_text_zmenen and new.faktura is distinct from old.faktura and new.faktura is not null then
      -- Uuid se změnilo, text ne: text podle uuid.
      new.faktura_id := new.faktura::text;
    end if;
  end if;

  if new.faktura is null then
    if v_text_zmenen
       -- Jen mezery kolem (` *`, ne `\s*`): btrim níž ořízne jen mezery,
       -- tabulátor nebo konec řádku by převod na uuid shodil.
       and new.faktura_id ~* '^ *[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} *$' then
      select f.id into new.faktura
        from public.faktury f
       where f.tenant_id = new.tenant_id
         and f.id = btrim(new.faktura_id)::uuid;
    end if;
    return new;
  end if;

  if new.faktura_id is null then
    new.faktura_id := new.faktura::text;
  elsif lower(btrim(new.faktura_id)) <> new.faktura::text then
    raise exception 'faktura (%) a faktura_id (%) ukazují na různé faktury.', new.faktura, new.faktura_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.faktura_odkaz_srovnat() from public, anon, authenticated;

create trigger trg_platby_faktury_odkaz
  before insert or update of faktura_id, faktura, tenant_id on public.platby_faktury
  for each row execute function app.faktura_odkaz_srovnat();

create trigger trg_faktury_prijem_odkaz
  before insert or update of faktura_id, faktura, tenant_id on public.faktury_prijem
  for each row execute function app.faktura_odkaz_srovnat();


-- ---------------------------------------------------------------------
-- Spoušť: párování plateb podle stavu převodu
-- ---------------------------------------------------------------------
--   probiha    — párování se nemění. Kdyby se během převodu zrušilo
--                (třeba starou appkou, která ještě někde běží), převedený
--                stav faktury by mu neodpovídal. Výjimka mimo přihlášeného:
--                vynulovat uuid faktury (zahájení převodu, aby převod
--                mohl smazat fakturu, kterou mezitím smazala stará appka)
--                a potvrdil (smazání profilu, ON DELETE SET NULL).
--   dokonceno  — jen nová cesta: vložení s uuid faktury (stará vkládá jen
--                text), změna stavu párování a přepojení potvrzeného
--                párování (jiná faktura, jiná částka) jen z nových funkcí —
--                ty mají foodtab.faktury_cesta = 'nova' jako vlastnost
--                funkce (platí jen po dobu jejich běhu). Stará cesta by
--                párovala s částkou, kterou dodá volající, a stav faktury
--                by nepřepočítala. Značka je rozlišení cesty v kódu, ne
--                zámek: přihlášený ji nastavit neumí (PostgREST set_config
--                nevystaví) a přímý zápis do tabulky stejně nemá.
--   vraceno, bez řádku — stará cesta funguje (návrat zpět).
-- Jméno řadí spoušť PŘED trg_platby_faktury_odkaz: musí vidět, jestli
-- vkládající uuid dodal sám, dřív než ho spoušť odkazu dohledá z textu.

create function app.platby_faktury_brana()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Nefiltrovaný stav: o zápisu rozhoduje stav firmy, ne to, co smí
  -- volající vidět (app.faktury_stav_prevodu_brana výš).
  v_stav text := app.faktury_stav_prevodu_brana(new.tenant_id);
begin
  if v_stav = 'probiha' then
    if tg_op = 'UPDATE' and current_user not in ('authenticated', 'anon') then
      if (to_jsonb(new) - 'faktura' - 'potvrdil') = (to_jsonb(old) - 'faktura' - 'potvrdil')
         and (new.faktura is null or new.faktura is not distinct from old.faktura)
         and (new.potvrdil is null or new.potvrdil is not distinct from old.potvrdil) then
        return new;
      end if;
    end if;
    raise exception 'Během stěhování faktur se párování plateb nemění.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_stav = 'dokonceno' then
    if tg_op = 'INSERT' and new.faktura is null then
      raise exception 'Po přestěhování faktur se páruje jen novou cestou (sparovat_platbu_s_fakturou).'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and coalesce(current_setting('foodtab.faktury_cesta', true), '') <> 'nova' then
      if new.stav is distinct from old.stav then
        raise exception 'Po přestěhování faktur se párování ruší jen novou cestou (zrusit_parovani_faktury).'
          using errcode = 'insufficient_privilege';
      end if;
      -- Potvrzené párování drží stav faktury: jiná faktura nebo jiná částka
      -- bez přepočtu by ho rozbila. Doplnění uuid k textu (dokončení
      -- převodu) přepojení není — old.faktura je prázdné.
      if old.stav = 'potvrzeno'
         and (new.castka_haleru is distinct from old.castka_haleru
              or new.faktura_id is distinct from old.faktura_id
              or (old.faktura is not null and new.faktura is distinct from old.faktura)) then
        raise exception 'Potvrzené párování nejde přepojit ani změnit jeho částku — zrušte ho a spárujte znovu.'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.platby_faktury_brana() from public, anon, authenticated;

create trigger trg_platby_faktury_brana
  before insert or update on public.platby_faktury
  for each row execute function app.platby_faktury_brana();

-- Mazání a TRUNCATE párování nedělá žádný kód (jen kaskáda, ta běží jako
-- vlastník); výchozí práva Supabase je úloze (service_role) přesto dávají.
-- TRUNCATE by obešel i spoušť výš. (Přihlášený je nemá od 20261006130000.)
revoke delete, truncate on public.platby_faktury from service_role;


-- =====================================================================
-- 6. ÚLOŽIŠTĚ A EVIDENCE PŘÍJMU: jen pro celou firmu
-- =====================================================================
--
-- Čtení příloh a evidence příjmu dosud stálo na can_read_scoped(…, null),
-- které rozsah členství neřeší — člen jedné pobočky s faktury.read tak
-- přímým dotazem četl evidenci i PDF celé firmy, i když Faktury samotné
-- vidět nesmí (hlášení 8. 10., „zůstává vědomě"). Po převodu leží v kbelíku
-- všechny faktury, proto teď stejné pravidlo jako u public.faktury.

drop policy faktury_prilohy_select on storage.objects;
create policy faktury_prilohy_select on storage.objects for select to authenticated
  using (
    bucket_id = 'faktury-prilohy'
    and coalesce(app.faktury_priloha_firma(name), app.faktury_rucni_priloha_firma(name))
        in (select app.firmy_s_pristupem('faktury.read')));

drop policy faktury_prijem_select on public.faktury_prijem;
create policy faktury_prijem_select on public.faktury_prijem for select to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.read')));

-- Ruční nahrání fotky/PDF k faktuře. Dřív šlo do VEŘEJNÉHO kbelíku
-- faktury-pdf ve staré databázi (otázka 46). Jen vložení do vlastní
-- složky rucne/: přepsat (upsert) ani smazat přihlášený nemůže — na to tu
-- politika není. Velikost hlídá kbelík (10 MB). Typ kbelík hlídá jen
-- zčásti (bere i XML z příjmu e-mailem) — XML a cokoli kromě PDF a obrázku
-- appka proto vždy dává ke STAŽENÍ, ne k otevření (lib/faktury-priloha-odkaz.ts).
create policy faktury_prilohy_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'faktury-prilohy'
    and app.faktury_rucni_priloha_firma(name) in (select app.firmy_s_pristupem('faktury.manage'))
    and app.faktury_stav_prevodu(app.faktury_rucni_priloha_firma(name)) = 'dokonceno');


-- =====================================================================
-- 7. PÁROVÁNÍ PLATEB S FAKTURAMI — v jedné transakci
-- =====================================================================
--
-- Staré funkce dostávaly celkovou částku faktury od volajícího a stav
-- faktury („Uhrazeno") zapisovala appka potom zvlášť do druhé databáze —
-- „best-effort", mohlo to nevyjít. Teď si funkce částku přečte sama
-- (řádek faktury zamkne) a stav přepne ve stejné transakci.
--
-- Pravidla stavu jsou ta, která dosud měla appka (platby/akce.ts,
-- potvrditParovani a zrusitAlokaci):
--   po spárování:  součet ≥ částka → „Uhrazeno", jinak „Částečně uhrazeno";
--   po zrušení:    součet 0 → „Neuhrazeno", ≥ částka → „Uhrazeno",
--                  jinak „Částečně uhrazeno".
-- JEDNA ZMĚNA, schválně opatrnější: u faktury bez kladné částky (AI ji
-- nepřečetla, dobropis) nebo v jiné měně než CZK se stav NEMĚNÍ — platby
-- jsou v Kč a porovnat se nedají. Dřív by taková faktura po jakékoli
-- platbě skončila jako „Uhrazeno" a vypadla z upomínek. Rozhodne člověk
-- (otázka 62).
--
-- Zámky: stejné advisory zámky a stejné pořadí jako staré funkce — kdyby
-- při přepnutí chvíli běžel starý i nový kód, srazí se na zámku.
-- Řádek faktury `for no key update`: stačí proti souběžné změně stavu
-- a neblokuje kontrolu cizích klíčů z příjmu.

create function app.faktura_stav_podle_plateb(p_soucet bigint, p_castka integer, p_mena text, p_po_zruseni boolean)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_castka <= 0 or upper(btrim(coalesce(p_mena, ''))) <> 'CZK' then null
    when p_po_zruseni and p_soucet <= 0 then 'Neuhrazeno'
    when p_soucet >= p_castka then 'Uhrazeno'
    else 'Částečně uhrazeno'
  end;
$$;

comment on function app.faktura_stav_podle_plateb(bigint, integer, text, boolean) is
  'Stav faktury podle součtu potvrzených plateb. NULL = stav se nemění (částka '
  'není kladná nebo faktura není v CZK).';

revoke all on function app.faktura_stav_podle_plateb(bigint, integer, text, boolean) from public, anon;
grant execute on function app.faktura_stav_podle_plateb(bigint, integer, text, boolean) to authenticated, service_role;


create function app.sparovat_platbu_s_fakturou(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer,
  p_jistota       numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint, stav_faktury text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce   bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura     bigint := hashtextextended(p_faktura::text, 0);
  v_branch           uuid;
  v_castka_transakce integer;
  v_smer             text;
  v_castka_faktury   integer;
  v_mena             text;
  v_soucet_transakce bigint;
  v_novy_soucet      bigint;
  v_stav             text;
  v_porovnatelna     boolean;
begin
  if p_castka_haleru is null or p_castka_haleru <= 0 then
    raise exception 'Alokovaná částka musí být kladná.' using errcode = 'check_violation';
  end if;

  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru, t.smer into v_branch, v_castka_transakce, v_smer
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant;

  if v_castka_transakce is null then
    raise exception 'Transakce nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění párovat platby.' using errcode = 'insufficient_privilege';
  end if;
  -- Párování mění stav faktury: kdo Faktury za celou firmu nevidí,
  -- nepáruje (obrazovka Plateb to chtěla i dřív).
  if not app.has_access(p_tenant, 'faktury.read', null) then
    raise exception 'Párovat s fakturami smí ten, kdo má právo „Vidět přijaté faktury" za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  -- Stav převodu až po kontrole práv: přihlášený bez práva na Faktury by
  -- jinak z hlášky poznal, v jakém stavu převod je.
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;
  -- Přijatá faktura se platí ODCHOZÍ platbou (jako automatické párování).
  -- Příchozí peníze patří Jiným platbám (tržby, úhrady pohledávek) —
  -- bez téhle podmínky by se tatáž příchozí platba dala rozdělit dvakrát:
  -- jednou jako úhrada v Jiných platbách, podruhé jako „zaplacená" faktura.
  if v_smer is distinct from 'vydaj' then
    raise exception 'S přijatou fakturou jde spárovat jen odchozí platbu (výdaj).' using errcode = 'check_violation';
  end if;

  select f.castka_haleru, f.mena into v_castka_faktury, v_mena
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant
     for no key update;

  if not found then
    raise exception 'Faktura nepatří této firmě.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(p.castka_haleru), 0) into v_soucet_transakce
    from public.platby_faktury p
   where p.transakce_id = p_transakce and p.stav = 'potvrzeno';

  -- Z jedné platby nejde rozdělit víc, než kolik nese (přeplatek FAKTURY
  -- appka dovoluje — zadání „podporuj… přeplatky").
  if v_soucet_transakce + p_castka_haleru > v_castka_transakce then
    raise exception 'Alokace přesahuje částku platby (% + % > %).',
      v_soucet_transakce, p_castka_haleru, v_castka_transakce using errcode = 'check_violation';
  end if;

  -- Firmu tu hlídá složený cizí klíč: řádek s fakturou p_faktura má
  -- nutně tenant_id faktury.
  select coalesce(sum(p.castka_haleru), 0) + p_castka_haleru into v_novy_soucet
    from public.platby_faktury p
   where p.faktura = p_faktura and p.stav = 'potvrzeno';

  insert into public.platby_faktury
    (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, potvrzeno_kdy, potvrdil, zpusob)
  values
    (p_tenant, p_transakce, p_faktura, p_castka_haleru, p_jistota, 'potvrzeno', now(),
     (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid())), 'rucne');

  v_stav := app.faktura_stav_podle_plateb(v_novy_soucet, v_castka_faktury, v_mena, false);
  v_porovnatelna := v_stav is not null;
  if v_porovnatelna then
    update public.faktury set stav = v_stav where id = p_faktura;
  end if;

  perform app.audit(p_tenant, 'finance.platba_alokovana', 'platby_faktury', p_faktura::text, v_branch,
                    null, jsonb_build_object(
                      'transakce_id', p_transakce, 'castka_haleru', p_castka_haleru,
                      'prebytek_haleru', case when v_porovnatelna then greatest(0, v_novy_soucet - v_castka_faktury) end,
                      'stav_faktury', v_stav));

  return query select
    v_novy_soucet,
    v_porovnatelna and v_novy_soucet >= v_castka_faktury,
    case when v_porovnatelna then greatest(0, v_novy_soucet - v_castka_faktury) else 0 end::bigint,
    v_stav;
end $$;

comment on function app.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric) is
  'Ruční potvrzení párování platby s fakturou: částku faktury čte sama, stav '
  'faktury přepne ve stejné transakci (stav_faktury NULL = nezměněn, faktura '
  'není v CZK nebo nemá kladnou částku). Nahrazuje potvrdit_alokaci_platby.';

revoke all on function app.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric) from public, anon;
grant execute on function app.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric) to authenticated;

create function public.sparovat_platbu_s_fakturou(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer,
  p_jistota       numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint, stav_faktury text)
language sql security invoker set search_path = ''
as $$
  select * from app.sparovat_platbu_s_fakturou(p_tenant, p_transakce, p_faktura, p_castka_haleru, p_jistota);
$$;

revoke all on function public.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric) to authenticated;


-- Zrušení párování (člověk v Platbách). Řádek zůstává (historie), jde
-- na 'zamitnuto'; stav faktury se přepočítá ve stejné transakci.
create function app.zrusit_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns text
language plpgsql security definer set search_path = '' set foodtab.faktury_cesta = 'nova'
as $$
declare
  v_branch   uuid;
  v_faktura  uuid;
  v_parovani text;
  v_castka   integer;
  v_mena     text;
  v_soucet   bigint;
  v_stav     text;
begin
  -- Zamknout řádek párování: dvojí kliknutí počká a uvidí, že už je zrušené.
  select u.branch_id, p.faktura, p.stav into v_branch, v_faktura, v_parovani
    from public.platby_faktury p
    join public.transakce t on t.id = p.transakce_id
    join public.platebni_ucty u on u.id = t.ucet_id
   where p.id = p_alokace and p.tenant_id = p_tenant
     for update of p;

  if not found then
    raise exception 'Párování nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění zrušit párování.' using errcode = 'insufficient_privilege';
  end if;
  -- Zrušení mění stav faktury — stejné právo jako spárování.
  if not app.has_access(p_tenant, 'faktury.read', null) then
    raise exception 'Rušit párování s fakturami smí ten, kdo má právo „Vidět přijaté faktury" za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  -- Stav převodu až po kontrole práv (hláška by ho jinak prozradila).
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;
  -- Až po kontrole práv (jinak by se dalo zjišťovat stav cizích párování).
  -- Bez toho by opakované zrušení (stará stránka, dvojí kliknutí) znovu
  -- přepočítalo stav faktury a přepsalo ručně nastavený stav.
  if v_parovani is distinct from 'potvrzeno' then
    raise exception 'Párování už není potvrzené (stav: %) — není co rušit.', v_parovani
      using errcode = 'check_violation';
  end if;

  -- Řádek faktury zamknout PŘED změnou párování — souběžné spárování téže
  -- faktury počká a přepočte stav až po nás.
  if v_faktura is not null then
    select f.castka_haleru, f.mena into v_castka, v_mena
      from public.faktury f where f.id = v_faktura for no key update;
  end if;

  update public.platby_faktury set stav = 'zamitnuto' where id = p_alokace;

  -- Bez faktury (párování na fakturu, která ve staré databázi zmizela) se
  -- jen zruší — stav není čemu přepočítat.
  if v_faktura is not null then
    select coalesce(sum(p.castka_haleru), 0) into v_soucet
      from public.platby_faktury p
     where p.faktura = v_faktura and p.stav = 'potvrzeno';
    v_stav := app.faktura_stav_podle_plateb(v_soucet, v_castka, v_mena, true);
    if v_stav is not null then
      update public.faktury set stav = v_stav where id = v_faktura;
    end if;
  end if;

  perform app.audit(p_tenant, 'finance.platba_zrusena', 'platby_faktury', coalesce(v_faktura::text, p_alokace::text), v_branch,
                    jsonb_build_object('duvod', coalesce(p_duvod, ''), 'alokace_id', p_alokace),
                    jsonb_build_object('stav_faktury', v_stav));
  return v_stav;
end $$;

comment on function app.zrusit_parovani_faktury(uuid, uuid, text) is
  'Zrušení párování (stav zamitnuto) a přepočet stavu faktury v jedné transakci. '
  'Nahrazuje zrusit_alokaci_platby + best-effort zápis do Faktur.';

revoke all on function app.zrusit_parovani_faktury(uuid, uuid, text) from public, anon;
grant execute on function app.zrusit_parovani_faktury(uuid, uuid, text) to authenticated;

create function public.zrusit_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns text
language sql security invoker set search_path = ''
as $$
  select app.zrusit_parovani_faktury(p_tenant, p_alokace, p_duvod);
$$;

revoke all on function public.zrusit_parovani_faktury(uuid, uuid, text) from public, anon;
grant execute on function public.zrusit_parovani_faktury(uuid, uuid, text) to authenticated;


-- Automatické párování (úloha, service_role). Stejná pravidla jako
-- app.automaticky_sparovat_platbu (20261008120000), částku faktury čte
-- z databáze. Navíc druhá linie za vybratAutomatickaParovani (TS): jen
-- faktura v CZK, nearchivovaná, ne duplicita, a platba v CZK — databáze
-- to teď vidí sama. Stav faktury tahle funkce NEMĚNÍ: ten dorovnává
-- úloha podle všech automatických párování faktury
-- (lib/finance-automaticke-parovani.ts, krok 3), beze změny pravidel.
create function app.automaticky_sparovat_fakturu(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce   bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura     bigint := hashtextextended(p_faktura::text, 0);
  v_branch           uuid;
  v_castka_transakce integer;
  v_castka_faktury   integer;
begin
  if p_castka_haleru is null or p_castka_haleru <= 0
     or app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return false;
  end if;

  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select f.castka_haleru into v_castka_faktury
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant
     and upper(btrim(f.mena)) = 'CZK' and not f.archivovano and not f.duplicita
     for no key update;
  if v_castka_faktury is null or v_castka_faktury <> p_castka_haleru then
    return false;
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant and t.smer = 'vydaj'
     and upper(btrim(t.mena)) = 'CZK'
     -- Jen platba, která skutečně přišla z banky (ruční zápis si může
     -- kdokoli s financemi napsat sám a fakturu by tím „zaplatil").
     and t.zdroj in ('fio_api', 'bankovni_agregator', 'csv_banka');

  if v_castka_transakce is null or v_castka_transakce <> p_castka_haleru then
    return false;
  end if;

  -- Cokoli už spárovaného (i částečně, i jinou cestou) = není jednoznačné.
  if exists (select 1 from public.platby_faktury p
              where p.stav = 'potvrzeno'
                and (p.transakce_id = p_transakce or p.faktura = p_faktura)) then
    return false;
  end if;

  -- Člověk tohle párování už jednou zrušil — automatika ho nevrací.
  if exists (select 1 from public.platby_faktury p
              where p.transakce_id = p_transakce and p.faktura = p_faktura and p.stav = 'zamitnuto') then
    return false;
  end if;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, potvrzeno_kdy, zpusob)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, 1, 'potvrzeno', now(), 'automaticky');

  perform app.audit(p_tenant, 'finance.platba_alokovana_automaticky', 'platby_faktury', p_faktura::text, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', p_castka_haleru));
  return true;
end $$;

comment on function app.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer) is
  'Jen pro úlohu (service_role): potvrdí JEDNOZNAČNOU shodu platby a faktury. '
  'Nahrazuje automaticky_sparovat_platbu (částku faktury čte sama).';

revoke all on function app.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function app.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer) to service_role;

create function public.automaticky_sparovat_fakturu(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer
)
returns boolean
language sql security invoker set search_path = ''
as $$
  select app.automaticky_sparovat_fakturu(p_tenant, p_transakce, p_faktura, p_castka_haleru);
$$;

revoke all on function public.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer) to service_role;


-- Zrušení AUTOMATICKÉHO párování („Vrátit mezi neuhrazené" ve Fakturách,
-- server po ověření práv, service_role). Jako app.zrusit_automaticke_parovani,
-- jen nová cesta (vrací uuid faktury, ne text).
create function app.zrusit_automaticke_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns boolean
language plpgsql security definer set search_path = '' set foodtab.faktury_cesta = 'nova'
as $$
declare
  v_faktura uuid;
begin
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return false;
  end if;

  update public.platby_faktury
     set stav = 'zamitnuto'
   where id = p_alokace and tenant_id = p_tenant and zpusob = 'automaticky' and stav = 'potvrzeno'
  returning faktura into v_faktura;

  if not found then
    return false;
  end if;

  perform app.audit(p_tenant, 'finance.automaticke_parovani_zruseno', 'platby_faktury',
                    coalesce(v_faktura::text, p_alokace::text), null,
                    null, jsonb_build_object('alokace_id', p_alokace, 'duvod', left(coalesce(p_duvod, ''), 300)));
  return true;
end $$;

revoke all on function app.zrusit_automaticke_parovani_faktury(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.zrusit_automaticke_parovani_faktury(uuid, uuid, text) to service_role;

create function public.zrusit_automaticke_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns boolean
language sql security invoker set search_path = ''
as $$
  select app.zrusit_automaticke_parovani_faktury(p_tenant, p_alokace, p_duvod);
$$;

revoke all on function public.zrusit_automaticke_parovani_faktury(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.zrusit_automaticke_parovani_faktury(uuid, uuid, text) to service_role;


-- =====================================================================
-- 8. PŘEVOD — porovnání, měření, zahájení, dokončení, vrácení (jen úloha)
-- =====================================================================

-- Porovnání pole po poli: kopie staré databáze (faktury_prevod_zdroj,
-- staré názvy sloupců v jsonb) proti public.faktury. Vlastní zápis
-- převodu, nezávislý na lib/faktury-prevod.ts — prohozený sloupec nebo
-- ztracený haléř v převodu tady spadne, i kdyby ho úloha přehlédla.
-- Časy se porovnávají přesně (i mikrosekundy), částka bez zaokrouhlení.
create function app.faktury_prevod_porovnat(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with z as (
    select k.klic, k.radek from public.faktury_prevod_zdroj k
     where k.tenant_id = p_tenant and k.tabulka = 'invoices'
  ),
  f as (
    select * from public.faktury where tenant_id = p_tenant
  ),
  rozdily as (
    select f.id,
      array_remove(array[
        case when f.prijato_kdy is distinct from (z.radek ->> 'received_at')::timestamptz then 'prijato_kdy' end,
        case when f.email_odesilatel is distinct from z.radek ->> 'email_sender' then 'email_odesilatel' end,
        case when f.email_predmet is distinct from z.radek ->> 'email_subject' then 'email_predmet' end,
        case when f.dodavatel is distinct from z.radek ->> 'supplier' then 'dodavatel' end,
        case when f.dodavatel_ico is distinct from z.radek ->> 'supplier_ico' then 'dodavatel_ico' end,
        case when f.cislo_faktury is distinct from z.radek ->> 'invoice_number' then 'cislo_faktury' end,
        case when f.variabilni_symbol is distinct from z.radek ->> 'variable_symbol' then 'variabilni_symbol' end,
        case when f.castka_haleru::numeric is distinct from (z.radek ->> 'amount')::numeric * 100 then 'castka_haleru' end,
        case when f.mena is distinct from z.radek ->> 'currency' then 'mena' end,
        case when f.datum_vystaveni is distinct from (z.radek ->> 'issue_date')::date then 'datum_vystaveni' end,
        case when f.duzp is distinct from (z.radek ->> 'duzp')::date then 'duzp' end,
        case when f.splatnost is distinct from (z.radek ->> 'due_date')::date then 'splatnost' end,
        case when f.ucet_dodavatele is distinct from z.radek ->> 'supplier_account' then 'ucet_dodavatele' end,
        case when f.stav is distinct from z.radek ->> 'status' then 'stav' end,
        case when f.ke_kontrole is distinct from coalesce((z.radek ->> 'needs_review')::boolean, false) then 'ke_kontrole' end,
        case when f.duplicita is distinct from coalesce((z.radek ->> 'is_duplicate')::boolean, false) then 'duplicita' end,
        case when f.archivovano is distinct from coalesce((z.radek ->> 'is_archived')::boolean, false) then 'archivovano' end,
        case when f.poznamka_kontroly is distinct from z.radek ->> 'review_note' then 'poznamka_kontroly' end,
        case when f.upominka_odeslana_kdy is distinct from (z.radek ->> 'reminder_sent_at')::timestamptz then 'upominka_odeslana_kdy' end,
        case when f.vytah_textu is distinct from z.radek ->> 'document_text_excerpt' then 'vytah_textu' end,
        case when f.odkaz_pdf is distinct from z.radek ->> 'pdf_url' then 'odkaz_pdf' end,
        case when f.odkaz_onedrive is distinct from z.radek ->> 'onedrive_url' then 'odkaz_onedrive' end,
        case when f.vytvoreno_kdy is distinct from (z.radek ->> 'created_at')::timestamptz then 'vytvoreno_kdy' end
      ], null) as pole
    from z join f on f.id::text = lower(btrim(z.klic))
  )
  select jsonb_build_object(
    'zdroj',  (select count(*) from z),
    'hlavni', (select count(*) from f),
    'chybi',  (select count(*) from z where not exists (select 1 from f where f.id::text = lower(btrim(z.klic)))),
    'navic',  (select count(*) from f where not exists (select 1 from z where lower(btrim(z.klic)) = f.id::text)),
    'lisi',   (select count(*) from rozdily r where cardinality(r.pole) > 0),
    'priklady', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pole', to_jsonb(r.pole)))
                            from (select * from rozdily r where cardinality(r.pole) > 0 order by r.id limit 20) r),
                         '[]'::jsonb),
    'vzory_zdroj',  (select count(*) from public.faktury_prevod_zdroj k
                      where k.tenant_id = p_tenant and k.tabulka = 'rejection_examples'),
    'vzory_chybi',  (select count(*) from public.faktury_prevod_zdroj k
                      where k.tenant_id = p_tenant and k.tabulka = 'rejection_examples'
                        and not exists (select 1 from public.faktury_vzory_odmitnuti v
                                         where v.tenant_id = p_tenant and v.puvodni_id::text = k.klic))
  );
$$;

comment on function app.faktury_prevod_porovnat(uuid) is
  'Kopie staré databáze proti public.faktury, pole po poli (v SQL, nezávisle '
  'na úloze). Dokončení převodu chce chybi = navic = lisi = vzory_chybi = 0.';

revoke all on function app.faktury_prevod_porovnat(uuid) from public, anon, authenticated;
grant execute on function app.faktury_prevod_porovnat(uuid) to service_role;

create function public.faktury_prevod_porovnat(p_tenant uuid)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_porovnat(p_tenant);
$$;

revoke all on function public.faktury_prevod_porovnat(uuid) from public, anon, authenticated;
grant execute on function public.faktury_prevod_porovnat(uuid) to service_role;


-- Měření pro lidi: stejné počty a součty nad kopií staré databáze i nad
-- hlavní, plus párování, evidence příjmu a přílohy. Hlášení „před a po"
-- pro Šéfíka (docs/hlaseni/faktury-prevod-mereni.sql ukazuje totéž
-- ručně, v SQL editoru).
create function app.faktury_prevod_mereni(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with z as (
    select k.radek from public.faktury_prevod_zdroj k
     where k.tenant_id = p_tenant and k.tabulka = 'invoices'
  ),
  f as (
    select * from public.faktury where tenant_id = p_tenant
  ),
  p as (
    select * from public.platby_faktury where tenant_id = p_tenant
  )
  select jsonb_build_object(
    'stara', jsonb_build_object(
      'pocet',         (select count(*) from z),
      'archivovanych', (select count(*) from z where (z.radek ->> 'is_archived')::boolean),
      'duplicit',      (select count(*) from z where (z.radek ->> 'is_duplicate')::boolean),
      'ke_kontrole',   (select count(*) from z where (z.radek ->> 'needs_review')::boolean),
      's_odkazem_pdf', (select count(*) from z where coalesce(z.radek ->> 'pdf_url', '') <> ''),
      's_onedrive',    (select count(*) from z where coalesce(z.radek ->> 'onedrive_url', '') <> ''),
      'castky_haleru', coalesce((select jsonb_object_agg(x.mena, x.soucet) from (
                          select coalesce(z.radek ->> 'currency', '(bez měny)') as mena, sum((z.radek ->> 'amount')::numeric * 100) as soucet
                            from z group by 1) x), '{}'::jsonb)),
    'hlavni', jsonb_build_object(
      'pocet',         (select count(*) from f),
      'archivovanych', (select count(*) from f where f.archivovano),
      'duplicit',      (select count(*) from f where f.duplicita),
      'ke_kontrole',   (select count(*) from f where f.ke_kontrole),
      's_odkazem_pdf', (select count(*) from f where coalesce(f.odkaz_pdf, '') <> ''),
      's_onedrive',    (select count(*) from f where coalesce(f.odkaz_onedrive, '') <> ''),
      'castky_haleru', coalesce((select jsonb_object_agg(x.mena, x.soucet) from (
                          select coalesce(f.mena, '(bez měny)') as mena, sum(f.castka_haleru) as soucet from f group by 1) x), '{}'::jsonb),
      'vznikle_po_prevodu', (select count(*) from f where f.prevedeno_kdy is null)),
    'parovani', jsonb_build_object(
      'pocet',                   (select count(*) from p),
      'potvrzenych',             (select count(*) from p where p.stav = 'potvrzeno'),
      'potvrzeno_haleru',        (select coalesce(sum(p.castka_haleru), 0) from p where p.stav = 'potvrzeno'),
      'bez_faktury_platnych',    (select count(*) from p where p.faktura is null and p.stav <> 'zamitnuto'
                                    and not exists (select 1 from f where f.id::text = lower(btrim(p.faktura_id)))),
      'bez_faktury_zrusenych',   (select count(*) from p where p.faktura is null and p.stav = 'zamitnuto'
                                    and not exists (select 1 from f where f.id::text = lower(btrim(p.faktura_id)))),
      'bez_uuid',                (select count(*) from p where p.faktura is null)),
    'prijem', jsonb_build_object(
      's_fakturou',        (select count(*) from public.faktury_prijem e where e.tenant_id = p_tenant and e.faktura_id is not null),
      's_fakturou_uuid',   (select count(*) from public.faktury_prijem e where e.tenant_id = p_tenant and e.faktura is not null)),
    'prilohy', jsonb_build_object(
      'stare_verejne',      (select count(*) from f where f.odkaz_pdf like '%/storage/v1/object/public/faktury-pdf/%'),
      'stare_bez_kopie',    (select count(*) from f where f.odkaz_pdf like '%/storage/v1/object/public/faktury-pdf/%'
                               and f.priloha_cesta is null),
      'nepodarene',         (select count(*) from jsonb_object_keys(coalesce(
                               (select pr.prilohy -> 'chyby' from public.faktury_prevod pr where pr.tenant_id = p_tenant),
                               '{}'::jsonb))),
      -- Bez kopie a bez zapsaného důvodu, proč se kopie nepodařila — tohle
      -- musí být před dokončením 0 (stará databáze může usnout).
      'stare_bez_kopie_nevykazane', (select count(*) from f
                               where f.odkaz_pdf like '%/storage/v1/object/public/faktury-pdf/%'
                                 and f.priloha_cesta is null
                                 and not (coalesce((select pr.prilohy -> 'chyby' from public.faktury_prevod pr
                                                     where pr.tenant_id = p_tenant), '{}'::jsonb) ? f.id::text))),
    'vzory', jsonb_build_object(
      'stara',  (select count(*) from public.faktury_prevod_zdroj k where k.tenant_id = p_tenant and k.tabulka = 'rejection_examples'),
      'hlavni', (select count(*) from public.faktury_vzory_odmitnuti v where v.tenant_id = p_tenant))
  );
$$;

revoke all on function app.faktury_prevod_mereni(uuid) from public, anon, authenticated;
grant execute on function app.faktury_prevod_mereni(uuid) to service_role;

create function public.faktury_prevod_mereni(p_tenant uuid)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_mereni(p_tenant);
$$;

revoke all on function public.faktury_prevod_mereni(uuid) from public, anon, authenticated;
grant execute on function public.faktury_prevod_mereni(uuid) to service_role;


-- Zámek úlohy převodu (p_zabrat true = zabrat, false = uvolnit). Zámek
-- starší dvou minut se bere za opuštěný (běh úlohy má strop 60 s).
create function app.faktury_prevod_zamek(p_tenant uuid, p_zabrat boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_zabrat then
    update public.faktury_prevod
       set zamek_kdy = now()
     where tenant_id = p_tenant
       and (zamek_kdy is null or zamek_kdy < now() - interval '2 minutes');
    return found;
  end if;
  update public.faktury_prevod set zamek_kdy = null where tenant_id = p_tenant;
  return true;
end $$;

revoke all on function app.faktury_prevod_zamek(uuid, boolean) from public, anon, authenticated;
grant execute on function app.faktury_prevod_zamek(uuid, boolean) to service_role;

create function public.faktury_prevod_zamek(p_tenant uuid, p_zabrat boolean)
returns boolean
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_zamek(p_tenant, p_zabrat);
$$;

revoke all on function public.faktury_prevod_zamek(uuid, boolean) from public, anon, authenticated;
grant execute on function public.faktury_prevod_zamek(uuid, boolean) to service_role;


-- Zahájení: Faktury firmy zůstávají zavřené, úloha smí převádět.
-- Z „dokonceno" nejde — převod by přepsal změny udělané v appce;
-- nejdřív „vratit".
create function app.faktury_prevod_zahajit(p_tenant uuid, p_zdroj text, p_mereni jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Firma neexistuje.' using errcode = 'check_violation';
  end if;

  select pr.stav into v_stav from public.faktury_prevod pr where pr.tenant_id = p_tenant for update;
  if v_stav = 'dokonceno' then
    raise exception 'Převod je dokončený — nejdřív ho vraťte (režim „vratit"), jinak by převod přepsal změny udělané v appce.'
      using errcode = 'check_violation';
  end if;

  -- Po vrácení starý kód páruje textem a spoušť odkazu doplňuje uuid
  -- (i uuid z doby „dokonceno" zůstala). Smaže-li stará appka takovou
  -- fakturu, převod by ji v hlavní databázi smazat nemohl (cizí klíč bez
  -- akce) a v probiha nejde párování změnit — převod by uvízl. Uuid se
  -- proto vynuluje; text zůstává a dokončení uuid doplní znovu.
  update public.platby_faktury set faktura = null where tenant_id = p_tenant and faktura is not null;

  insert into public.faktury_prevod (tenant_id, stav, zdroj, mereni_zahajeni)
  values (p_tenant, 'probiha', p_zdroj, p_mereni)
  on conflict (tenant_id) do update
    set stav = 'probiha', zdroj = excluded.zdroj, mereni_zahajeni = excluded.mereni_zahajeni,
        zahajeno_kdy = now(), dokonceno_kdy = null, mereni_dokonceni = null, zmeneno_kdy = now(),
        -- Nepovedené přílohy z dřívějšího pokusu neplatí (odkaz mohl být
        -- mezitím opravený).
        prilohy = '{}'::jsonb;

  perform app.audit(p_tenant, 'faktury.prevod_zahajen', 'faktury_prevod', p_tenant::text, null,
                    jsonb_build_object('stav', v_stav),
                    -- Do auditu bez součtů peněz (čte ho i správce bez práva
                    -- na Faktury); úplné měření je ve faktury_prevod (jen úloha).
                    jsonb_build_object('stav', 'probiha', 'zdroj', p_zdroj, 'mereni', p_mereni - 'castky_haleru'));
  return 'probiha';
end $$;

revoke all on function app.faktury_prevod_zahajit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function app.faktury_prevod_zahajit(uuid, text, jsonb) to service_role;

create function public.faktury_prevod_zahajit(p_tenant uuid, p_zdroj text, p_mereni jsonb)
returns text
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_zahajit(p_tenant, p_zdroj, p_mereni);
$$;

revoke all on function public.faktury_prevod_zahajit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.faktury_prevod_zahajit(uuid, text, jsonb) to service_role;


-- Dokončení. Úloha předá, kolik řádků stará databáze má (počet ze
-- samostatného dotazu count=exact, ne z načítání po stránkách); databáze
-- ověří, že kopie má přesně tolik, porovná každou fakturu pole po poli
-- a zkontroluje přílohy. Když cokoli nesedí, NEZMĚNÍ NIC a vrátí důvody.
-- Když sedí vše: stav dokonceno (Faktury se otevřou), doplní cizí klíče
-- u starých párování a evidence.
--
-- Párování na fakturu, která ve staré databázi už není (smazaná po
-- spárování), dokončení NEZASTAVÍ — během převodu by je nikdo nemohl
-- opravit a Faktury by zůstaly zavřené. Vykáže se a v Platbách jde zrušit.
create function app.faktury_prevod_dokoncit(p_tenant uuid, p_pocet_zdroje integer, p_pocet_vzoru integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav            text;
  v_porovnani       jsonb;
  v_mereni          jsonb;
  v_duvody          jsonb := '[]'::jsonb;
  v_doplneno_platby integer;
  v_doplneno_prijem integer;
begin
  select pr.stav into v_stav from public.faktury_prevod pr where pr.tenant_id = p_tenant for update;
  if v_stav is distinct from 'probiha' then
    raise exception 'Převod pro tuhle firmu neprobíhá (stav: %).', coalesce(v_stav, 'nezahájen')
      using errcode = 'check_violation';
  end if;

  v_porovnani := app.faktury_prevod_porovnat(p_tenant);
  v_mereni := app.faktury_prevod_mereni(p_tenant);

  if (v_porovnani ->> 'zdroj')::integer is distinct from p_pocet_zdroje then
    v_duvody := v_duvody || jsonb_build_array(format(
      'Kopie staré databáze má %s faktur, stará databáze %s — spusťte převod znovu.',
      v_porovnani ->> 'zdroj', coalesce(p_pocet_zdroje::text, '?')));
  end if;
  if (v_porovnani ->> 'vzory_zdroj')::integer is distinct from p_pocet_vzoru then
    v_duvody := v_duvody || jsonb_build_array(format(
      'Kopie má %s vzorů odmítnutí, stará databáze %s.', v_porovnani ->> 'vzory_zdroj', coalesce(p_pocet_vzoru::text, '?')));
  end if;
  if (v_porovnani ->> 'chybi')::integer > 0 or (v_porovnani ->> 'navic')::integer > 0
     or (v_porovnani ->> 'lisi')::integer > 0 or (v_porovnani ->> 'vzory_chybi')::integer > 0 then
    v_duvody := v_duvody || jsonb_build_array(format(
      'Převedené faktury nesedí s kopií: chybí %s, navíc %s, liší se %s, vzorů chybí %s.',
      v_porovnani ->> 'chybi', v_porovnani ->> 'navic', v_porovnani ->> 'lisi', v_porovnani ->> 'vzory_chybi'));
  end if;
  -- Přílohy musí být zkopírované PŘED otevřením: stará databáze může
  -- usnout (Free tarif, 7 dní bez provozu) a nikdo ji nevzbudí.
  if (v_mereni -> 'prilohy' ->> 'stare_bez_kopie_nevykazane')::integer > 0 then
    v_duvody := v_duvody || jsonb_build_array(format(
      'Zbývá zkopírovat %s příloh ze starého veřejného úložiště (režim „prilohy").',
      v_mereni -> 'prilohy' ->> 'stare_bez_kopie_nevykazane'));
  end if;

  if jsonb_array_length(v_duvody) > 0 then
    return jsonb_build_object('ok', false, 'duvody', v_duvody, 'porovnani', v_porovnani, 'mereni', v_mereni);
  end if;

  -- Nejdřív stav (spoušť párování ve stavu probiha zápis odmítá), pak
  -- doplnění cizích klíčů.
  update public.faktury_prevod
     set stav = 'dokonceno', dokonceno_kdy = now(), mereni_dokonceni = v_mereni, zmeneno_kdy = now()
   where tenant_id = p_tenant;

  update public.platby_faktury p
     set faktura = f.id
    from public.faktury f
   where p.tenant_id = p_tenant
     and p.faktura is null
     and f.tenant_id = p_tenant
     and f.id::text = lower(btrim(p.faktura_id));
  get diagnostics v_doplneno_platby = row_count;

  update public.faktury_prijem p
     set faktura = f.id
    from public.faktury f
   where p.tenant_id = p_tenant
     and p.faktura is null
     and f.tenant_id = p_tenant
     and f.id::text = lower(btrim(p.faktura_id));
  get diagnostics v_doplneno_prijem = row_count;

  v_mereni := app.faktury_prevod_mereni(p_tenant);
  update public.faktury_prevod set mereni_dokonceni = v_mereni where tenant_id = p_tenant;

  -- Do auditu bez součtů peněz (faktur ani potvrzených plateb) — audit čte
  -- i správce bez práva na Faktury a Platby; úplné měření je ve faktury_prevod.
  perform app.audit(p_tenant, 'faktury.prevod_dokoncen', 'faktury_prevod', p_tenant::text, null, null,
                    jsonb_build_object('mereni', v_mereni #- '{parovani,potvrzeno_haleru}'
                                                         #- '{stara,castky_haleru}' #- '{hlavni,castky_haleru}',
                                       'doplneno_platby', v_doplneno_platby,
                                       'doplneno_prijem', v_doplneno_prijem));

  return jsonb_build_object('ok', true, 'mereni', v_mereni, 'porovnani', v_porovnani,
                            'doplneno_platby', v_doplneno_platby, 'doplneno_prijem', v_doplneno_prijem);
end $$;

revoke all on function app.faktury_prevod_dokoncit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function app.faktury_prevod_dokoncit(uuid, integer, integer) to service_role;

create function public.faktury_prevod_dokoncit(p_tenant uuid, p_pocet_zdroje integer, p_pocet_vzoru integer)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_dokoncit(p_tenant, p_pocet_zdroje, p_pocet_vzoru);
$$;

revoke all on function public.faktury_prevod_dokoncit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.faktury_prevod_dokoncit(uuid, integer, integer) to service_role;


-- Zrušení probíhajícího převodu (bez dokončení): stav „vraceno" — Faktury
-- v nové appce zůstanou zavřené a stará cesta párování se otevře, takže
-- předchozí verze appky (revert PR) může párovat. Bez toho by z „probiha"
-- nevedla cesta ven a předchozí verze appky by párovat nemohla.
create function app.faktury_prevod_zrusit(p_tenant uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav text;
begin
  select pr.stav into v_stav from public.faktury_prevod pr where pr.tenant_id = p_tenant for update;
  if v_stav is distinct from 'probiha' then
    raise exception 'Zrušit jde jen probíhající převod (stav: %).', coalesce(v_stav, 'nezahájen')
      using errcode = 'check_violation';
  end if;

  update public.faktury_prevod
     set stav = 'vraceno', vraceno_kdy = now(), zmeneno_kdy = now()
   where tenant_id = p_tenant;

  perform app.audit(p_tenant, 'faktury.prevod_zrusen', 'faktury_prevod', p_tenant::text, null,
                    jsonb_build_object('stav', v_stav), jsonb_build_object('stav', 'vraceno'));
  return 'vraceno';
end $$;

revoke all on function app.faktury_prevod_zrusit(uuid) from public, anon, authenticated;
grant execute on function app.faktury_prevod_zrusit(uuid) to service_role;

create function public.faktury_prevod_zrusit(p_tenant uuid)
returns text
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_zrusit(p_tenant);
$$;

revoke all on function public.faktury_prevod_zrusit(uuid) from public, anon, authenticated;
grant execute on function public.faktury_prevod_zrusit(uuid) to service_role;


-- Vrácení: Faktury se pro firmu zavřou (hlavní databáze se už nemění),
-- stará cesta párování se otevře. Pak režim „zpet" přenese změny do
-- staré databáze a appka se vrátí na předchozí verzi.
create function app.faktury_prevod_vratit(p_tenant uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav text;
begin
  select pr.stav into v_stav from public.faktury_prevod pr where pr.tenant_id = p_tenant for update;
  if v_stav is distinct from 'dokonceno' then
    raise exception 'Vrátit jde jen dokončený převod (stav: %).', coalesce(v_stav, 'nezahájen')
      using errcode = 'check_violation';
  end if;

  update public.faktury_prevod
     set stav = 'vraceno', vraceno_kdy = now(), zpet_hotovo_kdy = null, zmeneno_kdy = now()
   where tenant_id = p_tenant;

  perform app.audit(p_tenant, 'faktury.prevod_vracen', 'faktury_prevod', p_tenant::text, null,
                    jsonb_build_object('stav', v_stav), jsonb_build_object('stav', 'vraceno'));
  return 'vraceno';
end $$;

-- Návrat zpět je hotový: úloha přenesla změny z appky do staré databáze
-- a nový plán vyšel nulový. Jen po vrácení DOKONČENÉHO převodu — po
-- zrušení nebylo co vracet (kopie není stav z dokončení a „zpet" by
-- podle ní mazal skutečné faktury staré databáze).
create function app.faktury_prevod_zpet_hotovo(p_tenant uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav      text;
  v_dokonceno timestamptz;
  v_hotovo    timestamptz;
begin
  select pr.stav, pr.dokonceno_kdy, pr.zpet_hotovo_kdy into v_stav, v_dokonceno, v_hotovo
    from public.faktury_prevod pr where pr.tenant_id = p_tenant for update;
  if v_stav is distinct from 'vraceno' or v_dokonceno is null then
    raise exception 'Návrat zpět jde označit jen po vrácení dokončeného převodu (stav: %).', coalesce(v_stav, 'nezahájen')
      using errcode = 'check_violation';
  end if;
  if v_hotovo is not null then
    return v_hotovo;
  end if;

  update public.faktury_prevod set zpet_hotovo_kdy = now(), zmeneno_kdy = now() where tenant_id = p_tenant;
  perform app.audit(p_tenant, 'faktury.prevod_zpet_hotovo', 'faktury_prevod', p_tenant::text, null, null,
                    jsonb_build_object('stav', v_stav));
  return now();
end $$;

revoke all on function app.faktury_prevod_zpet_hotovo(uuid) from public, anon, authenticated;
grant execute on function app.faktury_prevod_zpet_hotovo(uuid) to service_role;

create function public.faktury_prevod_zpet_hotovo(p_tenant uuid)
returns timestamptz
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_zpet_hotovo(p_tenant);
$$;

revoke all on function public.faktury_prevod_zpet_hotovo(uuid) from public, anon, authenticated;
grant execute on function public.faktury_prevod_zpet_hotovo(uuid) to service_role;

revoke all on function app.faktury_prevod_vratit(uuid) from public, anon, authenticated;
grant execute on function app.faktury_prevod_vratit(uuid) to service_role;

create function public.faktury_prevod_vratit(p_tenant uuid)
returns text
language sql security invoker set search_path = ''
as $$
  select app.faktury_prevod_vratit(p_tenant);
$$;

revoke all on function public.faktury_prevod_vratit(uuid) from public, anon, authenticated;
grant execute on function public.faktury_prevod_vratit(uuid) to service_role;
