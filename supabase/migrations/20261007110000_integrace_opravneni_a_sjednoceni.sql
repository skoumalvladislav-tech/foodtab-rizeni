-- =====================================================================
-- Foodtab — Integrace: oddělení práva správce integrací, oprava
-- zneužitého sloupce `poskytovatel`, přeplatky už appka neodmítá
--
-- Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 2
-- ("Odděl oprávnění správce integrací od oprávnění číst data cílových
-- modulů. Napojení banky nesmí zpřístupnit její údaje všem
-- zaměstnancům.") a oddíl 7 ("Podporuj částečné úhrady, více plateb na
-- fakturu, hromadné platby, přeplatky, vratky...").
--
-- ---------------------------------------------------------------------
-- 1. NOVÉ PRÁVO integrace.manage — ODDĚLENÉ OD finance.manage
--
-- Dnes `app/[rozsah]/finance/integrace/**` (registr připojení, založení
-- Fio/Enable Banking účtu, uložení/smazání tajemství, manuální sync)
-- kontroluje `finance.manage` — stejné právo, které smí i mazat/opravovat
-- FAKTURY a PLATBY. Kdo smí administrovat NAPOJENÍ (založit připojení,
-- uložit token, odpojit), dnes automaticky smí i měnit finanční data —
-- a naopak, kdo smí měnit finanční data, automaticky smí i přepojit
-- banku. Zadání to chce rozpojit. ČTENÍ registru (`finance.read`) se
-- NEMĚNÍ — vidět, že "Fio je připojené", není totéž jako vidět
-- zůstatky/transakce (ty dál hlídá `finance.read` na `platebni_ucty`/
-- `transakce`/`bankovni_zustatky`, beze změny).
--
-- `module_key = 'finance'` (ne nový modul) — Integrace dnes žije jako
-- sekce Financí a `app.has_access` vyžaduje aktivní `tenant_modules` pro
-- modul toho práva; nový modul by vyžadoval založit ho ve `modules` A
-- `tenant_modules` pro každou firmu, jinak by `integrace.manage` nikomu
-- nefungovalo, dokud by ho Šéfík nezapnul — zbytečné riziko tichého
-- zneschopnění pro P0. Cross-modulové budoucí kategorie (rezervace,
-- pokladna mimo Finance) řeší navigace, ne vlastnictví modulu.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('integrace.manage', 'finance', 'Správa napojení na externí systémy (pokladna, banka, e-mail, rezervace)', true, 510)
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      sensitive = excluded.sensitive,
      sort_order = excluded.sort_order;

-- Zpětná kompatibilita: kdo dnes smí administrovat integrace přes
-- `finance.manage`, nesmí tím právo přes noc ztratit. Nový klíč dostává
-- KAŽDÉ zařazení/výjimka, které má dnes `finance.manage` — živé
-- pravidlo ("změna práv zařazení platí hned") se tu použije přesně
-- jednou, při vzniku práva, ne při každé další změně `finance.manage`.
--
-- FUNKCE, ne holé příkazy — stejný důvod jako `app.prevod_zarazeni()`
-- (20260908090000): migrace běží nad prázdnou databází dřív, než
-- vznikne jakákoli firma, takže by přímo tady nebylo co dosazovat —
-- scénář ji proto musí umět zavolat ZNOVU, s vlastní fixturou, aby
-- doložil, že skutečně kopíruje `finance.manage` → `integrace.manage`,
-- ne že jen tiše neudělá nic. `on conflict do nothing` ji dělá
-- idempotentní (druhé spuštění nic nezdvojí).
create or replace function app.integrace_manage_zpetne_dosadit()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.position_permissions (tenant_id, position_id, permission_key)
  select tenant_id, position_id, 'integrace.manage'
  from public.position_permissions
  where permission_key = 'finance.manage'
  on conflict do nothing;

  insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
  select tenant_id, employee_id, 'integrace.manage', true
  from public.employee_permissions
  where permission_key = 'finance.manage' and granted = true
  on conflict do nothing;
end $$;

comment on function app.integrace_manage_zpetne_dosadit() is
  'Jednorázové zpětné dosazení integrace.manage všem, kdo měli '
  'finance.manage PŘED 7.10.2026 — volá ji tahle migrace jednou a '
  'scénář krok89 znovu nad vlastní fixturou, aby dokázal, že logika '
  'skutečně kopíruje, ne jen tiše neudělá nic. Idempotentní.';

revoke all on function app.integrace_manage_zpetne_dosadit() from public, anon, authenticated;

select app.integrace_manage_zpetne_dosadit();

comment on table public.position_permissions is
  'Oprávnění, která dává zařazení. Změna platí hned všem, kdo ho mají. '
  '`integrace.manage` byl 7.10.2026 zpětně dosazen všem, kdo měli '
  '`finance.manage` — od teď jde o dvě NEZÁVISLÉ práva, mění se každé '
  'zvlášť.';

-- Správa připojení/tajemství od teď `integrace.manage`, ne `finance.manage`.
drop policy integrace_pripojeni_write on public.integrace_pripojeni;
create policy integrace_pripojeni_write on public.integrace_pripojeni for all to authenticated
  using (app.has_access(tenant_id, 'integrace.manage', branch_id))
  with check (app.has_access(tenant_id, 'integrace.manage', branch_id));

create or replace function app.integrace_uloz_tajemstvi(
  p_pripojeni uuid,
  p_sifra     text,
  p_otisk     text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'integrace.manage', v_branch) then
    raise exception 'Nemáte oprávnění ukládat přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.integrace_tajemstvi (pripojeni_id, tenant_id, sifra, otisk)
  values (p_pripojeni, v_tenant, p_sifra, p_otisk)
  on conflict (pripojeni_id) do update
    set sifra = excluded.sifra,
        otisk = excluded.otisk,
        verze_klice = public.integrace_tajemstvi.verze_klice + 1,
        rotovano_kdy = now();

  perform app.audit(v_tenant, 'finance.klic_ulozen', 'integrace_pripojeni',
                    p_pripojeni::text, v_branch, null,
                    jsonb_build_object('otisk', p_otisk));
end $$;

create or replace function app.integrace_precti_tajemstvi(p_pripojeni uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_sifra  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'integrace.manage', v_branch) then
    raise exception 'Nemáte oprávnění číst přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.sifra into v_sifra
    from public.integrace_tajemstvi t
   where t.pripojeni_id = p_pripojeni and t.tenant_id = v_tenant;

  return v_sifra;
end $$;

create or replace function app.integrace_smaz_tajemstvi(p_pripojeni uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_otisk  text;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni;

  if v_tenant is null or not app.has_access(v_tenant, 'integrace.manage', v_branch) then
    raise exception 'Nemáte oprávnění odpojit tohle připojení.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.otisk into v_otisk
    from public.integrace_tajemstvi t where t.pripojeni_id = p_pripojeni;

  delete from public.integrace_tajemstvi where pripojeni_id = p_pripojeni;

  perform app.audit(v_tenant, 'finance.klic_smazan', 'integrace_pripojeni',
                    p_pripojeni::text, v_branch,
                    jsonb_build_object('otisk', v_otisk), null);
end $$;


-- ---------------------------------------------------------------------
-- 2. OPRAVA `poskytovatel` — appka ho zneužívala jako unikátní klíč
--
-- `integrace_pripojeni_zive` (20261003100000) dělá unikátní
-- `(tenant_id, branch_id, oblast, poskytovatel)` nad živými připojeními.
-- Zadání výslovně dovoluje „Jeden klient může mít více připojení
-- stejného typu" (dva Fio účty), takže appka (`banka/akce.ts`) si
-- pomohla tak, že `poskytovatel` naplnila `fio-<náhodných 8 znaků>` —
-- sloupec, který má appce říct, JAKÝ software/API připojení používá,
-- tím ztratil smysl (appka by si s ním nepoznala dvě Fio připojení od
-- sebe jinak než přes `nazev`).
--
-- Oprava: živá jedinečnost se váže na CÍL připojení, ne na jméno
-- poskytovatele. U banky je cíl `platebni_ucet_id` (dvě připojení na
-- TENTÝŽ platební účet by byla skutečná duplicita — která banka pak
-- zapisuje transakce?). U ostatních oblastí (pokladna/účetnictví/
-- e-mail) appka dnes žádný cíl nemá (`integrace_pripojeni.branch_id`
-- je nejblíž, ale NULL = celá firma, víc připojení se stejným
-- poskytovatelem na celou firmu je legitimní otázka pro budoucí POS/
-- e-mail adaptéry) — žádná živá jedinečnost se tam proto nevynucuje,
-- stejně jako dřív jedinečnost nebránila ničemu, co appka skutečně
-- zakládala.
-- ---------------------------------------------------------------------

drop index public.integrace_pripojeni_zive;

create unique index integrace_pripojeni_banka_jeden_ucet
  on public.integrace_pripojeni (platebni_ucet_id)
  where odpojeno_kdy is null and oblast = 'banka' and platebni_ucet_id is not null;

comment on index public.integrace_pripojeni_banka_jeden_ucet is
  'Nejvýš JEDNO živé bankovní připojení na cílový platební účet — dvě '
  'by se předháněly v zápisu transakcí na stejný účet. `poskytovatel` '
  '(fio/enablebanking) od 7.10.2026 NENÍ součástí žádné jedinečnosti — '
  'appka ho nesmí plnit náhodnou příponou, viz oprava v banka/akce.ts.';


-- ---------------------------------------------------------------------
-- 3. PŘEPLATKY — appka je dřív ODMÍTALA (raise exception), zadání
--    teď výslovně chce „podporuj... přeplatky". Appka nehádá, co se
--    s přeplatkem má stát (jiná faktura? dobropis? vrácení?) — jen ho
--    už nezakazuje a řekne částku navíc, ať si o ní rozhodne člověk.
--    Rozhoduje VŽDY lidský klik (zadání oddíl 7), appka ho jen
--    neblokuje tam, kde dřív blokovala zbytečně.
--
--    Návratový typ se měnil (nový sloupec `prebytek_haleru`) — Postgres
--    `create or replace function` typovou změnu výstupu neumí, proto
--    `drop` + znovu `create`.
-- ---------------------------------------------------------------------

drop function if exists app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric);
drop function if exists public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric);

create function app.potvrdit_alokaci_platby(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer,
  p_jistota                numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura   bigint := hashtextextended(p_faktura, 0);
  v_branch         uuid;
  v_castka_transakce integer;
  v_soucet_transakce integer;
  v_soucet_faktury   integer;
  v_novy_soucet_faktury integer;
begin
  if p_castka_haleru <= 0 then
    raise exception 'Alokovaná částka musí být kladná.' using errcode = 'check_violation';
  end if;

  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant;

  if v_castka_transakce is null then
    raise exception 'Transakce nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'finance.manage', v_branch) then
    raise exception 'Nemáte oprávnění párovat platby.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(castka_haleru), 0) into v_soucet_transakce
    from public.platby_faktury
   where transakce_id = p_transakce and stav = 'potvrzeno';

  -- Tahle kontrola ZŮSTÁVÁ striktní: nejde alokovat víc peněz z JEDNÉ
  -- transakce, než kolik ta transakce skutečně nese — to by nebyl
  -- přeplatek faktury, byl by to vymyšlený peníz, který banka
  -- nepotvrdila.
  if v_soucet_transakce + p_castka_haleru > v_castka_transakce then
    raise exception 'Alokace přesahuje částku platby (% + % > %).',
      v_soucet_transakce, p_castka_haleru, v_castka_transakce using errcode = 'check_violation';
  end if;

  select coalesce(sum(castka_haleru), 0) into v_soucet_faktury
    from public.platby_faktury
   where faktura_id = p_faktura and tenant_id = p_tenant and stav = 'potvrzeno';

  v_novy_soucet_faktury := v_soucet_faktury + p_castka_haleru;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, jistota, stav, potvrzeno_kdy)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, p_jistota, 'potvrzeno', now());

  perform app.audit(p_tenant, 'finance.platba_alokovana', 'platby_faktury', p_faktura, v_branch,
                    null, jsonb_build_object(
                      'transakce_id', p_transakce, 'castka_haleru', p_castka_haleru,
                      'prebytek_haleru', greatest(0, v_novy_soucet_faktury - p_castka_faktury_celkem)));

  return query select
    v_novy_soucet_faktury::bigint,
    v_novy_soucet_faktury >= p_castka_faktury_celkem,
    greatest(0, v_novy_soucet_faktury - p_castka_faktury_celkem)::bigint;
end $$;

comment on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) is
  'JEDINÁ cesta k zápisu potvrzené alokace — INSERT z klienta je odepřený. '
  'Přeplatek faktury appka od 7.10.2026 NEODMÍTÁ (zadání: „podporuj... '
  'přeplatky"), jen ho vrátí v `prebytek_haleru` — co se s penězi navíc '
  'stane, rozhoduje člověk, appka ho sama na jinou fakturu nepřesune.';

revoke all on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) from public, anon;
grant execute on function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) to authenticated;

create function public.potvrdit_alokaci_platby(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer,
  p_jistota                numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint)
language sql security invoker set search_path = ''
as $$
  select * from app.potvrdit_alokaci_platby(p_tenant, p_transakce, p_faktura, p_castka_haleru, p_castka_faktury_celkem, p_jistota);
$$;

revoke all on function public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) from public, anon;
grant execute on function public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric) to authenticated;
