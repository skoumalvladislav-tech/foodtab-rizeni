-- =====================================================================
-- Foodtab — OPRAVA: barvu u člověka smí `authenticated` i číst
--
-- Nasazením 20260903080000 spadly dvě obrazovky:
--   Lidé          ERROR 2201944379
--   Rozpis směn   ERROR 680711986
-- Docházka jela dál. Společné měly to, že obě vybírají `employees.color`
-- — a Docházka ne.
--
-- ---------------------------------------------------------------------
-- CO SE STALO
--
-- `employees` NEMÁ právo na čtení celé tabulky. Migrace
-- 20260901120000_osobni_udaje.sql ho schválně sebrala a vrátila
-- PO SLOUPCÍCH, aby se telefon a e-mail četly jen průzorem:
--
--   revoke select on public.employees from authenticated;
--   grant select (id, tenant_id, branch_id, user_id, position_id,
--                 full_name, employment_type, started_on, ended_on,
--                 active, created_at, deleted_at)
--     on public.employees to authenticated;
--
-- Je to výčet. `alter table … add column color` do něj nový sloupec
-- nepřidá — a každý dotaz, který si o `color` řekne, dostane
--
--   permission denied for table employees   (SQLSTATE 42501)
--
-- a to hned, ještě než se vůbec dostane na řádky. Proto padaly celé
-- obrazovky, ne jen barva.
--
-- Zápis v pořádku byl: INSERT i UPDATE jsou na `employees` udělené na
-- celou tabulku, takže se barva ukládala. Rozbité bylo jen čtení.
--
-- ---------------------------------------------------------------------
-- PROČ TO NECHYTILY KONTROLY
--
-- `krok21_scenar.sql` na `color` sahal, ale jako superuživatel —
-- `set role authenticated` v něm bylo jen u zápisu do cizí firmy.
-- Kontrola tedy neprošla tou cestou, kterou jde aplikace. Doplněno
-- tamtéž: dotazy obou obrazovek se pouští pod rolí `authenticated`,
-- doslova tak, jak je posílají.
--
-- ---------------------------------------------------------------------
-- NA CO SI DÁT POZOR PŘÍŠTĚ
--
-- Každý další sloupec na `employees`, který má být vidět v aplikaci,
-- se sem musí dopsat. Sloupec, který vidět BÝT NEMÁ (telefon, e-mail),
-- se sem nedopisuje — a je to tak schválně, ne opomenutím.
-- =====================================================================

grant select (color) on public.employees to authenticated;

comment on column public.employees.color is
  'Klíč z palety rozhraní, ne hodnota barvy. Prázdné je platný stav: '
  'člověk barvu nemá. Jedinečnost platí v rámci pobočky, ne firmy — '
  'kalendář je vždycky za jednu pobočku. POZOR: čtení tabulky je '
  'udělené po sloupcích (20260901120000), takže nový sloupec potřebuje '
  'vlastní grant, jinak spadne celý dotaz, ne jen ten sloupec.';
