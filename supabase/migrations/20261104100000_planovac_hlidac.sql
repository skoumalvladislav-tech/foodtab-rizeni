-- =====================================================================
-- Foodtab — hlídač plánovače úloh: stav pg_cronu pro aplikaci
--
-- Navazuje na 20261014120000_planovac_pg_cron.sql. Scénář: krok97.
--
-- PROČ
--
-- pg_cron nikomu nenapíše, když přestane volat nebo když úloha vrací
-- chybu (GitHub Actions u neúspěšného běhu poslal e-mail). Stav umí
-- ukázat `app.planovac_stav()`, ale ten čte jen postgres v SQL Editoru
-- — a nikdo se tam nedívá, dokud se něco nerozbije.
--
-- Tahle funkce pustí TENTÝŽ stav aplikaci: adresa `/api/planovac/hlidac`
-- (Bearer CRON_SECRET) ho přečte pod service_role, rozhodne
-- (`lib/planovac-hlidac.ts`) a při problému odpoví 503. Workflow
-- `planovac-hlidac.yml` pak zčervená a GitHub pošle e-mail.
--
-- Je to nutná podmínka pro vypnutí `schedule` u GitHub workflow úloh:
-- bez hlídače by zastavený plánovač nikdo nepoznal.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Žádná vlastní logika — jen `app.planovac_stav()`. Dvě funkce, které
--   by stav počítaly každá jinak, se rozejdou.
-- * Žádný přístup pro authenticated. Stav plánovače není data firmy
--   a obrazovku pro něj nikdo nechtěl.
-- * SECURITY DEFINER, protože `app.planovac_stav()` smí jen postgres
--   (čte `cron.job` a `net._http_response`). Firmy se netýká, žádný
--   tenant tu filtrovat nejde. Vrací jen jména úloh, časy a kódy —
--   tajemství ani adresu ne.
-- =====================================================================

create function public.planovac_zdravi()
returns table (
  uloha            text,
  plan_utc         text,
  v_cronu          boolean,
  posledni_zacatek timestamptz,
  posledni_volani  timestamptz,
  posledni_kod     integer,
  posledni_chyba   text,
  volani_6h        bigint,
  chyb_6h          bigint
)
language sql stable security definer set search_path = '' as $$
  select * from app.planovac_stav()
$$;

comment on function public.planovac_zdravi() is
  'Stav plánovače úloh (= app.planovac_stav()) pro hlídač /api/planovac/hlidac. Jen service_role.';

revoke all on function public.planovac_zdravi() from public, anon, authenticated;
grant execute on function public.planovac_zdravi() to service_role;
