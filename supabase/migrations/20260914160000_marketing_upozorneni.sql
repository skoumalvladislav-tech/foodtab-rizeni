-- =====================================================================
-- Foodtab — modul Marketing: upozornění
--
-- Zadání: master prompt, oddíl 14 — „pošli notifikaci při žádosti
-- o schválení, vrácení, schválení a selhání publikace".
--
-- ---------------------------------------------------------------------
-- PROČ TO CHYBĚLO A PROČ TO VADÍ
--
-- Celé schvalování dosud fungovalo tak, že si schvalovatel musel sám
-- vzpomenout a podívat se do Fronty ke schválení. Kdo si nevzpomněl,
-- držel příspěvek klidně týden — a ten, kdo o schválení požádal,
-- neměl jak zjistit, jestli se na to někdo kouká, nebo na to všichni
-- zapomněli.
--
-- Totéž u selhání publikace: příspěvek nevyšel ven, v Publikovaných
-- svítí červeně a nikdo se tam nedívá, protože ho nic nepozvalo.
--
-- ---------------------------------------------------------------------
-- UPOZORNĚNÍ PÍŠE SPOUŠŤ, NE APLIKACE
--
-- `notifications` nemá pro `authenticated` grant na `insert` — psát do
-- nich smí jen `security definer` funkce. Je to schválně: přímý zápis
-- by znamenal, že si kdokoli pošle komukoli cokoli.
--
-- A hlavně: spoušť je JEDINÉ místo, které to udělá vždycky. Kdyby
-- upozornění posílala serverová akce, nepřišlo by u ničeho, co jde
-- mimo obrazovku — třeba u úlohy, která zruší publikaci kvůli nové
-- verzi.
--
-- ---------------------------------------------------------------------
-- SÁM SOBĚ SE NEPÍŠE
--
-- Kdo o schválení požádal, nedostane zprávu, že o něj někdo požádal.
-- Kdo rozhodl, nedostane zprávu o vlastním rozhodnutí. Zní to
-- samozřejmě, ale je to nejčastější chyba v upozorněních vůbec —
-- a lidé si pak odvyknou je číst.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Žádný e-mail ani push. Kanál „v aplikaci" je jediný, který nemůže
--   selhat, a proto se nedá vypnout (komentář u `notifications`).
--   Ostatní kanály přijdou, až budou — a přijdou nad TOUTO tabulkou,
--   ne vedle ní.
-- * Žádné upozornění na úspěšné zveřejnění. Když všechno vyjde,
--   není co hlásit; zpráva u každého příspěvku by jen zaplnila seznam
--   a lidé by přestali číst i ty, na kterých záleží.
-- * Žádná tabulka nastavení „co mi chodit má". Dokud jsou druhy tři,
--   je to předčasné — a vypnout jde jediné upozornění tím, že se
--   člověku odebere právo, kvůli kterému ho dostává.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KDO MÁ ROZHODNOUT
--
-- Žádost o schválení dostanou VŠICHNI, kdo na té pobočce smějí
-- publikovat — kromě toho, kdo o ni požádal (pravidlo čtyř očí).
--
-- Ptá se `app.kdo_ma_pravo_na_pobocce`, tedy TÉHOŽ MÍSTA, které
-- rozhoduje o přístupu jinde (CLAUDE.md, pravidlo 2). Vlastní dotaz do
-- zařazení by byl druhá kopie autorizace, která se dřív nebo později
-- rozejde.
-- ---------------------------------------------------------------------

create or replace function app.marketing_upozorni_na_zadost()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch  uuid;
  v_nazev   text;
  v_zadal   uuid;
  v_pobocka text;
begin
  if new.stav <> 'ceka' then
    return new;
  end if;

  /*
    Pobočka a název se berou z příspěvku. Uvnitř `security definer` se
    RLS neuplatní (skill `migrace`, oddíl 5), takže se firma porovnává
    ručně — jinak by šlo podstrčit cizí příspěvek.
  */
  select p.branch_id, p.nazev, b.name
    into v_branch, v_nazev, v_pobocka
    from public.marketing_prispevky p
    join public.branches b on b.id = p.branch_id
   where p.id = new.prispevek_id
     and p.tenant_id = new.tenant_id;

  if v_branch is null then
    return new;
  end if;

  -- Účet toho, kdo požádal. `zadal` je `employees.id`, ne `user_id`.
  select e.user_id into v_zadal
    from public.employees e
   where e.id = new.zadal
     and e.tenant_id = new.tenant_id;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  select new.tenant_id, k.user_id, v_branch, 'marketing.zadost',
         jsonb_build_object(
           'prispevek', new.prispevek_id,
           'nazev', coalesce(v_nazev, ''),
           'pobocka', coalesce(v_pobocka, ''),
           'kdo', (select e.full_name from public.employees e where e.id = new.zadal))
    from app.kdo_ma_pravo_na_pobocce(new.tenant_id, 'marketing.publish', v_branch) k
   -- Sám sobě ne. `is distinct from` schválně: u nepřihlášeného
   -- zakladatele je `v_zadal` prázdné a `<>` by nevrátilo nic.
   where k.user_id is distinct from v_zadal;

  return new;
end $$;

revoke all on function app.marketing_upozorni_na_zadost() from public, anon, authenticated;

drop trigger if exists trg_marketing_upozorni_na_zadost on public.marketing_schvaleni;
create trigger trg_marketing_upozorni_na_zadost
  after insert on public.marketing_schvaleni
  for each row execute function app.marketing_upozorni_na_zadost();


-- ---------------------------------------------------------------------
-- ROZHODNUTO
--
-- Schválení i vrácení s připomínkou jde tomu, kdo o ně požádal.
-- Jedna spoušť na obojí: je to táž událost z jeho pohledu („někdo
-- o mém příspěvku rozhodl"), jen s jiným výsledkem.
-- ---------------------------------------------------------------------

create or replace function app.marketing_upozorni_na_rozhodnuti()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_nazev  text;
  v_zadal  uuid;
  v_kdo    text;
begin
  -- Jen skutečná změna rozhodnutí. `update` beze změny stavu (třeba
  -- doplnění poznámky) zprávu posílat nemá.
  if new.stav = old.stav or new.stav not in ('schvaleno', 'zamitnuto') then
    return new;
  end if;

  select p.branch_id, p.nazev into v_branch, v_nazev
    from public.marketing_prispevky p
   where p.id = new.prispevek_id
     and p.tenant_id = new.tenant_id;

  select e.user_id into v_zadal
    from public.employees e
   where e.id = new.zadal
     and e.tenant_id = new.tenant_id;

  if v_branch is null or v_zadal is null then
    return new;
  end if;

  select e.full_name into v_kdo
    from public.employees e
   where e.id = new.rozhodl
     and e.tenant_id = new.tenant_id;

  /*
    SÁM SOBĚ NE. Když ve firmě nikdo druhý s právem publikovat není,
    spoušť `app.marketing_strez_rozhodnuti` dovolí rozhodnout o vlastní
    žádosti — a tehdy by přišla zpráva „schválil jste si vlastní
    příspěvek", což nikomu nic neřekne.
  */
  if new.rozhodl is not null and new.rozhodl = new.zadal then
    return new;
  end if;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  values (new.tenant_id, v_zadal, v_branch, 'marketing.rozhodnuto',
          jsonb_build_object(
            'prispevek', new.prispevek_id,
            'nazev', coalesce(v_nazev, ''),
            'schvaleno', new.stav = 'schvaleno',
            'pripominka', coalesce(new.pripominka, ''),
            'kdo', v_kdo));

  return new;
end $$;

revoke all on function app.marketing_upozorni_na_rozhodnuti() from public, anon, authenticated;

drop trigger if exists trg_marketing_upozorni_na_rozhodnuti on public.marketing_schvaleni;
create trigger trg_marketing_upozorni_na_rozhodnuti
  after update on public.marketing_schvaleni
  for each row execute function app.marketing_upozorni_na_rozhodnuti();


-- ---------------------------------------------------------------------
-- PUBLIKACE SELHALA
--
-- Chodí tomu, kdo příspěvek naplánoval (`vytvoril` na úloze). Ne všem,
-- kdo smějí publikovat: selhání je jeho práce, ne firemní událost,
-- a čtyři zprávy o jednom nevyšlém příspěvku jsou šum.
--
-- ---------------------------------------------------------------------
-- JEN `vzdano`, NE KAŽDÉ `selhalo`
--
-- `selhalo` znamená „zkusí se to znovu" — fronta má pět pokusů. Zpráva
-- u každého pokusu by znamenala pět zpráv o jednom příspěvku, který
-- nakonec vyjde. `vzdano` je konec: víc pokusů nebude a bez člověka to
-- ven nepůjde.
--
-- Je to tentýž rozdíl jako mezi `selhalo` a `vzdano` na obrazovce
-- Publikované (`lib/marketing-text.ts`, `radaKeStavu`).
-- ---------------------------------------------------------------------

create or replace function app.marketing_upozorni_na_selhani()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_nazev  text;
  v_komu   uuid;
begin
  if new.stav <> 'vzdano' or old.stav = 'vzdano' then
    return new;
  end if;

  select p.branch_id, p.nazev into v_branch, v_nazev
    from public.marketing_prispevky p
   where p.id = new.prispevek_id
     and p.tenant_id = new.tenant_id;

  select e.user_id into v_komu
    from public.employees e
   where e.id = new.vytvoril
     and e.tenant_id = new.tenant_id;

  if v_branch is null or v_komu is null then
    return new;
  end if;

  insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
  values (new.tenant_id, v_komu, v_branch, 'marketing.publikace_selhala',
          jsonb_build_object(
            'prispevek', new.prispevek_id,
            'nazev', coalesce(v_nazev, ''),
            'kanal', new.kanal,
            'pokusy', new.pokusy,
            -- Hláška od poskytovatele se ukládá TAK, JAK PŘIŠLA.
            -- Anglicky a o tokenech — ale radu česky umí obrazovka
            -- Publikované, a ta se bez původního znění neobejde.
            'duvod', coalesce(new.posledni_chyba, '')));

  return new;
end $$;

revoke all on function app.marketing_upozorni_na_selhani() from public, anon, authenticated;

drop trigger if exists trg_marketing_upozorni_na_selhani on public.marketing_publikace_ulohy;
create trigger trg_marketing_upozorni_na_selhani
  after update on public.marketing_publikace_ulohy
  for each row execute function app.marketing_upozorni_na_selhani();
