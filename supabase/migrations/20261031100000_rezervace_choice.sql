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
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Žádný zápis do Choice (potvrzení, zrušení) — kontrakt rezervací
--     je zatím jen čtení.
--   * Žádná nová tabulka rezervací ani sloupec v registru. Kurzor
--     načítání je v `integrace_pripojeni.externi_ucet` (stejně jako
--     kurzory pokladen), token v `integrace_tajemstvi` zašifrovaný.
--   * Fronta nemá `tenant_id`: firmy se netýká (stejně jako
--     `app.planovac_ulohy`) a je ve schématu `app`, kam nikdo kromě
--     funkce nesahá. Řádek v ní neříká nic o žádné firmě.
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


-- Zabere čas na jeden dotaz. Vrací, za kolik milisekund smí volající
-- dotaz poslat (0 = hned). NULL = do `p_nejdele_cekat_ms` se nevejde
-- a NIC SE NEZABRALO — volající končí a zkusí to příští běh.
--
-- `clock_timestamp()`, ne `now()`: čeká se na skutečný čas, ne na začátek
-- transakce. Čekání počítá databáze, takže rozdíl hodin mezi serverem
-- appky a databází rozestup nezkrátí.
create function public.rezervace_choice_zabrat_dotaz(p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ted  timestamptz := clock_timestamp();
  v_slot timestamptz;
begin
  if p_rozestup_ms is null or p_rozestup_ms < 5000 or p_rozestup_ms > 60000 then
    raise exception 'Rozestup dotazů na Choice musí být 5 až 60 sekund (Choice: 1 dotaz za 5 s).'
      using errcode = '22023';
  end if;
  if p_nejdele_cekat_ms is null or p_nejdele_cekat_ms < 0 or p_nejdele_cekat_ms > 120000 then
    raise exception 'Na dotaz na Choice se čeká nejvýš 120 sekund.'
      using errcode = '22023';
  end if;

  update app.rezervace_choice_fronta f
     set dalsi_volny = greatest(v_ted, f.dalsi_volny) + p_rozestup_ms * interval '1 millisecond'
   where f.jediny
     and greatest(v_ted, f.dalsi_volny) <= v_ted + p_nejdele_cekat_ms * interval '1 millisecond'
  returning f.dalsi_volny - p_rozestup_ms * interval '1 millisecond' into v_slot;

  if v_slot is null then
    return null;
  end if;
  return greatest(0, ceil(extract(epoch from (v_slot - v_ted)) * 1000))::integer;
end $$;

comment on function public.rezervace_choice_zabrat_dotaz(integer, integer) is
  'Fronta dotazů na Choice: zabere čas na jeden dotaz a vrátí, za kolik ms smí odejít. '
  'NULL = nevejde se do zadané doby, nic se nezabralo. Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_dotaz(integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_dotaz(integer, integer) to service_role;
