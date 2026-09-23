-- Checklisty 2.0, vrstva B krok 5 — RPC: zápis položky, uzavření, dvojí
-- kontrola, editace šablony.
--
-- Nahrazuje přímé .update()/.upsert() volání v app/[rozsah]/ukoly/akce.ts
-- jedním místem pravdy pro každé z nich — souběh, stav „hotovo
-- s výhradami", povinné položky, zákaz sebepotvrzení a verzování šablon
-- jsou logika, která nesmí být rozjetá mezi TS a databází.
--
-- ---------------------------------------------------------------------
-- POLOŽKY BĚHU SE ČTOU Z JEHO VERZE
--
-- Běh má od 20260923140000 verzi šablony (sablona_verze_id). Co do běhu
-- patří, jaké má položka meze a jestli je povinná, se proto bere z TÉ
-- verze, ne z dnešních živých řádků — úprava šablony po spuštění nesmí
-- změnit pravidla rozdělaného ani hotového běhu. Jen běhy starší než
-- verzování (sablona_verze_id NULL) čtou živé položky.
--
-- ---------------------------------------------------------------------
-- FILTR FIRMY `r.tenant_id = p_tenant` NENÍ NADBYTEČNÝ
--
-- app.has_access pro členství s rozsahem celé firmy vrací true pro
-- JAKOUKOLI pobočku — i pobočku cizí firmy. Bez filtru by vedoucí firmy
-- A s p_tenant = A sahal na běh firmy B. Scénáře krok49–52 to zkoušejí
-- právě takovým uživatelem.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. VLASTNOSTI POLOŽKY V BĚHU
--
-- Jedno místo, které říká „jak položka vypadá v tomhle běhu" — z verze
-- běhu, nebo (starý běh bez verze) z živého řádku. Prázdno = položka do
-- běhu nepatří.
-- ---------------------------------------------------------------------

create or replace function app.polozka_behu(p_run uuid, p_item uuid)
returns table (
  label          text,
  requires_value boolean,
  value_type     text,
  min_value      numeric,
  max_value      numeric,
  povinna        boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_verze   uuid;
  v_sablona uuid;
begin
  select r.sablona_verze_id, r.template_id into v_verze, v_sablona
    from public.checklist_runs r where r.id = p_run;

  if v_verze is not null then
    return query
      select p->>'label',
             coalesce((p->>'requires_value')::boolean, false),
             p->>'value_type',
             (p->>'min_value')::numeric,
             (p->>'max_value')::numeric,
             coalesce((p->>'povinna')::boolean, true)
        from public.checklist_sablona_verze v
        cross join lateral jsonb_array_elements(v.polozky) p
       where v.id = v_verze and p->>'id' = p_item::text;
  else
    return query
      select i.label, i.requires_value, i.value_type, i.min_value, i.max_value, i.povinna
        from public.checklist_items i
       where i.id = p_item and i.template_id = v_sablona;
  end if;
end $$;

revoke all on function app.polozka_behu(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. ZAPSAT_POLOZKU_CHECKLISTU
--
-- Tři způsoby zápisu jedné položky:
--   * splnit (výchozí) — s hodnotou, když ji položka chce; meze a typ se
--     berou z verze běhu, ne od volajícího,
--   * p_nelze_splnit — „nelze splnit" s důvodem; jiný stav než
--     nezaškrtnuto (zadání bod 20),
--   * p_zrusit — vrátit položku zpět na nezaškrtnutou (zadání bod 45,
--     „item reopened"); poznámka zůstává.
-- Poznámka se ukládá, ať je stav jakýkoli. p_note NULL = nechat, jak je
-- (rychlé odškrtnutí z řádku seznamu poznámku nenese a nesmí ji smazat).
--
-- NAHLÁŠENÝ PROBLÉM: když položka NOVĚ přejde na „nelze splnit", dostanou
-- vedoucí pobočky (tasks.manage, kromě zapisujícího) upozornění hned —
-- zaměstnanec, který úkol zadat nesmí, tak problém nahlásí aspoň takhle
-- (zadání body 20 a 32). V upozornění je jen název položky, ne důvod —
-- text psaný člověkem se do upozornění nedává (zásada app.notifikovat).
--
-- Do UZAVŘENÉHO běhu se nezapisuje — historie je neměnná (bod 24).
--
-- SOUBĚH: zastaralá p_ocekavana_verze vrátí serialization_failure (40001)
-- — odlišitelný kód, aby klient poznal „někdo to mezitím změnil" od
-- ostatních check_violation bez porovnávání textu hlášky. NULL = klient
-- verzi nezná (první zápis), kontrola se přeskočí.
-- ---------------------------------------------------------------------

create or replace function public.zapsat_polozku_checklistu(
  p_tenant             uuid,
  p_run                uuid,
  p_item               uuid,
  p_hodnota            text    default null,
  p_note               text    default null,
  p_nelze_splnit       boolean default false,
  p_nelze_splnit_duvod text    default '',
  p_ocekavana_verze    integer default null,
  p_zrusit             boolean default false
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch       uuid;
  v_status       text;
  v_item         record;
  v_nalezena     boolean := false;
  v_stara_verze  integer;
  v_stary_nelze  boolean := false;
  v_rec          record;
  v_checked      boolean;
  v_nelze        boolean;
  v_duvod        text;
  v_value_number numeric;
  v_value_text   text;
  v_nova_verze   integer;
begin
  select r.branch_id, r.status
    into v_branch, v_status
    from public.checklist_runs r
   where r.id = p_run and r.tenant_id = p_tenant;

  if v_branch is null or not app.has_access(p_tenant, 'tasks.read', v_branch) then
    raise exception 'K tomuhle checklistu nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'open' then
    raise exception 'Uzavřený checklist už nejde měnit.'
      using errcode = 'check_violation';
  end if;

  for v_item in select * from app.polozka_behu(p_run, p_item) loop
    v_nalezena := true;
  end loop;

  if not v_nalezena then
    raise exception 'Ta položka k tomuhle checklistu nepatří.'
      using errcode = 'check_violation';
  end if;

  select e.verze, e.nelze_splnit into v_stara_verze, v_stary_nelze
    from public.checklist_entries e
   where e.run_id = p_run and e.item_id = p_item;

  if found and p_ocekavana_verze is not null
     and v_stara_verze is distinct from p_ocekavana_verze then
    raise exception 'Někdo jiný mezitím tuhle položku upravil. Načtěte prosím aktuální stav.'
      using errcode = 'serialization_failure';
  end if;

  if coalesce(p_zrusit, false) then
    v_checked := false;
    v_nelze := false;
    v_duvod := '';
  elsif coalesce(p_nelze_splnit, false) then
    if coalesce(btrim(p_nelze_splnit_duvod), '') = '' then
      raise exception 'U „nelze splnit" napište důvod.' using errcode = 'check_violation';
    end if;
    v_checked := false;
    v_nelze := true;
    v_duvod := left(btrim(p_nelze_splnit_duvod), 500);
  else
    v_checked := true;
    v_nelze := false;
    v_duvod := '';
    if v_item.requires_value then
      if v_item.value_type = 'photo' then
        if not exists (
          select 1 from public.checklist_polozka_fotky f
           where f.run_id = p_run and f.item_id = p_item
        ) then
          raise exception 'Položka vyžaduje aspoň jednu fotku.' using errcode = 'check_violation';
        end if;
      elsif coalesce(btrim(p_hodnota), '') = '' then
        raise exception 'Hodnota je povinná.' using errcode = 'check_violation';
      elsif v_item.value_type = 'number' then
        begin
          v_value_number := replace(btrim(p_hodnota), ',', '.')::numeric;
        exception when invalid_text_representation then
          raise exception 'Zadejte platné číslo.' using errcode = 'check_violation';
        end;
        if (v_item.min_value is not null and v_value_number < v_item.min_value)
           or (v_item.max_value is not null and v_value_number > v_item.max_value) then
          raise exception 'Hodnota je mimo povolené meze.' using errcode = 'check_violation';
        end if;
      elsif v_item.value_type = 'text' then
        v_value_text := left(btrim(p_hodnota), 500);
      end if;
    end if;
  end if;

  insert into public.checklist_entries
    (run_id, item_id, checked, value_number, value_text, employee_id, recorded_at,
     note, nelze_splnit, nelze_splnit_duvod, verze)
  values
    (p_run, p_item, v_checked, v_value_number, v_value_text, app.muj_employee(p_tenant), now(),
     left(coalesce(p_note, ''), 500), v_nelze, v_duvod, 1)
  on conflict (run_id, item_id) do update set
    checked            = excluded.checked,
    value_number       = excluded.value_number,
    value_text         = excluded.value_text,
    employee_id        = excluded.employee_id,
    recorded_at        = excluded.recorded_at,
    note               = case when p_note is null then checklist_entries.note else excluded.note end,
    nelze_splnit       = excluded.nelze_splnit,
    nelze_splnit_duvod = excluded.nelze_splnit_duvod,
    verze              = checklist_entries.verze + 1
  returning verze into v_nova_verze;

  if v_nelze and not coalesce(v_stary_nelze, false) then
    for v_rec in
      select k.user_id from app.kdo_ma_pravo_na_pobocce(p_tenant, 'tasks.manage', v_branch) k
       where k.user_id is distinct from (select auth.uid())
    loop
      perform app.notifikovat(
        p_tenant, v_rec.user_id, 'checklist.problem',
        app.checklist_telo(p_run)
          || jsonb_build_object('polozka', p_item, 'polozka_nazev', left(v_item.label, 120)),
        'important', v_branch, null, 'checklist_run', p_run,
        'checklist.problem:' || p_run::text || ':' || p_item::text
      );
    end loop;
  end if;

  return v_nova_verze;
end;
$$;

comment on function public.zapsat_polozku_checklistu(
  uuid, uuid, uuid, text, text, boolean, text, integer, boolean) is
  'Zapíše položku checklistu: splnit / nelze splnit / vrátit. Meze a typ '
  'z verze běhu. Uzavřený běh odmítne. Zastaralá p_ocekavana_verze vrací '
  'serialization_failure (40001).';

revoke all on function public.zapsat_polozku_checklistu(
  uuid, uuid, uuid, text, text, boolean, text, integer, boolean) from public, anon;
grant execute on function public.zapsat_polozku_checklistu(
  uuid, uuid, uuid, text, text, boolean, text, integer, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 1b. TĚLO UPOZORNĚNÍ NA CHECKLIST
--
-- Jeden tvar pro všechny checklist.* druhy (uzavření, termíny,
-- přidělení): id běhu, název šablony, slug pobočky (odkaz vede na
-- pobočku běhu, ne na rozsah, ve kterém člověk zrovna upozornění čte)
-- a termín jako hodina na zdi v pásmu pobočky. Žádný obsah položek ani
-- poznámek — upozornění nese jen holé údaje (zásada app.notifikovat).
-- ---------------------------------------------------------------------

create or replace function app.checklist_telo(p_run uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'beh', r.id,
           'nazev', left(t.name, 120),
           'pobocka_slug', b.slug,
           'termin', case when r.due_at is not null
                       then to_char(r.due_at at time zone app.zona_pobocky(r.branch_id),
                                    'YYYY-MM-DD"T"HH24:MI')
                     end))
    from public.checklist_runs r
    join public.checklist_templates t on t.id = r.template_id
    join public.branches b on b.id = r.branch_id
   where r.id = p_run;
$$;

revoke all on function app.checklist_telo(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. UZAVRIT_CHECKLIST
--
-- * Povinné položky (podle verze běhu) musí být splněné, nebo označené
--   „nelze splnit" s důvodem — jinak se běh neuzavře (zadání bod 26).
-- * Stav počítá databáze: existuje-li „nelze splnit", je výsledek
--   completed_with_issues, jinak done. Meze se tu znovu nekontrolují —
--   hodnota mimo meze se do běhu vůbec nezapíše (zapsat_polozku_checklistu),
--   takže v hotových datech být nemůže.
-- ---------------------------------------------------------------------

create or replace function public.uzavrit_checklist(p_tenant uuid, p_run uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch        uuid;
  v_sablona       uuid;
  v_verze         uuid;
  v_status        text;
  v_assigned      uuid;
  v_chybi         integer;
  v_ma_problem    boolean;
  v_dotazuje      boolean;
  v_ja            uuid;
  v_vysledek      text;
  v_prijemce_user uuid;
  v_rec           record;
begin
  select r.branch_id, r.template_id, r.sablona_verze_id, r.status, r.assigned_employee_id
    into v_branch, v_sablona, v_verze, v_status, v_assigned
    from public.checklist_runs r
   where r.id = p_run and r.tenant_id = p_tenant;

  if v_branch is null or not app.has_access(p_tenant, 'tasks.read', v_branch) then
    raise exception 'K tomuhle checklistu nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'open' then
    raise exception 'Checklist už je uzavřený.' using errcode = 'check_violation';
  end if;

  if v_verze is not null then
    select count(*) into v_chybi
      from public.checklist_sablona_verze v
      cross join lateral jsonb_array_elements(v.polozky) p
     where v.id = v_verze
       and coalesce((p->>'povinna')::boolean, true)
       and not exists (
         select 1 from public.checklist_entries e
          where e.run_id = p_run and e.item_id = (p->>'id')::uuid
            and (e.checked or e.nelze_splnit));
  else
    select count(*) into v_chybi
      from public.checklist_items i
     where i.template_id = v_sablona and i.active and i.povinna
       and not exists (
         select 1 from public.checklist_entries e
          where e.run_id = p_run and e.item_id = i.id
            and (e.checked or e.nelze_splnit));
  end if;

  if v_chybi > 0 then
    raise exception 'Nejdřív vyřešte povinné položky (zbývá %) — splňte je, nebo označte „nelze splnit".', v_chybi
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.checklist_entries e
     where e.run_id = p_run and e.nelze_splnit
  ) into v_ma_problem;

  v_ja := app.muj_employee(p_tenant);
  v_vysledek := case when v_ma_problem then 'completed_with_issues' else 'done' end;

  select t.vyzaduje_potvrzeni into v_dotazuje
    from public.checklist_templates t where t.id = v_sablona;

  update public.checklist_runs
     set status = v_vysledek, finished_at = now(), completed_by = v_ja
   where id = p_run;

  perform app.audit(
    p_tenant, 'checklist.uzavren', 'checklist_run', p_run::text, v_branch,
    null, jsonb_build_object('stav', v_vysledek)
  );

  -- UPOZORNĚNÍ — kdo se o uzavření dozví:
  --
  --  * Přiřazený, když běh zavřel NĚKDO JINÝ („tvůj checklist uzavřela
  --    Petra"). Kdo zavřel sám sobě přiřazený běh, upozornění nedostane —
  --    ví to, právě to udělal.
  --  * Vyžaduje-li šablona potvrzení: všichni s tasks.manage na pobočce
  --    kromě uzavírajícího (pravidlo čtyř očí; zdroj práva je
  --    app.kdo_ma_pravo_na_pobocce, jako jinde v appce).
  --  * Jinak, skončil-li běh S VÝHRADAMI: titíž vedoucí, jako důležité —
  --    „nelze splnit" nesmí zapadnout jen proto, že šablona potvrzení
  --    nevyžaduje.
  --  * Běžné dokončení bez výhrad vedoucím nechodí (není co hlásit; stejná
  --    úvaha jako „žádné upozornění na úspěšné zveřejnění" v marketingu).
  --
  -- Klíč slučování je jeden na běh a druh, takže vedoucí, který je zároveň
  -- přiřazený, dostane jedno upozornění, ne dvě.
  if v_assigned is not null and v_assigned is distinct from v_ja then
    select e.user_id into v_prijemce_user
      from public.employees e where e.id = v_assigned;
    if v_prijemce_user is not null then
      perform app.notifikovat(
        p_tenant, v_prijemce_user, 'checklist.dokonceno',
        app.checklist_telo(p_run) || jsonb_build_object('stav', v_vysledek),
        case when v_vysledek = 'completed_with_issues' then 'important' else 'normal' end,
        v_branch, null, 'checklist_run', p_run,
        'checklist.dokonceno:' || p_run::text
      );
    end if;
  end if;

  if v_dotazuje or v_vysledek = 'completed_with_issues' then
    for v_rec in
      select k.user_id from app.kdo_ma_pravo_na_pobocce(p_tenant, 'tasks.manage', v_branch) k
       where k.user_id is distinct from (select auth.uid())
    loop
      perform app.notifikovat(
        p_tenant, v_rec.user_id,
        case when v_dotazuje then 'checklist.vyzaduje_kontrolu' else 'checklist.dokonceno' end,
        app.checklist_telo(p_run) || jsonb_build_object('stav', v_vysledek),
        'important', v_branch, null, 'checklist_run', p_run,
        case when v_dotazuje then 'checklist.vyzaduje_kontrolu:' else 'checklist.dokonceno:' end
          || p_run::text
      );
    end loop;
  end if;

  return v_vysledek;
end;
$$;

comment on function public.uzavrit_checklist(uuid, uuid) is
  'Uzavře běh checklistu. Povinné položky musí být vyřešené. Stav '
  '(done/completed_with_issues) počítá sama. Upozorní přiřazeného '
  '(zavřel-li jiný) a vedoucí (potvrzení, nebo výhrady).';

revoke all on function public.uzavrit_checklist(uuid, uuid) from public, anon;
grant execute on function public.uzavrit_checklist(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. POTVRDIT_CHECKLIST
--
-- Dvojí kontrola: kdo běh dokončil, ho nesmí sám potvrdit — jinak by
-- "dvojí" znamenalo totéž jedno kliknutí dvakrát.
-- ---------------------------------------------------------------------

create or replace function public.potvrdit_checklist(p_tenant uuid, p_run uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch    uuid;
  v_status    text;
  v_completed uuid;
  v_ja        uuid;
begin
  select r.branch_id, r.status, r.completed_by
    into v_branch, v_status, v_completed
    from public.checklist_runs r
   where r.id = p_run and r.tenant_id = p_tenant;

  if v_branch is null or not app.has_access(p_tenant, 'tasks.manage', v_branch) then
    raise exception 'Potvrzovat checklisty na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status not in ('done', 'completed_with_issues') then
    raise exception 'Nedokončený checklist nelze potvrdit.' using errcode = 'check_violation';
  end if;

  v_ja := app.muj_employee(p_tenant);

  -- ROZHODNOUT: sebepotvrzení zakázané (docs/hlaseni/otazky.md, otázka 12).
  if v_ja is not null and v_ja is not distinct from v_completed then
    raise exception 'Kdo checklist dokončil, ho nemůže sám potvrdit.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.checklist_runs
     set potvrdil_kym = v_ja, potvrzeno_kdy = now()
   where id = p_run;

  perform app.audit(p_tenant, 'checklist.potvrzen', 'checklist_run', p_run::text, v_branch);
end;
$$;

comment on function public.potvrdit_checklist(uuid, uuid) is
  'Manažerské potvrzení dokončeného běhu. Kdo běh dokončil (completed_by), '
  'ho potvrdit nemůže — dvojí kontrola potřebuje dva lidi, ne dvě kliknutí.';

revoke all on function public.potvrdit_checklist(uuid, uuid) from public, anon;
grant execute on function public.potvrdit_checklist(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. UPRAVIT_SABLONU_CHECKLISTU
--
-- Založení nové šablony zůstává v TS (vytvoritSablonuChecklistu) — tahle
-- RPC je pro ÚPRAVU existující: název/úsek/rozvrh/dny/potvrzení + položky
-- naráz. Položky, které v poslaném poli chybí, se NEMAŽOU (checklist_entries
-- na ně odkazuje on delete restrict) — jen se vyřadí (active=false).
-- Verzi zakládá app.zajistit_verzi_sablony — nová vznikne, jen když se
-- obsah aktivních položek opravdu změnil.
--
-- p_polozky: jsonb pole objektů
--   {id?, position, label, section?, instructions?, requires_value,
--    value_type?, value_unit?, min_value?, max_value?, povinna?}
-- Bez "id" (nebo s id, které k šabloně nepatří) = nová položka.
-- ---------------------------------------------------------------------

create or replace function public.upravit_sablonu_checklistu(
  p_tenant             uuid,
  p_sablona            uuid,
  p_nazev              text,
  p_usek               uuid       default null,
  p_rozvrh             text       default 'opening',
  p_dny_v_tydnu        smallint[] default '{}',
  p_vyzaduje_potvrzeni boolean    default false,
  p_aktivni            boolean    default true,
  p_polozky            jsonb      default '[]'::jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant       uuid;
  v_branch       uuid;
  v_existujici   uuid[];
  v_item         jsonb;
  v_id           uuid;
begin
  select t.tenant_id, t.branch_id into v_tenant, v_branch
    from public.checklist_templates t
   where t.id = p_sablona and t.tenant_id = p_tenant;

  if v_tenant is null then
    raise exception 'Ta šablona neexistuje.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'tasks.manage', v_branch) then
    raise exception 'Upravovat šablony na téhle pobočce nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_nazev, ''))) = 0 then
    raise exception 'Název šablony je povinný.' using errcode = 'check_violation';
  end if;

  if p_usek is not null and not exists (
       select 1 from public.useky u where u.id = p_usek and u.tenant_id = p_tenant) then
    raise exception 'Ten úsek do téhle firmy nepatří.' using errcode = 'insufficient_privilege';
  end if;

  update public.checklist_templates
     set name               = left(btrim(p_nazev), 200),
         usek_id            = p_usek,
         schedule           = coalesce(p_rozvrh, 'opening'),
         dny_v_tydnu        = coalesce(p_dny_v_tydnu, '{}'),
         vyzaduje_potvrzeni = coalesce(p_vyzaduje_potvrzeni, false),
         active             = coalesce(p_aktivni, true)
   where id = p_sablona;

  -- Jen id, která k TÉHLE šabloně opravdu patří. Cizí id z pole (jiná
  -- šablona, jiná firma) se neaktualizuje, bere se jako nová položka.
  select coalesce(array_agg(i.id), '{}')
    into v_existujici
    from public.checklist_items i
   where i.template_id = p_sablona
     and i.id::text in (select p->>'id' from jsonb_array_elements(p_polozky) p
                         where p->>'id' is not null);

  -- Co v poslaném poli chybí, se vyřadí — jediná cesta, jak „smazat"
  -- položku, aniž by se porušil odkaz z historie.
  update public.checklist_items
     set active = false
   where template_id = p_sablona
     and active
     and not (id = any (v_existujici));

  for v_item in select * from jsonb_array_elements(p_polozky)
  loop
    if length(btrim(coalesce(v_item->>'label', ''))) = 0 then
      continue;
    end if;

    v_id := null;
    if v_item->>'id' is not null then
      select i.id into v_id from public.checklist_items i
       where i.template_id = p_sablona and i.id::text = v_item->>'id';
    end if;

    if v_id is not null then
      update public.checklist_items
         set position       = coalesce((v_item->>'position')::smallint, 0),
             label          = left(btrim(v_item->>'label'), 200),
             section        = nullif(btrim(coalesce(v_item->>'section', '')), ''),
             instructions   = left(coalesce(v_item->>'instructions', ''), 1000),
             requires_value = coalesce((v_item->>'requires_value')::boolean, false),
             value_type     = nullif(v_item->>'value_type', ''),
             value_unit     = nullif(v_item->>'value_unit', ''),
             min_value      = nullif(v_item->>'min_value', '')::numeric,
             max_value      = nullif(v_item->>'max_value', '')::numeric,
             povinna        = coalesce((v_item->>'povinna')::boolean, true),
             active         = true
       where id = v_id;
    else
      insert into public.checklist_items
        (template_id, position, label, section, instructions, requires_value,
         value_type, value_unit, min_value, max_value, povinna)
      values (
        p_sablona,
        coalesce((v_item->>'position')::smallint, 0),
        left(btrim(v_item->>'label'), 200),
        nullif(btrim(coalesce(v_item->>'section', '')), ''),
        left(coalesce(v_item->>'instructions', ''), 1000),
        coalesce((v_item->>'requires_value')::boolean, false),
        nullif(v_item->>'value_type', ''),
        nullif(v_item->>'value_unit', ''),
        nullif(v_item->>'min_value', '')::numeric,
        nullif(v_item->>'max_value', '')::numeric,
        coalesce((v_item->>'povinna')::boolean, true)
      );
    end if;
  end loop;

  perform app.zajistit_verzi_sablony(p_sablona);

  perform app.audit(
    p_tenant, 'checklist.sablona_upravena', 'checklist_template', p_sablona::text, v_branch
  );

  return p_sablona;
end;
$$;

comment on function public.upravit_sablonu_checklistu(
  uuid, uuid, text, uuid, text, smallint[], boolean, boolean, jsonb) is
  'Upraví existující šablonu i položky naráz. Chybějící položky se '
  'vyřadí (active=false), ne smažou. Verzi zakládá '
  'app.zajistit_verzi_sablony, jen když se obsah položek změnil.';

revoke all on function public.upravit_sablonu_checklistu(
  uuid, uuid, text, uuid, text, smallint[], boolean, boolean, jsonb) from public, anon;
grant execute on function public.upravit_sablonu_checklistu(
  uuid, uuid, text, uuid, text, smallint[], boolean, boolean, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 5. PRIPOJIT_CHECKLIST_FOTKU — položka z verze běhu
--
-- Doplnění verze z 20260923110000_checklisty_mockup.sql: tam se ještě
-- neznala verze běhu, takže položka se ověřovala jen proti šabloně.
-- Teď musí patřit do VERZE běhu (app.polozka_behu) — stejné pravidlo
-- jako u zápisu položky. Zbytek beze změny.
-- ---------------------------------------------------------------------

create or replace function public.pripojit_checklist_fotku(
  p_run      uuid,
  p_item     uuid,
  p_cesta    text,
  p_nazev    text,
  p_mime     text,
  p_velikost integer
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_branch   uuid;
  v_status   text;
  v_cesta_t  uuid;
  v_cesta_r  uuid;
  v_cesta_i  uuid;
  v_nazev    text;
  v_id       uuid;
begin
  select r.tenant_id, r.branch_id, r.status
    into v_tenant, v_branch, v_status
    from public.checklist_runs r
   where r.id = p_run;

  if v_tenant is null or not app.has_access(v_tenant, 'tasks.read', v_branch) then
    raise exception 'K tomuhle checklistu nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'open' then
    raise exception 'Uzavřený checklist už nejde měnit.'
      using errcode = 'check_violation';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from app.polozka_behu(p_run, p_item)) then
    raise exception 'Ta položka k tomuhle checklistu nepatří.'
      using errcode = 'check_violation';
  end if;

  select c.tenant_id, c.run_id, c.item_id
    into v_cesta_t, v_cesta_r, v_cesta_i
    from app.checklist_fotka_cesta_rozsah(p_cesta) c;

  if v_cesta_t is distinct from v_tenant
     or v_cesta_r is distinct from p_run
     or v_cesta_i is distinct from p_item then
    raise exception 'Cesta k fotce nesedí s touhle položkou.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'checklist-fotky' and o.name = p_cesta
  ) then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.checklist_polozka_fotky p
       where p.run_id = p_run and p.item_id = p_item) >= 6 then
    raise exception 'K téhle položce lze připojit nejvýš 6 fotek.'
      using errcode = 'check_violation';
  end if;

  v_nazev := btrim(translate(coalesce(p_nazev, ''), '/' || chr(92), '__'));
  if v_nazev = '' then
    v_nazev := 'fotka';
  end if;

  insert into public.checklist_polozka_fotky
    (tenant_id, run_id, item_id, cesta, nazev, mime, velikost, employee_id)
  values
    (v_tenant, p_run, p_item, p_cesta, left(v_nazev, 120), p_mime, p_velikost,
     app.muj_employee(v_tenant))
  returning id into v_id;

  return v_id;
end;
$$;
