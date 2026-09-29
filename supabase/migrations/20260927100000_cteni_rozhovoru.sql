-- =====================================================================
-- Foodtab — čtení rozhovorů bez trvalého zápisu do kanálu (T1)
--          a upozornění na oznámení jen tomu, kdo Nástěnku čte (T9)
--
-- Zadání: docs/komunikace-stav-a-plan-2026-09-27.md, oddíl 5 (T1, T9)
-- a oddíl 10 (technická příloha).
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace. Migrace ZUŽUJE přístup,
-- přidává poznámku k tabulce a dvě nové funkce: obálku zápisu čtení
-- (`precist_rozhovor`, oddíl 9) a pomocníka formuláře Nástěnky, který
-- vedoucímu řekne jen ano/ne o právu čtení u lidí, které sám předá
-- (`ctenari_nastenky`, oddíl 12). Žádná data nemaže ani nepřepisuje.
--
-- Těla funkcí vycházejí ze ŽIVÉ databáze (pg_get_functiondef z 27. 9.
-- 2026, jen SELECT), ne z poslední migrace v repozitáři. Měnilo se jen
-- to, co je níž popsané.
--
-- ---------------------------------------------------------------------
-- PROČ (T1)
--
-- Rozhovor se dosud nikdy neoznačil za přečtený: v ostré databázi má
-- `precteno_do` vyplněné 0 ze 42 řádků. Aplikace teď začne čtení
-- zapisovat při otevření rozhovoru a při odpovědi (`oznacit_precteno`).
--
-- Jenže `oznacit_precteno` si záložku ukládá jako ŘÁDEK v
-- `konverzace_ucastnici` — a ten řádek dosud dával přístup u VŠECH
-- druhů rozhovoru, i u odvozených kanálů pobočky a úseku. Kdo by si
-- jednou přečetl kanál svého úseku a pak přešel do jiného úseku, četl
-- by starý kanál dál, měl by ho v seznamu a chodila by mu z něj
-- upozornění. Natrvalo, bez jediného kliknutí navíc.
--
-- Dnes se to nestalo ani jednou (u kanálů je 0 řádků, ověřeno 27. 9.),
-- protože čtení se nezapisovalo. Proto tahle pojistka musí jít do
-- databáze DŘÍV než oprava čtení v aplikaci, nebo spolu s ní.
--
-- CO SE MĚNÍ
--
-- U druhů `pobocka` a `usek` nese řádek účastníka jen `precteno_do`
-- (kam jsem dočetl) — přístup ani upozornění nedává. Kdo do kanálu
-- patří, plyne jen z dosahu na pobočku nebo z úseku člověka, tak jako
-- dosud. U druhů `osobni`, `mezi_pobockami` a `vedeni` je řádek dál
-- seznam účastníků.
--
-- Který druh je který, říká jediné místo: `app.ucastnici_vypsani`.
-- Používá ho šest funkcí:
--   * app.je_ucastnik            — přístup (RLS, úložiště, psaní),
--   * public.moje_rozhovory      — seznam a počty nepřečtených,
--   * app.upozornit_na_vzkaz_trg — kdo dostane „nový vzkaz",
--   * public.lide_v_rozhovoru    — jména lidí v rozhovoru,
--   * public.kiosk_zpravy_pocet  — tablet: kolik lidí má zprávy,
--   * public.kiosk_zpravy_pinem  — tablet: zprávy po PINu.
-- U obou tabletových funkcí se chování NEMĚNÍ: kanály nikdy neukazovaly
-- (řádky u kanálů nebyly) a neukazují ani teď, když řádky vzniknou.
--
-- Komentář v `oznacit_precteno` („přístup tím NEVZNIKÁ") je tím pravda
-- i pro kanály. Funkce sama se nemění.
--
-- A ČAS PŘEČTENÍ ZASE JEN PRŮZOREM (oddíl 10, doplněno 28. 9.). Základ
-- komunikace chtěl, aby `precteno_do` nepřečetl nikdo kromě vlastníka
-- (a ten jen průzorem `moje_precteno_do`), a udělil proto `select` jen
-- na čtyři sloupce. V ostré databázi to ale neplatí: výchozí práva
-- Supabase dávají `authenticated` tabulkové `select` a migrace ho nikdy
-- neodebrala. Dokud byl sloupec prázdný, nevadilo to — tahle migrace ho
-- začne plnit, takže bez oddílu 10 by každý účastník rozhovoru (v kanálu
-- celý úsek) přímým dotazem viděl, kdy si kdo co přečetl. Ze stejného
-- důvodu ze sloupcového grantu vypadl i `pridan_kdy`: u kanálu je to
-- čas, kdy si člověk kanál poprvé otevřel.
--
-- ---------------------------------------------------------------------
-- PROČ (T9)
--
-- Upozornění „nové oznámení" (a push do telefonu) chodilo každému, na
-- koho oznámení mířilo — i tomu, kdo Nástěnku číst nesmí (v ostré
-- databázi 2 lidé bez `communication.read`). Po klepnutí narazil na
-- odmítnutí. Teď ho dostane jen ten, kdo právo má; právo se počítá
-- stejnou funkcí jako u adresátů vzkazu vedení (`app.ma_pravo_clovek`).
--
-- Poznámku k tabulce `announcements` (co na Nástěnku patří, osobní
-- dokumenty ne) vyžadovala volba Šéfíka 6. 9. a chyběla.
--
-- Totéž pravidlo práva platí od 28. 9. i jinde, kde se o adresátech
-- oznámení rozhoduje: „Nepotvrdili: …" (`public.kdo_nepotvrdil`,
-- oddíl 11) a výběr „Konkrétní člověk" ve formuláři (nová
-- `public.ctenari_nastenky`, oddíl 12). Jinak by vedoucí urgoval
-- a adresoval lidi, kteří oznámení nikdy neuvidí.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Řádky účastníků u kanálů se NEMAŽOU. Nesou záložku „kam jsem
--   dočetl" a ta má přežít; nebezpečné bylo jen to, že dávaly přístup.
-- * `zalozit_rozhovor` se nezpřísňuje (rozhovory mezi pobočkami jsou
--   zamýšlené, krok 24 oddíl 7 a krok 25 oddíl 3; o tom, kdo smí komu
--   psát, rozhodne Šéfík — otázka 22).
-- * `public.precetl_si` a `public.moje_precteno_do` se nemění: obě
--   čtou jen záložku, přístup nedávají (první navíc chrání
--   `je_ucastnik` volajícího).
-- * Upozornění z kanálu pobočky jde dál podle DOMOVSKÉ pobočky, ne
--   podle dosahu (plán P5, samostatná změna).
--
-- ---------------------------------------------------------------------
-- POŘADÍ NASAZENÍ HLÍDÁ DATABÁZE, NE ČLOVĚK
--
-- Kód aplikace se nasadí sloučením PR, migrace až ručním `db push`.
-- Kdyby aplikace začala čtení zapisovat přes `oznacit_precteno` dřív,
-- než tu je pojistka, zapsala by čtenáře kanálů natrvalo (staré
-- `je_ucastnik`). Proto aplikace volá NOVOU funkci
-- `public.precist_rozhovor` (oddíl 9), která vznikne až touhle
-- migrací: dokud v databázi není, aplikace čtení nezapisuje vůbec
-- (chová se jako dnes) a pojistka tak nemůže přijít pozdě.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Jediné místo s pravidlem: u kterého druhu je řádek seznam
-- ---------------------------------------------------------------------

create or replace function app.ucastnici_vypsani(p_druh text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  /*
    TRUE = u tohohle druhu rozhovoru jsou účastníci VYPSANÍ v tabulce
    `konverzace_ucastnici` a řádek dává přístup.

    FALSE = účastníci jsou ODVOZENÍ (kanál pobočky z dosahu, kanál úseku
    z `employees.usek_id`) a řádek je jen záložka „kam jsem dočetl".

    Neznámý druh = FALSE. Nový druh rozhovoru tak přístup řádkem
    nedostane, dokud ho sem někdo výslovně nepřipíše.
  */
  select coalesce(p_druh in ('osobni', 'mezi_pobockami', 'vedeni'), false);
$$;

comment on function app.ucastnici_vypsani(text) is
  'Druh rozhovoru, u kterého řádek v konverzace_ucastnici dává přístup (osobni, mezi_pobockami, vedeni). U kanálů pobočky a úseku je řádek jen záložka precteno_do. Migrace 20260927100000.';

-- Volají ji jen funkce se security definer (běží pod vlastníkem).
revoke all on function app.ucastnici_vypsani(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. app.je_ucastnik — řádek dává přístup jen u vypsaných účastníků
-- ---------------------------------------------------------------------

create or replace function app.je_ucastnik(p_konverzace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.konverzace_ucastnici u
      join public.employees e on e.id = u.employee_id
      join public.konverzace k on k.id = u.konverzace_id
      where u.konverzace_id = p_konverzace
        and e.user_id = (select auth.uid())
        and e.deleted_at is null
        and u.odesel_kdy is null
        -- U kanálu pobočky a úseku je řádek jen záložka čtení. Bez
        -- téhle podmínky by jednou přečtený kanál zůstal otevřený
        -- i po odchodu z úseku nebo ztrátě dosahu na pobočku.
        and app.ucastnici_vypsani(k.druh)
    )
    or exists (
      select 1
      from public.konverzace k
      where k.id = p_konverzace
        and k.druh = 'pobocka'
        and k.branch_id in (select app.visible_branch_ids(k.tenant_id))
    )
    or exists (
      select 1
      from public.konverzace k
      join public.employees e on e.usek_id = k.usek_id and e.tenant_id = k.tenant_id
      where k.id = p_konverzace
        and k.druh = 'usek'
        and e.user_id = (select auth.uid())
        and e.deleted_at is null
    );
$$;


-- ---------------------------------------------------------------------
-- 3. public.moje_rozhovory — seznam: kanál jen podle dosahu a úseku
-- ---------------------------------------------------------------------

create or replace function public.moje_rozhovory(p_tenant uuid)
returns table (
  konverzace_id uuid,
  druh          text,
  branch_id     uuid,
  nazev         text,
  adresat       text,
  posledni_kdy  timestamptz,
  neprectenych  integer,
  ceka          integer,
  uzavreno_kdy  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with ja as (
    select app.muj_employee(p_tenant) as emp
  ),
  muj_usek as (
    select e.usek_id from public.employees e
    where e.id = (select emp from ja)
  ),
  smena as (
    select app.smena_ted(p_tenant, (select emp from ja)) as pobocka
  ),
  moje as (
    -- `u.precteno_do` se bere u VŠECH druhů (u kanálu je to záložka),
    -- přístup řádkem ale jen u vypsaných účastníků.
    select k.*, u.precteno_do
    from public.konverzace k
    left join public.konverzace_ucastnici u
      on u.konverzace_id = k.id
     and u.employee_id = (select emp from ja)
    where k.tenant_id = p_tenant
      and (
        (u.employee_id is not null and u.odesel_kdy is null
         and app.ucastnici_vypsani(k.druh))
        or (
          k.druh = 'pobocka'
          and k.branch_id in (select app.visible_branch_ids(p_tenant))
        )
        or (
          k.druh = 'usek'
          and k.usek_id is not null
          and k.usek_id = (select usek_id from muj_usek)
        )
      )
  )
  select
    m.id,
    m.druh,
    m.branch_id,
    m.nazev,
    m.adresat,
    max(z.vytvoreno_kdy) filter (where z.stornovano_kdy is null),
    count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    )::integer,
    count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
        and not app.doruci_se((select pobocka from smena), m.branch_id, z.nalehava)
    )::integer,
    m.uzavreno_kdy
  from moje m
  left join public.konverzace_zpravy z on z.konverzace_id = m.id
  where
    app.modul_zapnuty(p_tenant, 'provoz')
    and (select emp from ja) is not null
  group by m.id, m.druh, m.branch_id, m.nazev, m.adresat, m.uzavreno_kdy, m.precteno_do
  order by
    (count(*) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and z.autor is distinct from (select emp from ja)
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) > 0) desc,
    min(z.vytvoreno_kdy) filter (
      where z.stornovano_kdy is null
        and z.typ = 'zprava'
        and (m.precteno_do is null or z.vytvoreno_kdy > m.precteno_do)
    ) asc nulls last,
    max(z.vytvoreno_kdy) desc nulls last;
$$;


-- ---------------------------------------------------------------------
-- 4. app.upozornit_na_vzkaz_trg — „nový vzkaz" z kanálu jen podle
--    dosahu a úseku, ne podle záložky čtení
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_konv record;
  v_rec  record;
begin
  if NEW.typ = 'system' then
    return NEW;
  end if;

  select k.druh, k.branch_id, k.usek_id
    into v_konv
    from public.konverzace k
   where k.id = NEW.konverzace_id;

  for v_rec in
    select distinct e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       and (NEW.autor is null or e.id <> NEW.autor)
       and not exists (
         select 1 from public.konverzace_ucastnici ku
          where ku.konverzace_id = NEW.konverzace_id
            and ku.employee_id   = e.id
            and ku.odesel_kdy    is not null
       )
       and (
         (
           -- Řádek účastníka zve jen u vypsaných účastníků. U kanálu je
           -- to záložka čtení — kdo z úseku odešel, už nemá co dostat.
           app.ucastnici_vypsani(v_konv.druh)
           and exists (
             select 1 from public.konverzace_ucastnici ku
              where ku.konverzace_id = NEW.konverzace_id
                and ku.employee_id   = e.id
                and ku.odesel_kdy    is null
           )
         )
         or (v_konv.druh = 'pobocka' and e.branch_id = v_konv.branch_id)
         or (v_konv.druh = 'usek'    and v_konv.usek_id is not null
             and e.usek_id = v_konv.usek_id)
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'vzkaz.novy',
      jsonb_build_object('den', v_den, 'pocet', 1),
      NEW.priorita,
      null,
      null,
      'zprava',
      NEW.id,
      'vzkaz.novy:' || v_den::text
    );
  end loop;

  return NEW;
end $$;


-- ---------------------------------------------------------------------
-- 5. public.lide_v_rozhovoru — v kanálu jen autoři, ne čtenáři
-- ---------------------------------------------------------------------

create or replace function public.lide_v_rozhovoru(p_konverzace uuid)
returns table (employee_id uuid, jmeno text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.full_name::text
    from public.employees e
    join public.konverzace k on k.tenant_id = e.tenant_id
   where k.id = p_konverzace
     and app.modul_zapnuty(k.tenant_id, 'provoz')
     and app.je_ucastnik(p_konverzace)
     and (
       -- U kanálu by řádky vrátily i toho, kdo si kanál kdysi přečetl
       -- a z úseku mezitím odešel. Jména v kanálu jsou proto jen autoři.
       (app.ucastnici_vypsani(k.druh)
        and e.id in (select u.employee_id from public.konverzace_ucastnici u
                      where u.konverzace_id = p_konverzace))
       or e.id in (select z.autor from public.konverzace_zpravy z
                    where z.konverzace_id = p_konverzace and z.autor is not null)
     );
$$;


-- ---------------------------------------------------------------------
-- 6. Tablet: kanály se dál neukazují (chování se nemění)
-- ---------------------------------------------------------------------

create or replace function public.kiosk_zpravy_pocet(p_klic text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d      public.branch_devices;
  v_kolik integer;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(distinct u.employee_id) into v_kolik
  from public.konverzace_ucastnici u
  join public.konverzace k on k.id = u.konverzace_id
  join public.employees e on e.id = u.employee_id
  join public.konverzace_zpravy z on z.konverzace_id = u.konverzace_id
  where e.tenant_id = d.tenant_id
    and e.deleted_at is null
    and u.odesel_kdy is null
    -- Kanály tablet nikdy neukazoval (řádky u nich nebyly). Teď, když
    -- řádek vzniká čtením, by bez téhle podmínky započítal i kanál,
    -- ze kterého člověk mezitím odešel.
    and app.ucastnici_vypsani(k.druh)
    and z.stornovano_kdy is null
    and z.autor is distinct from u.employee_id
    and (u.precteno_do is null or z.vytvoreno_kdy > u.precteno_do)
    and (
      e.branch_id = d.branch_id
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id and s.branch_id = d.branch_id
          and s.shift_date between current_date - 1 and current_date + 1
          and s.status <> 'cancelled'
      )
    );

  return coalesce(v_kolik, 0);
end;
$$;

create or replace function public.kiosk_zpravy_pinem(p_klic text, p_pin text)
returns table (ok boolean, jmeno text, do_kdy timestamptz, zpravy jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d      public.branch_devices;
  v_emp  uuid;
  v_vter integer;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    -- Neregistrované zařízení není pokus o uhodnutí PINu a není co si
    -- pamatovat — tady se výjimka hodit SMÍ.
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_emp := app.pin_overit(d.tenant_id, d.branch_id, coalesce(p_pin, ''));

  if v_emp is null then
    return query select false, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  select coalesce(s.kiosek_odhlaseni_s, 45) into v_vter
  from public.tenant_settings s where s.tenant_id = d.tenant_id;
  v_vter := coalesce(v_vter, 45);

  return query
  select
    true,
    (select e.full_name from public.employees e where e.id = v_emp),
    now() + make_interval(secs => v_vter),
    coalesce(
      (
        select jsonb_agg(x order by x ->> 'kdy')
        from (
          select jsonb_build_object(
                   'rozhovor', k.nazev,
                   'druh',     k.druh,
                   'autor',    a.full_name,
                   'nalehava', z.nalehava,
                   'kdy',      z.vytvoreno_kdy,
                   'text',     z.text
                 ) as x
          from public.konverzace_ucastnici u
          join public.konverzace k          on k.id = u.konverzace_id
          join public.konverzace_zpravy z   on z.konverzace_id = u.konverzace_id
          left join public.employees a      on a.id = z.autor
          -- TOHLE JE TA PODMÍNKA. Jen konverzace toho člověka, kterému
          -- PIN sedl. Kdyby odsud zmizela, čte tablet po libovolném
          -- platném PINu celou firmu.
          where u.employee_id = v_emp
            and u.odesel_kdy is null
            -- Kanály tablet nikdy neukazoval; řádek u kanálu je jen
            -- záložka čtení a nesmí sem kanál vpustit.
            and app.ucastnici_vypsani(k.druh)
            and z.stornovano_kdy is null
            and (u.precteno_do is null or z.vytvoreno_kdy > u.precteno_do)
            and z.autor is distinct from v_emp
        ) as t
      ),
      '[]'::jsonb
    );
end;
$$;


-- ---------------------------------------------------------------------
-- 7. app.upozornit_na_oznameni_trg — jen tomu, kdo Nástěnku smí číst
-- ---------------------------------------------------------------------

create or replace function app.upozornit_na_oznameni_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_den  date := (NEW.created_at at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.employees e
     where e.tenant_id  = NEW.tenant_id
       and e.user_id    is not null
       and e.deleted_at is null
       -- Vlastní oznámení neupozorňuje (C3/2): author_id = profiles.user_id.
       and (NEW.author_id is null or e.user_id <> NEW.author_id)
       -- Upozornění jen tomu, kdo Nástěnku smí číst. Jinak by klepnutí
       -- na upozornění skončilo odmítnutím. Stejná funkce práva jako
       -- u adresátů vzkazu vedení (app.adresati_vzkazu).
       and app.ma_pravo_clovek(NEW.tenant_id, e.id, 'communication.read')
       -- Adresování: employee_id má nejvyšší prioritu, pak úsek, pozice,
       -- pobočka; null ve všech = celá firma.
       and (
         (NEW.employee_id  is not null and e.id          = NEW.employee_id)
         or (NEW.usek_id   is not null and e.usek_id     = NEW.usek_id
               and NEW.employee_id is null)
         or (NEW.position_id is not null and e.position_id = NEW.position_id
               and NEW.employee_id is null and NEW.usek_id is null)
         or (NEW.branch_id is not null
               and NEW.employee_id is null and NEW.usek_id is null and NEW.position_id is null
               and e.branch_id = NEW.branch_id)
         or (NEW.employee_id is null and NEW.usek_id is null
               and NEW.position_id is null and NEW.branch_id is null)
       )
  loop
    perform app.notifikovat(
      NEW.tenant_id,
      v_rec.user_id,
      'oznameni.nova',
      jsonb_build_object('den', v_den, 'pocet', 1),
      case when NEW.requires_acknowledgment then 'important' else 'normal' end,
      NEW.branch_id,
      null,
      'oznameni',
      NEW.id,
      'oznameni.nova:' || v_den::text
    );
  end loop;

  return NEW;
end $$;


-- ---------------------------------------------------------------------
-- 8. Co na Nástěnku patří (volba Šéfíka 6. 9. 2026)
-- ---------------------------------------------------------------------

comment on table public.announcements is
  'Nástěnka: oznámení pro celou firmu, pobočku, úsek, pozici nebo jednoho člověka, volitelně s „Beru na vědomí". Patří sem pokyny, provozní řády, akce a fotky z provozu. NEPATŘÍ sem osobní dokumenty lidí (smlouvy, mzdové a zdravotní doklady, doklady totožnosti) — ty se na Nástěnku nedávají ani jako oznámení pro jednoho člověka. Volba Šéfíka 6. 9. 2026; poznámka doplněna migrací 20260927100000.';


-- ---------------------------------------------------------------------
-- 9. public.precist_rozhovor — zápis čtení, který zná jen nová aplikace
-- ---------------------------------------------------------------------
--
-- Obálka nad `public.oznacit_precteno` (ta dál rozhoduje o přístupu
-- přes `app.je_ucastnik` a zapisuje záložku). Aplikace od 27. 9. volá
-- JEN tuhle funkci: vznikne až s pojistkou výš, takže aplikace nasazená
-- dřív než migrace čtení nezapisuje (funkce neexistuje) a nikoho do
-- kanálu natrvalo nezapíše. Viz hlavička, „POŘADÍ NASAZENÍ“.
--
-- `security invoker` schválně: práva i firmu hlídá volaná
-- `oznacit_precteno` (definer se svou kontrolou), tady se nic neobchází.

create function public.precist_rozhovor(p_konverzace uuid)
returns timestamptz
language sql
volatile
security invoker
set search_path = ''
as $$
  select public.oznacit_precteno(p_konverzace);
$$;

comment on function public.precist_rozhovor(uuid) is
  'Zapíše, že mám rozhovor přečtený (obálka nad oznacit_precteno). Existuje až s pojistkou odvozených kanálů, proto ji aplikace používá místo oznacit_precteno. Migrace 20260927100000.';

revoke all on function public.precist_rozhovor(uuid) from public, anon;
grant execute on function public.precist_rozhovor(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 10. Kdy kdo co četl, nepřečte nikdo kromě vlastníka — i v ostré databázi
-- ---------------------------------------------------------------------
--
-- 20260903100000 udělila `authenticated` jen `select (konverzace_id,
-- employee_id, pridan_kdy, odesel_kdy)`. `precteno_do` schválně ne:
-- kdyby odesílatel viděl ČAS přečtení, vrátí se tlak zadními vrátky
-- („psal jsem ti to v jedenáct, tys to četl"). Ostatní se dozví jen
-- ano/ne (`precetl_si`), vlastník svůj čas průzorem `moje_precteno_do`.
--
-- Jenže Supabase má v projektu výchozí práva (`alter default privileges
-- … grant all on tables to anon, authenticated`) a tabulkové `select`
-- se od `authenticated` nikdy neodebralo. Sloupcový grant vedle
-- tabulkového nic neznamená. Ověřeno 28. 9. jen SELECTem proti ostré
-- databázi: has_table_privilege('authenticated',
-- 'public.konverzace_ucastnici', 'SELECT') = true, precteno_do tedy
-- přečte každý, koho RLS k řádkům pustí (app.je_ucastnik). Vyplněné
-- bylo 0 ze 42 řádků, takže dosud nic neuniklo.
--
-- A BEZ `pridan_kdy` (28. 9.). U kanálu pobočky a úseku vzniká řádek až
-- prvním čtením (`oznacit_precteno` ho vloží, `pridan_kdy` má výchozí
-- now()). V kanálu je to tedy přesný čas, kdy si člověk kanál poprvé
-- otevřel — a politika `konverzace_ucastnici_select` pustí řádky kanálu
-- celému úseku nebo pobočce. Je to týž tlak jako u `precteno_do`, jen
-- jedním oknem vedle. `pridan_kdy` přímo nečte nic (aplikace, scénáře,
-- skripty); funkce se security definer ho čtou pod vlastníkem.
--
-- `revoke select` na tabulce odebere i sloupcová práva, proto se hned
-- vrací sloupcový grant — bez `precteno_do` a bez `pridan_kdy`. Aplikace
-- z tabulky čte jen `employee_id` s filtrem na `konverzace_id`
-- a `odesel_kdy` (detail rozhovoru); všechno ostatní jde přes funkce
-- se security definer.
--
-- CO TO HLÍDÁ:
--   * scénář krok62 oddíl 8 — `pridan_kdy` cizího člověka v kanálu
--     přímým dotazem nepřečte nikdo (spadne i v čisté databázi, když
--     oddíl 10 zmizí), `precteno_do` taky a tabulkové právo není;
--   * textová kontrola v scripts/komunikace.test.mjs — po posledním
--     `revoke select` na téhle tabulce smí přijít jen sloupcový grant
--     bez `precteno_do` a `pridan_kdy`.
-- Samotné `precteno_do` by v čisté databázi (CI, PGlite) prošlo i bez
-- oddílu 10: díra je jen tam, kde jsou výchozí práva Supabase. Proto
-- obě kontroly. Po `db push` ověřit v ostré databázi SELECTem
-- has_table_privilege('authenticated', 'public.konverzace_ucastnici',
-- 'SELECT') = false.

revoke select on public.konverzace_ucastnici from authenticated;
grant select (konverzace_id, employee_id, odesel_kdy)
  on public.konverzace_ucastnici to authenticated;


-- ---------------------------------------------------------------------
-- 11. „Nepotvrdili: …" jen ti, kdo Nástěnku smí číst (doplněno 28. 9.)
-- ---------------------------------------------------------------------
--
-- Týž důvod jako T9 v oddílu 7: kdo nemá `communication.read`, oznámení
-- podle RLS nikdy neuvidí — a od T9 na něj nedostane ani upozornění.
-- `kdo_nepotvrdil` ho přesto vypisoval a vedoucí by ho marně urgoval
-- (v ostré databázi 2 lidé). Adresování je stejné jako v triggeru
-- upozornění (oddíl 7), jinak se tělo nemění — vychází ze ŽIVÉ databáze
-- (pg_get_functiondef 28. 9., jen SELECT), shodné s 20260921110000.

create or replace function public.kdo_nepotvrdil(p_tenant uuid, p_announcement uuid)
returns table (jmeno text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_branch_id   uuid;
  v_usek_id     uuid;
  v_position_id uuid;
  v_author_id   uuid;
begin
  if not app.has_permission(p_tenant, 'communication.manage') then
    return;
  end if;

  select a.employee_id, a.branch_id, a.usek_id, a.position_id, a.author_id
    into v_employee_id, v_branch_id, v_usek_id, v_position_id, v_author_id
    from public.announcements a
   where a.id = p_announcement
     and a.tenant_id = p_tenant
     and a.requires_acknowledgment = true;

  if not found then return; end if;

  -- ROZSAH: právo na oznámení TÉTO pobočky (celofiremní oznámení = celofiremní
  -- rozsah), stejně jako politika announcements_write. Definer nemá druhou
  -- linii RLS; bez tohohle by vedoucí jedné pobočky viděl jména lidí z ostatních.
  if not app.has_access(p_tenant, 'communication.manage', v_branch_id) then
    return;
  end if;

  return query
    select coalesce(nullif(trim(p.full_name::text), ''), 'Neznámý') as jmeno
      from public.employees e
      left join public.profiles p on p.user_id = e.user_id
     where e.tenant_id  = p_tenant
       and e.deleted_at is null
       and e.user_id    is not null
       and (v_author_id is null or e.user_id <> v_author_id)
       -- Jen kdo Nástěnku smí číst. Ostatní oznámení nikdy neuvidí,
       -- urgovat je nemá smysl (28. 9., stejně jako trigger v oddílu 7).
       and app.ma_pravo_clovek(p_tenant, e.id, 'communication.read')
       and (
         (v_employee_id  is not null and e.id          = v_employee_id)
         or (v_usek_id   is not null and e.usek_id     = v_usek_id
               and v_employee_id is null)
         or (v_position_id is not null and e.position_id = v_position_id
               and v_employee_id is null and v_usek_id is null)
         or (v_branch_id is not null
               and v_employee_id is null and v_usek_id is null and v_position_id is null
               and e.branch_id = v_branch_id)
         or (v_employee_id is null and v_usek_id is null
               and v_position_id is null and v_branch_id is null)
       )
       and not exists (
         select 1 from public.announcement_reads ar
          where ar.announcement_id = p_announcement
            and ar.user_id         = e.user_id
       )
     order by jmeno;
end $$;


-- ---------------------------------------------------------------------
-- 12. public.ctenari_nastenky — komu má smysl psát oznámení „jen jemu"
-- ---------------------------------------------------------------------
--
-- Formulář Nástěnky nabízel v „Konkrétní člověk" každého s účtem, i
-- toho, kdo Nástěnku číst nesmí. Oznámení se uložilo s hláškou „je na
-- Nástěnce", adresát ho ale nikdy neuviděl a od T9 na něj nedostal ani
-- upozornění. Právo jiného člověka aplikace sama nezjistí
-- (`app.ma_pravo_clovek` je ve schématu app), proto tahle funkce.
--
-- Vrací jen PODMNOŽINU lidí, které volající sám předá (jména si aplikace
-- čte přes RLS jako dosud). Volat ji smí jen ten, kdo oznámení psát
-- smí (`communication.manage` ve firmě); ostatním vrátí prázdno. Firmu
-- si filtruje sama — definer nemá druhou linii RLS.

create function public.ctenari_nastenky(p_tenant uuid, p_lide uuid[])
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from public.employees e
   where app.has_permission(p_tenant, 'communication.manage')
     and e.tenant_id  = p_tenant
     and e.deleted_at is null
     and e.user_id    is not null
     and e.id = any (coalesce(p_lide, '{}'::uuid[]))
     and app.ma_pravo_clovek(p_tenant, e.id, 'communication.read');
$$;

comment on function public.ctenari_nastenky(uuid, uuid[]) is
  'Z předaných lidí vrátí ty, kdo Nástěnku smí číst (communication.read) a mají účet. Jen pro volajícího s communication.manage ve firmě. Formulář „Konkrétní člověk". Migrace 20260927100000.';

revoke all on function public.ctenari_nastenky(uuid, uuid[]) from public, anon;
grant execute on function public.ctenari_nastenky(uuid, uuid[]) to authenticated;
