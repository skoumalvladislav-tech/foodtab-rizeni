-- =====================================================================
-- Foodtab — docházka jednoho člověka po dnech: úseky, úprava, storno
--
-- Zadání majitele 27. 9. 2026: „potřebuji mít možnost u jednotlivých
-- lidí zkouknout odpracované směny po dnech a případně je upravovat.
-- dále možnost stornovat směnu která započala píchnutím (stala se
-- chyba)". Obrazovka je /[rozsah]/dochazka/clovek/[id]; tohle je její
-- databázová půlka.
--
-- ---------------------------------------------------------------------
-- CO PŘIBÝVÁ
--
--   1. attendance_events.nahrazuje — nový ruční záznam, který vznikl
--      opravou, ukazuje na starý (stornovaný)
--   2. app.hlida_firmu_dochazky — spoušť: zaměstnanec i pobočka musí
--      patřit firmě záznamu (nález c)
--   3. app.rucni_dochazka_kdo — při UPDATE nechá, kdo záznam zapsal
--      (nález a)
--   4. přímý zápis do attendance_events pro authenticated: UPDATE
--      a DELETE pryč, INSERT jen na sedmi neutrálních sloupcích —
--      oprava jde jen přes funkce s pravidly a auditem (nález b)
--  4b. public.stornovat_dochazku (storno jednoho záznamu z 2. 9.) přijde
--      o EXECUTE — obcházela pravidla storna úseku (nález d)
--   5. app.useky_dochazky — úseky příchod → odchod po provozních dnech,
--      opis stavového automatu app.worked_minutes
--   6. public.useky_cloveka — úseky a stornované záznamy člověka za
--      měsíc, s právy po záznamu (obrazovka, Můj účet)
--  6b. public.dochazka_clovek — jméno a pobočka člověka pro hlavičku
--      obrazovky, jen tomu, kdo smí vidět aspoň něco z jeho docházky
--   7. public.vydelek_cloveka_po_dnech — peníze po dnech jednoho
--      člověka, rozklad app.earnings (jen s payroll.read)
--   8. app.zapsat_rucni_zaznam — vnitřní zápis ručního záznamu
--   9. public.upravit_usek_dochazky — úprava, doplnění a nový úsek
--  10. public.stornovat_usek_dochazky — storno úseku i jednoho
--      nezapočítaného záznamu (typicky píchnutí omylem)
--
-- ---------------------------------------------------------------------
-- ČTYŘI NÁLEZY, NA KTERÝCH ÚPRAVA STOJÍ (ověřeno v ostré DB 27. a 28. 9.)
--
-- (a) Spoušť app.rucni_dochazka_kdo zapisovala entered_by := auth.uid()
--     i při UPDATE. Deset ručních záznamů stornovaných 2. 9. (migrace
--     20260902100000, bez přihlášeného) proto má entered_by NULL, i když
--     původního zadavatele zná audit „attendance.manual". Každé další
--     storno ručního záznamu by „kdo zapsal" přepsalo na toho, kdo
--     stornoval. Opravuje se jen do budoucna; těch deset řádků se bez
--     rozhodnutí nemění (otázka 28).
--
-- (b) Role authenticated měla na attendance_events INSERT, UPDATE
--     i DELETE a politiky attendance_update/attendance_delete pouštěly
--     každého s attendance.manage. Vedoucí tak přes rozhraní databáze
--     uměl přepsat occurred_at, smazat řádek nebo „odstornovat" záznam
--     (stornovano_kdy = null) — a u píchnutí to audit spoušť nezapíše
--     vůbec. Aplikace do tabulky přímo nezapisuje nikde (jen select),
--     scénáře, které přímo mění nebo mažou (krok4, 5, 15, 23, 24, 29,
--     42), běží jako superuživatel. UPDATE a DELETE se proto odebírá.
--     INSERT šel na VŠECH sloupcích: vedoucí vložil záznam s vlastním
--     stornovano_kdy, stornoval, duvod_storna nebo business_date —
--     obrazovka to ukáže jako fakt („stornoval majitel", jiný den) a
--     audit o tom neví. INSERT proto zůstává jen na sloupcích, na
--     kterých stojí krok2 a krok6 (otázka 31).
--
-- (d) public.stornovat_dochazku (20260902100000) má EXECUTE pro
--     authenticated a stornuje JEDEN záznam bez pravidel storna úseku:
--     vedoucí si stornem vlastního odchodu na oběd a příchodu po obědě
--     udělá z 8–12 a 13–17 jeden úsek 8–17 (+30 min), nebo stornem
--     prvního ze dvou příchodů nechá druhý otevřený. Aplikace ji nevolá.
--
-- (c) zapsat_rucni_dochazku neověřuje, že zaměstnanec a pobočka patří
--     do p_tenant, a app.has_access se členstvím „celá firma" vrací
--     true pro JAKOUKOLI pobočku. Majitel firmy A by tak zapsal hodiny
--     člověku firmy B. Spoušť hlida_firmu_dochazky to zavírá pro všechny
--     cesty najednou (i pro budoucí). V ostré DB je porušení 0.
--
-- ---------------------------------------------------------------------
-- PRAVIDLA ÚPRAVY (schválený návrh 27. 9.; nejopatrnější varianty)
--
-- * NIC SE NEMAŽE A NIC SE NEPŘEPISUJE NA MÍSTĚ. Úprava = storno
--   starého záznamu (stornovano_kdy, stornoval, duvod_storna) a nový
--   ruční záznam s `nahrazuje` → starý. Sloupce corrected_by/corrected_at
--   se nepoužijí: znamenají změnu na místě, a ta se nedělá.
-- * Stornují se jen záznamy, jejichž čas (na minutu) nebo pobočka se
--   mění. Nezměněný konec zůstává i se zdrojem (PIN zůstane PIN)
--   a i se sekundami — formulář posílá hodinu na zdi bez sekund.
-- * Doplnění chybějícího odchodu příchod nestornuje. Doplnit jde i
--   příchod k osamělému odchodu a zapsat celý nový úsek.
-- * Hodina na zdi (timestamp bez pásma) + pásmo POBOČKY záznamu
--   (app.zona_pobocky) — pravidlo 11. Provozní den dává spoušť přes
--   app.business_date; příchod se vkládá dřív než odchod, aby odchod
--   den zdědil (pravidlo 10).
-- * Úsek se nesmí přesunout do jiného provozního dne (otázka 29),
--   odchod musí být po příchodu, nejvýš 24 h, nic v budoucnosti.
-- * Žádný překryv s jiným záznamem ani úsekem člověka NAPŘÍČ VŠEMI
--   POBOČKAMI firmy (příchod v Perle a odchod v Bernardu je normální).
--   Přestávky úseku musí po úpravě ležet uvnitř.
-- * KONTROLA PO ZÁPISU (pravidlo 12 — posunutý záznam se nesmí tiše
--   přepárovat): úsek se musí spárovat přesně sám se sebou a ostatní
--   úseky dne (i den před a po) se nesmí změnit ani o jeden řádek.
--   Jinak výjimka a celá transakce se vrátí.
-- * Práva: attendance.manage na pobočce každého měněného či
--   stornovaného a každého nového záznamu (majitel všude). Firma
--   zaměstnance i pobočky se ověřuje zvlášť, protože has_access se
--   členstvím „celá firma" pustí i cizí pobočku. Vlastní docházku
--   upravuje jen majitel (otázka 25).
-- * Souběh: zámek řádku zaměstnance (for update) serializuje úpravy
--   a storna jednoho člověka; zastaralé id se odmítne větou „Mezitím
--   to někdo změnil — obnovte stránku."
-- * Jeden souhrnný řádek auditu se stavem před a po i s minutami dne.
--   Spoušť dál zapisuje „attendance.manual" u nových ručních záznamů
--   a „attendance.oprava" u storna ručního (šum, známý od 2. 9.).
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * app.worked_minutes ani app.earnings se nemění (pravidlo 12). Úseky
--   počítá nová app.useky_dochazky jako OPIS stavového automatu a
--   paušálu. Paušál je tím na TŘECH místech (worked_minutes,
--   vydelky_prehled, useky_dochazky) — kdo mění jedno, mění všechna;
--   shodu hlídá krok63_scenar.sql, oddíl KONTROLA SHODY (po dni
--   i globálně nad všemi daty scénářů). Sloučit worked_minutes na
--   useky_dochazky je samostatná práce nad kopií ostrých dat.
-- * Těla zapsat_rucni_dochazku, stornovat_dochazku ani píchání se
--   nemění (stornovat_dochazku jen přijde o EXECUTE, 4b).
-- * Po úpravě se nic neukládá ani nepřepočítává: výdělky, Po dnech,
--   Můj účet, dlaždice, ranní přehled, nedokončené i „v práci" se čtou
--   z událostí. Zálohy se nemění, „Zbývá" se přepočítá samo.
-- * Upozornění zaměstnanci o úpravě se neposílá (otázka 26); uvidí ji
--   v Můj účet u dne.
-- * Minulé (vyplacené) měsíce zamčené nejsou — uzávěrka mezd
--   v aplikaci není (otázka 27). Obrazovka varuje.
-- * Politiky attendance_update a attendance_delete zůstávají; bez
--   grantu nepustí nic. Kdyby se grant jednou vracel, vrací se s nimi
--   i díra (b) — proto komentář u nich.
-- * Nic z docházky, úseků ani peněz nejde do jazykového modelu
--   (pravidlo 8).
--
-- Nesdílí žádnou funkci s čekajícími 20260925150000 (pozvánky)
-- a 20260927100000 (komunikace).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SLOUPEC nahrazuje
--
-- Cizí klíč bez `on delete` (NO ACTION), ne RESTRICT: mazání firmy
-- kaskádou maže starý i nový záznam v jednom příkazu a RESTRICT by
-- ho odmítl hned u prvního. Samostatné smazání starého záznamu NO
-- ACTION odmítne stejně.
--
-- Tabulka má pro authenticated tabulkový grant select (ne sloupcové),
-- takže nový sloupec je čitelný sám. krok63 to přesto čte pod rolí
-- authenticated (CLAUDE.md, „Nový sloupec na tabulce se sloupcovými
-- granty").
-- ---------------------------------------------------------------------

alter table public.attendance_events
  add column nahrazuje uuid references public.attendance_events(id);

alter table public.attendance_events
  add constraint attendance_nahrazuje_jen_rucni
  check (nahrazuje is null or source = 'manual');

create index attendance_nahrazuje
  on public.attendance_events (nahrazuje)
  where nahrazuje is not null;

comment on column public.attendance_events.nahrazuje is
  'Nový ruční záznam, který vznikl opravou úseku, ukazuje na starý. '
  'Starý je stornovaný (duvod_storna „Oprava úseku: …"), nic se nemaže.';


-- ---------------------------------------------------------------------
-- 2. ZAMĚSTNANEC I POBOČKA PATŘÍ FIRMĚ ZÁZNAMU (nález c)
--
-- Spoušť, ne kontrola v jedné funkci: do tabulky vede víc cest
-- (píchání, ruční zápis, úprava úseku, přímý INSERT) a filtr, který
-- stojí na tom, že jiná cesta zatím není, dřív nebo později propustí.
-- ---------------------------------------------------------------------

create function app.hlida_firmu_dochazky()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
       select 1 from public.employees e
        where e.id = new.employee_id and e.tenant_id = new.tenant_id)
     or not exists (
       select 1 from public.branches b
        where b.id = new.branch_id and b.tenant_id = new.tenant_id)
  then
    raise exception 'Zaměstnanec nebo pobočka nepatří této firmě.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function app.hlida_firmu_dochazky() is
  'Záznam docházky smí mít jen zaměstnance a pobočku své firmy. Zavírá '
  'zápis hodin člověku cizí firmy přes has_access se členstvím „celá firma".';

revoke all on function app.hlida_firmu_dochazky() from public, anon, authenticated;

create trigger trg_attendance_firma
  before insert or update of tenant_id, employee_id, branch_id
  on public.attendance_events
  for each row execute function app.hlida_firmu_dochazky();


-- ---------------------------------------------------------------------
-- 3. KDO ZAPSAL, ZŮSTANE (nález a)
--
-- INSERT beze změny oproti 20260901140000: ruční záznam dostane
-- přihlášeného, píchnutí nic. Při UPDATE (storno, uzavření systémem)
-- se zadavatel nemění — storno ručního záznamu nesmí vymazat, kdo ho
-- pořídil.
-- ROZHODNOUT: otázka 28 — deset starých řádků z 2. 9. se nedoplňuje.
-- ---------------------------------------------------------------------

create or replace function app.rucni_dochazka_kdo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.entered_by := old.entered_by;
    return new;
  end if;

  if new.source = 'manual' then
    new.entered_by := (select auth.uid());
  else
    new.entered_by := null;
  end if;
  return new;
end;
$$;

revoke all on function app.rucni_dochazka_kdo() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. PŘÍMÝ ZÁPIS DO DOCHÁZKY (nález b)
--
-- Pravidla úpravy (storno místo přepisu, kontrola párování, audit)
-- jsou v definer funkcích níž. Bez tohohle by šla obejít přímým
-- zápisem přes rozhraní databáze (memory „RPC bez uzavření tabulky").
--
--   * UPDATE a DELETE pryč úplně.
--   * INSERT jen na sedmi sloupcích, na kterých stojí krok2 a krok6:
--     tenant_id, branch_id, employee_id, kind, occurred_at, source,
--     note. Všechno, co obrazovka ukazuje jako FAKT O ZÁZNAMU, se přímo
--     vložit nedá: stornovano_kdy / stornoval / duvod_storna
--     („Stornováno · majitel · důvod"), nahrazuje („opraveno z …"),
--     device_id („PIN na tabletu"), business_date (spoušť
--     set_business_date zadaný den nepřepíše — hodiny by šly přesunout
--     do jiného dne i měsíce mimo pravidla 24 h a překryvu),
--     uzavreno_systemem, mimo_rozpis, shift_id, entered_by, corrected_*.
--     Spouště si své sloupce (business_date, entered_by) doplní dál —
--     sloupcové právo se ověřuje jen u sloupců, které příkaz vyjmenuje.
--     krok5 vkládal pod přihlášeným i business_date a entered_by; jeho
--     pokusy jsou teď bez nich (měří politiku a omezení, ne sloupcové
--     právo) a „zadavatele nepodvrhneš" zkouší zvlášť: sloupec entered_by
--     přihlášený nevloží vůbec, spoušť ho přepíše i zpod superuživatele.
--   * `revoke all` + zpátky jen select: zmizí tím i MAINTAIN, který
--     Supabase na PG 17 dává k výchozím právům. `revoke maintain` by na
--     PG 16 v CI neprošel (to právo tam neexistuje), `revoke all` projde
--     na obou.
--
-- ROZHODNOUT: otázka 31 (docs/hlaseni/otazky.md) — doporučeno zavřít
-- INSERT úplně (krok2 a krok6 přepsat na superuživatele).
-- ---------------------------------------------------------------------

revoke all on public.attendance_events from authenticated;
grant select on public.attendance_events to authenticated;
grant insert (tenant_id, branch_id, employee_id, kind, occurred_at, source, note)
  on public.attendance_events to authenticated;

comment on policy attendance_update on public.attendance_events is
  'Od 20260927110000 bez grantu UPDATE pro authenticated nepustí nic. '
  'Oprava jde přes upravit_usek_dochazky / stornovat_usek_dochazky. '
  'Vrátit grant = vrátit přepis času a „odstornování" bez auditu.';
comment on policy attendance_delete on public.attendance_events is
  'Od 20260927110000 bez grantu DELETE pro authenticated nepustí nic. '
  'Docházka se nemaže, stornuje se.';


-- ---------------------------------------------------------------------
-- 4b. STARÉ STORNO JEDNOHO ZÁZNAMU SE ZAVÍRÁ (nález d)
--
-- public.stornovat_dochazku stornuje jeden záznam bez pravidel storna
-- úseku: bez „vlastní docházku jen majitel" (otázka 25), bez kontroly,
-- že se zbytek dne nepřepáruje (pravidlo 12), a bez zámku řádku
-- zaměstnance. Aplikace ji nevolá nikde — storno jde přes
-- stornovat_usek_dochazky níž. Tělo zůstává, odebírá se jen EXECUTE.
-- Kdo by ho vracel, musí do ní dostat pravidla ze stornovat_usek_dochazky;
-- krok15 ji proto volá jako superuživatel a krok63 hlídá, že
-- authenticated ji spustit nesmí.
-- ---------------------------------------------------------------------

revoke execute on function public.stornovat_dochazku(uuid, uuid, text) from authenticated;

comment on function public.stornovat_dochazku(uuid, uuid, text) is
  'Zruší záznam docházky bez mazání. Od 20260927110000 bez EXECUTE pro '
  'authenticated: obcházela pravidla storna úseku (vlastní docházka, '
  'přepárování dne). Aplikace stornuje přes stornovat_usek_dochazky.';


-- ---------------------------------------------------------------------
-- Pomůcka: čas záznamu slovy do hlášek, v pásmu POBOČKY (pravidlo 11).
-- „25. 9. 21:40". Jen pro definer funkce níž.
-- ---------------------------------------------------------------------

create function app.cas_dochazky_slovy(p_kdy timestamptz, p_branch uuid)
returns text
language sql stable set search_path = ''
as $$
  select to_char(p_kdy at time zone coalesce(app.zona_pobocky(p_branch), 'Europe/Prague'),
                 'FMDD. FMMM. HH24:MI');
$$;

revoke all on function app.cas_dochazky_slovy(timestamptz, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. app.useky_dochazky — úseky po provozních dnech
--
-- OPIS STAVOVÉHO AUTOMATU app.worked_minutes (20260913150000) 1:1,
-- jen místo součtu vrací každý úsek zvlášť — a navíc i to, co mzda
-- tiše přeskočí:
--
--   usek                 příchod → nejbližší odchod v témže provozním dni
--   otevreny             příchod bez odchodu do konce dne
--   navic_prichod        příchod, když je jiný ještě otevřený
--   odchod_bez_prichodu  odchod, když žádný příchod otevřený není
--   prestavka_mimo       začátek/konec přestávky, který automat přeskočí
--                        (začátek → sloupce prichod_*, konec → odchod_*)
--
-- KONTRAKT: floor(Σ cistych_sekund / 60) po dni = worked_minutes.minut;
-- dny s nulou worked_minutes nevrací (tady je nulový úsek vidět).
-- Hlídá krok63, oddíl KONTROLA SHODY.
--
-- Rozdíl jediný, vědomý: při shodném occurred_at rozhoduje navíc
-- created_at a id. worked_minutes pořadí shod neurčuje (a u příchodu
-- a odchodu v téže sekundě může dát pokaždé jiný výsledek); úprava
-- úseku proto NOVÝ záznam ve stejné chvíli jako jiný záznam odmítá.
--
-- POZOR: PAUŠÁL PŘESTÁVKY JE TEĎ NA TŘECH MÍSTECH — worked_minutes,
-- vydelky_prehled (20260924140000) a tady. Kdo mění jedno, mění
-- všechna; krok55 a krok63 spadnou.
--
-- Bez security definer (vzor app.vydelek_po_dnech): volají ji jen
-- definer funkce níž, které si firmu a práva ohlídaly samy.
-- ---------------------------------------------------------------------

create function app.useky_dochazky(
  p_employee uuid,
  p_od       date,
  p_do       date
)
returns table (
  den              date,
  poradi           integer,
  druh             text,
  prichod_id       uuid,
  odchod_id        uuid,
  prichod          timestamptz,
  odchod           timestamptz,
  prichod_pobocka  uuid,
  odchod_pobocka   uuid,
  prestavky_sekund numeric,
  pausal_minut     integer,
  hrubych_sekund   numeric,
  cistych_sekund   numeric
)
language plpgsql stable set search_path = ''
as $$
declare
  v_tenant_id  uuid;
  v_platna_od  date;
  v_ts_minut   integer;
  v_ts_od      integer;

  v_u            record;
  v_den          date        := null;
  v_poradi       integer     := 0;
  v_in_id        uuid        := null;
  v_otevreno     timestamptz := null;
  v_branch_in    uuid        := null;
  v_pauza        timestamptz := null;
  v_pauzy        numeric     := 0;
  v_ma_prestavku boolean     := false;

  v_brutto         numeric := 0;
  v_odecist        numeric := 0;
  v_pausal         integer := 0;
  v_prestavka_min  integer;
  v_prestavka_od   integer;
begin
  -- Jako worked_minutes: smazaný zaměstnanec nemá nic.
  select e.tenant_id into v_tenant_id
    from public.employees e
   where e.id = p_employee and e.deleted_at is null;
  if not found then return; end if;

  select ts.prestavka_minut, ts.prestavka_od_minut, ts.prestavka_platna_od
    into v_ts_minut, v_ts_od, v_platna_od
    from public.tenant_settings ts
   where ts.tenant_id = v_tenant_id;

  for v_u in
    select a.id, a.business_date, a.kind, a.occurred_at, a.branch_id
      from public.attendance_events a
     where a.employee_id    = p_employee
       and a.business_date  between p_od and p_do
       and a.stornovano_kdy is null
     order by a.business_date, a.occurred_at, a.created_at, a.id
  loop
    if v_den is distinct from v_u.business_date then
      -- Otevřený úsek na konci dne zůstane otevřený (worked_minutes ho
      -- zahodí, tady je vidět).
      if v_den is not null and v_in_id is not null then
        v_poradi := v_poradi + 1;
        den := v_den; poradi := v_poradi; druh := 'otevreny';
        prichod_id := v_in_id; prichod := v_otevreno; prichod_pobocka := v_branch_in;
        odchod_id := null; odchod := null; odchod_pobocka := null;
        prestavky_sekund := 0; pausal_minut := 0; hrubych_sekund := null; cistych_sekund := 0;
        return next;
      end if;
      v_den          := v_u.business_date;
      v_poradi       := 0;
      v_in_id        := null;
      v_otevreno     := null;
      v_branch_in    := null;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;
    end if;

    if v_u.kind = 'in' and v_otevreno is null then
      v_in_id        := v_u.id;
      v_otevreno     := v_u.occurred_at;
      v_branch_in    := v_u.branch_id;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;

    elsif v_u.kind = 'in' then
      v_poradi := v_poradi + 1;
      den := v_den; poradi := v_poradi; druh := 'navic_prichod';
      prichod_id := v_u.id; prichod := v_u.occurred_at; prichod_pobocka := v_u.branch_id;
      odchod_id := null; odchod := null; odchod_pobocka := null;
      prestavky_sekund := 0; pausal_minut := 0; hrubych_sekund := null; cistych_sekund := 0;
      return next;

    elsif v_u.kind = 'break_start'
          and v_otevreno is not null and v_pauza is null then
      v_pauza := v_u.occurred_at;

    elsif v_u.kind = 'break_end' and v_pauza is not null then
      v_pauzy        := v_pauzy + extract(epoch from (v_u.occurred_at - v_pauza));
      v_pauza        := null;
      v_ma_prestavku := true;

    elsif v_u.kind = 'out' and v_otevreno is not null then
      v_brutto  := extract(epoch from (v_u.occurred_at - v_otevreno));
      v_odecist := 0;
      v_pausal  := 0;

      if v_ma_prestavku then
        v_odecist := v_pauzy;
      elsif v_platna_od is not null
            and v_u.business_date >= v_platna_od then
        select coalesce(b.prestavka_minut, v_ts_minut),
               coalesce(b.prestavka_od_minut, v_ts_od)
          into v_prestavka_min, v_prestavka_od
          from public.branches b
         where b.id = v_branch_in;

        if v_prestavka_min is not null
           and v_prestavka_od is not null
           and v_prestavka_min > 0
           and v_brutto >= v_prestavka_od * 60 then
          v_odecist := v_prestavka_min * 60;
          v_pausal  := v_prestavka_min;
        end if;
      end if;

      v_poradi := v_poradi + 1;
      den := v_den; poradi := v_poradi; druh := 'usek';
      prichod_id := v_in_id; prichod := v_otevreno; prichod_pobocka := v_branch_in;
      odchod_id := v_u.id; odchod := v_u.occurred_at; odchod_pobocka := v_u.branch_id;
      prestavky_sekund := case when v_ma_prestavku then v_pauzy else 0 end;
      pausal_minut     := v_pausal;
      hrubych_sekund   := v_brutto;
      cistych_sekund   := greatest(0, v_brutto - v_odecist);
      return next;

      v_in_id        := null;
      v_otevreno     := null;
      v_branch_in    := null;
      v_pauza        := null;
      v_pauzy        := 0;
      v_ma_prestavku := false;

    elsif v_u.kind = 'out' then
      v_poradi := v_poradi + 1;
      den := v_den; poradi := v_poradi; druh := 'odchod_bez_prichodu';
      prichod_id := null; prichod := null; prichod_pobocka := null;
      odchod_id := v_u.id; odchod := v_u.occurred_at; odchod_pobocka := v_u.branch_id;
      prestavky_sekund := 0; pausal_minut := 0; hrubych_sekund := null; cistych_sekund := 0;
      return next;

    else
      -- Přestávka, kterou automat přeskočí: začátek mimo úsek nebo
      -- podruhé, konec bez začátku.
      v_poradi := v_poradi + 1;
      den := v_den; poradi := v_poradi; druh := 'prestavka_mimo';
      if v_u.kind = 'break_start' then
        prichod_id := v_u.id; prichod := v_u.occurred_at; prichod_pobocka := v_u.branch_id;
        odchod_id := null; odchod := null; odchod_pobocka := null;
      else
        prichod_id := null; prichod := null; prichod_pobocka := null;
        odchod_id := v_u.id; odchod := v_u.occurred_at; odchod_pobocka := v_u.branch_id;
      end if;
      prestavky_sekund := 0; pausal_minut := 0; hrubych_sekund := null; cistych_sekund := 0;
      return next;
    end if;
  end loop;

  if v_den is not null and v_in_id is not null then
    v_poradi := v_poradi + 1;
    den := v_den; poradi := v_poradi; druh := 'otevreny';
    prichod_id := v_in_id; prichod := v_otevreno; prichod_pobocka := v_branch_in;
    odchod_id := null; odchod := null; odchod_pobocka := null;
    prestavky_sekund := 0; pausal_minut := 0; hrubych_sekund := null; cistych_sekund := 0;
    return next;
  end if;
end;
$$;

comment on function app.useky_dochazky(uuid, date, date) is
  'Úseky docházky po provozních dnech — opis stavového automatu '
  'app.worked_minutes včetně paušálu, navíc s tím, co mzda přeskočí. '
  'floor(Σ cistych_sekund/60) po dni = worked_minutes (krok63). '
  'POZOR: paušál je na třech místech (worked_minutes, vydelky_prehled, tady).';

revoke all on function app.useky_dochazky(uuid, date, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Pomůcka: popis jednoho záznamu pro obrazovku — zdroj, kdo zapsal,
-- koho nahrazuje, storno. Jen pro definer funkci níž; firmu a práva si
-- hlídá ona. Jména se berou jen z téže firmy (employees.full_name).
--
-- zdroj: 'rucne' (ruční zápis), 'pin' (PIN na tabletu = zařízení),
-- 'terminal', jinak 'kod' (kód z tabletu).
-- ---------------------------------------------------------------------

create function app.popis_zaznamu_dochazky(p_tenant uuid, p_id uuid)
returns table (
  cas            timestamptz,
  pobocka        uuid,
  zona           text,
  zdroj          text,
  poznamka       text,
  zadal          text,
  nahrazuje      uuid,
  mimo_rozpis    boolean,
  uzavreno       timestamptz,
  kind           text,
  stornovano_kdy timestamptz,
  stornoval      text,
  duvod_storna   text,
  nahrazeno      boolean
)
language sql stable set search_path = ''
as $$
  select a.occurred_at,
         a.branch_id,
         app.zona_pobocky(a.branch_id),
         case
           when a.source = 'manual'   then 'rucne'
           when a.source = 'terminal' then 'terminal'
           when a.device_id is not null then 'pin'
           else 'kod'
         end,
         nullif(btrim(a.note), ''),
         (select z.full_name from public.employees z
           where z.tenant_id = p_tenant and z.user_id = a.entered_by),
         a.nahrazuje,
         a.mimo_rozpis,
         a.uzavreno_systemem,
         a.kind,
         a.stornovano_kdy,
         (select z.full_name from public.employees z
           where z.tenant_id = p_tenant and z.user_id = a.stornoval),
         a.duvod_storna,
         exists (select 1 from public.attendance_events n where n.nahrazuje = a.id)
  from public.attendance_events a
  where a.id = p_id;
$$;

revoke all on function app.popis_zaznamu_dochazky(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. public.useky_cloveka — co ukazuje obrazovka Docházka člověka
--
-- Úseky z app.useky_dochazky za měsíc a k tomu stornované záznamy
-- měsíce (druh 'stornovano', jeden řádek na záznam). U každého konce
-- popis z app.popis_zaznamu_dochazky; stornovaný záznam stojí v
-- prichod_* (in, break_start) nebo odchod_* (out, break_end).
--
-- VIDITELNOST PO ŘÁDKU, stejně jako RLS attendance_read:
--   * člověk sám (vlastní úseky pro Můj účet) — jen jako člen firmy
--     se zapnutým provozem (app.modul_zapnuty: členství + modul),
--   * app.can_read_scoped(attendance.read) na pobočce příchodu,
--   * nebo na pobočce odchodu (protějšek dvojice z jiné pobočky).
-- payroll.read sám nestačí (otázka 30).
--
-- den_minut = app.worked_minutes toho dne, ale JEN když volající vidí
-- všechny platné záznamy dne. Vedoucí jedné pobočky jinak dostane NULL
-- — součet dne, do kterého mu chybí úsek jinde, by nesouhlasil s tím,
-- co vidí, a zároveň by prozradil, že jinde něco je.
--
-- mesic_cely = volající vidí VŠECHNY platné záznamy měsíce (u každého
-- řádku stejná hodnota). Den odpracovaný celý na pobočce, kam nevidí,
-- se jinak v řádcích vůbec neobjeví, a karta „Odpracováno" by tvrdila
-- „jako mzda", i když Výdělky ukazují víc. Prozradí jediný bit —
-- „něco je jinde", ne kdy ani kolik.
--
-- Pořadí uvnitř dne: podle času (příchod, u osamělého záznamu jeho čas),
-- ne podle pořadí automatu — „druhý příchod" v 18:15 patří pod úsek
-- 7:30 → 18:15, ne nad něj.
--
-- smi_spravovat: tlačítka Upravit/Stornovat. Rozhodují úpravové funkce
-- samy; tohle je jen kreslení, aby obrazovka nenabízela, co databáze
-- odmítne (manage na pobočce příchodu i odchodu; vlastní jen majitel).
--
-- Pravidlo 7b: uvnitř definer funkce RLS neplatí, firmu i práva si
-- filtruje sama, každý filtr jednou: e.id, e.tenant_id, e.deleted_at
-- (v CTE clovek), modul_zapnuty (jen větev „sám"), can_read_scoped
-- (ostatní). is_member se nepíše — obsahují ho obě větve.
-- ---------------------------------------------------------------------

create function public.useky_cloveka(
  p_tenant   uuid,
  p_employee uuid,
  p_mesic    date
)
returns table (
  druh                 text,
  den                  date,
  poradi               integer,
  udalost_druh         text,
  prichod_id           uuid,
  prichod              timestamptz,
  prichod_pobocka      uuid,
  prichod_zona         text,
  prichod_zdroj        text,
  prichod_poznamka     text,
  prichod_zadal        text,
  prichod_nahrazuje    uuid,
  prichod_mimo_rozpis  boolean,
  prichod_uzavreno     timestamptz,
  odchod_id            uuid,
  odchod               timestamptz,
  odchod_pobocka       uuid,
  odchod_zona          text,
  odchod_zdroj         text,
  odchod_poznamka      text,
  odchod_zadal         text,
  odchod_nahrazuje     uuid,
  odchod_mimo_rozpis   boolean,
  odchod_uzavreno      timestamptz,
  prestavky_sekund     integer,
  pausal_minut         integer,
  hrubych_sekund       integer,
  cistych_sekund       integer,
  stornovano_kdy       timestamptz,
  stornoval_jmeno      text,
  duvod_storna         text,
  nahrazeno            boolean,
  den_minut            integer,
  smi_spravovat        boolean,
  mesic_cely           boolean
)
language sql stable security definer set search_path = ''
as $$
  with clovek as (
    select e.id, e.user_id,
           date_trunc('month', p_mesic)::date as od,
           app.konec_mesice(p_mesic)          as do_,
           -- Vlastní úseky: člen firmy se zapnutým provozem. coalesce:
           -- brigádník bez účtu má user_id NULL a NULL v bool_and níž
           -- by se tiše přeskočil (den by vyšel „celý viditelný").
           coalesce(e.user_id = (select auth.uid()), false)
             and app.modul_zapnuty(p_tenant, 'provoz') as sam,
           -- Upravovat vlastní docházku smí jen majitel (otázka 25).
           (e.user_id is distinct from (select auth.uid()) or app.is_owner(p_tenant)) as smi_sebe
    from public.employees e
    where e.id = p_employee
      and e.tenant_id = p_tenant
      and e.deleted_at is null
  ),
  platne as (
    select a.business_date as den,
           bool_and(c.sam or app.can_read_scoped(p_tenant, 'attendance.read', a.branch_id)) as cely
    from clovek c
    join public.attendance_events a on a.employee_id = c.id
    where a.business_date between c.od and c.do_
      and a.stornovano_kdy is null
    group by a.business_date
  ),
  minuty as (
    select w.den, w.minut
    from clovek c
    cross join lateral app.worked_minutes(c.id, c.od, c.do_) w
  ),
  radky as (
    -- Úseky a nezapočítané záznamy.
    select u.druh, u.den, u.poradi,
           case when u.druh in ('usek', 'otevreny') then null
                else coalesce(pp.kind, po.kind) end                       as udalost_druh,
           u.prichod_id, pp.cas as prichod, pp.pobocka as prichod_pobocka, pp.zona as prichod_zona,
           pp.zdroj as prichod_zdroj, pp.poznamka as prichod_poznamka, pp.zadal as prichod_zadal,
           pp.nahrazuje as prichod_nahrazuje, pp.mimo_rozpis as prichod_mimo_rozpis,
           pp.uzavreno as prichod_uzavreno,
           u.odchod_id, po.cas as odchod, po.pobocka as odchod_pobocka, po.zona as odchod_zona,
           po.zdroj as odchod_zdroj, po.poznamka as odchod_poznamka, po.zadal as odchod_zadal,
           po.nahrazuje as odchod_nahrazuje, po.mimo_rozpis as odchod_mimo_rozpis,
           po.uzavreno as odchod_uzavreno,
           floor(u.prestavky_sekund)::integer as prestavky_sekund,
           u.pausal_minut,
           floor(u.hrubych_sekund)::integer   as hrubych_sekund,
           floor(u.cistych_sekund)::integer   as cistych_sekund,
           null::timestamptz as stornovano_kdy, null::text as stornoval_jmeno,
           null::text as duvod_storna, false as nahrazeno,
           (c.smi_sebe
             and (u.prichod_pobocka is null
                  or app.has_access(p_tenant, 'attendance.manage', u.prichod_pobocka))
             and (u.odchod_pobocka is null
                  or app.has_access(p_tenant, 'attendance.manage', u.odchod_pobocka))) as smi_spravovat
    from clovek c
    cross join lateral app.useky_dochazky(c.id, c.od, c.do_) u
    left join lateral app.popis_zaznamu_dochazky(p_tenant, u.prichod_id) pp on true
    left join lateral app.popis_zaznamu_dochazky(p_tenant, u.odchod_id) po on true
    where c.sam
       or (u.prichod_pobocka is not null
           and app.can_read_scoped(p_tenant, 'attendance.read', u.prichod_pobocka))
       or (u.odchod_pobocka is not null
           and app.can_read_scoped(p_tenant, 'attendance.read', u.odchod_pobocka))

    union all

    -- Stornované záznamy měsíce: přeškrtnuté, s důvodem, kdo a kdy.
    select 'stornovano', a.business_date, null::integer, a.kind,
           case when z.v_prichodu then a.id end,
           case when z.v_prichodu then d.cas end,
           case when z.v_prichodu then d.pobocka end,
           case when z.v_prichodu then d.zona end,
           case when z.v_prichodu then d.zdroj end,
           case when z.v_prichodu then d.poznamka end,
           case when z.v_prichodu then d.zadal end,
           case when z.v_prichodu then d.nahrazuje end,
           case when z.v_prichodu then d.mimo_rozpis end,
           case when z.v_prichodu then d.uzavreno end,
           case when not z.v_prichodu then a.id end,
           case when not z.v_prichodu then d.cas end,
           case when not z.v_prichodu then d.pobocka end,
           case when not z.v_prichodu then d.zona end,
           case when not z.v_prichodu then d.zdroj end,
           case when not z.v_prichodu then d.poznamka end,
           case when not z.v_prichodu then d.zadal end,
           case when not z.v_prichodu then d.nahrazuje end,
           case when not z.v_prichodu then d.mimo_rozpis end,
           case when not z.v_prichodu then d.uzavreno end,
           0, 0, null::integer, 0,
           d.stornovano_kdy, d.stornoval, d.duvod_storna, d.nahrazeno,
           false
    from clovek c
    join public.attendance_events a on a.employee_id = c.id
    cross join lateral (select a.kind in ('in', 'break_start') as v_prichodu) z
    cross join lateral app.popis_zaznamu_dochazky(p_tenant, a.id) d
    where a.business_date between c.od and c.do_
      and a.stornovano_kdy is not null
      and (c.sam or app.can_read_scoped(p_tenant, 'attendance.read', a.branch_id))
  )
  select r.druh, r.den, r.poradi, r.udalost_druh,
         r.prichod_id, r.prichod, r.prichod_pobocka, r.prichod_zona, r.prichod_zdroj,
         r.prichod_poznamka, r.prichod_zadal, r.prichod_nahrazuje, r.prichod_mimo_rozpis,
         r.prichod_uzavreno,
         r.odchod_id, r.odchod, r.odchod_pobocka, r.odchod_zona, r.odchod_zdroj,
         r.odchod_poznamka, r.odchod_zadal, r.odchod_nahrazuje, r.odchod_mimo_rozpis,
         r.odchod_uzavreno,
         r.prestavky_sekund, r.pausal_minut, r.hrubych_sekund, r.cistych_sekund,
         r.stornovano_kdy, r.stornoval_jmeno, r.duvod_storna, r.nahrazeno,
         -- Den bez platného záznamu (jen storna) je vidět celý: 0.
         case when coalesce(p.cely, true) then coalesce(m.minut, 0) end,
         r.smi_spravovat,
         -- Měsíc bez platného záznamu (jen storna) je vidět celý.
         coalesce((select bool_and(pm.cely) from platne pm), true)
  from radky r
  left join platne p on p.den = r.den
  left join minuty m on m.den = r.den
  order by r.den, r.druh = 'stornovano', coalesce(r.prichod, r.odchod), r.poradi;
$$;

comment on function public.useky_cloveka(uuid, uuid, date) is
  'Docházka člověka za měsíc po provozních dnech: úseky (opis '
  'worked_minutes), nezapočítané a stornované záznamy. Viditelnost po '
  'záznamu jako RLS attendance_read; den_minut jen tomu, kdo vidí celý den.';

revoke all on function public.useky_cloveka(uuid, uuid, date) from public, anon;
grant execute on function public.useky_cloveka(uuid, uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 6b. public.dochazka_clovek — kdo to je (hlavička obrazovky)
--
-- Jméno a domovská pobočka člověka pro obrazovku Docházka člověka.
-- Přímý select z employees nestačí: politika employees_select pouští
-- podle shifts.read nebo people.manage, ne podle docházky — vedoucí,
-- který docházku čte, ale rozpis ne, by dostal „takový člověk tu není".
--
-- Vidí ho stejný okruh jako jeho úseky (useky_cloveka): on sám (člen
-- firmy se zapnutým provozem), kdo čte docházku na jeho domovské
-- pobočce, nebo kdo čte docházku na pobočce, kde má aspoň jeden záznam
-- (vypomáhal jinde). je_sam = obrazovka pošle člověka bez práva na
-- ostatní na jeho Můj účet.
-- ---------------------------------------------------------------------

create function public.dochazka_clovek(p_tenant uuid, p_employee uuid)
returns table (full_name text, branch_id uuid, je_sam boolean)
language sql stable security definer set search_path = ''
as $$
  select e.full_name,
         e.branch_id,
         coalesce(e.user_id = (select auth.uid()), false)
  from public.employees e
  where e.id = p_employee
    and e.tenant_id = p_tenant
    and e.deleted_at is null
    and (
      (coalesce(e.user_id = (select auth.uid()), false) and app.modul_zapnuty(p_tenant, 'provoz'))
      -- Domovská pobočka. Člověk BEZ pobočky (majitel, lidé „celé
      -- firmy"): jen s docházkou na úrovni firmy. can_read_scoped s NULL
      -- pobočkou rozsah vůbec nekontroluje — vedoucí kterékoli pobočky
      -- by dostal jméno majitele (vzor vydelek_cloveka_po_dnech).
      or case
           when e.branch_id is null
             then app.has_access(p_tenant, 'attendance.read', null)
           else app.can_read_scoped(p_tenant, 'attendance.read', e.branch_id)
         end
      or exists (
        select 1 from public.attendance_events a
         where a.employee_id = e.id
           and app.can_read_scoped(p_tenant, 'attendance.read', a.branch_id))
    );
$$;

comment on function public.dochazka_clovek(uuid, uuid) is
  'Jméno a domovská pobočka člověka pro obrazovku Docházka člověka — '
  'tomu, kdo smí vidět aspoň něco z jeho docházky (nebo jemu samému).';

revoke all on function public.dochazka_clovek(uuid, uuid) from public, anon;
grant execute on function public.dochazka_clovek(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. public.vydelek_cloveka_po_dnech — peníze jednoho člověka po dnech
--
-- Rozklad app.earnings (app.vydelek_po_dnech), takže součet = earnings
-- = vydelky_prehled = Výdělky → Po dnech = Můj účet. Právo stejně jako
-- vydelky_prehled, bod 8: člověk bez pobočky (majitel) jen s
-- payroll.read na firemní úrovni, ostatní podle domovské pobočky.
--
-- e.tenant_id je tu nutný zvlášť: has_access se členstvím „celá firma"
-- vrací true pro JAKOUKOLI pobočku — majitel cizí firmy by jinak
-- s vlastním p_tenant přečetl mzdu našeho člověka.
--
-- e.deleted_at se nepíše: app.worked_minutes smazanému člověku nevrací
-- nic, takže by to byla druhá kopie filtru, kterou nejde shodit
-- (memory „nadbytečná podmínka").
-- ---------------------------------------------------------------------

create function public.vydelek_cloveka_po_dnech(
  p_tenant   uuid,
  p_employee uuid,
  p_mesic    date
)
returns table (
  den    date,
  minut  integer,
  sazba  integer,
  haleru bigint
)
language sql stable security definer set search_path = ''
as $$
  select v.den, v.minut, v.sazba, v.haleru
  from public.employees e
  cross join lateral app.vydelek_po_dnech(e.id, p_mesic) v
  where e.id = p_employee
    and e.tenant_id = p_tenant
    and case
          when e.branch_id is null
            then app.has_access(p_tenant, 'payroll.read', null)
          else app.can_read_scoped(p_tenant, 'payroll.read', e.branch_id)
        end
  order by v.den;
$$;

comment on function public.vydelek_cloveka_po_dnech(uuid, uuid, date) is
  'Hrubá mzda jednoho člověka po provozních dnech (rozklad app.earnings). '
  'Jen s payroll.read jako vydelky_prehled; sazba NULL = bez sazby.';

revoke all on function public.vydelek_cloveka_po_dnech(uuid, uuid, date) from public, anon;
grant execute on function public.vydelek_cloveka_po_dnech(uuid, uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 8. app.zapsat_rucni_zaznam — vnitřní zápis ručního záznamu
--
-- source je vždy 'manual' (ruční záznam nesmí vypadat jako píchnutí),
-- note = důvod (omezení attendance_rucni_ma_duvod), entered_by doplní
-- spoušť z přihlášeného. business_date se neposílá — dá ho spoušť
-- (pravidlo 10). Bez grantu komukoli.
-- ---------------------------------------------------------------------

create function app.zapsat_rucni_zaznam(
  p_tenant      uuid,
  p_branch      uuid,
  p_employee    uuid,
  p_kind        text,
  p_kdy         timestamptz,
  p_duvod       text,
  p_nahrazuje   uuid,
  p_mimo_rozpis boolean,
  p_shift       uuid
)
returns uuid
language plpgsql volatile set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, shift_id, kind, source,
     occurred_at, note, nahrazuje, mimo_rozpis)
  values
    (p_tenant, p_branch, p_employee, p_shift, p_kind, 'manual',
     p_kdy, btrim(p_duvod), p_nahrazuje, coalesce(p_mimo_rozpis, false))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function app.zapsat_rucni_zaznam(uuid, uuid, uuid, text, timestamptz, text, uuid, boolean, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Pomůcka: řádky app.useky_dochazky, které se úpravy NETÝKAJÍ, jako
-- seřazené jsonb — pro kontrolu po zápisu („ostatní úseky se nesmí
-- změnit ani o řádek"). p_vlastni = id záznamů upravovaného úseku.
-- ---------------------------------------------------------------------

create function app.ostatni_useky(p_employee uuid, p_den date, p_vlastni uuid[])
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(
           jsonb_agg(jsonb_build_array(u.den, u.druh, u.prichod_id, u.odchod_id)
                     order by u.den, u.druh, u.prichod_id::text, u.odchod_id::text),
           '[]'::jsonb)
  from app.useky_dochazky(p_employee, p_den - 1, p_den + 1) u
  where not coalesce(u.prichod_id = any(p_vlastni), false)
    and not coalesce(u.odchod_id = any(p_vlastni), false);
$$;

revoke all on function app.ostatni_useky(uuid, date, uuid[]) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. public.upravit_usek_dochazky — úprava úseku, doplnění, nový úsek
--
--   p_prichod + p_odchod   úprava uzavřeného úseku
--   p_prichod, bez odchodu úprava otevřeného úseku; s p_odchod_kdy
--                          doplnění odchodu (příchod zůstane)
--   bez příchodu, p_odchod doplnění příchodu k osamělému odchodu
--   nic                    nový celý úsek (příchod i odchod povinné)
--
-- Čas a pobočka NULL u existujícího záznamu = beze změny. p_*_kdy je
-- hodina na zdi (timestamp bez pásma) v pásmu pobočky toho konce.
-- Vrací id výsledného příchodu a odchodu, provozní den a minuty dne
-- před a po (app.worked_minutes).
-- ---------------------------------------------------------------------

create function public.upravit_usek_dochazky(
  p_tenant          uuid,
  p_employee        uuid,
  p_prichod         uuid,
  p_odchod          uuid,
  p_prichod_kdy     timestamp,
  p_prichod_pobocka uuid,
  p_odchod_kdy      timestamp,
  p_odchod_pobocka  uuid,
  p_duvod           text
)
returns table (
  prichod_id uuid,
  odchod_id  uuid,
  den        date,
  minut_pred integer,
  minut_po   integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_duvod      text := btrim(coalesce(p_duvod, ''));
  v_user       uuid := (select auth.uid());
  v_clovek     record;
  v_in         public.attendance_events;
  v_out        public.attendance_events;
  v_den        date;
  v_den_novy   date;
  v_druh_pred  text;

  v_in_pob     uuid;
  v_out_pob    uuid;
  v_in_kdy     timestamptz;
  v_out_kdy    timestamptz;
  v_in_zmena   boolean := false;   -- starý příchod se stornuje
  v_out_zmena  boolean := false;
  v_in_novy    boolean := false;   -- vzniká nový ruční příchod
  v_out_novy   boolean := false;
  v_ma_odchod  boolean := false;

  v_stare      uuid[];
  v_prestavky  uuid[] := '{}';
  v_vlastni    uuid[];
  v_final_in   uuid;
  v_final_out  uuid;
  v_pred       jsonb;
  v_po         jsonb;
  v_minut_pred integer;
  v_minut_po   integer;
  v_kolize     record;
begin
  -- 1. Důvod. Bez něj je oprava za půl roku k nerozeznání od chyby.
  if length(v_duvod) < 3 then
    raise exception 'Napište prosím, proč se úsek upravuje. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  -- 2. Člověk ve firmě a nesmazaný. Zámek jeho řádku serializuje
  --    všechny úpravy a storna jednoho člověka.
  select e.id, e.user_id into v_clovek
    from public.employees e
   where e.id = p_employee
     and e.tenant_id = p_tenant
     and e.deleted_at is null
     for update;
  if not found then
    raise exception 'Takový zaměstnanec v téhle firmě není.' using errcode = 'no_data_found';
  end if;

  -- 3. Staré záznamy (zámek) a jejich úsek. Jestli záznam existuje,
  --    patří tomuhle člověku, je platný, má správný druh a tvoří s druhým
  --    úsek, rozhoduje JEDINÁ kontrola: řádek automatu
  --    app.useky_dochazky(p_employee, …) — ne dvojice, kterou poslal
  --    prohlížeč. Filtry při načtení by byly její druhou kopií, kterou
  --    nejde shodit (memory „nadbytečná podmínka"). Druh úseku se proto
  --    bere z PARAMETRŮ: podvržené id nesmí z úpravy udělat „nový úsek".
  --    Firma záznamu se nepíše zvlášť — employee_id patří p_tenant (výš)
  --    a spoušť hlida_firmu_dochazky drží záznam ve firmě zaměstnance.
  if p_prichod is not null then
    select * into v_in from public.attendance_events a where a.id = p_prichod for update;
  end if;
  if p_odchod is not null then
    select * into v_out from public.attendance_events a where a.id = p_odchod for update;
  end if;

  v_den := coalesce(v_in.business_date, v_out.business_date);
  v_druh_pred := case
    when p_prichod is not null and p_odchod is not null then 'usek'
    when p_prichod is not null then 'otevreny'
    when p_odchod is not null then 'odchod_bez_prichodu'
  end;

  if v_druh_pred is not null and not exists (
       select 1 from app.useky_dochazky(p_employee, v_den, v_den) u
        where u.druh = v_druh_pred
          and u.prichod_id is not distinct from p_prichod
          and u.odchod_id  is not distinct from p_odchod)
  then
    raise exception 'Mezitím to někdo změnil — obnovte stránku.' using errcode = 'invalid_parameter_value';
  end if;

  -- 4. Nové hodnoty. Existující konec: změna = jiná pobočka nebo jiná
  --    MINUTA na zdi (formulář sekundy neposílá; nezměněný konec si je
  --    nechá). Nový konec: čas i pobočka povinné.
  if v_in.id is not null then
    v_in_pob := coalesce(p_prichod_pobocka, v_in.branch_id);
    v_in_zmena := v_in_pob <> v_in.branch_id
      or (p_prichod_kdy is not null
          and date_trunc('minute', p_prichod_kdy)
              <> date_trunc('minute', v_in.occurred_at at time zone app.zona_pobocky(v_in.branch_id)));
    if v_in_zmena then
      v_in_novy := true;
      v_in_kdy := coalesce(date_trunc('minute', p_prichod_kdy),
                           date_trunc('minute', v_in.occurred_at at time zone app.zona_pobocky(v_in.branch_id)))
                  at time zone app.zona_pobocky(v_in_pob);
    else
      v_in_kdy := v_in.occurred_at;
    end if;
  else
    if p_prichod_kdy is null then
      raise exception 'Vyplňte čas příchodu.' using errcode = 'check_violation';
    end if;
    if p_prichod_pobocka is null then
      raise exception 'Vyberte pobočku příchodu.' using errcode = 'check_violation';
    end if;
    v_in_pob  := p_prichod_pobocka;
    v_in_novy := true;
  end if;

  if v_out.id is not null then
    v_ma_odchod := true;
    v_out_pob := coalesce(p_odchod_pobocka, v_out.branch_id);
    v_out_zmena := v_out_pob <> v_out.branch_id
      or (p_odchod_kdy is not null
          and date_trunc('minute', p_odchod_kdy)
              <> date_trunc('minute', v_out.occurred_at at time zone app.zona_pobocky(v_out.branch_id)));
    if v_out_zmena then
      v_out_novy := true;
      v_out_kdy := coalesce(date_trunc('minute', p_odchod_kdy),
                            date_trunc('minute', v_out.occurred_at at time zone app.zona_pobocky(v_out.branch_id)))
                   at time zone app.zona_pobocky(v_out_pob);
    else
      v_out_kdy := v_out.occurred_at;
    end if;
  elsif p_odchod_kdy is not null then
    if p_odchod_pobocka is null then
      raise exception 'Vyberte pobočku odchodu.' using errcode = 'check_violation';
    end if;
    v_ma_odchod := true;
    v_out_pob  := p_odchod_pobocka;
    v_out_novy := true;
  elsif v_in.id is null then
    raise exception 'Vyplňte čas odchodu — nový úsek potřebuje příchod i odchod.'
      using errcode = 'check_violation';
  end if;

  if not (v_in_novy or v_out_novy) then
    raise exception 'Nic se nezměnilo — úsek zůstává, jak byl.' using errcode = 'invalid_parameter_value';
  end if;

  -- 5. Vlastní docházku upravuje jen majitel (otázka 25).
  --    ROZHODNOUT: otázka 25 (docs/hlaseni/otazky.md) — zapsat_rucni_dochazku
  --    vedoucímu vlastní záznam dnes dovoluje.
  if v_clovek.user_id = v_user and not app.is_owner(p_tenant) then
    raise exception 'Vlastní docházku si upravit nemůžete — udělá to majitel nebo jiný vedoucí.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 6. Práva na pobočce každého měněného a každého nového záznamu.
  if (v_in_zmena  and not app.has_access(p_tenant, 'attendance.manage', v_in.branch_id))
     or (v_out_zmena and not app.has_access(p_tenant, 'attendance.manage', v_out.branch_id))
     or (v_in_novy  and not app.has_access(p_tenant, 'attendance.manage', v_in_pob))
     or (v_out_novy and not app.has_access(p_tenant, 'attendance.manage', v_out_pob))
  then
    raise exception 'Upravit docházku smí jen ten, kdo ji na té pobočce spravuje.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 7. Nová pobočka patří firmě a není zrušená. has_access se členstvím
  --    „celá firma" pustí i cizí pobočku, proto zvlášť.
  if (v_in_novy and not exists (
        select 1 from public.branches b
         where b.id = v_in_pob and b.tenant_id = p_tenant and b.deleted_at is null))
     or (v_out_novy and not exists (
        select 1 from public.branches b
         where b.id = v_out_pob and b.tenant_id = p_tenant and b.deleted_at is null))
  then
    raise exception 'Pobočka v téhle firmě není.' using errcode = 'no_data_found';
  end if;

  -- Nové časy: hodina na zdi v pásmu pobočky (pravidlo 11).
  if v_in.id is null then
    v_in_kdy := date_trunc('minute', p_prichod_kdy) at time zone app.zona_pobocky(v_in_pob);
  end if;
  if v_out.id is null and v_ma_odchod then
    v_out_kdy := date_trunc('minute', p_odchod_kdy) at time zone app.zona_pobocky(v_out_pob);
  end if;

  -- 8. Pořadí, délka, budoucnost.
  if v_ma_odchod and v_out_kdy <= v_in_kdy then
    raise exception 'Odchod (%) musí být až po příchodu (%).',
      app.cas_dochazky_slovy(v_out_kdy, v_out_pob), app.cas_dochazky_slovy(v_in_kdy, v_in_pob)
      using errcode = 'check_violation';
  end if;
  if v_ma_odchod and v_out_kdy - v_in_kdy > interval '24 hours' then
    raise exception 'Úsek od % do % by trval déle než 24 hodin. Zkontrolujte datum odchodu.',
      app.cas_dochazky_slovy(v_in_kdy, v_in_pob), app.cas_dochazky_slovy(v_out_kdy, v_out_pob)
      using errcode = 'check_violation';
  end if;
  if (v_in_novy and v_in_kdy > now()) or (v_out_novy and v_out_kdy > now()) then
    raise exception 'Docházka se nezapisuje dopředu — % ještě nebylo.',
      case when v_out_novy and v_out_kdy > now()
           then app.cas_dochazky_slovy(v_out_kdy, v_out_pob)
           else app.cas_dochazky_slovy(v_in_kdy, v_in_pob) end
      using errcode = 'check_violation';
  end if;

  -- 9. Provozní den se úpravou nemění (otázka 29).
  --    ROZHODNOUT: otázka 29 — spolu s hranicí 24 h v kroku 8.
  if v_in_novy then
    v_den_novy := app.business_date(v_in_pob, v_in_kdy);
    if v_den is not null and v_den_novy <> v_den then
      if v_druh_pred = 'odchod_bez_prichodu' then
        raise exception 'Příchod % by patřil do provozního dne %, odchod je ze dne %. Příchod doplňte v témže provozním dni.',
          app.cas_dochazky_slovy(v_in_kdy, v_in_pob), to_char(v_den_novy, 'FMDD. FMMM.'), to_char(v_den, 'FMDD. FMMM.')
          using errcode = 'check_violation';
      end if;
      raise exception 'Příchod % by patřil do provozního dne %, úsek je ze dne %. Do jiného dne ho nepřesunete — stornujte ho a zapište nový v tom dni.',
        app.cas_dochazky_slovy(v_in_kdy, v_in_pob), to_char(v_den_novy, 'FMDD. FMMM.'), to_char(v_den, 'FMDD. FMMM.')
        using errcode = 'check_violation';
    end if;
    v_den := coalesce(v_den, v_den_novy);
  end if;

  -- 10. Přestávky úseku musí ležet uvnitř nových časů.
  if v_in.id is not null then
    select coalesce(array_agg(a.id), '{}') into v_prestavky
      from public.attendance_events a
     where a.employee_id = p_employee
       and a.business_date = v_den
       and a.stornovano_kdy is null
       and a.kind in ('break_start', 'break_end')
       and a.occurred_at > v_in.occurred_at
       and (v_out.id is null or a.occurred_at < v_out.occurred_at);

    select a.occurred_at, a.branch_id into v_kolize
      from public.attendance_events a
     where a.id = any(v_prestavky)
       and (a.occurred_at <= v_in_kdy or (v_ma_odchod and a.occurred_at >= v_out_kdy))
     order by a.occurred_at
     limit 1;
    if found then
      raise exception 'Přestávka v % by po úpravě ležela mimo úsek. Nejdřív ji stornujte, nebo nechte úsek kolem ní.',
        app.cas_dochazky_slovy(v_kolize.occurred_at, v_kolize.branch_id)
        using errcode = 'check_violation';
    end if;
  end if;

  v_stare   := array_remove(array[p_prichod, p_odchod], null);
  v_vlastni := v_stare || v_prestavky;

  -- 11. Překryv s jinými záznamy člověka — celá firma, všechny pobočky.
  --     Uvnitř úseku nesmí ležet nic.
  --     Shodný okamžik s cizím záznamem se hlídá jen u konce, který se
  --     MĚNÍ (nový záznam): o pořadí dvou záznamů v téže sekundě by
  --     rozhodla náhoda (worked_minutes shody neřadí). Nezměněný konec,
  --     který se dotýká sousedního úseku (odchod 14:00 v A = příchod
  --     14:00 v B), pořadí už dávno má — jinak by navazující úseky nešly
  --     upravit vůbec a zbylo by jen storno a nový zápis.
  select a.kind, a.occurred_at, a.branch_id,
         (a.occurred_at = v_in_kdy or coalesce(a.occurred_at = v_out_kdy, false)) as dotyk
    into v_kolize
    from public.attendance_events a
   where a.employee_id = p_employee
     and a.stornovano_kdy is null
     and not (a.id = any(v_vlastni))
     and (case when v_ma_odchod
               then (a.occurred_at > v_in_kdy and a.occurred_at < v_out_kdy)
                    or (v_in_novy  and a.occurred_at = v_in_kdy)
                    or (v_out_novy and a.occurred_at = v_out_kdy)
               else a.business_date = v_den
                    and (a.occurred_at > v_in_kdy
                         or (v_in_novy and a.occurred_at = v_in_kdy)) end)
   order by a.occurred_at
   limit 1;
  if found then
    if v_kolize.dotyk then
      raise exception 'Nový čas je přesně ve chvíli jiného záznamu (% v %) — o jejich pořadí by rozhodla náhoda. Posuňte ho aspoň o minutu.',
        case v_kolize.kind when 'in' then 'příchod' when 'out' then 'odchod'
                           when 'break_start' then 'začátek přestávky' else 'konec přestávky' end,
        app.cas_dochazky_slovy(v_kolize.occurred_at, v_kolize.branch_id)
        using errcode = 'check_violation';
    end if;
    raise exception 'Úsek by se překrýval s jiným záznamem (% v %). Nejdřív upravte nebo stornujte ten.',
      case v_kolize.kind when 'in' then 'příchod' when 'out' then 'odchod'
                         when 'break_start' then 'začátek přestávky' else 'konec přestávky' end,
      app.cas_dochazky_slovy(v_kolize.occurred_at, v_kolize.branch_id)
      using errcode = 'check_violation';
  end if;

  --     … s jinými úseky (i takovými, které úsek celý obejmou) a s jiným
  --     otevřeným úsekem téhož dne (trvá do teď).
  select u.druh, u.prichod, u.odchod, u.prichod_pobocka, u.odchod_pobocka into v_kolize
    from app.useky_dochazky(p_employee, v_den - 1, v_den + 1) u
   where not coalesce(u.prichod_id = any(v_vlastni), false)
     and not coalesce(u.odchod_id = any(v_vlastni), false)
     and (
       (u.druh = 'usek'
        and (case when v_ma_odchod
                  then u.prichod < v_out_kdy and u.odchod > v_in_kdy
                  else u.den = v_den and u.odchod > v_in_kdy end))
       or (u.druh = 'otevreny' and u.den = v_den
           and (not v_ma_odchod or u.prichod < v_out_kdy))
     )
   order by u.prichod
   limit 1;
  if found then
    if v_kolize.druh = 'otevreny' then
      raise exception 'Úsek by se překrýval s otevřeným úsekem od % (bez odchodu). Nejdřív mu doplňte odchod, nebo ho stornujte.',
        app.cas_dochazky_slovy(v_kolize.prichod, v_kolize.prichod_pobocka)
        using errcode = 'check_violation';
    end if;
    raise exception 'Úsek by se překrýval s úsekem % – %. Úseky jednoho člověka se nesmí překrývat.',
      app.cas_dochazky_slovy(v_kolize.prichod, v_kolize.prichod_pobocka),
      app.cas_dochazky_slovy(v_kolize.odchod, v_kolize.odchod_pobocka)
      using errcode = 'check_violation';
  end if;

  -- Stav před zápisem: ostatní úseky okolních dnů a minuty dne.
  v_pred := app.ostatni_useky(p_employee, v_den, v_stare);
  select coalesce((select w.minut from app.worked_minutes(p_employee, v_den, v_den) w), 0)
    into v_minut_pred;

  -- 12. Zápis: storno měněných, pak nový příchod, teprve pak odchod
  --     (odchod zdědí provozní den příchodu — spoušť set_business_date).
  if v_in_zmena then
    update public.attendance_events
       set stornovano_kdy = now(),
           stornoval      = v_user,
           duvod_storna   = 'Oprava úseku: ' || v_duvod
     where id = v_in.id;
  end if;
  if v_out_zmena then
    update public.attendance_events
       set stornovano_kdy = now(),
           stornoval      = v_user,
           duvod_storna   = 'Oprava úseku: ' || v_duvod
     where id = v_out.id;
  end if;

  if v_in_novy then
    v_final_in := app.zapsat_rucni_zaznam(p_tenant, v_in_pob, p_employee, 'in', v_in_kdy,
                                          v_duvod, v_in.id, v_in.mimo_rozpis, v_in.shift_id);
  else
    v_final_in := v_in.id;
  end if;
  if v_out_novy then
    v_final_out := app.zapsat_rucni_zaznam(p_tenant, v_out_pob, p_employee, 'out', v_out_kdy,
                                           v_duvod, v_out.id, v_out.mimo_rozpis, v_out.shift_id);
  else
    v_final_out := v_out.id;
  end if;

  -- 13. Kontrola po zápisu (pravidlo 12). Úsek musí být přesně sám se
  --     sebou a ostatní se nesmí změnit ani o řádek. Jinak se vrátí
  --     všechno, i storna výš.
  if not exists (
       select 1 from app.useky_dochazky(p_employee, v_den, v_den) u
        where u.druh = case when v_ma_odchod then 'usek' else 'otevreny' end
          and u.prichod_id = v_final_in
          and u.odchod_id is not distinct from v_final_out)
  then
    raise exception 'Úsek by se po úpravě nespároval sám se sebou (v tom dni je další záznam, který by se mezi ně dostal) — nic se nezapsalo.'
      using errcode = 'check_violation';
  end if;

  v_po := app.ostatni_useky(p_employee, v_den, array_remove(array[v_final_in, v_final_out], null));
  if v_po is distinct from v_pred then
    raise exception 'Úprava by změnila párování jiných záznamů v tom dni — nic se nezapsalo. Nejdřív stornujte nezapočítaný záznam.'
      using errcode = 'check_violation';
  end if;

  select coalesce((select w.minut from app.worked_minutes(p_employee, v_den, v_den) w), 0)
    into v_minut_po;

  -- 14. Jeden souhrnný řádek auditu.
  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'attendance.usek_upraven',
    p_entity_type => 'employee',
    p_entity_id   => p_employee::text,
    p_branch      => v_in_pob,
    p_before      => jsonb_build_object(
                       'den', v_den,
                       'prichod_id', v_in.id, 'prichod', v_in.occurred_at,
                       'prichod_pobocka', v_in.branch_id, 'prichod_zdroj', v_in.source,
                       'odchod_id', v_out.id, 'odchod', v_out.occurred_at,
                       'odchod_pobocka', v_out.branch_id, 'odchod_zdroj', v_out.source,
                       'minut_dne', v_minut_pred),
    p_after       => jsonb_build_object(
                       'den', v_den,
                       'prichod_id', v_final_in, 'prichod', v_in_kdy, 'prichod_pobocka', v_in_pob,
                       'odchod_id', v_final_out, 'odchod', v_out_kdy, 'odchod_pobocka', v_out_pob,
                       'duvod', v_duvod,
                       'minut_dne', v_minut_po)
  );

  return query select v_final_in, v_final_out, v_den, v_minut_pred, v_minut_po;
end;
$$;

comment on function public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text) is
  'Úprava úseku docházky: storno měněných záznamů a nové ruční s '
  'nahrazuje → starý. Doplní odchod i příchod, zapíše nový úsek. Čas je '
  'hodina na zdi v pásmu pobočky. Kontrola pořadí, 24 h, budoucnosti, '
  'provozního dne, překryvu a párování po zápisu; jinak se nic nezapíše.';

revoke all on function public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text)
  from public, anon;
grant execute on function public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- 10. public.stornovat_usek_dochazky — storno úseku nebo jednoho
--     nezapočítaného záznamu
--
-- Dvojice musí být PŘESNĚ jeden řádek app.useky_dochazky:
--   usek                příchod + odchod (+ přestávky mezi nimi)
--   otevreny            příchod (+ přestávky po něm v tom dni) —
--                       typicky „píchl se omylem"
--   navic_prichod       jen příchod
--   odchod_bez_prichodu jen odchod
--   prestavka_mimo      jen ta přestávka (začátek v p_prichod, konec
--                       v p_odchod)
--
-- Stornovaný příchod už nevrací app.otevreny_prichod, takže člověk
-- není „v práci" na Docházce, Dnes, v přehledu ani na kiosku a smí se
-- píchnout znovu. uzavreno_systemem starších příchodů se nevrací.
--
-- Storno, které by přepárovalo ostatní záznamy (den „07:30 příchod,
-- 07:30 příchod, 16:38 odchod": po stornu prvního páru by druhý příchod
-- zůstal otevřený a člověk by byl „v práci"), se odmítne s radou
-- stornovat nejdřív ten nezapočítaný.
-- ---------------------------------------------------------------------

create function public.stornovat_usek_dochazky(
  p_tenant   uuid,
  p_employee uuid,
  p_prichod  uuid,
  p_odchod   uuid,
  p_duvod    text
)
returns table (
  den         date,
  stornovano  integer,
  minut_pred  integer,
  minut_po    integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_duvod      text := btrim(coalesce(p_duvod, ''));
  v_user       uuid := (select auth.uid());
  v_clovek     record;
  v_in         public.attendance_events;
  v_out        public.attendance_events;
  v_den        date;
  v_druh       text;
  v_zaznamy    uuid[];
  v_pred       jsonb;
  v_po         jsonb;
  v_minut_pred integer;
  v_minut_po   integer;
  v_pocet      integer;
begin
  if length(v_duvod) < 3 then
    raise exception 'Napište prosím, proč se úsek stornuje. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  if p_prichod is null and p_odchod is null then
    raise exception 'Není co stornovat.' using errcode = 'invalid_parameter_value';
  end if;

  select e.id, e.user_id into v_clovek
    from public.employees e
   where e.id = p_employee
     and e.tenant_id = p_tenant
     and e.deleted_at is null
     for update;
  if not found then
    raise exception 'Takový zaměstnanec v téhle firmě není.' using errcode = 'no_data_found';
  end if;

  -- Zámek záznamů. Jestli existují, patří tomuhle člověku, jsou platné
  -- a tvoří spolu jeden řádek automatu, rozhoduje jediná kontrola níž
  -- (jako v upravit_usek_dochazky, krok 3).
  if p_prichod is not null then
    select * into v_in from public.attendance_events a where a.id = p_prichod for update;
  end if;
  if p_odchod is not null then
    select * into v_out from public.attendance_events a where a.id = p_odchod for update;
  end if;

  v_den := coalesce(v_in.business_date, v_out.business_date);

  -- Přesně jeden řádek automatu — ne dvojice, kterou si složil prohlížeč.
  select u.druh into v_druh
    from app.useky_dochazky(p_employee, v_den, v_den) u
   where u.prichod_id is not distinct from p_prichod
     and u.odchod_id  is not distinct from p_odchod;
  if v_druh is null then
    raise exception 'Mezitím to někdo změnil — obnovte stránku.' using errcode = 'invalid_parameter_value';
  end if;

  -- Záznamy ke stornu: dvojice a u úseku jeho přestávky.
  v_zaznamy := array_remove(array[p_prichod, p_odchod], null);
  if v_druh in ('usek', 'otevreny') then
    v_zaznamy := v_zaznamy || coalesce((
      select array_agg(a.id)
        from public.attendance_events a
       where a.employee_id = p_employee
         and a.business_date = v_den
         and a.stornovano_kdy is null
         and a.kind in ('break_start', 'break_end')
         and a.occurred_at > v_in.occurred_at
         and (v_out.id is null or a.occurred_at < v_out.occurred_at)), '{}');
  end if;

  if v_clovek.user_id = v_user and not app.is_owner(p_tenant) then
    raise exception 'Vlastní docházku si stornovat nemůžete — udělá to majitel nebo jiný vedoucí.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
       select 1 from public.attendance_events a
        where a.id = any(v_zaznamy)
          and not app.has_access(p_tenant, 'attendance.manage', a.branch_id))
  then
    raise exception 'Stornovat docházku smí jen ten, kdo ji na té pobočce spravuje.'
      using errcode = 'insufficient_privilege';
  end if;

  v_pred := app.ostatni_useky(p_employee, v_den, v_zaznamy);
  select coalesce((select w.minut from app.worked_minutes(p_employee, v_den, v_den) w), 0)
    into v_minut_pred;

  update public.attendance_events
     set stornovano_kdy = now(),
         stornoval      = v_user,
         duvod_storna   = 'Storno úseku: ' || v_duvod
   where id = any(v_zaznamy);
  get diagnostics v_pocet = row_count;

  v_po := app.ostatni_useky(p_employee, v_den, v_zaznamy);
  if v_po is distinct from v_pred then
    raise exception 'Storno by změnilo párování jiných záznamů v tom dni (typicky by druhý příchod zůstal otevřený a člověk by byl „v práci"). Nejdřív stornujte nezapočítaný záznam, pak tenhle úsek — nic se nestornovalo.'
      using errcode = 'check_violation';
  end if;

  select coalesce((select w.minut from app.worked_minutes(p_employee, v_den, v_den) w), 0)
    into v_minut_po;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'attendance.usek_stornovan',
    p_entity_type => 'employee',
    p_entity_id   => p_employee::text,
    p_branch      => coalesce(v_in.branch_id, v_out.branch_id),
    p_before      => jsonb_build_object(
                       'den', v_den, 'druh', v_druh,
                       'prichod_id', v_in.id, 'prichod', v_in.occurred_at,
                       'prichod_zdroj', v_in.source,
                       'odchod_id', v_out.id, 'odchod', v_out.occurred_at,
                       'odchod_zdroj', v_out.source,
                       'minut_dne', v_minut_pred),
    p_after       => jsonb_build_object(
                       'stornovano', to_jsonb(v_zaznamy),
                       'duvod', v_duvod,
                       'minut_dne', v_minut_po)
  );

  return query select v_den, v_pocet, v_minut_pred, v_minut_po;
end;
$$;

comment on function public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text) is
  'Storno úseku docházky (příchod, odchod a přestávky mezi nimi) nebo '
  'jednoho nezapočítaného záznamu. Nic se nemaže. Storno, které by '
  'přepárovalo ostatní záznamy dne, se odmítne.';

revoke all on function public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text) to authenticated;
