create or replace function public.foodtab_shift_manager_branch(check_user_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select branch_id from public.user_access
  where user_id = check_user_id
    and status = 'approved'
    and role in ('administrator', 'branch_manager')
    and 'shifts' = any(permissions)
  limit 1;
$$;

revoke all on function public.foodtab_shift_manager_branch(uuid) from public, anon;
grant execute on function public.foodtab_shift_manager_branch(uuid) to authenticated;

create policy "Shift managers can read their branch colleagues"
on public.user_access
for select
to authenticated
using (
  status = 'approved'
  and branch_id = public.foodtab_shift_manager_branch((select auth.uid()))
);
