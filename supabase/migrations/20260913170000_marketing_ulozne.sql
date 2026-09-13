-- =====================================================================
-- Foodtab — modul Marketing: úložiště fotek
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4 a oddíl 5
-- („Vlastní e-mail, úložiště a fronta se nepřevádějí zvlášť — použije
-- se Resend, Supabase Storage a fronta Foodtabu.").
--
-- ---------------------------------------------------------------------
-- KBELÍK JE SOUKROMÝ. NIKDY VEŘEJNÝ.
--
-- Veřejný kbelík znamená, že kdo zná adresu, vidí soubor — bez
-- přihlášení a bez ohledu na firmu. U fotek z restaurace to nejsou jen
-- talíře: jsou tam lidé, interiér a akce, na které nikdo nezval
-- veřejnost. A protože jsou adresy odvozené od id, dá se v nich
-- hledat.
--
-- Ven se proto pouští jen PODEPSANÝ ODKAZ s omezenou platností, který
-- server vydá až poté, co se zeptal na oprávnění.
--
-- ---------------------------------------------------------------------
-- DVĚ OBRANNÉ LINIE I TADY (pravidlo 3)
--
-- `storage.objects` je obyčejná tabulka s RLS. Kontrola v aplikaci
-- nestačí: kdo má přihlášení, mluví se Storage přímo, ne přes naše
-- obrazovky. Politiky níž jsou ta druhá linie.
--
-- Rozhoduje `app.has_access` (pravidlo 2) — ne vlastní úvaha o tom,
-- kdo je odkud.
--
-- ---------------------------------------------------------------------
-- TVAR CESTY: firma / pobočka / soubor
--
--   9dc7…/3f21…/8ab0….jpg     fotka pobočky
--   9dc7…/firma/8ab0….png     fotka celé firmy (logo, ikony)
--
-- Firma je PRVNÍ složka schválně: politika se podle ní ptá, komu
-- soubor patří, a to musí jít poznat z cesty samotné. Kdyby se firma
-- dohledávala až z `marketing_media`, dal by se nahrát soubor, ke
-- kterému žádný řádek neexistuje — a ten by nepatřil nikomu, takže by
-- na něj nikdo nedosáhl a nikdo ho ani neuklidil.
--
-- Slovo `firma` místo prázdné složky proto, že dvě lomítka za sebou
-- se v cestách chovají různě podle toho, kdo je čte.
--
-- ---------------------------------------------------------------------
-- POZOR PŘI NASAZENÍ
--
-- `storage.objects` vlastní role `supabase_storage_admin`, ne
-- `postgres`. Zakládání politik odsud obvykle projde, ale kdyby
-- `supabase db push` skončil na „must be owner of table objects",
-- není to chyba v téhle migraci — je to práva role, kterou push
-- používá. Řešení je pustit ten jeden příkaz pod rolí storage admina,
-- ne politiku zjednodušit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KBELÍK
--
-- Bez `if not exists` a bez `on conflict`: srážka jmen má spadnout
-- nahlas a hned (CLAUDE.md, „Dvě relace v jednom repozitáři",
-- pravidlo 2).
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing',
  'marketing',
  false,
  -- 25 MB. Fotka z telefonu má jednotky megabajtů; tohle je strop
  -- proti omylu, ne cíl. Vynucuje ho Storage, ne naše obrazovka —
  -- na tu se dá poslat požadavek mimo ni.
  26214400,
  array['image/jpeg', 'image/png', 'image/webp']
);


-- ---------------------------------------------------------------------
-- KOMU CESTA PATŘÍ
--
-- Politiky potřebují z cesty vyčíst firmu a pobočku. Přímý přetyp
-- `::uuid` v politice by u cizí nebo poškozené cesty SPADL — a chyba
-- z politiky se navenek tváří jako chyba serveru, ne jako odepřený
-- přístup. Nesmyslná cesta má vyjít prázdná a tím propadnout kontrole,
-- ne shodit dotaz.
-- ---------------------------------------------------------------------

create or replace function app.marketing_cesta_rozsah(p_name text)
returns table (tenant_id uuid, branch_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_slozky text[] := storage.foldername(p_name);
begin
  if array_length(v_slozky, 1) is distinct from 2 then
    return;
  end if;

  begin
    tenant_id := v_slozky[1]::uuid;
    -- `firma` = fotka celé firmy, tedy bez pobočky.
    branch_id := case when v_slozky[2] = 'firma' then null else v_slozky[2]::uuid end;
  exception when invalid_text_representation then
    return;
  end;

  return next;
end $$;

comment on function app.marketing_cesta_rozsah(text) is
  'Firma a pobočka z cesty v úložišti. Nesmyslná cesta vrací prázdno, '
  'ne výjimku — chyba z politiky se navenek tváří jako chyba serveru.';

revoke all on function app.marketing_cesta_rozsah(text) from public, anon;
grant execute on function app.marketing_cesta_rozsah(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- POLITIKY
--
-- Čtení má `marketing.read`, zápis a mazání `marketing.manage` —
-- stejně jako u tabulky `marketing_media`. Kdyby se lišily, dalo by
-- se obejít jedno druhým: smazat soubor a nechat řádek, nebo naopak.
-- ---------------------------------------------------------------------

create policy marketing_soubory_select on storage.objects for select to authenticated
  using (
    bucket_id = 'marketing'
    and exists (
      select 1 from app.marketing_cesta_rozsah(storage.objects.name) r
       where app.can_read_scoped(r.tenant_id, 'marketing.read', r.branch_id)));

create policy marketing_soubory_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marketing'
    and exists (
      select 1 from app.marketing_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));

/*
  Úprava se hlídá z OBOU stran.

  `using` říká, na který soubor smím sáhnout, `with check`, jak smí
  vypadat potom. Bez druhého by šlo vlastní soubor PŘEJMENOVAT do cizí
  firmy — cesta je jen sloupec `name` a přesun je obyčejný update.
*/
create policy marketing_soubory_update on storage.objects for update to authenticated
  using (
    bucket_id = 'marketing'
    and exists (
      select 1 from app.marketing_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)))
  with check (
    bucket_id = 'marketing'
    and exists (
      select 1 from app.marketing_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));

create policy marketing_soubory_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'marketing'
    and exists (
      select 1 from app.marketing_cesta_rozsah(storage.objects.name) r
       where app.has_access(r.tenant_id, 'marketing.manage', r.branch_id)));
