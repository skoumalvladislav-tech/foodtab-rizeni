-- Přílohy ke zprávám — fotka nebo PDF pod zprávou v rozhovoru.
--
-- Etapa 4 Provozního centra (docs/COMMUNICATION_ARCHITECTURE.md). Volitelná:
-- nic dřívějšího na ní nestojí a kód ji toleruje, když ještě není nasazená
-- (stránka rozhovoru přílohy prostě nenačte, tlačítko „Příloha“ se nezobrazí).
--
-- ---------------------------------------------------------------------
-- STEJNÝ MODEL JAKO HLASOVKY, JEN S TABULKOU
--
-- Hlasovka je jeden soubor na zprávu, proto stačil sloupec `zvuk_cesta`.
-- Příloh může být víc (nejvýš 5), proto mají vlastní tabulku
-- `konverzace_prilohy`. Zbytek je zrcadlo 20260917060000_hlasove_zpravy:
--   * soukromý kbelík `prilohy`, cesta `firma/konverzace/soubor`,
--   * o přístupu rozhoduje účastnictví v rozhovoru (app.je_ucastnik),
--   * žádná UPDATE politika (soubor pod odkazem, který už někdo má,
--     se nesmí tiše změnit),
--   * DELETE smí jen sirotka — soubor, na který zatím žádná příloha
--     neukazuje (úklid nepovedeného nahrání).
--
-- Cestu rozebírá STEJNÝ parser jako u hlasovek (app.hlasovka_cesta_rozsah,
-- tvar `firma/konverzace/soubor` je společný) — druhá kopie „jak se cesta
-- skládá“ by byla druhé místo, které se musí měnit spolu s prvním.
--
-- ---------------------------------------------------------------------
-- PŘIPOJENÍ JE JEDINÁ CESTA, KUDY PŘÍLOHA VZNIKNE
--
-- Tabulka nemá zápisový grant. `pripojit_prilohu` hlídá:
--   * jen AUTOR zprávy (cizí zprávu nikdo „nedoplní“),
--   * jen do 10 minut od odeslání (zpráva je storno, ne výmaz — pozdější
--     doplnění souboru by změnilo obsah zprávy, kterou už kolegové četli),
--   * cesta patří TÉTO konverzaci a firmě (jinak by šlo nahrát do jedné
--     konverzace a připojit k jiné),
--   * soubor v úložišti opravdu je (nelze připojit vymyšlenou cestu),
--   * nejvýš 5 příloh na zprávu, povolené typy, rozumný název.
-- Kbelík sám vynucuje velikost a typ (Storage, ne obrazovka).
-- =====================================================================


-- =====================================================================
-- KBELÍK "prilohy"
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prilohy',
  'prilohy',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);


-- =====================================================================
-- TABULKA
-- =====================================================================

create table public.konverzace_prilohy (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  konverzace_id uuid not null references public.konverzace(id),
  zprava_id     uuid not null references public.konverzace_zpravy(id),
  cesta         text not null unique,
  nazev         text not null check (char_length(nazev) between 1 and 120),
  mime          text not null
                check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  velikost      integer not null check (velikost > 0 and velikost <= 10485760),
  vytvoreno_kdy timestamptz not null default now()
);

create index konverzace_prilohy_zprava_idx on public.konverzace_prilohy (zprava_id);
create index konverzace_prilohy_konverzace_idx on public.konverzace_prilohy (konverzace_id);

comment on table public.konverzace_prilohy is
  'Soubory (fotka, PDF) připojené ke zprávě rozhovoru. Vzniká jen přes '
  'pripojit_prilohu; čte ten, kdo je účastníkem rozhovoru.';

alter table public.konverzace_prilohy enable row level security;

create policy konverzace_prilohy_select on public.konverzace_prilohy for select to authenticated
  using (app.je_ucastnik(konverzace_id));

revoke all on public.konverzace_prilohy from public, anon, authenticated;
grant select on public.konverzace_prilohy to authenticated;
grant all on public.konverzace_prilohy to service_role;


-- =====================================================================
-- POLITIKY ÚLOŽIŠTĚ
-- =====================================================================

create policy prilohy_select on storage.objects for select to authenticated
  using (
    bucket_id = 'prilohy'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id)));

create policy prilohy_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prilohy'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id)));

create policy prilohy_delete_sirotka on storage.objects for delete to authenticated
  using (
    bucket_id = 'prilohy'
    and exists (
      select 1 from app.hlasovka_cesta_rozsah(storage.objects.name) r
       where app.je_ucastnik(r.konverzace_id))
    and not exists (
      select 1 from public.konverzace_prilohy p
       where p.cesta = storage.objects.name));


-- =====================================================================
-- PRIPOJIT_PRILOHU
-- =====================================================================

create or replace function public.pripojit_prilohu(
  p_zprava   uuid,
  p_cesta    text,
  p_nazev    text,
  p_mime     text,
  p_velikost integer
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_konv      uuid;
  v_tenant    uuid;
  v_autor     uuid;
  v_kdy       timestamptz;
  v_storno    timestamptz;
  v_ja        uuid;
  v_cesta_t   uuid;
  v_cesta_k   uuid;
  v_nazev     text;
  v_id        uuid;
begin
  select z.konverzace_id, z.tenant_id, z.autor, z.vytvoreno_kdy, z.stornovano_kdy
    into v_konv, v_tenant, v_autor, v_kdy, v_storno
    from public.konverzace_zpravy z
   where z.id = p_zprava;

  if v_konv is null or not app.je_ucastnik(v_konv) then
    raise exception 'K té zprávě nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  v_ja := app.muj_employee(v_tenant);

  if v_ja is null or v_autor is distinct from v_ja then
    raise exception 'Přílohu může ke zprávě připojit jen její autor.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_storno is not null then
    raise exception 'Zpráva je stornovaná.' using errcode = 'check_violation';
  end if;

  if v_kdy < now() - interval '10 minutes' then
    raise exception 'Přílohu lze připojit jen hned po odeslání zprávy.'
      using errcode = 'check_violation';
  end if;

  select r.tenant_id, r.konverzace_id
    into v_cesta_t, v_cesta_k
    from app.hlasovka_cesta_rozsah(p_cesta) r;

  if v_cesta_t is distinct from v_tenant or v_cesta_k is distinct from v_konv then
    raise exception 'Cesta k příloze nesedí s touhle konverzací.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'prilohy' and o.name = p_cesta
  ) then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.konverzace_prilohy p where p.zprava_id = p_zprava) >= 5 then
    raise exception 'Ke zprávě lze připojit nejvýš 5 příloh.'
      using errcode = 'check_violation';
  end if;

  -- Název je jen popisek: bez lomítek (i zpětných; chr(92) je zpětné
  -- lomítko, zapsané takhle, aby ho nic po cestě nezkomolilo) a bez
  -- okrajových mezer, ať je v seznamu vždycky jen jméno souboru.
  v_nazev := btrim(translate(coalesce(p_nazev, ''), '/' || chr(92), '__'));

  if v_nazev = '' then
    raise exception 'Příloha nemá název.' using errcode = 'check_violation';
  end if;

  insert into public.konverzace_prilohy
    (tenant_id, konverzace_id, zprava_id, cesta, nazev, mime, velikost)
  values
    (v_tenant, v_konv, p_zprava, p_cesta, left(v_nazev, 120), p_mime, p_velikost)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.pripojit_prilohu(uuid, text, text, text, integer) is
  'Jediná cesta, kterou vznikne příloha: autor zprávy, do 10 minut od '
  'odeslání, soubor je v úložišti a cesta patří téhle konverzaci, nejvýš 5 '
  'příloh na zprávu.';

revoke all on function public.pripojit_prilohu(uuid, text, text, text, integer) from public, anon;
grant execute on function public.pripojit_prilohu(uuid, text, text, text, integer) to authenticated;
