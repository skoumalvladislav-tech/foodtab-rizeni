-- =====================================================================
-- Foodtab — Faktury: oprávnění uvnitř modulu Finance
--
-- Zadání: docs/hlaseni/zadani-pro-ai-marketing-faktury.md, „PROJEKT 2:
-- Faktury — sloučení s Foodtabem". Sloučení = přinést faktury jako
-- novou sekci do foodtab-rizeni, ne novou samostatnou appku.
--
-- Šéfík 15.9.2026: Faktury nejsou vlastní modul, ale sekce uvnitř
-- Finance (adresa /finance/faktury). Modul `finance` už v katalogu
-- existuje (20260823120100_catalog.sql) — tahle migrace jen přidává
-- jemnější oprávnění faktury.read/faktury.manage pod něj, stejně jako
-- je uvnitř provozu vlastní právo advances.manage.
--
-- ---------------------------------------------------------------------
-- DATA FAKTUR ZŮSTÁVAJÍ V ODDĚLENÉ DATABÁZI (možnost A ze zadání)
--
-- Tahle migrace se týká jen KATALOGU oprávnění ve foodtab DB
-- (spekntcsuroqhehmjssv) — o tom, kdo smí fakturu vidět/spravovat
-- ve foodtabovém rámu. Samotné faktury (tabulka invoices,
-- rejection_examples) zůstávají v odděleném projektu ctqtwahlzhyjerqulqyn,
-- dokud Šéfík nerozhodne o přesunu (zadání doporučuje začít odděleně).
-- Foodtabovo `app.has_access` tedy řídí, kdo obrazovku uvidí, ale
-- NENAHRAZUJE RLS na faktura-DB — to zůstává otevřený bod č. 3
-- ze zadání (bezpečnost/auth), řeší se samostatně a jen se souhlasem
-- Šéfíka.
-- =====================================================================

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('faktury.read',   'finance', 'Vidět přijaté faktury',                 false, 500),
  ('faktury.manage', 'finance', 'Zadávat, schvalovat a mazat faktury',   true,  501)
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      sensitive = excluded.sensitive,
      sort_order = excluded.sort_order;
