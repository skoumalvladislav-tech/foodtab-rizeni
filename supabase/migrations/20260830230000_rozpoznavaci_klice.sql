-- =====================================================================
-- Foodtab — rozpoznávací klíče pro nahrávání dat
--
-- Zadání: docs/nahravani-dat-zadani.md, oddíl A. Každá tabulka, kterou
-- plní zákazník, musí mít podle čeho řádek poznat. Bez toho se nedá
-- napsat „najdi podle klíče, aktualizuj; když není, založ“ a druhé
-- spuštění importu by všechno zdvojilo.
--
-- Klíč patří do databáze, ne do importního skriptu. Skript se dá obejít
-- ručním vložením, druhým importérem nebo překlepem; podmínka na tabulce
-- ne. (Stejná úvaha jako u pravidla 3 — dvě obranné linie.)
--
-- Co už klíč mělo a nesahá se na to:
--   branches   unique (tenant_id, slug)      — z foundation
--   roles      unique (tenant_id, key)       — z foundation
--   positions  unique (tenant_id, key)       — strojový klíč; níž
--                                              přibývá ještě název
--
-- Porovnává se přes lower(btrim(...)). „Jan Novák “ z tabulky a „jan
-- novák“ z pokladny je pořád tentýž člověk a import je nesmí založit
-- dvakrát. Ukládá se dál původní podoba — mění se jen to, podle čeho se
-- řádky srovnávají. Funkce lower i btrim jsou vestavěné, takže tu není
-- žádné rozšíření Postgresu ani citext.
-- =====================================================================


-- ---------------------------------------------------------------------
-- NEJDŘÍV SE ZEPTÁME DAT
--
-- Kdyby v ostrých datech duplicity už byly, spadlo by vytvoření indexu
-- na hlášku o porušené jedinečnosti, ze které není poznat, čeho se týká.
-- Tohle řekne tabulku i počet, ať se to dá opravit bez hádání.
-- ---------------------------------------------------------------------

do $$
declare
  v_zpravy text[] := '{}';
  v_pocet  bigint;
begin
  select count(*) into v_pocet from (
    select 1 from public.employees
    where deleted_at is null
    group by tenant_id, lower(btrim(full_name)) having count(*) > 1
  ) d;
  if v_pocet > 0 then
    v_zpravy := v_zpravy || format('employees: %s jmen je ve firmě dvakrát', v_pocet);
  end if;

  select count(*) into v_pocet from (
    select 1 from public.positions
    group by tenant_id, lower(btrim(label)) having count(*) > 1
  ) d;
  if v_pocet > 0 then
    v_zpravy := v_zpravy || format('positions: %s názvů pozice je ve firmě dvakrát', v_pocet);
  end if;

  select count(*) into v_pocet from (
    select 1 from public.recipes
    group by tenant_id, lower(btrim(name)) having count(*) > 1
  ) d;
  if v_pocet > 0 then
    v_zpravy := v_zpravy || format('recipes: %s názvů receptury je ve firmě dvakrát', v_pocet);
  end if;

  select count(*) into v_pocet from (
    select 1 from public.shifts
    where employee_id is not null
    group by tenant_id, branch_id, employee_id, shift_date having count(*) > 1
  ) d;
  if v_pocet > 0 then
    v_zpravy := v_zpravy || format(
      'shifts: %s případů, kdy má člověk na jedné pobočce a jeden den víc směn', v_pocet);
  end if;

  if array_length(v_zpravy, 1) > 0 then
    raise exception E'Data neodpovídají rozpoznávacím klíčům z oddílu A:\n  %\n'
      'Duplicity je potřeba srovnat dřív, než se klíč zavede — jinak by '
      'import nevěděl, který z těch řádků má aktualizovat.',
      array_to_string(v_zpravy, E'\n  ');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- ZAMĚSTNANEC = JMÉNO V RÁMCI FIRMY
--
-- Částečný index kvůli pravidlu 9: mazání je označení, ne výmaz. Řádek
-- se smazaným zůstává navždy kvůli návaznosti docházky, a kdyby držel
-- jméno obsazené, nešlo by po odchodu a návratu téhož člověka založit
-- záznam znovu.
-- ---------------------------------------------------------------------

create unique index if not exists employees_tenant_jmeno
  on public.employees (tenant_id, lower(btrim(full_name)))
  where deleted_at is null;

comment on index public.employees_tenant_jmeno is
  'Rozpoznávací klíč pro nahrávání lidí (oddíl A zadání). Jen mezi '
  'nesmazanými — smazaný záznam jméno neblokuje.';


-- ---------------------------------------------------------------------
-- POZICE = NÁZEV
--
-- Sloupec key je strojový klíč a jedinečný už je. V tabulce od zákazníka
-- ale žádný key není — je tam „Kuchař“. Import se proto trefuje podle
-- názvu a ten musí být jedinečný taky.
-- ---------------------------------------------------------------------

create unique index if not exists positions_tenant_nazev
  on public.positions (tenant_id, lower(btrim(label)));

comment on index public.positions_tenant_nazev is
  'Rozpoznávací klíč pro nahrávání pozic (oddíl A zadání). Vedle '
  'strojového key, podle kterého se trefuje kód.';


-- ---------------------------------------------------------------------
-- RECEPTURA = NÁZEV
--
-- Vázané na firmu, ne na pobočku — tak to má oddíl A. Receptura tedy
-- nese jedno jméno za celou firmu, i když má vyplněnou branch_id.
-- ---------------------------------------------------------------------

create unique index if not exists recipes_tenant_nazev
  on public.recipes (tenant_id, lower(btrim(name)));

comment on index public.recipes_tenant_nazev is
  'Rozpoznávací klíč pro nahrávání receptur (oddíl A zadání).';


-- ---------------------------------------------------------------------
-- SMĚNA = ČLOVĚK + PROVOZNÍ DEN + POBOČKA
--
-- shift_date je provozní den, ne kalendářní — plní ho tak rozpis
-- i import.
--
-- Neobsazená směna má employee_id prázdné a v jedinečném indexu se
-- prázdné hodnoty navzájem nerovnají. Je to tak správně: „sem někoho
-- potřebujeme“ může na jednom dni stát klidně třikrát.
-- ---------------------------------------------------------------------

create unique index if not exists shifts_clovek_den_pobocka
  on public.shifts (tenant_id, branch_id, employee_id, shift_date);

comment on index public.shifts_clovek_den_pobocka is
  'Rozpoznávací klíč pro nahrávání rozpisu (oddíl A zadání). '
  'Neobsazené směny neomezuje — prázdné employee_id se nerovná '
  'prázdnému.';
