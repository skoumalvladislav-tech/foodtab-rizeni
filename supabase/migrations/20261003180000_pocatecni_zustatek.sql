-- =====================================================================
-- Foodtab — Finance: počáteční zůstatek platebního účtu
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5): „Cashflow:
-- skutečné pohyby a rolling výhled na 13 týdnů." Rolling výhled potřebuje
-- vědět, OD ČEHO se počítá — ne jen sumu budoucích pohybů, ale aktuální
-- stav účtu teď. `transakce` zaznamenává jen pohyby OD svého zavedení
-- (append-only ledger bez historie před prvním zápisem), takže
-- aktuální zůstatek = počáteční zůstatek (tenhle sloupec) + suma
-- všech transakcí. Nastavuje se jednou při zavedení účtu/zápisu
-- otevíracího zůstatku, ne při každé transakci.
-- =====================================================================

alter table public.platebni_ucty
  add column if not exists pocatecni_zustatek_haleru integer not null default 0;

comment on column public.platebni_ucty.pocatecni_zustatek_haleru is
  'Zůstatek účtu ke dni, od kterého appka zaznamenává pohyby (transakce). '
  'Aktuální zůstatek = tenhle sloupec + suma transakce.castka_haleru '
  '(se znaménkem podle smer). Nastavuje se jednou, ne při každém pohybu.';
