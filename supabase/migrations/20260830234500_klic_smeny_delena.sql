-- =====================================================================
-- Foodtab — do klíče směny patří i začátek
--
-- Předchozí migrace (20260830230000_rozpoznavaci_klice.sql) postavila
-- klíč směny na (tenant_id, branch_id, employee_id, shift_date) podle
-- oddílu A zadání: „člověk + provozní den + pobočka“.
--
-- Tím ale nešla zadat dělená směna — ráno a večer zvlášť, tentýž člověk,
-- tentýž den, tatáž pobočka. To je v gastru běžné, ne výjimka. Klíč
-- proto dostává ještě starts_at.
--
-- Nasazená migrace se neupravuje, tohle je nová. (Konvence z CLAUDE.md.)
--
-- Co se tím mění pro nahrávání: řádek se pozná i podle času začátku.
-- Když se v tabulce opraví začátek směny ze 7:00 na 7:30, import to
-- nebude brát jako opravu téže směny, ale založí druhou. Je to cena za
-- dělené směny a nese ji krok „náhled“ z oddílu B — právě proto se
-- před potvrzením vypisuje, co se založí a co aktualizuje.
--
-- Duplicity se tu nekontrolují jako minule: nový klíč je volnější než
-- ten dosavadní, takže co prošlo přísnějším, projde i tímhle. Nový
-- index nemá jak spadnout na datech, která starý index pustil.
-- =====================================================================

drop index if exists public.shifts_clovek_den_pobocka;

create unique index if not exists shifts_clovek_den_pobocka_zacatek
  on public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at);

comment on index public.shifts_clovek_den_pobocka_zacatek is
  'Rozpoznávací klíč pro nahrávání rozpisu (oddíl A zadání) doplněný '
  'o starts_at, aby šla zadat dělená směna. Neobsazené směny neomezuje '
  '— prázdné employee_id se nerovná prázdnému.';
