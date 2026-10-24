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
--   * zařízení má ÚČEL (kontrola 24. 10.): telefon spárovaný na
--     /kiosek/doklady je jen na doklady — funkce kiosku Docházky ho
--     nevezmou (zálohy, rozpis směn, kód k píchnutí) a tablet Docházky
--     zase nepošle doklad;
--   * kiosek Jiných plateb se telefonu výslovně ZAPÍNÁ (jine_platby_kiosky);
--   * jen aktivní spárované zařízení: odvolání v Nastavení → Zařízení
--     (stav 'revoked') nebo vypnutí kiosku vezme přístup hned — každé
--     volání znovu ověřuje klíč;
--   * jen založit záznam na SVÉ pobočce a připojit k němu fotky (do dvou
--     hodin od založení); ze čtení jen přehled dokladů odeslaných z TOHOTO
--     zařízení za dnešní provozní den (čas, počet fotek, poznámka, stav —
--     rozhodnutí Šéfíka 24. 10., otázka 69); žádná finanční data, žádné
--     cizí záznamy;
--   * zařízení na pobočce může být několik (rozhodnutí Šéfíka 24. 10.):
--     každé se páruje a zapíná zvlášť, strop i autor jsou na zařízení;
--   * strop odeslání na zařízení (za hodinu, za 24 hodin) a strop
--     vydaných adres pro nahrání na jeden doklad;
--   * funkce smí volat jen server (service_role): nahrání jde přes
--     podepsanou adresu, typ podle obsahu a otisk spočítá server. Server
--     NEJDŘÍV nechá databázi ověřit klíč a záznam, teprve pak cokoli
--     stáhne, a smaže jen soubor, o kterém databáze řekne, že je to
--     nepřipojený soubor téhož zařízení (kontrola 24. 10.).
--
-- Rozpoznání AI se samo nespouští (otázka 67) — kontrola, tržba, sklad
-- a faktura zůstávají ve Financích lidem s právy Jiných plateb.

-- ---------------------------------------------------------------------
-- 0. Účel zařízení: tablet Docházky, nebo telefon na doklady
-- ---------------------------------------------------------------------
-- Kontrola 24. 10.: klíč telefonu „na doklady" otevíral i funkce kiosku
-- Docházky — dnešní zálohy se jmény a částkami, rozpis směn a živý kód
-- k píchnutí, bez PINu a v kapse obsluhy. Stávající zařízení zůstávají
-- Docházkou (výchozí hodnota); telefon spárovaný na /kiosek/doklady
-- (`registrovat_zarizeni_doklady`) je jen na doklady.
alter table public.branch_devices
  add column ucel text not null default 'dochazka' check (ucel in ('dochazka', 'doklady'));

comment on column public.branch_devices.ucel is
  '''dochazka'' = tablet kiosku Docházky (/kiosek); ''doklady'' = telefon na fotky dokladů Jiných plateb '
  '(/kiosek/doklady). Funkce Docházky berou jen dochazka, funkce dokladů jen doklady. Jde jen zúžit.';

grant select (ucel) on public.branch_devices to authenticated;

-- Účel jde jen zúžit: telefon na doklady se Docházkou nestane ani
-- přímým zápisem (sloupcové granty v produkci nemusí držet — výchozí
-- práva Supabase).
create function app.zarizeni_ucel_jen_zuzit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.ucel = 'doklady' and new.ucel is distinct from 'doklady' then
    raise exception 'Telefon na doklady nejde přepnout na Docházku — tablet Docházky se páruje zvlášť na /kiosek.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.zarizeni_ucel_jen_zuzit() from public, anon, authenticated;

create trigger trg_zarizeni_ucel
  before update of ucel on public.branch_devices
  for each row execute function app.zarizeni_ucel_jen_zuzit();

-- Funkce kiosku Docházky (kiosk_stav, kiosk_zalohy, pichnout_pinem,
-- potvrdit_zalohu_pinem, kiosk_zpravy_*) hledají zařízení TADY — nově jen
-- zařízení Docházky. Telefon na doklady dostane stejnou odpověď jako
-- neznámý klíč.
create or replace function app.zarizeni_podle_klice(p_klic text)
returns public.branch_devices
language sql stable security definer set search_path = ''
as $$
  select d.*
  from public.branch_devices d
  where d.key_hash = encode(sha256(convert_to(coalesce(p_klic, ''), 'UTF8')), 'hex')
    and d.stav = 'active'
    and d.ucel = 'dochazka'
  limit 1;
$$;

revoke all on function app.zarizeni_podle_klice(text) from public, anon, authenticated;

-- „Má pobočka tablet?" (Docházka podle toho radí ruční zápis): telefon
-- na doklady se nepočítá — kód k píchnutí neukazuje.
create or replace function public.pobocka_ma_kiosek(p_tenant uuid, p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.branch_devices d
    where d.tenant_id = p_tenant
      and d.branch_id = p_branch
      and d.stav = 'active'
      and d.ucel = 'dochazka'
  ) and app.is_member(p_tenant);
$$;

revoke all on function public.pobocka_ma_kiosek(uuid, uuid) from public, anon;
grant execute on function public.pobocka_ma_kiosek(uuid, uuid) to authenticated;

-- Spárování telefonu na doklady (/kiosek/doklady): stejný jednorázový kód
-- jako u tabletu, zařízení ale dostane účel 'doklady' — Docházku neumí.
create function public.registrovat_zarizeni_doklady(p_kod text)
returns table (device_id uuid, klic text, pobocka text, nazev text)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  select * into r from public.registrovat_zarizeni(p_kod);
  update public.branch_devices set ucel = 'doklady' where id = r.device_id;
  return query select r.device_id, r.klic, r.pobocka, r.nazev;
end $$;

revoke all on function public.registrovat_zarizeni_doklady(text) from public;
grant execute on function public.registrovat_zarizeni_doklady(text) to anon, authenticated;

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
  'Telefony pobočky (účel doklady) se zapnutým kioskem Jiných plateb. '
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
  add column zarizeni_nazev text check (zarizeni_nazev is null or char_length(zarizeni_nazev) <= 100),
  add column kiosek_vydano smallint not null default 0 check (kiosek_vydano >= 0);

comment on column public.jine_platby.zdroj is
  '''kiosek'' = doklad vyfocený na telefonu pobočky (zarizeni_id, zarizeni_nazev); vytvoril je pak prázdné — '
  'záznam nepřipisuje doklad žádnému člověku.';
comment on column public.jine_platby.zarizeni_nazev is
  'Název zařízení v době odeslání (zařízení smí číst jen správce nastavení, Finance vidí tenhle opis).';
comment on column public.jine_platby.kiosek_vydano is
  'Kolik adres pro nahrání kiosek k záznamu dostal (i při opakovaném odeslání) — strop app.jp_kiosek_strop_adres().';

create index jine_platby_zarizeni on public.jine_platby (zarizeni_id, vytvoreno) where zarizeni_id is not null;

alter table public.jine_platby_soubory
  add column zarizeni_id uuid references public.branch_devices(id) on delete set null;

comment on column public.jine_platby_soubory.zarizeni_id is
  'Soubor nahrál kiosek (nahral je pak prázdné).';

-- ---------------------------------------------------------------------
-- 3. Stropy (otázka 66 a kontrola 24. 10.)
-- ---------------------------------------------------------------------
create function app.jp_kiosek_strop_hodina() returns integer language sql immutable set search_path = '' as $$ select 20 $$;
create function app.jp_kiosek_strop_den() returns integer language sql immutable set search_path = '' as $$ select 60 $$;
-- Adresy pro nahrání na jeden doklad: deset fotek a jedno celé opakování po výpadku sítě.
create function app.jp_kiosek_strop_adres() returns integer language sql immutable set search_path = '' as $$ select 20 $$;
revoke all on function app.jp_kiosek_strop_hodina() from public, anon, authenticated;
revoke all on function app.jp_kiosek_strop_den() from public, anon, authenticated;
revoke all on function app.jp_kiosek_strop_adres() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Zařízení podle klíče — telefon na doklady se zapnutým kioskem
-- ---------------------------------------------------------------------
-- Neznámý nebo odvolaný klíč (i klíč tabletu Docházky) dostane STEJNOU
-- hlášku jako kiosek Docházky (lib/kiosek-spojeni.ts ji pozná a nabídne
-- nové spárování); vypnutý kiosek, neaktivní pobočka nebo firma bez
-- Financí mají vlastní hlášku, klíč zůstává.
create function app.jp_kiosek_zarizeni(p_klic text)
returns public.branch_devices
language plpgsql stable security definer set search_path = ''
as $$
declare
  d public.branch_devices;
begin
  select * into d from public.branch_devices x
   where x.key_hash = encode(sha256(convert_to(coalesce(p_klic, ''), 'UTF8')), 'hex')
     and x.stav = 'active'
     and x.ucel = 'doklady';
  if not found then
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
-- 5b. Dnes odesláno z tohoto zařízení (rozhodnutí Šéfíka 24. 10., otázka 69)
-- ---------------------------------------------------------------------
-- Jen záznamy TOHOTO zařízení za DNEŠNÍ provozní den pobočky
-- (app.business_date — hranice dne podle pobočky, ne půlnoc). Od
-- nejnovějšího, nejvýš 50. Každý jen: čas odeslání, počet fotek,
-- poznámka (označení, které obsluha sama napsala) a stav jako kód —
-- žádné částky, položky, výsledky kontrol ani důvod zrušení (to píše
-- Finance a může obsahovat cokoli). Odvolané nebo vypnuté zařízení
-- dostane chybu jako u ostatních funkcí kiosku, tedy nic.
create function public.jine_platby_kiosek_dnes(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_den date;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  v_den := app.business_date(d.branch_id, now());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'cas', x.vytvoreno,
             'fotek', x.fotek,
             'oznaceni', x.oznaceni,
             'stav', case
                       when x.stav_kontroly = 'zruseno' then 'zruseno'
                       when x.stav_trzby in ('zapsano', 'propojeno') then 'zpracovano'
                       when x.stav_kontroly = 'zkontrolovano' then 'zkontrolovano'
                       when x.fotek = 0 then 'bez_fotky'
                       else 'prijato'
                     end)
           order by x.vytvoreno desc)
      from (select z.vytvoreno, z.oznaceni, z.stav_kontroly, z.stav_trzby,
                   (select count(*) from public.jine_platby_soubory f where f.zaznam_id = z.id)::integer as fotek
              from public.jine_platby z
             where z.zarizeni_id = d.id and z.tenant_id = d.tenant_id and z.branch_id = d.branch_id
               and z.vytvoreno > now() - interval '2 days'
               and app.business_date(d.branch_id, z.vytvoreno) = v_den
             order by z.vytvoreno desc
             limit 50) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.jine_platby_kiosek_dnes(text) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_dnes(text) to service_role;

-- ---------------------------------------------------------------------
-- 6. Založení záznamu z kiosku
-- ---------------------------------------------------------------------
-- Pokladnu pobočky vezme sama, jen když ji obsluhuje právě jedna
-- (u pokladny celé firmy i s provozovnou) — jinak je záznam bez pokladny
-- a kontrolu v pokladně udělají ve Financích ručně (otázka 68).
--
-- p_souboru = kolik fotek telefon pošle; server k záznamu vydá právě
-- tolik adres pro nahrání a databáze je počítá (kiosek_vydano).
create function public.jine_platby_kiosek_zalozit(p_klic text, p_oznaceni text, p_klient_id uuid, p_souboru integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d            public.branch_devices;
  v_z          public.jine_platby;
  v_pocet      integer;
  v_pripojeni  uuid;
  v_provozovna text;
  v_pokladen   integer;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  if p_klient_id is null then
    raise exception 'Chybí klíč odeslání.' using errcode = 'check_violation';
  end if;
  if p_souboru is null or p_souboru < 1 or p_souboru > 10 then
    raise exception 'Na jeden doklad jde poslat 1 až 10 fotek.' using errcode = 'check_violation';
  end if;

  -- Odeslání jednoho zařízení jdou za sebou (strop i opakování).
  perform pg_advisory_xact_lock(hashtextextended('jine_platby_kiosek:' || d.id::text, 0));

  -- Opakované odeslání (síť vypadla po založení): stejný klíč = stejný
  -- záznam téhož zařízení — ale jen rozpracovaný, nejvýš dvě hodiny starý
  -- a pod stropem vydaných adres. Jinak je odeslání uzavřené a telefon
  -- začne nový doklad (kontrola 24. 10.: opakovaný klíč obcházel strop
  -- a vydával adresy pro nahrání bez konce).
  select * into v_z from public.jine_platby
   where tenant_id = d.tenant_id and klient_id = p_klient_id and zarizeni_id = d.id;
  if found then
    if v_z.stav_kontroly <> 'rozpracovano' or v_z.vytvoreno < now() - interval '2 hours'
       or v_z.kiosek_vydano + p_souboru > app.jp_kiosek_strop_adres() then
      raise exception 'Tohle odeslání už je uzavřené — fotky pošlete jako nový doklad.' using errcode = 'check_violation';
    end if;
    update public.jine_platby set kiosek_vydano = kiosek_vydano + p_souboru where id = v_z.id;
    return jsonb_build_object('zaznam', v_z.id, 'tenant', d.tenant_id, 'branch', d.branch_id);
  end if;
  if exists (select 1 from public.jine_platby where tenant_id = d.tenant_id and klient_id = p_klient_id) then
    raise exception 'Klíč odeslání už patří jinému záznamu.' using errcode = 'check_violation';
  end if;

  -- Strop na zařízení.
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
                                  zdroj, zarizeni_id, zarizeni_nazev, kiosek_vydano)
  values (d.tenant_id, d.branch_id, v_pripojeni, v_provozovna, p_klient_id, left(btrim(coalesce(p_oznaceni, '')), 200), null,
          'kiosek', d.id, left(d.nazev, 100), p_souboru)
  returning * into v_z;

  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, null, 'zalozeno',
          jsonb_build_object('pokladna', v_pripojeni is not null, 'zdroj', 'kiosek', 'zarizeni', d.id, 'zarizeni_nazev', d.nazev));
  update public.branch_devices set posledni_kdy = now() where id = d.id;
  return jsonb_build_object('zaznam', v_z.id, 'tenant', d.tenant_id, 'branch', d.branch_id);
end $$;

revoke all on function public.jine_platby_kiosek_zalozit(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_zalozit(text, text, uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- 6b. Než server cokoli stáhne: je záznam tohohle zařízení a otevřený?
-- ---------------------------------------------------------------------
-- Kontrola 24. 10.: server dřív stáhl soubor z cesty od prohlížeče
-- a po chybě ho smazal klientem služby — dřív, než databáze ověřila klíč.
-- Teď nejdřív tahle funkce: klíč, zařízení, záznam téhož zařízení,
-- rozpracovaný a nejvýš dvě hodiny starý. Firmu a pobočku pro kontrolu
-- cesty vrací DATABÁZE.
create function public.jine_platby_kiosek_overit_zaznam(p_klic text, p_zaznam uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d   public.branch_devices;
  v_z public.jine_platby;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  select * into v_z from public.jine_platby where id = p_zaznam and tenant_id = d.tenant_id;
  if not found or v_z.zarizeni_id is distinct from d.id or v_z.branch_id <> d.branch_id then
    raise exception 'Záznam z tohohle zařízení není.' using errcode = 'insufficient_privilege';
  end if;
  if v_z.stav_kontroly <> 'rozpracovano' or v_z.vytvoreno < now() - interval '2 hours' then
    raise exception 'K tomuhle dokladu už fotky přidat nejde — vyfoťte ho jako nový.' using errcode = 'check_violation';
  end if;
  return jsonb_build_object('zaznam', v_z.id, 'tenant', v_z.tenant_id, 'branch', v_z.branch_id);
end $$;

revoke all on function public.jine_platby_kiosek_overit_zaznam(text, uuid) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_overit_zaznam(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6c. Smí server soubor uklidit?
-- ---------------------------------------------------------------------
-- Server (klient služby, mimo RLS úložiště) smaže soubor JEN když tahle
-- funkce řekne ano: platný klíč telefonu se zapnutým kioskem, záznam
-- založilo totéž zařízení, cesta patří k tomu záznamu, soubor nemá
-- vlastníka (nahrál ho kiosek přes podepsanou adresu) a NIC na něj
-- neukazuje (není připojený k žádnému dokladu). Originál ve Financích,
-- soubor přihlášeného ani cizí firmy tak smazat nejde; neplatný klíč
-- dostane chybu a soubor zůstane (neškodný sirotek).
create function public.jine_platby_kiosek_muze_uklidit(p_klic text, p_zaznam uuid, p_cesta text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  d   public.branch_devices;
  v_c record;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  if not exists (select 1 from public.jine_platby z
                  where z.id = p_zaznam and z.tenant_id = d.tenant_id and z.branch_id = d.branch_id
                    and z.zarizeni_id = d.id) then
    return false;
  end if;
  select * into v_c from app.jine_platby_cesta(p_cesta);
  if not found or v_c.tenant_id is distinct from d.tenant_id or v_c.branch_id is distinct from d.branch_id
     or v_c.zaznam_id is distinct from p_zaznam then
    return false;
  end if;
  return exists (select 1 from storage.objects o
                  where o.bucket_id = 'jine-platby' and o.name = p_cesta and o.owner is null)
     and not exists (select 1 from public.jine_platby_soubory s where s.cesta = p_cesta);
end $$;

revoke all on function public.jine_platby_kiosek_muze_uklidit(text, uuid, text) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_muze_uklidit(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. Připojení fotky z kiosku
-- ---------------------------------------------------------------------
-- Server soubor nahrál přes podepsanou adresu (vlastník v úložišti je
-- prázdný), stáhl ho, typ poznal z obsahu a otisk spočítal sám. Tady se
-- ověří, že záznam založilo TOTÉŽ zařízení před nejvýš dvěma hodinami
-- a pořád je rozpracovaný — kiosek nesmí přidávat fotky k cizím ani ke
-- zkontrolovaným záznamům.
--
-- Vrací {soubor, uz_pripojen}: když přesně tahle fotka u TOHOTO záznamu
-- už je (odpověď na minulé odeslání se ztratila), vrátí ji znovu místo
-- chyby — telefon pak skončí na „Odesláno" a nová kopie se uklidí.
create function public.jine_platby_kiosek_pripojit_soubor(p_klic text, p_zaznam uuid, p_cesta text, p_otisk text)
returns jsonb
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

  -- Tatáž fotka u téhož záznamu = opakované odeslání po ztracené odpovědi.
  select s.id into v_id from public.jine_platby_soubory s
   where s.zaznam_id = v_z.id and s.otisk = p_otisk and s.aktivni
   limit 1;
  if v_id is not null then
    return jsonb_build_object('soubor', v_id, 'uz_pripojen', true);
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
  return jsonb_build_object('soubor', v_id, 'uz_pripojen', false);
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
    if d.ucel <> 'doklady' then
      raise exception 'Kiosek Jiných plateb jde zapnout jen na telefonu spárovaném na /kiosek/doklady.' using errcode = 'check_violation';
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
