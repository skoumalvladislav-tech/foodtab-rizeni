-- =====================================================================
-- Foodtab — osobní údaje zaměstnanců a informování o zpracování
--
-- Zadání: docs/osobni-udaje-zadani.md, rozsah na noc podle
-- docs/nocni-prace-2026-09-01.md.
--
-- Nejdůležitější věta celého zadání: INFORMOVAT, NE ŽÁDAT O SOUHLAS.
-- Souhlas mezi zaměstnavatelem a zaměstnancem není svobodný a dá se
-- odvolat; kdyby na něm stála docházka, odvoláním by muselo přestat
-- počítání mzdy. Proto se tady nikde neukládá „souhlasím se
-- zpracováním“, ale „vzal jsem na vědomí verzi X“.
--
-- Souhlas je jen na to, co je opravdu dobrovolné, a musí jít odvolat
-- jedním kliknutím — a to odvolání musí něco udělat.
--
-- CO TU ZÁMĚRNĚ NENÍ:
--
--   * `address` — Šéfík ještě nerozhodl, jestli ji aplikace potřebuje.
--     Údaj, který se musí chránit, zálohovat a mazat, a k ničemu
--     neslouží, se nesbírá. Otázka je v ranní zprávě.
--   * lhůty uchování a úloha, která kontakty po odchodu vyprázdní
--     (oddíl 5 zadání) — na noc se nevešly.
--   * pravý text informace. Zakládá se ZÁSTUPNÝ, viditelně označený.
--     Aplikace, která ukáže vymyšlený právní text jako závazný, je
--     horší než ta, která neukáže nic.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KONTAKTNÍ ÚDAJE
--
-- Telefon a e-mail jsou osobní údaje jako mzda a chovají se stejně:
-- `authenticated` na ně přes tabulku NEDOSÁHNE vůbec. Čte se úzkým
-- průzorem, který u každého řádku zvlášť rozhodne, jestli ho volající
-- vidět smí. Číšník nepotřebuje telefon kuchaře.
--
-- Právní titul je plnění smlouvy (přihlášení a pozvánka do aplikace),
-- ne souhlas — proto se na ně nikdo neptá a nedají se odmítnout.
-- ---------------------------------------------------------------------

alter table public.employees
  add column if not exists phone text,
  add column if not exists email text;

-- Tvar se hlídá stejně jako u pozvánek: telefon v mezinárodním tvaru,
-- e-mail aspoň se zavináčem. Prázdný řetězec je NULL, ať se nerozlišuje
-- „nevyplněno“ od „vyplněno prázdnem“.
alter table public.employees
  drop constraint if exists employees_phone_tvar;
alter table public.employees
  add constraint employees_phone_tvar
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

alter table public.employees
  drop constraint if exists employees_email_tvar;
alter table public.employees
  add constraint employees_email_tvar
  check (email is null or (position('@' in email) > 1 and email = lower(btrim(email))));


-- ---------------------------------------------------------------------
-- PRÁVO NA SLOUPEC, NE JEN NA ŘÁDEK
--
-- Stejný postup jako u pozvánek (20260826180000): nejdřív se sebere
-- čtení celé tabulky, teprve pak se vrátí po sloupcích. Dokud platí
-- právo na celou tabulku, odebrání jednoho sloupce se neprojeví —
-- Postgres širší právo nepřebije.
--
-- POZOR: každá budoucí migrace s `grant select on all tables in schema
-- public to authenticated` tuhle výjimku zase smaže. Když takový řádek
-- budete psát, přidejte za něj znovu tenhle blok.
--
-- Zápis se neomezuje: `employees_write` už drží people.manage. Kdo smí
-- zaměstnance upravovat, smí mu vyplnit i telefon — jen si ho pak
-- nepřečte přes tabulku, ale průzorem.
-- ---------------------------------------------------------------------

revoke select on public.employees from authenticated;

grant select (
  id, tenant_id, branch_id, user_id, position_id, full_name,
  employment_type, started_on, ended_on, active, created_at, deleted_at
) on public.employees to authenticated;


-- ---------------------------------------------------------------------
-- DOBROVOLNÉ SOUHLASY
--
-- Katalog, ne seznam v kódu (pravidlo 1). `ma_ucinek` říká, jestli za
-- tím souhlasem dnes něco opravdu je — souhlas, po jehož odvolání se
-- nic nestane, je podle zadání horší než žádný, takže se takový
-- v rozhraní nenabízí.
-- ---------------------------------------------------------------------

create table if not exists public.consent_kinds (
  key         text primary key,
  label       text not null,
  popis       text not null,
  -- false = funkce, které by se to týkalo, ještě neexistuje
  ma_ucinek   boolean not null default false,
  sort_order  integer not null default 100
);

insert into public.consent_kinds (key, label, popis, ma_ucinek, sort_order) values
  ('kontakt_kolegum',
   'Kolegové smějí vidět můj telefon',
   'Bez tohohle vidí telefon jen ten, kdo spravuje lidi. Se souhlasem ho '
   'uvidí i kolegové ve firmě — třeba když je potřeba se domluvit na výměně '
   'směny. Kdykoli to jde vypnout a telefon se hned zase schová.',
   true, 10),
  ('fotka',
   'Fotka nebo iniciály v aplikaci',
   'Zatím nic nezapíná — fotky aplikace neumí. Nabídne se, až to bude mít '
   'co vypnout.',
   false, 20),
  ('narozeniny',
   'Narozeniny na nástěnce',
   'Zatím nic nezapíná — narozeniny se nikde neevidují ani nezobrazují.',
   false, 30)
on conflict (key) do update
  set label = excluded.label,
      popis = excluded.popis,
      ma_ucinek = excluded.ma_ucinek,
      sort_order = excluded.sort_order;

comment on table public.consent_kinds is
  'Co jde dobrovolně povolit. Souhlas se dává jen na to, co je opravdu '
  'dobrovolné — na plnění smlouvy (docházka, mzda, přihlášení) se neptá.';


create table if not exists public.consents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  kind       text not null references public.consent_kinds(key),
  granted    boolean not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, kind)
);

comment on table public.consents is
  'Dobrovolné souhlasy. Chybějící řádek znamená NEUDĚLENO — mlčení není '
  'souhlas a nedá se za něj vydávat.';


-- ---------------------------------------------------------------------
-- INFORMACE O ZPRACOVÁNÍ
--
-- Verze je podstatná: až se text změní, musí se ukázat znovu. Proto se
-- nezaznamenává „vzal na vědomí“, ale „vzal na vědomí TUHLE verzi“.
--
-- `je_zastupny` drží pravdu o tom, že text ještě nepsal právník. Podle
-- něj obrazovka kreslí varování a nedá se to omylem přehlédnout.
-- ---------------------------------------------------------------------

create table if not exists public.privacy_notices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  verze       integer not null,
  text_info   text not null,
  je_zastupny boolean not null default true,
  platna_od   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (tenant_id, verze)
);

create table if not exists public.privacy_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  notice_id       uuid not null references public.privacy_notices(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (tenant_id, user_id, notice_id)
);

comment on table public.privacy_acknowledgements is
  'Kdo, kdy a KTEROU VERZI vzal na vědomí. Není to souhlas — informace '
  'o zpracování se nepodepisuje, jen se sděluje.';


-- ---------------------------------------------------------------------
-- ZÁSTUPNÝ TEXT
--
-- Zakládá se pro každou firmu, která ještě žádný nemá, a pro každou
-- novou. Text je schválně nepoužitelný jako právní dokument — je v něm
-- napsané, že je nehotový.
-- ---------------------------------------------------------------------

create or replace function app.zalozit_zastupnou_informaci(p_tenant uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.privacy_notices where tenant_id = p_tenant) then
    return;
  end if;

  -- Dolarové uvozovky, ne řetězec s escapy: text má odstavce a čte ho
  -- člověk. Opakované E'...' se navíc v Postgresu nespojí.
  insert into public.privacy_notices (tenant_id, verze, text_info, je_zastupny)
  values (
    p_tenant,
    1,
$info$TOHLE JE ZÁSTUPNÝ TEXT. NENÍ TO PRÁVNÍ DOKUMENT.

Skutečné znění musí napsat nebo zkontrolovat právník. Do té doby tady
stojí jen kostra, aby bylo vidět, co v ní má být — a aby si nikdo
nemyslel, že tohle je hotové.

Kdo údaje zpracovává: ______ (vaše firma jako správce).

Jaké údaje: jméno, kontakt, pracovní poměr, odpracované hodiny,
docházka, mzdová sazba.

Proč: plnění pracovní smlouvy a zákonné povinnosti. Na tyhle údaje se
nežádá souhlas — bez nich nejde vyplatit mzda ani vést evidenci.

Jak dlouho: ______ (doplní právník podle zákonných lhůt).

Komu se předávají: ______ (například účetní, pokladní systém).

Vaše práva: vědět, co o vás firma má, nechat si to vydat, nechat si
opravit chybu a nechat smazat to, co se smazat smí. V aplikaci k tomu
slouží obrazovka Moje údaje.$info$,
    true
  );
end;
$$;

revoke all on function app.zalozit_zastupnou_informaci(uuid) from public, anon, authenticated;

-- Pro firmy, které už existují.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.tenants where deleted_at is null loop
    perform app.zalozit_zastupnou_informaci(v_id);
  end loop;
end $$;

-- A pro každou další. Ať nová firma nezůstane bez informace jen proto,
-- že ji nikdo nezaložil ručně.
create or replace function app.informace_pro_novou_firmu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.zalozit_zastupnou_informaci(new.id);
  return null;
end;
$$;

drop trigger if exists trg_informace_pro_novou_firmu on public.tenants;
create trigger trg_informace_pro_novou_firmu
  after insert on public.tenants
  for each row execute function app.informace_pro_novou_firmu();


-- ---------------------------------------------------------------------
-- ŘÁDKOVÁ BEZPEČNOST
-- ---------------------------------------------------------------------

-- Práva na nové tabulky se dávají VYJMENOVANĚ, ne přes `grant on all
-- tables in schema public`. Ten by vrátil čtení všech sloupců tabulek
-- `employees` a `invitations` a zrušil by obě výjimky, kvůli kterým se
-- kontakty a otisky tokenů přes tabulku nečtou. Přesně před tím varuje
-- poznámka v migraci 20260826180000.
grant select on public.consent_kinds to authenticated;
grant select, insert, update, delete on public.consents to authenticated;
grant select, insert, update, delete on public.privacy_notices to authenticated;
grant select, insert on public.privacy_acknowledgements to authenticated;

alter table public.consent_kinds            enable row level security;
alter table public.consents                 enable row level security;
alter table public.privacy_notices          enable row level security;
alter table public.privacy_acknowledgements enable row level security;

-- Katalog čte každý přihlášený; je to seznam možností, ne osobní údaj.
drop policy if exists consent_kinds_select on public.consent_kinds;
create policy consent_kinds_select on public.consent_kinds for select to authenticated
  using (true);

-- Souhlas je můj. Vidí ho jen ten, koho se týká, a správce lidí —
-- ten musí umět odpovědět, co o kom firma eviduje.
drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or app.has_access(tenant_id, 'people.manage'));

-- Měnit ho smí JEN ten člověk sám. Ani majitel nesmí za někoho souhlas
-- udělit — to už by nebyl souhlas.
drop policy if exists consents_write on public.consents;
create policy consents_write on public.consents for all to authenticated
  using (user_id = (select auth.uid()) and app.is_member(tenant_id))
  with check (user_id = (select auth.uid()) and app.is_member(tenant_id));

-- Informaci vidí každý ve firmě. Je to text určený jemu.
drop policy if exists privacy_notices_select on public.privacy_notices;
create policy privacy_notices_select on public.privacy_notices for select to authenticated
  using (app.is_member(tenant_id));

drop policy if exists privacy_notices_write on public.privacy_notices;
create policy privacy_notices_write on public.privacy_notices for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage'))
  with check (app.has_access(tenant_id, 'settings.manage'));

-- „Vzal na vědomí“ zapisuje každý sám za sebe a nedá se to vzít zpět
-- ani přepsat: co bylo sděleno, bylo sděleno.
drop policy if exists privacy_ack_select on public.privacy_acknowledgements;
create policy privacy_ack_select on public.privacy_acknowledgements for select to authenticated
  using (user_id = (select auth.uid()) or app.has_access(tenant_id, 'people.manage'));

drop policy if exists privacy_ack_insert on public.privacy_acknowledgements;
create policy privacy_ack_insert on public.privacy_acknowledgements for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_member(tenant_id));

-- Pojistka pro případ, že by někdo v budoucnu přidal širší grant.
revoke update, delete on public.privacy_acknowledgements from authenticated;


-- ---------------------------------------------------------------------
-- AUDIT
--
-- Spoušť je tatáž jako u lidí a rolí. U souhlasů je to podstatné: musí
-- být dohledatelné, že ho člověk udělil sám a kdy ho odvolal.
-- ---------------------------------------------------------------------

drop trigger if exists trg_audit_consents on public.consents;
create trigger trg_audit_consents
  after insert or update or delete on public.consents
  for each row execute function app.audit_zmenu('consent');

drop trigger if exists trg_audit_privacy_ack on public.privacy_acknowledgements;
create trigger trg_audit_privacy_ack
  after insert or update or delete on public.privacy_acknowledgements
  for each row execute function app.audit_zmenu('privacy_ack');

drop trigger if exists trg_audit_privacy_notices on public.privacy_notices;
create trigger trg_audit_privacy_notices
  after insert or update or delete on public.privacy_notices
  for each row execute function app.audit_zmenu('privacy_notice');


-- ---------------------------------------------------------------------
-- PRŮZOR NA KONTAKTY
--
-- Vrací jen řádky, na které volající dosáhne, a u každého říká proč.
-- Tři důvody, seřazené od nejsilnějšího:
--
--   'moje'      — je to můj vlastní záznam
--   'sprava'    — mám people.manage na jeho pobočce
--   'kolega'    — ten člověk sám povolil kolegům vidět telefon
--
-- U kolegy se vrací JEN telefon. E-mail je přihlašovací údaj a k výměně
-- směny ho nikdo nepotřebuje.
-- ---------------------------------------------------------------------

create or replace function public.employee_contacts(p_tenant uuid)
returns table (
  employee_id uuid,
  full_name   text,
  phone       text,
  email       text,
  duvod       text
)
language sql stable security definer set search_path = ''
as $$
  select
    e.id,
    e.full_name,
    -- Telefon se vrací ve všech třech případech; o tom, jestli se řádek
    -- vůbec vrátí, rozhoduje podmínka níž. Rozlišuje se až e-mail.
    e.phone,
    case
      when e.user_id = (select auth.uid()) then e.email
      when app.has_access(p_tenant, 'people.manage', e.branch_id) then e.email
      else null
    end,
    case
      when e.user_id = (select auth.uid()) then 'moje'
      when app.has_access(p_tenant, 'people.manage', e.branch_id) then 'sprava'
      else 'kolega'
    end
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (
      e.user_id = (select auth.uid())
      or app.has_access(p_tenant, 'people.manage', e.branch_id)
      or (
        app.is_member(p_tenant)
        and e.user_id is not null
        and exists (
          select 1 from public.consents c
          where c.tenant_id = p_tenant
            and c.user_id = e.user_id
            and c.kind = 'kontakt_kolegum'
            and c.granted
        )
      )
    );
$$;

comment on function public.employee_contacts(uuid) is
  'Kontakty, na které volající dosáhne. Kolega vidí telefon jen tehdy, '
  'když to ten člověk sám povolil — a jen telefon, ne e-mail.';

revoke all on function public.employee_contacts(uuid) from public, anon;
grant execute on function public.employee_contacts(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- OPRAVA VLASTNÍCH ÚDAJŮ
--
-- Zaměstnanec si kontakt mění sám (právo na opravu). Přes tabulku to
-- nejde — `employees_write` drží people.manage a to je správně, jinak
-- by si každý mohl přepsat pobočku nebo typ poměru.
--
-- Mění se PRÁVĚ A JEN telefon a e-mail, a právě a jen na vlastním
-- řádku. Prázdný vstup znamená vymazat.
-- ---------------------------------------------------------------------

create or replace function public.set_my_contact(
  p_tenant uuid,
  p_phone  text,
  p_email  text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id    uuid;
begin
  if not app.is_member(p_tenant) then
    raise exception 'K téhle firmě nepatříte.' using errcode = 'insufficient_privilege';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Telefon zadejte v mezinárodním tvaru, například +420601234567.'
      using errcode = 'check_violation';
  end if;

  if v_email is not null and position('@' in v_email) < 2 then
    raise exception 'Neplatná e-mailová adresa.' using errcode = 'check_violation';
  end if;

  select e.id into v_id
  from public.employees e
  where e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null;

  if v_id is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
  end if;

  update public.employees
     set phone = v_phone, email = v_email
   where id = v_id;
end;
$$;

comment on function public.set_my_contact(uuid, text, text) is
  'Oprava vlastních kontaktních údajů. Jen telefon a e-mail, jen vlastní '
  'řádek — zbytek zaměstnaneckého záznamu patří správci lidí.';

revoke all on function public.set_my_contact(uuid, text, text) from public, anon;
grant execute on function public.set_my_contact(uuid, text, text) to authenticated;
