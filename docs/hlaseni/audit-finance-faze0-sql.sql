-- Audit Finance Fáze 0 (krok 0): čtecí dotazy, ze kterých jsou čísla v docs/hlaseni/audit-finance-faze0.md.
-- JEN SELECT. Pouštěno 18. 11. večer a 19. 11. odpoledne přes Supabase CLI (db query --linked) na projekt foodtab-test (= ostrý provoz).
-- Každý blok začíná řádkem -- @název; spouštěč ho obalí do select json_agg(...) a odmítne cokoli, co není SELECT/WITH.

-- ===== soubor 1 =====
-- Finance Fáze 0, krok 0: jen čtení (SELECT). Žádné změny.
select json_build_object(
  'firmy_s_fakturami', (select json_agg(x) from (
      select f.tenant_id, count(*) as faktur
      from public.faktury f group by f.tenant_id order by 2 desc) x),
  'faktury_podle_stavu', (select json_agg(x) from (
      select stav, ke_kontrole, duplicita, archivovano, count(*) as pocet,
             sum(castka_haleru)::bigint as haleru, count(*) filter (where mena <> 'CZK') as cizi_mena
      from public.faktury group by 1,2,3,4 order by 5 desc) x),
  'faktury_celkem', (select count(*) from public.faktury),
  'ico_vyplnene', (select count(*) from public.faktury where nullif(btrim(dodavatel_ico), '') is not null),
  'ico_prazdne', (select count(*) from public.faktury where nullif(btrim(dodavatel_ico), '') is null),
  'vs_vyplneny', (select count(*) from public.faktury where nullif(btrim(variabilni_symbol), '') is not null),
  'ucet_dodavatele_vyplneny', (select count(*) from public.faktury where nullif(btrim(ucet_dodavatele), '') is not null),
  'cislo_faktury_prazdne', (select count(*) from public.faktury where nullif(btrim(cislo_faktury), '') is null),
  'castka_nula', (select count(*) from public.faktury where castka_haleru = 0),
  'dobropisy_zaporne', (select count(*) from public.faktury where castka_haleru < 0),
  'splatnost_prazdna', (select count(*) from public.faktury where splatnost is null),
  'duzp_prazdne', (select count(*) from public.faktury where duzp is null),
  'dodavatelu_nazvu', (select count(distinct dodavatel) from public.faktury),
  'dodavatelu_ico', (select count(distinct btrim(dodavatel_ico)) from public.faktury where nullif(btrim(dodavatel_ico), '') is not null),
  'ico_s_vice_nazvy', (select count(*) from (
      select btrim(dodavatel_ico) from public.faktury
      where nullif(btrim(dodavatel_ico), '') is not null
      group by 1 having count(distinct dodavatel) > 1) x),
  'ico_s_vice_nazvy_faktur', (select coalesce(sum(n), 0) from (
      select count(*) as n from public.faktury
      where nullif(btrim(dodavatel_ico), '') is not null
      group by btrim(dodavatel_ico) having count(distinct dodavatel) > 1) x),
  'ico_s_vice_nazvy_top', (select json_agg(x) from (
      select btrim(dodavatel_ico) as ico, count(distinct dodavatel) as nazvu, count(*) as faktur,
             (array_agg(distinct dodavatel))[1:4] as ukazka_nazvu
      from public.faktury where nullif(btrim(dodavatel_ico), '') is not null
      group by 1 having count(distinct dodavatel) > 1 order by 2 desc, 3 desc limit 8) x),
  'stejny_nazev_ruzne_ico', (select count(*) from (
      select lower(btrim(dodavatel)) from public.faktury
      where nullif(btrim(dodavatel_ico), '') is not null
      group by 1 having count(distinct btrim(dodavatel_ico)) > 1) x),
  'prijem_podle_stavu', (select json_agg(x) from (
      select stav, count(*) as pocet from public.faktury_prijem group by 1 order by 2 desc) x),
  'platebni_ucty', (select json_agg(x) from (
      select typ, aktivni, (branch_id is not null) as ma_pobocku, count(*) as pocet
      from public.platebni_ucty group by 1,2,3 order by 4 desc) x),
  'transakce_podle_zdroje', (select json_agg(x) from (
      select zdroj, smer, count(*) as pocet, min(datum) as od, max(datum) as do_
      from public.transakce group by 1,2 order by 3 desc) x),
  'platby_faktury_podle_stavu', (select json_agg(x) from (
      select stav, count(*) as pocet from public.platby_faktury group by 1) x),
  'bankovni_zustatky', (select count(*) from public.bankovni_zustatky),
  'kontakty', (select json_build_object(
      'celkem', count(*), 'aktivni', count(*) filter (where deleted_at is null),
      'dodavatele', count(*) filter (where je_dodavatel and deleted_at is null),
      's_ico', count(*) filter (where nullif(btrim(ico), '') is not null and deleted_at is null))
      from public.kontakty),
  'pobocky', (select json_agg(x) from (
      select b.tenant_id, b.id, b.name,
             (select count(*) from public.platebni_ucty u where u.branch_id = b.id) as uctu
      from public.branches b order by b.tenant_id, b.name) x)
) as vysledek;

-- ===== soubor 2 =====
-- Finance Fáze 0, krok 0, čtecí dotaz 2. JEN SELECT. Každý blok běží zvlášť a vrací json_agg.
-- @otevreno_rozklad
select count(*) as pocet, sum(castka_haleru)::bigint as haleru,
  count(*) filter (where splatnost < current_date) as po_splatnosti,
  sum(castka_haleru) filter (where splatnost < current_date)::bigint as po_splatnosti_haleru,
  count(*) filter (where splatnost is null) as bez_splatnosti,
  count(*) filter (where duplicita or stav like 'Duplicit%') as duplicity,
  sum(castka_haleru) filter (where splatnost < current_date and (duplicita or stav like 'Duplicit%'))::bigint as po_splatnosti_duplicity_haleru,
  sum(castka_haleru) filter (where splatnost < current_date and stav = 'Upomínka - zkontrolovat')::bigint as po_splatnosti_upominky_haleru,
  count(*) filter (where stav = 'Částečně uhrazeno') as castecne,
  count(*) filter (where castka_haleru < 0) as zaporne,
  count(*) filter (where upper(btrim(mena)) <> 'CZK') as cizi_mena,
  sum(castka_haleru) filter (where upper(btrim(mena)) <> 'CZK')::bigint as cizi_mena_jednotek
from public.faktury
where not archivovano and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')
-- @otevreno_podle_meny
select upper(btrim(mena)) as mena, count(*) as pocet, sum(castka_haleru)::bigint as jednotek,
  count(*) filter (where splatnost < current_date) as po_splatnosti
from public.faktury
where not archivovano and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')
group by 1 order by 2 desc
-- @kalendar
select archivovano, count(*) as pocet, count(*) filter (where splatnost < current_date) as po_splatnosti,
  sum(castka_haleru)::bigint as haleru
from public.faktury
where splatnost is not null and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')
group by archivovano
-- @pasma_po_splatnosti
select case when current_date - splatnost <= 30 then '1-30' when current_date - splatnost <= 90 then '31-90'
            when current_date - splatnost <= 180 then '91-180' when current_date - splatnost <= 250 then '181-250'
            else '>250' end as pasmo_dni,
  count(*) as pocet, sum(castka_haleru)::bigint as haleru, min(splatnost) as nejstarsi, max(splatnost) as nejnovejsi
from public.faktury
where not archivovano and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto') and splatnost < current_date
group by 1 order by min(splatnost)
-- @fronta_542_puvod
select (prevedeno_kdy is not null) as z_prevodu, (odkaz_pdf like '%/api/faktury/priloha/%') as novy_prijem,
  ke_kontrole, left(stav, 60) as stav, count(*) as pocet,
  count(*) filter (where priloha_cesta is not null) as ma_kopii_souboru,
  count(*) filter (where nullif(btrim(odkaz_pdf), '') is not null) as ma_odkaz,
  count(*) filter (where castka_haleru = 0) as bez_castky,
  count(*) filter (where coalesce(btrim(dodavatel), '') = '') as bez_dodavatele
from public.faktury
where not archivovano and (ke_kontrole or stav like 'Nutná ruční kontrola%')
group by 1, 2, 3, 4 order by 5 desc
-- @fronta_542_pripony
select lower(substring(priloha_cesta from '\.([A-Za-z0-9]+)$')) as pripona_kopie,
  (odkaz_pdf like '%/storage/v1/object/public/%') as odkaz_do_stare_db, count(*) as pocet
from public.faktury
where not archivovano and (ke_kontrole or stav like 'Nutná ruční kontrola%')
group by 1, 2 order by 3 desc
-- @duplicity_puvod
select (prevedeno_kdy is not null) as z_prevodu, archivovano, left(stav, 60) as stav, count(*) as pocet, sum(castka_haleru)::bigint as haleru
from public.faktury where duplicita group by 1, 2, 3 order by 4 desc
-- @duplicity_bez_originalu
select count(*) as oznacenych, count(*) filter (where not exists (
  select 1 from public.faktury o where o.tenant_id = d.tenant_id and o.id <> d.id
    and o.dodavatel = d.dodavatel and o.cislo_faktury = d.cislo_faktury)) as bez_originalu_dnesnim_pravidlem,
  count(*) filter (where d.cislo_faktury is null or btrim(d.cislo_faktury) = '') as bez_cisla,
  count(*) filter (where d.cislo_faktury ~* '^\s*(bez|n/?a|-+|0+|x+)\s*$') as zastupne_cislo
from public.faktury d where d.duplicita
-- @duplicity_skupiny_novym_pravidlem
with s as (
  select tenant_id, dodavatel, cislo_faktury, count(*) as n, count(distinct castka_haleru) as n_castek,
         count(distinct coalesce(datum_vystaveni, duzp)) as n_dat, count(*) filter (where duplicita) as n_oznac
  from public.faktury where coalesce(btrim(cislo_faktury), '') <> '' group by 1, 2, 3 having count(*) > 1)
select count(*) as skupin, sum(n) as faktur, sum(n_oznac) as oznacenych,
  count(*) filter (where n_castek = 1 and n_dat = 1) as skupin_shoda_castka_i_datum,
  count(*) filter (where n_castek > 1) as skupin_jina_castka
from s
-- @duplicity_otisk_souboru
with o as (
  select f.id, f.tenant_id, f.duplicita,
         coalesce(substring(f.priloha_cesta from '([0-9a-f]{64})'), p.priloha_hash) as hash
  from public.faktury f left join public.faktury_prijem p on p.faktura = f.id and p.stav = 'zapsano')
select count(*) as skupin, coalesce(sum(n), 0) as faktur, coalesce(sum(n_dup), 0) as z_toho_oznacenych
from (select tenant_id, hash, count(*) as n, count(*) filter (where duplicita) as n_dup
      from o where hash is not null group by 1, 2 having count(*) > 1) s
-- @duplicity_ico_cislo_ruzne_nazvy
select count(*) as skupin, coalesce(sum(pocet), 0) as faktur, coalesce(sum(oznaceno), 0) as oznaceno
from (select tenant_id, btrim(dodavatel_ico) as ico, lower(regexp_replace(cislo_faktury, '\s', '', 'g')) as cislo,
             count(*) as pocet, count(*) filter (where duplicita) as oznaceno
      from public.faktury where nullif(btrim(dodavatel_ico), '') is not null and coalesce(btrim(cislo_faktury), '') <> ''
      group by 1, 2, 3 having count(*) > 1 and count(distinct dodavatel) > 1) s
-- @eon
select (prevedeno_kdy is not null) as z_prevodu, duplicita, archivovano,
  (cislo_faktury is null or btrim(cislo_faktury) = '') as bez_cisla,
  (nullif(btrim(variabilni_symbol), '') is not null) as ma_vs, count(*) as pocet
from public.faktury where dodavatel ilike '%e.on%' or dodavatel ilike 'eon %'
group by 1, 2, 3, 4, 5 order by 6 desc
-- @prijem_zapsano_kam
select p.zdroj_vytezeni, f.stav, count(*) as pocet, sum(f.castka_haleru)::bigint as haleru
from public.faktury_prijem p join public.faktury f on f.tenant_id = p.tenant_id and f.id = p.faktura
where p.stav = 'zapsano' group by 1, 2 order by 3 desc
-- @prijem_neni_doklad
select typ_dokladu, vysledek -> 'doklad' ->> 'jistotaTypu' as jistota, zdroj_vytezeni, count(*) as pocet
from public.faktury_prijem where stav = 'neni_doklad' group by 1, 2, 3 order by 4 desc
-- @prijem_davka_velikost
select stav, druh, count(*) as pocet, round(avg(priloha_velikost) / 1024.0) as prumer_kb,
  round(sum(priloha_velikost) / 1048576.0, 1) as celkem_mb, count(*) filter (where soubor_cesta is not null) as se_souborem
from public.faktury_prijem where stav in ('vyzaduje_kontrolu', 'ceka', 'chyba') group by 1, 2 order by 1, 2
-- @prijem_model
select model, zdroj_vytezeni, count(*) as pocet, min(zpracovano_kdy) as od, max(zpracovano_kdy) as do_
from public.faktury_prijem where zdroj_vytezeni is not null group by 1, 2 order by 3 desc
-- @prijem_ai_48h
select date_trunc('hour', zpracovano_kdy) as hodina, count(*) as ai_radku,
  count(*) filter (where stav = 'zapsano') as zapsano, count(*) filter (where stav = 'vyzaduje_kontrolu') as kontrola
from public.faktury_prijem where zdroj_vytezeni = 'ai' and zpracovano_kdy >= now() - interval '48 hours'
group by 1 order by 1
-- @integrace_pripojeni
select oblast, poskytovatel, stav, rezim, (branch_id is not null) as ma_pobocku, count(*) as pocet
from public.integrace_pripojeni group by 1, 2, 3, 4, 5 order by 1, 2
-- @platebni_ucty_detail
select typ, aktivni, (branch_id is not null) as ma_pobocku, (coalesce(btrim(cislo_uctu), '') <> '') as ma_cislo, mena,
  pocatecni_zustatek_haleru, created_at
from public.platebni_ucty
-- @predpisy_a_davky
select (select count(*) from public.predpisy_plateb) as predpisu, (select count(*) from public.predpisy_plateb where aktivni) as aktivnich,
  (select count(*) from public.import_davky) as import_davek, (select count(*) from public.synchronizace_behy) as sync_behu
-- @uhrazeno_audit
select actor_type, count(*) as pocet, min(occurred_at) as prvni, max(occurred_at) as posledni
from public.audit_log where entity_type = 'faktura' and action = 'faktura.update' and after ->> 'stav' = 'Uhrazeno'
group by actor_type
-- @zmeny_stavu_audit
select a.before ->> 'stav' as pred, a.after ->> 'stav' as po, a.actor_type, count(*) as pocet, max(a.occurred_at) as naposledy
from public.audit_log a where a.entity_type = 'faktura' and a.action = 'faktura.update' and a.after ? 'stav'
group by 1, 2, 3 order by 4 desc limit 30
-- @polozky_a_tabulky
select to_regclass('public.faktury_polozky')::text as faktury_polozky, to_regclass('public.faktura_polozky')::text as faktura_polozky,
  to_regclass('public.dodavatele')::text as dodavatele, to_regclass('public.nakladove_kategorie')::text as nakladove_kategorie,
  to_regclass('public.bankovni_ucty')::text as bankovni_ucty, to_regclass('public.bankovni_pohyby')::text as bankovni_pohyby
-- @faktury_granty
select grantee, privilege_type, string_agg(column_name, ',' order by column_name) as sloupce
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'faktury' and grantee in ('anon', 'authenticated') and privilege_type in ('UPDATE', 'INSERT')
group by 1, 2
-- @prava_pocty
select pp.permission_key, count(distinct pp.position_id) as zarazeni, count(distinct e.id) as lidi
from public.position_permissions pp
left join public.employees e on e.position_id = pp.position_id and e.tenant_id = pp.tenant_id and e.deleted_at is null
where pp.permission_key in ('faktury.manage', 'faktury.read', 'finance.manage', 'finance.read', 'purchasing.read', 'purchasing.manage', 'integrace.manage', 'approvals.decide')
group by 1 order by 1
-- @prava_vyjimky
select permission_key, granted, count(*) as pocet from public.employee_permissions
where permission_key in ('faktury.manage', 'faktury.read', 'finance.manage', 'finance.read', 'purchasing.read', 'purchasing.manage')
group by 1, 2 order by 1
-- @majitele_a_rozsah
select e.je_majitel, m.scope, m.status, count(*) as pocet
from public.memberships m join public.employees e on e.user_id = m.user_id and e.tenant_id = m.tenant_id and e.deleted_at is null
group by 1, 2, 3 order by 1 desc, 2
-- @pobockovi_s_finance_read
select count(*) as pocet from public.memberships m
join public.employees e on e.user_id = m.user_id and e.tenant_id = m.tenant_id and e.deleted_at is null
where m.status = 'active' and m.scope = 'branch' and (e.je_majitel or coalesce(
  (select ep.granted from public.employee_permissions ep where ep.employee_id = e.id and ep.tenant_id = m.tenant_id and ep.permission_key = 'finance.read'),
  exists (select 1 from public.position_permissions pp where pp.position_id = e.position_id and pp.tenant_id = m.tenant_id and pp.permission_key = 'finance.read')))
-- @moduly
select module_key, status, valid_until from public.tenant_modules order by 1
-- @ico_tvar
select case when dodavatel_ico is null or btrim(dodavatel_ico) = '' then 'chybi'
            when btrim(dodavatel_ico) ~ '^[0-9]{8}$' then '8 cislic'
            when regexp_replace(dodavatel_ico, '[^0-9]', '', 'g') ~ '^[0-9]{1,8}$' then 'jiny tvar, jde normalizovat'
            else 'jiny' end as tvar,
  (prevedeno_kdy is not null) as z_prevodu, count(*) as pocet
from public.faktury group by 1, 2 order by 3 desc
-- @vlastni_ico
select t.id as tenant_id, (select count(*) from public.faktury f where f.tenant_id = t.id and btrim(f.dodavatel_ico) = '21249946') as faktur_s_ico_21249946
from public.tenants t
-- @faktury_prevod
select stav, zahajeno_kdy, dokonceno_kdy from public.faktury_prevod
-- @schvalovani_fronta
select left(stav, 60) as stav, count(*) as pocet, sum(castka_haleru)::bigint as haleru from public.faktury
where not archivovano and stav like '%Ke schválení%' group by 1

-- ===== soubor 3 =====
-- Finance Fáze 0, krok 0, čtecí dotaz 3. JEN SELECT.
-- @fronta_542_odkazy
select (nullif(btrim(odkaz_onedrive), '') is not null) as ma_onedrive, (nullif(btrim(odkaz_pdf), '') is not null) as ma_odkaz_pdf,
  (priloha_cesta is not null) as ma_kopii, (nullif(btrim(vytah_textu), '') is not null) as ma_vytah_textu,
  (nullif(btrim(email_predmet), '') is not null) as ma_predmet, (prijato_kdy is not null) as ma_prijato,
  count(*) as pocet, min(prijato_kdy) as od, max(prijato_kdy) as do_
from public.faktury
where not archivovano and (ke_kontrole or stav like 'Nutná ruční kontrola%')
group by 1, 2, 3, 4, 5, 6 order by 7 desc
-- @fronta_542_onedrive_tvar
select substring(odkaz_onedrive from '^(https?://[^/]+)') as host, count(*) as pocet
from public.faktury
where not archivovano and (ke_kontrole or stav like 'Nutná ruční kontrola%') and nullif(btrim(odkaz_onedrive), '') is not null
group by 1 order by 2 desc
-- @soubory_vsech_faktur
select (prevedeno_kdy is not null) as z_prevodu, (priloha_cesta is not null) as ma_kopii,
  (nullif(btrim(odkaz_pdf), '') is not null) as ma_odkaz_pdf, (nullif(btrim(odkaz_onedrive), '') is not null) as ma_onedrive,
  count(*) as pocet
from public.faktury group by 1, 2, 3, 4 order by 5 desc
-- @priloha_cesta_tvar
select regexp_replace(priloha_cesta, '[0-9a-f]{8,}', '<hex>', 'g') as tvar, count(*) as pocet
from public.faktury where priloha_cesta is not null group by 1 order by 2 desc limit 10
-- @otisk_skupiny_detail
with o as (
  select f.id, f.tenant_id, f.duplicita, f.cislo_faktury, f.castka_haleru, f.dodavatel,
         coalesce(substring(f.priloha_cesta from '([0-9a-f]{64})'), p.priloha_hash) as hash
  from public.faktury f left join public.faktury_prijem p on p.faktura = f.id and p.stav = 'zapsano'),
s as (select tenant_id, hash, count(*) as n, count(distinct coalesce(btrim(cislo_faktury), '')) as n_cisel,
             count(distinct castka_haleru) as n_castek, count(distinct dodavatel) as n_dodavatelu, count(*) filter (where duplicita) as n_dup
      from o where hash is not null group by 1, 2 having count(*) > 1)
select case when n_cisel = 1 and n_castek = 1 then 'stejne cislo i castka'
            when n_cisel = 1 then 'stejne cislo, jina castka'
            else 'ruzna cisla v jednom souboru' end as druh,
  count(*) as skupin, sum(n) as faktur, sum(n_dup) as oznacenych, max(n) as nejvic_v_souboru
from s group by 1 order by 2 desc
-- @prazdna_mena
select (mena is null) as je_null, mena = '' as je_prazdna, left(stav, 40) as stav, count(*) as pocet, sum(castka_haleru)::bigint as haleru
from public.faktury where mena is null or btrim(mena) = '' or upper(btrim(mena)) <> 'CZK' group by 1, 2, 3 order by 4 desc
-- @splatnost_dopocet
select count(*) filter (where splatnost is null) as bez_splatnosti,
  count(*) filter (where splatnost is null and datum_vystaveni is not null) as bez_splatnosti_s_vystavenim,
  count(*) filter (where splatnost is null and castka_haleru = 0) as bez_splatnosti_nulova,
  count(*) filter (where splatnost is null and castka_haleru <> 0) as bez_splatnosti_s_castkou,
  sum(castka_haleru) filter (where splatnost is null)::bigint as bez_splatnosti_haleru
from public.faktury where not archivovano and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')
-- @upominky_dvoji
select count(*) as upominek, count(*) filter (where exists (
  select 1 from public.faktury o where o.tenant_id = u.tenant_id and o.id <> u.id
    and o.dodavatel = u.dodavatel and o.castka_haleru = u.castka_haleru and o.stav <> 'Upomínka - zkontrolovat'
    and not o.archivovano)) as se_stejnou_castkou_u_dodavatele
from public.faktury u where u.stav = 'Upomínka - zkontrolovat' and not u.archivovano
-- @prijem_ceka_puvod
select pripojeni_id is not null as ma_schranku, (duvod like 'Vráceno%') as vraceno, druh, count(*) as pocet, min(vytvoreno_kdy) as od, max(vytvoreno_kdy) as do_
from public.faktury_prijem where stav = 'ceka' group by 1, 2, 3 order by 4 desc
-- @prijem_runy_24h
select date_trunc('hour', s.zahajeno_kdy) as hodina, count(*) as behu, round(avg(extract(epoch from s.dokonceno_kdy - s.zahajeno_kdy))) as prumer_s,
  count(*) filter (where s.stav = 'chyba') as chyb
from public.synchronizace_behy s join public.integrace_pripojeni i on i.id = s.integrace_pripojeni_id
where i.oblast = 'email_dokladu' and s.zahajeno_kdy >= now() - interval '12 hours' group by 1 order by 1
-- @tabulky_finance
select table_name from information_schema.tables where table_schema = 'public'
  and (table_name like '%ucet%' or table_name like '%ucty%' or table_name like '%transak%' or table_name like '%platb%' or table_name like '%kategor%' or table_name like '%dodav%' or table_name like '%kontakt%' or table_name like 'faktur%' or table_name like '%banka%' or table_name like '%bankov%')
order by 1

-- ===== soubor 4 =====
-- Finance Fáze 0, krok 0, čtecí dotaz 4. JEN SELECT. Kopie téhož souboru ve Fakturách.
-- @kopie_souboru_v_otevrenych
with o as (
  select f.id, f.tenant_id, f.duplicita, f.archivovano, f.stav, f.castka_haleru, f.splatnost, f.vytvoreno_kdy,
         btrim(coalesce(f.cislo_faktury, '')) as cislo, substring(f.priloha_cesta from '/([0-9a-f]{64})\.') as hash
  from public.faktury f where f.priloha_cesta is not null),
r as (select o.*, row_number() over (partition by tenant_id, hash, cislo, castka_haleru order by vytvoreno_kdy, id) as poradi,
             count(*) over (partition by tenant_id, hash, cislo, castka_haleru) as kopii
      from o where hash is not null)
select (poradi > 1) as je_dalsi_kopie, duplicita,
  (not archivovano and stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')) as v_otevrenych,
  count(*) as faktur, sum(castka_haleru)::bigint as haleru,
  count(*) filter (where splatnost < current_date) as po_splatnosti, sum(castka_haleru) filter (where splatnost < current_date)::bigint as po_splatnosti_haleru
from r where kopii > 1 group by 1, 2, 3 order by 1, 2, 3
-- @kopie_souboru_proc_neoznacene
with o as (
  select f.id, f.tenant_id, f.duplicita, f.dodavatel, btrim(coalesce(f.cislo_faktury, '')) as cislo, f.castka_haleru,
         substring(f.priloha_cesta from '/([0-9a-f]{64})\.') as hash
  from public.faktury f where f.priloha_cesta is not null),
s as (select tenant_id, hash, cislo, castka_haleru, count(*) as n, count(distinct dodavatel) as n_nazvu,
             count(*) filter (where duplicita) as n_dup, bool_or(cislo = '') as bez_cisla
      from o where hash is not null group by 1, 2, 3, 4 having count(*) > 1)
select (n_nazvu > 1) as ruzne_nazvy, bez_cisla, (n_dup = 0) as zadna_oznacena, count(*) as skupin, sum(n) as faktur, sum(n - 1 - least(n_dup, n - 1)) as neoznacenych_kopii
from s group by 1, 2, 3 order by 4 desc
-- @kopie_souboru_stav
with o as (
  select f.id, f.tenant_id, f.stav, f.archivovano, btrim(coalesce(f.cislo_faktury, '')) as cislo, f.castka_haleru, f.vytvoreno_kdy,
         substring(f.priloha_cesta from '/([0-9a-f]{64})\.') as hash
  from public.faktury f where f.priloha_cesta is not null),
r as (select o.*, row_number() over (partition by tenant_id, hash, cislo, castka_haleru order by vytvoreno_kdy, id) as poradi,
             count(*) over (partition by tenant_id, hash, cislo, castka_haleru) as kopii from o where hash is not null)
select left(stav, 50) as stav, archivovano, count(*) as dalsich_kopii, sum(castka_haleru)::bigint as haleru
from r where kopii > 1 and poradi > 1 group by 1, 2 order by 3 desc
-- @upominky_dvoji_castka
select count(*) as upominek, sum(u.castka_haleru)::bigint as haleru,
  count(*) filter (where u.splatnost < current_date) as po_splatnosti,
  sum(u.castka_haleru) filter (where exists (
    select 1 from public.faktury o where o.tenant_id = u.tenant_id and o.id <> u.id and o.dodavatel = u.dodavatel
      and o.castka_haleru = u.castka_haleru and o.stav <> 'Upomínka - zkontrolovat' and not o.archivovano
      and o.stav not in ('Uhrazeno', 'Ke schválení', 'Odmítnuto')))::bigint as haleru_s_otevrenym_dvojcetem
from public.faktury u where u.stav = 'Upomínka - zkontrolovat' and not u.archivovano and u.castka_haleru > 0
