-- =====================================================================
-- Foodtab — modul Marketing: úklid grantů po kampaních, upozorněních
-- a měření
--
-- ---------------------------------------------------------------------
-- CO SE STALO — PODRUHÉ, A BYLO TO NAPSANÉ
--
-- 14. 9. 2026 se do `foodtab-test` nasadily tři migrace
-- (`20260914140000_marketing_kampane`, `…160000_upozorneni`,
-- `…180000_metriky`). Ověření po nasazení ukázalo, že všechny čtyři
-- nové tabulky mají plné granty pro `anon` I `authenticated`:
--
--   marketing_kampane            anon: DELETE,INSERT,SELECT,TRUNCATE,UPDATE…
--   marketing_automatizace       anon: totéž
--   marketing_automatizace_behy  anon: totéž  ← a authenticated měl psát
--   marketing_metriky            anon: totéž  ← a authenticated měl psát
--
-- Dostaly je samy, výchozími právy projektu Supabase
-- (`alter default privileges … grant all on tables to anon,
-- authenticated, service_role`). Je to přesně to, co popisuje
-- `20260913180000_marketing_granty_uklid.sql` a co si ta migrace sama
-- napsala jako pravidlo:
--
--   „Každá nová tabulka marketingu proto potřebuje `revoke … from
--   anon` hned pod svým `create table`."
--
-- Ze čtyř nových tabulek to dostala jediná (`marketing_odkazy`).
-- Pravidlo tedy existovalo a stejně se na ně zapomnělo — proto je tady
-- ještě jednou, a proto k ní vznikla kontrola
-- `scripts/marketing-granty.test.mjs`, která hlídá VŠECHNY tabulky
-- modulu najednou, ne jmenovitě po jedné.
-- Jmenovitý seznam by u příští tabulky selhal stejně jako člověk.
--
-- ---------------------------------------------------------------------
-- CO TO ZNAMENALO A CO NE
--
-- Data neunikla a dopsat se nedala. RLS je na všech čtyřech zapnutá
-- a politiky jsou psané `to authenticated`, takže `anon` neprojde ani
-- na řádek; u `marketing_automatizace_behy` a `marketing_metriky`
-- neexistuje politika pro zápis, takže `insert` pod `authenticated`
-- skončí na RLS.
--
-- Ale to je jedna linie místo dvou (CLAUDE.md, pravidlo 3) — a u těch
-- dvou tabulek šlo přesně o to, co jejich vlastní hlavička slibovala:
-- „historie, do které může kdokoli psát, není doklad o ničem."
-- Slib byl v komentáři, ne v databázi.
--
-- ---------------------------------------------------------------------
-- TRUNCATE SE ODEBÍRÁ TAKY, A NENÍ TO KOSMETIKA
--
-- `truncate` se RLS NEŘÍDÍ. Přihlášený člověk s tím grantem vysype
-- celou tabulku napříč všemi firmami a žádná politika ho nezastaví —
-- na rozdíl od `delete`, které přes politiku projít musí.
--
-- POZOR, JE TO ŠIRŠÍ NEŽ MARKETING: týmž výchozím právem má `truncate`
-- role `authenticated` na všech 52 provozních tabulkách v `public`.
-- Tahle migrace sahá jen na čtyři tabulky marketingu — do cizího
-- modulu se nesahá (CLAUDE.md, „Dvě relace"). Zbytek je nahlášený
-- v `docs/hlaseni/stav-2026-09-14.md`, oddíl „Co jsem našel a neopravil".
--
-- `references` a `trigger` jdou pryč se stejným zdůvodněním: nikdo je
-- nepotřebuje a cizí klíč či spoušť na cizí tabulku není nic, co by
-- měl zakládat prohlížeč.
-- =====================================================================


-- ---------------------------------------------------------------------
-- NEPŘIHLÁŠENÝ NEMÁ NA MARKETINGU CO DĚLAT
--
-- Ani na čtení. Do veřejných částí modulu se chodí `security definer`
-- funkcí (`public.marketing_prejit`), ne přímo na tabulku.
-- ---------------------------------------------------------------------

revoke all on public.marketing_kampane           from anon;
revoke all on public.marketing_automatizace      from anon;
revoke all on public.marketing_automatizace_behy from anon;
revoke all on public.marketing_metriky           from anon;


-- ---------------------------------------------------------------------
-- HISTORIE A MĚŘENÍ: PŘIHLÁŠENÝ JEN ČTE
--
-- Obojí zapisuje úloha na serveru servisním klíčem. Přesně tak to měly
-- ty dvě migrace napsané v `grant select on … to authenticated` —
-- jenže výchozí práva k tomu přidala zbytek.
-- ---------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
    on public.marketing_automatizace_behy from authenticated;

revoke insert, update, delete, truncate, references, trigger
    on public.marketing_metriky from authenticated;


-- ---------------------------------------------------------------------
-- KAMPANĚ A AUTOMATIZACE: ZÁPIS ANO, VYSYPÁNÍ NE
--
-- `select, insert, update, delete` zůstává — obrazovky je potřebují
-- a RLS u nich rozhoduje podle `marketing.manage`, resp. `.publish`.
-- ---------------------------------------------------------------------

revoke truncate, references, trigger
    on public.marketing_kampane from authenticated;

revoke truncate, references, trigger
    on public.marketing_automatizace from authenticated;

revoke truncate, references, trigger
    on public.marketing_odkazy from authenticated;


-- ---------------------------------------------------------------------
-- A ZBYTEK MODULU — TRUNCATE PRYČ VŠUDE
--
-- Kontrola `scripts/marketing-granty.test.mjs`, která k téhle migraci
-- vznikla, ukázala rovnou po dopsání víc, než se hledalo: `truncate`
-- měla role `authenticated` na VŠECH tabulkách marketingu, ne jen na
-- čtyřech nových. Úklid ze 13. 9. řešil `anon`, na tohle nesáhl.
--
-- Odebírá se tedy u celého modulu najednou. `select/insert/update/
-- delete` nikde nemizí — o tom pořád rozhoduje RLS. Mizí jen právo,
-- které RLS obejde.
--
-- Na provozní tabulky (`employees`, `shifts`, `attendance_events`…)
-- se tady NESAHÁ, ačkoli mají totéž. Je to cizí modul (CLAUDE.md,
-- „Dvě relace v jednom repozitáři") — nahlášeno v hlášení ze 14. 9.
-- ---------------------------------------------------------------------

revoke truncate, references, trigger on public.marketing_media           from authenticated;
revoke truncate, references, trigger on public.marketing_menu            from authenticated;
revoke truncate, references, trigger on public.marketing_menu_dny        from authenticated;
revoke truncate, references, trigger on public.marketing_menu_polozky    from authenticated;
revoke truncate, references, trigger on public.marketing_nastaveni       from authenticated;
revoke truncate, references, trigger on public.marketing_pripojeni       from authenticated;
revoke truncate, references, trigger on public.marketing_prispevky       from authenticated;
revoke truncate, references, trigger on public.marketing_publikace       from authenticated;
revoke truncate, references, trigger on public.marketing_publikace_ulohy from authenticated;
revoke truncate, references, trigger on public.marketing_render_ulohy    from authenticated;
revoke truncate, references, trigger on public.marketing_sablony         from authenticated;
revoke truncate, references, trigger on public.marketing_schvaleni       from authenticated;
revoke truncate, references, trigger on public.marketing_ucty            from authenticated;
revoke truncate, references, trigger on public.marketing_varianty        from authenticated;
revoke truncate, references, trigger on public.marketing_verze           from authenticated;
