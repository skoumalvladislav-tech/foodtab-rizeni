-- ---------------------------------------------------------------------
-- Druhý nález z auditu bankovního modulu (6. 10. 2026), objevený při
-- ověřování opravy platby_faktury (20261006100000) — živým dotazem na
-- `information_schema.role_table_grants`, ne čtením migrací. DVĖ
-- různé příčiny, stejný výsledný díra:
--
--   - `platebni_ucty`, `integrace_pripojeni`, `kontakty`,
--     `kontakty_osoby`, `predpisy_plateb`: P0 migrace daly VÝSLOVNĖ
--     `grant select, insert, update, delete ... to authenticated`
--     (nejspíš zkopírovaná šablona „plné CRUD", bez zvážení dopadu
--     per tabulka).
--   - `import_davky`: vlastní migrace grantuje jen `select, insert` —
--     DELETE sem přišel ze Supabase defaultních práv pro `authenticated`
--     na nové tabulky, protože se nikdy neudělal `revoke all` jako
--     první krok (stejná třída chyby jako platby_faktury, 20261006100000).
--
-- Appka nikde v app/lib nevolá `.delete()` na žádnou z těchto šesti
-- tabulek (ověřeno grepem) — DELETE grant je nevyužitá cesta, ne
-- funkce, revoke nic nerozbije.
--
-- NEJZÁVAŽNĖJŠÍ dopad: `platebni_ucty` má `on delete cascade` z
-- `transakce.ucet_id` (20261003120000) i z `bankovni_zustatky.platebni_ucet_id`
-- (20261004100000) — DELETE řádku účtu by smazal CELÝ žurnál transakcí
-- a historii zůstatků té firmy, přesně to, co appka všude slibuje
-- (transakce.zdroj komentář, krok84_scenar.sql): „transakce se nemažou,
-- jen stornují". `integrace_pripojeni` má stejně `on delete cascade`
-- z `synchronizace_behy.integrace_pripojeni_id` — smazal by historii
-- synchronizací. Cascade na úrovni FK se neřídí tím, jestli volající
-- má grant na DĪTĖ tabulku — jen na RODIČE, kterého appka teď mazat
-- nedovolí.
--
-- `kontakty`/`kontakty_osoby` mají vlastní `deleted_at` (soft-delete),
-- `predpisy_plateb` a `import_davky` appka maže taky jedině přes
-- budoucí řádnou cestu, ne přímý klientský DELETE. Revoke je bezpečný
-- bez náhradní RPC — nic to nerozbije, appka na DELETE nikde nespoléhá.
-- ---------------------------------------------------------------------

revoke delete on public.platebni_ucty from authenticated;
revoke delete on public.integrace_pripojeni from authenticated;
revoke delete on public.kontakty from authenticated;
revoke delete on public.kontakty_osoby from authenticated;
revoke delete on public.predpisy_plateb from authenticated;
revoke delete on public.import_davky from authenticated;
