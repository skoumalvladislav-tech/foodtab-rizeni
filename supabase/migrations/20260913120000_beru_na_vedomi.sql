-- =====================================================================
-- Foodtab — „Beru na vědomí" na nástěnce
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 4 B3.
--
-- Volitelný příznak na oznámení. Kde je zapnutý, vedoucí sleduje,
-- kdo potvrdil — ne procenta, ale jmenovitě — a zaměstnanec vidí
-- tlačítko vědomého souhlasu místo tichého přečtení.
--
-- PROČ REUSE announcement_reads, NE NOVÁ TABULKA
--
-- „Beru na vědomí" je silnější forma přečtení: vědomé kliknutí,
-- ne tiché „zobrazeno". Ale eviduje se totéž — kdo a kdy. Nová
-- tabulka by duplikovala stejnou strukturu a rozházela RLS, které
-- je správně nastavené právě na announcement_reads.
--
-- Rozdíl je jen ve formuláři: kde requires_acknowledgment je false,
-- stačí „Označit jako přečtené"; kde je true, zobrazí se „Beru
-- na vědomí". Zápisem se ale obojí stane jedním záznamem.
--
-- Migrace nepotřebuje DROP ani datový převod: NULL se defaultem
-- nahradí null u stávajících oznámení, což je správná interpretace
-- (žádné potvrzení nevyžadují).
-- =====================================================================

alter table public.announcements
  add column if not exists requires_acknowledgment boolean not null default false;

comment on column public.announcements.requires_acknowledgment is
  'Zapnuté = zobrazí se tlačítko „Beru na vědomí" místo '
  '„Označit jako přečtené". Vedoucí pak vidí, kdo ještě nepotvrdil.';
