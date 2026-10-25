-- =====================================================================
-- Foodtab — Provoz → Rezervace a kalendář akcí
--
-- Zadání Šéfíka 25. 10. 2026: „V modulu Provoz potřebuji novou záložku
-- Rezervace a kalendář akcí. … vytvoř tuto sekci tak, aby šla propojit
-- na externí rezervační systém. U jednotlivých dnů a rezervací má jít
-- přidávat třeba dokumenty, poznámky či další informace."
--
-- Průzkum a návrh (proč to vypadá takhle): docs/rezervace-navrh.md.
-- Tahle hlavička říká jen to, co by někdo za rok „opravil", kdyby to
-- nevěděl.
--
-- ---------------------------------------------------------------------
-- CO JE ZDROJ PRAVDY
--
--   * Rezervace zapsaná ve Foodtabu (`zdroj = 'rucne'`): Foodtab, celá.
--   * Rezervace z rezervačního systému (`zdroj = 'csv'` nebo `'externi'`):
--     ČAS, POČET OSOB, STAV, JMÉNO, KONTAKT a POZNÁMKA HOSTA patří
--     zdroji. Foodtab je přepisuje při každém novějším importu a na
--     obrazovce je nedovolí měnit (`rezervace_ulozit` je odmítne) — jinak
--     by se oprava v appce při příštím importu tiše vrátila.
--     Foodtabu patří: druh (rezervace/akce), název, typ akce, prostor,
--     menu, záloha od hosta, poznámky a přílohy. Ty import NIKDY
--     nepřepíše; `prostor` jen doplní, když je prázdný.
--   * Starší data nepřebijí novější: řádek, jehož `zmeneno_kdy` od zdroje
--     je starší než to, co už je uložené, se přeskočí (webhook, který
--     dorazí pozdě).
--   * Zrušení ve zdroji = `stav = 'zrusena'`, ne smazání. Poznámky
--     a přílohy k té rezervaci zůstávají.
--
-- Párování je podle EXTERNÍHO ID: (firma, pobočka, poskytovatel,
-- externi_id) je jedinečné, takže tentýž soubor nebo tatáž dávka puštěná
-- dvakrát nic nezdvojí.
--
-- ---------------------------------------------------------------------
-- BEZPEČNOST
--
--   * Dvě nová práva v modulu `provoz`: `rezervace.read` (vidět kalendář,
--     rezervace, poznámky, přílohy) a `rezervace.manage` (zapisovat;
--     jen on vidí telefon a e-mail hosta).
--   * Všechny tabulky: tenant_id + branch_id, RLS jen pro čtení, ZÁPIS
--     JEN PŘES FUNKCE (`revoke all`, zpátky jen `select`). Výchozí práva
--     Supabase by jinak `create table` dala anon/authenticated všechno.
--   * Funkce jsou SECURITY DEFINER → RLS se v nich neuplatní. Každá si
--     řádek najde podle id, firmu a pobočku vezme Z ŘÁDKU a právo ověří
--     přes `app.has_access` na té pobočce.
--   * Kontakt hosta je ve vlastní tabulce `rezervace_kontakty` a čte ho
--     jen `rezervace.manage`. Číšník potřebuje vědět „Novák, 4 osoby,
--     19:00", ne Novákův telefon.
--   * Spouště `rezervace_pred_zapisem` a `rezervace_hlida_dite` jsou druhá
--     linie: pobočka patří firmě, poznámka/příloha/kontakt patří téže
--     firmě a pobočce jako jejich rezervace, rezervace se nestěhuje.
--
-- ---------------------------------------------------------------------
-- NAPOJENÍ NA REZERVAČNÍ SYSTÉM
--
--   Registr je společný `integrace_pripojeni` (20261003100000) — nová
--   oblast `rezervace`. Spravuje ho `integrace.manage` (to právo už od
--   7. 10. 2026 v popisku rezervace jmenuje). Dvě pojistky:
--     * připojení rezervací patří vždy jedné pobočce (rezervační systém
--       má účet za provozovnu; firemní připojení s mapováním provozoven
--       zatím nepotřebujeme a domýšlet ho nebudu);
--     * `stav = 'pripojeno'` jen s `posledni_test_ok = true`. Bez
--       ověřeného přístupu je připojení „čeká na připojení", nikdy
--       „připojeno" natvrdo (zadání Integrací, §2).
--   Zápis dat ze zdroje: `rezervace_importovat_zdroj` jen pro service_role
--   (synchronizace na serveru) a jen nad ověřeným připojením;
--   `rezervace_importovat_csv` pro člověka s `rezervace.manage`.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Žádný živý adaptér ani příjmové API (webhook) — bez přístupu
--     k dokumentaci konkrétního systému se tvar nevymýšlí. Kostra je
--     v lib/rezervace-*.ts a tahle migrace už umí, co adaptér potřebuje.
--   * Zápis zpátky do rezervačního systému ne (kontrakt: nejdřív jen čtení).
--   * Rezervace se nemaže, ruší se (`stav`). Kontakt jde vymazat úpravou.
--   * Kontakty se neaudituje (audit_log čte víc lidí než rezervace.manage
--     a telefony by se tam rozkopírovaly). Ostatní tabulky ano.
--   * Přílohy jen fotky a PDF — stejná sada jako Komunikace a Jiné platby.
--     Word/Excel by byly dva řádky (kbelík + check), otázka 59.
--   * Zálohy od hostů jsou jen evidence (částka a stav). Žádné platby
--     (banka je jen pro čtení) a nic společného s `advances` (zálohy
--     zaměstnancům) — proto `zaloha_hosta_*`, ne `zaloha_*`.
--   * Práva se dosavadním zaměstnancům nedosazují (majitel má vše
--     z aktivních modulů sám). Do zařazení u zákazníků se nesahá
--     (20260831010000, ř. 122–125); jen šablony pro nové firmy.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. OPRÁVNĚNÍ
--
-- Modul `provoz` (je vždy zapnutý). `rezervace.manage` je citlivé —
-- vidí kontakty hostů.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('rezervace.read',   'provoz', 'Vidět rezervace a kalendář akcí', false, 62),
  ('rezervace.manage', 'provoz', 'Zapisovat rezervace a akce, poznámky a přílohy; vidět kontakty hostů', true, 63)
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      sensitive = excluded.sensitive,
      sort_order = excluded.sort_order;

-- Jen šablony pro NOVÉ firmy (app.create_tenant z nich dělá kopii).
-- Vedoucí směny rezervace vidí, zapisuje provozní.
insert into app.role_template_permissions (template_key, permission_key) values
  ('provozni',      'rezervace.read'),
  ('provozni',      'rezervace.manage'),
  ('vedouci_smeny', 'rezervace.read')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- 2. REGISTR PŘIPOJENÍ — nová oblast `rezervace`
-- ---------------------------------------------------------------------

alter table public.integrace_pripojeni drop constraint integrace_pripojeni_oblast_check;
alter table public.integrace_pripojeni add constraint integrace_pripojeni_oblast_check
  check (oblast in ('pokladna', 'banka', 'ucetnictvi', 'email_dokladu', 'rezervace'));

alter table public.integrace_pripojeni add constraint integrace_pripojeni_rezervace_pobocka
  check (oblast <> 'rezervace' or branch_id is not null);

alter table public.integrace_pripojeni add constraint integrace_pripojeni_rezervace_overeno
  check (oblast <> 'rezervace' or stav <> 'pripojeno' or posledni_test_ok is true);

comment on constraint integrace_pripojeni_rezervace_overeno on public.integrace_pripojeni is
  'Připojení rezervací je „připojeno" jen po úspěšně ověřeném přístupu. '
  'Bez adaptéru a ověření zůstává „nepripojeno" = na obrazovce „čeká na připojení".';


-- ---------------------------------------------------------------------
-- 3. TABULKY
-- ---------------------------------------------------------------------

create table public.rezervace (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  branch_id           uuid not null references public.branches(id),

  -- `akce` = uzavřená společnost, firemní večírek, catering, svatba…
  -- Co přesně, říká `typ_akce` volným textem — typy akcí jsou data
  -- firmy, ne seznam v kódu (CLAUDE.md, pravidlo 1).
  druh                text not null default 'rezervace' check (druh in ('rezervace', 'akce')),
  -- Stejné hodnoty jako StavRezervace v lib/reservation-provider-contract.ts.
  -- `ceka` = předběžná / poptávka, ještě nepotvrzená.
  stav                text not null default 'potvrzeno'
                      check (stav in ('ceka', 'potvrzeno', 'dokonceno', 'zrusena', 'nedostavil_se')),
  -- Stav tak, jak ho poslal zdroj (TheFork „SEATED", Tablein „Waiting
  -- List"…). Adaptér ho převede na `stav`; původní zůstává vidět, ať se
  -- hodnota, kterou převod nezná, neztratí.
  stav_zdroje         text not null default '' check (char_length(stav_zdroje) <= 60),
  nazev             text not null default '' check (char_length(nazev) <= 120),
  jmeno_hosta         text not null default '' check (char_length(jmeno_hosta) <= 120),

  zacatek             timestamptz not null,
  konec               timestamptz check (konec is null or konec > zacatek),
  -- Provozní den pobočky, do kterého rezervace patří (rezervace v 1:30
  -- patří k večeru předtím). Počítá ho spoušť z `zacatek`, nikdy appka.
  den                 date not null,

  -- null = neznámé (poskytovatel údaj neposlal, poptávka bez počtu).
  pocet_osob          integer check (pocet_osob is null or pocet_osob between 1 and 10000),
  prostor             text not null default '' check (char_length(prostor) <= 120),
  typ_akce            text not null default '' check (char_length(typ_akce) <= 80),
  menu                text not null default '' check (char_length(menu) <= 4000),
  zaloha_hosta_haleru integer check (zaloha_hosta_haleru is null or zaloha_hosta_haleru between 0 and 100000000),
  zaloha_hosta_stav   text not null default 'zadna'
                      check (zaloha_hosta_stav in ('zadna', 'pozadovana', 'zaplacena', 'vracena')),
  -- Co napsal host do rezervačního systému. U ruční rezervace prázdné —
  -- poznámky obsluhy jsou v rezervace_poznamky.
  poznamka_zdroje     text not null default '' check (char_length(poznamka_zdroje) <= 4000),

  zdroj               text not null default 'rucne' check (zdroj in ('rucne', 'csv', 'externi')),
  poskytovatel        text check (poskytovatel is null or poskytovatel ~ '^[a-z0-9_-]{1,40}$'),
  pripojeni_id        uuid references public.integrace_pripojeni(id) on delete set null,
  externi_id          text check (externi_id is null or char_length(externi_id) between 1 and 200),
  externi_zmeneno_kdy timestamptz,
  importovano_kdy     timestamptz,

  -- Číslo odeslání formuláře nové rezervace. Dvojí ťuknutí nebo opakování
  -- po výpadku spojení (25. 10. 2026 se tak zdvojovaly zálohy) založí
  -- rezervaci jen jednou.
  klic_odeslani       uuid,

  vytvoril            uuid references public.employees(id) on delete set null,
  vytvoreno_kdy       timestamptz not null default now(),
  zmeneno_kdy         timestamptz not null default now(),

  -- Ruční řádek nemá zdroj; importovaný ho má celý.
  check ((zdroj = 'rucne') = (externi_id is null)),
  check ((zdroj = 'rucne') = (poskytovatel is null))
);

create unique index rezervace_externi
  on public.rezervace (tenant_id, branch_id, poskytovatel, externi_id)
  where externi_id is not null;

create index rezervace_den on public.rezervace (tenant_id, branch_id, den);

create unique index rezervace_klic_odeslani
  on public.rezervace (tenant_id, klic_odeslani)
  where klic_odeslani is not null;

comment on table public.rezervace is
  'Rezervace hostů a akce (uzavřené společnosti, catering). Zápis jen přes '
  'funkce rezervace_*. U importovaných řádků patří čas, počet, stav, jméno '
  'a kontakt zdroji; druh, název, typ akce, prostor, menu, záloha, poznámky '
  'a přílohy Foodtabu. Ruší se stavem, nemaže se.';
comment on column public.rezervace.zaloha_hosta_haleru is
  'Záloha OD HOSTA (evidence, ne platba). Nic společného s advances (zálohy zaměstnancům).';


create table public.rezervace_kontakty (
  rezervace_id  uuid primary key references public.rezervace(id),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id),
  telefon       text not null default '' check (char_length(telefon) <= 40),
  email         text not null default '' check (char_length(email) <= 254),
  zmeneno_kdy   timestamptz not null default now()
);

comment on table public.rezervace_kontakty is
  'Telefon a e-mail hosta k rezervaci. Čte jen rezervace.manage. Není to '
  'marketingový souhlas a neposílá se do jazykového modelu (CLAUDE.md, '
  'pravidlo 8). Neaudituje se.';


-- Poznámka nebo „další informace" (nadpis + text, např. „Alergie: lepek").
-- Visí buď na rezervaci, nebo na dni pobočky — nikdy na obojím.
create table public.rezervace_poznamky (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id),
  rezervace_id  uuid references public.rezervace(id),
  den           date,
  nadpis        text not null default '' check (char_length(nadpis) <= 80),
  obsah         text not null check (char_length(btrim(obsah)) between 1 and 4000),
  autor         uuid references public.employees(id) on delete set null,
  vytvoreno_kdy timestamptz not null default now(),
  zmeneno_kdy   timestamptz not null default now(),
  check ((rezervace_id is null) <> (den is null))
);

create index rezervace_poznamky_rezervace on public.rezervace_poznamky (rezervace_id) where rezervace_id is not null;
create index rezervace_poznamky_den on public.rezervace_poznamky (tenant_id, branch_id, den) where den is not null;


create table public.rezervace_prilohy (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id),
  rezervace_id  uuid references public.rezervace(id),
  den           date,
  cesta         text not null unique check (char_length(cesta) <= 300),
  nazev         text not null check (char_length(nazev) between 1 and 120),
  mime          text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  velikost      integer not null check (velikost > 0 and velikost <= 10485760),
  nahral        uuid references public.employees(id) on delete set null,
  nahrano       timestamptz not null default now(),
  check ((rezervace_id is null) <> (den is null))
);

create index rezervace_prilohy_rezervace on public.rezervace_prilohy (rezervace_id) where rezervace_id is not null;
create index rezervace_prilohy_den on public.rezervace_prilohy (tenant_id, branch_id, den) where den is not null;


-- ---------------------------------------------------------------------
-- 4. SPOUŠTĚ — druhá linie
-- ---------------------------------------------------------------------

create function app.rezervace_pred_zapisem()
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

  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id or new.branch_id <> old.branch_id then
      raise exception 'Rezervaci nejde přestěhovat na jinou pobočku — zrušte ji a založte novou.'
        using errcode = 'check_violation';
    end if;
    new.zmeneno_kdy := now();
  end if;

  new.den := app.business_date(new.branch_id, new.zacatek);
  return new;
end $$;

revoke all on function app.rezervace_pred_zapisem() from public, anon, authenticated;

create trigger trg_rezervace_pred_zapisem
  before insert or update on public.rezervace
  for each row execute function app.rezervace_pred_zapisem();


create function app.rezervace_hlida_dite()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  if new.rezervace_id is not null then
    select r.tenant_id, r.branch_id into v_tenant, v_branch
      from public.rezervace r where r.id = new.rezervace_id;
    if v_tenant is distinct from new.tenant_id or v_branch is distinct from new.branch_id then
      raise exception 'Záznam nesedí s firmou a pobočkou své rezervace.'
        using errcode = 'check_violation';
    end if;
  elsif not exists (
    select 1 from public.branches b
     where b.id = new.branch_id and b.tenant_id = new.tenant_id
  ) then
    raise exception 'Pobočka nepatří téhle firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.rezervace_hlida_dite() from public, anon, authenticated;

create trigger trg_rezervace_kontakty_hlida
  before insert or update on public.rezervace_kontakty
  for each row execute function app.rezervace_hlida_dite();
create trigger trg_rezervace_poznamky_hlida
  before insert or update on public.rezervace_poznamky
  for each row execute function app.rezervace_hlida_dite();
create trigger trg_rezervace_prilohy_hlida
  before insert or update on public.rezervace_prilohy
  for each row execute function app.rezervace_hlida_dite();

create trigger trg_audit_rezervace
  after insert or update or delete on public.rezervace
  for each row execute function app.audit_zmenu('rezervace');
create trigger trg_audit_rezervace_poznamky
  after insert or update or delete on public.rezervace_poznamky
  for each row execute function app.audit_zmenu('rezervace_poznamka');
create trigger trg_audit_rezervace_prilohy
  after insert or update or delete on public.rezervace_prilohy
  for each row execute function app.audit_zmenu('rezervace_priloha');


-- ---------------------------------------------------------------------
-- 5. RLS A GRANTY — čtení ano, zápis jen přes funkce
-- ---------------------------------------------------------------------

alter table public.rezervace enable row level security;
alter table public.rezervace_kontakty enable row level security;
alter table public.rezervace_poznamky enable row level security;
alter table public.rezervace_prilohy enable row level security;

revoke all on public.rezervace from public, anon, authenticated;
revoke all on public.rezervace_kontakty from public, anon, authenticated;
revoke all on public.rezervace_poznamky from public, anon, authenticated;
revoke all on public.rezervace_prilohy from public, anon, authenticated;

grant select on public.rezervace to authenticated;
grant select on public.rezervace_kontakty to authenticated;
grant select on public.rezervace_poznamky to authenticated;
grant select on public.rezervace_prilohy to authenticated;

-- Kdo smí zapisovat, smí i číst — jinak by provozní s jediným právem
-- `manage` zapsal rezervaci, kterou pak nevidí.
create policy rezervace_cist on public.rezervace for select to authenticated
  using (app.has_access(tenant_id, 'rezervace.read', branch_id)
         or app.has_access(tenant_id, 'rezervace.manage', branch_id));

create policy rezervace_kontakty_cist on public.rezervace_kontakty for select to authenticated
  using (app.has_access(tenant_id, 'rezervace.manage', branch_id));

create policy rezervace_poznamky_cist on public.rezervace_poznamky for select to authenticated
  using (app.has_access(tenant_id, 'rezervace.read', branch_id)
         or app.has_access(tenant_id, 'rezervace.manage', branch_id));

create policy rezervace_prilohy_cist on public.rezervace_prilohy for select to authenticated
  using (app.has_access(tenant_id, 'rezervace.read', branch_id)
         or app.has_access(tenant_id, 'rezervace.manage', branch_id));


-- ---------------------------------------------------------------------
-- 6. POMOCNÉ FUNKCE (jen pro funkce níž, zvenku je nikdo nevolá)
-- ---------------------------------------------------------------------

-- Hodina na zdi pobočky → okamžik (CLAUDE.md, pravidlo 11). `do` dřív
-- nebo rovno `od` znamená přes půlnoc (19:00–01:00).
create function app.rezervace_okamzik(p_branch uuid, p_datum date, p_cas time)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select (p_datum + p_cas) at time zone app.zona_pobocky(p_branch);
$$;

revoke all on function app.rezervace_okamzik(uuid, date, time) from public, anon, authenticated;

-- Okamžik od zdroje: jen s časovým pásmem. Řetězec bez pásma by se
-- přečetl v pásmu databáze (UTC) a rezervace by se posunula o hodinu
-- či dvě, aniž by to kdo poznal.
create function app.rezervace_okamzik_zdroje(p_text text, p_pole text)
returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  if btrim(p_text) !~ '(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    raise exception 'Údaj „%" nemá časové pásmo (%).', p_pole, p_text
      using errcode = 'check_violation';
  end if;
  return btrim(p_text)::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Údaj „%" není platný čas (%).', p_pole, p_text
      using errcode = 'check_violation';
end $$;

revoke all on function app.rezervace_okamzik_zdroje(text, text) from public, anon, authenticated;

-- Datum a čas z formuláře. Prázdné → null; nesmysl → česká hláška.
create function app.rezervace_datum(p_text text)
returns date
language plpgsql stable set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  if btrim(p_text) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Datum „%" nemá tvar RRRR-MM-DD.', p_text using errcode = 'check_violation';
  end if;
  return btrim(p_text)::date;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Datum „%" neexistuje.', p_text using errcode = 'check_violation';
end $$;

create function app.rezervace_hodina(p_text text)
returns time
language plpgsql stable set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  if btrim(p_text) !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Čas „%" nemá tvar HH:MM.', p_text using errcode = 'check_violation';
  end if;
  return btrim(p_text)::time;
end $$;

create function app.rezervace_cele_cislo(p_text text, p_pole text)
returns integer
language plpgsql immutable set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  if btrim(p_text) !~ '^[0-9]{1,9}$' then
    raise exception 'Údaj „%" musí být celé číslo (%).', p_pole, p_text using errcode = 'check_violation';
  end if;
  return btrim(p_text)::integer;
end $$;

revoke all on function app.rezervace_datum(text) from public, anon, authenticated;
revoke all on function app.rezervace_hodina(text) from public, anon, authenticated;
revoke all on function app.rezervace_cele_cislo(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. REZERVACE — uložit (ruční i úprava importované) a změnit stav
--
-- `p_udaje` (jsonb), všechno jako text:
--   druh, stav, nazev, jmeno_hosta, datum (RRRR-MM-DD), od, do (HH:MM),
--   pocet_osob, prostor, typ_akce, menu, zaloha_hosta_haleru,
--   zaloha_hosta_stav, telefon, email.
-- Klíč, který v `p_udaje` není, se u úpravy nemění.
-- ---------------------------------------------------------------------

create function public.rezervace_ulozit(
  p_tenant    uuid,
  p_rezervace uuid,
  p_branch    uuid,
  p_udaje     jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  -- Údaje, které u importované rezervace patří zdroji.
  c_zdrojove constant text[] := array['stav', 'datum', 'od', 'do', 'pocet_osob',
                                      'jmeno_hosta', 'telefon', 'email'];
  v_r       public.rezervace;
  v_nova    boolean := p_rezervace is null;
  v_tenant  uuid;
  v_branch  uuid;
  v_datum   date;
  v_od      time;
  v_do      time;
  v_zacatek timestamptz;
  v_konec   timestamptz;
  v_id      uuid;
  v_telefon text;
  v_email   text;
  v_klic    uuid;

begin
  if p_udaje is null or jsonb_typeof(p_udaje) <> 'object' then
    raise exception 'Chybí údaje rezervace.' using errcode = 'check_violation';
  end if;

  if v_nova then
    if p_branch is null or not app.has_access(p_tenant, 'rezervace.manage', p_branch) then
      raise exception 'Na téhle pobočce rezervace zapisovat nemůžete.'
        using errcode = 'insufficient_privilege';
    end if;
    v_tenant := p_tenant;
    v_branch := p_branch;

    -- Číslo odeslání. Totéž odeslání podruhé vrátí rezervaci z prvního —
    -- řeší to `on conflict` u zápisu níž, JEDINÉ místo (i pro dvě
    -- odeslání naráz). Právo se ptá PRVNÍ (výš), takže kdo ho nemá, se
    -- nedozví, že číslo existuje.
    if nullif(btrim(p_udaje ->> 'klic'), '') is not null then
      begin
        v_klic := btrim(p_udaje ->> 'klic')::uuid;
      exception when invalid_text_representation then
        raise exception 'Číslo odeslání nemá správný tvar.' using errcode = 'check_violation';
      end;
    end if;
  else
    select * into v_r from public.rezervace
     where id = p_rezervace and tenant_id = p_tenant
       for update;
    if not found or not app.has_access(v_r.tenant_id, 'rezervace.manage', v_r.branch_id) then
      raise exception 'Tuhle rezervaci upravit nemůžete.'
        using errcode = 'insufficient_privilege';
    end if;
    v_tenant := v_r.tenant_id;
    -- Jiná pobočka z formuláře se nezahodí potichu: spoušť ji odmítne.
    v_branch := coalesce(p_branch, v_r.branch_id);

    if v_r.zdroj <> 'rucne' and p_udaje ?| c_zdrojove then
      raise exception 'Čas, počet osob, stav, jméno a kontakt se u rezervace z rezervačního systému mění tam, ne ve Foodtabu.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Čas: u nové povinný, u úpravy jen když přišel.
  if v_nova or p_udaje ? 'datum' or p_udaje ? 'od' or p_udaje ? 'do' then
    v_datum := app.rezervace_datum(p_udaje ->> 'datum');
    v_od    := app.rezervace_hodina(p_udaje ->> 'od');
    v_do    := app.rezervace_hodina(p_udaje ->> 'do');
    if v_datum is null or v_od is null then
      raise exception 'Vyplňte datum a čas začátku.' using errcode = 'check_violation';
    end if;
    v_zacatek := app.rezervace_okamzik(v_branch, v_datum, v_od);
    if v_do is not null then
      v_konec := app.rezervace_okamzik(v_branch, v_datum + case when v_do <= v_od then 1 else 0 end, v_do);
    end if;
  else
    v_zacatek := v_r.zacatek;
    v_konec   := v_r.konec;
  end if;

  if v_nova then
    insert into public.rezervace (
      tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, konec, den,
      pocet_osob, prostor, typ_akce, menu, zaloha_hosta_haleru, zaloha_hosta_stav,
      zdroj, klic_odeslani, vytvoril
    ) values (
      v_tenant, v_branch,
      coalesce(nullif(btrim(p_udaje ->> 'druh'), ''), 'rezervace'),
      coalesce(nullif(btrim(p_udaje ->> 'stav'), ''), 'potvrzeno'),
      coalesce(btrim(p_udaje ->> 'nazev'), ''),
      coalesce(btrim(p_udaje ->> 'jmeno_hosta'), ''),
      v_zacatek, v_konec,
      -- `den` dopočítá spoušť; tady jen aby prošlo `not null`.
      app.business_date(v_branch, v_zacatek),
      app.rezervace_cele_cislo(p_udaje ->> 'pocet_osob', 'počet osob'),
      coalesce(btrim(p_udaje ->> 'prostor'), ''),
      coalesce(btrim(p_udaje ->> 'typ_akce'), ''),
      coalesce(btrim(p_udaje ->> 'menu'), ''),
      app.rezervace_cele_cislo(p_udaje ->> 'zaloha_hosta_haleru', 'záloha'),
      coalesce(nullif(btrim(p_udaje ->> 'zaloha_hosta_stav'), ''), 'zadna'),
      'rucne',
      v_klic,
      app.muj_employee(v_tenant)
    )
    on conflict (tenant_id, klic_odeslani) where klic_odeslani is not null do nothing
    returning id into v_id;

    -- Totéž číslo už je zapsané (dvojí ťuknutí, opakování po výpadku,
    -- nebo dvě odeslání naráz): vrátí se ta první rezervace. Číslo jiné
    -- pobočky se nevrací — to je chyba, ne opakování.
    if v_id is null then
      select r.id into v_id from public.rezervace r
       where r.tenant_id = v_tenant and r.klic_odeslani = v_klic and r.branch_id = v_branch;
      if v_id is null then
        raise exception 'Číslo odeslání patří jiné rezervaci.' using errcode = 'check_violation';
      end if;
      return v_id;
    end if;
  else
    update public.rezervace r set
      branch_id           = v_branch,
      druh                = case when p_udaje ? 'druh' then coalesce(nullif(btrim(p_udaje ->> 'druh'), ''), 'rezervace') else r.druh end,
      stav                = case when p_udaje ? 'stav' then coalesce(nullif(btrim(p_udaje ->> 'stav'), ''), r.stav) else r.stav end,
      nazev               = case when p_udaje ? 'nazev' then coalesce(btrim(p_udaje ->> 'nazev'), '') else r.nazev end,
      jmeno_hosta         = case when p_udaje ? 'jmeno_hosta' then coalesce(btrim(p_udaje ->> 'jmeno_hosta'), '') else r.jmeno_hosta end,
      zacatek             = v_zacatek,
      konec               = v_konec,
      pocet_osob          = case when p_udaje ? 'pocet_osob' then app.rezervace_cele_cislo(p_udaje ->> 'pocet_osob', 'počet osob') else r.pocet_osob end,
      prostor             = case when p_udaje ? 'prostor' then coalesce(btrim(p_udaje ->> 'prostor'), '') else r.prostor end,
      typ_akce            = case when p_udaje ? 'typ_akce' then coalesce(btrim(p_udaje ->> 'typ_akce'), '') else r.typ_akce end,
      menu                = case when p_udaje ? 'menu' then coalesce(btrim(p_udaje ->> 'menu'), '') else r.menu end,
      zaloha_hosta_haleru = case when p_udaje ? 'zaloha_hosta_haleru' then app.rezervace_cele_cislo(p_udaje ->> 'zaloha_hosta_haleru', 'záloha') else r.zaloha_hosta_haleru end,
      zaloha_hosta_stav   = case when p_udaje ? 'zaloha_hosta_stav' then coalesce(nullif(btrim(p_udaje ->> 'zaloha_hosta_stav'), ''), 'zadna') else r.zaloha_hosta_stav end
     where r.id = v_r.id
    returning r.id into v_id;
  end if;

  -- Kontakt (jen ruční rezervace — u importované sem nedojde, viz výš).
  -- Co nepřišlo, zůstává: úprava e-mailu nesmaže telefon.
  if p_udaje ? 'telefon' or p_udaje ? 'email' then
    select k.telefon, k.email into v_telefon, v_email
      from public.rezervace_kontakty k where k.rezervace_id = v_id;
    if p_udaje ? 'telefon' then
      v_telefon := coalesce(btrim(p_udaje ->> 'telefon'), '');
    end if;
    if p_udaje ? 'email' then
      v_email := lower(coalesce(btrim(p_udaje ->> 'email'), ''));
    end if;
    v_telefon := coalesce(v_telefon, '');
    v_email   := coalesce(v_email, '');
    if v_telefon = '' and v_email = '' then
      delete from public.rezervace_kontakty where rezervace_id = v_id;
    else
      insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon, email)
      values (v_id, v_tenant, v_branch, v_telefon, v_email)
      on conflict (rezervace_id) do update
        set telefon = excluded.telefon, email = excluded.email, zmeneno_kdy = now();
    end if;
  end if;

  return v_id;
end $$;

comment on function public.rezervace_ulozit(uuid, uuid, uuid, jsonb) is
  'Založí ruční rezervaci (p_rezervace null) nebo upraví existující. U '
  'importované odmítne údaje, které patří zdroji. rezervace.manage na pobočce.';

revoke all on function public.rezervace_ulozit(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.rezervace_ulozit(uuid, uuid, uuid, jsonb) to authenticated;


create function public.rezervace_zmenit_stav(p_rezervace uuid, p_stav text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_r public.rezervace;
begin
  select * into v_r from public.rezervace where id = p_rezervace for update;
  if not found or not app.has_access(v_r.tenant_id, 'rezervace.manage', v_r.branch_id) then
    raise exception 'Tuhle rezervaci upravit nemůžete.' using errcode = 'insufficient_privilege';
  end if;
  if v_r.zdroj <> 'rucne' then
    raise exception 'Stav rezervace z rezervačního systému se mění tam, ne ve Foodtabu.'
      using errcode = 'check_violation';
  end if;
  update public.rezervace set stav = p_stav where id = v_r.id;
end $$;

revoke all on function public.rezervace_zmenit_stav(uuid, text) from public, anon;
grant execute on function public.rezervace_zmenit_stav(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. POZNÁMKY (a „další informace" — poznámka s nadpisem)
-- ---------------------------------------------------------------------

-- Cíl poznámky/přílohy: buď rezervace (firma a pobočka z ní), nebo den
-- pobočky. Vrací firmu a pobočku; právo ověřuje volající.
create function app.rezervace_cil(p_tenant uuid, p_branch uuid, p_rezervace uuid, p_den date)
returns table (tenant_id uuid, branch_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (p_rezervace is null) = (p_den is null) then
    raise exception 'Záznam patří buď k rezervaci, nebo ke dni — vyberte jedno.'
      using errcode = 'check_violation';
  end if;
  if p_rezervace is not null then
    return query
      select r.tenant_id, r.branch_id from public.rezervace r
       where r.id = p_rezervace and r.tenant_id = p_tenant;
  else
    return query select p_tenant, p_branch where p_branch is not null;
  end if;
end $$;

revoke all on function app.rezervace_cil(uuid, uuid, uuid, date) from public, anon, authenticated;


create function public.rezervace_pridat_poznamku(
  p_tenant    uuid,
  p_branch    uuid,
  p_rezervace uuid,
  p_den       date,
  p_nadpis    text,
  p_obsah     text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_id     uuid;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from app.rezervace_cil(p_tenant, p_branch, p_rezervace, p_den) c;

  if v_tenant is null or not app.has_access(v_tenant, 'rezervace.manage', v_branch) then
    raise exception 'Sem poznámku přidat nemůžete.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.rezervace_poznamky (tenant_id, branch_id, rezervace_id, den, nadpis, obsah, autor)
  values (v_tenant, v_branch, p_rezervace, p_den,
          coalesce(btrim(p_nadpis), ''), btrim(coalesce(p_obsah, '')),
          app.muj_employee(v_tenant))
  returning id into v_id;
  return v_id;
end $$;

create function public.rezervace_upravit_poznamku(p_poznamka uuid, p_nadpis text, p_obsah text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_p public.rezervace_poznamky;
begin
  select * into v_p from public.rezervace_poznamky where id = p_poznamka for update;
  if not found or not app.has_access(v_p.tenant_id, 'rezervace.manage', v_p.branch_id) then
    raise exception 'Tuhle poznámku upravit nemůžete.' using errcode = 'insufficient_privilege';
  end if;
  update public.rezervace_poznamky
     set nadpis = coalesce(btrim(p_nadpis), ''), obsah = btrim(coalesce(p_obsah, '')), zmeneno_kdy = now()
   where id = v_p.id;
end $$;

create function public.rezervace_smazat_poznamku(p_poznamka uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_p public.rezervace_poznamky;
begin
  select * into v_p from public.rezervace_poznamky where id = p_poznamka for update;
  if not found or not app.has_access(v_p.tenant_id, 'rezervace.manage', v_p.branch_id) then
    raise exception 'Tuhle poznámku smazat nemůžete.' using errcode = 'insufficient_privilege';
  end if;
  -- Smazání zůstane v auditu i s textem (trg_audit_rezervace_poznamky).
  delete from public.rezervace_poznamky where id = v_p.id;
end $$;

revoke all on function public.rezervace_pridat_poznamku(uuid, uuid, uuid, date, text, text) from public, anon;
revoke all on function public.rezervace_upravit_poznamku(uuid, text, text) from public, anon;
revoke all on function public.rezervace_smazat_poznamku(uuid) from public, anon;
grant execute on function public.rezervace_pridat_poznamku(uuid, uuid, uuid, date, text, text) to authenticated;
grant execute on function public.rezervace_upravit_poznamku(uuid, text, text) to authenticated;
grant execute on function public.rezervace_smazat_poznamku(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 9. PŘÍLOHY — kbelík „rezervace"
--
-- Cesta <firma>/<pobočka>/<uuid>.<přípona>. Soubor jde z prohlížeče
-- rovnou do úložiště (serverová akce má strop 1 MB), pak ho funkce
-- připojí k rezervaci nebo ke dni. Typ a velikost bere z popisu, který
-- k souboru zapsalo úložiště, ne z toho, co tvrdí prohlížeč. Žádná
-- UPDATE politika — soubor pod vydaným odkazem se nesmí potichu změnit.
-- Bez `on conflict`: srážka jmen má spadnout nahlas.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rezervace', 'rezervace', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

create function app.rezervace_cesta(p_name text)
returns table (tenant_id uuid, branch_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_slozky text[] := storage.foldername(p_name);
begin
  if array_length(v_slozky, 1) is distinct from 2 then
    return;
  end if;
  if storage.filename(p_name) !~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then
    return;
  end if;
  begin
    tenant_id := v_slozky[1]::uuid;
    branch_id := v_slozky[2]::uuid;
  exception when invalid_text_representation then
    return;
  end;
  return next;
end $$;

comment on function app.rezervace_cesta(text) is
  'Firma a pobočka z cesty v kbelíku rezervace. Nesmyslná cesta vrací '
  'prázdno, ne výjimku (jinak by politika úložiště padala).';

revoke all on function app.rezervace_cesta(text) from public, anon;
grant execute on function app.rezervace_cesta(text) to authenticated, service_role;

create policy rezervace_soubory_cist on storage.objects for select to authenticated
  using (
    bucket_id = 'rezervace'
    and exists (
      select 1 from app.rezervace_cesta(storage.objects.name) c
       where app.has_access(c.tenant_id, 'rezervace.read', c.branch_id)
          or app.has_access(c.tenant_id, 'rezervace.manage', c.branch_id)));

create policy rezervace_soubory_nahrat on storage.objects for insert to authenticated
  with check (
    bucket_id = 'rezervace'
    and exists (
      select 1 from app.rezervace_cesta(storage.objects.name) c
       where app.has_access(c.tenant_id, 'rezervace.manage', c.branch_id)));

-- Smazat jde jen soubor, na který žádná příloha neukazuje (nepovedené
-- nahrání, nebo příloha, kterou někdo odebral).
create policy rezervace_soubory_smazat on storage.objects for delete to authenticated
  using (
    bucket_id = 'rezervace'
    and exists (
      select 1 from app.rezervace_cesta(storage.objects.name) c
       where app.has_access(c.tenant_id, 'rezervace.manage', c.branch_id))
    and not exists (select 1 from public.rezervace_prilohy p where p.cesta = storage.objects.name));


create function public.rezervace_pripojit_prilohu(
  p_tenant    uuid,
  p_branch    uuid,
  p_rezervace uuid,
  p_den       date,
  p_cesta     text,
  p_nazev     text,
  p_mime      text,
  p_velikost  integer
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_branch   uuid;
  v_c_tenant uuid;
  v_c_branch uuid;
  v_meta     jsonb;
  v_mime     text;
  v_velikost bigint;
  v_nazev    text;
  v_id       uuid;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from app.rezervace_cil(p_tenant, p_branch, p_rezervace, p_den) c;

  if v_tenant is null or not app.has_access(v_tenant, 'rezervace.manage', v_branch) then
    raise exception 'Sem přílohu přidat nemůžete.' using errcode = 'insufficient_privilege';
  end if;

  select c.tenant_id, c.branch_id into v_c_tenant, v_c_branch from app.rezervace_cesta(p_cesta) c;
  if v_c_tenant is distinct from v_tenant or v_c_branch is distinct from v_branch then
    raise exception 'Cesta k souboru nesedí s firmou a pobočkou.' using errcode = 'check_violation';
  end if;

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'rezervace' and o.name = p_cesta;
  if not found then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;

  -- Úložiště ke každému souboru zapisuje typ a velikost. Když je zná,
  -- rozhodují ony; prohlížeč s nimi musí souhlasit.
  v_mime := coalesce(v_meta ->> 'mimetype', p_mime);
  v_velikost := coalesce((v_meta ->> 'size')::bigint, p_velikost);
  if v_mime is distinct from p_mime or v_velikost is distinct from p_velikost::bigint then
    raise exception 'Soubor v úložišti je jiný, než jaký se nahrával.' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.rezervace_prilohy p
       where p.tenant_id = v_tenant and p.branch_id = v_branch
         and (p.rezervace_id = p_rezervace or p.den = p_den)) >= 20 then
    raise exception 'Sem lze připojit nejvýš 20 příloh.' using errcode = 'check_violation';
  end if;

  -- Název je jen popisek: bez lomítek (i zpětných; chr(92) je zpětné
  -- lomítko, zapsané takhle, aby ho nic po cestě nezkomolilo).
  v_nazev := left(btrim(translate(coalesce(p_nazev, ''), '/' || chr(92), '__')), 120);
  if v_nazev = '' then
    raise exception 'Příloha nemá název.' using errcode = 'check_violation';
  end if;

  insert into public.rezervace_prilohy
    (tenant_id, branch_id, rezervace_id, den, cesta, nazev, mime, velikost, nahral)
  values
    (v_tenant, v_branch, p_rezervace, p_den, p_cesta, v_nazev, v_mime, v_velikost::integer,
     app.muj_employee(v_tenant))
  returning id into v_id;
  return v_id;
end $$;

-- Odebere přílohu a vrátí cestu souboru — appka ho pak smaže z úložiště
-- (politika rezervace_soubory_smazat to dovolí, protože už na něj nic
-- neukazuje). Když se smazání souboru nepovede, zůstane sirotek; neškodí.
create function public.rezervace_odebrat_prilohu(p_priloha uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_p public.rezervace_prilohy;
begin
  select * into v_p from public.rezervace_prilohy where id = p_priloha for update;
  if not found or not app.has_access(v_p.tenant_id, 'rezervace.manage', v_p.branch_id) then
    raise exception 'Tuhle přílohu odebrat nemůžete.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.rezervace_prilohy where id = v_p.id;
  return v_p.cesta;
end $$;

revoke all on function public.rezervace_pripojit_prilohu(uuid, uuid, uuid, date, text, text, text, integer) from public, anon;
revoke all on function public.rezervace_odebrat_prilohu(uuid) from public, anon;
grant execute on function public.rezervace_pripojit_prilohu(uuid, uuid, uuid, date, text, text, text, integer) to authenticated;
grant execute on function public.rezervace_odebrat_prilohu(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 10. IMPORT — CSV od člověka, data ze zdroje od serveru
--
-- Řádek (jsonb, všechno jako text):
--   externi_id (povinné), stav, stav_zdroje, jmeno_hosta, telefon, email, poznamka,
--   prostor, pocet_osob,
--   čas buď `zacatek`/`konec` s pásmem (API), nebo `datum` + `od`/`do`
--   jako hodina na zdi pobočky (CSV),
--   zmeneno_kdy s pásmem (nepovinné; podle něj se přeskočí starší data).
-- Celá dávka je jedna transakce: nepovede-li se jeden řádek, nezapíše
-- se nic. Vrací {nove, zmenene, beze_zmeny, zastarale}.
-- ---------------------------------------------------------------------

create function app.rezervace_zapsat_radky(
  p_tenant       uuid,
  p_branch       uuid,
  p_zdroj        text,
  p_poskytovatel text,
  p_pripojeni    uuid,
  p_radky        jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_radek      jsonb;
  v_r          public.rezervace;
  v_k          public.rezervace_kontakty;
  v_ext        text;
  v_stav       text;
  v_stav_zdr   text;
  v_zacatek    timestamptz;
  v_konec      timestamptz;
  v_datum      date;
  v_od         time;
  v_do         time;
  v_pocet      integer;
  v_jmeno      text;
  v_telefon    text;
  v_email      text;
  v_poznamka   text;
  v_prostor    text;
  v_zmeneno    timestamptz;
  v_id         uuid;
  v_nove       integer := 0;
  v_zmenene    integer := 0;
  v_beze_zmeny integer := 0;
  v_zastarale  integer := 0;
begin
  if p_radky is null or jsonb_typeof(p_radky) <> 'array' then
    raise exception 'Import nemá žádné řádky.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_radky) > 2000 then
    raise exception 'Jedna dávka smí mít nejvýš 2000 rezervací.' using errcode = 'check_violation';
  end if;

  for v_radek in select * from jsonb_array_elements(p_radky)
  loop
    v_ext := btrim(coalesce(v_radek ->> 'externi_id', ''));
    if v_ext = '' then
      raise exception 'Rezervace bez čísla ze zdroje se importovat nedá.' using errcode = 'check_violation';
    end if;

    v_stav := coalesce(nullif(btrim(v_radek ->> 'stav'), ''), 'potvrzeno');
    v_stav_zdr := left(coalesce(btrim(v_radek ->> 'stav_zdroje'), ''), 60);

    if v_radek ? 'zacatek' then
      v_zacatek := app.rezervace_okamzik_zdroje(v_radek ->> 'zacatek', 'začátek');
      v_konec   := app.rezervace_okamzik_zdroje(v_radek ->> 'konec', 'konec');
    else
      v_datum := app.rezervace_datum(v_radek ->> 'datum');
      v_od    := app.rezervace_hodina(v_radek ->> 'od');
      v_do    := app.rezervace_hodina(v_radek ->> 'do');
      if v_datum is null or v_od is null then
        raise exception 'Rezervace % nemá datum a čas.', v_ext using errcode = 'check_violation';
      end if;
      v_zacatek := app.rezervace_okamzik(p_branch, v_datum, v_od);
      v_konec   := case when v_do is null then null
                        else app.rezervace_okamzik(p_branch, v_datum + case when v_do <= v_od then 1 else 0 end, v_do) end;
    end if;
    if v_zacatek is null then
      raise exception 'Rezervace % nemá začátek.', v_ext using errcode = 'check_violation';
    end if;

    v_pocet    := app.rezervace_cele_cislo(v_radek ->> 'pocet_osob', 'počet osob');
    v_jmeno    := left(coalesce(btrim(v_radek ->> 'jmeno_hosta'), ''), 120);
    v_telefon  := left(coalesce(btrim(v_radek ->> 'telefon'), ''), 40);
    v_email    := left(lower(coalesce(btrim(v_radek ->> 'email'), '')), 254);
    v_poznamka := left(coalesce(btrim(v_radek ->> 'poznamka'), ''), 4000);
    v_prostor  := left(coalesce(btrim(v_radek ->> 'prostor'), ''), 120);
    v_zmeneno  := app.rezervace_okamzik_zdroje(v_radek ->> 'zmeneno_kdy', 'změněno');

    select * into v_r from public.rezervace
     where tenant_id = p_tenant and branch_id = p_branch
       and poskytovatel = p_poskytovatel and externi_id = v_ext
       for update;

    if not found then
      insert into public.rezervace (
        tenant_id, branch_id, druh, stav, stav_zdroje, jmeno_hosta, zacatek, konec, den, pocet_osob,
        prostor, poznamka_zdroje, zdroj, poskytovatel, pripojeni_id, externi_id,
        externi_zmeneno_kdy, importovano_kdy
      ) values (
        p_tenant, p_branch, 'rezervace', v_stav, v_stav_zdr, v_jmeno, v_zacatek, v_konec,
        app.business_date(p_branch, v_zacatek), v_pocet,
        v_prostor, v_poznamka, p_zdroj, p_poskytovatel, p_pripojeni, v_ext,
        v_zmeneno, now()
      )
      returning id into v_id;

      if v_telefon <> '' or v_email <> '' then
        insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon, email)
        values (v_id, p_tenant, p_branch, v_telefon, v_email);
      end if;
      v_nove := v_nove + 1;
      continue;
    end if;

    -- Pozdě doručená starší verze nepřebije novější.
    if v_zmeneno is not null and v_r.externi_zmeneno_kdy is not null
       and v_zmeneno < v_r.externi_zmeneno_kdy then
      v_zastarale := v_zastarale + 1;
      continue;
    end if;

    select * into v_k from public.rezervace_kontakty where rezervace_id = v_r.id;

    if (v_r.stav, v_r.stav_zdroje, v_r.zacatek, v_r.konec, v_r.pocet_osob, v_r.jmeno_hosta, v_r.poznamka_zdroje)
         is not distinct from (v_stav, v_stav_zdr, v_zacatek, v_konec, v_pocet, v_jmeno, v_poznamka)
       and (coalesce(v_k.telefon, ''), coalesce(v_k.email, '')) = (v_telefon, v_email)
       and not (v_r.prostor = '' and v_prostor <> '')
       and v_r.zdroj = p_zdroj then
      v_beze_zmeny := v_beze_zmeny + 1;
      continue;
    end if;

    -- Údaje zdroje se přepíšou; to, co patří Foodtabu (druh, název, typ
    -- akce, menu, záloha, poznámky, přílohy), se nedotkne. Prostor jen
    -- doplní, když ho ve Foodtabu nikdo nevyplnil.
    update public.rezervace set
      stav                = v_stav,
      stav_zdroje         = v_stav_zdr,
      zacatek             = v_zacatek,
      konec               = v_konec,
      pocet_osob          = v_pocet,
      jmeno_hosta         = v_jmeno,
      poznamka_zdroje     = v_poznamka,
      prostor             = case when prostor = '' then v_prostor else prostor end,
      zdroj               = p_zdroj,
      pripojeni_id        = coalesce(p_pripojeni, pripojeni_id),
      externi_zmeneno_kdy = coalesce(v_zmeneno, externi_zmeneno_kdy),
      importovano_kdy     = now()
     where id = v_r.id;

    if v_telefon = '' and v_email = '' then
      delete from public.rezervace_kontakty where rezervace_id = v_r.id;
    else
      insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon, email)
      values (v_r.id, p_tenant, p_branch, v_telefon, v_email)
      on conflict (rezervace_id) do update
        set telefon = excluded.telefon, email = excluded.email, zmeneno_kdy = now();
    end if;
    v_zmenene := v_zmenene + 1;
  end loop;

  return jsonb_build_object('nove', v_nove, 'zmenene', v_zmenene,
                            'beze_zmeny', v_beze_zmeny, 'zastarale', v_zastarale);
end $$;

revoke all on function app.rezervace_zapsat_radky(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;


create function public.rezervace_importovat_csv(
  p_tenant       uuid,
  p_branch       uuid,
  p_poskytovatel text,
  p_radky        jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_branch is null or not app.has_access(p_tenant, 'rezervace.manage', p_branch) then
    raise exception 'Na téhle pobočce rezervace importovat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_poskytovatel is null or p_poskytovatel !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'Zdroj souboru musí být krátké jméno (malá písmena, číslice, pomlčka).'
      using errcode = 'check_violation';
  end if;
  return app.rezervace_zapsat_radky(p_tenant, p_branch, 'csv', p_poskytovatel, null, p_radky);
end $$;

comment on function public.rezervace_importovat_csv(uuid, uuid, text, jsonb) is
  'Import rezervací ze souboru (CSV převedené appkou na řádky). Páruje podle '
  '(pobočka, poskytovatel, externi_id); opakovaný import nic nezdvojí. '
  'rezervace.manage na pobočce.';

revoke all on function public.rezervace_importovat_csv(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.rezervace_importovat_csv(uuid, uuid, text, jsonb) to authenticated;


create function public.rezervace_importovat_zdroj(p_pripojeni uuid, p_radky jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_c public.integrace_pripojeni;
begin
  -- FOR SHARE: odpojení počká, až tahle dávka doběhne.
  select * into v_c from public.integrace_pripojeni
   where id = p_pripojeni and oblast = 'rezervace' and odpojeno_kdy is null
     for share;
  if not found then
    raise exception 'Připojení rezervací neexistuje nebo je odpojené.' using errcode = 'no_data_found';
  end if;
  -- Data jen z ověřeného připojení. `pripojeno` jinak než s úspěšným
  -- testem nastavit nejde (integrace_pripojeni_rezervace_overeno).
  if v_c.stav <> 'pripojeno' then
    raise exception 'Připojení rezervací ještě není ověřené.' using errcode = 'check_violation';
  end if;
  return app.rezervace_zapsat_radky(v_c.tenant_id, v_c.branch_id, 'externi', v_c.poskytovatel, v_c.id, p_radky);
end $$;

comment on function public.rezervace_importovat_zdroj(uuid, jsonb) is
  'Zápis rezervací z napojeného rezervačního systému (synchronizace na serveru). '
  'Jen ověřené připojení oblasti rezervace. Jen service_role.';

revoke all on function public.rezervace_importovat_zdroj(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rezervace_importovat_zdroj(uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 11. STAV NAPOJENÍ PRO OBRAZOVKU REZERVACÍ
--
-- Registr čte `finance.read`; kdo plánuje rezervace, Finance vidět
-- nemusí. Tahle funkce mu ukáže jen to, co potřebuje: jaký systém je
-- u pobočky napojený a v jakém stavu. Žádné tajemství, žádná chyba
-- poskytovatele (ta je pro správce v Integracích).
-- ---------------------------------------------------------------------

create function public.rezervace_napojeni(p_tenant uuid)
returns table (
  id                uuid,
  branch_id         uuid,
  poskytovatel      text,
  stav              text,
  nazev             text,
  posledni_test_kdy timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.branch_id, c.poskytovatel, c.stav, c.nazev, c.posledni_test_kdy
    from public.integrace_pripojeni c
   where c.tenant_id = p_tenant
     and c.oblast = 'rezervace'
     and c.odpojeno_kdy is null
     and (app.has_access(c.tenant_id, 'rezervace.read', c.branch_id)
          or app.has_access(c.tenant_id, 'rezervace.manage', c.branch_id)
          or app.has_access(c.tenant_id, 'integrace.manage', c.branch_id))
   order by c.vytvoreno_kdy;
$$;

revoke all on function public.rezervace_napojeni(uuid) from public, anon;
grant execute on function public.rezervace_napojeni(uuid) to authenticated;
