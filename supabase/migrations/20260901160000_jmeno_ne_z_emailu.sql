-- =====================================================================
-- Foodtab — jméno se nebere z e-mailu
--
-- Nález z kontroly 1. 9. 2026 (docs/opravy-po-kontrole-2026-09-01.md,
-- bod 3): v Lidech stál zaměstnanec „skoumalvladislav“. Obrazovka
-- ukazovala správně, co bylo v databázi — jméno vzniklo z e-mailu při
-- zakládání účtu.
--
-- Vzniklo tady:
--
--   app.handle_new_user()  split_part(email, '@', 1)
--   app.create_tenant()    coalesce(full_name, email::text, phone)
--
-- Až se aplikace bude prodávat, přesně takhle si každý druhý zákazník
-- založí sám sebe jako „jan.novak“. E-mail je e-mail, ne jméno.
--
-- CO SE MĚNÍ: prázdné jméno zůstane prázdné. Nedomýšlí se. Kde je
-- potřeba někoho pojmenovat a jméno chybí, ukáže se e-mail — ale jako
-- e-mail, na obrazovce, ne uložený ve sloupci `full_name`.
--
-- Ostrá data se tím NEMĚNÍ. Kdo už jméno z e-mailu má, nechá si ho,
-- dokud si ho neopraví v Lidé → Upravit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PROFIL PŘI REGISTRACI
--
-- Jméno se bere jen z metadat účtu (odtud ho dodá poskytovatel
-- přihlášení nebo průvodce). Když tam není, zůstane prázdné.
-- ---------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := nullif(btrim(lower(new.email)), '');
  v_phone text   := nullif(btrim(new.phone), '');
  v_name  text;
begin
  -- Žádný split_part(email, '@', 1). Prázdné jméno je pravda; „jan.novak“
  -- je výmysl, který se pak objeví na výplatní pásce.
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    ''
  );

  if v_email is null and v_phone is null then
    return new;
  end if;

  insert into public.profiles (user_id, email, phone, full_name)
  values (new.id, v_email, v_phone, v_name)
  on conflict (user_id) do update
    set email     = coalesce(excluded.email, public.profiles.email),
        phone     = coalesce(excluded.phone, public.profiles.phone),
        full_name = case
                      when btrim(public.profiles.full_name) = ''
                        then excluded.full_name
                      else public.profiles.full_name
                    end;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- ZALOŽENÍ FIRMY SI ŘEKNE O JMÉNO
--
-- Nový povinný parametr. Průvodce se musí zeptat na jméno a příjmení —
-- nemá odkud jinud vzít, čím zakladatele pojmenovat.
--
-- Stará osmiparametrová podoba se ZAHAZUJE, ne nechává vedle. `create
-- or replace` s novým parametrem by vyrobilo druhou funkci a ta stará
-- — ta s e-mailem — by šla dál volat. Přesně tak se „opravená“ chyba
-- vrací.
-- ---------------------------------------------------------------------

drop function if exists app.create_tenant(text, text, text, char, text);

create or replace function app.create_tenant(
  p_name      text,
  p_full_name text,
  p_ico       text default null,
  p_dic       text default null,
  p_currency  char(3) default 'CZK',
  p_timezone  text default 'Europe/Prague'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_tenant   uuid;
  v_owner    uuid;
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  t          record;
begin
  if v_user is null then
    raise exception 'Založit firmu může jen přihlášený uživatel.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Účet nemá profil. Dokončete prosím registraci.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Název firmy je povinný.' using errcode = 'check_violation';
  end if;

  -- Bez jména se firma nezaloží. Radši se zeptat než vyrobit
  -- zaměstnance, který se jmenuje jako začátek e-mailové adresy.
  if v_name is null then
    raise exception 'Zadejte prosím své jméno a příjmení.'
      using errcode = 'check_violation';
  end if;

  insert into public.tenants (name, legal_name, ico, dic, currency, timezone, created_by)
  values (btrim(p_name), btrim(p_name), nullif(btrim(p_ico), ''),
          nullif(btrim(p_dic), ''), p_currency, p_timezone, v_user)
  returning id into v_tenant;

  -- Základní modul. Ostatní si firma zapne sama.
  insert into public.tenant_modules (tenant_id, module_key, status)
  select v_tenant, m.key, 'active' from public.modules m where m.is_base;

  -- Role vznikají jako kopie šablon. Od téhle chvíle jsou to data firmy
  -- a majitel je může měnit, přejmenovat i smazat.
  for t in
    select rt.key, rt.label, rt.is_owner from app.role_templates rt order by rt.sort_order
  loop
    insert into public.roles (tenant_id, key, label, is_owner, system_template)
    values (v_tenant, t.key, t.label, t.is_owner, t.key);
  end loop;

  insert into public.role_permissions (role_id, permission_key)
  select r.id, rtp.permission_key
  from public.roles r
  join app.role_template_permissions rtp on rtp.template_key = r.system_template
  where r.tenant_id = v_tenant;

  select id into v_owner from public.roles
  where tenant_id = v_tenant and is_owner;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (v_tenant, v_user, v_owner, 'active', 'tenant');

  -- Zakladatel dostane jméno, které sám zadal, a doplní se i do profilu,
  -- pokud tam žádné nebylo.
  update public.profiles
     set full_name = v_name
   where user_id = v_user and btrim(coalesce(full_name, '')) = '';

  insert into public.employees (tenant_id, user_id, full_name, employment_type)
  values (v_tenant, v_user, v_name, 'ico');

  perform app.audit(v_tenant, 'tenant.create', 'tenant', v_tenant::text,
                    null, null, jsonb_build_object('name', btrim(p_name)));

  return v_tenant;
end;
$$;

grant execute on function app.create_tenant(text, text, text, text, char, text) to authenticated;
