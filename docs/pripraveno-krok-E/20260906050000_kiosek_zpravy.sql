-- =====================================================================
-- Foodtab — kiosek: že zprávy jsou, obsah až po PINu, viditelný odpočet
--
-- Zadání docs/nocni-prace-komunikace-2026-09-05.md, krok E.
-- Staví na kroku A (20260906010000) a na kioskových funkcích
-- z 20260901180000 a 20260901190000. Jde nasadit sám.
--
-- ---------------------------------------------------------------------
-- PROČ TO NENÍ JEN „UKAŽ ZPRÁVY"
--
-- TABLET STOJÍ NA BARU. Osobní zpráva na něm nesmí svítit tak, aby si
-- ji přečetl kdokoli, kdo jde okolo — a kolem baru chodí i hosté.
-- Proto se to dělí na dvě funkce:
--
--   kiosk_zpravy_pocet   → ŽE zprávy jsou. Bez jmen, bez obsahu.
--   kiosk_zpravy_pinem   → obsah, a jen tomu, komu PIN sedl.
--
-- ---------------------------------------------------------------------
-- SEZENÍ SE SCHVÁLNĚ NEZAVÁDÍ
--
-- Nabízelo se vydat po PINu token s platností a tím kiosek „přihlásit".
-- Neudělal jsem to: byl by to nový přihlašovací mechanismus volatelný
-- rolí `anon`, tedy nejcitlivější věc, jakou jde v týhle aplikaci
-- postavit — a stavět ji ve čtyři ráno je špatný nápad.
--
-- Místo toho je to jednorázové čtení: PIN se ověří, obsah se vrátí
-- jednou a odpočet na tabletu ho v prohlížeči zahodí. Nic se neukládá,
-- není co ukrást a není co nechat platné déle, než mělo. Když bude
-- potřeba na kiosku i odpovídat, sezení se zavést musí — a bude to
-- vlastní krok s vlastním rozhodnutím. Do hlášení.
--
-- ---------------------------------------------------------------------
-- ODPOČET JE JEDINÉ, CO ČLOVĚKU NA BARU ŘEKNE, ŽE PŘESTANE BÝT SEBOU
--
-- Převzato z Joltu: v rohu běží viditelný odpočet do automatického
-- odhlášení. Bez něj člověk odejde od tabletu s tím, že „to zmizí
-- samo", a neví, kdy. Délka je proto ÚDAJ FIRMY (pravidlo 1), ne
-- konstanta v kódu — bistro s jedním pultem a hotel s recepcí mají
-- jiný provoz.
-- =====================================================================


-- ---------------------------------------------------------------------
-- JAK DLOUHO OBSAH ZŮSTANE
--
-- POZOR NA GRANT. `tenant_settings` má práva po SLOUPCÍCH
-- (20260901220000, ř. 104) a `alter table … add column` nový sloupec do
-- toho výčtu NEPŘIDÁ. Dotaz, který si o něj řekne, dostane
-- `42501 permission denied` DŘÍV, než se dostane na řádky — takže
-- nespadne jen ten sloupec, ale celá obrazovka. Přesně tak položil
-- `employees.color` Lidi i Rozpis směn 3. 9. večer.
-- ---------------------------------------------------------------------

alter table public.tenant_settings
  add column if not exists kiosek_odhlaseni_s integer not null default 45
  check (kiosek_odhlaseni_s between 10 and 600);

comment on column public.tenant_settings.kiosek_odhlaseni_s is
  'Za kolik vteřin kiosek sám zahodí zobrazený obsah. Údaj firmy, ne '
  'konstanta v kódu: bistro s jedním pultem a hotel s recepcí mají '
  'jiný provoz. Odpočet se u toho člověku VIDITELNĚ ukazuje (Jolt).';

-- Ten nový sloupec se musí udělit zvlášť. Viz varování výš.
grant select (kiosek_odhlaseni_s) on public.tenant_settings to authenticated;
grant update (kiosek_odhlaseni_s) on public.tenant_settings to authenticated;


-- ---------------------------------------------------------------------
-- ŽE ZPRÁVY JSOU — BEZ JMEN A BEZ OBSAHU
--
-- Vrací POČET LIDÍ, kterým něco nepřečtené leží, ne počet zpráv a ne
-- jména. Počet zpráv by prozradil, že se o někom hodně píše; jméno by
-- prozradilo, koho se to týká. Obojí si na baru přečte kdokoli.
--
-- „Kdo patří na tuhle pobočku" se bere stejně jako u PINu
-- (`app.pin_overit`): domovská pobočka NEBO směna v okolí dneška.
-- Dvě různé definice téhož by se rozešly a na tabletu by pak svítilo
-- číslo, které nesedí na to, kdo se sem může přihlásit.
-- ---------------------------------------------------------------------

create or replace function public.kiosk_zpravy_pocet(p_klic text)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  d      public.branch_devices;
  v_kolik integer;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(distinct u.employee_id) into v_kolik
  from public.konverzace_ucastnici u
  join public.employees e on e.id = u.employee_id
  join public.konverzace_zpravy z on z.konverzace_id = u.konverzace_id
  where e.tenant_id = d.tenant_id
    and e.deleted_at is null
    and u.odesel_kdy is null
    and z.stornovano_kdy is null
    and z.autor is distinct from u.employee_id
    and (u.precteno_do is null or z.vytvoreno_kdy > u.precteno_do)
    and (
      e.branch_id = d.branch_id
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id and s.branch_id = d.branch_id
          and s.shift_date between current_date - 1 and current_date + 1
          and s.status <> 'cancelled'
      )
    );

  return coalesce(v_kolik, 0);
end;
$$;

comment on function public.kiosk_zpravy_pocet(text) is
  'Kolika lidem na téhle pobočce něco nepřečtené leží. Bez jmen a bez '
  'obsahu — tablet stojí na baru a chodí kolem něj i hosté.';

revoke all on function public.kiosk_zpravy_pocet(text) from public;
grant execute on function public.kiosk_zpravy_pocet(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- OBSAH AŽ PO PINU
--
-- ŠPATNÝ PIN SE NEVYHAZUJE JAKO VÝJIMKA. Vypadalo by to čistěji, ale
-- výjimka vrátí zpět celou příkazovou dávku — a s ní i počítadlo
-- nezdarů a zápis do auditu, které `app.pin_overit` zrovna udělalo.
-- Zámek po pěti pokusech by tak nikdy nezabral: každý nezdar by se sám
-- smazal tou chybou, která ho hlásí. Našlo se to u `pichnout_pinem`
-- a platí to tady stejně, proto se vrací řádek s `ok = false`.
--
-- `app.je_ucastnik` se tu POUŽÍT NEDÁ: ptá se na `auth.uid()`, a ta je
-- u role `anon` prázdná. Účastnictví se proto čte přímo na
-- zaměstnance, kterému PIN sedl — a jen na něj. To je jediné místo
-- v aplikaci, kde se konverzace čtou bez přihlášeného účtu, takže se
-- na tu podmínku musí dívat pozorně: `u.employee_id = v_emp`.
-- ---------------------------------------------------------------------

create or replace function public.kiosk_zpravy_pinem(p_klic text, p_pin text)
returns table (
  ok      boolean,
  jmeno   text,
  do_kdy  timestamptz,
  zpravy  jsonb
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  d      public.branch_devices;
  v_emp  uuid;
  v_vter integer;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    -- Neregistrované zařízení není pokus o uhodnutí PINu a není co si
    -- pamatovat — tady se výjimka hodit SMÍ.
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_emp := app.pin_overit(d.tenant_id, d.branch_id, coalesce(p_pin, ''));

  if v_emp is null then
    return query select false, null::text, null::timestamptz, null::jsonb;
    return;
  end if;

  select coalesce(s.kiosek_odhlaseni_s, 45) into v_vter
  from public.tenant_settings s where s.tenant_id = d.tenant_id;
  v_vter := coalesce(v_vter, 45);

  return query
  select
    true,
    (select e.full_name from public.employees e where e.id = v_emp),
    now() + make_interval(secs => v_vter),
    coalesce(
      (
        select jsonb_agg(x order by x ->> 'kdy')
        from (
          select jsonb_build_object(
                   'rozhovor', k.nazev,
                   'druh',     k.druh,
                   'autor',    a.full_name,
                   'nalehava', z.nalehava,
                   'kdy',      z.vytvoreno_kdy,
                   'text',     z.text
                 ) as x
          from public.konverzace_ucastnici u
          join public.konverzace k          on k.id = u.konverzace_id
          join public.konverzace_zpravy z   on z.konverzace_id = u.konverzace_id
          left join public.employees a      on a.id = z.autor
          -- TOHLE JE TA PODMÍNKA. Jen konverzace toho člověka, kterému
          -- PIN sedl. Kdyby odsud zmizela, čte tablet po libovolném
          -- platném PINu celou firmu.
          where u.employee_id = v_emp
            and u.odesel_kdy is null
            and z.stornovano_kdy is null
            and (u.precteno_do is null or z.vytvoreno_kdy > u.precteno_do)
            and z.autor is distinct from v_emp
        ) as t
      ),
      '[]'::jsonb
    );
end;
$$;

comment on function public.kiosk_zpravy_pinem(text, text) is
  'Nepřečtené zprávy toho, komu PIN sedl, a okamžik, kdy je má tablet '
  'zahodit. Špatný PIN vrací řádek s ok = false, ne výjimku — jinak by '
  'se s ní vrátilo zpět i počítadlo nezdarů a zámek by nezabral.';

revoke all on function public.kiosk_zpravy_pinem(text, text) from public;
grant execute on function public.kiosk_zpravy_pinem(text, text) to anon, authenticated;
