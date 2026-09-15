-- =====================================================================
-- Foodtab — modul Marketing: měření a odkazy
--
-- Zadání: master prompt, oddíl 18 („Analytika a měření přínosu")
-- a obrazovka 13 z oddílu 22.
--
-- ---------------------------------------------------------------------
-- CO SE MĚŘÍ A CO SE JEN TVÁŘÍ, ŽE SE MĚŘÍ
--
-- Zadání to říká velmi přesně: „Zobraz pouze metriky, které daná síť
-- a oprávnění skutečně poskytují." A dál: „Pokud není možné prokázat
-- přímou atribuci, označ výsledek jako odhad a nepředstírej přesnost."
--
-- Proto je v `marketing_metriky` sloupec `zdroj` a proto se nikde
-- neukládá nula tam, kde se nic nezměřilo. NULL znamená „síť to
-- nedala", ne „bylo to nula". Je to totéž rozhodnutí jako u ceny
-- v menu (`20260914060000_marketing_menu.sql`) — a ze stejného
-- důvodu: nula vypadá jako propadák, kdežto prázdno se dá vysvětlit.
--
-- ---------------------------------------------------------------------
-- UTM A QR JSOU JEDINÉ, CO UMÍME ZMĚŘIT SAMI
--
-- Zobrazení a dosah dává síť. Kliknutí na odkaz umíme spočítat i bez
-- ní — když odkaz vede přes nás. Proto `marketing_odkazy`: krátký
-- klíč, cíl, UTM parametry a počet kliknutí.
--
-- Je to zároveň příprava na to, co zadání chce dál: „propojit výkon
-- příspěvku s budoucí objednávkou či rezervací ve FoodTabu". Až budou
-- rezervace, navěsí se na `marketing_odkazy`, ne na příspěvek — jeden
-- příspěvek má víc odkazů.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Žádné stahování metrik odsud. Databáze neumí volat ven a nemá to
--   umět; čísla přinese úloha v aplikaci, stejně jako u fronty.
-- * Žádný souhrnný sloupec „výkon" na příspěvku. Spočítá se z metrik.
--   Dvě místa s týmž číslem se rozejdou.
-- * Žádné IP ani user-agent u proklik. Měří se POČET, ne lidé —
--   a osobní údaj, který k ničemu není, se nesbírá.
-- =====================================================================


-- ---------------------------------------------------------------------
-- METRIKY PUBLIKACE
--
-- Jeden řádek na (publikace, den, ukazatel). Ne jeden široký řádek se
-- sloupci `zobrazeni`, `dosah`, `reakce`: sítě dávají pokaždé jinou
-- sadu a chybějící sloupec by se musel vyplnit nulou.
-- ---------------------------------------------------------------------

create table public.marketing_metriky (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  publikace_id   uuid not null references public.marketing_publikace(id) on delete cascade,

  -- Za který den to platí. Provozní den pobočky, ne kalendářní.
  den            date not null,

  ukazatel       text not null check (ukazatel in
                   ('zobrazeni', 'dosah', 'prehrani', 'doba_sledovani_s',
                    'reakce', 'komentare', 'sdileni', 'ulozeni',
                    'kliknuti', 'noví_sledujici')),

  /*
    HODNOTA MŮŽE BÝT PRÁZDNÁ, A JE V TOM ROZDÍL.

    NULL = síť ten ukazatel nedala (nemáme oprávnění, nepodporuje ho,
    ještě ho nespočítala). Nula = dala ho a je nula.

    Kdyby se prázdno ukládalo jako nula, vypadal by příspěvek, u kterého
    se nepodařilo nic stáhnout, jako propadák.
  */
  hodnota        bigint check (hodnota is null or hodnota >= 0),

  /*
    ODKUD TO ČÍSLO JE. Zadání, oddíl 18: co se nedá prokázat, se má
    označit jako odhad a nepředstírat přesnost.

      sit     — přišlo od poskytovatele,
      vlastni — spočítali jsme si sami (proklik přes náš odkaz),
      odhad   — dopočítané, NEPŘESNÉ.
  */
  zdroj          text not null check (zdroj in ('sit', 'vlastni', 'odhad')),

  zmereno_kdy    timestamptz not null default now()
);

/*
  JEDEN ŘÁDEK NA UKAZATEL A DEN. Stahování metrik běží opakovaně
  a bez tohohle by se čísla načítala pokaždé znovu vedle sebe.
*/
create unique index marketing_metriky_jeden
  on public.marketing_metriky (publikace_id, den, ukazatel);

create index marketing_metriky_firma
  on public.marketing_metriky (tenant_id, den desc);

alter table public.marketing_metriky enable row level security;

create policy marketing_metriky_select on public.marketing_metriky for select to authenticated
  using (exists (
    select 1 from public.marketing_publikace p
     where p.id = marketing_metriky.publikace_id
       and p.tenant_id = marketing_metriky.tenant_id
       and app.can_read_scoped(p.tenant_id, 'marketing.read', p.branch_id)));

/*
  ZAPISUJE JEN SERVISNÍ KLÍČ.

  Čísla přinese úloha, která mluví se sítí. Kdyby je směl psát
  `authenticated`, dal by se výkon příspěvku dopsat ručně — a měření,
  do kterého může kdokoli psát, není doklad o ničem.
*/
grant select on public.marketing_metriky to authenticated;

drop trigger if exists trg_audit_marketing_metriky on public.marketing_metriky;
create trigger trg_audit_marketing_metriky
  after insert or update or delete on public.marketing_metriky
  for each row execute function app.audit_zmenu('marketing_metrika');


-- ---------------------------------------------------------------------
-- MĚŘITELNÉ ODKAZY
--
-- Krátký klíč vede přes nás na cíl. UTM se přidají až při přesměrování,
-- takže se dají později opravit, aniž se mění, co je v příspěvku.
-- ---------------------------------------------------------------------

create table public.marketing_odkazy (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,

  -- Ke kterému příspěvku patří. `null` = obecný odkaz pobočky
  -- (na plakát, do profilu), který k žádnému příspěvku nepatří.
  prispevek_id  uuid references public.marketing_prispevky(id) on delete set null,
  kampan_id     uuid references public.marketing_kampane(id) on delete set null,

  /*
    KRÁTKÝ KLÍČ. Malými písmeny a číslicemi, bez pomlček — má se dát
    přečíst z QR na plakátu i opsat rukou. `citext` se nepoužívá
    (CLAUDE.md, „Rozšíření Postgresu"), takže se ukládá rovnou
    malými a hlídá to omezení.
  */
  klic          text not null check (klic ~ '^[a-z0-9]{6,16}$'),

  cil           text not null check (cil ~ '^https?://'),
  popis         text not null default '',

  -- UTM podle zvyklostí. Prázdné se do adresy nepřidává.
  utm_source    text not null default '',
  utm_medium    text not null default '',
  utm_campaign  text not null default '',

  /*
    POČET PROKLIK. Jen číslo — žádná IP, žádný user-agent.
    Osobní údaj, který k ničemu není, se nesbírá.
  */
  prokliku      bigint not null default 0 check (prokliku >= 0),
  posledni_klik timestamptz,

  aktivni       boolean not null default true,
  vytvoril      uuid references public.employees(id) on delete set null,
  vytvoreno_kdy timestamptz not null default now()
);

/*
  KLÍČ JE JEDINEČNÝ V CELÉ DATABÁZI, ne jen ve firmě.

  Adresa `/k/abc123` firmu nenese — podle klíče se teprve pozná, kam
  vede. Dva stejné klíče u dvou firem by znamenaly, že host jedné
  restaurace skončí na stránce druhé.
*/
create unique index marketing_odkazy_klic on public.marketing_odkazy (klic);

create index marketing_odkazy_prispevek
  on public.marketing_odkazy (prispevek_id) where prispevek_id is not null;

alter table public.marketing_odkazy enable row level security;

create policy marketing_odkazy_select on public.marketing_odkazy for select to authenticated
  using (app.can_read_scoped(tenant_id, 'marketing.read', branch_id));

create policy marketing_odkazy_write on public.marketing_odkazy for all to authenticated
  using (app.has_access(tenant_id, 'marketing.manage', branch_id))
  with check (app.has_access(tenant_id, 'marketing.manage', branch_id));

grant select, insert, update, delete on public.marketing_odkazy to authenticated;
revoke all on public.marketing_odkazy from anon;

drop trigger if exists trg_audit_marketing_odkazy on public.marketing_odkazy;
create trigger trg_audit_marketing_odkazy
  after insert or update or delete on public.marketing_odkazy
  for each row execute function app.audit_zmenu('marketing_odkaz');


-- ---------------------------------------------------------------------
-- PŘESMĚROVÁNÍ A POČÍTÁNÍ
--
-- Volá se z veřejné adresy `/k/<klic>`, tedy BEZ PŘIHLÁŠENÍ. Proto
-- `security definer` a proto vrací jen to, co je potřeba k přesměrování
-- — ne celý řádek.
--
-- ---------------------------------------------------------------------
-- CO SE Z NÍ NESMÍ DOZVĚDĚT NEPŘIHLÁŠENÝ
--
-- Neexistující klíč vrací prázdno, ne chybu s vysvětlením. Rozdíl mezi
-- „ten odkaz neexistuje" a „ten odkaz je vypnutý" by dovolil zkoušet
-- klíče a zjišťovat, co která restaurace kdy chystala.
-- ---------------------------------------------------------------------

create or replace function public.marketing_prejit(p_klic text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_cil text;
  v_id  uuid;
  v_s   text;
  v_m   text;
  v_c   text;
begin
  select o.id, o.cil, o.utm_source, o.utm_medium, o.utm_campaign
    into v_id, v_cil, v_s, v_m, v_c
    from public.marketing_odkazy o
   where o.klic = lower(btrim(p_klic))
     and o.aktivni;

  if v_id is null then
    return null;
  end if;

  /*
    POČÍTÁ SE AŽ TADY, ne v aplikaci. Kdyby proklik připočítávala
    aplikace zvlášť, šlo by ho nafouknout opakovaným voláním jiné
    adresy — a hlavně by se to rozešlo s přesměrováním, když by jedno
    z nich selhalo.
  */
  update public.marketing_odkazy
     set prokliku = prokliku + 1,
         posledni_klik = now()
   where id = v_id;

  -- UTM se přidávají až tady, takže se dají opravit, aniž se mění
  -- to, co je vytištěné na plakátu.
  v_cil := v_cil
    || (case when v_cil like '%?%' then '&' else '?' end)
    || 'utm_source=' || coalesce(nullif(v_s, ''), 'foodtab')
    || '&utm_medium=' || coalesce(nullif(v_m, ''), 'social')
    || case when v_c <> '' then '&utm_campaign=' || v_c else '' end;

  return v_cil;
end $$;

comment on function public.marketing_prejit(text) is
  'Cíl měřitelného odkazu a připočtení prokliku. Volá se z veřejné '
  'adresy /k/<klic> bez přihlášení — neznámý klíč vrací prázdno, ne '
  'vysvětlení proč.';

revoke all on function public.marketing_prejit(text) from public;
grant execute on function public.marketing_prejit(text) to anon, authenticated;
