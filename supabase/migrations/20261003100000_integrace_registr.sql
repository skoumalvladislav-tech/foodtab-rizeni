-- =====================================================================
-- Foodtab — Finance: obecný registr připojení k poskytovatelům
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 1A ("vytvoř
-- centrální registr providerů a úzké kontrakty pro POS, bank/platby,
-- účetní export..."). Plán: C:\Users\vladi\.claude\plans\proud-scribbling-glade.md,
-- oddíl "Finance a účetnictví — gastro ERP modul", migrace 1.
--
-- Marketing už má vlastní registr (marketing_pripojeni/marketing_tajemstvi,
-- 20260909220000_marketing_integrace.sql) — tahle migrace ho záměrně
-- nerozšiřuje. `marketing_pripojeni.kategorie` je uzavřený výčet jen pro
-- marketingové nástroje a marketing je jiný modul (pravidlo
-- `foodtab-marketing`: "do cizího modulu nesahej"). `integrace_pripojeni`
-- je proto samostatná tabulka pro budoucí POS/banka/účetnictví adaptéry,
-- se stejným (osvědčeným) tvarem, ne jeho rozšíření.
--
-- Oprávnění: `finance.read`/`finance.manage` existují v katalogu
-- (20260823120100_catalog.sql, modul `finance`) a dosud nejsou použité
-- nikde v kódu (ověřeno greppem) — žádné nové oprávnění se nezakládá.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PŘIPOJENÍ — metadata o tom, co je/není napojené. Nikdy tajemství.
-- ---------------------------------------------------------------------

create table public.integrace_pripojeni (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- null = platí pro celou firmu
  branch_id         uuid references public.branches(id) on delete cascade,

  oblast            text not null check (oblast in
                      ('pokladna', 'banka', 'ucetnictvi', 'email_dokladu')),
  poskytovatel      text not null,
  -- zakaznicky = vlastní klíč/přístup zadaný firmou; csv = ruční/CSV
  -- import bez živého API; demo = ukázková data pro vyzkoušení obrazovky.
  rezim             text not null check (rezim in ('zakaznicky', 'csv', 'demo')),

  stav              text not null default 'nepripojeno' check (stav in
                      ('nepripojeno', 'pripojuje_se', 'pripojeno',
                       'vyzaduje_pozornost', 'chyba', 'odpojeno')),
  nazev             text not null default '',

  -- Co o připojení řekl poskytovatel (jméno účtu, id provozovny v pokladně).
  -- Nikdy přístupový token/klíč — ten patří do integrace_tajemstvi.
  externi_ucet      jsonb not null default '{}'::jsonb,
  -- Capability mapa (zadání §1A): co tenhle konkrétní adaptér UMÍ —
  -- read/write, inkrementální sync, webhook/polling, limity. UI se podle
  -- ní řídí, ne podle toho, co poskytovatel obecně nabízí.
  capabilities      jsonb not null default '{}'::jsonb,

  posledni_test_kdy timestamptz,
  posledni_test_ok  boolean,
  posledni_chyba    text,

  pripojil          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  zmeneno_kdy       timestamptz not null default now(),
  odpojeno_kdy      timestamptz
);

comment on table public.integrace_pripojeni is
  'Obecný registr připojení k externím poskytovatelům (pokladna/banka/'
  'účetnictví). Odpojená zůstávají — dohledatelnost, kdy a proč skončila. '
  'Stav "pripojeno" se nastavuje jen po skutečně ověřeném připojení, '
  'nikdy předem (zadání §2: "čeká na připojení", nikdy "připojeno").';

-- JEDNO ŽIVÉ PŘIPOJENÍ na poskytovatele a rozsah — stejný vzor jako
-- marketing_pripojeni_zive (20260909220000_marketing_integrace.sql:94-97).
create unique index integrace_pripojeni_zive
  on public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel)
  nulls not distinct
  where odpojeno_kdy is null;

create index integrace_pripojeni_firma
  on public.integrace_pripojeni (tenant_id, oblast) where odpojeno_kdy is null;

alter table public.integrace_pripojeni enable row level security;

revoke all on public.integrace_pripojeni from anon;
revoke truncate, references, trigger on public.integrace_pripojeni from authenticated;
grant select, insert, update, delete on public.integrace_pripojeni to authenticated;

create policy integrace_pripojeni_select on public.integrace_pripojeni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));

create policy integrace_pripojeni_write on public.integrace_pripojeni for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

drop trigger if exists trg_audit_integrace_pripojeni on public.integrace_pripojeni;
create trigger trg_audit_integrace_pripojeni
  after insert or update or delete on public.integrace_pripojeni
  for each row execute function app.audit_zmenu('integrace_pripojeni');


-- ---------------------------------------------------------------------
-- TAJEMSTVÍ — zašifrované přístupové údaje. Stejný vzor jako
-- marketing_tajemstvi: `authenticated` na ni nemá ŽÁDNÉ oprávnění, čte/
-- píše se jen přes tři funkce níž, a NEaudituje se (šifra by se jinak
-- rozkopírovala do audit_log, který čte kdekdo).
-- ---------------------------------------------------------------------

create table public.integrace_tajemstvi (
  pripojeni_id  uuid primary key references public.integrace_pripojeni(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sifra         text not null,
  otisk         text not null,
  verze_klice   integer not null default 1,
  vytvoreno_kdy timestamptz not null default now(),
  rotovano_kdy  timestamptz
);

alter table public.integrace_tajemstvi enable row level security;

-- OPRAVA (ověřeno `scripts/provoz-granty.test.mjs`): na rozdíl od
-- `marketing_tajemstvi` (má výjimku v marketingové kontrole) tahle
-- tabulka spadá pod OBECNOU kontrolu provozních tabulek, která chce
-- výslovný `revoke`, ne spoléhání na to, že se `grant` pro `authenticated`
-- prostě nenapsal — výchozí práva Supabase by mu je i tak dala
-- (foodtab-db-security, "pojistka nesmí záviset na nenastavení").
-- Pořadí je důležité: revoke, až POTOM grant.
revoke all on public.integrace_tajemstvi from anon, authenticated;
grant select, insert, update, delete on public.integrace_tajemstvi to service_role;

-- NÁLEZ PŘI OVĚŘOVÁNÍ (mutačně izolováno v krok73_scenar.sql, přes
-- deset zúžených opakování se stejným výsledkem): `authenticated` bez
-- JAKÉHOKOLI grantu na tabulku (žádný select, insert, update, delete)
-- způsobuje, že i SECURITY DEFINER funkce (běžící jako vlastník, který
-- grant nepotřebuje) spadne na "permission denied for table" ve chvíli,
-- kdy do té tabulky zapisuje UPDATEm — pod PGlite, nepotvrzeno proti
-- reálnému Postgresu. INSERT a SELECT přes SECURITY DEFINER bez grantu
-- fungují; UPDATE ne. `public.advances` (20260901220000_zalohy.sql),
-- který má stejný vzor (has_access → update v SECURITY DEFINER funkci)
-- a prokazatelně funguje, má na rozdíl od původního pokusu tady
-- `authenticated` grant SELECT (byť na konkrétní sloupce) — i jen
-- SELECT grant (se zcela restriktivní politikou níž, nic skutečně
-- nevrátí) nález odstranil. Grant SELECT tu proto zůstává záměrně,
-- ne jako chyba — `authenticated` reálně nic nepřečte (politika
-- `using (false)`), ale potřebná strojová podmínka pro SECURITY
-- DEFINER UPDATE splněna je.
grant select on public.integrace_tajemstvi to authenticated;
create policy integrace_tajemstvi_bez_pristupu on public.integrace_tajemstvi
  for select to authenticated using (false);


/*
  ULOŽENÍ TAJEMSTVÍ. `security definer` — RLS se uvnitř NEUPLATNÍ, filtr
  na firmu si funkce dělá sama z `integrace_pripojeni`, ne z parametru
  volajícího (jinak by šlo uložit klíč do cizí firmy uhodnutím id).
*/
create or replace function app.integrace_uloz_tajemstvi(
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
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění ukládat přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.integrace_tajemstvi (pripojeni_id, tenant_id, sifra, otisk)
  values (p_pripojeni, v_tenant, p_sifra, p_otisk)
  on conflict (pripojeni_id) do update
    set sifra = excluded.sifra,
        otisk = excluded.otisk,
        verze_klice = public.integrace_tajemstvi.verze_klice + 1,
        rotovano_kdy = now();

  perform app.audit(v_tenant, 'finance.klic_ulozen', 'integrace_pripojeni',
                    p_pripojeni::text, v_branch, null,
                    jsonb_build_object('otisk', p_otisk));
end $$;

comment on function app.integrace_uloz_tajemstvi(uuid, text, text) is
  'Uloží zašifrované přístupové údaje k poskytovateli. Do auditu jde jen '
  'otisk — šifra nikdy.';

revoke all on function app.integrace_uloz_tajemstvi(uuid, text, text) from public, anon;
grant execute on function app.integrace_uloz_tajemstvi(uuid, text, text) to authenticated, service_role;


/*
  PŘEČTENÍ TAJEMSTVÍ. Vrací šifru, ne přístupový klíč — rozšifrovat umí
  jen server se šifrovacím klíčem z prostředí. Volá se při každém dotazu
  na poskytovatele, proto se NEAUDITUJE (statisíce řádků za týden by
  zastínily zajímavé události — uložení, smazání).
*/
create or replace function app.integrace_precti_tajemstvi(p_pripojeni uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_sifra  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění číst přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.sifra into v_sifra
    from public.integrace_tajemstvi t
   where t.pripojeni_id = p_pripojeni and t.tenant_id = v_tenant;

  return v_sifra;
end $$;

revoke all on function app.integrace_precti_tajemstvi(uuid) from public, anon;
grant execute on function app.integrace_precti_tajemstvi(uuid) to authenticated, service_role;


/*
  SMAZÁNÍ TAJEMSTVÍ PŘI ODPOJENÍ. Maže se doopravdy — co má zůstat
  (že tam něco bylo a kdy zmizelo) je v auditu, ne v databázi.
*/
create or replace function app.integrace_smaz_tajemstvi(p_pripojeni uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_otisk  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni;

  if v_tenant is null or not app.has_access(v_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění odpojit tohle připojení.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.otisk into v_otisk
    from public.integrace_tajemstvi t where t.pripojeni_id = p_pripojeni;

  delete from public.integrace_tajemstvi where pripojeni_id = p_pripojeni;

  perform app.audit(v_tenant, 'finance.klic_smazan', 'integrace_pripojeni',
                    p_pripojeni::text, v_branch,
                    jsonb_build_object('otisk', v_otisk), null);
end $$;

revoke all on function app.integrace_smaz_tajemstvi(uuid) from public, anon;
grant execute on function app.integrace_smaz_tajemstvi(uuid) to authenticated, service_role;
