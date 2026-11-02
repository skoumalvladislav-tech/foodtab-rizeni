-- =====================================================================
-- Foodtab — Rezervace a akce: dokument Word (.docx) mezi přílohami
--
-- Zadání Šéfíka 2. 11. 2026: „přidej ještě možnost přidat dokument word
-- do rezervací a akcí“ (otázka 79).
--
-- Scénář: krok108. NASAZUJE ŠÉFÍK (`db push`), ne push do main.
--
-- ---------------------------------------------------------------------
-- CO TO DĚLÁ
--
-- K fotkám a PDF (20261027100000, oddíl 9) přidá jeden typ:
--   application/vnd.openxmlformats-officedocument.wordprocessingml.document
-- tedy .docx. Na třech místech, která drží typ přílohy:
--   1. kbelík `rezervace` (allowed_mime_types) — úložiště jiný soubor
--      nepřijme vůbec,
--   2. CHECK na `rezervace_prilohy.mime` — řádek přílohy jiný typ nenese,
--   3. `app.rezervace_cesta` — jméno souboru smí končit `.docx`.
--
-- Co ZÁMĚRNĚ NE:
--   * starý .doc (application/msword) — binární formát, který Word sám
--     nabízí převést; prohlížeč ho stejně neotevře,
--   * .docm (macroEnabled) — dokument s makry; nikdo ho od hosta
--     nepotřebuje a z přílohy se nemá dát spustit nic,
--   * Excel, PowerPoint a další — o ty nikdo nežádal.
--
-- Fotka a PDF se dál otevřou v prohlížeči; Word se stáhne (odkaz
-- v app/api/rezervace/soubor/[id] ho podepíše „ke stažení“). Zprávy
-- v Komunikaci .docx nepřijímají — tohle platí jen pro rezervace.
--
-- Funkce `rezervace_pripojit_prilohu` se nemění: typ bere z popisu,
-- který k souboru zapsalo úložiště, a ten už jiný než povolený být nemůže.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Kbelík
--
-- Bez kbelíku (jiná databáze, ruční zásah) má migrace spadnout nahlas,
-- ne potichu nic neudělat.
-- ---------------------------------------------------------------------

do $$
begin
  update storage.buckets
     set allowed_mime_types = array[
           'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
   where id = 'rezervace';
  if not found then
    raise exception 'Kbelík rezervace neexistuje.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. Typ v řádku přílohy
-- ---------------------------------------------------------------------

alter table public.rezervace_prilohy drop constraint rezervace_prilohy_mime_check;
alter table public.rezervace_prilohy add constraint rezervace_prilohy_mime_check
  check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));


-- ---------------------------------------------------------------------
-- 3. Cesta v úložišti
--
-- Stejná funkce jako v 20261027100000, jen přípona navíc. Politiky
-- kbelíku ji volají jménem, takže `create or replace` stačí.
-- ---------------------------------------------------------------------

create or replace function app.rezervace_cesta(p_name text)
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
  if storage.filename(p_name) !~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf|docx)$' then
    return;
  end if;
  begin
    tenant_id := v_slozky[1]::uuid;
    branch_id := v_slozky[2]::uuid;
  exception when invalid_text_representation then
    return;
  end;
  return next;
end $$;
