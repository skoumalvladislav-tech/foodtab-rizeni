-- =====================================================================
-- Foodtab — nový modul Tvorba menu
--
-- Zadání: docs/modul-menu-zadani.md, oddíl 8. Je to výslovný pokyn ke
-- změně závazného rozhodnutí v CLAUDE.md — moduly jsou nově čtyři plus
-- jeden, dohromady pět.
--
-- Tvorba menu je dílna, ne sklad. Menu navrhuje; hotový lístek vzniká
-- až tím, že návrh někdo schválí, a bydlí dál tam, kde bydlel.
-- Receptury a jídelní lístky se proto NEPŘESOUVAJÍ a jejich čtyři
-- oprávnění (recipes.*, menus.*) zůstávají v modulu `provoz`.
-- První verze zadání tvrdila opak; ta neplatí.
--
-- Tahle migrace zakládá jen modul a dvě oprávnění. Nic z toho, co má
-- modul jednou umět — agenta, podmínky návrhu, čtení z webu — tu ještě
-- není a záměrně se to nedomýšlí (oddíl 7 zadání).
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODUL
--
-- sort_order 15 ho staví v liště hned za Provoz (10) a před Finance (20).
-- is_base = false: je vypínatelný za celou firmu jako ostatní volitelné.
-- ---------------------------------------------------------------------

insert into public.modules (key, label, is_base, sort_order) values
  ('menu', 'Tvorba menu', false, 15)
on conflict (key) do update
  set label = excluded.label,
      is_base = excluded.is_base,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- OPRÁVNĚNÍ
--
-- Schvalování návrhů si vlastní oprávnění nezakládá — na to je
-- approvals.decide („Schvalovat návrhy agentů“), které v provozu už je.
-- Druhé právo téhož významu by znamenalo dvě místa, kde se rozhoduje.
--
-- Obojí je citlivé: kdo mění podmínky návrhu, mění i to, co se objeví
-- hostům na lístku a za kolik.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('menu_ai.use',    'menu', 'Nechat navrhnout menu',              true, 150),
  ('menu_ai.manage', 'menu', 'Měnit podmínky, za kterých se navrhuje', true, 151)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- U STÁVAJÍCÍCH FIREM VYPNUTÝ
--
-- Tady schválně NENÍ žádný insert do public.tenant_modules. Modul je
-- zapnutý jen tehdy, když firma má svůj řádek — a bez něj app.has_access
-- neprojde přes vnitřní spojení na tenant_modules, takže menu_ai.* zavírá
-- i majiteli. To je ta druhá obranná linie: schovaná položka v nabídce
-- není zámek, tohle ano. (Pravidlo 5)
--
-- Nikomu se tím nic nebere — modul dosud neexistoval. Zapne se za firmu
-- v Nastavení → Moduly, až bude co zapínat.
--
-- Nové firmy ho taky nedostanou: app.create_tenant zapíná jen moduly
-- s is_base = true.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.tenant_modules where module_key = 'menu') then
    raise exception 'Modul menu má být u stávajících firem vypnutý, ale někdo mu už řádek založil';
  end if;
end $$;
