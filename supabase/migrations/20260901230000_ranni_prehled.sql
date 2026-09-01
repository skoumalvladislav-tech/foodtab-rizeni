-- =====================================================================
-- Foodtab — ranní přehled majiteli
--
-- Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíl 8.
--
-- Shrnuje MINULÝ PROVOZNÍ DEN, ne kalendářní (pravidlo 10). Kdo skončil
-- ve 2:15, patří do včerejška.
--
-- ---------------------------------------------------------------------
-- CO V TOM E-MAILU JE A CO V NĚM NENÍ
--
-- Jsou v něm POČTY a ČÁSTKY za pobočku. Nejsou v něm jména, příchody
-- ani částky po lidech — ty jsou až v aplikaci po přihlášení.
--
-- Není to opatrnost navíc: e-mail leží v cizí schránce, na telefonu
-- i v záloze poštovní služby. Osobní údaje zaměstnanců by tím
-- z aplikace odešly nadobro a už by se nedaly vzít zpět.
--
-- Funkce níž proto vrací JEN čísla. Kdyby se do ní jednou přidalo
-- jméno, dostane se do e-mailu samo — na to pozor.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KOMU A V KOLIK
--
-- Adresáti jsou na POBOČCE, ne na firmě: každá pobočka může mít jiného
-- (zadání, oddíl 8). Čas je firemní — posílat každou pobočku jindy
-- nikdo nechtěl a přidat to jde kdykoli.
--
-- VÝCHOZÍ HODNOTA JE PRÁZDNÁ. Žádnou adresu ani hodinu si nevymýšlím;
-- doplní je zákazník v aplikaci (rozhodnutí ze 1. 9., „Co zbývá“).
-- Prázdný seznam znamená, že se nikomu neposílá — ne že se posílá
-- někam, kam si to nikdo nepřál.
-- ---------------------------------------------------------------------

alter table public.branches
  add column if not exists ranni_email_komu text[] not null default '{}';

comment on column public.branches.ranni_email_komu is
  'Adresáti ranního přehledu za tuhle pobočku. Prázdné = neposílá se.';

/*
  POZOR: `branches` má odebrané čtení celé tabulky a granty po sloupcích
  (migrace 20260901170000 kvůli kiosk_secret). Nový sloupec se proto
  musí přidat i sem — jinak by ho aplikace nepřečetla a formulář by
  ukazoval prázdno u pobočky, která adresáta má.
*/
grant select (
  id, tenant_id, name, slug, address, timezone, opening_hours,
  day_starts_at, active, created_at, deleted_at, color, kiosk_kod_vterin,
  ranni_email_komu
) on public.branches to authenticated;

alter table public.tenant_settings
  add column if not exists ranni_email_kdy time;

comment on column public.tenant_settings.ranni_email_kdy is
  'V kolik ráno přehled odchází. Prázdné = neposílá se vůbec.';

grant select (
  tenant_id, zalohy_zobrazeni, zaloha_max_haleru, ranni_email_kdy,
  updated_at, updated_by
) on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- ZÁZNAM O ODESLÁNÍ
--
-- Když pošta selže, musí to být vidět. Přehled, o kterém si majitel
-- myslí, že chodí, a on nechodí, je horší než žádný.
--
-- Zapisuje se i NEúspěch — proto `stav`, ne jen řádek za každé odeslání.
-- ---------------------------------------------------------------------

create table if not exists public.morning_reports (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete cascade,
  den        date not null,
  komu       text[] not null default '{}',
  stav       text not null check (stav in ('odeslano', 'chyba', 'nikomu')),
  chyba      text,
  odeslano_kdy timestamptz not null default now(),
  unique (branch_id, den)
);

comment on table public.morning_reports is
  'Co se ráno odeslalo a jak to dopadlo. Neúspěch se zapisuje taky — '
  'přehled, o kterém si majitel myslí, že chodí, je horší než žádný.';

grant select (id, tenant_id, branch_id, den, komu, stav, chyba, odeslano_kdy)
  on public.morning_reports to authenticated;

alter table public.morning_reports enable row level security;

drop policy if exists morning_reports_select on public.morning_reports;
create policy morning_reports_select on public.morning_reports for select to authenticated
  using (app.can_read_scoped(tenant_id, 'settings.manage', branch_id));

-- Zapisuje úloha na serveru servisním klíčem, ne aplikace.
revoke insert, update, delete on public.morning_reports from authenticated;


-- ---------------------------------------------------------------------
-- PODKLAD PRO PŘEHLED
--
-- Jeden řádek na pobočku. Samá čísla — viz hlavička souboru.
--
-- `p_den` je PROVOZNÍ den. Volající ho posílá, protože „včera“ se
-- u pobočky s noční otvírací dobou počítá jinak než u pobočky, která
-- zavírá v šest.
-- ---------------------------------------------------------------------

create or replace function public.ranni_prehled(p_tenant uuid, p_den date)
returns table (
  branch_id           uuid,
  pobocka             text,
  komu                text[],
  lidi                integer,
  odpracovano_minut   integer,
  rucnich_zapisu      integer,
  nedokoncenych       integer,
  zaloh               integer,
  zaloh_haleru        integer,
  zaloh_nepotvrzenych integer
)
language sql stable security definer set search_path = ''
as $$
  select
    b.id,
    b.name,
    b.ranni_email_komu,
    coalesce(d.lidi, 0),
    coalesce(d.minut, 0),
    coalesce(d.rucnich, 0),
    coalesce(d.nedokoncenych, 0),
    coalesce(z.pocet, 0),
    coalesce(z.haleru, 0),
    coalesce(z.nepotvrzenych, 0)
  from public.branches b
  left join lateral (
    select
      count(distinct a.employee_id)::integer as lidi,
      /*
        Odpracované minuty se počítají z dvojic příchod–odchod. Otevřený
        příchod se do součtu NEDOSTANE (dvojice není úplná) a připočte se
        do `nedokoncenych` — z vymyšleného času odchodu se mzda počítat
        nesmí.
      */
      coalesce(sum(
        case when a.kind = 'out' then
          extract(epoch from a.occurred_at - (
            select max(v.occurred_at) from public.attendance_events v
            where v.employee_id = a.employee_id
              and v.branch_id = a.branch_id
              and v.business_date = a.business_date
              and v.kind = 'in'
              and v.occurred_at < a.occurred_at
          )) / 60
        end
      ), 0)::integer as minut,
      count(*) filter (where a.source = 'manual')::integer as rucnich,
      count(*) filter (
        where a.kind = 'in' and not exists (
          select 1 from public.attendance_events o
          where o.employee_id = a.employee_id
            and o.branch_id = a.branch_id
            and o.business_date = a.business_date
            and o.kind = 'out'
            and o.occurred_at > a.occurred_at
        )
      )::integer as nedokoncenych
    from public.attendance_events a
    where a.branch_id = b.id and a.business_date = p_den
  ) d on true
  left join lateral (
    select
      count(*)::integer as pocet,
      coalesce(sum(x.castka_haleru), 0)::integer as haleru,
      count(*) filter (where x.stav = 'nepotvrzena')::integer as nepotvrzenych
    from public.advances x
    where x.branch_id = b.id and x.business_date = p_den
      and x.stav <> 'stornovana'
  ) z on true
  where b.tenant_id = p_tenant
    and b.deleted_at is null
    and b.active
    and app.has_access(p_tenant, 'settings.manage')
  order by b.name;
$$;

comment on function public.ranni_prehled(uuid, date) is
  'Souhrn provozního dne po pobočkách. JEN ČÍSLA — jména a částky po '
  'lidech patří do aplikace, ne do e-mailu.';

revoke all on function public.ranni_prehled(uuid, date) from public, anon;
grant execute on function public.ranni_prehled(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- NASTAVENÍ
--
-- Čas i adresáti najednou: kdyby se ukládaly zvlášť, dala by se firma
-- nechat ve stavu „adresáti jsou, čas není“, což je jen jinak zapsané
-- „neposílá se“ a nikdo by nevěděl proč.
--
-- Adresy se kontrolují tady, ne až v poště. Překlep v adrese znamená
-- přehled, který nikam nedojde — a to je přesně ten tichý neúspěch,
-- kvůli kterému se odeslání zaznamenává.
-- ---------------------------------------------------------------------

create or replace function public.nastavit_ranni_email(
  p_tenant   uuid,
  p_kdy      time,
  p_pobocka  uuid,
  p_komu     text[]
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_puvodni text[];
  v_adresa  text;
  v_ciste   text[] := '{}';
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení firmy mění jen správce nastavení.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.branches
    where id = p_pobocka and tenant_id = p_tenant and deleted_at is null
  ) then
    raise exception 'Pobočka nepatří téhle firmě.' using errcode = 'foreign_key_violation';
  end if;

  foreach v_adresa in array coalesce(p_komu, '{}') loop
    v_adresa := lower(btrim(v_adresa));
    continue when v_adresa = '';
    if position('@' in v_adresa) = 0 or v_adresa like '% %' then
      raise exception 'Tohle není e-mailová adresa: %', v_adresa
        using errcode = 'check_violation';
    end if;
    v_ciste := v_ciste || v_adresa;
  end loop;

  select b.ranni_email_komu into v_puvodni
  from public.branches b where b.id = p_pobocka;

  update public.branches set ranni_email_komu = v_ciste where id = p_pobocka;

  insert into public.tenant_settings (tenant_id, ranni_email_kdy, updated_at, updated_by)
  values (p_tenant, p_kdy, now(), (select auth.uid()))
  on conflict (tenant_id) do update
    set ranni_email_kdy = excluded.ranni_email_kdy,
        updated_at = now(),
        updated_by = excluded.updated_by;

  perform app.audit(p_tenant, 'settings.ranni_email', 'branch', p_pobocka::text,
                    p_pobocka,
                    jsonb_build_object('komu', v_puvodni),
                    jsonb_build_object('komu', v_ciste, 'kdy', p_kdy));
end;
$$;

revoke all on function public.nastavit_ranni_email(uuid, time, uuid, text[]) from public, anon;
grant execute on function public.nastavit_ranni_email(uuid, time, uuid, text[]) to authenticated;
