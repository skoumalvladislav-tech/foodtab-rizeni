-- =====================================================================
-- Foodtab — čekající pozvánku nabídnout, ne zamlčet
--
-- Zadání: docs/ukoly-codea-drobnosti-2026-09-01.md, bod 7a.
--
-- Šéfík se přihlásil adresou, na kterou mu hodinu předtím přišla
-- pozvánka, a aplikace mu poradila, ať si o pozvánku požádá. Tohle
-- zažije každý nový zaměstnanec.
--
-- Člověk se přihlásil TOU SPRÁVNOU ADRESOU — a právě to pozvánka
-- ověřuje. Další token už nepotřebuje.
--
-- ---------------------------------------------------------------------
-- PROČ SE TĚLO PŘIJETÍ STĚHUJE DO VLASTNÍ FUNKCE
--
-- Přijmout pozvánku jde nově dvěma cestami: odkazem s tokenem
-- a tlačítkem po přihlášení. Kdyby každá měla vlastní kopii, rozejdou
-- se — a je to kód, kterým se vstupuje do firmy.
--
-- Rozdíl mezi cestami je JEN v tom, jak se pozvánka najde. Všechno
-- ostatní, včetně kontroly, že sedí adresa, je společné a rozhoduje se
-- na jednom místě.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SPOLEČNÉ TĚLO
--
-- Dostane už nalezenou pozvánku. Kontrola totožnosti je UVNITŘ, ne
-- u hledání — obě cesty tím musí projít.
-- ---------------------------------------------------------------------

create or replace function app.prijmout_pozvanku(p_inv public.invitations)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_prof   public.profiles%rowtype;
  v_member uuid;
  v_bid    uuid;
begin
  if v_user is null then
    raise exception 'Nejdřív se přihlaste.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_prof from public.profiles where user_id = v_user;
  if not found then
    raise exception 'Účet nemá profil.' using errcode = 'insufficient_privilege';
  end if;

  if p_inv.id is null then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.revoked_at is not null then
    raise exception 'Pozvánka byla zrušena.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.accepted_at is not null then
    raise exception 'Pozvánka už byla použita.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.expires_at <= now() then
    raise exception 'Pozvánce vypršela platnost. Požádejte o novou.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Pozvánku nelze použít pod jiným kontaktem, než na jaký byla
  -- vystavena. Tohle je jediné, čím se ověří, že odkaz použil ten, komu
  -- byl poslaný — přeposlaný e-mail by jinak pustil do firmy kohokoli.
  if p_inv.channel = 'email' and v_prof.email is distinct from p_inv.email then
    raise exception 'Pozvánka byla vystavena na jinou e-mailovou adresu.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_inv.channel = 'sms' and v_prof.phone is distinct from p_inv.phone then
    raise exception 'Pozvánka byla vystavena na jiné telefonní číslo.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (p_inv.tenant_id, v_user, p_inv.role_id, 'active', p_inv.scope)
  on conflict (tenant_id, user_id) do update
    set role_id = coalesce(excluded.role_id, public.memberships.role_id),
        status  = 'active',
        scope   = excluded.scope
  returning id into v_member;

  delete from public.membership_branches where membership_id = v_member;
  foreach v_bid in array coalesce(p_inv.branch_ids, '{}') loop
    insert into public.membership_branches (membership_id, branch_id)
    values (v_member, v_bid) on conflict do nothing;
  end loop;

  -- Zaměstnanecký záznam už mohl existovat bez účtu (brigádník, kterého
  -- se nakonec rozhodli pustit do aplikace). Teď se propojí.
  if p_inv.employee_id is not null then
    update public.employees
      set user_id = v_user
      where id = p_inv.employee_id and tenant_id = p_inv.tenant_id and user_id is null;
  end if;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
    where id = p_inv.id;

  perform app.audit(p_inv.tenant_id, 'invitation.accept', 'membership', v_member::text);

  return p_inv.tenant_id;
end;
$$;

revoke all on function app.prijmout_pozvanku(public.invitations) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- PŘIJETÍ ODKAZEM — tělo se zmenšilo na hledání
-- ---------------------------------------------------------------------

create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_inv public.invitations%rowtype;
begin
  select * into v_inv from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if not found then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;

  return app.prijmout_pozvanku(v_inv);
end;
$$;

grant execute on function app.accept_invitation(text) to authenticated;


-- ---------------------------------------------------------------------
-- CO NA MĚ ČEKÁ
--
-- Hledá se podle ADRESY PŘIHLÁŠENÉHO ÚČTU, ne podle tokenu z odkazu.
-- Jen nepřijaté, nezrušené a neprošlé.
--
-- Ven jde název firmy a nic víc. Kdo se přihlásí a žádnou pozvánku
-- nemá, se nedozví ani to, že nějaká existuje — hledá se na přesnou
-- shodu vlastní adresy, takže cizí pozvánky nevidí.
-- ---------------------------------------------------------------------

create or replace function public.moje_cekajici_pozvanky()
returns table (
  invitation_id uuid,
  tenant_id     uuid,
  firma         text,
  kanal         text,
  expires_at    timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.tenant_id, t.name, i.channel, i.expires_at
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id
  join public.profiles p on p.user_id = (select auth.uid())
  where i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and t.deleted_at is null
    and (
      (i.channel = 'email' and p.email is not null and i.email = p.email)
      or (i.channel = 'sms' and p.phone is not null and i.phone = p.phone)
    )
  order by i.created_at desc;
$$;

comment on function public.moje_cekajici_pozvanky() is
  'Platné pozvánky na adresu přihlášeného účtu. Kdo se přihlásil tou '
  'správnou adresou, už další token nepotřebuje.';

revoke all on function public.moje_cekajici_pozvanky() from public, anon;
grant execute on function public.moje_cekajici_pozvanky() to authenticated;


-- ---------------------------------------------------------------------
-- CO JE TO ZA POZVÁNKU
--
-- Zadání bod 6: kdo otevře odkaz přihlášený pod jinou adresou, má
-- dostat tlačítko „Přihlásit se jako l…a@seznam.cz“ — tedy adresu,
-- na kterou pozvánka přišla.
--
-- Vydat ji držiteli tokenu je v pořádku: token JE to tajemství a přišel
-- v e-mailu na tu samou adresu. Kdo token nemá, se nedozví nic.
--
-- Otisk tokenu ani role se nevrací. Jen tolik, kolik obrazovka
-- potřebuje k té jedné větě.
--
-- `stav` je tu proto, aby obrazovka rozlišila „vypršela“ od „už byla
-- použita“ — obojí dnes vypadá stejně a člověk neví, jestli má žádat
-- o novou, nebo se jen přihlásit.
-- ---------------------------------------------------------------------

create or replace function public.pozvanka_info(p_token text)
returns table (firma text, kanal text, kontakt text, stav text)
language sql stable security definer set search_path = ''
as $$
  select
    t.name,
    i.channel,
    coalesce(i.email, i.phone),
    case
      when i.revoked_at is not null then 'zrusena'
      when i.accepted_at is not null then 'pouzita'
      when i.expires_at <= now() then 'propadla'
      else 'ok'
    end
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

comment on function public.pozvanka_info(text) is
  'Firma a adresa, na kterou pozvánka přišla. Vydává se držiteli tokenu '
  '— ten je to tajemství a přišel na tutéž adresu.';

revoke all on function public.pozvanka_info(text) from public;
grant execute on function public.pozvanka_info(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- PŘIJETÍ ZEVNITŘ APLIKACE
--
-- Bere id pozvánky, ne token. Id se dá uhodnout hůř než nic, ale
-- neslouží k ověření — to dělá shoda adresy uvnitř app.prijmout_pozvanku.
-- Kdo pošle cizí id, dostane „vystavena na jinou adresu“.
-- ---------------------------------------------------------------------

create or replace function public.prijmout_moji_pozvanku(p_pozvanka uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_inv public.invitations%rowtype;
begin
  select * into v_inv from public.invitations where id = p_pozvanka;

  if not found then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;

  return app.prijmout_pozvanku(v_inv);
end;
$$;

revoke all on function public.prijmout_moji_pozvanku(uuid) from public, anon;
grant execute on function public.prijmout_moji_pozvanku(uuid) to authenticated;
