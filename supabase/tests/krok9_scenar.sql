-- Scénář pro krok 9 — poslední majitel.
--
-- Pokrývá migraci 20260902010000_posledni_majitel a pět kontrol ze
-- zadání docs/vlastniku-muze-byt-vic.md.
--
-- Navazuje na etapa0_scenar.sql až krok8_scenar.sql.
--
-- Od 1. 9. to není teorie: Lucie má pozvánku s rolí Majitel, takže
-- jakmile ji přijme, budou majitelé dva a můžou si navzájem odebrat
-- přístup.
--
-- V PGlite je spoušť ověřená (24 kontrol), ale běží se tam jako
-- superuživatel. Tady jde o to, že to platí i pod rolí `authenticated`
-- a že se to nedá obejít oprávněním — spoušť se totiž na oprávnění
-- neptá a musí zabrat i tomu, kdo people.manage má.
--
-- Kontroly míří na to, co NEMÁ jít.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
--
-- Druhý majitel. Zakládá se pod superuživatelem: kdo smí majitele
-- jmenovat, ověřuje krok 4 i krok 7 — tady jde o to, co se stane, když
-- už dva jsou.
-- =====================================================================

select id as tenant from public.tenants limit 1 \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as marek    from public.profiles where email = 'cisnik@foodtab.cz' \gset

select id as r_majitel from public.roles
  where tenant_id = :'tenant' and is_owner \gset
select id as r_servis from public.roles
  where tenant_id = :'tenant' and key = 'servis' \gset

select id as m_majitel from public.memberships
  where tenant_id = :'tenant' and user_id = :'majitel' \gset

select id as e_majitel from public.employees
  where tenant_id = :'tenant' and user_id = :'majitel' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'druhy-majitel@foodtab.cz',
   '{"full_name":"Druhá Majitelka"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', 'cccccccc-cccc-cccc-cccc-cccccccccccc', :'r_majitel', 'active', 'tenant')
on conflict (tenant_id, user_id) do update
  set role_id = excluded.role_id, status = 'active'
returning id as m_druhy \gset

select set_config('test.tenant',    :'tenant',    false);
select set_config('test.m_majitel', :'m_majitel', false);
select set_config('test.m_druhy',   :'m_druhy',   false);
select set_config('test.e_majitel', :'e_majitel', false);
select set_config('test.r_servis',  :'r_servis',  false);


\echo ''
\echo '== Dva majitelé =========================================='

select pg_temp.check('firma má dva majitele',
  app.pocet_majitelu(:'tenant', null) = 2);

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('a průzor pro obrazovku to říká taky',
  public.pocet_majitelu(:'tenant') = 2);
reset role;

-- 1. Ze dvou jde jeden odebrat.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
delete from public.memberships where id = :'m_druhy';
reset role;

select pg_temp.check('ze dvou majitelů jde jeden odebrat',
  not exists (select 1 from public.memberships where id = :'m_druhy'));

select pg_temp.check('a zůstal jeden', app.pocet_majitelu(:'tenant', null) = 1);


\echo ''
\echo '== Poslední majitel ======================================'

/*
  Tohle je jádro celé migrace. Přes politiku se maže TIŠE — příkaz
  smaže nula řádků a neohlásí nic, takže si člověk myslí, že to
  proběhlo. Tady to musí vyhodit chybu s větou, která říká proč.
*/

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare
  v_ok    boolean;
  v_text  text;
begin
  begin
    delete from public.memberships where id = current_setting('test.m_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  perform pg_temp.check('poslední majitel se odebrat NEDÁ', v_ok);
  perform pg_temp.check('a hláška říká proč',
    v_text = 'Ve firmě musí zůstat aspoň jeden majitel. Nejdřív jmenujte dalšího.');

  /*
    Od téhle chvíle se zkouší ZPOD SUPERUŽIVATELE.

    Politika `memberships_write` nepustí nikoho na jeho VLASTNÍ členství
    (kontrola je v krok4). Pod rolí `authenticated` tedy update neprojde
    a neudělá nic — tiše, bez chyby — takže by se ke spoušti vůbec
    nedostal a kontrola by padala na tom, že ji nikdo nezavolal.

    V PGlite to nevyšlo najevo, protože tam se běží jako superuživatel
    a RLS se neuplatní. Tady je potřeba to oddělit: politika je první
    linie a hlídá se jinde, tohle je zkouška DRUHÉ linie — spouště.
  */
  reset role;

  -- 3. Přeřazení na jinou roli.
  begin
    update public.memberships
       set role_id = current_setting('test.r_servis')::uuid
     where id = current_setting('test.m_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('ani přeřadit na jinou roli', v_ok);

  -- Ani „žádná role“, což je od pozvánek bez oprávnění platný stav.
  begin
    update public.memberships set role_id = null
     where id = current_setting('test.m_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('ani na žádnou roli', v_ok);

  -- Pozastavení není v zadání vyjmenované, ale je to tatáž díra:
  -- pozastavený majitel není aktivní majitel.
  begin
    update public.memberships set status = 'suspended'
     where id = current_setting('test.m_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('ani pozastavit', v_ok);
end $$;

reset role;

select pg_temp.check('členství je pořád na svém místě',
  (select role_id from public.memberships where id = :'m_majitel') = :'r_majitel');

select pg_temp.check('a je aktivní',
  (select status from public.memberships where id = :'m_majitel') = 'active');


\echo ''
\echo '== Zaměstnanec posledního majitele ======================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean;
begin
  begin
    update public.employees set deleted_at = now()
     where id = current_setting('test.e_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('označit ho za smazaného nejde', v_ok);
end $$;

reset role;

select pg_temp.check('zaměstnanec je pořád živý',
  (select deleted_at from public.employees where id = :'e_majitel') is null);


\echo ''
\echo '== Co jít MÁ ============================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Jiná změna u posledního majitele projít musí. Spoušť hlídá jen to,
-- co ho o majitelství připraví.
update public.memberships set scope = 'tenant' where id = :'m_majitel';

select pg_temp.check('jiná změna u posledního majitele projde',
  (select scope from public.memberships where id = :'m_majitel') = 'tenant');

-- 4. Zbylý majitel pořád může přidělovat.
select pg_temp.check('zbylý majitel smí přidělit roli Majitel',
  app.smi_pridelit(:'tenant', :'r_majitel', 'tenant'));

select pg_temp.check('i jinou roli',
  app.smi_pridelit(:'tenant', :'r_servis', 'tenant'));

reset role;

-- Číšníka se to netýká.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_pocet integer;
begin
  update public.employees set deleted_at = now()
   where user_id = (select user_id from public.profiles where email = 'cisnik@foodtab.cz')
     and tenant_id = current_setting('test.tenant')::uuid;
  get diagnostics v_pocet = row_count;
  perform pg_temp.check('smazat číšníka jde', v_pocet = 1);

  -- A zpátky, ať další scénáře nekoukají na smazaného člověka.
  update public.employees set deleted_at = null
   where user_id = (select user_id from public.profiles where email = 'cisnik@foodtab.cz')
     and tenant_id = current_setting('test.tenant')::uuid;
end $$;

reset role;


\echo ''
\echo '== 5. Sám sebe poslední majitel neodebere ================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean;
begin
  begin
    delete from public.memberships
     where tenant_id = current_setting('test.tenant')::uuid
       and user_id = (select auth.uid());
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('poslední majitel se sám neodebere', v_ok);
end $$;

reset role;

select pg_temp.check('a pořád je majitelem',
  app.pocet_majitelu(:'tenant', null) = 1);


\echo ''
\echo '== Kdo to nesmí obejít ==================================='

/*
  Spoušť se neptá na oprávnění a to je schválně: firma bez majitele je
  porouchaná bez ohledu na to, kdo ji tak zařídil. Provozní má
  people.manage, takže by na politiku dosáhl — na spoušť ne.
*/

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select pg_temp.check('provozní spravuje lidi',
  app.has_access(:'tenant', 'people.manage', null));

do $$
declare v_ok boolean;
begin
  begin
    delete from public.memberships where id = current_setting('test.m_majitel')::uuid;
    v_ok := false;
  exception when restrict_violation then v_ok := true;
  end;
  perform pg_temp.check('ale posledního majitele neodebere ani on', v_ok);
end $$;

reset role;

select pg_temp.check('majitel tam je pořád',
  app.pocet_majitelu(:'tenant', null) = 1);


\echo ''
\echo '=========================================================='
\echo ' KROK 9 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
