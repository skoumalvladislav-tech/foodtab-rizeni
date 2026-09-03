-- =====================================================================
-- Foodtab — `shift_templates` je opuštěná, ať na ní nikdo nestaví
--
-- Tabulka `public.shift_templates` vznikla v základní migraci
-- 20260823130000 jako TÝDENNÍ VZOR OBSAZENÍ: „v úterý mají na baru
-- stát dva lidi“ (`weekday`, `headcount`). Nikdy se nezačala používat —
-- v aplikaci, v knihovnách ani ve scénářích na ni není odkaz.
--
-- 3. 9. 2026 na ni málem začaly stavět šablony směn (D, N, R), protože
-- se jmenuje, jak se jmenuje. `create table if not exists` tiše neudělal
-- nic a přišlo se na to až o krok dál, když index hlásil neexistující
-- sloupec. Šablony směn jsou dnes v `public.sablony_smen`.
--
-- Tahle migrace tabulku NERUŠÍ — jen jí dává komentář, aby se příště
-- nikdo nespletl. Zrušit ji je samostatné rozhodnutí a samostatná
-- migrace; komentář je levný a zabírá to, co je potřeba: aby se na ni
-- nezačalo stavět.
-- =====================================================================

comment on table public.shift_templates is
  'OPUŠTĚNÁ — nepoužívat. Měl to být týdenní vzor obsazení (v úterý '
  'dva lidi na baru), ale nikdy se to nezačalo používat a nic na ni '
  'neodkazuje. Pojmenované směny s časy (D, N, R) jsou v '
  'public.sablony_smen, ne tady. Před smazáním ověřit, že na ni pořád '
  'nic neodkazuje.';

comment on column public.shift_templates.weekday is
  'OPUŠTĚNÁ tabulka — viz komentář u tabulky.';
comment on column public.shift_templates.headcount is
  'OPUŠTĚNÁ tabulka — viz komentář u tabulky.';
