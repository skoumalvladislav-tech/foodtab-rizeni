-- =====================================================================
-- Foodtab — modul Marketing, výstup: render, publikační úlohy,
-- publikace
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
-- Navazuje na 20260909220000_marketing_integrace.sql.
--
--   1. podklady  — nastavení značky, média, šablony       hotovo
--   2. obsah     — příspěvky, verze, varianty, schvalování hotovo
--   3. integrace — připojení, tajemství, sociální účty     hotovo
--   4. výstup    — render, publikační úlohy, publikace     ← tahle
--
-- ---------------------------------------------------------------------
-- ČTVRTÁ POJISTKA
--
-- Druhá migrace postavila tři spouště kolem schvalování. Čtvrtou nešlo
-- postavit dřív, protože tahle tabulka ještě nebyla:
--
--   4. PUBLIKAČNÍ ÚLOHA BEZ PLATNÉHO SCHVÁLENÍ NEVZNIKNE.
--
-- Nestačí, že „to někdo schválil". Musí sedět všechno:
--   * schválení je ve stavu `schvaleno`,
--   * patří k témuž příspěvku a téže verzi,
--   * otisk uložený u schválení se rovná otisku té verze,
--   * a příspěvek na tu verzi pořád ukazuje jako na schválenou.
--
-- Poslední podmínka je ta, která chytí nejtišší chybu: příspěvek
-- s novou verzí má `schvalena_verze_id` prázdné, takže starým
-- schválením se publikovat nedá, i kdyby se na něj úloha odkázala.
--
-- ---------------------------------------------------------------------
-- OPAKOVÁNÍ A IDEMPOTENCE
--
-- Publikace se opakuje, když selže — ale nikdy nesmí vzniknout dva
-- příspěvky. Proto má úloha `idempotencni_klic` (unikátní) a záznam
-- o zveřejnění je na úlohu jen jeden. Opakovaný běh fronty tedy narazí
-- na tentýž řádek, ne na nový.
-- =====================================================================


-- ---------------------------------------------------------------------
-- RENDER
--
-- Vykreslení jedné varianty do obrázku nebo videa. Vestavěné vykreslení
-- doběhne hned, Shotstack odpovídá později — proto stav a opakování.
-- ---------------------------------------------------------------------

create table public.marketing_render_ulohy (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  prispevek_id      uuid not null references public.marketing_prispevky(id) on delete cascade,
  verze_id          uuid not null references public.marketing_verze(id) on delete cascade,
  varianta_id       uuid references public.marketing_varianty(id) on delete set null,

  poskytovatel      text not null,
  pripojeni_id      uuid references public.marketing_pripojeni(id) on delete set null,
  rezim             text not null check (rezim in ('zakaznicky', 'foodtab', 'rucni', 'demo')),

  stav              text not null default 'fronta' check (stav in
                      ('fronta', 'odeslano', 'kresli', 'hotovo', 'selhalo', 'zruseno')),
  externi_id        text,
  idempotencni_klic text not null unique,

  pozadavek         jsonb not null default '{}'::jsonb,
  odpoved           jsonb,
  vystup_media_id   uuid references public.marketing_media(id) on delete set null,
  chyba             text,

  pokusy            integer not null default 0,
  max_pokusu        integer not null default 3,
  dalsi_pokus_kdy   timestamptz,

  -- Celé haléře, ne float (CLAUDE.md, Konvence).
  cena_haleru       integer,

  vytvoril          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  zmeneno_kdy       timestamptz not null default now(),
  dokonceno_kdy     timestamptz
);

create index marketing_render_fronta
  on public.marketing_render_ulohy (stav, dalsi_pokus_kdy)
  where stav in ('odeslano', 'kresli');

alter table public.marketing_render_ulohy enable row level security;

create policy marketing_render_select on public.marketing_render_ulohy for select to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_render_ulohy.tenant_id
       and app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

create policy marketing_render_write on public.marketing_render_ulohy for all to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_render_ulohy.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)))
  with check (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_render_ulohy.tenant_id
       and app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));

grant select, insert, update, delete on public.marketing_render_ulohy to authenticated;

drop trigger if exists trg_audit_marketing_render on public.marketing_render_ulohy;
create trigger trg_audit_marketing_render
  after insert or update or delete on public.marketing_render_ulohy
  for each row execute function app.audit_zmenu('marketing_render_uloha');


-- ---------------------------------------------------------------------
-- PUBLIKAČNÍ ÚLOHA
--
-- Jedno „pošli tohle tam v tenhle čas". Vzniká až po schválení a jen
-- na schválenou verzi — hlídá to spoušť níž.
-- ---------------------------------------------------------------------

create table public.marketing_publikace_ulohy (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  prispevek_id      uuid not null references public.marketing_prispevky(id) on delete cascade,
  verze_id          uuid not null references public.marketing_verze(id) on delete cascade,
  -- Kopie otisku verze v okamžiku naplánování. Fronta ho před odesláním
  -- porovná znovu — kdyby se obsah mezitím změnil, úloha se zruší.
  otisk_verze       text not null,
  varianta_id       uuid references public.marketing_varianty(id) on delete set null,
  schvaleni_id      uuid not null references public.marketing_schvaleni(id) on delete restrict,

  ucet_id           uuid references public.marketing_ucty(id) on delete set null,
  kanal             text not null check (kanal in ('instagram', 'facebook')),
  format            text not null,

  poskytovatel      text not null,
  pripojeni_id      uuid references public.marketing_pripojeni(id) on delete set null,
  rezim             text not null check (rezim in ('zakaznicky', 'foodtab', 'rucni', 'demo')),

  stav              text not null default 'naplanovano' check (stav in
                      ('naplanovano', 've_fronte', 'odesila_se', 'zverejneno',
                       'zverejneno_nanecisto', 'k_rucnimu_zverejneni',
                       'selhalo', 'vzdano', 'zruseno')),
  planovano_na      timestamptz not null,
  idempotencni_klic text not null unique,

  pokusy            integer not null default 0,
  max_pokusu        integer not null default 5,
  dalsi_pokus_kdy   timestamptz,
  posledni_chyba    text,

  externi_id        text,
  odpoved           jsonb,

  vytvoril          uuid references public.employees(id) on delete set null,
  vytvoreno_kdy     timestamptz not null default now(),
  zmeneno_kdy       timestamptz not null default now(),
  zverejneno_kdy    timestamptz
);

create index marketing_publikace_fronta
  on public.marketing_publikace_ulohy (planovano_na)
  where stav in ('naplanovano', 've_fronte', 'selhalo');

alter table public.marketing_publikace_ulohy enable row level security;

create policy marketing_publikace_ulohy_select on public.marketing_publikace_ulohy for select to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_publikace_ulohy.tenant_id
       and app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

/*
  ZAPISUJE JEN marketing.publish.

  Připravit příspěvek smí `marketing.manage`. Poslat ho ven je ale to
  poslední rozhodnutí a patří k témuž právu, kterým se schvaluje.
*/
create policy marketing_publikace_ulohy_write on public.marketing_publikace_ulohy for all to authenticated
  using (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_publikace_ulohy.tenant_id
       and app.has_access(r.tenant_id, 'marketing.publish', r.branch_id)))
  with check (exists (
    select 1 from app.marketing_prispevek_rozsah(prispevek_id) r
     where r.tenant_id = marketing_publikace_ulohy.tenant_id
       and app.has_access(r.tenant_id, 'marketing.publish', r.branch_id)));

grant select, insert, update, delete on public.marketing_publikace_ulohy to authenticated;

drop trigger if exists trg_audit_marketing_publikace_ulohy on public.marketing_publikace_ulohy;
create trigger trg_audit_marketing_publikace_ulohy
  after insert or update or delete on public.marketing_publikace_ulohy
  for each row execute function app.audit_zmenu('marketing_publikace_uloha');


-- ---------------------------------------------------------------------
-- SPOUŠŤ 4 — BEZ PLATNÉHO SCHVÁLENÍ ÚLOHA NEVZNIKNE
--
-- Politika výš hlídá, KDO smí zapsat. Tahle spoušť hlídá, CO smí
-- vzniknout — a to politika neumí: `with check` vidí jen výsledný
-- řádek, ne jestli se schválení, na které ukazuje, opravdu týká toho,
-- co se má poslat ven.
-- ---------------------------------------------------------------------

create or replace function app.marketing_strez_publikaci()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav          text;
  v_prispevek     uuid;
  v_verze         uuid;
  v_otisk_schval  text;
  v_otisk_verze   text;
  v_schvalena     uuid;
begin
  select s.stav, s.prispevek_id, s.verze_id, s.otisk_verze
    into v_stav, v_prispevek, v_verze, v_otisk_schval
    from public.marketing_schvaleni s
   where s.id = new.schvaleni_id and s.tenant_id = new.tenant_id;

  if v_stav is null then
    raise exception 'Publikovat lze jen se schválením téže firmy.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_stav <> 'schvaleno' then
    raise exception 'Schválení není platné (stav %). Bez schválení se nic nezveřejní.', v_stav
      using errcode = 'insufficient_privilege';
  end if;

  if v_prispevek <> new.prispevek_id or v_verze <> new.verze_id then
    raise exception 'Schválení patří k jinému příspěvku nebo k jiné verzi.'
      using errcode = 'insufficient_privilege';
  end if;

  select v.otisk into v_otisk_verze
    from public.marketing_verze v where v.id = new.verze_id;

  if v_otisk_verze is distinct from v_otisk_schval
     or v_otisk_verze is distinct from new.otisk_verze then
    raise exception 'Obsah se od schválení změnil — schvaloval se jiný text nebo jiná fotka.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Nejtišší případ: schválení pořád existuje, ale příspěvek mezitím
  -- dostal novou verzi, takže na tuhle už neukazuje.
  select p.schvalena_verze_id into v_schvalena
    from public.marketing_prispevky p where p.id = new.prispevek_id;

  if v_schvalena is distinct from new.verze_id then
    raise exception 'Příspěvek už na tuhle verzi jako na schválenou neukazuje.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists trg_marketing_strez_publikaci on public.marketing_publikace_ulohy;
create trigger trg_marketing_strez_publikaci
  before insert on public.marketing_publikace_ulohy
  for each row execute function app.marketing_strez_publikaci();


-- ---------------------------------------------------------------------
-- NOVÁ VERZE RUŠÍ I NAPLÁNOVANOU PUBLIKACI
--
-- Doplnění spouště z druhé migrace. Tam se ještě nedalo napsat — tahle
-- tabulka neexistovala. Je to `create or replace`, ne úprava té
-- migrace: nasazenou migraci se nesahá, vždycky se přidává nová.
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

  -- Co ještě neodešlo, se ruší. Co odešlo, se zrušit nedá — a proto
  -- se na to ani netváříme.
  update public.marketing_publikace_ulohy
     set stav = 'zruseno',
         posledni_chyba = 'Zrušeno: příspěvek dostal novou verzi, schválení tím zaniklo.',
         zmeneno_kdy = now()
   where prispevek_id = new.prispevek_id
     and stav in ('naplanovano', 've_fronte', 'selhalo');

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


-- ---------------------------------------------------------------------
-- PUBLIKACE
--
-- Co doopravdy odešlo. Jeden záznam na úlohu — proto je `uloha_id`
-- unikátní: opakovaný běh fronty nesmí založit druhý.
--
-- `je_nanecisto` říká, že to byl demo režim a NIC SE NEZVEŘEJNILO.
-- Ten sloupec je tu proto, aby se demo nedalo splést se skutečností
-- ani na obrazovce, ani v číslech.
-- ---------------------------------------------------------------------

create table public.marketing_publikace (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  prispevek_id    uuid not null references public.marketing_prispevky(id) on delete cascade,
  verze_id        uuid not null references public.marketing_verze(id) on delete cascade,
  uloha_id        uuid not null unique references public.marketing_publikace_ulohy(id) on delete cascade,

  ucet_id         uuid references public.marketing_ucty(id) on delete set null,
  kanal           text not null check (kanal in ('instagram', 'facebook')),
  format          text not null,

  externi_id      text,
  trvaly_odkaz    text,
  je_nanecisto    boolean not null default false,
  odpoved         jsonb,

  zverejneno_kdy  timestamptz not null default now()
);

create index marketing_publikace_pobocka
  on public.marketing_publikace (tenant_id, branch_id, zverejneno_kdy desc);

alter table public.marketing_publikace enable row level security;

create policy marketing_publikace_select on public.marketing_publikace for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_publikace_write on public.marketing_publikace for all to authenticated
  using (app.has_access(tenant_id, 'marketing.publish', branch_id))
  with check (app.has_access(tenant_id, 'marketing.publish', branch_id));

grant select, insert, update, delete on public.marketing_publikace to authenticated;

drop trigger if exists trg_audit_marketing_publikace on public.marketing_publikace;
create trigger trg_audit_marketing_publikace
  after insert or update or delete on public.marketing_publikace
  for each row execute function app.audit_zmenu('marketing_publikace');
