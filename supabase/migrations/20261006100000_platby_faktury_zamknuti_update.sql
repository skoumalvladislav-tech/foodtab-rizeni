-- ---------------------------------------------------------------------
-- Oprava: `platby_faktury` dostal 4. 10. 2026 (20261004100000) odebraný
-- přímý INSERT (jen přes `app.potvrdit_alokaci_platby`), ale UPDATE
-- zůstal omylem grantovaný `authenticated` ještě z P0 migrace
-- (20261003130000, `grant select, insert, update ... to authenticated`).
--
-- `app.zrusit_alokaci_platby` dělá svůj UPDATE jako SECURITY DEFINER
-- (vlastní tělo běží jako vlastník funkce, ne jako volající role) —
-- tenhle revoke ji tedy nijak neomezí. Bez něj ale šlo přímým
-- `.update()` z klienta obejít advisory zámek i kontrolu přečerpání
-- alokace z `potvrdit_alokaci_platby`, a třeba vrátit zamítnutou
-- alokaci zpátky na `potvrzeno` bez průchodu RPC. Grep přes app/lib
-- potvrdil, že appka na přímý klientský UPDATE této tabulky nikde
-- nespoléhá (jen `.select()`).
-- ---------------------------------------------------------------------

revoke update on public.platby_faktury from authenticated;
