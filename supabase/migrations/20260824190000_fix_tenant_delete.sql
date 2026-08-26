-- =====================================================================
-- Foodtab — oprava: firmu nešlo smazat
--
-- Trigger, který brání vypnutí základního modulu, blokoval i kaskádu
-- při mazání celé firmy. Důsledek: firma se nedala odstranit vůbec —
-- ani omylem založená testovací, ani na žádost o výmaz osobních údajů.
--
-- Nově se blokuje jen samostatné odebrání základního modulu u firmy,
-- která dál existuje. Když mizí firma, mizí s ní i její moduly.
-- =====================================================================

create or replace function app.protect_base_module()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Při mazání firmy je její řádek v tenants už pryč a kaskáda jen
    -- uklízí, co po ní zbylo. Tehdy nebráníme.
    if exists (select 1 from public.tenants t where t.id = old.tenant_id)
       and exists (select 1 from public.modules m
                   where m.key = old.module_key and m.is_base) then
      raise exception 'Základní modul % nejde odebrat.', old.module_key
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if exists (select 1 from public.modules m
             where m.key = new.module_key and m.is_base)
     and (new.status <> 'active' or new.valid_until is not null) then
    raise exception 'Základní modul % musí zůstat aktivní.', new.module_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- Audit a mazání firmy
--
-- Pravidla na audit_log zakazují mazání z aplikace. Kaskáda z tenants
-- ale musí projít, jinak by firmu nešlo odstranit ani na žádost
-- o výmaz osobních údajů — a to je povinnost, ne volba.
--
-- Zákaz mazání proto zužujeme: platí pro běžné dotazy, ne pro úklid
-- po zaniklé firmě. Rozlišujeme podle toho, jestli firma ještě existuje.
-- ---------------------------------------------------------------------

drop rule if exists audit_log_no_delete on public.audit_log;

-- Mazání blokujeme, když firma pořád existuje — a taky u systémových
-- záznamů, které k žádné firmě nepatří (tenant_id je prázdné). Ty by
-- jinak propadly, protože poddotaz na neexistující firmu nic nenajde.
-- Projde tedy jediný případ: řádek patřil firmě, která už zanikla.
create rule audit_log_no_delete as
  on delete to public.audit_log
  where old.tenant_id is null
     or exists (select 1 from public.tenants t where t.id = old.tenant_id)
  do instead nothing;

comment on table public.audit_log is
  'Neměnný záznam. Z aplikace nejde měnit ani mazat; smazat se dá jen '
  'kaskádou při zániku celé firmy.';
