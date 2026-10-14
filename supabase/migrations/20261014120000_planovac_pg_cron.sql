-- =====================================================================
-- Foodtab — plánovač naplánovaných úloh v databázi (pg_cron + pg_net)
--
-- Návod pro Šéfíka: docs/planovac-pg-cron.md. Scénář: krok96.
--
-- ---------------------------------------------------------------------
-- PROČ
--
-- Naplánované úlohy (`/api/uloha/*`) dnes spouští GitHub Actions
-- `schedule`. Měření 7.–14. 10. 2026: GitHub pustil každou úlohu jen
-- asi čtyřikrát denně, ať měla v plánu cokoli — 5–17 % plánovaných
-- běhů, mezery až 12 hodin. Hodinová `pokladna-synchronizace` proběhla
-- za 61 h desetkrát, čtyřhodinová `banka-synchronizace` taky jen ~3×
-- denně. Mírnější plán by tedy nepomohl. Vercel Cron umí na tarifu
-- Hobby jen denně.
--
-- Tahle migrace připraví plánovač V DATABÁZI: pg_cron v plánovaný čas
-- zavolá přes pg_net tutéž adresu `/api/uloha/<úloha>` se stejným
-- tajemstvím (Bearer CRON_SECRET), jaké posílá GitHub. Co úloha dělá,
-- se nemění — mění se jen, kdo ji kdy zavolá (srov. komentář
-- v app/api/uloha/zapomenuty-odchod/route.ts, „Až se přestěhujeme…").
--
-- MIGRACE NIC NESPOUŠTÍ. Připraví tabulky a funkce; plánovač zapne
-- Šéfík ručně podle návodu:
--   1. zapne rozšíření pg_cron a pg_net (Dashboard → Database → Extensions),
--   2. uloží do Vaultu adresu aplikace a tajemství,
--   3. zavolá `select * from app.naplanovat_ulohy();`.
-- Vypnout: `select app.zrusit_planovac();` — GitHub dál běží jako záloha.
--
-- ---------------------------------------------------------------------
-- VÝJIMKA Z CLAUDE.md, „Rozšíření Postgresu — nepoužívej je"
--
-- To pravidlo stojí na tom, že Supabase dává rozšíření do schématu
-- `extensions` a lokální PostgreSQL do `public`, takže funkce se
-- `search_path = ''` spadne na jednom z nich. pg_cron, pg_net a Vault
-- tenhle problém nemají: zakládají si VLASTNÍ pevná schémata `cron`,
-- `net` a `vault`, všude stejná.
--
-- `create extension` tu přesto NENÍ („zeptej se — nepřidávej create
-- extension sám"). Rozšíření zapíná Šéfík v Dashboardu, a tím o výjimce
-- rozhoduje on. Bez nich migrace projde — těla PL/pgSQL se na cizí
-- schémata ptají až při běhu — a funkce nahlas řeknou, co chybí.
-- Scénář krok96 si `cron`, `net` a `vault` napodobí.
--
-- ---------------------------------------------------------------------
-- DVOJÍ SPUŠTĚNÍ — `public.uloha_zabrat`
--
-- GitHub zatím zůstává jako záloha, takže tutéž úlohu volají DVA
-- plánovače. Zámky v `synchronizace_behy` hlídají jen banky, pokladny
-- a schránky (jeden běh na připojení). Kontrola 14. 10. našla úlohy,
-- které při SOUBĚŽNÉM volání zdvojí výsledek:
--   * notifikace-push — `app.uvolnit_cekajici` vloží souhrn dvakrát,
--     člověk dostane dva pushe „Čekají na vás N zpráv";
--   * marketing-automatizace — dva koncepty téhož příspěvku;
--   * banka-synchronizace — Fio na druhé volání do 30 s odpoví 409
--     a připojení se zbytečně označí „vyžaduje pozornost".
--
-- Proto každá adresa hned po ověření tajemství zabere zámek úlohy na
-- `limit_sekund`. Kdo přijde, když je zabráno, dostane 200
-- `{ bezi_jinde: true }` a nedělá nic. Zámek se schválně NEUVOLŇUJE,
-- vyprší sám: nejkratší rozestup v plánu je 15 minut a limit nejvýš
-- 5 minut, takže další plánovaný běh na něj nenarazí — jen duplicitní
-- volání od druhého plánovače. Jediná výjimka je úloha, kterou GitHub
-- volá ve smyčce (faktury-z-emailu, `public.uloha_uvolnit`).
--
-- ---------------------------------------------------------------------
-- TAJEMSTVÍ
--
-- Adresa aplikace a CRON_SECRET jsou ve Vaultu (šifrovaně), NE v repu
-- a NE v textu úlohy v `cron.job` — čtou se až při běhu, jen tady
-- v `app.planovac_cil`.
--
-- Omezení, které nejde obejít (Supabase, „Database roles can read
-- request headers queued by pg_net"): než pg_net požadavek odešle, leží
-- s hlavičkou v `net.http_request_queue` a vidí ho každá role, která se
-- umí PŘIHLÁSIT do databáze (postgres). anon a authenticated ne — schéma
-- `net` není v API vystavené (a nesmí být, viz návod). Kdo má heslo
-- k databázi, má stejně víc než CRON_SECRET.
--
-- Adresa musí být https:// — tajemství se po http neposílá.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * `create extension` — viz výš.
-- * Žádné `cron.schedule` přímo v migraci. Kdyby migrace plánovala
--   „jen když pg_cron existuje", db push před zapnutím rozšíření by
--   TIŠE nenaplánoval nic. `app.naplanovat_ulohy()` buď naplánuje
--   všechno, nebo nahlas řekne, co chybí, a nenaplánuje nic.
-- * GitHub workflow se nemažou ani netlumí — jsou záloha, dokud se
--   plánovač neosvědčí. Pak (samostatný krok) z nich `schedule` pryč
--   a `workflow_dispatch` zůstane: jedno místo, které rozhoduje o čase.
-- * Plán je jen „kdy se zeptat". O tom, CO a PRO KOHO se udělá (pásma
--   poboček, nastavení firem), dál rozhoduje úloha sama.
-- * Prefix `foodtab-` v názvech úloh v `cron.job` patří plánovači:
--   `app.zrusit_planovac` maže všechno, co tak začíná.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ÚLOHY — jediné místo, kde je plán
--
-- Plán je v UTC (pg_cron na Supabase běží v UTC), stejný jako dnes
-- v `.github/workflows/*.yml`; scripts/planovac.test.mjs hlídá, že se
-- ty dva seznamy nerozejdou, dokud běží oba.
--
-- `limit_sekund` = jak dlouho smí jedno volání trvat: timeout pg_net
-- i doba zámku. Kde má adresa `maxDuration = 60`, je to 90 s; ostatní
-- nemají vlastní limit (Vercel jim dá až 300 s), tak 300 s.
-- ---------------------------------------------------------------------

create table app.planovac_ulohy (
  -- Jde do adresy, proto jen malá písmena, číslice a pomlčky.
  uloha            text primary key check (uloha ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan_utc         text not null,
  limit_sekund     integer not null check (limit_sekund between 30 and 300),
  zamceno_do       timestamptz,
  posledni_zacatek timestamptz
);

comment on table app.planovac_ulohy is
  'Naplánované úlohy /api/uloha/<uloha>: plán (cron, UTC) pro pg_cron, '
  'limit volání a zámek proti dvojímu spuštění (public.uloha_zabrat). '
  'posledni_zacatek = kdy úloha naposledy opravdu začala, ať ji zavolal '
  'kdokoli (pg_cron, GitHub, ručně).';

insert into app.planovac_ulohy (uloha, plan_utc, limit_sekund) values
  ('banka-synchronizace',    '15 */4 * * *',       90),
  ('checklisty-naplanovat',  '17 * * * *',         300),
  ('checklisty-terminy',     '3,18,33,48 * * * *', 300),
  ('faktury-z-emailu',       '9,39 * * * *',       90),
  ('marketing-automatizace', '19 * * * *',         300),
  ('marketing-fronta',       '7,22,37,52 * * * *', 300),
  ('notifikace-push',        '7,22,37,52 * * * *', 300),
  ('pokladna-synchronizace', '40 * * * *',         90),
  ('zapomenuty-odchod',      '5 * * * *',          300);


-- ---------------------------------------------------------------------
-- 2. VOLÁNÍ — co plánovač odeslal
--
-- pg_net si u odpovědi nepamatuje adresu, jen číslo požadavku. Bez
-- téhle tabulky by se z `net._http_response` nedalo poznat, která
-- úloha vrátila 401. Maže se po 14 dnech (`app.planovac_uklid`).
-- ---------------------------------------------------------------------

create table app.planovac_volani (
  id           bigint generated always as identity primary key,
  request_id   bigint not null,
  uloha        text not null references app.planovac_ulohy(uloha) on delete cascade,
  zavolano_kdy timestamptz not null default now()
);

create index planovac_volani_uloha on app.planovac_volani (uloha, zavolano_kdy desc);

comment on table app.planovac_volani is
  'Požadavky, které plánovač poslal přes pg_net (číslo požadavku → '
  'úloha). Stav odpovědi ukáže app.planovac_stav().';

-- Nejsou to data firem; čte je jen postgres (SQL Editor, pg_cron).
alter table app.planovac_ulohy  enable row level security;
alter table app.planovac_volani enable row level security;
revoke all on app.planovac_ulohy, app.planovac_volani from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. KAM A S ČÍM — jediné místo, které čte Vault
--
-- Hlášky nikdy neobsahují hodnotu tajemství: končí v
-- `cron.job_run_details.return_message`.
-- ---------------------------------------------------------------------

create function app.planovac_cil(
  p_uloha       text,
  out adresa    text,
  out hlavicky  jsonb,
  out limit_ms  integer
)
language plpgsql stable set search_path = '' as $$
declare
  v_limit     integer;
  v_zaklad    text;
  v_tajemstvi text;
begin
  select u.limit_sekund into v_limit from app.planovac_ulohy u where u.uloha = p_uloha;
  if not found then
    raise exception 'Plánovač nezná úlohu „%".', p_uloha using errcode = '22023';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Chybí Supabase Vault (vault.decrypted_secrets).' using errcode = '55000';
  end if;

  select s.decrypted_secret into v_zaklad    from vault.decrypted_secrets s where s.name = 'foodtab_app_url';
  select s.decrypted_secret into v_tajemstvi from vault.decrypted_secrets s where s.name = 'foodtab_cron_secret';

  v_zaklad := rtrim(btrim(coalesce(v_zaklad, '')), '/');
  if v_zaklad = '' then
    raise exception 'Ve Vaultu chybí foodtab_app_url (adresa aplikace, např. https://foodtab.vercel.app).'
      using errcode = '55000';
  end if;
  -- Jen https://host — bez cesty, dotazu, jména:hesla@ a mezer.
  if v_zaklad !~ '^https://[^/?#@[:space:]]+$' then
    raise exception 'foodtab_app_url musí být https://adresa bez cesty — tajemství se po http neposílá.'
      using errcode = '22023';
  end if;

  if coalesce(v_tajemstvi, '') = '' then
    raise exception 'Ve Vaultu chybí foodtab_cron_secret (stejná hodnota jako CRON_SECRET na Vercelu).'
      using errcode = '55000';
  end if;
  -- Nový řádek na konci po vložení ze schránky = tichá 401 u každé úlohy.
  if v_tajemstvi <> btrim(v_tajemstvi, E' \t\r\n') then
    raise exception 'foodtab_cron_secret začíná nebo končí mezerou či novým řádkem — na Vercelu by nesedělo.'
      using errcode = '22023';
  end if;

  adresa   := v_zaklad || '/api/uloha/' || p_uloha;
  hlavicky := jsonb_build_object('Authorization', 'Bearer ' || v_tajemstvi);
  limit_ms := v_limit * 1000;
end $$;


-- ---------------------------------------------------------------------
-- 4. ZAVOLAT ÚLOHU — tohle spouští pg_cron
--
-- pg_net je asynchronní: požadavek odejde až po COMMITu a odpověď
-- přijde do `net._http_response` (drží ji 6 h). Úloha v cronu proto
-- trvá milisekundy, ať adresa běží jakkoli dlouho.
-- ---------------------------------------------------------------------

create function app.spustit_ulohu(p_uloha text)
returns bigint
language plpgsql set search_path = '' as $$
declare
  c    record;
  v_id bigint;
begin
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    raise exception 'Chybí rozšíření pg_net — Dashboard → Database → Extensions.' using errcode = '55000';
  end if;

  select * into c from app.planovac_cil(p_uloha);

  v_id := net.http_get(
    url                  := c.adresa,
    headers              := c.hlavicky,
    timeout_milliseconds := c.limit_ms
  );

  insert into app.planovac_volani (request_id, uloha) values (v_id, p_uloha);
  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- 5. ZAPNOUT / VYPNOUT
--
-- `naplanovat_ulohy` jde pustit opakovaně: pg_cron úlohu stejného
-- jména přepíše, úlohy, které z tabulky zmizely, z cronu odebere.
-- Nejdřív ověří VŠECHNO (rozšíření, Vault, adresu), teprve pak plánuje.
-- ---------------------------------------------------------------------

create function app.naplanovat_ulohy()
returns table (uloha text, plan_utc text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Chybí rozšíření pg_cron — Dashboard → Database → Extensions.' using errcode = '55000';
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    raise exception 'Chybí rozšíření pg_net — Dashboard → Database → Extensions.' using errcode = '55000';
  end if;

  for r in select u.uloha from app.planovac_ulohy u loop
    perform app.planovac_cil(r.uloha);
  end loop;

  for r in
    select j.jobname from cron.job j
     where j.jobname like 'foodtab-uloha-%'
       and substr(j.jobname, length('foodtab-uloha-') + 1) not in (select u.uloha from app.planovac_ulohy u)
  loop
    perform cron.unschedule(r.jobname);
  end loop;

  for r in select u.uloha, u.plan_utc from app.planovac_ulohy u loop
    perform cron.schedule(
      'foodtab-uloha-' || r.uloha,
      r.plan_utc,
      format('select app.spustit_ulohu(%L)', r.uloha)
    );
  end loop;

  perform cron.schedule('foodtab-planovac-uklid', '23 3 * * *', 'select app.planovac_uklid()');

  return query select u.uloha, u.plan_utc from app.planovac_ulohy u order by u.uloha;
end $$;

create function app.zrusit_planovac()
returns integer
language plpgsql set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  if to_regprocedure('cron.unschedule(text)') is null then
    return 0;
  end if;
  for r in select j.jobname from cron.job j where j.jobname like 'foodtab-%' loop
    perform cron.unschedule(r.jobname);
    n := n + 1;
  end loop;
  return n;
end $$;


-- ---------------------------------------------------------------------
-- 6. ÚKLID — pg_cron historii běhů sám nemaže
-- ---------------------------------------------------------------------

create function app.planovac_uklid()
returns void
language plpgsql set search_path = '' as $$
begin
  delete from app.planovac_volani v where v.zavolano_kdy < now() - interval '14 days';

  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details d
     where d.end_time < now() - interval '14 days'
       and d.jobid in (select j.jobid from cron.job j where j.jobname like 'foodtab-%');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 7. STAV — „běží to?" jedním dotazem
--
-- pg_cron nikomu nepošle e-mail, když úloha padá (GitHub ano). Tohle
-- je místo, kam se podívat. Kódy odpovědí drží pg_net jen 6 h, proto
-- se počítá za 6 h. `posledni_zacatek` je z aplikace, takže ukáže
-- i běh spuštěný GitHubem.
-- ---------------------------------------------------------------------

create function app.planovac_stav()
returns table (
  uloha            text,
  plan_utc         text,
  v_cronu          boolean,
  posledni_zacatek timestamptz,
  posledni_volani  timestamptz,
  posledni_kod     integer,
  posledni_chyba   text,
  volani_6h        bigint,
  chyb_6h          bigint
)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
begin
  if to_regclass('cron.job') is null or to_regclass('net._http_response') is null then
    return query
      select u.uloha, u.plan_utc, false, u.posledni_zacatek,
             null::timestamptz, null::integer,
             'plánovač v databázi není zapnutý (chybí pg_cron nebo pg_net)'::text,
             0::bigint, 0::bigint
        from app.planovac_ulohy u
       order by u.uloha;
    return;
  end if;

  return query
  with volani as (
    select v.uloha, v.zavolano_kdy, r.status_code, r.timed_out, r.error_msg,
           row_number() over (partition by v.uloha order by v.zavolano_kdy desc) as poradi
      from app.planovac_volani v
      left join net._http_response r on r.id = v.request_id and r.created >= v.zavolano_kdy
     where v.zavolano_kdy > now() - interval '6 hours'
  )
  select u.uloha,
         u.plan_utc,
         exists (select 1 from cron.job j where j.jobname = 'foodtab-uloha-' || u.uloha and j.active),
         u.posledni_zacatek,
         p.zavolano_kdy,
         p.status_code,
         case
           when p.timed_out then 'vypršel čas'
           when p.error_msg is not null then p.error_msg
           when p.status_code >= 300 then 'HTTP ' || p.status_code
           when p.zavolano_kdy is not null and p.status_code is null then 'zatím bez odpovědi'
         end,
         (select count(*) from volani c where c.uloha = u.uloha),
         (select count(*) from volani c
           where c.uloha = u.uloha
             and (c.status_code >= 300 or c.timed_out or c.error_msg is not null))
    from app.planovac_ulohy u
    left join volani p on p.uloha = u.uloha and p.poradi = 1
   order by u.uloha;
end $$;


-- ---------------------------------------------------------------------
-- 8. ZÁMEK PROTI DVOJÍMU SPUŠTĚNÍ — volá ho každá adresa /api/uloha/*
--
-- Souběh: druhé volání počká na zámek řádku a podmínku `zamceno_do <=
-- now()` vyhodnotí znovu nad zapsanou verzí — tam už je budoucí čas,
-- takže neupdatuje nic a vrátí false. Žádný „přečti a pak zapiš".
--
-- SECURITY DEFINER, protože service_role do `app.planovac_ulohy` práva
-- nemá a mít nemá. Firmy se netýká, takže tu žádný filtr na tenant
-- chybět nemůže. Spouští JEN service_role (klientUlohy za tajemstvím).
-- ---------------------------------------------------------------------

create function public.uloha_zabrat(p_uloha text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  select u.limit_sekund into v_limit from app.planovac_ulohy u where u.uloha = p_uloha;
  if not found then
    raise exception 'Neznámá úloha „%".', p_uloha using errcode = '22023';
  end if;

  update app.planovac_ulohy u
     set zamceno_do       = now() + make_interval(secs => v_limit),
         posledni_zacatek = now()
   where u.uloha = p_uloha
     and (u.zamceno_do is null or u.zamceno_do <= now());

  return found;
end $$;

comment on function public.uloha_zabrat(text) is
  'Zabere úlohu na limit_sekund. true = běž; false = stejná úloha běží '
  'nebo právě doběhla (druhý plánovač). Jen service_role.';

-- Uvolnění hned po doběhnutí — jen pro úlohu, kterou plánovač volá ve
-- SMYČCE (faktury-z-emailu.yml: znovu, dokud `pokracovat`). Bez něj by
-- druhé kolo narazilo na zámek z prvního. Ostatní úlohy ho nevolají:
-- zámek, který vyprší sám, drží i krátký odstup mezi plánovači.
--
-- Uvolní jen zámek, který ještě platí. Cizí zámek tím uvolnit nejde:
-- dokud platí ten náš, nikdo jiný úlohu nezabere, a limit je vždycky
-- delší než nejdelší povolený běh adresy (hlídá scripts/planovac.test.mjs).
create function public.uloha_uvolnit(p_uloha text)
returns void
language sql security definer set search_path = '' as $$
  update app.planovac_ulohy u
     set zamceno_do = null
   where u.uloha = p_uloha
     and u.zamceno_do > now();
$$;

comment on function public.uloha_uvolnit(text) is
  'Uvolní zámek úlohy po doběhnutí (úloha volaná ve smyčce). Jen service_role.';


-- ---------------------------------------------------------------------
-- 9. PRÁVA
--
-- Funkce dostávají EXECUTE pro PUBLIC samy od sebe a Supabase k tomu
-- přidává anon/authenticated výchozími právy — proto `revoke` výslovně.
-- Plánovač ovládá jen postgres (SQL Editor, pg_cron běží pod tím, kdo
-- úlohu naplánoval).
-- ---------------------------------------------------------------------

revoke all on function app.planovac_cil(text)  from public, anon, authenticated, service_role;
revoke all on function app.spustit_ulohu(text) from public, anon, authenticated, service_role;
revoke all on function app.naplanovat_ulohy()  from public, anon, authenticated, service_role;
revoke all on function app.zrusit_planovac()   from public, anon, authenticated, service_role;
revoke all on function app.planovac_uklid()    from public, anon, authenticated, service_role;
revoke all on function app.planovac_stav()     from public, anon, authenticated, service_role;

revoke all on function public.uloha_zabrat(text) from public, anon, authenticated;
grant execute on function public.uloha_zabrat(text) to service_role;

revoke all on function public.uloha_uvolnit(text) from public, anon, authenticated;
grant execute on function public.uloha_uvolnit(text) to service_role;
