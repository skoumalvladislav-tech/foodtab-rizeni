-- =====================================================================
-- Foodtab — Finance: Nákup — objednávky dodavatelům a příjem zboží
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5,
-- procure-to-pay): „požadavek na nákup → schválení → objednávka
-- dodavateli → částečný/plný příjem → kontrola dodavatelské faktury →
-- závazek → úhrada. Příjem a faktura mohou přijít v různém pořadí.
-- Párování objednávka/příjem/faktura upozorní na rozdíly množství a
-- ceny; bez dvojího vytvoření zásoby nebo nákladu." Akceptační scénář
-- 17: objednávka 20 kg, příjem 12 kg + 8 kg → správný zbytek, faktura
-- s jiným množstvím/cenou upozorní, potvrzení znovu nevytvoří příjem.
--
-- BEZ FYZICKÉHO SKLADU (mantinel — „to má každý v POS"): objednávka a
-- příjem jsou DOKLADY s běžícími součty na položce
-- (mnozstvi_objednano/_prijato/_fakturovano), ne karta aktuální zásoby.
-- Žádná tabulka "skladem je X kg" nevzniká.
--
-- Úhrada závazku z přijaté faktury je UŽ hotová (platby_faktury,
-- 20261003130000) — tahle migrace dodává kroky PŘED fakturou.
-- =====================================================================


-- ---------------------------------------------------------------------
-- ČÍSELNÁ ŘADA — sdílená pro objednávky i (budoucí) zakázky, po firmě
-- a typu/roku. Atomická přes ON CONFLICT DO UPDATE (žádná duplicita
-- při souběhu — stejný řádek se serializuje na UPDATEu).
-- ---------------------------------------------------------------------

-- Tabulka v `public` (jako všechny ostatní v tomhle projektu — `app`
-- schéma drží jen funkce). Žádný grant pro authenticated/anon: čte a
-- píše se výhradně přes app.dalsi_cislo (SECURITY DEFINER) níž.
create table public.cislovani_rad (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  typ            text not null,
  rok            integer not null,
  posledni_cislo integer not null default 0,
  primary key (tenant_id, typ, rok)
);

alter table public.cislovani_rad enable row level security;
revoke all on public.cislovani_rad from public, anon, authenticated;
grant select, insert, update, delete on public.cislovani_rad to service_role;

create function app.dalsi_cislo(p_tenant uuid, p_typ text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_rok   integer := extract(year from now())::integer;
  v_cislo integer;
begin
  insert into public.cislovani_rad (tenant_id, typ, rok, posledni_cislo)
  values (p_tenant, p_typ, v_rok, 1)
  on conflict (tenant_id, typ, rok) do update
    set posledni_cislo = public.cislovani_rad.posledni_cislo + 1
  returning posledni_cislo into v_cislo;

  return p_typ || '-' || v_rok || '-' || lpad(v_cislo::text, 4, '0');
end $$;

comment on function app.dalsi_cislo(uuid, text) is
  'Atomické číslo dokladu (OBJ-2026-0001, ZAK-2026-0001...) — ON CONFLICT '
  'DO UPDATE na jednom řádku serializuje souběh, žádná duplicita při '
  'dvou objednávkách zapsaných ve stejné vteřině.';

revoke all on function app.dalsi_cislo(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- OBJEDNÁVKY DODAVATELŮM
-- ---------------------------------------------------------------------

create table public.objednavky_dodavatelum (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  branch_id               uuid references public.branches(id) on delete cascade,
  kontakt_id              uuid not null references public.kontakty(id),
  cislo                   text not null,
  stav                    text not null default 'koncept' check (stav in
                            ('koncept', 'schvaleno', 'odeslano', 'castecne_prijato', 'prijato', 'zrušeno')),
  datum_objednani         date not null default current_date,
  pozadovane_datum_dodani date,
  poznamka                text not null default '',
  schvalil                uuid references public.profiles(user_id) on delete set null,
  schvaleno_kdy           timestamptz,
  created_by              uuid references public.profiles(user_id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index objednavky_tenant_cislo on public.objednavky_dodavatelum (tenant_id, cislo);
create index objednavky_tenant_stav on public.objednavky_dodavatelum (tenant_id, stav);

alter table public.objednavky_dodavatelum enable row level security;

revoke all on public.objednavky_dodavatelum from anon;
revoke truncate, references, trigger on public.objednavky_dodavatelum from authenticated;
grant select, insert, update, delete on public.objednavky_dodavatelum to authenticated;

create policy objednavky_read on public.objednavky_dodavatelum for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', branch_id));
create policy objednavky_write on public.objednavky_dodavatelum for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', branch_id))
  with check (app.has_access(tenant_id, 'purchasing.manage', branch_id));

-- Druhá linie: kontakt_id musí patřit TÉŽE firmě.
create function app.hlida_firmu_objednavky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.kontakty k
    where k.id = new.kontakt_id and k.tenant_id = new.tenant_id
  ) then
    raise exception 'Dodavatel nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_objednavky() from public, anon, authenticated;

create trigger trg_firma_objednavky
  before insert or update of tenant_id, kontakt_id on public.objednavky_dodavatelum
  for each row execute function app.hlida_firmu_objednavky();

drop trigger if exists trg_audit_objednavky on public.objednavky_dodavatelum;
create trigger trg_audit_objednavky
  after insert or update or delete on public.objednavky_dodavatelum
  for each row execute function app.audit_zmenu('objednavka_dodavateli');


-- ---------------------------------------------------------------------
-- POLOŽKY OBJEDNÁVKY — běžící součty, NE sklad.
-- ---------------------------------------------------------------------

create table public.objednavky_polozky (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  objednavka_id           uuid not null references public.objednavky_dodavatelum(id) on delete cascade,
  surovina_id             uuid references public.ingredients(id) on delete set null,
  nazev                   text not null check (length(btrim(nazev)) > 0),
  jednotka                text not null default '',
  mnozstvi_objednano      numeric not null check (mnozstvi_objednano > 0),
  cena_za_jednotku_haleru integer not null check (cena_za_jednotku_haleru >= 0),
  mnozstvi_prijato        numeric not null default 0 check (mnozstvi_prijato >= 0),
  mnozstvi_fakturovano    numeric not null default 0 check (mnozstvi_fakturovano >= 0)
);

create index objednavky_polozky_objednavka on public.objednavky_polozky (objednavka_id);

alter table public.objednavky_polozky enable row level security;

revoke all on public.objednavky_polozky from anon;
revoke truncate, references, trigger on public.objednavky_polozky from authenticated;
grant select, insert, update, delete on public.objednavky_polozky to authenticated;

create policy objednavky_polozky_read on public.objednavky_polozky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', null));
create policy objednavky_polozky_write on public.objednavky_polozky for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', null))
  with check (app.has_access(tenant_id, 'purchasing.manage', null));

create function app.hlida_firmu_objednavky_polozky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.objednavky_dodavatelum o
    where o.id = new.objednavka_id and o.tenant_id = new.tenant_id
  ) then
    raise exception 'Objednávka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_objednavky_polozky() from public, anon, authenticated;

create trigger trg_firma_objednavky_polozky
  before insert or update of tenant_id, objednavka_id on public.objednavky_polozky
  for each row execute function app.hlida_firmu_objednavky_polozky();


-- ---------------------------------------------------------------------
-- ZALOŽENÍ OBJEDNÁVKY — jediný vstupní bod z appky, stejný důvod jako
-- u public.zapsat_prijem_zbozi níž: volá app.dalsi_cislo, na kterou
-- authenticated nemá EXECUTE. SECURITY DEFINER s výslovnou kontrolou.
-- ---------------------------------------------------------------------

create or replace function public.zalozit_objednavku(
  p_tenant     uuid,
  p_branch     uuid,
  p_kontakt    uuid,
  p_pozadovane_datum_dodani date,
  p_poznamka   text,
  p_polozky    jsonb -- [{surovina_id, nazev, jednotka, mnozstvi_objednano, cena_za_jednotku_haleru}]
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cislo text;
  v_objednavka uuid;
  v_polozka record;
begin
  if not app.has_access(p_tenant, 'purchasing.manage', p_branch) then
    raise exception 'Nemáte oprávnění zakládat objednávky.'
      using errcode = 'insufficient_privilege';
  end if;

  v_cislo := app.dalsi_cislo(p_tenant, 'OBJ');

  insert into public.objednavky_dodavatelum (
    tenant_id, branch_id, kontakt_id, cislo, pozadovane_datum_dodani, poznamka
  )
  values (p_tenant, p_branch, p_kontakt, v_cislo, p_pozadovane_datum_dodani, coalesce(p_poznamka, ''))
  returning id into v_objednavka;

  for v_polozka in
    select * from jsonb_to_recordset(p_polozky) as r(
      surovina_id uuid, nazev text, jednotka text,
      mnozstvi_objednano numeric, cena_za_jednotku_haleru integer
    )
  loop
    insert into public.objednavky_polozky (
      tenant_id, objednavka_id, surovina_id, nazev, jednotka,
      mnozstvi_objednano, cena_za_jednotku_haleru
    )
    values (
      p_tenant, v_objednavka, v_polozka.surovina_id, v_polozka.nazev,
      coalesce(v_polozka.jednotka, ''), v_polozka.mnozstvi_objednano, v_polozka.cena_za_jednotku_haleru
    );
  end loop;

  return v_objednavka;
end $$;

comment on function public.zalozit_objednavku(uuid, uuid, uuid, date, text, jsonb) is
  'Jediný vstupní bod pro založení objednávky dodavateli s položkami. '
  'Číslo (OBJ-RRRR-NNNN) přiděluje app.dalsi_cislo atomicky.';

revoke all on function public.zalozit_objednavku(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.zalozit_objednavku(uuid, uuid, uuid, date, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- PŘÍJEMKY — hlavička. `objednavka_id` nullable: příjem BEZ objednávky
-- (zadání připouští, že příjem a faktura mohou přijít v různém pořadí,
-- i bez předchozí objednávky v appce).
-- ---------------------------------------------------------------------

create table public.prijemky (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete cascade,
  objednavka_id  uuid references public.objednavky_dodavatelum(id) on delete set null,
  cislo          text not null,
  datum_prijeti  date not null default current_date,
  -- Faktura žije v oddělené DB (ctqtwahlzhyjerqulqyn) — prostý text,
  -- žádný FK nejde postavit (stejný vzor jako platby_faktury.faktura_id).
  faktura_id     text,
  prijal         uuid references public.employees(id) on delete set null,
  poznamka       text not null default '',
  created_at     timestamptz not null default now()
);

create unique index prijemky_tenant_cislo on public.prijemky (tenant_id, cislo);
create index prijemky_objednavka on public.prijemky (objednavka_id) where objednavka_id is not null;

alter table public.prijemky enable row level security;

revoke all on public.prijemky from anon;
revoke truncate, references, trigger on public.prijemky from authenticated;
grant select, insert, update, delete on public.prijemky to authenticated;

create policy prijemky_read on public.prijemky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', branch_id));
create policy prijemky_write on public.prijemky for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', branch_id))
  with check (app.has_access(tenant_id, 'purchasing.manage', branch_id));

create function app.hlida_firmu_prijemky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.objednavka_id is not null and not exists (
    select 1 from public.objednavky_dodavatelum o
    where o.id = new.objednavka_id and o.tenant_id = new.tenant_id
  ) then
    raise exception 'Objednávka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_prijemky() from public, anon, authenticated;

create trigger trg_firma_prijemky
  before insert or update of tenant_id, objednavka_id on public.prijemky
  for each row execute function app.hlida_firmu_prijemky();

drop trigger if exists trg_audit_prijemky on public.prijemky;
create trigger trg_audit_prijemky
  after insert or update or delete on public.prijemky
  for each row execute function app.audit_zmenu('prijemka');


-- ---------------------------------------------------------------------
-- POLOŽKY PŘÍJEMKY
-- ---------------------------------------------------------------------

create table public.prijemky_polozky (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  prijemka_id             uuid not null references public.prijemky(id) on delete cascade,
  objednavky_polozka_id   uuid references public.objednavky_polozky(id) on delete set null,
  nazev                   text not null check (length(btrim(nazev)) > 0),
  jednotka                text not null default '',
  mnozstvi_prijato        numeric not null check (mnozstvi_prijato > 0),
  cena_za_jednotku_haleru integer not null check (cena_za_jednotku_haleru >= 0)
);

create index prijemky_polozky_prijemka on public.prijemky_polozky (prijemka_id);

alter table public.prijemky_polozky enable row level security;

revoke all on public.prijemky_polozky from anon;
revoke truncate, references, trigger on public.prijemky_polozky from authenticated;
grant select, insert, update, delete on public.prijemky_polozky to authenticated;

create policy prijemky_polozky_read on public.prijemky_polozky for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', null));
create policy prijemky_polozky_write on public.prijemky_polozky for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', null))
  with check (app.has_access(tenant_id, 'purchasing.manage', null));

create function app.hlida_firmu_prijemky_polozky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.prijemky p
    where p.id = new.prijemka_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Příjemka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.objednavky_polozka_id is not null and not exists (
    select 1 from public.objednavky_polozky op
    where op.id = new.objednavky_polozka_id and op.tenant_id = new.tenant_id
  ) then
    raise exception 'Položka objednávky nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_prijemky_polozky() from public, anon, authenticated;

create trigger trg_firma_prijemky_polozky
  before insert or update of tenant_id, prijemka_id, objednavky_polozka_id on public.prijemky_polozky
  for each row execute function app.hlida_firmu_prijemky_polozky();


-- ---------------------------------------------------------------------
-- ZÁPIS PŘÍJMU ZBOŽÍ — jediný vstupní bod z appky. Vloží příjemku +
-- položky, a pro položky navázané na objednávku inkrementuje běžící
-- součet `mnozstvi_prijato`. NEBLOKUJE překročení objednaného množství
-- nebo odlišnou cenu — jen to VRÁTÍ jako upozornění (zadání: "upozorní
-- na rozdíly... bez dvojího vytvoření zásoby nebo nákladu").
--
-- SECURITY DEFINER s VÝSLOVNOU kontrolou oprávnění na začátku. Musí to
-- být definer, protože volá app.dalsi_cislo (ta nemá EXECUTE pro
-- authenticated — jen pro vlastníka funkce). SECURITY DEFINER proto
-- obchází i RLS write politiku na prijemky/prijemky_polozky/
-- objednavky_polozky, takže kontrolu dělá TATO funkce sama, přesně
-- jako app.integrace_uloz_tajemstvi. Druhá linie (trg_firma_prijemky*)
-- platí dál beze změny — triggery se spouští bez ohledu na roli/
-- SECURITY mode volajícího.
-- ---------------------------------------------------------------------

create or replace function public.zapsat_prijem_zbozi(
  p_tenant     uuid,
  p_branch     uuid,
  p_objednavka uuid,
  p_faktura_id text,
  p_prijal     uuid,
  p_poznamka   text,
  p_polozky    jsonb -- [{objednavky_polozka_id, nazev, jednotka, mnozstvi_prijato, cena_za_jednotku_haleru}]
)
returns table (
  prijemka_id      uuid,
  polozka_id       uuid,
  prekrocene_mnozstvi boolean,
  jina_cena        boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_cislo text;
  v_prijemka uuid;
  v_polozka record;
  v_nova_polozka_id uuid;
  v_puvodni_mnozstvi numeric;
  v_puvodni_cena integer;
  v_nove_mnozstvi numeric;
begin
  if not app.has_access(p_tenant, 'purchasing.manage', p_branch) then
    raise exception 'Nemáte oprávnění zapisovat příjem zboží.'
      using errcode = 'insufficient_privilege';
  end if;

  v_cislo := app.dalsi_cislo(p_tenant, 'PRIJ');

  insert into public.prijemky (tenant_id, branch_id, objednavka_id, cislo, faktura_id, prijal, poznamka)
  values (p_tenant, p_branch, p_objednavka, v_cislo, p_faktura_id, p_prijal, coalesce(p_poznamka, ''))
  returning id into v_prijemka;

  for v_polozka in
    select * from jsonb_to_recordset(p_polozky) as r(
      objednavky_polozka_id uuid, nazev text, jednotka text,
      mnozstvi_prijato numeric, cena_za_jednotku_haleru integer
    )
  loop
    insert into public.prijemky_polozky (
      tenant_id, prijemka_id, objednavky_polozka_id, nazev, jednotka,
      mnozstvi_prijato, cena_za_jednotku_haleru
    )
    values (
      p_tenant, v_prijemka, v_polozka.objednavky_polozka_id, v_polozka.nazev,
      coalesce(v_polozka.jednotka, ''), v_polozka.mnozstvi_prijato, v_polozka.cena_za_jednotku_haleru
    )
    returning id into v_nova_polozka_id;

    if v_polozka.objednavky_polozka_id is not null then
      select op.mnozstvi_objednano, op.cena_za_jednotku_haleru
        into v_puvodni_mnozstvi, v_puvodni_cena
      from public.objednavky_polozky op
      where op.id = v_polozka.objednavky_polozka_id;

      update public.objednavky_polozky
        set mnozstvi_prijato = mnozstvi_prijato + v_polozka.mnozstvi_prijato
      where id = v_polozka.objednavky_polozka_id
      returning mnozstvi_prijato into v_nove_mnozstvi;

      prijemka_id := v_prijemka;
      polozka_id := v_nova_polozka_id;
      prekrocene_mnozstvi := v_nove_mnozstvi > v_puvodni_mnozstvi;
      jina_cena := v_polozka.cena_za_jednotku_haleru <> v_puvodni_cena;
      return next;
    else
      prijemka_id := v_prijemka;
      polozka_id := v_nova_polozka_id;
      prekrocene_mnozstvi := false;
      jina_cena := false;
      return next;
    end if;
  end loop;
end $$;

comment on function public.zapsat_prijem_zbozi(uuid, uuid, uuid, text, uuid, text, jsonb) is
  'Jediný vstupní bod pro zápis příjmu zboží. Pro položky navázané na '
  'objednávku INKREMENTUJE běžící součet mnozstvi_prijato a VRACÍ '
  'upozornění (prekrocene_mnozstvi/jina_cena) — nikdy nebloguje zápis, '
  'jen ho appka ukáže uživateli ke kontrole (scénář 17).';

revoke all on function public.zapsat_prijem_zbozi(uuid, uuid, uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.zapsat_prijem_zbozi(uuid, uuid, uuid, text, uuid, text, jsonb) to authenticated;
