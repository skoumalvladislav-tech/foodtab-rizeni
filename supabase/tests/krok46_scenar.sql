-- Scénář pro krok 46 — Majiteli chodí upozornění kdykoliv.
--
-- Pokrývá migraci 20260922120000_majitel_doruceni_kdykoliv.sql.
--
-- Navazuje na etapa0_scenar.sql až krok45_scenar.sql. Fronta doručení
-- (notifikace_doruceni) je detailně prokoušlá v krok42_scenar.sql, oddíly
-- 4–5 (mimo směnu / na směně / po příchodu) — tenhle scénář na to
-- nesahá znovu, jen přidává třetí důvod k okamžitému doručení
-- (je_majitel) vedle už existujících dvou (naléhavost, směna).
--
-- Srovnávací kontrola (Nikol, ne-majitel, jinak identická příprava)
-- dokazuje, že oprava neudělá „všem hned" — mimo směnu pořád čeká
-- KDOKOLI, kdo majitel není.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
-- Předchozí scénář nechává test.user_id nastavené (jen `reset role` na
-- konci, ne vyprázdnění) — bez tohohle by auth.uid() tady zdědil cizího
-- člověka a insert s je_majitel=true by spadl na „Majitele jmenuje jenom
-- majitel." (app.hlida_strop_zarazeni).
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('46460000-0000-0000-0000-00000000000a', 'majitel46@foodtab.cz', '{"full_name":"Majitel Šestačtyřicet"}'),
  ('46460000-0000-0000-0000-00000000000b', 'bezpush46@foodtab.cz', '{"full_name":"Majitel Bez Push Šestačtyřicet"}'),
  ('46460000-0000-0000-0000-00000000000c', 'nikol46@foodtab.cz',   '{"full_name":"Nikol Šestačtyřicet"}');

select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel) values
  (:'tenant', :'perla', '46460000-0000-0000-0000-00000000000a', 'Majitel Šestačtyřicet',         'hpp', true),
  (:'tenant', :'perla', '46460000-0000-0000-0000-00000000000b', 'Majitel Bez Push Šestačtyřicet', 'hpp', true),
  (:'tenant', :'perla', '46460000-0000-0000-0000-00000000000c', 'Nikol Šestačtyřicet',            'hpp', false);

select id as majitel     from public.employees where user_id = '46460000-0000-0000-0000-00000000000a' \gset
select id as bez_push    from public.employees where user_id = '46460000-0000-0000-0000-00000000000b' \gset
select id as nikol       from public.employees where user_id = '46460000-0000-0000-0000-00000000000c' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
select :'tenant', u, :'role_kuchyne', 'branch', 'active'
from (values
  ('46460000-0000-0000-0000-00000000000a'::uuid),
  ('46460000-0000-0000-0000-00000000000b'::uuid),
  ('46460000-0000-0000-0000-00000000000c'::uuid)
) t(u);

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid
  from public.memberships m
 where m.user_id::text like '46460000-%' and m.tenant_id = :'tenant';

-- Push zapnutý jen majiteli a Nikol — „Bez Push" schválně žádný nemá
-- (dokazuje, že bez předplatného frontu neobejde ani majitel).
insert into public.push_odbery (user_id, endpoint, p256dh, auth_secret) values
  ('46460000-0000-0000-0000-00000000000a', 'https://push.example/majitel46', 'p256dh-majitel46-0123456789', 'auth-majitel46-0123'),
  ('46460000-0000-0000-0000-00000000000c', 'https://push.example/nikol46',   'p256dh-nikol46-0123456789',   'auth-nikol46-0123');


\echo ''
\echo '== 1. Mimo směnu: majitel jde hned, kdokoli jiný čeká ========'

-- Nikdo z trojice není na směně (žádné app.pichnout se nevolalo).

select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000a', 'test.majitel.normal',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:maj1') as n_maj \gset
select pg_temp.check('majitel mimo směnu: normální jde HNED (nečeká na směnu, kterou nemá)',
  (select stav from public.notifikace_doruceni where notification_id = :'n_maj') = 'k_odeslani');

select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000c', 'test.nikol.normal',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:nik1') as n_nik \gset
select pg_temp.check('srovnání: NE-majitel mimo směnu pořád čeká na směnu (oprava nesnížila hlídání ostatním)',
  (select stav from public.notifikace_doruceni where notification_id = :'n_nik') = 'ceka_na_smenu');

select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000a', 'test.majitel.important',
  '{}'::jsonb, 'important', null, null, null, null, 'k:maj2') as n_maj_imp \gset
select pg_temp.check('majitel: i DŮLEŽITÁ (ne jen normální) jde hned',
  (select stav from public.notifikace_doruceni where notification_id = :'n_maj_imp') = 'k_odeslani');


\echo ''
\echo '== 2. Bez předplatného push obchází frontu i majiteli =========='

select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000b', 'test.majitel.bezpush',
  '{}'::jsonb, 'normal') as n_bezpush \gset
select pg_temp.check('majitel BEZ push předplatného: do fronty se nezaloží nic (není komu posílat)',
  not exists (select 1 from public.notifikace_doruceni where notification_id = :'n_bezpush'));


\echo ''
\echo '== 3. low se pro majitele nemění ================================'

select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000a', 'test.majitel.low',
  '{}'::jsonb, 'low') as n_maj_low \gset
select pg_temp.check('majitel: priorita low pořád nemá žádný externí kanál',
  not exists (select 1 from public.notifikace_doruceni where notification_id = :'n_maj_low'));


\echo ''
\echo '== 4. Na směně to funguje jako dřív (bypass nic nerozbíjí) ======'

select udalost from app.pichnout(:'tenant', :'perla', :'majitel', 'in') \gset
select app.notifikovat(:'tenant', '46460000-0000-0000-0000-00000000000a', 'test.majitel.nasmene',
  '{}'::jsonb, 'normal', null, null, null, null, 'k:maj3') as n_maj_smena \gset
select pg_temp.check('majitel NA směně: normální jde hned (stejně jako mimo ni)',
  (select stav from public.notifikace_doruceni where notification_id = :'n_maj_smena') = 'k_odeslani');
select udalost from app.pichnout(:'tenant', :'perla', :'majitel', 'out') \gset


\echo ''
\echo 'VŠECHNY KONTROLY KROKU 46 PROŠLY'
