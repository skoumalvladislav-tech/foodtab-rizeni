-- =====================================================================
-- Foodtab — dvě drobnosti, které nejsou díra, ale mátly by
--
-- Zadání docs/dodelat-vse-2026-09-08.md, bod 8.
--
-- Obě jsou o tom, aby se za měsíc někdo nepokoušel „opravit" něco, co
-- je v pořádku — a nerozbil to přitom.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. `search_path` u tří funkcí
--
-- `app.doruci_se`, `app.delka_smeny_minut` a `app.sablona_poradi` ho
-- jako jediné v `app` nemají. Zbytek schématu ho nastavený má.
--
-- NENÍ TO DÍRA a je důležité vědět proč: `set search_path = ''` chrání
-- před tím, aby někdo podstrčil vlastní funkci nebo tabulku dřív
-- v cestě a nechal ji běžet s VYŠŠÍM oprávněním. To se týká funkcí
-- `security definer`. Tyhle tři jsou `language sql immutable` BEZ
-- `security definer` — běží pod právy volajícího, takže podstrčením by
-- si nikdo nepomohl k ničemu, co sám nemá.
--
-- Jsou navíc čistě početní: nesahají na jedinou tabulku a volají jen
-- to, co je v `pg_catalog` (`extract`, `coalesce`, `case`). Prázdný
-- `search_path` je proto bezpečný — `pg_catalog` se prohledává vždycky,
-- i když v cestě není vypsaný.
--
-- Srovnává se to tedy kvůli KONVENCI, ne kvůli bezpečnosti: odchylka
-- v jednom ze čtyřiceti míst svádí k domněnce, že tam má nějaký důvod
-- být, a příště se podle ní napíše čtvrtá funkce, u které už na tom
-- záležet bude.
--
-- `alter function` schválně místo `create or replace`: tělo se nemění
-- ani o znak, takže ho nemá smysl přepisovat a riskovat překlep.
-- ---------------------------------------------------------------------

alter function app.doruci_se(uuid, uuid, boolean)      set search_path = '';
alter function app.delka_smeny_minut(time, time)       set search_path = '';
alter function app.sablona_poradi(uuid, uuid, uuid, uuid) set search_path = '';


-- ---------------------------------------------------------------------
-- 2. Proč `zapomenute_odchody` nemá politiku
--
-- Tabulka má zapnuté RLS a ANI JEDNU politiku. Vypadá to jako
-- nedodělek — a přesně proto tenhle komentář vzniká: aby ji za měsíc
-- někdo „neopravil" tím, že jí politiku dopíše a tabulku tím otevře.
--
-- Zapnuté RLS bez politiky znamená, že přes `authenticated` NEPROJDE
-- ANI ŘÁDEK. To je tady žádaný stav, ne opomenutí.
--
-- A je zavřená dvakrát: kromě chybějící politiky nemá pro
-- `authenticated` ani `grant`. Dotaz by tedy skončil na 42501 dřív,
-- než se RLS vůbec zeptá na řádky.
--
-- Píše a čte ji `public.ohlasit_zapomenute_odchody()`, která má
-- `grant execute` jen pro `service_role` (20260902100000, ř. 587) —
-- tedy noční úloha, ne přihlášený člověk. Je to evidence pro hlídače,
-- ne obsah pro obrazovku: kdo má vidět nedokončenou docházku, vidí ji
-- přes `attendance_events` a `app.has_access`.
--
-- KDYBY TO NĚKDO CHTĚL OTEVŘÍT: nejdřív musí odpovědět, komu a proč.
-- Samotné dopsání politiky odpověď není.
-- ---------------------------------------------------------------------

comment on table public.zapomenute_odchody is
  'Evidence hlídače zapomenutých odchodů. RLS je zapnuté a politika tu '
  'SCHVÁLNĚ ŽÁDNÁ NENÍ — přes authenticated nesmí projít ani řádek. '
  'Zavřená je dvakrát: chybí i grant. Píše a čte ji '
  'public.ohlasit_zapomenute_odchody() pod service_role. Nedopisuj sem '
  'politiku bez rozhodnutí, komu a proč se má otevřít.';
