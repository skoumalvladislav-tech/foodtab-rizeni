-- Třístupňová priorita zpráv (NORMAL/IMPORTANT/URGENT).
--
-- Noční zadání "KOMUNIKACE / VZKAZY 2.0", bod 2 z doporučeného pořadí
-- v docs/hlaseni/komunikace-current-state-map-2026-09-17.md: dnes je
-- `nalehava` jen boolean, zadání chce třístupňovou škálu jako řídicí
-- prvek doručení a zobrazení, ne jen barvu.
--
-- ROZŠÍŘENÍ, NE PŘEPIS (viz mapa, bod 4/2). `nalehava` zůstává —
-- jenom přestává být ručně zapisovaný sloupec a stává se odvozeným
-- (`generated always as (priorita = 'urgent') stored`). Nemůže se
-- proto rozejít s `priorita` a všechno, co dnes čte `nalehava`
-- (RLS, moje_rozhovory, kiosek_zpravy, krok24_scenar, app.doruci_se),
-- funguje beze změny dál. `app.doruci_se` se schválně NEMĚNÍ: doručení
-- mimo směnu obchází jen URGENT (právo communication.urgent), IMPORTANT
-- je jen vizuální/řadicí váha a doručovací pravidlo respektuje beze
-- změny.
--
-- `poslat_zpravu` dostává NOVÝ parametr `p_priorita` navíc k existujícím
-- třem — stará (uuid,text,boolean) se proto DROPne (viz níž), ať vedle
-- ní nezůstane souběžně dvouznačná dvojice. Staré volání se třemi
-- argumenty (`poslat_zpravu(id, text, true)`, krok24_scenar.sql)
-- funguje dál beze změny — jen přes JEDNU, rozšířenou funkci.

-- =====================================================================
-- KONVERZACE_ZPRAVY: priorita
-- =====================================================================

alter table public.konverzace_zpravy add column priorita text;

update public.konverzace_zpravy
   set priorita = case when nalehava then 'urgent' else 'normal' end;

alter table public.konverzace_zpravy
  alter column priorita set not null,
  alter column priorita set default 'normal';

alter table public.konverzace_zpravy
  add constraint konverzace_zpravy_priorita_check
  check (priorita in ('normal', 'important', 'urgent'));

comment on column public.konverzace_zpravy.priorita is
  'normal / important / urgent. Řídí zobrazení a řazení. Doručení mimo '
  'směnu obchází jen urgent (viz app.doruci_se) — important je jen '
  'vizuální váha.';

-- Sloupec se ruší a zakládá znovu jako GENEROVANÝ, ne ALTER — PostgreSQL
-- neumí existující obyčejný sloupec dodatečně předělat na generovaný.
-- Žádná politika ani view na něm nestojí (ověřeno), takže DROP je bez
-- rizika. Jméno i typ zůstávají stejné, takže všechno, co ho čte
-- (SELECT, RLS, `to_jsonb(NEW)` v obecné auditní spoušti), funguje dál
-- beze změny — mění se jen TOHLE, jak vzniká.
alter table public.konverzace_zpravy drop column nalehava;

alter table public.konverzace_zpravy
  add column nalehava boolean
  generated always as (priorita = 'urgent') stored
  not null;

comment on column public.konverzace_zpravy.nalehava is
  'Odvozeno z priorita = ''urgent'' (generovaný sloupec, od 20260917040000). '
  'Obchází pravidlo o doručení mimo směnu. Smí ji poslat jen '
  'communication.urgent, je viditelně označená a jde do auditu se '
  'jménem — to je to jediné, co brání tomu, aby se naléhavé stalo '
  'výchozím.';


-- =====================================================================
-- POSLAT_ZPRAVU: nový parametr p_priorita
-- =====================================================================
--
-- CREATE OR REPLACE se starým typovým otiskem (uuid,text,boolean) tu
-- NESTAČÍ — v praxi (ověřeno CI, run 35267094122) vedle sebe nechá OBĚ
-- funkce a dvouargumentové volání jako `poslat_zpravu(id, text)` pak
-- spadne na "function ... is not unique", protože defaulty obou
-- overloadů match. Stará se proto napřed výslovně DROPne.
drop function if exists public.poslat_zpravu(uuid, text, boolean);

create or replace function public.poslat_zpravu(
  p_konverzace uuid,
  p_text       text,
  p_nalehava   boolean default false,
  p_priorita   text default null
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_ja       uuid;
  v_id       uuid;
  v_priorita text;
begin
  select k.tenant_id into v_tenant from public.konverzace k where k.id = p_konverzace;

  if v_tenant is null or not app.je_ucastnik(p_konverzace) then
    raise exception 'K téhle konverzaci nemáte přístup.'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.modul_zapnuty(v_tenant, 'provoz') then
    raise exception 'Modul Provoz není pro tuhle firmu zapnutý.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.konverzace k
             where k.id = p_konverzace and k.uzavreno_kdy is not null) then
    raise exception 'Tenhle rozhovor je uzavřený.' using errcode = 'check_violation';
  end if;

  v_ja := app.muj_employee(v_tenant);

  -- `p_priorita` má přednost, pokud je vyplněná; jinak se odvodí ze
  -- starého `p_nalehava` — starý dvouhodnotový volající (true/false)
  -- dostane přesně to chování, které měl vždycky.
  v_priorita := coalesce(p_priorita, case when coalesce(p_nalehava, false) then 'urgent' else 'normal' end);

  if v_priorita not in ('normal', 'important', 'urgent') then
    raise exception 'Neplatná priorita zprávy.' using errcode = 'check_violation';
  end if;

  /*
    NALÉHAVÁ (urgent) JE ZVLÁŠTNÍ PRÁVO, ne communication.manage.

    Spravovat nástěnku a rozsvítit ve dvě ráno telefon dvanácti lidem
    jsou dvě různé pravomoci a `manage` má dnes kdekdo. Právo není
    vázané na pobočku: naléhavá zpráva se posílá i do konverzace, která
    žádnou pobočku nemá. `important` naproti tomu žádné právo nevyžaduje
    — nemění DOKDY zpráva dorazí, jen jak vypadá a kde se řadí.
  */
  if v_priorita = 'urgent'
     and not app.has_permission(v_tenant, 'communication.urgent') then
    raise exception 'Naléhavou zprávu poslat nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text, priorita)
  values (p_konverzace, v_tenant, v_ja, p_text, v_priorita)
  returning id into v_id;

  /*
    NALÉHAVÁ NAVÍC DO AUDITU SE JMÉNEM.

    Řádek v `konverzace_zpravy` audituje spoušť trg_audit_zprav, ale
    ta zapíše id, ne jméno — a odstrašuje jméno. Tohle je to jediné,
    co brání tomu, aby se naléhavé stalo výchozím: když je naléhavé
    všechno, není naléhavé nic. `important` do auditu nejde — není to
    obcházení ničeho, co by potřebovalo zvláštní stopu.

    Text zprávy se do auditu NEDÁVÁ. Audit čte víc lidí než konverzaci
    a obsah je to nejcitlivější, co v aplikaci je.
  */
  if v_priorita = 'urgent' then
    perform app.audit(
      p_tenant      => v_tenant,
      p_action      => 'komunikace.nalehava_zprava',
      p_entity_type => 'konverzace_zprava',
      p_entity_id   => v_id::text,
      p_after       => jsonb_build_object(
        'konverzace', p_konverzace,
        'odesilatel', (select e.full_name from public.employees e where e.id = v_ja),
        'znaku', length(p_text)
      )
    );
  end if;

  return v_id;
end;
$$;

comment on function public.poslat_zpravu(uuid, text, boolean, text) is
  'Jediná cesta, kterou vznikne zpráva. Hlídá účastnictví, zapnutý '
  'modul a právo communication.urgent pro urgent. p_priorita '
  '(normal/important/urgent) má přednost před p_nalehava; bez ní se '
  'priorita odvodí z p_nalehava kvůli starým voláním. Naléhavou '
  'zapisuje do auditu se jménem odesílatele, ale bez textu.';

revoke all on function public.poslat_zpravu(uuid, text, boolean, text) from public, anon;
grant execute on function public.poslat_zpravu(uuid, text, boolean, text) to authenticated;


-- =====================================================================
-- NOTIFICATIONS: priorita se přebírá ze zprávy
-- =====================================================================
--
-- Mapa zjistila: "žádná priorita u notifications vůbec" (bod 3.1).
-- U vzkaz.novy se teď přebírá ze zdrojové zprávy. U ostatních druhů
-- (směny, nástěnka, ...) zůstává výchozí 'normal' — konfigurovatelná
-- naléhavost podle druhu je samostatný krok (mapa, bod 4.3), ne
-- vymyšlená napevno tady.

alter table public.notifications
  add column priorita text not null default 'normal'
  check (priorita in ('normal', 'important', 'urgent'));

comment on column public.notifications.priorita is
  'normal / important / urgent, pro zobrazení a řazení v centru '
  'upozornění. U vzkaz.novy se přebírá z konverzace_zpravy.priorita '
  '(app.upozornit_na_vzkaz_trg); jinde zůstává normal.';

create or replace function app.upozornit_na_vzkaz_trg()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_den  date := (NEW.vytvoreno_kdy at time zone 'UTC')::date;
  v_rec  record;
begin
  for v_rec in
    select e.user_id
      from public.konverzace_ucastnici ku
      join public.employees e on e.id = ku.employee_id
     where ku.konverzace_id = NEW.konverzace_id
       and ku.odesel_kdy    is null
       and e.user_id        is not null
       and e.deleted_at     is null
       and e.tenant_id      = NEW.tenant_id
       -- Vlastní zpráva neupozorňuje (C3/2): autor = employees.id.
       and (NEW.autor is null or ku.employee_id <> NEW.autor)
  loop
    -- Sloučení (C4): smazat nepřečtené téhož druhu a dne.
    delete from public.notifications
     where tenant_id    = NEW.tenant_id
       and user_id      = v_rec.user_id
       and druh         = 'vzkaz.novy'
       and telo->>'den' = v_den::text
       and read_at      is null;

    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo, priorita)
    values (
      NEW.tenant_id,
      v_rec.user_id,
      null,
      'vzkaz.novy',
      jsonb_build_object('den', v_den),
      NEW.priorita
    );
  end loop;

  return NEW;
end $$;
