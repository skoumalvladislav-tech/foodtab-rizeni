-- =====================================================================
-- Foodtab — Finance: napojení bankovního účtu (Fio token, kostra PSD2
-- agregátora), zůstatky jako snapshoty, zámek souběhu synchronizace,
-- a BEZPEČNÁ (souběh-odolná) alokace plateb na faktury
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md (noční), Šéfíkovo
-- doplnění 4. 10. 2026 (viz docs/Foodtab_bankovni_modul_Claude_Code.md,
-- dodané do repozitáře jako docs/bankovni-modul-zadani-2026-10-04.md) —
-- BankDataProvider kontrakt, víc bank/účtů přes vyměnitelné adaptéry,
-- zůstatky NIKDY jako „součet všech stažených pohybů", bezpečné
-- párování úhrad, import výpisů, napojení na cashflow.
--
-- ROZHODNUTÍ O POSKYTOVATELI (audit 4. 10. 2026): FoodTab není
-- licencovaný AISP u ČNB — přímé napojení na KB/ČSOB/ČS/Raiffeisenbank
-- appka nesmí dělat sama. Fio banka je výjimka (vlastní read-only
-- token, žádná licence navíc) — PLNĖ FUNKČNÍ adaptér
-- (`lib/integrace-fio.ts`, ověřeno proti FIO API BANKOVNICTVÍ v1.9,
-- 16.10.2025). Multibank agregátor pro ostatní banky (Finbricks
-- MULTIBANK / Enable Banking) zůstává KOSTRA, dokud nejsou k dispozici
-- obchodní přístupy — viz `docs/hlaseni/banka-poskytovatele-2026-10-04.md`.
--
-- ZŮSTATEK NIKDY ODVOZENÝ: `bankovni_zustatky` je append-only tabulka
-- snapshotů (jako banka/adaptér skutečně nahlásila), ne přepočet ze
-- sumy pohybů (`platebni_ucty.pocatecni_zustatek_haleru` z P0 ZŮSTÁVÁ,
-- ale `app.aktualni_zustatky_uctu` se od téhle migrace používá jen
-- jako DOPLŇKOVÝ odhad pro 13týdenní výhled, ne jako „aktuální
-- zůstatek" na obrazovce — ten čte `bankovni_zustatky`, nejnovější
-- snapshot, a řekne nahlas, jak je starý).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. INTEGRACE_PRIPOJENI — cíl pro synchronizaci + souhlas čtený
--    z poskytovatele, ne pevný počet dnů.
-- ---------------------------------------------------------------------

alter table public.integrace_pripojeni
  add column if not exists platebni_ucet_id uuid references public.platebni_ucty(id) on delete set null,
  add column if not exists posledni_sync_kdy timestamptz,
  add column if not exists posledni_sync_pocet_radku integer,
  -- Kdy vyprší souhlas/token podle TOHO, co řekl poskytovatel (Fio token
  -- expirace, GoCardless/Finbricks requisition validity) — NIKDY pevná
  -- konstanta v appce (zadání: „souhlasy... čti z provideru, ne z
  -- pevného počtu dnů").
  add column if not exists souhlas_platny_do timestamptz,
  -- Co přesně appka smí (rozsah PSD2 scope, nebo u Fio "sledování účtu"
  -- vs. "sledování a platby" — appka druhou volbu NIKDY nenabízí, ale
  -- zaznamenává si, co token skutečně umí, ne co appka předpokládá).
  add column if not exists rozsah_souhlasu jsonb not null default '{}'::jsonb;

comment on column public.integrace_pripojeni.platebni_ucet_id is
  'Cílový platební účet pro synchronizované transakce (jen oblast=banka). '
  'NULL = integrace bez cíle (jiná oblast, nebo bankovní připojení, '
  'které ještě nemá vybraný účet).';

comment on column public.integrace_pripojeni.souhlas_platny_do is
  'Kdy skutečně vyprší přístup — hodnota OD POSKYTOVATELE (Fio token '
  'expirace / PSD2 requisition validity), appka si nevymýšlí pevný '
  'počet dnů. NULL = neznámé/neověřené.';

-- Druhá linie obrany pro `platebni_ucet_id` (na rozdíl od `branch_id`,
-- jehož mezera je vědomě přijatá od P0 — mismatch tam nic neotvírá
-- v cizí firmě). Tady by mismatch znamenal, že naplánovaná synchronizace
-- zapíše TRANSAKCE cizí firmy do NAŠEHO účtu (nebo naopak) — skutečná
-- integrita dat, ne jen RLS mezera, proto dostává vlastní trigger.
create or replace function app.hlida_firmu_integrace_pripojeni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.platebni_ucet_id is not null and not exists (
    select 1 from public.platebni_ucty u
    where u.id = new.platebni_ucet_id and u.tenant_id = new.tenant_id
  ) then
    raise exception 'Platební účet nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_integrace_pripojeni() from public, anon, authenticated;

drop trigger if exists trg_firma_integrace_pripojeni on public.integrace_pripojeni;
create trigger trg_firma_integrace_pripojeni
  before insert or update of tenant_id, platebni_ucet_id on public.integrace_pripojeni
  for each row execute function app.hlida_firmu_integrace_pripojeni();

-- Nový typ importní dávky — automatická API synchronizace, ne CSV.
alter table public.import_davky drop constraint import_davky_typ_check;
alter table public.import_davky add constraint import_davky_typ_check
  check (typ in ('banka_csv', 'pokladna_csv', 'pokladna_prodeje_csv', 'fio_api', 'bankovni_agregator'));

-- `transakce.zdroj` — živá synchronizace má jiný zdroj než ruční CSV
-- import téže banky (appka musí umět odlišit, odkud řádek skutečně
-- přišel, viz `transaction_sources`/dedup v zadání oddíl 4).
alter table public.transakce drop constraint transakce_zdroj_check;
alter table public.transakce add constraint transakce_zdroj_check
  check (zdroj in ('rucni', 'csv_banka', 'csv_pokladna', 'pos_adapter', 'fio_api', 'bankovni_agregator'));


-- ---------------------------------------------------------------------
-- 2. BANKOVNÍ ZŮSTATKY — append-only snapshoty, NIKDY update. Book
--    (knihovní) a available (disponibilní) jsou dva ŘÁDKY, ne dva
--    sloupce jednoho — každý má svůj vlastní čas platnosti a appka je
--    nikdy nezamění (zadání: „Booked a available balance se nezaměňují").
--
--    Zůstatek SMÍ být záporný (kontokorent/přečerpání) — na rozdíl od
--    `transakce.castka_haleru`, který je vždycky kladný pohyb.
-- ---------------------------------------------------------------------

create table public.bankovni_zustatky (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  platebni_ucet_id    uuid not null references public.platebni_ucty(id) on delete cascade,
  typ                 text not null check (typ in ('knihovni', 'disponibilni')),
  castka_haleru       integer not null,
  mena                text not null default 'CZK',
  -- Kdy byl zůstatek platný PODLE BANKY (closingBalance k datu výpisu/
  -- pohledu) — NE kdy ho appka stáhla. Historický import nese starý
  -- `platny_k`, nikdy se nepředstírá jako aktuální (zadání: „Historický
  -- import nevytvoří falešný aktuální zůstatek").
  platny_k            timestamptz not null,
  zdroj               text not null check (zdroj in ('fio_api', 'csv', 'bankovni_agregator', 'rucni')),
  -- NE `on delete set null`: ta akce by potřebovala interní UPDATE na
  -- `bankovni_zustatky`, a ten beze zbytku blokuje
  -- `bankovni_zustatky_no_update` RULE výš (přesně stejná třída chyby
  -- jako `import_davka_id`/`zakazka_id` dřív v téhle práci —
  -- „referential integrity query ... gave unexpected result").
  integrace_pripojeni_id uuid references public.integrace_pripojeni(id) on delete restrict,
  stazeno_kdy         timestamptz not null default now()
);

comment on table public.bankovni_zustatky is
  'Append-only snapshoty zůstatku (knihovní/disponibilní), NIKDY přepočet '
  'ze sumy pohybů — appka zobrazuje nejnovější `platny_k` pro daný typ '
  'a nahlas řekne, jak je starý. Žádný UPDATE (rule níže), žádný DELETE '
  '(chybějící grant) — oprava je nový řádek, stejný vzor jako `transakce`.';

create index bankovni_zustatky_nejnovejsi
  on public.bankovni_zustatky (platebni_ucet_id, typ, platny_k desc);

create rule bankovni_zustatky_no_update as on update to public.bankovni_zustatky do instead nothing;

alter table public.bankovni_zustatky enable row level security;

revoke all on public.bankovni_zustatky from anon;
revoke update, truncate, references, trigger, delete on public.bankovni_zustatky from authenticated;
grant select, insert on public.bankovni_zustatky to authenticated;

create policy bankovni_zustatky_select on public.bankovni_zustatky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));

create policy bankovni_zustatky_insert on public.bankovni_zustatky for insert to authenticated
  with check (app.has_access(tenant_id, 'finance.manage', null));

create or replace function app.hlida_firmu_bankovni_zustatky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.platebni_ucty u
    where u.id = new.platebni_ucet_id and u.tenant_id = new.tenant_id
  ) then
    raise exception 'Platební účet nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.integrace_pripojeni_id is not null and not exists (
    select 1 from public.integrace_pripojeni c
    where c.id = new.integrace_pripojeni_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Integrace nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_bankovni_zustatky() from public, anon, authenticated;

create trigger trg_firma_bankovni_zustatky
  before insert on public.bankovni_zustatky
  for each row execute function app.hlida_firmu_bankovni_zustatky();


-- ---------------------------------------------------------------------
-- 3. SYNCHRONIZAČNÍ BĖHY — log + zámek souběhu. Partial unique index
--    dovolí NEJVÝŠ JEDEN běžící běh na jedno připojení — druhý
--    souběžný pokus (dva cron workery, restart uprostřed běhu) spadne
--    na unikátní index a appka ho tiše přeskočí (zadání: „Dva současně
--    běžící párovací/sync joby nepřiřadí/nezpracují jednu věc dvakrát").
--
--    Zaseknutý běh (worker spadl, nikdy nedoběhl do 'hotovo'/'chyba')
--    appka pozná podle stáří `zahajeno_kdy` a smí ho sama uzavřít jako
--    'chyba' (timeout) — řeší `app/api/uloha/banka-synchronizace`.
-- ---------------------------------------------------------------------

create table public.synchronizace_behy (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  integrace_pripojeni_id uuid not null references public.integrace_pripojeni(id) on delete cascade,
  zahajeno_kdy           timestamptz not null default now(),
  dokonceno_kdy          timestamptz,
  stav                   text not null default 'bezi' check (stav in ('bezi', 'hotovo', 'chyba')),
  pocet_novych_radku     integer,
  chyba                  text
);

comment on table public.synchronizace_behy is
  'Log + zámek souběhu synchronizace bankovního připojení. Partial '
  'unique index níž dovolí nejvýš JEDEN běžící („bezi") řádek na '
  'připojení — druhý souběžný pokus spadne na unikátní index.';

create unique index synchronizace_behy_jeden_bezici
  on public.synchronizace_behy (integrace_pripojeni_id)
  where stav = 'bezi';

create index synchronizace_behy_pripojeni on public.synchronizace_behy (integrace_pripojeni_id, zahajeno_kdy desc);

alter table public.synchronizace_behy enable row level security;

revoke all on public.synchronizace_behy from anon;
revoke truncate, references, trigger, delete on public.synchronizace_behy from authenticated;
grant select on public.synchronizace_behy to authenticated;
grant select, insert, update on public.synchronizace_behy to service_role;

create policy synchronizace_behy_select on public.synchronizace_behy for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', null));

-- `authenticated` čte (appka zobrazí „poslední sync proběhl…"), ale
-- NEzapisuje — synchronizaci spouští jen `service_role` (naplánovaná
-- úloha nebo manuální tlačítko, které zavolá STEJNOU server-only cestu,
-- ne přímý insert z klienta; zadání: „Manuální obnovení má respektovat
-- stejný rate limit" jako ten naplánovaný).


-- ---------------------------------------------------------------------
-- 4. BEZPEČNÁ ALOKACE PLATEB NA FAKTURY — `platby_faktury` dostal
--    v P0 jen INSERT přímo z klienta, bez ochrany proti souběhu a bez
--    kontroly, že alokace nepřesáhne částku platby/faktury. Od týdle
--    migrace jde INSERT jen přes tuhle funkci.
--
--    Souhrn alokací na STRANĖ TRANSAKCE appka ověří v DATABÁZI (obě
--    tabulky žijí tady). Souhrn na STRANĖ FAKTURY appka ověřit v
--    databázi NEMŮŽE (Faktury jsou v odděleném Supabase projektu,
--    žádný FK/join nejde postavit) — celkovou částku faktury a stav
--    dosavadních alokací proto volající (server akce) spočítá A PŘEDÁ
--    jako parametr. Souběh mezi dvěma takovými voláními řeší advisory
--    zámek (pg_advisory_xact_lock) na OBOU id, v pevném pořadí (menší
--    hash první) — druhé volání počká, až první dokončí transakci, a
--    uvidí JEHO zápis dřív, než provede svou vlastní kontrolu. Zámek
--    se uvolní automaticky na konci transakce (xact varianta).
-- ---------------------------------------------------------------------

revoke insert on public.platby_faktury from authenticated;

create or replace function app.potvrdit_alokaci_platby(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer,
  p_jistota                numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura   bigint := hashtextextended(p_faktura, 0);
  v_branch         uuid;
  v_castka_transakce integer;
  v_soucet_transakce integer;
  v_soucet_faktury   integer;
begin
  if p_castka_haleru <= 0 then
    raise exception 'Alokovaná částka musí být kladná.' using errcode = 'check_violation';
  end if;

  -- Pevné pořadí (menší hash první) — jediný způsob, jak dva zámky na
  -- různá id nikdy nezacyklí navzájem (deadlock), ať volání přijdou
  -- v jakémkoli pořadí.
  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant;

  if v_castka_transakce is null then
    raise exception 'Transakce nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění párovat platby.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(castka_haleru), 0) into v_soucet_transakce
    from public.platby_faktury
   where transakce_id = p_transakce and stav = 'potvrzeno';

  if v_soucet_transakce + p_castka_haleru > v_castka_transakce then
    raise exception 'Alokace přesahuje částku platby (% + % > %).',
      v_soucet_transakce, p_castka_haleru, v_castka_transakce using errcode = 'check_violation';
  end if;

  select coalesce(sum(castka_haleru), 0) into v_soucet_faktury
    from public.platby_faktury
   where faktura_id = p_faktura and tenant_id = p_tenant and stav = 'potvrzeno';

  if v_soucet_faktury + p_castka_haleru > p_castka_faktury_celkem then
    raise exception 'Alokace přesahuje nezaplacený zůstatek faktury (% + % > %).',
      v_soucet_faktury, p_castka_haleru, p_castka_faktury_celkem using errcode = 'check_violation';
  end if;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, jistota, stav, potvrzeno_kdy)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, p_jistota, 'potvrzeno', now());

  perform app.audit(p_tenant, 'finance.platba_alokovana', 'platby_faktury', p_faktura, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', p_castka_haleru));

  return query select (v_soucet_faktury + p_castka_haleru)::bigint, (v_soucet_faktury + p_castka_haleru) >= p_castka_faktury_celkem;
end $$;

comment on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) is
  'JEDINÁ cesta k zápisu potvrzené alokace — INSERT z klienta je od téhle '
  'migrace odepřený (revoke výš). Advisory zámek na transakci i faktuře '
  '(pevné pořadí) dělá kontrolu souběh-odolnou i přes to, že celková '
  'částka faktury žije v jiné databázi a musí ji dodat volající.';

revoke all on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) from public, anon;
grant execute on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) to authenticated;

create or replace function public.potvrdit_alokaci_platby(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer,
  p_jistota                numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean)
language sql security invoker set search_path = ''
as $$
  select * from app.potvrdit_alokaci_platby(p_tenant, p_transakce, p_faktura, p_castka_haleru, p_castka_faktury_celkem, p_jistota);
$$;

revoke all on function public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) from public, anon;
grant execute on function public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) to authenticated;


/*
  ZRUŠENÍ ALOKACE — vratné, s auditem (zadání: „Ruční potvrzení,
  rozdělení, zamítnutí a zrušení párování musí být vratné s auditem").
  Řádek se NEMAŽE (historie), `stav` jde na 'zamitnuto' — vrácená
  částka se tím automaticky uvolní pro další alokaci (součty výš čtou
  jen `stav = 'potvrzeno'`).
*/
create or replace function app.zrusit_alokaci_platby(p_tenant uuid, p_alokace uuid, p_duvod text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_faktura text;
begin
  select u.branch_id, p.faktura_id into v_branch, v_faktura
    from public.platby_faktury p
    join public.transakce t on t.id = p.transakce_id
    join public.platebni_ucty u on u.id = t.ucet_id
   where p.id = p_alokace and p.tenant_id = p_tenant;

  if v_faktura is null then
    raise exception 'Alokace nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění zrušit párování.' using errcode = 'insufficient_privilege';
  end if;

  update public.platby_faktury set stav = 'zamitnuto' where id = p_alokace;

  perform app.audit(p_tenant, 'finance.platba_zrusena', 'platby_faktury', v_faktura, v_branch,
                    jsonb_build_object('duvod', coalesce(p_duvod, '')), null);
end $$;

revoke all on function app.zrusit_alokaci_platby(uuid, uuid, text) from public, anon;
grant execute on function app.zrusit_alokaci_platby(uuid, uuid, text) to authenticated;

create or replace function public.zrusit_alokaci_platby(p_tenant uuid, p_alokace uuid, p_duvod text)
returns void
language sql security invoker set search_path = ''
as $$
  select app.zrusit_alokaci_platby(p_tenant, p_alokace, p_duvod);
$$;

revoke all on function public.zrusit_alokaci_platby(uuid, uuid, text) from public, anon;
grant execute on function public.zrusit_alokaci_platby(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. MOŽNÉ DUPLICITY MEZI ZDROJI — stejná částka/den/VS z JINÉHO zdroje
--    (API vs. CSV vs. budoucí agregátor) appka NIKDY sama neslučuje
--    (zadání: „Shodná částka, den a VS samy nesmí smazat dvě skutečně
--    různé platby") — jen OZNAČÍ k ruční kontrole. Člověk, který
--    potvrdí duplicitu, ji vyřeší STORNEM (`transakce.storno_of`,
--    existuje od P0) — ne mazáním, historie zůstává dohledatelná.
-- ---------------------------------------------------------------------

create or replace function app.mozne_duplicity_transakci(p_tenant uuid)
returns table (
  transakce_a uuid, transakce_b uuid,
  datum date, castka_haleru integer, vs text,
  zdroj_a text, zdroj_b text
)
language sql stable security definer set search_path = ''
as $$
  select a.id, b.id, a.datum, a.castka_haleru, a.vs, a.zdroj, b.zdroj
    from public.transakce a
    join public.transakce b
      on b.tenant_id = a.tenant_id
     and b.datum = a.datum
     and b.castka_haleru = a.castka_haleru
     and b.smer = a.smer
     and b.vs = a.vs
     and b.vs <> ''
     and b.zdroj <> a.zdroj
     and b.id > a.id
     and b.storno_of is null
   where a.tenant_id = p_tenant
     and a.storno_of is null
     and app.has_access(p_tenant, 'finance.read', null);
$$;

comment on function app.mozne_duplicity_transakci(uuid) is
  'Jen DETEKCE (stejné datum/částka/směr/VS z jiného zdroje) — appka '
  'nic neslučuje ani nemaže. Falešně pozitivní pár (dvě skutečně různé '
  'platby se shodným VS) je lidská kontrola, ne tichá ztráta.';

revoke all on function app.mozne_duplicity_transakci(uuid) from public, anon;
grant execute on function app.mozne_duplicity_transakci(uuid) to authenticated;

create or replace function public.mozne_duplicity_transakci(p_tenant uuid)
returns table (
  transakce_a uuid, transakce_b uuid,
  datum date, castka_haleru integer, vs text,
  zdroj_a text, zdroj_b text
)
language sql security invoker set search_path = ''
as $$
  select * from app.mozne_duplicity_transakci(p_tenant);
$$;

revoke all on function public.mozne_duplicity_transakci(uuid) from public, anon;
grant execute on function public.mozne_duplicity_transakci(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. SERVICE_ROLE GRANTY — naplánovaná úloha (app/api/uloha/
--    banka-synchronizace) běží BEZ přihlášeného uživatele, žádný
--    `auth.uid()` — RLS/`app.has_access` se neuplatní stejně jako u
--    člověka. Explicitní grant, ne spoléhání na ambientní bypassrls
--    (foodtab-db-security: „pojistka nesmí záviset na nenastavení" —
--    stejně tak funkčnost nesmí záviset na nedokumentovaném chování).
-- ---------------------------------------------------------------------

grant select, update on public.integrace_pripojeni to service_role;
grant select on public.integrace_tajemstvi to service_role; -- insert/update/delete už má od P0
grant select, insert on public.import_davky to service_role;
grant select, insert on public.bankovni_zustatky to service_role;
grant execute on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) to service_role;

comment on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) is
  'Hromadný zápis CSV/API importu s dedupem na (ucet_id, externi_id) přes '
  'anti-join, ne ON CONFLICT (transakce má pravidlo na UPDATE a '
  'PostgreSQL proto ON CONFLICT na ní odmítá úplně). Vrací počet '
  'skutečně vložených řádků. Volá ho `authenticated` (CSV import z '
  'obrazovky) i `service_role` (naplánovaná synchronizace bankovního '
  'účtu, app/api/uloha/banka-synchronizace) — RLS/druhá linie platí '
  'stejně v obou případech, service_role jen RLS neuplatní (bypassrls), '
  'ne že by obcházel kontrolu v těle funkce (žádná tu není, dedup je '
  'čistě datový).';
