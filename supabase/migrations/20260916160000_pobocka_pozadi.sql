-- =====================================================================
-- Foodtab — vlastní fotka pobočky pro hero banner na Dnes
--
-- UX redesign, 16.9.2026. Obrazovka Dnes měla v hero banneru dřív
-- schválně jen barvu pobočky, ne fotku — komentář přímo v
-- app/[rozsah]/dnes/page.tsx to říkal takhle: appka nemá odkud vzít
-- SKUTEČNOU fotku té které restaurace, a cizí/stock snímek by
-- předstíral, že je to ona.
--
-- Řešení není fotku předstírat, ale dát pobočce možnost nahrát tu
-- svou. Pak už to není cizí snímek — je to fotka, kterou nahrál někdo
-- z firmy o svém vlastním podniku.
--
-- ---------------------------------------------------------------------
-- KBELÍK JE SOUKROMÝ, STEJNĚ JAKO U MARKETINGU
--
-- Fotka provozovny není nic tajného, ale adresa v soukromém kbelíku se
-- nedá uhodnout ani projít — a jednotný přístup (žádný bucket appky
-- není veřejný) je jednodušší na udržení než výjimka pro jeden druh
-- fotek. Ven jde jen podepsaný odkaz s omezenou platností.
--
-- ---------------------------------------------------------------------
-- CESTA JE DETERMINISTICKÁ: JEDNA FOTKA NA POBOČKU
--
-- Na rozdíl od knihovny fotek v marketingu (tam jde o víc fotek,
-- proto náhodné jméno + tabulka metadat) je tohle přesně JEDNA fotka
-- na pobočku — pozadí, ne galerie. Cesta je proto
-- `{tenant_id}/{branch_id}.{přípona}`, nahrání jede s `upsert: true`
-- a novou fotkou se stará prostě přepíše. Žádná další tabulka
-- nevzniká; cestu k aktuální fotce (nebo NULL, když žádná není) drží
-- přímo sloupec na branches.
--
-- ---------------------------------------------------------------------
-- ČÍST SMÍ KAŽDÝ ČLEN POBOČKY, NE JEN settings.manage
--
-- Hero banner vidí na Dnes úplně každý, kdo se na pobočku přihlásí —
-- Dnes samo o sobě nemá žádné vlastní oprávnění, hlídá ho jen
-- členství (app/[rozsah]/layout.tsx). Kdyby čtení fotky viselo na
-- settings.manage, viděl by pozadí jen vedoucí a všem ostatním by na
-- Dnes zmizelo. NAHRÁT/SMAZAT ale pořád smí jen settings.manage —
-- stejné právo, jakým se dnes edituje barva a název pobočky
-- (20260825200000_branch_color.sql, app/[rozsah]/nastaveni/pobocky).
--
-- ---------------------------------------------------------------------
-- POZOR PŘI NASAZENÍ
--
-- `storage.objects` vlastní role `supabase_storage_admin`, ne
-- `postgres`. Kdyby `supabase db push` skončil na „must be owner of
-- table objects", není to chyba téhle migrace — je to práva role,
-- kterou push používá (stejná poznámka jako u
-- 20260913170000_marketing_ulozne.sql).
-- =====================================================================


-- ---------------------------------------------------------------------
-- SLOUPEC
-- ---------------------------------------------------------------------

alter table public.branches
  add column if not exists hero_photo_path text;

comment on column public.branches.hero_photo_path is
  'Cesta v kbelíku "pobocky", nebo NULL. Fotku vlastní nahrál někdo '
  'z firmy — nikdy se sem nedosazuje cizí/stock snímek.';

revoke select on public.branches from authenticated;

grant select (
  id, tenant_id, name, slug, address, timezone, opening_hours,
  day_starts_at, active, created_at, deleted_at, color, kiosk_kod_vterin,
  hero_photo_path
) on public.branches to authenticated;


-- ---------------------------------------------------------------------
-- KBELÍK
--
-- Bez `if not exists`/`on conflict` — srážka jmen má spadnout nahlas.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pobocky',
  'pobocky',
  false,
  -- 10 MB. Hero fotka z telefonu se do toho vejde s rezervou; není to
  -- knihovna, kde by měl smysl marketingový strop 25 MB.
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
);


-- ---------------------------------------------------------------------
-- KOMU CESTA PATŘÍ
--
-- Stejná úvaha jako app.marketing_cesta_rozsah: nesmyslná cesta má
-- vrátit prázdno, ne spadnout výjimkou, kterou by politika navenek
-- ukázala jako chybu serveru.
-- ---------------------------------------------------------------------

create or replace function app.pobocky_cesta_rozsah(p_name text)
returns table (tenant_id uuid, branch_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_slozky text[] := storage.foldername(p_name);
begin
  if array_length(v_slozky, 1) is distinct from 1 then
    return;
  end if;

  begin
    tenant_id := v_slozky[1]::uuid;
  exception when invalid_text_representation then
    return;
  end;

  -- Jméno souboru je "{branch_id}.{přípona}" — pobočka se čte odsud,
  -- ne z další složky (na rozdíl od marketingu tu není kbelík
  -- sdílený s "firemní" úrovní, hero fotku má vždycky jen pobočka).
  begin
    branch_id := split_part(storage.filename(p_name), '.', 1)::uuid;
  exception when invalid_text_representation then
    return;
  end;

  return next;
end $$;

comment on function app.pobocky_cesta_rozsah(text) is
  'Firma a pobočka z cesty v kbelíku pobocky. Nesmyslná cesta vrací '
  'prázdno, ne výjimku.';

revoke all on function app.pobocky_cesta_rozsah(text) from public, anon;
grant execute on function app.pobocky_cesta_rozsah(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- POLITIKY
--
-- Čtení = členství ve firmě a viditelnost pobočky (app.is_member +
-- app.visible_branch_ids), ne settings.manage — viz hlavička.
-- Zápis/mazání = settings.manage, stejně jako úprava ostatních
-- vlastností pobočky.
-- ---------------------------------------------------------------------

create policy pobocky_fotky_select on storage.objects for select to authenticated
  using (
    bucket_id = 'pobocky'
    and exists (
      select 1 from app.pobocky_cesta_rozsah(storage.objects.name) r
       where app.is_member(r.tenant_id)
         and r.branch_id in (select app.visible_branch_ids(r.tenant_id))));

create policy pobocky_fotky_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pobocky'
    and exists (
      select 1 from app.pobocky_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'settings.manage', r.branch_id)));

create policy pobocky_fotky_update on storage.objects for update to authenticated
  using (
    bucket_id = 'pobocky'
    and exists (
      select 1 from app.pobocky_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'settings.manage', r.branch_id)))
  with check (
    bucket_id = 'pobocky'
    and exists (
      select 1 from app.pobocky_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'settings.manage', r.branch_id)));

create policy pobocky_fotky_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'pobocky'
    and exists (
      select 1 from app.pobocky_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'settings.manage', r.branch_id)));
