-- =====================================================================
-- Foodtab — Rezervace z Choice: upozornění na výpadek napojení
-- a opatrný opakovaný test, když Choice jednou odmítne přístup
--
-- Scénář: krok110. Kód: lib/rezervace-choice-sync.ts
-- (`opakovatTestChoice`), app/api/uloha/rezervace-choice/route.ts.
-- Rozhodnutí „jak často“: docs/hlaseni/otazky.md, otázka 89.
--
-- ---------------------------------------------------------------------
-- PROČ
--
-- 3. 11. 2026 v 19:41 vrátil Choice u obou podniků (Bernard Bar Tábor,
-- Restaurace Černá Perla) v jednom běhu 403. Kód napojení přepnul na
-- `vyzaduje_pozornost` a úloha se od té doby Choice neptala — čtyři
-- dny se nenačetla jediná rezervace a NIKDO to nevěděl: štítek
-- „Vyžaduje pozornost“ byl jen na stránce napojení a v přehledu
-- Financí, upozornění nepřišlo žádné. Zjistilo se to náhodou,
-- ověřovacím dotazem po nasazení PR #176 (docs/hlaseni/
-- stav-2026-11-04-choice-stoly.md, „Nasazení 7. 11.“).
--
-- Dvě věci, obě tady:
--
--   1. UPOZORNĚNÍ, KDYŽ NAPOJENÍ SPADNE. Spoušť na `integrace_pripojeni`:
--      přechod napojení Choice z `pripojeno` na `vyzaduje_pozornost`
--      pošle upozornění majiteli firmy a každému, kdo má na pobočce
--      napojení `integrace.manage`.
--
--   2. OPAKOVANÝ TEST. Jediná 403 vypnula načítání napořád. Úloha
--      Choice teď napojení, které stojí, sama zkusí znovu — tentýž
--      `GET /bookings/list?page=1&perPage=1` jako „Ověřit znovu“,
--      nejvýš jednou za `p_odstup_ms` (kód: 2 hodiny) a přes společnou
--      frontu dotazů (limit Choice 1 dotaz / 5 s). Když projde, kód
--      zapíše `pripojeno` stejnou cestou jako „Ověřit znovu“
--      (`zapsatVysledekTestu`, databáze dál pustí `pripojeno` jen
--      s úspěšným testem — integrace_pripojeni_rezervace_overeno).
--
-- ---------------------------------------------------------------------
-- 1. JEDNO UPOZORNĚNÍ NA VÝPADEK
--
-- Spoušť reaguje na PŘECHOD stavu, ne na stav: běh, který napojení
-- najde už stojící, nic neposílá. Souběžné zápisy téhož řádku řadí zámek
-- řádku — druhý `update` vidí `old.stav = 'vyzaduje_pozornost'`
-- a upozornění nepošle. Výpadek = `pripojeno` → `vyzaduje_pozornost`.
-- „Ověřit znovu“ a callback po neúspěchu zapisují `chyba` — to vidí ten,
-- kdo klikl, a upozornění nedostane nikdo. Opakovaný test, který
-- neprojde, stav nemění, takže další upozornění nepřijde, dokud
-- napojení znovu nenačítá a znovu nespadne.
--
-- VÝPADEK HLÁSÍ JEN SERVER (`auth.uid()` je NULL). U Choice ho zapisuje
-- jen automat klientem služby (lib/rezervace-choice-sync.ts: odmítnutý
-- přístup v běhu načítání a chybějící token). Správce s `integrace.
-- manage` smí řádek napojení měnit i přímo přes API (politika FOR ALL,
-- 20261007110000) — kdyby stav přepnul sám, upozornění nepošle nikomu:
-- výpadek, který si člověk udělal sám, není co hlásit, a majiteli by
-- jinak psal vlastním textem (`posledni_chyba`) s push (nezávislá
-- kontrola 7. 11., nález 3).
--
-- KOMU: majitel (employees.je_majitel) A `app.kdo_ma_pravo_na_pobocce
-- (… 'integrace.manage', pobočka napojení)`. Majitel zvlášť, protože
-- `integrace.manage` patří modulu Finance (20261007110000) — firma bez
-- Financí by jinak nedostala upozornění vůbec. Kdo je platný příjemce
-- (aktivní členství, nesmazaný), rozhoduje jen app.notifikovat — tady
-- se to podruhé nefiltruje.
--
-- PRIORITA `important`: majitel dostane push hned (obchází frontu,
-- 20260922120000), ostatním počká na příchod do práce — výpadek
-- v noci nebudí správce. Kategorie k vypnutí NENÍ: bez upozornění
-- stálo načítání čtyři dny.
--
-- ZVONÍ NEJVÝŠ JEDNOU ZA 24 HODIN NA NAPOJENÍ. Když napojení kolísá
-- (opakovaný test projde, další běh dostane zase 403), byl by to výpadek
-- každé 2 hodiny i v noci — a kdo dostane push každé 2 hodiny, vypne si
-- upozornění úplně (nezávislá kontrola 7. 11., nález 1). Další výpadek
-- do 24 h od posledního, který zvonil, přijde tiše (`low`: bez push,
-- mimo odznak), ale přijde — v seznamu upozornění nahradí nepřečtené
-- „zase načítá“, takže tam je, co platí teď. Kdy naposledy zvonilo,
-- drží `app.integrace_vypadek_zvoneni` (upozornění samo to neudrží:
-- nepřečtené se při obnovení maže).
--
-- ODPOJENÍ: kdo napojení odpojí, tomu i ostatním se nepřečtené
-- upozornění k němu stáhne, i s push, který ještě čeká na směnu —
-- o napojení, které už není, se nemá zvonit při příchodu do práce
-- (nezávislá kontrola 7. 11., nález 4). Přečtené zůstane.
--
-- TĚLO: id napojení, oblast, poskytovatel, pobočka (název a slug)
-- a důvod (`posledni_chyba`, max 300 znaků — píše ho náš kód, token
-- v něm nikdy není). Push nese jen nadpis („Choice nenačítá rezervace —
-- Bernard Bar Tábor“, lib/upozorneni-text.ts), důvod je jen v aplikaci.
--
-- OBNOVENÍ: když napojení zase `pripojeno` (opakovaný test, „Ověřit
-- znovu“ i nové připojení téhož řádku), NEPŘEČTENÉ upozornění na výpadek
-- se nahradí tichým „Choice zase načítá rezervace“ (`low` = bez push,
-- mimo odznak) se stejným klíčem — ráno pak nikdo nevolá Choice kvůli
-- výpadku, který se v noci spravil sám. Kdo upozornění už přečetl,
-- nedostane nic dalšího. Kdo obnovení udělal sám (klik na „Ověřit
-- znovu“), tomu se nepřečtené upozornění jen stáhne.
--
-- NEZASTAVÍ ZÁPIS. Celé tělo spouště je v bloku s `exception`: kdyby
-- upozornění selhalo, přepnutí stavu musí projít — jinak by úloha
-- napojení dál brala jako připojené a ptala se Choice znovu a znovu.
-- Selhání se jen zapíše do logu databáze (`raise warning`).
--
-- ---------------------------------------------------------------------
-- 2. OPAKOVANÝ TEST — ODSTUP A FRONTA NARÁZ
--
-- `public.rezervace_choice_zabrat_opakovany_test` = stejný vzor jako
-- „Ověřit znovu“ (`rezervace_choice_zabrat_overeni`, 20261102100000):
-- odstup na připojení a dotaz ve frontě rozhodne JEDNO volání pod
-- zámkem řádku odstupu. Kdo je v odstupu, frontu nezabere (-1); kdo se
-- nevejde do fronty, odstup nespotřebuje (NULL) a zkusí to příští běh.
--
--   * Odstup se měří od POZDĚJŠÍHO z: posledního ověření (ruční „Ověřit
--     znovu“ i opakovaný test sdílí `app.rezervace_choice_overeni`)
--     a posledního běhu načítání (`synchronizace_behy`, píše jen
--     server). Běh načítání je ten, který na odmítnutí narazil — první
--     opakovaný test tak přijde až odstup po výpadku, ne čtvrt hodiny
--     po něm. Ruční „Ověřit znovu“ odpočet začne znovu; opakovaný test
--     zablokuje ruční nejvýš na minutu (jeho vlastní odstup).
--   * Fronta: vstup ÚLOHY (`rezervace_choice_zabrat_dotaz_ulohy`, bez
--     pravidla firmy) — volá to jen naplánovaná úloha, jako načítání.
--     Jak dlouho smí čekat, dává kód (nejvýš dva rozestupy, jako
--     tlačítko); funkce fronty si meze hlídá sama.
--   * Zámky: odstup → fronta. Ruční ověření zamyká odstup → firma →
--     fronta, úloha jen frontu; pořadí se nekříží.
--   * Odstup 30 min až 24 h: méně by z opakování udělalo načítání
--     s neplatným tokenem, víc nedává smysl, když úloha běží celý den.
--
-- KTERÁ napojení se zkoušejí (Choice, živé, `vyzaduje_pozornost` nebo
-- `chyba`, s tokenem) a že nejvýš jedno za běh úlohy, rozhoduje kód —
-- funkce o stavu napojení neví, stejně jako ruční ověření. Výsledek
-- testu zapisuje kód podmíněně: jen dokud napojení pořád stojí a je to
-- tentýž podnik (varSymbol) — souběžné „Ověřit znovu“ ani nové
-- připojení se nepřepíšou.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * POKLADNA A BANKA ZATÍM NE, i když mají stav `vyzaduje_pozornost`
--     taky (lib/pokladna-sync.ts, lib/kb-adaa-sync.ts, lib/integrace-
--     fio-sync.ts). Do `vyzaduje_pozornost` je tam přepínají i kroky
--     člověka (Dotykačka bez přiřazené provozovny, návrat z KB bez
--     vybraného účtu) — spoušť by správci posílala upozornění na to,
--     co právě udělal sám. Rozšíření je samostatná práce (otázka 90):
--     u každého přechodu rozlišit automat od člověka a podmínku
--     `poskytovatel = 'choice'` ve spoušti nahradit seznamem.
--   * Podmínka „jen Choice“ je JEN v `when` spouště (každý filtr
--     jednou) — tělo o oblasti nerozhoduje.
--   * Jediná nová tabulka je `app.integrace_vypadek_zvoneni` (kdy
--     naposledy zvonil výpadek). Výpadek nese stav v registru, odstup
--     `app.rezervace_choice_overeni`, příjemce `notifications`.
--   * Opakovaný test do Choice nic nepíše (jen GET), jako všechno
--     v napojení Choice.
--
-- POŘADÍ NASAZENÍ: nejdřív kód (Vercel „Ready“), pak `db push`. Kód bez
-- migrace opakovaný test nepustí (funkce chybí → nic se nezkouší)
-- a spoušť bez kódu by poslala upozornění, které stará aplikace neumí
-- pojmenovat (nadpis „Upozornění“). Napojení, která STOJÍ UŽ PŘED
-- `db push` (Bernard i Perla od 3. 11.), upozornění nedostanou — žádný
-- přechod se nestane; opakovaný test je ale zkusí hned první běh úlohy.
--
-- NASAZUJE ŠÉFÍK (db push), NIKDY relace.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. UPOZORNĚNÍ NA VÝPADEK A OBNOVENÍ
--
-- DEFINER BEZ DRUHÉ LINIE: RLS tu neplatí. Firma i pobočka jsou
-- z řádku napojení (`new.tenant_id`, `new.branch_id`); upozornění
-- k obnovení se hledají podle klíče s id napojení v téže firmě.
-- ---------------------------------------------------------------------

-- Kdy naposledy zvonil výpadek napojení (push). Píše jen spoušť, nikdo
-- jiný ji nečte; mimo API (schéma app), jako app.rezervace_choice_overeni.
create table app.integrace_vypadek_zvoneni (
  pripojeni_id  uuid primary key references public.integrace_pripojeni(id) on delete cascade,
  zvonilo       timestamptz not null
);

comment on table app.integrace_vypadek_zvoneni is
  'Kdy naposledy zvonilo (important, push) upozornění na výpadek napojení. '
  'Další výpadek do 24 h přijde tiše (low). Píše jen app.integrace_vypadek_upozornit.';

alter table app.integrace_vypadek_zvoneni enable row level security;
revoke all on app.integrace_vypadek_zvoneni from public, anon, authenticated, service_role;

create function app.integrace_vypadek_upozornit()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ja    uuid := auth.uid();
  v_klic  text := 'integrace.vypadek:' || new.id::text;
  v_telo  jsonb;
  v_u     record;
  v_tise  boolean;
begin
  begin
    v_telo := jsonb_build_object(
      'pripojeni',    new.id,
      'oblast',       new.oblast,
      'poskytovatel', new.poskytovatel
    ) || coalesce((
      select jsonb_build_object('pobocka', b.name, 'pobocka_slug', b.slug)
        from public.branches b
       where b.id = new.branch_id
    ), '{}'::jsonb);

    if new.odpojeno_kdy is not null then
      -- Odpojené: nepřečtené upozornění k němu stáhnout všem (i s push,
      -- který čeká na směnu). Přečtené nechá app.zrusit_neprectene samo
      -- (bere jen nepřečtené) — tady se to podruhé nefiltruje.
      for v_u in
        select distinct n.user_id
          from public.notifications n
         where n.tenant_id  = new.tenant_id
           and n.dedupe_key = v_klic
      loop
        perform app.zrusit_neprectene(new.tenant_id, v_u.user_id, v_klic);
      end loop;

    elsif old.stav = 'pripojeno' and new.stav = 'vyzaduje_pozornost' and v_ja is null then
      v_telo := v_telo || jsonb_build_object('duvod', left(coalesce(new.posledni_chyba, ''), 300));

      -- Zvonilo za posledních 24 h? Pak tiše; jinak zvoní a zapíše se.
      v_tise := coalesce((
        select z.zvonilo > now() - interval '24 hours'
          from app.integrace_vypadek_zvoneni z
         where z.pripojeni_id = new.id), false);
      if not v_tise then
        insert into app.integrace_vypadek_zvoneni (pripojeni_id, zvonilo)
        values (new.id, now())
        on conflict (pripojeni_id) do update set zvonilo = excluded.zvonilo;
      end if;

      for v_u in
        select e.user_id
          from public.employees e
         where e.tenant_id = new.tenant_id
           and e.je_majitel
           and e.user_id is not null
        union
        select x.user_id
          from app.kdo_ma_pravo_na_pobocce(new.tenant_id, 'integrace.manage', new.branch_id) x
      loop
        perform app.notifikovat(
          new.tenant_id, v_u.user_id, 'integrace.vypadek', v_telo,
          case when v_tise then 'low' else 'important' end,
          new.branch_id, null, 'integrace_pripojeni', new.id, v_klic);
      end loop;

    elsif new.stav = 'pripojeno' then
      for v_u in
        select distinct n.user_id
          from public.notifications n
         where n.tenant_id  = new.tenant_id
           and n.dedupe_key = v_klic
           and n.druh       = 'integrace.vypadek'
           and n.read_at is null
      loop
        if v_u.user_id = v_ja then
          perform app.zrusit_neprectene(new.tenant_id, v_u.user_id, v_klic);
        else
          perform app.notifikovat(
            new.tenant_id, v_u.user_id, 'integrace.obnoveno', v_telo, 'low',
            new.branch_id, null, 'integrace_pripojeni', new.id, v_klic);
        end if;
      end loop;
    end if;
  exception when others then
    raise warning 'Upozornění k napojení % (% → %) selhalo: % %', new.id, old.stav, new.stav, sqlstate, sqlerrm;
  end;
  return null;
end $$;

revoke all on function app.integrace_vypadek_upozornit() from public, anon, authenticated;

comment on function app.integrace_vypadek_upozornit() is
  'Spoušť: napojení Choice přešlo z „připojeno“ na „vyžaduje pozornost“ (zapsal server) → upozornění '
  'majiteli a správcům napojení pobočky (jedno na výpadek; push nejvýš jednou za 24 h, jinak tiše). '
  'Zase „připojeno“ → nepřečtené upozornění se nahradí tichým „zase načítá“. Odpojení → nepřečtené '
  'se stáhne. Selhání upozornění zápis stavu nezastaví.';

-- ROZHODNOUT: otázka 90 — jen Choice (rezervace); banka a pokladna zatím ne.
create trigger trg_integrace_vypadek_upozornit
  after update of stav, odpojeno_kdy on public.integrace_pripojeni
  for each row
  when ((old.stav is distinct from new.stav or old.odpojeno_kdy is distinct from new.odpojeno_kdy)
        and new.oblast = 'rezervace'
        and new.poskytovatel = 'choice')
  execute function app.integrace_vypadek_upozornit();


-- ---------------------------------------------------------------------
-- 2. OPAKOVANÝ TEST: ODSTUP NA PŘIPOJENÍ A DOTAZ VE FRONTĚ NARÁZ
--
-- Vrací (stejný tvar jako odstup „Ověřit znovu“):
--   >= 0 = za kolik ms smí test odejít (odstup i dotaz zabrané),
--   -1   = ještě ne: od posledního ověření nebo běhu načítání neuběhl
--          `p_odstup_ms` — fronty se nedotkne,
--   NULL = dotaz se do fronty nevešel — nic se nezabralo a odstup se
--          NESPOTŘEBOVAL (zkusí to příští běh úlohy).
-- ---------------------------------------------------------------------

create function public.rezervace_choice_zabrat_opakovany_test(
  p_pripojeni uuid, p_odstup_ms integer, p_rozestup_ms integer, p_nejdele_cekat_ms integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_naposledy  timestamptz;
  v_beh        timestamptz;
  v_cekat      integer;
begin
  if p_pripojeni is null then
    raise exception 'Opakovaný test Choice musí patřit připojení.' using errcode = '22023';
  end if;
  if p_odstup_ms is null or p_odstup_ms < 1800000 or p_odstup_ms > 86400000 then
    raise exception 'Opakovaný test Choice smí jít nejčastěji po 30 minutách a nejméně jednou za 24 hodin.'
      using errcode = '22023';
  end if;

  -- Řádek odstupu (neexistující připojení spadne na cizím klíči) a jeho
  -- zámek — souběžné ruční ověření téhož připojení počká.
  insert into app.rezervace_choice_overeni (pripojeni_id, naposledy)
  values (p_pripojeni, '-infinity')
  on conflict (pripojeni_id) do nothing;

  select o.naposledy into v_naposledy
    from app.rezervace_choice_overeni o
   where o.pripojeni_id = p_pripojeni
     for update;

  -- Poslední běh načítání (ten, který na odmítnutí narazil).
  select max(b.zahajeno_kdy) into v_beh
    from public.synchronizace_behy b
   where b.integrace_pripojeni_id = p_pripojeni;

  -- `greatest` vynechá NULL (napojení bez jediného běhu).
  if greatest(v_naposledy, v_beh) > clock_timestamp() - p_odstup_ms * interval '1 millisecond' then
    return -1;
  end if;

  v_cekat := public.rezervace_choice_zabrat_dotaz_ulohy(p_rozestup_ms, p_nejdele_cekat_ms);
  if v_cekat is null then
    return null;
  end if;

  update app.rezervace_choice_overeni
     set naposledy = clock_timestamp()
   where pripojeni_id = p_pripojeni;
  return v_cekat;
end $$;

comment on function public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer) is
  'Opakovaný test napojení Choice, které stojí (naplánovaná úloha): odstup od posledního ověření '
  'i běhu načítání a dotaz ve frontě úlohy naráz. ms do odchodu testu, -1 = ještě ne, '
  'NULL = do fronty se nevešel (odstup se nespotřeboval). Jen service_role.';

revoke all on function public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.rezervace_choice_zabrat_opakovany_test(uuid, integer, integer, integer) to service_role;
