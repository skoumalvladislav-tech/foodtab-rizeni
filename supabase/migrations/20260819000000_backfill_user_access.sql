insert into public.user_access (
  user_id,
  email,
  full_name,
  auth_provider,
  status
)
select
  existing_user.id,
  lower(trim(existing_user.email)),
  coalesce(
    nullif(trim(existing_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(existing_user.raw_user_meta_data ->> 'name'), ''),
    split_part(lower(trim(existing_user.email)), '@', 1)
  ),
  case
    when lower(coalesce(existing_user.raw_app_meta_data ->> 'provider', 'email'))
      in ('email', 'google', 'apple')
      then lower(coalesce(existing_user.raw_app_meta_data ->> 'provider', 'email'))
    else 'email'
  end,
  'pending'
from auth.users as existing_user
where existing_user.email is not null
  and trim(existing_user.email) <> ''
on conflict (user_id) do update
set email = excluded.email,
    full_name = case
      when nullif(trim(public.user_access.full_name), '') is null
        then excluded.full_name
      else public.user_access.full_name
    end,
    auth_provider = excluded.auth_provider;
