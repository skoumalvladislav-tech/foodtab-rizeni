-- =====================================================================
-- Foodtab — modul Marketing: odebrání plošných grantů od anon
-- a od authenticated tam, kde nemají co dělat
--
-- ---------------------------------------------------------------------
-- CO SE STALO
--
-- 13. 9. 2026 při nasazení modulu do `foodtab-test` vyšlo najevo, že
-- `marketing_tajemstvi` — tabulka se zašifrovanými klíči k Instagramu —
-- má granty pro `anon` i `authenticated`, ačkoli jí je migrace
-- 20260909220000_marketing_integrace.sql schválně NEDALA. Dostala je
-- sama:
--
--   Supabase má v projektu nastavená VÝCHOZÍ PRÁVA
--   (`alter default privileges in schema public grant all on tables
--   to anon, authenticated, service_role`). Každá nová tabulka
--   v `public` je tedy dostane, ať si migrace přeje cokoli. Platí to
--   pro celý projekt, ne jen pro marketing.
--
-- Data neunikla: RLS je zapnutá a `marketing_tajemstvi` nemá žádnou
-- politiku, takže obě role vidí nula řádků. Ověřeno měřením na ostré
-- databázi (vložen řádek, přečten pod `authenticated` i `anon`, obojí
-- 0 z 1, zápis vrácen zpátky).
--
-- Jenže návrh modulu stojí na DVOU liniích (CLAUDE.md, pravidlo 3)
-- a jedna z nich tiše chyběla. Nestačí, že druhá držela.
--
-- ---------------------------------------------------------------------
-- PROČ TO NEJDE OŠETŘIT JEDNOU PROVŽDY V MIGRACI
--
-- Protože výchozí práva se uplatní při KAŽDÉM `create table`. Nová
-- tabulka v modulu je tedy dostane znovu a bude potřebovat vlastní
-- `revoke`. Nedá se to obejít změnou výchozích práv — to je nastavení
-- celého projektu a sahá i na provozní moduly, které se s ním počítají.
--
-- **Každá nová tabulka marketingu proto potřebuje `revoke ... from
-- anon` hned pod svým `create table`.**
--
-- ---------------------------------------------------------------------
-- PROČ MÍSTNÍ TESTY TOHLE NECHYTILY
--
-- `supabase/tests/run.sh` staví čistou databázi z migrací a výchozí
-- práva Supabase v ní nejsou. Kontrola v `marketing4_scenar`
-- („tabulku s klíči si authenticated nepřečte vůbec") tedy prochází
-- lokálně, protože grant tam opravdu není — a v ostré databázi by
-- spadla. Je to tatáž třída rozdílu jako u `\gset` nad NULL
-- v PGlite: prostředí, ve kterém se testuje, není to, ve kterém to
-- běží.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KLÍČE: PRO PŘIHLÁŠENÉHO NIC
--
-- Sem se chodí jedině třemi funkcemi z 20260909220000, které se ptají
-- na `marketing.publish`. Přímý dotaz má skončit na 42501, ne na
-- prázdném výsledku — prázdný výsledek vypadá jako „tam nic není".
-- ---------------------------------------------------------------------

revoke all on public.marketing_tajemstvi from anon, authenticated;


-- ---------------------------------------------------------------------
-- ZBYTEK MODULU: ANON NEMÁ CO POHLEDÁVAT NIKDE
--
-- Všechny politiky modulu jsou psané `to authenticated`, takže anon
-- žádný řádek nevidí ani teď. Grant bez politiky je ale zbytečné
-- riziko: stačilo by, aby někdo v budoucnu přidal politiku bez
-- `to authenticated`, a otevřelo by se to nepřihlášeným.
-- ---------------------------------------------------------------------

revoke all on public.marketing_nastaveni       from anon;
revoke all on public.marketing_media           from anon;
revoke all on public.marketing_sablony         from anon;
revoke all on public.marketing_prispevky       from anon;
revoke all on public.marketing_verze           from anon;
revoke all on public.marketing_schvaleni       from anon;
revoke all on public.marketing_varianty        from anon;
revoke all on public.marketing_pripojeni       from anon;
revoke all on public.marketing_ucty            from anon;
revoke all on public.marketing_render_ulohy    from anon;
revoke all on public.marketing_publikace_ulohy from anon;
revoke all on public.marketing_publikace       from anon;
