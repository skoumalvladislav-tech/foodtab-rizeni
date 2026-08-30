-- =====================================================================
-- Foodtab — nahrání rozpisu ze srpna a září 2026
--
-- Zdroj: "rozpis směn list SRPEN|ZÁŘÍ verze2.0.xlsx", list List2.
-- Mřížka den × člověk. Značka v buňce znamená typ směny a pobočku:
--     bez písmene / -P  → Restaurace Černá Perla
--     -B                → Bernard Bar Tábor
--     R = ranní, O = odpolední, X = celá směna, D = denní
--     STANEK            → k směně se připíše poznámka "+ stánek"
--
-- ČASY — upřesnil je Šéfík 28. 8. 2026. V tabulce žádné nebyly.
--     ranní      07:30–14:00
--     odpolední  14:00–22:00
--     denní      07:30–22:00
--     celá       07:30–22:00
--
-- „Celá" je úsudek, ne zadání: ranní a odpolední dohromady dají přesně
-- tohle rozpětí. Typ je zapsaný v poznámce u každé směny, takže případná
-- oprava je jeden UPDATE, ne přepisování 133 řádků:
--     update public.shifts set starts_at='..', ends_at='..'
--      where note like 'rozpis celá%';
--
-- NENAHRÁNO — dvě buňky:
--     11. a 12. 9.  Láďa  "TAB" — víkendová akce, do rozpisu nepatří
--
-- POBOČKA U DENNÍCH SMĚN: tabulka ji neurčovala. Lucka je v celém
-- rozpisu jen na Bernardu, proto jsou tam. Úsudek, ne zadání.
--
-- Skript jde pustit opakovaně: nejdřív smaže, co z rozpisu pochází.
-- =====================================================================

do $$
declare
  v_tenant uuid; v_perla uuid; v_bar uuid; v_pocet int;
  c_data constant text := '19|Láďa|p|c;19|Lucka|b|c;19|Maruška|p|c;19|Veronika|b|c;19|Andrea|p|c;20|Láďa|p|c;20|Maruška|b|c;20|Veronika|p|c;20|Irina|p|c;20|Andrea|p|c;21|Oxy|p|c;21|Lucka|b|c;21|Veronika|b|o;21|Irina|p|c;22|Oxy|p|c;22|Lucka|b|c;22|Vali|p|c;22|Andrea|p|c;23|Oxy|p|c;23|Lucka|b|c;23|Maruška|p|c;23|Vali|p|c;24|Láďa|p|c;24|Maruška|p|c;24|Maruška|b|o;24|Veronika|b|c;24|Irina|p|c;24|Světlana|p|c;25|Láďa|b|c;25|Maruška|p|c;25|Veronika|p|c;25|Andrea|p|c;25|Světlana|b|c;26|Oxy|p|c;26|Maruška|b|c;26|Irina|p|c;26|Vali|p|c;26|Andrea|b|c;27|Láďa|b|c;27|Oxy|p|c;27|Irina|p|c;27|Vali|p|c;27|Světlana|b|c;28|Oxy|p|c;28|Maruška|b|o;28|Veronika|b|c;28|Andrea|p|c;28|Anička|p|c;29|Láďa|p|c;29|Maruška|b|c;29|Veronika|b|c;29|Irina|p|c;29|Světlana|p|c;30|Oxy|p|c;30|Maruška|p|c;30|Veronika|b|c;30|Andrea|p|c;30|Světlana|b|o;31|Láďa|p|c;31|Lucka|b|c;31|Vali|p|c;31|Andrea|p|c;1|Láďa|p|c;1|Lucka|b|c;1|Irina|p|c;1|Světlana|p|c;2|Láďa|p|r;2|Oxy|p|c;2|Veronika|b|c;2|Vali|p|c;2|Andrea|p|c;3|Láďa|p|r;3|Oxy|p|c;3|Maruška|b|o;3|Veronika|b|c;3|Irina|p|c;3|Andrea|p|c;4|Láďa|p|r;4|Oxy|p|c;4|Lucka|b|c;4|Irina|p|c;4|Vali|p|c;4|Světlana|b|c;5|Láďa|p|c;5|Lucka|b|c;5|Maruška|p|c;5|Vali|p|c;5|Světlana|b|o;6|Láďa|p|c;6|Lucka|b|c;6|Maruška|p|c;6|Světlana|p|c;7|Láďa|p|r;7|Oxy|p|c;7|Veronika|b|c;7|Irina|p|c;7|Andrea|p|c;8|Láďa|p|c;8|Veronika|b|c;8|Irina|p|c;8|Andrea|p|c;9|Láďa|p|c;9|Lucka|b|o;9|Maruška|p|c;9|Veronika|b|r;9|Vali|p|c;10|Láďa|p|r;10|Oxy|p|c;10|Lucka|b|c;10|Vali|p|c;10|Světlana|p|c;11|Oxy|p|c;11|Lucka|b|o;11|Maruška|p|cs;11|Veronika|b|c;11|Irina|p|c;11|Andrea|p|c;12|Oxy|p|c;12|Lucka|b|c;12|Maruška|p|cs;12|Veronika|b|c;12|Irina|p|c;12|Andrea|p|c;12|Světlana|p|cs;13|Oxy|p|c;13|Veronika|b|c;13|Irina|p|c;13|Andrea|p|c;13|Světlana|b|c;14|Láďa|p|c;14|Lucka|b|c;14|Maruška|p|c;14|Vali|p|c;26|Lucka|b|d;27|Lucka|b|d';
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  select id into v_perla from public.branches where tenant_id=v_tenant and slug='cerna-perla';
  select id into v_bar   from public.branches where tenant_id=v_tenant and slug='bernard-bar';

  delete from public.shifts where tenant_id=v_tenant and note like 'rozpis %';

  with z as (
    select split_part(x,'|',1)::int      as den,
           split_part(x,'|',2)           as jmeno,
           split_part(x,'|',3)           as pob,
           left(split_part(x,'|',4),1)   as typ,
           split_part(x,'|',4) like '%s' as stanek
    from regexp_split_to_table(c_data, ';') as x
  )
  insert into public.shifts
    (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, note, status)
  select v_tenant,
         case when z.pob='b' then v_bar else v_perla end,
         e.id,
         make_date(2026, case when z.den >= 19 then 8 else 9 end, z.den),
         case z.typ when 'o' then time '14:00' else time '07:30' end,
         case z.typ when 'r' then time '14:00' else time '22:00' end,
         'rozpis ' || case z.typ when 'r' then 'ranní'
                                 when 'o' then 'odpolední'
                                 when 'd' then 'denní'
                                 else 'celá' end
                   || case when z.stanek then ' + stánek' else '' end,
         case when make_date(2026, case when z.den >= 19 then 8 else 9 end, z.den) < current_date
              then 'confirmed' else 'planned' end
  from z
  join public.employees e
    on e.tenant_id = v_tenant and e.full_name = z.jmeno and e.deleted_at is null;

  get diagnostics v_pocet = row_count;
  raise notice 'Nahrano % smen ze 133 radku rozpisu.', v_pocet;
end $$;

-- Kontrolní přehled
select b.name as pobocka, replace(s.note,'rozpis ','') as typ, count(*) as smen,
       min(s.shift_date) as od, max(s.shift_date) as konec
from public.shifts s
join public.branches b on b.id = s.branch_id
group by 1,2
order by 1,2;
