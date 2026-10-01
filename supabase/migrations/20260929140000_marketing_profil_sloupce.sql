-- =====================================================================
-- Foodtab — Marketing: čtyři nová pole značky pro návrh profilu z webu
--
-- Zadání Šéfíka 1. 10. 2026: nástroj na automatické nastavení profilu
-- firmy/pobočky v marketingu — najde na webu/sociálních sítích logo,
-- barvy, popis a odkazy, a předvyplní je k doladění na obrazovce
-- Marketing → Značka (app/[rozsah]/marketing/znacka/).
--
-- `public.marketing_nastaveni` (20260909180000_marketing_podklady.sql)
-- dnes nese tón, barvy, písmo a logo, ale NEMÁ popis firmy ani odkazy
-- na web a sociální sítě — ty je potřeba poslat jazykovému modelu jako
-- součást značky (lib/marketing-ai.ts) a ukázat je na obrazovce. Tahle
-- migrace jen přidává čtyři sloupce; žádnou jinou změnu schématu ani
-- RLS nedělá.
--
-- ---------------------------------------------------------------------
-- NOT NULL DEFAULT '', NE NULLABLE
--
-- Na rozdíl od `barva_hlavni`/`barva_doplnkova` (nullable — chybějící
-- barva je legitimní „firma nic nezadala") se tahle čtyři pole chovají
-- jako `podpis`/`kontakt` o pár řádků výš ve stejné tabulce: prázdný
-- řetězec je samotná hodnota „nezadáno", ne NULL. Obrazovka i AI pak
-- nemusí všude ošetřovat NULL navíc k prázdnému řetězci.
--
-- ---------------------------------------------------------------------
-- RLS A GRANTY SE NEMĚNÍ A NEMUSÍ
--
-- `marketing_nastaveni` má grant NA CELOU TABULKU
-- (`grant select, insert, update, delete on public.marketing_nastaveni
-- to authenticated;`, 20260909180000_marketing_podklady.sql, ř. 116),
-- ne po sloupcích jako `employees`/`branches` (foodtab-db-security,
-- oddíl „Sloupcové granty"). Nový sloupec se proto automaticky objeví
-- ve stávajícím grantu i politikách (`marketing_nastaveni_select`/
-- `_write` se ptají jen na `tenant_id` a `branch_id`, které se tu
-- nemění).
--
-- PGlite tohle NEOVĚŘÍ (běží jako jediný superuživatel — sloupcové
-- granty se tam neprojeví, viz scripts/scenare-pglite.mjs, hlavička).
-- Potvrdit dotazem pod rolí `authenticated` patří do ověření před
-- nasazením (skill `overeni-pred-nasazeni`), ne sem.
-- =====================================================================

alter table public.marketing_nastaveni
  add column popis_firmy    text not null default '',
  add column web_url        text not null default '',
  add column instagram_url  text not null default '',
  add column facebook_url   text not null default '';
