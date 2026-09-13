-- =====================================================================
-- Foodtab — Kdo nepotvrdil (B3 doplněk)
--
-- Zadání: docs/velka-prace-2026-09-08.md, oddíl 4 B3:
--   „Vedoucí vidí, kdo ještě nepotvrdil."
--
-- PROČ FUNKCE A NE PŘÍMÝ DOTAZ
--
-- announcement_reads má RLS politiku, která pustí jen vlastní řádky.
-- Vedoucí by si přes klienta jiné záznamy nepřečetl. SECURITY DEFINER
-- (s rolbypassrls vlastníkem) RLS obejde a vrátí správnou množinu.
--
-- PRAVIDLO 7b
--
-- Uvnitř SECURITY DEFINER s rolbypassrls žádné RLS není. Proto funkce
-- filtruje tenant_id, deleted_at a requires_acknowledgment sama —
-- každou podmínku zvlášť, bez zkratky.
--
-- KDO MĚL VIDĚT
--
-- Stejná logika jako trigger upozornit_na_oznameni_trg:
--   employee_id vyplněno → jen ten zaměstnanec
--   branch_id vyplněno   → zaměstnanci té pobočky
--   oboje null           → všichni zaměstnanci firmy
-- Autor oznámení ze seznamu vypadne (nepotvrzuje sám sebe).
-- =====================================================================

create or replace function public.kdo_nepotvrdil(p_tenant uuid, p_announcement uuid)
returns table(jmeno text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_branch_id   uuid;
  v_author_id   uuid;
begin
  -- Pravidlo 7b — tenant_id, requires_acknowledgment: každá podmínka zvlášť.
  select a.employee_id, a.branch_id, a.author_id
    into v_employee_id, v_branch_id, v_author_id
    from public.announcements a
   where a.id        = p_announcement
     and a.tenant_id = p_tenant
     and a.requires_acknowledgment = true;

  if not found then return; end if;

  return query
    select coalesce(nullif(trim(p.full_name::text), ''), 'Neznámý') as jmeno
      from public.employees e
      left join public.profiles p on p.user_id = e.user_id
     where e.tenant_id  = p_tenant
       and e.deleted_at is null
       and e.user_id    is not null
       -- Autor ze seznamu vypadne — nepotvrzuje vlastní oznámení.
       and (v_author_id is null or e.user_id <> v_author_id)
       -- Cílení: osobní → jen ten zaměstnanec; pobočkové → ta pobočka; firma → všichni.
       and (
         (v_employee_id is not null and e.id         = v_employee_id)
         or (v_employee_id is null and v_branch_id is not null and e.branch_id = v_branch_id)
         or (v_employee_id is null and v_branch_id is null)
       )
       -- Kdo už potvrdil, do výsledku nepatří.
       and not exists (
         select 1 from public.announcement_reads ar
          where ar.announcement_id = p_announcement
            and ar.user_id         = e.user_id
       )
     order by jmeno;
end $$;

-- authenticated = přihlášení uživatelé; RLS na announcement_reads by to blokovalo
-- normálnímu dotazu, tady to řeší SECURITY DEFINER.
grant execute on function public.kdo_nepotvrdil(uuid, uuid) to authenticated;

comment on function public.kdo_nepotvrdil(uuid, uuid) is
  'Vrátí jména zaměstnanců, kteří ještě nepotvrdili oznámení '
  '(requires_acknowledgment = true). Filtruje tenant_id, deleted_at '
  'a requires_acknowledgment samo (pravidlo 7b). Vidí vedoucí '
  '(communication.manage) v nastenka.tsx.';
