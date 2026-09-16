-- =====================================================================
-- Foodtab — souřadnice pobočky pro widget počasí na Dnes
--
-- UX redesign, 16.9.2026. Mockup má na Dnes widget počasí; appka na
-- něj dřív neměla zdroj dat vůbec (viz komentář v dnes/page.tsx: „co
-- appka nemá odkud vzít, se nekreslí"). Teď zdroj je —
-- api.met.no (MET Norsko), zdarma i pro komerční použití, CC BY 4.0.
-- Podrobnosti k volání jsou v lib/pocasi.ts.
--
-- API bere zeměpisnou šířku a délku, ne adresu ani město. `address`
-- na branches je volný text bez struktury (viz
-- 20260823120000_foundation.sql) — geokódování z něj by bylo hádání,
-- ne data. Souřadnice se proto zapisují zvlášť, ručně, a dokud je
-- pobočka nemá, widget se prostě nekreslí — stejné pravidlo jako
-- u fotky pozadí a jako u tržeb/hodnocení Google.
--
-- Bez NOT NULL: prázdné je platný, běžný stav (nikdo zeměpisnou šířku
-- nezadal), ne chyba.
-- =====================================================================

alter table public.branches
  add column if not exists lat numeric(8, 5)
    check (lat is null or (lat >= -90 and lat <= 90));

alter table public.branches
  add column if not exists lon numeric(8, 5)
    check (lon is null or (lon >= -180 and lon <= 180));

comment on column public.branches.lat is
  'Zeměpisná šířka pro widget počasí na Dnes (api.met.no). NULL = '
  'widget se nekreslí, ne chyba.';
comment on column public.branches.lon is
  'Zeměpisná délka pro widget počasí na Dnes. Viz komentář u lat.';

revoke select on public.branches from authenticated;

grant select (
  id, tenant_id, name, slug, address, timezone, opening_hours,
  day_starts_at, active, created_at, deleted_at, color, kiosk_kod_vterin,
  hero_photo_path, lat, lon
) on public.branches to authenticated;
