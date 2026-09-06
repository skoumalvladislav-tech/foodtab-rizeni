-- =====================================================================
-- Foodtab — vzkaz vedení: pobočku vybírá odesílatel
--
-- Rozhodnutí Šéfíka z docs/odpovedi-na-nocni-praci-2026-09-06.md,
-- odpověď 2. Opravuje `zalozit_rozhovor` z 20260906010000 (krok A).
-- Jde nasadit samo.
--
-- ---------------------------------------------------------------------
-- CO SE DĚLO
--
-- Adresát „vedoucí pobočky" se odvozoval z DOMOVSKÉ pobočky odesílatele
-- (`employees.branch_id`). Sám jsem to v noci označil za otázku a Šéfík
-- ji zavřel takhle:
--
--   Člověk, který dělá na dvou pobočkách, si stěžuje na to, co zažil
--   TAM, KDE ZROVNA BYL — a vzkaz by přistál u vedoucího té druhé
--   provozovny.
--
-- To je ta nejhorší varianta, jakou tenhle modul může mít: stížnost
-- dojde někomu, komu neměla, a člověk si přitom myslí, že si
-- postěžoval. Horší než žádná cesta.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
--   * Kdo dosáhne na JEDNU pobočku, se na nic neptá — odvodí se.
--   * Kdo dosáhne na VÍC, musí ji vybrat. Když nevybere, funkce to
--     odmítne VĚTOU, ne tichým dosazením domovské pobočky.
--   * Vybraná pobočka se ověřuje proti členství (pravidlo 4).
--
-- POBOČKA SE DO KONVERZACE NEUKLÁDÁ. Omezení
-- `konverzace_pobocka_dava_smysl` pouští `branch_id` jen u druhu
-- `pobocka`, a to je správně: u vzkazu vedení není pobočka vlastností
-- rozhovoru, ale způsobem, jak se zjistí adresáti. Kdo to uvidí, je
-- zapsané v `konverzace_ucastnici` — jmenovitě, a to je přesnější než
-- odkaz na pobočku, protože lidé se přeřazují.
--
-- ---------------------------------------------------------------------
-- A OBRAZOVKA MUSÍ ŘÍCT, KDO TO UVIDÍ
--
-- U vzkazu vedení to platí víc než kdekoli jinde: člověk se musí
-- rozhodnout DŘÍV, než začne psát (`docs/komunikace-zadani.md`,
-- oddíl 2). Anonymní to není a nebude — místo toho platí úzký okruh
-- adresátů a jistota, že se to k dotčenému nedostane.
--
-- Aby na obrazovce nestála obecná věta, která nemusí být pravda,
-- přibývá `public.kdo_uvidi_vzkaz` — vrátí JMÉNA. Ta samá funkce
-- vybírá i účastníky při zakládání, takže se nemůže stát, že obrazovka
-- slíbí jeden okruh a konverzace vznikne s jiným.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KOMU VZKAZ DOJDE — JEDNA DEFINICE PRO OBRAZOVKU I PRO ZALOŽENÍ
--
-- `majitel` = kdo má roli s `is_owner`. Tu konverzaci pak nevidí nikdo
--             jiný — ani provozní, ani nikdo s `people.manage`.
-- `vedouci` = kdo má `people.manage` na TÉ pobočce. Rozhoduje právo,
--             ne název role (pravidlo 2).
--
-- Majitel se u `vedouci` mezi adresáty NEOBJEVÍ, i když má práva na
-- všechno. Kdo si vybral „vedoucí pobočky", vybral si vedoucího; kdyby
-- to zároveň četl majitel, je volba adresáta k ničemu.
-- ---------------------------------------------------------------------

create or replace function app.adresati_vzkazu(
  p_tenant  uuid,
  p_adresat text,
  p_branch  uuid
)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct e.id
  from public.employees e
  join public.memberships m on m.user_id = e.user_id and m.tenant_id = e.tenant_id
  join public.roles r on r.id = m.role_id
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and e.user_id is not null
    and m.status = 'active'
    and (
      (p_adresat = 'majitel' and r.is_owner)
      or (
        p_adresat = 'vedouci'
        and not r.is_owner
        and exists (
          select 1 from public.role_permissions rp
          where rp.role_id = r.id and rp.permission_key = 'people.manage'
        )
        and (
          m.scope = 'tenant'
          or exists (
            select 1 from public.membership_branches mb
            where mb.membership_id = m.id and mb.branch_id = p_branch
          )
        )
      )
    );
$$;

comment on function app.adresati_vzkazu(uuid, text, uuid) is
  'Komu dojde vzkaz vedení. Jedna definice pro obrazovku i pro '
  'zakládání — jinak by obrazovka slíbila jeden okruh a konverzace '
  'vznikla s jiným.';

revoke all on function app.adresati_vzkazu(uuid, text, uuid) from public, anon, authenticated;


/* Průzor pro obrazovku: jména, ne id. */
create or replace function public.kdo_uvidi_vzkaz(
  p_tenant  uuid,
  p_adresat text,
  p_branch  uuid default null
)
returns table (employee_id uuid, jmeno text)
language sql stable security definer set search_path = ''
as $$
  select a.id, e.full_name
  from app.adresati_vzkazu(p_tenant, p_adresat, p_branch) as a(id)
  join public.employees e on e.id = a.id
  where app.is_member(p_tenant)
  order by e.full_name;
$$;

comment on function public.kdo_uvidi_vzkaz(uuid, text, uuid) is
  'Jména lidí, kterým vzkaz vedení dojde. Pro větu na obrazovce — '
  'u vzkazu vedení se člověk musí rozhodnout dřív, než začne psát.';

revoke all on function public.kdo_uvidi_vzkaz(uuid, text, uuid) from public, anon;
grant execute on function public.kdo_uvidi_vzkaz(uuid, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ZALOŽENÍ ROZHOVORU — `vedeni` bere pobočku od odesílatele
--
-- Proti 20260906010000 se mění jen větev `vedeni`. Zbytek je beze
-- změny a je tu proto, že `create or replace` neumí nahradit kus těla.
-- ---------------------------------------------------------------------

create or replace function public.zalozit_rozhovor(
  p_tenant    uuid,
  p_druh      text,
  p_branch    uuid default null,
  p_nazev     text default null,
  p_adresat   text default null,
  p_ucastnici uuid[] default '{}'
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ja      uuid;
  v_id      uuid;
  v_pocet   integer;
  v_pobocek integer;
  v_branch  uuid;
begin
  if not app.modul_zapnuty(p_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  v_ja := app.muj_employee(p_tenant);
  if v_ja is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
  end if;

  -- Pobočka z prohlížeče se ověřuje proti členství, ne proti tomu, že
  -- přišla v požadavku. Jinak stačí přepsat jedno číslo.
  if p_branch is not null
     and p_branch not in (select app.visible_branch_ids(p_tenant)) then
    raise exception 'Na tuhle pobočku nemáte dosah.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_druh = 'pobocka' and p_branch is null then
    raise exception 'Pobočkový kanál potřebuje pobočku.'
      using errcode = 'check_violation';
  end if;

  insert into public.konverzace (tenant_id, druh, branch_id, nazev, adresat, zalozil)
  values (p_tenant, p_druh,
          -- Jen pobočkový kanál si pobočku nese. U vzkazu vedení slouží
          -- k výběru adresátů, ale vlastností rozhovoru není.
          case when p_druh = 'pobocka' then p_branch end,
          nullif(btrim(coalesce(p_nazev, '')), ''),
          p_adresat, v_ja)
  returning id into v_id;

  -- Zakladatel je vždycky uvnitř.
  insert into public.konverzace_ucastnici (konverzace_id, employee_id)
  values (v_id, v_ja);

  if p_druh = 'vedeni' then
    /*
      POBOČKU VYBÍRÁ ODESÍLATEL, NE JEHO DOMOVSKÝ ZÁZNAM.

      Kdo dosáhne na jednu, se na nic neptá. Kdo na víc, musí vybrat —
      a když nevybere, řekne se mu to. Tiché dosazení domovské pobočky
      by znamenalo, že stížnost na vedoucího Perly přistane u vedoucího
      Bernardu, a člověk se to nedozví.
    */
    if p_adresat = 'vedouci' then
      select count(*) into v_pobocek from app.visible_branch_ids(p_tenant);

      if p_branch is not null then
        v_branch := p_branch;
      elsif v_pobocek = 1 then
        select b into v_branch from app.visible_branch_ids(p_tenant) as t(b);
      else
        raise exception 'Vyberte pobočku, ke které vzkaz patří.'
          using errcode = 'check_violation';
      end if;
    end if;

    insert into public.konverzace_ucastnici (konverzace_id, employee_id)
    select v_id, a.id
    from app.adresati_vzkazu(p_tenant, p_adresat, v_branch) as a(id)
    where a.id <> v_ja
    on conflict do nothing;

    get diagnostics v_pocet = row_count;
    if v_pocet = 0 then
      raise exception 'Ve firmě není nikdo, komu by tenhle vzkaz mohl dojít.'
        using errcode = 'no_data_found';
    end if;

  else
    -- Ostatní druhy: účastníci z parametru, ale ověření proti firmě.
    if array_length(p_ucastnici, 1) is not null then
      select count(*) into v_pocet
      from unnest(p_ucastnici) as x(emp)
      where not exists (
        select 1 from public.employees e
        where e.id = x.emp and e.tenant_id = p_tenant and e.deleted_at is null
      );

      if v_pocet > 0 then
        raise exception 'Někdo z účastníků do téhle firmy nepatří.'
          using errcode = 'insufficient_privilege';
      end if;

      insert into public.konverzace_ucastnici (konverzace_id, employee_id)
      select distinct v_id, x.emp from unnest(p_ucastnici) as x(emp)
      where x.emp <> v_ja
      on conflict do nothing;
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[]) is
  'Jediná cesta, kterou vznikne konverzace. U druhu vedeni bere pobočku '
  'od odesílatele (ne z jeho domovského záznamu) a adresáty si odvodí '
  'sama — obrazovka je neposílá.';

revoke all on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[])
  from public, anon;
grant execute on function public.zalozit_rozhovor(uuid, text, uuid, text, text, uuid[])
  to authenticated;
