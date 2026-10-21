-- Scénář pro krok 99 — Faktury v hlavní databázi (sloučení s „apkou faktury").
--
-- Migrace: 20261018100000_faktury_v_hlavni_databazi.sql.
-- Návrh: docs/faktury-slouceni-navrh.md.
--
-- Pokrývá:
--   1. granty (první linie): anon nic, authenticated bez TRUNCATE/REFERENCES/
--      TRIGGER, kopie staré databáze jen úloze, stav převodu úloha nepřepne;
--   2. brána podle stavu převodu — pro přihlášeného i pro úlohu: bez
--      převodu zavřeno, během převodu zapisuje jen převod, po dokončení
--      jen appka a funkce párování;
--   3. porovnání pole po poli v SQL proti převodu v TypeScriptu (blok dat
--      generuje scripts/faktury-prevod.test.mjs) — a že rozdíl opravdu najde;
--   4. dokončení: odmítne, když nesedí počet, rozdíl nebo přílohy; když
--      sedí, otevře Faktury a doplní cizí klíče u starých párování
--      a evidence; párování bez faktury jen vykáže;
--   5. čtení jen za celou firmu (faktury, evidence příjmu, přílohy) —
--      člen jedné pobočky, člověk bez práva a cizí firma nic;
--   6. zápis po dokončení: id si přihlášený nevybírá, duplicita se
--      označí, převodní značku ani firmu nezmění, fakturu s párováním
--      nesmaže;
--   7. párování v jedné transakci (stav faktury), práva, cizí měna,
--      stará cesta po dokončení zavřená; automatické párování a jeho zrušení;
--   8. spoušť odkazu (text ↔ uuid) a složený cizí klíč (cizí firma);
--   9. úložiště: ruční nahrání jen do vlastní složky rucne/, ne do otisků;
--  10. vrácení a nové zahájení.
--
-- POZOR: PGlite běží jako superuživatel — kontroly RLS (oddíl 5, část 6,
-- 9) rozhoduje až workflow Databáze proti PostgreSQL 16.
--
-- Navazuje na etapa0_scenar.sql (firma „Foodtab s.r.o.", majitel).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

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

create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

create or replace function pg_temp.pocet(p_sql text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  execute p_sql into v;
  return v;
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
select id as perla from public.branches where tenant_id = :'tenant' and slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant', 'finance')
on conflict (tenant_id, module_key) do nothing;


\echo ''
\echo '== 0. Příprava: cizí firma, lidé, účet a platby ======================='

-- Cizí firma s vlastním majitelem (vzor krok95).
insert into auth.users (id, email, raw_user_meta_data) values
  ('99990000-0000-0000-0000-000000000001', 'xaver99@jinafirma.cz', '{"full_name":"Xaver Devadesátdevět"}');
set role authenticated;
select set_config('test.user_id', '99990000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok99 Cizí s.r.o.', 'Xaver Devadesátdevět') as tenant_b \gset
reset role;
select set_config('test.user_id', '', false);
insert into public.tenant_modules (tenant_id, module_key)
values (:'tenant_b', 'finance')
on conflict (tenant_id, module_key) do nothing;

-- Lidé Foodtabu:
--   cte      faktury.read, celá firma
--   pobocka  faktury.read + faktury.manage + finance.*, jen pobočka Perla
--   finance  finance.read + finance.manage, celá firma, BEZ faktur
insert into auth.users (id, email, raw_user_meta_data) values
  ('99990000-0000-0000-0000-000000000002', 'cte99@foodtab.cz', '{"full_name":"Čte Devadesátdevět"}'),
  ('99990000-0000-0000-0000-000000000003', 'perla99@foodtab.cz', '{"full_name":"Perla Devadesátdevět"}'),
  ('99990000-0000-0000-0000-000000000004', 'finance99@foodtab.cz', '{"full_name":"Finance Devadesátdevět"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok99_cte', 'Krok99 — čte faktury', 'provoz', true) returning id as poz_cte \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok99_pobocka', 'Krok99 — pobočka', 'provoz', true) returning id as poz_pobocka \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'krok99_finance', 'Krok99 — finance bez faktur', 'provoz', true) returning id as poz_finance \gset

insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'poz_cte', 'faktury.read'),
  (:'tenant', :'poz_pobocka', 'faktury.read'),
  (:'tenant', :'poz_pobocka', 'faktury.manage'),
  (:'tenant', :'poz_pobocka', 'finance.read'),
  (:'tenant', :'poz_pobocka', 'finance.manage'),
  (:'tenant', :'poz_finance', 'finance.read'),
  (:'tenant', :'poz_finance', 'finance.manage');

insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '99990000-0000-0000-0000-000000000002', :'poz_cte', 'Čte Devadesátdevět', 'hpp') returning id as e_cte \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '99990000-0000-0000-0000-000000000003', :'poz_pobocka', 'Perla Devadesátdevět', 'hpp') returning id as e_pobocka \gset
insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '99990000-0000-0000-0000-000000000004', :'poz_finance', 'Finance Devadesátdevět', 'hpp') returning id as e_finance \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '99990000-0000-0000-0000-000000000002', null, 'tenant', 'active') returning id as m_cte \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '99990000-0000-0000-0000-000000000003', null, 'branch', 'active') returning id as m_pobocka \gset
insert into public.membership_branches (membership_id, branch_id) values (:'m_pobocka', :'perla');
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '99990000-0000-0000-0000-000000000004', null, 'tenant', 'active') returning id as m_finance \gset

-- Firemní účet a platby (superuživatel; zdroj „z banky" smí zapsat jen úloha).
insert into public.platebni_ucty (tenant_id, nazev, typ) values (:'tenant', 'Krok99 účet', 'banka') returning id as ucet \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 100000, current_date - 3, 'Dodavatel s.r.o.', '20260815', 'csv_banka') returning id as t1 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 77700, current_date - 2, 'Automat s.r.o.', '777', 'csv_banka') returning id as t2 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 50000, current_date - 2, 'Staré párování', '1', 'csv_banka') returning id as t3 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 20000, current_date - 2, 'Visící párování', '2', 'csv_banka') returning id as t4 \gset
-- Příchozí platba: s přijatou fakturou se párovat nesmí (patří Jiným platbám).
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'prijem', 30000, current_date - 2, 'Odběratel s.r.o.', '20260815', 'csv_banka') returning id as t5 \gset

-- Schránka pro evidenci příjmu (vzor krok90).
insert into public.integrace_pripojeni (tenant_id, oblast, poskytovatel, rezim, nazev, stav, externi_ucet)
values (:'tenant', 'email_dokladu', 'imap', 'zakaznicky', 'Krok99 faktury@', 'pripojeno',
        '{"host": "imap.krok99.cz", "port": 993, "zabezpeceni": "tls", "uzivatel": "faktury@krok99.cz"}')
returning id as schranka \gset

create or replace function pg_temp.prijem_sql(p_tenant uuid, p_schranka uuid, p_uid int, p_faktura_id text)
returns text language sql as $$
  select format(
    'insert into public.faktury_prijem (tenant_id, pripojeni_id, slozka, uidvalidity, uid, priloha_cast, priloha_nazev, priloha_typ, priloha_velikost, druh, stav, faktura_id) '
    || 'values (%L, %L, %L, %L, %s, %L, %L, %L, %s, %L, %L, %L)',
    p_tenant, p_schranka, 'INBOX', '1700000099', p_uid, '2', 'FV.pdf', 'application/pdf', 1000, 'pdf', 'zapsano', p_faktura_id)
$$;


\echo ''
\echo '== 1. Granty: první linie ================================================'

-- POZOR: čistá databáze z run.sh nemá výchozí práva Supabase (`grant all`
-- každé nové tabulce), takže kontroly „X NEMÁ" tady projdou i bez řádku
-- `revoke` v migraci. Ty hlídá text migrace (scripts/faktury-tenant-
-- izolace.test.mjs, oddíl granty). Kontroly „X MÁ" tady spadnout umí.

select pg_temp.check('faktury: anon nic (ani select)',
  not has_table_privilege('anon', 'public.faktury', 'select')
  and not has_table_privilege('anon', 'public.faktury', 'insert'));
select pg_temp.check('faktury: authenticated select/insert/delete',
  has_table_privilege('authenticated', 'public.faktury', 'select')
  and has_table_privilege('authenticated', 'public.faktury', 'insert')
  and has_table_privilege('authenticated', 'public.faktury', 'delete'));
-- Úprava jen sloupců, které appka mění — PŘESNÁ množina: navíc částka
-- by dovolila podvrhnout stav faktury přes REST, méně by rozbilo akce.
-- has_column_privilege vidí i grant na celou tabulku.
select pg_temp.check('faktury: authenticated mění jen stav, poznámku, archiv a upomínku',
  (select array_agg(a.attname::text order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.faktury'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.faktury', a.attname::text, 'UPDATE'))
  = array['archivovano', 'poznamka_kontroly', 'stav', 'upominka_odeslana_kdy']);
select pg_temp.check('faktury: authenticated bez TRUNCATE/REFERENCES/TRIGGER',
  not has_table_privilege('authenticated', 'public.faktury', 'truncate')
  and not has_table_privilege('authenticated', 'public.faktury', 'references')
  and not has_table_privilege('authenticated', 'public.faktury', 'trigger'));
select pg_temp.check('faktury: service_role bez TRUNCATE',
  not has_table_privilege('service_role', 'public.faktury', 'truncate'));
select pg_temp.check('kopie staré databáze: authenticated nic, úloha čte i zapisuje',
  not has_table_privilege('authenticated', 'public.faktury_prevod_zdroj', 'select')
  and not has_table_privilege('anon', 'public.faktury_prevod_zdroj', 'select')
  and has_table_privilege('service_role', 'public.faktury_prevod_zdroj', 'insert')
  and has_table_privilege('service_role', 'public.faktury_prevod_zdroj', 'delete'));
select pg_temp.check('stav převodu: authenticated jen čte, úloha mění jen seznam příloh (stav ne)',
  has_column_privilege('authenticated', 'public.faktury_prevod', 'stav', 'select')
  and has_column_privilege('authenticated', 'public.faktury_prevod', 'tenant_id', 'select')
  -- měření (součty párování), texty chyb úlohy a zámek přihlášený nečte
  and not has_column_privilege('authenticated', 'public.faktury_prevod', 'mereni_dokonceni', 'select')
  and not has_column_privilege('authenticated', 'public.faktury_prevod', 'mereni_zahajeni', 'select')
  and not has_column_privilege('authenticated', 'public.faktury_prevod', 'prilohy', 'select')
  and not has_table_privilege('authenticated', 'public.faktury_prevod', 'update')
  and has_column_privilege('service_role', 'public.faktury_prevod', 'prilohy', 'update')
  and not has_column_privilege('service_role', 'public.faktury_prevod', 'stav', 'update')
  and not has_table_privilege('service_role', 'public.faktury_prevod', 'insert'));
select pg_temp.check('vzory odmítnutí: authenticated select/insert, ne update/delete',
  has_table_privilege('authenticated', 'public.faktury_vzory_odmitnuti', 'insert')
  and not has_table_privilege('authenticated', 'public.faktury_vzory_odmitnuti', 'update')
  and not has_table_privilege('authenticated', 'public.faktury_vzory_odmitnuti', 'delete'));
select pg_temp.check('funkce převodu a automatiky: authenticated ani anon ne',
  not has_function_privilege('authenticated', 'public.faktury_prevod_dokoncit(uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.faktury_prevod_zahajit(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.automaticky_sparovat_fakturu(uuid, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric)', 'execute')
  and has_function_privilege('service_role', 'public.faktury_prevod_dokoncit(uuid, integer, integer)', 'execute'));
select pg_temp.check('ruční párování: authenticated smí volat (o právu rozhoduje funkce)',
  has_function_privilege('authenticated', 'public.sparovat_platbu_s_fakturou(uuid, uuid, uuid, integer, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.zrusit_parovani_faktury(uuid, uuid, text)', 'execute'));


\echo ''
\echo '== 2. Bez převodu jsou Faktury zavřené — pro všechny ==================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel: zápis faktury bez převodu → zavřeno',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant', 'X'),
    '42501', 'nejsou otevřené'));
reset role;
select set_config('test.user_id', '', false);

set role service_role;
select pg_temp.check('úloha: zápis bez značky bez převodu → zavřeno',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant', 'X'),
    '42501', 'nejsou otevřené'));
select pg_temp.check('úloha: převodní zápis bez zahájení → odmítnut',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel, prevedeno_kdy) values (%L, %L, now())', :'tenant', 'X'),
    '42501', 'neprobíhá'));
select pg_temp.check('úloha: kopii staré databáze bez zahájení nezapíše',
  pg_temp.spadne_hlaskou(format('insert into public.faktury_prevod_zdroj (tenant_id, tabulka, klic, radek) values (%L, %L, %L, %L)', :'tenant', 'invoices', 'x', '{}'),
    '42501', 'jen během převodu'));
reset role;

-- Staré párování a evidence ještě PŘED převodem (starý kód): faktura_id
-- je text (tady velkými písmeny a s mezerou), faktura v hlavní databázi
-- zatím není → uuid zůstane prázdné, doplní ho až dokončení.
insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, potvrzeno_kdy)
values (:'tenant', :'t3', ' A0000000-0000-4000-8000-000000000001', 50000, 'potvrzeno', now()) returning id as stare_parovani \gset
-- Párování na fakturu, která ve staré databázi zmizela.
insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, potvrzeno_kdy)
values (:'tenant', :'t4', 'b9999999-0000-4000-8000-000000000999', 20000, 'potvrzeno', now()) returning id as visici_parovani \gset
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 1, 'a0000000-0000-4000-8000-000000000002')) as ok_pomocny \gset
select pg_temp.check('před převodem: staré párování i evidence bez uuid faktury',
  :'ok_pomocny'::boolean
  and (select faktura from public.platby_faktury where id = :'stare_parovani') is null
  and exists (select 1 from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 1 and faktura is null));


\echo ''
\echo '== 3. Zahájení a převod: porovnání pole po poli v SQL =================='

select app.faktury_prevod_zahajit(:'tenant', 'ctqtwahlzhyjerqulqyn.supabase.co', '{"pocet": 4}') as stav_zahajeni \gset
select pg_temp.check('zahájení → probiha', :'stav_zahajeni' = 'probiha');

set role service_role;
-- DATA PRO POROVNÁNÍ (začátek) — generuje scripts/faktury-prevod.test.mjs --vypsat, ručně neupravovat
insert into public.faktury_prevod_zdroj (tenant_id, tabulka, klic, radek) values
  (:'tenant', 'invoices', 'a0000000-0000-4000-8000-000000000001', '{"id":"a0000000-0000-4000-8000-000000000001","received_at":"2026-09-05T10:11:12.123456+00:00","email_sender":"faktury@dodavatel.cz","email_subject":"Faktura 2026/0815","supplier":"Dodavatel s.r.o.","supplier_ico":"12345678","invoice_number":"FV2026/0815","variable_symbol":"20260815","amount":1210.5,"currency":"CZK","issue_date":"2026-09-01","duzp":"2026-09-01","due_date":"2026-09-15","supplier_account":"123456789/0100","status":"Ke kontrole úhrady","needs_review":false,"onedrive_url":null,"pdf_url":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","reminder_sent_at":null,"created_at":"2026-09-05T10:11:13.5+00:00","updated_at":"2026-10-01T08:00:00+00:00","is_duplicate":false,"is_archived":false,"review_note":null,"document_text_excerpt":"FAKTURA – daňový doklad\nDodavatel s.r.o."}'::jsonb),
  (:'tenant', 'invoices', 'a0000000-0000-4000-8000-000000000002', '{"id":"a0000000-0000-4000-8000-000000000002","received_at":"2026-09-05T10:11:12.123456+00:00","email_sender":"faktury@dodavatel.cz","email_subject":"Faktura 2026/0815","supplier":"Dodavatel s.r.o.","supplier_ico":null,"invoice_number":"FV2026/0815","variable_symbol":"20260815","amount":-350,"currency":"EUR","issue_date":"2026-09-01","duzp":"2026-09-01","due_date":null,"supplier_account":"123456789/0100","status":"Nutná ruční kontrola (chybí IČO)","needs_review":null,"onedrive_url":"https://onedrive.live.com/x","pdf_url":null,"reminder_sent_at":"2026-10-01T07:00:00.999999+00:00","created_at":"2026-09-05T10:11:13.5+00:00","updated_at":"2026-10-01T08:00:00+00:00","is_duplicate":true,"is_archived":false,"review_note":null,"document_text_excerpt":"FAKTURA – daňový doklad\nDodavatel s.r.o."}'::jsonb),
  (:'tenant', 'invoices', 'a0000000-0000-4000-8000-000000000003', '{"id":"a0000000-0000-4000-8000-000000000003","received_at":"2026-09-05T10:11:12.123456+00:00","email_sender":"faktury@dodavatel.cz","email_subject":"Řeřicha „uvozovky\" \t tab","supplier":"","supplier_ico":"12345678","invoice_number":"FV2026/0815","variable_symbol":"20260815","amount":0,"currency":"CZK","issue_date":null,"duzp":null,"due_date":"2026-09-15","supplier_account":"123456789/0100","status":"Odmítnuto","needs_review":false,"onedrive_url":null,"pdf_url":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","reminder_sent_at":null,"created_at":"2026-09-05T10:11:13.5+00:00","updated_at":"2026-10-01T08:00:00+00:00","is_duplicate":false,"is_archived":true,"review_note":null,"document_text_excerpt":null}'::jsonb),
  (:'tenant', 'invoices', 'a0000000-0000-4000-8000-000000000004', '{"id":"a0000000-0000-4000-8000-000000000004","received_at":"2026-01-01T00:00:00+00:00","email_sender":null,"email_subject":"Faktura 2026/0815","supplier":"Dodavatel s.r.o.","supplier_ico":"12345678","invoice_number":"FV2026/0815","variable_symbol":"20260815","amount":"99999.99","currency":"CZK","issue_date":"2026-09-01","duzp":"2026-09-01","due_date":"2026-09-15","supplier_account":"123456789/0100","status":"Ke kontrole úhrady","needs_review":false,"onedrive_url":null,"pdf_url":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","reminder_sent_at":null,"created_at":"2026-01-01T00:00:00.000001+00:00","updated_at":"2026-10-01T08:00:00+00:00","is_duplicate":false,"is_archived":false,"review_note":"Automaticky vyřazeno – „Dodavatel\"","document_text_excerpt":"FAKTURA – daňový doklad\nDodavatel s.r.o."}'::jsonb);
insert into public.faktury (tenant_id, prevedeno_kdy, id, prijato_kdy, email_odesilatel, email_predmet, dodavatel, dodavatel_ico, cislo_faktury, variabilni_symbol, castka_haleru, mena, datum_vystaveni, duzp, splatnost, ucet_dodavatele, stav, ke_kontrole, duplicita, archivovano, poznamka_kontroly, upominka_odeslana_kdy, vytah_textu, odkaz_pdf, odkaz_onedrive, vytvoreno_kdy)
select :'tenant', now(), r.id, r.prijato_kdy, r.email_odesilatel, r.email_predmet, r.dodavatel, r.dodavatel_ico, r.cislo_faktury, r.variabilni_symbol, r.castka_haleru, r.mena, r.datum_vystaveni, r.duzp, r.splatnost, r.ucet_dodavatele, r.stav, r.ke_kontrole, r.duplicita, r.archivovano, r.poznamka_kontroly, r.upominka_odeslana_kdy, r.vytah_textu, r.odkaz_pdf, r.odkaz_onedrive, r.vytvoreno_kdy
  from (values
  ('{"id":"a0000000-0000-4000-8000-000000000001","prijato_kdy":"2026-09-05T10:11:12.123456+00:00","email_odesilatel":"faktury@dodavatel.cz","email_predmet":"Faktura 2026/0815","dodavatel":"Dodavatel s.r.o.","dodavatel_ico":"12345678","cislo_faktury":"FV2026/0815","variabilni_symbol":"20260815","castka_haleru":121050,"mena":"CZK","datum_vystaveni":"2026-09-01","duzp":"2026-09-01","splatnost":"2026-09-15","ucet_dodavatele":"123456789/0100","stav":"Ke kontrole úhrady","ke_kontrole":false,"duplicita":false,"archivovano":false,"poznamka_kontroly":null,"upominka_odeslana_kdy":null,"vytah_textu":"FAKTURA – daňový doklad\nDodavatel s.r.o.","odkaz_pdf":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","odkaz_onedrive":null,"vytvoreno_kdy":"2026-09-05T10:11:13.5+00:00"}'::jsonb),
  ('{"id":"a0000000-0000-4000-8000-000000000002","prijato_kdy":"2026-09-05T10:11:12.123456+00:00","email_odesilatel":"faktury@dodavatel.cz","email_predmet":"Faktura 2026/0815","dodavatel":"Dodavatel s.r.o.","dodavatel_ico":null,"cislo_faktury":"FV2026/0815","variabilni_symbol":"20260815","castka_haleru":-35000,"mena":"EUR","datum_vystaveni":"2026-09-01","duzp":"2026-09-01","splatnost":null,"ucet_dodavatele":"123456789/0100","stav":"Nutná ruční kontrola (chybí IČO)","ke_kontrole":false,"duplicita":true,"archivovano":false,"poznamka_kontroly":null,"upominka_odeslana_kdy":"2026-10-01T07:00:00.999999+00:00","vytah_textu":"FAKTURA – daňový doklad\nDodavatel s.r.o.","odkaz_pdf":null,"odkaz_onedrive":"https://onedrive.live.com/x","vytvoreno_kdy":"2026-09-05T10:11:13.5+00:00"}'::jsonb),
  ('{"id":"a0000000-0000-4000-8000-000000000003","prijato_kdy":"2026-09-05T10:11:12.123456+00:00","email_odesilatel":"faktury@dodavatel.cz","email_predmet":"Řeřicha „uvozovky\" \t tab","dodavatel":"","dodavatel_ico":"12345678","cislo_faktury":"FV2026/0815","variabilni_symbol":"20260815","castka_haleru":0,"mena":"CZK","datum_vystaveni":null,"duzp":null,"splatnost":"2026-09-15","ucet_dodavatele":"123456789/0100","stav":"Odmítnuto","ke_kontrole":false,"duplicita":false,"archivovano":true,"poznamka_kontroly":null,"upominka_odeslana_kdy":null,"vytah_textu":null,"odkaz_pdf":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","odkaz_onedrive":null,"vytvoreno_kdy":"2026-09-05T10:11:13.5+00:00"}'::jsonb),
  ('{"id":"a0000000-0000-4000-8000-000000000004","prijato_kdy":"2026-01-01T00:00:00+00:00","email_odesilatel":null,"email_predmet":"Faktura 2026/0815","dodavatel":"Dodavatel s.r.o.","dodavatel_ico":"12345678","cislo_faktury":"FV2026/0815","variabilni_symbol":"20260815","castka_haleru":9999999,"mena":"CZK","datum_vystaveni":"2026-09-01","duzp":"2026-09-01","splatnost":"2026-09-15","ucet_dodavatele":"123456789/0100","stav":"Ke kontrole úhrady","ke_kontrole":false,"duplicita":false,"archivovano":false,"poznamka_kontroly":"Automaticky vyřazeno – „Dodavatel\"","upominka_odeslana_kdy":null,"vytah_textu":"FAKTURA – daňový doklad\nDodavatel s.r.o.","odkaz_pdf":"https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf","odkaz_onedrive":null,"vytvoreno_kdy":"2026-01-01T00:00:00.000001+00:00"}'::jsonb)
  ) as v(j), jsonb_populate_record(null::public.faktury, v.j) as r;
-- DATA PRO POROVNÁNÍ (konec)
reset role;

select app.faktury_prevod_porovnat(:'tenant') as porovnani \gset
select pg_temp.check('převod v JS = kopie v SQL: 4 a 4, nic nechybí, nic navíc, nic se neliší',
  (:'porovnani'::jsonb ->> 'zdroj')::int = 4 and (:'porovnani'::jsonb ->> 'hlavni')::int = 4
  and (:'porovnani'::jsonb ->> 'chybi')::int = 0 and (:'porovnani'::jsonb ->> 'navic')::int = 0
  and (:'porovnani'::jsonb ->> 'lisi')::int = 0);
select pg_temp.check('převedené řádky spoušť duplicit neoznačila (stav i příznak ze staré databáze)',
  (select stav from public.faktury where id = 'a0000000-0000-4000-8000-000000000004') = 'Ke kontrole úhrady'
  and not (select duplicita from public.faktury where id = 'a0000000-0000-4000-8000-000000000004'));
select pg_temp.check('převod se do auditu nepíše po řádcích',
  not exists (select 1 from public.audit_log where entity_type = 'faktura' and entity_id = 'a0000000-0000-4000-8000-000000000001'));

-- Rozbití: převod by prohodil splatnost (úloha změní řádek se značkou).
set role service_role;
update public.faktury set splatnost = '2026-12-31', prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000001';
reset role;
select app.faktury_prevod_porovnat(:'tenant') as porovnani \gset
select pg_temp.check('jiná splatnost: porovnání najde 1 rozdíl v poli splatnost',
  (:'porovnani'::jsonb ->> 'lisi')::int = 1
  and (:'porovnani'::jsonb -> 'priklady' -> 0 -> 'pole') = '["splatnost"]'::jsonb);
set role service_role;
update public.faktury set splatnost = '2026-09-15', castka_haleru = castka_haleru - 1, prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000001';
reset role;
select app.faktury_prevod_porovnat(:'tenant') as porovnani \gset
select pg_temp.check('o haléř méně: porovnání najde rozdíl v částce',
  (:'porovnani'::jsonb -> 'priklady' -> 0 -> 'pole') = '["castka_haleru"]'::jsonb);
set role service_role;
update public.faktury set castka_haleru = castka_haleru + 1, prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000001';
-- Během převodu úloha nezmění stav (jen převodem se značkou) …
select pg_temp.check('úloha během převodu: změna stavu bez značky → odmítnuta',
  pg_temp.spadne_hlaskou($s$update public.faktury set stav = 'Uhrazeno' where id = 'a0000000-0000-4000-8000-000000000001'$s$,
    '42501', 'nejsou otevřené'));
-- … ale smí doplnit kopii přílohy.
select pg_temp.check('úloha během převodu: kopie přílohy (jen priloha_cesta) projde',
  pg_temp.projde(format('update public.faktury set priloha_cesta = %L where id = %L',
    :'tenant' || '/' || repeat('a', 64) || '.pdf', 'a0000000-0000-4000-8000-000000000001')));
-- Čas založení: převod ho opravit smí (stará databáze ho mezi běhy
-- změnila — jinak by převod uvízl), bez převodní značky nikdo.
select pg_temp.check('převod smí opravit čas založení (se značkou)',
  pg_temp.projde($s$update public.faktury set vytvoreno_kdy = '2026-09-05T10:11:13.6+00:00', prevedeno_kdy = clock_timestamp() where id = 'a0000000-0000-4000-8000-000000000002'$s$));
update public.faktury set vytvoreno_kdy = '2026-09-05T10:11:13.5+00:00', prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000002';
select pg_temp.check('… bez převodní značky čas založení nezmění nikdo',
  pg_temp.spadne_hlaskou($s$update public.faktury set vytvoreno_kdy = now() where id = 'a0000000-0000-4000-8000-000000000002'$s$,
    '42501', 'Čas založení'));
select pg_temp.check('úloha: příloha jiné firmy do faktury nepatří (kontrola cesty)',
  pg_temp.spadne_hlaskou(format('update public.faktury set priloha_cesta = %L where id = %L',
    :'tenant_b' || '/' || repeat('b', 64) || '.pdf', 'a0000000-0000-4000-8000-000000000003'), '23514', 'faktury_priloha_firmy'));
select pg_temp.check('úloha: cesta přílohy mimo oba vzory → odmítnuta (NULL z kontroly neprojde)',
  pg_temp.spadne_hlaskou(format('update public.faktury set priloha_cesta = %L where id = %L',
    'nesmysl.pdf', 'a0000000-0000-4000-8000-000000000003'), '23514', 'faktury_priloha_firmy'));
reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel během převodu: zápis → zavřeno',
  pg_temp.spadne_hlaskou($s$update public.faktury set stav = 'Uhrazeno' where id = 'a0000000-0000-4000-8000-000000000004'$s$,
    '42501', 'nejsou otevřené')
  or pg_temp.pocet($s$select count(*) from public.faktury where stav = 'Uhrazeno' and id = 'a0000000-0000-4000-8000-000000000004'$s$) = 0);
select pg_temp.check('během převodu se párování nemění (ani starou cestou)',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_alokaci_platby(%L, %L, %L, 1000, 9999999)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'Během stěhování'));
-- Brána párování rozhoduje podle stavu FIRMY, ne podle toho, co smí volající
-- vidět: člověk s Platbami bez práva na Faktury stav převodu nevidí, ale
-- stará cesta se mu kvůli tomu otevřít nesmí (regrese 19. 10.).
select set_config('test.user_id', '99990000-0000-0000-0000-000000000004', false);
select pg_temp.check('… ani za člověka s Platbami bez práva na Faktury (stav převodu nevidí)',
  app.faktury_stav_prevodu(:'tenant') is null
  and pg_temp.spadne_hlaskou(format('select public.potvrdit_alokaci_platby(%L, %L, %L, 1000, 9999999)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'Během stěhování'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 4. Dokončení ==========================================================='

-- Cesta ven bez dokončení: zrušit → vraceno (stará cesta párování se
-- otevře pro předchozí verzi appky), potom jde zahájit znovu.
-- Nepovedená příloha z tohohle pokusu nesmí přežít nové zahájení.
set role service_role;
update public.faktury_prevod set prilohy = '{"chyby": {"a0000000-0000-4000-8000-000000000003": "HTTP 503"}}'
 where tenant_id = :'tenant';
reset role;
select pg_temp.check('návrat zpět jde označit jen po vrácení dokončeného převodu (ne v probiha)',
  pg_temp.spadne_hlaskou(format('select app.faktury_prevod_zpet_hotovo(%L)', :'tenant'), '23514', 'dokončeného'));
select app.faktury_prevod_zrusit(:'tenant') as stav_zruseni \gset
select pg_temp.check('zrušení probíhajícího převodu → vraceno (a v auditu)',
  :'stav_zruseni' = 'vraceno' and app.faktury_stav_prevodu(:'tenant') = 'vraceno'
  and (select count(*) from public.audit_log where tenant_id = :'tenant' and action = 'faktury.prevod_zrusen') = 1);
select pg_temp.check('zrušit jde jen probíhající převod',
  pg_temp.spadne_hlaskou(format('select app.faktury_prevod_zrusit(%L)', :'tenant'), '23514', 'jen probíhající'));
-- Na tomhle stojí úloha: po zrušení NENÍ čas dokončení, takže kopie není
-- základ pro návrat zpět a „zpet" do staré databáze nesmí nic zapsat.
select pg_temp.check('po zrušení není čas dokončení (kopie není základ návratu)',
  (select dokonceno_kdy from public.faktury_prevod where tenant_id = :'tenant') is null);
select pg_temp.check('po zrušení návrat zpět označit nejde (nebylo co vracet)',
  pg_temp.spadne_hlaskou(format('select app.faktury_prevod_zpet_hotovo(%L)', :'tenant'), '23514', 'dokončeného'));
select app.faktury_prevod_zahajit(:'tenant', 'ctqtwahlzhyjerqulqyn.supabase.co', '{"pocet": 4, "castky_haleru": {"CZK": 1}}') as stav_zahajeni \gset
select pg_temp.check('po zrušení jde zahájit znovu → probiha', :'stav_zahajeni' = 'probiha');
select pg_temp.check('nové zahájení zapomene nepovedené přílohy z dřívějšího pokusu',
  (select prilohy from public.faktury_prevod where tenant_id = :'tenant') = '{}'::jsonb);

select app.faktury_prevod_dokoncit(:'tenant', 5, 0) as dokonceni \gset
-- Každé odmítnutí se ověřuje i PODLE DŮVODU: dokud nejsou přílohy
-- zkopírované, dokončení odmítá i kvůli nim — kontrola jen na „ok = false"
-- by prošla i bez brány, kterou má hlídat (zjištěno rozbitím 19. 10.).
select pg_temp.check('jiný počet ve staré databázi (5 ≠ 4): dokončení odmítnuto, nic se nezměnilo',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = false
  and exists (select 1 from jsonb_array_elements_text(:'dokonceni'::jsonb -> 'duvody') d where d like 'Kopie staré databáze má 4 faktur, stará databáze 5%')
  and app.faktury_stav_prevodu(:'tenant') = 'probiha');

-- Převedená faktura se liší od kopie staré databáze → dokončení odmítne
-- (porovnání pole po poli v SQL, ne jen počty).
set role service_role;
update public.faktury set poznamka_kontroly = 'jinak', prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000003';
reset role;
select app.faktury_prevod_dokoncit(:'tenant', 4, 0) as dokonceni \gset
select pg_temp.check('převedená faktura se liší od kopie: dokončení odmítnuto (pole po poli)',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = false
  and (:'dokonceni'::jsonb -> 'porovnani' ->> 'lisi')::int = 1
  and exists (select 1 from jsonb_array_elements_text(:'dokonceni'::jsonb -> 'duvody') d where d like 'Převedené faktury nesedí s kopií:%liší se 1,%')
  and app.faktury_stav_prevodu(:'tenant') = 'probiha');
set role service_role;
update public.faktury set poznamka_kontroly = null, prevedeno_kdy = clock_timestamp()
 where id = 'a0000000-0000-4000-8000-000000000003';
reset role;

select app.faktury_prevod_dokoncit(:'tenant', 4, 0) as dokonceni \gset
select pg_temp.check('nezkopírované přílohy (2 ze 3): dokončení odmítnuto',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = false
  and (:'dokonceni'::jsonb -> 'mereni' -> 'prilohy' ->> 'stare_bez_kopie')::int = 2
  and exists (select 1 from jsonb_array_elements_text(:'dokonceni'::jsonb -> 'duvody') d where d like 'Zbývá zkopírovat 2 příloh%')
  and app.faktury_stav_prevodu(:'tenant') = 'probiha');

-- Chyba u jiné faktury (příloha z evidence příjmu, smazaná faktura) se
-- nesmí započítat za nezkopírovanou veřejnou přílohu: dvě chyby proti
-- dvěma nezkopírovaným by počty „vyrovnaly", jedna příloha ale zůstala.
set role service_role;
update public.faktury_prevod
   set prilohy = jsonb_build_object('chyby', jsonb_build_object(
     'a0000000-0000-4000-8000-000000000003', 'HEIC', 'b9999999-0000-4000-8000-000000000999', 'evidence bez souboru'))
 where tenant_id = :'tenant';
reset role;
select app.faktury_prevod_dokoncit(:'tenant', 4, 0) as dokonceni \gset
select pg_temp.check('chyba u jiné faktury nevyrovná nezkopírovanou přílohu: dokončení odmítnuto',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = false
  and (:'dokonceni'::jsonb -> 'mereni' -> 'prilohy' ->> 'stare_bez_kopie_nevykazane')::int = 1
  and exists (select 1 from jsonb_array_elements_text(:'dokonceni'::jsonb -> 'duvody') d where d like 'Zbývá zkopírovat 1 příloh%')
  and app.faktury_stav_prevodu(:'tenant') = 'probiha');

-- Přechodná chyba (stará databáze neodpověděla) NENÍ vykázaná: dokončení ji
-- nepustí, i když trvalá chyba u druhé přílohy vykázaná je (nález 7).
set role service_role;
update public.faktury_prevod
   set prilohy = jsonb_build_object(
     'chyby', jsonb_build_object('a0000000-0000-4000-8000-000000000003', 'HEIC'),
     'docasne', jsonb_build_object('a0000000-0000-4000-8000-000000000004',
                                   jsonb_build_object('duvod', 'HTTP 503', 'kdy', now())))
 where tenant_id = :'tenant';
reset role;
select app.faktury_prevod_dokoncit(:'tenant', 4, 0) as dokonceni \gset
select pg_temp.check('přechodně nepovedená příloha (HTTP 503) dokončení nepustí',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = false
  and (:'dokonceni'::jsonb -> 'mereni' -> 'prilohy' ->> 'stare_bez_kopie_nevykazane')::int = 1
  and app.faktury_stav_prevodu(:'tenant') = 'probiha');

-- Dvě přílohy se „nepodařilo zkopírovat" — úloha je zapíše jako chyby.
set role service_role;
update public.faktury_prevod
   set prilohy = jsonb_build_object('chyby', jsonb_build_object(
     'a0000000-0000-4000-8000-000000000003', 'HEIC', 'a0000000-0000-4000-8000-000000000004', 'nad 10 MB'))
 where tenant_id = :'tenant';
select pg_temp.check('úloha stav převodu sama nepřepne',
  pg_temp.spadne_hlaskou(format($s$update public.faktury_prevod set stav = 'dokonceno' where tenant_id = %L$s$, :'tenant'),
    '42501', ''));
reset role;

select app.faktury_prevod_dokoncit(:'tenant', 4, 0) as dokonceni \gset
select pg_temp.check('vše sedí: dokončeno',
  (:'dokonceni'::jsonb ->> 'ok')::boolean = true and app.faktury_stav_prevodu(:'tenant') = 'dokonceno');
-- Audit převodu čte i správce bez práva na Faktury a Platby: počty ano,
-- součty peněz ne (ty má jen faktury_prevod, čte ho jen úloha).
select pg_temp.check('audit převodu: měření bez součtů peněz (zahájení i dokončení)',
  exists (select 1 from public.audit_log where tenant_id = :'tenant' and action = 'faktury.prevod_dokoncen'
            and (after -> 'mereni' -> 'stara' ->> 'pocet')::int = 4)
  and (select mereni_zahajeni -> 'castky_haleru' ->> 'CZK' from public.faktury_prevod where tenant_id = :'tenant') = '1'
  and not exists (select 1 from public.audit_log where tenant_id = :'tenant'
                    and action in ('faktury.prevod_zahajen', 'faktury.prevod_dokoncen')
                    and after::text ~ '(castky_haleru|potvrzeno_haleru)'));
select pg_temp.check('staré párování dostalo uuid faktury (text velkými písmeny s mezerou)',
  (select faktura from public.platby_faktury where id = :'stare_parovani') = 'a0000000-0000-4000-8000-000000000001');
select pg_temp.check('evidence příjmu dostala uuid faktury',
  (select faktura from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 1) = 'a0000000-0000-4000-8000-000000000002');
select pg_temp.check('párování na zmizelou fakturu dokončení nezastavilo, ale je vykázané',
  (:'dokonceni'::jsonb -> 'mereni' -> 'parovani' ->> 'bez_faktury_platnych')::int = 1
  and (select faktura from public.platby_faktury where id = :'visici_parovani') is null);
select pg_temp.check('měření: stará = hlavní (počet, archivované, součty po měnách)',
  (:'dokonceni'::jsonb -> 'mereni' -> 'stara' ->> 'pocet') = (:'dokonceni'::jsonb -> 'mereni' -> 'hlavni' ->> 'pocet')
  and (:'dokonceni'::jsonb -> 'mereni' -> 'stara' ->> 'archivovanych') = (:'dokonceni'::jsonb -> 'mereni' -> 'hlavni' ->> 'archivovanych')
  and ((:'dokonceni'::jsonb -> 'mereni' -> 'stara' -> 'castky_haleru' ->> 'CZK')::numeric
       = (:'dokonceni'::jsonb -> 'mereni' -> 'hlavni' -> 'castky_haleru' ->> 'CZK')::numeric)
  and ((:'dokonceni'::jsonb -> 'mereni' -> 'stara' -> 'castky_haleru' ->> 'EUR')::numeric = -35000));
select pg_temp.check('dokončení je v auditu jednou',
  (select count(*) from public.audit_log where tenant_id = :'tenant' and action = 'faktury.prevod_dokoncen') = 1);

select pg_temp.check('po dokončení návrat zpět označit nejde (není vrácený)',
  pg_temp.spadne_hlaskou(format('select app.faktury_prevod_zpet_hotovo(%L)', :'tenant'), '23514', 'dokončeného'));
select pg_temp.check('podruhé dokončit nejde',
  pg_temp.spadne_hlaskou(format('select app.faktury_prevod_dokoncit(%L, 4, 0)', :'tenant'), '23514', 'neprobíhá'));
select pg_temp.check('po dokončení nejde zahájit znovu (převod by přepsal změny v appce)',
  pg_temp.spadne_hlaskou(format($s$select app.faktury_prevod_zahajit(%L, 'x', null)$s$, :'tenant'), '23514', 'nejdřív ho vraťte'));
set role service_role;
select pg_temp.check('po dokončení úloha nezmění kopii staré databáze',
  pg_temp.spadne_hlaskou(format('delete from public.faktury_prevod_zdroj where tenant_id = %L', :'tenant'), '42501', 'jen během převodu'));
select pg_temp.check('po dokončení úloha nevloží převodní řádek',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel, prevedeno_kdy) values (%L, %L, now())', :'tenant', 'X'),
    '42501', 'neprobíhá'));
select pg_temp.check('po dokončení úloha fakturu nesmaže',
  pg_temp.spadne_hlaskou($s$delete from public.faktury where id = 'a0000000-0000-4000-8000-000000000003'$s$, '42501', 'neprobíhá'));
reset role;


\echo ''
\echo '== 5. Čtení jen za celou firmu ==========================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel vidí 4 faktury', (select count(*) from public.faktury where tenant_id = :'tenant') = 4);
select pg_temp.check('majitel zná stav převodu své firmy (funkce stavu)', app.faktury_stav_prevodu(:'tenant') = 'dokonceno');
select set_config('test.user_id', '99990000-0000-0000-0000-000000000002', false);
select pg_temp.check('čtenář (faktury.read, celá firma) vidí 4', (select count(*) from public.faktury where tenant_id = :'tenant') = 4);
select pg_temp.check('čtenář vidí stav převodu (sloupce firma a stav — víc appka nečte)',
  (select count(stav) from public.faktury_prevod where tenant_id = :'tenant') = 1
  and pg_temp.projde(format('select tenant_id, stav from public.faktury_prevod where tenant_id = %L', :'tenant')));
select set_config('test.user_id', '99990000-0000-0000-0000-000000000003', false);
select pg_temp.check('člen jen pobočky (i s faktury.read/manage) nevidí žádnou fakturu',
  (select count(*) from public.faktury where tenant_id = :'tenant') = 0);
select pg_temp.check('člen jen pobočky nevidí evidenci příjmu', (select count(*) from public.faktury_prijem where tenant_id = :'tenant') = 0);
select pg_temp.check('člen jen pobočky: firmy_s_pristupem je prázdné',
  not exists (select 1 from app.firmy_s_pristupem('faktury.read')));
select set_config('test.user_id', '99990000-0000-0000-0000-000000000004', false);
select pg_temp.check('finance bez faktury.read nevidí faktury', (select count(*) from public.faktury where tenant_id = :'tenant') = 0);
select set_config('test.user_id', '99990000-0000-0000-0000-000000000001', false);
select pg_temp.check('majitel cizí firmy nevidí faktury Foodtabu', (select count(*) from public.faktury where tenant_id = :'tenant') = 0);
-- Funkce stavu je security definer (RLS ji nechrání): pro cizí firmu
-- vrací NULL. Řádek tabulky schová politika — tu ověří až PostgreSQL 16.
select pg_temp.check('… ani stav převodu Foodtabu (funkce vrátí NULL, řádek nevidí)',
  app.faktury_stav_prevodu(:'tenant') is null
  and (select count(stav) from public.faktury_prevod where tenant_id = :'tenant') = 0);
select pg_temp.check('… ani kopii staré databáze (žádný grant)',
  pg_temp.spadne_hlaskou('select count(*) from public.faktury_prevod_zdroj', '42501', ''));
reset role;
select set_config('test.user_id', '', false);
set role anon;
select pg_temp.check('nepřihlášený: faktury vůbec ne', pg_temp.spadne_hlaskou('select count(*) from public.faktury', '42501', ''));
reset role;


\echo ''
\echo '== 6. Zápis po dokončení =================================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
insert into public.faktury (id, tenant_id, dodavatel, cislo_faktury, castka_haleru)
values ('a0000000-0000-4000-8000-0000000000ff', :'tenant', 'Dodavatel s.r.o.', 'FV2026/0815', 1000)
returning id as nova, stav as nova_stav, duplicita as nova_duplicita \gset
select pg_temp.check('přihlášený si id nevybírá (dostal náhodné)', :'nova' <> 'a0000000-0000-4000-8000-0000000000ff');
select pg_temp.check('stejný dodavatel + číslo: označená duplicita se stavem „Duplicitní - zkontrolovat (…)"',
  :'nova_duplicita'::boolean and :'nova_stav' = 'Duplicitní - zkontrolovat (Ke kontrole úhrady)');
select pg_temp.check('nová faktura je v auditu',
  exists (select 1 from public.audit_log where entity_type = 'faktura' and entity_id = :'nova' and action = 'faktura.insert'));
-- Úpravu značky a firmy přihlášenému zavře už grant (jen 4 sloupce);
-- spoušť je druhá linie — vložení se značkou a přesun za úlohu.
select pg_temp.check('převodní značku přihlášený nezapíše (ani při vložení)',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel, prevedeno_kdy) values (%L, %L, now())', :'tenant', 'X'),
    '42501', 'Převodní značku'));
reset role;
set role service_role;
select pg_temp.check('fakturu nejde přesunout do jiné firmy (spoušť, i za úlohu)',
  pg_temp.spadne_hlaskou(format('update public.faktury set tenant_id = %L where id = %L', :'tenant_b', :'nova'), '42501', 'jiné firmy'));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select zmeneno_kdy as pred from public.faktury where id = :'nova' \gset
update public.faktury set stav = stav where id = :'nova';
select pg_temp.check('uložení beze změny: čas změny stejný a žádný audit úpravy',
  (select zmeneno_kdy from public.faktury where id = :'nova') = :'pred'::timestamptz
  and not exists (select 1 from public.audit_log where entity_id = :'nova' and action = 'faktura.update'));
select pg_temp.check('fakturu s párováním nejde smazat (cizí klíč)',
  pg_temp.spadne_hlaskou($s$delete from public.faktury where id = 'a0000000-0000-4000-8000-000000000001'$s$, '23503', ''));
select pg_temp.check('vzor odmítnutí: přihlášený s faktury.manage zapíše (bez puvodni_id)',
  pg_temp.projde(format($s$insert into public.faktury_vzory_odmitnuti (tenant_id, druh, vytah) values (%L, 'not_invoice', 'Reklama')$s$, :'tenant')));
select pg_temp.check('vzor odmítnutí s puvodni_id přihlášený nezapíše',
  pg_temp.spadne_hlaskou(format($s$insert into public.faktury_vzory_odmitnuti (tenant_id, druh, vytah, puvodni_id) values (%L, 'not_invoice', 'X', 5)$s$, :'tenant'), '42501', ''));

-- Audit bez obsahu dokladu: audit_log čte i správce bez práva na Faktury.
-- Text dokladu, e-mail a účet dodavatele se nesmí objevit ani u vložení,
-- ani u změny, ani u smazání (a ani u vzoru odmítnutí).
insert into public.faktury (tenant_id, dodavatel, castka_haleru, vytah_textu, email_predmet, email_odesilatel, ucet_dodavatele, odkaz_pdf, odkaz_onedrive)
values (:'tenant', 'Auditní dodavatel', 100, 'TAJNE-99 text', 'TAJNE-99 předmět', 'tajne99@x.cz', 'TAJNE-99/0100',
        'https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/TAJNE-99.pdf', 'https://onedrive.live.com/TAJNE-99')
returning id as tajna \gset
insert into public.faktury_vzory_odmitnuti (tenant_id, druh, vytah, email_predmet) values (:'tenant', 'not_invoice', 'TAJNE-99 vzor', 'TAJNE-99');
reset role;
set role service_role;
update public.faktury set vytah_textu = 'TAJNE-99-B' where id = :'tajna';
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
delete from public.faktury where id = :'tajna';
reset role;
select pg_temp.check('audit faktury: vložení, změna i smazání jsou zapsané (změna textu jen jménem)',
  exists (select 1 from public.audit_log where entity_id = :'tajna' and action = 'faktura.insert')
  and exists (select 1 from public.audit_log where entity_id = :'tajna' and action = 'faktura.update'
                and after -> 'skryte_zmeny' = '["vytah_textu"]'::jsonb)
  and exists (select 1 from public.audit_log where entity_id = :'tajna' and action = 'faktura.delete')
  and exists (select 1 from public.audit_log where tenant_id = :'tenant' and action = 'faktura_vzor_odmitnuti.insert'));
select pg_temp.check('… a v auditu není text dokladu, předmět, e-mail, účet dodavatele ani odkaz na PDF',
  not exists (select 1 from public.audit_log where tenant_id = :'tenant'
                and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '(TAJNE-99|tajne99)'));
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select set_config('test.user_id', '99990000-0000-0000-0000-000000000002', false);
select pg_temp.check('čtenář (bez manage) nezapíše novou fakturu',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant', 'X'), '42501', ''));
select pg_temp.check('čtenář nezmění stav (0 řádků)',
  pg_temp.pocet(format($s$with u as (update public.faktury set stav = 'X' where id = %L returning 1) select count(*) from u$s$, :'nova')) = 0);

select set_config('test.user_id', '99990000-0000-0000-0000-000000000001', false);
-- Hláška nesmí prozradit stav převodu cizí firmy (Foodtab je „dokonceno"):
-- pro cizí firmu je stav NULL, tedy „nezahájen", jako u firmy bez převodu.
select pg_temp.check('cizí majitel nezapíše fakturu do Foodtabu — a hláška stav Foodtabu neprozradí',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant', 'X'), '42501', 'stav převodu: nezahájen'));
select pg_temp.check('cizí firma bez převodu má Faktury zavřené i sama pro sebe',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant_b', 'X'), '42501', 'nejsou otevřené'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 7. Párování v jedné transakci ========================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select plne_uhrazeno as p1_plne, coalesce(stav_faktury, '') as p1_stav
  from public.sparovat_platbu_s_fakturou(:'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004', 100000, null) \gset
select pg_temp.check('část platby na fakturu za 99 999,99 Kč → „Částečně uhrazeno" ve stejné transakci',
  :'p1_stav' = 'Částečně uhrazeno' and not :'p1_plne'::boolean
  and (select stav from public.faktury where id = 'a0000000-0000-4000-8000-000000000004') = 'Částečně uhrazeno');
select pg_temp.check('příchozí platbu s přijatou fakturou spárovat nejde (patří Jiným platbám)',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t5', 'a0000000-0000-4000-8000-000000000004'), '23514', 'jen odchozí platbu'));
select pg_temp.check('… a k příchozí platbě nevzniklo žádné párování',
  not exists (select 1 from public.platby_faktury where transakce_id = :'t5'));
select pg_temp.check('nové párování má uuid i text (pro starý kód po návratu)',
  (select faktura_id from public.platby_faktury where transakce_id = :'t1' and stav = 'potvrzeno') = 'a0000000-0000-4000-8000-000000000004'
  and (select potvrdil from public.platby_faktury where transakce_id = :'t1' and stav = 'potvrzeno') = :'majitel');
select pg_temp.check('víc, než platba nese → odmítnuto',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 1, null)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000001'), '23514', 'přesahuje částku platby'));
-- t2 je volná: faktura v EUR → spárovat jde, stav se nemění.
select plne_uhrazeno as p2_plne, coalesce(stav_faktury, '') as p2_stav
  from public.sparovat_platbu_s_fakturou(:'tenant', :'t2', 'a0000000-0000-4000-8000-000000000002', 100, null) \gset
select pg_temp.check('faktura v EUR: párování zapsané, stav faktury beze změny (NULL)',
  :'p2_stav' = '' and not :'p2_plne'::boolean
  and (select stav from public.faktury where id = 'a0000000-0000-4000-8000-000000000002') = 'Nutná ruční kontrola (chybí IČO)');
select id as p2_alokace from public.platby_faktury where transakce_id = :'t2' and stav = 'potvrzeno' \gset
select coalesce(public.zrusit_parovani_faktury(:'tenant', :'p2_alokace', 'zkouška'), '') as p2_zruseno \gset
select id as p1_alokace from public.platby_faktury where transakce_id = :'t1' and stav = 'potvrzeno' \gset
select coalesce(public.zrusit_parovani_faktury(:'tenant', :'p1_alokace', 'zkouška'), '') as p1_zruseno \gset
select pg_temp.check('zrušení posledního párování → „Neuhrazeno" ve stejné transakci',
  :'p1_zruseno' = 'Neuhrazeno'
  and (select stav from public.faktury where id = 'a0000000-0000-4000-8000-000000000004') = 'Neuhrazeno'
  and (select stav from public.platby_faktury where id = :'p1_alokace') = 'zamitnuto');
-- Podruhé totéž (stará stránka, dvojí kliknutí) nesmí znovu přepočítat
-- stav faktury — přepsal by, co mezitím nastavil člověk.
reset role;
select set_config('test.user_id', '', false);
set role service_role;
update public.faktury set stav = 'Ručně nastavený stav' where id = 'a0000000-0000-4000-8000-000000000004';
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('podruhé zrušit totéž párování nejde',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_parovani_faktury(%L, %L, 'znovu')$s$, :'tenant', :'p1_alokace'),
    '23514', 'není co rušit'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… a stav faktury zůstal, jak ho nastavil člověk',
  (select stav from public.faktury where id = 'a0000000-0000-4000-8000-000000000004') = 'Ručně nastavený stav');
set role service_role;
update public.faktury set stav = 'Neuhrazeno' where id = 'a0000000-0000-4000-8000-000000000004';
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('stará cesta párování je po dokončení zavřená',
  pg_temp.spadne_hlaskou(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 1000, 9999999)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'jen novou cestou'));
select pg_temp.check('staré rušení párování je po dokončení zavřené',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_alokaci_platby(%L, %L, 'x')$s$, :'tenant', :'stare_parovani'), '42501', 'jen novou cestou'));
select pg_temp.check('neexistující faktura: odmítnuto (cizí firma s existující fakturou v oddílu 8)',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t2', gen_random_uuid()), '23514', 'Faktura nepatří této firmě'));

select set_config('test.user_id', '99990000-0000-0000-0000-000000000004', false);
select pg_temp.check('finance bez faktury.read: párovat nesmí',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'Vidět přijaté faktury'));
select pg_temp.check('finance bez faktury.read: rušit párování (a tím stav faktury) nesmí',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_parovani_faktury(%L, %L, 'x')$s$, :'tenant', :'stare_parovani'), '42501', 'Vidět přijaté faktury'));
-- … a ani STAROU cestou (jí stačí finance.manage): stav převodu tenhle člověk
-- nevidí, brána ale čte stav firmy (regrese 19. 10.).
select pg_temp.check('finance bez faktury.read: stará cesta párování po dokončení zavřená',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_alokaci_platby(%L, %L, %L, 1000, 9999999)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'jen novou cestou'));
select pg_temp.check('finance bez faktury.read: staré rušení párování po dokončení zavřené',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_alokaci_platby(%L, %L, 'x')$s$, :'tenant', :'stare_parovani'), '42501', 'jen novou cestou'));
select set_config('test.user_id', '99990000-0000-0000-0000-000000000003', false);
select pg_temp.check('člen jen pobočky (firemní účet): párovat nesmí',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'Nemáte oprávnění párovat'));
select set_config('test.user_id', '99990000-0000-0000-0000-000000000002', false);
select pg_temp.check('čtenář bez finance.manage: párovat nesmí',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'Nemáte oprávnění párovat'));
reset role;
select set_config('test.user_id', '', false);

-- Automatické párování (úloha): faktura 777,00 Kč a platba 777,00 Kč z banky.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
insert into public.faktury (tenant_id, dodavatel, cislo_faktury, variabilni_symbol, castka_haleru)
values (:'tenant', 'Automat s.r.o.', 'A-777', '777', 77700) returning id as fa \gset
insert into public.faktury (tenant_id, dodavatel, cislo_faktury, variabilni_symbol, castka_haleru, mena)
values (:'tenant', 'Automat s.r.o.', 'A-778', '777', 77700, 'EUR') returning id as fa_eur \gset
reset role;
select set_config('test.user_id', '', false);
set role service_role;
select pg_temp.check('automatika: faktura v EUR se nespáruje', not public.automaticky_sparovat_fakturu(:'tenant', :'t2', :'fa_eur', 77700));
select pg_temp.check('automatika: jiná částka než faktura → ne', not public.automaticky_sparovat_fakturu(:'tenant', :'t2', :'fa', 77600));
select pg_temp.check('automatika: přesná shoda → spárováno', public.automaticky_sparovat_fakturu(:'tenant', :'t2', :'fa', 77700));
select pg_temp.check('automatika: podruhé ne (už spárované)', not public.automaticky_sparovat_fakturu(:'tenant', :'t2', :'fa', 77700));
-- Id párování čte správce (service_role má na platby_faktury grant jen
-- z výchozích práv Supabase, která čistá testovací databáze nemá).
reset role;
select id as auto_alokace from public.platby_faktury where faktura = :'fa' and zpusob = 'automaticky' \gset
set role service_role;
select pg_temp.check('zrušení automatického párování: ano, podruhé ne',
  public.zrusit_automaticke_parovani_faktury(:'tenant', :'auto_alokace', 'zkouška')
  and not public.zrusit_automaticke_parovani_faktury(:'tenant', :'auto_alokace', 'zkouška'));
select pg_temp.check('automatika: člověkem zrušené párování znovu nezaloží', not public.automaticky_sparovat_fakturu(:'tenant', :'t2', :'fa', 77700));
reset role;

-- Jiné platby (#146, 20261016100000) a párování faktur sdílí bankovní
-- platby. Součet obou hlídá spoušť z #146 (trg_platby_faktury_jine_platby)
-- u KAŽDÉHO zápisu potvrzeného párování — i nové cesty Faktur — a obě strany
-- berou stejný zámek platby (hashtextextended(transakce, 0)). Faktury berou
-- jen odchozí platby, Jiné platby jen příchozí; data se tu proto připraví
-- přímo (jako by je zapsal starý kód nebo budoucí změna pravidla).
select pg_temp.check('spoušť součtu z Jiných plateb po všech migracích pořád hlídá párování',
  exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
           where g.tgrelid = 'public.platby_faktury'::regclass and g.tgname = 'trg_platby_faktury_jine_platby'
             and not g.tgisinternal and g.tgenabled <> 'D' and p.proname = 'jp_hlida_platbu_faktury'));
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 10000, current_date - 1, 'Sdílená platba', '6', 'csv_banka') returning id as t6 \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, protistrana, vs, zdroj)
values (:'tenant', :'ucet', 'prijem', 30000, current_date - 1, 'Sdílený příjem', '7', 'csv_banka') returning id as t7 \gset
insert into public.jine_platby (tenant_id, branch_id, klient_id, mena, uhrada_transakce_id, uhrada_castka_haleru, stav_uhrady)
values (:'tenant', :'perla', gen_random_uuid(), 'CZK', :'t6', 10000, 'uhrazeno') returning id as jp_cela \gset
insert into public.jine_platby (tenant_id, branch_id, klient_id, mena)
values (:'tenant', :'perla', gen_random_uuid(), 'CZK') returning id as jp_volna \gset
set role service_role;
insert into public.faktury (tenant_id, dodavatel, castka_haleru) values (:'tenant', 'Sdílený dodavatel', 10000) returning id as f_sdilena \gset
select pg_temp.check('Jiná platba celá na platbě: automatika ji k faktuře nenapáruje (řekne ne, nespadne)',
  not public.automaticky_sparovat_fakturu(:'tenant', :'t6', :'f_sdilena', 10000));
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('… ani ruční nová cesta (součet hlídá spoušť z Jiných plateb)',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)', :'tenant', :'t6', :'f_sdilena'),
    '23514', 'Jiným platbám'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… a k platbě nevzniklo žádné párování', not exists (select 1 from public.platby_faktury where transakce_id = :'t6'));
-- Opačně: platba už zčásti zaplatila fakturu (potvrzené párování s uuid, jak
-- ho píše nová cesta) — úhrada Jiné platby z ní dostane jen zbytek.
insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, stav, potvrzeno_kdy)
values (:'tenant', :'t7', :'f_sdilena', 25000, 'potvrzeno', now());
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('opačně: Jiná platba nedostane víc, než po párování s fakturou zbývá',
  pg_temp.spadne_hlaskou(format('select public.jine_platby_evidovat_uhradu(%L, %L, 6000)', :'jp_volna', :'t7'), '23514', 'rozdělená'));
select pg_temp.check('… zbytek (5 000 z 30 000) projde',
  pg_temp.projde(format('select public.jine_platby_evidovat_uhradu(%L, %L, 5000)', :'jp_volna', :'t7')));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 8. Odkaz text ↔ uuid a složený cizí klíč ============================='

-- Evidence (příjem z e-mailu píše text): existující faktura → uuid, cizí id → nic.
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 2, :'fa')) as ok_pomocny \gset
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 3, 'c0000000-0000-4000-8000-00000000000c')) as ok_pomocny \gset
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 4, 'FAKTURA-TEXT-123')) as ok_pomocny \gset
select pg_temp.check('evidence: text existující faktury → uuid doplněné',
  (select faktura from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 2) = :'fa'::uuid);
select pg_temp.check('evidence: neznámé id / ne-uuid text → uuid prázdné, text zůstává',
  exists (select 1 from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 3 and faktura is null)
  and (select faktura_id from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 4) = 'FAKTURA-TEXT-123');
-- Id s koncem řádku: vzor uuid ho nesmí pustit k převodu na uuid (btrim
-- ořízne jen mezery) — jinak by zápis evidence spadl.
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 6, E'a0000000-0000-4000-8000-000000000001\n')) as ok_pomocny \gset
select pg_temp.check('evidence: id s koncem řádku → zápis projde, uuid prázdné',
  :'ok_pomocny'::boolean
  and exists (select 1 from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 6 and faktura is null));
-- Obojí změněné, každé na jinou fakturu = rozpor. (Změna jen textu
-- se stejným uuid se bere jako změna textu — uuid se dohledá znovu.)
select pg_temp.check('evidence: uuid a text změněné na různé faktury → odmítnuto',
  pg_temp.spadne_hlaskou(format('update public.faktury_prijem set faktura = %L, faktura_id = %L where pripojeni_id = %L and uid = 2',
    'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', :'schranka'), '23514', 'různé faktury'));
-- Zvlášť příkaz a zvlášť kontrola: dotaz uvnitř téhož příkazu by změnu
-- z funkce neviděl (čte data z okamžiku, kdy příkaz začal).
update public.faktury_prijem set faktura = :'fa', faktura_id = 'a0000000-0000-4000-8000-000000000001'
 where pripojeni_id = :'schranka' and uid = 2;
select pg_temp.check('evidence: změna jen textu (uuid stejné) → uuid se dohledá z nového textu',
  (select faktura from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 2) = 'a0000000-0000-4000-8000-000000000001');

-- Smazaná faktura: z evidence zmizí jen uuid, text zůstává (příjem ho
-- nezapíše znovu). Faktura bez párování → smazat jde.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('fakturu bez párování smazat jde', pg_temp.projde(format('delete from public.faktury where id = %L', :'fa_eur')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.projde(pg_temp.prijem_sql(:'tenant', :'schranka', 5, :'nova')) as ok_pomocny \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.projde(format('delete from public.faktury where id = %L', :'nova')) as ok_pomocny \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('po smazání faktury: v evidenci uuid prázdné, text zůstal, firma zůstala',
  (select faktura from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 5) is null
  and (select faktura_id from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 5) = :'nova'
  and (select tenant_id from public.faktury_prijem where pripojeni_id = :'schranka' and uid = 5) = :'tenant');

-- Složený klíč: párování firmy nesmí ukazovat na fakturu cizí firmy.
select app.faktury_prevod_zahajit(:'tenant_b', 'zkouska', null) as ok_pomocny \gset
set role service_role;
insert into public.faktury (tenant_id, dodavatel, castka_haleru, prevedeno_kdy)
values (:'tenant_b', 'Cizí dodavatel', 100, now()) returning id as cizi_faktura \gset
reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('faktura cizí firmy (existuje, jen jinde): párování odmítnuto',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t2', :'cizi_faktura'), '23514', 'Faktura nepatří této firmě'));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('párování na fakturu cizí firmy → cizí klíč odmítne',
  pg_temp.spadne_hlaskou(format($s$insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, stav) values (%L, %L, %L, 1, 'navrzeno')$s$,
    :'tenant', :'t2', :'cizi_faktura'), '23503', ''));
select pg_temp.check('… stará cesta textem je po dokončení zavřená (cizí id se nedohledá — oddíl 10)',
  pg_temp.spadne_hlaskou(format($s$insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav) values (%L, %L, %L, 1, 'navrzeno')$s$,
    :'tenant', :'t2', :'cizi_faktura'), '42501', 'jen novou cestou'));

-- Potvrzené párování drží stav faktury: přepojit ho nebo změnit částku
-- smí jen nová cesta (značka cesty, kterou mají nové funkce).
select pg_temp.check('po dokončení: potvrzené párování mimo novou cestu nejde přepojit',
  pg_temp.spadne_hlaskou(format('update public.platby_faktury set faktura = %L where id = %L', :'fa', :'stare_parovani'),
    '42501', 'nejde přepojit'));
select pg_temp.check('… ani změnit jeho částku',
  pg_temp.spadne_hlaskou(format('update public.platby_faktury set castka_haleru = 1 where id = %L', :'stare_parovani'),
    '42501', 'nejde přepojit'));
-- Nová cesta přepojí párování na jinou fakturu jen uuid → text se srovná.
select set_config('foodtab.faktury_cesta', 'nova', false);
update public.platby_faktury set faktura = :'fa' where id = :'stare_parovani';
select set_config('foodtab.faktury_cesta', '', false);
select pg_temp.check('změna jen uuid → text faktura_id se srovná',
  (select faktura_id from public.platby_faktury where id = :'stare_parovani') = :'fa');

-- Cizí firma s OTEVŘENÝMI Fakturami (jinak by funkce spadla už na „nejsou
-- otevřené" a filtr firmy by se nevyzkoušel). Majitel cizí firmy má za
-- svou firmu všechna práva — zastavit ho smí jen filtr párování na firmu.
update public.faktury_prevod set stav = 'dokonceno' where tenant_id = :'tenant_b';
set role authenticated;
select set_config('test.user_id', '99990000-0000-0000-0000-000000000001', false);
select pg_temp.check('majitel cizí firmy nezruší párování Foodtabu (pod svou firmou)',
  pg_temp.spadne_hlaskou(format($s$select public.zrusit_parovani_faktury(%L, %L, 'x')$s$, :'tenant_b', :'stare_parovani'),
    '23514', 'nepatří této firmě'));
-- Faktura cizí firmy se stejným dodavatelem a číslem jako u Foodtabu: duplicita
-- se hledá jen ve vlastní firmě (jinak by označení prozradilo cizí fakturu).
insert into public.faktury (tenant_id, dodavatel, cislo_faktury, castka_haleru)
values (:'tenant_b', 'Dodavatel s.r.o.', 'FV2026/0815', 100) returning duplicita as cizi_dup, stav as cizi_stav \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… párování Foodtabu zůstalo potvrzené',
  (select stav from public.platby_faktury where id = :'stare_parovani') = 'potvrzeno');
select pg_temp.check('duplicita se nehledá u cizí firmy (stejný dodavatel a číslo jako Foodtab)',
  not :'cizi_dup'::boolean and :'cizi_stav' not like 'Duplicitní%');
update public.faktury_prevod set stav = 'probiha' where tenant_id = :'tenant_b';


\echo ''
\echo '== 9. Úložiště: ruční nahrání jen do vlastní složky rucne/ =============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel: ruční nahrání <firma>/rucne/<uuid>.jpg projde',
  pg_temp.projde(format($s$insert into storage.objects (bucket_id, name) values ('faktury-prilohy', %L)$s$,
    :'tenant' || '/rucne/' || gen_random_uuid() || '.jpg')));
select pg_temp.check('majitel: do jmenného prostoru otisků (<firma>/<sha256>.pdf) ne',
  pg_temp.spadne_hlaskou(format($s$insert into storage.objects (bucket_id, name) values ('faktury-prilohy', %L)$s$,
    :'tenant' || '/' || repeat('c', 64) || '.pdf'), '42501', ''));
select pg_temp.check('majitel: do složky cizí firmy ne',
  pg_temp.spadne_hlaskou(format($s$insert into storage.objects (bucket_id, name) values ('faktury-prilohy', %L)$s$,
    :'tenant_b' || '/rucne/' || gen_random_uuid() || '.jpg'), '42501', ''));
select pg_temp.check('majitel: jiná přípona (heic) ne',
  pg_temp.spadne_hlaskou(format($s$insert into storage.objects (bucket_id, name) values ('faktury-prilohy', %L)$s$,
    :'tenant' || '/rucne/' || gen_random_uuid() || '.heic'), '42501', ''));
select set_config('test.user_id', '99990000-0000-0000-0000-000000000002', false);
select pg_temp.check('čtenář (bez manage) nenahraje nic',
  pg_temp.spadne_hlaskou(format($s$insert into storage.objects (bucket_id, name) values ('faktury-prilohy', %L)$s$,
    :'tenant' || '/rucne/' || gen_random_uuid() || '.jpg'), '42501', ''));
select pg_temp.check('čtenář vidí ruční přílohu své firmy',
  (select count(*) from storage.objects where bucket_id = 'faktury-prilohy' and name like :'tenant' || '/rucne/%') = 1);
select set_config('test.user_id', '99990000-0000-0000-0000-000000000003', false);
select pg_temp.check('člen jen pobočky nevidí přílohy firmy',
  (select count(*) from storage.objects where bucket_id = 'faktury-prilohy' and name like :'tenant' || '/%') = 0);
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 10. Vrácení a nové zahájení =========================================='

select app.faktury_prevod_vratit(:'tenant') as stav_vraceni \gset
select pg_temp.check('vrácení → vraceno (čas dokončení zůstal — kopie je základ návratu)',
  :'stav_vraceni' = 'vraceno'
  and (select dokonceno_kdy from public.faktury_prevod where tenant_id = :'tenant') is not null);
select pg_temp.check('po vrácení dokončeného převodu jde návrat zpět označit jako hotový',
  pg_temp.projde(format('select app.faktury_prevod_zpet_hotovo(%L)', :'tenant')));
select pg_temp.check('… značka je zapsaná a podruhé se nemění',
  (select zpet_hotovo_kdy from public.faktury_prevod where tenant_id = :'tenant') is not null
  and app.faktury_prevod_zpet_hotovo(:'tenant') = (select zpet_hotovo_kdy from public.faktury_prevod where tenant_id = :'tenant'));
select pg_temp.check('podruhé vrátit nejde', pg_temp.spadne_hlaskou(format('select app.faktury_prevod_vratit(%L)', :'tenant'), '23514', 'jen dokončený'));
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('po vrácení appka do faktur nezapíše',
  pg_temp.spadne_hlaskou(format('insert into public.faktury (tenant_id, dodavatel) values (%L, %L)', :'tenant', 'X'), '42501', 'nejsou otevřené'));
select pg_temp.check('po vrácení nová cesta párování zavřená',
  pg_temp.spadne_hlaskou(format('select * from public.sparovat_platbu_s_fakturou(%L, %L, %L, 100, null)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004'), '42501', 'nejsou otevřené'));
select pg_temp.check('po vrácení stará cesta párování funguje (předchozí verze appky)',
  pg_temp.projde(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 1000, 9999999)',
    :'tenant', :'t1', 'a0000000-0000-4000-8000-000000000004')));
reset role;
select set_config('test.user_id', '', false);
-- Stará cesta s id faktury CIZÍ firmy: spoušť odkazu ji nedohledá
-- (filtr na firmu), párování zůstane bez uuid — a cizí klíč tak nemá co
-- odmítnout. Bez filtru by uuid dohledala a zápis by spadl.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('po vrácení: stará cesta s id faktury cizí firmy zapíše, ale uuid nedohledá',
  pg_temp.projde(format('select * from public.potvrdit_alokaci_platby(%L, %L, %L, 500, 9999999)',
    :'tenant', :'t1', :'cizi_faktura')));
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… párování na cizí fakturu má uuid prázdné',
  (select faktura from public.platby_faktury where transakce_id = :'t1' and faktura_id = :'cizi_faktura') is null);
select pg_temp.check('starou cestou zapsané párování má i uuid (faktura v hlavní databázi je)',
  (select faktura from public.platby_faktury where transakce_id = :'t1' and stav = 'potvrzeno' and zpusob = 'rucne' and castka_haleru = 1000)
  = 'a0000000-0000-4000-8000-000000000004');
select app.faktury_prevod_zahajit(:'tenant', 'ctqtwahlzhyjerqulqyn.supabase.co', null) as stav_znovu \gset
select pg_temp.check('z vráceného jde zahájit znovu → probiha (značka hotového návratu zůstala — převod podle ní pozná změny staré appky)',
  :'stav_znovu' = 'probiha'
  and (select zpet_hotovo_kdy from public.faktury_prevod where tenant_id = :'tenant') is not null);
select pg_temp.check('nové zahájení: uuid faktur v párování vynulované, text zůstal',
  not exists (select 1 from public.platby_faktury where tenant_id = :'tenant' and faktura is not null)
  and exists (select 1 from public.platby_faktury where tenant_id = :'tenant' and stav = 'potvrzeno'
                and faktura_id = 'a0000000-0000-4000-8000-000000000004'));
-- Stará appka po vrácení fakturu smazala → převod ji musí smazat i tady,
-- i když na ni vede párování (jinak cizí klíč a převod uvízne).
set role service_role;
select pg_temp.check('… převod pak smaže i fakturu s párováním',
  pg_temp.projde($s$delete from public.faktury where id = 'a0000000-0000-4000-8000-000000000004'$s$));
reset role;
select pg_temp.check('během převodu: mimo přihlášeného jde párování jen odpojit (potvrdil, uuid), nic jiného',
  pg_temp.projde(format('update public.platby_faktury set potvrdil = null where id = %L', :'stare_parovani'))
  and pg_temp.spadne_hlaskou(format('update public.platby_faktury set castka_haleru = 1 where id = %L', :'stare_parovani'),
    '42501', 'Během stěhování'));


\echo ''
\echo '== Úklid =================================================================='

reset role;
select set_config('test.user_id', '', false);
-- Cizí firma B: kopie s řádkem bez měny, převedená faktura, stav
-- „dokonceno" — měření nesmí spadnout a zrušení celé firmy musí projít
-- (kaskáda maže jako vlastník tabulky, ne jako převod).
set role service_role;
insert into public.faktury_prevod_zdroj (tenant_id, tabulka, klic, radek)
values (:'tenant_b', 'invoices', 'b0000000-0000-4000-8000-000000000001', '{"currency": null, "amount": "1"}');
reset role;
select pg_temp.check('měření: řádek staré databáze bez měny měření neshodí',
  pg_temp.projde(format('select app.faktury_prevod_mereni(%L)', :'tenant_b')));
update public.faktury_prevod set stav = 'dokonceno' where tenant_id = :'tenant_b';
-- Zvlášť příkaz a zvlášť kontrola (dotaz v témže příkazu by smazání neviděl).
select pg_temp.projde(format('delete from public.tenants where id = %L', :'tenant_b')) as ok_pomocny \gset
select pg_temp.check('zrušení celé firmy s fakturami a kopií projde i po dokončení převodu',
  :'ok_pomocny'::boolean
  and not exists (select 1 from public.faktury where tenant_id = :'tenant_b')
  and not exists (select 1 from public.faktury_prevod_zdroj where tenant_id = :'tenant_b'));

-- Stav probiha (výš): převodní mazání faktur a kopie je povolené.
delete from storage.objects where bucket_id = 'faktury-prilohy' and name like :'tenant' || '/rucne/%';
delete from public.faktury_prijem where pripojeni_id = :'schranka';
delete from public.jine_platby_historie where zaznam_id in (:'jp_cela', :'jp_volna');
delete from public.jine_platby where id in (:'jp_cela', :'jp_volna');
delete from public.platby_faktury where transakce_id in (:'t1', :'t2', :'t3', :'t4', :'t5', :'t6', :'t7');
delete from public.transakce where id in (:'t1', :'t2', :'t3', :'t4', :'t5', :'t6', :'t7');
delete from public.platebni_ucty where id = :'ucet';
delete from public.integrace_pripojeni where id = :'schranka';
delete from public.faktury where tenant_id in (:'tenant', :'tenant_b');
delete from public.faktury_vzory_odmitnuti where tenant_id = :'tenant';
delete from public.faktury_prevod_zdroj where tenant_id = :'tenant';
delete from public.faktury_prevod where tenant_id in (:'tenant', :'tenant_b');
delete from public.membership_branches where membership_id = :'m_pobocka';
delete from public.memberships where id in (:'m_cte', :'m_pobocka', :'m_finance');
delete from public.employees where id in (:'e_cte', :'e_pobocka', :'e_finance');
delete from public.position_permissions where position_id in (:'poz_cte', :'poz_pobocka', :'poz_finance');
delete from public.positions where id in (:'poz_cte', :'poz_pobocka', :'poz_finance');
-- Cizí firmu smazala kontrola výš (zrušení firmy); auth.users a profiles
-- zůstávají (konvence krok30/krok73/krok89).

select pg_temp.check('úklid: po scénáři nezůstala žádná faktura ani stav převodu',
  not exists (select 1 from public.faktury where tenant_id = :'tenant')
  and not exists (select 1 from public.faktury_prevod where tenant_id = :'tenant'));

\echo ''
\echo '== KROK 99 HOTOV =============================================='
