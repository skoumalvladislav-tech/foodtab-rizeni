-- =====================================================================
-- Foodtab — dozvědět se, že někdo přijal pozvánku
--
-- Zadání: docs/upozorneni-na-prijeti-zadani.md.
--
-- Dnes pozvánku vystavíš a tím pro tebe věc končí. Kdo ji přijal BEZ
-- OPRÁVNĚNÍ, sedí v aplikaci, která mu nic neukazuje, a čeká, až si
-- toho někdo všimne. Obě strany čekají na druhou — to je celý problém.
--
--   Komu se to hlásí   každému s právem people.manage (ne podle názvu
--                      role, ale podle práva — pravidlo 2)
--   Okno               jen když někdo čeká na oprávnění
--   Kanály             zvoneček a e-mail hned; push AŽ POTOM a do
--                      rozhraní se o něm zatím nepíše
-- =====================================================================


-- ---------------------------------------------------------------------
-- KDO CHCE DOSTÁVAT E-MAILY
--
-- Zadání, oddíl 4: „Kdo chce dostávat co, ať je nastavení u člověka,
-- ne konstanta.“
--
-- ZVONEČEK SE VYPNOUT NEDÁ a schválně tu pro něj žádný přepínač není.
-- Je to ZÁZNAM, ne oznámení — kdyby šel vypnout, přestala by existovat
-- stopa po tom, co se ve firmě stalo.
--
-- Push do mobilu tu taky není. Nechodí, a dokud nechodí, nemá o něm být
-- ani přepínač: vypnuté tlačítko u něčeho, co stejně nefunguje, slibuje
-- víc než celá věta.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists upozorneni_emailem boolean not null default true;

comment on column public.profiles.upozorneni_emailem is
  'Chce dotyčný upozornění i e-mailem? Zvoneček se nevypíná — to je '
  'záznam, ne oznámení.';

grant select (upozorneni_emailem), update (upozorneni_emailem)
  on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- KDO MÁ V TÉHLE FIRMĚ DANÉ PRÁVO
--
-- Táž úvaha jako `app.has_access`, jen obráceně: ne „mám ho já“, ale
-- „kdo ho má“. Rozsah se schválně neřeší — spravovat lidi se nedá
-- půlkou firmy a upozornění je informace, ne přístup k datům.
-- ---------------------------------------------------------------------

create or replace function app.kdo_ma_pravo(p_tenant uuid, p_permission text)
returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id
  from public.memberships m
  join public.roles r           on r.id = m.role_id
  join public.permissions p     on p.key = p_permission
  join public.tenant_modules tm on tm.tenant_id = m.tenant_id
                               and tm.module_key = p.module_key
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now())
    and (
      r.is_owner
      or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = p_permission
      )
    );
$$;

comment on function app.kdo_ma_pravo(uuid, text) is
  'Kdo ve firmě má dané právo. Podle práva, ne podle názvu role.';

revoke all on function app.kdo_ma_pravo(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ PŘI PŘIJETÍ
--
-- Dva různé texty, protože jsou to dvě různé situace. Do těla jde
-- HOLÝ ÚDAJ, věta se skládá až na obrazovce — kdyby se ukládala hotová,
-- nešla by později opravit u starých zpráv.
--
--   ceka = true    „přijal pozvánku a čeká na oprávnění“  → úkol
--   ceka = false   „přijal pozvánku a má oprávnění …“     → informace
--
-- Kdo pozvánku poslal, dostane upozornění taky: poslat ji může někdo
-- jiný, než kdo pak přiděluje.
-- ---------------------------------------------------------------------

create or replace function app.upozorni_na_prijeti(p_tenant uuid, p_kdo uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_jmeno   text;
  v_role    text;
  v_scope   text;
  v_pobocky text[];
  v_member  public.memberships%rowtype;
begin
  select coalesce(nullif(btrim(p.full_name), ''), p.email, 'Nový člověk')
    into v_jmeno
  from public.profiles p where p.user_id = p_kdo;

  select * into v_member
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = p_kdo;

  select r.label into v_role
  from public.roles r where r.id = v_member.role_id;

  v_scope := v_member.scope;

  select array_agg(b.name order by b.name) into v_pobocky
  from public.membership_branches mb
  join public.branches b on b.id = mb.branch_id
  where mb.membership_id = v_member.id;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  select
    p_tenant,
    k.user_id,
    null,
    'pozvanka.prijata',
    jsonb_build_object(
      'jmeno',   v_jmeno,
      -- Kdo přijal. Tlačítko v okně z toho udělá odkaz rovnou na
      -- přidělení oprávnění, ne na seznam lidí.
      'kdo',     p_kdo,
      'ceka',    v_member.role_id is null,
      'role',    v_role,
      'rozsah',  v_scope,
      'pobocky', coalesce(v_pobocky, '{}'::text[])
    )
  from app.kdo_ma_pravo(p_tenant, 'people.manage') k;
end;
$$;

comment on function app.upozorni_na_prijeti(uuid, uuid) is
  'Zvoneček všem, kdo ve firmě spravují lidi. Dva různé texty: kdo čeká '
  'na oprávnění, je úkol; kdo je má, je informace.';

revoke all on function app.upozorni_na_prijeti(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- PŘIJETÍ SE KVŮLI UPOZORNĚNÍ NESMÍ POKAZIT
--
-- Členství musí vzniknout, i kdyby se pošta rozbila. Proto je založení
-- upozornění ve VLASTNÍM BLOKU s odchycenou výjimkou — člověk se do
-- firmy dostane, ať se stane cokoli.
--
-- Zbytek funkce je beze změny oproti 20260902020000.
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

  /*
    Upozornění až úplně nakonec a ve vlastním bloku. Kdyby spadlo,
    členství už je zapsané a přijetí projde — o tom, jestli se člověk
    dostane do firmy, nesmí rozhodovat zvoneček.
  */
  begin
    perform app.upozorni_na_prijeti(p_inv.tenant_id, v_user);
  exception when others then
    null;
  end;

  return p_inv.tenant_id;
end;
$$;

revoke all on function app.prijmout_pozvanku(public.invitations) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- KDO ČEKÁ NA OPRÁVNĚNÍ
--
-- Pro vyskakovací okno. Stav je v DATECH, ne v tom, jestli si to někdo
-- přečetl: jakmile člověk oprávnění dostane, ze seznamu zmizí sám
-- a okno se přestane ukazovat. Nic se neodškrtává.
-- ---------------------------------------------------------------------

create or replace function public.cekaji_na_opravneni(p_tenant uuid)
returns table (user_id uuid, jmeno text, od timestamptz)
language sql stable security definer set search_path = ''
as $$
  select
    m.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Nový člověk'),
    m.created_at
  from public.memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.tenant_id = p_tenant
    and m.status = 'active'
    and m.role_id is null
    and app.has_access(p_tenant, 'people.manage')
  order by m.created_at;
$$;

comment on function public.cekaji_na_opravneni(uuid) is
  'Kdo je ve firmě, ale nemá roli. Pro okno při přihlášení — ukazuje se '
  'jen tehdy, když je co dělat.';

revoke all on function public.cekaji_na_opravneni(uuid) from public, anon;
grant execute on function public.cekaji_na_opravneni(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- KOMU POSLAT E-MAIL O PŘIJETÍ
--
-- Zvláštní případ: e-mail se posílá V SEZENÍ TOHO, KDO PRÁVĚ PŘIJAL —
-- ten ale `people.manage` nemá a mít nemá. Adresy proto vydává tenhle
-- průzor, a jen tomu, kdo do TÉHLE firmy právě vstoupil.
--
-- Okno je pět minut od přijetí. Není to elegantní a je to vidět: kdo
-- pozvánku právě přijal, se v tu chvíli dostane k adresám lidí, kteří
-- firmu spravují. Menší zlo než ta druhá možnost — nechat aplikaci
-- držet klíč, kterým se dá přečíst kterákoli adresa kdykoli.
--
-- Do prohlížeče se adresy nikdy nevracejí. Bere si je server, aby měl
-- kam poslat, a obrazovce stačí, že odešlo.
-- ---------------------------------------------------------------------

create or replace function public.komu_ohlasit_prijeti(p_tenant uuid)
returns table (adresa text, jmeno text, firma text, kdo_prijal text, ceka boolean)
language sql stable security definer set search_path = ''
as $$
  select
    p.email,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    t.name,
    coalesce(nullif(btrim(ja.full_name), ''), ja.email, 'Nový člověk'),
    (select m.role_id is null from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = (select auth.uid()))
  from app.kdo_ma_pravo(p_tenant, 'people.manage') k
  join public.profiles p on p.user_id = k.user_id
  cross join public.tenants t
  join public.profiles ja on ja.user_id = (select auth.uid())
  where t.id = p_tenant
    and p.email is not null
    -- Kdo si e-maily vypnul, dostane jen zvoneček.
    and p.upozorneni_emailem
    -- Jen ten, kdo do téhle firmy právě vstoupil.
    and exists (
      select 1 from public.invitations i
      where i.tenant_id = p_tenant
        and i.accepted_by = (select auth.uid())
        and i.accepted_at > now() - interval '5 minutes'
    );
$$;

comment on function public.komu_ohlasit_prijeti(uuid) is
  'Adresy lidí, kteří ve firmě spravují lidi — jen pro toho, kdo do ní '
  'právě vstoupil, a jen pět minut po přijetí pozvánky.';

revoke all on function public.komu_ohlasit_prijeti(uuid) from public, anon;
grant execute on function public.komu_ohlasit_prijeti(uuid) to authenticated;
