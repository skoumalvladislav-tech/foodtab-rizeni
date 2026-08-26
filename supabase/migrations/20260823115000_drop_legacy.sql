-- =====================================================================
-- Foodtab — Etapa 0: odstranění starého modelu přístupů
--
-- Ruší tabulku user_access a její triggery. Nahrazuje je model
-- profiles + memberships + roles, kde jsou role a oprávnění daty firmy,
-- ne výčtem v CHECK constraintu.
--
-- Starý model měl slabinu, kvůli které se na prázdné databázi do
-- aplikace nedostal nikdo: trigger zakládal každého jako 'pending'
-- a schválit ho mohl jen administrátor, kterého neměl kdo vytvořit.
--
-- Startujeme s nulovými daty, takže se nic nemigruje.
-- =====================================================================

drop trigger if exists on_auth_user_created_foodtab_access on auth.users;

drop function if exists public.create_foodtab_access_profile() cascade;
drop function if exists public.is_foodtab_administrator(uuid) cascade;
drop function if exists public.foodtab_shift_manager_branch(uuid) cascade;

drop table if exists public.user_access cascade;
