-- Hlasové zprávy — nahrát, uložit, poslat, přehrát. BEZ AI přepisu.
--
-- Noční zadání "KOMUNIKACE / VZKAZY 2.0", bod 5 z doporučeného pořadí
-- v docs/hlaseni/komunikace-current-state-map-2026-09-17.md.
--
-- ROZHODNUTÍ ŠÉFÍKA 17.9.2026 v noci: AI přepis řeči na text se dnes
-- NEDĚLÁ. Claude API nemá vstup pro zvuk (jen text/obrázky/PDF) —
-- přepis by potřeboval nového dodavatele (Whisper API, Deepgram,
-- Google Speech-to-Text…) s vlastním klíčem a náklady, a to je
-- rozhodnutí pro Šéfíka, ne pro noční autonomní běh. Než dodavatel
-- vznikne, hlasovka je zvuk k přehrání, nic víc — `zvuk_cesta` na
-- zprávě je navržená tak, aby se sloupec `prepis` dal přidat později
-- BEZ přepisu existujících zpráv.
--
-- ---------------------------------------------------------------------
-- KBELÍK JE SOUKROMÝ, STEJNĚ JAKO U MARKETINGU
--
-- Mirror `20260913170000_marketing_ulozne.sql` — soukromý kbelík,
-- cesta nese, komu soubor patří, podepsaný odkaz s omezenou platností.
-- Rozdíl: cesta tu nese KONVERZACI, ne pobočku — protože o přístupu
-- k hlasovce rozhoduje účastnictví v rozhovoru (app.je_ucastnik), ne
-- dosah na pobočku.
--
-- ---------------------------------------------------------------------
-- ZPRÁVA JE STORNO, NE VÝMAZ (pravidlo 9) — PROTO ŽÁDNÁ UPDATE POLITIKA
-- A DELETE JEN NA SIROTKY
--
-- Text zprávy se dnes taky nedá měnit ani mazat přímo — jen stornovat
-- přes `stornovat_zpravu`. Hlasovka jednou PŘIPOJENÁ KE ZPRÁVĚ je
-- stejná: nesmazatelná. DELETE politika níž smí smazat jen soubor,
-- na který zatím neukazuje žádná zpráva — úklid nepovedeného nahrání,
-- ne cesta, jak vzít zpátky odeslanou hlasovku. Kdyby šel přepsat
-- soubor pod odkazem, který už někdo má, změnil by se mu obsah beze
-- stopy — proto žádná UPDATE politika vůbec.
-- =====================================================================


-- =====================================================================
-- KONVERZACE_ZPRAVY: text NEBO zvuk, aspoň jedno
-- =====================================================================

alter table public.konverzace_zpravy
  alter column text set default '';

alter table public.konverzace_zpravy
  drop constraint konverzace_zpravy_text_check;

alter table public.konverzace_zpravy
  add column zvuk_cesta   text,
  add column zvuk_delka_s integer;

alter table public.konverzace_zpravy
  add constraint konverzace_zpravy_text_nebo_zvuk_check
  check (btrim(text) <> '' or zvuk_cesta is not null);

alter table public.konverzace_zpravy
  add constraint konverzace_zpravy_zvuk_delka_check
  check (zvuk_delka_s is null or zvuk_delka_s > 0);

comment on column public.konverzace_zpravy.zvuk_cesta is
  'Cesta v úložišti "hlasovky" (tenant_id/konverzace_id/soubor.ext), '
  'nebo null u textové zprávy. Rozhoduje o ní app.je_ucastnik, stejně '
  'jako o textu samotném.';

comment on column public.konverzace_zpravy.zvuk_delka_s is
  'Délka nahrávky v celých sekundách, jen pro zobrazení (mm:ss). '
  'Měří se v prohlížeči při nahrávání, ne přesně — nic na ní nestojí.';


-- =====================================================================
-- KBELÍK "hlasovky"
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hlasovky',
  'hlasovky',
  false,
  -- 10 MB. Pracovní hlasovka, ne podcast — MediaRecorder v Opusu dá
  -- pár desítek kB za sekundu, takže tohle je pár minut i s rezervou.
  -- Vynucuje ho Storage, ne obrazovka — na tu se dá poslat požadavek
  -- mimo ni.
  10485760,
  -- Kryje výstup MediaRecorder napříč prohlížeči: Chrome/Firefox dají
  -- webm/ogg (Opus), Safari mp4/aac.
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']
);


-- ---------------------------------------------------------------------
-- KOMU CESTA PATŘÍ
--
-- Stejná úvaha jako app.marketing_cesta_rozsah: nesmyslná cesta má
-- vyjít prázdná, ne spadnout výjimkou — chyba z politiky se navenek
-- tváří jako chyba serveru, ne jako odepřený přístup.
-- ---------------------------------------------------------------------

create or replace function app.hlasovka_cesta_rozsah(p_name text)
returns table (tenant_id uuid, konverzace_id uuid)
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
    tenant_id      := v_slozky[1]::uuid;
    konverzace_id  := v_slozky[2]::uuid;
  exception when invalid_text_representation then
    return;
  end;

  return next;
end $$;

comment on function app.hlasovka_cesta_rozsah(text) is
  'Firma a konverzace z cesty v úložišti hlasovek. Nesmyslná cesta '
  'vrací prázdno, ne výjimku.';

revoke all on function app.hlasovka_cesta_rozsah(text) from public, anon;
grant execute on function app.hlasovka_cesta_rozsah(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- POLITIKY — SELECT, INSERT a DELETE OMEZENÝ NA SIROTKY
--
-- Všechny tři se ptají na app.je_ucastnik — stejné právo, jaké
-- potřebuje poslat_zpravu/číst konverzaci. Kdyby se lišilo, šlo by
-- nahrát hlasovku tam, kam by se nedala poslat textová zpráva, nebo
-- naopak.
--
-- DELETE NENÍ VÝJIMKA Z "storno, ne výmaz" (hlavička výš) — je
-- ZÚŽENÝ, aby ji neporušil. `odeslatHlasovku` po neúspěšném
-- poslat_zpravu smaže právě nahraný soubor (úklid siroty, stejná
-- úvaha jako nahrátFotku v marketingu); bez téhle politiky ten úklid
-- pod session uživatele tiše neprojde (RLS ho odmítne, výsledek se
-- nekontroluje) a soubor zůstane navždy. Politika proto smí smazat
-- jen cestu, na kterou zatím NEUKAZUJE žádná zpráva — jakmile
-- poslat_zpravu hlasovku připojí ke zprávě, `not exists` selže
-- a soubor je od té chvíle nesmazatelný, přesně jako text zprávy.
-- ---------------------------------------------------------------------

create policy hlasovky_select on storage.objects for select to authenticated
  using (
    bucket_id = 'hlasovky'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id)));

create policy hlasovky_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hlasovky'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id)));

create policy hlasovky_delete_sirotka on storage.objects for delete to authenticated
  using (
    bucket_id = 'hlasovky'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id))
    and not exists (
      select 1 from public.konverzace_zpravy z
       where z.zvuk_cesta = storage.objects.name));


-- =====================================================================
-- POSLAT_ZPRAVU: nové parametry p_zvuk_cesta, p_zvuk_delka_s
--
-- Stará (uuid,text,boolean,text) se DROPne, stejně jako v
-- 20260917040000_priorita_zprav.sql — vedle sebe by jinak zůstaly OBĚ
-- funkce a volání s méně argumenty by spadlo na "is not unique".
-- =====================================================================

drop function if exists public.poslat_zpravu(uuid, text, boolean, text);

create or replace function public.poslat_zpravu(
  p_konverzace   uuid,
  p_text         text,
  p_nalehava     boolean default false,
  p_priorita     text default null,
  p_zvuk_cesta   text default null,
  p_zvuk_delka_s integer default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant           uuid;
  v_ja               uuid;
  v_id               uuid;
  v_priorita         text;
  v_text             text := coalesce(p_text, '');
  v_cesta_tenant     uuid;
  v_cesta_konverzace uuid;
begin
  select k.tenant_id into v_tenant from public.konverzace k where k.id = p_konverzace;

  if v_tenant is null or not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.konverzace k
             where k.id = p_konverzace and k.uzavreno_kdy is not null) then
    raise exception 'Tenhle rozhovor je uzavřený.' using errcode = 'check_violation';
  end if;

  if btrim(v_text) = '' and p_zvuk_cesta is null then
    raise exception 'Zpráva nemá ani text, ani hlasovku.'
      using errcode = 'check_violation';
  end if;

  /*
    CESTA MUSÍ SEDĚT S KONVERZACÍ, NA KTEROU SE ZPRÁVA POSÍLÁ.

    Bez tohohle by šlo nahrát hlasovku do JEDNÉ konverzace (kde je
    člověk účastník — to hlídá politika úložiště) a připojit ji přes
    poslat_zpravu k JINÉ. Storage politika sama tenhle křížový případ
    nepokryje, protože se dívá jen na cestu při nahrávání, ne na to,
    kam se cesta později přiřadí.

    Rozebírá se přes app.hlasovka_cesta_rozsah — STEJNÝ parser, který
    používají politiky úložiště výš. Ruční regex nad stejným tvarem
    cesty by byl druhá, nezávislá definice "jak se cesta skládá" — dvě
    místa, která se musí měnit spolu a nic to nevynucuje. Nalezeno
    multi-agentní revizí.
  */
  if p_zvuk_cesta is not null then
    select r.tenant_id, r.konverzace_id
      into v_cesta_tenant, v_cesta_konverzace
      from app.hlasovka_cesta_rozsah(p_zvuk_cesta) r;

    if v_cesta_tenant is distinct from v_tenant
       or v_cesta_konverzace is distinct from p_konverzace then
      raise exception 'Cesta k hlasovce nesedí s touhle konverzací.'
        using errcode = 'check_violation';
    end if;
  end if;

  v_ja := app.muj_employee(v_tenant);

  v_priorita := coalesce(p_priorita, case when coalesce(p_nalehava, false) then 'urgent' else 'normal' end);

  if v_priorita not in ('normal', 'important', 'urgent') then
    raise exception 'Neplatná priorita zprávy.' using errcode = 'check_violation';
  end if;

  if v_priorita = 'urgent'
     and not app.has_permission(v_tenant, 'communication.urgent') then
    raise exception 'Naléhavou zprávu poslat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.konverzace_zpravy
    (konverzace_id, tenant_id, autor, text, priorita, zvuk_cesta, zvuk_delka_s)
  values
    (p_konverzace, v_tenant, v_ja, v_text, v_priorita, p_zvuk_cesta, p_zvuk_delka_s)
  returning id into v_id;

  if v_priorita = 'urgent' then
    perform app.audit(
      p_tenant      => v_tenant,
      p_action      => 'komunikace.nalehava_zprava',
      p_entity_type => 'konverzace_zprava',
      p_entity_id   => v_id::text,
      p_after       => jsonb_build_object(
        'konverzace', p_konverzace,
        'odesilatel', (select e.full_name from public.employees e where e.id = v_ja),
        'znaku', length(v_text)
      )
    );
  end if;

  return v_id;
end;
$$;

comment on function public.poslat_zpravu(uuid, text, boolean, text, text, integer) is
  'Jediná cesta, kterou vznikne zpráva — textová, hlasová, nebo obojí. '
  'Hlídá účastnictví, zapnutý modul, právo communication.urgent pro '
  'urgent, a že cesta k hlasovce patří TÉTO konverzaci.';

revoke all on function public.poslat_zpravu(uuid, text, boolean, text, text, integer) from public, anon;
grant execute on function public.poslat_zpravu(uuid, text, boolean, text, text, integer) to authenticated;
