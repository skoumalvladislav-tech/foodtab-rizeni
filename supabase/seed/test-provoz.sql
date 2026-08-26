-- =====================================================================
-- Foodtab — testovací provozní data
--
-- NENÍ TO MIGRACE. Do supabase/migrations/ tenhle soubor nepatří a
-- `supabase db push` ho nepustí. Je na ruční spuštění proti testovacímu
-- projektu, ať je na čem zkoušet obrazovky.
--
-- Firmu i pobočky si najde sám podle toho, co v databázi je. Pustit se
-- dá opakovaně — co už existuje, se nezaloží podruhé, a směny v okně
-- příštích čtrnácti dnů se přepíšou.
--
-- Spuštění:
--   psql "$DATABASE_URL" -f supabase/seed/test-provoz.sql
--   nebo vložit do SQL editoru v Supabase
-- =====================================================================

do $$
declare
  -- Značka, podle které se poznají řádky z tohohle souboru. Díky ní jde
  -- seed pustit znovu, aniž by sáhl na cokoli skutečného.
  c_znacka  constant text := 'ukázková data';
  c_dnu     constant int  := 14;

  v_tenant   uuid;
  v_autor    uuid;
  v_pobocka  record;
  v_zam      record;
  v_den      date;
  v_poradi   int;
  v_smen     int := 0;
  v_lidi     int := 0;

  -- První a druhá pobočka. Úkoly je potřebují rozlišit, směny ne.
  v_pob1     uuid;
  v_pob2     uuid;
  v_adresat  uuid;
  v_sablona  uuid;
  v_ukolu    int := 0;
  v_pridano  int := 0;
begin
  ------------------------------------------------------------------
  -- Firma
  ------------------------------------------------------------------
  select id into v_tenant
  from public.tenants
  order by created_at
  limit 1;

  if v_tenant is null then
    raise exception 'V databázi není žádná firma. Nejdřív ji založte přes app.create_tenant().';
  end if;

  -- Autor zprávy: kdokoli, kdo má ve firmě účet. Může být i prázdné.
  select e.user_id into v_autor
  from public.employees e
  where e.tenant_id = v_tenant and e.user_id is not null
  order by e.created_at
  limit 1;

  ------------------------------------------------------------------
  -- Pozice
  ------------------------------------------------------------------
  insert into public.positions (tenant_id, key, label, department) values
    (v_tenant, 'kuchar',   'Kuchař',  'kuchyne'),
    (v_tenant, 'pomocnik', 'Výpomoc', 'kuchyne'),
    (v_tenant, 'obsluha',  'Obsluha', 'servis'),
    (v_tenant, 'barman',   'Barman',  'bar')
  on conflict (tenant_id, key) do nothing;

  ------------------------------------------------------------------
  -- Lidé na každé pobočce
  --
  -- Brigádník je schválně bez user_id: zaměstnanec existuje i bez
  -- uživatelského účtu, takže ho jde zařadit na směnu, aniž by se kdy
  -- přihlásil. Sloupec employees.user_id je proto volitelný.
  ------------------------------------------------------------------
  for v_pobocka in
    select b.id, b.name
    from public.branches b
    where b.tenant_id = v_tenant and b.deleted_at is null and b.active
    order by b.created_at
  loop
    insert into public.employees
      (tenant_id, branch_id, position_id, full_name, employment_type, started_on)
    select
      v_tenant,
      v_pobocka.id,
      (select id from public.positions
        where tenant_id = v_tenant and key = z.pozice),
      z.jmeno || ' (' || v_pobocka.name || ')',
      z.uvazek,
      current_date - 90
    from (values
      ('Jana Kuchařová', 'kuchar',   'hpp'),
      ('Petr Novák',     'obsluha',  'hpp'),
      ('Eva Barová',     'barman',   'hpp'),
      -- Brigádník bez účtu: nikdy se nepřihlásí, na směnu ho zařadit jde.
      ('Tomáš Brigádník','pomocnik', 'dpp')
    ) as z(jmeno, pozice, uvazek)
    where not exists (
      select 1 from public.employees e
      where e.tenant_id = v_tenant
        and e.branch_id = v_pobocka.id
        and e.full_name = z.jmeno || ' (' || v_pobocka.name || ')'
    );
  end loop;

  select count(*) into v_lidi
  from public.employees
  where tenant_id = v_tenant and deleted_at is null;

  ------------------------------------------------------------------
  -- Směny na příštích 14 dní
  --
  -- Nejdřív se okno vyčistí, ale jen od řádků s naší značkou — skutečný
  -- rozpis, kdyby už nějaký byl, zůstane nedotčený.
  ------------------------------------------------------------------
  delete from public.shifts
  where tenant_id = v_tenant
    and note = c_znacka
    and shift_date between current_date and current_date + (c_dnu - 1);

  for v_pobocka in
    select b.id, b.name
    from public.branches b
    where b.tenant_id = v_tenant and b.deleted_at is null and b.active
    order by b.created_at
  loop
    v_poradi := 0;

    -- Na směny bereme i lidi s účtem (typicky zakladatele firmy), jinak
    -- by obrazovka „Moje směny“ přihlášenému nic neukázala.
    for v_zam in
      select e.id, e.position_id
      from public.employees e
      where e.tenant_id = v_tenant
        and e.branch_id = v_pobocka.id
        and e.deleted_at is null
        and e.active
      order by e.created_at
    loop
      for v_den in
        select d::date
        from generate_series(current_date, current_date + (c_dnu - 1), interval '1 day') as d
      loop
        -- Ať nemá každý službu každý den: střídáme po dvou dnech.
        continue when (extract(day from v_den)::int + v_poradi) % 2 = 1;

        insert into public.shifts
          (tenant_id, branch_id, employee_id, position_id,
           shift_date, starts_at, ends_at, note, status, created_by)
        values
          (v_tenant, v_pobocka.id, v_zam.id, v_zam.position_id,
           v_den,
           case when v_poradi % 2 = 0 then time '07:00' else time '15:00' end,
           case when v_poradi % 2 = 0 then time '15:30' else time '23:30' end,
           c_znacka,
           case when v_den = current_date then 'confirmed' else 'planned' end,
           v_autor);

        v_smen := v_smen + 1;
      end loop;

      v_poradi := v_poradi + 1;
    end loop;
  end loop;

  ------------------------------------------------------------------
  -- Firemní zpráva
  --
  -- branch_id prázdné = firemní úroveň, tedy pro celou firmu.
  ------------------------------------------------------------------
  insert into public.announcements (tenant_id, branch_id, body, pinned, author_id)
  select v_tenant, null,
         'Ukázková data: rozpis na příštích čtrnáct dní je nahraný. '
         || 'Slouží ke zkoušení obrazovek, ne k plánování provozu.',
         true, v_autor
  where not exists (
    select 1 from public.announcements a
    where a.tenant_id = v_tenant
      and a.branch_id is null
      and a.body like 'Ukázková data:%'
  );

  ------------------------------------------------------------------
  -- Úkoly
  --
  -- Čtyři případy, na kterých se pozná, že rozsah a adresování fungují:
  -- jmenovitě zadaný, bez adresáta na pobočce, firemní a na druhé
  -- pobočce. Rozlišují se názvem, takže se při opakovaném běhu nezaloží
  -- podruhé — a jednou zavřený úkol zůstane zavřený.
  ------------------------------------------------------------------
  select b.id into v_pob1
  from public.branches b
  where b.tenant_id = v_tenant and b.deleted_at is null and b.active
  order by b.created_at
  limit 1;

  select b.id into v_pob2
  from public.branches b
  where b.tenant_id = v_tenant and b.deleted_at is null and b.active
    and b.id <> v_pob1
  order by b.created_at
  limit 1;

  -- Adresát jmenovitého úkolu. Bereme kohokoli z první pobočky.
  -- Pozn.: vyzkoušet, že si úkol zavře adresát BEZ tasks.manage, jde až
  -- s druhým skutečným účtem — seed uživatele v auth.users zakládat neumí.
  select e.id into v_adresat
  from public.employees e
  where e.tenant_id = v_tenant
    and e.branch_id = v_pob1
    and e.deleted_at is null
  order by e.created_at
  limit 1;

  if v_pob1 is not null then
    insert into public.tasks
      (tenant_id, branch_id, employee_id, title, note, due_at, priority, created_by)
    select v_tenant, u.branch, u.emp, u.nazev, u.pozn, u.termin, u.priorita, v_autor
    from (values
      (v_pob1, v_adresat,
       'Objednat maso na víkend',
       'Ukázkový úkol zadaný konkrétnímu člověku.',
       (now() + interval '1 day')::timestamptz, 'high'),
      (v_pob1, null::uuid,
       'Doplnit ubrousky na terasu',
       'Ukázkový úkol bez adresáta — vezme ho, kdo má čas.',
       (now() + interval '2 days')::timestamptz, 'normal'),
      (null::uuid, null::uuid,
       'Projít ceny dodavatelů',
       'Ukázkový úkol pro celou firmu, nevisí na pobočce.',
       (now() + interval '5 days')::timestamptz, 'normal')
    ) as u(branch, emp, nazev, pozn, termin, priorita)
    where not exists (
      select 1 from public.tasks t
      where t.tenant_id = v_tenant and t.title = u.nazev
    );

    get diagnostics v_ukolu = row_count;
  end if;

  if v_pob2 is not null then
    insert into public.tasks
      (tenant_id, branch_id, title, note, due_at, priority, created_by)
    select v_tenant, v_pob2,
           'Vyčistit odsávání nad grilem',
           'Ukázkový úkol na druhé pobočce.',
           now() + interval '3 days', 'normal', v_autor
    where not exists (
      select 1 from public.tasks t
      where t.tenant_id = v_tenant
        and t.title = 'Vyčistit odsávání nad grilem'
    );

    get diagnostics v_pridano = row_count;
    v_ukolu := v_ukolu + v_pridano;
  end if;

  ------------------------------------------------------------------
  -- Otevírací checklist
  --
  -- branch_id prázdné = šablona platí pro celou firmu, takže se nabídne
  -- na obou pobočkách. Číselné položky mají meze, na kterých se pozná,
  -- že se hodnota mimo rozsah odmítne.
  ------------------------------------------------------------------
  select t.id into v_sablona
  from public.checklist_templates t
  where t.tenant_id = v_tenant and t.name = 'Otevírací checklist'
  limit 1;

  if v_sablona is null then
    insert into public.checklist_templates
      (tenant_id, branch_id, name, department, schedule, active)
    values (v_tenant, null, 'Otevírací checklist', 'provoz', 'opening', true)
    returning id into v_sablona;
  end if;

  insert into public.checklist_items
    (template_id, position, label, requires_value, value_type,
     value_unit, min_value, max_value)
  select v_sablona, p.poradi, p.popis, p.chce_hodnotu, p.typ,
         p.jednotka, p.min_h, p.max_h
  from (values
    -- Meze jsou schválně úzké, ať je snadné trefit se vedle a vyzkoušet,
    -- že se hodnota mimo rozsah odmítne.
    (1::smallint, 'Teplota lednice v kuchyni', true, 'number'::text, '°C'::text,
      2::numeric, 5::numeric),
    (2::smallint, 'Teplota mrazáku', true, 'number'::text, '°C'::text,
      -25::numeric, -18::numeric),
    (3::smallint, 'Teplota lednice na baru', true, 'number'::text, '°C'::text,
      2::numeric, 8::numeric),
    (4::smallint, 'Zkontrolovat čistotu výčepu', false, null::text, null::text,
      null::numeric, null::numeric),
    (5::smallint, 'Spustit kávovar a propláchnout', false, null::text, null::text,
      null::numeric, null::numeric)
  ) as p(poradi, popis, chce_hodnotu, typ, jednotka, min_h, max_h)
  where not exists (
    select 1 from public.checklist_items i
    where i.template_id = v_sablona and i.label = p.popis
  );

  raise notice 'Hotovo: % zaměstnanců, % směn na % dní, % úkolů, checklist %.',
    v_lidi, v_smen, c_dnu, v_ukolu,
    case when v_sablona is null then 'nezaložen' else 'připraven' end;
end $$;
