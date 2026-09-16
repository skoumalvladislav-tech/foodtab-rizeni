-- =====================================================================
-- Foodtab — úklid grantů na provozních tabulkách (TRUNCATE, anon)
--
-- Zadání: docs/granty-provoz-zadani.md, zadal Šéfík 14. 9. 2026 po
-- nálezu z nasazení marketingu. Modul marketing je od té chvíle
-- uklizený (20260913180000_marketing_granty_uklid.sql,
-- 20260914190000_marketing_granty_uklid2.sql) — tohle je totéž pro
-- provozní tabulky, které na to čekaly od 14. 9.
--
-- ---------------------------------------------------------------------
-- CO SE STALO
--
-- Výchozí práva projektu Supabase (`alter default privileges in schema
-- public grant all on tables to anon, authenticated, service_role`)
-- udělují KAŽDÉ nové tabulce plná práva pro `anon` i `authenticated`,
-- ať migrace píše cokoli. Nález z 14. 9. 2026 (měřeno v `foodtab-test`):
-- 51 provozních tabulek + 1 pohled (`employee_points`) mělo pro
-- `authenticated` grant TRUNCATE, REFERENCES a TRIGGER, a týchž 52 mělo
-- granty i pro `anon`.
--
-- ---------------------------------------------------------------------
-- PROČ TRUNCATE VADÍ DOOPRAVDY
--
-- `truncate` se Row Level Security NEŘÍDÍ. `delete` musí projít přes
-- politiku — `truncate` ne. Přihlášený s tím grantem vysype celou
-- tabulku napříč VŠEMI firmami a žádná politika ho nezastaví. Je to
-- jediná věc z celého nálezu, která není „jen chybějící druhá linie" —
-- je to otevřená cesta k nevratné ztrátě dat.
--
-- ---------------------------------------------------------------------
-- PROČ VADÍ GRANTY PRO ANON
--
-- Ověřeno znovu 16./17. 9. 2026 přímým dotazem do `foodtab-test`: žádná
-- politika v `public` necílí na roli `anon` (0 politik) a všech devět
-- funkcí, které `anon` smí spustit (`kiosk_stav`, `kiosk_zalohy`,
-- `kiosk_zpravy_pinem`, `kiosk_zpravy_pocet`, `marketing_prejit`,
-- `pichnout_pinem`, `potvrdit_zalohu_pinem`, `pozvanka_info`,
-- `registrovat_zarizeni`) je `security definer` — veřejné cesty (Kiosek,
-- Pozvánka, přihlášení z QR) jdou výhradně přes ně, ne na tabulky přímo.
-- Data tedy neutekla a neuteču — je to chybějící PRVNÍ obranná linie,
-- ne díra (CLAUDE.md, pravidlo 3).
--
-- ---------------------------------------------------------------------
-- AUDIT_LOG JE JINÝ NEŽ OSTATNÍCH 51
--
-- Neměnnost hlídají pravidla `audit_log_no_update`/`audit_log_no_delete`,
-- ale pravidla TRUNCATE nezachytí a RLS taky ne. Do auditu píše jen
-- `app.audit()` jako `security definer` — nikdo jiný nemá důvod na ni
-- sahat přímo. Proto se jí navíc odebírá i INSERT a UPDATE (ne jen
-- TRUNCATE) pro OBĚ role, DELETE taky; SELECT zůstává — obrazovka
-- Nastavení → Audit ji čte a politika `audit_select` hlídá řádky.
--
-- ---------------------------------------------------------------------
-- CO SE NEDĚLÁ
--
-- SELECT/INSERT/UPDATE/DELETE se u ostatních 51 tabulek NIKDE neruší —
-- o tom pořád rozhoduje RLS. Marketing (`marketing_*`) je uklizený
-- samostatně, sem se nesahá. `alter default privileges` se neupravuje —
-- je to nastavení celé databáze, sahalo by to i na `service_role`
-- a na cizí moduly (viz odůvodnění v marketing_granty_uklid2.sql).
--
-- ---------------------------------------------------------------------
-- KROK 1 (OVĚŘENO, VE ŠPATNÉM PŘÍPADĚ SE TATO MIGRACE NEPÍŠE)
--
-- Žádná veřejná obrazovka (Kiosek, Pozvánka, přihlášení z QR) nečte
-- provozní tabulku přímo jako anon — všech devět anon-spustitelných
-- funkcí je `security definer`. Bezpečné odebrat grant `anon` na
-- všech tabulkách níž bez rozbití veřejné cesty.
--
-- Kontrola, která tohle hlídá do budoucna (text migrací, ne databáze —
-- stejný důvod jako u marketingu, čistá testovací databáze výchozí
-- práva Supabase nemá): scripts/provoz-granty.test.mjs.
-- =====================================================================


-- ---------------------------------------------------------------------
-- audit_log — zvlášť, viz vysvětlení výš
-- ---------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
    on public.audit_log from anon, authenticated;


-- ---------------------------------------------------------------------
-- Zbytek: anon nemá na provozu co dělat, authenticated nesmí vysypat
--
-- select/insert/update/delete u authenticated zůstávají — RLS
-- rozhoduje, kdo se ke kterému řádku dostane. Jmenovitě, ne
-- `all tables in schema public`: hromadný příkaz by sáhl i na
-- marketing a v migraci by nebylo vidět, čeho se to týkalo.
-- ---------------------------------------------------------------------

revoke all on public.advances                  from anon;
revoke all on public.announcement_reads        from anon;
revoke all on public.announcements             from anon;
revoke all on public.attendance_events         from anon;
revoke all on public.branch_devices            from anon;
revoke all on public.branches                  from anon;
revoke all on public.challenges                from anon;
revoke all on public.checklist_entries         from anon;
revoke all on public.checklist_items           from anon;
revoke all on public.checklist_runs            from anon;
revoke all on public.checklist_templates       from anon;
revoke all on public.consent_kinds             from anon;
revoke all on public.consents                  from anon;
revoke all on public.device_registrations      from anon;
revoke all on public.employee_permissions      from anon;
revoke all on public.employee_pins             from anon;
revoke all on public.employee_points           from anon;
revoke all on public.employees                 from anon;
revoke all on public.invitations               from anon;
revoke all on public.konverzace                from anon;
revoke all on public.konverzace_ucastnici      from anon;
revoke all on public.konverzace_zpravy         from anon;
revoke all on public.membership_branches       from anon;
revoke all on public.memberships               from anon;
revoke all on public.menu_items                from anon;
revoke all on public.modules                   from anon;
revoke all on public.morning_reports           from anon;
revoke all on public.notifications             from anon;
revoke all on public.permissions               from anon;
revoke all on public.position_permissions      from anon;
revoke all on public.positions                 from anon;
revoke all on public.praises                   from anon;
revoke all on public.privacy_acknowledgements  from anon;
revoke all on public.privacy_notices           from anon;
revoke all on public.profiles                  from anon;
revoke all on public.recipe_ingredients        from anon;
revoke all on public.recipes                   from anon;
revoke all on public.reward_claims             from anon;
revoke all on public.reward_items              from anon;
revoke all on public.role_permissions          from anon;
revoke all on public.roles                     from anon;
revoke all on public.sablony_smen              from anon;
revoke all on public.shift_templates           from anon;
revoke all on public.shifts                    from anon;
revoke all on public.task_templates            from anon;
revoke all on public.tasks                     from anon;
revoke all on public.tenant_modules            from anon;
revoke all on public.tenant_settings           from anon;
revoke all on public.tenants                   from anon;
revoke all on public.useky                     from anon;
revoke all on public.weekly_menu_documents     from anon;

revoke truncate, references, trigger on public.advances                  from authenticated;
revoke truncate, references, trigger on public.announcement_reads        from authenticated;
revoke truncate, references, trigger on public.announcements             from authenticated;
revoke truncate, references, trigger on public.attendance_events         from authenticated;
revoke truncate, references, trigger on public.branch_devices            from authenticated;
revoke truncate, references, trigger on public.branches                  from authenticated;
revoke truncate, references, trigger on public.challenges                from authenticated;
revoke truncate, references, trigger on public.checklist_entries         from authenticated;
revoke truncate, references, trigger on public.checklist_items           from authenticated;
revoke truncate, references, trigger on public.checklist_runs            from authenticated;
revoke truncate, references, trigger on public.checklist_templates       from authenticated;
revoke truncate, references, trigger on public.consent_kinds             from authenticated;
revoke truncate, references, trigger on public.consents                  from authenticated;
revoke truncate, references, trigger on public.device_registrations      from authenticated;
revoke truncate, references, trigger on public.employee_permissions      from authenticated;
revoke truncate, references, trigger on public.employee_pins             from authenticated;
revoke truncate, references, trigger on public.employee_points           from authenticated;
revoke truncate, references, trigger on public.employees                 from authenticated;
revoke truncate, references, trigger on public.invitations               from authenticated;
revoke truncate, references, trigger on public.konverzace                from authenticated;
revoke truncate, references, trigger on public.konverzace_ucastnici      from authenticated;
revoke truncate, references, trigger on public.konverzace_zpravy         from authenticated;
revoke truncate, references, trigger on public.membership_branches       from authenticated;
revoke truncate, references, trigger on public.memberships               from authenticated;
revoke truncate, references, trigger on public.menu_items                from authenticated;
revoke truncate, references, trigger on public.modules                   from authenticated;
revoke truncate, references, trigger on public.morning_reports           from authenticated;
revoke truncate, references, trigger on public.notifications             from authenticated;
revoke truncate, references, trigger on public.permissions               from authenticated;
revoke truncate, references, trigger on public.position_permissions      from authenticated;
revoke truncate, references, trigger on public.positions                 from authenticated;
revoke truncate, references, trigger on public.praises                   from authenticated;
revoke truncate, references, trigger on public.privacy_acknowledgements  from authenticated;
revoke truncate, references, trigger on public.privacy_notices           from authenticated;
revoke truncate, references, trigger on public.profiles                  from authenticated;
revoke truncate, references, trigger on public.recipe_ingredients        from authenticated;
revoke truncate, references, trigger on public.recipes                   from authenticated;
revoke truncate, references, trigger on public.reward_claims             from authenticated;
revoke truncate, references, trigger on public.reward_items              from authenticated;
revoke truncate, references, trigger on public.role_permissions          from authenticated;
revoke truncate, references, trigger on public.roles                     from authenticated;
revoke truncate, references, trigger on public.sablony_smen              from authenticated;
revoke truncate, references, trigger on public.shift_templates           from authenticated;
revoke truncate, references, trigger on public.shifts                    from authenticated;
revoke truncate, references, trigger on public.task_templates            from authenticated;
revoke truncate, references, trigger on public.tasks                     from authenticated;
revoke truncate, references, trigger on public.tenant_modules            from authenticated;
revoke truncate, references, trigger on public.tenant_settings           from authenticated;
revoke truncate, references, trigger on public.tenants                   from authenticated;
revoke truncate, references, trigger on public.useky                     from authenticated;
revoke truncate, references, trigger on public.weekly_menu_documents     from authenticated;
