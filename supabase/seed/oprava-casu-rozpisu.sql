-- =====================================================================
-- Foodtab — oprava časů u nahraného rozpisu srpen/září 2026
--
-- Když se rozpis nahrával, časy v tabulce nebyly a doplnily se odhadem.
-- Šéfík je 28. 8. 2026 upřesnil:
--
--     ranní      07:30–14:00
--     odpolední  14:00–22:00
--     celá       07:30–22:00   (viz poznámka níž)
--
-- Skript časy jen přepíše. Směny nemaže a nezakládá znovu, takže
-- zůstanou zachované jejich identifikátory — kdyby už na ně někde
-- visela docházka, nepřijde o vazbu.
--
-- Pustit se dá opakovaně. Podruhé jen nic nezmění.
--
-- POZNÁMKA K „CELÉ" SMĚNĚ
-- Šéfík upřesnil ranní, denní a odpolední. Značku X v tabulce jsem
-- četl jako „celou" směnu a dávám jí stejné časy jako denní, protože
-- ranní 07:30–14:00 plus odpolední 14:00–22:00 dohromady přesně to
-- rozpětí dají. Je to úsudek, ne zadání. Kdyby celá směna byla něco
-- jiného, opraví se to jedním příkazem — je jich 110 ze 133:
--     update public.shifts set starts_at='..', ends_at='..'
--      where note like 'rozpis celá%';
-- =====================================================================

begin;

update public.shifts
   set starts_at = time '07:30', ends_at = time '14:00'
 where note like 'rozpis ranní%';

update public.shifts
   set starts_at = time '14:00', ends_at = time '22:00'
 where note like 'rozpis odpolední%';

update public.shifts
   set starts_at = time '07:30', ends_at = time '22:00'
 where note like 'rozpis celá%';


-- ---------------------------------------------------------------------
-- DVĚ SMĚNY, KTERÉ SE MINULE NENAHRÁLY
--
-- 26. a 27. 8. měla Lucka v tabulce „D". Tehdy jsem nevěděl, co to je,
-- a raději jsem je vynechal, než abych si domyslel. Teď víme: denní,
-- 07:30–22:00.
--
-- POBOČKU TABULKA NEURČOVALA. Dávám je na Bernard Bar, protože Lucka
-- je v celém rozpisu na Bernardu a nikde jinde. Je to úsudek. Když je
-- to špatně, změní se to v aplikaci u těch dvou směn ručně.
-- ---------------------------------------------------------------------

do $$
declare
  v_tenant uuid; v_bar uuid; v_lucka uuid; v_den date;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  select id into v_bar    from public.branches
   where tenant_id = v_tenant and slug = 'bernard-bar';
  select id into v_lucka  from public.employees
   where tenant_id = v_tenant and full_name = 'Lucka' and deleted_at is null;

  if v_tenant is null or v_bar is null or v_lucka is null then
    raise exception 'Nenašla se firma, pobočka bernard-bar nebo zaměstnankyně Lucka.';
  end if;

  foreach v_den in array array[date '2026-08-26', date '2026-08-27'] loop
    insert into public.shifts
      (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, note, status)
    select v_tenant, v_bar, v_lucka, v_den, time '07:30', time '22:00',
           'rozpis denní',
           case when v_den < current_date then 'confirmed' else 'planned' end
     where not exists (
       select 1 from public.shifts s
        where s.tenant_id = v_tenant
          and s.employee_id = v_lucka
          and s.shift_date = v_den
          and s.note = 'rozpis denní');
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- KONTROLA — vypíše, co je po opravě v databázi
-- ---------------------------------------------------------------------

select note, starts_at, ends_at, count(*) as pocet
  from public.shifts
 where note like 'rozpis %'
 group by note, starts_at, ends_at
 order by note;

commit;
