create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  auth_provider text not null default 'email'
    check (auth_provider in ('email', 'google', 'apple')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  branch_id text,
  role text
    check (role in ('administrator', 'branch_manager', 'kitchen', 'service', 'bar')),
  permissions text[] not null default '{}'::text[],
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.user_access enable row level security;

grant select, update on table public.user_access to authenticated;
grant all on table public.user_access to service_role;

create or replace function public.is_foodtab_administrator(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_access as access_profile
    where access_profile.user_id = check_user_id
      and access_profile.status = 'approved'
      and access_profile.role = 'administrator'
  );
$$;

revoke all on function public.is_foodtab_administrator(uuid) from public, anon;
grant execute on function public.is_foodtab_administrator(uuid) to authenticated;

create policy "Users can read their own access profile"
on public.user_access
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Approved administrators can read all access profiles"
on public.user_access
for select
to authenticated
using (public.is_foodtab_administrator((select auth.uid())));

create policy "Approved administrators can update access profiles"
on public.user_access
for update
to authenticated
using (public.is_foodtab_administrator((select auth.uid())))
with check (public.is_foodtab_administrator((select auth.uid())));

create or replace function public.create_foodtab_access_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  resolved_name text;
  resolved_provider text;
begin
  normalized_email := lower(trim(new.email));
  resolved_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(normalized_email, '@', 1)
  );
  resolved_provider := lower(coalesce(new.raw_app_meta_data ->> 'provider', 'email'));
  if resolved_provider not in ('email', 'google', 'apple') then
    resolved_provider := 'email';
  end if;

  if normalized_email is not null and normalized_email <> '' then
    insert into public.user_access (
      user_id,
      email,
      full_name,
      auth_provider,
      status
    )
    values (
      new.id,
      normalized_email,
      resolved_name,
      resolved_provider,
      'pending'
    )
    on conflict (user_id) do update
    set email = excluded.email,
        full_name = case
          when nullif(trim(public.user_access.full_name), '') is null
            then excluded.full_name
          else public.user_access.full_name
        end,
        auth_provider = excluded.auth_provider;
  end if;

  return new;
end;
$$;

revoke all on function public.create_foodtab_access_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_foodtab_access on auth.users;
create trigger on_auth_user_created_foodtab_access
  after insert on auth.users
  for each row execute function public.create_foodtab_access_profile();
