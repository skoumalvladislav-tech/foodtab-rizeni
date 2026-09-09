-- =====================================================================
-- Foodtab — zrušit i VYDANOU směnu
--
-- Hlásil Šéfík 9. 9. 2026 z provozu: „stále nejde mazat směny."
--
-- ---------------------------------------------------------------------
-- CO BYLO ŠPATNĚ NA PŘEDCHOZÍ VERZI
--
-- `20260909080000_mazani_smen.sql` vydanou směnu ODMÍTALA smazat, aby
-- lidem nezmizela z rozpisu dřív, než se změna vydá. Úvaha byla
-- správná, závěr špatný: rozpis se staví, VYDÁ, a teprve pak se v něm
-- škrtá — takže odmítnutí u vydané směny znamená, že se nedá smazat
-- prakticky nic. Funkce, která odmítne v jediném případě, který
-- nastává, je k ničemu.
--
-- Hlavička té migrace navíc tvrdila, že měkké mazání by znamenalo
-- filtr v jedenácti funkcích a přes sedm set přepsaných řádků.
-- **To byl omyl.** Ten mechanismus v projektu už existoval a je
-- zapojený všude — jen se jmenuje jinak:
--
--   `shifts.status = 'cancelled'`   (20260823130000_provoz.sql, ř. 68-69)
--
-- Respektují ho `app.earnings` (20260831011000, ř. 197),
-- `public.lide_pro_pobocku` (20260901150000, ř. 138), `app.pin_overit`
-- (20260901180000, ř. 252), `public.kiosk_stav` (20260901190000,
-- ř. 121) i všechny tři obrazovky, které směny čtou.
--
-- A hlavně: **vydání rozpisu s ním počítá.** `app.rozdil_rozpisu`
-- (20260901130000) mapuje `cancelled` na „zrusena" (ř. 133), nezobrazuje
-- zrušení, které nikdo neviděl (ř. 156), a neopakuje zrušení, které už
-- vydané bylo (ř. 160). Zrušená směna se tedy lidem ohlásí PŘI VYDÁNÍ,
-- ne potichu — přesně to, co se mělo stát.
--
-- ---------------------------------------------------------------------
-- CO DĚLÁ TAHLE VERZE
--
--   nevydaná směna  (published_at is null)  →  SMAŽE SE (řádek zmizí)
--   vydaná směna                            →  status = 'cancelled'
--
-- U nevydané se maže natvrdo schválně: nikdy ji nikdo neviděl, není co
-- dohledávat a v rozpisu by jen překážela jako přeškrtnutý řádek.
--
-- U vydané zůstává řádek stát, protože lidem se pořád ukazuje VYDANÁ
-- podoba. Zmizí jim až vydáním rozpisu — a to je ta chvíle, kdy se
-- o zrušení dozvědí.
--
-- ---------------------------------------------------------------------
-- FILTRUJE SI TO SAMO (nálezy, oddíl 7b)
--
-- `security definer` + vlastník s `rolbypassrls` = uvnitř žádné RLS.
-- `tenant_id = p_tenant` je proto v dotazu i v obou zápisech, a každá
-- podmínka je napsaná JEN JEDNOU, aby šla shodit — kontrola s cizí
-- firmou v `krok32_scenar` na to míří.
-- =====================================================================

/*
  DROP MUSÍ BÝT PRVNÍ. `create or replace function` neumí změnit
  návratový typ — původní funkce vracela `void`, tahle vrací `text`,
  aby obrazovka poznala, jestli se smazalo, nebo zrušilo. Bez `drop`
  by migrace spadla na „cannot change return type of existing
  function", a to až při nasazení.
*/
drop function if exists public.smazat_smenu(uuid, uuid);

create function public.smazat_smenu(
  p_tenant uuid,
  p_smena  uuid
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_smena record;
begin
  select s.id, s.branch_id, s.published_at, s.status
    into v_smena
    from public.shifts s
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  if not found then
    raise exception 'Takovou směnu neznám.'
      using errcode = 'no_data_found';
  end if;

  -- Právo se ptá na POBOČKU TÉ SMĚNY, ne na tu z adresy (pravidlo 4).
  if not app.has_access(p_tenant, 'shifts.manage', v_smena.branch_id) then
    raise exception 'Tahle směna patří pobočce, kterou nespravujete.'
      using errcode = 'insufficient_privilege';
  end if;

  /*
    NEVYDANÁ: řádek zmizí. Nikdo ji neviděl, není co ohlašovat.
  */
  if v_smena.published_at is null then
    delete from public.shifts s
     where s.id = p_smena
       and s.tenant_id = p_tenant;
    return 'smazana';
  end if;

  /*
    VYDANÁ: zůstává stát jako zrušená. Lidem se pořád ukazuje vydaná
    podoba, takže se o zrušení dozvědí až vydáním rozpisu — kde ho
    `app.rozdil_rozpisu` ukáže jako „zrusena".

    Druhé zrušení téže směny nic nerozbije: skončí u `already`
    a obrazovka se nemá čeho chytit.
  */
  if v_smena.status = 'cancelled' then
    return 'uz_zrusena';
  end if;

  update public.shifts s
     set status = 'cancelled'
   where s.id = p_smena
     and s.tenant_id = p_tenant;

  return 'zrusena';
end $$;

comment on function public.smazat_smenu(uuid, uuid) is
  'Nevydanou směnu smaže, vydanou označí jako zrušenou — ta lidem '
  'zmizí až vydáním rozpisu, kde se ohlásí. Právo shifts.manage na '
  'pobočce té směny. Vrací smazana / zrusena / uz_zrusena.';

revoke all on function public.smazat_smenu(uuid, uuid)
  from public, anon;
grant execute on function public.smazat_smenu(uuid, uuid) to authenticated;
