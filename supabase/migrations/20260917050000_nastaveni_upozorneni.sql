-- Uživatelské nastavení upozornění (kategorie zapnuto/vypnuto).
--
-- Noční zadání "KOMUNIKACE / VZKAZY 2.0", bod 4 z doporučeného
-- pořadí v docs/hlaseni/komunikace-current-state-map-2026-09-17.md
-- (mapa, bod 3.4): žádná obrazovka, kde by si člověk zapnul/vypnul
-- kategorie upozornění — a "Změny mých směn" podle zadání NESMÍ jít
-- vypnout.
--
-- DVĚ KATEGORIE, NE VÍC. `vzkazy` (nová zpráva/rozhovor) a `nastenka`
-- (nové oznámení) jsou informativní — kdo je vypne, nic operačního
-- nezmešká. Marketing, docházka, pozvánky, PIN zůstávají bez
-- přepínače — noční zadání je jako kategorie nejmenuje a vymýšlet
-- přepínače, které nikdo nežádal, sem nepatří.
--
-- SMĚNY (smena.*) SEM VŮBEC NEPATŘÍ. Pojistka nesmí záviset na tom,
-- že tahle tabulka žádnou kategorii "smeny" neobsahuje náhodou —
-- `app.upozorneni_povoleno` se z app.upozornit_smenu() vůbec NEVOLÁ,
-- takže vynucení je strukturální, ne "nikdo to nenastavil".

create table public.notification_preferences (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  kategorie  text not null check (kategorie in ('vzkazy', 'nastenka')),
  povoleno   boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, kategorie)
);

comment on table public.notification_preferences is
  'Osobní nastavení, které kategorie upozornění se mají zakládat. '
  'Chybí-li řádek pro danou kategorii, je považovaná za povolenou '
  '(výchozí = zapnuto — nesmí se stát, že prázdná tabulka ztiší '
  'upozornění nikomu). Směny (smena.*) sem záměrně nepatří.';

alter table public.notification_preferences enable row level security;

-- Přímý přístup, žádná RPC obálka — vlastní přepínač nemá co skrývat
-- ani co ověřovat navíc, na rozdíl od zápisu do konverzace_zpravy.
--
-- `app.is_member(tenant_id)` navíc k `user_id = auth.uid()`: bez něj
-- by člověk se dvěma firmami mohl PostgREST voláním mimo appku (bez
-- bezpecnyRozsah) zapsat řádek pro tenant_id, ke kterému nepatří —
-- žádný únik dat (pořád jen jeho vlastní user_id), ale obchází to
-- rozsahové ověření, které appka jinak vždycky dělá. Nalezeno
-- multi-agentní revizí.
create policy notification_preferences_vlastni
  on public.notification_preferences
  for all
  to authenticated
  using (user_id = (select auth.uid()) and app.is_member(tenant_id))
  with check (user_id = (select auth.uid()) and app.is_member(tenant_id));

grant select, insert, update, delete on public.notification_preferences to authenticated;
revoke all on public.notification_preferences from anon;

-- `truncate` obchází RLS a výchozí práva ho udělují taky (viz
-- 20260917000000_granty_provoz_uklid.sql, které tohle retrofitovalo
-- na 51 dalších tabulek tutéž noc) — nová tabulka potřebuje tenhle
-- řádek od prvního dne, ne až v dalším úklidu. Nalezeno multi-agentní
-- revizí; scripts/provoz-granty.test.mjs by to bylo chytlo, kdyby
-- bylo zapojené do CI (není — jen ruční spuštění).
revoke truncate, references, trigger on public.notification_preferences from authenticated;


-- ---------------------------------------------------------------------
-- app.upozorneni_povoleno — jediné místo, kde se kategorie čte
-- ---------------------------------------------------------------------

create or replace function app.upozorneni_povoleno(
  p_tenant    uuid,
  p_user      uuid,
  p_kategorie text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select povoleno from public.notification_preferences
      where tenant_id = p_tenant and user_id = p_user and kategorie = p_kategorie),
    true
  );
$$;

comment on function app.upozorneni_povoleno(uuid, uuid, text) is
  'Výchozí je zapnuto — chybějící řádek znamená povoleno, ne vypnuto. '
  'Volá se jen z triggerů na oznameni/vzkaz; app.upozornit_smenu() ho '
  'nevolá vůbec, takže směny obejít nejde.';

-- Volá se JEN zevnitř dvou SECURITY DEFINER triggerů (vlastník má
-- práva bez ohledu na granty) — přímé RPC volání odkudkoli jinud tu
-- nemá co dělat. Bez tohohle revoke by (default execute na PUBLIC při
-- CREATE FUNCTION) mohl kdokoli přihlášený zavolat
-- upozorneni_povoleno(cizí_tenant, cizí_user, 'vzkazy') a zjistit,
-- jestli si cizí člověk v cizí firmě vypnul upozornění — únik
-- informace mimo RLS na notification_preferences. Nalezeno
-- multi-agentní revizí (chybělo na rozdíl od každé sousední funkce
-- v týhle migraci).
revoke all on function app.upozorneni_povoleno(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- VZKAZY: filtr podle kategorie 'vzkazy'
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.konverzace_ucastnici ku
      join public.employees e on e.id = ku.employee_id
     where ku.konverzace_id = NEW.konverzace_id
       and ku.odesel_kdy    is null
       and e.user_id        is not null
       and e.deleted_at     is null
       and e.tenant_id      = NEW.tenant_id
       and (NEW.autor is null or ku.employee_id <> NEW.autor)
       and app.upozorneni_povoleno(NEW.tenant_id, e.user_id, 'vzkazy')
  loop
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'vzkaz.novy'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo, priorita)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      null,
      'vzkaz.novy',
      jsonb_build_object('den', v_den),
      NEW.priorita
    );
  end loop;

  return NEW;
end $$;


-- ---------------------------------------------------------------------
-- NÁSTĚNKA: filtr podle kategorie 'nastenka'
-- ---------------------------------------------------------------------

-- Rozšíření o usek_id a position_id se ztratilo v prvním pokusu o tuhle
-- migraci: zkopíroval jsem tělo z 20260913110000 (tři větve), ne
-- z aktuálního 20260913160000_nastenka_adresat.sql (pět větví,
-- employee_id > usek_id > position_id > branch_id > firma), které
-- vzniklo o deset dní dřív. Nasazená by tahle chyba tiše rozeslala
-- oznámení pro úsek/pozici celé pobočce nebo celé firmě. Nalezeno
-- multi-agentní revizí, ne testem — krok36_scenar.sql testuje jen
-- pobočku a celou firmu, ne usek_id/position_id.
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
       and app.upozorneni_povoleno(NEW.tenant_id, e.user_id, 'nastenka')
  loop
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'oznameni.nova'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      NEW.branch_id,
      'oznameni.nova',
      jsonb_build_object('den', v_den)
    );
  end loop;

  return NEW;
end $$;
