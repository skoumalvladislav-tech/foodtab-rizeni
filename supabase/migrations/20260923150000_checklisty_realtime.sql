-- Checklisty 2.0, vrstva B krok 4 — realtime pro sdílený běh.
--
-- Vzor 20260921120000_realtime_upozorneni.sql, jiný scope. Ta migrace
-- řeší upozornění JEDNOMU člověku (filtr user_id); tahle řeší „víc lidí
-- sleduje TENTÝŽ běh checklistu" — kolega na vedlejším tabletu, který
-- vidí, jak druhý odškrtává položky, bez vlastního upozornění.
--
-- RLS na checklist_entries (checklist_entries_all, 20260823130000_provoz.sql)
-- stojí na app.has_access(tenant, 'tasks.read', branch) přes subquery na
-- checklist_runs — ne na drahé security definer funkci jako
-- app.je_ucastnik u zpráv, takže cena je přijatelná stejným zdůvodněním,
-- jaké má migrace 20260921120000 pro notifications.
--
-- ---------------------------------------------------------------------
-- DELETE DÍRA — STEJNÁ JAKO U NOTIFICATIONS, ŘEŠÍ SE INVARIANTEM
--
-- Supabase Realtime neumí filtrovat DELETE přes RLS. Invariant pro
-- checklist_entries proto zní: ŘÁDEK SE NIKDY NEMAŽE. „Odškrtnutí
-- zpátky" je `update ... set checked = false`, ne delete — to dodržuje
-- dnešní kód (akce.ts) i nová RPC zapsat_polozku_checklistu (krok rpc).
-- Kdyby v budoucnu přibyl DELETE na checklist_entries, tahle migrace by
-- přestala platit a je potřeba to tu připomenout, ne najít o rok
-- později.
--
-- checklist_runs se přidává taky (stav/odpovědnost se mění málokdy,
-- řádků málo, cena zanedbatelná) — divák detailu běhu tak uvidí i
-- změnu odpovědnosti/uzavření bez refreshe.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'checklist_entries'
     ) then
    alter publication supabase_realtime add table public.checklist_entries;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'checklist_runs'
     ) then
    alter publication supabase_realtime add table public.checklist_runs;
  end if;
end $$;
