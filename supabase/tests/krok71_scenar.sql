-- Scénář pro krok 71 — pojistka kolem pomocných definer funkcí zálohy,
-- které NEFILTRUJÍ podle firmy.
--
-- Pokrývá migraci 20260925140000_zalohy_potvrzeni.sql, řádky 209–316:
--
--   app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)
--   app.zrusit_vyzvu_k_zaloze(uuid, text)
--
-- Obě dělají `update … where id = p_zaloha`, BEZ `tenant_id`. Je to
-- záměr (hlavička migrace: „každý filtr jen jednou"; druhá kopie téže
-- podmínky by nešla shodit). Bezpečné jsou dnes jen proto, že
--
--   (a) jsou `revoke all … from public, anon, authenticated` a
--   (b) každý DNEŠNÍ volající si firmu ověří SÁM, PŘED voláním.
--
-- Obojí je ale slib, ne zámek. Čtvrtý volající, který (b) zapomene, by
-- přes pomocnou funkci potvrdil / zrušil zálohu CIZÍ firmy — a žádná
-- kontrola by nespadla. Tenhle scénář tu pojistku dodává. Migraci
-- NEMĚNÍ; neměla by se měnit.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. ACL: ani anon, ani authenticated, ani PUBLIC nemá EXECUTE na
--      žádné z obou pomocných funkcí (a měřidlo umí říct i „ano");
--   2. POJISTKA PROTI ČTVRTÉMU VOLAJÍCÍMU: dotaz nad pg_proc najde
--      všechny funkce, v jejichž těle (bez komentářů) je volání pomocné
--      funkce, a porovná jejich jména se seznamem níž. Přibude-li
--      volající, scénář SPADNE a řekne, co udělat;
--   3. detektor UMÍ odhalit: dočasná „podvodná" funkce volající pomocnou
--      pojistku shodí, po dropu pojistka zase sedí; funkce s volákem
--      jen v komentáři ji NEshodí (a je dokázáno, že text v ní opravdu
--      je);
--   4. přímé volání pomocné funkce pod rolí authenticated / anon spadne
--      42501 („permission denied for function") a záloha cizí firmy
--      i čekající push zůstanou beze změny;
--   5. dnešní čtyři volající a cizí firma:
--        potvrdit_moji_zalohu            → krok60 oddíl 3 (Věra: volá za
--                                          druhou firmu, P0002 „Takovou
--                                          zálohu tu nemáte", záloha
--                                          zůstane nepotvrzená)
--        potvrdit_zalohu_za_zamestnance  → krok60 oddíl 7 (cizí majitel;
--                                          majitel téhle firmy vs. záloha
--                                          cizí, P0002 „Taková záloha tu
--                                          není", obě zůstanou nepotvrzené)
--        stornovat_zalohu                → TADY (v krok60/8/10 cizí firma
--                                          nebyla)
--        potvrdit_zalohu_pinem           → TADY (krok8 měří jen „PIN
--                                          kolegy z jiné pobočky", cizí
--                                          firma nebyla)
--
-- ---------------------------------------------------------------------
-- DRUHÁ FIRMA JE SKUTEČNÁ (vzor krok70 / krok58): obě firmy vznikají přes
-- app.create_tenant, mají vlastní majitele, pobočku a zaměstnance.
-- Scénář je soběstačný — nepotřebuje etapa0_scenar:
--   node scripts/scenare-pglite.mjs krok71_scenar
--
-- PGLITE: tady `set role` ACL vynucuje (ověřeno schválným rozbitím,
-- viz zpráva: `grant execute … to authenticated` shodí oddíly 1 i 4).
-- Že nevynucuje RLS, tu nevadí — všechno měřené je uvnitř definer
-- funkcí, kde RLS není ani na Supabase. Rozhoduje běh proti PostgreSQL 16.
--
-- ---------------------------------------------------------------------
-- CO POJISTKA NEPOKRYJE (ať se to nečte jako víc, než to je)
--
--   * volání poskládané dynamicky (`execute format(…)`, jméno z tabulky);
--   * volání ze spouště / pravidla / pohledu / politiky — hledá se jen
--     v pg_proc.prosrc. Z politiky či pohledu by ale pomocnou funkci
--     zavolat šlo jen pod právy vlastníka, a ta authenticated nemá;
--   * to, že volající firmu OPRAVDU ověřuje — to měří jen chování
--     (oddíl 5 a krok60). Pojistka jen donutí, aby se na to někdo
--     podíval, než volajícího dopíše do seznamu.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

-- Projde příkaz BEZ výjimky?
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

-- Má PUBLIC (grantee 0) EXECUTE? has_function_privilege('public', …)
-- by šlo také, ale tohle čte přímo proacl; funkce bez ACL (NULL)
-- znamená VÝCHOZÍ práva, tedy EXECUTE pro PUBLIC — proto acldefault.
create or replace function pg_temp.public_ma_execute(p_funkce regprocedure)
returns boolean language sql as $$
  select exists (
    select 1
      from pg_proc p,
           aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = p_funkce
       and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  )
$$;

-- ---------------------------------------------------------------------
-- SEZNAM DNEŠNÍCH VOLAJÍCÍCH. JEDINÉ místo, kde se píše.
--
-- Do seznamu se nová funkce dopisuje AŽ POTÉ, co je ověřeno, že si
-- firmu (tenant) ověřuje sama PŘED voláním pomocné funkce: filtr
-- `tenant_id = p_tenant` na záloze a právo / členství / majitelství /
-- zařízení téže firmy. Pomocná funkce firmu nefiltruje.
-- ---------------------------------------------------------------------
create or replace function pg_temp.dnesni_volajici(p_pomocna text)
returns text[] language sql as $$
  select case p_pomocna
    when 'zapsat_potvrzeni_zalohy' then array[
      'public.potvrdit_moji_zalohu',
      'public.potvrdit_zalohu_pinem',
      'public.potvrdit_zalohu_za_zamestnance'
    ]
    when 'zrusit_vyzvu_k_zaloze' then array[
      'app.zapsat_potvrzeni_zalohy',
      'public.stornovat_zalohu'
    ]
  end
$$;

-- Jména (schema.jméno) funkcí, jejichž tělo — BEZ komentářů — volá
-- pomocnou funkci. `p_siroce = false`: přesně vzor `perform app.<fn>(`.
-- `p_siroce = true`: jakékoli volání `app.<fn>(` (i `select app.<fn>(…)`,
-- `PERFORM  app.<fn> (`); je to nadmnožina přesného vzoru.
-- Holé jméno se NEhledá — je i v komentářích a v textech hlášek.
create or replace function pg_temp.volajici(p_pomocna text, p_siroce boolean)
returns text[] language sql as $$
  select coalesce(
    array_agg(distinct n.nspname || '.' || p.proname
              order by n.nspname || '.' || p.proname),
    array[]::text[])
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not like 'pg\_%'
     and n.nspname <> 'information_schema'
     and regexp_replace(
           regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'),
           '--[^\n]*', '', 'g')
         ~* case when p_siroce
                  then 'app\.' || p_pomocna || '\s*\x28'
                  else 'perform\s+app\.' || p_pomocna || '\s*\x28'
             end
$$;

-- Pojistka: skutečná množina volajících (široký detektor) se musí
-- shodovat se seznamem. Spadne v OBOU směrech a řekne, co udělat.
create or replace function pg_temp.pojistka(p_pomocna text)
returns void language plpgsql as $$
declare
  v_je     text[] := pg_temp.volajici(p_pomocna, true);
  v_ma     text[] := pg_temp.dnesni_volajici(p_pomocna);
  v_navic  text[];
  v_chybi  text[];
begin
  select coalesce(array_agg(x order by x), array[]::text[]) into v_navic
    from (select unnest(v_je) as x except select unnest(v_ma)) q;
  select coalesce(array_agg(x order by x), array[]::text[]) into v_chybi
    from (select unnest(v_ma) as x except select unnest(v_je)) q;

  if cardinality(v_navic) > 0 then
    raise exception
      'POJISTKA app.%: nový volající % není v seznamu. CO UDĚLAT: ověř, že si tenhle volající firmu ověřuje SÁM před voláním (filtr tenant_id = p_tenant na záloze a právo / členství / majitelství téže firmy — pomocná funkce firmu NEFILTRUJE), přidej mu test „cizí firma to nepotvrdí / nestornuje a záloha zůstane beze změny“, a teprve pak ho dopiš do pg_temp.dnesni_volajici v krok71_scenar.sql. Nedopisuj ho jen proto, aby scénář zezelenal.',
      p_pomocna, v_navic;
  end if;

  if cardinality(v_chybi) > 0 then
    raise exception
      'POJISTKA app.%: volající % ze seznamu už pomocnou funkci nevolá (zmizel, přejmenoval se, nebo ji volá jinak). CO UDĚLAT: najdi, kam se jeho volání přesunulo, ověř, že si tam firmu ověřuje sám, a uprav seznam pg_temp.dnesni_volajici v krok71_scenar.sql.',
      p_pomocna, v_chybi;
  end if;

  raise notice '  OK    pojistka app.%: volající přesně sedí se seznamem (%)',
    p_pomocna, array_to_string(v_je, ', ');
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA: dvě skutečné firmy, každá s majitelem, pobočkou a zaměstnancem.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('71710000-0000-0000-0000-000000000001', 'anna71@krok71a.cz',  '{"full_name":"Anna Sedmdesátjedna"}'),
  ('71710000-0000-0000-0000-000000000002', 'boris71@krok71b.cz', '{"full_name":"Boris Sedmdesátjedna"}'),
  ('71710000-0000-0000-0000-000000000003', 'cyril71@krok71a.cz', '{"full_name":"Cyril Sedmdesátjedna"}');

-- Firmy zakládá jejich majitel, jako vždy.
set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok71 A s.r.o.', 'Anna Sedmdesátjedna') as tenant_a \gset
reset role;

set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000002', false);
select app.create_tenant('Krok71 B s.r.o.', 'Boris Sedmdesátjedna') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.branches (tenant_id, name, slug)
values (:'tenant_a', 'Krok71 A1', 'krok71-a1')
returning id as pob_a1 \gset
insert into public.branches (tenant_id, name, slug)
values (:'tenant_a', 'Krok71 A2', 'krok71-a2')
returning id as pob_a2 \gset
insert into public.branches (tenant_id, name, slug)
values (:'tenant_b', 'Krok71 B1', 'krok71-b1')
returning id as pob_b1 \gset

-- Cyril: zaměstnanec firmy A s účtem, PINem a telefonem (push).
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant_a', :'pob_a1', '71710000-0000-0000-0000-000000000003', 'Cyril Sedmdesátjedna', 'hpp')
returning id as emp_cyril \gset

-- Dana: zaměstnankyně firmy A na DRUHÉ pobočce (A2), bez účtu.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant_a', :'pob_a2', 'Dana Sedmdesátjedna', 'hpp')
returning id as emp_dana \gset

-- Emil: zaměstnanec firmy B, bez účtu.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant_b', :'pob_b1', 'Emil Sedmdesátjedna', 'hpp')
returning id as emp_emil \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant_a', '71710000-0000-0000-0000-000000000003', null, 'tenant', 'active');

-- Zálohy zakládané přímým zápisem (jako krok60 u cizí firmy) — výplata
-- tu není předmětem.
insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'tenant_a', :'pob_a1', :'emp_cyril', 11100, current_date, 'krok71 cíl cizích pokusů')
returning id as zal_a1 \gset
insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'tenant_a', :'pob_a1', :'emp_cyril', 22200, current_date, 'krok71 kontrola storna')
returning id as zal_a_storno \gset
insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'tenant_a', :'pob_a1', :'emp_cyril', 33300, current_date, 'krok71 kontrola PINu')
returning id as zal_a_pin \gset
insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'tenant_a', :'pob_a2', :'emp_dana', 44400, current_date, 'krok71 jiná pobočka téže firmy')
returning id as zal_a2 \gset
insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'tenant_b', :'pob_b1', :'emp_emil', 55500, current_date, 'krok71 firma B')
returning id as zal_b1 \gset

-- Cyrilův telefon + čekající push „máte zálohu k potvrzení" k zal_a1:
-- podle něj se pozná, jestli někdo pomocnou `zrusit_vyzvu_k_zaloze`
-- opravdu zavolal.
set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000003', false);
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/krok71-cyril',
                                'klic-p256dh-cyril-71', 'auth-cyril-71');
select public.nastavit_pin(:'tenant_a', '7149');
reset role;
select set_config('test.user_id', '', false);

select app.notifikovat(:'tenant_a', '71710000-0000-0000-0000-000000000003'::uuid,
                       'zaloha.vyplacena',
                       jsonb_build_object('castka_haleru', 11100, 'zaloha', :'zal_a1'::uuid),
                       'normal', :'pob_a1'::uuid, null, 'zaloha', :'zal_a1'::uuid, null);

-- Tablet firmy A na pobočce A1 (registruje majitel A).
select set_config('test.user_id', '71710000-0000-0000-0000-000000000001', false);
select kod as kod71 from public.vytvorit_registracni_kod(
  :'tenant_a', :'pob_a1', 'tablet krok71') \gset
select klic as klic71 from public.registrovat_zarizeni(:'kod71') \gset
select set_config('test.user_id', '', false);


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

select set_config('test.user_id', '71710000-0000-0000-0000-000000000001', false);
select pg_temp.check('příprava: Anna je majitelka firmy A, ne B',
  app.is_owner(:'tenant_a') and not app.is_owner(:'tenant_b'));
select pg_temp.check('příprava: Anna smí vyplácet / stornovat zálohy u sebe (advances.manage)',
  app.has_access(:'tenant_a', 'advances.manage', :'pob_a1'));
select pg_temp.check('příprava: u Borise ne',
  not app.has_access(:'tenant_b', 'advances.manage', :'pob_b1'));

select set_config('test.user_id', '71710000-0000-0000-0000-000000000002', false);
select pg_temp.check('příprava: Boris je majitel firmy B, ne A',
  app.is_owner(:'tenant_b') and not app.is_owner(:'tenant_a'));
select pg_temp.check('příprava: Boris smí zálohy u sebe, u Anny ne',
  app.has_access(:'tenant_b', 'advances.manage', :'pob_b1')
  and not app.has_access(:'tenant_a', 'advances.manage', :'pob_a1'));
-- Důvod, proč je v storno filtr firmy JEDINÁ obrana proti volání
-- s vlastním p_tenant: has_access s pobočkou CIZÍ firmy celofiremního
-- majitele nezastaví. Kdyby tohle přestalo platit, druhá linie by
-- přibyla a odebrání filtru by už v oddíle 5 nešlo poznat.
select pg_temp.check('příprava: has_access firmy B pustí Borise i s CIZÍ pobočkou (A1) — filtr firmy v těle je jediná obrana',
  app.has_access(:'tenant_b', 'advances.manage', :'pob_a1'));
select set_config('test.user_id', '', false);

select pg_temp.check('příprava: zálohy jsou všechny nepotvrzené a nestornované',
  (select count(*) from public.advances
    where id in (:'zal_a1', :'zal_a_storno', :'zal_a_pin', :'zal_a2', :'zal_b1')
      and stav = 'nepotvrzena') = 5);

select pg_temp.check('příprava: tablet A je platný a patří firmě A, pobočce A1',
  (select d.tenant_id = :'tenant_a'::uuid and d.branch_id = :'pob_a1'::uuid
     from app.zarizeni_podle_klice(:'klic71') d));

select pg_temp.check('příprava: k zal_a1 čeká push „máte zálohu k potvrzení" (ceka_na_smenu)',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal_a1' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'ceka_na_smenu'));


\echo ''
\echo '== 1. ACL: pomocné funkce nikomu zvenku ==================='

select pg_temp.check('zapsat_potvrzeni_zalohy: anon nemá EXECUTE',
  not has_function_privilege('anon', 'app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)', 'execute'));
select pg_temp.check('zapsat_potvrzeni_zalohy: authenticated nemá EXECUTE',
  not has_function_privilege('authenticated', 'app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)', 'execute'));
select pg_temp.check('zapsat_potvrzeni_zalohy: PUBLIC nemá EXECUTE',
  not pg_temp.public_ma_execute('app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)'::regprocedure));

select pg_temp.check('zrusit_vyzvu_k_zaloze: anon nemá EXECUTE',
  not has_function_privilege('anon', 'app.zrusit_vyzvu_k_zaloze(uuid, text)', 'execute'));
select pg_temp.check('zrusit_vyzvu_k_zaloze: authenticated nemá EXECUTE',
  not has_function_privilege('authenticated', 'app.zrusit_vyzvu_k_zaloze(uuid, text)', 'execute'));
select pg_temp.check('zrusit_vyzvu_k_zaloze: PUBLIC nemá EXECUTE',
  not pg_temp.public_ma_execute('app.zrusit_vyzvu_k_zaloze(uuid, text)'::regprocedure));

-- Měřidlo musí umět říct i „ano" — „ne" z rozbitého dotazu je stejné.
select pg_temp.check('měřidlo: anon EXECUTE mít UMÍ (registrovat_zarizeni ho má)',
  has_function_privilege('anon', 'public.registrovat_zarizeni(text)', 'execute'));
select pg_temp.check('měřidlo: authenticated EXECUTE mít UMÍ (potvrdit_moji_zalohu ho má)',
  has_function_privilege('authenticated', 'public.potvrdit_moji_zalohu(uuid, uuid)', 'execute'));

-- NÁLEZ nezávislé kontroly (2. 10. 2026): `has_function_privilege` výš
-- cílí na JEDNU konkrétní signaturu. Nová přetížená funkce se stejným
-- jménem, jinou signaturou (např. `app.zapsat_potvrzeni_zalohy(uuid,
-- text, uuid, uuid, text)`) a BEZ revoke by oddíl 1 nezachytil — ACL by
-- se ptal jen na tu starou. Jediná signatura v `app` je proto vlastní,
-- samostatně shoditelná podmínka, ne předpoklad.
select pg_temp.check('zapsat_potvrzeni_zalohy: v app existuje jen JEDNA signatura (přetížení by ACL výš minulo)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'zapsat_potvrzeni_zalohy') = 1);
select pg_temp.check('zrusit_vyzvu_k_zaloze: taky jen jedna signatura',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'zrusit_vyzvu_k_zaloze') = 1);

create function public.krok71_verejna() returns void language sql as $$ select 1 $$;
select pg_temp.check('měřidlo: PUBLIC EXECUTE mít UMÍ (čerstvá funkce bez revoke ho má z výchozích práv)',
  pg_temp.public_ma_execute('public.krok71_verejna()'::regprocedure));
revoke all on function public.krok71_verejna() from public;
select pg_temp.check('… a po revoke ho už nemá (měřidlo reaguje na ACL, ne na jméno)',
  not pg_temp.public_ma_execute('public.krok71_verejna()'::regprocedure));
drop function public.krok71_verejna();


\echo ''
\echo '== 2. Pojistka: dnešní volající přesně podle seznamu ======'

select pg_temp.pojistka('zapsat_potvrzeni_zalohy');
select pg_temp.pojistka('zrusit_vyzvu_k_zaloze');

-- Bez téhle kontroly by prázdný výsledek detektoru (rozbitý regulár)
-- vypadal jako „nikdo nevolá" — a seznam má tři a dvě jména.
select pg_temp.check('detektor nad skutečnými migracemi něco NAŠEL (zapsat: 3, zrušit: 2)',
  cardinality(pg_temp.volajici('zapsat_potvrzeni_zalohy', true)) = 3
  and cardinality(pg_temp.volajici('zrusit_vyzvu_k_zaloze', true)) = 2);

-- Kontrola „přesný vzor najde totéž co široký“ byla odstraněna (nález
-- nezávislé kontroly, 2. 10. 2026): měřila jen to, že dnešní volající
-- píšou `perform` stejně — legitimní budoucí volající přes `select`
-- (plpgsql funkce s jedním výrazem) by ji navždy rozbil, aniž by šlo
-- o regresi. Pojistka sama (oddíl 2, `v_je` = široký detektor) je
-- dostatečná; přesný vzor (`p_siroce=false`) se dál používá jen
-- v oddíle 3 k prokázání rozdílu mezi oběma detektory.


\echo ''
\echo '== 3. Detektor UMÍ odhalit: podvodný volající přes pojistku'

-- 3a. Funkce jen s TEXTEM v komentářích. Pojistka ji nesmí shodit —
-- a aby „nesmí" něco znamenalo, musí být doloženo, že text v jejím
-- těle opravdu je (naivní hledání holého podstřetce by ji chytilo).
create function public.krok71_jen_komentar()
returns void language plpgsql as $$
begin
  -- perform app.zapsat_potvrzeni_zalohy('00000000-0000-0000-0000-000000000000', 'majitel', null, null);
  /* perform app.zrusit_vyzvu_k_zaloze('00000000-0000-0000-0000-000000000000', 'x'); */
  null;
end $$;

select pg_temp.check('důkaz: v těle komentářové funkce přesný vzor opravdu JE (naivní hledání by ji chytilo)',
  exists (select 1 from pg_proc p
           where p.proname = 'krok71_jen_komentar'
             and position('perform app.zapsat_potvrzeni_zalohy' || chr(40) in p.prosrc) > 0
             and position('perform app.zrusit_vyzvu_k_zaloze' || chr(40) in p.prosrc) > 0));

-- NÁLEZ nezávislé kontroly (2. 10. 2026): výš je blokový komentář na
-- JEDNOM řádku — regrese `'/\*.*?\*/'` → `'/\*[^\n]*?\*/'` (nesmí přes
-- konec řádku) by ji neodhalila, protože i omezený vzor jednořádkový
-- blok strip ne. Tenhle VÍCEŘÁDKOVÝ blokový komentář tu regresi chytí.
create function public.krok71_jen_komentar_viceradkovy()
returns void language plpgsql as $$
begin
  /*
    perform app.zapsat_potvrzeni_zalohy('00000000-0000-0000-0000-000000000000', 'majitel', null, null);
  */
  null;
end $$;

select pg_temp.check('… a totéž platí pro VÍCEŘÁDKOVÝ blokový komentář (ne jen jednořádkový)',
  not 'public.krok71_jen_komentar_viceradkovy' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', false))
  and not 'public.krok71_jen_komentar_viceradkovy' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', true)));

drop function public.krok71_jen_komentar_viceradkovy();

select pg_temp.check('… a detektor ji přesto nezahrne (ani přesným, ani širokým vzorem)',
  not 'public.krok71_jen_komentar' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', false))
  and not 'public.krok71_jen_komentar' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', true))
  and not 'public.krok71_jen_komentar' = any(pg_temp.volajici('zrusit_vyzvu_k_zaloze', false))
  and not 'public.krok71_jen_komentar' = any(pg_temp.volajici('zrusit_vyzvu_k_zaloze', true)));

select pg_temp.pojistka('zapsat_potvrzeni_zalohy');
select pg_temp.pojistka('zrusit_vyzvu_k_zaloze');

drop function public.krok71_jen_komentar();

-- 3b. Čtvrtý volající `perform app.zapsat_potvrzeni_zalohy(…)`. Nikdy se
-- nevolá, jen existuje.
create function public.krok71_podvodny_volajici()
returns void language plpgsql as $$
begin
  perform app.zapsat_potvrzeni_zalohy(
    '00000000-0000-0000-0000-000000000000'::uuid, 'majitel', null, null);
end $$;

select pg_temp.check('přesný vzor (perform app.zapsat_potvrzeni_zalohy( …)) podvodného volajícího najde',
  'public.krok71_podvodny_volajici' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', false)));

select pg_temp.check('pojistka zapsat_potvrzeni_zalohy SPADNE a jmenuje podvodného volajícího',
  pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zapsat_potvrzeni_zalohy'')',
    'P0001', 'public.krok71_podvodny_volajici'));

select pg_temp.check('… a hláška říká, co dělat (ověřit tenant sám, a teprve pak dopsat do seznamu)',
  pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zapsat_potvrzeni_zalohy'')',
    'P0001', 'CO UDĚLAT: ověř, že si tenhle volající firmu ověřuje SÁM')
  and pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zapsat_potvrzeni_zalohy'')',
    'P0001', 'teprve pak ho dopiš do pg_temp.dnesni_volajici'));

select pg_temp.check('druhá pomocná funkce tím není dotčená (zrušit_vyzvu: pojistka dál sedí)',
  pg_temp.projde('select pg_temp.pojistka(''zrusit_vyzvu_k_zaloze'')'));

drop function public.krok71_podvodny_volajici();

select pg_temp.pojistka('zapsat_potvrzeni_zalohy');

-- 3c. Totéž pro app.zrusit_vyzvu_k_zaloze.
create function public.krok71_podvodny_rusitel()
returns void language plpgsql as $$
begin
  perform app.zrusit_vyzvu_k_zaloze('00000000-0000-0000-0000-000000000000'::uuid, 'x');
end $$;

select pg_temp.check('přesný vzor podvodného rušitele najde',
  'public.krok71_podvodny_rusitel' = any(pg_temp.volajici('zrusit_vyzvu_k_zaloze', false)));

select pg_temp.check('pojistka zrusit_vyzvu_k_zaloze SPADNE a jmenuje ho',
  pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zrusit_vyzvu_k_zaloze'')',
    'P0001', 'public.krok71_podvodny_rusitel')
  and pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zrusit_vyzvu_k_zaloze'')',
    'P0001', 'CO UDĚLAT: ověř, že si tenhle volající firmu ověřuje SÁM'));

drop function public.krok71_podvodny_rusitel();

select pg_temp.pojistka('zrusit_vyzvu_k_zaloze');

-- 3d. Volání jinou podobou než `perform` (language sql, `select`) přesný
-- vzor mine; široký detektor, na kterém pojistka stojí, ne.
create function public.krok71_podvodny_select()
returns void language sql as $$
  select app.zapsat_potvrzeni_zalohy(
    '00000000-0000-0000-0000-000000000000'::uuid, 'majitel', null::uuid, null::uuid)
$$;

select pg_temp.check('volání přes „select“ přesný vzor „perform“ mine …',
  not 'public.krok71_podvodny_select' = any(pg_temp.volajici('zapsat_potvrzeni_zalohy', false)));
select pg_temp.check('… ale pojistka (široký detektor) na něj spadne',
  pg_temp.spadne_hlaskou('select pg_temp.pojistka(''zapsat_potvrzeni_zalohy'')',
    'P0001', 'public.krok71_podvodny_select'));

drop function public.krok71_podvodny_select();

select pg_temp.pojistka('zapsat_potvrzeni_zalohy');
select pg_temp.pojistka('zrusit_vyzvu_k_zaloze');

select pg_temp.check('po úklidu v katalogu žádná podvodná funkce nezůstala',
  not exists (select 1 from pg_proc where proname like 'krok71\_%'));


\echo ''
\echo '== 4. Přímé volání pomocné funkce pod rolí ================'

-- (Schéma `app` PostgREST nevystavuje, takže tohle není cesta z internetu;
-- je to měřidlo ACL v chování — kdyby se grant jednou vrátil, spadne
-- tohle i oddíl 1.)

set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000002', false);

select pg_temp.check('Boris (majitel B) zálohu firmy A přes zapsat_potvrzeni_zalohy nepotvrdí: 42501',
  pg_temp.spadne_hlaskou(format(
    'select app.zapsat_potvrzeni_zalohy(%L, %L, %L, null)',
    :'zal_a1', 'majitel', '71710000-0000-0000-0000-000000000002'),
    '42501', 'permission denied for function zapsat_potvrzeni_zalohy'));

select pg_temp.check('ani vlastní zálohu (B) — ACL nerozlišuje, čí záloha je',
  pg_temp.spadne_hlaskou(format(
    'select app.zapsat_potvrzeni_zalohy(%L, %L, %L, null)',
    :'zal_b1', 'majitel', '71710000-0000-0000-0000-000000000002'),
    '42501', 'permission denied for function zapsat_potvrzeni_zalohy'));

select pg_temp.check('Boris čekající push k záloze firmy A přes zrusit_vyzvu_k_zaloze nezruší: 42501',
  pg_temp.spadne_hlaskou(format(
    'select app.zrusit_vyzvu_k_zaloze(%L, %L)', :'zal_a1', 'krok71 útok'),
    '42501', 'permission denied for function zrusit_vyzvu_k_zaloze'));
reset role;

set role anon;
-- anon se k funkcím ve schématu app nedostane už na USAGE na schéma
-- (druhá linie; hláška je o schématu, ne o funkci). ACL funkce samotné
-- pro anon měří oddíl 1 — tady by se projevila jen přes toto schéma.
select pg_temp.check('anon: zapsat_potvrzeni_zalohy nedosáhne ani na schéma app (42501)',
  pg_temp.spadne_hlaskou(format(
    'select app.zapsat_potvrzeni_zalohy(%L, %L, null, null)', :'zal_a1', 'pin'),
    '42501', 'permission denied for schema app'));
select pg_temp.check('anon: zrusit_vyzvu_k_zaloze taky ne (42501)',
  pg_temp.spadne_hlaskou(format(
    'select app.zrusit_vyzvu_k_zaloze(%L, %L)', :'zal_a1', 'krok71 anon'),
    '42501', 'permission denied for schema app'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('záloha firmy A zůstala nepotvrzená, bez způsobu, bez potvrzujícího a bez zařízení',
  exists (select 1 from public.advances
           where id = :'zal_a1'
             and stav = 'nepotvrzena'
             and potvrzeno_kdy is null and potvrzeno_jak is null
             and potvrdil is null and potvrzeno_zarizenim is null));

select pg_temp.check('záloha firmy B taky',
  exists (select 1 from public.advances
           where id = :'zal_b1' and stav = 'nepotvrzena'
             and potvrzeno_kdy is null and potvrzeno_jak is null and potvrdil is null));

select pg_temp.check('čekající push k zal_a1 pořád čeká (nikdo ho nezrušil)',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal_a1' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'ceka_na_smenu')
  and not exists (select 1 from public.notifikace_doruceni d
                    join public.notifications n on n.id = d.notification_id
                   where n.zdroj_id = :'zal_a1' and d.stav = 'zruseno'));

select pg_temp.check('nikdo zálohu nezapsal ani do auditu jako potvrzenou',
  not exists (select 1 from public.audit_log
               where action = 'advance.potvrzeno'
                 and entity_id in (:'zal_a1', :'zal_b1')));


\echo ''
\echo '== 5. Volající a cizí firma ================================'
-- potvrdit_moji_zalohu a potvrdit_zalohu_za_zamestnance: krok60, oddíly
-- 3 a 7 (viz hlavička). Tady zbylí dva, kteří cizí firmu zkoušeni
-- nebyli.

-- ---- 5a. stornovat_zalohu ------------------------------------------
-- Dvě cesty, které se liší tím, KDO zastaví:
--   p_tenant = firma ZÁLOHY, volá cizí majitel   → has_access (právo)
--   p_tenant = firma VOLAJÍCÍHO, záloha cizí     → filtr `a.tenant_id`
-- Druhá je ta nebezpečná: právo má volající u sebe doma, jediná obrana
-- je filtr firmy na záloze (viz příprava).

set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000002', false);

select pg_temp.check('Boris (majitel B) zálohu A nestornuje, když volá za firmu A (nemá tam právo)',
  pg_temp.spadne_hlaskou(format('select public.stornovat_zalohu(%L, %L, %L)',
    :'tenant_a', :'zal_a1', 'krok71 cizí storno'),
    '42501', 'Stornovat zálohu smí jen ten, kdo je vyplácí'));

select pg_temp.check('ani když volá za SVOU firmu B se zálohou A (filtr firmy na záloze)',
  pg_temp.spadne_hlaskou(format('select public.stornovat_zalohu(%L, %L, %L)',
    :'tenant_b', :'zal_a1', 'krok71 cizí storno'),
    'P0002', 'Taková záloha tu není'));
reset role;

set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000001', false);

select pg_temp.check('Anna (majitelka A) zálohu B nestornuje, když volá za firmu B',
  pg_temp.spadne_hlaskou(format('select public.stornovat_zalohu(%L, %L, %L)',
    :'tenant_b', :'zal_b1', 'krok71 cizí storno'),
    '42501', 'Stornovat zálohu smí jen ten, kdo je vyplácí'));

select pg_temp.check('ani když volá za SVOU firmu A se zálohou B',
  pg_temp.spadne_hlaskou(format('select public.stornovat_zalohu(%L, %L, %L)',
    :'tenant_a', :'zal_b1', 'krok71 cizí storno'),
    'P0002', 'Taková záloha tu není'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('zal_a1 po čtyřech pokusech beze změny (nepotvrzená, nestornovaná, bez důvodu a času)',
  exists (select 1 from public.advances
           where id = :'zal_a1' and stav = 'nepotvrzena'
             and storno_kdy is null and storno_duvod is null and stornoval is null));

select pg_temp.check('zal_b1 po čtyřech pokusech beze změny',
  exists (select 1 from public.advances
           where id = :'zal_b1' and stav = 'nepotvrzena'
             and storno_kdy is null and storno_duvod is null and stornoval is null));

select pg_temp.check('čekající push k zal_a1 se cizím stornem nezrušil (zrusit_vyzvu_k_zaloze se nevolala)',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal_a1' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'ceka_na_smenu'));

select pg_temp.check('žádný z pokusů nenechal v auditu storno',
  not exists (select 1 from public.audit_log
               where action = 'advance.storno'
                 and entity_id in (:'zal_a1', :'zal_b1')));

-- Kontrola, že zamítnutí nebylo jen tím, že storno nefunguje nikomu.
set role authenticated;
select set_config('test.user_id', '71710000-0000-0000-0000-000000000001', false);
select pg_temp.check('důkaz: Anna stornuje zálohu SVÉ firmy (storno funguje)',
  pg_temp.projde(format('select public.stornovat_zalohu(%L, %L, %L)',
    :'tenant_a', :'zal_a_storno', 'krok71 překlep')));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('… záloha je stornovaná, s důvodem',
  exists (select 1 from public.advances
           where id = :'zal_a_storno' and stav = 'stornovana'
             and storno_duvod = 'krok71 překlep' and storno_kdy is not null));

-- NÁLEZ nezávislé kontroly (2. 10. 2026): „žádný z pokusů nenechal
-- v auditu storno" výš by prošla i nad zcela rozbitým auditováním
-- (not exists nad prázdnou tabulkou je taky true). Kladný protějšek:
-- legitimní storno musí audit NAPSAT.
select pg_temp.check('… a legitimní storno se DO auditu zapsalo (ne jen kontrola na prázdno)',
  exists (select 1 from public.audit_log
           where action = 'advance.storno' and entity_id = :'zal_a_storno'));


-- ---- 5b. potvrdit_zalohu_pinem -------------------------------------
-- Tablet firmy A (pobočka A1) + PIN Cyrila z A1 — platný. Jediné, co
-- se mění, je záloha: z firmy B, nebo z jiné pobočky téže firmy.
-- Poznámka k tomu, co kontrola měří: i bez filtru by útok neuspěl (PIN
-- ověřený tabletem A nikdy nepatří zaměstnanci B), jen by skončil
-- tichým `ok = false` místo výjimky. Měří se tedy filtr samotný — to,
-- že kdo cizí id zkouší, dostane stejnou větu jako u neexistujícího.
--
-- ZNÁMÁ MEZERA (ověřeno schválným rozbitím): filtr v těle je
-- `a.tenant_id = d.tenant_id AND a.branch_id = d.branch_id`. Id pobočky
-- patří právě jedné firmě, takže `tenant_id` je tu „napsaný dvakrát" —
-- vyndání JEN jeho prochází („firma B" drží filtr pobočky), vyndání
-- obou, nebo jen pobočky, shodí kontroly níž. Není to chyba v kontrole,
-- je to nadbytečnost v kódu (skill scenar, pravidlo b).

set role anon;
select ok as pin_ok, jmeno as pin_jmeno
  from public.potvrdit_zalohu_pinem(:'klic71', '7149', :'zal_a_pin') \gset
reset role;

select pg_temp.check('důkaz: PIN Cyrila na tabletu A potvrdí Cyrilovu zálohu (setup je platný)',
  :'pin_ok'::boolean and :'pin_jmeno' = 'Cyril Sedmdesátjedna'
  and exists (select 1 from public.advances
               where id = :'zal_a_pin' and stav = 'potvrzena' and potvrzeno_jak = 'pin'));

-- Kladný protějšek k „a v auditu po nich není potvrzení" níž (nález
-- nezávislé kontroly, 2. 10. 2026) — legitimní potvrzení PINem se DO
-- auditu zapsalo.
select pg_temp.check('… a legitimní potvrzení PINem se do auditu zapsalo',
  exists (select 1 from public.audit_log
           where action = 'advance.potvrzeno' and entity_id = :'zal_a_pin'));

set role anon;
select pg_temp.check('tentýž tablet a tentýž platný PIN zálohu FIRMY B nepotvrdí — „na téhle pobočce není“',
  pg_temp.spadne_hlaskou(format(
    'select * from public.potvrdit_zalohu_pinem(%L, %L, %L)', :'klic71', '7149', :'zal_b1'),
    'P0002', 'Taková záloha na téhle pobočce není'));

select pg_temp.check('ani zálohu jiné POBOČKY téže firmy (A2, tablet stojí na A1)',
  pg_temp.spadne_hlaskou(format(
    'select * from public.potvrdit_zalohu_pinem(%L, %L, %L)', :'klic71', '7149', :'zal_a2'),
    'P0002', 'Taková záloha na téhle pobočce není'));
reset role;

select pg_temp.check('zal_b1 a zal_a2 zůstaly nepotvrzené, bez způsobu a zařízení',
  (select count(*) from public.advances
    where id in (:'zal_b1', :'zal_a2')
      and stav = 'nepotvrzena' and potvrzeno_kdy is null
      and potvrzeno_jak is null and potvrzeno_zarizenim is null and potvrdil is null) = 2);

select pg_temp.check('a v auditu po nich není potvrzení',
  not exists (select 1 from public.audit_log
               where action = 'advance.potvrzeno'
                 and entity_id in (:'zal_b1', :'zal_a2')));


\echo ''
\echo '== Úklid ================================================='

/*
  Uklízí se zálohy, upozornění, fronta doručení, telefon, PIN, členství
  a zaměstnanci kroku 71.

  FIRMY A A B ZŮSTÁVAJÍ (i s pobočkami, majiteli a tablet A) — stejně
  jako cizí firma po krocích 54, 57 a 60: pobočku audit_log nedovolí
  smazat (audit_log.branch_id je `on delete set null` a audit_log má
  pravidlo `no_update … do instead nothing`). Seed i ostatní scénáře
  firmy s jinými jmény nepotkají.
*/
select set_config('test.user_id', '', false);

delete from public.notifikace_doruceni
 where user_id = '71710000-0000-0000-0000-000000000003';
delete from public.notifications
 where user_id = '71710000-0000-0000-0000-000000000003'
    or (zdroj_typ = 'zaloha' and zdroj_id in (:'zal_a1', :'zal_a_storno', :'zal_a_pin', :'zal_a2', :'zal_b1'));
delete from public.push_odbery
 where user_id = '71710000-0000-0000-0000-000000000003';
delete from public.advances
 where id in (:'zal_a1', :'zal_a_storno', :'zal_a_pin', :'zal_a2', :'zal_b1');
delete from public.employee_pins where employee_id = :'emp_cyril';
delete from public.memberships
 where tenant_id = :'tenant_a' and user_id = '71710000-0000-0000-0000-000000000003';
delete from public.employees
 where id in (:'emp_cyril', :'emp_dana', :'emp_emil');

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 71 (kromě majitelů firem)',
  not exists (select 1 from public.employees
               where full_name like '%Sedmdesátjedna' and not je_majitel)
  and not exists (select 1 from public.advances where poznamka like 'krok71%')
  and not exists (select 1 from public.notifications
                   where user_id = '71710000-0000-0000-0000-000000000003')
  and not exists (select 1 from pg_proc where proname like 'krok71\_%'));

\echo ''
\echo '== KROK 71 HOTOV ========================================'
