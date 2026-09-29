-- =====================================================================
-- Foodtab — hromadná notifikace při vydání rozpisu, hromadné potvrzení
-- a explicitní odmítnutí směny
--
-- ZADÁNÍ ŠÉFÍKA (majitel, doslovně, 29. 9. 2026):
--   „nastav aby při vydání směny se vyslala hromadná notifikace těm
--   lidem kterých se směna týká, zároveň možnost potvrzení všech směn
--   a nebo možnost nepotvrdit třeba jednu nebo více směn. chtělo by to
--   potvrzovací tabulku."
--
-- Potvrzovací tabulka (`public.smeny_potvrzeni`) už existuje od migrace
-- 20260920120000 — nese ji `potvrdit_smenu`, self-service, jedna směna
-- najednou. Chybí tři věci: 1) vydání rozpisu notifikuje MIMO centrální
-- cestu (přímý insert, žádný push), 2) potvrzení nejde hromadně, 3)
-- odmítnutí neexistuje vůbec, natož jako vlastní stav.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
--   1. `smeny_potvrzeni` dostává `rejected_at`, `rejected_reason` a CHECK,
--      že se potvrzení a odmítnutí vzájemně vylučují. `confirmed_at`
--      přestává být `not null` — řádek nese buď potvrzení, nebo
--      odmítnutí (bod 4 rozboru).
--
--   2. NOVÁ sdílená `app.zapsat_potvrzeni_smeny` — JEDINÝ zápis do
--      `smeny_potvrzeni` (insert/on conflict update podle aktuálního
--      otisku směny). Volá ji `potvrdit_smenu` (beze změny chování),
--      nová hromadná RPC a nová RPC pro odmítnutí.
--
--      Záměrně NEKONTROLUJE, že směna je vydaná — to dělá KAŽDÝ
--      VOLAJÍCÍ SÁM, stejnou úvahou jako `app.zapsat_potvrzeni_zalohy`
--      (20260925140000, hlavička: „Stav hlídá KAŽDÁ CESTA SAMA, protože
--      každá říká jinou větu; pomocná funkce ho už nekontroluje").
--      Kdyby kontrolu dělala sdílená funkce a `potvrdit_smenu` ji volal
--      AŽ PO svém vlastním „znění sedí s obrazovkou" testu, prohodilo by
--      se pořadí dvou chyb (PT409 „není vydaná" × PT409 „změnila se") u
--      směny, která je špatně obojí — a to by byla tichá změna chování,
--      kterou zadání zakazuje. Cena je tři skoro stejné bloky „je
--      vydaná?" místo jednoho; přesně tenhle kompromis repozitář už
--      jednou vybral u záloh.
--
--   3. NOVÁ `public.potvrdit_vsechny_moje_smeny(p_tenant)` — potvrdí
--      všechny vydané, dosud nerozhodnuté (ne potvrzené, ne odmítnuté
--      pro AKTUÁLNÍ otisk) směny volajícího. Vrací počet.
--
--   4. NOVÁ `public.odmitnout_smenu(p_tenant, p_smena, p_duvod)` —
--      odmítne SVOU vydanou směnu. Důvod povinný (bod 5 rozboru, stejná
--      úvaha jako storno úseku docházky, 20260927110000). Notifikuje
--      lidi se `shifts.manage` NA POBOČCE té směny (`app.kdo_ma_pravo_
--      na_pobocce`, vzor z `app.upozorni_na_prijeti` /
--      `ohlasit_zapomenute_odchody`), kromě volajícího samotného.
--
--   5. NOVÁ `public.moje_smeny_k_potvrzeni(p_tenant)` — vydané směny
--      volajícího za posledních 14 dní a bez omezení do budoucna, se
--      stavem (čeká/potvrzeno/odmítnuto) a důvodem odmítnutí. Okno „14
--      dní zpátky" je vlastní rozhodnutí (zadání ani vzor `moje_
--      nepotvrzene_zalohy` žádné číslo nedávají — ta funkce nefiltruje
--      datem vůbec, zálohy samy dřív nebo později dojdou na
--      „potvrzená"/„stornovaná"; nepotvrzená/neodmítnutá SMĚNA by bez
--      dolní meze rostla donekonečna, protože staré vydané směny bez
--      rozhodnutí by tu zůstávaly navždy).
--
--   6. NOVÁ `public.smeny_potvrzeni_pobocky(p_tenant, p_branch, p_od,
--      p_do)` — přehled pro vedoucího/majitele (`shifts.manage`, jako
--      `stav_potvrzeni_smeny` i `vydat_rozpis`): pro každou vydanou
--      směnu v období stav potvrzení a kdo/kdy, po vzoru
--      `zalohy_pobocky` (tichý prázdný výsledek bez práva, ne chyba).
--
--   7. `vydat_rozpis` — přímý insert do `notifications` nahrazen
--      voláním `app.notifikovat` (centrální cesta, tedy push na
--      telefon). `v_radek.user_id` je už `profiles.user_id` (JOIN na
--      `employees` uvnitř `app.rozdil_rozpisu`), ne `employee_id` —
--      žádný nový JOIN netřeba. `v_zprav` se počítá POŘÁD z průchodu
--      cyklem (jako dřív), ne z návratové hodnoty `app.notifikovat`:
--      `rozpis_nahled` slibuje počet ze stejného `app.rozdil_rozpisu`,
--      takže musí sedět s tím, co vydání skutečně ohlásí — přesně to,
--      čemu se migrace 20260901130000 v hlavičce vyhýbá. Žádný dedupe
--      klíč (jako dřív každé vydání založí NOVÝ záznam, i když předchozí
--      nepřečtené `rozpis.vydan` ještě leží).
--
--      Oprava (nález kontroly 29. 9. 2026, bod 7b níž v těle migrace):
--      `app.notifikovat` mlčky nezaloží nic zaměstnanci s pozastaveným
--      členstvím, ale `app.rozdil_rozpisu` to samo nevědělo — počítala
--      by ho `rozpis_nahled` i `v_zprav`, i když by mu reálně nedošlo
--      nic. `app.rozdil_rozpisu` teď žádá aktivní členství stejnou
--      podmínkou jako `app.notifikovat`, takže náhled i počet zpráv
--      sedí s tím, co se opravdu odešle.
--
--   8. Odmítnutí posílá `app.notifikovat` s druhem `smena.odmitnuta`,
--      prioritou `important` (vedoucí má zareagovat brzy, ale není to
--      `urgent` — nemá smysl budit ho ve dvě ráno kvůli směně za týden).
--
--   9. Generický audit trigger (`app.audit_zmenu`, 20260831020000) se
--      věší i na `smeny_potvrzeni` — stejný vzor jako `advances`
--      (20260901220000): tabulková stopa KAŽDÉ změny navíc k friendly
--      záznamu `smena.odmitnuta` na samotné směně (bod 4). Dnešní
--      `potvrdit_smenu` žádnou stopu nezakládá vůbec; tohle ji přidává,
--      aniž se sahá do těla funkce — trigger je na tabulce, ne ve
--      funkci, takže bod 2 (beze změny chování) platí doslovně na
--      vstup/výstup/chyby; přibývá jen řádek v `audit_log`.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ (mimo rozsah zadání)
--
--   * Potvrzení/odmítnutí „za zaměstnance" vedoucím. Zadání mluví jen
--     o tom, že si ČLOVĚK potvrdí/odmítne SVOJE směny.
--   * Žádná automatika vydávání rozpisu.
--   * Žádná změna práv/RLS mimo to, co je popsané výš — self-service
--     potvrzení/odmítnutí stojí na vlastnictví směny (jako dnes
--     `potvrdit_smenu`), čtení přehledu vedoucím na `shifts.manage`
--     (jako dnes čtení `smeny_potvrzeni` i `vydat_rozpis`).
--   * Notifikace „směna zase čeká" při návratu z odmítnutí/potvrzení
--     zpátky na opačný stav — zadání o tom nemluví a `potvrdit_smenu`
--     dnes taky žádnou zprávu při přepsání potvrzení neposílá.
--
-- Testováno v PGlite (node scripts/scenare-pglite.mjs) — RLS a sloupcové
-- granty ověří až CI proti PostgreSQL 16 (workflow „Migrace a scénáře").
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SMENY_POTVRZENI: ODMÍTNUTÍ JAKO VLASTNÍ STAV
-- ---------------------------------------------------------------------

alter table public.smeny_potvrzeni
  alter column confirmed_at drop not null;

alter table public.smeny_potvrzeni
  add column rejected_at     timestamptz,
  add column rejected_reason text not null default '';

comment on column public.smeny_potvrzeni.confirmed_at is
  'Kdy zaměstnanec směnu potvrdil. Prázdné u řádku, který nese odmítnutí '
  '(rejected_at) — právě jedno z obou je vyplněné, nikdy obě.';
comment on column public.smeny_potvrzeni.rejected_at is
  'Kdy zaměstnanec směnu odmítl. Vzájemně se vylučuje s confirmed_at '
  '(smeny_potvrzeni_stav_vyluka). Odmítnutí i potvrzení jde vzít zpět — '
  'nový zápis přepíše na opačný stav (viz app.zapsat_potvrzeni_smeny).';
comment on column public.smeny_potvrzeni.rejected_reason is
  'Důvod odmítnutí — povinný, kdykoli je rejected_at vyplněné '
  '(smeny_potvrzeni_duvod_povinny). Prázdný řetězec u potvrzeného řádku, '
  'ne NULL, ať se s ním dá počítat bez coalesce.';

alter table public.smeny_potvrzeni
  add constraint smeny_potvrzeni_stav_vyluka
  check (confirmed_at is null or rejected_at is null);

alter table public.smeny_potvrzeni
  add constraint smeny_potvrzeni_duvod_povinny
  check (rejected_at is null or length(btrim(rejected_reason)) > 0);

-- Grant zůstává beze změny: `grant select on public.smeny_potvrzeni to
-- authenticated` z 20260920120000 je na CELOU tabulku, ne sloupcový —
-- nové sloupce jsou čitelné bez dalšího grantu.


-- ---------------------------------------------------------------------
-- 2. JEDINÝ ZÁPIS DO SMENY_POTVRZENI
--
-- Nic nekontroluje kromě toho, ŽE JE volající za vlastníka směny
-- odpovědný — o tom se přesvědčí volající SÁM, dřív, se zamčeným
-- řádkem (viz hlavička, bod 2). `p_akce` je 'potvrzeno' nebo
-- 'odmitnuto'; opačný sloupec se vždy vynuluje, takže přepsání na
-- druhý stav je symetrické (bod 4 rozboru).
--
-- Idempotence (stejná jako dřív v `potvrdit_smenu`): potvrdí-li/odmítne-
-- li se TOTÉŽ znovu (stejný otisk, u odmítnutí i stejný důvod), čas se
-- nemění. Cokoli jiného — jiný otisk, nebo přepnutí na opačný stav —
-- dostane nový čas.
-- ---------------------------------------------------------------------

create function app.zapsat_potvrzeni_smeny(
  p_smena       public.shifts,
  p_zamestnanec uuid,
  p_akce        text,
  p_duvod       text default ''
)
returns public.smeny_potvrzeni
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zaznam public.smeny_potvrzeni;
  v_duvod  text := case when p_akce = 'odmitnuto' then coalesce(p_duvod, '') else '' end;
begin
  insert into public.smeny_potvrzeni as p (
    tenant_id, branch_id, shift_id, employee_id,
    shift_date, starts_at, ends_at, pauza_od, pauza_do,
    confirmed_at, rejected_at, rejected_reason
  ) values (
    p_smena.tenant_id, p_smena.branch_id, p_smena.id, p_zamestnanec,
    p_smena.shift_date, p_smena.starts_at, p_smena.ends_at, p_smena.pauza_od, p_smena.pauza_do,
    case when p_akce = 'potvrzeno' then now() end,
    case when p_akce = 'odmitnuto' then now() end,
    v_duvod
  )
  on conflict (shift_id, employee_id) do update set
    branch_id  = excluded.branch_id,
    shift_date = excluded.shift_date,
    starts_at  = excluded.starts_at,
    ends_at    = excluded.ends_at,
    pauza_od   = excluded.pauza_od,
    pauza_do   = excluded.pauza_do,
    confirmed_at = case
      when p_akce <> 'potvrzeno' then null
      when p.confirmed_at is not null
        and row(p.branch_id, p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
            is not distinct from
            row(excluded.branch_id, excluded.shift_date, excluded.starts_at, excluded.ends_at, excluded.pauza_od, excluded.pauza_do)
      then p.confirmed_at
      else now()
    end,
    rejected_at = case
      when p_akce <> 'odmitnuto' then null
      when p.rejected_at is not null
        and p.rejected_reason = excluded.rejected_reason
        and row(p.branch_id, p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
            is not distinct from
            row(excluded.branch_id, excluded.shift_date, excluded.starts_at, excluded.ends_at, excluded.pauza_od, excluded.pauza_do)
      then p.rejected_at
      else now()
    end,
    rejected_reason = excluded.rejected_reason
  returning p.* into v_zaznam;

  return v_zaznam;
end $$;

comment on function app.zapsat_potvrzeni_smeny(public.shifts, uuid, text, text) is
  'Jediné místo, které zapisuje do smeny_potvrzeni (insert/on conflict update '
  'podle aktuálního otisku směny). Nic nekontroluje — „je vydaná" hlídá '
  'KAŽDÝ VOLAJÍCÍ SÁM (stejná úvaha jako app.zapsat_potvrzeni_zalohy). '
  'p_akce: potvrzeno/odmitnuto — opačný sloupec se vždy vynuluje.';

revoke all on function app.zapsat_potvrzeni_smeny(public.shifts, uuid, text, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. POTVRDIT_SMENU — beze změny chování, jen vytažený zápis
--
-- Znak po znaku stejné kontroly a stejné pořadí chyb jako v
-- 20260920120000. Jediný rozdíl: poslední insert/on conflict nahrazuje
-- volání app.zapsat_potvrzeni_smeny.
-- ---------------------------------------------------------------------

create or replace function public.potvrdit_smenu(
  p_tenant   uuid,
  p_smena    uuid,
  p_den      date,
  p_od       time,
  p_do       time,
  p_pauza_od time default null,
  p_pauza_do time default null
)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp    uuid;
  v_s      public.shifts%rowtype;
  v_zaznam public.smeny_potvrzeni;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Směny v téhle firmě nemůžete potvrzovat.'
      using errcode = 'PT403';
  end if;

  select e.id into v_emp
    from public.employees e
   where e.tenant_id = p_tenant
     and e.user_id = (select auth.uid())
     and e.deleted_at is null
   limit 1;

  if v_emp is null then
    raise exception 'Nemáte v téhle firmě zaměstnanecký záznam.'
      using errcode = 'PT403';
  end if;

  select s.* into v_s
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant
     for share;

  if not found or v_s.employee_id is distinct from v_emp then
    raise exception 'Tuhle směnu nemůžete potvrdit.'
      using errcode = 'PT403';
  end if;

  if v_s.status = 'cancelled'
     or v_s.published_at is null
     or coalesce(v_s.published_status, '') = 'cancelled'
     or v_s.published_employee_id is distinct from v_s.employee_id
     or v_s.published_starts_at is distinct from v_s.starts_at
     or v_s.published_ends_at is distinct from v_s.ends_at then
    raise exception 'Směna ještě není vydaná, nebo se od vydání změnila. Potvrdit jde jen vydané znění.'
      using errcode = 'PT409';
  end if;

  if row(v_s.shift_date, v_s.starts_at, v_s.ends_at, v_s.pauza_od, v_s.pauza_do)
     is distinct from row(p_den, p_od, p_do, p_pauza_od, p_pauza_do) then
    raise exception 'Směna se mezitím změnila. Obnovte si ji a potvrďte znovu.'
      using errcode = 'PT409';
  end if;

  v_zaznam := app.zapsat_potvrzeni_smeny(v_s, v_emp, 'potvrzeno');

  return v_zaznam.confirmed_at;
end;
$$;

comment on function public.potvrdit_smenu(uuid, uuid, date, time, time, time, time) is
  'Zaměstnanec potvrdí SVOU vydanou směnu v tom znění, které vidí (den, časy, '
  'pauza). Zapíše opis směny přes app.zapsat_potvrzeni_smeny; potvrzení platí, '
  'dokud se směna s opisem shoduje. Chyby: PT403 nesmíš, PT409 nesedí stav.';

revoke all on function public.potvrdit_smenu(uuid, uuid, date, time, time, time, time) from public, anon;
grant execute on function public.potvrdit_smenu(uuid, uuid, date, time, time, time, time) to authenticated;


-- ---------------------------------------------------------------------
-- 4. POTVRDIT VŠECHNY MOJE SMĚNY
--
-- „Dosud nerozhodnuté": vydané směny volajícího, u kterých ŽÁDNÝ
-- existující řádek smeny_potvrzeni nemá rozhodnutí (confirmed_at nebo
-- rejected_at) SEDÍCÍ S AKTUÁLNÍM OTISKEM. Stará rozhodnutí, jejichž
-- otisk už nesedí (směna se změnila a znovu vydala), nepočítají —
-- takovou směnu je potřeba rozhodnout znovu, stejně jako jednotlivé
-- potvrdit_smenu.
-- ---------------------------------------------------------------------

create function public.potvrdit_vsechny_moje_smeny(p_tenant uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp   uuid;
  v_s     public.shifts%rowtype;
  v_pocet integer := 0;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Směny v téhle firmě nemůžete potvrzovat.'
      using errcode = 'PT403';
  end if;

  select e.id into v_emp
    from public.employees e
   where e.tenant_id = p_tenant
     and e.user_id = (select auth.uid())
     and e.deleted_at is null
   limit 1;

  if v_emp is null then
    raise exception 'Nemáte v téhle firmě zaměstnanecký záznam.'
      using errcode = 'PT403';
  end if;

  for v_s in
    select s.*
      from public.shifts s
     where s.tenant_id = p_tenant
       and s.employee_id = v_emp
       and s.status <> 'cancelled'
       and s.published_at is not null
       and coalesce(s.published_status, '') <> 'cancelled'
       and s.published_employee_id is not distinct from s.employee_id
       and s.published_starts_at is not distinct from s.starts_at
       and s.published_ends_at is not distinct from s.ends_at
       and not exists (
         select 1 from public.smeny_potvrzeni p
          where p.shift_id = s.id
            and p.employee_id = v_emp
            and (p.confirmed_at is not null or p.rejected_at is not null)
            and row(p.branch_id, p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
                is not distinct from
                row(s.branch_id, s.shift_date, s.starts_at, s.ends_at, s.pauza_od, s.pauza_do)
       )
     for update
  loop
    perform app.zapsat_potvrzeni_smeny(v_s, v_emp, 'potvrzeno');
    v_pocet := v_pocet + 1;
  end loop;

  return v_pocet;
end;
$$;

comment on function public.potvrdit_vsechny_moje_smeny(uuid) is
  'Potvrdí všechny vydané, dosud nerozhodnuté (ne potvrzené, ne odmítnuté pro '
  'aktuální otisk) směny volajícího v tenantovi. Vrací počet potvrzených.';

revoke all on function public.potvrdit_vsechny_moje_smeny(uuid) from public, anon;
grant execute on function public.potvrdit_vsechny_moje_smeny(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. ODMÍTNOUT SMĚNU
--
-- Bez „znění, které člověk vidí" parametrů (na rozdíl od potvrdit_smenu):
-- odmítnutí není tvrzení o konkrétním obsahu, jen že tuhle směnu člověk
-- nechce/nemůže vzít. Důvod povinný (bod 5 rozboru).
--
-- Notifikace jde lidem se shifts.manage NA POBOČCE SMĚNY
-- (app.kdo_ma_pravo_na_pobocce — vzor „ohlásit zapomenuté odchody",
-- 20260902080000), kromě volajícího — kdyby odmítal sám sobě jako
-- vedoucímu vlastní směnu, nemá dostat zprávu o vlastní akci.
-- ---------------------------------------------------------------------

create function public.odmitnout_smenu(
  p_tenant uuid,
  p_smena  uuid,
  p_duvod  text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp    uuid;
  v_s      public.shifts%rowtype;
  v_zaznam public.smeny_potvrzeni;
  v_duvod  text := btrim(coalesce(p_duvod, ''));
  v_r      record;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Směny v téhle firmě nemůžete odmítat.'
      using errcode = 'PT403';
  end if;

  if length(v_duvod) = 0 then
    raise exception 'Napište důvod odmítnutí — bez něj vedoucí neví, co se stalo.'
      using errcode = 'check_violation';
  end if;

  select e.id into v_emp
    from public.employees e
   where e.tenant_id = p_tenant
     and e.user_id = (select auth.uid())
     and e.deleted_at is null
   limit 1;

  if v_emp is null then
    raise exception 'Nemáte v téhle firmě zaměstnanecký záznam.'
      using errcode = 'PT403';
  end if;

  select s.* into v_s
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant
     for share;

  if not found or v_s.employee_id is distinct from v_emp then
    raise exception 'Tuhle směnu nemůžete odmítnout.'
      using errcode = 'PT403';
  end if;

  if v_s.status = 'cancelled'
     or v_s.published_at is null
     or coalesce(v_s.published_status, '') = 'cancelled'
     or v_s.published_employee_id is distinct from v_s.employee_id
     or v_s.published_starts_at is distinct from v_s.starts_at
     or v_s.published_ends_at is distinct from v_s.ends_at then
    raise exception 'Směna ještě není vydaná, nebo se od vydání změnila. Odmítnout jde jen vydané znění.'
      using errcode = 'PT409';
  end if;

  v_zaznam := app.zapsat_potvrzeni_smeny(v_s, v_emp, 'odmitnuto', v_duvod);

  perform app.audit(
    p_tenant, 'smena.odmitnuta', 'shift', v_s.id::text, v_s.branch_id,
    null, jsonb_build_object('duvod', v_duvod)
  );

  for v_r in
    select k.user_id
      from app.kdo_ma_pravo_na_pobocce(p_tenant, 'shifts.manage', v_s.branch_id) k
     where k.user_id is distinct from (select auth.uid())
  loop
    perform app.notifikovat(
      p_tenant, v_r.user_id, 'smena.odmitnuta',
      jsonb_build_object(
        'smena', v_s.id,
        'den',   v_s.shift_date,
        'od',    to_char(v_s.starts_at, 'HH24:MI'),
        'do',    to_char(v_s.ends_at, 'HH24:MI'),
        'duvod', v_duvod
      ),
      'important', v_s.branch_id, v_s.id, 'smena', v_s.id, null
    );
  end loop;

  return v_zaznam.id;
end;
$$;

comment on function public.odmitnout_smenu(uuid, uuid, text) is
  'Zaměstnanec odmítne SVOU vydanou směnu s povinným důvodem. Notifikuje '
  '(app.notifikovat, smena.odmitnuta) lidi se shifts.manage na pobočce směny, '
  'kromě volajícího. Chyby: PT403 nesmíš, PT409 nesedí stav, check_violation '
  'chybí důvod. Vrací id záznamu v smeny_potvrzeni.';

revoke all on function public.odmitnout_smenu(uuid, uuid, text) from public, anon;
grant execute on function public.odmitnout_smenu(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. MOJE SMĚNY K POTVRZENÍ
--
-- Okno: posledních 14 dní a bez horní meze do budoucna (vlastní
-- rozhodnutí — viz hlavička souboru). Datum se počítá prostým
-- current_date, ne app.business_date té které pobočky: seznam „co mám
-- rozhodnout" nepotřebuje přesnost na provozní den, jen rozumné okno.
-- ---------------------------------------------------------------------

create function public.moje_smeny_k_potvrzeni(p_tenant uuid)
returns table (
  shift_id        uuid,
  branch_id       uuid,
  pobocka         text,
  shift_date      date,
  starts_at       time,
  ends_at         time,
  pauza_od        time,
  pauza_do        time,
  stav            text,
  confirmed_at    timestamptz,
  rejected_at     timestamptz,
  rejected_reason text
)
language sql stable security definer set search_path = ''
as $$
  select
    s.id, s.branch_id, b.name, s.shift_date, s.starts_at, s.ends_at,
    s.pauza_od, s.pauza_do,
    case
      when p.confirmed_at is not null then 'potvrzeno'
      when p.rejected_at  is not null then 'odmitnuto'
      else 'ceka'
    end,
    p.confirmed_at,
    p.rejected_at,
    nullif(p.rejected_reason, '')
  from public.shifts s
  join public.branches b  on b.id = s.branch_id
  join public.employees e on e.id = s.employee_id
  left join public.smeny_potvrzeni p
    on p.shift_id = s.id
   and p.employee_id = s.employee_id
   and row(p.branch_id, p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
       is not distinct from
       row(s.branch_id, s.shift_date, s.starts_at, s.ends_at, s.pauza_od, s.pauza_do)
  where s.tenant_id = p_tenant
    and e.tenant_id = p_tenant
    and e.user_id = (select auth.uid())
    and e.deleted_at is null
    and app.modul_zapnuty(p_tenant, 'provoz')
    and s.status <> 'cancelled'
    and s.published_at is not null
    and coalesce(s.published_status, '') <> 'cancelled'
    and s.published_employee_id is not distinct from s.employee_id
    and s.published_starts_at is not distinct from s.starts_at
    and s.published_ends_at is not distinct from s.ends_at
    and s.shift_date >= current_date - 14
  order by s.shift_date, s.starts_at;
$$;

comment on function public.moje_smeny_k_potvrzeni(uuid) is
  'Vydané směny volajícího za posledních 14 dní a bez horní meze do budoucna, '
  'se stavem (ceka/potvrzeno/odmitnuto) a důvodem odmítnutí. Karta „čekají na '
  'mě" — vzor moje_nepotvrzene_zalohy.';

revoke all on function public.moje_smeny_k_potvrzeni(uuid) from public, anon;
grant execute on function public.moje_smeny_k_potvrzeni(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. PŘEHLED PRO VEDOUCÍHO/MAJITELE
--
-- Vzor zalohy_pobocky: bez přístupu (shifts.manage na p_branch) vrátí
-- tiše prázdno, ne chybu — kdo nemá právo, se nedozví ani to, jestli na
-- pobočce nějaké vydané směny jsou.
-- ---------------------------------------------------------------------

create function public.smeny_potvrzeni_pobocky(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  shift_id        uuid,
  employee_id     uuid,
  jmeno           text,
  shift_date      date,
  starts_at       time,
  ends_at         time,
  stav            text,
  rozhodnuto_kdy  timestamptz,
  rejected_reason text
)
language sql stable security definer set search_path = ''
as $$
  select
    s.id, s.employee_id, e.full_name, s.shift_date, s.starts_at, s.ends_at,
    case
      when p.confirmed_at is not null then 'potvrzeno'
      when p.rejected_at  is not null then 'odmitnuto'
      else 'ceka'
    end,
    coalesce(p.confirmed_at, p.rejected_at),
    nullif(p.rejected_reason, '')
  from public.shifts s
  join public.employees e on e.id = s.employee_id
  left join public.smeny_potvrzeni p
    on p.shift_id = s.id
   and p.employee_id = s.employee_id
   and row(p.branch_id, p.shift_date, p.starts_at, p.ends_at, p.pauza_od, p.pauza_do)
       is not distinct from
       row(s.branch_id, s.shift_date, s.starts_at, s.ends_at, s.pauza_od, s.pauza_do)
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and s.employee_id is not null
    and e.deleted_at is null
    and s.status <> 'cancelled'
    and s.published_at is not null
    and coalesce(s.published_status, '') <> 'cancelled'
    and s.published_employee_id is not distinct from s.employee_id
    and s.published_starts_at is not distinct from s.starts_at
    and s.published_ends_at is not distinct from s.ends_at
    and app.has_access(p_tenant, 'shifts.manage', p_branch)
  order by s.shift_date, s.starts_at, e.full_name;
$$;

comment on function public.smeny_potvrzeni_pobocky(uuid, uuid, date, date) is
  'Pro vedoucího/majitele (shifts.manage): pro každou vydanou směnu v období '
  'na téhle pobočce stav potvrzení a kdo/kdy. Bez práva tiše prázdno, jako '
  'zalohy_pobocky.';

revoke all on function public.smeny_potvrzeni_pobocky(uuid, uuid, date, date) from public, anon;
grant execute on function public.smeny_potvrzeni_pobocky(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 7b. ROZDIL_ROZPISU — náhled a počet zpráv sjednocené s tím, kdo
--     zprávu OPRAVDU dostane
--
-- Nález nezávislé kontroly 29. 9. 2026: `app.notifikovat` (20260921100000)
-- mlčky nezaloží nic zaměstnanci s pozastaveným členstvím (memberships.
-- status <> 'active') — zaměstnanecký řádek po pozastavení zůstává,
-- takže `app.rozdil_rozpisu` ho beze změny dál počítal. Výsledek: `public.
-- rozpis_nahled` sliboval „odejde N zpráv M lidem" a `v_zprav` z bodu 8
-- (počítaný z téhož průchodu) totéž POTVRZOVAL, ale reálně by pozastavenému
-- členovi nedošlo nic — přesně to, čemu se tahle migrace (a předtím
-- 20260901130000) měla vyhýbat.
--
-- Oprava je na zdroji: `app.rozdil_rozpisu` teď žádá AKTIVNÍ členství
-- stejnou podmínkou jako `app.notifikovat` (`m.status = 'active'`, vzor
-- napříč repozitářem — authz.sql, api_authz.sql, kdo_ma_pravo_na_pobocce
-- a další). `rozpis_nahled` i `v_zprav` v `vydat_rozpis` (bod 8, beze
-- změny těla) čerpají ze stejné funkce, takže se spraví oba najednou a
-- zůstávají navzájem sjednocené, jak hlavička slibuje.
--
-- Beze změny: kdo dřív nefiguroval (zaměstnanec bez `user_id`, smazaný),
-- pořád nefiguruje — jen přibyla JEDNA podmínka navíc, na obě větve
-- `union all` stejně (nová i „odebraná" směna).
-- ---------------------------------------------------------------------

create or replace function app.rozdil_rozpisu(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  shift_id    uuid,
  employee_id uuid,
  user_id     uuid,
  zmena       text,
  shift_date  date,
  starts_at   time,
  ends_at     time,
  drive_od    time,
  drive_do    time
)
language sql stable security definer set search_path = ''
as $$
  -- Nové a změněné: bere se dnešní stav a porovnává se s vydaným.
  select
    s.id,
    s.employee_id,
    e.user_id,
    case
      when s.status = 'cancelled'                                 then 'zrusena'
      when s.published_at is null                                 then 'nova'
      -- Byla zrušená a je zase zpátky. Pro člověka je to nová směna:
      -- naposled se dozvěděl, že nikam nemusí.
      when s.published_status = 'cancelled'                       then 'nova'
      when s.published_employee_id is distinct from s.employee_id then 'prevzata'
      when s.published_starts_at is distinct from s.starts_at
        or s.published_ends_at is distinct from s.ends_at         then 'cas'
      else null
    end,
    s.shift_date,
    s.starts_at,
    s.ends_at,
    s.published_starts_at,
    s.published_ends_at
  from public.shifts s
  join public.employees e   on e.id = s.employee_id
  join public.memberships m on m.tenant_id = e.tenant_id
                            and m.user_id   = e.user_id
                            and m.status    = 'active'
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and e.user_id is not null
    and e.deleted_at is null
    -- Nevydaná zrušená směna nikoho nezajímá: nikdy o ní nevěděl.
    and not (s.published_at is null and s.status = 'cancelled')
    -- Zrušení se hlásí JEDNOU. Bez tohohle by každé další vydání
    -- ohlásilo tutéž zrušenou směnu znovu a „vydání beze změn nerozešle
    -- nic" by přestalo platit u každé pobočky, kde se kdy něco zrušilo.
    and not (s.status = 'cancelled' and s.published_status = 'cancelled')
    and (
      s.published_at is null
      or s.status = 'cancelled'
      or s.published_status = 'cancelled'
      or s.published_employee_id is distinct from s.employee_id
      or s.published_starts_at is distinct from s.starts_at
      or s.published_ends_at is distinct from s.ends_at
    )

  union all

  -- Komu směnu vzali. Ten se to jinak nedozví: jeho jméno už na směně
  -- není, takže by v dotazu výš nikde nefiguroval.
  select
    s.id,
    s.published_employee_id,
    e.user_id,
    'odebrana',
    s.shift_date,
    s.starts_at,
    s.ends_at,
    s.published_starts_at,
    s.published_ends_at
  from public.shifts s
  join public.employees e   on e.id = s.published_employee_id
  join public.memberships m on m.tenant_id = e.tenant_id
                            and m.user_id   = e.user_id
                            and m.status    = 'active'
  where s.tenant_id = p_tenant
    and s.branch_id = p_branch
    and s.shift_date between p_od and p_do
    and s.published_at is not null
    and s.published_employee_id is not null
    and s.published_employee_id is distinct from s.employee_id
    and e.user_id is not null
    and e.deleted_at is null;
$$;

revoke all on function app.rozdil_rozpisu(uuid, uuid, date, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. VYDAT_ROZPIS — hromadná notifikace centrální cestou
--
-- Tělo z 20260901130000 beze změny KROMĚ posledního insertu (viz
-- hlavička, bod 7). v_radek.user_id je už profiles.user_id (JOIN na
-- employees uvnitř app.rozdil_rozpisu) — app.notifikovat chce přesně
-- tohle, žádný nový JOIN netřeba. `app.rozdil_rozpisu` sama teď navíc
-- žádá aktivní členství (bod 7b výš), takže se počet i náhled shodují
-- s tím, kdo notifikaci opravdu dostane.
-- ---------------------------------------------------------------------

create or replace function public.vydat_rozpis(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_zprav  integer := 0;
  v_radek  record;
begin
  if not app.has_access(p_tenant, 'shifts.manage', p_branch) then
    raise exception 'Vydat rozpis smí jen ten, kdo plánuje směny na téhle pobočce.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_do < p_od then
    raise exception 'Období je obráceně.' using errcode = 'check_violation';
  end if;

  for v_radek in
    select
      r.user_id,
      jsonb_agg(jsonb_build_object(
        'den',    r.shift_date,
        'zmena',  r.zmena,
        'od',     r.starts_at,
        'do',     r.ends_at,
        'drive_od', r.drive_od,
        'drive_do', r.drive_do
      ) order by r.shift_date) as polozky
    from app.rozdil_rozpisu(p_tenant, p_branch, p_od, p_do) r
    where r.zmena is not null
      and r.user_id <> (select auth.uid())
    group by r.user_id
  loop
    -- 29. 9. 2026: centrální cesta (app.notifikovat) místo přímého
    -- insertu — teprve tudy jde push na telefon (fronta doručení).
    -- Počítá se z průchodu cyklem, ne z návratu app.notifikovat, ať
    -- vždycky sedí s tím, co slíbil rozpis_nahled (viz hlavička, bod 7).
    perform app.notifikovat(
      p_tenant,
      v_radek.user_id,
      'rozpis.vydan',
      jsonb_build_object('od', p_od, 'do', p_do, 'zmeny', v_radek.polozky),
      'normal',
      p_branch
    );
    v_zprav := v_zprav + 1;
  end loop;

  update public.shifts s
     set published_at          = now(),
         published_employee_id = s.employee_id,
         published_starts_at   = s.starts_at,
         published_ends_at     = s.ends_at,
         published_status      = s.status
   where s.tenant_id = p_tenant
     and s.branch_id = p_branch
     and s.shift_date between p_od and p_do;

  perform app.audit(
    p_tenant, 'rozpis.vydan', 'shift_publication', null, p_branch,
    null,
    jsonb_build_object('od', p_od, 'do', p_do, 'zprav', v_zprav)
  );

  return v_zprav;
end;
$$;

comment on function public.vydat_rozpis(uuid, uuid, date, date) is
  'Vydá rozpis pobočky za období a rozešle upozornění centrální cestou '
  '(app.notifikovat — push na telefon). Jedna zpráva na člověka, jen jeho '
  'směny, a tomu, kdo vydává, nechodí nic.';

revoke all on function public.vydat_rozpis(uuid, uuid, date, date) from public, anon;
grant execute on function public.vydat_rozpis(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 9. AUDIT — stejný vzor jako advances (20260901220000)
--
-- Tabulková stopa KAŽDÉ změny (insert/update — delete se nikdy neděje,
-- žádná cesta ho nemá, ale trigger je tu pro shodu se vzorem a jako
-- pojistka, kdyby v budoucnu vznikl). Doplňuje friendly záznam
-- smena.odmitnuta z bodu 5, který visí na samotné směně, ne na
-- potvrzovací tabulce.
-- ---------------------------------------------------------------------

create trigger trg_audit_smeny_potvrzeni
  after insert or update or delete on public.smeny_potvrzeni
  for each row execute function app.audit_zmenu('smena_potvrzeni');
