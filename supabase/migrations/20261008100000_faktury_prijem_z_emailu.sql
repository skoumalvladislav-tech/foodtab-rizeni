-- Příjem faktur z e-mailu — appka čte připojené schránky sama (náhrada n8n).
--
-- Rozhodnutí Šéfíka 7.–8. 10. 2026 (otázka 42 v docs/hlaseni/otazky.md):
-- appka čte schránky SAMA, faktury zapisuje do STÁVAJÍCÍ databáze Faktur
-- (jiný Supabase projekt, `invoices`) a zpracovává je PRŮBĚŽNĚ. n8n tam
-- naposledy zapsal 5. 9. 2026.
--
-- Tahle migrace staví jen to, co musí žít v NAŠÍ databázi:
--   * faktury_prijem          — evidence: jeden řádek na kandidátní
--                               přílohu, se stavem a důvodem (nic se
--                               nezahazuje potichu), a klíč, díky kterému
--                               opakované načtení nic nezdvojí;
--   * faktury_prijem_kurzory  — kde ve schránce appka skončila (UIDVALIDITY
--                               + poslední UID na složku);
--   * kbelík faktury-prilohy  — SOUKROMÉ úložiště příloh (n8n ukládal do
--                               veřejného kbelíku v projektu Faktur).
--
-- Zapisuje VÝHRADNĚ naplánovaná úloha (service_role). Přihlášený uživatel
-- jen čte, a to jen s `faktury.read` ve své firmě — evidence nese
-- odesílatele, předměty a přílohy faktur.
--
-- Druhá linie obrany (foodtab-db-security): `pripojeni_id` musí patřit
-- STEJNÉ firmě jako `tenant_id` řádku — i service_role kód může mít chybu.
-- =====================================================================


-- =====================================================================
-- EVIDENCE PŘÍJMU
-- =====================================================================

create table public.faktury_prijem (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  pripojeni_id     uuid not null references public.integrace_pripojeni(id),
  slozka           text not null check (char_length(slozka) between 1 and 200),
  uidvalidity      text not null check (uidvalidity ~ '^[0-9]{1,20}$'),
  uid              bigint not null check (uid > 0),
  message_id       text check (message_id is null or char_length(message_id) <= 998),
  prijato_kdy      timestamptz,
  odesilatel       text check (odesilatel is null or char_length(odesilatel) <= 320),
  predmet          text check (predmet is null or char_length(predmet) <= 1000),
  priloha_cast     text not null check (char_length(priloha_cast) between 1 and 64),
  priloha_nazev    text not null check (char_length(priloha_nazev) between 1 and 255),
  priloha_typ      text not null check (char_length(priloha_typ) between 1 and 127),
  priloha_velikost integer not null check (priloha_velikost >= 0),
  -- Prázdné u přílohy, která se nestahovala (už ji zapsal n8n, je moc
  -- velká, nepodporovaný typ) — otisk jde spočítat jen ze staženého obsahu.
  priloha_hash     text check (priloha_hash is null or priloha_hash ~ '^[0-9a-f]{64}$'),
  druh             text not null check (druh in ('pdf', 'obrazek', 'isdoc', 'nepodporovano')),
  -- Víc řádků smí ukazovat na týž soubor (cesta je otisk obsahu): třeba když
  -- se schránka odpojí a znovu připojí a nedokončené přílohy se zpracují znovu.
  soubor_cesta     text,
  stav             text not null default 'ceka'
                   check (stav in ('ceka', 'navrh', 'zapsano', 'existuje', 'duplicita',
                                   'neni_doklad', 'vyzaduje_kontrolu', 'chyba')),
  typ_dokladu      text check (typ_dokladu is null or typ_dokladu in (
                     'faktura', 'zalohova_faktura', 'dobropis', 'dodaci_list',
                     'upominka', 'jiny_doklad', 'neni_doklad')),
  vysledek         jsonb,
  zdroj_vytezeni   text check (zdroj_vytezeni is null or zdroj_vytezeni in ('isdoc', 'ai')),
  model            text,
  faktura_id       text check (faktura_id is null or char_length(faktura_id) <= 64),
  duvod            text check (duvod is null or char_length(duvod) <= 2000),
  pokusu           integer not null default 0 check (pokusu >= 0),
  vytvoreno_kdy    timestamptz not null default now(),
  zpracovano_kdy   timestamptz,

  -- Tatáž příloha téže zprávy v téže složce = jeden řádek, ať appka
  -- zprávu načte kolikrát chce (zadání: opakované načtení nesmí zdvojit).
  constraint faktury_prijem_jedinecna_priloha
    unique (pripojeni_id, slozka, uidvalidity, uid, priloha_cast)
);

create index faktury_prijem_hash_idx on public.faktury_prijem (tenant_id, priloha_hash);
create index faktury_prijem_fronta_idx on public.faktury_prijem (pripojeni_id, stav, vytvoreno_kdy);
create index faktury_prijem_prehled_idx on public.faktury_prijem (tenant_id, vytvoreno_kdy desc);

comment on table public.faktury_prijem is
  'Evidence příjmu faktur z e-mailu: jedna kandidátní příloha = jeden řádek '
  'se stavem a důvodem. Zapisuje jen naplánovaná úloha (service_role).';
comment on column public.faktury_prijem.faktura_id is
  'invoices.id v databázi Faktur (jiný projekt, proto text bez FK).';

alter table public.faktury_prijem enable row level security;

create policy faktury_prijem_select on public.faktury_prijem for select to authenticated
  using (app.can_read_scoped(tenant_id, 'faktury.read', null));

revoke all on public.faktury_prijem from public, anon, authenticated;
grant select on public.faktury_prijem to authenticated;
grant select, insert, update on public.faktury_prijem to service_role;


-- =====================================================================
-- KURZORY
-- =====================================================================

create table public.faktury_prijem_kurzory (
  pripojeni_id     uuid not null references public.integrace_pripojeni(id),
  slozka           text not null check (char_length(slozka) between 1 and 200),
  tenant_id        uuid not null references public.tenants(id),
  uidvalidity      text not null check (uidvalidity ~ '^[0-9]{1,20}$'),
  posledni_uid     bigint not null default 0 check (posledni_uid >= 0),
  -- Od kdy kurzor začal. Když člověk v nastavení posune „od" DŘÍV,
  -- kurzor se zahodí a schránka se projde znovu (duplicity chytí klíč).
  od               date not null,
  aktualizovano_kdy timestamptz not null default now(),
  primary key (pripojeni_id, slozka)
);

comment on table public.faktury_prijem_kurzory is
  'Kde příjem faktur ve schránce skončil. Posouvá se až po trvalém uložení '
  'evidence, nikdy dřív (zadání: kurzor až po uložení dat).';

alter table public.faktury_prijem_kurzory enable row level security;
-- Žádná politika pro authenticated: kurzor je vnitřní stav úlohy.

revoke all on public.faktury_prijem_kurzory from public, anon, authenticated;
grant select, insert, update, delete on public.faktury_prijem_kurzory to service_role;


-- =====================================================================
-- DRUHÁ LINIE: schránka musí patřit firmě řádku
-- =====================================================================

create or replace function app.hlida_firmu_prijmu_faktur()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.integrace_pripojeni p
     where p.id = new.pripojeni_id
       and p.tenant_id = new.tenant_id
       and p.oblast = 'email_dokladu'
  ) then
    raise exception 'Schránka % nepatří firmě % (nebo není e-mailová).', new.pripojeni_id, new.tenant_id
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_prijmu_faktur() from public, anon, authenticated;

create trigger trg_faktury_prijem_firma
  before insert or update of tenant_id, pripojeni_id on public.faktury_prijem
  for each row execute function app.hlida_firmu_prijmu_faktur();

create trigger trg_faktury_prijem_kurzory_firma
  before insert or update of tenant_id, pripojeni_id on public.faktury_prijem_kurzory
  for each row execute function app.hlida_firmu_prijmu_faktur();


-- =====================================================================
-- KBELÍK "faktury-prilohy" (soukromý)
-- =====================================================================
--
-- Cesta: `<tenant_id>/<sha256>.<pripona>` — obsah adresuje sám sebe,
-- stejná příloha se v jedné firmě uloží jednou. Nahrává jen service_role
-- (úloha); přihlášený s `faktury.read` smí soubor jen číst — odkaz ve
-- Fakturách vede přes /api/faktury/priloha, který vydá dočasný odkaz.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'faktury-prilohy',
  'faktury-prilohy',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/xml', 'text/xml']
);

-- Bezpečný rozbor cesty: nikdy nevyhodí výjimku (politika na
-- storage.objects se vyhodnocuje i nad cizími kbelíky a Postgres
-- nezaručuje pořadí podmínek — přetypování cizí cesty na uuid by
-- shodilo čtení všem).
create or replace function app.faktury_priloha_firma(p_cesta text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when p_cesta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(pdf|jpg|png|webp|xml)$'
    then split_part(p_cesta, '/', 1)::uuid
    else null
  end
$$;

grant execute on function app.faktury_priloha_firma(text) to authenticated, service_role;

create policy faktury_prilohy_select on storage.objects for select to authenticated
  using (
    bucket_id = 'faktury-prilohy'
    and app.can_read_scoped(app.faktury_priloha_firma(name), 'faktury.read', null));


-- =====================================================================
-- SCHRÁNKA PRO PŘÍJEM: server a jméno nejdou po připojení změnit,
-- nastavení příjmu jen přes public.faktury_prijem_nastavit
-- =====================================================================
--
-- Úloha příjmu se přihlašuje uloženým heslem na server z `externi_ucet`.
-- `authenticated` smí `integrace_pripojeni` měnit (politika chce jen
-- `integrace.manage`, sloupec `externi_ucet` potřebuje i banka) — bez
-- téhle pojistky by kdokoli s `integrace.manage` přepsal `host` na svůj
-- server a úloha by mu do půl hodiny poslala skutečné heslo schránky.
-- Proto: u e-mailové schránky jsou server, port, zabezpečení a jméno
-- po založení NEMĚNNÉ pro všechny (jiný server = odpojit a připojit
-- znovu, s novým heslem), a oblast se nedá přepnout ani tam, ani zpět.
--
-- Nastavení příjmu (`externi_ucet.prijem_dokladu`: zapnuto, AI souhlas,
-- režim) zapisuje do Faktur, takže chce i `faktury.manage`. Přímo jako
-- `authenticated` ho nezmění nikdo — jen funkce níž (security definer,
-- ověří obě práva a souhlas s AI zapíše s `auth.uid()` sama). Úloha
-- (service_role) nastavení nemění vůbec.

create or replace function app.hlida_schranku_prijmu()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stare_nastaveni jsonb;
begin
  if tg_op = 'UPDATE' then
    if (old.oblast = 'email_dokladu') is distinct from (new.oblast = 'email_dokladu') then
      raise exception 'Oblast e-mailové schránky nejde změnit.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.oblast <> 'email_dokladu' then
      return new;
    end if;
    if (new.externi_ucet -> 'host', new.externi_ucet -> 'port', new.externi_ucet -> 'zabezpeceni', new.externi_ucet -> 'uzivatel')
       is distinct from
       (old.externi_ucet -> 'host', old.externi_ucet -> 'port', old.externi_ucet -> 'zabezpeceni', old.externi_ucet -> 'uzivatel') then
      raise exception 'Server, port, zabezpečení ani jméno připojené schránky nejde změnit — schránku odpojte a připojte znovu.'
        using errcode = 'insufficient_privilege';
    end if;
    v_stare_nastaveni := old.externi_ucet -> 'prijem_dokladu';
  elsif new.oblast <> 'email_dokladu' then
    return new;
  end if;

  if current_user = 'authenticated'
     and (new.externi_ucet -> 'prijem_dokladu') is distinct from v_stare_nastaveni then
    raise exception 'Příjem faktur se nastavuje jen v appce (Integrace → E-mail).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function app.hlida_schranku_prijmu() from public, anon, authenticated;

create trigger trg_hlida_schranku_prijmu
  before insert or update on public.integrace_pripojeni
  for each row execute function app.hlida_schranku_prijmu();


create or replace function public.faktury_prijem_nastavit(p_pripojeni uuid, p_nastaveni jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ucet   jsonb;
  v_stare  jsonb;
  v_ai     boolean;
  v_nove   jsonb;
begin
  select c.tenant_id, c.externi_ucet into v_tenant, v_ucet
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.oblast = 'email_dokladu' and c.odpojeno_kdy is null
   for update;

  if v_tenant is null
     or not app.has_access(v_tenant, 'integrace.manage', null)
     or not app.has_access(v_tenant, 'faktury.manage', null) then
    raise exception 'Příjem faktur nastavuje ten, kdo smí spravovat integrace i Faktury za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_nastaveni) is distinct from 'object'
     or jsonb_typeof(p_nastaveni -> 'zapnuto') is distinct from 'boolean'
     or coalesce(p_nastaveni ->> 'rezim', '') not in ('nahled', 'automaticky')
     or coalesce(p_nastaveni ->> 'od', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(p_nastaveni -> 'ai' -> 'povoleno') is distinct from 'boolean' then
    raise exception 'Neplatné nastavení příjmu faktur.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Skutečný kalendářní den (2026-02-30 spadne na přetypování).
  perform (p_nastaveni ->> 'od')::date;

  v_stare := coalesce(v_ucet -> 'prijem_dokladu', '{}'::jsonb);
  v_ai := (p_nastaveni -> 'ai' ->> 'povoleno')::boolean;
  v_nove := jsonb_build_object(
    'zapnuto', p_nastaveni -> 'zapnuto',
    'od', p_nastaveni -> 'od',
    'slozky', coalesce(v_stare -> 'slozky', '["INBOX"]'::jsonb),
    'rezim', p_nastaveni -> 'rezim',
    -- Souhlas s AI: kdo a kdy podle přihlášení, ne podle toho, co přišlo.
    'ai', case
      when not v_ai then jsonb_build_object('povoleno', false, 'kdo', null, 'kdy', null)
      when v_stare -> 'ai' ->> 'povoleno' = 'true' and v_stare -> 'ai' ->> 'kdo' is not null then v_stare -> 'ai'
      else jsonb_build_object('povoleno', true, 'kdo', auth.uid()::text, 'kdy', now())
    end);

  update public.integrace_pripojeni
     set externi_ucet = jsonb_set(coalesce(v_ucet, '{}'::jsonb), '{prijem_dokladu}', v_nove)
   where id = p_pripojeni;

  return v_nove;
end
$$;

revoke all on function public.faktury_prijem_nastavit(uuid, jsonb) from public, anon;
grant execute on function public.faktury_prijem_nastavit(uuid, jsonb) to authenticated;
