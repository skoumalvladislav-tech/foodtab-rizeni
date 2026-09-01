-- =====================================================================
-- Foodtab — o přidělení se člověk dozví
--
-- Zadání: docs/ukoly-codea-drobnosti-2026-09-01.md, bod 7b.
--
-- Obrazovka pro účet bez firmy nově slibuje: „Až vás někdo do firmy
-- pozve, přijde vám e-mail s odkazem. Stačí počkat.“
--
-- Ten slib dnes nikdo neplní. Pozvánka e-mail pošle, ale PŘIDĚLENÍ
-- OPRÁVNĚNÍ neodešle nic — a přesně to je ta chvíle, kdy se člověku
-- aplikace otevře. Kdo čekal se slovy „stačí počkat“, čekal by dál.
--
-- Zadání je na pořadí výslovné: „Než tu větu napíšeš, musí platit.“
--
-- ---------------------------------------------------------------------
-- CO SE POSÍLÁ
--
--   vznik členství          — přijal jsem pozvánku, jsem ve firmě
--   přidělení role          — od teď něco vidím
--   změna rozsahu           — vidím jinam než dosud
--
-- Upozornění v aplikaci píše SPOUŠŤ, ne aplikace. Členství vzniká i
-- uvnitř `app.prijmout_pozvanku`, kam aplikace nevidí — kdyby to
-- posílala obrazovka, půlka případů by se ztratila.
--
-- E-mail spoušť poslat neumí a nemá. Ten posílá server, když ví komu;
-- adresu vydává průzor níž.
-- =====================================================================


-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ V APLIKACI
--
-- Bez role se neposílá nic: „jste ve firmě, ale nic nevidíte“ není
-- zpráva, na kterou se čeká. Ta chvíle přijde, až někdo roli přidělí,
-- a tehdy zpráva odejde.
-- ---------------------------------------------------------------------

create or replace function app.upozorni_na_clenstvi()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role  text;
  v_firma text;
begin
  -- Bez role není co oznamovat.
  if new.role_id is null or new.status <> 'active' then
    return new;
  end if;

  -- Při úpravě jen tehdy, když se něco opravdu změnilo.
  if tg_op = 'UPDATE'
     and old.role_id is not distinct from new.role_id
     and old.scope is not distinct from new.scope
     and old.status = new.status then
    return new;
  end if;

  select r.label into v_role from public.roles r where r.id = new.role_id;
  select t.name into v_firma from public.tenants t where t.id = new.tenant_id;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  values (
    new.tenant_id, new.user_id, null, 'opravneni.prideleno',
    jsonb_build_object(
      'firma', v_firma,
      'role', v_role,
      'rozsah', new.scope
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_upozorneni_clenstvi on public.memberships;
create trigger trg_upozorneni_clenstvi
  after insert or update on public.memberships
  for each row execute function app.upozorni_na_clenstvi();


-- ---------------------------------------------------------------------
-- KOMU POSLAT E-MAIL
--
-- `profiles.email` má aplikace odebrané ze čtení (výjimka u kontaktů),
-- takže adresu nedostane ani vedoucí. Tenhle průzor ji vydá — ale jen
-- tomu, kdo ve firmě spravuje lidi, a jen k tomu jednomu člověku,
-- kterému zrovna něco přidělil.
--
-- Adresa jde na SERVER, který pošle e-mail. Do prohlížeče se nikdy
-- nevrací: obrazovka se ptát nemusí, stačí jí, že odešlo.
-- ---------------------------------------------------------------------

create or replace function public.adresa_pro_upozorneni(p_tenant uuid, p_user uuid)
returns table (adresa text, jmeno text, firma text)
language sql stable security definer set search_path = ''
as $$
  select p.email, coalesce(nullif(btrim(p.full_name), ''), p.email), t.name
  from public.profiles p
  cross join public.tenants t
  where p.user_id = p_user
    and t.id = p_tenant
    and p.email is not null
    and app.has_access(p_tenant, 'people.manage')
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = p_tenant and m.user_id = p_user
    );
$$;

comment on function public.adresa_pro_upozorneni(uuid, uuid) is
  'Adresa člena firmy pro odeslání upozornění. Jen pro toho, kdo ve '
  'firmě spravuje lidi — a jen k tomu, kdo v ní opravdu je.';

revoke all on function public.adresa_pro_upozorneni(uuid, uuid) from public, anon;
grant execute on function public.adresa_pro_upozorneni(uuid, uuid) to authenticated;
