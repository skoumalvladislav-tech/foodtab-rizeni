-- =====================================================================
-- Foodtab — audit pozic
--
-- Zadání docs/zadani-2026-08-31.md, bod 4: „Spoušť auditu doplň
-- i na positions.“
--
-- Pozice se od téhle chvíle zakládají a přejmenovávají z rozhraní, takže
-- platí totéž co u lidí a oprávnění: kdo to změnil, se dřív nebo později
-- někdo zeptá. Funkce app.audit_zmenu() už existuje z migrace
-- 20260831020000, tady se jen věší na další tabulku.
-- =====================================================================

create trigger trg_audit_positions
  after insert or update or delete on public.positions
  for each row execute function app.audit_zmenu('position');
