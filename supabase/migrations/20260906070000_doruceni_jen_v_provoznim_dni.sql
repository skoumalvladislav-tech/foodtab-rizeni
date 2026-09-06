-- =====================================================================
-- Foodtab — doručení končí s provozním dnem, ve kterém se píchl příchod
--
-- Rozhodnutí Šéfíka z docs/odpovedi-na-nocni-praci-2026-09-06.md,
-- odpověď 1. Opravuje `app.smena_ted` z 20260906010000 (krok A).
-- Jde nasadit samo.
--
-- ---------------------------------------------------------------------
-- CO SE DĚLO
--
-- „Na směně" se bralo jako „má otevřený příchod" — a otevřený příchod
-- zůstává otevřený, dokud ho někdo neuzavře. Kdo v úterý zapomněl
-- píchnout odchod, byl podle aplikace na směně i ve středu ve tři ráno.
-- A protože se podle toho rozhoduje o doručení, chodily mu zprávy.
--
-- To je přesně to, čemu má celé pravidlo bránit. Zapomenutý odchod by
-- ho obcházel — a obcházel by ho zrovna u toho člověka, který si ho
-- nevšiml, takže by o tom ani nevěděl.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
-- Zprávy chodí, jen dokud trvá PROVOZNÍ DEN, ve kterém se ten příchod
-- píchl. Pak se člověk bere jako mimo směnu, i když záznam zůstává
-- nedokončený.
--
-- NEZNAMENÁ TO, ŽE SE ZÁZNAM UZAVŘE. Nedokončený příchod zůstává
-- nedokončený, zůstává v panelu nedokončených a zůstává v dosahu
-- hlídače zapomenutých odchodů. Tahle migrace mění JEN to, komu se
-- smí zvonit — ne to, co je v docházce. Nedokončený záznam je věc pro
-- vedoucího, ne důvod držet člověka „ve službě".
--
-- ---------------------------------------------------------------------
-- PROČ TO NEZJEDNODUŠOVAT ZPÁTKY
--
-- Až sem někdo za rok přijde s tím, že „stačí se zeptat, jestli má
-- otevřený příchod", vrátí tím do aplikace stav, kdy zvoní ve tři ráno
-- člověku, který spí doma. Důvod, proč to nesmí, není v pohodlí:
-- aplikace, která zvoní mimo směnu a čeká rychlou reakci, vyrábí
-- zaměstnavateli mzdový závazek (§ 78 ZP a test z judikatury SDEU —
-- musí-li zaměstnanec reagovat ve velmi krátké lhůtě, jde už
-- o pracovní dobu). Viz hlavičku 20260906010000.
--
-- Provozní den se počítá z `branches.day_starts_at`, ne z půlnoci
-- (pravidlo 10). Noční směna, která začala ve 22:00, tedy ve 2:15
-- pořád běží — to je TÝŽ provozní den a zprávy chodit MAJÍ.
-- =====================================================================

create or replace function app.smena_ted(p_tenant uuid, p_employee uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.branch_id
  from app.otevreny_prichod(p_tenant, p_employee) o
  -- Tahle jediná podmínka je celá změna: provozní den toho příchodu
  -- musí být pořád ten dnešní. Porovnávají se PROVOZNÍ dny, ne
  -- okamžiky, a den se bere z pobočky, kde člověk píchl.
  where o.business_date = app.business_date(o.branch_id, now());
$$;

comment on function app.smena_ted(uuid, uuid) is
  'Pobočka, na které je člověk TEĎ na směně. NULL = mimo směnu. '
  'Otevřený příchod se bere z app.otevreny_prichod, ale platí jen '
  'v provozním dni, ve kterém se píchl: zapomenutý odchod by jinak '
  'obcházel pravidlo o doručení a aplikace by zvonila ve tři ráno.';

revoke all on function app.smena_ted(uuid, uuid) from public, anon, authenticated;
