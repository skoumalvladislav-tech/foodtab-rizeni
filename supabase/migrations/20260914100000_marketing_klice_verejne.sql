-- =====================================================================
-- Foodtab — modul Marketing: klíče se daly volat jen z SQL, ne z aplikace
--
-- Zadání: master prompt v2.2, oddíl 3.1 a 6 — obrazovka „Integrace
-- a nástroje". Navazuje na 20260909220000_marketing_integrace.sql.
--
-- ---------------------------------------------------------------------
-- CO SE OPRAVUJE
--
-- Funkce na zákaznické klíče (`app.marketing_uloz_tajemstvi`,
-- `app.marketing_precti_tajemstvi`, `app.marketing_smaz_tajemstvi`)
-- leží ve schématu `app`. PostgREST vystavuje jen `public`
-- a `graphql_public` (supabase/config.toml, řádek 13), takže
-- `supabase.rpc('marketing_precti_tajemstvi', …)` z aplikace na ně
-- NIKDY nedosáhlo.
--
-- Nebylo to vidět: `app/[rozsah]/marketing/akce.ts` bere chybu jako
-- „zákazník nemá připojenou vlastní AI" a spadne na klíč Foodtabu nebo
-- na ukázku. Připojení vlastního účtu tedy tiše nedělalo nic.
--
-- Proto sem přibývají tři obálky v `public`, které nedělají nic jiného,
-- než že zavolají ty ve schématu `app`.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Funkce se do `public` NEPŘESOUVAJÍ. Kontrola práv a audit mají
--     zůstat na jednom místě; obálka je pár řádků, přesun by znamenal
--     dvě verze téhož a jednu z nich by někdo za rok upravil.
--   * Obálky NEJSOU `security definer`. Kdyby byly, běžely by pod
--     vlastníkem a `app.has_access` uvnitř by se ptalo na jeho práva —
--     tedy na nic. Takhle se `auth.uid()` nese dál a rozhoduje ta
--     funkce v `app`, která na to je.
--   * Nepřidává se audit. Audituje se uvnitř funkcí v `app`, a jen
--     otisk — šifra do `audit_log` nepatří.
--   * `marketing_pripojeni.kategorie` se NEROZŠIŘUJE o kategorie
--     z katalogu (hlas, upozorneni, uloziste). Nemají adaptér, takže
--     do těch kategorií nejde nic připojit a žádný řádek s nimi
--     nevznikne. Až adaptér bude, rozšíří se výčet tehdy — a kdyby na
--     to někdo zapomněl, insert spadne nahlas.
-- =====================================================================


create or replace function public.marketing_uloz_tajemstvi(
  p_pripojeni uuid,
  p_sifra     text,
  p_otisk     text
)
returns void
language sql security invoker set search_path = ''
as $$ select app.marketing_uloz_tajemstvi(p_pripojeni, p_sifra, p_otisk) $$;

comment on function public.marketing_uloz_tajemstvi(uuid, text, text) is
  'Obálka nad app.marketing_uloz_tajemstvi — PostgREST vidí jen public. '
  'O právu rozhoduje ta funkce v app, tahle nic nekontroluje.';

revoke all on function public.marketing_uloz_tajemstvi(uuid, text, text) from public, anon;
grant execute on function public.marketing_uloz_tajemstvi(uuid, text, text) to authenticated, service_role;


create or replace function public.marketing_precti_tajemstvi(p_pripojeni uuid)
returns text
language sql stable security invoker set search_path = ''
as $$ select app.marketing_precti_tajemstvi(p_pripojeni) $$;

comment on function public.marketing_precti_tajemstvi(uuid) is
  'Obálka nad app.marketing_precti_tajemstvi. Vrací ŠIFRU, ne klíč — '
  'rozšifrovat ji umí jen server, který má klíč z prostředí.';

revoke all on function public.marketing_precti_tajemstvi(uuid) from public, anon;
grant execute on function public.marketing_precti_tajemstvi(uuid) to authenticated, service_role;


create or replace function public.marketing_smaz_tajemstvi(p_pripojeni uuid)
returns void
language sql security invoker set search_path = ''
as $$ select app.marketing_smaz_tajemstvi(p_pripojeni) $$;

comment on function public.marketing_smaz_tajemstvi(uuid) is
  'Obálka nad app.marketing_smaz_tajemstvi. Klíč se při odpojení maže '
  'doopravdy; co po něm zůstane, je otisk v auditu.';

revoke all on function public.marketing_smaz_tajemstvi(uuid) from public, anon;
grant execute on function public.marketing_smaz_tajemstvi(uuid) to authenticated, service_role;
