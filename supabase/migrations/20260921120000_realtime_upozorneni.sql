-- =====================================================================
-- Foodtab — živá aktualizace obrazovek (Provozní centrum, etapa 3)
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace. Migrace mění jen to, které
-- tabulky vysílá Supabase Realtime; data ani schéma tabulek se nemění.
--
-- Do publikace `supabase_realtime` se přidává JEDINÁ tabulka:
-- `notifications`. Každá nová zpráva, oznámení i přidělený úkol příjemcům
-- upozornění vyrábí (app.notifikovat), takže ta jedna tabulka stačí jako
-- „zvonek“, který řekne obrazovce, ať se načte znovu (components/shell/
-- ZivaAktualizace.tsx).
--
-- PROČ NE konverzace_zpravy. RLS na zprávách stojí na definer funkci
-- app.je_ucastnik; Realtime by ji vyhodnocoval pro každého odběratele
-- u každé zprávy. A do publikace by se dostal i text zpráv — kdežto
-- z notifications se nic citlivého nevysílá (telo nese jen holé údaje, text
-- zprávy tam není). Politika notifications_select je jednoduchá
-- (user_id = auth.uid()), Realtime ji respektuje u INSERT a UPDATE: člověk
-- dostane jen události o svých řádcích.
--
-- ČESTNĚ O DELETE: na události DELETE se RLS ve Supabase Realtime NEUPLATŇUJE
-- a nedají se filtrovat — odběratel dostane (jen) primární klíč smazaného
-- řádku, i cizího. Maže se při slučování upozornění (app.zrusit_neprectene).
-- Obsah tím neuniká (klíč je náhodné uuid, nic z těla), ale kdo si otevře
-- vlastní odběr, vidí, KDY se v cizích firmách něco slučuje. Publikace neumí
-- vysílat jen některé operace jedné tabulky, takže se to tady nedá vypnout;
-- obrazovka na DELETE nereaguje a po každém sloučení přijde INSERT nového
-- upozornění, který ji obnoví. Kdo tohle riziko nechce, tuhle migraci
-- nenasazuje — obrazovky se pak obnovují po akci a po navigaci jako dřív.
--
-- BEZ PUBLIKACE se nic nerozbije: obrazovky se obnovují po akci a po
-- navigaci jako dřív. Proto je migrace tolerantní k prostředí, kde
-- publikace nebo tabulka není (čistá lokální databáze v testech).
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
