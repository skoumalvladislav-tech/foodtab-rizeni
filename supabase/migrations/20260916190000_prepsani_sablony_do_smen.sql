-- =====================================================================
-- Foodtab — vědomé přepsání časů podle šablony do NEVYDANÝCH směn
--
-- Zadání Šéfíka 16.9.2026 (chat): u maticového dovozu rozpisu appka
-- sama navrhne čas pro neznámou zkratku (R/O/X…) a založí ji do
-- Šablon směn — "to se upraví později". Až se "upraví později" stane
-- skutečností (Šéfík v Nastavení opraví 08:00–16:00 na skutečný čas),
-- chce možnost tu opravu dostat i do právě dovezených směn.
--
-- ---------------------------------------------------------------------
-- PROČ TO NENÍ JEN "ZAPNOUT ZPĚT" VAZBU ŠABLONA→SMĚNA
--
-- `docs/sablony-smen-zadani.md` a migrace 20260903060000 mají jednu
-- ústřední větu, opakovanou schválně třikrát: ŠABLONA JE PŘEDVYPLNĚNÍ,
-- NE VAZBA. Důvod: kdyby změna šablony tiše posunula všechny směny,
-- co z ní vznikly, přejmenování "D" z 9:00 na 9:30 by posunulo rozpis,
-- který lidé už mají v telefonu a podle kterého si zařídili hlídání
-- dětí.
--
-- Tahle funkce tu zásadu NERUŠÍ, jen jí dává výslovnou, jednorázovou
-- výjimku — a jen tam, kde je bezpečná:
--
--   1. Musí to spustit ČLOVĚK, vědomě (žádný trigger na UPDATE
--      sablony_smen, žádné automatické šíření).
--   2. Zasáhne jen směny s PŘESNĚ tou zkratkou (`sablona_key`) —
--      a ten sloupec se sám maže, jakmile někdo časy ručně přepíše
--      (viz `ulozit_smenu`: "zkratka šablony se jen OPÍŠE"). Ručně
--      upravená směna tedy zkratku nenese a tahle funkce se jí
--      nedotkne, i kdyby vznikla ze stejné šablony.
--   3. Zasáhne jen NEVYDANÉ směny (`published_at is null`) — přesně tu
--      hranici, kterou appka jinde používá pro "lidi to ještě
--      neviděli" (Rozpis směn → Vydání). Vydaná směna je risk popsaný
--      výš; nevydaná je pořád jen návrh.
--   4. Respektuje stejné pořadí pravidel jako `sablona_poradi` —
--      firemní úprava "R" nepřepíše směny na pobočce, která má pro
--      "R" svou vlastní, užší šablonu.
-- =====================================================================

create or replace function public.prepsat_casy_podle_sablony(
  p_tenant  uuid,
  p_sablona uuid
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sablona public.sablony_smen;
  v_pocet   integer;
begin
  select * into v_sablona from public.sablony_smen
  where id = p_sablona and tenant_id = p_tenant;

  if not found then
    raise exception 'Takovou šablonu neznám.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'settings.manage', v_sablona.branch_id) then
    raise exception 'Šablony směn mění jen ten, kdo spravuje nastavení.'
      using errcode = 'insufficient_privilege';
  end if;

  with cil as (
    select s.id
    from public.shifts s
    where s.tenant_id = p_tenant
      and s.status <> 'cancelled'
      and s.published_at is null
      and lower(btrim(s.sablona_key)) = lower(btrim(v_sablona.key))
      and (
        -- Firemní šablona (branch_id je null): nesahat na pobočku,
        -- která má pro tenhle klíč vlastní, užší šablonu — ta by
        -- podle sablona_poradi vyhrála a tahle úprava by ji obešla.
        v_sablona.branch_id is not null and s.branch_id = v_sablona.branch_id
        or v_sablona.branch_id is null and not exists (
          select 1 from public.sablony_smen t2
          where t2.tenant_id = p_tenant
            and t2.active
            and t2.branch_id = s.branch_id
            and lower(btrim(t2.key)) = lower(btrim(v_sablona.key))
        )
      )
  )
  update public.shifts s
     set starts_at  = v_sablona.starts_at,
         ends_at    = v_sablona.ends_at,
         updated_at = now()
    from cil
   where s.id = cil.id;

  get diagnostics v_pocet = row_count;

  perform app.audit(
    p_tenant      => p_tenant,
    p_action      => 'sablona.prepsano_do_smen',
    p_entity_type => 'sablona_smeny',
    p_entity_id   => p_sablona::text,
    p_branch      => v_sablona.branch_id,
    p_after       => jsonb_build_object(
                       'key', v_sablona.key, 'od', v_sablona.starts_at,
                       'do', v_sablona.ends_at, 'pocet_smen', v_pocet
                     )
  );

  return v_pocet;
end;
$$;

comment on function public.prepsat_casy_podle_sablony(uuid, uuid) is
  'Vědomá výjimka z "šablona je předvyplnění, ne vazba" (20260903060000): '
  'přepíše časy jen v NEVYDANÝCH směnách, které mají přesně tuhle '
  'zkratku (nezasahuje ručně upravené ani vydané směny).';

revoke all on function public.prepsat_casy_podle_sablony(uuid, uuid) from public, anon;
grant execute on function public.prepsat_casy_podle_sablony(uuid, uuid) to authenticated;
