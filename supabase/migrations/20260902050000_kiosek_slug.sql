-- =====================================================================
-- Foodtab — kiosek zná adresu své pobočky
--
-- Zadání: docs/qr-na-kiosku-zadani.md, oddíl 2.
--
-- QR na tabletu ponese odkaz
--
--     https://<adresa>/<pobocka>/dochazka?kod=CE8CA63E
--
-- a POBOČKU BERE KIOSEK ZE SVÉHO ZAŘÍZENÍ, ne z ničeho, co přijde
-- z prohlížeče. Tablet ví, čí je — a `kiosk_stav` mu to řekne.
--
-- Dosud vracel jen NÁZEV pobočky („Restaurace Černá Perla“). Do adresy
-- patří slug (`cerna-perla`), a odvozovat ho v prohlížeči z názvu by
-- znamenalo mít pravidlo pro diakritiku a mezery na druhém místě —
-- takové dvě kopie se vždycky rozejdou.
--
-- Nic dalšího se nepřidává. V adrese nesmí být nic než pobočka a kód
-- (zadání, oddíl 2), takže kiosek nic dalšího nepotřebuje.
-- =====================================================================

create or replace function public.kiosk_stav(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d       public.branch_devices;
  v_okno  bigint;
  v_den   date;
  v_jmena jsonb;
begin
  d := app.zarizeni_podle_klice(p_klic);
  if d.id is null then
    raise exception 'Zařízení není registrované nebo bylo odvolané.'
      using errcode = 'insufficient_privilege';
  end if;

  v_okno := app.kiosk_okno(d.branch_id);
  v_den  := app.business_date(d.branch_id, now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'jmeno', e.full_name,
           'od', s.starts_at,
           'do', s.ends_at
         ) order by s.starts_at), '[]'::jsonb)
    into v_jmena
  from public.shifts s
  join public.employees e on e.id = s.employee_id
  where s.branch_id = d.branch_id
    and s.shift_date = v_den
    and s.status <> 'cancelled'
    and e.deleted_at is null;

  return jsonb_build_object(
    'pobocka',  (select b.name from public.branches b where b.id = d.branch_id),
    -- Nově: adresní podoba pobočky do odkazu v QR.
    'slug',     (select b.slug from public.branches b where b.id = d.branch_id),
    'zarizeni', d.nazev,
    'kod',      app.kiosk_kod(d.branch_id, v_okno),
    'platnost', (select b.kiosk_kod_vterin from public.branches b where b.id = d.branch_id),
    'den',      v_den,
    'smeny',    v_jmena
  );
end;
$$;

comment on function public.kiosk_stav(text) is
  'Co má kiosek ukázat: měnící se kód, adresa pobočky do QR a dnešní '
  'směny. Pobočka se bere ze zařízení, ne z prohlížeče.';

revoke all on function public.kiosk_stav(text) from public;
grant execute on function public.kiosk_stav(text) to anon, authenticated;
