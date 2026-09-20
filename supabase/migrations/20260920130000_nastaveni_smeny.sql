-- =====================================================================
-- Foodtab — nastavení modulu Směny: výběr zařazení při přidávání směny
--
-- Zadání: Šéfík 20. 9. 2026 — ve formuláři nové směny je pole „Úsek /
-- pozice“ (zařazení). Zaměstnanci jsou zařazeni od začátku a změna se dá
-- napsat do poznámky, takže výběr je zbytečné klikání navíc; přesto ho
-- nechat a nastavit, jestli se nabízí. „Nastavení na přidání směny a
-- nastavení celého modulu směny.“
--
-- ---------------------------------------------------------------------
-- CO SE PŘIDÁVÁ
--
--  * `tenant_settings.smeny_zarazeni_ve_formulari` — nabízet ve formuláři
--    nové směny výběr zařazení (pozice)? Výchozí `true` = beze změny;
--    firma si ho vypne na obrazovce Nastavení → Směny.
--  * `nastavit_smeny_formular` — zápis přes funkci s kontrolou práva
--    a záznamem do auditu, stejně jako `nastavit_dulezitou_zmenu_smeny`.
--    Přímý zápis do `tenant_settings` nemá `authenticated` grant.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--  * Vypnutí NEmění data. Skryje jen pole; směna si při uložení bere
--    zařazení zaměstnance. U neobsazené směny (bez člověka) se pole nabízí
--    vždycky — pozice tam říká, KOHO je třeba.
--  * Grant je jen PŘIDÁNÍ na nový sloupec. Žádný `revoke` ani přepsání
--    celého výčtu — právě to shodilo Nastavení → Firma 19. 9.
--
-- Nasazuje Šéfík. Přidává sloupec a funkci; na data nesahá. Aplikace bez
-- téhle migrace funguje jako dřív (pole se nabízí).
-- =====================================================================

alter table public.tenant_settings
  add column if not exists smeny_zarazeni_ve_formulari boolean not null default true;

comment on column public.tenant_settings.smeny_zarazeni_ve_formulari is
  'Nabízet ve formuláři nové směny výběr zařazení (pozice)? true = ano (výchozí), '
  'false = ne, směna si vezme zařazení zaměstnance. U neobsazené směny se nabízí vždy.';

-- Jen PŘIDÁNÍ grantu (viz hlavička).
grant select (smeny_zarazeni_ve_formulari) on public.tenant_settings to authenticated;


create or replace function public.nastavit_smeny_formular(
  p_tenant   uuid,
  p_zarazeni boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_drive boolean;
begin
  if not app.has_access(p_tenant, 'settings.manage') then
    raise exception 'Nastavení firmy mění jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_zarazeni is null then
    raise exception 'Chybí hodnota nastavení.'
      using errcode = 'null_value_not_allowed';
  end if;

  select s.smeny_zarazeni_ve_formulari into v_drive
    from public.tenant_settings s
   where s.tenant_id = p_tenant;

  insert into public.tenant_settings (tenant_id, smeny_zarazeni_ve_formulari)
  values (p_tenant, p_zarazeni)
  on conflict (tenant_id) do update
    set smeny_zarazeni_ve_formulari = excluded.smeny_zarazeni_ve_formulari;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'settings.smeny_zarazeni_ve_formulari',
    p_entity_type => 'tenant_settings',
    p_entity_id   => p_tenant::text,
    p_before      => jsonb_build_object('zarazeni', coalesce(v_drive, true)),
    p_after       => jsonb_build_object('zarazeni', p_zarazeni)
  );
end;
$$;

comment on function public.nastavit_smeny_formular(uuid, boolean) is
  'Nabízet ve formuláři nové směny výběr zařazení (pozice)? Patří do nastavení '
  'firmy (settings.manage), ne do kódu. Zapisuje se do auditu.';

revoke all on function public.nastavit_smeny_formular(uuid, boolean) from public, anon;
grant execute on function public.nastavit_smeny_formular(uuid, boolean) to authenticated;
