-- =====================================================================
-- Foodtab — Rezervace: ranní souhrn dne do upozornění
--
-- Zadání Šéfíka 27. 10. 2026: „každý den posílat notifikace o tom, co
-- čeká, kolik rezervací a jaká akce bude ten den v plánu“.
--
-- Scénář: krok106. Úloha: /api/uloha/rezervace-souhrn-dne (GitHub
-- workflow rezervace-souhrn-dne.yml je záloha plánovače v databázi).
--
-- ---------------------------------------------------------------------
-- CO TO DĚLÁ
--
-- Každé ráno po pobočkách: kolik je rezervací (bez zrušených) a hostů
-- (součet `pocet_osob`) a jaké akce jsou v plánu (čas, název, počet
-- osob, prostor). Den je PROVOZNÍ den pobočky (`rezervace.den` počítá
-- spoušť přes app.business_date), ne kalendářní — rezervace v 1:30
-- patří k večeru předtím, stejně jako v kalendáři.
--
-- Jedno upozornění na člověka, ne na pobočku: kdo vidí obě pobočky
-- (majitel), dostane jedno „Dnes BBT: … · RČP: …“, ne dvě pípnutí.
-- Doručuje se jen přes `app.notifikovat` (zvoneček, push, fronta) —
-- majitel obchází frontu, ostatním push počká na příchod do práce
-- (app.zaradit_doruceni, beze změny).
--
-- ---------------------------------------------------------------------
-- KDY
--
-- Úloha běží každou hodinu; o hodině rozhoduje TADY databáze podle pásma
-- pobočky (stejně jako u zapomenutého odchodu): souhrn odejde při prvním
-- běhu od 8:00 do 16:00 místního času v provozním dni. Hodina na zdi
-- pobočky, ne UTC — v zimě i v létě v osm.
--
-- 8:00 a 16:00 jsou zatím napevno (konstanty níž). Nastavení „v kolik“
-- nikdo nežádal a vymýšlet přepínač, který nikdo nechtěl, sem nepatří;
-- kdyby bylo potřeba, je to jeden sloupec v tenant_settings.
-- Po 16:00 se už neposílá: „Dnes 12 rezervací“ uprostřed večerního
-- provozu nikomu nepomůže a pípnutí by rušilo. Zmeškaný ranní běh
-- (GitHub, než se zapne pg_cron) dožene kterýkoli běh před 16:00.
--
-- ---------------------------------------------------------------------
-- JEDNOU ZA DEN A POBOČKU
--
-- Drží to primární klíč (branch_id, den) v `rezervace_souhrn_dne`, ne
-- příznak: řádek se zapíše ve stejné transakci jako upozornění, takže
-- druhý běh (pg_cron i GitHub, ruční spuštění) pobočku přeskočí — i
-- souběžně, druhý insert počká na první a pak neudělá nic. Zapisuje se
-- i den, kdy se nic neposlalo (prázdný den): rezervace přidaná v 10:00
-- už pozdní „souhrn“ nespustí.
--
-- ---------------------------------------------------------------------
-- KOMU
--
-- Kdo smí vidět rezervace té pobočky: `rezervace.read` NEBO
-- `rezervace.manage` na pobočce — totéž co politika `rezervace_cist`
-- a stránka Rezervace (pristup.ts). Ptá se app.kdo_ma_pravo_na_pobocce,
-- jediného místa, které o tom rozhoduje (aktivní členství, rozsah,
-- zapnutý modul, majitel).
--
-- Upozornění nese jen pobočky TÉ firmy a jen ty, které člověk vidí.
-- Kdo je ve dvou firmách, dostane dvě upozornění, každé ve své firmě.
--
-- ---------------------------------------------------------------------
-- DEN BEZ REZERVACÍ A AKCÍ — NEPOSÍLÁ SE NIC
--
-- Denní „dnes nic v plánu“ naučí lidi upozornění přeskakovat — a pak
-- přehlédnou i den, kdy je svatba. Když člověk vidí víc poboček
-- a aspoň na jedné něco je, prázdná se v souhrnu uvede („RČP: nic
-- v plánu“), ať je vidět, že se na ni nezapomnělo.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Do upozornění nejdou jména hostů ani kontakty. Název akce ano (patří
--     Foodtabu a ten člověk ho vidí v kalendáři), ale do PUSH ho aplikace
--     nedává — push jde přes cizí službu na zamčenou obrazovku
--     (lib/komunikace/push-zprava.ts skládá jen nadpis).
--   * Věta se neskládá tady: v těle leží holá čísla, větu skládá
--     lib/upozorneni-text.ts (opravitelná i u starých upozornění).
--   * Zkratka pobočky (BBT, RČP) se neukládá: počítá ji obrazovka
--     z názvů (zkratkyPobocek, Rozpis směn), ať jsou zkratky všude stejné.
--   * Synchronizace Choice se před souhrnem nespouští. S pg_cronem běží
--     každých 15 minut, takže v 8:01 je data nejvýš čtvrt hodiny stará.
--   * Řádky v `rezervace_souhrn_dne` se neauditují — je to záznam úlohy,
--     ne data, která by někdo měnil. Starší než 90 dní se mažou.
--
-- ---------------------------------------------------------------------
-- POZOR: PŘEPISUJE app.notifikovat
--
-- Přibývá jedna kategorie vypínače (`rezervace_souhrn`). Tělo je opsané
-- z 20260921100000_notifikacni_sluzba.sql — jediné migrace, která tu
-- funkci definuje; mění se jen jeden řádek v `case` kategorií. Živé
-- znění se před napsáním porovnat nepodařilo (čtení z ostré databáze
-- zablokoval auto mode) — před db push ho porovnej (návod v PR).
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. VYPÍNAČ V NASTAVENÍ UPOZORNĚNÍ
--
-- Výchozí je zapnuto (chybějící řádek = povoleno, app.upozorneni_povoleno).
-- ---------------------------------------------------------------------

alter table public.notification_preferences
  drop constraint notification_preferences_kategorie_check;

alter table public.notification_preferences
  add constraint notification_preferences_kategorie_check
  check (kategorie in ('vzkazy', 'nastenka', 'rezervace_souhrn'));


create or replace function app.notifikovat(
  p_tenant          uuid,
  p_user            uuid,
  p_druh            text,
  p_telo            jsonb   default '{}'::jsonb,
  p_priorita        text    default 'normal',
  p_branch          uuid    default null,
  p_shift           uuid    default null,
  p_zdroj_typ       text    default null,
  p_zdroj_id        uuid    default null,
  p_dedupe          text    default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_priorita text := coalesce(p_priorita, 'normal');
  v_telo     jsonb := coalesce(p_telo, '{}'::jsonb);
  v_kategorie text;
  v_pocet    integer;
  v_id       uuid;
begin
  if p_tenant is null or p_user is null or coalesce(p_druh, '') = '' then
    return null;
  end if;

  -- Neznámá priorita se nepřijme potichu jako důležitá ani se nezahodí:
  -- z upozornění by zmizela kvůli překlepu. Bere se jako běžná.
  if v_priorita not in ('low', 'normal', 'important', 'urgent') then
    v_priorita := 'normal';
  end if;

  -- 1. PŘÍJEMCE: aktivní zaměstnanec téže firmy s účtem A S AKTIVNÍM
  -- ČLENSTVÍM. Pozastavené členství zavírá přístup do aplikace (has_access,
  -- modul_zapnuty); upozornění, a hlavně push na zamčenou obrazovku telefonu,
  -- mu proto nemá chodit dál — zaměstnanecký řádek zůstává i po pozastavení.
  if not exists (
    select 1
      from public.employees e
      join public.memberships m
        on m.tenant_id = e.tenant_id
       and m.user_id   = e.user_id
     where e.tenant_id  = p_tenant
       and e.user_id    = p_user
       and e.deleted_at is null
       and m.status     = 'active'
  ) then
    return null;
  end if;

  -- 2. PŘEPÍNAČE KATEGORIÍ. Urgentní se nepotlačuje; směny nemají kategorii.
  -- Ranní souhrn rezervací jen přesným druhem: budoucí rezervace.* (třeba
  -- „nová rezervace“) se tímhle vypínačem vypínat nemají.
  v_kategorie := case
    when p_druh like 'vzkaz.%'   then 'vzkazy'
    when p_druh like 'oznameni.%' then 'nastenka'
    when p_druh = 'rezervace.souhrn_dne' then 'rezervace_souhrn'
  end;

  if v_kategorie is not null
     and v_priorita <> 'urgent'
     and not app.upozorneni_povoleno(p_tenant, p_user, v_kategorie) then
    return null;
  end if;

  -- 4. SLUČOVÁNÍ: nepřečtené téhož klíče se nahradí novým.
  if p_dedupe is not null then
    v_pocet := app.zrusit_neprectene(p_tenant, p_user, p_dedupe);

    -- Počet zpráv se sčítá, jen když ho volající sám nese (telo.pocet).
    -- Priorita se NEsčítá: nahrazující upozornění nese AKTUÁLNÍ prioritu
    -- (rozhodnutí z kroku 35, oddíl 5 — jinak by odznak zůstal trvale
    -- poplašný po jediné naléhavé zprávě).
    if v_telo ? 'pocet' then
      v_telo := jsonb_set(
        v_telo, '{pocet}',
        to_jsonb(v_pocet + coalesce((v_telo->>'pocet')::integer, 1))
      );
    end if;
  end if;

  insert into public.notifications
    (tenant_id, user_id, branch_id, druh, telo, priorita, shift_id,
     zdroj_typ, zdroj_id, dedupe_key)
  values
    (p_tenant, p_user, p_branch, p_druh, v_telo, v_priorita, p_shift,
     p_zdroj_typ, p_zdroj_id, p_dedupe)
  returning id into v_id;

  -- 5.–6. KANÁL: záznam v aplikaci už je, teď případný push.
  perform app.zaradit_doruceni(v_id);

  return v_id;
end $$;

revoke all on function app.notifikovat(uuid, uuid, text, jsonb, text, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. ZÁZNAM „VYHODNOCENO PRO DEN“
--
-- Čte a zapisuje jen definer funkce níž. Klient na tabulku nesmí:
-- nejsou v ní data, která by potřeboval, a `truncate` by obešel RLS.
-- ---------------------------------------------------------------------

create table public.rezervace_souhrn_dne (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  den             date not null,
  vyhodnoceno_kdy timestamptz not null default now(),
  -- Co souhrn ukázal — ať jde dohledat „proč mi nic nepřišlo“ (prázdný den).
  rezervaci       integer not null check (rezervaci >= 0),
  hostu           integer not null check (hostu >= 0),
  akci            integer not null check (akci >= 0),
  primary key (branch_id, den)
);

comment on table public.rezervace_souhrn_dne is
  'Ranní souhrn rezervací: pobočka a provozní den, pro který už úloha '
  'souhrn vyhodnotila (i když nebylo co poslat). Primární klíč drží „jednou '
  'za den a pobočku“. Zapisuje jen app.rezervace_souhrn_dne.';

alter table public.rezervace_souhrn_dne enable row level security;
-- Záměrně žádná politika: klient tuhle tabulku nečte ani nezapisuje.
revoke all on public.rezervace_souhrn_dne from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. SOUHRN
--
-- `p_ted` a `p_tenant` jsou pro scénář (provozní den kolem půlnoci,
-- hodina na zdi). Úloha volá obálku public.rezervace_souhrn_dne_poslat()
-- bez parametrů, tedy teď a všechny firmy.
--
-- DEFINER BEZ DRUHÉ LINIE: RLS tu neplatí. Pobočky se berou jen té firmy,
-- přes kterou smyčka jde (`b.tenant_id`); rezervace podle pobočky
-- (`branch_id` je globálně jedinečné a spoušť rezervace_pred_zapisem drží,
-- že pobočka patří firmě řádku), příjemci přes kdo_ma_pravo_na_pobocce
-- s firmou pobočky. Každý filtr jen jednou.
--
-- Selhání jedné firmy nezastaví ostatní: blok firmy se vrátí celý (i
-- záznam „vyhodnoceno“), takže ji příští běh zkusí znovu.
-- ---------------------------------------------------------------------

create function app.rezervace_souhrn_dne(
  p_ted    timestamptz default now(),
  p_tenant uuid        default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_od         constant time := time '08:00';
  c_do         constant time := time '16:00';
  -- Kolik akcí jedné pobočky jde do těla upozornění (počet `akci` je vždy celý).
  c_akci_max   constant integer := 20;
  v_t          record;
  v_b          record;
  v_u          record;
  v_zona       text;
  v_den        date;
  v_pobocka    jsonb;
  v_pobocky    jsonb;
  v_souhrn     jsonb;
  v_id         uuid;
  v_pob_firmy  integer;
  v_upo_firmy  integer;
  v_pobocek    integer := 0;
  v_upozorneni integer := 0;
  v_chyb       integer := 0;
begin
  delete from public.rezervace_souhrn_dne s
   where s.den < (p_ted at time zone 'UTC')::date - 90;

  for v_t in
    select t.id from public.tenants t
     where t.deleted_at is null
       and (p_tenant is null or t.id = p_tenant)
     order by t.id
  loop
    begin
      -- Pobočky téhle firmy, kterým právě začal čas souhrnu, a jejich čísla:
      -- { "<branch_id>": { pobocka, slug, den, rezervaci, hostu, bez_poctu, akci, akce[] } }
      v_pobocky := '{}'::jsonb;
      v_pob_firmy := 0;
      v_upo_firmy := 0;

      for v_b in
        select b.id, b.name, b.slug
          from public.branches b
         where b.tenant_id = v_t.id
           and b.active
           and b.deleted_at is null
         order by b.name, b.id
      loop
        v_zona := app.zona_pobocky(v_b.id);
        v_den  := app.business_date(v_b.id, p_ted);

        -- Hodina na zdi pobočky v JEJÍM provozním dni (CLAUDE.md, pravidla
        -- 10–11). Ve 2:00 po půlnoci je provozní den ještě včerejší a jeho
        -- okno skončilo v 16:00 — nic. Den, který začíná později než v osm,
        -- se pošle od svého začátku: do té doby je provozní den včerejší.
        if p_ted <  (v_den + c_od) at time zone v_zona
           or p_ted >= (v_den + c_do) at time zone v_zona then
          continue;
        end if;

        select jsonb_build_object(
                 'pobocka',   v_b.name,
                 'slug',      v_b.slug,
                 'den',       v_den,
                 'rezervaci', count(*) filter (where r.druh = 'rezervace'),
                 'hostu',     coalesce(sum(r.pocet_osob) filter (where r.druh = 'rezervace'), 0),
                 'bez_poctu', count(*) filter (where r.druh = 'rezervace' and r.pocet_osob is null),
                 'akci',      count(*) filter (where r.druh = 'akce'),
                 'akce',      coalesce((
                    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'cas',     to_char(a.zacatek at time zone v_zona, 'HH24:MI'),
                             'nazev',   coalesce(nullif(btrim(a.nazev), ''), nullif(btrim(a.typ_akce), ''), 'Akce'),
                             'osob',    a.pocet_osob,
                             'prostor', nullif(btrim(a.prostor), '')
                           )) order by a.zacatek, a.id)
                      from (
                        select x.zacatek, x.id, x.nazev, x.typ_akce, x.pocet_osob, x.prostor
                          from public.rezervace x
                         where x.branch_id = v_b.id
                           and x.den       = v_den
                           and x.druh      = 'akce'
                           and x.stav     <> 'zrusena'
                         order by x.zacatek, x.id
                         limit c_akci_max
                      ) a
                  ), '[]'::jsonb)
               )
          into v_pobocka
          from public.rezervace r
         where r.branch_id = v_b.id
           and r.den       = v_den
           and r.stav     <> 'zrusena';

        insert into public.rezervace_souhrn_dne (tenant_id, branch_id, den, rezervaci, hostu, akci)
        values (v_t.id, v_b.id, v_den,
                (v_pobocka->>'rezervaci')::integer,
                (v_pobocka->>'hostu')::integer,
                (v_pobocka->>'akci')::integer)
        on conflict (branch_id, den) do nothing;

        -- Už vyhodnoceno dřívějším (nebo souběžným) během.
        if not found then
          continue;
        end if;

        v_pobocky := v_pobocky || jsonb_build_object(v_b.id::text, v_pobocka);
        v_pob_firmy := v_pob_firmy + 1;
      end loop;

      if v_pob_firmy > 0 then
        -- Kdo vidí kterou z těch poboček.
        for v_u in
          select k.user_id, array_agg(distinct p.key order by p.key) as pobocky
            from jsonb_each(v_pobocky) p
           cross join lateral (
             select x.user_id from app.kdo_ma_pravo_na_pobocce(v_t.id, 'rezervace.read', p.key::uuid) x
             union
             select x.user_id from app.kdo_ma_pravo_na_pobocce(v_t.id, 'rezervace.manage', p.key::uuid) x
           ) k
           group by k.user_id
        loop
          select jsonb_agg(v_pobocky -> s.klic order by v_pobocky -> s.klic ->> 'pobocka', s.klic)
            into v_souhrn
            from unnest(v_u.pobocky) as s(klic);

          -- Na žádné z jeho poboček nic není → nic se neposílá (hlavička).
          if not exists (
            select 1 from jsonb_array_elements(v_souhrn) e
             where (e->>'rezervaci')::integer > 0 or (e->>'akci')::integer > 0
          ) then
            continue;
          end if;

          v_id := app.notifikovat(
            v_t.id,
            v_u.user_id,
            'rezervace.souhrn_dne',
            jsonb_build_object('den', v_souhrn -> 0 ->> 'den', 'souhrn', v_souhrn),
            'normal',
            case when cardinality(v_u.pobocky) = 1 then v_u.pobocky[1]::uuid end,
            null,
            'rezervace_souhrn',
            null,
            -- Klíč podle SADY poboček, bez dne: dnešní souhrn nahradí
            -- včerejší nepřečtený (a zruší jeho čekající push), ale souhrn
            -- pobočky v jiném pásmu, který přijde o hodinu později, ten
            -- první nesmaže.
            'rezervace.souhrn_dne:' || md5(array_to_string(v_u.pobocky, ','))
          );

          if v_id is not null then
            v_upo_firmy := v_upo_firmy + 1;
          end if;
        end loop;
      end if;

      v_pobocek := v_pobocek + v_pob_firmy;
      v_upozorneni := v_upozorneni + v_upo_firmy;
    exception when others then
      v_chyb := v_chyb + 1;
      raise warning 'Ranní souhrn rezervací firmy % selhal: % %', v_t.id, sqlstate, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('pobocek', v_pobocek, 'upozorneni', v_upozorneni, 'chyb', v_chyb);
end $$;

revoke all on function app.rezervace_souhrn_dne(timestamptz, uuid) from public, anon, authenticated, service_role;

comment on function app.rezervace_souhrn_dne(timestamptz, uuid) is
  'Ranní souhrn rezervací a akcí po pobočkách do upozornění (8:00–16:00 '
  'místního času, jednou za provozní den a pobočku). Vrací počet '
  'vyhodnocených poboček, odeslaných upozornění a firem, které selhaly.';


-- Obálka pro úlohu (service_role přes PostgREST, které vidí jen `public`).
create function public.rezervace_souhrn_dne_poslat()
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select app.rezervace_souhrn_dne(now(), null);
$$;

revoke all on function public.rezervace_souhrn_dne_poslat() from public, anon, authenticated;
grant execute on function public.rezervace_souhrn_dne_poslat() to service_role;

comment on function public.rezervace_souhrn_dne_poslat() is
  'Pro plánovač (service_role): ranní souhrn rezervací. Viz app.rezervace_souhrn_dne.';


-- ---------------------------------------------------------------------
-- 4. ÚLOHA V PLÁNOVAČI — každou hodinu v :01 (UTC)
--
-- Hodinu rozhoduje databáze (výš), plán jen „kdy se zeptat“. Minuta 1:
-- Choice se načítá v :56, takže souhrn v 8:01 má čerstvá data a push
-- odejde s odesílačem v :07. Plán musí sedět s GitHub workflow
-- (scripts/planovac.test.mjs). Limit 300 s: adresa nemá vlastní
-- maxDuration.
--
-- Do pg_cronu se úloha dostane až dalším `select * from
-- app.naplanovat_ulohy();` — pokud ho Šéfík spustil dřív, než se tahle
-- migrace nasadila, je potřeba ho spustit znovu.
-- ---------------------------------------------------------------------

insert into app.planovac_ulohy (uloha, plan_utc, limit_sekund) values
  ('rezervace-souhrn-dne',   '1 * * * *',          300);
