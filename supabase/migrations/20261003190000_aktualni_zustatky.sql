-- =====================================================================
-- Foodtab — Finance: aktuální zůstatek platebních účtů po pobočkách
--
-- Pro rolling 13týdenní výhled (lib/finance-rolling-vyhled.ts) potřebuje
-- appka vědět, od čeho výhled START UJE — ne jen pohyby za posledních
-- 13 týdnů, ale CELÝ aktuální zůstatek účtů. Ten je
-- `pocatecni_zustatek_haleru` (20261003180000) + saldo VŠECH transakcí
-- od zavedení účtu, ne jen posledních pár týdnů — proto samostatná
-- agregační funkce, ne filtrovaný dotaz z klienta.
-- =====================================================================

create or replace function app.aktualni_zustatky_uctu(p_tenant uuid)
returns table (branch_id uuid, zustatek_haleru bigint)
language sql stable security definer set search_path = ''
as $$
  select
    u.branch_id,
    sum(u.pocatecni_zustatek_haleru + coalesce(t.saldo, 0))::bigint
  from public.platebni_ucty u
  left join lateral (
    select sum(
      case
        when x.smer = 'prijem' then x.castka_haleru
        when x.smer = 'vydaj' then -x.castka_haleru
        else 0
      end
    ) as saldo
    from public.transakce x
    where x.ucet_id = u.id
  ) t on true
  where u.tenant_id = p_tenant
    and u.aktivni
    and app.has_access(p_tenant, 'finance.read')
  group by u.branch_id;
$$;

comment on function app.aktualni_zustatky_uctu(uuid) is
  'Aktuální zůstatek po pobočkách (branch_id null = firemní účty bez '
  'pobočky) — počáteční zůstatek účtu + saldo všech jeho transakcí. '
  'Vstup pro rolling 13týdenní cashflow výhled.';

revoke all on function app.aktualni_zustatky_uctu(uuid) from public, anon;
grant execute on function app.aktualni_zustatky_uctu(uuid) to authenticated;


create or replace function public.aktualni_zustatky_uctu(p_tenant uuid)
returns table (branch_id uuid, zustatek_haleru bigint)
language sql stable security invoker set search_path = ''
as $$
  select * from app.aktualni_zustatky_uctu(p_tenant);
$$;

revoke all on function public.aktualni_zustatky_uctu(uuid) from public, anon;
grant execute on function public.aktualni_zustatky_uctu(uuid) to authenticated;
