-- =====================================================================
-- Foodtab — Notification Service (Provozní centrum, etapa 1)
--
-- Zadání: noční zadání 20.–21. 9. 2026 („DOMAIN EVENT → NOTIFICATION
-- SERVICE → příjemce → priorita → pracovní doba → kanál → notification“).
-- Architektura: docs/COMMUNICATION_ARCHITECTURE.md, oddíl 2 a 3.
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace. Migrace jen PŘIDÁVÁ a přepojuje
-- tři producenty; data zpráv ani notifikací nepřepisuje.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ A PROČ
--
-- Dnes zakládá `notifications` třináct míst přímým insertem. Tahle
-- migrace zavádí JEDNO vstupní místo, `app.notifikovat`, a přepojuje na
-- něj tři producenty, u kterých to stojí za to:
--
--   * upozornit_na_vzkaz_trg   — nový vzkaz
--   * upozornit_na_oznameni_trg — nové oznámení na nástěnce
--   * upozornit_smenu           — nová / změněná / odebraná směna
--
-- Zbylých deset (rozpis.vydan, pozvánky, docházka, zálohy, PIN,
-- marketing, oprávnění) zůstává, jak je. Přepojit je znamená sáhnout do
-- cizích modulů; je to bezpečné dělat po jednom a v dokumentu je to
-- vedené jako otevřené.
--
-- V téže migraci se STARÝ přímý insert ODSTRAŇUJE. „Starý insert + nová
-- služba vedle něj“ by znamenalo dvě upozornění na jednu událost — a
-- scénář krok42 to hlídá počtem (přesně jedno na událost).
--
-- ---------------------------------------------------------------------
-- OPRAVY, KTERÉ SE PŘI TOM PODAŘÍ
--
--  1. Kanál pobočky a úseku upozorňuje i ty, kdo ho nikdy neotevřeli.
--     Dřív se cílilo jen na řádky v `konverzace_ucastnici`, ty se u
--     odvozených kanálů zakládají až při prvním otevření.
--  2. Druhá směna téhož dne už nesmaže upozornění na první (klíč
--     slučování je konkrétní směna, ne den).
--  3. `authenticated` smí u vlastních upozornění měnit jen `read_at` a
--     `acknowledged_at`. Dřív šlo přepsat `telo`, `druh` i `priorita`.
--
-- ---------------------------------------------------------------------
-- CO SE NEMĚNÍ — a je to schválně
--
-- „Na směně“ je pořád otevřený příchod v docházce (app.smena_ted),
-- právně zdůvodněný § 78 zákoníku práce (migrace 20260906010000). Tahle
-- migrace ho nedefinuje podruhé, jen volá app.doruci_se.
--
-- Záznam v aplikaci (`notifications`) vzniká vždy hned. Mimo pracovní
-- dobu čeká jen EXTERNÍ oznámení (push) — v aplikaci si člověk zprávy
-- přečíst smí (docs/komunikace-zadani.md).
--
-- ---------------------------------------------------------------------
-- POZOR PŘI DALŠÍCH ZMĚNÁCH
--
-- Těla tří přepojených funkcí vycházejí ze ŽIVÉ databáze
-- (pg_get_functiondef ze 21. 9. 2026), ne ze starších migrací.
-- Novější migrace už dvakrát přepsala objekt podle staršího stavu
-- (upozornit_smenu 16. 9., upozornit_na_oznameni_trg 17. 9.). Až se
-- na ně bude sahat znovu, vezmi opět živé znění.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. notifications: priorita low, zdroj, klíč slučování
-- ---------------------------------------------------------------------

alter table public.notifications
  drop constraint notifications_priorita_check;

alter table public.notifications
  add constraint notifications_priorita_check
  check (priorita in ('low', 'normal', 'important', 'urgent'));

comment on column public.notifications.priorita is
  'low / normal / important / urgent. low = tichý záznam (žádný push, '
  'nepočítá se do odznaku), normal = běžné, important = zvýrazněné, '
  'urgent = smí obejít čekání na pracovní dobu. Řídí i doručení '
  'externím kanálem (app.zaradit_doruceni).';

alter table public.notifications
  add column zdroj_typ text
    check (zdroj_typ is null or length(zdroj_typ) between 1 and 40),
  add column zdroj_id uuid,
  add column dedupe_key text
    check (dedupe_key is null or length(dedupe_key) between 1 and 200);

comment on column public.notifications.zdroj_typ is
  'Z čeho upozornění vzniklo (zprava, oznameni, smena, ukol). Slouží k '
  'odkazu zpět a k dohledání. Přes zdroj_id se text zprávy NEČTE — '
  'upozornění nese jen holé údaje.';
comment on column public.notifications.zdroj_id is
  'ID zdroje (zpráva, oznámení, směna, úkol). Bez cizího klíče: zdroj se '
  'smí smazat a upozornění má zůstat srozumitelné.';
comment on column public.notifications.dedupe_key is
  'Klíč slučování. Nepřečtené upozornění se STEJNÝM klíčem téhož člověka '
  'a firmy se nahradí novým (app.notifikovat). Prázdné = neslučuje se.';

create index notifications_dedupe
  on public.notifications (tenant_id, user_id, dedupe_key)
  where dedupe_key is not null and read_at is null;

-- ---------------------------------------------------------------------
-- 1b. Sloupcový grant.
--
-- Doteď měl `authenticated` UPDATE na CELÉ tabulce; politika hlídala
-- jen řádek (user_id = auth.uid()), ne sloupce. Člověk si mohl přepsat
-- telo, druh, prioritu i zdroj svých upozornění — potvrzení
-- (acknowledged_at) proto nebylo důvěryhodné a nový sloupec by si mohl
-- přepsat také. Aplikace mění jedině read_at a acknowledged_at
-- (upozorneni/akce.ts, smeny/potvrzeni.ts).
-- ---------------------------------------------------------------------

revoke update on public.notifications from authenticated;
grant update (read_at, acknowledged_at) on public.notifications to authenticated;


-- ---------------------------------------------------------------------
-- 2. Předplatné push a fronta doručení
--
-- Obě tabulky čte a zapisuje jen server (service_role) a definer
-- funkce. Klient nemá na nich žádné právo — v `push_odbery` leží klíče
-- zařízení (p256dh, auth) a ty se nesmí dostat do prohlížeče, ani do
-- cizího.
-- ---------------------------------------------------------------------

create table public.push_odbery (
  id                  uuid primary key default gen_random_uuid(),
  -- Zařízení patří člověku, ne firmě: jeden účet může být ve více firmách.
  user_id             uuid not null references public.profiles(user_id) on delete cascade,
  endpoint            text not null unique check (length(endpoint) between 10 and 2048),
  p256dh              text not null check (length(p256dh) between 10 and 256),
  auth_secret         text not null check (length(auth_secret) between 8 and 128),
  user_agent          text check (user_agent is null or length(user_agent) <= 300),
  created_at          timestamptz not null default now(),
  posledni_uspech_kdy timestamptz,
  vypnuto_kdy         timestamptz
);

create index push_odbery_uzivatel
  on public.push_odbery (user_id)
  where vypnuto_kdy is null;

alter table public.push_odbery enable row level security;
-- Záměrně žádná politika: klient tuhle tabulku nečte ani nezapisuje.

comment on table public.push_odbery is
  'Předplatné web push (jedno zařízení = jeden řádek). Zapisuje jen '
  'public.push_odber_ulozit / push_odber_zrusit a server. Bez politik RLS: '
  'klíče zařízení se nesmí dostat do prohlížeče.';

revoke all on public.push_odbery from anon, authenticated;
grant select, insert, update, delete on public.push_odbery to service_role;


create table public.notifikace_doruceni (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  -- Prázdné u souhrnu („Čekají na vás N zpráv“) a když se upozornění
  -- mezitím smazalo (nahrazeno novějším).
  notification_id uuid references public.notifications(id) on delete set null,
  typ             text not null default 'jedna' check (typ in ('jedna', 'souhrn')),
  -- Kolik zpráv za tím stojí (u slučovaných upozornění telo->>'pocet').
  pocet           integer not null default 1 check (pocet >= 1),
  kanal           text not null check (kanal in ('push')),
  stav            text not null default 'k_odeslani' check (stav in (
                    'ceka_na_smenu',   -- mimo pracovní dobu, čeká na příchod
                    'k_odeslani',      -- worker to může poslat
                    'odeslano',
                    'selhalo',
                    'nedostupny',      -- kanál není nakonfigurovaný (chybí klíče)
                    'sloucene',        -- pohlcené souhrnem
                    'zruseno'          -- nahrazené novějším nebo propadlé
                  )),
  created_at      timestamptz not null default now(),
  uvolneno_kdy    timestamptz,
  odeslano_kdy    timestamptz,
  pokusu          integer not null default 0 check (pokusu >= 0),
  chyba           text check (chyba is null or length(chyba) <= 500)
);

create index notifikace_doruceni_cekajici
  on public.notifikace_doruceni (stav, created_at)
  where stav in ('ceka_na_smenu', 'k_odeslani');
create index notifikace_doruceni_upozorneni
  on public.notifikace_doruceni (notification_id)
  where notification_id is not null;

alter table public.notifikace_doruceni enable row level security;

comment on table public.notifikace_doruceni is
  'Fronta doručení externím kanálem. Řádek vzniká v transakci zdroje '
  '(app.zaradit_doruceni), odesílá ho ale server MIMO transakci — selhání '
  'pošty nesmí shodit ulozit_smenu ani poslat_zpravu. Stav ceka_na_smenu = '
  'člověk není v práci; uvolní ho app.uvolnit_cekajici po příchodu.';

revoke all on public.notifikace_doruceni from anon, authenticated;
grant select, insert, update, delete on public.notifikace_doruceni to service_role;


-- ---------------------------------------------------------------------
-- 3. Zrušení nepřečtených se stejným klíčem
--
-- Jediné místo, které nepřečtená upozornění maže — a před smazáním
-- ruší jejich čekající doručení, ať po nich nezůstane push, který by
-- ukazoval na neexistující upozornění.
--
-- Vrací součet `telo->>'pocet'` (u upozornění bez počtu se počítá 1), aby
-- ho volající mohl přenést do nahrazujícího upozornění.
-- ---------------------------------------------------------------------

create or replace function app.zrusit_neprectene(
  p_tenant uuid,
  p_user   uuid,
  p_dedupe text
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ids   uuid[];
  v_pocet integer;
begin
  select coalesce(array_agg(n.id), '{}'::uuid[]),
         coalesce(sum(coalesce((n.telo->>'pocet')::integer, 1)), 0)::integer
    into v_ids, v_pocet
    from public.notifications n
   where n.tenant_id  = p_tenant
     and n.user_id    = p_user
     and n.dedupe_key = p_dedupe
     and n.read_at is null;

  if cardinality(v_ids) > 0 then
    update public.notifikace_doruceni d
       set stav = 'zruseno'
     where d.notification_id = any (v_ids)
       and d.stav in ('ceka_na_smenu', 'k_odeslani');

    delete from public.notifications n where n.id = any (v_ids);
  end if;

  return v_pocet;
end $$;

revoke all on function app.zrusit_neprectene(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. NOTIFICATION SERVICE
--
-- Vrací id vytvořeného upozornění, nebo NULL, když se nevytvořilo
-- (příjemce není aktivní člen firmy s účtem, nebo si kategorii vypnul).
-- Volající to nemusí vyhodnocovat.
--
-- DEFINER BEZ DRUHÉ LINIE. Uvnitř funkce neplatí RLS, takže firmu a
-- členství si hlídá sama (krok 1). Přepínače kategorií (vzkazy,
-- nástěnka) jsou tady, ne u producentů, ať se pravidlo nerozjede.
-- Směny se vypnout nedají a urgentní se nepotlačuje NIKDY — to je
-- strukturální (žádná větev, která by na to sáhla), ne shoda okolností.
-- ---------------------------------------------------------------------

create or replace function app.notifikovat(
  p_tenant          uuid,
  p_user            uuid,
  p_druh            text,
  p_telo            jsonb   default '{}'::jsonb,
  p_priorita        text    default 'normal',
  p_branch          uuid    default null,
  p_shift           uuid    default null,
  p_zdroj_typ       text    default null,
  p_zdroj_id        uuid    default null,
  p_dedupe          text    default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_priorita text := coalesce(p_priorita, 'normal');
  v_telo     jsonb := coalesce(p_telo, '{}'::jsonb);
  v_kategorie text;
  v_pocet    integer;
  v_id       uuid;
begin
  if p_tenant is null or p_user is null or coalesce(p_druh, '') = '' then
    return null;
  end if;

  -- Neznámá priorita se nepřijme potichu jako důležitá ani se nezahodí:
  -- z upozornění by zmizela kvůli překlepu. Bere se jako běžná.
  if v_priorita not in ('low', 'normal', 'important', 'urgent') then
    v_priorita := 'normal';
  end if;

  -- 1. PŘÍJEMCE: aktivní zaměstnanec téže firmy s účtem.
  if not exists (
    select 1
      from public.employees e
     where e.tenant_id  = p_tenant
       and e.user_id    = p_user
       and e.deleted_at is null
  ) then
    return null;
  end if;

  -- 2. PŘEPÍNAČE KATEGORIÍ. Urgentní se nepotlačuje; směny nemají kategorii.
  v_kategorie := case
    when p_druh like 'vzkaz.%'   then 'vzkazy'
    when p_druh like 'oznameni.%' then 'nastenka'
  end;

  if v_kategorie is not null
     and v_priorita <> 'urgent'
     and not app.upozorneni_povoleno(p_tenant, p_user, v_kategorie) then
    return null;
  end if;

  -- 4. SLUČOVÁNÍ: nepřečtené téhož klíče se nahradí novým.
  if p_dedupe is not null then
    v_pocet := app.zrusit_neprectene(p_tenant, p_user, p_dedupe);

    -- Počet zpráv se sčítá, jen když ho volající sám nese (telo.pocet).
    -- Priorita se NEsčítá: nahrazující upozornění nese AKTUÁLNÍ prioritu
    -- (rozhodnutí z kroku 35, oddíl 5 — jinak by odznak zůstal trvale
    -- poplašný po jediné naléhavé zprávě).
    if v_telo ? 'pocet' then
      v_telo := jsonb_set(
        v_telo, '{pocet}',
        to_jsonb(v_pocet + coalesce((v_telo->>'pocet')::integer, 1))
      );
    end if;
  end if;

  insert into public.notifications
    (tenant_id, user_id, branch_id, druh, telo, priorita, shift_id,
     zdroj_typ, zdroj_id, dedupe_key)
  values
    (p_tenant, p_user, p_branch, p_druh, v_telo, v_priorita, p_shift,
     p_zdroj_typ, p_zdroj_id, p_dedupe)
  returning id into v_id;

  -- 5.–6. KANÁL: záznam v aplikaci už je, teď případný push.
  perform app.zaradit_doruceni(v_id);

  return v_id;
end $$;

revoke all on function app.notifikovat(uuid, uuid, text, jsonb, text, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;

comment on function app.notifikovat(uuid, uuid, text, jsonb, text, uuid, uuid, text, uuid, text) is
  'Jediné vstupní místo pro upozornění (Notification Service). Producenti '
  '(triggery, RPC) ho volají v transakci zdroje; nikdo jiný nezakládá '
  'notifications přímo u druhů, které sem už přešly. Vrací id, nebo NULL.';


-- ---------------------------------------------------------------------
-- 5. KANÁL: co se stane s externím oznámením
--
-- Rozhoduje app.doruci_se — jediná funkce, která zná pravidlo
-- „naléhavé, nebo jen po příchodu“. Tady se nepíše podruhé.
--
--   low                      → žádný externí kanál
--   urgent                   → hned
--   jinak a člověk na směně  → hned
--   jinak                    → čeká na příchod (ceka_na_smenu)
--
-- Bez předplatného push se nezakládá nic — není komu posílat.
-- ---------------------------------------------------------------------

create or replace function app.zaradit_doruceni(p_notification uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_n     record;
  v_emp   uuid;
  v_smena uuid;
begin
  select n.id, n.tenant_id, n.user_id, n.priorita, n.telo
    into v_n
    from public.notifications n
   where n.id = p_notification;

  if not found or v_n.priorita = 'low' then
    return;
  end if;

  if not exists (
    select 1 from public.push_odbery o
     where o.user_id = v_n.user_id and o.vypnuto_kdy is null
  ) then
    return;
  end if;

  select e.id into v_emp
    from public.employees e
   where e.tenant_id  = v_n.tenant_id
     and e.user_id    = v_n.user_id
     and e.deleted_at is null
   limit 1;

  v_smena := app.smena_ted(v_n.tenant_id, v_emp);

  insert into public.notifikace_doruceni
    (tenant_id, user_id, notification_id, typ, pocet, kanal, stav)
  values (
    v_n.tenant_id,
    v_n.user_id,
    v_n.id,
    'jedna',
    greatest(coalesce((v_n.telo->>'pocet')::integer, 1), 1),
    'push',
    case
      -- Pobočka se nepředává: pro rušení telefonem je rozhodující, že je
      -- člověk v práci, ne kde (kanál pobočky se čte jen na té pobočce,
      -- to řeší čtení, ne oznámení).
      when app.doruci_se(v_smena, null, v_n.priorita = 'urgent') then 'k_odeslani'
      else 'ceka_na_smenu'
    end
  );
end $$;

revoke all on function app.zaradit_doruceni(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. PO PŘÍCHODU NA SMĚNU
--
-- Volá ji server pravidelně (service_role) — NE trigger na docházce.
-- Docházka je kritická a nesmí se kvůli oznámením nikdy zpomalit ani
-- zablokovat. Cena: mezi příchodem a odesláním může uplynout interval
-- plánovače. Uvnitř aplikace se čekající zprávy ukazují hned
-- (moje_rozhovory.ceka).
--
-- Kdo je v práci a má čekající: jedno čekající se pošle samo, víc se
-- sloučí do jednoho souhrnu („Čekají na vás N zpráv“) — jinak by po
-- příchodu přišla dávka pípnutí. Čekání starší než 48 hodin propadá:
-- zprávu z předvčerejška nemá smysl připomínat jako novinku (v
-- aplikaci zůstává).
--
-- Vrací počet lidí, kterým se čekání uvolnilo.
-- ---------------------------------------------------------------------

create or replace function app.uvolnit_cekajici(p_tenant uuid default null)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_u        record;
  v_emp      uuid;
  v_radku    integer;
  v_zprav    integer;
  v_uvolneno integer := 0;
begin
  update public.notifikace_doruceni d
     set stav = 'zruseno'
   where d.stav = 'ceka_na_smenu'
     and d.created_at < now() - interval '48 hours'
     and (p_tenant is null or d.tenant_id = p_tenant);

  for v_u in
    select distinct d.tenant_id, d.user_id
      from public.notifikace_doruceni d
     where d.stav = 'ceka_na_smenu'
       and (p_tenant is null or d.tenant_id = p_tenant)
  loop
    select e.id into v_emp
      from public.employees e
     where e.tenant_id  = v_u.tenant_id
       and e.user_id    = v_u.user_id
       and e.deleted_at is null
     limit 1;

    if v_emp is null
       or not app.doruci_se(app.smena_ted(v_u.tenant_id, v_emp), null, false) then
      continue;
    end if;

    select count(*)::integer, coalesce(sum(d.pocet), 0)::integer
      into v_radku, v_zprav
      from public.notifikace_doruceni d
     where d.tenant_id = v_u.tenant_id
       and d.user_id   = v_u.user_id
       and d.stav      = 'ceka_na_smenu';

    if v_radku = 1 then
      update public.notifikace_doruceni d
         set stav = 'k_odeslani', uvolneno_kdy = now()
       where d.tenant_id = v_u.tenant_id
         and d.user_id   = v_u.user_id
         and d.stav      = 'ceka_na_smenu';
    else
      update public.notifikace_doruceni d
         set stav = 'sloucene', uvolneno_kdy = now()
       where d.tenant_id = v_u.tenant_id
         and d.user_id   = v_u.user_id
         and d.stav      = 'ceka_na_smenu';

      insert into public.notifikace_doruceni
        (tenant_id, user_id, notification_id, typ, pocet, kanal, stav, uvolneno_kdy)
      values
        (v_u.tenant_id, v_u.user_id, null, 'souhrn', greatest(v_zprav, 1), 'push',
         'k_odeslani', now());
    end if;

    v_uvolneno := v_uvolneno + 1;
  end loop;

  return v_uvolneno;
end $$;

revoke all on function app.uvolnit_cekajici(uuid) from public, anon, authenticated;
grant execute on function app.uvolnit_cekajici(uuid) to service_role;

-- `app` schéma má pro service_role usage (foundation); funkce je vidět
-- jen přes RPC wrapper, protože PostgREST vystavuje `public`.
create or replace function public.uvolnit_cekajici_notifikace()
returns integer
language sql volatile security definer set search_path = ''
as $$
  select app.uvolnit_cekajici(null);
$$;

revoke all on function public.uvolnit_cekajici_notifikace() from public, anon, authenticated;
grant execute on function public.uvolnit_cekajici_notifikace() to service_role;

comment on function public.uvolnit_cekajici_notifikace() is
  'Pro plánovač (service_role): uvolní čekající externí oznámení lidem, '
  'kteří mezitím přišli do práce. Viz app.uvolnit_cekajici.';


-- ---------------------------------------------------------------------
-- 7. REGISTRACE ZAŘÍZENÍ (web push)
--
-- Volá přihlášený uživatel ze své aplikace. Zařízení, které už bylo
-- zapsané pod JINÝM účtem, se přepíše na nový účet: na sdíleném telefonu
-- nesmí upozornění jednoho člověka chodit tomu, kdo se tam přihlásil po
-- něm.
-- ---------------------------------------------------------------------

create or replace function public.push_odber_ulozit(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Nejste přihlášen(a).' using errcode = 'PT403';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Chybí údaje o zařízení.' using errcode = 'PT400';
  end if;

  insert into public.push_odbery (user_id, endpoint, p256dh, auth_secret, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id     = excluded.user_id,
        p256dh      = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        user_agent  = excluded.user_agent,
        vypnuto_kdy = null;
end $$;

revoke all on function public.push_odber_ulozit(text, text, text, text) from public, anon;
grant execute on function public.push_odber_ulozit(text, text, text, text) to authenticated;

create or replace function public.push_odber_zrusit(p_endpoint text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Nejste přihlášen(a).' using errcode = 'PT403';
  end if;

  update public.push_odbery o
     set vypnuto_kdy = now()
   where o.endpoint = p_endpoint
     and o.user_id  = v_user
     and o.vypnuto_kdy is null;
end $$;

revoke all on function public.push_odber_zrusit(text) from public, anon;
grant execute on function public.push_odber_zrusit(text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. PRODUCENT: nový vzkaz
--
-- Příjemci:
--   a) účastníci, kteří konverzaci opustili ne (odesel_kdy je null),
--   b) kanál POBOČKY: zaměstnanci s domovskou pobočkou té konverzace,
--   c) kanál ÚSEKU: zaměstnanci úseku.
-- Dřív jen (a) — kdo kanál nikdy neotevřel, nedostal nic.
--
-- Manažer nebo majitel, který na pobočku jen „vidí“ (rozsah členství),
-- se sem nepřidává: vidí kanál v seznamu, ale nepípá mu každá zpráva
-- každé pobočky. Do upozorňování se dostane tím, že kanál otevře
-- (řádek účastníka).
--
-- Kdo z kanálu odešel (odesel_kdy), neupozorňuje se ani jako člen
-- pobočky/úseku.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_konv record;
  v_rec  record;
begin
  select k.druh, k.branch_id, k.usek_id
    into v_konv
    from public.konverzace k
   where k.id = NEW.konverzace_id;

  for v_rec in
    select distinct e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       and (NEW.autor is null or e.id <> NEW.autor)
       and not exists (
         select 1 from public.konverzace_ucastnici ku
          where ku.konverzace_id = NEW.konverzace_id
            and ku.employee_id   = e.id
            and ku.odesel_kdy    is not null
       )
       and (
         exists (
           select 1 from public.konverzace_ucastnici ku
            where ku.konverzace_id = NEW.konverzace_id
              and ku.employee_id   = e.id
              and ku.odesel_kdy    is null
         )
         or (v_konv.druh = 'pobocka' and e.branch_id = v_konv.branch_id)
         or (v_konv.druh = 'usek'    and v_konv.usek_id is not null
             and e.usek_id = v_konv.usek_id)
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'vzkaz.novy',
      jsonb_build_object('den', v_den, 'pocet', 1),
      NEW.priorita,
      null,
      null,
      'zprava',
      NEW.id,
      'vzkaz.novy:' || v_den::text
    );
  end loop;

  return NEW;
end $$;


-- ---------------------------------------------------------------------
-- 9. PRODUCENT: nové oznámení na nástěnce
--
-- Adresáti a jejich pořadí (člověk > úsek > pozice > pobočka > firma)
-- zůstávají přesně jako v nasazené verzi. Mění se jen zápis: místo
-- vlastního delete + insert volá app.notifikovat (a přepínač kategorie
-- „nástěnka“ je tam). Oznámení s povinným potvrzením je důležité.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_oznameni_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.created_at at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       -- Vlastní oznámení neupozorňuje (C3/2): author_id = profiles.user_id.
       and (NEW.author_id is null or e.user_id <> NEW.author_id)
       -- Adresování: employee_id má nejvyšší prioritu, pak úsek, pozice,
       -- pobočka; null ve všech = celá firma.
       and (
         (NEW.employee_id  is not null and e.id          = NEW.employee_id)
         or (NEW.usek_id   is not null and e.usek_id     = NEW.usek_id
               and NEW.employee_id is null)
         or (NEW.position_id is not null and e.position_id = NEW.position_id
               and NEW.employee_id is null and NEW.usek_id is null)
         or (NEW.branch_id is not null
               and NEW.employee_id is null and NEW.usek_id is null and NEW.position_id is null
               and e.branch_id = NEW.branch_id)
         or (NEW.employee_id is null and NEW.usek_id is null
               and NEW.position_id is null and NEW.branch_id is null)
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'oznameni.nova',
      jsonb_build_object('den', v_den, 'pocet', 1),
      case when NEW.requires_acknowledgment then 'important' else 'normal' end,
      NEW.branch_id,
      null,
      'oznameni',
      NEW.id,
      'oznameni.nova:' || v_den::text
    );
  end loop;

  return NEW;
end $$;


-- ---------------------------------------------------------------------
-- 10. PRODUCENT: změna směny
--
-- Změny proti nasazenému znění:
--   * klíč slučování je KONKRÉTNÍ SMĚNA (u odebrané, která už id nemá,
--     den) — druhá směna téhož dne už první neshodí;
--   * „nejstarší původní stav“ se hledá podle směny, ne podle dne, takže
--     přesun směny na jiný den nezahodí, co bylo původně;
--   * zápis jde přes app.notifikovat.
--
-- Signatura se NEMĚNÍ (12 parametrů) — volá ji ulozit_smenu i
-- smazat_smenu a `create or replace` s jiným počtem parametrů by nechalo
-- dvě přetížení vedle sebe.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_smenu(
  p_tenant          uuid,
  p_user_id         uuid,
  p_branch_id       uuid,
  p_druh            text,
  p_den             date,
  p_od              time without time zone,
  p_do              time without time zone,
  p_smena           uuid default null,
  p_puvodni_den     date default null,
  p_puvodni_od      time without time zone default null,
  p_puvodni_do      time without time zone default null,
  p_puvodni_pobocka uuid default null
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni_den     date := p_puvodni_den;
  v_puvodni_od      time := p_puvodni_od;
  v_puvodni_do      time := p_puvodni_do;
  v_puvodni_pobocka uuid := p_puvodni_pobocka;
  v_nejstarsi       record;
  v_hodin           integer;
  v_zacatek         timestamptz;
  v_priorita        text := 'normal';
  v_klic            text;
  v_zmenil          text;
begin
  -- Kdo změnu provedl — do upozornění se píše jako „Změnil: …“ (zadání).
  -- Mimo přihlášeného (systémové změny) zůstane prázdné a věta se řekne bez něj.
  select e.full_name into v_zmenil
    from public.employees e
   where e.tenant_id  = p_tenant
     and e.user_id    = (select auth.uid())
     and e.deleted_at is null
   limit 1;

  -- Odebraná směna už nemá id — klíčem je den a začátek, ať dvě odebrané
  -- směny téhož dne (jiné hodiny) nenahradí jedna druhou.
  v_klic := p_druh || ':' || coalesce(
    p_smena::text,
    p_den::text || ':' || to_char(p_od, 'HH24:MI')
  );

  /*
    Slučování (C4): nepřečtená upozornění téhož druhu na TUTÉŽ SMĚNU se
    nahradí novým. U ZMĚNY se před smazáním přečte jejich NEJSTARŠÍ
    „původně“ — je to stav před celou sérií úprav. Bez toho by výsledek
    ukazoval jen poslední krok („09–17 → 10–18“) a zaměstnanec by nevěděl,
    co mu vlastně změnili oproti tomu, co si pamatuje.
  */
  if p_druh = 'smena.zmenena' and p_smena is not null then
    select (n.telo->>'puvodni_den')::date        as den,
           (n.telo->>'puvodni_od')::time         as od,
           (n.telo->>'puvodni_do')::time         as doo,
           (n.telo->>'puvodni_pobocka')::uuid    as pobocka
      into v_nejstarsi
      from public.notifications n
     where n.tenant_id      = p_tenant
       and n.user_id        = p_user_id
       and n.dedupe_key     = v_klic
       and n.read_at is null
       and n.telo ? 'puvodni_od'
     order by n.created_at asc
     limit 1;

    if found then
      v_puvodni_den     := v_nejstarsi.den;
      v_puvodni_od      := v_nejstarsi.od;
      v_puvodni_do      := v_nejstarsi.doo;
      v_puvodni_pobocka := v_nejstarsi.pobocka;
    end if;
  end if;

  /*
    Vrácení do původního stavu: den, čas i pobočka se rovnají tomu, co
    bylo před sérií úprav. Není o čem informovat — a upozornění o
    mezikroku by zůstalo viset, kdyby se tu nesmazalo, než se skončí.
  */
  if p_druh = 'smena.zmenena'
     and v_puvodni_od is not null
     and v_puvodni_den   is not distinct from p_den
     and v_puvodni_od    = p_od
     and v_puvodni_do    = p_do
     and v_puvodni_pobocka is not distinct from p_branch_id then
    perform app.zrusit_neprectene(p_tenant, p_user_id, v_klic);
    return;
  end if;

  /*
    Důležitost. Jen pro druhy, které mění, na co člověk spoléhá, a jen
    když firma pravidlo zapnula. Začátek se počítá v pásmu pobočky —
    „za tři hodiny“ nesmí záviset na tom, kde běží server.
  */
  if p_druh in ('smena.zmenena', 'smena.nova', 'smena.odebrana') then
    select s.smeny_dulezita_hodin into v_hodin
      from public.tenant_settings s
     where s.tenant_id = p_tenant;

    if v_hodin is not null then
      v_zacatek := (p_den + p_od) at time zone app.zona_pobocky(p_branch_id);
      if v_zacatek > now() and v_zacatek <= now() + make_interval(hours => v_hodin) then
        v_priorita := 'important';
      end if;
    end if;
  end if;

  perform app.notifikovat(
    p_tenant,
    p_user_id,
    p_druh,
    jsonb_strip_nulls(jsonb_build_object(
      'den', p_den,
      'od',  to_char(p_od, 'HH24:MI'),
      'do',  to_char(p_do, 'HH24:MI'),
      'puvodni_den',     v_puvodni_den,
      'puvodni_od',      to_char(v_puvodni_od, 'HH24:MI'),
      'puvodni_do',      to_char(v_puvodni_do, 'HH24:MI'),
      'puvodni_pobocka', v_puvodni_pobocka,
      'zmenil',          v_zmenil
    )),
    v_priorita,
    p_branch_id,
    p_smena,
    'smena',
    p_smena,
    v_klic
  );
end $$;
