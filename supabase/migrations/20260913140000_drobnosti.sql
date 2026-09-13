-- =====================================================================
-- Foodtab — Drobnosti (Bod 8)
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 6.
--
-- 1. search_path = '' na třech funkcích, kde chybělo.
--    Bez toho mohl zákeřný objekt v jiném schématu překrýt
--    vestavěnou funkci nebo operátor. Funkce jsou IMMUTABLE SQL
--    a žádné tabulky nevytahují, takže přidání search_path nic
--    nerozbije — jen uzavře cestu k útoku.
--
-- 2. Komentář na zapomenute_odchody vysvětluje, proč tabulka
--    nemá ani jednu RLS politiku. Bez toho vypadá jako opomenutí.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1a. app.doruci_se — chybělo set search_path
-- ---------------------------------------------------------------------

create or replace function app.doruci_se(
  p_na_smene    uuid,   -- pobočka otevřeného příchodu, NULL = mimo směnu
  p_konv_branch uuid,   -- pobočka konverzace, NULL = není pobočková
  p_nalehava    boolean
)
returns boolean
language sql immutable set search_path = ''
as $$
  select
    coalesce(p_nalehava, false)
    or (
      p_na_smene is not null
      and (
        p_konv_branch is null
        or p_konv_branch = p_na_smene
      )
    );
$$;

comment on function app.doruci_se(uuid, uuid, boolean) is
  'Smí se ta zpráva TEĎ oznámit? Jediné místo, kde je Šéfíkovo pravidlo '
  'o doručení po píchnutí zapsané. Nepřepisovat jinde — viz hlavičku '
  'migrace 20260906010000, důvod je v § 78 ZP, ne v pohodlí.';


-- ---------------------------------------------------------------------
-- 1b. app.delka_smeny_minut — chybělo set search_path
-- ---------------------------------------------------------------------

create or replace function app.delka_smeny_minut(p_od time, p_do time)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when p_do > p_od
      then extract(epoch from (p_do - p_od))::integer / 60
    else
      (86400 - extract(epoch from p_od)::integer + extract(epoch from p_do)::integer) / 60
  end;
$$;

comment on function app.delka_smeny_minut(time, time) is
  'Délka směny v minutách. Konec dřív než začátek znamená druhý den, '
  'ne zápornou délku.';


-- ---------------------------------------------------------------------
-- 1c. app.sablona_poradi — chybělo set search_path
-- ---------------------------------------------------------------------

create or replace function app.sablona_poradi(
  p_branch     uuid,
  p_position   uuid,
  t_branch     uuid,
  t_position   uuid
)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when t_branch is not distinct from p_branch
     and t_position is not distinct from p_position
     and t_branch is not null and t_position is not null then 1
    when t_branch is not distinct from p_branch and t_branch is not null
     and t_position is null then 2
    when t_branch is null
     and t_position is not distinct from p_position and t_position is not null then 3
    when t_branch is null and t_position is null then 4
    else null
  end;
$$;

comment on function app.sablona_poradi(uuid, uuid, uuid, uuid) is
  'Jak úzce šablona sedí: 1 pobočka+pozice, 2 pobočka, 3 firma+pozice, '
  '4 firma. NULL = nesedí vůbec.';


-- ---------------------------------------------------------------------
-- 2. Komentář na zapomenute_odchody — proč žádná RLS politika
-- ---------------------------------------------------------------------

comment on table public.zapomenute_odchody is
  'O kterých příchodech bez odchodu se už hlásilo. Primární klíč je '
  'samotná událost — dvojí spuštění úlohy druhé upozornění nevyrobí. '
  '--- '
  'PROČ CHYBÍ RLS POLITIKA: tabulku nečte ani nezapisuje přihlášený '
  'uživatel přes aplikaci — píše do ní jen ohlasit_zapomenute_odchody() '
  '(SECURITY DEFINER) a čte ji tatáž funkce v NOT EXISTS. authenticated '
  'má revoke all, takže žádná politika není opomenutí; je to záměr.';
