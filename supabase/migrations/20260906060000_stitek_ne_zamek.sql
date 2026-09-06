-- =====================================================================
-- Foodtab — jmenovité přiřazení úkolu je ŠTÍTEK, ne zámek
--
-- Rozhodnutí Šéfíka z docs/odpovedi-na-nocni-praci-2026-09-06.md,
-- odpovědi 3 a „Štítek, ne zámek". Dokončuje krok C z
-- docs/nocni-prace-komunikace-2026-09-05.md.
--
-- Mění se PRAVIDLO, takže se s ním v témže commitu mění i kontrola,
-- která popisovala to staré (`krok3_scenar`, oddíl o číšníkovi)
-- a `krok27_scenar`, oddíl 5. Zákaz sahat na cizí scénáře platí proto,
-- aby se do nich nešahalo POTAJÍ; změna pravidla, o které se ví, je
-- něco jiného.
--
-- ---------------------------------------------------------------------
-- PROČ
--
-- Do 6. 9. platilo, že úkol se štítkem „Anna" smí zavřít jen Anna
-- (nebo správce úkolů). V provozu ale zaskakuje kdekdo — a úkol, který
-- smí splnit jediný člověk, zůstane nesplněný přesně ve chvíli, kdy
-- ten člověk marodí. V pátek večer to znamená nevynesené sklo.
--
-- 7shifts to má výslovně takhle:
-- *„Other employees who can view this list can also see or complete
-- tasks that are tagged to someone else."*
--
-- Nově tedy: KDO NA ÚKOL VIDÍ, TEN HO SMÍ ZAVŘÍT. Štítek říká, na koho
-- se primárně čeká, ne kdo jediný smí.
--
-- Platí to i pro úkol na ÚSEK (odpověď 3): „úkol na úsek, který smí
-- zavřít jen někdo, zůstane v pátek večer nesplněný, protože ten někdo
-- zrovna marodí." Proto se do podmínky adresát nedává vůbec — ani
-- `employee_id`, ani `role_id`, ani `usek_id`, ani `position_id`.
--
-- ---------------------------------------------------------------------
-- CO SE TÍM NEUVOLŇUJE
--
-- `done_by` se zapisuje dál a vždycky. Až bude úkol se štítkem „Anna"
-- smět zavřít kdokoli, je `done_by` JEDINÉ, co drží odpovědnost —
-- proto na něj míří samostatná kontrola v krok27, oddíl 4.
--
-- Cizí firma dál nevidí nic: `app.is_member` zůstává první podmínkou
-- a „neexistuje" a „nepatří vám" dál splývají do jedné hlášky.
--
-- ---------------------------------------------------------------------
-- „KDO VIDÍ" SE BERE Z TÉŽE FUNKCE JAKO POLITIKA ČTENÍ
--
-- Politika `tasks_read` (20260823130000_provoz.sql) zní:
--
--     app.can_read_scoped(tenant_id, 'tasks.read', branch_id)
--     or employee_id in (moje employees)
--
-- Tady se schválně píše TOTÉŽ, a ne `app.has_access`. Rozdíl by nebyl
-- kosmetický: `has_access` u firemního úkolu (`branch_id is null`)
-- vyžaduje členství s rozsahem celé firmy, kdežto `can_read_scoped`
-- pustí i vedoucího jedné pobočky. Číšník by tedy firemní úkol VIDĚL
-- a nesměl by ho zavřít — a věta „kdo vidí, smí zavřít" by přestala
-- platit hned u prvního firemního úkolu.
-- =====================================================================

create or replace function public.complete_task(p_task uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_task  public.tasks;
  v_emp   uuid;
  v_smi   boolean;
  v_pozde boolean;
begin
  select * into v_task from public.tasks t where t.id = p_task;

  -- Neexistuje a nepatří vám splývá schválně: jinak by šlo zkoušením
  -- adres zjistit, jaké úkoly má cizí firma.
  if not found or not app.is_member(v_task.tenant_id) then
    raise exception 'Úkol nenalezen.' using errcode = 'no_data_found';
  end if;

  select e.id into v_emp
  from public.employees e
  where e.tenant_id = v_task.tenant_id
    and e.user_id = (select auth.uid())
    and e.deleted_at is null;

  /*
    `coalesce` tu není kosmetika (platí od 25. 8.): kdyby vnitřek vrátil
    NULL, `if not v_smi` se neprovede a povolení by se propadlo místo
    odmítnutí.

    Adresát v podmínce SCHVÁLNĚ NENÍ. To je celá změna.
  */
  v_smi := coalesce(
       app.can_read_scoped(v_task.tenant_id, 'tasks.read', v_task.branch_id)
    -- Vlastní úkol si zavře i ten, kdo na pobočku právo nemá:
    -- brigádník s úkolem „převzít dodávku" `tasks.read` mít nemusí.
    -- Je to táž druhá polovina, jakou má politika `tasks_read`.
    or (v_emp is not null and v_task.employee_id = v_emp),
    false);

  if not v_smi then
    raise exception 'Tenhle úkol není váš.' using errcode = 'insufficient_privilege';
  end if;

  -- Druhé kliknutí nic nepokazí a nic nepřepíše. Kdo úkol zavřel jako
  -- první, tím zůstane.
  if v_task.status <> 'open' then
    return;
  end if;

  /*
    ÚKOL PO TERMÍNU NEZMIZÍ A JDE SPLNIT (beze změny z 20260906040000).
    Pozdní splnění se zapisuje do auditu; samostatný sloupec na to není,
    protože `done_at > due_at` je odvoditelné a druhý údaj o téže věci
    se dřív nebo později rozejde.
  */
  v_pozde := v_task.due_at is not null and now() > v_task.due_at;

  update public.tasks
     set status  = 'done',
         done_at = now(),
         done_by = v_emp
   where id = p_task;

  perform app.audit(
    p_tenant      => v_task.tenant_id,
    p_action      => case when v_pozde then 'task.done_pozde' else 'task.done' end,
    p_entity_type => 'task',
    p_entity_id   => p_task::text,
    p_branch      => v_task.branch_id,
    p_after       => jsonb_build_object(
      'pozde', v_pozde,
      'po_termine_minut',
        case when v_pozde
          then floor(extract(epoch from (now() - v_task.due_at)) / 60)::int
        end,
      -- Kdo to zavřel, i když štítek zněl na někoho jiného. Od dneška
      -- se ty dva údaje běžně LIŠÍ, a právě proto tam oba jsou.
      'splnil', v_emp,
      'stitek_na', v_task.employee_id
    )
  );
end;
$$;

comment on function public.complete_task(uuid) is
  'Zavře úkol. Smí to každý, kdo na úkol vidí — jmenovité přiřazení '
  'i úsek jsou ŠTÍTEK, ne zámek (7shifts, rozhodnutí Šéfíka 6. 9. 2026). '
  '`done_by` se zapisuje vždycky: od uvolnění zámku je to jediné, co '
  'drží odpovědnost.';

revoke all on function public.complete_task(uuid) from public, anon;
grant execute on function public.complete_task(uuid) to authenticated;
