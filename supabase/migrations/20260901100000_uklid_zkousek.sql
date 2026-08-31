-- =====================================================================
-- Foodtab — úklid zkušebních řádků z ostrých dat
--
-- Jednorázová migrace. Při zkoušení obrazovek (seznam lidí, zakládání
-- pozic, nástěnka) zůstaly v databázi řádky, které tam nepatří:
--
--   employees      „ZKOUŠKA seznamu“, „ZKOUŠKA pozice“ (označené smazané)
--   announcements  „Zkouška seznamu — smažte“
--
-- Aplikace na jejich odklizení nemá obrazovku a mít ji nemá: mazání
-- zaměstnance je podle pravidla 9 označení, ne výmaz, a zprávy se
-- nemažou vůbec. Tohle jsou ale řádky, které nikdy neměly vzniknout,
-- ne data zákazníka.
--
-- Migrace je psaná tak, aby ji šlo pustit dvakrát a aby v cizí databázi
-- (nebo po ručním úklidu) prostě neudělala nic.
--
-- POZOR NA JMÉNA: maže se přesná shoda, ne `like 'ZKOUŠKA%'`. Kdyby si
-- někdy někdo pojmenoval člověka podobně, vzor by ho vzal s sebou.
-- =====================================================================

do $$
declare
  v_lidi  integer := 0;
  v_zpravy integer := 0;
  v_zbylo text[]  := '{}';
  v_id    uuid;
  v_jmeno text;
begin
  -- Zaměstnanci. Jen ti označení jako smazaní — kdyby někdo takový
  -- záznam mezitím vzkřísil a používal ho, tahle migrace se ho
  -- nedotkne.
  for v_id, v_jmeno in
    select id, full_name from public.employees
    where full_name in ('ZKOUŠKA seznamu', 'ZKOUŠKA pozice')
      and deleted_at is not null
  loop
    -- Docházka a směny na testovací lidi navázané nejsou, ale kdyby
    -- byly, řádek se nechá být. Smazat člověka, na kterém visí
    -- odpracované hodiny, by bylo horší než nechat v datech smetí.
    if exists (select 1 from public.attendance_events where employee_id = v_id)
       or exists (select 1 from public.shifts where employee_id = v_id)
       or exists (select 1 from public.employee_rates where employee_id = v_id) then
      v_zbylo := v_zbylo || format('%s (visí na něm docházka, směna nebo sazba)', v_jmeno);
      continue;
    end if;

    delete from public.employees where id = v_id;
    v_lidi := v_lidi + 1;
  end loop;

  delete from public.announcements
  where body = 'Zkouška seznamu — smažte';
  get diagnostics v_zpravy = row_count;

  raise notice 'Úklid zkoušek: smazáno % zaměstnanců, % zpráv.', v_lidi, v_zpravy;
  if array_length(v_zbylo, 1) > 0 then
    raise notice 'Nechal jsem být: %', array_to_string(v_zbylo, '; ');
  end if;
end $$;
