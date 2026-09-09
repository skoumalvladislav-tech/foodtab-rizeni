-- =====================================================================
-- Foodtab — smazat směnu z rozpisu
--
-- Hlásil Šéfík z provozu 9. 9. 2026: „v kalendáři směn nejdou mazat
-- směny, jenom přidávat."
--
-- Nebylo to rozbité — nikdy to nevzniklo. `public.ulozit_smenu` uměla
-- založit i upravit, smazat neuměl nikdo a formulář měl jen Zrušit
-- a Uložit.
--
-- ---------------------------------------------------------------------
-- MAŽE SE JEN TO, CO JEŠTĚ NIKDO NEVIDĚL — a to je celé jádro věci
--
-- Rozpis má dvě podoby: rozdělanou a VYDANOU (`published_at` a sloupce
-- `published_*`, 20260901130000). Lidem se ukazuje ta vydaná, takže
-- změny v rozpisu se jich nedotknou, dokud je někdo nevydá. Na tom
-- stojí celé plánování.
--
-- Kdyby šlo smazat i vydanou směnu, **zmizela by lidem z rozpisu
-- okamžitě** — bez vydání, bez upozornění, prostě by tam ráno nebyla.
-- Tím by se to pravidlo obešlo právě u té změny, která lidi zajímá
-- nejvíc: „nemusíš přijít".
--
-- Vydaná směna se proto smazat NEDÁ a funkce to řekne českou větou.
-- Zrušení vydané směny je vlastní věc: musí zůstat vidět jako
-- ZRUŠENÁ, projít vydáním a založit upozornění. Je to zapsané jako
-- otázka 7 v docs/hlaseni/otazky.md a udělá se zvlášť.
--
-- ---------------------------------------------------------------------
-- PROČ SE MAŽE NATVRDO A NE PŘES `deleted_at`
--
-- Měkké mazání by znamenalo sloupec `deleted_at` a **filtr ve všech
-- jedenácti živých funkcích**, které `public.shifts` čtou — `earnings`,
-- `pichnout`, `pin_lide_pobocky`, `pin_overit`, `lide_pro_pobocku`,
-- `kiosk_stav`, `kiosk_zpravy_pocet`, `rozpis_stav`, `ulozit_smenu`,
-- `vydat_rozpis`, `rozdil_rozpisu` — plus čtyři místa v aplikaci.
-- Přes sedm set řádků přepsaných znak po znaku, a **jedna zapomenutá
-- cesta znamená, že se smazaná směna někde objeví zpátky.**
--
-- U nevydané směny to není potřeba: řádek zmizí a všech jedenáct
-- funkcí je správně samo od sebe. Historie se neztrácí, protože
-- nevydanou směnu nikdy nikdo neviděl — není co dohledávat.
--
-- `deleted_at` bude potřeba, teprve až se bude rušit VYDANÁ směna.
-- Tehdy se ten filtr doplní všude naráz a bude na to scénář.
--
-- ---------------------------------------------------------------------
-- FILTRUJE SI TO SAMO (nálezy, oddíl 7b)
--
-- Je to `security definer`, takže se uvnitř RLS neuplatní vůbec —
-- vlastníkem je role s `rolbypassrls`. Druhá obranná linie tu není.
-- Proto má `tenant_id = p_tenant` **v dotazu i v mazání**, ne jen
-- v jednom z nich.
--
-- Poctivě k tomu: kdyby ten filtr v dotazu chyběl, cizí firmu by
-- stejně zastavila kontrola práva o pár řádků níž — `app.has_access`
-- se ptá na POBOČKU té směny a na tu cizí členství nedosáhne. Filtr
-- tu tedy není jediná obrana, ale je to ta, po které se funkce o cizí
-- směně vůbec nedozví. Vyzkoušeno: po jeho vyndání se směna najde
-- a spadne to na jiné výjimce, což scénář krok32 pozná.
-- =====================================================================

create or replace function public.smazat_smenu(
  p_tenant uuid,
  p_smena  uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_smena record;
begin
  select s.id, s.branch_id, s.published_at
    into v_smena
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  if not found then
    raise exception 'Takovou směnu neznám.'
      using errcode = 'no_data_found';
  end if;

  -- Právo se ptá na POBOČKU TÉ SMĚNY, ne na tu z adresy. Kdo spravuje
  -- jednu pobočku, nesmí mazat směny na druhé.
  if not app.has_access(p_tenant, 'shifts.manage', v_smena.branch_id) then
    raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_smena.published_at is not null then
    raise exception 'Tuhle směnu už lidi vidí ve vydaném rozpisu. Smazat jde jen směna, která ještě nebyla vydaná — jinak by lidem z rozpisu zmizela dřív, než se změna vydá.'
      using errcode = 'check_violation';
  end if;

  delete from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant;
end $$;

comment on function public.smazat_smenu(uuid, uuid) is
  'Smaže nevydanou směnu. Vydanou odmítne — ta by lidem zmizela '
  'z rozpisu dřív, než se změna vydá. Právo shifts.manage na pobočce '
  'té směny.';

revoke all on function public.smazat_smenu(uuid, uuid)
  from public, anon;
grant execute on function public.smazat_smenu(uuid, uuid) to authenticated;
