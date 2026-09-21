-- =====================================================================
-- Foodtab — Provozní centrum (etapa 2): zpráva → úkol, výběr příjemců,
-- systémové události v konverzaci, idempotentní odeslání
--
-- Zadání: noční zadání 20.–21. 9. 2026. Architektura:
-- docs/COMMUNICATION_ARCHITECTURE.md, oddíl 3 (B).
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace. Migrace jen PŘIDÁVÁ sloupce a
-- funkce; existující data zpráv, úkolů ani konverzací nepřepisuje.
-- Vyžaduje předchozí 20260921100000_notifikacni_sluzba (app.notifikovat).
--
-- ---------------------------------------------------------------------
-- CO TAHLE MIGRACE DĚLÁ
--
--  1. tasks: vazba na zprávu a konverzaci, zdroj úkolu.
--  2. konverzace_zpravy: typ (zpráva / systémová událost), odkaz na
--     objekt (úkol), klientské id pro idempotentní odeslání.
--  3. public.poslat_zpravu dostává 7. parametr p_klient_id. Starý
--     šestiparametrový podpis se ZAHAZUJE (jinak by vedle sebe žily dvě
--     přetížení a každé volání by spadlo na „function is not unique“).
--  4. public.zalozit_ukol_ze_zpravy: úkol vznikne z potvrzeného návrhu,
--     do konverzace přibude systémová událost, úkol nese odkaz zpět.
--  5. Trigger na tasks: přidělený úkol upozorní adresáty přes
--     app.notifikovat (druh ukol.pridelen).
--  6. public.komu_muzu_psat: seznam kolegů pro výběr příjemců (běžný
--     zaměstnanec nesmí číst tabulku employees, funkce vrací jen id,
--     jméno a zařazení).
--  7. public.kdo_nepotvrdil: kontrola oprávnění (dosud hlídalo jen UI).
--  8. public.lide_v_rozhovoru a jmena_osobnich_rozhovoru: jména lidí v
--     rozhovoru (běžný zaměstnanec nesmí číst employees, obrazovka
--     proto ukazovala „kdosi“) a název osobního rozhovoru pro každého
--     účastníka zvlášť.
--  9. public.moje_rozhovory: systémová událost se nepočítá jako nepřečtená.
--
-- ---------------------------------------------------------------------
-- CO SE NEMĚNÍ
--
-- Těla poslat_zpravu a kdo_nepotvrdil vycházejí ze ŽIVÉ databáze
-- (pg_get_functiondef z 21. 9. 2026); měnilo se jen to, co je níž
-- popsané. zalozit_rozhovor se NEMĚNÍ: rozhovory mezi pobočkami jsou
-- zamýšlené (krok 24, oddíl 7; krok 25, oddíl 3), zpřísnit je by bylo
-- rozhodnutí o provozu. Tabulky konverzace* se nepřejmenovávají,
-- generovaný sloupec konverzace_zpravy.nalehava se nedotýká.
--
-- Do auditu se NEDÁVÁ text zprávy ani text úkolu ze zprávy (zásada
-- app.audit_zpravy). Systémová událost v konverzaci text nese — vidí ho
-- jen účastníci rozhovoru, stejně jako zbytek vlákna.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tasks: odkud úkol vzešel
-- ---------------------------------------------------------------------

alter table public.tasks
  add column zprava_id     uuid references public.konverzace_zpravy(id) on delete set null,
  add column konverzace_id uuid references public.konverzace(id)        on delete set null,
  add column zdroj         text not null default 'rucne'
    check (zdroj in ('rucne', 'zprava', 'checklist'));

create index tasks_konverzace
  on public.tasks (konverzace_id)
  where konverzace_id is not null;

comment on column public.tasks.zprava_id is
  'Zpráva, ze které úkol vznikl (public.zalozit_ukol_ze_zpravy). Text '
  'zprávy se do úkolu NEKOPÍRUJE automaticky — název a poznámku potvrzuje '
  'člověk. Odkaz slouží k návratu do rozhovoru.';
comment on column public.tasks.konverzace_id is
  'Rozhovor, ze kterého úkol vznikl. Zapisuje ho jen zalozit_ukol_ze_zpravy; '
  'přímý zápis hlídá trigger tasks_vazba_zpravy (musí jít o rozhovor téže '
  'firmy, jehož je člověk účastníkem).';
comment on column public.tasks.zdroj is
  'rucne = zadal člověk, zprava = vznikl ze zprávy, checklist = z položky checklistu.';


-- Přímý zápis vazby (tasks_write dovolí insert/update každému s tasks.manage)
-- nesmí umožnit připnout úkol k CIZÍMU rozhovoru: úkol by se pak objevil
-- v panelu jeho účastníků. Vazba musí být na rozhovor téže firmy a
-- zapisující musí být jeho účastník. Definer proto, že čte konverzace.
create or replace function app.tasks_vazba_zpravy_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if NEW.konverzace_id is null and NEW.zprava_id is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and NEW.konverzace_id is not distinct from OLD.konverzace_id
     and NEW.zprava_id     is not distinct from OLD.zprava_id then
    return NEW;
  end if;

  if NEW.zprava_id is not null and not exists (
       select 1 from public.konverzace_zpravy z
        where z.id = NEW.zprava_id
          and z.konverzace_id = NEW.konverzace_id
          and z.tenant_id = NEW.tenant_id
     ) then
    raise exception 'Zpráva k úkolu nepatří k tomu rozhovoru nebo firmě.'
      using errcode = 'insufficient_privilege';
  end if;

  if NEW.konverzace_id is not null and (
       not exists (select 1 from public.konverzace k
                    where k.id = NEW.konverzace_id and k.tenant_id = NEW.tenant_id)
       or not app.je_ucastnik(NEW.konverzace_id)
     ) then
    raise exception 'K tomu rozhovoru úkol připnout nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  return NEW;
end $$;

revoke all on function app.tasks_vazba_zpravy_trg() from public, anon, authenticated;

create trigger tasks_vazba_zpravy
  before insert or update on public.tasks
  for each row execute function app.tasks_vazba_zpravy_trg();


-- ---------------------------------------------------------------------
-- 2. konverzace_zpravy: typ, objekt, klientské id
-- ---------------------------------------------------------------------

alter table public.konverzace_zpravy
  add column typ text not null default 'zprava'
    check (typ in ('zprava', 'system')),
  add column objekt_typ text
    check (objekt_typ is null or objekt_typ in ('ukol')),
  add column objekt_id uuid,
  add column klient_id uuid;

comment on column public.konverzace_zpravy.typ is
  'zprava = napsal člověk, system = událost v konverzaci (např. vytvořený '
  'úkol). Systémová událost nikoho nepípá (viz upozornit_na_vzkaz_trg).';
comment on column public.konverzace_zpravy.objekt_typ is
  'Na jaký objekt událost odkazuje (zatím jen ukol).';
comment on column public.konverzace_zpravy.objekt_id is
  'ID objektu, na který událost odkazuje. Bez cizího klíče záměrně: objekt '
  'se smí smazat a rozhovor má zůstat čitelný.';
comment on column public.konverzace_zpravy.klient_id is
  'Id vygenerované klientem při odeslání. Druhé odeslání téhož id do téhož '
  'rozhovoru (opakování po výpadku spojení) vrátí původní zprávu místo '
  'duplicity.';

create unique index konverzace_zpravy_klient
  on public.konverzace_zpravy (konverzace_id, klient_id)
  where klient_id is not null;


-- Systémová událost nikoho nepípá: notifikace by z jedné akce („vytvořen
-- úkol“) udělala další nepřečtenou zprávu ve zvonečku. Úkol samotný
-- upozorní adresáta (oddíl 5).
create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_konv record;
  v_rec  record;
begin
  if NEW.typ = 'system' then
    return NEW;
  end if;

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
-- 3. poslat_zpravu: idempotentní odeslání (p_klient_id)
--
-- Odesílání z telefonu se po výpadku spojení opakuje. Bez klíče by
-- opakování vyrobilo dvě zprávy a dvě upozornění. Se stejným klíčem se
-- vrátí původní zpráva.
--
-- Pořadí: nejdřív se ověří, že volající je účastník (jinak by šlo přes
-- klíč zkoušet, jaké zprávy existují), teprve pak se hledá duplicita.
--
-- Starý podpis se zahazuje NEJDŘÍV: create or replace s jiným počtem
-- parametrů by nechalo dvě funkce vedle sebe.
-- ---------------------------------------------------------------------

drop function public.poslat_zpravu(uuid, text, boolean, text, text, integer);

create function public.poslat_zpravu(
  p_konverzace   uuid,
  p_text         text,
  p_nalehava     boolean default false,
  p_priorita     text    default null,
  p_zvuk_cesta   text    default null,
  p_zvuk_delka_s integer default null,
  p_klient_id    uuid    default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant           uuid;
  v_ja               uuid;
  v_id               uuid;
  v_priorita         text;
  v_text             text := coalesce(p_text, '');
  v_cesta_tenant     uuid;
  v_cesta_konverzace uuid;
begin
  select k.tenant_id into v_tenant from public.konverzace k where k.id = p_konverzace;

  if v_tenant is null or not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Opakované odeslání téhož klientského id: původní zpráva, nic nového.
  if p_klient_id is not null then
    select z.id into v_id
      from public.konverzace_zpravy z
     where z.konverzace_id = p_konverzace
       and z.klient_id     = p_klient_id;

    if found then
      return v_id;
    end if;
  end if;

  if exists (select 1 from public.konverzace k
             where k.id = p_konverzace and k.uzavreno_kdy is not null) then
    raise exception 'Tenhle rozhovor je uzavřený.' using errcode = 'check_violation';
  end if;

  if btrim(v_text) = '' and p_zvuk_cesta is null then
    raise exception 'Zpráva nemá ani text, ani hlasovku.'
      using errcode = 'check_violation';
  end if;

  /*
    CESTA MUSÍ SEDĚT S KONVERZACÍ, NA KTEROU SE ZPRÁVA POSÍLÁ.

    Bez tohohle by šlo nahrát hlasovku do JEDNÉ konverzace (kde je
    člověk účastník — to hlídá politika úložiště) a připojit ji přes
    poslat_zpravu k JINÉ. Storage politika sama tenhle křížový případ
    nepokryje, protože se dívá jen na cestu při nahrávání, ne na to,
    kam se cesta později přiřadí.

    Rozebírá se přes app.hlasovka_cesta_rozsah — STEJNÝ parser, který
    používají politiky úložiště. Ruční regex nad stejným tvarem cesty by
    byl druhá, nezávislá definice „jak se cesta skládá“.
  */
  if p_zvuk_cesta is not null then
    select r.tenant_id, r.konverzace_id
      into v_cesta_tenant, v_cesta_konverzace
      from app.hlasovka_cesta_rozsah(p_zvuk_cesta) r;

    if v_cesta_tenant is distinct from v_tenant
       or v_cesta_konverzace is distinct from p_konverzace then
      raise exception 'Cesta k hlasovce nesedí s touhle konverzací.'
        using errcode = 'check_violation';
    end if;
  end if;

  v_ja := app.muj_employee(v_tenant);

  v_priorita := coalesce(p_priorita, case when coalesce(p_nalehava, false) then 'urgent' else 'normal' end);

  if v_priorita not in ('normal', 'important', 'urgent') then
    raise exception 'Neplatná priorita zprávy.' using errcode = 'check_violation';
  end if;

  if v_priorita = 'urgent'
     and not app.has_permission(v_tenant, 'communication.urgent') then
    raise exception 'Naléhavou zprávu poslat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  begin
    insert into public.konverzace_zpravy
      (konverzace_id, tenant_id, autor, text, priorita, zvuk_cesta, zvuk_delka_s, klient_id)
    values
      (p_konverzace, v_tenant, v_ja, v_text, v_priorita, p_zvuk_cesta, p_zvuk_delka_s, p_klient_id)
    returning id into v_id;
  exception when unique_violation then
    -- Dvě opakování téhož klientského id naráz: vyhrálo to první.
    if p_klient_id is null then
      raise;
    end if;
    select z.id into v_id
      from public.konverzace_zpravy z
     where z.konverzace_id = p_konverzace
       and z.klient_id     = p_klient_id;
    return v_id;
  end;

  if v_priorita = 'urgent' then
    perform app.audit(
      p_tenant      => v_tenant,
      p_action      => 'komunikace.nalehava_zprava',
      p_entity_type => 'konverzace_zprava',
      p_entity_id   => v_id::text,
      p_after       => jsonb_build_object(
        'konverzace', p_konverzace,
        'odesilatel', (select e.full_name from public.employees e where e.id = v_ja),
        'znaku', length(v_text)
      )
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.poslat_zpravu(uuid, text, boolean, text, text, integer, uuid)
  from public, anon;
grant execute on function public.poslat_zpravu(uuid, text, boolean, text, text, integer, uuid)
  to authenticated;


-- ---------------------------------------------------------------------
-- 4. zalozit_ukol_ze_zpravy
--
-- Úkol vzniká z NÁVRHU, který člověk zkontroloval a potvrdil — název,
-- poznámku, termín i adresáta posílá formulář. Funkce sama žádný text ze
-- zprávy nekopíruje (a žádný model nevolá).
--
-- DEFINER BEZ DRUHÉ LINIE: firmu, účastnictví a právo tasks.manage
-- hlídá funkce sama (zadat_ukol, kterou volá, si právo a adresáty
-- ověřuje také).
--
-- Do auditu jde JEN odkaz (rozhovor, zpráva), ne text.
-- ---------------------------------------------------------------------

create or replace function public.zalozit_ukol_ze_zpravy(
  p_tenant   uuid,
  p_zprava   uuid,
  p_branch   uuid,
  p_nazev    text,
  p_poznamka text                        default '',
  p_termin   timestamp without time zone default null,
  p_priorita text                        default 'normal',
  p_usek     uuid                        default null,
  p_pozice   uuid                        default null,
  p_clovek   uuid                        default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_konv  uuid;
  v_typ   text;
  v_ukol  uuid;
  v_ja    uuid;
begin
  select z.konverzace_id, z.typ
    into v_konv, v_typ
    from public.konverzace_zpravy z
   where z.id = p_zprava
     and z.tenant_id = p_tenant
     and z.stornovano_kdy is null;

  -- Neexistující, cizí i stornovaná zpráva se tváří stejně: nedá se
  -- zkoušet, jaká id existují.
  if v_konv is null or not app.je_ucastnik(v_konv) then
    raise exception 'K té zprávě nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_typ = 'system' then
    raise exception 'Z události v rozhovoru úkol nevznikne.'
      using errcode = 'check_violation';
  end if;

  -- Právo tasks.manage na pobočce, adresát a jeden cíl — všechno ověří
  -- zadat_ukol. Jedna cesta pro ruční úkol i úkol ze zprávy.
  v_ukol := public.zadat_ukol(
    p_tenant, p_branch, p_nazev, p_poznamka, p_termin, p_priorita,
    p_usek, p_pozice, p_clovek
  );

  update public.tasks t
     set zprava_id     = p_zprava,
         konverzace_id = v_konv,
         zdroj         = 'zprava'
   where t.id = v_ukol
     and t.tenant_id = p_tenant;

  v_ja := app.muj_employee(p_tenant);

  -- Uzavřený rozhovor událost nedostane (poslat_zpravu do něj také nepíše):
  -- úkol z něj vzniknout smí, ale rozhovor se tím neoživí.
  if not exists (
    select 1 from public.konverzace k
     where k.id = v_konv and k.uzavreno_kdy is not null
  ) then
    insert into public.konverzace_zpravy
      (konverzace_id, tenant_id, autor, text, typ, objekt_typ, objekt_id)
    values
      (v_konv, p_tenant, v_ja,
       'Vytvořen úkol: ' || left(btrim(p_nazev), 120),
       'system', 'ukol', v_ukol);
  end if;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'ukol.ze_zpravy',
    p_entity_type => 'task',
    p_entity_id   => v_ukol::text,
    p_branch      => p_branch,
    p_after       => jsonb_build_object('konverzace', v_konv, 'zprava', p_zprava)
  );

  return v_ukol;
end;
$$;

revoke all on function public.zalozit_ukol_ze_zpravy(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.zalozit_ukol_ze_zpravy(
  uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)
  to authenticated;


-- ---------------------------------------------------------------------
-- 5. PRODUCENT: přidělený úkol
--
-- Trigger na tasks pokrývá VŠECHNY cesty, kterými úkol vzniká (ruční
-- zadání, úkol ze zprávy, budoucí generátor) — nemusí se to pamatovat
-- u každé zvlášť.
--
-- Adresáti:
--   * konkrétní člověk (employee_id),
--   * úsek (usek_id) — zaměstnanci úseku; je-li úkol pobočkový, jen ti z
--     té pobočky,
--   * pozice (position_id) — totéž.
-- Úkol pro oprávnění (role_id) nikoho nepípá: je to štítek pro
-- všechny s tím právem, ne osobní zadání.
--
-- Zadavatel sám sebe neupozorňuje. Klíč slučování je konkrétní úkol —
-- upozornění se nesloučí s jiným úkolem.
--
-- Do těla se dává název úkolu (zadal ho člověk k tomuhle účelu), ne text
-- původní zprávy.
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_ukol_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_rec record;
begin
  if NEW.status <> 'open' then
    return NEW;
  end if;

  for v_rec in
    select distinct e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       and e.user_id is distinct from NEW.created_by
       and (
         (NEW.employee_id is not null and e.id = NEW.employee_id)
         or (NEW.usek_id is not null and e.usek_id = NEW.usek_id
             and (NEW.branch_id is null or e.branch_id = NEW.branch_id))
         or (NEW.position_id is not null and e.position_id = NEW.position_id
             and (NEW.branch_id is null or e.branch_id = NEW.branch_id))
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'ukol.pridelen',
      jsonb_strip_nulls(jsonb_build_object(
        'nazev', left(NEW.title, 120),
        'ukol',  NEW.id,
        'termin', case when NEW.due_at is not null
                    then to_char(NEW.due_at at time zone app.zona_pobocky(NEW.branch_id),
                                 'YYYY-MM-DD"T"HH24:MI')
                  end
      )),
      case when NEW.priority = 'high' then 'important' else 'normal' end,
      NEW.branch_id,
      null,
      'ukol',
      NEW.id,
      'ukol.pridelen:' || NEW.id::text
    );
  end loop;

  return NEW;
end $$;

revoke all on function app.upozornit_na_ukol_trg() from public, anon, authenticated;

create trigger upozornit_na_ukol
  after insert on public.tasks
  for each row execute function app.upozornit_na_ukol_trg();


-- ---------------------------------------------------------------------
-- 6. VÝBĚR PŘÍJEMCŮ
--
-- Obrazovka „Nová zpráva“ potřebuje seznam kolegů. Tabulku employees
-- běžný zaměstnanec číst nesmí (jsou v ní i údaje, které mu nepatří), a
-- proto vznikla tahle funkce: vrací JEN to, co výběr potřebuje — id, jméno
-- a zařazení — a jen u lidí, kterým zpráva může dojít (mají účet).
--
--   * jen aktivní zaměstnanci téže firmy s účtem, ne volající sám;
--   * `na_me_pobocce` říká, jestli člověk pracuje na některé z poboček,
--     na které dosáhne volající (domovská pobočka, rozsah členství, nebo
--     celofiremní rozsah — majitel, provozní). UI podle toho řadí: kolegové
--     z mé pobočky nahoře, ostatní hledáním.
--
-- ZÁMĚRNĚ NEOMEZUJE, komu smí kdo psát. Rozhovory mezi pobočkami jsou
-- zamýšlené (krok 24, oddíl 7; krok 25, oddíl 3) a osobní rozhovor dvou
-- kolegů z různých poboček je běžná věc. Zpřísnit to by bylo rozhodnutí o
-- provozu, ne oprava: nechá se v tomhle jednom místě a v zalozit_rozhovor.
-- Původní kontrola „účastník patří do téže firmy“ zůstává beze změny.
-- ---------------------------------------------------------------------

create or replace function public.komu_muzu_psat(p_tenant uuid)
returns table (
  employee_id    uuid,
  jmeno          text,
  branch_id      uuid,
  usek_id        uuid,
  position_id    uuid,
  na_me_pobocce  boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ja uuid;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    return;
  end if;

  v_ja := app.muj_employee(p_tenant);
  if v_ja is null then
    return;
  end if;

  return query
    select e.id,
           e.full_name::text,
           e.branch_id,
           e.usek_id,
           e.position_id,
           (
             e.branch_id in (select app.visible_branch_ids(p_tenant))
             or exists (
               select 1
                 from public.memberships m
                where m.user_id   = e.user_id
                  and m.tenant_id = p_tenant
                  and m.status    = 'active'
                  and (
                    m.scope = 'tenant'
                    or exists (
                      select 1 from public.membership_branches mb
                       where mb.membership_id = m.id
                         and mb.branch_id in (select app.visible_branch_ids(p_tenant))
                    )
                  )
             )
           )
      from public.employees e
     where e.tenant_id  = p_tenant
       and e.deleted_at is null
       and e.user_id    is not null
       and e.id <> v_ja
     order by e.full_name;
end;
$$;

revoke all on function public.komu_muzu_psat(uuid) from public, anon;
grant execute on function public.komu_muzu_psat(uuid) to authenticated;

comment on function public.komu_muzu_psat(uuid) is
  'Kolegové, kterým může přihlášený napsat (výběr příjemců): aktivní '
  'zaměstnanci firmy s účtem, ne on sám. Vrací jen id, jméno a zařazení. '
  'na_me_pobocce = pracuje na pobočce, na kterou volající dosáhne.';



-- ---------------------------------------------------------------------
-- 7. kdo_nepotvrdil: kontrola oprávnění uvnitř funkce
--
-- Funkce je definer a vrací jména lidí, kteří oznámení nepotvrdili.
-- Právo communication.manage hlídalo jen UI (vzkazy/nastenka.tsx) —
-- kdokoli přihlášený, kdo znal id oznámení a firmy, dostal jména.
-- Zbytek je živé znění beze změny.
-- ---------------------------------------------------------------------

create or replace function public.kdo_nepotvrdil(p_tenant uuid, p_announcement uuid)
returns table (jmeno text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_branch_id   uuid;
  v_usek_id     uuid;
  v_position_id uuid;
  v_author_id   uuid;
begin
  if not app.has_permission(p_tenant, 'communication.manage') then
    return;
  end if;

  select a.employee_id, a.branch_id, a.usek_id, a.position_id, a.author_id
    into v_employee_id, v_branch_id, v_usek_id, v_position_id, v_author_id
    from public.announcements a
   where a.id = p_announcement
     and a.tenant_id = p_tenant
     and a.requires_acknowledgment = true;

  if not found then return; end if;

  -- ROZSAH: právo na oznámení TÉTO pobočky (celofiremní oznámení = celofiremní
  -- rozsah), stejně jako politika announcements_write. Definer nemá druhou
  -- linii RLS; bez tohohle by vedoucí jedné pobočky viděl jména lidí z ostatních.
  if not app.has_access(p_tenant, 'communication.manage', v_branch_id) then
    return;
  end if;

  return query
    select coalesce(nullif(trim(p.full_name::text), ''), 'Neznámý') as jmeno
      from public.employees e
      left join public.profiles p on p.user_id = e.user_id
     where e.tenant_id  = p_tenant
       and e.deleted_at is null
       and e.user_id    is not null
       and (v_author_id is null or e.user_id <> v_author_id)
       and (
         (v_employee_id  is not null and e.id          = v_employee_id)
         or (v_usek_id   is not null and e.usek_id     = v_usek_id
               and v_employee_id is null)
         or (v_position_id is not null and e.position_id = v_position_id
               and v_employee_id is null and v_usek_id is null)
         or (v_branch_id is not null
               and v_employee_id is null and v_usek_id is null and v_position_id is null
               and e.branch_id = v_branch_id)
         or (v_employee_id is null and v_usek_id is null
               and v_position_id is null and v_branch_id is null)
       )
       and not exists (
         select 1 from public.announcement_reads ar
          where ar.announcement_id = p_announcement
            and ar.user_id         = e.user_id
       )
     order by jmeno;
end $$;


-- ---------------------------------------------------------------------
-- 8. JMÉNA V ROZHOVORU
--
-- Účastníci rozhovoru se potřebují vidět jménem, ale běžný zaměstnanec
-- nesmí číst tabulku employees (jen svůj řádek, nebo kolegy podle
-- oprávnění). Obrazovka proto dosud ukazovala „kdosi“ všude, kde jméno
-- nešlo přečíst. Tyhle dvě funkce vrací JEN jména lidí, kteří v rozhovoru
-- už jsou — kdo v něm není, nedostane nic. Tím se nikomu nevydává víc,
-- než co v rozhovoru stejně vidí.
--
-- DEFINER BEZ DRUHÉ LINIE: účastnictví si funkce hlídá sama
-- (app.je_ucastnik), firmu bere z rozhovoru.
-- ---------------------------------------------------------------------

create or replace function public.lide_v_rozhovoru(p_konverzace uuid)
returns table (employee_id uuid, jmeno text)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.full_name::text
    from public.employees e
    join public.konverzace k on k.tenant_id = e.tenant_id
   where k.id = p_konverzace
     and app.modul_zapnuty(k.tenant_id, 'provoz')
     and app.je_ucastnik(p_konverzace)
     and (
       e.id in (select u.employee_id from public.konverzace_ucastnici u
                 where u.konverzace_id = p_konverzace)
       or e.id in (select z.autor from public.konverzace_zpravy z
                    where z.konverzace_id = p_konverzace and z.autor is not null)
     );
$$;

revoke all on function public.lide_v_rozhovoru(uuid) from public, anon;
grant execute on function public.lide_v_rozhovoru(uuid) to authenticated;

comment on function public.lide_v_rozhovoru(uuid) is
  'Jména účastníků a autorů zpráv v rozhovoru, jehož je volající účastníkem. '
  'Kdo účastník není, nedostane nic.';


-- Název osobního rozhovoru bez názvu ukazuje ostatní účastníky, ne
-- „Osobní“. Každý vidí JINÝ název (ten druhý), proto se skládá pro
-- přihlášeného, ne ukládá do konverzace.
create or replace function public.jmena_osobnich_rozhovoru(p_tenant uuid)
returns table (konverzace_id uuid, nazev text)
language sql stable security definer set search_path = ''
as $$
  select k.id,
         string_agg(e.full_name::text, ', ' order by e.full_name)
    from public.konverzace k
    join public.konverzace_ucastnici ja
      on ja.konverzace_id = k.id
     and ja.employee_id   = app.muj_employee(p_tenant)
     and ja.odesel_kdy    is null
    join public.konverzace_ucastnici o
      on o.konverzace_id = k.id
     and o.employee_id  <> ja.employee_id
     and o.odesel_kdy    is null
    join public.employees e
      on e.id = o.employee_id
     and e.tenant_id = p_tenant
   where k.tenant_id = p_tenant
     and k.druh      = 'osobni'
     and k.nazev     is null
     and app.modul_zapnuty(p_tenant, 'provoz')
   group by k.id;
$$;

revoke all on function public.jmena_osobnich_rozhovoru(uuid) from public, anon;
grant execute on function public.jmena_osobnich_rozhovoru(uuid) to authenticated;

comment on function public.jmena_osobnich_rozhovoru(uuid) is
  'Názvy osobních rozhovorů bez názvu, jak je vidí volající: jména ostatních '
  'účastníků. Rozhovory s vlastním názvem se nevracejí.';


-- ---------------------------------------------------------------------
-- 9. moje_rozhovory: systémová událost není nepřečtená zpráva
--
-- „Vytvořen úkol“ v rozhovoru (typ = 'system') se do počtu nepřečtených
-- nesmí započítat: účastníkům by u rozhovoru svítilo „1 nepřečtená“ a v
-- odznaku by přibylo číslo za zprávu, kterou nikdo nenapsal. Vlákno samo
-- událost ukazuje, dělítko „Nové zprávy“ ji nepočítá (lib/komunikace/vlakno.ts).
--
-- Zbytek je ŽIVÉ znění (pg_get_functiondef z 21. 9. 2026), změněné jsou jen
-- tři podmínky `z.typ = 'zprava'`. Návratový tvar se nemění — stránky ho čtou
-- (layout, vzkazy, dnes).
-- ---------------------------------------------------------------------

create or replace function public.moje_rozhovory(p_tenant uuid)
returns table (
  konverzace_id uuid, druh text, branch_id uuid, nazev text, adresat text,
  posledni_kdy timestamptz, neprectenych integer, ceka integer, uzavreno_kdy timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with ja as (
    select app.muj_employee(p_tenant) as emp
  ),
  muj_usek as (
    select e.usek_id from public.employees e
    where e.id = (select emp from ja)
  ),
  smena as (
    select app.smena_ted(p_tenant, (select emp from ja)) as pobocka
  ),
  moje as (
    select k.*, u.precteno_do
    from public.konverzace k
    left join public.konverzace_ucastnici u
      on u.konverzace_id = k.id
     and u.employee_id = (select emp from ja)
    where k.tenant_id = p_tenant
      and (
        (u.employee_id is not null and u.odesel_kdy is null)
        or (
          k.druh = 'pobocka'
          and k.branch_id in (select app.visible_branch_ids(p_tenant))
        )
        or (
          k.druh = 'usek'
          and k.usek_id is not null
          and k.usek_id = (select usek_id from muj_usek)
        )
      )
  )
  select
    m.id,
    m.druh,
    m.branch_id,
    m.nazev,
    m.adresat,
    max(z.vytvoreno_kdy) filter (where z.stornovano_kdy is null),
    count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    )::integer,
    count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
        and not app.doruci_se((select pobocka from smena), m.branch_id, z.nalehava)
    )::integer,
    m.uzavreno_kdy
  from moje m
  left join public.konverzace_zpravy z on z.konverzace_id = m.id
  where
    app.modul_zapnuty(p_tenant, 'provoz')
    and (select emp from ja) is not null
  group by m.id, m.druh, m.branch_id, m.nazev, m.adresat, m.uzavreno_kdy, m.precteno_do
  order by
    (count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) > 0) desc,
    min(z.vytvoreno_kdy) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) asc nulls last,
    max(z.vytvoreno_kdy) desc nulls last;
$$;
