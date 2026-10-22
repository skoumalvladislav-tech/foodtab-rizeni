-- Jiné platby — kiosek na telefonu pobočky (zadání Šéfíka 22. 10. 2026)
--
-- „u jiných plateb potřebuji vytvořit kiosek do telefonu jako je na
-- docházku. účty je potřeba vyfotit přes telefon, a obsluha nemá přístup
-- k modulu finance." Upřesnění: „nepotřebujeme se přihlásit pinem".
--
-- Model je stejný jako u kiosku Docházky: telefon je ZAŘÍZENÍ POBOČKY
-- (branch_devices, spárované jednorázovým kódem z Nastavení → Zařízení),
-- ne účet člověka. Kdo je u telefonu, vyfotí doklad a odešle ho. Autorem
-- záznamu je zařízení — záznam neříká, že ho poslal konkrétní člověk.
--
-- Pojistky (všechno stojí na zařízení):
--   * kiosek Jiných plateb se zařízení výslovně ZAPÍNÁ (jine_platby_kiosky);
--     tablet Docházky ho sám nedostane;
--   * jen aktivní spárované zařízení: odvolání v Nastavení → Zařízení
--     (stav 'revoked') nebo vypnutí kiosku vezme přístup hned — každé
--     volání znovu ověřuje klíč;
--   * jen založit záznam na SVÉ pobočce a připojit k němu fotky (do dvou
--     hodin od založení); zařízení nic nečte — žádná finanční data,
--     žádné cizí záznamy;
--   * strop odeslání na zařízení (za hodinu, za 24 hodin);
--   * funkce smí volat jen server (service_role): nahrání jde přes
--     podepsanou adresu, typ podle obsahu a otisk spočítá server.
--
-- Rozpoznání AI se samo nespouští (otázka 67) — kontrola, tržba, sklad
-- a faktura zůstávají ve Financích lidem s právy Jiných plateb.

-- ---------------------------------------------------------------------
-- 1. Které zařízení smí fotit doklady
-- ---------------------------------------------------------------------
create table public.jine_platby_kiosky (
  zarizeni_id uuid primary key references public.branch_devices(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  zapnul      uuid,
  zapnuto     timestamptz not null default now()
);

comment on table public.jine_platby_kiosky is
  'Zařízení pobočky se zapnutým kioskem Jiných plateb (fotky dokladů z telefonu). '
  'Zapíná a vypíná jine_platby_kiosek_zapnout (správce nastavení pobočky); řádek nikdo nepíše přímo.';

create index jine_platby_kiosky_firma on public.jine_platby_kiosky (tenant_id, branch_id);

revoke all on public.jine_platby_kiosky from public, anon, authenticated;
grant select on public.jine_platby_kiosky to authenticated, service_role;

alter table public.jine_platby_kiosky enable row level security;

create policy jine_platby_kiosky_cteni on public.jine_platby_kiosky
  for select to authenticated
  using (app.can_read_scoped(tenant_id, 'settings.manage', branch_id));

-- ---------------------------------------------------------------------
-- 2. Záznam a soubor z kiosku: autorem je zařízení
-- ---------------------------------------------------------------------
alter table public.jine_platby
  add column zdroj text not null default 'aplikace' check (zdroj in ('aplikace', 'kiosek')),
  add column zarizeni_id uuid references public.branch_devices(id) on delete set null,
  add column zarizeni_nazev text check (zarizeni_nazev is null or char_length(zarizeni_nazev) <= 100);

comment on column public.jine_platby.zdroj is
  '''kiosek'' = doklad vyfocený na telefonu pobočky (zarizeni_id, zarizeni_nazev); vytvoril je pak prázdné — '
  'záznam nepřipisuje doklad žádnému člověku.';
comment on column public.jine_platby.zarizeni_nazev is
  'Název zařízení v době odeslání (zařízení smí číst jen správce nastavení, Finance vidí tenhle opis).';

create index jine_platby_zarizeni on public.jine_platby (zarizeni_id, vytvoreno) where zarizeni_id is not null;

alter table public.jine_platby_soubory
  add column zarizeni_id uuid references public.branch_devices(id) on delete set null;

comment on column public.jine_platby_soubory.zarizeni_id is
  'Soubor nahrál kiosek (nahral je pak prázdné).';

-- ---------------------------------------------------------------------
-- 3. Strop odeslání z jednoho zařízení (otázka 66)
-- ---------------------------------------------------------------------
create function app.jp_kiosek_strop_hodina() returns integer language sql immutable set search_path = '' as $$ select 20 $$;
create function app.jp_kiosek_strop_den() returns integer language sql immutable set search_path = '' as $$ select 60 $$;
revoke all on function app.jp_kiosek_strop_hodina() from public, anon, authenticated;
revoke all on function app.jp_kiosek_strop_den() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Zařízení podle klíče — jen se zapnutým kioskem Jiných plateb
-- ---------------------------------------------------------------------
-- Neznámý nebo odvolaný klíč dostane STEJNOU hlášku jako kiosek Docházky
-- (lib/kiosek-spojeni.ts ji pozná a nabídne nové spárování); vypnutý
-- kiosek, neaktivní pobočka nebo firma bez Financí mají vlastní hlášku,
-- klíč zůstává.
create function app.jp_kiosek_zarizeni(p_klic text)
returns public.branch_devices
language plpgsql stable security definer set search_path = ''
as $$
declare
  d public.branch_devices;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.jine_platby_kiosky k
                  where k.zarizeni_id = d.id and k.tenant_id = d.tenant_id and k.branch_id = d.branch_id) then
    raise exception 'Na tomhle zařízení není zapnutý kiosek Jiných plateb.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches b
                  where b.id = d.branch_id and b.tenant_id = d.tenant_id and b.active and b.deleted_at is null) then
    raise exception 'Pobočka zařízení není aktivní.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = d.tenant_id and tm.module_key = 'finance' and tm.status in ('active', 'trial')
                    and (tm.valid_until is null or tm.valid_until > now())) then
    raise exception 'Firma nemá zapnuté Finance — Jiné platby nejdou posílat.' using errcode = 'insufficient_privilege';
  end if;
  return d;
end $$;

revoke all on function app.jp_kiosek_zarizeni(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Co telefon smí vědět: jen pobočka a název zařízení
-- ---------------------------------------------------------------------
create function public.jine_platby_kiosek_stav(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d public.branch_devices;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  return jsonb_build_object(
    'pobocka', (select b.name from public.branches b where b.id = d.branch_id),
    'zarizeni', d.nazev);
end $$;

revoke all on function public.jine_platby_kiosek_stav(text) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_stav(text) to service_role;

-- ---------------------------------------------------------------------
-- 6. Založení záznamu z kiosku
-- ---------------------------------------------------------------------
-- Pokladnu pobočky vezme sama, jen když ji obsluhuje právě jedna
-- (u pokladny celé firmy i s provozovnou) — jinak je záznam bez pokladny
-- a kontrolu v pokladně udělají ve Financích ručně (otázka 68).
create function public.jine_platby_kiosek_zalozit(p_klic text, p_oznaceni text, p_klient_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d            public.branch_devices;
  v_z          public.jine_platby;
  v_id         uuid;
  v_pocet      integer;
  v_pripojeni  uuid;
  v_provozovna text;
  v_pokladen   integer;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  if p_klient_id is null then
    raise exception 'Chybí klíč odeslání.' using errcode = 'check_violation';
  end if;

  -- Opakované odeslání (síť vypadla po založení): stejný klíč = stejný
  -- záznam, ale jen z téhož zařízení.
  select id into v_id from public.jine_platby
   where tenant_id = d.tenant_id and klient_id = p_klient_id and zarizeni_id = d.id;
  if v_id is not null then
    return jsonb_build_object('zaznam', v_id, 'tenant', d.tenant_id, 'branch', d.branch_id);
  end if;
  if exists (select 1 from public.jine_platby where tenant_id = d.tenant_id and klient_id = p_klient_id) then
    raise exception 'Klíč odeslání už patří jinému záznamu.' using errcode = 'check_violation';
  end if;

  -- Strop na zařízení: odeslání jednoho zařízení jdou za sebou.
  perform pg_advisory_xact_lock(hashtextextended('jine_platby_kiosek:' || d.id::text, 0));
  select count(*) into v_pocet from public.jine_platby
   where zarizeni_id = d.id and vytvoreno > now() - interval '1 hour';
  if v_pocet >= app.jp_kiosek_strop_hodina() then
    raise exception 'Z tohohle zařízení odešlo za poslední hodinu % dokladů — víc zatím ne. Zkuste to za chvíli, nebo dejte vědět vedoucímu.',
      v_pocet using errcode = 'check_violation';
  end if;
  select count(*) into v_pocet from public.jine_platby
   where zarizeni_id = d.id and vytvoreno > now() - interval '24 hours';
  if v_pocet >= app.jp_kiosek_strop_den() then
    raise exception 'Z tohohle zařízení odešlo za posledních 24 hodin % dokladů — víc zatím ne. Dejte vědět vedoucímu.',
      v_pocet using errcode = 'check_violation';
  end if;

  select count(*) into v_pokladen from public.integrace_pripojeni p
   where p.tenant_id = d.tenant_id and p.oblast = 'pokladna' and p.odpojeno_kdy is null
     and (p.branch_id = d.branch_id
          or (p.branch_id is null and exists (select 1 from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) pv
                                               where pv ->> 'branch_id' = d.branch_id::text)));
  if v_pokladen = 1 then
    select p.id,
           case when p.branch_id is null then
             (select pv ->> 'id' from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) pv
               where pv ->> 'branch_id' = d.branch_id::text limit 1)
           end
      into v_pripojeni, v_provozovna
      from public.integrace_pripojeni p
     where p.tenant_id = d.tenant_id and p.oblast = 'pokladna' and p.odpojeno_kdy is null
       and (p.branch_id = d.branch_id
            or (p.branch_id is null and exists (select 1 from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) pv
                                                 where pv ->> 'branch_id' = d.branch_id::text)));
  end if;

  insert into public.jine_platby (tenant_id, branch_id, pripojeni_id, pos_provozovna, klient_id, oznaceni, vytvoril,
                                  zdroj, zarizeni_id, zarizeni_nazev)
  values (d.tenant_id, d.branch_id, v_pripojeni, v_provozovna, p_klient_id, left(btrim(coalesce(p_oznaceni, '')), 200), null,
          'kiosek', d.id, left(d.nazev, 100))
  returning * into v_z;

  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, null, 'zalozeno',
          jsonb_build_object('pokladna', v_pripojeni is not null, 'zdroj', 'kiosek', 'zarizeni', d.id, 'zarizeni_nazev', d.nazev));
  update public.branch_devices set posledni_kdy = now() where id = d.id;
  return jsonb_build_object('zaznam', v_z.id, 'tenant', d.tenant_id, 'branch', d.branch_id);
end $$;

revoke all on function public.jine_platby_kiosek_zalozit(text, text, uuid) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_zalozit(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 7. Připojení fotky z kiosku
-- ---------------------------------------------------------------------
-- Server soubor nahrál přes podepsanou adresu (vlastník v úložišti je
-- prázdný), stáhl ho, typ poznal z obsahu a otisk spočítal sám. Tady se
-- ověří, že záznam založilo TOTÉŽ zařízení před nejvýš dvěma hodinami
-- a pořád je rozpracovaný — kiosek nesmí přidávat fotky k cizím ani ke
-- zkontrolovaným záznamům.
create function public.jine_platby_kiosek_pripojit_soubor(p_klic text, p_zaznam uuid, p_cesta text, p_otisk text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  d          public.branch_devices;
  v_z        public.jine_platby;
  v_c        record;
  v_meta     jsonb;
  v_owner    uuid;
  v_mime     text;
  v_velikost bigint;
  v_poradi   integer;
  v_id       uuid;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  select * into v_z from public.jine_platby where id = p_zaznam and tenant_id = d.tenant_id for update;
  if not found or v_z.zarizeni_id is distinct from d.id or v_z.branch_id <> d.branch_id then
    raise exception 'Záznam z tohohle zařízení není.' using errcode = 'insufficient_privilege';
  end if;
  if v_z.stav_kontroly <> 'rozpracovano' or v_z.vytvoreno < now() - interval '2 hours' then
    raise exception 'K tomuhle dokladu už fotky přidat nejde — vyfoťte ho jako nový.' using errcode = 'check_violation';
  end if;

  select * into v_c from app.jine_platby_cesta(p_cesta);
  if not found or v_c.tenant_id is distinct from v_z.tenant_id or v_c.branch_id is distinct from v_z.branch_id
     or v_c.zaznam_id is distinct from v_z.id then
    raise exception 'Cesta k souboru nesedí s tímhle záznamem.' using errcode = 'check_violation';
  end if;
  if p_otisk is null or p_otisk !~ '^[0-9a-f]{64}$' then
    raise exception 'Chybí otisk souboru.' using errcode = 'check_violation';
  end if;

  select o.metadata, o.owner into v_meta, v_owner
    from storage.objects o where o.bucket_id = 'jine-platby' and o.name = p_cesta;
  if not found then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;
  -- Podepsanou adresu vydává server bez uživatele: soubor nemá vlastníka.
  -- Soubor nahraný přihlášeným (vlastník vyplněný) kiosek nepřipojí.
  if v_owner is not null then
    raise exception 'Soubor nahrál někdo jiný.' using errcode = 'check_violation';
  end if;

  v_mime := v_meta ->> 'mimetype';
  v_velikost := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime is null or v_velikost is null then
    raise exception 'Úložiště nevrátilo typ nebo velikost souboru.' using errcode = 'check_violation';
  end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     or (v_mime = 'image/jpeg' and p_cesta !~ '\.jpg$')
     or (v_mime = 'image/png' and p_cesta !~ '\.png$')
     or (v_mime = 'image/webp' and p_cesta !~ '\.webp$')
     or (v_mime = 'application/pdf' and p_cesta !~ '\.pdf$') then
    raise exception 'Nepovolený typ souboru.' using errcode = 'check_violation';
  end if;
  if v_velikost <= 0 or v_velikost > 10485760 then
    raise exception 'Soubor je prázdný nebo větší než 10 MB.' using errcode = 'check_violation';
  end if;

  -- Stejná fotka podruhé neprojde — a kiosku se neprozradí, ke kterému
  -- záznamu patří.
  if exists (select 1 from public.jine_platby_soubory s
              where s.tenant_id = v_z.tenant_id and s.otisk = p_otisk and s.aktivni) then
    raise exception 'Tahle fotka už v Jiných platbách je.' using errcode = 'unique_violation';
  end if;

  select coalesce(max(poradi), 0) + 1 into v_poradi from public.jine_platby_soubory where zaznam_id = v_z.id;
  if v_poradi > 10 then
    raise exception 'K jednomu dokladu jde poslat nejvýš 10 fotek.' using errcode = 'check_violation';
  end if;

  insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk, nahral, zarizeni_id)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_poradi, p_cesta, v_mime, v_velikost::integer, p_otisk, null, d.id)
  returning id into v_id;

  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, null, 'soubor_pripojen',
          jsonb_build_object('poradi', v_poradi, 'mime', v_mime, 'velikost', v_velikost, 'zdroj', 'kiosek',
                             'zarizeni', d.id, 'zarizeni_nazev', d.nazev));
  return v_id;
end $$;

revoke all on function public.jine_platby_kiosek_pripojit_soubor(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_pripojit_soubor(text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 8. Zapnout / vypnout kiosek na zařízení (Nastavení → Zařízení)
-- ---------------------------------------------------------------------
create function public.jine_platby_kiosek_zapnout(p_tenant uuid, p_zarizeni uuid, p_zapnout boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  d public.branch_devices;
begin
  select * into d from public.branch_devices where id = p_zarizeni and tenant_id = p_tenant;
  if not found then
    raise exception 'Zařízení nenalezeno.' using errcode = 'P0002';
  end if;
  if not app.has_access(p_tenant, 'settings.manage', d.branch_id) then
    raise exception 'Kiosek Jiných plateb smí zapnout jen správce nastavení pobočky.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(p_zapnout, false) then
    if d.stav <> 'active' then
      raise exception 'Odvolané zařízení nejde zapnout.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.tenant_modules tm
                    where tm.tenant_id = p_tenant and tm.module_key = 'finance' and tm.status in ('active', 'trial')
                      and (tm.valid_until is null or tm.valid_until > now())) then
      raise exception 'Firma nemá zapnuté Finance — kiosek Jiných plateb nejde zapnout.' using errcode = 'check_violation';
    end if;
    insert into public.jine_platby_kiosky (zarizeni_id, tenant_id, branch_id, zapnul)
    values (d.id, d.tenant_id, d.branch_id, auth.uid())
    on conflict (zarizeni_id) do nothing;
    perform app.audit(p_tenant, 'jine_platby.kiosek_zapnut', 'branch_devices', d.id::text, d.branch_id, null,
                      jsonb_build_object('nazev', d.nazev));
  else
    delete from public.jine_platby_kiosky where zarizeni_id = d.id and tenant_id = p_tenant;
    perform app.audit(p_tenant, 'jine_platby.kiosek_vypnut', 'branch_devices', d.id::text, d.branch_id,
                      jsonb_build_object('nazev', d.nazev), null);
  end if;
end $$;

revoke all on function public.jine_platby_kiosek_zapnout(uuid, uuid, boolean) from public, anon;
grant execute on function public.jine_platby_kiosek_zapnout(uuid, uuid, boolean) to authenticated;
