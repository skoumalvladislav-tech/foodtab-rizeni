-- =====================================================================
-- Foodtab — Rezervace: napojení na Choice (choiceqr.com) přes Open API
--
-- Šéfík 25. 10. 2026: „v chromu jsem přihlášený na nastavení api od
-- choice, projdi dokumentaci a vše připrav automaticky". Dokumentace
-- Choice Open API: rezervace jdou jen číst dotazem `GET /bookings/list`
-- s LIMITEM 1 DOTAZ ZA 5 SEKUND a webhooky pro rezervace Choice nemá —
-- Foodtab se proto ptá sám (úloha každých 15 minut a „Načíst teď").
-- Adaptér: lib/rezervace-choice.ts, návod: docs/rezervace-choice.md.
--
-- ---------------------------------------------------------------------
-- PROČ VŮBEC MIGRACE
--
-- Rezervace z Choice se zapisují STÁVAJÍCÍ cestou
-- (`public.rezervace_importovat_zdroj` → `app.rezervace_zapsat_radky`,
-- 20261027100000) — stejná pravidla „čí je pravda" jako CSV a příjmové
-- API, žádná nová tabulka rezervací. Připojení, token a kurzor jsou
-- v registru (`integrace_pripojeni`, `integrace_tajemstvi`,
-- `externi_ucet.kurzor`). Migrace přidává jen dvě věci, které jinak
-- udělat nejde:
--
--   1. ÚLOHU `rezervace-choice` v `app.planovac_ulohy`. Bez řádku tam
--      `public.uloha_zabrat` neznámou úlohu odmítne a adresa
--      /api/uloha/rezervace-choice by vracela 500. Plán = GitHub workflow
--      (.github/workflows/rezervace-choice.yml), hlídá scripts/planovac.test.mjs.
--
--   2. FRONTU DOTAZŮ NA CHOICE — `public.rezervace_choice_zabrat_dotaz`.
--      Limit 1 dotaz / 5 s se musí držet mezi stránkami, mezi pobočkami
--      I mezi souběžnými běhy (naplánovaná úloha, „Načíst teď" na jiné
--      pobočce, ověření nového připojení). Uspání v jednom běhu to
--      neudrží — dva běhy o sobě nevědí. Proto jedno místo v databázi:
--      každý, kdo chce poslat dotaz na Choice, si nejdřív zabere čas
--      a dostane, za kolik milisekund smí poslat. Souběh rozhodne zámek
--      řádku: druhý `update` počká na první a přepočítá se nad jeho
--      zapsanou hodnotou (žádné „přečti a pak zapiš").
--
--      JEDNA fronta pro celou instalaci, ne po připojeních: dokumentace
--      neříká, jestli limit platí na token, nebo na aplikaci. Kdyby
--      Choice potvrdil „na token", jde frontu rozdělit po připojeních
--      (klíč řádku) — dnes by to bylo domýšlení.
--
--      KAŽDÁ FIRMA NEJVÝŠ JEDEN ZABRANÝ DOTAZ NAJEDNOU. Fronta je
--      společná všem firmám, takže kdo by si mohl zabrat víc dotazů
--      dopředu, zastavil by načítání ostatním. Přihlášený na frontu
--      nesáhne přímo (funkce je jen pro service_role), ale server ji
--      volá i z jeho tlačítek („Ověřit znovu", „Načíst teď") — a ta jde
--      zmáčknout mnohokrát naráz (prověrka 25. 10.: osm souběžných
--      „Ověřit znovu" zabralo frontu na 30 s dopředu a úloha ostatních
--      firem nedostala nic). Proto si funkce u firmy pamatuje, kdy
--      odejde její zabraný dotaz, a dokud neodešel, další jí nedá
--      (NULL). Běh firmy jde dotaz po dotazu, takže ho to nebrzdí;
--      souběžné kliky téže firmy dostanou „zkuste za chvíli".
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Žádný zápis do Choice (potvrzení, zrušení) — kontrakt rezervací
--     je zatím jen čtení.
--   * Žádná nová tabulka rezervací ani sloupec v registru. Kurzor
--     načítání je v `integrace_pripojeni.externi_ucet` (stejně jako
--     kurzory pokladen), token v `integrace_tajemstvi` zašifrovaný.
--   * Fronta a její firemní řádky jsou ve schématu `app` a nesahá na ně
--     nikdo kromě funkce (ani service_role). Firemní řádek nese jen
--     `tenant_id` a čas zabraného dotazu — nic o rezervacích.
--   * Funkce fronty jen pro service_role. Přihlášený by si jinak mohl
--     zabírat čas dopředu a zastavit načítání všem ostatním.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ÚLOHA — každých 15 minut, limit 90 s (adresa má maxDuration 60)
-- ---------------------------------------------------------------------

insert into app.planovac_ulohy (uloha, plan_utc, limit_sekund) values
  ('rezervace-choice',       '11,26,41,56 * * * *', 90);


-- ---------------------------------------------------------------------
-- 2. FRONTA DOTAZŮ NA CHOICE
-- ---------------------------------------------------------------------

create table app.rezervace_choice_fronta (
  -- Jediný řádek. Kdyby se fronta jednou dělila po připojeních, bude
  -- tady klíč — dnes by to bylo domýšlení (viz hlavička).
  jediny       boolean primary key default true check (jediny),
  -- Nejdřívější okamžik, kdy smí odejít další dotaz.
  dalsi_volny  timestamptz not null default '-infinity'
);

comment on table app.rezervace_choice_fronta is
  'Fronta dotazů na Choice Open API (GET /bookings/list: nejvýš 1 dotaz za 5 s). '
  'Píše do ní jen public.rezervace_choice_zabrat_dotaz.';

insert into app.rezervace_choice_fronta (jediny) values (true);

alter table app.rezervace_choice_fronta enable row level security;
revoke all on app.rezervace_choice_fronta from public, anon, authenticated, service_role;


-- Kdy odejde dotaz, který má firma zabraný. Dokud neodešel, další jí
-- funkce nedá (viz hlavička: „každá firma nejvýš jeden zabraný dotaz").
create table app.rezervace_choice_fronta_firmy (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  zabrano_do  timestamptz not null default '-infinity'
);

comment on table app.rezervace_choice_fronta_firmy is
  'Fronta dotazů na Choice po firmách: kdy odejde dotaz, který má firma zabraný. '
  'Píše do ní jen public.rezervace_choice_zabrat_dotaz.';

alter table app.rezervace_choice_fronta_firmy enable row level security;
revoke all on app.rezervace_choice_fronta_firmy from public, anon, authenticated, service_role;


-- Zabere pro firmu čas na jeden dotaz. Vrací, za kolik milisekund smí
-- volající dotaz poslat (0 = hned). NULL = NIC SE NEZABRALO, protože
--   * do `p_nejdele_cekat_ms` se dotaz nevejde, nebo
--   * firma už má zabraný dotaz, který ještě neodešel.
-- Volající pak končí a zkusí to příště.
--
-- Chybějící řádek fronty NENÍ „nevejde se": funkce spadne (P0002), aby
-- se to ukázalo u napojení — tiché NULL by vypadalo jako „pokračuje se
-- příště" a nenačítalo by se nic.
--
-- `clock_timestamp()`, ne `now()`: čeká se na skutečný čas, ne na začátek
-- transakce, a měří se AŽ PO zámcích (souběžný volající mezitím mohl
-- frontu posunout). Čekání počítá databáze, takže rozdíl hodin mezi
-- serverem appky a databází rozestup nezkrátí. Zámky vždy ve stejném
-- pořadí (firma, pak fronta), takže se dva volající nezablokují navzájem.
create function public.rezervace_choice_zabrat_dotaz(p_tenant uuid, p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ted     timestamptz;
  v_volny   timestamptz;
  v_firma   timestamptz;
  v_slot    timestamptz;
begin
  if p_tenant is null then
    raise exception 'Dotaz na Choice musí patřit firmě.' using errcode = '22023';
  end if;
  if p_rozestup_ms is null or p_rozestup_ms < 5000 or p_rozestup_ms > 60000 then
    raise exception 'Rozestup dotazů na Choice musí být 5 až 60 sekund (Choice: 1 dotaz za 5 s).'
      using errcode = '22023';
  end if;
  if p_nejdele_cekat_ms is null or p_nejdele_cekat_ms < 0 or p_nejdele_cekat_ms > 120000 then
    raise exception 'Na dotaz na Choice se čeká nejvýš 120 sekund.'
      using errcode = '22023';
  end if;

  insert into app.rezervace_choice_fronta_firmy (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;

  select f.zabrano_do into v_firma
    from app.rezervace_choice_fronta_firmy f
   where f.tenant_id = p_tenant
     for update;

  select q.dalsi_volny into v_volny
    from app.rezervace_choice_fronta q
   where q.jediny
     for update;
  if not found then
    raise exception 'Fronta dotazů na Choice nemá svůj řádek (migrace 20261031100000).'
      using errcode = 'P0002';
  end if;

  v_ted := clock_timestamp();

  -- Firma má zabraný dotaz, který ještě neodešel — druhý jí nedáme.
  if v_firma > v_ted then
    return null;
  end if;

  v_slot := greatest(v_ted, v_volny);
  if v_slot > v_ted + p_nejdele_cekat_ms * interval '1 millisecond' then
    return null;
  end if;

  update app.rezervace_choice_fronta
     set dalsi_volny = v_slot + p_rozestup_ms * interval '1 millisecond'
   where jediny;
  update app.rezervace_choice_fronta_firmy
     set zabrano_do = v_slot
   where tenant_id = p_tenant;

  return greatest(0, ceil(extract(epoch from (v_slot - v_ted)) * 1000))::integer;
end $$;

comment on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) is
  'Fronta dotazů na Choice: zabere firmě čas na jeden dotaz a vrátí, za kolik ms smí odejít. '
  'NULL = nevejde se do zadané doby, nebo firma už má zabraný dotaz; nic se nezabralo. Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) to service_role;
