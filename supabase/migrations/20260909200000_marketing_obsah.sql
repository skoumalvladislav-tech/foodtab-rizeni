-- =====================================================================
-- Foodtab — modul Marketing, obsah: příspěvky, verze, varianty,
-- schvalování
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
-- Navazuje na 20260909180000_marketing_podklady.sql.
--
--   1. podklady  — nastavení značky, média, šablony      hotovo
--   2. obsah     — příspěvky, verze, varianty, schvalování  ← tahle
--   3. výstup    — render, publikační úlohy, publikace
--
-- ---------------------------------------------------------------------
-- CO TAHLE MIGRACE VLASTNĚ HLÍDÁ
--
-- Jediné pravidlo, na kterém celý modul stojí: **bez schválení přesné
-- verze se nic nezveřejní.** Ne „schválili jsme ten příspěvek", ale
-- „schválili jsme TENHLE text s TOUHLE fotkou".
--
-- Kdyby to hlídala jen aplikace, stačilo by jedno špatné pořadí volání
-- a ven by šlo něco jiného, než co člověk viděl. Proto to drží
-- databáze, a to třemi spouštěmi:
--
--   1. verze je NEMĚNNÁ — co bylo schváleno, se nedá přepsat pod rukama,
--   2. nová verze RUŠÍ schválení — každá úprava vrací příspěvek zpátky
--      k člověku,
--   3. rozhodnutí se zapisuje na příspěvek spouští, ne aplikací — takže
--      `schvalena_verze_id` nejde nastavit „jen tak".
--
-- Publikační úlohu hlídá čtvrtá spoušť, ale ta patří až do třetí
-- migrace, kde ta tabulka vznikne.
--
-- ---------------------------------------------------------------------
-- OTISK VERZE
--
-- `otisk` je otisk OBSAHU verze, ne jejího id. Schválení se váže na
-- otisk, takže i kdyby se někdo dostal k `update` (nedostane, viz
-- spoušť 1), schválení by přestalo sedět. Počítá ho aplikace
-- z kanonického JSONu — v databázi se jen porovnává.
--
-- ---------------------------------------------------------------------
-- ROZSAH U DĚTÍ
--
-- Verze, varianty a schválení nemají vlastní `branch_id`. Pobočka je
-- vlastnost příspěvku a kopírovat ji dolů by znamenalo, že se ty dvě
-- hodnoty můžou rozejít. Politiky se místo toho ptají funkce
-- `app.marketing_prispevek_rozsah`, která vrátí firmu i pobočku
-- rodiče — a rovnou tím ověří, že dítě patří k rodiči téže firmy.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PŘÍSPĚVEK
--
-- Jedna připravovaná věc: „Denní menu na čtvrtek", „Pozvánka na
-- degustaci". Text a fotky v něm nejsou — ty jsou ve verzích.
-- ---------------------------------------------------------------------

create table public.marketing_prispevky (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- Příspěvek vždycky patří pobočce. Firemní příspěvek neexistuje:
  -- vždycky někdo zve k sobě, ne „do firmy".
  branch_id         uuid not null references public.branches(id) on delete cascade,

  sablona_id        uuid references public.marketing_sablony(id) on delete set null,
  nazev             text not null check (btrim(nazev) <> ''),
  ucel              text not null default 'atmosfera',
  pilir             text not null default 'menu',

  /*
    STAVY.

    `koncept` → `navrh_hotovy` → `ceka_na_schvaleni` → `schvaleno`
             → `naplanovano` → `zverejnuje_se` → `zverejneno`

    Vedle toho tři chybové (`navrh_selhal`, `render_selhal`,
    `publikace_selhala`), `zamitnuto` a `archivovano`.

    Přechody nehlídá omezení sloupce, ale spouště níž a ve třetí
    migraci — stavový automat zapsaný jako `check` se totiž nedá číst
    a při první změně ho stejně někdo obejde.
  */
  stav              text not null default 'koncept' check (stav in (
                      'koncept', 'navrh_hotovy', 'ceka_na_schvaleni', 'schvaleno',
                      'naplanovano', 'zverejnuje_se', 'zverejneno',
                      'zamitnuto', 'navrh_selhal', 'render_selhal', 'publikace_selhala',
                      'archivovano')),

  aktualni_verze_id uuid,
  schvalena_verze_id uuid,

  -- Kam to má jít a kdy. Čas je okamžik; hodinu na zdi převádí
  -- aplikace přes pásmo pobočky (CLAUDE.md, pravidlo 11).
  kanaly            text[] not null default array[]::text[],
  planovano_na      timestamptz,

  vytvoril          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  zmeneno_kdy       timestamptz not null default now()
);

create index marketing_prispevky_pobocka
  on public.marketing_prispevky (tenant_id, branch_id, stav, planovano_na);

alter table public.marketing_prispevky enable row level security;

create policy marketing_prispevky_select on public.marketing_prispevky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_prispevky_write on public.marketing_prispevky for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_prispevky to authenticated;

drop trigger if exists trg_audit_marketing_prispevky on public.marketing_prispevky;
create trigger trg_audit_marketing_prispevky
  after insert or update or delete on public.marketing_prispevky
  for each row execute function app.audit_zmenu('marketing_prispevek');


-- ---------------------------------------------------------------------
-- ROZSAH RODIČE
--
-- `security definer` schválně: politiky dětí se na tuhle funkci
-- odkazují a kdyby četla `marketing_prispevky` pod RLS, zacyklilo by
-- se to. Uvnitř se RLS neuplatní vůbec (skill `migrace`, oddíl 5),
-- takže si volající musí porovnat firmu sám — a politiky níž to dělají.
-- ---------------------------------------------------------------------

create or replace function app.marketing_prispevek_rozsah(p_prispevek uuid)
returns table (tenant_id uuid, branch_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.tenant_id, p.branch_id
    from public.marketing_prispevky p
   where p.id = p_prispevek;
$$;

comment on function app.marketing_prispevek_rozsah(uuid) is
  'Firma a pobočka příspěvku. Politiky verzí, variant a schválení se '
  'ptají jí místo toho, aby si pobočku kopírovaly k sobě — dvě kopie '
  'téhož údaje se rozejdou.';

revoke all on function app.marketing_prispevek_rozsah(uuid) from public, anon;
grant execute on function app.marketing_prispevek_rozsah(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- VERZE
--
-- Každá úprava zakládá novou verzi. Verze se NIKDY nepřepisuje —
-- viz spoušť níž.
-- ---------------------------------------------------------------------

create table public.marketing_verze (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  prispevek_id      uuid not null references public.marketing_prispevky(id) on delete cascade,

  cislo             integer not null check (cislo > 0),

  zadani            text not null default '',
  vstupy            jsonb not null default '{}'::jsonb,
  navrh_ai          jsonb,
  vybrana_varianta  text,
  texty             jsonb not null default '{}'::jsonb,
  storyboard        jsonb,
  media_ids         uuid[] not null default array[]::uuid[],
  titulni_media_id  uuid references public.marketing_media(id) on delete set null,

  -- Otisk obsahu verze. Schválení se váže na něj, ne na id.
  otisk             text not null,
  poznamka          text not null default '',

  ai_model          text,
  ai_verze_zadani   text,

  vytvoril          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now()
);

create unique index marketing_verze_cislo
  on public.marketing_verze (prispevek_id, cislo);

alter table public.marketing_prispevky
  add constraint marketing_prispevky_aktualni_fk
  foreign key (aktualni_verze_id) references public.marketing_verze(id) on delete set null;
alter table public.marketing_prispevky
  add constraint marketing_prispevky_schvalena_fk
  foreign key (schvalena_verze_id) references public.marketing_verze(id) on delete set null;

alter table public.marketing_verze enable row level security;

create policy marketing_verze_select on public.marketing_verze for select to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_verze.tenant_id
       and app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

create policy marketing_verze_write on public.marketing_verze for all to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_verze.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)))
  with check (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_verze.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));

grant select, insert, update, delete on public.marketing_verze to authenticated;

drop trigger if exists trg_audit_marketing_verze on public.marketing_verze;
create trigger trg_audit_marketing_verze
  after insert or update or delete on public.marketing_verze
  for each row execute function app.audit_zmenu('marketing_verze');


-- ---------------------------------------------------------------------
-- SPOUŠŤ 1 — VERZE JE NEMĚNNÁ
--
-- Kdyby se dala přepsat, schválení by přestalo znamenat cokoli:
-- schvalovatel by viděl jeden text a ven by šel jiný, se stejným id
-- i stejným záznamem o schválení.
--
-- Opravou není `update`, ale nová verze. Historie je tu schválně.
-- ---------------------------------------------------------------------

create or replace function app.marketing_verze_je_nemenna()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Verze příspěvku se neupravuje. Vytvořte novou verzi — schválení se váže na přesný obsah.'
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists trg_marketing_verze_nemenna on public.marketing_verze;
create trigger trg_marketing_verze_nemenna
  before update on public.marketing_verze
  for each row execute function app.marketing_verze_je_nemenna();


-- ---------------------------------------------------------------------
-- SCHVÁLENÍ
--
-- Žádost o schválení konkrétní verze. `otisk_verze` je kopie otisku
-- v okamžiku žádosti — schvaluje se přesně tenhle obsah.
-- ---------------------------------------------------------------------

create table public.marketing_schvaleni (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  prispevek_id    uuid not null references public.marketing_prispevky(id) on delete cascade,
  verze_id        uuid not null references public.marketing_verze(id) on delete cascade,
  otisk_verze     text not null,

  stav            text not null default 'ceka'
                    check (stav in ('ceka', 'schvaleno', 'zamitnuto', 'neplatne')),

  zadal           uuid references public.employees(id) on delete set null,
  zadano_kdy      timestamptz not null default now(),
  shrnuti         text not null default '',

  rozhodl         uuid references public.employees(id) on delete set null,
  rozhodnuto_kdy  timestamptz,
  -- Zamítnutí bez důvodu je pro toho, kdo příspěvek psal, k ničemu.
  pripominka      text not null default '',

  constraint marketing_schvaleni_zamitnuti_ma_duvod
    check (stav <> 'zamitnuto' or btrim(pripominka) <> ''),
  constraint marketing_schvaleni_rozhodnuti_ma_cas
    check ((stav in ('ceka', 'neplatne')) = (rozhodnuto_kdy is null))
);

/*
  JEDNA ČEKAJÍCÍ ŽÁDOST NA PŘÍSPĚVEK.

  Dvě čekající žádosti znamenají dva schvalovatele, kteří o sobě nevědí,
  a příspěvek, u kterého se nedá říct, co vlastně bylo schváleno.
*/
create unique index marketing_schvaleni_jedna_cekajici
  on public.marketing_schvaleni (prispevek_id)
  where stav = 'ceka';

create index marketing_schvaleni_prispevek
  on public.marketing_schvaleni (prispevek_id, zadano_kdy desc);

alter table public.marketing_schvaleni enable row level security;

create policy marketing_schvaleni_select on public.marketing_schvaleni for select to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_schvaleni.tenant_id
       and app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

/*
  ŽÁDOST ZAKLÁDÁ TEN, KDO PŘIPRAVUJE. ROZHODUJE TEN, KDO PUBLIKUJE.

  Zápis je proto povolený obojímu právu a rozdíl mezi „požádal"
  a „rozhodl" hlídá spoušť níž — ta se dívá, co se v řádku mění.
*/
create policy marketing_schvaleni_write on public.marketing_schvaleni for all to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_schvaleni.tenant_id
       and (app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)
         or app.has_access(r.tenant_id, 'marketing.publish', r.branch_id))))
  with check (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_schvaleni.tenant_id
       and (app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)
         or app.has_access(r.tenant_id, 'marketing.publish', r.branch_id))));

grant select, insert, update, delete on public.marketing_schvaleni to authenticated;

drop trigger if exists trg_audit_marketing_schvaleni on public.marketing_schvaleni;
create trigger trg_audit_marketing_schvaleni
  after insert or update or delete on public.marketing_schvaleni
  for each row execute function app.audit_zmenu('marketing_schvaleni');


-- ---------------------------------------------------------------------
-- SPOUŠŤ 2 — ROZHODNOUT SMÍ JEN marketing.publish, A NE O SVÉ ŽÁDOSTI
--
-- Politika výš pustí k řádku obě práva, protože žádost zakládá ten,
-- kdo připravuje. Rozhodnutí je ale něco jiného než založení, a to se
-- v politice rozlišit nedá — `with check` vidí jen výsledný řádek, ne
-- co se změnilo.
--
-- Čtyři oči: kdo o schválení požádal, nesmí si ho sám odklepnout.
-- Výjimka je jednočlenná firma, kde jiný schvalovatel prostě není —
-- tam by tvrdý zákaz znamenal, že nejde zveřejnit nic.
-- ---------------------------------------------------------------------

create or replace function app.marketing_strez_rozhodnuti()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_ja     uuid;
  v_jinych integer;
begin
  if new.stav = old.stav then
    return new;
  end if;

  -- Neplatné dělá spoušť 3 při nové verzi, ne člověk.
  if new.stav = 'neplatne' then
    return new;
  end if;

  select p.branch_id into v_branch
    from public.marketing_prispevky p
   where p.id = new.prispevek_id and p.tenant_id = new.tenant_id;

  if not app.has_access(new.tenant_id, 'marketing.publish', v_branch) then
    raise exception 'O schválení rozhoduje jen ten, kdo smí publikovat.'
      using errcode = 'insufficient_privilege';
  end if;

  select e.id into v_ja
    from public.employees e
   where e.user_id = (select auth.uid())
     and e.tenant_id = new.tenant_id
     and e.deleted_at is null;

  if v_ja is not null and old.zadal is not null and v_ja = old.zadal then
    -- Kdo smí schvalovat, se NEPOČÍTÁ ZNOVU. Ptáme se
    -- app.kdo_ma_pravo_na_pobocce, tedy téhož místa, které rozhoduje
    -- o přístupu jinde (pravidlo 2). Vlastní dotaz do zařazení by byl
    -- druhá kopie autorizace, která se dřív nebo později rozejde.
    select count(*) into v_jinych
      from app.kdo_ma_pravo_na_pobocce(new.tenant_id, 'marketing.publish', v_branch) k
      join public.employees e
        on e.user_id = k.user_id
       and e.tenant_id = new.tenant_id
       and e.deleted_at is null
     where e.id <> v_ja;

    if v_jinych > 0 then
      raise exception 'O svou vlastní žádost nerozhodujte — ve firmě je někdo další, kdo smí schvalovat.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  new.rozhodnuto_kdy := now();
  new.rozhodl := coalesce(v_ja, new.rozhodl);
  return new;
end $$;

drop trigger if exists trg_marketing_strez_rozhodnuti on public.marketing_schvaleni;
create trigger trg_marketing_strez_rozhodnuti
  before update on public.marketing_schvaleni
  for each row execute function app.marketing_strez_rozhodnuti();


-- ---------------------------------------------------------------------
-- SPOUŠŤ 3 — SCHVÁLENÍ SE ZAPÍŠE NA PŘÍSPĚVEK ODSUD
--
-- `schvalena_verze_id` nenastavuje aplikace. Kdyby to dělala, stačilo
-- by ji obejít jedním `update` a příspěvek by byl „schválený" bez
-- jediného rozhodnutí.
-- ---------------------------------------------------------------------

create or replace function app.marketing_zapis_rozhodnuti()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.stav = 'schvaleno' and old.stav <> 'schvaleno' then
    update public.marketing_prispevky
       set schvalena_verze_id = new.verze_id,
           stav = 'schvaleno',
           zmeneno_kdy = now()
     where id = new.prispevek_id;
  elsif new.stav = 'zamitnuto' and old.stav <> 'zamitnuto' then
    update public.marketing_prispevky
       set schvalena_verze_id = null,
           stav = 'zamitnuto',
           zmeneno_kdy = now()
     where id = new.prispevek_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_marketing_zapis_rozhodnuti on public.marketing_schvaleni;
create trigger trg_marketing_zapis_rozhodnuti
  after update on public.marketing_schvaleni
  for each row execute function app.marketing_zapis_rozhodnuti();


-- ---------------------------------------------------------------------
-- SPOUŠŤ 4 — NOVÁ VERZE RUŠÍ SCHVÁLENÍ
--
-- Tohle je to nejdůležitější v celé migraci. Bez ní by šlo příspěvek
-- schválit, pak mu podstrčit novou verzi a zveřejnit něco, co nikdo
-- neviděl.
--
-- Ruší se schválení i čekající žádost. Publikační úlohy ruší třetí
-- migrace, kde ta tabulka vznikne.
-- ---------------------------------------------------------------------

create or replace function app.marketing_nova_verze_rusi_schvaleni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.marketing_schvaleni
     set stav = 'neplatne'
   where prispevek_id = new.prispevek_id
     and stav = 'ceka';

  update public.marketing_prispevky
     set aktualni_verze_id = new.id,
         schvalena_verze_id = null,
         stav = case
                  when stav in ('zverejneno', 'archivovano') then stav
                  else 'koncept'
                end,
         zmeneno_kdy = now()
   where id = new.prispevek_id;

  return new;
end $$;

drop trigger if exists trg_marketing_nova_verze on public.marketing_verze;
create trigger trg_marketing_nova_verze
  after insert on public.marketing_verze
  for each row execute function app.marketing_nova_verze_rusi_schvaleni();


-- ---------------------------------------------------------------------
-- VARIANTY
--
-- Jeden výstupní formát verze: Instagram příspěvek, Story, Facebook,
-- tisk A4. Vzniká s verzí a nese odkaz na vykreslený soubor.
-- ---------------------------------------------------------------------

create table public.marketing_varianty (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  verze_id          uuid not null references public.marketing_verze(id) on delete cascade,
  prispevek_id      uuid not null references public.marketing_prispevky(id) on delete cascade,

  kanal             text not null check (kanal in ('instagram', 'facebook', 'tisk', 'interni')),
  format            text not null,
  spec              jsonb not null default '{}'::jsonb,

  vystup_media_id   uuid references public.marketing_media(id) on delete set null,
  zapnuto           boolean not null default true,

  vytvoreno_kdy     timestamptz not null default now()
);

create unique index marketing_varianty_format
  on public.marketing_varianty (verze_id, kanal, format);

alter table public.marketing_varianty enable row level security;

create policy marketing_varianty_select on public.marketing_varianty for select to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_varianty.tenant_id
       and app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

create policy marketing_varianty_write on public.marketing_varianty for all to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_varianty.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)))
  with check (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_varianty.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));

grant select, insert, update, delete on public.marketing_varianty to authenticated;

drop trigger if exists trg_audit_marketing_varianty on public.marketing_varianty;
create trigger trg_audit_marketing_varianty
  after insert or update or delete on public.marketing_varianty
  for each row execute function app.audit_zmenu('marketing_varianta');
