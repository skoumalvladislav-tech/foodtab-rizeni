-- ---------------------------------------------------------------------
-- Dopravek k 20261006120000: ta migrace měla odebrat DELETE grant ze
-- šesti tabulek, co ho mít neměly, ale `platby_faktury` v ní omylem
-- chybí (nahrazeno `kontakty_osoby`, aniž by se zkontrolovalo, že
-- `platby_faktury` byl v PŮVODNÍM nálezu taky — živý dotaz na
-- `information_schema.role_table_grants` proti `foodtab-test` po
-- nasazení 20261006120000 to odhalil: `platby_faktury` DELETE pro
-- `authenticated` pořád má).
--
-- Stejný důvod jako u UPDATE (20261006100000): `app.zrusit_alokaci_platby`
-- (SECURITY DEFINER) dělá řízený soft-delete (`stav='zamitnuto'`) —
-- přímý DELETE by zrušení alokace úplně smazal, ne jen zamítl, a
-- zmizel by i z `audit_log` dohledatelný řádek (trigger loguje
-- UPDATE/DELETE, ale po DELETE už neexistuje řádek, na který by se
-- dalo z appky odkázat). Appka na DELETE téhle tabulky nikde
-- nespoléhá (ověřeno grepem, stejně jako u 20261006100000/20261006120000).
-- ---------------------------------------------------------------------

revoke delete on public.platby_faktury from authenticated;
