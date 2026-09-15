-- =====================================================================
-- Foodtab — modul Faktury: katalog modulu a oprávnění
--
-- Zadání: docs/hlaseni/zadani-pro-ai-marketing-faktury.md, „PROJEKT 2:
-- Faktury — sloučení s Foodtabem". Sloučení = přinést faktury jako
-- nový modul do foodtab-rizeni, ne novou samostatnou appku.
--
-- ---------------------------------------------------------------------
-- DATA FAKTUR ZŮSTÁVAJÍ V ODDĚLENÉ DATABÁZI (možnost A ze zadání)
--
-- Tahle migrace se týká jen KATALOGU modulů/oprávnění ve foodtab DB
-- (spekntcsuroqhehmjssv) — o tom, kdo smí fakturu vidět/spravovat
-- ve foodtabovém rámu. Samotné faktury (tabulka invoices,
-- rejection_examples) zůstávají v odděleném projektu ctqtwahlzhyjerqulqyn,
-- dokud Šéfík nerozhodne o přesunu (zadání doporučuje začít odděleně).
-- Foodtabovo `app.has_access` tedy řídí, kdo obrazovku uvidí, ale
-- NENAHRAZUJE RLS na faktura-DB — to zůstává otevřený bod č. 3
-- ze zadání (bezpečnost/auth), řeší se samostatně a jen se souhlasem
-- Šéfíka.
--
-- Modul není `is_base` — zapíná se per tenant stejně jako marketing
-- a objednávky, ne automaticky.
-- =====================================================================

insert into public.modules (key, label, is_base, sort_order) values
  ('faktury', 'Faktury', false, 50)
on conflict (key) do update
  set label = excluded.label,
      is_base = excluded.is_base,
      sort_order = excluded.sort_order;

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('faktury.read',   'faktury', 'Vidět přijaté faktury',                 false, 500),
  ('faktury.manage', 'faktury', 'Zadávat, schvalovat a mazat faktury',   true,  501)
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      sensitive = excluded.sensitive,
      sort_order = excluded.sort_order;
