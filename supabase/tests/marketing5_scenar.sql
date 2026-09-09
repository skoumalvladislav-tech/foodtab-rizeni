-- Scénář marketing 5 — výstup: render, publikační úlohy, publikace.
--
-- Pokrývá 20260910000000_marketing_vystup.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Čtvrtá a poslední pojistka kolem schvalování: **publikační úloha bez
-- platného schválení nevznikne.** Předchozí tři (verze je neměnná,
-- nová verze ruší schválení, rozhodnutí zapisuje spoušť) jsou
-- v marketing3. Tahle je jejich zámek — kdyby všechny tři selhaly,
-- pořád platí, že ven jde jen to, na co ukazuje `schvalena_verze_id`.
--
-- Každý způsob, jak se úlohu pokusit propašovat, je samostatná
-- kontrola. Souhrnná kontrola „nejde to" by neřekla, KTERÁ z podmínek
-- drží — a kdyby jedna vypadla, zbylé by ji zakryly.
--
-- ---------------------------------------------------------------------
-- POUČENÍ Z ROZBÍJENÍ
--
-- Napsal jsem to nejdřív tak, že dvě kontroly procházely z jiného
-- důvodu, než říkal jejich název:
--
--   * „čekající schválení nestačí" držela ve skutečnosti podmínka
--     o `schvalena_verze_id` — u čekající žádosti je prázdné, takže se
--     ke kontrole stavu vůbec nedošlo. Poznalo se to tím, že vyndání
--     kontroly stavu ze spouště NIC neshodilo.
--   * totéž u „neexistující schválení": chytal ho otisk, ne podmínka
--     na nenalezený řádek.
--
-- První se opravila tím, že se ukazatel na schválenou verzi nastaví
-- ručně — pak může úlohu zastavit už jen stav. Druhá se opravit nedá:
-- u nenalezeného řádku vyjde NULL i otisk, takže obě podmínky sahají
-- na totéž. Je to schválně dvojitá pojistka a je to u té kontroly
-- napsané, ne zamlčené.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz'  \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select id as e_majitel  from public.employees where user_id = :'majitel'  and deleted_at is null \gset
select id as e_provozni from public.employees where user_id = :'provozni' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

-- Příspěvek, verze, varianta.
insert into public.marketing_prispevky (tenant_id, branch_id, nazev, vytvoril)
values (:'tenant', :'perla', 'Pozvánka na degustaci', :'e_provozni')
returning id as prispevek \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek', 1, 'otisk-A', :'e_provozni')
returning id as verze_a \gset

insert into public.marketing_varianty (tenant_id, verze_id, prispevek_id, kanal, format)
values (:'tenant', :'verze_a', :'prispevek', 'instagram', 'prispevek')
returning id as varianta \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.prispevek', :'prispevek', false);
select set_config('test.verze_a', :'verze_a', false);
select set_config('test.varianta', :'varianta', false);


\echo ''
\echo '== 1. Bez schválení to nejde vůbec =========================='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-A',
            '00000000-0000-0000-0000-000000000000'::uuid,
            'instagram', 'prispevek', 'mock', 'demo', now(), 'pokus-bez-schvaleni');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: úloha bez schválení prošla'; end if;
  -- Drží to dvojitá pojistka: podmínka na nenalezený řádek i porovnání
  -- otisku (u nenalezeného schválení vyjde NULL obojí). Vyndání jedné
  -- z nich proto tuhle kontrolu neshodí — je to schválně a je to tady
  -- napsané, aby si nikdo nemyslel, že měří jen jednu z nich.
  raise notice '  OK    úloha s neexistujícím schválením neprojde (dvojitá pojistka)';
end $$;


\echo ''
\echo '== 2. Čekající schválení nestačí ============================'

insert into public.marketing_schvaleni
  (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze_a', 'otisk-A', :'e_provozni')
returning id as zadost \gset
select set_config('test.zadost', :'zadost', false);

/*
  IZOLACE. Ukazatel na schválenou verzi nastavíme ručně, jako by ho
  někdo přepsal mimo schvalovací cestu. Bez toho by úlohu zastavila
  podmínka o `schvalena_verze_id` (u čekající žádosti je prázdné)
  a kontrola stavu by se nikdy nespustila — vyndání kontroly stavu ze
  spouště by pak neshodilo nic.
*/
update public.marketing_prispevky
   set schvalena_verze_id = :'verze_a' where id = :'prispevek';

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-A',
            current_setting('test.zadost')::uuid,
            'instagram', 'prispevek', 'mock', 'demo', now(), 'pokus-ceka');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: úloha na čekající schválení prošla'; end if;
  raise notice '  OK    čekající schválení na publikaci nestačí (i s ručně nastaveným ukazatelem)';
end $$;

update public.marketing_prispevky
   set schvalena_verze_id = null where id = :'prispevek';


\echo ''
\echo '== 3. Schválíme — a teprve pak to jde ======================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost';
reset role;

select pg_temp.check('příspěvek ukazuje na schválenou verzi',
  (select schvalena_verze_id from public.marketing_prispevky where id = :'prispevek') = :'verze_a');

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-JINY',
            current_setting('test.zadost')::uuid,
            'instagram', 'prispevek', 'mock', 'demo', now(), 'pokus-jiny-otisk');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: úloha s jiným otiskem prošla'; end if;
  raise notice '  OK    úloha s jiným otiskem než schválená verze neprojde';
end $$;

insert into public.marketing_publikace_ulohy
  (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id, varianta_id,
   kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic, vytvoril)
values (:'tenant', :'prispevek', :'verze_a', 'otisk-A', :'zadost', :'varianta',
        'instagram', 'prispevek', 'mock', 'demo', now(), 'publikace-1', :'e_majitel')
returning id as uloha \gset
select set_config('test.uloha', :'uloha', false);

select pg_temp.check('se schválením přesné verze úloha vznikne',
  (select stav from public.marketing_publikace_ulohy where id = :'uloha') = 'naplanovano');


\echo ''
\echo '== 3b. Schválení cizího příspěvku se nedá půjčit ============'

-- Schválení je platné, jen patří k něčemu jinému. Bez porovnání
-- příspěvku a verze by se dalo „zveřejnit tenhle text na základě
-- schválení tamtoho".

insert into public.marketing_prispevky (tenant_id, branch_id, nazev, vytvoril)
values (:'tenant', :'perla', 'Jiný příspěvek', :'e_provozni')
returning id as prispevek2 \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek2', 1, 'otisk-A', :'e_provozni')
returning id as verze_c \gset

insert into public.marketing_schvaleni
  (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek2', :'verze_c', 'otisk-A', :'e_provozni')
returning id as zadost2 \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost2';
reset role;

select set_config('test.zadost2', :'zadost2', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-A',
            current_setting('test.zadost2')::uuid,
            'facebook', 'prispevek', 'mock', 'demo', now(), 'pokus-cizi-schvaleni');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: schválení cizího příspěvku prošlo'; end if;
  raise notice '  OK    schválení jiného příspěvku se na tenhle použít nedá';
end $$;


\echo ''
\echo '== 4. Táž úloha podruhé nevznikne (idempotence) =============='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-A',
            current_setting('test.zadost')::uuid,
            'instagram', 'prispevek', 'mock', 'demo', now(), 'publikace-1');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhá úloha se stejným klíčem prošla'; end if;
  raise notice '  OK    táž úloha podruhé neprojde — dva příspěvky nevzniknou';
end $$;


\echo ''
\echo '== 5. Zveřejnění se zapíše jednou ==========================='

insert into public.marketing_publikace
  (tenant_id, branch_id, prispevek_id, verze_id, uloha_id, kanal, format,
   externi_id, je_nanecisto)
values (:'tenant', :'perla', :'prispevek', :'verze_a', :'uloha', 'instagram',
        'prispevek', 'demo-17841', true);

select pg_temp.check('demo publikace je označená jako nanečisto',
  (select je_nanecisto from public.marketing_publikace where uloha_id = :'uloha'));

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace
      (tenant_id, branch_id, prispevek_id, verze_id, uloha_id, kanal, format)
    values (current_setting('test.tenant')::uuid,
            (select id from public.branches where slug = 'cerna-perla'),
            current_setting('test.prispevek')::uuid, current_setting('test.verze_a')::uuid,
            current_setting('test.uloha')::uuid, 'instagram', 'prispevek');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhý záznam o zveřejnění téže úlohy'; end if;
  raise notice '  OK    opakovaný běh fronty nezaloží druhé zveřejnění';
end $$;


\echo ''
\echo '== 6. NOVÁ VERZE ZRUŠÍ NAPLÁNOVANOU PUBLIKACI ==============='

-- Vrátíme úlohu do naplánovaného stavu (zveřejněná už se ruší nedá)
-- a přidáme novou verzi.
update public.marketing_publikace_ulohy set stav = 'naplanovano' where id = :'uloha';

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek', 2, 'otisk-B', :'e_provozni')
returning id as verze_b \gset

select pg_temp.check('naplánovaná publikace je po nové verzi zrušená',
  (select stav from public.marketing_publikace_ulohy where id = :'uloha') = 'zruseno');
select pg_temp.check('a je u ní napsané proč',
  (select posledni_chyba from public.marketing_publikace_ulohy where id = :'uloha')
    like '%novou verzi%');


\echo ''
\echo '== 7. Starým schválením už nic nepropašuješ ================='

-- Schválení pořád existuje a je ve stavu `schvaleno`. Otisk verze A
-- taky sedí. Jenže příspěvek už na verzi A neukazuje — a to je ta
-- nejtišší cesta, kterou by se dalo zveřejnit něco, co nikdo neviděl.

select pg_temp.check('schválení verze A pořád existuje a je platné',
  (select stav from public.marketing_schvaleni where id = :'zadost') = 'schvaleno');

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_publikace_ulohy
      (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
       kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'otisk-A',
            current_setting('test.zadost')::uuid,
            'facebook', 'prispevek', 'mock', 'demo', now(), 'pokus-po-nove-verzi');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: starým schválením šlo naplánovat publikaci'; end if;
  raise notice '  OK    po nové verzi starým schválením nic nenaplánuješ';
end $$;


\echo ''
\echo '== 8. Render: idempotence a peníze v haléřích ==============='

insert into public.marketing_render_ulohy
  (tenant_id, prispevek_id, verze_id, varianta_id, poskytovatel, rezim,
   idempotencni_klic, cena_haleru)
values (:'tenant', :'prispevek', :'verze_a', :'varianta', 'vestaveny_svg', 'foodtab',
        'render-1', 0);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_render_ulohy
      (tenant_id, prispevek_id, verze_id, poskytovatel, rezim, idempotencni_klic)
    values (current_setting('test.tenant')::uuid, current_setting('test.prispevek')::uuid,
            current_setting('test.verze_a')::uuid, 'vestaveny_svg', 'foodtab', 'render-1');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: týž render se založil dvakrát'; end if;
  raise notice '  OK    týž render se nezaloží dvakrát';
end $$;

select pg_temp.check('cena je celé číslo v haléřích, ne desetinné',
  (select pg_typeof(cena_haleru)::text from public.marketing_render_ulohy
    where idempotencni_klic = 'render-1') = 'integer');


\echo ''
\echo '== Audit ===================================================='

select pg_temp.check('publikační úloha i zveřejnění jsou v auditu',
  exists (select 1 from public.audit_log
           where entity_type = 'marketing_publikace_uloha' and tenant_id = :'tenant')
  and exists (select 1 from public.audit_log
           where entity_type = 'marketing_publikace' and tenant_id = :'tenant'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_publikace where tenant_id = :'tenant';
delete from public.marketing_publikace_ulohy where tenant_id = :'tenant';
delete from public.marketing_render_ulohy where tenant_id = :'tenant';
delete from public.marketing_schvaleni where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_varianty where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_publikace_ulohy where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_publikace where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 5 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
