-- =====================================================================
-- Foodtab — zahození pěti tabulek starého modulu Marketing
--
-- Zadání: docs/marketing-je-modul.md, oddíl 3.
--
-- Marketing se staví znovu (rozhodnutí z 9. 9. 2026: je to modul
-- Foodtabu, ne samostatná aplikace). Pět tabulek z
-- 20260903040000_marketing_tabulky.sql byla dílna, do které se nikdy
-- nic nezapsalo — zůstat by z nich byla jen mrtvá schránka, kterou by
-- za půl roku někdo pokládal za platný model a stavěl na ní.
--
-- ---------------------------------------------------------------------
-- OVĚŘENO, ŽE JSOU PRÁZDNÉ
--
-- 9. 9. 2026 proti spekntcsuroqhehmjssv (foodtab-test), kde dnes leží
-- ostrá data: marketing_settings 0, marketing_integrations 0,
-- marketing_photos 0, marketing_templates 0, marketing_posts 0.
--
-- Tohle NENÍ zásah do zákaznických dat. Kdyby v kterékoli z nich řádek
-- byl, migrace by se nepsala takhle — data by se musela nejdřív
-- převést.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NERUŠÍ
--
-- * Modul `marketing` a jeho tři oprávnění (marketing.read,
--   marketing.manage, marketing.publish). Nejsou z té migrace, jsou
--   z 20260823120100_catalog.sql, a NOVÝ modul je používá dál. Firmy,
--   které si marketing zapnuly, o něj tímhle nepřijdou.
-- * Řádky v `audit_log` o těch tabulkách (dnes žádné nejsou, ale
--   kdyby vznikly). Audit je historie — ta se nemaže, i když entita,
--   které se týkala, už neexistuje.
-- * Obrazovka app/[rozsah]/marketing. Zůstává a přepíše se; kdyby
--   zmizela, položka v nabídce by vedla na 404.
--
-- ---------------------------------------------------------------------
-- BEZ `if exists`
--
-- Stejný důvod jako `create table` bez `if not exists`: čistá databáze
-- se staví ze všech migrací, takže tabulky tu v tu chvíli JSOU. Kdyby
-- nebyly, něco je jinak, než si myslíme, a má to spadnout nahlas.
-- =====================================================================

-- Politiky, granty, indexy a spouště padají s tabulkou.
drop table public.marketing_posts;
drop table public.marketing_photos;
drop table public.marketing_templates;
drop table public.marketing_integrations;
drop table public.marketing_settings;

-- Strážce přechodů příspěvku hlídal `marketing_posts` a nic jiného.
-- Bez té tabulky je to funkce, kterou nikdo nevolá.
drop function app.strez_prechod_marketing_postu();
