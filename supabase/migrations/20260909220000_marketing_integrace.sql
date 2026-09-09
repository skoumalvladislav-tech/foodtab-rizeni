-- =====================================================================
-- Foodtab — modul Marketing, integrace: připojení, tajemství, účty
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
-- Navazuje na 20260909200000_marketing_obsah.sql.
--
--   1. podklady  — nastavení značky, média, šablony       hotovo
--   2. obsah     — příspěvky, verze, varianty, schvalování hotovo
--   3. integrace — připojení, tajemství, sociální účty     ← tahle
--   4. výstup    — render, publikační úlohy, publikace
--
-- Integrace jdou před výstupem schválně: publikační úloha se odkazuje
-- na účet, na který se posílá, a odkaz musí vést na existující tabulku.
--
-- ---------------------------------------------------------------------
-- ZÁKAZNICKÉ KLÍČE JSOU TO NEJCITLIVĚJŠÍ V CELÉM MODULU
--
-- Token k Instagramu firmy je horší ztráta než rozpis směn: kdo ho má,
-- publikuje jejím jménem. Proto:
--
--   * `marketing_tajemstvi` nemá pro roli `authenticated` ŽÁDNÉ
--     oprávnění. Ani majitel si ji nepřečte přímo — jen třemi funkcemi
--     níž, které se ptají na právo.
--   * Na téhle tabulce SCHVÁLNĚ NENÍ spoušť `app.audit_zmenu`.
--     Ta zapisuje změněné sloupce do `audit_log.before`/`after` —
--     zašifrovaný klíč by se tím rozkopíroval do tabulky, kterou čte
--     kdekdo. Audituje se z funkcí, a jen otisk.
--   * Ukládá se šifra a OTISK, nikdy čitelný klíč (pravidlo 7).
--     Šifrování dělá aplikace; databáze klíč nezná a znát nemá.
--
-- ---------------------------------------------------------------------
-- KDO SMÍ S PŘIPOJENÍM HÝBAT
--
-- `marketing.publish`. Je to totéž právo, které dovoluje na ten účet
-- publikovat — dávat tyhle dvě věci od sebe by znamenalo, že někdo smí
-- připojit účet, na který pak nesmí nic poslat, a naopak.
--
-- `marketing.read` stačí na to VIDĚT, že je účet připojený a v jakém
-- je stavu. Bez toho by obrazovka nemohla poctivě ukázat „Instagram
-- není připojený" a uživatel by nevěděl, proč se nic nepublikuje.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PŘIPOJENÍ
--
-- Jeden nástroj připojený firmou nebo pobočkou: Claude na texty,
-- Shotstack na video, Meta na publikování, n8n na automatizace.
--
-- `rezim` říká, ČÍ to je: zákaznický účet, účet Foodtabu, ruční export
-- (nic se neposílá, člověk to zveřejní sám) nebo demo.
-- ---------------------------------------------------------------------

create table public.marketing_pripojeni (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- null = platí pro celou firmu
  branch_id         uuid references public.branches(id) on delete cascade,

  poskytovatel      text not null,
  kategorie         text not null check (kategorie in
                      ('ai_text', 'render_obrazek', 'render_video',
                       'publikovani', 'automatizace', 'metriky')),
  rezim             text not null check (rezim in
                      ('zakaznicky', 'foodtab', 'rucni', 'demo')),

  stav              text not null default 'nepripojeno' check (stav in
                      ('nepripojeno', 'pripojuje_se', 'pripojeno',
                       'vyzaduje_pozornost', 'chyba', 'odpojeno')),
  nazev             text not null default '',

  -- Co o účtu řekl poskytovatel (jméno stránky, id profilu). Nikdy
  -- token — ten patří do marketing_tajemstvi.
  externi_ucet      jsonb not null default '{}'::jsonb,
  rozsahy           text[] not null default array[]::text[],
  plati_do          timestamptz,

  posledni_test_kdy timestamptz,
  posledni_test_ok  boolean,
  posledni_chyba    text,

  pripojil          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  zmeneno_kdy       timestamptz not null default now(),
  odpojeno_kdy      timestamptz
);

/*
  JEDNO ŽIVÉ PŘIPOJENÍ NA NÁSTROJ A ROZSAH.

  Odpojená zůstávají — je z nich vidět, že tam kdysi něco bylo a proč
  to skončilo. `nulls not distinct` znovu kvůli firemnímu rozsahu.
*/
create unique index marketing_pripojeni_zive
  on public.marketing_pripojeni (tenant_id, branch_id, poskytovatel)
  nulls not distinct
  where odpojeno_kdy is null;

create index marketing_pripojeni_firma
  on public.marketing_pripojeni (tenant_id, kategorie) where odpojeno_kdy is null;

alter table public.marketing_pripojeni enable row level security;

create policy marketing_pripojeni_select on public.marketing_pripojeni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_pripojeni_write on public.marketing_pripojeni for all to authenticated
  using (app.has_access(tenant_id, 'marketing.publish', branch_id))
  with check (app.has_access(tenant_id, 'marketing.publish', branch_id));

grant select, insert, update, delete on public.marketing_pripojeni to authenticated;

drop trigger if exists trg_audit_marketing_pripojeni on public.marketing_pripojeni;
create trigger trg_audit_marketing_pripojeni
  after insert or update or delete on public.marketing_pripojeni
  for each row execute function app.audit_zmenu('marketing_pripojeni');


-- ---------------------------------------------------------------------
-- TAJEMSTVÍ
--
-- Zašifrované přístupové údaje. Pro `authenticated` NIC: bez grantu
-- dostane přímý `select` chybu 42501 dřív, než se politika vůbec
-- zeptá na řádky. RLS je zapnutá jako druhá linie (pravidlo 3), i když
-- se k ní bez grantu nikdo nedostane.
-- ---------------------------------------------------------------------

create table public.marketing_tajemstvi (
  pripojeni_id  uuid primary key references public.marketing_pripojeni(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sifra         text not null,
  -- Otisk pro porovnání „je to pořád týž klíč?". Zpátky z něj klíč nejde.
  otisk         text not null,
  verze_klice   integer not null default 1,
  vytvoreno_kdy timestamptz not null default now(),
  rotovano_kdy  timestamptz
);

alter table public.marketing_tajemstvi enable row level security;

-- Žádný `grant … to authenticated`. Schválně. Servisní role má práva
-- z plošného grantu ve svých migracích; sem se chodí funkcemi.
grant select, insert, update, delete on public.marketing_tajemstvi to service_role;

-- A schválně tu NENÍ `app.audit_zmenu` — zapisuje změněné sloupce do
-- audit_log, takže by šifru rozkopírovala do tabulky, kterou čte
-- kdekdo. Audituje se ve funkcích níž, a jen otisk.


/*
  ULOŽENÍ KLÍČE.

  `security definer`, takže se uvnitř RLS NEUPLATNÍ VŮBEC (skill
  `migrace`, oddíl 5). Filtr na firmu si proto funkce musí udělat sama —
  bez `p_pripojeni` dohledaného přes tenant by šlo uložit klíč do cizí
  firmy jen tím, že se uhodne id.
*/
create or replace function app.marketing_uloz_tajemstvi(
  p_pripojeni uuid,
  p_sifra     text,
  p_otisk     text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.marketing_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'marketing.publish', v_branch) then
    raise exception 'Nemáte oprávnění ukládat přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.marketing_tajemstvi (pripojeni_id, tenant_id, sifra, otisk)
  values (p_pripojeni, v_tenant, p_sifra, p_otisk)
  on conflict (pripojeni_id) do update
    set sifra = excluded.sifra,
        otisk = excluded.otisk,
        verze_klice = public.marketing_tajemstvi.verze_klice + 1,
        rotovano_kdy = now();

  -- Do auditu jde OTISK, ne šifra.
  perform app.audit(v_tenant, 'marketing.klic_ulozen', 'marketing_pripojeni',
                    p_pripojeni::text, v_branch, null,
                    jsonb_build_object('otisk', p_otisk));
end $$;

comment on function app.marketing_uloz_tajemstvi(uuid, text, text) is
  'Uloží zašifrovaný zákaznický klíč. Do auditu jde jen otisk — šifra '
  'nikdy, jinak by se rozkopírovala do tabulky, kterou čte kdekdo.';

revoke all on function app.marketing_uloz_tajemstvi(uuid, text, text) from public, anon;
grant execute on function app.marketing_uloz_tajemstvi(uuid, text, text) to authenticated, service_role;


/*
  PŘEČTENÍ KLÍČE.

  Vrací šifru, ne klíč — rozšifrovat ji umí jen server, který má
  šifrovací klíč z prostředí. Čte se při každém volání poskytovatele,
  proto se to NEAUDITUJE: audit by za týden měl statisíce řádků a
  zajímavá událost (uložení, smazání) by v nich zanikla.
*/
create or replace function app.marketing_precti_tajemstvi(p_pripojeni uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_sifra  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.marketing_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'marketing.publish', v_branch) then
    raise exception 'Nemáte oprávnění číst přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.sifra into v_sifra
    from public.marketing_tajemstvi t
   where t.pripojeni_id = p_pripojeni and t.tenant_id = v_tenant;

  return v_sifra;
end $$;

revoke all on function app.marketing_precti_tajemstvi(uuid) from public, anon;
grant execute on function app.marketing_precti_tajemstvi(uuid) to authenticated, service_role;


/*
  SMAZÁNÍ KLÍČE PŘI ODPOJENÍ.

  Tady se maže doopravdy, ne označuje. Klíč, který už nemá platit, nemá
  co ležet v databázi — a co z něj má zůstat (že tam byl a kdy zmizel),
  je v auditu.
*/
create or replace function app.marketing_smaz_tajemstvi(p_pripojeni uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_otisk  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.marketing_pripojeni c
   where c.id = p_pripojeni;

  if v_tenant is null or not app.has_access(v_tenant, 'marketing.publish', v_branch) then
    raise exception 'Nemáte oprávnění odpojit tenhle účet.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.otisk into v_otisk
    from public.marketing_tajemstvi t where t.pripojeni_id = p_pripojeni;

  delete from public.marketing_tajemstvi where pripojeni_id = p_pripojeni;

  perform app.audit(v_tenant, 'marketing.klic_smazan', 'marketing_pripojeni',
                    p_pripojeni::text, v_branch,
                    jsonb_build_object('otisk', v_otisk), null);
end $$;

revoke all on function app.marketing_smaz_tajemstvi(uuid) from public, anon;
grant execute on function app.marketing_smaz_tajemstvi(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- SOCIÁLNÍ ÚČTY
--
-- Facebook stránka a profesionální Instagram účet, na které se
-- publikuje. Účet patří POBOČCE: Černá Perla a Bernard Bar mají každý
-- svůj profil, i když je firma jedna.
-- ---------------------------------------------------------------------

create table public.marketing_ucty (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete cascade,
  pripojeni_id      uuid not null references public.marketing_pripojeni(id) on delete cascade,

  sit               text not null check (sit in ('instagram', 'facebook')),
  -- stranka | ig_firemni | ig_tvurce
  druh              text not null,
  externi_id        text not null,
  nazev             text not null,
  uzivatelske_jmeno text,

  -- Co poskytovatel pro TENHLE účet opravdu povolil. Ne co umí obecně:
  -- Story přes API jde jen u profesionálních účtů a obrazovka to musí
  -- říct dřív, než člověk připraví něco, co nepůjde zveřejnit.
  schopnosti        text[] not null default array[]::text[],

  aktivni           boolean not null default true,
  vytvoreno_kdy     timestamptz not null default now()
);

create unique index marketing_ucty_externi
  on public.marketing_ucty (pripojeni_id, sit, externi_id);

create index marketing_ucty_pobocka
  on public.marketing_ucty (tenant_id, branch_id) where aktivni;

alter table public.marketing_ucty enable row level security;

create policy marketing_ucty_select on public.marketing_ucty for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_ucty_write on public.marketing_ucty for all to authenticated
  using (app.has_access(tenant_id, 'marketing.publish', branch_id))
  with check (app.has_access(tenant_id, 'marketing.publish', branch_id));

grant select, insert, update, delete on public.marketing_ucty to authenticated;

drop trigger if exists trg_audit_marketing_ucty on public.marketing_ucty;
create trigger trg_audit_marketing_ucty
  after insert or update or delete on public.marketing_ucty
  for each row execute function app.audit_zmenu('marketing_ucet');
