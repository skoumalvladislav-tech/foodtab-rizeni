-- =====================================================================
-- Foodtab — Marketing: sbírka 'kandidat_znacky' pro marketing_media
--
-- Nález kontroly konzistence k nástroji „Najít na webu“ (Marketing →
-- Značka, app/[rozsah]/marketing/znacka/akce-ai.ts): kandidátní logo,
-- které nástroj stáhne k náhledu, se dřív zapisovalo se stejnou
-- `sbirka = 'ostatni'` jako běžně nahraná fotka — hned se tak objevilo
-- ve sdílené Knihovně fotek (media/page.tsx) i ve výběru pro příspěvek
-- (tvorba/page.tsx, [prispevek]/page.tsx, akce.ts), ačkoli ho nikdo
-- nepřijal. Opakované zkoušení odkazů tak potichu plnilo knihovnu
-- neoznačenými kandidáty, které tam zůstanou navždy, pokud se návrh
-- odmítne nebo formulář opustí bez uložení.
--
-- Řešení: vlastní hodnota `sbirka`, kterou appka ve třech výpisech výš
-- schválně vyřazuje (`.neq('sbirka', 'kandidat_znacky')`). Při přijetí
-- (`ulozitZnacku` v app/[rozsah]/marketing/znacka/akce.ts) se řádek
-- přeřadí zpátky na `'ostatni'` a chová se dál jako kterákoli jiná
-- fotka v knihovně.
--
-- Trvalé smazání nepřijatých kandidátů (žádný odkaz z žádné
-- `marketing_nastaveni` řádky po přiměřené době) zůstává mimo rozsah
-- týhle opravy — vyžadovalo by plánovanou úlohu, kterou appka dnes
-- nemá. Tahle migrace řeší tu část nálezu, která byla bezpečnostně
-- i produktově vážnější: že kandidát šel hned vybrat do skutečného
-- příspěvku.
--
-- RLS a granty se nemění — `marketing_media` je pořád stejná tabulka,
-- jen s jednou další povolenou hodnotou ve stávajícím CHECK.
-- =====================================================================

alter table public.marketing_media
  drop constraint if exists marketing_media_sbirka_check;

alter table public.marketing_media
  add constraint marketing_media_sbirka_check
  check (sbirka in ('jidla', 'interier', 'lide', 'akce', 'ostatni', 'kandidat_znacky'));
