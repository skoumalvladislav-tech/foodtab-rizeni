-- =====================================================================
-- Finance Fáze 0, krok 2: párování faktur s pohyby — pravidla
-- =====================================================================
--
-- Co se mění (scénář supabase/tests/krok112_scenar.sql):
--
--   1. JISTÁ SHODA (párování bez člověka) = VS (bez úvodních nul) + přesná
--      částka v téže měně (prázdná měna nikdy) + účet protistrany = účet
--      dodavatele, oba platný IBAN (app.normalizovat_ucet, stejné příklady
--      jako lib/banka/ucet.ts — scripts/finance-parovani.test.mjs je čte
--      z krok112). Jednoznačně: soupeři se počítají i mezi vyřízenými.
--      Zdroj: pohyb z banky (banka_api), řádek výpisu potvrzený bankou,
--      nebo řádek výpisu z dávky, kterou PRÁVĚ nahrál člověk s právem
--      potvrzovat párování (app.smi_potvrdit_parovani — jediné místo, krok 4
--      ho přepne). Úloha (bez přihlášeného) NEpotvrzený výpis nikdy
--      nepáruje sama; řádek výpisu, který banka potvrdila stažením
--      (transakce_potvrzeni_banky), je platba z banky a páruje ho i úloha.
--      Stornovaný pohyb ani storno nikdy.
--   2. Párovat jde jen schválenou fakturu (Ke kontrole úhrady, Neuhrazeno,
--      Částečně uhrazeno), nearchivovanou, ne duplicitu. Ruční párování
--      jen ve stejné měně (prázdná = CZK). Jiná měna = ruční úhrada.
--   3. JEDEN přepočet stavu (app.faktura_stav_podle_plateb(firma, faktura)):
--      potvrzená párování ve měně faktury + nezrušené ruční úhrady proti
--      částce faktury (dobropis v absolutní hodnotě). Návrat na nulu vrátí
--      stav před úhradou (faktury.stav_pred_uhradou). Volají ho všechny
--      cesty: párování, zrušení (i automatického), storno z banky, ruční
--      úhrada a její zrušení, automatika (app.prepocitat_stav_faktury).
--   4. Stav „Uhrazeno"/„Částečně uhrazeno" přihlášený NEnastaví ani
--      nezruší přímým zápisem (spoušť trg_faktury_hlida_uhradu, SECURITY
--      INVOKER): jen funkce výš (SECURITY DEFINER) nebo služba.
--   5. NÁVRHY = řádky platby_faktury ve stavu 'navrzeno' s kódem důvodu
--      (nikdy číslo účtu — řádek jde do auditu) a jistotou. Zápis,
--      potvrzení i odmítnutí jen funkcemi níž. Odmítnutý se nevrací.
--   6. Ruční úhrada (faktury_rucni_uhrady): důvod povinný, autor, částka
--      v měně faktury (nejvýš to, co zbývá zaplatit), odkaz na pohyb
--      (jiná měna — jeden pohyb = jedna úhrada, nic jiného ho pak
--      nespáruje; kdo jen páruje, jen k návrhu a jen u pohybu potvrzeného
--      bankou), zrušení s důvodem (návrh, ze kterého vznikla, se vrátí do
--      fronty); zruší ji i storno pohybu z banky. Ruční platbu (ne výpis)
--      páruje s fakturou jen správce Faktur — je to ruční úhrada.
--      Dobropis: vratka (párování příjmu) nebo započtení proti faktuře
--      téhož dodavatele = dvě ruční úhrady se stejným zapocet_id.
--   7. Storno: storno_of musí mít stejnou částku, měnu a opačný směr.
--      Storno pohybu Z BANKY (banka_api) zruší párování stornovaného
--      pohybu a vrátí stav faktury (pod zámkem pohybu, jako párování);
--      ruční ani CSV storno nic nemění.
--
-- Ostrá data: žádný přepis. Jen nové sloupce (nullable), tabulka, funkce,
-- spouště, granty. Zkouška 11 (otázka 109): žádný nový CHECK ani NOT NULL
-- nad existujícími sloupci faktury/transakce/platby_faktury/kontakty.
-- Jediný nový unikátní index nad existujícími sloupci je
-- platby_faktury_navrh_jednou — viz ROZHODNOUT u něj.

-- ---------------------------------------------------------------------
-- 1. Pomocné funkce (čisté)
-- ---------------------------------------------------------------------

-- VS jen číslice bez úvodních nul (jako normalizovatVs v TS a otisk pohybu).
create function app.normalizovat_vs(p_vs text)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(ltrim(regexp_replace(coalesce(p_vs, ''), '[^0-9]', '', 'g'), '0'), '')
$$;

-- Měna pro součty a stav: prázdná = CZK (živě 284 faktur bez měny).
create function app.mena_nebo_czk(p_mena text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(upper(btrim(coalesce(p_mena, ''))), ''), 'CZK')
$$;

-- Písmena IBANu na čísla (A = 10 … Z = 35), ISO 13616.
create function app.iban_cislice(p_text text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_vysledek text := '';
  v_znak     text;
begin
  foreach v_znak in array regexp_split_to_array(p_text, '') loop
    if ascii(v_znak) between 65 and 90 then
      v_vysledek := v_vysledek || (ascii(v_znak) - 55)::text;
    else
      v_vysledek := v_vysledek || v_znak;
    end if;
  end loop;
  return v_vysledek;
end $$;

-- Zbytek po dělení 97 u dlouhého čísla zapsaného textem.
create function app.modulo97(p_cislice text)
returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  v_zbytek integer := 0;
  v_znak   text;
begin
  foreach v_znak in array regexp_split_to_array(p_cislice, '') loop
    v_zbytek := (v_zbytek * 10 + v_znak::integer) % 97;
  end loop;
  return v_zbytek;
end $$;

-- Účet jako platný IBAN, jinak NULL. Stejná pravidla jako normalizovatUcet
-- v lib/banka/ucet.ts (IBAN: modul 97; český tvar předčíslí-číslo/kód:
-- modul 11 podle ČNB, kód banky z Excelu doplněný na 4 číslice), jen
-- výsledek je buď IBAN, nebo nic — pro jistou shodu jiný tvar nestačí.
-- Sdílené příklady: krok112 (PRIKLADY_UCTU) a scripts/finance-parovani.test.mjs.
create function app.normalizovat_ucet(p_ucet text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_bez         text := upper(regexp_replace(coalesce(p_ucet, ''), '[[:space:] ]+', '', 'g'));
  v_m           text[];
  v_pred        text;
  v_cislo       text;
  v_kod         text;
  v_bban        text;
  v_soucet      integer;
  v_i           integer;
  v_vahy_pred   integer[] := array[10, 5, 8, 4, 2, 1];
  v_vahy_cislo  integer[] := array[6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
begin
  if v_bez = '' then
    return null;
  end if;

  if v_bez ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    if app.modulo97(app.iban_cislice(substr(v_bez, 5) || substr(v_bez, 1, 4))) = 1 then
      return v_bez;
    end if;
    return null;
  end if;

  v_m := regexp_match(v_bez, '^(?:([0-9]{1,6})-)?([0-9]{2,10})/([0-9]{3,4})$');
  if v_m is null then
    return null;
  end if;
  v_pred := lpad(coalesce(v_m[1], ''), 6, '0');
  v_cislo := lpad(v_m[2], 10, '0');
  v_kod := case when length(v_m[3]) = 3 then '0' || v_m[3] else v_m[3] end;

  v_soucet := 0;
  for v_i in 1..6 loop
    v_soucet := v_soucet + substr(v_pred, v_i, 1)::integer * v_vahy_pred[v_i];
  end loop;
  if v_soucet % 11 <> 0 then
    return null;
  end if;
  v_soucet := 0;
  for v_i in 1..10 loop
    v_soucet := v_soucet + substr(v_cislo, v_i, 1)::integer * v_vahy_cislo[v_i];
  end loop;
  if v_soucet % 11 <> 0 then
    return null;
  end if;
  if length(replace(v_cislo, '0', '')) < 2 then
    return null;
  end if;

  v_bban := v_kod || v_pred || v_cislo;
  return 'CZ' || lpad((98 - app.modulo97(app.iban_cislice(v_bban || 'CZ00')))::text, 2, '0') || v_bban;
end $$;

-- Jméno dodavatele na porovnání (malá písmena, bez mezer a interpunkce).
create function app.normalizovat_jmeno(p_jmeno text)
returns text
language sql immutable set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p_jmeno, ''), '[^[:alnum:]]+', '', 'g'))
$$;

revoke all on function app.normalizovat_vs(text) from public, anon, authenticated, service_role;
revoke all on function app.mena_nebo_czk(text) from public, anon, authenticated, service_role;
revoke all on function app.iban_cislice(text) from public, anon, authenticated, service_role;
revoke all on function app.modulo97(text) from public, anon, authenticated, service_role;
revoke all on function app.normalizovat_ucet(text) from public, anon, authenticated, service_role;
revoke all on function app.normalizovat_jmeno(text) from public, anon, authenticated, service_role;
-- Obrazovky ukazují, jestli je účet dodavatele platný IBAN — stejná funkce.
grant execute on function app.normalizovat_vs(text) to authenticated, service_role;
grant execute on function app.mena_nebo_czk(text) to authenticated, service_role;
grant execute on function app.iban_cislice(text) to authenticated, service_role;
grant execute on function app.modulo97(text) to authenticated, service_role;
grant execute on function app.normalizovat_ucet(text) to authenticated, service_role;
grant execute on function app.normalizovat_jmeno(text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2. Kdo smí: JEDNO místo pro párování, jedno pro ruční úhradu
-- ---------------------------------------------------------------------
-- Potvrdit (i zrušit, odmítnout) párování = finance.manage na pobočce účtu
-- a „Vidět přijaté faktury" za celou firmu — stejně jako dosud
-- sparovat_platbu_s_fakturou. Krok 4 tuhle funkci přepne (limit částky
-- atd.); parametr p_castka_haleru je pro něj, dnes se nepoužívá.
create function app.smi_potvrdit_parovani(p_tenant uuid, p_branch uuid default null, p_castka_haleru bigint default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(app.has_access(p_tenant, 'finance.manage', p_branch), false)
     and coalesce(app.has_access(p_tenant, 'faktury.read', null), false)
$$;

-- Ruční „zaplaceno", započtení dobropisu a „Vrátit mezi neuhrazené" =
-- správce Faktur za celou firmu (jako dosud akce v appce).
create function app.smi_rucne_uhradit(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(app.has_access(p_tenant, 'faktury.manage', null), false)
$$;

-- Pohyb, který potvrdila banka: stažení z banky (banka_api — zapisuje jen
-- synchronizace), nebo řádek výpisu, ke kterému banka poslala id pohybu
-- (transakce_potvrzeni_banky — zapisuje jen import pod službou). Ruční
-- zápis, pokladna ani výpis bez potvrzení to nejsou: ty si může zapsat
-- kdokoli se Správou financí. Kde částka úhrady na částce pohybu nezávisí
-- (ruční úhrada v jiné měně), stačí k zápisu právo párovat jen u pohybu
-- potvrzeného bankou (app.rucne_uhradit_fakturu).
create function app.pohyb_potvrzeny_bankou(p_tenant uuid, p_transakce uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.transakce t
     where t.id = p_transakce and t.tenant_id = p_tenant
       and (t.zdroj = 'banka_api'
            or (t.zdroj = 'csv_banka'
                and exists (select 1 from public.transakce_potvrzeni_banky b
                             where b.transakce_id = t.id and b.tenant_id = p_tenant))))
$$;

revoke all on function app.pohyb_potvrzeny_bankou(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function app.smi_potvrdit_parovani(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function app.smi_rucne_uhradit(uuid) from public, anon, authenticated, service_role;
grant execute on function app.smi_potvrdit_parovani(uuid, uuid, bigint) to authenticated, service_role;
grant execute on function app.smi_rucne_uhradit(uuid) to authenticated, service_role;

create function public.smi_potvrdit_parovani(p_tenant uuid, p_branch uuid default null)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select app.smi_potvrdit_parovani(p_tenant, p_branch, null)
$$;

revoke all on function public.smi_potvrdit_parovani(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.smi_potvrdit_parovani(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Nové sloupce a tabulka
-- ---------------------------------------------------------------------

-- Stav před první úhradou. Píše ho JEN spoušť (pro všechny role); při
-- vložení se vždy vynuluje (authenticated má INSERT na všechny sloupce —
-- varianta b), UPDATE tohohle sloupce přihlášený nemá.
alter table public.faktury add column stav_pred_uhradou text;
comment on column public.faktury.stav_pred_uhradou is
  'Stav faktury těsně před přechodem do „Částečně uhrazeno"/„Uhrazeno". Zrušení '
  'posledního párování nebo ruční úhrady vrátí přesně tenhle stav. Píše jen '
  'spoušť trg_faktury_hlida_uhradu.';

-- Kód důvodu návrhu (nikdy číslo účtu — řádek jde celý do auditu).
-- CHECK jen nad NOVÝM sloupcem (zkouška 11 se týká existujících).
alter table public.platby_faktury add column duvod text;
alter table public.platby_faktury add constraint platby_faktury_duvod_kod
  check (duvod is null or duvod in ('vs+castka+ucet', 'vs+castka', 'castka+dodavatel+okno', 'jina_mena', 'dobropis+vratka'));
comment on column public.platby_faktury.duvod is
  'Proč appka párování navrhla (kód, ne text pro lidi): vs+castka+ucet, vs+castka, '
  'castka+dodavatel+okno, jina_mena, dobropis+vratka. NULL u ručního párování.';

-- Jeden otevřený návrh na dvojici platba–faktura (opakované hledání
-- návrh nezdvojí).
-- ROZHODNOUT: zkouška 11 (otázka 109) nechce unikátní index nad
-- existujícími sloupci platby_faktury. Tenhle je výslovně v zadání
-- kroku 2 a je ČÁSTEČNÝ (jen stav = 'navrzeno'): živě 'navrzeno' nikdo
-- nepíše a pohybů je nula (audit 18. 11.), takže index nemá co porušit.
-- Kdyby přece jen dvojice v databázi byla, migrace spadne nahlas a nic
-- nezmění.
create unique index platby_faktury_navrh_jednou
  on public.platby_faktury (transakce_id, faktura)
  where stav = 'navrzeno';

-- Ruční úhrada faktury (zaplaceno mimo výpis, jiná měna, započtení
-- dobropisu). Zapisují a ruší ji jen funkce níž.
create table public.faktury_rucni_uhrady (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  faktura        uuid not null,
  -- V nejmenší jednotce MĚNY FAKTURY (u EUR centy).
  castka_haleru  integer not null check (castka_haleru > 0),
  duvod          text not null check (char_length(btrim(duvod)) between 5 and 500),
  -- Pohyb, ke kterému úhrada patří (platba v jiné měně). Složený klíč:
  -- jen pohyb téže firmy.
  ucet_id        uuid,
  transakce_id   uuid,
  -- Dvojice řádků jednoho započtení dobropisu (dobropis + faktura).
  zapocet_id     uuid,
  -- Návrh 'jina_mena' (platby_faktury), jehož potvrzením úhrada vznikla.
  -- Zrušení úhrady ho vrátí do fronty (app.znovu_otevrit_navrh_uhrady).
  -- Zapisují jen funkce níž (přihlášený do tabulky nepíše).
  navrh_id       uuid,
  zapsal         uuid references public.profiles(user_id) on delete set null,
  zapsano_kdy    timestamptz not null default now(),
  zruseno_kdy    timestamptz,
  zrusil         uuid references public.profiles(user_id) on delete set null,
  duvod_zruseni  text check (duvod_zruseni is null or char_length(duvod_zruseni) <= 500),
  constraint faktury_rucni_uhrady_faktura_fk
    foreign key (tenant_id, faktura) references public.faktury (tenant_id, id),
  constraint faktury_rucni_uhrady_pohyb_fk
    foreign key (tenant_id, ucet_id, transakce_id) references public.transakce (tenant_id, ucet_id, id),
  constraint faktury_rucni_uhrady_pohyb_cely
    check ((ucet_id is null) = (transakce_id is null))
);

create index faktury_rucni_uhrady_faktura on public.faktury_rucni_uhrady (tenant_id, faktura);
create index faktury_rucni_uhrady_transakce on public.faktury_rucni_uhrady (transakce_id) where transakce_id is not null;

comment on table public.faktury_rucni_uhrady is
  'Ruční úhrady faktur (důvod povinný, autor, částka v měně faktury). Zapisují '
  'a ruší jen funkce rucne_uhradit_fakturu, zapocitat_dobropis, '
  'zrusit_rucni_uhradu a vratit_fakturu_mezi_neuhrazene.';

alter table public.faktury_rucni_uhrady enable row level security;

-- Čte jen ten, kdo vidí Faktury za firmu: řádek nese fakturu, částku
-- a volný text důvodu. Fronta „Platby bez faktury" (stačí jí právo na
-- Finance) se ptá jen „je pohyb vyřízený?" funkcí
-- public.platby_bez_faktury_vyrizeni (oddíl 10) — obsah úhrady nevidí.
create policy faktury_rucni_uhrady_read on public.faktury_rucni_uhrady
  for select to authenticated
  using (tenant_id in (select app.firmy_s_pristupem('faktury.read')));

revoke all on public.faktury_rucni_uhrady from anon, authenticated, service_role;
grant select on public.faktury_rucni_uhrady to authenticated, service_role;

create trigger trg_audit_faktury_rucni_uhrady
  after insert or update or delete on public.faktury_rucni_uhrady
  for each row execute function app.audit_zmenu('faktura_rucni_uhrada');


-- ---------------------------------------------------------------------
-- 4. Kdo nahrál dávku výpisu — zapíše databáze, ne volající
-- ---------------------------------------------------------------------
-- Jistá shoda z NEpotvrzeného výpisu platí jen pro dávku, kterou nahrál
-- člověk s právem potvrzovat párování (app.sparovat_jiste_z_davky).
-- Přihlášený si „nahral" nevybírá — vždy on sám.
create function app.import_davky_nahral()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.nahral := (select auth.uid());
  elsif new.nahral is null then
    new.nahral := (select auth.uid());
  end if;
  return new;
end $$;

revoke all on function app.import_davky_nahral() from public, anon, authenticated, service_role;

create trigger trg_import_davky_nahral
  before insert on public.import_davky
  for each row execute function app.import_davky_nahral();


-- ---------------------------------------------------------------------
-- 5. Stav faktury podle plateb — JEDNA funkce
-- ---------------------------------------------------------------------

-- Kolik je na fakturu zaplaceno v její měně: potvrzená párování s pohyby
-- v měně faktury (prázdná = CZK) + nezrušené ruční úhrady.
create function app.uhrazeno_faktury(p_tenant uuid, p_faktura uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((
           select sum(p.castka_haleru)
             from public.platby_faktury p
             join public.transakce t on t.id = p.transakce_id
             join public.faktury f on f.id = p.faktura
            where p.faktura = p_faktura and p.tenant_id = p_tenant and p.stav = 'potvrzeno'
              and app.mena_nebo_czk(t.mena) = app.mena_nebo_czk(f.mena)), 0)
       + coalesce((
           select sum(r.castka_haleru)
             from public.faktury_rucni_uhrady r
            where r.faktura = p_faktura and r.tenant_id = p_tenant and r.zruseno_kdy is null), 0)
$$;

revoke all on function app.uhrazeno_faktury(uuid, uuid) from public, anon, authenticated, service_role;

-- Starý podpis (součet, částka, měna, po zrušení) zahodit — stav se počítá
-- jen tady (scénář krok112 hlídá, že funkce tohoto jména je jediná).
drop function app.faktura_stav_podle_plateb(bigint, integer, text, boolean);

-- Cílový stav faktury, NULL = beze změny.
--   * součet 0: z „Uhrazeno"/„Částečně uhrazeno" zpět na stav před úhradou
--     (chybí-li, „Ke kontrole úhrady"); jinak beze změny;
--   * nepřečtená částka (0): beze změny;
--   * jen ze schválených a zaplacených stavů — odmítnutou, neschválenou,
--     duplicitu ani upomínku přepočet nepřepne;
--   * ≥ částka (dobropis v absolutní hodnotě) → „Uhrazeno", jinak „Částečně".
create function app.faktura_stav_podle_plateb(p_tenant uuid, p_faktura uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_f      record;
  v_soucet bigint;
begin
  select f.castka_haleru, f.stav, f.stav_pred_uhradou into v_f
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant;
  if not found then
    return null;
  end if;

  v_soucet := app.uhrazeno_faktury(p_tenant, p_faktura);

  if v_soucet <= 0 then
    if v_f.stav in ('Uhrazeno', 'Částečně uhrazeno') then
      -- ROZHODNOUT: bez zapamatovaného stavu (faktura zaplacená před
      -- krokem 2) se vrací „Ke kontrole úhrady".
      return coalesce(nullif(btrim(v_f.stav_pred_uhradou), ''), 'Ke kontrole úhrady');
    end if;
    return null;
  end if;

  if coalesce(v_f.castka_haleru, 0) = 0
     or v_f.stav is null
     or v_f.stav not in ('Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno', 'Uhrazeno') then
    return null;
  end if;

  return case when v_soucet >= abs(v_f.castka_haleru) then 'Uhrazeno' else 'Částečně uhrazeno' end;
end $$;

comment on function app.faktura_stav_podle_plateb(uuid, uuid) is
  'Jediný výpočet stavu faktury podle plateb (párování v měně faktury + ruční '
  'úhrady). NULL = stav se nemění. Návrat na nulu = stav před úhradou.';

revoke all on function app.faktura_stav_podle_plateb(uuid, uuid) from public, anon, authenticated, service_role;

-- Přepočítá a zapíše stav (je-li jiný). Vrací stav faktury PO přepočtu
-- (i když se nezměnil — volající ho ukazuje člověku). Volají ho všechny
-- cesty, které mění platby.
create function app.prepocitat_stav_faktury(p_tenant uuid, p_faktura uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_stav text;
begin
  v_stav := app.faktura_stav_podle_plateb(p_tenant, p_faktura);
  if v_stav is not null then
    update public.faktury
       set stav = v_stav
     where id = p_faktura and tenant_id = p_tenant and stav is distinct from v_stav;
  end if;
  return (select f.stav from public.faktury f where f.id = p_faktura and f.tenant_id = p_tenant);
end $$;

revoke all on function app.prepocitat_stav_faktury(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.prepocitat_stav_faktury(uuid, uuid) to service_role;

-- Pro úlohu automatického párování (dřív přímý update stavu ze serveru).
create function public.prepocitat_stav_faktury(p_tenant uuid, p_faktura uuid)
returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return null;
  end if;
  return app.prepocitat_stav_faktury(p_tenant, p_faktura);
end $$;

revoke all on function public.prepocitat_stav_faktury(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.prepocitat_stav_faktury(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------
-- 6. Spoušť: „Uhrazeno" jen párováním nebo ruční úhradou
-- ---------------------------------------------------------------------

-- Má faktura potvrzené párování nebo nezrušenou ruční úhradu? Pro
-- přihlášeného jen u firmy, jejíž Faktury vidí (jinak false).
create function app.faktura_ma_platby(p_tenant uuid, p_faktura uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select ((select auth.uid()) is null or coalesce(app.has_access(p_tenant, 'faktury.read', null), false)
          or coalesce(app.has_access(p_tenant, 'faktury.manage', null), false))
     and (exists (select 1 from public.platby_faktury p
                   where p.faktura = p_faktura and p.tenant_id = p_tenant and p.stav = 'potvrzeno')
          or exists (select 1 from public.faktury_rucni_uhrady r
                      where r.faktura = p_faktura and r.tenant_id = p_tenant and r.zruseno_kdy is null))
$$;

revoke all on function app.faktura_ma_platby(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.faktura_ma_platby(uuid, uuid) to authenticated, service_role;

-- SECURITY INVOKER (rozhoduje current_user). Jméno řadí spoušť ZA
-- trg_faktury_brana (stav převodu rozhodne první) a PŘED
-- trg_faktury_oznacit_duplicitu.
create function app.faktury_hlida_uhradu()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_placene    constant text[] := array['Uhrazeno', 'Částečně uhrazeno'];
  v_prihlaseny constant boolean := current_user in ('authenticated', 'anon');
  v_byla       boolean;
  v_bude       boolean;
begin
  if tg_op = 'INSERT' then
    new.stav_pred_uhradou := null;
    if v_prihlaseny and coalesce(new.stav, '') = any (v_placene) then
      raise exception 'Fakturu nejde založit jako „%". Zaplacenou ji udělá spárování s platbou nebo ruční úhrada s důvodem.', new.stav
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.stav is not distinct from old.stav then
    return new;
  end if;

  v_byla := coalesce(old.stav, '') = any (v_placene);
  v_bude := coalesce(new.stav, '') = any (v_placene);

  if v_prihlaseny then
    if v_byla or v_bude then
      raise exception 'Stav „%" mění jen párování s platbou, ruční úhrada s důvodem nebo „Vrátit mezi neuhrazené".',
        case when v_bude then new.stav else old.stav end
        using errcode = 'insufficient_privilege';
    end if;
    if app.faktura_ma_platby(old.tenant_id, old.id) then
      raise exception 'Faktura má spárovanou platbu nebo ruční úhradu — stav jde změnit až po jejich zrušení.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_bude and not v_byla then
    new.stav_pred_uhradou := old.stav;
  elsif v_byla and not v_bude then
    new.stav_pred_uhradou := null;
  end if;
  return new;
end $$;

revoke all on function app.faktury_hlida_uhradu() from public, anon, authenticated, service_role;

create trigger trg_faktury_hlida_uhradu
  before insert or update of stav on public.faktury
  for each row execute function app.faktury_hlida_uhradu();

-- Smazání faktury (Faktury → Smazat, Odmítnout): automatické návrhy, které
-- nikdo nepotvrdil (otevřené i odmítnuté), mazání nebrání — člověk o nich
-- často ani neví. Potvrzené i zrušené párování a ruční úhrady zůstávají
-- (historie plateb) a cizí klíč smazání dál odmítne. Řádky mazání se
-- zapíšou do auditu (trg_audit_platby_faktury). DEFINER: přihlášený na
-- platby_faktury DELETE nemá. Jméno řadí spoušť ZA trg_faktury_brana
-- (během převodu se nemaže nic).
create function app.faktury_smazat_navrhy()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.platby_faktury p
   where p.tenant_id = old.tenant_id and p.faktura = old.id
     and p.stav in ('navrzeno', 'zamitnuto') and p.potvrzeno_kdy is null and p.zpusob = 'automaticky';
  return old;
end $$;

revoke all on function app.faktury_smazat_navrhy() from public, anon, authenticated, service_role;

create trigger trg_faktury_smazat_navrhy
  before delete on public.faktury
  for each row execute function app.faktury_smazat_navrhy();


-- Pohyb zapsaný jako ruční úhrada faktury (platba v jiné měně) už nic
-- jiného nezaplatí: potvrzené párování s ním databáze nepustí — žádnou
-- cestou (ruční párování, potvrzení návrhu, automatika). Opačný směr
-- hlídá app.rucne_uhradit_fakturu. Jiné platby s ruční úhradou
-- nesoupeří: úhrada Jiných plateb je vždy příjem, ruční úhrada s pohybem
-- vždy výdaj.
create function app.platby_faktury_hlida_rucni_uhradu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.faktury_rucni_uhrady r
              where r.transakce_id = new.transakce_id and r.tenant_id = new.tenant_id and r.zruseno_kdy is null) then
    raise exception 'Platba je už zapsaná jako ruční úhrada faktury (v jiné měně) — spárovat ji s další fakturou nejde. Nejdřív zrušte tu úhradu.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.platby_faktury_hlida_rucni_uhradu() from public, anon, authenticated, service_role;

create trigger trg_platby_faktury_hlida_rucni_uhradu
  before insert or update of stav, transakce_id on public.platby_faktury
  for each row when (new.stav = 'potvrzeno')
  execute function app.platby_faktury_hlida_rucni_uhradu();


-- ---------------------------------------------------------------------
-- 7. Ruční párování (nová pravidla, stejný podpis)
-- ---------------------------------------------------------------------

create or replace function app.sparovat_platbu_s_fakturou(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer,
  p_jistota       numeric default null
)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint, stav_faktury text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce   bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura     bigint := hashtextextended(p_faktura::text, 0);
  v_t                record;
  v_f                record;
  v_soucet_transakce bigint;
  v_novy_soucet      bigint;
  v_castka           bigint;
  v_stav             text;
  v_navrh            uuid;
  v_cesta            text;
  v_nic              text;
begin
  if p_castka_haleru is null or p_castka_haleru <= 0 then
    raise exception 'Alokovaná částka musí být kladná.' using errcode = 'check_violation';
  end if;

  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru, t.smer, t.mena, t.storno_of, t.zdroj into v_t
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant;

  if not found then
    raise exception 'Transakce nepatří této firmě.' using errcode = 'check_violation';
  end if;

  -- Jediné místo práva párovat (krok 4 ho přepne) — žádná druhá
  -- podmínka vedle, ať se cesty nerozejdou. Hláška začíná jako dřív
  -- („Nemáte oprávnění párovat…"), ať ji krok99 a appka poznají.
  if not app.smi_potvrdit_parovani(p_tenant, v_t.branch_id, p_castka_haleru) then
    raise exception 'Nemáte oprávnění párovat platby s fakturami — smí to ten, kdo má „Správu financí" k účtu a právo „Vidět přijaté faktury" za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  -- Stav převodu až po kontrole práv (hláška by ho jinak prozradila).
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;

  -- Platba zapsaná rukou (zdroj 'rucni') nebo z pokladny není výpis
  -- z banky: spárovat ji s fakturou znamená „zaplaceno mimo výpis", tedy
  -- totéž jako ruční úhrada — smí jen správce Faktur (app.smi_rucne_uhradit).
  -- Jinak by kdo smí zapisovat platby a párovat, „zaplatil" libovolnou
  -- fakturu platbou, kterou si sám zapsal.
  -- ROZHODNOUT (otázka 148): výpis z banky (csv_banka) i bez potvrzení
  -- banky dál páruje každý, kdo párovat smí — zadání kroku 2 věří dávce
  -- toho, kdo ji nahrál. Kdyby i výpis bez potvrzení měl párovat jen
  -- správce Faktur, stačí podmínku níž zúžit na app.pohyb_potvrzeny_bankou.
  if coalesce(v_t.zdroj, '') not in ('banka_api', 'csv_banka') and not app.smi_rucne_uhradit(p_tenant) then
    raise exception 'Platbu zapsanou ručně (ne z výpisu banky) spáruje s fakturou jen ten, kdo spravuje přijaté faktury za celou firmu — je to jako ruční úhrada.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_t.storno_of is not null
     or exists (select 1 from public.transakce s where s.storno_of = p_transakce) then
    raise exception 'Stornovanou platbu (ani samotné storno) s fakturou spárovat nejde.' using errcode = 'check_violation';
  end if;

  select f.castka_haleru, f.mena, f.stav, f.archivovano, f.duplicita into v_f
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant
     for no key update;

  if not found then
    raise exception 'Faktura nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if v_f.archivovano or v_f.duplicita or v_f.stav is null
     or v_f.stav not in ('Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno') then
    raise exception 'Spárovat jde jen fakturu schválenou k úhradě (Ke kontrole úhrady, Neuhrazeno, Částečně uhrazeno) — ne neschválenou, odmítnutou, duplicitní, upomínku ani archivovanou (stav: %).', v_f.stav
      using errcode = 'check_violation';
  end if;
  if coalesce(v_f.castka_haleru, 0) = 0 then
    raise exception 'Faktura nemá přečtenou částku — spárovat ji zatím nejde.' using errcode = 'check_violation';
  end if;

  -- Přijatá faktura se platí ODCHOZÍ platbou; příchozí peníze patří Jiným
  -- platbám — kromě vratky k dobropisu (záporná částka).
  if v_f.castka_haleru > 0 and v_t.smer is distinct from 'vydaj' then
    raise exception 'S přijatou fakturou jde spárovat jen odchozí platbu (výdaj).' using errcode = 'check_violation';
  end if;
  if v_f.castka_haleru < 0 and v_t.smer is distinct from 'prijem' then
    raise exception 'Dobropis jde spárovat jen s příchozí platbou (vratkou od dodavatele).' using errcode = 'check_violation';
  end if;

  if app.mena_nebo_czk(v_t.mena) <> app.mena_nebo_czk(v_f.mena) then
    raise exception 'Platba je v jiné měně než faktura (% / %) — zapište ji jako ruční úhradu v měně faktury.',
      app.mena_nebo_czk(v_t.mena), app.mena_nebo_czk(v_f.mena)
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(p.castka_haleru), 0) into v_soucet_transakce
    from public.platby_faktury p
   where p.transakce_id = p_transakce and p.stav = 'potvrzeno';

  -- Z jedné platby nejde rozdělit víc, než kolik nese (přeplatek FAKTURY
  -- dovolený — s varováním a v auditu).
  if v_soucet_transakce + p_castka_haleru > v_t.castka_haleru then
    raise exception 'Alokace přesahuje částku platby (% + % > %).',
      v_soucet_transakce, p_castka_haleru, v_t.castka_haleru using errcode = 'check_violation';
  end if;

  v_castka := abs(v_f.castka_haleru);
  v_novy_soucet := app.uhrazeno_faktury(p_tenant, p_faktura) + p_castka_haleru;

  -- Otevřený návrh téže dvojice se potvrdí (žádný druhý řádek).
  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  update public.platby_faktury
     set stav = 'potvrzeno', castka_haleru = p_castka_haleru, jistota = coalesce(p_jistota, jistota),
         potvrzeno_kdy = now(), zpusob = 'rucne',
         potvrdil = (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid()))
   where tenant_id = p_tenant and transakce_id = p_transakce and faktura = p_faktura and stav = 'navrzeno'
  returning id into v_navrh;
  if v_navrh is null then
    insert into public.platby_faktury
      (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, potvrzeno_kdy, potvrdil, zpusob)
    values
      (p_tenant, p_transakce, p_faktura, p_castka_haleru, p_jistota, 'potvrzeno', now(),
       (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid())), 'rucne');
  end if;
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);

  v_stav := app.prepocitat_stav_faktury(p_tenant, p_faktura);

  perform app.audit(p_tenant, 'finance.platba_alokovana', 'platby_faktury', p_faktura::text, v_t.branch_id,
                    null, jsonb_build_object(
                      'transakce_id', p_transakce, 'castka_haleru', p_castka_haleru,
                      'z_navrhu', v_navrh is not null,
                      'preplatek', v_novy_soucet > v_castka,
                      'prebytek_haleru', greatest(0, v_novy_soucet - v_castka),
                      'stav_faktury', v_stav));

  return query select
    v_novy_soucet,
    v_novy_soucet >= v_castka,
    greatest(0, v_novy_soucet - v_castka)::bigint,
    v_stav;
end $$;


-- ---------------------------------------------------------------------
-- 8. Zrušení párování (člověk, automatika, storno) — jedna vnitřní cesta
-- ---------------------------------------------------------------------

-- Bez kontroly práv: volají ji jen funkce níž (po své kontrole) a spoušť
-- storna. Párování → 'zamitnuto' (automatika ho znovu nezaloží), přepočet
-- stavu, audit. Vrací cílový stav faktury.
create function app.zrusit_parovani_interne(p_tenant uuid, p_alokace uuid, p_akce text, p_duvod text, p_branch uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_cesta   text;
  v_nic     text;
  v_faktura uuid;
  v_stav    text;
begin
  select p.faktura into v_faktura
    from public.platby_faktury p
   where p.id = p_alokace and p.tenant_id = p_tenant;

  -- Řádek faktury zamknout PŘED změnou párování.
  if v_faktura is not null then
    perform 1 from public.faktury f where f.id = v_faktura for no key update;
  end if;

  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  update public.platby_faktury set stav = 'zamitnuto' where id = p_alokace and tenant_id = p_tenant;
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);

  if v_faktura is not null then
    v_stav := app.prepocitat_stav_faktury(p_tenant, v_faktura);
  end if;

  perform app.audit(p_tenant, p_akce, 'platby_faktury', coalesce(v_faktura::text, p_alokace::text), p_branch,
                    jsonb_build_object('duvod', left(coalesce(p_duvod, ''), 300), 'alokace_id', p_alokace),
                    jsonb_build_object('stav_faktury', v_stav));
  return v_stav;
end $$;

revoke all on function app.zrusit_parovani_interne(uuid, uuid, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function app.zrusit_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch   uuid;
  v_parovani text;
begin
  -- Zamknout řádek párování: dvojí kliknutí počká a uvidí, že už je zrušené.
  select u.branch_id, p.stav into v_branch, v_parovani
    from public.platby_faktury p
    join public.transakce t on t.id = p.transakce_id
    join public.platebni_ucty u on u.id = t.ucet_id
   where p.id = p_alokace and p.tenant_id = p_tenant
     for update of p;

  if not found then
    raise exception 'Párování nepatří této firmě.' using errcode = 'check_violation';
  end if;

  if not app.smi_potvrdit_parovani(p_tenant, v_branch, null) then
    raise exception 'Rušit párování s fakturami smí ten, kdo má „Správu financí" k účtu a právo „Vidět přijaté faktury" za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;
  if v_parovani is distinct from 'potvrzeno' then
    raise exception 'Párování už není potvrzené (stav: %) — není co rušit.', v_parovani
      using errcode = 'check_violation';
  end if;

  return app.zrusit_parovani_interne(p_tenant, p_alokace, 'finance.platba_zrusena', p_duvod, v_branch);
end $$;

create or replace function app.zrusit_automaticke_parovani_faktury(p_tenant uuid, p_alokace uuid, p_duvod text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return false;
  end if;

  perform 1 from public.platby_faktury p
   where p.id = p_alokace and p.tenant_id = p_tenant and p.zpusob = 'automaticky' and p.stav = 'potvrzeno'
     for update;
  if not found then
    return false;
  end if;

  perform app.zrusit_parovani_interne(p_tenant, p_alokace, 'finance.automaticke_parovani_zruseno', p_duvod, null);
  return true;
end $$;


-- ---------------------------------------------------------------------
-- 9. Jistá shoda a automatické párování
-- ---------------------------------------------------------------------

-- Proč dvojice NENÍ jistá shoda (kód), NULL = je. p_davka = dávka výpisu,
-- za kterou ručí přihlášený člověk (jen v app.sparovat_jiste_z_davky).
create function app.posoudit_jistou_shodu(p_tenant uuid, p_transakce uuid, p_faktura uuid, p_davka uuid default null)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t      record;
  v_f      record;
  v_vs     text;
  v_iban   text;
  v_datum  date;
begin
  select t.id, t.castka_haleru, t.smer, t.mena, t.vs, t.protiucet, t.zdroj, t.storno_of, t.import_davka_id,
         t.datum, u.branch_id
    into v_t
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant;
  if not found then
    return 'platba';
  end if;
  if v_t.smer <> 'vydaj' then
    return 'smer';
  end if;
  if v_t.storno_of is not null or exists (select 1 from public.transakce s where s.storno_of = v_t.id) then
    return 'storno';
  end if;

  -- Zdroj: z banky, řádek výpisu potvrzený bankou (= platba z banky,
  -- věří se mu stejně jako banka_api i v úloze bez přihlášeného — zadání
  -- kroku 2 po kroku 1), nebo dávka, kterou právě nahrál člověk s právem
  -- potvrzovat párování. NEpotvrzený výpis úloha (bez přihlášeného) nikdy.
  if v_t.zdroj = 'banka_api' then
    null;
  elsif v_t.zdroj = 'csv_banka'
        and exists (select 1 from public.transakce_potvrzeni_banky b
                     where b.transakce_id = v_t.id and b.tenant_id = p_tenant) then
    null;
  elsif v_t.zdroj = 'csv_banka' and p_davka is not null and v_t.import_davka_id = p_davka
        and (select auth.uid()) is not null
        and exists (select 1 from public.import_davky d
                     where d.id = p_davka and d.tenant_id = p_tenant and d.nahral = (select auth.uid()))
        and app.smi_potvrdit_parovani(p_tenant, v_t.branch_id, v_t.castka_haleru) then
    null;
  else
    return 'zdroj';
  end if;

  select f.castka_haleru, f.mena, f.stav, f.archivovano, f.duplicita, f.variabilni_symbol, f.ucet_dodavatele,
         f.datum_vystaveni, f.duzp
    into v_f
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant;
  if not found then
    return 'faktura';
  end if;
  if v_f.archivovano or v_f.duplicita or v_f.stav is null or v_f.stav not in ('Ke kontrole úhrady', 'Neuhrazeno') then
    return 'stav';
  end if;
  if coalesce(v_f.castka_haleru, 0) <= 0 then
    return 'castka';
  end if;

  -- Měna: obě vyplněné a stejné. Prázdná nikdy jistě (otázka 111).
  if btrim(coalesce(v_t.mena, '')) = '' or btrim(coalesce(v_f.mena, '')) = '' then
    return 'mena_prazdna';
  end if;
  if upper(btrim(v_t.mena)) <> upper(btrim(v_f.mena)) then
    return 'mena';
  end if;
  if v_t.castka_haleru <> v_f.castka_haleru then
    return 'castka';
  end if;

  v_vs := app.normalizovat_vs(v_t.vs);
  if v_vs is null or v_vs is distinct from app.normalizovat_vs(v_f.variabilni_symbol) then
    return 'vs';
  end if;

  v_iban := app.normalizovat_ucet(v_t.protiucet);
  if v_iban is null or v_iban is distinct from app.normalizovat_ucet(v_f.ucet_dodavatele) then
    return 'ucet';
  end if;

  -- Okno jako automatika v TS: nejvýš 30 dní před a 90 dní po faktuře.
  v_datum := coalesce(v_f.datum_vystaveni, v_f.duzp);
  if v_datum is null or v_t.datum < v_datum - 30 or v_t.datum > v_datum + 90 then
    return 'okno';
  end if;

  if exists (select 1 from public.platby_faktury p
              where p.stav = 'potvrzeno' and (p.transakce_id = p_transakce or p.faktura = p_faktura))
     or exists (select 1 from public.faktury_rucni_uhrady r
                 where r.zruseno_kdy is null and (r.faktura = p_faktura or r.transakce_id = p_transakce)) then
    return 'sparovano';
  end if;
  if exists (select 1 from public.platby_faktury p
              where p.transakce_id = p_transakce and p.faktura = p_faktura and p.stav = 'zamitnuto') then
    return 'zamitnuto';
  end if;
  if exists (select 1 from public.jine_platby z where z.uhrada_transakce_id = p_transakce) then
    return 'jine_platby';
  end if;

  -- Soupeři i mezi vyřízenými: jiná faktura firmy (jakýkoli stav, archiv,
  -- duplicita) se stejným VS a stejnou částkou, nebo s nepřečtenou.
  if exists (select 1 from public.faktury g
              where g.tenant_id = p_tenant and g.id <> p_faktura
                and app.normalizovat_vs(g.variabilni_symbol) = v_vs
                and (abs(coalesce(g.castka_haleru, 0)) = v_t.castka_haleru or coalesce(g.castka_haleru, 0) = 0)) then
    return 'souper_faktura';
  end if;
  -- … a jiný výdaj firmy se stejným VS a částkou (i spárovaný).
  if exists (select 1 from public.transakce s
              where s.tenant_id = p_tenant and s.id <> p_transakce and s.smer = 'vydaj'
                and s.castka_haleru = v_t.castka_haleru
                and app.normalizovat_vs(s.vs) = v_vs
                and s.storno_of is null
                and not exists (select 1 from public.transakce x where x.storno_of = s.id)) then
    return 'souper_platba';
  end if;
  -- Vrácená platba: příjem se stejným VS do 30 dní, částka nejvýš o 3 % menší.
  if exists (select 1 from public.transakce s
              where s.tenant_id = p_tenant and s.smer = 'prijem'
                and s.datum between v_t.datum and v_t.datum + 30
                and s.castka_haleru between floor(v_t.castka_haleru * 0.97) and v_t.castka_haleru
                and app.normalizovat_vs(s.vs) = v_vs) then
    return 'vracena';
  end if;

  return null;
end $$;

revoke all on function app.posoudit_jistou_shodu(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Zápis jisté shody (zámky, posouzení, párování, přepočet, audit).
create function app.sparovat_jiste_interne(p_tenant uuid, p_transakce uuid, p_faktura uuid, p_castka_haleru integer, p_davka uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura   bigint := hashtextextended(p_faktura::text, 0);
  v_castka         integer;
  v_branch         uuid;
  v_cesta          text;
  v_nic            text;
  v_stav           text;
begin
  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  perform 1 from public.faktury f where f.id = p_faktura and f.tenant_id = p_tenant for no key update;

  if app.posoudit_jistou_shodu(p_tenant, p_transakce, p_faktura, p_davka) is not null then
    return false;
  end if;

  select t.castka_haleru, u.branch_id into v_castka, v_branch
    from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce;
  -- Automatika nese nejvýš zbývající částku faktury — u jisté shody je to
  -- celá částka (nic jiného na faktuře není), volající ji musí znát.
  if p_castka_haleru is distinct from v_castka then
    return false;
  end if;

  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  -- Otevřený návrh téže dvojice se potvrdí místo nového řádku.
  update public.platby_faktury
     set stav = 'potvrzeno', castka_haleru = v_castka, jistota = 1, potvrzeno_kdy = now(),
         zpusob = 'automaticky', duvod = 'vs+castka+ucet'
   where tenant_id = p_tenant and transakce_id = p_transakce and faktura = p_faktura and stav = 'navrzeno';
  if not found then
    insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, potvrzeno_kdy, zpusob, duvod)
    values (p_tenant, p_transakce, p_faktura, v_castka, 1, 'potvrzeno', now(), 'automaticky', 'vs+castka+ucet');
  end if;
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);

  v_stav := app.prepocitat_stav_faktury(p_tenant, p_faktura);

  perform app.audit(p_tenant, 'finance.platba_alokovana_automaticky', 'platby_faktury', p_faktura::text, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', v_castka,
                                             'duvod', 'vs+castka+ucet', 'z_davky', p_davka is not null,
                                             'stav_faktury', v_stav));
  return true;
end $$;

revoke all on function app.sparovat_jiste_interne(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated, service_role;

-- Úloha (service_role): pohyby z banky a řádky výpisu potvrzené bankou.
-- Stejný podpis jako dřív; teď sama ověří celou jistou shodu (účet, VS,
-- měnu, soupeře) a přepočítá stav faktury.
create or replace function app.automaticky_sparovat_fakturu(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_castka_haleru is null or p_castka_haleru <= 0
     or app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return false;
  end if;
  -- Zdroje: banka_api, nebo csv_banka s potvrzením banky
  -- (app.posoudit_jistou_shodu). Úloha dávku výpisu neručí nikdy.
  return app.sparovat_jiste_interne(p_tenant, p_transakce, p_faktura, p_castka_haleru, null);
end $$;

-- Import výpisu člověkem: jisté shody z JEHO dávky. Práva rozhoduje
-- databáze (app.smi_potvrdit_parovani), ne appka — bez práva vrátí 0.
-- Dávce se věří, jen když v ní je přesně to, co zapsal její import
-- (počet řádků = pocet_novych).
create function app.sparovat_jiste_z_davky(p_tenant uuid, p_davka uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_pocet integer := 0;
  v_r     record;
begin
  if (select auth.uid()) is null
     or app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno'
     or not exists (select 1 from public.import_davky d
                     where d.id = p_davka and d.tenant_id = p_tenant and d.nahral = (select auth.uid())
                       and d.pocet_novych > 0
                       and d.pocet_novych = (select count(*) from public.transakce t where t.import_davka_id = d.id)) then
    return 0;
  end if;

  for v_r in
    select t.id as transakce, f.id as faktura, t.castka_haleru
      from public.transakce t
      join public.faktury f
        on f.tenant_id = t.tenant_id
       and f.castka_haleru = t.castka_haleru
       and app.normalizovat_vs(f.variabilni_symbol) = app.normalizovat_vs(t.vs)
     where t.tenant_id = p_tenant and t.import_davka_id = p_davka and t.smer = 'vydaj'
       and t.zdroj = 'csv_banka' and app.normalizovat_vs(t.vs) is not null
     order by t.datum, t.id
  loop
    if app.sparovat_jiste_interne(p_tenant, v_r.transakce, v_r.faktura, v_r.castka_haleru, p_davka) then
      v_pocet := v_pocet + 1;
    end if;
  end loop;
  return v_pocet;
end $$;

revoke all on function app.sparovat_jiste_z_davky(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.sparovat_jiste_z_davky(uuid, uuid) to authenticated;

create function public.sparovat_jiste_z_davky(p_tenant uuid, p_davka uuid)
returns integer
language sql security invoker set search_path = ''
as $$
  select app.sparovat_jiste_z_davky(p_tenant, p_davka)
$$;

revoke all on function public.sparovat_jiste_z_davky(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.sparovat_jiste_z_davky(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 10. Návrhy párování: zápis, potvrzení, odmítnutí
-- ---------------------------------------------------------------------

-- Zapíše návrhy (pole {transakce, faktura, castka_haleru, duvod, jistota}).
-- Hledá je serverová funkce (lib/finance-navrhy-parovani.ts) nad všemi
-- nespárovanými pohyby; databáze ověří, co se ověřit dá: firma, stav
-- faktury, směr, měna, částka nejvýš zbytek faktury i platby, dvojice
-- nebyla zamítnutá, otevřený návrh už není. Vrací počet NOVÝCH návrhů.
-- Jen služba (hledání návrhů): kód důvodu a jistotu bere od volajícího
-- a schvalovatel jim věří — přihlášený by si napsal „VS + částka + účet,
-- 100 %" k čemukoli. Přihlášenému grant chybí a funkce ho odmítne i sama.
create function app.zapsat_navrhy_parovani(p_tenant uuid, p_navrhy jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_e      jsonb;
  v_t      record;
  v_f      record;
  v_duvod  text;
  v_castka bigint;
  v_zbyva  bigint;
  v_jist   numeric;
  v_pocet  integer := 0;
  v_cesta  text;
  v_nic    text;
begin
  -- Uvnitř SECURITY DEFINER je current_user vlastník — přihlášeného pozná
  -- jen auth.uid() (služba ho nemá).
  if (select auth.uid()) is not null then
    raise exception 'Návrhy párování zapisuje jen appka (hledání návrhů), ne přihlášený.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_navrhy is null or jsonb_typeof(p_navrhy) <> 'array' then
    raise exception 'Návrhy musí být pole.' using errcode = 'check_violation';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return 0;
  end if;

  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);

  for v_e in select value from jsonb_array_elements(p_navrhy) loop
    v_duvod := v_e ->> 'duvod';
    if v_duvod is null or v_duvod not in ('vs+castka+ucet', 'vs+castka', 'castka+dodavatel+okno', 'jina_mena', 'dobropis+vratka') then
      raise exception 'Neznámý důvod návrhu: %', coalesce(v_duvod, '(chybí)') using errcode = 'check_violation';
    end if;

    select t.id, t.castka_haleru, t.smer, t.mena, t.storno_of, u.branch_id into v_t
      from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
     where t.id = (v_e ->> 'transakce')::uuid and t.tenant_id = p_tenant;
    continue when not found;
    continue when v_t.storno_of is not null
               or exists (select 1 from public.transakce s where s.storno_of = v_t.id);

    select f.id, f.castka_haleru, f.mena, f.stav, f.archivovano, f.duplicita into v_f
      from public.faktury f
     where f.id = (v_e ->> 'faktura')::uuid and f.tenant_id = p_tenant;
    continue when not found;
    continue when v_f.archivovano or v_f.duplicita or v_f.stav is null
               or v_f.stav not in ('Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno')
               or coalesce(v_f.castka_haleru, 0) = 0;
    continue when (v_f.castka_haleru > 0 and v_t.smer <> 'vydaj') or (v_f.castka_haleru < 0 and v_t.smer <> 'prijem');
    -- Jiná měna jen jako 'jina_mena' (potvrzení = ruční úhrada), stejná nikdy.
    continue when (v_duvod = 'jina_mena') <> (app.mena_nebo_czk(v_t.mena) <> app.mena_nebo_czk(v_f.mena));
    -- Ruční úhrada s pohybem jen u faktury (výdaj) — dobropis v jiné měně
    -- se nenavrhuje (vratku v jiné měně ruční úhrada nebere, otázka 142).
    continue when v_duvod = 'jina_mena' and v_f.castka_haleru < 0;

    -- Dvojice už potvrzená, zamítnutá nebo navržená → nic.
    continue when exists (select 1 from public.platby_faktury p
                           where p.transakce_id = v_t.id and p.faktura = v_f.id);
    -- Pohyb už vyřízený ruční úhradou.
    continue when exists (select 1 from public.faktury_rucni_uhrady r
                           where r.transakce_id = v_t.id and r.zruseno_kdy is null);

    v_castka := coalesce((v_e ->> 'castka_haleru')::bigint, 0);
    -- Zbytek platby (párování faktur + úhrady Jiných plateb).
    v_zbyva := v_t.castka_haleru
             - coalesce((select sum(p.castka_haleru) from public.platby_faktury p
                          where p.transakce_id = v_t.id and p.stav = 'potvrzeno'), 0)
             - coalesce((select sum(z.uhrada_castka_haleru) from public.jine_platby z
                          where z.uhrada_transakce_id = v_t.id), 0);
    v_castka := least(v_castka, v_zbyva);
    -- Nejvýš zbývající částka faktury (u jiné měny porovnat nejde).
    if v_duvod <> 'jina_mena' then
      v_castka := least(v_castka, abs(v_f.castka_haleru) - app.uhrazeno_faktury(p_tenant, v_f.id));
    end if;
    continue when v_castka <= 0;

    v_jist := least(1, greatest(0, coalesce((v_e ->> 'jistota')::numeric, 0)));

    insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, zpusob, duvod)
    values (p_tenant, v_t.id, v_f.id, v_castka::integer, round(v_jist, 3), 'navrzeno', 'automaticky', v_duvod)
    on conflict (transakce_id, faktura) where stav = 'navrzeno' do nothing;
    if found then
      v_pocet := v_pocet + 1;
    end if;
  end loop;

  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);
  return v_pocet;
end $$;

revoke all on function app.zapsat_navrhy_parovani(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.zapsat_navrhy_parovani(uuid, jsonb) to service_role;

create function public.zapsat_navrhy_parovani(p_tenant uuid, p_navrhy jsonb)
returns integer
language sql security invoker set search_path = ''
as $$
  select app.zapsat_navrhy_parovani(p_tenant, p_navrhy)
$$;

revoke all on function public.zapsat_navrhy_parovani(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.zapsat_navrhy_parovani(uuid, jsonb) to service_role;

-- Potvrzení návrhu = potvrzené párování (stejná pravidla jako ruční).
create function app.potvrdit_navrh_parovani(p_tenant uuid, p_navrh uuid)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint, stav_faktury text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_p      record;
  v_branch uuid;
begin
  select p.transakce_id, p.faktura, p.castka_haleru, p.jistota, p.duvod, p.stav into v_p
    from public.platby_faktury p
   where p.id = p_navrh and p.tenant_id = p_tenant;
  if not found then
    raise exception 'Návrh nepatří této firmě.' using errcode = 'check_violation';
  end if;
  select u.branch_id into v_branch
    from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = v_p.transakce_id;
  if not app.smi_potvrdit_parovani(p_tenant, v_branch, v_p.castka_haleru) then
    raise exception 'Nemáte oprávnění potvrzovat párování plateb s fakturami.' using errcode = 'insufficient_privilege';
  end if;
  if v_p.stav is distinct from 'navrzeno' then
    raise exception 'Návrh už není otevřený (stav: %).', v_p.stav using errcode = 'check_violation';
  end if;
  if v_p.duvod = 'jina_mena' then
    raise exception 'Platba je v jiné měně než faktura — potvrďte ji jako ruční úhradu v měně faktury.' using errcode = 'check_violation';
  end if;
  if v_p.faktura is null then
    raise exception 'Návrh nemá fakturu.' using errcode = 'check_violation';
  end if;
  -- Faktura se mezitím mohla zčásti zaplatit: návrh nesmí nést víc, než zbývá.
  if v_p.castka_haleru > (select abs(f.castka_haleru) from public.faktury f where f.id = v_p.faktura)
                         - app.uhrazeno_faktury(p_tenant, v_p.faktura) then
    raise exception 'Faktura je mezitím zčásti zaplacená a návrh je vyšší, než zbývá — spárujte ji ručně.' using errcode = 'check_violation';
  end if;

  return query select * from app.sparovat_platbu_s_fakturou(p_tenant, v_p.transakce_id, v_p.faktura, v_p.castka_haleru, v_p.jistota);
end $$;

revoke all on function app.potvrdit_navrh_parovani(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.potvrdit_navrh_parovani(uuid, uuid) to authenticated;

create function public.potvrdit_navrh_parovani(p_tenant uuid, p_navrh uuid)
returns table (alokovano_celkem_haleru bigint, plne_uhrazeno boolean, prebytek_haleru bigint, stav_faktury text)
language sql security invoker set search_path = ''
as $$
  select * from app.potvrdit_navrh_parovani(p_tenant, p_navrh)
$$;

revoke all on function public.potvrdit_navrh_parovani(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.potvrdit_navrh_parovani(uuid, uuid) to authenticated;

-- Odmítnutí návrhu: 'zamitnuto' — stejná dvojice se už nenavrhne.
create function app.odmitnout_navrh_parovani(p_tenant uuid, p_navrh uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_p      record;
  v_branch uuid;
  v_cesta  text;
  v_nic    text;
begin
  select p.transakce_id, p.faktura, p.stav, p.duvod into v_p
    from public.platby_faktury p
   where p.id = p_navrh and p.tenant_id = p_tenant
     for update;
  if not found then
    raise exception 'Návrh nepatří této firmě.' using errcode = 'check_violation';
  end if;
  select u.branch_id into v_branch
    from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = v_p.transakce_id;
  if not app.smi_potvrdit_parovani(p_tenant, v_branch, null) then
    raise exception 'Nemáte oprávnění odmítat návrhy párování.' using errcode = 'insufficient_privilege';
  end if;
  if v_p.stav is distinct from 'navrzeno' then
    raise exception 'Návrh už není otevřený (stav: %).', v_p.stav using errcode = 'check_violation';
  end if;

  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  update public.platby_faktury set stav = 'zamitnuto' where id = p_navrh;
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);

  perform app.audit(p_tenant, 'finance.navrh_parovani_odmitnut', 'platby_faktury', coalesce(v_p.faktura::text, p_navrh::text), v_branch,
                    null, jsonb_build_object('navrh_id', p_navrh, 'transakce_id', v_p.transakce_id, 'duvod', v_p.duvod));
end $$;

revoke all on function app.odmitnout_navrh_parovani(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.odmitnout_navrh_parovani(uuid, uuid) to authenticated;

create function public.odmitnout_navrh_parovani(p_tenant uuid, p_navrh uuid)
returns void
language sql security invoker set search_path = ''
as $$
  select app.odmitnout_navrh_parovani(p_tenant, p_navrh)
$$;

revoke all on function public.odmitnout_navrh_parovani(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.odmitnout_navrh_parovani(uuid, uuid) to authenticated;

-- Fronta „Platby bez faktury" (stačí právo na Finance, Faktury vidět
-- nemusí): je pohyb vyřízený ruční úhradou, nebo na něj čeká návrh
-- k faktuře, kterou jde pořád zaplatit? Jen ano/ne — obsah úhrady ani
-- faktura ven nejdou. Jen pohyby firmy na účtech, jejichž platby
-- přihlášený vidí (stejné pravidlo jako politika transakce_read).
-- Návrh k faktuře, která se mezitím zaplatila jinak, odmítla, archivovala
-- nebo je duplicita, se nepočítá — pohyb se ve frontě zase ukáže (návrh
-- sám zůstane; kdyby se faktura vrátila mezi neuhrazené, platí dál).
create function public.platby_bez_faktury_vyrizeni(p_tenant uuid, p_transakce uuid[])
returns table (transakce_id uuid, rucni_uhrada boolean, otevreny_navrh boolean)
language sql stable security definer set search_path = ''
as $$
  select t.id,
         exists (select 1 from public.faktury_rucni_uhrady r
                  where r.transakce_id = t.id and r.tenant_id = t.tenant_id and r.zruseno_kdy is null),
         exists (select 1 from public.platby_faktury p
                   join public.faktury f on f.id = p.faktura and f.tenant_id = p.tenant_id
                  where p.transakce_id = t.id and p.tenant_id = t.tenant_id and p.stav = 'navrzeno'
                    and not coalesce(f.archivovano, false) and not coalesce(f.duplicita, false)
                    and f.stav in ('Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno')
                    and app.uhrazeno_faktury(f.tenant_id, f.id) < abs(coalesce(f.castka_haleru, 0)))
    from public.transakce t
   where t.tenant_id = p_tenant
     and t.id = any (coalesce(p_transakce, '{}'::uuid[]))
     and t.ucet_id in (select app.platebni_ucty_s_pravem('finance.read'))
$$;

revoke all on function public.platby_bez_faktury_vyrizeni(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.platby_bez_faktury_vyrizeni(uuid, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- 11. Ruční úhrada, započtení dobropisu, zrušení, vrácení
-- ---------------------------------------------------------------------

-- Kontrola faktury pro ruční úhradu a započtení (schválená, ne archiv,
-- ne duplicita, přečtená částka). Zamkne řádek.
create function app.faktura_k_rucni_uhrade(p_tenant uuid, p_faktura uuid)
returns public.faktury
language plpgsql security definer set search_path = ''
as $$
declare
  v_f public.faktury;
begin
  select f.* into v_f
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant
     for no key update;
  if not found then
    raise exception 'Faktura nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if v_f.archivovano or v_f.duplicita or v_f.stav is null
     or v_f.stav not in ('Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno') then
    raise exception 'Uhradit jde jen fakturu schválenou k úhradě (Ke kontrole úhrady, Neuhrazeno, Částečně uhrazeno), nearchivovanou a ne duplicitní (stav: %).', v_f.stav
      using errcode = 'check_violation';
  end if;
  if coalesce(v_f.castka_haleru, 0) = 0 then
    raise exception 'Faktura nemá přečtenou částku.' using errcode = 'check_violation';
  end if;
  return v_f;
end $$;

revoke all on function app.faktura_k_rucni_uhrade(uuid, uuid) from public, anon, authenticated, service_role;

-- Ruční „zaplaceno" s důvodem.
--   * Bez pohybu: smí správce Faktur za celou firmu (app.smi_rucne_uhradit).
--   * p_transakce = ODCHOZÍ platba v JINÉ měně, ke které úhrada patří
--     (potvrzení návrhu 'jina_mena'): právo potvrzovat párování
--     (app.smi_potvrdit_parovani) A ZÁROVEŇ otevřený návrh 'jina_mena'
--     téže dvojice A pohyb potvrzený bankou (app.pohyb_potvrzeny_bankou)
--     — jinak jen správce Faktur. Částka úhrady na částce pohybu nezávisí
--     (kurz nikdo nepřepočítává), takže bez těchhle pojistek by kdokoli
--     s právem párovat „zaplatil" libovolnou fakturu přiložením libovolné
--     platby v cizí měně — třeba 0,50 EUR, které si sám zapsal rukou.
--   * Pohyb jen k faktuře (ne k dobropisu), jen výdaj, ne storno ani
--     stornovaný, a nikde jinde nepoužitý: ani potvrzené párování, ani
--     jiná nezrušená ruční úhrada (opačný směr hlídá spoušť
--     trg_platby_faktury_hlida_rucni_uhradu). Úhrada Jiných plateb je vždy
--     příjem, se výdajem nesoupeří.
--   * Částka v měně faktury, nejvýš to, co na faktuře zbývá zaplatit.
-- ROZHODNOUT: důvod je volný text (aspoň 5 znaků), ne pevný výběr (otázka 129).
-- ROZHODNOUT: přeplatek ruční úhradou se odmítá — přeplatit jde jen
-- párováním s platbou (otázka 143); jedna platba v jiné měně uhradí jen
-- jednu fakturu (otázka 142).
create function app.rucne_uhradit_fakturu(p_tenant uuid, p_faktura uuid, p_castka_haleru integer, p_duvod text, p_transakce uuid default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_f      public.faktury;
  v_t      record;
  v_ucet   uuid;
  v_stav   text;
  v_cesta  text;
  v_nic    text;
  v_branch uuid;
  v_navrh  uuid;
  v_zbyva  bigint;
begin
  if char_length(btrim(coalesce(p_duvod, ''))) < 5 then
    raise exception 'Napište důvod ruční úhrady (aspoň 5 znaků).' using errcode = 'check_violation';
  end if;
  if p_castka_haleru is null or p_castka_haleru <= 0 then
    raise exception 'Částka úhrady musí být kladná (v měně faktury).' using errcode = 'check_violation';
  end if;

  if p_transakce is not null then
    select t.id, t.ucet_id, t.mena, t.smer, t.storno_of, u.branch_id into v_t
      from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
     where t.id = p_transakce and t.tenant_id = p_tenant;
    if not found then
      raise exception 'Transakce nepatří této firmě.' using errcode = 'check_violation';
    end if;
    v_branch := v_t.branch_id;
    v_ucet := v_t.ucet_id;
    if not app.smi_potvrdit_parovani(p_tenant, v_t.branch_id, p_castka_haleru) then
      raise exception 'Nemáte oprávnění potvrzovat párování plateb s fakturami.' using errcode = 'insufficient_privilege';
    end if;
    -- Návrh zamknout: dvojí odeslání formuláře počká a uvidí ho vyřízený.
    select p.id into v_navrh
      from public.platby_faktury p
     where p.tenant_id = p_tenant and p.transakce_id = p_transakce and p.faktura = p_faktura
       and p.stav = 'navrzeno' and p.duvod = 'jina_mena'
       for update;
    if v_navrh is null and not app.smi_rucne_uhradit(p_tenant) then
      raise exception 'Platbu v jiné měně jde jako úhradu zapsat jen k faktuře, kterou k ní appka navrhla. Jinou dvojici zapíše jen ten, kdo spravuje přijaté faktury za celou firmu.'
        using errcode = 'insufficient_privilege';
    end if;
    if not app.pohyb_potvrzeny_bankou(p_tenant, p_transakce) and not app.smi_rucne_uhradit(p_tenant) then
      raise exception 'Platbu, kterou nepotvrdila banka (zapsanou ručně nebo z výpisu, ke kterému banka ještě nic neposlala), zapíše jako úhradu faktury v jiné měně jen ten, kdo spravuje přijaté faktury za celou firmu.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not app.smi_rucne_uhradit(p_tenant) then
    raise exception 'Ručně označit fakturu jako uhrazenou smí jen ten, kdo spravuje přijaté faktury za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;

  -- Stejné zámky jako párování a Jiné platby (pohyb, faktura).
  if p_transakce is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_transakce::text, 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_faktura::text, 0));

  v_f := app.faktura_k_rucni_uhrade(p_tenant, p_faktura);

  if p_transakce is not null then
    if v_t.storno_of is not null or exists (select 1 from public.transakce s where s.storno_of = p_transakce) then
      raise exception 'Ke stornované platbě (ani ke stornu) úhradu zapsat nejde.' using errcode = 'check_violation';
    end if;
    -- Stejná měna = spárovat v Platbách (počítá se do částky platby).
    if app.mena_nebo_czk(v_t.mena) = app.mena_nebo_czk(v_f.mena) then
      raise exception 'Platba je ve stejné měně jako faktura — spárujte ji ve Financích → Platby.' using errcode = 'check_violation';
    end if;
    if v_f.castka_haleru < 0 or v_t.smer is distinct from 'vydaj' then
      raise exception 'Úhradu s platbou jde zapsat jen k faktuře a s odchozí platbou (výdajem). Vratku k dobropisu spárujte ve Financích → Platby.'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.platby_faktury p
                where p.transakce_id = p_transakce and p.tenant_id = p_tenant and p.stav = 'potvrzeno')
       or exists (select 1 from public.faktury_rucni_uhrady r
                   where r.transakce_id = p_transakce and r.tenant_id = p_tenant and r.zruseno_kdy is null) then
      raise exception 'Platba už je použitá (spárovaná s fakturou nebo zapsaná u jiné ruční úhrady) — jedna platba uhradí jen jednu fakturu.'
        using errcode = 'check_violation';
    end if;
  end if;

  v_zbyva := abs(v_f.castka_haleru) - app.uhrazeno_faktury(p_tenant, p_faktura);
  if p_castka_haleru > v_zbyva then
    raise exception 'Ruční úhrada je vyšší, než na faktuře zbývá zaplatit (zbývá %).',
      replace(to_char(greatest(v_zbyva, 0) / 100.0, 'FM999999999990.00'), '.', ',') || ' ' || app.mena_nebo_czk(v_f.mena)
      using errcode = 'check_violation';
  end if;

  insert into public.faktury_rucni_uhrady (tenant_id, faktura, castka_haleru, duvod, ucet_id, transakce_id, zapsal, navrh_id)
  values (p_tenant, p_faktura, p_castka_haleru, btrim(p_duvod), v_ucet, p_transakce,
          (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid())), v_navrh);

  -- Otevřený návrh 'jina_mena' téže dvojice je vyřízený. Úhrada si ho
  -- pamatuje (navrh_id): když ji někdo zruší (zrusit_rucni_uhradu,
  -- „Vrátit mezi neuhrazené"), návrh se vrátí do fronty a platbu jde
  -- s fakturou spojit znovu (app.znovu_otevrit_navrh_uhrady).
  -- ROZHODNOUT (otázka 144): návrat do fronty, ne trvalé uzavření.
  if p_transakce is not null then
    v_cesta := current_setting('foodtab.faktury_cesta', true);
    v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
    update public.platby_faktury set stav = 'zamitnuto'
     where tenant_id = p_tenant and transakce_id = p_transakce and faktura = p_faktura and stav = 'navrzeno';
    v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);
  end if;

  v_stav := app.prepocitat_stav_faktury(p_tenant, p_faktura);

  perform app.audit(p_tenant, 'faktury.rucni_uhrada', 'faktura', p_faktura::text, v_branch,
                    null, jsonb_build_object('castka_haleru', p_castka_haleru, 'mena', app.mena_nebo_czk(v_f.mena),
                                             'duvod', left(btrim(p_duvod), 300), 'transakce_id', p_transakce,
                                             'z_navrhu', v_navrh is not null,
                                             'stav_faktury', v_stav));
  return v_stav;
end $$;

revoke all on function app.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function app.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid) to authenticated;

create function public.rucne_uhradit_fakturu(p_tenant uuid, p_faktura uuid, p_castka_haleru integer, p_duvod text, p_transakce uuid default null)
returns text
language sql security invoker set search_path = ''
as $$
  select app.rucne_uhradit_fakturu(p_tenant, p_faktura, p_castka_haleru, p_duvod, p_transakce)
$$;

revoke all on function public.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.rucne_uhradit_fakturu(uuid, uuid, integer, text, uuid) to authenticated;

-- Je dobropis od téhož dodavatele jako faktura? NULL = ano, jinak proč ne.
-- Shoda jména (bez mezer a interpunkce), nebo shoda IČO — ale ne IČO
-- vlastní firmy (tenants.ico, nikdy natvrdo) a ne „sporné" IČO, pod kterým
-- jsou ve firmě aspoň dvě různá jména (otázka 110).
-- ROZHODNOUT: co je „týž dodavatel" (jméno, IČO, účet).
create function app.stejny_dodavatel(p_tenant uuid, p_jmeno_a text, p_ico_a text, p_jmeno_b text, p_ico_b text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ja  text := app.normalizovat_jmeno(p_jmeno_a);
  v_jb  text := app.normalizovat_jmeno(p_jmeno_b);
  v_ia  text := regexp_replace(coalesce(p_ico_a, ''), '[^0-9]', '', 'g');
  v_ib  text := regexp_replace(coalesce(p_ico_b, ''), '[^0-9]', '', 'g');
  v_moje text;
begin
  if v_ja <> '' and v_ja = v_jb then
    return null;
  end if;
  if v_ia = '' or v_ia <> v_ib then
    return 'Dobropis a faktura nejsou od téhož dodavatele (jméno ani IČO se neshoduje).';
  end if;
  select regexp_replace(coalesce(t.ico, ''), '[^0-9]', '', 'g') into v_moje from public.tenants t where t.id = p_tenant;
  if v_moje <> '' and v_ia = v_moje then
    return 'IČO na dokladech je IČO vaší firmy — dodavatele podle něj poznat nejde.';
  end if;
  if (select count(distinct app.normalizovat_jmeno(g.dodavatel))
        from public.faktury g
       where g.tenant_id = p_tenant
         and regexp_replace(coalesce(g.dodavatel_ico, ''), '[^0-9]', '', 'g') = v_ia
         and app.normalizovat_jmeno(g.dodavatel) <> '') >= 2 then
    return 'Pod tímto IČO je víc různých dodavatelů — započtení podle IČO nejde, zkontrolujte doklady.';
  end if;
  return null;
end $$;

revoke all on function app.stejny_dodavatel(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- Započtení dobropisu proti otevřené faktuře téhož dodavatele: dvě ruční
-- úhrady se stejným zapocet_id (CHECK castka_haleru > 0 v platby_faktury
-- by záporné párování nepustil). Vratné přes zrusit_rucni_uhradu.
create function app.zapocitat_dobropis(p_tenant uuid, p_dobropis uuid, p_faktura uuid, p_castka_haleru integer, p_duvod text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_d       public.faktury;
  v_f       public.faktury;
  v_proc    text;
  v_zapocet uuid := gen_random_uuid();
  v_autor   uuid := (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid()));
begin
  if char_length(btrim(coalesce(p_duvod, ''))) < 5 then
    raise exception 'Napište důvod započtení (aspoň 5 znaků).' using errcode = 'check_violation';
  end if;
  if p_castka_haleru is null or p_castka_haleru <= 0 then
    raise exception 'Částka započtení musí být kladná.' using errcode = 'check_violation';
  end if;
  if not app.smi_rucne_uhradit(p_tenant) then
    raise exception 'Započíst dobropis smí jen ten, kdo spravuje přijaté faktury za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;
  if p_dobropis = p_faktura then
    raise exception 'Dobropis nejde započíst sám se sebou.' using errcode = 'check_violation';
  end if;

  if p_dobropis < p_faktura then
    perform pg_advisory_xact_lock(hashtextextended(p_dobropis::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(p_faktura::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_faktura::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(p_dobropis::text, 0));
  end if;

  v_d := app.faktura_k_rucni_uhrade(p_tenant, p_dobropis);
  v_f := app.faktura_k_rucni_uhrade(p_tenant, p_faktura);
  if v_d.castka_haleru >= 0 then
    raise exception 'První doklad není dobropis (nemá zápornou částku).' using errcode = 'check_violation';
  end if;
  if v_f.castka_haleru <= 0 then
    raise exception 'Započíst jde jen proti faktuře s kladnou částkou.' using errcode = 'check_violation';
  end if;
  if app.mena_nebo_czk(v_d.mena) <> app.mena_nebo_czk(v_f.mena) then
    raise exception 'Dobropis a faktura jsou v jiné měně — započíst je nejde.' using errcode = 'check_violation';
  end if;
  v_proc := app.stejny_dodavatel(p_tenant, v_d.dodavatel, v_d.dodavatel_ico, v_f.dodavatel, v_f.dodavatel_ico);
  if v_proc is not null then
    raise exception '%', v_proc using errcode = 'check_violation';
  end if;
  if p_castka_haleru > abs(v_d.castka_haleru) - app.uhrazeno_faktury(p_tenant, p_dobropis)
     or p_castka_haleru > v_f.castka_haleru - app.uhrazeno_faktury(p_tenant, p_faktura) then
    raise exception 'Započíst jde nejvýš částku, která na dobropisu i na faktuře ještě zbývá.' using errcode = 'check_violation';
  end if;

  insert into public.faktury_rucni_uhrady (tenant_id, faktura, castka_haleru, duvod, zapocet_id, zapsal)
  values (p_tenant, p_dobropis, p_castka_haleru, btrim(p_duvod), v_zapocet, v_autor),
         (p_tenant, p_faktura, p_castka_haleru, btrim(p_duvod), v_zapocet, v_autor);

  perform app.prepocitat_stav_faktury(p_tenant, p_dobropis);
  perform app.prepocitat_stav_faktury(p_tenant, p_faktura);

  perform app.audit(p_tenant, 'faktury.dobropis_zapocten', 'faktura', p_faktura::text, null,
                    null, jsonb_build_object('dobropis', p_dobropis, 'faktura', p_faktura, 'zapocet_id', v_zapocet,
                                             'castka_haleru', p_castka_haleru, 'duvod', left(btrim(p_duvod), 300)));
  return v_zapocet;
end $$;

revoke all on function app.zapocitat_dobropis(uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function app.zapocitat_dobropis(uuid, uuid, uuid, integer, text) to authenticated;

create function public.zapocitat_dobropis(p_tenant uuid, p_dobropis uuid, p_faktura uuid, p_castka_haleru integer, p_duvod text)
returns uuid
language sql security invoker set search_path = ''
as $$
  select app.zapocitat_dobropis(p_tenant, p_dobropis, p_faktura, p_castka_haleru, p_duvod)
$$;

revoke all on function public.zapocitat_dobropis(uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.zapocitat_dobropis(uuid, uuid, uuid, integer, text) to authenticated;

-- Zrušená ruční úhrada vznikla potvrzením návrhu 'jina_mena' (navrh_id):
-- návrh se vrátí do fronty Návrhy párování. Jinak by platba zůstala
-- v „Platbách bez faktury" a znovu ji s fakturou spojit v appce nejde
-- (návrh téže dvojice hledání už nezaloží). Jen ten návrh, ze kterého
-- úhrada vznikla — návrh, který člověk odmítl sám, se nevrací. Ne
-- u stornovaného pohybu (storno návrhy zamítá) a ne, když dvojice mezitím
-- dostala jiný otevřený nebo potvrzený řádek. Bez kontroly práv: volají
-- ji jen funkce níž po své kontrole.
create function app.znovu_otevrit_navrh_uhrady(p_tenant uuid, p_navrh uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cesta text;
  v_nic   text;
begin
  if p_navrh is null then
    return;
  end if;
  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  update public.platby_faktury p
     set stav = 'navrzeno'
   where p.id = p_navrh and p.tenant_id = p_tenant
     and p.stav = 'zamitnuto' and p.duvod = 'jina_mena'
     and not exists (select 1 from public.platby_faktury q
                      where q.transakce_id = p.transakce_id and q.faktura = p.faktura and q.id <> p.id
                        and q.stav in ('navrzeno', 'potvrzeno'))
     and not exists (select 1 from public.transakce s where s.storno_of = p.transakce_id);
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);
end $$;

revoke all on function app.znovu_otevrit_navrh_uhrady(uuid, uuid) from public, anon, authenticated, service_role;

-- Zrušení ruční úhrady (i obou řádků započtení). Vrací cílový stav faktury.
-- Návrh 'jina_mena', ze kterého úhrada vznikla, se vrátí do fronty.
create function app.zrusit_rucni_uhradu(p_tenant uuid, p_uhrada uuid, p_duvod text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_u     record;
  v_r     record;
  v_stav  text;
  v_autor uuid := (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid()));
begin
  if char_length(btrim(coalesce(p_duvod, ''))) < 5 then
    raise exception 'Napište důvod zrušení (aspoň 5 znaků).' using errcode = 'check_violation';
  end if;
  if not app.smi_rucne_uhradit(p_tenant) then
    raise exception 'Zrušit ruční úhradu smí jen ten, kdo spravuje přijaté faktury za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;

  select r.id, r.faktura, r.zapocet_id, r.zruseno_kdy into v_u
    from public.faktury_rucni_uhrady r
   where r.id = p_uhrada and r.tenant_id = p_tenant
     for update;
  if not found then
    raise exception 'Ruční úhrada nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if v_u.zruseno_kdy is not null then
    raise exception 'Ruční úhrada už je zrušená.' using errcode = 'check_violation';
  end if;

  for v_r in
    update public.faktury_rucni_uhrady
       set zruseno_kdy = now(), zrusil = v_autor, duvod_zruseni = left(btrim(p_duvod), 500)
     where tenant_id = p_tenant and zruseno_kdy is null
       and (id = p_uhrada or (v_u.zapocet_id is not null and zapocet_id = v_u.zapocet_id))
    returning faktura, navrh_id
  loop
    perform app.znovu_otevrit_navrh_uhrady(p_tenant, v_r.navrh_id);
    if v_r.faktura = v_u.faktura then
      v_stav := app.prepocitat_stav_faktury(p_tenant, v_r.faktura);
    else
      perform app.prepocitat_stav_faktury(p_tenant, v_r.faktura);
    end if;
  end loop;

  perform app.audit(p_tenant, 'faktury.rucni_uhrada_zrusena', 'faktura', v_u.faktura::text, null,
                    jsonb_build_object('uhrada_id', p_uhrada, 'zapocet_id', v_u.zapocet_id),
                    jsonb_build_object('duvod', left(btrim(p_duvod), 300), 'stav_faktury', v_stav));
  return v_stav;
end $$;

revoke all on function app.zrusit_rucni_uhradu(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.zrusit_rucni_uhradu(uuid, uuid, text) to authenticated;

create function public.zrusit_rucni_uhradu(p_tenant uuid, p_uhrada uuid, p_duvod text)
returns text
language sql security invoker set search_path = ''
as $$
  select app.zrusit_rucni_uhradu(p_tenant, p_uhrada, p_duvod)
$$;

revoke all on function public.zrusit_rucni_uhradu(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.zrusit_rucni_uhradu(uuid, uuid, text) to authenticated;

-- „Vrátit mezi neuhrazené" (Faktury → Seznam) v JEDNÉ transakci: zruší
-- ruční úhrady a automatická párování faktury a přepočítá stav. Jde
-- z „Uhrazeno" i z „Částečně uhrazeno" (tlačítko je u obou). Ručně
-- potvrzená párování zůstanou — když po zrušení zůstane stav stejný
-- (kryjí celou fakturu, nebo jediné, co ji zčásti platí), nic se nezmění
-- a funkce to řekne (ruší je ten, kdo má právo na Platby). Návrhy
-- 'jina_mena', ze kterých zrušené úhrady vznikly, se vrátí do fronty.
-- Faktura se započteným dobropisem se nevrací (zrušte započtení).
create function app.vratit_fakturu_mezi_neuhrazene(p_tenant uuid, p_faktura uuid, p_duvod text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_f     record;
  v_a     record;
  v_u     record;
  v_stav  text;
  v_autor uuid := (select pr.user_id from public.profiles pr where pr.user_id = (select auth.uid()));
  v_duvod text := coalesce(nullif(btrim(coalesce(p_duvod, '')), ''), 'Ve Fakturách vráceno mezi neuhrazené.');
begin
  if not app.smi_rucne_uhradit(p_tenant) then
    raise exception 'Vrátit fakturu mezi neuhrazené smí jen ten, kdo spravuje přijaté faktury za celou firmu.'
      using errcode = 'insufficient_privilege';
  end if;
  if app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    raise exception 'Faktury pro tuto firmu nejsou otevřené.' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_faktura::text, 0));
  select f.stav into v_f from public.faktury f where f.id = p_faktura and f.tenant_id = p_tenant for no key update;
  if not found then
    raise exception 'Faktura nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if v_f.stav is null or v_f.stav not in ('Uhrazeno', 'Částečně uhrazeno') then
    raise exception 'Faktura není ve stavu Uhrazeno ani Částečně uhrazeno — nic se nezměnilo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.faktury_rucni_uhrady r
              where r.faktura = p_faktura and r.zruseno_kdy is null and r.zapocet_id is not null) then
    raise exception 'Faktura má započtený dobropis — nejdřív zrušte započtení.' using errcode = 'check_violation';
  end if;

  for v_u in
    update public.faktury_rucni_uhrady
       set zruseno_kdy = now(), zrusil = v_autor, duvod_zruseni = left(v_duvod, 500)
     where tenant_id = p_tenant and faktura = p_faktura and zruseno_kdy is null
    returning navrh_id
  loop
    perform app.znovu_otevrit_navrh_uhrady(p_tenant, v_u.navrh_id);
  end loop;

  for v_a in
    select p.id from public.platby_faktury p
     where p.tenant_id = p_tenant and p.faktura = p_faktura and p.stav = 'potvrzeno' and p.zpusob = 'automaticky'
     for update
  loop
    perform app.zrusit_parovani_interne(p_tenant, v_a.id, 'finance.automaticke_parovani_zruseno', v_duvod, null);
  end loop;

  v_stav := app.prepocitat_stav_faktury(p_tenant, p_faktura);
  if v_stav = 'Uhrazeno' then
    raise exception 'Faktura je podle ručně potvrzené platby z výpisu zaplacená celá. Když platba k faktuře nepatří, musí párování zrušit někdo s právem na Finance → Platby.'
      using errcode = 'check_violation';
  end if;
  -- Z „Částečně" zase „Částečně": nebylo co vrátit (fakturu zčásti platí
  -- jen ručně potvrzené párování) — celé zpět, nic se nezměnilo.
  if v_stav = 'Částečně uhrazeno' and v_f.stav = 'Částečně uhrazeno' then
    raise exception 'Faktura je zčásti zaplacená ručně potvrzenou platbou z výpisu — vrátit ji nejde. Když platba k faktuře nepatří, musí párování zrušit někdo s právem na Finance → Platby.'
      using errcode = 'check_violation';
  end if;

  perform app.audit(p_tenant, 'faktury.vraceno_mezi_neuhrazene', 'faktura', p_faktura::text, null,
                    jsonb_build_object('stav', v_f.stav), jsonb_build_object('stav', v_stav, 'duvod', left(v_duvod, 300)));
  return v_stav;
end $$;

revoke all on function app.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text) to authenticated;

create function public.vratit_fakturu_mezi_neuhrazene(p_tenant uuid, p_faktura uuid, p_duvod text)
returns text
language sql security invoker set search_path = ''
as $$
  select app.vratit_fakturu_mezi_neuhrazene(p_tenant, p_faktura, p_duvod)
$$;

revoke all on function public.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.vratit_fakturu_mezi_neuhrazene(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 12. Storno pohybu
-- ---------------------------------------------------------------------

-- Storno musí mít stejnou částku, měnu a opačný směr. Pohyb jiné firmy
-- nebo jiného účtu tu projde dál — odmítne ho složený cizí klíč
-- transakce_storno_tez_ucet (23503). DEFINER: přihlášený stornovaný
-- pohyb vidět nemusí, kontrola ho číst musí.
create function app.transakce_storno_kontrola()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_o record;
begin
  select o.castka_haleru, o.smer, o.mena into v_o
    from public.transakce o
   where o.id = new.storno_of and o.tenant_id = new.tenant_id and o.ucet_id = new.ucet_id;
  if not found then
    return new;
  end if;
  if v_o.castka_haleru <> new.castka_haleru
     or app.mena_nebo_czk(v_o.mena) <> app.mena_nebo_czk(new.mena)
     or new.smer is distinct from (case v_o.smer
                                     when 'prijem' then 'vydaj'
                                     when 'vydaj' then 'prijem'
                                     when 'prevod_dovnitr' then 'prevod_ven'
                                     when 'prevod_ven' then 'prevod_dovnitr'
                                   end) then
    raise exception 'Storno musí mít stejnou částku a měnu a opačný směr než stornovaný pohyb.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.transakce_storno_kontrola() from public, anon, authenticated, service_role;

create trigger trg_transakce_storno_kontrola
  before insert on public.transakce
  for each row when (new.storno_of is not null)
  execute function app.transakce_storno_kontrola();

-- Storno Z BANKY zruší párování stornovaného pohybu (stejnou cestou jako
-- člověk, s auditem) i ruční úhrady k němu a vrátí stav faktury; otevřené
-- návrhy k němu zamítne. Ruční nebo CSV storno nic nemění — jen se ukáže
-- v Platbách.
create function app.transakce_storno_parovani()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_p     record;
  v_cesta text;
  v_nic   text;
begin
  -- Stejný zámek pohybu jako párování, ruční úhrada a Jiné platby
  -- (hashtextextended(pohyb, 0)): souběžné párování nebo úhrada téhož
  -- pohybu počká, až storno doběhne, a pak storno uvidí (a odmítne se);
  -- obráceně storno počká na jejich konec a jejich zápis zruší. Bez
  -- zámku by obě strany kontrolovaly ve chvíli, kdy druhá ještě nic
  -- nepotvrdila, a faktura by zůstala zaplacená stornovanou platbou.
  perform pg_advisory_xact_lock(hashtextextended(new.storno_of::text, 0));

  -- Mimo otevřené Faktury (převod běží) párování nemění nikdo — ani storno.
  if app.faktury_stav_prevodu_brana(new.tenant_id) is distinct from 'dokonceno' then
    return null;
  end if;
  for v_p in
    select p.id from public.platby_faktury p
     where p.transakce_id = new.storno_of and p.tenant_id = new.tenant_id and p.stav = 'potvrzeno'
     for update
  loop
    perform app.zrusit_parovani_interne(new.tenant_id, v_p.id, 'finance.parovani_zruseno_stornem',
                                        'Banka pohyb stornovala.', null);
  end loop;

  -- Ruční úhrady se stornovaným pohybem (platba v jiné měně): peníze
  -- neodešly, úhrada padá taky — se stejným přepočtem stavu a auditem.
  for v_p in
    update public.faktury_rucni_uhrady
       set zruseno_kdy = now(), zrusil = null, duvod_zruseni = 'Banka pohyb stornovala.'
     where transakce_id = new.storno_of and tenant_id = new.tenant_id and zruseno_kdy is null
    returning id, faktura
  loop
    perform app.audit(new.tenant_id, 'faktury.rucni_uhrada_zrusena_stornem', 'faktura', v_p.faktura::text, null,
                      jsonb_build_object('uhrada_id', v_p.id, 'transakce_id', new.storno_of),
                      jsonb_build_object('stav_faktury', app.prepocitat_stav_faktury(new.tenant_id, v_p.faktura)));
  end loop;

  v_cesta := current_setting('foodtab.faktury_cesta', true);
  v_nic := set_config('foodtab.faktury_cesta', 'nova', true);
  update public.platby_faktury set stav = 'zamitnuto'
   where transakce_id = new.storno_of and tenant_id = new.tenant_id and stav = 'navrzeno';
  v_nic := set_config('foodtab.faktury_cesta', coalesce(v_cesta, ''), true);
  return null;
end $$;

revoke all on function app.transakce_storno_parovani() from public, anon, authenticated, service_role;

create trigger trg_transakce_storno_parovani
  after insert on public.transakce
  for each row when (new.storno_of is not null and new.zdroj = 'banka_api')
  execute function app.transakce_storno_parovani();

-- Stažení z banky může nést storno: řádek s 'storno_externi_id' = id
-- stornovaného pohybu u banky (pohyb banka_api, nebo řádek výpisu, který
-- banka potvrdila). Storno se zapíše, jen když sedí účet, částka, měna
-- a opačný směr a pohyb ještě stornovaný není — jinak jde řádek dovnitř
-- jako obyčejný pohyb (peníze se pohnuly; celé stažení kvůli němu
-- nespadne). Dnes storno nepošle žádný konektor (otázka 132).
-- VOLATILE schválně: platba i její storno můžou přijít v TÉŽE dávce —
-- funkce volaná při vkládání storna musí vidět platbu, kterou týž příkaz
-- vložil o řádek dřív (STABLE by viděla jen stav před příkazem). Vkládá
-- se v pořadí řádků (order by poradi_v_poli), storno tedy po platbě.
-- p_narok = řádek výpisu, který si TATÁŽ dávka nárokuje pod id
-- 'storno_externi_id' (app.import_roztridit, narok_na). Jeho potvrzení
-- banky se zapíše až po vložení nových řádků (CTE potvrzene ve
-- public.importovat_transakce), takže v transakce_potvrzeni_banky ho
-- funkce v tu chvíli ještě nenajde.
create function app.storno_z_importu(p_tenant uuid, p_ucet uuid, p_radek jsonb, p_smer text, p_castka integer, p_mena text,
                                     p_narok uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ext text := nullif(btrim(coalesce(p_radek ->> 'storno_externi_id', '')), '');
  v_id  uuid;
  v_o   record;
begin
  if v_ext is null then
    return null;
  end if;
  select o.id into v_id from public.transakce o
   where o.tenant_id = p_tenant and o.ucet_id = p_ucet and o.zdroj = 'banka_api' and o.externi_id = v_ext;
  if v_id is null then
    select b.transakce_id into v_id from public.transakce_potvrzeni_banky b
     where b.tenant_id = p_tenant and b.ucet_id = p_ucet and b.externi_id = v_ext;
  end if;
  if v_id is null then
    v_id := p_narok;
  end if;
  if v_id is null then
    return null;
  end if;
  select o.castka_haleru, o.smer, o.mena, o.storno_of into v_o
    from public.transakce o
   where o.id = v_id and o.tenant_id = p_tenant and o.ucet_id = p_ucet;
  if not found then
    return null;
  end if;
  if v_o.storno_of is not null
     or exists (select 1 from public.transakce s where s.storno_of = v_id)
     or v_o.castka_haleru <> p_castka
     or app.mena_nebo_czk(v_o.mena) <> app.mena_nebo_czk(p_mena)
     or p_smer is distinct from (case v_o.smer when 'prijem' then 'vydaj' when 'vydaj' then 'prijem'
                                               when 'prevod_dovnitr' then 'prevod_ven' when 'prevod_ven' then 'prevod_dovnitr' end) then
    return null;
  end if;
  return v_id;
end $$;

revoke all on function app.storno_z_importu(uuid, uuid, jsonb, text, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function app.storno_z_importu(uuid, uuid, jsonb, text, integer, text, uuid) to service_role;

-- importovat_transakce (krok 1, 20261119100000) — tělo beze změny kromě
-- storna u stažení z banky (sloupec storno_of z app.storno_z_importu).
create or replace function public.importovat_transakce(
  p_tenant uuid,
  p_ucet   uuid,
  p_davka  uuid,
  p_zdroj  text,
  p_radky  jsonb
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pocet   integer;
  v_priznak text;
begin
  if p_zdroj is null or p_zdroj not in ('banka_api', 'csv_banka', 'csv_pokladna') then
    raise exception 'Import tohohle zdroje neexistuje.' using errcode = 'check_violation';
  end if;

  if current_user in ('authenticated', 'anon') then
    if p_zdroj = 'banka_api' then
      raise exception 'Platbu ze zdroje „%" zapisuje jen synchronizace banky.', p_zdroj
        using errcode = 'insufficient_privilege';
    end if;
    if p_ucet is null or p_ucet not in (select app.platebni_ucty_s_pravem('finance.read')) then
      raise exception 'Výpis jde nahrát jen na účet, jehož platby vidíte.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Souběh dvou importů téhož účtu (synchronizace a nahraný výpis): druhý
  -- počká, až první skončí, a teprve pak počítá, co účet už má.
  perform pg_advisory_xact_lock(hashtextextended('transakce:' || p_ucet::text, 0));

  v_priznak := current_setting('foodtab.import_transakci', true);
  perform set_config('foodtab.import_transakci', '1', true);

  if p_zdroj = 'banka_api' then
    with r as materialized (
      select * from app.import_roztridit(p_ucet, p_zdroj, p_radky)
    ),
    vlozene as (
      insert into public.transakce (
        tenant_id, ucet_id, smer, castka_haleru, mena, datum,
        protistrana, protiucet, vs, poznamka, zdroj, externi_id, otisk, import_davka_id, storno_of
      )
      select p_tenant, p_ucet, r.smer, r.castka_haleru, r.mena, r.datum,
             r.protistrana, r.protiucet, r.vs, r.poznamka,
             p_zdroj, r.externi_id, r.klic, p_davka,
             app.storno_z_importu(p_tenant, p_ucet, p_radky -> (r.poradi_v_poli - 1)::integer,
                                  r.smer, r.castka_haleru, r.mena,
                                  -- Řádek výpisu, který tatáž dávka nárokuje pod id stornovaného pohybu.
                                  (select n.narok_na from r n
                                    where n.narok_na is not null
                                      and n.externi_id = nullif(btrim(coalesce(
                                            p_radky -> (r.poradi_v_poli - 1)::integer ->> 'storno_externi_id', '')), '')
                                    limit 1))
        from r
       where r.narok_na is null
       order by r.poradi_v_poli
      returning 1
    ),
    potvrzene as (
      insert into public.transakce_potvrzeni_banky (tenant_id, ucet_id, transakce_id, externi_id, import_davka_id)
      select p_tenant, p_ucet, r.narok_na, r.externi_id, p_davka
        from r
       where r.narok_na is not null
       order by r.poradi_v_poli
      returning 1
    )
    select (select count(*) from vlozene)::integer into v_pocet;
  else
    with r as materialized (
      select * from app.import_roztridit(p_ucet, p_zdroj, p_radky)
    ),
    vlozene as (
      insert into public.transakce (
        tenant_id, ucet_id, smer, castka_haleru, mena, datum,
        protistrana, protiucet, vs, poznamka, zdroj, externi_id, otisk, import_davka_id
      )
      select p_tenant, p_ucet, r.smer, r.castka_haleru, r.mena, r.datum,
             r.protistrana, r.protiucet, r.vs, r.poznamka,
             p_zdroj, r.externi_id, r.klic, p_davka
        from r
       where r.narok_na is null
       order by r.poradi_v_poli
      returning 1
    )
    select count(*)::integer into v_pocet from vlozene;
  end if;

  perform set_config('foodtab.import_transakci', coalesce(v_priznak, ''), true);

  update public.import_davky set pocet_novych = v_pocet where id = p_davka;

  return v_pocet;
end $$;
